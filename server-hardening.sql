-- ═══════════════════════════════════════════════════════════════════
--  НАДЁЖНОСТЬ СИСТЕМЫ: защита данных + серверное начисление VIP
--  Выполнить в Supabase → SQL Editor ПОСЛЕ vip-balance.sql.
--  Идемпотентно: можно перезапускать сколько угодно раз.
--
--  Что закрывает (всё найдено при аудите RLS-политик; до этого сервер
--  верил браузеру):
--
--  1. profiles: политика «пользователь редактирует свой профиль» не
--     ограничивала колонки — защищена была только role. Любой мог из
--     консоли браузера написать is_vip=true, vip_until=null,
--     total_donated=999999 и получить бессрочный Gold. Теперь VIP-поля,
--     закреп и роль меняются только админом или сервером.
--  2. profiles.avatar_url / banner_url подставляются в HTML-шаблоны
--     (style="background-image:url('…')") без экранирования, а записать
--     туда можно было что угодно → хранимая XSS. Теперь значение
--     проверяется по шаблону (ссылка на Storage, для фона — ещё
--     сжатая data:-картинка).
--  3. direct_messages: получатель мог переписать ТЕКСТ и отправителя
--     сообщения, которое ему прислали (политика update без колонок).
--     Теперь у ЛС меняется только read_at.
--  4. forum: автор темы мог сам поставить pinned/locked; автор поста —
--     переписать пост без пометки «изменено». Теперь pinned/locked —
--     только стафф, edited_at ставит сервер.
--  5. messages: серверный флуд-контроль (клиентский checkSpam обходится
--     прямым запросом к API).
--  6. Донаты → VIP на СЕРВЕРЕ (раньше — только пока админ открыт на
--     сайте, и только по последним 20 донатам): атомарная функция
--     credit_donation, токен DonationAlerts в БД, статус синхронизации.
--
--  Правило «кто считается доверенным»: запрос идёт НЕ от роли
--  authenticated/anon (то есть это SQL Editor, service_role или тело
--  SECURITY DEFINER-функции) ИЛИ действующий пользователь — админ.
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
--  0. Вспомогательные функции
-- ─────────────────────────────────────────────────────────────────
-- Действует ли сейчас обычный клиент (браузер), а не сервер/админ-консоль
create or replace function public.is_client_session()
returns boolean
language sql
stable
as $$ select current_user in ('authenticated', 'anon') $$;

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select role = 'admin' from public.profiles where id = uid), false) $$;

create or replace function public.is_staff_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select role in ('admin', 'moderator', 'helper') from public.profiles where id = uid), false) $$;


-- ─────────────────────────────────────────────────────────────────
--  1–2. profiles: защищённые колонки + проверка ссылок на картинки
-- ─────────────────────────────────────────────────────────────────
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_session() then
    -- Привилегированные поля обычный пользователь менять не может — значения
    -- молча откатываются (как и у role в registration.sql)
    if not public.is_admin_user(auth.uid()) then
      new.role             := old.role;
      new.is_vip           := old.is_vip;
      new.vip_until        := old.vip_until;
      new.total_donated    := old.total_donated;
      new.vip_pending_rub  := old.vip_pending_rub;
      new.last_pinned_at   := old.last_pinned_at;
    end if;

    -- Ссылки на картинки: проверяем, только если значение менялось (старый
    -- мусор не мешает менять ник/био). Кавычки, пробелы, скобки, <> и т.п.
    -- шаблон не пропускает — вставить в style="…" нечего.
    if new.avatar_url is distinct from old.avatar_url and new.avatar_url is not null then
      if new.avatar_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/[A-Za-z0-9_-]+/[A-Za-z0-9._~%+/-]+(\?t=[0-9]+)?$' then
        raise exception 'Недопустимая ссылка на аватарку';
      end if;
    end if;
    if new.banner_url is distinct from old.banner_url and new.banner_url is not null then
      if not (
        new.banner_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/[A-Za-z0-9_-]+/[A-Za-z0-9._~%+/-]+(\?t=[0-9]+)?$'
        or (new.banner_url ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' and length(new.banner_url) <= 250000)
      ) then
        raise exception 'Недопустимая ссылка на фон профиля';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_protect_columns on public.profiles;
create trigger on_profile_protect_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- 1б. Ник профиля: только буквы, цифры, пробел, _ . - (до 24 символов). Ник попадает в
--     HTML-атрибуты (onclick="openMiniProfile(…,'ник',…)") в чате, ЛС, LFG и списках, и
--     раньше туда можно было записать что угодно, включая кавычки. Лишнее вырезается.
--     Имя триггера начинается с «a1_» — он должен сработать РАНЬШЕ trg_enforce_unique_nick
--     (триггеры одного события идут по алфавиту), иначе в резерв ников попало бы «грязное» имя.
--     Уже существующие ники не трогаем, пока человек сам их не меняет.
create or replace function public.profile_nick_sanitize()
returns trigger
language plpgsql
as $$
declare v text;
begin
  if new.nick is null then return new; end if;
  if TG_OP = 'UPDATE' and new.nick is not distinct from old.nick then return new; end if;
  v := left(btrim(regexp_replace(new.nick, '[^A-Za-zА-Яа-яЁё0-9_. -]', '', 'g')), 24);
  if char_length(v) < 2 then
    if TG_OP = 'UPDATE' and public.is_client_session() then
      raise exception 'Ник: от 2 до 24 символов — буквы, цифры, пробел, _ . -';
    end if;
    v := 'user' || substr(replace(new.id::text, '-', ''), 1, 6);   -- при регистрации не роняем создание аккаунта
  end if;
  new.nick := v;
  return new;
end;
$$;

drop trigger if exists a1_profile_nick_sanitize on public.profiles;
create trigger a1_profile_nick_sanitize
  before insert or update of nick on public.profiles
  for each row execute function public.profile_nick_sanitize();

-- Разовая чистка уже сохранённого мусора (если кто-то успел записать)
update public.profiles
set avatar_url = null
where avatar_url is not null
  and avatar_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/[A-Za-z0-9_-]+/[A-Za-z0-9._~%+/-]+(\?t=[0-9]+)?$';
update public.profiles
set banner_url = null
where banner_url is not null
  and not (
    banner_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/[A-Za-z0-9_-]+/[A-Za-z0-9._~%+/-]+(\?t=[0-9]+)?$'
    or (banner_url ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$' and length(banner_url) <= 250000)
  );


-- ─────────────────────────────────────────────────────────────────
--  3. Личные сообщения: у чужого сообщения меняется только read_at
-- ─────────────────────────────────────────────────────────────────
create or replace function public.dm_only_read_at()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_session() then
    new.sender_id    := old.sender_id;
    new.recipient_id := old.recipient_id;
    new.text         := old.text;
    new.created_at   := old.created_at;
  end if;
  return new;
end;
$$;

do $$ begin
  if to_regclass('public.direct_messages') is not null then
    drop trigger if exists dm_only_read_at on public.direct_messages;
    create trigger dm_only_read_at
      before update on public.direct_messages
      for each row execute function public.dm_only_read_at();
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────
--  4. Форум: pinned/locked — только стафф; правка поста помечается
-- ─────────────────────────────────────────────────────────────────
create or replace function public.forum_threads_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_session() and not public.is_staff_user(auth.uid()) then
    new.pinned     := old.pinned;
    new.locked     := old.locked;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.forum_posts_guard()
returns trigger
language plpgsql
as $$
begin
  if public.is_client_session() then
    new.thread_id  := old.thread_id;
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
    if new.body is distinct from old.body then
      new.edited_at := now();       -- честная пометка «изменено», клиент её не подделает
    else
      new.edited_at := old.edited_at;
    end if;
  end if;
  return new;
end;
$$;

do $$ begin
  if to_regclass('public.forum_threads') is not null then
    drop trigger if exists forum_threads_guard on public.forum_threads;
    create trigger forum_threads_guard before update on public.forum_threads
      for each row execute function public.forum_threads_guard();
  end if;
  if to_regclass('public.forum_posts') is not null then
    drop trigger if exists forum_posts_guard on public.forum_posts;
    create trigger forum_posts_guard before update on public.forum_posts
      for each row execute function public.forum_posts_guard();
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────
--  5. Чат: серверный флуд-контроль
--     Зарегистрированные — не больше 15 сообщений за 30 сек, гости —
--     8 за 30 сек на один ник. Сервисные вставки не ограничиваются.
--     ВАЖНО: таблицы messages в репозитории нет, поэтому наличие колонки
--     created_at проверяется на лету, а любая внутренняя ошибка проверки
--     НЕ блокирует сообщение — лучше пропустить спамера, чем сломать чат.
--     Отказ приходит клиенту исключением; чат при ошибке вставки рисует
--     сообщение только у отправителя (существующее поведение) — для
--     спамера это выглядит как «шёл в пустоту», для остальных чат чист.
-- ─────────────────────────────────────────────────────────────────
create or replace function public.messages_flood_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_limit int;
  v_has_created boolean;
begin
  -- JWT-роль, а не current_user: функция SECURITY DEFINER (см. пояснение в vip-balance.sql)
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  begin
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'created_at'
    ) into v_has_created;

    if v_has_created then
      if new.user_id is not null then
        v_limit := 15;
        execute 'select count(*) from public.messages where user_id = $1 and created_at > now() - interval ''30 seconds'''
          into v_count using new.user_id;
      else
        v_limit := 8;
        execute 'select count(*) from public.messages where user_id is null and nick = $1 and created_at > now() - interval ''30 seconds'''
          into v_count using new.nick;
      end if;
    end if;
  exception when others then
    v_count := 0;   -- сбой самой проверки не должен ломать чат
  end;

  if v_count >= coalesce(v_limit, 1000) then
    raise exception 'Слишком часто — подожди несколько секунд';
  end if;
  return new;
end;
$$;

do $$ begin
  if to_regclass('public.messages') is not null then
    drop trigger if exists messages_flood_guard on public.messages;
    create trigger messages_flood_guard before insert on public.messages
      for each row execute function public.messages_flood_guard();
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────
--  6. ДОНАТЫ → VIP НА СЕРВЕРЕ
-- ─────────────────────────────────────────────────────────────────

-- 6.1 Токены DonationAlerts (только сервер: RLS включён, политик нет,
--     права у anon/authenticated отозваны; service_role RLS обходит)
create table if not exists public.integration_tokens (
  provider          text primary key,
  provider_user_id  text,
  access_token      text,
  access_expires_at timestamptz,
  refresh_token     text,
  updated_at        timestamptz not null default now()
);
alter table public.integration_tokens enable row level security;
revoke all on public.integration_tokens from anon, authenticated;

-- 6.2 Состояние синхронизации: замок (чтобы два запроса не работали
--     одновременно), диагностика и снимок последних донатов для публичного
--     «Топа донатеров» (посетителям больше не нужно входить в DonationAlerts)
create table if not exists public.vip_sync_state (
  id             int primary key default 1 check (id = 1),
  locked_until   timestamptz,
  last_run_at    timestamptz,
  last_ok_at     timestamptz,
  last_error     text,
  last_error_at  timestamptz,
  last_seen      int not null default 0,
  last_credited  int not null default 0,
  total_credited bigint not null default 0,
  snapshot       jsonb,
  snapshot_at    timestamptz
);
insert into public.vip_sync_state (id) values (1) on conflict (id) do nothing;
alter table public.vip_sync_state enable row level security;
revoke all on public.vip_sync_state from anon, authenticated;
grant select on public.vip_sync_state to authenticated;

-- Смотреть состояние (но не снимок с сообщениями — там только публичные поля,
-- а токены вообще в другой таблице) может только админ
drop policy if exists vip_sync_state_admin_read on public.vip_sync_state;
create policy vip_sync_state_admin_read on public.vip_sync_state
  for select to authenticated
  using (public.is_admin_user(auth.uid()));

-- 6.3 Замок: true — можно работать; false — уже кто-то работает/недавно работал
create or replace function public.try_lock_vip_sync(p_seconds int default 120)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  update public.vip_sync_state
  set locked_until = now() + make_interval(secs => p_seconds), last_run_at = now()
  where id = 1 and (locked_until is null or locked_until < now())
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

create or replace function public.finish_vip_sync(p_ok boolean, p_error text, p_seen int, p_credited int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.vip_sync_state set
    last_ok_at     = case when p_ok then now() else last_ok_at end,
    last_error     = case when p_ok then null else left(p_error, 300) end,
    last_error_at  = case when p_ok then last_error_at else now() end,
    last_seen      = coalesce(p_seen, 0),
    last_credited  = coalesce(p_credited, 0),
    total_credited = total_credited + coalesce(p_credited, 0)
  where id = 1;
$$;

create or replace function public.save_vip_snapshot(p_snapshot jsonb)
returns void
language sql
security definer
set search_path = public
as $$ update public.vip_sync_state set snapshot = p_snapshot, snapshot_at = now() where id = 1; $$;

-- 6.4 Начисление одного доната. АТОМАРНО: вся функция — одна транзакция,
--     поэтому при любой ошибке не остаётся «донат отмечен, а VIP не выдан».
--     Повторный вызов с тем же id безопасен (status = 'duplicate').
--     Вызывать могут: service_role (сервер), админ (с сайта), либо прямое
--     подключение к БД. Чужому пользователю функция откажет.
alter table public.profiles add column if not exists vip_pending_rub numeric not null default 0;

create or replace function public.credit_donation(
  p_id       bigint,
  p_username text,
  p_amount   numeric,
  p_currency text default 'RUB'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof      public.profiles%rowtype;
  v_claimed   int;
  v_pending   numeric;
  v_months    int;
  v_new_until timestamptz;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and not public.is_admin_user(auth.uid()) then
    raise exception 'Нет прав начислять донаты';
  end if;

  if p_id is null or p_amount is null or p_amount <= 0 or coalesce(btrim(p_username), '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Начисления идут строго по одному: транзакционный advisory-замок снимается
  -- сам в конце транзакции. Донатов единицы в минуту, а взамен исключены и
  -- двойное начисление, и взаимные блокировки при параллельных синхронизациях
  -- (сервер + админ на сайте одновременно).
  perform pg_advisory_xact_lock(hashtext('credit_donation'));

  -- «Занимаем» id доната: второй параллельный вызов с тем же id упрётся в
  -- primary key и вернёт duplicate — двойного начисления быть не может
  insert into public.vip_donation_log (donation_id, matched, donor_username, amount, currency)
  values (p_id, false, left(btrim(p_username), 64), p_amount, upper(coalesce(p_currency, 'RUB')))
  on conflict (donation_id) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if upper(coalesce(p_currency, 'RUB')) <> 'RUB' then
    return jsonb_build_object('status', 'unmatched', 'reason', 'currency');
  end if;

  -- Точное совпадение логина без учёта регистра. (Раньше в JS был ilike:
  -- символы % и _ в нике донатера работали как маски — «a_b» находило «axb»,
  -- а ник «%» совпадал с кем угодно.)
  select * into v_prof from public.profiles
  where lower(donate_login) = lower(btrim(p_username))
  limit 1
  for update;
  if not found then
    return jsonb_build_object('status', 'unmatched', 'reason', 'no_profile');
  end if;

  v_pending := coalesce(v_prof.vip_pending_rub, 0) + p_amount;
  v_months  := floor(v_pending / 100)::int;      -- 100 ₽ = 1 месяц

  v_new_until := v_prof.vip_until;
  if v_months >= 1 then
    if v_prof.is_vip is true and v_prof.vip_until is null then
      v_new_until := null;   -- бессрочный VIP остаётся бессрочным (раньше превращался в срочный)
    else
      v_new_until := (case when v_prof.is_vip is true and v_prof.vip_until > now() then v_prof.vip_until else now() end)
                     + make_interval(months => v_months);
    end if;
  end if;

  update public.profiles set
    total_donated   = coalesce(total_donated, 0) + p_amount,
    vip_pending_rub = v_pending - v_months * 100,
    is_vip          = case when v_months >= 1 then true else is_vip end,
    vip_until       = case when v_months >= 1 then v_new_until else vip_until end
  where id = v_prof.id;

  update public.vip_donation_log
  set matched = true, profile_id = v_prof.id, months_granted = v_months
  where donation_id = p_id;

  return jsonb_build_object('status', 'credited', 'months', v_months, 'nick', v_prof.nick);
end;
$$;

revoke all on function public.credit_donation(bigint, text, numeric, text) from public, anon;
grant execute on function public.credit_donation(bigint, text, numeric, text) to authenticated, service_role;

revoke all on function public.try_lock_vip_sync(int) from public, anon, authenticated;
revoke all on function public.finish_vip_sync(boolean, text, int, int) from public, anon, authenticated;
revoke all on function public.save_vip_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.try_lock_vip_sync(int) to service_role;
grant execute on function public.finish_vip_sync(boolean, text, int, int) to service_role;
grant execute on function public.save_vip_snapshot(jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────
--  7. ДОСТОВЕРНЫЙ ПРОГРЕСС ЦЕЛИ ДОНАТА
-- ─────────────────────────────────────────────────────────────────
-- БАГ (найден и исправлен): "собрано" на шкале цели считалось на клиенте
-- как сумма ПОСЛЕДНИХ ≤20 донатов из /api/donations — это не «сколько
-- собрано на цель», а «сколько в последних 20 алертах». Как только донатов
-- становится больше 20, сумма перестаёт расти и даже падает: старые донаты
-- вымываются из окна новыми. vip_donation_log — постоянный (не «последние N»)
-- журнал ВСЕХ донатов, что видел api/vip-sync.js, поэтому используем его.
--
-- donated_at — время самого доната (из DonationAlerts), а не время, когда
-- наш сервер его увидел (processed_at). Для старых строк, начисленных до
-- этой миграции, donated_at будет NULL — goal_progress() в этом случае
-- подстрахуется processed_at (см. coalesce ниже).
alter table public.vip_donation_log
  add column if not exists donated_at timestamptz;

-- Меняем набор параметров — старую 4-параметрную версию явно убираем,
-- чтобы в базе не осталось двух перегрузок credit_donation с похожим кодом.
drop function if exists public.credit_donation(bigint, text, numeric, text);

create or replace function public.credit_donation(
  p_id         bigint,
  p_username   text,
  p_amount     numeric,
  p_currency   text default 'RUB',
  p_donated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof      public.profiles%rowtype;
  v_claimed   int;
  v_pending   numeric;
  v_months    int;
  v_new_until timestamptz;
begin
  if coalesce(auth.role(), '') not in ('', 'service_role') and not public.is_admin_user(auth.uid()) then
    raise exception 'Нет прав начислять донаты';
  end if;

  if p_id is null or p_amount is null or p_amount <= 0 or coalesce(btrim(p_username), '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;

  perform pg_advisory_xact_lock(hashtext('credit_donation'));

  insert into public.vip_donation_log (donation_id, matched, donor_username, amount, currency, donated_at)
  values (p_id, false, left(btrim(p_username), 64), p_amount, upper(coalesce(p_currency, 'RUB')), coalesce(p_donated_at, now()))
  on conflict (donation_id) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if upper(coalesce(p_currency, 'RUB')) <> 'RUB' then
    return jsonb_build_object('status', 'unmatched', 'reason', 'currency');
  end if;

  select * into v_prof from public.profiles
  where lower(donate_login) = lower(btrim(p_username))
  limit 1
  for update;
  if not found then
    return jsonb_build_object('status', 'unmatched', 'reason', 'no_profile');
  end if;

  v_pending := coalesce(v_prof.vip_pending_rub, 0) + p_amount;
  v_months  := floor(v_pending / 100)::int;

  v_new_until := v_prof.vip_until;
  if v_months >= 1 then
    if v_prof.is_vip is true and v_prof.vip_until is null then
      v_new_until := null;
    else
      v_new_until := (case when v_prof.is_vip is true and v_prof.vip_until > now() then v_prof.vip_until else now() end)
                     + make_interval(months => v_months);
    end if;
  end if;

  update public.profiles set
    total_donated   = coalesce(total_donated, 0) + p_amount,
    vip_pending_rub = v_pending - v_months * 100,
    is_vip          = case when v_months >= 1 then true else is_vip end,
    vip_until       = case when v_months >= 1 then v_new_until else vip_until end
  where id = v_prof.id;

  update public.vip_donation_log
  set matched = true, profile_id = v_prof.id, months_granted = v_months
  where donation_id = p_id;

  return jsonb_build_object('status', 'credited', 'months', v_months, 'nick', v_prof.nick);
end;
$$;

revoke all on function public.credit_donation(bigint, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.credit_donation(bigint, text, numeric, text, timestamptz) to authenticated, service_role;

-- Сумма всех донатов (в рублях) с даты p_since — источник правды для шкалы
-- цели. По умолчанию (без даты) считает вообще всю историю в логе.
-- Публичный доступ не даём: единственный, кто просит эту цифру, — сервер
-- (api/donations.js, под сервисным ключом), браузер к Supabase напрямую не
-- ходит за донатами — так было задумано с самого начала (см. api/donations.js).
create or replace function public.goal_progress(p_since timestamptz default '2000-01-01'::timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'raised', coalesce(sum(amount) filter (where currency = 'RUB' and coalesce(donated_at, processed_at) >= p_since), 0),
    'count',  count(*) filter (where currency = 'RUB' and coalesce(donated_at, processed_at) >= p_since),
    'since',  p_since
  )
  from public.vip_donation_log;
$$;
revoke all on function public.goal_progress(timestamptz) from public, anon, authenticated;
grant execute on function public.goal_progress(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────────
--  8. ПОЛНЫЙ РАЗОВЫЙ ИМПОРТ ВСЕЙ ИСТОРИИ ДОНАТОВ
-- ─────────────────────────────────────────────────────────────────
-- Обычная синхронизация (api/vip-sync.js, автопинг раз в 5 минут + cron раз
-- в сутки) намеренно смотрит только на последние 14 дней и максимум 8
-- страниц — она лёгкая и обязана укладываться в секунды. Если у канала
-- донатов больше, чем помещается в эти 8 страниц за 14 дней, часть истории
-- эта синхронизация в принципе никогда не увидит — не баг, так и задумано
-- для быстрого регулярного прогона.
--
-- Для ЧЕСТНОЙ суммы «собрано с даты X», если эта дата раньше, чем сайт начал
-- синхронизацию, нужен отдельный ПОЛНЫЙ проход по всей истории
-- DonationAlerts — потенциально сотни страниц, что не влезает в один вызов
-- serverless-функции (лимит 30 сек, см. vercel.json). Поэтому импорт
-- возобновляемый: сохраняет курсор (`links.next` от DonationAlerts) в
-- vip_sync_state и продолжает с того же места при следующем вызове —
-- админ жмёт кнопку в настройках сайта, она сама дозывается, пока не
-- дойдёт до конца.
alter table public.vip_sync_state
  add column if not exists backfill_cursor      text,
  add column if not exists backfill_done         boolean not null default false,
  add column if not exists backfill_started_at   timestamptz,
  add column if not exists backfill_pages        int not null default 0,
  add column if not exists backfill_imported      int not null default 0,
  add column if not exists backfill_error        text;

-- Отдельный (более долгий) замок для импорта — чтобы обычный 5-минутный
-- автопинг не путался под ногами, пока идёт разовый проход по истории, но
-- сам импорт можно спокойно продолжать кликами подряд.
create or replace function public.try_lock_backfill(p_seconds int default 25)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_now timestamptz := now(); v_locked_until timestamptz;
begin
  select locked_until into v_locked_until from public.vip_sync_state where id = 1 for update;
  if v_locked_until is not null and v_locked_until > v_now then
    return false;
  end if;
  update public.vip_sync_state set locked_until = v_now + make_interval(secs => p_seconds) where id = 1;
  return true;
end;
$$;
revoke all on function public.try_lock_backfill(int) from public, anon, authenticated;
grant execute on function public.try_lock_backfill(int) to service_role;

-- Двигает курсор импорта вперёд одним запросом (без отдельного read+update
-- из JS — меньше шансов гонки между параллельными кликами администратора).
create or replace function public.advance_backfill(
  p_cursor   text,
  p_done     boolean,
  p_pages    int,
  p_imported int,
  p_error    text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.vip_sync_state set
    backfill_cursor    = p_cursor,
    backfill_done       = p_done,
    backfill_started_at = coalesce(backfill_started_at, now()),
    backfill_pages      = backfill_pages + p_pages,
    backfill_imported   = backfill_imported + p_imported,
    backfill_error      = p_error,
    locked_until         = null
  where id = 1;
$$;
revoke all on function public.advance_backfill(text, boolean, int, int, text) from public, anon, authenticated;
grant execute on function public.advance_backfill(text, boolean, int, int, text) to service_role;

-- Позволяет начать заново (если что-то пошло не так или дата "считать с"
-- поменялась и стоит перепройти историю ещё раз).
create or replace function public.reset_backfill()
returns void
language sql
security definer
set search_path = public
as $$
  update public.vip_sync_state set
    backfill_cursor = null, backfill_done = false, backfill_started_at = null,
    backfill_pages = 0, backfill_imported = 0, backfill_error = null
  where id = 1;
$$;
revoke all on function public.reset_backfill() from public, anon, authenticated;
grant execute on function public.reset_backfill() to service_role;

-- 6.5 Проверка (необязательно):


-- select * from public.vip_sync_state;
-- select * from public.vip_donation_log order by processed_at desc limit 20;

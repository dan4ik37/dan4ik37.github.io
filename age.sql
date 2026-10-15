-- ═══════════════════════════════════════════════════════════════════
--  🎂 ВОЗРАСТ — год рождения (тайна), группы по возрасту и правила по возрасту (клиент — js/core/age.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно). Запускать ПОСЛЕ premium.sql:
--  здесь premium_state и premium_order_create — те же, что в premium.sql, плюс ветка возраста (в premium.sql она тоже есть,
--  поэтому перезапуск любого из двух файлов её не теряет).
--  Нужны: profiles, premium.sql. Есть ugc.sql / unity.sql — метки игр игроков (нет таблиц — шаг пропускается).
--
--  Что хранится: user_age — ТОЛЬКО год рождения (не дата) + служебное: когда указал, когда менял, «остывание». Читает только
--  сам человек (RLS); ни в profiles / profiles_public, ни модераторам, ни админу, ни в каких списках и выгрузках. Пишут — только
--  функции ниже. Удалил аккаунт — строка удаляется (on delete cascade).
--  Группы (возраст «не меньше»: год сейчас по МСК − год рождения − 1): child — до 13, teen — 13–15, teen16 — 16–17, adult — 18+,
--  unknown — не указан.
--  Смена года: первые 24 ч после первого раза — исправить опечатку; дальше — не больше 2 смен за 30 дней (стереть — тоже смена,
--  но стереть можно всегда). Стал «старше» (кроме опечатки) или стёр год — 30 дней действуют правила прежней группы (floor_*):
--  ребёнок не обойдёт лимиты магазина и 18+, перевыбрав год. Сам год при этом уже не хранится.
--  Правила на сервере — через age_group_of() (только функциям сервера; клиенту не дана):
--   • магазин 💎 (premium_order_create): child — оплата картой выключена (покупает взрослый: подарок VIP по нику, донат);
--     teen — до 1000 ₽ в сутки и 3000 ₽ за 30 дней, teen16 — 2000 / 6000 (premium_settings.teen_*, меняются там же);
--     adult и unknown — как раньше (3000 / 10000). Галочка «платит взрослый / разрешил» — у всех, как раньше;
--   • стал ребёнком — заявки в друзья «ни от кого» (privacy_friend_requests = 'nobody'; поменять можно в профиле; исправил
--     опечатку в первые сутки — вернём, как было). Личные сообщения — только друзьям у всех (friends-dm.sql).
--  Метки игр игроков: ugc_games.age_rating, unity_games.age_rating (0, 6, 12, 16, 18; по умолчанию 12). Автор выбирает до 16+,
--  модератор — любую (и 18+); поставил модератор — автор может только поднять.
--  Проверка после запуска: /rpc/my_age_group гостем → {"ok":false,"reason":"auth"} (PGRST202 = не применён).
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Год рождения ═══
create table if not exists public.user_age (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_year smallint,
  created_at timestamptz not null default now()
);
alter table public.user_age add column if not exists first_at timestamptz;                       -- когда указал впервые
alter table public.user_age add column if not exists set_at timestamptz;                         -- когда менял в последний раз
alter table public.user_age add column if not exists changes timestamptz[] not null default '{}'; -- смены за 30 дней (лимит 2)
alter table public.user_age add column if not exists floor_group text;                           -- «остывание»: группа…
alter table public.user_age add column if not exists floor_until timestamptz;                    -- …и до когда
alter table public.user_age add column if not exists kid_at timestamptz;                         -- когда включили детские настройки
alter table public.user_age add column if not exists kid_prev text;                              -- заявки в друзья до них
do $$ begin
  alter table public.user_age add constraint user_age_year check (birth_year is null or birth_year between 1900 and 2100);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.user_age add constraint user_age_floor check (floor_group is null or floor_group in ('child', 'teen', 'teen16'));
exception when duplicate_object then null; end $$;
alter table public.user_age enable row level security;
revoke all on public.user_age from anon, authenticated;
grant select on public.user_age to authenticated;
drop policy if exists "Свой возраст видит только сам" on public.user_age;
create policy "Свой возраст видит только сам" on public.user_age for select to authenticated using (auth.uid() = user_id);

-- ── Служебные (клиенту не даны) ──
create or replace function public.age_year_now() returns int language sql stable as $$
  select extract(year from (now() at time zone 'Europe/Moscow'))::int
$$;
create or replace function public.age_rank(g text) returns int language sql immutable as $$
  select case g when 'child' then 0 when 'teen' then 1 when 'teen16' then 2 when 'adult' then 3 else 9 end
$$;
-- Группа по году рождения (возраст «не меньше»)
create or replace function public.age_group_year(y int) returns text language sql stable as $$
  select case when y is null then 'unknown'
    when public.age_year_now() - y - 1 < 13 then 'child'
    when public.age_year_now() - y - 1 < 16 then 'teen'
    when public.age_year_now() - y - 1 < 18 then 'teen16'
    else 'adult' end
$$;
-- Группа человека для правил сервера: год + «остывание» (берётся младшая)
create or replace function public.age_group_of(p_uid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.user_age%rowtype; g text;
begin
  if p_uid is null then return 'unknown'; end if;
  select * into r from public.user_age where user_id = p_uid;
  if not found then return 'unknown'; end if;
  g := public.age_group_year(r.birth_year);
  if r.floor_group is not null and r.floor_until > now()
     and (g = 'unknown' or public.age_rank(r.floor_group) < public.age_rank(g)) then
    g := r.floor_group;
  end if;
  return g;
end $$;
-- Ответ клиенту про СЕБЯ: год, группа, «остывание», сколько смен осталось
create or replace function public.age_state(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.user_age%rowtype; recent timestamptz[]; v_floor boolean; n int;
begin
  select * into r from public.user_age where user_id = p_uid;
  if not found then return jsonb_build_object('ok', true, 'year', null, 'group', 'unknown', 'changes_left', 2); end if;
  recent := array(select t from unnest(r.changes) t where t > now() - interval '30 days' order by t);
  n := coalesce(array_length(recent, 1), 0);
  v_floor := r.floor_group is not null and r.floor_until > now();
  return jsonb_build_object('ok', true, 'year', r.birth_year, 'group', public.age_group_of(p_uid), 'first_at', r.first_at,
    'floor_group', case when v_floor then r.floor_group end, 'floor_until', case when v_floor then r.floor_until end,
    'changes_left', greatest(0, 2 - n), 'next_at', case when n >= 2 then recent[1] + interval '30 days' end);
end $$;
-- Детские настройки: стал ребёнком — заявки в друзья «ни от кого» (один раз); опечатка в первые сутки — вернуть, как было
create or replace function public.age_kid_defaults(p_uid uuid, p_typo boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.user_age%rowtype; v_prev text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'privacy_friend_requests') then
    return false;
  end if;
  select * into r from public.user_age where user_id = p_uid for update;
  if not found then return false; end if;
  if public.age_group_of(p_uid) = 'child' then
    if r.kid_at is not null then return false; end if;
    execute 'select privacy_friend_requests from public.profiles where id = $1' into v_prev using p_uid;
    update public.user_age set kid_at = now(), kid_prev = v_prev where user_id = p_uid;
    execute 'update public.profiles set privacy_friend_requests = ''nobody'' where id = $1' using p_uid;
    return true;
  end if;
  if r.kid_at is not null and p_typo and r.kid_at > now() - interval '24 hours' then
    execute 'update public.profiles set privacy_friend_requests = $2 where id = $1' using p_uid, coalesce(r.kid_prev, 'all');
    update public.user_age set kid_at = null, kid_prev = null where user_id = p_uid;
  end if;
  return false;
end $$;

-- ── Для сайта ──
-- Свой возраст (только себе)
create or replace function public.my_age_group() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return public.age_state(auth.uid());
end $$;

-- Указать / сменить год. → состояние (как my_age_group) + kid_defaults: true — включили детские настройки.
-- Ошибки: auth, year (вне 3…100 лет), rate (2 смены за 30 дней уже были; next_at — когда можно снова)
create or replace function public.age_set(p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); y int := public.age_year_now(); r public.user_age%rowtype;
  v_old text; v_new text; v_first boolean; v_typo boolean; v_up boolean; recent timestamptz[]; v_kid boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_year is null or p_year < y - 100 or p_year > y - 3 then return jsonb_build_object('ok', false, 'reason', 'year'); end if;
  insert into public.user_age (user_id) values (uid) on conflict (user_id) do nothing;
  select * into r from public.user_age where user_id = uid for update;
  if r.birth_year = p_year then return public.age_state(uid) || jsonb_build_object('same', true); end if;
  v_old := public.age_group_of(uid);
  v_first := r.birth_year is null and r.first_at is null;
  v_typo := r.first_at is not null and r.first_at > now() - interval '24 hours';
  recent := array(select t from unnest(r.changes) t where t > now() - interval '30 days' order by t);
  if not v_first then
    if coalesce(array_length(recent, 1), 0) >= 2 then
      return jsonb_build_object('ok', false, 'reason', 'rate', 'next_at', recent[1] + interval '30 days');
    end if;
    recent := recent || now();
  end if;
  v_new := public.age_group_year(p_year);
  -- стал «старше» (не опечатка в первые сутки) — 30 дней правила прежней группы
  v_up := v_old in ('child', 'teen', 'teen16') and public.age_rank(v_new) > public.age_rank(v_old) and not v_typo;
  update public.user_age set birth_year = p_year, first_at = coalesce(first_at, now()), set_at = now(), changes = recent,
    floor_group = case when v_up then v_old else floor_group end,
    floor_until = case when v_up then now() + interval '30 days' else floor_until end
    where user_id = uid;
  v_kid := public.age_kid_defaults(uid, v_typo);
  return public.age_state(uid) || jsonb_build_object('kid_defaults', v_kid);
end $$;

-- Стереть год (можно всегда). Был ребёнком/подростком (не опечатка) — 30 дней правила той группы
create or replace function public.age_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.user_age%rowtype; v_old text; v_typo boolean; v_floor boolean; recent timestamptz[];
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into r from public.user_age where user_id = uid for update;
  if not found or r.birth_year is null then return public.age_state(uid); end if;
  v_old := public.age_group_of(uid);
  v_typo := r.first_at is not null and r.first_at > now() - interval '24 hours';
  v_floor := v_old in ('child', 'teen', 'teen16') and not v_typo;
  recent := array(select t from unnest(r.changes) t where t > now() - interval '30 days' order by t) || now();
  update public.user_age set birth_year = null, set_at = now(), changes = recent,
    floor_group = case when v_floor then v_old else floor_group end,
    floor_until = case when v_floor then now() + interval '30 days' else floor_until end
    where user_id = uid;
  perform public.age_kid_defaults(uid, v_typo);
  return public.age_state(uid);
end $$;

revoke execute on function public.age_year_now() from public, anon, authenticated;
revoke execute on function public.age_rank(text) from public, anon, authenticated;
revoke execute on function public.age_group_year(int) from public, anon, authenticated;
revoke execute on function public.age_group_of(uuid) from public, anon, authenticated;
revoke execute on function public.age_state(uuid) from public, anon, authenticated;
revoke execute on function public.age_kid_defaults(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.my_age_group() from public;
revoke execute on function public.age_set(int) from public, anon;
revoke execute on function public.age_clear() from public, anon;
grant execute on function public.my_age_group() to anon, authenticated;
grant execute on function public.age_set(int) to authenticated;
grant execute on function public.age_clear() to authenticated;

-- ═══ 2. Метки игр и 3D-миров игроков (Студия игр, Студия 3D, Unity-игры) ═══
do $$ begin
  if to_regclass('public.ugc_games') is not null then
    alter table public.ugc_games add column if not exists age_rating smallint not null default 12;
    alter table public.ugc_games add column if not exists age_mod boolean not null default false;   -- метку поставил модератор
    begin
      alter table public.ugc_games add constraint ugc_games_age check (age_rating in (0, 6, 12, 16, 18));
    exception when duplicate_object then null; end;
  end if;
  if to_regclass('public.unity_games') is not null then
    alter table public.unity_games add column if not exists age_rating smallint not null default 12;
    alter table public.unity_games add column if not exists age_mod boolean not null default false;
    begin
      alter table public.unity_games add constraint unity_games_age check (age_rating in (0, 6, 12, 16, 18));
    exception when duplicate_object then null; end;
  end if;
end $$;

-- Метка игры: автор — 0/6/12/16 (после модератора — только выше), модератор/админ — любая. p_kind: 'ugc' | 'unity'
create or replace function public.age_set_rating(p_kind text, p_id text, p_age int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_tab text; v_author uuid; v_age int; v_mod boolean; v_staff boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_age is null or p_age not in (0, 6, 12, 16, 18) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  v_tab := case p_kind when 'ugc' then 'ugc_games' when 'unity' then 'unity_games' end;
  if v_tab is null or to_regclass('public.' || v_tab) is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  execute format('select author, age_rating, age_mod from public.%I where id = $1 for update', v_tab) into v_author, v_age, v_mod using p_id;
  if v_author is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_staff := exists (select 1 from public.profiles where id = uid and role in ('admin', 'moderator'));
  if v_staff then
    execute format('update public.%I set age_rating = $2, age_mod = true where id = $1', v_tab) using p_id, p_age;
    return jsonb_build_object('ok', true, 'age', p_age, 'mod', true);
  end if;
  if v_author <> uid then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_age > 16 then return jsonb_build_object('ok', false, 'reason', 'age18'); end if;
  if v_mod and p_age < v_age then return jsonb_build_object('ok', false, 'reason', 'mod', 'age', v_age); end if;
  execute format('update public.%I set age_rating = $2 where id = $1', v_tab) using p_id, p_age;
  return jsonb_build_object('ok', true, 'age', p_age);
end $$;
revoke execute on function public.age_set_rating(text, text, int) from public, anon;
grant execute on function public.age_set_rating(text, text, int) to authenticated;

-- ═══ 3. Магазин 💎 по возрасту ═══
alter table public.premium_settings add column if not exists teen_day_rub int not null default 1000;      -- 13–15 лет: в сутки
alter table public.premium_settings add column if not exists teen_month_rub int not null default 3000;    -- и за 30 дней
alter table public.premium_settings add column if not exists teen16_day_rub int not null default 2000;    -- 16–17 лет
alter table public.premium_settings add column if not exists teen16_month_rub int not null default 6000;

-- Лимиты покупок картой по возрасту: { cards — можно ли картой, day_rub, month_rub } (не больше общих лимитов магазина)
create or replace function public.age_shop_caps(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g text := public.age_group_of(p_uid); s public.premium_settings%rowtype;
begin
  select * into s from public.premium_settings where id = 1;
  return case g
    when 'child' then jsonb_build_object('cards', false, 'day_rub', 0, 'month_rub', 0)
    when 'teen' then jsonb_build_object('cards', true, 'day_rub', least(s.day_rub, s.teen_day_rub), 'month_rub', least(s.month_rub, s.teen_month_rub))
    when 'teen16' then jsonb_build_object('cards', true, 'day_rub', least(s.day_rub, s.teen16_day_rub), 'month_rub', least(s.month_rub, s.teen16_month_rub))
    else jsonb_build_object('cards', true, 'day_rub', s.day_rub, 'month_rub', s.month_rub) end;
end $$;
revoke execute on function public.age_shop_caps(uuid) from public, anon, authenticated;

-- ↓↓↓ Тексты двух функций ниже — ровно как в premium.sql (тест PGlite сверяет); меняешь — меняй в обоих файлах ↓↓↓
-- Состояние: баланс, режим доната, пакеты и товары, лимиты, история. Гостю — только витрина.
-- Возраст (age.sql → age_shop_caps): 13–17 лет — свои лимиты, до 13 — cards: false (картой нельзя). Нет age.sql — как раньше
create or replace function public.premium_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); w public.premium_wallet%rowtype; s public.premium_settings%rowtype;
  v_day numeric; v_month numeric; v_pending numeric; v_caps jsonb;
begin
  select * into s from public.premium_settings where id = 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth', 'packs', public.premium_packs(), 'items', public.premium_items(),
      'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open);
  end if;
  select * into w from public.premium_wallet where user_id = uid;
  select coalesce(sum(rub) filter (where created_at > now() - interval '1 day'), 0), coalesce(sum(rub), 0)
    into v_day, v_month from public.premium_orders
    where user_id = uid and status in ('paid', 'refunded') and created_at > now() - interval '30 days';
  select coalesce(vip_pending_rub, 0) into v_pending from public.profiles where id = uid;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using uid;
  end if;
  return jsonb_build_object('ok', true,
    'balance', coalesce(w.balance, 0), 'debt', coalesce(w.debt, 0), 'mode', coalesce(w.donate_mode, 'vip'),
    'consent', w.consent_at is not null, 'pending_rub', floor(coalesce(v_pending, 0)),
    'rate', s.donate_rate, 'bonus', s.donate_bonus, 'open', s.shop_open,
    'limits', jsonb_build_object('day_rub', coalesce((v_caps->>'day_rub')::int, s.day_rub), 'month_rub', coalesce((v_caps->>'month_rub')::int, s.month_rub),
      'used_day', v_day, 'used_month', v_month),
    'cards', coalesce((v_caps->>'cards')::boolean, true),
    'packs', public.premium_packs(), 'items', public.premium_items(),
    'history', coalesce((select jsonb_agg(h order by h.id desc) from (
        select id, amount, balance, kind, ref, note, created_at from public.premium_ledger
        where user_id = uid order by id desc limit 30) h), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(o order by o.created_at desc) from (
        select id, pack, gems, amount, currency, provider, status, test, created_at, paid_at from public.premium_orders
        where user_id = uid order by created_at desc limit 10) o), '[]'::jsonb));
end; $$;
grant execute on function public.premium_state() to anon, authenticated;

-- Заказ: пакет, провайдер, валюта; согласие взрослого; возраст (age.sql → age_shop_caps: до 13 — картой нельзя, 13–17 —
-- свои лимиты); лимиты (в рублях: сутки и 30 дней); не больше 10 неоплаченных за час
create or replace function public.premium_order_create(p_user uuid, p_pack text, p_provider text,
  p_currency text default 'KZT', p_consent boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pk jsonb := public.premium_pack(p_pack); s public.premium_settings%rowtype; v_amount numeric; v_rub int;
  v_day numeric; v_month numeric; v_id text; v_cur text := upper(coalesce(p_currency, 'KZT'));
  v_caps jsonb; v_day_cap int; v_month_cap int;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if pk is null then return jsonb_build_object('ok', false, 'reason', 'pack'); end if;
  if p_provider not in ('tiptop', 'freedom', 'kaspi') then return jsonb_build_object('ok', false, 'reason', 'provider'); end if;
  if v_cur not in ('KZT', 'RUB') then return jsonb_build_object('ok', false, 'reason', 'currency'); end if;
  if p_consent is not true then return jsonb_build_object('ok', false, 'reason', 'consent'); end if;
  if to_regprocedure('public.age_shop_caps(uuid)') is not null then
    execute 'select public.age_shop_caps($1)' into v_caps using p_user;
  end if;
  if not coalesce((v_caps->>'cards')::boolean, true) then return jsonb_build_object('ok', false, 'reason', 'age_child'); end if;
  select * into s from public.premium_settings where id = 1;
  v_day_cap := coalesce((v_caps->>'day_rub')::int, s.day_rub);
  v_month_cap := coalesce((v_caps->>'month_rub')::int, s.month_rub);
  v_amount := case v_cur when 'KZT' then (pk->>'kzt')::numeric else (pk->>'rub')::numeric end;
  v_rub := (pk->>'rub')::int;
  -- Один человек — по очереди (два заказа в одну секунду не обойдут лимит)
  perform pg_advisory_xact_lock(hashtext('premium_order:' || p_user::text));
  select coalesce(sum(rub) filter (where created_at > now() - interval '1 day'), 0), coalesce(sum(rub), 0)
    into v_day, v_month from public.premium_orders
    where user_id = p_user and status in ('paid', 'refunded') and created_at > now() - interval '30 days';
  if v_day + v_rub > v_day_cap then
    return jsonb_build_object('ok', false, 'reason', 'limit_day', 'left', greatest(0, v_day_cap - v_day));
  end if;
  if v_month + v_rub > v_month_cap then
    return jsonb_build_object('ok', false, 'reason', 'limit_month', 'left', greatest(0, v_month_cap - v_month));
  end if;
  if (select count(*) from public.premium_orders where user_id = p_user and status = 'new' and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  v_id := 'D37-' || to_char(now() at time zone 'Asia/Almaty', 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.premium_wallet (user_id) values (p_user) on conflict (user_id) do nothing;
  update public.premium_wallet set consent_at = coalesce(consent_at, now()) where user_id = p_user;
  insert into public.premium_orders (id, user_id, pack, gems, amount, currency, rub, provider, consent)
    values (v_id, p_user, p_pack, (pk->>'gems')::int, v_amount, v_cur, v_rub, p_provider, true);
  return jsonb_build_object('ok', true, 'order', v_id, 'pack', p_pack, 'gems', (pk->>'gems')::int,
    'amount', v_amount, 'currency', v_cur, 'user', p_user);
end; $$;
revoke execute on function public.premium_order_create(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.premium_order_create(uuid, text, text, text, boolean) to service_role;
-- ↑↑↑ конец функций, общих с premium.sql ↑↑↑

-- Проверить руками (SQL Editor):
-- select public.age_group_of('<uuid>');   select * from public.premium_settings;

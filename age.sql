-- ═══════════════════════════════════════════════════════════════════
--  🎂 ВОЗРАСТ — год рождения (тайна), группы по возрасту и правила по возрасту (клиент — js/core/age.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно). Запускать ПОСЛЕ premium.sql
--  (лимиты магазина по возрасту — age_shop_caps; сами функции магазина — только в premium.sql, с 22.10.2026).
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
--   • безопасность детей (часть 4, docs/REALMS.md «лёгкий вариант», 22.10.2026; выключатель site_config 'kidsafe' = 'off'):
--     ребёнок до 13 ↔ взрослый или «возраст не указан» — ни ЛС, ни звонков, ни заявок в друзья, ни приглашений (kid_pair_ok);
--     до 9 лет (age_u9) — общий чат и сообщества только читать и реакции, ЛС и звонков нет. Сами запреты — в community.sql
--     (триггеры ЛС и дружбы, чат, звонки); ники детей на публичных страницах сайта — «Игрок» (age_public_kids — только серверу).
--  Метки игр игроков: ugc_games.age_rating, unity_games.age_rating (0, 6, 12, 16, 18; по умолчанию 12). Автор выбирает до 16+,
--  модератор — любую (и 18+); поставил модератор — автор может только поднять.
--  Проверка после запуска: /rpc/my_age_group гостем → {"ok":false,"reason":"auth"} (PGRST202 = не применён);
--  /rpc/kid_contact гостем {"p_ids":[]} → {"ok":false,"reason":"auth"}; /rpc/age_public_kids гостем → 401 (только серверу сайта).
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
alter table public.user_age add column if not exists u9_until timestamptz;                       -- был «до 9 лет» и сменил / стёр год — до когда ещё «до 9»
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
-- ── Безопасность детей (часть 4) — служебные ──
-- Выключатель site_config 'kidsafe': нет строки или 'on' — включено; 'off' — как было до 22.10.2026. Одной строкой в SQL Editor:
--   insert into public.site_config (key, value) values ('kidsafe', 'off') on conflict (key) do update set value = excluded.value;
create or replace function public.kidsafe_on() returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  if to_regclass('public.site_config') is null then return true; end if;
  select value into v from public.site_config where key = 'kidsafe';
  return lower(btrim(coalesce(v, ''), '" ')) is distinct from 'off';
end $$;
-- До 9 лет (возраст «не меньше», как у групп); сменил или стёр год, когда был «до 9», — ещё 30 дней «до 9» (u9_until)
create or replace function public.age_u9(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (a.birth_year is not null and public.age_year_now() - a.birth_year - 1 < 9) or coalesce(a.u9_until > now(), false)
    from public.user_age a where a.user_id = p_uid), false)
$$;
-- Можно ли лично (ЛС, звонок, заявка в друзья, приглашение в игру): ребёнок до 13 ↔ взрослый или «возраст не указан» — нет
create or replace function public.kid_pair_ok(a uuid, b uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare ga text; gb text;
begin
  if a is null or b is null or a = b or not public.kidsafe_on() then return true; end if;
  ga := public.age_group_of(a);
  if ga not in ('child', 'adult', 'unknown') then return true; end if;   -- подросток — со всеми, как раньше
  gb := public.age_group_of(b);
  return not ((ga = 'child' and gb in ('adult', 'unknown')) or (gb = 'child' and ga in ('adult', 'unknown')));
end $$;
-- Почему мне (p_me) нельзя лично с p_other — для текста ошибки ТОМУ, КТО ПИШЕТ (возраст другого не раскрываем):
-- 'u9' — мне меньше 9 (только ЛС и звонки, p_dm), 'age' — я ребёнок, а он взрослый / без возраста, 'no' — нельзя по другой стороне
-- (он ребёнок или ему меньше 9), null — можно
create or replace function public.kid_why(p_me uuid, p_other uuid, p_dm boolean) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if p_me is null or p_other is null or p_me = p_other or not public.kidsafe_on() then return null; end if;
  if p_dm and public.age_u9(p_me) then return 'u9'; end if;
  if not public.kid_pair_ok(p_me, p_other) then return case when public.age_group_of(p_me) = 'child' then 'age' else 'no' end; end if;
  if p_dm and public.age_u9(p_other) then return 'no'; end if;
  return null;
end $$;
-- Ответ клиенту про СЕБЯ: год, группа, «остывание», сколько смен осталось; u9 — «до 9 лет» (свой), kidsafe — выключатель
create or replace function public.age_state(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.user_age%rowtype; recent timestamptz[]; v_floor boolean; n int; v_ks boolean := public.kidsafe_on();
begin
  select * into r from public.user_age where user_id = p_uid;
  if not found then return jsonb_build_object('ok', true, 'year', null, 'group', 'unknown', 'changes_left', 2, 'u9', false, 'kidsafe', v_ks); end if;
  recent := array(select t from unnest(r.changes) t where t > now() - interval '30 days' order by t);
  n := coalesce(array_length(recent, 1), 0);
  v_floor := r.floor_group is not null and r.floor_until > now();
  return jsonb_build_object('ok', true, 'year', r.birth_year, 'group', public.age_group_of(p_uid), 'first_at', r.first_at,
    'floor_group', case when v_floor then r.floor_group end, 'floor_until', case when v_floor then r.floor_until end,
    'changes_left', greatest(0, 2 - n), 'next_at', case when n >= 2 then recent[1] + interval '30 days' end,
    'u9', public.age_u9(p_uid), 'u9_until', case when r.u9_until > now() then r.u9_until end, 'kidsafe', v_ks);
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
  v_old text; v_new text; v_first boolean; v_typo boolean; v_up boolean; recent timestamptz[]; v_kid boolean; v_u9 boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_year is null or p_year < y - 100 or p_year > y - 3 then return jsonb_build_object('ok', false, 'reason', 'year'); end if;
  insert into public.user_age (user_id) values (uid) on conflict (user_id) do nothing;
  select * into r from public.user_age where user_id = uid for update;
  if r.birth_year = p_year then return public.age_state(uid) || jsonb_build_object('same', true); end if;
  v_old := public.age_group_of(uid);
  v_u9 := public.age_u9(uid);
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
    floor_until = case when v_up then now() + interval '30 days' else floor_until end,
    -- был «до 9 лет» и стал старше (не опечатка) — ещё 30 дней «до 9»: чат и ЛС не откроются сменой года
    u9_until = case when v_u9 and y - p_year - 1 >= 9 and not v_typo then now() + interval '30 days' else u9_until end
    where user_id = uid;
  v_kid := public.age_kid_defaults(uid, v_typo);
  return public.age_state(uid) || jsonb_build_object('kid_defaults', v_kid);
end $$;

-- Стереть год (можно всегда). Был ребёнком/подростком (не опечатка) — 30 дней правила той группы
create or replace function public.age_clear() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r public.user_age%rowtype; v_old text; v_typo boolean; v_floor boolean; recent timestamptz[]; v_u9 boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into r from public.user_age where user_id = uid for update;
  if not found or r.birth_year is null then return public.age_state(uid); end if;
  v_old := public.age_group_of(uid);
  v_u9 := public.age_u9(uid);
  v_typo := r.first_at is not null and r.first_at > now() - interval '24 hours';
  v_floor := v_old in ('child', 'teen', 'teen16') and not v_typo;
  recent := array(select t from unnest(r.changes) t where t > now() - interval '30 days' order by t) || now();
  update public.user_age set birth_year = null, set_at = now(), changes = recent,
    floor_group = case when v_floor then v_old else floor_group end,
    floor_until = case when v_floor then now() + interval '30 days' else floor_until end,
    u9_until = case when v_u9 and not v_typo then now() + interval '30 days' else u9_until end
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
revoke execute on function public.age_u9(uuid) from public, anon, authenticated;
revoke execute on function public.kid_pair_ok(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.kid_why(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.kidsafe_on() to anon, authenticated;
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

-- premium_state и premium_order_create (магазин 💎) живут только в premium.sql: там правила возраста для оплаты
-- (premium_pay_age: до 14 лет — нельзя, год не указан — сначала указать) и лимиты 14–17 лет — age_shop_caps выше (22.10.2026)

-- ═══ 4. Безопасность детей (docs/REALMS.md «лёгкий вариант», 22.10.2026): что мне можно лично; ники детей на публичных страницах ═══
-- Служебные — выше (kidsafe_on, age_u9, kid_pair_ok, kid_why). Сами запреты — community.sql (запускать ПОСЛЕ этого файла): триггеры
-- на direct_messages и friendships (ЛС; звонок и приглашение в игру — тоже ЛС со ссылкой; заявка и её принятие), чат (до 9 —
-- только читать), голосовые каналы и звонки (пропуск), «кто из друзей онлайн».

-- Для интерфейса: с кем из списка мне нельзя лично. Отвечает только про СЕБЯ: ребёнку до 13 — кто из списка взрослый или без
-- возраста (age); до 9 лет — u9 (ЛС и звонков нет ни с кем). Взрослому и «без возраста» список всегда пустой — возраст других не
-- раскрываем (сервер всё равно не пропустит, а текст отказа у них общий: «нельзя написать этому игроку»)
create or replace function public.kid_contact(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); g text; v_no jsonb := '[]'::jsonb;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.kidsafe_on() then return jsonb_build_object('ok', true, 'on', false, 'u9', false, 'child', false, 'age', v_no); end if;
  g := public.age_group_of(me);
  if g = 'child' then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_no
      from (select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null and x <> me limit 300) t
      where public.age_group_of(x) in ('adult', 'unknown');
  end if;
  return jsonb_build_object('ok', true, 'on', true, 'u9', public.age_u9(me), 'child', g = 'child', 'age', v_no);
end $$;
revoke execute on function public.kid_contact(uuid[]) from public;
grant execute on function public.kid_contact(uuid[]) to anon, authenticated;

-- Серверные страницы (форум, идеи, игры игроков — их индексирует поиск): кто из авторов — ребёнок до 13 → вместо ника «Игрок».
-- Наружу — только номера (ни года, ни группы). Вызывает только сервер сайта (service_role); браузеру не дана
create or replace function public.age_public_kids(p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when not public.kidsafe_on() then '{}'::uuid[] else coalesce((
    select array_agg(x) from (select distinct x from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null limit 1000) t
    where public.age_group_of(x) = 'child'), '{}'::uuid[]) end
$$;
revoke execute on function public.age_public_kids(uuid[]) from public, anon, authenticated;
grant execute on function public.age_public_kids(uuid[]) to service_role;


-- Проверить руками (SQL Editor):
-- select public.age_group_of('<uuid>');   select * from public.premium_settings;

-- ═══════════════════════════════════════════════════════════════════
--  ВХОД ЧЕРЕЗ ДРУГИЕ СЕРВИСЫ: VK ID, Яндекс ID, Telegram (свои, через сервер сайта)
--  + защита встроенных входов Supabase: Google, Discord, Twitch, GitHub
--  (js/features/social-login.js, api/_lib/social.js, api/_lib/routes/oauth.js; пошагово — docs/LOGIN_PROVIDERS.md)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно — можно запускать ещё раз.
--  Нужны: profiles, banned_nicks (есть на базе), pgcrypto (схема extensions — есть). notifications.sql — по желанию (без него без 🔔).
--  Владелец 15.10.2026: «можно сделать вход через другие сервисы, но чтобы не было обходов и вредных действий для сайта и ботов».
--
--  Что внутри:
--   • auth_links — вход через VK / Яндекс / Telegram: (сервис, номер человека в сервисе) → аккаунт сайта. Один номер — один
--     аккаунт; у аккаунта — не больше одного входа каждого сервиса. Свои строки видит только сам человек (RLS), номер в сервисе —
--     только сервер. Токены сервисов НЕ хранятся нигде; имя и аватарка — по желанию (кнопка «Скрыть»).
--   • новые аккаунты через VK / Яндекс / Telegram: не больше 3 в сутки с одного интернета (храним отпечаток адреса за день,
--     сам адрес — нет) и не больше 60 в час на весь сайт (ботофермы с кучей адресов) — auth_limits();
--   • бан ника (banned_nicks) банит и все входы человека (отпечатки в auth_link_bans): заблокированный VK / Telegram / Google…
--     не создаст новый аккаунт и не привяжется к другому; сняли бан ника — сняты и они;
--   • Google / Discord / Twitch / GitHub (встроенные входы Supabase) — триггеры на auth.identities: забаненный вход не проходит;
--     к существующему аккаунту вход привязывается только из профиля со свежим входом (разрешение auth_link_intent); сам Supabase
--     «по совпадению подтверждённой почты» привязывает только Google и только к аккаунту с ЭТОЙ ЖЕ собственной подтверждённой
--     почтой (закрывает дыру ручной привязки Supabase ANT-2026-7WJV60DR); вручную нельзя привязать вход с почтой другого
--     аккаунта; последний способ войти не отвязать; о новой привязке — 🔔;
--  ВАЖНО: «Allow manual linking» в Supabase включать ТОЛЬКО после этого файла (docs/LOGIN_PROVIDERS.md).
--   • модераторам — «связанные входы» (какие сервисы и сколько, без номеров и почты): auth_links_staff.
--  Проверка после запуска: /rpc/auth_login_methods гостем {} → {"ok":false,"reason":"auth"} (PGRST202 = не применён).
-- ═══════════════════════════════════════════════════════════════════

-- ── Правила (меняются только здесь) ──
create or replace function public.auth_limits()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'ip_day', 3,        -- новых аккаунтов через VK / Яндекс / Telegram в сутки (по Москве) с одного интернета
    'site_hour', 60,    -- новых таких аккаунтов в час на весь сайт
    'fresh_min', 30,    -- «свежий вход» для привязки: входил (не продлевал сессию) не раньше стольких минут назад
    'intent_min', 15    -- столько живёт разрешение привязать Google / Discord / Twitch / GitHub
  );
$$;

-- Встроенные входы, которые Supabase может сам привязать к аккаунту по совпадению ПОДТВЕРЖДЁННОЙ почты.
-- Только Google: его почта проверена всегда. Discord, Twitch, GitHub — только вручную из профиля (docs/LOGIN_PROVIDERS.md).
create or replace function public.auth_autolink_ok()
returns text[] language sql immutable as $$ select array['google']::text[] $$;

create or replace function public.auth_provider_name(p text)
returns text language sql immutable as $$
  select case p when 'vk' then 'VK ID' when 'yandex' then 'Яндекс ID' when 'tg' then 'Telegram' when 'google' then 'Google'
    when 'discord' then 'Discord' when 'twitch' then 'Twitch' when 'github' then 'GitHub' when 'email' then 'почта' else coalesce(p, '') end;
$$;

-- ── Секрет для отпечатков (бан входа хранит отпечаток «сервис:номер», а не сам номер). Читают только функции ──
create table if not exists public.auth_secret (
  id int primary key default 1 check (id = 1),
  k text not null
);
alter table public.auth_secret enable row level security;   -- политик нет
revoke all on public.auth_secret from anon, authenticated;
insert into public.auth_secret (id, k) values (1, encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

-- ── Входы через VK / Яндекс / Telegram ──
create table if not exists public.auth_links (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('vk', 'yandex', 'tg')),
  provider_uid text not null check (provider_uid ~ '^[0-9A-Za-z_.:-]{1,64}$'),
  name text check (name is null or char_length(name) <= 64),
  avatar text check (avatar is null or (char_length(avatar) <= 400 and avatar ~ '^https://')),
  hidden boolean not null default false,     -- человек нажал «Скрыть»: имя и аватарку из сервиса не храним
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create unique index if not exists auth_links_uid on public.auth_links (provider, provider_uid);
create unique index if not exists auth_links_user_provider on public.auth_links (user_id, provider);
create index if not exists auth_links_created on public.auth_links (created_at desc);
alter table public.auth_links enable row level security;
drop policy if exists auth_links_own on public.auth_links;
create policy auth_links_own on public.auth_links for select to authenticated using (user_id = auth.uid());
revoke all on public.auth_links from anon, authenticated;
-- номер человека в сервисе (provider_uid) браузеру не отдаём даже владельцу строки
grant select (id, user_id, provider, name, avatar, hidden, created_at, last_at) on public.auth_links to authenticated;

-- ── Баны входов: отпечаток «сервис:номер» → нельзя создать аккаунт и привязать к другому ──
create table if not exists public.auth_link_bans (
  key text primary key,
  provider text not null,
  user_id uuid references auth.users(id) on delete set null,   -- с какого аккаунта бан пришёл (снимается вместе с баном ника)
  reason text not null default '' check (char_length(reason) <= 200),
  by_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists auth_link_bans_user on public.auth_link_bans (user_id);
alter table public.auth_link_bans enable row level security;
revoke all on public.auth_link_bans from anon, authenticated;

-- ── Новые аккаунты по отпечатку адреса за день (адрес не храним: отпечаток считает сервер ключом, которого нет в базе) ──
create table if not exists public.auth_ip_log (
  h text not null,
  day date not null,
  n int not null default 0,
  primary key (h, day)
);
alter table public.auth_ip_log enable row level security;
revoke all on public.auth_ip_log from anon, authenticated;

-- ── Одноразовые отметки: state входа, вход Telegram, передача входа браузеру ──
create table if not exists public.auth_once (
  k text primary key,
  until timestamptz not null
);
create index if not exists auth_once_until on public.auth_once (until);
alter table public.auth_once enable row level security;
revoke all on public.auth_once from anon, authenticated;

-- ── Разрешение привязать Google / Discord / Twitch / GitHub (даёт auth_link_intent при свежем входе) ──
create table if not exists public.auth_link_intents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null,
  until timestamptz not null
);
alter table public.auth_link_intents enable row level security;
revoke all on public.auth_link_intents from anon, authenticated;

-- ═══ Помощники ═══
create or replace function public.auth_link_key(p_provider text, p_uid text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select encode(extensions.hmac(lower(coalesce(p_provider, '')) || ':' || coalesce(p_uid, ''),
    (select k from public.auth_secret where id = 1), 'sha256'), 'hex');
$$;

create or replace function public.auth_link_banned(p_provider text, p_uid text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.auth_link_bans where key = public.auth_link_key(p_provider, p_uid));
$$;

-- Аккаунт забанен (бан ника — как в чате и в мире)
create or replace function public.auth_user_banned(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p join public.banned_nicks b on lower(b.nick) = lower(p.nick) where p.id = p_user);
$$;

-- Почта аккаунта — настоящий способ войти? У аккаунтов из VK / Яндекса / Telegram почта служебная (…@id.invalid) — нет
create or replace function public.auth_email_real(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u.email is not null and u.email_confirmed_at is not null and u.email not ilike '%@id.invalid'
      and u.email is distinct from (u.raw_app_meta_data ->> 'd37_synth_email')
    from auth.users u where u.id = p_user), false);
$$;

-- Сколько способов войти: VK / Яндекс / Telegram + Google / Discord / Twitch / GitHub + настоящая почта
create or replace function public.auth_ways(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select (select count(*) from public.auth_links where user_id = p_user)::int
    + (select count(*) from auth.identities where user_id = p_user and provider not in ('email', 'phone', 'anonymous'))::int
    + case when public.auth_email_real(p_user) then 1 else 0 end;
$$;

-- Когда человек в последний раз ВХОДИЛ (продление сессии не в счёт): amr в токене — Supabase пишет туда время входа
create or replace function public.auth_jwt_auth_at()
returns timestamptz language sql stable as $$
  select to_timestamp(max((a ->> 'timestamp')::double precision))
  from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) a
  where (a ->> 'timestamp') ~ '^[0-9]{1,12}(\.[0-9]+)?$';
$$;

create or replace function public.auth_is_fresh(p_at timestamptz)
returns boolean language sql stable as $$
  select coalesce(p_at > now() - make_interval(mins => (public.auth_limits() ->> 'fresh_min')::int)
    and p_at < now() + interval '5 minutes', false);
$$;

create or replace function public.auth_clean_name(p text)
returns text language sql immutable as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]<>"`]', '', 'g')), 64), '');
$$;
create or replace function public.auth_clean_avatar(p text)
returns text language sql immutable as $$
  select case when p ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]"''<>\\]*)?$' and char_length(p) <= 400 then p end;
$$;

-- 🔔 «к аккаунту привязан вход» (без notifications.sql — молча)
create or replace function public.auth_link_notify(p_user uuid, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('public.notify(uuid,text,uuid,text,text,text,text)') is null then return; end if;
  begin
    execute 'select public.notify($1, $2, null, $3, $4, $5, $6)' using p_user, 'security',
      '🔗 Привязан вход через ' || public.auth_provider_name(p_provider),
      'Если это был не ты — отвяжи его в профиле → «Способы входа» и смени пароль.', '#/profile/logins',
      'link:' || p_provider || ':' || to_char(now(), 'YYYYMMDDHH24MI');
  exception when others then null;
  end;
end $$;

-- ═══ Одноразовые отметки (зовёт сервер) → true, если отметка новая ═══
create or replace function public.auth_once_use(p_key text, p_sec int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if p_key is null or length(p_key) < 16 or length(p_key) > 200 then return false; end if;
  delete from public.auth_once where k in (select k from public.auth_once where until < now() limit 200);
  insert into public.auth_once (k, until) values (p_key, now() + make_interval(secs => least(greatest(coalesce(p_sec, 600), 60), 86400)))
    on conflict (k) do nothing returning k into v;
  return v is not null;
end $$;

-- ═══ Вход через VK / Яндекс / Telegram (зовёт сервер после проверки у сервиса) ═══
-- Есть привязка → её аккаунт (имя и аватарка обновляются, если человек их не скрыл). Забаненный вход пускает только в СВОЙ
-- аккаунт (бан ника там и так действует, а купленное не пропадает) — новый аккаунт через него не создать.
-- Нет привязки → можно ли создать новый аккаунт (лимиты).
create or replace function public.auth_social_begin(p_provider text, p_uid text, p_ip text, p_name text default null, p_avatar text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lim jsonb := public.auth_limits(); v_user uuid; v_n int;
  v_ip text := left(coalesce(nullif(btrim(p_ip), ''), 'noip'), 64);
  v_day date := (now() at time zone 'Europe/Moscow')::date;
begin
  if p_provider is null or p_provider not in ('vk', 'yandex', 'tg') or p_uid is null or p_uid !~ '^[0-9A-Za-z_.:-]{1,64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  update public.auth_links set last_at = now(),
      name = case when hidden then null else coalesce(public.auth_clean_name(p_name), name) end,
      avatar = case when hidden then null else coalesce(public.auth_clean_avatar(p_avatar), avatar) end
    where provider = p_provider and provider_uid = p_uid
    returning user_id into v_user;
  if v_user is not null then return jsonb_build_object('ok', true, 'user', v_user, 'new', false); end if;
  if public.auth_link_banned(p_provider, p_uid) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  -- новый аккаунт: лимиты на весь сайт и на один интернет
  if (select count(*) from public.auth_links where created_at > now() - interval '1 hour') >= (v_lim ->> 'site_hour')::int then
    return jsonb_build_object('ok', false, 'reason', 'busy'); end if;
  delete from public.auth_ip_log where day < v_day - 2;
  insert into public.auth_ip_log as lg (h, day, n) values (v_ip, v_day, 1)
    on conflict (h, day) do update set n = lg.n + 1 where lg.n < (v_lim ->> 'ip_day')::int
    returning lg.n into v_n;
  if v_n is null then return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  return jsonb_build_object('ok', true, 'create', true, 'new', true);
end $$;

-- Новый аккаунт создан (admin API) → привязать вход. Кто-то успел раньше (двойной клик) → 'race' + его аккаунт
create or replace function public.auth_social_bind(p_provider text, p_uid text, p_user uuid, p_name text default null, p_avatar text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_provider is null or p_provider not in ('vk', 'yandex', 'tg') or p_uid is null or p_uid !~ '^[0-9A-Za-z_.:-]{1,64}$' or p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.auth_link_banned(p_provider, p_uid) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  insert into public.auth_links (user_id, provider, provider_uid, name, avatar)
    values (p_user, p_provider, p_uid, public.auth_clean_name(p_name), public.auth_clean_avatar(p_avatar))
    on conflict do nothing
    returning user_id into v;
  if v is null then
    select user_id into v from public.auth_links where provider = p_provider and provider_uid = p_uid;
    return jsonb_build_object('ok', false, 'reason', case when v is null then 'has' else 'race' end, 'user', v);
  end if;
  return jsonb_build_object('ok', true, 'user', v);
end $$;

-- Привязать VK / Яндекс / Telegram к своему аккаунту (зовёт сервер; p_auth_at — когда человек входил, из его токена)
create or replace function public.auth_link_add(p_user uuid, p_provider text, p_uid text, p_name text, p_avatar text, p_auth_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_provider is null or p_provider not in ('vk', 'yandex', 'tg') or p_uid is null or p_uid !~ '^[0-9A-Za-z_.:-]{1,64}$' or p_user is null then
    return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.auth_is_fresh(p_auth_at) then return jsonb_build_object('ok', false, 'reason', 'reauth'); end if;
  if public.auth_link_banned(p_provider, p_uid) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  select user_id into v from public.auth_links where provider = p_provider and provider_uid = p_uid;
  if v = p_user then return jsonb_build_object('ok', true, 'same', true); end if;
  if v is not null then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;   -- чужой аккаунт: молча не переносим
  if exists (select 1 from public.auth_links where user_id = p_user and provider = p_provider) then
    return jsonb_build_object('ok', false, 'reason', 'has'); end if;
  insert into public.auth_links (user_id, provider, provider_uid, name, avatar)
    values (p_user, p_provider, p_uid, public.auth_clean_name(p_name), public.auth_clean_avatar(p_avatar))
    on conflict do nothing
    returning user_id into v;
  if v is null then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  -- к забаненному аккаунту привязали новый вход — он тоже в бане: новый аккаунт через него не создать
  if public.auth_user_banned(p_user) then
    insert into public.auth_link_bans (key, provider, user_id, reason)
      values (public.auth_link_key(p_provider, p_uid), p_provider, p_user, 'бан ника') on conflict (key) do nothing;
  end if;
  perform public.auth_link_notify(p_user, p_provider);
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Для самого человека (профиль → «Способы входа») ═══
create or replace function public.auth_login_methods()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  return jsonb_build_object('ok', true,
    'links', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'name', name, 'avatar', avatar, 'hidden', hidden,
        'at', created_at, 'last', last_at) order by created_at) from public.auth_links where user_id = uid), '[]'::jsonb),
    'identities', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'at', created_at) order by created_at)
        from auth.identities where user_id = uid and provider not in ('email', 'phone', 'anonymous')), '[]'::jsonb),
    'email', public.auth_email_real(uid),
    'ways', public.auth_ways(uid));
end $$;

-- Отвязать свой вход VK / Яндекс / Telegram (последний способ войти — нельзя)
create or replace function public.auth_link_remove(p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.auth_links where user_id = uid and provider = p_provider) then
    return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public.auth_ways(uid) <= 1 then return jsonb_build_object('ok', false, 'reason', 'last'); end if;
  delete from public.auth_links where user_id = uid and provider = p_provider;
  return jsonb_build_object('ok', true, 'ways', public.auth_ways(uid));
end $$;

-- «Скрыть имя и аватарку» из сервиса (и больше не обновлять их при входе); p_hide = false — снова показывать после входа
create or replace function public.auth_link_hide(p_provider text, p_hide boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h boolean := coalesce(p_hide, true);
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  update public.auth_links set hidden = h, name = case when h then null else name end, avatar = case when h then null else avatar end
    where user_id = uid and provider = p_provider;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Разрешение привязать Google / Discord / Twitch / GitHub: только со свежим входом. Само разрешение «съедает» триггер ниже
create or replace function public.auth_link_intent(p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_provider is null or p_provider not in ('google', 'discord', 'twitch', 'github') then
    return jsonb_build_object('ok', false, 'reason', 'provider'); end if;
  if not public.auth_is_fresh(public.auth_jwt_auth_at()) then return jsonb_build_object('ok', false, 'reason', 'reauth'); end if;
  if exists (select 1 from auth.identities where user_id = uid and provider = p_provider) then
    return jsonb_build_object('ok', false, 'reason', 'has'); end if;
  insert into public.auth_link_intents (user_id, provider, until)
    values (uid, p_provider, now() + make_interval(mins => (public.auth_limits() ->> 'intent_min')::int))
    on conflict (user_id) do update set provider = excluded.provider, until = excluded.until;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Модераторам: «связанные входы» — какие сервисы и сколько (без номеров, имён и почты) ═══
create or replace function public.auth_links_staff(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r text; list text[];
begin
  select role into r from public.profiles where id = auth.uid();
  if coalesce(r, '') not in ('admin', 'moderator') then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  select array_agg(x order by x) into list from (
    select public.auth_provider_name(provider) x from public.auth_links where user_id = p_user
    union all select public.auth_provider_name(provider) from auth.identities
      where user_id = p_user and provider not in ('email', 'phone', 'anonymous')
    union all select 'почта' where public.auth_email_real(p_user)) s;
  return jsonb_build_object('ok', true, 'n', coalesce(array_length(list, 1), 0), 'list', to_jsonb(coalesce(list, '{}'::text[])),
    'banned', (select count(*) from public.auth_link_bans where user_id = p_user));
end $$;

-- Есть ли этот файл на базе (сервер включает кнопки VK / Яндекс / Telegram только с ним)
create or replace function public.auth_social_ready()
returns boolean language sql stable as $$ select true $$;

-- ═══ Бан ника → баны всех входов человека; сняли бан ника — сняли и их ═══
create or replace function public.auth_ban_logins(p_user uuid, p_reason text, p_by uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.auth_link_bans (key, provider, user_id, reason, by_id)
  select public.auth_link_key(x.provider, x.uid), x.provider, p_user, left(coalesce(p_reason, ''), 200), p_by from (
    select provider, provider_uid as uid from public.auth_links where user_id = p_user
    union select provider, provider_id from auth.identities where user_id = p_user and provider not in ('email', 'phone', 'anonymous')
  ) x
  on conflict (key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.auth_links_on_ban()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  begin
    if tg_op = 'INSERT' then
      for r in select id from public.profiles where lower(nick) = lower(new.nick) loop
        perform public.auth_ban_logins(r.id, 'бан ника', new.banned_by);
      end loop;
    else
      for r in select id from public.profiles where lower(nick) = lower(old.nick) loop
        if not public.auth_user_banned(r.id) then
          delete from public.auth_link_bans where user_id = r.id and reason = 'бан ника';
        end if;
      end loop;
    end if;
  exception when others then
    raise warning 'auth_links_on_ban: %', sqlerrm;   -- бан ника важнее: его не ломаем
  end;
  return null;
end $$;
drop trigger if exists d37_ban_logins on public.banned_nicks;
create trigger d37_ban_logins after insert or delete on public.banned_nicks
  for each row execute function public.auth_links_on_ban();

-- ═══ Встроенные входы Supabase (auth.identities): Google, Discord, Twitch, GitHub ═══
-- Перед добавлением входа: забаненный — нет (ни новым аккаунтом, ни к другому); к существующему аккаунту — только по
-- разрешению из профиля (свежий вход) или «по почте» для auth_autolink_ok(). Сбой самой проверки вход не ломает.
-- Почта (известная дыра ручной привязки Supabase, ANT-2026-7WJV60DR: злоумышленник привязывает к СВОЕМУ аккаунту Discord с
-- чужой неподтверждённой почтой, потом жертва входит через Google — и Supabase «по почте» приклеивает её Google к его аккаунту):
--  • «по почте» Google приклеивается, только если это СОБСТВЕННАЯ подтверждённая почта аккаунта (не почта другого входа);
--  • вручную нельзя привязать вход, чья почта — почта ДРУГОГО аккаунта сайта.
create or replace function public.auth_identity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_block text; v_intent text; v_mail text := lower(nullif(btrim(new.identity_data ->> 'email'), ''));
begin
  if new.provider is null or new.provider in ('email', 'phone', 'anonymous') then return new; end if;
  begin
    if public.auth_link_banned(new.provider, new.provider_id) then
      v_block := 'banned';
    elsif exists (select 1 from auth.identities i where i.user_id = new.user_id) then
      delete from public.auth_link_intents where user_id = new.user_id and provider = new.provider and until > now()
        returning provider into v_intent;
      if v_intent is null and (not (new.provider = any (public.auth_autolink_ok())) or v_mail is null
          or not exists (select 1 from auth.users u where u.id = new.user_id and u.email_confirmed_at is not null and lower(u.email) = v_mail)) then
        v_block := 'autolink';
      elsif v_intent is not null and v_mail is not null
          and exists (select 1 from auth.users u where lower(u.email) = v_mail and u.id <> new.user_id) then
        v_block := 'email';
      elsif public.auth_user_banned(new.user_id) then
        insert into public.auth_link_bans (key, provider, user_id, reason)
          values (public.auth_link_key(new.provider, new.provider_id), new.provider, new.user_id, 'бан ника') on conflict (key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'auth_identity_guard: %', sqlerrm;
    return new;
  end;
  if v_block = 'banned' then raise exception 'd37_login_banned: этот вход заблокирован на сайте' using errcode = '42501'; end if;
  if v_block = 'autolink' then raise exception 'd37_login_link: привязать этот вход можно только из профиля' using errcode = '42501'; end if;
  if v_block = 'email' then raise exception 'd37_login_email: почта этого входа — почта другого аккаунта' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists d37_identity_guard on auth.identities;
create trigger d37_identity_guard before insert on auth.identities
  for each row execute function public.auth_identity_guard();

-- После привязки к существующему аккаунту — 🔔 самому человеку
create or replace function public.auth_identity_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.provider is null or new.provider in ('email', 'phone', 'anonymous') then return null; end if;
  begin
    if exists (select 1 from auth.identities i where i.user_id = new.user_id and i.id is distinct from new.id) then
      perform public.auth_link_notify(new.user_id, new.provider);
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists d37_identity_note on auth.identities;
create trigger d37_identity_note after insert on auth.identities
  for each row execute function public.auth_identity_note();

-- Отвязка встроенного входа: у аккаунта со служебной почтой (из VK / Яндекса / Telegram) последний вход не убрать.
-- Удаление всего аккаунта (насовсем или «мягко») и привязка нового входа (есть разрешение) — проходят.
create or replace function public.auth_identity_unlink_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_last boolean := false;
begin
  if old.provider is null or old.provider in ('email', 'phone', 'anonymous') then return old; end if;
  begin
    select u.deleted_at is null
        and not public.auth_email_real(u.id)
        and not exists (select 1 from public.auth_links l where l.user_id = u.id)
        and not exists (select 1 from auth.identities i where i.user_id = u.id and i.id is distinct from old.id
          and i.provider not in ('email', 'phone', 'anonymous'))
        and not exists (select 1 from public.auth_link_intents t where t.user_id = u.id and t.until > now())
      into v_last from auth.users u where u.id = old.user_id;
  exception when others then v_last := false;
  end;
  if coalesce(v_last, false) then raise exception 'd37_login_last: это последний способ войти' using errcode = '42501'; end if;
  return old;
end $$;
drop trigger if exists d37_identity_unlink_guard on auth.identities;
create trigger d37_identity_unlink_guard before delete on auth.identities
  for each row execute function public.auth_identity_unlink_guard();

-- ═══ Права ═══
do $$
declare f text;
begin
  -- только сервер сайта (service_role) и сами функции
  foreach f in array array['auth_social_ready()', 'auth_social_begin(text,text,text,text,text)', 'auth_social_bind(text,text,uuid,text,text)',
      'auth_link_add(uuid,text,text,text,text,timestamptz)', 'auth_once_use(text,integer)', 'auth_link_key(text,text)',
      'auth_link_banned(text,text)', 'auth_user_banned(uuid)', 'auth_email_real(uuid)', 'auth_ways(uuid)',
      'auth_ban_logins(uuid,text,uuid)', 'auth_link_notify(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- вошедшие
  foreach f in array array['auth_link_remove(text)', 'auth_link_hide(text,boolean)', 'auth_link_intent(text)', 'auth_links_staff(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- гостю — ответ «войди» (так проверяют, что файл применён)
  execute 'grant execute on function public.auth_login_methods() to anon, authenticated';
  -- функции триггеров напрямую не зовут
  foreach f in array array['auth_links_on_ban()', 'auth_identity_guard()', 'auth_identity_note()', 'auth_identity_unlink_guard()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- Уже забаненные ники — их входы тоже в бан (повторный запуск ничего не дублирует)
select public.auth_ban_logins(p.id, 'бан ника', null)
  from public.profiles p join public.banned_nicks b on lower(b.nick) = lower(p.nick);

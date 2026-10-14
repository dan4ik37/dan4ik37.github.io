-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА («как Дискорд»), ЗВОНКИ И ТЕЛЕФОН 📱
--  (js/features/phone.js, phone-apps.js, community.js, calls.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно — можно запускать ещё раз.
--  Нужны: profiles, friendships (friends-dm.sql). notifications.sql — по желанию (без него просто без 🔔).
--  pgcrypto — в Supabase уже есть (схема extensions).
--
--  Что внутри:
--   • сообщества: создать (до 3 своих), вступить (открытые — кнопкой, закрытые — по ссылке /c/<код>), выйти;
--     текстовые каналы (хранятся последние 3000 сообщений канала), голосовые (до 6 человек — сам звук идёт
--     напрямую между браузерами, база только выдаёт пропуск); роли: владелец / модератор / участник;
--     мут на N минут, кик, бан (на время или навсегда), медленный режим, канал «пишут только модераторы»,
--     жалобы (3 разных жалобы — сообщение скрыто до проверки; жалобы видят модераторы и персонал сайта),
--     @упоминания → 🔔
--   • блокировка человека: не напишет в ЛС, не позвонит, не пришлёт заявку в друзья; дружба удаляется
--   • звонки 1 на 1 между друзьями: история, пропущенные (🔔), «занято», «кто может звонить» (друзья / никто)
--   • «кто из друзей онлайн и где» (на сайте / в мире, сервер N) — видят только друзья, невидимку — никто
--   • фото с камеры телефона (снимок 3D-мира): хранилище shots, до 40 снимков в сутки
--  Писать в таблицы напрямую нельзя — только функциями ниже (они всё проверяют).
--  Проверка после запуска: /rpc/cm_invite_info гостем {"p_code":"x"} → null (PGRST202 = не применён).
-- ═══════════════════════════════════════════════════════════════════

-- Невидимка (privacy.sql) — на случай, если тот файл не запускался
alter table public.profiles add column if not exists privacy_invisible boolean not null default false;

-- ── Секрет для пропусков в голосовые каналы (читают только функции) ──
create table if not exists public.comm_secret (
  id int primary key default 1 check (id = 1),
  k text not null
);
alter table public.comm_secret enable row level security;
revoke all on public.comm_secret from anon, authenticated;
insert into public.comm_secret (id, k) values (1, encode(extensions.gen_random_bytes(32), 'hex')) on conflict (id) do nothing;

-- ═══ Таблицы ═══
create table if not exists public.communities (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 2 and 40),
  about text not null default '' check (char_length(about) <= 300),
  icon text not null default '💬' check (char_length(icon) between 1 and 8),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  is_public boolean not null default true,
  invite_code text not null unique,
  members int not null default 0,
  status text not null default 'active' check (status in ('active', 'banned')),
  created_at timestamptz not null default now()
);
create index if not exists idx_comm_public on public.communities (members desc) where status = 'active' and is_public;
create index if not exists idx_comm_owner on public.communities (owner_id);

create table if not exists public.community_members (
  community_id bigint not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'mod', 'member')),
  muted_until timestamptz,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index if not exists idx_cmem_user on public.community_members (user_id);

create table if not exists public.community_bans (
  community_id bigint not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  by_id uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 200),
  until timestamptz,                                   -- null — навсегда
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.community_channels (
  id bigint generated always as identity primary key,
  community_id bigint not null references public.communities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  kind text not null default 'text' check (kind in ('text', 'voice')),
  position int not null default 0,
  slow_sec int not null default 0 check (slow_sec between 0 and 3600),
  mods_only boolean not null default false,            -- пишут только владелец и модераторы («новости»)
  created_at timestamptz not null default now()
);
create index if not exists idx_cch_comm on public.community_channels (community_id, position);

create table if not exists public.community_messages (
  id bigint generated always as identity primary key,
  channel_id bigint not null references public.community_channels(id) on delete cascade,
  community_id bigint not null references public.communities(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  nick text not null default '',                       -- ник на момент отправки (как в общем чате)
  text text not null default '',
  reply_to bigint,
  reactions jsonb not null default '{}'::jsonb,        -- {"👍": 3} — сколько; кто — в community_reactions
  edited_at timestamptz,
  deleted boolean not null default false,
  hidden boolean not null default false,               -- скрыто жалобами до проверки
  created_at timestamptz not null default now(),
  constraint cmsg_text_len check (deleted or char_length(text) between 1 and 1000)
);
create index if not exists idx_cmsg_channel on public.community_messages (channel_id, id desc);
create index if not exists idx_cmsg_user on public.community_messages (user_id, created_at desc);

create table if not exists public.community_reactions (
  message_id bigint not null references public.community_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists idx_creact_user on public.community_reactions (user_id, created_at desc);

create table if not exists public.community_reports (
  id bigint generated always as identity primary key,
  community_id bigint not null references public.communities(id) on delete cascade,
  message_id bigint references public.community_messages(id) on delete cascade,   -- null — жалоба на само сообщество
  target_id uuid references public.profiles(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);
create unique index if not exists creport_once on public.community_reports (coalesce(message_id, -community_id), reporter_id) where status = 'open';
create index if not exists idx_creport_open on public.community_reports (community_id) where status = 'open';
create index if not exists idx_creport_reporter on public.community_reports (reporter_id, created_at desc);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);
create index if not exists idx_ublocks_blocked on public.user_blocks (blocked_id);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ringing' check (status in ('ringing', 'answered', 'ended', 'declined', 'missed', 'busy', 'failed')),
  seen boolean not null default false,                 -- пропущенный уже посмотрели
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  alive_at timestamptz,                                -- разговор идёт: отметка раз в минуту (зависшая вкладка не держит «занято»)
  ended_at timestamptz
);
create index if not exists idx_calls_callee on public.calls (callee_id, created_at desc);
create index if not exists idx_calls_caller on public.calls (caller_id, created_at desc);

create table if not exists public.comm_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  calls_from text not null default 'friends' check (calls_from in ('friends', 'nobody')),
  updated_at timestamptz not null default now()
);

create table if not exists public.comm_online (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  seen_at timestamptz not null default now(),
  place text not null default ''
);

-- ═══ Помощники (security definer — не зависят от прав читающего) ═══
create or replace function public.comm_is_staff(p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'moderator') from public.profiles where id = p_uid), false);
$$;

create or replace function public.comm_role(p_cid bigint, p_uid uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select role from public.community_members where community_id = p_cid and user_id = p_uid;
$$;

create or replace function public.comm_is_member(p_cid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_members where community_id = p_cid and user_id = auth.uid());
$$;

create or replace function public.comm_is_mod(p_cid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner', 'mod') from public.community_members where community_id = p_cid and user_id = auth.uid()), false);
$$;

create or replace function public.comm_banned(p_cid bigint, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.community_bans where community_id = p_cid and user_id = p_uid and (until is null or until > now()));
$$;

create or replace function public.comm_blocked(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.user_blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create or replace function public.comm_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.friendships where status = 'accepted'
      and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a)));
$$;

-- Мат (как фильтр мира: латиница-двойники → кириллица) — для названий сообществ и каналов
create or replace function public.comm_norm(p text)
returns text language sql immutable as $$
  select translate(lower(translate(coalesce(p, ''), 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ', 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя')),
                   'aeopcxykmthb30@', 'аеорсхукмтнвзоа');
$$;
create or replace function public.comm_bad(p text)
returns boolean language sql immutable as $$
  select public.comm_norm(p) ~ '(ху[йеёяюи]|п[иеё]зд|(^|[^а-яё])бля|(^|[^а-яё])(за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)|(^|[^а-яё])сук(а|и|е|у|ой|ин|ам)([^а-яё]|$)|муда[кч]|мудил|пид[ао]р|педик|г[ао]нд[ао]н|шлюх|залуп|дроч)';
$$;
-- Ссылки запрещены (кроме самого сайта и снимков камеры телефона)
create or replace function public.comm_has_link(p text)
returns boolean language sql immutable as $$
  select regexp_replace(coalesce(p, ''),
      '(https://dan4ik37\.vercel\.app(/[^[:space:]]*)?|https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/shots/[0-9a-f-]{36}/[a-z0-9]{8,24}\.jpg)', '', 'gi')
    ~* '(https?:|www\.|t\.me/|discord\.(gg|com)|bit\.ly|vk\.cc|clck\.ru|[a-z0-9-]{2,}\.(ru|com|net|org|рф|io|gg|me|xyz|su|ly|cc|top|link|site|online|tk|ml)([/[:space:]]|$))';
$$;

-- Код приглашения: 8 знаков без похожих букв
create or replace function public.comm_code(n int default 8)
returns text language plpgsql volatile set search_path = public as $$
declare abc text := 'abcdefghjkmnpqrstuvwxyz23456789'; b bytea := extensions.gen_random_bytes(n); s text := ''; i int;
begin
  for i in 0 .. n - 1 loop s := s || substr(abc, 1 + get_byte(b, i) % length(abc), 1); end loop;
  return s;
end $$;

-- 🔔 через notify() из notifications.sql — если его нет, тихо ничего
create or replace function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor or public.comm_blocked(p_user, p_actor) then return; end if;
  if to_regprocedure('public.notify(uuid,text,uuid,text,text,text,text)') is null then return; end if;
  begin
    perform public.notify(p_user, p_kind, p_actor, p_title, p_body, p_link, p_dedupe);
  exception when others then null;
  end;
end $$;
revoke all on function public.comm_notify(uuid, text, uuid, text, text, text, text) from public, anon, authenticated;

-- Отметка «5 минут» для склейки уведомлений
create or replace function public.comm_bucket(p_min int default 5)
returns text language sql stable as $$
  select to_char(date_trunc('minute', now()) - (extract(minute from now())::int % p_min) * interval '1 minute', 'YYYYMMDDHH24MI');
$$;

-- Число участников — триггером (не разъезжается)
create or replace function public.comm_members_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid bigint := coalesce(new.community_id, old.community_id);
begin
  update public.communities set members = (select count(*) from public.community_members where community_id = cid) where id = cid;
  return null;
end $$;
drop trigger if exists comm_members_count on public.community_members;
create trigger comm_members_count after insert or delete on public.community_members
  for each row execute function public.comm_members_count();

-- ═══ RLS: читать — только своё / своих сообществ; писать — только функциями ═══
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_bans enable row level security;
alter table public.community_channels enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_reactions enable row level security;
alter table public.community_reports enable row level security;
alter table public.user_blocks enable row level security;
alter table public.calls enable row level security;
alter table public.comm_settings enable row level security;
alter table public.comm_online enable row level security;

drop policy if exists comm_read on public.communities;
create policy comm_read on public.communities for select
  using ((status = 'active' and (is_public or public.comm_is_member(id))) or public.comm_is_staff());
drop policy if exists cmem_read on public.community_members;
create policy cmem_read on public.community_members for select
  using (user_id = auth.uid() or public.comm_is_member(community_id) or public.comm_is_staff());
drop policy if exists cban_read on public.community_bans;
create policy cban_read on public.community_bans for select
  using (user_id = auth.uid() or public.comm_is_mod(community_id) or public.comm_is_staff());
drop policy if exists cch_read on public.community_channels;
create policy cch_read on public.community_channels for select
  using (public.comm_is_member(community_id) or public.comm_is_staff()
    or exists (select 1 from public.communities c where c.id = community_id and c.status = 'active' and c.is_public));
-- сообщения: только участникам (и персоналу); скрытое жалобами — только модераторам
drop policy if exists cmsg_read on public.community_messages;
create policy cmsg_read on public.community_messages for select
  using ((public.comm_is_member(community_id) and (not hidden or public.comm_is_mod(community_id))) or public.comm_is_staff());
drop policy if exists creact_read on public.community_reactions;
create policy creact_read on public.community_reactions for select using (user_id = auth.uid());
drop policy if exists creport_read on public.community_reports;
create policy creport_read on public.community_reports for select
  using (reporter_id = auth.uid() or public.comm_is_mod(community_id) or public.comm_is_staff());
drop policy if exists ublock_read on public.user_blocks;
create policy ublock_read on public.user_blocks for select using (blocker_id = auth.uid());
drop policy if exists calls_read on public.calls;
create policy calls_read on public.calls for select using (auth.uid() = caller_id or auth.uid() = callee_id);
drop policy if exists csettings_read on public.comm_settings;
create policy csettings_read on public.comm_settings for select using (user_id = auth.uid());
-- comm_online — без политик: читается только через friends_online()

-- ═══ Блокировка: и в ЛС, и в заявках в друзья (дополнительное условие к старым правилам) ═══
create or replace function public.user_block(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_uid is null or p_uid = uid or not exists (select 1 from public.profiles where id = p_uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if (select count(*) from public.user_blocks where blocker_id = uid) >= 500 then return jsonb_build_object('ok', false, 'reason', 'many'); end if;
  insert into public.user_blocks (blocker_id, blocked_id) values (uid, p_uid) on conflict do nothing;
  delete from public.friendships where (requester_id = uid and addressee_id = p_uid) or (requester_id = p_uid and addressee_id = uid);
  update public.calls set status = case when status = 'ringing' then 'missed' else 'ended' end, ended_at = now()
    where status in ('ringing', 'answered') and ((caller_id = uid and callee_id = p_uid) or (caller_id = p_uid and callee_id = uid));
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.user_unblock(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_uid;
  return jsonb_build_object('ok', true);
end $$;

do $$
begin
  if to_regclass('public.direct_messages') is not null then
    drop policy if exists "Не писать тому, кто заблокировал" on public.direct_messages;
    create policy "Не писать тому, кто заблокировал" on public.direct_messages as restrictive for insert to authenticated
      with check (not public.comm_blocked(sender_id, recipient_id));
  end if;
  if to_regclass('public.friendships') is not null then
    drop policy if exists "Нет заявок при блокировке" on public.friendships;
    create policy "Нет заявок при блокировке" on public.friendships as restrictive for insert to authenticated
      with check (not public.comm_blocked(requester_id, addressee_id));
  end if;
end $$;

-- ═══ Сообщества ═══
create or replace function public.cm_create(p_name text, p_about text, p_icon text, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_name text := btrim(coalesce(p_name, '')); v_about text := btrim(coalesce(p_about, ''));
  v_icon text := btrim(coalesce(p_icon, '')); v_id bigint; v_code text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if char_length(v_about) > 300 then return jsonb_build_object('ok', false, 'reason', 'about'); end if;
  if public.comm_bad(v_name) or public.comm_bad(v_about) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.comm_has_link(v_name) or public.comm_has_link(v_about) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if v_icon = '' or char_length(v_icon) > 8 or v_icon ~ '[[:alnum:][:space:]<>]' then v_icon := '💬'; end if;
  if (select count(*) from public.communities where owner_id = uid) >= 3 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if exists (select 1 from public.communities where owner_id = uid and created_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  if (select count(*) from public.community_members where user_id = uid) >= 50 then return jsonb_build_object('ok', false, 'reason', 'joined'); end if;
  loop
    v_code := public.comm_code(8);
    exit when not exists (select 1 from public.communities where invite_code = v_code);
  end loop;
  insert into public.communities (name, about, icon, owner_id, is_public, invite_code)
    values (v_name, v_about, v_icon, uid, coalesce(p_public, true), v_code) returning id into v_id;
  insert into public.community_members (community_id, user_id, role) values (v_id, uid, 'owner');
  insert into public.community_channels (community_id, name, kind, position, mods_only) values
    (v_id, 'общий', 'text', 0, false), (v_id, 'новости', 'text', 1, true), (v_id, 'Голосовой', 'voice', 2, false);
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
end $$;

create or replace function public.cm_update(p_id bigint, p_name text, p_about text, p_icon text, p_public boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_about text := btrim(coalesce(p_about, '')); v_icon text := btrim(coalesce(p_icon, ''));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_id), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if char_length(v_about) > 300 then return jsonb_build_object('ok', false, 'reason', 'about'); end if;
  if public.comm_bad(v_name) or public.comm_bad(v_about) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.comm_has_link(v_name) or public.comm_has_link(v_about) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if v_icon = '' or char_length(v_icon) > 8 or v_icon ~ '[[:alnum:][:space:]<>]' then v_icon := '💬'; end if;
  update public.communities set name = v_name, about = v_about, icon = v_icon, is_public = coalesce(p_public, is_public) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cm_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_id), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.communities where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Персонал сайта: закрыть сообщество за нарушения (или открыть обратно)
create or replace function public.cm_staff_status(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_status not in ('active', 'banned') then return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  update public.communities set status = p_status where id = p_id;
  update public.community_reports set status = 'done' where community_id = p_id and message_id is null and status = 'open';
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Вступить: открытое — по номеру, любое — по коду приглашения
create or replace function public.cm_join(p_id bigint, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c record; b record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_code is not null and btrim(p_code) <> '' then
    select * into c from public.communities where invite_code = lower(btrim(p_code));
  else
    select * into c from public.communities where id = p_id and is_public;
  end if;
  if not found or c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.community_members where community_id = c.id and user_id = uid) then
    return jsonb_build_object('ok', true, 'id', c.id, 'already', true); end if;
  select * into b from public.community_bans where community_id = c.id and user_id = uid;
  if found then
    if b.until is null or b.until > now() then return jsonb_build_object('ok', false, 'reason', 'banned', 'until', b.until); end if;
    delete from public.community_bans where community_id = c.id and user_id = uid;
  end if;
  if c.members >= 500 then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  if (select count(*) from public.community_members where user_id = uid) >= 50 then return jsonb_build_object('ok', false, 'reason', 'joined'); end if;
  if (select count(*) from public.community_members where user_id = uid and joined_at > now() - interval '1 hour') >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  insert into public.community_members (community_id, user_id, role) values (c.id, uid, 'member');
  return jsonb_build_object('ok', true, 'id', c.id);
end $$;

create or replace function public.cm_leave(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if public.comm_role(p_id) = 'owner' then return jsonb_build_object('ok', false, 'reason', 'owner'); end if;
  delete from public.community_members where community_id = p_id and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Приглашение по коду: что за сообщество (видно и гостю — для страницы /c/<код>)
create or replace function public.cm_invite_info(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'about', c.about, 'icon', c.icon, 'members', c.members, 'public', c.is_public)
  from public.communities c where c.invite_code = lower(btrim(coalesce(p_code, ''))) and c.status = 'active';
$$;

create or replace function public.cm_invite_reset(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not public.comm_is_mod(p_id) and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  loop
    v_code := public.comm_code(8);
    exit when not exists (select 1 from public.communities where invite_code = v_code);
  end loop;
  update public.communities set invite_code = v_code where id = p_id;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- Открытые сообщества (поиск по названию)
create or replace function public.cm_list_public(p_q text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.members desc, x.id), '[]'::jsonb) from (
    select c.id, c.name, c.about, c.icon, c.members from public.communities c
    where c.status = 'active' and c.is_public
      and (coalesce(btrim(p_q), '') = '' or c.name ilike '%' || replace(replace(btrim(p_q), '%', ''), '_', '') || '%')
    order by c.members desc, c.id limit 30) x;
$$;

-- Мои сообщества (с последним сообщением — для точки «есть новое»)
create or replace function public.cm_my()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.joined_at), '[]'::jsonb) from (
    select c.id, c.name, c.icon, c.about, c.members, c.is_public, m.role, m.joined_at,
      (select max(msg.id) from public.community_messages msg where msg.community_id = c.id and not msg.deleted) as last_id
    from public.community_members m join public.communities c on c.id = m.community_id
    where m.user_id = auth.uid() and c.status = 'active') x;
$$;

-- Открыть сообщество: сведения, моя роль, каналы (у голосовых — тема комнаты, только участникам)
create or replace function public.cm_open(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); c record; v_role text; v_mute timestamptz; b record; staff boolean := public.comm_is_staff(); s text; ch jsonb;
begin
  select * into c from public.communities where id = p_id;
  if not found or (c.status <> 'active' and not staff) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select role, muted_until into v_role, v_mute from public.community_members where community_id = p_id and user_id = uid;
  if v_role is null then
    select * into b from public.community_bans where community_id = p_id and user_id = uid and (until is null or until > now());
    if found then return jsonb_build_object('ok', false, 'reason', 'banned', 'until', b.until, 'name', c.name); end if;
    if not c.is_public and not staff then return jsonb_build_object('ok', false, 'reason', 'private'); end if;
  end if;
  select k into s from public.comm_secret where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'slow', x.slow_sec, 'mods_only', x.mods_only,
      'last_id', (select max(m.id) from public.community_messages m where m.channel_id = x.id and not m.deleted),
      'topic', case when x.kind = 'voice' and (v_role is not null or staff) then 'cv-' || substr(encode(extensions.hmac('topic:' || x.id, s, 'sha256'), 'hex'), 1, 24) end)
    order by x.position, x.id), '[]'::jsonb) into ch
  from public.community_channels x where x.community_id = p_id;
  return jsonb_build_object('ok', true, 'role', v_role, 'staff', staff,
    'muted_until', case when v_mute > now() then v_mute end,
    'c', jsonb_build_object('id', c.id, 'name', c.name, 'about', c.about, 'icon', c.icon, 'public', c.is_public, 'members', c.members,
      'owner', c.owner_id, 'status', c.status, 'code', case when v_role is not null or staff then c.invite_code end),
    'channels', ch);
end $$;

create or replace function public.cm_members(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_is_member(p_id) or public.comm_is_staff() then (
    select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'nick', p.nick, 'role', m.role,
        'muted_until', case when m.muted_until > now() then m.muted_until end)
      order by case m.role when 'owner' then 0 when 'mod' then 1 else 2 end, lower(p.nick)), '[]'::jsonb)
    from public.community_members m join public.profiles p on p.id = m.user_id
    where m.community_id = p_id) end;
$$;

create or replace function public.cm_bans(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_is_mod(p_id) or public.comm_is_staff() then (
    select coalesce(jsonb_agg(jsonb_build_object('id', b.user_id, 'nick', p.nick, 'reason', b.reason, 'until', b.until, 'at', b.created_at) order by b.created_at desc), '[]'::jsonb)
    from public.community_bans b join public.profiles p on p.id = b.user_id
    where b.community_id = p_id and (b.until is null or b.until > now())) end;
$$;

-- ═══ Каналы ═══
create or replace function public.cm_channel_save(p_community bigint, p_id bigint, p_name text, p_kind text, p_slow int, p_mods_only boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id bigint; v_kind text := coalesce(p_kind, 'text');
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_is_mod(p_community) and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 32 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if public.comm_bad(v_name) or public.comm_has_link(v_name) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if coalesce(p_slow, 0) < 0 or coalesce(p_slow, 0) > 3600 then return jsonb_build_object('ok', false, 'reason', 'slow'); end if;
  if p_id is null then
    if v_kind not in ('text', 'voice') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;
    if (select count(*) from public.community_channels where community_id = p_community) >= 20 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    if v_kind = 'voice' and (select count(*) from public.community_channels where community_id = p_community and kind = 'voice') >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    insert into public.community_channels (community_id, name, kind, position, slow_sec, mods_only)
      values (p_community, v_name, v_kind, coalesce((select max(position) + 1 from public.community_channels where community_id = p_community), 0),
              coalesce(p_slow, 0), coalesce(p_mods_only, false))
      returning id into v_id;
  else
    update public.community_channels set name = v_name, slow_sec = coalesce(p_slow, slow_sec), mods_only = coalesce(p_mods_only, mods_only)
      where id = p_id and community_id = p_community returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cm_channel_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  select community_id into cid from public.community_channels where id = p_id;
  if cid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(public.comm_role(cid), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if (select count(*) from public.community_channels where community_id = cid and kind = 'text') <= 1
     and (select kind from public.community_channels where id = p_id) = 'text' then
    return jsonb_build_object('ok', false, 'reason', 'last'); end if;
  delete from public.community_channels where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Сообщения ═══
create or replace function public.cm_send(p_channel bigint, p_text text, p_reply bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ch record; c record; v_role text; v_mute timestamptz; v_text text := btrim(coalesce(p_text, ''));
  v_last timestamptz; v_id bigint; v_nick text; m text; target uuid; n int := 0; v_row record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into ch from public.community_channels where id = p_channel;
  if not found or ch.kind <> 'text' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into c from public.communities where id = ch.community_id;
  if c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select role, muted_until into v_role, v_mute from public.community_members where community_id = ch.community_id and user_id = uid;
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if v_mute > now() then return jsonb_build_object('ok', false, 'reason', 'muted', 'until', v_mute); end if;
  if ch.mods_only and v_role = 'member' then return jsonb_build_object('ok', false, 'reason', 'mods_only'); end if;
  if char_length(v_text) < 1 or char_length(v_text) > 1000 then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  if public.comm_has_link(v_text) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if v_text ~ '(.)\1{14,}' then return jsonb_build_object('ok', false, 'reason', 'flood'); end if;
  -- частота: 5 за 10 секунд и 40 за 5 минут по всем сообществам
  if (select count(*) from public.community_messages where user_id = uid and created_at > now() - interval '10 seconds') >= 5
     or (select count(*) from public.community_messages where user_id = uid and created_at > now() - interval '5 minutes') >= 40 then
    return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  -- медленный режим (модераторам не мешает)
  if ch.slow_sec > 0 and v_role = 'member' then
    select created_at into v_last from public.community_messages where channel_id = p_channel and user_id = uid order by id desc limit 1;
    if v_last is not null and v_last > now() - make_interval(secs => ch.slow_sec) then
      return jsonb_build_object('ok', false, 'reason', 'slow', 'wait', ceil(extract(epoch from (v_last + make_interval(secs => ch.slow_sec) - now())))::int);
    end if;
  end if;
  -- одно и то же подряд
  if exists (select 1 from public.community_messages where channel_id = p_channel and user_id = uid and text = v_text and created_at > now() - interval '30 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'repeat'); end if;
  if p_reply is not null and not exists (select 1 from public.community_messages where id = p_reply and channel_id = p_channel) then p_reply := null; end if;
  select nick into v_nick from public.profiles where id = uid;
  insert into public.community_messages (channel_id, community_id, user_id, nick, text, reply_to)
    values (p_channel, ch.community_id, uid, coalesce(v_nick, ''), v_text, p_reply)
    returning * into v_row;
  v_id := v_row.id;
  -- @упоминания участников этого сообщества → 🔔 (не больше трёх, от одного человека — раз в 5 минут на канал)
  if position('@' in v_text) > 0 then
    for m in select distinct lower((regexp_matches(v_text, '@([A-Za-zА-Яа-яЁё0-9_.-]{2,24})', 'g'))[1]) loop
      exit when n >= 3;
      select cm.user_id into target from public.community_members cm join public.profiles p on p.id = cm.user_id
        where cm.community_id = ch.community_id and lower(p.nick) = m limit 1;
      if target is not null and target <> uid then
        perform public.comm_notify(target, 'cm_mention', uid, 'упомянул(а) тебя в «' || left(c.name, 40) || '»', left(v_text, 140),
          '#/phone/comm/' || ch.community_id || '/' || p_channel, 'cmm:' || p_channel || ':' || uid || ':' || public.comm_bucket(5));
        n := n + 1;
      end if;
      target := null;
    end loop;
  end if;
  -- ответ на твоё сообщение → 🔔
  if p_reply is not null then
    select user_id into target from public.community_messages where id = p_reply;
    if target is not null and target <> uid then
      perform public.comm_notify(target, 'cm_reply', uid, 'ответил(а) тебе в «' || left(c.name, 40) || '»', left(v_text, 140),
        '#/phone/comm/' || ch.community_id || '/' || p_channel, 'cmr:' || p_channel || ':' || uid || ':' || public.comm_bucket(5));
    end if;
  end if;
  -- хранение: последние 3000 сообщений канала (чистка — раз в 100 сообщений)
  if v_id % 100 = 0 then
    delete from public.community_messages where channel_id = p_channel and id <= (
      select id from public.community_messages where channel_id = p_channel order by id desc offset 3000 limit 1);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'msg', to_jsonb(v_row));
end $$;

create or replace function public.cm_edit(p_id bigint, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_text text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v from public.community_messages where id = p_id;
  if not found or v.deleted or v.user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.created_at < now() - interval '48 hours' then return jsonb_build_object('ok', false, 'reason', 'old'); end if;
  if not public.comm_is_member(v.community_id) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if char_length(v_text) < 1 or char_length(v_text) > 1000 then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  if public.comm_has_link(v_text) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if v_text ~ '(.)\1{14,}' then return jsonb_build_object('ok', false, 'reason', 'flood'); end if;
  update public.community_messages set text = v_text, edited_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Может ли p_actor наказывать p_target в сообществе: владелец — всех, модератор — участников, персонал — всех, себя — нет
create or replace function public.comm_can_mod(p_cid bigint, p_actor uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_actor is not null and p_target is not null and p_actor <> p_target and (
    public.comm_is_staff(p_actor)
    or (select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'owner'
    or ((select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'mod'
        and coalesce((select role from public.community_members where community_id = p_cid and user_id = p_target), 'member') = 'member'));
$$;

create or replace function public.cm_delete_msg(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into v from public.community_messages where id = p_id;
  if not found or v.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.user_id is distinct from auth.uid() and not public.comm_can_mod(v.community_id, auth.uid(), v.user_id)
     and not (v.user_id is null and (public.comm_is_mod(v.community_id) or public.comm_is_staff())) then
    return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  update public.community_messages set deleted = true, hidden = false, text = '', reactions = '{}'::jsonb where id = p_id;
  delete from public.community_reactions where message_id = p_id;
  update public.community_reports set status = 'done' where message_id = p_id and status = 'open';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cm_react(p_id bigint, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; d int; cnt int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_emoji is null or not (p_emoji = any (array['👍', '❤️', '😂', '🔥', '😮', '😢', '🎉', '👀', '💯', '🤝', '😎', '🙏'])) then
    return jsonb_build_object('ok', false, 'reason', 'emoji'); end if;
  select * into v from public.community_messages where id = p_id;
  if not found or v.deleted or v.hidden then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_is_member(v.community_id) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if exists (select 1 from public.community_reactions where message_id = p_id and user_id = uid and emoji = p_emoji) then
    delete from public.community_reactions where message_id = p_id and user_id = uid and emoji = p_emoji;
    d := -1;
  else
    if (select count(*) from public.community_reactions where user_id = uid and created_at > now() - interval '1 minute') >= 30 then
      return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
    if not (v.reactions ? p_emoji) and (select count(*) from jsonb_object_keys(v.reactions)) >= 12 then
      return jsonb_build_object('ok', false, 'reason', 'many'); end if;
    insert into public.community_reactions (message_id, user_id, emoji) values (p_id, uid, p_emoji);
    d := 1;
  end if;
  select count(*) into cnt from public.community_reactions where message_id = p_id and emoji = p_emoji;
  update public.community_messages
    set reactions = case when cnt <= 0 then reactions - p_emoji else jsonb_set(reactions, array[p_emoji], to_jsonb(cnt)) end
    where id = p_id;
  return jsonb_build_object('ok', true, 'on', d > 0, 'n', cnt);
end $$;

-- ═══ Модерация ═══
create or replace function public.cm_mute(p_community bigint, p_user uuid, p_minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz; c record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_can_mod(p_community, auth.uid(), p_user) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if coalesce(p_minutes, -1) < 0 or p_minutes > 10080 then return jsonb_build_object('ok', false, 'reason', 'minutes'); end if;
  v_until := case when p_minutes = 0 then null else now() + make_interval(mins => p_minutes) end;
  update public.community_members set muted_until = v_until where community_id = p_community and user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select name into c from public.communities where id = p_community;
  if p_minutes > 0 then
    perform public.comm_notify(p_user, 'cm_mod', auth.uid(), 'заглушил(а) тебя в «' || left(c.name, 40) || '» на ' || p_minutes || ' мин', '',
      '#/phone/comm/' || p_community, 'cmmute:' || p_community || ':' || public.comm_bucket(5));
  end if;
  return jsonb_build_object('ok', true, 'until', v_until);
end $$;

create or replace function public.cm_kick(p_community bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_can_mod(p_community, auth.uid(), p_user) or public.comm_role(p_community, p_user) = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.community_members where community_id = p_community and user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cm_ban(p_community bigint, p_user uuid, p_reason text, p_minutes int, p_purge boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_can_mod(p_community, auth.uid(), p_user) or public.comm_role(p_community, p_user) = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if not exists (select 1 from public.profiles where id = p_user) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  v_until := case when coalesce(p_minutes, 0) <= 0 then null else now() + make_interval(mins => least(p_minutes, 525600)) end;
  delete from public.community_members where community_id = p_community and user_id = p_user;
  insert into public.community_bans (community_id, user_id, by_id, reason, until)
    values (p_community, p_user, auth.uid(), left(btrim(coalesce(p_reason, '')), 200), v_until)
    on conflict (community_id, user_id) do update set by_id = excluded.by_id, reason = excluded.reason, until = excluded.until, created_at = now();
  if coalesce(p_purge, false) then
    update public.community_messages set deleted = true, hidden = false, text = '', reactions = '{}'::jsonb
      where community_id = p_community and user_id = p_user and created_at > now() - interval '24 hours' and not deleted;
  end if;
  return jsonb_build_object('ok', true, 'until', v_until);
end $$;

create or replace function public.cm_unban(p_community bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.comm_is_mod(p_community) and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.community_bans where community_id = p_community and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- Роли: только владелец (или персонал). 'owner' — передать сообщество (старый владелец становится модератором)
create or replace function public.cm_set_role(p_community bigint, p_user uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text := public.comm_role(p_community, p_user);
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_community, uid), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if cur is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_user = uid or cur = 'owner' then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if p_role = 'mod' then
    if (select count(*) from public.community_members where community_id = p_community and role = 'mod') >= 10 then
      return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    update public.community_members set role = 'mod' where community_id = p_community and user_id = p_user;
  elsif p_role = 'member' then
    update public.community_members set role = 'member' where community_id = p_community and user_id = p_user;
  elsif p_role = 'owner' then
    if (select count(*) from public.communities where owner_id = p_user) >= 3 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    update public.community_members set role = 'mod' where community_id = p_community and role = 'owner';
    update public.community_members set role = 'owner', muted_until = null where community_id = p_community and user_id = p_user;
    update public.communities set owner_id = p_user where id = p_community;
  else
    return jsonb_build_object('ok', false, 'reason', 'role');
  end if;
  return jsonb_build_object('ok', true, 'role', p_role);
end $$;

-- ═══ Жалобы: на сообщение (видят модераторы сообщества и персонал сайта) или на само сообщество (персонал) ═══
create or replace function public.cm_report(p_msg bigint, p_reason text, p_community bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; cid bigint; n int; c record; r record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if (select count(*) from public.community_reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  if p_msg is not null then
    select * into v from public.community_messages where id = p_msg;
    if not found or v.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if v.user_id = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
    cid := v.community_id;
    if not public.comm_is_member(cid) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
    insert into public.community_reports (community_id, message_id, target_id, reporter_id, reason)
      values (cid, p_msg, v.user_id, uid, left(btrim(coalesce(p_reason, '')), 200)) on conflict do nothing;
    select count(distinct reporter_id) into n from public.community_reports where message_id = p_msg and status = 'open';
    if n >= 3 then update public.community_messages set hidden = true where id = p_msg; end if;
    select name into c from public.communities where id = cid;
    for r in select user_id from public.community_members where community_id = cid and role in ('owner', 'mod') loop
      perform public.comm_notify(r.user_id, 'cm_report', null, '🚩 Жалоба в «' || left(c.name, 40) || '»', left(v.text, 140),
        '#/phone/comm/' || cid || '/reports', 'cmrep:' || p_msg);
    end loop;
    return jsonb_build_object('ok', true, 'hidden', n >= 3);
  end if;
  select * into c from public.communities where id = p_community;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.community_reports (community_id, message_id, target_id, reporter_id, reason)
    values (p_community, null, c.owner_id, uid, left(btrim(coalesce(p_reason, '')), 200)) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- Открытые жалобы: по сообществу (модераторам) или все (персоналу, p_community = null)
create or replace function public.cm_reports(p_community bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_community is null and not public.comm_is_staff() then return null; end if;
  if p_community is not null and not public.comm_is_mod(p_community) and not public.comm_is_staff() then return null; end if;
  return (select coalesce(jsonb_agg(x order by x.n desc, x.at desc), '[]'::jsonb) from (
    select min(r.id) as id, r.community_id as cid, max(c.name) as cname, r.message_id as mid, max(m.text) as text, max(m.nick) as author,
      (array_agg(r.target_id))[1] as target, count(*) as n, max(r.created_at) as at, bool_or(coalesce(m.hidden, false)) as hidden,
      string_agg(distinct nullif(r.reason, ''), ' · ') as reasons, (array_agg(m.channel_id))[1] as chid
    from public.community_reports r
    join public.communities c on c.id = r.community_id
    left join public.community_messages m on m.id = r.message_id
    where r.status = 'open' and (p_community is null or r.community_id = p_community)
      and (r.message_id is not null or public.comm_is_staff())
    group by r.community_id, r.message_id
    order by count(*) desc, max(r.created_at) desc limit 100) x);
end $$;

create or replace function public.cm_report_resolve(p_report bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.community_reports where id = p_report;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_is_mod(r.community_id) and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if p_action = 'delete' and r.message_id is not null then
    update public.community_messages set deleted = true, hidden = false, text = '', reactions = '{}'::jsonb where id = r.message_id;
  elsif p_action = 'dismiss' and r.message_id is not null then
    update public.community_messages set hidden = false where id = r.message_id;
  elsif p_action not in ('dismiss', 'delete') then
    return jsonb_build_object('ok', false, 'reason', 'action');
  end if;
  update public.community_reports set status = 'done'
    where status = 'open' and community_id = r.community_id and coalesce(message_id, 0) = coalesce(r.message_id, 0);
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Голосовые каналы: пропуск (сам звук — напрямую между браузерами, WebRTC) ═══
-- Комната в Supabase Realtime — «cv-» + подпись номера канала: тему знают только участники сообщества.
-- Пропуск «uid.срок.подпись» покрывает канал и открытый ключ — соседи проверяют cv_check и знают, кто есть кто.
create or replace function public.cv_pass(p_channel bigint, p_pub text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); ch record; s text; exp bigint; body text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_pub is null or length(p_pub) < 40 or length(p_pub) > 200 then return jsonb_build_object('ok', false, 'reason', 'key'); end if;
  select * into ch from public.community_channels where id = p_channel;
  if not found or ch.kind <> 'voice' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not exists (select 1 from public.communities where id = ch.community_id and status = 'active') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public.comm_role(ch.community_id, uid) is null and not public.comm_is_staff(uid) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  select k into s from public.comm_secret where id = 1;
  exp := extract(epoch from now())::bigint + 6 * 3600;
  body := uid::text || '.' || exp || '.' || p_channel || '.' || encode(extensions.digest(p_pub, 'sha256'), 'hex');
  return jsonb_build_object('ok', true, 'max', 6,
    'topic', 'cv-' || substr(encode(extensions.hmac('topic:' || p_channel, s, 'sha256'), 'hex'), 1, 24),
    'pass', uid::text || '.' || exp || '.' || encode(extensions.hmac(body, s, 'sha256'), 'hex'));
end $$;

create or replace function public.cv_check(p_channel bigint, p_pass text, p_pub text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare parts text[]; v_uid uuid; exp bigint; s text; body text; cid bigint; p record;
begin
  select community_id into cid from public.community_channels where id = p_channel and kind = 'voice';
  if cid is null or (public.comm_role(cid) is null and not public.comm_is_staff()) then return null; end if;   -- проверяет только свой
  parts := string_to_array(coalesce(p_pass, ''), '.');
  if coalesce(array_length(parts, 1), 0) <> 3 or p_pub is null or length(p_pub) > 200 then return null; end if;
  begin
    v_uid := parts[1]::uuid;
    exp := parts[2]::bigint;
  exception when others then return null;
  end;
  if exp < extract(epoch from now())::bigint then return null; end if;
  select k into s from public.comm_secret where id = 1;
  body := parts[1] || '.' || parts[2] || '.' || p_channel || '.' || encode(extensions.digest(p_pub, 'sha256'), 'hex');
  if encode(extensions.hmac(body, s, 'sha256'), 'hex') <> parts[3] then return null; end if;
  if public.comm_banned(cid, v_uid) or (public.comm_role(cid, v_uid) is null and not public.comm_is_staff(v_uid)) then return null; end if;
  select id, nick, role into p from public.profiles where id = v_uid;
  if not found then return null; end if;
  return jsonb_build_object('uid', p.id, 'nick', p.nick, 'role', coalesce(public.comm_role(cid, v_uid), 'guest'),
    'staff', coalesce(p.role in ('admin', 'moderator'), false));
end $$;

-- ═══ Звонки 1 на 1 (только друзья; «кто может звонить» — друзья / никто) ═══
create or replace function public.call_start(p_to uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_id uuid; v_from text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_to is null or p_to = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if not exists (select 1 from public.profiles where id = p_to) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- старьё: никто не ответил за 45 с — пропущенный; разговор без отметки дольше 2 минут — завершён (вкладку закрыли)
  update public.calls set status = 'missed', ended_at = now()
    where status = 'ringing' and created_at < now() - interval '45 seconds' and (caller_id in (uid, p_to) or callee_id in (uid, p_to));
  update public.calls set status = 'ended', ended_at = coalesce(alive_at, now())
    where status = 'answered' and coalesce(alive_at, answered_at) < now() - interval '2 minutes' and (caller_id in (uid, p_to) or callee_id in (uid, p_to));
  if public.comm_blocked(uid, p_to) then return jsonb_build_object('ok', false, 'reason', 'blocked'); end if;
  if not public.comm_friends(uid, p_to) then return jsonb_build_object('ok', false, 'reason', 'friends'); end if;
  select calls_from into v_from from public.comm_settings where user_id = p_to;
  if v_from = 'nobody' then return jsonb_build_object('ok', false, 'reason', 'nobody'); end if;
  if (select count(*) from public.calls where caller_id = uid and created_at > now() - interval '2 minutes') >= 5
     or (select count(*) from public.calls where caller_id = uid and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  -- свои старые «звонит / разговор» (переподключился) — закрыть
  update public.calls set status = case when status = 'ringing' then 'missed' else 'ended' end, ended_at = now()
    where status in ('ringing', 'answered') and (caller_id = uid or callee_id = uid);
  -- занято: у друга уже разговор или ему звонят
  if exists (select 1 from public.calls where (caller_id = p_to or callee_id = p_to) and status in ('ringing', 'answered')) then
    insert into public.calls (caller_id, callee_id, status, ended_at) values (uid, p_to, 'busy', now()) returning id into v_id;
    perform public.comm_notify(p_to, 'call_missed', uid, 'звонил(а), пока ты разговаривал(а)', '', '#/phone/calls', 'callbusy:' || uid || ':' || public.comm_bucket(5));
    return jsonb_build_object('ok', false, 'reason', 'busy', 'id', v_id);
  end if;
  insert into public.calls (caller_id, callee_id) values (uid, p_to) returning id into v_id;
  -- история: хранится 60 дней
  if random() < .05 then delete from public.calls where created_at < now() - interval '60 days'; end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.call_answer(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.calls where id = p_id and callee_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.status <> 'ringing' or v.created_at < now() - interval '45 seconds' then return jsonb_build_object('ok', false, 'reason', 'gone', 'status', v.status); end if;
  update public.calls set status = 'answered', answered_at = now(), alive_at = now(), seen = true where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Завершить: звонит → declined (кто принимает) / missed (кто звонит: не дождался или передумал) / busy / failed;
-- разговор → ended / failed
create or replace function public.call_end(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; st text;
begin
  select * into v from public.calls where id = p_id and (caller_id = uid or callee_id = uid);
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.status = 'ringing' then
    if uid = v.callee_id and p_status in ('declined', 'busy', 'failed') then st := p_status;
    elsif uid = v.caller_id and p_status in ('missed', 'failed') then st := p_status;
    else return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  elsif v.status = 'answered' then
    if p_status in ('ended', 'failed') then st := p_status; else return jsonb_build_object('ok', false, 'reason', 'status'); end if;
  else
    return jsonb_build_object('ok', true, 'status', v.status);   -- уже закончен
  end if;
  update public.calls set status = st, ended_at = now(), seen = case when st in ('missed', 'busy') then false else seen end where id = p_id;
  if st = 'missed' then
    perform public.comm_notify(v.callee_id, 'call_missed', v.caller_id, 'пропущенный звонок', '', '#/phone/calls', 'callmiss:' || p_id);
  end if;
  return jsonb_build_object('ok', true, 'status', st);
end $$;

create or replace function public.call_ping(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.calls set alive_at = now() where id = p_id and status = 'answered' and (caller_id = auth.uid() or callee_id = auth.uid());
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.call_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'missed', (select count(*) from public.calls where callee_id = auth.uid() and status in ('missed', 'busy') and not seen),
    'calls_from', coalesce((select calls_from from public.comm_settings where user_id = auth.uid()), 'friends'));
$$;

create or replace function public.call_seen()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.calls set seen = true where callee_id = auth.uid() and not seen;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.call_settings(p_calls_from text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_calls_from not in ('friends', 'nobody') then return jsonb_build_object('ok', false, 'reason', 'value'); end if;
  insert into public.comm_settings (user_id, calls_from, updated_at) values (auth.uid(), p_calls_from, now())
    on conflict (user_id) do update set calls_from = excluded.calls_from, updated_at = now();
  return jsonb_build_object('ok', true, 'calls_from', p_calls_from);
end $$;

-- ═══ Кто из друзей онлайн и где (телефон раз в минуту отмечается; невидимку не видно) ═══
create or replace function public.comm_ping(p_place text)
returns void language plpgsql security definer set search_path = public as $$
declare v_place text := left(regexp_replace(coalesce(p_place, ''), '[^a-z0-9:_-]', '', 'g'), 24);
begin
  if auth.uid() is null then return; end if;
  insert into public.comm_online (user_id, seen_at, place) values (auth.uid(), now(), v_place)
    on conflict (user_id) do update set seen_at = now(), place = excluded.place
    where public.comm_online.seen_at < now() - interval '15 seconds' or public.comm_online.place is distinct from excluded.place;
end $$;

create or replace function public.friends_online()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.user_id, 'seen', o.seen_at, 'place', o.place)), '[]'::jsonb)
  from public.comm_online o join public.profiles p on p.id = o.user_id
  where o.seen_at > now() - interval '3 minutes' and not coalesce(p.privacy_invisible, false)
    and public.comm_friends(auth.uid(), o.user_id) and not public.comm_blocked(auth.uid(), o.user_id);
$$;

-- ═══ Права на функции ═══
do $$
declare f text;
begin
  foreach f in array array[
    'user_block(uuid)', 'user_unblock(uuid)', 'cm_create(text,text,text,boolean)', 'cm_update(bigint,text,text,text,boolean)', 'cm_delete(bigint)',
    'cm_staff_status(bigint,text)', 'cm_join(bigint,text)', 'cm_leave(bigint)', 'cm_invite_reset(bigint)', 'cm_my()', 'cm_open(bigint)',
    'cm_members(bigint)', 'cm_bans(bigint)', 'cm_channel_save(bigint,bigint,text,text,integer,boolean)', 'cm_channel_delete(bigint)',
    'cm_send(bigint,text,bigint)', 'cm_edit(bigint,text)', 'cm_delete_msg(bigint)', 'cm_react(bigint,text)', 'cm_mute(bigint,uuid,integer)',
    'cm_kick(bigint,uuid)', 'cm_ban(bigint,uuid,text,integer,boolean)', 'cm_unban(bigint,uuid)', 'cm_set_role(bigint,uuid,text)',
    'cm_report(bigint,text,bigint)', 'cm_reports(bigint)', 'cm_report_resolve(bigint,text)', 'cv_pass(bigint,text)', 'cv_check(bigint,text,text)',
    'call_start(uuid)', 'call_answer(uuid)', 'call_end(uuid,text)', 'call_ping(uuid)', 'call_state()', 'call_seen()', 'call_settings(text)',
    'comm_ping(text)', 'friends_online()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on function public.cm_invite_info(text) to anon, authenticated';
  execute 'grant execute on function public.cm_list_public(text) to anon, authenticated';
end $$;
revoke all on function public.comm_members_count() from public, anon, authenticated;
-- помощники с чужим id (кто в каком сообществе, кто с кем дружит) — только для функций выше
revoke all on function public.comm_role(bigint, uuid) from public, anon, authenticated;
revoke all on function public.comm_banned(bigint, uuid) from public, anon, authenticated;
revoke all on function public.comm_can_mod(bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.comm_friends(uuid, uuid) from public, anon, authenticated;

-- ═══ Realtime: новые сообщения канала и звонки — сразу (RLS решает, кому что придёт) ═══
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_messages') then
      alter publication supabase_realtime add table public.community_messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls') then
      alter publication supabase_realtime add table public.calls;
    end if;
  end if;
end $$;

-- ═══ Камера телефона: снимки (только jpeg до 600 КБ, своя папка, до 40 в сутки; ссылки знает только тот, кому отправили) ═══
create or replace function public.shots_quota_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from storage.objects where bucket_id = 'shots' and owner = auth.uid() and created_at > now() - interval '1 day') < 40;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shots', 'shots', true, 614400, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 614400, allowed_mime_types = array['image/jpeg'];
drop policy if exists "shots: загрузить в свою папку" on storage.objects;
create policy "shots: загрузить в свою папку" on storage.objects for insert to authenticated
  with check (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[a-z0-9]{8,24}\.jpg$' and public.shots_quota_ok());
drop policy if exists "shots: свои видно" on storage.objects;
create policy "shots: свои видно" on storage.objects for select to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "shots: удалить свои" on storage.objects;
create policy "shots: удалить свои" on storage.objects for delete to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);

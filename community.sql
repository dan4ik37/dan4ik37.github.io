-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА («как Дискорд»), ОБЩИЙ ЧАТ «Денчик37», ЗВОНКИ И ТЕЛЕФОН 📱 — ВЕСЬ SQL ЧАТА В ОДНОМ ФАЙЛЕ
--  (js/features/phone.js, phone-apps.js, community.js, community2.js, msgview.js, chat.js, calls.js, api/push-check.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно — можно запускать сколько угодно раз, в том числе поверх старых
--  community.sql + community2.sql + community3.sql (16.10.2026 они слиты сюда, отдельных файлов больше нет; данные не трогаются).
--  Нужны: profiles, friendships (friends-dm.sql), premium.sql (буст за 💎). notifications.sql — по желанию (без него просто без 🔔).
--  pgcrypto — в Supabase уже есть (схема extensions). Писать в таблицы напрямую нельзя — только функциями (они всё проверяют).
--
--  Части:
--   1. сообщества: создать / вступить / выйти, каналы (текст, голос), роли владелец / модератор / участник, мут, кик, бан, медленный
--      режим, жалобы, @упоминания → 🔔, закреп; блокировка; «кто из друзей онлайн»; общий чат сайта = сервер «Денчик37» (chat_channels)
--   2. «Денчик-бот» и канал «📢 новости», messages.is_sticker, 📅 события, 🧭 обзор сообществ (категории, возрастная метка)
--   3. 🎭 свои роли (цвет, место, права-биты: 1 каналы, 2 модерация, 4 закреп, 8 события, 16 @everyone), @everyone → 🔔, 🚀 буст за 💎
--   4. 📁 папки и порядок каналов, тема, архив, «пишут модераторы + роль»; 🛡 модерация с причиной (⚠️ предупреждение, ⏳ тайм-аут,
--      👢 кик, ⛔ бан, 🧹 «удалить N последних») и 📜 журнал модерации; 🤖 автомодерация; 🔔 уведомления сервера (все / @ / ничего,
--      заглушить сервер или канал)
--
--  Проверка после запуска (гостем, publishable-ключ; PGRST202 — функции нет, файл не применён):
--   /rpc/cm_invite_info {"p_code":"x"} → null                                  (ч. 1)
--   /rpc/cm_events {"p_community":null} → {"ok":true,"can":false,"list":[…]}   (ч. 2)
--   /rpc/cm_roles {"p_id":0} → {"ok":false,"reason":"private"}                 (ч. 3)
--   /rpc/cm_modlog {"p_community":null} → {"ok":false,"reason":"rights"}       (ч. 4)
--   /rpc/cm_automod_get {"p_community":null} → {"ok":true,"cfg":{},"can":false}
--   /rest/v1/chat_channels?select=id,archived,category_id&limit=1 → 200 (400 «does not exist» — ч. 4 не применилась)
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
--  ЧАСТЬ 1. Сообщества, звонки, телефон, общий чат «Денчик37»
-- ═══════════════════════════════════════════════════════════════════

-- Невидимка (privacy.sql) — на случай, если тот файл не запускался
alter table public.profiles add column if not exists privacy_invisible boolean not null default false;
alter table public.profiles add column if not exists privacy_profile text not null default 'all';

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
-- Ссылки запрещены (кроме самого сайта)
create or replace function public.comm_has_link(p text)
returns boolean language sql immutable as $$
  select regexp_replace(coalesce(p, ''), 'https://dan4ik37\.vercel\.app(/[^[:space:]]*)?', '', 'gi')
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
    -- ключ комнат Realtime сообщества («печатает…»): знают только участники
    'rt', case when v_role is not null or staff then substr(encode(extensions.hmac('rt:' || c.id, s, 'sha256'), 'hex'), 1, 16) end,
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
-- Канал 0 — голосовой канал сайта (сервер «Денчик37»): вошедшим, аккаунт старше суток, без бана и мута в чате.
-- Пропуск «uid.срок.подпись» покрывает канал и открытый ключ — соседи проверяют cv_check и знают, кто есть кто.
create or replace function public.cv_pass(p_channel bigint, p_pub text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); ch record; s text; exp bigint; body text; p record; v_topic text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_pub is null or length(p_pub) < 40 or length(p_pub) > 200 then return jsonb_build_object('ok', false, 'reason', 'key'); end if;
  select k into s from public.comm_secret where id = 1;
  if p_channel = 0 then
    -- голосовой канал сайта (сервер «Денчик37»): аккаунт старше суток (команда — сразу), без бана и мута в чате
    select nick, role, created_at into p from public.profiles where id = uid;
    if not found then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
    if exists (select 1 from public.banned_nicks b where lower(b.nick) = lower(p.nick)) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
    if exists (select 1 from public.chat_mutes where user_id = uid and until > now()) then return jsonb_build_object('ok', false, 'reason', 'muted'); end if;
    if public.chat_staff_role(uid) is null and coalesce(p.created_at, now()) > now() - interval '1 day' then return jsonb_build_object('ok', false, 'reason', 'new'); end if;
    v_topic := 'cv-' || substr(encode(extensions.hmac('topic:official', s, 'sha256'), 'hex'), 1, 24);
  else
    select * into ch from public.community_channels where id = p_channel;
    if not found or ch.kind <> 'voice' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if not exists (select 1 from public.communities where id = ch.community_id and status = 'active') then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if public.comm_role(ch.community_id, uid) is null and not public.comm_is_staff(uid) then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
    v_topic := 'cv-' || substr(encode(extensions.hmac('topic:' || p_channel, s, 'sha256'), 'hex'), 1, 24);
  end if;
  exp := extract(epoch from now())::bigint + 6 * 3600;
  body := uid::text || '.' || exp || '.' || p_channel || '.' || encode(extensions.digest(p_pub, 'sha256'), 'hex');
  return jsonb_build_object('ok', true, 'max', 6, 'topic', v_topic,
    'pass', uid::text || '.' || exp || '.' || encode(extensions.hmac(body, s, 'sha256'), 'hex'));
end $$;

create or replace function public.cv_check(p_channel bigint, p_pass text, p_pub text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare parts text[]; v_uid uuid; exp bigint; s text; body text; cid bigint; p record;
begin
  if auth.uid() is null then return null; end if;
  if p_channel <> 0 then
    select community_id into cid from public.community_channels where id = p_channel and kind = 'voice';
    if cid is null or (public.comm_role(cid) is null and not public.comm_is_staff()) then return null; end if;   -- проверяет только свой
  end if;
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
  select id, nick, role into p from public.profiles where id = v_uid;
  if not found then return null; end if;
  if p_channel = 0 then
    if exists (select 1 from public.banned_nicks b where lower(b.nick) = lower(p.nick)) then return null; end if;
    return jsonb_build_object('uid', p.id, 'nick', p.nick, 'role', coalesce(p.role, 'user'), 'staff', coalesce(p.role in ('admin', 'moderator', 'helper'), false));
  end if;
  if public.comm_banned(cid, v_uid) or (public.comm_role(cid, v_uid) is null and not public.comm_is_staff(v_uid)) then return null; end if;
  return jsonb_build_object('uid', p.id, 'nick', p.nick, 'role', coalesce(public.comm_role(cid, v_uid), 'guest'),
    'staff', coalesce(p.role in ('admin', 'moderator'), false));
end $$;

-- ═══ Кто из друзей онлайн и где (телефон раз в минуту отмечается; невидимку не видно) ═══
create or replace function public.comm_ping(p_place text)
returns void language plpgsql security definer set search_path = public as $$
declare v_place text := left(regexp_replace(coalesce(p_place, ''), '[^a-zA-Z0-9:_/|.,-]', '', 'g'), 120);
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
  where o.seen_at > now() - interval '3 minutes' and not coalesce(p.privacy_invisible, false) and coalesce(p.privacy_profile, 'all') <> 'nobody'
    and public.comm_friends(auth.uid(), o.user_id) and not public.comm_blocked(auth.uid(), o.user_id);
$$;

-- ═══ Общий чат сайта = сервер «Денчик37»: таблица messages (как раньше) + каналы chat_channels ═══
-- Старые вкладки пишут без channel — это #общий. Новые колонки добавляются, только если их ещё нет.
alter table public.messages add column if not exists channel text;
alter table public.messages add column if not exists reply_to bigint;
alter table public.messages add column if not exists edited_at timestamptz;
create index if not exists idx_messages_channel on public.messages (channel, id desc);

create table if not exists public.chat_channels (
  id text primary key check (id ~ '^[a-z]{2,16}$'),
  name text not null check (char_length(name) between 1 and 32),
  kind text not null default 'text' check (kind in ('text', 'voice')),
  position int not null default 0,
  slow_sec int not null default 0 check (slow_sec between 0 and 3600),
  mods_only boolean not null default false,
  about text not null default '' check (char_length(about) <= 200)
);
alter table public.chat_channels enable row level security;
drop policy if exists chat_channels_read on public.chat_channels;
create policy chat_channels_read on public.chat_channels for select using (true);
insert into public.chat_channels (id, name, kind, position, about) values
  ('general', 'общий', 'text', 0, 'Общий чат сайта — здесь всё, что писали раньше'),
  ('games', 'игры', 'text', 1, 'Во что поиграть, рекорды, вопросы по играм сайта'),
  ('lfg', 'поиск-тиммейтов', 'text', 2, 'Ищешь, с кем сыграть? Напиши игру и время'),
  ('memes', 'мемы', 'text', 3, 'Смешное — без жести и оскорблений'),
  ('voice', 'Голосовой', 'voice', 4, 'Голосовой канал сайта: до 6 человек')
on conflict (id) do nothing;

create table if not exists public.chat_mutes (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete cascade,
  nick text not null default '',
  until timestamptz not null,
  by_id uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_mutes_user on public.chat_mutes (user_id, until desc);
create index if not exists idx_chat_mutes_nick on public.chat_mutes (lower(nick), until desc);
alter table public.chat_mutes enable row level security;
drop policy if exists chat_mutes_read on public.chat_mutes;
create policy chat_mutes_read on public.chat_mutes for select using (user_id = auth.uid() or public.comm_is_staff());

create table if not exists public.chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null,                          -- messages.id (старую таблицу ссылками не трогаем)
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);
create unique index if not exists chat_report_once on public.chat_reports (message_id, reporter_id) where status = 'open';
create index if not exists idx_chat_reports_reporter on public.chat_reports (reporter_id, created_at desc);
alter table public.chat_reports enable row level security;
drop policy if exists chat_reports_read on public.chat_reports;
create policy chat_reports_read on public.chat_reports for select using (reporter_id = auth.uid() or public.comm_is_staff());

-- Команда сайта в чате: admin / moderator / helper (хелпер — удалять и глушить до часа)
create or replace function public.chat_staff_role(p_uid uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = p_uid and role in ('admin', 'moderator', 'helper');
$$;

-- Перед каждым сообщением: канал есть и текстовый, мут, «пишут только модераторы», медленный режим, ответ — в этом же канале
create or replace function public.chat_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ch text; c record; v_until timestamptz; v_last timestamptz; v_staff boolean := false;
begin
  if new.channel = 'general' then new.channel := null; end if;
  v_ch := coalesce(new.channel, 'general');
  new.edited_at := null;
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if;
  select * into c from public.chat_channels where id = v_ch;
  if not found or c.kind <> 'text' then raise exception 'Такого канала в чате нет'; end if;
  if new.user_id is not null then v_staff := public.chat_staff_role(new.user_id) is not null; end if;
  if not v_staff then
    select max(until) into v_until from public.chat_mutes
      where until > now() and ((new.user_id is not null and user_id = new.user_id) or (nick <> '' and lower(nick) = lower(coalesce(new.nick, ''))));
    if v_until is not null then
      raise exception 'Тебя заглушили в чате — ещё % мин', greatest(1, ceil(extract(epoch from (v_until - now())) / 60)::int);
    end if;
    if c.mods_only then raise exception 'В этом канале пишут только модераторы'; end if;
    if c.slow_sec > 0 then
      select max(created_at) into v_last from public.messages
        where coalesce(channel, 'general') = v_ch and created_at > now() - make_interval(secs => c.slow_sec)
          and ((new.user_id is not null and user_id = new.user_id) or (new.user_id is null and user_id is null and nick = new.nick));
      if v_last is not null then
        raise exception 'Медленный режим — подожди ещё % с', greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => c.slow_sec) - now())))::int);
      end if;
    end if;
  end if;
  if new.reply_to is not null and not exists (select 1 from public.messages m where m.id = new.reply_to and coalesce(m.channel, 'general') = v_ch) then
    new.reply_to := null;
  end if;
  return new;
end $$;
drop trigger if exists chat_guard on public.messages;
create trigger chat_guard before insert on public.messages for each row execute function public.chat_guard();

-- Ответ на твоё сообщение в чате → 🔔 (упоминания @ник — уже в notifications.sql)
create or replace function public.chat_reply_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  begin
    if new.reply_to is null or new.user_id is null then return null; end if;
    select user_id into target from public.messages where id = new.reply_to;
    if target is not null and target <> new.user_id then
      perform public.comm_notify(target, 'chat_reply', new.user_id, 'ответил(а) тебе в чате', left(coalesce(new.text, ''), 140),
        '#/chat/' || coalesce(new.channel, 'general'), 'chr:' || new.user_id || ':' || public.comm_bucket(5));
    end if;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists chat_reply_notify on public.messages;
create trigger chat_reply_notify after insert on public.messages for each row execute function public.chat_reply_notify();

-- Что есть в чате для меня: каналы, мой мут, могу ли модерировать (заодно — проверка «SQL выполнен»)
create or replace function public.chat_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'slow', slow_sec, 'mods_only', mods_only, 'about', about) order by position, id), '[]'::jsonb) from public.chat_channels),
    'muted_until', (select max(until) from public.chat_mutes where until > now() and auth.uid() is not null and user_id = auth.uid()),
    'staff', public.chat_staff_role());
$$;

create or replace function public.chat_edit(p_id bigint, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_text text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select id, user_id, deleted, created_at, coalesce(is_sticker, false) as st into v from public.messages where id = p_id;
  if not found or v.deleted or v.st or v.user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.created_at < now() - interval '48 hours' then return jsonb_build_object('ok', false, 'reason', 'old'); end if;
  if char_length(v_text) < 1 or char_length(v_text) > 500 then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  update public.messages set text = v_text, edited_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.chat_delete_own(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  update public.messages set deleted = true where id = p_id and user_id = auth.uid() and not deleted;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Жалоба на сообщение чата: 3 разных — сообщение скрыто, пока команда не посмотрит
create or replace function public.chat_report(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v record; n int; r record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if (select count(*) from public.chat_reports where reporter_id = uid and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  select id, user_id, deleted, text into v from public.messages where id = p_id;
  if not found or v.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.user_id = uid then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  insert into public.chat_reports (message_id, reporter_id, reason) values (p_id, uid, left(btrim(coalesce(p_reason, '')), 200)) on conflict do nothing;
  select count(distinct reporter_id) into n from public.chat_reports where message_id = p_id and status = 'open';
  if n >= 3 then update public.messages set deleted = true where id = p_id; end if;
  if n = 1 then
    for r in select id from public.profiles where role in ('admin', 'moderator') limit 20 loop
      perform public.comm_notify(r.id, 'cm_report', null, '🚩 Жалоба в общем чате', left(coalesce(v.text, ''), 140), '#/chat/reports', 'chrep:' || p_id);
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'hidden', n >= 3);
end $$;

create or replace function public.chat_reports_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.chat_staff_role(), '') not in ('admin', 'moderator') then return null; end if;
  return (select coalesce(jsonb_agg(x order by x.n desc, x.at desc), '[]'::jsonb) from (
    select r.message_id as mid, count(*) as n, max(r.created_at) as at, string_agg(distinct nullif(r.reason, ''), ' · ') as reasons,
      max(m.text) as text, max(m.nick) as author, (array_agg(m.user_id))[1] as target, bool_or(coalesce(m.deleted, false)) as hidden,
      max(coalesce(m.channel, 'general')) as channel
    from public.chat_reports r left join public.messages m on m.id = r.message_id
    where r.status = 'open' group by r.message_id order by count(*) desc limit 100) x);
end $$;

create or replace function public.chat_report_resolve(p_id bigint, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.chat_staff_role(), '') not in ('admin', 'moderator') then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_action = 'restore' then update public.messages set deleted = false where id = p_id;
  elsif p_action = 'delete' then update public.messages set deleted = true where id = p_id;
  else return jsonb_build_object('ok', false, 'reason', 'action'); end if;
  update public.chat_reports set status = 'done' where message_id = p_id and status = 'open';
  return jsonb_build_object('ok', true);
end $$;

-- Мут в общем чате на N минут (0 — снять). Гостя — по нику. Хелпер — до часа; команду сайта глушит только админ
create or replace function public.chat_mute(p_user uuid, p_nick text, p_minutes int, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.chat_staff_role(); tr text; v_nick text := left(btrim(coalesce(p_nick, '')), 24);
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if coalesce(p_minutes, -1) < 0 or p_minutes > 10080 or (me = 'helper' and p_minutes > 60) then return jsonb_build_object('ok', false, 'reason', 'minutes'); end if;
  if p_user is not null then
    if p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
    tr := public.chat_staff_role(p_user);
    if tr is not null and me <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
    select nick into v_nick from public.profiles where id = p_user;
  elsif v_nick = '' then return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.chat_mutes set until = now() where until > now() and ((p_user is not null and user_id = p_user) or (p_user is null and lower(nick) = lower(v_nick)));
  if p_minutes > 0 then
    insert into public.chat_mutes (user_id, nick, until, by_id, reason)
      values (p_user, coalesce(v_nick, ''), now() + make_interval(mins => p_minutes), auth.uid(), left(btrim(coalesce(p_reason, '')), 200));
    perform public.comm_notify(p_user, 'cm_mod', auth.uid(), 'заглушил(а) тебя в чате на ' || p_minutes || ' мин', coalesce(p_reason, ''), '#/chat', 'chmute:' || public.comm_bucket(5));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Настройки канала чата (медленный режим, «пишут только модераторы») — админ и модераторы
create or replace function public.chat_channel_set(p_id text, p_slow int, p_mods_only boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.chat_staff_role(), '') not in ('admin', 'moderator') then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if coalesce(p_slow, 0) < 0 or p_slow > 3600 then return jsonb_build_object('ok', false, 'reason', 'slow'); end if;
  update public.chat_channels set slow_sec = coalesce(p_slow, slow_sec), mods_only = coalesce(p_mods_only, mods_only) where id = p_id and kind = 'text';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ═══ Закреп сообщений в сообществах (модераторы, до 25 на канал) ═══
alter table public.community_messages add column if not exists pinned_at timestamptz;
create or replace function public.cm_pin(p_id bigint, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.community_messages where id = p_id;
  if not found or v.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_is_mod(v.community_id) and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if p_on and v.pinned_at is null and (select count(*) from public.community_messages where channel_id = v.channel_id and pinned_at is not null and not deleted) >= 25 then
    return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  update public.community_messages set pinned_at = case when p_on then now() end where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

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
    'comm_ping(text)', 'friends_online()', 'chat_edit(bigint,text)', 'chat_delete_own(bigint)', 'chat_report(bigint,text)',
    'chat_reports_list()', 'chat_report_resolve(bigint,text)', 'chat_mute(uuid,text,integer,text)', 'chat_channel_set(text,integer,boolean)',
    'cm_pin(bigint,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on function public.cm_invite_info(text) to anon, authenticated';
  execute 'grant execute on function public.cm_list_public(text) to anon, authenticated';
  execute 'grant execute on function public.chat_info() to anon, authenticated';
end $$;
revoke all on function public.comm_members_count() from public, anon, authenticated;
-- помощники с чужим id (кто в каком сообществе, кто с кем дружит) — только для функций выше
revoke all on function public.comm_role(bigint, uuid) from public, anon, authenticated;
revoke all on function public.comm_banned(bigint, uuid) from public, anon, authenticated;
revoke all on function public.comm_can_mod(bigint, uuid, uuid) from public, anon, authenticated;
revoke all on function public.comm_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_reply_notify() from public, anon, authenticated;
revoke all on function public.chat_guard() from public, anon, authenticated;

-- ═══ Realtime: новые сообщения каналов сообществ — сразу (RLS решает, кому что придёт) ═══
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'community_messages') then
      alter publication supabase_realtime add table public.community_messages;
    end if;
  end if;
end $$;


-- ═══════════════════════════════════════════════════════════════════
--  ЧАСТЬ 2. «Денчик-бот», 📢 новости, 📅 события, 🧭 обзор (до 16.10.2026 — community2.sql)
-- ═══════════════════════════════════════════════════════════════════

-- chat-stickers.sql на живой базе не применён, а триггер messages_enforce_status (vip-balance.sql) пишет new.is_sticker
alter table public.messages add column if not exists is_sticker boolean not null default false;

-- ═══ 1. «Денчик-бот» и канал «📢 новости» ═══
-- position −1 — над #общий (как «объявления» в Дискорде); сайт по умолчанию всё равно открывает #общий
insert into public.chat_channels (id, name, kind, position, mods_only, about) values
  ('news', 'новости', 'text', -1, true, '📢 Эфиры, новые видео и события — пишут Денчик-бот и команда сайта')
on conflict (id) do nothing;

-- Что бот уже написал (повод → сообщение): один и тот же эфир / ролик / праздник — один раз
create table if not exists public.bot_posts (
  key text primary key check (char_length(key) between 1 and 80),
  message_id bigint,
  created_at timestamptz not null default now()
);
alter table public.bot_posts enable row level security;
revoke all on public.bot_posts from anon, authenticated;

-- Сообщение от бота в канал сервера «Денчик37». Только для сервера (service_role): триггеры чата (chat_guard,
-- messages_enforce_status, флуд) такие вставки пропускают как есть — поэтому браузеру функция не выдаётся.
-- p_key — повод («stream:…», «video:<id>»): уже было — { ok, dup: true }, второго сообщения нет.
create or replace function public.bot_post(p_channel text, p_text text, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ch text := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), 'news'); v_text text := left(btrim(coalesce(p_text, '')), 500);
  v_key text := left(nullif(btrim(coalesce(p_key, '')), ''), 80); v_id bigint;
begin
  if v_text = '' then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  if not exists (select 1 from public.chat_channels where id = v_ch and kind = 'text') then v_ch := 'general'; end if;
  if v_key is not null then
    insert into public.bot_posts (key) values (v_key) on conflict (key) do nothing;
    if not found then return jsonb_build_object('ok', true, 'dup', true); end if;
  end if;
  insert into public.messages (nick, text, color, role, user_id, channel)
    values ('Денчик-бот', v_text, '#5865f2', 'bot', null, case when v_ch = 'general' then null else v_ch end)
    returning id into v_id;
  if v_key is not null then update public.bot_posts set message_id = v_id where key = v_key; end if;
  delete from public.bot_posts where created_at < now() - interval '400 days';
  return jsonb_build_object('ok', true, 'id', v_id, 'channel', v_ch);
end $$;
revoke all on function public.bot_post(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_post(text, text, text) to service_role;

-- ═══ 2. События 📅 (как Discord Events) ═══
create table if not exists public.comm_events (
  id bigint generated always as identity primary key,
  community_id bigint references public.communities(id) on delete cascade,   -- null — сервер сайта «Денчик37»
  creator_id uuid references public.profiles(id) on delete set null,
  creator_nick text not null default '',
  title text not null check (char_length(title) between 2 and 80),
  about text not null default '' check (char_length(about) <= 500),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  place_kind text not null default 'none' check (place_kind in ('none', 'text', 'voice', 'world', 'game', 'stream')),
  place text not null default '' check (char_length(place) <= 40),   -- номер / id канала, id игры
  age int not null default 0 check (age in (0, 6, 12, 16, 18)),
  going int not null default 0,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cev_time check (ends_at > starts_at)
);
create index if not exists idx_cev_comm on public.comm_events (community_id, starts_at) where status = 'active';
create index if not exists idx_cev_remind on public.comm_events (starts_at) where status = 'active' and reminded_at is null;
create index if not exists idx_cev_creator on public.comm_events (creator_id, created_at desc);

create table if not exists public.comm_event_rsvp (
  event_id bigint not null references public.comm_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists idx_cevr_user on public.comm_event_rsvp (user_id, created_at desc);
alter table public.comm_events enable row level security;
alter table public.comm_event_rsvp enable row level security;
-- читать — только функциями ниже (политик нет)

-- Права в сообществе по «биту» (2 — модерация, 4 — закреп, 8 — события…): персонал сайта, владелец, модератор
create or replace function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (public.comm_is_staff(p_uid)
    or coalesce((select role in ('owner', 'mod') from public.community_members where community_id = p_cid and user_id = p_uid), false));
$$;
-- Кто ведёт события: на сервере сайта — админ и модераторы, в сообществе — у кого право «события»
create or replace function public.comm_ev_can(p_cid bigint, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin', 'moderator')
    else public.comm_perm(p_cid, p_uid, 8) end;
$$;
-- Видно ли: сервер сайта — всем, открытое сообщество — всем, закрытое — участникам (и персоналу)
create or replace function public.comm_ev_visible(p_cid bigint, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cid is null or public.comm_is_staff(p_uid) or exists (select 1 from public.communities c where c.id = p_cid and c.status = 'active'
    and (c.is_public or exists (select 1 from public.community_members m where m.community_id = p_cid and m.user_id = p_uid)));
$$;
-- Сколько «+» можно человеку (age.sql): до 13 — 6+, 13–15 — 12+, 16–17 — 16+, взрослый — 18+, не указан — 16+
create or replace function public.comm_age_cap(p_uid uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare g text := 'unknown';
begin
  if p_uid is not null and to_regprocedure('public.age_group_of(uuid)') is not null then g := public.age_group_of(p_uid); end if;
  return case g when 'child' then 6 when 'teen' then 12 when 'teen16' then 16 when 'adult' then 18 else 16 end;
end $$;

create or replace function public.comm_ev_json(e public.comm_events, p_uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'community', e.community_id, 'title', e.title, 'about', e.about,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'place_kind', e.place_kind, 'place', e.place, 'age', e.age,
    'going', e.going, 'status', e.status, 'creator', e.creator_nick,
    'mine', p_uid is not null and exists (select 1 from public.comm_event_rsvp r where r.event_id = e.id and r.user_id = p_uid),
    'can', public.comm_ev_can(e.community_id, p_uid),
    'place_name', case when e.place_kind in ('text', 'voice') then case when e.community_id is null
        then (select x.name from public.chat_channels x where x.id = e.place)
        else (select x.name from public.community_channels x where x.id::text = e.place and x.community_id = e.community_id) end end,
    'cname', (select c.name from public.communities c where c.id = e.community_id),
    'cicon', (select c.icon from public.communities c where c.id = e.community_id));
$$;

-- 🔔 «скоро начнётся» тем, кто нажал «✅ Пойду» (одно уведомление на событие и время начала). Зовут крон (bot_event_remind)
-- и, запасом, чтение событий. События без «Пойду» не помечаются — кто нажмёт позже, тоже получит
create or replace function public.comm_ev_remind_run(p_limit int default 20)
returns int language plpgsql security definer set search_path = public as $$
declare e record; u record; n int := 0; v_title text; v_min int;
begin
  for e in select * from public.comm_events x where x.status = 'active' and x.reminded_at is null
      and x.starts_at <= now() + interval '15 minutes' and x.ends_at > now()
      and exists (select 1 from public.comm_event_rsvp r where r.event_id = x.id)
      order by x.starts_at limit greatest(1, least(coalesce(p_limit, 20), 50)) for update skip locked loop
    update public.comm_events set reminded_at = now() where id = e.id;
    v_min := ceil(extract(epoch from (e.starts_at - now())) / 60)::int;
    v_title := case when v_min <= 1 then '📅 Начинается: «' else '📅 Через ' || v_min || ' мин: «' end || left(e.title, 60) || '»';
    for u in select user_id from public.comm_event_rsvp where event_id = e.id limit 2000 loop
      perform public.comm_notify(u.user_id, 'cm_event', null, v_title, left(e.about, 140), '#/chat/ev/' || e.id,
        'ev:' || e.id || ':' || extract(epoch from e.starts_at)::bigint);
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;
create or replace function public.bot_event_remind()
returns int language sql security definer set search_path = public as $$ select public.comm_ev_remind_run(50); $$;
-- запасной вызов при чтении: только-чтение / ошибка — молча
create or replace function public.comm_ev_remind_soft()
returns void language plpgsql security definer set search_path = public as $$
begin
  begin perform public.comm_ev_remind_run(3); exception when others then null; end;
end $$;

-- События сервера (p_community null — «Денчик37»): идут и будущие, по времени
create or replace function public.cm_events(p_community bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  perform public.comm_ev_remind_soft();
  if p_community is not null and not public.comm_ev_visible(p_community, uid) then return jsonb_build_object('ok', false, 'reason', 'private'); end if;
  return jsonb_build_object('ok', true, 'can', public.comm_ev_can(p_community, uid), 'list',
    (select coalesce(jsonb_agg(public.comm_ev_json(e, uid) order by e.starts_at, e.id), '[]'::jsonb) from public.comm_events e
      where e.id in (select x.id from public.comm_events x where x.community_id is not distinct from p_community and x.status = 'active' and x.ends_at > now()
        order by x.starts_at limit 30)));
end $$;

create or replace function public.cm_event_get(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.comm_events%rowtype;
begin
  perform public.comm_ev_remind_soft();
  select * into e from public.comm_events where id = p_id;
  if not found or not public.comm_ev_visible(e.community_id, uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'ev', public.comm_ev_json(e, uid));
end $$;

-- Создать (p_id null) или изменить событие. Новое — карточкой в канал: сервер сайта — «📢 новости», сообщество — p_announce
-- или первый текстовый канал. Перенесли время — тем, кто идёт, 🔔 и новое напоминание
create or replace function public.cm_event_save(p_id bigint, p_community bigint, p_title text, p_about text, p_start timestamptz, p_minutes int,
  p_place_kind text, p_place text, p_age int, p_announce bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_title text := btrim(coalesce(p_title, '')); v_about text := btrim(coalesce(p_about, ''));
  v_kind text := coalesce(nullif(btrim(coalesce(p_place_kind, '')), ''), 'none'); v_place text := btrim(coalesce(p_place, ''));
  v_age int := coalesce(p_age, 0); v_min int := coalesce(p_minutes, 60); e public.comm_events%rowtype; c record;
  v_id bigint; v_nick text; v_ch bigint; v_text text; u record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_id is not null then
    select * into e from public.comm_events where id = p_id;
    if not found or e.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    p_community := e.community_id;
  end if;
  if p_community is not null then
    select * into c from public.communities where id = p_community;
    if not found or c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  end if;
  if not public.comm_ev_can(p_community, uid) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_title) < 2 or char_length(v_title) > 80 then return jsonb_build_object('ok', false, 'reason', 'title'); end if;
  if char_length(v_about) > 500 then return jsonb_build_object('ok', false, 'reason', 'about'); end if;
  if public.comm_bad(v_title) or public.comm_bad(v_about) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.comm_has_link(v_title) or public.comm_has_link(v_about) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if p_start is null or p_start > now() + interval '90 days'
     or (p_start < now() - interval '5 minutes' and (p_id is null or p_start <> e.starts_at)) then
    return jsonb_build_object('ok', false, 'reason', 'time'); end if;
  if v_min < 15 or v_min > 720 then return jsonb_build_object('ok', false, 'reason', 'minutes'); end if;
  if v_age not in (0, 6, 12, 16, 18) or (v_age = 18 and not public.comm_is_staff(uid)) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  if v_kind in ('none', 'world', 'stream') then v_place := '';
  elsif v_kind in ('text', 'voice') then
    if p_community is null then
      if not exists (select 1 from public.chat_channels where id = v_place and kind = v_kind) then return jsonb_build_object('ok', false, 'reason', 'place'); end if;
    elsif v_place !~ '^[0-9]{1,18}$' or not exists (select 1 from public.community_channels where id = v_place::bigint and community_id = p_community and kind = v_kind) then
      return jsonb_build_object('ok', false, 'reason', 'place');
    end if;
  elsif v_kind = 'game' then
    if v_place !~ '^[a-z0-9]{2,24}$' then return jsonb_build_object('ok', false, 'reason', 'place'); end if;
  else
    return jsonb_build_object('ok', false, 'reason', 'place');
  end if;

  if p_id is not null then
    update public.comm_events set title = v_title, about = v_about, starts_at = p_start, ends_at = p_start + make_interval(mins => v_min),
      place_kind = v_kind, place = v_place, age = v_age, reminded_at = case when p_start = e.starts_at then reminded_at end
      where id = p_id;
    if p_start <> e.starts_at then
      for u in select user_id from public.comm_event_rsvp where event_id = p_id limit 2000 loop
        perform public.comm_notify(u.user_id, 'cm_event', uid, 'перенёс(ла) событие «' || left(v_title, 60) || '»', '', '#/chat/ev/' || p_id,
          'evm:' || p_id || ':' || extract(epoch from p_start)::bigint);
      end loop;
    end if;
    return jsonb_build_object('ok', true, 'id', p_id);
  end if;

  -- новое: не больше 15 будущих на сервер и 6 новых в час от человека
  if (select count(*) from public.comm_events where community_id is not distinct from p_community and status = 'active' and ends_at > now()) >= 15 then
    return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  if (select count(*) from public.comm_events where creator_id = uid and created_at > now() - interval '1 hour') >= 6 then
    return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  select nick into v_nick from public.profiles where id = uid;
  insert into public.comm_events (community_id, creator_id, creator_nick, title, about, starts_at, ends_at, place_kind, place, age)
    values (p_community, uid, coalesce(v_nick, ''), v_title, v_about, p_start, p_start + make_interval(mins => v_min), v_kind, v_place, v_age)
    returning id into v_id;
  v_text := '📅 Новое событие: «' || v_title || '» → #/chat/ev/' || v_id;
  if p_community is null then
    begin   -- от имени того, кто создал (команда сайта пишет в «📢 новости»); мут или флуд — событие всё равно есть
      insert into public.messages (nick, text, user_id, channel)
        values (coalesce(v_nick, ''), v_text, uid, case when exists (select 1 from public.chat_channels where id = 'news' and kind = 'text') then 'news' end);
    exception when others then null;
    end;
  else
    select id into v_ch from public.community_channels where id = p_announce and community_id = p_community and kind = 'text';
    if v_ch is null then select id into v_ch from public.community_channels where community_id = p_community and kind = 'text' order by position, id limit 1; end if;
    if v_ch is not null then
      insert into public.community_messages (channel_id, community_id, user_id, nick, text) values (v_ch, p_community, uid, coalesce(v_nick, ''), v_text);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cm_event_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.comm_events%rowtype; u record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into e from public.comm_events where id = p_id;
  if not found or e.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_ev_can(e.community_id, uid) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  update public.comm_events set status = 'cancelled' where id = p_id;
  if e.ends_at > now() then
    for u in select user_id from public.comm_event_rsvp where event_id = p_id limit 2000 loop
      perform public.comm_notify(u.user_id, 'cm_event', uid, 'отменил(а) событие «' || left(e.title, 60) || '»', '', '#/chat/ev/' || p_id, 'evc:' || p_id);
    end loop;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- «✅ Пойду» / передумал: участникам сообщества (сервер сайта — всем вошедшим), по возрасту, до конца события
create or replace function public.cm_event_rsvp(p_id bigint, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e public.comm_events%rowtype; n int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into e from public.comm_events where id = p_id;
  if not found or e.status <> 'active' or not public.comm_ev_visible(e.community_id, uid) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if e.ends_at <= now() then return jsonb_build_object('ok', false, 'reason', 'over'); end if;
  if e.community_id is not null and not public.comm_is_staff(uid)
     and not exists (select 1 from public.community_members where community_id = e.community_id and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if coalesce(p_on, true) then
    if e.age > public.comm_age_cap(uid) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
    if (select count(*) from public.comm_event_rsvp where user_id = uid and created_at > now() - interval '10 minutes') >= 20 then
      return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
    insert into public.comm_event_rsvp (event_id, user_id) values (p_id, uid) on conflict do nothing;
  else
    delete from public.comm_event_rsvp where event_id = p_id and user_id = uid;
  end if;
  update public.comm_events set going = (select count(*) from public.comm_event_rsvp where event_id = p_id) where id = p_id returning going into n;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true), 'going', n);
end $$;

do $$
declare f text;
begin
  foreach f in array array['cm_event_save(bigint,bigint,text,text,timestamptz,integer,text,text,integer,bigint)', 'cm_event_cancel(bigint)', 'cm_event_rsvp(bigint,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['cm_events(bigint)', 'cm_event_get(bigint)'] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  -- помощники с чужим id — только для функций выше
  foreach f in array array['comm_perm(bigint,uuid,integer)', 'comm_ev_can(bigint,uuid)', 'comm_ev_visible(bigint,uuid)', 'comm_age_cap(uuid)',
      'comm_ev_json(public.comm_events,uuid)', 'comm_ev_remind_run(integer)', 'comm_ev_remind_soft()', 'bot_event_remind()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.bot_event_remind() to service_role';
end $$;

-- ═══ 3. Обзор сообществ 🧭: категории, возрастная метка, «большие / активные / новые» ═══
alter table public.communities add column if not exists category text not null default 'chat';
alter table public.communities add column if not exists age int not null default 0;
alter table public.communities add column if not exists active_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communities_category_chk') then
    alter table public.communities add constraint communities_category_chk check (category in ('games', 'art', 'chat', 'study', 'stream'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'communities_age_chk') then
    alter table public.communities add constraint communities_age_chk check (age in (0, 6, 12, 16, 18));
  end if;
end $$;
create index if not exists idx_comm_new on public.communities (created_at desc) where status = 'active' and is_public;
create index if not exists idx_comm_active on public.communities (active_at desc nulls last) where status = 'active' and is_public;

-- «Живость»: время последнего сообщения (пишется не чаще раза в минуту)
create or replace function public.comm_touch_active()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.communities set active_at = now() where id = new.community_id and (active_at is null or active_at < now() - interval '1 minute');
  return null;
end $$;
drop trigger if exists comm_touch_active on public.community_messages;
create trigger comm_touch_active after insert on public.community_messages for each row execute function public.comm_touch_active();
revoke all on function public.comm_touch_active() from public, anon, authenticated;
update public.communities c set active_at = (select max(m.created_at) from public.community_messages m where m.community_id = c.id) where c.active_at is null;

-- Категория и возрастная метка сообщества — владелец (18+ — только персонал сайта)
create or replace function public.cm_set_meta(p_id bigint, p_category text, p_age int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_id), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if coalesce(p_category, '') not in ('games', 'art', 'chat', 'study', 'stream') then return jsonb_build_object('ok', false, 'reason', 'category'); end if;
  if coalesce(p_age, -1) not in (0, 6, 12, 16, 18) or (p_age = 18 and not public.comm_is_staff()) then return jsonb_build_object('ok', false, 'reason', 'age'); end if;
  update public.communities set category = p_category, age = p_age where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Обзор: открытые сообщества по поиску, категории и сортировке (members — большие, active — живые, new — новые); по 24.
-- Не по возрасту (age.sql: группа вошедшего; гость — «не указан», до 16+) — не показываем
create or replace function public.cm_catalog(p_q text default null, p_cat text default null, p_sort text default 'members', p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); cap int := public.comm_age_cap(auth.uid());
  q text := replace(replace(replace(left(btrim(coalesce(p_q, '')), 40), '%', ''), '_', ''), '\', '');
begin
  return (select coalesce(jsonb_agg(to_jsonb(x) - 'srt' order by x.srt desc, x.id desc), '[]'::jsonb) from (
    select c.id, c.name, c.about, c.icon, c.members, c.category, c.age, c.created_at, c.active_at,
      exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = uid) as mine,
      case when p_sort = 'new' then extract(epoch from c.created_at)::float8
           when p_sort = 'active' then coalesce(extract(epoch from c.active_at)::float8, 0)
           else c.members::float8 end as srt
    from public.communities c
    where c.status = 'active' and c.is_public and c.age <= cap
      and (coalesce(p_cat, '') = '' or c.category = p_cat)
      and (q = '' or c.name ilike '%' || q || '%' or c.about ilike '%' || q || '%')
    order by srt desc, c.id desc
    limit 24 offset greatest(0, least(coalesce(p_offset, 0), 480))) x);
end $$;

-- Приглашение: + категория и метка (страница /c/<код>, карточка в ленте)
create or replace function public.cm_invite_info(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'about', c.about, 'icon', c.icon, 'members', c.members, 'public', c.is_public,
    'category', c.category, 'age', c.age)
  from public.communities c where c.invite_code = lower(btrim(coalesce(p_code, ''))) and c.status = 'active';
$$;

-- Вступить (как в ч. 1) + возрастная метка: не по возрасту — 'age'
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
  if c.age > public.comm_age_cap(uid) and not public.comm_is_staff(uid) then return jsonb_build_object('ok', false, 'reason', 'age', 'age', c.age); end if;
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

do $$
begin
  execute 'revoke all on function public.cm_set_meta(bigint,text,integer) from public, anon';
  execute 'grant execute on function public.cm_set_meta(bigint,text,integer) to authenticated';
  execute 'grant execute on function public.cm_catalog(text,text,text,integer) to anon, authenticated';
  execute 'grant execute on function public.cm_invite_info(text) to anon, authenticated';
  execute 'revoke all on function public.cm_join(bigint,text) from public, anon';
  execute 'grant execute on function public.cm_join(bigint,text) to authenticated';
end $$;


-- ═══════════════════════════════════════════════════════════════════
--  ЧАСТЬ 3. 🎭 свои роли, @everyone, 🚀 буст (до 16.10.2026 — community3.sql)
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Свои роли 🎭 ═══
create table if not exists public.comm_roles (
  id bigint generated always as identity primary key,
  community_id bigint not null references public.communities(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  color text not null default '#99aab5' check (color ~ '^#[0-9a-f]{6}$'),
  position int not null default 1 check (position between 1 and 99),
  perms int not null default 0 check (perms between 0 and 31),
  created_at timestamptz not null default now()
);
create index if not exists idx_croles_comm on public.comm_roles (community_id, position desc);
create table if not exists public.comm_member_roles (
  community_id bigint not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id bigint not null references public.comm_roles(id) on delete cascade,
  primary key (role_id, user_id)
);
create index if not exists idx_cmroles_user on public.comm_member_roles (community_id, user_id);
alter table public.comm_roles enable row level security;
alter table public.comm_member_roles enable row level security;
-- читать — только функциями ниже (политик нет)
alter table public.communities add column if not exists everyone_at timestamptz;   -- последний @everyone (раз в 10 минут)

-- Вышел / выгнали / забанили — его роли снимаются
create or replace function public.comm_roles_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.comm_member_roles where community_id = old.community_id and user_id = old.user_id;
  return null;
end $$;
drop trigger if exists comm_roles_on_leave on public.community_members;
create trigger comm_roles_on_leave after delete on public.community_members for each row execute function public.comm_roles_on_leave();

-- Права своих ролей человека (все роли вместе) и место верхней (0 — ролей нет)
create or replace function public.comm_role_bits(p_cid bigint, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(bit_or(r.perms), 0)::int from public.comm_member_roles m join public.comm_roles r on r.id = m.role_id
  where m.community_id = p_cid and m.user_id = p_uid;
$$;
create or replace function public.comm_role_top(p_cid bigint, p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(r.position), 0)::int from public.comm_member_roles m join public.comm_roles r on r.id = m.role_id
  where m.community_id = p_cid and m.user_id = p_uid;
$$;
-- Право по «биту»: персонал сайта, владелец и модератор — всё; участник — по своим ролям (ч. 2: события — бит 8)
create or replace function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (public.comm_is_staff(p_uid)
    or coalesce((select role in ('owner', 'mod') from public.community_members where community_id = p_cid and user_id = p_uid), false)
    or (exists (select 1 from public.community_members where community_id = p_cid and user_id = p_uid)
        and (public.comm_role_bits(p_cid, p_uid) & p_bit) <> 0));
$$;
-- Кого можно наказывать (мут, кик, бан, удалить сообщение): как в ч. 1 + роль с модерацией — участников ниже себя
create or replace function public.comm_can_mod(p_cid bigint, p_actor uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_actor is not null and p_target is not null and p_actor <> p_target and (
    public.comm_is_staff(p_actor)
    or (select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'owner'
    or ((select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'mod'
        and coalesce((select role from public.community_members where community_id = p_cid and user_id = p_target), 'member') = 'member')
    or ((select role from public.community_members where community_id = p_cid and user_id = p_actor) = 'member'
        and coalesce((select role from public.community_members where community_id = p_cid and user_id = p_target), 'member') = 'member'
        and (public.comm_role_bits(p_cid, p_actor) & 2) <> 0
        and public.comm_role_top(p_cid, p_actor) > public.comm_role_top(p_cid, p_target)));
$$;

-- Роли сообщества + мои права (клиенту: цвета ников, группы участников, какие кнопки показывать)
create or replace function public.cm_roles(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_is_member(p_id) or public.comm_is_staff()
      or exists (select 1 from public.communities c where c.id = p_id and c.status = 'active' and c.is_public) then
    jsonb_build_object('ok', true,
      'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'color', r.color, 'position', r.position, 'perms', r.perms)
        order by r.position desc, r.id) from public.comm_roles r where r.community_id = p_id), '[]'::jsonb),
      'my', public.comm_role_bits(p_id, auth.uid()), 'top', public.comm_role_top(p_id, auth.uid()))
  else jsonb_build_object('ok', false, 'reason', 'private') end;
$$;

-- Создать (p_id null) / изменить роль — владелец (и персонал сайта)
create or replace function public.cm_role_save(p_community bigint, p_id bigint, p_name text, p_color text, p_position int, p_perms int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_color text := lower(btrim(coalesce(p_color, ''))); v_id bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_community), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 24 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if public.comm_bad(v_name) or public.comm_has_link(v_name) or v_name ~ '[<>@]' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if v_color !~ '^#[0-9a-f]{6}$' then v_color := '#99aab5'; end if;
  if coalesce(p_position, 0) < 1 or p_position > 99 then return jsonb_build_object('ok', false, 'reason', 'position'); end if;
  if coalesce(p_perms, -1) < 0 or p_perms > 31 then return jsonb_build_object('ok', false, 'reason', 'perms'); end if;
  if p_id is null then
    if (select count(*) from public.comm_roles where community_id = p_community) >= 20 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    insert into public.comm_roles (community_id, name, color, position, perms) values (p_community, v_name, v_color, p_position, p_perms) returning id into v_id;
  else
    update public.comm_roles set name = v_name, color = v_color, position = p_position, perms = p_perms
      where id = p_id and community_id = p_community returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cm_role_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid bigint;
begin
  select community_id into cid from public.comm_roles where id = p_id;
  if cid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if coalesce(public.comm_role(cid), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.comm_roles where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Выдать / снять роль участнику — владелец (и персонал сайта); у человека до 5 ролей; выдали — 🔔
create or replace function public.cm_role_assign(p_community bigint, p_user uuid, p_role bigint, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; c record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_community), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  select * into r from public.comm_roles where id = p_role and community_id = p_community;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not exists (select 1 from public.community_members where community_id = p_community and user_id = p_user) then
    return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if coalesce(p_on, true) then
    if not exists (select 1 from public.comm_member_roles where role_id = p_role and user_id = p_user)
       and (select count(*) from public.comm_member_roles where community_id = p_community and user_id = p_user) >= 5 then
      return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    insert into public.comm_member_roles (community_id, user_id, role_id) values (p_community, p_user, p_role) on conflict do nothing;
    if found then
      select name into c from public.communities where id = p_community;
      perform public.comm_notify(p_user, 'cm_mod', auth.uid(), 'выдал(а) тебе роль «' || r.name || '» в «' || left(c.name, 40) || '»', '',
        '#/phone/comm/' || p_community, 'cmrole:' || p_role || ':' || p_user);
    end if;
  else
    delete from public.comm_member_roles where role_id = p_role and user_id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true));
end $$;

-- Участники (как в ч. 1) + номера их ролей (выше — первой)
create or replace function public.cm_members(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_is_member(p_id) or public.comm_is_staff() then (
    select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'nick', p.nick, 'role', m.role,
        'muted_until', case when m.muted_until > now() then m.muted_until end,
        'roles', coalesce((select jsonb_agg(mr.role_id order by r.position desc, r.id) from public.comm_member_roles mr
          join public.comm_roles r on r.id = mr.role_id where mr.community_id = p_id and mr.user_id = m.user_id), '[]'::jsonb))
      order by case m.role when 'owner' then 0 when 'mod' then 1 else 2 end, lower(p.nick)), '[]'::jsonb)
    from public.community_members m join public.profiles p on p.id = m.user_id
    where m.community_id = p_id) end;
$$;

-- Баны: список и разбан — право «модерация» (как было: владелец и модераторы)
create or replace function public.cm_bans(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_perm(p_id, auth.uid(), 2) then (
    select coalesce(jsonb_agg(jsonb_build_object('id', b.user_id, 'nick', p.nick, 'reason', b.reason, 'until', b.until, 'at', b.created_at) order by b.created_at desc), '[]'::jsonb)
    from public.community_bans b join public.profiles p on p.id = b.user_id
    where b.community_id = p_id and (b.until is null or b.until > now())) end;
$$;
create or replace function public.cm_unban(p_community bigint, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.comm_perm(p_community, auth.uid(), 2) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.community_bans where community_id = p_community and user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- Закреп — право «закреп» (до 25 на канал, как было)
create or replace function public.cm_pin(p_id bigint, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.community_messages where id = p_id;
  if not found or v.deleted then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_perm(v.community_id, auth.uid(), 4) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if p_on and v.pinned_at is null and (select count(*) from public.community_messages where channel_id = v.channel_id and pinned_at is not null and not deleted) >= 25 then
    return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  update public.community_messages set pinned_at = case when p_on then now() end where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Каналы — право «каналы» (cm_channel_save) — ниже, в разделе 2 (там же лимит каналов с бустом)

-- @everyone / @все: владелец, модераторы, роль с правом 16 → 🔔 всем участникам (до 500), раз в 10 минут на сообщество
create or replace function public.comm_everyone_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; u record;
begin
  begin
    if new.user_id is null or coalesce(new.text, '') !~* '(^|[[:space:]])@(everyone|все|here)([[:space:][:punct:]]|$)' then return null; end if;
    if not public.comm_perm(new.community_id, new.user_id, 16) then return null; end if;
    update public.communities set everyone_at = now() where id = new.community_id and (everyone_at is null or everyone_at < now() - interval '10 minutes')
      returning name into c;
    if not found then return null; end if;
    for u in select user_id from public.community_members where community_id = new.community_id and user_id <> new.user_id limit 500 loop
      perform public.comm_notify(u.user_id, 'cm_mention', new.user_id, '@everyone в «' || left(c.name, 40) || '»', left(new.text, 140),
        '#/phone/comm/' || new.community_id || '/' || new.channel_id, 'cme:' || new.community_id || ':' || public.comm_bucket(10));
    end loop;
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists comm_everyone_notify on public.community_messages;
create trigger comm_everyone_notify after insert on public.community_messages for each row execute function public.comm_everyone_notify();

do $$
declare f text;
begin
  foreach f in array array['cm_role_save(bigint,bigint,text,text,integer,integer)', 'cm_role_delete(bigint)', 'cm_role_assign(bigint,uuid,bigint,boolean)',
      'cm_members(bigint)', 'cm_bans(bigint)', 'cm_unban(bigint,uuid)', 'cm_pin(bigint,boolean)', 'cm_channel_save(bigint,bigint,text,text,integer,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'grant execute on function public.cm_roles(bigint) to anon, authenticated';
  foreach f in array array['comm_role_bits(bigint,uuid)', 'comm_role_top(bigint,uuid)', 'comm_perm(bigint,uuid,integer)', 'comm_can_mod(bigint,uuid,uuid)',
      'comm_roles_on_leave()', 'comm_everyone_notify()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ═══ 2. «🚀 Буст» сообщества за 💎 — только красота и удобство ═══
-- Покупает любой участник (себе или в подарок сообществу): 30 дней — 100 💎, 90 — 270 💎, сроки складываются.
-- Что даёт: баннер (в обзоре и над каналами), анимированный значок, красивая ссылка /c/<имя> (6–12 латинских букв и цифр),
-- до 40 каналов (голосовых до 10) вместо 20 / 5, значок 🚀 в обзоре. Место в обзоре буст НЕ поднимает.
-- Своих эмодзи у сообществ нет (картинки игроки не загружают — детская аудитория), поэтому «больше слотов эмодзи» не продаём.
-- 💎 списывает premium_add (premium.sql) прямо отсюда — каталог premium_items не трогаем.
create table if not exists public.comm_boosts (
  community_id bigint primary key references public.communities(id) on delete cascade,
  until timestamptz not null default now(),
  banner text not null default '' check (banner ~ '^[a-z0-9]{0,16}$'),
  anim boolean not null default false,
  vanity text unique check (vanity is null or vanity ~ '^[a-z0-9]{6,12}$'),
  updated_at timestamptz not null default now()
);
create table if not exists public.comm_boost_log (
  id bigint generated always as identity primary key,
  community_id bigint not null references public.communities(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  months int not null,
  gems int not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_cboost_log on public.comm_boost_log (community_id, created_at desc);
create index if not exists idx_cboost_log_user on public.comm_boost_log (user_id, created_at desc);
alter table public.comm_boosts enable row level security;
alter table public.comm_boost_log enable row level security;

create or replace function public.comm_boost_price(p_months int)
returns int language sql immutable as $$ select case p_months when 1 then 100 when 3 then 270 end; $$;
create or replace function public.comm_boosted(p_cid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.comm_boosts where community_id = p_cid and until > now());
$$;
-- Код приглашения или красивая ссылка буста → номер сообщества
create or replace function public.comm_by_code(p_code text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select id from public.communities where invite_code = lower(btrim(coalesce(p_code, '')))),
    (select community_id from public.comm_boosts where vanity = lower(btrim(coalesce(p_code, ''))) and until > now()));
$$;

create or replace function public.cm_boost_buy(p_community bigint, p_months int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c record; v_price int := public.comm_boost_price(p_months); bal int; v_until timestamptz;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if v_price is null then return jsonb_build_object('ok', false, 'reason', 'months'); end if;
  select * into c from public.communities where id = p_community;
  if not found or c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_is_staff(uid) and not exists (select 1 from public.community_members where community_id = p_community and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if to_regprocedure('public.premium_add(uuid,integer,text,text,text,uuid)') is null then return jsonb_build_object('ok', false, 'reason', 'gems_off'); end if;
  if not coalesce((select shop_open from public.premium_settings where id = 1), true) then return jsonb_build_object('ok', false, 'reason', 'closed'); end if;
  if (select count(*) from public.comm_boost_log where user_id = uid and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
  bal := public.premium_add(uid, -v_price, 'spend', 'boost:' || p_community, 'Буст «' || left(c.name, 40) || '» на ' || (30 * p_months) || ' дн.');
  if bal is null then return jsonb_build_object('ok', false, 'reason', 'gems', 'need', v_price); end if;
  insert into public.comm_boosts (community_id, until) values (p_community, now() + make_interval(days => 30 * p_months))
    on conflict (community_id) do update set until = greatest(public.comm_boosts.until, now()) + make_interval(days => 30 * p_months), updated_at = now()
    returning until into v_until;
  insert into public.comm_boost_log (community_id, user_id, months, gems) values (p_community, uid, p_months, v_price);
  perform public.comm_notify(c.owner_id, 'cm_boost', uid, 'бустанул(а) «' || left(c.name, 40) || '» 🚀',
    'Буст до ' || to_char(v_until at time zone 'Europe/Moscow', 'DD.MM.YYYY'), '#/chat/c/' || p_community || '/boost',
    'boost:' || p_community || ':' || uid || ':' || public.comm_bucket(5));
  return jsonb_build_object('ok', true, 'until', v_until, 'balance', bal);
end $$;

-- Что у сообщества с бустом (видно тем, кому видно сообщество)
create or replace function public.cm_boost_info(p_id bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.comm_ev_visible(p_id, auth.uid()) and exists (select 1 from public.communities where id = p_id and status = 'active') then
    jsonb_build_object('ok', true, 'boost', coalesce(b.until > now(), false), 'until', case when b.until > now() then b.until end,
      'banner', coalesce(b.banner, ''), 'anim', coalesce(b.anim, false), 'vanity', case when b.until > now() then b.vanity end,
      'prices', jsonb_build_object('1', public.comm_boost_price(1), '3', public.comm_boost_price(3)),
      'boosters', (select count(distinct l.user_id) from public.comm_boost_log l where l.community_id = p_id and l.created_at > now() - interval '90 days'))
  else jsonb_build_object('ok', false, 'reason', 'not_found') end
  from (select 1) x left join public.comm_boosts b on b.community_id = p_id;
$$;

-- Оформление буста — владелец (и персонал), только пока буст идёт. p_vanity '' — убрать красивую ссылку
create or replace function public.cm_boost_set(p_community bigint, p_banner text, p_anim boolean, p_vanity text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_banner text := lower(btrim(coalesce(p_banner, ''))); v_van text := nullif(lower(btrim(coalesce(p_vanity, ''))), '');
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(public.comm_role(p_community), '') <> 'owner' and not public.comm_is_staff() then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if not public.comm_boosted(p_community) then return jsonb_build_object('ok', false, 'reason', 'boost'); end if;
  if v_banner !~ '^[a-z0-9]{0,16}$' then return jsonb_build_object('ok', false, 'reason', 'banner'); end if;
  if v_van is not null then
    if v_van !~ '^[a-z0-9]{6,12}$' then return jsonb_build_object('ok', false, 'reason', 'vanity'); end if;
    if public.comm_bad(v_van) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
    if exists (select 1 from public.communities where invite_code = v_van)
       or exists (select 1 from public.comm_boosts where vanity = v_van and community_id <> p_community) then
      return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  end if;
  update public.comm_boosts set banner = v_banner, anim = coalesce(p_anim, false), vanity = v_van, updated_at = now() where community_id = p_community;
  return jsonb_build_object('ok', true);
end $$;

-- Приглашение и вступление — и по красивой ссылке буста (как в ч. 2 + comm_by_code)
create or replace function public.cm_invite_info(p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'about', c.about, 'icon', c.icon, 'members', c.members, 'public', c.is_public,
    'category', c.category, 'age', c.age, 'boost', public.comm_boosted(c.id))
  from public.communities c where c.id = public.comm_by_code(p_code) and c.status = 'active';
$$;
create or replace function public.cm_join(p_id bigint, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c record; b record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_code is not null and btrim(p_code) <> '' then
    select * into c from public.communities where id = public.comm_by_code(p_code);
  else
    select * into c from public.communities where id = p_id and is_public;
  end if;
  if not found or c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if exists (select 1 from public.community_members where community_id = c.id and user_id = uid) then
    return jsonb_build_object('ok', true, 'id', c.id, 'already', true); end if;
  if c.age > public.comm_age_cap(uid) and not public.comm_is_staff(uid) then return jsonb_build_object('ok', false, 'reason', 'age', 'age', c.age); end if;
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

-- Мои сообщества (как в ч. 1) + буст: значок в списке серверов, баннер над каналами
create or replace function public.cm_my()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.joined_at), '[]'::jsonb) from (
    select c.id, c.name, c.icon, c.about, c.members, c.is_public, m.role, m.joined_at,
      (select max(msg.id) from public.community_messages msg where msg.community_id = c.id and not msg.deleted) as last_id,
      coalesce(b.until > now(), false) as boost, case when b.until > now() then b.banner else '' end as banner,
      coalesce(b.until > now() and b.anim, false) as anim
    from public.community_members m join public.communities c on c.id = m.community_id
    left join public.comm_boosts b on b.community_id = c.id
    where m.user_id = auth.uid() and c.status = 'active') x;
$$;

-- Обзор (как в ч. 2) + буст: значок 🚀, баннер, анимация (место в списке буст не меняет)
create or replace function public.cm_catalog(p_q text default null, p_cat text default null, p_sort text default 'members', p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); cap int := public.comm_age_cap(auth.uid());
  q text := replace(replace(replace(left(btrim(coalesce(p_q, '')), 40), '%', ''), '_', ''), '\', '');
begin
  return (select coalesce(jsonb_agg(to_jsonb(x) - 'srt' order by x.srt desc, x.id desc), '[]'::jsonb) from (
    select c.id, c.name, c.about, c.icon, c.members, c.category, c.age, c.created_at, c.active_at,
      exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = uid) as mine,
      coalesce(b.until > now(), false) as boost, case when b.until > now() then b.banner else '' end as banner,
      coalesce(b.until > now() and b.anim, false) as anim,
      case when p_sort = 'new' then extract(epoch from c.created_at)::float8
           when p_sort = 'active' then coalesce(extract(epoch from c.active_at)::float8, 0)
           else c.members::float8 end as srt
    from public.communities c left join public.comm_boosts b on b.community_id = c.id
    where c.status = 'active' and c.is_public and c.age <= cap
      and (coalesce(p_cat, '') = '' or c.category = p_cat)
      and (q = '' or c.name ilike '%' || q || '%' or c.about ilike '%' || q || '%')
    order by srt desc, c.id desc
    limit 24 offset greatest(0, least(coalesce(p_offset, 0), 480))) x);
end $$;

-- Каналы (как в разделе 1) + буст: до 40 каналов, голосовых до 10
create or replace function public.cm_channel_save(p_community bigint, p_id bigint, p_name text, p_kind text, p_slow int, p_mods_only boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id bigint; v_kind text := coalesce(p_kind, 'text'); v_b boolean := public.comm_boosted(p_community);
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_perm(p_community, auth.uid(), 1) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 32 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if public.comm_bad(v_name) or public.comm_has_link(v_name) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if coalesce(p_slow, 0) < 0 or coalesce(p_slow, 0) > 3600 then return jsonb_build_object('ok', false, 'reason', 'slow'); end if;
  if p_id is null then
    if v_kind not in ('text', 'voice') then return jsonb_build_object('ok', false, 'reason', 'kind'); end if;
    if (select count(*) from public.community_channels where community_id = p_community) >= (case when v_b then 40 else 20 end) then
      return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    if v_kind = 'voice' and (select count(*) from public.community_channels where community_id = p_community and kind = 'voice') >= (case when v_b then 10 else 5 end) then
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

do $$
declare f text;
begin
  foreach f in array array['cm_boost_buy(bigint,integer)', 'cm_boost_set(bigint,text,boolean,text)', 'cm_join(bigint,text)', 'cm_my()',
      'cm_channel_save(bigint,bigint,text,text,integer,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['cm_boost_info(bigint)', 'cm_invite_info(text)', 'cm_catalog(text,text,text,integer)'] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['comm_boosted(bigint)', 'comm_by_code(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;


-- ═══════════════════════════════════════════════════════════════════
--  ЧАСТЬ 4. 📁 каналы и папки, 🛡 модерация и журнал, 🤖 автомодерация, 🔔 уведомления сервера
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Таблицы и колонки ═══
create table if not exists public.chan_cats (
  id bigint generated always as identity primary key,
  community_id bigint references public.communities(id) on delete cascade,   -- null — сервер сайта «Денчик37»
  name text not null check (char_length(name) between 1 and 32),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_chan_cats on public.chan_cats (community_id, position);
alter table public.chan_cats enable row level security;   -- читать — функциями (cm_open, chat_info)

alter table public.community_channels add column if not exists category_id bigint references public.chan_cats(id) on delete set null;
alter table public.community_channels add column if not exists about text not null default '';
alter table public.community_channels add column if not exists archived boolean not null default false;
alter table public.community_channels add column if not exists write_role bigint references public.comm_roles(id) on delete set null;
alter table public.chat_channels add column if not exists category_id bigint references public.chan_cats(id) on delete set null;
alter table public.chat_channels add column if not exists archived boolean not null default false;

alter table public.communities add column if not exists automod jsonb not null default '{}'::jsonb;
create table if not exists public.chat_settings (
  id int primary key default 1 check (id = 1),
  automod jsonb not null default '{}'::jsonb          -- правила автомодерации сервера сайта: {"caps": false} — выключить правило
);
insert into public.chat_settings (id) values (1) on conflict (id) do nothing;
alter table public.chat_settings enable row level security;

create table if not exists public.comm_modlog (
  id bigint generated always as identity primary key,
  community_id bigint references public.communities(id) on delete cascade,   -- null — сервер сайта
  actor_id uuid references public.profiles(id) on delete set null,          -- null — автомодерация
  actor_nick text not null default '',
  target_id uuid references public.profiles(id) on delete set null,
  target_nick text not null default '',
  action text not null,
  reason text not null default '',
  detail text not null default '',
  channel text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_cmodlog_c on public.comm_modlog (community_id, id desc);
create index if not exists idx_cmodlog_t on public.comm_modlog (target_id, created_at desc);
alter table public.comm_modlog enable row level security;   -- читать — cm_modlog()

create table if not exists public.comm_notif_prefs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  community_id bigint not null,                        -- 0 — сервер сайта
  level text not null default 'all' check (level in ('all', 'mentions', 'none')),
  muted boolean not null default false,
  muted_ch text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, community_id)
);
alter table public.comm_notif_prefs enable row level security;

-- ═══ 2. Помощники ═══
-- Каналы: сервер сайта (p_cid null) — admin/moderator; сообщество — право «каналы» (бит 1: владелец, модераторы, роль)
create or replace function public.chan_can_manage(p_cid bigint, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin', 'moderator')
    else public.comm_perm(p_cid, p_uid, 1) end;
$$;
-- Журнал и автомодерация: сервер сайта — admin/moderator; сообщество — право «модерация» (бит 2)
create or replace function public.comm_can_see_log(p_cid bigint, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and case when p_cid is null then coalesce(public.chat_staff_role(p_uid), '') in ('admin', 'moderator')
    else public.comm_perm(p_cid, p_uid, 2) end;
$$;
-- Причина действия: cm_mod / chat_mod кладут её в настройку транзакции, триггеры журнала читают
create or replace function public.comm_reason()
returns text language sql stable as $$ select left(coalesce(current_setting('d37.reason', true), ''), 200); $$;

-- Запись в журнал (ошибка записи никогда не ломает само действие); хранение — последние 3000 записей сервера
create or replace function public.comm_log(p_cid bigint, p_actor uuid, p_target uuid, p_tnick text, p_action text, p_reason text, p_detail text, p_channel text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  begin
    if p_cid is not null and not exists (select 1 from public.communities where id = p_cid) then return; end if;
    insert into public.comm_modlog (community_id, actor_id, actor_nick, target_id, target_nick, action, reason, detail, channel)
      values (p_cid, p_actor, coalesce((select nick from public.profiles where id = p_actor), ''), p_target,
        coalesce(nullif(p_tnick, ''), (select nick from public.profiles where id = p_target), ''),
        left(coalesce(p_action, ''), 24), left(coalesce(p_reason, ''), 200), left(coalesce(p_detail, ''), 300), left(coalesce(p_channel, ''), 40))
      returning id into v_id;
    if v_id % 200 = 0 then
      delete from public.comm_modlog where community_id is not distinct from p_cid and id <= (
        select id from public.comm_modlog where community_id is not distinct from p_cid order by id desc offset 3000 limit 1);
    end if;
  exception when others then null;
  end;
end $$;

-- ═══ 3. Журнал: триггеры (ловят и новые кнопки, и старые функции) ═══
-- Сообщение сообщества удалил не автор → «удалил»; за одну операцию — одна запись на автора (чистка, бан с чисткой)
create or replace function public.comm_log_msg()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); v_reason text := public.comm_reason();
begin
  if not (old.deleted = false and new.deleted = true) or actor is null or actor is not distinct from old.user_id then return null; end if;
  if coalesce(current_setting('d37.nolog', true), '') = '1' then return null; end if;
  if exists (select 1 from public.comm_modlog where community_id = old.community_id and actor_id = actor and target_id is not distinct from old.user_id
      and action = 'delete' and created_at = now()) then return null; end if;
  if v_reason = '' and exists (select 1 from public.community_reports where message_id = old.id and status = 'open') then v_reason := '🚩 по жалобе'; end if;
  perform public.comm_log(old.community_id, actor, old.user_id, old.nick, 'delete', v_reason, left(old.text, 140), old.channel_id::text);
  return null;
end $$;
drop trigger if exists comm_log_msg on public.community_messages;
create trigger comm_log_msg after update of deleted on public.community_messages for each row execute function public.comm_log_msg();

-- Мут / снять мут / выгнали (не сам вышел, не бан)
create or replace function public.comm_log_member()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return null; end if;
  if tg_op = 'UPDATE' then
    if new.muted_until is not distinct from old.muted_until or actor = new.user_id then return null; end if;
    if new.muted_until is not null and new.muted_until > now() then
      perform public.comm_log(new.community_id, actor, new.user_id, null, 'mute', public.comm_reason(),
        ceil(extract(epoch from (new.muted_until - now())) / 60)::int || ' мин', '');
    else
      perform public.comm_log(new.community_id, actor, new.user_id, null, 'unmute', public.comm_reason(), '', '');
    end if;
  else
    if actor = old.user_id or coalesce(current_setting('d37.act', true), '') = 'ban' then return null; end if;
    if not exists (select 1 from public.communities where id = old.community_id) then return null; end if;
    perform public.comm_log(old.community_id, actor, old.user_id, null, 'kick', public.comm_reason(), '', '');
  end if;
  return null;
end $$;
drop trigger if exists comm_log_member on public.community_members;
create trigger comm_log_member after update of muted_until or delete on public.community_members for each row execute function public.comm_log_member();

-- Бан / разбан (истёкший бан снимает сам человек при вступлении — не пишем)
create or replace function public.comm_log_ban()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid();
begin
  if actor is null then return null; end if;
  if tg_op = 'DELETE' then
    if actor = old.user_id or not exists (select 1 from public.communities where id = old.community_id) then return null; end if;
    perform public.comm_log(old.community_id, actor, old.user_id, null, 'unban', public.comm_reason(), '', '');
  else
    perform public.comm_log(new.community_id, actor, new.user_id, null, 'ban', new.reason,
      case when new.until is null then 'навсегда' else 'до ' || to_char(new.until at time zone 'Europe/Moscow', 'DD.MM.YYYY HH24:MI') end, '');
  end if;
  return null;
end $$;
drop trigger if exists comm_log_ban on public.community_bans;
create trigger comm_log_ban after insert or update or delete on public.community_bans for each row execute function public.comm_log_ban();

-- Сервер сайта: сообщение удалила команда (не автор) → «удалил»; одна запись на автора за операцию (бан ника удаляет всё сразу)
create or replace function public.chat_log_msg()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); v_reason text := public.comm_reason();
begin
  if not (coalesce(old.deleted, false) = false and new.deleted = true) or actor is null or actor is not distinct from old.user_id then return null; end if;
  if public.chat_staff_role(actor) is null or coalesce(current_setting('d37.nolog', true), '') = '1' then return null; end if;
  if exists (select 1 from public.comm_modlog where community_id is null and actor_id = actor and target_nick = coalesce(old.nick, '')
      and action = 'delete' and created_at = now()) then return null; end if;
  if v_reason = '' and exists (select 1 from public.chat_reports where message_id = old.id and status = 'open') then v_reason := '🚩 по жалобе'; end if;
  perform public.comm_log(null, actor, old.user_id, coalesce(old.nick, ''), 'delete', v_reason, left(coalesce(old.text, ''), 140), coalesce(old.channel, 'general'));
  return null;
end $$;
drop trigger if exists chat_log_msg on public.messages;
create trigger chat_log_msg after update of deleted on public.messages for each row execute function public.chat_log_msg();

-- Мут в общем чате (chat_mute пишет строку с причиной)
create or replace function public.chat_log_mute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.by_id is null then return null; end if;
  perform public.comm_log(null, new.by_id, new.user_id, new.nick, 'mute', new.reason, ceil(extract(epoch from (new.until - now())) / 60)::int || ' мин', '');
  return null;
end $$;
drop trigger if exists chat_log_mute on public.chat_mutes;
create trigger chat_log_mute after insert on public.chat_mutes for each row execute function public.chat_log_mute();

-- Бан ника в общем чате (banned_nicks пишет команда сайта) и разбан
create or replace function public.chat_log_ban()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); v_nick text;
begin
  if actor is null then return null; end if;
  v_nick := case when tg_op = 'DELETE' then to_jsonb(old)->>'nick' else to_jsonb(new)->>'nick' end;
  perform public.comm_log(null, actor, (select id from public.profiles where lower(nick) = lower(v_nick) limit 1), v_nick,
    case when tg_op = 'DELETE' then 'unban' else 'ban' end, public.comm_reason(), case when tg_op = 'DELETE' then '' else 'бан ника' end, '');
  return null;
end $$;
drop trigger if exists chat_log_ban on public.banned_nicks;
create trigger chat_log_ban after insert or delete on public.banned_nicks for each row execute function public.chat_log_ban();

-- ═══ 4. 🔔 Уведомления: настройки сервера учитываются (как comm_notify в ч. 1 + проверка настроек) ═══
-- «ничего» — без упоминаний и ответов; «только @» или заглушён сервер/канал — без @everyone. Предупреждения, муты, жалобы — всегда
create or replace function public.comm_notify(p_user uuid, p_kind text, p_actor uuid, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cid bigint; v_ch text; pr record;
begin
  if p_user is null or p_user = p_actor or public.comm_blocked(p_user, p_actor) then return; end if;
  if to_regprocedure('public.notify(uuid,text,uuid,text,text,text,text)') is null then return; end if;
  if p_kind in ('cm_mention', 'cm_reply', 'chat_reply') then
    begin
      if coalesce(p_link, '') like '#/chat%' then
        v_cid := 0; v_ch := coalesce(nullif(split_part(p_link, '/', 3), ''), 'general');
      else
        v_cid := nullif(substring(coalesce(p_link, '') from '^#/phone/comm/([0-9]+)'), '')::bigint;
        v_ch := coalesce(substring(coalesce(p_link, '') from '^#/phone/comm/[0-9]+/([0-9]+)'), '');
      end if;
      if v_cid is not null then
        select * into pr from public.comm_notif_prefs where user_id = p_user and community_id = v_cid;
        if found then
          if pr.level = 'none' then return; end if;
          if coalesce(p_title, '') like '@everyone%' and (pr.level = 'mentions' or pr.muted or v_ch = any (pr.muted_ch)) then return; end if;
        end if;
      end if;
    exception when others then null;
    end;
  end if;
  begin
    perform public.notify(p_user, p_kind, p_actor, p_title, p_body, p_link, p_dedupe);
  exception when others then null;
  end;
end $$;

create or replace function public.cm_notif_set(p_community bigint, p_level text, p_muted boolean, p_muted_ch text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); v_ch text[];
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_level, '') not in ('all', 'mentions', 'none') then return jsonb_build_object('ok', false, 'reason', 'level'); end if;
  if coalesce(p_community, 0) <> 0 and not exists (select 1 from public.community_members where community_id = p_community and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  v_ch := array(select distinct left(x, 40) from unnest(coalesce(p_muted_ch, '{}'::text[])) x where x ~ '^[a-z0-9]{1,40}$' limit 60);
  if p_level = 'all' and not coalesce(p_muted, false) and coalesce(array_length(v_ch, 1), 0) = 0 then
    delete from public.comm_notif_prefs where user_id = uid and community_id = coalesce(p_community, 0);
  else
    insert into public.comm_notif_prefs (user_id, community_id, level, muted, muted_ch) values (uid, coalesce(p_community, 0), p_level, coalesce(p_muted, false), v_ch)
      on conflict (user_id, community_id) do update set level = excluded.level, muted = excluded.muted, muted_ch = excluded.muted_ch, updated_at = now();
  end if;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.cm_notif_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('c', community_id, 'level', level, 'muted', muted, 'ch', to_jsonb(muted_ch))), '[]'::jsonb)
  from public.comm_notif_prefs where user_id = auth.uid();
$$;

-- ═══ 5. 📁 Категории, порядок, настройки канала ═══
create or replace function public.cm_cat_save(p_community bigint, p_id bigint, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.chan_can_manage(p_community, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 32 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if public.comm_bad(v_name) or public.comm_has_link(v_name) or v_name ~ '[<>]' then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if p_id is null then
    if (select count(*) from public.chan_cats where community_id is not distinct from p_community) >= 15 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
    insert into public.chan_cats (community_id, name, position)
      values (p_community, v_name, coalesce((select max(position) + 1 from public.chan_cats where community_id is not distinct from p_community), 0))
      returning id into v_id;
    perform public.comm_log(p_community, auth.uid(), null, '', 'cat_add', '', v_name, '');
  else
    update public.chan_cats set name = v_name where id = p_id and community_id is not distinct from p_community returning id into v_id;
    if v_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.cm_cat_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into k from public.chan_cats where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.chan_can_manage(k.community_id, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  delete from public.chan_cats where id = p_id;   -- каналы остаются — без категории
  perform public.comm_log(k.community_id, auth.uid(), null, '', 'cat_delete', '', k.name, '');
  return jsonb_build_object('ok', true);
end $$;

-- Порядок: p_cats [{"id":1,"pos":0}], p_chans [{"id":"5","pos":0,"cat":1|null}] (у сервера сайта id канала — текст)
create or replace function public.cm_layout(p_community bigint, p_cats jsonb, p_chans jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j jsonb; v_cat bigint;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.chan_can_manage(p_community, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if jsonb_typeof(coalesce(p_cats, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_chans, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_cats, '[]'::jsonb)) > 40 or jsonb_array_length(coalesce(p_chans, '[]'::jsonb)) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'data'); end if;
  begin
    for j in select * from jsonb_array_elements(coalesce(p_cats, '[]'::jsonb)) loop
      update public.chan_cats set position = least(greatest((j->>'pos')::int, 0), 999)
        where id = (j->>'id')::bigint and community_id is not distinct from p_community;
    end loop;
    for j in select * from jsonb_array_elements(coalesce(p_chans, '[]'::jsonb)) loop
      v_cat := nullif(j->>'cat', '')::bigint;
      if v_cat is not null and not exists (select 1 from public.chan_cats where id = v_cat and community_id is not distinct from p_community) then v_cat := null; end if;
      if p_community is null then
        update public.chat_channels set position = least(greatest((j->>'pos')::int, -1), 999), category_id = v_cat where id = j->>'id';
      else
        update public.community_channels set position = least(greatest((j->>'pos')::int, 0), 999), category_id = v_cat
          where id = (j->>'id')::bigint and community_id = p_community;
      end if;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'reason', 'data');
  end;
  return jsonb_build_object('ok', true);
end $$;

-- Настройки канала: название, тема, медленный режим, «пишут только модераторы» (+ роль), архив
create or replace function public.cm_chan_set(p_community bigint, p_id text, p_name text, p_about text, p_slow int, p_mods_only boolean, p_write_role bigint, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_about text := btrim(coalesce(p_about, '')); ch record; v_wr bigint := p_write_role; v_cid bigint; v_arch boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.chan_can_manage(p_community, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 32 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if char_length(v_about) > 200 then return jsonb_build_object('ok', false, 'reason', 'about'); end if;
  if public.comm_bad(v_name) or public.comm_bad(v_about) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if public.comm_has_link(v_name) or public.comm_has_link(v_about) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if coalesce(p_slow, 0) < 0 or coalesce(p_slow, 0) > 3600 then return jsonb_build_object('ok', false, 'reason', 'slow'); end if;
  if p_community is null then
    select * into ch from public.chat_channels where id = p_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    v_arch := coalesce(p_archived, ch.archived);
    if v_arch and (ch.id in ('general', 'news') or ch.kind <> 'text') then return jsonb_build_object('ok', false, 'reason', 'last'); end if;
    update public.chat_channels set name = v_name, about = v_about,
      slow_sec = case when kind = 'text' then coalesce(p_slow, slow_sec) else slow_sec end,
      mods_only = case when kind = 'text' then coalesce(p_mods_only, mods_only) else mods_only end, archived = v_arch where id = p_id;
  else
    begin v_cid := p_id::bigint; exception when others then return jsonb_build_object('ok', false, 'reason', 'not_found'); end;
    select * into ch from public.community_channels where id = v_cid and community_id = p_community;
    if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    v_arch := coalesce(p_archived, ch.archived);
    if v_wr is not null and not exists (select 1 from public.comm_roles where id = v_wr and community_id = p_community) then v_wr := null; end if;
    if v_arch and not ch.archived and ch.kind = 'text'
       and (select count(*) from public.community_channels where community_id = p_community and kind = 'text' and not archived) <= 1 then
      return jsonb_build_object('ok', false, 'reason', 'last'); end if;
    update public.community_channels set name = v_name, about = v_about, slow_sec = coalesce(p_slow, slow_sec), mods_only = coalesce(p_mods_only, mods_only),
      write_role = v_wr, archived = v_arch where id = v_cid;
  end if;
  perform public.comm_log(p_community, auth.uid(), null, '', case when v_arch and not ch.archived then 'chan_archive'
    when not v_arch and ch.archived then 'chan_unarchive' else 'chan_edit' end, '', '#' || v_name, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- Удалить канал сообщества — право «каналы» (было: только владелец); последний текстовый — нельзя
create or replace function public.cm_channel_delete(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into ch from public.community_channels where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.chan_can_manage(ch.community_id, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if ch.kind = 'text' and (select count(*) from public.community_channels where community_id = ch.community_id and kind = 'text' and not archived and id <> p_id) < 1 then
    return jsonb_build_object('ok', false, 'reason', 'last'); end if;
  delete from public.community_channels where id = p_id;
  perform public.comm_log(ch.community_id, auth.uid(), null, '', 'chan_delete', '', '#' || ch.name, '');
  return jsonb_build_object('ok', true);
end $$;

-- Сервер сайта: новый текстовый канал (admin/moderator, до 20) и удаление (только admin; общий, новости и голосовой — нельзя)
create or replace function public.chat_chan_add(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_id text;
begin
  if not public.chan_can_manage(null, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 32 then return jsonb_build_object('ok', false, 'reason', 'name'); end if;
  if public.comm_bad(v_name) or public.comm_has_link(v_name) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  if (select count(*) from public.chat_channels where kind = 'text') >= 20 then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  loop
    v_id := 'x' || translate(substr(md5(random()::text || clock_timestamp()::text), 1, 10), '0123456789', 'ghijklmnop');
    exit when not exists (select 1 from public.chat_channels where id = v_id);
  end loop;
  insert into public.chat_channels (id, name, kind, position) values (v_id, v_name, 'text', coalesce((select max(position) + 1 from public.chat_channels), 0));
  perform public.comm_log(null, auth.uid(), null, '', 'chan_add', '', '#' || v_name, v_id);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
create or replace function public.chat_chan_delete(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ch record;
begin
  if coalesce(public.chat_staff_role(), '') <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if p_id in ('general', 'news', 'voice') then return jsonb_build_object('ok', false, 'reason', 'last'); end if;
  delete from public.chat_channels where id = p_id returning * into ch;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.comm_log(null, auth.uid(), null, '', 'chan_delete', '', '#' || ch.name, p_id);
  return jsonb_build_object('ok', true);
end $$;

-- Открыть сообщество (как в ч. 1) + категории, тема, архив, «кто пишет», можно ли мне управлять каналами
create or replace function public.cm_open(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare uid uuid := auth.uid(); c record; v_role text; v_mute timestamptz; b record; staff boolean := public.comm_is_staff(); s text; ch jsonb; mng boolean;
begin
  select * into c from public.communities where id = p_id;
  if not found or (c.status <> 'active' and not staff) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select role, muted_until into v_role, v_mute from public.community_members where community_id = p_id and user_id = uid;
  if v_role is null then
    select * into b from public.community_bans where community_id = p_id and user_id = uid and (until is null or until > now());
    if found then return jsonb_build_object('ok', false, 'reason', 'banned', 'until', b.until, 'name', c.name); end if;
    if not c.is_public and not staff then return jsonb_build_object('ok', false, 'reason', 'private'); end if;
  end if;
  mng := public.chan_can_manage(p_id, uid);
  select k into s from public.comm_secret where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'slow', x.slow_sec, 'mods_only', x.mods_only,
      'about', x.about, 'cat', x.category_id, 'archived', x.archived, 'write_role', x.write_role, 'pos', x.position,
      'last_id', (select max(m.id) from public.community_messages m where m.channel_id = x.id and not m.deleted),
      'topic', case when x.kind = 'voice' and (v_role is not null or staff) then 'cv-' || substr(encode(extensions.hmac('topic:' || x.id, s, 'sha256'), 'hex'), 1, 24) end)
    order by x.position, x.id), '[]'::jsonb) into ch
  from public.community_channels x where x.community_id = p_id and (not x.archived or mng);
  return jsonb_build_object('ok', true, 'role', v_role, 'staff', staff, 'manage', mng,
    'muted_until', case when v_mute > now() then v_mute end,
    'rt', case when v_role is not null or staff then substr(encode(extensions.hmac('rt:' || c.id, s, 'sha256'), 'hex'), 1, 16) end,
    'c', jsonb_build_object('id', c.id, 'name', c.name, 'about', c.about, 'icon', c.icon, 'public', c.is_public, 'members', c.members,
      'owner', c.owner_id, 'status', c.status, 'code', case when v_role is not null or staff then c.invite_code end),
    'channels', ch,
    'cats', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'pos', k.position) order by k.position, k.id), '[]'::jsonb)
      from public.chan_cats k where k.community_id = p_id));
end $$;

-- Что есть в общем чате (как в ч. 1) + категории и архив (архив видит только команда)
create or replace function public.chat_info()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'slow', slow_sec, 'mods_only', mods_only, 'about', about,
        'cat', category_id, 'archived', archived, 'pos', position) order by position, id), '[]'::jsonb)
      from public.chat_channels where not archived or coalesce(public.chat_staff_role(), '') in ('admin', 'moderator')),
    'cats', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pos', position) order by position, id), '[]'::jsonb)
      from public.chan_cats where community_id is null),
    'muted_until', (select max(until) from public.chat_mutes where until > now() and auth.uid() is not null and user_id = auth.uid()),
    'staff', public.chat_staff_role());
$$;

-- ═══ 6. 🤖 Автомодерация ═══
create or replace function public.comm_automod_text(p_code text)
returns text language sql immutable as $$
  select '🤖 Автомодерация: ' || case p_code
    when 'bad' then 'без мата, пожалуйста'
    when 'flood' then 'не так быстро — подожди пару секунд'
    when 'caps' then 'слишком много ЗАГЛАВНЫХ — напиши спокойнее'
    when 'repeat' then 'не повторяй одно и то же'
    when 'mentions' then 'слишком много @упоминаний в одном сообщении'
    when 'links' then 'ссылки — только тем, кто здесь не первый день'
    else 'сообщение не прошло' end;
$$;

-- Правило, которое нарушает сообщение (null — всё хорошо). p_cid null — сервер сайта. Модераторов и команду не трогает
create or replace function public.comm_automod_check(p_cid bigint, p_ch text, p_uid uuid, p_nick text, p_text text)
returns text language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; t text := coalesce(p_text, ''); letters text; up int; v_at timestamptz; lim bigint;
begin
  if p_cid is null then
    if p_uid is not null and public.chat_staff_role(p_uid) is not null then return null; end if;
    cfg := coalesce((select automod from public.chat_settings where id = 1), '{}'::jsonb);
  else
    if p_uid is null or public.comm_perm(p_cid, p_uid, 2) then return null; end if;
    cfg := coalesce((select automod from public.communities where id = p_cid), '{}'::jsonb);
  end if;
  if coalesce(cfg->>'off', '') = 'true' then return null; end if;
  if coalesce(cfg->>'bad', '') <> 'false' and public.comm_bad(t) then return 'bad'; end if;
  if coalesce(cfg->>'links', '') <> 'false'
     and t ~* '(https?://|www\.|t\.me/|[a-z0-9-]{2,}\.(ru|com|net|org|рф|io|gg|me|xyz|su|ly|cc|top|link|site|online|app|tk|ml)([/[:space:]]|$))' then
    if p_cid is null then
      select created_at into v_at from public.profiles where id = p_uid;
      if v_at is null or v_at > now() - interval '3 days' then return 'links'; end if;
    else
      select joined_at into v_at from public.community_members where community_id = p_cid and user_id = p_uid;
      if v_at is null or v_at > now() - interval '1 day' then return 'links'; end if;
    end if;
  end if;
  if coalesce(cfg->>'mentions', '') <> 'false' and position('@' in t) > 0
     and (select count(distinct lower(x[1])) from regexp_matches(t, '@([A-Za-zА-Яа-яЁё0-9_.-]{2,24})', 'g') as x) >= 5 then return 'mentions'; end if;
  if coalesce(cfg->>'caps', '') <> 'false' then
    letters := regexp_replace(t, '[^A-Za-zА-Яа-яЁё]', '', 'g');
    if char_length(letters) >= 12 then
      up := char_length(regexp_replace(letters, '[^A-ZА-ЯЁ]', '', 'g'));
      if up * 10 >= char_length(letters) * 7 then return 'caps'; end if;
    end if;
  end if;
  if p_cid is null then
    lim := coalesce((select max(id) from public.messages), 0) - 300;   -- только последние 300 сообщений (быстро, по ключу)
    if coalesce(cfg->>'flood', '') <> 'false' and (select count(*) from public.messages m where m.id > lim and m.created_at > now() - interval '6 seconds'
        and ((p_uid is not null and m.user_id = p_uid) or (p_uid is null and m.user_id is null and m.nick = p_nick))) >= 4 then return 'flood'; end if;
    if coalesce(cfg->>'repeat', '') <> 'false' and char_length(btrim(t)) > 3 and exists (select 1 from public.messages m where m.id > lim
        and m.created_at > now() - interval '2 minutes' and not coalesce(m.deleted, false)
        and ((p_uid is not null and m.user_id = p_uid) or (p_uid is null and m.user_id is null and m.nick = p_nick))
        and lower(btrim(m.text)) = lower(btrim(t))) then return 'repeat'; end if;
  else
    if coalesce(cfg->>'flood', '') <> 'false' and (select count(*) from public.community_messages m where m.user_id = p_uid and m.community_id = p_cid
        and m.created_at > now() - interval '6 seconds') >= 4 then return 'flood'; end if;
    if coalesce(cfg->>'repeat', '') <> 'false' and char_length(btrim(t)) > 3 and exists (select 1 from public.community_messages m where m.user_id = p_uid
        and m.community_id = p_cid and m.created_at > now() - interval '2 minutes' and not m.deleted and lower(btrim(m.text)) = lower(btrim(t))) then
      return 'repeat'; end if;
  end if;
  return null;
end $$;

-- Общий чат: перед сообщением — архив и автомодерация (ошибка в проверке чат не ломает — сообщение проходит)
create or replace function public.chat_automod()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if;
  if public.chat_staff_role(auth.uid()) is null
     and exists (select 1 from public.chat_channels where id = coalesce(nullif(new.channel, ''), 'general') and archived) then
    raise exception 'Канал в архиве — писать в него нельзя'; end if;
  if coalesce(new.is_sticker, false) then return new; end if;
  begin
    v := public.comm_automod_check(null, coalesce(nullif(new.channel, ''), 'general'), auth.uid(), new.nick, new.text);
  exception when others then v := null;
  end;
  if v is not null then raise exception '%', public.comm_automod_text(v); end if;
  return new;
end $$;
drop trigger if exists chat_automod on public.messages;
create trigger chat_automod before insert on public.messages for each row execute function public.chat_automod();

-- Общий чат: запись в журнал после остановки (сервер проверяет заново, сам; раз в 30 с на правило и человека)
create or replace function public.chat_automod_note(p_channel text, p_text text, p_nick text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text; uid uuid := auth.uid(); v_nick text := left(btrim(coalesce(p_nick, '')), 24);
begin
  if uid is not null then select nick into v_nick from public.profiles where id = uid; end if;
  if char_length(coalesce(p_text, '')) > 1000 then return jsonb_build_object('ok', false); end if;
  begin
    v := public.comm_automod_check(null, coalesce(nullif(p_channel, ''), 'general'), uid, v_nick, p_text);
  exception when others then v := null;
  end;
  if v is null then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.comm_modlog where community_id is null and action = 'automod' and created_at > now() - interval '10 minutes') >= 200 then
    return jsonb_build_object('ok', true, 'rule', v); end if;
  if not exists (select 1 from public.comm_modlog where community_id is null and action = 'automod' and reason = v and created_at > now() - interval '30 seconds'
      and ((uid is not null and target_id = uid) or (uid is null and target_id is null and target_nick = coalesce(v_nick, '')))) then
    perform public.comm_log(null, null, uid, coalesce(v_nick, ''), 'automod', v, left(coalesce(p_text, ''), 140), coalesce(nullif(p_channel, ''), 'general'));
  end if;
  return jsonb_build_object('ok', true, 'rule', v);
end $$;

create or replace function public.cm_automod_get(p_community bigint)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_community is null then jsonb_build_object('ok', true, 'cfg', coalesce((select automod from public.chat_settings where id = 1), '{}'::jsonb),
      'can', public.comm_can_see_log(null, auth.uid()))
    when public.comm_is_member(p_community) or public.comm_is_staff()
      or exists (select 1 from public.communities c where c.id = p_community and c.status = 'active' and c.is_public) then
      jsonb_build_object('ok', true, 'cfg', coalesce((select automod from public.communities where id = p_community), '{}'::jsonb),
        'can', public.comm_can_see_log(p_community, auth.uid()))
    else jsonb_build_object('ok', false, 'reason', 'private') end;
$$;
create or replace function public.cm_automod_set(p_community bigint, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.comm_can_see_log(p_community, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if jsonb_typeof(coalesce(p_cfg, '{}'::jsonb)) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'data'); end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v from jsonb_each(coalesce(p_cfg, '{}'::jsonb))
    where key in ('off', 'bad', 'flood', 'caps', 'repeat', 'mentions', 'links') and jsonb_typeof(value) = 'boolean';
  if p_community is null then update public.chat_settings set automod = v where id = 1;
  else update public.communities set automod = v where id = p_community; end if;
  perform public.comm_log(p_community, auth.uid(), null, '', 'automod_cfg', '', v::text, '');
  return jsonb_build_object('ok', true, 'cfg', v);
end $$;

-- Отправить в канал сообщества (как в ч. 1) + архив, «пишет роль», автомодерация
create or replace function public.cm_send(p_channel bigint, p_text text, p_reply bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ch record; c record; v_role text; v_mute timestamptz; v_text text := btrim(coalesce(p_text, ''));
  v_last timestamptz; v_id bigint; v_nick text; m text; target uuid; n int := 0; v_row record; v_am text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into ch from public.community_channels where id = p_channel;
  if not found or ch.kind <> 'text' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if ch.archived then return jsonb_build_object('ok', false, 'reason', 'archived'); end if;
  select * into c from public.communities where id = ch.community_id;
  if c.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select role, muted_until into v_role, v_mute from public.community_members where community_id = ch.community_id and user_id = uid;
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'member'); end if;
  if v_mute > now() then return jsonb_build_object('ok', false, 'reason', 'muted', 'until', v_mute); end if;
  if ch.mods_only and v_role = 'member' and not (ch.write_role is not null
      and exists (select 1 from public.comm_member_roles where role_id = ch.write_role and user_id = uid)) then
    return jsonb_build_object('ok', false, 'reason', 'mods_only'); end if;
  if char_length(v_text) < 1 or char_length(v_text) > 1000 then return jsonb_build_object('ok', false, 'reason', 'len'); end if;
  if public.comm_has_link(v_text) then return jsonb_build_object('ok', false, 'reason', 'link'); end if;
  if v_text ~ '(.)\1{14,}' then return jsonb_build_object('ok', false, 'reason', 'flood'); end if;
  -- 🤖 автомодерация: не отправляем, объясняем, пишем в журнал (раз в 30 с на правило)
  begin
    v_am := public.comm_automod_check(ch.community_id, p_channel::text, uid, null, v_text);
  exception when others then v_am := null;
  end;
  if v_am is not null then
    if not exists (select 1 from public.comm_modlog where community_id = ch.community_id and target_id = uid and action = 'automod'
        and reason = v_am and created_at > now() - interval '30 seconds') then
      perform public.comm_log(ch.community_id, null, uid, null, 'automod', v_am, left(v_text, 140), p_channel::text);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'automod', 'rule', v_am, 'why', public.comm_automod_text(v_am));
  end if;
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
  if exists (select 1 from public.community_messages where channel_id = p_channel and user_id = uid and text = v_text and created_at > now() - interval '30 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'repeat'); end if;
  if p_reply is not null and not exists (select 1 from public.community_messages where id = p_reply and channel_id = p_channel) then p_reply := null; end if;
  select nick into v_nick from public.profiles where id = uid;
  insert into public.community_messages (channel_id, community_id, user_id, nick, text, reply_to)
    values (p_channel, ch.community_id, uid, coalesce(v_nick, ''), v_text, p_reply)
    returning * into v_row;
  v_id := v_row.id;
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
  if p_reply is not null then
    select user_id into target from public.community_messages where id = p_reply;
    if target is not null and target <> uid then
      perform public.comm_notify(target, 'cm_reply', uid, 'ответил(а) тебе в «' || left(c.name, 40) || '»', left(v_text, 140),
        '#/phone/comm/' || ch.community_id || '/' || p_channel, 'cmr:' || p_channel || ':' || uid || ':' || public.comm_bucket(5));
    end if;
  end if;
  if v_id % 100 = 0 then
    delete from public.community_messages where channel_id = p_channel and id <= (
      select id from public.community_messages where channel_id = p_channel order by id desc offset 3000 limit 1);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'msg', to_jsonb(v_row));
end $$;

-- ═══ 7. 🛡 Модерация с причиной ═══
-- Сообщество: warn | mute (p_minutes 1…10080) | unmute | kick | ban (p_minutes 0 — навсегда, p_purge — удалить его сообщения за сутки)
create or replace function public.cm_mod(p_community bigint, p_user uuid, p_action text, p_minutes int, p_reason text, p_purge boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_reason text := left(btrim(coalesce(p_reason, '')), 200); c record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if public.comm_bad(v_reason) or public.comm_has_link(v_reason) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  perform set_config('d37.reason', v_reason, true);
  if p_action = 'warn' then
    if not public.comm_can_mod(p_community, auth.uid(), p_user) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
    if not exists (select 1 from public.community_members where community_id = p_community and user_id = p_user) then
      return jsonb_build_object('ok', false, 'reason', 'member'); end if;
    if (select count(*) from public.comm_modlog where actor_id = auth.uid() and action = 'warn' and created_at > now() - interval '1 hour') >= 30 then
      return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
    select name into c from public.communities where id = p_community;
    perform public.comm_notify(p_user, 'cm_mod', auth.uid(), '⚠️ Предупреждение в «' || left(c.name, 40) || '»',
      coalesce(nullif(v_reason, ''), 'Соблюдай правила сообщества'), '#/phone/comm/' || p_community, 'cmwarn:' || p_community || ':' || p_user || ':' || public.comm_bucket(1));
    perform public.comm_log(p_community, auth.uid(), p_user, null, 'warn', v_reason, '', '');
    return jsonb_build_object('ok', true);
  elsif p_action = 'mute' then return public.cm_mute(p_community, p_user, greatest(1, least(coalesce(p_minutes, 60), 10080)));
  elsif p_action = 'unmute' then return public.cm_mute(p_community, p_user, 0);
  elsif p_action = 'kick' then return public.cm_kick(p_community, p_user);
  elsif p_action = 'ban' then
    perform set_config('d37.act', 'ban', true);
    return public.cm_ban(p_community, p_user, v_reason, greatest(coalesce(p_minutes, 0), 0), coalesce(p_purge, false));
  end if;
  return jsonb_build_object('ok', false, 'reason', 'action');
end $$;

create or replace function public.cm_mod_delete(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform set_config('d37.reason', left(btrim(coalesce(p_reason, '')), 200), true);
  return public.cm_delete_msg(p_id);
end $$;

-- Удалить N последних сообщений человека в канале (до 100) — одна запись «чистка» в журнале
create or replace function public.cm_purge(p_channel bigint, p_user uuid, p_n int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cid bigint; k int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select community_id into cid from public.community_channels where id = p_channel;
  if cid is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not public.comm_can_mod(cid, auth.uid(), p_user) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  perform set_config('d37.nolog', '1', true);
  with x as (select id from public.community_messages where channel_id = p_channel and user_id = p_user and not deleted
    order by id desc limit least(greatest(coalesce(p_n, 10), 1), 100))
  update public.community_messages set deleted = true, hidden = false, text = '', reactions = '{}'::jsonb where id in (select id from x);
  get diagnostics k = row_count;
  perform set_config('d37.nolog', '', true);
  delete from public.community_reactions r using public.community_messages m where r.message_id = m.id and m.channel_id = p_channel and m.user_id = p_user and m.deleted;
  perform public.comm_log(cid, auth.uid(), p_user, null, 'purge', left(btrim(coalesce(p_reason, '')), 200), k || ' сообщ.', p_channel::text);
  return jsonb_build_object('ok', true, 'n', k);
end $$;

-- Сервер сайта: warn | mute | unmute (мут — chat_mute: хелпер до часа, команду глушит только админ)
create or replace function public.chat_mod(p_user uuid, p_nick text, p_action text, p_minutes int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.chat_staff_role(); v_reason text := left(btrim(coalesce(p_reason, '')), 200); r jsonb; v_nick text := left(btrim(coalesce(p_nick, '')), 24);
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_user = auth.uid() then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if p_user is not null and public.chat_staff_role(p_user) is not null and me <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  if public.comm_bad(v_reason) then return jsonb_build_object('ok', false, 'reason', 'bad'); end if;
  perform set_config('d37.reason', v_reason, true);
  if p_action = 'warn' then
    if p_user is null then return jsonb_build_object('ok', false, 'reason', 'guest'); end if;
    if (select count(*) from public.comm_modlog where actor_id = auth.uid() and action = 'warn' and created_at > now() - interval '1 hour') >= 30 then
      return jsonb_build_object('ok', false, 'reason', 'rate'); end if;
    perform public.comm_notify(p_user, 'cm_mod', auth.uid(), '⚠️ Предупреждение от модератора чата', coalesce(nullif(v_reason, ''), 'Соблюдай правила чата'),
      '#/chat', 'chwarn:' || p_user || ':' || public.comm_bucket(1));
    perform public.comm_log(null, auth.uid(), p_user, v_nick, 'warn', v_reason, '', '');
    return jsonb_build_object('ok', true);
  elsif p_action = 'mute' then return public.chat_mute(p_user, v_nick, greatest(1, coalesce(p_minutes, 60)), v_reason);
  elsif p_action = 'unmute' then
    r := public.chat_mute(p_user, v_nick, 0, v_reason);
    if coalesce((r->>'ok')::boolean, false) then perform public.comm_log(null, auth.uid(), p_user, v_nick, 'unmute', v_reason, '', ''); end if;
    return r;
  end if;
  return jsonb_build_object('ok', false, 'reason', 'action');
end $$;

create or replace function public.chat_mod_delete(p_id bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.chat_staff_role(); v record;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  select id, user_id, deleted into v from public.messages where id = p_id;
  if not found or coalesce(v.deleted, false) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v.user_id is not null and v.user_id <> auth.uid() and public.chat_staff_role(v.user_id) is not null and me <> 'admin' then
    return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  perform set_config('d37.reason', left(btrim(coalesce(p_reason, '')), 200), true);
  update public.messages set deleted = true where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.chat_purge(p_channel text, p_user uuid, p_nick text, p_n int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.chat_staff_role(); k int; v_ch text := coalesce(nullif(p_channel, ''), 'general');
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'staff'); end if;
  if p_user is null and coalesce(btrim(p_nick), '') = '' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p_user is not null and public.chat_staff_role(p_user) is not null and me <> 'admin' then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  perform set_config('d37.nolog', '1', true);
  with x as (select id from public.messages where coalesce(channel, 'general') = v_ch and not coalesce(deleted, false)
      and ((p_user is not null and user_id = p_user) or (p_user is null and user_id is null and nick = p_nick))
    order by id desc limit least(greatest(coalesce(p_n, 10), 1), 100))
  update public.messages set deleted = true where id in (select id from x);
  get diagnostics k = row_count;
  perform set_config('d37.nolog', '', true);
  perform public.comm_log(null, auth.uid(), p_user, p_nick, 'purge', left(btrim(coalesce(p_reason, '')), 200), k || ' сообщ.', v_ch);
  return jsonb_build_object('ok', true, 'n', k);
end $$;

-- 🛡 Журнал: по 50 записей, раньше p_before
create or replace function public.cm_modlog(p_community bigint, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.comm_can_see_log(p_community, auth.uid()) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
  return jsonb_build_object('ok', true, 'list', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id desc), '[]'::jsonb) from (
    select l.id, l.actor_id as actor, l.actor_nick, l.target_id as target, l.target_nick, l.action, l.reason, l.detail, l.channel, l.created_at as at
    from public.comm_modlog l where l.community_id is not distinct from p_community and (p_before is null or l.id < p_before)
    order by l.id desc limit 50) x));
end $$;

-- Жалобы сообщества — и роли с правом «модерация» (как в ч. 1, comm_is_mod → comm_perm бит 2)
create or replace function public.cm_reports(p_community bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_community is null and not public.comm_is_staff() then return null; end if;
  if p_community is not null and not public.comm_perm(p_community, auth.uid(), 2) then return null; end if;
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
  if not public.comm_perm(r.community_id, auth.uid(), 2) then return jsonb_build_object('ok', false, 'reason', 'rights'); end if;
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

-- ═══ 8. Права на функции ═══
do $$
declare f text;
begin
  foreach f in array array['cm_cat_save(bigint,bigint,text)', 'cm_cat_delete(bigint)', 'cm_layout(bigint,jsonb,jsonb)',
      'cm_chan_set(bigint,text,text,text,integer,boolean,bigint,boolean)', 'cm_channel_delete(bigint)', 'chat_chan_add(text)', 'chat_chan_delete(text)',
      'cm_open(bigint)', 'cm_send(bigint,text,bigint)', 'cm_mod(bigint,uuid,text,integer,text,boolean)', 'cm_mod_delete(bigint,text)',
      'cm_purge(bigint,uuid,integer,text)', 'chat_mod(uuid,text,text,integer,text)', 'chat_mod_delete(bigint,text)', 'chat_purge(text,uuid,text,integer,text)',
      'cm_automod_set(bigint,jsonb)', 'cm_notif_set(bigint,text,boolean,text[])', 'cm_notif_get()', 'cm_reports(bigint)', 'cm_report_resolve(bigint,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['cm_modlog(bigint,bigint)', 'cm_automod_get(bigint)', 'chat_automod_note(text,text,text)', 'chat_info()'] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['chan_can_manage(bigint,uuid)', 'comm_can_see_log(bigint,uuid)', 'comm_log(bigint,uuid,uuid,text,text,text,text,text)',
      'comm_automod_check(bigint,text,uuid,text,text)', 'comm_log_msg()', 'comm_log_member()', 'comm_log_ban()', 'chat_log_msg()', 'chat_log_mute()',
      'chat_log_ban()', 'chat_automod()', 'comm_notify(uuid,text,uuid,text,text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

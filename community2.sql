-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА 2 («как Дискорд», продолжение): «Денчик-бот» 📢 в сервере «Денчик37»
--  (js/features/community2.js, community.js, msgview.js, chat.js, api/push-check.js)
--  Выполнить целиком в Supabase → SQL Editor ПОСЛЕ community.sql и premium.sql (оба уже применены).
--  Идемпотентно — можно запускать ещё раз. Писать в новые таблицы напрямую нельзя — только функциями ниже.
--
--  Что внутри:
--   • канал «📢 новости» (#news) сервера «Денчик37»: пишут только команда сайта и Денчик-бот;
--     бот пишет туда сам (api/push-check.js раз в 5 минут): «🔴 Денчик в эфире», «🎬 Новое видео» — функция bot_post,
--     её может вызвать ТОЛЬКО сервер (service_role), один и тот же повод — один раз (bot_posts)
--   • колонка messages.is_sticker (chat-stickers.sql): на живой базе её не было, а триггер vip-balance.sql её ждёт
--   • события 📅 (как Discord Events): на сервере сайта — админ и модераторы, в сообществе — владелец и модераторы;
--     название, описание, начало, длительность, место (канал, голосовой, «Мир Денчика», игра, стрим), возрастная метка;
--     карточка в канале («📢 новости» / первый текстовый), «✅ Пойду» со счётчиком, «🔴 Сейчас идёт»,
--     🔔 «скоро начнётся» за 15 минут — api/push-check.js раз в 5 минут (bot_event_remind) и запасом при чтении событий
--
--  Проверка после запуска (гостем, publishable-ключ):
--   /rest/v1/chat_channels?id=eq.news → [{"id":"news",…,"mods_only":true}]
--   /rpc/bot_post гостем {"p_channel":"news","p_text":"x"} → 401 «permission denied» (PGRST202 = файл не применён)
--   /rpc/cm_events гостем {"p_community":null} → {"ok":true,"can":false,"list":[]}
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

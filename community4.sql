-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА 4 («как Дискорд»): удобное управление каналами и модерацией
--  (js/features/community4.js, community.js, chat.js)
--  Выполнить целиком в Supabase → SQL Editor ПОСЛЕ community3.sql. Идемпотентно — можно запускать ещё раз.
--  Переопределяет функции community.sql: cm_open, cm_send, cm_channel_delete, cm_reports, cm_report_resolve, chat_info, comm_notify —
--  перезапустил community.sql → потом снова community2.sql, community3.sql и этот файл.
--
--  Что внутри:
--   • 📁 категории каналов (папки) — у сообществ и у сервера сайта «Денчик37»: создать, переименовать, удалить; порядок каналов
--     и категорий (cm_layout); настройки канала: название, тема, медленный режим, «пишут только модераторы» (+ одна своя роль),
--     архив (канал скрыт, история хранится), удалить. Права: сообщество — право «каналы» (comm_perm, бит 1), сайт — admin/moderator
--   • 🛡 журнал модерации comm_modlog: кто, что, кому, когда и почему (удаление, мут/тайм-аут, кик, бан, разбан, предупреждение,
--     чистка, автомодерация, правки каналов). Пишут триггеры — и старые кнопки тоже попадают в журнал. Видят: владелец и модераторы
--     сообщества (право 2), на сервере сайта — admin/moderator
--   • ⚠️ предупреждение (🔔 человеку), тайм-аут / кик / бан / удаление с причиной (cm_mod, chat_mod), «удалить N последних» (cm_purge, chat_purge)
--   • 🤖 автомодерация на сервере: мат (comm_bad), флуд (4 сообщения за 6 с), КАПС (70 % из 12+ букв), повтор (2 мин), 5+ @упоминаний,
--     ссылки от новичков (в сообществе меньше суток / аккаунту меньше 3 дней и гости). Нарушение — не отправляется, человеку —
--     объяснение, в журнал — запись. Модераторов не трогает. Включается по правилам в настройках (по умолчанию всё включено)
--   • 🔔 уведомления сервера для участника: все / только @упоминания / ничего, заглушить сервер или канал (без @everyone)
--
--  Проверка после запуска (гостем, publishable-ключ):
--   /rpc/cm_modlog гостем {"p_community":null} → {"ok":false,"reason":"rights"} (PGRST202 = файл не применён)
--   /rpc/cm_automod_get гостем {"p_community":null} → {"ok":true,"cfg":{},"can":false}
--   /rest/v1/chat_channels?select=id,archived,category_id&limit=1 → 200 (400 «does not exist» = не применён)
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

-- ═══ 4. 🔔 Уведомления: настройки сервера учитываются (как comm_notify в community.sql + проверка настроек) ═══
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

-- Открыть сообщество (как в community.sql) + категории, тема, архив, «кто пишет», можно ли мне управлять каналами
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

-- Что есть в общем чате (как в community.sql) + категории и архив (архив видит только команда)
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

-- Отправить в канал сообщества (как в community.sql) + архив, «пишет роль», автомодерация
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

-- Жалобы сообщества — и роли с правом «модерация» (как в community.sql, comm_is_mod → comm_perm бит 2)
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

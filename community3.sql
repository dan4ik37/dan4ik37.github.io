-- ═══════════════════════════════════════════════════════════════════
--  СООБЩЕСТВА 3 («как Дискорд», продолжение): свои роли 🎭 и «🚀 Буст» за 💎
--  (js/features/community2.js, community.js, msgview.js)
--  Выполнить целиком в Supabase → SQL Editor ПОСЛЕ community2.sql. Идемпотентно — можно запускать ещё раз.
--  Нужен premium.sql (уже применён: 💎 списывает premium_add). Переопределяет функции community.sql / community2.sql:
--  comm_perm, comm_can_mod, cm_pin, cm_unban, cm_bans, cm_channel_save, cm_members, cm_my, cm_join, cm_invite_info, cm_catalog —
--  перезапустил community.sql или community2.sql → потом снова этот файл.
--
--  Что внутри:
--   • свои роли в сообществе (как в Дискорде): название, цвет ника, место (выше — главнее), права:
--     1 — каналы, 2 — модерация (мут, кик, бан, удалить сообщение, баны), 4 — закреп, 8 — события, 16 — @everyone;
--     создаёт, меняет и выдаёт — владелец (и персонал сайта); до 20 ролей, у человека до 5; роль с модерацией наказывает только
--     участников, у кого верхняя роль ниже; владелец и модераторы — как раньше (у них всё)
--   • @everyone / @все в сообщении (право 16, владелец, модераторы) → 🔔 всем участникам, не чаще раза в 10 минут на сообщество
--   • «🚀 Буст»: любой участник — 30 дней за 100 💎 / 90 за 270 💎 (себе или в подарок; сроки складываются); баннер, анимированный
--     значок, красивая ссылка /c/<имя>, до 40 каналов (голосовых 10), 🚀 в обзоре. Только красота и удобство: место в обзоре не меняет
--
--  Проверка после запуска (гостем, publishable-ключ):
--   /rpc/cm_roles гостем {"p_id":0} → {"ok":false,"reason":"private"} (PGRST202 = файл не применён)
--   /rpc/cm_boost_info гостем {"p_id":0} → {"ok":false,"reason":"not_found"}
--   /rpc/cm_boost_buy гостем {"p_community":0,"p_months":1} → 401 permission denied
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
-- Право по «биту»: персонал сайта, владелец и модератор — всё; участник — по своим ролям (community2.sql: события — бит 8)
create or replace function public.comm_perm(p_cid bigint, p_uid uuid, p_bit int)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (public.comm_is_staff(p_uid)
    or coalesce((select role in ('owner', 'mod') from public.community_members where community_id = p_cid and user_id = p_uid), false)
    or (exists (select 1 from public.community_members where community_id = p_cid and user_id = p_uid)
        and (public.comm_role_bits(p_cid, p_uid) & p_bit) <> 0));
$$;
-- Кого можно наказывать (мут, кик, бан, удалить сообщение): как в community.sql + роль с модерацией — участников ниже себя
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

-- Участники (как в community.sql) + номера их ролей (выше — первой)
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

-- Приглашение и вступление — и по красивой ссылке буста (как в community2.sql + comm_by_code)
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

-- Мои сообщества (как в community.sql) + буст: значок в списке серверов, баннер над каналами
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

-- Обзор (как в community2.sql) + буст: значок 🚀, баннер, анимация (место в списке буст не меняет)
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

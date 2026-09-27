-- ═══════════════════════════════════════════════════════════════════
--  ПРОГРЕССИЯ: ачивки с наградами, награды за уровни, VIP за уровень,
--  титулы, друзья «как в Steam», XP за донаты, невидимка с Silver VIP
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Нужны уже выполненные: xp.sql, streaks-achievements.sql, referrals.sql,
--  vip-balance.sql, server-hardening.sql, friends-dm.sql, privacy.sql.
--  notifications.sql — желательно (уведомления о наградах).
--  ВНИМАНИЕ: представление profiles_public здесь переопределяется — если когда-то
--  перезапустить privacy.sql, после него перезапустить и этот файл.
--
--  Что даёт уровень (level = floor(sqrt(xp/50)) + 1, см. xp.sql):
--   5   — простая рамка аватара; можно слать заявки в друзья (лимит 15)
--   10  — титул из своих ачивок рядом с ником
--   15/20/25/30 — лимит друзей 20/25/30/35
--   30  — красивая рамка + Bronze VIP на 1 месяц
--   50  — Silver VIP на 3 месяца
--   100 — Gold VIP на 1 год
--   VIP за уровень прибавляется к концу текущего VIP, а не сгорает вместе с ним.
--  Заявки в друзья (как ограниченный аккаунт Steam): с 5 уровня, ИЛИ 5 приглашённых
--  друзей, ИЛИ любой донат; персонал — всегда. Лимит друзей у VIP: 50/70/100,
--  у персонала — без лимита. Кто уже дружит сверх лимита — никого не удаляем.
--  Донат: 1 XP за 1 ₽ (до 1000 XP за донат), прошлые донаты засчитываются один раз.
-- ═══════════════════════════════════════════════════════════════════

-- ── Уровень человека ──
create or replace function public.user_level(uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select public.xp_level((select coalesce(sum(amount), 0) from public.xp_ledger where user_id = uid));
$$;
grant execute on function public.user_level(uuid) to anon, authenticated;

-- ═══ 1. VIP за уровень ═══
create table if not exists public.vip_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  level int not null,
  tier text not null check (tier in ('bronze', 'silver', 'gold')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, level)
);
alter table public.vip_grants enable row level security;
drop policy if exists "Свои награды VIP видит сам" on public.vip_grants;
create policy "Свои награды VIP видит сам" on public.vip_grants for select using (auth.uid() = user_id);

create or replace function public.vip_tier_rank(t text)
returns int language sql immutable as $$
  select case t when 'gold' then 3 when 'silver' then 2 when 'bronze' then 1 else 0 end;
$$;

-- Заменяет версию из vip-balance.sql: учитывает и донатный VIP, и VIP за уровень —
-- через неё работают закреп, стикеры, значок VIP в чате (has_perks, messages.vip_tier)
create or replace function public.vip_tier_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select t from (
    select case
      when p.is_vip is true and (p.vip_until is null or p.vip_until > now()) then
        case when coalesce(p.total_donated, 0) >= 1500 then 'gold'
             when coalesce(p.total_donated, 0) >= 500  then 'silver'
             else 'bronze' end
    end as t
    from public.profiles p where p.id = uid
    union all
    select g.tier from public.vip_grants g
    where g.user_id = uid and now() >= g.starts_at and now() < g.ends_at
  ) x
  where t is not null
  order by public.vip_tier_rank(t) desc
  limit 1;
$$;
grant execute on function public.vip_tier_of(uuid) to authenticated, anon;

-- До какого числа VIP (для показа). null — бессрочный донатный VIP или VIP нет вовсе
create or replace function public.vip_effective_until(uid uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p.is_vip is true and p.vip_until is null then null
    else greatest(
      case when p.is_vip is true and p.vip_until > now() then p.vip_until end,
      (select max(g.ends_at) from public.vip_grants g where g.user_id = uid and g.ends_at > now())
    )
  end
  from public.profiles p where p.id = uid;
$$;

create or replace function public.grant_level_vip(p_uid uuid, p_level int, p_tier text, p_period interval)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_donated_until timestamptz;
  v_label text := case p_tier when 'gold' then 'Gold VIP' when 'silver' then 'Silver VIP' else 'Bronze VIP' end;
begin
  if exists (select 1 from public.vip_grants where user_id = p_uid and level = p_level) then return; end if;
  select case when is_vip is true and vip_until > now() then vip_until end into v_donated_until
    from public.profiles where id = p_uid;
  -- VIP уже есть — награда начинается, когда закончится текущий
  v_start := greatest(now(), coalesce(v_donated_until, now()),
    coalesce((select max(ends_at) from public.vip_grants where user_id = p_uid and ends_at > now()), now()));
  insert into public.vip_grants (user_id, level, tier, starts_at, ends_at)
    values (p_uid, p_level, p_tier, v_start, v_start + p_period)
    on conflict (user_id, level) do nothing;
  begin
    perform public.notify(p_uid, 'level_reward', null, '🎁 Уровень ' || p_level || ': ' || v_label,
      case when v_start > now() + interval '1 minute'
        then 'Начнётся ' || to_char(v_start at time zone 'Europe/Moscow', 'DD.MM.YYYY') || ', сразу после текущего VIP'
        else 'Уже действует — спасибо, что ты с нами!' end,
      '#/profile', 'vip_level_' || p_level);
  exception when others then null;
  end;
end; $$;
revoke execute on function public.grant_level_vip(uuid, int, text, interval) from public, anon, authenticated;

-- ═══ 2. Награды при повышении уровня ═══
create or replace function public.check_level_rewards(p_uid uuid, p_from int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare
  lv int := public.user_level(p_uid);
  t int;
  msg text;
begin
  if lv >= 30 then perform public.grant_level_vip(p_uid, 30, 'bronze', interval '1 month'); end if;
  if lv >= 50 then perform public.grant_level_vip(p_uid, 50, 'silver', interval '3 months'); end if;
  if lv >= 100 then perform public.grant_level_vip(p_uid, 100, 'gold', interval '1 year'); end if;
  -- Уведомления о том, что открылось (только при переходе через порог).
  -- Про лимит друзей VIP и персоналу не пишем — у них он и так больше.
  foreach t in array array[5, 10, 15, 20, 25] loop
    if lv >= t and p_from < t
       and (t <= 10 or (not public.is_staff_user(p_uid) and public.vip_tier_of(p_uid) is null)) then
      msg := case t
        when 5  then 'Открыто: рамка аватара и заявки в друзья (до 15 друзей)'
        when 10 then 'Открыто: титул из твоих ачивок рядом с ником — выбери в профиле'
        else 'Лимит друзей вырос до ' || (15 + 5 * (t / 5 - 2)) end;
      begin
        perform public.notify(p_uid, 'level_up', null, '⬆️ Уровень ' || t || '!', msg, '#/profile', 'lvl_' || t);
      exception when others then null;
      end;
    end if;
  end loop;
end; $$;
revoke execute on function public.check_level_rewards(uuid, int) from public, anon, authenticated;

-- Последний уровень, о котором человеку уже сообщили. Считать «было/стало» по сумме XP
-- в триггере нельзя: при пакетной вставке каждая строка видит уже итоговую сумму.
create table if not exists public.level_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  level int not null
);
alter table public.level_progress enable row level security;   -- политик нет: только сервер

create or replace function public.sync_level(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lv int := public.user_level(p_uid); prev int;
begin
  select level into prev from public.level_progress where user_id = p_uid for update;
  if prev is null then
    insert into public.level_progress (user_id, level) values (p_uid, lv)
      on conflict (user_id) do update set level = greatest(public.level_progress.level, excluded.level);
    prev := lv;   -- первый раз — без уведомлений о давно пройденных уровнях
  elsif lv > prev then
    update public.level_progress set level = lv where user_id = p_uid;
  end if;
  perform public.check_level_rewards(p_uid, prev);   -- VIP-награды идемпотентны
end; $$;
revoke execute on function public.sync_level(uuid) from public, anon, authenticated;

-- Текущие уровни всех — стартовая точка, чтобы не прислать уведомления «за прошлое»
insert into public.level_progress (user_id, level)
select p.id, public.user_level(p.id) from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.xp_ledger_level_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.sync_level(new.user_id);
  exception when others then null;   -- награда не должна ломать начисление XP
  end;
  return null;
end; $$;
drop trigger if exists xp_ledger_level_check on public.xp_ledger;
create trigger xp_ledger_level_check after insert on public.xp_ledger
  for each row execute function public.xp_ledger_level_check();

-- ═══ 3. XP за донаты: 1 ₽ = 1 XP (до 1000 за донат) ═══
-- Колонки журнала из server-hardening.sql / vip-log-upgrade.sql — на случай, если их части не запускались
alter table public.vip_donation_log
  add column if not exists donor_username text,
  add column if not exists amount numeric,
  add column if not exists currency text,
  add column if not exists donated_at timestamptz;
create or replace function public.xp_on_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.matched is true and new.profile_id is not null and coalesce(new.currency, 'RUB') = 'RUB'
     and (tg_op = 'INSERT' or old.matched is distinct from true) then
    begin
      perform public.xp_award(new.profile_id, 'donation', new.donation_id::text,
        least(1000, greatest(1, floor(coalesce(new.amount, 0))::int)));
    exception when others then null;
    end;
  end if;
  return null;
end; $$;
drop trigger if exists xp_on_donation on public.vip_donation_log;
create trigger xp_on_donation after insert or update of matched on public.vip_donation_log
  for each row execute function public.xp_on_donation();

-- Прошлые донаты — один раз (день = день доната, поэтому повторный запуск не задвоит)
insert into public.xp_ledger (user_id, source, ref, amount, day, created_at)
select l.profile_id, 'donation', l.donation_id::text,
       least(1000, greatest(1, floor(coalesce(l.amount, 0))::int)),
       coalesce(l.donated_at, l.processed_at, now())::date, coalesce(l.donated_at, l.processed_at, now())
from public.vip_donation_log l
join public.profiles p on p.id = l.profile_id
where l.matched is true and coalesce(l.currency, 'RUB') = 'RUB' and coalesce(l.amount, 0) > 0
on conflict (user_id, source, ref, day) do nothing;

-- ═══ 4. Друзья «как в Steam» ═══
create or replace function public.friend_count(uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.friendships
  where status = 'accepted' and (requester_id = uid or addressee_id = uid);
$$;

-- null — без лимита (персонал)
create or replace function public.friend_limit(uid uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare lv int; tier text;
begin
  if public.is_staff_user(uid) then return null; end if;
  tier := public.vip_tier_of(uid);
  if tier = 'gold' then return 100; elsif tier = 'silver' then return 70; elsif tier = 'bronze' then return 50; end if;
  lv := public.user_level(uid);
  if lv < 15 then return 15; end if;
  return least(35, 15 + 5 * (lv / 5 - 2));
end; $$;

create or replace function public.can_send_friend_requests(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
    public.is_staff_user(uid)
    or public.vip_tier_of(uid) is not null
    or coalesce((select total_donated > 0 from public.profiles where id = uid), false)
    or public.user_level(uid) >= 5
    or public.referral_count(uid) >= 5
  );
$$;

-- Для интерфейса: могу ли я добавлять друзей и сколько ещё
create or replace function public.my_friend_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_add', public.can_send_friend_requests(auth.uid()),
    'level', public.user_level(auth.uid()),
    'referrals', public.referral_count(auth.uid()),
    'count', public.friend_count(auth.uid()),
    'limit', public.friend_limit(auth.uid())
  );
$$;
grant execute on function public.my_friend_status() to authenticated;

drop policy if exists "Отправить заявку можно только от себя" on public.friendships;
create policy "Отправить заявку можно только от себя"
  on public.friendships for insert
  with check (
    auth.uid() = requester_id
    and public.accepts_friend_requests(addressee_id)
    and public.can_send_friend_requests(auth.uid())
    and public.friend_count(auth.uid()) < coalesce(public.friend_limit(auth.uid()), 2147483647)
  );

drop policy if exists "Принять заявку может только адресат" on public.friendships;
create policy "Принять заявку может только адресат"
  on public.friendships for update
  using (auth.uid() = addressee_id)
  with check (
    status = 'accepted'
    and public.friend_count(addressee_id) < coalesce(public.friend_limit(addressee_id), 2147483647)
    and public.friend_count(requester_id) < coalesce(public.friend_limit(requester_id), 2147483647)
  );

-- ═══ 5. Невидимка — с Silver VIP (и у персонала) ═══
create or replace function public.can_be_invisible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff_user(uid) or public.vip_tier_rank(public.vip_tier_of(uid)) >= 2;
$$;
create or replace function public.is_invisible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select privacy_invisible from public.profiles where id = uid), false)
     and public.can_be_invisible(uid);
$$;

-- ═══ 6. Ачивки ═══
-- Особые (роль/VIP) показываются первыми и только у тех, у кого есть.
-- Иконки/названия — в js/features/achievements.js (ACHIEVEMENT_DEFS), коды должны совпадать.
create or replace function public.site_creator_id()
returns uuid language sql immutable as $$ select '77683d85-f655-4693-bb9a-b24e1255fcdf'::uuid $$;

create or replace function public.my_achievements(uid uuid)
returns table(code text, earned boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles%rowtype;
  days_since int;
  msg_count int := 0;
  night boolean := false;
  thread_count int := 0;
  post_count int := 0;
  fr_count int;
  ref_count bigint := 0;
  best_streak int := 0;
  tier_rank int;
  lvl int;
  watch_count int := 0;
  idea_count int := 0;
  idea_done int := 0;
  lfg_count int := 0;
begin
  select * into p from public.profiles where id = uid;
  if not found then return; end if;
  days_since := coalesce(current_date - p.created_at::date, 0);

  select count(*) into msg_count from public.messages m where m.user_id = uid;
  select exists (select 1 from public.messages m where m.user_id = uid
                 and extract(hour from m.created_at at time zone 'Europe/Moscow') < 5) into night;
  select count(*) into thread_count from public.forum_threads t where t.author_id = uid;
  begin select count(*) into post_count from public.forum_posts fp where fp.author_id = uid;
  exception when others then post_count := 0; end;
  fr_count := public.friend_count(uid);
  begin ref_count := public.referral_count(uid); exception when others then ref_count := 0; end;
  -- Лучшая серия за всё время (ачивка не пропадает, если серия прервалась)
  select coalesce(max(cnt), 0) into best_streak from (
    select count(*) as cnt from (
      select v.visit_date - (row_number() over (order by v.visit_date))::int as grp
      from public.user_visits v where v.user_id = uid
    ) s group by grp
  ) g;
  tier_rank := public.vip_tier_rank(public.vip_tier_of(uid));
  lvl := public.user_level(uid);
  select count(*) into watch_count from public.xp_ledger x where x.user_id = uid and x.source = 'watch';
  begin
    select count(*), count(*) filter (where i.status = 'done') into idea_count, idea_done
      from public.ideas i where i.author_id = uid;
  exception when others then idea_count := 0; idea_done := 0; end;
  begin select count(*) into lfg_count from public.lfg_posts l where l.author_id = uid;
  exception when others then lfg_count := 0; end;

  return query values
    -- особые
    ('creator',        uid = public.site_creator_id()),
    ('role_admin',     p.role = 'admin'),
    ('role_moderator', p.role = 'moderator'),
    ('role_helper',    p.role = 'helper'),
    ('vip_gold',       tier_rank >= 3),
    ('vip_silver',     tier_rank >= 2),
    ('vip',            tier_rank >= 1),
    ('member',         true),
    -- время на сайте
    ('week_here',      days_since >= 7),
    ('month_here',     days_since >= 30),
    ('half_year',      days_since >= 180),
    ('year_here',      days_since >= 365),
    ('early_bird',     p.created_at < '2027-01-01'::timestamptz),
    -- серии
    ('streak_3',       best_streak >= 3),
    ('streak_7',       best_streak >= 7),
    ('streak_30',      best_streak >= 30),
    ('streak_100',     best_streak >= 100),
    -- чат
    ('chatty_10',      msg_count >= 10),
    ('chatty_100',     msg_count >= 100),
    ('chatty_500',     msg_count >= 500),
    ('chatty_1000',    msg_count >= 1000),
    ('night_owl',      night),
    -- форум, идеи, тиммейты
    ('forum_1',        thread_count >= 1),
    ('forum_5',        thread_count >= 5),
    ('forum_replies',  post_count >= 25),
    ('idea_1',         idea_count >= 1),
    ('idea_done',      idea_done >= 1),
    ('teammate',       lfg_count >= 1),
    -- друзья и приглашения
    ('friends_1',      fr_count >= 1),
    ('friends_5',      fr_count >= 5),
    ('friends_15',     fr_count >= 15),
    ('referrer_1',     ref_count >= 1),
    ('referrer_5',     ref_count >= 5),
    -- просмотры и профиль
    ('watcher_10',     watch_count >= 10),
    ('watcher_100',    watch_count >= 100),
    ('styled',         p.avatar_url is not null and p.banner_url is not null and coalesce(btrim(p.bio), '') <> ''),
    ('supporter',      coalesce(p.total_donated, 0) > 0),
    -- уровни (без XP, иначе уровень поднимал бы сам себя)
    ('level_10',       lvl >= 10),
    ('level_30',       lvl >= 30),
    ('level_50',       lvl >= 50),
    ('level_100',      lvl >= 100);
end; $$;
grant execute on function public.my_achievements(uuid) to anon, authenticated;

-- Сколько XP даёт ачивка (разово). 0 — не даёт.
create or replace function public.achievement_xp(p_code text)
returns int language sql immutable as $$
  select case p_code
    when 'creator' then 500 when 'role_admin' then 300 when 'role_moderator' then 200 when 'role_helper' then 150
    when 'vip_gold' then 300 when 'vip_silver' then 200 when 'vip' then 100 when 'member' then 10
    when 'week_here' then 20 when 'month_here' then 50 when 'half_year' then 150 when 'year_here' then 300
    when 'early_bird' then 50
    when 'streak_3' then 15 when 'streak_7' then 40 when 'streak_30' then 150 when 'streak_100' then 500
    when 'chatty_10' then 10 when 'chatty_100' then 50 when 'chatty_500' then 150 when 'chatty_1000' then 300
    when 'night_owl' then 30
    when 'forum_1' then 20 when 'forum_5' then 60 when 'forum_replies' then 80
    when 'idea_1' then 20 when 'idea_done' then 150 when 'teammate' then 20
    when 'friends_1' then 15 when 'friends_5' then 50 when 'friends_15' then 100
    when 'referrer_1' then 50 when 'referrer_5' then 200
    when 'watcher_10' then 30 when 'watcher_100' then 150
    when 'styled' then 30 when 'supporter' then 100
    else 0 end;
$$;
grant execute on function public.achievement_xp(text) to anon, authenticated;

-- Забрать XP за полученные ачивки (каждую — один раз за всё время) + догнать награды уровня.
-- Зовётся из js при входе и при открытии своего профиля. Возвращает, что начислено сейчас.
create or replace function public.claim_achievements()
returns table(ach_code text, ach_xp int)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r record;
  got int;
begin
  if uid is null then return; end if;
  for r in select a.code from public.my_achievements(uid) a where a.earned loop
    if public.achievement_xp(r.code) > 0 and not exists (
      select 1 from public.xp_ledger l where l.user_id = uid and l.source = 'ach' and l.ref = r.code
    ) then
      got := public.xp_award(uid, 'ach', r.code, public.achievement_xp(r.code));
      if got > 0 then ach_code := r.code; ach_xp := got; return next; end if;
    end if;
  end loop;
  perform public.sync_level(uid);   -- VIP за уровень, если уровень набран раньше
end; $$;
grant execute on function public.claim_achievements() to authenticated;

-- ═══ 7. Титулы (с 10 уровня) ═══
create table if not exists public.user_titles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null,
  updated_at timestamptz not null default now()
);
alter table public.user_titles enable row level security;
drop policy if exists "Титулы видят все" on public.user_titles;
create policy "Титулы видят все" on public.user_titles for select using (true);

create or replace function public.set_title(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_code, '') = '' then
    delete from public.user_titles where user_id = uid;
    return jsonb_build_object('ok', true);
  end if;
  if public.user_level(uid) < 10 then return jsonb_build_object('ok', false, 'reason', 'level'); end if;
  if not exists (select 1 from public.my_achievements(uid) a where a.code = p_code and a.earned) then
    return jsonb_build_object('ok', false, 'reason', 'not_earned');
  end if;
  insert into public.user_titles (user_id, code) values (uid, p_code)
    on conflict (user_id) do update set code = excluded.code, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.set_title(text) to authenticated;

-- Уровень + титул пачкой (значки у ников в чате/форуме). Титул роли/VIP показывается,
-- только пока роль/VIP действительно есть — бывший админ не ходит с «Администратором».
create or replace function public.nick_extras(uids uuid[])
returns table(user_id uuid, level int, title text)
language sql stable security definer set search_path = public as $$
  select u.id,
         public.xp_level((select coalesce(sum(x.amount), 0) from public.xp_ledger x where x.user_id = u.id)),
         case
           when t.code is null then null
           when t.code = 'creator' then case when u.id = public.site_creator_id() then t.code end
           when t.code in ('role_admin', 'role_moderator', 'role_helper') then
             case when 'role_' || p.role = t.code then t.code end
           when t.code in ('vip', 'vip_silver', 'vip_gold') then
             case when public.vip_tier_rank(public.vip_tier_of(u.id)) >=
                       case t.code when 'vip_gold' then 3 when 'vip_silver' then 2 else 1 end then t.code end
           else t.code
         end
  from unnest(uids) as u(id)
  join public.profiles p on p.id = u.id
  left join public.user_titles t on t.user_id = u.id;
$$;
grant execute on function public.nick_extras(uuid[]) to anon, authenticated;

-- ═══ 8. profiles_public: + эффективный VIP (донат или за уровень) ═══
drop view if exists public.profiles_public;
create view public.profiles_public as
select
  p.id, p.nick, p.role, p.avatar_url, p.theme_accent,
  (vt.tier is not null)                                           as is_vip,
  case when vt.tier is not null then public.vip_effective_until(p.id) end as vip_until,
  vt.tier                                                         as vip_tier,
  case when v.can_see then p.banner_url end                       as banner_url,
  case when v.can_see then p.bio end                              as bio,
  case when v.can_see then p.status_text end                      as status_text,
  case when v.can_see then p.favorite_games else '{}'::text[] end as favorite_games,
  case when v.can_see or v.staff then p.created_at end            as created_at,
  case when v.money then p.total_donated
       when p.total_donated >= 1500 then 1500
       when p.total_donated >= 500 then 500
       else 0 end                                                 as total_donated,
  not v.money                                                     as donations_hidden,
  case when v.self or v.admin then p.donate_login end             as donate_login,
  case when v.self or v.staff then p.vip_pending_rub end          as vip_pending_rub,
  case when v.self then p.last_pinned_at end                      as last_pinned_at,
  case when v.self or v.admin then p.referred_by end              as referred_by,
  p.privacy_profile                                               as profile_visibility,
  p.privacy_friend_requests = 'all'                               as accepts_friend_requests,
  not v.can_see                                                   as profile_hidden,
  (not v.can_see and v.staff)                                     as staff_view,
  case when v.self then p.privacy_invisible end                   as privacy_invisible,
  case when v.self then p.privacy_hide_donations end              as privacy_hide_donations,
  case when v.self then public.can_be_invisible(p.id) end         as can_be_invisible
from public.profiles p
cross join (select auth.uid() as uid, public.viewer_role() as vrole) me
cross join lateral (select public.vip_tier_of(p.id) as tier) vt
cross join lateral (
  select
    coalesce(p.id = me.uid, false) as self,
    coalesce(me.vrole = 'admin', false) as admin,
    coalesce(me.vrole in ('admin', 'moderator'), false) as staff,
    coalesce(p.id = me.uid, false)
      or p.privacy_profile = 'all'
      or (p.privacy_profile = 'friends' and public.are_friends(p.id, me.uid)) as can_see,
    coalesce(p.id = me.uid, false)
      or coalesce(me.vrole = 'admin', false)
      or not p.privacy_hide_donations as money
) v;

grant select on public.profiles_public to anon, authenticated;

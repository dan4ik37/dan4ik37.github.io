-- ═══════════════════════════════════════════════════════════════════
--  СТРИК ПОСЕЩЕНИЙ + АЧИВКИ
--  Выполнить целиком в Supabase → SQL Editor. Один раз.
--  Отдельный файл — ничего в registration.sql / vip-secure.sql /
--  server-hardening.sql / referrals.sql не трогает.
--
--  Дизайн-решение: ачивки НЕ храним как отдельную таблицу наград —
--  почти все считаются на лету из уже существующих данных (рефералы,
--  сообщения, темы форума, VIP, возраст аккаунта) через один RPC
--  my_achievements(). Хранить в БД нужно только то, что не вывести
--  из существующих таблиц — сам факт визита по дням (для стрика).
-- ═══════════════════════════════════════════════════════════════════

-- 1. Таблица визитов — один ряд на пользователя на день.
create table if not exists public.user_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  visit_date date not null,
  primary key (user_id, visit_date)
);

alter table public.user_visits enable row level security;

drop policy if exists "Пользователь видит свои визиты" on public.user_visits;
create policy "Пользователь видит свои визиты" on public.user_visits
  for select using (auth.uid() = user_id);

drop policy if exists "Пользователь пишет свои визиты" on public.user_visits;
create policy "Пользователь пишет свои визиты" on public.user_visits
  for insert with check (auth.uid() = user_id);

-- 2. record_visit() — вызывается раз за сессию с фронта (см. streaks.js),
--    просто отмечает "сегодня заходил". on conflict do nothing — если
--    уже отмечен сегодня, лишний вызов ничего не ломает и не дублирует.
create or replace function public.record_visit()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_visits (user_id, visit_date)
  values (auth.uid(), current_date)
  on conflict (user_id, visit_date) do nothing;
end;
$$;

-- 3. current_streak(uid) — сколько дней подряд человек заходит, считая
--    сегодня или вчера как "живое" начало отсчёта (если сегодня ещё не
--    заходил, но заходил вчера — стрик не сгорает до конца дня).
create or replace function public.current_streak(uid uuid)
returns int
language plpgsql
stable
security definer set search_path = public
as $$
declare
  d date;
  streak int := 0;
  cursor_date date;
begin
  if exists (select 1 from public.user_visits where user_id = uid and visit_date = current_date) then
    cursor_date := current_date;
  elsif exists (select 1 from public.user_visits where user_id = uid and visit_date = current_date - 1) then
    cursor_date := current_date - 1;
  else
    return 0;
  end if;

  loop
    exit when not exists (select 1 from public.user_visits where user_id = uid and visit_date = cursor_date);
    streak := streak + 1;
    cursor_date := cursor_date - 1;
  end loop;

  return streak;
end;
$$;

-- 4. my_achievements(uid) — единая точка правды для бейджей. Считает всё
--    на лету из существующих таблиц/RPC, ничего не хранит и не может
--    рассинхронизироваться с реальными данными. Список кодов см. в
--    js/features/achievements.js (ACHIEVEMENT_DEFS) — там же иконки,
--    названия и описания; здесь только вычисление, earned true/false.
create or replace function public.my_achievements(uid uuid)
returns table(code text, earned boolean)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  reg_date date;
  days_since int;
  msg_count int;
  thread_count int;
  friend_count int;
  ref_count bigint;
  streak int;
  vip_active boolean;
begin
  select created_at::date into reg_date from public.profiles where id = uid;
  days_since := coalesce(current_date - reg_date, 0);

  select count(*) into msg_count from public.messages where user_id = uid;
  select count(*) into thread_count from public.forum_threads where author_id = uid;
  select count(*) into friend_count from public.friendships
    where status = 'accepted' and (requester_id = uid or addressee_id = uid);
  ref_count := public.referral_count(uid);
  streak := public.current_streak(uid);
  select (is_vip is true and (vip_until is null or vip_until > now())) into vip_active
    from public.profiles where id = uid;

  return query values
    ('first_visit',   days_since >= 0),
    ('week_here',     days_since >= 7),
    ('month_here',    days_since >= 30),
    ('year_here',     days_since >= 365),
    ('streak_3',      streak >= 3),
    ('streak_7',      streak >= 7),
    ('streak_30',     streak >= 30),
    ('chatty_10',     msg_count >= 10),
    ('chatty_100',    msg_count >= 100),
    ('chatty_500',    msg_count >= 500),
    ('forum_1',       thread_count >= 1),
    ('forum_5',       thread_count >= 5),
    ('friends_5',     friend_count >= 5),
    ('referrer_1',    ref_count >= 1),
    ('referrer_5',    ref_count >= 5),
    ('vip',           coalesce(vip_active, false));
end;
$$;

-- 5. Осознанно НЕ включено (см. инструкцию): выдача наград (цветной ник,
--    роль) за ачивки автоматически — как и в referrals.sql, трогает
--    систему VIP/ролей, риск налажать. Ачивки пока чисто визуальные,
--    "для азарта" — этого достаточно для первой версии.

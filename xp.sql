-- ═══════════════════════════════════════════════════════════════════
--  XP И УРОВНИ (js/features/xp.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Нужны: streaks-achievements.sql (user_visits, current_streak),
--  forum.sql, server-hardening.sql. ideas.sql и referrals.sql — по
--  возможности (триггеры на них ставятся, только если таблицы/колонки есть).
--
--  Дизайн:
--   • Журнал xp_ledger — одна строка на одно начисление. Уникальный ключ
--     (user_id, source, ref, day) — одна и та же награда дважды не придёт.
--   • Начисляют ТОЛЬКО триггеры и security definer функции. Клиент читает
--     только свои строки, писать не может вообще (нет insert-политики).
--   • Триггеры XP обёрнуты в exception — ошибка в начислении никогда не
--     сломает основное действие (сообщение, пост, визит).
--   • Уровень: level = floor(sqrt(xp / 50)) + 1
--     (ур. 2 = 50 XP, 5 = 800, 10 = 4 050, 20 = 18 050).
-- ═══════════════════════════════════════════════════════════════════

create table if not exists public.xp_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  ref text not null default '',
  amount int not null check (amount > 0 and amount <= 1000),
  day date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, source, ref, day)
);
create index if not exists idx_xp_user_day on public.xp_ledger (user_id, day);
create index if not exists idx_xp_created on public.xp_ledger (created_at);

alter table public.xp_ledger enable row level security;
drop policy if exists "Свой XP видит сам" on public.xp_ledger;
create policy "Свой XP видит сам" on public.xp_ledger for select using (auth.uid() = user_id);

-- ── Ядро: начислить, если не превышен дневной лимит по источнику ──
--   p_cap — сколько раз в день можно получить награду этого источника (null — без лимита)
create or replace function public.xp_award(p_uid uuid, p_source text, p_ref text, p_amount int, p_cap int default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_uid is null or p_amount is null or p_amount <= 0 then return 0; end if;
  if not exists (select 1 from public.profiles where id = p_uid) then return 0; end if;
  if p_cap is not null then
    select count(*) into n from public.xp_ledger
      where user_id = p_uid and source = p_source and day = current_date;
    if n >= p_cap then return 0; end if;
  end if;
  insert into public.xp_ledger (user_id, source, ref, amount)
    values (p_uid, p_source, coalesce(p_ref, ''), p_amount)
    on conflict (user_id, source, ref, day) do nothing;
  get diagnostics n = row_count;
  return case when n > 0 then p_amount else 0 end;
end;
$$;
-- Вызывать напрямую клиенту нельзя — только из триггеров/функций ниже
revoke execute on function public.xp_award(uuid, text, text, int, int) from public, anon, authenticated;

create or replace function public.xp_level(p_xp bigint)
returns int language sql immutable as $$ select floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 50.0))::int + 1 $$;

-- ── Триггеры-источники ──

-- Визит за день: 10 XP; стрик 7 дней — 50, 30 дней — 200 (в тот день, когда достигнут)
create or replace function public.xp_on_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare s int;
begin
  begin
    perform public.xp_award(new.user_id, 'visit', '', 10);
    s := public.current_streak(new.user_id);
    if s = 7 then perform public.xp_award(new.user_id, 'streak', '7', 50); end if;
    if s = 30 then perform public.xp_award(new.user_id, 'streak', '30', 200); end if;
  exception when others then null;
  end;
  return null;
end; $$;
drop trigger if exists xp_on_visit on public.user_visits;
create trigger xp_on_visit after insert on public.user_visits
  for each row execute function public.xp_on_visit();

-- Сообщение в чате: 1 XP, до 30 в день (гости без аккаунта не получают)
create or replace function public.xp_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.user_id is not null then
      perform public.xp_award(new.user_id, 'chat', new.id::text, 1, 30);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;
drop trigger if exists xp_on_message on public.messages;
create trigger xp_on_message after insert on public.messages
  for each row execute function public.xp_on_message();

-- Форум: тема 15 XP (до 5/день), ответ 3 XP (до 20/день)
create or replace function public.xp_on_forum_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.xp_award(new.author_id, 'forum_thread', new.id::text, 15, 5);
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists xp_on_forum_thread on public.forum_threads;
create trigger xp_on_forum_thread after insert on public.forum_threads
  for each row execute function public.xp_on_forum_thread();

create or replace function public.xp_on_forum_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.xp_award(new.author_id, 'forum_post', new.id::text, 3, 20);
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists xp_on_forum_post on public.forum_posts;
create trigger xp_on_forum_post after insert on public.forum_posts
  for each row execute function public.xp_on_forum_post();

-- Идеи (если ideas.sql выполнен): предложил — 5 XP; идею сделали — 100 XP автору
create or replace function public.xp_on_idea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.xp_award(new.author_id, 'idea', new.id::text, 5);
    elsif new.status = 'done' and old.status is distinct from 'done' then
      perform public.xp_award(new.author_id, 'idea_done', new.id::text, 100);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

-- Приглашённый друг (если referrals.sql выполнен): 100 XP пригласившему
create or replace function public.xp_on_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.referred_by is not null and (tg_op = 'INSERT' or old.referred_by is null) then
      perform public.xp_award(new.referred_by, 'referral', new.id::text, 100);
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

do $$
begin
  if to_regclass('public.ideas') is not null then
    drop trigger if exists xp_on_idea on public.ideas;
    create trigger xp_on_idea after insert or update of status on public.ideas
      for each row execute function public.xp_on_idea();
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles' and column_name = 'referred_by') then
    drop trigger if exists xp_on_referral on public.profiles;
    create trigger xp_on_referral after insert or update of referred_by on public.profiles
      for each row execute function public.xp_on_referral();
  end if;
end $$;

-- ── Просмотр видео на сайте: 5 XP за ролик, до 10 роликов в день ──
--   Клиент зовёт после ≥ 60 с воспроизведения (Shorts — ≥ 15 с) по YouTube IFrame API.
--   Проверить сам просмотр сервер не может — поэтому жёсткие рамки: один ролик раз в
--   день, 10 в день, не чаще раза в 30 секунд. Потолок накрутки — 50 XP в день.
create or replace function public.claim_watch_xp(p_video_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  last_at timestamptz;
  got int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'guest'); end if;
  if p_video_id !~ '^[A-Za-z0-9_-]{11}$' then return jsonb_build_object('ok', false, 'reason', 'bad_id'); end if;
  select max(created_at) into last_at from public.xp_ledger where user_id = uid and source = 'watch';
  if last_at is not null and last_at > now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;
  got := public.xp_award(uid, 'watch', p_video_id, 5, 10);
  return jsonb_build_object('ok', got > 0, 'amount', got,
    'reason', case when got > 0 then 'ok' else 'limit_or_seen' end,
    'total', (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = uid));
end;
$$;
grant execute on function public.claim_watch_xp(text) to authenticated;

-- ── Чтение ──

-- Сводка по одному пользователю (профиль): всего, уровень, границы уровня, неделя по источникам
create or replace function public.xp_summary(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with t as (select coalesce(sum(amount), 0)::bigint as xp from public.xp_ledger where user_id = uid),
       w as (select source, sum(amount)::int as xp from public.xp_ledger
             where user_id = uid and created_at > now() - interval '7 days' group by source),
       d as (select coalesce(sum(amount), 0)::int as xp from public.xp_ledger where user_id = uid and day = current_date)
  select jsonb_build_object(
    'xp', t.xp,
    'level', public.xp_level(t.xp),
    'level_from', 50 * power(public.xp_level(t.xp) - 1, 2),
    'level_to', 50 * power(public.xp_level(t.xp), 2),
    'today', d.xp,
    'week', coalesce((select jsonb_object_agg(source, xp) from w), '{}'::jsonb)
  ) from t, d;
$$;

-- Уровни пачкой — для бейджей рядом с никами (чат, форум)
create or replace function public.xp_levels(uids uuid[])
returns table (user_id uuid, xp bigint, level int)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(sum(l.amount), 0)::bigint, public.xp_level(coalesce(sum(l.amount), 0))
  from unnest(uids[1:200]) as u(id)
  left join public.xp_ledger l on l.user_id = u.id
  group by u.id;
$$;

-- Топ недели
create or replace function public.top_xp_week(lim int default 10)
returns table (user_id uuid, nick text, role text, xp bigint, level int)
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select user_id, sum(amount)::bigint as xp from public.xp_ledger
    where created_at > now() - interval '7 days' group by user_id
  ), total as (
    select user_id, sum(amount)::bigint as xp from public.xp_ledger
    where user_id in (select user_id from w) group by user_id
  )
  select w.user_id, p.nick, p.role, w.xp, public.xp_level(total.xp)
  from w join total using (user_id) join public.profiles p on p.id = w.user_id
  order by w.xp desc
  limit least(greatest(coalesce(lim, 10), 1), 50);
$$;

grant execute on function public.xp_summary(uuid) to anon, authenticated;
grant execute on function public.xp_levels(uuid[]) to anon, authenticated;
grant execute on function public.top_xp_week(int) to anon, authenticated;

-- ── Стартовый бонус: 10 XP за каждый уже засчитанный день визита ──
--   (чтобы у тех, кто давно ходит на сайт, не было нуля). Повторный запуск
--   ничего не удвоит — тот же уникальный ключ (user_id, 'visit', '', day).
insert into public.xp_ledger (user_id, source, ref, amount, day, created_at)
select v.user_id, 'visit', '', 10, v.visit_date, v.visit_date::timestamptz
from public.user_visits v
join public.profiles p on p.id = v.user_id
on conflict (user_id, source, ref, day) do nothing;

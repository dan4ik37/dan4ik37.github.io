-- ═══════════════════════════════════════════════════════════════════
--  ИГРЫ (#/games, js/features/games.js + js/games/*.js)
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно.
--  Нужны: xp.sql (xp_award). После этого файла перезапустить progression.sql —
--  там ачивки за игры (читают game_stats; без этой таблицы просто не выдаются).
--
--  Игры идут в браузере, поэтому результат присылает клиент — сервер ему «верит»
--  только в пределах: известное название игры, очки в разумных рамках, не чаще
--  раза в 5 секунд, XP за игры — до 15 начислений в день. Рекорды — для веселья.
-- ═══════════════════════════════════════════════════════════════════

-- Журнал партий (для «Задания дня»); хранится 14 дней
create table if not exists public.game_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  win boolean not null,
  score int not null,
  day date not null default (now() at time zone 'Europe/Moscow')::date,
  created_at timestamptz not null default now()
);
create index if not exists idx_game_log_user_day on public.game_log (user_id, day);
alter table public.game_log enable row level security;   -- политик нет: только через функции

create table if not exists public.game_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  game text not null,
  plays int not null default 0,
  wins int not null default 0,
  best_score int not null default 0,
  last_at timestamptz,
  primary key (user_id, game)
);
create index if not exists idx_game_stats_best on public.game_stats (game, best_score desc);
alter table public.game_stats enable row level security;
drop policy if exists "Статистику игр видят все" on public.game_stats;
create policy "Статистику игр видят все" on public.game_stats for select using (true);
-- Писать напрямую нельзя — только через game_result()

-- Потолок очков для каждой игры (всё, что выше, — подделка или баг)
create or replace function public.game_score_cap(p_game text)
returns int language sql immutable as $$
  select case
    when p_game like 'cities\_%' then 500
    when p_game = 'guess' then 10
    when p_game = '2048' then 1000000
    when p_game like 'ttt\_%' then 2
    when p_game like 'checkers\_%' then 12
    when p_game = 'catch' then 100000
    when p_game = 'reaction' then 1000
    else null end;
$$;

-- XP за победу
create or replace function public.game_win_xp(p_game text)
returns int language sql immutable as $$
  select case p_game
    when 'cities_easy' then 8 when 'cities_normal' then 15 when 'cities_hard' then 25 when 'cities_duel' then 10
    when 'guess' then 15 when '2048' then 30
    when 'ttt_easy' then 3 when 'ttt_normal' then 10 when 'ttt_hard' then 10
    when 'reaction' then 5
    when 'ttt_online' then 5
    when 'checkers_easy' then 5 when 'checkers_normal' then 15 when 'checkers_hard' then 30 when 'checkers_online' then 10
    when 'catch' then 10
    else 0 end;
$$;

create or replace function public.game_result(p_game text, p_win boolean, p_score int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cap int := public.game_score_cap(p_game);
  s int;
  st public.game_stats%rowtype;
  got int := 0;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if cap is null then return jsonb_build_object('ok', false, 'reason', 'game'); end if;
  s := least(greatest(coalesce(p_score, 0), 0), cap);

  select * into st from public.game_stats where user_id = uid and game = p_game for update;
  if found and st.last_at > now() - interval '5 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;

  insert into public.game_stats (user_id, game, plays, wins, best_score, last_at)
    values (uid, p_game, 1, case when p_win then 1 else 0 end, s, now())
  on conflict (user_id, game) do update set
    plays = public.game_stats.plays + 1,
    wins = public.game_stats.wins + case when p_win then 1 else 0 end,
    best_score = greatest(public.game_stats.best_score, s),
    last_at = now()
  returning * into st;

  insert into public.game_log (user_id, game, win, score) values (uid, p_game, coalesce(p_win, false), s);
  delete from public.game_log where user_id = uid and day < (now() at time zone 'Europe/Moscow')::date - 14;

  if p_win and public.game_win_xp(p_game) > 0 then
    begin
      got := public.xp_award(uid, 'game', p_game || ':' || st.plays, public.game_win_xp(p_game), 15);
    exception when others then got := 0;
    end;
  end if;

  return jsonb_build_object('ok', true, 'xp', got, 'plays', st.plays, 'wins', st.wins,
                            'best', st.best_score, 'record', s >= st.best_score and s > 0);
end; $$;
grant execute on function public.game_result(text, boolean, int) to authenticated;

-- Таблица рекордов игры: по лучшему счёту, при равенстве — по числу побед
create or replace function public.game_top(p_game text, lim int default 10)
returns table(user_id uuid, nick text, best_score int, wins int, plays int)
language sql stable security definer set search_path = public as $$
  select g.user_id, p.nick, g.best_score, g.wins, g.plays
  from public.game_stats g
  join public.profiles p on p.id = g.user_id
  where g.game = p_game and (g.best_score > 0 or g.wins > 0)
  order by g.best_score desc, g.wins desc, g.last_at asc
  limit least(greatest(coalesce(lim, 10), 1), 50);
$$;
grant execute on function public.game_top(text, int) to anon, authenticated;

-- ═══ Задание дня: одно на всех, меняется в полночь по Москве. Выполнил — 50 XP (раз в день) ═══
-- Список синхронизирован с DAILY_QUESTS в js/features/games.js (там тексты и ссылки на игры).
create or replace function public.daily_quest_code(p_day date default (now() at time zone 'Europe/Moscow')::date)
returns text language sql immutable as $$
  select (array['win_cities','play3','guess7','catch500','win_checkers','reaction','score2048','win_ttt'])
         [1 + ((p_day - date '2026-01-01') % 8)];
$$;

create or replace function public.daily_quest_done(uid uuid, p_code text, p_day date)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_code
    when 'win_cities'   then exists (select 1 from public.game_log where user_id = uid and day = p_day and win and game like 'cities\_%')
    when 'play3'        then (select count(*) from public.game_log where user_id = uid and day = p_day) >= 3
    when 'guess7'       then exists (select 1 from public.game_log where user_id = uid and day = p_day and game = 'guess' and score >= 7)
    when 'catch500'     then exists (select 1 from public.game_log where user_id = uid and day = p_day and game = 'catch' and score >= 500)
    when 'win_checkers' then exists (select 1 from public.game_log where user_id = uid and day = p_day and win and game like 'checkers\_%')
    when 'reaction'     then exists (select 1 from public.game_log where user_id = uid and day = p_day and game = 'reaction' and score >= 700)
    when 'score2048'    then exists (select 1 from public.game_log where user_id = uid and day = p_day and game = '2048' and score >= 2000)
    when 'win_ttt'      then exists (select 1 from public.game_log where user_id = uid and day = p_day and win and game in ('ttt_normal', 'ttt_hard', 'ttt_online'))
    else false end;
$$;

-- Состояние для витрины: какое задание, выполнено ли, забрана ли награда
create or replace function public.daily_quest()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Moscow')::date; c text := public.daily_quest_code(d); uid uuid := auth.uid();
begin
  return jsonb_build_object('code', c, 'day', d,
    'done', uid is not null and public.daily_quest_done(uid, c, d),
    'claimed', uid is not null and exists (select 1 from public.xp_ledger where user_id = uid and source = 'daily' and ref = d::text));
end; $$;
grant execute on function public.daily_quest() to anon, authenticated;

create or replace function public.claim_daily_quest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Moscow')::date; uid uuid := auth.uid(); got int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.daily_quest_done(uid, public.daily_quest_code(d), d) then return jsonb_build_object('ok', false, 'reason', 'not_done'); end if;
  if exists (select 1 from public.xp_ledger where user_id = uid and source = 'daily' and ref = d::text) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;
  got := public.xp_award(uid, 'daily', d::text, 50);
  return jsonb_build_object('ok', got > 0, 'xp', got);
end; $$;
grant execute on function public.claim_daily_quest() to authenticated;

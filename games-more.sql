-- ═══════════════════════════════════════════════════════════════════
--  НОВЫЕ ИГРЫ — ключи для game_result (рекорды, XP за победу): «Угадай игру по эмодзи» (emoji, emoji_duel),
--  «Орда» (horde, horde_duel, horde_coop), «Башни» (td, td_duel, td_coop),
--  «Одна!» (uno, uno_online), «Дурак» (durak, durak_online),
--  «Бильярд» (pool_easy, pool_normal, pool_hard, pool_online), «Лудо» (ludo, ludo_online),
--  «Нарды» (nardy_easy, nardy_hard, nardy_online), «Арена» (arena_easy, arena_normal, arena_hard, arena_online),
--  «Шахматы» (chess_easy, chess_normal, chess_hard, chess_online), «Блоки» (blocks, blocks_duel),
--  «Косынка» (kosynka, kosynka3, kosynka_duel), «Паук» (pauk1, pauk2, pauk4), «Свободная ячейка» (freecell, freecell_duel),
--  «Сапёр» (miner1, miner2, miner3, miner_duel), «Маджонг Коннект» (mahjong, mahjong_duel),
--  «Судоку» (sudoku1..4, sudoku_daily, sudoku_duel) + рекорды дня daily_top(),
--  «Крокодил» (krokodil — 10 рисунков бота, krokodil_online — компанией), «Балда» (balda_easy / _normal / _hard, balda_online),
--  «Домино» (domino — с ботами, domino_online), «Филворд» (fillword — уровни, fillword_daily — «Филворд дня», fillword_duel),
--  «Кубомир» (kubomir — достижение в «Выживании»: счёт — сколько достижений, XP — как за победу, в общем лимите игр).
--  «Подземье» (podzem — рекорд глубины в метрах, без XP; podzem_boss1 / podzem_boss2 — победа над боссом).
--  «Мир Денчика», Боевая зона (mirwar — раунд: очки = выбитые, победа — команда/первое место; 3 XP, одна «игра» в лимите 3 побед).
--  «Клеточки» (kletochki — с ботами, kletochki_online — 2+ человека; очки — лучшая масса за жизнь, победа — 1-е место в раунде)
--  и «Червячки» (chervyachki, chervyachki_online; очки — лучшая длина) — io-игры 22.10.2026: 4 XP с ботами, 6 онлайн.
--  Проверка (22.10): /rpc/game_win_xp {"p_game":"kletochki"} → 4, {"p_game":"chervyachki_online"} → 6 (0 — старая версия файла).
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно. Нужен games.sql (он уже применён).
--  Функции целиком скопированы из games.sql + новые ключи (заменяет games-emoji.sql — тот можно не запускать).
--  До запуска игры работают, просто без XP и таблицы рекордов.
--  Проверка: select public.game_score_cap('horde'); → 30000; XP за победу — /rpc/game_win_xp {"p_game":"horde"} → 10 (20 — старая версия).
--  15.10.2026 (экономика, docs/ECONOMY.md): XP за победы примерно вдвое меньше; лимиты — economy.sql (запускать после этого файла).
--  22.10.2026 (T-015, T-024) — в конце файла: ЗАДАНИЯ НЕДЕЛИ, СЕЗОННЫЙ ПУТЬ, НОВОГОДНЕЕ ЗАДАНИЕ (награды с сервера). Проверка гостем
--  (PGRST202 = не применён): /rpc/quest_rule {"p_key":"w_pts"} → 40; /rpc/weekly_quests → {"list":[…6…],"auth":false,…};
--  /rpc/season_state → {"no":…,"auth":false,…}; /rpc/advent_claim {"p_day":1} → 401 (только вошедшим).
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.game_score_cap(p_game text)
returns int language sql immutable as $$
  select case
    when p_game like 'cities\_%' then 500
    when p_game = 'guess' then 10
    when p_game = '2048' then 1000000
    when p_game like 'ttt\_%' then 2
    when p_game like 'checkers\_%' then 12
    when p_game = 'catch' then 100000
    when p_game = 'guess_duel' then 1000
    when p_game = '2048_duel' then 1000000
    when p_game = 'catch_duel' then 100000
    when p_game = 'reaction_duel' then 1000
    when p_game = 'reaction' then 1000
    when p_game like 'sea\_%' then 20
    when p_game in ('snake', 'snake_duel') then 289
    when p_game in ('memory', 'memory_duel') then 1000
    when p_game in ('words', 'words_free') then 6
    when p_game = 'words_duel' then 699
    when p_game in ('emoji', 'emoji_duel') then 2000
    when p_game in ('horde', 'horde_duel', 'horde_coop') then 30000
    when p_game in ('td', 'td_duel', 'td_coop') then 4200
    when p_game in ('uno', 'uno_online') then 5000
    when p_game in ('durak', 'durak_online') then 1
    when p_game in ('pool_easy', 'pool_normal', 'pool_hard', 'pool_online') then 1
    when p_game in ('ludo', 'ludo_online') then 1
    when p_game in ('nardy_easy', 'nardy_hard', 'nardy_online') then 2
    when p_game in ('arena_easy', 'arena_normal', 'arena_hard', 'arena_online') then 1
    when p_game in ('chess_easy', 'chess_normal', 'chess_hard', 'chess_online') then 1
    when p_game = 'blocks' then 10000000
    when p_game = 'blocks_duel' then 300000
    when p_game in ('kosynka', 'kosynka3', 'kosynka_duel') then 30000
    when p_game in ('pauk1', 'pauk2', 'pauk4') then 1300
    when p_game in ('freecell', 'freecell_duel') then 30000
    when p_game = 'miner1' then 300
    when p_game = 'miner2' then 1200
    when p_game = 'miner3' then 3000
    when p_game = 'miner_duel' then 2000
    when p_game = 'mahjong' then 5000000
    when p_game = 'mahjong_duel' then 50000
    when p_game = 'sudoku1' then 300
    when p_game = 'sudoku2' then 600
    when p_game in ('sudoku3', 'sudoku_daily') then 1200
    when p_game = 'sudoku4' then 2400
    when p_game = 'sudoku_duel' then 2500
    when p_game = 'krokodil' then 3000
    when p_game = 'krokodil_online' then 25000
    when p_game in ('balda_easy', 'balda_normal', 'balda_hard', 'balda_online') then 400
    when p_game in ('domino', 'domino_online') then 500
    when p_game in ('fillword', 'fillword_duel') then 3000
    when p_game = 'fillword_daily' then 2000
    when p_game = 'kubomir' then 30
    when p_game = 'podzem' then 100000                       -- «Подземье»: рекорд глубины, метры (без XP)
    when p_game in ('podzem_boss1', 'podzem_boss2') then 600 -- победа над боссом: 600 − секунд боя
    when p_game = 'mirwar' then 200                          -- «Мир Денчика», Боевая зона: выбитые за раунд (mir-war.js)
    when p_game in ('kletochki', 'kletochki_online') then 50000       -- «Клеточки»: лучшая масса за жизнь (kletochki.js)
    when p_game in ('chervyachki', 'chervyachki_online') then 50000   -- «Червячки»: лучшая длина за жизнь (chervyachki.js)
    else null end;
$$;

-- XP за победу (экономика 15.10.2026 — примерно вдвое меньше прежнего; лёгкое и быстрое — 1–4, долгое и трудное — 10–20,
-- слово и судоку дня — чуть щедрее, они раз в день). Сколько побед дают XP — правила economy.sql (game_xp_award):
-- не больше 3 наград в день за одну игру (horde, horde_duel, horde_coop — одна игра) и не больше 100 XP в день за все игры.
-- Подписи «+N XP» на клиенте берутся из ответа game_result — менять там нечего.
create or replace function public.game_win_xp(p_game text)
returns int language sql immutable as $$
  select case p_game
    when 'cities_easy' then 4 when 'cities_normal' then 8 when 'cities_hard' then 12 when 'cities_duel' then 5
    when 'guess' then 8 when '2048' then 15
    when 'ttt_easy' then 1 when 'ttt_normal' then 4 when 'ttt_hard' then 5
    when 'reaction' then 2
    when 'ttt_online' then 3
    when 'checkers_easy' then 2 when 'checkers_normal' then 6 when 'checkers_hard' then 15 when 'checkers_online' then 6
    when 'catch' then 4
    when 'guess_duel' then 5 when '2048_duel' then 5 when 'catch_duel' then 5 when 'reaction_duel' then 4
    when 'sea_easy' then 2 when 'sea_normal' then 6 when 'sea_hard' then 12 when 'sea_online' then 6
    when 'snake' then 4 when 'snake_duel' then 5
    when 'memory' then 4 when 'memory_duel' then 5
    when 'words' then 10 when 'words_free' then 1 when 'words_duel' then 5
    when 'emoji' then 4 when 'emoji_duel' then 5
    when 'horde' then 10 when 'horde_duel' then 8 when 'horde_coop' then 10
    when 'td' then 10 when 'td_duel' then 8 when 'td_coop' then 10
    when 'uno' then 4 when 'uno_online' then 8
    when 'durak' then 4 when 'durak_online' then 8
    when 'pool_easy' then 1 when 'pool_normal' then 4 when 'pool_hard' then 10 when 'pool_online' then 8
    when 'ludo' then 4 when 'ludo_online' then 8
    when 'nardy_easy' then 2 when 'nardy_hard' then 10 when 'nardy_online' then 8
    when 'arena_easy' then 1 when 'arena_normal' then 4 when 'arena_hard' then 10 when 'arena_online' then 8
    when 'chess_easy' then 1 when 'chess_normal' then 5 when 'chess_hard' then 15 when 'chess_online' then 8
    when 'blocks' then 5 when 'blocks_duel' then 5
    when 'kosynka' then 5 when 'kosynka3' then 8 when 'kosynka_duel' then 5
    when 'pauk1' then 5 when 'pauk2' then 10 when 'pauk4' then 20
    when 'freecell' then 8 when 'freecell_duel' then 5
    when 'miner1' then 2 when 'miner2' then 6 when 'miner3' then 15 when 'miner_duel' then 5
    when 'mahjong' then 4 when 'mahjong_duel' then 5
    when 'sudoku1' then 1 when 'sudoku2' then 4 when 'sudoku3' then 8 when 'sudoku4' then 12 when 'sudoku_daily' then 12 when 'sudoku_duel' then 5
    when 'krokodil' then 3 when 'krokodil_online' then 6
    when 'balda_easy' then 1 when 'balda_normal' then 3 when 'balda_hard' then 6 when 'balda_online' then 5
    when 'domino' then 4 when 'domino_online' then 6
    when 'fillword' then 2 when 'fillword_daily' then 6 when 'fillword_duel' then 4
    when 'kubomir' then 4
    when 'podzem_boss1' then 6 when 'podzem_boss2' then 10
    when 'mirwar' then 3
    when 'kletochki' then 4 when 'kletochki_online' then 6
    when 'chervyachki' then 4 when 'chervyachki_online' then 6
    else 0 end;
$$;

-- ═══ Рекорды за сегодня (по МСК) для ежедневных игр («Судоку дня»): засчитывается ПЕРВАЯ попытка дня ═══
-- (решение уже известно — повторная попытка была бы нечестной). Журнал game_log хранит 14 дней.
create or replace function public.daily_top(p_game text, lim int default 10)
returns table(user_id uuid, nick text, best_score int, wins int, plays int)
language sql stable security definer set search_path = public as $$
  select f.user_id, p.nick, f.score, f.wins, f.plays
  from (
    select l.user_id, (array_agg(l.score order by l.created_at))[1]::int as score,
           count(*) filter (where l.win)::int as wins, count(*)::int as plays
    from public.game_log l
    where l.game = p_game and l.day = (now() at time zone 'Europe/Moscow')::date
    group by l.user_id
  ) f
  join public.profiles p on p.id = f.user_id
  where f.score > 0
  order by f.score desc
  limit least(greatest(coalesce(lim, 10), 1), 50);
$$;
grant execute on function public.daily_top(text, int) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════
--  ЗАДАНИЯ НЕДЕЛИ, СЕЗОННЫЙ ПУТЬ И НОВОГОДНЕЕ ЗАДАНИЕ (T-015, T-024; 22.10.2026; docs/ECONOMY.md §10, docs/SEASONS.md §9)
--  Всё решает сервер: прогресс заданий недели — по game_log, xp_ledger (задание дня, просмотры) и user_visits; очки сезона ⭐ —
--  триггеры (победа в игре, задание дня) и награда за задание недели. Награды гарантированные (без случайности), на рейтинги не
--  влияют; платного пути нет (season_paid_on() → false — решение владельца о деньгах; ниже только место под выключатель).
--  Числа — quest_rule(), лестница сезона — season_ladder(), темы — season_themes(), задания недели — weekly_quest_pool(),
--  новогодние задания — advent_task(). Клиент: QUEST_NUM, WEEKLY_QUESTS, SEASON_LADDER, SEASON_THEMES (js/features/games.js),
--  ADVENT (js/core/celebrate.js), вещи — avatar.js PARTS (8-е поле: 2 — сезон, 3 — Новый год); scripts/economy-test.cjs сверяет.
--  Все числа — ПРЕДЛОЖЕНИЕ: суммы и лимиты решает владелец.
--  Нужны (на живой базе есть): games.sql, xp.sql, coins.sql, economy.sql (game_family), progression.sql (user_titles), notifications.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Числа — одно место (клиент — QUEST_NUM в js/features/games.js) ═══
--   w_xp / w_coins / w_pts — за одно задание недели (XP, 🪙, ⭐ сезона); s_win — ⭐ за победу, s_win_day — сколько побед в день дают ⭐;
--   s_daily — ⭐ за задание дня; s_lv — ⭐ на уровень сезона, s_levels — уровней; s_months — длина сезона в месяцах (настройка
--   владельца; менять только между сезонами); s_dup — 🪙 вместо вещи или рамки, которая уже есть (тема повторилась через год);
--   a_coins / a_xp — новогоднее задание, которое сервер проверил; a_small — 🪙, если проверить нельзя; a_big — сколько дней из 31
--   до большой награды, a_big_coins — её монеты; a_day_cap — сколько дней можно забрать за одни сутки по МСК (часовые пояса);
--   a_age_h — с какого возраста аккаунта (часов) новогодние награды.
create or replace function public.quest_rule(p_key text) returns int language sql immutable as $$
  select case p_key
    when 'w_xp' then 10 when 'w_coins' then 10 when 'w_pts' then 40
    when 's_win' then 2 when 's_win_day' then 10 when 's_daily' then 20
    when 's_lv' then 70 when 's_levels' then 25 when 's_months' then 1 when 's_dup' then 40
    when 'a_coins' then 10 when 'a_xp' then 5 when 'a_small' then 5 when 'a_big' then 20 when 'a_big_coins' then 150
    when 'a_day_cap' then 2 when 'a_age_h' then 24
  end
$$;
grant execute on function public.quest_rule(text) to anon, authenticated;

-- ═══ 2. Задания недели: 6 штук, новые в понедельник 00:00 по МСК ═══
-- Пул — варианты по «местам» (slot): 1 — партии, 2 — победы, 3 — разные игры, 4 — ежедневное, 5 — с людьми / вызов, 6 — сайт.
-- Неделя № w (от понедельника 05.01.2026) берёт на месте s вариант (w + s) mod (сколько вариантов) — без случайности, одинаково
-- у всех. stat — что считать (weekly_quest_stats), n — сколько нужно. Тексты — WEEKLY_QUESTS в js/features/games.js.
create table if not exists public.weekly_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week date not null,                     -- понедельник недели (МСК)
  code text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week, code)
);
alter table public.weekly_claims enable row level security;   -- политик нет: только функции ниже

create or replace function public.quest_week(p_day date default (now() at time zone 'Europe/Moscow')::date)
returns date language sql immutable as $$ select p_day - (extract(isodow from p_day)::int - 1) $$;
grant execute on function public.quest_week(date) to anon, authenticated;

create or replace function public.weekly_quest_pool() returns jsonb language sql immutable as $$
  select '[
    {"code":"w_play15","slot":1,"n":15,"stat":"plays"},
    {"code":"w_play25","slot":1,"n":25,"stat":"plays"},
    {"code":"w_win8","slot":2,"n":8,"stat":"wins"},
    {"code":"w_win12","slot":2,"n":12,"stat":"wins"},
    {"code":"w_games5","slot":3,"n":5,"stat":"games"},
    {"code":"w_wingames3","slot":3,"n":3,"stat":"wingames"},
    {"code":"w_games7","slot":3,"n":7,"stat":"games"},
    {"code":"w_daily4","slot":4,"n":4,"stat":"daily"},
    {"code":"w_words3","slot":4,"n":3,"stat":"words"},
    {"code":"w_sudoku3","slot":4,"n":3,"stat":"sudoku"},
    {"code":"w_fill3","slot":4,"n":3,"stat":"fillword"},
    {"code":"w_online3","slot":5,"n":3,"stat":"online"},
    {"code":"w_hard1","slot":5,"n":1,"stat":"hard"},
    {"code":"w_boards4","slot":5,"n":4,"stat":"boards"},
    {"code":"w_visit5","slot":6,"n":5,"stat":"visits"},
    {"code":"w_watch5","slot":6,"n":5,"stat":"watch"},
    {"code":"w_puzzle5","slot":6,"n":5,"stat":"puzzles"}
  ]'::jsonb
$$;
grant execute on function public.weekly_quest_pool() to anon, authenticated;

create or replace function public.weekly_quest_codes(p_week date default public.quest_week()) returns text[]
language plpgsql immutable as $$
declare w int := floor((p_week - date '2026-01-05') / 7.0)::int; res text[] := '{}'; arr text[]; k int;
begin
  for s in 1..6 loop
    select array_agg(e->>'code' order by o) into arr
      from jsonb_array_elements(public.weekly_quest_pool()) with ordinality t(e, o) where (e->>'slot')::int = s;
    if arr is not null then
      k := cardinality(arr);
      res := res || arr[1 + ((w + s) % k + k) % k];
    end if;
  end loop;
  return res;
end $$;
grant execute on function public.weekly_quest_codes(date) to anon, authenticated;

-- Счётчики недели: один проход по журналу партий (индекс idx_game_log_user_day: игрок + дни недели) + задание дня и просмотры
-- (xp_ledger: уникальный ключ user_id, source, ref, day / индекс idx_xp_user_day) + визиты (user_visits, первичный ключ)
create or replace function public.weekly_quest_stats(p_uid uuid, p_week date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
      'plays', count(*),
      'wins', count(*) filter (where l.win),
      'games', count(distinct public.game_family(l.game)),
      'wingames', count(distinct public.game_family(l.game)) filter (where l.win),
      'words', count(distinct l.day) filter (where l.win and l.game = 'words'),
      'sudoku', count(distinct l.day) filter (where l.win and l.game = 'sudoku_daily'),
      'fillword', count(distinct l.day) filter (where l.win and l.game = 'fillword_daily'),
      'online', count(*) filter (where l.game like '%\_online' or l.game like '%\_duel' or l.game like '%\_coop'),
      'hard', count(*) filter (where l.win and (l.game like '%\_hard' or l.game in ('miner3', 'sudoku4', 'pauk4'))),
      'boards', count(*) filter (where l.win and public.game_family(l.game) in
        ('chess', 'checkers', 'nardy', 'ludo', 'domino', 'durak', 'uno', 'pool', 'sea', 'ttt', 'balda')),
      'puzzles', count(*) filter (where l.win and public.game_family(l.game) in
        ('sudoku', 'kosynka', 'pauk', 'freecell', 'miner', 'mahjong', 'fillword')))
    into v
    from public.game_log l
   where l.user_id = p_uid and l.day between p_week and p_week + 6;
  -- задание дня: ref = дата по МСК (claim_daily_quest)
  v := v || jsonb_build_object('daily', (select count(*) from public.xp_ledger x
    where x.user_id = p_uid and x.source = 'daily' and x.ref between p_week::text and (p_week + 6)::text));
  -- просмотры роликов (claim_watch_xp): day в журнале — по UTC, неделя — по МСК
  v := v || jsonb_build_object('watch', (select count(*) from public.xp_ledger x
    where x.user_id = p_uid and x.day between p_week - 1 and p_week + 7 and x.source = 'watch'
      and (x.created_at at time zone 'Europe/Moscow')::date between p_week and p_week + 6));
  v := v || jsonb_build_object('visits', (select count(*) from public.user_visits u
    where u.user_id = p_uid and u.visit_date between p_week and p_week + 6));
  return v;
end $$;
revoke execute on function public.weekly_quest_stats(uuid, date) from public, anon, authenticated;

-- Витрина: задания этой недели (гостю — без прогресса), сколько сделано, забрано ли, награда за каждое
create or replace function public.weekly_quests() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); wk date := public.quest_week(); codes text[] := public.weekly_quest_codes(wk);
  st jsonb := '{}'::jsonb; got text[] := '{}'; e jsonb; have int; n int; list jsonb := '[]'::jsonb;
begin
  if uid is not null then
    st := public.weekly_quest_stats(uid, wk);
    select coalesce(array_agg(c.code), '{}') into got from public.weekly_claims c where c.user_id = uid and c.week = wk;
  end if;
  for e in select x from jsonb_array_elements(public.weekly_quest_pool()) x where x->>'code' = any(codes)
           order by array_position(codes, x->>'code') loop
    n := (e->>'n')::int;
    have := coalesce((st->>(e->>'stat'))::int, 0);
    list := list || jsonb_build_object('code', e->>'code', 'n', n, 'have', least(have, n), 'done', have >= n,
      'claimed', (e->>'code') = any(got));
  end loop;
  return jsonb_build_object('week', wk, 'ends', wk + 7, 'auth', uid is not null, 'list', list,
    'xp', public.quest_rule('w_xp'), 'coins', public.quest_rule('w_coins'), 'pts', public.quest_rule('w_pts'));
end $$;
grant execute on function public.weekly_quests() to anon, authenticated;

-- Забрать награду за задание недели: XP (xp_ledger 'weekly'), 🪙 (coin_log 'weekly'), ⭐ сезона — один раз (weekly_claims)
create or replace function public.claim_weekly_quest(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); wk date := public.quest_week(); e jsonb; ins int; xp int := 0; c int := 0; ref text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_code is null or not (p_code = any(public.weekly_quest_codes(wk))) then
    return jsonb_build_object('ok', false, 'reason', 'code');
  end if;
  select x into e from jsonb_array_elements(public.weekly_quest_pool()) x where x->>'code' = p_code;
  if coalesce((public.weekly_quest_stats(uid, wk)->>(e->>'stat'))::int, 0) < (e->>'n')::int then
    return jsonb_build_object('ok', false, 'reason', 'not_done');
  end if;
  insert into public.weekly_claims (user_id, week, code) values (uid, wk, p_code) on conflict do nothing;
  get diagnostics ins = row_count;
  if ins = 0 then return jsonb_build_object('ok', false, 'reason', 'claimed'); end if;
  ref := wk::text || ':' || p_code;
  begin xp := public.xp_award(uid, 'weekly', ref, public.quest_rule('w_xp')); exception when others then xp := 0; end;
  if to_regprocedure('public.coin_add(uuid,integer,text,text)') is not null then
    perform public.coin_add(uid, public.quest_rule('w_coins'), 'weekly', ref);
    c := public.quest_rule('w_coins');
  end if;
  perform public.season_add(uid, 'weekly', public.quest_rule('w_pts'));
  delete from public.weekly_claims where user_id = uid and week < wk - 70;   -- старше 10 недель — не нужно
  return jsonb_build_object('ok', true, 'xp', xp, 'coins', c, 'pts', public.quest_rule('w_pts'));
end $$;
revoke execute on function public.claim_weekly_quest(text) from public, anon;
grant execute on function public.claim_weekly_quest(text) to authenticated;

-- ═══ 3. Сезонный путь (бесплатный): сезон = календарный месяц по МСК (s_months); № 1 — ноябрь 2026, октябрь 2026 — пробный (№ 0) ═══
-- ⭐ — за победы (s_win, первые s_win_day побед в день), задание дня (s_daily), задания недели (w_pts). Уровень = ⭐ / s_lv (до
-- s_levels). Награды уровней забирают кнопкой (season_claim) когда угодно, за прошлые сезоны тоже (до 12 назад); всё навсегда:
-- монеты, вещь темы (coin_wallet.items), рамка темы и титулы (season_owned). Тема повторилась через год — вместо вещи/рамки s_dup 🪙.
create table if not exists public.season_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season int not null,
  pts int not null default 0,
  claimed int not null default 0,          -- награды выданы до этого уровня включительно
  day date,                                -- день (МСК) последнего начисления — для лимита побед в день
  day_wins int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, season)
);
alter table public.season_progress enable row level security;   -- политик нет: season_state(), триггеры и функции ниже

create table if not exists public.season_owned (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('title', 'frame')),
  code text not null,                      -- титул 'ss:ГГГГ-ММ:1' (участник) / ':2' (легенда); рамка — id темы ('nov')
  season int not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, code)
);
alter table public.season_owned enable row level security;

create table if not exists public.season_frame (       -- надетая рамка сезона (выбор игрока; видят все — season_frames)
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null,
  updated_at timestamptz not null default now()
);
alter table public.season_frame enable row level security;

-- Номер сезона по дню (МСК) и день его начала
create or replace function public.season_no(p_day date default (now() at time zone 'Europe/Moscow')::date) returns int
language sql immutable as $$
  select floor(((extract(year from p_day)::int - 2026) * 12 + extract(month from p_day)::int - 11)::numeric
    / public.quest_rule('s_months'))::int + 1
$$;
create or replace function public.season_start(p_no int) returns date language sql immutable as $$
  select (date '2026-11-01' + make_interval(months => (p_no - 1) * public.quest_rule('s_months')))::date
$$;
grant execute on function public.season_no(date) to anon, authenticated;
grant execute on function public.season_start(int) to anon, authenticated;

-- Темы — по месяцу начала сезона: id (рамка .lv-frame-ss[data-ss=id] в css/premium.css), значок, название, вещь (avatar.js PARTS,
-- 8-е поле = 2 — не продаётся), цвет. Клиент — SEASON_THEMES в js/features/games.js
create or replace function public.season_themes() returns jsonb language sql immutable as $$
  select '[
    {"m":1,"id":"jan","icon":"🐧","name":"Зимние забавы","item":"skin:pet:penguin","color":"#7dd3fc"},
    {"m":2,"id":"feb","icon":"🧊","name":"Ледяные узоры","item":"skin:trail:ice","color":"#93c5fd"},
    {"m":3,"id":"mar","icon":"🌷","name":"Наурыз","item":"skin:item:tulip","color":"#f472b6"},
    {"m":4,"id":"apr","icon":"💧","name":"Капель","item":"skin:trail:drops","color":"#38bdf8"},
    {"m":5,"id":"may","icon":"🐝","name":"Цветение","item":"skin:pet:bee","color":"#facc15"},
    {"m":6,"id":"jun","icon":"🍉","name":"Лето","item":"skin:item:melon","color":"#4ade80"},
    {"m":7,"id":"jul","icon":"🐢","name":"Море","item":"skin:pet:turtle","color":"#22d3ee"},
    {"m":8,"id":"aug","icon":"🌠","name":"Звездопад","item":"skin:trail:starfall","color":"#a78bfa"},
    {"m":9,"id":"sep","icon":"📚","name":"Знания","item":"skin:item:books","color":"#fb923c"},
    {"m":10,"id":"oct","icon":"🎃","name":"Тыквы","item":"skin:pet:pumpkin","color":"#f97316"},
    {"m":11,"id":"nov","icon":"☂️","name":"Осенний дождь","item":"skin:item:umbrella","color":"#d97706"},
    {"m":12,"id":"dec","icon":"🎁","name":"Новогодний","item":"skin:item:gift","color":"#ef4444"}
  ]'::jsonb
$$;
create or replace function public.season_theme(p_no int) returns jsonb language sql immutable as $$
  select x from jsonb_array_elements(public.season_themes()) x
   where (x->>'m')::int = extract(month from public.season_start(p_no))::int
$$;
-- Лестница: lv — уровень; coins — 🪙; title — 1 «участник» (значок и название темы с годом), 2 — «Легенда»; item — вещь темы;
-- frame — рамка темы. Клиент — SEASON_LADDER в js/features/games.js. Ни XP, ни VIP, ни силы в играх — только 🪙 и украшения.
create or replace function public.season_ladder() returns jsonb language sql immutable as $$
  select '[
    {"lv":1,"coins":10},{"lv":2,"coins":10},{"lv":3,"coins":10},{"lv":4,"title":1},{"lv":5,"coins":15},
    {"lv":6,"coins":15},{"lv":7,"coins":15},{"lv":8,"coins":15},{"lv":9,"coins":20},{"lv":10,"item":1},
    {"lv":11,"coins":20},{"lv":12,"coins":20},{"lv":13,"coins":20},{"lv":14,"coins":20},{"lv":15,"frame":1},
    {"lv":16,"coins":25},{"lv":17,"coins":25},{"lv":18,"coins":25},{"lv":19,"coins":25},{"lv":20,"coins":30},
    {"lv":21,"coins":25},{"lv":22,"coins":25},{"lv":23,"coins":30},{"lv":24,"coins":30},{"lv":25,"title":2,"coins":50}
  ]'::jsonb
$$;
grant execute on function public.season_themes() to anon, authenticated;
grant execute on function public.season_theme(int) to anon, authenticated;
grant execute on function public.season_ladder() to anon, authenticated;

-- Платный путь: НЕТ (красная линия до решения владельца о деньгах; если когда-нибудь — только украшения и ускорение пути, без
-- силы в играх и рейтингах, без случайности). Здесь — только выключатель; клиент без него ничего не показывает.
create or replace function public.season_paid_on() returns boolean language sql immutable as $$ select false $$;
grant execute on function public.season_paid_on() to anon, authenticated;

-- Начислить ⭐ (только сервер: триггеры ниже и claim_weekly_quest). p_src 'win' — победа (не больше s_win_day побед в день по МСК)
create or replace function public.season_add(p_uid uuid, p_src text, p_pts int) returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Moscow')::date; n int := public.season_no(d); r public.season_progress%rowtype;
  v_add int := greatest(coalesce(p_pts, 0), 0); per int := public.quest_rule('s_lv'); v_top int := public.quest_rule('s_levels');
  lv0 int; lv1 int; e jsonb; th jsonb;
begin
  if p_uid is null or v_add = 0 or n < 0 then return 0; end if;
  insert into public.season_progress (user_id, season) values (p_uid, n) on conflict do nothing;
  select * into r from public.season_progress where user_id = p_uid and season = n for update;
  if r.day is distinct from d then r.day_wins := 0; end if;
  if p_src = 'win' then
    if r.day_wins >= public.quest_rule('s_win_day') then v_add := 0; end if;
    r.day_wins := r.day_wins + 1;
  end if;
  update public.season_progress set pts = pts + v_add, day = d, day_wins = r.day_wins, updated_at = now()
   where user_id = p_uid and season = n;
  -- новый уровень с вещью, рамкой или титулом — уведомление (монеты — молча; забрать всё — в «Играх»)
  lv0 := least(r.pts / per, v_top); lv1 := least((r.pts + v_add) / per, v_top);
  if lv1 > lv0 then
    th := public.season_theme(n);
    for e in select x from jsonb_array_elements(public.season_ladder()) x
             where (x->>'lv')::int > lv0 and (x->>'lv')::int <= lv1 and (x ? 'item' or x ? 'frame' or x ? 'title') loop
      begin
        perform public.notify(p_uid, 'season', null, '🏆 Сезон «' || (th->>'name') || '»: уровень ' || (e->>'lv'),
          case when e ? 'item' then 'Награда: вещь для персонажа' when e ? 'frame' then 'Награда: рамка аватара'
               when e->>'title' = '2' then 'Награда: титул «Легенда сезона»' else 'Награда: титул сезона' end || ' — забери в «Играх»',
          '#/games', 'season_' || n || '_' || (e->>'lv'));
      exception when others then null;
      end;
    end loop;
  end if;
  return r.pts + v_add;
end $$;
revoke execute on function public.season_add(uuid, text, int) from public, anon, authenticated;

-- ⭐ за победу (game_result и unity_result пишут game_log) и за задание дня (claim_daily_quest пишет xp_ledger 'daily').
-- Ошибка здесь никогда не ломает саму запись (как монеты в coins.sql)
create or replace function public.season_on_game_win() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.season_add(new.user_id, 'win', public.quest_rule('s_win')); exception when others then null; end;
  return null;
end $$;
drop trigger if exists trg_season_on_game_win on public.game_log;
create trigger trg_season_on_game_win after insert on public.game_log
  for each row when (new.win) execute function public.season_on_game_win();

create or replace function public.season_on_daily_quest() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.season_add(new.user_id, 'daily', public.quest_rule('s_daily')); exception when others then null; end;
  return null;
end $$;
drop trigger if exists trg_season_on_daily_quest on public.xp_ledger;
create trigger trg_season_on_daily_quest after insert on public.xp_ledger
  for each row when (new.source = 'daily') execute function public.season_on_daily_quest();

-- Витрина сезона: номер, даты, тема, ⭐, до какого уровня забрано, незабранное в прошлых сезонах, мои титулы и рамки
create or replace function public.season_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); d date := (now() at time zone 'Europe/Moscow')::date; n int := public.season_no(d);
  r public.season_progress%rowtype; per int := public.quest_rule('s_lv'); v_top int := public.quest_rule('s_levels');
  prev jsonb := '[]'::jsonb; owned jsonb := '[]'::jsonb; fr text; tt text;
begin
  if uid is not null then
    select * into r from public.season_progress where user_id = uid and season = n;
    select coalesce(jsonb_agg(jsonb_build_object('no', s.season, 'theme', public.season_theme(s.season)->>'id',
        'start', public.season_start(s.season), 'lv', least(s.pts / per, v_top), 'claimed', s.claimed) order by s.season desc), '[]'::jsonb)
      into prev from public.season_progress s
     where s.user_id = uid and s.season < n and s.season >= n - 12 and least(s.pts / per, v_top) > s.claimed;
    select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'code', o.code, 'no', o.season) order by o.created_at), '[]'::jsonb)
      into owned from public.season_owned o where o.user_id = uid;
    select f.theme into fr from public.season_frame f where f.user_id = uid;
    if to_regclass('public.user_titles') is not null then
      execute 'select code from public.user_titles where user_id = $1' into tt using uid;
    end if;
  end if;
  return jsonb_build_object('no', n, 'start', public.season_start(n), 'end', public.season_start(n + 1),
    'theme', public.season_theme(n)->>'id', 'auth', uid is not null, 'pts', coalesce(r.pts, 0), 'claimed', coalesce(r.claimed, 0),
    'wins_today', case when r.day = d then r.day_wins else 0 end, 'per', per, 'levels', v_top,
    'prev', prev, 'owned', owned, 'frame', fr, 'title', tt, 'paid', public.season_paid_on());
end $$;
grant execute on function public.season_state() to anon, authenticated;

-- Забрать награды всех пройденных уровней сезона (по умолчанию — текущего; прошлые — до 12 сезонов назад). Каждая — один раз
-- (claimed под блокировкой строки); вещь или рамка уже есть — вместо неё s_dup 🪙
create or replace function public.season_claim(p_no int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur int := public.season_no(); n int := coalesce(p_no, cur); r public.season_progress%rowtype;
  per int := public.quest_rule('s_lv'); v_top int := public.quest_rule('s_levels'); dup int := public.quest_rule('s_dup');
  lv int; e jsonb; th jsonb; ym text; k int; c int; m int; total int := 0; got jsonb := '[]'::jsonb; one jsonb; it text; bal int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if n > cur or n < cur - 12 or n < 0 then return jsonb_build_object('ok', false, 'reason', 'season'); end if;
  if to_regprocedure('public.coin_add(uuid,integer,text,text)') is null or to_regclass('public.coin_wallet') is null then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end if;
  select * into r from public.season_progress where user_id = uid and season = n for update;
  if not found then return jsonb_build_object('ok', true, 'got', got, 'coins', 0, 'claimed', 0); end if;
  lv := least(r.pts / per, v_top);
  if lv <= r.claimed then return jsonb_build_object('ok', true, 'got', got, 'coins', 0, 'claimed', r.claimed); end if;
  th := public.season_theme(n);
  ym := to_char(public.season_start(n), 'YYYY-MM');
  insert into public.coin_wallet (user_id) values (uid) on conflict (user_id) do nothing;
  for e in select x from jsonb_array_elements(public.season_ladder()) x
           where (x->>'lv')::int > r.claimed and (x->>'lv')::int <= lv order by (x->>'lv')::int loop
    k := (e->>'lv')::int; c := coalesce((e->>'coins')::int, 0); one := jsonb_build_object('lv', k);
    if e ? 'title' then
      insert into public.season_owned (user_id, kind, code, season) values (uid, 'title', 'ss:' || ym || ':' || (e->>'title'), n)
        on conflict do nothing;
      one := one || jsonb_build_object('title', 'ss:' || ym || ':' || (e->>'title'));
    end if;
    if e ? 'frame' then
      insert into public.season_owned (user_id, kind, code, season) values (uid, 'frame', th->>'id', n) on conflict do nothing;
      get diagnostics m = row_count;
      one := one || jsonb_build_object('frame', th->>'id', 'dup', m = 0);
      if m = 0 then c := c + dup; end if;
    end if;
    if e ? 'item' then
      it := th->>'item';
      update public.coin_wallet set items = array_append(items, it), updated_at = now() where user_id = uid and not (it = any(items));
      get diagnostics m = row_count;
      one := one || jsonb_build_object('item', it, 'dup', m = 0);
      if m = 0 then c := c + dup; end if;
    end if;
    if c > 0 then
      bal := public.coin_add(uid, c, 'season', 'S' || n || ':' || k);
      total := total + c;
      one := one || jsonb_build_object('coins', c);
    end if;
    got := got || one;
  end loop;
  update public.season_progress set claimed = lv, updated_at = now() where user_id = uid and season = n;
  return jsonb_build_object('ok', true, 'got', got, 'coins', total, 'claimed', lv, 'balance', bal);
end $$;
revoke execute on function public.season_claim(int) from public, anon;
grant execute on function public.season_claim(int) to authenticated;

-- Титул сезона рядом с ником (та же user_titles, что у set_title из progression.sql; снять — set_title(''))
create or replace function public.season_title_set(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not exists (select 1 from public.season_owned where user_id = uid and kind = 'title' and code = p_code) then
    return jsonb_build_object('ok', false, 'reason', 'not_owned');
  end if;
  insert into public.user_titles (user_id, code) values (uid, p_code)
    on conflict (user_id) do update set code = excluded.code, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.season_title_set(text) from public, anon;
grant execute on function public.season_title_set(text) to authenticated;

-- Рамка сезона на аватаре ('' — снять, тогда снова рамка уровня)
create or replace function public.season_frame_set(p_theme text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if coalesce(p_theme, '') = '' then
    delete from public.season_frame where user_id = uid;
    return jsonb_build_object('ok', true);
  end if;
  if not exists (select 1 from public.season_owned where user_id = uid and kind = 'frame' and code = p_theme) then
    return jsonb_build_object('ok', false, 'reason', 'not_owned');
  end if;
  insert into public.season_frame (user_id, theme) values (uid, p_theme)
    on conflict (user_id) do update set theme = excluded.theme, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.season_frame_set(text) from public, anon;
grant execute on function public.season_frame_set(text) to authenticated;

-- Надетые рамки сезонов пачкой — для аватаров (js/features/xp.js applyLevelFrame), до 200 за раз
create or replace function public.season_frames(p_ids uuid[]) returns table(user_id uuid, theme text)
language sql stable security definer set search_path = public as $$
  select f.user_id, f.theme from public.season_frame f where f.user_id = any(p_ids[1:200])
$$;
grant execute on function public.season_frames(uuid[]) to anon, authenticated;

-- Всё для витрины «Игр» и профиля — одним запросом
create or replace function public.quest_hub() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  return jsonb_build_object('weekly', public.weekly_quests(), 'season', public.season_state());
end $$;
grant execute on function public.quest_hub() to anon, authenticated;

-- ═══ 4. Новогоднее задание (js/core/celebrate.js ADVENT, docs/SEASONS.md §9): награда за день — с сервера ═══
-- Раз за каждый день 1–31 декабря. День задания у игрока местный, сервер считает по МСК и принимает соседний день (часовые пояса),
-- но не больше a_day_cap дней за одни сутки по МСК; аккаунту — от a_age_h часов. Что сервер видит (сыграл, победил, игра, чат) —
-- проверяет: сделано — a_coins 🪙 и a_xp XP; не видно (переход по сайту, желание) или не сделано — a_small 🪙.
-- a_big дней — ⛄ «Снеговик» (питомец навсегда, avatar.js PARTS, 8-е поле = 3) и a_big_coins 🪙 (Снеговик уже есть — + s_dup 🪙).
create table if not exists public.advent_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  year int not null,                       -- год декабря
  day int not null check (day between 0 and 31),   -- 0 — большая награда
  msk_day date not null,                   -- когда забрал (МСК) — для лимита a_day_cap
  full_reward boolean not null default false,
  coins int not null default 0,
  xp int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, year, day)
);
create index if not exists idx_advent_log_msk on public.advent_log (user_id, msk_day);
alter table public.advent_log enable row level security;   -- политик нет: advent_state() / advent_claim()

-- Задание дня декабря — как ADVENT в js/core/celebrate.js (kind; «*N» — сколько раз)
create or replace function public.advent_task(p_day int) returns text language sql immutable as $$
  select (array['play', 'route:#/games/world', 'route:#/games/wardrobe', 'game:words', 'win', 'chat', 'route:#/games/kubomir',
    'route:#/shorts', 'game:sudoku', 'route:#/invite', 'route:#/games/studio3d', 'game:chess|checkers', 'game:durak|uno', 'game:horde',
    'game:blocks', 'route:#/games/podzem', 'game:td', 'game:fillword', 'game:pool', 'game:kosynka|pauk|freecell', 'game:krokodil',
    'route:#/profile', 'game:miner', 'game:mahjong', 'game:arena', 'route:#/ideas', 'route:#/games', 'play*3', 'win*2', 'route:#/phone',
    'wish'])[p_day]
$$;
grant execute on function public.advent_task(int) to anon, authenticated;

-- Год новогоднего задания по дню МСК: декабрь, а ещё 30 ноября и 1 января (соседний день у игроков в других часовых поясах); иначе null
create or replace function public.advent_year(p_today date) returns int language sql immutable as $$
  select case when extract(month from p_today) = 12 then extract(year from p_today)::int
              when extract(month from p_today) = 1 and extract(day from p_today) = 1 then extract(year from p_today)::int - 1
              when extract(month from p_today) = 11 and extract(day from p_today) = 30 then extract(year from p_today)::int end
$$;

-- Проверка задания там, где сервер видит: true — сделано, false — нет, null — проверить нельзя (переход по сайту, желание).
-- Окно — соседние дни по МСК (у игрока день местный)
create or replace function public.advent_verified(p_uid uuid, p_kind text, p_day date) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare k text := split_part(coalesce(p_kind, ''), '*', 1); n int := coalesce(nullif(split_part(coalesce(p_kind, ''), '*', 2), '')::int, 1);
  kind text := split_part(k, ':', 1); arg text := split_part(k, ':', 2);
begin
  if kind = 'play' then
    return (select count(distinct public.game_family(l.game)) from public.game_log l
             where l.user_id = p_uid and l.day between p_day - 1 and p_day + 1) >= n;
  elsif kind = 'win' then
    return (select count(*) from public.game_log l where l.user_id = p_uid and l.day between p_day - 1 and p_day + 1 and l.win) >= n;
  elsif kind = 'game' then
    return exists (select 1 from public.game_log l where l.user_id = p_uid and l.day between p_day - 1 and p_day + 1
                     and public.game_family(l.game) = any(string_to_array(arg, '|')));
  elsif kind = 'chat' then
    return exists (select 1 from public.xp_ledger x where x.user_id = p_uid and x.day between p_day - 1 and p_day + 1 and x.source = 'chat');
  end if;
  return null;
end $$;
revoke execute on function public.advent_verified(uuid, text, date) from public, anon, authenticated;

-- Забрать награду за день p_day (p_today — день МСК; клиенту — advent_claim ниже)
create or replace function public.advent_claim_at(p_uid uuid, p_day int, p_today date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare y int := public.advent_year(p_today); d date; created timestamptz; v boolean; is_full boolean; c int; x int := 0;
  ref text; tot int; big boolean := false; m int; it text := 'skin:pet:snowman'; bc int;
begin
  if p_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if y is null then return jsonb_build_object('ok', false, 'reason', 'off'); end if;
  if p_day is null or p_day < 1 or p_day > 31 then return jsonb_build_object('ok', false, 'reason', 'day'); end if;
  d := make_date(y, 12, p_day);
  if abs(d - p_today) > 1 then return jsonb_build_object('ok', false, 'reason', 'day'); end if;
  if to_regprocedure('public.coin_add(uuid,integer,text,text)') is null or to_regclass('public.coin_wallet') is null then
    return jsonb_build_object('ok', false, 'reason', 'coins');
  end if;
  select p.created_at into created from public.profiles p where p.id = p_uid;
  if created > now() - make_interval(hours => public.quest_rule('a_age_h')) then
    return jsonb_build_object('ok', false, 'reason', 'new');
  end if;
  perform pg_advisory_xact_lock(hashtext('advent:' || p_uid::text));   -- два запроса разом не обойдут лимиты
  if exists (select 1 from public.advent_log where user_id = p_uid and year = y and day = p_day) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;
  if (select count(*) from public.advent_log where user_id = p_uid and msk_day = p_today and day > 0) >= public.quest_rule('a_day_cap') then
    return jsonb_build_object('ok', false, 'reason', 'day_cap');
  end if;
  v := public.advent_verified(p_uid, public.advent_task(p_day), d);
  is_full := coalesce(v, false);
  c := case when is_full then public.quest_rule('a_coins') else public.quest_rule('a_small') end;
  ref := y || '-' || p_day;
  if is_full then
    begin x := public.xp_award(p_uid, 'advent', ref, public.quest_rule('a_xp')); exception when others then x := 0; end;
  end if;
  perform public.coin_add(p_uid, c, 'advent', ref);
  insert into public.advent_log (user_id, year, day, msk_day, full_reward, coins, xp) values (p_uid, y, p_day, p_today, is_full, c, coalesce(x, 0));
  select count(*) into tot from public.advent_log where user_id = p_uid and year = y and day > 0;
  if tot >= public.quest_rule('a_big') and not exists (select 1 from public.advent_log where user_id = p_uid and year = y and day = 0) then
    insert into public.coin_wallet (user_id) values (p_uid) on conflict (user_id) do nothing;
    update public.coin_wallet set items = array_append(items, it), updated_at = now() where user_id = p_uid and not (it = any(items));
    get diagnostics m = row_count;
    bc := public.quest_rule('a_big_coins') + case when m = 0 then public.quest_rule('s_dup') else 0 end;
    perform public.coin_add(p_uid, bc, 'advent', y || '-big');
    insert into public.advent_log (user_id, year, day, msk_day, full_reward, coins) values (p_uid, y, 0, p_today, true, bc);
    big := true;
    begin
      perform public.notify(p_uid, 'advent', null, '⛄ Новогоднее задание: ' || tot || ' дней!',
        case when m = 0 then '+' || bc || ' 🪙 (Снеговик у тебя уже есть)'
             else 'Питомец «Снеговик» — твой навсегда (в гардеробе) и +' || bc || ' 🪙' end,
        '#/games/wardrobe', 'advent_big_' || y);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'full', is_full, 'verified', v, 'coins', c, 'xp', coalesce(x, 0), 'total', tot, 'big', big,
    'need', public.quest_rule('a_big'));
end $$;
revoke execute on function public.advent_claim_at(uuid, int, date) from public, anon, authenticated;

create or replace function public.advent_claim(p_day int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return public.advent_claim_at(auth.uid(), p_day, (now() at time zone 'Europe/Moscow')::date);
end $$;
revoke execute on function public.advent_claim(int) from public, anon;
grant execute on function public.advent_claim(int) to authenticated;

-- Для карточки: какие дни этого декабря уже забраны (и полной ли наградой), есть ли большая награда
create or replace function public.advent_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); y int := public.advent_year((now() at time zone 'Europe/Moscow')::date); days jsonb;
begin
  if y is null then return jsonb_build_object('on', false); end if;
  if uid is null then return jsonb_build_object('on', true, 'year', y, 'auth', false, 'need', public.quest_rule('a_big')); end if;
  select coalesce(jsonb_agg(jsonb_build_object('d', a.day, 'full', a.full_reward) order by a.day), '[]'::jsonb) into days
    from public.advent_log a where a.user_id = uid and a.year = y and a.day > 0;
  return jsonb_build_object('on', true, 'year', y, 'auth', true, 'days', days, 'total', jsonb_array_length(days),
    'big', exists (select 1 from public.advent_log a where a.user_id = uid and a.year = y and a.day = 0),
    'need', public.quest_rule('a_big'));
end $$;
grant execute on function public.advent_state() to anon, authenticated;

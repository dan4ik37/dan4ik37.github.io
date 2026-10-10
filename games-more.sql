-- ═══════════════════════════════════════════════════════════════════
--  НОВЫЕ ИГРЫ — ключи для game_result (рекорды, XP за победу): «Угадай игру по эмодзи» (emoji, emoji_duel),
--  «Орда» (horde, horde_duel, horde_coop), «Башни» (td, td_duel, td_coop),
--  «Одна!» (uno, uno_online), «Дурак» (durak, durak_online),
--  «Бильярд» (pool_easy, pool_normal, pool_hard, pool_online), «Лудо» (ludo, ludo_online),
--  «Нарды» (nardy_easy, nardy_hard, nardy_online), «Арена» (arena_easy, arena_normal, arena_hard, arena_online),
--  «Шахматы» (chess_easy, chess_normal, chess_hard, chess_online), «Блоки» (blocks, blocks_duel),
--  «Косынка» (kosynka, kosynka3, kosynka_duel), «Паук» (pauk1, pauk2, pauk4).
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно. Нужен games.sql (он уже применён).
--  Функции целиком скопированы из games.sql + новые ключи (заменяет games-emoji.sql — тот можно не запускать).
--  До запуска игры работают, просто без XP и таблицы рекордов.
--  Проверка: select public.game_score_cap('horde'); → 30000
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
    else null end;
$$;

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
    when 'guess_duel' then 10 when '2048_duel' then 10 when 'catch_duel' then 10 when 'reaction_duel' then 10
    when 'sea_easy' then 5 when 'sea_normal' then 15 when 'sea_hard' then 25 when 'sea_online' then 10
    when 'snake' then 10 when 'snake_duel' then 10
    when 'memory' then 10 when 'memory_duel' then 10
    when 'words' then 15 when 'words_free' then 3 when 'words_duel' then 10
    when 'emoji' then 10 when 'emoji_duel' then 10
    when 'horde' then 20 when 'horde_duel' then 15 when 'horde_coop' then 20
    when 'td' then 20 when 'td_duel' then 15 when 'td_coop' then 20
    when 'uno' then 10 when 'uno_online' then 15
    when 'durak' then 10 when 'durak_online' then 15
    when 'pool_easy' then 3 when 'pool_normal' then 10 when 'pool_hard' then 20 when 'pool_online' then 15
    when 'ludo' then 10 when 'ludo_online' then 15
    when 'nardy_easy' then 5 when 'nardy_hard' then 20 when 'nardy_online' then 15
    when 'arena_easy' then 3 when 'arena_normal' then 10 when 'arena_hard' then 20 when 'arena_online' then 15
    when 'chess_easy' then 3 when 'chess_normal' then 10 when 'chess_hard' then 30 when 'chess_online' then 15
    when 'blocks' then 10 when 'blocks_duel' then 10
    when 'kosynka' then 10 when 'kosynka3' then 15 when 'kosynka_duel' then 10
    when 'pauk1' then 10 when 'pauk2' then 20 when 'pauk4' then 40
    else 0 end;
$$;

-- ═══════════════════════════════════════════════════════════════════
--  ЭКОНОМИКА НАГРАД (15.10.2026, docs/ECONOMY.md): XP примерно вдвое меньше, бесплатный VIP за уровень — редкий
--  (пробный на 3 дня — 30-й уровень, на неделю — 50-й, месяц — только 100-й; Silver и Gold — только за поддержку),
--  а за уровни — разные награды почти каждые 5 уровней: рамки, значки-титулы, вещи персонажа, золотой и радужный ник,
--  монеты, места для друзей.
--  Выполнить целиком в Supabase → SQL Editor. Идемпотентно (можно запускать повторно).
--  Порядок: games-more.sql → coins.sql → economy.sql (этот — последним).
--  Нужны уже применённые: xp.sql, games.sql, progression.sql, secrets.sql, coins.sql, notifications.sql;
--  unity.sql — если есть (без него unity_result не трогаем).
--
--  ВНИМАНИЕ: здесь переопределены функции из xp.sql (xp_on_visit, xp_on_message, xp_on_forum_thread, xp_on_forum_post,
--  xp_on_idea, xp_on_referral, claim_watch_xp), games.sql (game_result, claim_daily_quest), progression.sql
--  (grant_level_vip, check_level_rewards, friend_limit, my_achievements, achievement_xp), secrets.sql (secret_found,
--  nick_fx_users) и unity.sql (unity_result). Перезапустил любой из тех файлов — потом запусти этот ещё раз.
--
--  Все числа XP — xp_rule(), лестница уровней — level_ladder(), XP ачивок — achievement_xp(). Клиент: XP_NUM и
--  LEVEL_REWARDS в js/features/xp.js, ACHIEVEMENT_DEFS в js/features/achievements.js (scripts/economy-test.cjs сверяет).
--  Уже выданное (XP, VIP за уровень, ачивки) не отнимается — новые правила действуют с момента запуска. Кто уже получил
--  старый VIP за 30/50/100 уровень, на том же уровне второй раз ничего не получит (vip_grants — по уровню).
--  Проверка после запуска: /rpc/xp_rule {"p_key":"visit"} → 5 (PGRST202 — файл не применён), /rpc/achievement_xp
--  {"p_code":"creator"} → 250, /rpc/level_ladder → список уровней.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ 1. Числа XP — одно место ═══
--   visit — визит за день; streak7 / streak30 — серия визитов; chat / chat_day — сообщение и сколько в день;
--   forum_thread(_day), forum_post(_day) — форум; idea(_day) — идея, idea_done — идею сняли; referral — приглашённый;
--   watch / watch_day — просмотр ролика; daily — задание дня; secret — все 7 секретов;
--   game_family — сколько побед в день дают XP в ОДНОЙ игре (horde, horde_duel, horde_coop — одна игра),
--   game_day — сколько XP в день за все игры вместе; unity_win — победа в Unity-игре (в тех же лимитах).
create or replace function public.xp_rule(p_key text) returns int language sql immutable as $$
  select case p_key
    when 'visit' then 5 when 'streak7' then 25 when 'streak30' then 100
    when 'chat' then 1 when 'chat_day' then 15
    when 'forum_thread' then 8 when 'forum_thread_day' then 3 when 'forum_post' then 2 when 'forum_post_day' then 10
    when 'idea' then 3 when 'idea_day' then 3 when 'idea_done' then 50
    when 'referral' then 50
    when 'watch' then 3 when 'watch_day' then 10
    when 'daily' then 25 when 'secret' then 50
    when 'game_family' then 3 when 'game_day' then 100 when 'unity_win' then 5
  end
$$;
grant execute on function public.xp_rule(text) to anon, authenticated;

-- ═══ 2. Источники XP (тела — как в xp.sql / games.sql / secrets.sql, только числа из xp_rule) ═══
create or replace function public.xp_on_visit()
returns trigger language plpgsql security definer set search_path = public as $$
declare s int;
begin
  begin
    perform public.xp_award(new.user_id, 'visit', '', public.xp_rule('visit'));
    s := public.current_streak(new.user_id);
    if s = 7 then perform public.xp_award(new.user_id, 'streak', '7', public.xp_rule('streak7')); end if;
    if s = 30 then perform public.xp_award(new.user_id, 'streak', '30', public.xp_rule('streak30')); end if;
  exception when others then null;
  end;
  return null;
end; $$;

create or replace function public.xp_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.user_id is not null then
      perform public.xp_award(new.user_id, 'chat', new.id::text, public.xp_rule('chat'), public.xp_rule('chat_day'));
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

create or replace function public.xp_on_forum_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.xp_award(new.author_id, 'forum_thread', new.id::text, public.xp_rule('forum_thread'), public.xp_rule('forum_thread_day'));
  exception when others then null; end;
  return null;
end; $$;

create or replace function public.xp_on_forum_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.xp_award(new.author_id, 'forum_post', new.id::text, public.xp_rule('forum_post'), public.xp_rule('forum_post_day'));
  exception when others then null; end;
  return null;
end; $$;

-- Идеи: раньше XP за идею был без дневного лимита (спам идеями = XP) — теперь idea_day в день
create or replace function public.xp_on_idea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.xp_award(new.author_id, 'idea', new.id::text, public.xp_rule('idea'), public.xp_rule('idea_day'));
    elsif new.status = 'done' and old.status is distinct from 'done' then
      perform public.xp_award(new.author_id, 'idea_done', new.id::text, public.xp_rule('idea_done'));
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

create or replace function public.xp_on_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.referred_by is not null and (tg_op = 'INSERT' or old.referred_by is null) then
      perform public.xp_award(new.referred_by, 'referral', new.id::text, public.xp_rule('referral'));
    end if;
  exception when others then null;
  end;
  return null;
end; $$;

-- Просмотр ролика: watch XP, до watch_day роликов в день, не чаще раза в 30 с (как в xp.sql)
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
  got := public.xp_award(uid, 'watch', p_video_id, public.xp_rule('watch'), public.xp_rule('watch_day'));
  return jsonb_build_object('ok', got > 0, 'amount', got,
    'reason', case when got > 0 then 'ok' else 'limit_or_seen' end,
    'total', (select coalesce(sum(amount), 0) from public.xp_ledger where user_id = uid));
end;
$$;
grant execute on function public.claim_watch_xp(text) to authenticated;

-- Задание дня: daily XP (монеты за него — триггер coins_on_daily_quest в coins.sql)
create or replace function public.claim_daily_quest()
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Europe/Moscow')::date; uid uuid := auth.uid(); got int;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if not public.daily_quest_done(uid, public.daily_quest_code(d), d) then return jsonb_build_object('ok', false, 'reason', 'not_done'); end if;
  if exists (select 1 from public.xp_ledger where user_id = uid and source = 'daily' and ref = d::text) then
    return jsonb_build_object('ok', false, 'reason', 'claimed');
  end if;
  got := public.xp_award(uid, 'daily', d::text, public.xp_rule('daily'));
  return jsonb_build_object('ok', got > 0, 'xp', got);
end; $$;
grant execute on function public.claim_daily_quest() to authenticated;

-- Охота за секретами: все 7 → радужный ник на 30 дней + secret XP один раз (как в secrets.sql)
create or replace function public.secret_found(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  total int := cardinality(public.secret_codes());
  r public.secret_hunt%rowtype;
  got int := 0;
  just_done boolean := false;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  if p_code is null or not (p_code = any(public.secret_codes())) then
    return jsonb_build_object('ok', false, 'reason', 'code');
  end if;
  insert into public.secret_hunt as s (user_id, found) values (uid, array[p_code])
    on conflict (user_id) do update
      set found = case when p_code = any(s.found) then s.found else s.found || p_code end
    returning * into r;
  if cardinality(r.found) >= total and r.completed_at is null then
    update public.secret_hunt
      set completed_at = now(),
          reward_until = greatest(coalesce(reward_until, now()), now()) + interval '30 days'
      where user_id = uid
      returning * into r;
    just_done := true;
    begin got := public.xp_award(uid, 'secret', 'hunt', public.xp_rule('secret')); exception when others then got := 0; end;
    begin
      perform public.notify(uid, 'secret', null, '🌈 Все секреты найдены!',
        'Радужный ник — твой на 30 дней. Его видно в чате и в профиле.', '#/profile', 'secret-hunt');
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'found', r.found, 'total', total,
    'completed', r.completed_at is not null, 'just_done', just_done,
    'reward_until', r.reward_until, 'xp', got);
end; $$;
revoke execute on function public.secret_found(text) from public, anon;
grant execute on function public.secret_found(text) to authenticated;

-- ═══ 3. XP за игры: на одну игру и на день ═══
-- Раньше лимит был только «15 наград в день», и выгоднее всего было гонять одну короткую игру с большим XP (или вызывать
-- сервер напрямую: 15 × 40 = 600 XP в день). Теперь XP дают первые game_family побед в день в каждой игре и не больше
-- game_day XP за все игры — разные игры выгоднее одной.
-- Игра = ключ без сложности и режима: horde_duel → horde, pauk4 → pauk, miner_duel → miner, 2048 → 2048, unity → unity
create or replace function public.game_family(p_key text) returns text language sql immutable as $$
  select coalesce(nullif(regexp_replace(split_part(coalesce(p_key, ''), '_', 1), '[0-9]+$', ''), ''), split_part(coalesce(p_key, ''), '_', 1))
$$;

-- Начислить XP за победу (ref — «ключ:номер партии»). o_cap — почему без XP: 'game' (в этой игре на сегодня всё) | 'day'
create or replace function public.game_xp_award(p_uid uuid, p_key text, p_ref text, p_amount int, out o_xp int, out o_cap text)
language plpgsql security definer set search_path = public as $$
declare fam text := public.game_family(p_key); n int; tot int;
begin
  o_xp := 0; o_cap := null;
  if p_uid is null or coalesce(p_amount, 0) <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtext('game_xp:' || p_uid::text));   -- две партии разом не обойдут лимит
  select count(*) filter (where public.game_family(split_part(x.ref, ':', 1)) = fam), coalesce(sum(x.amount), 0)
    into n, tot from public.xp_ledger x where x.user_id = p_uid and x.source = 'game' and x.day = current_date;
  if n >= public.xp_rule('game_family') then o_cap := 'game'; return; end if;
  if tot >= public.xp_rule('game_day') then o_cap := 'day'; return; end if;
  o_xp := public.xp_award(p_uid, 'game', p_ref, least(p_amount, public.xp_rule('game_day') - tot));
end $$;
revoke execute on function public.game_xp_award(uuid, text, text, int) from public, anon, authenticated;

-- Итог партии (как в games.sql; XP — через game_xp_award; xp_cap — подсказка игроку, почему без XP)
create or replace function public.game_result(p_game text, p_win boolean, p_score int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cap int := public.game_score_cap(p_game);
  s int;
  st public.game_stats%rowtype;
  got int := 0;
  why text;
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
      select a.o_xp, a.o_cap into got, why from public.game_xp_award(uid, p_game, p_game || ':' || st.plays, public.game_win_xp(p_game)) a;
    exception when others then got := 0; why := null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'xp', coalesce(got, 0), 'xp_cap', why, 'plays', st.plays, 'wins', st.wins,
                            'best', st.best_score, 'record', s >= st.best_score and s > 0);
end; $$;
grant execute on function public.game_result(text, boolean, int) to authenticated;

-- ═══ 4. Unity-игры: XP и монеты раунда — по общим правилам (раньше свои 10 XP / 15 наград и 1500 🪙 в день) ═══
-- Игра просит до 50 🪙 за раунд (так в SDK — менять его у авторов нельзя), сайт даёт половину, но не больше
-- coin_rule('unity_round'); в общем дневном лимите забегов coin_rule('run_day'), не чаще раза в run_gap секунд.
do $do$ begin
  if to_regclass('public.unity_games') is not null and to_regclass('public.unity_scores') is not null then
    execute $f$
create or replace function public.unity_result(p_id text, p_score int, p_win boolean, p_coins int, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $b$
declare
  uid uuid := auth.uid(); g public.unity_games%rowtype; sc public.unity_scores%rowtype;
  s int := least(greatest(coalesce(p_score, 0), 0), 1000000000); w boolean := coalesce(p_win, false);
  old_best int; own boolean; got_xp int := 0; got_coins int := 0; bal int; amt int; today int; cref text; c_reason text;
  v_day int := 600; v_gap int := 20; v_round int := 25;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select * into g from public.unity_games where id = p_id;
  if not found or not (g.status in ('link', 'review', 'public') or (g.author = uid and g.status <> 'banned')) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if exists (select 1 from public.unity_scores where user_id = uid and updated_at > now() - interval '10 seconds') then
    return jsonb_build_object('ok', false, 'reason', 'too_fast');
  end if;
  own := g.author = uid;
  select best into old_best from public.unity_scores where game_id = g.id and user_id = uid for update;
  insert into public.unity_scores as x (game_id, user_id, best, plays, wins, updated_at)
    values (g.id, uid, s, 1, case when w then 1 else 0 end, now())
  on conflict (game_id, user_id) do update set best = greatest(x.best, excluded.best), plays = x.plays + 1,
    wins = x.wins + excluded.wins, updated_at = now()
  returning * into sc;

  if not own then
    -- общая статистика сайта: один ключ 'unity' на все Unity-игры (профиль, «Задание дня», монеты за победу — триггер coins.sql)
    if to_regclass('public.game_stats') is not null then
      insert into public.game_stats as gs (user_id, game, plays, wins, best_score, last_at)
        values (uid, 'unity', 1, case when w then 1 else 0 end, least(s, 1000000), now())
      on conflict (user_id, game) do update set plays = gs.plays + 1, wins = gs.wins + excluded.wins,
        best_score = greatest(gs.best_score, excluded.best_score), last_at = now();
    end if;
    if to_regclass('public.game_log') is not null then
      insert into public.game_log (user_id, game, win, score) values (uid, 'unity', w, least(s, 1000000));
      delete from public.game_log where user_id = uid and day < (now() at time zone 'Europe/Moscow')::date - 14;
    end if;
    -- XP за победу: все Unity-игры — одна «игра» (game_family 'unity'), в общем дневном лимите игр
    if w then
      begin
        select a.o_xp into got_xp from public.game_xp_award(uid, 'unity', 'unity:' || g.id || ':' || sc.plays, public.xp_rule('unity_win')) a;
      exception when others then got_xp := 0;
      end;
    end if;
    if to_regprocedure('public.coin_rule(text)') is not null then
      v_day := public.coin_rule('run_day'); v_gap := public.coin_rule('run_gap'); v_round := public.coin_rule('unity_round');
    end if;
    amt := least((least(greatest(coalesce(p_coins, 0), 0), 50) + 1) / 2, v_round);
    if amt > 0 then
      if to_regprocedure('public.coin_add(uuid,integer,text,text)') is null or to_regclass('public.coin_log') is null then
        c_reason := 'no_coins';
      elsif coalesce(p_ref, '') !~ '^[A-Za-z0-9_-]{4,24}$' then
        c_reason := 'ref';
      else
        cref := 'u:' || g.id || ':' || p_ref;
        if exists (select 1 from public.coin_log where user_id = uid and source = 'run' and created_at > now() - make_interval(secs => v_gap)) then
          c_reason := 'too_fast';
        elsif exists (select 1 from public.coin_log where user_id = uid and source = 'run' and ref = cref) then
          c_reason := 'dup';
        else
          select coalesce(sum(amount), 0) into today from public.coin_log
            where user_id = uid and source = 'run' and day = (now() at time zone 'Europe/Moscow')::date;
          amt := least(amt, greatest(0, v_day - today));
          if amt = 0 then
            c_reason := 'day_cap';
          else
            begin
              bal := public.coin_add(uid, amt, 'run', cref);
              got_coins := amt;
              if to_regprocedure('public.has_perks(uuid)') is not null and coalesce(public.has_perks(uid), false) then
                bal := public.coin_add(uid, amt, 'vip', cref);
                got_coins := amt * 2;
              end if;
            exception when unique_violation then c_reason := 'dup'; got_coins := 0; bal := null;
            end;
          end if;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'xp', got_xp, 'coins', got_coins, 'coins_reason', c_reason, 'balance', bal,
    'best', sc.best, 'plays', sc.plays, 'wins', sc.wins, 'record', s > 0 and s > coalesce(old_best, 0), 'own', own);
end $b$
    $f$;
    execute 'grant execute on function public.unity_result(text, int, boolean, int, text) to authenticated';
  end if;
end $do$;

-- ═══ 5. Лестница уровней ═══
-- lv — уровень; text — что открылось (для уведомления); friends — новый лимит друзей (как friend_limit); coins — монеты один раз;
-- vip — VIP на столько дней (Bronze, прибавляется после текущего VIP); fx — эффект ника (nick_fx); badge — значок-титул
-- (ачивка level_N в my_achievements); part — вещь персонажа «за уровень» (avatar.js PARTS, coin_level_item в coins.sql).
-- Рамки аватара (5 неон, 15 золото, 30 радуга, 50 пламя, 100 бриллиант) — только CSS (FRAME_LEVELS в xp.js).
-- Клиент — LEVEL_REWARDS в js/features/xp.js (scripts/economy-test.cjs сверяет числа).
create or replace function public.level_ladder() returns jsonb language sql immutable as $$
  select '[
    {"lv":5,"friends":15,"text":"Неоновая рамка аватара и заявки в друзья"},
    {"lv":10,"part":"trail:leaves","text":"Титул из твоих ачивок рядом с ником (выбери в профиле) и след «Листопад» в гардеробе"},
    {"lv":15,"friends":20,"coins":100,"text":"Золотая рамка аватара"},
    {"lv":20,"friends":25,"badge":"level_20","part":"pet:owl","text":"Питомец «Совёнок» в гардеробе и значок «Бывалый»"},
    {"lv":25,"friends":30,"coins":150,"text":""},
    {"lv":30,"friends":35,"vip":3,"text":"Радужная рамка аватара"},
    {"lv":35,"friends":40,"part":"item:medal","text":"Медаль в руку — в гардеробе"},
    {"lv":40,"friends":45,"fx":"gold","badge":"level_40","text":"Золотой ник и значок «Мастер»"},
    {"lv":45,"coins":300,"part":"trail:snow","text":"След «Снежинки» в гардеробе"},
    {"lv":50,"vip":7,"text":"Огненная рамка аватара"},
    {"lv":55,"coins":400,"part":"pet:wolf","text":"Питомец «Волчонок» в гардеробе"},
    {"lv":60,"fx":"rainbow","text":"Радужный ник — навсегда"},
    {"lv":65,"coins":500,"part":"item:orb","text":"«Хрустальный шар» в руку — в гардеробе"},
    {"lv":70,"part":"trail:comet","text":"След «Кометы» в гардеробе"},
    {"lv":75,"coins":700,"badge":"level_75","text":"Значок «Живая легенда»"},
    {"lv":80,"part":"pet:eagle","text":"Питомец «Орёл» в гардеробе"},
    {"lv":90,"coins":1000,"part":"trail:galaxy","text":"След «Галактика» в гардеробе"},
    {"lv":100,"vip":30,"badge":"level_100","text":"Бриллиантовая рамка аватара и значок «Бессмертный»"}
  ]'::jsonb
$$;
grant execute on function public.level_ladder() to anon, authenticated;

-- «VIP на 3 дня», «VIP на неделю», «VIP на месяц», «VIP на 3 мес.», «VIP на год»
create or replace function public.vip_days_label(p_days int) returns text language sql immutable as $$
  select case
    when p_days >= 360 then 'VIP на год'
    when p_days between 28 and 31 then 'VIP на месяц'
    when p_days >= 60 and p_days % 30 = 0 then 'VIP на ' || (p_days / 30) || ' мес.'
    when p_days = 7 then 'VIP на неделю'
    when p_days % 10 = 1 and p_days % 100 <> 11 then 'VIP на ' || p_days || ' день'
    when p_days % 10 between 2 and 4 and p_days % 100 not between 12 and 14 then 'VIP на ' || p_days || ' дня'
    else 'VIP на ' || p_days || ' дней' end
$$;

-- VIP за уровень (как в progression.sql; подпись — по сроку: «VIP на 3 дня»)
create or replace function public.grant_level_vip(p_uid uuid, p_level int, p_tier text, p_period interval)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_start timestamptz;
  v_donated_until timestamptz;
  v_label text := public.vip_days_label(round(extract(epoch from p_period) / 86400)::int)
    || case p_tier when 'gold' then ' (Gold)' when 'silver' then ' (Silver)' else '' end;
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

-- Монеты за уровень — один раз (страховка от гонки: уникальный ключ)
do $do$ begin
  if to_regclass('public.coin_log') is not null then
    create unique index if not exists uq_coin_log_level on public.coin_log (user_id, ref) where source = 'level';
  end if;
end $do$;

-- Награды при уровне: VIP (пробный), монеты — за все пройденные пороги (идемпотентно); уведомление — только при переходе.
-- Зовёт sync_level (progression.sql) после каждого начисления XP и claim_achievements.
create or replace function public.check_level_rewards(p_uid uuid, p_from int default 0)
returns void language plpgsql security definer set search_path = public as $$
declare
  lv int := public.user_level(p_uid);
  e jsonb; t int; msg text;
  perk boolean := public.is_staff_user(p_uid) or public.vip_tier_of(p_uid) is not null;
begin
  for e in select x from jsonb_array_elements(public.level_ladder()) x order by (x->>'lv')::int loop
    t := (e->>'lv')::int;
    exit when t > lv;
    if e ? 'vip' then
      perform public.grant_level_vip(p_uid, t, 'bronze', make_interval(days => (e->>'vip')::int));
    end if;
    if e ? 'coins' and to_regclass('public.coin_log') is not null and to_regprocedure('public.coin_add(uuid,integer,text,text)') is not null then
      if not exists (select 1 from public.coin_log where user_id = p_uid and source = 'level' and ref = 'lv' || t) then
        begin
          perform public.coin_add(p_uid, (e->>'coins')::int, 'level', 'lv' || t);
        exception when others then null;
        end;
      end if;
    end if;
    -- про лимит друзей VIP и персоналу не пишем — у них он и так больше
    if p_from < t then
      msg := concat_ws(' · ', nullif(e->>'text', ''),
        case when e ? 'friends' and not perk then 'до ' || (e->>'friends') || ' друзей' end,
        case when e ? 'coins' then '+' || (e->>'coins') || ' 🪙' end);
      if coalesce(msg, '') <> '' then
        begin
          perform public.notify(p_uid, 'level_up', null, '⬆️ Уровень ' || t || '!', msg, '#/profile', 'lvl_' || t);
        exception when others then null;
        end;
      end if;
    end if;
  end loop;
end; $$;
revoke execute on function public.check_level_rewards(uuid, int) from public, anon, authenticated;

-- Лимит друзей: 15 → +5 каждые 5 уровней с 15-го до 40-го (45); VIP 50/70/100; персонал без лимита (null)
create or replace function public.friend_limit(uid uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare lv int; tier text;
begin
  if public.is_staff_user(uid) then return null; end if;
  tier := public.vip_tier_of(uid);
  if tier = 'gold' then return 100; elsif tier = 'silver' then return 70; elsif tier = 'bronze' then return 50; end if;
  lv := public.user_level(uid);
  if lv < 15 then return 15; end if;
  return least(45, 15 + 5 * (lv / 5 - 2));
end; $$;

-- ═══ 6. Ачивки (как в progression.sql + значки уровней 20/40/75) ═══
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
  g_plays int := 0; g_cities_hard int := 0; g_guess_best int := 0; g_2048 int := 0; g_ttt_hard int := 0; g_reaction int := 0;
  g_checkers_hard int := 0; g_catch int := 0;
  g_sea_hard int := 0; g_snake int := 0; g_memory int := 0; g_duel_wins int := 0;
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
  -- Игры (games.sql); пока таблицы нет — нули
  begin
    select coalesce(sum(gs.plays), 0),
           coalesce(max(gs.wins) filter (where gs.game = 'cities_hard'), 0),
           coalesce(max(gs.best_score) filter (where gs.game = 'guess'), 0),
           coalesce(max(gs.wins) filter (where gs.game = '2048'), 0),
           coalesce(max(gs.best_score) filter (where gs.game = 'ttt_hard'), 0),
           coalesce(max(gs.best_score) filter (where gs.game = 'reaction'), 0),
           coalesce(max(gs.wins) filter (where gs.game = 'checkers_hard'), 0),
           coalesce(max(gs.best_score) filter (where gs.game = 'catch'), 0),
           coalesce(max(gs.wins) filter (where gs.game = 'sea_hard'), 0),
           coalesce(max(gs.best_score) filter (where gs.game in ('snake', 'snake_duel')), 0),
           coalesce(max(gs.best_score) filter (where gs.game = 'memory'), 0),
           coalesce(sum(gs.wins) filter (where gs.game like '%\_duel' or gs.game like '%\_online'), 0)
      into g_plays, g_cities_hard, g_guess_best, g_2048, g_ttt_hard, g_reaction, g_checkers_hard, g_catch,
           g_sea_hard, g_snake, g_memory, g_duel_wins
      from public.game_stats gs where gs.user_id = uid;
  exception when others then null; end;

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
    -- игры
    ('gamer',          g_plays >= 10),
    ('cities_master',  g_cities_hard >= 1),
    ('quiz_expert',    g_guess_best >= 10),
    ('tile_2048',      g_2048 >= 1),
    ('ttt_unbeaten',   g_ttt_hard >= 1),
    ('lightning',      g_reaction >= 800),
    ('checkers_master', g_checkers_hard >= 1),
    ('big_catch',      g_catch >= 1000),
    ('admiral',        g_sea_hard >= 1),
    ('snake_charmer',  g_snake >= 30),
    ('sharp_memory',   g_memory >= 900),
    ('duelist',        g_duel_wins >= 10),
    -- уровни — значки и титулы (без XP, иначе уровень поднимал бы сам себя)
    ('level_10',       lvl >= 10),
    ('level_20',       lvl >= 20),
    ('level_30',       lvl >= 30),
    ('level_40',       lvl >= 40),
    ('level_50',       lvl >= 50),
    ('level_75',       lvl >= 75),
    ('level_100',      lvl >= 100);
end; $$;
grant execute on function public.my_achievements(uuid) to anon, authenticated;

-- XP ачивок (разово): примерно вдвое меньше; связанные с поддержкой (VIP, донат) — как были
create or replace function public.achievement_xp(p_code text)
returns int language sql immutable as $$
  select case p_code
    when 'creator' then 250 when 'role_admin' then 150 when 'role_moderator' then 100 when 'role_helper' then 75
    when 'vip_gold' then 300 when 'vip_silver' then 200 when 'vip' then 100 when 'member' then 10
    when 'week_here' then 10 when 'month_here' then 25 when 'half_year' then 75 when 'year_here' then 150
    when 'early_bird' then 25
    when 'streak_3' then 10 when 'streak_7' then 20 when 'streak_30' then 75 when 'streak_100' then 250
    when 'chatty_10' then 5 when 'chatty_100' then 25 when 'chatty_500' then 75 when 'chatty_1000' then 150
    when 'night_owl' then 15
    when 'forum_1' then 10 when 'forum_5' then 30 when 'forum_replies' then 40
    when 'idea_1' then 10 when 'idea_done' then 75 when 'teammate' then 10
    when 'friends_1' then 10 when 'friends_5' then 25 when 'friends_15' then 50
    when 'referrer_1' then 25 when 'referrer_5' then 100
    when 'watcher_10' then 15 when 'watcher_100' then 75
    when 'styled' then 15 when 'supporter' then 100
    when 'gamer' then 15 when 'cities_master' then 75 when 'quiz_expert' then 50
    when 'tile_2048' then 75 when 'ttt_unbeaten' then 25 when 'lightning' then 25
    when 'checkers_master' then 75 when 'big_catch' then 25
    when 'admiral' then 75 when 'snake_charmer' then 25 when 'sharp_memory' then 25 when 'duelist' then 50
    else 0 end;
$$;
grant execute on function public.achievement_xp(text) to anon, authenticated;

-- ═══ 7. Эффект ника: радуга — охота за секретами (30 дней) или уровень с fx 'rainbow'; золото — уровень с fx 'gold' ═══
-- Уровень — level_progress (progression.sql: последний уровень, о котором человеку сообщили; обновляется с каждым XP)
create or replace function public.nick_fx()
returns table(user_id uuid, fx text) language sql stable security definer set search_path = public as $$
  with lad as (
    select min((e->>'lv')::int) filter (where e->>'fx' = 'gold') as gold,
           min((e->>'lv')::int) filter (where e->>'fx' = 'rainbow') as rainbow
    from jsonb_array_elements(public.level_ladder()) e
  ), x as (
    select s.user_id, 2 as r from public.secret_hunt s where s.reward_until > now()
    union all
    select l.user_id, case when l.level >= lad.rainbow then 2 else 1 end
    from public.level_progress l cross join lad where l.level >= lad.gold
  )
  select x.user_id, case when max(x.r) = 2 then 'rainbow' else 'gold' end from x group by x.user_id
$$;
grant execute on function public.nick_fx() to anon, authenticated;

-- Старые версии сайта знают только радугу
create or replace function public.nick_fx_users()
returns setof uuid language sql stable security definer set search_path = public as $$
  select n.user_id from public.nick_fx() n where n.fx = 'rainbow'
$$;
grant execute on function public.nick_fx_users() to anon, authenticated;

-- ═══ 8. Дыра: серию визитов можно было подделать, вставив прошлые даты в user_visits напрямую ═══
-- (визит пишет только record_visit — security definer, ему эта политика не нужна; напрямую — только сегодня)
do $do$ begin
  if to_regclass('public.user_visits') is not null then
    drop policy if exists "Пользователь пишет свои визиты" on public.user_visits;
    create policy "Пользователь пишет свои визиты" on public.user_visits
      for insert with check (auth.uid() = user_id and visit_date = current_date);
  end if;
end $do$;

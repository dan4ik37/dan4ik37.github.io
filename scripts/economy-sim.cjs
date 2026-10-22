// Экономика наград: сколько дней игры до уровней, когда бесплатный VIP и сколько монет 🪙 в день — из НАСТОЯЩИХ цифр кода
// (SQL-функции и формулы игр), а не из головы. Сравнивает «до» (git-коммит) и «сейчас» (рабочая папка).
//   node scripts/economy-sim.cjs                 — таблицы в консоль (до = 833f6ee, состояние до 15.10.2026)
//   node scripts/economy-sim.cjs --before <ref>  — другой коммит «до»
//   node scripts/economy-sim.cjs --write         — обновить таблицы в docs/ECONOMY.md (между метками <!-- sim:… -->)
//   node scripts/economy-sim.cjs --json          — сырые числа (для тестов)
// Цифры берутся так: XP за игры — game_win_xp (games-more.sql), ачивки — achievement_xp, правила XP — xp_rule (economy.sql)
// или старые числа прямо из xp.sql / games.sql / secrets.sql, монеты — coin_rule / coin_run_cap (coins.sql), лестница уровней —
// level_ladder (economy.sql) или check_level_rewards (progression.sql), монеты игр — формулы в js/games/*.js. Не нашлась
// цифра — скрипт падает (значит, поменялся вид кода — поправь регулярку здесь).
// Профили игроков (сколько играет, что выигрывает) — ПРЕДПОЛОЖЕНИЯ, они ниже в PROFILES; меняй их, а не результат.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const BEFORE = args.includes('--before') ? args[args.indexOf('--before') + 1] : '833f6ee';

// ── Чтение файлов: рабочая папка или git-коммит ──
function src(file, ref){
  if (!ref) { const p = path.join(ROOT, file); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  try { return cp.execFileSync('git', ['show', `${ref}:${file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
  catch (e) { return null; }
}
const need = (v, what) => { if (v == null || (typeof v === 'number' && !Number.isFinite(v))) throw new Error('не нашёл: ' + what); return v; };
const num = (text, re, what) => { const m = re.exec(text || ''); return +need(m && m[1], what); };
// Тело SQL-функции public.<name>(…) … $$;
function fnBody(sql, name){
  const a = (sql || '').indexOf(`function public.${name}(`);
  if (a < 0) return null;
  const b = sql.indexOf('$$;', sql.indexOf('$$', a) + 2);
  return sql.slice(a, b + 3);
}
// Пары when 'ключ' then число
function casePairs(body){
  const out = {};
  for (const m of (body || '').matchAll(/when '([^']+)' then (\d+)/g)) out[m[1]] = +m[2];
  return out;
}

// ── Цифры одного состояния кода ──
function rules(ref){
  const f = name => src(name, ref);
  const xpSql = need(f('xp.sql'), 'xp.sql'), gamesSql = need(f('games.sql'), 'games.sql'), moreSql = need(f('games-more.sql'), 'games-more.sql');
  const progSql = need(f('progression.sql'), 'progression.sql'), coinsSql = need(f('coins.sql'), 'coins.sql'), secretsSql = need(f('secrets.sql'), 'secrets.sql');
  const ecoSql = f('economy.sql');
  const R = { ref: ref || 'сейчас', eco: !!(ecoSql && fnBody(ecoSql, 'xp_rule')) };
  R.div = num(xpSql, /floor\(sqrt\(greatest\(coalesce\(p_xp, 0\), 0\) \/ (\d+)\.0\)\)::int \+ 1/, 'формула уровня (xp_level)');
  R.gameXp = casePairs(fnBody(moreSql, 'game_win_xp'));
  need(R.gameXp.horde, 'game_win_xp(horde)');
  // XP-правила
  if (R.eco) {
    const x = casePairs(fnBody(ecoSql, 'xp_rule'));
    for (const k of ['visit', 'streak7', 'streak30', 'chat', 'chat_day', 'forum_thread', 'forum_thread_day', 'forum_post', 'forum_post_day', 'idea', 'idea_day', 'idea_done', 'referral', 'watch', 'watch_day', 'daily', 'secret', 'game_family', 'game_day', 'unity_win']) need(x[k], 'xp_rule ' + k);
    R.xp = { ...x, game_count: Infinity };
    R.ach = casePairs(fnBody(ecoSql, 'achievement_xp'));
    const lad = /function public\.level_ladder\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/.exec(ecoSql);
    R.ladder = JSON.parse(need(lad && lad[1], 'level_ladder'));
  } else {
    R.xp = {
      visit: num(xpSql, /'visit', '', (\d+)\)/, 'visit'), streak7: num(xpSql, /'streak', '7', (\d+)\)/, 'streak 7'), streak30: num(xpSql, /'streak', '30', (\d+)\)/, 'streak 30'),
      chat: num(xpSql, /'chat', new\.id::text, (\d+), \d+\)/, 'chat'), chat_day: num(xpSql, /'chat', new\.id::text, \d+, (\d+)\)/, 'chat cap'),
      forum_thread: num(xpSql, /'forum_thread', new\.id::text, (\d+), \d+\)/, 'thread'), forum_thread_day: num(xpSql, /'forum_thread', new\.id::text, \d+, (\d+)\)/, 'thread cap'),
      forum_post: num(xpSql, /'forum_post', new\.id::text, (\d+), \d+\)/, 'post'), forum_post_day: num(xpSql, /'forum_post', new\.id::text, \d+, (\d+)\)/, 'post cap'),
      idea: num(xpSql, /'idea', new\.id::text, (\d+)\)/, 'idea'), idea_day: Infinity, idea_done: num(xpSql, /'idea_done', new\.id::text, (\d+)\)/, 'idea_done'),
      referral: num(xpSql, /'referral', new\.id::text, (\d+)\)/, 'referral'),
      watch: num(xpSql, /'watch', p_video_id, (\d+), \d+\)/, 'watch'), watch_day: num(xpSql, /'watch', p_video_id, \d+, (\d+)\)/, 'watch cap'),
      daily: num(gamesSql, /'daily', d::text, (\d+)\)/, 'daily quest'), secret: num(secretsSql, /'secret', 'hunt', (\d+)\)/, 'secret'),
      game_family: Infinity, game_day: Infinity, game_count: num(gamesSql, /public\.game_win_xp\(p_game\), (\d+)\)/, 'game cap'),
      unity_win: num(src('unity.sql', ref), /'unity:' \|\| g\.id \|\| ':' \|\| sc\.plays, (\d+), \d+\)/, 'unity win'),
    };
    R.ach = casePairs(fnBody(progSql, 'achievement_xp'));
    R.ladder = [];
    const per = { month: 30, months: 30, year: 365, years: 365, day: 1, days: 1 };
    for (const m of fnBody(progSql, 'check_level_rewards').matchAll(/if lv >= (\d+) then perform public\.grant_level_vip\(p_uid, \d+, '(\w+)', interval '(\d+) (\w+)'\)/g))
      R.ladder.push({ lv: +m[1], vip: +m[3] * per[m[4]], tier: m[2] });
  }
  need(R.ach.creator, 'achievement_xp');
  // Монеты
  R.runCap = casePairs(fnBody(coinsSql, 'coin_run_cap'));
  need(R.runCap.horde, 'coin_run_cap');
  const cr = casePairs(fnBody(coinsSql, 'coin_rule'));
  if (cr.daily != null) R.coin = cr;
  else {
    const ad = fnBody(coinsSql, 'coins_ad');
    R.coin = {
      daily: num(fnBody(coinsSql, 'coins_daily'), /got int := (\d+);/, 'coins_daily'),
      quest: num(coinsSql, /coin_add\(new\.user_id, (\d+), 'quest'/, 'quest coins'),
      win: num(coinsSql, /coin_add\(new\.user_id, (\d+), 'win'/, 'win coins'), win_day: num(coinsSql, /and day = public\.coin_today\(\)\) < (\d+) then/, 'win cap'),
      ad: num(ad, /coin_add\(uid, (\d+), 'ad'/, 'ad'), ad_day: num(ad, /if n >= (\d+) then/, 'ad cap'),
      double_day: num(ad.slice(ad.indexOf("p_kind = 'double'")), /if n >= (\d+) then/, 'double cap'),
      run_day: num(fnBody(coinsSql, 'coins_run'), /greatest\(0, (\d+) - today\)/, 'run day'),
      import: num(fnBody(coinsSql, 'coins_import'), /least\(greatest\(coalesce\(p_amount, 0\), 0\), (\d+)\)/, 'import'),
      revive: num(fnBody(coinsSql, 'coin_price'), /p_item = 'revive' then (\d+)/, 'revive'),
    };
  }
  // Монеты в играх — формулы из js/games/*.js (вид кода «до» и «после» одинаковый)
  const g = name => need(f('js/games/' + name), name);
  const horde = g('horde.js');
  const fin = /const coins = Math\.round\(G\.coins \* p\.greed\) \+ Math\.floor\(G\.t \/ 60\) \* (\d+) \+ \(G\.won \? (\d+) : 0\);/.exec(horde);
  R.horde = {
    perMin: +need(fin && fin[1], 'horde finish'), win: +fin[2],
    boss: num(horde, /item\(G, 'coin', e\.x \+ \(G\.rd\(\) - \.5\) \* 90, e\.y \+ \(G\.rd\(\) - \.5\) \* 90, (\d+)\)/, 'horde boss coin'),
    elite: num(horde, /item\(G, 'coin', e\.x \+ 22, e\.y, (\d+)\)/, 'horde elite coin'),
    chest: num(horde, /function chest\(G, p\)\{\s*G\.coins \+= (\d+);/, 'horde chest coins'),
  };
  const td = /const coins = S\.wave \* (\d+) \+ \(won \? (\d+) : 0\);/.exec(g('td.js'));
  R.td = { perWave: +need(td && td[1], 'td coins'), win: +td[2] };
  const bl = /COIN_DIV = (\d+), COIN_MAX = (\d+)/.exec(g('blocks.js'));
  R.blocks = { div: +need(bl && bl[1], 'blocks coins'), max: +bl[2] };
  const so = /S\.kind === 'k' \? \(S\.draw === 3 \? (\d+) : (\d+)\) : S\.kind === 'f' \? (\d+) : \(\{ 1: (\d+), 2: (\d+), 4: (\d+) \}\)/.exec(g('solitaire.js'));
  need(so, 'solitaire coinsFor');
  R.sol = { kosynka3: +so[1], kosynka: +so[2], freecell: +so[3], pauk1: +so[4], pauk2: +so[5], pauk4: +so[6] };
  const mi = g('miner.js');
  R.miner = [...mi.matchAll(/name: '[^']+', base: \d+, ref: \d+, coins: (\d+)/g)].map(m => +m[1]);
  need(R.miner.length === 3 || null, 'miner coins');
  const mj = /const coins = Math\.min\((\d+), (\d+) \+ (?:(\d+) \* )?G\.n\)/.exec(g('mahjong.js'));
  R.mahjong = { max: +need(mj && mj[1], 'mahjong coins'), base: +mj[2], k: +(mj[3] || 1) };
  const sd = g('sudoku.js');
  R.sudoku = [...sd.matchAll(/base: \d+, ref: \d+, coins: (\d+)/g)].map(m => +m[1]);
  R.sudokuDaily = num(sd, /coins = daily \? (\d+) :/, 'sudoku daily');
  need(R.sudoku.length === 4 || null, 'sudoku coins');
  // Задания недели, сезонный путь, новогоднее задание (games-more.sql quest_rule / season_ladder; 22.10.2026). Нет — «до» (0)
  const qr = casePairs(fnBody(moreSql, 'quest_rule'));
  if (qr.w_xp != null) {
    for (const k of ['w_xp', 'w_coins', 'w_pts', 's_win', 's_win_day', 's_daily', 's_lv', 's_levels', 's_months', 'a_coins', 'a_xp', 'a_small', 'a_big', 'a_big_coins']) need(qr[k], 'quest_rule ' + k);
    const sl = /function public\.season_ladder\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/.exec(moreSql);
    R.quest = { ...qr, ladder: JSON.parse(need(sl && sl[1], 'season_ladder')) };
  } else R.quest = null;
  return R;
}
// Сезонный путь, задания недели, новогоднее задание за день (в среднем): XP, монеты, ⭐ и уровень сезона за его длину
function questDay(R, P){
  const Q = R.quest;
  if (!Q || P.noQuests) return { xp: 0, coins: 0, pts: 0, lv: 0, weekly: 0 };
  const weekly = P.max ? 6 : (P.weekly || 0);
  const wins = P.max ? Q.s_win_day : Object.values(P.wins).reduce((a, b) => a + b, 0);
  const pts = Q.s_win * Math.min(wins, Q.s_win_day) + Q.s_daily * (P.quest || 0) + Q.w_pts * weekly / 7;
  const len = 30.4 * Q.s_months, lv = Math.min(Math.floor(pts * len / Q.s_lv), Q.s_levels);
  const seasonCoins = Q.ladder.filter(e => e.lv <= lv).reduce((a, e) => a + (e.coins || 0), 0);
  const A = P.max ? { days: 31, full: 1 } : (P.advent || { days: 0, full: 0 });
  const advCoins = A.days * (A.full * Q.a_coins + (1 - A.full) * Q.a_small) + (A.days >= Q.a_big ? Q.a_big_coins : 0);
  return {
    xp: Q.w_xp * weekly / 7 + Q.a_xp * A.days * A.full / 365,
    coins: Q.w_coins * weekly / 7 + seasonCoins / len + advCoins / 365,
    pts, lv, weekly,
  };
}

// ── Профили игроков (ПРЕДПОЛОЖЕНИЯ) ──
// wins — победы в день по ключам сервера (дробь = «в среднем»), runs — забеги с монетами, quest — доля дней с заданием дня,
// watch / chat / posts / threads / ideas — в день; ach — ачивки: код → день, когда получена. Каждый день заходит (серия идёт).
// weekly — сколько заданий недели из 6 делает за неделю; advent — новогоднее задание: дней с наградой и доля, которую сервер проверил.
const PROFILES = [
  { id: 'casual', name: 'Обычный (30–45 мин в день)', quest: .8, watch: 1, chat: 3, posts: 0, threads: 0, ideas: 0, ads: 0, weekly: 3, advent: { days: 18, full: .7 },
    wins: { words: .8, kosynka: 1, ttt_normal: 1, checkers_normal: 1, memory: 1, blocks: 1, sudoku2: .5 },
    runs: [['horde', 2, { min: 5.5, drops: 10, elites: 1, boss: .2, won: 0 }], ['blocks', 1, { score: 2200 }], ['kosynka', 1], ['sudoku', .5, { lv: 2 }]],
    ach: { member: 0, early_bird: 0, gamer: 2, streak_3: 3, chatty_10: 4, week_here: 7, streak_7: 7, watcher_10: 10, friends_1: 10, sharp_memory: 15, styled: 20,
      month_here: 30, streak_30: 30, chatty_100: 34, friends_5: 60, streak_100: 100, watcher_100: 100, half_year: 180, year_here: 365 } },
  { id: 'active', name: 'Активный (1–1,5 ч в день)', quest: 1, watch: 3, chat: 10, posts: 1, threads: 0, ideas: 0, ads: 0, weekly: 5, advent: { days: 27, full: .85 },
    wins: { words: .9, sudoku_daily: .8, chess_normal: 2, sea_normal: 2, checkers_hard: .5, kosynka: 2, pauk2: 1, miner2: 2, mahjong: 3, blocks: 1,
      td: .15, horde: .1, uno: 1, durak: 1, ttt_normal: 2 },
    runs: [['horde', 3, { min: 6, drops: 15, elites: 1.5, boss: .35, won: .1 }], ['td', 1, { waves: 14, won: .15 }], ['blocks', 1, { score: 3000 }],
      ['kosynka', 2], ['pauk', 1, { suits: 2 }], ['miner', 2, { lv: 2 }], ['mahjong', 3, { n: 4 }], ['sudoku', .8, { daily: 1 }]],
    ach: { member: 0, early_bird: 0, gamer: 1, chatty_10: 1, forum_1: 3, streak_3: 3, watcher_10: 4, sharp_memory: 5, week_here: 7, streak_7: 7, chatty_100: 10,
      idea_1: 10, ttt_unbeaten: 10, friends_1: 5, teammate: 14, big_catch: 20, friends_5: 20, forum_replies: 25, month_here: 30, streak_30: 30, checkers_master: 30,
      quiz_expert: 30, lightning: 30, snake_charmer: 30, watcher_100: 34, tile_2048: 40, duelist: 40, chatty_500: 50, admiral: 60, referrer_1: 60, styled: 7,
      friends_15: 90, chatty_1000: 100, streak_100: 100, half_year: 180, year_here: 365 } },
  { id: 'max', name: 'Потолок (все лимиты сервера каждый день)', max: true, quest: 1, ads: 1,
    ach: { member: 0, early_bird: 0, gamer: 1, chatty_10: 1, forum_1: 1, forum_5: 2, forum_replies: 3, idea_1: 1, teammate: 1, watcher_10: 1, styled: 1,
      streak_3: 3, friends_1: 5, week_here: 7, streak_7: 7, chatty_100: 7, watcher_100: 10, friends_5: 10, referrer_1: 10, cities_master: 14, quiz_expert: 14,
      tile_2048: 14, ttt_unbeaten: 14, lightning: 14, checkers_master: 14, big_catch: 14, admiral: 14, snake_charmer: 14, sharp_memory: 14, duelist: 14,
      month_here: 30, streak_30: 30, idea_done: 30, friends_15: 30, referrer_5: 30, chatty_500: 34, chatty_1000: 67, streak_100: 100, half_year: 180, year_here: 365 } },
];

// Монеты одного забега/партии по формулам игры (до потолка coin_run_cap)
function runCoins(R, game, o = {}){
  let c;
  if (game === 'horde') c = Math.round(o.drops + o.elites * (R.horde.elite + R.horde.chest) + o.boss * (6 * R.horde.boss + R.horde.chest)) + Math.floor(o.min) * R.horde.perMin + o.won * R.horde.win;
  else if (game === 'td') c = o.waves * R.td.perWave + o.won * R.td.win;
  else if (game === 'blocks') c = Math.min(R.blocks.max, Math.floor(o.score / R.blocks.div));
  else if (game === 'kosynka') c = R.sol.kosynka;
  else if (game === 'pauk') c = R.sol['pauk' + (o.suits || 1)];
  else if (game === 'freecell') c = R.sol.freecell;
  else if (game === 'miner') c = R.miner[(o.lv || 1) - 1];
  else if (game === 'mahjong') c = Math.min(R.mahjong.max, R.mahjong.base + R.mahjong.k * (o.n || 1));
  else if (game === 'sudoku') c = o.daily ? R.sudokuDaily : R.sudoku[(o.lv || 1) - 1];
  else throw new Error('нет формулы монет: ' + game);
  return Math.min(c, R.runCap[game] ?? 0);
}

const family = k => { const a = String(k).split('_')[0], b = a.replace(/[0-9]+$/, ''); return b || a; };
// XP за игры за день: победы по ключам → с лимитами (до: число наград в день; после: на одну игру и XP в день)
function gameXpDay(R, wins){
  const list = [];
  for (const [k, n] of Object.entries(wins)) for (let i = 0; i < n; i++) list.push([k, Math.min(1, n - i)]);
  let got = 0, count = 0;
  const fam = {};
  for (const [k, w] of list) {
    const x = R.gameXp[k] || 0;
    if (!x) continue;
    if (count + w > R.xp.game_count) break;
    const f = family(k);
    if ((fam[f] || 0) + w > R.xp.game_family + 1e-9) continue;
    const add = Math.min(x * w, R.xp.game_day - got);
    if (add <= 0) break;
    got += add; count += w; fam[f] = (fam[f] || 0) + w;
  }
  return got;
}
// Потолок XP за игры в день (вызывая сервер напрямую): лучшие ключи, с лимитами
function gameXpMax(R){
  const keys = Object.entries(R.gameXp).filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]);
  let got = 0, count = 0;
  const fam = {};
  for (const [k, x] of keys) {
    const f = family(k);
    while (count < R.xp.game_count && (fam[f] || 0) < R.xp.game_family && got < R.xp.game_day) {
      got += Math.min(x, R.xp.game_day - got); count++; fam[f] = (fam[f] || 0) + 1;
      if (!Number.isFinite(R.xp.game_family) && !Number.isFinite(R.xp.game_day) && count >= R.xp.game_count) break;
    }
    if (count >= R.xp.game_count || got >= R.xp.game_day) break;
  }
  return got;
}

function dayXp(R, P){
  const X = R.xp, Q = questDay(R, P).xp;
  if (P.max) {
    return X.visit + X.daily + gameXpMax(R) + X.watch * X.watch_day + X.chat * X.chat_day + X.forum_thread * X.forum_thread_day
      + X.forum_post * X.forum_post_day + X.idea * Math.min(X.idea_day, 3) + Q;
  }
  return X.visit + X.daily * P.quest + gameXpDay(R, P.wins) + X.watch * Math.min(P.watch, X.watch_day) + X.chat * Math.min(P.chat, X.chat_day)
    + X.forum_post * Math.min(P.posts, X.forum_post_day) + X.forum_thread * Math.min(P.threads, X.forum_thread_day) + X.idea * Math.min(P.ideas, X.idea_day) + Q;
}
function dayCoins(R, P){
  const C = R.coin, Q = questDay(R, P).coins;
  if (P.max) {
    const best = Object.values(R.runCap).sort((a, b) => b - a);
    return C.daily + C.quest + C.win * C.win_day + C.run_day + C.ad * C.ad_day + best[0] * C.double_day + Q;
  }
  const wins = Object.values(P.wins).reduce((a, b) => a + b, 0);
  let runs = 0;
  for (const [game, n, o] of P.runs) runs += n * runCoins(R, game, o);
  return C.daily + C.quest * P.quest + C.win * Math.min(wins, C.win_day) + Math.min(runs, C.run_day) + C.ad * Math.min(P.ads || 0, C.ad_day) + Q;
}

const xpFor = (R, L) => R.div * (L - 1) * (L - 1);
function simulate(R, P, days = 6000){
  const perDay = dayXp(R, P), achDays = Object.entries(P.ach).map(([c, d]) => [d, R.ach[c] || 0]);
  const streak = [[7, R.xp.streak7], [30, R.xp.streak30]];
  const levels = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  const at = {};
  let xp = 0;
  for (let d = 1; d <= days; d++) {
    xp += perDay;
    for (const [dd, v] of achDays) if (dd === d - 1) xp += v;
    for (const [dd, v] of streak) if (dd === d) xp += v;
    for (const L of levels) if (at[L] == null && xp >= xpFor(R, L)) at[L] = d;
  }
  // бесплатный VIP: первый и «месяц и больше»
  const vip = R.ladder.filter(x => x.vip).map(x => ({ lv: x.lv, days: x.vip, tier: x.tier || 'bronze', day: null }));
  xp = 0;
  for (let d = 1; d <= days && vip.some(v => v.day == null); d++) {
    xp += perDay;
    for (const [dd, v] of achDays) if (dd === d - 1) xp += v;
    for (const [dd, v] of streak) if (dd === d) xp += v;
    for (const v of vip) if (v.day == null && xp >= xpFor(R, v.lv)) v.day = d;
  }
  return { perDay: Math.round(perDay), coins: Math.round(dayCoins(R, P)), at, vip };
}

// ── Отчёт ──
const fmtDays = d => d == null ? 'больше 16 лет' : d < 60 ? `${d} дн.` : d < 730 ? `${Math.round(d / 30.4)} мес.` : `${(d / 365).toFixed(1).replace('.', ',')} г.`;
const vipName = v => `${v.days >= 360 ? 'год' : v.days >= 90 ? (v.days / 30) + ' мес.' : v.days >= 28 ? 'месяц' : v.days === 7 ? 'неделя' : v.days + ' дн.'} (${v.tier === 'gold' ? 'Gold' : v.tier === 'silver' ? 'Silver' : 'Bronze'})`;
function report(){
  const A = rules(BEFORE), B = rules(null);
  const res = PROFILES.map(P => ({ P, a: simulate(A, P), b: simulate(B, P) }));
  const lines = [];
  lines.push(`Уровень L = floor(√(XP / ${B.div})) + 1 — до L нужно ${B.div}·(L−1)² XP: ` + [5, 10, 20, 30, 50, 100].map(L => `${L} — ${xpFor(B, L).toLocaleString('ru')}`).join(', ') + '.', '');
  lines.push('| Профиль | XP в день: было → стало | Монет 🪙 в день: было → стало |', '|---|---|---|');
  for (const { P, a, b } of res) lines.push(`| ${P.name} | ${a.perDay} → **${b.perDay}** | ${a.coins} → **${b.coins}** |`);
  lines.push('', '**Сколько дней игры до уровня** (было → стало):', '');
  const L = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100];
  lines.push('| Уровень | ' + res.map(r => r.P.name.split(' (')[0]).join(' | ') + ' |', '|---|' + res.map(() => '---|').join(''));
  for (const l of L) lines.push(`| ${l} | ` + res.map(r => `${fmtDays(r.a.at[l])} → **${fmtDays(r.b.at[l])}**`).join(' | ') + ' |');
  lines.push('', '**Бесплатный VIP за уровень — когда** (до → после):', '');
  for (const { P, a, b } of res) {
    lines.push(`- ${P.name}: было — ${a.vip.map(v => `ур. ${v.lv}: ${vipName(v)} через ${fmtDays(v.day)}`).join('; ') || 'нет'}; ` +
      `стало — ${b.vip.map(v => `ур. ${v.lv}: ${vipName(v)} через ${fmtDays(v.day)}`).join('; ') || 'нет'}`.replace(/\.?$/, '.'));
  }
  const typ = res.find(r => r.P.id === 'casual'), act = res.find(r => r.P.id === 'active');
  lines.push('', '**Сколько дней копить монеты** (Обычный / Активный; было → стало):', '');
  for (const [price, what] of [[300, 'питомец или след (300 🪙)'], [800, 'корона (800 🪙)'], [2500, 'герой «Денчик» (2500 🪙)'], [13350, 'все улучшения «Орды» (13 350 🪙)'], [1200, 'обмен 100 💎 = 1200 🪙 (100 ₽) — столько дней игры']]) {
    const d = (r, k) => Math.ceil(price / Math.max(1, r[k].coins));
    lines.push(`- ${what}: ${d(typ, 'a')} → **${d(typ, 'b')}** / ${d(act, 'a')} → **${d(act, 'b')}** дн.`);
  }
  // Задания недели, сезонный путь, новогоднее задание (22.10.2026): «стало» выше — уже с ними; здесь — сколько они добавили
  if (B.quest) {
    for (const r of res) r.n = simulate(B, { ...r.P, noQuests: true });
    lines.push('', '**Задания недели, сезонный путь и новогоднее задание** (22.10.2026; без них → с ними):', '');
    lines.push('| Профиль | Заданий недели | ⭐ в день → уровень сезона за месяц | XP в день | Монет 🪙 в день | До 10 ур. | До 30 ур. | До 50 ур. |', '|---|---|---|---|---|---|---|---|');
    for (const r of res) {
      const q = questDay(B, r.P);
      lines.push(`| ${r.P.name.split(' (')[0]} | ${q.weekly} из 6 | ${Math.round(q.pts)} → ${q.lv} из ${B.quest.s_levels} | ${r.n.perDay} → **${r.b.perDay}** | ${r.n.coins} → **${r.b.coins}** | ${fmtDays(r.n.at[10])} → **${fmtDays(r.b.at[10])}** | ${fmtDays(r.n.at[30])} → **${fmtDays(r.b.at[30])}** | ${fmtDays(r.n.at[50])} → **${fmtDays(r.b.at[50])}** |`);
    }
  }
  return { text: lines.join('\n'), A, B, res };
}

const out = report();
if (args.includes('--json')) {
  console.log(JSON.stringify({ before: out.res.map(r => ({ id: r.P.id, ...r.a })), now: out.res.map(r => ({ id: r.P.id, ...r.b })),
    noquests: out.res.filter(r => r.n).map(r => ({ id: r.P.id, ...r.n })), quests: out.res.map(r => ({ id: r.P.id, ...questDay(out.B, r.P) })) }, null, 1));
}
else console.log(out.text);
if (args.includes('--write')) {
  const doc = path.join(ROOT, 'docs/ECONOMY.md');
  const md = fs.readFileSync(doc, 'utf8');
  const a = md.indexOf('<!-- sim:start -->'), b = md.indexOf('<!-- sim:end -->');
  if (a < 0 || b < 0) throw new Error('в docs/ECONOMY.md нет меток <!-- sim:start --> / <!-- sim:end -->');
  fs.writeFileSync(doc, md.slice(0, a) + '<!-- sim:start -->\n' + out.text + '\n' + md.slice(b));
  console.log('\ndocs/ECONOMY.md обновлён');
}

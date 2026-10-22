// Экономика наград: числа на клиенте = числа на сервере (без базы — сверяем тексты файлов) + цели баланса из расчёта.
//   node scripts/economy-test.cjs  (из корня сайта)
// Сервер: economy.sql (xp_rule, level_ladder, achievement_xp, my_achievements, friend_limit, unity_result), coins.sql (coin_rule,
// coin_run_cap, coin_level_item), games-more.sql (game_win_xp). Клиент: js/features/xp.js (XP_NUM, LEVEL_REWARDS),
// js/features/achievements.js (ACHIEVEMENT_DEFS), js/core/coins.js (RULES, RUN_CAP), js/core/avatar.js (PARTS — вещи «за уровень»),
// формулы монет в js/games/*.js, api/_lib/routes/vip.js (FREE), css/premium.css (эффекты ника).
// С 22.10.2026 (раздел 7): задания недели, сезонный путь, новогоднее задание — games-more.sql (quest_rule, weekly_quest_pool,
// season_ladder, season_themes, advent_task) ↔ js/features/games.js (QUEST_NUM, WEEKLY_QUESTS, SEASON_LADDER, SEASON_THEMES),
// js/core/celebrate.js (ADVENT), avatar.js (вещи-награды, 8-е поле), css/premium.css (рамки сезонов).
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const fnBody = (sql, name) => { const a = sql.indexOf(`function public.${name}(`); if (a < 0) return ''; return sql.slice(a, sql.indexOf('$$;', sql.indexOf('$$', a) + 2) + 3); };
const pairs = body => Object.fromEntries([...body.matchAll(/when '([^']+)' then (\d+)/g)].map(m => [m[1], +m[2]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const eco = read('economy.sql'), coins = read('coins.sql'), more = read('games-more.sql');
// клиентские файлы — в песочнице (глобальные const видны через выражение в конце)
function load(file, expr, ctx = {}){
  const c = vm.createContext({ window: {}, document: { getElementById: () => null, querySelectorAll: () => [], addEventListener(){}, body: { classList: { toggle(){} } } },
    localStorage: { getItem: () => null, setItem(){} }, setTimeout: () => 0, addEventListener(){}, console, ...ctx });
  c.window = c;
  vm.runInContext(read(file) + `\n;globalThis.__out = (${expr});`, c, { filename: file });
  return c.__out;
}
const X = load('js/features/xp.js', '({ XP_NUM, LEVEL_REWARDS, FRAME_LEVELS })');
const ACH = load('js/features/achievements.js', 'ACHIEVEMENT_DEFS');
const W = (() => { const c = load('js/core/coins.js', 'window.D37Coins'); return c; })();
const CH = load('js/core/avatar.js', 'window.D37Char');

// ═══ 1. XP: xp.js XP_NUM = xp_rule ═══
const xr = pairs(fnBody(eco, 'xp_rule'));
ok(Object.keys(xr).length >= 20 && same(Object.keys(xr).sort(), Object.keys(X.XP_NUM).sort()), 'XP_NUM и xp_rule — одни и те же ключи', [Object.keys(xr), Object.keys(X.XP_NUM)]);
for (const k in xr) ok(X.XP_NUM[k] === xr[k], 'XP_NUM.' + k + ' = xp_rule', [X.XP_NUM[k], xr[k]]);

// ═══ 2. Лестница уровней: LEVEL_REWARDS = level_ladder ═══
const ladM = /function public\.level_ladder\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/.exec(eco);
const lad = JSON.parse(ladM[1]);
ok(lad.length === X.LEVEL_REWARDS.length, 'ступеней столько же', [lad.length, X.LEVEL_REWARDS.length]);
const KEYS = ['friends', 'coins', 'vip', 'fx', 'badge', 'part'];
lad.forEach((e, i) => {
  const c = X.LEVEL_REWARDS[i] || [];
  ok(c[0] === e.lv, 'уровень ступени ' + i, [c[0], e.lv]);
  for (const k of KEYS) ok((c[3] || {})[k] === e[k], `ступень ${e.lv}: ${k}`, [(c[3] || {})[k], e[k]]);
  if (e.coins) ok(c[2].includes(`+${e.coins} 🪙`), `ступень ${e.lv}: в подписи монеты`, c[2]);
  if (e.friends && e.lv > 5) ok(c[2].toLowerCase().includes(`до ${e.friends} друзей`), `ступень ${e.lv}: в подписи друзья`, c[2]);
  if (e.vip) ok(/VIP на/.test(c[2]), `ступень ${e.lv}: в подписи VIP`, c[2]);
  ok(!i || e.lv > lad[i - 1].lv, 'лестница по возрастанию: ' + e.lv);
});
// VIP за уровень — редкий: только Bronze, первый — не раньше 30-го, месяц — только на 100-м
const vips = lad.filter(e => e.vip);
ok(same(vips.map(e => [e.lv, e.vip]), [[30, 3], [50, 7], [100, 30]]), 'VIP за уровень: 30 — 3 дня, 50 — неделя, 100 — месяц', vips);
ok(!/'silver'|'gold'/.test(fnBody(eco, 'check_level_rewards')), 'Silver/Gold за уровень не выдаются');
// рамки — на тех же уровнях, что и раньше (только CSS)
ok(same(X.FRAME_LEVELS, [100, 50, 30, 15, 5]), 'рамки: 5/15/30/50/100 — как были');
// друзья: формула friend_limit = ступени лестницы
const limit = lv => lv < 15 ? 15 : Math.min(45, 15 + 5 * (Math.floor(lv / 5) - 2));
ok(fnBody(eco, 'friend_limit').includes('return least(45, 15 + 5 * (lv / 5 - 2));'), 'friend_limit: +5 каждые 5 уровней до 45');
let lastF = 15;
for (let lv = 5; lv <= 100; lv++) {
  const st = lad.find(e => e.lv === lv && e.friends);
  if (st) lastF = st.friends;
  if (lv >= 5) ok(limit(lv) === lastF, 'лимит друзей на уровне ' + lv, [limit(lv), lastF]);
}
// значки
for (const e of lad.filter(x => x.badge)) {
  ok(ACH.some(a => a.code === e.badge && !a.xp), 'значок ' + e.badge + ' — в ACHIEVEMENT_DEFS (без XP)');
  ok(fnBody(eco, 'my_achievements').includes(`('${e.badge}',`) && new RegExp(`'${e.badge}',\\s+lvl >= ${e.lv}\\)`).test(eco), 'значок ' + e.badge + ' — в my_achievements с уровня ' + e.lv);
}
// эффекты ника
for (const fx of ['gold', 'rainbow']) {
  ok(lad.some(e => e.fx === fx), 'ступень с ником ' + fx);
  ok(read('css/premium.css').includes(`.nick-${fx}{`), 'стиль .nick-' + fx);
}
ok(read('js/features/secrets.js').includes("rpc('nick_fx')"), 'secrets.js читает nick_fx');
// вещи «за уровень»: avatar.js PARTS (7-е поле) = ступени part = coin_level_item
const lvlItems = [];
for (const s of CH.SLOTS) for (const p of CH.PARTS[s].list) if (p[6]) lvlItems.push({ item: `${s}:${p[0]}`, lv: p[6], price: p[2], gems: p[5] || 0 });
ok(lvlItems.length >= 5, 'вещей «за уровень» не меньше 5', lvlItems.length);
for (const it of lvlItems) {
  ok(lad.some(e => e.part === it.item && e.lv === it.lv), `вещь ${it.item} — в лестнице на ${it.lv} уровне`);
  ok(it.price === 0 && !it.gems, `вещь ${it.item} — бесплатная (не продаётся)`);
  ok(coins.includes(`('skin:${it.item}', ${it.lv})`), `coin_level_item: skin:${it.item} → ${it.lv}`);
  ok(CH.levelOf('skin:' + it.item) === it.lv, `D37Char.levelOf(${it.item})`);
}
for (const e of lad.filter(x => x.part)) ok(lvlItems.some(i => i.item === e.part), 'ступень ' + e.lv + ': вещь есть в PARTS — ' + e.part);
ok(lvlItems.every(i => ['item', 'pet', 'trail'].includes(i.item.split(':')[0])), 'вещи за уровень — только эмодзи-слоты (2D и 3D рисуют без новых моделей)');
// /vip: FREE = VIP-ступени
const vipJs = read('api/_lib/routes/vip.js');
const free = /const FREE = (\[\[[^\n]*\]\]);/.exec(vipJs);
ok(free && same(JSON.parse(free[1].replace(/'/g, '"')).map(x => x[0]), vips.map(e => e.lv)), '/vip: уровни бесплатного VIP — как в лестнице', free && free[1]);
ok(!/Gold на год|Silver на 3 месяца|Bronze VIP на месяц/.test(vipJs + read('js/features/xp.js') + read('js/games/words.js')), 'старые обещания VIP за уровень убраны из текстов');

// ═══ 3. Ачивки: XP на клиенте = achievement_xp; коды = my_achievements ═══
const ax = pairs(fnBody(eco, 'achievement_xp'));
for (const a of ACH) ok((a.xp || 0) === (ax[a.code] || 0), 'XP ачивки ' + a.code, [a.xp || 0, ax[a.code] || 0]);
const myAch = fnBody(eco, 'my_achievements'), codes = [...myAch.slice(myAch.indexOf('return query values')).matchAll(/^\s+\('([a-z0-9_]+)',\s+/gm)].map(m => m[1]);
ok(same([...codes].sort(), ACH.map(a => a.code).sort()), 'коды ачивок: my_achievements = ACHIEVEMENT_DEFS', [codes.length, ACH.length]);
// связанное с поддержкой не урезано
for (const c of ['vip', 'vip_silver', 'vip_gold', 'supporter']) ok(ax[c] >= 100, `ачивка ${c} (за поддержку) — как была`);

// ═══ 4. Монеты: coins.js RULES / RUN_CAP = coin_rule / coin_run_cap ═══
const cr = pairs(fnBody(coins, 'coin_rule'));
const MAP = { daily: 'daily', quest: 'quest', win: 'win', winPerDay: 'win_day', ad: 'ad', adPerDay: 'ad_day', adGap: 'ad_gap', doublePerDay: 'double_day', runDay: 'run_day', runGap: 'run_gap', import: 'import', revive: 'revive' };
for (const [js, sq] of Object.entries(MAP)) ok(W.RULES[js] === cr[sq], `RULES.${js} = coin_rule('${sq}')`, [W.RULES[js], cr[sq]]);
const caps = pairs(fnBody(coins, 'coin_run_cap'));
const RUN = W.RUN_CAP;
ok(same(Object.keys(caps).sort(), Object.keys(RUN).sort()), 'RUN_CAP: те же игры');
for (const g in caps) ok(RUN[g] === caps[g], `RUN_CAP.${g} = coin_run_cap`, [RUN[g], caps[g]]);
// формулы игр не обещают больше потолка
const gm = f => read('js/games/' + f);
const bl = /COIN_DIV = (\d+), COIN_MAX = (\d+)/.exec(gm('blocks.js'));
ok(+bl[2] === caps.blocks, 'Блоки: COIN_MAX = потолок', [bl[2], caps.blocks]);
const so = /S\.kind === 'k' \? \(S\.draw === 3 \? (\d+) : (\d+)\) : S\.kind === 'f' \? (\d+) : \(\{ 1: (\d+), 2: (\d+), 4: (\d+) \}\)/.exec(gm('solitaire.js')).slice(1).map(Number);
ok(Math.max(so[0], so[1]) <= caps.kosynka && so[2] <= caps.freecell && Math.max(so[3], so[4], so[5]) <= caps.pauk, 'пасьянсы: монеты за победу ≤ потолков', so);
const mi = [...gm('miner.js').matchAll(/ref: \d+, coins: (\d+)/g)].map(m => +m[1]);
ok(mi.length === 3 && Math.max(...mi) <= caps.miner, 'Сапёр ≤ потолка', mi);
const mj = /Math\.min\((\d+), (\d+) \+ G\.n\)/.exec(gm('mahjong.js'));
ok(mj && +mj[1] === caps.mahjong, 'Маджонг: до потолка', mj && mj[0]);
const sd = [...gm('sudoku.js').matchAll(/ref: \d+, coins: (\d+)/g)].map(m => +m[1]), sdd = +/coins = daily \? (\d+) :/.exec(gm('sudoku.js'))[1];
ok(sd.length === 4 && Math.max(...sd, sdd) <= caps.sudoku, 'Судоку ≤ потолка', [sd, sdd]);
ok(/Math\.floor\(G\.t \/ 60\) \* 2 \+ \(G\.won \? 25 : 0\)/.test(gm('horde.js')) && /Math\.floor\(t \/ 60\) \* 2 \+ \(won \? 25 : 0\)/.test(gm('horde.js')), 'Орда: одна формула у одиночной и кооп-игры');
ok(/S\.wave \* 2 \+ \(won \? 25 : 0\)/.test(gm('td.js')) && 20 * 2 + 25 <= caps.td, 'Башни ≤ потолка');
// Unity: игра просит до 50 (протокол SDK не меняем), сервер даёт половину до coin_rule('unity_round')
ok(/ROUND_COINS = 50/.test(gm('unity-host.js')) && /const int MaxRoundCoins = 50;/.test(read('sdk/unity/Runtime/D37.cs')), 'Unity: протокол SDK — до 50 (как было)');
ok(fnBody(eco, 'unity_result').includes("least((least(greatest(coalesce(p_coins, 0), 0), 50) + 1) / 2, v_round)") && cr.unity_round === 25, 'Unity: сервер даёт половину, до 25');
ok(eco.includes("public.xp_rule('unity_win')"), 'Unity: XP — по общим правилам игр');
// цены не трогали (купленное не дешевеет): возрождение 30, герои
ok(cr.revive === 30 && /'hero:streamer' then 2500/.test(coins), 'цены не менялись: возрождение 30, «Денчик» 2500');

// ═══ 5. XP за победу: все прежние ключи на месте, меньше прежнего, не больше 20 ═══
let oldMore = '';
try { oldMore = cp.execFileSync('git', ['show', '833f6ee:games-more.sql'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) {}
const nx = pairs(fnBody(more, 'game_win_xp'));
if (oldMore) {
  const ox = pairs(fnBody(oldMore, 'game_win_xp'));
  ok(Object.keys(ox).every(k => k in nx), 'XP за победу: все прежние ключи на месте', Object.keys(ox).filter(k => !(k in nx)));
  for (const k in ox) ok(nx[k] > 0 && nx[k] < ox[k] || (ox[k] <= 3 && nx[k] >= 1 && nx[k] <= ox[k]), `XP за победу ${k}: ${ox[k]} → ${nx[k]}`);
  const sumO = Object.values(ox).reduce((a, b) => a + b, 0), sumN = Object.keys(ox).reduce((a, k) => a + (nx[k] || 0), 0);   // новые игры — не в сравнении
  ok(sumN <= sumO * .6, 'XP за победы в среднем меньше хотя бы на 40 %', [sumO, sumN]);
} else console.log('  (нет git — сравнение с 833f6ee пропущено)');
for (const k in nx) ok(nx[k] >= 1 && nx[k] <= 20, 'XP за победу 1…20: ' + k, nx[k]);

// ═══ 6. Цели баланса — из расчёта scripts/economy-sim.cjs ═══
let sim = null;
try { sim = JSON.parse(cp.execFileSync(process.execPath, [path.join(__dirname, 'economy-sim.cjs'), '--json'], { cwd: ROOT, encoding: 'utf8' })); } catch (e) { ok(false, 'economy-sim.cjs --json', String(e).slice(0, 300)); }
if (sim) {
  const by = (arr, id) => arr.find(x => x.id === id);
  for (const id of ['casual', 'active', 'max']) {
    const a = by(sim.before, id), b = by(sim.now, id);
    ok(b.perDay <= a.perDay * .6, `${id}: XP в день меньше хотя бы на 40 %`, [a.perDay, b.perDay]);
    ok(b.coins <= a.coins * .6, `${id}: монет в день меньше хотя бы на 40 %`, [a.coins, b.coins]);
    ok(b.coins >= a.coins * .3 || id === 'max', `${id}: но не обрезано совсем (≥ 30 % прежнего)`, [a.coins, b.coins]);
    const first = b.vip.find(v => v.lv === 30), month = b.vip.find(v => v.days >= 28);
    ok(first.day == null || first.day >= 150, `${id}: первый бесплатный VIP — не раньше чем через 5 месяцев`, first.day);
    ok(month.day == null || month.day >= 2 * 365, `${id}: бесплатный месяц VIP — не раньше чем через 2 года`, month.day);
  }
  const act = by(sim.now, 'active');
  ok(act.at[5] <= 7 && act.at[10] <= 40, 'активный: 5 уровень (друзья) за неделю, 10-й (титул) — за ~месяц', [act.at[5], act.at[10]]);
  // задания недели, сезон и новогоднее задание не разгоняют уровни (темп docs/ECONOMY.md — примерно тот же: не больше чем на 12 %)
  ok(sim.noquests && sim.noquests.length === 3, 'расчёт без заданий недели и сезона — есть (economy-sim)');
  for (const nq of sim.noquests || []) {
    const b = by(sim.now, nq.id);
    for (const L of [10, 30, 50]) ok(b.at[L] >= nq.at[L] * .88, `${nq.id}: с заданиями недели и сезоном ${L} уровень — не больше чем на 12 % быстрее`, [nq.at[L], b.at[L]]);
    ok(b.perDay - nq.perDay <= 15 && b.coins - nq.coins <= 40, `${nq.id}: прибавка небольшая (XP ≤ 15, 🪙 ≤ 40 в день)`, [nq.perDay, b.perDay, nq.coins, b.coins]);
  }
  const qa = by(sim.quests || [], 'active'), qc = by(sim.quests || [], 'casual');
  ok(qa && qa.lv === 25 && qc && qc.lv >= 15 && qc.lv < 25, 'сезон: активный проходит путь за месяц, обычный — большую часть', [qa && qa.lv, qc && qc.lv]);
}

// ═══ 7. Задания недели, сезонный путь, новогоднее задание (games-more.sql ↔ js/features/games.js, js/core/celebrate.js; 22.10.2026) ═══
{
  const G = load('js/features/games.js', '({ QUEST_NUM, WEEKLY_QUESTS, SEASON_LADDER, SEASON_THEMES, seasonTitleDef })', { setInterval: () => 0, clearTimeout(){} });
  const CE = load('js/core/celebrate.js', 'window.D37Celebrate', { setInterval: () => 0, clearTimeout(){} });
  const qr = pairs(fnBody(more, 'quest_rule'));
  ok(Object.keys(qr).length >= 15 && same(Object.keys(qr).sort(), Object.keys(G.QUEST_NUM).sort()), 'QUEST_NUM и quest_rule — одни и те же ключи', [Object.keys(qr), Object.keys(G.QUEST_NUM)]);
  for (const k in qr) ok(G.QUEST_NUM[k] === qr[k], `QUEST_NUM.${k} = quest_rule('${k}')`, [G.QUEST_NUM[k], qr[k]]);
  const js = (name, re) => { const m = re.exec(more); return m ? JSON.parse(m[1]) : null; };
  // задания недели: тот же пул, в том же порядке (от порядка зависит, какие задания у недели)
  const pool = js('pool', /function public\.weekly_quest_pool\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/);
  ok(Array.isArray(pool) && pool.length >= 12, 'weekly_quest_pool — список', pool && pool.length);
  ok(same(pool.map(e => e.code), Object.keys(G.WEEKLY_QUESTS)), 'WEEKLY_QUESTS = weekly_quest_pool: те же коды в том же порядке');
  for (const e of pool) {
    const c = G.WEEKLY_QUESTS[e.code] || {};
    ok(c.slot === e.slot && c.n === e.n && c.stat === e.stat, `задание ${e.code}: место, сколько, что считать`, [c.slot, c.n, c.stat, e]);
    ok(new RegExp(`\\b${e.n}\\b`).test(c.text || '') || e.n === 1, `задание ${e.code}: число ${e.n} в тексте`, c.text);
    ok(fnBody(more, 'weekly_quest_stats').includes(`'${e.stat}'`), `счётчик ${e.stat} есть в weekly_quest_stats`);
  }
  const slots = [...new Set(pool.map(e => e.slot))].sort();
  ok(same(slots, [1, 2, 3, 4, 5, 6]), 'шесть мест — шесть заданий в неделю', slots);
  // выбор недели — без случайности: (w + s) mod вариантов; за год встречается каждое задание
  ok(/res := res \|\| arr\[1 \+ \(\(w \+ s\) % k \+ k\) % k\]/.test(fnBody(more, 'weekly_quest_codes')), 'weekly_quest_codes: место s недели w — вариант (w + s) mod k');
  const pick = w => slots.map(s => { const a = pool.filter(e => e.slot === s); return a[((w + s) % a.length + a.length) % a.length].code; });
  const seen = new Set(); for (let w = 0; w < 52; w++) pick(w).forEach(c => seen.add(c));
  ok(seen.size === pool.length, 'за год встречается каждое задание недели', [seen.size, pool.length]);
  ok(same(pick(41), ['w_play15', 'w_win12', 'w_games7', 'w_words3', 'w_hard1', 'w_puzzle5']), 'неделя 19.10.2026 (№ 41) — те же задания, что на сервере (PGlite)', pick(41));
  // сезон: лестница и темы — одинаковые; только 🪙 и украшения (ни XP, ни VIP, ни силы)
  const lad = js('ladder', /function public\.season_ladder\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/);
  ok(same(lad, G.SEASON_LADDER), 'SEASON_LADDER = season_ladder');
  ok(lad.length === qr.s_levels && lad.every((e, i) => e.lv === i + 1), 'уровни сезона 1…' + qr.s_levels + ' подряд', lad.length);
  ok(lad.every(e => Object.keys(e).every(k => ['lv', 'coins', 'title', 'item', 'frame'].includes(k))), 'награды сезона — только монеты, титулы, вещь и рамка');
  ok(lad.filter(e => e.title === 1).length === 1 && lad.filter(e => e.title === 2).length === 1 && lad.filter(e => e.item).length === 1 && lad.filter(e => e.frame).length === 1, 'за сезон: 2 титула, вещь, рамка');
  const seasonCoins = lad.reduce((a, e) => a + (e.coins || 0), 0);
  ok(seasonCoins <= 600, 'монет за весь сезон — немного (≤ 600)', seasonCoins);
  const th = js('themes', /function public\.season_themes\(\)[\s\S]*?select '(\[[\s\S]*?\])'::jsonb/);
  ok(same(th, G.SEASON_THEMES), 'SEASON_THEMES = season_themes');
  ok(same(th.map(t => t.m), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) && new Set(th.map(t => t.id)).size === 12, 'темы на все 12 месяцев, id разные');
  const css = read('css/premium.css');
  for (const t of th) {
    const m = /^skin:(\w+):(\w+)$/.exec(t.item), p = m && CH.PARTS[m[1]]?.list.find(x => x[0] === m[2]);
    ok(p && p[7] === 2 && p[2] === 0 && !p[5] && !p[6], `вещь темы ${t.id} — в avatar.js, «за сезон» (8-е поле 2), не продаётся`, t.item);
    ok(CH.price(t.item) === null && !coins.includes(`'${t.item}'`), `вещь темы ${t.id} — без цены (coin_price → null)`, t.item);
    ok(['item', 'pet', 'trail'].includes(m && m[1]), `вещь темы ${t.id} — эмодзи-слот (2D и 3D без моделей)`, t.item);
    ok(css.includes(`.lv-frame-ss[data-ss="${t.id}"]{--ssc:${t.color};--sse:'${t.icon}'}`), `рамка темы ${t.id} — в css/premium.css (цвет и значок как в season_themes)`);
  }
  ok(G.seasonTitleDef('ss:2026-11:1')?.title === 'Осенний дождь 2026' && /Легенда/.test(G.seasonTitleDef('ss:2027-01:2')?.title) && G.seasonTitleDef('ss:x') === null, 'титулы сезона: «тема год» и «Легенда: …»');
  ok(/'ss:' \|\| ym \|\| ':' \|\| \(e->>'title'\)/.test(fnBody(more, 'season_claim')), 'season_claim выдаёт титулы ss:ГГГГ-ММ:N (как seasonTitleDef)');
  // платного пути нет — только выключатель; случайности нет
  ok(/function public\.season_paid_on\(\) returns boolean language sql immutable as \$\$ select false \$\$/.test(more), 'платного пути нет: season_paid_on() → false');
  const qsql = more.slice(more.indexOf('ЗАДАНИЯ НЕДЕЛИ, СЕЗОННЫЙ ПУТЬ И НОВОГОДНЕЕ ЗАДАНИЕ'));
  ok(qsql.length > 1000 && !/random\(|gen_random|setseed|tablesample/i.test(qsql), 'в заданиях, сезоне и новогоднем задании нет случайности');
  ok(!/premium_|gems|vip_grants/.test(qsql), 'сезон и задания не трогают 💎 и VIP');
  // новогоднее задание: те же 31 задание; ⛄ — вещь «Новый год» (8-е поле 3)
  const adv = /function public\.advent_task\(p_day int\)[\s\S]*?select \(array\[([\s\S]*?)\]\)\[p_day\]/.exec(more);
  const advSql = adv ? [...adv[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
  ok(CE.ADVENT.length === 31 && same(advSql, CE.ADVENT.map(t => t.kind + (t.n > 1 ? '*' + t.n : ''))), 'advent_task = ADVENT (31 задание, «*N» — сколько раз)', advSql.length);
  const snow = CH.PARTS.pet.list.find(x => x[0] === 'snowman');
  ok(snow && snow[7] === 3 && CH.price('skin:pet:snowman') === null && fnBody(more, 'advent_claim_at').includes("'skin:pet:snowman'"), '⛄ «Снеговик» — награда новогоднего задания (не продаётся)');
  ok(!!CH.grantOf(2) && !!CH.grantOf(3) && !!CH.grantOf(1), 'подписи наград в гардеробе: друзья, сезон, Новый год');
  ok(X.XP_NUM && /weekly: 'Задания недели'/.test(read('js/features/xp.js')) && /advent: 'Новогоднее задание'/.test(read('js/features/xp.js')), 'XP_SOURCE_LABEL: задания недели и новогоднее задание');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

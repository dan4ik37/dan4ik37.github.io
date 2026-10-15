// Тесты «Филворда» (js/games/fillword.js) в node: путь через все клетки, разбиение на слова, каждое слово читается на поле
// ровно одним путём (и только по своим клеткам), все клетки заняты, слова не повторяются и есть в словаре, «Филворд дня» —
// одинаковый при каждом запуске (зерно от даты), уровни 1–60 собираются быстро. Плюс «прохождение» поля по путям слов.
// Запуск из корня сайта: node scripts/fillword-test.cjs [сколько полей каждого размера, по умолчанию 40]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const PER = +process.argv[2] || 40;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };
function load(){
  const c = vm.createContext({ console, Math, Date, JSON });
  c.window = c; c.GAME_IMPL = {};
  for (const f of ['js/games/nouns-common.js', 'js/games/fillword.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), c, { filename: f });
  return c.GAME_IMPL.fillword._test;
}
const F = load();
const common = new Set(String(vm.runInNewContext(fs.readFileSync(path.join(SITE, 'js/games/nouns-common.js'), 'utf8') + ';window.NOUNS_COMMON', { window: {} })).split(' '));

// ═══ 1. Путь через все клетки ═══
for (const [w, h] of [[4, 4], [5, 5], [6, 6], [7, 7], [9, 9], [5, 7]]) {
  let good = 0;
  for (let s = 0; s < 30; s++) {
    const p = F.hamPath(w, h, F.rng(s + w * 100));
    const all = new Set(p), adj = p.every((c, i) => !i || F.nbs(p[i - 1], w, h).includes(c));
    if (p.length === w * h && all.size === w * h && adj) good++;
  }
  ok(good === 30, `путь через все клетки ${w}×${h}: без повторов, по соседним`, good);
}
// пути разные (не одна «змейка»)
{
  const a = F.hamPath(6, 6, F.rng(1)).join(','), b = F.hamPath(6, 6, F.rng(2)).join(','), snake = [];
  for (let r = 0; r < 6; r++) for (let k = 0; k < 6; k++) snake.push(r * 6 + (r % 2 ? 5 - k : k));
  ok(a !== b && a !== snake.join(','), 'пути случайные, не просто «змейка»');
}

// ═══ 2. Поля: все клетки — в словах, слова уникальны, читаются одним путём ═══
function checkPuzzle(P, o, name){
  const N = P.w * P.h, seen = new Array(N).fill(0);
  let bad = '';
  for (const wd of P.words) {
    if (wd.cells.length !== wd.w.length) bad = 'длина ' + wd.w;
    if (wd.w.length < o.min || wd.w.length > o.max) bad = 'длина вне границ ' + wd.w;
    if (!common.has(wd.w)) bad = 'не из словаря ' + wd.w;
    wd.cells.forEach((c, i) => { seen[c]++; if (P.grid[c] !== wd.w[i]) bad = 'буква ' + wd.w; if (i && !F.nbs(wd.cells[i - 1], P.w, P.h).includes(c)) bad = 'не соседи ' + wd.w; });
    if (F.countPaths(P.grid, P.w, P.h, wd.w) !== 1) bad = 'читается не одним путём: ' + wd.w;
  }
  if (seen.some(x => x !== 1)) bad = bad || 'клетка не в одном слове';
  if (new Set(P.words.map(x => x.w)).size !== P.words.length) bad = bad || 'слова повторяются';
  if (!/^[а-я]+$/.test(P.grid.join(''))) bad = bad || 'пустая клетка';
  return bad;
}
const sizes = [1, 3, 7, 13, 21, 36, 60].map(lv => ({ lv, o: F.sizeOf(lv) }));
for (const { lv, o } of sizes) {
  let errs = 0, nulls = 0, ms = 0, maxMs = 0, words = 0;
  for (let s = 0; s < PER; s++) {
    const t0 = Date.now(), P = F.generate(o, F.rng(lv * 1000 + s)), dt = Date.now() - t0;
    ms += dt; maxMs = Math.max(maxMs, dt);
    if (!P) { nulls++; continue; }
    words += P.words.length;
    const bad = checkPuzzle(P, o);
    if (bad) { errs++; if (errs < 3) console.log('  ', o.w + '×' + o.h, bad); }
  }
  ok(!nulls, `поле ${o.w}×${o.h} всегда собирается`, nulls);
  ok(!errs, `поле ${o.w}×${o.h}: клетки заняты, слова уникальны и читаются одним путём (${PER} полей)`, errs);
  ok(maxMs < 1500, `поле ${o.w}×${o.h} собирается быстро (сред. ${(ms / PER).toFixed(0)} мс, макс ${maxMs} мс)`, maxMs);
  console.log(`  ${o.w}×${o.h}: в среднем ${(words / PER).toFixed(1)} слов, ${(ms / PER).toFixed(0)} мс`);
}

// ═══ 3. «Филворд дня» и уровни — одинаковые у всех ═══
{
  const F2 = load();
  for (const n of [1, 2, 30, 365]) {
    const a = F.dailyPuzzle(n), b = F2.dailyPuzzle(n);
    ok(a && b && a.grid.join('') === b.grid.join('') && a.words.map(x => x.w).join() === b.words.map(x => x.w).join(), `«Филворд дня» #${n} — одинаковый при каждом запуске`);
    ok(a && !checkPuzzle(a, F.DAILY_SIZE), `«Филворд дня» #${n} — правильное поле`);
  }
  ok(F.dailyPuzzle(1).grid.join('') !== F.dailyPuzzle(2).grid.join(''), 'каждый день — новое поле');
  const t0 = Date.UTC(2026, 9, 15) - 3 * 3600e3;   // полночь 15.10.2026 по МСК
  ok(F.dayNo(t0) === 1 && F.dayNo(t0 - 1000) === 0 && F.dayNo(t0 + 864e5) === 2, 'день №1 — 15.10.2026, смена в полночь по МСК');
  // карточка «Филворд дня» на главной (games.js) считает номер дня так же
  {
    const m = fs.readFileSync(path.join(SITE, 'js/features/games.js'), 'utf8').match(/function fillwordDayNo\(\)\{ return ([^}]+) \}/);
    const day = m && (now => vm.runInNewContext(m[1].replace(/Date\.now\(\)/g, String(now)), { Math, Date }));
    ok(day && [t0, t0 - 1000, t0 + 864e5 * 40 + 5000, t0 + 864e5 * 400 - 1].every(t => day(t) === F.dayNo(t)), 'games.js fillwordDayNo — тот же номер дня, что в игре');
  }
  for (const lv of [1, 5, 12, 40]) ok(F.levelPuzzle(lv).grid.join('') === F2.levelPuzzle(lv).grid.join(''), `уровень ${lv} — одинаковый у всех`);
  let slow = 0;
  for (let lv = 1; lv <= 60; lv++) { const t = Date.now(), P = F.levelPuzzle(lv); if (!P || checkPuzzle(P, F.sizeOf(lv))) slow += 100; if (Date.now() - t > 1500) slow++; }
  ok(slow === 0, 'уровни 1–60: все собираются правильно и быстро', slow);
}

// ═══ 4. Очки и монеты ═══
ok(F.scoreOf(49, 120, 0) > F.scoreOf(49, 300, 0) && F.scoreOf(49, 120, 0) > F.scoreOf(49, 120, 2), 'быстрее и без подсказок — больше очков');
// потолки сервера (games-more.sql): fillword и fillword_duel — 3000, fillword_daily — 2000
{
  const sql = fs.readFileSync(path.join(SITE, 'games-more.sql'), 'utf8');
  const capOf = key => { const m = sql.match(new RegExp(`when p_game (?:= '${key}'|in \\([^)]*'${key}'[^)]*\\)) then (\\d+)`)); return m ? +m[1] : 0; };
  const lv = capOf('fillword'), daily = capOf('fillword_daily'), duel = capOf('fillword_duel');
  ok(lv && F.scoreOf(81, 1, 0) <= lv, 'очки уровня не больше потолка сервера', [F.scoreOf(81, 1, 0), lv]);
  ok(daily && F.scoreOf(F.DAILY_SIZE.w * F.DAILY_SIZE.h, 1, 0) <= daily, 'очки «Филворда дня» не больше потолка сервера', [F.scoreOf(49, 1, 0), daily]);
  // соревнование: 20 за букву + 1000 за все слова + 2 за каждую оставшуюся секунду из 300
  ok(duel && F.DUEL_SIZE.w * F.DUEL_SIZE.h * 20 + 1000 + 300 * 2 <= duel, 'очки соревнования не больше потолка сервера', duel);
  ok(/when 'fillword' then \d+ when 'fillword_daily' then \d+ when 'fillword_duel' then \d+/.test(sql), 'XP за победу — у всех трёх ключей');
}
ok([16, 25, 36, 49, 64, 81].every(n => F.coinsOf(n) >= 2 && F.coinsOf(n) <= 5), 'монеты за уровень — 2…5');

console.log(`fillword-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

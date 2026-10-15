// Тесты «Домино» (js/games/domino.js) в node: раздача, первый ход, правила хода, базар, «рыба», счёт до 51/101, тысячи партий
// ботов (2–4 игрока, с базаром и без), выбор → подтверждение → отмена (pickReduce), раскладка цепочки «змейкой» без наложений.
// Запуск из корня сайта: node scripts/domino-test.cjs [число партий, по умолчанию 3000]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const N_GAMES = +process.argv[2] || 3000;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };
const ctx = vm.createContext({ console, Math, Date, JSON });
ctx.window = ctx; ctx.GAME_IMPL = {};
vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/domino.js'), 'utf8'), ctx, { filename: 'domino.js' });
const D = ctx.GAME_IMPL.domino._test;
function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pl = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, nick: 'Игрок ' + i, bot: true }));
const total = G => G.hands.reduce((s, h) => s + h.length, 0) + G.line.length + G.bazar.length + G.sleep;

// ═══ 1. Раздача и первый ход ═══
ok(D.TILES.length === 28 && D.TILES.every(([a, b]) => a <= b && b <= 6), '28 костяшек 0–0…6–6');
for (const n of [2, 3, 4]) {
  const G = D.newGame(pl(n), rng(n), { yard: true });
  ok(G.hands.every(h => h.length === 7) && G.bazar.length === 28 - 7 * n && total(G) === 28, `${n} игрока: по 7, базар ${28 - 7 * n}`);
  const G2 = D.newGame(pl(n), rng(n), { yard: false });
  ok(G2.bazar.length === 0 && G2.sleep === 28 - 7 * n && total(G2) === 28, `${n} игрока без базара: ${28 - 7 * n} спят`);
}
{
  let okFirst = 0, cnt = 0;
  for (let s = 1; s < 300; s++) {
    const G = D.newGame(pl(2 + s % 3), rng(s), { yard: true });
    const order = [1, 2, 3, 4, 5, 6, 0].map(v => D.TILES.findIndex(t => t[0] === v && t[1] === v));
    const held = order.find(t => G.hands.some(h => h.includes(t)));
    cnt++;
    if (held !== undefined ? G.must === held && G.hands[G.turn].includes(held) : G.must >= 0 && G.hands[G.turn].includes(G.must)) okFirst++;
  }
  ok(okFirst === cnt, 'первый ход — у кого самый маленький дубль (1–1…6–6, 0–0), иначе самая маленькая костяшка', [okFirst, cnt]);
}
// правила хода
{
  const G = D.newGame(pl(2), rng(5), { yard: true });
  const p = G.turn, q = 1 - p;
  const wrong = G.hands[p].find(t => t !== G.must);
  ok(D.act(G, p, { a: 'play', t: wrong }) && D.act(G, q, { a: 'play', t: G.hands[q][0] }), 'первый ход — только обязательной костяшкой и только своим');
  ok(D.act(G, p, { a: 'play', t: G.must }) === null && G.line.length === 1 && G.turn === q, 'первый ход сделан');
  const fits = G.hands[q].filter(t => D.sidesFor(G, t).length);
  if (fits.length) ok(D.act(G, q, { a: 'draw' }) !== null && D.act(G, q, { a: 'pass' }) !== null, 'есть чем ходить — брать и пропускать нельзя');
  else ok(D.act(G, q, { a: 'draw' }) === null, 'нечем ходить — берёт из базара');
}

// ═══ 2. Тысячи партий ботов ═══
let errs = 0, rounds = 0, fishes = 0, fishTie = 0, longest = 0, games = 0;
const t0 = Date.now();
for (let g = 0; g < N_GAMES; g++) {
  const n = 2 + (g % 3), yard = g % 4 !== 3, target = g % 5 === 0 ? 101 : 51, rand = rng(1000 + g);
  const G = D.newGame(pl(n).map((x, i) => ({ ...x, lv: (g + i) % 2 ? 'easy' : 'normal' })), rand, { yard, target });
  let steps = 0, err = '';
  while (!G.over && steps < 20000) {
    steps++;
    if (G.rover) {
      rounds++; if (G.res.fish) { fishes++; if (G.res.p < 0) fishTie++; }
      // очки раунда = сумма в руках остальных
      if (G.res.p >= 0 && G.res.pts !== G.res.sums.reduce((s, x, i) => s + (i === G.res.p ? 0 : x), 0)) { err = 'счёт раунда'; break; }
      D.nextRound(G);
      continue;
    }
    const p = G.turn, m = D.botMove(G, p, G.players[p].lv, rand);
    if (m.a !== 'play') D.noteMiss(G, p);
    const e = D.act(G, p, m);
    if (e) { err = 'ход бота отклонён: ' + e + ' ' + JSON.stringify(m); break; }
    if (total(G) !== 28) { err = 'костяшки не сходятся'; break; }
    // цепочка — числа на стыках совпадают
    for (let k = 1; k < G.line.length; k++) if (G.line[k - 1].b !== G.line[k].a) { err = 'стык не совпал'; break; }
    if (err) break;
    longest = Math.max(longest, G.line.length);
  }
  if (!G.over && !err) err = 'игра не кончилась';
  if (!err && !(G.sc[G.winner] >= G.target && G.sc.every((s, i) => i === G.winner || s < G.target + 200))) err = 'победитель не набрал цель';
  if (err) { errs++; if (errs < 4) console.log('  партия', g, err); }
  games++;
}
ok(errs === 0, `${N_GAMES} партий ботов (2–4 игрока, с базаром и без, до 51 и 101) — без ошибок`, errs);
ok(fishes > 0 && fishTie >= 0, '«рыба» случается', [fishes, fishTie]);
console.log(`  партий ${games} за ${((Date.now() - t0) / 1000).toFixed(1)} с · раундов ${rounds} · рыба ${fishes} (поровну ${fishTie}) · самая длинная цепочка ${longest}`);
// умный бот обыгрывает простого
{
  let wN = 0, wE = 0;
  for (let g = 0; g < 600; g++) {
    const rand = rng(7000 + g), G = D.newGame(pl(2).map((x, i) => ({ ...x, lv: (i + g) % 2 ? 'easy' : 'normal' })), rand, { yard: true, target: 51 });
    let s = 0;
    while (!G.over && s++ < 20000) { if (G.rover) { D.nextRound(G); continue; } const p = G.turn, m = D.botMove(G, p, G.players[p].lv, rand); if (m.a !== 'play') D.noteMiss(G, p); D.act(G, p, m); }
    if (G.players[G.winner].lv === 'normal') wN++; else wE++;
  }
  ok(wN > wE * 1.15, 'хитрый бот выигрывает у простого чаще', [wN, wE]);
  console.log(`  хитрый : простой = ${wN} : ${wE}`);
}
// «рыба» — составленная позиция: на концах 6 и 6, все шестёрки выложены, у обоих нет ходов
{
  const G = D.newGame(pl(2), rng(1), { yard: false });
  const T = D.TILES, id = (a, b) => T.findIndex(t => t[0] === Math.min(a, b) && t[1] === Math.max(a, b));
  const sixes = [0, 1, 2, 3, 4, 5, 6].map(v => id(v, 6));
  // цепочка: 6–0 0–... упростим: только шестёрки на концах — line из 7 костяшек с 6 на обоих концах
  G.line = [{ t: id(6, 6), a: 6, b: 6 }]; G.c = 0;
  const rest = D.TILES.map((_, i) => i).filter(i => !sixes.includes(i));
  G.hands = [rest.slice(0, 3), rest.slice(3, 5)];
  // остальные шестёрки — в «спящих» (не в игре)
  G.bazar = []; G.must = -1; G.turn = 0; G.passes = 0; G.rover = false; G.over = false;
  ok(!D.playable(G, 0).length && D.canPass(G, 0), 'нечем ходить без базара — пропуск');
  D.act(G, 0, { a: 'pass' }); D.act(G, 1, { a: 'pass' });
  const s0 = D.handPips(G.hands[0]), s1 = D.handPips(G.hands[1]);
  ok(G.rover && G.res.fish && (s0 === s1 ? G.res.p === -1 : G.res.p === (s0 < s1 ? 0 : 1)), '«рыба»: раунд у того, у кого меньше очков в руке', [s0, s1, G.res]);
}

// ═══ 3. Выбор → подтверждение → отмена ═══
{
  const sidesMap = { 1: ['L'], 2: ['L', 'R'], 3: [] };
  const c = { hand: [1, 2, 3], sides: t => sidesMap[t] || [] };
  let r = D.pickReduce(D.NOSEL, { t: 'tile', tile: 3 }, c);
  ok(r.msg === 'bad' && r.s.pick === -1, 'неподходящую не выбрать');
  r = D.pickReduce(D.NOSEL, { t: 'tile', tile: 1 }, c);
  ok(r.s.pick === 1 && r.s.side === 'L' && !r.act, 'выбрал — костяшка поднялась, хода ещё нет');
  let r2 = D.pickReduce(r.s, { t: 'tile', tile: 1 }, c);
  ok(r2.act && r2.act.t === 1 && r2.act.side === 'L' && r2.s.pick === -1, 'второе нажатие — ход');
  r2 = D.pickReduce(r.s, { t: 'go' }, c);
  ok(r2.act && r2.act.side === 'L', '«Сходить» — ход');
  r2 = D.pickReduce(r.s, { t: 'cancel' }, c);
  ok(!r2.act && r2.s.pick === -1, '«Отмена» — выбор снят');
  r2 = D.pickReduce(r.s, { t: 'esc' }, c);
  ok(!r2.act && r2.s.pick === -1, 'Esc — выбор снят');
  r2 = D.pickReduce(r.s, { t: 'tile', tile: 2 }, c);
  ok(r2.s.pick === 2 && !r2.act, 'другая костяшка — выбор меняется');
  let r3 = D.pickReduce(r2.s, { t: 'tile', tile: 2 }, c);
  ok(!r3.act && r3.msg === 'side', 'к обоим концам — второе нажатие просит выбрать конец');
  r3 = D.pickReduce(r2.s, { t: 'end', side: 'R' }, c);
  ok(r3.act && r3.act.side === 'R', 'нажал конец цепочки — ход туда');
  r3 = D.pickReduce(D.NOSEL, { t: 'end', side: 'R' }, c);
  ok(!r3.act && r3.msg === 'pick', 'конец без костяшки — подсказка выбрать');
  r3 = D.pickReduce({ pick: 1, side: 'L' }, { t: 'sync' }, { hand: [2, 3], sides: c.sides });
  ok(r3.s.pick === -1, 'костяшки больше нет в руке — выбор снят');
}

// ═══ 4. Раскладка «змейкой»: без наложений, соседние стыкуются ═══
function overlap(a, b){ return a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6; }
function touch(a, b){ const gx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), gy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)); return gx <= 1e-6 && gy <= 1e-6 && !(gx < -1e-6 && gy < -1e-6); }
let layErr = 0, layN = 0;
for (let g = 0; g < 400; g++) {
  const rand = rng(90000 + g), n = 2 + g % 3, G = D.newGame(pl(n), rand, { yard: g % 2 === 0, target: 51 });
  let s = 0;
  while (!G.rover && s++ < 500) { const p = G.turn, m = D.botMove(G, p, 'easy', rand); D.act(G, p, m); }
  for (const half of [6.5, 9]) {
    const R = D.layout(G.line, G.c, half);
    layN++;
    let bad = '';
    for (let i = 0; i < R.length && !bad; i++) {
      const r = R[i];
      if (!r || r.w * r.h !== 2) bad = 'нет прямоугольника ' + i;
      else if (r.x < -half - 1e-6 || r.x + r.w > half + 1e-6) bad = 'вылезла за край ' + i;
      for (let j = i + 1; j < R.length && !bad; j++) if (overlap(r, R[j])) bad = `наложение ${i}/${j}`;
      if (!bad && i > 0 && !touch(R[i - 1], r)) bad = 'не стыкуется ' + i;
      const t = G.line[i];
      if (!bad && !((r.v1 === t.a && r.v2 === t.b) || (r.v1 === t.b && r.v2 === t.a))) bad = 'не те точки ' + i;
    }
    // «призраки» на обоих концах — не налезают на цепочку
    for (const t of G.hands[G.turn] || []) for (const side of ['L', 'R']) {
      if (bad || !G.line.length) break;
      const e = side === 'L' ? G.line[0].a : G.line[G.line.length - 1].b;
      if (!D.TILES[t].includes(e)) continue;
      const gr = D.ghostRect(G.line, G.c, half, t, side);
      if (R.some(r => overlap(r, gr))) bad = 'призрак налез ' + side;
    }
    if (bad) { layErr++; if (layErr < 4) console.log('  раскладка', g, half, bad, G.line.length); }
  }
}
ok(layErr === 0, `раскладка ${layN} цепочек: без наложений, в пределах поля, стыкуются`, layErr);

console.log(`domino-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

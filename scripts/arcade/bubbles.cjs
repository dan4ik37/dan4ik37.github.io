// «Пузыри» (js/games/arcade/bubbles.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// куда стрелять: в пустую клетку под самым нижним открытым пузырём того же цвета (бомбу — под самым нижним любым).
// (Строкой уходит и в e2e-бота.)
function target(s, C){
  const sh = r => ((r + s.par) & 1) === 1, nc = r => (sh(r) ? C.COLS - 1 : C.COLS);
  const X = (r, c) => C.X0 + C.R + c * C.D + (sh(r) ? C.R : 0), Y = r => C.Y0 + C.R + r * C.RH;
  let bx = C.SX, by = 0, bestR = -1, anyR = -1, ax = C.SX, ay = 0;
  for (let r = C.ROWS - 2; r >= 0; r--) {
    for (let c = 0; c < nc(r); c++) {
      const v = s.g[r * C.COLS + c];
      if (v < 0) continue;
      // клетки под ним
      const c1 = sh(r) ? c : c - 1, c2 = c1 + 1;
      for (const cc of [c1, c2]) {
        if (cc < 0 || cc >= nc(r + 1) || s.g[(r + 1) * C.COLS + cc] >= 0) continue;
        if ((v === s.cur || s.cur === C.BOMB) && r > bestR) { bestR = r; bx = X(r + 1, cc); by = Y(r + 1); }
        if (r > anyR) { anyR = r; ax = X(r + 1, cc); ay = Y(r + 1); }
      }
    }
  }
  return bestR >= 0 ? [bx, by] : [ax, ay || C.Y0 + C.R];
}

module.exports = {
  // палец ставит прицел на цель и отпускает (раз в gap шагов, когда пузырь не летит)
  bot(K, spec, gap = 20){
    const T = K.T, C = spec.consts;
    let last = -1e9, held = false;
    return (s, k, push) => {
      if (s.over) return;
      if (held) { push(T.UP, s.tx, s.ty, 0); held = false; return; }
      if (s.shot || k - last < gap) return;
      last = k; held = true;
      const p = target(s, C);
      s.tx = p[0]; s.ty = p[1];
      push(T.DOWN, p[0], p[1], 0);
    };
  },
  maxMs: 130000,
  garbage: { gap: 20, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x, y, k) => { ev.type = type; ev.x = x; ev.y = y; ev.k = k || 0; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const sh = (s, r) => ((r + s.par) & 1) === 1, X = (s, r, c) => C.X0 + C.R + c * C.D + (sh(s, r) ? C.R : 0), Y = r => C.Y0 + C.R + r * C.RH;
    const count = s => { let n = 0; for (let i = 0; i < s.g.length; i++) n += s.g[i] >= 0 ? 1 : 0; return n; };
    const shoot = (s, x, y) => { send(s, T.DOWN, x, y); send(s, T.UP, x, y); let n = 0; stepN(s, 1); while (s.shot && n < 300) { stepN(s, 1); n++; } };
    // пауза / потеря фокуса с пальцем на прицеле (T.CANCEL) — выстрела нет, прицел отпущен (проверка T-140)
    { const c = spec.create(K.rng(40)); send(c, T.DOWN, 100, 200); send(c, T.CANCEL, 0, 0); stepN(c, 5); send(c, T.UP, 0, 0); stepN(c, 5);
      ok(c.held === 0 && c.want === 0 && !c.shot && c.shots === 0, 'bubbles: пауза с пальцем на прицеле — без выстрела (и поздний UP не стреляет)', { shot: c.shot, shots: c.shots }); }

    // старт: 5 рядов, без нажатий ничего не летит и игра идёт; просто тап — один выстрел, не конец
    let s = spec.create(K.rng(61));
    ok(count(s) === 9 + 8 + 9 + 8 + 9 && !s.shot, 'bubbles: старт — 5 рядов сот (9 и 8)', count(s));
    stepN(s, 120);
    ok(!s.over && !s.shot && s.shots === 0, 'bubbles: 2 с без нажатий — ничего не летит, игра идёт');
    send(s, T.DOWN, 160, 200); send(s, T.UP, 160, 200); stepN(s, 1);
    ok(s.shot === 1 && s.shots === 1 && !s.over, 'bubbles: тап по полю — один выстрел, игра идёт');
    // скорость в секунду: за 0,1 с пузырь пролетел SPD × 0,1 (поле пустое)
    s = spec.create(K.rng(62)); s.g.fill(-1); s.g[0] = 0; send(s, T.DOWN, 160, 100); send(s, T.UP, 160, 100); stepN(s, 1);
    const y0 = s.sy; stepN(s, 6);
    ok(Math.abs((y0 - s.sy) - C.SPD * .1) < .5, 'bubbles: за 0,1 с пузырь пролетел SPD × 0,1', y0 - s.sy);
    // баг прототипа: пузырь вставал в первую пустую клетку ниже занятой — «проходил» сквозь; теперь — сразу под столбиком
    s = spec.create(K.rng(63)); stepN(s, 1);
    shoot(s, X(s, 4, 4), 200);
    let low = -1; for (let i = 0; i < s.g.length; i++) if (s.g[i] >= 0) low = Math.max(low, (i / C.COLS) | 0);
    ok(low <= 5 && s.shots === 1, 'bubbles: пузырь встал прямо под рядами (ряд ≤ 5), а не ниже сквозь них', low);
    // три одного цвета — лопаются (+30)
    s = spec.create(K.rng(64)); s.g.fill(-1); s.par = 0; s.g[3] = 1; s.g[4] = 1; s.g[8] = 3; s.cur = 1;   // [8] — чтобы поле не очистилось
    shoot(s, X(s, 0, 5), Y(0));
    ok(count(s) === 1 && s.popped === 3 && s.score === 30, 'bubbles: три одного цвета лопнули (+30)', { n: count(s), score: s.score });
    // оторванный пузырь падает (+20)
    s = spec.create(K.rng(65)); s.g.fill(-1); s.par = 0; s.g[4] = 2; s.g[5] = 2; s.g[1 * C.COLS + 4] = 0; s.g[0] = 3; s.cur = 2;
    shoot(s, X(s, 0, 3), Y(0));
    ok(count(s) === 1 && s.popped === 3 && s.dropped === 1 && s.score === 50, 'bubbles: опора лопнула — висевший пузырь упал (+20)', { n: count(s), score: s.score });
    // 💥 бомба лопает всё вокруг
    s = spec.create(K.rng(66)); s.cur = C.BOMB; const n0 = count(s);
    shoot(s, 160, 100);
    ok(s.bombs === 1 && n0 - count(s) >= 6 && s.score >= 60, 'bubbles: бомба лопнула пузыри вокруг', { was: n0, now: count(s), score: s.score });
    // каждые 8 выстрелов — новый ряд сверху (чётность рядов меняется), поле очищено — +300
    s = spec.create(K.rng(67)); const p0 = s.par;
    for (let i = 0; i < C.DROP && !s.over; i++) shoot(s, i % 2 ? 40 : 280, 380);
    ok(s.rows === 1 && s.par !== p0, 'bubbles: 8 выстрелов — новый ряд сверху', { rows: s.rows });
    s = spec.create(K.rng(68)); s.g.fill(-1); s.g[3] = 1; s.g[4] = 1; s.cur = 1; shoot(s, X(s, 0, 5), Y(0));
    ok(s.clears === 1 && s.score === 330 && count(s) === 9 + 8 + 9 + 8 + 9, 'bubbles: поле очищено — +300 и новые ряды', { score: s.score });
    // тап по пушке — поменять пузыри
    s = spec.create(K.rng(69)); s.cur = 0; s.nxt = 3; send(s, T.DOWN, C.SX, C.SY);
    ok(s.cur === 3 && s.nxt === 0 && !s.shot && s.shots === 0, 'bubbles: тап по пушке — пузыри поменялись, выстрела нет');
    // пузыри у красной линии — конец; 2 минуты — конец
    s = spec.create(K.rng(70)); s.g.fill(-1);
    for (let r = 0; r <= C.LOSE - 1; r++) for (let c = 0; c < C.COLS; c++) s.g[r * C.COLS + c] = c < (sh(s, r) ? 8 : 9) ? (r * 2 + c) % 4 : -1;
    s.cur = 4; shoot(s, 160, 380);
    ok(s.over && s.why === 'full', 'bubbles: пузырь встал за красной линией — конец', { why: s.why });
    s = spec.create(K.rng(71)); let n = 0; while (!s.over) { spec.step(s, K.STEP, inp); n++; }
    ok(s.why === 'time' && n === C.TIME, 'bubbles: 2 минуты — конец по времени');
    // каждый 12-й пузырь — бомба
    s = spec.create(K.rng(72)); let bombs = 0;
    for (let i = 0; i < 24; i++) { if (s.cur === C.BOMB) bombs++; s.g.fill(-1); s.want = 1; spec.step(s, K.STEP, inp); s.shot = 0; }
    ok(bombs === 2, 'bubbles: на 24 выстрела — 2 бомбы', bombs);
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('bubbles')}; clearInterval(window.__bot); let held = 0, tx = 0, ty = 0;
      const target = ${target.toString()};
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.bubbles._test, s = T.cur(); if (!s || s.over || s.shots >= ${stopAfter}) return;
        if (held) { __ptr('pointerup', tx, ty); held = 0; return; }
        if (s.shot) return;
        const p = target(s, T.spec.consts); tx = p[0]; ty = p[1];
        __ptr('pointerdown', tx, ty); held = 1;
      }, ${gap}); return 1; })()`,
    gap: 120, stopB: 3,
    endByStop: false,    // 2 минуты (или пузыри у линии) — партия кончается сама
    endMs: 130000,
    field: 'g',
  },
};

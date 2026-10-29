// «Нарезка» (js/games/arcade/slice.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// взмах через овощ (сначала — из заказа), который не задевает камни: [x1, y1, x2, y2] или null
function plan(s, C){
  let bi = -1, bv = -1e9;
  for (let i = 0; i < C.NI; i++) {
    if (s.st[i] !== 1 || s.ty[i] === C.STONE || s.y[i] > C.H - 12 || s.y[i] < 12) continue;
    let inOrd = 0; for (let j = 0; j < 3; j++) if (!(s.ordMask & (1 << j)) && s.ord[j] === s.ty[i]) inOrd = 1;
    const v = inOrd * 100 + s.y[i] / 10 + (s.vy[i] > 0 ? 20 : 0);   // падающие — срочнее
    if (v > bv) { bv = v; bi = i; }
  }
  if (bi < 0) return null;
  const x = s.x[bi] + s.vx[bi] / 30, y = s.y[bi] + s.vy[bi] / 30;
  const clear = (ax, ay, bx, by) => {
    for (let i = 0; i < C.NI; i++) {
      if (s.st[i] !== 1 || s.ty[i] !== C.STONE) continue;
      const ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey;
      let u = ((s.x[i] - ax) * ex + (s.y[i] - ay) * ey) / l; u = Math.max(0, Math.min(1, u));
      if (Math.hypot(s.x[i] - ax - u * ex, s.y[i] - ay - u * ey) < C.CUT + 14) return false;
    }
    return true;
  };
  if (clear(x - 30, y, x + 30, y)) return [x - 30, y, x + 30, y];
  if (clear(x, y - 30, x, y + 30)) return [x, y - 30, x, y + 30];
  return null;
}

module.exports = {
  bot(K, spec, gap = 8){
    const T = K.T, C = spec.consts;
    let last = -1e9, w = null;
    return (s, k, push) => {
      if (s.over) return;
      if (w) { push(T.MOVE, w[2], w[3], 0); push(T.UP, w[2], w[3], 0); w = null; return; }
      if (k - last < gap) return;
      w = plan(s, C);
      if (!w) return;
      last = k;
      push(T.DOWN, w[0], w[1], 0);
    };
  },
  maxMs: 130000,
  garbage: { gap: 8, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 };
    const send = (s, type, x, y) => { ev.type = type; ev.x = x; ev.y = y; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP); };
    const put = (s, i, ty, x, y) => { s.st[i] = 1; s.ty[i] = ty; s.x[i] = x; s.y[i] = y; s.vx[i] = 0; s.vy[i] = 0; s.age[i] = 0; };

    // старт: 1,5 с без нажатий — первые овощи ещё в воздухе, ❤ целы
    let s = spec.create(K.rng(81));
    stepN(s, 90);
    ok(!s.over && s.hearts === C.HEARTS, 'slice: 1,5 с без нажатий — партия идёт, ❤ целы');
    // тап без взмаха не режет; взмах через овощ — режет
    s = spec.create(K.rng(82)); s.wave = 1e9;
    put(s, 0, 1, 160, 200);
    send(s, T.DOWN, 160, 200); send(s, T.UP, 160, 200);
    ok(s.st[0] === 1 && s.cuts === 0, 'slice: тап по овощу без взмаха — не режет');
    send(s, T.DOWN, 120, 205); send(s, T.MOVE, 200, 205);
    ok(s.st[0] === 2 && s.cuts === 1, 'slice: взмах через овощ — разрезан');
    // заказ: овощ из заказа — 2 очка, весь заказ — +10 и новый
    s = spec.create(K.rng(83)); s.wave = 1e9;
    const o = Array.from(s.ord);
    put(s, 0, o[0], 60, 100); put(s, 1, o[1], 160, 100); put(s, 2, o[2], 260, 100);
    send(s, T.DOWN, 20, 100); send(s, T.MOVE, 110, 100); send(s, T.UP, 0, 0);
    ok(s.score === 2 && s.ordMask === 1, 'slice: овощ из заказа — 2 очка', { score: s.score, mask: s.ordMask });
    send(s, T.DOWN, 120, 100); send(s, T.MOVE, 300, 100);
    ok(s.soups === 1 && s.score === 2 + 4 + 10 && s.ordMask === 0, 'slice: заказ собран — +10, новый заказ', { score: s.score });
    // три овоща одним взмахом — бонус (+1 за третий)
    s = spec.create(K.rng(84)); s.wave = 1e9; s.ord.fill(9);
    put(s, 0, 0, 60, 300); put(s, 1, 1, 160, 300); put(s, 2, 2, 260, 300);
    send(s, T.DOWN, 20, 300); send(s, T.MOVE, 300, 300);
    ok(s.cuts === 3 && s.score === 4 && s.best === 3, 'slice: 3 овоща одним взмахом — 3 + 1 бонус', { score: s.score });
    // камень: минус ❤; три камня — конец (один раз, без второго «конца»)
    s = spec.create(K.rng(85)); s.wave = 1e9;
    put(s, 0, C.STONE, 160, 200); send(s, T.DOWN, 100, 200); send(s, T.MOVE, 220, 200); send(s, T.UP, 0, 0);
    ok(s.hearts === C.HEARTS - 1 && s.cuts === 0, 'slice: разрезал камень — минус ❤');
    put(s, 1, C.STONE, 100, 300); put(s, 2, C.STONE, 200, 300); put(s, 3, 0, 260, 300);
    send(s, T.DOWN, 60, 300); send(s, T.MOVE, 300, 300); stepN(s, 1);
    ok(s.over && s.hearts === 0 && s.why === 'hearts', 'slice: ❤ кончились — конец', { hearts: s.hearts, over: s.over });
    // упавший неразрезанный овощ — минус ❤, упавший камень — нет
    s = spec.create(K.rng(86)); s.wave = 1e9;
    put(s, 0, 2, 100, 200); put(s, 1, C.STONE, 200, 200);
    stepN(s, 60);
    ok(s.hearts === C.HEARTS - 1 && s.st[0] === 0 && s.st[1] === 0, 'slice: упал овощ — минус ❤, упал камень — без штрафа', { hearts: s.hearts });
    // тяжесть — в секунду²: за 0,5 с скорость выросла на G0 / 2
    s = spec.create(K.rng(87)); s.wave = 1e9; put(s, 0, 0, 160, 300); s.vy[0] = -600; stepN(s, 30);
    ok(Math.abs(s.vy[0] - (-600 + C.G0 * .5)) < 1e-9, 'slice: тяжесть G0 в секунду²', s.vy[0]);
    // 2 минуты — конец по времени
    s = spec.create(K.rng(88)); s.wave = 1e9; stepN(s, C.TIME);
    ok(s.over && s.why === 'time' && s.hearts === C.HEARTS, 'slice: 2 минуты — конец по времени');
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('slice')}; clearInterval(window.__bot); let w = null;
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.slice._test, s = T.cur(); if (!s || s.over || s.cuts >= ${stopAfter}) return;
        const C = T.spec.consts;
        if (w) { if (T.inst()?.run?.inp.down) { __ptr('pointermove', w[2], w[3]); __ptr('pointerup', w[2], w[3]); w = null; } return; }
        let bi = -1, bv = -1e9;
        for (let i = 0; i < C.NI; i++) { if (s.st[i] !== 1 || s.ty[i] === C.STONE || s.y[i] > C.H - 12 || s.y[i] < 12) continue; const v = s.y[i] + (s.vy[i] > 0 ? 200 : 0); if (v > bv) { bv = v; bi = i; } }
        if (bi < 0) return;
        const x = s.x[bi] + s.vx[bi] / 12, y = s.y[bi] + s.vy[bi] / 12;
        for (let i = 0; i < C.NI; i++) if (s.st[i] === 1 && s.ty[i] === C.STONE && Math.abs(s.y[i] - y) < 50 && Math.abs(s.x[i] - x) < 70) return;
        w = [x - 30, y, x + 30, y];
        __ptr('pointerdown', w[0], w[1]);
      }, ${gap}); return 1; })()`,
    gap: 40, stopB: 2,
    endByStop: true,     // бот перестал — овощи падают, ❤ кончаются
    endMs: 30000,
    field: 'rs',
  },
};

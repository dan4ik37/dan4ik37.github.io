// «Защити стрим» (js/games/arcade/shield.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// стенка для ближайшего к стриму бота, которому её ещё не рисовали (done[i] — шаг, когда рисовали; 0 — слот свободен):
// поперёк его пути, в D единицах от центра стрима; [x1, y1, x2, y2, i] или null
function wall(s, C, done, k, D = 72, L = 36){
  let bi = -1, bd = 1e9;
  for (let i = 0; i < C.NB; i++) {
    if (s.st[i] !== 1) { done[i] = 0; continue; }
    if (s.stuck[i] || (done[i] && k - done[i] < 240)) continue;
    const d = Math.hypot(s.bx[i] - C.CX, s.by[i] - C.CY);
    if (d > D + 14 && d < bd) { bd = d; bi = i; }
  }
  if (bi < 0 || bd > 240) return null;
  const ux = (s.bx[bi] - C.CX) / bd, uy = (s.by[bi] - C.CY) / bd, px = C.CX + ux * D, py = C.CY + uy * D;
  return [px - uy * L, py + ux * L, px + uy * L, py - ux * L, bi];
}

module.exports = {
  // раз в gap шагов: палец вниз в начале стенки, на следующем шаге — к её концу и вверх
  bot(K, spec, gap = 24){
    const T = K.T, C = spec.consts;
    let last = -1e9, w = null;
    const done = new Float64Array(C.NB);
    return (s, k, push) => {
      if (s.over) return;
      if (w) { push(T.MOVE, w[2], w[3], 0); push(T.UP, w[2], w[3], 0); w = null; return; }
      if (k - last < gap) return;
      w = wall(s, C, done, k + 1);
      if (!w) return;
      last = k; done[w[4]] = k + 1;
      push(T.DOWN, w[0], w[1], 0);
    };
  },
  maxMs: 100000,
  garbage: { gap: 24, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, M = C.MAXP - 1;
    const send = (s, type, x, y) => { ev.type = type; ev.x = x; ev.y = y; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP); };
    const segs = s => { let n = 0; for (let j = 0; j < C.MAXP; j++) if (s.link[j] && s.born[j] >= s.t - C.LIFE && s.born[(j - 1) & M] >= s.t - C.LIFE) n++; return n; };

    // старт: 1,5 с без нажатий — эфир идёт
    let s = spec.create(K.rng(71));
    stepN(s, 90);
    ok(!s.over && s.hearts === C.HEARTS, 'shield: 1,5 с без нажатий — эфир идёт, ❤ целы');
    // линия: точки не чаще STEPD, чернила тратятся по длине
    s = spec.create(K.rng(72));
    send(s, T.DOWN, 20, 40); send(s, T.MOVE, 24, 40); send(s, T.MOVE, 60, 40); send(s, T.MOVE, 100, 40); send(s, T.UP, 100, 40);
    ok(segs(s) === 2 && Math.abs(s.ink - (C.INK - 80)) < 1e-9, 'shield: штрих 80 единиц — 2 отрезка, чернила −80', { segs: segs(s), ink: s.ink });
    // на экран стрима рисовать нельзя (прототип: обвёл — и защищён навсегда)
    send(s, T.DOWN, C.CX, C.CY); send(s, T.MOVE, C.CX + 30, C.CY); send(s, T.UP, 0, 0);
    ok(segs(s) === 2, 'shield: на экране стрима линия не рисуется');
    // чернил мало — отрезка нет; чернила пополняются
    s = spec.create(K.rng(73)); s.ink = 30;
    send(s, T.DOWN, 20, 40); send(s, T.MOVE, 60, 40); send(s, T.UP, 60, 40);
    ok(segs(s) === 0 && s.ink === 30, 'shield: чернил не хватает — отрезка нет');
    stepN(s, 60);
    ok(Math.abs(s.ink - (30 + C.INKV)) < 1e-6, 'shield: чернила пополняются INKV в секунду', s.ink);
    // стенка живёт LIFE шагов
    s = spec.create(K.rng(74)); send(s, T.DOWN, 20, 40); send(s, T.MOVE, 60, 40); send(s, T.UP, 0, 0);
    stepN(s, C.LIFE - 1); const alive = segs(s); stepN(s, 2);
    ok(alive === 1 && segs(s) === 0, 'shield: стенка тает через 5 с');
    // бот упёрся в стенку — через GIVE шагов отписывается (+5); без стенки — долетает и снимает ❤
    s = spec.create(K.rng(75)); s.spawnT = 1e9;
    s.st[0] = 1; s.bx[0] = C.CX; s.by[0] = 30;
    send(s, T.DOWN, C.CX - 40, 120); send(s, T.MOVE, C.CX + 40, 120); send(s, T.UP, 0, 0);
    let n = 0; while (s.st[0] === 1 && n < 600) { spec.step(s, K.STEP); n++; }
    ok(s.st[0] === 2 && s.gone === 1 && s.hearts === C.HEARTS && s.by[0] < 120, 'shield: бот упёрся в стенку и отписался, стрим цел', { st: s.st[0], n, y: s.by[0] });
    ok(s.score === 5 + 2 * Math.floor(s.t / 60), 'shield: +5 за отбитого бота и +2 за секунду эфира', s.score);
    s = spec.create(K.rng(76)); s.spawnT = 1e9; s.st[0] = 1; s.bx[0] = C.CX; s.by[0] = 30;
    n = 0; while (s.st[0] === 1 && n < 600) { spec.step(s, K.STEP); n++; }
    ok(s.st[0] === 0 && s.hearts === C.HEARTS - 1 && s.flash > 0, 'shield: бот без стенки долетел — минус ❤', { hearts: s.hearts, n });
    // 3 ❤ — конец без бонуса; 90 с — конец с бонусом 50 за ❤
    s = spec.create(K.rng(77)); n = 0; while (!s.over) { spec.step(s, K.STEP); n++; }
    ok(s.why === 'bots' && s.hearts <= 0 && n < C.TIME, 'shield: без стенок спам захватывает стрим', { why: s.why, n });
    s = spec.create(K.rng(78)); s.spawnT = 1e9; stepN(s, C.TIME);
    ok(s.over && s.why === 'time' && s.score === 2 * 90 + 50 * C.HEARTS, 'shield: 90 с эфира — конец, 2 × 90 + 50 × 3', s.score);
    // кольцо точек: новая точка поверх старой не «склеивается» со старым штрихом
    s = spec.create(K.rng(79)); s.ink = 1e9;
    send(s, T.DOWN, 10, 10);
    for (let i = 0; i < C.MAXP + 5; i++) send(s, T.MOVE, 10 + ((i + 1) % 2) * 9, 10 + Math.floor((i + 1) / 2) * .1);
    send(s, T.UP, 0, 0); send(s, T.DOWN, 300, 400); send(s, T.MOVE, 300, 380);
    let bad = 0; for (let j = 0; j < C.MAXP; j++) if (s.link[j]) { const a = (j - 1) & M; if (Math.hypot(s.px[j] - s.px[a], s.py[j] - s.py[a]) > 25) bad++; }
    ok(bad === 0, 'shield: в кольце точек нет отрезков между чужими точками', bad);
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('shield')}; clearInterval(window.__bot); let w = null; const done = new Float64Array(64);
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.shield._test, s = T.cur(); if (!s || s.over || s.gone >= ${stopAfter}) return;
        const C = T.spec.consts;
        if (w) { if (T.inst()?.run?.inp.down) { __ptr('pointermove', w[2], w[3]); __ptr('pointerup', w[2], w[3]); w = null; } return; }
        let bi = -1, bd = 1e9;
        for (let i = 0; i < C.NB; i++) { if (s.st[i] !== 1) { done[i] = 0; continue; } if (s.stuck[i] || (done[i] && s.t - done[i] < 240)) continue; const d = Math.hypot(s.bx[i] - C.CX, s.by[i] - C.CY); if (d > 86 && d < bd) { bd = d; bi = i; } }
        if (bi < 0 || bd > 240) return;
        const ux = (s.bx[bi] - C.CX) / bd, uy = (s.by[bi] - C.CY) / bd, px = C.CX + ux * 72, py = C.CY + uy * 72;
        w = [px - uy * 36, py + ux * 36, px + uy * 36, py - ux * 36]; done[bi] = s.t || 1;
        __ptr('pointerdown', w[0], w[1]);
      }, ${gap}); return 1; })()`,
    gap: 90, stopB: 2,
    endByStop: true,     // бот перестал рисовать — спам долетает, 3 ❤ кончаются
    endMs: 40000,
    field: 'rs',
  },
};

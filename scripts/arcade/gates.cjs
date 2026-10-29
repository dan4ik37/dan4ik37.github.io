// «Ворота с числами» (js/games/arcade/gates.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
const apply = (op, v, n) => (op === 0 ? n + v : op === 1 ? n - v : op === 2 ? n * v : Math.floor(n / v));
// лучшие ворота следующего ряда для n светлячков; worst — худшие (ошибка бота)
function pick(s, worst){
  const r = s.row, k = s.cnt[r], b = r * 3;
  if (!k) return -1;
  let bi = 0, bv = worst ? 1e18 : -1e18;
  for (let i = 0; i < k; i++) { const v = apply(s.op[b + i], s.val[b + i], s.n); if (worst ? v < bv : v > bv) { bv = v; bi = i; } }
  return (bi + .5) * 320 / k;
}

module.exports = {
  // палец ведёт фонарик к лучшим воротам следующего ряда (раз в gap шагов)
  bot(K, spec, gap = 4){
    const T = K.T;
    let last = -1e9, down = false;
    return (s, k, push) => {
      if (s.over || k - last < gap || s.row >= spec.consts.ROWS) return;
      last = k;
      const x = pick(s, false);
      if (x < 0) return;
      if (!down) { push(T.DOWN, x, 380, 0); down = true; } else push(T.MOVE, x, 380, 0);
    };
  },
  maxMs: 60000,
  garbage: { gap: 4, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const move = (s, x) => { ev.type = T.MOVE; ev.x = x; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const toRow = s => { const r = s.row; while (!s.over && s.row === r) spec.step(s, K.STEP, inp); };

    // старт: первые ворота далеко — 2 с без нажатий ничего не случается
    let s = spec.create(K.rng(51));
    stepN(s, 120);
    ok(!s.over && s.row === 0 && s.n === C.START, 'gates: 2 с после старта — ворот ещё не было, 5 светлячков', { row: s.row, d: s.d });
    // скорость дороги — за секунду: 1 с = V0..V1 единиц
    const d0 = s.d; stepN(s, 60);
    ok(s.d - d0 > C.V0 * .999 && s.d - d0 < C.V0 * 1.1, 'gates: дорога едет ~V0 единиц в секунду', s.d - d0);
    // ворота под фонариком: левые / правые
    s = spec.create(K.rng(52));
    const b = 0, lv = apply(s.op[b], s.val[b], 5);
    move(s, 30); toRow(s);
    ok(s.took[0] === 0 && s.n === Math.max(0, lv), 'gates: фонарик слева — левые ворота', { n: s.n, lv });
    s = spec.create(K.rng(52)); move(s, 290); toRow(s);
    ok(s.took[0] === 1 && s.n === Math.max(0, apply(s.op[1], s.val[1], 5)), 'gates: фонарик справа — правые ворота');
    // путь «всегда лучшее» = s.best (оптимум, генератор его же считает), «всегда худшее» — светлячки гаснут
    let bad = 0, maxBest = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const q = spec.create(K.rng(seed * 101));
      while (!q.over) { const x = pick(q, false); if (x >= 0) q.tx = x; spec.step(q, K.STEP, inp); }
      if (q.why !== 'lamp' || q.n !== q.best || q.score !== q.best) bad++;
      maxBest = Math.max(maxBest, q.best);
    }
    ok(bad === 0, 'gates: 400 путей «всегда лучшие ворота» — дошёл до фонаря ровно с s.best', bad);
    ok(maxBest <= 20000, 'gates: лучший путь не больше 20 000 светлячков (предел сервера 30 000)', maxBest);
    s = spec.create(K.rng(53));
    while (!s.over) { const x = pick(s, true); if (x >= 0) s.tx = x; spec.step(s, K.STEP, inp); }
    ok(s.over && s.why === 'out' && s.score === 0, 'gates: всегда худшие ворота — светлячки гаснут, 0', { why: s.why, row: s.row });
    // туча — каждые 8 рядов на всю ширину
    s = spec.create(K.rng(54));
    ok(s.cnt[7] === 0 && s.cnt[15] === 0 && s.cnt[23] === 0 && s.cnt[12] === 3 && s.cnt[3] === 2, 'gates: туча — ряды 8, 16, 24; с 13-го ряда трое ворот');
    // клавиши: → двигает фонарик KEYV в секунду
    s = spec.create(K.rng(55)); inp.keys = 2; const h0 = s.hx; stepN(s, 15); inp.keys = 0;
    ok(Math.abs((s.hx - h0) - C.KEYV * .25) < 1e-6, 'gates: → — фонарик KEYV единиц в секунду', s.hx - h0);
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('gates')}; clearInterval(window.__bot);
      const ap = (o, v, n) => (o === 0 ? n + v : o === 1 ? n - v : o === 2 ? n * v : Math.floor(n / v));
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.gates._test, s = T.cur(); if (!s || s.over || s.row >= ${stopAfter} || s.row >= 24) return;
        const r = s.row, k = s.cnt[r], b = r * 3; if (!k) return;
        let bi = 0, bv = -1e18; for (let i = 0; i < k; i++) { const v = ap(s.op[b + i], s.val[b + i], s.n); if (v > bv) { bv = v; bi = i; } }
        const x = (bi + .5) * 320 / k;
        if (!T.inst()?.run?.inp.down) __ptr('pointerdown', x, 380); else __ptr('pointermove', x, 380);
      }, ${gap}); return 1; })()`,
    gap: 60, stopB: 3,
    endByStop: false,    // путь кончается сам (фонарь) — ~40 с
    endMs: 60000,
    field: 'val',
  },
};

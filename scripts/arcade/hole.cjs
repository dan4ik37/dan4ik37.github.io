// «Чёрная дыра» (js/games/arcade/hole.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// самая выгодная съедобная цель: очки / (расстояние + 40)
function target(s, C){
  let bi = -1, bv = -1;
  for (let i = 0; i < C.N; i++) {
    const r = C.TR[s.ot[i]];
    if (s.wait[i] || r >= s.r * .85 || s.fade[i] > C.FADE / 2) continue;
    const dx = s.ox[i] - s.hx, dy = s.oy[i] - s.hy, v = C.TV[s.ot[i]] / (Math.sqrt(dx * dx + dy * dy) + 40);
    if (v > bv) { bv = v; bi = i; }
  }
  return bi;
}

module.exports = {
  bot(K, spec, gap = 6){
    const T = K.T, C = spec.consts;
    let last = -1e9, down = false;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      last = k;
      const i = target(s, C);
      if (i < 0) return;
      const x = s.ox[i], y = s.oy[i] + C.OFF;
      if (!down) { push(T.DOWN, x, y, 0); down = true; } else push(T.MOVE, x, y, 0);
    };
  },
  maxMs: 100000,
  garbage: { gap: 6, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const near = s => { let m = 1e9; for (let i = 0; i < C.N; i++) { const dx = s.ox[i] - s.hx, dy = s.oy[i] - s.hy; m = Math.min(m, Math.sqrt(dx * dx + dy * dy) - C.TR[s.ot[i]]); } return m; };

    let s = spec.create(K.rng(61));
    ok(near(s) > s.r + 40, 'hole: на старте рядом с дырой ничего нет (прототип: предметы прямо под дырой)', near(s));
    stepN(s, 120);
    ok(!s.over && s.t === C.TIME - 120, 'hole: 2 с без нажатий — время идёт, конца нет');
    // дыра плывёт к пальцу (с поправкой OFF вверх) со скоростью HV
    s = spec.create(K.rng(62)); s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    ev.type = T.DOWN; ev.x = s.hx; ev.y = 50 + C.OFF; spec.input(s, ev, inp);
    const y0 = s.hy; stepN(s, 30);
    ok(Math.abs((y0 - s.hy) - C.HV * .5) < 1e-6 && s.ty === 50, 'hole: дыра плывёт HV единиц в секунду к точке выше пальца', y0 - s.hy);
    // проглотить мелочь: +очки, дыра больше, новый предмет — вдали
    s = spec.create(K.rng(63)); s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    s.ot[0] = 1; s.ox[0] = s.hx + 3; s.oy[0] = s.hy; s.fade[0] = 0; s.tx = s.hx; s.ty = s.hy;
    const r0 = s.r; stepN(s, 1);
    ok(s.score === C.TV[1] && s.eaten === 1 && s.r > r0 && s.wait[0] === C.WAIT, 'hole: астероид проглочен — +2, дыра выросла, место пустует', { score: s.score, r: s.r });
    stepN(s, C.WAIT);
    const dx = s.ox[0] - s.hx, dy = s.oy[0] - s.hy;
    ok(!s.wait[0] && (s.ot[0] === 3 || Math.sqrt(dx * dx + dy * dy) > s.r + C.TR[s.ot[0]] + 69), 'hole: через 2 с новый предмет появился вдали от дыры');
    // притяжение: мелочь рядом подтягивается
    s = spec.create(K.rng(64)); s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    s.ot[0] = 0; s.ox[0] = s.hx + s.r + 20; s.oy[0] = s.hy; s.fade[0] = 0; s.tx = s.hx; s.ty = s.hy;
    stepN(s, 40);
    ok(s.eaten === 1, 'hole: пылинка рядом притянулась и проглочена');
    // больше дыры — не глотается, дыру отталкивает
    s = spec.create(K.rng(65)); s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    s.ot[0] = 7; s.ox[0] = 160; s.oy[0] = 200; s.fade[0] = 0; s.hx = 160; s.hy = 280; s.tx = 160; s.ty = 200;
    stepN(s, 60);
    const gap = Math.hypot(s.hx - 160, s.hy - 200);
    ok(s.eaten === 0 && gap > s.r + C.TR[7] * .7 - 1, 'hole: звезда больше дыры — не проглочена, дыру отталкивает', { gap, eaten: s.eaten });
    // ☄️ комета: +3 с
    s = spec.create(K.rng(66)); s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    s.r = 30; s.ot[0] = 3; s.ox[0] = s.hx + 2; s.oy[0] = s.hy; s.fade[0] = 0; s.tx = s.hx; s.ty = s.hy;
    const t0 = s.t; stepN(s, 1);
    ok(s.comets === 1 && s.t === t0 - 1 + 180, 'hole: комета проглочена — +3 секунды', { t: s.t, t0 });
    // дыра не больше RMAX
    s = spec.create(K.rng(67)); s.r = C.RMAX - .1; s.ox.fill(-500); s.oy.fill(-500); s.vx.fill(0); s.vy.fill(0);
    s.ot[0] = 6; s.ox[0] = s.hx; s.oy[0] = s.hy; s.fade[0] = 0; s.tx = s.hx; s.ty = s.hy; stepN(s, 1);
    ok(s.r === C.RMAX, 'hole: дыра не растёт больше RMAX (поле не закрывается)', s.r);
    // минута — конец
    s = spec.create(K.rng(68)); let n = 0; while (!s.over) { spec.step(s, K.STEP, inp); n++; }
    ok(n === C.TIME && s.t === 0, 'hole: без комет — ровно минута', n);
    // 500 появлений: никогда не рядом с дырой
    s = spec.create(K.rng(69)); let bad = 0;
    for (let k = 0; k < 500; k++) {
      s.hx = 20 + (k * 37) % 280; s.hy = 20 + (k * 53) % 400; s.r = 14 + k % 40; s.tx = s.hx; s.ty = s.hy; s.over = false; s.t = 1000;
      s.wait[0] = 1; spec.step(s, K.STEP, inp);
      if (s.ot[0] !== 3) { const ddx = s.ox[0] - s.hx, ddy = s.oy[0] - s.hy; if (Math.sqrt(ddx * ddx + ddy * ddy) < s.r + C.TR[s.ot[0]] + 10) bad++; }
    }
    ok(bad === 0, 'hole: 500 появлений — ни одного прямо у дыры', bad);
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('hole')}; clearInterval(window.__bot);
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.hole._test, s = T.cur(); if (!s || s.over) return;
        const C = T.spec.consts;
        if (s.eaten >= ${stopAfter}) { if (T.inst()?.run?.inp.down) __ptr('pointerup', s.hx, s.hy); return; }
        let bi = -1, bv = -1;
        for (let i = 0; i < C.N; i++) { const r = C.TR[s.ot[i]]; if (s.wait[i] || r >= s.r * .85 || s.fade[i] > C.FADE / 2) continue;
          const dx = s.ox[i] - s.hx, dy = s.oy[i] - s.hy, v = C.TV[s.ot[i]] / (Math.sqrt(dx * dx + dy * dy) + 40); if (v > bv) { bv = v; bi = i; } }
        if (bi < 0) return;
        if (!T.inst()?.run?.inp.down) __ptr('pointerdown', s.ox[bi], s.oy[bi] + C.OFF); else __ptr('pointermove', s.ox[bi], s.oy[bi] + C.OFF);
      }, ${gap}); return 1; })()`,
    gap: 90, stopB: 3,
    endByStop: false,    // минута — партия кончается сама
    endMs: 70000,
    field: 'ot',
  },
};

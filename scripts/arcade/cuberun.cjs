// «Кубик-бегун» (js/games/arcade/cuberun.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// jump so that the flight is centred over a cactus group; jump early onto crates (they are tall)
function decide(s, C, m){
  if (!s.started) return 1;
  if (!s.ground) return 0;
  const M = C.RING - 1, v = s.spd, lead = m.lead || 0;
  for (let i = s.first; i < s.count; i++) {
    const j = i & M, x = s.ox[j], w = s.ow[j];
    if (x + w <= C.CX) continue;
    const top = C.GY - s.oh[j];
    if (s.ok[j] === 2 && s.y + C.CS <= top + .5) continue;      // already on (or above) this crate
    const d = x - (C.CX + C.CS);
    if (s.ok[j] === 1) return d <= (v * C.T_AIR - w - C.CS) / 2 + lead ? 1 : 0;
    return d <= v * .2 + 4 + lead ? 1 : 0;
  }
  return 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 220, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    let s = spec.create(K.rng(51));
    const x0 = s.ox[0];
    E.steps(s, 180);
    ok(!s.over && !s.started && s.ox[0] === x0 && s.t === 0, 'cuberun: before the first tap nothing moves and the run does not end (3 s)');
    E.tap(s, 1, 1);
    ok(s.started && s.vy === C.JUMP && !s.over, 'cuberun: the first tap starts the run and jumps (not the end)');
    E.steps(s, 1); ok(!s.over, 'cuberun: the first step after the start is not the end');
    const n = E.steps(s, 600);
    ok(s.over && s.why === 'hit' && n > 90 && n < 140, 'cuberun: no more taps — the first cactus stops the cube after ~2 s', { why: s.why, n });
    // speed per second
    s = spec.create(K.rng(52)); E.tap(s); const a0 = s.ox[0]; E.steps(s, 30);
    ok(Math.abs(a0 - s.ox[0] - C.V0 * .5) < 1e-9, 'cuberun: obstacles move V0 units per second', a0 - s.ox[0]);
    // jump buffer: a tap 0.1 s before landing is not lost — the cube jumps on the landing step
    s = spec.create(K.rng(53)); E.tap(s);
    let k = 0; while (!(s.vy > 0 && s.y + C.CS + s.vy * .1 >= C.GY)) { spec.step(s, K.STEP); k++; }
    E.tap(s);   // in the air
    ok(!s.ground && s.jbuf > 0, 'cuberun: a tap in the air is remembered (buffer)');
    let jumped = false; for (let i = 0; i < 12 && !jumped; i++) { spec.step(s, K.STEP); if (s.vy < 0) jumped = true; }
    ok(jumped, 'cuberun: the remembered tap jumps right at landing (prototype lost it)');
    // crates: the cube lands on top and runs on it, then drops back to the sand
    s = spec.create(K.rng(54)); E.tap(s); E.steps(s, 60);
    const j = s.first & M; s.ok[j] = 2; s.ow[j] = 90; s.oh[j] = C.CRH; s.os[j] = 0; s.ox[j] = C.CX + C.CS + 40;
    while (s.vy !== 0 || !s.ground) spec.step(s, K.STEP);
    E.tap(s);
    let onTop = false; for (let i = 0; i < 90 && !s.over; i++) { spec.step(s, K.STEP); if (s.ground && Math.abs(s.y + C.CS - (C.GY - C.CRH)) < 1e-9) onTop = true; }
    ok(onTop && !s.over, 'cuberun: jump onto a crate — the cube runs on top of it', { onTop, over: s.over });
    // feasibility of every generated track: the bot that only follows the physics finishes the 2-minute track on 6 seeds
    let fin = 0, best = 0, minGap = 1e9;
    for (let sd = 1; sd <= 6; sd++) {
      const r = K.sim(spec, { seed: 500 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 });
      if (r.s.why === 'finish') fin++;
      best = Math.max(best, r.score);
    }
    // gaps grow with the speed: always room to land and jump again
    s = spec.create(K.rng(55));
    for (let i = 0; i < 3000; i++) {
      const a = s.count - 1;
      if (s.count >= 2) { const p = (a - 1) & M, q = a & M; minGap = Math.min(minGap, (s.ox[q] - s.ox[p] - s.ow[p]) / Math.min(C.VMAX, s.spd + 25)); }
      s.first = s.count - 2; s.ox[a & M] = 0; s.spd = Math.min(C.VMAX, C.V0 + C.DV * i / 3);
      spec.step(Object.assign(s, { started: true, t: 0, y: -1e6, vy: 0 }), K.STEP);
    }
    ok(fin === 6, 'cuberun: every generated track is passable — the physics bot finishes 2 minutes on 6 seeds', { fin, best });
    ok(minGap >= .66 - 1e-9, 'cuberun: the gap between obstacles is ≥ 0.66 s of running (+30) at the current speed', +minGap.toFixed(3));
    module.exports.maxScore = best;
    ok(best <= 500, 'cuberun: the best bot score fits the server cap (500)', best);
  },
  e2e: {
    bot: e2eBot('cuberun', decide, 'P.tap(160, 220);', 'm.lead = 4;'),
    gap: 16, stopB: 3,
    endByStop: true,
    field: 'ow',
  },
};

// «Дрон» (js/games/arcade/drone.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// flap when the drone falls below the centre of the next gate (+18): it swings between centre − 29 and centre + 20
function decide(s, C){
  if (!s.started) return 1;
  let ty = 210;
  for (let i = s.first; i < s.count; i++) { const j = i & (C.RING - 1); if (s.gx[j] + C.GW > C.DX - C.HR - 4) { ty = s.gy[j]; break; } }
  return s.y > ty + 18 && s.vy > 0 ? 1 : 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T, C) => push(T.DOWN, 160, 220, 0)),
  maxMs: 200000,
  garbage: { gap: 4, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    // start: the drone hovers, nothing moves, the battery does not drain, the run never ends by itself
    let s = spec.create(K.rng(31));
    const gx0 = s.gx[0];
    E.steps(s, 180);
    ok(!s.over && !s.started && s.y === 200 && s.bat === C.BAT0 && s.gx[0] === gx0, 'drone: before the first tap the drone hovers, gates wait, battery full (3 s)');
    E.tap(s, 10, 10);
    ok(s.started && s.vy === C.FLAP && !s.over, 'drone: the first tap starts and flaps (does not end the run)');
    E.steps(s, 1);
    ok(!s.over, 'drone: the first step after the start is not the end');
    // no more taps: falls to the ground in well under a second and a half — by the floor, not by a gate
    let n = E.steps(s, 600);
    ok(s.over && s.why === 'ground' && n > 40 && n < 90, 'drone: without taps it falls to the ground (~1 s)', { why: s.why, n });
    // speeds per second: 0.5 s → the gates moved V0 × 0.5
    s = spec.create(K.rng(32)); E.tap(s, 1, 1);
    const x0 = s.gx[0]; E.steps(s, 30);
    ok(Math.abs((x0 - s.gx[0]) - C.V0 * .5) < 1e-9, 'drone: gates move V0 units per second', x0 - s.gx[0]);
    // soft ceiling: 20 fast taps never end the run, the drone stays inside the field
    s = spec.create(K.rng(33));
    for (let i = 0; i < 20; i++) { E.tap(s, 1, 1); E.steps(s, 2); }
    ok(!s.over && s.y >= C.HR, 'drone: hitting the ceiling is not a crash', { y: s.y, over: s.over });
    // generator: fly a «cheating» drone that sits in the centre of the next gate — it sees hundreds of gates
    s = spec.create(K.rng(35)); E.tap(s, 1, 1);
    let steps = 0, maxShift = 0, outside = 0, boltGates = 0, lastSeen = -1, prev = null;
    while (!s.over && steps < 60 * 400) {
      let ty = 210;
      for (let i = s.first; i < s.count; i++) {
        const j = i & M;
        if (i > lastSeen) { lastSeen = i; if (prev !== null) maxShift = Math.max(maxShift, Math.abs(s.gy[j] - prev)); prev = s.gy[j]; if (s.gy[j] - s.gh[j] < 30 || s.gy[j] + s.gh[j] > C.GROUND - 20) outside++; if (s.gb[j]) boltGates++; }
      }
      for (let i = s.first; i < s.count; i++) { const j = i & M; if (s.gx[j] + C.GW > C.DX - C.HR) { ty = s.gy[j]; break; } }
      s.y = s.py = ty; s.vy = 0;   // teleport to the centre (theoretical best pilot)
      spec.step(s, K.STEP); steps++;
    }
    ok(maxShift <= C.SHIFT + 1e-9 && outside === 0 && boltGates > 0, 'drone: next gap within reach (shift ≤ SHIFT), gaps inside the field, ⚡ gates exist', { maxShift, outside, boltGates });
    // the perfect pilot: every gate = 2 points (pass + ring), ⚡ always caught — and still the battery runs out (run is finite)
    ok(s.over && s.why === 'bat' && s.score === 2 * s.passed && s.bolts > 0 && steps < 60 * 150, 'drone: perfect pilot — 2 points per gate, ⚡ caught, the battery still runs out (< 150 s)', { score: s.score, passed: s.passed, bolts: s.bolts, secs: +(steps / 60).toFixed(1) });
    module.exports.maxScore = s.score;
    ok(s.score <= 400, 'drone: the best possible score fits the server cap (400)', s.score);
  },
  e2e: {
    bot: e2eBot('drone', decide, 'P.tap(160, 220);'),
    gap: 30, stopB: 3,
    endByStop: true,     // without taps the drone falls within a second
    field: 'gy',
  },
};

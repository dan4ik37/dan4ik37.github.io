// «Зигзаг» (js/games/arcade/zigzag.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// turn when the ball crosses the centre line of the NEXT segment (not the corner height): the small lateral error of a late
// tap does not pile up from corner to corner. m.c — the corner to turn at next; m.lead > 0 — turn that much earlier (browser).
function decide(s, C, m){
  if (!s.started) return 1;
  if (m.wt !== undefined && s.turns < m.wt) return 0;   // the previous tap is not applied yet
  const c = m.c || 1, j = c & (C.RING - 1), g = (s.bx - s.px[j]) + s.dir * (s.py[j] - s.by);
  if (g * s.dir >= -(m.lead || 0)) { m.c = c + 1; m.wt = s.turns + 1; return 1; }
  return 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 220, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    let s = spec.create(K.rng(81));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.by === 0, 'zigzag: before the first tap the ball waits (5 s, no end)');
    E.tap(s);
    ok(s.started && s.dir === 1 && s.turns === 0 && !s.over, 'zigzag: the first tap only starts (no turn, not the end)');
    // speed per second: 0.25 s → V0 × 0.25 up and right
    E.steps(s, 15);
    ok(Math.abs(-s.by - C.V0 * .25) < 1e-9 && Math.abs(s.bx - 160 - C.V0 * .25) < 1e-9, 'zigzag: the ball moves V0 units per second on each axis', { bx: s.bx, by: s.by });
    // no turn: leaves the road soon after the first corner (90 up) — not before it
    const n = E.steps(s, 600);
    ok(s.over && s.why === 'fall' && s.seg >= 1 && n * K.STEP * C.V0 > C.FIRST - C.V0 * .25, 'zigzag: no turn — falls off after the first corner', { seg: s.seg, n });
    // the road check matches the drawn road: a ball HW − 1 from the centre line is on the road, HW + 1 is off
    s = spec.create(K.rng(82)); E.tap(s);
    const p0 = s.px[0], p1 = s.px[1], q1 = s.py[1];
    const nx = (p1 - p0), ny = q1, len = Math.hypot(nx, ny), ux = -ny / len, uy = nx / len;   // normal to the first segment
    const test = off => { const t = spec.create(K.rng(82)); E.tap(t); t.bx = 160 + nx / 2 + ux * off; t.by = q1 / 2 + uy * off; t.pbx = t.bx; t.pby = t.by; t.dir = 1; spec.step(t, 1e-9); return t.over; };
    ok(!test(C.HW - 1) && test(C.HW + 1) && !test(-(C.HW - 1)) && test(-(C.HW + 1)), 'zigzag: off-road = farther than half the drawn road width from the centre line (prototype: ±22 horizontally on a 44-wide stroke)');
    // a turn at the corner light — «точно» +1
    s = spec.create(K.rng(83)); E.tap(s);
    while (s.by - s.py[1] > 2) spec.step(s, K.STEP);
    E.tap(s);
    ok(s.perfect === 1 && s.dir === -1, 'zigzag: a turn within 9 of the corner light — ✨ +1', { perfect: s.perfect });
    // the bot plays the whole track on several seeds — every generated road can be driven at full speed
    let fin = 0, best = 0;
    for (let sd = 1; sd <= 6; sd++) { const r = K.sim(spec, { seed: 800 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); if (r.s.why === 'finish') fin++; best = Math.max(best, r.score); }
    ok(fin === 6, 'zigzag: the turning bot drives every track for 2 minutes (6 seeds)', { fin, best });
    // the line-following driver — and the generator: each new segment ≥ max(36, 0.24·speed) or the room
    // left to the wall, the road never leaves 40…280
    s = spec.create(K.rng(85)); E.tap(s);
    let seen = 1, short = 0, outside = 0;
    const check = () => { for (; seen < s.count - 1; seen++) {
      const a = seen & M, b = (seen + 1) & M, L = s.py[a] - s.py[b], d = seen % 2 ? -1 : 1, room = d > 0 ? C.XMAX - s.px[a] : s.px[a] - C.XMIN;
      const lmin = Math.max(C.LMIN, C.LK * Math.min(C.VMAX, C.V0 + C.DV * seen));
      if (L < Math.min(lmin, room) - 1e-9) short++;
      if (s.px[b] < C.XMIN - 1e-9 || s.px[b] > C.XMAX + 1e-9) outside++;
    } };
    const mm = {};
    while (!s.over) { check(); if (decide(s, C, mm)) E.tap(s); spec.step(s, K.STEP); }
    ok(short === 0 && outside === 0 && seen > 200, 'zigzag: segments are never shorter than max(36, 0.24·speed) (prototype: 20 at any speed), the road stays in the field', { short, outside, seen });
    ok(s.why === 'finish' && s.score <= 800, 'zigzag: exact turns for 2 minutes — the score fits the server cap (800)', { why: s.why, score: s.score, perfect: s.perfect });
    module.exports.maxScore = s.score;
  },
  e2e: {
    bot: e2eBot('zigzag', decide, 'P.tap(160, 220);', 'm.lead = 4;'),
    gap: 10, stopB: 6,
    endByStop: true,
    field: 'px',
  },
};

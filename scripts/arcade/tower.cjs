// «Башня» (js/games/arcade/tower.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// drop when the block is over the tower top (window ±tol); every 6th floor a little off so the tower narrows
function decide(s, C, m){
  if (!s.started) return Math.abs(s.x - C.X0) < 6 ? 1 : 0;
  const tx = s.fx[s.floors & (C.RING - 1)], off = s.floors % 6 === 5 ? 9 : 0, tol = m.tol || 2.5;
  return Math.abs(s.x - (tx + off)) <= tol ? 1 : 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 220, 0)),
  maxMs: 500000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    // before the first tap the block slides, the crane does not lower, the run never ends by itself
    let s = spec.create(K.rng(41));
    E.steps(s, 600);
    ok(!s.over && !s.started && s.drop === 0 && s.floors === 0, 'tower: before the first tap the block only slides (10 s, no crane, no end)');
    // the first drop can never miss: the base is 160 wide in the middle, the block slides over 0…160
    let worst = 1e9;
    for (let sd = 1; sd <= 60; sd++) { const t = spec.create(K.rng(sd)); E.steps(t, sd * 7 + 12); E.tap(t, 1, 1); worst = Math.min(worst, t.over ? -1 : t.fw[1]); }
    ok(worst >= 80, 'tower: the very first tap never ends the run (overlap ≥ 80 for any moment)', worst);
    // the block bounces exactly at the edges: never outside the field
    s = spec.create(K.rng(42)); let out = 0;
    for (let i = 0; i < 3000; i++) { spec.step(s, K.STEP); if (s.x < -1e-9 || s.x + s.w > C.W + 1e-9) out++; }
    ok(out === 0, 'tower: the sliding block never leaves the field (exact bounce at the walls)', out);
    // speed per second: 0.25 s → V0 × 0.25 (away from the walls)
    s = spec.create(K.rng(43)); s.x = 20; s.dir = 1; const x0 = s.x; E.steps(s, 15);
    ok(Math.abs(s.x - x0 - C.V0 * .25) < 1e-9, 'tower: the block moves V0 units per second', s.x - x0);
    // perfect drop: +2, same width; an offset drop: +1, the overhang is cut and falls
    s = spec.create(K.rng(44)); s.x = C.X0 + 2; E.tap(s);
    ok(s.score === 2 && s.fw[1] === C.W0 && s.fx[1] === C.X0 && s.perfect === 1, 'tower: drop within ±3.5 — ⭐ +2, width kept, snapped', { score: s.score, w: s.fw[1] });
    E.steps(s, 12); s.x = C.X0 + 30; E.tap(s);
    ok(s.score === 3 && Math.abs(s.fw[2] - (C.W0 - 30)) < 1e-9 && s.chipW === 30, 'tower: drop 30 off — +1, the tower is 30 narrower, the cut piece falls', { score: s.score, w: s.fw[2], chip: s.chipW });
    E.tap(s);
    ok(s.floors === 2 && !s.over, 'tower: a double tap right after a drop does not drop the next block (cool-down)', { floors: s.floors });
    E.steps(s, 12);
    s.x = C.X0 + 30 + s.fw[2] - 2; E.tap(s);
    ok(s.over && s.why === 'miss', 'tower: overlap under MINW — the block falls, run over');
    // the crane: after the start, with no taps the block is dropped automatically after LT0 seconds
    s = spec.create(K.rng(45)); s.x = C.X0; E.tap(s);
    const n = E.steps(s, Math.round(C.LT0 * 60) + 2);
    ok(s.floors === 2 && n <= Math.round(C.LT0 * 60) + 2, 'tower: no tap — the crane puts the block by itself after ~4.5 s', { floors: s.floors, n });
    // idle player: the crane keeps dropping wherever the block is — the run always ends (⚔️ opponent who stopped playing)
    let ends = 0, maxSecs = 0;
    for (let sd = 1; sd <= 20; sd++) { const t = spec.create(K.rng(100 + sd)); t.x = C.X0; E.tap(t); const k = E.steps(t, 60 * 600); if (t.over) ends++; maxSecs = Math.max(maxSecs, k / 60); }
    ok(ends === 20 && maxSecs < 300, 'tower: an idle player always loses (crane drops), 20 seeds', { ends, maxSecs: +maxSecs.toFixed(1) });
    // the roof: 100 perfect floors — run over, «top», 200 points (= the server cap)
    s = spec.create(K.rng(46));
    while (!s.over) { s.x = s.fx[s.floors & M]; E.tap(s); E.steps(s, 12); }
    ok(s.why === 'top' && s.floors === C.TOP && s.score === 200, 'tower: 100 perfect floors — roof, run over, 200 points (max)', { why: s.why, floors: s.floors, score: s.score });
    module.exports.maxScore = s.score;
  },
  e2e: {
    bot: e2eBot('tower', decide, 'P.tap(160, 220);', 'm.tol = 7;'),   // browser timers tick every 16–30 ms: a wider window
    gap: 16, stopB: 3,
    endByStop: true,     // without taps the crane drops blocks wherever they are — the tower soon misses
    endMs: 120000,
    field: 'fx',
    async before(A, ok, cur, sleep){
      const s = await A.ev(`(s => ({ over: s.over, started: s.started, floors: s.floors }))(${cur})`);
      ok(!s.over && !s.started && s.floors === 0, 'tower: after «▶ Начать» the block slides and waits (no crane, not over)', s);
    },
  },
};

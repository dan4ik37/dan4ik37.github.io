// «Прыжки вверх» (js/games/arcade/jumper.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// steer under a branch: rising — the highest branch the jump still reaches that the squirrel can run under before landing;
// falling — the highest branch below the feet. Returns the target x (≥ 1) when it changed, 0 otherwise.
// m.kill — e2e only: after that score run away from every branch (an idle squirrel bounces in place for 2 minutes).
function decide(s, C, m){
  if (!s.started) return 160;
  let tx = -1, best = 1e9;
  if (m.kill && s.score >= m.kill) {          // run to a column with no branch below the feet → the squirrel falls
    for (let q = 0; q < 7 && tx < 0; q++) {
      const cx = 14 + q * 48;
      let hit = false;
      for (let i = s.made - C.RING; i < s.made && !hit; i++) { if (i < 0) continue; const j = i & (C.RING - 1);
        if (s.pon[j] && s.py[j] >= s.y - 40 && cx > s.px[j] - C.HW && cx < s.px[j] + C.PW + C.HW) hit = true; }
      if (!hit) tx = cx;
    }
    if (tx < 0) tx = s.x < C.W / 2 ? C.W - 1 : 1;
  }
  else {
    const apex = s.y - (s.vy < 0 ? s.vy * s.vy / (2 * C.G) : 0);
    for (let i = s.made - C.RING; i < s.made; i++) {
      if (i < 0) continue;
      const j = i & (C.RING - 1), top = s.py[j];
      if (!s.pon[j] || top < apex + 6 || top > s.cam + C.H) continue;
      if (s.vy > 0 && top < s.y - 1) continue;                 // falling: only branches below the feet
      const disc = s.vy * s.vy + 2 * C.G * (top - s.y);
      if (disc < 0) continue;
      const tl = (-s.vy + Math.sqrt(disc)) / C.G, cx = s.px[j] + C.PW / 2;
      if (Math.abs(cx - s.x) > C.VX * tl * .8 + C.PW * .3) continue;   // cannot get under it in time
      if (top < best) { best = top; tx = cx; }
    }
    if (tx < 0) return 0;
  }
  if (m.last !== undefined && Math.abs(m.last - tx) < 2) return 0;
  m.last = tx;
  return tx < 1 ? 1 : tx;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, a, 300, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1, dt = K.STEP;
    let s = spec.create(K.rng(121));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.y === 380 && s.t === 0, 'jumper: before the first tap the squirrel sits on the first branch (5 s, no end)');
    E.tap(s, 160, 300);
    ok(s.started && s.vy === C.VJ && !s.over, 'jumper: the first tap is the first jump (never the end)');
    // per second: 15 steps of the jump → y = 380 + VJ·0.25 + G·dt²·(1 + … + 15)
    E.steps(s, 15);
    ok(Math.abs(s.y - (380 + C.VJ * .25 + C.G * dt * dt * 120)) < 1e-9, 'jumper: gravity and jump speed are per second', s.y);
    // one jump climbs more than the biggest gap between branches
    s = spec.create(K.rng(122)); E.tap(s, 160, 300);
    let top = s.y; for (let k = 0; k < 60; k++) { spec.step(s, dt, null); top = Math.min(top, s.y); }
    ok(380 - top > C.GAPMAX + 30, 'jumper: a jump climbs higher than the biggest gap between branches', 380 - top);
    // branches never out of reach: vertical gap ≤ GAPMAX, sideways ≤ 220 (40 seeds × 400 branches)
    let far = 0, wide = 0, n = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const t = spec.create(K.rng(sd));
      for (let i = 1; i < 400; i++) {
        while (t.made <= i) spec.gen(t);
        const a = (i - 1) & M, b = i & M;
        if (t.py[a] - t.py[b] > C.GAPMAX + 1e-9 || t.py[a] - t.py[b] < C.GAP0 - 1e-9) far++;
        if (Math.abs(t.px[a] - t.px[b]) > 220 + 1e-9) wide++;
        n++;
      }
    }
    ok(far === 0 && wide === 0 && n === 40 * 399, 'jumper: the next branch is always within one jump (gap 55…120 up, ≤ 220 sideways)', { far, wide });
    // a fast fall still lands (crossing the branch top inside one step; prototype: a window by the frame step)
    s = spec.create(K.rng(123)); E.tap(s, 160, 300);
    s.y = 380 - 20; s.vy = 2400; s.x = 160; spec.step(s, dt, null);
    ok(s.vy === C.VJ && s.y === 380, 'jumper: a fast fall (40 units in one step) lands exactly on the branch top', { y: s.y, vy: s.vy });
    // a dry branch: one bounce, then it breaks
    s = spec.create(K.rng(124)); E.tap(s, 160, 300); s.pt[0] = 1; s.y = 378; s.vy = 300; spec.step(s, dt, null);
    ok(s.vy === C.VJ && s.pon[0] === 0, 'jumper: a dry branch gives one jump and breaks');
    // keys: VK units per second
    s = spec.create(K.rng(125)); E.key(s, 1); const x0 = s.x; E.steps(s, 30, { down: false, x: 0, y: 0, keys: 2 });
    ok(s.started && Math.abs(s.x - x0 - C.VK * .5) < 1e-9, 'jumper: → runs VK units per second (keys added; prototype: mouse only)', s.x - x0);
    // an acorn gives +5
    s = spec.create(K.rng(126)); E.tap(s, 160, 300);
    let nj = -1; for (let i = 1; i < s.made; i++) if (s.nut[i & M]) { nj = i & M; break; }
    s.x = s.px[nj] + C.PW / 2; s.y = s.py[nj] - 10; s.vy = 0; spec.step(s, dt, null);
    ok(nj >= 0 && s.nuts === 1 && s.nut[nj] === 0, 'jumper: an acorn — +5', { score: s.score, nuts: s.nuts });
    // idle: the squirrel bounces on the first branch — the run ends after 2 minutes; running off the branches — a fall
    s = spec.create(K.rng(127)); for (let j = 1; j < C.RING; j++) s.pon[j] = 0;   // only the first branch
    E.tap(s, 160, 300);
    const steps = E.steps(s, 121 * 60);
    ok(s.over && s.why === 'time' && steps >= C.LIMIT * 60 - 1, 'jumper: bouncing in place ends after 2 minutes (prototype: endless)', steps);
    s = spec.create(K.rng(128)); E.tap(s, 1, 300); E.steps(s, 600);
    ok(s.over && s.why === 'fall', 'jumper: missing the branches — a fall, run over');
    // the bot climbs on several seeds; the best stays under the cap
    let best = 0, falls = 0;
    for (let sd = 1; sd <= 10; sd++) { const r = K.sim(spec, { seed: 1200 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); best = Math.max(best, r.score); if (r.s.why === 'fall') falls++; }
    ok(best > 300 && best <= 2000, 'jumper: the steering bot climbs high (> 300; perfect steering 500…1620 over 30 trees) and stays under the server cap 2500', { best, falls });
    module.exports.maxScore = best;
  },
  e2e: {
    bot: (gap, stopAfter = 40) => e2eBot('jumper', decide, 'P.tap(a, 300);', 'm.kill = ' + stopAfter + ';')(gap),
    gap: 12, stopB: 6,
    endByStop: false, endMs: 30000,
    field: 'seq',
  },
};

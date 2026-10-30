// «Спуск» (js/games/arcade/descent.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// drag the rings so that a hole of the next ring is under the light (m.kill — e2e only: after that score aim at lava, an idle
// light bounces for 2 minutes). Returns 1 = press (pointer down at 160), or 100000 + the pointer x to drag to.
// The target pointer x is computed from the APPLIED state (s.rot with s.lx), so a repeated decision never doubles a drag.
function decide(s, C, m){
  if (!s.started) { if (m.down) return 0; m.down = 1; return 1; }
  if (s.floor >= C.NF) return 0;
  const b = (s.floor & (C.RING - 1)) * C.NS, want = m.kill && s.score >= m.kill ? C.LAVA : C.HOLE;
  const v0 = (C.BX / C.SW - s.rot) % C.NS, cur = Math.floor(v0 < 0 ? v0 + C.NS : v0) % C.NS;
  let best = -1, bd = 99;
  for (let i = 0; i < C.NS; i++) {
    if (s.seg[b + i] !== want) continue;
    let d = i - cur; if (d > 6) d -= 12; if (d < -6) d += 12;
    // a hole between two holes is the safest; otherwise the nearest
    const mid = want === C.HOLE && s.seg[b + (i + 1) % C.NS] === C.HOLE && s.seg[b + (i + 11) % C.NS] === C.HOLE ? -.5 : 0;
    if (Math.abs(d) + mid < bd) { bd = Math.abs(d) + mid; best = i; }
  }
  if (best < 0) return 0;
  // rot so that the centre of segment best is under the light: BX/SW − rot ≡ best + 0.5 (mod NS)
  let dr = (C.BX / C.SW - (best + .5)) - s.rot;
  dr -= C.NS * Math.round(dr / C.NS);
  const x = s.lx + dr * C.SW;
  if (m.lastX !== undefined && Math.abs(m.lastX - x) < 1) return 0;
  m.lastX = x;
  return 100000 + x;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => (a === 1 ? push(T.DOWN, 160, 300, 0) : push(T.MOVE, a - 100000, 300, 0))),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1, dt = K.STEP;
    const under = s => { const v = (C.BX / C.SW - s.rot) % C.NS; return Math.floor(v < 0 ? v + C.NS : v) % C.NS; };
    let s = spec.create(K.rng(131));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.y === 100 && s.t === 0, 'descent: before the first tap the light hangs still (5 s, no end)');
    E.tap(s, 160, 300);
    ok(s.started && !s.over, 'descent: the first tap only starts (never the end)');
    E.steps(s, 15);
    ok(Math.abs(s.y - (100 + C.G * dt * dt * 120)) < 1e-9, 'descent: gravity is per second', s.y);
    // drag in field units: SW units = one segment (prototype: screen pixels / 20)
    const r0 = s.rot; E.move(s, 160 + C.SW, 300);
    ok(Math.abs(s.rot - r0 - 1) < 1e-12, 'descent: dragging one segment width (field units) turns the rings by one segment', s.rot - r0);
    // the segment under the light is the one drawn under it
    let bad = 0;
    for (let q = 0; q < 200; q++) {
      s.rot = q * .173 - 17; const i = under(s), sh = ((s.rot % C.NS) + C.NS) % C.NS * C.SW;
      let x = i * C.SW + sh; if (x >= C.W) x -= C.W;
      if (!((C.BX >= x - 1e-9 && C.BX < x + C.SW + 1e-9) || (C.BX >= x - C.W - 1e-9 && C.BX < x - C.W + C.SW + 1e-9))) bad++;   // 1e-9: exact segment borders
    }
    ok(bad === 0, 'descent: the segment the light lands on is the one drawn under it', bad);
    // a bounce never reaches the ring above
    ok(C.VB * C.VB / (2 * C.G) < C.GAPY - C.RTH, 'descent: a bounce is lower than the gap between rings', C.VB * C.VB / (2 * C.G));
    // landing: hole → +1 and through; normal → bounce; gold → +3 once; lava → over
    const land = (t, setup) => { const x = spec.create(K.rng(132)); E.tap(x, 160, 300); x.seg[0 * C.NS + under(x)] = t; if (setup) setup(x);
      x.y = C.Y0 - C.BR - 2; x.vy = 300; spec.step(x, dt, null); return x; };
    let x = land(C.HOLE);
    ok(x.floor === 1 && x.score === 1 && x.vy > 0, 'descent: over a hole — through, +1');
    x = land(C.NORM);
    ok(x.floor === 0 && x.vy === C.VB && !x.over, 'descent: stone — bounce');
    x = land(C.GOLD);
    ok(x.score === 3 && x.golds === 1 && x.seg[under(x)] === C.NORM && x.vy === C.VB, 'descent: ⭐ gold — bounce, +3, then plain stone');
    x = land(C.LAVA);
    ok(x.over && x.why === 'lava', 'descent: lava — run over');
    // a fast fall cannot tunnel through a ring (crossing inside one step)
    x = land(C.NORM, y => { y.vy = 590; }); ok(x.vy === C.VB, 'descent: a fast fall still lands on the ring');
    // generator (40 seeds × 60 rings): 2–3 adjacent holes, lava never in a hole or next to one, the bottom is solid
    let badRing = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const t = spec.create(K.rng(sd));
      for (let k = 0; k <= C.NF; k++) {
        while (t.made <= k) spec.gen(t, t.made);
        const b = (k & M) * C.NS;
        let holes = 0, lavaNear = 0;
        for (let i = 0; i < C.NS; i++) {
          if (t.seg[b + i] === C.HOLE) holes++;
          if (t.seg[b + i] === C.LAVA && (t.seg[b + (i + 1) % C.NS] === C.HOLE || t.seg[b + (i + 11) % C.NS] === C.HOLE)) lavaNear++;
        }
        if (k < C.NF ? (holes < 2 || holes > 3 || lavaNear) : holes) badRing++;
      }
    }
    ok(badRing === 0, 'descent: every ring has 2–3 holes and no lava next to a hole; the bottom is solid', badRing);
    // keys turn KROT segments per second
    s = spec.create(K.rng(133)); E.key(s, 1); E.steps(s, 30, { down: false, x: 0, y: 0, keys: 2 });
    ok(s.started && Math.abs(s.rot - C.KROT * .5) < 1e-9, 'descent: → turns the rings KROT segments per second (keys added)', s.rot);
    // idle: bouncing on the first ring ends after 2 minutes
    s = spec.create(K.rng(134)); E.tap(s, 160, 300);
    for (let i = 0; i < C.NS; i++) s.seg[i] = C.NORM;
    const n = E.steps(s, 121 * 60);
    ok(s.over && s.why === 'time' && n >= C.LIMIT * 60 - 1, 'descent: bouncing in place ends after 2 minutes (prototype: endless)', n);
    // the bot reaches the bottom on every seed; the best score fits the cap (upper bound: every ring gold + all seconds)
    let bottom = 0, best = 0;
    for (let sd = 1; sd <= 10; sd++) { const r = K.sim(spec, { seed: 1300 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); if (r.s.why === 'bottom') bottom++; best = Math.max(best, r.score); }
    const upper = C.NF + 3 * C.NF + C.LIMIT;
    ok(bottom === 10 && best <= upper && upper <= 400, 'descent: the bot reaches the bottom (10 of 10); the best possible score fits the cap 400', { bottom, best, upper });
    module.exports.maxScore = upper;
  },
  e2e: {
    bot: (gap, stopAfter = 1e9) => e2eBot('descent', decide,
      // after a pause the kit lets the finger go (T.CANCEL) — press again before dragging, as a player would
      "if (a === 1) P.tap(160, 300); else { if (!T.inst()?.run?.inp.down) P.tap(a - 100000, 300); P.tap(a - 100000, 300, 'pointermove'); }", 'm.kill = ' + (stopAfter < 1e9 ? stopAfter : 0) + ';')(gap),
    gap: 10, stopB: 5,
    endByStop: false, endMs: 40000,
    field: 'seq',
  },
};

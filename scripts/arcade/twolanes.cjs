// «Двойная трасса» (js/games/arcade/twolanes.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// per car: the nearest object not yet passed decides the lane (battery / star — its lane, barrier — the other one);
// returns 1 (left car) or 2 (right car) when that car must switch. m.wait[c] — a tap is in flight (browser: not applied yet).
function decide(s, C, m){
  if (!s.started) return 1;
  for (let c = 0; c < 2; c++) {
    let best = -1, by = -1e9;
    for (let i = 0; i < C.NP; i++) if (s.on[i] && (s.ol[i] >> 1) === c && s.oy[i] - C.OS <= C.CARY + C.CH && s.oy[i] > by) { by = s.oy[i]; best = i; }
    if (best < 0) continue;
    const want = s.ot[best] === 1 ? (s.ol[best] ^ 1) : s.ol[best];
    if (s.lane[c] !== want) {
      if (m.lane && m.lane[c] === s.lane[c] && m.tick[c] > 0) { m.tick[c]--; continue; }   // our tap is not applied yet
      if (!m.lane) { m.lane = [9, 9]; m.tick = [0, 0]; }
      m.lane[c] = s.lane[c]; m.tick[c] = m.hold || 0;
      return c + 1;
    }
  }
  return 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, a === 1 ? 80 : 240, 300, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K);
    let s = spec.create(K.rng(101));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.spawned === 0 && s.en[0] === 1, 'twolanes: before the first tap nothing moves (5 s, no end)');
    E.tap(s, 60, 300);
    ok(s.started && s.lane[0] === 0 && s.lane[1] === 3 && !s.over, 'twolanes: the first tap only starts (no lane change)');
    // per second: energy −0.06 in 1 s (no object reaches the cars that early), speed V0 + DV·t, lane change LANE_V
    E.steps(s, 60);
    ok(Math.abs(s.en[0] - (1 - C.DRAIN)) < 1e-9 && Math.abs(s.v - (C.V0 + C.DV)) < 1e-9, 'twolanes: energy −0.06 and speed +1.6 per second', { en: s.en[0], v: s.v });
    E.tap(s, 60, 300); E.steps(s, 4);
    ok(Math.abs(s.cx[0] - (40 + C.LANE_V * 4 / 60)) < 1e-9 && s.lane[0] === 1, 'twolanes: the car slides LANE_V units per second to its new lane', s.cx[0]);
    // left / right half and keys pick the car
    s = spec.create(K.rng(102)); E.tap(s, 10, 10); E.tap(s, 300, 10); E.key(s, 0);
    ok(s.lane[0] === 1 && s.lane[1] === 2 && !s.over, 'twolanes: a tap on the right half moves the right car; ← the left car', { l0: s.lane[0], l1: s.lane[1] });
    // collision by the drawn car, not the lane index: a barrier in the next lane hits only after the car slides into it
    const crashAt = () => {
      const t = spec.create(K.rng(103)); E.tap(t, 60, 300); t.next[0] = t.next[1] = 1e9;
      t.on[0] = 1; t.ot[0] = 1; t.ol[0] = 1; t.oy[0] = C.CARY + 10;
      E.tap(t, 60, 300);
      let k = 0; while (!t.over && k < 30) { spec.step(t, K.STEP); k++; }
      return t.why === 'crash' ? k : -1;
    };
    const k = crashAt();
    ok(k >= 5 && k <= 7, 'twolanes: switching into a barrier crashes when the car body reaches it (step 5–7), not at once (prototype: lane index)', k);
    // a passed battery is not the end; empty energy is
    s = spec.create(K.rng(104)); E.tap(s, 60, 300); s.next[0] = s.next[1] = 1e9;
    s.on[0] = 1; s.ot[0] = 0; s.ol[0] = 1; s.oy[0] = 300;
    E.steps(s, 60);
    ok(!s.over && s.on[0] === 0 && s.bats === 0, 'twolanes: a missed battery is not the end of the run');
    s.en[1] = .0005; E.steps(s, 1);
    ok(s.over && s.why === 'empty' && s.who === 1, 'twolanes: empty energy ends the run (right car)');
    // a battery charges +0.3 and gives +1, a star +3
    s = spec.create(K.rng(105)); E.tap(s, 60, 300); s.next[0] = s.next[1] = 1e9; s.en[0] = .5;
    s.on[0] = 1; s.ot[0] = 0; s.ol[0] = 0; s.oy[0] = C.CARY - 20; s.on[1] = 1; s.ot[1] = 2; s.ol[1] = 3; s.oy[1] = C.CARY - 20;
    E.steps(s, 12);
    ok(s.score === 4 && s.bats === 1 && s.stars === 1 && Math.abs(s.en[0] - (.5 + C.CHARGE - C.DRAIN * 12 / 60)) < 1e-6, 'twolanes: battery +1 and +0.3 charge, star +3', { score: s.score, en: s.en[0] });
    // generator: objects of one car are never closer than DMIN0 + DMINK·v (switch out and back in is always possible)
    let tight = 0, runs = 0, fin = 0, best = 0;
    for (let sd = 1; sd <= 30; sd++) {
      const t = spec.create(K.rng(1000 + sd)), mm = {}, lv = [0, 0];
      const newest = c => { let y = 1e9; for (let i = 0; i < C.NP; i++) if (t.on[i] && (t.ol[i] >> 1) === c && t.oy[i] < y) y = t.oy[i]; return y; };
      E.tap(t, 60, 300);
      while (!t.over) {
        const a = decide(t, C, mm);
        if (a) E.tap(t, a === 1 ? 80 : 240, 300);
        const n0 = t.next[0], n1 = t.next[1], y0 = newest(0), y1 = newest(1), d0 = t.dist;
        spec.step(t, K.STEP);
        for (let c = 0; c < 2; c++) if (t.next[c] > (c ? n1 : n0)) {     // a spawn for car c happened in this step: gap to its previous object
          const prev = (c ? y1 : y0) + (t.dist - d0);
          if (prev < 1e8 && prev - newest(c) < C.DMIN0 + C.DMINK * lv[c] - 1e-6) tight++;
          lv[c] = t.v;
        }
      }
      // the bot takes every battery and star (each one is reachable: see the spacing above) — its score is the honest maximum of the track
      runs++; if (t.why === 'finish') fin++; best = Math.max(best, t.score);
    }
    ok(tight === 0, 'twolanes: objects of one car are never closer than 90 + 0.3·speed (prototype: any gap)', tight);
    ok(fin >= 28, 'twolanes: the lane bot drives the whole 2 minutes (≥ 28 of 30 tracks)', { fin, runs, best });
    // the server cap: the perfect bot takes every battery and star — 195…251 over 40 tracks; cap 400 leaves room for lucky tracks
    ok(best <= 300, 'twolanes: the perfect bot score (honest maximum of a track) stays well under the server cap 400', { best });
    module.exports.maxScore = best;
  },
  e2e: {
    bot: e2eBot('twolanes', decide, 'P.tap(a === 1 ? 80 : 240, 300);', 'm.hold = 3;'),
    gap: 10, stopB: 6,
    endByStop: true,
    field: 'seq',
  },
};

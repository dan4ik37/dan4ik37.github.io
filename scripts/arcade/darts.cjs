// «Дротики» (js/games/arcade/darts.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// throw when the predicted landing point is clear of stuck darts and of the darts still in flight. The landing rotation is
// predicted by replaying the board's own spin rules step by step (steady / pulsing / back-and-forth). m.margin — extra angle on
// top of GAP (bigger in the browser: timer jitter). m.kill — e2e only: after that score aim INTO a stuck dart (an idle
// player never fails here — the run would last the full 2 minutes).
function decide(s, C, m){
  if (!s.started) return 1;
  if (s.clear > 0 || s.cool > 0 || s.left <= 0 || s.nf >= C.MAXF) return 0;
  const TAU = Math.PI * 2, wr = x => x - TAU * Math.floor((x + Math.PI) / TAU), M = C.GAP + (m.margin || .03), dt = 1 / 60, d = C.V * dt;
  const land = fy0 => {
    let rot = s.rot, w = s.w, mt = s.mt, dirT = s.dirT, fy = fy0;
    for (let k = 0; k < 600; k++) {
      mt += dt;
      if (s.mode === 1) w = dirT * s.base * (1 + .65 * Math.sin(mt * TAU / s.per));
      else if (s.mode === 2) { if (mt >= s.per) { mt -= s.per; dirT = -dirT; } const want = dirT * s.base, a = 7 * dt; w = w < want - a ? w + a : w > want + a ? w - a : want; }
      const y = fy - d;
      if (y <= C.RIM) return wr(Math.PI / 2 - (rot + w * dt * ((fy - C.RIM) / d)));
      fy = y; rot += w * dt;
    }
    return 0;
  };
  const th = land(C.Y0);
  if (m.kill && s.score >= m.kill) {                 // e2e: enough — end the run on purpose (a dart into a dart)
    for (let j = 0; j < s.n; j++) if (Math.abs(wr(th - s.ka[j])) < C.GAP * .5) return 1;
    return 0;
  }
  for (let j = 0; j < s.n; j++) if (Math.abs(wr(th - s.ka[j])) < M) return 0;
  for (let i = 0; i < s.nf; i++) if (Math.abs(wr(th - land(s.fy[i]))) < M) return 0;
  return 1;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 300, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), TAU = Math.PI * 2, wr = x => x - TAU * Math.floor((x + Math.PI) / TAU);
    const tf = (C.Y0 - C.RIM) / C.V;
    let s = spec.create(K.rng(91));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.rot === 0 && s.t === 0, 'darts: before the first tap the board waits (5 s, no end)');
    const left0 = s.left;
    E.tap(s);
    ok(s.started && s.nf === 0 && s.left === left0 && !s.over, 'darts: the first tap only starts (no throw, never a miss)');
    // per second: board base rad/s (target 0 is steady), dart V units/s
    E.steps(s, 30);
    ok(s.mode === 0 && Math.abs(s.rot - s.w * .5) < 1e-9 && Math.abs(Math.abs(s.w) - s.base) < 1e-12, 'darts: the board turns «base» rad per second', { rot: s.rot, w: s.w });
    E.tap(s); E.steps(s, 6);
    ok(s.nf === 1 && Math.abs(s.fy[0] - (C.Y0 - C.V * 6 / 60)) < 1e-9, 'darts: the dart flies V units per second', s.fy[0]);
    // exact landing angle: the rotation at the moment the tip touches the rim (prototype: the frame after crossing it)
    s = spec.create(K.rng(92)); E.tap(s); E.steps(s, 20);
    const r0 = s.rot, w0 = s.w; E.tap(s); E.steps(s, 15);
    const want = wr(Math.PI / 2 - (r0 + w0 * tf));
    ok(s.n === s.pre + 1 && Math.abs(wr(s.ka[s.n - 1] - want)) < 1e-9, 'darts: landing angle = board rotation at the exact touch time (inside the step)', { got: s.ka[s.n - 1], want });
    // double tap within 0.1 s — one dart; a tap while a dart flies — not lost
    s = spec.create(K.rng(93)); E.tap(s); E.tap(s); E.tap(s);
    ok(s.nf === 1, 'darts: a second tap within 0.1 s is ignored (finger bounce)');
    E.steps(s, 7); E.tap(s);
    ok(s.nf === 2, 'darts: a tap while a dart is still flying throws another (prototype lost it)', s.nf);
    // clash = flights overlap: a stuck dart 0.1 rad from the landing point → miss; 0.14 rad → fine
    const clash = off => { const t = spec.create(K.rng(94)); E.tap(t); t.n = 0; t.goldOn = false;
      t.ka[0] = wr(Math.PI / 2 - (t.rot + t.w * tf)) + off; t.n = 1; E.tap(t); E.steps(t, 12); return t.over && t.why === 'clash'; };
    ok(clash(.1) && clash(-.1) && !clash(.14) && !clash(-.14), 'darts: a miss only when the flights overlap (0.12 rad; prototype 0.2 — darts not even touching)');
    // ⭐ golden sector: +2 once
    s = spec.create(K.rng(95)); E.tap(s); s.n = 0; s.goldA = wr(Math.PI / 2 - (s.rot + s.w * tf));
    E.tap(s); E.steps(s, 12);
    ok(s.score === 3 && s.golds === 1 && !s.goldOn, 'darts: a dart into the ⭐ sector — +1 +2, the sector goes out', { score: s.score });
    // a whole target: every dart in → +5, short pause, next target with its pre-stuck darts ≥ 0.6 rad apart
    s = spec.create(K.rng(96)); E.tap(s);
    const need0 = s.left, mm = {};
    let g = 0;
    while (s.tg === 0 && !s.over && g++ < 20000) { if (decide(s, C, mm)) E.tap(s); spec.step(s, K.STEP); }
    ok(!s.over && s.tg === 1 && s.score === need0 + 5 + 2 * s.golds, 'darts: all darts in — target cleared +5, next target', { score: s.score, need0, golds: s.golds });
    let sepBad = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const t = spec.create(K.rng(sd));
      for (let i = 0; i < C.NT; i++) {
        for (let a = 0; a < t.n; a++) for (let b = a + 1; b < t.n; b++) if (Math.abs(wr(t.ka[a] - t.ka[b])) < C.PRE_SEP - 1e-9) sepBad++;
        t.clear = 1e-9; t.started = true; t.left = 0; t.nf = 0; spec.step(t, K.STEP);   // → next target (i + 1)
        if (t.over) break;
      }
    }
    ok(sepBad === 0, 'darts: pre-stuck darts are never closer than 0.6 rad (prototype: any random angles)', sepBad);
    // run ends by time when nobody throws (competition needs both to finish)
    s = spec.create(K.rng(97)); E.tap(s);
    const n = E.steps(s, 121 * 60);
    ok(s.over && s.why === 'time' && n >= C.LIMIT * 60 - 1, 'darts: no throws — the run ends after 2 minutes', { n });
    // the board angle stays bounded
    ok(Math.abs(s.rot) < 60 + 7, 'darts: the board angle stays bounded', s.rot);
    // the exact bot clears all 15 targets; the upper bound (every ⭐ hit, all seconds left) fits the cap 400
    let all = 0, best = 0;
    for (let sd = 1; sd <= 5; sd++) { const r = K.sim(spec, { seed: 900 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); if (r.s.why === 'all') all++; best = Math.max(best, r.score); }
    let needSum = 0; for (let i = 0; i < C.NT; i++) needSum += 5 + (i >> 1);
    const upper = needSum + 2 * C.NT + 5 * C.NT + C.LIMIT;
    ok(all >= 4 && best <= upper && upper <= 400, 'darts: the bot clears all 15 targets (≥ 4 of 5 seeds), the best possible score fits the cap 400', { all, best, upper });
    module.exports.maxScore = upper;
  },
  e2e: {
    bot: (gap, stopAfter = 25) => e2eBot('darts', decide, 'P.tap(160, 300);', 'm.margin = .22; m.kill = ' + stopAfter + ';')(gap),
    gap: 12, stopB: 4,
    endByStop: false, endMs: 40000,
    field: 'seq',
  },
};

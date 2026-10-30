// «Цветной прыжок» (js/games/arcade/colorjump.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// hover below the next bar; when its colour under the drop stays right for the next half second — jump through
function decide(s, C, m){
  if (!s.started) return 1;
  const j = s.next & (C.RING - 1), by = s.by[j];
  if (m.go === s.next) return s.vy > (m.gov || -150) ? 1 : 0;
  const col = t => { let o = (s.bo[j] + s.bv[j] * t) % C.W; if (o < 0) o += C.W; let u = C.BX - o; if (u < 0) u += C.W; return ((u / C.SEG | 0) + s.bc[j]) & 3; };
  const wait = by + 75;
  if (!s.spt[j] || s.y > wait + 25) return s.vy > -60 ? 1 : 0;          // climb to the waiting level (through the paint splash)
  const need = s.rainbow ? -1 : s.col;
  let clear = true;
  for (let dt = .05; dt <= (m.win || .5); dt += .05) if (need >= 0 && col(s.t + dt) !== need) { clear = false; break; }
  if (clear) { m.go = s.next; return 1; }
  return s.y > wait + 12 && s.vy > 0 ? 1 : 0;                           // hover
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 220, 0)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    let s = spec.create(K.rng(61));
    E.steps(s, 180);
    ok(!s.over && !s.started && s.y === 0 && s.t === 0, 'colorjump: before the first tap the drop stands on the paint can (3 s, no end)');
    E.tap(s, 1, 1);
    ok(s.started && s.vy === C.JUMP && !s.over, 'colorjump: the first tap jumps (does not end the run)');
    const n = E.steps(s, 600);
    ok(s.over && s.why === 'fall' && n > 30 && n < 120, 'colorjump: no more taps — the drop falls off the bottom', { why: s.why, n });
    // the colour test uses the colour under the drop centre — the same formula as the drawing
    s = spec.create(K.rng(62));
    const j0 = 0, o = s.bo[j0], u = (C.BX - o + C.W) % C.W, expect = ((Math.floor(u / C.SEG)) + s.bc[j0]) & 3;
    let wrong = -1; for (let c = 0; c < 4; c++) if (c !== expect) { wrong = c; break; }
    // jump right through the first bar with the wrong colour → «color»; with the right colour → +1
    const through = col => { const t = spec.create(K.rng(62)); t.col = col; t.started = true; t.vy = 0; t.y = t.by[0] + 30; t.bv[0] = 0; t.vy = -420; let k = 0; while (!t.over && t.next === 0 && k < 120) { spec.step(t, K.STEP); k++; } return t; };
    let t = through(wrong); ok(t.over && t.why === 'color', 'colorjump: wrong colour under the drop — run over', { why: t.why });
    t = through(expect); ok(!t.over && t.next === 1 && t.score === 1, 'colorjump: matching colour — the bar is passed (+1)', { over: t.over, score: t.score });
    // paint splashes always change the colour; every 10th is a rainbow
    s = spec.create(K.rng(63));
    let same = 0, rain = 0;
    for (let k = 1; k < 400; k++) {
      while (s.count <= k) { s.first = s.count - (C.RING - 1); spec.step(Object.assign(s, { started: true, y: s.by[(s.count - 1) & M], cam: s.by[(s.count - 1) & M] - 50, vy: 0, t: 0, rainbow: true }), 0); }
      const a = s.need[(k - 1) & M], b = s.need[k & M];
      if (a === b) same++;
      if (s.spk[k & M]) rain++;
    }
    ok(same === 0 && rain === 40, 'colorjump: every splash gives a new colour, every 10th splash is a rainbow', { same, rain });
    // speeds per second: in 0.5 s the bar moved |bv| × 0.5 (the colour under the drop follows the time, not the frames)
    s = spec.create(K.rng(64)); E.tap(s, 1, 1); E.steps(s, 30);
    ok(Math.abs(s.t - .5) < 1e-9, 'colorjump: time runs in seconds (30 steps = 0.5 s)', s.t);
    // the bot keeps passing bars for the whole 2 minutes on most seeds (the game is fair: splashes come before every bar)
    let fin = 0, best = 0;
    for (let sd = 1; sd <= 6; sd++) { const r = K.sim(spec, { seed: 600 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); if (r.s.why === 'finish') fin++; best = Math.max(best, r.score); }
    ok(fin >= 4 && best > 50, 'colorjump: the bot climbs for the full 2 minutes on ≥ 4 of 6 seeds', { fin, best });
    module.exports.maxScore = best;
    ok(best <= 400, 'colorjump: the best bot score fits the server cap (400)', best);
  },
  e2e: {
    bot: e2eBot('colorjump', decide, 'P.tap(160, 220);', 'm.win = .8; m.gov = -230;'),   // browser timers are late: a longer clear window, faster crossing
    gap: 16, stopB: 1,   // the careful bot passes ~1 bar per 2 s: B stops after the first bar so A (9 s of play) wins
    endByStop: true,
    field: 'bo',
  },
};

// «Перейди дорогу» (js/games/arcade/road.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// a cautious walker: a cell is «safe» when no car covers it during the next `dur` seconds (car positions are a pure function
// of time). Danger in the current road row → step up / aside / back; otherwise step up when the next cell is safe, walk
// around bushes. Returns 1 up, 2 left, 3 right, 4 down. m.slow — extra steps of caution (browser timer jitter);
// m.kill — e2e only: after that score walk into the road without looking (an idle hedgehog lives the full 2 minutes).
function decide(s, C, m){
  if (!s.started) return 1;
  if (s.hop > 0) return 0;
  if (m.bn > 0 && m.br === s.row && m.bc === s.col) { m.bn--; return 0; }   // our step is not applied yet (browser)
  if (!m.safe) {                            // helpers are made once per bot (no closures per call: the garbage test runs this bot)
    m.bush = (s, C, r, c) => (s.rb[r & (C.RING - 1)] >> c) & 1;
    m.safe = (s, C, r, c, n) => {        // n — steps to look ahead (an integer: no boxed double arguments per call)
      if (r < 0 || r < s.best - C.BACK || c < 0 || c >= C.COLS || m.bush(s, C, r, c)) return false;
      const j = r & (C.RING - 1);
      if (!s.rt[j]) return true;
      const x0 = c * C.CELL + 6, x1 = x0 + C.CELL - 12, P = s.rp[j];
      for (let k = 0; k <= n; k++) {
        const t = s.t + k / 60;
        for (let q = 0; q < s.rk[j]; q++) {
          let x = (s.ro[j * 3 + q] + s.rv[j] * t) % P; if (x < 0) x += P; x -= P - C.W;
          if (x < x1 + 4 && x + s.rw[j * 3 + q] > x0 - 4) return false;
        }
      }
      return true;
    };
  }
  const safe = m.safe, bush = m.bush, sl = m.slow || 0, w = 27 + sl, now = 13 + sl;   // look-ahead in steps: .45 s / .22 s (+ m.slow)
  let a = 0;
  if (m.kill && s.score >= m.kill) a = bush(s, C, s.row + 1, s.col) ? 0 : 1;
  else if (!safe(s, C, s.row, s.col, now)) a = safe(s, C, s.row + 1, s.col, w) ? 1 : safe(s, C, s.row, s.col - 1, w) ? 2 : safe(s, C, s.row, s.col + 1, w) ? 3 : safe(s, C, s.row - 1, s.col, w) ? 4 : 0;
  else if (safe(s, C, s.row + 1, s.col, w)) a = 1;
  else if (bush(s, C, s.row + 1, s.col)) {  // walk around a bush: toward the nearest free column of the next row
    let best = -1;
    for (let d = 1; d < C.COLS && best < 0; d++) { if (s.col - d >= 0 && !bush(s, C, s.row + 1, s.col - d)) best = s.col - d; else if (s.col + d < C.COLS && !bush(s, C, s.row + 1, s.col + d)) best = s.col + d; }
    if (best >= 0 && safe(s, C, s.row, best < s.col ? s.col - 1 : s.col + 1, w)) a = best < s.col ? 2 : 3;
  }
  if (a) { m.br = s.row; m.bc = s.col; m.bn = m.wait || 0; }
  return a;
}

// node bot: action → one key event (↑ ← → ↓); the swipe path (DOWN + UP) is covered by the scenarios and the Chrome bot
module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.KEY, 0, 0, a - 1)),
  maxMs: 130000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), M = C.RING - 1;
    const tap = s => { E.tap(s, 160, 300); E.up(s, 160, 300); };
    const swipe = (s, dx, dy) => { E.tap(s, 160, 300); E.up(s, 160 + dx, 300 + dy); };
    const carX = (s, j, c, t) => { const P = s.rp[j]; let x = (s.ro[j * 3 + c] + s.rv[j] * t) % P; if (x < 0) x += P; return x - (P - C.W); };
    let s = spec.create(K.rng(111));
    E.steps(s, 300);
    ok(!s.over && !s.started && s.t === 0 && s.row === 0, 'road: before the first tap nothing moves (5 s, no end)');
    tap(s);
    ok(s.started && s.row === 0 && s.col === 3 && !s.over, 'road: the first tap only starts (its release is not a step)');
    tap(s); E.steps(s, 10);
    ok(s.row === 1 && s.best === 1 && s.score === 1, 'road: a tap — one row forward, +1', { row: s.row });
    swipe(s, 30, 0); E.steps(s, 10); swipe(s, -30, 4); E.steps(s, 10); swipe(s, 30, 0); E.steps(s, 10);
    ok(s.col === 4 && s.row === 1, 'road: swipe right / left — a step aside', s.col);
    swipe(s, 10, 0); E.steps(s, 10);
    ok(s.row === 2 && s.col === 4, 'road: a 10-unit drag is a tap (threshold in field units, prototype: 30 screen pixels)');
    swipe(s, 0, 30); E.steps(s, 10);
    ok(s.row === 1 && s.best === 2 && s.score === 2, 'road: swipe down — a step back, the score keeps the farthest row');
    // a step during a hop is remembered
    tap(s); tap(s); E.steps(s, 20);
    ok(s.row === 3, 'road: a second tap during the hop is not lost (buffered)', s.row);
    // per second: cars move v units per second, in every row (also far ahead of the hero)
    let far = -1; for (let i = 6; i < s.made; i++) if (s.rt[i & M]) { far = i & M; break; }
    const x0 = carX(s, far, 0, s.t);
    ok(far >= 0 && Math.abs(((carX(s, far, 0, s.t + 1) - x0 - s.rv[far]) % s.rp[far] + s.rp[far]) % s.rp[far]) < 1e-6 || Math.abs(((carX(s, far, 0, s.t + 1) - x0 - s.rv[far]) % s.rp[far])) < 1e-6,
      'road: cars move v units per second in every row, also far ahead (prototype froze rows away from the hero)');
    // generator (spec.gen — the same function the game calls on every step forward) over 40 seeds × 300 rows:
    // cars of a row ≥ 2 cells apart (also across the wrap), ≤ 4 roads in a row, two bushy grass rows never touch
    let close = 0, bushPair = 0, rows = 0, maxRoads = 0, wild = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const t = spec.create(K.rng(sd));
      let prevBush = false, run = 0;
      for (let i = 0; i < 300; i++) {
        while (t.made <= i) spec.gen(t, t.made++);
        const j = i & M; rows++;
        if (t.rt[j]) {
          run++; maxRoads = Math.max(maxRoads, run); prevBush = false;
          const k = t.rk[j], P = t.rp[j];
          if (Math.abs(t.rv[j]) > C.VMAX || Math.abs(t.rv[j]) < C.VMIN) wild++;
          for (let q = 0; q < k; q++) {
            const nx = (q + 1) % k, end = t.ro[j * 3 + q] + t.rw[j * 3 + q], start = nx > q ? t.ro[j * 3 + nx] : t.ro[j * 3 + nx] + P;
            if (start - end < 2 * C.CELL - 1e-9) close++;
          }
        } else { run = 0; const bb = t.rb[j] !== 0; if (bb && prevBush) bushPair++; prevBush = bb; }
      }
    }
    ok(close === 0 && wild === 0 && rows === 12000, 'road: cars of one row are always ≥ 2 cells apart, also across the wrap (prototype: cars overtook each other)', { close, wild, rows });
    ok(maxRoads <= 4, 'road: at most 4 roads in a row (2 at the start)', maxRoads);
    ok(bushPair === 0, 'road: two bushy grass rows never touch (no dead ends)', bushPair);
    // back limit: at most 3 rows behind the farthest
    s = spec.create(K.rng(112)); tap(s); s.rb.fill(0); s.rt.fill(0);
    for (let i = 0; i < 6; i++) { tap(s); E.steps(s, 10); }
    for (let i = 0; i < 6; i++) { swipe(s, 0, 30); E.steps(s, 10); }
    ok(s.best === 6 && s.row === 3, 'road: a step back is allowed down to 3 rows behind the farthest', { best: s.best, row: s.row });
    // standing on a road: a car comes within one period → hit
    s = spec.create(K.rng(113)); tap(s);
    let rr = -1; for (let i = 3; i < s.made; i++) if (s.rt[i & M]) { rr = i; break; }
    s.row = rr; s.best = rr; s.col = 3;
    let n = 0; while (!s.over && n < 15 * 60) { spec.step(s, K.STEP); n++; }
    ok(s.over && s.why === 'hit', 'road: standing on the road — a car hits (run over)', { n });
    // idle on the grass — the walk ends after 2 minutes
    s = spec.create(K.rng(114)); tap(s);
    n = E.steps(s, 121 * 60);
    ok(s.over && s.why === 'time' && n >= C.LIMIT * 60 - 1, 'road: idle — the walk ends after 2 minutes', n);
    // mushrooms +3
    s = spec.create(K.rng(115)); tap(s); s.rm[1] = 3; s.rb[1] = 0;
    tap(s); E.steps(s, 10);
    ok(s.shrooms === 1 && s.score === 1 + 3 && s.rm[1] === -1, 'road: a mushroom — +3', s.score);
    // the bot walks on several seeds; the best score stays well under the cap
    let best = 0, hits = 0;
    for (let sd = 1; sd <= 8; sd++) { const r = K.sim(spec, { seed: 1100 + sd, fps: 60, bot: module.exports.bot(K, spec, 1), maxMs: 130000 }); best = Math.max(best, r.score); if (r.s.why === 'hit') hits++; }
    ok(best > 60 && best <= 1000, 'road: the careful bot gets far (> 60) and stays under the server cap 1000', { best, hits });
    module.exports.maxScore = best;
  },
  e2e: {
    bot: (gap, stopAfter = 30) => e2eBot('road', decide,
      "if (a === 1) { P.tap(160, 300); P.tap(160, 300, 'pointerup'); } else { P.tap(160, 300); P.tap(a === 2 ? 130 : a === 3 ? 190 : 160, a === 4 ? 330 : 300, 'pointerup'); }",
      'm.slow = 7; m.wait = 4; m.kill = ' + stopAfter + ';')(gap),
    gap: 12, stopB: 4,
    endByStop: false, endMs: 60000,
    field: 'seq',
  },
};

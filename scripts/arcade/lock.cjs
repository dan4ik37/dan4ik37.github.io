// «Сейф» (js/games/arcade/lock.js) — bot and scenarios for scripts/arcade-test.cjs, Chrome bot for scripts/arcade-e2e.cjs.
const { nodeBot, e2eBot, evHelper } = require('./_b2.cjs');

// tap when the needle is inside the window of the light (m.early — how far before the centre, for late browser timers)
function decide(s, C, m){
  if (!s.started) return 1;
  if (s.open > 0 || s.cool > 0) return 0;
  const TAU = Math.PI * 2, x = (s.a - s.tg) * s.d, sd = x - TAU * Math.floor((x + Math.PI) / TAU);
  return sd > -(m.early || .04) ? 1 : 0;
}

module.exports = {
  bot: nodeBot(decide, (a, push, T) => push(T.DOWN, 160, 220, 0)),
  maxMs: 400000,
  garbage: { gap: 1, ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, E = evHelper(spec, K), TAU = Math.PI * 2;
    const sd = s => { const x = (s.a - s.tg) * s.d; return x - TAU * Math.floor((x + Math.PI) / TAU); };
    let s = spec.create(K.rng(71));
    const a0 = s.a;
    E.steps(s, 300);
    ok(!s.over && !s.started && s.a === a0, 'lock: before the first tap the needle stands (5 s, no end)');
    E.tap(s);
    ok(s.started && !s.over && s.clicks === 0, 'lock: the first tap only starts the needle (never a miss)');
    const gap0 = -sd(s);
    ok(gap0 >= C.MINA - 1e-9 && gap0 <= C.MINA + C.SPAN + 1e-9, 'lock: the first light is 1…2.9 rad ahead', gap0);
    // speed per second: 0.5 s → W0 × 0.5 rad
    const b0 = s.a; E.steps(s, 30);
    ok(Math.abs(Math.abs(s.a - b0) - C.W0 * .5) < 1e-9, 'lock: the needle turns W0 rad per second', Math.abs(s.a - b0));
    // no taps: the needle passes the light → «late» (not before it reaches it)
    const n = E.steps(s, 600);
    ok(s.over && s.why === 'late' && n > 0, 'lock: no tap — the needle passes the light, run over');
    // tap far before the light → «early»; inside the window → click, needle turns back, a new light ahead
    s = spec.create(K.rng(72)); E.tap(s); E.tap(s);
    ok(s.over && s.why === 'early', 'lock: a tap far from the light breaks the lock');
    s = spec.create(K.rng(73)); E.tap(s);
    while (sd(s) < -.1) spec.step(s, K.STEP);
    const d0 = s.d; E.tap(s);
    ok(!s.over && s.clicks === 1 && s.score === 1 && s.d === -d0 && sd(s) <= -C.MINA + 1e-9, 'lock: tap over the light — click +1, the needle reverses, next light ahead');
    // double tap right after a click is ignored (finger bounce)
    E.tap(s);
    ok(!s.over && s.clicks === 1, 'lock: a second tap within 0.12 s after a click is ignored (prototype broke the lock)');
    // open a whole safe: pins + 5; the needle waits during the «open» pause
    s = spec.create(K.rng(74)); E.tap(s);
    const pins = s.left;
    for (let i = 0; i < pins; i++) { while (sd(s) < -.05) spec.step(s, K.STEP); E.tap(s); E.steps(s, 10); }
    ok(!s.over && s.safe === 1 && s.score === pins + 5 + 2 * s.golds, 'lock: all pins of a safe — opened, +5', { score: s.score, pins, safe: s.safe });
    // the whole vault: 20 safes, run over with «all»; the score fits the server cap (all golden = upper bound)
    s = spec.create(K.rng(75)); E.tap(s);
    let guard = 0;
    while (!s.over && guard++ < 1e6) { if (s.open <= 0 && s.cool <= 0 && sd(s) > -.03) E.tap(s); spec.step(s, K.STEP); }
    let pinSum = 0; for (let i = 0; i < C.NSAFE; i++) pinSum += 3 + Math.floor(i * .6);
    ok(s.why === 'all' && s.safe === C.NSAFE && s.clicks === pinSum, 'lock: 20 safes — the vault is open, run over', { why: s.why, safe: s.safe, clicks: s.clicks, pinSum });
    const upper = pinSum * 3 + 5 * C.NSAFE;
    ok(s.score <= upper && upper <= 600, 'lock: the best possible score (every light golden) fits the server cap (600)', { score: s.score, upper });
    module.exports.maxScore = upper;
  },
  e2e: {
    bot: e2eBot('lock', decide, 'P.tap(160, 220);', 'm.early = .12;'),
    gap: 12, stopB: 3,
    endByStop: true,
    field: 'seq',
  },
};

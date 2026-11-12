// Simulation of «Смотреть вместе» sync: loads the real wtValid / wtTarget from chatplayer.js (vm), 3 viewers, 5 min,
// latency 50–400 ms jitter, viewer playback rate drift ±0.5 %, a host pause and seek. Reports max drift after correction.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'features', 'chatplayer.js'), 'utf8');
const ctx = { window: {}, location: { origin: 'https://x', hostname: 'x' }, addEventListener(){}, matchMedia: () => ({ matches: false }), performance: { now: () => 0 }, setTimeout, clearTimeout, setInterval, clearInterval, console };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const T = ctx.D37Player._test;
let rnd = 7; const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
const host = { t: 0, p: true };
const viewers = [1.004, 0.996, 1.0].map(rate => ({ rate, t: 0, p: true, last: null, rx: 0, seeks: 0, max: 0, q: [] }));
const dt = 0.05; let lastSend = -10;
for (let now = 0; now < 300; now += dt) {
  if (Math.abs(now - 100) < dt / 2) host.p = false;            // host pause 10 s
  if (Math.abs(now - 110) < dt / 2) host.p = true;
  if (Math.abs(now - 200) < dt / 2) host.t += 60;              // host seek +60 s
  if (host.p) host.t += dt;
  const urgent = [100, 110, 200].some(x => Math.abs(now - x) < dt / 2);
  if (urgent || now - lastSend >= 4) {
    lastSend = now;
    const msg = T.wtValid({ t: 's', k: 'yt', u: '11111111-1111-1111-1111-111111111111', n: 'h', v: 'abcdefghijk', tm: Math.round(host.t * 100) / 100, p: host.p });
    for (const v of viewers) v.q.push({ at: now + 0.05 + R() * 0.35, msg });
  }
  for (const v of viewers) {
    if (v.p) v.t += dt * v.rate;
    while (v.q.length && v.q[0].at <= now) { const m = v.q.shift().msg; v.last = m; v.rx = now * 1000;
      const want = T.wtTarget(m, v.rx, now * 1000);
      if (Math.abs(v.t - want) > 1) { v.t = want; v.seeks++; }
      v.p = m.p; }
    if (now > 1 && ![100, 110, 200].some(x => now >= x && now < x + 0.5)) v.max = Math.max(v.max, Math.abs(v.t - host.t));
  }
}
const worst = Math.max(...viewers.map(v => v.max));
console.log('viewers', viewers.map(v => ({ rate: v.rate, maxDrift: +v.max.toFixed(3), seeks: v.seeks })));
console.log(worst <= 1.0 ? `wt-sim OK: max drift ${worst.toFixed(2)} s over 5 min (3 viewers)` : `wt-sim FAIL ${worst}`);
process.exit(worst <= 1.0 ? 0 : 1);

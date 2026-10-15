// Предпросмотр карты-рельефа сверху (картинка PPM): node scripts/worldmap-preview.cjs . out.ppm [размер]
const fs = require('fs'), path = require('path');
const wt = process.argv[2], out = process.argv[3], S = +(process.argv[4] || 512);
globalThis.window = globalThis;
eval(fs.readFileSync(path.join(wt, 'js/engine/worldmap.js'), 'utf8'));
let layout = null;
try {
  // раскладка — из mir-zones (если уже есть)
  globalThis.document = undefined;
  eval(fs.readFileSync(path.join(wt, 'js/games/mir-zones.js'), 'utf8'));
  layout = globalThis.MirZones?.mapLayout?.();
} catch (e) { console.log('mir-zones:', e.message); }
const o = layout || { seed: 37, half: 3072, pads: [{ x0: -365, x1: 430, z0: -147, z1: 470 }], oceans: [{ x0: -500, x1: -364.8, z0: 104, z1: 456, floor: -7 }, { x0: -3200, x1: -500, z0: 74, z1: 486 }],
  rivers: [{ id: 'a', w0: 6, w1: 18, depth: 2.2, pts: [[-1350, -2350], [-1150, -1700], [-900, -1100], [-760, -600], [-700, -200], [-640, 80], [-700, 200]] },
    { id: 'b', w0: 7, w1: 24, depth: 2.6, pts: [[1500, -2450], [1250, -1800], [1000, -1250], [820, -700], [700, -200], [640, 300], [700, 800], [820, 1400], [760, 1900], [640, 2500], [600, 2950]] }],
  lakes: [{ x: -950, z: -750, r: 60 }, { x: 1200, z: 700, r: 85 }, { x: -1600, z: -2150, r: 50 }] };
let t0 = Date.now();
const WM = window.D37E.worldMap(o);
console.log('init ms', Date.now() - t0);
const H = WM.HALF, buf = Buffer.alloc(S * S * 3), col = [0, 0, 0];
t0 = Date.now();
let lo = Infinity, hi = -Infinity, land = 0;
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const x = -H + (i + .5) / S * 2 * H, z = -H + (j + .5) / S * 2 * H;
  const h = WM.height(x, z), w = WM.water(x, z);
  lo = Math.min(lo, h); hi = Math.max(hi, h); if (h > WM.SEA) land++;
  const hx = WM.height(x + 4, z), hz = WM.height(x, z + 4), ny = 4 / Math.hypot(h - hx, 4, h - hz);
  WM.color(h, ny, x, z, col);
  let [r, g, b] = col;
  const shade = Math.max(.55, Math.min(1.25, 1 + (h - hx) * .05 - (hz - h) * .03));
  r *= shade; g *= shade; b *= shade;
  if (w > h) { const d = Math.min(1, (w - h) / 12); r = .25 - d * .12; g = .52 - d * .2; b = .78 - d * .15; }
  const q = WM.road(x, z); if (q && q.d < q.R.w / 2 + 2) { r = .3; g = .3; b = .32; }
  for (const p of WM.PADS) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) { r = r * .5 + .45; g = g * .5 + .2; b = b * .5 + .2; }
  const k = (j * S + i) * 3; buf[k] = Math.max(0, Math.min(255, r * 255)); buf[k + 1] = Math.max(0, Math.min(255, g * 255)); buf[k + 2] = Math.max(0, Math.min(255, b * 255));
}
const ms = Date.now() - t0;
console.log('samples', S * S * 3, 'ms', ms, 'us/sample', (ms * 1000 / (S * S * 3)).toFixed(2), 'h', lo.toFixed(1), hi.toFixed(1), 'land %', (land / S / S * 100).toFixed(0));
console.log('rivers', WM.RIVERS.map(r => r.id + ' L=' + r.L.toFixed(0) + ' y0=' + r.ys[0].toFixed(1) + ' yEnd=' + r.ys[r.n].toFixed(2)).join('; '));
console.log('lakes', WM.LAKES.map(l => `(${l.x},${l.z}) wl=${l.wl.toFixed(1)}`).join('; '));
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6 ${S} ${S} 255\n`), buf]));

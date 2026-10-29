// Картинка особой погоды (T-135 WX2, js/engine/wx-fx.js) без браузера: node scripts/wxfx-test.cjs
// three.js — заглушка (только то, что трогает wx-fx): пулы появляются с первой бурей и прячутся в ясно (0 вызовов отрисовки),
// числа частиц — в пределах (телефон и «средняя» — 45 %, «низкая» — 0), видимость и цвет неба плавно идут к буре и обратно,
// под крышей частиц нет, dispose снимает всё; мусора на кадр нет — выборка кучи инспектором V8 (байт на кадр из wx-fx.js).
const path = require('path');
const SITE = path.join(__dirname, '..');
globalThis.window = undefined;
globalThis.performance = globalThis.performance || require('perf_hooks').performance;
require(path.join(SITE, 'js/engine/climate.js'));
require(path.join(SITE, 'js/engine/wx.js'));
require(path.join(SITE, 'js/engine/wx-fx.js'));
const E = globalThis.D37E, C = E.climate, FX = E.wxfx;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
// minimal three.js stub
class Attr { constructor(a, n){ this.array = a; this.itemSize = n; this.needsUpdate = false; } setUsage(){ return this; } }
class Geo { constructor(){ this.attributes = {}; this.drawRange = { start: 0, count: 0 }; this.disposed = false; } setAttribute(k, a){ this.attributes[k] = a; return this; } setDrawRange(s, c){ this.drawRange.start = s; this.drawRange.count = c; } dispose(){ this.disposed = true; } }
class Mat { constructor(o){ Object.assign(this, o); this.disposed = false; } dispose(){ this.disposed = true; } }
class Obj { constructor(g, m){ this.geometry = g; this.material = m; this.visible = true; } }
const T = { BufferGeometry: Geo, BufferAttribute: Attr, Points: Obj, LineSegments: Obj, PointsMaterial: Mat, LineBasicMaterial: Mat, DynamicDrawUsage: 1, RGBAFormat: 1, LinearFilter: 1,
  DataTexture: class { constructor(){ this.disposed = false; } dispose(){ this.disposed = true; } } };
const mkR = () => { const kids = new Set(); return { T, kids, scene: { add: o => kids.add(o), remove: o => kids.delete(o) }, camera: { position: { x: 0, y: 1.7, z: 0 } }, setWeather(w){ this.wx = w ? { ...w } : null; this.pushes = (this.pushes || 0) + 1; } }; };
const W = C.world({ seed: 'mir', climateAt: () => 'steppe' });
const sample = st => { W.set({ weather: st }); return W.at(0, 0, Date.now(), 5); };

console.log('— пулы: с первой бурей, в ясно спрятаны');
{
  const R = mkR(), F = FX.attach(R, { top: () => 0, q: .45 }), clear = sample('clear'), sand = sample('sandstorm');
  for (let i = 0; i < 120; i++) F.frame(1 / 60, clear, 1, 1);
  ok(R.kids.size === 0 && !F.stats().pools, 'ясно: ни одного объекта в сцене');
  for (let i = 0; i < 1200; i++) F.frame(1 / 60, sand, 1, 1);
  const s = F.stats();
  ok(R.kids.size === 2 && s.grains > 0 && s.grains <= 225 && s.streaks > 0 && s.streaks <= 122, 'песчаная буря: 2 объекта, частицы ≤ 45 % (телефон)', s);
  ok(Math.abs(s.vis - sand.vis) < 3 && s.dust > .75, 'видимость и пыль дошли до бури (плавно, ~3 с)', { s, vis: sand.vis });
  for (let i = 0; i < 1800; i++) F.frame(1 / 60, clear, 1, 1);
  const c = F.stats(), O = F.objects();
  ok(!O.grains.visible && !O.streaks.visible && c.vis === 510 && c.dust === 0, 'буря кончилась: пулы спрятаны (0 вызовов), небо как было', c);
  F.dispose();
  ok(R.kids.size === 0 && O.grains.geometry.disposed && O.streaks.material.disposed, 'dispose: всё снято и освобождено');
}
console.log('— «низкая» графика (q = 0): только цвет и туман; под крышей частиц нет; Кубомир — pushSky');
{
  const R = mkR(), F = FX.attach(R, { top: () => 0, q: 0 }), sand = sample('sandstorm');
  for (let i = 0; i < 600; i++) F.frame(1 / 60, sand, 1, 1);
  ok(R.kids.size === 0 && F.K.dust > .7, '«низкая»: частиц нет, цвет бури есть');
  const R2 = mkR(), F2 = FX.attach(R2, { top: () => 50, q: 1 });   // a roof 48 units above the camera everywhere: indoors
  for (let i = 0; i < 600; i++) F2.frame(1 / 60, sand, 1, 1);
  ok(F2.stats().grains === 0 || [...R2.kids].every(o => !o.visible || o.geometry.drawRange.count === 0 || [...o.geometry.attributes.position.array].filter((v, i) => i % 3 === 1).every(y => y === -9999 || y === 0)), 'под крышей частиц не видно');
  const R3 = mkR(), F3 = FX.attach(R3, { top: () => 0, q: .45 });
  for (let i = 0; i < 600; i++) F3.frame(1 / 60, sand, 1, 1);
  F3.pushSky(R3);
  ok(R3.wx && R3.wx.vis > 0 && R3.wx.tintK > .5 && Array.isArray(R3.wx.tint), 'pushSky: цвет и видимость бури в R.setWeather', R3.wx);
  const clear = sample('clear');
  for (let i = 0; i < 3000; i++) F3.frame(1 / 60, clear, 1, 1);
  { const t = Date.now(); while (Date.now() - t < 300); } F3.pushSky(R3);
  ok(R3.wx === null, 'pushSky: буря кончилась — null (небо снова рисует игра)', R3.wx);
  const P = FX.planetSky(sand, {}); ok(P.dust > 0 && P.tint.length === 3, 'planetSky: числа для неба планеты', P);
}
console.log('— 0 мусора на кадр: выборка кучи (инспектор V8) за 30 000 кадров бури — байт на кадр из wx-fx.js');
(async () => {
  const inspector = require('inspector');
  const R = mkR(), F = FX.attach(R, { top: () => 0, q: 1 }), sand = sample('sandstorm');
  for (let i = 0; i < 3000; i++) F.frame(1 / 60, sand, 1, 1);   // warm up (pools, JIT)
  const s = new inspector.Session(); s.connect();
  const post = (m, p) => new Promise((a, b) => s.post(m, p || {}, (e, r) => e ? b(e) : a(r)));
  await post('HeapProfiler.enable'); await post('HeapProfiler.startSampling', { samplingInterval: 32 });
  const N = 30000, t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) F.frame(1 / 60, sand, 1, 1);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const prof = (await post('HeapProfiler.stopSampling')).profile;
  let bytes = 0; const walk = n => { if (/wx-fx\.js$/.test(n.callFrame.url)) bytes += n.selfSize; n.children.forEach(walk); }; walk(prof.head);
  s.disconnect();
  const per = bytes / N;
  ok(per < 4, 'меньше 4 байт на кадр (по сути 0: изредка — число при рождении частицы)', +per.toFixed(3));
  console.log(`  кадр картинки бури (ПК, node, 500 песчинок + 270 позёмки): ${ms.toFixed(4)} мс; выделено ${per.toFixed(3)} байт на кадр`);
  console.log(`
wxfx-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

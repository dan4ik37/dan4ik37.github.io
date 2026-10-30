// T-145 review fixes W1 / W2 / W3: the weather takes the PLACE's own climate (C.world placeAt → climate.js float path and wx.js
// integer path), not only the climate class row.
//   • no placeAt → bit-identical to before (Mir, Kubomir, Studio: old worlds keep their weather)
//   • «Новая земля» (T1 v2, seed 1337, the game's own world options): a hot savanna and the land around a desert get no snow and no
//     −5 °C in January; the cold north still gets winter; hail and afternoon storms happen (the weather clock runs: E.dayClock)
//   • «Планета»: no snow at the equator; 45° N and 45° S have opposite seasons, and the south follows the sun's declination
// Run: node scripts/place-climate-test.cjs  (FAST=1 — fewer samples)
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..'), FAST = !!process.env.FAST;
globalThis.window = globalThis; globalThis.self = globalThis;
const run = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/voxel.js', 'js/engine/trees.js', 'js/engine/voxel-gen.js', 'js/engine/terra-core.js', 'js/engine/climate.js', 'js/engine/wx.js', 'js/engine/biomes.js']) run(f);
require(path.join(SITE, 'js/engine/planet.js'));
const E = window.D37E, C = E.climate, B = E.biomes, WX = E.wx, T1 = E.terraCore;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const t0 = Date.now();
// E.dayClock (gfx.js, the same formula): «Новая земля» and Mir — a 40-minute day, a fifth of it night
const dayClock = (ms, cycle = 40, night = .2) => { const p = ((ms / 60000 / Math.max(.5, cycle)) % 1 + 1) % 1, d = 1 - night; return p < d ? 6 + p / d * 12 : (18 + (p - d) / (1 - d) * 12) % 24; };

// ── 1. without placeAt nothing changes (digest over a year of samples at several climates, with and without placeAt: null) ──
{
  const dig = W => { let h = 0; for (const ck of ['temperate', 'steppe', 'desert', 'snow', 'tropic']) for (let i = 0; i < 120; i++) { const s = W.at(i * 37, ck.length * 100, Date.UTC(2027, 0, 1) + i * 3 * 86400000); for (const k of ['temp', 'rain', 'snow', 'hail', 'fog', 'snowCover']) h = (Math.imul(h, 31) + Math.round(s[k] * 1e6)) | 0; } return h; };
  const mk = extra => { let i = 0; const K = ['temperate', 'steppe', 'desert', 'snow', 'tropic']; return C.world(Object.assign({ seed: 'pc', mode: 'calendar', climateAt: (x, z) => K[Math.floor(z / 100) - 4] || 'temperate' }, extra)); };
  ok(dig(mk({})) === dig(mk({ placeAt: () => null })), 'placeAt returning null = no placeAt (the class row decides)');
}

// ── 2. «Новая земля»: the game's own weather world (terra-demo.js weatherInit) ──
const src = B.t1(1337, { gen: 2 });
const terraWorld = () => C.world({ seed: 'terra-1337', mode: 'calendar', climateAt: B.climateAtFn(src), placeAt: B.placeAtFn(src), lapse: -.0065, seaY: 0, front: 4000,
  hourAt: ms => dayClock(ms), wxRegionAt: WX.regionOf(src), realm: 'kids' });
const JAN = Date.UTC(2027, 0, 1);
const january = (W, x, z, step = 2) => {   // two-hour samples over January
  const r = { snow: 0, min: 99, mean: 0, n: 0, sp: {} };
  for (let t = 0; t < 31 * 24; t += step * 97 / 120) {   // 97-minute steps: a 40-minute game day is not sampled at one hour
    const s = W.at(x, z, JAN + t * 3600000, Math.max(0, T1.height(1337, x, z)));
    if (s.snow > .05) r.snow++;
    if (s.temp < r.min) r.min = s.temp;
    r.mean += s.temp; r.n++;
    if (s.special) r.sp[s.special] = (r.sp[s.special] || 0) + 1;
  }
  r.mean /= r.n;
  return r;
};
{
  const W = terraWorld();
  const sav = january(W, -11600, -10400), des = january(W, -14200, -11200), stp = january(W, -14000, -11200);
  ok(B.at(src, -11600, -10400, {}).id === 'savanna' && sav.snow === 0 && sav.min > 5 && !sav.sp.buran && !sav.sp.ground_blizzard, 'hot savanna (tempC 21.9) in January: no snow, no буран, nights above +5 °C', sav);
  ok(B.at(src, -14200, -11200, {}).id === 'desert' && des.snow === 0 && des.mean > 8, 'desert in January: mild, no snow', { snow: des.snow, mean: des.mean, min: des.min });
  ok(B.at(src, -14000, -11200, {}).id === 'steppe' && stp.min > -5 && !stp.sp.buran && Math.abs(stp.mean - des.mean) < 9, 'steppe hill 200 m from the desert: cooler by its height, not a −12 °C winter', { snow: stp.snow, mean: stp.mean, min: stp.min, desert: des.mean });
  // land around deserts: biome grid at 100 m over 6 × 6 km, every non-desert land cell within 400 m of a desert
  const G = 100, N = 60, X0 = -15000, Z0 = -13000, bio = new Int8Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) bio[j * N + i] = B.at(src, X0 + i * G, Z0 + j * G, {}).biome;
  const near = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const b = bio[j * N + i]; if (b === 0 || b === 5) continue;
    let d = false; for (let dj = -4; dj <= 4 && !d; dj++) for (let di = -4; di <= 4 && !d; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && di * di + dj * dj <= 16 && bio[jj * N + ii] === 5) d = true; }
    if (d) near.push([X0 + i * G, Z0 + j * G]);
  }
  const pick = near.filter((p, k) => k % (FAST ? 12 : 4) === 0);
  const HOT = new Set(['savanna', 'jungle', 'desert', 'beach']);
  const survey = Wv => {   // January at every picked cell (11.3-hour steps): cells below −5 °C, with snow; hot biomes separately
    const r = { cold: 0, snowy: 0, minT: 99, hotCold: 0, hotSnow: 0, hot: 0 };
    for (const [x, z] of pick) {
      let sn = 0, mn = 99;
      for (let t = 0; t < 31 * 24; t += 11.3) { const s = Wv.at(x, z, JAN + t * 3600000, Math.max(0, T1.height(1337, x, z))); if (s.snow > .05) sn++; if (s.temp < mn) mn = s.temp; }
      if (mn < -5) r.cold++; if (sn) r.snowy++; if (mn < r.minT) r.minT = mn;
      if (HOT.has(B.at(src, x, z, {}).id)) { r.hot++; if (mn < 0) r.hotCold++; if (sn) r.hotSnow++; }
    }
    return r;
  };
  const after = survey(W), before = survey(C.world({ seed: 'terra-1337', mode: 'calendar', climateAt: B.climateAtFn(src), lapse: -.0065, seaY: 0, front: 4000, hourAt: ms => dayClock(ms), wxRegionAt: WX.regionOf(src), realm: 'kids' }));
  console.log(`  land within 400 m of a desert: ${near.length} cells, sampled ${pick.length} (hot biomes ${after.hot}). January — class climate only: below −5 °C ${before.cold}, snow ${before.snowy}, coldest ${before.minT.toFixed(1)}; the place's own climate: below −5 °C ${after.cold}, snow ${after.snowy}, coldest ${after.minT.toFixed(1)}`);
  ok(after.hot > 10 && after.hotCold === 0 && after.hotSnow === 0, 'hot biomes next to a desert (savanna, jungle, beach): no frost, no snow in January', after);
  ok(after.cold <= Math.ceil(pick.length * .1) && after.snowy <= Math.ceil(pick.length * .15) && after.minT > -12 && after.cold * 4 <= before.cold && after.snowy * 3 <= before.snowy,
    'land next to a desert: frost below −5 °C only on cool steppe hills (≤ 10 %), at least 4× fewer cold and 3× fewer snowy cells than with the class climate', { after, before });
  // the cold north keeps its winter (snow class): the biome table's cold end
  let north = null;
  for (let z = 0; z < 40000 && !north; z += 400) { const r = B.at(src, 0, z, {}); if (r.id === 'snow' || r.id === 'tundra') north = [0, z]; }
  for (let z = 0; z > -40000 && !north; z -= 400) { const r = B.at(src, 0, z, {}); if (r.id === 'snow' || r.id === 'tundra') north = [0, z]; }
  const nr = north ? january(W, north[0], north[1], 6) : null;
  ok(nr && nr.snow >= 3 && nr.mean < -5, 'snow / tundra cells still get a real winter', nr && { at: north, snow: nr.snow, mean: nr.mean });
  // W3: the weather clock runs (E.dayClock): over a year hail at the mountain cell and afternoon storms in the tropics happen
  const year = (x, z) => { const c = {}; for (let i = 0; i < (FAST ? 8760 : 17520); i++) { const s = W.at(x, z, Date.UTC(2026, 2, 1) + i * (FAST ? 3600000 : 1800000), Math.max(0, T1.height(1337, x, z))); if (s.special) c[s.special] = (c[s.special] || 0) + 1; } return c; };
  const mt = year(-5488, -7904);
  ok((mt.hailstorm || 0) + (mt.supercell || 0) > 0, 'mountain cell over a year: hail (the weather hour is not stuck at 10:30)', mt);
  let trop = null; for (let x = -12000; x > -16000 && !trop; x -= 200) { const r = B.at(src, x, -10200, {}); if (r.id === 'jungle') trop = [x, -10200]; }
  const tr = trop ? year(trop[0], trop[1]) : {};
  ok((tr.afternoon_storm || 0) > 0, 'jungle over a year: afternoon storms', { at: trop, sp: tr });
  // determinism: the hour is a function of the moment (not of the page's light), so a second world gives the same answer
  const W2 = terraWorld(), a = W.at(-11600, -10400, JAN + 5e6), b = W2.at(-11600, -10400, JAN + 5e6);
  ok(a.temp === b.temp && a.special === b.special && a.hour === b.hour, 'two worlds, the same moment → the same weather and hour');
  // the integer path (WX.active T_q) agrees with the float path on the place: a buran never runs in the savanna's January
  let buranInt = 0; for (let t = 0; t < 31 * 24; t += 1) { const A = WX.active(W, -11600, -10400, 0, JAN + t * 3600000, 'steppe'); if (A.r && A.r.key === 'buran') buranInt++; }
  ok(buranInt === 0, 'wx.js integer rolls see the savanna\'s own temperature (no буран)', buranInt);
}

// ── 3. «Планета»: the planet's own temperature and the hemisphere season (planet-demo.js placeAt) ──
{
  const P = E.planet.create(E.planet.HOME);
  const DEG = Math.PI / 180, WD = [0, 0, 0], K = new Map();
  // the same functions as planet-view.js V.climateAt / V.placeAt
  const climateAt = (x, z) => P.climateAt(P.dirFromLatLon(Math.max(-90, Math.min(90, -z / P.R / DEG)), x / P.R / DEG, WD));
  const placeAt = P.placeAtFn();
  const W = C.world({ seed: 'planet-' + P.def.seed, mode: 'calendar', climateAt, placeAt, lapse: -6.5 / 1166, seaY: 0, front: 4000, hourAt: () => 14 });
  const at = (lat, lon) => [lon * DEG * P.R, -lat * DEG * P.R];
  const jan = (lat, lon) => { const [x, z] = at(lat, lon); let sn = 0, mn = 99; for (let t = 0; t < 31 * 24; t += 3) { const s = W.at(x, z, JAN + t * 3600000, 0); if (s.snow > .05) sn++; if (s.temp < mn) mn = s.temp; } return { sn, mn }; };
  const e1 = jan(10, 120), e2 = jan(4.2, 150.3), e3 = jan(0, 133);
  ok(e1.sn === 0 && e1.mn > 12 && e2.sn === 0 && e3.sn === 0, 'equator and 10° N in January: no snow, warm', { e1, e2, e3 });
  const [xn, zn] = at(45, 30), [xs, zs] = at(-45, 30);
  const sN = W.at(xn, zn, Date.UTC(2027, 6, 15), 0), sS = W.at(xs, zs, Date.UTC(2027, 6, 15), 0), wN = W.at(xn, zn, JAN + 14 * 86400000, 0), wS = W.at(xs, zs, JAN + 14 * 86400000, 0);
  const opp = { spring: 'autumn', summer: 'winter', autumn: 'spring', winter: 'summer' };
  ok(opp[sN.season] === sS.season && opp[wN.season] === wS.season && wN.season === 'winter' && wS.season === 'summer', '45° N and 45° S: opposite seasons (January: winter / summer)', [sN.season, sS.season, wN.season, wS.season]);
  // the south follows the sun: its summer is when the sun stands over the southern hemisphere (declination < 0)
  let agree = 0, n = 0;
  for (let d = 0; d < 365; d += 5) {
    const ms = JAN + d * 86400000, dl = P.declination(ms), ph = W.at(xs, zs, ms, 0).phase;
    if (Math.abs(dl) < 2 * DEG) continue;
    n++; if (Math.sign(Math.cos((ph - 1.5) * Math.PI / 2)) === Math.sign(-dl)) agree++;   // the south's summer peak = the sun over the south
  }
  ok(n > 20 && agree === n, 'southern season follows the declination of the planet\'s sun', { agree, n });
  // warmer at 45° S in its summer than in its winter; the equator barely changes
  let dMin = 0, dMax = 0, mMin = JAN, mMax = JAN;
  for (let d = 0; d < 365; d++) { const ms = JAN + d * 86400000, dl = P.declination(ms); if (dl < dMin) { dMin = dl; mMin = ms; } if (dl > dMax) { dMax = dl; mMax = ms; } }
  const mean = ms => { let a = 0, k = 0; for (let t = -72; t < 72; t += 5) { a += W.at(xs, zs, ms + t * 3600000, 0).temp; k++; } return a / k; };
  const sumS = mean(mMin), winS = mean(mMax);
  ok(sumS > winS + 6, '45° S: warmer when the sun is over the south than when it is over the north', { summer: sumS, winter: winS });
}

console.log(`place-climate-test: ${pass} ok, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);

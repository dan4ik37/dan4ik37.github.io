// Logical biomes (T-116, T-145 track L): Kubomir generator v4 and the T1 generator v2 (JS port; the Rust crate E:\d37-terrain has
// the same checks plus golden bits), the shared D37E.biomes API (js/engine/biomes.js) and the strange-world presets.
//   • Kubomir v1 / v2 / v3 — blocks, biomes and weather zones exactly as before (old saved worlds unchanged); v4 is deterministic
//     and independent of the chunk order (climate node cache)
//   • "no winter next to a desert": the shortest way from a hot biome to snow — v3 vs v4 (Kubomir), v1 vs v2 (T1)
//   • lonely patches: the share of land in regions smaller than 32 × 32 m — before / after
//   • chunk generation time v3 vs v4, D37E.biomes records (integers, climate.js keys), presets build, no Math.random
// Run: node scripts/biomes-test.cjs  (FAST=1 — smaller grids)
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..'), FAST = !!process.env.FAST;
globalThis.window = globalThis; globalThis.self = globalThis;
const run = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/voxel.js', 'js/engine/trees.js', 'js/engine/voxel-gen.js', 'js/engine/terra-core.js', 'js/engine/climate.js', 'js/engine/biomes.js']) run(f);
const E = window.D37E, V = E.vox, T1 = E.terraCore, B = E.biomes;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const t0 = Date.now();

// ── 1. Kubomir: old versions unchanged, v4 deterministic and order-independent ──
const digest = (ver, order) => {
  let h = 0;
  for (const seed of ['test-v1', 12345]) {
    const G = V.genInit(seed, { ver }), list = [];
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) list.push([cx * 7, cz * 5]);
    if (order) list.reverse();
    const per = new Map();
    for (const [cx, cz] of list) per.set(cx + ',' + cz, V.genChunk(G, cx, cz));
    for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
      const r = per.get(cx * 7 + ',' + cz * 5);
      for (let i = 0; i < r.ids.length; i++) h = (Math.imul(h, 31) + r.ids[i]) | 0;
      for (let i = 0; i < 256; i++) h = (Math.imul(h, 31) + r.biome[i] * 7 + r.zone[i]) | 0;
    }
  }
  return h;
};
// digests of main before T-145 (ids + biome + zone of 98 chunks over two seeds)
ok(digest(1) === -286554413, 'Kubomir v1 worlds unchanged', digest(1));
ok(digest(2) === 414367105, 'Kubomir v2 worlds unchanged', digest(2));
ok(digest(3) === -1160391172, 'Kubomir v3 worlds unchanged', digest(3));
const d4 = digest(4);
ok(d4 !== -1160391172 && d4 === digest(4, true), 'Kubomir v4: its own world, the same in any chunk order (node cache)', d4);
ok(V.GEN_LATEST === 4 && V.genInit(1, { ver: 9 }).ver === 4, 'V.GEN_LATEST = 4, newer numbers clamp to 4');

// ── 2. maps: hot ↔ frozen distance and lonely patches ──
function grid(n, step, x0, z0, biomeAt){
  const b = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) b[j * n + i] = biomeAt(x0 + i * step, z0 + j * step);
  return b;
}
// shortest 4-neighbour way (cells) from any `hot` cell to any `cold` cell
function hotCold(b, n, hot, cold){
  const dist = new Int32Array(n * n).fill(-1), q = new Int32Array(n * n);
  let qh = 0, qt = 0;
  for (let k = 0; k < n * n; k++) if (hot.includes(b[k])) { dist[k] = 0; q[qt++] = k; }
  while (qh < qt) {
    const c = q[qh++], i = c % n, j = (c / n) | 0;
    for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const k = jj * n + ii;
      if (dist[k] < 0) { dist[k] = dist[c] + 1; q[qt++] = k; }
    }
  }
  let near = Infinity;
  for (let k = 0; k < n * n; k++) if (cold.includes(b[k]) && dist[k] >= 0 && dist[k] < near) near = dist[k];
  return near;
}
// share of the area in INTERIOR land regions smaller than `minCells` ("a small plain that is winter for no reason"): regions that
// touch water (`skip` classes) are coastal slivers of the terrain, not lonely climate patches, and are not counted
function smallShare(b, n, minCells, skip){
  const lab = new Int32Array(n * n).fill(-1), st = new Int32Array(n * n);
  let small = 0, id = 0;
  for (let s0 = 0; s0 < n * n; s0++) {
    if (lab[s0] >= 0) continue;
    let sp = 0, size = 0, wet = false, edge = false; st[sp++] = s0; lab[s0] = id;
    while (sp) {
      const c = st[--sp]; size++;
      const i = c % n, j = (c / n) | 0;
      for (const [ii, jj] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) { edge = true; continue; }
        const k = jj * n + ii;
        if (skip.includes(b[k])) wet = true;
        if (lab[k] < 0 && b[k] === b[c]) { lab[k] = id; st[sp++] = k; }
      }
    }
    if (size < minCells && !skip.includes(b[s0]) && !wet && !edge) small += size;
    id++;
  }
  return small / (n * n);
}
{
  const n = FAST ? 256 : 512, step = 8;   // 4 × 4 km (FAST: 2 × 2 km) at 8 blocks
  const col = {};
  // Kubomir: hot = desert, frozen = snow or a snow-capped summit
  const kbBiome = G => (x, z) => { const c = V.genColumn(G, x, z, col); return c.b === 7 && (G.ver >= 4 ? c.tp < .12 : c.h > V.SEA + 54) ? 6 : c.b; };
  // the climate's own biome (no water, beach, river or mountain overrides — those are terrain): lonely patches of the climate
  const kbClim = G => (x, z) => {
    const c = V.genColumn(G, x, z, col);
    if (c.h < V.SEA) return 0;
    if (G.ver >= 4) return c.ts < .22 ? 6 : c.desert > .5 ? 5 : c.swamp > .5 ? 8 : c.m >= .52 ? (c.ts < .40 ? 4 : 3) : 2;
    return c.T < -.34 ? 6 : c.desert > .5 ? 5 : c.swamp > .5 ? 8 : c.M > .08 ? (c.T < -.06 ? 4 : 3) : 2;
  };
  const res = {};
  for (const ver of [3, 4]) {
    const near = [], small = [];
    for (const seed of ['kubik', 77, 'zima']) {
      const G = V.genInit(seed, { ver }), b = grid(n, step, -n * step / 2, -n * step / 2, kbBiome(G));
      near.push(hotCold(b, n, [5], [6]) * step);
      small.push(smallShare(grid(n / 2, 4, -n, -n, kbClim(G)), n / 2, 64, [0]));   // 4-block grid, climate regions < 32 × 32 blocks
    }
    res['v' + ver] = { nearSnowToDesert: near, smallClimate: small.map(v => +(v * 100).toFixed(2) + '%') };
  }
  console.log('Kubomir (3 seeds, ' + (n * step / 1000) + ' km): v3', JSON.stringify(res.v3), '→ v4', JSON.stringify(res.v4));
  ok(res.v4.nearSnowToDesert.every(d => d >= 400), 'Kubomir v4: snow never within 400 blocks of a desert', res.v4.nearSnowToDesert);
  ok(Math.min(...res.v3.nearSnowToDesert) < 100, 'Kubomir v3 had snow next to deserts (the owner\'s complaint, reproduced)', res.v3.nearSnowToDesert);
  const sm = r => r.smallClimate.reduce((a, v) => a + parseFloat(v), 0);
  ok(sm(res.v4) < sm(res.v3), 'Kubomir v4: fewer lonely climate patches than v3', [res.v3.smallClimate, res.v4.smallClimate]);
  // T1 (new land): hot = desert / savanna / jungle, frozen = snow / tundra
  const nt = FAST ? 192 : 384, out = new Float64Array(8), rt = {};
  for (const ver of [1, 2]) {
    const near = [], small = [];
    for (const seed of [1337, 7]) {
      const b = grid(nt, 8, -nt * 4, -nt * 4, (x, z) => (ver === 1 ? T1.biome(seed, x, z) : T1.climate(seed, x, z, 0, 0, out)));
      near.push(hotCold(b, nt, [5, 6, 12], [8, 10]) * 8);
      small.push(smallShare(grid(nt, 4, -nt * 2, -nt * 2, (x, z) => (ver === 1 ? T1.biome(seed, x, z) : T1.climate(seed, x, z, 0, 0, out))), nt, 64, [0, 1]));   // T1: water and beach are terrain
    }
    rt['v' + ver] = { nearFrozenToHot: near, smallLand: small.map(v => +(v * 100).toFixed(2) + '%') };
  }
  console.log('T1 new land (2 seeds, ' + (nt * 8 / 1000).toFixed(1) + ' km): v1', JSON.stringify(rt.v1), '→ v2', JSON.stringify(rt.v2));
  ok(rt.v2.nearFrozenToHot.every(d => d >= 150), 'T1 v2: snow / tundra never within 150 m of a hot biome', rt.v2.nearFrozenToHot);
  const st = r => r.smallLand.reduce((a, v) => a + parseFloat(v), 0);
  ok(st(rt.v2) < st(rt.v1), 'T1 v2: fewer lonely patches than v1', [rt.v1.smallLand, rt.v2.smallLand]);
}

// ── 3. chunk generation time (node, this PC): v3 vs v4 ──
{
  const per = {};
  for (const ver of [3, 4, 3, 4]) {
    const G = V.genInit('perf' + ver + Math.random().toString(36).slice(2, 4), { ver }); let n = 0;
    const s = process.hrtime.bigint();
    for (let cx = 0; cx < (FAST ? 6 : 10); cx++) for (let cz = 0; cz < (FAST ? 6 : 10); cz++) { V.genChunk(G, cx + 200, cz - 90); n++; }
    per[ver] = Number(process.hrtime.bigint() - s) / 1e6 / n;
  }
  console.log(`Kubomir chunk generation (node, PC): v3 ${per[3].toFixed(2)} ms, v4 ${per[4].toFixed(2)} ms per chunk`);
  ok(per[4] < per[3] * 2.5 + 1, 'v4 chunk cost within 2.5× of v3', per);
}

// ── 4. D37E.biomes ──
{
  const G = V.genInit('kubik', { ver: 4 }), kb = B.kb(G), t1 = B.t1(1337, { gen: 2 });
  const keys = Object.keys(E.climate.CLIMATES);
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    const x = (i * 977) % 6000 - 3000, z = (i * 613) % 6000 - 3000;
    for (const src of [kb, t1]) {
      const r = B.at(src, x, z);
      if (!(r.cls >= 0 && r.cls <= 8) || !(r.ts >= -0.5 && r.ts <= 1.5) || !(r.m >= 0 && r.m <= 1) || typeof r.name !== 'string') bad++;
      const g = B.region(src, x, z);
      if (!Number.isInteger(g.cls) || !Number.isInteger(g.smask) || !Number.isInteger(g.F) || !Number.isInteger(g.alt) || !keys.includes(g.ck)) bad++;
    }
  }
  ok(bad === 0, 'D37E.biomes.at / region: classes, integers, climate.js keys (800 positions × 2 worlds)', bad);
  const fa = B.climateAtFn(t1), fb = B.climateAtFn(kb);
  ok(keys.includes(fa(100, -2100)) && keys.includes(fb(40, 900)) && fa(100, -2100) === fa(101, -2099), 'climateAtFn → climate.js keys, cached per cell');
  // the desert belt of T1 v2 is desert / steppe / tropic in the weather classes
  const cls = new Set(); for (let x = -2000; x < 2000; x += 50) cls.add(B.at(t1, x, -2048).cls);
  ok(cls.has(3) || cls.has(1) || cls.has(6), 'T1 hot belt has desert / steppe / tropic classes', [...cls]);
  ok(B.T1.length === 13 && T1.BIOMES.length === 13 && B.KB.length === V.BIOME_IDS.length, 'biome tables match the cores');
}

// ── 5. presets (WORLD_RULES §2) through the JS core ──
{
  const J = T1.js(T1.DEFAULT_CAP);
  let built = 0;
  for (const [k, p] of Object.entries(B.PRESETS)) {
    ok(J.setGen(p.gen, p.rules, p.param | 0) === 0, 'preset ' + k + ': setGen');
    J.colInfo(7, 5, -4);
    const lo = Math.floor(J.out().info[0] / 32), hi = Math.floor(J.out().info[1] / 32);
    let q = 0; for (let cy = lo; cy <= hi; cy++) q += Math.max(0, J.build(7, 5, cy, -4, 0));
    ok(q > 0, 'preset ' + k + ': a column builds (' + q + ' quads)');
    built += q;
  }
  J.setGen(2, 1, 10); J.colInfo(7, 5, -4); const cy = Math.floor(J.out().info[1] / 32);
  const q = J.build(7, 5, cy, -4, 0), col = J.out().col; let white = 0;
  for (let i = 0; i < q; i++) if (col[i * 16] > 200 && col[i * 16 + 2] > 200) white++;
  ok(white > q * 0.3, 'mono snow: the surface is white', [white, q]);
  J.setGen(1, 0, 0);
  ok(J.setGen(1, 3, 0) === -1 && J.setGen(2, 5, 0) === -1, 'bad gen/rules refused');
}

// ── 6. no Math.random in generation code ──
for (const f of ['js/engine/voxel-gen.js', 'js/engine/terra-core.js', 'js/engine/biomes.js']) ok(!/Math\.random/.test(fs.readFileSync(path.join(SITE, f), 'utf8')), f + ': no Math.random');

// ── 7. T-145: weather by biome on this land — D37E.wx.regionOf(src) (js/engine/wx.js) → region records from D37E.biomes ──
run('js/engine/wx.js');
{
  const X = E.wx, src = B.t1(1337, { gen: 2 }), RO = X.regionOf(src);
  ok(typeof RO === 'function', 'wx.regionOf(t1 src) → a function');
  // a desert cell and a cold cell of the new land (seed 1337)
  let des = null, cold = null;
  for (let r = 0; r < 60000 && !(des && cold); r += 512) for (let a = 0; a < 24 && !(des && cold); a++) {
    const x = Math.round(Math.cos(a * Math.PI / 12) * r), z = Math.round(Math.sin(a * Math.PI / 12) * r), q = B.region(src, x, z, 128, {});
    if (!des && q.cls === 3) des = [x, z]; if (!cold && q.cls === 5) cold = [x, z];
  }
  ok(!!des && !!cold, 'the new land has desert and snow weather cells', { des, cold });
  if (des) {
    const a = RO(des[0], des[1]), b = B.region(src, des[0], des[1], 128, {});
    ok(a.cls === b.cls && a.smask === b.smask && a.F === b.F && Number.isInteger(a.smask) && a.kc === 0, 'regionOf = B.region (integers, no kids city)', { a, b });
    ok(RO(des[0] + 1, des[1] + 1) === a || Math.floor((des[0] + 1) / 128) !== Math.floor(des[0] / 128), 'one record per 128 m cell (cached)');
  }
  // a year of the calendar weather at those cells: the desert gets sand / dust storms, the snow cell never does
  const W = C2 => E.climate.world({ seed: 'terra-1337', mode: 'calendar', climateAt: B.climateAtFn(src), lapse: -.0065, seaY: 0, front: 4000, hourAt: () => 10.5, wxRegionAt: RO, realm: 'kids' });
  const Wd = W(), t0y = Date.UTC(2026, 0, 1), seen = { des: {}, cold: {} };
  for (let i = 0; i < 365 * 24 * 2; i++) {
    const ms = t0y + i * 1800000;
    if (des) { const s = Wd.at(des[0], des[1], ms, 5); if (s.special) seen.des[s.special] = (seen.des[s.special] || 0) + 1; }
    if (cold) { const s = Wd.at(cold[0], cold[1], ms, 5); if (s.special) seen.cold[s.special] = (seen.cold[s.special] || 0) + 1; }
  }
  ok(des && (seen.des.sandstorm || seen.des.haboob), 'desert cell: sandstorms within a year', seen.des);
  ok(cold && !seen.cold.sandstorm && !seen.cold.haboob, 'snow cell: no sandstorms', seen.cold);
  console.log('  year of weather, specials (half-hour samples): desert', JSON.stringify(seen.des), '· snow', JSON.stringify(seen.cold));
  // Kubomir v4: the same adapter on a voxel world
  const RK = X.regionOf(B.kb(V.genInit('t145', { ver: 4 })));
  const rk = RK(300, -200);
  ok(rk && Number.isInteger(rk.cls) && rk.cls >= 0 && rk.cls <= 8, 'Kubomir v4: regionOf(kb src) gives a class 0…8', rk);
}

console.log(`biomes-test: ${pass} ok, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);

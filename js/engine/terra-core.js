// ═══════════════════════════════════════
//  D37 TERRAIN CORE T1 — JS port of the Rust crate d37terrain (E:\d37-terrain, src/lib.rs) + loader of its wasm build.
//  Density field (height, biomes, rivers, caves), Surface Nets on 32³ blocks, dig/fill edits. The world contract is the owner's
//  native_core (same formulas, seeds, edit format); generation is f64 with IEEE basic operations only, in the SAME order as the
//  Rust code, so this file, js/engine/terra.wasm and the Windows DLL give bit-identical results (scripts/terra-test.cjs checks
//  scripts/terra-golden.txt). Change a formula here → change src/lib.rs too, regenerate the golden file, rebuild the wasm.
//  Positions are chunk-local (relative to the block origin cx*32, cy*32, cz*32): the result never depends on the distance from
//  the world origin; the caller places the block at (origin − floating anchor).
// ═══════════════════════════════════════
// API (window, worker, node):  const T1 = D37E.terraCore
//   T1.js(cap) → core   |   await T1.wasm(bytes | ArrayBuffer, cap) → core       (core.kind: 'js' | 'wasm')
//   core.edits(n) → Float64Array(n*5) to fill with [x, y, z, radius, mode] (meters; mode 0 dig, 1 fill; order matters)
//   core.build(seed, cx, cy, cz, n) → quads (≥ 0) | -1 bad args | -2 internal error;  core.out() → { pos, nrm, col, info } views:
//     pos Float32Array q*12 (4 vertices × xyz, local m), nrm Int8Array q*16 (xyz0 ×4, /127), col Uint8Array q*16 (rgba ×4),
//     info Float64Array [hmin, hmax, quads, truncated, vertices, edits used, cave tables, column cache hit]
//   core.colInfo(seed, cx, cz) → info[0..2] = column hmin/hmax (1 = from cache), core.density(seed, x, y, z, n), core.height(seed, x, z), core.dispose()
//   T1.height(seed, x, z), T1.density(seed, x, y, z, ops, nOps), T1.biome(seed, x, z), T1.touches(ops, i, fox, foy, foz),
//   T1.meshHash(out, q) (FNV-1a 64 hex), T1.B, T1.ABI, T1.CAVE_MIN_Y
(function (root) {
  'use strict';
  const B = 32, S = 34, C = 33, CAVE_MIN_Y = -28, ABI = 2, DEFAULT_CAP = 24000, NONE = 0xFFFFFFFF, COLS = 32, TMAX = 512;

  // ─── scalar helpers (twins of lib.rs) ───
  const cl01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
  const lerp = (a, b, t) => a + (b - a) * cl01(t);
  const sstep = (a, b, x) => { const t = cl01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mn = (a, b) => (a < b ? a : b);
  const fl = x => Math.floor(x) | 0;
  const rnd = x => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(0.5 - x));
  const q8 = v => { const t = Math.floor(v * 127 + 0.5); return t < -127 ? -127 : t > 127 ? 127 : t; };
  const qc = v => Math.floor(cl01(v) * 255 + 0.5);
  const clampi = (v, a, b) => (v < a ? a : v > b ? b : v);
  function sinp(x){
    const TAU = 6.283185307179586;
    const k = Math.floor(x / TAU + 0.5);
    const r = x - k * TAU, r2 = r * r;
    let s = -7.647163731819816e-13;
    s = s * r2 + 1.6059043836821613e-10;
    s = s * r2 - 2.505210838544172e-8;
    s = s * r2 + 2.755731922398589e-6;
    s = s * r2 - 1.984126984126984e-4;
    s = s * r2 + 8.333333333333333e-3;
    s = s * r2 - 1.6666666666666666e-1;
    s = s * r2 + 1.0;
    return s * r;
  }
  // ─── hashes ───
  function hash2(s, x, z){
    let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s, 362437);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return h ^ (h >>> 16);
  }
  const rand2 = (s, x, z) => (hash2(s, x, z) & 0xFFFFFF) / 16777215;
  function hash3(s, x, y, z){
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 1103515245) ^ Math.imul(z, 668265263) ^ Math.imul(s, 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return h ^ (h >>> 16);
  }
  const r3 = (s, x, y, z) => (hash3(s, x, y, z) & 0xFFFFFF) / 16777215;

  // ─── world (point queries) ───
  function value2(s, x, z){
    const xi = fl(x), zi = fl(z);
    let tx = x - xi, tz = z - zi;
    tx = tx * tx * (3 - 2 * tx);
    tz = tz * tz * (3 - 2 * tz);
    const x1 = (xi + 1) | 0, z1 = (zi + 1) | 0;
    return lerp(lerp(rand2(s, xi, zi), rand2(s, x1, zi), tx), lerp(rand2(s, xi, z1), rand2(s, x1, z1), tx), tz);
  }
  function fbm2(s, x, z, oct){
    let sum = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += value2(s, x * f + i * 17.3, z * f - i * 9.1) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
  function height(s, x, z){
    const continent = fbm2(s, x * 0.0025, z * 0.0025, 4);
    const hills = fbm2(s, x * 0.012 + 50, z * 0.012 - 80, 4);
    const ridge = 1 - Math.abs(fbm2(s, x * 0.006 - 200, z * 0.006 + 300, 3) * 2 - 1);
    let h = (continent - 0.45) * 90 + hills * 14 + ridge * ridge * ridge * continent * 40;
    const r = Math.abs(fbm2(s, x * 0.0045 + 700, z * 0.0045 - 520, 3) * 2 - 1);
    const mask = (1 - sstep(0, 0.03, r)) * (1 - sstep(22, 40, h));
    if (mask > 0) h = lerp(h, mn(h, -3), mask);
    return h;
  }
  const temperature01 = (s, x, z) => cl01((fbm2(s, x * 0.0018 + 400, z * 0.0018 - 250, 3) - 0.5) * 2.4 + 0.5);
  const moisture01 = (s, x, z) => cl01((fbm2(s, x * 0.006 + 999, z * 0.006 - 444, 3) - 0.5) * 2.4 + 0.5);
  const entrance = (s, x, z) => sstep(0.60, 0.70, fbm2(s, x * 0.01 + 123, z * 0.01 - 77, 2));
  // biomes: 0 Water, 1 Beach, 2 Plains, 3 Forest, 4 Taiga, 5 Desert, 6 Savanna, 7 Swamp, 8 Tundra, 9 Rock, 10 Snow
  function classify(t, m, h){
    if (h < 0) return 0;
    if (h < 1.6) return 1;
    t = t - h * 0.006;
    if (h > 46 || t < 0.10) return 10;
    if (h > 32) return 9;
    if (t < 0.32) return m > 0.45 ? 4 : 8;
    if (t > 0.66) return m < 0.38 ? 5 : m < 0.58 ? 6 : 3;
    if (m > 0.64 && h < 7) return 7;
    return m > 0.5 ? 3 : 2;
  }
  const biome = (s, x, z) => classify(temperature01(s, x, z), moisture01(s, x, z), height(s, x, z));

  // ─── generator v2 (T-116): logical climate, E:\d37-core\spec\WORLD_RULES.md §1. Heights, caves and edits are the v1 field;
  //     only the biome (the surface colour) changes. Smooth fields on a 16 m node grid, bilinear between nodes:
  //     tb — sea-level temperature 0…1 = latitude (a triangle wave along a warped z: equator → pole 4096 m, the origin sits at
  //          mid-latitude) + low noise (±0.05) + sea moderation; ts = tb − 0.006·hs (smoothed height), tp = tb − 0.006·h (the snow
  //          line by altitude); m — moisture 0…1 = air moisture carried along the prevailing wind (6 upwind samples 64…2048 m:
  //          recharged over the sea, drying over land, rain shadow behind mountains) + the latitude belt (wet tropics, dry
  //          subtropics, wet mid-latitudes, dry poles) + rivers + low noise. Whittaker table (classify2): a hot biome never touches a
  //          frozen one (T bands are separated by whole bands). Biomes 11 Steppe and 12 Jungle exist only in v2.
  //     rules (WORLD_RULES §2 presets): 0 earth, 1 mono (param = biome), 2 patchwork (hard Voronoi cells 96 m), 3 absurd (hot poles,
  //     warmer with height, floating islands 40…100 m), 4 inverted (the earth world mirrored around y = −0.5: ground above).
  const CN = 16, CNI = 0.0625, LAT_F = 0.0001220703125, WARP_F = 0.000244140625, LAPSE = 0.004, TAU = 6.283185307179586, HPI = 1.5707963267948966;
  const UPW = [64, 128, 256, 512, 1024, 2048], DRYK = [0.03, 0.03, 0.06, 0.12, 0.2, 0.3];
  const ISL_Y0 = 40, ISL_Y1 = 100, FLAT_UP = 16, FLAT_DN = 16, R45 = 0.7071067811865476;
  const ccos = x => sinp(x + HPI);
  function latPhi(s, x, z){   // 0 equator … 1 pole
    const w = (value2(s, x * WARP_F + 811, z * WARP_F - 377) - 0.5) * 800;
    const u = (z + w) * LAT_F + 0.25;
    const f = u - Math.floor(u + 0.5);
    return (f < 0 ? -f : f) * 2;
  }
  // node (x, z) → o[k] = tb, o[k + 1] = m, o[k + 2] = hs, o[k + 3] = phi
  function climNode(s, x, z, o, k){
    const phi = latPhi(s, x, z);
    const c0 = fbm2(s, x * 0.0025, z * 0.0025, 2);
    const r0 = 1 - Math.abs(fbm2(s, x * 0.006 - 200, z * 0.006 + 300, 2) * 2 - 1);
    let hs = (c0 - 0.45) * 90 + 7 + r0 * r0 * r0 * c0 * 40;
    if (hs < 0) hs = 0;
    const wx = -ccos(phi * TAU), wl = Math.sqrt(wx * wx + 0.09);
    const ux = -wx / wl, uz = -0.3 / wl;
    let q = 0.3, sea1 = 0;
    for (let i = 5; i >= 0; i--) {
      const d = UPW[i], px = x + ux * d, pz = z + uz * d;
      const c = fbm2(s, px * 0.0025, pz * 0.0025, 2);
      const r = 1 - Math.abs(fbm2(s, px * 0.006 - 200, pz * 0.006 + 300, 2) * 2 - 1);
      const h = (c - 0.45) * 90 + 7 + r * r * r * c * 40;
      const sea = sstep(0.47, 0.41, c);
      q = q + (1 - q) * sea * 0.5;
      q = q * (1 - (1 - sea) * DRYK[i]);
      q = q * (1 - 0.5 * sstep(20, 50, h));
      if (i === 0) sea1 = sea;
    }
    const seaH = sstep(0.47, 0.41, c0);
    q = q + (1 - q) * seaH * 0.5;
    const mLat = 0.5 + 0.22 * ccos(phi * 9.42477796076938);
    const rv = Math.abs(fbm2(s, x * 0.0045 + 700, z * 0.0045 - 520, 3) * 2 - 1);
    const riv = (1 - sstep(0, 0.1, rv)) * 0.12;
    const nm = (fbm2(s, x * 0.001 + 999, z * 0.001 - 444, 2) - 0.5) * 0.12;
    const m = cl01(q * 0.65 + mLat * 0.35 + riv + nm);
    const nt = (fbm2(s, x * 0.001 + 400, z * 0.001 - 250, 2) - 0.5) * 0.1;
    let tb = 1 - 1.27 * phi + 0.27 * phi * phi + nt;
    const sn = seaH > sea1 ? seaH : sea1;
    tb = tb + (0.5 - tb) * 0.2 * sn;
    o[k] = tb; o[k + 1] = m; o[k + 2] = hs; o[k + 3] = phi;
  }
  // Whittaker table: 0 Water, 1 Beach, 2 Plains, 3 Forest, 4 Taiga, 5 Desert, 6 Savanna, 7 Swamp, 8 Tundra, 9 Rock, 10 Snow, 11 Steppe, 12 Jungle
  function classify2(tb, m, hs, h){
    if (h < 0) return 0;
    const ts = hs > 8 ? tb - (hs - 8) * LAPSE : tb;
    if (ts < 0.07) return 10;
    if (h < 1.6) return ts < 0.22 ? 8 : 1;
    if (ts < 0.22 && hs > 40) return 9;
    if (ts < 0.22) return 8;
    if (ts < 0.40) return m < 0.40 ? 11 : 4;
    if (ts < 0.62) return m < 0.30 ? 11 : m < 0.52 ? 2 : (m > 0.74 && hs < 8) ? 7 : 3;
    return m < 0.30 ? 5 : m < 0.52 ? 6 : (m > 0.74 && hs < 8) ? 7 : 12;
  }
  function patchBiome(s, x, z){   // rules 2: the nearest of jittered 96 m cells, any land biome, hard borders
    const gx = fl(x / 96), gz = fl(z / 96);
    let best = Infinity, id = 2;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = (gx + dx) | 0, cz = (gz + dz) | 0, h = hash2(s ^ 0x2a5f, cx, cz);
      const fx = (cx + (h & 1023) / 1024) * 96, fz = (cz + ((h >> 10) & 1023) / 1024) * 96;
      const ddx = x - fx, ddz = z - fz, dd = ddx * ddx + ddz * ddz;
      if (dd < best) { best = dd; id = 2 + ((h >> 20) & 4095) % 11; }
    }
    return id;
  }
  // biome from interpolated node values and the column height, by rules
  function biomeOf(rules, param, s, x, z, tb, m, hs, h){
    if (rules === 1) return h < 0 ? 0 : param;
    if (rules === 2) return h < 0 ? 0 : patchBiome(s, x, z);
    if (rules === 3) return classify2(hs > 8 ? 1 - tb + 2 * LAPSE * (hs - 8) : 1 - tb, m, hs, h);
    return classify2(tb, m, hs, h);
  }
  const NB = new Float64Array(16), CL = new Float64Array(8);
  // point query (v2): out[0] tb, [1] m, [2] hs, [3] phi, [4] ts, [5] tp, [6] h, [7] biome; returns the biome
  function climate(s, x, z, rules, param, out){
    out = out || CL;
    const gx = x * CNI, gz = z * CNI, i0 = fl(gx), k0 = fl(gz), fx = gx - i0, fz = gz - k0;
    climNode(s, i0 * CN, k0 * CN, NB, 0); climNode(s, (i0 + 1) * CN, k0 * CN, NB, 4);
    climNode(s, i0 * CN, (k0 + 1) * CN, NB, 8); climNode(s, (i0 + 1) * CN, (k0 + 1) * CN, NB, 12);
    for (let j = 0; j < 4; j++) out[j] = lerp(lerp(NB[j], NB[4 + j], fx), lerp(NB[8 + j], NB[12 + j], fx), fz);
    const h = height(s, x, z);
    out[4] = out[2] > 8 ? out[0] - (out[2] - 8) * LAPSE : out[0]; out[5] = h > 8 ? out[0] - (h - 8) * LAPSE : out[0]; out[6] = h;
    const b = biomeOf(rules | 0, param | 0, s, x, z, out[0], out[1], out[2], h);
    out[7] = b;
    return b;
  }
  // floating islands (rules 3): solid > 0
  function islands(s, x, y, z){
    if (y < ISL_Y0 || y > ISL_Y1) return -1000;
    const t = (y - 70) / 30, taper = 1 - t * t;
    return (fbm3(s, x * 0.012 + 77, y * 0.03, z * 0.012 - 33, 2) - 0.62) * 40 * taper - (1 - taper) * 4;
  }
  const GC = [null, [0.86, 0.80, 0.56], [0.40, 0.65, 0.27], [0.18, 0.45, 0.20], [0.20, 0.38, 0.30], [0.88, 0.76, 0.50], [0.70, 0.64, 0.30],
    [0.25, 0.34, 0.22], [0.55, 0.58, 0.52], [0.45, 0.45, 0.46], [0.95, 0.95, 0.98], [0.66, 0.63, 0.38], [0.12, 0.40, 0.15]];
  const G3 = new Float64Array(3);
  function groundColor(b, h, slope, jitter){   // → G3
    let c0, c1, c2;
    if (b === 0) { const t = cl01(-h / 8); c0 = lerp(0.20, 0.05, t); c1 = lerp(0.55, 0.17, t); c2 = lerp(0.65, 0.45, t); }
    else { const c = GC[b]; c0 = c[0]; c1 = c[1]; c2 = c[2]; }
    if (b !== 0 && b !== 10) { const t = sstep(0.55, 0.95, slope); c0 = lerp(c0, 0.43, t); c1 = lerp(c1, 0.42, t); c2 = lerp(c2, 0.41, t); }
    const v = 0.92 + jitter * 0.16;
    G3[0] = c0 * v; G3[1] = c1 * v; G3[2] = c2 * v;
    return G3;
  }
  const smooth = t => t * t * (3 - 2 * t);
  function tri(c000, c100, c010, c110, c001, c101, c011, c111, tx, ty, tz){
    const x00 = lerp(c000, c100, tx), x10 = lerp(c010, c110, tx), x01 = lerp(c001, c101, tx), x11 = lerp(c011, c111, tx);
    return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
  }
  function value3(s, x, y, z){
    const xi = fl(x), yi = fl(y), zi = fl(z);
    const tx = smooth(x - xi), ty = smooth(y - yi), tz = smooth(z - zi);
    const x1 = (xi + 1) | 0, y1 = (yi + 1) | 0, z1 = (zi + 1) | 0;
    return tri(r3(s, xi, yi, zi), r3(s, x1, yi, zi), r3(s, xi, y1, zi), r3(s, x1, y1, zi),
      r3(s, xi, yi, z1), r3(s, x1, yi, z1), r3(s, xi, y1, z1), r3(s, x1, y1, z1), tx, ty, tz);
  }
  function fbm3(s, x, y, z, oct){
    let sum = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      sum += value3(s, x * f + i * 13.7, y * f - i * 7.3, z * f + i * 5.1) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  }
  function caveCombine(a, b, n3, fade){
    const tunnel = (Math.sqrt(a * a + b * b) - 0.07) * 28;
    const cheese = (0.70 - n3) * 40;
    return mn(tunnel, cheese) + (1 - fade) * 6;
  }
  function caveField(s, x, y, z, h, ent){
    if (y < CAVE_MIN_Y) return 1000;
    const lim = h - 3 + ent * 7;
    if (y > lim) return 1000;
    const fade = sstep(lim, lim - 4, y);
    const a = fbm3(s, x * 0.035, y * 0.05, z * 0.035, 2) - 0.5;
    const b = fbm3(s, x * 0.035 + 50, y * 0.05 + 50, z * 0.035 - 50, 2) - 0.5;
    const n3 = fbm3(s, x * 0.018 - 300, y * 0.03, z * 0.018 + 200, 2);
    return caveCombine(a, b, n3, fade);
  }
  // ops: flat array [x, y, z, r, mode]*n (mode 0 dig, else fill), applied in order
  // mode 0 dig (sphere), 2 flatten (T-115, W2 towns: a pad at y of radius r — cut above with 45° walls up to +16 m, embankment
  // below with 45° slopes down to −16 m), any other mode fill (sphere)
  function applyOps(d, x, y, z, ops, n){
    for (let e = 0; e < n; e++) {
      const o = e * 5, dx = x - ops[o], dy = y - ops[o + 1], dz = z - ops[o + 2], mode = ops[o + 4];
      if (mode === 2) {
        const hd = Math.sqrt(dx * dx + dz * dz) - ops[o + 3];
        let cut = (hd - dy) * R45;
        if (cut < -dy) cut = -dy;
        if (cut < dy - FLAT_UP) cut = dy - FLAT_UP;
        if (cut < d) d = cut;
        let fill = (-dy - hd) * R45;
        if (fill > -dy) fill = -dy;
        if (fill > dy + FLAT_DN) fill = dy + FLAT_DN;
        if (fill > d) d = fill;
        continue;
      }
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) - ops[o + 3];
      if (mode === 0) { if (dist < d) d = dist; } else if (-dist > d) d = -dist;
    }
    return d;
  }
  function density(s, x, y, z, ops, n){
    const h = height(s, x, z);
    let d = h - y;
    const c = caveField(s, x, y, z, h, entrance(s, x, z));
    if (c < d) d = c;
    return ops && n ? applyOps(d, x, y, z, ops, n) : d;
  }
  // by world rules: 3 absurd — + floating islands; 4 inverted — the earth field at y' = −1 − y, edits mirrored the same way
  let IOPS = new Float64Array(5 * 16);
  function densityR(s, x, y, z, ops, n, rules){
    n = ops ? n | 0 : 0;
    if (rules === 4) {
      if (IOPS.length < n * 5) IOPS = new Float64Array(Math.max(n * 5, IOPS.length * 2));
      for (let e = 0; e < n * 5; e += 5) { IOPS[e] = ops[e]; IOPS[e + 1] = -1 - ops[e + 1]; IOPS[e + 2] = ops[e + 2]; IOPS[e + 3] = ops[e + 3]; IOPS[e + 4] = ops[e + 4]; }
      return density(s, x, -1 - y, z, IOPS, n);
    }
    if (rules !== 3) return density(s, x, y, z, ops, n);
    const h = height(s, x, z);
    let d = h - y;
    const c = caveField(s, x, y, z, h, entrance(s, x, z));
    if (c < d) d = c;
    const isl = islands(s, x, y, z);
    if (isl > d) d = isl;
    return n ? applyOps(d, x, y, z, ops, n) : d;
  }
  const heightR = (s, x, z, rules) => (rules === 4 ? -1 - height(s, x, z) : height(s, x, z));
  // horizontal reach of an edit around its centre and the vertical range it can change (m)
  const reachH = (ops, e) => ops[e * 5 + 3] + (ops[e * 5 + 4] === 2 ? FLAT_UP : 0);
  const reachV = (ops, e) => (ops[e * 5 + 4] === 2 ? FLAT_UP : ops[e * 5 + 3]);
  function touches(ops, e, fox, foy, foz){
    const o = e * 5, r = reachH(ops, e) + 3, rv = reachV(ops, e) + 3, bf = B;
    return !(ops[o] + r < fox - 3 || ops[o] - r > fox + bf + 3 || ops[o + 1] + rv < foy - 3 || ops[o + 1] - rv > foy + bf + 3 || ops[o + 2] + r < foz - 3 || ops[o + 2] - r > foz + bf + 3);
  }

  // ─── lattice tables (per block) ───
  const CAVE_N = [[0.035, 0.05, 0.035, 0, 0, 0], [0.035, 0.05, 0.035, 50, 50, -50], [0.018, 0.03, 0.018, -300, 0, 200]];
  function Tab(){ this.x0 = 0; this.y0 = 0; this.z0 = 0; this.nx = 0; this.ny = 0; this.nz = 0; this.ok = false; this.v = new Float64Array(TMAX); }
  Tab.prototype.fill = function (s, lx, ly, lz, hx, hy, hz){
    this.x0 = fl(lx); this.y0 = fl(ly); this.z0 = fl(lz);
    this.nx = (fl(hx) - this.x0 + 2) | 0; this.ny = (fl(hy) - this.y0 + 2) | 0; this.nz = (fl(hz) - this.z0 + 2) | 0;
    this.ok = this.nx > 0 && this.ny > 0 && this.nz > 0 && this.nx * this.ny * this.nz <= TMAX;
    if (!this.ok) return;
    let i = 0;
    for (let iz = 0; iz < this.nz; iz++) for (let iy = 0; iy < this.ny; iy++) for (let ix = 0; ix < this.nx; ix++)
      this.v[i++] = r3(s, (this.x0 + ix) | 0, (this.y0 + iy) | 0, (this.z0 + iz) | 0);
  };
  Tab.prototype.value3 = function (s, x, y, z){
    const xi = fl(x), yi = fl(y), zi = fl(z);
    const tx = smooth(x - xi), ty = smooth(y - yi), tz = smooth(z - zi);
    const ix = (xi - this.x0) | 0, iy = (yi - this.y0) | 0, iz = (zi - this.z0) | 0;
    if (this.ok && ix >= 0 && iy >= 0 && iz >= 0 && ix + 1 < this.nx && iy + 1 < this.ny && iz + 1 < this.nz) {
      const nx = this.nx, nxy = this.nx * this.ny, o = iz * nxy + iy * nx + ix, v = this.v;
      return tri(v[o], v[o + 1], v[o + nx], v[o + nx + 1], v[o + nxy], v[o + nxy + 1], v[o + nxy + nx], v[o + nxy + nx + 1], tx, ty, tz);
    }
    const x1 = (xi + 1) | 0, y1 = (yi + 1) | 0, z1 = (zi + 1) | 0;
    return tri(r3(s, xi, yi, zi), r3(s, x1, yi, zi), r3(s, xi, y1, zi), r3(s, x1, y1, zi),
      r3(s, xi, yi, z1), r3(s, x1, yi, z1), r3(s, xi, y1, z1), r3(s, x1, y1, z1), tx, ty, tz);
  };

  const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const CV = new Float64Array(8), QD = new Uint32Array(4);

  // ─── JS builder (same buffers and steps as the Rust Builder; nothing allocated per block) ───
  function JsCore(cap){
    cap = Math.max(1, Math.min(1 << 20, cap | 0 || DEFAULT_CAP));
    this.kind = 'js'; this.cap = cap;
    this.ed = new Float64Array(5 * 64);
    this.ops = new Float64Array(5 * 64); this.nops = 0;
    this.cols = []; for (let i = 0; i < COLS; i++) this.cols.push({ seed: 0, cx: 0, cz: 0, used: 0, valid: false, hc: new Float64Array(S * S), ent: new Float64Array(S * S), bm: new Uint8Array(S * S), cn: new Float64Array(100), cnOk: false, hmin: 0, hmax: 0 });
    this.tick = 0;
    this.hc = new Float64Array(S * S); this.ent = new Float64Array(S * S); this.bm = new Uint8Array(S * S);
    this.cn = new Float64Array(100); this.cnOk = false;   // v2 climate nodes of the column: 5 × 5 × (tb, m, hs, phi)
    this.gen = 1; this.rules = 0; this.param = 0;
    this.d = new Float64Array(S * S * S); this.vidx = new Uint32Array(C * C * C);
    this.cpos = new Float64Array(C * C * C * 3); this.cnrm = new Float64Array(C * C * C * 3);
    this.tabs = []; for (let i = 0; i < 6; i++) this.tabs.push(new Tab());
    this.pos = new Float32Array(cap * 12); this.nrm = new Int8Array(cap * 16); this.col = new Uint8Array(cap * 16);
    this.info = new Float64Array(8);
    this._out = { pos: this.pos, nrm: this.nrm, col: this.col, info: this.info };
  }
  JsCore.prototype.edits = function (n){
    n = Math.max(1, n | 0) * 5;
    if (this.ed.length < n) { const a = new Float64Array(Math.max(n, this.ed.length * 2)); a.set(this.ed); this.ed = a; }
    return this.ed.subarray(0, n);
  };
  JsCore.prototype.out = function (){ return this._out; };
  // generator version and world rules of this builder (t1_gen): gen 1 | 2, rules 0…4 (> 0 needs gen 2), param — the biome of rules 1
  JsCore.prototype.setGen = function (g, r, p){
    g = g | 0; r = r | 0; p = p | 0;
    if (g < 1 || g > 2 || r < 0 || r > 4 || p < 0 || p > 12 || (r > 0 && g < 2)) return -1;
    if (g !== this.gen || r !== this.rules || p !== this.param) { for (let i = 0; i < COLS; i++) this.cols[i].valid = false; }
    this.gen = g; this.rules = r; this.param = p;
    return 0;
  };
  JsCore.prototype.height = function (s, x, z){ return heightR(s, x, z, this.rules); };
  JsCore.prototype.density = function (s, x, y, z, n){ return densityR(s, x, y, z, this.ed, Math.min(n | 0, this.ed.length / 5), this.rules); };
  JsCore.prototype.climate = function (s, x, z){ return climate(s, x, z, this.rules, this.param, this.climv()); };
  JsCore.prototype.climv = function (){ return this.clim || (this.clim = new Float64Array(8)); };
  JsCore.prototype.climate1 = (s, x, z, k) => (k === 0 ? temperature01(s, x, z) : k === 1 ? moisture01(s, x, z) : k === 2 ? entrance(s, x, z) : k === 3 ? biome(s, x, z) : NaN);
  JsCore.prototype.dispose = function (){};
  // column range as the world shows it: islands reach ISL_Y1 (rules 3); inverted (rules 4) — mirrored
  JsCore.prototype.range = function (){
    const info = this.info;
    if (this.rules === 3 && info[1] < ISL_Y1) info[1] = ISL_Y1;
    else if (this.rules === 4) { const a = info[0]; info[0] = -1 - info[1]; info[1] = -1 - a; }
  };
  JsCore.prototype.colInfo = function (s, cx, cz){ this.info.fill(0); const r = this.column(s | 0, cx | 0, cz | 0) ? 1 : 0; this.range(); return r; };
  JsCore.prototype.column = function (s, cx, cz){
    const info = this.info;
    this.tick++;
    for (let i = 0; i < COLS; i++) {
      const c = this.cols[i];
      if (c.valid && c.seed === s && c.cx === cx && c.cz === cz) {
        c.used = this.tick; this.hc.set(c.hc); this.ent.set(c.ent); this.bm.set(c.bm); this.cn.set(c.cn); this.cnOk = c.cnOk;
        info[0] = c.hmin; info[1] = c.hmax; return true;
      }
    }
    const fox = cx * 32, foz = cz * 32;
    let hmin = Infinity, hmax = -Infinity;
    for (let k = 0; k < S; k++) for (let i = 0; i < S; i++) {
      const wx = fox + i - 1, wz = foz + k - 1, h = height(s, wx, wz);
      this.hc[k * S + i] = h; this.ent[k * S + i] = entrance(s, wx, wz);
      if (h > hmax) hmax = h;
      if (h < hmin) hmin = h;
    }
    this.bm.fill(255); this.cnOk = false;
    info[0] = hmin; info[1] = hmax;
    let best = 0;
    for (let i = 0; i < COLS; i++) { const c = this.cols[i]; if (!c.valid) { best = i; break; } if (c.used < this.cols[best].used) best = i; }
    const c = this.cols[best];
    c.seed = s; c.cx = cx; c.cz = cz; c.used = this.tick; c.valid = true; c.hmin = hmin; c.hmax = hmax;
    c.hc.set(this.hc); c.ent.set(this.ent); c.bm.set(this.bm); c.cnOk = false;
    return false;
  };
  JsCore.prototype.fbm3t = function (n, s, x, y, z){
    const N = CAVE_N[n], ax = x * N[0] + N[3], ay = y * N[1] + N[4], az = z * N[2] + N[5];
    let sum = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < 2; i++) {
      sum += this.tabs[n * 2 + i].value3(s, ax * f + i * 13.7, ay * f - i * 7.3, az * f + i * 5.1) * amp;
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };
  JsCore.prototype.build = function (s, cx, cy, cz, nEd){
    s |= 0; cx |= 0; cy |= 0; cz |= 0;
    if (!(nEd >= 0)) return -1;
    if (this.rules !== 4) { const q = this.buildE(s, cx, cy, cz, nEd, false); this.range(); return q; }
    const q = this.buildE(s, cx, ~cy, cz, nEd, true);   // inverted: the earth block −1 − cy, mirrored
    if (q > 0) this.flipOut(q);
    this.range();
    return q;
  };
  // mirror the output around the block's local y = 15.5 (world y' = −1 − y): y → 31 − y, normal y → −y, winding reversed (1 ↔ 3)
  JsCore.prototype.flipOut = function (q){
    const P = this.pos, N = this.nrm;
    for (let k = 0; k < q; k++) {
      for (let m = 0; m < 4; m++) { const o = (k * 4 + m) * 3 + 1; P[o] = 31 - P[o]; N[(k * 4 + m) * 4 + 1] = -N[(k * 4 + m) * 4 + 1]; }
      const a = (k * 4 + 1) * 3, b = (k * 4 + 3) * 3;
      for (let j = 0; j < 3; j++) { const t = P[a + j]; P[a + j] = P[b + j]; P[b + j] = t; }
      const an = (k * 4 + 1) * 4, bn = (k * 4 + 3) * 4;
      for (let j = 0; j < 4; j++) { const t = N[an + j]; N[an + j] = N[bn + j]; N[bn + j] = t; }
    }
  };
  JsCore.prototype.buildE = function (s, cx, cy, cz, nEd, flip){
    const info = this.info, d = this.d, bf = B;
    const fox = cx * 32, foy = cy * 32, foz = cz * 32;
    info.fill(0);
    this.ccx = cx; this.ccz = cz;
    // edits touching the block (order kept); inverted worlds mirror them into the earth block first
    const n = Math.min(nEd | 0, (this.ed.length / 5) | 0), ed = this.ed;
    if (this.ops.length < n * 5) this.ops = new Float64Array(Math.max(n * 5, this.ops.length * 2));
    let no = 0;
    for (let e = 0; e < n; e++) {
      this.ops.set(ed.subarray(e * 5, e * 5 + 5), no * 5);
      if (flip) this.ops[no * 5 + 1] = -1 - this.ops[no * 5 + 1];
      if (touches(this.ops, no, fox, foy, foz)) no++;
    }
    this.nops = no; info[5] = no;
    const hit = this.column(s, cx, cz);
    info[7] = hit ? 1 : 0;
    const hmax = info[1], isl = this.rules === 3, hmaxB = isl && hmax < ISL_Y1 ? ISL_Y1 : hmax;
    if (no === 0 && (foy > hmaxB + 2 || foy + bf < CAVE_MIN_Y - 2)) return 0;
    const caves = !(foy + bf < CAVE_MIN_Y || foy - 1 > hmax + 4);
    if (caves) {
      for (let ni = 0; ni < 3; ni++) {
        const N = CAVE_N[ni];
        const a0x = (fox - 1) * N[0] + N[3], a0y = (foy - 1) * N[1] + N[4], a0z = (foz - 1) * N[2] + N[5];
        const a1x = (fox + bf) * N[0] + N[3], a1y = (foy + bf) * N[1] + N[4], a1z = (foz + bf) * N[2] + N[5];
        for (let oc = 0; oc < 2; oc++) {
          const f = oc === 0 ? 1 : 2, fi = oc;
          this.tabs[ni * 2 + oc].fill(s, a0x * f + fi * 13.7, a0y * f - fi * 7.3, a0z * f + fi * 5.1, a1x * f + fi * 13.7, a1y * f - fi * 7.3, a1z * f + fi * 5.1);
        }
      }
      info[6] = 1;
    }
    // densities
    const ops = this.ops, hc = this.hc, entA = this.ent;
    let anyPos = false, anyNeg = false;
    for (let k = 0; k < S; k++) for (let i = 0; i < S; i++) {
      const ci = k * S + i, wx = fox + i - 1, wz = foz + k - 1, h = hc[ci], ent = entA[ci], lim = h - 3 + ent * 7;
      for (let j = 0; j < S; j++) {
        const y = foy + j - 1;
        let v = h - y;
        if (!(y < CAVE_MIN_Y) && !(y > lim)) {
          const fade = sstep(lim, lim - 4, y);
          const a = this.fbm3t(0, s, wx, y, wz) - 0.5, b = this.fbm3t(1, s, wx, y, wz) - 0.5, n3 = this.fbm3t(2, s, wx, y, wz);
          const c = caveCombine(a, b, n3, fade);
          if (c < v) v = c;
        } else if (1000 < v) v = 1000;
        if (isl) { const w = islands(s, wx, y, wz); if (w > v) v = w; }
        if (no) v = applyOps(v, wx, y, wz, ops, no);
        d[(k * S + j) * S + i] = v;
        if (v > 0) anyPos = true; else anyNeg = true;
      }
    }
    if (!(anyPos && anyNeg)) return 0;
    // vertices
    const vidx = this.vidx, cpos = this.cpos, cnrm = this.cnrm, cv = CV;
    let nv = 0;
    for (let ck = 0; ck < C; ck++) for (let cj = 0; cj < C; cj++) for (let ci = 0; ci < C; ci++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const v = d[((ck + ((c >> 2) & 1)) * S + cj + ((c >> 1) & 1)) * S + ci + (c & 1)];
        cv[c] = v;
        if (v > 0) mask |= 1 << c;
      }
      const vi = (ck * C + cj) * C + ci;
      if (mask === 0 || mask === 255) { vidx[vi] = NONE; continue; }
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = EDGE_A[e], b = EDGE_B[e];
        if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
        const t = cv[a] / (cv[a] - cv[b]);
        sx += lerp(a & 1, b & 1, t);
        sy += lerp((a >> 1) & 1, (b >> 1) & 1, t);
        sz += lerp((a >> 2) & 1, (b >> 2) & 1, t);
        cnt += 1;
      }
      const gx = (cv[1] - cv[0]) + (cv[3] - cv[2]) + (cv[5] - cv[4]) + (cv[7] - cv[6]);
      const gy = (cv[2] - cv[0]) + (cv[3] - cv[1]) + (cv[6] - cv[4]) + (cv[7] - cv[5]);
      const gz = (cv[4] - cv[0]) + (cv[5] - cv[1]) + (cv[6] - cv[2]) + (cv[7] - cv[3]);
      vidx[vi] = nv;
      const o = nv * 3;
      cpos[o] = ci - 1 + sx / cnt; cpos[o + 1] = cj - 1 + sy / cnt; cpos[o + 2] = ck - 1 + sz / cnt;
      const ax = -gx, ay = -gy, az = -gz, l2 = ax * ax + ay * ay + az * az;
      if (l2 > 1e-8) { const l = Math.sqrt(l2); cnrm[o] = ax / l; cnrm[o + 1] = ay / l; cnrm[o + 2] = az / l; }
      else { cnrm[o] = 0; cnrm[o + 1] = 1; cnrm[o + 2] = 0; }
      nv++;
    }
    info[4] = nv;
    // quads
    let q = 0, trunc = false;
    const cap = this.cap, qd = QD;
    outer:
    for (let k = 1; k <= 32; k++) for (let j = 1; j <= 32; j++) for (let i = 1; i <= 32; i++) {
      const s0 = d[(k * S + j) * S + i] > 0;
      for (let axis = 0; axis < 3; axis++) {
        const s1 = axis === 0 ? d[(k * S + j) * S + i + 1] > 0 : axis === 1 ? d[(k * S + j + 1) * S + i] > 0 : d[((k + 1) * S + j) * S + i] > 0;
        if (s0 === s1) continue;
        if (axis === 0) { qd[0] = vidx[((k - 1) * C + j - 1) * C + i]; qd[1] = vidx[((k - 1) * C + j) * C + i]; qd[2] = vidx[(k * C + j) * C + i]; qd[3] = vidx[(k * C + j - 1) * C + i]; }
        else if (axis === 1) { qd[0] = vidx[((k - 1) * C + j) * C + i - 1]; qd[1] = vidx[((k - 1) * C + j) * C + i]; qd[2] = vidx[(k * C + j) * C + i]; qd[3] = vidx[(k * C + j) * C + i - 1]; }
        else { qd[0] = vidx[(k * C + j - 1) * C + i - 1]; qd[1] = vidx[(k * C + j - 1) * C + i]; qd[2] = vidx[(k * C + j) * C + i]; qd[3] = vidx[(k * C + j) * C + i - 1]; }
        if (qd[0] === NONE || qd[1] === NONE || qd[2] === NONE || qd[3] === NONE) continue;
        if (q >= cap) { trunc = true; break outer; }
        this.emit(s, q, fox, foy, foz);
        q++;
      }
    }
    if (q > 0) for (let i = 0; i < COLS; i++) { const c = this.cols[i]; if (c.valid && c.seed === s && c.cx === cx && c.cz === cz) { c.bm.set(this.bm); c.cn.set(this.cn); c.cnOk = this.cnOk; break; } }
    info[2] = q; info[3] = trunc ? 1 : 0;
    return q;
  };
  JsCore.prototype.emit = function (s, q, fox, foy, foz){
    const P = this.cpos, Nn = this.cnrm, qd = QD;
    const a = qd[0], b = qd[1], c = qd[2], e = qd[3];
    const p0x = P[a * 3], p0y = P[a * 3 + 1], p0z = P[a * 3 + 2], p1x = P[b * 3], p1y = P[b * 3 + 1], p1z = P[b * 3 + 2];
    const p2x = P[c * 3], p2y = P[c * 3 + 1], p2z = P[c * 3 + 2], p3x = P[e * 3], p3y = P[e * 3 + 1], p3z = P[e * 3 + 2];
    const nx = (Nn[a * 3] + Nn[b * 3]) + (Nn[c * 3] + Nn[e * 3]);
    const ny = (Nn[a * 3 + 1] + Nn[b * 3 + 1]) + (Nn[c * 3 + 1] + Nn[e * 3 + 1]);
    const nz = (Nn[a * 3 + 2] + Nn[b * 3 + 2]) + (Nn[c * 3 + 2] + Nn[e * 3 + 2]);
    const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z, vx = p2x - p0x, vy = p2y - p0y, vz = p2z - p0z, wx = p3x - p0x, wy = p3y - p0y, wz = p3z - p0z;
    const gx = (uy * vz - uz * vy) + (vy * wz - vz * wy);
    const gy = (uz * vx - ux * vz) + (vz * wx - vx * wz);
    const gz = (ux * vy - uy * vx) + (vx * wy - vy * wx);
    const flip = gx * nx + gy * ny + gz * nz < 0;
    const pos = this.pos, nrm = this.nrm;
    for (let m = 0; m < 4; m++) {
      const vi = m === 0 ? a : m === 2 ? c : (m === 1) !== flip ? b : e;
      const o = (q * 4 + m) * 3, on = (q * 4 + m) * 4;
      pos[o] = P[vi * 3]; pos[o + 1] = P[vi * 3 + 1]; pos[o + 2] = P[vi * 3 + 2];
      nrm[on] = q8(Nn[vi * 3]); nrm[on + 1] = q8(Nn[vi * 3 + 1]); nrm[on + 2] = q8(Nn[vi * 3 + 2]); nrm[on + 3] = 0;
    }
    const cx = (p0x + p1x + p2x + p3x) * 0.25, cy = (p0y + p1y + p2y + p3y) * 0.25, cz = (p0z + p1z + p2z + p3z) * 0.25;
    // norm_or_up(n_avg)
    let nnx, nny, nnz;
    const l2 = nx * nx + ny * ny + nz * nz;
    if (l2 > 1e-8) { const l = Math.sqrt(l2); nnx = nx / l; nny = ny / l; nnz = nz / l; } else { nnx = 0; nny = 1; nnz = 0; }
    this.quadColor(s, cx, cy, cz, nny, fox, foy, foz);
    const col = this.col, r = QC[0], g = QC[1], bb = QC[2];
    for (let m = 0; m < 4; m++) { const o = (q * 4 + m) * 4; col[o] = r; col[o + 1] = g; col[o + 2] = bb; col[o + 3] = 255; }
  };
  const QC = new Uint8Array(3);
  // v2 biome of column sample (ci, ck): the column's 5 × 5 climate nodes (computed once per column) interpolated — the same values as
  // the point query climate() at that sample
  JsCore.prototype.biome2 = function (s, ci, ck, cwx, cwz, h){
    const cn = this.cn;
    if (!this.cnOk) {
      const bx = this.ccx * 2 - 1, bz = this.ccz * 2 - 1;
      for (let k = 0; k < 5; k++) for (let i = 0; i < 5; i++) climNode(s, (bx + i) * CN, (bz + k) * CN, cn, (k * 5 + i) * 4);
      this.cnOk = true;
    }
    const a = ci - 1, la = a >= 0 ? a >> 4 : -1, fx = (a - la * 16) * CNI;
    const b = ck - 1, lb = b >= 0 ? b >> 4 : -1, fz = (b - lb * 16) * CNI;
    const o00 = ((lb + 1) * 5 + la + 1) * 4, o10 = o00 + 4, o01 = o00 + 20, o11 = o00 + 24;
    const tb = lerp(lerp(cn[o00], cn[o10], fx), lerp(cn[o01], cn[o11], fx), fz);
    const m = lerp(lerp(cn[o00 + 1], cn[o10 + 1], fx), lerp(cn[o01 + 1], cn[o11 + 1], fx), fz);
    const hs = lerp(lerp(cn[o00 + 2], cn[o10 + 2], fx), lerp(cn[o01 + 2], cn[o11 + 2], fx), fz);
    return biomeOf(this.rules, this.param, s, cwx, cwz, tb, m, hs, h);
  };
  JsCore.prototype.quadColor = function (s, px, py, pz, n1, fox, foy, foz){
    const ci = clampi((rnd(px) | 0) + 1, 0, S - 1), ck = clampi((rnd(pz) | 0) + 1, 0, S - 1);
    const h = this.hc[ck * S + ci];
    const wx = fox + px, wy = foy + py, wz = foz + pz;
    const depth = h - wy;
    const jit01 = rand2(s, (fl(wx * 3) + Math.imul(fl(wy * 5), 977)) | 0, fl(wz * 3));
    const strata = sinp(wy * 0.8 + value3(s, wx * 0.05, wy * 0.02, wz * 0.05) * 6) * 0.5 + 0.5;
    let r0 = lerp(0.30, 0.46, strata), r1 = lerp(0.29, 0.43, strata), r2 = lerp(0.30, 0.40, strata);
    const ore = value3(s, wx * 0.2 + 31, wy * 0.2, wz * 0.2 - 17);
    if (ore > 0.80) {
      const r = rand2(s, (Math.imul(fl(wx / 5), 7) + Math.imul(fl(wy / 5), 13)) | 0, fl(wz / 5));
      let o0, o1, o2;
      if (r < 0.5) { o0 = 0.62; o1 = 0.40; o2 = 0.28; }
      else if (r < 0.8) { o0 = 0.30; o1 = 0.68; o2 = 0.58; }
      else if (r < 0.93 || wy > -5) { o0 = 0.45; o1 = 0.55; o2 = 1.0; }
      else { o0 = 0.95; o1 = 0.78; o2 = 0.20; }
      const t = sstep(0.80, 0.84, ore);
      r0 = lerp(r0, o0, t); r1 = lerp(r1, o1, t); r2 = lerp(r2, o2, t);
    }
    const jit = 0.94 + jit01 * 0.12;
    r0 = r0 * jit; r1 = r1 * jit; r2 = r2 * jit;
    const surf = 1 - sstep(1.2, 2.8, depth);
    if (surf > 0) {
      const bi = ck * S + ci;
      if (this.bm[bi] === 255) { const cwx = fox + ci - 1, cwz = foz + ck - 1; this.bm[bi] = this.gen >= 2 ? this.biome2(s, ci, ck, cwx, cwz, h) : classify(temperature01(s, cwx, cwz), moisture01(s, cwx, cwz), h); }
      let slope;
      if (n1 < 0.1) slope = 5; else { const t = 1 - n1 * n1; slope = Math.sqrt(t > 0 ? t : 0) / n1; }
      const g = groundColor(this.bm[bi], h, slope, jit01);
      r0 = lerp(r0, g[0], surf); r1 = lerp(r1, g[1], surf); r2 = lerp(r2, g[2], surf);
    }
    QC[0] = qc(r0); QC[1] = qc(r1); QC[2] = qc(r2);
  };

  // ─── wasm build of the same core ───
  async function wasm(bytes, cap){
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const x = instance.exports;
    if (x.t1_version() !== ABI || x.t1_block() !== B) throw new Error('terra.wasm: ABI ' + x.t1_version());
    cap = Math.max(1, Math.min(1 << 20, cap | 0 || DEFAULT_CAP));
    const b = x.t1_new(cap);
    if (!b) throw new Error('terra.wasm: no builder');
    const core = { kind: 'wasm', cap, x, b, _buf: null, _ep: 0, _en: 0, _out: { pos: null, nrm: null, col: null, info: null } };
    const views = () => {
      const buf = x.memory.buffer;
      if (core._buf === buf) return;
      core._buf = buf;
      const o = core._out;
      o.pos = new Float32Array(buf, x.t1_pos(b), cap * 12); o.nrm = new Int8Array(buf, x.t1_nrm(b), cap * 16);
      o.col = new Uint8Array(buf, x.t1_col(b), cap * 16); o.info = new Float64Array(buf, x.t1_info(b), 8);
      core._ev = null; core._cv = null;
    };
    core.edits = n => {
      n = Math.max(1, n | 0);
      const p = x.t1_edits(b, n);
      if (!p) throw new Error('terra.wasm: edits');
      views();
      if (!core._ev || core._ep !== p || core._en !== n) { core._ev = new Float64Array(x.memory.buffer, p, n * 5); core._ep = p; core._en = n; }
      return core._ev;
    };
    core.build = (s, cx, cy, cz, n) => { const q = x.t1_build(b, s | 0, cx | 0, cy | 0, cz | 0, n | 0); views(); return q; };
    core.out = () => { views(); return core._out; };
    core.colInfo = (s, cx, cz) => { const r = x.t1_column(b, s | 0, cx | 0, cz | 0); views(); return r; };
    core.height = (s, xx, z) => x.t1_bheight(b, s | 0, xx, z);   // by the builder's world rules (rules 4: the mirrored ceiling)
    // ABI 2: generator version / world rules of this builder; v2 point climate → [tb, m, hs, phi, ts, tp, h, biome] (a view of wasm memory)
    core.gen = core.rules = 0;
    core.setGen = (g, r, p) => { const rc = x.t1_gen(b, g | 0, r | 0, p | 0); if (!rc) { core.gen = g | 0; core.rules = r | 0; } return rc; };
    core.climate = (s, xx, z) => { const bi = x.t1_clim(b, s | 0, xx, z); views(); return bi; };
    core.climv = () => { views(); return core._cv || (core._cv = new Float64Array(x.memory.buffer, x.t1_climv(b), 8)); };
    // v1 climate fields — k: 0 temperature01, 1 moisture01, 2 cave entrance, 3 biome
    core.climate1 = (s, xx, z, k) => x.t1_climate(s | 0, xx, z, k | 0);
    core.density = (s, xx, y, z, n) => x.t1_density(b, s | 0, xx, y, z, n | 0);
    core.dispose = () => { if (core.b) { x.t1_free(core.b); core.b = 0; } };
    views();
    return core;
  }

  // FNV-1a 64 over (pos bytes LE, nrm, col) — 16-bit limbs, no BigInt
  function meshHash(out, q){
    let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
    const step = byte => {
      h0 ^= byte;
      let c = h0 * 0x1b3; const n0 = c & 0xffff; c = Math.floor(c / 65536) + h1 * 0x1b3;
      const n1 = c & 0xffff; c = Math.floor(c / 65536) + h2 * 0x1b3 + h0 * 0x100;
      const n2 = c & 0xffff; c = Math.floor(c / 65536) + h3 * 0x1b3 + h1 * 0x100;
      h3 = c & 0xffff; h2 = n2; h1 = n1; h0 = n0;
    };
    const pb = new Uint8Array(out.pos.buffer, out.pos.byteOffset, q * 48);
    for (let i = 0; i < pb.length; i++) step(pb[i]);
    for (let i = 0; i < q * 16; i++) step(out.nrm[i] & 0xff);
    for (let i = 0; i < q * 16; i++) step(out.col[i]);
    const hx = v => v.toString(16).padStart(4, '0');
    return hx(h3) + hx(h2) + hx(h1) + hx(h0);
  }

  // the physics copy of a block (terra.js): local positions as Uint16 ((v + 1) · 1927, 0.52 mm) right after the mesh in the block
  // buffer — pos f32 q·48 B | nrm q·16 | col q·16 | phys u16 q·24 = q·104 B; made in the worker, the page only copies it (memcpy)
  const PHYS_Q = 1927, BLOCK_BYTES = 104;
  function physPack(pos, q, ab){ const d = new Uint16Array(ab, q * 80, q * 12); for (let i = 0; i < q * 12; i++) d[i] = Math.round((pos[i] + 1) * PHYS_Q); }
  // compact block (T-115, ×2.4 less memory on the page): pos u16 q·24 B ((v + 1) · 1927 — the SAME numbers the physics uses, so the
  // page keeps one array for both) | normal octahedral u8×2 q·8 B (y-major: up-facing terrain keeps the most precision) | colour u8×3
  // q·12 B = q·44 B. Decode (terra-mesh vertex shader): p = n·2 − 1, v = (p.x, 1 − |p.x| − |p.y|, p.y); v.y < 0 → v.xz =
  // (1 − |v.zx|)·sign(v.xz); normalize.
  const COMPACT_BYTES = 44;
  function compactPack(out, q, ab){
    const P = new Uint16Array(ab, 0, q * 12), N = new Uint8Array(ab, q * 24, q * 8), Cc = new Uint8Array(ab, q * 32, q * 12), pos = out.pos, nrm = out.nrm, col = out.col;
    for (let i = 0; i < q * 12; i++) P[i] = Math.round((pos[i] + 1) * PHYS_Q);
    for (let v = 0; v < q * 4; v++) {
      const x = nrm[v * 4], y = nrm[v * 4 + 1], z = nrm[v * 4 + 2], l1 = (x < 0 ? -x : x) + (y < 0 ? -y : y) + (z < 0 ? -z : z) || 1;
      let px = x / l1, pz = z / l1;
      if (y < 0) { const ax = 1 - (pz < 0 ? -pz : pz), az = 1 - (px < 0 ? -px : px); px = px >= 0 ? ax : -ax; pz = pz >= 0 ? az : -az; }
      N[v * 2] = Math.round((px * 0.5 + 0.5) * 255); N[v * 2 + 1] = Math.round((pz * 0.5 + 0.5) * 255);
      Cc[v * 3] = col[v * 4]; Cc[v * 3 + 1] = col[v * 4 + 1]; Cc[v * 3 + 2] = col[v * 4 + 2];
    }
  }
  const T1 = { B, S, C, ABI, CAVE_MIN_Y, DEFAULT_CAP, js: cap => new JsCore(cap), wasm, height, density, biome, entrance, temperature01, moisture01,
    touches, meshHash, sinp, hash2, hash3, PHYS_Q, BLOCK_BYTES, physPack, COMPACT_BYTES, compactPack,
    densityR, heightR, reachH, reachV, FLAT_UP, ISL_Y1, climate, classify2, climNode, latPhi, patchBiome, islands, GEN_MAX: 2, RULES: ['earth', 'mono', 'patchwork', 'absurd', 'inverted'],
    BIOMES: ['water', 'beach', 'plains', 'forest', 'taiga', 'desert', 'savanna', 'swamp', 'tundra', 'rock', 'snow', 'steppe', 'jungle'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = T1;
  const E = root.D37E = root.D37E || {};
  E.terraCore = T1;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);

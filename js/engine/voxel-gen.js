// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — генерация «Кубомира» по зерну: шум (свой симплекс), биомы, рельеф, реки, пещеры, ущелья, руды,
//  деревья, озёра, лава, трава и цветы. Бесконечно: любой чанк — чистая функция (зерно, cx, cz)
// ═══════════════════════════════════════
// Только + − × ÷ floor sqrt (без sin/pow/exp): один и тот же чанк одинаков в любом браузере и в node — по зерну можно
// не хранить мир, а сохранять только правки игрока. G = V.genInit(зерно, { features }) → V.genChunk(G, cx, cz) →
// { ids: Uint16Array, biome: Uint8Array(256), tint: Uint8Array(256 × 9) (трава, листва, вода — RGB), zone: Uint8Array(256) }.
// zone — климат столба для погоды игры (V.climZone): 0 — времена года, 1 — всегда зима, 2 — зимы не бывает.
// Деревья, валуны, озёра пересекают границы чанков: чанк смотрит «происхождения» соседей 3×3 и пишет свою часть.
// Биомы: 0 океан, 1 пляж, 2 равнина, 3 лес, 4 березняк, 5 пустыня, 6 снега, 7 горы, 8 болото, 9 река.
// Версии (meta.genVer мира): 1 — до 16.10, 2 — извилистые границы биомов, 3 (T-022b, 22.10) — деревья «как в модах» (js/engine/trees.js:
// породы по биому и климату, ствол 2×2 / 3×3 у корня, сучья, корни, тонкие ветки, молодые деревья). Старые миры — свои версии: блоки
// несохранённых чанков ровно как раньше (проверка — kubomir-hand-test, «генератор»). 4 (T-116, 29.10) — логичные биомы: климат по
// широте, высоте, морю по ветру и «тени» гор → таблица Уиттекера (E:\d37-core\spec\WORLD_RULES.md §1): жара никогда не рядом
// с зимой, снег на вершинах — по температуре на высоте, без одиноких пятен. Высоты те же (кроме дюн и болот — по новому климату).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  const H = V.H, SEA = V.SEA;
  V.BIOMES = ['Океан', 'Пляж', 'Равнина', 'Лес', 'Березняк', 'Пустыня', 'Снега', 'Горы', 'Болото', 'Река'];
  V.BIOME_IDS = ['ocean', 'beach', 'plains', 'forest', 'birch', 'desert', 'snow', 'mountains', 'swamp', 'river'];
  const BI = { ocean: 0, beach: 1, plains: 2, forest: 3, birch: 4, desert: 5, snow: 6, mountains: 7, swamp: 8, river: 9 };
  // цвета биомов: трава, листва, вода. Вода (T-044, 22.10.2026; шейдер воды берёт из цвета и мутность: зеленее — мутнее):
  // океан — глубокий синий, река и берег — светлее и бирюзовее, болото — зеленовато-бурое, снега — холодный синий, пустыня — бирюза
  const TINTS = [
    ['#8ab689', '#6aa54c', '#2c5fc8'], ['#8fbf5f', '#6aa54c', '#3b8ade'], ['#7cbd5a', '#5fa83e', '#3f7fe0'], ['#5aa83a', '#4a9a2e', '#3c79d8'],
    ['#82ab58', '#6e9e48', '#3f80e0'], ['#bfb35a', '#a8a24a', '#36a2d6'], ['#86b49a', '#5f9a6a', '#4867c6'], ['#8aaa85', '#6a9a62', '#3e76cf'],
    ['#6d7a3f', '#5c6e32', '#5b6e45'], ['#7cbd5a', '#5fa83e', '#4a9ae6'],
  ].map(r => r.map(h => { const v = parseInt(h.slice(1), 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }));
  V.BIOME_TINTS = TINTS;
  V.ZONES = { normal: 0, cold: 1, warm: 2 };

  // ═══ Шум: симплекс 2D/3D (по статье С. Густавсона), перестановки — от зерна ═══
  const F2 = .5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;
  const GR = new Float64Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);
  function makeNoise(seed){
    const r = V.rng(seed), p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint16Array(512), g12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; g12[i] = perm[i] % 12; }
    return { perm, g12, ox: r() * 1000, oz: r() * 1000 };
  }
  function n2(N, xin, yin){
    const perm = N.perm, g = N.g12;
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s), t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, k;
    tt = .5 - x0 * x0 - y0 * y0; if (tt > 0) { k = g[ii + perm[jj]] * 3; tt *= tt; n += tt * tt * (GR[k] * x0 + GR[k + 1] * y0); }
    tt = .5 - x1 * x1 - y1 * y1; if (tt > 0) { k = g[ii + i1 + perm[jj + j1]] * 3; tt *= tt; n += tt * tt * (GR[k] * x1 + GR[k + 1] * y1); }
    tt = .5 - x2 * x2 - y2 * y2; if (tt > 0) { k = g[ii + 1 + perm[jj + 1]] * 3; tt *= tt; n += tt * tt * (GR[k] * x2 + GR[k + 1] * y2); }
    return 70 * n;
  }
  function n3(N, xin, yin, zin){
    const perm = N.perm, g = N.g12;
    const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k0 = Math.floor(zin + s), t = (i + j + k0) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k0 - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) { if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; } else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; } }
    else { if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; } else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; } else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; } }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3, x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k0 & 255;
    let n = 0, tt, q;
    tt = .6 - x0 * x0 - y0 * y0 - z0 * z0; if (tt > 0) { q = g[ii + perm[jj + perm[kk]]] * 3; tt *= tt; n += tt * tt * (GR[q] * x0 + GR[q + 1] * y0 + GR[q + 2] * z0); }
    tt = .6 - x1 * x1 - y1 * y1 - z1 * z1; if (tt > 0) { q = g[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; tt *= tt; n += tt * tt * (GR[q] * x1 + GR[q + 1] * y1 + GR[q + 2] * z1); }
    tt = .6 - x2 * x2 - y2 * y2 - z2 * z2; if (tt > 0) { q = g[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; tt *= tt; n += tt * tt * (GR[q] * x2 + GR[q + 1] * y2 + GR[q + 2] * z2); }
    tt = .6 - x3 * x3 - y3 * y3 - z3 * z3; if (tt > 0) { q = g[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; tt *= tt; n += tt * tt * (GR[q] * x3 + GR[q + 1] * y3 + GR[q + 2] * z3); }
    return 32 * n;
  }
  // сумма октав, нормирована к ≈ −1…1
  function fbm2(N, x, z, oct){ let a = 1, f = 1, s = 0, m = 0; for (let o = 0; o < oct; o++) { s += a * n2(N, x * f + N.ox * o, z * f + N.oz * o); m += a; a *= .5; f *= 2.03; } return s / m; }
  function fbm3(N, x, y, z, oct){ let a = 1, f = 1, s = 0, m = 0; for (let o = 0; o < oct; o++) { s += a * n3(N, x * f, y * f, z * f); m += a; a *= .5; f *= 2.01; } return s / m; }
  const ss = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  V.noise = { makeNoise, n2, n3, fbm2, fbm3 };

  // ═══ Генератор ═══
  V.genInit = (seed, o = {}) => {
    seed = V.seedOf(seed);
    const mk = k => makeNoise(V.hash(seed, k, 7919));
    const G = { seed, nC: mk(1), nE: mk(2), nP: mk(3), nH: mk(4), nD: mk(5), nR: mk(6), nT: mk(7), nM: mk(8), nC1: mk(9), nC2: mk(10), nC3: mk(11), nRv: mk(12), nRm: mk(13), nDune: mk(14), nFl: mk(15),
      features: Array.isArray(o.features) ? o.features : [], ores: null, id: V.ID || {}, oc: new Map(),
      // версия генератора (meta.genVer мира; нет — 1): 2 — границы биомов извилистые (сдвиг шума), у снегов — переходная полоса
      // (снег пятнами, смешанные деревья). Старые миры остаются на 1 — несохранённые чанки иначе выросли бы другими
      ver: o.ver >= 4 ? 4 : o.ver >= 3 ? 3 : o.ver >= 2 ? 2 : 1, nW1: mk(16), nW2: mk(17), nPt: mk(18), tc: new Map(), cn4: null };
    if (G.ver >= 3 && !root.D37E.trees) throw new Error('генератор v3: нет js/engine/trees.js');
    const ID = G.id;
    // руды: блок, замена, высота, размер жилы, попыток на чанк
    G.ores = [
      { b: ID.ore_coal, minY: 5, maxY: 100, size: 9, n: 18 }, { b: ID.ore_iron, minY: 5, maxY: 64, size: 7, n: 12 },
      { b: ID.ore_gold, minY: 5, maxY: 32, size: 6, n: 3 }, { b: ID.ore_diamond, minY: 4, maxY: 16, size: 5, n: 1.2 },
      { b: ID.gravel, minY: 5, maxY: 90, size: 14, n: 4 }, { b: ID.dirt, minY: 20, maxY: 100, size: 14, n: 4 },
    ];
    for (const f of G.features) if (f.type === 'ore' && f.block > 0) G.ores.push({ b: f.block, minY: f.minY ?? 5, maxY: f.maxY ?? 64, size: f.size ?? 6, n: f.perChunk ?? 2, replace: f.replace, biomes: f.biomes, mod: true });   // руды модов — после ванили (ваниль не меняется)
    G.void = G.features.some(f => f && f.type === 'void');   // мир без земли — весь из сохранения (перенос из Minecraft)
    return G;
  };

  // ═══ v4 (T-116): логичный климат. Узлы через 32 блока (кэш на мир, типизированные массивы — без мусора), между ними — по
  // билинейке: tb — температура на уровне моря 0…1 (широта: «пила» вдоль изогнутой z, экватор → полюс 4096 блоков, начало мира — в
  // умеренном поясе; шум ±0,06; море смягчает; узлы — через 32 блока), m — влажность 0…1 (воздух по ветру: 6 точек 64…2048 блоков против ветра — над морем
  // набирает, над сушей сохнет, за горами «тень»; пояса: влажные тропики, сухие субтропики, влажный умеренный, сухой полярный;
  // реки), hs — сглаженная высота (без холмов). ts = tb − 0,004 × (hs − SEA − 8) — для биома, tp — то же по настоящей высоте (снег
  // на вершинах). Только + − × ÷ floor sqrt и свой синус (sinT) — у всех одинаково ═══
  V.GEN_LATEST = 4;
  const UPW4 = [64, 128, 256, 512, 1024, 2048], DRYK4 = [.03, .03, .06, .12, .2, .3], LAPSE4 = .004, TAU = 6.283185307179586;
  const cl01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
  function baseH4(G, x, z, C){   // сглаженная высота: без холмов, рек и отдельных гребней (горный массив — средней высотой)
    const Er = fbm2(G.nE, x / 420, z / 420, 2);
    const land = ss(-.2, -.02, C), mk = ss(-.04, -.42, Er) * ss(-.02, .22, C);
    return lerp(SEA - 10, SEA + 3 + 9 * ss(0, .6, C) + mk * 32, land);
  }
  function node4(G, x, z, o, k){
    const w = n2(G.nW1, x / 4096 + 3.1, z / 4096 - 7.7) * 600, u = (z + w) / 8192 + .2, f = u - Math.floor(u + .5), phi = (f < 0 ? -f : f) * 2;
    const C0 = fbm2(G.nC, x / 760, z / 760, 3), hs = Math.max(SEA, baseH4(G, x, z, C0));
    const wx = -cosT(phi * TAU), wl = Math.sqrt(wx * wx + .09), ux = -wx / wl, uz = -.3 / wl;
    let q = .3, sea1 = 0;
    for (let i = 5; i >= 0; i--) {
      const d = UPW4[i], px = x + ux * d, pz = z + uz * d, C = fbm2(G.nC, px / 760, pz / 760, 3);
      const sea = 1 - ss(-.2, -.02, C), h = baseH4(G, px, pz, C);
      q = q + (1 - q) * sea * .5;
      q = q * (1 - (1 - sea) * DRYK4[i]);
      q = q * (1 - .5 * ss(20, 50, h - SEA));
      if (i === 0) sea1 = sea;
    }
    const seaH = 1 - ss(-.2, -.02, C0);
    q = q + (1 - q) * seaH * .5;
    const mLat = .5 + .22 * cosT(phi * 9.42477796076938);
    const rv = Math.abs(fbm2(G.nR, x / 340, z / 340, 2)), riv = (1 - ss(0, .1, rv)) * .12;
    const m = cl01(q * .65 + mLat * .35 + riv + fbm2(G.nM, x / 1400, z / 1400, 2) * .08);
    let tb = 1 - 1.27 * phi + .27 * phi * phi + fbm2(G.nT, x / 1400, z / 1400, 2) * .06;
    tb = tb + (.5 - tb) * .2 * (seaH > sea1 ? seaH : sea1);
    o[k] = tb; o[k + 1] = m; o[k + 2] = hs;
  }
  // узел (ix, iz) в кэше мира (4096 ячеек, прямое отображение): индекс значений в G.cn4.v
  function nodeAt(G, ix, iz){
    const C = G.cn4 || (G.cn4 = { k: new Int32Array(8192), v: new Float64Array(12288), ok: new Uint8Array(4096) });
    const sl = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & 4095;
    if (!C.ok[sl] || C.k[sl * 2] !== ix || C.k[sl * 2 + 1] !== iz) { node4(G, ix * 32, iz * 32, C.v, sl * 3); C.k[sl * 2] = ix; C.k[sl * 2 + 1] = iz; C.ok[sl] = 1; }
    return sl * 3;
  }
  const CL4 = new Float64Array(3);
  function clim4(G, x, z){   // → CL4 = tb, m, hs (билинейно между узлами)
    const gx = x / 32, gz = z / 32, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz, v = () => G.cn4.v;
    let a = nodeAt(G, ix, iz); const t00 = v()[a], m00 = v()[a + 1], h00 = v()[a + 2];
    a = nodeAt(G, ix + 1, iz); const t10 = v()[a], m10 = v()[a + 1], h10 = v()[a + 2];
    a = nodeAt(G, ix, iz + 1); const t01 = v()[a], m01 = v()[a + 1], h01 = v()[a + 2];
    a = nodeAt(G, ix + 1, iz + 1); const t11 = v()[a], m11 = v()[a + 1], h11 = v()[a + 2];
    CL4[0] = bil(t00, t10, t01, t11, fx, fz); CL4[1] = bil(m00, m10, m01, m11, fx, fz); CL4[2] = bil(h00, h10, h01, h11, fx, fz);
    return CL4;
  }

  // ── Столбец: высота и биом (чистая функция — её же зовут соседние чанки для деревьев) ──
  const COL = { h: 0, b: 0, land: 0, mk: 0, T: 0, M: 0, river: 0, swamp: 0, desert: 0, ts: 0, tp: 0, m: 0 };
  function column(G, x, z, out = COL){
    if (G.ver >= 4) return column4(G, x, z, out);
    const C = fbm2(G.nC, x / 760, z / 760, 3), Er = fbm2(G.nE, x / 420, z / 420, 2);
    const pk = 1 - Math.abs(fbm2(G.nP, x / 230, z / 230, 3)), hills = fbm2(G.nH, x / 96, z / 96, 3), det = fbm2(G.nD, x / 26, z / 26, 2);
    const land = ss(-.2, -.02, C);
    const mk = ss(-.04, -.42, Er) * ss(-.02, .22, C);
    const ocean = SEA - 7 - 22 * ss(-.2, -.62, C) + det * 2;
    let h = SEA + 3 + 9 * ss(0, .6, C) + hills * (5 + 5 * (1 - mk)) + det * 1.6 + mk * (pk * pk * pk * 58 + pk * 12);
    // реки: узкая полоса около нуля шума — долина к уровню моря − 3
    const rn = Math.abs(fbm2(G.nR, x / 340, z / 340, 2)), river = (1 - ss(.018, .055, rn)) * land * (1 - mk * .85);
    h = lerp(h, SEA - 3 + det, river);
    let tx = x, tz = z;
    if (G.ver >= 2) { tx += fbm2(G.nW1, x / 90, z / 90, 2) * 34; tz += fbm2(G.nW2, x / 90, z / 90, 2) * 34; }   // v2: извилистые границы
    let T = fbm2(G.nT, tx / 940, tz / 940, 2), M = fbm2(G.nM, tx / 820, tz / 820, 2);
    T -= Math.max(0, h - SEA - 30) / 70;   // выше — холоднее
    // болото: почти ровно у воды; пустыня: дюны
    const swamp = ss(.24, .42, M) * ss(-.22, -.02, T) * land * (1 - mk);
    h = lerp(h, SEA + det * 1.4 - .4, swamp * .88);
    const desert = ss(.28, .42, T) * ss(-.04, -.22, M) * land * (1 - mk);
    h += desert * fbm2(G.nDune, x / 40, z / 40, 2) * 3.5;
    h = lerp(ocean, h, land);
    const hi = Math.max(2, Math.min(H - 6, Math.floor(h)));
    let b;
    if (river > .55 && hi <= SEA) b = BI.river;
    else if (hi < SEA - 1) b = BI.ocean;
    else if (hi <= SEA + 1 && land < .95 && T > -.35) b = BI.beach;
    else if (hi > SEA + 44 || (mk > .55 && hi > SEA + 20)) b = BI.mountains;
    else if (T < -.34) b = BI.snow;
    else if (desert > .5) b = BI.desert;
    else if (swamp > .5) b = BI.swamp;
    else if (M > .08) b = T < -.06 ? BI.birch : BI.forest;
    else b = BI.plains;
    out.h = hi; out.b = b; out.land = land; out.mk = mk; out.T = T; out.M = M; out.river = river; out.swamp = swamp; out.desert = desert;
    return out;
  }
  // v4: тот же рельеф, климат — логичный (T, M — в шкале прежних версий: деревья, цвета, лёд и зоны погоды работают как раньше:
  // T = −0,34 — край зимы (ts 0,22), T = 0,14 — край жары (ts 0,62); M = 0,09 — лес, −0,2 — пустыня, 0,38 — болото)
  function column4(G, x, z, out){
    const C = fbm2(G.nC, x / 760, z / 760, 3), Er = fbm2(G.nE, x / 420, z / 420, 2);
    const pk = 1 - Math.abs(fbm2(G.nP, x / 230, z / 230, 3)), hills = fbm2(G.nH, x / 96, z / 96, 3), det = fbm2(G.nD, x / 26, z / 26, 2);
    const land = ss(-.2, -.02, C);
    const mk = ss(-.04, -.42, Er) * ss(-.02, .22, C);
    const ocean = SEA - 7 - 22 * ss(-.2, -.62, C) + det * 2;
    let h = SEA + 3 + 9 * ss(0, .6, C) + hills * (5 + 5 * (1 - mk)) + det * 1.6 + mk * (pk * pk * pk * 58 + pk * 12);
    const rn = Math.abs(fbm2(G.nR, x / 340, z / 340, 2)), river = (1 - ss(.018, .055, rn)) * land * (1 - mk * .85);
    h = lerp(h, SEA - 3 + det, river);
    const cc = clim4(G, x, z), tb = cc[0], m = cc[1], hs = cc[2];
    const ts = hs > SEA + 8 ? tb - (hs - SEA - 8) * LAPSE4 : tb;
    const swamp = ss(.70, .78, m) * ss(.38, .44, ts) * land * (1 - mk);
    h = lerp(h, SEA + det * 1.4 - .4, swamp * .88);
    const desert = ss(.58, .66, ts) * ss(.34, .26, m) * land * (1 - mk);
    h += desert * fbm2(G.nDune, x / 40, z / 40, 2) * 3.5;
    h = lerp(ocean, h, land);
    const hi = Math.max(2, Math.min(H - 6, Math.floor(h)));
    const tp = hi > SEA + 8 ? tb - (hi - SEA - 8) * LAPSE4 : tb;
    let b;
    if (river > .55 && hi <= SEA) b = BI.river;
    else if (hi < SEA - 1) b = BI.ocean;
    else if (hi <= SEA + 1 && land < .95 && ts >= .22) b = BI.beach;
    else if (hi > SEA + 44 || (mk > .55 && hi > SEA + 20)) b = BI.mountains;
    else if (ts < .22) b = BI.snow;
    else if (desert > .5) b = BI.desert;
    else if (swamp > .5) b = BI.swamp;
    else if (m >= .52) b = ts < .40 ? BI.birch : BI.forest;
    else b = BI.plains;
    out.h = hi; out.b = b; out.land = land; out.mk = mk; out.T = -.34 + (ts - .22) * 1.55; out.M = (m - .45) * 1.3; out.river = river; out.swamp = swamp; out.desert = desert;
    out.ts = ts; out.tp = tp; out.m = m;
    return out;
  }
  V.genColumn = column;
  // климат в точке (погода по биомам, T-135): { b, h, ts, tp, m, T, M } — v4; у старых версий ts / tp / m из T и M (обратно)
  V.climateAt = (G, x, z, out = {}) => {
    const c = column(G, Math.floor(x), Math.floor(z), out);
    if (G.ver < 4) { c.ts = .22 + (c.T + .34) / 1.55; c.tp = c.ts; c.m = .45 + c.M / 1.3; }
    return c;
  };

  // Климатическая зона столба (21.10.2026, владелец: «где-то всегда зима, где-то зимы нет»): 0 — обычная (времена года),
  // 1 — всегда зима (холодный край, вершины гор выше снеговой линии SEA + 40 — там генератор кладёт снег), 2 — зимы не бывает
  // (пустыня, болото, жаркий край). T — температура столба из V.genColumn (с поправкой на высоту), h — высота, b — биом,
  // p — «пятна» 0…1 (шум v2 — тот же, что у снега на границе снегов: где генератор положил снег пятнами, там и «всегда
  // зима»; у тёплого края так же — граница без прямой линии); нет p (миры v1) — граница ровная, как у их биомов.
  // Чистая функция генератора: у всех одинаково, не хранится
  V.climZone = (T, h, b, p) => {
    const fc = ss(-.25, -.42, T);
    if (h > SEA + 40 || (p == null ? T < -.34 : fc >= 1 || p < fc)) return 1;
    if (b === BI.desert || b === BI.swamp) return 2;
    const fw = ss(.2, .32, T);
    return (p == null ? T > .26 : fw >= 1 || p < fw) ? 2 : 0;
  };
  const patch = (G, x, z) => G.ver >= 2 ? n2(G.nPt, x / 7, z / 7) * .5 + .5 : null;
  // v4: «всегда зима» — по температуре на высоте (tp < 0,22, на краю пятнами), а не по высоте над морем
  V.climZone4 = (T, tp, b, p) => {
    const fc = ss(.26, .18, tp);
    if (fc >= 1 || p < fc) return 1;
    if (b === BI.desert || b === BI.swamp) return 2;
    const fw = ss(.2, .32, T);
    return fw >= 1 || p < fw ? 2 : 0;
  };
  V.climZoneAt = (G, x, z, col) => { if (G.void) return 0; const c = column(G, x, z, col || {}); return G.ver >= 4 ? V.climZone4(c.T, c.tp, c.b, patch(G, x, z)) : V.climZone(c.T, c.h, c.b, patch(G, x, z)); };

  // ── Пещеры: шум на сетке 4×4×4 + трилинейно (точка считается так же, как в чанке — деревья не повиснут) ──
  const CG = 4, CGY = 4;
  function caveSample(G, gx, gy, gz){
    const x = gx * CG, y = gy * CGY, z = gz * CG;
    return [n3(G.nC1, x / 42, y / 28, z / 42), n3(G.nC2, x / 42 + 31.7, y / 28, z / 42), fbm3(G.nC3, x / 70, y / 44, z / 70, 2)];
  }
  // карв по трём значениям шума в точке: 0 — нет, 1 — пещера
  function carveOf(a, b, c, y, h){
    if (y < 4) return 0;
    const w = y < 30 ? .11 : .088;
    if (a * a + b * b < w * w) return 1;
    if (y < 44 && y < h - 6 && c > .52 - (y < 20 ? .06 : 0)) return 1;
    return 0;
  }
  V.caveAt = (G, x, y, z, h) => {
    const gx = Math.floor(x / CG), gy = Math.floor(y / CGY), gz = Math.floor(z / CG);
    const fx = (x - gx * CG) / CG, fy = (y - gy * CGY) / CGY, fz = (z - gz * CG) / CG;
    const s00 = caveSample(G, gx, gy, gz), s10 = caveSample(G, gx + 1, gy, gz), s01 = caveSample(G, gx, gy, gz + 1), s11 = caveSample(G, gx + 1, gy, gz + 1);
    const t00 = caveSample(G, gx, gy + 1, gz), t10 = caveSample(G, gx + 1, gy + 1, gz), t01 = caveSample(G, gx, gy + 1, gz + 1), t11 = caveSample(G, gx + 1, gy + 1, gz + 1);
    const v = [0, 0, 0];
    for (let q = 0; q < 3; q++) { const a = bil(s00[q], s10[q], s01[q], s11[q], fx, fz), b = bil(t00[q], t10[q], t01[q], t11[q], fx, fz); v[q] = a + (b - a) * fy; }
    return carveOf(v[0], v[1], v[2], y, h);
  };
  // по x и z, потом по y (в чанке — так же: одинаковые числа в точке и в чанке)
  function bil(c00, c10, c01, c11, fx, fz){ const a = c00 + (c10 - c00) * fx, b = c01 + (c11 - c01) * fx; return a + (b - a) * fz; }

  // ущелье в столбце: w — «ширина» линии шума (9 — нет), f — дно
  const RVQ = { w: 9, f: 0 };
  function ravine(G, wx, wz){
    const m = n2(G.nRm, wx / 520, wz / 520);
    RVQ.w = m > .52 ? Math.abs(fbm2(G.nRv, wx / 190, wz / 190, 2)) : 9;
    RVQ.f = 14 + Math.floor((n2(G.nD, wx / 60, wz / 60) + 1) * 5);
    return RVQ;
  }
  const ravineCut = (G, x, z, y, h) => { if (h <= V.SEA + 2) return false; const q = ravine(G, x, z); return q.w < .05 && y >= q.f && q.w < .005 + .014 * (y - q.f) / Math.max(1, h - q.f); };

  // ── Деревья и прочее, что пересекает границы: «происхождения» в чанке (cx, cz) ──
  const TREE_P = [0, 0, .07, .9, .78, 0, .26, .12, .3, 0];   // вероятность попытки по биому
  function originsOf(G, cx, cz){
    const ck = V.key(cx, cz), hit = G.oc.get(ck);
    if (hit) return hit;
    const out = originsCalc(G, cx, cz);
    if (G.oc.size > 400) G.oc.delete(G.oc.keys().next().value);
    G.oc.set(ck, out);
    return out;
  }
  function originsCalc(G, cx, cz){
    const r = V.rng(V.hash(G.seed, cx, cz, 101)), out = [], col = {};
    // деревья и кактусы
    for (let k = 0; k < 11; k++) {
      const lx = Math.floor(r() * 16), lz = Math.floor(r() * 16), roll = r(), kind = r(), hgt = r();
      const x = cx * 16 + lx, z = cz * 16 + lz;
      const c = column(G, x, z, col), b = c.b;
      if (roll >= TREE_P[b] && !(b === BI.desert && roll < .12)) continue;
      if (c.h <= SEA || V.caveAt(G, x, c.h - 1, z, c.h) || ravineCut(G, x, z, c.h - 1, c.h)) continue;
      if (c.mk > .3 && b === BI.mountains && c.h > SEA + 40) continue;
      if (b === BI.desert) { out.push({ t: 'cactus', x, z, y: c.h, n: 1 + Math.floor(hgt * 3) }); continue; }
      if (G.ver >= 3) { const q = pick3(G, c, kind, x, z, out); if (q) out.push(q); continue; }   // v3 — деревья «как в модах» (те же попытки и числа r)
      const sp = b === BI.mountains || (G.ver >= 2 ? 1 - kind < ss(-.27, -.4, c.T) : b === BI.snow), bi = !sp && (b === BI.birch || (b === BI.forest && kind < .2));   // v2: у снегов ели и лиственные вперемешку
      out.push({ t: sp ? 'spruce' : bi ? 'birch' : 'oak', x, z, y: c.h, n: sp ? 6 + Math.floor(hgt * 4) : bi ? 5 + Math.floor(hgt * 3) : 4 + Math.floor(hgt * 3), apple: kind > .985 });
    }
    // озеро: редко, на равнине/в лесу; край не ниже середины (иначе вода повиснет)
    if (r() < .05) {
      const lx = 3 + Math.floor(r() * 10), lz = 3 + Math.floor(r() * 10), rx = 3 + Math.floor(r() * 3), rz = 3 + Math.floor(r() * 3), lava = r() < .04;
      const x = cx * 16 + lx, z = cz * 16 + lz, c = column(G, x, z, col);
      if ((c.b === BI.plains || c.b === BI.forest || c.b === BI.birch || (lava && c.b === BI.desert)) && c.h > SEA + 1) {
        let okRim = true;
        for (let a = 0; a < 16 && okRim; a++) { const ang = a / 16 * 6.283185307179586, ca = cosT(ang), sa = sinT(ang); const rc = column(G, Math.round(x + ca * (rx + 1)), Math.round(z + sa * (rz + 1)), col); if (rc.h < c.h || rc.h > c.h + 4) okRim = false; }
        if (okRim) out.push({ t: 'lake', x, z, y: c.h, rx, rz, lava });
      }
    }
    // фичи модов (валуны, столбы, свои деревья)
    for (let fi = 0; fi < G.features.length; fi++) {
      const f = G.features[fi]; if (f.type !== 'boulder' && f.type !== 'column' && f.type !== 'tree') continue;
      const rf = V.rng(V.hash(G.seed, cx, cz, 2000 + fi)), tries = Math.min(8, Math.max(0, f.perChunk ?? 1));
      const whole = Math.floor(tries), extra = tries - whole;
      for (let k = 0; k < whole + 1; k++) {
        const lx = Math.floor(rf() * 16), lz = Math.floor(rf() * 16), p = rf(), sz = rf();
        if (k === whole && p >= extra) continue;
        const x = cx * 16 + lx, z = cz * 16 + lz, c = column(G, x, z, col);
        if (f.biomes && f.biomes.length && !f.biomes.includes(V.BIOME_IDS[c.b])) continue;
        if (c.h <= SEA) continue;
        out.push({ t: 'mod', f, x, z, y: c.h, s: sz });
      }
    }
    return out;
  }
  // ── v3: порода по биому и климату (и по своему хешу места — числа r() те же, что у v1/v2: озёра и фичи модов не съезжают);
  //    в лесу реже, чем у v2 (кроны шире), большие — не впритык к соседям в этом чанке; каждое седьмое — молодое (g < 1) ──
  const TREE_P3 = [0, 0, .07, .56, .5, 0, .17, .1, .3, 0];   // ели и сосны v3 крупнее — их реже
  const SPACE = { giant_oak: 5.5, giant_spruce: 3.5, tropical: 3, acacia: 2.6, oak: 2.2, willow: 2.2 };
  function pick3(G, c, kind, x, z, out){
    const b = c.b, T = c.T, u = V.hash(G.seed, x, z, 919) / 4294967296, w = V.hash(G.seed, x, z, 920) / 4294967296;
    if (u * .999 >= TREE_P3[b] / (TREE_P[b] || 1)) return null;   // реже, чем у v2 (доля попыток, прошедших прежний бросок)
    const warm = T > .18, cold = 1 - kind < ss(-.27, -.4, T), r = (u * 7919) % 1;
    let sp;
    if (b === BI.mountains) sp = r < .45 ? 'pine' : 'spruce';
    else if (b === BI.snow || cold) sp = r < .03 ? 'giant_spruce' : r < .075 ? 'dead' : r < .4 ? 'pine' : 'spruce';
    else if (b === BI.swamp) sp = r < .55 ? 'willow' : r < .82 ? 'oak' : 'dead';
    else if (b === BI.birch) sp = r < .04 ? 'dead' : r < .14 ? 'oak' : 'birch';
    else if (b === BI.forest) sp = warm ? (r < .62 ? 'tropical' : r < .84 ? 'oak' : 'acacia') : r < .035 ? 'giant_oak' : r < .07 ? 'dead' : r < .3 ? 'birch' : 'oak';
    else if (b === BI.plains) sp = warm ? (r < .78 ? 'acacia' : 'oak') : (c.river > .05 && r < .5) || r < .07 ? 'willow' : r < .15 ? 'birch' : 'oak';
    else sp = 'oak';
    const TS = root.D37E.trees.SPECIES[sp];
    if (c.h + TS.h[1] + 6 >= H - 2) return null;   // макушка не выше мира
    const sz = SPACE[sp] || 1.4;
    for (const q of out) if (q.t === 'tree3') { const dx = q.x - x, dz = q.z - z, need = sz + (SPACE[q.sp] || 1.4); if (dx * dx + dz * dz < need * need) return null; }
    return { t: 'tree3', sp, x, z, y: c.h, g: w < .14 ? .5 + w * 2.8 : 1, seed: V.hash(G.seed, x, z, 4243) };
  }
  // блоки породы (v3): ствол, листва, тонкая ветка
  const WOOD = { oak: 'oak', birch: 'birch', spruce: 'spruce', pine: 'spruce', giant_spruce: 'spruce', acacia: 'acacia', tropical: 'jungle', willow: 'oak', dead: 'oak', giant_oak: 'oak' };
  const LEAF = { willow: 'willow', tropical: 'jungle', pine: 'spruce', giant_spruce: 'spruce', giant_oak: 'oak', dead: 'oak' };
  function blocksOf(G, sp){
    const k = G.tb || (G.tb = {});
    if (k[sp]) return k[sp];
    const ID = G.id, w = WOOD[sp] || 'oak', l = LEAF[sp] || w;
    return (k[sp] = { log: ID['log_' + w] || ID.log_oak, leaf: ID['leaves_' + l] || ID.leaves_oak, thin: ID['log_' + w + '_thin'] || ID['log_' + w] || ID.log_oak });
  }
  // кубики дерева — один раз на дерево (соседние чанки берут из кэша), не больше 1500 в памяти потока
  function treeVox(G, f){
    const key = (f.x + 1048576) * 2097152 + (f.z + 1048576);
    let v = G.tc.get(key);
    if (v) return v;
    const TR = root.D37E.trees;
    v = TR.voxels(TR.grow(f.sp, f.seed, { g: f.g }), { thin: !!G.id.log_oak_thin });
    if (G.tc.size >= 1500) G.tc.delete(G.tc.keys().next().value);
    G.tc.set(key, v);
    return v;
  }
  V.treeVox = treeVox;
  function placeTree3(G, ids, x0, z0, f, inC, I, soft){
    const v = treeVox(G, f), bx = v.box;
    if (f.x + bx[3] < x0 || f.x + bx[0] > x0 + 15 || f.z + bx[5] < z0 || f.z + bx[2] > z0 + 15) return;
    const B3 = blocksOf(G, f.sp), ID = G.id, Tt = V.T, tree = Tt.tree;
    const soil = c => c === ID.dirt || c === ID.grass || c === ID.snow_grass || c === ID.sand || c === ID.gravel || c === ID.clay;
    const free = c => c === 0 || soft(c) || (tree && tree[c & 0xfff] === 3);
    for (let i = 0; i < v.n; i++) {
      const x = f.x + v.x[i], z = f.z + v.z[i];
      if (!inC(x, z)) continue;
      const y = f.y + v.y[i];
      if (y <= 0 || y >= H - 1) continue;
      const t = v.t[i], k = I(x, y, z), cur = ids[k];
      if (t === 0) { if (cur === 0 || soft(cur)) ids[k] = B3.leaf; }
      else if (t === 1) { if (free(cur)) ids[k] = V.cell(B3.thin, v.a[i]); }
      else if (free(cur) || (t === 3 && soil(cur))) {
        ids[k] = V.cell(B3.log, v.a[i]);
        if (t === 2 && v.y[i] === 0) {   // у ствола: под ним — земля (не дёрн); на склоне — ствол до земли (не висит)
          let yy = y - 1;
          for (; yy > 0 && yy >= y - 4; yy--) { const c = ids[k - (y - yy)]; if (!(c === 0 || soft(c))) break; ids[k - (y - yy)] = V.cell(B3.log, 0); }
          if (yy > 0) { const g = k - (y - yy); if (ids[g] === ID.grass || ids[g] === ID.snow_grass) ids[g] = ID.dirt; }
        }
      }
    }
  }

  // синус/косинус без Math.sin (одинаково везде): ряд Тейлора, угол в [0, 2π)
  function sinT(a){ while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; const a2 = a * a; return a * (1 - a2 / 6 * (1 - a2 / 20 * (1 - a2 / 42 * (1 - a2 / 72 * (1 - a2 / 110))))); }
  function cosT(a){ return sinT(a + Math.PI / 2); }

  // ═══ Чанк ═══
  V.genChunk = (G, cx, cz) => {
    const ID = G.id, ids = new Uint16Array(V.CELLS), biome = new Uint8Array(256), tint = new Uint8Array(256 * 9), zone = new Uint8Array(256);
    const x0 = cx * 16, z0 = cz * 16;
    // высоты 18×18 (с полями — для крутизны склонов) и биомы
    const hh = new Int16Array(324), bb = new Uint8Array(324), col = {};
    const tmp = new Float32Array(256), tpk = G.ver >= 4 ? new Float32Array(256) : null;
    for (let j = 0; j < 18; j++) for (let i = 0; i < 18; i++) {
      const c = column(G, x0 + i - 1, z0 + j - 1, col);
      hh[j * 18 + i] = c.h; bb[j * 18 + i] = c.b;
      if (i >= 1 && i <= 16 && j >= 1 && j <= 16) { tmp[(i - 1) * 16 + (j - 1)] = c.T; if (tpk) tpk[(i - 1) * 16 + (j - 1)] = c.tp; }
    }
    // цвета биомов — среднее по сетке 4 блока вокруг (плавные переходы)
    const cg = new Uint8Array(81);
    for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
      const lx = -8 + i * 4, lz = -8 + j * 4;
      cg[j * 9 + i] = lx >= -1 && lx <= 16 && lz >= -1 && lz <= 16 ? bb[(lz + 1) * 18 + lx + 1] : column(G, x0 + lx, z0 + lz, col).b;
    }
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      // вес — «шатёр» по расстоянию до точки сетки (до 8 блоков): цвет меняется плавно, без ступенек по 4 блока
      const gi = (x + 8) / 4, gj = (z + 8) / 4, s = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      let n = 0;
      for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
        const ia = Math.floor(gi) + di, ic = Math.floor(gj) + dj, wq = Math.max(0, 2 - Math.abs(gi - ia)) * Math.max(0, 2 - Math.abs(gj - ic));
        if (wq <= 0) continue;
        const t = TINTS[cg[Math.min(8, Math.max(0, ic)) * 9 + Math.min(8, Math.max(0, ia))]];
        for (let q = 0; q < 3; q++) { s[q * 3] += t[q][0] * wq; s[q * 3 + 1] += t[q][1] * wq; s[q * 3 + 2] += t[q][2] * wq; }
        n += wq;
      }
      const o = (x * 16 + z) * 9;
      for (let q = 0; q < 9; q++) tint[o + q] = Math.round(s[q] / n);
      biome[x * 16 + z] = bb[(z + 1) * 18 + x + 1];
      zone[x * 16 + z] = tpk ? V.climZone4(tmp[x * 16 + z], tpk[x * 16 + z], bb[(z + 1) * 18 + x + 1], patch(G, x0 + x, z0 + z))
        : V.climZone(tmp[x * 16 + z], hh[(z + 1) * 18 + x + 1], bb[(z + 1) * 18 + x + 1], patch(G, x0 + x, z0 + z));
    }
    // пещеры: сетка шума на чанк
    const GX = 16 / CG + 1, GY = H / CGY + 1, cs = new Float64Array(GX * GY * GX * 3);
    for (let gx = 0; gx < GX; gx++) for (let gz = 0; gz < GX; gz++) for (let gy = 0; gy < GY; gy++) {
      const v = caveSample(G, x0 / CG + gx, gy, z0 / CG + gz), o = ((gx * GX + gz) * GY + gy) * 3;
      cs[o] = v[0]; cs[o + 1] = v[1]; cs[o + 2] = v[2];
    }
    const lv = new Float64Array(GY * 3);
    // ущелья: узкие длинные полосы, снизу у́же
    const rv = new Float64Array(256), rvF = new Int16Array(256);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { const q = ravine(G, x0 + x, z0 + z); rv[x * 16 + z] = q.w; rvF[x * 16 + z] = q.f; }
    const hr = V.rng(V.hash(G.seed, cx, cz, 3));
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      const ci = (z + 1) * 18 + x + 1, h = hh[ci], b = bb[ci], wx = x0 + x, wz = z0 + z;
      const slope = Math.max(Math.abs(hh[ci + 1] - hh[ci - 1]), Math.abs(hh[ci + 18] - hh[ci - 18]));
      // верх и наполнитель по биому
      let top = ID.grass, fill = ID.dirt, deep = 3, under = ID.stone;
      if (b === BI.ocean || b === BI.river) { const fl = n2(G.nFl, wx / 18, wz / 18); top = fl > .35 ? ID.gravel : fl < -.45 && h > SEA - 10 ? ID.clay : ID.sand; fill = top === ID.clay ? ID.clay : ID.sand; deep = 3; }
      else if (b === BI.beach) { top = ID.sand; fill = ID.sand; deep = 4; under = ID.sandstone; }
      else if (b === BI.desert) { top = ID.sand; fill = ID.sand; deep = 4; under = ID.sandstone; }
      else if (b === BI.snow) { top = ID.snow_grass; }
      else if (b === BI.mountains && tpk) { const t = tpk[x * 16 + z]; if (slope >= 3) { top = ID.stone; fill = ID.stone; } else if (t < .12) { top = ID.snow; fill = ID.snow; deep = 2; } else if (t < .22) top = ID.snow_grass; }   // v4: снег — где холодно на этой высоте
      else if (b === BI.mountains) { if (slope >= 3) { top = ID.stone; fill = ID.stone; } else if (h > SEA + 54) { top = ID.snow; fill = ID.snow; deep = 2; } else if (h > SEA + 40) top = ID.snow_grass; }
      else if (h <= SEA && b !== BI.swamp) { top = ID.sand; fill = ID.sand; }
      // v2: у снегов — переходная полоса: снег пятнами (доля по «температуре» −0,25…−0,42), без прямой линии
      if (G.ver >= 2 && (top === ID.grass || top === ID.snow_grass) && b !== BI.mountains) { const f = ss(-.25, -.42, tmp[x * 16 + z]); if (f > 0 && f < 1) top = n2(G.nPt, wx / 7, wz / 7) * .5 + .5 < f ? ID.snow_grass : ID.grass; }
      const base = (x << 11) | (z << 7);
      const rvw = rv[x * 16 + z], rvf = rvF[x * 16 + z];
      // слои: коренная порода, камень, наполнитель, верх, вода (лёд)
      ids[base] = ID.bedrock;
      for (let y = 1; y < 4; y++) ids[base | y] = (V.hash(wx, y, wz, G.seed) & 3) < 4 - y ? ID.bedrock : under;
      if (h - deep > 4) ids.fill(under, base + 4, base + h - deep);
      const f0 = Math.max(4, h - deep);
      if (h - 1 > f0) ids.fill(fill, base + f0, base + h - 1);
      if (h - 1 >= 4) ids[base | (h - 1)] = h <= SEA && top === ID.grass ? ID.dirt : top;
      if (h < SEA) { ids.fill(ID.water, base + h, base + SEA); if (b === BI.snow || (b === BI.ocean && tmp[x * 16 + z] < -.42)) ids[base | (SEA - 1)] = ID.ice; }
      // пещеры и ущелья — только ниже поверхности (дно под водой не трогаем)
      const yc1 = h <= SEA + 1 ? h - 7 : h;
      if (yc1 > 4) {
        const gx = x >> 2, gz = z >> 2, fx = (x & 3) / CG, fz = (z & 3) / CG, gyN = Math.min(GY - 1, ((yc1 - 1) >> 2) + 1);
        const o00 = (gx * GX + gz) * GY * 3, o10 = ((gx + 1) * GX + gz) * GY * 3, o01 = (gx * GX + gz + 1) * GY * 3, o11 = ((gx + 1) * GX + gz + 1) * GY * 3;
        for (let gy = 0; gy <= gyN; gy++) for (let q = 0; q < 3; q++) { const k = gy * 3 + q; lv[q * GY + gy] = bil(cs[o00 + k], cs[o10 + k], cs[o01 + k], cs[o11 + k], fx, fz); }
        const rv0 = rvw < .05 && h > SEA + 2;
        for (let y = 4; y < yc1; y++) {
          const gy = y >> 2, fy = (y & 3) / CGY;
          const a = lv[gy] + (lv[gy + 1] - lv[gy]) * fy, bq = lv[GY + gy] + (lv[GY + gy + 1] - lv[GY + gy]) * fy, w = y < 30 ? .11 : .088;
          let carve = a * a + bq * bq < w * w;
          if (!carve && y < 44 && y < h - 6) { const c3 = lv[2 * GY + gy] + (lv[2 * GY + gy + 1] - lv[2 * GY + gy]) * fy; carve = c3 > .52 - (y < 20 ? .06 : 0); }
          if (!carve && rv0 && y >= rvf) carve = rvw < .005 + .014 * (y - rvf) / Math.max(1, h - rvf);
          if (carve) ids[base | y] = y <= 10 ? ID.lava : 0;
        }
      }
      // трава и цветы (в своём столбце)
      const hv = V.hash(wx, wz, G.seed, 5) / 4294967296;
      const topNow = ids[base | (h - 1)];
      if (h < H - 2 && ids[base | h] === 0) {
        if (topNow === ID.grass) {
          const pg = b === BI.plains ? .16 : b === BI.swamp ? .2 : b === BI.forest ? .08 : b === BI.birch ? .1 : .05;
          if (hv < pg) ids[base | h] = ID.tall_grass;
          else if (hv < pg + (b === BI.plains ? .018 : b === BI.forest || b === BI.birch ? .008 : 0)) ids[base | h] = (V.hash(wx, wz, 9) & 1) ? ID.flower_yellow : ID.flower_red;
        } else if (topNow === ID.sand && b === BI.desert && hv < .006) ids[base | h] = ID.dead_bush;
      }
      // моды: россыпь на поверхности
      for (const f of G.features) {
        if (f.type !== 'scatter' || f.under || !(f.block > 0)) continue;
        if (f.biomes && f.biomes.length && !f.biomes.includes(V.BIOME_IDS[b])) continue;
        if (f.on && f.on.length && !f.on.includes(topNow)) continue;
        if (ids[base | h] !== 0 || h >= H - 2) continue;
        if (V.hash(wx, wz, G.seed, 600 + (f.block | 0)) / 4294967296 < (f.chance ?? .01)) ids[base | h] = f.block;
      }
    }
    // руды (жилы внутри чанка, только в камне)
    for (const o of G.ores) {
      if (!(o.b > 0)) continue;
      const tries = Math.floor(o.n) + (hr() < o.n - Math.floor(o.n) ? 1 : 0);
      for (let k = 0; k < tries; k++) {
        let x = Math.floor(hr() * 16), z = Math.floor(hr() * 16), y = o.minY + Math.floor(hr() * Math.max(1, o.maxY - o.minY));
        if (o.biomes && o.biomes.length && !o.biomes.includes(V.BIOME_IDS[biome[x * 16 + z]])) { for (let s = 0; s < o.size; s++) { hr(); hr(); hr(); } continue; }
        for (let s = 0; s < o.size; s++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < H && (!o.mod || (y >= o.minY && y <= o.maxY))) {   // жила мода — строго в своих высотах
            const i = (x << 11) | (z << 7) | y, cur = ids[i];
            if (o.replace && o.replace.length ? o.replace.includes(cur) : cur === ID.stone) ids[i] = o.b;
          }
          const d = Math.floor(hr() * 6); if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++; else if (d === 3) z--; else if (d === 4) y++; else y--;
        }
      }
    }
    // моды: россыпь в пещерах (worldgen scatter глубже поверхности) — на блоке из on, если над ним воздух
    for (const f of G.features) {
      if (f.type !== 'scatter' || !f.under || !(f.block > 0)) continue;
      const y0 = Math.max(2, f.minY | 0), y1 = Math.min(H - 2, f.maxY | 0), salt = (G.seed + 700 + (f.block | 0)) | 0;
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
        if (f.biomes && f.biomes.length && !f.biomes.includes(V.BIOME_IDS[biome[x * 16 + z]])) continue;
        const base = (x << 11) | (z << 7);
        for (let y = y0; y <= y1; y++) {
          if (ids[base | y] !== 0) continue;
          const below = ids[base | (y - 1)];
          if (!below || (f.on && f.on.length ? !f.on.includes(below) : below !== ID.stone)) continue;
          if (V.hash(x0 + x, y, z0 + z, salt) / 4294967296 < f.chance) ids[base | y] = f.block;
        }
      }
    }
    // деревья, кактусы, озёра — из своего чанка и соседей
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const f of originsOf(G, cx + dx, cz + dz)) placeFeature(G, ids, x0, z0, f);
    if (G.void) { ids.fill(0); zone.fill(0); }   // «пустой» мир (перенос из Minecraft): только то, что лежит в сохранении; цвета биомов — как обычно, климат — обычный
    return { ids, biome, tint, zone };
  };

  // Записать в чанк (x0, z0) то, что от фичи попадает в его границы
  function placeFeature(G, ids, x0, z0, f){
    const ID = G.id;
    const inC = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
    const I = (x, y, z) => ((x - x0) << 11) | ((z - z0) << 7) | y;
    const setIf = (x, y, z, v, over) => { if (y <= 0 || y >= H || !inC(x, z)) return; const i = I(x, y, z), c = ids[i]; if (over ? over(c) : c === 0) ids[i] = v; };
    const soft = c => c === 0 || c === ID.tall_grass || c === ID.flower_red || c === ID.flower_yellow || c === ID.snow || c === ID.dead_bush;
    const leafOk = c => c === 0 || c === ID.tall_grass || c === ID.flower_red || c === ID.flower_yellow;
    const hr = V.rng(V.hash(f.x, f.z, G.seed, 77));
    if (f.t === 'cactus') { for (let k = 0; k < f.n; k++) setIf(f.x, f.y + k, f.z, ID.cactus, soft); return; }
    if (f.t === 'lake') {
      for (let dx = -f.rx - 1; dx <= f.rx + 1; dx++) for (let dz = -f.rz - 1; dz <= f.rz + 1; dz++) {
        const x = f.x + dx, z = f.z + dz; if (!inC(x, z)) continue;
        const r2 = (dx * dx) / (f.rx * f.rx) + (dz * dz) / (f.rz * f.rz); if (r2 > 1) continue;
        const depth = 1 + Math.floor((1 - r2) * 3.2);
        for (let y = f.y - depth; y < f.y + 3; y++) { if (y <= 1) continue; ids[I(x, y, z)] = y < f.y ? (f.lava ? ID.lava : ID.water) : 0; }
        const below = I(x, f.y - depth - 1, z); if (f.y - depth - 1 > 0 && (ids[below] === 0 || ids[below] === ID.grass)) ids[below] = f.lava ? ID.stone : ID.dirt;
      }
      return;
    }
    if (f.t === 'mod') { modFeature(G, ids, x0, z0, f, setIf, soft, leafOk); return; }
    if (f.t === 'tree3') { placeTree3(G, ids, x0, z0, f, inC, I, soft); return; }
    const log = f.t === 'spruce' ? ID.log_spruce : f.t === 'birch' ? ID.log_birch : ID.log_oak;
    const leaf = f.t === 'spruce' ? ID.leaves_spruce : f.t === 'birch' ? ID.leaves_birch : ID.leaves_oak;
    const top = f.y + f.n;
    if (top >= H - 3) return;
    // земля под стволом
    if (inC(f.x, f.z)) { const g = I(f.x, f.y - 1, f.z); if (ids[g] === ID.grass || ids[g] === ID.snow_grass) ids[g] = ID.dirt; }
    if (f.t === 'spruce') {
      let r = 0;
      for (let y = top; y >= f.y + 2; y--) {
        const rr = y === top ? 0 : y === top - 1 ? 1 : ((top - y) % 2 ? Math.min(3, 1 + Math.floor((top - y) / 3)) : Math.max(1, Math.min(2, Math.floor((top - y) / 3))));
        r = rr;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue; setIf(f.x + dx, y, f.z + dz, leaf, leafOk); }
      }
      setIf(f.x, top + 1, f.z, leaf, leafOk);
    } else {
      for (let y = top - 3; y <= top; y++) {
        const r = y >= top - 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (y === top || hr() < .5)) continue;
          setIf(f.x + dx, y, f.z + dz, leaf, leafOk);
        }
      }
      setIf(f.x, top + 1, f.z, leaf, leafOk);
    }
    for (let y = f.y; y < top; y++) setIf(f.x, y, f.z, log, c => c === 0 || c === leaf || soft(c));
  }
  // фичи модов: валун (шар), столб, своё дерево
  function modFeature(G, ids, x0, z0, f, setIf, soft, leafOk){
    const F = f.f, b = F.block | 0;
    if (F.type === 'boulder') {
      const r = (F.radius ?? 2) + Math.floor(f.s * ((F.radiusVar ?? 1) + 1));
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy + dz * dz > r * r + r * .5) continue;
        setIf(f.x + dx, f.y + dy, f.z + dz, b, c => c !== G.id.bedrock);
      }
    } else if (F.type === 'column') {
      const n = (F.min ?? 2) + Math.floor(f.s * ((F.max ?? 5) - (F.min ?? 2) + 1));
      for (let k = 0; k < n; k++) setIf(f.x, f.y + k, f.z, b, soft);
      if (F.top > 0) setIf(f.x, f.y + n, f.z, F.top | 0, soft);
    } else if (F.type === 'tree') {
      const log = F.log | 0, leaf = F.leaves | 0, n = (F.min ?? 4) + Math.floor(f.s * ((F.max ?? 6) - (F.min ?? 4) + 1)), top = f.y + n;
      if (top >= H - 4 || !(log > 0)) return;
      const r0 = Math.min(3, F.radius ?? 2);
      for (let y = top - 2; y <= top + 1; y++) { const r = y >= top ? Math.max(1, r0 - 1) : r0; for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) { if (dx * dx + dz * dz > r * r + 1) continue; if (leaf > 0) setIf(f.x + dx, y, f.z + dz, leaf, leafOk); } }
      for (let y = f.y; y < top; y++) setIf(f.x, y, f.z, log, c => c === 0 || c === leaf || soft(c));
    }
  }

  // Где появиться: суша рядом с (x, z) (поиск по спирали) → { x, y, z }
  V.findSpawn = (G, x = 0, z = 0) => {
    const col = {};
    for (let r = 0; r < 4000; r += 16) for (let a = 0; a < 8; a++) {
      const px = x + Math.round(r * cosT(a / 8 * 6.283185307179586)), pz = z + Math.round(r * sinT(a / 8 * 6.283185307179586));
      const c = column(G, px, pz, col);
      if (c.h > SEA + 1 && c.b !== BI.mountains && c.b !== BI.ocean && c.b !== BI.river && !V.caveAt(G, px, c.h - 1, pz, c.h)) return { x: px + .5, y: c.h + 1, z: pz + .5, b: c.b };
      if (r === 0) break;
    }
    return { x: x + .5, y: H - 10, z: z + .5, b: 0 };
  };
})();

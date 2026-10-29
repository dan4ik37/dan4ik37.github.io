// ═══════════════════════════════════════
//  D37 BIOMES (T-116) — logical biomes and the climate at a position, one API for the new land (T1 generator v2, terra-core.js)
//  and Kubomir (voxel-gen.js v4); the weather-by-biome track (T-135, E:\d37-core\spec\BIOME_WEATHER.md §1.2) reads its region
//  records from here. Rules: E:\d37-core\spec\WORLD_RULES.md (§1 logical climate, §2 strange-world presets). No DOM, no three.js
//  (window, workers, node). Pure functions of the world seed: every peer gets the same answer without messages.
// ═══════════════════════════════════════
// const B = D37E.biomes
//   src = B.t1(seed, { gen: 2, rules: 0, param: 0 }) | B.kb(G)        — a world to ask (G = D37E.vox.genInit(...))
//   B.at(src, x, z, out?) → { biome, id, name, cls, smask, ts, tp, m, tempC, h, high, coast } (out reused — no garbage)
//       biome — the world's own id (T1 0…12, Kubomir 0…9); id — its English key; cls — climate class (CLASSES, climate_classes.csv);
//       smask — surface bits (SURF); ts / tp — temperature 0 (polar) … 1 (tropical) at the smoothed / real height; m — moisture 0…1;
//       tempC — the yearly mean, °C (−24 + 54·ts, a scale for UI and weather, not physics); h — ground height (m / blocks);
//       high — summit (cold by altitude: tp < 0.22 and well above the lowland); coast — water within 24 m around
//   B.region(src, x, z, cell = 128) → { ck, cls, smask, F, alt } — BIOME_WEATHER §1.2: cls — the majority class of five samples
//       (cell centre and ±cell/4, ties → the centre), ck — its climate.js key, surfaces OR-ed, F = FEAT bits, alt = round(mean h)
//   B.climateKey(cls, ts) → climate.js key; B.climateAtFn(src) → (x, z) => key (cached; for C.world({ climateAt }))
//   B.PRESETS — strange worlds (WORLD_RULES §2) as data: { rules, param, gen, name, … presentation laws for the host game }
(() => {
  const root = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.biomes && E.biomes.v) return;
  const B = E.biomes = { v: 1 };

  // climate classes — the integers of spec/data/climate_classes.csv (BIOME_WEATHER §1.2)
  B.CLASSES = ['temperate', 'steppe', 'mountain', 'desert', 'sea', 'snow', 'tropic', 'swamp', 'warm'];
  const C = { temperate: 0, steppe: 1, mountain: 2, desert: 3, sea: 4, snow: 5, tropic: 6, swamp: 7, warm: 8 };
  // surface bits (BIOME_WEATHER §1.2 order)
  B.SURF = { sand: 1, soil: 2, grass: 4, forest: 8, rock: 16, snow: 32, ice: 64, water: 128, marsh: 256, road: 512, town: 1024, salt: 2048 };
  const S = B.SURF;
  // feature bits of a region record
  B.FEAT = { coast: 1, river: 2, lake: 4, high: 8, valley: 16, lee: 32, town: 64 };

  // T1 (new land) biomes: 0 water … 12 jungle — class, surfaces, Russian name (the HUD)
  B.T1 = [
    { id: 'water', name: 'вода', cls: C.sea, smask: S.water },
    { id: 'beach', name: 'пляж', cls: C.temperate, smask: S.sand },
    { id: 'plains', name: 'равнина', cls: C.temperate, smask: S.grass | S.soil },
    { id: 'forest', name: 'лес', cls: C.temperate, smask: S.forest | S.soil },
    { id: 'taiga', name: 'тайга', cls: C.temperate, smask: S.forest | S.snow },
    { id: 'desert', name: 'пустыня', cls: C.desert, smask: S.sand | S.salt },
    { id: 'savanna', name: 'саванна', cls: C.steppe, smask: S.grass | S.soil },
    { id: 'swamp', name: 'болото', cls: C.swamp, smask: S.marsh | S.water },
    { id: 'tundra', name: 'тундра', cls: C.snow, smask: S.soil | S.snow | S.rock },
    { id: 'rock', name: 'скалы', cls: C.mountain, smask: S.rock | S.snow },
    { id: 'snow', name: 'снега', cls: C.snow, smask: S.snow | S.ice },
    { id: 'steppe', name: 'степь', cls: C.steppe, smask: S.grass | S.soil },
    { id: 'jungle', name: 'джунгли', cls: C.tropic, smask: S.forest },
  ];
  // Kubomir biomes (voxel-gen.js BIOME_IDS) — the class can depend on the climate (plains: steppe when dry, savanna when hot)
  B.KB = [
    { id: 'ocean', cls: C.sea, smask: S.water }, { id: 'beach', cls: C.temperate, smask: S.sand }, { id: 'plains', cls: C.temperate, smask: S.grass | S.soil },
    { id: 'forest', cls: C.temperate, smask: S.forest | S.soil }, { id: 'birch', cls: C.temperate, smask: S.forest | S.soil },
    { id: 'desert', cls: C.desert, smask: S.sand }, { id: 'snow', cls: C.snow, smask: S.snow | S.grass }, { id: 'mountains', cls: C.mountain, smask: S.rock | S.snow },
    { id: 'swamp', cls: C.swamp, smask: S.marsh | S.water }, { id: 'river', cls: C.temperate, smask: S.water | S.sand },
  ];

  // strange worlds (WORLD_RULES §2): the terrain part is the T1 core's rules (terra-core.js / E:\d37-terrain ABI 2);
  // the rest are presentation / physics laws the host game applies (sky colour, rain direction, time rate, gravity zones)
  B.PRESETS = {
    earth: { gen: 2, rules: 0, name: 'Земля', note: 'logical climate (WORLD_RULES §1)' },
    snowfield: { gen: 2, rules: 1, param: 10, name: 'Вечные снега', note: 'mono: endless snow' },
    dunes: { gen: 2, rules: 1, param: 5, name: 'Бесконечная пустыня', note: 'mono: endless desert' },
    flooded: { gen: 2, rules: 1, param: 7, name: 'Затопленные залы', note: 'mono: swamp ground, the host raises its water level', water: 6 },
    patchwork: { gen: 2, rules: 2, name: 'Лоскутный мир', note: 'hard-bordered 96 m cells of any land biome (allowed only here)' },
    absurd: { gen: 2, rules: 3, name: 'Абсурдный мир', note: 'hot poles, warmer with height, floating islands 40…100 m',
      sky: '#8a5cff', rain: 'up', timeRate: 0.5, gravityZones: [{ y0: 40, y1: 100, g: 0.4 }] },
    inverted: { gen: 2, rules: 4, name: 'Перевёрнутый мир', note: 'the earth mirrored around y = −0.5: ground above, sky below', gravity: -1 },
  };

  // ── sources ──
  B.t1 = (seed, o = {}) => ({ kind: 't1', seed: seed | 0, gen: o.gen === 1 ? 1 : 2, rules: o.rules | 0, param: o.param | 0 });
  B.kb = G => ({ kind: 'kb', G });

  const T1V = new Float64Array(8), KC = {};
  const OUT = {};
  B.at = (src, x, z, out = OUT) => {
    if (src.kind === 'kb') {
      const V = E.vox, c = V.climateAt(src.G, x, z, KC), b = c.b, row = B.KB[b] || B.KB[2];
      let cls = row.cls;
      if (b === 2) cls = c.ts >= 0.62 ? C.steppe : c.m < 0.30 ? C.steppe : C.temperate;   // savanna / steppe on dry or hot plains
      else if (b === 3 && c.ts >= 0.62) cls = C.tropic;
      else if (b === 4 && c.ts < 0.30) cls = C.temperate;
      out.biome = b; out.id = row.id; out.name = (V.BIOMES && V.BIOMES[b]) || row.id; out.cls = cls; out.smask = row.smask;
      out.ts = c.ts; out.tp = c.tp; out.m = c.m; out.h = c.h;
      out.high = c.tp < 0.22 && c.h > V.SEA + 30;
      out.coast = b === 1 || b === 0 || b === 9 || nearWater(src, x, z);
    } else {
      const T1 = E.terraCore;
      let b;
      if (src.gen === 2) b = T1.climate(src.seed, x, z, src.rules, src.param, T1V);
      else { b = T1.biome(src.seed, x, z); T1V[4] = T1V[5] = T1.temperature01(src.seed, x, z); T1V[1] = T1.moisture01(src.seed, x, z); T1V[6] = T1.height(src.seed, x, z); }
      const row = B.T1[b] || B.T1[2];
      out.biome = b; out.id = row.id; out.name = row.name; out.cls = row.cls; out.smask = row.smask;
      out.ts = T1V[4]; out.tp = T1V[5]; out.m = T1V[1]; out.h = T1V[6];
      out.high = T1V[5] < 0.22 && T1V[6] > 30;
      out.coast = b === 0 || b === 1 || nearWater(src, x, z);
    }
    out.tempC = -24 + 54 * out.ts;
    return out;
  };
  // water within 24 m (8 points on a ring) — terrain height below the sea
  const RING = [[24, 0], [17, 17], [0, 24], [-17, 17], [-24, 0], [-17, -17], [0, -24], [17, -17]];
  function nearWater(src, x, z){
    for (let i = 0; i < 8; i++) {
      const px = x + RING[i][0], pz = z + RING[i][1];
      if (src.kind === 'kb') { const c = E.vox.genColumn(src.G, Math.floor(px), Math.floor(pz), KC2); if (c.h < E.vox.SEA) return true; }
      else if (E.terraCore.height(src.seed, px, pz) < 0) return true;
    }
    return false;
  }
  const KC2 = {};

  // ── region record for the weather scheduler: integers only, five fixed samples (majority class, ties → the centre) ──
  const RS = {}, CNT = new Int32Array(9);
  B.region = (src, x, z, cell = 128, out = {}) => {
    const cx = (Math.floor(x / cell) + 0.5) * cell, cz = (Math.floor(z / cell) + 0.5) * cell, q = cell / 4;
    CNT.fill(0);
    let smask = 0, F = 0, hs = 0, c0 = -1;
    for (let i = 0; i < 5; i++) {
      const px = cx + (i === 1 ? q : i === 2 ? -q : 0), pz = cz + (i === 3 ? q : i === 4 ? -q : 0);
      const r = B.at(src, px, pz, RS);
      if (i === 0) c0 = r.cls;
      CNT[r.cls]++; smask |= r.smask; hs += r.h;
      if (r.coast) F |= B.FEAT.coast;
      if (r.high) F |= B.FEAT.high;
      if (src.kind === 'kb' ? r.biome === 9 : false) F |= B.FEAT.river;
    }
    let best = c0;
    for (let k = 0; k < 9; k++) if (CNT[k] > CNT[best]) best = k;
    B.at(src, cx, cz, RS);
    out.ck = B.climateKey(best, RS.ts); out.cls = best; out.smask = smask; out.F = F; out.alt = Math.round(hs / 5);
    return out;
  };
  // climate.js key (C.CLIMATES: temperate, steppe, mountain, desert, sea, snow, tropic) of a class; swamp and warm by temperature
  B.climateKey = (cls, ts) => (cls <= 6 ? B.CLASSES[cls] : ts >= 0.62 ? 'tropic' : 'temperate');
  // (x, z) → climate.js key — for C.world({ climateAt }) of a game on this world (cached per 32 m cell, a small ring — no garbage)
  B.climateAtFn = (src, cell = 32) => {
    const K = new Float64Array(256), V = new Array(256).fill(''), R = {};
    return (x, z) => {
      const ix = Math.floor(x / cell), iz = Math.floor(z / cell), key = ix * 1048576 + iz, sl = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & 255;
      if (V[sl] && K[sl] === key) return V[sl];
      const r = B.at(src, (ix + 0.5) * cell, (iz + 0.5) * cell, R);
      K[sl] = key; V[sl] = B.climateKey(r.cls, r.ts);
      return V[sl];
    };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
})();

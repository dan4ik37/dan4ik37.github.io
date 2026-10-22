// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — планета (D37E.planet): круглая планета из кусков, «плоский кусок» под игроком, день и ночь от вращения,
//  времена года от наклона оси. ОБЩИЙ модуль для всех игр (план — docs/plans/planet.md, T-051): игра даёт только переходник.
// ═══════════════════════════════════════
// Без three.js и DOM — работает в node (scripts/planet-test.cjs), в потоке (js/engine/planet-worker.js) и на странице.
// Единицы — единицы движка (1 м = E.UNIT ≈ 1,17 ед.). Всё — от зерна и времени: у всех игроков одна и та же планета, сеть не нужна.
//
// Планета — ДАННЫЕ (PlanetProfile v1, docs/plans/planet.md §2.1): PL.def(p) проверяет и дополняет, PL.HOME — родная планета.
// P = PL.create(def):
//   P.height(x, y, z) — высота над радиусом в направлении (x, y, z) (единичный вектор); P.surf(d, out) — высота, цвет, вода.
//   Куб-сфера: 6 граней (+X −X +Y −Y +Z −Z), у грани оси u, v (u × v = наружу); равноугловое искажение s' = tan(s·π/4).
//   Узел дерева LOD — (грань, уровень L, i, j); ключ — число P.key(f, L, i, j). Вершины — целые точки «решётки» куба со стороной
//   M = N·2^L: одна и та же точка в соседних кусках (той же грани, другой грани, на уровень крупнее) даёт ОДНО и то же направление
//   и высоту до бита — швов нет.
//   P.select(cam, o, out) — какие куски нужны камере (cam — точка в системе планеты), P.balance — соседи отличаются не больше чем
//   на уровень, P.stitchMask — у какого края сосед крупнее (сшивка), P.buildChunk(f, L, i, j, N, { lite }) — сетка куска
//   (типизированные массивы: в потоке и на странице одинаково; lite — без формы родителя, как до T-075), PL.indices(N, mask) —
//   общие индексы сшивки.
//   Плоский кусок (как сейчас «Мир»): P.patch(dir) — своя система координат у якоря (x — восток, y — вверх, z — юг): P.toL / P.toBF,
//   высота для физики P.patchHeight(fr, x, z) — по тому же треугольнику, что нарисован; вода P.patchWater(fr, x, z);
//   P.rebaseMap(старый, новый) → { Q, t } — переезд якоря (позиции p' = Q p + t, скорости — Q).
//   Солнце и время: P.sunDir(t, ms, out) — направление на солнце в системе планеты (t — секунды игры, ms — реальное время для
//   времён года), P.localHour(d, t), P.season(ms), P.moonPos(i, t, out).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const PI = Math.PI, abs = Math.abs, floor = Math.floor, sqrt = Math.sqrt, min = Math.min, max = Math.max;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };   // a < b
  const mix = (a, b, t) => a + (b - a) * t;
  const DEG = PI / 180;

  // ═══ Шум: улучшенный шум Перлина (3D) с таблицей от зерна; октавы повёрнуты и сдвинуты — без сетки ═══
  function makeNoise(seed){
    const p = new Uint8Array(512), g = new Float64Array(48);
    let s = (seed >>> 0) || 1;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    // 12 направлений рёбер куба + 4 повтора (как у Перлина)
    const G = [1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1, 1,1,0, 0,-1,1, -1,1,0, 0,-1,-1];
    for (let i = 0; i < 48; i++) g[i] = G[i];
    function n3(x, y, z){
      const X0 = floor(x), Y0 = floor(y), Z0 = floor(z);
      x -= X0; y -= Y0; z -= Z0;
      const X = X0 & 255, Y = Y0 & 255, Z = Z0 & 255;
      const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10), w = z * z * z * (z * (z * 6 - 15) + 10);
      const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
      let h, gx;
      h = (p[AA] & 15) * 3; const n000 = g[h] * x + g[h + 1] * y + g[h + 2] * z;
      h = (p[BA] & 15) * 3; const n100 = g[h] * (x - 1) + g[h + 1] * y + g[h + 2] * z;
      h = (p[AB] & 15) * 3; const n010 = g[h] * x + g[h + 1] * (y - 1) + g[h + 2] * z;
      h = (p[BB] & 15) * 3; const n110 = g[h] * (x - 1) + g[h + 1] * (y - 1) + g[h + 2] * z;
      h = (p[AA + 1] & 15) * 3; const n001 = g[h] * x + g[h + 1] * y + g[h + 2] * (z - 1);
      h = (p[BA + 1] & 15) * 3; const n101 = g[h] * (x - 1) + g[h + 1] * y + g[h + 2] * (z - 1);
      h = (p[AB + 1] & 15) * 3; const n011 = g[h] * x + g[h + 1] * (y - 1) + g[h + 2] * (z - 1);
      h = (p[BB + 1] & 15) * 3; gx = g[h] * (x - 1) + g[h + 1] * (y - 1) + g[h + 2] * (z - 1);
      const x00 = n000 + u * (n100 - n000), x10 = n010 + u * (n110 - n010), x01 = n001 + u * (n101 - n001), x11 = n011 + u * (gx - n011);
      const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01);
      return y0 + w * (y1 - y0);
    }
    // поворот октав (матрица поворота ~ 37° вокруг (1, 2, 3)/|…|) и сдвиг — не видно сетки шума
    const c = Math.cos(.65), sn = Math.sin(.65), ax = 1 / sqrt(14), ay = 2 / sqrt(14), az = 3 / sqrt(14), t1 = 1 - c;
    const R00 = c + ax * ax * t1, R01 = ax * ay * t1 - az * sn, R02 = ax * az * t1 + ay * sn;
    const R10 = ay * ax * t1 + az * sn, R11 = c + ay * ay * t1, R12 = ay * az * t1 - ax * sn;
    const R20 = az * ax * t1 - ay * sn, R21 = az * ay * t1 + ax * sn, R22 = c + az * az * t1;
    function fbm(x, y, z, oct){
      let v = 0, a = .5, tot = 0;
      for (let i = 0; i < oct; i++) {
        v += n3(x, y, z) * a; tot += a; a *= .5;
        const nx = (R00 * x + R01 * y + R02 * z) * 2.03 + 3.1, ny = (R10 * x + R11 * y + R12 * z) * 2.03 - 1.7, nz = (R20 * x + R21 * y + R22 * z) * 2.03 + 5.3;
        x = nx; y = ny; z = nz;
      }
      return v / tot;   // ≈ −1…1 (обычно ±0,6)
    }
    // хребты: 1 − |шум|, в квадрате, каждая октава слабее там, где прошлая низкая (острые гребни, мягкие долины)
    function ridge(x, y, z, oct){
      let v = 0, a = .5, tot = 0, wgt = 1;
      for (let i = 0; i < oct; i++) {
        let r = 1 - abs(n3(x, y, z)); r *= r;
        v += r * a * wgt; tot += a; wgt = min(1, r * 1.8); a *= .5;
        const nx = (R00 * x + R01 * y + R02 * z) * 2.07 - 2.3, ny = (R10 * x + R11 * y + R12 * z) * 2.07 + 4.1, nz = (R20 * x + R21 * y + R22 * z) * 2.07 - .9;
        x = nx; y = ny; z = nz;
      }
      return v / tot;   // 0…1
    }
    return { n3, fbm, ridge };
  }

  // ═══ Профиль планеты (данные) ═══
  // PlanetProfile v2 (docs/plans/planet-space.md §1.1, T-079): тип тела, система, орбита по Кеплеру (элементы — градусы, период — из
  // μ родителя, js/engine/orbit.js), воздух для игры (air: { p кПа, o2, co2, n2, toxic, dust } | null), температура
  // { mean, dayAmp, latAmp }, луны — id своих тел (у них свои профили, D37E.system) и «украшения» v1 (rails 'visual'), кольца,
  // пояс, ресурсы, опасности, метеориты, терраформирование. Профили v1 (без v или v: 1) поднимаются до v2 сами, тем же PL.def.
  const ATMO_EARTH = { top: 0, Hr: 0, Hm: 0, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 };
  const ID = /^[a-z][a-z0-9_-]{0,31}$/;
  // v1 — как было до v2 (от него считаются умолчания профилей v1: та же планета до бита)
  const HOME_V1 = {
    v: 1, id: 'home', title: 'Родная планета', seed: 37, radius: 128000, sea: 0, gen: 'rocky1',
    relief: { amp: 2600, land: .42, hills: 140, detail: 7, warp: .35 },
    atmo: { top: 32000, Hr: 4000, Hm: 800, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 },
    air: true, o2: .21, pressure: 1, g: 1, day: 2400, phase: 0, tilt: 23.4, year: 'calendar', temp: 14,
    moons: [{ id: 'luna', radius: 32000, dist: 2400000, period: 7 * 2400, phase: 1.1, incl: 5, tint: '#cfcfcf' }],
    sky: { stars: 1, sunSize: 1 }, regions: [], hazards: [], mobs: [], requires: { rocket: 0 }, games: {},
  };
  // Родная планета (v2): та же поверхность до бита (зерно, рельеф, море, температура), Луна — своё тело системы (js/engine/system.js:
  // орбита по Кеплеру, a = 1 398 144 u, период 16 800 с); год — календарь владельца (времена года — climate.js), орбита вокруг
  // Солнца — ровные 365,25 суток (для неба и перелётов)
  const HOME = {
    v: 2, id: 'home', title: 'Родная планета', type: 'rocky', system: 'home', hero: true, seed: 37, radius: 128000, g: 1, surface: 'solid',
    sea: 0, liquid: 'water', gen: 'rocky1', relief: { amp: 2600, land: .42, hills: 140, detail: 7, warp: .35 },
    // воздух: высота однородной толщи Рэлея 4000 ед. (≈ 3,4 км), прозрачнее земного вдвое — видно на ~30 км, небо голубое
    air: { p: 101, o2: .21, co2: .0004, n2: .78, toxic: 0, dust: 0 },
    atmo: { top: 32000, Hr: 4000, Hm: 800, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 },
    temp: { mean: 14, dayAmp: 8, latAmp: 44 }, climate: { kinds: ['temperate', 'steppe', 'mountain', 'desert', 'sea', 'snow', 'tropic'], storm: null },
    day: 2400, phase: 0, tilt: 23.4, locked: false, year: 'calendar',
    orbit: { parent: 'sun', a: 4.0e9, e: 0, i: 0, node: 0, peri: 0, M0: 0, epoch: 0, period: 'year' }, rails: 'kepler',
    rings: null, belt: null, moons: ['luna'],
    resources: [{ id: 'iron', where: 'mountains', k: 1 }, { id: 'coal', where: 'buried', k: 1 }, { id: 'oil', where: 'sea|desert', k: .6 }],
    hazards: ['weather'], danger: 0, age: 0, meteors: { rate: 1, big: 1 }, terra: { on: false },
    sky: { stars: 1, sunSize: 1 }, regions: [], mobs: [], requires: { rocket: 0 }, games: {},
  };
  // v2: нейтральные умолчания — у тела без поля ничего «родного» (ни Луны, ни календаря, ни земного воздуха)
  const BASE2 = {
    v: 2, id: 'planet', title: 'Планета', type: 'rocky', system: null, hero: false, stub: false, seed: 37, radius: 64000, g: 1, surface: 'solid',
    sea: null, liquid: null, gen: 'rocky1', air: null, temp: { mean: 0, dayAmp: 10, latAmp: 44 }, climate: { kinds: [], storm: null },
    day: 2400, phase: 0, tilt: 0, locked: false, year: 0, orbit: null, rails: 'kepler', rings: null, belt: null, moons: [],
    resources: [], hazards: [], danger: 0, age: 6, meteors: { rate: 1, big: 1 }, terra: { on: false },
    sky: { stars: 1, sunSize: 1 }, regions: [], mobs: [], requires: { rocket: 0 }, games: {},
  };
  const TYPES = ['rocky', 'ocean', 'ice', 'desert', 'lava', 'toxic', 'gas', 'moon', 'belt', 'aster', 'star'];
  const AGES = [0, 6, 12, 14, 16, 18];
  const num = (v, d, a = -Infinity, b = Infinity) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? clamp(n, a, b) : d; };
  const hex = (v, d) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d;
  const strs = (a, n, len = 32) => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string').slice(0, n).map(x => x.slice(0, len));
  // атмосфера для картинки (рассеяние) — из воздуха для игры, если её не задали (§1.5): Рэлей ∝ давлению, Ми — пыль и яд
  function atmoOf(air, R){
    if (!air || !(air.p > .05)) return null;
    const k = air.p / 101, Hr = R * .03125, dust = air.dust || 0, tox = air.toxic || 0;
    const a = { top: Hr * 8, Hr, Hm: Hr / 5, tauR: [.023 * k, .054 * k, .133 * k], tauM: .012 * k + .08 * dust * Math.sqrt(k) + .12 * tox, g: .76, sun: 1 };
    if (tox > .1) a.tint = '#d8c060'; else if (dust > .1) a.tint = '#d08a5a';
    return a;
  }
  // проверка и значения по умолчанию (всегда v2); неизвестные поля — как есть (переходникам игр); def(def(p)) = def(p)
  function def(p = {}){
    if (!p || typeof p !== 'object') p = {};
    const v2in = p.v === 2;
    const o = v2in ? { ...BASE2, ...p } : { ...HOME_V1, ...p };   // v1 — от прежней родной (как до v2)
    o.v = 2;
    o.id = ID.test(o.id) ? o.id : 'planet';
    o.title = String(o.title || 'Планета').slice(0, 60);
    o.type = TYPES.includes(o.type) ? o.type : 'rocky';
    o.system = typeof o.system === 'string' && ID.test(o.system) ? o.system : null;
    o.hero = !!o.hero; o.stub = !!o.stub;
    o.seed = num(o.seed, 37) | 0;
    o.radius = num(o.radius, 128000, 500, 2e7);
    o.surface = o.surface === 'none' ? 'none' : 'solid';
    o.sea = o.sea === null ? null : num(o.sea, 0, -1e5, 1e5);
    o.liquid = ['water', 'lava', 'methane'].includes(o.liquid) ? o.liquid : o.sea != null ? 'water' : null;
    // генератор: id сохраняется (moon1, desert1… — следующие шаги), рисует rocky1, пока своего нет (create)
    o.gen = typeof o.gen === 'string' && ID.test(o.gen) ? o.gen : 'rocky1';
    const rl = { ...HOME_V1.relief, ...(p.relief || {}) };
    o.relief = { ...rl, amp: num(rl.amp, 2600, 0, o.radius * .2), land: num(rl.land, .42, 0, 1), hills: num(rl.hills, 140, 0, 1e4), detail: num(rl.detail, 7, 0, 200), warp: num(rl.warp, .35, 0, 1) };
    // воздух для игры: v1 — air: true/false + o2 + pressure (в атмосферах); v2 — объект или null
    if (v2in) {
      const A = p.air;
      o.air = A && typeof A === 'object' ? { p: num(A.p, 101, 0, 1e5), o2: num(A.o2, 0, 0, 1), co2: num(A.co2, 0, 0, 1), n2: num(A.n2, 0, 0, 1), toxic: num(A.toxic, 0, 0, 1), dust: num(A.dust, 0, 0, 1) } : null;
    } else o.air = o.air === false ? null : { p: num(o.pressure, 1, 0, 1000) * 101, o2: num(o.o2, .21, 0, 1), co2: .0004, n2: .78, toxic: 0, dust: 0 };
    delete o.o2; delete o.pressure;
    // атмосфера (картинка): null — без воздуха; не задана — v1: как у прежней родной (или нет, если air: false), v2: из воздуха
    const src = p.atmo === null ? null : p.atmo && typeof p.atmo === 'object' ? p.atmo : v2in ? atmoOf(o.air, o.radius) : p.air === false ? null : HOME_V1.atmo;
    if (!src) o.atmo = null;
    else {
      const a = { ...ATMO_EARTH, ...(v2in ? atmoOf(o.air, o.radius) || {} : {}), ...src };   // v2: чего нет в atmo — из воздуха
      const Hr = num(a.Hr || undefined, o.radius * .03125, 1, o.radius);
      o.atmo = { top: num(a.top || undefined, Hr * 8, Hr, o.radius), Hr, Hm: num(a.Hm || undefined, Hr / 5, .5, o.radius), tauR: (Array.isArray(a.tauR) && a.tauR.length === 3 ? a.tauR : ATMO_EARTH.tauR).map(x => num(x, .1, 0, 10)),
        tauM: num(a.tauM, .03, 0, 10), g: num(a.g, .76, -.99, .99), sun: num(a.sun, 1, 0, 10) };
      const tn = hex(a.tint, null); if (tn) o.atmo.tint = tn;
    }
    o.g = num(o.g, 1, 0, 10);
    o.day = num(o.day, 2400, 10, 1e9);
    o.phase = num(o.phase, 0);
    o.tilt = num(o.tilt, 23.4, -180, 180);
    o.locked = !!o.locked;
    o.year = o.year === 'calendar' ? 'calendar' : num(o.year, v2in ? 0 : 365 * 2400, 0);
    // температура: v1 — число (°C на экваторе − 14), v2 — { mean, dayAmp, latAmp }
    const T = o.temp && typeof o.temp === 'object' ? o.temp : { mean: num(o.temp, 14, -200, 500) };
    o.temp = { mean: num(T.mean, 14, -273, 3000), dayAmp: num(T.dayAmp, 8, 0, 500), latAmp: num(T.latAmp, 44, 0, 500) };
    const cl = o.climate && typeof o.climate === 'object' ? o.climate : {};
    o.climate = { kinds: strs(cl.kinds, 16), storm: typeof cl.storm === 'string' ? cl.storm.slice(0, 32) : null };
    // орбита (элементы — градусы; период — из μ родителя, кроме rails 'visual'); v1 — { parent, a, e, period: 'year', phase }
    const ob = o.orbit;
    if (ob && typeof ob === 'object' && num(ob.a, 0) !== 0) {
      o.orbit = { parent: typeof ob.parent === 'string' && ID.test(ob.parent) ? ob.parent : 'sun', a: num(ob.a, 0, -1e15, 1e15), e: num(ob.e, 0, 0, .99),
        i: num(ob.i, 0, -180, 180), node: num(ob.node, 0, -360, 720), peri: num(ob.peri, 0, -360, 720), M0: num(ob.M0 ?? ob.phase, 0, -1e6, 1e6), epoch: num(ob.epoch, 0) };
      if (ob.period === 'year') o.orbit.period = 'year'; else if (num(ob.period, 0) > 0) o.orbit.period = num(ob.period, 0);
    } else o.orbit = null;
    o.rails = o.rails === 'visual' ? 'visual' : 'kepler';
    const rg = o.rings;
    o.rings = rg && typeof rg === 'object' ? { inner: num(rg.inner, o.radius * 1.3, 0), outer: num(rg.outer, o.radius * 2.2, 0), tint: hex(rg.tint, '#c9b48a'), alpha: num(rg.alpha, .6, 0, 1) } : null;
    const bl = o.belt;
    o.belt = bl && typeof bl === 'object' ? { a: num(bl.a, 0, 0), width: num(bl.width, 0, 0), density: num(bl.density, 1, 0, 100) } : null;
    // луны: id своих тел (строки) и «украшения» v1 (объекты: круговая орбита со своим периодом — rails 'visual')
    o.moons = (Array.isArray(o.moons) ? o.moons : []).slice(0, 8).map((m, i) => typeof m === 'string' ? (ID.test(m) ? m : null) : m && typeof m === 'object' ? {
      id: String(m.id || 'moon' + i).slice(0, 32), radius: num(m.radius, o.radius / 4, 10, o.radius * 2), dist: num(m.dist, o.radius * 20, o.radius * 2, 1e9),
      period: num(m.period, o.day * 7, 1), phase: num(m.phase, 0), incl: num(m.incl, 5, -90, 90), tint: hex(m.tint, '#cfcfcf'), rails: 'visual' } : null).filter(Boolean);
    o.resources = (Array.isArray(o.resources) ? o.resources : []).filter(r => r && typeof r === 'object' && typeof r.id === 'string').slice(0, 16)
      .map(r => ({ id: r.id.slice(0, 32), where: typeof r.where === 'string' ? r.where.slice(0, 64) : 'surface', k: num(r.k, 1, 0, 10) }));
    o.hazards = strs(o.hazards, 16);
    o.danger = num(o.danger, 0, 0, 3) | 0;
    o.age = AGES.includes(o.age) ? o.age : 6;
    const mt = o.meteors && typeof o.meteors === 'object' ? o.meteors : {};
    o.meteors = { rate: num(mt.rate, 1, 0, 100), big: num(mt.big, 1, 0, 100) };
    const tr = o.terra && typeof o.terra === 'object' ? o.terra : {};
    o.terra = { on: !!tr.on };
    if (tr.vars0 && typeof tr.vars0 === 'object') { const V0 = tr.vars0; o.terra.vars0 = { p: num(V0.p, 0, 0, 1e4), o2: num(V0.o2, 0, 0, 100), t: num(V0.t, 0, -273, 3000), w: num(V0.w, 0, 0, 1), b: num(V0.b, 0, 0, 1), x: num(V0.x, 0, 0, 1) }; }
    o.regions = Array.isArray(o.regions) ? o.regions.slice(0, 64) : [];
    o.games = o.games && typeof o.games === 'object' ? o.games : {};
    return o;
  }
  // ── Сутки и времена года по профилю (без планеты — для системы, js/engine/system.js; P.season и др. зовут их же) ──
  // фаза года φ (0 весна, 1 лето, 2 осень, 3 зима): календарь владельца (climate.js) или свой год (секунды)
  function seasonOf(D, ms){
    if (D.year === 'calendar') {
      const C = E.climate;
      if (C?.phaseCal) { try { return C.phaseCal(ms); } catch (e) {} }
      // без climate.js (поток): та же формула, что C.phaseCal — время мира МСК (UTC+3), декабрь–февраль зима, март–ноябрь 7 сезонов
      const t = ms + 180 * 60000, dt = new Date(t), y = dt.getUTCFullYear(), mo = dt.getUTCMonth();
      if (mo === 11) return 3 + (t - Date.UTC(y, 11, 1)) / (Date.UTC(y + 1, 2, 1) - Date.UTC(y, 11, 1));
      if (mo <= 1) return 3 + (t - Date.UTC(y - 1, 11, 1)) / (Date.UTC(y, 2, 1) - Date.UTC(y - 1, 11, 1));
      return (7 * (t - Date.UTC(y, 2, 1)) / (Date.UTC(y, 11, 1) - Date.UTC(y, 2, 1))) % 4;
    }
    const yr = D.year > 0 ? D.year : 365 * 2400;
    return ((ms / 1000 / yr) % 1 + 1) % 1 * 4;
  }
  // склонение солнца: точное для наклонённой оси (sin δ = sin ε · sin L, L = (φ − ½)·90° — долгота солнца по году):
  // +ε в середине лета, −ε в середине зимы, 0 в середине весны и осени. Та же формула — у неба системы (system.js)
  const declinationOf = (D, ms) => Math.asin(Math.sin(D.tilt * DEG) * Math.cos((seasonOf(D, ms) - 1.5) * PI / 2));
  // долгота «под солнцем» в момент t (секунды мира): планета вращается на восток — точка под солнцем уходит на запад
  const subSolarLonOf = (D, t) => D.phase * DEG - 2 * PI * t / D.day;

  // ═══ Куб-сфера ═══
  // грань: [нормаль n, ось u, ось v], u × v = n (наружу)
  const FACES = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const Q4 = PI / 4, MAXL = 20;
  // равноугловое искажение по оси (концы — ровно ±1: одно и то же у обеих граней на ребре)
  const warp = x => x === 1 ? 1 : x === -1 ? -1 : Math.tan(x * Q4);
  const unwarp = x => Math.atan(x) / Q4;
  // точка решётки куба (целые K ∈ [0, M]) → единичное направление; одна формула для всех граней (биты совпадают)
  function latDir(Kx, Ky, Kz, M, out){
    const x = warp(2 * Kx / M - 1), y = warp(2 * Ky / M - 1), z = warp(2 * Kz / M - 1), l = sqrt(x * x + y * y + z * z);
    out[0] = x / l; out[1] = y / l; out[2] = z / l; return out;
  }
  // (грань, gi, gj) решётки грани со стороной M → целая точка куба K
  function latK(f, gi, gj, M, out){
    const F = FACES[f], n = F[0], u = F[1], v = F[2], h = M / 2, a = gi - h, b = gj - h;
    out[0] = n[0] * h + h + u[0] * a + v[0] * b; out[1] = n[1] * h + h + u[1] * a + v[1] * b; out[2] = n[2] * h + h + u[2] * a + v[2] * b;
    return out;
  }
  // направление по параметрам грани (s, t ∈ [−1, 1], и чуть за краем — для нормалей у края)
  function dirOf(f, s, t, out){
    const F = FACES[f], n = F[0], u = F[1], v = F[2];
    const cx = warp(n[0] + u[0] * s + v[0] * t), cy = warp(n[1] + u[1] * s + v[1] * t), cz = warp(n[2] + u[2] * s + v[2] * t);
    const l = sqrt(cx * cx + cy * cy + cz * cz); out[0] = cx / l; out[1] = cy / l; out[2] = cz / l; return out;
  }
  // направление → грань и параметры (s, t) без искажения; out = [f, s, t]
  function faceOf(x, y, z, out){
    const ax = abs(x), ay = abs(y), az = abs(z);
    let f;
    if (ax >= ay && ax >= az) f = x > 0 ? 0 : 1; else if (ay >= az) f = y > 0 ? 2 : 3; else f = z > 0 ? 4 : 5;
    const F = FACES[f], n = F[0], u = F[1], v = F[2], dn = x * n[0] + y * n[1] + z * n[2];
    out[0] = f; out[1] = unwarp((x * u[0] + y * u[1] + z * u[2]) / dn); out[2] = unwarp((x * v[0] + y * v[1] + z * v[2]) / dn);
    return out;
  }
  // то же для точки куба (не единичный вектор, без искажения): для поиска соседа за ребром
  function cubeFace(cx, cy, cz, out){
    const ax = abs(cx), ay = abs(cy), az = abs(cz);
    let f;
    if (ax >= ay && ax >= az) f = cx > 0 ? 0 : 1; else if (ay >= az) f = cy > 0 ? 2 : 3; else f = cz > 0 ? 4 : 5;
    const F = FACES[f], n = F[0], u = F[1], v = F[2], dn = cx * n[0] + cy * n[1] + cz * n[2];
    out[0] = f; out[1] = (cx * u[0] + cy * u[1] + cz * u[2]) / dn; out[2] = (cx * v[0] + cy * v[1] + cz * v[2]) / dn;
    return out;
  }
  const P2 = new Float64Array(MAXL + 2); for (let i = 0; i <= MAXL + 1; i++) P2[i] = Math.pow(2, i);
  const key = (f, L, i, j) => ((f * 32 + L) * 1048576 + i) * 1048576 + j;
  const unkey = (k, out) => { const j = k % 1048576, r = (k - j) / 1048576, i = r % 1048576, r2 = (r - i) / 1048576; out[0] = floor(r2 / 32); out[1] = r2 % 32; out[2] = i; out[3] = j; return out; };

  // ═══ Генераторы рельефа (реестр: PL.GEN[id] = (noise, def) → height(x, y, z)) ═══
  const GEN = {
    // каменная планета: материки (искажённый шум), хребты в горных поясах, холмы, мелкие неровности (≈ 10 ед.) — одна функция
    // для всех уровней LOD (общие вершины кусков совпадают)
    rocky1(N, d){
      const rl = d.relief, sea = d.sea ?? 0, amp = rl.amp, hillA = rl.hills, detA = rl.detail, wk = rl.warp;
      const th = (.5 - rl.land) * .55;   // доля суши → порог материков
      const fbm = N.fbm, ridge = N.ridge;
      return (x, y, z) => {
        const wx = fbm(x * 2.1 + 11.3, y * 2.1 + 4.7, z * 2.1 - 8.2, 3), wy = fbm(x * 2.1 - 6.1, y * 2.1 + 9.4, z * 2.1 + 2.6, 3), wz = fbm(x * 2.1 + 1.9, y * 2.1 - 3.3, z * 2.1 + 7.7, 3);
        const e = fbm(x * 1.35 + wx * wk * 2, y * 1.35 + wy * wk * 2, z * 1.35 + wz * wk * 2, 5) - th;
        // суша: от берега вверх; море: мелководье у берега, дальше глубина
        let h = e > 0 ? Math.pow(e, .85) * 760 : e > -.05 ? e * 1400 : -70 - (-e - .05) * 2600;
        const belt = sstep(.02, .32, fbm(x * 1.9 + 3.1, y * 1.9 - 7.3, z * 1.9 + 1.2, 3) * .5 + .25);
        if (belt > 0 && e > -.02) h += belt * Math.pow(ridge(x * 7.5 + 2.2, y * 7.5 - 5.1, z * 7.5 + .4, 6), 1.6) * amp * sstep(-.02, .14, e);
        h += fbm(x * 48 - 1.4, y * 48 + 2.8, z * 48 + 6.6, 4) * hillA * sstep(-.03, .08, e);
        h += fbm(x * 900 + 7.3, y * 900 - 2.2, z * 900 + 1.1, 5) * detA;
        return sea + h;
      };
    },
    // ровная (для проверок): только шум неровностей
    flat(N, d){ const detA = d.relief.detail, sea = d.sea ?? 0; return (x, y, z) => sea + 40 + N.fbm(x * 900, y * 900, z * 900, 3) * detA; },
  };

  // ═══ Индексы куска: КАЖДАЯ клетка — диагональ b–c (как у физики и у «перетекания» LOD: кусок, сжатый к форме родителя, ровно
  //     повторяет родителя — шагов нет нигде, и у края тоже). У края с крупным соседом (бит маски) — полоса «веером» по парам клеток:
  //     нечётные вершины края пропускаются, край куска ровно совпадает с краем соседа; в углу, где сшиты оба края, каждый веер
  //     берёт свою половину угловой клетки. Юбки — вниз.
  //     mask: бит 0 — край i = 0 (−s), 1 — i = N (+s), 2 — j = 0 (−t), 3 — j = N (+t). Вершины: сетка (N+1)², потом юбки 4·(N+1) ═══
  const IDX = new Map();
  function indices(N, mask){
    const k = N * 16 + mask;
    if (IDX.has(k)) return IDX.get(k);
    const n1 = N + 1, out = [];
    const vid = (a, b) => b * n1 + a;   // a — по s (i), b — по t (j)
    const st = e => (mask >> e) & 1;
    // обычные клетки: все, кроме полос сшитых краёв
    for (let b = 0; b < N; b++) for (let a = 0; a < N; a++) {
      if ((a === 0 && st(0)) || (a === N - 1 && st(1)) || (b === 0 && st(2)) || (b === N - 1 && st(3))) continue;
      const A = vid(a, b), B = vid(a + 1, b), C = vid(a, b + 1), D = vid(a + 1, b + 1);
      out.push(A, B, C, B, D, C);
    }
    // веер по паре клеток вдоль сшитого края e: внешние (на краю) — только чётные, внутренние — ряд за краем.
    // o(q), w(q) — вершины внешнего и внутреннего ряда; у концов маленький треугольник берёт вершину соседнего края —
    // если и тот сшит, её нет (нечётная) — треугольник отдаёт свою половину угловой клетки соседнему вееру
    const E4 = [   // [внешняя, внутренняя, соседний край у q = 0, у q = N]
      [q => vid(0, q), q => vid(1, q), 2, 3], [q => vid(N, q), q => vid(N - 1, q), 2, 3],
      [q => vid(q, 0), q => vid(q, 1), 0, 1], [q => vid(q, N), q => vid(q, N - 1), 0, 1],
    ];
    for (let e = 0; e < 4; e++) {
      if (!st(e)) continue;
      const [o, w, e0, e1] = E4[e];
      for (let q = 0; q < N; q += 2) {
        const first = q === 0 && st(e0), last = q + 2 === N && st(e1);
        // обход наружу (как у сетки): у краёв 0 и 3 — один порядок, у 1 и 2 — другой
        if (e === 0) { out.push(o(q), w(q + 1), o(q + 2)); if (!first) out.push(o(q), w(q), w(q + 1)); if (!last) out.push(o(q + 2), w(q + 1), w(q + 2)); }
        else if (e === 1) { out.push(o(q), o(q + 2), w(q + 1)); if (!first) out.push(o(q), w(q + 1), w(q)); if (!last) out.push(o(q + 2), w(q + 2), w(q + 1)); }
        else if (e === 2) { out.push(o(q), o(q + 2), w(q + 1)); if (!first) out.push(o(q), w(q + 1), w(q)); if (!last) out.push(o(q + 2), w(q + 2), w(q + 1)); }
        else { out.push(o(q), w(q + 1), o(q + 2)); if (!first) out.push(o(q), w(q), w(q + 1)); if (!last) out.push(o(q + 2), w(q + 1), w(q + 2)); }
      }
    }
    // юбки: вершины n1² + e·n1 + q (q — по краю); полоса между краем и юбкой (обход наружу; лишнее отсечёт глубина)
    const base = n1 * n1;
    for (let e = 0; e < 4; e++) {
      const st = mask >> e & 1 ? 2 : 1;
      for (let q = 0; q + st <= N; q += st) {
        const v0 = e === 0 ? vid(0, q) : e === 1 ? vid(N, q) : e === 2 ? vid(q, 0) : vid(q, N);
        const v1 = e === 0 ? vid(0, q + st) : e === 1 ? vid(N, q + st) : e === 2 ? vid(q + st, 0) : vid(q + st, N);
        const s0 = base + e * n1 + q, s1 = base + e * n1 + q + st;
        // наружу: у краёв 0 и 3 — как у трапеций с flip
        if (e === 1 || e === 2) out.push(v0, s0, v1, v1, s0, s1); else out.push(v0, v1, s0, v1, s1, s0);
      }
    }
    const arr = new Uint16Array(out);
    IDX.set(k, arr);
    return arr;
  }

  // ═══ Планета ═══
  function create(profile){
    const D = def(profile);
    const NZ = makeNoise(D.seed * 7919 + 13);
    const NZ2 = makeNoise(D.seed * 104729 + 7);   // климат и влажность — свой шум
    const H = (GEN[D.gen] || GEN.rocky1)(NZ, D);   // своего генератора ещё нет (moon1, desert1… — шаги PS-6, PS-8) — каменная
    const R = D.radius, SEA = D.sea ?? -Infinity, SEAR = R + (D.sea ?? 0);
    const amp = D.relief.amp;
    const P = { def: D, R, SEA, SEAR, FACES, key, unkey, warp, unwarp, latDir, latK, dirOf, faceOf, cubeFace, noise: NZ, genOk: !!GEN[D.gen] };
    P.height = (x, y, z) => H(x, y, z);
    P.maxH = (D.sea ?? 0) + 760 + amp + D.relief.hills + D.relief.detail + 40;   // выше не бывает (для отсечения и дальности)
    P.minH = (D.sea ?? 0) - 2600 - 400;
    P.renderMin = D.sea != null ? D.sea : P.minH;   // нарисованная поверхность не ниже моря (вода — часть сетки)

    // ── Климат и цвет поверхности (в sRGB 0…255; вода — альфа: 0 суша, 1…255 — глубина) ──
    const C3 = [0, 0, 0], TM = D.temp.mean, TL = D.temp.latAmp;
    function tempAt(x, y, z, h){   // °C: широта, высота, шум
      const sl = y * y;   // sin² широты: экватор +28°, 45° ≈ +17°, 60° ≈ +3°, 70° ≈ −6°, полюс ≈ −16° (при temp.mean 14, latAmp 44)
      return TM + 14 - TL * sl * sl - Math.max(0, h - (D.sea ?? 0)) / 1166 * 6.5 + NZ2.fbm(x * 3.1 + 5, y * 3.1 - 2, z * 3.1 + 9, 3) * 6;
    }
    // море замёрзло (холодно у полюсов): по льду ходят, рисуется белым
    const iceAt = (x, y, z) => D.sea != null && tempAt(x, y, z, D.sea) < -3;
    function moistAt(x, y, z){
      const lat = Math.asin(clamp(y, -1, 1)) / DEG, dry = Math.exp(-Math.pow((abs(lat) - 24) / 9, 2)) * .32;   // пояса пустынь у ±24°
      return clamp(NZ2.fbm(x * 2.6 - 4, y * 2.6 + 7, z * 2.6 - 1, 4) * .9 + .55 - dry, 0, 1);
    }
    // цвет суши: высота, «вверх» (крутизна: 1 — ровно), направление; out — [r, g, b] 0…1 (sRGB)
    function landColor(x, y, z, h, up, out){
      const T = tempAt(x, y, z, h), m = moistAt(x, y, z), above = h - (D.sea ?? 0), nz = NZ2.n3(x * 400, y * 400, z * 400) * .5;
      let r, g, b;
      // по влажности: пустыня → степь → трава → лес
      const k1 = sstep(.18, .32, m), k2 = sstep(.34, .5, m), k3 = sstep(.55, .7, m);
      r = mix(.8, .7, k1); g = mix(.68, .64, k1); b = mix(.48, .36, k1);         // песок → степь
      r = mix(r, .38, k2); g = mix(g, .6, k2); b = mix(b, .26, k2);              // → трава
      r = mix(r, .2, k3); g = mix(g, .42, k3); b = mix(b, .19, k3);              // → лес
      // холод: тайга темнее и синее, тундра серо-бурая
      const cold = sstep(10, 0, T);
      r = mix(r, mix(.42, .16, k3), cold * .8); g = mix(g, mix(.42, .3, k3), cold * .8); b = mix(b, mix(.34, .22, k3), cold * .8);
      // пляж у моря
      if (D.sea != null) { const beach = sstep(12, 3, above) * sstep(.82, .95, up); r = mix(r, .86, beach); g = mix(g, .78, beach); b = mix(b, .58, beach); }
      // скалы: круто или высоко
      const rock = max(sstep(.86, .7, up), sstep(1500 + nz * 300, 2200 + nz * 300, above) * .85);
      r = mix(r, .48 + nz * .08, rock); g = mix(g, .46 + nz * .07, rock); b = mix(b, .44 + nz * .06, rock);
      // снег и лёд: мороз (полюса, вершины), только где не слишком круто
      const snow = sstep(-1, -6, T + nz * 3) * sstep(.55, .75, up);
      r = mix(r, .95, snow); g = mix(g, .97, snow); b = mix(b, 1, snow);
      out[0] = clamp(r + nz * .03, 0, 1); out[1] = clamp(g + nz * .03, 0, 1); out[2] = clamp(b + nz * .02, 0, 1);
      return out;
    }
    P.tempAt = tempAt; P.moistAt = moistAt; P.landColor = landColor; P.iceAt = iceAt;
    // Климат места для погоды движка (T-075, js/engine/climate.js C.CLIMATES) — как цвет поверхности: широта и высота (температура),
    // влага (пояса пустынь у ±24°); море — 'sea', замёрзшее море и холод — 'snow', выше 1200 ед. над морем — 'mountain', сухо и
    // тепло — 'desert', жарко и влажно — 'tropic', сухо — 'steppe', иначе — 'temperate'. Средний за год (сезон и сутки добавит погода)
    P.climateAt = d => {
      const x = d[0], y = d[1], z = d[2], h = H(x, y, z);
      if (D.sea != null && h < D.sea) return iceAt(x, y, z) ? 'snow' : 'sea';
      const T = tempAt(x, y, z, h), m = moistAt(x, y, z), above = h - (D.sea ?? 0);
      if (T < -2) return 'snow';
      if (above > 1200) return 'mountain';
      if (m < .3 && T > 10) return 'desert';
      if (T > 21 && m > .55) return 'tropic';
      if (m < .42) return 'steppe';
      return 'temperate';
    };
    // всё о точке поверхности: { h, water (глубина ≥ 0 или 0), r, g, b }
    P.surf = (d, out = {}) => {
      const h = H(d[0], d[1], d[2]);
      out.h = h; out.water = D.sea != null && h < D.sea ? D.sea - h : 0;
      landColor(d[0], d[1], d[2], h, 1, C3); out.r = C3[0]; out.g = C3[1]; out.b = C3[2];
      return out;
    };

    // ── Узлы дерева LOD (объекты живут, пока нужны; ссылки на родителя, детей и соседей — без поиска в таблице) ──
    const nodes = new Map();
    const tmp3 = [0, 0, 0], tmpK = [0, 0, 0], tmpF = [0, 0, 0];
    function node(f, L, i, j){
      const k = key(f, L, i, j);
      let n = nodes.get(k);
      if (n) {
        // родитель вычищен и создан заново (узел — от поиска соседа, не из kidsOf: чистка его не задела) — ссылку на живого
        if (L && nodes.get(n.par.key) !== n.par) n.par = node(f, L - 1, i >> 1, j >> 1);
        return n;
      }
      n = { key: k, f, L, i, j, c: [0, 0, 0], cp: [0, 0, 0], ang: 0, size: 0, hc: 0, hmin: P.renderMin, hmax: P.maxH, built: false,
        split: false, leaf: 0, used: 0, mask: 0, par: null, kids: null, nb: null,
        // LOD v2: ошибки (своя, «4 ребёнка вместо меня» — измеренная и использованная), экранная, перетекание, показ
        err: -1, eK: -1, eKs: 0, rho: 0, k: 0, kt: 0, kc: 1, kcT: 0, px: 0, mrg: 0, wantM: 0, standT: -1e9, ke: null, rel: null, nbs: null, tShow: 0, dis: 0, pm: 0, below: 0, below2: 0, needM: 0, imp: 0, vis: 0 };
      const M = P2[L] * 2;   // решётка 2×2 на узел: центр — целая точка
      latK(f, i * 2 + 1, j * 2 + 1, M, tmpK); latDir(tmpK[0], tmpK[1], tmpK[2], M, n.c);
      let ang = 0;
      for (let q = 0; q < 4; q++) {
        latK(f, i * 2 + (q & 1) * 2, j * 2 + (q >> 1) * 2, M, tmpK); latDir(tmpK[0], tmpK[1], tmpK[2], M, tmp3);
        const dt = clamp(tmp3[0] * n.c[0] + tmp3[1] * n.c[1] + tmp3[2] * n.c[2], -1, 1);
        ang = max(ang, Math.acos(dt));
      }
      n.ang = ang; n.size = ang * 2 / Math.SQRT2 * R;   // ≈ сторона узла по дуге
      // высота в центре (одна выборка): по ней — расстояние до камеры (выбор уровня); для отсечения — весь запас (hmax)
      n.hc = max(P.renderMin, H(n.c[0], n.c[1], n.c[2]));
      const rm = R + n.hc;
      n.cp[0] = n.c[0] * rm; n.cp[1] = n.c[1] * rm; n.cp[2] = n.c[2] * rm;
      if (L) n.par = node(f, L - 1, i >> 1, j >> 1);
      nodes.set(k, n);
      P.onNode?.(n);
      return n;
    }
    P.node = node;
    P.nodes = nodes;
    // узнали высоты куска — точнее отсечение за горизонтом
    P.nodeRange = (n, hmin, hmax) => { n.hmin = hmin; n.hmax = hmax; n.built = true; };
    const kidsOf = n => n.kids || (n.kids = [node(n.f, n.L + 1, n.i * 2, n.j * 2), node(n.f, n.L + 1, n.i * 2 + 1, n.j * 2), node(n.f, n.L + 1, n.i * 2, n.j * 2 + 1), node(n.f, n.L + 1, n.i * 2 + 1, n.j * 2 + 1)]);
    P.children = n => kidsOf(n);
    P.parentOf = n => n.par;
    // сосед узла того же уровня через край e (0 −s, 1 +s, 2 −t, 3 +t) — в том числе на другой грани (запоминается)
    function neighbor(n, e){
      if (n.nb && n.nb[e]) return n.nb[e];
      const S = P2[n.L];
      let i = n.i, j = n.j, r;
      if (e === 0) i--; else if (e === 1) i++; else if (e === 2) j--; else j++;
      if (i >= 0 && j >= 0 && i < S && j < S) r = node(n.f, n.L, i, j);
      else {   // за ребром куба: середина края, полклетки наружу → на куб → другая грань
        const hc = 1 / S, s0 = -1 + 2 * (n.i + .5) / S, t0 = -1 + 2 * (n.j + .5) / S;
        const s = e === 0 ? -1 - hc : e === 1 ? 1 + hc : s0, t = e === 2 ? -1 - hc : e === 3 ? 1 + hc : t0;
        const F = FACES[n.f], nn = F[0], u = F[1], v = F[2];
        const cx = nn[0] + u[0] * s + v[0] * t, cy = nn[1] + u[1] * s + v[1] * t, cz = nn[2] + u[2] * s + v[2] * t, m = max(abs(cx), abs(cy), abs(cz));
        cubeFace(cx / m, cy / m, cz / m, tmpF);
        r = node(tmpF[0], n.L, clamp(floor((tmpF[1] + 1) / 2 * S), 0, S - 1), clamp(floor((tmpF[2] + 1) / 2 * S), 0, S - 1));
      }
      (n.nb || (n.nb = [null, null, null, null]))[e] = r;
      return r;
    }
    P.neighbor = neighbor;

    // ── Отсечение за горизонтом: шапка узла (центр, угол) и высоты; камера — точка (x, y, z) в системе планеты ──
    P.horizonVisible = (n, cx, cy, cz) => {
      const Dc = sqrt(cx * cx + cy * cy + cz * cz), rocc = R + P.renderMin, rmax = R + n.hmax;
      if (Dc <= rocc) return true;   // камера под водой (ниже шара моря) — горизонта нет
      const cosA = clamp((cx * n.c[0] + cy * n.c[1] + cz * n.c[2]) / Dc, -1, 1), a = Math.acos(cosA);
      const vis = Math.acos(clamp(rocc / Dc, -1, 1)) + Math.acos(clamp(rocc / rmax, -1, 1));
      return a - n.ang <= vis;
    };

    // ── Выбор кусков: делим, пока узел крупный и близко (расстояние — до края узла; разделённый держится до × hyst) ──
    // o: { K, hyst, maxL, cull (горизонт) }; out — список листьев (узлы); возвращает out
    // LOD v2 (T-075, o.sse = { proj, tau, near, pred: [x, y, z] | null, pre: [] | null, preK }): делим, пока ЭКРАННАЯ ошибка
    // ρ = eK · proj / d (пикселей) больше tau. eK — насколько 4 ребёнка точнее узла (ед.): измерена, когда все 4 построены (n.eK), до
    // того — оценка β · err узла; потолок eK ≤ eK родителя / γ (каждый уровень вдвое точнее: тогда при делении и слиянии узел сам
    // уже не «перетекает» к своему родителю — смена уровня без скачка), пол — «рядом с игроком» (near: самый мелкий уровень
    // в пределах near ед., как было раньше — физика = нарисованное). Море и равнины — крупными кусками, горы — мелкими.
    // pre — сюда узлы, чьих детей пора строить заранее: ρ > preK · tau сейчас или > tau в точке pred (куда летит камера)
    const LODK = P.LOD = { BETA: .5, GAMMA: 1.96, EK0: .42 * (760 + D.relief.amp + D.relief.hills) };
    let selMark = 0;
    const SEL = { cx: 0, cy: 0, cz: 0, K: 2, hyst: 1.15, maxL: 12, cull: true, out: null, sse: null, proj: 1, tau: 3, nearE: 0, pre: null, preK: .6, px: 0, py: 0, pz: 0, pred: false };
    // экранная ошибка узла с ошибкой eK на расстоянии d (пол «рядом с игроком» — в eK: nearE · 2^(maxL − 1 − L))
    const rhoOf = (eK, d) => eK * SEL.proj / (d > 1e-3 ? d : 1e-3);
    // ошибка «4 ребёнка вместо узла» с потолком (≤ eK родителя / γ) и полом «рядом с игроком» — одна для выбора, «куда летим» и 2 : 1
    function ekOf(n, eKp){
      const es = n.err >= 0 ? n.err : n.L ? eKp : LODK.EK0 / LODK.BETA;
      let eK = min(n.eK >= 0 ? n.eK : LODK.BETA * es, eKp / LODK.GAMMA);
      if (SEL.nearE > 0 && n.L < SEL.maxL) eK = max(eK, SEL.nearE * P2[SEL.maxL - 1 - n.L]);
      return eK;
    }
    function walk(n, eKp){
      n.used = selMark;
      if (SEL.cull && !P.horizonVisible(n, SEL.cx, SEL.cy, SEL.cz)) { n.split = false; return; }
      const dx = SEL.cx - n.cp[0], dy = SEL.cy - n.cp[1], dz = SEL.cz - n.cp[2];
      const d = max(0, sqrt(dx * dx + dy * dy + dz * dz) - n.ang * R);
      let want;
      if (SEL.sse) {
        // своя ошибка (не построен — оценка родителя), «4 ребёнка вместо меня» — измеренная или β · своя; потолок и пол
        const eK = n.eKs = ekOf(n, eKp);
        const rho = n.rho = rhoOf(eK, d);
        want = n.L < SEL.maxL && rho > SEL.tau * (n.split ? 1 / SEL.hyst : 1);
        n.split = want;
        if (want) { const k = kidsOf(n); walk(k[0], eK); walk(k[1], eK); walk(k[2], eK); walk(k[3], eK); return; }
        if (SEL.pre && n.L < SEL.maxL) {
          let hot = rho > SEL.tau * SEL.preK;
          if (!hot && SEL.pred) { const ex = SEL.px - n.cp[0], ey = SEL.py - n.cp[1], ez = SEL.pz - n.cp[2]; hot = rhoOf(eK, max(0, sqrt(ex * ex + ey * ey + ez * ez) - n.ang * R)) > SEL.tau; }
          if (hot) SEL.pre.push(n);
        }
      } else {
        want = n.L < SEL.maxL && d < SEL.K * n.size * (n.split ? SEL.hyst : 1);
        n.split = want;
        if (want) { const k = kidsOf(n); walk(k[0]); walk(k[1]); walk(k[2]); walk(k[3]); return; }
      }
      n.leaf = selMark; SEL.out.push(n);
    }
    P.select = (cx, cy, cz, o = {}, out = []) => {
      SEL.cx = cx; SEL.cy = cy; SEL.cz = cz; SEL.K = o.K || 2; SEL.hyst = o.hyst || 1.15; SEL.maxL = clamp(o.maxL ?? 12, 0, MAXL); SEL.cull = o.cull !== false;
      const S = SEL.sse = o.sse || null;
      if (S) {
        SEL.proj = S.proj || 1000; SEL.tau = S.tau || 3; SEL.preK = S.preK ?? .6; SEL.pre = S.pre || null; if (SEL.pre) SEL.pre.length = 0;
        SEL.nearE = S.near > 0 ? SEL.tau * S.near / SEL.proj : 0;   // на расстоянии near ρ мелкого уровня = tau
        SEL.pred = !!S.pred; if (S.pred) { SEL.px = S.pred[0]; SEL.py = S.pred[1]; SEL.pz = S.pred[2]; }
      }
      out.length = 0; selMark++; SEL.out = out;
      for (let f = 0; f < 6; f++) walk(node(f, 0, 0, 0), Infinity);
      SEL.out = null; SEL.pre = null;
      if (selMark % 64 === 0) prune(o.keep || 240);
      return out;
    };
    P.selMark = () => selMark;
    // «Куда летим» (T-075): тот же выбор из точки (px, py, pz), но без следов в узлах (выбор показа не трогает) — листья, которые
    // оттуда нужны, а отсюда ещё за горизонтом (поднимаемся, летим вбок): их строим заранее, и поднявшаяся из-за горизонта земля
    // сразу своего уровня (не крупный предок рядом с мелкими соседями). out — до cap узлов, важнее — крупнее на экране
    const PK = { cx: 0, cy: 0, cz: 0, out: null, cap: 16, n: 0 };
    function peekWalk(n, eKp){
      const eK = ekOf(n, eKp);
      if (!P.horizonVisible(n, PK.px, PK.py, PK.pz)) return;
      const dx = PK.px - n.cp[0], dy = PK.py - n.cp[1], dz = PK.pz - n.cp[2], d = max(0, sqrt(dx * dx + dy * dy + dz * dz) - n.ang * R), rho = rhoOf(eK, d);
      if (n.L < SEL.maxL && rho > SEL.tau) { const k = kidsOf(n); for (let q = 0; q < 4; q++) peekWalk(k[q], eK); return; }
      if (!P.horizonVisible(n, PK.cx, PK.cy, PK.cz)) { n.imp = rho; PK.out.push(n); }
    }
    P.peek = (cx, cy, cz, px, py, pz, o = {}, out = []) => {
      out.length = 0;
      if (!SEL.sse) return out;
      PK.cx = cx; PK.cy = cy; PK.cz = cz; PK.px = px; PK.py = py; PK.pz = pz; PK.out = out;
      for (let f = 0; f < 6; f++) peekWalk(node(f, 0, 0, 0), Infinity);
      PK.out = null;
      if (out.length > 1) out.sort((a, b) => b.imp - a.imp);
      if (out.length > (o.cap || 16)) out.length = o.cap || 16;
      return out;
    };
    // кусок узла построен: err — насколько он точнее родителя (ед.); все 4 брата построены — у родителя измеренная eK
    P.nodeErr = (n, err) => {
      n.err = err;
      const p = n.par; if (!p || !(err >= 0)) return;
      const k = kidsOf(p);
      let m = 0;
      for (let q = 0; q < 4; q++) { const e = k[q].err; if (!(e >= 0)) return; if (e > m) m = e; }
      p.eK = m;
    };

    // ── Показ по шагам (T-075): что рисовать — по выбранным листьям, но не больше уровня за шаг и без скачков формы ──
    // Делить показанный узел можно, когда он «осел» (сам уже не перетекает: k ≤ gate), все 4 ребёнка готовы и ни один показанный
    // сосед не крупнее его (показанное — всегда 2 : 1, маски сшивки работают); дети появляются с k = 1 — ровно в форме родителя —
    // и за fade с перетекают к своей. Сливать — когда все 4 брата показаны (они уже в форме родителя: ρ < tau) и у родителя нет
    // соседей мельче его детей. Где показанного нет (поднялось из-за горизонта, начало) — ближайший готовый. ready(n) — кусок есть.
    // out — показанные узлы; у каждого: n.rel[e] (0 — соседа нет, 1 — такой же уровень (n.nbs[e]), 2 — крупнее (сшить), 3 — мельче),
    // n.mask — маска сшивки, n.tShow — когда появился. Возвращает { split, merge, stand, need } — need: узлы, которые нужно построить
    // для следующего шага (дети делимых, родители сливаемых), по важности (n.imp)
    let dMark = 1, pMark = 1, bMark = 1, b2Mark = 1, mMark = 1, DISP = [];
    const NEED = [], AHEAD = [], SPL = [], MRG = [], WANT = [];
    P.lodShow = (ready, now, o = {}, out = []) => {
      // gate — «осел» (k ≤ gate), gatePx — и скачок k · своя точность ≤ gatePx пикселей (близко к камере — ждём до k = 0)
      const gate = o.gate ?? .05, gpx = o.gatePx ?? .15, prev = DISP, nm = ++dMark, pm = ++pMark, mm = ++mMark, sm = selMark;
      bMark++;
      for (const d of prev) { d.pm = pm; for (let a = d.par; a && a.below !== bMark; a = a.par) a.below = bMark; }
      out.length = 0; NEED.length = 0; AHEAD.length = 0; SPL.length = 0; MRG.length = 0; WANT.length = 0;
      const st = { split: 0, merge: 0, stand: 0, need: NEED, ahead: AHEAD, kept: 0, wait: 0, splits: SPL, merges: MRG, mark: nm };
      const add = (n, fresh) => { if (n.dis === nm) return; n.dis = nm; n.tShow = fresh ? now : 0; n.kc = 1; n.kcT = 0; out.push(n); };
      const keep = n => { if (n.dis === nm) return; n.dis = nm; out.push(n); st.kept++; };
      const need = (n, imp) => { if (!ready(n) && n.needM !== nm) { n.needM = nm; n.imp = imp; NEED.push(n); } };
      // на уровень вперёд: дети детей, которым выбор велит делиться дальше (спуск — строим заранее, без очереди из глубоких листьев)
      const ahead = (kids, imp) => { for (let q = 0; q < 4; q++) { const c = kids[q]; if (c.split && c.used === sm) { const g = kidsOf(c); for (let r = 0; r < 4; r++) if (!ready(g[r]) && g[r].needM !== nm) { g[r].needM = nm; g[r].imp = imp; AHEAD.push(g[r]); } } } };
      const shown = n => n.pm === pm;   // показан в прошлый шаг
      // скачок формы узла в пикселях, если сейчас заменить его (k — его перетекание): k · err · proj / d (lodMorph: n.px)
      const settled = n => { let k = n.k; if (n.ke) for (let e = 0; e < 4; e++) if (n.ke[e] > k) k = n.ke[e]; return !(k > gate) && !(k * n.px > gpx); };
      const up = n => { let k = n.k; if (n.ke) for (let e = 0; e < 4; e++) if (n.ke[e] < k) k = n.ke[e]; return !(k < 1 - gate) && !((1 - k) * n.px > gpx); };
      // 1) показанные: цель — оставить; за горизонтом — прочь; мельче нужно — в список «делить»; слишком мелко — слить, если можно
      for (const d of prev) {
        if (d.dis === nm) continue;
        if (d.used === sm) {
          if (d.leaf === sm) { keep(d); continue; }   // цель — так и есть
          if (d.split) WANT.push(d);   // мельче нужно (решим после слияний)
          continue;   // иначе — за горизонтом: прочь
        }
        // не выбран: под целью (слишком мелко) — шаг вверх, когда все 4 брата показаны и уже в форме родителя
        let a = d.par; while (a && a.used !== sm) a = a.par;
        if (!a || a.leaf !== sm) continue;
        const p = d.par, k = kidsOf(p);
        if (p.dis === nm) continue;
        // брат не показан и под ним ничего не показано (за горизонтом, место пустое) — слиянию не мешает (родитель его и закроет)
        const sib = c => shown(c) ? up(c) : c.below !== bMark;
        const all = (shown(k[0]) || sib(k[0])) && (shown(k[1]) || sib(k[1])) && (shown(k[2]) || sib(k[2])) && (shown(k[3]) || sib(k[3]));
        const ok4 = all && sib(k[0]) && sib(k[1]) && sib(k[2]) && sib(k[3]);
        // у родителя нет соседа, показанного мельче его детей (иначе разница в 2 уровня)
        let fine = false;
        if (ok4) for (let e = 0; e < 4 && !fine; e++) { const nb = neighbor(p, e); if (nb.below === bMark && nb.kids) for (let q = 0; q < 4; q++) if (nb.kids[q].below === bMark) { fine = true; break; } }
        if (ok4 && !fine && ready(p)) { add(p, false); p.kc = 0; p.kcT = now; p.mrg = mm; st.merge++; MRG.push(p); }
        else { if (all && !ready(p)) need(p, 1e9); keep(d); st.wait++; }
      }
      // 2) цели без показанного (поднялись из-за горизонта, начало): ближайший готовый на цепочке вверх. До делений: деления
      //    видят и их (сосед крупнее — подождать), «делимые» (WANT) покрывают свои места так же, как показанные
      b2Mark++;
      for (const d of out) for (let a = d.par; a && a.below2 !== b2Mark; a = a.par) a.below2 = b2Mark;
      for (const d of WANT) { d.wantM = nm; for (let a = d.par; a && a.below2 !== b2Mark; a = a.par) a.below2 = b2Mark; }
      const leaves = o.leaves || [];
      for (const t of leaves) {
        if (t.dis === nm || t.wantM === nm || t.below2 === b2Mark) continue;
        let a = t.par; while (a && a.dis !== nm && a.wantM !== nm) a = a.par;
        if (a) continue;
        // самый мелкий готовый без показанных потомков (иначе он закрыл бы уже показанное — скачок); готовых нет — строить первым
        // самый крупный такой (место пустое ~кадр-другой: оно только что поднялось из-за горизонта)
        let best = null, top = null;
        for (let x = t; x && x.below2 !== b2Mark; x = x.par) { top = x; if (!best && ready(x)) best = x; }
        if (best) { add(best, best.L > 0); best.mrg = mm; best.standT = now; st.stand++; for (let b = best.par; b && b.below2 !== b2Mark; b = b.par) b.below2 = b2Mark; }
        else if (top) need(top, 1e12);
      }
      // 3) делить (после слияний и «ближайших готовых»): «осел», 4 ребёнка готовы, и ни один сосед не крупнее — ни показанный, ни
      //    только что слитый или поставленный
      const coarserNb = n => { for (let e = 0; e < 4; e++) { for (let a = neighbor(n, e).par; a; a = a.par) if (shown(a) || a.mrg === mm) return true; } return false; };
      for (const d of WANT) {
        if (d.dis === nm) continue;
        const k = kidsOf(d);
        const rk = ready(k[0]) && ready(k[1]) && ready(k[2]) && ready(k[3]);
        if (!rk) for (let q = 0; q < 4; q++) need(k[q], d.rho);
        else ahead(k, d.rho);
        if (rk && settled(d) && !coarserNb(d)) { for (let q = 0; q < 4; q++) { add(k[q], true); k[q].standT = d.standT; } st.split++; SPL.push(d); }
        else { keep(d); st.wait++; }
      }
      // показанный предок закрывает показанных потомков (без наложений)
      let w = 0;
      for (const n of out) { let a = n.par, hid = false; while (a) { if (a.dis === nm) { hid = true; break; } a = a.par; } if (!hid) out[w++] = n; else n.dis = 0; }
      out.length = w;
      // показанные и их предки — «нужны» (чистка узлов их не тронет)
      for (const n of out) for (let a = n; a && a.used !== sm; a = a.par) a.used = sm;
      // соседи и маски — по показанному
      bMark++;
      for (const d of out) for (let a = d.par; a && a.below !== bMark; a = a.par) a.below = bMark;
      for (const n of out) {
        const rel = n.rel || (n.rel = new Int8Array(4)), nbs = n.nbs || (n.nbs = [null, null, null, null]);
        let m = 0;
        for (let e = 0; e < 4; e++) {
          const nb = neighbor(n, e); nbs[e] = null;
          if (nb.dis === nm) { rel[e] = 1; nbs[e] = nb; continue; }
          if (nb.below === bMark) { rel[e] = 3; continue; }
          let a = nb.par; while (a && a.dis !== nm) a = a.par;
          if (a) { rel[e] = 2; if (a.L === n.L - 1) m |= 1 << e; } else rel[e] = 0;
        }
        n.mask = m;
      }
      DISP = out.slice();
      if (NEED.length > 1) NEED.sort((x, y) => y.imp - x.imp);
      if (AHEAD.length > 1) AHEAD.sort((x, y) => y.imp - x.imp);
      return st;
    };
    P.lodShown = () => DISP;
    P.lodReset = () => { for (const d of DISP) d.dis = 0; DISP = []; };
    // ── Перетекание на этот кадр: k узла = max(к родителю по ρ родителя, «появился» за fade с); k краёв — общие с соседями ──
    // o: { proj, tau, full (ρ, при котором k = 0; 1,7 · tau), fade (с) }; камера — точка в системе планеты
    P.lodMorph = (list, cx, cy, cz, now, o = {}) => {
      const tau = o.tau || 3, full = o.full || tau * 1.7, fade = (o.fade || .12) * 1000, pj = o.proj || 1000, span = 1 / (full - tau);
      for (let q = 0; q < list.length; q++) {
        const n = list[q];
        let kn = 0;
        const p = n.par;
        // свой скачок в пикселях, если заменить узел сейчас (для «осел» в lodShow): k · err · proj / d
        { const ex = cx - n.cp[0], ey = cy - n.cp[1], ez = cz - n.cp[2], dn = max(1e-3, sqrt(ex * ex + ey * ey + ez * ez) - n.ang * R); n.px = n.err > 0 ? n.err * pj / dn : 0; }
        if (p && p.eKs > 0) {
          const dx = cx - p.cp[0], dy = cy - p.cp[1], dz = cz - p.cp[2], d = max(1e-3, sqrt(dx * dx + dy * dy + dz * dz) - p.ang * R);
          kn = clamp((full - p.eKs * pj / d) * span, 0, 1);
        }
        // нужно мельче (выбор делит — в том числе ради 2 : 1): перетекание к родителю сходит на нет за fade — потом деление без
        // скачка; не нужно — потолок возвращается так же плавно
        const want = n.split && n.used === selMark, dc = n.kcT ? (now - n.kcT) / fade : 1;
        n.kcT = now;
        n.kc = want ? max(0, n.kc - dc) : min(1, n.kc + dc);
        if (kn > n.kc) kn = n.kc;
        const kt = n.kt = n.tShow ? clamp(1 - (now - n.tShow) / fade, 0, 1) : 0;
        n.k = kn > kt ? kn : kt;
      }
      for (let q = 0; q < list.length; q++) {
        const n = list[q], ke = n.ke || (n.ke = new Float32Array(4)), rel = n.rel;
        for (let e = 0; e < 4; e++) {
          const r = rel ? rel[e] : 0;
          // общий край: больший k, но не больше потолков обоих (кто собрался делиться — сначала распрямляет и края)
          // и не меньше «появления» обоих: только что показанный — ровно в форме родителя, и края тоже
          if (r === 1) { const m = n.nbs[e]; ke[e] = max(min(max(n.k, m.k), n.kc, m.kc), n.kt, m.kt); }
          // мельче сосед (3): своя точная форма края, но только что показанный — сначала в форме родителя (бывает, только если
          // родитель стоял рядом с 2 уровнями мельче: «поднялось из-за горизонта»)
          else ke[e] = r === 2 ? 1 : r === 3 ? n.kt : n.k;
        }
      }
    };
    // старые узлы (давно не нужны) — прочь вместе с потомками; ссылки на соседей — заново (чтобы не держать удалённых)
    function drop(n){ if (n.kids) { for (const k of n.kids) drop(k); n.kids = null; } nodes.delete(n.key); }
    function prune(keep){
      if (nodes.size < 4000) return;
      const old = selMark - keep;
      const visit = n => { if (!n.kids) return; if (n.used < old && !n.kids.some(k => k.built && k.used >= old)) { for (const k of n.kids) drop(k); n.kids = null; return; } for (const k of n.kids) visit(k); };
      for (let f = 0; f < 6; f++) visit(node(f, 0, 0, 0));
      for (const n of nodes.values()) n.nb = null;
    }
    P.prune = keep => prune(keep);
    // какой лист накрывает узел n (он сам, предок) — или null, если n разделён (там мельче) или не выбран (за горизонтом)
    const coverLeaf = n => { for (let m = n; m; m = m.par) if (m.leaf === selMark) return m; return null; };
    P.coverLeaf = coverLeaf;
    // 2 : 1 — соседи отличаются не больше чем на уровень (крупного соседа делим); leaves — меняется
    P.balance = (leaves) => {
      let guard = 0, changed = true;
      while (changed && guard++ < 24) {
        changed = false;
        for (let q = 0; q < leaves.length; q++) {
          const n = leaves[q]; if (n.leaf !== selMark || n.L < 2) continue;
          for (let e = 0; e < 4; e++) {
            const cov = coverLeaf(neighbor(n, e));
            if (cov && cov.L < n.L - 1) {   // сосед крупнее на 2+ уровня — делим его
              cov.leaf = 0; cov.split = true;
              for (const c of kidsOf(cov)) {
                c.leaf = selMark; c.split = false; c.used = selMark; leaves.push(c);
                if (SEL.sse) {   // выбор по экранной ошибке: и у этих — ошибка и ρ (как в обходе)
                  c.eKs = ekOf(c, cov.eKs);
                  const dx = SEL.cx - c.cp[0], dy = SEL.cy - c.cp[1], dz = SEL.cz - c.cp[2];
                  c.rho = rhoOf(c.eKs, max(0, sqrt(dx * dx + dy * dy + dz * dz) - c.ang * R));
                }
              }
              changed = true;
            }
          }
        }
        if (changed) { let w = 0; for (let q = 0; q < leaves.length; q++) if (leaves[q].leaf === selMark) leaves[w++] = leaves[q]; leaves.length = w; }
      }
      return leaves;
    };
    // маска сшивки: бит e — сосед через край e крупнее на уровень
    P.stitchMask = n => {
      let m = 0;
      for (let e = 0; e < 4; e++) { const cov = coverLeaf(neighbor(n, e)); if (cov && cov.L === n.L - 1) m |= 1 << e; }
      return m;
    };

    // ── Сетка куска: (N+1)² вершин + юбки; позиции — float32 от центра куска (центр — double); нормали int8; цвет+вода uint8 ──
    // «Перетекание» LOD (T-075, CDLOD): у куска уровня L ≥ 1 — форма РОДИТЕЛЯ в тех же вершинах: md (int16 × 4: сдвиг к
    // поверхности родителя / mscale — int8 давал скачок 0,4 % сдвига на поздних делениях; номер столбца a), np (int8 × 4: нормаль
    // родителя, номер строки b) и colp (цвет родителя). Чётные вершины
    // (a, b чётные) — вершины родителя: сдвига нет, нормаль и цвет — ровно как у него (та же решётка, те же числа); нечётные — на
    // середине ребра или диагонали b–c клетки родителя (так он нарисован). err — наибольший сдвиг (насколько кусок точнее
    // родителя, ед.): экранная ошибка выбора кусков. Сжатый до k = 1 кусок совпадает с родителем — смена уровня без скачка.
    const DIRS = [[1, 0], [0, 1], [-1, 1]];   // пара соседей нечётной вершины: по a (a нечётный), по b, по диагонали b–c
    // o.lite — без формы родителя и его точности (вид без LOD v2, как до T-075): кольцо 1, md / np / colp — null, err −1;
    // позиции, нормали, цвет — те же до бита (planet-test)
    P.buildChunk = (f, L, i, j, N = 32, o) => {
      const lite = !!(o && o.lite), n1 = N + 1, RG = lite ? 1 : 2, g = N + 1 + 2 * RG, M = N * P2[L];   // кольцо 2: нормали родителя (шаг 2) у края
      const HG = new Float64Array(g * g), DX = new Float64Array(g * g * 3), PX = new Float64Array(g * g * 3);
      const K3 = [0, 0, 0], d = [0, 0, 0];
      const gi0 = i * N, gj0 = j * N;
      // высоты: сетка с кольцом вокруг (для нормалей); внутри грани — точки решётки, за краем грани — продолжение параметров
      for (let b = 0; b < g; b++) for (let a = 0; a < g; a++) {
        const gi = gi0 + a - RG, gj = gj0 + b - RG, q = b * g + a;
        if (gi >= 0 && gj >= 0 && gi <= M && gj <= M) { latK(f, gi, gj, M, K3); latDir(K3[0], K3[1], K3[2], M, d); }
        else dirOf(f, 2 * gi / M - 1, 2 * gj / M - 1, d);
        const h = H(d[0], d[1], d[2]);
        HG[q] = h;
        DX[q * 3] = d[0]; DX[q * 3 + 1] = d[1]; DX[q * 3 + 2] = d[2];
        const hr = R + (h < P.renderMin ? P.renderMin : h);   // вода — на уровне моря
        PX[q * 3] = d[0] * hr; PX[q * 3 + 1] = d[1] * hr; PX[q * 3 + 2] = d[2] * hr;
      }
      // центр куска — центральная вершина (на нарисованной высоте)
      const cq = (N / 2 + RG) * g + (N / 2 + RG), C = new Float64Array([PX[cq * 3], PX[cq * 3 + 1], PX[cq * 3 + 2]]);
      const V = n1 * n1 + 4 * n1, pos = new Float32Array(V * 3), nrm = new Int8Array(V * 3), col = new Uint8Array(V * 4);
      const md = lite ? null : new Int16Array(V * 4), np = lite ? null : new Int8Array(V * 4), colp = lite ? null : new Uint8Array(V * 4);
      const NP = lite ? null : new Float64Array(n1 * n1 * 3), DP = lite ? null : new Float64Array(n1 * n1 * 3);
      let hmin = Infinity, hmax = -Infinity, rad = 0;
      const cc = [0, 0, 0];
      const skirt = 2 + .06 * (PI / 2) * R / P2[L];   // ≈ 6 % стороны куска
      // нормаль по решётке с шагом s (1 — своя, 2 — родителя): центральные разности (кольцо — общее с соседями); вода — «вверх»
      const NRM = [0, 0, 0];
      const normal = (q, s, water, dx, dy, dz) => {
        if (water) { NRM[0] = dx; NRM[1] = dy; NRM[2] = dz; return NRM; }
        const qa = q - s, qb = q + s, qc = q - s * g, qd = q + s * g;
        const ux = PX[qb * 3] - PX[qa * 3], uy = PX[qb * 3 + 1] - PX[qa * 3 + 1], uz = PX[qb * 3 + 2] - PX[qa * 3 + 2];
        const vx = PX[qd * 3] - PX[qc * 3], vy = PX[qd * 3 + 1] - PX[qc * 3 + 1], vz = PX[qd * 3 + 2] - PX[qc * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const l = sqrt(nx * nx + ny * ny + nz * nz) || 1; NRM[0] = nx / l; NRM[1] = ny / l; NRM[2] = nz / l;
        return NRM;
      };
      // цвет вершины (суша / вода / лёд) по высоте и «вверх» (крутизна) — в out[o…o+3]
      const colorAt = (h, dx, dy, dz, wet, ice, up, out, o) => {
        if (wet && !ice) {
          landColor(dx, dy, dz, D.sea, 1, cc);   // берег под водой — по климату (лёд у полюсов)
          out[o] = Math.round(cc[0] * 255); out[o + 1] = Math.round(cc[1] * 255); out[o + 2] = Math.round(cc[2] * 255);
          out[o + 3] = clamp(128 + Math.round((D.sea - h) / 6), 129, 255);   // вода: 129…255 (глубина / 6 ед.)
        } else if (ice) {   // замёрзшее море (у полюсов): белое, по нему можно ходить
          const nzz = NZ2.n3(dx * 600, dy * 600, dz * 600) * .04;
          out[o] = Math.round((.86 + nzz) * 255); out[o + 1] = Math.round((.92 + nzz) * 255); out[o + 2] = Math.round((.97 + nzz) * 255); out[o + 3] = 0;
        } else {
          landColor(dx, dy, dz, h, up, cc);
          // суша: 0…127 — высота над морем (у берега плавно: берег — линия «0» между вершинами, без ступенек на крупных кусках)
          out[o] = Math.round(cc[0] * 255); out[o + 1] = Math.round(cc[1] * 255); out[o + 2] = Math.round(cc[2] * 255);
          out[o + 3] = D.sea == null ? 0 : clamp(127 - Math.round((h - D.sea) / 6), 0, 127);
        }
      };
      for (let b = 0; b < n1; b++) for (let a = 0; a < n1; a++) {
        const q = (b + RG) * g + (a + RG), v = b * n1 + a;
        const x = PX[q * 3] - C[0], y = PX[q * 3 + 1] - C[1], z = PX[q * 3 + 2] - C[2];
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const r2 = x * x + y * y + z * z; if (r2 > rad) rad = r2;
        const h = HG[q], dx = DX[q * 3], dy = DX[q * 3 + 1], dz = DX[q * 3 + 2], wet = D.sea != null && h < D.sea, ice = wet && iceAt(dx, dy, dz), water = wet && !ice;
        const hr = h < P.renderMin ? P.renderMin : h; if (hr < hmin) hmin = hr; if (hr > hmax) hmax = hr;
        const n = normal(q, 1, water, dx, dy, dz), nx = n[0], ny = n[1], nz = n[2], up = nx * dx + ny * dy + nz * dz;
        nrm[v * 3] = Math.round(nx * 127); nrm[v * 3 + 1] = Math.round(ny * 127); nrm[v * 3 + 2] = Math.round(nz * 127);
        colorAt(h, dx, dy, dz, wet, ice, up, col, v * 4);
        if (lite) continue;   // без формы родителя
        // родитель в чётной вершине: та же точка решётки, нормаль с его шагом, цвет по ней (биты — как у него); у воды, льда и
        // ровного (оба «вверх» ≥ 0,95: скалы, пляж, снег от крутизны не зависят) цвет тот же — без второго landColor
        if (L && !(a & 1) && !(b & 1)) {
          const p = normal(q, 2, water, dx, dy, dz), upP = p[0] * dx + p[1] * dy + p[2] * dz;
          NP[v * 3] = p[0]; NP[v * 3 + 1] = p[1]; NP[v * 3 + 2] = p[2];
          if (wet || (up >= .95 && upP >= .95)) { colp[v * 4] = col[v * 4]; colp[v * 4 + 1] = col[v * 4 + 1]; colp[v * 4 + 2] = col[v * 4 + 2]; colp[v * 4 + 3] = col[v * 4 + 3]; }
          else colorAt(h, dx, dy, dz, wet, ice, upP, colp, v * 4);
        }
        md[v * 4 + 3] = a; np[v * 4 + 3] = b;
      }
      // нечётные вершины: форма родителя — середина ребра (по a или по b) или диагонали b–c его клетки
      let err = 0, ms = 0;
      if (lite) err = -1;
      else if (L) {
        for (let b = 0; b < n1; b++) for (let a = 0; a < n1; a++) {
          const v = b * n1 + a, oa = a & 1, ob = b & 1;
          if (!oa && !ob) continue;
          const D2 = DIRS[oa && ob ? 2 : oa ? 0 : 1], v0 = (b - D2[1]) * n1 + (a - D2[0]), v1 = (b + D2[1]) * n1 + (a + D2[0]);
          const q = (b + RG) * g + (a + RG), q0 = (b - D2[1] + RG) * g + (a - D2[0] + RG), q1 = (b + D2[1] + RG) * g + (a + D2[0] + RG);
          for (let c = 0; c < 3; c++) {
            const t = (PX[q0 * 3 + c] + PX[q1 * 3 + c]) * .5 - PX[q * 3 + c];
            DP[v * 3 + c] = t; if (abs(t) > ms) ms = abs(t);
          }
          const e = sqrt(DP[v * 3] ** 2 + DP[v * 3 + 1] ** 2 + DP[v * 3 + 2] ** 2); if (e > err) err = e;
          let px = NP[v0 * 3] + NP[v1 * 3], py = NP[v0 * 3 + 1] + NP[v1 * 3 + 1], pz = NP[v0 * 3 + 2] + NP[v1 * 3 + 2];
          const l = sqrt(px * px + py * py + pz * pz) || 1; NP[v * 3] = px / l; NP[v * 3 + 1] = py / l; NP[v * 3 + 2] = pz / l;
          for (let c = 0; c < 4; c++) colp[v * 4 + c] = (colp[v0 * 4 + c] + colp[v1 * 4 + c] + 1) >> 1;
        }
        const ks = ms > 0 ? 32767 / ms : 0;
        for (let v = 0; v < n1 * n1; v++) {
          md[v * 4] = Math.round(DP[v * 3] * ks); md[v * 4 + 1] = Math.round(DP[v * 3 + 1] * ks); md[v * 4 + 2] = Math.round(DP[v * 3 + 2] * ks);
          np[v * 4] = Math.round(NP[v * 3] * 127); np[v * 4 + 1] = Math.round(NP[v * 3 + 1] * 127); np[v * 4 + 2] = Math.round(NP[v * 3 + 2] * 127);
        }
      } else {   // корень: родителя нет — своя форма
        for (let v = 0; v < n1 * n1; v++) {
          np[v * 4] = nrm[v * 3]; np[v * 4 + 1] = nrm[v * 3 + 1]; np[v * 4 + 2] = nrm[v * 3 + 2];
          colp[v * 4] = col[v * 4]; colp[v * 4 + 1] = col[v * 4 + 1]; colp[v * 4 + 2] = col[v * 4 + 2]; colp[v * 4 + 3] = col[v * 4 + 3];
        }
        err = -1;
      }
      // юбки: вершины края, опущенные к центру планеты (перетекают вместе с краем)
      for (let e = 0; e < 4; e++) for (let q = 0; q <= N; q++) {
        const a = e === 0 ? 0 : e === 1 ? N : q, b = e === 2 ? 0 : e === 3 ? N : q;
        const src = b * n1 + a, dst = n1 * n1 + e * n1 + q, gq = (b + RG) * g + (a + RG);
        const dx = DX[gq * 3], dy = DX[gq * 3 + 1], dz = DX[gq * 3 + 2];
        pos[dst * 3] = pos[src * 3] - dx * skirt; pos[dst * 3 + 1] = pos[src * 3 + 1] - dy * skirt; pos[dst * 3 + 2] = pos[src * 3 + 2] - dz * skirt;
        nrm[dst * 3] = nrm[src * 3]; nrm[dst * 3 + 1] = nrm[src * 3 + 1]; nrm[dst * 3 + 2] = nrm[src * 3 + 2];
        for (let c = 0; c < 4; c++) col[dst * 4 + c] = col[src * 4 + c];
        if (!lite) for (let c = 0; c < 4; c++) { colp[dst * 4 + c] = colp[src * 4 + c]; md[dst * 4 + c] = md[src * 4 + c]; np[dst * 4 + c] = np[src * 4 + c]; }
      }
      return { f, L, i, j, N, key: key(f, L, i, j), centre: C, pos, nrm, col, md, np, colp, mscale: ms, err, hmin, hmax, radius: sqrt(rad) + skirt };
    };

    // ── Плоский кусок: якорь на уровне моря, базис [восток, вверх, юг] ──
    // базис в точке (без мусора): out — 9 чисел (восток, вверх, юг подряд)
    P.basis = (dir, out) => {
      const l = sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]), ux = dir[0] / l, uy = dir[1] / l, uz = dir[2] / l;
      // восток = ось × вверх (у полюса — другая ось)
      let rx = 0, ry = 1, rz = 0;
      if (abs(uy) > .999) { rx = 0; ry = 0; rz = 1; }
      let ex = ry * uz - rz * uy, ey = rz * ux - rx * uz, ez = rx * uy - ry * ux;
      const el = sqrt(ex * ex + ey * ey + ez * ez); ex /= el; ey /= el; ez /= el;
      // юг = восток × вверх
      out[0] = ex; out[1] = ey; out[2] = ez; out[3] = ux; out[4] = uy; out[5] = uz;
      out[6] = ey * uz - ez * uy; out[7] = ez * ux - ex * uz; out[8] = ex * uy - ey * ux;
      return out;
    };
    P.patch = (dir, out = {}) => {
      const B = P.basis(dir, new Array(9)), Ra = SEAR;
      out.dir = [B[3], B[4], B[5]]; out.Ra = Ra;
      out.A = [B[3] * Ra, B[4] * Ra, B[5] * Ra];
      out.B = B;   // столбцы: восток, вверх, юг (подряд по 3)
      return out;
    };
    // L → система планеты; система планеты → L (out — массив 3)
    P.toBF = (fr, x, y, z, out) => { const A = fr.A, B = fr.B; out[0] = A[0] + B[0] * x + B[3] * y + B[6] * z; out[1] = A[1] + B[1] * x + B[4] * y + B[7] * z; out[2] = A[2] + B[2] * x + B[5] * y + B[8] * z; return out; };
    P.toL = (fr, X, Y, Z, out) => { const A = fr.A, B = fr.B, dx = X - A[0], dy = Y - A[1], dz = Z - A[2]; out[0] = B[0] * dx + B[1] * dy + B[2] * dz; out[1] = B[3] * dx + B[4] * dy + B[5] * dz; out[2] = B[6] * dx + B[7] * dy + B[8] * dz; return out; };
    P.dirToBF = (fr, x, y, z, out) => { const B = fr.B; out[0] = B[0] * x + B[3] * y + B[6] * z; out[1] = B[1] * x + B[4] * y + B[7] * z; out[2] = B[2] * x + B[5] * y + B[8] * z; return out; };
    P.dirToL = (fr, X, Y, Z, out) => { const B = fr.B; out[0] = B[0] * X + B[1] * Y + B[2] * Z; out[1] = B[3] * X + B[4] * Y + B[5] * Z; out[2] = B[6] * X + B[7] * Y + B[8] * Z; return out; };
    // переезд якоря: p_new = Q p_old + t (Q — 9 чисел по строкам)
    P.rebaseMap = (a, b) => {
      const A = a.B, B = b.B, Q = new Array(9), t = [0, 0, 0];
      // Q = B_newᵀ B_old: строка r — ось r нового, столбец c — ось c старого
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Q[r * 3 + c] = B[r * 3] * A[c * 3] + B[r * 3 + 1] * A[c * 3 + 1] + B[r * 3 + 2] * A[c * 3 + 2];
      const dx = a.A[0] - b.A[0], dy = a.A[1] - b.A[1], dz = a.A[2] - b.A[2];
      for (let r = 0; r < 3; r++) t[r] = B[r * 3] * dx + B[r * 3 + 1] * dy + B[r * 3 + 2] * dz;
      return { Q, t };
    };
    P.mapPoint = (m, x, y, z, out) => { const Q = m.Q, t = m.t; out[0] = Q[0] * x + Q[1] * y + Q[2] * z + t[0]; out[1] = Q[3] * x + Q[4] * y + Q[5] * z + t[1]; out[2] = Q[6] * x + Q[7] * y + Q[8] * z + t[2]; return out; };
    P.mapDir = (m, x, y, z, out) => { const Q = m.Q; out[0] = Q[0] * x + Q[1] * y + Q[2] * z; out[1] = Q[3] * x + Q[4] * y + Q[5] * z; out[2] = Q[6] * x + Q[7] * y + Q[8] * z; return out; };

    // ── Высота для физики: тот же треугольник самого мелкого уровня, что нарисован (кэш высот вершин решётки, без мусора) ──
    const HC = 8192, hcK = new Float64Array(HC).fill(-1), hcV = new Float64Array(HC);
    let hcHit = 0, hcMiss = 0, hcM = 0;
    P.physL = 12;   // уровень, по которому считает физика (= самый мелкий у игрока)
    P.physN = 32;
    function latH(f, gi, gj, M){   // высота точки решётки грани (кэш)
      if (M !== hcM) { hcK.fill(-1); hcM = M; }   // сменили уровень физики — кэш заново
      const k = (f * 1048576 + gi) * 1048576 + gj;   // ключ — целое число (gi, gj < 2^20)
      let s = (Math.imul(gi, 73856093) ^ Math.imul(gj, 19349663) ^ Math.imul(f + 1, 83492791) ^ M) & (HC - 1);
      for (let p = 0; p < 4; p++, s = (s + 1) & (HC - 1)) {
        if (hcK[s] === k) { hcHit++; return hcV[s]; }
        if (hcK[s] === -1) break;
      }
      hcMiss++;
      latK(f, gi, gj, M, tmpK); latDir(tmpK[0], tmpK[1], tmpK[2], M, tmp3);
      const h = H(tmp3[0], tmp3[1], tmp3[2]);
      hcK[s] = k; hcV[s] = h;
      return h;
    }
    P.cacheStats = () => ({ hit: hcHit, miss: hcMiss });
    const PA = [0, 0, 0], PB = [0, 0, 0], PC = [0, 0, 0], LA = [0, 0, 0], LB = [0, 0, 0], LC = [0, 0, 0], FD = [0, 0, 0], TD = [0, 0, 0];
    function vertBF(f, gi, gj, M, out, clampSea){
      latK(f, gi, gj, M, tmpK); latDir(tmpK[0], tmpK[1], tmpK[2], M, out);
      let h = latH(f, gi, gj, M); if (clampSea && h < P.renderMin) h = P.renderMin;
      const r = R + h; out[0] *= r; out[1] *= r; out[2] *= r; return out;
    }
    // y поверхности в L над точкой (x, z); clampSea — как нарисовано (вода — ровно), иначе — дно
    P.patchHeight = (fr, x, z, clampSea = false) => {
      // точка на касательной плоскости → направление → клетка решётки
      const A = fr.A, B = fr.B, X = A[0] + B[0] * x + B[6] * z, Y = A[1] + B[1] * x + B[7] * z, Z = A[2] + B[2] * x + B[8] * z;
      const l = sqrt(X * X + Y * Y + Z * Z);
      faceOf(X / l, Y / l, Z / l, FD);
      const f = FD[0], M = P.physN * P2[P.physL];
      const fs = clamp((FD[1] + 1) / 2 * M, 0, M - 1e-9), ft = clamp((FD[2] + 1) / 2 * M, 0, M - 1e-9);
      const gi = floor(fs), gj = floor(ft), u = fs - gi, v = ft - gj;
      // треугольник клетки: (a, b, c) или (b, d, c) — диагональ b–c, как у сетки
      if (u + v <= 1) { vertBF(f, gi, gj, M, PA, clampSea); vertBF(f, gi + 1, gj, M, PB, clampSea); vertBF(f, gi, gj + 1, M, PC, clampSea); }
      else { vertBF(f, gi + 1, gj, M, PA, clampSea); vertBF(f, gi + 1, gj + 1, M, PB, clampSea); vertBF(f, gi, gj + 1, M, PC, clampSea); }
      P.toL(fr, PA[0], PA[1], PA[2], LA); P.toL(fr, PB[0], PB[1], PB[2], LB); P.toL(fr, PC[0], PC[1], PC[2], LC);
      // плоскость треугольника: вертикаль (x, z) → y
      const e1x = LB[0] - LA[0], e1y = LB[1] - LA[1], e1z = LB[2] - LA[2], e2x = LC[0] - LA[0], e2y = LC[1] - LA[1], e2z = LC[2] - LA[2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      if (abs(ny) < 1e-12) return (LA[1] + LB[1] + LC[1]) / 3;
      return LA[1] - (nx * (x - LA[0]) + nz * (z - LA[2])) / ny;
    };
    // уровень моря в L над (x, z) — сфера радиуса SEAR (дальше от якоря — ниже: кривизна)
    P.patchSea = (fr, x, z) => { const q = fr.Ra * fr.Ra - x * x - z * z; return q > 0 ? sqrt(q) - fr.Ra : -Infinity; };
    P.patchWater = (fr, x, z) => {
      if (D.sea == null) return -Infinity;
      const ws = P.patchSea(fr, x, z);
      if (P.patchHeight(fr, x, z, false) >= ws) return -Infinity;
      return P.patchIce(fr, x, z) ? -Infinity : ws;
    };
    // замёрзшее ли море над (x, z) — тогда опора на уровне моря
    P.patchIce = (fr, x, z) => {
      const A = fr.A, B = fr.B, X = A[0] + B[0] * x + B[6] * z, Y = A[1] + B[1] * x + B[7] * z, Z = A[2] + B[2] * x + B[8] * z, l = sqrt(X * X + Y * Y + Z * Z);
      return iceAt(X / l, Y / l, Z / l);
    };
    // земля для физики: дно, а у замёрзшего моря — лёд (уровень моря)
    P.patchGround = (fr, x, z) => {
      const h = P.patchHeight(fr, x, z, false);
      if (D.sea == null) return h;
      const ws = P.patchSea(fr, x, z);
      return h < ws && P.patchIce(fr, x, z) ? ws : h;
    };
    // настоящий «верх» (от центра планеты) в L для точки L — для проверок и наклона машин
    P.upL = (fr, x, y, z, out) => { P.toBF(fr, x, y, z, TD); const l = sqrt(TD[0] * TD[0] + TD[1] * TD[1] + TD[2] * TD[2]); return P.dirToL(fr, TD[0] / l, TD[1] / l, TD[2] / l, out); };

    // ── Области (якоря для сети и физики): узел уровня LR, якорь — его центр ──
    P.regionLevel = Math.max(0, Math.min(MAXL, Math.round(Math.log2((PI / 2) * R / 768))));   // ≈ 768 ед. на область
    P.region = (d, LR = P.regionLevel, out = {}) => {
      faceOf(d[0], d[1], d[2], FD);
      const S = P2[LR], i = clamp(floor((FD[1] + 1) / 2 * S), 0, S - 1), j = clamp(floor((FD[2] + 1) / 2 * S), 0, S - 1);
      const n = node(FD[0], LR, i, j);
      out.key = n.key; out.node = n; out.dir = n.c;
      return out;
    };

    // ── Широта, долгота ──
    P.latLon = (d, out = [0, 0]) => { out[0] = Math.asin(clamp(d[1], -1, 1)) / DEG; out[1] = Math.atan2(-d[2], d[0]) / DEG; return out; };
    P.dirFromLatLon = (lat, lon, out = [0, 0, 0]) => { const a = lat * DEG, b = lon * DEG, c = Math.cos(a); out[0] = c * Math.cos(b); out[1] = Math.sin(a); out[2] = -c * Math.sin(b); return out; };

    // ── Солнце, сутки, времена года ──
    // фаза года φ (0 весна, 1 лето, 2 осень, 3 зима): родная — по календарю владельца (climate.js), другие — по своему году
    P.season = ms => seasonOf(D, ms);
    // склонение солнца: точное для наклонённой оси (как температура в climate.js: пик — середина лета, минимум — середина зимы)
    P.declination = ms => declinationOf(D, ms);
    // долгота «под солнцем» в момент t (секунды мира): планета вращается на восток — точка под солнцем уходит на запад
    P.subSolarLon = t => subSolarLonOf(D, t);
    P.sunDir = (t, ms, out = [0, 0, 0]) => {
      const dl = P.declination(ms), lon = P.subSolarLon(t), c = Math.cos(dl);
      out[0] = c * Math.cos(lon); out[1] = Math.sin(dl); out[2] = -c * Math.sin(lon);
      return out;
    };
    // местное солнечное время (0…24) в направлении d
    P.localHour = (d, t) => {
      const lon = Math.atan2(-d[2], d[0]), dl = lon - P.subSolarLon(t);
      return (((12 + dl * 12 / PI) % 24) + 24) % 24;
    };
    // луна-«украшение» i (v1, rails 'visual'): точка в системе планеты (круговая орбита, наклон к экватору; планета под ней
    // вращается). Луны-тела (id в D.moons) — на орбитах Кеплера в D37E.system, их рисует js/engine/space-view.js
    P.moonPos = (i, t, out = [0, 0, 0]) => {
      const m = D.moons[i]; if (!m || typeof m !== 'object') { out[0] = out[1] = out[2] = 0; return out; }
      const a = m.phase + 2 * PI * t / m.period, inc = m.incl * DEG;
      // в «неподвижной» системе: орбита в плоскости экватора, наклонённой на inc
      const xi = Math.cos(a) * m.dist, zi = -Math.sin(a) * m.dist, yi = -zi * Math.sin(inc), zr = zi * Math.cos(inc);
      // в систему планеты: поворот на −θ(t) вокруг оси (θ — угол вращения)
      const th = 2 * PI * t / D.day, c = Math.cos(th), s = Math.sin(th);
      out[0] = c * xi - s * zr; out[1] = yi; out[2] = s * xi + c * zr;
      return out;
    };
    // угол вращения планеты (для звёзд: небо вертится)
    P.spin = t => 2 * PI * t / D.day;
    return P;
  }

  // Функция Чепмена (Шулер, GPU Pro 3): во сколько раз толща воздуха по лучу больше вертикальной; X = R / H, h = высота / H,
  // mu — косинус угла луча к вертикали. Вернёт τ / H (с плотностью у начала луча); луч в планету — 1e20. Та же формула в шейдере
  // атмосферы (js/engine/planet-view.js)
  function chapman(X, h, mu){
    const x = X + h, c = sqrt(PI / 2 * x);
    if (mu >= 0) return Math.exp(-h) * c / ((c - 1) * mu + 1);
    const x0 = x * sqrt(max(1 - mu * mu, 0));
    if (x0 < X) return 1e20;
    return max(2 * sqrt(PI / 2 * x0) * Math.exp(min(x - x0 - h, 80)) - Math.exp(-h) * c / ((1 - c) * mu + 1), 0);
  }
  E.planet = { def, create, HOME, HOME_V1, GEN, FACES, TYPES, indices, makeNoise, warp, unwarp, latDir, latK, dirOf, faceOf, key, unkey, MAXL, chapman,
    seasonOf, declinationOf, subSolarLonOf };
})();

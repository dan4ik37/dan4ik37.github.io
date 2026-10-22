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
//   на уровень, P.stitchMask — у какого края сосед крупнее (сшивка), P.buildChunk(f, L, i, j, N) — сетка куска (типизированные
//   массивы: в потоке и на странице одинаково), PL.indices(N, mask) — общие индексы сшивки.
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
  const ATMO_EARTH = { top: 0, Hr: 0, Hm: 0, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 };
  const HOME = {
    v: 1, id: 'home', title: 'Родная планета', seed: 37, radius: 128000, sea: 0, gen: 'rocky1',
    relief: { amp: 2600, land: .42, hills: 140, detail: 7, warp: .35 },
    // воздух: высота однородной толщи Рэлея 4000 ед. (≈ 3,4 км), прозрачнее земного вдвое — видно на ~30 км, небо голубое
    atmo: { top: 32000, Hr: 4000, Hm: 800, tauR: [.023, .054, .133], tauM: .012, g: .76, sun: 1 },
    air: true, o2: .21, pressure: 1, g: 1, day: 2400, phase: 0, tilt: 23.4, year: 'calendar', temp: 14,
    moons: [{ id: 'luna', radius: 32000, dist: 2400000, period: 7 * 2400, phase: 1.1, incl: 5, tint: '#cfcfcf' }],
    sky: { stars: 1, sunSize: 1 }, regions: [], hazards: [], mobs: [], requires: { rocket: 0 }, games: {},
  };
  const num = (v, d, a = -Infinity, b = Infinity) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? clamp(n, a, b) : d; };
  // проверка и значения по умолчанию; неизвестные поля — как есть (переходникам игр)
  function def(p = {}){
    if (!p || typeof p !== 'object') p = {};
    const o = { ...HOME, ...p };
    o.v = 1;
    o.id = /^[a-z][a-z0-9_-]{0,31}$/.test(o.id) ? o.id : 'planet';
    o.title = String(o.title || 'Планета').slice(0, 60);
    o.seed = num(o.seed, 37) | 0;
    o.radius = num(o.radius, 128000, 500, 2e7);
    o.sea = o.sea === null ? null : num(o.sea, 0, -1e5, 1e5);
    o.gen = typeof o.gen === 'string' && GEN[o.gen] ? o.gen : 'rocky1';
    const rl = { ...HOME.relief, ...(p.relief || {}) };
    o.relief = { amp: num(rl.amp, 2600, 0, o.radius * .2), land: num(rl.land, .42, 0, 1), hills: num(rl.hills, 140, 0, 1e4), detail: num(rl.detail, 7, 0, 200), warp: num(rl.warp, .35, 0, 1) };
    if (p.atmo === null || p.air === false && p.atmo === undefined) o.atmo = null;
    else {
      const a = { ...ATMO_EARTH, ...(p.atmo ? {} : HOME.atmo), ...(p.atmo || {}) };
      const Hr = num(a.Hr || undefined, o.radius * .03125, 1, o.radius);
      o.atmo = { top: num(a.top || undefined, Hr * 8, Hr, o.radius), Hr, Hm: num(a.Hm || undefined, Hr / 5, .5, o.radius), tauR: (Array.isArray(a.tauR) && a.tauR.length === 3 ? a.tauR : ATMO_EARTH.tauR).map(x => num(x, .1, 0, 10)),
        tauM: num(a.tauM, .03, 0, 10), g: num(a.g, .76, -.99, .99), sun: num(a.sun, 1, 0, 10) };
    }
    o.g = num(o.g, 1, 0, 10);
    o.day = num(o.day, 2400, 10, 1e7);
    o.phase = num(o.phase, 0);
    o.tilt = num(o.tilt, 23.4, 0, 90);
    o.year = o.year === 'calendar' ? 'calendar' : num(o.year, 365 * 2400, 1);
    o.temp = num(o.temp, 14, -200, 500);
    o.moons = (Array.isArray(o.moons) ? o.moons : []).slice(0, 4).map((m, i) => ({ id: String(m.id || 'moon' + i).slice(0, 32), radius: num(m.radius, o.radius / 4, 10, o.radius * 2),
      dist: num(m.dist, o.radius * 20, o.radius * 2, 1e9), period: num(m.period, o.day * 7, 1), phase: num(m.phase, 0), incl: num(m.incl, 5, -90, 90), tint: /^#[0-9a-f]{6}$/i.test(m.tint) ? m.tint : '#cfcfcf' }));
    return o;
  }

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

  // ═══ Индексы куска: внутренний квадрат сеткой (диагональ b–c, как у физики) + кольцо из 4 трапеций, сшитых «молнией»:
  //     у края с крупным соседом нечётные вершины пропускаются — край куска ровно совпадает с краем соседа. Юбки — вниз.
  //     mask: бит 0 — край i = 0 (−s), 1 — i = N (+s), 2 — j = 0 (−t), 3 — j = N (+t). Вершины: сетка (N+1)², потом юбки 4·(N+1) ═══
  const IDX = new Map();
  function indices(N, mask){
    const k = N * 16 + mask;
    if (IDX.has(k)) return IDX.get(k);
    const n1 = N + 1, out = [];
    const vid = (a, b) => b * n1 + a;   // a — по s (i), b — по t (j)
    // внутренний квадрат [1, N−1]²
    for (let b = 1; b < N - 1; b++) for (let a = 1; a < N - 1; a++) {
      const A = vid(a, b), B = vid(a + 1, b), C = vid(a, b + 1), D = vid(a + 1, b + 1);
      out.push(A, B, C, B, D, C);
    }
    // трапеции: край (внешний ряд) и внутренний ряд; «молния» по координате вдоль края; flip — порядок обхода для наружной стороны
    const zipper = (outer, inner, flip) => {
      // outer, inner: [[вершина, положение вдоль края], …] по возрастанию положения
      let a = 0, b = 0;
      while (a < outer.length - 1 || b < inner.length - 1) {
        const advA = b >= inner.length - 1 || (a < outer.length - 1 && outer[a + 1][1] <= inner[b + 1][1]);
        let t;
        if (advA) { t = [outer[a][0], outer[a + 1][0], inner[b][0]]; a++; }
        else { t = [outer[a][0], inner[b + 1][0], inner[b][0]]; b++; }
        if (flip) out.push(t[0], t[2], t[1]); else out.push(t[0], t[1], t[2]);
      }
    };
    const edge = (e) => {
      const st = mask >> e & 1 ? 2 : 1, outer = [], inner = [];
      for (let q = 0; q <= N; q += st) {
        const v = e === 0 ? vid(0, q) : e === 1 ? vid(N, q) : e === 2 ? vid(q, 0) : vid(q, N);
        outer.push([v, q]);
      }
      for (let q = 1; q <= N - 1; q++) {
        const v = e === 0 ? vid(1, q) : e === 1 ? vid(N - 1, q) : e === 2 ? vid(q, 1) : vid(q, N - 1);
        inner.push([v, q]);
      }
      // обход: край j = 0 (низ) — как сетка (a, b, c); остальные — по стороне
      zipper(outer, inner, e === 0 || e === 3);
    };
    for (let e = 0; e < 4; e++) edge(e);
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
    const H = GEN[D.gen](NZ, D);
    const R = D.radius, SEA = D.sea ?? -Infinity, SEAR = R + (D.sea ?? 0);
    const amp = D.relief.amp;
    const P = { def: D, R, SEA, SEAR, FACES, key, unkey, warp, unwarp, latDir, latK, dirOf, faceOf, cubeFace, noise: NZ };
    P.height = (x, y, z) => H(x, y, z);
    P.maxH = (D.sea ?? 0) + 760 + amp + D.relief.hills + D.relief.detail + 40;   // выше не бывает (для отсечения и дальности)
    P.minH = (D.sea ?? 0) - 2600 - 400;
    P.renderMin = D.sea != null ? D.sea : P.minH;   // нарисованная поверхность не ниже моря (вода — часть сетки)

    // ── Климат и цвет поверхности (в sRGB 0…255; вода — альфа: 0 суша, 1…255 — глубина) ──
    const C3 = [0, 0, 0];
    function tempAt(x, y, z, h){   // °C: широта, высота, шум
      const sl = y * y;   // sin² широты: экватор +28°, 45° ≈ +17°, 60° ≈ +3°, 70° ≈ −6°, полюс ≈ −16° (при temp 14)
      return D.temp + 14 - 44 * sl * sl - Math.max(0, h - (D.sea ?? 0)) / 1166 * 6.5 + NZ2.fbm(x * 3.1 + 5, y * 3.1 - 2, z * 3.1 + 9, 3) * 6;
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
      if (n) return n;
      n = { key: k, f, L, i, j, c: new Float64Array(3), cp: new Float64Array(3), ang: 0, size: 0, hc: 0, hmin: P.renderMin, hmax: P.maxH, built: false,
        split: false, leaf: 0, used: 0, mask: 0, par: null, kids: null, nb: null };
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
    let selMark = 0;
    const SEL = { cx: 0, cy: 0, cz: 0, K: 2, hyst: 1.15, maxL: 12, cull: true, out: null };
    function walk(n){
      n.used = selMark;
      if (SEL.cull && !P.horizonVisible(n, SEL.cx, SEL.cy, SEL.cz)) { n.split = false; return; }
      const dx = SEL.cx - n.cp[0], dy = SEL.cy - n.cp[1], dz = SEL.cz - n.cp[2];
      const d = max(0, sqrt(dx * dx + dy * dy + dz * dz) - n.ang * R);
      const want = n.L < SEL.maxL && d < SEL.K * n.size * (n.split ? SEL.hyst : 1);
      n.split = want;
      if (want) { const k = kidsOf(n); walk(k[0]); walk(k[1]); walk(k[2]); walk(k[3]); }
      else { n.leaf = selMark; SEL.out.push(n); }
    }
    P.select = (cx, cy, cz, o = {}, out = []) => {
      SEL.cx = cx; SEL.cy = cy; SEL.cz = cz; SEL.K = o.K || 2; SEL.hyst = o.hyst || 1.15; SEL.maxL = clamp(o.maxL ?? 12, 0, MAXL); SEL.cull = o.cull !== false;
      out.length = 0; selMark++; SEL.out = out;
      for (let f = 0; f < 6; f++) walk(node(f, 0, 0, 0));
      SEL.out = null;
      if (selMark % 64 === 0) prune(o.keep || 240);
      return out;
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
              for (const c of kidsOf(cov)) { c.leaf = selMark; c.split = false; c.used = selMark; leaves.push(c); }
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
    P.buildChunk = (f, L, i, j, N = 32) => {
      const n1 = N + 1, g = N + 3, M = N * P2[L];
      const HG = new Float64Array(g * g), DX = new Float64Array(g * g * 3), PX = new Float64Array(g * g * 3);
      const K3 = [0, 0, 0], d = [0, 0, 0];
      const gi0 = i * N, gj0 = j * N;
      // высоты: сетка с кольцом вокруг (для нормалей); внутри грани — точки решётки, за краем грани — продолжение параметров
      for (let b = 0; b < g; b++) for (let a = 0; a < g; a++) {
        const gi = gi0 + a - 1, gj = gj0 + b - 1, q = b * g + a;
        if (gi >= 0 && gj >= 0 && gi <= M && gj <= M) { latK(f, gi, gj, M, K3); latDir(K3[0], K3[1], K3[2], M, d); }
        else dirOf(f, 2 * gi / M - 1, 2 * gj / M - 1, d);
        const h = H(d[0], d[1], d[2]);
        HG[q] = h;
        DX[q * 3] = d[0]; DX[q * 3 + 1] = d[1]; DX[q * 3 + 2] = d[2];
        const hr = R + (h < P.renderMin ? P.renderMin : h);   // вода — на уровне моря
        PX[q * 3] = d[0] * hr; PX[q * 3 + 1] = d[1] * hr; PX[q * 3 + 2] = d[2] * hr;
      }
      // центр куска — центральная вершина (на нарисованной высоте)
      const cq = (N / 2 + 1) * g + (N / 2 + 1), C = new Float64Array([PX[cq * 3], PX[cq * 3 + 1], PX[cq * 3 + 2]]);
      const V = n1 * n1 + 4 * n1, pos = new Float32Array(V * 3), nrm = new Int8Array(V * 3), col = new Uint8Array(V * 4);
      let hmin = Infinity, hmax = -Infinity, rad = 0;
      const cc = [0, 0, 0];
      const skirt = 2 + .06 * (PI / 2) * R / P2[L];   // ≈ 6 % стороны куска
      for (let b = 0; b < n1; b++) for (let a = 0; a < n1; a++) {
        const q = (b + 1) * g + (a + 1), v = b * n1 + a;
        const x = PX[q * 3] - C[0], y = PX[q * 3 + 1] - C[1], z = PX[q * 3 + 2] - C[2];
        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        const r2 = x * x + y * y + z * z; if (r2 > rad) rad = r2;
        const h = HG[q], dx = DX[q * 3], dy = DX[q * 3 + 1], dz = DX[q * 3 + 2], wet = D.sea != null && h < D.sea, ice = wet && iceAt(dx, dy, dz), water = wet && !ice;
        const hr = h < P.renderMin ? P.renderMin : h; if (hr < hmin) hmin = hr; if (hr > hmax) hmax = hr;
        // нормаль: центральные разности по решётке (кольцо — общее с соседями)
        let nx, ny, nz;
        if (water) { nx = dx; ny = dy; nz = dz; }
        else {
          const qa = q - 1, qb = q + 1, qc = q - g, qd = q + g;
          const ux = PX[qb * 3] - PX[qa * 3], uy = PX[qb * 3 + 1] - PX[qa * 3 + 1], uz = PX[qb * 3 + 2] - PX[qa * 3 + 2];
          const vx = PX[qd * 3] - PX[qc * 3], vy = PX[qd * 3 + 1] - PX[qc * 3 + 1], vz = PX[qd * 3 + 2] - PX[qc * 3 + 2];
          nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
          if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
          const l = sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
        }
        nrm[v * 3] = Math.round(nx * 127); nrm[v * 3 + 1] = Math.round(ny * 127); nrm[v * 3 + 2] = Math.round(nz * 127);
        if (water) {
          const dep = D.sea - h;
          landColor(dx, dy, dz, D.sea, 1, cc);   // берег под водой — по климату (лёд у полюсов)
          col[v * 4] = Math.round(cc[0] * 255); col[v * 4 + 1] = Math.round(cc[1] * 255); col[v * 4 + 2] = Math.round(cc[2] * 255);
          col[v * 4 + 3] = clamp(128 + Math.round(dep / 6), 129, 255);   // вода: 129…255 (глубина / 6 ед.)
        } else if (ice) {   // замёрзшее море (у полюсов): белое, по нему можно ходить
          const nzz = NZ2.n3(dx * 600, dy * 600, dz * 600) * .04;
          col[v * 4] = Math.round((.86 + nzz) * 255); col[v * 4 + 1] = Math.round((.92 + nzz) * 255); col[v * 4 + 2] = Math.round((.97 + nzz) * 255); col[v * 4 + 3] = 0;
        } else {
          landColor(dx, dy, dz, h, nx * dx + ny * dy + nz * dz, cc);
          // суша: 0…127 — высота над морем (у берега плавно: берег — линия «0» между вершинами, без ступенек на крупных кусках)
          col[v * 4] = Math.round(cc[0] * 255); col[v * 4 + 1] = Math.round(cc[1] * 255); col[v * 4 + 2] = Math.round(cc[2] * 255);
          col[v * 4 + 3] = D.sea == null ? 0 : clamp(127 - Math.round((h - D.sea) / 6), 0, 127);
        }
      }
      // юбки: вершины края, опущенные к центру планеты
      for (let e = 0; e < 4; e++) for (let q = 0; q <= N; q++) {
        const a = e === 0 ? 0 : e === 1 ? N : q, b = e === 2 ? 0 : e === 3 ? N : q;
        const src = b * n1 + a, dst = n1 * n1 + e * n1 + q, gq = (b + 1) * g + (a + 1);
        const dx = DX[gq * 3], dy = DX[gq * 3 + 1], dz = DX[gq * 3 + 2];
        pos[dst * 3] = pos[src * 3] - dx * skirt; pos[dst * 3 + 1] = pos[src * 3 + 1] - dy * skirt; pos[dst * 3 + 2] = pos[src * 3 + 2] - dz * skirt;
        nrm[dst * 3] = nrm[src * 3]; nrm[dst * 3 + 1] = nrm[src * 3 + 1]; nrm[dst * 3 + 2] = nrm[src * 3 + 2];
        col[dst * 4] = col[src * 4]; col[dst * 4 + 1] = col[src * 4 + 1]; col[dst * 4 + 2] = col[src * 4 + 2]; col[dst * 4 + 3] = col[src * 4 + 3];
      }
      return { f, L, i, j, N, key: key(f, L, i, j), centre: C, pos, nrm, col, hmin, hmax, radius: sqrt(rad) + skirt };
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
    P.season = (ms) => {
      if (D.year === 'calendar') {
        const C = E.climate;
        if (C?.phaseCal) { try { return C.phaseCal(ms); } catch (e) {} }
        // без climate.js (поток): та же формула, что C.phaseCal — время мира МСК (UTC+3), декабрь–февраль зима, март–ноябрь 7 сезонов
        const t = ms + 180 * 60000, dt = new Date(t), y = dt.getUTCFullYear(), mo = dt.getUTCMonth();
        if (mo === 11) return 3 + (t - Date.UTC(y, 11, 1)) / (Date.UTC(y + 1, 2, 1) - Date.UTC(y, 11, 1));
        if (mo <= 1) return 3 + (t - Date.UTC(y - 1, 11, 1)) / (Date.UTC(y, 2, 1) - Date.UTC(y - 1, 11, 1));
        return (7 * (t - Date.UTC(y, 2, 1)) / (Date.UTC(y, 11, 1) - Date.UTC(y, 2, 1))) % 4;
      }
      return ((ms / 1000 / D.year) % 1 + 1) % 1 * 4;
    };
    // склонение солнца: +наклон в середине лета, −наклон в середине зимы, 0 в середине весны и осени (как температура в
    // climate.js: пик — середина лета, минимум — середина зимы)
    P.declination = ms => D.tilt * DEG * Math.cos((P.season(ms) - 1.5) * PI / 2);
    // долгота «под солнцем» в момент t (секунды игры): планета вращается на восток — точка под солнцем уходит на запад
    P.subSolarLon = t => D.phase * DEG - 2 * PI * t / D.day;
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
    // луна i: точка в системе планеты (круговая орбита, наклон к экватору; планета под ней вращается)
    P.moonPos = (i, t, out = [0, 0, 0]) => {
      const m = D.moons[i]; if (!m) { out[0] = out[1] = out[2] = 0; return out; }
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
  E.planet = { def, create, HOME, GEN, FACES, indices, makeNoise, warp, unwarp, latDir, latK, dirOf, faceOf, key, unkey, MAXL, chapman };
})();

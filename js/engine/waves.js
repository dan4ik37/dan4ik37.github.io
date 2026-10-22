// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — волны (D37E.waves; T-022c, 22.10.2026, docs/PHYSICS_PLAN.md §5; владелец 16.10: «волны, чтобы влияли
//  на транспорт», 22.10: «физику — как для 2D-мира, так и 3D»). Одна функция волн — сумма 4 волн Герстнера — и в шейдере
//  воды, и в JS: лодка качается ровно на видимой волне, пловец и вещи — тоже. Высота — от погоды (climate.js: ветер, гроза,
//  лёд) и от «размера» воды (пруд, канал, река, озеро, океан; гавань и мель — множителем места). Всё — от общего времени
//  (Date.now) и зерна: у всех игроков одни и те же волны без сети.
// ═══════════════════════════════════════
// Без three.js (проверяется в node: scripts/waves-test.cjs). Единицы — движка (1 м = E.UNIT); у 2D-игр — свои (g в клетках).
//   F = D37E.waves.field({ kind, seed, level, dir, gain, grid, g, fade, solo })   — волны одной воды (solo — своя вода 2D-игры)
//       kind: ocean | lake | pond | canal | river | side (вид сбоку, 2D); grid — сетка глубины и «открытости» (gridFrom)
//   F.weather({ wind (м/с), windDir (рад, куда дует), thunder 0…1, ice 0…1 }) — от погоды (W.at climate.js): высота F.H, шторм F.storm
//   F.sample(x, z, t, out, fadeDist) → { y, vx, vz, vy, sx, sz, m } — высота над спокойной гладью в точке мира (обратное
//       смещение Герстнера — Ньютоном), скорость воды (по горизонтали и вверх), уклон, множитель места; fadeDist — как видно с
//       такого расстояния (дальние короткие волны в шейдере гаснут — только для картинки чужих лодок)
//   F.at(x, z, t) → высота; F.disp(x0, z0, t, out, dist) — смещение точки спокойной глади (ровно как в шейдере, для проверок)
//   F.at1(x, t) → «вид сбоку» (2D): высота по x (волны вдоль x, без смещения вбок)
//   D37E.waves.time(мс) → общее время волн, с (по модулю P: точность float в шейдере); clock(v, dt) — часы шага (лодка)
//   D37E.waves.GLSL — куски шейдера: gfx.js E.waterMaterial(R, цвет, { waves: F, wavesMode: 'v' | 'f' }) — 'v' смещение вершин
//       (сетка-«блин» patch), 'f' — только нормали в каждой точке (пруд, канал: смещение в 2–5 см сетке не видно)
//   D37E.waves.patch(R, mat, { level, radius, mask }) — кольца вокруг камеры (рядом мельче) — на них видны волны
//   D37E.waves.attach(R, [F…]) — каждый кадр: фазы у камеры (числа поменьше — точнее на телефоне), сетки к камере
//   D37E.waves.can(R) — можно ли волны в картинке (WebGL2, не «низкая», страж не выключил); нельзя — и в физике их нет
//   (что видишь, то и качает); страж графики (post.js, ключ 'waves') — D37E.waves.disable(T)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.waves && E.waves.v) return;
  const PI = Math.PI, TAU = PI * 2;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const sm = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };   // a < b
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : d; };
  const U = E.UNIT || 2.1 / 1.8;
  const P = 96;   // общий период (с): частоты всех волн кратны 2π/P — время по модулю P, фазы не «прыгают»
  const N = 4;
  const G0 = 9.81 * U;   // тяжесть в единицах движка (волны: ω² = g·k, глубокая вода)
  const seedOf = s => { if (typeof s === 'number' && Number.isFinite(s)) return s | 0; let h = 0x811c9dc5; const str = String(s ?? 'waves'); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h | 0; };
  const rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ═══ Виды воды: n — номер гармоники общего периода (период волны P/n), share — доля высоты, spread — направление от
  //     главного (рад; у «вида сбоку» — 0 вправо, π влево), высота H (сумма амплитуд, единиц) = base + perW·ветер² + storm·гроза,
  //     не больше max; steep — крутизна гребня (спокойно → шторм); drift — снос в шторм (единиц/с); calm — ветер «по умолчанию» ═══
  const KINDS = {
    // волна 6 с — 66 ед., 4 с — 29, 2,8 с — 14, 2 с — 7,6: лодка 5,8 ед. ложится на длинные и «скачет» на коротких
    ocean: { n: [16, 24, 34, 47], share: [.42, .3, .17, .11], spread: [0, .45, -.6, 1.05], base: .12, perW: .0052, storm: 1.1, max: 2.1, steep: [.5, .95], drift: .9, calm: 7 },
    lake: { n: [40, 58, 80, 110], share: [.4, .3, .18, .12], spread: [0, .5, -.7, 1.1], base: .02, perW: .0012, storm: .18, max: .42, steep: [.35, .8], drift: .35, calm: 4 },
    pond: { n: [70, 100, 140, 190], share: [.4, .3, .18, .12], spread: [0, .6, -.8, 1.2], base: .008, perW: .00028, storm: .05, max: .1, steep: [.3, .6], drift: .1, calm: 3 },
    canal: { n: [60, 86, 118, 160], share: [.4, .3, .18, .12], spread: [0, .55, -.75, 1.15], base: .01, perW: .0004, storm: .06, max: .12, steep: [.3, .6], drift: .12, calm: 3 },
    river: { n: [64, 92, 126, 170], share: [.4, .3, .18, .12], spread: [0, .55, -.75, 1.15], base: .006, perW: .00022, storm: .03, max: .06, steep: [.25, .5], drift: .05, calm: 3 },
    // вид сбоку (2D, «Подземье»): единицы — клетки, g — в клетках (клетка ≈ 0,5 м → 19,6); волны вдоль x — две вправо, две влево
    side: { n: [36, 47, 60, 76], share: [.4, .28, .2, .12], spread: [0, PI, 0, PI], base: .04, perW: .0016, storm: .22, max: .45, steep: [0, 0], drift: .6, calm: 4, g: 19.6 },
  };

  const W = E.waves = { v: 1, P, N, G0, KINDS, enabled: true, mats: new Set(), patches: new Set(), fields: new Set() };
  W.time = (ms = Date.now()) => { const p = P * 1000; return ((ms % p) + p) % p / 1000; };
  // часы шага (лодка, пловец): +dt за шаг — у 30/60/144 кадров одинаково (начало — общее время по сетке 0,25 с: первый шаг
  // при любой частоте кадров берёт то же начало); ушли от общих > 0,5 с (вкладка спала) — снова к общим
  const snap = t => Math.floor(t / .25) * .25;
  W.clock = (o, dt, ms) => {
    const now = W.time(ms);
    if (!(o.wt >= 0)) o.wt = snap(now);
    else { o.wt += dt; if (o.wt >= P) o.wt -= P; let d = now - o.wt; if (d > P / 2) d -= P; else if (d < -P / 2) d += P; if (Math.abs(d) > .5) o.wt = snap(now); }
    return o.wt;
  };

  // ═══ Сетка глубины и «открытости» (одна на воду): узлы n×n с шагом cell от (x0, z0); depth — уровень минус дно, expo —
  //     0…1 (1 — открытое море, гавань меньше). В шейдере — текстура RG (центры текселей — в узлах), в JS — та же билинейная ═══
  W.gridFrom = (o = {}) => {
    const n = o.n | 0, cell = +o.cell, x0 = +o.x0, z0 = +o.z0;
    if (!(n >= 2) || !(cell > 0)) return null;
    const depth = new Float32Array(n * n), expo = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i * cell, z = z0 + j * cell;
      depth[k] = cl(o.depth ? o.depth(x, z, i, j) : 9, -4, 12);
      expo[k] = cl(o.expo ? o.expo(x, z, i, j) : 1, 0, 1);
    }
    return { n, cell, x0, z0, depth, expo, d0: num(o.d0, .4), d1: num(o.d1, 7) };
  };
  // множитель места: глубина (у берега волны гаснут) × открытость
  function gridMul(G, x, z){
    const n = G.n;
    let fx = (x - G.x0) / G.cell, fz = (z - G.z0) / G.cell;
    fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx; fz = fz < 0 ? 0 : fz > n - 1 ? n - 1 : fz;
    let i = Math.floor(fx), j = Math.floor(fz); if (i > n - 2) i = n - 2; if (j > n - 2) j = n - 2;
    const tx = fx - i, tz = fz - j, k = j * n + i, D = G.depth, X = G.expo;
    const d = (D[k] * (1 - tx) + D[k + 1] * tx) * (1 - tz) + (D[k + n] * (1 - tx) + D[k + n + 1] * tx) * tz;
    const e = (X[k] * (1 - tx) + X[k + 1] * tx) * (1 - tz) + (X[k + n] * (1 - tx) + X[k + n + 1] * tx) * tz;
    return sm(G.d0, G.d1, d) * e;
  }
  W.gridMul = gridMul;

  // ═══ Поле волн одной воды ═══
  W.field = (o = {}) => {
    const kind = KINDS[o.kind] ? o.kind : 'lake', K = KINDS[kind], g = num(o.g, K.g || G0), seed = seedOf(o.seed ?? kind), r = rng(seed);
    const side = kind === 'side';
    const th0 = side ? 0 : num(o.dir, r() * TAU);   // главное направление зыби — от зерна (постоянное: иначе фазы вдали «прыгают»)
    const F = {
      kind, K, seed, side, g, th0, level: num(o.level, 0), gain: num(o.gain, 1), grid: o.grid || null, fadeK: num(o.fade, 40), solo: !!o.solo,
      k: new Float64Array(N), w: new Float64Array(N), dx: new Float64Array(N), dz: new Float64Array(N), ph: new Float64Array(N), th: new Float64Array(N), lam: new Float64Array(N),
      A: new Float64Array(N), QA: new Float64Array(N), H: 0, Q: 0, storm: 0, wind: 0, windDir: th0, thunder: 0, ice: 0, ddx: Math.cos(th0), ddz: Math.sin(th0), drift: 0, rev: 0, U: null,
    };
    for (let i = 0; i < N; i++) {
      const w = TAU * K.n[i] / P, k = w * w / g, th = side ? K.spread[i] : th0 + K.spread[i];
      F.w[i] = w; F.k[i] = k; F.lam[i] = TAU / k; F.th[i] = th; F.dx[i] = Math.cos(th); F.dz[i] = side ? 0 : Math.sin(th); F.ph[i] = r() * TAU;
      if (side) F.dx[i] = th > 1 ? -1 : 1;
    }
    // ── погода → высота и крутизна: ветер дует «куда» windDir — сильнее волны, идущие по ветру ──
    const WT = new Float64Array(N);
    F.weather = (s = {}) => {
      const wind = Math.max(0, num(s.wind, K.calm)), wd = num(s.windDir, th0), th = cl(num(s.thunder, 0), 0, 1), ice = cl(num(s.ice, 0), 0, 1);
      const on = (F.solo || W.enabled) && F.gain > 0 ? 1 : 0;   // solo — своя вода игры (2D): общий выключатель 3D-воды её не трогает
      const H0 = Math.min(K.max, K.base + K.perW * wind * wind + K.storm * th);
      const H = H0 * F.gain * (1 - sm(.5, .8, ice)) * on;
      let ws = 0;
      const wt = WT;
      for (let i = 0; i < N; i++) { const c = side ? F.dx[i] * Math.cos(wd) : Math.cos(F.th[i] - wd); wt[i] = K.share[i] * (.35 + .65 * (.5 + .5 * c)); ws += wt[i]; }
      let kA = 0, ddx = 0, ddz = 0;
      for (let i = 0; i < N; i++) { F.A[i] = H * wt[i] / ws; kA += F.k[i] * F.A[i]; ddx += F.dx[i] * F.A[i]; ddz += F.dz[i] * F.A[i]; }
      const s01 = on ? cl((H0 - K.base) / (K.max - K.base), 0, 1) * (1 - sm(.5, .8, ice)) : 0;
      let Q = K.steep[0] + (K.steep[1] - K.steep[0]) * s01;
      if (kA > 1e-9) Q = Math.min(Q, .85 / kA);   // без петель на гребне (Σ Q·k·A ≤ 0,85)
      for (let i = 0; i < N; i++) F.QA[i] = Q * F.A[i];
      const dl = Math.hypot(ddx, ddz) || 1;
      Object.assign(F, { H, Q, storm: s01, wind, windDir: wd, thunder: th, ice, ddx: ddx / dl, ddz: ddz / dl, drift: K.drift * s01 * on });
      F.rev++;
      return F;
    };
    const mul = (x, z) => F.grid ? gridMul(F.grid, x, z) : 1;
    F.mulAt = mul;
    // доля волны i, видная с расстояния dist (как в шейдере); без dist — вся
    const vis = (i, dist) => dist >= 0 ? 1 - sm(F.lam[i] * F.fadeK, F.lam[i] * F.fadeK * 1.8, dist) : 1;
    // смещение точки спокойной глади (x0, z0) — ровно как d37Gerst в шейдере (с точностью до float)
    F.disp = (x0, z0, t, out = {}, dist = -1) => {
      const m = mul(x0, z0);
      let Dx = 0, Dz = 0, Y = 0, Yx = 0, Yz = 0, jxx = 0, jzz = 0, jxz = 0;
      for (let i = 0; i < N; i++) {
        const f = m * vis(i, dist), A = F.A[i] * f, QA = F.QA[i] * f; if (!A) continue;
        const k = F.k[i], dx = F.dx[i], dz = F.dz[i], th = k * (dx * x0 + dz * z0) - F.w[i] * t + F.ph[i], s = Math.sin(th), c = Math.cos(th);
        Dx += dx * QA * c; Dz += dz * QA * c; Y += A * s;
        Yx += dx * k * A * c; Yz += dz * k * A * c;
        jxx -= QA * k * dx * dx * s; jzz -= QA * k * dz * dz * s; jxz -= QA * k * dx * dz * s;
      }
      // нормаль — точно (касательные по x0 и z0, их векторное произведение); jac — «сжатие» гребня (пена)
      const nx = Yz * jxz - (1 + jzz) * Yx, ny = (1 + jxx) * (1 + jzz) - jxz * jxz, nz = jxz * Yx - Yz * (1 + jxx), nl = Math.hypot(nx, ny, nz) || 1;
      out.x = Dx; out.y = Y; out.z = Dz; out.nx = nx / nl; out.ny = ny / nl; out.nz = nz / nl; out.jac = ny; out.m = m;
      return out;
    };
    // высота в точке мира: найти точку спокойной глади, которую волна принесла сюда (Ньютон, 3 шага)
    const S0 = { y: 0, vx: 0, vz: 0, vy: 0, sx: 0, sz: 0, m: 0, x0: 0, z0: 0 };
    F.sample = (x, z, t, out = S0, dist = -1) => {
      out.y = out.vx = out.vz = out.vy = out.sx = out.sz = 0; out.x0 = x; out.z0 = z; out.m = 0;
      if (!(F.H > 1e-7)) return out;
      let x0 = x, z0 = z, m = mul(x, z);
      if (!(m > 1e-6)) return out;
      for (let it = 0; it < 3; it++) {
        if (it) m = mul(x0, z0);
        let Dx = 0, Dz = 0, jxx = 0, jzz = 0, jxz = 0;
        for (let i = 0; i < N; i++) {
          const QA = F.QA[i] * vis(i, dist); if (!QA) continue;
          const k = F.k[i], dx = F.dx[i], dz = F.dz[i], th = k * (dx * x0 + dz * z0) - F.w[i] * t + F.ph[i], s = Math.sin(th), c = Math.cos(th), kq = k * QA;
          Dx += dx * QA * c; Dz += dz * QA * c;
          jxx -= kq * dx * dx * s; jzz -= kq * dz * dz * s; jxz -= kq * dx * dz * s;
        }
        const fx = x0 + m * Dx - x, fz = z0 + m * Dz - z;
        if (fx * fx + fz * fz < 1e-12) break;
        const a = 1 + m * jxx, b = m * jxz, d = 1 + m * jzz, det = a * d - b * b;
        if (!(Math.abs(det) > 1e-6)) break;
        x0 -= (d * fx - b * fz) / det; z0 -= (a * fz - b * fx) / det;
      }
      m = mul(x0, z0);
      let y = 0, Yx = 0, Yz = 0, jxx = 0, jzz = 0, jxz = 0, vx = 0, vz = 0, vy = 0;
      for (let i = 0; i < N; i++) {
        const f = m * vis(i, dist), A = F.A[i] * f, QA = F.QA[i] * f; if (!A) continue;
        const k = F.k[i], w = F.w[i], dx = F.dx[i], dz = F.dz[i], th = k * (dx * x0 + dz * z0) - w * t + F.ph[i], s = Math.sin(th), c = Math.cos(th);
        y += A * s; Yx += dx * k * A * c; Yz += dz * k * A * c;
        jxx -= QA * k * dx * dx * s; jzz -= QA * k * dz * dz * s; jxz -= QA * k * dx * dz * s;
        vx += dx * QA * w * s; vz += dz * QA * w * s; vy -= A * w * c;
      }
      const nx = Yz * jxz - (1 + jzz) * Yx, ny = (1 + jxx) * (1 + jzz) - jxz * jxz, nz = jxz * Yx - Yz * (1 + jxx);
      out.y = y; out.vx = vx; out.vz = vz; out.vy = vy; out.m = m; out.x0 = x0; out.z0 = z0;
      if (ny > 1e-6) { out.sx = -nx / ny; out.sz = -nz / ny; }
      return out;
    };
    const AT = { y: 0 };
    F.at = (x, z, t, dist) => F.sample(x, z, t, AT, dist).y;
    // вид сбоку (2D): только по x, без смещения вбок (Q = 0): y = Σ A·sin(k·x·dir − ω t + φ)
    F.at1 = (x, t) => { let y = 0; for (let i = 0; i < N; i++) { const A = F.A[i]; if (A) y += A * Math.sin(F.k[i] * F.dx[i] * x - F.w[i] * t + F.ph[i]); } return y; };
    F.vel1 = (x, t) => { let v = 0; for (let i = 0; i < N; i++) { const A = F.A[i]; if (A) v -= A * F.w[i] * Math.cos(F.k[i] * F.dx[i] * x - F.w[i] * t + F.ph[i]); } return v; };   // скорость глади вверх
    F.weather({});
    W.fields.add(F);
    return F;
  };
  // мир закрыли: поле прочь вместе с его материалами (материал держит рендерер старого мира — иначе утечка) и «блинами»
  W.free = F => {
    W.fields.delete(F);
    for (const m of W.mats) if (m.userData?.gw === F) W.mats.delete(m);
    for (const Pt of W.patches) if (Pt.mesh?.material?.userData?.gw === F) W.patches.delete(Pt);
    if (F.U) { F.U.d37GwG.value = null; F.U.d37GwM.value = null; }
  };

  // ═══ Лодка на волне: высоты под носом, кормой и бортами → цели качки (подъём, тангаж, крен); длина L, ширина B ═══
  // (вид: x — влево, z — вперёд; тангаж > 0 — нос вниз, крен > 0 — левый борт выше — как E.vehicle.local)
  const PS = { y: 0 };
  W.hull = (F, x, z, yaw, L, B, t, out = {}, dist = -1) => {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), a = L * .42, b = B * .45;
    const hb = F.sample(x + fx * a, z + fz * a, t, PS, dist).y, hs = F.sample(x - fx * a, z - fz * a, t, PS, dist).y;
    const hl = F.sample(x + lx * b, z + lz * b, t, PS, dist).y, hr = F.sample(x - lx * b, z - lz * b, t, PS, dist).y;
    const c = F.sample(x, z, t, PS, dist);
    out.heave = (hb + hs + hl + hr + 2 * c.y) / 6; out.pitch = Math.atan2(hs - hb, 2 * a); out.roll = Math.atan2(hl - hr, 2 * b);
    out.bow = hb; out.stern = hs; out.left = hl; out.right = hr; out.c = c.y; out.a = a; out.b = b; out.m = c.m; out.vx = c.vx; out.vz = c.vz;
    return out;
  };

  // ═══ Куски шейдера (gfx.js E.waterMaterial; three.js r149). Всё — под define: D37_GW (поле), D37_GWV (смещение вершин —
  //     только у сетки без поворота и масштаба: patch), D37_GWF (нормаль в каждой точке), D37_GWG (сетка глубины), D37_GWM
  //     (маска: где на «блине» есть вода). smoothstep — edge0 < edge1; цикл — разворачивается three (#pragma unroll_loop);
  //     сэмплеры — highp (телефоны). Страж графики выключает весь кусок (ключ 'waves') — вода как раньше ═══
  const SP = () => E.SAMPLER_PREC || { hi: '', lo: '' };
  W.GLSL = {
    // общее (вершины и точки): uniform и функция волн
    pars: () => `
#ifdef D37_GW
uniform vec4 d37GwA[ 4 ];
uniform vec4 d37GwP;
uniform vec4 d37GwF;
uniform vec4 d37GwO;
#ifdef D37_GWG
${SP().hi}uniform sampler2D d37GwG;
${SP().lo}uniform vec4 d37GwGR;
#endif
float d37GwMul( vec2 p ){
#ifdef D37_GWG
	vec4 g = texture2D( d37GwG, ( p - d37GwGR.xy ) / d37GwGR.zw );
	return smoothstep( d37GwO.z, d37GwO.w, g.r ) * g.g;
#else
	return 1.0;
#endif
}
vec3 d37Gerst( vec2 p, float dist, out vec3 nrm, out float jac ){
	vec2 q = p - d37GwO.xy;
	float m = d37GwMul( p );
	vec3 d = vec3( 0.0 );
	float Yx = 0.0, Yz = 0.0, jxx = 0.0, jzz = 0.0, jxz = 0.0;
	vec4 c; vec2 dir; float f, th, s, co, k, A, QA;
	#pragma unroll_loop_start
	for ( int i = 0; i < 4; i ++ ) {
		c = d37GwA[ i ];
		f = m * ( 1.0 - smoothstep( d37GwF[ i ], d37GwF[ i ] * 1.8, dist ) );
		k = length( c.xy ); dir = c.xy / max( k, 1e-6 );
		A = c.z * f; QA = c.w * f;
		th = mod( dot( c.xy, q ) + d37GwP[ i ], 6.2831853 );
		s = sin( th ); co = cos( th );
		d += vec3( dir.x * QA * co, A * s, dir.y * QA * co );
		Yx += c.x * A * co; Yz += c.y * A * co;
		jxx -= QA * k * dir.x * dir.x * s; jzz -= QA * k * dir.y * dir.y * s; jxz -= QA * k * dir.x * dir.y * s;
	}
	#pragma unroll_loop_end
	jac = ( 1.0 + jxx ) * ( 1.0 + jzz ) - jxz * jxz;
	nrm = normalize( vec3( Yz * jxz - ( 1.0 + jzz ) * Yx, jac, jxz * Yx - Yz * ( 1.0 + jxx ) ) );
	return d;
}
#endif
#ifdef D37_GWV
varying float vD37Fo;
#endif`,
    // вершины (после beginnormal_vertex): смещение и нормаль волны; пена на «сжатых» гребнях
    vNormal: `
#ifdef D37_GWV
	vec3 d37GwD = vec3( 0.0 );
	{
		vec2 d37Pw = ( modelMatrix * vec4( position, 1.0 ) ).xz;
		vec3 d37Nw; float d37J;
		d37GwD = d37Gerst( d37Pw, length( d37Pw - cameraPosition.xz ), d37Nw, d37J );
		objectNormal = d37Nw;
		vD37Fo = 1.0 - smoothstep( 0.22, 0.64, d37J );
	}
#endif`,
    vBegin: `
#ifdef D37_GWV
	transformed += d37GwD;
#endif`,
    // точки: маска «блина», нормаль (D37_GWF — своя в каждой точке), пена гребней
    fPars: () => `
#ifdef D37_GWM
${SP().hi}uniform sampler2D d37GwM;
${SP().lo}uniform vec4 d37GwMR;
#endif
#ifdef D37_GW
vec3 d37GwView( vec3 n, vec2 nn, vec3 up ){
	float sg = dot( n, up ) < 0.0 ? -1.0 : 1.0;
#ifdef D37_GWF
	vec3 wn; float wj;
	d37Gerst( vD37W.xz, length( vViewPosition ), wn, wj );
	n = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz ) * sg;
#endif
	return normalize( n + ( viewMatrix * vec4( nn.x, 0.0, nn.y, 0.0 ) ).xyz * sg );
}
#endif`,
    fMask: `
#ifdef D37_GWM
	if ( texture2D( d37GwM, ( vD37W.xz - d37GwMR.xy ) / d37GwMR.zw ).r < 0.5 ) discard;
#endif`,
    fFoam: `
#ifdef D37_GWV
	{
		float d37Fn = texture2D( normalMap, vD37W.xz * 0.11 + uTime * vec2( 0.012, -0.017 ) ).x;
		float d37Fo = vD37Fo * smoothstep( 0.3, 0.72, d37Fn + 0.3 * vD37Fo ) * ( 0.35 + 0.65 * uFoam );
		diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.95, 1.0 ), d37Fo );
		diffuseColor.a = max( diffuseColor.a, d37Fo * 0.9 );
	}
#endif`,
  };
  // общие uniform поля (по ссылке у всех материалов этой воды); обновляет attach() каждый кадр
  W.uniforms = F => {
    if (F.U) return F.U;
    F.U = { d37GwA: { value: new Float32Array(16) }, d37GwP: { value: new Float32Array(4) }, d37GwF: { value: new Float32Array(4) }, d37GwO: { value: new Float32Array(4) },
      d37GwG: { value: null }, d37GwGR: { value: new Float32Array([0, 0, 1, 1]) }, d37GwM: { value: null }, d37GwMR: { value: new Float32Array([0, 0, 1, 1]) } };
    W.sync(F, W.time(), 0, 0);
    return F.U;
  };
  // фазы — от начала отсчёта (ox, oz) у камеры: k·(d·o) − ω t + φ по модулю 2π (в шейдере числа маленькие — точно и на телефоне)
  W.sync = (F, t, ox, oz) => {
    const u = F.U; if (!u) return;
    const A = u.d37GwA.value, Ph = u.d37GwP.value, Fd = u.d37GwF.value, O = u.d37GwO.value;
    for (let i = 0; i < N; i++) {
      const k = F.k[i];
      A[i * 4] = k * F.dx[i]; A[i * 4 + 1] = k * F.dz[i]; A[i * 4 + 2] = F.A[i]; A[i * 4 + 3] = F.QA[i];
      let p = (k * (F.dx[i] * ox + F.dz[i] * oz) - F.w[i] * t + F.ph[i]) % TAU; if (p < 0) p += TAU;
      Ph[i] = p; Fd[i] = Math.max(.01, F.lam[i] * F.fadeK);
    }
    O[0] = ox; O[1] = oz;
    const G = F.grid; O[2] = G ? G.d0 : 0; O[3] = G ? G.d1 : 1;
  };
  // можно ли волны в картинке на этом устройстве (и тогда — в физике)
  // (решение стража помнится в d37_gfx_guard — E.gfxSafe('waves'); «↺ Вернуть всё» его стирает — снова можно)
  W.can = R => !!R && R.q !== 'low' && !!R.r?.capabilities?.isWebGL2 && !E.gfxSafe?.('waves');
  W.active = () => W.enabled && W.mats.size > 0;
  // материал воды → волны: defines и uniform (gfx.js вызывает при создании; mode 'v' — смещение вершин, 'f' — нормали)
  W.use = (m, F, mode = 'f') => {
    const u = W.uniforms(F);
    m.defines = m.defines || {};
    m.defines.D37_GW = 1;
    if (mode === 'v') m.defines.D37_GWV = 1; else m.defines.D37_GWF = 1;
    if (F.grid?.tex) { m.defines.D37_GWG = 1; u.d37GwG.value = F.grid.tex; }
    if (mode === 'v' && F.grid?.mask) { m.defines.D37_GWM = 1; u.d37GwM.value = F.grid.mask; }
    m.userData.gwU = u; m.userData.gw = F; m.userData.gwMode = mode;
    W.mats.add(m);
    return m;
  };
  // текстуры сетки (RG half float: глубина, открытость; маска — R8, без сглаживания) — для шейдера
  W.gridTex = (T, G, maskOf) => {
    if (!G || !T?.DataUtils?.toHalfFloat) return G;
    const n = G.n, d = new Uint16Array(n * n * 2), h = T.DataUtils.toHalfFloat;
    for (let k = 0; k < n * n; k++) { d[k * 2] = h(G.depth[k]); d[k * 2 + 1] = h(G.expo[k]); }
    const t = new T.DataTexture(d, n, n, T.RGFormat, T.HalfFloatType);
    t.magFilter = t.minFilter = T.LinearFilter; t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true; t.name = 'd37gwGrid';
    G.tex = t; G.rect = [G.x0 - G.cell / 2, G.z0 - G.cell / 2, G.cell * n, G.cell * n];
    if (maskOf) {   // маска клеток (где вода есть: как море клетками у карты): n — клеток, x0/z0 — угол, cell — шаг
      const M = maskOf, md = new Uint8Array(M.n * M.n); for (let k = 0; k < md.length; k++) md[k] = M.data[k] ? 255 : 0;
      const mt = new T.DataTexture(md, M.n, M.n, T.RedFormat, T.UnsignedByteType);
      mt.magFilter = mt.minFilter = T.NearestFilter; mt.wrapS = mt.wrapT = T.ClampToEdgeWrapping; mt.generateMipmaps = false; mt.needsUpdate = true; mt.name = 'd37gwMask';
      G.mask = mt; G.maskRect = [M.x0, M.z0, M.cell * M.n, M.cell * M.n];
    }
    return G;
  };
  W.bindGrid = F => {
    const u = F.U, G = F.grid; if (!u || !G) return;
    if (G.tex) { u.d37GwG.value = G.tex; u.d37GwGR.value.set(G.rect); }
    if (G.mask) { u.d37GwM.value = G.mask; u.d37GwMR.value.set(G.maskRect); }
  };

  // ═══ «Блин» вокруг камеры: кольца (рядом — шаг dr0, дальше растёт на gr от радиуса), центр — под камерой каждый кадр.
  //     Дальние короткие волны гаснут там, где шаг сетки больше 1/5 их длины (fadeK = 1 / (9·gr)) — без мерцания ═══
  W.patchSpec = mob => mob ? { segs: 96, dr0: .7, gr: .065 } : { segs: 128, dr0: .5, gr: .045 };
  W.patchGeometry = (T, o = {}) => {
    const segs = o.segs | 0 || 128, dr0 = +o.dr0 || .5, gr = +o.gr || .045, Rm = +o.radius || 3100;
    const rings = [0];
    for (let r = 0; r < Rm;) { r += Math.max(dr0, r * gr); rings.push(Math.min(r, Rm)); }
    const nr = rings.length, vc = 1 + (nr - 1) * segs, pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
    for (let i = 0; i < vc; i++) nor[i * 3 + 1] = 1;
    let v = 1;
    for (let j = 1; j < nr; j++) for (let s = 0; s < segs; s++) { const a = s / segs * TAU, r = rings[j]; pos[v * 3] = Math.cos(a) * r; pos[v * 3 + 2] = Math.sin(a) * r; v++; }
    const idx = [];
    for (let s = 0; s < segs; s++) idx.push(0, 1 + (s + 1) % segs, 1 + s);   // центр — веером (лицом вверх)
    for (let j = 1; j < nr - 1; j++) {
      const a0 = 1 + (j - 1) * segs, b0 = 1 + j * segs;
      for (let s = 0; s < segs; s++) { const s1 = (s + 1) % segs, a = a0 + s, b = a0 + s1, c = b0 + s, d = b0 + s1; idx.push(a, b, c, b, d, c); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setIndex(vc > 65535 ? new T.Uint32BufferAttribute(idx, 1) : new T.Uint16BufferAttribute(idx, 1));
    g.boundingSphere = new T.Sphere(new T.Vector3(), Rm + 50);
    g.userData.rings = nr; g.userData.verts = vc;
    return g;
  };
  W.patch = (R, mat, o = {}) => {
    const T = R.T, mob = o.mobile ?? !!E.isMobile?.(), sp = W.patchSpec(mob);
    const geo = W.patchGeometry(T, { ...sp, radius: o.radius || 3100 });
    const mesh = new T.Mesh(geo, mat); mesh.name = 'waves-patch';
    mesh.frustumCulled = false; mesh.renderOrder = o.renderOrder ?? 2; mesh.userData.dyn = true; mesh.userData.noCast = true; mesh.userData.gwPatch = true;
    (o.parent || R.scene).add(mesh);
    const F = mat.userData?.gw; if (F) F.fadeK = 1 / (9 * sp.gr);
    const level = num(o.level, 0);
    const Pt = {
      mesh, spec: sp, level, on: true,
      update(cam){ mesh.position.set(cam.x, level, cam.z); },
      show(on){ Pt.on = !!on; mesh.visible = Pt.on; o.onShow?.(Pt.on); },
      dispose(){ mesh.parent?.remove(mesh); geo.dispose(); W.patches.delete(Pt); },
    };
    W.patches.add(Pt);
    return Pt;
  };

  // ═══ Каждый кадр: фазы волн у камеры, «блины» под камеру. fields — поля этого мира; возвращает { dispose } ═══
  W.attach = (R, fields = [], o = {}) => {
    const list = new Set(fields);
    const f = () => {
      const c = R.camera.position, t = W.time(o.now?.()), ox = Math.round(c.x / 256) * 256, oz = Math.round(c.z / 256) * 256;
      for (const F of list) if (F.U) W.sync(F, t, ox, oz);
      for (const Pt of W.patches) if (Pt.on && Pt.mesh.parent) Pt.update(c);
    };
    f.dispose = () => { const i = R.preRender.indexOf(f); if (i >= 0) R.preRender.splice(i, 1); list.clear(); };
    R.preRender.push(f);
    return { add: F => list.add(F), dispose: f.dispose, tick: f };
  };

  // ═══ Страж графики (post.js, ключ 'waves'): программа воды с волнами не собралась / кадр «не числа» — волны прочь:
  //     материалы без кусков волн (вода как раньше), «блины» спрятаны (видна обычная вода), физика — без волн ═══
  W.disable = () => {
    W.enabled = false;
    for (const m of W.mats) { if (m.defines) for (const k of ['D37_GW', 'D37_GWV', 'D37_GWF', 'D37_GWG', 'D37_GWM']) delete m.defines[k]; m.needsUpdate = true; }
    W.mats.clear();
    for (const Pt of W.patches) Pt.show(false);
    for (const F of W.fields) F.weather({ wind: F.wind, windDir: F.windDir, thunder: F.thunder, ice: F.ice });
    try { root.dispatchEvent?.(new CustomEvent('d37:waves', { detail: { on: false } })); } catch (e) {}
    return true;
  };

  // ═══ «Вид сбоку» (2D): кусок GLSL ES 3.00 — та же сумма волн, что F.at1 (uniform: uW1K — k·dir, uW1A — амплитуды, uW1P —
  //     фазы от начала отсчёта ox: k·dir·ox − ω t + φ); x — от начала отсчёта ═══
  W.GLSL1 = `float d37w1( float x ){ vec4 th = uW1K * x + uW1P; return dot( uW1A, sin( th ) ); }`;
  W.sync1 = (F, t, ox, outK, outA, outP) => {
    for (let i = 0; i < N; i++) {
      const kk = F.k[i] * F.dx[i]; outK[i] = kk; outA[i] = F.A[i];
      let p = (kk * ox - F.w[i] * t + F.ph[i]) % TAU; if (p < 0) p += TAU; outP[i] = p;
    }
  };
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — звёздные системы (D37E.system): тела — ДАННЫЕ (PlanetProfile v2, js/engine/planet.js), на рельсах Кеплера
//  (js/engine/orbit.js). «Система Денчика» (SYS.HOME), где все тела в момент t, небо любого тела (направления, фазы, блеск,
//  затмения), сферы влияния, ближайшие фазы и затмения Луны. План — docs/plans/planet-space.md §1–2, T-079 PS-1.
//  Без three.js и DOM: страница, поток, node (scripts/orbit-test.cjs), сервер. Рисует небо — js/engine/space-view.js.
// ═══════════════════════════════════════
// S = SYS.create(SYS.HOME): S.star, S.list (тела: родитель раньше детей), S.byId, S.belts
//   тело: { id, title, type, def (профиль v2), parent, kids, R, mu, top (верх атмосферы над R), el (элементы, O.el), T, soi, stub }
//   S.at(t) — положения и скорости всех тел (оси системы, звезда в начале) в S.pos / S.vel (по 3 числа на тело, индекс b.i)
//   S.posOf(id, t, out) · S.which(p, t) — в чьей сфере влияния точка · S.shadow(p, t, skipA, skipB) — доля солнца (затмения)
//   S.frame(obs, t, ms, F) — поворот «система → тело obs» (BF, вращается с телом): F.M (9 чисел по строкам), F.sun (на солнце)
//   S.sky(obs, t, ms, camBF, out, o) — небо из точки camBF (система тела obs): направления, угловые размеры, фазы, блеск, затмения
//   S.phase(obs, moon, t) — фаза: доля освещённого диска, растёт ли · S.moonEvents(obs, moon, t) — полнолуние, новолуние, затмения
//   S.orbitPath(b, n, out) — точки орбиты (для карты)
// Небо тела с календарём владельца (родная планета): солнце на небе — по календарю (времена года — climate.js), а тела
// летят по ровным рельсам. Чтобы фазы, затмения и положения у солнца были точными, вся система для неба этого тела
// поворачивается вокруг полюса эклиптики на ΔL = (долгота солнца по календарю) − (настоящая долгота солнца): углы между
// телами (фазы, затмения, удаление от солнца) не меняются, сдвигается только «где на небе». Звёзды — в той же системе неба.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const O = E.orbit, PL = E.planet;
  if (!O || !PL) { console.warn('system.js: нужны orbit.js и planet.js раньше'); return; }
  const m = O.m, sqrt = Math.sqrt, abs = Math.abs, floor = Math.floor, PI = m.PI, TAU = m.TAU, DEG = O.DEG, G0 = O.G0;

  // ═══ «Система Денчика» (план §1.3; имена — решение владельца 22.10: сначала Луна и Песчаная, остальные — заготовки stub:
  //     в данных есть (орбиты, проверки), в небе и на карте не показываются, пока владелец не утвердит имена и состав) ═══
  const YEAR = 365.25 * 86400, A_HOME = 4.0e9;
  const SUN = { id: 'sun', title: 'Солнце', type: 'star', radius: .0047 * A_HOME,   // угловой радиус с родной — как диск в небе (0,0047)
    mu: TAU * TAU * A_HOME * A_HOME * A_HOME / (YEAR * YEAR), color: '#fff3d8', lum: 1 };   // μ — из года родной: 365,25 суток на 4·10⁹ u
  const LUNA = {
    v: 2, id: 'luna', title: 'Луна', type: 'moon', system: 'home', hero: true, seed: 3701, radius: 32000, g: .4, surface: 'solid', sea: null,
    gen: 'moon1', relief: { amp: 1800, craters: 1, maria: .3 }, air: null, atmo: null, temp: { mean: -30, dayAmp: 120, latAmp: 20 },
    climate: { kinds: ['vacuum'], storm: null }, day: 16800, phase: 0, tilt: 1.5, locked: true,
    // a — по Кеплеру для периода 16 800 с у μ родной (план §1.1: 10,9 радиуса, видна 2,6°). Наклон 15°: Луна близко (тень родной
    // на её расстоянии — 10° неба), при 5° затмения были бы каждый оборот; с 15° — «сезоны затмений» дважды в год по ~6 недель
    // (тогда — почти каждое полнолуние и новолуние), узел 120° — сезон идёт в конце октября 2026
    orbit: { parent: 'home', a: 1398144, e: .012, i: 15, node: 120, peri: 112, M0: 63, epoch: 0 }, rails: 'kepler', moons: [],
    resources: [{ id: 'regolith', where: 'surface', k: 1 }, { id: 'he3', where: 'maria', k: .3 }, { id: 'ice', where: 'polar_craters', k: .4 }, { id: 'titanium', where: 'maria', k: .3 }],
    hazards: ['vacuum', 'cold', 'heat', 'small_impacts'], danger: 1, age: 6, meteors: { rate: 6, big: 2 },
    terra: { on: true, vars0: { p: 0, o2: 0, t: -30, w: .02, b: 0, x: 0 } }, look: { color: '#cfcfcf', albedo: .14, maria: .3 },
  };
  const DESERT = {
    v: 2, id: 'desert', title: 'Песчаная', type: 'desert', system: 'home', hero: true, seed: 4242, radius: 64000, g: .6, surface: 'solid',
    sea: null, gen: 'desert1', relief: { amp: 3200, dunes: 40, canyons: .6, craters: .3 },
    air: { p: 6, o2: 0, co2: .95, n2: .03, toxic: 0, dust: .4 }, atmo: { top: 16000, Hr: 2000, Hm: 900, tint: '#d08a5a' },
    temp: { mean: -40, dayAmp: 35, latAmp: 30 }, climate: { kinds: ['dust', 'polar'], storm: 'dust' }, day: 2600, phase: 40, tilt: 25, locked: false,
    orbit: { parent: 'sun', a: 6.0e9, e: .06, i: 1.8, node: 49, peri: 286, M0: 189, epoch: 0 }, rails: 'kepler', moons: ['phob', 'deim'],
    resources: [{ id: 'iron_ox', where: 'surface', k: 1 }, { id: 'ice', where: 'poles|buried', k: .6 }, { id: 'rare_earth', where: 'canyons', k: .2 }],
    hazards: ['thin_air', 'cold', 'dust_storm'], danger: 1, age: 6, meteors: { rate: 1, big: 1 },
    terra: { on: true, vars0: { p: 6, o2: 0, t: -40, w: .05, b: 0, x: 0 } }, regions: [{ id: 'port', lat: 4, lon: 10, kind: 'spaceport' }],
    games: { kubomir: { palette: 'red_sand', size: 512 }, podzem: { tiles: 'mars', width: 4200 } }, look: { color: '#d9895a', albedo: .25 },
  };
  // заготовки (stub): числа плана §1.3, имена — предложение (ждут владельца)
  const st = (o) => ({ v: 2, system: 'home', stub: true, age: 6, ...o });
  const STUBS = [
    st({ id: 'phob', title: 'Фоб', type: 'aster', radius: 1800, g: .002, orbit: { parent: 'desert', a: 553500, e: .015, i: 1, node: 12, peri: 40, M0: 10 }, look: { color: '#8a7a6a', albedo: .07 } }),
    st({ id: 'deim', title: 'Дейм', type: 'aster', radius: 1200, g: .0015, orbit: { parent: 'desert', a: 1064000, e: .0003, i: 1.8, node: 24, peri: 300, M0: 200 }, look: { color: '#8f8070', albedo: .07 } }),
    st({ id: 'lava', title: 'Огненная', type: 'lava', radius: 48000, g: .5, locked: true, tilt: 0, air: null, atmo: null,
      orbit: { parent: 'sun', a: 1.6e9, e: .03, i: 3.4, node: 76, peri: 54, M0: 120 }, look: { color: '#7a3424', albedo: .1 } }),
    st({ id: 'toxic', title: 'Ядовитая', type: 'toxic', radius: 120000, g: .9, day: 28800, tilt: 177, air: { p: 9000, co2: .96, n2: .03, toxic: .6, dust: .1 },
      orbit: { parent: 'sun', a: 2.8e9, e: .007, i: 3.4, node: 77, peri: 55, M0: 250 }, look: { color: '#e8d9a0', albedo: .7 } }),
    st({ id: 'giant', title: 'Великан', type: 'gas', radius: 900000, g: 2.0, surface: 'none', day: 1800, tilt: 3, air: { p: 101, toxic: 0, dust: 0 },
      orbit: { parent: 'sun', a: 1.6e10, e: .048, i: 1.3, node: 100, peri: 274, M0: 20 }, rings: { inner: 1.3e6, outer: 2.3e6, tint: '#c9b48a', alpha: .55 },
      moons: ['icy', 'oceania'], look: { color: '#d8b98e', albedo: .5 } }),
    st({ id: 'icy', title: 'Ледяная', type: 'ice', radius: 40000, g: .3, locked: true, tilt: 0, air: null, atmo: null,
      orbit: { parent: 'giant', a: 4.0e6, e: .004, i: .5, node: 30, peri: 80, M0: 0 }, look: { color: '#e6f0f7', albedo: .8 } }),
    st({ id: 'oceania', title: 'Океания', type: 'ocean', radius: 70000, g: .7, locked: true, tilt: 0, sea: 0, air: { p: 150, o2: 0, co2: .3, n2: .6, toxic: 0, dust: .2 },
      orbit: { parent: 'giant', a: 7.0e6, e: .01, i: .3, node: 140, peri: 10, M0: 90 }, look: { color: '#3d6f9a', albedo: .3 } }),
    st({ id: 'belt', title: 'Пояс', type: 'belt', radius: 500, g: 0, belt: { a: 8.5e9, width: 1.2e9, density: 1 } }),
  ];
  const HOME = { v: 1, id: 'home', title: 'Система Денчика', star: SUN, bodies: [PL.HOME, LUNA, DESERT, ...STUBS] };

  // ═══ Повороты (матрицы 3×3 по строкам, без мусора) ═══
  const mul3 = (A, B, out) => {   // out = A·B (out может совпадать с A или B)
    const a0 = A[0], a1 = A[1], a2 = A[2], a3 = A[3], a4 = A[4], a5 = A[5], a6 = A[6], a7 = A[7], a8 = A[8];
    const b0 = B[0], b1 = B[1], b2 = B[2], b3 = B[3], b4 = B[4], b5 = B[5], b6 = B[6], b7 = B[7], b8 = B[8];
    out[0] = a0 * b0 + a1 * b3 + a2 * b6; out[1] = a0 * b1 + a1 * b4 + a2 * b7; out[2] = a0 * b2 + a1 * b5 + a2 * b8;
    out[3] = a3 * b0 + a4 * b3 + a5 * b6; out[4] = a3 * b1 + a4 * b4 + a5 * b7; out[5] = a3 * b2 + a4 * b5 + a5 * b8;
    out[6] = a6 * b0 + a7 * b3 + a8 * b6; out[7] = a6 * b1 + a7 * b4 + a8 * b7; out[8] = a6 * b2 + a7 * b5 + a8 * b8;
    return out;
  };
  // поворот вокруг +Y: долгота растёт на b (долгота = atan2(−z, x)): x' = x cos b + z sin b, z' = z cos b − x sin b
  const rotLon = (b, out) => { const s = m.sin(b), c = m.cos(b); out[0] = c; out[1] = 0; out[2] = s; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = -s; out[7] = 0; out[8] = c; return out; };
  // наклон оси: поворот вокруг +X на ε (полюс эклиптики (0, 1, 0) → (0, cos ε, sin ε))
  const rotX = (e, out) => { const s = m.sin(e), c = m.cos(e); out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = c; out[5] = -s; out[6] = 0; out[7] = s; out[8] = c; return out; };
  const apply = (M, x, y, z, out, k = 0) => { out[k] = M[0] * x + M[1] * y + M[2] * z; out[k + 1] = M[3] * x + M[4] * y + M[5] * z; out[k + 2] = M[6] * x + M[7] * y + M[8] * z; return out; };
  const applyT = (M, x, y, z, out, k = 0) => { out[k] = M[0] * x + M[3] * y + M[6] * z; out[k + 1] = M[1] * x + M[4] * y + M[7] * z; out[k + 2] = M[2] * x + M[5] * y + M[8] * z; return out; };
  const lonOf = (x, z) => m.atan2(-z, x);
  // фаза «как у шара по Ламберту» (доля блеска полного диска при угле фазы a)
  const lambertPhase = a => ((PI - a) * m.cos(a) + m.sin(a)) / PI;

  // ═══ Система ═══
  function create(cat = HOME, o = {}){
    const S = { id: cat.id || 'sys', title: cat.title || 'Система', list: [], byId: new Map(), belts: [], tAt: NaN };
    const s0 = cat.star || SUN;
    const star = S.star = { id: s0.id || 'sun', title: s0.title || 'Солнце', type: 'star', isStar: true, R: +s0.radius || 1e7, mu: +s0.mu || 1e15,
      color: s0.color || '#fff3d8', lum: +s0.lum || 1, kids: [], parent: null, soi: Infinity, i: -1, el: null, top: 0 };
    S.byId.set(star.id, star);
    // профили → тела; родитель — раньше детей (несколько проходов: порядок в каталоге любой)
    let left = (cat.bodies || []).map(p => PL.def(p));
    for (let pass = 0; pass < 16 && left.length; pass++) {
      const next = [];
      for (const D of left) {
        if (D.type === 'belt') { if (D.belt) S.belts.push({ id: D.id, title: D.title, def: D, stub: D.stub, ...D.belt }); continue; }
        if (!D.orbit) { console.warn('система: у тела нет орбиты', D.id); continue; }
        const par = S.byId.get(D.orbit.parent);
        if (!par) { next.push(D); continue; }
        if (S.byId.has(D.id)) { console.warn('система: id повторяется', D.id); continue; }
        const b = { id: D.id, i: S.list.length, def: D, title: D.title, type: D.type, stub: D.stub, parent: par, kids: [], R: D.radius, mu: D.g * G0 * D.radius * D.radius,
          top: D.atmo ? D.atmo.top : 0, rails: D.rails, look: D.look || {}, el: null, T: 0, soi: 0, isStar: false };
        // рельсы: Кеплер — период из μ родителя; «украшение» (visual) — свой период (μ под него)
        let mu = par.mu;
        if (D.rails === 'visual' && D.orbit.period > 0) { const a = abs(D.orbit.a), T = D.orbit.period; mu = TAU * TAU * a * a * a / (T * T); }
        b.el = O.el(D.orbit, mu);
        b.T = b.el.T;
        b.soi = D.rails === 'visual' ? 0 : O.soi(D.orbit.a, b.mu, par.mu);
        // с приливным захватом сутки = период обращения; год тела без своего — год планеты, вокруг которой оно
        if (D.locked) D.day = b.T;
        par.kids.push(b); S.list.push(b); S.byId.set(b.id, b);
      }
      left = next;
    }
    for (const D of left) console.warn('система: нет родителя', D.id, D.orbit && D.orbit.parent);
    for (const b of S.list) if (!(b.def.year === 'calendar' || b.def.year > 0)) { let a = b; while (a.parent && !a.parent.isStar) a = a.parent; b.def.year = a.T; }
    const n = S.list.length;
    S.pos = new Float64Array(3 * n); S.vel = new Float64Array(3 * n);
    const T6 = new Float64Array(6);
    // все тела в момент t: родитель раньше детей → своё = родитель + рельсы
    S.at = t => {
      if (t === S.tAt) return S;
      for (let k = 0; k < n; k++) {
        const b = S.list[k], p = b.parent, j = 3 * k;
        O.state(b.el, t, T6);
        if (p.isStar) { S.pos[j] = T6[0]; S.pos[j + 1] = T6[1]; S.pos[j + 2] = T6[2]; S.vel[j] = T6[3]; S.vel[j + 1] = T6[4]; S.vel[j + 2] = T6[5]; }
        else { const q = 3 * p.i; S.pos[j] = S.pos[q] + T6[0]; S.pos[j + 1] = S.pos[q + 1] + T6[1]; S.pos[j + 2] = S.pos[q + 2] + T6[2]; S.vel[j] = S.vel[q] + T6[3]; S.vel[j + 1] = S.vel[q + 1] + T6[4]; S.vel[j + 2] = S.vel[q + 2] + T6[5]; }
      }
      S.tAt = t;
      return S;
    };
    const body = x => typeof x === 'string' ? S.byId.get(x) : x;
    S.body = body;
    S.posOf = (x, t, out = new Float64Array(3)) => { const b = body(x); if (!b || b.isStar) { out[0] = out[1] = out[2] = 0; return out; } S.at(t); const j = 3 * b.i; out[0] = S.pos[j]; out[1] = S.pos[j + 1]; out[2] = S.pos[j + 2]; return out; };
    S.velOf = (x, t, out = new Float64Array(3)) => { const b = body(x); if (!b || b.isStar) { out[0] = out[1] = out[2] = 0; return out; } S.at(t); const j = 3 * b.i; out[0] = S.vel[j]; out[1] = S.vel[j + 1]; out[2] = S.vel[j + 2]; return out; };
    // в чьей сфере влияния точка (оси системы): самое глубокое тело
    S.which = (p, t) => {
      S.at(t);
      let cur = star;
      for (let deep = 0; deep < 8; deep++) {
        let into = null;
        for (let q = 0; q < cur.kids.length; q++) {
          const k = cur.kids[q];
          if (!(k.soi > 0)) continue;
          const j = 3 * k.i, dx = p[0] - S.pos[j], dy = p[1] - S.pos[j + 1], dz = p[2] - S.pos[j + 2];
          if (dx * dx + dy * dy + dz * dz < k.soi * k.soi) { into = k; break; }
        }
        if (!into) break;
        cur = into;
      }
      return cur;
    };
    // какая доля диска солнца видна из точки p (оси системы): тела перед солнцем (кроме skipA, skipB) — затмения
    S.shadow = (p, t, skipA = null, skipB = null) => {
      S.at(t);
      const sx = -p[0], sy = -p[1], sz = -p[2], ds = sqrt(sx * sx + sy * sy + sz * sz);
      if (!(ds > star.R)) return 1;
      const as = m.asin(star.R / ds);
      let f = 1;
      for (let q = 0; q < n; q++) {
        const b = S.list[q];
        if (b === skipA || b === skipB || b.rails === 'visual') continue;
        const j = 3 * b.i, bx = S.pos[j] - p[0], by = S.pos[j + 1] - p[1], bz = S.pos[j + 2] - p[2], db = sqrt(bx * bx + by * by + bz * bz);
        const dot = bx * sx + by * sy + bz * sz;
        if (!(db < ds) || dot <= 0 || db <= b.R) continue;   // за солнцем, позади или точка внутри тела
        const cx = by * sz - bz * sy, cy = bz * sx - bx * sz, cz = bx * sy - by * sx;
        const sep = m.atan2(sqrt(cx * cx + cy * cy + cz * cz), dot), ab = m.asin(b.R / db);
        if (sep >= as + ab) continue;
        f *= O.disc(as, ab, sep);
      }
      return f;
    };

    // ── Система неба тела obs: F.M — поворот «оси системы → BF тела» (по строкам), F.sun — на солнце (оси системы, от тела) ──
    const MA = new Float64Array(9), MB = new Float64Array(9), MC = new Float64Array(9), BP = new Float64Array(9);
    S.frame = (x, t, ms, F = { M: new Float64Array(9), sun: new Float64Array(3), dL: 0, lcal: 0, ltrue: 0 }) => {
      const b = body(x), D = b.def;
      S.at(t);
      const j = 3 * b.i;
      let sx = -S.pos[j], sy = -S.pos[j + 1], sz = -S.pos[j + 2];
      const sl = sqrt(sx * sx + sy * sy + sz * sz); sx /= sl; sy /= sl; sz /= sl;
      F.sun[0] = sx; F.sun[1] = sy; F.sun[2] = sz;
      // плоскость года: орбита планеты (у луны — орбита её планеты вокруг звезды)
      let a = b; while (a.parent && !a.parent.isStar) a = a.parent;
      const W = a.el.W;
      // опорная ось в плоскости: линия узлов Y × W (у орбиты без наклона — +X)
      let nx = W[2], nz = -W[0];   // (0, 1, 0) × W = (W2, 0, −W0)
      const nl = sqrt(nx * nx + nz * nz);
      if (nl < 1e-12) { nx = 1; nz = 0; } else { nx /= nl; nz /= nl; }
      // строки BP: x_p = n, y_p = W, z_p = n × W
      BP[0] = nx; BP[1] = 0; BP[2] = nz;
      BP[3] = W[0]; BP[4] = W[1]; BP[5] = W[2];
      BP[6] = 0 * W[2] - nz * W[1]; BP[7] = nz * W[0] - nx * W[2]; BP[8] = nx * W[1] - 0 * W[0];
      const px = BP[0] * sx + BP[1] * sy + BP[2] * sz, pz = BP[6] * sx + BP[7] * sy + BP[8] * sz;
      const ltrue = lonOf(px, pz), lcal = (PL.seasonOf(D, ms) - .5) * PI / 2;
      const dL = D.year === 'calendar' ? lcal - ltrue : 0;   // небо с календарём — по календарю; иначе — как есть
      const L = D.year === 'calendar' ? lcal : ltrue;
      // солнце в экваториальной системе тела → прямое восхождение α; звёздное время θ = α − λs (λs — долгота под солнцем)
      const eps = D.tilt * DEG, sL = m.sin(L), cL = m.cos(L);
      const ex = cL, ez = -m.cos(eps) * sL;
      const alpha = lonOf(ex, ez), lam = D.phase * DEG - TAU * m.frac(t / D.day);
      const th = alpha - lam;
      // M = R_lon(−θ) · Rx(ε) · R_lon(ΔL) · BP
      mul3(rotLon(dL, MA), BP, MB);
      mul3(rotX(eps, MA), MB, MC);
      mul3(rotLon(-th, MA), MC, F.M);
      F.dL = dL; F.lcal = lcal; F.ltrue = ltrue; F.theta = th;
      return F;
    };

    // ── Небо: что видно из точки camBF (BF тела obs, от его центра) ──
    // out — список записей (переиспользуются): { b, d[3] (направление от камеры, BF), dist, rad (угловой радиус), cen[3] (центр тела от
    // центра obs, BF), sun[3] (от тела на солнце, BF), alpha (угол фазы), lit (доля освещённого диска), flux (блеск), light (доля солнца
    // у тела: затмения другими телами; тень obs — в шейдере), fwd[3], up[3] (оси тела, BF), kind ('body' | 'sun') }
    const FR = { M: new Float64Array(9), sun: new Float64Array(3) }, CP = new Float64Array(3), V3 = new Float64Array(3), HPIc = PI / 2;
    const entry = () => ({ b: null, kind: 'body', d: new Float64Array(3), dist: 0, rad: 0, cen: new Float64Array(3), sun: new Float64Array(3), alpha: 0, lit: 0, flux: 0, light: 1,
      fwd: new Float64Array(3), up: new Float64Array(3), wax: false });
    S.sky = (x, t, ms, camBF, out = [], o2 = {}) => {
      const ob = body(x), F = S.frame(ob, t, ms, o2.F || FR), M = F.M, jo = 3 * ob.i;
      const ox = S.pos[jo], oy = S.pos[jo + 1], oz = S.pos[jo + 2];
      // камера в осях системы
      applyT(M, camBF[0], camBF[1], camBF[2], CP);
      const cx = ox + CP[0], cy = oy + CP[1], cz = oz + CP[2];
      const rs = sqrt(ox * ox + oy * oy + oz * oz);
      let n = 0;
      for (let q = 0; q < S.list.length; q++) {
        const b = S.list[q];
        if (b === ob || (b.stub && !o2.stubs) || b.rails === 'visual') continue;
        const e = out[n] || (out[n] = entry()); n++;
        const j = 3 * b.i, rx = S.pos[j] - ox, ry = S.pos[j + 1] - oy, rz = S.pos[j + 2] - oz;
        e.b = b; e.kind = 'body';
        apply(M, rx, ry, rz, e.cen);
        const dx = e.cen[0] - camBF[0], dy = e.cen[1] - camBF[1], dz = e.cen[2] - camBF[2], dl = sqrt(dx * dx + dy * dy + dz * dz);
        e.dist = dl; e.d[0] = dx / dl; e.d[1] = dy / dl; e.d[2] = dz / dl;
        e.rad = dl > b.R ? m.asin(b.R / dl) : HPIc;
        // от тела на солнце
        const bx = S.pos[j], by = S.pos[j + 1], bz = S.pos[j + 2], bl = sqrt(bx * bx + by * by + bz * bz);
        apply(M, -bx / bl, -by / bl, -bz / bl, e.sun);
        // угол фазы: между «тело → солнце» и «тело → камера»
        const ca = -(e.sun[0] * e.d[0] + e.sun[1] * e.d[1] + e.sun[2] * e.d[2]);
        e.alpha = m.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca);
        e.lit = .5 * (1 + ca);
        const alb = +b.look.albedo || .2, k = b.R / dl, ks = rs / bl;
        e.flux = alb * k * k * ks * ks * lambertPhase(e.alpha);
        // затмения этого тела другими (кроме obs — тень obs рисует шейдер по точкам диска)
        V3[0] = bx; V3[1] = by; V3[2] = bz;
        e.light = S.shadow(V3, t, b, ob);
        // оси тела: захвачено приливом — «вперёд» к родителю, «вверх» — нормаль орбиты; иначе — вращение вокруг нормали
        const W = b.el.W;
        if (b.def.locked) { const pj = b.parent.isStar ? -1 : 3 * b.parent.i, qx = (pj < 0 ? 0 : S.pos[pj]) - bx, qy = (pj < 0 ? 0 : S.pos[pj + 1]) - by, qz = (pj < 0 ? 0 : S.pos[pj + 2]) - bz, ql = sqrt(qx * qx + qy * qy + qz * qz); apply(M, qx / ql, qy / ql, qz / ql, e.fwd); }
        else { const th = TAU * m.frac(t / b.def.day), P = b.el.P, Q = b.el.Q, c = m.cos(th), s = m.sin(th); apply(M, P[0] * c + Q[0] * s, P[1] * c + Q[1] * s, P[2] * c + Q[2] * s, e.fwd); }
        apply(M, W[0], W[1], W[2], e.up);
      }
      // солнце: направление (без параллакса), угловой радиус, сколько его закрыто (солнечное затмение — для света на земле)
      const e = out[n] || (out[n] = entry()); n++;
      e.b = star; e.kind = 'sun';
      apply(M, F.sun[0], F.sun[1], F.sun[2], e.d);
      e.dist = rs; e.rad = m.asin(star.R / rs);
      e.sun[0] = e.d[0]; e.sun[1] = e.d[1]; e.sun[2] = e.d[2];
      V3[0] = cx; V3[1] = cy; V3[2] = cz;
      e.light = S.shadow(V3, t, ob, null);
      e.alpha = 0; e.lit = 1; e.flux = 1;
      out.length = n;
      return out;
    };

    // ── Фаза спутника moon с тела obs (от центров): доля освещённого диска, угол фазы, растёт ли (долгота в плоскости года) ──
    const PH = { lit: 0, alpha: 0, wax: false, elong: 0 };
    S.phase = (x, y, t, out = PH) => {
      const ob = body(x), mo = body(y);
      S.at(t);
      const jo = 3 * ob.i, jm = 3 * mo.i;
      const mx = S.pos[jm] - S.pos[jo], my = S.pos[jm + 1] - S.pos[jo + 1], mz = S.pos[jm + 2] - S.pos[jo + 2], ml = sqrt(mx * mx + my * my + mz * mz);
      const bx = S.pos[jm], by = S.pos[jm + 1], bz = S.pos[jm + 2], bl = sqrt(bx * bx + by * by + bz * bz);
      // угол фазы: «луна → солнце» и «луна → наблюдатель»
      const ca = ((-bx / bl) * (-mx / ml) + (-by / bl) * (-my / ml) + (-bz / bl) * (-mz / ml));
      out.alpha = m.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca);
      out.lit = .5 * (1 + ca);
      // растёт: долгота луны минус долгота солнца (с obs) — от 0 до π
      const ox = S.pos[jo], oz = S.pos[jo + 2];
      const dl = m.wrap(lonOf(mx, mz) - lonOf(-ox, -oz));
      out.wax = dl > 0; out.elong = dl;
      return out;
    };
    // ── Ближайшие события Луны: новолуние, полнолуние, солнечное и лунное затмения (от центров; поиск — по шагам + деление пополам) ──
    S.moonEvents = (x, y, t, o3 = {}) => {
      const ob = body(x), mo = body(y), syn = synodic(ob, mo), step = syn / 24, LUN = o3.lunations || 40;
      const dlAt = tt => S.phase(ob, mo, tt, PH).elong;   // −π…π, растёт
      const find = (target, from) => {   // когда (dl − target) переходит через 0 снизу вверх
        let a = from, fa = m.wrap(dlAt(a) - target);
        for (let k = 0; k < 400; k++) {
          const b2 = a + step, fb = m.wrap(dlAt(b2) - target);
          if (fa < 0 && fb >= 0 && fb - fa < PI) { let lo = a, hi = b2; for (let q = 0; q < 40; q++) { const md = .5 * (lo + hi); if (m.wrap(dlAt(md) - target) < 0) lo = md; else hi = md; } return hi; }
          a = b2; fa = fb;
        }
        return NaN;
      };
      const R = { newMoon: find(0, t), fullMoon: find(PI, t), solar: null, lunar: null };
      // затмения: у каждого из ближайших новолуний/полнолуний — насколько близко прошли тени (угол от центра тела obs)
      const SA = new Float64Array(3);
      let tn = R.newMoon, tf = R.fullMoon;
      for (let k = 0; k < LUN && (!R.solar || !R.lunar); k++) {
        if (!R.solar && tn === tn) { const ev = eclipseAt(ob, mo, tn, 'solar', SA); if (ev) R.solar = ev; tn = find(0, tn + step); }
        if (!R.lunar && tf === tf) { const ev = eclipseAt(ob, mo, tf, 'lunar', SA); if (ev) R.lunar = ev; tf = find(PI, tf + step); }
      }
      return R;
    };
    // синодический период (от новолуния до новолуния) — по средним движениям
    const synodic = (ob, mo) => { let a = ob; while (a.parent && !a.parent.isStar) a = a.parent; const n1 = TAU / mo.T, n2 = TAU / a.T; return TAU / abs(n1 - n2); };
    // затмение в момент около соединения: ищем наименьшее расстояние между осью тени и центром (±2 % синодического), тип
    function eclipseAt(ob, mo, tc, kind, SA){
      const win = synodic(ob, mo) * .02;
      const sep = tt => {   // угол (от центра obs) между луной и солнцем (solar) или точкой против солнца (lunar)
        S.at(tt);
        const jo = 3 * ob.i, jm = 3 * mo.i, mx = S.pos[jm] - S.pos[jo], my = S.pos[jm + 1] - S.pos[jo + 1], mz = S.pos[jm + 2] - S.pos[jo + 2];
        let sx = -S.pos[jo], sy = -S.pos[jo + 1], sz = -S.pos[jo + 2];
        if (kind === 'lunar') { sx = -sx; sy = -sy; sz = -sz; }
        const cx = my * sz - mz * sy, cy = mz * sx - mx * sz, cz = mx * sy - my * sx;
        return m.atan2(sqrt(cx * cx + cy * cy + cz * cz), mx * sx + my * sy + mz * sz);
      };
      let a = tc - win, b2 = tc + win;
      for (let k = 0; k < 48; k++) { const c1 = b2 - .6180339887498949 * (b2 - a), c2 = a + .6180339887498949 * (b2 - a); if (sep(c1) < sep(c2)) b2 = c2; else a = c1; }
      const tm = .5 * (a + b2), g = sep(tm);
      S.at(tm);
      const jo = 3 * ob.i, jm = 3 * mo.i;
      const dm = sqrt((S.pos[jm] - S.pos[jo]) ** 2 + (S.pos[jm + 1] - S.pos[jo + 1]) ** 2 + (S.pos[jm + 2] - S.pos[jo + 2]) ** 2);
      const ds = sqrt(S.pos[jo] ** 2 + S.pos[jo + 1] ** 2 + S.pos[jo + 2] ** 2), as = star.R / ds;   // угловой радиус солнца
      if (kind === 'solar') {
        // тень луны на теле obs: полутень радиусом Rm + dm·as, тень — Rm − dm·as (меньше нуля — кольцевое)
        const pen = (ob.R + mo.R + dm * as) / dm, umb = (ob.R + mo.R - dm * as) / dm;
        if (g >= pen) return null;
        return { t: tm, kind: g < umb ? (mo.R - dm * as > 0 ? 'total' : 'annular') : 'partial', sep: g };
      }
      // лунное: тень obs на расстоянии луны — радиус тени Ro − dm·as, полутени Ro + dm·as
      const umb = ob.R - dm * as, pen = ob.R + dm * as;
      if (g * dm >= pen + mo.R) return null;
      return { t: tm, kind: g * dm < umb - mo.R ? 'total' : g * dm < umb + mo.R ? 'partial' : 'penumbral', sep: g };
    }
    // ── Точки орбиты тела (оси системы, от центра родителя): n точек по эксцентрической аномалии ──
    S.orbitPath = (x, n = 128, out = new Float64Array(3 * n)) => {
      const b = body(x), el = b.el, P = el.P, Q = el.Q;
      for (let k = 0; k < n; k++) {
        const EE = TAU * k / n, c = m.cos(EE), s = m.sin(EE), px = el.a * (c - el.e), py = el.b * s;
        out[3 * k] = px * P[0] + py * Q[0]; out[3 * k + 1] = px * P[1] + py * Q[1]; out[3 * k + 2] = px * P[2] + py * Q[2];
      }
      return out;
    };
    S.synodic = (x, y) => synodic(body(x), body(y));
    return S;
  }

  // «Золотые» значения системы: O.m и рельсы (O.golden) + положения всех тел и небо родной в 40 моментов → свёртка битов
  function golden(){
    const g = O.golden(), S = create(HOME), dv = new DataView(new ArrayBuffer(8));
    let h = parseInt(g.hash.slice(0, 8), 16) >>> 0, n = g.n;
    const mix = v => { dv.setFloat64(0, v); for (let k = 0; k < 8; k++) h = Math.imul(h ^ dv.getUint8(k), 16777619) >>> 0; n++; };
    const F = { M: new Float64Array(9), sun: new Float64Array(3) };
    for (let k = 0; k < 40; k++) {
      const t = 2.5e7 + k * 7919.37, ms = O.EPOCH_MS + t * 1000;
      S.at(t); for (let j = 0; j < S.pos.length; j++) mix(S.pos[j]);
      S.frame('home', t, ms, F); for (let j = 0; j < 9; j++) mix(F.M[j]);
    }
    return { hash: g.hash + '-' + h.toString(16).padStart(8, '0'), n, ver: g.ver };
  }
  E.system = { HOME, SUN, LUNA, DESERT, STUBS, create, golden, mul3, rotLon, rotX, apply, applyT, lambertPhase };
  E.orbitGolden = golden;
})();

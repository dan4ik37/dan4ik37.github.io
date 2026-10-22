// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — небесная механика (D37E.orbit): планеты, луны, спутники и корабли «на рельсах» Кеплера. Положение тела —
//  чистая функция времени мира: у всех игроков одно и то же небо без сети. ОБЩИЙ модуль для всех игр (план —
//  docs/plans/planet-space.md §2, T-079 PS-1). Без three.js и DOM: страница, поток, node (scripts/orbit-test.cjs), сервер.
// ═══════════════════════════════════════
// Единицы — движка: длина u (1 м = E.UNIT ≈ 1,17 u), время — секунды, μ = g·G0·R² (u³/с², G0 = 20·U — тяжесть player.js).
// Время мира t — секунды от O.EPOCH_MS (2026-01-01 00:00 UTC), см. D37E.clock (js/engine/clock.js).
// Оси — движка: Y — полюс плоскости отсчёта (эклиптика системы = плоскость орбиты родной планеты), долгота растёт от +X к −Z
// (как в planet.js: lon = atan2(−z, x)); орбита с наклоном < 90° идёт против часовой, если смотреть с +Y.
// Элементы орбиты: { a (u; гипербола — a < 0), e, i, node (Ω), peri (ω), M0 (средняя аномалия в epoch), epoch (с) } — в профилях
// углы в ГРАДУСАХ (O.el), внутри — в радианах (O.elRad).
// ОДИНАКОВОСТЬ: в рельсах, прогнозе и перелётах — только + − × ÷ √, floor/round/abs и O.m (свои многочлены вместо Math.sin/cos/
// atan2/exp/log/pow: у браузеров последний бит Math.sin разный). Результат — до бита одинаковый в Chrome, Safari, Firefox и node
// (проверка — «золотые» значения O.m в scripts/orbit-test.cjs и в Chrome: scripts/planet-perf.cjs golden). Углы держать
// маленькими (O.m.frac / O.m.wrap): приведение sin/cos точное до |x| < 1,6·10⁶.
//   O.m — sin cos sincos atan atan2 asin acos exp log log1p sinh cosh asinh acosh atanh pow frac wrap
//   O.el(spec°, μ) / O.elRad(…) — элементы (период из μ); O.state(el, t, out6) — положение и скорость; O.pos(el, t, out3)
//   O.fromState(μ, r, v, t, el) — элементы по состоянию (эллипс, гипербола, круговые и экваториальные)
//   O.uv(μ, r0, v0, dt, out6) — универсальные переменные (любой конус: корабли)
//   O.crossTime(el, t0, r, dir) — когда орбита пересечёт радиус r (dir +1 наружу, −1 внутрь)
//   O.hohmann(μ, r1, r2) · O.lambert(μ, r1, r2, tof, prograde, out) — перелёты
//   O.soi(a, μ, μParent) — сфера влияния · O.disc(rs, rb, d) — какая доля диска солнца видна из-за диска тела
//   O.predict(sys, ship, t, horizon, out) — путь по кускам конусов через сферы влияния (sys — D37E.system.create)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const sqrt = Math.sqrt, floor = Math.floor, abs = Math.abs, round = Math.round, min = Math.min, max = Math.max, ceil = Math.ceil;

  // ═══ O.m — своя математика: только базовые операции IEEE (каждая округляется одинаково везде) ═══
  const PI = 3.141592653589793, TAU = 6.283185307179586, HPI = 1.5707963267948966, QPI = .7853981633974483;
  // π/2 = P1 + P2 + P3: у P1 и P2 по 33 значащих бита (k·P1, k·P2 точны при |k| < 2^20) — приведение Коди — Уэйта
  const INV_HPI = .6366197723675814, P1 = 1.5707963267341256, P2 = 6.077100506303966e-11, P3 = 2.0222662487959506e-21;
  // ln 2 = LN2_HI + LN2_LO (у LN2_HI 33 бита: k·LN2_HI точно при |k| ≤ 1075)
  const INV_LN2 = 1.4426950408889634, LN2_HI = .6931471804855391, LN2_LO = 7.440617110012397e-11, LN2 = .6931471805599453;
  // 2^(i − 1074): степени двойки — умножением на 2 (точно), для exp и для показателя в log
  const POW2 = new Float64Array(2098);
  { let v = 1; POW2[1074] = 1; for (let i = 1075; i < 2098; i++) POW2[i] = v *= 2; v = 1; for (let i = 1073; i >= 0; i--) POW2[i] = v *= .5; }
  // ── sin, cos: ряд Тейлора на |r| ≤ π/4 (sin до r^17, cos до r^18; отброшенное < 10⁻¹⁹) ──
  const S1 = -1 / 6, S2 = 1 / 120, S3 = -1 / 5040, S4 = 1 / 362880, S5 = -1 / 39916800, S6 = 1 / 6227020800, S7 = -1 / 1307674368000, S8 = 1 / 355687428096000;
  const C2 = 1 / 24, C3 = -1 / 720, C4 = 1 / 40320, C5 = -1 / 3628800, C6 = 1 / 479001600, C7 = -1 / 87178291200, C8 = 1 / 20922789888000, C9 = -1 / 6402373705728000;
  const ksin = r => { const z = r * r; return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * (S6 + z * (S7 + z * S8))))))); };
  // cos: 1 − z/2 с поправкой на ошибку округления (w + ((1 − w) − hz)) — точнее у π/4
  const kcos = r => { const z = r * r, hz = .5 * z, w = 1 - hz; return w + (((1 - w) - hz) + z * z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * (C6 + z * (C7 + z * (C8 + z * C9)))))))); };
  const RQA = new Int32Array(1);   // четверть после приведения (0…3) — в типизированном массиве: запись числа в переменную модуля «упаковывает» его (мусор)
  function reduce(x){
    const k = round(x * INV_HPI);
    RQA[0] = k - 4 * floor(k / 4);
    return ((x - k * P1) - k * P2) - k * P3;
  }
  function sin(x){
    if (!(abs(x) <= 1e300)) return x - x;   // NaN, ±∞ → NaN
    if (x === 0) return x;   // ±0
    if (abs(x) <= QPI) return ksin(x);
    const r = reduce(x);
    const q = RQA[0]; return q === 0 ? ksin(r) : q === 1 ? kcos(r) : q === 2 ? -ksin(r) : -kcos(r);
  }
  function cos(x){
    if (!(abs(x) <= 1e300)) return x - x;
    if (abs(x) <= QPI) return kcos(x);
    const r = reduce(x);
    const q = RQA[0]; return q === 0 ? kcos(r) : q === 1 ? -ksin(r) : q === 2 ? -kcos(r) : ksin(r);
  }
  // оба сразу (одно приведение): out[0] = sin, out[1] = cos
  const SC = new Float64Array(2);
  function sincos(x, out = SC){
    if (!(abs(x) <= 1e300)) { out[0] = out[1] = x - x; return out; }
    let r = x, q = 0;
    if (abs(x) > QPI) { r = reduce(x); q = RQA[0]; }
    const s = ksin(r), c = kcos(r);
    if (q === 0) { out[0] = s; out[1] = c; } else if (q === 1) { out[0] = c; out[1] = -s; } else if (q === 2) { out[0] = -s; out[1] = -c; } else { out[0] = -c; out[1] = s; }
    return out;
  }
  // ── atan: atan(t) = atan(k/8) + atan(u), u = (t − k/8) / (1 + t·k/8), |u| ≤ 1/16 — ряд до u^13 ──
  const AT = [0, .12435499454676144, .24497866312686414, .35877067027057225, .4636476090008061, .5585993153435624, .6435011087932844, .7188299996216245, .7853981633974483];
  const A1 = -1 / 3, A2 = 1 / 5, A3 = -1 / 7, A4 = 1 / 9, A5 = -1 / 11, A6 = 1 / 13;
  function katan(t){   // 0 ≤ t ≤ 1
    const k = round(t * 8), c = k * .125, u = (t - c) / (1 + t * c), z = u * u;
    return AT[k] + (u + u * z * (A1 + z * (A2 + z * (A3 + z * (A4 + z * (A5 + z * A6))))));
  }
  function atan2(y, x){
    if (y !== y || x !== x) return NaN;
    const ay = abs(y), ax = abs(x);
    let a;
    if (ay === Infinity || ax === Infinity) a = ay === ax ? QPI : ay === Infinity ? HPI : 0;
    else if (ay <= ax) a = ax === 0 ? 0 : katan(ay / ax);
    else a = HPI - katan(ax / ay);
    if (x < 0 || (x === 0 && 1 / x < 0)) a = PI - a;
    return y < 0 || (y === 0 && 1 / y < 0) ? -a : a;
  }
  const atan = x => atan2(x, 1);
  // (1 − x)(1 + x) — точно у ±1 (1 − x без потерь)
  const asin = x => x >= 1 ? HPI : x <= -1 ? -HPI : x !== x ? NaN : atan2(x, sqrt((1 - x) * (1 + x)));
  const acos = x => x >= 1 ? 0 : x <= -1 ? PI : x !== x ? NaN : atan2(sqrt((1 - x) * (1 + x)), x);
  // ── exp: x = k·ln2 + r, |r| ≤ ln2/2, e^r — ряд до r^14 ──
  const E3 = 1 / 6, E4 = 1 / 24, E5 = 1 / 120, E6 = 1 / 720, E7 = 1 / 5040, E8 = 1 / 40320, E9 = 1 / 362880, E10 = 1 / 3628800, E11 = 1 / 39916800, E12 = 1 / 479001600, E13 = 1 / 6227020800, E14 = 1 / 87178291200;
  function exp(x){
    if (x !== x) return x;
    if (x > 709.782712893384) return Infinity;
    if (x < -745.1332191019412) return 0;
    const k = round(x * INV_LN2), r = (x - k * LN2_HI) - k * LN2_LO;
    const p = 1 + r * (1 + r * (.5 + r * (E3 + r * (E4 + r * (E5 + r * (E6 + r * (E7 + r * (E8 + r * (E9 + r * (E10 + r * (E11 + r * (E12 + r * (E13 + r * E14)))))))))))));
    if (k > 1023) return p * 2 * POW2[1023 + 1074];
    if (k < -1021) return (p * POW2[k + 1074 + 53]) * POW2[1074 - 53];   // мельче нормальных чисел — одно округление в конце
    return p * POW2[k + 1074];
  }
  // ── log: x = 2^k·m, m ∈ [√½, √2]; log(1 + f) = f − s·(f − R), s = f/(2 + f), R — ряд atanh (до s^24) ──
  const L1 = 2 / 3, L2 = 2 / 5, L3 = 2 / 7, L4 = 2 / 9, L5 = 2 / 11, L6 = 2 / 13, L7 = 2 / 15, L8 = 2 / 17, L9 = 2 / 19, L10 = 2 / 21, L11 = 2 / 23;
  function log1pK(f){   // −0,293 < f < 0,415, f — точное
    const s = f / (2 + f), z = s * s;
    const R = z * (L1 + z * (L2 + z * (L3 + z * (L4 + z * (L5 + z * (L6 + z * (L7 + z * (L8 + z * (L9 + z * (L10 + z * L11))))))))));
    return f - s * (f - R);
  }
  function log(x){
    if (!(x > 0)) return x === 0 ? -Infinity : NaN;
    if (x === Infinity) return x;
    let lo = 0, hi = 2097;   // показатель — двоичным поиском по степеням двойки (сравнения точные)
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (POW2[md] <= x) lo = md; else hi = md; }
    let k = lo - 1074, mm = x / POW2[lo];
    if (mm > 1.4142135623730951) { mm *= .5; k++; }
    return k * LN2_HI + (k * LN2_LO + log1pK(mm - 1));
  }
  const log1p = f => f > -.2928 && f < .4142 ? log1pK(f) : log(1 + f);
  function sinh(x){
    const ax = abs(x);
    if (ax < .25) { const z = x * x; return x + x * z * (S1 * -1 + z * (S2 + z * (-S3 + z * (S4 + z * (-S5 + z * S6))))); }
    const e = exp(ax), s = .5 * (e - 1 / e);
    return x < 0 ? -s : s;
  }
  const cosh = x => { const e = exp(abs(x)); return .5 * (e + 1 / e); };
  function asinh(x){
    const ax = abs(x);
    const r = ax > 1e150 ? log(ax) + LN2 : ax < .5 ? log1p(ax + ax * ax / (1 + sqrt(1 + ax * ax))) : log(ax + sqrt(ax * ax + 1));
    return x < 0 ? -r : r;
  }
  const acosh = x => x < 1 ? NaN : x > 1e150 ? log(x) + LN2 : log(x + sqrt((x - 1) * (x + 1)));
  // через |x| (у −1 иначе 1 + 2x/(1 − x) теряет знаки)
  const atanh = x => { const ax = abs(x); if (!(ax < 1)) return ax === 1 ? x * Infinity : NaN; const r = .5 * log1p(2 * ax / (1 - ax)); return x < 0 ? -r : r; };
  const pow = (x, y) => x > 0 ? exp(y * log(x)) : x === 0 ? (y > 0 ? 0 : y === 0 ? 1 : Infinity) : NaN;
  const frac = x => x - floor(x);
  const wrap = a => a - TAU * floor((a + PI) / TAU);   // [−π, π)
  const m = { VER: 1, PI, TAU, HPI, sin, cos, sincos, atan, atan2, asin, acos, exp, log, log1p, sinh, cosh, asinh, acosh, atanh, pow, sqrt, frac, wrap, LN2 };

  // ═══ Константы движка ═══
  const U = 2.1 / 1.8;          // = E.UNIT (core.js) — здесь своя копия: модуль работает и без ядра
  const G0 = 20 * U;            // тяжесть родной планеты (player.js: gravity 20·U)
  const DEG = PI / 180;
  const EPOCH_MS = 1767225600000;   // 2026-01-01T00:00:00Z — начало времени мира

  // ═══ Элементы и положение ═══
  const SC2 = new Float64Array(2);
  // элементы: углы в градусах (как в профилях), период — из μ
  function el(s, mu, out = {}){
    s = s || {};
    return elRad(+s.a || 0, +s.e || 0, (+s.i || 0) * DEG, (+s.node || 0) * DEG, (+s.peri || 0) * DEG, (+s.M0 || 0) * DEG, +s.epoch || 0, mu, out);
  }
  function elRad(a, e, i, node, peri, M0, epoch, mu, out = {}){
    out.mu = mu; out.a = a; out.e = e; out.i = i; out.node = node; out.peri = peri; out.M0 = M0; out.epoch = epoch;
    const hyp = out.hyp = e > 1, aa = abs(a);
    out.n = sqrt(mu / (aa * aa * aa));
    out.T = hyp ? Infinity : TAU / out.n;
    out.p = hyp ? aa * (e * e - 1) : a * (1 - e * e);
    out.b = hyp ? aa * sqrt(e * e - 1) : a * sqrt(1 - e * e);
    // перифокальные орты P (к перицентру), Q (по ходу), W (нормаль): формулы — в астрономических осях (Z — полюс),
    // в оси движка: (x, y, z)_движка = (X, Z, −Y)
    sincos(node, SC2); const so = SC2[0], co = SC2[1];
    sincos(peri, SC2); const sw = SC2[0], cw = SC2[1];
    sincos(i, SC2); const si = SC2[0], ci = SC2[1];
    const Px = co * cw - so * sw * ci, Py = so * cw + co * sw * ci, Pz = sw * si;
    const Qx = -co * sw - so * cw * ci, Qy = -so * sw + co * cw * ci, Qz = cw * si;
    const P = out.P || (out.P = new Float64Array(3)), Q = out.Q || (out.Q = new Float64Array(3)), W = out.W || (out.W = new Float64Array(3));
    P[0] = Px; P[1] = Pz; P[2] = -Py;
    Q[0] = Qx; Q[1] = Qz; Q[2] = -Qy;
    W[0] = so * si; W[1] = ci; W[2] = co * si;
    return out;
  }
  // средняя аномалия в момент t: эллипс — в [−π, π) (через долю периода: угол маленький и точный), гипербола — как есть
  const meanAt = (E1, t) => E1.hyp ? E1.M0 + E1.n * (t - E1.epoch) : wrap(E1.M0 + TAU * frac((t - E1.epoch) / E1.T));
  // уравнение Кеплера, эллипс: E − e·sin E = M (метод Галлея, 6 шагов при любом e < 1 — без «пока не сойдётся»)
  function kepE(M, e){
    let x = M + (M < 0 ? -.85 : .85) * e;   // старт Данби
    for (let k = 0; k < 6; k++) {
      sincos(x, SC2);
      const f = x - e * SC2[0] - M, f1 = 1 - e * SC2[1], f2 = e * SC2[0];
      x -= f / (f1 - .5 * f * f2 / f1);
    }
    return x;
  }
  // гипербола: e·sh H − H = M (Галлей, 10 шагов; старт — по логарифму)
  function kepH(M, e){
    const am = abs(M);
    let x = am < 1 ? M / max(e - 1, .1) : (M < 0 ? -1 : 1) * log(2 * am / e + 1.8);
    if (abs(x) > 700) x = x < 0 ? -700 : 700;
    for (let k = 0; k < 10; k++) {
      const ex = exp(x), sh = .5 * (ex - 1 / ex), ch = .5 * (ex + 1 / ex);
      const f = e * sh - x - M, f1 = e * ch - 1, f2 = e * sh;
      x -= f / (f1 - .5 * f * f2 / f1);
    }
    return x;
  }
  // положение и скорость в момент t (оси движка, относительно центра родителя): out = [x, y, z, vx, vy, vz]
  function state(E1, t, out = new Float64Array(6)){
    const e = E1.e, M = meanAt(E1, t);
    let x, y, vx, vy;
    if (!E1.hyp) {
      const EE = kepE(M, e); sincos(EE, SC2);
      const sE = SC2[0], cE = SC2[1], a = E1.a, k = E1.n * a / (1 - e * cE);
      x = a * (cE - e); y = E1.b * sE; vx = -k * sE; vy = k * (E1.b / a) * cE;
    } else {
      const H = kepH(M, e), ex = exp(H), sh = .5 * (ex - 1 / ex), ch = .5 * (ex + 1 / ex), aa = -E1.a, k = E1.n * aa / (e * ch - 1);
      x = aa * (e - ch); y = E1.b * sh; vx = -k * sh; vy = k * (E1.b / aa) * ch;
    }
    const P = E1.P, Q = E1.Q;
    out[0] = x * P[0] + y * Q[0]; out[1] = x * P[1] + y * Q[1]; out[2] = x * P[2] + y * Q[2];
    out[3] = vx * P[0] + vy * Q[0]; out[4] = vx * P[1] + vy * Q[1]; out[5] = vx * P[2] + vy * Q[2];
    return out;
  }
  // только положение (дешевле): out = [x, y, z]
  function pos(E1, t, out = new Float64Array(3)){
    const e = E1.e, M = meanAt(E1, t);
    let x, y;
    if (!E1.hyp) { const EE = kepE(M, e); sincos(EE, SC2); x = E1.a * (SC2[1] - e); y = E1.b * SC2[0]; }
    else { const H = kepH(M, e), ex = exp(H); x = -E1.a * (e - .5 * (ex + 1 / ex)); y = E1.b * .5 * (ex - 1 / ex); }
    const P = E1.P, Q = E1.Q;
    out[0] = x * P[0] + y * Q[0]; out[1] = x * P[1] + y * Q[1]; out[2] = x * P[2] + y * Q[2];
    return out;
  }
  // истинная аномалия в момент t
  function nuAt(E1, t){
    const e = E1.e, M = meanAt(E1, t);
    if (!E1.hyp) { const EE = kepE(M, e); sincos(EE, SC2); return atan2(sqrt(1 - e * e) * SC2[0], SC2[1] - e); }
    const H = kepH(M, e), ex = exp(H);
    return atan2(sqrt(e * e - 1) * .5 * (ex - 1 / ex), e - .5 * (ex + 1 / ex));
  }
  // средняя аномалия по истинной
  function meanOfNu(E1, nu){
    const e = E1.e; sincos(nu, SC2);
    if (!E1.hyp) { const EE = atan2(sqrt(1 - e * e) * SC2[0], e + SC2[1]); return EE - e * sin(EE); }
    const H = asinh(sqrt(e * e - 1) * SC2[0] / (1 + e * SC2[1]));
    return e * sinh(H) - H;
  }

  // ═══ Элементы по состоянию (Валладо RV2COE; все особые случаи — без NaN) ═══
  const EPS = 1e-11;
  function fromState(mu, r, v, t, out = {}){
    // в астрономические оси (Z — полюс): X = x, Y = −z, Z = y
    const X = r[0], Y = -r[2], Z = r[1], VX = v[0], VY = -v[2], VZ = v[1];
    const rm = sqrt(X * X + Y * Y + Z * Z), v2 = VX * VX + VY * VY + VZ * VZ, rv = X * VX + Y * VY + Z * VZ;
    const hx = Y * VZ - Z * VY, hy = Z * VX - X * VZ, hz = X * VY - Y * VX, hm = sqrt(hx * hx + hy * hy + hz * hz);
    const nx = -hy, ny = hx, nm = sqrt(nx * nx + ny * ny);   // линия узлов: K × h
    const c1 = v2 - mu / rm;
    const ex = (c1 * X - rv * VX) / mu, ey = (c1 * Y - rv * VY) / mu, ez = (c1 * Z - rv * VZ) / mu, e = sqrt(ex * ex + ey * ey + ez * ez);
    const xi = .5 * v2 - mu / rm, a = -mu / (2 * xi);
    const i = acos(hm > 0 ? hz / hm : 1);
    const ux = hx / hm, uy = hy / hm, uz = hz / hm;   // нормаль
    const circ = e < EPS, equ = nm < EPS * hm;
    // опорное направление в плоскости орбиты: линия узлов, у экваториальных — ось X
    const qx = equ ? 1 : nx, qy = equ ? 0 : ny, qz = 0;
    const node = equ ? 0 : atan2(ny, nx);
    // угол от опорного направления до вектора (wx, wy, wz) по ходу движения: atan2((q × w)·ĥ, q·w)
    const ang = (wx, wy, wz) => atan2((qy * wz - qz * wy) * ux + (qz * wx - qx * wz) * uy + (qx * wy - qy * wx) * uz, qx * wx + qy * wy + qz * wz);
    let peri, nu;
    if (!circ) {
      peri = ang(ex, ey, ez);
      // ν: от перицентра до r: atan2((e × r)·ĥ, e·r)
      nu = atan2((ey * Z - ez * Y) * ux + (ez * X - ex * Z) * uy + (ex * Y - ey * X) * uz, ex * X + ey * Y + ez * Z);
    } else { peri = 0; nu = ang(X, Y, Z); }   // круговая: перицентр — в опорном направлении, ν — аргумент широты
    const ee = circ ? 0 : e;
    out.hyp = ee > 1;
    let M;
    sincos(nu, SC2);
    if (ee < 1) { const EE = atan2(sqrt(1 - ee * ee) * SC2[0], ee + SC2[1]); M = EE - ee * sin(EE); }
    else { const H = asinh(sqrt(ee * ee - 1) * SC2[0] / (1 + ee * SC2[1])); M = ee * sinh(H) - H; }
    return elRad(a, ee, i, node, peri, M, t, mu, out);
  }

  // ═══ Универсальные переменные (любой конус) ═══
  const SCS = new Float64Array(2);
  // функции Штумпфа C(z), S(z): у малых |z| — ряд (без вычитания близких чисел), дальше — через половинный угол
  function stumpff(z, out = SCS){
    if (z > -1 && z < 1) {
      let c = 0, s = 0, t = 1, k = 0;
      // C = Σ (−z)^k / (2k+2)!, S = Σ (−z)^k / (2k+3)!  — 12 членов (|z| < 1: остаток < 10⁻²²)
      for (; k < 12; k++) { const a2 = 2 * k; c += t / FACT[a2 + 2]; s += t / FACT[a2 + 3]; t *= -z; }
      out[0] = c; out[1] = s; return out;
    }
    if (z > 0) { const q = sqrt(z), sh = sin(.5 * q); out[0] = 2 * sh * sh / z; out[1] = (q - sin(q)) / (z * q); return out; }
    const q = sqrt(-z), sh = sinh(.5 * q); out[0] = 2 * sh * sh / -z; out[1] = (sinh(q) - q) / (-z * q); return out;
  }
  const FACT = new Float64Array(32); { FACT[0] = 1; for (let k = 1; k < 32; k++) FACT[k] = FACT[k - 1] * k; }
  // r0, v0 → состояние через dt (Кёртис, алг. 3.3–3.4). Уравнение для χ монотонно (производная = r > 0): Ньютон внутри
  // «вилки» — шаг за вилку или не число → деление пополам; 64 шага всегда (одинаково везде). У эллипса dt — по модулю периода
  function uv(mu, r0, v0, dt, out = new Float64Array(6)){
    const r0m = sqrt(r0[0] * r0[0] + r0[1] * r0[1] + r0[2] * r0[2]), v02 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
    const vr0 = (r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2]) / r0m, alpha = 2 / r0m - v02 / mu, smu = sqrt(mu);
    const kA = r0m * vr0 / smu, kB = 1 - alpha * r0m;
    const Fx = x => { const z = alpha * x * x; stumpff(z, SCS); const x2 = x * x; return kA * x2 * SCS[0] + kB * x2 * x * SCS[1] + r0m * x - smu * dt; };
    let lo, hi;
    if (alpha > 1e-14) {
      const T = TAU / sqrt(mu * alpha * alpha * alpha); dt -= T * floor(dt / T);
      lo = 0; hi = TAU / sqrt(alpha);   // χ = √a·ΔE, ΔE ∈ [0, 2π)
    } else {   // гипербола и почти парабола: вилку раздвигаем удвоением
      const g = abs(smu * dt / r0m) + 1;
      if (dt >= 0) { lo = 0; hi = g; for (let k = 0; k < 80 && !(Fx(hi) > 0); k++) hi *= 2; }
      else { hi = 0; lo = -g; for (let k = 0; k < 80 && !(Fx(lo) < 0); k++) lo *= 2; }
    }
    // Ньютон с подстраховкой (как rtsafe): шаг за вилку или медленнее половины вилки — делим пополам
    let x = alpha > 1e-14 ? min(hi, max(lo, smu * alpha * dt)) : .5 * (lo + hi), dxo = hi - lo, dx = dxo;
    for (let k = 0; k < 80; k++) {
      const z = alpha * x * x; stumpff(z, SCS);
      const C = SCS[0], S = SCS[1], x2 = x * x;
      const F = kA * x2 * C + kB * x2 * x * S + r0m * x - smu * dt, dF = kA * x * (1 - z * S) + kB * x2 * C + r0m;
      if (F > 0) hi = x; else lo = x;
      if (!(((x - hi) * dF - F) * ((x - lo) * dF - F) <= 0) || !(abs(2 * F) <= abs(dxo * dF))) { dxo = dx; dx = .5 * (hi - lo); x = lo + dx; }
      else { dxo = dx; dx = F / dF; x -= dx; }
    }
    const z = alpha * x * x; stumpff(z, SCS);
    const C = SCS[0], S = SCS[1], x2 = x * x;
    const f = 1 - x2 / r0m * C, g = dt - x2 * x / smu * S;
    const rx = f * r0[0] + g * v0[0], ry = f * r0[1] + g * v0[1], rz = f * r0[2] + g * v0[2], rm = sqrt(rx * rx + ry * ry + rz * rz);
    const fd = smu / (rm * r0m) * (alpha * x2 * x * S - x), gd = 1 - x2 / rm * C;
    out[0] = rx; out[1] = ry; out[2] = rz;
    out[3] = fd * r0[0] + gd * v0[0]; out[4] = fd * r0[1] + gd * v0[1]; out[5] = fd * r0[2] + gd * v0[2];
    return out;
  }

  // ═══ Перелёты ═══
  // Гоман: круговая r1 → круговая r2 — два импульса и время в пути (полвитка переходного эллипса)
  function hohmann(mu, r1, r2){
    const at = (r1 + r2) / 2, v1 = sqrt(mu / r1), v2 = sqrt(mu / r2), vp = sqrt(mu * (2 / r1 - 1 / at)), va = sqrt(mu * (2 / r2 - 1 / at));
    const dv1 = vp - v1, dv2 = v2 - va;
    return { a: at, dv1, dv2, dv: abs(dv1) + abs(dv2), tof: PI * sqrt(at * at * at / mu) };
  }
  // Ламберт (универсальные переменные, Кёртис алг. 5.2): из r1 в r2 за tof; z — делением пополам (110 шагов, одинаково везде);
  // prograde — по ходу (против часовой с +Y). out: { ok, v1, v2, z }
  function lambert(mu, r1, r2, tof, prograde = true, out = {}){
    const r1m = sqrt(r1[0] * r1[0] + r1[1] * r1[1] + r1[2] * r1[2]), r2m = sqrt(r2[0] * r2[0] + r2[1] * r2[1] + r2[2] * r2[2]);
    const cy = r1[2] * r2[0] - r1[0] * r2[2];   // (r1 × r2)·Y
    const cd = (r1[0] * r2[0] + r1[1] * r2[1] + r1[2] * r2[2]) / (r1m * r2m);
    let dth = acos(cd < -1 ? -1 : cd > 1 ? 1 : cd);
    if (prograde ? cy < 0 : cy >= 0) dth = TAU - dth;
    const A = sin(dth) * sqrt(r1m * r2m / (1 - cos(dth))), smu = sqrt(mu);
    out.ok = false; out.v1 = out.v1 || new Float64Array(3); out.v2 = out.v2 || new Float64Array(3);
    if (!(abs(A) > 1e-9) || !(tof > 0)) return out;
    const yOf = z => { stumpff(z, SCS); return r1m + r2m + A * (z * SCS[1] - 1) / sqrt(SCS[0]); };
    const Fz = z => { const y = yOf(z); if (y < 0) return -Infinity; const C = SCS[0], S = SCS[1], yc = y / C; return yc * sqrt(yc) * S + A * sqrt(y) - smu * tof; };
    let lo = -4 * PI * PI, hi = 4 * PI * PI * (1 - 1e-12);
    for (let k = 0; k < 60 && Fz(lo) > 0; k++) lo *= 2;
    if (!(Fz(hi) > 0)) return out;   // за один виток не успеть (нужен многовитковый — не здесь)
    for (let k = 0; k < 110; k++) { const md = .5 * (lo + hi); if (Fz(md) > 0) hi = md; else lo = md; }
    const z = .5 * (lo + hi), y = yOf(z);
    if (!(y > 0)) return out;
    const f = 1 - y / r1m, g = A * sqrt(y / mu), gd = 1 - y / r2m;
    for (let j = 0; j < 3; j++) { out.v1[j] = (r2[j] - f * r1[j]) / g; out.v2[j] = (gd * r2[j] - r1[j]) / g; }
    out.ok = true; out.z = z;
    return out;
  }
  // сфера влияния (Лаплас): r = a·(m/M)^0,4
  const soi = (a, mu, muP) => abs(a) * pow(mu / muP, .4);
  // доля видимого диска солнца (радиус rs) за диском тела (rb), центры — на угловом расстоянии d (малые углы, плоско)
  function disc(rs, rb, d){
    if (!(rs > 0)) return 1;
    if (d >= rs + rb) return 1;
    if (d <= rb - rs) return 0;                    // тело закрыло всё солнце
    if (d <= rs - rb) return 1 - rb * rb / (rs * rs);   // кольцо: тело целиком на диске
    const a1 = (d * d + rs * rs - rb * rb) / (2 * d * rs), a2 = (d * d + rb * rb - rs * rs) / (2 * d * rb);
    const k = (-d + rs + rb) * (d + rs - rb) * (d - rs + rb) * (d + rs + rb);
    const A = rs * rs * acos(a1 < -1 ? -1 : a1 > 1 ? 1 : a1) + rb * rb * acos(a2 < -1 ? -1 : a2 > 1 ? 1 : a2) - .5 * sqrt(k > 0 ? k : 0);
    const f = 1 - A / (PI * rs * rs);
    return f < 0 ? 0 : f > 1 ? 1 : f;
  }

  // ═══ Когда орбита пересечёт радиус rc: dir +1 — наружу (после перицентра), −1 — внутрь; ближайший момент ≥ t0 или null ═══
  function crossTime(E1, t0, rc, dir){
    const e = E1.e;
    if (e < 1e-12) return null;   // круговая: радиус не меняется
    const c = (E1.p / rc - 1) / e;
    if (!(c >= -1 && c <= 1)) return null;   // не достаёт до rc (или всегда дальше)
    const nu = dir < 0 ? -acos(c) : acos(c), Mt = meanOfNu(E1, nu), Mc = meanAt(E1, t0);
    if (!E1.hyp) { let d = Mt - Mc; d -= TAU * floor(d / TAU); return t0 + d / E1.n; }
    return Mt >= Mc ? t0 + (Mt - Mc) / E1.n : null;
  }
  // наибольшая скорость на орбите (в перицентре)
  const vmax = E1 => { const rp = E1.hyp ? E1.p / (1 + E1.e) : E1.a * (1 - E1.e); return sqrt(E1.mu * (2 / rp - 1 / E1.a)); };

  // ═══ Прогноз пути по кускам конусов (патч-коники): ship = { body, r, v } в инерциальной системе тела (оси системы) ═══
  // Куски: { body, el, t0, t1, end: 'soi' | 'impact' | 'atmo' | 'horizon', next (тело дальше), r1, v1 (в конце куска) } — не больше 6
  const PS = new Float64Array(6), PK = new Float64Array(6), PB = new Float64Array(6);
  function relAt(E1, K, t){   // корабль относительно спутника K: PS — корабль, PK — спутник (оба — от центра тела)
    state(E1, t, PS); state(K.el, t, PK);
    const dx = PS[0] - PK[0], dy = PS[1] - PK[1], dz = PS[2] - PK[2], d = sqrt(dx * dx + dy * dy + dz * dz);
    REL.d = d; REL.rr = d > 0 ? (dx * (PS[3] - PK[3]) + dy * (PS[4] - PK[4]) + dz * (PS[5] - PK[5])) / d : 0;
    return REL;
  }
  const REL = { d: 0, rr: 0 };
  // первый момент в [tA, tB], когда корабль внутри сферы влияния K (шаг — чтобы не проскочить; минимум между выборками — тоже)
  function soiEntry(E1, K, tA, tB){
    if (!(tB > tA)) return null;
    const so = K.soi, step = max(so / (2 * (vmax(E1) + vmax(K.el)) + 1e-9), (tB - tA) / 2048);
    const n = min(2048, max(1, ceil((tB - tA) / step))), dt = (tB - tA) / n;
    let tP = tA, dP = relAt(E1, K, tA).d - so, rrP = REL.rr;
    let armed = dP > so * 1e-6;   // стоим на границе (только что вышли из неё) — ждём, пока отойдём
    if (dP < -so * 1e-6) return tA;
    const f = t => relAt(E1, K, t).d - so;
    const bisect = (a, b) => { for (let k = 0; k < 52; k++) { const c = .5 * (a + b); if (f(c) > 0) a = c; else b = c; } return b; };
    for (let k = 1; k <= n; k++) {
      const tk = k === n ? tB : tA + k * dt, dk = f(tk), rrk = REL.rr;
      if (!armed) { if (dk > so * 1e-6) armed = true; tP = tk; dP = dk; rrP = rrk; continue; }
      if (dk <= 0) return bisect(tP, tk);
      if (rrP < 0 && rrk > 0) {   // ближе всего — между выборками: золотое сечение
        let a = tP, b = tk;
        for (let j = 0; j < 40; j++) { const c1 = b - .6180339887498949 * (b - a), c2 = a + .6180339887498949 * (b - a); if (f(c1) < f(c2)) b = c2; else a = c1; }
        const tm = .5 * (a + b);
        if (f(tm) <= 0) return bisect(tP, tm);
      }
      tP = tk; dP = dk; rrP = rrk;
    }
    return null;
  }
  function predict(sys, ship, t, horizon, out = [], o = {}){
    let B = typeof ship.body === 'string' ? sys.byId.get(ship.body) : ship.body;
    const r = [ship.r[0], ship.r[1], ship.r[2]], v = [ship.v[0], ship.v[1], ship.v[2]], tEnd = t + horizon, MAXS = o.max || 6;
    let t0 = t, n = 0;
    while (B && n < MAXS) {
      const sg = out[n] || (out[n] = { body: null, el: {}, t0: 0, t1: 0, end: '', next: null, r1: new Float64Array(3), v1: new Float64Array(3) });
      sg.body = B; fromState(B.mu, r, v, t0, sg.el); sg.t0 = t0;
      let t1 = tEnd, end = 'horizon', next = null;
      const rm = sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]), Rt = (B.R || 0) + (B.top || 0);
      if (!B.isStar && rm <= Rt) { t1 = t0; end = B.top && rm > B.R ? 'atmo' : 'impact'; }
      else {
        if (Rt > 0) { const ti = crossTime(sg.el, t0, Rt, -1); if (ti !== null && ti <= t1) { t1 = ti; end = B.top ? 'atmo' : 'impact'; } }
        if (!B.isStar && B.parent) { const tx = crossTime(sg.el, t0, B.soi, 1); if (tx !== null && tx < t1) { t1 = tx; end = 'soi'; next = B.parent; } }
        for (const K of B.kids) { if (!K.el || K.rails === 'visual') continue; const te = soiEntry(sg.el, K, t0, t1); if (te !== null && te < t1) { t1 = te; end = 'soi'; next = K; } }
      }
      sg.t1 = t1; sg.end = end; sg.next = next;
      state(sg.el, t1, PS);
      sg.r1[0] = PS[0]; sg.r1[1] = PS[1]; sg.r1[2] = PS[2]; sg.v1[0] = PS[3]; sg.v1[1] = PS[4]; sg.v1[2] = PS[5];
      n++;
      if (end !== 'soi' || t1 >= tEnd) break;
      if (next === B.parent) { state(B.el, t1, PB); for (let j = 0; j < 3; j++) { r[j] = PS[j] + PB[j]; v[j] = PS[j + 3] + PB[j + 3]; } }
      else { state(next.el, t1, PB); for (let j = 0; j < 3; j++) { r[j] = PS[j] - PB[j]; v[j] = PS[j + 3] - PB[j + 3]; } }
      B = next; t0 = t1;
    }
    out.length = n;
    return out;
  }

  // ═══ «Золотые» значения: тысячи вызовов O.m и рельсов → одна свёртка битов. Должна совпасть в node и во всех браузерах (число
  //     хранит scripts/orbit-test.cjs; в Chrome — scripts/planet-perf.cjs golden). Поменял O.m — новое число и O.m.VER + 1 ═══
  function golden(){
    const dv = new DataView(new ArrayBuffer(8));
    let h1 = 0x811c9dc5, h2 = 0x5bd1e995, n = 0;
    const mix = v => { dv.setFloat64(0, v); for (let k = 0; k < 8; k++) { const b = dv.getUint8(k); h1 = Math.imul(h1 ^ b, 16777619) >>> 0; h2 = Math.imul(h2 ^ b, 0x2545f491) >>> 0; } n++; };
    let s = 12345; const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let i = 0; i < 400; i++) {
      const x = (rnd() * 2 - 1) * 2000, y = rnd() * 2 - 1, z = rnd() * 2 - 1;
      mix(sin(x)); mix(cos(x)); sincos(x * .001, SC); mix(SC[0]); mix(SC[1]); mix(atan2(y, z)); mix(asin(y)); mix(acos(z));
      mix(exp((rnd() * 2 - 1) * 700)); mix(log(rnd() * 1e6 + 1e-300)); mix(log1p(y * .3)); mix(sinh(y * 5)); mix(cosh(z * 5)); mix(asinh(x)); mix(acosh(1 + abs(x)));
      mix(atanh(y * .999)); mix(pow(rnd() * 1e3, .4));
    }
    const S6 = new Float64Array(6);
    for (let i = 0; i < 60; i++) {
      const hyp = i % 3 === 0, E1 = elRad(hyp ? -(2e5 + rnd() * 1e6) : 2e5 + rnd() * 1e7, hyp ? 1.05 + rnd() * 3 : rnd() * .95, rnd() * 3, rnd() * 6, rnd() * 6, rnd() * 6 - 3, 0, 3.8e11);
      state(E1, rnd() * 1e5, S6); for (let k = 0; k < 6; k++) mix(S6[k]);
      uv(3.8e11, [S6[0], S6[1], S6[2]], [S6[3], S6[4], S6[5]], rnd() * 3e3, S6); for (let k = 0; k < 6; k++) mix(S6[k]);
    }
    return { hash: h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'), n, ver: m.VER };
  }

  E.orbit = { m, U, G0, DEG, EPOCH_MS, el, elRad, state, pos, nuAt, meanAt, meanOfNu, fromState, uv, stumpff, hohmann, lambert, soi, disc, crossTime, vmax, predict, golden,
    period: (a, mu) => TAU * sqrt(abs(a) * a * a / mu), aOf: (T, mu) => pow(mu * (T / TAU) * (T / TAU), 1 / 3) };
})();

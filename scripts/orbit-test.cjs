// Небесная механика движка (T-079, шаг PS-1; docs/plans/planet-space.md §1–2) без браузера: node scripts/orbit-test.cjs
// 1. O.m (своя математика): точность против эталона на BigInt (256 бит) в ULP, особые значения, «золотые» значения — до бита
//    (то же число — в Chrome: scripts/planet-perf.cjs golden)
// 2. Кеплер: уравнение (эллипс до e = 0,995, гипербола), рельсы против численного интегрирования (RK4), энергия и момент
// 3. Элементы ↔ состояние: эллипс, гипербола, круговые, экваториальные, обратные; универсальные переменные = рельсы
// 4. «Система Денчика»: профили v2, Кеплер у всех (T²·μ = 4π²·a³), сферы влияния вложены, числа плана (Луна, родная, Песчаная)
// 5. Перелёты: Гоман (НОО → Луна, на «неподвижную»), Ламберт (попадает в цель, совпадает с Гоманом)
// 6. Прогноз по кускам конусов: к Луне (вход в её сферу и пролёт), уход к солнцу, падение на Луну, вход в атмосферу; стыки
// 7. Небо: солнце системы = солнце планеты (календарь владельца), ΔL не меняет углов, фазы, затмения (солнечное и лунное)
// 8. Одинаковость: 30 / 60 / 144 кадра в секунду (шаг логики 1/60 с), порядок вызовов, новые экземпляры — до бита; без мусора
// 9. Точность вдали от центра: тела у 1,6·10¹⁰ и 10¹² u, 100 лет вперёд, картинка в float32 (как видеокарта)
// 10. Часы мира (clock.js): медиана трёх, RTT/2, planet.sql не запущен (PGRST202), нет сети, feed(), start/stop; свой сервер /time (T-145)
// 11. Скорость (телефон с ЦП ×4 — примерно ×4)
const path = require('path'), fs = require('fs'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
const ALLOC = process.argv.includes('--alloc');
for (const f of ['climate', 'planet', 'orbit', 'system', 'clock']) require(path.join(SITE, 'js/engine', f + '.js'));
const E = globalThis.D37E, O = E.orbit, m = O.m, PL = E.planet, SYS = E.system;
const TAU = 2 * Math.PI;

// ── «без мусора»: отдельный процесс без сборки молодого поколения ──
if (ALLOC) {
  const S = SYS.create(), st = new Float64Array(6), cam = new Float64Array([1000, 128500, -300]), out = [], F = { M: new Float64Array(9), sun: new Float64Array(3) };
  const el = S.byId.get('luna').el;
  const run = n => { for (let i = 0; i < n; i++) { const t = 2.5e7 + i * .0167; S.sky('home', t, O.EPOCH_MS + t * 1000, cam, out, { F }); O.state(el, t, st); S.phase('home', 'luna', t); } };
  run(300000);   // прогрев: оптимизирующий компилятор
  let best = Infinity;
  for (let k = 0; k < 4; k++) { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed; run(20000); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 20000); }
  // удержанное: после полной сборки куча не растёт (ничего не копится)
  global.gc(); global.gc(); const r0 = process.memoryUsage().heapUsed; run(100000); global.gc(); global.gc(); const kept = process.memoryUsage().heapUsed - r0;
  console.log(JSON.stringify({ perFrame: best, kept }));
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const len = v => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ═══ Эталон: BigInt с фиксированной точкой (300 бит) ═══
const FB = 300n, ONE = 1n << FB;
const bmul = (a, b) => (a * b) >> FB, bdiv = (a, b) => (a << FB) / b;
const bitlen = n => (n < 0n ? -n : n).toString(2).length;
function isqrt(n){ if (n < 2n) return n; let x = 1n << BigInt((bitlen(n) >> 1) + 1); for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; } }
function atanInv(x){ const X = BigInt(x), X2 = X * X; let term = ONE / X, sum = 0n, k = 0n; while (term !== 0n) { const t = term / (2n * k + 1n); sum += (k & 1n) ? -t : t; term /= X2; k++; } return sum; }
const BPI = 4n * (4n * atanInv(5) - atanInv(239)), BHPI = BPI >> 1n;
const BLN2 = (() => { let term = ONE / 3n, sum = 0n, k = 0n; while (term !== 0n) { sum += term / (2n * k + 1n); term /= 9n; k++; } return 2n * sum; })();
const DV = new DataView(new ArrayBuffer(8));
// double → точное BigInt (фиксированная точка); и обратно — с округлением до ближайшего
function toB(x){
  DV.setFloat64(0, x); const hi = DV.getUint32(0), lo = DV.getUint32(4), sign = hi >>> 31, ex = (hi >>> 20) & 2047;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
  if (ex === 0) e = -1074; else { mant |= 1n << 52n; e = ex - 1075; }
  let N = e + 300 >= 0 ? mant << BigInt(e + 300) : mant >> BigInt(-(e + 300));
  return sign ? -N : N;
}
const fromB = N => Number(N) / 2 ** 300;
function bsincos(N){   // → [sin, cos] (фикс.)
  const k = (N + (BHPI >> 1n)) / BHPI - (N < -(BHPI >> 1n) ? 1n : 0n);
  let r = N - k * BHPI;
  const r2 = bmul(r, r); let s = 0n, c = 0n, ts = r, tc = ONE, i = 1n;
  while (ts !== 0n || tc !== 0n) { s += ts; c += tc; ts = -bmul(ts, r2) / ((2n * i) * (2n * i + 1n)); tc = -bmul(tc, r2) / ((2n * i - 1n) * (2n * i)); i++; }
  const q = ((k % 4n) + 4n) % 4n;
  return q === 0n ? [s, c] : q === 1n ? [c, -s] : q === 2n ? [-s, -c] : [-c, s];
}
function bexp(N){   // e^x для |x| ≤ 745 (фикс.; результат — как [мантисса фикс., степень двойки])
  const k = N >= 0n ? (N + (BLN2 >> 1n)) / BLN2 : -((-N + (BLN2 >> 1n)) / BLN2);
  const r = N - k * BLN2; let sum = 0n, t = ONE, i = 1n;
  while (t !== 0n) { sum += t; t = bmul(t, r) / i; i++; }
  return [sum, Number(k)];
}
function blog(x){   // log для x > 0 (double) → фикс.
  DV.setFloat64(0, x); const ex = ((DV.getUint32(0) >>> 20) & 2047) - 1023;
  const mN = toB(x / 2 ** ex);   // m ∈ [1, 2) — точно
  const s = bdiv(mN - ONE, mN + ONE), s2 = bmul(s, s); let sum = 0n, t = s, i = 0n;
  while (t !== 0n) { sum += t / (2n * i + 1n); t = bmul(t, s2); i++; }
  return 2n * sum + BigInt(ex) * BLN2;
}
function batan(N){   // atan для N ≥ 0 (фикс.)
  let flip = false;
  if (N > ONE) { N = bdiv(ONE, N); flip = true; }
  let mlt = 1n;
  for (let h = 0; h < 3; h++) { N = bdiv(N, ONE + isqrt((ONE + bmul(N, N)) << FB)); mlt *= 2n; }
  const x2 = bmul(N, N); let sum = 0n, t = N, i = 0n;
  while (t !== 0n) { const q = t / (2n * i + 1n); sum += (i & 1n) ? -q : q; t = bmul(t, x2); i++; }
  sum *= mlt;
  return flip ? BHPI - sum : sum;
}
// ошибка в ULP: |ours − точное| / ulp(точного)
function ulpErr(ours, refN){
  const ref = fromB(refN);
  if (ref === 0) return ours === 0 ? 0 : Infinity;
  DV.setFloat64(0, ref); const ex = ((DV.getUint32(0) >>> 20) & 2047);
  const ulpN = ex === 0 ? toB(2 ** -1074) : toB(2 ** (ex - 1075));
  const d = toB(ours) - refN;
  return Number((d < 0n ? -d : d) * 1000n / ulpN) / 1000;
}

// ═══ 1. O.m ═══
sec('O.m: точность против эталона (BigInt), особые значения, «золотые» значения');
{
  const W = {};
  const up = (k, e) => { if (!(e <= (W[k] ?? -1))) W[k] = e; };
  for (let i = 0; i < 3000; i++) {
    const x = (rnd() * 2 - 1) * (i % 3 === 0 ? 1e5 : i % 3 === 1 ? 50 : 1.2);
    const [s, c] = bsincos(toB(x));
    up('sin', ulpErr(m.sin(x), s)); up('cos', ulpErr(m.cos(x), c));
    const sc = m.sincos(x, new Float64Array(2)); if (sc[0] !== m.sin(x) || sc[1] !== m.cos(x)) up('sincos≠', 1e9);
    const y = (rnd() * 2 - 1) * (i % 2 ? 1 : 1e4), z = (rnd() * 2 - 1) * (i % 5 ? 1 : 1e-3);
    // atan2: эталон по углу в нужной четверти
    { let a = batan(toB(Math.abs(y)) * ONE / toB(Math.abs(z)) === 0n ? 0n : bdiv(toB(Math.abs(y)), toB(Math.abs(z))));
      if (z < 0) a = BPI - a; if (y < 0) a = -a; up('atan2', ulpErr(m.atan2(y, z), a)); }
    const q = (rnd() * 2 - 1) * (i % 4 === 0 ? 700 : 20);
    { const [mn, k] = bexp(toB(q)); const ref = fromB(mn) * 2 ** k; if (ref > 1e-300 && ref < 1e300) { const ex = m.exp(q); up('exp', Math.abs(ex - ref) / (ref * 2 ** -52)); } }
    const lx = Math.exp((rnd() * 2 - 1) * 600);
    up('log', ulpErr(m.log(lx), blog(lx)));
    const u = rnd() * 2 - 1;
    { const [s2] = [bsincos(0n)]; void s2; }
    up('asin', ulpErr(m.asin(u), u >= 0 ? batan(bdiv(toB(u), isqrt((ONE - bmul(toB(u), toB(u))) << FB))) : -batan(bdiv(toB(-u), isqrt((ONE - bmul(toB(u), toB(u))) << FB)))));
  }
  console.log('  ULP наибольшая:', Object.entries(W).map(([k, v]) => `${k} ${v}`).join(' · '));
  ok(W.sin <= 2 && W.cos <= 2, 'sin, cos — до 2 ULP от точного (|x| до 10⁵; Math в браузерах — около 1)', W);
  ok(W.atan2 <= 2, 'atan2 — до 2 ULP', W.atan2);
  ok(W.exp <= 1.5 && W.log <= 1, 'exp до 1,5 ULP, log до 1 ULP', { exp: W.exp, log: W.log });
  ok(W.asin <= 3, 'asin — до 3 ULP', W.asin);
  ok(!W['sincos≠'], 'sincos = sin и cos по отдельности (до бита)');
  // против Math (для сводки: Math в разных браузерах — свой, у нас — одинаковый)
  let wm = 0; for (let i = 0; i < 20000; i++) { const x = (rnd() * 2 - 1) * 1000; wm = Math.max(wm, Math.abs(m.sinh(x / 100) - Math.sinh(x / 100)) / Math.abs(Math.sinh(x / 100)), Math.abs(m.asinh(x) - Math.asinh(x)) / Math.abs(Math.asinh(x)), Math.abs(m.atanh(x / 1001) - Math.atanh(x / 1001)) / Math.abs(Math.atanh(x / 1001))); }
  ok(wm < 2e-15, 'sinh, asinh, atanh — как Math (отн. < 2·10⁻¹⁵)', wm);
  // особые значения
  ok(Number.isNaN(m.sin(NaN)) && Number.isNaN(m.cos(Infinity)) && m.sin(0) === 0 && Object.is(m.sin(-0), -0) && m.cos(0) === 1, 'sin/cos: NaN, ∞, ±0');
  ok(m.atan2(0, -1) === Math.PI && m.atan2(-0, -1) === -Math.PI && m.atan2(1, 0) === Math.PI / 2 && m.atan2(0, 0) === 0 && m.atan2(Infinity, Infinity) === Math.PI / 4, 'atan2: оси, ±0, ∞');
  ok(m.exp(0) === 1 && m.exp(1000) === Infinity && m.exp(-1000) === 0 && m.exp(-745) > 0 && m.log(1) === 0 && m.log(0) === -Infinity && Number.isNaN(m.log(-1)), 'exp/log: края');
  ok(m.acos(1) === 0 && m.acos(-1) === Math.PI && m.asin(1) === Math.PI / 2 && Math.abs(m.acos(0) - Math.PI / 2) < 1e-16, 'asin/acos: края');
  ok(Math.abs(m.pow(1e3, 1 / 3) - 10) < 1e-13 && m.pow(0, 2) === 0 && m.pow(4, .5) === 2, 'pow');
  // «золотые» значения: одна свёртка — в node и в браузерах обязана совпасть (поменял O.m — обнови число и O.m.VER)
  const g = SYS.golden();
  const GOLD = 'e9347fa5cc075af1-94299a8d';
  ok(g.hash === GOLD, '«золотые» значения O.m, рельсов и неба — до бита те же', g);
  console.log(`  золотые: ${g.hash} (${g.n} чисел, O.m v${g.ver})`);
}

// ═══ 2. Кеплер ═══
sec('Кеплер: уравнение, рельсы против RK4, энергия и момент');
{
  const mu = 3.8229333333333326e11;
  let wE = 0;
  for (let i = 0; i < 20000; i++) {
    const e = (i % 100) / 100 * .995, M = (rnd() * 2 - 1) * Math.PI;
    const el = O.elRad(2e5, e, 0, 0, 0, M, 0, mu), st = O.state(el, 0, new Float64Array(6));
    // E из положения: cos E = (x/a + e), sin E = y/b
    const x = st[0], y = -st[2], EE = Math.atan2(y / el.b, x / el.a + e), res = Math.abs(EE - e * Math.sin(EE) - M);
    wE = Math.max(wE, Math.min(res, Math.abs(res - TAU)));
  }
  ok(wE < 1e-13, 'эллипс: E − e·sin E = M (до e = 0,995)', wE);
  let wH = 0;
  for (let i = 0; i < 20000; i++) {
    const e = 1.0005 + rnd() * 8, M = (rnd() * 2 - 1) * (i % 2 ? 50 : 1e4);
    const el = O.elRad(-3e5, e, 0, 0, 0, M, 0, mu), st = O.state(el, 0, new Float64Array(6));
    const r = len(st), ch = (1 + r / 3e5) / e, H = Math.sign(-st[2]) * Math.acosh(Math.max(1, ch));
    wH = Math.max(wH, Math.abs(e * Math.sinh(H) - H - M) / Math.max(1, Math.abs(M)));
  }
  ok(wH < 1e-9, 'гипербола: e·sh H − H = M', wH);
  // RK4 (Math, мелкий шаг) против рельсов: Луна у родной, вытянутая и наклонённая орбиты
  const rk = (mu1, r, v, T, dt) => {
    const acc = (p, o) => { const d = Math.hypot(p[0], p[1], p[2]), k = -mu1 / (d * d * d); o[0] = k * p[0]; o[1] = k * p[1]; o[2] = k * p[2]; };
    let p = [...r], u = [...v]; const a = [0, 0, 0];
    for (let st = 0, ns = Math.round(T / dt); st < ns; st++) {
      const k1v = [0, 0, 0]; acc(p, k1v); const k1p = [...u];
      const p2 = p.map((x, i) => x + k1p[i] * dt / 2), u2 = u.map((x, i) => x + k1v[i] * dt / 2); const k2v = [0, 0, 0]; acc(p2, k2v); const k2p = u2;
      const p3 = p.map((x, i) => x + k2p[i] * dt / 2), u3 = u.map((x, i) => x + k2v[i] * dt / 2); const k3v = [0, 0, 0]; acc(p3, k3v); const k3p = u3;
      const p4 = p.map((x, i) => x + k3p[i] * dt), u4 = u.map((x, i) => x + k3v[i] * dt); const k4v = [0, 0, 0]; acc(p4, k4v); const k4p = u4;
      p = p.map((x, i) => x + dt / 6 * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i])); u = u.map((x, i) => x + dt / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
    }
    void a; return [p, u];
  };
  const S = SYS.create(), L = S.byId.get('luna');
  for (const [name, el, T, dt] of [['Луна', L.el, 3000, .5], ['e = 0,7, наклон 40°', O.el({ a: 4e5, e: .7, i: 40, node: 70, peri: 20, M0: -30 }, mu), 2500, .1], ['гипербола e = 1,4', O.el({ a: -5e5, e: 1.4, i: 120, node: 10, peri: 200, M0: -2 }, mu), 2000, .1]]) {
    const s0 = O.state(el, 0, new Float64Array(6)), [pr] = rk(el.mu, [s0[0], s0[1], s0[2]], [s0[3], s0[4], s0[5]], T, dt), s1 = O.state(el, T, new Float64Array(6));
    const d = len(sub(pr, s1)) / len(s1);
    ok(d < 1e-8, `рельсы = численное интегрирование (${name})`, d);
  }
  // энергия и момент по орбите — постоянны
  const el = O.el({ a: 9e5, e: .4, i: 20, node: 33, peri: 77, M0: 10 }, mu);
  let dEn = 0, dH = 0; const s0 = O.state(el, 0, new Float64Array(6));
  const en = s => (s[3] ** 2 + s[4] ** 2 + s[5] ** 2) / 2 - mu / len(s), hv = s => [s[1] * s[5] - s[2] * s[4], s[2] * s[3] - s[0] * s[5], s[0] * s[4] - s[1] * s[3]];
  const e0 = en(s0), h0 = hv(s0);
  for (let k = 1; k < 200; k++) { const s = O.state(el, k * 97.3, new Float64Array(6)); dEn = Math.max(dEn, Math.abs(en(s) / e0 - 1)); dH = Math.max(dH, len(sub(hv(s), h0)) / len(h0)); }
  ok(dEn < 1e-12 && dH < 1e-12, 'энергия и момент — постоянны на рельсах', { dEn, dH });
  ok(Math.abs(O.state(el, el.T, new Float64Array(6))[0] - s0[0]) < 1e-6 * el.a, 'через период — то же место');
  // направление движения: против часовой с +Y (долгота растёт)
  const c0 = O.state(O.el({ a: 1e6, e: 0 }, mu), 0, new Float64Array(6)), c1 = O.state(O.el({ a: 1e6, e: 0 }, mu), 100, new Float64Array(6));
  ok(Math.atan2(-c1[2], c1[0]) > Math.atan2(-c0[2], c0[0]), 'прямая орбита: долгота растёт (как вращение планеты)');
}

// ═══ 3. Элементы ↔ состояние, универсальные переменные ═══
sec('элементы ↔ состояние (все случаи), универсальные переменные = рельсы');
{
  const mu = 3.8229333333333326e11;
  let w = 0, wc = null, nanBad = 0;
  for (let i = 0; i < 6000; i++) {
    const kind = i % 6, hyp = kind === 5;
    const e = kind === 0 ? 0 : kind === 1 ? 1e-13 : hyp ? 1.01 + rnd() * 5 : rnd() * .97;
    const inc = kind === 2 ? 0 : kind === 3 ? Math.PI : kind === 4 ? Math.PI * (.5 + rnd() * .5) : rnd() * Math.PI;
    const a = hyp ? -(1.5e5 + rnd() * 1e6) : 1.5e5 + rnd() * 1e7;
    const el = O.elRad(a, e, inc, rnd() * TAU, rnd() * TAU, (rnd() * 2 - 1) * (hyp ? 4 : 3.1), 0, mu);
    const t = rnd() * 5000, st = O.state(el, t, new Float64Array(6));
    const el2 = O.fromState(mu, [st[0], st[1], st[2]], [st[3], st[4], st[5]], t);
    if (!Number.isFinite(el2.a + el2.e + el2.i + el2.node + el2.peri + el2.M0)) nanBad++;
    const t2 = t + rnd() * 4000, s1 = O.state(el, t2, new Float64Array(6)), s2 = O.state(el2, t2, new Float64Array(6));
    const d = len(sub(s1, s2)) / len(s1);
    if (!(d <= w)) { w = d; wc = { kind, e, inc }; }
  }
  ok(nanBad === 0, 'по любому состоянию — элементы без NaN (круговые, экваториальные, обратные)', nanBad);
  ok(w < 1e-9, 'состояние → элементы → состояние (через время): совпадает', { w, wc });
  let wu = 0;
  for (let i = 0; i < 4000; i++) {
    const hyp = i % 3 === 0, e = hyp ? 1.0005 + rnd() * 3 : rnd() * .99, a = hyp ? -(1.5e5 + rnd() * 1e6) : 1.5e5 + rnd() * 1e6;
    const el = O.elRad(a, e, rnd() * 3, rnd() * 6.28, rnd() * 6.28, (rnd() * 2 - 1) * (hyp ? 3 : 3.14), 0, mu);
    const s0 = O.state(el, 0, new Float64Array(6)), dt = (rnd() * 1.2 - .2) * (hyp ? 2e4 : 4e4);
    const s1 = O.state(el, dt, new Float64Array(6)), s2 = O.uv(mu, [s0[0], s0[1], s0[2]], [s0[3], s0[4], s0[5]], dt);
    wu = Math.max(wu, len(sub(s1, s2)) / len(s1));
  }
  ok(wu < 1e-10, 'универсальные переменные = рельсы (эллипс, гипербола, назад во времени)', wu);
  // почти парабола: универсальные переменные не ломаются
  const r0 = [2e5, 0, 0], vp = Math.sqrt(2 * mu / 2e5), pb = O.uv(mu, r0, [0, 0, -vp], 3000), en = (pb[3] ** 2 + pb[4] ** 2 + pb[5] ** 2) / 2 - mu / len(pb);
  ok(Math.abs(en) < 1e-6 * mu / 2e5 && len(pb) > 2e5, 'парабола: энергия 0 сохраняется', en);
}

// ═══ 4. Система ═══
sec('«Система Денчика»: профили v2, Кеплер у всех, сферы влияния, числа плана');
const S = SYS.create();
const HOME = S.byId.get('home'), LUNA = S.byId.get('luna'), DES = S.byId.get('desert');
{
  ok(S.list.length >= 3 && HOME && LUNA && DES, 'тела на месте: родная, Луна, Песчаная', S.list.map(b => b.id));
  ok(S.list.every(b => b.def.v === 2) && S.list.filter(b => !b.stub).map(b => b.id).join() === 'home,luna,desert', 'все профили v2; без пометки «заготовка» — только Луна и Песчаная (решение владельца)', S.list.filter(b => !b.stub).map(b => b.id));
  let kb = 0;
  for (const b of S.list) { const mu = b.parent.mu, a = b.el.a; if (Math.abs(b.T * b.T * mu / (TAU * TAU * a * a * a) - 1) > 1e-12) kb++; }
  ok(kb === 0, 'Кеплер у всех: T²·μ = 4π²·a³ (период — из μ родителя)', kb);
  let nest = 0, low = 0;
  for (const b of S.list) {
    if (!b.parent.isStar && b.el.a * (1 + b.el.e) >= b.parent.soi) nest++;
    if (b.el.a * (1 - b.el.e) <= b.parent.R + (b.parent.top || 0) + b.R) low++;
  }
  ok(nest === 0, 'луны — внутри сферы влияния своей планеты', nest);
  ok(low === 0, 'перицентры — выше атмосферы родителя (никто не задевает)', low);
  const near = (x, y, tol) => Math.abs(x / y - 1) < tol;
  ok(near(HOME.mu, 3.823e11, 1e-3) && near(LUNA.mu, 9.557e9, 1e-3) && near(DES.mu, 5.734e10, 1e-3), 'μ = g·g0·R² (план: 3,823·10¹¹, 9,557·10⁹, 5,734·10¹⁰)', [HOME.mu, LUNA.mu, DES.mu]);
  ok(Math.abs(LUNA.T - 16800) < .1 && LUNA.el.a === 1398144, 'Луна: a = 1 398 144, период 16 800 с (план §1.1)', LUNA.T);
  ok(near(HOME.soi, 1.18e8, 5e-3) && near(LUNA.soi, 319689, 2e-3), 'сферы влияния: родная 1,18·10⁸, Луна 319 689 (план)', [HOME.soi, LUNA.soi]);
  ok(Math.abs(HOME.T / 86400 - 365.25) < 1e-6 && near(DES.T / 86400, 671, 2e-3), 'год родной — 365,25 суток, Песчаной — 671 (план)', [HOME.T / 86400, DES.T / 86400]);
  ok(LUNA.def.day === LUNA.T && LUNA.def.locked, 'Луна захвачена: сутки = обороту');
  const stat = O.aOf(HOME.def.day, HOME.mu);
  ok(Math.abs(stat - 382079) < 2, '«неподвижная» орбита родной — 382 079 u (план)', stat);
  ok(Math.abs(O.period(HOME.R + 36000, HOME.mu) / 60 - 11.2) < .05, 'низкая орбита (36 000 над морем) — виток 11,2 мин', O.period(HOME.R + 36000, HOME.mu) / 60);
  ok(Math.abs(Math.sqrt(2 * HOME.mu / HOME.R) - 2444) < 1, 'вторая космическая у родной — 2444 u/s', Math.sqrt(2 * HOME.mu / HOME.R));
  // в чьей сфере точка
  S.at(2.5e7);
  const hp = [S.pos[3 * HOME.i], S.pos[3 * HOME.i + 1], S.pos[3 * HOME.i + 2]], lp = [S.pos[3 * LUNA.i], S.pos[3 * LUNA.i + 1], S.pos[3 * LUNA.i + 2]];
  ok(S.which([hp[0] + 2e5, hp[1], hp[2]], 2.5e7) === HOME && S.which([lp[0] + 1e4, lp[1], lp[2]], 2.5e7) === LUNA && S.which([0, 0, 1e9], 2.5e7) === S.star, 'S.which: родная, Луна, солнце');
  ok(S.belts.length === 1 && S.belts[0].stub, 'пояс — данные (заготовка)');
  // профиль родной из системы = PL.HOME (та же планета, что рисуется)
  ok(HOME.def.radius === PL.HOME.radius && HOME.def.seed === PL.HOME.seed && HOME.def.orbit.period === 'year', 'родная системы — тот же профиль, что у планеты');
}

// ═══ 5. Перелёты ═══
sec('перелёты: Гоман и Ламберт (числа плана §2.4)');
{
  const leo = HOME.R + 36000, h = O.hohmann(HOME.mu, leo, LUNA.el.a);
  ok(Math.abs(h.dv1 - 516) < 1.5 && Math.abs(h.tof / 60 - 58) < 1, 'НОО → Луна: 516 u/s, ~58 мин в пути (план)', { dv1: h.dv1, min: h.tof / 60 });
  const g = O.hohmann(HOME.mu, leo, 382079);
  ok(Math.abs(g.dv1 - 279) < 1.5 && Math.abs(g.dv2 - 225) < 1.5 && Math.abs(g.tof / 60 - 12.1) < .1, 'НОО → «неподвижная»: 279 + 225 u/s, 12,1 мин (план)', { dv1: g.dv1, dv2: g.dv2, min: g.tof / 60 });
  let wl = 0, bad = 0, n = 0;
  for (let i = 0; i < 1500; i++) {
    const r1 = [(rnd() * 2 - 1) * 4e5, (rnd() * 2 - 1) * 1e5, (rnd() * 2 - 1) * 4e5], r2 = [(rnd() * 2 - 1) * 1e6, (rnd() * 2 - 1) * 2e5, (rnd() * 2 - 1) * 1e6];
    if (len(r1) < 1.4e5 || len(r2) < 1.4e5) continue;
    const tof = 300 + rnd() * 6000, L = O.lambert(HOME.mu, r1, r2, tof, i % 2 === 0); n++;
    if (!L.ok) { bad++; continue; }
    const el = O.fromState(HOME.mu, r1, [...L.v1], 0), p = O.state(el, tof, new Float64Array(6));
    wl = Math.max(wl, len(sub(p, r2)) / len(r2));
    const v2 = [p[3], p[4], p[5]]; wl = Math.max(wl, len(sub(v2, [...L.v2])) / len(v2) * 1e-2);
  }
  ok(bad === 0 && wl < 1e-8, 'Ламберт: корабль с найденной скоростью прилетает в цель (по и против хода)', { wl, bad, n });
  // Ламберт на 179,9° с временем Гомана — скорость Гомана
  const a1 = [leo, 0, 0], ang = 179.9 * Math.PI / 180, a2 = [LUNA.el.a * Math.cos(ang), 0, -LUNA.el.a * Math.sin(ang)];
  const L2 = O.lambert(HOME.mu, a1, a2, h.tof, true);
  ok(L2.ok && Math.abs(len([...L2.v1]) - Math.sqrt(HOME.mu / leo) - h.dv1) < 2, 'Ламберт (179,9°, время Гомана) ≈ Гоман', L2.ok && len([...L2.v1]) - Math.sqrt(HOME.mu / leo));
}

// ═══ 6. Прогноз по кускам конусов ═══
sec('прогноз: к Луне (вход в сферу), пролёт, уход к солнцу, падение на Луну, атмосфера; стыки без скачков');
{
  const t0 = 2.5e7, leo = HOME.R + 36000;
  // перелёт к Луне в её плоскости: прилёт в точку, где Луна будет через время Гомана
  const L = LUNA.el, P = L.P, Q = L.Q;
  const shot = (lead) => {
    const rA = len(O.state(L, t0 + 3500, new Float64Array(6))), h = O.hohmann(HOME.mu, leo, rA), tA = t0 + h.tof + lead;
    const mA = O.state(L, tA, new Float64Array(6)), u = [mA[0] / len(mA), mA[1] / len(mA), mA[2] / len(mA)];
    const r0 = [-u[0] * leo, -u[1] * leo, -u[2] * leo];
    // скорость — по ходу Луны (W × r̂)
    const W = L.W, vd = [W[1] * r0[2] - W[2] * r0[1], W[2] * r0[0] - W[0] * r0[2], W[0] * r0[1] - W[1] * r0[0]], vl = len(vd), vp = Math.sqrt(HOME.mu * (2 / leo - 1 / ((leo + rA) / 2)));
    return { body: 'home', r: r0, v: [vd[0] / vl * vp, vd[1] / vl * vp, vd[2] / vl * vp] };
  };
  void P; void Q;
  const segs = O.predict(S, shot(0), t0, 6 * 3600, []);
  ok(segs.length >= 2 && segs[0].end === 'soi' && segs[0].next === LUNA && segs[1].body === LUNA, 'к Луне: первый кусок кончается входом в сферу Луны', segs.map(s => [s.body.id, s.end, s.next && s.next.id]));
  const tIn = segs[0].t1 - t0;
  ok(tIn > 30 * 60 && tIn < 70 * 60, 'вход в сферу Луны — через 30–70 мин (перелёт ~58 мин)', tIn / 60);
  ok(segs[1] && (segs[1].end === 'impact' || segs[1].end === 'soi'), 'у Луны — удар (прицел в центр) или пролёт', segs[1] && segs[1].end);
  // стыки: состояние в конце куска + сдвиг системы = начало следующего
  let jump = 0;
  for (let k = 0; k + 1 < segs.length; k++) {
    const a = segs[k], b = segs[k + 1], s1 = O.state(b.el, b.t0, new Float64Array(6));
    const off = b.body === a.body.parent ? O.state(a.body.el, a.t1, new Float64Array(6)) : O.state(b.body.el, a.t1, new Float64Array(6));
    const sign = b.body === a.body.parent ? 1 : -1, r1 = [a.r1[0] + sign * off[0], a.r1[1] + sign * off[1], a.r1[2] + sign * off[2]];
    jump = Math.max(jump, len(sub(r1, s1)) / len(s1));
  }
  ok(jump < 1e-9, 'на стыках кусков — без скачка', jump);
  // промах по времени — от удара до пролёта: при пролёте — родная → Луна → родная, гипербола выше поверхности, стыки ровные
  const outc = { impact: 0, fly: 0, other: 0 }; let flyBad = 0, flyJump = 0;
  for (let lead = -24; lead <= 24; lead += 2) {
    const sg = O.predict(S, shot(lead * 60), t0, 10 * 3600, []);
    if (!sg[1] || sg[1].body !== LUNA) { outc.other++; continue; }
    if (sg[1].end === 'impact') { outc.impact++; continue; }
    if (sg[1].end === 'soi' && sg[1].next === HOME && sg[2] && sg[2].body === HOME) {
      outc.fly++;
      const rp = sg[1].el.hyp ? sg[1].el.p / (1 + sg[1].el.e) : sg[1].el.a * (1 - sg[1].el.e);
      if (!(rp > LUNA.R)) flyBad++;
      const a = sg[1], b = sg[2], s1 = O.state(b.el, b.t0, new Float64Array(6)), off = O.state(LUNA.el, a.t1, new Float64Array(6));
      flyJump = Math.max(flyJump, len(sub([a.r1[0] + off[0], a.r1[1] + off[1], a.r1[2] + off[2]], s1)) / len(s1));
    } else outc.other++;
  }
  ok(outc.impact > 0 && outc.fly > 0, 'промах по времени: и удары о Луну, и пролёты мимо (родная → Луна → родная)', outc);
  ok(flyBad === 0 && flyJump < 1e-9, 'пролёт: гипербола выше поверхности Луны, на выходе — без скачка', { flyBad, flyJump });
  // уход: скорость больше второй космической в плоскости, далёкой от Луны → к солнцу
  const ve = Math.sqrt(2 * HOME.mu / leo) + 300;
  const esc = O.predict(S, { body: 'home', r: [0, leo, 0], v: [ve, 0, 0] }, t0, 120 * 86400, []);
  ok(esc[0].end === 'soi' && esc[0].next === S.star && esc[1] && esc[1].body === S.star, 'уход от родной: выход из сферы → вокруг солнца', esc.map(s => s.body.id + ':' + s.end));
  // падение на Луну (без воздуха — удар), вход в атмосферу родной
  const fall = O.predict(S, { body: 'luna', r: [0, LUNA.R + 20000, 0], v: [100, -50, 0] }, t0, 3600, []);
  ok(fall[0].end === 'impact' && fall[0].t1 > t0, 'на Луну без воздуха — удар о поверхность', fall[0].end);
  ok(Math.abs(len(fall[0].r1) - LUNA.R) < 1e-6 * LUNA.R, 'место удара — на радиусе Луны', len(fall[0].r1) - LUNA.R);
  const rp = HOME.R + 20000, ra = HOME.R + 200000, a = (rp + ra) / 2, va = Math.sqrt(HOME.mu * (2 / ra - 1 / a));
  const re = O.predict(S, { body: 'home', r: [ra, 0, 0], v: [0, 0, -va] }, t0, 3 * 3600, []);
  ok(re[0].end === 'atmo' && Math.abs(len(re[0].r1) - (HOME.R + HOME.top)) < 1e-6 * HOME.R, 'родная: вход в атмосферу (верх — 32 000 над морем)', [re[0].end, len(re[0].r1) - HOME.R]);
  // на круговой орбите без событий — «горизонт»
  const lo = O.predict(S, { body: 'home', r: [leo, 0, 0], v: [0, 0, -Math.sqrt(HOME.mu / leo)] }, t0, 3600, []);
  ok(lo.length === 1 && lo[0].end === 'horizon' && lo[0].t1 === t0 + 3600, 'круговая низкая орбита — до горизонта прогноза', lo.map(s => s.end));
}

// ═══ 7. Небо ═══
sec('небо родной: солнце = солнце планеты, ΔL не меняет углов, фазы, затмения');
{
  const P = PL.create(PL.HOME), F = { M: new Float64Array(9), sun: new Float64Array(3) };
  let wsun = 0, wort = 0;
  for (let k = 0; k < 400; k++) {
    const t = 2.5e7 + k * 79113.7 + rnd() * 1e4, ms = O.EPOCH_MS + t * 1000;
    S.frame('home', t, ms, F);
    const M = F.M, s = F.sun, sb = [M[0] * s[0] + M[1] * s[1] + M[2] * s[2], M[3] * s[0] + M[4] * s[1] + M[5] * s[2], M[6] * s[0] + M[7] * s[1] + M[8] * s[2]];
    wsun = Math.max(wsun, len(sub(sb, P.sunDir(t, ms))));
    // M — поворот (ортонормирована)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) wort = Math.max(wort, Math.abs(M[i * 3] * M[j * 3] + M[i * 3 + 1] * M[j * 3 + 1] + M[i * 3 + 2] * M[j * 3 + 2] - (i === j ? 1 : 0)));
  }
  ok(wsun < 1e-9, 'солнце по системе = солнце планеты (календарь владельца) — до 10⁻⁹ за год', wsun);
  ok(wort < 1e-14, 'поворот неба — ортонормирован', wort);
  // ΔL: углы между телами с родной (по центрам) — как в настоящей системе
  let wang = 0;
  const cam0 = new Float64Array(3), out = [];
  for (let k = 0; k < 50; k++) {
    const t = 2.5e7 + k * 50000.3, ms = O.EPOCH_MS + t * 1000;
    S.sky('home', t, ms, cam0, out);
    const lu = out.find(e => e.b === LUNA), de = out.find(e => e.b === DES), su = out.find(e => e.kind === 'sun');
    const ang = (a, b) => Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    S.at(t);
    const h = [S.pos[3 * HOME.i], S.pos[3 * HOME.i + 1], S.pos[3 * HOME.i + 2]];
    const dir = i => { const v = [S.pos[3 * i] - h[0], S.pos[3 * i + 1] - h[1], S.pos[3 * i + 2] - h[2]], l = len(v); return v.map(x => x / l); };
    const sunT = h.map(x => -x / len(h));
    wang = Math.max(wang, Math.abs(ang(lu.d, de.d) - ang(dir(LUNA.i), dir(DES.i))), Math.abs(ang(lu.d, su.d) - ang(dir(LUNA.i), sunT)));
  }
  ok(wang < 1e-9, 'поворот на ΔL не меняет углов между телами (фазы, затмения, удаление от солнца)', wang);
  // фазы: у новолуния — тёмная, у полнолуния — вся; «растущая» — после новолуния
  const ev = S.moonEvents('home', 'luna', 2.5e7);
  const pn = { ...S.phase('home', 'luna', ev.newMoon) }, pf = { ...S.phase('home', 'luna', ev.fullMoon) };
  ok(pn.lit < .02 && pf.lit > .98, 'новолуние — освещено < 2 %, полнолуние > 98 %', [pn.lit, pf.lit]);
  ok(S.phase('home', 'luna', ev.newMoon + 1800).wax && !S.phase('home', 'luna', ev.fullMoon + 1800).wax, 'после новолуния растёт, после полнолуния убывает');
  const syn = S.synodic('home', 'luna');
  ok(Math.abs(syn / 3600 - 4.67) < .05 && ev.newMoon > 2.5e7 && ev.newMoon - 2.5e7 < syn * 1.01, 'синодический месяц ≈ 4,67 ч; новолуние — в его пределах', syn / 3600);
  // затмения: сезон в конце октября 2026 (узел 120°): найдутся оба
  const tOct = (Date.UTC(2026, 9, 22) - O.EPOCH_MS) / 1000, eo = S.moonEvents('home', 'luna', tOct);
  ok(eo.solar && eo.lunar && eo.solar.t - tOct < 6 * 3600 && eo.lunar.t - tOct < 6 * 3600, 'конец октября 2026 — сезон затмений: солнечное и лунное в ближайшие часы', eo);
  // лунное затмение: в его середине Луна в тени (свет в центре — доля солнца ~0); солнечное: под тенью Луны свет падает
  if (eo.lunar) {
    S.at(eo.lunar.t); const lp = [S.pos[3 * LUNA.i], S.pos[3 * LUNA.i + 1], S.pos[3 * LUNA.i + 2]];
    const sh = S.shadow(lp, eo.lunar.t, LUNA, null);
    ok(eo.lunar.kind === 'total' ? sh < .02 : sh < .9, `лунное затмение (${eo.lunar.kind}): у центра Луны солнце закрыто родной`, sh);
  }
  if (eo.solar) {
    const t = eo.solar.t; S.at(t);
    const h = [S.pos[3 * HOME.i], S.pos[3 * HOME.i + 1], S.pos[3 * HOME.i + 2]], l = [S.pos[3 * LUNA.i], S.pos[3 * LUNA.i + 1], S.pos[3 * LUNA.i + 2]];
    // ось тени: от солнца через Луну; точка на поверхности родной ближе всего к оси
    const ax = l.map(x => x / len(l)), hl = sub(h, l), along = hl[0] * ax[0] + hl[1] * ax[1] + hl[2] * ax[2];
    const foot = [l[0] + ax[0] * along, l[1] + ax[1] * along, l[2] + ax[2] * along], toF = sub(foot, h), fl = len(toF);
    // ось тени входит в планету на дневной стороне: foot − ax·√(R² − d²); не задевает — ближайшая к оси точка поверхности
    const back = fl < HOME.R ? Math.sqrt(HOME.R * HOME.R - fl * fl) : 0;
    const surf = fl < HOME.R ? [foot[0] - ax[0] * back, foot[1] - ax[1] * back, foot[2] - ax[2] * back] : [h[0] + toF[0] / fl * HOME.R, h[1] + toF[1] / fl * HOME.R, h[2] + toF[2] / fl * HOME.R];
    const under = S.shadow(surf, t, HOME, null), far = S.shadow([h[0] + ax[0] * HOME.R * .2, h[1] + HOME.R * .97, h[2]], t, HOME, null);
    ok(under < .5 && far > .99, 'солнечное затмение: под тенью Луны солнце закрыто, в стороне — нет', { under, far, kind: eo.solar.kind });
    // T-088: тень затмения бежит по земле — небо из точки под тенью (BF) → тело для шейдера земли (space-view.js eclOf) и доля
    // солнца по точкам (eclFrac — то же приближение, что в шейдере) против точной (S.shadow)
    require(path.join(SITE, 'js/engine/space-view.js'));
    const SVf = E.spaceView, ms = O.EPOCH_MS + t * 1000, Fh = S.frame('home', t, ms), M = Fh.M;
    const toBF = p => { const d = sub(p, h); return [M[0] * d[0] + M[1] * d[1] + M[2] * d[2], M[3] * d[0] + M[4] * d[1] + M[5] * d[2], M[6] * d[0] + M[7] * d[1] + M[8] * d[2]]; };
    const pb = toBF(surf), skyU = S.sky('home', t, ms, new Float64Array(pb), []), sunE = skyU[skyU.length - 1], ecl = new Float64Array(5);
    SVf.eclOf(skyU, HOME.R + 1000, ecl);
    const fU = SVf.eclFrac(pb, ecl, sunE.d), farB = toBF([h[0] + ax[0] * HOME.R * .2, h[1] + HOME.R * .97, h[2]]), fF = SVf.eclFrac(farB, ecl, sunE.d);
    ok(Math.abs(ecl[3] - LUNA.R) < 1e-6 && Math.abs(ecl[4] - sunE.rad) < 1e-12, 'тень на земле: тело перед солнцем — Луна (её радиус), угловой радиус солнца', [ecl[3], ecl[4]]);
    ok(Math.abs(fU - under) < .15 && Math.abs(fU - sunE.light) < .15 && fF > .99, 'доля солнца под тенью ≈ точной (S.shadow), в стороне — 1', { fU, under, light: sunE.light, fF });
    // тень бежит: через 3 мин тень с этой точки уходит (полная фаза — ~2 мин), доля растёт — и ≈ точной в частной фазе
    const t2 = t + 180, sky2 = S.sky('home', t2, ms + 1.8e5, new Float64Array(pb), []), e2 = new Float64Array(5); SVf.eclOf(sky2, HOME.R + 1000, e2);
    { const f2 = SVf.eclFrac(pb, e2, sky2[sky2.length - 1].d), x2 = sky2[sky2.length - 1].light;
      ok(e2[3] > 0 && f2 > fU + .2 && Math.abs(f2 - x2) < .15, 'через 3 мин тень уходит с этой точки (бежит по земле), доля ≈ точной', { f2, x2, fU }); }
    // не затмение (полнолуние) — тела перед солнцем нет: земля как раньше (шейдер не считает)
    const tf = eo.lunar ? eo.lunar.t : t + S.synodic('home', 'luna') / 2, skyF = S.sky('home', tf, O.EPOCH_MS + tf * 1000, new Float64Array(pb), []), eF = new Float64Array(5);
    SVf.eclOf(skyF, HOME.R + 1000, eF);
    ok(eF[3] === 0, 'полнолуние: тени затмения на земле нет (uEcl.w = 0)');
    // без выделения памяти: 10 000 вызовов
    for (let i = 0; i < 30000; i++) { SVf.eclOf(skyU, HOME.R + 1000, ecl); SVf.eclFrac(pb, ecl, sunE.d); }   // прогрев (оптимизатор)
    const hp0 = process.memoryUsage().heapUsed; for (let i = 0; i < 10000; i++) { SVf.eclOf(skyU, HOME.R + 1000, ecl); SVf.eclFrac(pb, ecl, sunE.d); }
    ok(process.memoryUsage().heapUsed - hp0 < 400000, 'eclOf / eclFrac — без мусора', process.memoryUsage().heapUsed - hp0);
  }
  // небо: что видно — Луна (2,6°), Песчаная (точка), солнце (0,27°); заготовок нет
  const sky = S.sky('home', 2.5e7, O.EPOCH_MS + 2.5e10, new Float64Array([0, HOME.R + 2, 0]), []);
  ok(sky.map(e => e.b.id).join() === 'luna,desert,sun', 'в небе — Луна, Песчаная и солнце (заготовки не видны)', sky.map(e => e.b.id));
  const lu = sky[0];
  ok(Math.abs(lu.rad * 2 * 180 / Math.PI - 2.62) < .2 && Math.abs(sky[2].rad * 180 / Math.PI - .269) < .002, 'Луна ~2,6° в небе, солнце 0,27° (как диск неба)', [lu.rad * 360 / Math.PI, sky[2].rad * 180 / Math.PI]);
  ok(sky[1].flux > 0 && sky[1].flux < lu.flux, 'блеск: Песчаная — точка, тусклее Луны', [sky[1].flux, lu.flux]);
  const withStubs = S.sky('home', 2.5e7, O.EPOCH_MS + 2.5e10, new Float64Array([0, HOME.R + 2, 0]), [], { stubs: true });
  ok(withStubs.length === S.list.length, 'заготовки — по запросу (stubs: true)', withStubs.length);
}

// ═══ 8. Одинаковость ═══
sec('одинаковость: 30 / 60 / 144 кадра в секунду, порядок вызовов, новые экземпляры — до бита');
{
  // логика: шаги по 1/60 с (как E.loop) — ускорение «своё время» копится шагами; кадры — с любой частотой
  const sim = fps => {
    let acc = 0, off = 0, steps = 0; const k = 30, rec = new Map();
    for (let f = 0; f < fps * 12; f++) {
      acc += 1 / fps; let n = 0;
      while (acc >= 1 / 60 && n < 5) { off += (1 / 60) * (k - 1); acc -= 1 / 60; steps++; n++; if (steps % 60 === 0) rec.set(steps, off); }
    }
    return rec;
  };
  const r30 = sim(30), r60 = sim(60), r144 = sim(144);
  let same = 0, tot = 0;
  for (const [st, v] of r60) { if (r30.has(st) && r144.has(st)) { tot++; if (r30.get(st) === v && r144.get(st) === v) same++; } }
  ok(tot >= 10 && same === tot, 'смещение «своего времени» на шаге N — одно и то же при 30, 60, 144 кадрах', { same, tot });
  // положения — функция времени: в общие моменты (кратные 1/6 с) у трёх частот кадров — одни и те же биты
  const SA = SYS.create(), SB = SYS.create(), SC = SYS.create();
  const snap = (Sx, t) => { Sx.at(t); return Array.from(Sx.pos); };
  let bits = 0, n = 0;
  for (let k = 0; k < 120; k++) {
    // каждая «частота» сначала считает свои промежуточные кадры (другая история вызовов), потом — общий момент
    const tc = 2.5e7 + k / 6;
    SA.at(tc - 1 / 30); SB.at(tc - 1 / 60); SC.at(tc - 1 / 144);
    const a = snap(SA, tc), b = snap(SB, tc), c = snap(SC, tc);
    n++; if (a.every((x, i) => x === b[i] && x === c[i])) bits++;
  }
  ok(bits === n, 'тела в общие моменты — одинаковые до бита при любой истории кадров (30 / 60 / 144)', { bits, n });
  // небо: порядок вызовов и новый экземпляр не меняют ни бита
  const o1 = [], o2 = [], cam = new Float64Array([1234.5, 128900, -777]);
  const t = 2.5e7 + 333.3, ms = O.EPOCH_MS + t * 1000;
  SA.sky('home', t + 100, ms + 1e5, cam, o1); SA.sky('home', t, ms, cam, o1);
  SYS.create().sky('home', t, ms, cam, o2);
  let skyBits = true;
  for (let i = 0; i < o1.length; i++) for (const key of ['d', 'sun', 'cen', 'fwd', 'up']) for (let j = 0; j < 3; j++) if (o1[i][key][j] !== o2[i][key][j]) skyBits = false;
  ok(skyBits && o1.length === o2.length, 'небо: тот же ответ при другой истории вызовов и в новой системе');
  // без мусора за кадр (отдельный процесс: молодое поколение не собирается)
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=128', __filename, '--alloc'], { encoding: 'utf8', timeout: 120000 });
  let per = null, kept = null; try { const j = JSON.parse((r.stdout || '').trim().split('\n').pop()); per = j.perFrame; kept = j.kept; } catch (e) {}
  // V8 передаёт дробные числа в неподставленные функции «упакованными» (16 байт, умирают сразу) — объектов и массивов за кадр нет
  ok(per !== null && per < 256, 'небо + рельсы всех тел + фаза за кадр — без объектов и массивов (только упаковка чисел < 256 байт)', { per, err: (r.stderr || '').slice(0, 200) });
  ok(kept !== null && kept < 64 * 1024, '100 000 кадров неба — ничего не копится (после сборки)', kept);
  console.log(`  за кадр: ${per && per.toFixed(1)} байт (упакованные числа), удержано за 100 000 кадров: ${kept} байт`);
}

// ═══ 9. Точность вдали от центра ═══
sec('точность вдали: 1,6·10¹⁰ и 10¹² u от звезды, 100 лет вперёд, картинка во float32');
{
  // система с далёкой планетой и её луной: луна относительно планеты через положения в системе = напрямую по рельсам
  const cat = { id: 'far', title: 'Даль', star: { radius: 1e8, mu: 4e17 }, bodies: [
    { v: 2, id: 'gfar', radius: 900000, g: 2, orbit: { parent: 'sun', a: 1e12, e: .05, i: 2, node: 10, peri: 20, M0: 30 } },
    { v: 2, id: 'mfar', radius: 40000, g: .3, orbit: { parent: 'gfar', a: 4e6, e: .01, i: 5, node: 1, peri: 2, M0: 3 } }] };
  const SF = SYS.create(cat), G = SF.byId.get('gfar'), MF = SF.byId.get('mfar');
  let wfar = 0;
  for (let k = 0; k < 50; k++) {
    const t = 1e8 + k * 12345.6; SF.at(t);
    const rel = [SF.pos[3 * MF.i] - SF.pos[3 * G.i], SF.pos[3 * MF.i + 1] - SF.pos[3 * G.i + 1], SF.pos[3 * MF.i + 2] - SF.pos[3 * G.i + 2]];
    const dir = O.state(MF.el, t, new Float64Array(6));
    wfar = Math.max(wfar, len(sub(rel, dir)));
  }
  ok(wfar < 2e-3, 'луна у планеты в 10¹² u от звезды: через систему — точнее 2 мм (u)', wfar);
  // то же у Великана (1,6·10¹⁰) — меньше 10⁻⁵ u
  const GI = S.byId.get('giant'), IC = S.byId.get('icy');
  let wg = 0; for (let k = 0; k < 50; k++) { const t = 3e7 + k * 777.7; S.at(t); const rel = [0, 1, 2].map(j => S.pos[3 * IC.i + j] - S.pos[3 * GI.i + j]); wg = Math.max(wg, len(sub(rel, O.state(IC.el, t, new Float64Array(6))))); }
  ok(wg < 1e-5, 'Ледяная у Великана (1,6·10¹⁰ u): ошибка < 10⁻⁵ u', wg);
  // через 100 лет: та же точка через период; «доля периода» против прямого M0 + n·t — меньше сантиметра
  const t100 = 100 * 365.25 * 86400, a1 = O.state(LUNA.el, t100, new Float64Array(6)), a2 = O.state(LUNA.el, t100 + LUNA.T, new Float64Array(6));
  ok(len(sub(a1, a2)) < 1e-2, '100 лет вперёд: Луна через свой период — на том же месте (< 1 см)', len(sub(a1, a2)));
  const el = LUNA.el, Mdirect = el.M0 + el.n * t100, Mfrac = O.meanAt(el, t100), dM = Math.abs(m.wrap(Mdirect - Mfrac));
  ok(dM * el.a < .05, '100 лет: средняя аномалия «долей периода» = прямой счёт (расхождение на орбите < 5 см)', dM * el.a);
  // картинка: центр тела на 0,9 дальности камеры во float32 (как атрибут в видеокарте) — направление точнее 10⁻⁶ рад
  const f32 = Math.fround;
  let wdir = 0;
  for (let k = 0; k < 200; k++) {
    const cam = [(rnd() * 2 - 1) * 3e5, 128000 + rnd() * 3e5, (rnd() * 2 - 1) * 3e5], d = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], dl = len(d);
    const far = 1.2e6 * (.5 + rnd()), dd = far * .9, c = [cam[0] + d[0] / dl * dd, cam[1] + d[1] / dl * dd, cam[2] + d[2] / dl * dd].map(f32);
    const v = sub(c, cam.map(f32)), vl = len(v);
    wdir = Math.max(wdir, Math.acos(Math.min(1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / (vl * dl))));
  }
  ok(wdir < 1e-6, 'тела неба во float32 (картинка на 0,9 дальности) — направление точнее 10⁻⁶ рад', wdir);
  // корабль на орбите Великана (1,6·10¹⁰): элементы ↔ состояние
  const big = O.el({ a: 1.6e10, e: .3, i: 7, node: 40, peri: 60, M0: 10 }, S.star.mu), sb = O.state(big, 1e8, new Float64Array(6));
  const eb = O.fromState(S.star.mu, [sb[0], sb[1], sb[2]], [sb[3], sb[4], sb[5]], 1e8), sb2 = O.state(eb, 1e8 + 1e6, new Float64Array(6)), sb1 = O.state(big, 1e8 + 1e6, new Float64Array(6));
  ok(len(sub(sb1, sb2)) / len(sb1) < 1e-11, 'орбита 1,6·10¹⁰ u: элементы ↔ состояние без потерь', len(sub(sb1, sb2)) / len(sb1));
}

// ═══ 10. Часы мира ═══
sec('часы мира (clock.js): медиана трёх, RTT/2, нет planet.sql, нет сети, feed, start/stop');
(async () => {
  const fresh = () => { delete globalThis.D37E.clock; delete require.cache[require.resolve(path.join(SITE, 'js/engine/clock.js'))]; require(path.join(SITE, 'js/engine/clock.js')); return globalThis.D37E.clock; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const resp = (status, body) => ({ ok: status === 200, status, json: async () => body });
  {
    const C = fresh();
    ok(C.EPOCH === O.EPOCH_MS && Math.abs(C.t() - (Date.now() - O.EPOCH_MS) / 1000) < .05 && C.state === 'local', 'до сверки: часы устройства, эпоха = O.EPOCH_MS');
    const offs = [5000, 9000, 5012];   // второй ответ «врёт» на 4 с — медиана его отбросит
    let k = 0;
    C._fetch = async (url, o) => { const d = offs[k++]; await wait(15); const srv = Date.now() + d; await wait(15); ok(/\/rest\/v1\/rpc\/world_now$/.test(url) && o.method === 'POST', 'запрос — POST /rest/v1/rpc/world_now'); return resp(200, srv); };
    const res = await C.sync();
    ok(res && C.state === 'sync' && Math.abs(C.off - 5012) < 25 && C.rtt >= 20, 'сверка: медиана из трёх с поправкой на полпути', { off: C.off, rtt: C.rtt });
    ok(Math.abs(C.now() - (Date.now() + C.off)) < 2 && Math.abs(C.msOf(C.tOf(1.8e12)) - 1.8e12) < 1e-3, 'now() = своё + поправка; tOf / msOf — обратные');
    ok(!C.feed(Date.now(), 999) && C.feed(Date.now() + 3000, 2, 'net') && Math.abs(C.off - 3001) < 5 && C.src === 'net', 'feed: принимает только с более коротким путём', { off: C.off, src: C.src });
  }
  {
    const C = fresh(); let n = 0;
    C._fetch = async () => { n++; return resp(404, { code: 'PGRST202', message: 'Could not find the function public.world_now' }); };
    const r = await C.sync();
    ok(!r && C.state === 'nosql' && C.off === 0 && n === 1, 'planet.sql не запущен (PGRST202): часы устройства, без повторов', { state: C.state, n });
  }
  {
    const C = fresh();
    C._fetch = async () => { throw new TypeError('Failed to fetch'); };
    const r = await C.sync();
    ok(!r && C.state === 'local' && C.off === 0 && /fetch/.test(C.err), 'нет сети: часы устройства, ошибка запомнена', C.err);
    C._fetch = async () => resp(200, 'не число');
    ok(!(await C.sync()) && C.state === 'local', 'ответ не время — не берём');
    // start/stop: счётчик, таймер убирается
    C._fetch = async () => resp(200, Date.now());
    const s1 = C.start(), s2 = C.start();
    ok(C.users() === 2, 'start: двое пользуются часами');
    s1(); s1(); ok(C.users() === 1, 'stop повторно — не считается');
    s2(); ok(C.users() === 0, 'все ушли — таймера нет');
    await wait(50);
  }
  // T-145: свой игровой сервер (RT_URL, GET /time) — первым; Supabase — запасной. /time — только если /health сказал time: 1
  // (старый сервер отвечает на /time 404 без CORS: в браузере это TypeError и две ошибки в консоли)
  const H_NEW = { ok: true, rooms: true, proto: 1, time: 1 }, H_OLD = { ok: true, rooms: true, proto: 1 };
  {
    const C = fresh(); const seen = [];
    C._rtUrl = 'https://rt.test';
    C._fetch = async (url, o) => { seen.push(url); if (url.endsWith('/health')) return resp(200, H_NEW); await wait(10); const srv = Date.now() + 7000; await wait(10); return url.endsWith('/time') ? resp(200, { t: srv }) : resp(200, srv - 99999); };
    ok(await C.sync() && C.src === 'rt' && Math.abs(C.off - 7000) < 25 && seen.length === 4 && seen[0] === 'https://rt.test/health' && seen.slice(1).every(u => u === 'https://rt.test/time'), 'свой сервер: /health (time: 1), 3 × /time, медиана, Supabase не спрашиваем', { off: C.off, src: C.src, seen });
    seen.length = 0;
    ok(await C.sync() && seen.length === 3 && seen.every(u => u.endsWith('/time')), 'ответ /health помнится: вторая сверка — сразу /time', seen);
  }
  {
    // старый сервер (на проде до обновления): /health без time → /time не трогаем вообще, Supabase; полчаса свой сервер не спрашиваем
    const C = fresh(); const seen = [];
    C._rtUrl = 'https://rt.test';
    C._fetch = async url => { seen.push(url); if (url.endsWith('/health')) return resp(200, H_OLD); if (url.endsWith('/time')) throw new TypeError('Failed to fetch'); return resp(200, Date.now() + 4000); };
    ok(await C.sync() && C.src === 'sb' && Math.abs(C.off - 4000) < 25 && !seen.some(u => u.endsWith('/time')) && seen.filter(u => /world_now$/.test(u)).length === 3, 'старый сервер (без time в /health): /time не спрашиваем (нет ошибок CORS в консоли) — Supabase world_now', { src: C.src, err: C.errRt, seen });
    seen.length = 0;
    ok(await C.sync() && !seen.some(u => u.startsWith('https://rt.test')), 'старый сервер: следующие сверки — сразу Supabase (полчаса)', seen);
  }
  {
    // /health «есть», но /time — 404 без CORS (как браузер: TypeError) → полчаса без своего сервера, не каждые 10 минут
    const C = fresh(); const seen = [];
    C._rtUrl = 'https://rt.test';
    C._fetch = async url => { seen.push(url); if (url.endsWith('/health')) return resp(200, H_NEW); if (url.endsWith('/time')) throw new TypeError('Failed to fetch'); return resp(200, Date.now() - 2500); };
    ok(await C.sync() && C.src === 'sb' && Math.abs(C.off + 2500) < 25, 'свой сервер не отвечает (TypeError) — Supabase', { src: C.src, off: C.off });
    const n1 = seen.filter(u => u.endsWith('/time')).length;
    await C.sync();
    ok(n1 === 1 && seen.filter(u => u.endsWith('/time')).length === 1, 'после TypeError /time полчаса не спрашиваем (одна ошибка, а не по две на каждую сверку)', { n1, seen });
  }
  {
    const C = fresh();
    C._rtUrl = 'https://rt.test';
    C._fetch = async url => url.endsWith('/health') ? resp(200, H_NEW) : url.endsWith('/time') ? resp(200, { t: 'нет' }) : resp(200, Date.now());
    ok(await C.sync() && C.src === 'sb', 'свой сервер ответил не временем — не берём, Supabase');
  }
  {
    const C = fresh();
    C._rtUrl = 'https://rt.test';
    C._fetch = async url => url.endsWith('/health') ? resp(200, H_NEW) : url.endsWith('/time') ? resp(200, { t: Date.now() + 1500 }) : resp(404, { code: 'PGRST202' });
    ok(await C.sync() && C.state === 'sync' && C.src === 'rt', 'planet.sql не запущен, а свой сервер есть — время с него');
  }
  {
    // сервер (server/rt/src/server.js): /health говорит time: 1, 404 и 405 — с CORS (браузер видит ответ, а не «ошибку сети»)
    const src = fs.readFileSync(path.join(SITE, 'server/rt/src/server.js'), 'utf8');
    ok(/proto: C\.PROTO, time: 1/.test(src) && /json\(res, 404, \{ error: 'not found' \}, cors\)/.test(src) && /json\(res, 405, \{ error: 'method' \}, cors\)/.test(src), 'сервер: /health с time: 1, ответы 404 / 405 с CORS');
  }
  // ═══ 11. planet.sql ═══
  sec('planet.sql: часы мира (сама проверка в PGlite — scripts/planet-sql-test.mjs)');
  {
    const sql = fs.readFileSync(path.join(SITE, 'planet.sql'), 'utf8');
    ok(/create or replace function public\.world_now\(\)\s+returns double precision/i.test(sql) && /grant execute on function public\.world_now\(\) to anon, authenticated/i.test(sql), 'world_now(): создаётся заново (идемпотентно), доступна гостю и вошедшим');
    ok(!/drop table|delete from|truncate/i.test(sql), 'planet.sql ничего не удаляет');
  }
  // ═══ 12. Скорость ═══
  sec('скорость (node; телефон с ЦП ×4 — примерно ×4)');
  {
    const time = (n, f) => { const r = []; for (let k = 0; k < 5; k++) { const t0 = process.hrtime.bigint(); f(n); r.push(Number(process.hrtime.bigint() - t0) / 1e3 / n); } r.sort((a, b) => a - b); return r[2]; };
    const el = LUNA.el, st = new Float64Array(6), cam = new Float64Array([0, 128100, 0]), out = [], F = { M: new Float64Array(9), sun: new Float64Array(3) };
    const us = {
      state: time(50000, n => { for (let i = 0; i < n; i++) O.state(el, 2.5e7 + i * .7, st); }),
      sin: time(200000, n => { let s = 0; for (let i = 0; i < n; i++) s += m.sin(i * .37); return s; }),
      sky: time(4000, n => { for (let i = 0; i < n; i++) { const t = 2.5e7 + i * .0167; S.sky('home', t, O.EPOCH_MS + t * 1000, cam, out, { F }); } }),
      lambert: time(2000, n => { for (let i = 0; i < n; i++) O.lambert(HOME.mu, [2e5, 0, 0], [-3e5, 1e4, 2e5 + i], 3000, true); }),
      predict: time(60, n => { for (let i = 0; i < n; i++) O.predict(S, { body: 'home', r: [0, 164000, 0], v: [2100 + i, 0, 0] }, 2.5e7, 6 * 3600, []); }),
      events: time(10, n => { for (let i = 0; i < n; i++) S.moonEvents('home', 'luna', 2.5e7 + i * 1000); }),
    };
    console.log(`  O.state ${us.state.toFixed(2)} мкс · O.m.sin ${(us.sin * 1000).toFixed(0)} нс · небо родной ${us.sky.toFixed(1)} мкс · Ламберт ${us.lambert.toFixed(1)} мкс · прогноз ${(us.predict / 1000).toFixed(2)} мс · события Луны ${(us.events / 1000).toFixed(2)} мс`);
    ok(us.state < 5 && us.sky < 60 && us.lambert < 100 && us.predict < 3000 && us.events < 20000, 'скорость: рельсы < 5 мкс, небо < 60 мкс, Ламберт < 100 мкс, прогноз < 3 мс, события Луны < 20 мс', us);
    globalThis.__orbitPerf = us;
  }
  console.log(`\norbit-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

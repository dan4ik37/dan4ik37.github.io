// Проверка планеты движка (js/engine/planet.js, T-051, docs/plans/planet.md) без браузера: node scripts/planet-test.cjs
// Профиль (проверка и умолчания), куб-сфера (туда-обратно, решётка: общие вершины соседних кусков — до бита), соседи через рёбра
// куба, выбор кусков (покрывают шар ровно один раз), 2 : 1 и сшивка (край мелкого куска совпадает с краем крупного), индексы (без
// дыр и наложений, всё наружу), отсечение за горизонтом (не прячет видимое), плоский кусок (базис, туда-обратно, переезд якоря),
// физика по тому же треугольнику, что нарисован, точность «плавающего начала» в 10 000 км, сутки и времена года (календарь
// владельца), луна, области, одинаковость (поток = страница), LOD v2 (T-075: поверхность до бита, форма родителя для перетекания,
// экранная ошибка), климат по широте, скорость.
const path = require('path');
const SITE = path.join(__dirname, '..');
require(path.join(SITE, 'js/engine/planet.js'));
const PL = globalThis.D37E.planet;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sec = t => console.log('— ' + t);
const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
const randDir = out => { let x, y, z, l; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < .1); out[0] = x / l; out[1] = y / l; out[2] = z / l; return out; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const P = PL.create(PL.HOME);
const R = P.R;

// ═══ 1. Профиль ═══
sec('профиль планеты: умолчания, пределы, свои поля переходников остаются');
{
  const d = PL.def({ radius: -5, seed: 'x', gen: 'нет', relief: { amp: 1e9 }, games: { kubomir: { blocks: 1 } }, custom: 7 });
  ok(d.radius === 500, 'радиус не меньше 500', d.radius);
  ok(d.seed === 37, 'зерно по умолчанию', d.seed);
  ok(d.gen === 'rocky1', 'неизвестный генератор → rocky1', d.gen);
  ok(d.relief.amp <= d.radius * .2, 'горы не выше 20 % радиуса', d.relief.amp);
  ok(d.games.kubomir.blocks === 1 && d.custom === 7, 'поля переходников и неизвестные — как есть');
  const a = PL.def({ atmo: null }); ok(a.atmo === null, 'без атмосферы');
  const b = PL.def({ radius: 32000, atmo: { tauM: .1 } }); ok(b.atmo && b.atmo.Hr > 0 && b.atmo.top > b.atmo.Hr && b.atmo.tauM === .1, 'атмосфера: неполная → по радиусу', b.atmo);
  ok(PL.def({ year: 'calendar' }).year === 'calendar' && PL.def({ year: 1000 }).year === 1000, 'год: календарь владельца или секунды');
  ok(P.def.moons.length === 1 && P.def.moons[0] === 'luna', 'у родной — Луна-тело системы (id; орбита — js/engine/system.js)', P.def.moons);
  const v1 = PL.def(PL.HOME_V1);
  ok(v1.moons.length === 1 && v1.moons[0].dist > R && v1.moons[0].rails === 'visual', 'у профиля v1 — луна-«украшение» (rails visual)', v1.moons);
}

// ═══ 2. Куб-сфера ═══
sec('куб-сфера: туда-обратно, решётка одна на все грани и уровни (до бита)');
{
  const d = [0, 0, 0], F = [0, 0, 0], d2 = [0, 0, 0];
  let maxErr = 0;
  for (let k = 0; k < 4000; k++) {
    randDir(d); PL.faceOf(d[0], d[1], d[2], F); PL.dirOf(F[0], F[1], F[2], d2);
    maxErr = Math.max(maxErr, Math.hypot(d[0] - d2[0], d[1] - d2[1], d[2] - d2[2]));
  }
  ok(maxErr < 1e-12, 'направление → грань → направление', maxErr);
  // общие вершины соседних граней: одна целая точка K — одно направление и высота (биты)
  const K = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  let same = 0, tot = 0;
  const M = 64;
  for (let f = 0; f < 6; f++) for (let q = 0; q <= M; q++) for (const [gi, gj] of [[0, q], [M, q], [q, 0], [q, M]]) {
    PL.latK(f, gi, gj, M, K); PL.latDir(K[0], K[1], K[2], M, a);
    // та же точка куба глазами другой грани: перебором всех граней ищем её индексы
    for (let g = 0; g < 6; g++) {
      if (g === f) continue;
      const n = PL.FACES[g][0], u = PL.FACES[g][1], v = PL.FACES[g][2], h = M / 2;
      const kn = (K[0] - h) * n[0] + (K[1] - h) * n[1] + (K[2] - h) * n[2];
      if (kn !== h) continue;   // не на этой грани
      const gi2 = (K[0] - h) * u[0] + (K[1] - h) * u[1] + (K[2] - h) * u[2] + h, gj2 = (K[0] - h) * v[0] + (K[1] - h) * v[1] + (K[2] - h) * v[2] + h;
      const K2 = PL.latK(g, gi2, gj2, M, [0, 0, 0]); PL.latDir(K2[0], K2[1], K2[2], M, b);
      tot++; if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && P.height(a[0], a[1], a[2]) === P.height(b[0], b[1], b[2])) same++;
    }
  }
  ok(tot > 700 && same === tot, 'вершины на рёбрах куба — одинаковые у обеих граней (направление и высота)', { same, tot });
  // уровень крупнее: точка (a, b) уровня L = точка (2a, 2b) уровня L+1
  let lv = 0, lt = 0;
  for (let k = 0; k < 500; k++) {
    const f = (rnd() * 6) | 0, L = (rnd() * 10) | 0, Mc = 32 * 2 ** L, gi = (rnd() * Mc) | 0, gj = (rnd() * Mc) | 0;
    PL.latK(f, gi, gj, Mc, K); PL.latDir(K[0], K[1], K[2], Mc, a);
    PL.latK(f, gi * 2, gj * 2, Mc * 2, K); PL.latDir(K[0], K[1], K[2], Mc * 2, b);
    lt++; if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) lv++;
  }
  ok(lv === lt, 'вершина крупного уровня = вершина мелкого (до бита)', { lv, lt });
  // искажение: площадь клеток по грани (максимум / минимум)
  let amin = Infinity, amax = 0;
  const Mg = 64, p00 = [0, 0, 0], p10 = [0, 0, 0], p01 = [0, 0, 0];
  for (let i = 0; i < Mg; i++) for (let j = 0; j < Mg; j++) {
    PL.latK(4, i, j, Mg, K); PL.latDir(K[0], K[1], K[2], Mg, p00);
    PL.latK(4, i + 1, j, Mg, K); PL.latDir(K[0], K[1], K[2], Mg, p10);
    PL.latK(4, i, j + 1, Mg, K); PL.latDir(K[0], K[1], K[2], Mg, p01);
    const ux = p10[0] - p00[0], uy = p10[1] - p00[1], uz = p10[2] - p00[2], vx = p01[0] - p00[0], vy = p01[1] - p00[1], vz = p01[2] - p00[2];
    const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    amin = Math.min(amin, ar); amax = Math.max(amax, ar);
  }
  globalThis.__areaRatio = amax / amin;
  ok(amax / amin < 1.6, 'площадь клеток по грани — не больше 1,6 раза (равноугловое искажение)', +(amax / amin).toFixed(3));
  console.log(`  площадь клеток по грани: наибольшая / наименьшая = ${(amax / amin).toFixed(3)}`);
}

// ═══ 3. Соседи ═══
sec('соседи: через рёбра куба — взаимные');
{
  let bad = 0, tot = 0;
  for (let L = 0; L <= 4; L++) {
    const S = 2 ** L;
    for (let f = 0; f < 6; f++) for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
      const n = P.node(f, L, i, j);
      for (let e = 0; e < 4; e++) {
        const nb = P.neighbor(n, e); tot++;
        if (nb.L !== L || nb === n) { bad++; continue; }
        let back = false; for (let e2 = 0; e2 < 4; e2++) if (P.neighbor(nb, e2) === n) back = true;
        if (!back) bad++;
      }
    }
  }
  ok(bad === 0, 'сосед соседа — снова мы (уровни 0–4, все грани)', { bad, tot });
}

// ═══ 4. Выбор кусков, 2 : 1, сшивка ═══
sec('выбор кусков: шар покрыт ровно один раз, соседи отличаются ≤ 1 уровня, маски сшивки');
const camAt = (lat, lon, alt) => { const d = P.dirFromLatLon(lat, lon); const r = R + alt; return [d[0] * r, d[1] * r, d[2] * r]; };
const leafOf = (leaves, d) => {
  const F = PL.faceOf(d[0], d[1], d[2], [0, 0, 0]); let hit = 0, who = null;
  for (const n of leaves) { if (n.f !== F[0]) continue; const S = 2 ** n.L, i = Math.min(S - 1, Math.floor((F[1] + 1) / 2 * S)), j = Math.min(S - 1, Math.floor((F[2] + 1) / 2 * S)); if (i === n.i && j === n.j) { hit++; who = n; } }
  return [hit, who];
};
let lastLeaves = null;
{
  const cams = [[10, 20, 3], [45, -100, 400], [-60, 150, 30000], [0, 0, 600000], [89.9, 0, 50], [35.26, 45, 20]];   // последнее — у угла куба
  for (const c of cams) {
    const cam = camAt(c[0], c[1], c[2]);
    const leaves = P.select(cam[0], cam[1], cam[2], { K: 2, maxL: 12, cull: false }, []);
    P.balance(leaves);
    lastLeaves = leaves;
    let bad = 0; const d = [0, 0, 0];
    for (let k = 0; k < 3000; k++) { randDir(d); if (leafOf(leaves, d)[0] !== 1) bad++; }
    ok(bad === 0, `покрытие ровно один раз (камера ${c.join(', ')})`, bad);
    let lvBad = 0, maskBad = 0, maxL = 0;
    for (const n of leaves) {
      maxL = Math.max(maxL, n.L);
      for (let e = 0; e < 4; e++) { const cov = P.coverLeaf(P.neighbor(n, e)); if (cov && Math.abs(cov.L - n.L) > 1) lvBad++; }
      const m = P.stitchMask(n);
      for (let e = 0; e < 4; e++) if (m >> e & 1) { const cov = P.coverLeaf(P.neighbor(n, e)); if (!cov || cov.L !== n.L - 1) maskBad++; }
    }
    ok(lvBad === 0, `2 : 1 после выравнивания (камера ${c.join(', ')}, листьев ${leaves.length}, уровень до ${maxL})`, lvBad);
    ok(maskBad === 0, 'маска сшивки — только у краёв с крупным соседом', maskBad);
  }
  // у земли — мельчайший уровень; с орбиты — мало кусков
  const near = P.select(...camAt(10, 20, 3), { K: 2, maxL: 12 }, []), far = P.select(...camAt(10, 20, 600000), { K: 2, maxL: 12 }, []);
  ok(near.some(n => n.L === 12), 'у земли есть самый мелкий уровень', Math.max(...near.map(n => n.L)));
  ok(far.length <= 40, 'с орбиты (600 тыс. ед.) — немного кусков', far.length);
}

// ═══ 5. Индексы сшивки ═══
sec('индексы: 16 масок — без дыр и наложений, обход наружу, на сшитых краях — только чётные вершины');
{
  const N = 32, n1 = N + 1;
  let allOk = true;
  for (let m = 0; m < 16; m++) {
    const I = PL.indices(N, m);
    let area = 0, neg = 0, odd = 0, skirt = 0;
    for (let q = 0; q < I.length; q += 3) {
      const t = [I[q], I[q + 1], I[q + 2]];
      if (t.some(v => v >= n1 * n1)) { skirt++; continue; }
      const xy = t.map(v => [v % n1, Math.floor(v / n1)]);
      const ar = ((xy[1][0] - xy[0][0]) * (xy[2][1] - xy[0][1]) - (xy[2][0] - xy[0][0]) * (xy[1][1] - xy[0][1])) / 2;
      area += ar; if (ar <= 0) neg++;
      for (const [a, b] of xy) {
        if ((m & 1) && a === 0 && b % 2) odd++; if ((m & 2) && a === N && b % 2) odd++;
        if ((m & 4) && b === 0 && a % 2) odd++; if ((m & 8) && b === N && a % 2) odd++;
      }
    }
    if (area !== N * N || neg || odd || skirt === 0) { allOk = false; ok(false, 'маска ' + m, { area, neg, odd, skirt }); }
  }
  ok(allOk, 'все 16 масок: площадь ровно N², все треугольники в одну сторону, нечётные вершины на сшитых краях не используются');
  ok(PL.indices(32, 5) === PL.indices(32, 5), 'индексы общие (кэш)');
}

// ═══ 6. Сетка куска и швы ═══
sec('куски: края соседей совпадают (та же грань, другая грань, на уровень крупнее), всё смотрит наружу');
{
  const bf = (c, i) => [c.centre[0] + c.pos[i * 3], c.centre[1] + c.pos[i * 3 + 1], c.centre[2] + c.pos[i * 3 + 2]];
  const edgeVerts = (c, e, step = 1) => { const N = c.N, n1 = N + 1, L = []; for (let q = 0; q <= N; q += step) { const a = e === 0 ? 0 : e === 1 ? N : q, b = e === 2 ? 0 : e === 3 ? N : q; L.push(bf(c, b * n1 + a)); } return L; };
  const match = (A, B, tol) => { let worst = 0; for (const p of A) { let best = Infinity; for (const q of B) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); worst = Math.max(worst, best); } return worst; };
  const cache = new Map(), chunk = n => { if (!cache.has(n.key)) cache.set(n.key, P.buildChunk(n.f, n.L, n.i, n.j, 32)); return cache.get(n.key); };
  // та же грань и другая: соседи одного уровня — все вершины края
  let worstSame = 0, worstCross = 0, worstCoarse = 0, checked = 0, cross = 0, coarse = 0;
  for (const [f, L, i, j] of [[4, 6, 10, 20], [0, 5, 31, 7], [2, 4, 0, 0], [3, 7, 127, 64], [5, 3, 0, 5]]) {
    const n = P.node(f, L, i, j), c = chunk(n);
    for (let e = 0; e < 4; e++) {
      const nb = P.neighbor(n, e), c2 = chunk(nb), d = match(edgeVerts(c, e), [0, 1, 2, 3].flatMap(e2 => edgeVerts(c2, e2)), 0) / (c.radius * 2e-7 + 1e-6);
      if (nb.f === n.f) worstSame = Math.max(worstSame, d); else { worstCross = Math.max(worstCross, d); cross++; }
      checked++;
    }
  }
  ok(worstSame <= 1, 'край у соседа той же грани — те же точки (в пределах float32 куска)', worstSame);
  ok(cross > 0 && worstCross <= 1, 'край у соседа другой грани — те же точки (в пределах float32 куска)', { worstCross, cross });
  // мелкий и крупный: чётные вершины края мелкого = вершины края крупного (выбор заново: метки листьев — от последнего выбора)
  const camS = camAt(35.26, 45, 20), leavesS = P.balance(P.select(camS[0], camS[1], camS[2], { K: 2, maxL: 12, cull: false }, []));
  for (const n of leavesS) {
    const m = P.stitchMask(n); if (!m) continue;
    for (let e = 0; e < 4; e++) if (m >> e & 1) {
      const cov = P.coverLeaf(P.neighbor(n, e)), c = chunk(n), c2 = chunk(cov);
      worstCoarse = Math.max(worstCoarse, match(edgeVerts(c, e, 2), [0, 1, 2, 3].flatMap(e2 => edgeVerts(c2, e2)), 0) / (c2.radius * 2e-7 + 1e-6)); coarse++;
    }
    if (coarse > 12) break;
  }
  ok(coarse > 0 && worstCoarse <= 1, 'край мелкого куска (чётные вершины) = край крупного соседа', { worstCoarse, coarse });
  // треугольники смотрят наружу
  let inward = 0, tris = 0;
  for (const c of cache.values()) {
    const I = PL.indices(32, 0), n1 = 33;
    for (let q = 0; q < I.length; q += 3) {
      if (I[q] >= n1 * n1 || I[q + 1] >= n1 * n1 || I[q + 2] >= n1 * n1) continue;
      const a = bf(c, I[q]), b = bf(c, I[q + 1]), d = bf(c, I[q + 2]);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      tris++; if (nx * a[0] + ny * a[1] + nz * a[2] <= 0) inward++;
    }
  }
  ok(inward === 0, 'все треугольники смотрят наружу (обход против часовой снаружи)', { inward, tris });
  const c = chunk(P.node(4, 8, 100, 100));
  ok(c.pos.length === (33 * 33 + 4 * 33) * 3 && c.nrm.length === c.pos.length && c.col.length === (33 * 33 + 4 * 33) * 4, 'размеры массивов куска');
  let maxLocal = 0; for (let k = 0; k < c.pos.length; k++) maxLocal = Math.max(maxLocal, Math.abs(c.pos[k]));
  ok(maxLocal < c.radius + 1, 'вершины — от центра куска (маленькие числа для float32)', { maxLocal, radius: c.radius });
  // поток и страница: та же сетка (новая планета — те же числа)
  const P2 = PL.create(PL.HOME), c2 = P2.buildChunk(4, 8, 100, 100, 32);
  let same = c2.pos.length === c.pos.length;
  for (let k = 0; same && k < c.pos.length; k++) if (c2.pos[k] !== c.pos[k]) same = false;
  for (let k = 0; same && k < c.col.length; k++) if (c2.col[k] !== c.col[k]) same = false;
  ok(same && c2.centre[0] === c.centre[0], 'новый экземпляр (как в потоке) строит тот же кусок до бита');
}

// ═══ 7. Отсечение за горизонтом ═══
sec('горизонт: спрятанный кусок действительно не виден (луч к любой его точке уходит в море)');
{
  const rocc = R + P.renderMin;
  const hidden = (cam, p) => {   // отрезок камера → точка пересекает шар моря?
    const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2], L = Math.hypot(dx, dy, dz), ux = dx / L, uy = dy / L, uz = dz / L;
    const b = cam[0] * ux + cam[1] * uy + cam[2] * uz, cc = cam[0] ** 2 + cam[1] ** 2 + cam[2] ** 2 - rocc * rocc, disc = b * b - cc;
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc); return t > 1e-6 && t < L - 1e-6;
  };
  let wrong = 0, culled = 0, tot = 0;
  const pt = [0, 0, 0], K = [0, 0, 0];
  for (let k = 0; k < 300; k++) {
    const d = randDir([0, 0, 0]), alt = [5, 200, 5000, 80000][k % 4], cam = [d[0] * (R + alt), d[1] * (R + alt), d[2] * (R + alt)];
    const L = 3 + (k % 5), S = 2 ** L, f = (rnd() * 6) | 0, i = (rnd() * S) | 0, j = (rnd() * S) | 0, n = P.node(f, L, i, j);
    tot++;
    if (P.horizonVisible(n, cam[0], cam[1], cam[2])) continue;
    culled++;
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {   // точки узла на самой большой высоте
      const M = 4 * S; PL.latK(f, i * 4 + a, j * 4 + b, M, K); PL.latDir(K[0], K[1], K[2], M, pt);
      const r = R + n.hmax; if (!hidden(cam, [pt[0] * r, pt[1] * r, pt[2] * r])) wrong++;
    }
  }
  ok(culled > 30 && wrong === 0, 'отсечение не прячет видимое', { culled, tot, wrong });
}

// ═══ 8. Плоский кусок и переезд якоря ═══
sec('плоский кусок: базис, туда-обратно, переезд якоря без скачка');
{
  let worst = 0, basisBad = 0;
  const X = [0, 0, 0], Lp = [0, 0, 0];
  for (let k = 0; k < 200; k++) {
    const d = randDir([0, 0, 0]); if (k === 0) { d[0] = 0; d[1] = 1; d[2] = 0; }   // и полюс
    const fr = P.patch(d), B = fr.B;
    const e = [B[0], B[1], B[2]], u = [B[3], B[4], B[5]], s = [B[6], B[7], B[8]];
    const cr = [e[1] * u[2] - e[2] * u[1], e[2] * u[0] - e[0] * u[2], e[0] * u[1] - e[1] * u[0]];
    if (Math.abs(dot(e, u)) > 1e-12 || Math.abs(dot(u, s)) > 1e-12 || Math.abs(dot(e, s)) > 1e-12 || Math.abs(dot(u, d) - 1) > 1e-12 || Math.hypot(cr[0] - s[0], cr[1] - s[1], cr[2] - s[2]) > 1e-12) basisBad++;
    const p = [rnd() * 800 - 400, rnd() * 300, rnd() * 800 - 400];
    P.toBF(fr, p[0], p[1], p[2], X); P.toL(fr, X[0], X[1], X[2], Lp);
    worst = Math.max(worst, Math.hypot(Lp[0] - p[0], Lp[1] - p[1], Lp[2] - p[2]));
  }
  ok(basisBad === 0, 'базис: восток, вверх (= направление), юг — прямой, правый (x × y = z)', basisBad);
  ok(worst < 1e-8, 'L → планета → L', worst);
  // переезд якоря: точка и скорость в новой системе = то же место планеты
  const a = P.patch(P.dirFromLatLon(30, 40)), b = P.patch(P.dirFromLatLon(30.003, 40.004));
  const m = P.rebaseMap(a, b), p = [123.4, 56.7, -89.1], q = P.mapPoint(m, ...p, [0, 0, 0]);
  const A1 = P.toBF(a, ...p, [0, 0, 0]), B1 = P.toBF(b, ...q, [0, 0, 0]);
  ok(Math.hypot(A1[0] - B1[0], A1[1] - B1[1], A1[2] - B1[2]) < 1e-8, 'после переезда точка — то же место на планете');
  const v = P.mapDir(m, 3, 4, 12, [0, 0, 0]);
  ok(Math.abs(Math.hypot(...v) - 13) < 1e-10, 'скорость поворачивается без изменения длины');
  // сила тяжести: «верх» в L у якоря — ровно +y; в 384 ед. — наклон ≈ 384 / R
  const up = P.upL(a, 0, 0, 0, [0, 0, 0]), up2 = P.upL(a, 384, 0, 0, [0, 0, 0]);
  ok(Math.abs(up[1] - 1) < 1e-12, 'у якоря «вверх» — ровно +y');
  const tilt = Math.acos(up2[1]) * 180 / Math.PI;
  ok(Math.abs(tilt - 384 / R * 180 / Math.PI) < .002, 'наклон «вверх» в 384 ед. — как дуга (0,17° у родной)', +tilt.toFixed(4));
}

// ═══ 9. Физика: высота — по нарисованному треугольнику ═══
sec('физика: земля под ногами = нарисованная сетка самого мелкого уровня; море — сфера');
{
  // найти лист самого мелкого уровня под точкой, построить его и пересечь вертикаль с его треугольниками
  const fr = P.patch(P.dirFromLatLon(12.3, 45.6)), X = [0, 0, 0], F = [0, 0, 0];
  const I = PL.indices(32, 0), N = 32, n1 = 33;
  let worst = 0, tested = 0, maxDiffEdge = 0;
  const cache = new Map();
  for (let k = 0; k < 120; k++) {
    const x = rnd() * 600 - 300, z = rnd() * 600 - 300;
    const yP = P.patchHeight(fr, x, z, true);
    // сетка того же уровня
    P.toBF(fr, x, yP, z, X); const l = Math.hypot(...X); PL.faceOf(X[0] / l, X[1] / l, X[2] / l, F);
    const S = 2 ** P.physL, fi = Math.min(S - 1, Math.floor((F[1] + 1) / 2 * S)), fj = Math.min(S - 1, Math.floor((F[2] + 1) / 2 * S));
    const kk = F[0] + ':' + fi + ':' + fj; if (!cache.has(kk)) cache.set(kk, P.buildChunk(F[0], P.physL, fi, fj, N));
    const c = cache.get(kk);
    // клетка внутри куска (кольцо по краю — другая диагональ у углов: пропускаем)
    const ls = (F[1] + 1) / 2 * S * N - fi * N, lt = (F[2] + 1) / 2 * S * N - fj * N;
    let best = null;
    for (let q = 0; q < I.length; q += 3) {
      const t = [I[q], I[q + 1], I[q + 2]]; if (t.some(v => v >= n1 * n1)) continue;
      const pts = t.map(v => { const w = [c.centre[0] + c.pos[v * 3], c.centre[1] + c.pos[v * 3 + 1], c.centre[2] + c.pos[v * 3 + 2]]; return P.toL(fr, w[0], w[1], w[2], [0, 0, 0]); });
      // точка (x, z) внутри проекции треугольника на плоскость xz?
      const [A, B, C] = pts, d = (B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((x - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (z - A[2])) / d, v = ((B[0] - A[0]) * (z - A[2]) - (x - A[0]) * (B[2] - A[2])) / d;
      if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) { best = A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1]); break; }
    }
    if (best == null) continue;
    const inner = ls > 1.05 && ls < N - 1.05 && lt > 1.05 && lt < N - 1.05;
    if (inner) { worst = Math.max(worst, Math.abs(best - yP)); tested++; } else maxDiffEdge = Math.max(maxDiffEdge, Math.abs(best - yP));
  }
  ok(tested > 40 && worst < .02, 'внутри куска: высота физики = нарисованный треугольник (≤ 2 см)', { worst, tested });
  ok(maxDiffEdge < .02, 'у края куска — тоже нарисованный треугольник (T-075: диагональ b–c во всех клетках, кроме сшитых краёв)', maxDiffEdge);
  // море: уровень над дном; кривизна — у якоря 0, в 500 ед. ниже на ≈ 500² / 2R
  const sea0 = P.patchSea(fr, 0, 0), sea5 = P.patchSea(fr, 500, 0);
  ok(Math.abs(sea0) < 1e-9 && Math.abs(sea5 + 500 ** 2 / (2 * P.SEAR)) < .01, 'море — сфера (кривизна видна)', { sea0, sea5 });
  const c0 = P.cacheStats(); P.patchGround(fr, 10.1, 20.2); const c1 = P.cacheStats(); P.patchGround(fr, 10.15, 20.25); const c2 = P.cacheStats();
  ok(c2.miss === c1.miss && c2.hit > c1.hit && c1.miss >= c0.miss, 'кэш высот физики: соседняя точка — без новых высот', { c0, c1, c2 });
}

// ═══ 10. Точность «плавающего начала» в 10 000 км ═══
sec('точность: 10 000 км от центра — вершина у камеры точнее 0,1 мм (через float32 видеокарты), без якоря — ошибка ~1 ед.');
{
  const f32 = Math.fround;
  const BIG = PL.create({ ...PL.HOME, radius: 1e7 * (2.1 / 1.8), seed: 5 });   // 10 000 км (в метрах) — радиус в единицах движка
  const d = BIG.dirFromLatLon(33.3, 77.7), fr = BIG.patch(d);
  // кусок самого мелкого уровня у якоря и вершина в 2 ед. от камеры
  const F = PL.faceOf(d[0], d[1], d[2], [0, 0, 0]), L = 16, S = 2 ** L;
  const c = BIG.buildChunk(F[0], L, Math.floor((F[1] + 1) / 2 * S), Math.floor((F[2] + 1) / 2 * S), 32);
  let worstOur = 0, worstNaive = 0;
  for (let v = 0; v < 33 * 33; v += 7) {
    const P_BF = [c.centre[0] + c.pos[v * 3], c.centre[1] + c.pos[v * 3 + 1], c.centre[2] + c.pos[v * 3 + 2]];   // точно (double)
    const pl = BIG.toL(fr, P_BF[0], P_BF[1], P_BF[2], [0, 0, 0]);
    const cam = [pl[0] + 1.2, pl[1] + 1.6, pl[2] - .4];   // камера в 2 ед. от вершины
    const exact = [pl[0] - cam[0], pl[1] - cam[1], pl[2] - cam[2]];
    // наш путь: матрица куска (double) − камера (double) → float32 (как modelView в видеокарту); вершина — float32 от центра куска
    const T = BIG.toL(fr, c.centre[0], c.centre[1], c.centre[2], [0, 0, 0]), B = fr.B;
    const mv = [f32(T[0] - cam[0]), f32(T[1] - cam[1]), f32(T[2] - cam[2])];
    const Rm = [f32(B[0]), f32(B[1]), f32(B[2]), f32(B[3]), f32(B[4]), f32(B[5]), f32(B[6]), f32(B[7]), f32(B[8])];
    const lp = [c.pos[v * 3], c.pos[v * 3 + 1], c.pos[v * 3 + 2]];
    const ours = [0, 1, 2].map(r => f32(f32(f32(Rm[r * 3] * lp[0]) + f32(Rm[r * 3 + 1] * lp[1])) + f32(Rm[r * 3 + 2] * lp[2])) + mv[r]);
    worstOur = Math.max(worstOur, Math.hypot(ours[0] - exact[0], ours[1] - exact[1], ours[2] - exact[2]));
    // наивно: всё в float32 в координатах планеты
    const camBF = BIG.toBF(fr, cam[0], cam[1], cam[2], [0, 0, 0]);
    const naive = [f32(P_BF[0]) - f32(camBF[0]), f32(P_BF[1]) - f32(camBF[1]), f32(P_BF[2]) - f32(camBF[2])];
    const nl = BIG.dirToL(fr, naive[0], naive[1], naive[2], [0, 0, 0]);
    worstNaive = Math.max(worstNaive, Math.hypot(nl[0] - exact[0], nl[1] - exact[1], nl[2] - exact[2]));
  }
  globalThis.__prec = { worstOur, worstNaive };
  ok(worstOur < 1e-4, 'с якорем: ошибка вершины у камеры < 1e-4 ед.', worstOur);
  ok(worstNaive > .05, 'без якоря (всё во float32): ошибка заметна (ради сравнения)', worstNaive);
  console.log(`  10 000 км: с якорем ${worstOur.toExponential(2)} ед., всё во float32 ${worstNaive.toFixed(3)} ед.`);
}

// ═══ 11. Сутки, времена года, луна ═══
sec('сутки от вращения, времена года по календарю владельца, луна');
{
  const t = 1234.5, ms = Date.UTC(2026, 6, 1);
  const s = P.sunDir(t, ms), sub = P.dirFromLatLon(0, P.subSolarLon(t) * 180 / Math.PI);
  ok(Math.abs(P.localHour(sub, t) - 12) < 1e-9, 'под солнцем — полдень');
  const opp = [-sub[0], 0, -sub[2]]; const ol = Math.hypot(opp[0], opp[2]); opp[0] /= ol; opp[2] /= ol;
  ok(Math.abs(P.localHour(opp, t) % 24) < 1e-9 || Math.abs(P.localHour(opp, t) - 24) < 1e-9, 'напротив — полночь', P.localHour(opp, t));
  const east = P.dirFromLatLon(0, P.subSolarLon(t) * 180 / Math.PI + 15);
  ok(Math.abs(P.localHour(east, t) - 13) < 1e-9, 'на 15° восточнее — на час позже');
  const s2 = P.sunDir(t + P.def.day, ms);
  ok(Math.hypot(s[0] - s2[0], s[1] - s2[1], s[2] - s2[2]) < 1e-9, 'через сутки солнце там же');
  // через четверть суток в точке под солнцем — закат (солнце у горизонта)
  const s3 = P.sunDir(t + P.def.day / 4, ms); ok(Math.abs(dot(s3, sub)) < 1e-9, 'через 6 часов солнце у горизонта');
  // календарь владельца: декабрь–февраль — зима (склонение < 0: короткие дни на севере), ноябрь — осень; середина лета — склонение > 0
  require(path.join(SITE, 'js/engine/climate.js'));
  const C = globalThis.D37E.climate;
  const decl = (y, m, d) => P.declination(Date.UTC(y, m - 1, d, 12)) * 180 / Math.PI;
  ok(decl(2026, 12, 20) < -15 && decl(2027, 1, 15) < -22 && decl(2027, 2, 20) < -15, 'зима (декабрь–февраль) — солнце на юге, ниже всего в середине января', [decl(2026, 12, 20), decl(2027, 1, 15), decl(2027, 2, 20)]);
  // без скачка на стыках календаря (28 фев → 1 мар, 30 ноя → 1 дек)
  ok(Math.abs(decl(2027, 2, 28) - decl(2027, 3, 1)) < 1.5 && Math.abs(decl(2026, 11, 30) - decl(2026, 12, 1)) < 1.5, 'склонение без скачков на стыках календаря');
  let same = 0, tot = 0, maxD = 0;
  for (let k = 0; k < 400; k++) {
    const t0 = Date.UTC(2026, 0, 1) + k * 21.7 * 3600000 * 4.1;
    const a = P.season(t0), b = C.phaseCal(t0); tot++; if (a === b) same++;
    // без climate.js — запасная формула
    const D = globalThis.D37E.climate; globalThis.D37E.climate = undefined;
    const c2 = P.season(t0); globalThis.D37E.climate = D;
    maxD = Math.max(maxD, Math.abs(c2 - b));
  }
  ok(same === tot, 'фаза года = climate.js (календарь владельца)', { same, tot });
  ok(maxD < 1e-9, 'без climate.js (в потоке) — та же формула', maxD);
  // ноябрь всегда осень
  let novBad = 0; for (let dd = 1; dd <= 30; dd++) { const ph = P.season(Date.UTC(2027, 10, dd, 12)); if (Math.floor(ph) !== 2) novBad++; }
  ok(novBad === 0, 'ноябрь — осень', novBad);
  // луна-«украшение» профиля v1: на своём расстоянии, через период — там же (с учётом вращения планеты); у v2 — тело системы
  const PV1 = PL.create(PL.HOME_V1);
  const m1 = PV1.moonPos(0, 0), mm = PV1.def.moons[0];
  ok(P.moonPos(0, 0).every(x => x === 0), 'у v2 луна — не «украшение» (её место — в системе)');
  ok(Math.abs(Math.hypot(...m1) - mm.dist) < 1e-6 * mm.dist, 'луна на своём расстоянии');
  const lcm = mm.period * PV1.def.day / 2400;   // кратно обоим: 7 суток — луна и планета вернулись (период луны = 7 суток)
  const m2 = PV1.moonPos(0, mm.period);
  ok(Math.hypot(m1[0] - m2[0], m1[1] - m2[1], m1[2] - m2[2]) < 1e-3 * mm.dist, 'через период луны (7 суток) — там же', lcm);
}

// ═══ 12. Области ═══
sec('области: якорь — центр узла уровня LR (≈ 768 ед.), точка внутри своей области');
{
  const LR = P.regionLevel, size = Math.PI / 2 * R / 2 ** LR;
  ok(size > 500 && size < 1200, 'размер области ≈ 768 ед.', +size.toFixed(1));
  let bad = 0;
  for (let k = 0; k < 500; k++) {
    const d = randDir([0, 0, 0]), r = P.region(d), ang = Math.acos(Math.min(1, dot(d, r.dir)));
    if (ang > r.node.ang * 1.001) bad++;
  }
  ok(bad === 0, 'точка — в пределах своей области', bad);
  const r1 = P.region(P.dirFromLatLon(10, 10)), r2 = PL.create(PL.HOME).region(P.dirFromLatLon(10, 10));
  ok(r1.key === r2.key && r1.dir[0] === r2.dir[0], 'область и якорь у всех одинаковые (без сети)');
}

// ═══ 13. Атмосфера: функция Чепмена (как в шейдере) против численного интеграла ═══
sec('атмосфера: приближение Чепмена — в пределах 15 % от численного интеграла; луч в планету — тень');
{
  const R0 = 128000, Hs = [4000, 800];
  let worst = 0, n = 0, blocked = 0;
  const numInt = (H, alt0, mu) => {
    const o = [0, R0 + alt0], d = [Math.sqrt(1 - mu * mu), mu], ds = H / 200;
    let tau = 0;
    for (let s = 0; s < 4e6; s += ds) {
      const x = o[0] + d[0] * (s + ds / 2), y = o[1] + d[1] * (s + ds / 2), r = Math.hypot(x, y);
      if (r < R0) return Infinity;
      const a = r - R0; if (a > 30 * H) break;
      tau += Math.exp(-a / H) * ds;
    }
    return tau;
  };
  for (const H of Hs) for (const alt of [0, 600, 3000, 9000]) for (const mu of [1, .6, .3, .1, 0, -.05, -.12]) {
    const ex = numInt(H, alt, mu), ap = PL.chapman(R0 / H, alt / H, mu) * H;
    if (ex === Infinity) { if (ap >= 1e19) blocked++; else worst = Math.max(worst, 9); continue; }
    n++; worst = Math.max(worst, Math.abs(ap / ex - 1));
  }
  ok(n > 40 && worst < .15, 'оптическая толща к солнцу: ошибка ≤ 15 % (у Ми — высота 800, у Рэлея — 4000)', { worst: +worst.toFixed(3), n });
  console.log(`  функция Чепмена: наибольшая ошибка ${(worst * 100).toFixed(1)} %`);
  ok(blocked > 0, 'солнце за горизонтом (луч в планету) — тень', blocked);
}

// ═══ 14. Отсечение у земли (ошибка «камера у воды — горизонта нет» не вернётся) и чистка узлов ═══
sec('у земли выбраны только куски до горизонта; старые узлы чистятся');
{
  const cam = camAt(-20, 33, 3), D = Math.hypot(...cam), rocc = R + P.renderMin;
  const leaves = P.select(cam[0], cam[1], cam[2], { K: 1.4, maxL: 12 }, []);
  let beyond = 0;
  for (const n of leaves) {
    const a = Math.acos(Math.min(1, (cam[0] * n.c[0] + cam[1] * n.c[1] + cam[2] * n.c[2]) / D));
    if (a - n.ang > Math.acos(rocc / D) + Math.acos(rocc / (R + n.hmax)) + 1e-9) beyond++;
  }
  ok(beyond === 0 && leaves.length < 700, 'у земли (3 ед.): все куски — до горизонта, их немного', { leaves: leaves.length, beyond });
  const before = P.nodes.size;
  for (let k = 0; k < 640; k++) { const c = camAt(rnd() * 140 - 70, rnd() * 360 - 180, [3, 300, 30000][k % 3]); P.select(c[0], c[1], c[2], { K: 1.4, maxL: 12, keep: 60 }, []); }
  const after = P.nodes.size;
  ok(after < 60000, 'узлы не копятся без конца (чистка старых)', { before, after });
  const c2 = camAt(10, 20, 3), L2 = P.balance(P.select(c2[0], c2[1], c2[2], { K: 2, maxL: 12, cull: false }, []));
  let bad = 0; const dd = [0, 0, 0];
  for (let k = 0; k < 1500; k++) { randDir(dd); if (leafOf(L2, dd)[0] !== 1) bad++; }
  ok(bad === 0, 'после чистки выбор снова покрывает шар ровно один раз', bad);
}

// ═══ 15. Лёд, базис, одинаковость солнца и луны ═══
sec('замёрзшее море держит, базис = базис куска, солнце и луна у всех одинаковые');
{
  // точка замёрзшего моря у полюса
  let iceDir = null; const d = [0, 0, 0];
  for (let k = 0; k < 4000 && !iceDir; k++) { randDir(d); if (Math.abs(d[1]) > .9 && P.height(d[0], d[1], d[2]) < -40 && P.iceAt(d[0], d[1], d[2])) iceDir = d.slice(); }
  if (iceDir) {
    const fr = P.patch(iceDir), g = P.patchGround(fr, 0, 0), s = P.patchSea(fr, 0, 0);
    ok(Math.abs(g - s) < 1e-9 && P.patchWater(fr, 0, 0) === -Infinity, 'на льду — опора на уровне моря, не вода', { g, s });
  } else ok(false, 'нашлась точка замёрзшего моря');
  const B = P.basis([.3, .5, -.8], new Array(9)), fr = P.patch([.3, .5, -.8]);
  ok(B.every((v, i) => v === fr.B[i]), 'P.basis = базис плоского куска');
  const P2 = PL.create(PL.HOME), t = 98765.4, ms = Date.UTC(2027, 3, 3);
  const PV1 = PL.create(PL.HOME_V1), PV2 = PL.create(PL.HOME_V1);
  const s1 = P.sunDir(t, ms), s2 = P2.sunDir(t, ms), m1 = PV1.moonPos(0, t), m2 = PV2.moonPos(0, t);
  ok(s1.every((v, i) => v === s2[i]) && m1.every((v, i) => v === m2[i]), 'солнце и луна — от времени, у всех одинаковые (без сети)');
}

// ═══ 16. Профиль v2 (T-079): v1 поднимается сам, def(def(p)) = def(p), родная — та же поверхность до бита ═══
sec('профиль v2: подъём v1, повтор без изменений, свои поля, воздух и атмосфера, родная — та же планета до бита');
{
  const deepEq = (a, b) => { if (a === b) return true; if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return a !== a && b !== b; const ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false; for (const k of ka) if (!deepEq(a[k], b[k])) return false; return true; };
  const v1 = PL.def({ radius: 32000, temp: -5, air: true, o2: .1, pressure: .5, custom: { x: 1 } });
  ok(v1.v === 2 && v1.air && v1.air.p === 50.5 && v1.air.o2 === .1 && v1.temp.mean === -5 && v1.o2 === undefined && v1.custom.x === 1, 'v1: воздух и температура — в полях v2, свои поля на месте', { air: v1.air, temp: v1.temp });
  ok(PL.def({ air: false }).air === null && PL.def({ air: false }).atmo === null, 'v1: air: false → без воздуха и атмосферы');
  let same = 0, tot = 0;
  for (const p0 of [PL.HOME, PL.HOME_V1, {}, { radius: 32000, atmo: { tauM: .1 } }, { v: 2, id: 'dune', radius: 64000, air: { p: 6, dust: .4 }, atmo: { top: 16000, Hr: 2000, tint: '#d08a5a' }, orbit: { parent: 'sun', a: 6e9, e: .06, i: 1.8, M0: 189 }, moons: ['phob', { dist: 9e5, period: 5000 }, 'Плохое имя'] },
    { v: 2, id: 'gas', type: 'gas', surface: 'none', radius: 900000, air: { p: 9000, toxic: .6 }, rings: { inner: 1.3e6, outer: 2.3e6 } }, { v: 2, id: 'rock', air: null, gen: 'moon1', terra: { on: true, vars0: { p: 0, t: -30 } } }]) {
    const a = PL.def(p0), b = PL.def(a); tot++; if (deepEq(a, b)) same++; else console.log('   не повторяется:', p0.id || '?');
  }
  ok(same === tot, 'def(def(p)) = def(p) (поток получает уже проверенный профиль)', { same, tot });
  const dn = PL.def({ v: 2, id: 'dune', radius: 64000, air: { p: 6, dust: .4 }, atmo: { top: 16000, Hr: 2000, tint: '#d08a5a' }, moons: ['phob', { dist: 9e5, period: 5000 }, 'Плохое имя'] });
  ok(dn.atmo.top === 16000 && dn.atmo.Hr === 2000 && dn.atmo.tint === '#d08a5a' && dn.atmo.tauR[2] < .133 * .1, 'v2: недостающее в atmo — из воздуха (6 кПа: Рэлей в 17 раз слабее)', dn.atmo);
  ok(dn.moons.length === 2 && dn.moons[0] === 'phob' && dn.moons[1].rails === 'visual', 'v2: луны — id тел и «украшения»; плохой id отброшен', dn.moons);
  ok(PL.def({ v: 2 }).moons.length === 0 && PL.def({ v: 2 }).atmo === null && PL.def({ v: 2 }).year === 0, 'v2 без полей — без «родного»: ни Луны, ни воздуха, ни календаря');
  const mn = PL.def({ v: 2, id: 'rock', gen: 'moon1' });
  ok(mn.gen === 'moon1' && PL.create(mn).genOk === false && typeof PL.create(mn).height(0, 1, 0) === 'number', 'генератора ещё нет (moon1) — id сохраняется, рисует каменный');
  // родная v2 = родная v1 (та же поверхность: высоты, цвета, вода до бита)
  const A = PL.create(PL.HOME), B = PL.create(PL.HOME_V1);
  let diff = 0;
  for (const [f, L, i, j] of [[4, 8, 100, 100], [0, 5, 12, 20], [2, 10, 400, 600], [3, 3, 1, 6]]) {
    const ca = A.buildChunk(f, L, i, j, 32), cb = B.buildChunk(f, L, i, j, 32);
    for (let k = 0; k < ca.pos.length; k++) if (ca.pos[k] !== cb.pos[k]) diff++;
    for (let k = 0; k < ca.col.length; k++) if (ca.col[k] !== cb.col[k]) diff++;
  }
  ok(diff === 0, 'родная v2 — та же поверхность, что v1 (4 куска до бита)', diff);
  // склонение — точная формула (sin δ = sin ε · sin L): от прежней (ε·sin L) — меньше 0,3°
  let dmax = 0;
  for (let k = 0; k < 200; k++) { const ms = Date.UTC(2026, 0, 1) + k * 1.9e8; const ph = A.season(ms), old = 23.4 * Math.cos((ph - 1.5) * Math.PI / 2); dmax = Math.max(dmax, Math.abs(A.declination(ms) * 180 / Math.PI - old)); }
  ok(dmax < .3, 'склонение точное — от прежнего не больше 0,3°', +dmax.toFixed(3));
  // статические функции = функции планеты
  const ms = Date.UTC(2026, 9, 22, 12), t = 25436970;
  ok(PL.seasonOf(A.def, ms) === A.season(ms) && PL.declinationOf(A.def, ms) === A.declination(ms) && PL.subSolarLonOf(A.def, t) === A.subSolarLon(t), 'PL.seasonOf / declinationOf / subSolarLonOf = P.season / declination / subSolarLon');
}

// ═══ 16½. LOD v2 (T-075): поверхность до бита, «перетекание» — форма родителя, климат по широте ═══
sec('LOD v2: поверхность родной — до бита (свёртка); форма родителя в куске (перетекание без скачков); экранная ошибка');
{
  // свёртка pos/nrm/col 9 кусков (уровни 0–12, рёбра куба): то же число, что у кода до T-075 (поверхность не менялась)
  const list = [[4, 8, 100, 100], [0, 5, 12, 20], [2, 10, 400, 600], [3, 3, 1, 6], [1, 0, 0, 0], [5, 12, 2047, 1], [4, 12, 1234, 2345], [2, 1, 1, 0], [0, 7, 127, 0]];
  let h = 2166136261 >>> 0;
  const mix = x => { h = Math.imul(h ^ (x & 255), 16777619) >>> 0; };
  for (const [f, L, i, j] of list) { const c = P.buildChunk(f, L, i, j, 32); for (const k of ['pos', 'nrm', 'col']) { const u8 = new Uint8Array(c[k].buffer, c[k].byteOffset, c[k].byteLength); for (let q = 0; q < u8.length; q++) mix(u8[q]); } }
  ok(h === 620557642, 'поверхность родной до бита (pos, nrm, col 9 кусков — как до T-075)', h);
  // сборка «как раньше» (вид без LOD v2, флаги выкл): те же числа до бита, без формы родителя
  {
    let same = true, lite = true;
    for (const [f, L, i, j] of list) {
      const a = P.buildChunk(f, L, i, j, 32), b = P.buildChunk(f, L, i, j, 32, { lite: true });
      for (const k of ['pos', 'nrm', 'col', 'centre']) { const x = a[k], y = b[k]; if (x.length !== y.length) same = false; else for (let q = 0; q < x.length; q++) if (!Object.is(x[q], y[q])) { same = false; break; } }
      if (a.hmin !== b.hmin || a.hmax !== b.hmax || a.radius !== b.radius) same = false;
      if (b.md || b.np || b.colp || b.err !== -1) lite = false;
    }
    ok(same && lite, 'сборка без формы родителя (o.lite, флаги T-075 выкл): позиции, нормали, цвет, центр, высоты — те же до бита', { same, lite });
  }
  // форма родителя: чётные вершины — вершины родителя (позиция, нормаль, цвет — до бита / в пределах float32 центров); нечётные —
  // середина ребра или диагонали b–c родителя (сдвиг int16 — точнее 1/30000 наибольшего); err — наибольший сдвиг
  const N = 32, n1 = 33;
  let worstE = 0, worstO = 0, nBad = 0, cBad = 0, cOdd = 0, eBad = 0, tot = 0;
  for (const [f, L, i, j] of [[4, 9, 300, 201], [0, 6, 63, 10], [2, 4, 0, 15], [5, 11, 1500, 777], [1, 3, 7, 0], [3, 12, 4095, 2000]]) {
    const c = P.buildChunk(f, L, i, j, N), p = P.buildChunk(f, L - 1, i >> 1, j >> 1, N), cx = i & 1, cy = j & 1;
    const pv = (a, b) => (b * n1 + a);   // вершина родителя
    const BF = (ch, v) => [ch.centre[0] + ch.pos[v * 3], ch.centre[1] + ch.pos[v * 3 + 1], ch.centre[2] + ch.pos[v * 3 + 2]];
    const s = c.mscale / 32767;
    let em = 0;
    for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
      const v = b * n1 + a, X = BF(c, v), M = [X[0] + c.md[v * 4] * s, X[1] + c.md[v * 4 + 1] * s, X[2] + c.md[v * 4 + 2] * s];
      em = Math.max(em, Math.hypot(M[0] - X[0], M[1] - X[1], M[2] - X[2]));
      const pa = cx * N / 2 + a / 2, pb = cy * N / 2 + b / 2;   // точка в решётке родителя
      tot++;
      if (!(a & 1) && !(b & 1)) {
        const w = pv(pa, pb), Y = BF(p, w);
        worstE = Math.max(worstE, Math.hypot(M[0] - Y[0], M[1] - Y[1], M[2] - Y[2]) / (p.radius * 2e-7 + 1e-6));
        if (c.np[v * 4] !== p.nrm[w * 3] || c.np[v * 4 + 1] !== p.nrm[w * 3 + 1] || c.np[v * 4 + 2] !== p.nrm[w * 3 + 2]) nBad++;
        if (c.colp[v * 4] !== p.col[w * 4] || c.colp[v * 4 + 1] !== p.col[w * 4 + 1] || c.colp[v * 4 + 2] !== p.col[w * 4 + 2] || c.colp[v * 4 + 3] !== p.col[w * 4 + 3]) cBad++;
      } else {
        const A = (a & 1) && (b & 1) ? [Math.floor(pa) + 1, Math.floor(pb)] : (a & 1) ? [Math.floor(pa), pb] : [pa, Math.floor(pb)];
        const Bq = (a & 1) && (b & 1) ? [Math.floor(pa), Math.floor(pb) + 1] : (a & 1) ? [Math.floor(pa) + 1, pb] : [pa, Math.floor(pb) + 1];
        const wa = pv(A[0], A[1]), wb = pv(Bq[0], Bq[1]), YA = BF(p, wa), YB = BF(p, wb), Y = [(YA[0] + YB[0]) / 2, (YA[1] + YB[1]) / 2, (YA[2] + YB[2]) / 2];
        worstO = Math.max(worstO, Math.hypot(M[0] - Y[0], M[1] - Y[1], M[2] - Y[2]) / (c.mscale * 1e-4 + p.radius * 4e-7 + 1e-6));
        for (let q = 0; q < 4; q++) if (Math.abs(c.colp[v * 4 + q] - (p.col[wa * 4 + q] + p.col[wb * 4 + q]) / 2) > .51) cOdd++;
      }
    }
    if (Math.abs(em - c.err) > c.err * .01 + 1e-6) eBad++;
  }
  ok(worstE <= 1, 'чётные вершины в форме родителя — точка родителя (в пределах float32 центров)', worstE);
  ok(worstO <= 1, 'нечётные — середина ребра или диагонали b–c родителя (сдвиг int16)', worstO);
  ok(nBad === 0 && cBad === 0, 'нормаль и цвет родителя в чётных вершинах — до бита как у самого родителя', { nBad, cBad, tot });
  ok(cOdd === 0, 'цвет родителя в нечётных — среднее двух его вершин', cOdd);
  ok(eBad === 0, 'err куска — наибольший сдвиг к родителю', eBad);
  // корень: родителя нет — сдвигов нет, err неизвестен (−1)
  const r0 = P.buildChunk(2, 0, 0, 0, N);
  ok(r0.err === -1 && r0.mscale === 0 && r0.md.every((x, q) => q % 4 === 3 || x === 0), 'корень: своя форма, ошибка неизвестна');
  // экранная ошибка: у моря рядом с камерой куски крупнее суши; узел с ошибкой больше порога делится
  const leaves = [], S = { proj: 981, tau: 3, near: 24 };
  let sd = null; for (let k = 0; k < 3000 && !sd; k++) { const d = randDir([0, 0, 0]); if (Math.abs(d[1]) < .5 && P.height(d[0], d[1], d[2]) < -800) sd = d; }
  const cS = [sd[0] * (P.SEAR + 5), sd[1] * (P.SEAR + 5), sd[2] * (P.SEAR + 5)];   // открытое море, 5 ед. над водой
  P.select(cS[0], cS[1], cS[2], { maxL: 12, sse: S }, leaves); P.balance(leaves);
  ok(leaves.length > 6 && leaves.every(n => n.leaf === P.selMark()), 'выбор по экранной ошибке: листья — выбранные (сколько у моря с настоящими ошибками — planet-lod-test)', leaves.length);
  let gBad = 0; for (const n of leaves) if (n.L && n.par && n.par.eKs < n.eKs * 1.9) gBad++;
  ok(gBad === 0, 'у каждого листа ошибка родителя ≥ 1,9 × своей (потолок γ: перетекание сходится)', gBad);
}
sec('климат по широте (погода движка на планете: js/engine/climate.js)');
{
  const kinds = {}, at = (lat, lon) => P.climateAt(P.dirFromLatLon(lat, lon));
  let polar = 0, polarN = 0, warm = 0, warmN = 0;
  for (let k = 0; k < 600; k++) {
    const lat = -88 + rnd() * 176, lon = -180 + rnd() * 360, c = at(lat, lon);
    kinds[c] = (kinds[c] || 0) + 1;
    if (Math.abs(lat) > 72) { polarN++; if (c === 'snow' || c === 'sea') polar++; }
    if (Math.abs(lat) < 30) { warmN++; if (c !== 'snow') warm++; }
  }
  ok(polar / polarN > .9, 'у полюсов — снега (или море)', { polar, polarN });
  ok(warm === warmN, 'у экватора снегов нет', { warm, warmN });
  ok(['sea', 'snow', 'desert', 'steppe', 'temperate'].every(k => kinds[k] > 0) && Object.keys(kinds).every(k => ['sea', 'snow', 'desert', 'steppe', 'temperate', 'tropic', 'mountain'].includes(k)), 'климаты планеты — из списка движка (море, снега, пустыня, степь, умеренный…)', kinds);
  // погода движка по этому климату: у полюса холоднее, чем у экватора, в один и тот же момент
  require(path.join(SITE, 'js/engine/climate.js'));
  const C = globalThis.D37E.climate, Rr = P.R, D2 = 180 / Math.PI;
  const W = C.world({ seed: 'planet', mode: 'calendar', climateAt: (x, z) => P.climateAt(P.dirFromLatLon(Math.max(-90, Math.min(90, -z / Rr * D2)), x / Rr * D2)), lapse: -6.5 / 1166, seaY: 0 });
  const ms = Date.UTC(2027, 0, 15, 12), g = (lat, lon) => W.at(lon / D2 * Rr, -lat / D2 * Rr, ms, 10);
  const tPol = g(80, 30), tEq = g(2, 60);
  ok(tPol && tEq && tPol.temp < tEq.temp - 15, 'погода: у полюса холоднее экватора (январь)', { pol: tPol && tPol.temp, eq: tEq && tEq.temp });
}

// ═══ 17. Скорость ═══
sec('скорость (node; телефон с ЦП ×4 — примерно ×4)');
{
  const d = [0, 0, 0], N = 60000;
  const times = [];
  for (let rep = 0; rep < 3; rep++) {
    let t0 = process.hrtime.bigint(), s = 0;
    for (let i = 0; i < N; i++) { const a = i * .0137, b = i * .0071; d[0] = Math.cos(a) * Math.cos(b); d[1] = Math.sin(b); d[2] = Math.sin(a) * Math.cos(b); s += P.height(d[0], d[1], d[2]); }
    times.push(Number(process.hrtime.bigint() - t0) / 1e3 / N);
  }
  times.sort((a, b) => a - b);
  const us = times[1];
  const bt = [];
  for (let rep = 0; rep < 7; rep++) { const t0 = process.hrtime.bigint(); P.buildChunk(4, 10, 300 + rep, 400, 32); bt.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  bt.sort((a, b) => a - b);
  const sel = []; const cam = camAt(10, 20, 3);
  for (let rep = 0; rep < 9; rep++) { const t0 = process.hrtime.bigint(); const L = P.select(cam[0], cam[1], cam[2], { K: 2, maxL: 12 }, []); P.balance(L); for (const n of L) P.stitchMask(n); sel.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  sel.sort((a, b) => a - b);
  const fr = P.patch(P.dirFromLatLon(3, 3)), ph = [];
  for (let rep = 0; rep < 3; rep++) { const t0 = process.hrtime.bigint(); for (let k = 0; k < 2000; k++) P.patchGround(fr, (k % 40) * .3, (k % 37) * .3); ph.push(Number(process.hrtime.bigint() - t0) / 1e3 / 2000); }
  ph.sort((a, b) => a - b);
  console.log(`  высота: ${us.toFixed(2)} мкс; кусок 32×32: ${bt[3].toFixed(2)} мс (медиана); выбор + 2:1 + маски у земли: ${sel[4].toFixed(2)} мс; земля для физики: ${ph[1].toFixed(2)} мкс`);
  globalThis.__perf = { us, chunk: bt[3], sel: sel[4], phys: ph[1] };
  ok(us < 20, 'высота — меньше 20 мкс (запас под загрузку машины)', us);
  ok(bt[3] < 60, 'кусок — меньше 60 мс', bt[3]);
  ok(sel[4] < 15, 'выбор кусков — меньше 15 мс', sel[4]);
  ok(ph[1] < 15, 'земля для физики — меньше 15 мкс (кэш)', ph[1]);
}

console.log(`\nplanet-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — большая карта-рельеф (D37E.worldMap): горы, равнины, реки, озёра, моря; площадки городов и дороги
//  выравнивают землю. Всё — функция от зерна и данных места: у всех игроков одна и та же карта, сеть не нужна.
// ═══════════════════════════════════════
// WM = D37E.worldMap({ seed, half, sea, pads, roads, rivers, lakes, holes, oceans })
//   pads:   [{ id, x0, x1, z0, z1, y = 0, m = 8, blend = 110 }] — площадка города: ровно y (+ запас m), к природе — плавно
//   roads:  [{ id, w, pts: [[x, z], …] }] — дорога: полотно по сглаженному профилю (уклон ≤ 9 %), откосы; над рекой — мост
//   rivers: [{ id, w0, w1, depth, pts }] — река от истока к устью: уровень только вниз, русло врезается в склоны
//   lakes:  [{ id, x, z, r, depth }] — озеро: уровень ниже самого низкого края чаши (вода не «висит»)
//   holes:  [rect] — тут рельеф не рисуется (у бункера и канала свои стены и пол)
//   oceans: [rect] — тут обязано быть море (гавань боевой зоны и выход из неё)
// WM.height(x, z) — земля (рисунок); WM.ground(x, z) — физика (+ мосты); WM.water(x, z) — уровень воды или −∞;
// WM.road(x, z) — { id, d, y } ближайшей дороги (или null); WM.color(h, ny, x, z, out) — цвет земли;
// WM.trees(x0, z0, x1, z1, cb) — деревья (по зерну); WM.view(R, o) — рисование (чанки с LOD, вода, дороги, деревья).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const imul = Math.imul, floor = Math.floor, abs = Math.abs, min = Math.min, max = Math.max, sqrt = Math.sqrt, hypot = Math.hypot;
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = max(0, min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };   // a < b
  const sdown = (a, b, x) => 1 - sstep(a, b, x);   // 1 до a, 0 после b (a < b)

  // ── Шум: значения в узлах сетки по хешу, плавная склейка; каждая октава повёрнута (без «квадратиков») ──
  function h2(i, j, s){ let h = (imul(i, 374761393) ^ imul(j, 668265263) ^ imul(s, 1442695041)) | 0; h = imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  function vn(x, z, s){
    const xi = floor(x), zi = floor(z); let fx = x - xi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
    const a = h2(xi, zi, s), b = h2(xi + 1, zi, s), c = h2(xi, zi + 1, s), d = h2(xi + 1, zi + 1, s);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }
  const RC = Math.cos(.61), RS = Math.sin(.61);
  function fbm(x, z, s, n){
    let v = 0, a = .5, t = 0;
    for (let i = 0; i < n; i++) { v += vn(x, z, s + i * 17) * a; t += a; a *= .5; const nx = (x * RC - z * RS) * 2.03, nz = (x * RS + z * RC) * 2.03; x = nx + 5.3; z = nz - 2.9; }
    return v / t;
  }
  function ridge(x, z, s, n){
    let v = 0, a = .5, t = 0, w = 1;
    for (let i = 0; i < n; i++) {
      let r = 1 - abs(vn(x, z, s + i * 31) * 2 - 1); r *= r;
      v += r * a * w; w = min(1, r * 1.7); t += a; a *= .5;
      const nx = (x * RC - z * RS) * 2.1, nz = (x * RS + z * RC) * 2.1; x = nx - 3.1; z = nz + 7.7;
    }
    return v / t;
  }
  E.noise2 = { vn, fbm, ridge, h2 };

  const distRect = (r, x, z) => hypot(max(r.x0 - x, 0, x - r.x1), max(r.z0 - z, 0, z - r.z1));
  const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  // ближайшая точка отрезка: t (0…1) и расстояние
  const SEG = { t: 0, d: 0 };
  function seg(px, pz, x1, z1, x2, z2){
    const dx = x2 - x1, dz = z2 - z1, l = dx * dx + dz * dz;
    const t = l ? max(0, min(1, ((px - x1) * dx + (pz - z1) * dz) / l)) : 0;
    SEG.t = t; SEG.d = hypot(px - x1 - t * dx, pz - z1 - t * dz); return SEG;
  }

  E.worldMap = function (o = {}){
    const SEED = (o.seed ?? 37) | 0, HALF = o.half || 3072, SEA = o.sea ?? -.55;
    const PADS = (o.pads || []).map(p => ({ y: 0, m: 8, blend: 110, ...p }));
    const HOLES = o.holes || [], OCEANS = o.oceans || [];
    const G = 256, GN = Math.ceil(HALF * 2 / G) + 2;   // сетка-«корзины» для быстрых запросов (кто влияет на точку)
    const cellOf = v => max(0, min(GN - 1, floor((v + HALF) / G) + 1));
    const bins = new Map();
    const put = (x0, z0, x1, z1, item) => {
      for (let i = cellOf(x0); i <= cellOf(x1); i++) for (let j = cellOf(z0); j <= cellOf(z1); j++) {
        const k = i * GN + j; let L = bins.get(k); if (!L) bins.set(k, L = []); L.push(item);
      }
    };
    const near = (x, z) => bins.get(cellOf(x) * GN + cellOf(z)) || [];

    // ── Природа: материк в середине (к краям — море), горы гуще на севере, холмы, равнины ──
    function natural(x, z){
      const e = (max(abs(x), abs(z)) * .55 + hypot(x, z) * .38) / HALF;   // материк — скруглённый квадрат
      let L = sdown(.62, .98, e) * 1.4 - .38 + (fbm(x / 1150 + 3.7, z / 1150 - 1.3, SEED + 1, 3) - .5) * 1.2 + (fbm(x / 380, z / 380, SEED + 3, 2) - .5) * .35;
      for (const r of OCEANS) {   // обязательное море (гавань и выход в океан) — с неровным берегом
        const d0 = distRect(r, x, z); if (d0 > 420) continue;
        const d = max(0, d0 + (fbm(x / 300, z / 300, SEED + 7, 2) - .5) * 170);
        if (d < 260) L = min(L, -.3 + d / 260 * .45);
      }
      const north = sstep(-500, -2300, z) * .33 + sstep(-900, -2400, x) * sstep(200, -1600, z) * .22;
      const mk = sstep(.5, .74, fbm(x / 1750 + 9, z / 1750 + 4, SEED + 9, 2) + north);
      const hills = (fbm(x / 540, z / 540, SEED + 5, 4) - .5) * 66;
      const mt = mk > 0 ? mk * Math.pow(ridge(x / 780, z / 780, SEED + 13, 4), 1.45) * 470 : 0;
      const land = max(1.6, 13 + hills * (.4 + .6 * mk) + mt);
      if (L >= .14) return land;
      const deep = max(-70, -5 - (.14 - L) * 95);
      return L <= -.06 ? deep : lerp(deep, land, sstep(-.06, .14, L));
    }

    // ── Площадки (города, вокзалы, аэропорты): ровно y, потом плавно к природе ──
    for (const p of PADS) put(p.x0 - p.m - p.blend, p.z0 - p.m - p.blend, p.x1 + p.m + p.blend, p.z1 + p.m + p.blend, { k: 'pad', p });
    function withPads(x, z, h){
      for (const it of near(x, z)) {
        if (it.k !== 'pad') continue;
        const p = it.p, d = distRect(p, x, z);
        if (d <= p.m) h = p.y; else if (d < p.m + p.blend) h = lerp(p.y, h, sstep(0, 1, (d - p.m) / p.blend));
      }
      return h;
    }
    const base = (x, z) => withPads(x, z, natural(x, z));

    // ── Реки: профиль уровня — только вниз (как течёт вода), у моря — уровень моря ──
    const RIVERS = (o.rivers || []).map(rv => {
      const pts = rv.pts, cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1], n = max(2, Math.ceil(L / 8)), ys = new Float32Array(n + 1);
      let y = Infinity;
      for (let k = 0; k <= n; k++) {
        const P = at(pts, cum, L * k / n), hb = base(P[0], P[1]);
        y = min(y, hb - 1.1); if (hb < SEA + .3) y = SEA;
        ys[k] = max(SEA, y);
      }
      const R = { ...rv, w0: rv.w0 || 8, w1: rv.w1 || rv.w0 || 14, depth: rv.depth || 2.2, cum, L, n, ys };
      for (let i = 1; i < pts.length; i++) {
        const wmax = max(R.w0, R.w1) / 2 + 210;
        put(min(pts[i - 1][0], pts[i][0]) - wmax, min(pts[i - 1][1], pts[i][1]) - wmax, max(pts[i - 1][0], pts[i][0]) + wmax, max(pts[i - 1][1], pts[i][1]) + wmax, { k: 'river', R, i });
      }
      return R;
    });
    function at(pts, cum, s){
      let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], l = cum[i] - cum[i - 1] || 1, t = max(0, min(1, (s - cum[i - 1]) / l));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    const riverY = (R, s) => { const f = max(0, min(R.n, s / R.L * R.n)), k = floor(f), t = f - k; return k >= R.n ? R.ys[R.n] : R.ys[k] + (R.ys[k + 1] - R.ys[k]) * t; };
    // ближайшая река в точке: { R, d, s (по длине), y (уровень), half (полуширина) }
    const RQ = { R: null, d: 0, s: 0, y: 0, half: 0 };
    function riverAt(x, z){
      let best = Infinity; RQ.R = null;
      for (const it of near(x, z)) {
        if (it.k !== 'river') continue;
        const R = it.R, a = R.pts[it.i - 1], b = R.pts[it.i], q = seg(x, z, a[0], a[1], b[0], b[1]);
        if (q.d < best) { best = q.d; RQ.R = R; RQ.d = q.d; RQ.s = R.cum[it.i - 1] + (R.cum[it.i] - R.cum[it.i - 1]) * q.t; }
      }
      if (!RQ.R) return null;
      RQ.y = riverY(RQ.R, RQ.s); RQ.half = lerp(RQ.R.w0, RQ.R.w1, RQ.s / RQ.R.L) / 2;
      return RQ;
    }

    // ── Озёра: уровень — ниже самого низкого края чаши ──
    const LAKES = (o.lakes || []).map(lk => {
      let rim = Infinity;
      for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2; rim = min(rim, base(lk.x + Math.cos(t) * lk.r * 1.15, lk.z + Math.sin(t) * lk.r * 1.15)); }
      const L = { ...lk, depth: lk.depth || 5, wl: max(SEA + .5, rim - 1.2) };
      put(lk.x - lk.r - 130, lk.z - lk.r - 130, lk.x + lk.r + 130, lk.z + lk.r + 130, { k: 'lake', L });
      return L;
    });

    // ── Дороги: профиль по длине — сглаженная земля (с площадками), уклон ≤ 9 %, над рекой — мост (выше воды на 2,6) ──
    const ROADS = (o.roads || []).map(rd => {
      const pts = rd.pts, cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1], n = max(2, Math.ceil(L / 4)), st = L / n, ys = new Float32Array(n + 1), pin = new Int8Array(n + 1), riv = new Float32Array(n + 1).fill(-Infinity);
      for (let k = 0; k <= n; k++) {
        const P = at(pts, cum, k * st);
        ys[k] = max(SEA + 1.2, base(P[0], P[1]));
        for (const it of near(P[0], P[1])) if (it.k === 'pad' && distRect(it.p, P[0], P[1]) <= it.p.m) { ys[k] = it.p.y; pin[k] = 1; }
        const q = riverAt(P[0], P[1]);
        if (q && q.d < q.half + 3) riv[k] = q.y + 2.6;
      }
      const tmp = new Float32Array(n + 1), RAD = 12;
      for (let pass = 0; pass < 3; pass++) {
        for (let k = 0; k <= n; k++) { let s = 0, c = 0; for (let j = max(0, k - RAD); j <= min(n, k + RAD); j++) { s += ys[j]; c++; } tmp[k] = pin[k] ? ys[k] : s / c; }
        ys.set(tmp);
        for (let k = 0; k <= n; k++) if (riv[k] > ys[k]) ys[k] = riv[k];
      }
      const md = .09 * st;   // уклон
      for (let k = 1; k <= n; k++) if (!pin[k]) ys[k] = max(ys[k - 1] - md, min(ys[k - 1] + md, ys[k]));
      for (let k = n - 1; k >= 0; k--) if (!pin[k]) ys[k] = max(ys[k + 1] - md, min(ys[k + 1] + md, ys[k]));
      for (let k = 0; k <= n; k++) if (riv[k] > ys[k]) ys[k] = riv[k];
      const R = { ...rd, w: rd.w || 8, cum, L, n, ys, riv };
      for (let i = 1; i < pts.length; i++) {
        const m = R.w / 2 + 22;
        put(min(pts[i - 1][0], pts[i][0]) - m, min(pts[i - 1][1], pts[i][1]) - m, max(pts[i - 1][0], pts[i][0]) + m, max(pts[i - 1][1], pts[i][1]) + m, { k: 'road', R, i });
      }
      return R;
    });
    const roadY = (R, s) => { const f = max(0, min(R.n, s / R.L * R.n)), k = floor(f), t = f - k; return k >= R.n ? R.ys[R.n] : R.ys[k] + (R.ys[k + 1] - R.ys[k]) * t; };
    const DQ = { R: null, d: 0, s: 0, y: 0, id: '' };
    function roadAt(x, z){
      let best = Infinity; DQ.R = null;
      for (const it of near(x, z)) {
        if (it.k !== 'road') continue;
        const R = it.R, a = R.pts[it.i - 1], b = R.pts[it.i], q = seg(x, z, a[0], a[1], b[0], b[1]);
        if (q.d < best) { best = q.d; DQ.R = R; DQ.d = q.d; DQ.s = R.cum[it.i - 1] + (R.cum[it.i] - R.cum[it.i - 1]) * q.t; }
      }
      if (!DQ.R) return null;
      DQ.y = roadY(DQ.R, DQ.s); DQ.id = DQ.R.id; return DQ;
    }

    // ── Высота земли: природа → площадки → дороги (полотно и откосы) → реки и озёра врезаются ──
    function height(x, z){
      let h = base(x, z);
      const lst = near(x, z);
      if (!lst.length) return floorOf(x, z, h);
      for (const it of lst) {
        if (it.k !== 'road') continue;
        const R = it.R, a = R.pts[it.i - 1], b = R.pts[it.i], q = seg(x, z, a[0], a[1], b[0], b[1]), half = R.w / 2 + 1.6;
        if (q.d > half + 16) continue;
        const y = roadY(R, R.cum[it.i - 1] + (R.cum[it.i] - R.cum[it.i - 1]) * q.t);
        h = q.d <= half ? y : lerp(y, h, sstep(0, 1, (q.d - half) / 16));
      }
      const r = riverAt(x, z);
      if (r && r.d < r.half + 210) {   // долина: у воды — берег, дальше склон ~27°
        const dp = r.R.depth, carve = r.d < r.half ? r.y - dp * (1 - (r.d / r.half) ** 2) + .25 : r.y + .45 + (r.d - r.half) * .52;
        if (carve < h) h = carve;
      }
      for (const it of lst) {
        if (it.k !== 'lake') continue;
        const L = it.L, d = hypot(x - L.x, z - L.z);
        if (d > L.r + 130) continue;
        const carve = d < L.r ? L.wl - L.depth * (1 - (d / L.r) ** 2) + .3 : L.wl + .5 + (d - L.r) * .85;
        if (carve < h) h = carve;
      }
      return floorOf(x, z, h);
    }
    const FLOORS = OCEANS.filter(r => r.floor !== undefined);
    function floorOf(x, z, h){ for (const r of FLOORS) if (inRect(r, x, z)) h = min(h, r.floor); return h; }   // гавань: ровное дно у набережной
    // физика: земля + мосты (над рекой полотно дороги держит, как настил)
    function ground(x, z){
      const h = height(x, z), q = roadAt(x, z);
      if (q && q.d < q.R.w / 2 + .4 && q.y > h + .3) return q.y;
      return h;
    }
    function water(x, z){
      let w = -Infinity;
      const r = riverAt(x, z);
      if (r && r.d < r.half + .6) w = r.y;
      for (const it of near(x, z)) if (it.k === 'lake' && hypot(x - it.L.x, z - it.L.z) < it.L.r + .5) w = max(w, it.L.wl);
      if (w === -Infinity && height(x, z) < SEA + .02) w = SEA;
      return w;
    }

    // ── Цвет земли: песок у воды, трава (сочная/степь), лес темнее, скалы на склонах, снег на вершинах ──
    function color(h, ny, x, z, out, wet = h < SEA + 3){   // wet — рядом море (пляж); ровные площадки у моря — не песок
      const n = vn(x / 37, z / 37, SEED + 71), dry = fbm(x / 1300 + 2, z / 1300 - 7, SEED + 77, 2);
      let r = lerp(.36, .62, sstep(.45, .75, dry)) + (n - .5) * .06, g = lerp(.6, .58, sstep(.45, .75, dry)) + (n - .5) * .07, b = lerp(.28, .3, dry);
      const fo = forest(x, z);
      if (fo > 0) { const k = fo * .55; r = lerp(r, .23, k); g = lerp(g, .43, k); b = lerp(b, .2, k); }
      const sand = wet ? sdown(SEA + 1.4, SEA + 3.4, h) * (h > SEA - 30 ? 1 : 0) : 0;
      if (sand > 0) { r = lerp(r, .86, sand); g = lerp(g, .78, sand); b = lerp(b, .55, sand); }
      if (h < SEA - .4) { const k = min(1, (SEA - h) / 14); r = lerp(.74, .45, k); g = lerp(.68, .5, k); b = lerp(.5, .42, k); }
      const rock = max(sstep(.86, .72, ny), sstep(170 + n * 40, 240 + n * 40, h));
      if (rock > 0) { r = lerp(r, .5 + n * .06, rock); g = lerp(g, .49 + n * .05, rock); b = lerp(b, .47 + n * .05, rock); }
      const snow = sstep(285 + n * 50, 320 + n * 50, h) * sstep(.62, .8, ny);
      if (snow > 0) { r = lerp(r, .95, snow); g = lerp(g, .97, snow); b = lerp(b, 1, snow); }
      out[0] = r; out[1] = g; out[2] = b; return out;
    }
    // лес: где влажно и не высоко
    function forest(x, z){ const f = fbm(x / 620 - 4, z / 620 + 6, SEED + 41, 3); return sstep(.53, .62, f); }

    // ── Деревья: по ячейкам 18 ед. (зерно) — в лесу густо, в поле редко; не на дорогах, площадках, у воды, на скалах ──
    const TC = 18;
    function trees(x0, z0, x1, z1, cb){
      for (let i = floor(x0 / TC); i <= floor(x1 / TC); i++) for (let j = floor(z0 / TC); j <= floor(z1 / TC); j++) {
        const r1 = h2(i, j, SEED + 101);
        const x = (i + .15 + .7 * h2(i, j, SEED + 102)) * TC, z = (j + .15 + .7 * h2(i, j, SEED + 103)) * TC;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const fo = forest(x, z), want = fo > 0 ? .25 + fo * .65 : .035;
        if (r1 > want) continue;
        if (blockedTree(x, z)) continue;
        const h = height(x, z);
        if (h < SEA + 2.2 || h > 250) continue;
        const sl = abs(height(x + 2, z) - height(x - 2, z)) + abs(height(x, z + 2) - height(x, z - 2));
        if (sl > 3.2) continue;
        const k = .85 + h2(i, j, SEED + 104) * .7, pine = h > 120 || (fo > .3 && h2(i, j, SEED + 105) < .45);
        cb(x, h, z, k, pine ? 1 : 0, h2(i, j, SEED + 106));
      }
    }
    function blockedTree(x, z){
      for (const it of near(x, z)) {
        if (it.k === 'pad' && distRect(it.p, x, z) < it.p.m + 14) return true;
        if (it.k === 'lake' && hypot(x - it.L.x, z - it.L.z) < it.L.r + 6) return true;
      }
      const q = roadAt(x, z); if (q && q.d < q.R.w / 2 + 6) return true;
      const r = riverAt(x, z); if (r && r.d < r.half + 5) return true;
      return HOLES.some(h => inRect(h, x, z, 8));
    }

    const WM = { SEED, HALF, SEA, PADS, HOLES, OCEANS, RIVERS, LAKES, ROADS, natural, base, height, ground, water, color, forest, trees,
      road: roadAt, river: riverAt, roadY, riverY, at, inRect, distRect };
    WM.view = (R, vo = {}) => E.worldMapView(WM, R, vo);
    return WM;
  };

  // ═══ Рисунок: чанки-квадраты дерева (quadtree) — рядом мельче (сетка 32 × 32), вдали — крупнее; юбки по краям прячут щели
  //     между уровнями. Вода (море клетками, реки лентами, озёра) и дороги — по одной сетке на всё; деревья — экземплярами
  //     рядом с камерой; тела деревьев — только рядом с игроком ═══
  E.worldMapView = function (WM, R, vo = {}){
    const T = R.T, q = R.q || 'mid', low = q === 'low', mob = !!E.isMobile?.();
    const N = 32, MIN = 128, HALF = WM.HALF;
    const farOf = () => typeof vo.far === 'function' ? vo.far() : vo.far || (low || mob ? 1100 : 1900);   // дальше — не рисуем (туман)
    let far = farOf();
    const grp = new T.Group(); grp.name = 'worldmap'; R.scene.add(grp);
    const own = [];
    const mat = low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0 });
    mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 4;   // ровные площадки городов (своя земля) — поверх
    own.push(mat);
    const cache = new Map();   // ключ узла → { mesh, used }
    const col = [0, 0, 0];
    const holeSkip = (x, z, m) => WM.HOLES.some(h => x > h.x0 - m && x < h.x1 + m && z > h.z0 - m && z < h.z1 + m);
    function buildNode(x0, z0, size){
      const s = size / N, n1 = N + 1, gw = N + 3;
      const H = new Float32Array(gw * gw);
      for (let j = 0; j < gw; j++) for (let i = 0; i < gw; i++) H[j * gw + i] = WM.height(x0 + (i - 1) * s, z0 + (j - 1) * s);
      const vcount = n1 * n1 + 4 * n1, pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3), cl = new Float32Array(vcount * 3);
      let v = 0;
      const put = (x, y, z, nx, ny, nz, c) => { pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z; nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz; cl[v * 3] = c[0]; cl[v * 3 + 1] = c[1]; cl[v * 3 + 2] = c[2]; return v++; };
      for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
        const k = (j + 1) * gw + (i + 1), h = H[k];
        let nx = H[k - 1] - H[k + 1], nz = H[k - gw] - H[k + gw], ny = 2 * s; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const x = x0 + i * s, z = z0 + j * s;
        WM.color(h, ny, x, z, col, min(H[k - 1], H[k + 1], H[k - gw], H[k + gw], h) < WM.SEA + .2);
        col[0] = col[0] ** 2.2; col[1] = col[1] ** 2.2; col[2] = col[2] ** 2.2;   // цвета карты — как на экране (sRGB), вершинам — линейные
        put(x, h, z, nx, ny, nz, col);
      }
      const idx = [];
      const hm = s * 1.01;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const cx = x0 + (i + .5) * s, cz = z0 + (j + .5) * s;
        if (WM.HOLES.length && holeSkip(cx, cz, hm)) continue;
        const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      // юбки: край опущен — щели между крупным и мелким соседом не видно
      const sk = s * 2.5;
      const edge = (list) => {
        const top = [], bot = [];
        for (const k of list) { top.push(k); bot.push(put(pos[k * 3], pos[k * 3 + 1] - sk, pos[k * 3 + 2], nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2], [cl[k * 3] * .8, cl[k * 3 + 1] * .8, cl[k * 3 + 2] * .8])); }
        for (let k = 0; k < top.length - 1; k++) idx.push(top[k], bot[k], top[k + 1], top[k + 1], bot[k], bot[k + 1]);
      };
      const rowN = [], rowS = [], colW = [], colE = [];
      for (let i = 0; i < n1; i++) { rowN.push(i); rowS.push(N * n1 + (N - i)); colW.push((N - i) * n1); colE.push(i * n1 + N); }
      edge(rowN.reverse()); edge(rowS.reverse()); edge(colW.reverse()); edge(colE.reverse());
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos.subarray(0, v * 3), 3));
      g.setAttribute('normal', new T.BufferAttribute(nor.subarray(0, v * 3), 3));
      g.setAttribute('color', new T.BufferAttribute(cl.subarray(0, v * 3), 3));
      g.setIndex(idx);
      g.computeBoundingSphere();
      const m = new T.Mesh(g, mat); m.receiveShadow = !low; m.castShadow = false; m.matrixAutoUpdate = false; m.updateMatrix();
      m.userData.dyn = true;
      return m;
    }
    // какие узлы нужны: делим, пока узел крупный и близко
    const want = [];
    // узел целиком под ровной площадкой города — не нужен (там своя земля)
    const underPad = (x0, z0, size) => WM.PADS.some(p => x0 >= p.x0 && x0 + size <= p.x1 && z0 >= p.z0 && z0 + size <= p.z1);
    function walk(x0, z0, size, cx, cz){
      const dx = max(x0 - cx, 0, cx - (x0 + size)), dz = max(z0 - cz, 0, cz - (z0 + size)), d = Math.hypot(dx, dz);
      if (d > far || underPad(x0, z0, size)) return;
      if (size > MIN && d < size * .9) { const h = size / 2; walk(x0, z0, h, cx, cz); walk(x0 + h, z0, h, cx, cz); walk(x0, z0 + h, h, cx, cz); walk(x0 + h, z0 + h, h, cx, cz); return; }
      want.push([x0, z0, size, d]);
    }
    let lastX = Infinity, lastZ = Infinity, shown = new Set(), pending = false, tick = 0;
    const V = { grp, nodes: () => shown.size, cache: () => cache.size, built: 0 };
    // Подгрузка по кусочку: нужный узел ещё не готов — вместо него виден ближайший готовый «родитель» (крупнее), а его готовые
    // «дети» на это время прячутся (без дыр и без наложений); старые узлы — прочь, когда кэш большой
    function refresh(cx, cz, force){
      want.length = 0; far = farOf();
      walk(-HALF, -HALF, HALF * 2, cx, cz);
      want.sort((a, b) => a[3] - b[3]);
      let budget = force ? 1e9 : (mob || low ? 1 : 3), missing = 0;
      const vis = new Map(), cover = [];   // key → [x0, z0, size]; «родители» вместо неготовых
      for (const w of want) {
        const key = w[0] + ':' + w[1] + ':' + w[2];
        let e = cache.get(key);
        if (!e && budget-- > 0) { e = { mesh: buildNode(w[0], w[1], w[2]), used: 0 }; cache.set(key, e); V.built++; }
        if (e) { e.used = tick; vis.set(key, w); continue; }
        missing++;
        let s = w[2], ax = w[0], az = w[1], found = null;
        while (s < HALF * 2) { s *= 2; ax = Math.floor((ax + HALF) / s) * s - HALF; az = Math.floor((az + HALF) / s) * s - HALF; const k = ax + ':' + az + ':' + s; if (cache.has(k)) { found = [k, ax, az, s]; break; } }
        if (found && !cover.some(c => c[0] === found[0])) { cover.push(found); cache.get(found[0]).used = tick; }
      }
      for (const c of cover) {   // «родитель» закрывает всех своих «детей»
        for (const [k, w] of vis) if (w[0] >= c[1] && w[0] < c[1] + c[3] && w[1] >= c[2] && w[1] < c[2] + c[3]) vis.delete(k);
        vis.set(c[0], [c[1], c[2], c[3]]);
      }
      for (const c of cover) for (const d of cover) if (c !== d && c[3] < d[3] && c[1] >= d[1] && c[1] < d[1] + d[3] && c[2] >= d[2] && c[2] < d[2] + d[3]) vis.delete(c[0]);
      pending = missing > 0;
      for (const k of shown) if (!vis.has(k)) { const e = cache.get(k); if (e) grp.remove(e.mesh); }
      for (const k of vis.keys()) if (!shown.has(k)) { const e = cache.get(k); if (e) grp.add(e.mesh); }
      shown = new Set(vis.keys());
      if (cache.size > 150) {   // старые — прочь (не те, что на экране)
        const old = [...cache.entries()].filter(([k]) => !shown.has(k)).sort((a, b) => a[1].used - b[1].used);
        for (const [k, e] of old.slice(0, cache.size - 110)) { e.mesh.geometry.dispose(); cache.delete(k); }
      }
    }

    // ── Вода: море клетками 48 ед. (только где дно ниже моря), реки — лентами, озёра — кругами; одна сетка ──
    const waterM = R.water ? R.water(vo.waterColor || '#2f7fc1', { key: 'wmsea', fixedColor: true }) : new T.MeshLambertMaterial({ color: '#2f7fc1', transparent: true, opacity: .85 });
    if (waterM.side !== undefined) waterM.side = T.DoubleSide;
    {
      const P = [], C = 48, n = Math.ceil(HALF * 2 / C), SEA = WM.SEA, ext = 1400;
      const quad = (x0, z0, x1, z1, y) => P.push(x0, y, z0, x0, y, z1, x1, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
      const n1 = n + 1, cor = new Float32Array(n1 * n1);   // углы клеток — общие (в 5 раз меньше выборок)
      for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) cor[j * n1 + i] = WM.height(-HALF + i * C, -HALF + j * C);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x0 = -HALF + i * C, z0 = -HALF + j * C;
        let lo = min(cor[j * n1 + i], cor[j * n1 + i + 1], cor[(j + 1) * n1 + i], cor[(j + 1) * n1 + i + 1]);
        if (lo >= SEA + .05 && lo < SEA + 4) lo = min(lo, WM.height(x0 + C / 2, z0 + C / 2));
        if (lo < SEA + .05) quad(x0, z0, x0 + C, z0 + C, SEA);
      }
      // за краем карты — океан до горизонта
      quad(-HALF - ext, -HALF - ext, HALF + ext, -HALF, SEA); quad(-HALF - ext, HALF, HALF + ext, HALF + ext, SEA);
      quad(-HALF - ext, -HALF, -HALF, HALF, SEA); quad(HALF, -HALF, HALF + ext, HALF, SEA);
      for (const Rv of WM.RIVERS) {
        const st = 8, n2 = Math.ceil(Rv.L / st);
        let prev = null;
        for (let k = 0; k <= n2; k++) {
          const s = min(Rv.L, k * st), p = WM.at(Rv.pts, Rv.cum, s), p2 = WM.at(Rv.pts, Rv.cum, min(Rv.L, s + 1)), p0 = WM.at(Rv.pts, Rv.cum, max(0, s - 1));
          let tx = p2[0] - p0[0], tz = p2[1] - p0[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const hw = lerp(Rv.w0, Rv.w1, s / Rv.L) / 2 + .9, y = WM.riverY(Rv, s) + .02;
          const cur = [p[0] - tz * hw, y, p[1] + tx * hw, p[0] + tz * hw, y, p[1] - tx * hw];
          if (prev) P.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...prev.slice(3), ...prev.slice(3), ...cur.slice(0, 3), ...cur.slice(3));
          prev = cur;
        }
      }
      for (const L of WM.LAKES) {
        const seg = 28;
        for (let k = 0; k < seg; k++) {
          const a = k / seg * Math.PI * 2, b = (k + 1) / seg * Math.PI * 2, r = L.r + 1.5;
          P.push(L.x, L.wl, L.z, L.x + Math.cos(b) * r, L.wl, L.z + Math.sin(b) * r, L.x + Math.cos(a) * r, L.wl, L.z + Math.sin(a) * r);
        }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
      const w = new T.Mesh(g, waterM); w.userData.dyn = true; w.renderOrder = 2; w.frustumCulled = false; grp.add(w); own.push(g);
      V.water = w;
    }

    // ── Дороги: лента асфальта по профилю + разметка; на мостах — перила и опоры ──
    {
      const am = vo.asphalt || R.mat('#4b5563', { rough: .9 }), lm = R.mat('#f1f5f9', { rough: .6 }), rm = R.mat('#9ca3af', { rough: .7 });
      const PA = [], PL = [], PR = [];
      for (const Rd of WM.ROADS) {
        const st = 4, n2 = Math.ceil(Rd.L / st); let prev = null, prevL = null;
        for (let k = 0; k <= n2; k++) {
          const s = min(Rd.L, k * st), p = WM.at(Rd.pts, Rd.cum, s), p2 = WM.at(Rd.pts, Rd.cum, min(Rd.L, s + 1)), p0 = WM.at(Rd.pts, Rd.cum, max(0, s - 1));
          let tx = p2[0] - p0[0], tz = p2[1] - p0[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
          const y = WM.roadY(Rd, s) + .07, hw = Rd.w / 2;
          const cur = [p[0] - tz * hw, y, p[1] + tx * hw, p[0] + tz * hw, y, p[1] - tx * hw];
          if (prev) PA.push(...prev.slice(0, 3), ...cur.slice(0, 3), ...prev.slice(3), ...prev.slice(3), ...cur.slice(0, 3), ...cur.slice(3));
          prev = cur;
          if (k % 3 === 0 && k < n2) {   // штрих по середине
            const q = WM.at(Rd.pts, Rd.cum, min(Rd.L, s + 4)), y2 = WM.roadY(Rd, min(Rd.L, s + 4)) + .09, a = .12;
            PL.push(p[0] - tz * a, y + .02, p[1] + tx * a, q[0] - tz * a, y2, q[1] + tx * a, p[0] + tz * a, y + .02, p[1] - tx * a,
              p[0] + tz * a, y + .02, p[1] - tx * a, q[0] - tz * a, y2, q[1] + tx * a, q[0] + tz * a, y2, q[1] - tx * a);
          }
          // мост: перила (полоски) и опоры
          const ki = Math.min(Rd.n, Math.round(s / Rd.L * Rd.n));
          if (Rd.riv[ki] > -Infinity) {
            for (const sd of [-1, 1]) { const ox = -tz * (hw + .2) * sd, oz = tx * (hw + .2) * sd; PR.push(p[0] + ox, y, p[1] + oz, p[0] + ox, y + 1, p[1] + oz, p[0] + ox + tx * 4, y, p[1] + oz + tz * 4, p[0] + ox + tx * 4, y, p[1] + oz + tz * 4, p[0] + ox, y + 1, p[1] + oz, p[0] + ox + tx * 4, y + 1, p[1] + oz + tz * 4); }
            if (k % 4 === 0) { const hb = WM.height(p[0], p[1]); if (y - hb > 1.5) for (const sd of [-1, 1]) { const cx = p[0] - tz * (hw - .8) * sd, cz = p[1] + tx * (hw - .8) * sd, a = .45; PR.push(cx - a, hb, cz, cx - a, y, cz, cx + a, hb, cz, cx + a, hb, cz, cx - a, y, cz, cx + a, y, cz, cx, hb, cz - a, cx, y, cz - a, cx, hb, cz + a, cx, hb, cz + a, cx, y, cz - a, cx, y, cz + a); } }
          }
          prevL = p;
        }
      }
      for (const [arr, m, ro] of [[PA, am, 1], [PL, lm, 1], [PR, rm, 0]]) {
        if (!arr.length) continue;
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); g.computeBoundingSphere();
        const msh = new T.Mesh(g, m); msh.receiveShadow = !low; msh.userData.dyn = true; msh.frustumCulled = false;
        if (ro) { msh.material = m.clone(); msh.material.polygonOffset = true; msh.material.polygonOffsetFactor = -1; msh.material.polygonOffsetUnits = -2; msh.material.side = T.DoubleSide; own.push(msh.material); }
        else { msh.material = m.clone(); msh.material.side = T.DoubleSide; own.push(msh.material); }
        grp.add(msh); own.push(g);
      }
    }

    // ── Деревья рядом с камерой: экземпляры (ствол, крона-конус у ели, крона-шар у лиственного) ──
    const TR = low ? 160 : mob ? 200 : 320, TMAX = low ? 400 : mob ? 700 : 1600;
    const trunkG = new T.CylinderGeometry(.22, .32, 1, 6); trunkG.translate(0, .5, 0);
    const pineG = new T.ConeGeometry(1.7, 4.6, 7); pineG.translate(0, 4.4, 0);
    const leafG = new T.IcosahedronGeometry(2.1, 0); leafG.translate(0, 4.2, 0);
    own.push(trunkG, pineG, leafG);
    const trunkM = R.mat('#6b4423', { rough: .9 }), pineM = R.mat('#2f6b3a', { rough: .9 }), leafM = R.mat('#4f9a45', { rough: .9 });
    const mkI = (g, m) => { const im = new T.InstancedMesh(g, m, TMAX); im.count = 0; im.castShadow = !low; im.receiveShadow = !low; im.frustumCulled = false; im.userData.dyn = true; grp.add(im); return im; };
    const iTrunk = mkI(trunkG, trunkM), iPine = mkI(pineG, pineM), iLeaf = mkI(leafG, leafM);
    const tm = new T.Matrix4(), tq = new T.Quaternion(), ts = new T.Vector3(), tp = new T.Vector3(), te = new T.Euler(), tc = new T.Color();
    let tX = Infinity, tZ = Infinity;
    function plantTrees(cx, cz){
      let nT = 0, nP = 0, nL = 0;
      WM.trees(cx - TR, cz - TR, cx + TR, cz + TR, (x, y, z, k, pine, r) => {
        if (nT >= TMAX || (x - cx) ** 2 + (z - cz) ** 2 > TR * TR) return;
        te.set(0, r * 6.28, 0); tq.setFromEuler(te);
        ts.set(k, k * (pine ? 1.25 : 1), k); tp.set(x, y - .1, z); tm.compose(tp, tq, ts); iTrunk.setMatrixAt(nT++, tm);
        ts.set(k * (.85 + r * .3), k * (pine ? 1.1 + r * .3 : .9 + r * .3), k * (.85 + r * .3)); tm.compose(tp, tq, ts);
        if (pine) iPine.setMatrixAt(nP++, tm); else { iLeaf.setMatrixAt(nL, tm); tc.setHSL(.27 + r * .07, .45, .36 + r * .12); iLeaf.setColorAt(nL++, tc); }
      });
      iTrunk.count = nT; iPine.count = nP; iLeaf.count = nL;
      for (const im of [iTrunk, iPine, iLeaf]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    }
    // тела деревьев рядом с игроком (дорого держать все — только в радиусе 45)
    const bodies = new Map();
    let bX = Infinity, bZ = Infinity;
    function treeBodies(ph, px, pz){
      if (!ph?.addCyl) return;
      const keep = new Set();
      WM.trees(px - 45, pz - 45, px + 45, pz + 45, (x, y, z, k) => {
        const key = Math.round(x * 4) + ':' + Math.round(z * 4); keep.add(key);
        if (!bodies.has(key)) bodies.set(key, ph.addCyl({ x, z, y: y + 2, r: .32 * k + .05, hy: 2, tag: 'tree' }));
      });
      for (const [key, b] of bodies) if (!keep.has(key)) { ph.remove?.(b); bodies.delete(key); }
    }

    V.update = (cx, cz, o = {}) => {
      tick++;
      if (pending || Math.hypot(cx - lastX, cz - lastZ) > 24 || o.force) { const first = lastX === Infinity; lastX = cx; lastZ = cz; refresh(cx, cz, first || o.force); }
      if (Math.hypot(cx - tX, cz - tZ) > (mob ? 52 : 40)) { tX = cx; tZ = cz; plantTrees(cx, cz); }
      const px = o.px ?? cx, pz = o.pz ?? cz;
      if (o.ph && Math.hypot(px - bX, pz - bZ) > 8) { bX = px; bZ = pz; treeBodies(o.ph, px, pz); }
    };
    V.dispose = (ph) => {
      for (const e of cache.values()) e.mesh.geometry.dispose();
      cache.clear();
      for (const b of bodies.values()) ph?.remove?.(b);
      bodies.clear();
      for (const x of own) x.dispose?.();
      R.scene.remove(grp);
    };
    return V;
  };
})();

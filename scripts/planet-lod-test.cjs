// LOD v2 планеты (T-075, PL-2) без браузера: node scripts/planet-lod-test.cjs [--fast]
// Моделирует вид планеты как в js/engine/planet-view.js — выбор кусков, показ по шагам, перетекание, «потоки» с задержкой и
// пропускной способностью телефона — на спуске с орбиты к земле (обычном и очень быстром) и на подъёме. На каждой смене уровня
// считает НАСТОЯЩИЙ скачок: показанная форма до и после (с перетеканием по вершинам, как шейдер) — наибольшее расстояние, в
// единицах и в пикселях экрана телефона. То же — для прежнего LOD (выбор по K, без перетекания: «до»). Плюс: показанное покрывает
// шар ровно один раз и соседи отличаются ≤ 1 уровня (каждый шаг), перетекание сходится (k → 0 у земли), скорость.
const path = require('path');
const SITE = path.join(__dirname, '..');
require(path.join(SITE, 'js/engine/planet.js'));
const PL = globalThis.D37E.planet;
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, +(process.env.LOD_DBG || 400)) : ''); } };
const sec = t => console.log('— ' + t);
const N = 32, n1 = N + 1, P2 = k => 2 ** k;
const H_PX = 915, PROJ = H_PX / (2 * Math.tan(25 * Math.PI / 180));   // телефон 412 × 915 (CSS), угол обзора 50°
const TAU = 3, FULL = TAU * 1.7, FADE = .12, GATE = .05, NEAR = 24, K_OLD = 1.0;

// ── «Вид» без three.js: кэш кусков, очередь с пропускной способностью, выбор / показ / перетекание ──
function makeView(P, mode, o = {}){
  const data = new Map(), pend = new Map();
  let frame = 0, tSel = -1e9;
  const thr = o.thr ?? 1.5, lat = o.lat ?? 3;   // кусков за кадр (2 потока телефона), кадров до готовности
  const ready = n => data.has(n.key);
  const get = n => data.get(n.key);
  for (let f = 0; f < 6; f++) { const n = P.node(f, 0, 0, 0), c = P.buildChunk(f, 0, 0, 0, N); data.set(n.key, c); P.nodeRange(n, c.hmin, c.hmax); P.nodeErr(n, c.err); }
  const leaves = [], show = [], pre = [], peekL = [];
  const SSE = { proj: PROJ, tau: TAU, near: NEAR, pre, preK: .6, pred: null }, MORPH = { tau: TAU, full: FULL, fade: FADE, proj: PROJ };
  let bias = 1;   // бюджет кусков, как в planet-view.js (телефон — 220)
  const LEAF_MAX = o.leafMax ?? 220;
  let acc = 0, built = 0;
  const V = { P, data, show, leaves, mode, built: () => built, events: [], frame: () => frame };
  // заявка живёт до следующего выбора (как очередь вида: каждый выбор — заново); пришла снова — та же (готовность не сдвигается)
  let reqM = 0;
  function request(n, imp){ if (data.has(n.key)) return; const r = pend.get(n.key); if (r) { r.m = reqM; if (imp > r.imp) r.imp = imp; return; } pend.set(n.key, { n, at: frame + lat, imp, m: reqM }); }
  function work(){
    acc += thr;
    const L = [...pend.values()].filter(r => r.at <= frame).sort((a, b) => b.imp - a.imp);
    for (const r of L) { if (acc < 1) break; acc -= 1; const c = P.buildChunk(r.n.f, r.n.L, r.n.i, r.n.j, N); data.set(r.n.key, c); P.nodeRange(r.n, c.hmin, c.hmax); P.nodeErr(r.n, c.err); pend.delete(r.n.key); built++; }
    if (acc > 2) acc = 2;
  }
  // прежний показ: лист не готов — ближайший готовый предок; показанный предок прячет потомков
  let vm = 1;
  function oldShow(){
    vm++;
    const vis = [];
    for (const n of leaves) {
      if (ready(n)) { if (n.vis !== vm) { n.vis = vm; vis.push(n); } continue; }
      request(n, n.size / 1e3);
      let a = n.par; while (a && !ready(a)) a = a.par;
      if (a && a.vis !== vm) { a.vis = vm; vis.push(a); }
    }
    show.length = 0;
    for (const n of vis) { let a = n.par, hid = false; while (a) { if (a.vis === vm) { hid = true; break; } a = a.par; } if (!hid) show.push(n); else n.vis = 0; }
    for (const n of show) n.k = 0;
  }
  V.step = (cam, tms) => {
    frame++;
    if (tms - tSel >= (V.pending ? 60 : 125)) {
      tSel = tms;
      reqM++;
      const before = new Map(show.map(n => [n.key, n]));
      const snap = snapshot(show);
      if (mode === 'new') {
        SSE.tau = MORPH.tau = TAU * bias; MORPH.full = MORPH.tau * 1.7;
        P.select(cam[0], cam[1], cam[2], { maxL: 12, sse: SSE }, leaves); P.balance(leaves);
        const st = P.lodShow(ready, tms, { gate: GATE, leaves }, show);
        if (leaves.length > LEAF_MAX) bias = Math.min(4, bias * 1.06); else if (leaves.length < LEAF_MAX * .8) bias = Math.max(1, bias / 1.03);
        V.pending = st.wait > 0 || st.split > 0 || st.merge > 0 || st.need.length > 0;
        // очередь по ступеням, как в planet-view.js: шаг → на уровень вперёд → листья у показанного (≤ 2 уровней) → заранее
        for (const n of st.need) request(n, 3e6 + n.imp);
        for (const n of st.ahead) request(n, 2e6 + n.imp);
        for (const n of leaves) { let a = n, dl = 0; while (a && a.dis !== st.mark) { a = a.par; dl++; } if (dl && dl <= 2) request(n, 1e6 + (n.rho || 0)); }
        let pk = 0; for (const n of pre) { if (pk >= 6) break; for (const k of P.children(n)) if (!data.has(k.key) && pk < 6) { request(k, Math.min(1e5, n.rho || 0)); pk++; } }
        // куда летим через 0,6 с: оттуда нужное, что отсюда ещё за горизонтом
        if (V.prev) { const dt = (tms - V.prevT) / 1000 || 1, vx = (cam[0] - V.prev[0]) / dt, vy = (cam[1] - V.prev[1]) / dt, vz = (cam[2] - V.prev[2]) / dt;
          if (Math.hypot(vx, vy, vz) > 2) for (const n of P.peek(cam[0], cam[1], cam[2], cam[0] + vx * .6, cam[1] + vy * .6, cam[2] + vz * .6, { cap: 16 }, peekL)) request(n, 5e5 + n.imp); }
        V.prev = cam.slice(); V.prevT = tms;
      } else {
        P.select(cam[0], cam[1], cam[2], { K: K_OLD, maxL: 12 }, leaves); P.balance(leaves);
        oldShow();
      }
      for (const [k, r] of pend) if (r.m !== reqM) pend.delete(k);   // больше не нужна
      const after = new Map(show.map(n => [n.key, n]));
      const added = [...after.values()].filter(n => !before.has(n.key)), removed = [...before.values()].filter(n => !after.has(n.key));
      if (added.length || removed.length) V.events.push({ t: tms, cam: cam.slice(), added, removed, snap, mode });
    }
    work();
    if (mode === 'new') P.lodMorph(show, cam[0], cam[1], cam[2], tms, MORPH);
  };
  // показанная форма каждого узла (k, k краёв) — на момент «до» смены
  function snapshot(list){ const m = new Map(); for (const n of list) m.set(n.key, { n, k: n.k || 0, ke: n.ke ? Array.from(n.ke) : [0, 0, 0, 0] }); return m; }
  V.snapshot = snapshot;
  return V;
}

// k вершины (a, b) — как в шейдере (planet-view.js d37Mk)
function kVert(k, ke, a, b){
  const W = 4, cl = x => x < 0 ? 0 : x > 1 ? 1 : x, mix = (x, y, t) => x + (y - x) * t;
  let v = k;
  v = mix(ke[0], v, cl(a / W)); v = mix(ke[1], v, cl((N - a) / W)); v = mix(ke[2], v, cl(b / W)); v = mix(ke[3], v, cl((N - b) / W));
  if (b === 0) v = ke[2]; else if (b === N) v = ke[3];
  if (a === 0) v = ke[0]; else if (a === N) v = ke[1];
  return v;
}
// показанные вершины узла (система планеты, double): своя форма + k · сдвиг к родителю
function dispVerts(c, k, ke){
  const out = new Float64Array(n1 * n1 * 3), s = c.mscale / 32767;
  for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
    const v = b * n1 + a, kk = kVert(k, ke, a, b);
    for (let q = 0; q < 3; q++) out[v * 3 + q] = c.centre[q] + c.pos[v * 3 + q] + kk * c.md[v * 4 + q] * s;
  }
  return out;
}
// показанная поверхность узла n в точке решётки грани (gi, gj при стороне M): клетка и треугольник (диагональ b–c, как сетка)
function evalAt(n, dv, gi, gj, M, out){
  const Mn = N * P2(n.L), s = gi * Mn / M - n.i * N, t = gj * Mn / M - n.j * N;
  const qa = Math.min(N - 1, Math.max(0, Math.floor(s))), qb = Math.min(N - 1, Math.max(0, Math.floor(t))), u = s - qa, w = t - qb;
  const id = (a, b) => (b * n1 + a) * 3;
  let A, B, C, ua, wa;
  if (u + w <= 1) { A = id(qa, qb); B = id(qa + 1, qb); C = id(qa, qb + 1); ua = u; wa = w; }
  else { A = id(qa + 1, qb + 1); B = id(qa, qb + 1); C = id(qa + 1, qb); ua = 1 - u; wa = 1 - w; }
  for (let q = 0; q < 3; q++) out[q] = dv[A + q] + ua * (dv[B + q] - dv[A + q]) + wa * (dv[C + q] - dv[A + q]);
  return out;
}
// скачок события: каждая вершина появившегося — против прежней показанной поверхности в этой точке (предок или потомки), и
// каждая вершина пропавшего — против новой; пиксели — с расстояния до камеры
function eventJump(V, ev){
  const P = V.P, cam = ev.cam, tmp = [0, 0, 0];
  let wMax = 0, pxMax = 0, why = null;
  const dispOf = new Map();
  const disp = (n, st) => { const k = n.key + ':' + (st ? 'a' : 'b'); if (!dispOf.has(k)) { const s = st ? { k: n.k || 0, ke: n.ke ? Array.from(n.ke) : [0, 0, 0, 0] } : ev.snap.get(n.key); dispOf.set(k, dispVerts(V.data.get(n.key), s.k, s.ke)); } return dispOf.get(k); };
  const afterKeys = new Set(V.show.map(n => n.key));
  // кто покрывал точку (лист решётки X: узел n, вершина a, b) в наборе S (ключи) — предок или потомок того же узла
  const coverIn = (n, gi, gj, M, keys) => {
    for (let a = n; a; a = a.par) if (keys.has(a.key)) return a;
    let m = n;
    for (let g = 0; g < 14 && m.L < 12; g++) {
      const kids = P.children(m), Mm = N * P2(m.L + 1), s = gi * Mm / M, t = gj * Mm / M;
      const ci = Math.max(0, Math.min(1, Math.floor(s / N) - m.i * 2)), cj = Math.max(0, Math.min(1, Math.floor(t / N) - m.j * 2));
      m = kids[cj * 2 + ci];   // порядок детей: (2i, 2j), (2i+1, 2j), (2i, 2j+1), (2i+1, 2j+1)
      if (keys.has(m.key)) return m;
    }
    return null;
  };
  const beforeKeys = new Set(ev.snap.keys());
  const compare = (list, newSide) => {
    for (const n of list) {
      if (!V.data.has(n.key)) continue;
      const dvN = disp(n, newSide), M = N * P2(n.L);
      for (let b = 0; b <= N; b++) for (let a = 0; a <= N; a++) {
        const gi = n.i * N + a, gj = n.j * N + b, other = coverIn(n, gi, gj, M, newSide ? beforeKeys : afterKeys);
        if (!other || other === n || !V.data.has(other.key)) continue;
        evalAt(other, disp(other, !newSide), gi, gj, M, tmp);
        const v = (b * n1 + a) * 3, dx = dvN[v] - tmp[0], dy = dvN[v + 1] - tmp[1], dz = dvN[v + 2] - tmp[2], j = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const cx = dvN[v] - cam[0], cy = dvN[v + 1] - cam[1], cz = dvN[v + 2] - cam[2], d = Math.max(1, Math.sqrt(cx * cx + cy * cy + cz * cz));
        if (j > wMax) wMax = j;
        const px = j * PROJ / d; if (px > pxMax) { pxMax = px; why = { side: newSide ? 'new' : 'old', L: n.L, a, b, k: newSide ? n.k : ev.snap.get(n.key)?.k, oL: other.L, oK: newSide ? ev.snap.get(other.key)?.k : other.k, d: +d.toFixed(1), kv: +kVert(newSide ? n.k : ev.snap.get(n.key).k, newSide ? (n.ke ? Array.from(n.ke) : [0,0,0,0]) : ev.snap.get(n.key).ke, a, b).toFixed(3), ke: newSide && n.ke ? Array.from(n.ke).map(x => +x.toFixed(2)) : null, rel: n.rel ? Array.from(n.rel) : null, oMask: other.mask, oRel: other.rel ? Array.from(other.rel) : null, oKe: ev.snap.get(other.key)?.ke?.map(x => +x.toFixed(2)), nI: n.i, nJ: n.j, oI: other.i, oJ: other.j, j: +j.toFixed(3) }; }
      }
    }
  };
  compare(ev.added, true); compare(ev.removed, false);
  return { w: wMax, px: pxMax, why };
}
// показанное: каждая проверочная точка — ровно в одном узле (или ни в одном — за горизонтом); соседи — не больше уровня
function checkCover(P, show, dirs, now = 0){
  const keys = new Map(show.map(n => [n.key, n])), F = [0, 0, 0];
  let multi = 0, lev = 0, levStand = 0;
  for (const d of dirs) {
    PL.faceOf(d[0], d[1], d[2], F);
    let hit = 0;
    for (let L = 0; L <= 12; L++) { const S = P2(L), i = Math.min(S - 1, Math.floor((F[1] + 1) / 2 * S)), j = Math.min(S - 1, Math.floor((F[2] + 1) / 2 * S)); if (keys.has(PL.key(F[0], L, i, j))) hit++; }
    if (hit > 1) multi++;
  }
  // «поднялось из-за горизонта» (ближайший готовый крупнее соседей на 2+ и его дети, ≤ 3 с) — допустимо: щель закрывают юбки, скачка нет
  for (const n of show) for (let e = 0; e < 4; e++) { const nb = P.neighbor(n, e); for (let a = nb.par; a; a = a.par) if (keys.has(a.key) && a.L < n.L - 1) { if (now - a.standT < 3000) levStand++; else { lev++; if (process.env.LOD_DBG && lev < 3) console.log("   2:1", JSON.stringify({ t: +(now / 1000).toFixed(2), n: [n.L, +(n.k || 0).toFixed(2), +((now - n.tShow) / 1000).toFixed(2)], nInfo: { leaf: n.leaf === P.selMark(), used: n.used === P.selMark(), split: n.split, parLeaf: n.par.leaf === P.selMark(), parUsed: n.par.used === P.selMark(), parSplit: n.par.split, sibs: P.children(n.par).map(x => (keys.has(x.key) ? "S" : "-") + (x.leaf === P.selMark() ? "L" : "")).join(" "), gp: n.par.par ? [n.par.par.leaf === P.selMark(), n.par.par.used === P.selMark(), n.par.par.split, keys.has(n.par.par.key)] : null, pKe: n.ke ? Array.from(n.ke).map(x => +x.toFixed(2)) : null }, a: [a.L, +(a.k || 0).toFixed(2), +((now - a.standT) / 1000).toFixed(1), a.split && a.used === P.selMark(), P.children(a).map(x => +(x.err >= 0)).join("")], aShownFor: a.tShow ? +((now - a.tShow) / 1000).toFixed(2) : "merge/stand/root", aMrg: a.mrg, edge: e, nPar: [n.par.L, n.par.tShow ? +((now - n.par.tShow)/1000).toFixed(2) : 0], faces: [n.f, a.f] })); } break; } }
  return { multi, lev, levStand };
}

const cam = (P, lat, lon, alt) => { const d = P.dirFromLatLon(lat, lon), h = Math.max(P.renderMin, P.height(d[0], d[1], d[2])), r = P.R + h + alt; return [d[0] * r, d[1] * r, d[2] * r]; };
let rs = 777; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const dirs = Array.from({ length: 1500 }, () => { let x, y, z, l; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = Math.hypot(x, y, z); } while (l > 1 || l < .1); return [x / l, y / l, z / l]; });

// путь камеры: высота по экспоненте от a0 до a1 за T с (потом стоим stay с); место — LAT, LON
function run(mode, { a0, a1, T, stay = 3, lat = 29, lon = 81, thr = 1.5 }){
  const P = PL.create(PL.HOME), V = makeView(P, mode, { thr });
  const t0 = process.hrtime.bigint();
  let worst = { w: 0, px: 0 }, cover = { multi: 0, lev: 0 }, n = 0, pxSum = 0, cnt = 0, frames = 0, tConv = -1, cLast = null;
  for (let t = 0; t < (T + stay) * 1000; t += 1000 / 60) {
    const s = Math.min(1, t / (T * 1000)), alt = a0 * Math.pow(a1 / a0, s), c = cLast = cam(P, lat, lon, alt);
    const ne = V.events.length;
    V.step(c, t); frames++;
    for (let q = ne; q < V.events.length; q++) {
      const j = eventJump(V, V.events[q]); n++; pxSum += j.px; if (j.px > .05) cnt++;
      if (j.px > worst.px) {
        const E = V.events[q], dsc = x => ({ L: x.L, k: +(x.k || 0).toFixed(3), kS: E.snap.get(x.key) ? +E.snap.get(x.key).k.toFixed(3) : null, ke: x.ke ? Array.from(x.ke).map(v => +v.toFixed(2)) : null, tS: x.tShow ? +((t - x.tShow) / 1000).toFixed(3) : 0, rho: +(x.rho || 0).toFixed(2), split: x.split });
        worst = { ...j, t: +(t / 1000).toFixed(2), alt: +alt.toFixed(1), add: E.added.slice(0, 6).map(dsc), rem: E.removed.slice(0, 6).map(dsc), nA: E.added.length, nR: E.removed.length };
      }
      if (j.w > (worst.wMax || 0)) worst.wMax = j.w;
    }
    if (frames % 30 === 0 && mode === 'new') { const cc = checkCover(P, V.show, dirs, t); cover.multi += cc.multi; cover.lev += cc.lev; cover.levStand = (cover.levStand || 0) + cc.levStand; }
    if (tConv < 0 && t >= T * 1000 && V.show.length === V.leaves.length && V.show.every(x => x.leaf === P.selMark())) tConv = +((t - T * 1000) / 1000).toFixed(2);   // показ = выбор
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const lv = {}; for (const x of V.show) lv[x.L] = (lv[x.L] || 0) + 1;
  // под камерой — самый мелкий уровень и своя форма (физика = нарисованное); в покое k не меняются (ничего не «плывёт»)
  const F3 = PL.faceOf(...cLast.map(x => x / Math.hypot(...cLast)), [0, 0, 0]), under = V.show.find(x => { const S = 2 ** x.L; return x.f === F3[0] && x.i === Math.min(S - 1, Math.floor((F3[1] + 1) / 2 * S)) && x.j === Math.min(S - 1, Math.floor((F3[2] + 1) / 2 * S)); });
  const k1 = V.show.map(x => x.k || 0); V.step(cLast, (T + stay) * 1000 + 500); const still = V.show.every((x, q) => Math.abs((x.k || 0) - (k1[q] ?? -1)) < 1e-9);
  return { mode, tConv, under: under ? { L: under.L, k: under.k || 0 } : null, still, events: n, popPx: +worst.px.toFixed(3), popW: +(worst.wMax || 0).toFixed(3), at: worst, avgPx: +(pxSum / Math.max(1, n)).toFixed(4), over005: cnt, cover, shown: V.show.length, leaves: V.leaves.length, built: V.built(), ms: Math.round(ms), maxK: Math.max(0, ...V.show.map(x => x.k || 0)), lv };
}

const out = {};
sec('спуск с орбиты к земле (как «⬇ Вниз»: 28 с) — скачок на смене уровня, новое против прежнего');
{
  const P = { a0: 300000, a1: 3, T: FAST ? 14 : 28 };
  const b = out.descentOld = run('old', P), a = out.descent = run('new', P);
  console.log(`  прежний LOD: смен ${b.events}, наибольший скачок ${b.popPx} пикс. (${b.popW} ед.), средний ${b.avgPx}, у земли кусков ${b.shown}, построено ${b.built}`);
  console.log(`  LOD v2:      смен ${a.events}, наибольший скачок ${a.popPx} пикс. (${a.popW} ед.), средний ${a.avgPx}, у земли кусков ${a.shown} (целей ${a.leaves}), построено ${a.built}`);
  ok(b.popPx > 2, 'прежний LOD скачет (для сравнения)', b.popPx);
  ok(a.popPx < .35, 'LOD v2: наибольший скачок меньше 0,35 пикселя', a.at);
  ok(a.cover.multi === 0, 'показанное покрывает шар ровно один раз (каждые полсекунды)', a.cover);
  ok(a.cover.lev === 0, 'показанные соседи отличаются не больше чем на уровень (маски сшивки верны)', a.cover);
  ok(a.shown === a.leaves, 'у земли показ дошёл до выбранного', { shown: a.shown, leaves: a.leaves });
  ok(a.under && a.under.L === 12 && a.under.k === 0, 'под камерой — самый мелкий уровень в своей форме (физика = нарисованное)', a.under);
  ok(a.still, 'в покое перетекание стоит (ничего не плывёт)');
}
sec('очень быстрый спуск (×6, как «быстрее»: орбита → земля за 2 с) — скачков нет, уровень догоняет');
{
  const P = { a0: 300000, a1: 3, T: 2, stay: FAST ? 10 : 12 };
  const b = out.fastOld = run('old', P), a = out.fast = run('new', P);
  console.log(`  прежний LOD: наибольший скачок ${b.popPx} пикс. (${b.popW} ед.), построено ${b.built}, догнал за ${b.tConv} с; LOD v2: ${a.popPx} пикс. (${a.popW} ед.), смен ${a.events}, построено ${a.built}, догнал за ${a.tConv} с`);
  ok(a.popPx < .35, 'быстрый спуск: скачок меньше 0,35 пикселя', a.at);
  ok(a.cover.multi === 0 && a.cover.lev === 0, 'быстрый спуск: покрытие и 2 : 1', a.cover);
  ok(a.tConv >= 0 && a.tConv < 9, 'быстрый спуск: показ догнал выбор быстрее 9 с (пропускная способность телефона)', { tConv: a.tConv, shown: a.shown, leaves: a.leaves });
}
sec('подъём от земли на орбиту (слияние кусков) — без скачков');
{
  const P = { a0: 3, a1: 300000, T: FAST ? 8 : 14 };
  const a = out.ascent = run('new', P), b = out.ascentOld = run('old', P);
  console.log(`  подъём: LOD v2 ${a.popPx} пикс., прежний ${b.popPx} пикс.; смен ${a.events}`);
  ok(a.popPx < .5, 'подъём: скачок меньше 0,5 пикселя', a.at);
  ok(a.cover.multi === 0 && a.cover.lev === 0, 'подъём: покрытие и 2 : 1', a.cover);
}
sec('кусков у земли: море крупнее суши (экранная ошибка), а не всё до мелкого уровня');
{
  const P = PL.create(PL.HOME), L = [];
  // точка в открытом море и на суше в горах
  let sea = null, land = null; const d = [0, 0, 0];
  for (let k = 0; k < 4000 && !(sea && land); k++) { const x = rnd() * 2 - 1, y = (rnd() * 2 - 1) * .7, z = rnd() * 2 - 1, l = Math.hypot(x, y, z); d[0] = x / l; d[1] = y / l; d[2] = z / l; const h = P.height(d[0], d[1], d[2]); if (!sea && h < -600) sea = d.slice(); if (!land && h > 900) land = d.slice(); }
  const count = (dd, mode) => {
    const V = makeView(P, mode, { thr: 1e9, lat: 0 }), c = [dd[0] * (P.R + Math.max(0, P.height(...dd)) + 3), dd[1] * (P.R + Math.max(0, P.height(...dd)) + 3), dd[2] * (P.R + Math.max(0, P.height(...dd)) + 3)];
    for (let t = 0; t < 9000; t += 1000 / 60) V.step(c, t);
    return { shown: V.show.length, maxL: Math.max(...V.show.map(x => x.L)) };
  };
  const sN = count(sea, 'new'), sO = count(sea, 'old'), lN = count(land, 'new'), lO = count(land, 'old');
  out.counts = { sea: { old: sO, v2: sN }, land: { old: lO, v2: lN } };
  console.log(`  море: прежний ${sO.shown} кусков (до ур. ${sO.maxL}), v2 ${sN.shown} (до ур. ${sN.maxL}); горы: прежний ${lO.shown}, v2 ${lN.shown} (до ур. ${lN.maxL})`);
  ok(sN.shown < sO.shown, 'в море кусков меньше, чем было', out.counts.sea);
  ok(lN.shown <= 220 * 1.15, 'в горах — не больше бюджета телефона (220, допуск 15 %)', out.counts.land);
  ok(lN.maxL === 12 && sN.maxL === 12, 'рядом с игроком — самый мелкий уровень (физика = нарисованное)', { lN, sN });
}
sec('скорость (node, ядро ПК; телефон ×4)');
{
  const P = PL.create(PL.HOME), V = makeView(P, 'new', { thr: 1e9, lat: 0 }), c = cam(P, 29, 81, 3);
  for (let t = 0; t < 6000; t += 1000 / 60) V.step(c, t);
  const sel = [], mor = [];
  const show = [], leaves = [], SSE = { proj: PROJ, tau: TAU, near: NEAR, pre: [], preK: .6 };
  for (let r = 0; r < 15; r++) {
    let t0 = process.hrtime.bigint();
    P.select(c[0], c[1], c[2], { maxL: 12, sse: SSE }, leaves); P.balance(leaves); P.lodShow(n => V.data.has(n.key), 9000 + r * 125, { gate: GATE, leaves }, show);
    sel.push(Number(process.hrtime.bigint() - t0) / 1e6);
    t0 = process.hrtime.bigint();
    for (let q = 0; q < 10; q++) P.lodMorph(show, c[0], c[1], c[2], 9000 + r * 125 + q, { tau: TAU, full: FULL, fade: FADE, proj: PROJ });
    mor.push(Number(process.hrtime.bigint() - t0) / 1e6 / 10);
  }
  sel.sort((a, b) => a - b); mor.sort((a, b) => a - b);
  out.speed = { select: +sel[7].toFixed(3), morph: +mor[7].toFixed(4), shown: show.length };
  console.log(`  выбор + 2:1 + показ: ${out.speed.select} мс (медиана); перетекание на кадр: ${out.speed.morph} мс; кусков ${show.length}`);
  ok(sel[7] < 15, 'выбор и показ — меньше 15 мс', sel[7]);
  ok(mor[7] < 1, 'перетекание на кадр — меньше 1 мс', mor[7]);
}
globalThis.__lod = out;
if (process.env.LOD_JSON) require('fs').writeFileSync(process.env.LOD_JSON, JSON.stringify(out, (k, v) => k === 'at' ? undefined : v, 1));
console.log(`\nplanet-lod-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — крен и опрокидывание (D37E.topple): что не держит свой вес, сначала кренится, потом падает целым
// ═══════════════════════════════════════
// T-138 (owner 29.10: «как в Teardown… перевес — оно падает», «физика должна быть с наклоном, чтобы не державшее вес не стояло»).
// Spec: E:\d37-core\spec\STRUCTURE_HAZARDS.md §0.9 (LEAN BEFORE FALL), §2.2 S1.T, §2.4 (fall of a felled tree), §5.x (one ceiling).
// No three.js, no DOM: window, worker, node. Every decision is integer (bit-exact in JS / Rust / C#): lengths in EIGHTHS of a
// cell relative to a body origin (F1 cuts are eighths, so half-cells would lose them), masses in kg, angles in binary units
// (65,536 per turn; the integrator keeps 8 more fraction bits = 2^24 per turn), world tick 20 Hz with 4 substeps.
//
//   B = TP.body(max)              — preallocated body buffer: B.reset(); i = B.push(x, y, z, kg); B.contact(i, bend, x0, x1, z0, z1)
//                                   (contact = the cell rests on a solid that is not the body; footprint box in eighths; bend kg·cell,
//                                   0 = loose). B.layers / B.plan are filled by TP.storeys.
//   TP.analyze(B, o, R)           — one rigid body on its footprint: R.kind 0 stand · 1 drop (no contacts) · 2 tip (centre of mass
//                                   beyond the footprint edge) · 3 lean (inside, but the weak side is overloaded: sway × the
//                                   «thin support» amplification beats the bonded capacity); R.dir 0 +x · 1 −x · 2 +z · 3 −z (heavy
//                                   side, ties → lowest), R.pn / R.py — pivot edge (eighths), R.over, R.ratio ‰, R.amp ‰.
//                                   o = { sway ‰ (real 50 / soft 25), ampMax }.
//   TP.storeys(B, o, R, out)      — the same rule for every storey cut of a bonded structure (the body above layer L on the cells
//                                   of L): the worst storey → R (R.layer); out — Uint8Array mark of the cells above it.
//   Wd = TP.world({ slots, smp, reads }) — simulation slots (typed arrays, no garbage per tick):
//     s = Wd.add(B, R, o)         — start a body (o: { rate — lean speed, fine units per substep; w0 — initial ω; hang — max angle
//                                   of a hang-up, binary }) → slot or −1 (all busy: the adapter queues, never drops).
//     n = Wd.tick(solid)          — one world tick for every slot within the read budget (solid(x, y, z) → 0 free · 1 a cell that
//                                   stops the body (a hang-up holder) · 2 ground (stops it, never holds a hang-up: ≥ 5° — LAND));
//                                   events in Wd.ev [slot, type, x, y, z] × n: 1 HANG (holder cell), 2 LAND (≥ 60° contact, ground
//                                   contact or 90° reached: the adapter computes the drop and calls Wd.drop), 3 REST (drop finished:
//                                   write the cells), 4 CREAK (leaning, once per second).
//     Wd.drop(s, eighths, slide) (slide — eighths along +dir: the body slides off an edge its centre of mass is beyond) ·
//     Wd.more(s, eighths, slide) (after REST: fall further from here — the adapter found no ground within one search; speed kept) ·
//     Wd.resume(s, ω) · Wd.free(s) · Wd.angle(s) (radians, for the view) · Wd.offset(s, out) (mesh origin shift after a re-pivot,
//     the slide and the drop, eighths) · Wd.land(s, x, y, z, out) — landing cell of a body cell (quarter turn about the pivot +
//     re-pivot shift + slide + drop, integer) · Wd.place(s, x, y, z, out) — the cell under a body cell's centre at the current pose
//     (any angle: a settle in place — hang-up, ground contact) · Wd.save(s, a) / Wd.load(s, a) — the slot's motion state (to look
//     ahead without changing it).
//   A body whose centre of mass is exactly over its pivot (thc = 0) gets a nudge (unstable balance: it never stands still at 0°).
//   TP.rotAxis(axis, dir)         — axis state of a log (0 y, 1 x, 2 z) after a quarter turn toward dir.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const TP = E.topple = E.topple || {};
  TP.VERSION = 1;
  const QUARTER = 16384, FB = 8, F90 = QUARTER << FB, F60 = Math.round(F90 * 2 / 3), F5 = Math.round(F90 / 18);
  TP.F90 = F90; TP.F60 = F60; TP.F5 = F5; TP.FINE_DEG = F90 / 90;   // fine angle units per degree
  TP.SUB = 4;   // substeps per world tick (20 Hz → 80 Hz integrator)
  // K = W·r·KG / I per substep²: 8 (eighths → m) · g 9.8 · dt² (1/80 s)² · 2^24 / 2π, rounded (golden constant)
  const KG = TP.KG = 32710;

  // ── tables: sin (1,025 entries per quarter, Q14), atan (ratio 0…1 in 1,024 steps → binary angle); rounded → identical everywhere ──
  const SIN = new Int32Array(1025); for (let i = 0; i <= 1024; i++) SIN[i] = Math.round(Math.sin(i * Math.PI / 2048) * 16384);
  const ATN = new Int32Array(1025); for (let i = 0; i <= 1024; i++) ATN[i] = Math.round(Math.atan(i / 1024) / (2 * Math.PI) * 65536);
  const qsin = r => { if (r >= QUARTER) return 16384; const i = r >> 4, f = r & 15; return SIN[i] + (((SIN[i + 1] - SIN[i]) * f) >> 4); };
  TP.sin = a => { a &= 65535; const q = a >> 14, r = a & 16383; return q === 0 ? qsin(r) : q === 1 ? qsin(QUARTER - r) : q === 2 ? -qsin(r) : -qsin(QUARTER - r); };
  TP.cos = a => TP.sin(a + QUARTER);
  // atan2 → binary angle (−32768…32767); octant reduction, ratio Q14 (floor), table + linear step
  TP.atan2 = (y, x) => {
    if (x === 0 && y === 0) return 0;
    const ax = Math.abs(x), ay = Math.abs(y), sw = ay > ax, num = sw ? ax : ay, den = sw ? ay : ax;
    const r = Math.floor(num * 16384 / den), i = r >> 4, f = r & 15;
    let a = i >= 1024 ? ATN[1024] : ATN[i] + (((ATN[i + 1] - ATN[i]) * f) >> 4);
    if (sw) a = QUARTER - a;
    if (x < 0) a = 2 * QUARTER - a;
    if (y < 0) a = -a;
    return a > 32767 ? a - 65536 : a;
  };
  TP.isqrt = n => { if (n <= 0) return 0; let r = Math.floor(Math.sqrt(n)); while (r * r > n) r--; while ((r + 1) * (r + 1) <= n) r++; return r; };
  TP.tableHash = () => { let h = 2166136261; for (let i = 0; i <= 1024; i++) { h = Math.imul(h ^ SIN[i], 16777619); h = Math.imul(h ^ ATN[i], 16777619); } return h >>> 0; };
  // log axis after a quarter turn toward dir (0 +x, 1 −x → about z: y ↔ x; 2 +z, 3 −z → about x: y ↔ z)
  TP.rotAxis = (a, dir) => dir < 2 ? (a === 0 ? 1 : a === 1 ? 0 : a) : (a === 0 ? 2 : a === 2 ? 0 : a);

  // ═══ body buffer ═══
  TP.body = (max = 4096) => {
    const B = { n: 0, max, x: new Int32Array(max), y: new Int32Array(max), z: new Int32Array(max), m: new Int32Array(max),
      c: new Uint8Array(max), b: new Int32Array(max), x0: new Int32Array(max), x1: new Int32Array(max), z0: new Int32Array(max), z1: new Int32Array(max),
      up: new Uint8Array(max),   // TP.storeys: 1 — the cell is in the failing part (above the worst storey)
      ly: new Float64Array(5 * 160), lc: new Int32Array(160), ln: 0, plan: 0 };
    B.reset = () => { B.n = 0; };
    B.push = (x, y, z, m) => { if (B.n >= max) return -1; const i = B.n++; B.x[i] = x; B.y[i] = y; B.z[i] = z; B.m[i] = m; B.c[i] = 0; B.b[i] = 0; return i; };
    B.contact = (i, bend, x0, x1, z0, z1) => { B.c[i] = 1; B.b[i] = bend; B.x0[i] = x0; B.x1[i] = x1; B.z0[i] = z0; B.z1[i] = z1; };
    return B;
  };

  // ═══ decision: stand / drop / tip / lean ═══
  const R0 = () => ({ kind: 0, dir: 0, pn: 0, py: 0, W: 0, over: 0, ratio: 0, amp: 1000, T: 0, Bc: 0, dn: 0, h: 0, layer: 0, nC: 0 });
  TP.result = R0;
  // core rule on running sums (one cut): W, Sx, Sy, Sz (kg·eighths of cell centres), footprint extents (eighths), area (64ths of a
  // cell), bonded capacity Bc (kg·cell), plan area (cells, widest layer above), base y (eighths)
  function decide(R, W, Sx, Sy, Sz, X0, X1, Z0, Z1, area, Bc, plan, yb, nC, o){
    R.W = W; R.nC = nC; R.Bc = Bc;
    if (!nC || W <= 0) { R.kind = nC ? 0 : 1; R.over = 0; R.ratio = 0; return R; }
    const e0 = Sx - W * X1, e1 = W * X0 - Sx, e2 = Sz - W * Z1, e3 = W * Z0 - Sz;   // kg·eighths beyond each edge (> 0 — outside)
    let d = 0, e = e0; if (e1 > e) { d = 1; e = e1; } if (e2 > e) { d = 2; e = e2; } if (e3 > e) { d = 3; e = e3; }
    const h = Math.max(0, Sy - W * yb);   // kg·eighths of height above the base
    // «thin support»: plan area above the cut over the footprint area (64ths) amplifies the accidental sway (P-delta); a uniform
    // column has 1 (the spec's 25-high 1×1 wood tower still stands), a mushroom on a stem has ≫ 1
    const amp = Math.min(o.ampMax || 25000, Math.max(1000, Math.floor(plan * 64000 / Math.max(1, area))));
    const sw = Math.floor(Math.floor(h * (o.sway ?? 50) / 1000) * amp / 1000);
    const T = e + sw, cap = Bc * 8;   // kg·eighths
    R.T = T; R.amp = amp; R.dir = d; R.over = T - cap; R.ratio = cap > 0 ? Math.min(1e9, Math.floor(T * 1000 / cap)) : (T > 0 ? 1e9 : 0);
    R.dn = Math.floor(e / W); R.h = Math.floor(h / W);
    R.pn = d === 0 ? X1 : d === 1 ? X0 : d === 2 ? Z1 : Z0; R.py = yb;
    R.kind = R.over <= 0 ? 0 : e >= 0 ? 2 : 3;
    return R;
  }
  TP.analyze = (B, o = {}, R = R0()) => {
    let W = 0, Sx = 0, Sy = 0, Sz = 0, X0 = 1e15, X1 = -1e15, Z0 = 1e15, Z1 = -1e15, area = 0, Bc = 0, nC = 0, yb = 1e15;
    let lx0 = 1e9, lx1 = -1e9, lz0 = 1e9, lz1 = -1e9;
    for (let i = 0; i < B.n; i++) {
      const m = B.m[i]; W += m; Sx += m * (8 * B.x[i] + 4); Sy += m * (8 * B.y[i] + 4); Sz += m * (8 * B.z[i] + 4);
      if (B.x[i] < lx0) lx0 = B.x[i]; if (B.x[i] > lx1) lx1 = B.x[i]; if (B.z[i] < lz0) lz0 = B.z[i]; if (B.z[i] > lz1) lz1 = B.z[i];
      if (!B.c[i]) continue;
      nC++; Bc += B.b[i]; area += (B.x1[i] - B.x0[i]) * (B.z1[i] - B.z0[i]);
      if (B.x0[i] < X0) X0 = B.x0[i]; if (B.x1[i] > X1) X1 = B.x1[i]; if (B.z0[i] < Z0) Z0 = B.z0[i]; if (B.z1[i] > Z1) Z1 = B.z1[i];
      if (8 * B.y[i] < yb) yb = 8 * B.y[i];
    }
    const plan = B.plan || (lx1 - lx0 + 1) * (lz1 - lz0 + 1);
    R.layer = 0;
    return decide(R, W, Sx, Sy, Sz, X0, X1, Z0, Z1, area, Bc, plan, yb, nC, o);
  };
  // every storey cut of a bonded structure: layer L (relative y) — the part at y ≥ L on the cells of L that rest on something below
  // (inside the structure or not); contacts above L (resting on other solids) count for their own layer and every lower cut.
  // The worst cut by over/W (ties → lowest layer) → R; out[i] = 1 for the cells above it. ≤ 160 layers (bigger — R.kind 0).
  const RT = R0();
  TP.storeys = (B, o = {}, R = R0(), out = B.up) => {
    let y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < B.n; i++) { if (B.y[i] < y0) y0 = B.y[i]; if (B.y[i] > y1) y1 = B.y[i]; }
    const nl = y1 - y0 + 1; R.kind = 0; R.over = 0; R.layer = 0; R.W = 0;
    if (!B.n || nl > 160) return R;
    // per layer: mass sums (5), cell count; footprint per layer — extents, area, capacity, contacts
    const L = B.ly; L.fill(0, 0, nl * 5); B.lc.fill(0, 0, nl);
    const FP = TP._fp || (TP._fp = new Float64Array(160 * 8));
    for (let k = 0; k < nl; k++) { const b = k * 8; FP[b] = 1e15; FP[b + 1] = -1e15; FP[b + 2] = 1e15; FP[b + 3] = -1e15; FP[b + 4] = 0; FP[b + 5] = 0; FP[b + 6] = 0; FP[b + 7] = 0; }
    for (let i = 0; i < B.n; i++) {
      const k = B.y[i] - y0, m = B.m[i], b = k * 5;
      L[b] += m; L[b + 1] += m * (8 * B.x[i] + 4); L[b + 2] += m * (8 * B.y[i] + 4); L[b + 3] += m * (8 * B.z[i] + 4); if (m > 0) B.lc[k]++;
      if (!B.c[i]) continue;
      const f = k * 8;
      if (B.x0[i] < FP[f]) FP[f] = B.x0[i]; if (B.x1[i] > FP[f + 1]) FP[f + 1] = B.x1[i]; if (B.z0[i] < FP[f + 2]) FP[f + 2] = B.z0[i]; if (B.z1[i] > FP[f + 3]) FP[f + 3] = B.z1[i];
      FP[f + 4] += (B.x1[i] - B.x0[i]) * (B.z1[i] - B.z0[i]); FP[f + 5] += B.b[i]; FP[f + 6]++;
    }
    // from the top down: suffix sums of mass, footprint union of contacts at ≥ k (higher contacts also hold the part above lower cuts
    // only through the structure — they count for their own layer; a lower cut sees the contacts of its own layer plus higher ones)
    let W = 0, Sx = 0, Sy = 0, Sz = 0, plan = 0, X0 = 1e15, X1 = -1e15, Z0 = 1e15, Z1 = -1e15, area = 0, Bc = 0, nC = 0;
    let best = -1, bestK = -1, bestQ = 0;
    for (let k = nl - 1; k >= 0; k--) {
      const b = k * 5, f = k * 8;
      W += L[b]; Sx += L[b + 1]; Sy += L[b + 2]; Sz += L[b + 3]; if (B.lc[k] > plan) plan = B.lc[k];
      if (FP[f + 6] > 0) {
        if (FP[f] < X0) X0 = FP[f]; if (FP[f + 1] > X1) X1 = FP[f + 1]; if (FP[f + 2] < Z0) Z0 = FP[f + 2]; if (FP[f + 3] > Z1) Z1 = FP[f + 3];
        area += FP[f + 4]; Bc += FP[f + 5]; nC += FP[f + 6];
      }
      if (FP[f + 6] === 0 && k > 0) continue;   // no cut here (the layer rests on nothing new) — only layers with contacts are cuts
      // a cut at layer k uses its own contacts (the stand links of this storey) for the edge and the capacity; the base is this layer
      const cx0 = FP[f + 6] ? FP[f] : X0, cx1 = FP[f + 6] ? FP[f + 1] : X1, cz0 = FP[f + 6] ? FP[f + 2] : Z0, cz1 = FP[f + 6] ? FP[f + 3] : Z1;
      decide(RT, W, Sx, Sy, Sz, cx0, cx1, cz0, cz1, FP[f + 6] ? FP[f + 4] : area, FP[f + 6] ? FP[f + 5] : Bc, plan, 8 * (k + y0), FP[f + 6] || nC, o);
      if (RT.kind < 2) continue;
      const q = Math.floor(RT.over * 1000 / Math.max(1, W));
      if (best < 0 || q > bestQ || (q === bestQ && k < bestK)) { best = 1; bestK = k; bestQ = q; Object.assign(R, RT); R.layer = k + y0; }
    }
    if (best < 0) { R.kind = 0; return R; }
    for (let i = 0; i < B.n; i++) out[i] = B.y[i] >= R.layer ? 1 : 0;
    return R;
  };

  // ═══ simulation slots ═══
  const PH_FREE = 0, PH_LEAN = 1, PH_FALL = 2, PH_HUNG = 3, PH_LANDED = 4, PH_DROP = 5;
  TP.PH = { FREE: 0, LEAN: 1, FALL: 2, HUNG: 3, LANDED: 4, DROP: 5 };
  TP.EV = { HANG: 1, LAND: 2, REST: 3, CREAK: 4 };
  TP.world = (o = {}) => {
    const NS = o.slots || 16, SMP = o.smp || 64, READS = o.reads || 2048;
    const ph = new Uint8Array(NS), dir = new Uint8Array(NS), th = new Int32Array(NS), om = new Int32Array(NS), thc = new Int32Array(NS), K = new Int32Array(NS);
    const rate = new Int32Array(NS), hangA = new Int32Array(NS), ticks = new Int32Array(NS), piv = new Int32Array(NS), nsmp = new Uint8Array(NS);
    const ox = new Int32Array(NS), oy = new Int32Array(NS), oz = new Int32Array(NS), pn = new Int32Array(NS), py = new Int32Array(NS);
    const pn2 = new Int32Array(NS), py2 = new Int32Array(NS), th1 = new Int32Array(NS), mon = new Int32Array(NS), moy = new Int32Array(NS), fy = new Int32Array(NS), fv = new Int32Array(NS), fd = new Int32Array(NS);
    const fsl = new Int32Array(NS), fsd = new Int32Array(NS);   // slide along +dir (current, eighths << 4; target, eighths)
    const sn = new Int32Array(NS * SMP), sy = new Int32Array(NS * SMP), st = new Int32Array(NS * SMP);   // samples: along dir, up, across (eighths)
    const hx = new Int32Array(NS), hy = new Int32Array(NS), hz = new Int32Array(NS);
    const ev = new Int32Array(NS * 4 * 5 + 5);
    const Wd = { NS, SMP, READS, ph, dir, th, om, ticks, ev, nev: 0, used: 0, start: 0, tickN: 0, stats: { reads: 0, maxReads: 0, deferred: 0, repivots: 0, hangs: 0, lands: 0, added: 0, busy: 0 } };
    // scratch for sample selection (no garbage per add)
    const HS = 1 << 13, hk = new Int32Array(HS), hv = new Uint8Array(HS);
    const ckey = (x, y, z) => ((x + 512) & 1023) * 1048576 + ((y + 512) & 1023) * 1024 + ((z + 512) & 1023);
    function hput(k){ let i = (Math.imul(k, 0x9e3779b1) >>> 19) & (HS - 1); while (hv[i] && hk[i] !== k) i = (i + 1) & (HS - 1); hv[i] = 1; hk[i] = k; }
    function hhas(k){ let i = (Math.imul(k, 0x9e3779b1) >>> 19) & (HS - 1); while (hv[i]) { if (hk[i] === k) return true; i = (i + 1) & (HS - 1); } return false; }
    const SR = new Float64Array(SMP), SI = new Int32Array(SMP);
    const along = (d, x, z) => d === 0 ? 8 * x + 4 : d === 1 ? -(8 * x + 4) : d === 2 ? 8 * z + 4 : -(8 * z + 4);
    const across = (d, x, z) => d < 2 ? 8 * z + 4 : 8 * x + 4;
    // B — body (relative to its origin ox, oy, oz — world cells), R — decision (dir, pivot pn / py in eighths, relative)
    Wd.add = (B, R, a = {}) => {
      let s = -1; for (let i = 0; i < NS; i++) if (ph[i] === PH_FREE) { s = i; break; }
      if (s < 0) { Wd.stats.busy++; return -1; }
      const d = R.dir, P = d === 1 || d === 3 ? -R.pn : R.pn;   // pivot along +dir
      ox[s] = a.ox | 0; oy[s] = a.oy | 0; oz[s] = a.oz | 0; dir[s] = d; pn[s] = R.pn; py[s] = R.py; pn2[s] = 0; py2[s] = 0; th1[s] = 0; piv[s] = 0; mon[s] = P; moy[s] = R.py; fy[s] = 0; fv[s] = 0; fd[s] = 0; fsl[s] = 0; fsd[s] = 0;
      // mass sums about the pivot edge (masses shifted so Σm ≤ 2^20 — every product stays < 2^53)
      let W0 = 0; for (let i = 0; i < B.n; i++) W0 += B.m[i];
      let sh = 0; while ((W0 >> sh) > 1048576) sh++;
      let W = 0, Sn = 0, Sy = 0, I = 0;
      hv.fill(0);
      for (let i = 0; i < B.n; i++) {
        const m = B.m[i] >> sh, rn = along(d, B.x[i], B.z[i]) - P, ry = 8 * B.y[i] + 4 - R.py;
        W += m; Sn += m * rn; Sy += m * ry; I += m * (rn * rn + ry * ry + 11);
        hput(ckey(B.x[i], B.y[i], B.z[i]));
      }
      if (W <= 0) { W = 1; I = 1; }
      const dn = Math.floor(Sn / W), hh = Math.max(1, Math.floor(Sy / W));
      thc[s] = TP.atan2(-dn, hh) << FB;
      K[s] = Math.max(1, Math.floor(W * TP.isqrt(dn * dn + hh * hh) * KG / Math.max(1, I)));
      // samples: cells with an open face toward +dir, up or down (the leading surface), the farthest from the pivot first
      const fx = d === 0 ? 1 : d === 1 ? -1 : 0, fz = d === 2 ? 1 : d === 3 ? -1 : 0;
      let ns = 0;
      for (let i = 0; i < B.n; i++) {
        const x = B.x[i], y = B.y[i], z = B.z[i];
        if (hhas(ckey(x + fx, y, z + fz)) && hhas(ckey(x, y + 1, z)) && hhas(ckey(x, y - 1, z))) continue;
        const rn = along(d, x, z) - P, ry = 8 * y + 4 - R.py, r2 = rn * rn + ry * ry;
        if (ns < SMP) { let j = ns++; while (j > 0 && SR[j - 1] < r2) { SR[j] = SR[j - 1]; SI[j] = SI[j - 1]; j--; } SR[j] = r2; SI[j] = i; }
        else if (r2 > SR[SMP - 1]) { let j = SMP - 1; while (j > 0 && SR[j - 1] < r2) { SR[j] = SR[j - 1]; SI[j] = SI[j - 1]; j--; } SR[j] = r2; SI[j] = i; }
      }
      const b = s * SMP;
      for (let k = 0; k < ns; k++) { const i = SI[k]; sn[b + k] = along(d, B.x[i], B.z[i]) - P; sy[b + k] = 8 * B.y[i] + 4 - R.py; st[b + k] = across(d, B.x[i], B.z[i]); }
      nsmp[s] = ns;
      th[s] = 0; ticks[s] = 0;
      hangA[s] = (a.hang ?? 10923) << FB;   // 60°
      // centre of mass beyond the pivot (thc < 0) — falls at once; exactly over it (thc = 0) — unstable balance: a nudge (without it
      // ω stays 0 and the body, already out of the world, would stand still forever); inside (thc > 0) — leans first, also a «tip»
      // whose rounding put the centre a hair inside (it would otherwise swing back to 0° and stop)
      const r0 = Math.max(1, a.rate | 0 || Math.round(TP.FINE_DEG * 2 / 80));
      if (thc[s] <= 0) { ph[s] = PH_FALL; om[s] = a.w0 | 0; if (thc[s] === 0 && om[s] <= 0) om[s] = r0; rate[s] = 0; }
      else { ph[s] = PH_LEAN; rate[s] = r0; om[s] = 0; }
      Wd.stats.added++;
      return s;
    };
    // sample k of slot s at angle a (binary, relative to the current pivot) → world cell of its probe point (centre − 3/8 down)
    const C = { x: 0, y: 0, z: 0, an: 0, ay: 0 };
    function probe(s, k, c, si){
      const b = s * SMP + k, rn = sn[b], ry = sy[b];
      const rn2 = Math.floor((rn * c + ry * si) / 16384), ry2 = Math.floor((ry * c - rn * si) / 16384);
      const d = dir[s], an = (piv[s] ? pn2[s] : (d === 1 || d === 3 ? -pn[s] : pn[s])) + rn2, ay = (piv[s] ? py2[s] : py[s]) + ry2 - 3 - (fy[s] >> 4);
      C.an = an; C.ay = ay;
      const wa = d === 1 || d === 3 ? -an : an;   // along the world axis (eighths, relative)
      const t = st[b];
      if (d < 2) { C.x = ox[s] + (wa >> 3); C.z = oz[s] + (t >> 3); } else { C.z = oz[s] + (wa >> 3); C.x = ox[s] + (t >> 3); }
      C.y = oy[s] + (ay >> 3);
      return C;
    }
    // re-pivot about the touching cell's top edge (the body rolls over its overhang): samples → relative to the new pivot
    const OF2 = [0, 0];
    function repivot(s, a, gy){
      const c = TP.cos(a), si = TP.sin(a), d = dir[s];
      let best = -1, bestY = 1e9;
      for (let k = 0; k < nsmp[s]; k++) { probe(s, k, c, si); if (C.ay < bestY) { bestY = C.ay; best = k; } }
      if (best < 0) return false;
      probe(s, best, c, si);
      const P2n = C.an + 4, P2y = 8 * (gy - oy[s] + 1);
      const b = s * SMP;
      for (let k = 0; k < nsmp[s]; k++) {
        const rn = sn[b + k], ry = sy[b + k];
        const rn2 = Math.floor((rn * c + ry * si) / 16384), ry2 = Math.floor((ry * c - rn * si) / 16384);
        const an = (piv[s] ? pn2[s] : (d === 1 || d === 3 ? -pn[s] : pn[s])) + rn2, ay = (piv[s] ? py2[s] : py[s]) + ry2;
        sn[b + k] = an - P2n; sy[b + k] = ay - P2y;
      }
      // the mesh keeps its own origin (the first pivot): where it is now → the new pivot rotates it from here (Wd.offset)
      Wd.offset(s, OF2); const d1 = d === 1 || d === 3 ? -pn[s] : pn[s];
      mon[s] = d1 + OF2[0]; moy[s] = py[s] + OF2[1] + (fy[s] >> 4);
      pn2[s] = P2n; py2[s] = P2y;
      th1[s] = th[s]; piv[s]++;
      Wd.stats.repivots++;
      return true;
    }
    const pushEv = (s, type, x, y, z) => { const j = Wd.nev * 5; ev[j] = s; ev[j + 1] = type; ev[j + 2] = x; ev[j + 3] = y; ev[j + 4] = z; Wd.nev++; };
    // one substep of slot s → reads used, or −1 (the slot stopped: event)
    function sub(s, solid){
      const p = ph[s];
      const prev = th[s];
      if (p === PH_LEAN) {
        th[s] += rate[s];
        if (th[s] >= thc[s]) { ph[s] = PH_FALL; om[s] = rate[s]; }
      } else {
        const phi = (th[s] - thc[s]) >> FB;
        om[s] += Math.floor(K[s] * TP.sin(phi) / 16384);
        th[s] += om[s];
        if (th[s] < 0) { th[s] = 0; om[s] = 0; }
      }
      let reached = false;
      if (th[s] >= F90) { th[s] = F90; reached = true; }
      // probes at the new angle (relative to the current pivot: after a re-pivot only the part since then)
      const a = (th[s] - th1[s]) >> FB, c = TP.cos(a), si = TP.sin(a);
      const ns = nsmp[s];
      for (let k = 0; k < ns; k++) {
        probe(s, k, c, si);
        const sv = solid(C.x, C.y, C.z);
        if (!sv) continue;
        const cx = C.x, cy = C.y, cz = C.z;
        // contact: below the pivot level and ahead of it — the ground under an overhang → roll over it (≤ 2 re-pivots)
        const base = piv[s] ? py2[s] : py[s];
        if (ph[s] !== PH_LEAN && C.ay < base && piv[s] < 2 && th[s] < hangA[s] + (F90 - hangA[s]) / 2) {
          th[s] = prev; om[s] = Math.floor(om[s] * 3 / 4);
          repivot(s, (th[s] - th1[s]) >> FB, cy);
          return ns;
        }
        // ground (sv 2: terrain) never holds a hang-up — the body rests on it at this angle (LAND below 60°: the adapter settles it in place)
        const early = th[s] < hangA[s] || ph[s] === PH_LEAN;
        if (early && !(sv === 2 && prev >= F5)) { th[s] = prev; om[s] = 0; ph[s] = PH_HUNG; hx[s] = cx; hy[s] = cy; hz[s] = cz; Wd.stats.hangs++; pushEv(s, 1, cx, cy, cz); return -1; }
        th[s] = early ? prev : F90; om[s] = early ? 0 : om[s];
        ph[s] = PH_LANDED; Wd.stats.lands++; pushEv(s, 2, cx, cy, cz); return -1;
      }
      if (reached) { ph[s] = PH_LANDED; Wd.stats.lands++; pushEv(s, 2, 0, 0, 0); return -1; }
      return ns;
    }
    Wd.tick = solid => {
      Wd.nev = 0; Wd.used = 0; Wd.tickN++;
      const st0 = Wd.start; Wd.start = (Wd.start + 1) % NS;
      for (let q = 0; q < NS; q++) {
        const s = (st0 + q) % NS, p = ph[s];
        if (p === PH_FREE || p === PH_HUNG || p === PH_LANDED) continue;
        if (p === PH_DROP) {
          fv[s] = Math.min(256, fv[s] + 10); fy[s] += fv[s];
          if (fy[s] >= fd[s] << 4) fy[s] = fd[s] << 4;
          const tg = fsd[s] << 4;   // slide: 1,5 cells per tick toward the target (either way: Wd.more may add the other way)
          if (fsl[s] !== tg) fsl[s] = fsl[s] < tg ? Math.min(tg, fsl[s] + 192) : Math.max(tg, fsl[s] - 192);
          if (fy[s] === fd[s] << 4 && fsl[s] === tg) { ph[s] = PH_LANDED; pushEv(s, 3, 0, 0, 0); }
          continue;
        }
        const need = nsmp[s] * TP.SUB;
        if (Wd.used + need > READS && Wd.used > 0) { Wd.stats.deferred++; continue; }   // budget: this slot waits a tick (never dropped)
        ticks[s]++;
        for (let k = 0; k < TP.SUB; k++) { const r = sub(s, solid); if (r < 0) { Wd.used += nsmp[s]; break; } Wd.used += r; }
        if (ph[s] === PH_LEAN && ticks[s] % 20 === 1) pushEv(s, 4, 0, 0, 0);
      }
      Wd.stats.reads += Wd.used; if (Wd.used > Wd.stats.maxReads) Wd.stats.maxReads = Wd.used;
      return Wd.nev;
    };
    Wd.drop = (s, eighths, slide = 0) => { if (ph[s] !== PH_LANDED) return 0; fd[s] = Math.max(0, eighths | 0); fy[s] = 0; fv[s] = 0; fsd[s] = slide | 0; fsl[s] = 0; ph[s] = PH_DROP; return fd[s]; };   // REST comes on the next tick
    Wd.more = (s, eighths, slide = 0) => { if (ph[s] !== PH_LANDED) return 0; fd[s] += Math.max(0, eighths | 0); fsd[s] += slide | 0; ph[s] = PH_DROP; return fd[s]; };   // REST again when this part is done
    Wd.dropNow = (s, eighths, slide = 0) => { fd[s] = Math.max(0, eighths | 0); fy[s] = fd[s] << 4; fv[s] = 0; fsd[s] = slide | 0; fsl[s] = fsd[s] << 4; ph[s] = PH_LANDED; };   // save / close: lands at once
    // the slot's motion state (look ahead — e.g. where it would land — and put it back): a — Int32Array(8) or array
    Wd.save = (s, a) => { a[0] = th[s]; a[1] = om[s]; a[2] = ph[s]; a[3] = fy[s]; a[4] = fv[s]; a[5] = fd[s]; a[6] = fsl[s]; a[7] = fsd[s]; return a; };
    Wd.load = (s, a) => { th[s] = a[0]; om[s] = a[1]; ph[s] = a[2]; fy[s] = a[3]; fv[s] = a[4]; fd[s] = a[5]; fsl[s] = a[6]; fsd[s] = a[7]; };
    Wd.resume = (s, w = 0) => { if (ph[s] !== PH_HUNG) return; if (th[s] < thc[s]) { ph[s] = PH_LEAN; } else { ph[s] = PH_FALL; om[s] = Math.max(om[s], w | 0); } };
    Wd.free = s => { ph[s] = PH_FREE; };
    Wd.holder = (s, out) => { out[0] = hx[s]; out[1] = hy[s]; out[2] = hz[s]; return out; };
    Wd.angle = s => th[s] / (F90 * 4) * Math.PI * 2;
    Wd.phase = s => ph[s];
    Wd.busy = () => { let n = 0; for (let i = 0; i < NS; i++) if (ph[i] !== PH_FREE) n++; return n; };
    // mesh origin shift (eighths, along +dir and up) after re-pivots and the drop: P2 + R(Δ)(P1 − P2) − P1, then − drop
    Wd.offset = (s, out) => {
      let dn = 0, dy = 0;
      if (piv[s]) {
        const d = dir[s], P1n = d === 1 || d === 3 ? -pn[s] : pn[s], P1y = py[s], a = (th[s] - th1[s]) >> FB, c = TP.cos(a), si = TP.sin(a);
        const rn = mon[s] - pn2[s], ry = moy[s] - py2[s];
        dn = pn2[s] + Math.floor((rn * c + ry * si) / 16384) - P1n; dy = py2[s] + Math.floor((ry * c - rn * si) / 16384) - P1y;
      }
      out[0] = dn + (fsl[s] >> 4); out[1] = dy - (fy[s] >> 4);
      return out;
    };
    // landing cell of body cell (x, y, z) (relative to the origin) — quarter turn about the first pivot snapped to a cell edge,
    // plus the re-pivot shift rounded to whole cells, minus the drop (whole cells; Wd.drop takes eighths that are multiples of 8)
    const OF = [0, 0];
    Wd.land = (s, x, y, z, out) => {
      const d = dir[s], pc = Math.round((d === 1 || d === 3 ? -pn[s] : pn[s]) / 8), yc = py[s] >> 3;
      const a = d === 0 ? x : d === 1 ? -x - 1 : d === 2 ? z : -z - 1;   // along +dir, cell index (the cell [a, a + 1) in +dir units)
      const i = pc - 1 - a;   // how far inside the pivot edge (0 — the edge cell)
      let na = pc + (y - yc), ny = yc + i;
      Wd.offset(s, OF);
      na += Math.round(OF[0] / 8); ny += Math.round(OF[1] / 8);
      if (d === 0) { out[0] = na; out[2] = z; } else if (d === 1) { out[0] = -na - 1; out[2] = z; } else if (d === 2) { out[2] = na; out[0] = x; } else { out[2] = -na - 1; out[0] = x; }
      out[1] = ny;
      return out;
    };
    // the cell under body cell (x, y, z)'s centre at the current pose (relative to the origin, like Wd.land): rotation by the whole angle
    // about the first pivot plus the mesh origin shift (re-pivots, slide, drop) — the same pose the view draws; floor (any angle: settle in place)
    const OF3 = [0, 0];
    Wd.place = (s, x, y, z, out) => {
      const d = dir[s], P1n = d === 1 || d === 3 ? -pn[s] : pn[s], a0 = along(d, x, z) - P1n, h0 = 8 * y + 4 - py[s];
      const A = th[s] >> FB, c = TP.cos(A), si = TP.sin(A);
      Wd.offset(s, OF3);
      const an = P1n + OF3[0] + Math.floor((a0 * c + h0 * si) / 16384), ay = py[s] + OF3[1] + Math.floor((h0 * c - a0 * si) / 16384);
      const wa = d === 1 || d === 3 ? -an : an, t = across(d, x, z);
      if (d < 2) { out[0] = wa >> 3; out[2] = t >> 3; } else { out[2] = wa >> 3; out[0] = t >> 3; }
      out[1] = ay >> 3;
      return out;
    };
    // world position of the mesh origin (the first pivot), floats for the view: along the dir axis, y; across — the body origin
    Wd.pivot = (s, out) => { const d = dir[s]; out.y = oy[s] + py[s] / 8; if (d < 2) { out.x = ox[s] + pn[s] / 8; out.z = oz[s]; } else { out.z = oz[s] + pn[s] / 8; out.x = ox[s]; } out.d = d; return out; };
    Wd.clear = () => { ph.fill(0); Wd.nev = 0; };
    return Wd;
  };
})();

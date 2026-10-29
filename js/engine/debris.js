// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — обломки как твёрдые тела (D37E.debris): летят по весу, катятся по склону и со скалы, засыпают
// ═══════════════════════════════════════
// T-138 step 2 (F4 = SH-R, E:\d37-core\spec\STRUCTURE_HAZARDS.md §0.9; one ceiling §5.x). Owner 29.10: «блоки и предметы могут
// улетать в зависимости от веса и катиться со скалы». No three.js, no DOM: window, worker, node. Every decision is integer
// (bit-exact JS / Rust / C#): positions in Q16 cells (1/65,536 of a cell, kept as exact integers in Float64Array), velocities
// in Q16 cells per substep, world tick 20 Hz × 4 substeps (80 Hz), gravity G = 100 Q16/substep² (9.8 m/s², 1 cell = 1 m).
// Signed division truncates toward zero (Math.trunc — the i32 «/» of Rust / C#); floor only for cell indices (exact: ÷ 2^16).
//
//   D = DB.world({ max, reads })  — a pool on typed arrays (0 B garbage per tick in steady state)
//     i = D.add(x, y, z, vx, vy, vz, kg, size, roll, tag) — centre x/y/z (Q16), velocity (Q16/substep), mass kg, edge in eighths
//         (1…8), roll ‰ (0 — a cube: slides, tumbles only off steep edges; ≥ 500 — round: a log, a rock, an item — rolls down a
//         2-cell drop over 2 cells), tag — the game's value (block cell) → slot, or −1 (pool full: the game makes the block /
//         item at once — nothing is lost). D.setMat(i, bounce ‰, mu ‰) overrides the defaults from roll.
//     n = D.tick(solid, reads?)  — solid(x, y, z) → true for a world cell that stops a piece; reads — this tick's share of the
//         ceiling (default — the pool's). Events in D.ev [slot, type, a, b, c] × n: 1 SLEEP (a, b, c — rest cell; the game makes
//         a block / item and calls D.free), 2 HIT (a — impact speed Q16/substep), 3 LOST (below the world). A piece that does not
//         fit into the budget waits a tick (never dropped).
//     D.blast(x, y, z, J, r)     — impulse J (kg·Q16/substep) from a point (Q16), radius r cells, linear falloff: Δv = J·f / m
//         (light pieces fly further), +⅓ of it upward; wakes sleeping pieces → how many were pushed
//     D.pos(i, out) — floats for the view (cells); D.speed(i) — |v| (Q16/substep, L1); D.free(i); D.clear(); D.live()
//   DB.slope(solid, x, y, z, round, out) — the shared ground rule (pieces and a game's own loose items): the cell (x, y, z) stands
//     on the cell below; heights of the 4 neighbour columns (−3…+2) → the downhill axis needs a lower neighbour (no false slope at
//     the foot of a wall); drop over 2 cells ≥ 2 (round) / ≥ 3 (cube: a cliff edge) → out.ax / out.az (Q16/substep², signed),
//     out.s (drop), out.reads.
//   DB.vq(m/s) / DB.q(cells) — float → integer at the game boundary (the only place floats enter).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const DB = E.debris = E.debris || {};
  DB.VERSION = 1;
  const ONE = 65536, SUB = 4, G = 100, VMAX = 32768;   // VMAX — 40 cells/s, half a cell per substep (no tunnelling)
  DB.ONE = ONE; DB.SUB = SUB; DB.G = G; DB.VMAX = VMAX;
  DB.vq = mps => Math.round(mps * ONE / 80);
  DB.q = c => Math.round(c * ONE);
  const fl = v => Math.floor(v / ONE) | 0;   // exact: ÷ 2^16 of an integer; int32 — a world callback gets small integers (no boxed doubles)
  const tr = Math.trunc;
  const SLOPE_SIN = [0, 447, 707, 832, 894];   // ‰: drop s over 2 cells → s / √(s² + 4)
  const COST = 68;   // worst reads of one piece per tick: ground rule 17 + 4 substeps × 3 axes × 4 cells
  const BMIN = 1638, HMIN = 2458, SV = 40, STILL = 10, AGE = 600;   // bounce from 2 m/s, «hit» from 3 m/s, still below 0.05 m/s for 0.5 s, ≤ 30 s awake

  // ── shared ground rule ──
  let RDS = 0;
  function colH(solid, x, y, z){
    RDS++; if (solid(x, y, z)) { RDS++; return solid(x, y + 1, z) ? 2 : 1; }
    let k = 0; while (k < 3) { RDS++; if (solid(x, y - 1 - k, z)) break; k++; }
    return -k;
  }
  DB.slope = (solid, x, y, z, round, out) => {
    RDS = 0; out.ax = 0; out.az = 0; out.s = 0;
    const hxm = colH(solid, x - 1, y, z), hxp = colH(solid, x + 1, y, z), hzm = colH(solid, x, y, z - 1), hzp = colH(solid, x, y, z + 1);
    out.reads = RDS;
    // downhill needs a lower neighbour on that side (a wall behind alone is not a slope)
    let gx = hxm - hxp, gz = hzm - hzp;
    if (gx > 0 && hxp >= 0) gx = 0; if (gx < 0 && hxm >= 0) gx = 0;
    if (gz > 0 && hzp >= 0) gz = 0; if (gz < 0 && hzm >= 0) gz = 0;
    const agx = gx < 0 ? -gx : gx, agz = gz < 0 ? -gz : gz, s = agx > agz ? agx : agz;
    if (s < (round ? 2 : 3)) return out;
    const a = tr(G * SLOPE_SIN[s > 4 ? 4 : s] * (round ? 714 : 500) / 1000000);
    if (agx >= agz) out.ax = gx > 0 ? a : -a; else out.az = gz > 0 ? a : -a;
    out.s = s;
    return out;
  };

  DB.world = (o = {}) => {
    const N = o.max || 96, READS = o.reads || 1536;
    const px = new Float64Array(N), py = new Float64Array(N), pz = new Float64Array(N);
    const vx = new Int32Array(N), vy = new Int32Array(N), vz = new Int32Array(N), hq = new Int32Array(N), kg = new Int32Array(N);
    const rl = new Int16Array(N), el = new Int16Array(N), mu = new Int16Array(N), ax = new Int32Array(N), az = new Int32Array(N);
    const st = new Uint8Array(N), still = new Uint8Array(N), gr = new Uint8Array(N), age = new Int32Array(N), tag = new Int32Array(N);
    const ev = new Int32Array(N * 4 * 5), HCAP = N * 3;   // ≤ 1 SLEEP / LOST per piece per tick + HIT events capped at 3N (never overflow)
    const D = { N, READS, st, tag, kg, hq, px, py, pz, vx, vy, vz, ev, nev: 0, used: 0, start: 0, tickN: 0,
      stats: { reads: 0, maxReads: 0, deferred: 0, added: 0, full: 0, sleeps: 0, hits: 0, lost: 0, blasts: 0, rolls: 0, edges: 0 } };
    let hint = 0, live = 0;
    const SO = { ax: 0, az: 0, s: 0, reads: 0 };
    D.add = (x, y, z, vX, vY, vZ, m, size, roll, t) => {
      let i = -1;
      for (let q = 0; q < N; q++) { const k = (hint + q) % N; if (!st[k]) { i = k; break; } }
      if (i < 0) { D.stats.full++; return -1; }
      hint = (i + 1) % N;
      px[i] = x; py[i] = y; pz[i] = z;
      vx[i] = clampV(vX | 0); vy[i] = clampV(vY | 0); vz[i] = clampV(vZ | 0);
      const s = Math.max(1, Math.min(8, size | 0)); hq[i] = s * 4096;
      kg[i] = Math.max(1, m | 0); rl[i] = Math.max(0, Math.min(1000, roll | 0));
      el[i] = rl[i] >= 1000 ? 250 : rl[i] >= 500 ? 200 : 120; mu[i] = rl[i] >= 1000 ? 120 : rl[i] >= 500 ? 300 : 450;   // бревно катится далеко, камень — шершавый, кубик скользит
      st[i] = 1; still[i] = 0; gr[i] = 0; age[i] = 0; tag[i] = t | 0; ax[i] = 0; az[i] = 0;
      live++; D.stats.added++;
      return i;
    };
    D.setMat = (i, bounce, m) => { el[i] = Math.max(0, Math.min(900, bounce | 0)); mu[i] = Math.max(0, Math.min(1000, m | 0)); };
    const clampV = v => v > VMAX ? VMAX : v < -VMAX ? -VMAX : v;
    const pushEv = (i, type, a, b, c) => { const j = D.nev * 5; ev[j] = i; ev[j + 1] = type; ev[j + 2] = a; ev[j + 3] = b; ev[j + 4] = c; D.nev++; };
    // a row of cells on axis ax0 (0 x, 1 y, 2 z) at index c, spanning the piece on the other two axes → solid?
    let R = 0;
    function row(solid, i, axis, c){
      const h = hq[i];
      if (axis === 1) {
        const x0 = fl(px[i] - h), x1 = fl(px[i] + h - 1), z0 = fl(pz[i] - h), z1 = fl(pz[i] + h - 1);
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { R++; if (solid(x, c, z)) return true; }
        return false;
      }
      const y0 = fl(py[i] - h), y1 = fl(py[i] + h - 1);
      if (axis === 0) { const z0 = fl(pz[i] - h), z1 = fl(pz[i] + h - 1); for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { R++; if (solid(c, y, z)) return true; } return false; }
      const x0 = fl(px[i] - h), x1 = fl(px[i] + h - 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { R++; if (solid(x, y, c)) return true; }
      return false;
    }
    function bounce(i, v){   // v — speed into the surface (> 0) → the speed back (≥ 0)
      if (v > HMIN) { D.stats.hits++; if (D.nev < HCAP) pushEv(i, 2, v, 0, 0); }
      return v > BMIN ? tr(v * el[i] / 1000) : 0;
    }
    function move(solid, i, axis){
      const P = axis === 0 ? px : axis === 1 ? py : pz, Vv = axis === 0 ? vx : axis === 1 ? vy : vz, d = Vv[i], h = hq[i];
      if (!d) return;
      const p = P[i];
      if (d < 0) {
        const cur = fl(p - h), nf = fl(p - h + d);
        if (nf < cur && row(solid, i, axis, nf)) { P[i] = (nf + 1) * ONE + h; Vv[i] = bounce(i, -d); if (axis === 1) gr[i] = 1; return; }
      } else {
        const cur = fl(p + h - 1), nf = fl(p + h - 1 + d);
        if (nf > cur && row(solid, i, axis, nf)) { P[i] = nf * ONE - h; Vv[i] = -bounce(i, d); return; }
      }
      P[i] = p + d;
    }
    // ground rules once per tick (the piece stood on something in the last substep): the centre over the void → tips away from the
    // supporting cell (rolls off the edge); else the slope rule
    function rules(solid, i){
      const h = hq[i], cx = fl(px[i]), cz = fl(pz[i]), cy = fl(py[i] - h);
      ax[i] = 0; az[i] = 0;
      R++;
      if (!solid(cx, cy - 1, cz)) {
        const TIP = G >> 1;
        let sx = 0, sz = 0;
        if (fl(px[i] - h) < cx) { R++; if (solid(cx - 1, cy - 1, cz)) sx = 1; }
        if (!sx && fl(px[i] + h - 1) > cx) { R++; if (solid(cx + 1, cy - 1, cz)) sx = -1; }
        if (fl(pz[i] - h) < cz) { R++; if (solid(cx, cy - 1, cz - 1)) sz = 1; }
        if (!sz && fl(pz[i] + h - 1) > cz) { R++; if (solid(cx, cy - 1, cz + 1)) sz = -1; }
        if (!sx && !sz) { sx = fl(px[i] - h) < cx ? 1 : -1; sz = fl(pz[i] - h) < cz ? 1 : -1; }   // only a diagonal neighbour holds it
        ax[i] = sx * TIP; az[i] = sz * TIP; D.stats.edges++;
        return;
      }
      DB.slope(solid, cx, cy, cz, rl[i] >= 500, SO); R += SO.reads;
      ax[i] = SO.ax; az[i] = SO.az; if (SO.s) D.stats.rolls++;
    }
    function friction(i){
      const s = (vx[i] < 0 ? -vx[i] : vx[i]) + (vz[i] < 0 ? -vz[i] : vz[i]); if (!s) return;
      const m = ax[i] || az[i] ? (mu[i] < 120 ? mu[i] : 120) : mu[i], dec = tr(G * m / 1000);   // rolling / tumbling down — no sliding friction
      if (s <= dec) { vx[i] = 0; vz[i] = 0; return; }
      vx[i] -= tr(dec * vx[i] / s); vz[i] -= tr(dec * vz[i] / s);
    }
    function step(solid, i){
      R = 0;
      if (gr[i]) rules(solid, i); else { ax[i] = 0; az[i] = 0; }
      for (let k = 0; k < SUB; k++) {
        vy[i] = clampV(vy[i] - G); vx[i] = clampV(vx[i] + ax[i]); vz[i] = clampV(vz[i] + az[i]);
        gr[i] = 0;
        move(solid, i, 1); move(solid, i, 0); move(solid, i, 2);
        if (gr[i]) friction(i);
      }
      age[i]++;
      const sp = (vx[i] < 0 ? -vx[i] : vx[i]) + (vz[i] < 0 ? -vz[i] : vz[i]) + (vy[i] < 0 ? -vy[i] : vy[i]);
      if (gr[i] && !ax[i] && !az[i] && sp <= SV) still[i]++; else still[i] = 0;
      if (py[i] < -64 * ONE) { st[i] = 3; live--; D.stats.lost++; pushEv(i, 3, fl(px[i]), fl(py[i]), fl(pz[i])); }
      else if (still[i] >= STILL || age[i] >= AGE) { st[i] = 2; live--; vx[i] = vy[i] = vz[i] = 0; D.stats.sleeps++; pushEv(i, 1, fl(px[i]), fl(py[i] - hq[i] + 1), fl(pz[i])); }
      return R;
    }
    D.tick = (solid, reads) => {
      const B = reads > 0 ? reads : READS;
      D.nev = 0; D.used = 0; D.tickN++;
      if (!live) return 0;
      const s0 = D.start; D.start = (D.start + 1) % N;
      for (let q = 0; q < N; q++) {
        const i = (s0 + q) % N; if (st[i] !== 1) continue;
        if (D.used + COST > B && D.used > 0) { D.stats.deferred++; continue; }   // budget: waits a tick (never dropped)
        D.used += step(solid, i);
      }
      D.stats.reads += D.used; if (D.used > D.stats.maxReads) D.stats.maxReads = D.used;
      return D.nev;
    };
    D.blast = (x, y, z, J, r) => {
      const Rq = Math.max(1, r | 0) * ONE; let n = 0;
      for (let i = 0; i < N; i++) {
        if (st[i] !== 1 && st[i] !== 2) continue;
        const dx = px[i] - x, dy = py[i] - y, dz = pz[i] - z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= Rq * Rq) continue;
        const d = isqrt(d2), f = tr((Rq - d) * 1024 / Rq), dv = tr(tr(J * f / 1024) / kg[i]);
        if (dv <= 0) continue;
        if (d > 0) { vx[i] = clampV(vx[i] + tr(dv * dx / d)); vy[i] = clampV(vy[i] + tr(dv * dy / d) + tr(dv / 3)); vz[i] = clampV(vz[i] + tr(dv * dz / d)); }
        else vy[i] = clampV(vy[i] + dv);
        if (st[i] === 2) live++;
        st[i] = 1; still[i] = 0; gr[i] = 0; n++;
      }
      D.stats.blasts++;
      return n;
    };
    const isqrt = n => { if (n <= 0) return 0; let r = Math.floor(Math.sqrt(n)); while (r * r > n) r--; while ((r + 1) * (r + 1) <= n) r++; return r; };
    D.wake = i => { if (st[i] === 2) { st[i] = 1; live++; still[i] = 0; } };
    D.pos = (i, out) => { out.x = px[i] / ONE; out.y = py[i] / ONE; out.z = pz[i] / ONE; return out; };
    D.speed = i => (vx[i] < 0 ? -vx[i] : vx[i]) + (vy[i] < 0 ? -vy[i] : vy[i]) + (vz[i] < 0 ? -vz[i] : vz[i]);
    D.free = i => { if (st[i] === 1) live--; st[i] = 0; };
    D.live = () => live;
    D.clear = () => { st.fill(0); live = 0; D.nev = 0; };
    // the whole pool state for tests / replays (hash of positions and velocities)
    D.hash = () => { let h = 2166136261; for (let i = 0; i < N; i++) { if (!st[i]) continue; h = Math.imul(h ^ i, 16777619); h = Math.imul(h ^ (px[i] | 0), 16777619); h = Math.imul(h ^ (py[i] | 0), 16777619); h = Math.imul(h ^ (pz[i] | 0), 16777619); h = Math.imul(h ^ vx[i], 16777619); h = Math.imul(h ^ vy[i], 16777619); h = Math.imul(h ^ st[i], 16777619); } return h >>> 0; };
    return D;
  };
})();

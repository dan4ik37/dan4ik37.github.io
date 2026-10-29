// ═══════════════════════════════════════
//  D37E engine — shared spatial hash (AI LOD P1, T-127; spec E:\d37-core\spec\AI_LOD.md §10.2 "js/engine/shash.js").
//  One uniform grid over a plane (x, y) — a 2D game passes (x, y), a 3D ground game passes (x, z). Typed arrays only: after the
//  first steps (capacity grows by doubling, the only allocation) building and querying make no garbage. Rebuilt every step:
//  H.clear(); H.add(x, y, ref, tag) per item; then queries. Item index i = order of add (0 … H.n − 1); H.x[i], H.y[i] — positions
//  as added (a snapshot: separation reads them, so the result does not depend on the order items move in), H.ref[i] — the game
//  object, H.tag[i] — the game's bits (filter for knear).
// ═══════════════════════════════════════
// H = D37E.shash({ cell = 32, cap = 256 })
//   H.cand(x, y, r, out) → count: indices of items in the cells covering the circle (no distance test; order: cells, then chain)
//   H.query(x, y, r, out) → count: items with (dx² + dy² ≤ r²), same order
//   H.knear(self, x, y, r, k, mask, out, d2) → count ≤ k nearest items within r, tag & mask ≠ 0, not `self`, sorted by (d², index)
//   H.touching(self, x, y, r, k, mask, out, d2) → ≤ k items whose circles touch (d < r + rad[i]; rad — 5th argument of add),
//     own cell first, then rings outward, stop at k: bounded work in a dense crowd
//   H.pairs(i, k, mask, out, d2) → ≤ k items j touching item i, each unordered pair once: later in i's own cell chain + the 4
//     "forward" cells (x+1, y), (x−1, y+1), (x, y+1), (x+1, y+1). Cell ≥ the largest r + r — every touching pair is found once.
//     Separation «k ≤ 6» (AI_LOD.md §10.2): O(k · n) instead of O(n²) per crowded cell
//   out — an Int32Array the caller owns (H.buf(n) gives a shared one of at least n; one per nesting depth: H.buf(n, depth)).
// Determinism: the same adds in the same order give the same answers on every device and frame rate (no Math.random, no time).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  E.shash = function (o = {}){
    const cell = o.cell || 32, inv = 1 / cell;
    let cap = 0, mask = 0, cur = 1;
    let head, stamp, nx, cx, cy, X, Y, tag, RD, maxR = 0;
    const ref = [];
    const H = { n: 0, cell, x: null, y: null, ref, tag: null, rad: null };
    function grow(c){
      const ox = X, oy = Y, ocx = cx, ocy = cy, otg = tag, ord = RD, n = H.n;
      cap = c;
      nx = new Int32Array(cap); cx = new Int32Array(cap); cy = new Int32Array(cap);
      X = new Float64Array(cap); Y = new Float64Array(cap); tag = new Uint8Array(cap); RD = new Float64Array(cap);
      if (ox) { X.set(ox.subarray(0, n)); Y.set(oy.subarray(0, n)); cx.set(ocx.subarray(0, n)); cy.set(ocy.subarray(0, n)); tag.set(otg.subarray(0, n)); RD.set(ord.subarray(0, n)); }
      let t = 64; while (t < cap * 2) t <<= 1;
      head = new Int32Array(t); stamp = new Uint32Array(t); mask = t - 1; cur = 1;
      H.x = X; H.y = Y; H.tag = tag; H.rad = RD;
      for (let i = 0; i < n; i++) link(i);   // rehash what is already in (growth in the middle of a build)
    }
    const bucket = (a, b) => (Math.imul(a, 0x8da6b343) ^ Math.imul(b, 0xd8163841)) & mask;
    function link(i){
      const b = bucket(cx[i], cy[i]);
      if (stamp[b] !== cur) { stamp[b] = cur; head[b] = -1; }
      nx[i] = head[b]; head[b] = i;
    }
    grow(o.cap || 256);
    H.clear = () => { H.n = 0; maxR = 0; if (++cur > 0xfffffff0) { stamp.fill(0); cur = 1; } };
    H.add = (x, y, r = null, t = 1, rad = 0) => {
      if (H.n >= cap) grow(cap * 2);
      const i = H.n++;
      X[i] = x; Y[i] = y; tag[i] = t; ref[i] = r; RD[i] = rad; if (rad > maxR) maxR = rad;
      cx[i] = Math.floor(x * inv); cy[i] = Math.floor(y * inv);
      link(i);
      return i;
    };
    // indices of items in the cells that cover the circle; few items and a huge circle — every item (cheaper, same set ⊇)
    H.cand = (x, y, r, out) => {
      const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv), y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
      let c = 0;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > H.n) { for (let i = 0; i < H.n; i++) if (cx[i] >= x0 && cx[i] <= x1 && cy[i] >= y0 && cy[i] <= y1) out[c++] = i; return c; }
      for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) {
        const h = bucket(a, b);
        if (stamp[h] !== cur) continue;
        for (let i = head[h]; i >= 0; i = nx[i]) if (cx[i] === a && cy[i] === b) out[c++] = i;
      }
      return c;
    };
    H.query = (x, y, r, out) => {
      const n = H.cand(x, y, r, out), r2 = r * r;
      let c = 0;
      for (let k = 0; k < n; k++) { const i = out[k], dx = X[i] - x, dy = Y[i] - y; if (dx * dx + dy * dy <= r2) out[c++] = i; }
      return c;
    };
    // k nearest (insertion into a sorted list of ≤ k): ties by index — the same order everywhere. Candidates first (cand into
    // an own buffer), then one tight loop — no function call per candidate, no garbage
    let kbuf = new Int32Array(256);
    H.knear = (self, x, y, r, k, m, out, d2o) => {
      if (k <= 0) return 0;
      if (kbuf.length < H.n) kbuf = new Int32Array(H.n * 2);
      const nc = H.cand(x, y, r, kbuf), r2 = r * r, XX = X, YY = Y, TG = tag, B = kbuf;
      let c = 0;
      for (let q = 0; q < nc; q++) {
        const i = B[q];
        if (i === self || !(TG[i] & m)) continue;
        const dx = XX[i] - x, dy = YY[i] - y, d = dx * dx + dy * dy;
        if (d > r2) continue;
        if (c === k && (d > d2o[c - 1] || (d === d2o[c - 1] && i > out[c - 1]))) continue;
        let j = c < k ? c++ : c - 1;
        while (j > 0 && (d2o[j - 1] > d || (d2o[j - 1] === d && out[j - 1] > i))) { out[j] = out[j - 1]; d2o[j] = d2o[j - 1]; j--; }
        out[j] = i; d2o[j] = d;
      }
      return c;
    };
    // touching circles: own cell, then the ring around it, then the next … (perimeter of each ring); stop when k are found
    H.touching = (self, x, y, r, k, m, out, d2o) => {
      const gx0 = Math.floor(x * inv), gy0 = Math.floor(y * inv), reach = Math.ceil((r + maxR) * inv);
      let c = 0;
      for (let ring = 0; ring <= reach && c < k; ring++) {
        for (let a = -ring; a <= ring && c < k; a++) {
          const edge = a === -ring || a === ring;
          for (let b = -ring; b <= ring && c < k; b += edge || ring === 0 ? 1 : 2 * ring) {
            const gx = gx0 + a, gy = gy0 + b, h = bucket(gx, gy);
            if (stamp[h] !== cur) continue;
            for (let i = head[h]; i >= 0 && c < k; i = nx[i]) {
              if (cx[i] !== gx || cy[i] !== gy || i === self || !(tag[i] & m)) continue;
              const dx = X[i] - x, dy = Y[i] - y, d = dx * dx + dy * dy, rr = r + RD[i];
              if (d < rr * rr) { out[c] = i; d2o[c] = d; c++; }
            }
          }
        }
      }
      return c;
    };
    const FWD = [1, 0, -1, 1, 0, 1, 1, 1];
    H.pairs = (i, k, m, out, d2o) => {
      const x = X[i], y = Y[i], r = RD[i], gx = cx[i], gy = cy[i];
      // a forward cell farther than r + maxR from the point holds nobody it touches — skip its chain (review #5: ~29 of ~33 checks
      // per call were forward-cell items out of reach). Margin 1e-6·cell: the floor() rounding of cell ids never drops a pair
      const reach = r + maxR + cell * 1e-6, lx = x - gx * cell, ly = y - gy * cell, ex = cell - lx, ey = cell - ly, rr2 = reach * reach;
      let c = 0;
      for (let j = nx[i]; j >= 0 && c < k; j = nx[j]) {   // own cell: items after i in the chain
        if (cx[j] !== gx || cy[j] !== gy || !(tag[j] & m)) continue;
        const dx = X[j] - x, dy = Y[j] - y, d = dx * dx + dy * dy, rr = r + RD[j];
        if (d < rr * rr) { out[c] = j; d2o[c] = d; c++; }
      }
      for (let f = 0; f < 8 && c < k; f += 2) {
        const fx = FWD[f], fy = FWD[f + 1], qx = fx > 0 ? ex : fx < 0 ? lx : 0, qy = fy > 0 ? ey : 0;
        if (qx * qx + qy * qy >= rr2) continue;
        const ax = gx + fx, ay = gy + fy, h = bucket(ax, ay);
        if (stamp[h] !== cur) continue;
        for (let j = head[h]; j >= 0 && c < k; j = nx[j]) {
          if (cx[j] !== ax || cy[j] !== ay || !(tag[j] & m)) continue;
          const dx = X[j] - x, dy = Y[j] - y, d = dx * dx + dy * dy, rr = r + RD[j];
          if (d < rr * rr) { out[c] = j; d2o[c] = d; c++; }
        }
      }
      return c;
    };
    // scratch buffers for callers (one per nesting depth — a callback may query again)
    const bufs = [];
    H.buf = (n, depth = 0) => { let b = bufs[depth]; if (!b || b.length < n) { b = bufs[depth] = new Int32Array(Math.max(64, n * 2)); } return b; };
    H.dispose = () => { ref.length = 0; bufs.length = 0; H.n = 0; };
    return H;
  };
})();

// scripts/d37core-golden/grid-golden.cjs — M1 / M2 (grid visibility, flow fields) golden lines through the site API
// js/engine/core-world.js (wasm backend). A JS port, line by line, of the core's test-grid generator (M:\d37\d37-core src/testgrid.rs
// gen + preset + the fixed scenarios, mirrored in C# by D37TestGrids.cs) and of src/golden.rs grid_flow_lines + abi3_lines +
// ff_lines + m4_lines + m4_tie_lines (the C# port D37CoreGoldenChecks.cs, native run: link flags and mover revisions from shadow
// copies, as the wasm API has no read for them): every line of grid.txt and flow.txt. Every rng call order is part of the golden
// contract.
'use strict';
module.exports = function (J, core) {
  function Rng(seed) { this.st = J.smState(seed >>> 0); }
  Rng.prototype.below = function (n) { return J.smBelowS(this.st, n >>> 0); };
  const E_OPEN = 1, E_DOOR = 2, E_CLOSED = 4, E_LOCKED = 8, E_SEE = 16, E_WALK = 32, E_GLASS = 64;
  const digest = (d, i, v) => J.digest(d, i, v);
  const digestArr = (d, a, n) => { for (let i = 0; i < n; i++) d = digest(d, i, a[i]); return d >>> 0; };
  const PRESETS = [
    { w: 16, h: 16, layers: 1, mode: 0, wall: 30, door: 15, glass: 5, braid: 0, cost: 0, links: 0 },
    { w: 24, h: 24, layers: 1, mode: 1, wall: 0, door: 12, glass: 4, braid: 15, cost: 10, links: 0 },
    { w: 32, h: 20, layers: 2, mode: 0, wall: 35, door: 10, glass: 5, braid: 0, cost: 8, links: 24 },
    { w: 48, h: 48, layers: 2, mode: 1, wall: 0, door: 10, glass: 3, braid: 12, cost: 5, links: 40 },
    { w: 14, h: 14, layers: 3, mode: 0, wall: 20, door: 20, glass: 10, braid: 0, cost: 20, links: 30 },
    { w: 64, h: 64, layers: 1, mode: 0, wall: 45, door: 8, glass: 2, braid: 0, cost: 0, links: 0 },
  ];
  function openValue(r, p) {
    let v = E_OPEN;
    const d = r.below(100);
    if (d < p.door) {
      v |= E_DOOR;
      const bits = r.below(16);
      if (bits & 1) { v |= E_CLOSED; if (bits & 2) v |= E_LOCKED; }
      if (bits & 4) v |= E_SEE;
      if (bits & 8) v |= E_WALK;
    } else if (d < p.door + p.glass) v |= E_GLASS;
    return v;
  }
  const nb = (c, s, w) => s === 0 ? c + w : s === 1 ? c + 1 : s === 2 ? c - w : c - 1;
  function put(edges, w, c, s, v) { edges[c * 4 + s] = v; edges[nb(c, s, w) * 4 + ((s + 2) & 3)] = v; }
  function gen(seed, p) {
    const w = p.w, h = p.h, layers = p.layers, plane = w * h, cells = plane * layers;
    const r = new Rng(seed);
    const cl = new Uint8Array(plane);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 1;
      for (let l = 1; l < layers; l++) if (J.h32(seed, x >> 2, y >> 2, l, 7) % 100 < 45) m |= 1 << l;
      cl[y * w + x] = m;
    }
    const present = c => { const l = Math.floor(c / plane); return ((cl[c - l * plane] >> l) & 1) !== 0; };
    const edges = new Uint8Array(cells * 4);
    if (p.mode === 0) {
      for (let c = 0; c < cells; c++) {
        if (!present(c)) continue;
        const r0 = c - Math.floor(c / plane) * plane, x = r0 % w, y = Math.floor(r0 / w);
        if (y + 1 < h && present(c + w)) { const v = r.below(100) < p.wall ? 0 : openValue(r, p); put(edges, w, c, 0, v); }
        if (x + 1 < w && present(c + 1)) { const v = r.below(100) < p.wall ? 0 : openValue(r, p); put(edges, w, c, 1, v); }
      }
    } else {
      const visited = new Uint8Array(cells), stack = [], cand = [0, 0, 0, 0];
      for (let start = 0; start < cells; start++) {
        if (!present(start) || visited[start]) continue;
        visited[start] = 1; stack.push(start);
        while (stack.length) {
          const c = stack[stack.length - 1], r0 = c - Math.floor(c / plane) * plane, x = r0 % w, y = Math.floor(r0 / w);
          let nc = 0;
          for (let s = 0; s < 4; s++) {
            if (s === 0 && !(y + 1 < h)) continue;
            if (s === 1 && !(x + 1 < w)) continue;
            if (s === 2 && !(y > 0)) continue;
            if (s === 3 && !(x > 0)) continue;
            const n = nb(c, s, w);
            if (present(n) && !visited[n]) cand[nc++] = s;
          }
          if (nc === 0) { stack.pop(); continue; }
          const s = cand[r.below(nc)], n = nb(c, s, w);
          const v = openValue(r, p);
          put(edges, w, c, s, v);
          visited[n] = 1; stack.push(n);
        }
      }
      for (let c = 0; c < cells; c++) {
        if (!present(c)) continue;
        const r0 = c - Math.floor(c / plane) * plane, x = r0 % w, y = Math.floor(r0 / w);
        if (y + 1 < h && present(c + w) && edges[c * 4] === 0 && r.below(100) < p.braid) put(edges, w, c, 0, openValue(r, p));
        if (x + 1 < w && present(c + 1) && edges[c * 4 + 1] === 0 && r.below(100) < p.braid) put(edges, w, c, 1, openValue(r, p));
      }
    }
    const cost = new Uint8Array(cells);
    if (p.cost > 0) for (let c = 0; c < cells; c++) {
      const a = r.below(100);
      let v = a < p.cost ? r.below(60) : 0;
      if (r.below(200) === 0) v = 255;
      cost[c] = v;
    }
    const links = [];
    for (let k = 0; k < p.links; k++) {
      const x = r.below(w), y = r.below(h), la = r.below(layers), lb = r.below(layers);
      const x2 = Math.min(Math.max(x + r.below(5) - 2, 0), w - 1), y2 = Math.min(Math.max(y + r.below(5) - 2, 0), h - 1);
      const flags = 1 + r.below(3), lcost = 10 + r.below(50);
      const a = la * plane + y * w + x, b = lb * plane + y2 * w + x2;
      if (a === b || !present(a) || !present(b)) continue;
      links.push(a, b, lcost | (flags << 16));
    }
    return { desc: Int32Array.from([w, h, layers, 0]), edges, cl, cost, links: Int32Array.from(links), nlinks: links.length / 3, cells };
  }
  const pair = new Int32Array(2), vres = new Int32Array(4);
  function visBlock(tag, pi, g, seed, out) {
    const r = new Rng(seed ^ 0x5151), cells = g.cells;
    let d = 0, i = 0, vis = 0;
    for (let k = 0; k < 2000; k++) {
      const a = r.below(cells), b = r.below(cells);
      const m = r.below(4) === 0 ? r.below(256 * 16) : 0;
      const f = r.below(8) === 0 ? 1 : 0;
      pair[0] = a; pair[1] = b;
      if (g.visQuery(pair, 1, m, f, vres) !== 0) throw new Error('vis_query');
      const visible = vres[0] & 255, fl = (vres[0] >>> 8) & 255, doors = (vres[0] >>> 16) & 255, status = vres[0] >>> 24;
      const firstDoor = vres[1] | 0, man = vres[2] & 0xFFFF, eu = vres[3] >>> 0;
      vis += visible;
      for (const x of [visible, fl, doors, status, firstDoor >>> 0, man, eu]) { d = digest(d, i, x); i++; }
      if (k < 12 && tag === 'vis') out.push(`visq ${pi} ${a} ${b} ${m} ${f} ${visible} ${fl} ${doors} ${status} ${firstDoor} ${man} ${eu}`);
    }
    out.push(`${tag} ${pi} 2000 ${vis} ${d >>> 0}`);
  }
  const so = new Int32Array(4);
  function sched(f) {
    let steps = 0, d = 0, i = 0;
    for (;;) {
      f.step(64, so);
      steps++;
      d = digest(d, i, so[0] >>> 0); d = digest(d, i + 1, so[1] >>> 0); i += 2;
      if ((so[3] < 0 && so[2] === 0) || steps > 1000000) break;
    }
    return [steps, d >>> 0];
  }
  const fi = new Int32Array(8);
  function flowLines(tag, pi, f, slots, out) {
    const dir = new Uint8Array(f.cells), dist = new Uint32Array(f.cells);
    slots.forEach((s, ci) => {
      f.read(s, dir, dist);
      f.info(s, fi);
      out.push(`${tag} ${pi} ${ci} ${s} ${fi[1] >>> 0} ${fi[3] >>> 0} ${fi[4] >>> 0} ${digestArr(0, dist, dist.length)} ${digestArr(0, dir, dir.length)}`);
    });
  }
  // ═══════════ the later sections (golden.rs abi3_lines, ff_lines, m4_lines, m4_tie_lines; C# D37CoreGoldenChecks.cs Abi3Lines,
  // FfLines, M4Lines, M4TieLines — the same draw order). The wasm API has no link-flag read: a shadow copy of the link flags
  // (input & L_MASK, updated like set_links) gives the link digest, as the C# native run does; mover revisions likewise.
  const L_WALK = 1, L_SIGHT = 2, L_ONEWAY = 4, L_CRAWL = 8, L_MASK = 15, FLEE = 1;
  const SIDE_N = 0, SIDE_E = 1, SIDE_S = 2, SIDE_W = 3;
  // FlowParams words: kind, tag, closed_door_cost, max_dist, flee_num, flee_den, link_deny, flee_flags, mover, threat_mover, belief, 0
  const FP = o => { const p = new Int32Array(12); o = o || {}; p[0] = o.kind | 0; p[1] = o.tag | 0; p[2] = o.door | 0; p[3] = o.maxDist | 0; p[6] = o.deny | 0; p[7] = o.ff | 0; p[8] = o.mover | 0; p[9] = o.tmover | 0; p[10] = o.belief | 0; return p; };
  const G1 = (cell, cost) => Int32Array.from([cell, cost | 0]);
  const goalsOf = list => { const a = new Int32Array(list.length * 2); list.forEach((g, k) => { a[k * 2] = g[0]; a[k * 2 + 1] = g[1]; }); return a; };
  function makeGrid(gg) {
    const r = core.createGrid(gg.desc, gg.edges, gg.cl, gg.cost, gg.links, gg.nlinks, new Int32Array(8));
    if (r.code !== 0) throw new Error('grid create ' + r.code);
    return r.grid;
  }
  function makeFlow(g, slots, maxGoals) {
    const r = core.createFlow(g, Int32Array.from([slots, maxGoals, 0, 0]));
    if (r.code !== 0) throw new Error('flow create ' + r.code);
    return r.flow;
  }
  function acquireAll(f, cases) { return cases.map(([gs, pr]) => { const rc = f.acquire(gs, gs.length / 2, pr); if (rc !== 0) throw new Error('acquire ' + rc); return f.slot; }); }
  function Shadow(gg) { this.F = new Uint8Array(gg.nlinks); for (let i = 0; i < gg.nlinks; i++) this.F[i] = (gg.links[i * 3 + 2] >>> 16) & L_MASK; }
  Shadow.prototype.set = function (idx, fl) { for (let j = 0; j < idx.length; j++) this.F[idx[j]] = fl[j] & L_MASK; };
  Shadow.prototype.digest = function () { return digestArr(0, this.F, this.F.length); };
  const gi8 = new Int32Array(8);
  const comps = g => { g.info(gi8); return gi8[5] >>> 0; };
  const edgesDigest = g => { const ex = new Uint8Array(g.cells * 4); g.getEdges(ex); return digestArr(0, ex, ex.length); };
  const classesDigest = g => { const ex = new Uint8Array(g.cells * 4); if (g.getClasses(ex) !== 0) throw new Error('getClasses'); return digestArr(0, ex, ex.length); };
  const beliefDigest = (f, grp) => { const ex = new Uint8Array(f.cells * 4); if (f.getBelief(grp, ex) !== 0) throw new Error('getBelief'); return digestArr(0, ex, ex.length); };
  function staleLines(tag, pi, f, slots, out) { slots.forEach((s, ci) => { f.info(s, fi); out.push(`${tag} ${pi} ${ci} ${fi[0] >>> 0} ${fi[2] >>> 0}`); }); }
  function sampleLines(tag, f, slots, probes, out, pre) {
    const pc = Int32Array.from(probes), dir = new Uint8Array(probes.length), dist = new Uint32Array(probes.length);
    slots.forEach((s, ci) => {
      f.sample(s, pc, probes.length, dir, dist);
      let line = `${tag} ${pre == null ? '' : pre + ' '}${ci} ${s}`;
      for (let k = 0; k < probes.length; k++) line += ` ${dir[k]} ${dist[k]}`;
      out.push(line);
    });
  }
  function m4StaleLines(tag, pi, t, f, slots, out) { slots.forEach((s, ci) => { f.info(s, fi); out.push(`${tag} ${pi} ${t} ${ci} ${fi[0] >>> 0} ${fi[2] >>> 0}`); }); }
  function m4FlowLines(tag, pi, t, f, slots, out) {
    const dir = new Uint8Array(f.cells), dist = new Uint32Array(f.cells);
    slots.forEach((s, ci) => {
      f.read(s, dir, dist); f.info(s, fi);
      out.push(`${tag} ${pi} ${t} ${ci} ${s} ${fi[1] >>> 0} ${fi[3] >>> 0} ${fi[4] >>> 0} ${digestArr(0, dist, dist.length)} ${digestArr(0, dir, dir.length)}`);
    });
  }
  const edge2 = list => { const a = new Int32Array(list.length * 2); list.forEach((e, k) => { a[k * 2] = e[0]; a[k * 2 + 1] = (e[1] & 255) | ((e[2] & 255) << 8); }); return a; };
  const cost2 = list => { const a = new Int32Array(list.length * 2); list.forEach((e, k) => { a[k * 2] = e[0]; a[k * 2 + 1] = e[1] & 255; }); return a; };
  function relink(seed, gg) { // testgrid.rs abi3_relink
    const r = new Rng(seed ^ 0xAB13);
    for (let i = 0; i < gg.nlinks; i++) {
      const x = r.below(8), w = gg.links[i * 3 + 2], cost = w & 0xFFFF, fl = (w >>> 16) & 255;
      gg.links[i * 3 + 2] = cost | ((x === 7 ? 0 : fl | ((x & 3) << 2)) << 16);
    }
  }
  const presentGG = (gg, c) => { const plane = gg.desc[0] * gg.desc[1]; return ((gg.cl[c % plane] >> Math.floor(c / plane)) & 1) !== 0; };
  function pick(r, gg, cells) { let c = 0; for (let k = 0; k < 64; k++) { c = r.below(cells); if (presentGG(gg, c) && gg.cost[c] !== 255) break; } return c; }
  const linkW = list => { const a = new Int32Array(list.length * 3); list.forEach((l, k) => { a[k * 3] = l[0]; a[k * 3 + 1] = l[1]; a[k * 3 + 2] = (l[2] & 0xFFFF) | ((l[3] & 255) << 16); }); return a; };
  // ── fixed scenarios (testgrid.rs)
  const a3 = (x, y, l) => l * 60 + y * 10 + x, A3_VENT = 2, A3_HATCH = 3;
  function a3Scenario() {
    const w = 10, h = 6, cells = w * h * 2, edges = new Uint8Array(cells * 4);
    for (let c = 0; c < cells; c++) {
      const r0 = c % (w * h), x = r0 % w, y = Math.floor(r0 / w);
      if (y + 1 < h) edges[c * 4 + SIDE_N] = E_OPEN;
      if (x + 1 < w) edges[c * 4 + SIDE_E] = E_OPEN;
      if (y > 0) edges[c * 4 + SIDE_S] = E_OPEN;
      if (x > 0) edges[c * 4 + SIDE_W] = E_OPEN;
    }
    const links = linkW([[a3(0, 0, 1), a3(0, 0, 0), 30, L_WALK | L_SIGHT], [a3(8, 3, 1), a3(8, 3, 0), 10, L_WALK | L_ONEWAY], [a3(1, 5, 0), a3(9, 5, 0), 20, L_WALK | L_CRAWL], [a3(5, 1, 1), a3(5, 1, 0), 10, 0]]);
    return { desc: Int32Array.from([w, h, 2, 0]), edges, cl: new Uint8Array(w * h).fill(3), cost: new Uint8Array(cells), links, nlinks: 4, cells };
  }
  const A3_PROBES = [a3(8, 3, 1), a3(8, 3, 0), a3(5, 1, 1), a3(5, 1, 0), a3(1, 5, 0), a3(9, 5, 0), a3(0, 0, 1), a3(0, 0, 0)];
  function tieGrid() {
    const links = linkW([[0, 1, 10, L_WALK | L_CRAWL], [0, 1, 10, L_WALK], [0, 2, 10, L_WALK | L_ONEWAY], [2, 0, 10, L_WALK | L_ONEWAY], [3, 0, 5, L_WALK | L_ONEWAY | L_CRAWL]]);
    return { desc: Int32Array.from([4, 1, 1, 0]), edges: new Uint8Array(16), cl: new Uint8Array(4).fill(1), cost: new Uint8Array(4), links, nlinks: 5, cells: 4 };
  }
  const TIE_TOGGLES = [0, L_WALK | L_ONEWAY, L_WALK, L_WALK | L_ONEWAY];
  const ffc = (x, y) => y * 14 + x, FF_VENT = 0;
  function ffHideout() {
    const w = 14, h = 5, edges = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (x + 1 < w) { const v = x === 2 ? (y === 2 ? E_OPEN | E_DOOR | E_CLOSED : 0) : x === 9 ? 0 : E_OPEN; edges[c * 4 + SIDE_E] = v; edges[(c + 1) * 4 + SIDE_W] = v; }
      if (y + 1 < h) { edges[c * 4 + SIDE_N] = E_OPEN; edges[(c + w) * 4 + SIDE_S] = E_OPEN; }
    }
    return { desc: Int32Array.from([w, h, 1, 0]), edges, cl: new Uint8Array(w * h).fill(1), cost: new Uint8Array(w * h), links: linkW([[ffc(8, 2), ffc(11, 2), 10, L_WALK | L_CRAWL]]), nlinks: 1, cells: w * h };
  }
  const FF_PROBES = [ffc(5, 2), ffc(8, 2), ffc(11, 2), ffc(13, 0), ffc(3, 2), ffc(2, 2), ffc(0, 0), ffc(9, 4)];
  const m4c = (x, y) => y * 9 + x;
  function m4Scene() {
    const w = 9, h = 3, edges = new Uint8Array(w * h * 4), cost = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = y * w + x;
      if (y === 2) cost[c] = 5;
      if (x + 1 < w) put(edges, w, c, SIDE_E, y === 1 && x === 4 ? E_OPEN | E_DOOR | E_CLOSED : E_OPEN);
      if (y === 1 && y + 1 < h) put(edges, w, c, SIDE_N, x === 0 || x === 8 ? E_OPEN : x === 4 ? E_OPEN | E_GLASS : 0);
    }
    return { desc: Int32Array.from([w, h, 1, 0]), edges, cl: new Uint8Array(w * h).fill(1), cost, links: linkW([[m4c(1, 0), m4c(1, 2), 30, L_WALK | L_CRAWL]]), nlinks: 1, cells: w * h };
  }
  function m4SceneClasses() { const v = [[m4c(4, 1), SIDE_E, 4], [m4c(4, 1), SIDE_N, 2]]; for (let x = 0; x < 9; x++) v.push([m4c(x, 0), SIDE_N, x === 6 ? 1 : 5]); return edge2(v); }
  const M4_PROBES = [m4c(0, 1), m4c(4, 1), m4c(5, 1), m4c(0, 0), m4c(6, 0), m4c(4, 2), m4c(8, 0), m4c(8, 2)];
  // ── movers (C# M4Movers / golden.rs M4_MOVERS): 11 words of u16 pairs
  const XX = 0xFFFF;
  function Mv(open, door, wall, pd, pw, pg, deny, flags, pad) {
    const h = [open, ...door, ...wall, pd, pw, pg, (deny & 255) | ((flags & 255) << 8), pad], m = new Int32Array(11);
    for (let i = 0; i < 11; i++) m[i] = (h[2 * i] & 0xFFFF) | ((h[2 * i + 1] & 0xFFFF) << 16);
    return m;
  }
  const M4_MOVERS = [
    Mv(5, [50, 15, 10, XX, XX, XX, XX, XX], [XX, 40, 10, XX, XX, XX, XX, XX], 8, XX, 20, 0, 0, 0),
    Mv(XX, [XX, 94, XX, XX, XX, XX, XX, XX], [XX, 125, XX, XX, XX, XX, XX, XX], XX, XX, XX, 0, 0, 0),
    Mv(XX, [60, 20, 24, XX, XX, XX, XX, XX], [XX, 40, 24, XX, XX, XX, XX, XX], 12, XX, 16, 0, 0, 0),
    Mv(XX, [25, 9, 6, 75, 375, XX, XX, XX], [XX, 19, 6, XX, XX, XX, XX, XX], 13, XX, 9, 8, 0, 0),
    Mv(XX, [7, 3, 3, 13, 50, XX, XX, XX], [20, 7, 3, 50, 150, XX, XX, XX], 10, 27, 3, 8, 0, 0),
    Mv(XX, [5, 5, 5, 5, 5, 5, XX, XX], [5, 5, 5, 5, 5, 5, XX, XX], 5, 5, 5, 0, 0, 0),
    Mv(XX, [XX, XX, XX, XX, XX, XX, XX, XX], [XX, XX, XX, XX, XX, XX, XX, XX], XX, XX, XX, 0, 0, 0),
    Mv(5000, [0, 1, 999, 1000, 1001, 0xFFFE, XX, 2000], [0xFFFE, 0, 3, XX, 1000, 7, XX, 1], 0, 1500, XX, 0xFF, 0xAB, 0x1234),
  ];
  const M4_TIE_MOVERS = [Mv(XX, Array(8).fill(XX), [3, XX, XX, XX, XX, XX, XX, XX], XX, XX, XX, 4, 0, 0), Mv(XX, Array(8).fill(XX), Array(8).fill(XX), XX, XX, XX, 12, 0, 0)];
  const M4_HUMAN = 1, M4_CRAWLER = 3, M4_BRUTE = 4, M4_TANK = 5, M4_GHOST = 6, M4_NONE = 7;
  function Rev() { this.r = new Uint32Array(16); }
  Rev.prototype.set = function (f, id, m) { const r = f.setMover(id, m); if (id >= 0 && id < 16 && r === 0) this.r[id]++; return r; };
  function setMovers(f, rv) { M4_MOVERS.forEach((m, i) => { if (rv.set(f, i + 1, m) !== 0) throw new Error('setMover ' + (i + 1)); }); }
  function ffChangeBatch(seed, g) {
    const cells = g.cells, r = new Rng(seed ^ 0xFFC4), e = [];
    for (let k = 0; k < 4; k++) { const cell = r.below(cells), side = r.below(4), value = r.below(3) === 0 ? 0 : (r.below(128) | 1); e.push([cell, side, value]); }
    g.info(gi8);
    const nl = (gi8[4] >>> 0) > 0 ? 2 : 0, li = new Int32Array(nl), lf = new Uint8Array(nl);
    for (let k = 0; k < nl; k++) { li[k] = r.below(gi8[4] >>> 0); lf[k] = r.below(16); }
    const cc = [];
    for (let k = 0; k < 3; k++) { const cell = r.below(cells); const co = r.below(3) === 0 ? 255 : r.below(40); cc.push([cell, co]); }
    return { e: edge2(e), ne: 4, li, lf, nl, cc: cost2(cc), nc: 3 };
  }

  function abi3Lines(gl, fl) {
    for (const pi of [2, 3, 4]) {
      const seed = 100 + pi;
      const gg = gen(seed, PRESETS[pi]);
      { // sight ignores ONEWAY / CRAWL
        const lb = gg.links.slice(); for (let i = 0; i < gg.nlinks; i++) lb[i * 3 + 2] |= (L_ONEWAY | L_CRAWL) << 16;
        const gb = makeGrid(Object.assign({}, gg, { links: lb }));
        visBlock('a3visbits', pi, gb, seed, gl); gb.destroy();
      }
      relink(seed, gg);
      const g = makeGrid(gg), sh = new Shadow(gg);
      g.info(gi8);
      gl.push(`a3grid ${pi} ${seed} ${gi8[4] >>> 0} ${gi8[5] >>> 0} ${edgesDigest(g)} ${sh.digest()}`);
      visBlock('a3vis', pi, g, seed, gl);
      const f = makeFlow(g, 8, 16), cells = g.cells, r = new Rng(seed ^ 0xF30F);
      const g1 = goalsOf([[pick(r, gg, cells), 0]]);
      const g2 = []; for (let k = 0; k < 2; k++) { const c = pick(r, gg, cells), co = r.below(20); g2.push([c, co]); }
      const g3 = []; for (let k = 0; k < 2; k++) g3.push([pick(r, gg, cells), 0]);
      const g4 = goalsOf([[pick(r, gg, cells), 0]]);
      const G2 = goalsOf(g2), G3 = goalsOf(g3);
      const slots = acquireAll(f, [[g1, FP()], [g1, FP({ deny: L_CRAWL })], [G2, FP({ tag: 1, door: 20, deny: L_ONEWAY })], [G3, FP({ kind: FLEE })],
        [G3, FP({ kind: FLEE, door: 20, deny: L_CRAWL })], [g4, FP({ maxDist: 300, deny: L_ONEWAY | L_CRAWL })], [g1, FP({ deny: L_MASK })], [g1, FP({ deny: 0x18 })]]);
      let [steps, sd] = sched(f);
      fl.push(`a3sched ${pi} 64 ${steps} ${sd}`);
      flowLines('a3flow', pi, f, slots, fl);
      const rt = new Rng(seed ^ 0xC4A3), nl = gi8[4] >>> 0, nt = nl > 0 ? 6 : 0, idx = new Int32Array(nt), nf = new Uint8Array(nt);
      for (let k = 0; k < nt; k++) { idx[k] = rt.below(nl); nf[k] = rt.below(16); }
      const orig = new Uint8Array(nt); for (let k = 0; k < nt; k++) orig[k] = sh.F[idx[k]];
      let a = g.setLinks(idx, nf, nt); sh.set(idx, nf);
      gl.push(`a3chg ${pi} ${a} ${comps(g)} ${sh.digest()}`);
      visBlock('a3vischg', pi, g, seed, gl);
      staleLines('a3stale', pi, f, slots, fl);
      [steps, sd] = sched(f);
      fl.push(`a3sched2 ${pi} 64 ${steps} ${sd}`);
      flowLines('a3flowchg', pi, f, slots, fl);
      const ri = new Int32Array(nt), rf = new Uint8Array(nt);
      for (let k = 0; k < nt; k++) { ri[k] = idx[nt - 1 - k]; rf[k] = orig[nt - 1 - k]; }
      a = g.setLinks(ri, rf, nt); sh.set(ri, rf);
      gl.push(`a3back ${pi} ${a} ${comps(g)} ${sh.digest()}`);
      staleLines('a3stale2', pi, f, slots, fl);
      [steps, sd] = sched(f);
      fl.push(`a3sched3 ${pi} 64 ${steps} ${sd}`);
      flowLines('a3flowback', pi, f, slots, fl);
      f.destroy(); g.destroy();
    }
    { // the scenario: pit, vent, stairs, pre-declared hatch enabled and disabled via set_links
      const gg = a3Scenario(), g = makeGrid(gg), sh = new Shadow(gg);
      g.info(gi8);
      gl.push(`a3scene ${gi8[3] >>> 0} ${gi8[4] >>> 0} ${gi8[5] >>> 0} ${edgesDigest(g)} ${sh.digest()}`);
      visBlock('a3svis', 0, g, 3, gl);
      const goal = (x, y, l) => goalsOf([[a3(x, y, l), 0]]);
      const cases = [[goal(9, 0, 0), FP()], [goal(9, 0, 0), FP({ deny: L_CRAWL })], [goal(9, 5, 1), FP()], [goal(5, 1, 0), FP({ deny: L_ONEWAY })],
        [goal(1, 1, 1), FP({ kind: FLEE })], [goal(1, 1, 1), FP({ kind: FLEE, door: 20, deny: L_CRAWL })]];
      const f = makeFlow(g, cases.length, 4), slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`a3ssched 0 64 ${steps} ${sd}`);
      flowLines('a3sflow', 0, f, slots, fl);
      sampleLines('a3ssample', f, slots, A3_PROBES, fl);
      const hv = Int32Array.from([A3_HATCH, A3_VENT]);
      const on = Uint8Array.from([L_WALK | L_ONEWAY, L_WALK]);
      let a = g.setLinks(hv, on, 2); sh.set(hv, on);
      gl.push(`a3schg ${a} ${comps(g)} ${sh.digest()}`);
      staleLines('a3sstale', 0, f, slots, fl);
      [steps, sd] = sched(f);
      fl.push(`a3ssched2 0 64 ${steps} ${sd}`);
      flowLines('a3sflowchg', 0, f, slots, fl);
      sampleLines('a3ssamplechg', f, slots, A3_PROBES, fl);
      const off = Uint8Array.from([0, L_WALK | L_CRAWL]);
      a = g.setLinks(hv, off, 2); sh.set(hv, off);
      gl.push(`a3sback ${a} ${comps(g)} ${sh.digest()}`);
      staleLines('a3sstale2', 0, f, slots, fl);
      [steps, sd] = sched(f);
      fl.push(`a3ssched3 0 64 ${steps} ${sd}`);
      flowLines('a3sflowback', 0, f, slots, fl);
      sampleLines('a3ssampleback', f, slots, A3_PROBES, fl);
      f.destroy(); g.destroy();
    }
    { // direction ties
      const gg = tieGrid(), g = makeGrid(gg), sh = new Shadow(gg), g0 = goalsOf([[0, 0]]);
      const cases = [0, 8, 0x18, 4, 12].map(d => [g0, FP({ deny: d })]);
      cases.push([g0, FP({ kind: FLEE })], [g0, FP({ kind: FLEE, deny: L_CRAWL })]);
      const f = makeFlow(g, 8, 2), slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`a3tiesched 0 64 ${steps} ${sd}`);
      sampleLines('a3tie', f, slots, [0, 1, 2, 3], fl, 0);
      const li = Int32Array.from([2]);
      TIE_TOGGLES.forEach((v, k) => {
        const t = k + 1, nf = Uint8Array.from([v]);
        const a = g.setLinks(li, nf, 1); sh.set(li, nf);
        fl.push(`a3tiechg ${t} ${v} ${a} ${sh.digest()}`);
        staleLines('a3tiestale', t, f, slots, fl);
        [steps, sd] = sched(f);
        fl.push(`a3tiesched ${t} 64 ${steps} ${sd}`);
        sampleLines('a3tie', f, slots, [0, 1, 2, 3], fl, t);
      });
      f.destroy(); g.destroy();
    }
  }

  function ffLines(fl) {
    const FF = [0, 1, 2, 3, 5, 7, 1 | 8 << 8, 3 | 8 << 8, 7 | 12 << 8, 0xFFFFFFFF | 0];
    const ffp = (ff, door, deny) => FP({ kind: FLEE, door, deny, ff });
    for (const pi of [2, 3, 4]) {
      const seed = 100 + pi, gg = gen(seed, PRESETS[pi]);
      relink(seed, gg);
      const g = makeGrid(gg), cells = g.cells, f = makeFlow(g, 24, 16);
      const r = new Rng(seed ^ 0xFF18);
      const ga = []; for (let k = 0; k < 2; k++) ga.push([pick(r, gg, cells), 0]);
      const gbc = pick(r, gg, cells), gb = goalsOf([[gbc, r.below(20)]]), GA = goalsOf(ga);
      const cases = [];
      FF.forEach((ff, i) => { cases.push([GA, ffp(ff, 20, 0)]); cases.push([gb, FP({ kind: FLEE, door: i % 2 === 0 ? 0 : 20, maxDist: 400, deny: L_CRAWL, ff })]); });
      cases.push([GA, ffp(0x0F07, 20, 0)], [gb, FP()], [gb, FP({ ff: 0xFFFFFFFF | 0 })]);
      const slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`ffsched ${pi} 64 ${steps} ${sd}`);
      flowLines('ffflow', pi, f, slots, fl);
      const b = ffChangeBatch(seed, g);
      const a1 = g.setEdges(b.e, b.ne), a2 = g.setLinks(b.li, b.lf, b.nl), a3c = g.setCosts(b.cc, b.nc);
      fl.push(`ffchg ${pi} ${a1} ${a2} ${a3c} ${comps(g)}`);
      staleLines('ffstale', pi, f, slots, fl);
      [steps, sd] = sched(f);
      fl.push(`ffsched2 ${pi} 64 ${steps} ${sd}`);
      flowLines('ffflowchg', pi, f, slots, fl);
      f.destroy(); g.destroy();
    }
    { // the ABI 3 scenario; the hatch opened, then closed again
      const gg = a3Scenario(), g = makeGrid(gg), sh = new Shadow(gg);
      const goal = (x, y, l) => goalsOf([[a3(x, y, l), 0]]);
      const cases = [[goal(2, 3, 1), ffp(0, 0, 0)], [goal(2, 3, 1), ffp(1, 0, 0)], [goal(2, 3, 1), ffp(3, 0, 0)], [goal(2, 3, 1), ffp(3 | 8 << 8, 0, 8)],
        [goal(8, 3, 1), ffp(0, 0, 0)], [goal(8, 3, 1), ffp(1, 0, 0)], [goal(8, 3, 1), ffp(3, 0, 0)], [goal(2, 3, 0), ffp(3 | 8 << 8, 0, 0)], [goal(2, 3, 0), ffp(7 | 12 << 8, 20, 0)]];
      const f = makeFlow(g, cases.length, 4), slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`ffssched 0 64 ${steps} ${sd}`);
      flowLines('ffsflow', 0, f, slots, fl);
      sampleLines('ffssample', f, slots, A3_PROBES, fl);
      const hatch = Int32Array.from([A3_HATCH]);
      for (let t = 1; t <= 2; t++) {
        const nf = Uint8Array.from([t === 1 ? L_WALK | L_ONEWAY : 0]);
        const a = g.setLinks(hatch, nf, 1); sh.set(hatch, nf);
        fl.push(`ffschg ${t} ${a} ${sh.digest()}`);
        staleLines('ffsstale', t, f, slots, fl);
        [steps, sd] = sched(f);
        fl.push(`ffssched ${t} 64 ${steps} ${sd}`);
        flowLines(t === 1 ? 'ffsflowchg' : 'ffsflowback', t, f, slots, fl);
        sampleLines(t === 1 ? 'ffssamplechg' : 'ffssampleback', f, slots, A3_PROBES, fl);
      }
      f.destroy(); g.destroy();
    }
    { // the hideout: (1) vent closed and door opened, (2) a hideout cell blocked, (3) all restored
      const gg = ffHideout(), g = makeGrid(gg), sh = new Shadow(gg);
      g.info(gi8);
      fl.push(`ffhide ${gi8[3] >>> 0} ${gi8[4] >>> 0} ${gi8[5] >>> 0} ${edgesDigest(g)} ${sh.digest()}`);
      const th = goalsOf([[ffc(5, 2), 0]]), side = goalsOf([[ffc(1, 2), 0]]);
      const r40 = ffp(3 | 8 << 8, 20, 0); r40[3] = 40;
      const cases = [[th, ffp(0, 20, 0)], [th, ffp(1 | 8 << 8, 20, 0)], [th, ffp(3 | 8 << 8, 20, 0)], [th, ffp(5 | 8 << 8, 20, 0)], [th, ffp(7 | 8 << 8, 20, 0)],
        [th, ffp(7 | 8 << 8, 0, 0)], [th, ffp(3, 20, 0)], [th, r40], [side, ffp(7, 20, 0)], [th, ffp(0xFFFFFFFF | 0, 20, 0)]];
      const f = makeFlow(g, cases.length, 4), slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`ffhsched 0 64 ${steps} ${sd}`);
      flowLines('ffhflow', 0, f, slots, fl);
      sampleLines('ffhsample', f, slots, FF_PROBES, fl);
      const door = edge2([[ffc(2, 2), SIDE_E, E_OPEN | E_DOOR | E_CLOSED]]), open = edge2([[ffc(2, 2), SIDE_E, E_OPEN]]);
      const vent = Int32Array.from([FF_VENT]), corner = ffc(13, 0);
      for (let t = 1; t <= 3; t++) {
        let a1 = 0, a2 = 0, a3c = 0;
        if (t === 1) { a1 = g.setEdges(open, 1); const nf = Uint8Array.from([0]); a2 = g.setLinks(vent, nf, 1); sh.set(vent, nf); }
        else if (t === 2) a3c = g.setCosts(cost2([[corner, 255]]), 1);
        else { a1 = g.setEdges(door, 1); const nf = Uint8Array.from([L_WALK | L_CRAWL]); a2 = g.setLinks(vent, nf, 1); sh.set(vent, nf); a3c = g.setCosts(cost2([[corner, 0]]), 1); }
        fl.push(`ffhchg ${t} ${a1} ${a2} ${a3c} ${edgesDigest(g)} ${sh.digest()}`);
        staleLines('ffhstale', t, f, slots, fl);
        [steps, sd] = sched(f);
        fl.push(`ffhsched ${t} 64 ${steps} ${sd}`);
        flowLines(t === 3 ? 'ffhflowback' : 'ffhflowchg', t, f, slots, fl);
        sampleLines(t === 3 ? 'ffhsampleback' : 'ffhsamplechg', f, slots, FF_PROBES, fl);
      }
      f.destroy(); g.destroy();
    }
  }

  function m4Lines(gl, fl) {
    const tw = (mover, belief) => FP({ mover, belief });
    const fl4 = (ff, mover, tmover, belief) => FP({ kind: FLEE, ff, mover, tmover, belief });
    for (const pi of [2, 3, 4]) {
      const seed = 100 + pi, gg = gen(seed, PRESETS[pi]);
      relink(seed, gg);
      const g = makeGrid(gg), cells = g.cells;
      { const r = new Rng(seed ^ 0xC1A5), v = []; for (let c = 0; c < cells; c++) for (let side = 0; side < 2; side++) v.push([c, side, r.below(4) === 0 ? 0 : r.below(8)]);
        const a = g.setClasses(edge2(v), v.length);
        gl.push(`m4grid ${pi} ${a} ${comps(g)} ${classesDigest(g)}`); }
      visBlock('m4vis', pi, g, seed, gl);
      const f = makeFlow(g, 24, 16), rv = new Rev();
      setMovers(f, rv);
      { const r = new Rng(seed ^ 0xBE11), cls = new Uint8Array(cells * 4); g.getClasses(cls);
        const l0 = [], b1 = [];
        for (let c = 0; c < cells; c++) for (let side = 0; side < 2; side++) {
          const truth = 0x80 | cls[c * 4 + side], x = r.below(4);
          if (x === 0) l0.push([c, side, truth]); else if (x === 1) l0.push([c, side, 0x80 | r.below(8)]);
          b1.push([c, side, truth]);
        }
        const a0 = f.setBelief(0, edge2(l0), l0.length), a1 = f.setBelief(1, edge2(b1), b1.length);
        fl.push(`m4bel ${pi} ${a0} ${a1} ${beliefDigest(f, 0)} ${beliefDigest(f, 1)} ${beliefDigest(f, 2)}`); }
      const r = new Rng(seed ^ 0xF40F);
      const g1 = goalsOf([[pick(r, gg, cells), 0]]);
      const g2l = []; for (let k = 0; k < 2; k++) { const c = pick(r, gg, cells), co = r.below(20); g2l.push([c, co]); }
      const thl = []; for (let k = 0; k < 2; k++) thl.push([pick(r, gg, cells), 0]);
      const g2 = goalsOf(g2l), th = goalsOf(thl), cases = [];
      for (let m = 1; m <= 8; m++) cases.push([g1, tw(m, 0)]);
      cases.push([g1, tw(M4_BRUTE, 1)], [g1, tw(M4_BRUTE, 2)], [g1, tw(M4_BRUTE, 3)], [g1, tw(M4_CRAWLER, 1)]);
      const p12 = tw(M4_HUMAN, 1); p12[1] = 1; p12[3] = 300; cases.push([g2, p12]);
      cases.push([th, fl4(0, M4_CRAWLER, 0, 1)], [th, fl4(3, M4_HUMAN, M4_BRUTE, 0)], [th, fl4(3, M4_HUMAN, M4_BRUTE, 1)]);
      const p16 = fl4(3 | 8 << 8, 0, M4_GHOST, 1); p16[2] = 20; p16[6] = 8; cases.push([th, p16]);
      cases.push([th, fl4(7 | 8 << 8, M4_CRAWLER, 0, 0)], [g1, tw(0, 5)], [g1, FP()], [g1, tw(17, 0)]);
      const p21 = fl4(7 | 12 << 8, M4_HUMAN, 0x14, 0); p21[2] = 50; p21[6] = 8; cases.push([th, p21]);
      const p22 = tw(M4_BRUTE, 0); p22[9] = 6; cases.push([g1, p22]);
      const slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`m4sched ${pi} 0 64 ${steps} ${sd}`);
      m4FlowLines('m4flow', pi, 0, f, slots, fl);
      for (let t = 1; t <= 5; t++) {
        let line;
        if (t === 1) { const rr = new Rng(seed ^ 0xC4C1), v = []; for (let k = 0; k < 8; k++) { const cell = rr.below(cells), side = rr.below(4), value = rr.below(8); v.push([cell, side, value]); } const k = g.setClasses(edge2(v), 8); line = `m4chg ${pi} 1 ${k} ${classesDigest(g)}`; }
        else if (t === 2) { const rr = new Rng(seed ^ 0xBEC4), v = []; for (let k = 0; k < 8; k++) { const cell = rr.below(cells), side = rr.below(4); const value = rr.below(3) === 0 ? 0 : (0x80 | rr.below(8)); v.push([cell, side, value]); } const k = f.setBelief(0, edge2(v), 8); line = `m4chg ${pi} 2 ${k} ${beliefDigest(f, 0)}`; }
        else if (t === 3) { const k = rv.set(f, M4_BRUTE, M4_MOVERS[M4_TANK - 1]); line = `m4chg ${pi} 3 ${k} ${rv.r[M4_BRUTE]}`; }
        else if (t === 4) { const k = f.clearBelief(0); line = `m4chg ${pi} 4 ${k} ${beliefDigest(f, 0)}`; }
        else { const b = ffChangeBatch(seed, g); const e1 = g.setEdges(b.e, b.ne), e2 = g.setLinks(b.li, b.lf, b.nl), e3 = g.setCosts(b.cc, b.nc); line = `m4chg ${pi} 5 ${e1} ${e2} ${e3} ${comps(g)}`; }
        fl.push(line);
        m4StaleLines('m4stale', pi, t, f, slots, fl);
        [steps, sd] = sched(f);
        fl.push(`m4sched ${pi} ${t} 64 ${steps} ${sd}`);
        m4FlowLines('m4flow', pi, t, f, slots, fl);
      }
      f.destroy(); g.destroy();
    }
    { // the scene
      const gg = m4Scene(), g = makeGrid(gg);
      const sc = m4SceneClasses(), a = g.setClasses(sc, sc.length / 2);
      g.info(gi8);
      fl.push(`m4scene ${gi8[3] >>> 0} ${gi8[4] >>> 0} ${gi8[5] >>> 0} ${edgesDigest(g)} ${a} ${classesDigest(g)}`);
      const goal = goalsOf([[m4c(8, 1), 0]]), th = goalsOf([[m4c(4, 0), 0]]);
      const cases = [[goal, tw(M4_CRAWLER, 1)], [goal, tw(M4_CRAWLER, 0)], [goal, tw(M4_BRUTE, 0)], [goal, tw(M4_HUMAN, 0)], [goal, tw(M4_GHOST, 0)], [goal, tw(M4_NONE, 0)], [goal, FP()],
        [th, fl4(3, M4_HUMAN, M4_GHOST, 0)], [th, fl4(7 | 8 << 8, M4_HUMAN, 0, 0)], [goal, tw(M4_BRUTE, 2)]];
      const f = makeFlow(g, 12, 4), rv = new Rev();
      setMovers(f, rv);
      const slots = acquireAll(f, cases);
      let [steps, sd] = sched(f);
      fl.push(`m4ssched 0 64 ${steps} ${sd}`);
      m4FlowLines('m4sflow', 0, 0, f, slots, fl);
      sampleLines('m4ssample', f, slots, M4_PROBES, fl, 0);
      const door = v => edge2([[m4c(4, 1), SIDE_E, v]]);
      for (let t = 1; t <= 5; t++) {
        let r;
        if (t === 1) r = f.setBelief(0, door(0x84), 1);
        else if (t === 2) r = g.setClasses(door(0), 1);
        else if (t === 3) r = f.setBelief(1, door(0x80), 1);
        else if (t === 4) r = rv.set(f, M4_CRAWLER, M4_MOVERS[M4_GHOST - 1]);
        else { const k = g.setClasses(door(4), 1), k0 = f.clearBelief(0), k1 = f.clearBelief(1), m = rv.set(f, M4_CRAWLER, M4_MOVERS[M4_CRAWLER - 1]); r = k * 1000 + k0 * 100 + k1 * 10 + m; }
        fl.push(`m4schg ${t} ${r} ${classesDigest(g)}`);
        m4StaleLines('m4sstale', 0, t, f, slots, fl);
        [steps, sd] = sched(f);
        fl.push(`m4ssched ${t} 64 ${steps} ${sd}`);
        m4FlowLines('m4sflow', 0, t, f, slots, fl);
        sampleLines('m4ssample', f, slots, M4_PROBES, fl, t);
      }
      f.destroy(); g.destroy();
    }
  }

  function m4TieLines(fl) {
    const gg = tieGrid(), g = makeGrid(gg), g0 = goalsOf([[0, 0]]);
    const cases = [M4_BRUTE, M4_GHOST, M4_NONE, 9, 10].map(id => [g0, FP({ mover: id })]);
    cases.push([g0, FP({ kind: FLEE, mover: M4_BRUTE })]);
    const last = FP({ mover: M4_BRUTE }); last[2] = 20; cases.push([g0, last]);
    const f = makeFlow(g, 8, 2), rv = new Rev();
    setMovers(f, rv);
    M4_TIE_MOVERS.forEach((m, i) => rv.set(f, 9 + i, m));
    const slots = acquireAll(f, cases);
    const [steps, sd] = sched(f);
    fl.push(`m4tiesched 0 64 ${steps} ${sd}`);
    sampleLines('m4tie', f, slots, [0, 1, 2, 3], fl);
    f.destroy(); g.destroy();
  }
  // returns { grid: [...], flow: [...] } — every line of grid.txt / flow.txt, in golden order
  return function presetLines() {
    const gl = [], fl = [];
    for (let pi = 0; pi < 6; pi++) {
      const seed = 100 + pi, p = PRESETS[pi], gg = gen(seed, p), val = new Int32Array(8);
      const rg = core.createGrid(gg.desc, gg.edges, gg.cl, gg.cost, gg.links, gg.nlinks, val);
      if (rg.code !== 0) throw new Error('grid create ' + rg.code);
      const g = rg.grid, ex = new Uint8Array(g.cells * 4), gi = new Int32Array(8);
      g.getEdges(ex); g.info(gi);
      gl.push(`grid ${pi} ${seed} ${p.w} ${p.h} ${p.layers} ${gi[3] >>> 0} ${gi[4] >>> 0} ${gi[5] >>> 0} ${digestArr(0, ex, ex.length)}`);
      visBlock('vis', pi, g, seed, gl);
      const r = new Rng(seed ^ 0x1157), buf = new Int32Array(g.cells);
      for (let t = 0; t < 5; t++) {
        const a = r.below(g.cells);
        g.visList(a, 256 * 8, 0, buf, g.cells);
        const n = g.count;
        gl.push(`list ${pi} ${a} 2048 ${n} ${digestArr(0, buf, n)}`);
      }
      const rf = core.createFlow(g, Int32Array.from([4, 16, 0, 0]));
      if (rf.code !== 0) throw new Error('flow create ' + rf.code);
      const f = rf.flow, rr = new Rng(seed ^ 0xF10F), cells = g.cells;
      const P = () => new Int32Array(12);
      const cases = [];
      cases.push([Int32Array.from([rr.below(cells), 0]), P()]);
      { const gs = []; for (let k = 0; k < 3; k++) { const c = rr.below(cells), co = rr.below(30); gs.push(c, co); } const pr = P(); pr[1] = 1; pr[2] = 25; cases.push([Int32Array.from(gs), pr]); }
      { const gs = []; for (let k = 0; k < 2; k++) gs.push(rr.below(cells), 0); const pr = P(); pr[0] = 1; cases.push([Int32Array.from(gs), pr]); }
      { const pr = P(); pr[3] = 200; cases.push([Int32Array.from([rr.below(cells), 0]), pr]); }
      const slots = cases.map(([gs, pr]) => { if (f.acquire(gs, gs.length / 2, pr) !== 0) throw new Error('acquire'); return f.slot; });
      let [steps, sd] = sched(f);
      fl.push(`sched ${pi} 64 ${steps} ${sd}`);
      flowLines('flow', pi, f, slots, fl);
      const rc = new Rng(seed ^ 0xC4A6), e = new Int32Array(80);
      for (let k = 0; k < 40; k++) {
        const cell = rc.below(cells), side = rc.below(4), value = rc.below(3) === 0 ? 0 : (rc.below(128) | 1);
        e[k * 2] = cell; e[k * 2 + 1] = side | (value << 8);
      }
      const li = new Int32Array(3), lf = new Uint8Array(3);
      let nl = 0;
      if ((gi[4] >>> 0) > 0) for (let k = 0; k < 3; k++) { li[k] = rc.below(gi[4] >>> 0); lf[k] = rc.below(4); nl++; }
      const cc = new Int32Array(10);
      for (let k = 0; k < 5; k++) { const cell = rc.below(cells); const co = rc.below(4) === 0 ? 255 : rc.below(60); cc[k * 2] = cell; cc[k * 2 + 1] = co; }
      const a1 = g.setEdges(e, 40), a2 = g.setLinks(li, lf, nl), a3 = g.setCosts(cc, 5);
      g.getEdges(ex); g.info(gi);
      gl.push(`chg ${pi} ${a1} ${a2} ${a3} ${gi[5] >>> 0} ${digestArr(0, ex, ex.length)}`);
      visBlock('vischg', pi, g, seed, gl);
      for (let k = 0; k < 4; k++) { f.info(slots[k], fi); fl.push(`stale ${pi} ${k} ${fi[0] >>> 0} ${fi[2] >>> 0}`); }
      [steps, sd] = sched(f);
      fl.push(`sched2 ${pi} 64 ${steps} ${sd}`);
      flowLines('flowchg', pi, f, slots, fl);
      if (f.destroy() !== 0) throw new Error('flow destroy');
      if (g.destroy() !== 0) throw new Error('grid destroy');
    }
    abi3Lines(gl, fl);
    ffLines(fl);
    m4Lines(gl, fl);
    m4TieLines(fl);
    return { grid: gl, flow: fl };
  };
};

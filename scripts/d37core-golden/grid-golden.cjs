// scripts/d37core-golden/grid-golden.cjs — M1 / M2 (grid visibility, flow fields) golden lines through the site API
// js/engine/core-world.js (wasm backend). A JS port, line by line, of the core's test-grid generator (E:\d37-core src/testgrid.rs
// gen + preset, mirrored in C# by D37TestGrids.cs) and of the first golden section (src/golden.rs grid_flow_lines, presets 0..5:
// grid / visq / vis / list / chg / vischg lines of grid.txt, sched / flow / stale / sched2 / flowchg lines of flow.txt). Every rng
// call order is part of the golden contract. The later sections (a3*, ff*, m4*) are not ported here (C-002 gap, see the report).
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
  // returns { grid: [...], flow: [...] } — the preset section lines, in golden order
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
    return { grid: gl, flow: fl };
  };
};

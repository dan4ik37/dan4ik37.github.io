// Support v1 golden pin (T-124, STRUCTURE_HAZARDS.md SH0.1): one seeded scenario over the v1 API of D37E.support — a 36,000-step
// random build (place if it holds / break / collapse / drop and land) in a 3D "real" world with natural rock, a shorter "soft"
// world, a 2D world (y down), a cave hall dug cell by cell (natural cells beyond rn: estimate and col() paths) and boxes cases
// (house, random stacks). Everything is hashed: estimates, sup[] before and after every collapse, group lists, landing offsets
// and steps. The steps are driven by the engine loop E.loop with a fake requestAnimationFrame at the given fps (30 / 60 / 144),
// so the hash proves the result does not depend on the frame rate. Plain script (node vm and Chrome page): D37SupportV1Hash(S, E, { fps }).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  root.D37SupportV1Hash = (S, E, opt = {}) => {
    const fps = opt.fps || 60, STEPS = opt.steps || 36000;
    // ── 32-bit x2 mixing hash (Math.imul only: identical in every JS engine) ──
    let h1 = 0x811c9dc5 | 0, h2 = 0x1b873593 | 0, nIn = 0;
    const mix = v => { v = v | 0; h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul((h2 ^ (v >>> 16)) + (v & 0xffff), 0x85ebca6b) ^ (h2 >>> 13); nIn++; };
    const hex = () => ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
    const WOOD = S.MAT.wood, STONE = S.MAT.stone, ROCK = S.MAT.rock, METAL = S.MAT.metal, GLASS = S.MAT.glass, BRICK = S.MAT.brick;
    const stats = { actions: 0, placed: 0, refused: 0, broken: 0, collapses: 0, fallen: 0, landed: 0, nodesMax: 0, solves: 0, boxes: 0 };

    // ── voxel world: 0 empty, else material + 1; nat — natural cell ──
    function world(N, H){
      const c = new Uint8Array(N * H * N), nat = new Uint8Array(N * H * N);
      const I = (x, y, z) => (x * H + y) * N + z, inside = (x, y, z) => x >= 0 && z >= 0 && x < N && z < N && y >= 0 && y < H;
      const W = { N, H, get: (x, y, z) => inside(x, y, z) ? c[I(x, y, z)] : 0, set(x, y, z, m, n){ if (inside(x, y, z)) { c[I(x, y, z)] = m; nat[I(x, y, z)] = n ? 1 : 0; } }, isNat: (x, y, z) => inside(x, y, z) && nat[I(x, y, z)] === 1 };
      W.read = mode => (x, y, z) => {
        if (y < 0) return 1;
        if (!inside(x, y, z)) return 0;
        const m = c[I(x, y, z)]; if (!m) return 0;
        if (nat[I(x, y, z)]) return mode === 'soft' ? 1 : (ROCK << 2) | 3;
        return ((m - 1) << 2) | 2;
      };
      return W;
    }
    const G3 = S.grid({ dims: 3, down: -1, max: 24576 });
    const G2 = S.grid({ dims: 2, down: 1, max: 4096 });
    const hashSolve = (G, withSup0) => {
      const g = G.g; mix(g.n); if (g.n > stats.nodesMax) stats.nodesMax = g.n;
      for (let i = 0; i < g.n; i++) { mix(g.sup[i]); if (withSup0) mix(g.sup0[i]); mix(g.gnd[i]); }
    };
    const hashGroups = (G, ng) => { mix(ng); for (let k = 0; k < ng; k++) { const a = G.groups(k); mix(a.length); for (let i = 0; i < a.length; i++) mix(a[i]); } };

    // ── engine loop with fake frames at fps: exactly `total` fixed steps ──
    function drive(total, step){
      let t = 0, steps = 0;
      const raf0 = root.requestAnimationFrame, caf0 = root.cancelAnimationFrame, perf = root.performance, now0 = perf.now, q = [];
      root.requestAnimationFrame = f => { q.push(f); return q.length; };
      root.cancelAnimationFrame = () => {};
      perf.now = () => t;
      let L = null;
      try {
        L = E.loop(dt => { if (steps < total) step(steps++, dt); }, () => {});
        for (let f = 0; steps < total && f < total * 8; f++) { t += 1000 / fps; const cb = q.shift(); if (cb) cb(t); }
      } finally {
        L?.stop();
        root.requestAnimationFrame = raf0; root.cancelAnimationFrame = caf0; perf.now = now0;
      }
      return steps;
    }

    // ── 1. random build (3D): place if it holds, break, collapse, drop and land ──
    function build3(mode, total, seed){
      const W = world(64, 48), rnd = S.rng(seed), P = S.prof(mode), rd = W.read(mode), BO = { r: 96, rn: 10, P };
      for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 0; y < 4; y++) W.set(x, y, z, STONE + 1, true);
      const solid = (x, y, z) => y < 0 || x < 0 || z < 0 || x >= 64 || z >= 64 || !!W.get(x, y, z);
      const falls = [];
      const MATS = [WOOD, STONE, METAL, BRICK, GLASS];
      const done = drive(total, st => {
        if (st % 6 === 0) {
          stats.actions++;
          let x = 20 + Math.floor(rnd() * 24), z = 20 + Math.floor(rnd() * 24);
          let y = 4; while (y < 46 && W.get(x, y, z)) y++;
          if (y > 5 && rnd() < .5) { const d = Math.floor(rnd() * 4); x += d === 0 ? 1 : d === 1 ? -1 : 0; z += d === 2 ? 1 : d === 3 ? -1 : 0; y = 5 + Math.floor(rnd() * (y - 4)); if (W.get(x, y, z)) y = 46; }
          if (rnd() < .7 && y < 46) {
            const m = MATS[Math.floor(rnd() * MATS.length)], code = (m << 2) | 2;
            G3.build([x, y, z, code], rd, BO);
            const s = G3.estimate(P); mix(s); mix(G3.g.gnd[0]); mix(G3.g.n);
            if (s >= P.min[m]) { W.set(x, y, z, m + 1); stats.placed++; } else stats.refused++;
          } else if (y > 4) {
            const yy = 4 + Math.floor(rnd() * (y - 4));
            if (W.get(x, yy, z) && !W.isNat(x, yy, z)) {
              const seeds = [x, yy, z, rd(x, yy, z)];
              // sometimes two cells at once (a wider cut)
              if (rnd() < .2 && W.get(x + 1, yy, z) && !W.isNat(x + 1, yy, z)) seeds.push(x + 1, yy, z, rd(x + 1, yy, z));
              for (let i = 0; i < seeds.length; i += 4) W.set(seeds[i], seeds[i + 1], seeds[i + 2], 0);
              G3.build(seeds, rd, BO);
              const ng = G3.collapse(P); stats.broken++; stats.solves++;
              hashSolve(G3, true); hashGroups(G3, ng);
              for (let k = 0; k < ng; k++) {
                const cells = G3.groups(k); stats.collapses++; stats.fallen += cells.length / 3;
                const mats = []; for (let i = 0; i < cells.length; i += 3) { mats.push(W.get(cells[i], cells[i + 1], cells[i + 2])); W.set(cells[i], cells[i + 1], cells[i + 2], 0); }
                falls.push({ F: S.drop(cells, { down: -1 }), cells, mats, t0: st });
              }
            }
          }
        }
        // every 20 s of game: support of every placed cell in a window (many seeds at once)
        if (st % 1200 === 600) {
          const seeds = [];
          for (let x = 24; x < 40; x += 2) for (let z = 24; z < 40; z += 2) for (let y = 4; y < 20; y++) if (W.get(x, y, z) && !W.isNat(x, y, z) && seeds.length < 4 * 400) seeds.push(x, y, z, rd(x, y, z));
          if (seeds.length) { G3.build(seeds, rd, BO); G3.solve(P, false); hashSolve(G3, false); stats.solves++; }
        }
        for (let i = falls.length - 1; i >= 0; i--) {
          const f = falls[i];
          if (!S.dropStep(f.F, 1 / 60, solid)) continue;
          mix(f.F.off); mix(st - f.t0); stats.landed++;
          for (let k = 0; k < f.cells.length; k += 3) { const x = f.cells[k], y = f.cells[k + 1] - f.F.off, z = f.cells[k + 2]; if (y >= 0 && !W.get(x, y, z)) W.set(x, y, z, f.mats[k / 3] || STONE + 1); }
          falls.splice(i, 1);
        }
      });
      mix(done); mix(falls.length);
      let have = 0; for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 4; y < 48; y++) { const v = W.get(x, y, z); if (v) { have++; mix(x * 4096 + y * 64 + z); mix(v); } }
      mix(have);
    }

    // ── 2. 2D world (y down, Podzem-like): ground below y 40 is natural rock ──
    function build2(total, seed){
      const N = 64, c = new Uint8Array(N * N), nat = new Uint8Array(N * N), at = (x, y) => x >= 0 && y >= 0 && x < N && y < N ? c[y * N + x] : 0;
      const P = S.prof('real'), rnd = S.rng(seed), BO = { r: 64, rn: 20, P };
      for (let x = 0; x < N; x++) for (let y = 40; y < N; y++) { c[y * N + x] = STONE + 1; nat[y * N + x] = 1; }
      const read = (x, y) => y >= N ? 1 : !at(x, y) ? 0 : nat[y * N + x] ? (ROCK << 2) | 3 : ((at(x, y) - 1) << 2) | 2;
      const done = drive(total, st => {
        if (st % 6) return;
        const x = 8 + Math.floor(rnd() * 48);
        let y = 39; while (y > 2 && at(x, y)) y--;
        if (rnd() < .68) {
          let px = x, py = y; if (rnd() < .5) { px = x + (rnd() < .5 ? 1 : -1); py = y + 1 + Math.floor(rnd() * Math.max(1, 39 - y)); if (at(px, py)) return; }
          const m = rnd() < .5 ? WOOD : STONE;
          G2.build([px, py, 0, (m << 2) | 2], read, BO); const s = G2.estimate(P); mix(s); mix(G2.g.n);
          if (s >= P.min[m]) c[py * N + px] = m + 1;
        } else {
          const yy = y + 1 + Math.floor(rnd() * Math.max(1, 40 - y - 1));
          if (!at(x, yy) || nat[yy * N + x]) return;
          const seeds = [x, yy, 0, read(x, yy)]; c[yy * N + x] = 0;
          G2.build(seeds, read, BO); const ng = G2.collapse(P); hashSolve(G2, true); hashGroups(G2, ng);
          for (let k = 0; k < ng; k++) { const a = G2.groups(k); for (let i = 0; i < a.length; i += 3) c[a[i + 1] * N + a[i]] = 0; }
        }
      });
      mix(done); for (let i = 0; i < c.length; i++) if (c[i]) mix(i * 16 + c[i]);
    }

    // ── 3. cave hall dug cell by cell (real): natural cells beyond rn — estimate / col() ──
    function hall(side, seed){
      const W = world(80, 40), P = S.prof('real'), rd = W.read('real'), BO = { r: 96, rn: 13, P }, rnd = S.rng(seed);
      for (let x = 0; x < 80; x++) for (let z = 0; z < 50; z++) for (let y = 0; y < 26; y++) W.set(x, y, z, STONE + 1, true);
      const list = [], x0 = 40 - (side >> 1), z0 = 25 - (side >> 1);
      for (let x = x0; x < x0 + side; x++) for (let z = z0; z < z0 + side; z++) for (let y = 5; y < 7; y++) list.push(x, y, z);
      for (let i = list.length / 3 - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); for (let k = 0; k < 3; k++) { const t = list[i * 3 + k]; list[i * 3 + k] = list[j * 3 + k]; list[j * 3 + k] = t; } }
      for (let i = 0; i < list.length; i += 3) {
        const x = list[i], y = list[i + 1], z = list[i + 2]; if (!W.get(x, y, z)) continue;
        const seeds = [x, y, z, rd(x, y, z)]; W.set(x, y, z, 0);
        G3.build(seeds, rd, BO); const ng = G3.collapse(P); hashSolve(G3, true); hashGroups(G3, ng);
        for (let k = 0; k < ng; k++) { const a = G3.groups(k); for (let j = 0; j < a.length; j += 3) W.set(a[j], a[j + 1], a[j + 2], 0); }
      }
    }

    // ── 4. boxes: the house case and random stacks ──
    function boxes(seed){
      const B = S.boxes({ max: 512 }), CON = S.MAT.concrete, SLAB = S.MAT.slab, real = S.prof('real'), soft = S.prof('soft');
      const hb = () => { mix(B.g.n); for (let i = 0; i < B.g.n; i++) mix(B.g.sup[i]); };
      // house: walls 2 m pieces, roof slabs 4 m
      B.reset();
      for (let i = 0; i < 6; i++) B.add(i * 2, 0, 0, i * 2 + 2, 3, .3, CON, true);
      for (let i = 0; i < 3; i++) B.add(i * 4, 3, 0, i * 4 + 4, 3.3, 4, SLAB, false);
      mix(B.link(.05)); B.solve(real); hb();
      for (const br of [[0, 1], [0, 1, 2, 3], [4, 5], [2, 3]]) { const ng = B.collapse(real, br); mix(ng); for (let k = 0; k < ng; k++) { const a = B.groups(k); mix(a.length); for (const v of a) mix(v); } }
      // random stacks: 10×10 columns of boxes with random heights, materials and beams between columns
      const rnd = S.rng(seed), MAT = [WOOD, STONE, BRICK, CON, METAL, GLASS, SLAB];
      for (let rep = 0; rep < 24; rep++) {
        B.reset();
        const n = 60 + Math.floor(rnd() * 140);
        for (let i = 0; i < n; i++) {
          const cx = Math.floor(rnd() * 10) * 1.5, cz = Math.floor(rnd() * 10) * 1.5, y0 = Math.floor(rnd() * 8) * 1.2, w = .5 + Math.floor(rnd() * 4) * .5, d = .5 + Math.floor(rnd() * 4) * .5;
          B.add(cx, y0, cz, cx + w, y0 + 1.2, cz + d, MAT[Math.floor(rnd() * MAT.length)], y0 === 0);
        }
        mix(B.link(.05)); stats.boxes += B.n;
        const P = rep & 1 ? soft : real;
        B.solve(P); hb();
        for (let k = 0; k < 4; k++) {
          const br = []; for (let j = 0; j < 1 + Math.floor(rnd() * 6); j++) br.push(Math.floor(rnd() * B.n));
          const ng = B.collapse(P, br); hb(); mix(ng);
          for (let q = 0; q < ng; q++) { const a = B.groups(q); mix(a.length); for (const v of a) mix(v); }
        }
      }
    }

    build3('real', STEPS, 12345);
    build3('soft', Math.min(STEPS, 6000), 777);
    build2(Math.min(STEPS, 6000), 4242);
    hall(19, 5);
    boxes(99);
    return { hash: hex(), mixed: nIn, fps, steps: STEPS, ...stats };
  };
})();

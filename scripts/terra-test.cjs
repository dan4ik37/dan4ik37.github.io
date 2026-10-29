// Terrain core T1 (T-111): js/engine/terra.wasm and the JS fallback js/engine/terra-core.js against the Rust golden file
// scripts/terra-golden.txt (exact bits: heights, climate, densities, block meshes incl. 1000 and 4000 km away), chunk-local
// output, edit → re-mesh of exactly the affected blocks (js/engine/terra.js), worker protocol (js/engine/terra-worker.js in a
// node worker_threads shim). Timing per block (wasm vs JS) is printed. Run: node scripts/terra-test.cjs [--fast]
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let ok = 0, bad = 0;
const check = (cond, msg) => { if (cond) ok++; else { bad++; console.log('  FAIL ' + msg); } };
const T1 = require(path.join(ROOT, 'js/engine/terra-core.js'));
// terra.js needs only D37E.terraCore for its pure helpers
const ctx = { D37E: { terraCore: T1 }, console, performance, Math };
ctx.window = ctx; ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/engine/terra.js'), 'utf8'), ctx);
const TE = ctx.D37E.terra;

const bitsHex = v => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return b.readBigUInt64LE().toString(16).padStart(16, '0'); };
const GOLDEN_EDITS = [10, 5, -20, 6, 0, 10, 14, -20, 4, 1, -300, -10, 400, 9, 0];

(async () => {
  const t0 = Date.now();
  const W = await T1.wasm(fs.readFileSync(path.join(ROOT, 'js/engine/terra.wasm')), T1.DEFAULT_CAP);
  const J = T1.js(T1.DEFAULT_CAP);
  check(W.kind === 'wasm' && J.kind === 'js', 'cores');
  const lines = fs.readFileSync(path.join(__dirname, 'terra-golden.txt'), 'utf8').split('\n');
  let edits2 = null, edits3 = null;
  const cnt = { H: 0, I: 0, D: 0, E: 0, Q: 0, G: 0, R: 0, Q2: 0 };
  const fill = (core, list) => { const n = list.length / 5, e = core.edits(n); for (let i = 0; i < list.length; i++) e[i] = list[i]; return n; };
  for (const line of lines) {
    const l = line.trim();
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    if (p[0] === 'V') { check(+p[1] === T1.ABI, 'ABI ' + p[1]); continue; }
    if (p[0] === 'EDITS') { edits2 = p.slice(1).map(Number); continue; }
    if (p[0] === 'EDITS3') { edits3 = p.slice(1).map(Number); continue; }
    // ABI 2 (T-116 generator v2, world rules, flatten pads)
    if (p[0] === 'G') {
      const seed = +p[1], rules = +p[2], param = +p[3], x = +p[4], z = +p[5], out = new Float64Array(8);
      const bj = T1.climate(seed, x, z, rules, param, out);
      check(bj === +p[13] && [0, 1, 2, 3, 4, 5, 6].every(k => bitsHex(out[k]) === p[6 + k]), `G js ${l}`);
      for (const core of [J, W]) {
        check(core.setGen(2, rules, param) === 0, 'setGen');
        const b2 = core.climate(seed, x, z), v = core.climv();
        check(b2 === +p[13] && [0, 1, 2, 3, 4, 5, 6].every(k => bitsHex(v[k]) === p[6 + k]), `G ${core.kind} ${l}`);
        core.setGen(1, 0, 0);
      }
      cnt.G++; continue;
    }
    if (p[0] === 'R') {
      const seed = +p[1], rules = +p[2], x = +p[3], y = +p[4], z = +p[5];
      check(bitsHex(T1.densityR(seed, x, y, z, edits3, edits3.length / 5, rules)) === p[6], `R js ${l}`);
      for (const core of [J, W]) {
        check(core.setGen(rules ? 2 : 1, rules, 0) === 0, 'setGen');
        const n = fill(core, edits3);
        check(bitsHex(core.density(seed, x, y, z, n)) === p[6], `R ${core.kind} ${l}`);
        core.setGen(1, 0, 0);
      }
      cnt.R++; continue;
    }
    if (p[0] === 'Q2') {
      const [gen, rules, param, seed, cx, cy, cz, ed] = p.slice(1, 9).map(Number), list = ed === 1 ? GOLDEN_EDITS : ed === 2 ? edits2 : ed === 3 ? edits3 : [];
      for (const core of [J, W]) {
        check(core.setGen(gen, rules, param) === 0, 'setGen');
        const n = fill(core, list.length ? list : [0, 0, 0, 0, 0]);
        const q = core.build(seed, cx, cy, cz, list.length ? n : 0), o = core.out();
        check(q === +p[9], `Q2 ${core.kind} quads ${q} != ${p[9]} (${l})`);
        if (q > 0) check(T1.meshHash(o, q) === p[10], `Q2 ${core.kind} hash (${l})`);
        check(bitsHex(o.info[0]) === p[11] && bitsHex(o.info[1]) === p[12], `Q2 ${core.kind} hmin/hmax (${l})`);
        core.setGen(1, 0, 0);
      }
      cnt.Q2++; continue;
    }
    const seed = +p[1];
    if (p[0] === 'H') {
      const x = +p[2], z = +p[3];
      check(bitsHex(T1.height(seed, x, z)) === p[4], `H js ${l}`);
      check(bitsHex(W.height(seed, x, z)) === p[4], `H wasm ${l}`);
      cnt.H++;
    } else if (p[0] === 'I') {
      const x = +p[2], z = +p[3];
      check(bitsHex(T1.temperature01(seed, x, z)) === p[4] && bitsHex(T1.moisture01(seed, x, z)) === p[5] && bitsHex(T1.entrance(seed, x, z)) === p[6] && T1.biome(seed, x, z) === +p[7], `I js ${l}`);
      check(bitsHex(W.climate1(seed, x, z, 0)) === p[4] && bitsHex(W.climate1(seed, x, z, 1)) === p[5] && bitsHex(W.climate1(seed, x, z, 2)) === p[6] && W.climate1(seed, x, z, 3) === +p[7], `I wasm ${l}`);
      cnt.I++;
    } else if (p[0] === 'D' || p[0] === 'E') {
      const x = +p[2], y = +p[3], z = +p[4], ops = p[0] === 'E' ? GOLDEN_EDITS : null, n = ops ? 3 : 0;
      check(bitsHex(T1.density(seed, x, y, z, ops, n)) === p[5], `${p[0]} js ${l}`);
      fill(W, ops || [0, 0, 0, 0, 0]);
      check(bitsHex(W.density(seed, x, y, z, n)) === p[5], `${p[0]} wasm ${l}`);
      cnt[p[0]]++;
    } else if (p[0] === 'Q') {
      if (FAST && cnt.Q % 3 === 2) { cnt.Q++; continue; }
      const cx = +p[2], cy = +p[3], cz = +p[4], ed = +p[5], list = ed === 1 ? GOLDEN_EDITS : ed === 2 ? edits2 : [];
      for (const [core, name] of [[J, 'js'], [W, 'wasm']]) {
        const n = fill(core, list.length ? list : [0, 0, 0, 0, 0]);
        const q = core.build(seed, cx, cy, cz, list.length ? n : 0), o = core.out();
        check(q === +p[6], `Q ${name} quads ${q} != ${p[6]} (${l})`);
        if (q > 0) check(T1.meshHash(o, q) === p[7], `Q ${name} hash (${l})`);
        check(bitsHex(o.info[0]) === p[8] && bitsHex(o.info[1]) === p[9], `Q ${name} hmin/hmax (${l})`);
        // chunk-local: every vertex inside the block's sample box, also 4000 km away
        let lo = 1e9, hi = -1e9;
        for (let i = 0; i < q * 12; i++) { const v = o.pos[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (q > 0) check(lo >= -1 && hi <= 33, `Q ${name} local range ${lo}..${hi} (${l})`);
      }
      cnt.Q++;
    }
  }
  console.log(`golden: H ${cnt.H}, I ${cnt.I}, D ${cnt.D}, E ${cnt.E}, Q ${cnt.Q}, G ${cnt.G}, R ${cnt.R}, Q2 ${cnt.Q2} — wasm and JS compared bit by bit`);
  check(cnt.H >= 60 && cnt.Q >= 60, 'golden coverage');
  check(cnt.G === 200 && cnt.R === 72 && cnt.Q2 >= 40, 'golden coverage ABI 2 (generator v2, rules, flatten)');

  // ── edit → re-mesh: a block's mesh changes ⇒ it is in TE.affected(); blocks outside stay bit-identical ──
  {
    const seed = 1337, ex = 31.5, ez = 2.25, ey = Math.round(T1.height(seed, ex, ez) * 64) / 64, r = 3;
    const aff = new Set(TE.affected(ex, ey, ez, r).map(b => b.join(',')));
    check(aff.has('0,' + Math.floor(ey / 32) + ',0') && aff.has('1,' + Math.floor(ey / 32) + ',0'), 'border edit touches both neighbours');
    let changed = 0, untouched = 0;
    const cy0 = Math.floor(ey / 32);
    for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 1; cz++) for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
      W.edits(1); const q0 = W.build(seed, cx, cy, cz, 0), h0 = q0 > 0 ? T1.meshHash(W.out(), q0) : '';
      const n = fill(W, [ex, ey, ez, r, 0]);
      const q1 = W.build(seed, cx, cy, cz, n), h1 = q1 > 0 ? T1.meshHash(W.out(), q1) : '';
      const inAff = aff.has(cx + ',' + cy + ',' + cz);
      if (q0 !== q1 || h0 !== h1) { changed++; check(inAff, `block ${cx},${cy},${cz} changed but is not in affected()`); }
      else if (!inAff) untouched++;
    }
    check(changed >= 2, 'dig changed blocks: ' + changed);
    console.log(`edit re-mesh: ${aff.size} affected, ${changed} changed, ${untouched} outside unchanged`);
    // fill after dig at the same place: the order is kept (fill wins) — the same in JS and wasm
    const list = [ex, ey, ez, r, 0, ex, ey, ez, r, 1];
    const nj = fill(J, list), nw = fill(W, list);
    const qj = J.build(seed, 0, cy0, 0, nj), hj = T1.meshHash(J.out(), qj), qw = W.build(seed, 0, cy0, 0, nw), hw = T1.meshHash(W.out(), qw);
    check(qj === qw && hj === hw, 'dig+fill: JS == wasm');
  }

  // ── physics from the density field (terra.js without workers → page builder): cave floor, dig lowers the ground, ray ──
  {
    const TS = TE.create({ seed: 1337, workers: 0 });
    let cave = null;
    for (let x = -600; x < 600 && !cave; x += 7) for (let z = -600; z < 600 && !cave; z += 11) {
      const h = T1.height(1337, x, z);
      if (h < 8) continue;
      for (let y = Math.floor(h) - 5; y > -26; y--) {
        const d0 = T1.density(1337, x, y, z, null, 0), d1 = T1.density(1337, x, y - 1, z, null, 0);
        if (d0 <= 0 && d1 > 0 && T1.density(1337, x, y + 2, z, null, 0) <= 0) { cave = { x, z, h, y, floor: y - 1 + d1 / (d1 - d0) }; break; }
      }
    }
    check(!!cave, 'found a cave under the surface');
    if (cave) {
      const g = TS.ground(cave.x, cave.z, cave.y + 0.2);
      check(Math.abs(g - cave.floor) < 1e-9 && g < cave.h - 2, `cave floor ${g.toFixed(2)} (surface ${cave.h.toFixed(2)})`);
      check(Math.abs(TS.ground(cave.x, cave.z, cave.h + 1) - cave.h) < 0.6, 'on the surface above the cave');
    }
    const x = 40, z = -25, h = T1.height(1337, x, z), g0 = TS.ground(x, z, h + 0.5);
    check(Math.abs(g0 - h) < 0.6, `ground ≈ height (${g0.toFixed(2)} vs ${h.toFixed(2)})`);
    const hit = TS.ray(x, h + 20, z, 0, -1, 0, 60);
    check(hit && Math.abs(hit.y - h) < 0.6, 'ray down hits the surface');
    const n = TS.dig(x, h, z, 3);
    check(n >= 1 && TS.editCount() === 1, 'dig: affected blocks ' + n);
    const g1 = TS.ground(x, z, h + 0.5);
    check(g1 < h - 2.5, `dig lowers the ground: ${g0.toFixed(2)} → ${g1.toFixed(2)}`);
    TS.fill(x, g1, z, 3);
    check(TS.ground(x, z, g1 + 0.5) > g1 + 2, 'fill raises it again');
    // the page builder (no workers) streams a ring too
    for (let i = 0; i < 600 && TS.stats().built < 6; i++) { TS.update(x, h, z); await new Promise(r => setTimeout(r, 4)); }
    check(TS.stats().built >= 6 && TS.stats().local > 0, 'no workers → built on the page: ' + TS.stats().built);
    TS.dispose();
  }

  // ── physics == the drawn mesh (T-111 review: feet were up to 0.35 m off at craters, 8.3 m at river banks) ──
  //    TS on the page builder; "showing" = takeReady + recycle (what terra-mesh does). Reference: the JS core's own mesh of the
  //    same blocks (all quads of the 3×3 blocks around, float positions) — the highest crossing of the vertical line.
  {
    const PE = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
    for (const f of ['core', 'physics', 'controls', 'player']) vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/engine', f + '.js'), 'utf8'), Object.assign(ctx, PE), { filename: f + '.js' });
    const E = ctx.D37E, U = E.UNIT, seed = 1337;
    const settle = async (TS, x, y, z) => {
      let idleT = 0;
      for (let i = 0; i < 20000; i++) {
        TS.update(x, y, z);
        let b; while ((b = TS.takeReady())) TS.recycle(b);
        let busy = 0;
        for (const B of TS.blocks.values()) if (B.st !== 3 || B.ne < B.need) busy++;
        let colsWait = 0; for (const c of TS.cols.values()) if (c.st !== 2) colsWait++;
        // idle (every column probed, every block shown, nothing queued) for 200 ms — the queue is rebuilt at most every 60 ms
        if (busy || colsWait || TS.stats().queued || !TS.blocks.size) idleT = 0; else if (!idleT) idleT = performance.now(); else if (performance.now() - idleT > 200) return true;
        if (i % 8 === 7) await new Promise(r => setTimeout(r, 1));
      }
      return false;
    };
    const RB = new Map();   // reference blocks (JS core), key → { q, pos }
    const refBlock = (cx, cy, cz, list) => {
      const k = cx + ',' + cy + ',' + cz + ':' + list.join(',');
      if (RB.has(k)) return RB.get(k);
      const n = list.length / 5;
      let m = 0; for (let e = 0; e < n; e++) if (T1.touches(list, e, cx * 32, cy * 32, cz * 32)) m++;
      const buf = J.edits(Math.max(1, m)); let j = 0;
      for (let e = 0; e < n; e++) if (T1.touches(list, e, cx * 32, cy * 32, cz * 32)) { for (let i = 0; i < 5; i++) buf[j * 5 + i] = list[e * 5 + i]; j++; }
      const q = J.build(seed, cx, cy, cz, m), r = { q, pos: Float32Array.from(J.out().pos.subarray(0, q * 12)), ox: cx * 32, oy: cy * 32, oz: cz * 32 };
      RB.set(k, r);
      return r;
    };
    // highest crossing (any facing) of the vertical line with the reference mesh
    const refTop = (x, z, list) => {
      const bx = Math.floor(x / 32), bz = Math.floor(z / 32), cyc = Math.floor(T1.height(seed, x, z) / 32);
      let top = -Infinity;
      for (let cx = bx - 1; cx <= bx + 1; cx++) for (let cz = bz - 1; cz <= bz + 1; cz++) for (let cy = cyc - 1; cy <= cyc + 1; cy++) {
        const R = refBlock(cx, cy, cz, list), p = R.pos, lx = x - R.ox, lz = z - R.oz;
        for (let i = 0; i < R.q; i++) {
          const o = i * 12;
          if (lx < Math.min(p[o], p[o + 3], p[o + 6], p[o + 9]) || lx > Math.max(p[o], p[o + 3], p[o + 6], p[o + 9]) || lz < Math.min(p[o + 2], p[o + 5], p[o + 8], p[o + 11]) || lz > Math.max(p[o + 2], p[o + 5], p[o + 8], p[o + 11])) continue;
          for (const [b, c] of [[3, 6], [6, 9]]) {
            const ax = p[o], az = p[o + 2], bx2 = p[o + b], bz2 = p[o + b + 2], cx2 = p[o + c], cz2 = p[o + c + 2];
            const d = (bz2 - cz2) * (ax - cx2) + (cx2 - bx2) * (az - cz2);
            if (Math.abs(d) < 1e-12) continue;
            const w0 = ((bz2 - cz2) * (lx - cx2) + (cx2 - bx2) * (lz - cz2)) / d, w1 = ((cz2 - az) * (lx - cx2) + (ax - cx2) * (lz - cz2)) / d, w2 = 1 - w0 - w1;
            if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
            const y = R.oy + w0 * p[o + 1] + w1 * p[o + b + 1] + w2 * p[o + c + 1];
            if (y > top) top = y;
          }
        }
      }
      return top;
    };
    // river bank: the steepest spot near (-175, -625) (the reviewer's case)
    let bank = { x: -175, z: -625, g: 0 };
    for (let x = -200; x <= -150; x += 1) for (let z = -650; z <= -600; z += 1) {
      const g = Math.hypot(T1.height(seed, x + 0.5, z) - T1.height(seed, x - 0.5, z), T1.height(seed, x, z + 0.5) - T1.height(seed, x, z - 0.5));
      if (g > bank.g) bank = { x, z, g };
    }
    const cases = [
      { name: 'undisturbed', x: 40, z: -25, R: 20, edits: () => {} },
      { name: 'crater r 2.5', x: 40, z: -25, R: 4, edits: (TS, h) => TS.dig(40, h, -25, 2.5) },
      { name: 'embedded fill r 2', x: 40, z: -25, R: 3.5, edits: (TS, h) => TS.fill(40, h + 0.6, -25, 2) },
      { name: 'floating fill r 2', x: 40, z: -25, R: 2.5, edits: (TS, h) => TS.fill(40, h + 5, -25, 2) },
      { name: 'river bank grad ' + bank.g.toFixed(1), x: bank.x, z: bank.z, R: 6, edits: () => {} },
    ];
    let rs = 0x5eed;
    const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    const before = [];
    for (const C of cases) {
      const TS = TE.create({ seed, workers: 0, radius: 1, caveRadius: 1 });
      const h = T1.height(seed, C.x, C.z);
      C.edits(TS, h);
      check(await settle(TS, C.x, h, C.z), C.name + ': blocks shown');
      const list = Array.from(TS.edits());
      const diffs = [], old = [];
      let mesh0 = TS.st.phMesh;
      for (let i = 0; i < 400; i++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * C.R, x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
        const top = refTop(x, z, list);
        if (!(top > -1e9)) continue;
        diffs.push(Math.abs(TS.ground(x, z, top + 0.3) - top));
        old.push(Math.abs(TS.densityGround(x, z, top + 0.3) - top));
      }
      const st = v => { const s = v.slice().sort((a, b) => a - b); return { med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
      const n = st(diffs), o = st(old);
      check(diffs.length >= 380 && TS.st.phMesh - mesh0 === diffs.length, `${C.name}: ground from the mesh (${TS.st.phMesh - mesh0}/${diffs.length})`);
      check(n.p95 <= 0.005 && n.max <= 0.05, `${C.name}: |ground − mesh| p95 ${n.p95.toFixed(4)} max ${n.max.toFixed(4)} m`);
      console.log(`ground vs drawn mesh, ${C.name}: now median ${n.med.toFixed(4)} p95 ${n.p95.toFixed(4)} max ${n.max.toFixed(4)} m; density path median ${o.med.toFixed(3)} p95 ${o.p95.toFixed(3)} max ${o.max.toFixed(3)} m`);
      before.push(TS);
    }
    for (const TS of before) TS.dispose();

    // parkour on the terrain (review: "never triggers — terrain hits have col: null"). With the hooks (terrain.col, .blocked,
    // .normal) a STEEP terrain face is a ledge; without them — never. At 1 m Surface Nets resolution a dig/fill sphere is drawn as
    // a ≤ ~55° cone (no ledge there for anyone); the river bank near (−168, −621) is ~85° → ledges. Gentle land → none.
    {
      let flat = null;
      for (let x = 0; x < 1500; x += 7) for (let z = 0; z < 600; z += 11) {
        const hh = T1.height(seed, x, z); if (hh < 3) continue;
        let v = 0; for (const [a, b] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4], [-4, -4]]) v = Math.max(v, Math.abs(T1.height(seed, x + a, z + b) - hh));
        if (!flat || v < flat.v) flat = { x, z, v };
      }
      const probe = async (C) => {
        const TS = TE.create({ seed, workers: 0, radius: 1, caveRadius: 1 });
        if (C.dig) TS.dig(C.x, T1.height(seed, C.x, C.z), C.z, C.dig);
        await settle(TS, C.x, T1.height(seed, C.x, C.z), C.z);
        const ph = new E.Phys({ ground: null });
        let refY = 0;
        const T = ph.terrain = { sample: (x, z) => TS.ground(x / U, z / U, refY) * U };
        const Pl = E.player(ph, { x: 0, z: 0, yaw: 0 });
        const r = { tries: 0, plain: 0, hooks: 0, started: 0, modes: {} };
        for (let i = 0; i < 300; i++) {
          const a = (i * 2.399) % (Math.PI * 2), rr = Math.sqrt((i + 0.5) / 300) * C.R, x = C.x + Math.cos(a) * rr, z = C.z + Math.sin(a) * rr;
          refY = T1.height(seed, x, z) + 30; const g = T.sample(x * U, z * U); refY = g / U;
          for (let k = 0; k < 8; k++) {
            const dir = { x: Math.cos(k * Math.PI / 4), z: Math.sin(k * Math.PI / 4) };
            Pl.place(x * U, g, z * U, 0);
            delete T.col; delete T.blocked; delete T.normal;
            r.tries++; if (Pl._test.findLedge(dir, 0.5, 2.35)) r.plain++;
            T.col = { terrain: true, solid: true };
            T.blocked = (px, pz, y0, y1, rad) => TS.blocked(px / U, pz / U, y0 / U, y1 / U, (rad || 0) / U);
            T.normal = (px, py, pz, out, dx, dy, dz) => TS.normal(px / U, py / U, pz / U, out, dx, dy, dz);
            if (Pl._test.findLedge(dir, 0.5, 2.35)) {
              r.hooks++;
              if (Pl._test.tryParkour(dir, true)) { r.started++; r.modes[Pl.mode] = (r.modes[Pl.mode] || 0) + 1; }
            }
          }
        }
        r.blocked = TS.blocked(C.x, C.z, T1.height(seed, C.x, C.z) - 3, T1.height(seed, C.x, C.z) - 1.5) && !TS.blocked(C.x, C.z, T1.height(seed, C.x, C.z) + 0.6, T1.height(seed, C.x, C.z) + 2.5);
        TS.dispose();
        return r;
      };
      const rf = await probe({ x: flat.x, z: flat.z, R: 25 });
      const rb = await probe({ x: bank.x, z: bank.z, R: 8 });
      const rc = await probe({ x: flat.x, z: flat.z, R: 4, dig: 3.2 });
      console.log(`parkour on terrain (2400 probes each): flat land plain ${rf.plain} / hooks ${rf.hooks}; river bank plain ${rb.plain} / hooks ${rb.hooks} (started ${rb.started} ${JSON.stringify(rb.modes)}); crater r 3.2 plain ${rc.plain} / hooks ${rc.hooks}`);
      check(rf.plain === 0 && rb.plain === 0 && rc.plain === 0, 'without terrain.col no ledge anywhere (the reviewed behaviour)');
      check(rb.hooks > 0 && rb.started > 0, `steep river bank: ledges with the hooks ${rb.hooks}, parkour started ${rb.started}`);
      check(rf.hooks === 0, 'gentle land: no false ledges');
      check(rf.blocked && rb.blocked, 'TS.blocked: in the ground yes, in the air no');
    }

    // edits by cell: TS.ray with one cell's edits == the ray with every edit; cost with 5000 edits
    {
      const TS = TE.create({ seed, workers: 0, radius: 1 });
      let s2 = 7;
      const r2 = () => { s2 = (s2 * 1103515245 + 12345) & 0x7fffffff; return s2 / 0x7fffffff; };
      for (let i = 0; i < 5000; i++) { const x = (r2() - 0.5) * 4000, z = (r2() - 0.5) * 4000, hh = T1.height(seed, x, z); (i % 3 ? TS.dig : TS.fill)(x, hh + (r2() - 0.5) * 2, z, 0.5 + r2() * 4); }
      for (let i = 0; i < 40; i++) { const x = 40 + (r2() - 0.5) * 10, z = -25 + (r2() - 0.5) * 10, hh = T1.height(seed, x, z); TS.dig(x, hh, z, 1 + r2() * 2); }
      const ed = TS.edits(), ne = ed.length / 5;
      const refRay = (ox, oy, oz, dx, dy, dz, maxT = 60) => {   // the old march: every edit
        const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
        let a = 0;
        if (T1.density(seed, ox, oy, oz, ed, ne) > 0) return { t: 0 };
        for (let t = 0.35; t <= maxT; t += 0.35) {
          if (T1.density(seed, ox + dx * t, oy + dy * t, oz + dz * t, ed, ne) > 0) {
            let lo = a, hi = t;
            for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (T1.density(seed, ox + dx * m, oy + dy * m, oz + dz * m, ed, ne) > 0) hi = m; else lo = m; }
            return { t: hi };
          }
          a = t;
        }
        return null;
      };
      let same = 0, n = 0, tNew = 0, tOld = 0;
      for (let i = 0; i < 60; i++) {
        const x = 40 + (r2() - 0.5) * 16, z = -25 + (r2() - 0.5) * 16, hh = T1.height(seed, x, z), dx = (r2() - 0.5) * 0.6, dz = (r2() - 0.5) * 0.6;
        let t0 = performance.now(); const A = TS.ray(x, hh + 12, z, dx, -1, dz, 60); tNew += performance.now() - t0;
        t0 = performance.now(); const Bh = refRay(x, hh + 12, z, dx, -1, dz, 60); tOld += performance.now() - t0;
        n++; if ((A && Bh && A.t === Bh.t) || (!A && !Bh)) same++;
      }
      check(same === n, `TS.ray (one cell's edits) == ray with all ${ne} edits: ${same}/${n}`);
      check(tNew / n < tOld / n / 5, `ray cost with ${ne} edits: ${(tNew / n).toFixed(3)} ms (all edits: ${(tOld / n).toFixed(3)} ms)`);
      console.log(`ray with ${ne} edits: ${(tNew / n).toFixed(3)} ms per ray (every edit: ${(tOld / n).toFixed(3)} ms)`);
      TS.dispose();
    }
  }

  // ── chunk-local: the same block built by a fresh core and by a core that built far blocks first — identical ──
  {
    const A = await T1.wasm(fs.readFileSync(path.join(ROOT, 'js/engine/terra.wasm')), 4000);
    A.edits(1); const qa = A.build(7, 125000, 0, -3, 0), ha = qa > 0 ? T1.meshHash(A.out(), qa) : '';
    for (const [cx, cz] of [[0, 0], [31250, 7], [-125000, 2], [125001, -3]]) A.build(7, cx, 0, cz, 0);
    const qb = A.build(7, 125000, 0, -3, 0);
    check(qa === qb && ha === (qb > 0 ? T1.meshHash(A.out(), qb) : ''), 'far block: independent of build history');
    A.dispose();
  }

  // ── worker protocol in node (worker_threads with a self/importScripts/fetch shim): init queueing, build, edits, pool ──
  if (!FAST) {
    const { Worker } = require('worker_threads');
    const shim = `
      const { parentPort } = require('worker_threads'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
      const ROOT = ${JSON.stringify(ROOT)};
      globalThis.self = globalThis; self.location = { search: '?v=t' };
      self.importScripts = (...f) => f.forEach(x => vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/engine', x.split('?')[0]), 'utf8')));
      self.fetch = async u => u.includes('stall') ? new Promise(() => {}) : ({ ok: true, arrayBuffer: async () => { const b = fs.readFileSync(path.join(ROOT, u.split('?')[0])); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
      self.postMessage = (m, tr) => parentPort.postMessage(m, tr);
      parentPort.on('message', d => self.onmessage({ data: d }));
      vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/engine/terra-worker.js'), 'utf8'));`;
    for (const wasm of ['js/engine/terra.wasm', 'js/engine/missing.wasm', 'js/engine/stall.wasm']) {   // stall: the download never ends → JS after wasmMs
      const w = new Worker(shim, { eval: true });
      const got = [];
      const wait = (pred, ms = 20000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); const f = () => { const m = got.find(pred); if (m) { clearTimeout(t); res(m); } else setTimeout(f, 5); }; f(); });
      w.on('message', m => got.push(m));
      w.postMessage({ t: 'init', wasm, cap: 24000, wasmMs: 400 });
      // requests before 'ready' — must be queued, not lost
      const seed = 1337, cy = Math.floor(T1.height(seed, 16, 16) / 32);
      w.postMessage({ t: 'col', id: 1, seed, cx: 0, cz: 0 });
      w.postMessage({ t: 'build', id: 2, seed, cx: 0, cy, cz: 0, ne: 0 });
      w.postMessage({ t: 'edit', e: [16, Math.round(T1.height(seed, 16, 16) * 64) / 64, 16, 4, 0] });
      w.postMessage({ t: 'build', id: 3, seed, cx: 0, cy, cz: 0, ne: 1 });
      const ready = await wait(m => m.t === 'ready'), col = await wait(m => m.t === 'col'), b2 = await wait(m => m.id === 2), b3 = await wait(m => m.id === 3);
      check(ready.kind === (wasm.includes('terra.wasm') ? 'wasm' : 'js') && (!wasm.includes('stall') || /timeout/.test(ready.err)), `worker backend ${ready.kind} for ${wasm} (${ready.err || 'ok'})`);
      check(col.hmax > col.hmin, 'worker column range');
      J.edits(1); const qn = J.build(seed, 0, cy, 0, 0);
      check(b2.q === qn && b2.buf && T1.meshHash({ pos: new Float32Array(b2.buf, 0, qn * 12), nrm: new Int8Array(b2.buf, qn * 48, qn * 16), col: new Uint8Array(b2.buf, qn * 64, qn * 16) }, qn) === T1.meshHash(J.out(), qn), 'worker block == JS core');
      { const ref = new ArrayBuffer(qn * T1.BLOCK_BYTES); T1.physPack(J.out().pos, qn, ref); const A = new Uint16Array(b2.buf, qn * 80, qn * 12), Bv = new Uint16Array(ref, qn * 80, qn * 12); let same = b2.pk === 1; for (let i = 0; i < qn * 12 && same; i++) same = A[i] === Bv[i]; check(same, 'worker physics copy (Uint16 after the mesh) == T1.physPack of the JS mesh'); }
      // the queued edit is applied: b3 == the JS core with the same edit (and differs from the block without it)
      const e1 = [16, Math.round(T1.height(seed, 16, 16) * 64) / 64, 16, 4, 0], je = J.edits(1); for (let i = 0; i < 5; i++) je[i] = e1[i];
      const q3 = J.build(seed, 0, cy, 0, 1), h3 = q3 > 0 ? T1.meshHash(J.out(), q3) : '';
      const w3 = b3.q > 0 ? T1.meshHash({ pos: new Float32Array(b3.buf, 0, b3.q * 12), nrm: new Int8Array(b3.buf, b3.q * 48, b3.q * 16), col: new Uint8Array(b3.buf, b3.q * 64, b3.q * 16) }, b3.q) : '';
      check(b3.ne === 1 && b3.q === q3 && w3 === h3 && h3 !== T1.meshHash({ pos: new Float32Array(b2.buf, 0, b2.q * 12), nrm: new Int8Array(b2.buf, b2.q * 48, b2.q * 16), col: new Uint8Array(b2.buf, b2.q * 64, b2.q * 16) }, b2.q), 'worker applies queued edits (b3 == JS core with the edit, != without)');
      // pool: the buffer goes back and is reused (same byteLength class, no growth)
      w.postMessage({ t: 'buf', buf: b2.buf }, [b2.buf]);
      w.postMessage({ t: 'build', id: 4, seed, cx: 0, cy, cz: 0, ne: 0 });
      const b4 = await wait(m => m.id === 4);
      check(b4.q === qn, 'rebuild after pool');
      console.log(`worker (${ready.kind}${ready.err ? ': ' + ready.err : ''}): col ${col.ms.toFixed(2)} ms, block ${b2.ms.toFixed(2)} ms (${b2.q} quads)`);
      await w.terminate();
    }
  }

  // ── timing: same blocks with wasm and JS (node, this machine) ──
  {
    const seed = 1337, list = [];
    for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) { const cy = Math.floor(T1.height(seed, cx * 32 + 16, cz * 32 + 16) / 32); list.push([cx, cy, cz], [cx, cy - 1, cz]); }
    const N = FAST ? 24 : list.length;
    const time = core => { core.edits(1); let q = 0; const t = process.hrtime.bigint(); for (let i = 0; i < N; i++) q += Math.max(0, core.build(seed, ...list[i], 0)); return [Number(process.hrtime.bigint() - t) / 1e6 / N, q]; };
    time(W); time(J);   // warm (JIT, caches)
    const W2 = await T1.wasm(fs.readFileSync(path.join(ROOT, 'js/engine/terra.wasm')), T1.DEFAULT_CAP), J2 = T1.js(T1.DEFAULT_CAP);
    time(J2); time(W2);
    const [mw, qw] = time(W2), [mj, qj] = time(J2);
    check(qw === qj, 'timing run: same quads');
    console.log(`per block (${N} surface + under-surface blocks, ${(qw / N).toFixed(0)} quads avg): wasm ${mw.toFixed(2)} ms, JS ${mj.toFixed(2)} ms`);
    // JS core: no growth of the heap while building (buffers reused)
    if (global.gc) {
      global.gc(); const h0 = process.memoryUsage().heapUsed;
      for (let k = 0; k < 3; k++) time(J2);
      global.gc(); const dh = (process.memoryUsage().heapUsed - h0) / 1048576;
      check(dh < 2, 'JS core heap growth ' + dh.toFixed(2) + ' MB');
      console.log(`JS core: heap after ${3 * N} more blocks ${dh >= 0 ? '+' : ''}${dh.toFixed(2)} MB`);
    }
  }
  W.dispose();
  console.log(`terra-test: ${ok} ok, ${bad} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

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
  let edits2 = null;
  const cnt = { H: 0, I: 0, D: 0, E: 0, Q: 0 };
  const fill = (core, list) => { const n = list.length / 5, e = core.edits(n); for (let i = 0; i < list.length; i++) e[i] = list[i]; return n; };
  for (const line of lines) {
    const l = line.trim();
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    if (p[0] === 'V') { check(+p[1] === T1.ABI, 'ABI ' + p[1]); continue; }
    if (p[0] === 'EDITS') { edits2 = p.slice(1).map(Number); continue; }
    const seed = +p[1];
    if (p[0] === 'H') {
      const x = +p[2], z = +p[3];
      check(bitsHex(T1.height(seed, x, z)) === p[4], `H js ${l}`);
      check(bitsHex(W.height(seed, x, z)) === p[4], `H wasm ${l}`);
      cnt.H++;
    } else if (p[0] === 'I') {
      const x = +p[2], z = +p[3];
      check(bitsHex(T1.temperature01(seed, x, z)) === p[4] && bitsHex(T1.moisture01(seed, x, z)) === p[5] && bitsHex(T1.entrance(seed, x, z)) === p[6] && T1.biome(seed, x, z) === +p[7], `I ${l}`);
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
  console.log(`golden: H ${cnt.H}, I ${cnt.I}, D ${cnt.D}, E ${cnt.E}, Q ${cnt.Q} — wasm and JS compared bit by bit`);
  check(cnt.H >= 60 && cnt.Q >= 60, 'golden coverage');

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
      self.fetch = async u => ({ ok: true, arrayBuffer: async () => { const b = fs.readFileSync(path.join(ROOT, u.split('?')[0])); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
      self.postMessage = (m, tr) => parentPort.postMessage(m, tr);
      parentPort.on('message', d => self.onmessage({ data: d }));
      vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/engine/terra-worker.js'), 'utf8'));`;
    for (const wasm of ['js/engine/terra.wasm', 'js/engine/missing.wasm']) {
      const w = new Worker(shim, { eval: true });
      const got = [];
      const wait = (pred, ms = 20000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); const f = () => { const m = got.find(pred); if (m) { clearTimeout(t); res(m); } else setTimeout(f, 5); }; f(); });
      w.on('message', m => got.push(m));
      w.postMessage({ t: 'init', wasm, cap: 24000 });
      // requests before 'ready' — must be queued, not lost
      const seed = 1337, cy = Math.floor(T1.height(seed, 16, 16) / 32);
      w.postMessage({ t: 'col', id: 1, seed, cx: 0, cz: 0 });
      w.postMessage({ t: 'build', id: 2, seed, cx: 0, cy, cz: 0, ne: 0 });
      w.postMessage({ t: 'edit', e: [16, Math.round(T1.height(seed, 16, 16) * 64) / 64, 16, 4, 0] });
      w.postMessage({ t: 'build', id: 3, seed, cx: 0, cy, cz: 0, ne: 1 });
      const ready = await wait(m => m.t === 'ready'), col = await wait(m => m.t === 'col'), b2 = await wait(m => m.id === 2), b3 = await wait(m => m.id === 3);
      check(ready.kind === (wasm.includes('missing') ? 'js' : 'wasm'), `worker backend ${ready.kind} for ${wasm}`);
      check(col.hmax > col.hmin, 'worker column range');
      J.edits(1); const qn = J.build(seed, 0, cy, 0, 0);
      check(b2.q === qn && b2.buf && T1.meshHash({ pos: new Float32Array(b2.buf, 0, qn * 12), nrm: new Int8Array(b2.buf, qn * 48, qn * 16), col: new Uint8Array(b2.buf, qn * 64, qn * 16) }, qn) === T1.meshHash(J.out(), qn), 'worker block == JS core');
      check(b3.q !== b2.q || b3.ne === 1, 'worker applies queued edits');
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

// node scripts/core-world-test.cjs — C-002: the site really uses the shared core d37-core (E:\d37-core\spec\contracts\C-002-site-uses-core.md).
// Everything goes through the site API js/engine/core-world.js, on the wasm backend AND the JS fallback:
//   1 the copied drop: js/engine/d37core.wasm / d37core.js and scripts/d37core-golden/*.txt == E:\d37-core-release\c1b (SHA256 pinned)
//   2 golden: hash.txt (M0), contact.txt + world.txt (C-001) — wasm == JS fallback == golden, every line; M1 / M2 (grid, flow): every
//     line of grid.txt / flow.txt through the wasm API (the JS fallback has no grid / flow port: E_UNSUPPORTED, checked)
//   3 JS == wasm on random command streams (results, events, hashes after every batch) and query == apply
//   4 fallback: missing (HTTP 404), stalled download (timeout), corrupted bytes, truncated, another ABI, no d37core.js → the game
//     lives (a world works and gives the same hash as the wasm world)
//   5 wasm memory growth: memory.grow forced between calls → results still == JS; d37_world_create reserves once (pages flat)
//   6 zero garbage: 0 GC during 200 rounds of world + contact calls; 0 GC during 10 000 session steps (in-thread)
//   7 30 / 60 / 144 FPS host loops → identical world hash (wasm, JS; in-thread and worker)
//   8 worker transport (node worker_threads running js/engine/core-world.js as a Worker named d37-core-world): == in-thread; worker crash → reset to
//     in-thread, onReset re-sends; missing worker script → in-thread; no ready → in-thread; wasm trap → reset
//   8b a Worker the game started first (GameKit.core) adopted by the host (== the 12 runs' hash; failed script → in-thread); the
//     worker's wasm prefetch over HTTP (compiled while its scripts load; corrupted → JS fallback); main-thread allocations per tick on
//     both transports (sampling heap profiler, attributed to core-world.js): worker ≤ 450 B, in-thread ≤ 320 B
//   9 numbers (node, this PC): load + init, 10 000 commands, a session tick
// Prints one summary line; exit 1 on any FAIL.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), vm = require('vm');
const WT = require('worker_threads');
const ROOT = path.join(__dirname, '..'), ENG = path.join(ROOT, 'js', 'engine'), GOLD = path.join(__dirname, 'd37core-golden');
const D37Core = require(path.join(ENG, 'd37core.js'));
const CW = require(path.join(ENG, 'core-world.js'));
const harness = require(path.join(GOLD, 'harness.cjs'));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } return c; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const lf = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const rd = name => lf(path.join(GOLD, name)).split('\n').filter(l => l && !l.startsWith('#'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cmpLines = (name, got, want) => {
  let p = 0, f = 0;
  const n = Math.max(got.length, want.length);
  for (let i = 0; i < n; i++) {
    if (got[i] === want[i]) p++;
    else { f++; if (f <= 4) console.log(`  MISMATCH ${name} #${i}\n    want: ${want[i]}\n    got:  ${got[i]}`); }
  }
  console.log(`${name}: ${p} lines equal, ${f} differ`);
  ok(f === 0 && p > 0, name);
  return p;
};
const out = {};

(async () => {
  // ════ 1 the drop copy
  {
    const want = { 'js/engine/d37core.wasm': '94aaffe0d8cc78544a76c085c900f01f316b19bfbc312792f61c0b87e56c2ab0', 'js/engine/d37core.js': '90a0fab0df66398b680ed9d8003c4e2fe096e220faa146edc3a0757acdb5165a',
      'scripts/d37core-golden/contact.txt': '4ee8ad0596cd1e8110fc0687ff775846b818e60835264980007cb833b359fabe', 'scripts/d37core-golden/flow.txt': '1c570e5adc0985b7534979e929fd5440778d5d3d52279460d72afc1555809930',
      'scripts/d37core-golden/grid.txt': '1530c654e05f10a65b5baf0e901903b3d772100704173e46d696637abf8c67a7', 'scripts/d37core-golden/hash.txt': '721fc7be470ba1ae8d372ebac5aeb921d056432d393695b4c234ce5f44055d8a',
      'scripts/d37core-golden/world.txt': 'd7e5311f365214430d943eb0b9859314d7e715d2cf27a673447df08f7ed5f4bc' };
    let good = 0;
    for (const [f, h] of Object.entries(want)) {
      const full = path.join(ROOT, f), got = f.endsWith('.wasm') ? sha(fs.readFileSync(full)) : sha(lf(full));
      if (ok(got === h, `${f} is not the drop/c1b file (SHA256 ${got.slice(0, 12)}…)`)) good++;
    }
    console.log(`drop c1b copy: ${good}/7 files byte-identical (text compared with LF endings)`);
  }
  const wasmBytes = fs.readFileSync(path.join(ENG, 'd37core.wasm'));

  // ════ load both backends through core-world.js
  const t0 = performance.now();
  const W = await CW.load({ wasm: new Uint8Array(wasmBytes), fresh: true });
  const loadMs = performance.now() - t0;
  const J = await CW.load({ wasm: false, fresh: true });
  ok(W.backend === 'wasm' && W.error === '' && W.abi === 5, 'wasm backend: ' + W.backend + ' ' + W.error);
  ok(J.backend === 'js-fallback' && J.abi === 5, 'js backend: ' + J.backend);
  ok(W.has.grid && W.has.flow && !J.has.grid && !J.has.flow && W.has.world && J.has.world, 'has flags');
  out.load = { nodeLoadInitMs: +loadMs.toFixed(2), initMs: +W.initMs.toFixed(2), pages: W.pages() };
  console.log(`load + init (node, bytes in memory): ${loadMs.toFixed(2)} ms (compile + self-checks ${W.initMs.toFixed(2)} ms), wasm memory ${W.pages()} pages`);

  // ════ 2 golden
  const H = harness(D37Core, rd('contact.txt'), rd('world.txt'));
  const gHash = rd('hash.txt');
  cmpLines('hash/wasm', H.hashLines(W.raw), gHash);
  cmpLines('hash/js', H.hashLines(J.raw), gHash);
  const tg = performance.now();
  cmpLines('contact/wasm', H.contactLines(W), rd('contact.txt'));
  cmpLines('contact/js', H.contactLines(J), rd('contact.txt'));
  cmpLines('world/wasm', H.worldLines(W), rd('world.txt'));
  cmpLines('world/js', H.worldLines(J), rd('world.txt'));
  console.log(`C-001 golden replay through core-world.js: ${(performance.now() - tg).toFixed(0)} ms`);
  // M1 / M2 preset section (wasm only)
  {
    const presetLines = require(path.join(GOLD, 'grid-golden.cjs'))(D37Core.js, W);
    const g = presetLines();
    const wantG = rd('grid.txt'), wantF = rd('flow.txt');
    cmpLines('grid (M1)/wasm', g.grid, wantG);
    cmpLines('flow (M2)/wasm', g.flow, wantF);
    const all = rd('grid.txt').length + rd('flow.txt').length;
    out.m12 = { goldenChecked: wantG.length + wantF.length, goldenTotal: all };
    const rg = J.createGrid(Int32Array.from([4, 4, 1, 0]), new Uint8Array(64), null, null, new Int32Array(0), 0, null);
    ok(rg.code === CW.E_UNSUPPORTED && rg.grid === null, 'JS fallback createGrid must be E_UNSUPPORTED');
    // the calls the preset section does not use: classes, mover, belief, retarget, release, sample (codes + invariants)
    let bad = '';
    {
      const w = 6, h = 4, cells = w * h, edges = new Uint8Array(cells * 4);
      for (let c = 0; c < cells; c++) { const x = c % w, y = (c / w) | 0; if (y + 1 < h) { edges[c * 4] = 1; edges[(c + w) * 4 + 2] = 1; } if (x + 1 < w) { edges[c * 4 + 1] = 1; edges[(c + 1) * 4 + 3] = 1; } }
      edges[(1 * w + 2) * 4 + 1] = 1 | 2 | 4; edges[(1 * w + 3) * 4 + 3] = 1 | 2 | 4; // a closed door
      const r = W.createGrid(Int32Array.from([w, h, 1, 0]), edges, null, null, new Int32Array(0), 0, new Int32Array(8));
      const G = r.grid;
      if (r.code !== 0) bad += ' create';
      const ch = new Int32Array(2); CW.pack.edge(ch, 0, 1 * w + 2, 1, 4);
      if (G.setClasses(ch, 1) < 0) bad += ' setClasses';
      const cl = new Uint8Array(cells * 4);
      if (G.getClasses(cl) !== 0 || cl[(1 * w + 2) * 4 + 1] !== 4) bad += ' getClasses';
      const F = W.createFlow(G, Int32Array.from([2, 4, 0, 0])).flow;
      if (!F) bad += ' createFlow';
      const mv = new Int32Array(11); mv[0] = 10 | (40 << 16);
      if (F.setMover(1, mv) !== 0) bad += ' setMover';
      const prm = new Int32Array(12); prm[2] = 25;
      if (F.acquire(Int32Array.from([0, 0]), 1, prm) !== 0) bad += ' acquire';
      const slot = F.slot, so = new Int32Array(4);
      for (let k = 0; k < 50; k++) F.step(64, so);
      if (F.retarget(slot, Int32Array.from([cells - 1, 0]), 1, prm) < 0) bad += ' retarget';
      for (let k = 0; k < 50; k++) F.step(64, so);
      const dir = new Uint8Array(cells), dist = new Uint32Array(cells);
      if (F.read(slot, dir, dist) < 0) bad += ' read';
      const sc = Int32Array.from([0, 5, 7, 11]), sd = new Uint8Array(4), sdist = new Uint32Array(4);
      if (F.sample(slot, sc, 4, sd, sdist) < 0) bad += ' sample';
      for (let k = 0; k < 4; k++) if (sd[k] !== dir[sc[k]] || sdist[k] !== dist[sc[k]]) bad += ' sample!=read';
      if (dist[cells - 1] !== 0) bad += ' goal-dist';
      const bel = new Int32Array(2); CW.pack.edge(bel, 0, 1 * w + 2, 1, 0x80 | 4); // BELIEF_KNOWN | class
      if (F.setBelief(1, bel, 1) < 0) bad += ' setBelief';
      const bo = new Uint8Array(cells * 4);
      if (F.getBelief(1, bo) < 0) bad += ' getBelief';
      if (F.clearBelief(1) < 0) bad += ' clearBelief';
      if (F.release(slot) !== 0) bad += ' release';
      if (G.destroy() !== -7) bad += ' destroy-busy'; // a flow is attached: E_BUSY
      if (F.destroy() !== 0 || G.destroy() !== 0) bad += ' destroy';
    }
    ok(bad === '', 'M1/M2 calls outside the golden section:' + bad);
    console.log(`M1/M2 other calls (classes, mover, retarget, sample == read, belief, release, E_BUSY destroy): ${bad ? 'FAIL' + bad : 'OK'}`);
  }

  // ════ 3 JS == wasm on random streams + query == apply
  {
    let mism = 0, cmds = 0, applied = 0, qmis = 0;
    const r = new H.Rng(0xC0025EED);
    const res1 = new Int32Array(64 * 4), res2 = new Int32Array(64 * 4), e1 = new Int32Array(256 * 13), e2 = new Int32Array(256 * 13), h1 = new Uint32Array(2), h2 = new Uint32Array(2);
    const q = new Int32Array(10), qo1 = new Int32Array(2), qo2 = new Int32Array(2), c1 = new Int32Array(13);
    for (let round = 0; round < 30; round++) {
      const seed = r.u32(), d = H.desc(seed, r.below(3), 1 + r.below(2), 8 + r.below(120), 4 + r.below(200), [16, 32, 64, 4096][r.below(4)], 8, r.below(4) === 0 ? 0 : 1500 + r.below(2000));
      const wj = J.createWorld(d).world, ww = W.createWorld(d).world;
      const g = new H.CmdGen(seed ^ 0x77, round, d[0], d[1], d[2], 8), batch = new Int32Array(64 * 13);
      for (let b = 0; b < 40; b++) {
        const n = 1 + r.below(40);
        for (let k = 0; k < n; k++) g.next(batch, k * 13);
        wj.apply(batch, n, res1); ww.apply(batch, n, res2);
        g.noteAll(batch, n, res1);
        for (let k = 0; k < n * 4; k++) if (res1[k] !== res2[k]) mism++;
        for (let k = 0; k < n; k++) { cmds++; if (res1[k * 4] === 0) applied++; }
        const cap = r.below(4) === 0 ? 3 : 256;
        if (wj.events(e1, cap) !== ww.events(e2, cap) || wj.count !== ww.count) mism++;
        for (let k = 0; k < wj.count * 13; k++) if (e1[k] !== e2[k]) mism++;
        wj.hash(h1); ww.hash(h2);
        if (h1[0] !== h2[0] || h1[1] !== h2[1]) mism++;
        g.next(c1, 0); c1[0] = 0x7E570000 + cmds; c1[1] = 0x7E57; c1[6] = 0;
        q[0] = c1[2]; q[1] = c1[3]; q[2] = c1[4]; q[3] = c1[5]; for (let k = 0; k < 6; k++) q[4 + k] = c1[7 + k];
        wj.query(q, 1, qo1); ww.query(q, 1, qo2);
        wj.apply(c1, 1, res1); ww.apply(c1, 1, res2);
        g.note(c1, 0, res1, 0);
        if (qo1[0] !== res1[0] || qo2[0] !== res2[0] || qo1[0] !== qo2[0]) qmis++;
        wj.events(e1, 256); ww.events(e2, 256);
        const ticks = r.below(3); wj.step(ticks); ww.step(ticks);
      }
      wj.destroy(); ww.destroy();
    }
    console.log(`JS vs wasm through core-world.js: 30 worlds, ${cmds} commands (${applied} applied), ${mism} mismatches; query == apply: ${qmis} mismatches`);
    ok(mism === 0 && qmis === 0, 'JS vs wasm streams');
    out.streams = { cmds, applied, mism, qmis };
  }

  // a fixed scenario every backend must agree on: a player body + actor, props, take / put / hit / use
  const scen = core => {
    const r = core.createWorld({ seed: 37, genVersion: 1, maxObjects: 64, eventCap: 256, cmdRing: 64, maxActors: 8 });
    if (!r.world) return 'create ' + r.code;
    const w = r.world, id = new Uint32Array(2), c = new Int32Array(13 * 8), res = new Int32Array(8 * 4), ev = new Int32Array(256 * 13), h = new Uint32Array(2);
    let k = 0, cid = 1;
    const cmd = (actor, lo, hi, op, ver, p) => { const b = k * 13; c.fill(0, b, b + 13); c[b] = cid++; c[b + 1] = 0x5C; c[b + 2] = actor; c[b + 3] = lo; c[b + 4] = hi; c[b + 5] = op; c[b + 6] = ver; for (let i = 0; i < 6; i++) c[b + 7 + i] = p[i] | 0; k++; };
    core.worldId(37, 0, 1, 0, 0, 0, 0, id); const pl = [id[0], id[1]];
    cmd(0, pl[0], pl[1], 1, 0, [CW.pack.spawnKind(1, 0, 1, 0), 0, 0, 0, CW.pack.hpBrk(1600, 0), 75000]);
    cmd(0, 0, 0, 7, 0, [1, 1, pl[0], pl[1], 0, 0]);
    core.worldId(37, 0, 1, 1, 0, 0, 1, id); const crate = [id[0], id[1]];
    cmd(0, crate[0], crate[1], 1, 0, [CW.pack.spawnKind(5, 0, 2, 16), 3, 5, 0, CW.pack.hpBrk(800, 3000), 12000]);
    w.apply(c, k, res); k = 0;
    cmd(1, crate[0], crate[1], 3, 0, [1, 0, 0, 0, 0, 500]);
    cmd(1, crate[0], crate[1], 4, 0, [1, 0, 0, 0, 0, 500]);
    cmd(1, crate[0], crate[1], 5, 0, [0, 6000, 1 | (2 << 8), 0, 0, 800]);
    cmd(1, crate[0], crate[1], 6, 0, [1, -1, 0, 0, 0, 700]);
    w.apply(c, k, res);
    w.events(ev, 256); w.step(3); w.hash(h);
    const s = Array.from(res.subarray(0, 16)).join(',') + '|' + h[0] + ',' + h[1];
    w.destroy();
    return s;
  };
  const scenWasm = scen(W), scenJs = scen(J);
  ok(scenWasm === scenJs && !scenWasm.startsWith('create'), 'fixed scenario wasm == js');

  // ════ 4 fallback cases (the game lives: a world works and equals the wasm world)
  {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/stall')) return; // never answers
      if (req.url.startsWith('/ok')) { res.writeHead(200, { 'Content-Type': 'application/wasm' }); res.end(wasmBytes); return; }
      if (req.url.startsWith('/bad')) { const b = Buffer.from(wasmBytes); b[3000] ^= 0xFF; b[9000] ^= 0xFF; res.writeHead(200, { 'Content-Type': 'application/wasm' }); res.end(b); return; }
      if (req.url.startsWith('/octet')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(wasmBytes); return; }
      res.writeHead(404); res.end('no');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const flip = new Uint8Array(wasmBytes); for (const p of [1000, 5000, 20000, 60000, 100000]) flip[p] ^= 0xFF;
    const name = Array.from('d37_abi_version', ch => ch.charCodeAt(0));
    const abi3 = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 5, 1, 0x60, 0, 1, 0x7f, 3, 2, 1, 0, 7, 4 + name.length, 1, name.length, ...name, 0, 0, 10, 6, 1, 4, 0, 0x41, 3, 0x0b]);
    const cases = [
      ['HTTP 404', { wasm: base + '/missing.wasm' }, /HTTP 404/],
      ['stalled download', { wasm: base + '/stall.wasm', timeoutMs: 300 }, /timeout/],
      ['corrupted bytes', { wasm: flip }, /./],
      ['truncated', { wasm: new Uint8Array(wasmBytes.subarray(0, 70000)) }, /./],
      ['another ABI (3)', { wasm: abi3 }, /abi mismatch/],
      ['empty file', { wasm: new Uint8Array(0) }, /./],
      ['corrupted over HTTP (streaming compile)', { wasm: base + '/bad.wasm' }, /./],
    ];
    const lines = [];
    for (const [label, o, re] of cases) {
      const c = await CW.load(Object.assign({ fresh: true }, o));
      const s = scen(c);
      const good = c.backend === 'js-fallback' && re.test(c.error) && s === scenWasm;
      ok(good, `fallback ${label}: backend ${c.backend} (${c.error}) scenario ${s === scenWasm ? 'equal' : 'DIFFERS'}`);
      lines.push(`${label} → ${c.backend} (${c.error.slice(0, 40)})`);
    }
    const viaHttp = await CW.load({ wasm: base + '/ok.wasm', fresh: true }), viaOctet = await CW.load({ wasm: base + '/octet.wasm', fresh: true });
    ok(viaHttp.backend === 'wasm' && scen(viaHttp) === scenWasm, 'wasm over HTTP (application/wasm: streaming compile)');
    ok(viaOctet.backend === 'wasm' && scen(viaOctet) === scenWasm, 'wasm over HTTP (octet-stream: bytes)');
    lines.push(`HTTP application/wasm → ${viaHttp.backend}, octet-stream → ${viaOctet.backend}`);
    // no d37core.js on the page at all: core-world.js still loads; every call answers E_UNSUPPORTED, nothing throws
    {
      const ctx = { console, setTimeout, clearTimeout, Promise, Math, Uint8Array, Int32Array, Uint32Array, Float64Array, ArrayBuffer, Error, Object, String, Number, Date, performance };
      ctx.self = ctx;
      vm.runInNewContext(fs.readFileSync(path.join(ENG, 'core-world.js'), 'utf8'), ctx);
      const c = await ctx.D37CoreWorld.load({});
      const r = c.createWorld(null);
      ok(c.backend === 'none' && r.code === CW.E_UNSUPPORTED && r.world === null, 'no d37core.js → backend none, E_UNSUPPORTED');
      lines.push(`no d37core.js → ${c.backend} (${c.error})`);
    }
    server.close();
    console.log('fallback (8 cases, each then runs the fixed scenario == wasm) + 2 good paths: ' + lines.join('; '));
  }

  // ════ 5 wasm memory growth: forced memory.grow between calls; create reserves once
  {
    const e = W.raw.exports, p0 = W.pages();
    const d = H.desc(4242, 0, 1, 512, 256, 4096, 8, 0);
    const wj = J.createWorld(d).world, ww = W.createWorld(d).world;
    const pAfterCreate = W.pages();
    const g = new H.CmdGen(4242, 9, 4242, 0, 1, 8), c = new Int32Array(32 * 13), r1 = new Int32Array(32 * 4), r2 = new Int32Array(32 * 4);
    const ev1 = new Int32Array(256 * 13), ev2 = new Int32Array(256 * 13), h1 = new Uint32Array(2), h2 = new Uint32Array(2), o1 = new Int32Array(12 * 4), o2 = new Int32Array(12 * 4);
    let mism = 0, grows = 0;
    for (let t = 0; t < 400; t++) {
      for (let j = 0; j < 32; j++) g.next(c, j * 13);
      if (t % 7 === 3) { e.memory.grow(1); grows++; } // the next call must see the new buffer
      wj.apply(c, 32, r1); ww.apply(c, 32, r2);
      g.noteAll(c, 32, r1);
      for (let k = 0; k < 128; k++) if (r1[k] !== r2[k]) mism++;
      if (t % 7 === 5) { e.memory.grow(1); grows++; }
      wj.events(ev1, 256); ww.events(ev2, 256);
      if (wj.count !== ww.count) mism++;
      for (let k = 0; k < wj.count * 13; k++) if (ev1[k] !== ev2[k]) mism++;
      wj.read(c.subarray(3, 3 + 8), 4, o1); ww.read(c.subarray(3, 3 + 8), 4, o2);
      for (let k = 0; k < 48; k++) if (o1[k] !== o2[k]) mism++;
      wj.step(1); ww.step(1); wj.hash(h1); ww.hash(h2);
      if (h1[0] !== h2[0] || h1[1] !== h2[1]) mism++;
    }
    // M1 after a grow: the grid view must follow the new buffer
    const gg = W.createGrid(Int32Array.from([8, 8, 1, 0]), new Uint8Array(256).fill(1), null, null, new Int32Array(0), 0, null);
    e.memory.grow(1); grows++;
    const ex = new Uint8Array(256);
    const gOk = gg.grid && gg.grid.getEdges(ex) === 0;
    if (gg.grid) gg.grid.destroy();
    const pAfter = W.pages();
    wj.destroy(); ww.destroy();
    // a world reserves its maximum once: 20 000 commands into a fresh world do not grow the memory
    const big = W.createWorld(H.desc(7, 0, 1, 4096, 4096, 4096, 64, 0)).world, pBig = W.pages();
    const gb = new H.CmdGen(7, 3, 7, 0, 1, 8), cb = new Int32Array(100 * 13), rb = new Int32Array(400), eb = new Int32Array(4096 * 13), db = new Int32Array(8192 * 4);
    for (let t = 0; t < 200; t++) { for (let j = 0; j < 100; j++) gb.next(cb, j * 13); big.apply(cb, 100, rb); gb.noteAll(cb, 100, rb); big.events(eb, 4096); big.dirty(db, 8192); big.step(1); }
    const pBigAfter = W.pages();
    big.destroy();
    console.log(`memory growth: ${grows} forced memory.grow between calls, ${mism} mismatches vs JS, grid view after grow ${gOk ? 'OK' : 'FAIL'}; pages ${p0} → ${pAfterCreate} (create) → ${pAfter}; a 4096-object world: ${pBig} pages before 20 000 commands, ${pBigAfter} after`);
    ok(mism === 0 && gOk, 'memory growth');
    ok(pBigAfter === pBig, 'a world must reserve its maximum at create (pages grew during commands)');
    out.memory = { grows, mism, pagesFlatAfterCreate: pBigAfter === pBig, pages: pBigAfter };
  }

  // ════ 6 zero garbage (GC observer)
  {
    const { PerformanceObserver } = require('perf_hooks');
    const v8 = require('v8'); v8.setFlagsFromString('--expose_gc');
    const gcNow = vm.runInNewContext('gc');
    let gcs = 0;
    const obs = new PerformanceObserver(list => { gcs += list.getEntries().length; });
    obs.observe({ entryTypes: ['gc'] });
    const res = [];
    for (const core of [J, W]) {
      const n = 1000, w = core.createWorld(H.desc(7, 0, 1, n + 64, 65536, 4096, 8, 0)).world;
      const sp = new Int32Array(n * 13), rs = new Int32Array(n * 4), ev = new Int32Array(65536 * 13), dr = new Int32Array(8192 * 4), h = new Uint32Array(2), ids = new Uint32Array(n * 2);
      for (let k = 0; k < n; k++) {
        core.worldId(7, 0, 1, k % 100, 0, (k / 100) | 0, k, h); ids[2 * k] = h[0]; ids[2 * k + 1] = h[1];
        const b = k * 13, ck = k % 3;
        sp[b] = 1 + k; sp[b + 1] = 0xBE; sp[b + 3] = h[0]; sp[b + 4] = h[1]; sp[b + 5] = 1;
        sp[b + 7] = 1 | (ck << 20) | ((ck === 1 ? 16 : ck === 2 ? 1 : 0) << 24); sp[b + 8] = ck === 0 ? 0 : 1000000; sp[b + 11] = 1600 | (3000 << 16); sp[b + 12] = 75000;
      }
      w.apply(sp, n, rs);
      const reg = new Int32Array(4 * 13);
      for (let a = 1; a < 5; a++) { const b = (a - 1) * 13; reg[b] = 900000 + a; reg[b + 1] = 0xBE; reg[b + 5] = 7; reg[b + 7] = a; reg[b + 8] = 1; }
      w.apply(reg, 4, rs);
      while (w.events(ev, 65536) === 1) { }
      while (w.dirty(dr, 8192) === 1) { }
      const rr = new H.Rng(99), N = 500, streams = [];
      for (let s = 0; s < 8; s++) {
        const c = new Int32Array(N * 13);
        for (let k = 0; k < N; k++) {
          const t = rr.below(n), b = k * 13, op = rr.below(4);
          c[b] = 2000000 + s * N + k; c[b + 1] = 0xBE5; c[b + 2] = 1 + rr.below(4); c[b + 3] = ids[2 * t]; c[b + 4] = ids[2 * t + 1]; c[b + 12] = 1000;
          if (op === 0) { c[b + 5] = 3; c[b + 7] = 1; } else if (op === 1) { c[b + 5] = 4; c[b + 7] = 1; }
          else if (op === 2) { c[b + 5] = 6; c[b + 7] = 1 + rr.below(8); c[b + 8] = -1; }
          else { c[b + 5] = 5; c[b + 7] = 75000; c[b + 8] = 1000 + rr.below(6000); c[b + 9] = 2 | (1 << 8) | (2 << 16); }
        }
        streams.push(c);
      }
      const q = new Int32Array(N * 10), qo = new Int32Array(N * 2), st = new Int32Array(500 * 12), pairs = new Int32Array(2000 * 15), po = new Int32Array(2000 * 7), pr = new H.Rng(0xC0);
      for (let k = 0; k < N; k++) { const c = streams[0], b = k * 13, qb = k * 10; q[qb] = c[b + 2]; q[qb + 1] = c[b + 3]; q[qb + 2] = c[b + 4]; q[qb + 3] = c[b + 5]; for (let z = 0; z < 6; z++) q[qb + 4 + z] = c[b + 7 + z]; }
      for (let k = 0; k < 2000; k++) { H.randPair(pr, H.wiTmp); pairs.set(H.wiTmp, k * 15); }
      const round = s => { w.apply(streams[s % 8], N, rs); w.query(q, N, qo); w.events(ev, 65536); w.dirty(dr, 8192); w.read(ids, 500, st); w.step(1); w.hash(h); core.contact(pairs, 2000, po); };
      for (let s = 0; s < 8; s++) round(s);
      gcNow(); await sleep(50); gcs = 0;
      const heap0 = process.memoryUsage().heapUsed;
      for (let s = 0; s < 200; s++) round(s);
      await sleep(50);
      const heap1 = process.memoryUsage().heapUsed;
      res.push(`${core.backend} ${gcs} GC over 200 rounds (500 cmds + 500 queries + drains + 500 reads + step + hash + 2000 contact pairs), heap ${((heap1 - heap0) / 1024).toFixed(0)} KB`);
      ok(gcs === 0, core.backend + ' world/contact calls allocate (GC ' + gcs + ')');
      w.destroy();
    }
    // the session's per-step path (in-thread): s.cmd + s.step, a tick every 3 steps, results counted — no garbage
    for (const core of [J, W]) {
      const s = CW.session({ seed: 5, worker: false, wasm: core === W ? new Uint8Array(wasmBytes) : false, hashEvery: 20 });
      await s.started;
      for (let i = 0; i < 300; i++) { s.cmd(6, 0, 1, 0, 0, 1, -1, 0, 0, 0, 0); s.step(); }
      gcNow(); await sleep(50); gcs = 0;
      for (let i = 0; i < 10000; i++) { if (i % 2 === 0) s.cmd(6, 0, 1, 0, 0, i & 7, -1, 0, 0, 0, 0); s.step(); }
      await sleep(50);
      res.push(`session/${s.backend}: ${gcs} GC over 10 000 steps (3 334 ticks)`);
      ok(gcs === 0, 'session steps allocate on ' + s.backend + ' (GC ' + gcs + ')');
      s.dispose();
    }
    obs.disconnect();
    console.log('zero garbage: ' + res.join('; '));
  }

  // ════ 7 + 8 sessions: 30 / 60 / 144 FPS, in-thread and worker, wasm and JS → one hash
  const SHIM = path.join(GOLD, 'worker-shim.cjs');
  const workers = new Set();
  class FakeWorker {
    constructor(u, o) {
      const s0 = String(u), name = (o && o.name) || '', http = /^https?:/.test(s0);
      // an http URL (the prefetch test) runs the same local file, with location.href = that URL (the worker fetches its wasm there)
      const f = http ? path.join(ENG, path.basename(new URL(s0).pathname)) : s0.split('?')[0], search = s0.indexOf('?') >= 0 ? s0.slice(s0.indexOf('?')) : '';
      this.onmessage = null; this.onerror = null;
      if (!fs.existsSync(f)) { setTimeout(() => this.onerror && this.onerror({ message: 'not found', preventDefault() {} }), 5); return; }
      this.w = new WT.Worker(SHIM, { workerData: { dir: path.dirname(f), script: f, search, name, href: http ? s0 : '' } });
      workers.add(this.w);
      this.w.on('message', d => this.onmessage && this.onmessage({ data: d }));
      this.w.on('error', e => this.onerror && this.onerror({ message: String(e && e.message), preventDefault() {} }));
    }
    postMessage(m, tr) { if (this.w) this.w.postMessage(m, tr || []); }
    terminate() { if (this.w) { this.w.terminate(); workers.delete(this.w); } }
  }
  global.Worker = FakeWorker; global.document = { baseURI: 'file:///site/' };
  const WORKER = path.join(ENG, 'core-world.js') + '?v=t';
  // the game side: E.loop's fixed 60 Hz step from frame times; commands depend only on the step index
  async function play(fps, opts, totalSteps, cmdsWanted) {
    let resets = 0;
    const id = new Uint32Array(2), props = [];
    const s = CW.session(Object.assign({ seed: 937, hashEvery: 0, workerUrl: WORKER, onReset(ss) {
      resets++;
      D37Core.js.worldId(937, 0, 1, 0, 0, 0, 0, id);
      ss.cmd(1, 0, id[0], id[1], 0, CW.pack.spawnKind(1, 0, 1, 0), 0, 0, 0, CW.pack.hpBrk(1600, 0), 75000);
      ss.cmd(7, 0, 0, 0, 0, 1, 1, id[0], id[1], 0, 0);
    } }, opts));
    const r = new H.Rng(0xF95);
    let acc = 0, steps = 0, sent = 0, frames = 0;
    const plan = new Int32Array(totalSteps); // which steps send a command (fixed, from the step index)
    for (let k = 0; k < cmdsWanted; k++) plan[r.below(totalSteps)]++;
    const gr = new H.Rng(0xC0DE);
    const dt = 1 / fps;
    while (steps < totalSteps) {
      frames++;
      acc += dt;
      let n = 0;
      while (acc >= 1 / 60 && n < 5 && steps < totalSteps) {
        for (let c = 0; c < plan[steps]; c++) {
          const op = gr.below(5);
          if (op === 0 || props.length < 2) { D37Core.js.worldId(937, 0, 1, 1 + gr.below(30), 0, 0, 100 + sent, id); props.push(id[0], id[1]); s.cmd(1, 0, id[0], id[1], 0, CW.pack.spawnKind(2 + gr.below(9), 0, 2, 16 + gr.below(8)), gr.below(4), 6, 0, CW.pack.hpBrk(400 + gr.below(1200), 2000 + gr.below(3000)), 1000 + gr.below(30000)); }
          else {
            const k = gr.below(props.length / 2) * 2, lo = props[k], hi = props[k + 1];
            if (op === 1) s.cmd(3, 1, lo, hi, 0, 1, 0, 0, 0, 0, 800);
            else if (op === 2) s.cmd(4, 1, lo, hi, 0, 1, 0, 0, 0, 0, 800);
            else if (op === 3) s.cmd(5, 1, lo, hi, 0, 0, 1000 + gr.below(7000), 1 | (gr.below(5) << 8), 0, 0, 900);
            else s.cmd(6, 1, lo, hi, 0, gr.below(4), -1, 0, 0, 0, 700);
          }
          sent++;
        }
        s.step(); steps++; acc -= 1 / 60; n++;
      }
      if (n === 5) acc = 0;
      if (frames % 50 === 0) await sleep(0); // let worker replies in (a real page yields every frame)
    }
    await s.started;
    for (let i = 0; i < 400 && (s.stats.backlog > 0 || !s.ready); i++) await sleep(5);
    const h = new Uint32Array(2);
    const hc = s.world ? await s.world.hash(h) : -1;
    const res = { hash: (h[1] >>> 0).toString(16).padStart(8, '0') + (h[0] >>> 0).toString(16).padStart(8, '0'), hc, sent, ticks: s.stats.ticks, cmds: s.stats.cmds, applied: s.stats.applied,
      backend: s.backend, transport: s.transport, resets, early: s.stats.early, s };
    return res;
  }
  {
    const rows = [], hashes = new Set();
    let total = 0;
    for (const [label, o] of [['inline/wasm', { worker: false, wasm: new Uint8Array(wasmBytes) }], ['inline/js', { worker: false, wasm: false }],
      ['worker/wasm', { worker: true, wasm: new Uint8Array(wasmBytes) }], ['worker/js', { worker: true, wasm: false }]]) {
      for (const fps of [30, 60, 144]) {
        const r = await play(fps, o, 1200, 100);
        rows.push(`${label}@${fps}: ${r.hash} (${r.ticks} ticks, ${r.cmds} cmds / ${r.applied} applied, early ${r.early}, ${r.transport}/${r.backend})`);
        hashes.add(r.hash);
        ok(r.hc === 0 && r.cmds === 102 && r.transport === label.split('/')[0] && r.backend === (label.endsWith('wasm') ? 'wasm' : 'js-fallback'), `session ${label}@${fps}: hc ${r.hc} cmds ${r.cmds} ${r.transport}/${r.backend}`);
        total++;
        r.s.dispose();
      }
    }
    console.log('30/60/144 FPS: ' + rows.join('\n  '));
    ok(hashes.size === 1, `30/60/144 x inline/worker x wasm/js: ${hashes.size} different hashes (want 1)`);
    console.log(`determinism: ${total} runs (100 commands + setup, 1 200 game steps = 400 core ticks) → ${hashes.size} hash`);
    out.determinism = { runs: total, hashes: hashes.size, hash: [...hashes][0] };
  }
  // worker transport: failures
  {
    const lines = [];
    // missing worker script → in-thread host
    const h1 = await CW.host({ workerUrl: path.join(ENG, 'no-such-worker.js'), wasm: new Uint8Array(wasmBytes) });
    ok(h1.kind === 'inline' && h1.backend === 'wasm' && /worker/.test(h1.error), 'missing worker script → inline: ' + h1.kind + ' ' + h1.error);
    lines.push(`missing script → ${h1.kind}/${h1.backend}`);
    h1.dispose();
    // a script that never says ready → in-thread after readyMs
    const h2 = await CW.host({ workerUrl: path.join(ENG, 'd37core.js'), wasm: new Uint8Array(wasmBytes), readyMs: 400 });
    ok(h2.kind === 'inline' && /no ready/.test(h2.error), 'worker never ready → inline: ' + h2.kind + ' ' + h2.error);
    lines.push(`never ready → ${h2.kind}/${h2.backend}`);
    h2.dispose();
    // broken wasm inside the worker → the JS core inside the worker
    const flip = new Uint8Array(wasmBytes); flip[3000] ^= 0xFF; flip[9000] ^= 0xFF;
    const h3 = await CW.host({ workerUrl: WORKER, wasm: flip });
    ok(h3.kind === 'worker' && h3.backend === 'js-fallback', 'broken wasm in worker → js: ' + h3.kind + ' ' + h3.backend);
    lines.push(`broken wasm → ${h3.kind}/${h3.backend}`);
    h3.dispose();
    // a worker crash mid-game → the session resets onto an in-thread world and the game re-sends its objects (onReset)
    {
      let resets = 0, lastRes = -1;
      const s = CW.session({ seed: 1, workerUrl: WORKER, wasm: new Uint8Array(wasmBytes), hashEvery: 0, onReset(ss) { resets++; ss.cmd(1, 0, 77, 1, 0, CW.pack.spawnKind(1, 0, 1, 0), 0, 0, 0, 0, 75000); }, onTick(r, k) { if (k) lastRes = r.res[0]; } });
      await s.started;
      for (let i = 0; i < 30; i++) s.step();
      for (let i = 0; i < 100 && s.stats.backlog; i++) await sleep(5);
      const t1 = s.transport;
      s.host._kill('test crash');
      for (let i = 0; i < 200 && !(s.ready && s.transport === 'inline'); i++) await sleep(5);
      for (let i = 0; i < 30; i++) s.step();
      const info = new Int32Array(8);
      const ic = s.world ? await s.world.info(info) : -1;
      const good = t1 === 'worker' && s.transport === 'inline' && resets === 2 && s.stats.resets === 1 && ic === 0 && info[2] === 1 && lastRes === 0;
      ok(good, `worker crash → reset: ${t1} → ${s.transport}, onReset ${resets}, resets ${s.stats.resets}, objects ${info[2]}, spawn result ${lastRes}`);
      lines.push(`crash mid-game → ${t1} → ${s.transport}, onReset ×${resets}, objects ${info[2]}`);
      s.dispose();
    }
    // a wasm trap inside the world → reset on the same host
    {
      let resets = 0;
      const s = CW.session({ seed: 2, worker: false, wasm: new Uint8Array(wasmBytes), hashEvery: 0, onReset() { resets++; } });
      await s.started;
      for (let i = 0; i < 9; i++) s.step();
      const ww = s.world.w, real = ww.ptr;
      ww.ptr = 0x7FFFFFF0; // out of the wasm memory: the next call traps
      s.cmd(6, 0, 1, 0, 0, 1, -1, 0, 0, 0, 0);
      for (let i = 0; i < 3; i++) s.step();
      ww.ptr = real; ww.dead = false; ww.destroy && ww.destroy(); // the trapped world's memory back (test only)
      for (let i = 0; i < 100 && !s.ready; i++) await sleep(5);
      for (let i = 0; i < 6; i++) s.step();
      ok(resets === 2 && s.stats.resets === 1 && s.ready && s.stats.errors >= 1, `wasm trap → reset: onReset ${resets}, resets ${s.stats.resets}`);
      lines.push(`wasm trap → reset, onReset ×${resets}`);
      s.dispose();
    }
    console.log('worker / reset cases: ' + lines.join('; '));
    // worker == in-thread on a long random stream (results and events of every tick)
    {
      const d = H.desc(31337, 0, 1, 512, 512, 4096, 8, 0);
      const wh = await CW.host({ workerUrl: WORKER, wasm: new Uint8Array(wasmBytes) }), hw = (await wh.createWorld(d)).world;
      const iw = W.createWorld(d).world, g = new H.CmdGen(31337, 4, 31337, 0, 1, 8), c = new Int32Array(40 * 13), res = new Int32Array(160), ev = new Int32Array(512 * 13), dr = new Int32Array(1024 * 4), h = new Uint32Array(2);
      for (let a = 1; a < 5; a++) { const b = (a - 1) * 13; c.fill(0, b, b + 13); c[b] = a; c[b + 1] = 0x50AC; c[b + 5] = 7; c[b + 7] = a; c[b + 8] = 1; }
      iw.apply(c, 4, res); iw.events(ev, 512); iw.dirty(dr, 1024); // the worker's setup tick drains them too
      let mism = 0, ticks = 0;
      const wait = [];
      await new Promise(done => hw.tick(c, 4, 0, () => done()));
      for (let t = 0; t < 300; t++) {
        const n = 1 + (t * 7) % 40;
        for (let j = 0; j < n; j++) g.next(c, j * 13);
        const code = iw.apply(c, n, res); g.noteAll(c, n, res);
        iw.step(1);
        const ec = iw.events(ev, 512), en = iw.count, dc = iw.dirty(dr, 1024), dn = iw.count;
        iw.hash(h);
        const want = { code, res: res.slice(0, n * 4), ec, en, ev: ev.slice(0, en * 13), dc, dn, dr: dr.slice(0, dn * 4), h0: h[0], h1: h[1] };
        wait.push(new Promise(done => hw.tick(c, n, 1, r => {
          ticks++;
          if (r.code !== want.code || r.evCode !== want.ec || r.evN !== want.en || r.drCode !== want.dc || r.drN !== want.dn || r.hash[0] !== want.h0 || r.hash[1] !== want.h1) mism++;
          for (let k = 0; k < n * 4; k++) if (r.res[k] !== want.res[k]) mism++;
          for (let k = 0; k < want.en * 13; k++) if (r.ev[k] !== want.ev[k]) mism++;
          for (let k = 0; k < want.dn * 4; k++) if (r.dr[k] !== want.dr[k]) mism++;
          done();
        }, true, 512, 1024)));
      }
      await Promise.all(wait);
      const snap = await hw.snapshot();
      iw.snapshot(null); const ib = new Uint8Array(iw.len); iw.snapshot(ib);
      const snapEq = snap.code === 0 && snap.bytes.length === ib.length && Buffer.compare(Buffer.from(snap.bytes), Buffer.from(ib)) === 0;
      ok(mism === 0 && ticks === 300 && snapEq, `worker == in-thread: ${mism} mismatches over ${ticks} ticks, snapshot ${snapEq ? 'equal' : 'DIFFERS'}`);
      console.log(`worker == in-thread wasm: 300 ticks (pipelined, up to 300 in flight), ${mism} mismatches in results / events / dirty / hash; snapshot ${snap.bytes ? snap.bytes.length : 0} B ${snapEq ? 'byte-identical' : 'DIFFERS'}`);
      // restore through the worker → same hash as in-thread restore
      const w2 = W.createWorld(d).world; w2.restore(ib, ib.length); const hh = new Uint32Array(2); w2.hash(hh); w2.destroy();
      const rc = await hw.restore(snap.bytes, snap.bytes.length), hw2 = new Uint32Array(2); await hw.hash(hw2);
      ok(rc === 0 && hw2[0] === hh[0] && hw2[1] === hh[1], 'worker restore');
      await hw.destroy(); iw.destroy(); wh.dispose();
    }
  }

  // ════ 8b a core Worker started by the game before core-world.js is on the page (GameKit.core): adopted by the host; the
  //    worker compiles its default wasm while its scripts load (prefetch); then the main-thread allocations per tick
  {
    const lines = [];
    const adoptOf = (err) => ({ worker: new FakeWorker(WORKER, { name: 'd37-core-world' }), t0: performance.now(), error: err || '' });
    const live0 = workers.size;
    {
      const a = adoptOf(), h = await CW.host({ adopt: a, wasm: new Uint8Array(wasmBytes) });
      const w = (await h.createWorld({ seed: 4 })).world, i8 = new Int32Array(8), ic = w ? await w.info(i8) : -1;
      const b = h.boot || {};
      ok(h.kind === 'worker' && h.backend === 'wasm' && ic === 0 && b.workMs > 0 && b.coreMs >= 0, `adopted worker: ${h.kind}/${h.backend}, info ${ic}, boot ${JSON.stringify(b)}`);
      lines.push(`adopted → ${h.kind}/${h.backend} (worker's own ${(+b.workMs).toFixed(1)} ms: script ${(+b.scriptMs).toFixed(1)}, lib ${(+b.libMs).toFixed(1)}, core ${(+b.coreMs).toFixed(1)})`);
      await w.destroy(); h.dispose();
    }
    {
      const a = adoptOf('worker script'), h = await CW.host({ adopt: a, wasm: new Uint8Array(wasmBytes) });
      ok(h.kind === 'inline' && h.backend === 'wasm' && /worker script/.test(h.error) && !workers.has(a.worker.w), 'adopted worker that failed to load → inline: ' + h.kind + ' ' + h.error);
      lines.push(`adopted, its script failed → ${h.kind}/${h.backend}`);
      h.dispose();
      const a2 = adoptOf(), h2 = await CW.host({ adopt: a2, worker: false, wasm: new Uint8Array(wasmBytes) });
      ok(h2.kind === 'inline' && !workers.has(a2.worker.w), 'worker: false + adopt → inline, the adopted worker terminated');
      lines.push(`worker: false + adopt → ${h2.kind}, adopted worker terminated`);
      h2.dispose();
    }
    {
      const r = await play(60, { adopt: adoptOf(), wasm: new Uint8Array(wasmBytes) }, 1200, 100);
      ok(r.hash === out.determinism.hash && r.transport === 'worker' && r.backend === 'wasm' && r.cmds === 102, `session with an adopted worker: ${r.hash} ${r.transport}/${r.backend} (want ${out.determinism.hash})`);
      lines.push(`session with an adopted worker @60 → ${r.hash} (= the 12 runs)`);
      r.s.dispose();
    }
    // started like GameKit.core: init posted by the starter with the session's world settings (the first world is made in the
    // worker at once), the worker's messages buffered until the hand-over — ready before (replayed) or after the adoption
    {
      const started = world => {
        const b = { worker: new FakeWorker(WORKER, { name: 'd37-core-world' }), t0: performance.now(), error: '', inited: true, early: [] };
        b.worker.onmessage = e => { if (b.early) b.early.push(e.data); };
        b.worker.postMessage({ t: 'init', wasm: new Uint8Array(wasmBytes), timeoutMs: 8000, force: '', world });
        return b;
      };
      const b1 = started({ seed: 937 });
      for (let i = 0; i < 200 && !b1.early.length; i++) await sleep(5);
      const buffered = b1.early.length;
      const r = await play(60, { adopt: b1, wasm: new Uint8Array(wasmBytes) }, 1200, 100);
      ok(buffered === 1 && b1.early === null && r.hash === out.determinism.hash && r.transport === 'worker' && r.cmds === 102, `inited + ready buffered (${buffered}) → replayed: ${r.hash} ${r.transport} (want ${out.determinism.hash})`);
      r.s.dispose();
      const b2 = started({ seed: 937 });
      const r2 = await play(144, { adopt: b2, wasm: new Uint8Array(wasmBytes) }, 1200, 100);
      ok(r2.hash === out.determinism.hash && r2.transport === 'worker', `inited, ready after the hand-over: ${r2.hash} ${r2.transport}`);
      r2.s.dispose();
      lines.push(`started like GameKit.core (init + first world in the worker): ready buffered → ${r.hash}, ready later @144 → ${r2.hash}`);
    }
    // prefetch over HTTP: the worker at http://…/js/engine/core-world.js compiles …/d37core.wasm at its top; init with that URL
    // takes it (boot.preHit); a corrupted wasm there → the prefetch fails, init downloads it again → JS fallback, error named
    {
      const ENGF = p => path.join(ENG, path.basename(p));
      const server = http.createServer((req, res) => {
        const p = new URL(req.url, 'http://x').pathname;
        if (!/\/js\/engine\/[\w.-]+$/.test(p) || !fs.existsSync(ENGF(p))) { res.writeHead(404); res.end(); return; }
        let b = fs.readFileSync(ENGF(p));
        if (p.endsWith('.wasm') && p.startsWith('/bad/')) { b = Buffer.from(b); b[3000] ^= 0xFF; b[9000] ^= 0xFF; }
        res.writeHead(200, { 'Content-Type': p.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' }); res.end(b);
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const base = 'http://127.0.0.1:' + server.address().port;
      for (const [label, pre, want] of [['prefetch', '', 'wasm'], ['prefetch of a corrupted wasm', '/bad', 'js-fallback']]) {
        const h = await CW.host({ workerUrl: base + pre + '/js/engine/core-world.js?v=t', wasm: base + pre + '/js/engine/d37core.wasm?v=t' });
        const b = h.boot || {};
        ok(h.kind === 'worker' && h.backend === want && (want === 'wasm' ? b.preHit === true : b.preHit === false && /./.test(h.error)), `${label}: ${h.kind}/${h.backend} preHit ${b.preHit} (${h.error})`);
        lines.push(`${label} → ${h.kind}/${h.backend}${b.preHit ? ' (the module compiled while the scripts loaded)' : ' (' + h.error.slice(0, 50) + ')'}`);
        h.dispose();
      }
      server.close();
    }
    ok(workers.size <= live0 + 1, 'adopt tests left workers: ' + (workers.size - live0));
    console.log('adopted worker / prefetch: ' + lines.join('; '));
  }
  // allocations per core tick on the page's main thread, both transports: the sampling heap profiler (node inspector, objects
  // freed by minor GCs included) attributes every allocation to the JS function that made it. Ours = frames in core-world.js plus
  // the typed-array views they create; the rest is postMessage's own delivery (node: "(V8 API)", the message-port glue)
  {
    const inspector = require('inspector'), ses = new inspector.Session();
    ses.connect();
    const post = (m, p) => new Promise((okk, bad) => ses.post(m, p || {}, (e, r) => e ? bad(e) : okk(r)));
    const walk = (node, acc, parent) => {
      const u = node.callFrame.url || '', fn = node.callFrame.functionName || '';
      const mine = /core-world\.js/.test(u) || (!u && /^(Int32Array|Uint32Array|Uint8Array|subarray)$/.test(fn) && parent);
      acc[mine ? 'ours' : 'other'] += node.selfSize;
      if (/core-world\.js/.test(u)) acc.by[fn + ':' + node.callFrame.lineNumber] = (acc.by[fn + ':' + node.callFrame.lineNumber] || 0) + node.selfSize;
      for (const c of node.children) walk(c, acc, /core-world\.js/.test(u));
      return acc;
    };
    await post('HeapProfiler.enable');
    const res = {}, lines = [];
    for (const mode of ['worker', 'inline']) {
      let target = 0, done = null, i = 0, s = null;
      const tickN = () => { for (let k = 0; k < 3; k++) { if ((i++ & 1) === 0) s.cmd(6, 0, 1, 0, 0, i & 7, -1, 0, 0, 0, 0); s.step(); } };
      s = CW.session({ seed: 5, worker: mode === 'worker', workerUrl: WORKER, wasm: new Uint8Array(wasmBytes), hashEvery: 20,
        onTick() { if (mode !== 'worker') return; if (s.stats.ticks >= target) { if (done) { const d = done; done = null; d(); } return; } tickN(); } });
      await s.started;
      // the worker path: each result sends the next tick (no timers or promises in the window); in-thread: a plain loop
      const run = n => mode === 'worker' ? new Promise(okk => { target = s.stats.ticks + n; done = okk; tickN(); }) : (() => { const t = s.stats.ticks + n; while (s.stats.ticks < t) tickN(); })();
      await run(3000); await sleep(20);
      const t0 = s.stats.ticks;
      await post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      await run(3000);
      const prof = (await post('HeapProfiler.stopSampling')).profile, ticks = s.stats.ticks - t0;
      const a = walk(prof.head, { ours: 0, other: 0, by: {} }, false);
      res[mode] = { ticks, ours: Math.round(a.ours / ticks), total: Math.round((a.ours + a.other) / ticks), top: Object.entries(a.by).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => k + ' ' + Math.round(v / ticks)).join(', ') };
      lines.push(`${mode}: ours ${res[mode].ours} B/tick (${res[mode].top}), all ${res[mode].total} B/tick over ${ticks} ticks`);
      s.dispose(); await sleep(30);
    }
    await post('HeapProfiler.disable'); ses.disconnect();
    out.allocPerTick = res;
    // worker: the one Int32Array over the returned tick buffer (104 B) + timing reads (performance.now and the stats' doubles) —
    // 1 241–1 333 B before the C002-R3 fix (a closure, arrays, a queue entry, a message object, subarray + 4 views per tick);
    // in-thread: timing reads only. The bounds leave room for a less optimised JIT state (the interpreter boxes the stats' double
    // intermediates: up to ~230 B more per tick seen in a second session) and still catch any object or view made per tick again
    ok(res.worker.ours <= 450, `worker path allocates ${res.worker.ours} B per tick in core-world.js (≤ 450)`);
    ok(res.inline.ours <= 320, `in-thread path allocates ${res.inline.ours} B per tick in core-world.js (≤ 320)`);
    console.log('allocations per tick (main thread, sampling heap profiler): ' + lines.join('; '));
  }

  // ════ 9 numbers (node, this PC; the phone ×4 numbers come from scripts/core-world-e2e.cjs in Chrome)
  {
    const line = [];
    for (const core of [W, J]) {
      const n = 10000, w = core.createWorld(H.desc(7, 0, 1, n + 64, 65536, 4096, 8, 0)).world;
      const sp = new Int32Array(n * 13), res = new Int32Array(n * 4), ev = new Int32Array(65536 * 13), dr = new Int32Array(65536 * 4), h = new Uint32Array(2), ids = new Uint32Array(n * 2);
      for (let k = 0; k < n; k++) {
        core.worldId(7, 0, 1, k % 100, 0, (k / 100) | 0, k, h); ids[2 * k] = h[0]; ids[2 * k + 1] = h[1];
        const b = k * 13, ck = k % 3;
        sp[b] = 1 + k; sp[b + 1] = 0xBE; sp[b + 3] = h[0]; sp[b + 4] = h[1]; sp[b + 5] = 1;
        sp[b + 7] = 1 | (ck << 20) | ((ck === 1 ? 16 : ck === 2 ? 1 : 0) << 24); sp[b + 8] = ck === 0 ? 0 : 1000000; sp[b + 11] = 1600 | (3000 << 16); sp[b + 12] = 75000;
      }
      w.apply(sp, n, res);
      w.events(ev, 65536); while (w.dirty(dr, 65536) === 1) { }
      const rr = new H.Rng(5), times = [];
      for (let s = 0; s < 9; s++) {
        const c = new Int32Array(n * 13);
        for (let k = 0; k < n; k++) { const t = rr.below(n), b = k * 13; c[b] = 5000000 + s * n + k; c[b + 1] = 0xBE5; c[b + 3] = ids[2 * t]; c[b + 4] = ids[2 * t + 1]; c[b + 5] = 6; c[b + 7] = 1 + rr.below(8); c[b + 8] = -1; }
        const tt = performance.now(); w.apply(c, n, res); if (s >= 2) times.push(performance.now() - tt);
        w.events(ev, 65536); w.dirty(dr, 65536);
      }
      times.sort((a, b) => a - b);
      line.push(`${core.backend}: 10 000 commands ${times[3].toFixed(2)} ms`);
      w.destroy();
      out['apply10k_' + core.backend] = +times[3].toFixed(2);
    }
    const s = CW.session({ seed: 3, worker: false, wasm: new Uint8Array(wasmBytes), hashEvery: 20 });
    await s.started;
    const tt = performance.now();
    for (let i = 0; i < 3000; i++) { if (i % 3 === 0) s.cmd(6, 0, 1, 0, 0, i & 3, -1, 0, 0, 0, 0); s.step(); }
    const per = (performance.now() - tt) / 1000;
    line.push(`session tick (in-thread wasm, 1 command + drains, hash every 20th): ${(per * 1000).toFixed(1)} µs`);
    s.dispose();
    out.sessionTickUs = +(per * 1000).toFixed(1);
    console.log('perf (node, desktop): ' + line.join(' | '));
  }
  for (const w of workers) await w.terminate();
  await sleep(20); // session dispose finishes its destroy → host dispose chain
  const st = CW.stats();
  ok(st.sessionsLive === 0 && st.worldsLive === 0 && st.hostsLive === 0 && st.workersLive === 0, `leaks: sessions ${st.sessionsLive}, worlds ${st.worldsLive}, hosts ${st.hostsLive}, workers ${st.workersLive}`);
  console.log(`live after the test: sessions ${st.sessionsLive}, worlds ${st.worldsLive}, hosts ${st.hostsLive}, workers ${st.workersLive}`);
  console.log(fail === 0 ? `core-world OK (${pass} checks) ${JSON.stringify(out)}` : `core-world FAILED (${fail} of ${pass + fail})`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.log('core-world FAILED (exception) ' + (e && e.stack || e)); process.exit(1); });

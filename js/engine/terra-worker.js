// ═══════════════════════════════════════
//  D37 TERRAIN — worker: builds 32³ blocks with the T1 core (js/engine/terra.wasm, JS fallback terra-core.js)
// ═══════════════════════════════════════
// new Worker('js/engine/terra-worker.js?v=…') — loads terra-core.js with the same ?v=.
// Messages (in): { t: 'init', wasm: url | null, cap } → { t: 'ready', kind: 'wasm' | 'js', err }
//   { t: 'edit', e: [x, y, z, r, mode] } — append (order = the main thread's order)   { t: 'edits', list: Float64Array, n } — replace all
//   { t: 'col', id, seed, cx, cz } → { t: 'col', id, cx, cz, hmin, hmax, ms }
//   { t: 'build', id, seed, cx, cy, cz, ne } (ne — how many edits the main thread had) → { t: 'built', id, q, buf, hmin, hmax, trunc, ms, kind, ne }
//     buf (transferred; null when q = 0): pos f32[q*12] | nrm i8[q*16] | col u8[q*16]   (q*80 bytes from offset 0)
//   { t: 'buf', buf } — the main thread gives a buffer back (pool: no new ArrayBuffer per block in the steady state)
// Messages that arrive before init finished are queued and handled in order afterwards. wasm fails (load, self-test, trap) → the
// JS core takes over and the block is built again — the page never loses a block.
// Loaded as a plain <script> in the window (the game's file list — for the app cache) — does nothing there.
(() => {
  if (typeof window !== 'undefined' || typeof importScripts !== 'function') return;
  const q = (self.location && self.location.search) || '';
  importScripts('terra-core.js' + q);
  const T1 = self.D37E.terraCore;
  let core = null, kind = 'none', ready = false, cap = 24000, fallbacks = 0;
  const waiting = [];
  let ed = new Float64Array(5 * 256), ne = 0;
  const pool = new Map();
  const now = () => (self.performance ? performance.now() : Date.now());
  const cls = n => { let c = 4096; while (c < n) c *= 2; return c; };
  function take(bytes){
    const c = cls(bytes), L = pool.get(c);
    return L && L.length ? L.pop() : new ArrayBuffer(c);
  }
  // wasm == JS on a few points (heights near and 4000 km away, a cave density) — an old or broken wasm is not used
  function selfTest(w){
    const j = T1, pts = [[1337, 10.5, -20.25], [7, 4000123, -3999877], [424242, -1500.75, 777]];
    for (const p of pts) if (w.height(p[0], p[1], p[2]) !== j.height(p[0], p[1], p[2])) return false;
    return w.density(1337, 12, -10, 30, 0) === j.density(1337, 12, -10, 30, null, 0);
  }
  async function init(d){
    cap = d.cap || 24000;
    let err = '';
    if (d.wasm) {
      try {
        const r = await fetch(d.wasm);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const w = await T1.wasm(await r.arrayBuffer(), cap);
        if (!selfTest(w)) { w.dispose(); throw new Error('self-test'); }
        core = w; kind = 'wasm';
      } catch (e) { err = String(e && e.message || e); core = null; }
    }
    if (!core) { core = T1.js(cap); kind = 'js'; }
    ready = true;
    self.postMessage({ t: 'ready', kind, err });
    while (waiting.length) handle(waiting.shift());
  }
  function toJs(e){
    fallbacks++;
    try { core && core.dispose(); } catch (x) {}
    core = T1.js(cap); kind = 'js';
    self.postMessage({ t: 'fallback', kind, err: String(e && e.message || e), fallbacks });
  }
  function build(d){
    const t0 = now(), fox = d.cx * 32, foy = d.cy * 32, foz = d.cz * 32, lim = Math.min(d.ne | 0, ne);
    let n = 0;
    for (let e = 0; e < lim; e++) if (T1.touches(ed, e, fox, foy, foz)) n++;
    const buf = core.edits(n);
    let k = 0;
    for (let e = 0; e < lim && k < n; e++) if (T1.touches(ed, e, fox, foy, foz)) { buf.set(ed.subarray(e * 5, e * 5 + 5), k * 5); k++; }
    const qn = core.build(d.seed, d.cx, d.cy, d.cz, n);
    if (qn < 0) throw new Error('build ' + qn);
    const o = core.out();
    let ab = null;
    if (qn > 0) {
      ab = take(qn * 80);
      new Float32Array(ab, 0, qn * 12).set(o.pos.subarray(0, qn * 12));
      new Int8Array(ab, qn * 48, qn * 16).set(o.nrm.subarray(0, qn * 16));
      new Uint8Array(ab, qn * 64, qn * 16).set(o.col.subarray(0, qn * 16));
    }
    const msg = { t: 'built', id: d.id, q: qn, buf: ab, hmin: o.info[0], hmax: o.info[1], trunc: o.info[3], ms: now() - t0, kind, ne: lim };
    self.postMessage(msg, ab ? [ab] : []);
  }
  function handle(d){
    if (d.t === 'edit') {
      if (ed.length < (ne + 1) * 5) { const a = new Float64Array(ed.length * 2); a.set(ed); ed = a; }
      ed.set(d.e, ne * 5); ne++;
      return;
    }
    if (d.t === 'edits') {
      const n = d.n | 0;
      if (ed.length < n * 5) ed = new Float64Array(Math.max(n * 5, 5 * 256));
      ed.set(d.list.subarray(0, n * 5)); ne = n;
      return;
    }
    if (d.t === 'buf') { const c = d.buf && d.buf.byteLength; if (c) { const L = pool.get(c) || []; if (L.length < 24) L.push(d.buf); pool.set(c, L); } return; }
    if (d.t === 'col') {
      const t0 = now();
      let r;
      try { r = core.colInfo(d.seed, d.cx, d.cz); } catch (e) { toJs(e); r = core.colInfo(d.seed, d.cx, d.cz); }
      const o = core.out();
      self.postMessage({ t: 'col', id: d.id, cx: d.cx, cz: d.cz, hmin: o.info[0], hmax: o.info[1], hit: r, ms: now() - t0 });
      return;
    }
    if (d.t === 'build') {
      try { build(d); }
      catch (e) {
        if (kind === 'wasm') { toJs(e); try { build(d); return; } catch (e2) { e = e2; } }
        self.postMessage({ t: 'built', id: d.id, q: -1, err: String(e && e.message || e), kind });
      }
    }
  }
  self.onmessage = ev => {
    const d = ev.data || {};
    if (d.t === 'init') { init(d); return; }
    if (!ready) { waiting.push(d); return; }
    try { handle(d); } catch (e) { self.postMessage({ t: 'err', id: d.id, err: String(e && e.message || e) }); }
  };
})();

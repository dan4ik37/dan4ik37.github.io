// ═══════════════════════════════════════
//  D37 CORE on the site — js/engine/core-world.js (contract C-002, M:\d37\d37-core\spec\contracts\C-002-site-uses-core.md)
// ═══════════════════════════════════════
// The site's one door to the shared engine core d37-core (the same core Backrooms runs as d37core.dll): the world command /
// event core d37_world_* + the contact law d37_ix_contact (C-001, ABI 5) and the M1 / M2 calls (grid visibility, flow fields).
// The core files are copied from a drop, never edited here: js/engine/d37core.wasm + js/engine/d37core.js = M:\d37\d37-core-release\c1b
// (scripts/core-world-test.cjs checks the SHA256). Bugs go back to the core as a fix + a new drop.
// Classic script (window.D37CoreWorld / self.D37CoreWorld) or CommonJS (node tests). Needs d37core.js (window.D37Core) before the
// first call, not before this file runs (the two load in parallel). Games do not list the core files: GameKit.core (js/games/
// gamekit.js) loads them lazily, only when the flag is on, without holding the game's start.
// Flag: CORE_WASM in js/core/config.js (when false nothing of the core is requested). localStorage d37_core = 'js' forces the JS
// fallback, 'inline' forces no worker (debug).
//
// 1) In-thread core (one per page, cached):   core = await D37CoreWorld.load({ wasm: url | bytes | false, timeoutMs })  — never rejects
//    core.backend 'wasm' | 'js-fallback' (core.error says why), core.fetchMs / initMs, core.pages() (wasm memory pages, 0 on JS)
//    core.createWorld(desc) → { code, world }   desc = 10 words (D37WorldDesc) or { seed, seedHi, genVersion, maxObjects,
//      eventCap, cmdRing, maxActors, reachMm }; world.apply(cmds, n, res) / query / events / dirty (count in world.count) /
//      read / step / info / hash / snapshot (length in world.len) / restore / destroy — the d37core.js world, unchanged:
//      structs are Int32Array words laid out as the C structs (core.W = words per struct, core.C = constants), ids are u32
//      (lo, hi) pairs, no object is created per call. A wasm trap never throws: -100 (E_PANIC) and the world is dead.
//    core.contact(inWords, n, outWords), core.worldId(...), core.childId(...), core.h32, core.digest, core.smState/smStep/smBelowS
//    M1 / M2 (wasm only; core.has.grid / core.has.flow; on the JS fallback they return E_UNSUPPORTED −101 — the core has no JS
//    port of grid / flow yet, only C#): core.createGrid(desc4, edgesU8, layersU8|null, costU8|null, linksWords, nlinks, valWords)
//    → { code, grid }; core.createFlow(grid, desc4) → { code, flow } (see "M1 / M2" below for the word layouts).
// 2) Worker transport (addendum §3.4: the wasm runs single-threaded inside a dedicated Worker — this same file started with
//    the Worker name 'd37-core-world', it loads d37core.js next to itself; postMessage with transferable
//    ArrayBuffers, no SharedArrayBuffer / COOP / COEP — ads and YouTube iframes keep working):
//    host = await D37CoreWorld.host({ worker: true, adopt })  — never rejects; host.kind 'worker' | 'inline' (no Worker or it
//    failed → the same API in-thread), host.backend, host.error, host.boot (where the start time went). adopt = { worker, t0,
//    error } — a core Worker the game already started (GameKit.core). The worker compiles its wasm while its scripts load.
//    hw = (await host.createWorld(desc)).world; hw.tick(cmds, n, steps, cb, wantHash) → cb(r) once, in order: r = { code, res,
//      step, evCode, evN, ev, drCode, drN, dr, hash, ms } (res / ev / dr — the world's own arrays, valid only inside cb, read by
//      the counts n / evN / drN); hw.query / read / info / hash / snapshot / restore / destroy → Promise.
// 3) Game adapter: s = D37CoreWorld.session({ seed, sender, onReset(s), onTick(r, cmds, n), t0, adopt }) — call s.step() once per fixed
//    game step (E.loop, 60 Hz): every 3rd step is one core tick (20 Hz, identical at 30 / 60 / 144 FPS); s.cmd(op, actor, tLo,
//    tHi, expectedVer, p0..p5) queues a command (id: hi = sender, lo = counter); onReset(s) runs whenever the world is (re)created
//    (start, worker crash, wasm trap) — the game re-sends its objects there; s.line() — the debug panel text; s.dispose().
//    D37CoreWorld.worldId(seedLo, seedHi, genVersion, rx, ry, rz, index, out2) / childId(...) — stable ids at once (bit-exact JS).
// Codes of this file (outside the core's own): −101 E_UNSUPPORTED (no grid / flow on the JS fallback, no d37core.js), −102 E_DEAD_HOST
// (the worker is gone). Counters: D37CoreWorld.stats() (live sessions / worlds / hosts / workers, fallbacks, resets) — leak tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root, require('./d37core.js'));
  else root.D37CoreWorld = factory(root, null);
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (root, req) {
  'use strict';
  var ABI = 5, E_UNSUPPORTED = -101, E_PANIC = -100, E_DEAD_HOST = -102;
  var now = function () { return root.performance && root.performance.now ? root.performance.now() : Date.now(); };
  var base = function () { return req || root.D37Core || null; };
  var ver = function () { try { return typeof GAMES_VER !== 'undefined' ? GAMES_VER : ''; } catch (e) { return ''; } };
  var url = function (name) { var v = ver(); return 'js/engine/' + name + (v ? '?v=' + v : ''); };
  var absUrl = function (u) {
    try { return new URL(u, (root.document && root.document.baseURI) || (root.location && root.location.href) || 'http://x/').href; } catch (e) { return u; }
  };
  // the worker runs this same file, started with the Worker name WORKER_NAME (→ it loads d37core.js next to itself and serves; one
  // fetch less than a separate entry file). The mark is the name, not the URL: the URL stays the game's own <script> URL (sw.js
  // keeps one cache entry per path and drops other query strings, so a second query would evict the page's copy on every open;
  // a #fragment does not reach a worker's location in Chrome)
  var WORKER_NAME = 'd37-core-world';
  var workerUrl = function () { return url('core-world.js'); };
  var ls = function (k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  // a silent fallback must be visible (addendum §3.4): one errlog entry per kind per page (window.d37Err, api/_lib/errlog.js)
  var told = {};
  function tell(kind, why) {
    S.fallbacks++;
    if (told[kind]) return;
    told[kind] = 1;
    try { if (typeof root.d37Err === 'function') root.d37Err('core-world: ' + kind, new Error(String(why || '').slice(0, 120))); } catch (e) {}
    try { if (root.console && console.warn) console.warn('[d37 core] ' + kind + (why ? ': ' + why : '')); } catch (e) {}
  }
  // counters for tests / the debug panel (no objects per call)
  var S = { loads: 0, fallbacks: 0, worldsLive: 0, hostsLive: 0, workersLive: 0, sessionsLive: 0, resets: 0, ticks: 0 };

  // ════════════════════════════════════ 1) in-thread core
  // one load per source and page (a URL or "off"; raw bytes are never cached): every game open reuses the compiled instance
  var cache = {};
  function load(opts) {
    opts = opts || {};
    var src = opts.wasm === undefined ? url('d37core.wasm') : opts.wasm, force = opts.force || ls('d37_core') || '';
    var key = typeof src === 'string' ? force + '|' + src : (src === false || src === null) ? force + '|off' : '';
    if (key && !opts.fresh && cache[key]) return cache[key];
    var p = loadOnce(opts, src, force);
    if (key && !opts.fresh) cache[key] = p;
    return p;
  }
  function loadOnce(opts, src, force) {
    S.loads++;
    var t0 = now(), B = base();
    if (!B) return Promise.resolve(deadCore('d37core.js missing', t0));
    if (force === 'js') src = false;
    if (src === false || src === null) return Promise.resolve(makeCore(B.js, force === 'js' ? 'forced (d37_core = js)' : 'wasm off', t0, 0, t0));
    var ms = opts.timeoutMs || 8000, timer = 0, ac = null;
    var fetched = typeof src !== 'string' ? Promise.resolve(src) : new Promise(function (ok, bad) {
      timer = setTimeout(function () { try { if (ac) ac.abort(); } catch (e) {} bad(new Error('wasm timeout ' + ms + ' ms')); }, ms);
      var go = function () {
        try { ac = typeof AbortController === 'function' ? new AbortController() : null; } catch (e) { ac = null; }
        fetch(src, ac ? { signal: ac.signal } : undefined).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          // application/wasm (Vercel, the test servers): compile while downloading, off the main thread → a WebAssembly.Module;
          // otherwise the bytes (d37core.js compiles them). A compile error → the JS core, as with bad bytes.
          var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
          if (typeof WebAssembly === 'object' && typeof WebAssembly.compileStreaming === 'function' && /application\/wasm/i.test(ct)) return WebAssembly.compileStreaming(r);
          return r.arrayBuffer();
        }).then(ok, bad);
      };
      // opts.module: a Promise of this URL's WebAssembly.Module, already compiling (the worker starts it before its scripts load,
      // § 2). It failing → the normal download, which then names the error (HTTP 404, compile error, …); the timeout covers both
      if (opts.module && typeof opts.module.then === 'function') opts.module.then(ok, go); else go();
    });
    var tf = 0;
    return fetched.then(function (bytes) {
      clearTimeout(timer);
      tf = now();
      return B.load(bytes).then(function (api) { return makeCore(api, api.backend === 'wasm' ? '' : api.error || 'wasm failed', t0, tf - t0, tf); });
    }, function (err) {
      clearTimeout(timer);
      return makeCore(B.js, String(err && err.message || err), t0, now() - t0, now());
    }).catch(function (err) {
      return makeCore(B.js, 'core-world: ' + String(err && err.message || err), t0, now() - t0, now());
    });
  }
  function deadCore(why, t0) {
    var no = function () { return E_UNSUPPORTED; };
    tell('no core', why);
    return { backend: 'none', error: why, abi: 0, fetchMs: 0, initMs: 0, totalMs: now() - t0, has: { world: false, contact: false, grid: false, flow: false },
      createWorld: function () { return { code: E_UNSUPPORTED, world: null }; }, contact: no, worldId: no, childId: no,
      createGrid: function () { return { code: E_UNSUPPORTED, grid: null }; }, createFlow: function () { return { code: E_UNSUPPORTED, flow: null }; },
      pages: function () { return 0; }, W: null, C: null };
  }
  // the session's world settings → the 10 words; the session and the worker's first world (init.world) use the same defaults
  function sessionDesc(o) {
    o = o || {};
    return descWords(o.desc || { seed: o.seed | 0, seedHi: o.seedHi | 0, genVersion: o.genVersion == null ? 1 : o.genVersion,
      maxObjects: o.maxObjects || 1024, eventCap: o.eventCap || 1024, cmdRing: o.cmdRing || 1024, maxActors: o.maxActors || 16, reachMm: o.reachMm || 0 });
  }
  function descWords(d) {
    if (!d) return new Int32Array(10);
    if (d.length === 10) return d instanceof Int32Array ? d : Int32Array.from(d);
    var w = new Int32Array(10);
    w[0] = d.seed | 0; w[1] = d.seedHi | 0; w[2] = d.genVersion == null ? 1 : d.genVersion | 0; w[3] = d.maxObjects | 0; w[4] = d.eventCap | 0;
    w[5] = d.cmdRing | 0; w[6] = d.maxActors | 0; w[7] = d.reachMm | 0;
    return w;
  }
  function makeCore(api, error, t0, fetchMs, t1) {
    var wasm = api.backend === 'wasm', e = wasm ? api.exports : null;
    if (!wasm) tell('js-fallback', error);
    var core = {
      backend: wasm ? 'wasm' : 'js-fallback', error: error || '', abi: api.abi, fetchMs: fetchMs, initMs: now() - t1, totalMs: now() - t0,
      W: api.W, C: api.C, STRUCT_SIZES: api.STRUCT_SIZES, raw: api,
      h32: api.h32, digest: api.digest, smState: api.smState, smStep: api.smStep, smBelowS: api.smBelowS,
      has: { world: true, contact: true, grid: wasm, flow: wasm },
      createWorld: function (d) {
        var r;
        try { r = api.createWorld(descWords(d)); } catch (err) { return { code: E_PANIC, world: null, error: String(err && err.message || err) }; }
        if (r.world) { S.worldsLive++; wrapDestroy(r.world); }
        return r;
      },
      contact: function (inp, n, out) { try { return api.contact(inp, n, out); } catch (err) { return E_PANIC; } },
      worldId: api.worldId, childId: api.childId,
      pages: function () { try { return wasm ? e.memory.buffer.byteLength / 65536 : 0; } catch (x) { return 0; } },
      createGrid: function () { return { code: E_UNSUPPORTED, grid: null }; },
      createFlow: function () { return { code: E_UNSUPPORTED, flow: null }; }
    };
    if (wasm) m12(core, e);
    return core;
  }
  function wrapDestroy(w) {
    var d = w.destroy, done = false;
    w.destroy = function () { if (!done) { done = true; S.worldsLive--; } return d.call(w); };
  }

  // ════════════════════════════════════ M1 / M2 over the wasm exports (ABI 4 calls, unchanged in ABI 5)
  // Word layouts (Int32Array unless noted; u8 / u16 fields packed low to high, as the C structs):
  //   GridDesc 4: width, height, layers, flags.  Link 3: a, b, cost | flags << 16.  GridValidation 8 (out).  GridInfo 8 (out).
  //   EdgeChange 2: cell, side | value << 8.  CostChange 2: cell, cost.  CellPair 2: a, b.
  //   VisResult 4 (out): visible | flags << 8 | doors << 16 | status << 24, first_door, manhattan, euclid_q8.
  //   FlowDesc 4: slots, max_goals, flags, 0.  FlowGoal 2: cell, cost.  FlowParams 12 (API.md: kind, tag, closed_door_cost,
  //   max_dist, flee_num, flee_den, link_deny, flee_flags, mover, threat_mover, belief, 0).  FlowStepOut 4 (out).  FlowInfo 8
  //   (out).  D37Mover 11: open_cost | door_cost[0] << 16, door_cost[1] | [2] << 16, …, prior_glass | link_deny << 16 | flags << 24.
  //   Edges / classes / belief / flow dir: Uint8Array (4 per cell, dir 1 per cell); flow dist: Uint32Array or Int32Array.
  // Every call copies into wasm scratch buffers (grown on first use, then reused) and checks memory.buffer identity before each
  // copy, so a memory.grow inside any call (a create, a bigger buffer) never leaves a stale view. A trap → −100, object dead.
  function m12(core, e) {
    var V = { buf: null, u8: null, i32: null };
    function v() { if (V.buf !== e.memory.buffer) { V.buf = e.memory.buffer; V.u8 = new Uint8Array(V.buf); V.i32 = new Int32Array(V.buf); } }
    function Scr() { this.p = {}; this.c = {}; }
    Scr.prototype.get = function (k, bytes) {
      var c = this.c[k] || 0;
      if (c < bytes) { if (c) e.d37_free(this.p[k], c); var n = Math.max(64, bytes + 4); this.p[k] = e.d37_alloc(n); this.c[k] = n; }
      return this.p[k];
    };
    Scr.prototype.free = function () { for (var k in this.c) if (this.c[k]) { e.d37_free(this.p[k], this.c[k]); this.c[k] = 0; } };
    function putW(src, words, p) { v(); var h = V.i32, b = p >> 2; for (var i = 0; i < words; i++) h[b + i] = src[i]; }
    function getW(dst, words, p) { v(); var h = V.i32, b = p >> 2; for (var i = 0; i < words; i++) dst[i] = h[b + i]; }
    function putB(src, n, p) { v(); var h = V.u8; for (var i = 0; i < n; i++) h[p + i] = src[i]; }
    function getB(dst, n, p) { v(); var h = V.u8; for (var i = 0; i < n; i++) dst[i] = h[p + i]; }
    function rd(p) { v(); return V.i32[p >> 2]; }
    function dead(o, err) { o.dead = true; o.error = String(err && err.message || err); return E_PANIC; }

    function Grid(ptr, cells) { this.ptr = ptr; this.cells = cells; this.s = new Scr(); this.dead = false; this.error = ''; this.count = 0; this.flows = 0; }
    var G = Grid.prototype;
    function gcall(g, f) { if (g.dead || !g.ptr) return E_PANIC; try { return f(); } catch (err) { return dead(g, err); } }
    function change2(name, fn) {
      return function (ch, n) {
        var g = this;
        return gcall(g, function () { var p = g.s.get(name, n * 8); putW(ch, n * 2, p); return fn(g.ptr, p, n); });
      };
    }
    G.setEdges = change2('ed', function (g, p, n) { return e.d37_grid_set_edges(g, p, n); });
    G.setCosts = change2('co', function (g, p, n) { return e.d37_grid_set_costs(g, p, n); });
    G.setClasses = change2('cl', function (g, p, n) { return e.d37_grid_set_classes(g, p, n); });
    G.setLinks = function (idx, flags, n) {
      var g = this;
      return gcall(g, function () { var pi = g.s.get('li', n * 4), pf = g.s.get('lf', n); putW(idx, n, pi); putB(flags, n, pf); return e.d37_grid_set_links(g.ptr, pi, pf, n); });
    };
    function exp4(fn) {
      return function (out) {
        var g = this;
        return gcall(g, function () { var n = g.cells * 4, p = g.s.get('ex', n); var r = fn(g.ptr, p, n); if (r === 0) getB(out, n, p); return r; });
      };
    }
    G.getEdges = exp4(function (g, p, n) { return e.d37_grid_get_edges(g, p, n); });
    G.getClasses = exp4(function (g, p, n) { return e.d37_grid_get_classes(g, p, n); });
    G.info = function (out) { var g = this; return gcall(g, function () { var p = g.s.get('in', 32); var r = e.d37_grid_info(g.ptr, p); getW(out, 8, p); return r; }); };
    G.visQuery = function (pairs, n, maxDistQ8, flags, out) {
      var g = this;
      return gcall(g, function () {
        var pp = g.s.get('vp', n * 8), po = g.s.get('vo', n * 16);
        putW(pairs, n * 2, pp);
        var r = e.d37_vis_query(g.ptr, pp, n, maxDistQ8 >>> 0, flags >>> 0, po);
        if (r === 0) getW(out, n * 4, po);
        return r;
      });
    };
    G.visList = function (cell, radiusQ8, flags, out, cap) {
      var g = this;
      return gcall(g, function () {
        var po = g.s.get('vl', cap * 4), pc = g.s.get('vc', 4);
        var r = e.d37_vis_list(g.ptr, cell | 0, radiusQ8 >>> 0, flags >>> 0, po, cap, pc);
        var k = rd(pc) >>> 0;
        g.count = k;
        getW(out, Math.min(k, cap), po);
        return r;
      });
    };
    G.destroy = function () {
      if (!this.ptr) return -1;
      if (this.dead) { this.ptr = 0; return E_PANIC; }
      var r;
      try { r = e.d37_grid_destroy(this.ptr); } catch (err) { this.ptr = 0; return dead(this, err); }
      if (r === 0) { this.ptr = 0; this.s.free(); }
      return r; // E_BUSY (−7) while flows are attached: destroy them first
    };
    core.createGrid = function (desc, edges, layers, costs, links, nlinks, val) {
      var s = new Scr();
      try {
        var w = desc[0] >>> 0, h = desc[1] >>> 0, l = desc[2] >>> 0, plane = w * h, cells = plane * l;
        if (!w || !h || !l || w > 256 || h > 256 || l > 8) return { code: -2, grid: null };
        var pd = s.get('d', 16), pe = s.get('e', cells * 4), pl = layers ? s.get('l', plane) : 0, pc = costs ? s.get('c', cells) : 0;
        var pk = s.get('k', nlinks * 12), pv = s.get('v', 32), po = s.get('o', 4);
        putW(desc, 4, pd); putB(edges, cells * 4, pe);
        if (layers) putB(layers, plane, pl);
        if (costs) putB(costs, cells, pc);
        putW(links, nlinks * 3, pk);
        var r = e.d37_grid_create(pd, pe, pl, pc, pk, nlinks, pv, po);
        if (val) getW(val, 8, pv);
        var ptr = rd(po);
        s.free();
        return r === 0 ? { code: 0, grid: new Grid(ptr, cells) } : { code: r, grid: null };
      } catch (err) { return { code: E_PANIC, grid: null, error: String(err && err.message || err) }; }
    };

    function Flow(ptr, grid) { this.ptr = ptr; this.grid = grid; this.cells = grid.cells; this.s = new Scr(); this.dead = false; this.error = ''; this.slot = -1; }
    var F = Flow.prototype;
    function fcall(f, fn) { if (f.dead || !f.ptr) return E_PANIC; try { return fn(); } catch (err) { return dead(f, err); } }
    F.acquire = function (goals, n, params) {
      var f = this;
      return fcall(f, function () {
        var pg = f.s.get('g', n * 8), pp = f.s.get('p', 48), po = f.s.get('o', 4);
        putW(goals, n * 2, pg); putW(params, 12, pp);
        var r = e.d37_flow_acquire(f.ptr, pg, n, pp, po);
        f.slot = rd(po);
        return r;
      });
    };
    F.retarget = function (slot, goals, n, params) {
      var f = this;
      return fcall(f, function () { var pg = f.s.get('g', n * 8), pp = f.s.get('p', 48); putW(goals, n * 2, pg); putW(params, 12, pp); return e.d37_flow_retarget(f.ptr, slot | 0, pg, n, pp); });
    };
    F.release = function (slot) { var f = this; return fcall(f, function () { return e.d37_flow_release(f.ptr, slot | 0); }); };
    F.step = function (budget, out) {
      var f = this;
      return fcall(f, function () { var po = f.s.get('so', 16); var r = e.d37_flow_step(f.ptr, budget | 0, po); if (out) getW(out, 4, po); return r; });
    };
    F.sample = function (slot, cells, n, dir, dist) {
      var f = this;
      return fcall(f, function () {
        var pc = f.s.get('sc', n * 4), pd = f.s.get('sd', n), pt = dist ? f.s.get('st', n * 4) : 0;
        putW(cells, n, pc);
        var r = e.d37_flow_sample(f.ptr, slot | 0, pc, n, pd, pt);
        getB(dir, n, pd);
        if (dist) getW(dist, n, pt);
        return r;
      });
    };
    F.read = function (slot, dir, dist) {
      var f = this;
      return fcall(f, function () {
        var n = f.cells, pd = dir ? f.s.get('rd', n) : 0, pt = dist ? f.s.get('rt', n * 4) : 0;
        var r = e.d37_flow_read(f.ptr, slot | 0, pd, pt, n);
        if (dir) getB(dir, n, pd);
        if (dist) getW(dist, n, pt);
        return r;
      });
    };
    F.info = function (slot, out) { var f = this; return fcall(f, function () { var p = f.s.get('in', 32); var r = e.d37_flow_info(f.ptr, slot | 0, p); getW(out, 8, p); return r; }); };
    F.setMover = function (id, m) { var f = this; return fcall(f, function () { var p = f.s.get('mv', 44); putW(m, 11, p); return e.d37_flow_set_mover(f.ptr, id >>> 0, p); }); };
    F.setBelief = function (group, ch, n) {
      var f = this;
      return fcall(f, function () { var p = f.s.get('bc', n * 8); putW(ch, n * 2, p); return e.d37_flow_set_belief(f.ptr, group >>> 0, p, n); });
    };
    F.clearBelief = function (group) { var f = this; return fcall(f, function () { return e.d37_flow_clear_belief(f.ptr, group >>> 0); }); };
    F.getBelief = function (group, out) {
      var f = this;
      return fcall(f, function () { var n = f.cells * 4, p = f.s.get('bo', n); var r = e.d37_flow_get_belief(f.ptr, group >>> 0, p, n); if (r >= 0) getB(out, n, p); return r; });
    };
    F.destroy = function () {
      if (!this.ptr) return -1;
      if (this.dead) { this.ptr = 0; return E_PANIC; }
      var r;
      try { r = e.d37_flow_destroy(this.ptr); } catch (err) { this.ptr = 0; return dead(this, err); }
      this.ptr = 0; this.s.free(); this.grid.flows--;
      return r;
    };
    core.createFlow = function (grid, desc) {
      if (!grid || !grid.ptr || grid.dead) return { code: -1, flow: null };
      var s = new Scr();
      try {
        var pd = s.get('d', 16), po = s.get('o', 4);
        putW(desc, 4, pd);
        var r = e.d37_flow_create(grid.ptr, pd, po), ptr = rd(po);
        s.free();
        if (r !== 0) return { code: r, flow: null };
        grid.flows++;
        return { code: 0, flow: new Flow(ptr, grid) };
      } catch (err) { return { code: E_PANIC, flow: null, error: String(err && err.message || err) }; }
    };
  }

  // ════════════════════════════════════ 2) worker transport
  // Messages (main → worker): { t: 'init', wasm, timeoutMs, force, world } → { t: 'ready', backend, error, fetchMs, initMs, abi,
  //   pages, first: [code, handle] (when init.world: the first world, made at once), start times (topMs, libMs, initAt, readyAt,
  //   origin, preHit) }. One init per worker: the host posts it, or the game's starter does (GameKit.core, js/games/gamekit.js —
  //   at once, before this file is on the page: then the host adopts the worker and replays what it has already said, adopt.early)
  //   { t: 'call', id, m, h, a: [numbers], b: [ArrayBuffer…] } → { t: 'r', id, r: code, x: [numbers], b: [the same buffers back] }
  //   m: create (b0 desc) → x [handle] | tick (b [one tick buffer, layout TB below]; in / out words in its header) | query (a n;
  //   b q, out) | read (a n; b ids, out) | info (b out) | hash → x [lo, hi] | snapshot → x [len], b [bytes] | restore (a len;
  //   b bytes) | contact (a n; b in, out) | destroy | pages → x [pages]
  // Tick buffer TB (Int32 words): header 16 — [0] n, [1] steps, [2] event cap, [3] dirty cap, [4] want hash (in); [5] code,
  //   [6] step, [7] evCode, [8] evN, [9] drCode, [10] drN, [11] hash lo, [12] hash hi, [13] tick µs (out); [14] nCap, [15] evCapL
  //   (the layout) — then commands nCap × 13, results nCap × 4, events evCapL × 13, dirty (the rest) × 4.
  // The worker answers in order; every buffer goes there and back (transferred, never copied).
  var TB_HEAD = 16;
  function serve(scope, boot) {
    boot = boot || {};
    var core = null, ready = false, waiting = [], worlds = [null];
    var h2 = new Uint32Array(2), RE = { t: 'r', id: 0, r: 0, x: null, b: null }, NB = [];
    function post(m, tr) { try { scope.postMessage(m, tr || NB); } catch (err) {} }
    // one reply object, reused (postMessage copies it at once)
    function answer(d, r, x, b) { RE.id = d.id; RE.r = r; RE.x = x || null; RE.b = b || null; post(RE, b || NB); RE.x = null; RE.b = null; }
    function I(b) { return b ? new Int32Array(b) : null; }
    function handle(d) {
      if (d.t !== 'call') return;
      var b = d.b || NB, a = d.a || NB, w = worlds[d.h | 0] || null;
      try {
        switch (d.m) {
          case 'create': {
            var r = core.createWorld(I(b[0]));
            var h = 0;
            if (r.world) { h = worlds.length; worlds.push(r.world); }
            answer(d, r.code, [h], b);
            return;
          }
          case 'contact': answer(d, core.contact(I(b[0]), a[0], I(b[1])), null, b); return;
          case 'pages': answer(d, 0, [core.pages()], null); return;
        }
        if (!w) { answer(d, -1, null, b); return; }
        switch (d.m) {
          case 'tick': {
            // one buffer per tick (TB): the views below are the only objects this tick makes here (off the page's thread)
            var t0 = now(), V = new Int32Array(b[0]), n = V[0], nCap = V[14], ro = TB_HEAD + nCap * 13, eo = ro + nCap * 4, dq = eo + V[15] * 13;
            var code = n ? w.apply(V.subarray(TB_HEAD, TB_HEAD + n * 13), n, V.subarray(ro, eo)) : 0;
            var st = code >= 0 && V[1] ? w.step(V[1]) : 0;
            var evc = w.events(V.subarray(eo, dq), V[2]), evn = w.count;
            var drc = w.dirty(V.subarray(dq), V[3]), drn = w.count;
            V[5] = code; V[6] = st; V[7] = evc; V[8] = evn; V[9] = drc; V[10] = drn; V[11] = 0; V[12] = 0;
            if (V[4]) { w.hash(h2); V[11] = h2[0] | 0; V[12] = h2[1] | 0; }
            V[13] = Math.round((now() - t0) * 1000);
            answer(d, code, null, b);
            return;
          }
          case 'query': answer(d, w.query(I(b[0]), a[0], I(b[1])), null, b); return;
          case 'read': answer(d, w.read(I(b[0]), a[0], I(b[1])), null, b); return;
          case 'info': answer(d, w.info(I(b[0])), null, b); return;
          case 'hash': { var c = w.hash(h2); answer(d, c, [h2[0], h2[1]], null); return; }
          case 'snapshot': {
            w.snapshot(null);
            var len = w.len, out = new Uint8Array(len), sc = w.snapshot(out);
            answer(d, sc, [len], [out.buffer]);
            return;
          }
          case 'restore': answer(d, w.restore(new Uint8Array(b[0]), a[0]), null, b); return;
          case 'destroy': { var dc = w.destroy(); worlds[d.h | 0] = null; answer(d, dc, null, null); return; }
        }
        answer(d, -2, null, b);
      } catch (err) { answer(d, E_PANIC, null, b); }
    }
    var inited = false;
    scope.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.t === 'init') {
        if (inited) return; // one init per worker (the starter's, GameKit.core, or the host's)
        inited = true;
        var tInit = now(); // ms since the worker started (the worker clock)
        // the default wasm is already compiling (started at the top of this file, § worker entry): take it for the same URL
        var hit = false, pre = boot.pre && typeof d.wasm === 'string' && d.wasm === boot.pre.url && d.force !== 'js' ? boot.pre.p.then(function (m) { hit = true; return m; }) : null;
        load({ wasm: d.wasm === null ? false : d.wasm, timeoutMs: d.timeoutMs, force: d.force, module: pre }).then(function (c) {
          core = c; ready = true;
          // init.world (the session's settings, sessionDesc): the first world is made here at once, its handle goes with ready
          var first = null;
          if (d.world) {
            try { var fr = c.createWorld(sessionDesc(d.world)), fh = 0; if (fr.world) { fh = worlds.length; worlds.push(fr.world); } first = [fr.code, fh]; }
            catch (err) { first = [E_PANIC, 0]; }
          }
          post({ t: 'ready', backend: c.backend, error: c.error, fetchMs: c.fetchMs, initMs: c.initMs, abi: c.abi, pages: c.pages(), topMs: boot.topMs || 0,
            libMs: boot.libMs || 0, initAt: tInit, readyAt: now(), preHit: hit, first: first, origin: root.performance && root.performance.timeOrigin || 0 });
          while (waiting.length) handle(waiting.shift());
        });
        return;
      }
      if (!ready) waiting.push(d); else handle(d);
    };
  }

  // the host side: one Worker (or the in-thread core) per host; calls resolve in order. No getters on per-host / per-world
  // objects (T-085: an own getter keeps the last closed game alive through the shared object shape) — plain fields only.
  // opts.adopt = { worker, t0, error, inited, early }: a core Worker the game already started before this file was on the page
  // (GameKit.core, js/games/gamekit.js: the worker starts at once, in parallel with the page loading d37core.js + core-world.js);
  // error — its script failed to load before the hand-over; inited — the starter already posted init (with world = the session's
  // settings: the first world is made in the worker at once); early — the worker's messages so far (buffered by the starter),
  // replayed here in order, so nothing is lost.
  function host(opts) {
    opts = opts || {};
    var boot = opts.adopt && opts.adopt.worker ? opts.adopt : null;
    var noWorker = typeof root.Worker !== 'function' || !root.document;
    var want = opts.worker !== false && ls('d37_core') !== 'inline' && (!noWorker || !!boot);
    if (!want) {
      if (boot) { try { boot.worker.terminate(); } catch (e) {} }
      if (noWorker && opts.worker !== false) tell('no worker', 'Worker unavailable');
      return inlineHost(opts, opts.worker === false || !noWorker ? '' : 'no worker');
    }
    return new Promise(function (resolve) {
      var t0 = boot && boot.t0 || now(), w = null, done = false, timer = 0, H = null;
      var fail = function (why) {
        if (done) return;
        done = true; clearTimeout(timer);
        if (H) H._stop(); else if (w) { try { w.terminate(); } catch (e) {} S.workersLive--; }
        tell('worker failed', why);
        resolve(inlineHost(opts, 'worker: ' + why));
      };
      try {
        w = boot ? boot.worker : new root.Worker(opts.workerUrl || workerUrl(), { name: WORKER_NAME });
        S.workersLive++;
      } catch (err) { w = null; fail(String(err && err.message || err)); return; }
      H = workerHost(w, t0);
      H.onReady = function () { if (done) return; done = true; clearTimeout(timer); resolve(H); };
      H.onDead = function (why) { if (!done) fail(why); };
      if (boot && boot.error) { fail(boot.error); return; }
      timer = setTimeout(function () { fail('no ready in ' + (opts.readyMs || 10000) + ' ms'); }, opts.readyMs || 10000);
      if (boot && boot.inited) {
        // the first world comes with ready (init.world); then what the worker said before the hand-over, in order
        H.first = new Promise(function (ok) { H._first = ok; });
        var early = boot.early || [];
        boot.early = null;
        for (var i = 0; i < early.length; i++) w.onmessage({ data: early[i] });
        return;
      }
      // the wasm: an absolute URL (the worker resolves relative to its own folder), raw bytes (tests) or none (JS core)
      var wasm = opts.wasm === false ? null : (typeof opts.wasm === 'string' || opts.wasm == null) ? absUrl(opts.wasm || url('d37core.wasm')) : opts.wasm;
      try { w.postMessage({ t: 'init', wasm: wasm, timeoutMs: opts.timeoutMs || 8000, force: opts.force || ls('d37_core') || '' }); }
      catch (err) { fail(String(err && err.message || err)); return; }
      // the first world goes with init (the worker queues calls until its core is loaded): one round trip less at start
      if (opts.desc) H.first = H.createWorld(opts.desc);
    });
  }
  // the worker side of a host; calls made before 'ready' are posted at once and wait in the worker
  function workerHost(w, t0) {
    S.hostsLive++;
    // calls in flight: a ring (ids, callbacks, one argument each) — no object per call; it doubles when full (rare: > 256 in flight)
    var seq = 0, RN = 256, qi = new Int32Array(RN), qc = new Array(RN), qa = new Array(RN), qh = 0, qt = 0, H;
    function enq(id, cb, arg) {
      if (qt - qh >= RN) {
        var n2 = RN * 2, i2 = new Int32Array(n2), c2 = new Array(n2), a2 = new Array(n2), k = 0;
        for (var j = qh; j < qt; j++, k++) { i2[k] = qi[j % RN]; c2[k] = qc[j % RN]; a2[k] = qa[j % RN]; }
        qi = i2; qc = c2; qa = a2; qh = 0; qt = k; RN = n2;
      }
      var p = qt % RN; qi[p] = id; qc[p] = cb; qa[p] = arg; qt++;
    }
    function unq() { qt--; var p = qt % RN; qc[p] = null; qa[p] = null; }
    // the rare calls (create, query, read, info, hash, snapshot, restore, destroy, contact, pages): a message each
    function call(m, h, a, b, cb) {
      if (H.dead) { cb(E_DEAD_HOST, null, null, null); return; }
      var id = ++seq;
      enq(id, cb, null);
      try { w.postMessage({ t: 'call', id: id, m: m, h: h, a: a, b: b }, b || []); }
      catch (err) { unq(); cb(E_PANIC, null, null, null); }
    }
    // a tick: the world's own message object and transfer list, reused (postMessage copies them at once) — nothing allocated here
    function send(msg, tl, cb, arg) {
      if (H.dead) { cb(E_DEAD_HOST, null, null, arg); return; }
      var id = ++seq;
      msg.id = id;
      enq(id, cb, arg);
      try { w.postMessage(msg, tl); }
      catch (err) { unq(); cb(E_PANIC, null, null, arg); }
    }
    w.onmessage = function (ev) {
      var d = ev.data || {};
      if (d.t === 'ready') {
        H.backend = d.backend; H.error = d.error || ''; H.fetchMs = d.fetchMs; H.initMs = d.initMs; H.abi = d.abi; H.readyMs = now() - t0; H.ready = true;
        // where the start time goes (page clock): Chrome starts the thread (spawn), its own script (core-world.js) and d37core.js
        // load there, it waits for init (the page loads its copy of the scripts meanwhile), its core is ready, the page gets it.
        // workMs = what the worker itself runs (script + lib + core): the part a slower phone CPU multiplies (CDP cannot throttle
        // a worker: "Operation is only supported for pages, not workers")
        var po = root.performance && root.performance.timeOrigin || 0;
        if (d.origin && po) {
          var ws = d.origin - po, lib = d.libMs - d.topMs, core = d.readyAt - d.initAt;
          H.boot = { spawnMs: ws - t0, scriptMs: d.topMs, libMs: lib, waitMs: Math.max(0, d.initAt - d.libMs), coreMs: core, deliverMs: now() - (ws + d.readyAt),
            workMs: d.topMs + lib + core, preHit: !!d.preHit };
        }
        if (d.backend !== 'wasm') tell('js-fallback', d.error);
        if (H._first) {
          var ok = H._first, f = d.first;
          H._first = null;
          ok(f ? (f[0] === 0 && f[1] ? { code: 0, world: new WorkerWorld(H, f[1]) } : { code: f[0], world: null }) : null);
        }
        if (H.onReady) H.onReady();
        return;
      }
      if (d.t !== 'r' || qh === qt) return;
      var p = qh % RN, id = qi[p], cb = qc[p], arg = qa[p];
      qc[p] = null; qa[p] = null; qh++;
      if (id === d.id) cb(d.r, d.x, d.b, arg);
    };
    w.onerror = function (ev) { try { ev.preventDefault(); } catch (e) {} kill('worker error: ' + String(ev && ev.message || 'load')); };
    function stop() {
      if (H.dead) return false;
      H.dead = true;
      try { w.terminate(); } catch (e) {}
      S.workersLive--; S.hostsLive--;
      var pend = [];
      while (qh < qt) { var p = qh % RN; pend.push(qc[p], qa[p]); qc[p] = null; qa[p] = null; qh++; }
      for (var i = 0; i < pend.length; i += 2) pend[i](E_DEAD_HOST, null, null, pend[i + 1]);
      return true;
    }
    function kill(why) {
      if (H.dead) return;
      H.error = why;
      if (H.ready) tell('worker died', why);
      stop();
      if (H.onDead) try { H.onDead(why); } catch (e) {}
    }
    H = {
      kind: 'worker', backend: '', error: '', fetchMs: 0, initMs: 0, readyMs: 0, abi: 0, ready: false, boot: null,
      dead: false, onDead: null, onReady: null, first: null, _first: null,
      createWorld: function (desc) {
        return new Promise(function (ok) {
          var d = descWords(desc).slice();
          call('create', 0, null, [d.buffer], function (r, x) { ok(r === 0 && x && x[0] ? { code: 0, world: new WorkerWorld(H, x[0]) } : { code: r, world: null }); });
        });
      },
      contact: function (inp, n, out) {
        return new Promise(function (ok) {
          var a = new Int32Array(inp.subarray(0, n * 15)), o = new Int32Array(n * 7);
          call('contact', 0, [n], [a.buffer, o.buffer], function (r, x, b) { if (b && b[1]) out.set(new Int32Array(b[1]).subarray(0, n * 7)); ok(r); });
        });
      },
      pages: function () { return new Promise(function (ok) { call('pages', 0, null, null, function (r, x) { ok(x ? x[0] : 0); }); }); },
      _kill: kill, // tests: a worker crash
      _stop: stop,
      call: call, send: send, // WorkerWorld
      dispose: function () { stop(); }
    };
    return H;
  }
  // one world inside the worker. Every in-flight tick owns one tick buffer (TB, § 2) from a small pool; the message object, its
  // transfer list and the reply callback are the world's own, made once. Per tick the page's main thread allocates only what
  // postMessage itself delivers (the reply event and its copy of the message) and one Int32Array view over the returned buffer;
  // the results are copied into the world's own arrays (r.res / r.ev / r.dr — valid inside cb, as on the in-thread path)
  function WorkerWorld(H, h) {
    this.H = H; this.h = h; this.pool = []; this.r = mkTick(); this.inflight = 0; this.dead = false; this.gone = false; this.hashOut = new Uint32Array(2);
    this.msg = { t: 'call', id: 0, m: 'tick', h: h, a: null, b: null }; this.tl = [null];
    this.res = null; this.ev = null; this.dr = null;
    var self = this;
    this.back = function (code, x, b, B) { self.tickBack(code, b, B); };
    S.worldsLive++;
  }
  function mkTick() { return { code: 0, res: null, step: 0, evCode: 0, evN: 0, ev: null, drCode: 0, drN: 0, dr: null, hash: new Uint32Array(2), ms: 0, rtMs: 0 }; }
  var WW = WorkerWorld.prototype;
  WW.bufs = function (n, evCap, drCap) {
    var B = this.pool.pop() || { buf: null, v: null, nCap: 0, evCap: 0, drCap: 0, n: 0, cb: null, t0: 0 };
    if (!B.buf || B.nCap < n || B.evCap < evCap || B.drCap < drCap) {
      var nc = Math.max(64, n * 2, B.nCap), ec = Math.max(evCap, B.evCap), dc = Math.max(drCap, B.drCap);
      B.buf = new ArrayBuffer((TB_HEAD + nc * 17 + ec * 13 + dc * 4) * 4); B.v = new Int32Array(B.buf); B.nCap = nc; B.evCap = ec; B.drCap = dc;
    }
    return B;
  };
  WW.tick = function (cmds, n, steps, cb, wantHash, evCap, drCap) {
    var r = this.r;
    evCap = evCap || 512; drCap = drCap || 1024;
    if (this.dead) { r.code = E_DEAD_HOST; r.evN = 0; r.drN = 0; cb(r); return; }
    var B = this.bufs(n, evCap, drCap), v = B.v, k = n * 13, i;
    v[0] = n; v[1] = steps; v[2] = evCap; v[3] = drCap; v[4] = wantHash ? 1 : 0; v[14] = B.nCap; v[15] = B.evCap;
    for (i = 0; i < k; i++) v[TB_HEAD + i] = cmds[i];
    B.n = n; B.cb = cb; B.t0 = now();
    this.inflight++;
    var msg = this.msg, tl = this.tl;
    tl[0] = B.buf; msg.b = tl;
    B.buf = null; B.v = null; // transferred: the reply brings it back
    this.H.send(msg, tl, this.back, B);
    tl[0] = null; msg.b = null;
  };
  WW.tickBack = function (code, b, B) {
    this.inflight--;
    var r = this.r, buf = b && b[0], cb = B.cb;
    B.cb = null;
    r.code = code; r.rtMs = now() - B.t0;
    if (buf) {
      var v = new Int32Array(buf), n = B.n, ro = TB_HEAD + B.nCap * 13, eo = ro + B.nCap * 4, dq = eo + B.evCap * 13, i, k;
      B.buf = buf; B.v = v;
      r.step = v[6]; r.evCode = v[7]; r.evN = Math.min(v[8], B.evCap); r.drCode = v[9]; r.drN = Math.min(v[10], B.drCap);
      r.hash[0] = v[11]; r.hash[1] = v[12]; r.ms = v[13] / 1000;
      if (!this.res || this.res.length < n * 4) this.res = new Int32Array(Math.max(256, n * 8));
      if (!this.ev || this.ev.length < B.evCap * 13) this.ev = new Int32Array(B.evCap * 13);
      if (!this.dr || this.dr.length < B.drCap * 4) this.dr = new Int32Array(B.drCap * 4);
      var R = this.res, E = this.ev, D = this.dr;
      for (i = 0, k = n * 4; i < k; i++) R[i] = v[ro + i];
      for (i = 0, k = r.evN * 13; i < k; i++) E[i] = v[eo + i];
      for (i = 0, k = r.drN * 4; i < k; i++) D[i] = v[dq + i];
      r.res = R; r.ev = E; r.dr = D;
      this.pool.push(B);
    } else { r.step = 0; r.evN = 0; r.drN = 0; r.res = null; r.ev = null; r.dr = null; r.hash[0] = 0; r.hash[1] = 0; if (code === E_DEAD_HOST) this.dead = true; }
    try { cb(r); }
    finally { r.res = null; r.ev = null; r.dr = null; }
  };
  function wwAsk(self, m, a, bufs, after) {
    return new Promise(function (ok) {
      if (self.dead) { ok(after ? after(E_DEAD_HOST, null, null) : E_DEAD_HOST); return; }
      self.H.call(m, self.h, a, bufs, function (code, x, b) { if (code === E_DEAD_HOST) self.dead = true; ok(after ? after(code, x, b) : code); });
    });
  }
  WW.query = function (q, n, out) {
    var qa = new Int32Array(q.subarray(0, n * 10)), o = new Int32Array(n * 2);
    return wwAsk(this, 'query', [n], [qa.buffer, o.buffer], function (c, x, b) { if (b) out.set(new Int32Array(b[1]).subarray(0, n * 2)); return c; });
  };
  WW.read = function (ids, n, out) {
    var ia = new Int32Array(n * 2); for (var i = 0; i < n * 2; i++) ia[i] = ids[i];
    var o = new Int32Array(n * 12);
    return wwAsk(this, 'read', [n], [ia.buffer, o.buffer], function (c, x, b) { if (b) out.set(new Int32Array(b[1]).subarray(0, n * 12)); return c; });
  };
  WW.info = function (out) { return wwAsk(this, 'info', null, [new Int32Array(8).buffer], function (c, x, b) { if (b) out.set(new Int32Array(b[0])); return c; }); };
  WW.hash = function (out) { var o = out || this.hashOut; return wwAsk(this, 'hash', null, null, function (c, x) { if (x) { o[0] = x[0]; o[1] = x[1]; } return c; }); };
  WW.snapshot = function () { return wwAsk(this, 'snapshot', null, null, function (c, x, b) { return { code: c, bytes: b && b[0] ? new Uint8Array(b[0], 0, x[0]) : null }; }); };
  WW.restore = function (bytes, len) { var c = new Uint8Array(len); c.set(bytes.subarray(0, len)); return wwAsk(this, 'restore', [len], [c.buffer]); };
  WW.destroy = function () {
    if (this.gone) return Promise.resolve(-1);
    this.gone = true;
    S.worldsLive--;
    var p = wwAsk(this, 'destroy', null, null);
    this.dead = true;
    return p;
  };

  // the same host API in-thread (no Worker, or it failed): sync calls, promises / callbacks resolved at once
  function inlineHost(opts, why) {
    return load({ wasm: opts.wasm, timeoutMs: opts.timeoutMs, force: opts.force }).then(function (c) {
      S.hostsLive++;
      var H = {
        kind: 'inline', backend: c.backend, error: (why ? why + (c.error ? '; ' : '') : '') + (c.error || ''), fetchMs: c.fetchMs, initMs: c.initMs, readyMs: c.totalMs, abi: c.abi,
        dead: false, onDead: null, core: c,
        createWorld: function (desc) { var r = c.createWorld(desc); return Promise.resolve(r.world ? { code: 0, world: new InlineWorld(r.world) } : r); },
        contact: function (inp, n, out) { return Promise.resolve(c.contact(inp, n, out)); },
        pages: function () { return Promise.resolve(c.pages()); },
        dispose: function () { if (!H.dead) { H.dead = true; S.hostsLive--; } }
      };
      return H;
    });
  }
  function InlineWorld(w) { this.w = w; this.r = mkTick(); this.inflight = 0; this.dead = false; this.gone = false; this.ev = null; this.dr = null; this.res = null; this.hashOut = new Uint32Array(2); }
  var IW = InlineWorld.prototype;
  IW.tick = function (cmds, n, steps, cb, wantHash, evCap, drCap) {
    var w = this.w, r = this.r, t0 = now();
    evCap = evCap || 512; drCap = drCap || 1024;
    if (this.gone) { r.code = E_DEAD_HOST; r.evN = 0; r.drN = 0; cb(r); return; }
    if (!this.ev || this.ev.length < evCap * 13) this.ev = new Int32Array(evCap * 13);
    if (!this.dr || this.dr.length < drCap * 4) this.dr = new Int32Array(drCap * 4);
    if (!this.res || this.res.length < n * 4) this.res = new Int32Array(Math.max(64, n * 8));
    r.code = n ? w.apply(cmds, n, this.res) : 0;
    r.step = r.code >= 0 && steps ? w.step(steps) : 0;
    r.evCode = w.events(this.ev, evCap); r.evN = w.count;
    r.drCode = w.dirty(this.dr, drCap); r.drN = w.count;
    r.hash[0] = 0; r.hash[1] = 0;
    if (wantHash) w.hash(r.hash);
    r.ms = now() - t0; r.rtMs = r.ms;
    r.res = this.res; r.ev = this.ev; r.dr = this.dr;
    if (w.dead) this.dead = true;
    try { cb(r); } finally { r.res = null; r.ev = null; r.dr = null; }
  };
  IW.query = function (q, n, out) { return Promise.resolve(this.w.query(q, n, out)); };
  IW.read = function (ids, n, out) { return Promise.resolve(this.w.read(ids, n, out)); };
  IW.info = function (out) { return Promise.resolve(this.w.info(out)); };
  IW.hash = function (out) { var o = out || this.hashOut; return Promise.resolve(this.w.hash(o)); };
  IW.snapshot = function () {
    var w = this.w;
    w.snapshot(null);
    var b = new Uint8Array(w.len), c = w.snapshot(b);
    return Promise.resolve({ code: c, bytes: b });
  };
  IW.restore = function (bytes, len) { return Promise.resolve(this.w.restore(bytes, len)); };
  IW.destroy = function () { if (this.gone) return Promise.resolve(-1); this.gone = true; this.dead = true; return Promise.resolve(this.w.destroy()); };

  // ════════════════════════════════════ 3) game adapter: fixed 20 Hz core clock over the game's fixed steps
  // Commands are stamped by game step, not by wall time: a command belongs to the core tick (step index / stepsPerTick), so
  // the same inputs give the same world at any FPS and on either transport (ticks are never merged: each keeps its own batch;
  // ticks made before the world exists wait in order). No getters on the session object (T-085) — plain fields.
  function session(opts) {
    opts = opts || {};
    var stepsPerTick = Math.max(1, Math.round((opts.stepHz || 60) / (opts.tickHz || 20)));
    var sender = (opts.sender == null ? 1 : opts.sender) | 0;
    var desc = sessionDesc(opts);
    var evCap = opts.evCap || 512, drCap = opts.drCap || 1024, hashEvery = opts.hashEvery == null ? 20 : opts.hashEvery;
    var cmds = new Int32Array(64 * 13), n = 0, counter = 0, steps = 0, H = null, hw = null, starting = null, disposed = false, noWorker = opts.worker === false;
    var early = [], tickNo = 0;
    // tickMs — the core's own time per tick (in the worker when there is one); mainMs = sendMs + recvMs — what the tick costs the
    // page's main thread (copy in / out, postMessage, result handling incl. onTick): C-012 budget ≤ 0.3 ms dev PC, ≤ 1 ms phone ×4
    var st = { ticks: 0, cmds: 0, applied: 0, refused: 0, events: 0, tickMs: 0, tickMax: 0, rtMs: 0, backlog: 0, resets: 0, overflows: 0, errors: 0, pages: 0, early: 0,
      sendMs: 0, recvMs: 0, mainMs: 0, mainMax: 0, sendSum: 0, recvSum: 0 }; // *Sum: totals in ms (a window's average = Δsum / Δticks)
    // opts.t0 — when the game asked for the core (GameKit.core: before d37core.js / core-world.js were on the page), so readyMs is
    // load + init as the game sees it; opts.adopt — the core Worker it already started (used once: a reset makes a new host)
    var t0s = opts.t0 || now(), adopt = opts.adopt || null;
    var s = {
      ready: false, backend: '', transport: '', error: '', hash: new Uint32Array(2), stats: st, opts: opts, world: null, host: null, started: null, readyMs: 0,
      cmd: function (op, actor, tLo, tHi, ver, p0, p1, p2, p3, p4, p5) {
        if (disposed) return 0;
        if ((n + 1) * 13 > cmds.length) { var c2 = new Int32Array(cmds.length * 2); c2.set(cmds); cmds = c2; }
        var b = n * 13;
        counter = (counter + 1) | 0;
        if (counter === 0) counter = 1;
        cmds[b] = counter; cmds[b + 1] = sender; cmds[b + 2] = actor | 0; cmds[b + 3] = tLo | 0; cmds[b + 4] = tHi | 0; cmds[b + 5] = op & 0xFFFF;
        cmds[b + 6] = ver | 0; cmds[b + 7] = p0 | 0; cmds[b + 8] = p1 | 0; cmds[b + 9] = p2 | 0; cmds[b + 10] = p3 | 0; cmds[b + 11] = p4 | 0; cmds[b + 12] = p5 | 0;
        n++;
        return counter;
      },
      // once per fixed game step (E.loop update)
      step: function () {
        if (disposed) return;
        steps++;
        if (steps % stepsPerTick !== 0) return;
        if (!hw) { pendTick(); return; }
        var t0 = now();
        sendTick();
        var dt = now() - t0;
        st.sendMs = st.sendMs ? st.sendMs * 0.9 + dt * 0.1 : dt;
        st.sendSum += dt;
        if (dt > st.mainMax) st.mainMax = dt;
        st.mainMs = st.sendMs + (s.transport === 'worker' ? st.recvMs : 0); // in-thread: the result is handled inside the send
      },
      line: function () {
        if (!s.ready) return 'ядро D37: ' + (s.error ? 'нет (' + s.error + ')' : 'загрузка…');
        return 'ядро D37: ' + s.backend + ' · ' + s.transport + ' · такт ' + st.tickMs.toFixed(3) + ' мс (макс ' + st.tickMax.toFixed(2) + ') · страница ' + st.mainMs.toFixed(3) + ' мс · ответ ' + st.rtMs.toFixed(1) +
          ' мс · тактов ' + st.ticks + ' · команд ' + st.cmds + '/' + st.applied + ' · событий ' + st.events + (st.resets ? ' · сбросов ' + st.resets : '') +
          (st.backlog > 1 ? ' · очередь ' + st.backlog : '') + (hashEvery ? ' · хеш ' + hex8(s.hash[1]) + hex8(s.hash[0]) : '');
      },
      dispose: function () {
        if (disposed) return;
        disposed = true;
        S.sessionsLive--;
        var w = hw, h = H;
        hw = null; H = null; s.world = null; s.host = null; early = [];
        if (w) w.destroy().then(function () { if (h) h.dispose(); });
        else if (h) h.dispose();
      }
    };
    S.sessionsLive++;
    function pendTick() {
      var c = new Int32Array(n * 13); c.set(cmds.subarray(0, n * 13));
      early.push(c, n);
      st.early++;
      n = 0;
      if (early.length > 2 * 600) { early.splice(0, 2); st.errors++; } // 30 s without a core: the oldest waiting tick goes
    }
    // in-flight ticks: their command counts and the world generation they were sent to (a ring: no closure per tick)
    var RQ = 2048, kq = new Int32Array(RQ), gq = new Int32Array(RQ), qh = 0, qt = 0, gen = 1;
    function send(c, k, stepsN, wantHash) {
      if (qt - qh >= RQ) { st.errors++; reset('backlog ' + RQ + ' ticks'); return; } // the core is ~100 s behind: start over
      kq[qt % RQ] = k; gq[qt % RQ] = gen; qt++;
      st.backlog = qt - qh;
      hw.tick(c, k, stepsN, onRes, wantHash, evCap, drCap);
    }
    function sendTick() {
      var k = n; n = 0;
      tickNo++;
      send(cmds, k, 1, hashEvery > 0 && tickNo % hashEvery === 0);
    }
    function onRes(r) {
      if (qh === qt) return;
      var k = kq[qh % RQ], g = gq[qh % RQ];
      qh++;
      if (disposed || g !== gen) return; // a result of a world that is already gone
      var t1 = now();
      gotRes(r, k);
      var dt = now() - t1;
      st.recvMs = st.recvMs ? st.recvMs * 0.9 + dt * 0.1 : dt;
      st.recvSum += dt;
      if (dt > st.mainMax) st.mainMax = dt;
      st.mainMs = st.sendMs + (s.transport === 'worker' ? st.recvMs : 0); // in-thread: the result is handled inside the send
    }
    function gotRes(r, k) {
      if (r.code === E_DEAD_HOST || r.code === E_PANIC || r.step === E_PANIC) { st.errors++; reset(r.code === E_DEAD_HOST ? 'worker died' : 'wasm trap'); return; }
      st.ticks++; S.ticks++;
      st.tickMs = st.tickMs ? st.tickMs * 0.9 + r.ms * 0.1 : r.ms;
      if (r.ms > st.tickMax) st.tickMax = r.ms;
      st.rtMs = st.rtMs ? st.rtMs * 0.9 + r.rtMs * 0.1 : r.rtMs;
      st.backlog = qt - qh;
      st.cmds += k;
      if (r.res) for (var i = 0; i < k; i++) if (r.res[i * 4] === 0) st.applied++; else st.refused++;
      st.events += r.evN;
      if (r.evCode === -8 || r.drCode === -8) st.overflows++;
      if (r.hash[0] || r.hash[1]) { s.hash[0] = r.hash[0]; s.hash[1] = r.hash[1]; }
      if (opts.onTick) try { opts.onTick(r, k, s); } catch (err) { st.errors++; }
    }
    // (re)create the world; onReset lets the game send its objects again (start, worker crash, wasm trap). After a worker
    // death the next host is in-thread (a second crash would cost the game again).
    function reset(why) {
      if (disposed) return;
      st.resets++; S.resets++;
      tell('world reset', why);
      var old = hw; hw = null; s.world = null; s.ready = false;
      gen++; qh = qt; // results still in flight belong to the old world
      if (old) old.destroy();
      if (H && H.dead) { noWorker = true; H.dispose(); H = null; s.host = null; }
      start();
    }
    function start() {
      if (starting) return starting;
      var a = adopt; adopt = null;
      var hostP = H ? Promise.resolve(H) : host({ worker: noWorker ? false : opts.worker, wasm: opts.wasm, timeoutMs: opts.timeoutMs, workerUrl: opts.workerUrl, readyMs: opts.readyMs, desc: desc, adopt: a });
      starting = hostP.then(function (h) {
        if (disposed) { h.dispose(); starting = null; return null; }
        H = h; s.host = h;
        h.onDead = function (why) { if (!disposed && H === h) { st.errors++; reset(why); } };
        var first = h.first; h.first = null; // the world sent with init (a new host only); null → make it now
        return (first ? first.then(function (r) { return r || h.createWorld(desc); }) : h.createWorld(desc)).then(function (r) {
          starting = null;
          if (disposed) { if (r.world) r.world.destroy(); return null; }
          if (!r.world) { s.error = 'create ' + r.code; s.ready = false; return null; }
          hw = r.world; s.world = hw;
          s.ready = true; s.backend = h.backend; s.transport = h.kind; s.error = h.error;
          if (!s.readyMs) s.readyMs = now() - t0s; // session() → the first world ready (load + init as the game sees it)
          // order: the game's setup (onReset) as a tick without a step, then the ticks that waited, each with its own batch;
          // commands queued since the last waiting tick stay queued for the next normal tick
          var rest = n ? new Int32Array(cmds.subarray(0, n * 13)) : null, rn = n;
          n = 0;
          if (opts.onReset) try { opts.onReset(s); } catch (err) { st.errors++; }
          if (n) { var k0 = n; n = 0; send(cmds, k0, 0, false); }
          var pend = early; early = [];
          for (var i = 0; i < pend.length; i += 2) { tickNo++; send(pend[i], pend[i + 1], 1, false); }
          if (rest) { if (rest.length > cmds.length) cmds = new Int32Array(rest.length * 2); cmds.set(rest); n = rn; }
          if (h.pages) h.pages().then(function (p) { st.pages = p; });
          return s;
        });
      });
      return starting;
    }
    s.started = start();
    return s;
  }
  function hex8(v) { var x = (v >>> 0).toString(16); while (x.length < 8) x = '0' + x; return x; }

  // ════════════════════════════════════ helpers: command words (no allocation)
  var pack = {
    /** SPAWN params[0]: kind (1..65535) | owner << 16 (0 world, 1 player-built) | ckind << 20 (0 body, 1 player, 2 prop, 3 static) | surf << 24 */
    spawnKind: function (kind, owner, ckind, surf) { return (kind & 0xFFFF) | ((owner & 15) << 16) | ((ckind & 15) << 20) | ((surf & 255) << 24); },
    /** SPAWN params[4]: hp_q4 (bits 0-15) | brk_v mm/s << 16 */
    hpBrk: function (hpQ4, brkV) { return (hpQ4 & 0xFFFF) | ((brkV & 0xFFFF) << 16); },
    /** EdgeChange / CostChange words: cell, side | value << 8 */
    edge: function (out, k, cell, side, value) { out[k * 2] = cell | 0; out[k * 2 + 1] = (side & 255) | ((value & 255) << 8); }
  };

  // stable ids for adapters, on the main thread without waiting for the core (the bit-exact JS of d37_world_id / d37_world_child_id)
  function worldId(seedLo, seedHi, gv, rx, ry, rz, index, out) { var B = base(); return B ? B.js.worldId(seedLo, seedHi, gv, rx, ry, rz, index, out) : E_UNSUPPORTED; }
  function childId(lo, hi, cut, out) { var B = base(); return B ? B.js.childId(lo, hi, cut, out) : E_UNSUPPORTED; }

  var api = { ABI: ABI, E_UNSUPPORTED: E_UNSUPPORTED, E_PANIC: E_PANIC, E_DEAD_HOST: E_DEAD_HOST, load: load, host: host, session: session, serve: serve, pack: pack,
    worldId: worldId, childId: childId,
    stats: function () { return { loads: S.loads, fallbacks: S.fallbacks, worldsLive: S.worldsLive, hostsLive: S.hostsLive, workersLive: S.workersLive, sessionsLive: S.sessionsLive, resets: S.resets, ticks: S.ticks }; },
    // the flag (js/core/config.js CORE_WASM); a function, not a getter
    on: function () { try { return typeof CORE_WASM !== 'undefined' && !!CORE_WASM; } catch (e) { return false; } },
    _reset: function () { cache = {}; told = {}; } };
  // started as a dedicated Worker (D37CoreWorld.host → new Worker('js/engine/core-world.js?v=…', { name: 'd37-core-world' })): load
  // the core files next to this one with the same ?v= and serve the protocol of § 2
  if (typeof window === 'undefined' && typeof importScripts === 'function' && root.name === WORKER_NAME && root.location) {
    var wb = { topMs: now(), libMs: 0, pre: null };
    root.D37CoreWorld = api;
    // only our own cache-busting query (?v=<GAMES_VER>) is passed on; anything else loads the file without one
    var qv = /^\?v=[\w.-]{1,40}$/.test(root.location.search || '') ? root.location.search : '';
    // the default wasm (next to this file, the same ?v=) starts downloading and compiling now, while d37core.js loads; init with
    // that URL takes the module (serve). It failing here → init downloads it again and names the error
    try {
      if (typeof fetch === 'function' && typeof WebAssembly === 'object' && typeof WebAssembly.compileStreaming === 'function' && root.location.href) {
        var wu = new URL('d37core.wasm' + qv, root.location.href).href;
        wb.pre = { url: wu, p: WebAssembly.compileStreaming(fetch(wu)) };
        wb.pre.p.catch(function () {});
      }
    } catch (e) { wb.pre = null; }
    importScripts('d37core.js' + qv);
    wb.libMs = now();
    serve(root, wb);
  }
  return api;
});

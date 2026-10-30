// ═══════════════════════════════════════
//  D37 TERRAIN (T-111, W1) — streaming of the T1 terrain core around the player: blocks 32³ in rings, built in workers
//  (wasm, JS fallback), dig/fill edits with re-mesh of the affected blocks, ground and rays for physics. No three.js here:
//  meshes — js/engine/terra-mesh.js. World coordinates: METERS, f64, Y up (the core's units); the game converts with E.UNIT and
//  its floating anchor. Plan: E:\d37-core\spec\PLAN.md (T1 / W1).
// ═══════════════════════════════════════
// TS = D37E.terra.create({ seed, gen: 1, rules: 0, param: 0, radius: 5, caveRadius: 2, workers, cap, wasm: true, wasmUrl, workerUrl })
//   gen 2 — logical biomes (T-116, generator v2: climate by latitude, height, sea and wind); rules (WORLD_RULES §2, need gen 2):
//   0 earth, 1 mono (param = biome), 2 patchwork, 3 absurd (floating islands), 4 inverted (ground above). Heights are the same.
//   NOTE: the mesh physics (ground / blocked / ceiling) assumes the sky ABOVE (facing by parity from the open sky) — rules 4 here
//   streams and draws correctly, its walking physics is for the host game (Backrooms) to define.
//   TS.flatten(x, y, z, r) — a level pad at y (W2 towns; edit mode 2); TS.climate(x, z, out) → biome (out: tb, m, hs, phi, ts, tp, h, biome)
//   TS.ceiling(x, z, y) → the lowest terrain above y (cave roofs; Infinity — open sky)
//   TS.update(x, y, z)            — where the player is (m); schedules column probes and block builds (nearest first, budgets)
//   TS.takeReady() → block | null — a built block for upload: { key, cx, cy, cz, q, buf, wi, … } (terra-mesh copies it, then TS.recycle(b))
//   TS.onRelease = b => …         — a shown block left the ring (terra-mesh returns its geometry to the pool)
//   TS.dig(x, y, z, r) / TS.fill(x, y, z, r) — edit (quantized to 1/64 m, applied in order); affected blocks are rebuilt first
//   TS.ground(x, z, yRef) → surface height (m) under yRef + 1.1 (caves: the floor of the cave you are in); TS.water(x, z) → 0 | -Infinity
//   TS.ray(ox, oy, oz, dx, dy, dz, maxT) → { t, x, y, z } | null — density march (dig/fill target)
//   TS.stats(), TS.dispose()
// Pure helpers (node tests): D37E.terra.key(cx, cy, cz), D37E.terra.affected(x, y, z, r) → [[cx, cy, cz], …] (blocks an edit touches)
// D37E.terra.ON — one-line rollback of the whole W1 test page (false → the page says "off").
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const TE = E.terra = E.terra || {};
  TE.ON = true;
  const KX = 1 << 20;
  const core = () => E.terraCore;
  TE.key = (cx, cy, cz) => ((cx + KX) * 2097152 + (cz + KX)) * 128 + (cy + 64);
  TE.colKey = (cx, cz) => (cx + KX) * 2097152 + (cz + KX);
  const Q64 = v => Math.round(v * 64) / 64;
  TE.quant = Q64;
  // blocks whose mesh an edit can change (the core's own predicate: edit_touches)
  // inverted worlds (rules 4) test the mirrored edit against the mirrored (earth) block ~cy, as the core does
  TE.affected = (x, y, z, r, out = [], mode = 0, rules = 0) => {
    const T1 = core(), e = [x, rules === 4 ? -1 - y : y, z, r, mode], m = T1.reachH(e, 0) + 6, mv = T1.reachV(e, 0) + 6, ey = e[1];
    for (let cx = Math.floor((x - m) / 32); cx <= Math.floor((x + m) / 32); cx++)
      for (let cz = Math.floor((z - m) / 32); cz <= Math.floor((z + m) / 32); cz++)
        for (let cy = Math.floor((ey - mv) / 32); cy <= Math.floor((ey + mv) / 32); cy++)
          if (T1.touches(e, 0, cx * 32, cy * 32, cz * 32)) out.push([cx, rules === 4 ? ~cy : cy, cz]);
    return out;
  };
  // does edit e of a flat list touch world block (cx, cy, cz)? (inverted: mirrored, like the core)
  const TT = new Float64Array(5);
  TE.touchesW = (ed, e, cx, cy, cz, rules) => {
    const T1 = core();
    if (rules !== 4) return T1.touches(ed, e, cx * 32, cy * 32, cz * 32);
    for (let k = 0; k < 5; k++) TT[k] = ed[e * 5 + k];
    TT[1] = -1 - TT[1];
    return T1.touches(TT, 0, cx * 32, ~cy * 32, cz * 32);
  };

  TE.create = function (o = {}){
    const T1 = core();
    if (!T1) throw new Error('terra: terra-core.js is not loaded');
    const ver = typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1';
    const seed = (o.seed ?? 1337) | 0, cap = o.cap || T1.DEFAULT_CAP;
    const gen = o.gen === 2 ? 2 : 1, rules = gen === 2 ? (o.rules | 0) : 0, param = o.param | 0, compact = !!o.compact, FLAT_UP = T1.FLAT_UP;
    // point queries by the world rules (rules 0: the plain v1 field — the same bits)
    const dens = rules ? (x, y, z, ops, n) => T1.densityR(seed, x, y, z, ops, n, rules) : (x, y, z, ops, n) => T1.density(seed, x, y, z, ops, n);
    const hgt = rules === 4 ? (x, z) => T1.heightR(seed, x, z, 4) : (x, z) => T1.height(seed, x, z);
    const mob = !!E.isMobile?.(), cores = (root.navigator && navigator.hardwareConcurrency) || 4;
    const TS = {
      seed, gen, rules, param, compact, radius: o.radius ?? (mob ? 4 : 5), caveRadius: o.caveRadius ?? 2, keep: 0, dead: false,
      blocks: new Map(), cols: new Map(), onRelease: null,
      st: { built: 0, empty: 0, buildMs: 0, buildMax: 0, colMs: 0, cols: 0, sent: 0, stale: 0, errors: 0, fallbacks: 0, kind: '', edits: 0,
        respawns: 0, local: 0, maxQueue: 0, trunc: 0, quads: 0 },
    };
    TS.keep = TS.radius + 1;   // hysteresis ring: blocks stay until 1 block beyond the radius (R+2 kept 2.3× the needed columns at R = 4)
    // ── edits (meters, order kept) ──
    let ed = new Float64Array(5 * 256), ne = 0;
    // ── workers ──
    const wanted = o.workers ?? (mob ? (cores >= 6 ? 2 : 1) : Math.max(1, Math.min(3, cores - 2)));
    const workerUrl = o.workerUrl || 'js/engine/terra-worker.js?v=' + ver;
    const wasmUrl = o.wasm === false ? null : (o.wasmUrl || 'js/engine/terra.wasm?v=' + ver);
    const W = [];
    let jobId = 0;
    const jobs = new Map();   // id → { kind: 'col'|'blk', key, wi }
    function spawn(slot){
      const w = new Worker(workerUrl), K = { w, slot, busy: 0, ok: false, dead: false, kind: '', ids: new Set() };
      w.onmessage = e => onMsg(K, e.data);
      w.onerror = ev => {
        ev?.preventDefault?.();
        if (K.dead || TS.dead) return;
        K.dead = true; TS.st.errors++;
        for (const id of K.ids) requeue(id);
        K.ids.clear(); K.busy = 0;
        try { w.terminate(); } catch (e) {}
        if (TS.st.respawns < 3) { TS.st.respawns++; setTimeout(() => { if (!TS.dead) { try { W[slot] = spawn(slot); replay(W[slot]); } catch (e) {} } }, 300); }
      };
      // absolute (the worker resolves against its own folder); document.baseURI respects <base href="/"> on /play/… addresses
      w.postMessage({ t: 'init', wasm: wasmUrl ? new URL(wasmUrl, root.document?.baseURI || root.location?.href || 'http://x/').href : null, cap, gen, rules, param, compact });
      return K;
    }
    function replay(K){ if (ne) K.w.postMessage({ t: 'edits', list: ed.slice(0, ne * 5), n: ne }); }
    try { if (typeof Worker === 'function' && o.workers !== 0) for (let i = 0; i < wanted; i++) W.push(spawn(i)); }
    catch (e) { console.warn('terra: no workers — building on the page', e); }
    // fallback: a builder on the page (one job per update, small budget) when workers are missing or all died
    let local = null;
    const localCore = () => { if (!local) { local = T1.js(cap); local.setGen(gen, rules, param); } return local; };

    function requeue(id){
      const j = jobs.get(id); jobs.delete(id);
      if (!j) return;
      if (j.kind === 'col') { const c = TS.cols.get(j.key); if (c && c.st === 1) c.st = 0; }
      else { const b = TS.blocks.get(j.key); if (b && b.st === 1) b.st = 0; }
      dirtyQ = true;
    }
    function onMsg(K, d){
      if (TS.dead) return;
      if (d.t === 'ready') { K.ok = true; K.kind = d.kind; TS.st.kind = d.kind; if (d.err) TS.st.wasmErr = d.err; return; }
      if (d.t === 'fallback') { K.kind = d.kind; TS.st.kind = d.kind; TS.st.fallbacks++; TS.st.wasmErr = d.err; return; }
      const j = jobs.get(d.id);
      if (j) { jobs.delete(d.id); K.ids.delete(d.id); K.busy--; }
      if (d.t === 'err') { TS.st.errors++; if (j) requeue(d.id); return; }
      if (d.t === 'col') { gotCol(d.cx, d.cz, d.hmin, d.hmax, d.ms); return; }
      if (d.t === 'built') gotBlock(K, j, d);
    }
    function gotCol(cx, cz, hmin, hmax, ms){
      TS.st.cols++; TS.st.colMs += ms || 0;
      const c = TS.cols.get(TE.colKey(cx, cz));
      if (!c) return;
      c.st = 2; c.hmin = hmin; c.hmax = hmax; dirtyQ = true;
    }
    function gotBlock(K, j, d){
      const b = j ? TS.blocks.get(j.key) : null;
      const give = () => { if (d.buf && K) K.w.postMessage({ t: 'buf', buf: d.buf }, [d.buf]); };
      if (!b || b.st !== 1 || b.job !== d.id) { give(); return; }
      if (d.q < 0) { TS.st.errors++; give(); b.st = 0; b.fails = (b.fails || 0) + 1; b.retryAt = now() + 500 * b.fails; dirtyQ = true; return; }
      TS.st.buildMs += d.ms || 0; TS.st.buildMax = Math.max(TS.st.buildMax, d.ms || 0);
      if (d.trunc) TS.st.trunc++;
      if (d.ne < b.need) { TS.st.stale++; give(); b.st = 0; dirtyQ = true; return; }   // an edit came while it was being built
      TS.st.built++; if (!d.q) TS.st.empty++;
      b.st = 2; b.ne = d.ne; b.q = d.q; b.buf = d.buf; b.pk = d.pk | 0; b.wi = K ? K.slot : -1;
      ready.push(b);
    }
    const ready = [];
    const now = () => (root.performance ? performance.now() : Date.now());

    // ── desired set: columns in rings (nearest first), then their blocks ──
    let cx0 = NaN, cy0 = 0, cz0 = NaN, dirtyQ = true, lastQ = 0;
    const queue = [], QP = [];   // queue — pooled items { kind, key, cx, cy, cz, pri }; qh — head (no splice: no garbage)
    let qh = 0, qn = 0, qstamp = 0;
    const qpush = (kind, key, cx, cy, cz, pri) => { const it = QP[qn] || (QP[qn] = { kind: '', key: 0, cx: 0, cy: 0, cz: 0, pri: 0 }); qn++; it.kind = kind; it.key = key; it.cx = cx; it.cy = cy; it.cz = cz; it.pri = pri; queue.push(it); };
    const byPri = (a, b) => a.pri - b.pri;
    const RING = [];    // (dx, dz, d²) by distance, built once per radius
    function ringFor(R){
      if (RING.R === R) return RING;
      RING.length = 0; RING.R = R;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= R * R + R) RING.push([dx, dz, dx * dx + dz * dz]);
      RING.sort((a, b) => a[2] - b[2]);
      return RING;
    }
    function blockOf(cx, cy, cz, create){
      const k = TE.key(cx, cy, cz);
      let b = TS.blocks.get(k);
      if (!b && create) { b = { key: k, cx, cy, cz, st: 0, need: 0, ne: -1, q: 0, buf: null, wi: -1, job: 0, mesh: null, shown: false, fails: 0, retryAt: 0, qs: 0, pd: null, pk: 0 }; TS.blocks.set(k, b); }
      return b;
    }
    // blocks of a known column: the surface range; near the player also the cave blocks down to −32 m (caves end at −28 m)
    function rebuildQueue(){
      queue.length = 0; qh = 0; qn = 0; qstamp++;
      const R = TS.radius, RC = TS.caveRadius, ring = ringFor(R), t = now();
      for (let i = 0; i < ring.length; i++) {
        const dx = ring[i][0], dz = ring[i][1], d2 = ring[i][2], cx = cx0 + dx, cz = cz0 + dz, ck = TE.colKey(cx, cz);
        let c = TS.cols.get(ck);
        if (!c) { c = { key: ck, cx, cz, st: 0, hmin: 0, hmax: 0 }; TS.cols.set(ck, c); }
        if (c.st === 0) { qpush('col', ck, cx, 0, cz, d2 * 4); continue; }
        if (c.st !== 2) continue;
        const near = d2 <= RC * RC + RC, lo = Math.floor(Math.floor(c.hmin) / 32), hi = Math.floor(Math.floor(c.hmax) / 32);
        const y0 = near && rules !== 4 ? Math.min(lo, -1) : lo, y1 = near && rules === 4 ? Math.max(hi, 0) : hi;   // caves: below (inverted: above)
        for (let cy = y0; cy <= y1; cy++) {
          const b = blockOf(cx, cy, cz, true);
          if (b.st !== 0 || b.retryAt > t) continue;
          b.qs = qstamp;
          qpush('blk', b.key, cx, cy, cz, d2 * 4 + Math.abs(cy - cy0) + (b.ne >= 0 && b.ne < b.need ? -1e6 : 0));
        }
      }
      // edited blocks outside the column ranges (a fill in the sky, a dig below the caves) — right after the re-meshes
      for (const b of TS.blocks.values()) if (b.st === 0 && b.need > 0 && b.qs !== qstamp && inRing(b)) { b.qs = qstamp; qpush('blk', b.key, b.cx, b.cy, b.cz, -1e5); }
      queue.sort(byPri);
      TS.st.maxQueue = Math.max(TS.st.maxQueue, queue.length);
      dirtyQ = false; lastQ = t;
    }
    const inRing = b => { const dx = b.cx - cx0, dz = b.cz - cz0; return dx * dx + dz * dz <= TS.keep * TS.keep + TS.keep; };
    function unloadFar(){
      const K2 = TS.keep * TS.keep + TS.keep;
      for (const [k, b] of TS.blocks) {
        const dx = b.cx - cx0, dz = b.cz - cz0;
        if (dx * dx + dz * dz <= K2) continue;
        drop(b); TS.blocks.delete(k);
      }
      for (const [k, c] of TS.cols) { const dx = c.cx - cx0, dz = c.cz - cz0; if (dx * dx + dz * dz > (TS.keep + 3) * (TS.keep + 3)) TS.cols.delete(k); }
    }
    function drop(b){
      if (b.st === 2 && b.buf) { giveBack(b); }
      if (b.shown && TS.onRelease) TS.onRelease(b);
      pdFree(b.pd); b.pd = null;
      b.shown = false; b.st = -1;
    }
    function giveBack(b){
      const K = W[b.wi];
      if (b.buf && K && !K.dead) K.w.postMessage({ t: 'buf', buf: b.buf }, [b.buf]);
      b.buf = null;
    }
    // ── dispatch with budgets: ≤ 2 jobs in flight per worker (fresh priorities), page builder — ≤ 1 job per update ──
    function dispatch(){
      for (let wi = 0; wi < W.length; wi++) {
        const K = W[wi];
        if (!K || K.dead) continue;
        while (K.busy < 2 && qh < queue.length) send(K, queue[qh++]);
      }
      if (qh < queue.length && !W.some(K => K && !K.dead)) buildLocal(queue[qh++]);   // no live worker — build here, one job per update
    }
    function send(K, it){
      if (it.kind === 'col') {
        const c = TS.cols.get(it.key);
        if (!c || c.st !== 0) return false;
        c.st = 1;
        const id = ++jobId; jobs.set(id, { kind: 'col', key: it.key, wi: K.slot }); K.ids.add(id); K.busy++;
        K.w.postMessage({ t: 'col', id, seed, cx: it.cx, cz: it.cz });
        return true;
      }
      const b = TS.blocks.get(it.key);
      if (!b || b.st !== 0) return false;
      b.st = 1; b.need = Math.max(b.need, 0);
      const id = ++jobId; b.job = id; jobs.set(id, { kind: 'blk', key: it.key, wi: K.slot }); K.ids.add(id); K.busy++;
      TS.st.sent++;
      K.w.postMessage({ t: 'build', id, seed, cx: it.cx, cy: it.cy, cz: it.cz, ne });
      return true;
    }
    function buildLocal(it){
      const L = localCore(), t0 = now();
      TS.st.local++;
      if (it.kind === 'col') { L.colInfo(seed, it.cx, it.cz); const o = L.out(); const c = TS.cols.get(it.key); if (c) c.st = 1; gotCol(it.cx, it.cz, o.info[0], o.info[1], now() - t0); return; }
      const b = TS.blocks.get(it.key);
      if (!b || b.st !== 0) return;
      b.st = 1; const id = ++jobId; b.job = id;
      const fox = it.cx * 32, foy = it.cy * 32, foz = it.cz * 32;
      let n = 0; for (let e = 0; e < ne; e++) if (TE.touchesW(ed, e, it.cx, it.cy, it.cz, rules)) n++;
      const buf = L.edits(n); let k = 0;
      for (let e = 0; e < ne && k < n; e++) if (TE.touchesW(ed, e, it.cx, it.cy, it.cz, rules)) { buf.set(ed.subarray(e * 5, e * 5 + 5), k * 5); k++; }
      const q = L.build(seed, it.cx, it.cy, it.cz, n), o = L.out();
      let ab = null;
      if (q > 0 && compact) { ab = new ArrayBuffer(q * T1.COMPACT_BYTES); T1.compactPack(o, q, ab); }
      else if (q > 0) { ab = new ArrayBuffer(q * T1.BLOCK_BYTES); new Float32Array(ab, 0, q * 12).set(o.pos.subarray(0, q * 12)); new Int8Array(ab, q * 48, q * 16).set(o.nrm.subarray(0, q * 16)); new Uint8Array(ab, q * 64, q * 16).set(o.col.subarray(0, q * 16)); T1.physPack(o.pos, q, ab); }
      gotBlock(null, { key: it.key }, { id, q, buf: ab, pk: compact ? 2 : 1, hmin: o.info[0], hmax: o.info[1], trunc: o.info[3], ms: now() - t0, ne });
    }

    TS.update = (x, y, z) => {
      if (TS.dead) return;
      const cx = Math.floor(x / 32), cy = Math.floor(y / 32), cz = Math.floor(z / 32);
      if (cx !== cx0 || cz !== cz0 || cy !== cy0) { cx0 = cx; cy0 = cy; cz0 = cz; dirtyQ = true; unloadFar(); }
      if (dirtyQ && now() - lastQ > 60) rebuildQueue();
      dispatch();
    };
    TS.takeReady = () => {
      while (ready.length) { const b = ready.shift(); if (b.st === 2) return b; }
      return null;
    };
    TS.readyCount = () => ready.length;
    // the mesh copied the data — buffer back to its worker; the block is shown (and from now on it is also the physics ground)
    // posU16 (compact blocks): the mesh's own position array (the same u16 numbers) — the physics reads it, no second copy
    TS.recycle = (b, posU16) => { setPd(b, posU16); giveBack(b); b.st = 3; b.shown = true; };
    // ── edits ──
    function edit(x, y, z, r, mode){
      x = Q64(x); y = Q64(y); z = Q64(z); r = Q64(r);
      if (!(r > 0) || !isFinite(x + y + z)) return 0;
      if (ed.length < (ne + 1) * 5) { const a = new Float64Array(ed.length * 2); a.set(ed); ed = a; }
      ed[ne * 5] = x; ed[ne * 5 + 1] = y; ed[ne * 5 + 2] = z; ed[ne * 5 + 3] = r; ed[ne * 5 + 4] = mode;
      ne++; TS.st.edits = ne;
      bucketAdd(ne - 1);
      const msg = { t: 'edit', e: [x, y, z, r, mode] };
      for (const K of W) if (K && !K.dead) K.w.postMessage(msg);
      const list = TE.affected(x, y, z, r, [], mode, rules);
      for (const [cx, cy, cz] of list) {
        const b = blockOf(cx, cy, cz, inRing({ cx, cz }));
        if (!b) continue;
        b.need = ne;
        if (b.pd && TS.editDensity) b.phOld = 1;   // its shown mesh is from before this edit: physics reads the field (pdOf)
        if (b.st === 1 || b.st === 0) { b.st = 0; continue; }   // in flight → result will be stale (ne) and rebuilt; waiting → just rebuilt
        if (b.st === 2) { giveBack(b); b.st = 0; continue; }
        if (b.st === 3) { b.st = 0; }   // shown: keeps showing the old mesh until the new one is uploaded (no hole)
      }
      phClear();
      dirtyQ = true; lastQ = 0;
      return list.length;
    }
    TS.dig = (x, y, z, r = 2.5) => edit(x, y, z, r, 0);
    TS.fill = (x, y, z, r = 2) => edit(x, y, z, r, 1);
    TS.flatten = (x, y, z, r = 6) => edit(x, y, z, r, 2);   // a level pad at y (cut above, embankment below; 45° sides, ±16 m)
    TS.editCount = () => ne;
    TS.edits = () => ed.slice(0, ne * 5);

    // ── edits by 32 m column cell (xz bounds ± (r + 3), order kept): rays, column probes and point tests read only these ──
    const EB = new Map();   // colKey → [edit index, …] (ascending = edit order)
    function bucketAdd(e){
      const o = e * 5, m = T1.reachH(ed, e) + 3;
      for (let cx = Math.floor((ed[o] - m) / 32); cx <= Math.floor((ed[o] + m) / 32); cx++)
        for (let cz = Math.floor((ed[o + 2] - m) / 32); cz <= Math.floor((ed[o + 2] + m) / 32); cz++) {
          const k = TE.colKey(cx, cz); let L = EB.get(k);
          if (!L) { L = []; EB.set(k, L); }
          L.push(e);
        }
    }
    let rops = new Float64Array(5 * 16);
    // the edits whose sphere box holds (x, y, z) — exactly those that can change the SIGN of the density there (an edit whose
    // sphere misses the point keeps the sign of what it is applied to, in any order), so a solid/air test with them equals the
    // test with every edit. Cost: the edits of one 32 m cell, not all of them.
    function signOps(x, y, z){
      const L = EB.get(TE.colKey(Math.floor(x / 32), Math.floor(z / 32)));
      let n = 0;
      if (L) for (let i = 0; i < L.length; i++) {
        const o = L[i] * 5, fl = ed[o + 4] === 2, rv = fl ? FLAT_UP : ed[o + 3], r = fl ? ed[o + 3] + FLAT_UP : rv;   // reach (hot: inlined)
        if (Math.abs(x - ed[o]) > r || Math.abs(y - ed[o + 1]) > rv || Math.abs(z - ed[o + 2]) > r) continue;
        if (rops.length < (n + 1) * 5) { const a = new Float64Array(rops.length * 2); a.set(rops); rops = a; }
        for (let k = 0; k < 5; k++) rops[n * 5 + k] = ed[o + k];
        n++;
      }
      return n;
    }
    const solidAt = (x, y, z) => dens(x, y, z, rops, signOps(x, y, z)) > 0;
    // surface normal of the field at a point (−∇density, central differences; the edits of the point's 32 m cell — every edit
    // within r + 3 of it, so magnitudes near an edit are right): a dig crater's rim is a wall, not a 50° heightfield slope
    let cops = new Float64Array(5 * 16), ncops = 0;
    const NF = { nx: 0, ny: 1, nz: 0 };
    function fieldNormal(x, y, z, out){
      const L = EB.get(TE.colKey(Math.floor(x / 32), Math.floor(z / 32)));
      ncops = 0;
      if (L) for (let i = 0; i < L.length; i++) {
        if (cops.length < (ncops + 1) * 5) { const a = new Float64Array(cops.length * 2); a.set(cops); cops = a; }
        const o = L[i] * 5; for (let k = 0; k < 5; k++) cops[ncops * 5 + k] = ed[o + k];
        ncops++;
      }
      const e = 0.1, f = (a, b, c) => dens(a, b, c, cops, ncops);
      const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
      const l = Math.hypot(gx, gy, gz);
      if (!(l > 1e-12)) return false;
      out.nx = -gx / l; out.ny = -gy / l; out.nz = -gz / l;
      return true;
    }
    // TS.normal(x, y, z, out[, ray dx, dy, dz]) — Phys's terrain.normal hook. A horizontal ray (a wall probe of the parkour
    // finder) gets the normal of the FACE under the hit: the steepest of the hit and the face 0.3 m lower along the same ray.
    // Surface Nets rounds every rim over ~1 m, so 3 cm under a rim the slope is gentle even on a 2 m vertical face; this way the
    // rounded rim of a steep face is a ledge (crater, bank, fill) and a gentle slope is not.
    TS.normal = (x, y, z, out, dx, dy, dz) => {
      if (!fieldNormal(x, y, z, out)) return false;
      if (dx === undefined || !(Math.abs(dy) < 0.35) || Math.abs(out.ny) <= 0.3) return true;
      const hl = Math.hypot(dx, dz);
      if (!(hl > 1e-6)) return true;
      const ux = dx / hl, uz = dz / hl, y2 = y - 0.3;
      let a = -1.0;   // from 1 m before the hit, at the lower height, along the same horizontal direction
      if (solidAt(x + ux * a, y2, z + uz * a)) return true;
      for (let t = -0.9; t <= 0.6; t += 0.1) {
        if (!solidAt(x + ux * t, y2, z + uz * t)) { a = t; continue; }
        let lo = a, hi = t;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (solidAt(x + ux * m, y2, z + uz * m)) hi = m; else lo = m; }
        if (fieldNormal(x + ux * hi, y2, z + uz * hi, NF) && Math.abs(NF.ny) < Math.abs(out.ny)) { out.nx = NF.nx; out.ny = NF.ny; out.nz = NF.nz; }
        return true;
      }
      return true;
    };

    // ── physics, path 1: the SHOWN mesh. A block's triangles become its physics when terra-mesh shows it (TS.recycle), so the
    //    feet stand on the drawn surface — at dig craters, fills and steep river banks too — and a re-mesh swaps both at once.
    //    Positions are kept as Uint16 ((v + 1) · 1927: 0.52 mm, local range [−1, 33]); the xz cell index (34 × 34) is built on the
    //    first query of the block. ──
    const QS = T1.PHYS_Q || 1927, PQ = 1 / QS, G = 34, PD_EMPTY = { q: 0, p: null, up: null, off: null, ids: null };
    const PDP = new Map();   // pooled position arrays by quad class (≤ 2 MB kept)
    let pdPooled = 0;
    const pdCls = q => { let c = 256; while (c < q) c *= 2; return c; };
    function pdFree(pd){
      if (!pd || pd === PD_EMPTY || !pd.p) return;
      if (pd.shared) { pd.p = null; pd.up = null; pd.off = null; pd.ids = null; return; }   // the mesh owns it
      const c = pd.p.length / 12;
      if (pdPooled + pd.p.byteLength <= 2097152) { let L = PDP.get(c); if (!L) { L = []; PDP.set(c, L); } L.push(pd.p); pdPooled += pd.p.byteLength; }
      pd.p = null; pd.up = null; pd.off = null; pd.ids = null;
    }
    function setPd(b, shared){
      const old = b.pd;
      b.phOld = 0;
      if (b.q > 0 && shared) b.pd = { q: b.q, p: shared, up: null, off: null, ids: null, shared: true };
      else if (b.q > 0 && b.buf) {
        const q = b.q, c = pdCls(q), L = PDP.get(c);
        let p = L && L.pop();
        if (p) pdPooled -= p.byteLength; else p = new Uint16Array(c * 12);
        if (b.pk === 2) p.set(new Uint16Array(b.buf, 0, q * 12));   // compact block: positions first
        else if (b.pk) p.set(new Uint16Array(b.buf, q * 80, q * 12));   // the worker packed it (T1.physPack): memcpy
        else { const f = new Float32Array(b.buf, 0, q * 12); for (let i = 0; i < q * 12; i++) p[i] = Math.round((f[i] + 1) * QS); }
        b.pd = { q, p, up: null, off: null, ids: null };
      } else b.pd = PD_EMPTY;
      if (old && old !== b.pd) pdFree(old);
    }
    const gcell = u => { const g = Math.floor(u * PQ); return g < 0 ? 0 : g > 33 ? 33 : g; };   // quantized local coordinate → cell 0…33
    function pdIndex(pd){
      const q = pd.q, p = pd.p, off = new Uint32Array(G * G + 1);
      for (let pass = 0; pass < 2; pass++) {
        const cur = pass ? off.slice(0, G * G) : null;
        for (let i = 0; i < q; i++) {
          const o = i * 12;
          let x0 = p[o], x1 = x0, z0 = p[o + 2], z1 = z0;
          for (let m = 3; m < 12; m += 3) { const x = p[o + m], z = p[o + m + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
          const gx0 = gcell(x0), gx1 = gcell(x1), gz0 = gcell(z0), gz1 = gcell(z1);
          for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
            if (pass) pd.ids[cur[gz * G + gx]++] = i; else off[gz * G + gx + 1]++;
          }
        }
        if (!pass) { for (let k = 0; k < G * G; k++) off[k + 1] += off[k]; pd.ids = q <= 65535 ? new Uint16Array(off[G * G]) : new Uint32Array(off[G * G]); }
      }
      pd.off = off;
    }
    // block (cx, cy, cz) as physics: its shown mesh, PD_EMPTY (column known, the block is not part of the drawn set), null — unknown
    function pdOf(cx, cy, cz){
      const b = TS.blocks.get(TE.key(cx, cy, cz));
      if (b) return b.phOld ? null : b.pd;   // edited since shown → unknown → the density path (the edit counts at its tick on every device)
      const c = TS.cols.get(TE.colKey(cx, cz));
      return c && c.st === 2 ? PD_EMPTY : null;
    }
    const HY = new Float64Array(128), HU = new Uint8Array(128);
    let nh = 0;
    // every crossing of the vertical line (x, z) with the shown mesh from y0 up to the open sky → HY (world y, ascending) / HU (1 =
    // up-facing: air above); false — a block or a column on the way is not known yet. Facing: along a vertical line solid and air
    // alternate and above the column's top (its highest sample, fills included) there is only air, so the topmost crossing faces
    // up and the rest alternate — exact even on near-vertical faces and overhang lips, where one quad's own normal is not.
    function lineHits(x, z, y0, y1){
      nh = 0;
      const bx = Math.floor(x / 32), bz = Math.floor(z / 32);
      // a block's quads span local [−1, 32]: the east / north neighbour reaches 1 m back into this block
      const ex = x - bx * 32 >= 31 ? 1 : 0, ez = z - bz * 32 >= 31 ? 1 : 0;
      for (let kz = 0; kz <= ez; kz++) for (let kx = 0; kx <= ex; kx++) {   // the open sky: above every surface of these columns
        const ck = TE.colKey(bx + kx, bz + kz), c = TS.cols.get(ck);
        if (!c || c.st !== 2) return false;
        if (c.hmax + 1 > y1) y1 = c.hmax + 1;
        const L = EB.get(ck);
        if (L) for (let i = 0; i < L.length; i++) { const o = L[i] * 5, top = ed[o + 4] === 2 ? ed[o + 1] + 1 : ed[o + 1] + ed[o + 3] + 1; if (ed[o + 4] !== 0 && top > y1) y1 = top; }
      }
      const cyA = Math.floor((y0 - 32) / 32), cyB = Math.floor((y1 + 1) / 32);
      for (let kz = 0; kz <= ez; kz++) for (let kx = 0; kx <= ex; kx++) {
        const cx = bx + kx, cz = bz + kz, Lx = x - cx * 32, Lz = z - cz * 32;
        const g = gcell((Lz + 1) * QS) * G + gcell((Lx + 1) * QS);
        for (let cy = cyA; cy <= cyB; cy++) {
          const pd = pdOf(cx, cy, cz);
          if (!pd) return false;
          if (!pd.q) continue;
          if (!pd.off) pdIndex(pd);
          const p = pd.p, ids = pd.ids, oy = cy * 32;
          for (let k = pd.off[g], ke = pd.off[g + 1]; k < ke; k++) {
            const o = ids[k] * 12;
            for (let t = 0; t < 2; t++) {   // triangles (0, 1, 2) and (0, 2, 3)
              const ob = o + (t ? 6 : 3), oc = o + (t ? 9 : 6);
              const ax = p[o] * PQ - 1, az = p[o + 2] * PQ - 1, bxv = p[ob] * PQ - 1, bzv = p[ob + 2] * PQ - 1, cxv = p[oc] * PQ - 1, czv = p[oc + 2] * PQ - 1;
              const d = (bzv - czv) * (ax - cxv) + (cxv - bxv) * (az - czv);
              if (d > -1e-12 && d < 1e-12) continue;   // vertical triangle: no height over a point
              const w0 = ((bzv - czv) * (Lx - cxv) + (cxv - bxv) * (Lz - czv)) / d, w1 = ((czv - az) * (Lx - cxv) + (ax - cxv) * (Lz - czv)) / d, w2 = 1 - w0 - w1;
              if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
              const y = oy + w0 * (p[o + 1] * PQ - 1) + w1 * (p[ob + 1] * PQ - 1) + w2 * (p[oc + 1] * PQ - 1);
              if (y < y0 || y > y1 || nh >= HY.length) continue;
              HY[nh++] = y;
            }
          }
        }
      }
      orient();
      return true;
    }
    // sort the crossings, merge the duplicates of one crossing (where two triangles meet), then the topmost faces up, the rest alternate
    function orient(){
      for (let i = 1; i < nh; i++) {   // insertion sort by y (≤ 128, no garbage)
        const y = HY[i];
        let j = i - 1;
        while (j >= 0 && HY[j] > y) { HY[j + 1] = HY[j]; j--; }
        HY[j + 1] = y;
      }
      let m = 0;
      for (let i = 0; i < nh; i++) { if (m && HY[i] - HY[m - 1] < 1e-6) continue; HY[m++] = HY[i]; }
      nh = m;
      for (let i = 0; i < nh; i++) HU[i] = (nh - 1 - i) & 1 ? 0 : 1;
    }
    // floor under yTop (the highest up-facing crossing ≤ yTop); inside solid (the nearest crossing above is up-facing, ≤ 8 m) —
    // its top, as the density path did; NaN — unknown or nothing within 28 m below
    function meshGround(x, z, yTop){
      if (!lineHits(x, z, yTop - 28, yTop + 8)) return NaN;
      let best = -Infinity, above = Infinity, aboveUp = 0;
      for (let i = 0; i < nh; i++) {
        const y = HY[i];
        if (y <= yTop) { if (HU[i] && y > best) best = y; }
        else if (y < above) { above = y; aboveUp = HU[i]; }
      }
      if (above < Infinity && aboveUp) return above <= yTop + 8 ? above : yTop + 8;   // as the density path: up by at most 8 m per query
      return best > -Infinity ? best : NaN;
    }
    // is there terrain in the vertical segment (x, z, y0…y1)? 1 / 0, −1 unknown
    function meshBlocked(x, z, y0, y1){
      if (!lineHits(x, z, y0 - 8, y1 + 8)) return -1;
      let above = Infinity, aboveUp = 0;
      for (let i = 0; i < nh; i++) {
        const y = HY[i];
        if (y > y0 && y < y1) return 1;
        if (y >= y1 && y < above) { above = y; aboveUp = HU[i]; }
      }
      return aboveUp;   // no crossing inside: all solid if the surface above has air over it
    }

    // ── physics, path 2 (block not shown yet, or no workers/mesh at all): the density field at integer columns (cached; cleared
    //    by edits), bilinear between columns ──
    const PH = new Map(), DP = [];   // column key → { h, d: Float64Array(256) for y −128…127 (NaN = not computed) }; DP — pool of d
    const phClear = () => { for (const c of PH.values()) if (DP.length < 4096) DP.push(c.d); PH.clear(); };
    const PK = (ix, iz) => (ix + 33554432) * 67108864 + (iz + 33554432);
    let ops = new Float64Array(5 * 16), nops = 0;
    function colOps(ix, iz){   // edits that can reach this column (horizontal test, from its 32 m cell), order kept
      nops = 0;
      const L = EB.get(TE.colKey(Math.floor(ix / 32), Math.floor(iz / 32)));
      if (!L) return;
      for (let i = 0; i < L.length; i++) {
        const o = L[i] * 5, r = (ed[o + 4] === 2 ? ed[o + 3] + FLAT_UP : ed[o + 3]) + 1;
        if (Math.abs(ed[o] - ix) > r || Math.abs(ed[o + 2] - iz) > r) continue;
        if (ops.length < (nops + 1) * 5) { const a = new Float64Array(ops.length * 2); a.set(ops); ops = a; }
        ops.set(ed.subarray(o, o + 5), nops * 5); nops++;
      }
    }
    function phCol(ix, iz){
      const k = PK(ix, iz);
      let c = PH.get(k);
      if (!c) {
        if (PH.size > 2048) phClear();
        const d = DP.pop() || new Float64Array(256);
        d.fill(NaN);
        c = { h: T1.height(seed, ix, iz), d, ops: null, nops: 0 };
        colOps(ix, iz);
        if (nops) { c.ops = ops.slice(0, nops * 5); c.nops = nops; }
        PH.set(k, c);
      }
      return c;
    }
    function dAt(c, ix, y, iz){
      const i = y + 128;
      if (i >= 0 && i < 256) { const v = c.d[i]; if (v === v) return v; }
      let v = dens(ix, y, iz, c.ops, c.nops);
      if (i >= 0 && i < 256) c.d[i] = v;
      return v;
    }
    function surface(ix, iz, yTop){
      const c = phCol(ix, iz), j = Math.floor(yTop);
      if (dAt(c, ix, j, iz) <= 0) {
        for (let k = j; k > j - 28; k--) { const a = dAt(c, ix, k - 1, iz); if (a > 0) { const b = dAt(c, ix, k, iz); return k - 1 + a / (a - b); } }
        return j - 28;
      }
      for (let k = j; k < j + 8; k++) { const b = dAt(c, ix, k + 1, iz); if (b <= 0) { const a = dAt(c, ix, k, iz); return k + a / (a - b); } }
      return j + 8;
    }
    TS.st.phMesh = 0; TS.st.phDens = 0;
    TS.meshPhysics = o.meshPhysics !== false;   // false → always the density path (the old behaviour)
    // T-145 review (TECH-3): an edited block keeps DRAWING its old mesh until the re-mesh is uploaded (no hole), but its physics
    // switches to the density field at the edit's tick — before, the feet stood on the old mesh until the upload, a moment that
    // depends on FPS, the phone/PC upload budget and the worker. Rollback: create({ editDensity: false }).
    TS.editDensity = o.editDensity !== false;
    TS.ground = (x, z, yRef) => {
      const yt = yRef + 1.1;
      if (TS.meshPhysics) { const m = meshGround(x, z, yt); if (m === m) { TS.st.phMesh++; return m; } }
      TS.st.phDens++;
      return TS.densityGround(x, z, yRef);
    };
    TS.densityGround = (x, z, yRef) => {
      const x0 = Math.floor(x), z0 = Math.floor(z), fx = x - x0, fz = z - z0, yt = yRef + 1.1;
      const a = surface(x0, z0, yt), b = surface(x0 + 1, z0, yt), c = surface(x0, z0 + 1, yt), d = surface(x0 + 1, z0 + 1, yt);
      return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    };
    // terrain in the vertical cylinder (x, z, r) between y0 and y1 (m): the centre and 4 points at 0.7 r (parkour "room on top",
    // crouch / stand checks through Phys.blocked)
    TS.blocked = (x, z, y0, y1, r = 0) => {
      const k = r * 0.7;
      for (let i = 0; i < 5; i++) {
        const px = x + (i === 1 ? k : i === 2 ? -k : 0), pz = z + (i === 3 ? k : i === 4 ? -k : 0);
        const m = TS.meshPhysics ? meshBlocked(px, pz, y0, y1) : -1;
        if (m === 1) return true;
        if (m === -1 && (solidAt(px, y0 + 0.05, pz) || solidAt(px, (y0 + y1) / 2, pz) || solidAt(px, y1 - 0.05, pz))) return true;
        if (!(r > 0)) break;
      }
      return false;
    };
    // all crossings of a vertical line with the shown mesh (tests, tools): [[y, up], …] or null when a block is not shown
    TS.meshHits = (x, z, y0, y1) => { if (!lineHits(x, z, y0, y1)) return null; const r = []; for (let i = 0; i < nh; i++) r.push([HY[i], HU[i]]); return r.sort((a, b) => a[0] - b[0]); };
    TS.water = (x, z) => (phCol(Math.round(x), Math.round(z)).h < -0.3 ? 0 : -Infinity);
    TS.height = hgt;
    TS.density = (x, y, z) => dens(x, y, z, ed, ne);   // the core's point density (every edit; exact magnitude)
    // climate at a point (gen 2: logical climate by rules; gen 1: the v1 biome only) → biome id; out[8] as T1.climate
    const CLO = new Float64Array(8);
    TS.climate = (x, z, out = CLO) => { if (gen === 2) return T1.climate(seed, x, z, rules, param, out); out.fill(NaN); out[6] = T1.height(seed, x, z); return (out[7] = T1.biome(seed, x, z)); };
    // the lowest terrain above y on the vertical line (x, z) — cave roofs, overhangs, fills: the down-facing crossing of the shown
    // mesh; not shown yet → the density field in 0.25 m steps (≤ 8 m); Infinity — nothing within 8 m (or open sky)
    TS.ceiling = (x, z, y) => {
      if (TS.meshPhysics && lineHits(x, z, y - 0.5, y + 8)) {
        let best = Infinity;
        for (let i = 0; i < nh; i++) if (!HU[i] && HY[i] > y && HY[i] < best) best = HY[i];
        return best;
      }
      for (let t = 0.25; t <= 8; t += 0.25) if (solidAt(x, y + t, z)) { let lo = y + t - 0.25, hi = y + t; for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (solidAt(x, m, z)) hi = m; else lo = m; } return hi; }
      return Infinity;
    };
    // where the sky ends above (x, z) (m) — for the weather (precip.js skyTop: rain stops on the floor of a dug pit, not at the old
    // ground; a fill or a flattened pad shelters what is under it). The natural surface, then the column's edits in order: a dig
    // sphere that reaches the top opens it down to the sphere's bottom, a fill sphere raises it to its top, a flatten pad cuts down
    // to the pad (45° walls, up to FLAT_UP above it) and fills up to it (45° slopes, down to FLAT_DN). Caves and hollows under the
    // top do not matter (rain falls on the top). Cost: the edits of one 32 m cell.
    const FLAT_DN = T1.FLAT_DN ?? FLAT_UP;
    TS.skyTop = (x, z) => {
      let top = hgt(x, z);
      const L = ne ? EB.get(TE.colKey(Math.floor(x / 32), Math.floor(z / 32))) : null;
      if (L) for (let i = 0; i < L.length; i++) {
        const o = L[i] * 5, dx = x - ed[o], dz = z - ed[o + 2], ey = ed[o + 1], r = ed[o + 3], mode = ed[o + 4], d2 = dx * dx + dz * dz;
        if (mode === 2) {
          const hd = Math.sqrt(d2) - r, cut = ey + (hd > 0 ? hd : 0), ft = ey + (hd > 0 ? -hd : 0);
          if (top > cut && top <= ey + FLAT_UP) top = cut;          // air: max(0, hd) ≤ y − pad ≤ FLAT_UP (higher ground stays)
          if (ft > ey - FLAT_DN && ft > top) top = ft;               // solid: −FLAT_DN < y − pad < min(0, −hd)
          continue;
        }
        if (d2 >= r * r) continue;
        const s = Math.sqrt(r * r - d2);
        if (mode === 0) { if (top > ey - s && top <= ey + s) top = ey - s; }
        else if (ey + s > top) top = ey + s;
      }
      return top;
    };
    TS.solid = solidAt;                                              // the same sign, from the edits of one cell (fast)
    // ray march through the density field (m); first crossing into solid. Only signs are tested → signOps (one cell's edits)
    TS.ray = (ox, oy, oz, dx, dy, dz, maxT = 60) => {
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      let a = 0;
      if (solidAt(ox, oy, oz)) return { t: 0, x: ox, y: oy, z: oz };
      for (let t = 0.35; t <= maxT; t += 0.35) {
        if (solidAt(ox + dx * t, oy + dy * t, oz + dz * t)) {
          let lo = a, hi = t;
          for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (solidAt(ox + dx * m, oy + dy * m, oz + dz * m)) hi = m; else lo = m; }
          return { t: hi, x: ox + dx * hi, y: oy + dy * hi, z: oz + dz * hi };
        }
        a = t;
      }
      return null;
    };
    TS.stats = () => {
      let shown = 0, quads = 0, inflight = 0;
      for (const b of TS.blocks.values()) { if (b.shown) { shown++; quads += b.q; } if (b.st === 1) inflight++; }
      return { ...TS.st, blocks: TS.blocks.size, shown, quads, inflight, queued: queue.length - qh, ready: ready.length, cols: TS.cols.size, workers: W.filter(K => K && !K.dead).length,
        kinds: W.map(K => K ? K.kind || '…' : '-').join(','), phCols: PH.size, buildAvg: TS.st.built ? TS.st.buildMs / TS.st.built : 0 };
    };
    TS.dispose = () => {
      TS.dead = true;
      for (const K of W) { try { K && K.w.terminate(); } catch (e) {} }
      W.length = 0; jobs.clear(); ready.length = 0; queue.length = 0; QP.length = 0;
      TS.blocks.clear(); TS.cols.clear(); PH.clear(); DP.length = 0;
      local = null; TS.onRelease = null;
    };
    return TS;
  };
})();

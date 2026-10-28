// ═══════════════════════════════════════
//  D37 TERRAIN (T-111, W1) — meshes of the T1 terrain blocks for three r149: pooled BufferGeometry (no new GPU buffer per block in
//  the steady state), one shared index buffer (quads 0-1-2 0-2-3), vertex colours (sRGB → linear in the vertex shader), D37E
//  material (R.mat: fog, shadows, weather patches of the engine), floating anchor (block meshes are placed at origin − anchor).
// ═══════════════════════════════════════
// TM = D37E.terraMesh(R, TS, { unit: E.UNIT, shadows: true })
//   TM.upload(maxMs, maxN) — copy ready blocks from TS (terra.js) into geometries within the frame budget
//   TM.setAnchor(ax, az)   — meters (multiple of 32); every block mesh moves (call inside the logic step together with the player)
//   TM.group (scaled by unit: children are in meters), TM.stats(), TM.dispose()
(() => {
  const E = window.D37E = window.D37E || {};
  E.terraMesh = function (R, TS, o = {}){
    const T = R.T, U = o.unit ?? E.UNIT ?? 1, shadows = o.shadows !== false;
    const TM = { group: new T.Group(), dead: false, ax: 0, az: 0 };
    TM.group.name = 'terra';
    TM.group.scale.setScalar(U);
    R.scene.add(TM.group);
    // material: the engine's standard material, vertex colours; the core's colours are display (sRGB) values
    const mat = R.mat('#ffffff', { rough: .93, env: .35 }).clone();
    mat.vertexColors = true;
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n#if defined( USE_COLOR_ALPHA )\n\tvColor.rgb = pow( max( vColor.rgb, vec3( 0.0 ) ), vec3( 2.2 ) );\n#elif defined( USE_COLOR )\n\tvColor = pow( max( vColor, vec3( 0.0 ) ), vec3( 2.2 ) );\n#endif');
    };
    mat.customProgramCacheKey = () => 'd37terra1';
    (R.own || (R.own = [])).push(mat);
    TM.mat = mat;
    // shared indices: quad k → 4k, 4k+1, 4k+2, 4k, 4k+2, 4k+3
    const idx = {};
    function indexFor(quads){
      const big = quads > 16384, k = big ? 'u32' : 'u16';
      if (idx[k]) return idx[k];
      const n = big ? 65536 : 16384, a = big ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
      for (let i = 0; i < n; i++) { const v = i * 4, j = i * 6; a[j] = v; a[j + 1] = v + 1; a[j + 2] = v + 2; a[j + 3] = v; a[j + 4] = v + 2; a[j + 5] = v + 3; }
      return (idx[k] = new T.BufferAttribute(a, 1));
    }
    const SPH = new T.Sphere(new T.Vector3(16, 16, 16), 16 * Math.sqrt(3) + 2), BOX = new T.Box3(new T.Vector3(-1, -1, -1), new T.Vector3(33, 33, 33));
    const pool = new Map();   // capacity (quads) → [{ mesh, g, cap }]
    const live = new Map();   // block key → entry
    const ST = { uploads: 0, upMs: 0, upMax: 0, created: 0, reused: 0, disposed: 0, bytes: 0, lastFrameMs: 0 };
    // capacity classes: multiples of 384 quads up to 6144, then of 2048 (≤ 30 KB / 160 KB slack per block instead of up to 2×)
    const capOf = q => (q <= 6144 ? Math.max(384, Math.ceil(q / 384) * 384) : Math.ceil(q / 2048) * 2048);
    let spare = 0;
    const SPARE = o.spare ?? (E.isMobile?.() ? 24 : 48);   // spare geometries kept for reuse (all classes together)
    function make(cap){
      const g = new T.BufferGeometry();
      const pos = new T.BufferAttribute(new Float32Array(cap * 12), 3), nrm = new T.BufferAttribute(new Int8Array(cap * 16), 4, true), col = new T.BufferAttribute(new Uint8Array(cap * 16), 4, true);
      pos.setUsage(T.DynamicDrawUsage); nrm.setUsage(T.DynamicDrawUsage); col.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', pos); g.setAttribute('normal', nrm); g.setAttribute('color', col);
      g.setIndex(indexFor(cap));
      g.boundingSphere = SPH.clone(); g.boundingBox = BOX.clone();
      const mesh = new T.Mesh(g, mat);
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = shadows; mesh.receiveShadow = shadows;
      ST.created++; ST.bytes += cap * 80;
      return { mesh, g, cap, pos, nrm, col, key: 0, cx: 0, cy: 0, cz: 0 };
    }
    function get(q){
      const cap = capOf(q), L = pool.get(cap);
      if (L && L.length) { ST.reused++; spare--; return L.pop(); }
      // a spare of a bigger class (up to 2×) instead of a new geometry: fast flight unloads as many blocks as it loads — reuse, not GC
      let best = 0;
      for (const [c, M] of pool) if (M.length && c > cap && c <= cap * 2 && (!best || c < best)) best = c;
      if (best) { ST.reused++; spare--; return pool.get(best).pop(); }
      return make(cap);
    }
    function put(en){
      TM.group.remove(en.mesh);
      if (spare < SPARE) { const L = pool.get(en.cap) || []; L.push(en); pool.set(en.cap, L); spare++; return; }
      // too many spare geometries of this size — free (detach the shared index first: dispose() would delete it for everyone)
      en.g.setIndex(null); en.g.dispose(); ST.disposed++; ST.bytes -= en.cap * 80;
    }
    function place(en){
      en.mesh.position.set(en.cx * 32 - TM.ax, en.cy * 32, en.cz * 32 - TM.az);
      en.mesh.updateMatrix();
    }
    TS.onRelease = b => { const en = live.get(b.key); if (en) { live.delete(b.key); put(en); } };
    const now = () => performance.now();
    TM.upload = (maxMs = 2, maxN = 4) => {
      const t0 = now();
      let n = 0;
      while (n < maxN && now() - t0 < maxMs) {
        const b = TS.takeReady();
        if (!b) break;
        const t1 = now();
        const old = live.get(b.key);
        if (b.q > 0) {
          const q = b.q, en = get(q), buf = b.buf;
          en.pos.array.set(new Float32Array(buf, 0, q * 12)); en.pos.updateRange.offset = 0; en.pos.updateRange.count = q * 12; en.pos.needsUpdate = true;
          en.nrm.array.set(new Int8Array(buf, q * 48, q * 16)); en.nrm.updateRange.offset = 0; en.nrm.updateRange.count = q * 16; en.nrm.needsUpdate = true;
          en.col.array.set(new Uint8Array(buf, q * 64, q * 16)); en.col.updateRange.offset = 0; en.col.updateRange.count = q * 16; en.col.needsUpdate = true;
          en.g.setDrawRange(0, q * 6);
          en.key = b.key; en.cx = b.cx; en.cy = b.cy; en.cz = b.cz;
          place(en);
          TM.group.add(en.mesh);
          live.set(b.key, en);
        } else live.delete(b.key);
        if (old) put(old);   // the new mesh is in place first — no hole while re-meshing an edit
        TS.recycle(b);
        const ms = now() - t1;
        ST.uploads++; ST.upMs += ms; if (ms > ST.upMax) ST.upMax = ms;
        n++;
      }
      ST.lastFrameMs = now() - t0;
      if (n && shadows) R.shadowDirty?.();   // a dig, a fill or a streamed block casts its shadow now, not after the 1.5 s idle refresh
      return n;
    };
    TM.setAnchor = (ax, az) => {
      TM.ax = ax; TM.az = az;
      for (const en of live.values()) place(en);
      if (shadows) R.shadowDirty?.();
    };
    TM.stats = () => {
      return { ...ST, live: live.size, spare, mb: +(ST.bytes / 1048576).toFixed(1), upAvg: ST.uploads ? ST.upMs / ST.uploads : 0 };
    };
    TM.dispose = () => {
      TM.dead = true;
      TS.onRelease = null;
      const all = [...live.values()]; for (const L of pool.values()) all.push(...L);
      for (const en of all) { TM.group.remove(en.mesh); en.g.setIndex(null); en.g.dispose(); }
      live.clear(); pool.clear();
      for (const k in idx) delete idx[k];
      R.scene.remove(TM.group);
    };
    return TM;
  };
})();

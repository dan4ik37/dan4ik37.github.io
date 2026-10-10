// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — ландшафт (как Terrain в Roblox): сетка высот, кисти (поднять, опустить, сгладить, выровнять,
//  покрасить), 4 материала с плавным переходом (трава, песок, камень, снег; на крутых склонах — камень сам), вода
// ═══════════════════════════════════════
// TR = D37E.terrain(R, phys, { size, n }) — квадрат size × size (по умолчанию 192) с центром в (0, 0), n × n точек высоты.
// TR.sample(x, z) — высота (физика берёт отсюда: phys.terrain = TR); TR.brush(инструмент, x, z, радиус, сила, dt, { target, ch });
// TR.setWater(вкл, уровень); TR.cursor(x, z, r) — кольцо кисти; TR.toJSON() (async: сжатие) / TR.fromJSON(data) (async);
// TR.setEnabled(вкл) — без ландшафта мир стоит на плоской земле. Материалы: 0 трава, 1 песок, 2 камень, 3 снег.
(() => {
  const E = window.D37E = window.D37E || {};
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  async function pack(u8){
    if (typeof CompressionStream === 'undefined') return { raw: b64(u8) };
    const cs = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
    return { gz: b64(new Uint8Array(await new Response(cs).arrayBuffer())) };
  }
  async function unpack(p){
    if (!p) return null;
    if (p.raw) return unb64(p.raw);
    if (p.gz && typeof DecompressionStream !== 'undefined') {
      const ds = new Blob([unb64(p.gz)]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return null;
  }
  const COLS = [[.38, .66, .3], [.9, .82, .6], [.55, .56, .58], [.95, .97, 1]];   // для «низкой» графики — цвета вершин

  E.terrain = function (R, ph, o = {}){
    const T = R.T, size = o.size || 192, n = o.n || 129, cell = size / (n - 1), half = size / 2, low = R.q === 'low';
    const H = new Float32Array(n * n), W = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) W[i * 4] = 255;
    const TR = { size, n, cell, H, W, enabled: true, water: { on: false, level: -1 }, dirty: false };

    // ── Сетка ──
    const g = new T.PlaneGeometry(size, size, n - 1, n - 1);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    g.setAttribute('splat', new T.BufferAttribute(W, 4, true));
    let col = null;
    if (low) { col = new Float32Array(n * n * 3); g.setAttribute('color', new T.BufferAttribute(col, 3)); }
    let mat;
    if (low) mat = new T.MeshLambertMaterial({ vertexColors: true });
    else {
      mat = new T.MeshStandardMaterial({ color: '#ffffff', roughness: .95, metalness: 0, envMapIntensity: .55 });
      const U = { tG: { value: R.proc('grass') }, tS: { value: R.proc('sand') }, tR: { value: R.proc('rock') }, tW: { value: R.proc('snow') }, tile: { value: 2.4 * (E.UNIT || 1) } };
      mat.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNor;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNor = normalize(mat3(modelMatrix) * normal);');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D tG; uniform sampler2D tS; uniform sampler2D tR; uniform sampler2D tW; uniform float tile; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNor;')
          .replace('#include <map_fragment>', `vec2 tuv = vWPos.xz / tile;
vec4 w = vSplat;
w.z = max(w.z, smoothstep(0.84, 0.62, vWNor.y));
w /= max(1e-3, w.x + w.y + w.z + w.w);
vec3 tc = texture2D(tG, tuv).rgb * w.x + texture2D(tS, tuv).rgb * w.y + texture2D(tR, tuv * 0.8).rgb * w.z + texture2D(tW, tuv).rgb * w.w;
diffuseColor.rgb *= tc;`);
      };
      mat.customProgramCacheKey = () => 'd37-terrain';
    }
    const mesh = new T.Mesh(g, mat);
    mesh.userData.terrain = true;
    if (R.r.shadowMap.enabled) { mesh.receiveShadow = true; mesh.castShadow = true; }
    R.scene.add(mesh);
    TR.mesh = mesh;
    // вода
    const wmesh = new T.Mesh(new T.PlaneGeometry(size, size), R.water('#3aa6dc'));
    wmesh.rotation.x = -Math.PI / 2; wmesh.visible = false; wmesh.renderOrder = 2;
    R.scene.add(wmesh);

    function refresh(x0 = 0, x1 = n - 1, z0 = 0, z1 = n - 1){
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) { const i = iz * n + ix; pos.setY(i, H[i]); }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.attributes.splat.needsUpdate = true;
      if (col) {
        for (let i = 0; i < n * n; i++) { let r = 0, gg = 0, b = 0, s = 0; for (let k = 0; k < 4; k++) { const w = W[i * 4 + k] / 255; r += COLS[k][0] * w; gg += COLS[k][1] * w; b += COLS[k][2] * w; s += w; } s = s || 1; col[i * 3] = r / s; col[i * 3 + 1] = gg / s; col[i * 3 + 2] = b / s; }
        g.attributes.color.needsUpdate = true;
      }
      g.computeBoundingSphere();
      R.shadowDirty?.();   // земля отбрасывает тень — карту теней перерисовать
    }
    refresh();

    // ── Высота в точке (билинейно; за краем — край) ──
    TR.sample = (x, z) => {
      let fx = (x + half) / cell, fz = (z + half) / cell;
      fx = fx < 0 ? 0 : fx > n - 1 ? n - 1 : fx; fz = fz < 0 ? 0 : fz > n - 1 ? n - 1 : fz;
      const ix = Math.min(n - 2, fx | 0), iz = Math.min(n - 2, fz | 0), tx = fx - ix, tz = fz - iz, i = iz * n + ix;
      return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + n] * (1 - tx) + H[i + n + 1] * tx) * tz;
    };

    // ── Кисти ──
    TR.brush = (tool, x, z, radius, strength, dt, opt = {}) => {
      const r = radius / cell, cx = (x + half) / cell, cz = (z + half) / cell;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r)), z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(n - 1, Math.ceil(cz + r));
      if (x0 > x1 || z0 > z1) return;
      const k = Math.min(1, strength * dt);
      const src = tool === 'smooth' ? H.slice() : null;
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix - cx, iz - cz) / r; if (d >= 1) continue;
        const f = 1 - d * d * (3 - 2 * d), i = iz * n + ix;
        if (tool === 'raise') H[i] += f * k * 8;
        else if (tool === 'lower') H[i] -= f * k * 8;
        else if (tool === 'flatten') H[i] += (opt.target - H[i]) * Math.min(1, f * k * 6);
        else if (tool === 'smooth') {
          let s = 0, c = 0;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const jx = ix + dx, jz = iz + dz; if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue; s += src[jz * n + jx]; c++; }
          H[i] += (s / c - H[i]) * Math.min(1, f * k * 8);
        } else if (tool === 'paint') {
          const ch = opt.ch | 0, add = f * k * 900, w = W.subarray(i * 4, i * 4 + 4);
          const nw = Math.min(255, w[ch] + add), rest = 255 - nw, others = w[0] + w[1] + w[2] + w[3] - w[ch];
          for (let q = 0; q < 4; q++) if (q !== ch) w[q] = others > 0 ? Math.round(w[q] / others * rest) : 0;
          w[ch] = 255 - (w[0] + w[1] + w[2] + w[3] - w[ch]);
        }
        H[i] = Math.max(-30, Math.min(80, H[i]));
      }
      TR.dirty = true;
      refresh(x0, x1, z0, z1);
    };
    TR.setWater = (on, level) => { TR.water = { on: !!on, level: Number.isFinite(+level) ? +level : TR.water.level }; wmesh.visible = TR.enabled && TR.water.on; wmesh.position.y = TR.water.level; TR.dirty = true; };
    TR.setEnabled = on => {
      TR.enabled = !!on; mesh.visible = TR.enabled; wmesh.visible = TR.enabled && TR.water.on;
      ph.terrain = TR.enabled ? TR : null;
      R.shadowDirty?.();
    };
    // кольцо кисти
    let ring = null;
    TR.cursor = (x, z, r) => {
      if (x == null) { if (ring) ring.visible = false; return; }
      if (!ring) {
        const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(new Float32Array(65 * 3), 3));
        ring = new T.Line(rg, new T.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: .9, toneMapped: false }));
        ring.renderOrder = 998; R.scene.add(ring);
      }
      const p = ring.geometry.attributes.position;
      for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; p.setXYZ(i, px, TR.sample(px, pz) + .12, pz); }
      p.needsUpdate = true; ring.geometry.computeBoundingSphere(); ring.visible = true;
    };
    TR.toJSON = async () => {
      if (!TR.dirty) return { size, n, flat: true, enabled: TR.enabled, water: TR.water };
      const h16 = new Int16Array(n * n); for (let i = 0; i < n * n; i++) h16[i] = Math.round(H[i] * 20);
      return { size, n, enabled: TR.enabled, water: TR.water, h: await pack(new Uint8Array(h16.buffer)), w: await pack(W) };
    };
    // Без сжатия, сразу (при закрытии вкладки ждать сжатие нельзя)
    TR.toJSONSync = () => {
      if (!TR.dirty) return { size, n, flat: true, enabled: TR.enabled, water: TR.water };
      const h16 = new Int16Array(n * n); for (let i = 0; i < n * n; i++) h16[i] = Math.round(H[i] * 20);
      return { size, n, enabled: TR.enabled, water: TR.water, h: { raw: b64(new Uint8Array(h16.buffer)) }, w: { raw: b64(W) } };
    };
    TR.fromJSON = async d => {
      if (!d || d.n !== n || d.size !== size) return false;
      if (!d.flat) {
        const hb = await unpack(d.h), wb = await unpack(d.w);
        if (hb && hb.length === n * n * 2) { const h16 = new Int16Array(hb.buffer.slice(hb.byteOffset, hb.byteOffset + hb.length)); for (let i = 0; i < n * n; i++) H[i] = h16[i] / 20; }
        if (wb && wb.length === n * n * 4) W.set(wb);
        TR.dirty = true;
      }
      refresh();
      TR.setEnabled(d.enabled !== false);
      TR.setWater(d.water?.on, d.water?.level);
      return true;
    };
    TR.dispose = () => { R.scene.remove(mesh); R.scene.remove(wmesh); g.dispose(); mat.dispose(); wmesh.geometry.dispose(); if (ring) { R.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); } if (ph.terrain === TR) ph.terrain = null; };
    ph.terrain = TR;
    return TR;
  };
})();

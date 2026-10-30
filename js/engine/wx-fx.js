// ═══════════════════════════════════════
//  D37E.wxfx — cheap visuals of the biome weather specials (T-135 WX2; BIOME_WEATHER.md v2 §5): a sand / dust / snow sky and fog
//  tint, visibility, grains in the air and low streaks along the ground (sand saltation, позёмка), hail sizes, louder wind.
// ═══════════════════════════════════════
// Shared engine code (English comments). Loads after wx.js (and three.js); precip.js attaches it by itself, a game with its own
// particle path (Kubomir) attaches it directly. Pools are created lazily on the first special and stay hidden (0 draw calls) while
// nothing blows; typed arrays only, 0 allocations per frame. 'low' graphics: tint and fog only (no particles), phone and 'mid': 45 %.
//   F = D37E.wxfx.attach(R, { top(xw, zw), origin(), q })   top — where the sky ends above a column (roof or ground, world coords);
//     origin — the world offset of the render coords; q — particle share (0 / .45 / 1)
//   F.frame(dt, S, amt, lum) — S: the weather sample (W.at) with the special fields; amt: ⚙️ particle share 0…1; lum: day light
//   F.skyInto(wx) — adds { dust, tint, tintK, vis, flat } (smoothed) to an R.setWeather object; F.pushSky(R) — the same for hosts
//     that darken the sky themselves (Kubomir: sky: false) — pushes only when a special shows, null when it is over
//   F.stats(), F.dispose()
//   D37E.wxfx.planetSky(S, out) — the same numbers for the planet's own sky (planet-view V.setWeather; the integrator wires it)
// Flag: D37E.wxfx.ON = false — no special visuals (the core still runs: AI vision, records). Graphics guard key 'wxfx'.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.wxfx && E.wxfx.v) return;
  const FX = E.wxfx = { v: 1, ON: true };
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const lin = c => c.map(v => Math.pow(v, 2.2));
  // dust colours (sRGB) by S.dustC: sand, ochre, grey, white (snow), smoke
  const DUST_RGB = [[.86, .70, .47], [.78, .66, .45], [.68, .68, .68], [.95, .97, 1], [.52, .46, .43]];
  const TINT_LIN = {};
  const tintLin = name => TINT_LIN[name] || (TINT_LIN[name] = lin((E.wx && E.wx.TINTS && E.wx.TINTS[name]) || [.8, .8, .8]));
  const RAD = 14;

  // smoothed sky numbers of a sample (shared by attach and the planet helper)
  function Sky(){ return { dust: 0, tintK: 0, flat: 0, vis: 510, tint: [0, 0, 0], key: '' }; }
  function skyStep(K, S, d){
    const on = FX.ON && S && S.sp !== undefined && !(E.gfxSafe && E.gfxSafe('wxfx'));
    const k = 1 - Math.exp(-d / 3), tK = on ? +S.tintK || 0 : 0, du = on ? +S.dust || 0 : 0, fl = on ? +S.flat || 0 : 0, vis = on ? +S.vis || 510 : 510;
    K.dust += (du - K.dust) * k; K.tintK += (tK - K.tintK) * k; K.flat += (fl - K.flat) * k;
    K.vis += (vis - K.vis) * k;
    if (on && S.tint) { const t = tintLin(S.tint); for (let j = 0; j < 3; j++) K.tint[j] += (t[j] - K.tint[j]) * (K.key ? k : 1); K.key = S.tint; }
    if (K.dust < .01 && !du) K.dust = 0; if (K.tintK < .01 && !tK) K.tintK = 0; if (K.flat < .01 && !fl) K.flat = 0;   // the tail snaps off
    if (Math.abs(K.vis - vis) < 3) K.vis = vis;
    return K;
  }
  FX.planetSky = (S, out = {}) => { const K = out._k || (out._k = Sky()); skyStep(K, S, .5); out.dust = K.dust; out.tintK = K.tintK; out.flat = K.flat; out.vis = K.vis < 509 ? K.vis : 0; out.tint = K.tint; return out; };

  FX.attach = (R, o = {}) => {
    const T = R.T || root.THREE, cam = R.camera;
    const top = typeof o.top === 'function' ? o.top : () => -1e9;
    const origin = typeof o.origin === 'function' ? o.origin : () => [0, 0];
    const q = cl(+o.q || 0, 0, 1);
    const F = { K: Sky(), q, sent: { dust: -1, tintK: -1, flat: -1, vis: -1 }, pushed: false };
    // ── pools (lazy): grains — Points, streaks — LineSegments (bottom opaque, the tail fades) ──
    const NG = Math.round(500 * q), NS = Math.round(270 * q);
    let gO = null, sO = null, gPos, gCol, sPos, sCol, tex = null, gN = 0, sN = 0, gW = 0, sW = 0;
    const gx = new Float32Array(NG), gy = new Float32Array(NG), gz = new Float32Array(NG), gh = new Float32Array(NG), gb = new Float32Array(NG), gl = new Uint8Array(NG);
    const TX = new Float32Array(8), TZ = new Float32Array(8), TY = new Float32Array(8);   // turbulence of 8 phase groups (trig per frame, not per grain)
    let colC = null, colL = -1, colDirty = false, sColC = null, sColL = -1;
    const sx = new Float32Array(NS), sy = new Float32Array(NS), sz = new Float32Array(NS), sl = new Float32Array(NS), sv = new Float32Array(NS), sL = new Uint8Array(NS);
    const RS = new Uint32Array([0x9e3779b9]);   // the state in a typed array: a big uint32 in a closure slot is a new heap number per store
    const rnd = () => { RS[0] += 0x6d2b79f5; let t = RS[0] | 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    function make(){
      if (gO || !T || !q) return;
      const n = 16, d = new Uint8Array(n * n * 4);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = (x + .5) / n * 2 - 1, dy = (y + .5) / n * 2 - 1, r = Math.sqrt(dx * dx + dy * dy), i = (y * n + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = r >= 1 ? 0 : Math.round(255 * Math.min(1, (1 - r) * 1.6)); }
      tex = new T.DataTexture(d, n, n, T.RGBAFormat); tex.magFilter = tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
      gPos = new Float32Array(NG * 3); gCol = new Float32Array(NG * 3);
      let g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(gPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(gCol, 3).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      gO = new T.Points(g, new T.PointsMaterial({ size: .07, map: tex, vertexColors: true, transparent: true, opacity: .8, depthWrite: false, sizeAttenuation: true }));
      gO.frustumCulled = false; gO.visible = false; gO.renderOrder = 6; gO.name = 'wxfx-grains'; R.scene.add(gO);
      sPos = new Float32Array(NS * 6); sCol = new Float32Array(NS * 8);
      g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(sPos, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('color', new T.BufferAttribute(sCol, 4).setUsage(T.DynamicDrawUsage));
      g.setDrawRange(0, 0);
      sO = new T.LineSegments(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
      sO.frustumCulled = false; sO.visible = false; sO.renderOrder = 6; sO.name = 'wxfx-streaks'; R.scene.add(sO);
      for (const ob of [gO, sO]) R.occHide?.add(ob);
    }
    // ground under a point (world coords), or null when a roof is above the camera there (no storm indoors)
    function groundAt(xw, zw, cy){ const t = top(xw, zw); return Number.isFinite(t) && t > -1e8 ? (t > cy + 1.2 ? null : t) : cy - 1.7; }
    function spawnG(i, cx, cy, cz, ox, oz, ux, uz, fill){
      for (let k = 0; k < 3; k++) {
        // fill: anywhere in the box; later: on the upwind edge (grains blow in with the wind)
        let x, z;
        if (fill) { x = cx + (rnd() - .5) * 2 * RAD; z = cz + (rnd() - .5) * 2 * RAD; }
        else { const a = (rnd() - .5) * 2 * RAD; x = cx - ux * RAD + -uz * a; z = cz - uz * RAD + ux * a; }
        const g = groundAt(x + ox, z + oz, cy); if (g === null) continue;
        gx[i] = x; gz[i] = z; gh[i] = Math.min(7, -Math.log(1 - rnd() * .995) * 1.6); gy[i] = g + gh[i]; gb[i] = .85 + .15 * rnd(); gl[i] = 1;
        if (colC) { const f = colL * gb[i], j = i * 3; gCol[j] = colC[0] * f; gCol[j + 1] = colC[1] * f; gCol[j + 2] = colC[2] * f; colDirty = true; }
        return;
      }
      gl[i] = 0;
    }
    function spawnS(i, cx, cy, cz, ox, oz, ux, uz, fill){
      for (let k = 0; k < 3; k++) {
        let x, z;
        if (fill) { x = cx + (rnd() - .5) * 2 * RAD; z = cz + (rnd() - .5) * 2 * RAD; }
        else { const a = (rnd() - .5) * 2 * RAD; x = cx - ux * RAD + -uz * a; z = cz - uz * RAD + ux * a; }
        const g = groundAt(x + ox, z + oz, cy); if (g === null) continue;
        sx[i] = x; sz[i] = z; sy[i] = g + .04 + rnd() * rnd() * 1.1; sl[i] = .5 + rnd() * .9; sv[i] = .8 + rnd() * .5; sL[i] = 1;
        return;
      }
      sL[i] = 0;
    }
    let fillG = true, fillS = true;
    F.frame = (dt = 1 / 60, S, amt = 1, lum = 1) => {
      const d = Math.min(.1, Math.max(0, dt)), K = skyStep(F.K, S, d);
      if (!q) return;
      const L = S && S.special && E.wx ? E.wx.row(S.special) : null, look = L ? L.look[2] : null;
      const kk = K.dust, wantG = look && kk > .01 ? Math.min(NG, Math.round(look.grains * q * amt * kk)) : 0, wantS = look && kk > .01 ? Math.min(NS, Math.round(look.streaks * q * amt * kk)) : 0;
      if (!gO && !wantG && !wantS) return;
      make(); if (!gO) return;
      const p = cam.position, cx = p.x, cy = p.y, cz = p.z, O = origin(), ox = O[0], oz = O[1];   // no destructuring (no iterator per frame)
      const wd = S ? S.windDir || 0 : 0, ws = Math.max(3, S ? S.wind || 0 : 0), ux = Math.cos(wd), uz = Math.sin(wd);
      const c = DUST_RGB[(S && S.dustC) | 0] || DUST_RGB[0], li = .3 + .7 * cl(lum, 0, 1);
      // grains: carried by the wind, a little turbulence; the count follows the special's strength
      gN = wantG;
      if (!gN) { if (gO.visible) { gO.visible = false; gl.fill(0); fillG = true; gW = 0; } }
      else {
        const t = performance.now() / 1000;
        for (let k = 0; k < 8; k++) { const ph = k * .785; TX[k] = (ux * ws * .9 + Math.sin(t * 2.1 + ph) * .8) * d; TZ[k] = (uz * ws * .9 + Math.cos(t * 1.7 + ph) * .8) * d; TY[k] = Math.sin(t * 3 + ph * 2) * .5 * d; }
        // colours: written at spawn; all of them again only when the dust colour or the daylight moved
        if (c !== colC || Math.abs(li - colL) > .02) { colC = c; colL = li; for (let i = 0; i < gN; i++) { const f = li * gb[i], j = i * 3; gCol[j] = c[0] * f; gCol[j + 1] = c[1] * f; gCol[j + 2] = c[2] * f; } colDirty = true; }
        let born = 0;
        const R2 = (RAD + 2) * (RAD + 2);
        for (let i = 0; i < gN; i++) {
          if (!gl[i]) { if (born < 120) { spawnG(i, cx, cy, cz, ox, oz, ux, uz, fillG); born++; } }
          else {
            const k = i & 7;
            gx[i] += TX[k]; gz[i] += TZ[k]; gy[i] += TY[k];
            const dx = gx[i] - cx, dz = gz[i] - cz;
            if (dx * dx + dz * dz > R2) spawnG(i, cx, cy, cz, ox, oz, ux, uz, false);
          }
          const j = i * 3;
          if (gl[i]) { gPos[j] = gx[i]; gPos[j + 1] = gy[i]; gPos[j + 2] = gz[i]; }
          else gPos[j + 1] = -9999;
        }
        fillG = false;
        for (let i = gN; i < gW; i++) gl[i] = 0;
        gW = gN;
        gO.material.size = S && S.dustC === 3 ? .14 : .1;   // snow flakes are bigger than sand grains
        const g = gO.geometry; g.setDrawRange(0, gN); g.attributes.position.needsUpdate = true; if (colDirty) { g.attributes.color.needsUpdate = true; colDirty = false; } gO.visible = true;
      }
      // low streaks: sand or snow snaking along the ground, faster than the air above it
      sN = wantS;
      if (!sN) { if (sO.visible) { sO.visible = false; sL.fill(0); fillS = true; sW = 0; } }
      else {
        const sp = ws * 1.1, R2 = (RAD + 2) * (RAD + 2);
        // one colour for every streak: written only when the dust colour or the daylight moved (dead ones hide by position)
        let sDirty = false;
        if (c !== sColC || Math.abs(li - sColL) > .02) { sColC = c; sColL = li; sDirty = true; for (let i = 0; i < NS; i++) { const j8 = i * 8; sCol[j8] = sCol[j8 + 4] = c[0] * li; sCol[j8 + 1] = sCol[j8 + 5] = c[1] * li; sCol[j8 + 2] = sCol[j8 + 6] = c[2] * li; sCol[j8 + 3] = .55; sCol[j8 + 7] = 0; } }
        let born = 0;
        for (let i = 0; i < sN; i++) {
          if (!sL[i]) { if (born < 80) { spawnS(i, cx, cy, cz, ox, oz, ux, uz, fillS); born++; } }
          else {
            sx[i] += ux * sp * sv[i] * d; sz[i] += uz * sp * sv[i] * d;
            const dx = sx[i] - cx, dz = sz[i] - cz;
            if (dx * dx + dz * dz > R2) spawnS(i, cx, cy, cz, ox, oz, ux, uz, false);
          }
          const j6 = i * 6;
          if (sL[i]) {
            const l = sl[i];
            sPos[j6] = sx[i]; sPos[j6 + 1] = sy[i]; sPos[j6 + 2] = sz[i]; sPos[j6 + 3] = sx[i] - ux * l; sPos[j6 + 4] = sy[i] + .02; sPos[j6 + 5] = sz[i] - uz * l;
          } else sPos[j6 + 1] = sPos[j6 + 4] = -9999;
        }
        fillS = false;
        for (let i = sN; i < sW; i++) sL[i] = 0;
        sW = sN;
        const g = sO.geometry; g.setDrawRange(0, sN * 2); g.attributes.position.needsUpdate = true; if (sDirty) g.attributes.color.needsUpdate = true; sO.visible = true;
      }
    };
    // sky numbers for R.setWeather (precip.js adds them to its own object)
    F.skyInto = wx => { const K = F.K; wx.dust = K.dust; wx.tintK = K.tintK; wx.flat = K.flat; wx.vis = K.vis < 509 ? K.vis : 0; wx.tint = K.tint; return wx; };
    F.active = () => F.K.tintK > .005 || F.K.dust > .005 || F.K.vis < 500 || F.K.flat > .005;
    // hosts that darken the sky themselves (Kubomir): only the special's numbers, at most 4 times a second, null when it is over
    let pushAt = -1e9;   // the first push goes at once (performance.now() starts near 0)
    F.pushSky = (Rr = R) => {
      const now = performance.now(), K = F.K, s = F.sent;
      if (now - pushAt < 250) return;
      const on = F.active();
      if (!on && !F.pushed) return;
      if (on && Math.abs(s.dust - K.dust) < .01 && Math.abs(s.tintK - K.tintK) < .01 && Math.abs(s.flat - K.flat) < .01 && Math.abs(s.vis - K.vis) < 1) return;
      pushAt = now; s.dust = K.dust; s.tintK = K.tintK; s.flat = K.flat; s.vis = K.vis;
      try { Rr.setWeather?.(on ? F.skyInto({ cloud: .35 * K.dust + .6 * K.flat }) : null); } catch (e) {}
      F.pushed = on;
    };
    F.stats = () => ({ grains: gO?.visible ? gN : 0, streaks: sO?.visible ? sN : 0, dust: +F.K.dust.toFixed(3), tintK: +F.K.tintK.toFixed(3), vis: Math.round(F.K.vis), flat: +F.K.flat.toFixed(3), pools: !!gO });
    F.objects = () => ({ grains: gO, streaks: sO });
    F.dispose = () => {
      for (const ob of [gO, sO]) if (ob) { R.occHide?.delete(ob); R.scene.remove(ob); ob.geometry.dispose(); ob.material.dispose(); }
      tex?.dispose(); gO = sO = tex = null;
      if (F.pushed) { try { R.setWeather?.(null); } catch (e) {} F.pushed = false; }
    };
    return F;
  };
})();

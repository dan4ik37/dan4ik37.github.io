// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — графика «Кубомира» на Three.js: текстуры-слои (массив; WebGL1 — атлас), материалы со светом
//  кубиков, сетки чанков из пула (без мусора и пересоздания буферов), рамка выделения, трещины, вещи в 3D, значки
// ═══════════════════════════════════════
// VR = V.renderer(R) — R из D37E.renderer (небо по времени суток, солнце/луна с тенями, туман, постобработка, FSR — всё
// движка). Материал — Ламберт движка + свой кусок шейдера: свет солнца и неба умножается на «свет неба» кубика (в пещере
// темно и днём), свет факелов и лавы добавляется своим тёплым цветом, углы — AO. VR.setChunk(c, m) / dropChunk(c) —
// сетки чанка (m — ответ потока); VR.setOrigin(ox, oz) — сдвиг начала координат (далеко от нуля float32 дрожит: сцена
// всегда рядом с нулём); VR.select(hit), VR.crack(x, y, z, стадия), VR.itemMesh(имя, свет), V.icon(имя, размер) — значок.
(() => {
  const E = window.D37E = window.D37E || {};
  const V = E.vox = E.vox || {};
  const H = V.H;

  // ═══ Значки вещей (2D canvas, без WebGL): блок — изометрический кубик, вещь — спрайт ═══
  const iconCache = new Map(), tileCache = new Map();
  function tileCanvas(layer){
    if (tileCache.has(layer)) return tileCache.get(layer);
    const t = V.tex[layer], d = V.paint(t.name, t.spec || V.TEX_SPECS[t.name]);
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'), im = g.createImageData(16, 16); im.data.set(d); g.putImageData(im, 0, 0);
    tileCache.set(layer, c);
    return c;
  }
  // тонировка (трава, листва) для значка
  function tinted(layer, rgb){
    const k = 'tint:' + layer + ':' + rgb.join(',');
    if (tileCache.has(k)) return tileCache.get(k);
    const src = tileCanvas(layer), c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d'); g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, 16, 16);
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = im.data[i] * rgb[0] / 255; im.data[i + 1] = im.data[i + 1] * rgb[1] / 255; im.data[i + 2] = im.data[i + 2] * rgb[2] / 255; }
    g.putImageData(im, 0, 0); tileCache.set(k, c);
    return c;
  }
  V.icon = (name, size = 40) => {
    const key = name + '@' + size;
    if (iconCache.has(key)) return iconCache.get(key);
    const it = V.item(name), b = it?.place ? V.block(it.place) : null;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    try {
      if (b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex) {
        const f = b.texf, tint = b.tint ? (b.tint === V.TINT.birch ? [128, 167, 85] : b.tint === V.TINT.spruce ? [97, 153, 97] : [124, 189, 90]) : [255, 255, 255];
        const mul = (c, k) => [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)], W3 = [255, 255, 255];
        const sideT = b.tint && b.tint !== V.TINT.grass ? tint : W3;
        const top = tinted(f.top, tint), side = tinted(f.side, mul(sideT, .8)), front = tinted(f.front >= 0 ? f.front : f.side, mul(sideT, .62));
        // изометрия: верх — ромб, слева — бок, справа — «перед» (у печи и сундука — их лицевая сторона)
        const s = size * .46, hs = s * .95, cx = size / 2, y0 = size * .04, cy = y0 + s / 2;
        g.setTransform(s / 16, s / 32, -s / 16, s / 32, cx, y0); g.drawImage(top, 0, 0);
        g.setTransform(s / 16, s / 32, 0, hs / 16, cx - s, cy); g.drawImage(side, 0, 0);
        g.setTransform(s / 16, -s / 32, 0, hs / 16, cx, cy + s / 2); g.drawImage(front, 0, 0);
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        const layer = it?.texL ?? (b ? b.texf?.side : null);
        if (layer != null && layer >= 0) {
          const tint = b && b.tint === V.TINT.grass ? [124, 189, 90] : null;
          g.drawImage(tint ? tinted(layer, tint) : tileCanvas(layer), size * .06, size * .06, size * .88, size * .88);
        }
      }
    } catch (e) { g.fillStyle = '#f0f'; g.fillRect(0, 0, size, size); }
    iconCache.set(key, c);
    return c;
  };
  V.iconURL = (name, size = 40) => { const c = V.icon(name, size); return c._url || (c._url = c.toDataURL()); };
  V.iconsReset = () => { iconCache.clear(); tileCache.clear(); };

  V.renderer = function (R, opts = {}){
    const T = R.T, gl2 = !!R.r.capabilities.isWebGL2;
    const VR = { chunks: new Set(), ox: 0, oz: 0, stats: { meshes: 0, quads: 0, poolFree: 0, bytes: 0 } };
    // ── текстуры ──
    let tex = null, atlasN = 1;
    function buildTextures(){
      const all = V.paintAll(), L = all.length;
      if (tex) tex.dispose();
      if (gl2) {
        const data = new Uint8Array(16 * 16 * 4 * L);
        all.forEach((d, i) => data.set(d, i * 1024));
        tex = new T.DataArrayTexture(data, 16, 16, L);
        tex.format = T.RGBAFormat; tex.type = T.UnsignedByteType;
        tex.magFilter = T.NearestFilter; tex.minFilter = T.NearestMipmapLinearFilter; tex.generateMipmaps = true;
        tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.encoding = T.sRGBEncoding; tex.anisotropy = 1;
      } else {
        atlasN = Math.ceil(Math.sqrt(L));
        const S = atlasN * 16, data = new Uint8Array(S * S * 4);
        all.forEach((d, i) => { const tx = (i % atlasN) * 16, ty = Math.floor(i / atlasN) * 16; for (let y = 0; y < 16; y++) data.set(d.subarray(y * 64, y * 64 + 64), ((ty + y) * S + tx) * 4); });
        tex = new T.DataTexture(data, S, S, T.RGBAFormat, T.UnsignedByteType);
        tex.magFilter = tex.minFilter = T.NearestFilter; tex.generateMipmaps = false; tex.encoding = T.sRGBEncoding;
      }
      tex.needsUpdate = true;
      U.uTex.value = tex; U.uAtlasN.value = atlasN;
    }
    const U = { uTex: { value: null }, uAtlasN: { value: 1 }, uTime: { value: 0 }, uTorch: { value: new T.Color(1.35, 1.0, .62) }, uMinAmb: { value: .045 }, uGlow: { value: 1 } };
    VR.U = U;
    // ── материалы ──
    const VS_HEAD = `
attribute vec4 vd;
varying vec3 vUvL;
varying vec3 vLit;
uniform float uTime;
vec3 d37N( float i ) {
  if ( i < 0.5 ) return vec3( 1.0, 0.0, 0.0 );
  if ( i < 1.5 ) return vec3( -1.0, 0.0, 0.0 );
  if ( i < 2.5 ) return vec3( 0.0, 1.0, 0.0 );
  if ( i < 3.5 ) return vec3( 0.0, -1.0, 0.0 );
  if ( i < 4.5 ) return vec3( 0.0, 0.0, 1.0 );
  if ( i < 5.5 ) return vec3( 0.0, 0.0, -1.0 );
  return vec3( 0.0, 1.0, 0.0 );
}`;
    const VS_NORMAL = `
vec3 objectNormal = d37N( floor( vd.z / 4096.0 ) );`;
    const VS_BEGIN = `
vec3 transformed = vec3( position );
float d37w = vd.w;
float d37f = floor( d37w / 16384.0 );
vUvL = vec3( vd.x / 16.0, vd.y / 16.0, mod( vd.z, 4096.0 ) );
vLit = vec3( mod( floor( d37w / 4.0 ), 64.0 ) / 60.0, mod( floor( d37w / 256.0 ), 64.0 ) / 60.0, mod( d37w, 4.0 ) / 3.0 );
if ( d37f > 0.5 && d37f < 1.5 ) {
  vec4 d37wp = modelMatrix * vec4( transformed, 1.0 );
  float d37ph = d37wp.x * 0.7 + d37wp.z * 0.9 + d37wp.y * 0.3;
  transformed.x += sin( uTime * 1.6 + d37ph ) * 0.8;
  transformed.z += cos( uTime * 1.2 + d37ph ) * 0.6;
}`;
    const FS_HEAD = gl2 ? `
uniform highp sampler2DArray uTex;
varying vec3 vUvL;
varying vec3 vLit;
uniform float uTime;
uniform vec3 uTorch;
uniform float uMinAmb;
vec4 d37Tex( vec3 p ) { return texture( uTex, p ); }` : `
uniform sampler2D uTex;
uniform float uAtlasN;
varying vec3 vUvL;
varying vec3 vLit;
uniform float uTime;
uniform vec3 uTorch;
uniform float uMinAmb;
vec4 d37Tex( vec3 p ) {
  vec2 tile = vec2( mod( p.z, uAtlasN ), floor( p.z / uAtlasN ) );
  vec2 f = clamp( fract( p.xy ) * 16.0, 0.5, 15.5 );
  return texture2D( uTex, ( tile * 16.0 + f ) / ( uAtlasN * 16.0 ) );
}`;
    const FS_MAP = `
vec3 d37uv = vUvL;
#ifdef D37_WATER
d37uv.xy += vec2( uTime * 0.03, uTime * 0.05 );
#endif
vec4 d37c = d37Tex( d37uv );
diffuseColor *= d37c;`;
    const FS_COLOR = `
#if defined( USE_COLOR )
diffuseColor.rgb *= vColor * vColor;
#endif`;
    const FS_LIGHT = `
float d37sk = vLit.x * vLit.x;
float d37bl = vLit.y * vLit.y * ( 0.55 + 0.45 * vLit.y );
float d37ao = 0.42 + 0.58 * vLit.z;
reflectedLight.directDiffuse *= d37sk * d37ao;
reflectedLight.indirectDiffuse *= max( d37sk, uMinAmb ) * d37ao;
reflectedLight.indirectDiffuse += diffuseColor.rgb * uTorch * d37bl * d37ao;`;
    function patch(m, kind){
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, U);
        // #include — только с новой строки (иначе шейдер не собирается)
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\n' + VS_HEAD)
          .replace('#include <beginnormal_vertex>', VS_NORMAL)
          .replace('#include <begin_vertex>', VS_BEGIN);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FS_HEAD)
          .replace('#include <map_fragment>', FS_MAP)
          .replace('#include <color_fragment>', FS_COLOR)
          .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FS_LIGHT);
      };
      m.customProgramCacheKey = () => 'd37vox-' + kind + (gl2 ? '2' : '1');
      return m;
    }
    const mats = {
      solid: patch(new T.MeshLambertMaterial({ vertexColors: true }), 'solid'),
      cutout: patch(new T.MeshLambertMaterial({ vertexColors: true, alphaTest: .5 }), 'cutout'),
      water: patch(new T.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: .82, depthWrite: false }), 'water'),
    };
    mats.water.defines = { D37_WATER: 1 };
    VR.mats = mats;
    buildTextures();
    VR.rebuildTextures = () => { buildTextures(); V.iconsReset(); };

    // ── общие индексы (0 1 2 0 2 3 + 4k) ──
    let index = null, indexQ = 0;
    function ensureIndex(q){
      if (q <= indexQ) return;
      let n = Math.max(16384, indexQ || 0); while (n < q) n *= 2;
      const a = new Uint32Array(n * 6);
      for (let i = 0, v = 0; i < n * 6; i += 6, v += 4) { a[i] = v; a[i + 1] = v + 1; a[i + 2] = v + 2; a[i + 3] = v; a[i + 4] = v + 2; a[i + 5] = v + 3; }
      const old = index;
      index = new T.BufferAttribute(a, 1); indexQ = n;
      if (old) { for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) m.geometry.setIndex(index); } for (const list of pool.values()) for (const g of list) g.setIndex(index); }
    }
    ensureIndex(16384);
    // ── пул геометрий по ёмкости (квадратов): степени двойки от 256 ──
    const pool = new Map();
    const capOf = n => { let c = 256; while (c < n) c *= 2; return c; };
    function takeGeo(n){
      const cap = capOf(n), list = pool.get(cap);
      if (list && list.length) return list.pop();
      ensureIndex(cap);
      const g = new T.BufferGeometry();
      const dyn = T.DynamicDrawUsage;
      g.setAttribute('position', new T.BufferAttribute(new Uint16Array(cap * 12), 3).setUsage(dyn));
      g.setAttribute('vd', new T.BufferAttribute(new Uint16Array(cap * 16), 4).setUsage(dyn));
      g.setAttribute('color', new T.BufferAttribute(new Uint8Array(cap * 12), 3, true).setUsage(dyn));
      g.setIndex(index);
      g.userData.cap = cap;
      g.boundingSphere = new T.Sphere(new T.Vector3(), 1);
      VR.stats.bytes += cap * 4 * 17;
      return g;
    }
    function giveGeo(g){
      const cap = g.userData.cap, list = pool.get(cap) || [];
      if (list.length >= 12) { g.dispose(); VR.stats.bytes -= cap * 4 * 17; return; }
      list.push(g); pool.set(cap, list);
    }
    function fill(g, m, yMax){
      const n = m.n, P = g.attributes.position, D = g.attributes.vd, C = g.attributes.color;
      P.array.set(m.pos); D.array.set(m.vd); C.array.set(m.col);
      P.updateRange.offset = 0; P.updateRange.count = n * 12; P.needsUpdate = true;
      D.updateRange.offset = 0; D.updateRange.count = n * 16; D.needsUpdate = true;
      C.updateRange.offset = 0; C.updateRange.count = n * 12; C.needsUpdate = true;
      g.setDrawRange(0, n * 6);
      const hy = (yMax + 2) * 8;
      g.boundingSphere.center.set(128, hy, 128); g.boundingSphere.radius = Math.sqrt(128 * 128 * 2 + hy * hy);
      g.userData.n = n;
    }
    const LAYERS = ['solid', 'cutout', 'water'];
    const meshPool = [];
    function placeMesh(mesh, c){ mesh.position.set(c.cx * 16 - VR.ox, 0, c.cz * 16 - VR.oz); mesh.updateMatrix(); }
    VR.setChunk = (c, m) => {
      const vis = c.vis || (c.vis = { solid: null, cutout: null, water: null });
      for (const k of LAYERS) {
        const d = m[k], cur = vis[k];
        if (!d) { if (cur) { R.scene.remove(cur); giveGeo(cur.geometry); cur.geometry = null; meshPool.push(cur); vis[k] = null; } continue; }
        let mesh = cur;
        if (!mesh) {
          mesh = meshPool.pop() || new T.Mesh(undefined, mats[k]);
          mesh.material = mats[k]; mesh.matrixAutoUpdate = false; mesh.scale.setScalar(1 / 16);
          mesh.castShadow = k !== 'water'; mesh.receiveShadow = true; mesh.renderOrder = k === 'water' ? 5 : 0;
          mesh.geometry = takeGeo(d.n);
          placeMesh(mesh, c); R.scene.add(mesh); vis[k] = mesh;
        } else if (mesh.geometry.userData.cap < d.n) { giveGeo(mesh.geometry); mesh.geometry = takeGeo(d.n); }
        fill(mesh.geometry, d, m.yMax ?? H - 1);
      }
      VR.chunks.add(c);
      R.shadowDirty?.();
    };
    VR.dropChunk = c => {
      if (!c.vis) return;
      for (const k of LAYERS) { const m = c.vis[k]; if (m) { R.scene.remove(m); giveGeo(m.geometry); m.geometry = null; meshPool.push(m); } }
      c.vis = null; VR.chunks.delete(c);
    };
    VR.setOrigin = (ox, oz) => {
      VR.ox = ox; VR.oz = oz;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) placeMesh(m, c); }
    };
    VR.count = () => {
      let meshes = 0, quads = 0, free = 0;
      for (const c of VR.chunks) for (const k of LAYERS) { const m = c.vis?.[k]; if (m) { meshes++; quads += m.geometry.userData.n || 0; } }
      for (const l of pool.values()) free += l.length;
      VR.stats.meshes = meshes; VR.stats.quads = quads; VR.stats.poolFree = free;
      return VR.stats;
    };

    // ── рамка выделения и трещины ──
    const selGeo = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1));
    const sel = new T.LineSegments(selGeo, new T.LineBasicMaterial({ color: '#111111', transparent: true, opacity: .55 }));
    sel.visible = false; sel.renderOrder = 6; R.scene.add(sel);
    VR.select = hit => {
      if (!hit) { sel.visible = false; return; }
      const b = V.boxOf(hit.v, false) || [0, 0, 0, 1, 1, 1], e = .004;
      sel.scale.set(b[3] - b[0] + e * 2, b[4] - b[1] + e * 2, b[5] - b[2] + e * 2);
      sel.position.set(hit.x - VR.ox + (b[0] + b[3]) / 2, hit.y + (b[1] + b[4]) / 2, hit.z - VR.oz + (b[2] + b[5]) / 2);
      sel.visible = true;
    };
    const crackMat = new T.ShaderMaterial({
      uniforms: { uTex: U.uTex, uAtlasN: U.uAtlasN, uLayer: { value: 0 } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: gl2 ? 'precision highp sampler2DArray; uniform sampler2DArray uTex; uniform float uLayer; varying vec2 vUv; void main(){ vec4 c = texture(uTex, vec3(vUv.x, 1.0 - vUv.y, uLayer)); if (c.a < 0.1) discard; gl_FragColor = vec4(c.rgb * 0.2, c.a * 0.75); }'
        : 'uniform sampler2D uTex; uniform float uAtlasN; uniform float uLayer; varying vec2 vUv; void main(){ vec2 tile = vec2(mod(uLayer, uAtlasN), floor(uLayer / uAtlasN)); vec2 f = clamp(vec2(vUv.x, 1.0 - vUv.y) * 16.0, 0.5, 15.5); vec4 c = texture2D(uTex, (tile * 16.0 + f) / (uAtlasN * 16.0)); if (c.a < 0.1) discard; gl_FragColor = vec4(c.rgb * 0.2, c.a * 0.75); }',
    });
    const crack = new T.Mesh(new T.BoxGeometry(1.004, 1.004, 1.004), crackMat);
    crack.visible = false; crack.renderOrder = 7; R.scene.add(crack);
    const D0 = V.texIdx.get('destroy_0');
    VR.crack = (x, y, z, st) => {
      if (st < 0 || st == null) { crack.visible = false; return; }
      crackMat.uniforms.uLayer.value = D0 + Math.max(0, Math.min(7, st | 0));
      crack.position.set(x - VR.ox + .5, y + .5, z - VR.oz + .5); crack.visible = true;
    };

    // ── вещь в 3D (в руке, на земле): тот же формат вершин, что у чанков ──
    VR.itemGeo = (name, sky = 15, blk = 0) => {
      const it = V.item(name), b = it?.place ? V.block(it.place) : null;
      const quads = [];
      const L = 3 | ((sky * 4) << 2) | ((blk * 4) << 8);
      if (b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex) {
        const tint = b.tint ? (b.tint === V.TINT.birch ? [128, 167, 85] : b.tint === V.TINT.spruce ? [97, 153, 97] : [124, 189, 90]) : [255, 255, 255];
        for (let d = 0; d < 6; d++) {
          const D = V.MESH_DIRS[d], layer = V.texFor(V.T, b.id, 0, d), col = b.tint && !(b.tint === V.TINT.grass && d !== 2) ? tint : [255, 255, 255];
          const q = [];
          for (let k = 0; k < 4; k++) {
            const du = D.c[k][0], dv = D.c[k][1], p = [0, 0, 0];
            p[d >> 1] = (d & 1) ? 0 : 1; p[D.ua] = du; p[D.va] = dv;
            const U2 = d === 2 || d === 3 ? [p[0], p[2]] : d === 0 ? [1 - p[2], 1 - p[1]] : d === 1 ? [p[2], 1 - p[1]] : d === 4 ? [p[0], 1 - p[1]] : [1 - p[0], 1 - p[1]];
            q.push({ p: [p[0] - .5, p[1] - .5, p[2] - .5], uv: U2, layer, nrm: d, col });
          }
          quads.push(q);
        }
      } else {
        const layer = it?.texL ?? b?.texf?.side ?? 0, col = b && b.tint === V.TINT.grass ? [124, 189, 90] : [255, 255, 255];
        const P = [[-.5, -.5, 0], [-.5, .5, 0], [.5, .5, 0], [.5, -.5, 0]], UV = [[0, 1], [0, 0], [1, 0], [1, 1]];
        quads.push(P.map((p, i) => ({ p, uv: UV[i], layer, nrm: 4, col })));
        quads.push([3, 2, 1, 0].map(i => ({ p: [P[i][0], P[i][1], -.001], uv: UV[i], layer, nrm: 5, col })));
      }
      const n = quads.length, pos = new Float32Array(n * 12), vd = new Uint16Array(n * 16), cl = new Uint8Array(n * 12), idx = [];
      quads.forEach((q, qi) => q.forEach((v, k) => {
        const o = qi * 4 + k;
        pos.set(v.p, o * 3); vd[o * 4] = Math.round(v.uv[0] * 16); vd[o * 4 + 1] = Math.round(v.uv[1] * 16); vd[o * 4 + 2] = v.layer | (v.nrm << 12); vd[o * 4 + 3] = L;
        cl.set(v.col, o * 3);
      }));
      for (let qi = 0; qi < n; qi++) idx.push(qi * 4, qi * 4 + 1, qi * 4 + 2, qi * 4, qi * 4 + 2, qi * 4 + 3);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('vd', new T.BufferAttribute(vd, 4)); g.setAttribute('color', new T.BufferAttribute(cl, 3, true));
      g.setIndex(idx);
      g.userData.flat = !(b && (b.shape === V.SHAPE.cube || b.shape === V.SHAPE.chest || b.shape === V.SHAPE.cactus) && !it.tex);
      return g;
    };
    // свет вещи (в пещере — темнее): переписать биты света в вершинах
    VR.itemLight = (g, sky, blk) => {
      const a = g.attributes.vd, L = 3 | ((sky * 4) << 2) | ((blk * 4) << 8);
      if (g.userData.L === L) return;
      g.userData.L = L;
      for (let i = 0; i < a.count; i++) a.array[i * 4 + 3] = L;
      a.needsUpdate = true;
    };
    VR.itemMesh = (name, sky, blk) => {
      const g = VR.itemGeo(name, sky, blk);
      const m = new T.Mesh(g, g.userData.flat ? mats.cutout : mats.solid);
      m.userData.item = name;
      return m;
    };

    VR.update = (dt, t) => { U.uTime.value = t % 1000; };
    VR.dispose = () => {
      for (const c of [...VR.chunks]) VR.dropChunk(c);
      for (const list of pool.values()) for (const g of list) g.dispose();
      pool.clear(); meshPool.length = 0;
      for (const m of Object.values(mats)) m.dispose();
      tex?.dispose(); selGeo.dispose(); sel.material.dispose(); crack.geometry.dispose(); crackMat.dispose();
      R.scene.remove(sel); R.scene.remove(crack);
    };
    return VR;
  };
})();

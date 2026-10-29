// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — свои 3D-модели (как MeshPart в Roblox): загрузка .glb / .gltf / .obj и «компиляция» в формат
//  движка — разбор, проверка и лимиты, склейка по материалам, нормали, подгонка размера, сжатие текстур
// ═══════════════════════════════════════
// Модель хранится ТОЛЬКО в этом браузере (IndexedDB «d37e», хранилище models) — её видит только автор, пока не выложит
// (выкладывание с проверкой модератором — позже, вместе с публикацией миров). Сеть при загрузке не нужна: файлы
// разбираются здесь же, внешние ссылки внутри модели (uri http…) не открываются никогда.
// M = D37E.models: M.compile(files, { onStep }) → модель (async; files — File[]/{ name, data: ArrayBuffer|string });
// M.save(model) / M.load(id) / M.list() / M.remove(id) — хранилище; M.cached(id) — уже загруженная; M.instance(R, model) →
// THREE.Group (геометрии и материалы общие для всех копий); M.pack(model) / M.unpack(data) — для файла мира (base64).
// Формат: { id, name, v: 1, tris, verts, size: [x, y, z] (низ — y = 0, центр по x/z), mats: [{ c: [r, g, b] (линейный),
// a (непрозрачность), tex (номер или −1), r, m, e: [r, g, b] | null, at (альфа-отсечка), d (две стороны), vc (цвета вершин) }],
// tex: [{ blob | data, w, h }], parts: [{ m, p: Float32Array, n: Int8Array, u: Float32Array | null, c: Uint8Array | null, i }] }.
// Скелет и анимации (T-131, AI3D A2): skin = { n, names, par: Int16Array, t, q, s (покой, единицы модели) }, у частей со скином
// j/w: Uint8Array(4 на вершину) — номера костей и веса (сумма 255); anims = [{ name, dur, meta, tr: [{ b, k: 0 t | 1 r | 2 s, st, t, v }] }].
// M.instance(R, model, { act }) — модель со скелетом рисуется SkinnedMesh + AnimationMixer (клипы общие на модель; скелет
// D37E.skel — ещё и общие действия: ходьба, бег, присед… для любой модели с костями гуманоида); M.animate(dt, camera) — раз в кадр
// (дальние и невидимые — реже, M.LOD); M.play(anim, имя) — сменить действие; M.release(anim); M.actions(model) — список.
// Откат одной строкой: D37E.models.SKIN = false — все модели статичны (поза покоя).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const LIMIT = { tris: 100000, tex: 8, texSize: 1024, bytes: 12e6 };
  const U = E.UNIT || 2.1 / 1.8;
  const fail = m => { const e = new Error(m); e.user = true; throw e; };

  // ═══ Матрицы 4×4 (столбцами, как в glTF) ═══
  const m4 = {
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b){ const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]){
      const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
        (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
    },
    inv(m){
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7], a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06, d = det ? 1 / det : 0;
      return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
        (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
        (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
        (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
    },
    // разложение на сдвиг, поворот (кватернион), масштаб
    dec(m){
      const sx = Math.hypot(m[0], m[1], m[2]) || 1, sy = Math.hypot(m[4], m[5], m[6]) || 1, sz = Math.hypot(m[8], m[9], m[10]) || 1;
      const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx, r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy, r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
      const tr = r00 + r11 + r22; let x, y, z, w;
      if (tr > 0) { const q = .5 / Math.sqrt(tr + 1); w = .25 / q; x = (r21 - r12) * q; y = (r02 - r20) * q; z = (r10 - r01) * q; }
      else if (r00 > r11 && r00 > r22) { const q = 2 * Math.sqrt(1 + r00 - r11 - r22); w = (r21 - r12) / q; x = .25 * q; y = (r01 + r10) / q; z = (r02 + r20) / q; }
      else if (r11 > r22) { const q = 2 * Math.sqrt(1 + r11 - r00 - r22); w = (r02 - r20) / q; x = (r01 + r10) / q; y = .25 * q; z = (r12 + r21) / q; }
      else { const q = 2 * Math.sqrt(1 + r22 - r00 - r11); w = (r10 - r01) / q; x = (r02 + r20) / q; y = (r12 + r21) / q; z = .25 * q; }
      const l = Math.hypot(x, y, z, w) || 1;
      return { t: [m[12], m[13], m[14]], q: [x / l, y / l, z / l, w / l], s: [sx, sy, sz] };
    },
    // матрица нормалей: обратная транспонированная 3×3
    normal(m){
      const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], g = m[2], h = m[6], i = m[10];
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
      return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
    },
  };
  const srgbToLin = c => c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);

  // ═══ glTF / GLB ═══
  const COMP = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5125: [4, 'getUint32', 0], 5126: [4, 'getFloat32', 0] };
  const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  function parseGLB(buf){
    const dv = new DataView(buf);
    if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) fail('Файл повреждён: это не .glb');
    const len = Math.min(buf.byteLength, dv.getUint32(8, true));
    let off = 12, json = null, bin = null;
    while (off + 8 <= len) {
      const clen = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (off + 8 + clen > len) fail('Файл .glb обрезан');
      const data = new Uint8Array(buf, off + 8, clen);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(data));
      else if (type === 0x004E4942 && !bin) bin = data;
      off += 8 + clen + ((4 - clen % 4) % 4);
    }
    if (!json) fail('В .glb нет описания модели');
    return { json, bin };
  }
  const b64ToBytes = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  // data:…;base64 или файл, выбранный вместе с .gltf (по имени); http-ссылки — никогда
  function resolveUri(uri, files){
    if (/^data:/i.test(uri)) { const m = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(uri); if (!m) fail('Неверная встроенная ссылка'); return { bytes: m[2] ? b64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])), mime: m[1] }; }
    if (/^[a-z]+:/i.test(uri)) fail('Модель ссылается на файл в интернете — так нельзя. Сохрани как .glb (всё в одном файле)');
    const name = decodeURIComponent(uri).split(/[\\/]/).pop();
    const f = files.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!f) fail(`Не хватает файла «${name}» — выбери его вместе с .gltf (или сохрани модель как .glb)`);
    return { bytes: new Uint8Array(f.data), mime: '' };
  }
  function readAccessor(G, idx, asIndex){
    const a = G.json.accessors?.[idx]; if (!a) fail('Повреждённая модель (accessor)');
    const k = NUM[a.type] || 1, [size, getter, nmax] = COMP[a.componentType] || fail('Неизвестный тип данных в модели');
    const out = asIndex ? new Uint32Array(a.count * k) : new Float32Array(a.count * k);
    if (a.bufferView != null) {
      const bv = G.json.bufferViews[a.bufferView], buf = G.buffers[bv.buffer];
      if (!buf) fail('В модели нет данных (buffer)');
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const stride = bv.byteStride || size * k, base = (bv.byteOffset || 0) + (a.byteOffset || 0), norm = a.normalized && nmax;
      if (base + stride * (a.count - 1) + size * k > buf.byteLength) fail('Повреждённая модель: данные за краем файла');
      for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) {
        let v = dv[getter](base + e * stride + c * size, true);
        if (norm) v = Math.max(v / nmax, -1);
        out[e * k + c] = v;
      }
    }
    if (a.sparse) {   // редко: поверх базовых — замены
      const s = a.sparse, ii = readRaw(G, s.indices.bufferView, s.indices.byteOffset, s.indices.componentType, s.count, 1), vv = readRaw(G, s.values.bufferView, s.values.byteOffset, a.componentType, s.count, k, a.normalized);
      for (let j = 0; j < s.count; j++) for (let c = 0; c < k; c++) out[ii[j] * k + c] = vv[j * k + c];
    }
    return { arr: out, n: a.count, k };
  }
  function readRaw(G, view, off, ct, count, k, normalized){
    const bv = G.json.bufferViews[view], buf = G.buffers[bv.buffer], [size, getter, nmax] = COMP[ct];
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), base = (bv.byteOffset || 0) + (off || 0), out = new Float64Array(count * k);
    for (let i = 0; i < count * k; i++) { let v = dv[getter](base + i * size, true); if (normalized && nmax) v = Math.max(v / nmax, -1); out[i] = v; }
    return out;
  }
  function gltfToRaw(G, files){
    const J = G.json;
    if (!J.asset || String(J.asset.version || '2').split('.')[0] !== '2') fail('Нужен glTF 2.0 (в Blender: File → Export → glTF 2.0)');
    const ext = J.extensionsRequired || [];
    if (ext.includes('KHR_draco_mesh_compression') || ext.includes('EXT_meshopt_compression'))
      fail('Модель сжата (Draco/meshopt) — сохрани без сжатия: в Blender сними галочку «Compression»');
    // буферы
    G.buffers = (J.buffers || []).map((b, i) => {
      if (b.uri == null) { if (i === 0 && G.bin) return G.bin; fail('В модели нет данных'); }
      return resolveUri(b.uri, files).bytes;
    });
    // картинки
    const images = (J.images || []).map(im => {
      if (im.bufferView != null) { const bv = J.bufferViews[im.bufferView], buf = G.buffers[bv.buffer]; return { bytes: buf.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength), mime: im.mimeType || '' }; }
      if (im.uri) { const r = resolveUri(im.uri, files); return { bytes: r.bytes, mime: im.mimeType || r.mime }; }
      return null;
    });
    const texOf = info => { if (!info) return -1; const t = J.textures?.[info.index]; const src = t?.source ?? t?.extensions?.EXT_texture_webp?.source; return src != null && images[src] ? src : -1; };
    const mats = (J.materials || []).map(m => {
      const p = m.pbrMetallicRoughness || {}, bc = p.baseColorFactor || [1, 1, 1, 1], hasMR = !!p.metallicRoughnessTexture;
      const em = m.emissiveFactor && (m.emissiveFactor[0] || m.emissiveFactor[1] || m.emissiveFactor[2]) ? m.emissiveFactor.map(v => v * (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength || 1)) : null;
      return { c: [bc[0], bc[1], bc[2]], a: bc[3] ?? 1, tex: texOf(p.baseColorTexture), r: hasMR ? Math.min(1, p.roughnessFactor ?? 1) * .85 : (p.roughnessFactor ?? 1), m: hasMR ? Math.min(.5, (p.metallicFactor ?? 1) * .3) : (p.metallicFactor ?? 1),
        e: em, etex: texOf(m.emissiveTexture), at: m.alphaMode === 'MASK' ? (m.alphaCutoff ?? .5) : 0, blend: m.alphaMode === 'BLEND', d: !!m.doubleSided, unlit: !!m.extensions?.KHR_materials_unlit };
    });
    const prims = [];
    const NW = [], NP = [];   // мировые матрицы и родители узлов (для скелета)
    const walk = (ni, parentM, depth, pi) => {
      if (depth > 64 || NW[ni]) return;
      const n = J.nodes?.[ni]; if (!n) return;
      const local = n.matrix ? n.matrix.slice() : m4.trs(n.translation, n.rotation, n.scale), M = m4.mul(parentM, local);
      NW[ni] = M; NP[ni] = pi;
      if (n.mesh != null) for (const p of J.meshes[n.mesh]?.primitives || []) prims.push({ p, M, ni, skin: n.skin });
      for (const c of n.children || []) walk(c, M, depth + 1, ni);
    };
    const scene = J.scenes?.[J.scene ?? 0];
    if (scene) for (const ni of scene.nodes || []) walk(ni, m4.id(), 0, -1);
    else (J.meshes || []).forEach((me, i) => { for (const p of me.primitives || []) prims.push({ p, M: m4.id() }); });
    const SK = skinOf(G, prims, NW, NP);   // скелет: первый скин, который использует меш (SKIN = false выключает только движение)
    const raw = [];
    for (const { p, M: M0, ni, skin } of prims) {
      let M = M0;
      const mode = p.mode ?? 4;
      if (mode < 4 || p.attributes?.POSITION == null) continue;   // точки и линии — пропускаем
      if (p.extensions?.KHR_draco_mesh_compression) fail('Модель сжата Draco — сохрани без сжатия (Blender: сними «Compression»)');
      let pos = readAccessor(G, p.attributes.POSITION).arr;
      let nor = p.attributes.NORMAL != null ? readAccessor(G, p.attributes.NORMAL).arr : null;
      let jw = null;
      if (SK) {
        if (skin === SK.si && p.attributes.JOINTS_0 != null && p.attributes.WEIGHTS_0 != null) { const b = skinBake(G, SK, p, pos, nor); pos = b.pos; nor = b.nor; jw = b.jw; M = m4.id(); }
        else if (ni != null) { const j = SK.rigidOf(ni); if (j >= 0) { const n = pos.length / 3, J8 = new Uint8Array(n * 4), W8 = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { J8[i * 4] = j; W8[i * 4] = 255; } jw = { j: J8, w: W8 }; } }
      }
      const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(G, p.attributes.TEXCOORD_0).arr : null;
      let col = null;
      if (p.attributes.COLOR_0 != null) { const c = readAccessor(G, p.attributes.COLOR_0); col = new Float32Array(c.n * 3); for (let i = 0; i < c.n; i++) for (let j = 0; j < 3; j++) col[i * 3 + j] = c.arr[i * c.k + j]; }
      let idx = p.indices != null ? readAccessor(G, p.indices, true).arr : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      if (mode === 5 || mode === 6) idx = unstrip(idx, mode);
      raw.push({ mat: p.material ?? -1, pos, nor, uv, col, idx, M, jw });
    }
    return { raw, mats, images, uvTop: true, skin: SK, anims: SK ? readAnims(G, SK) : [] };
  }

  // ═══ Скелет (glTF skin) и анимации (T-131) ═══
  function skinOf(G, prims, NW, NP){
    const J = G.json, pr = prims.find(x => x.skin != null && J.skins?.[x.skin]); if (!pr) return null;
    const si = pr.skin, joints = J.skins[si].joints || [];
    if (!joints.length || joints.length > 255 || joints.some(ni => !NW[ni])) return null;
    const jIdx = new Map(joints.map((ni, i) => [ni, i]));
    const ib = J.skins[si].inverseBindMatrices != null ? readAccessor(G, J.skins[si].inverseBindMatrices).arr : null;
    if (ib && ib.length < joints.length * 16) return null;
    const par = joints.map(ni => { let q = NP[ni]; while (q >= 0 && !jIdx.has(q)) q = NP[q]; return q >= 0 ? jIdx.get(q) : -1; });
    const W = joints.map(ni => NW[ni]);
    const S = joints.map((ni, i) => m4.mul(W[i], ib ? Array.from(ib.subarray(i * 16, i * 16 + 16)) : m4.id()));   // матрицы скиннинга в покое
    // пространство, в котором заданы анимации кости: родитель-узел относительно родителя-кости (обычно — единичное)
    const pm = joints.map((ni, i) => { const q = NP[ni], Wq = q >= 0 ? NW[q] : m4.id(); return m4.dec(par[i] < 0 ? Wq : m4.mul(m4.inv(W[par[i]]), Wq)); });
    const names = joints.map((ni, i) => String(J.nodes[ni].name || 'bone' + i).slice(0, 64));
    const rigidOf = ni => { let q = ni; while (q != null && q >= 0) { if (jIdx.has(q)) return jIdx.get(q); q = NP[q]; } return -1; };
    return { si, joints, jIdx, par, W, S, pm, names, rigidOf };
  }
  // вершины в позу покоя (узлы), веса → 4 байта на вершину, сумма 255
  function skinBake(G, SK, p, pos, nor){
    const jA = readAccessor(G, p.attributes.JOINTS_0, true), wA = readAccessor(G, p.attributes.WEIGHTS_0);
    const n = pos.length / 3, P = new Float32Array(n * 3), N = nor ? new Float32Array(n * 3) : null, J8 = new Uint8Array(n * 4), W8 = new Uint8Array(n * 4), nj = SK.S.length;
    const jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      let ws = 0;
      for (let c = 0; c < 4; c++) { jj[c] = 0; ww[c] = 0; if (c < jA.k && c < wA.k) { const j = jA.arr[i * jA.k + c], w = wA.arr[i * wA.k + c]; if (w > 0 && j < nj) { jj[c] = j; ww[c] = w; ws += w; } } }
      if (!(ws > 0)) { ww[0] = 1; ws = 1; }
      const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
      for (let c = 0; c < 4; c++) {
        const w = ww[c] / ws; if (!w) continue; const m = SK.S[jj[c]];
        x += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]); y += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]); z += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
        if (N) { const qx = nor[i * 3], qy = nor[i * 3 + 1], qz = nor[i * 3 + 2]; nx += w * (m[0] * qx + m[4] * qy + m[8] * qz); ny += w * (m[1] * qx + m[5] * qy + m[9] * qz); nz += w * (m[2] * qx + m[6] * qy + m[10] * qz); }
      }
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      if (N) { const l = Math.hypot(nx, ny, nz) || 1; N[i * 3] = nx / l; N[i * 3 + 1] = ny / l; N[i * 3 + 2] = nz / l; }
      let sum = 0, big = 0;
      for (let c = 0; c < 4; c++) { const q = Math.round(ww[c] / ws * 255); W8[i * 4 + c] = q; J8[i * 4 + c] = jj[c]; sum += q; if (ww[c] > ww[big]) big = c; }
      W8[i * 4 + big] += 255 - sum;
    }
    return { pos: P, nor: N, jw: { j: J8, w: W8 } };
  }
  // анимации костей: t/r/s, LINEAR/STEP (CUBICSPLINE — по ключевым значениям); остальное (морфы, узлы без костей) — мимо
  function readAnims(G, SK){
    const J = G.json, out = [];
    let floats = 0;
    for (const [ai, an] of (J.animations || []).entries()) {
      if (out.length >= 64) break;
      const tr = []; let dur = 0;
      for (const ch of an.channels || []) {
        const b = SK.jIdx.get(ch.target?.node), kk = ['translation', 'rotation', 'scale'].indexOf(ch.target?.path), smp = an.samplers?.[ch.sampler];
        if (b == null || kk < 0 || !smp) continue;
        const tin = readAccessor(G, smp.input).arr, vo = readAccessor(G, smp.output).arr, nc = kk === 1 ? 4 : 3, cub = smp.interpolation === 'CUBICSPLINE', nk = tin.length;
        if (!nk || vo.length < nk * nc * (cub ? 3 : 1) || !Number.isFinite(tin[nk - 1])) continue;
        floats += nk * (nc + 1); if (floats > 3e6) break;
        const v = new Float32Array(nk * nc);
        for (let i = 0; i < nk; i++) for (let c = 0; c < nc; c++) v[i * nc + c] = vo[(cub ? i * 3 + 1 : i) * nc + c];
        tr.push({ b, k: kk, st: smp.interpolation === 'STEP' ? 1 : 0, t: Float32Array.from(tin), v });
        dur = Math.max(dur, tin[nk - 1]);
      }
      const meta = an.extras && typeof an.extras.d37 === 'object' ? an.extras.d37 : null;
      if (tr.length) out.push({ name: String(an.name || 'clip' + ai).slice(0, 64), dur, tr, meta });
    }
    return out;
  }
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qrot = (q, v) => { const [x, y, z] = v, [qx, qy, qz, qw] = q, tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x); return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx]; };
  // скелет и анимации — в единицы и центр модели (как вершины в bake: (x − c)·k)
  function skinModel(SK, anims, k, c){
    const n = SK.W.length, t = new Float32Array(n * 3), q = new Float32Array(n * 4), sc = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const pi = SK.par[i], d = m4.dec(pi < 0 ? SK.W[i] : m4.mul(m4.inv(SK.W[pi]), SK.W[i]));
      const tt = pi < 0 ? [(d.t[0] - c[0]) * k, (d.t[1] - c[1]) * k, (d.t[2] - c[2]) * k] : [d.t[0] * k, d.t[1] * k, d.t[2] * k];
      t.set(tt, i * 3); q.set(d.q, i * 4); sc.set(d.s, i * 3);
    }
    const A = anims.map(a => ({ name: a.name, dur: a.dur, meta: a.meta, tr: a.tr.map(r => {
      const pm = SK.pm[r.b], root = SK.par[r.b] < 0, nc = r.k === 1 ? 4 : 3, v = new Float32Array(r.v.length), su = (pm.s[0] + pm.s[1] + pm.s[2]) / 3;
      for (let i = 0; i < r.v.length; i += nc) {
        if (r.k === 0) { const w = qrot(pm.q, [r.v[i] * su, r.v[i + 1] * su, r.v[i + 2] * su]); for (let j = 0; j < 3; j++) v[i + j] = ((w[j] + pm.t[j]) - (root ? c[j] : 0)) * k; }
        else if (r.k === 1) { const w = qmul(pm.q, [r.v[i], r.v[i + 1], r.v[i + 2], r.v[i + 3]]); v.set(w, i); }
        else for (let j = 0; j < 3; j++) v[i + j] = r.v[i + j] * su;
      }
      return { b: r.b, k: r.k, st: r.st, t: r.t, v };
    }) }));
    return { skin: { n, names: SK.names.slice(), par: Int16Array.from(SK.par), t, q, s: sc }, anims: A };
  }
  function unstrip(idx, mode){
    const out = [];
    for (let i = 2; i < idx.length; i++) {
      if (mode === 5) { if (i % 2) out.push(idx[i - 1], idx[i - 2], idx[i]); else out.push(idx[i - 2], idx[i - 1], idx[i]); }
      else out.push(idx[0], idx[i - 1], idx[i]);
    }
    return Uint32Array.from(out);
  }

  // ═══ OBJ (+ MTL) ═══
  function parseMTL(text){
    const mats = {}; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim().split(/\s+/), k = t[0];
      if (k === 'newmtl') { cur = mats[t.slice(1).join(' ')] = { c: [.8, .8, .8], a: 1, map: null, e: null }; }
      else if (!cur) continue;
      else if (k === 'Kd') cur.c = [+t[1], +t[2], +t[3]].map(v => srgbToLin(Math.max(0, Math.min(1, v || 0))));
      else if (k === 'Ke') { const e = [+t[1], +t[2], +t[3]]; if (e.some(v => v > 0)) cur.e = e.map(v => srgbToLin(Math.max(0, Math.min(1, v || 0)))); }
      else if (k === 'd') cur.a = +t[1];
      else if (k === 'Tr') cur.a = 1 - +t[1];
      else if (k === 'map_Kd') cur.map = t[t.length - 1];
    }
    return mats;
  }
  function objToRaw(text, files){
    const V = [], N = [], T = [], groups = new Map();
    let mtl = {}, curMat = '';
    const mtlFile = files.find(f => /\.mtl$/i.test(f.name));
    if (mtlFile) mtl = parseMTL(typeof mtlFile.data === 'string' ? mtlFile.data : new TextDecoder().decode(mtlFile.data));
    const grp = () => { let g = groups.get(curMat); if (!g) { g = { pos: [], nor: [], uv: [], hasN: true, hasT: true }; groups.set(curMat, g); } return g; };
    for (const line of text.split(/\r?\n/)) {
      const c = line.charCodeAt(0);
      if (c === 35 || !line) continue;   // #
      const t = line.trim().split(/\s+/), k = t[0];
      if (k === 'v') V.push(+t[1], +t[2], +t[3]);
      else if (k === 'vn') N.push(+t[1], +t[2], +t[3]);
      else if (k === 'vt') T.push(+t[1], +(t[2] ?? 0));
      else if (k === 'usemtl') curMat = t.slice(1).join(' ');
      else if (k === 'f') {
        const g = grp(), vs = t.slice(1).map(s => s.split('/').map(x => x === '' ? NaN : parseInt(x, 10)));
        const at = (a, n, len) => (a < 0 ? len / n + a : a - 1);
        for (let i = 1; i + 1 < vs.length; i++) for (const v of [vs[0], vs[i], vs[i + 1]]) {
          const pi = at(v[0], 3, V.length) * 3; g.pos.push(V[pi], V[pi + 1], V[pi + 2]);
          if (v[1] >= 0 || v[1] < 0) { const ti = at(v[1], 2, T.length) * 2; g.uv.push(T[ti], T[ti + 1]); } else { g.hasT = false; g.uv.push(0, 0); }
          if (v[2] >= 0 || v[2] < 0) { const ni = at(v[2], 3, N.length) * 3; g.nor.push(N[ni], N[ni + 1], N[ni + 2]); } else { g.hasN = false; g.nor.push(0, 0, 0); }
        }
      }
    }
    const mats = [], images = [], raw = [], imgIdx = new Map();
    for (const [name, g] of groups) {
      if (!g.pos.length) continue;
      const m = mtl[name] || { c: [.8, .8, .8], a: 1, map: null, e: null };
      let tex = -1;
      if (m.map) {
        const fn = m.map.split(/[\\/]/).pop().toLowerCase(), f = files.find(x => x.name.toLowerCase() === fn);
        if (f) { if (!imgIdx.has(fn)) { imgIdx.set(fn, images.length); images.push({ bytes: new Uint8Array(f.data), mime: '' }); } tex = imgIdx.get(fn); }
      }
      mats.push({ c: m.c, a: m.a, tex, r: .8, m: 0, e: m.e, etex: -1, at: 0, blend: m.a < .99, d: false, unlit: false });
      const pos = Float32Array.from(g.pos);
      raw.push({ mat: mats.length - 1, pos, nor: g.hasN ? Float32Array.from(g.nor) : null, uv: g.hasT ? Float32Array.from(g.uv) : null, col: null, idx: Uint32Array.from({ length: pos.length / 3 }, (_, i) => i), M: m4.id() });
    }
    return { raw, mats, images, uvTop: false };
  }

  // ═══ «Компиляция»: мир-матрицы, нормали, склейка по материалу, подгонка размера ═══
  function bake(src, name){
    const { raw, mats } = src;
    let tris = 0; for (const r of raw) tris += r.idx.length / 3;
    if (!raw.length) fail('В файле нет треугольников (модель пустая или из линий/точек)');
    if (tris > LIMIT.tris) fail(`Слишком тяжёлая модель: ${Math.round(tris).toLocaleString('ru')} треугольников, можно до ${LIMIT.tris.toLocaleString('ru')}. Упрости в Blender: модификатор Decimate`);
    // 1) в мировые координаты
    const out = [];
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const r of raw) {
      const n = r.pos.length / 3, M = r.M, NM = m4.normal(M), P = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = r.pos[i * 3], y = r.pos[i * 3 + 1], z = r.pos[i * 3 + 2];
        const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], Z = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (!Number.isFinite(X + Y + Z)) fail('В модели есть битые вершины (NaN)');
        P[i * 3] = X; P[i * 3 + 1] = Y; P[i * 3 + 2] = Z;
        if (X < mn[0]) mn[0] = X; if (Y < mn[1]) mn[1] = Y; if (Z < mn[2]) mn[2] = Z;
        if (X > mx[0]) mx[0] = X; if (Y > mx[1]) mx[1] = Y; if (Z > mx[2]) mx[2] = Z;
      }
      // зеркальная матрица (отрицательный масштаб) — разворачиваем треугольники
      const det = M[0] * (M[5] * M[10] - M[9] * M[6]) - M[4] * (M[1] * M[10] - M[9] * M[2]) + M[8] * (M[1] * M[6] - M[5] * M[2]);
      let idx = r.idx;
      for (let i = 0; i < idx.length; i++) if (idx[i] >= n) fail('Повреждённая модель: номер вершины за краем');
      if (det < 0) { idx = idx.slice(); for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } }
      let Nn = null;
      if (r.nor) {
        Nn = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const x = r.nor[i * 3], y = r.nor[i * 3 + 1], z = r.nor[i * 3 + 2];
          let X = NM[0] * x + NM[3] * y + NM[6] * z, Y = NM[1] * x + NM[4] * y + NM[7] * z, Z = NM[2] * x + NM[5] * y + NM[8] * z;
          const l = Math.hypot(X, Y, Z) || 1; Nn[i * 3] = X / l; Nn[i * 3 + 1] = Y / l; Nn[i * 3 + 2] = Z / l;
        }
      }
      let uv = r.uv;
      if (uv && !src.uvTop) { uv = uv.slice(); for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i]; }   // OBJ: v снизу → как в glTF
      out.push({ mat: r.mat, P, N: Nn, uv, col: r.col, idx, jw: r.jw });
    }
    // 2) размер: метры → единицы движка; странный масштаб (сантиметры, километры) — подгоняем к 4 единицам
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    let k = U, fitted = false;
    const big = Math.max(...ext) * U;
    if (!(big > .1 && big < 70)) { k = 4 / (Math.max(...ext) || 1); fitted = true; }
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, by = mn[1];
    for (const o of out) for (let i = 0; i < o.P.length; i += 3) { o.P[i] = (o.P[i] - cx) * k; o.P[i + 1] = (o.P[i + 1] - by) * k; o.P[i + 2] = (o.P[i + 2] - cz) * k; }
    // 3) склейка по материалу (и наличию цветов вершин/UV), нормали где нет
    const groups = new Map();
    for (const o of out) {
      const key = `${o.mat}|${o.col ? 1 : 0}|${o.uv ? 1 : 0}|${o.jw ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const parts = [];
    for (const list of groups.values()) {
      let nv = 0, ni = 0; for (const o of list) { nv += o.P.length / 3; ni += o.idx.length; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = list[0].uv ? new Float32Array(nv * 2) : null, C = list[0].col ? new Uint8Array(nv * 3) : null;
      const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      const Jb = list[0].jw ? new Uint8Array(nv * 4) : null, Wb = Jb ? new Uint8Array(nv * 4) : null;
      let vo = 0, io = 0;
      for (const o of list) {
        const n = o.P.length / 3;
        P.set(o.P, vo * 3);
        if (o.N) N.set(o.N, vo * 3); else smoothNormals(o.P, o.idx, N, vo);
        if (UV) UV.set(o.uv, vo * 2);
        if (C) for (let i = 0; i < n * 3; i++) C[vo * 3 + i] = Math.round(Math.max(0, Math.min(1, o.col[i])) * 255);
        if (Jb) { Jb.set(o.jw.j, vo * 4); Wb.set(o.jw.w, vo * 4); }
        for (let i = 0; i < o.idx.length; i++) I[io + i] = o.idx[i] + vo;
        vo += n; io += o.idx.length;
      }
      const N8 = new Int8Array(nv * 3); for (let i = 0; i < N.length; i++) N8[i] = Math.round(Math.max(-1, Math.min(1, N[i])) * 127);
      const part = { m: list[0].mat, p: P, n: N8, u: UV, c: C, i: I };
      if (Jb) { part.j = Jb; part.w = Wb; }
      parts.push(part);
    }
    const usedMats = [...new Set(parts.map(p => p.m))];
    const matMap = new Map(usedMats.map((m, i) => [m, i]));
    const outMats = usedMats.map(m => ({ ...(mats[m] || { c: [.8, .8, .8], a: 1, tex: -1, r: .7, m: 0, e: null, etex: -1, at: 0, blend: false, d: false }) }));
    for (const p of parts) { p.m = matMap.get(p.m); outMats[p.m].vc = !!p.c; }
    let verts = 0; for (const p of parts) verts += p.p.length / 3;
    const res = { v: 1, name: String(name || 'Модель').slice(0, 40), tris: Math.round(tris), verts, size: ext.map(v => +(v * k).toFixed(3)), fitted, mats: outMats, parts };
    if (src.skin && parts.some(p => p.j)) { const sm = skinModel(src.skin, src.anims || [], k, [cx, by, cz]); res.skin = sm.skin; res.anims = sm.anims; }
    return res;
  }
  function smoothNormals(P, idx, N, vo){
    const n = P.length / 3, acc = new Float32Array(n * 3);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { acc[v] += nx; acc[v + 1] += ny; acc[v + 2] += nz; }
    }
    for (let i = 0; i < n; i++) { const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1; N[(vo + i) * 3] = acc[i * 3] / l; N[(vo + i) * 3 + 1] = acc[i * 3 + 1] / l; N[(vo + i) * 3 + 2] = acc[i * 3 + 2] / l; }
  }

  // ═══ Текстуры: ужать до 1024, перекодировать (webp/jpeg; с прозрачностью — webp/png). Без браузера — как есть ═══
  async function compileTextures(model, images){
    const used = [...new Set(model.mats.flatMap(m => [m.tex, m.etex]).filter(t => t >= 0))].slice(0, LIMIT.tex);
    const remap = new Map(used.map((t, i) => [t, i]));
    for (const m of model.mats) { m.tex = remap.has(m.tex) ? remap.get(m.tex) : -1; m.etex = remap.has(m.etex) ? remap.get(m.etex) : -1; }
    model.tex = [];
    for (const t of used) {
      const im = images[t];
      if (!im) { model.tex.push(null); continue; }
      if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') { model.tex.push({ raw: im.bytes, w: 0, h: 0 }); continue; }
      let bmp;
      try { bmp = await createImageBitmap(new Blob([im.bytes], { type: im.mime || sniff(im.bytes) })); }
      catch (e) { model.tex.push(null); continue; }   // картинка не читается — материал без текстуры
      const s = Math.min(1, LIMIT.texSize / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
      const px = g.getImageData(0, 0, w, h).data; let alpha = false;
      for (let i = 3; i < px.length; i += 16) if (px[i] < 250) { alpha = true; break; }
      const blob = await new Promise(res => cv.toBlob(res, alpha ? 'image/webp' : 'image/jpeg', .86));
      model.tex.push(blob ? { blob, w, h, alpha } : null);
    }
    for (const m of model.mats) { if (m.tex >= 0 && !model.tex[m.tex]) m.tex = -1; if (m.etex >= 0 && !model.tex[m.etex]) m.etex = -1; }
  }
  const sniff = b => b[0] === 0x89 ? 'image/png' : b[0] === 0xFF ? 'image/jpeg' : b[0] === 0x52 ? 'image/webp' : 'image/png';

  // ═══ Вход: файлы → модель ═══
  async function compile(files, o = {}){
    const step = o.onStep || (() => {});
    files = await Promise.all([...files].map(async f => f.data !== undefined ? f : { name: f.name, data: /\.(gltf|obj|mtl)$/i.test(f.name) ? await f.text() : await f.arrayBuffer(), size: f.size }));
    const total = files.reduce((s, f) => s + (f.size || f.data.byteLength || f.data.length || 0), 0);
    if (total > 60e6) fail('Файлы больше 60 МБ — слишком тяжело для браузера');
    const main = files.find(f => /\.glb$/i.test(f.name)) || files.find(f => /\.gltf$/i.test(f.name)) || files.find(f => /\.obj$/i.test(f.name));
    if (!main) {
      if (files.some(f => /\.fbx$/i.test(f.name))) fail('FBX пока не открывается. В Blender: File → Import FBX, затем File → Export → glTF 2.0 (.glb). В Unity — пакет UnityGLTF → Export .glb');
      fail('Нужен файл .glb, .gltf или .obj');
    }
    step('read');
    let src;
    if (/\.glb$/i.test(main.name)) { const G = parseGLB(main.data); src = gltfToRaw(G, files); }
    else if (/\.gltf$/i.test(main.name)) { let json; try { json = JSON.parse(typeof main.data === 'string' ? main.data : new TextDecoder().decode(main.data)); } catch (e) { fail('Файл .gltf повреждён (не JSON)'); } src = gltfToRaw({ json, bin: null }, files); }
    else src = objToRaw(typeof main.data === 'string' ? main.data : new TextDecoder().decode(main.data), files);
    step('check');
    const model = bake(src, o.name || main.name.replace(/\.[^.]+$/, ''));
    step('tex');
    await compileTextures(model, src.images);
    model.bytes = sizeOf(model);
    if (model.bytes > LIMIT.bytes) fail(`После сжатия модель весит ${(model.bytes / 1e6).toFixed(1)} МБ — можно до ${LIMIT.bytes / 1e6} МБ`);
    model.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    model.t = Date.now();
    step('done');
    return model;
  }
  const sizeOf = m => m.parts.reduce((s, p) => s + p.p.byteLength + p.n.byteLength + (p.u?.byteLength || 0) + (p.c?.byteLength || 0) + p.i.byteLength + (p.j ? p.j.byteLength * 2 : 0), 0)
    + (m.anims || []).reduce((s, a) => s + a.tr.reduce((x, r) => x + r.t.byteLength + r.v.byteLength, 0), 0) + (m.tex || []).reduce((s, t) => s + (t?.blob?.size || t?.raw?.byteLength || 0), 0);

  // ═══ Хранилище: IndexedDB (только этот браузер) ═══
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('Нет хранилища браузера')); return; }
    const r = indexedDB.open('d37e', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('models')) r.result.createObjectStore('models', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('models', mode), s = t.objectStore('models'), r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Не хватило места в браузере')); }); };
  const cache = new Map(), pending = new Map();
  const M = E.models = {
    LIMIT, compile, _test: { parseGLB, gltfToRaw, objToRaw, bake, m4 },
    cached: id => cache.get(id) || null,
    async save(model){ await tx('readwrite', s => s.put(model)); cache.set(model.id, model); return model; },
    async load(id){
      if (!id) return null;
      if (cache.has(id)) return cache.get(id);
      if (pending.has(id)) return pending.get(id);
      const p = (async () => {
        let m = null;
        try { m = await tx('readonly', s => s.get(id)); } catch (e) {}
        // нет в браузере — чужая модель из выложенного мира (M.remote даёт студия: хранилище сайта, только проверенные)
        if (!m && M.remote) { try { const pm = await M.remote(id); const u = pm && M.unpack(pm); if (u && u.id === id) { u.foreign = true; m = u; await M.save(u).catch(() => { cache.set(id, u); }); } } catch (e) {} }
        if (m) cache.set(id, m);
        return m || null;
      })();
      pending.set(id, p); p.finally(() => pending.delete(id));
      return p;
    },
    remote: null,   // (id) → Promise<упакованная модель | null>
    async list(){ try { const all = await tx('readonly', s => s.getAll()); return (all || []).filter(m => !m.foreign).map(m => ({ id: m.id, name: m.name, tris: m.tris, bytes: m.bytes, t: m.t, size: m.size, pub: m.pub || null })).sort((a, b) => b.t - a.t); } catch (e) { return []; } },
    async remove(id){ cache.delete(id); disposeShared(id); try { await tx('readwrite', s => s.delete(id)); } catch (e) {} },
    async rename(id, name){ const m = await M.load(id); if (!m) return; m.name = String(name).slice(0, 40); await M.save(m); },
  };

  // ═══ Картинка в сцене: общие геометрии и материалы на модель (копии ничего не стоят) ═══
  const shared = new Map();   // id → { geos, mats, texs }
  function disposeShared(id){ const s = shared.get(id); if (!s) return; s.geos.forEach(g => g.dispose()); s.mats.forEach(m => m.dispose()); s.texs.forEach(t => t?.dispose()); if (s.anim) s.anim.clips.clear(); shared.delete(id); }
  M.dispose = () => { for (const id of [...shared.keys()]) disposeShared(id); };
  function sharedOf(R, model){
    let s = shared.get(model.id);
    if (s && s.q === R.q && s.T === R.T && s.r === R.r) return s;   // новый рендерер (студию открыли снова) — свои копии: старые держали бы его слушателями dispose
    if (s) disposeShared(model.id);
    const T = R.T, low = R.q === 'low';
    const texs = (model.tex || []).map(t => {
      if (!t) return null;
      const tx2 = new T.Texture(); tx2.encoding = T.sRGBEncoding; tx2.flipY = false; tx2.wrapS = tx2.wrapT = T.RepeatWrapping;
      tx2.anisotropy = Math.min(8, R.r.capabilities.getMaxAnisotropy?.() || 1);
      const blob = t.blob || (t.raw && new Blob([t.raw]));
      if (blob && typeof createImageBitmap !== 'undefined') createImageBitmap(blob).then(b => { tx2.image = b; tx2.needsUpdate = true; }).catch(() => {});
      return tx2;
    });
    const mats = model.mats.map(m => {
      const color = new T.Color().setRGB(m.c[0], m.c[1], m.c[2]);
      const base = { color, map: m.tex >= 0 ? texs[m.tex] || null : null, vertexColors: !!m.vc, side: m.d ? T.DoubleSide : T.FrontSide, transparent: !!m.blend || m.a < .99, opacity: m.a, alphaTest: m.at || 0, depthWrite: !(m.blend || m.a < .99) };
      if (m.unlit) return new T.MeshBasicMaterial(base);
      if (low) return new T.MeshLambertMaterial({ ...base, emissive: m.e ? new T.Color().setRGB(...m.e) : 0x000000 });
      return new T.MeshStandardMaterial({ ...base, roughness: m.r ?? .7, metalness: m.m ?? 0, envMapIntensity: .8,
        emissive: m.e ? new T.Color().setRGB(...m.e) : 0x000000, emissiveMap: m.etex >= 0 ? texs[m.etex] || null : null });
    });
    const geos = model.parts.map(p => {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(p.p, 3));
      g.setAttribute('normal', new T.BufferAttribute(p.n, 3, true));
      if (p.u) g.setAttribute('uv', new T.BufferAttribute(p.u, 2));
      if (p.c) g.setAttribute('color', new T.BufferAttribute(p.c, 3, true));
      g.setIndex(new T.BufferAttribute(p.i, 1));
      if (p.j) { g.setAttribute('skinIndex', new T.BufferAttribute(p.j, 4)); g.setAttribute('skinWeight', new T.BufferAttribute(p.w, 4, true)); }
      g.computeBoundingBox(); g.computeBoundingSphere();
      if (p.j) g.boundingSphere.radius *= 1.6;   // анимация уводит вершины от позы покоя
      return g;
    });
    s = { geos, mats, texs, q: R.q, T: R.T, r: R.r };
    shared.set(model.id, s);
    return s;
  }
  // Группа с моделью; размер группы = model.size (растягивать — scale у группы)
  M.instance = (R, model, o) => {
    const s = sharedOf(R, model), g = new R.T.Group();
    if (M.SKIN && model.skin && model.parts.some(p => p.j)) {
      try { if (skinnedInstance(R, model, s, g, o || {})) return g; } catch (e) { console.warn('D37E.models: скелет не собрался, модель без движения', e); }
      while (g.children.length) g.remove(g.children[0]);   // запасной путь — поза покоя
      if (g.userData.anim) { M.release(g.userData.anim); g.userData.anim = null; }
    }
    model.parts.forEach((p, i) => {
      const mesh = new R.T.Mesh(s.geos[i], s.mats[p.m]);
      if (R.r.shadowMap.enabled) { mesh.castShadow = !(model.mats[p.m].blend); mesh.receiveShadow = true; }
      g.add(mesh);
    });
    return g;
  };

  // ═══ Точные столкновения (как CollisionFidelity в Roblox): кубики по поверхности модели → склейка в коробки ═══
  // Кубик твёрдый, если в нём есть точка какого-нибудь треугольника; внутри закрытой модели пусто (в дом с проёмом можно
  // зайти). Коробки ужимаются до настоящих точек: пол не «поднимается» на высоту кубика, стена — своей толщины (не тоньше 0,1).
  // M.colliders(model) → [[cx, cy, cz, hx, hy, hz], …] в единицах модели (низ — y = 0, центр по x/z); считается раз за сеанс.
  M.colliders = model => {
    if (model._col) return model._col;
    const S = model.size;
    let cell = Math.max(.3, Math.min(2, Math.max(...S) / 32)), boxes = null;
    for (let t = 0; t < 4 && !boxes; t++, cell *= 1.5) boxes = voxelBoxes(model, cell, 900);
    model._col = boxes || [[0, S[1] / 2, 0, S[0] / 2, S[1] / 2, S[2] / 2]];
    return model._col;
  };
  function voxelBoxes(model, cell, maxBoxes){
    const S = model.size, n = [0, 1, 2].map(i => Math.max(1, Math.min(96, Math.ceil(S[i] / cell))));
    const c = [S[0] / n[0] || 1, S[1] / n[1] || 1, S[2] / n[2] || 1], o = [-S[0] / 2, 0, -S[2] / 2];
    const N = n[0] * n[1] * n[2], fill = new Uint8Array(N), lo = new Float32Array(N * 3).fill(Infinity), hi = new Float32Array(N * 3).fill(-Infinity);
    const idx = (i, j, k) => (k * n[1] + j) * n[0] + i;
    const cl = (v, m) => v < 0 ? 0 : v >= m ? m - 1 : v;
    const mark = (x, y, z) => {
      const v = idx(cl(Math.floor((x - o[0]) / c[0]), n[0]), cl(Math.floor((y - o[1]) / c[1]), n[1]), cl(Math.floor((z - o[2]) / c[2]), n[2])), b = v * 3;
      fill[v] = 1;
      if (x < lo[b]) lo[b] = x; if (y < lo[b + 1]) lo[b + 1] = y; if (z < lo[b + 2]) lo[b + 2] = z;
      if (x > hi[b]) hi[b] = x; if (y > hi[b + 1]) hi[b + 1] = y; if (z > hi[b + 2]) hi[b + 2] = z;
    };
    const step = Math.min(c[0], c[1], c[2]) * .5;
    for (const p of model.parts) {
      const P = p.p, I = p.i;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3;
        const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b] - ax, by = P[b + 1] - ay, bz = P[b + 2] - az, cx = P[d] - ax, cy = P[d + 1] - ay, cz = P[d + 2] - az;
        const L = Math.max(Math.hypot(bx, by, bz), Math.hypot(cx, cy, cz), Math.hypot(bx - cx, by - cy, bz - cz));
        const m = Math.min(300, Math.max(1, Math.ceil(L / step)));
        for (let s = 0; s <= m; s++) for (let u = 0; u <= m - s; u++) { const fs = s / m, fu = u / m; mark(ax + bx * fs + cx * fu, ay + by * fs + cy * fu, az + bz * fs + cz * fu); }
      }
    }
    // жадная склейка кубиков: вдоль x, потом y, потом z
    const used = new Uint8Array(N), out = [];
    const free = v => fill[v] && !used[v];
    for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
      if (!free(idx(i, j, k))) continue;
      let i1 = i; while (i1 + 1 < n[0] && free(idx(i1 + 1, j, k))) i1++;
      let j1 = j;
      growY: while (j1 + 1 < n[1]) { for (let ii = i; ii <= i1; ii++) if (!free(idx(ii, j1 + 1, k))) break growY; j1++; }
      let k1 = k;
      growZ: while (k1 + 1 < n[2]) { for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) if (!free(idx(ii, jj, k1 + 1))) break growZ; k1++; }
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let kk = k; kk <= k1; kk++) for (let jj = j; jj <= j1; jj++) for (let ii = i; ii <= i1; ii++) {
        const v = idx(ii, jj, kk), b = v * 3; used[v] = 1;
        for (let q = 0; q < 3; q++) { if (lo[b + q] < mn[q]) mn[q] = lo[b + q]; if (hi[b + q] > mx[q]) mx[q] = hi[b + q]; }
      }
      const box = [];
      for (let q = 0; q < 3; q++) { let a = mn[q], b = mx[q]; if (b - a < .1) { const m = (a + b) / 2; a = m - .05; b = m + .05; } box[q] = +((a + b) / 2).toFixed(3); box[q + 3] = +((b - a) / 2).toFixed(3); }
      out.push(box);
      if (out.length > maxBoxes) return null;
    }
    return out;
  }

  // ═══ Для файла мира: модель ↔ base64 ═══
  const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const arr = (a, kind) => a ? { k: kind, d: toB64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) } : null;
  const TYPES = { f32: Float32Array, i8: Int8Array, i16: Int16Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
  const unarr = o => { if (!o) return null; const T = TYPES[o.k]; if (!T) return null; const b = b64ToBytes(o.d); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
  M.pack = async model => ({
    v: 1, id: model.id, name: model.name, tris: model.tris, verts: model.verts, size: model.size, t: model.t, bytes: model.bytes, mats: model.mats,
    parts: model.parts.map(p => ({ m: p.m, p: arr(p.p, 'f32'), n: arr(p.n, 'i8'), u: arr(p.u, 'f32'), c: arr(p.c, 'u8'), i: arr(p.i, p.i instanceof Uint32Array ? 'u32' : 'u16'), j: arr(p.j, 'u8'), w: arr(p.w, 'u8') })),
    skin: model.skin ? { n: model.skin.n, names: model.skin.names, par: arr(model.skin.par, 'i16'), t: arr(model.skin.t, 'f32'), q: arr(model.skin.q, 'f32'), s: arr(model.skin.s, 'f32') } : undefined,
    anims: model.anims ? model.anims.map(a => ({ name: a.name, dur: a.dur, meta: a.meta, tr: a.tr.map(r => ({ b: r.b, k: r.k, st: r.st, t: arr(r.t, 'f32'), v: arr(r.v, 'f32') })) })) : undefined,
    tex: await Promise.all((model.tex || []).map(async t => t ? { w: t.w, h: t.h, alpha: !!t.alpha, d: toB64(new Uint8Array(t.blob ? await t.blob.arrayBuffer() : t.raw)), type: t.blob?.type || '' } : null)),
  });
  // Из файла мира — та же проверка, что при загрузке: типы, длины, номера вершин
  M.unpack = d => {
    if (!d || d.v !== 1 || typeof d.id !== 'string' || !Array.isArray(d.parts) || !Array.isArray(d.mats)) return null;
    const parts = [];
    let tris = 0;
    for (const p of d.parts.slice(0, 64)) {
      const P = unarr(p.p), N = unarr(p.n), UV = unarr(p.u), C = unarr(p.c), I = unarr(p.i);
      if (!(P instanceof Float32Array) || !(N instanceof Int8Array) || !(I instanceof Uint16Array || I instanceof Uint32Array) || P.length % 3 || N.length !== P.length) return null;
      const nv = P.length / 3;
      if (UV && (!(UV instanceof Float32Array) || UV.length !== nv * 2)) return null;
      if (C && (!(C instanceof Uint8Array) || C.length !== nv * 3)) return null;
      for (let i = 0; i < I.length; i++) if (I[i] >= nv) return null;
      for (let i = 0; i < P.length; i++) if (!Number.isFinite(P[i])) return null;
      tris += I.length / 3;
      const part = { m: Math.max(0, Math.min(d.mats.length - 1, p.m | 0)), p: P, n: N, u: UV, c: C, i: I };
      const Jb = unarr(p.j), Wb = unarr(p.w);
      if (Jb || Wb) { if (!(Jb instanceof Uint8Array) || !(Wb instanceof Uint8Array) || Jb.length !== nv * 4 || Wb.length !== nv * 4) return null; part.j = Jb; part.w = Wb; }
      parts.push(part);
    }
    const sk = d.skin && unskin(d.skin);
    if (d.skin && !sk) return null;
    if (sk) for (const p of parts) if (p.j) for (let i = 0; i < p.j.length; i++) if (p.j[i] >= sk.n) return null;
    if (!sk) for (const p of parts) { delete p.j; delete p.w; }
    if (tris > LIMIT.tris) return null;
    const num = (v, a, b, def) => Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : def;
    const col = c => Array.isArray(c) && c.length >= 3 ? c.slice(0, 3).map(v => num(v, 0, 10, 1)) : null;
    const mats = d.mats.slice(0, 64).map(m => ({ c: col(m.c) || [.8, .8, .8], a: num(m.a, 0, 1, 1), tex: num(m.tex, -1, 7, -1) | 0, r: num(m.r, 0, 1, .7), m: num(m.m, 0, 1, 0), e: col(m.e), etex: num(m.etex, -1, 7, -1) | 0, at: num(m.at, 0, 1, 0), blend: !!m.blend, d: !!m.d, vc: !!m.vc, unlit: !!m.unlit }));
    const tex = (Array.isArray(d.tex) ? d.tex.slice(0, LIMIT.tex) : []).map(t => {
      if (!t || typeof t.d !== 'string') return null;
      const type = /^image\/(png|jpeg|webp)$/.test(t.type) ? t.type : '';
      return { blob: typeof Blob !== 'undefined' ? new Blob([b64ToBytes(t.d)], { type }) : null, raw: typeof Blob === 'undefined' ? b64ToBytes(t.d) : null, w: t.w | 0, h: t.h | 0, alpha: !!t.alpha };
    });
    const size = Array.isArray(d.size) ? d.size.slice(0, 3).map(v => num(v, .01, 1000, 1)) : [1, 1, 1];
    const m = { v: 1, id: d.id.slice(0, 24), name: String(d.name || 'Модель').slice(0, 40), tris: Math.round(tris), verts: parts.reduce((s, p) => s + p.p.length / 3, 0), size, t: +d.t || Date.now(), mats, parts, tex };
    if (sk) { m.skin = sk; m.anims = unanims(d.anims, sk.n); }
    m.bytes = sizeOf(m);
    return m;
  };

  // ═══ Скелет из файла мира: та же строгая проверка ═══
  function unskin(d){
    const n = d.n | 0; if (!(n > 0 && n <= 255) || !Array.isArray(d.names) || d.names.length !== n) return null;
    const par = unarr(d.par), t = unarr(d.t), q = unarr(d.q), s = unarr(d.s);
    if (!(par instanceof Int16Array) || par.length !== n || !(t instanceof Float32Array) || t.length !== n * 3 || !(q instanceof Float32Array) || q.length !== n * 4 || !(s instanceof Float32Array) || s.length !== n * 3) return null;
    for (let i = 0; i < n; i++) if (par[i] < -1 || par[i] >= n || par[i] === i) return null;
    for (const a of [t, q, s]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return null;
    // без циклов: от каждой кости до корня ≤ n шагов
    for (let i = 0; i < n; i++) { let p = par[i], c = 0; while (p >= 0 && c++ <= n) p = par[p]; if (c > n) return null; }
    return { n, names: d.names.map(x => String(x).slice(0, 64)), par, t, q, s };
  }
  function unanims(list, n){
    const out = []; let floats = 0;
    for (const a of (Array.isArray(list) ? list : []).slice(0, 64)) {
      if (!a || !Array.isArray(a.tr)) continue;
      const tr = [];
      for (const r of a.tr.slice(0, n * 3)) {
        const t = unarr(r.t), v = unarr(r.v), k = r.k | 0, nc = k === 1 ? 4 : 3;
        if (!(t instanceof Float32Array) || !(v instanceof Float32Array) || !(k >= 0 && k <= 2) || (r.b | 0) < 0 || (r.b | 0) >= n || !t.length || v.length !== t.length * nc) continue;
        let bad = false; for (let i = 0; i < v.length && !bad; i++) if (!Number.isFinite(v[i])) bad = true; for (let i = 0; i < t.length && !bad; i++) if (!Number.isFinite(t[i]) || (i && t[i] < t[i - 1])) bad = true;
        if (bad) continue;
        floats += t.length + v.length; if (floats > 3e6) break;
        tr.push({ b: r.b | 0, k, st: r.st ? 1 : 0, t, v });
      }
      const meta = a.meta && typeof a.meta === 'object' ? { action: String(a.meta.action || '').slice(0, 40), loop: !!a.meta.loop, additive: !!a.meta.additive, pose: !!a.meta.pose, speed: +a.meta.speed || 0 } : null;
      if (tr.length) out.push({ name: String(a.name || 'clip').slice(0, 64), dur: Math.max(...tr.map(r => r.t[r.t.length - 1])), meta, tr });
    }
    return out;
  }

  // ═══ Модель со скелетом в сцене: SkinnedMesh + AnimationMixer (T-131) ═══
  // Кости и скелет — свои у каждой копии; геометрии, материалы, обратные матрицы и клипы — общие на модель.
  M.SKIN = true;   // откат одной строкой: D37E.models.SKIN = false — все модели статичны (поза покоя)
  M.LOD = [[30, 1], [60, 2], [120, 4]];   // расстояние до камеры (единицы) → обновлять раз в N кадров; дальше — раз в 8; вне экрана — раз в 8
  const live = [];   // живые анимированные копии
  let frameNo = 0, FR = null;
  function animShared(R, model, s){
    if (s.anim) return s.anim;
    const T = R.T, sk = model.skin, n = sk.n, used = new Set(), names = new Array(n);
    for (let i = 0; i < n; i++) {   // имена костей для дорожек: без запрещённых знаков, без повторов
      let nm = T.PropertyBinding.sanitizeNodeName(sk.names[i]) || 'b' + i;
      while (used.has(nm)) nm += '_' + i;
      used.add(nm); names[i] = nm;
    }
    // покой: мировые матрицы → обратные матрицы привязки
    const loc = [], wm = new Array(n), ibm = new Array(n);
    for (let i = 0; i < n; i++) loc[i] = new T.Matrix4().compose(new T.Vector3().fromArray(sk.t, i * 3), new T.Quaternion().fromArray(sk.q, i * 4), new T.Vector3().fromArray(sk.s, i * 3));
    const W = i => wm[i] || (wm[i] = sk.par[i] < 0 ? loc[i].clone() : new T.Matrix4().multiplyMatrices(W(sk.par[i]), loc[i]));
    for (let i = 0; i < n; i++) ibm[i] = W(i).clone().invert();
    s.anim = { names, ibm, wm, clips: new Map(), hum: humanoidMap(sk), lib: null };
    return s.anim;
  }
  function skinnedInstance(R, model, s, g, o){
    const T = R.T; if (!T.SkinnedMesh || !T.AnimationMixer) return false;
    const caps = R.r.capabilities;
    if (!caps.floatVertexTextures && model.skin.n > Math.floor(((caps.maxVertexUniforms || 256) - 20) / 4)) return false;   // столько костей шейдер не возьмёт
    const A = animShared(R, model, s), sk = model.skin, n = sk.n, bones = new Array(n);
    for (let i = 0; i < n; i++) { const b = new T.Bone(); b.name = A.names[i]; b.position.fromArray(sk.t, i * 3); b.quaternion.fromArray(sk.q, i * 4); b.scale.fromArray(sk.s, i * 3); bones[i] = b; }
    for (let i = 0; i < n; i++) (sk.par[i] >= 0 ? bones[sk.par[i]] : g).add(bones[i]);
    const skeleton = new T.Skeleton(bones, A.ibm), id = new T.Matrix4();
    model.parts.forEach((p, i) => {
      const mesh = p.j ? new T.SkinnedMesh(s.geos[i], s.mats[p.m]) : new T.Mesh(s.geos[i], s.mats[p.m]);
      if (p.j) mesh.bind(skeleton, id);
      if (R.r.shadowMap.enabled) { mesh.castShadow = !(model.mats[p.m].blend); mesh.receiveShadow = true; }
      g.add(mesh);
    });
    const h = { g, T, model, mixer: new T.AnimationMixer(g), skeleton, acts: [], acc: 0, i: live.length, orphan: 0, r: Math.hypot(...model.size) / 2, name: null };
    g.userData.anim = h;
    live.push(h);
    M.play(h, o.act || '');
    return true;
  }
  // ── имена костей других программ → общие кости (spec/data/skeleton.json): Mixamo, 3ds Max Biped (Rocketbox), Unity Humanoid ──
  const ALIAS = { pelvis: 'Hips', spine1: 'Chest', spine2: 'UpperChest', leftarm: 'LeftUpperArm', leftforearm: 'LeftLowerArm', leftupleg: 'LeftUpperLeg', leftleg: 'LeftLowerLeg', lefttoebase: 'LeftToes',
    lefthandindex1: 'LeftIndexProximal', lefthandmiddle1: 'LeftMiddleProximal', lefthandpinky1: 'LeftLittleProximal', lclavicle: 'LeftShoulder', lupperarm: 'LeftUpperArm', lforearm: 'LeftLowerArm', lhand: 'LeftHand',
    lthigh: 'LeftUpperLeg', lcalf: 'LeftLowerLeg', lfoot: 'LeftFoot', ltoe0: 'LeftToes', lfinger1: 'LeftIndexProximal', lfinger2: 'LeftMiddleProximal', lfinger4: 'LeftLittleProximal' };
  for (const k of Object.keys(ALIAS)) { const v = ALIAS[k]; if (v.startsWith('Left')) ALIAS[k[0] === 'l' && !k.startsWith('left') ? 'r' + k.slice(1) : 'right' + k.slice(4)] = 'Right' + v.slice(4); }
  function sharedId(name){
    const SK = E.skel; if (!SK) return -1;
    let n = String(name).replace(/^.*[:|]/, '').replace(/^bip0?1[ _]?/i, '').replace(/[ _.]/g, '');
    let i = SK.index(n); if (i >= 0) return i;
    const a = ALIAS[n.toLowerCase()]; return a ? SK.index(a) : -1;
  }
  function humanoidMap(sk){
    const SK = E.skel; if (!SK) return null;
    const map = new Int16Array(SK.NB).fill(-1);
    for (let i = 0; i < sk.n; i++) { const b = sharedId(sk.names[i]); if (b >= 0 && map[b] < 0) map[b] = i; }
    return SK.BONES.every((b, i) => !b.req || map[i] >= 0) ? map : null;
  }
  // общие действия (D37E.skel) для этой модели: скелет генератора из её T-позы, перенос на её кости (поза покоя может быть A-позой)
  function libSetup(model, A){
    if (A.lib) return A.lib;
    const SK = E.skel, q = SK.q, sk = model.skin, hm = A.hum, NB = SK.NB, BONES = SK.BONES;
    const P = new Array(sk.n), Q = new Array(sk.n), Sc = new Array(sk.n);
    for (let i = 0; i < sk.n; i++) { const e = A.wm[i].elements, d = m4.dec(Array.from(e)); P[i] = d.t; Q[i] = d.q; Sc[i] = d.s[0]; }
    const ref = SK.reference(), rp = b => [ref.rest[b * 3], ref.rest[b * 3 + 1], ref.rest[b * 3 + 2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], len = v => Math.hypot(v[0], v[1], v[2]), nrm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const chain = new Int16Array(NB).fill(-1);
    for (let b = 0; b < NB; b++) { let p = BONES[b].parent; while (p >= 0 && hm[p] < 0) p = BONES[p].parent; chain[b] = p; }
    // T-поза модели: длины её костей вдоль направлений эталона
    const J = {};
    for (let b = 0; b < NB; b++) {
      if (hm[b] < 0) continue;
      const id = BONES[b].id, pa = chain[b];
      if (pa < 0) { J[id] = P[hm[b]].slice(); continue; }
      const L = len(sub(P[hm[b]], P[hm[pa]])), d = nrm(sub(rp(b), rp(pa))), base = J[BONES[pa].id];
      J[id] = [base[0] + d[0] * L, base[1] + d[1] * L, base[2] + d[2] * L];
    }
    const gen = SK.fromJoints(J);
    // поворот «как в T-позе» для каждой кости: убрать отклонение её направления от эталона (A-поза, разведённые ноги)
    const CHILD = { Hips: null, Spine: ['Chest', 'UpperChest', 'Neck'], Chest: ['UpperChest', 'Neck'], UpperChest: ['Neck'], Neck: ['Head'] };
    for (const s of ['Left', 'Right']) Object.assign(CHILD, { [s + 'Shoulder']: [s + 'UpperArm'], [s + 'UpperArm']: [s + 'LowerArm'], [s + 'LowerArm']: [s + 'Hand'], [s + 'Hand']: [s + 'MiddleProximal'],
      [s + 'UpperLeg']: [s + 'LowerLeg'], [s + 'LowerLeg']: [s + 'Foot'], [s + 'Foot']: [s + 'Toes'] });
    const Tw = new Array(NB), dl = new Array(NB);
    for (let b = 0; b < NB; b++) {
      if (hm[b] < 0) continue;
      const id = BONES[b].id, kids = CHILD[id];
      let D = null;
      if (kids) for (const c of kids) { const ci = SK.index(c); if (hm[ci] >= 0) { D = q.arc(sub(rp(ci), rp(b)), sub(P[hm[ci]], P[hm[b]])); break; } }
      if (!D) D = id === 'Hips' || chain[b] < 0 ? [0, 0, 0, 1] : (dl[chain[b]] || [0, 0, 0, 1]);
      dl[b] = D; Tw[b] = q.mul(q.inv(D), Q[hm[b]]);
    }
    // настоящий родитель в иерархии МОДЕЛИ: ближайший отображённый предок (у 3ds Max Biped / Rocketbox бёдра — дети «Bip01 Spine»,
    // ключицы — дети «Bip01 Neck»: они двигаются с ними) + поворот покоя неотображённых костей между ними (скрутки, «Bip01 …»)
    const rev = new Int16Array(sk.n).fill(-1); for (let b = 0; b < NB; b++) if (hm[b] >= 0) rev[hm[b]] = b;
    const par = new Int16Array(NB).fill(-1), mid = new Array(NB);
    for (let b = 0; b < NB; b++) {
      if (hm[b] < 0) continue;
      let a = sk.par[hm[b]]; while (a >= 0 && rev[a] < 0) a = sk.par[a];
      const ap = sk.par[hm[b]];
      if (a < 0) { mid[b] = ap >= 0 ? Q[ap] : [0, 0, 0, 1]; continue; }   // над отображёнными (корень модели) — его поворот покоя
      par[b] = rev[a];
      mid[b] = ap !== a ? q.mul(q.inv(Q[a]), Q[ap]) : [0, 0, 0, 1];
    }
    // переподвешенные кости (бёдра Biped под Spine, ключицы под Neck): сустав едет с общим родителем (Hips / UpperChest), а не с
    // настоящим — дорожка позиции; путь в модели от общего родителя до настоящего (смещения покоя в кадре родителя, без масштаба)
    const rel = (i, j) => q.rot(q.inv(Q[j]), sub(P[i], P[j])), pos = [];
    for (let b = 0; b < NB; b++) {
      const ca = chain[b]; if (hm[b] < 0 || ca < 0 || par[b] < 0 || par[b] === ca) continue;
      const path = []; let x = sk.par[hm[b]];
      while (x >= 0 && x !== hm[ca]) { path.push(x); x = sk.par[x]; }
      if (x !== hm[ca]) continue;   // общий родитель — не предок в модели: оставить как есть
      path.reverse();
      pos.push({ b, ca, ob: rel(hm[b], hm[ca]), sc: Sc[sk.par[hm[b]]] || 1, path: path.map(i => ({ m: rev[i], t: rel(i, sk.par[i]), r: rev[i] < 0 ? q.mul(q.inv(Q[sk.par[i]]), Q[i]) : null })) });
    }
    const hp = sk.par[hm[0]], pwM = hp >= 0 ? A.wm[hp].clone().invert() : null, pw = hp >= 0 ? Q[hp] : [0, 0, 0, 1];
    const hipsLocal = pwM ? v => { const e = pwM.elements, x = v[0], y = v[1], z = v[2]; return [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]; } : null;
    A.lib = { gen, names: Array.from(hm, i => i >= 0 ? A.names[i] : null), tg: { Tw, chain, par, mid, pos, pw, hipsP: J.Hips, srcHips: [gen.rest[0], gen.rest[1], gen.rest[2]], hipsK: 1, hipsLocal } };
    return A.lib;
  }
  // клип по имени: свой (из файла) или общее действие; три-клипы общие на модель
  function clipFor(h, name){
    const s = shared.get(h.model.id), A = s && s.anim; if (!A) return null;
    if (A.clips.has(name)) return A.clips.get(name);
    const T = h.T, own = (h.model.anims || []).find(a => a.name === name);
    let c = null;
    if (own) {
      const tr = own.tr.map(r => new (r.k === 1 ? T.QuaternionKeyframeTrack : T.VectorKeyframeTrack)(A.names[r.b] + (r.k === 0 ? '.position' : r.k === 1 ? '.quaternion' : '.scale'), r.t, r.v, r.st ? T.InterpolateDiscrete : T.InterpolateLinear));
      c = new T.AnimationClip(own.name, own.dur, tr); c.userData = { d37: own.meta || null };
    } else if (A.hum && E.skel && E.skel.SPEC[name]) {
      const L = libSetup(h.model, A), gc = E.skel.generate(L.gen, name);
      c = E.skel.toThree(T, gc, { names: L.names, target: L.tg });
    }
    if (c && c.userData?.d37?.additive) T.AnimationUtils.makeClipAdditive(c);
    A.clips.set(name, c);
    return c;
  }
  // список действий модели: свои клипы + общие (если кости — гуманоид)
  M.actions = model => {
    const own = (model.anims || []).map(a => a.name), hum = model.skin && E.skel ? !!humanoidMap(model.skin) : false;
    return { own, lib: hum ? E.skel.LIST.slice() : [], humanoid: hum, bones: model.skin ? model.skin.n : 0 };
  };
  // сменить действие: '' — само (стоит: idle), 'none' — поза покоя; добавочные (присадки) — поверх стойки
  M.play = (h, name, fade = .25) => {
    if (!h || h.dead) return false;
    const list = M.actions(h.model);
    let nm = name || '';
    if (!nm) nm = list.own.find(x => /idle|stand|стоит/i.test(x)) || (list.humanoid ? 'loco.idle' : list.own[0] || 'none');
    if (nm === h.name) return true;
    const old = h.acts; h.acts = []; h.name = nm;
    for (const a of old) a.fadeOut(fade);
    if (!old.length) fade = 0;   // первое действие — сразу, без проявления из позы покоя
    if (nm === 'none') { if (!old.length) h.mixer.stopAllAction(); return true; }
    const c = clipFor(h, nm); if (!c) { h.name = null; return false; }
    const play = (clip, add) => { const a = h.mixer.clipAction(clip, h.g, add ? h.T.AdditiveAnimationBlendMode : h.T.NormalAnimationBlendMode); a.reset(); a.setLoop(h.T.LoopRepeat, Infinity); a.clampWhenFinished = false; a.fadeIn(fade).play(); h.acts.push(a); };
    if (c.userData?.d37?.additive) { const base = clipFor(h, list.own.find(x => /idle/i.test(x)) || 'loco.idle'); if (base) play(base, false); play(c, true); }
    else play(c, false);
    if (!fade) h.mixer.update(0);   // поза сразу (дальние обновляются редко)
    return true;
  };
  M.release = h => {
    if (!h || h.dead) return;
    h.dead = true;
    h.mixer.stopAllAction(); h.mixer.uncacheRoot(h.g); h.skeleton.dispose();
    const i = live.indexOf(h); if (i >= 0) { live[i] = live[live.length - 1]; live.pop(); }
    if (h.g.userData.anim === h) h.g.userData.anim = null;
  };
  M.live = () => live.length;
  M.releaseAll = () => { for (let i = live.length - 1; i >= 0; i--) M.release(live[i]); };   // закрыли игру/редактор — страховка
  // раз в кадр: ближние — каждый кадр, дальние и невидимые — реже (накопленным временем); без мусора в кадре
  M.animate = (dt, camera) => {
    frameNo++;
    if (!live.length) return;
    const T = live[0].T;
    if (!FR) FR = { f: new T.Frustum(), m: new T.Matrix4(), s: new T.Sphere() };
    const cam = camera || null;
    if (cam) { FR.m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); FR.f.setFromProjectionMatrix(FR.m); }
    const cx = cam ? cam.position.x : 0, cy = cam ? cam.position.y : 0, cz = cam ? cam.position.z : 0, L = M.LOD;
    for (let i = live.length - 1; i >= 0; i--) {
      const h = live[i];
      if (!h.g.parent) { if (++h.orphan > 120) M.release(h); continue; }   // убрали из сцены и не отдали — через ~2 с отпускаем сами
      h.orphan = 0; h.acc += dt;
      if (!h.g.visible || !h.acts.length) continue;
      const e = h.g.matrixWorld.elements, dx = e[12] - cx, dy = e[13] - cy, dz = e[14] - cz, d2 = dx * dx + dy * dy + dz * dz;
      let step = 8;
      for (let k = 0; k < L.length; k++) if (d2 < L[k][0] * L[k][0]) { step = L[k][1]; break; }
      if (cam && step < 8) { FR.s.center.set(e[12], e[13], e[14]); FR.s.radius = h.r * Math.max(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])); if (!FR.f.intersectsSphere(FR.s)) step = 8; }
      if ((frameNo + i) % step) continue;
      h.mixer.update(h.acc); h.acc = 0;
    }
  };
})();

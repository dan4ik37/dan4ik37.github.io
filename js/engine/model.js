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
    const walk = (ni, parentM, depth) => {
      if (depth > 64) return;
      const n = J.nodes?.[ni]; if (!n) return;
      const local = n.matrix ? n.matrix.slice() : m4.trs(n.translation, n.rotation, n.scale), M = m4.mul(parentM, local);
      if (n.mesh != null) for (const p of J.meshes[n.mesh]?.primitives || []) prims.push({ p, M });
      for (const c of n.children || []) walk(c, M, depth + 1);
    };
    const scene = J.scenes?.[J.scene ?? 0];
    if (scene) for (const ni of scene.nodes || []) walk(ni, m4.id(), 0);
    else (J.meshes || []).forEach((me, i) => { for (const p of me.primitives || []) prims.push({ p, M: m4.id() }); });
    const raw = [];
    for (const { p, M } of prims) {
      const mode = p.mode ?? 4;
      if (mode < 4 || p.attributes?.POSITION == null) continue;   // точки и линии — пропускаем
      if (p.extensions?.KHR_draco_mesh_compression) fail('Модель сжата Draco — сохрани без сжатия (Blender: сними «Compression»)');
      const pos = readAccessor(G, p.attributes.POSITION).arr;
      const nor = p.attributes.NORMAL != null ? readAccessor(G, p.attributes.NORMAL).arr : null;
      const uv = p.attributes.TEXCOORD_0 != null ? readAccessor(G, p.attributes.TEXCOORD_0).arr : null;
      let col = null;
      if (p.attributes.COLOR_0 != null) { const c = readAccessor(G, p.attributes.COLOR_0); col = new Float32Array(c.n * 3); for (let i = 0; i < c.n; i++) for (let j = 0; j < 3; j++) col[i * 3 + j] = c.arr[i * c.k + j]; }
      let idx = p.indices != null ? readAccessor(G, p.indices, true).arr : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      if (mode === 5 || mode === 6) idx = unstrip(idx, mode);
      raw.push({ mat: p.material ?? -1, pos, nor, uv, col, idx, M });
    }
    return { raw, mats, images, uvTop: true };
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
      out.push({ mat: r.mat, P, N: Nn, uv, col: r.col, idx });
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
      const key = `${o.mat}|${o.col ? 1 : 0}|${o.uv ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    const parts = [];
    for (const list of groups.values()) {
      let nv = 0, ni = 0; for (const o of list) { nv += o.P.length / 3; ni += o.idx.length; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = list[0].uv ? new Float32Array(nv * 2) : null, C = list[0].col ? new Uint8Array(nv * 3) : null;
      const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      for (const o of list) {
        const n = o.P.length / 3;
        P.set(o.P, vo * 3);
        if (o.N) N.set(o.N, vo * 3); else smoothNormals(o.P, o.idx, N, vo);
        if (UV) UV.set(o.uv, vo * 2);
        if (C) for (let i = 0; i < n * 3; i++) C[vo * 3 + i] = Math.round(Math.max(0, Math.min(1, o.col[i])) * 255);
        for (let i = 0; i < o.idx.length; i++) I[io + i] = o.idx[i] + vo;
        vo += n; io += o.idx.length;
      }
      const N8 = new Int8Array(nv * 3); for (let i = 0; i < N.length; i++) N8[i] = Math.round(Math.max(-1, Math.min(1, N[i])) * 127);
      parts.push({ m: list[0].mat, p: P, n: N8, u: UV, c: C, i: I });
    }
    const usedMats = [...new Set(parts.map(p => p.m))];
    const matMap = new Map(usedMats.map((m, i) => [m, i]));
    const outMats = usedMats.map(m => ({ ...(mats[m] || { c: [.8, .8, .8], a: 1, tex: -1, r: .7, m: 0, e: null, etex: -1, at: 0, blend: false, d: false }) }));
    for (const p of parts) { p.m = matMap.get(p.m); outMats[p.m].vc = !!p.c; }
    let verts = 0; for (const p of parts) verts += p.p.length / 3;
    return { v: 1, name: String(name || 'Модель').slice(0, 40), tris: Math.round(tris), verts, size: ext.map(v => +(v * k).toFixed(3)), fitted, mats: outMats, parts };
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
  const sizeOf = m => m.parts.reduce((s, p) => s + p.p.byteLength + p.n.byteLength + (p.u?.byteLength || 0) + (p.c?.byteLength || 0) + p.i.byteLength, 0) + (m.tex || []).reduce((s, t) => s + (t?.blob?.size || t?.raw?.byteLength || 0), 0);

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
  function disposeShared(id){ const s = shared.get(id); if (!s) return; s.geos.forEach(g => g.dispose()); s.mats.forEach(m => m.dispose()); s.texs.forEach(t => t?.dispose()); shared.delete(id); }
  M.dispose = () => { for (const id of [...shared.keys()]) disposeShared(id); };
  function sharedOf(R, model){
    let s = shared.get(model.id);
    if (s && s.q === R.q && s.T === R.T) return s;
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
      g.computeBoundingBox(); g.computeBoundingSphere();
      return g;
    });
    s = { geos, mats, texs, q: R.q, T: R.T };
    shared.set(model.id, s);
    return s;
  }
  // Группа с моделью; размер группы = model.size (растягивать — scale у группы)
  M.instance = (R, model) => {
    const s = sharedOf(R, model), g = new R.T.Group();
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
  const TYPES = { f32: Float32Array, i8: Int8Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
  const unarr = o => { if (!o) return null; const T = TYPES[o.k]; if (!T) return null; const b = b64ToBytes(o.d); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
  M.pack = async model => ({
    v: 1, id: model.id, name: model.name, tris: model.tris, verts: model.verts, size: model.size, t: model.t, bytes: model.bytes, mats: model.mats,
    parts: model.parts.map(p => ({ m: p.m, p: arr(p.p, 'f32'), n: arr(p.n, 'i8'), u: arr(p.u, 'f32'), c: arr(p.c, 'u8'), i: arr(p.i, p.i instanceof Uint32Array ? 'u32' : 'u16') })),
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
      parts.push({ m: Math.max(0, Math.min(d.mats.length - 1, p.m | 0)), p: P, n: N, u: UV, c: C, i: I });
    }
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
    m.bytes = sizeOf(m);
    return m;
  };
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — «📸 Фото с трассировкой пути»: снимок текущего вида, честная трассировка лучей на видеокарте
// ═══════════════════════════════════════
// Свой трассировщик (без библиотек: three-gpu-pathtracer — ES-модуль со своей копией three, а сайт работает на общем THREE
// r149). Грузится только по кнопке (⚙️ → Графика → «📸 Фото…»): D37E.pathPhoto(R) — окно поверх 3D, картинка уточняется
// сама (лучей на пиксель всё больше), «💾 Сохранить» — PNG.
// Как: видимая сцена (сетки, склейки, экземпляры, человечки) — в треугольники мира с цветом вершин и материалом (PBR:
// шероховатость, металл; светящееся — свет; вода и стекло — преломление) → BVH (SAH по корзинам, листья ≤ 4) → текстуры
// float → шейдер WebGL2: луч из камеры (сдвиг внутри пикселя — сглаживание), обход BVH стеком, до 5 отскоков, солнце —
// прямым лучом тени с мягким диском, небо — по модели неба движка (E.skyModel), русская рулетка; среднее по кадрам — в
// буфере float. Тональная кривая — ACES, как у движка. Мир под окном живёт дальше (сеть, жители), снимок — неподвижный.
// Проверка без браузера (scripts/render-test.cjs): D37E.ptScene (сцена → треугольники), D37E.ptBuild (BVH), D37E.ptPack (данные
// для видеокарты — тест обходит их так же, как шейдер, и сверяет с перебором), D37E.ptShaders (текст шейдеров).
// Грабли: сэмплер параметром функции во вложенном вызове (tx(tMat, int(tx(tTri, …)))) ANGLE на Direct3D путает — читалась
// не та текстура (вырез травы не работал). Здесь у каждой текстуры данных своя функция чтения: fTri / fMat / fNode.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const TW = 2048;   // ширина текстур данных

  // ═══ BVH: tris — Float32Array (9 на треугольник: 3 вершины), n — число. Возвращает { nodes: Float32Array (8 на узел:
  // min.xyz, a, max.xyz, b; лист: a — первый треугольник в order, b = −число; иначе a, b — дети), order: Uint32Array, depth }
  // Глубина не больше MAXD: стек обхода в шейдере — 40 мест (занято не больше глубины + 1), глубже — один большой лист ═══
  E.ptBuild = (tris, n, leafMax = 4, MAXD = 36) => {
    const cx = new Float32Array(n), cy = new Float32Array(n), cz = new Float32Array(n);
    const bmin = new Float32Array(n * 3), bmax = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      for (let k = 0; k < 3; k++) {
        const a = tris[o + k], b = tris[o + 3 + k], c = tris[o + 6 + k];
        const mn = Math.min(a, b, c), mx = Math.max(a, b, c);
        bmin[i * 3 + k] = mn; bmax[i * 3 + k] = mx;
      }
      cx[i] = (bmin[i * 3] + bmax[i * 3]) * .5; cy[i] = (bmin[i * 3 + 1] + bmax[i * 3 + 1]) * .5; cz[i] = (bmin[i * 3 + 2] + bmax[i * 3 + 2]) * .5;
    }
    const order = new Uint32Array(n); for (let i = 0; i < n; i++) order[i] = i;
    let nodes = new Float32Array(Math.max(16, n * 2) * 8), nn = 0;
    const NB = 12, binN = new Int32Array(NB), binMin = new Float32Array(NB * 3), binMax = new Float32Array(NB * 3);
    const leftA = new Float32Array(NB), leftN = new Int32Array(NB);
    const area = (x0, y0, z0, x1, y1, z1) => { const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0; return dx < 0 ? 0 : dx * dy + dy * dz + dz * dx; };
    MAXD = Math.min(MAXD, 36);
    let depth = 0;
    const stack = [[0, n, -1, 0, 0]];   // [начало, конец, родитель, левый ли, глубина]
    while (stack.length) {
      const [s, e, parent, side, dep] = stack.pop();
      if (dep > depth) depth = dep;
      const id = nn++;
      if (nn * 8 > nodes.length) { const t = new Float32Array(nodes.length * 2); t.set(nodes); nodes = t; }
      if (parent >= 0) nodes[parent * 8 + (side ? 3 : 7)] = id;
      let x0 = 1e30, y0 = 1e30, z0 = 1e30, x1 = -1e30, y1 = -1e30, z1 = -1e30, c0x = 1e30, c0y = 1e30, c0z = 1e30, c1x = -1e30, c1y = -1e30, c1z = -1e30;
      for (let i = s; i < e; i++) {
        const t = order[i], k = t * 3;
        if (bmin[k] < x0) x0 = bmin[k]; if (bmin[k + 1] < y0) y0 = bmin[k + 1]; if (bmin[k + 2] < z0) z0 = bmin[k + 2];
        if (bmax[k] > x1) x1 = bmax[k]; if (bmax[k + 1] > y1) y1 = bmax[k + 1]; if (bmax[k + 2] > z1) z1 = bmax[k + 2];
        if (cx[t] < c0x) c0x = cx[t]; if (cy[t] < c0y) c0y = cy[t]; if (cz[t] < c0z) c0z = cz[t];
        if (cx[t] > c1x) c1x = cx[t]; if (cy[t] > c1y) c1y = cy[t]; if (cz[t] > c1z) c1z = cz[t];
      }
      const o = id * 8;
      nodes[o] = x0; nodes[o + 1] = y0; nodes[o + 2] = z0; nodes[o + 4] = x1; nodes[o + 5] = y1; nodes[o + 6] = z1;
      const cnt = e - s;
      const leaf = () => { nodes[o + 3] = s; nodes[o + 7] = -cnt; };
      if (cnt <= leafMax || dep >= MAXD) { leaf(); continue; }
      // ось — по разбросу центров; SAH по корзинам
      const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z;
      const ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2, cmin = ax === 0 ? c0x : ax === 1 ? c0y : c0z, ext = ax === 0 ? ex : ax === 1 ? ey : ez;
      if (ext < 1e-9) { leaf(); continue; }
      const C = ax === 0 ? cx : ax === 1 ? cy : cz, kb = NB / ext;
      binN.fill(0); binMin.fill(1e30); binMax.fill(-1e30);
      for (let i = s; i < e; i++) {
        const t = order[i]; let b = ((C[t] - cmin) * kb) | 0; if (b >= NB) b = NB - 1;
        binN[b]++;
        for (let k = 0; k < 3; k++) { const v0 = bmin[t * 3 + k], v1 = bmax[t * 3 + k]; if (v0 < binMin[b * 3 + k]) binMin[b * 3 + k] = v0; if (v1 > binMax[b * 3 + k]) binMax[b * 3 + k] = v1; }
      }
      let ax0 = 1e30, ay0 = 1e30, az0 = 1e30, ax1 = -1e30, ay1 = -1e30, az1 = -1e30, cn = 0;
      for (let b = 0; b < NB - 1; b++) {
        cn += binN[b];
        if (binN[b]) { ax0 = Math.min(ax0, binMin[b * 3]); ay0 = Math.min(ay0, binMin[b * 3 + 1]); az0 = Math.min(az0, binMin[b * 3 + 2]); ax1 = Math.max(ax1, binMax[b * 3]); ay1 = Math.max(ay1, binMax[b * 3 + 1]); az1 = Math.max(az1, binMax[b * 3 + 2]); }
        leftA[b] = area(ax0, ay0, az0, ax1, ay1, az1); leftN[b] = cn;
      }
      let best = -1, bestC = cnt * area(x0, y0, z0, x1, y1, z1);
      ax0 = ay0 = az0 = 1e30; ax1 = ay1 = az1 = -1e30; cn = 0;
      for (let b = NB - 1; b > 0; b--) {
        cn += binN[b];
        if (binN[b]) { ax0 = Math.min(ax0, binMin[b * 3]); ay0 = Math.min(ay0, binMin[b * 3 + 1]); az0 = Math.min(az0, binMin[b * 3 + 2]); ax1 = Math.max(ax1, binMax[b * 3]); ay1 = Math.max(ay1, binMax[b * 3 + 1]); az1 = Math.max(az1, binMax[b * 3 + 2]); }
        const ln = leftN[b - 1]; if (!ln || !cn) continue;
        const cost = .5 * (leftA[b - 1] * ln + area(ax0, ay0, az0, ax1, ay1, az1) * cn) + area(x0, y0, z0, x1, y1, z1) * .125;
        if (cost < bestC) { bestC = cost; best = b; }
      }
      let mid;
      if (best < 0) {   // делить невыгодно — лист, если маленький; иначе пополам по оси
        if (cnt <= 16) { leaf(); continue; }
        const sub = Array.from(order.subarray(s, e)).sort((a, b) => C[a] - C[b]); order.set(sub, s); mid = s + (cnt >> 1);
      } else {
        let i = s, j = e - 1;
        while (i <= j) { let b = ((C[order[i]] - cmin) * kb) | 0; if (b >= NB) b = NB - 1; if (b < best) i++; else { const t = order[i]; order[i] = order[j]; order[j] = t; j--; } }
        mid = i;
        if (mid === s || mid === e) mid = s + (cnt >> 1);
      }
      stack.push([mid, e, id, 0, dep + 1], [s, mid, id, 1, dep + 1]);   // левый (side 1 → a) обработается первым
    }
    return { nodes: nodes.subarray(0, nn * 8), order, count: nn, depth };
  };
  // Обход на JS (проверки): ближайшее попадание луча (o, d) → { t, tri } или null
  E.ptTrace = (bvh, tris, o, d) => {
    const N = bvh.nodes, inv = [1 / d[0], 1 / d[1], 1 / d[2]], st = [0];
    let best = Infinity, bt = -1;
    while (st.length) {
      const id = st.pop(), k = id * 8;
      let t0 = 0, t1 = best;
      for (let a = 0; a < 3; a++) { let ta = (N[k + a] - o[a]) * inv[a], tb = (N[k + 4 + a] - o[a]) * inv[a]; if (ta > tb) { const x = ta; ta = tb; tb = x; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
      if (t0 > t1) continue;
      if (N[k + 7] < 0) {
        for (let i = N[k + 3], e = N[k + 3] - N[k + 7]; i < e; i++) {
          const t = bvh.order[i], q = t * 9;
          const e1 = [tris[q + 3] - tris[q], tris[q + 4] - tris[q + 1], tris[q + 5] - tris[q + 2]], e2 = [tris[q + 6] - tris[q], tris[q + 7] - tris[q + 1], tris[q + 8] - tris[q + 2]];
          const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
          if (Math.abs(det) < 1e-12) continue;
          const id2 = 1 / det, s = [o[0] - tris[q], o[1] - tris[q + 1], o[2] - tris[q + 2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id2;
          if (u < 0 || u > 1) continue;
          const qq = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * qq[0] + d[1] * qq[1] + d[2] * qq[2]) * id2;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2[0] * qq[0] + e2[1] * qq[1] + e2[2] * qq[2]) * id2;
          if (tt > 1e-5 && tt < best) { best = tt; bt = t; }
        }
      } else st.push(N[k + 3], N[k + 7]);
    }
    return bt < 0 ? null : { t: best, tri: bt };
  };

  // ═══ Сцена → треугольники мира ═══
  // материал: тип 0 — PBR (цвет — у вершин), 1 — свет (светящееся), 2 — прозрачное (вода, стекло: преломление)
  function matInfo(m){
    if (!m || m.visible === false) return null;
    if (m.isMeshBasicMaterial) return { type: 1, rough: 1, metal: 0, glow: (m.userData?.bloom ? 2.5 : 1.1) };
    if (m.transparent && (m.opacity ?? 1) < .97) {
      if (m.userData?.water || (m.isMeshStandardMaterial && (m.roughness ?? 1) < .2)) return { type: 2, rough: 0, metal: 0, ior: m.userData?.water ? 1.33 : 1.5 };
      return null;   // дым, частицы, наклейки — без них
    }
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) return null;
    const em = m.emissive ? Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * (m.emissiveIntensity ?? 1) : 0;
    // cut — вырез по альфе текстуры (трава, листья): прозрачное место луч проходит насквозь
    return { type: em > .25 ? 1 : 0, rough: m.isMeshStandardMaterial ? (m.roughness ?? .8) : .9, metal: m.isMeshStandardMaterial ? (m.metalness ?? 0) : 0, glow: em > .25 ? 1.2 : 0, emissive: em > .25 ? m.emissive : null, cut: m.alphaTest > 0 ? 1 : 0 };
  }
  // текстуры: слои массива 256×256 (RGBA8, sRGB), до TL штук — первые по встрече (остальным — средний цвет слоя «нет»)
  const TL = 48, TS = 256;
  function texLayers(){
    const list = [], idx = new Map(), cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (cv) { cv.width = cv.height = TS; }
    const g = cv?.getContext('2d', { willReadFrequently: true });
    const data = new Uint8Array(TS * TS * 4 * TL);
    return {
      list, data,
      layer(t){
        if (!t?.image || !g) return -1;
        if (idx.has(t)) return idx.get(t);
        if (list.length >= TL) { idx.set(t, -1); return -1; }
        try {
          g.clearRect(0, 0, TS, TS); g.drawImage(t.image, 0, 0, TS, TS);
          data.set(g.getImageData(0, 0, TS, TS).data, list.length * TS * TS * 4);
          idx.set(t, list.length); list.push({ t, srgb: t.encoding === 3001 || t.colorSpace === 'srgb', flipY: t.flipY !== false });
          return list.length - 1;
        } catch (e) { idx.set(t, -1); return -1; }   // картинка с чужого сайта (CORS) — без неё
      },
    };
  }
  function extract(R, maxTris = 600000){
    const T = R.T, cam = R.camera, items = [];
    R.scene.updateMatrixWorld(true);
    R.scene.traverseVisible(o => {
      if (!o.isMesh || o.userData?.sky || o.renderOrder >= 900 || !o.geometry?.attributes?.position) return;
      const g = o.geometry, mats = Array.isArray(o.material) ? o.material : [o.material];
      const inst = o.isInstancedMesh ? o.count : 1, all = g.index ? g.index.count : g.attributes.position.count;
      const groups = g.groups?.length ? g.groups : [{ start: 0, count: all, materialIndex: 0 }];
      let tri = 0; for (const gr of groups) if (matInfo(mats[gr.materialIndex ?? 0] || mats[0])) tri += Math.floor(Math.max(0, Math.min(gr.count, all - gr.start)) / 3);
      if (!tri || !inst) return;   // нечего снимать (дым, наклейки) — и в бюджет не считаем
      const p = new T.Vector3(); o.getWorldPosition(p);
      items.push({ o, mats, n: tri * inst, d: p.distanceTo(cam.position) });
    });
    // бюджет треугольников: дальнее выбрасывается первым
    items.sort((a, b) => a.d - b.d);
    let total = 0; const use = [];
    for (const it of items) { if (total + it.n > maxTris) continue; total += it.n; use.push(it); }
    const tris = new Float32Array(total * 9), nrm = new Float32Array(total * 9), col = new Float32Array(total * 9), uvs = new Float32Array(total * 6), mid = new Uint16Array(total);
    const matList = [], matKey = new Map(), TX = texLayers();
    const matId = mi => { const k = JSON.stringify([mi.type, +mi.rough.toFixed(2), +mi.metal.toFixed(2), mi.ior || 0, mi.glow || 0, mi.layer, mi.cut || 0]); if (!matKey.has(k)) { matKey.set(k, matList.length); matList.push(mi); } return matKey.get(k); };
    const v = new T.Vector3(), nv = new T.Vector3(), uvv = new T.Vector3(), M4 = new T.Matrix4(), N3 = new T.Matrix3(), IM = new T.Matrix4(), cc = new T.Color();
    let t = 0;
    for (const { o, mats } of use) {
      const g = o.geometry, P = g.attributes.position, Nn = g.attributes.normal, Cc = g.attributes.color, UV = g.attributes.uv, I = g.index, groups = g.groups?.length ? g.groups : [{ start: 0, count: I ? I.count : P.count, materialIndex: 0 }];
      const inst = o.isInstancedMesh ? o.count : 1;
      for (let ii = 0; ii < inst; ii++) {
        if (o.isInstancedMesh) { o.getMatrixAt(ii, IM); M4.multiplyMatrices(o.matrixWorld, IM); } else M4.copy(o.matrixWorld);
        N3.getNormalMatrix(M4);
        let ic = null; if (o.isInstancedMesh && o.instanceColor) { cc.fromArray(o.instanceColor.array, ii * 3); ic = [cc.r, cc.g, cc.b]; }
        for (const gr of groups) {
          const m = mats[gr.materialIndex ?? 0] || mats[0], mi0 = matInfo(m); if (!mi0) { continue; }
          const layer = m.map && UV ? TX.layer(m.map) : -1, mi = { ...mi0, layer };
          const id = matId(mi), lt = layer >= 0 ? TX.list[layer] : null;
          if (lt) m.map.updateMatrix();
          const base = m.color ? [m.color.r, m.color.g, m.color.b] : [1, 1, 1];
          const useVC = !!(m.vertexColors && Cc);
          const end = Math.min(gr.start + gr.count, I ? I.count : P.count);
          for (let k = gr.start; k + 2 < end; k += 3) {
            if (t >= total) break;
            for (let j = 0; j < 3; j++) {
              const vi = I ? I.getX(k + j) : k + j;
              v.fromBufferAttribute(P, vi).applyMatrix4(M4); tris[t * 9 + j * 3] = v.x; tris[t * 9 + j * 3 + 1] = v.y; tris[t * 9 + j * 3 + 2] = v.z;
              if (Nn) { nv.fromBufferAttribute(Nn, vi).applyMatrix3(N3).normalize(); } else nv.set(0, 0, 0);
              nrm[t * 9 + j * 3] = nv.x; nrm[t * 9 + j * 3 + 1] = nv.y; nrm[t * 9 + j * 3 + 2] = nv.z;
              let r = base[0], gg = base[1], b = base[2];
              if (useVC) { r *= Cc.getX(vi); gg *= Cc.getY(vi); b *= Cc.getZ(vi); }
              if (ic) { r *= ic[0]; gg *= ic[1]; b *= ic[2]; }
              if (mi.type === 1 && mi.emissive) { r = mi.emissive.r; gg = mi.emissive.g; b = mi.emissive.b; }
              col[t * 9 + j * 3] = r; col[t * 9 + j * 3 + 1] = gg; col[t * 9 + j * 3 + 2] = b;
              if (lt) {   // UV с матрицей текстуры; у картинок three переворачивает по v — у слоя верх в начале
                uvv.set(UV.getX(vi), UV.getY(vi), 1).applyMatrix3(m.map.matrix);
                uvs[t * 6 + j * 2] = uvv.x; uvs[t * 6 + j * 2 + 1] = lt.flipY ? 1 - uvv.y : uvv.y;
              }
            }
            // нормали нет — плоская
            if (!Nn) {
              const q = t * 9, ax = tris[q + 3] - tris[q], ay = tris[q + 4] - tris[q + 1], az = tris[q + 5] - tris[q + 2], bx = tris[q + 6] - tris[q], by = tris[q + 7] - tris[q + 1], bz = tris[q + 8] - tris[q + 2];
              let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
              for (let j = 0; j < 3; j++) { nrm[q + j * 3] = nx; nrm[q + j * 3 + 1] = ny; nrm[q + j * 3 + 2] = nz; }
            }
            mid[t] = id; t++;
          }
        }
      }
    }
    return { tris, nrm, col, uvs, mid, n: t, mats: matList, skipped: items.length - use.length, tex: TX };
  }
  E.ptScene = extract;

  // ═══ Данные для видеокарты — ровно в том порядке, как их читает шейдер (scripts/render-test.cjs обходит их так же):
  // узлы — 2 пикселя (min, a | max, b); треугольники — в порядке листьев BVH (лист [s, s + n) — прямо номера), по 8 пикселей:
  // v0, v1, v2 (w — цвет вершины: 3 байта в одном float, до 2^24 — без потерь), n0 (w — материал), n1, n2, (uv0, uv1), (uv2, –);
  // материалы — 2 пикселя: (тип, шероховатость, металл, свет), (ior, слой текстуры, sRGB, вырез по альфе) ═══
  const pk = (r, g, b) => Math.round(Math.min(1, Math.max(0, r)) * 255) + Math.round(Math.min(1, Math.max(0, g)) * 255) * 256 + Math.round(Math.min(1, Math.max(0, b)) * 255) * 65536;
  E.ptPack = (sc, bvh) => {
    const nodes = new Float32Array(bvh.count * 8); nodes.set(bvh.nodes.subarray(0, bvh.count * 8));
    const tri = new Float32Array(sc.n * 32);
    for (let i = 0; i < sc.n; i++) {
      const q = i * 32, src = bvh.order[i], s = src * 9, u = src * 6;
      for (let j = 0; j < 3; j++) {
        tri[q + j * 4] = sc.tris[s + j * 3]; tri[q + j * 4 + 1] = sc.tris[s + j * 3 + 1]; tri[q + j * 4 + 2] = sc.tris[s + j * 3 + 2];
        tri[q + j * 4 + 3] = pk(sc.col[s + j * 3], sc.col[s + j * 3 + 1], sc.col[s + j * 3 + 2]);
        tri[q + 12 + j * 4] = sc.nrm[s + j * 3]; tri[q + 12 + j * 4 + 1] = sc.nrm[s + j * 3 + 1]; tri[q + 12 + j * 4 + 2] = sc.nrm[s + j * 3 + 2];
      }
      tri[q + 15] = sc.mid[src];
      for (let k = 0; k < 6; k++) tri[q + 24 + k] = sc.uvs[u + k];
    }
    const mats = new Float32Array(Math.max(1, sc.mats.length) * 8);
    sc.mats.forEach((m, i) => { const lay = m.layer ?? -1; mats.set([m.type, m.rough, m.metal, m.glow || 0, m.ior || 1.5, lay, lay >= 0 && sc.tex?.list[lay]?.srgb ? 1 : 0, m.cut && lay >= 0 ? 1 : 0], i * 8); });
    return { nodes, tri, mats };
  };

  // ═══ Шейдер трассировки ═══
  const VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const FS_PT = `precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DArray;
uniform sampler2D tNodes; uniform sampler2D tTri; uniform sampler2D tMat; uniform sampler2D tPrev; uniform sampler2DArray tLayers;
uniform mat4 uCamWorld; uniform mat4 uProjInv; uniform vec2 uRes; uniform float uFrame; uniform int uBounces;
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunCos; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGnd; uniform vec3 uSunDisc;
varying vec2 vUv;
const int TW = ${TW};
// чтение по номеру — у каждой текстуры своя функция: сэмплер параметром функции во вложенном вызове (fMat(int(fTri(…))))
// ANGLE (Direct3D) путает — читалась не та текстура, и вырез травы не срабатывал
ivec2 ix(int i){ return ivec2(i % TW, i / TW); }
vec4 fTri(int i){ return texelFetch(tTri, ix(i), 0); }
vec4 fMat(int i){ return texelFetch(tMat, ix(i), 0); }
vec4 fNode(int i){ return texelFetch(tNodes, ix(i), 0); }
uint sd;
float rnd(){ sd = sd * 747796405u + 2891336453u; uint w = ((sd >> ((sd >> 28u) + 4u)) ^ sd) * 277803737u; return float((w >> 22u) ^ w) / 4294967295.0; }
vec3 unpackC(float f){ return vec3(mod(f, 256.0), mod(floor(f / 256.0), 256.0), floor(f / 65536.0)) / 255.0; }
// небо: как у движка (горизонт → зенит, земля под горизонтом)
vec3 sky(vec3 d){
  float h = d.y;
  vec3 c = h >= 0.0 ? mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.6)) : mix(uHor, uGnd, smoothstep(0.0, 0.25, -h));
  return c;
}
bool hitTri(vec3 o, vec3 d, int t, inout float best, inout vec2 bc){   // inout: при «мимо» bc не портится
  vec3 a = fTri(t * 8).xyz, b = fTri(t * 8 + 1).xyz, c = fTri(t * 8 + 2).xyz;
  vec3 e1 = b - a, e2 = c - a, p = cross(d, e2); float det = dot(e1, p);
  if (abs(det) < 1e-10) return false;
  float id = 1.0 / det; vec3 s = o - a; float u = dot(s, p) * id;
  if (u < 0.0 || u > 1.0) return false;
  vec3 q = cross(s, e1); float v = dot(d, q) * id;
  if (v < 0.0 || u + v > 1.0) return false;
  float t2 = dot(e2, q) * id;
  if (t2 > 1e-4 && t2 < best) {
    int mi = int(fTri(t * 8 + 3).w); vec4 mm = fMat(mi * 2 + 1);
    if (mm.w > 0.5) {   // вырез по альфе: прозрачное место текстуры — мимо
      vec4 ua = fTri(t * 8 + 6), ub = fTri(t * 8 + 7);
      if (textureLod(tLayers, vec3(fract(ua.xy * (1.0 - u - v) + ua.zw * u + ub.xy * v), mm.y), 0.0).a < 0.5) return false;
    }
    best = t2; bc = vec2(u, v); return true;
  }
  return false;
}
// ближайшее попадание (shadow — любое до tMax)
int trace(vec3 o, vec3 d, inout float best, inout vec2 bc, bool shadow){
  vec3 inv = 1.0 / d; int st[40]; int sp = 0; st[sp++] = 0; int hit = -1;
  for (int it = 0; it < 4096; it++) {
    if (sp == 0) break;
    int n = st[--sp];
    vec4 a = fNode(n * 2), b = fNode(n * 2 + 1);
    vec3 t0 = (a.xyz - o) * inv, t1 = (b.xyz - o) * inv, tn = min(t0, t1), tf = max(t0, t1);
    float ne = max(max(tn.x, tn.y), max(tn.z, 0.0)), fa = min(min(tf.x, tf.y), min(tf.z, best));
    if (ne > fa) continue;
    if (b.w < 0.0) {
      int s = int(a.w), e = s - int(b.w);
      for (int i = s; i < e; i++) if (hitTri(o, d, i, best, bc)) { hit = i; if (shadow) return hit; }
    } else if (sp < 38) { st[sp++] = int(b.w); st[sp++] = int(a.w); }
  }
  return hit;
}
vec3 cosDir(vec3 n){
  float r1 = rnd(), r2 = rnd(), ph = 6.2831853 * r1, sr = sqrt(r2);
  vec3 t = normalize(abs(n.y) < 0.99 ? cross(n, vec3(0.0, 1.0, 0.0)) : cross(n, vec3(1.0, 0.0, 0.0))), bt = cross(n, t);
  return normalize(t * cos(ph) * sr + bt * sin(ph) * sr + n * sqrt(1.0 - r2));
}
vec3 sunSample(){   // точка на диске солнца
  vec3 d = uSunDir, t = normalize(abs(d.y) < 0.99 ? cross(d, vec3(0.0, 1.0, 0.0)) : cross(d, vec3(1.0, 0.0, 0.0))), b = cross(d, t);
  float r = sqrt(rnd()) * sqrt(max(1.0 - uSunCos * uSunCos, 0.0)), a = 6.2831853 * rnd();
  return normalize(d + t * r * cos(a) + b * r * sin(a));
}
void main(){
  ivec2 px = ivec2(gl_FragCoord.xy);
  sd = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uFrame) * 26699u | 1u;
  vec2 jit = vec2(rnd(), rnd());
  vec2 ndc = (vec2(px) + jit) / uRes * 2.0 - 1.0;
  vec4 vp = uProjInv * vec4(ndc, 1.0, 1.0); vec3 dv = normalize(vp.xyz / vp.w);
  vec3 ro = (uCamWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz, rd = normalize((uCamWorld * vec4(dv, 0.0)).xyz);
  vec3 L = vec3(0.0), thr = vec3(1.0); bool spec = true;
  for (int bnc = 0; bnc < 8; bnc++) {
    if (bnc > uBounces) break;
    float best = 1e20; vec2 bc;
    int tri = trace(ro, rd, best, bc, false);
    if (tri < 0) { L += thr * (sky(rd) + (spec && dot(rd, uSunDir) > uSunCos ? uSunDisc : vec3(0.0))); break; }
    vec4 n0 = fTri(tri * 8 + 3), n1 = fTri(tri * 8 + 4), n2 = fTri(tri * 8 + 5);
    vec4 v0 = fTri(tri * 8), v1 = fTri(tri * 8 + 1), v2 = fTri(tri * 8 + 2);
    float w0 = 1.0 - bc.x - bc.y;
    vec3 gn = normalize(cross(v1.xyz - v0.xyz, v2.xyz - v0.xyz));
    vec3 nn = n0.xyz * w0 + n1.xyz * bc.x + n2.xyz * bc.y; vec3 n = dot(nn, nn) > 1e-8 ? normalize(nn) : gn;
    vec3 alb = unpackC(v0.w) * w0 + unpackC(v1.w) * bc.x + unpackC(v2.w) * bc.y;
    vec4 m0 = fMat(int(n0.w) * 2), m1 = fMat(int(n0.w) * 2 + 1);   // m0: тип, шероховатость, металл, свет; m1: ior, слой текстуры, sRGB
    if (m1.y >= 0.0) {   // текстура: UV вершин → слой массива (повтор), цвет из sRGB в линейный
      vec4 ua = fTri(tri * 8 + 6), ub = fTri(tri * 8 + 7);
      vec2 uv = ua.xy * w0 + ua.zw * bc.x + ub.xy * bc.y;
      vec3 tc = textureLod(tLayers, vec3(fract(uv), m1.y), 0.0).rgb;
      alb *= m1.z > 0.5 ? pow(tc, vec3(2.2)) : tc;
    }
    vec3 p = ro + rd * best;
    bool front = dot(rd, gn) < 0.0; if (!front) { gn = -gn; } if (dot(n, gn) < 0.0) n = gn;
    if (m0.x > 0.5 && m0.x < 1.5) { L += thr * alb * m0.w; break; }   // светится
    if (m0.x > 1.5) {   // вода, стекло: отразить или преломить (Шлик), цвет — лёгкий оттенок
      float eta = front ? 1.0 / m1.x : m1.x, ci = -dot(rd, gn), f0 = pow((1.0 - m1.x) / (1.0 + m1.x), 2.0);
      float F = f0 + (1.0 - f0) * pow(1.0 - ci, 5.0);
      vec3 rf = refract(rd, gn, eta);
      if (rnd() < F || dot(rf, rf) < 1e-6) { rd = reflect(rd, gn); ro = p + gn * 1e-3; }
      else { rd = normalize(rf); ro = p - gn * 1e-3; thr *= mix(vec3(1.0), alb, 0.35); }
      spec = true; continue;
    }
    // PBR: доля зеркального — по металлу и Френелю; диффузное — косинус; солнце — прямым лучом тени
    float rough = clamp(m0.y, 0.04, 1.0), metal = m0.z, ci = max(dot(-rd, n), 0.0);
    float F = mix(0.04, 1.0, metal) + (1.0 - mix(0.04, 1.0, metal)) * pow(1.0 - ci, 5.0) * (1.0 - rough);
    float ps = clamp(mix(F, 1.0, metal) * (1.0 - rough * 0.7), 0.0, 0.95);
    vec3 dif = alb * (1.0 - metal);
    // прямое солнце (только диффузной части)
    vec3 sdir = sunSample(); float nl = dot(n, sdir);
    if (nl > 0.0 && dot(dif, dif) > 0.0) { float b2 = 1e20; vec2 bb; if (trace(p + gn * 2e-3, sdir, b2, bb, true) < 0) L += thr * dif * (1.0 - ps) * uSunCol * nl; }
    if (rnd() < ps) {   // зеркальное: отражение с разбросом по шероховатости
      vec3 r = reflect(rd, n); rd = normalize(mix(r, cosDir(n), rough * rough));
      if (dot(rd, gn) <= 0.0) break;
      thr *= mix(vec3(1.0), alb, metal); spec = rough < 0.3;
    } else {
      rd = cosDir(n); thr *= dif; spec = false;
    }
    ro = p + gn * 2e-3;
    if (bnc >= 2) { float q = max(max(thr.r, thr.g), thr.b); if (rnd() > q) break; thr /= max(q, 1e-3); }
  }
  vec3 prev = texelFetch(tPrev, px, 0).rgb;
  L = min(L, vec3(30.0));   // светлячки (редкие яркие пути) — не выжигают картинку
  gl_FragColor = vec4(mix(prev, L, 1.0 / uFrame), 1.0);
}`;
  // показ: ACES (как three) с экспозицией движка, sRGB
  const FS_SHOW = `uniform sampler2D tAcc; uniform float uExp; varying vec2 vUv;
vec3 aces(vec3 c){ c *= uExp / 0.6;
  mat3 i = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  mat3 o = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  c = i * c; vec3 a = c * (c + 0.0245786) - 0.000090537, b = c * (0.983729 * c + 0.4329510) + 0.238081; return clamp(o * (a / b), 0.0, 1.0); }
void main(){ vec3 c = aces(texture2D(tAcc, vUv).rgb); c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); gl_FragColor = vec4(c, 1.0); }`;
  E.ptShaders = { fs: FS_PT, show: FS_SHOW, TW };

  // ═══ Окно «📸 Фото» ═══
  E.pathPhoto = (R, o = {}) => {
    const T = R.T, r = R.r, gl2 = r.capabilities.isWebGL2;
    const fl = gl2 && r.extensions.has('EXT_color_buffer_float');
    if (!gl2) { alert?.('Фото с трассировкой пути — только в браузерах с WebGL2.'); return null; }
    if (E.pathPhoto.cur) E.pathPhoto.cur.close();
    // окно
    const box = document.createElement('div');
    box.className = 'd37-pt';
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483100;pointer-events:none;font:14px/1.35 system-ui,sans-serif;color:#fff';
    box.innerHTML = `<div style="pointer-events:auto;position:absolute;left:50%;top:10px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;background:rgba(10,12,22,.82);padding:8px 12px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.45);max-width:calc(100% - 20px);flex-wrap:wrap">
      <b>📸 Фото с трассировкой пути</b><span data-pt="st" style="opacity:.85">готовим сцену…</span>
      <button type="button" data-pt="save" disabled style="border:0;border-radius:8px;padding:6px 10px;background:#22c55e;color:#04210f;font-weight:800;cursor:pointer">💾 Сохранить</button>
      <button type="button" data-pt="close" style="border:0;border-radius:8px;padding:6px 10px;background:#374151;color:#fff;cursor:pointer">✕ Закрыть</button></div>`;
    document.body.appendChild(box);
    const stEl = box.querySelector('[data-pt="st"]'), saveB = box.querySelector('[data-pt="save"]');
    const C = { R, frames: 0, t0: 0, closed: false };
    E.pathPhoto.cur = C;
    let data = null, rtA = null, rtB = null, M = null, M2 = null, quad = null, pscene = null, pcam = null;
    const cleanup = () => {
      for (const x of [rtA, rtB, M, M2, quad?.geometry]) x?.dispose?.();
      M = M2 = null;
      if (data) for (const t of Object.values(data.tex)) t.dispose();
      R.photo = null;
    };
    C.close = () => { if (C.closed) return; C.closed = true; box.remove(); cleanup(); if (E.pathPhoto.cur === C) E.pathPhoto.cur = null; };
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-pt]'); if (!b) return;
      if (b.dataset.pt === 'close') C.close();
      else if (b.dataset.pt === 'save') {
        show(); const url = r.domElement.toDataURL('image/png');   // сразу после кадра — холст ещё не очищен
        const a = document.createElement('a'); a.href = url; a.download = `denchik-foto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; document.body.appendChild(a); a.click(); a.remove();
      }
    });
    const onKey = e => { if (e.key === 'Escape' && !C.closed) { e.stopImmediatePropagation(); C.close(); } };
    root.addEventListener('keydown', onKey, true);
    const close0 = C.close; C.close = () => { root.removeEventListener('keydown', onKey, true); close0(); };
    // сборка — через кадр (окно успело показаться)
    setTimeout(() => {
      if (C.closed) return;
      try {
        const t0 = performance.now();
        const sc = extract(R, o.maxTris || 900000);
        if (!sc.n) { stEl.textContent = 'в кадре нечего снимать'; return; }
        const bvh = E.ptBuild(sc.tris, sc.n), pd = E.ptPack(sc, bvh);
        const W = TW, mk = (arr, n) => { const h = Math.max(1, Math.ceil(n / W)), d = new Float32Array(W * h * 4); d.set(arr.subarray(0, Math.min(arr.length, d.length))); const t = new T.DataTexture(d, W, h, T.RGBAFormat, T.FloatType); t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
        // слои текстур (не меньше одного — у пустого массива шейдер не соберётся)
        const nl = Math.max(1, sc.tex.list.length), arr = new T.DataArrayTexture(sc.tex.data.subarray(0, TS * TS * 4 * nl), TS, TS, nl);
        arr.minFilter = arr.magFilter = T.LinearFilter; arr.wrapS = arr.wrapT = T.RepeatWrapping; arr.generateMipmaps = false; arr.needsUpdate = true;
        data = { tex: { nodes: mk(pd.nodes, bvh.count * 2), tri: mk(pd.tri, sc.n * 8), mat: mk(pd.mats, Math.max(1, sc.mats.length) * 2), layers: arr }, n: sc.n, nodes: bvh.count };
        C.build = { tris: sc.n, nodes: bvh.count, depth: bvh.depth, ms:Math.round(performance.now() - t0), skipped: sc.skipped, mats: sc.mats.length, layers: sc.tex.list.length, cut: sc.mats.filter(m => m.cut && m.layer >= 0).length };
        // буферы накопления
        const w = r.domElement.width, h = r.domElement.height, opt = { type: fl ? T.FloatType : T.HalfFloatType, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter };
        rtA = new T.WebGLRenderTarget(w, h, opt); rtB = new T.WebGLRenderTarget(w, h, opt);
        const sky = R.sky || E.skyModel(14), sun = R.sun;
        const sunDir = new T.Vector3(sky.lightDir[0], sky.lightDir[1], sky.lightDir[2]).normalize();
        const sunI = (sun ? sun.intensity : 2.6) * (sky.night > .5 ? .6 : 1);
        M = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS_PT, depthTest: false, depthWrite: false, glslVersion: null,
          uniforms: { tNodes: { value: data.tex.nodes }, tTri: { value: data.tex.tri }, tMat: { value: data.tex.mat }, tPrev: { value: null }, tLayers: { value: data.tex.layers },
            uCamWorld: { value: R.camera.matrixWorld.clone() }, uProjInv: { value: R.camera.projectionMatrixInverse.clone() }, uRes: { value: new T.Vector2(w, h) }, uFrame: { value: 1 }, uBounces: { value: o.bounces ?? 4 },
            uSunDir: { value: sunDir }, uSunCol: { value: new T.Vector3(sky.light[0], sky.light[1], sky.light[2]).multiplyScalar(sunI) }, uSunCos: { value: Math.cos(.012) },
            uZen: { value: new T.Vector3(...sky.zen) }, uHor: { value: new T.Vector3(...sky.hor) }, uGnd: { value: new T.Vector3(...sky.gnd) }, uSunDisc: { value: new T.Vector3(...sky.sunC) } } });
        M2 = new T.ShaderMaterial({ vertexShader: VS, fragmentShader: FS_SHOW, depthTest: false, depthWrite: false, uniforms: { tAcc: { value: null }, uExp: { value: (r.toneMappingExposure || 1) } } });
        const tg = new T.BufferGeometry();
        tg.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        tg.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
        quad = new T.Mesh(tg, M); quad.frustumCulled = false; pscene = new T.Scene(); pscene.add(quad); pcam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        C.t0 = performance.now(); saveB.disabled = false;
        R.photo = step;   // render.js: пока фото открыто — кадр рисует трассировщик
      } catch (e) { console.error(e); stEl.textContent = 'не получилось: ' + (e.message || e); }
    }, 60);
    function show(){ quad.material = M2; M2.uniforms.tAcc.value = rtA.texture; r.setRenderTarget(null); r.render(pscene, pcam); }
    // кадр: 1…8 лучей на пиксель — по тому, как быстро идут кадры (слабым видеокартам не даём зависнуть), показать среднее
    let spf = 1, lastT = 0;
    function step(){
      if (C.closed || !M) return;
      const now = performance.now(), iv = lastT ? now - lastT : 16; lastT = now;
      if (iv < 20) spf = Math.min(8, spf + 1); else if (iv > 34) spf = Math.max(1, spf - 1);
      quad.material = M;
      for (let k = 0; k < spf; k++) {
        C.frames++;
        M.uniforms.uFrame.value = C.frames; M.uniforms.tPrev.value = rtA.texture;
        r.setRenderTarget(rtB); r.render(pscene, pcam);
        const t = rtA; rtA = rtB; rtB = t;
      }
      show();
      if (C.frames % 4 < spf) { const s = (performance.now() - C.t0) / 1000; stEl.textContent =`${C.frames} лучей на пиксель · ${s.toFixed(1)} с · ${data.n.toLocaleString('ru-RU')} треугольников${C.build?.skipped ? ` (дальние ${C.build.skipped} предметов — без них)` : ''}`; }
    }
    C.step = step;
    return C;
  };
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — склейка сцены (как static batching + GPU instancing в Unity): закреплённые, редко меняющиеся детали
//  и предметы сливаются по материалу внутри участков мира (чанков) — один вызов отрисовки на материал в чанке, отсечение
//  по видимости работает по чанкам; повторяющиеся сетки (шары, цилиндры, деревья, фонари, модели) рисуются экземплярами;
//  то, что двигается или меняется, само выходит из склейки и рисуется отдельно
// ═══════════════════════════════════════
// B = D37E.batcher(SC, { chunk, delay }) — после D37E.scene; сам встаёт в R.preRender (перед каждым кадром), SC.batch = B.
// B.edit() — редактор: правишь объект → он сразу рисуется отдельно (из пачки вынимается мгновенно, без пересборки), чанк
// пересобирается через delay мс (400) после последней правки. B.play() — игра: сразу всё склеено; незакреплённые и всё,
// что поменялось во время игры (твины, скрипты Heartbeat, смена цвета), — отдельно до «Стоп»; созданное скриптом
// склеивается, если 2 с не менялось. Выбор мышью (SC.pick), рамка, стрелки, свойства — по исходным мешам: склеенные
// вынуты из сцены, но их матрицы свежие, поэтому луч их находит как раньше. Свет (класс Light): THREE.PointLight уходит
// в R.lights (постоянный набор ламп render.js), лампочка редактора и неон светятся (R.bloom).
// Склеиваются: Part (кроме полупрозрачных), Prefab и всё, у чего root.userData.batchable = true (например, загруженная
// модель — когда она готова, позвать B.refresh(obj)). Spawn, Light, Model, Script — как раньше.
// B.flush() — склеить всё сейчас; B.setEnabled(false) — всё отдельно (для сравнения); B.stats(); B.dispose().
// Чанк: CH × CH м по x/z; огромные объекты — в общий чанк «big». Группа = (материал без цвета, тени, renderOrder);
// цвет — в цвете вершины (склейка) или экземпляра. Шары/цилиндры деталей и повторяющиеся сетки > 48 вершин — экземплярами
// (единичная форма + матрица; UV «по метрам» для текстур считает шейдер), остальное — одной склеенной сеткой.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};

  E.batcher = function (SC, o = {}){
    const R = SC.R, T = R.T, scene = R.scene;
    const now = o.now || (() => performance.now());
    const CH = o.chunk || 48, BIG = CH * .75, SETTLE = 2000, COMPACT = 1500, INST_MIN_V = 48;
    const B = { on: true, mode: 'edit', chunk: CH, delay: o.delay ?? 400, budget: o.budget ?? 4, rebuilds: 0, lastMs: 0, maxMs: 0 };
    const recs = new Map(), chunks = new Map(), bmats = new Map(), lights = new Map(), units = {};
    const hot = new Set(), pending = new Set(), dirty = new Set();
    const OBC0 = T.Material.prototype.onBeforeCompile;
    const _v = new T.Vector3(), _c = new T.Vector3(), _box = new T.Box3(), _sph = new T.Sphere(), _n3 = new T.Matrix3(), _m4 = new T.Matrix4();
    SC.batch = B;

    // ═══ Материалы склейки: копия без цвета (цвет — в вершинах/экземплярах), метка свечения и UV «по метрам» ═══
    const usesUV = m => !!(m.map || m.normalMap || m.bumpMap || m.roughnessMap || m.metalnessMap || m.alphaMap || m.emissiveMap || m.specularMap);
    const okMat = m => !!m && !Array.isArray(m) && m.isMaterial && m.visible !== false && !m.transparent && !m.vertexColors && !m.wireframe
      && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial || m.isMeshPhongMaterial) && !!m.color
      && !m.aoMap && !m.lightMap && !m.displacementMap && !m.clippingPlanes && (m.onBeforeCompile === OBC0 || m.onBeforeCompile === R.bloomPatch);
    const uid = t => t ? t.uuid : '';
    function matKey(m){
      if (m._bk && m._bkv === m.version) return m._bk;
      const p = [m.type, m.side, m.flatShading ? 1 : 0, m.fog ? 1 : 0, m.toneMapped ? 1 : 0, m.depthTest ? 1 : 0, m.depthWrite ? 1 : 0, m.alphaTest, m.colorWrite ? 1 : 0,
        uid(m.map), uid(m.alphaMap), m.userData?.bloom || 0, m.userData?.tile || 0, m.polygonOffset ? m.polygonOffsetFactor + ',' + m.polygonOffsetUnits : ''];
      if (m.isMeshStandardMaterial) p.push(m.roughness, m.metalness, m.envMapIntensity, uid(m.envMap), uid(m.normalMap), m.normalMap ? m.normalScale.x + ',' + m.normalScale.y : '', uid(m.roughnessMap), uid(m.metalnessMap), m.isMeshPhysicalMaterial ? 'ph' : '');
      if (m.emissive) p.push(m.emissive.getHexString(), m.emissiveIntensity, uid(m.emissiveMap));
      if (m.isMeshPhongMaterial) p.push(m.shininess, m.specular.getHexString(), uid(m.specularMap));
      if (m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) p.push(uid(m.envMap), m.reflectivity, m.combine);
      m._bk = p.join('|'); m._bkv = m.version;
      return m._bk;
    }
    // Шейдер склейки: свечение (альфа буфера, см. render.js R.bloom) и UV деталей-экземпляров по их размеру (как в scene.js)
    function batchPatch(sh){
      const u = this.userData;
      if (u.bloom) {
        sh.uniforms.uBloom = { value: u.bloom };
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBloom;')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n#ifdef OPAQUE\ngl_FragColor.a = 1.0 + uBloom;\n#endif');
      }
      if (u.uvTile) {
        sh.uniforms.uTile = { value: u.uvTile };
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTile;').replace('#include <uv_vertex>', `#ifdef USE_UV
#ifdef USE_INSTANCING
vec3 bS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
vec3 bP = position * bS, bN = normal / max(bS, vec3(1e-6)), bA = abs(bN);
vec2 bU = bA.y >= bA.x && bA.y >= bA.z ? vec2(bP.x, bN.y > 0.0 ? -bP.z : bP.z) : bA.x >= bA.z ? vec2(bN.x > 0.0 ? -bP.z : bP.z, bP.y) : vec2(bN.z > 0.0 ? bP.x : -bP.x, bP.y);
vUv = ( uvTransform * vec3( bU / uTile, 1.0 ) ).xy;
#else
vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
#endif
#endif`);
      }
    }
    // kind: 'm' — склейка (цвет вершин), 'i' — экземпляры, 'u' — экземпляры-детали с UV по размеру
    function bmat(base, kind){
      const k = matKey(base) + '#' + kind;
      let m = bmats.get(k);
      if (m) return m;
      m = base.clone();
      m.color.setRGB(1, 1, 1);
      m.vertexColors = kind === 'm';
      const bloom = base.userData?.bloom || 0, uvTile = kind === 'u' ? base.userData?.tile || 0 : 0;
      m.userData = { tile: base.userData?.tile || 0, bloom, uvTile, batch: 1 };
      if (bloom || uvTile) { const key = 'd37b' + (bloom ? 'g' : '') + (uvTile ? 'u' : ''); m.onBeforeCompile = batchPatch; m.customProgramCacheKey = () => key; }
      bmats.set(k, m);
      return m;
    }
    // единичные формы деталей для экземпляров (те же, что в scene.js: шар 28×18, цилиндр 28)
    function unitGeo(shape){
      if (units[shape]) return units[shape];
      const g = shape === 'ball' ? new T.SphereGeometry(.5, 28, 18) : new T.CylinderGeometry(.5, .5, 1, 28);
      g.computeBoundingSphere();
      return (units[shape] = g);
    }
    const UNIT_SHAPES = { ball: 1, cyl: 1 };

    // ═══ Учёт объектов сцены ═══
    const set0 = SC.set;
    SC.set = (obj, key, val, silent) => { const r = set0(obj, key, val, silent); if (obj) changed(obj, key); return r; };
    const offs = [SC.on('add', obj => track(obj)), SC.on('remove', obj => untrack(obj))];
    const classOk = rec => rec.obj.cls === 'Part' || rec.obj.cls === 'Prefab' || rec.root.userData.batchable === true;
    const canBatch = rec => B.on && rec.root && rec.root.visible !== false && rec.state !== 'gone' && classOk(rec)
      && !(B.mode === 'play' && rec.obj.cls === 'Part' && rec.obj.anchored === false);
    function track(obj){
      if (obj.cls === 'Light') { adoptLight(obj); return; }
      if (!obj._mesh) return;
      let rec = recs.get(obj.id);
      if (rec) { if (rec.root === obj._mesh) return; retire(rec); }
      rec = { id: obj.id, obj, root: obj._mesh, parent0: obj._mesh.parent || scene, state: 'single', chunk: null, slots: [], loose: null, looseSrc: null, hotUntil: 0, settleAt: 0 };
      recs.set(obj.id, rec);
      if (obj.cls === 'Part' && obj.mat === 'neon' && R.bloom) markNeon(rec.root);
      watchVisible(rec);
      if (!B.on || !classOk(rec)) return;
      rec.settleAt = B.mode === 'play' ? now() + SETTLE : 0;
      rec.state = 'pending'; pending.add(rec);
    }
    function markNeon(m){ const mat = m.material; if (mat && !mat.transparent && !mat.userData.bloom) R.bloom(mat, 1); }
    function untrack(obj){
      if (obj.cls === 'Light') { dropLight(obj.id); return; }
      const rec = recs.get(obj.id); if (!rec) return;
      retire(rec); recs.delete(obj.id);
    }
    // объект удалён или пересобран: вынуть из пачки (в сцену не возвращать — меш уже не нужен)
    function retire(rec){
      if (rec.state === 'batched') collapse(rec);
      removeLoose(rec);
      pending.delete(rec); hot.delete(rec);
      leaveChunk(rec, now() + B.delay);
      unwatchVisible(rec);
      rec.state = 'gone';
    }
    function leaveChunk(rec, due){ const ch = rec.chunk; if (!ch) return; ch.recs.delete(rec); rec.chunk = null; markDirty(ch, due); }
    function changed(obj, key){
      if (obj.cls === 'Light') { const l = lights.get(obj.id); if (!l || l.L !== obj._light) adoptLight(obj); return; }
      let rec = recs.get(obj.id);
      if (!rec) { if (obj._mesh && objectsHas(obj)) { track(obj); rec = recs.get(obj.id); if (rec) heat(rec); } return; }
      if (rec.root !== obj._mesh) {   // пересобран (цвет, размер, материал…): новый меш уже в сцене
        retire(rec); recs.delete(obj.id);
        if (!obj._mesh) return;
        track(obj); rec = recs.get(obj.id);
        if (rec) heat(rec);
        return;
      }
      if (key === 'anchored') { if (B.mode === 'play' && obj.anchored === false) makeDyn(rec); return; }
      if (key !== 'pos' && key !== 'rot' && key !== 'visible' && key !== 'refresh') return;
      heat(rec);
    }
    const objectsHas = obj => SC.get(obj.id) === obj;
    // правят сейчас: рисовать отдельно, в пачку — когда утихнет (в игре — отдельно до «Стоп»)
    function heat(rec){
      if (B.mode === 'play') { makeDyn(rec); return; }
      toSingle(rec, now() + B.delay);
      if (!classOk(rec)) return;
      rec.hotUntil = now() + B.delay; hot.add(rec);
    }
    function makeDyn(rec){ toSingle(rec, now() + COMPACT); rec.state = 'dyn'; R.shadowDirty?.(true); }
    function toSingle(rec, due){
      if (rec.state === 'batched') { collapse(rec); attach(rec); }
      removeLoose(rec);
      pending.delete(rec); hot.delete(rec);
      leaveChunk(rec, due);
      rec.state = 'single';
    }
    function toPending(rec){
      if (rec.state === 'gone' || rec.state === 'batched' || !classOk(rec)) return;
      hot.delete(rec); rec.state = 'pending'; rec.settleAt = 0; pending.add(rec);
    }
    // видимость исходного меша (studio3d прячет детали прямо через _mesh.visible) — пачка узнаёт сразу
    function watchVisible(rec){
      const r = rec.root; let v = r.visible !== false;
      Object.defineProperty(r, 'visible', { configurable: true, enumerable: true, get: () => v, set: x => { x = !!x; if (x === v) return; v = x; if (rec.state !== 'gone') changed(rec.obj, 'visible'); } });
    }
    function unwatchVisible(rec){ const r = rec.root, v = r.visible; delete r.visible; r.visible = v; }

    // ═══ Чанки ═══
    function boundsOf(rec){
      const o = rec.obj;
      if (o.cls === 'Part' && Array.isArray(o.pos) && Array.isArray(o.size)) { _c.set(o.pos[0], o.pos[1], o.pos[2]); return Math.hypot(o.size[0], o.size[1], o.size[2]) / 2; }
      _box.setFromObject(rec.root);
      if (_box.isEmpty()) { _c.copy(rec.root.position); return 0; }
      _box.getCenter(_c);
      return _box.getSize(_v).length() / 2;
    }
    function chunkFor(rec){
      const rad = boundsOf(rec), big = rad > BIG, cx = big ? 0 : Math.floor(_c.x / CH), cz = big ? 0 : Math.floor(_c.z / CH), key = big ? 'big' : cx + ',' + cz;
      let ch = chunks.get(key);
      if (!ch) { ch = { key, cx: big ? 0 : (cx + .5) * CH, cz: big ? 0 : (cz + .5) * CH, recs: new Set(), groups: [], dirty: false, due: 0 }; chunks.set(key, ch); }
      return ch;
    }
    function markDirty(ch, due){ if (!ch.dirty || due < ch.due) ch.due = due; ch.dirty = true; dirty.add(ch); }
    function attach(rec){ const r = rec.root; if (!r.parent) (rec.parent0 || scene).add(r); }
    // вынуть корни из сцены разом (scene.remove по одному — O(N²) на тысячах деталей)
    function detachAll(list){
      if (!list.length) return;
      const byParent = new Map();
      for (const rec of list) { const r = rec.root, p = r.parent; if (!p) continue; let s = byParent.get(p); if (!s) byParent.set(p, (s = new Set())); s.add(r); r.parent = null; }
      for (const [p, s] of byParent) p.children = p.children.filter(c => !s.has(c));
      for (const rec of list) rec.root.updateMatrixWorld(true);   // луч (SC.pick) и рамка берут матрицы вынутого меша
    }

    // ═══ Сборка чанка ═══
    const isRenderable = x => x.isMesh || x.isSprite || x.isPoints || x.isLine;
    // всё, что рисует объект: склеиваемые меши → items, прочее (спрайты, прозрачное) → loose (копии рядом с пачкой)
    function collect(rec, items){
      const r = rec.root, obj = rec.obj, unitPart = obj.cls === 'Part' && UNIT_SHAPES[obj.shape] && r.isMesh;
      r.updateMatrixWorld(true);
      let n = 0;
      const loose = [];
      r.traverseVisible(m => {
        if (!isRenderable(m)) return;
        const mat = m.material, g = m.geometry;
        if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && okMat(mat) && g?.attributes?.position && !g.morphAttributes?.position && m.matrixWorld.determinant() > 0) {
          if (!g.boundingSphere) g.computeBoundingSphere();
          items.push({ rec, m, g, mat, key: matKey(mat), unit: unitPart && m === r ? obj.shape : '', size: obj.size });
          n++;
        } else loose.push(m);
      });
      rec.looseSrc = loose;
      return n > 0;   // нечего склеивать (стекло, лёд…) — пусть рисуется как есть
    }
    function disposeGroup(g){
      g.dead = true;
      if (g.mesh.parent) g.mesh.parent.remove(g.mesh);
      if (g.kind === 'inst') { const w = g.mesh.geometry; w.index = null; w.attributes = {}; w.dispose(); g.mesh.dispose(); }
      else g.mesh.geometry.dispose();
    }
    function rebuild(ch){
      const t0 = performance.now(), items = [], newly = [];
      for (const rec of ch.recs) {
        if ((rec.state !== 'batched' && rec.state !== 'pending') || !canBatch(rec) || !collect(rec, items)) {
          ch.recs.delete(rec); rec.chunk = null;
          if (rec.state === 'batched') { collapse(rec); attach(rec); }
          if (rec.state !== 'gone' && rec.state !== 'dyn') rec.state = 'single';
          continue;
        }
        rec.slots.length = 0;
        if (rec.state === 'pending') newly.push(rec);
      }
      for (const g of ch.groups) disposeGroup(g);
      ch.groups = [];
      // группы: материал без цвета + тени + порядок; внутри — по сетке: экземпляры или склейка
      const groups = new Map();
      for (const it of items) {
        const m = it.m, gk = it.key + '|' + (m.castShadow ? 1 : 0) + (m.receiveShadow ? 1 : 0) + '|' + m.renderOrder;
        let G = groups.get(gk);
        if (!G) groups.set(gk, (G = { base: it.mat, cast: m.castShadow, recv: m.receiveShadow, ro: m.renderOrder, by: new Map() }));
        const ik = it.unit ? 'u:' + it.unit : it.g.uuid;
        let l = G.by.get(ik); if (!l) G.by.set(ik, (l = [])); l.push(it);
      }
      for (const G of groups.values()) {
        const merge = [];
        for (const [ik, list] of G.by) {
          const unit = ik.charCodeAt(0) === 117 && ik[1] === ':' ? list[0].unit : '', ig = unit ? unitGeo(unit) : list[0].g;
          if (list.length >= 2 && ig.attributes.position.count > INST_MIN_V) {
            const kind = unit && usesUV(G.base) && G.base.userData?.tile ? 'u' : 'i';
            ch.groups.push(buildInst(ch, G, list, ig, bmat(G.base, kind)));
          } else for (const it of list) merge.push(it);
        }
        if (merge.length) ch.groups.push(buildMerged(ch, G, merge, bmat(G.base, 'm')));
      }
      // всё прочее (спрайты, прозрачное) — копии на месте, рядом с пачкой
      for (const rec of ch.recs) { removeLoose(rec); if (rec.looseSrc?.length) addLoose(rec); rec.looseSrc = null; }
      detachAll(newly);
      for (const rec of newly) rec.state = 'batched';
      ch.dirty = false; ch.due = 0; dirty.delete(ch);
      if (!ch.recs.size && !ch.groups.length) chunks.delete(ch.key);
      R.shadowDirty?.();
      const ms = performance.now() - t0;
      B.rebuilds++; B.lastMs = ms; if (ms > B.maxMs) B.maxMs = ms;
    }
    function place(mesh, ch, G){
      mesh.castShadow = !!G.cast; mesh.receiveShadow = !!G.recv; mesh.renderOrder = G.ro || 0;
      mesh.position.set(ch.cx, 0, ch.cz); mesh.updateMatrix(); mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false;
      mesh.matrixWorld.copy(mesh.matrix);
      mesh.userData.batch = ch.key;
      scene.add(mesh);
    }
    // ── Склейка: вершины в координатах чанка, цвет — в вершинах, индексы подряд ──
    function buildMerged(ch, G, list, mat){
      let nv = 0, ni = 0;
      for (const it of list) { const c = it.g.attributes.position.count; nv += c; ni += it.g.index ? it.g.index.count : c; }
      const needUV = usesUV(mat);
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = needUV ? new Float32Array(nv * 2) : null;
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      const grp = { kind: 'merge', mesh: null, dead: false };
      let v = 0, k = 0;
      for (const it of list) {
        const g = it.g, gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv, cnt = gp.count, e = it.m.matrixWorld.elements;
        _n3.getNormalMatrix(it.m.matrixWorld); const ne = _n3.elements;
        const cr = it.mat.color.r, cg = it.mat.color.g, cb = it.mat.color.b, ox = ch.cx, oz = ch.cz;
        for (let i = 0; i < cnt; i++) {
          const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i), j = (v + i) * 3;
          pos[j] = e[0] * x + e[4] * y + e[8] * z + e[12] - ox; pos[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14] - oz;
          if (gn) {
            const a = gn.getX(i), b = gn.getY(i), c = gn.getZ(i);
            let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
            const l = Math.hypot(nx, ny, nz) || 1; nor[j] = nx / l; nor[j + 1] = ny / l; nor[j + 2] = nz / l;
          } else nor[j + 1] = 1;
          col[j] = cr; col[j + 1] = cg; col[j + 2] = cb;
          if (uv && gu) { uv[(v + i) * 2] = gu.getX(i); uv[(v + i) * 2 + 1] = gu.getY(i); }
        }
        if (g.index) { const ia = g.index; for (let i = 0; i < ia.count; i++) idx[k++] = ia.getX(i) + v; }
        else for (let i = 0; i < cnt; i++) idx[k++] = v + i;
        it.rec.slots.push({ g: grp, a: v, n: cnt });
        v += cnt;
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('color', new T.BufferAttribute(col, 3));
      if (uv) geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = grp.mesh = new T.Mesh(geo, mat);
      place(mesh, ch, G);
      return grp;
    }
    // ── Экземпляры: общая сетка (её буферы не копируются), своя «обёртка» с границами всех экземпляров чанка ──
    function buildInst(ch, G, list, geo, mat){
      const n = list.length, w = new T.BufferGeometry();
      w.index = geo.index;
      for (const name in geo.attributes) w.attributes[name] = geo.attributes[name];
      const mesh = new T.InstancedMesh(w, mat, n), a = mesh.instanceMatrix.array, colors = new Float32Array(n * 3);
      const grp = { kind: 'inst', mesh, dead: false };
      const bs = geo.boundingSphere, r0 = bs.radius;
      let white = true, minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
      for (let i = 0; i < n; i++) {
        const it = list[i], e = it.m.matrixWorld.elements, o = i * 16;
        const sx = it.unit ? it.size[0] : 1, sy = it.unit ? it.size[1] : 1, sz = it.unit ? it.size[2] : 1;
        a[o] = e[0] * sx; a[o + 1] = e[1] * sx; a[o + 2] = e[2] * sx; a[o + 3] = 0;
        a[o + 4] = e[4] * sy; a[o + 5] = e[5] * sy; a[o + 6] = e[6] * sy; a[o + 7] = 0;
        a[o + 8] = e[8] * sz; a[o + 9] = e[9] * sz; a[o + 10] = e[10] * sz; a[o + 11] = 0;
        a[o + 12] = e[12] - ch.cx; a[o + 13] = e[13]; a[o + 14] = e[14] - ch.cz; a[o + 15] = 1;
        const c = it.mat.color; colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        if (c.r !== 1 || c.g !== 1 || c.b !== 1) white = false;
        // граница: центр сферы сетки в мире ± радиус × наибольший масштаб
        _m4.fromArray(a, o); _v.copy(bs.center).applyMatrix4(_m4);
        const rr = r0 * _m4.getMaxScaleOnAxis();
        if (_v.x - rr < minx) minx = _v.x - rr; if (_v.y - rr < miny) miny = _v.y - rr; if (_v.z - rr < minz) minz = _v.z - rr;
        if (_v.x + rr > maxx) maxx = _v.x + rr; if (_v.y + rr > maxy) maxy = _v.y + rr; if (_v.z + rr > maxz) maxz = _v.z + rr;
        it.rec.slots.push({ g: grp, a: i, n: 1 });
      }
      if (!white) mesh.instanceColor = new T.InstancedBufferAttribute(colors, 3);
      _box.min.set(minx, miny, minz); _box.max.set(maxx, maxy, maxz);
      w.boundingSphere = _box.getBoundingSphere(new T.Sphere());
      w.boundingBox = _box.clone();
      mesh.frustumCulled = true;
      place(mesh, ch, G);
      return grp;
    }
    // Вынуть объект из пачки мгновенно (без пересборки): его вершины — в точку, его экземпляр — в нулевой размер
    function collapse(rec){
      for (const s of rec.slots) {
        const g = s.g; if (g.dead) continue;
        if (g.kind === 'inst') {
          const at = g.mesh.instanceMatrix, a = at.array, o = s.a * 16;
          a[o] = a[o + 1] = a[o + 2] = a[o + 4] = a[o + 5] = a[o + 6] = a[o + 8] = a[o + 9] = a[o + 10] = 0;
          markRange(at, o, 16);
        } else {
          const at = g.mesh.geometry.attributes.position, a = at.array, o = s.a * 3, x = a[o], y = a[o + 1], z = a[o + 2];
          for (let i = 1; i < s.n; i++) { const j = o + i * 3; a[j] = x; a[j + 1] = y; a[j + 2] = z; }
          markRange(at, o, s.n * 3);
        }
      }
      rec.slots.length = 0;
      R.shadowDirty?.();
    }
    function markRange(at, off, cnt){
      const u = at.updateRange;
      if (u.count < 0) { u.offset = off; u.count = cnt; }
      else { const end = Math.max(u.offset + u.count, off + cnt); u.offset = Math.min(u.offset, off); u.count = end - u.offset; }
      at.needsUpdate = true;
    }
    function addLoose(rec){
      rec.loose = [];
      for (const m of rec.looseSrc) {
        const c = m.clone(false);
        c.matrixAutoUpdate = false; c.matrix.copy(m.matrixWorld); c.matrixWorld.copy(m.matrixWorld); c.matrixWorldAutoUpdate = false;
        c.userData = { batchLoose: rec.id };
        scene.add(c); rec.loose.push(c);
      }
    }
    function removeLoose(rec){ if (!rec.loose) return; for (const c of rec.loose) c.parent?.remove(c); rec.loose = null; }

    // ═══ Каждый кадр (R.preRender): правки утихли → в очередь; очередь → чанки; грязные чанки → пересборка ═══
    function update(force){
      if (!B.on) return;
      const t = now();
      for (const ch of chunks.values()) for (const rec of ch.recs) if (rec.obj._mesh !== rec.root) changed(rec.obj, 'refresh');   // меш заменили без SC.set
      if (hot.size) for (const rec of hot) if (force || rec.hotUntil <= t) { hot.delete(rec); if (rec.state === 'single') toPending(rec); }
      let moved = 0;
      if (pending.size) for (const rec of pending) {
        if (!force && rec.settleAt > t) continue;
        pending.delete(rec);
        if (!canBatch(rec)) { rec.state = rec.state === 'gone' ? 'gone' : 'single'; continue; }
        const ch = chunkFor(rec); ch.recs.add(rec); rec.chunk = ch; markDirty(ch, t); moved++;
      }
      if (!dirty.size) return;
      // много сразу (загрузка, отмена, «Стоп») — пересобрать всё в этом кадре: один долгий кадр лучше десятка медленных
      const bulk = force || moved > 32, t0 = performance.now();
      for (const ch of dirty) {
        if (!bulk && ch.due > t) continue;
        const first = !ch.groups.length;   // новый чанк — сразу весь, без лимита времени
        rebuild(ch);
        if (!bulk && !first && performance.now() - t0 > B.budget) break;
      }
    }
    const pre = () => update(false);
    pre.dispose = () => B.dispose();
    R.preRender.push(pre);
    B.update = update;
    B.flush = () => update(true);
    B.edit = () => { B.mode = 'edit'; for (const rec of recs.values()) { if (rec.state === 'dyn') toPending(rec); else if (rec.state === 'pending') rec.settleAt = 0; } };
    B.play = () => {
      B.mode = 'play';
      for (const rec of recs.values()) {
        if (rec.obj.cls === 'Part' && rec.obj.anchored === false) makeDyn(rec);
        else if (rec.state === 'single' && hot.has(rec)) toPending(rec);
      }
      hot.clear();
      update(true);
    };
    B.refresh = obj => { if (obj) changed(obj, 'refresh'); };
    B.setEnabled = on => {
      on = !!on; if (on === B.on) return;
      if (!on) {
        for (const ch of chunks.values()) for (const g of ch.groups) disposeGroup(g);
        for (const rec of recs.values()) {
          if (rec.state === 'batched') attach(rec);
          removeLoose(rec); rec.slots.length = 0; rec.chunk = null;
          if (rec.state !== 'gone' && rec.state !== 'dyn') rec.state = 'single';
        }
        chunks.clear(); dirty.clear(); pending.clear(); hot.clear();
        B.on = false; R.shadowDirty?.();
      } else {
        B.on = true;
        for (const rec of recs.values()) if (rec.state === 'single' && classOk(rec)) toPending(rec);
        update(true);
      }
    };
    B.stats = () => {
      let calls = 0, inst = 0, merged = 0, batched = 0, single = 0, dyn = 0, tris = 0;
      for (const ch of chunks.values()) for (const g of ch.groups) { calls++; if (g.kind === 'inst') { inst += g.mesh.count; } else merged++; }
      for (const rec of recs.values()) { if (rec.state === 'batched') batched++; else if (rec.state === 'dyn') dyn++; else if (rec.state !== 'gone') single++; }
      return { chunks: chunks.size, groups: calls, inst, merged, batched, single, dyn, pending: pending.size, hot: hot.size, lights: lights.size, rebuilds: B.rebuilds, lastMs: B.lastMs, maxMs: B.maxMs, tris };
    };
    B.chunksOf = () => chunks;   // для тестов
    B.recOf = id => recs.get(id) || null;
    B.dispose = () => {
      if (B.dead) return; B.dead = true;
      const i = R.preRender.indexOf(pre); if (i >= 0) R.preRender.splice(i, 1);
      SC.set = set0; for (const f of offs) f();
      for (const ch of chunks.values()) { for (const rec of ch.recs) { if (rec.state === 'batched' && !R.dead) attach(rec); removeLoose(rec); } for (const g of ch.groups) disposeGroup(g); }
      for (const rec of recs.values()) if (rec.state !== 'gone') unwatchVisible(rec);
      for (const id of [...lights.keys()]) dropLight(id);
      for (const m of bmats.values()) m.dispose();
      for (const k in units) units[k].dispose();
      chunks.clear(); recs.clear(); bmats.clear();
      if (SC.batch === B) SC.batch = null;
    };

    // ═══ Свет: точечные лампы — в постоянный набор render.js (без пересборки шейдеров), лампочка светится ═══
    function adoptLight(obj){
      const L = obj._light; if (!L || !R.lights) return;
      dropLight(obj.id);
      if (L.parent) L.parent.remove(L);
      lights.set(obj.id, { L, h: R.lights.add(L) });
      if (obj._mesh?.material && R.bloom && !obj._mesh.material.transparent) R.bloom(obj._mesh.material, 1.2);
    }
    function dropLight(id){ const l = lights.get(id); if (!l) return; R.lights.remove(l.h); lights.delete(id); }

    // уже существующие объекты (батчер создан после загрузки мира)
    for (const obj of SC.all()) track(obj);
    return B;
  };
})();

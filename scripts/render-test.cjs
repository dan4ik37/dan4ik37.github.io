// Тесты графики движка D37E в node (без браузера): склейка сцены (js/engine/batch.js) — чанки, склеенная геометрия
// и экземпляры дают ровно те же треугольники (места, нормали, цвета), что и отдельные меши; правки в редакторе и в игре,
// видимость, удаление, выбор мышью по вынутым мешам, свет в постоянный набор; автомат динамического разрешения и выбор
// ламп (render.js). Графика v3 (gfx.js): пресеты и настройки игрока (E.gfxResolve), лесенка автокачества, графика мира
// (E.worldGfx, сброс при загрузке мира — E.mergeLighting), цвет кадра, модель неба и время суток, правка кусков шейдеров
// three (туман, тени: #if/#endif, скобки, общие uniform по ссылке), купол неба и вода v2 (#include с новой строки),
// вкладка «Графика» (js/core/gfx-settings.js: перенос d37_gfx, «Своя», пресеты → D37Opt.gfx), лимит FPS (core.js).
// Нужен three.js r149 (в репозитории его нет — сайт берёт его с jsDelivr):
//   npm i three@0.149.0 во временной папке, затем: node scripts/render-test.cjs <путь к node_modules/three>
//   (или переменная THREE_PATH). Запуск из корня сайта. Выход с кодом 1, если есть ошибки.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let THREE;
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { THREE = require(fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p); break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/render-test.cjs <путь>/node_modules/three'); process.exit(1); }
if (THREE.REVISION !== '149') console.log('Внимание: three.js r' + THREE.REVISION + ' (сайт использует r149)');
globalThis.window = globalThis;
globalThis.THREE = THREE;
// холст-заглушка (знак точки появления рисуется на canvas)
const ctx2d = new Proxy({}, { get: (o, k) => k in o ? o[k] : () => ({ addColorStop(){} }), set: (o, k, v) => { o[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
for (const f of ['core', 'physics', 'gfx', 'render', 'scene', 'batch'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
const E = globalThis.D37E, T = THREE;
if (T.ColorManagement && 'legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;   // как World3D.kit
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };

// ═══ Подставной рендерер: материалы и предметы как в render.js (кэш материалов, общие сетки предметов) ═══
function mockR(){
  const scene = new T.Scene(), mats = new Map(), geos = new Map(), lightsList = [];
  const cache = (m, k, f) => m.get(k) || (m.set(k, f()), m.get(k));
  const R = { T, scene, q: 'high', preRender: [], r: { shadowMap: { enabled: true } }, lighting: { time: 14 }, dirtyN: 0, movingN: 0 };
  R.shadowDirty = moving => { if (moving) R.movingN++; else R.dirtyN++; };
  R.setLighting = () => {};
  R.lights = { list: lightsList, add: src => { const h = { src }; lightsList.push(h); return h; }, remove: h => { const i = lightsList.indexOf(h); if (i >= 0) lightsList.splice(i, 1); } };
  R.bloomPatch = function (sh){ /* как в render.js */ };
  R.bloom = (m, k = 1) => { m.userData.bloom = k; m.onBeforeCompile = R.bloomPatch; return m; };
  R.mat = (c, o = {}) => cache(mats, `m${c}|${o.rough ?? ''}|${o.metal ?? ''}|${o.flat ? 1 : 0}`, () => new T.MeshStandardMaterial({ color: c, roughness: o.rough ?? .82, metalness: o.metal ?? 0, flatShading: !!o.flat }));
  const texObj = new Map();
  const tex = n => cache(texObj, n, () => new T.Texture());
  R.tex = (name, o = {}) => cache(mats, `t${name}|${o.tint}|${o.tile}|${o.rough}`, () => { const m = new T.MeshStandardMaterial({ color: o.tint || '#ffffff', map: tex(name), roughness: o.rough ?? .9 }); m.userData.tile = (o.tile || 2) * E.UNIT; return m; });
  R.proc = name => tex('p:' + name);
  R.texMat = (key, map, o = {}) => cache(mats, 'cm' + key + (o.tint || ''), () => { const m = new T.MeshStandardMaterial({ color: o.tint || '#ffffff', map, roughness: o.rough ?? .9 }); m.userData.tile = (o.tile || 2) * E.UNIT; return m; });
  R.glow = c => cache(mats, 'glow' + c, () => R.bloom(new T.MeshBasicMaterial({ color: c, toneMapped: false })));
  R.shadowsOn = obj => obj.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const geo = (k, f) => cache(geos, k, f);
  const part = (g, o) => { const m = new T.Mesh(o.geo, o.m); m.position.set(o.x || 0, o.y || 0, o.z || 0); if (o.sy) m.scale.set(1, o.sy, 1); g.add(m); return m; };
  const halo = new T.SpriteMaterial({ transparent: true });
  R.prefab = (kind, o, ph) => {
    const g = new T.Group(); g.position.set(o.x, 0, o.z); g.rotation.y = o.yaw || 0; o.parent.add(g); const k = o.k || 1;
    if (kind === 'lamp') {
      part(g, { geo: geo('pole', () => new T.CylinderGeometry(.07, .1, 3, 8)), m: R.mat('#2d2a3a', { rough: .5, metal: .6 }), y: 1.5 });
      part(g, { geo: geo('bulb', () => new T.SphereGeometry(.26, 12, 8)), m: R.glow('#fff3b0'), y: 3.1 });
      const s = new T.Sprite(halo); s.position.set(0, 3.1, 0); g.add(s);
    } else if (kind === 'sign') {
      part(g, { geo: geo('post', () => new T.BoxGeometry(.14, 1.6, .14)), m: R.mat('#6b4426'), y: .8 });
      part(g, { geo: geo('plane', () => new T.PlaneGeometry(1.8, .7)), m: new T.MeshBasicMaterial({ map: new T.Texture(), toneMapped: false }), y: 1.75 });
    } else {   // дерево: ствол + 4 кроны разных цветов (материалы разные, «без цвета» — одинаковые)
      const greens = ['#3f8f3a', '#4ea544', '#62b84f', '#367d34'];
      part(g, { geo: geo('trunk' + k, () => new T.CylinderGeometry(.22 * k, .32 * k, 1.9 * k, 7)), m: R.mat('#7a4f2c', { rough: .95 }), y: .95 * k });
      [[0, 2.45, 0, 1.25], [-.7, 2.0, .25, .9], [.7, 2.05, -.15, .95], [.1, 2.95, .1, .8]].forEach(([dx, dy, dz, rr], j) =>
        part(g, { geo: geo('ico' + rr * k, () => new T.IcosahedronGeometry(rr * k, 1)), m: R.mat(greens[(j + (o.seed || 0)) % 4], { flat: true }), x: dx * k, y: dy * k, z: dz * k, sy: .9 }));
      ph?.addCyl({ x: o.x, z: o.z, y: 1.2, r: .38, hy: 1.2 });
    }
    return g;
  };
  return R;
}
let clock = 1000;
const now = () => clock;
function world(){
  const R = mockR(), ph = new E.Phys({ ground: 0 }), SC = E.scene(R, ph, { edit: true });
  return { R, ph, SC };
}
const rnd = E.rng(5), pick = a => a[Math.floor(rnd() * a.length)];
const MATS = ['plastic', 'smooth', 'wood', 'brick', 'metal', 'neon', 'grass', 'concrete'], COLS = ['#c4281c', '#f5cd30', '#0d69ac', '#4b974b', '#f2f3f3', '#6b327c'];
function fillWorld(SC, n){
  const out = [];
  for (let i = 0; i < n; i++) {
    const shape = pick(['block', 'block', 'block', 'wedge', 'ball', 'cyl']), x = (rnd() - .5) * 200, z = (rnd() - .5) * 200;
    const size = shape === 'block' ? [1 + rnd() * 6, .5 + rnd() * 3, 1 + rnd() * 6] : [1 + rnd() * 2, 1 + rnd() * 2, 1 + rnd() * 2];
    out.push(SC.add('Part', { shape, size, pos: [x, size[1] / 2, z], rot: [rnd() < .2 ? 90 : 0, rnd() < .5 ? Math.round(rnd() * 360) : 0, 0], color: pick(COLS), mat: pick(MATS) }));
  }
  return out;
}

// ═══ Треугольники в мире: места вершин, нормали, цвет — для сравнения «отдельно» и «склеено» (с допуском float32) ═══
const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3(), _m = new T.Matrix4(), _nm = new T.Matrix3();
// треугольник = 27 чисел: 3 × (x y z, нормаль, цвет); вырожденные (вынутые из пачки) пропускаем
function trisInto(out, geo, mw, color){
  const p = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index, cnt = idx ? idx.count : p.count;
  _nm.getNormalMatrix(mw);
  for (let t = 0; t < cnt; t += 3) {
    const tri = new Float64Array(27);
    for (let k = 0; k < 3; k++) {
      const i = idx ? idx.getX(t + k) : t + k, v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(mw);
      const n = nrm ? new T.Vector3().fromBufferAttribute(nrm, i).applyMatrix3(_nm).normalize() : new T.Vector3(0, 1, 0);
      const c = typeof color === 'function' ? color(i) : color;
      tri.set([v.x, v.y, v.z, n.x, n.y, n.z, c[0], c[1], c[2]], k * 9);
      if (k === 0) _a.copy(v); else if (k === 1) _b.copy(v); else _c.copy(v);
    }
    if (_b.clone().sub(_a).cross(_c.clone().sub(_a)).length() < 1e-7) continue;
    out.push(tri);
  }
}
const colKey = c => [c.r, c.g, c.b];
// два набора треугольников равны: каждому — пара с теми же вершинами (тот же обход), нормалями и цветом
function sameSets(A, Bs){
  if (A.length !== Bs.length) return `исходных ${A.length}, в пачках ${Bs.length}`;
  const cell = t => `${Math.round((t[0] + t[9] + t[18]) * 4)},${Math.round((t[1] + t[10] + t[19]) * 4)},${Math.round((t[2] + t[11] + t[20]) * 4)}`;
  const grid = new Map();
  for (const t of Bs) { const k = cell(t); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(t); }
  const near = (a, b, sa, sb) => { for (let k = 0; k < 3; k++) { const i = ((sa + k) % 3) * 9, j = ((sb + k) % 3) * 9; for (let q = 0; q < 9; q++) if (Math.abs(a[i + q] - b[j + q]) > (q < 3 ? 2e-3 : q < 6 ? 2e-2 : 2e-3)) return false; } return true; };
  let bad = 0;
  for (const a of A) {
    const cx = Math.round((a[0] + a[9] + a[18]) * 4), cy = Math.round((a[1] + a[10] + a[19]) * 4), cz = Math.round((a[2] + a[11] + a[20]) * 4);
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) for (let dy = -1; dy <= 1 && !found; dy++) for (let dz = -1; dz <= 1 && !found; dz++) {
      const l = grid.get(`${cx + dx},${cy + dy},${cz + dz}`); if (!l) continue;
      for (let i = 0; i < l.length && !found; i++) for (let s = 0; s < 3; s++) if (near(a, l[i], 0, s)) { l.splice(i, 1); found = true; break; }
    }
    if (!found && ++bad <= 2) console.log('  нет пары:', Array.from(a.slice(0, 9)).map(v => v.toFixed(3)).join(' '));
  }
  return bad ? `без пары ${bad} из ${A.length}` : true;
}
// исходные (то, что рисовалось бы без склейки): все склеенные объекты пачки
function sourceTris(B, SC){
  const out = [];
  for (const o of SC.all()) {
    const rec = B.recOf(o.id); if (!rec || rec.state !== 'batched') continue;
    rec.root.updateMatrixWorld(true);
    rec.root.traverseVisible(m => { if (m.isMesh && !m.material.transparent && !m.isSprite) trisInto(out, m.geometry, m.matrixWorld, colKey(m.material.color)); });
  }
  return out;
}
function batchTris(R){
  const out = [];
  for (const m of R.scene.children) {
    if (!m.userData.batch) continue;
    if (m.isInstancedMesh) {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, _m); _m.premultiply(m.matrixWorld);
        const c = m.instanceColor ? [m.instanceColor.getX(i), m.instanceColor.getY(i), m.instanceColor.getZ(i)] : [1, 1, 1];
        trisInto(out, m.geometry, _m.clone(), c);
      }
    } else {
      const col = m.geometry.attributes.color;
      trisInto(out, m.geometry, m.matrixWorld, i => [col.getX(i), col.getY(i), col.getZ(i)]);
    }
  }
  return out;
}
const sameTris = (B, SC, R) => { const a = sourceTris(B, SC); return a.length ? sameSets(a, batchTris(R)) : 'нет склеенных'; };
const batchMeshes = R => R.scene.children.filter(m => m.userData.batch);
const renderables = R => { let n = 0; R.scene.traverseVisible(m => { if (m.isMesh || m.isSprite) n++; }); return n; };
// всё ли внутри границ: вершины каждой пачки — в её сфере (для отсечения по видимости)
function boundsOk(R){
  for (const m of batchMeshes(R)) {
    const s = m.geometry.boundingSphere.clone().applyMatrix4(m.matrixWorld), list = [];
    if (m.isInstancedMesh) for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, _m); _m.premultiply(m.matrixWorld); const p = m.geometry.attributes.position; for (let j = 0; j < p.count; j++) list.push(new T.Vector3().fromBufferAttribute(p, j).applyMatrix4(_m)); }
    else { const p = m.geometry.attributes.position; for (let j = 0; j < p.count; j++) list.push(new T.Vector3().fromBufferAttribute(p, j).applyMatrix4(m.matrixWorld)); }
    for (const v of list) if (v.distanceTo(s.center) > s.radius * 1.0001 + 1e-4) return false;
  }
  return true;
}

// ═══ 1. Склейка: всё на месте, вызовов меньше, треугольники те же ═══
{
  const { R, SC } = world();
  const parts = fillWorld(SC, 400);
  const trees = []; for (let i = 0; i < 40; i++) trees.push(SC.add('Prefab', { kind: 'tree', pos: [(i % 8) * 4 - 16, 0, Math.floor(i / 8) * 4 - 10], scale: 1, rot: [0, i * 30, 0] }));
  const lamps = []; for (let i = 0; i < 6; i++) lamps.push(SC.add('Prefab', { kind: 'lamp', pos: [i * 3, 0, 20] }));
  const sign = SC.add('Prefab', { kind: 'sign', pos: [5, 0, -5], text: 'Привет' });
  const glass = SC.add('Part', { pos: [3, 1, 3], size: [2, 2, .2], mat: 'glass' });
  const base = SC.add('Part', { name: 'Основание', pos: [0, -.5, 0], size: [128, 1, 128], mat: 'concrete', color: '#6b7a8f' });
  const spawn = SC.add('Spawn', { pos: [0, .2, 0] });
  const lamp1 = SC.add('Light', { pos: [0, 4, 0] });
  const balls = []; for (let i = 0; i < 6; i++) balls.push(SC.add('Part', { shape: 'ball', size: [1 + i * .3, 1, 1.5], pos: [30 + i * 2, 1, 30], mat: 'brick', color: COLS[i % 3] }));
  const before = renderables(R);
  const B = E.batcher(SC, { now });
  ok(SC.batch === B, 'SC.batch');
  ok(R.lights.list.length === 1 && !R.scene.children.some(x => x.isPointLight), 'свет ушёл в постоянный набор, не в сцене');
  ok(R.preRender.length === 1, 'склейка встала перед кадром');
  R.preRender[0](R, clock);   // первый кадр — всё склеено сразу
  const st = B.stats();
  ok(parts.every(p => B.recOf(p.id).state === 'batched' && !p._mesh.parent), 'все детали в пачках и вынуты из сцены', st);
  ok(trees.every(p => B.recOf(p.id).state === 'batched'), 'деревья в пачках');
  ok(B.recOf(glass.id).state === 'single' && glass._mesh.parent === R.scene, 'стекло (прозрачное) — отдельно');
  ok(B.recOf(spawn.id).state === 'single' && spawn._mesh.parent === R.scene, 'точка появления — отдельно');
  ok(B.recOf(base.id).chunk.key === 'big', 'огромная деталь — в общем чанке');
  const after = renderables(R);
  ok(after < before / 2.5, `объектов для отрисовки ${before} → ${after}`);
  console.log(`  400 деталей вразброс, 40 деревьев, 6 фонарей: объектов для отрисовки ${before} → ${after}`);
  ok(sameTris(B, SC, R) === true, 'треугольники пачек = треугольники деталей (места, нормали, цвета)', sameTris(B, SC, R));
  ok(boundsOk(R), 'границы пачек охватывают все вершины (отсечение по видимости верное)');
  // шары/цилиндры деталей — экземплярами единичной формы; деревья — экземплярами общих сеток
  const inst = batchMeshes(R).filter(m => m.isInstancedMesh);
  ok(inst.length > 0 && inst.every(m => m.frustumCulled && m.geometry.boundingSphere), 'экземпляры с границами, отсекаются');
  ok(inst.some(m => m.count >= 10), 'кроны деревьев — одним вызовом на сетку', inst.map(m => m.count).join(','));
  // каждая пачка — один материал без цвета (цвет в вершинах/экземплярах)
  ok(batchMeshes(R).every(m => m.material.color.r === 1 && m.material.color.g === 1 && m.material.color.b === 1), 'материал пачки белый, цвет — в данных');
  // неон светится (метка свечения у материала)
  const neon = parts.find(p => p.mat === 'neon');
  ok(!neon || neon._mesh.material.userData.bloom > 0, 'неон помечен для свечения');
  ok(batchMeshes(R).some(m => m.material.userData.bloom > 0) === !!neon, 'пачка неона светится');
  // лампочки фонарей: ореол-спрайт — копией на месте
  const loose = R.scene.children.filter(x => x.userData.batchLoose);
  ok(loose.length === lamps.length && loose.every(x => x.isSprite), 'спрайты фонарей — копиями рядом с пачкой', loose.length);
  const l0 = lamps[0]._mesh; l0.updateMatrixWorld(true); let spr = null; l0.traverse(x => { if (x.isSprite) spr = x; });
  ok(loose.some(x => x.matrixWorld.equals(spr.matrixWorld)), 'копия спрайта стоит там же');
  // табличка (свой материал с текстурой) — в пачке
  ok(B.recOf(sign.id).state === 'batched', 'табличка в пачке');
  // чанки: детали по 48 м
  const p0 = parts[0], ck = B.recOf(p0.id).chunk.key;
  ok(ck === Math.floor(p0.pos[0] / 48) + ',' + Math.floor(p0.pos[2] / 48) || ck === 'big', 'чанк по месту детали', ck);
  // единичная форма шара/цилиндра = форма scene.js (иначе склеенные отличаются от отдельных)
  const ballInst = B.recOf(balls[0].id).slots[0]?.g.mesh;
  ok(ballInst?.isInstancedMesh && ballInst.count === 6 && ballInst.geometry.attributes.position.count === 29 * 19 && ballInst.material.userData.uvTile > 0, 'шары одного материала — экземплярами единичного шара с UV по размеру', ballInst?.count);
  ok(balls.every(b => B.recOf(b.id).state === 'batched'), 'шары в пачке');

  // ═══ 2. Выбор мышью: луч находит вынутые меши ═══
  const ray = new T.Raycaster();
  ray.camera = new T.PerspectiveCamera();   // в студии — setFromCamera (нужно спрайтам фонарей)
  const tgt = parts.find(p => p.shape === 'block' && p.rot[0] === 0 && p.size[0] > 2 && Math.abs(p.pos[0]) < 90);
  ray.set(new T.Vector3(tgt.pos[0], 50, tgt.pos[2]), new T.Vector3(0, -1, 0));
  const hit = SC.pick(ray);
  ok(hit && hit.obj.pos[1] + hit.obj.size[1] / 2 >= tgt.pos[1] + tgt.size[1] / 2 - 1e-6, 'SC.pick попадает в склеенную деталь (или выше неё)', hit?.obj.id);
  const bx = SC.box(tgt);
  ok(Math.abs(bx.max.y - (tgt.pos[1] + tgt.size[1] / 2)) < 1e-3, 'SC.box склеенной детали верный');

  // ═══ 3. Правка в редакторе: сразу отдельно, через 400 мс — снова в пачке (в новом чанке) ═══
  const mv = parts.find(p => p.shape === 'block');
  const oldChunk = B.recOf(mv.id).chunk;
  SC.set(mv, 'pos', [mv.pos[0] + 60, mv.pos[1], mv.pos[2]]);
  ok(B.recOf(mv.id).state === 'single' && mv._mesh.parent === R.scene, 'правка: деталь сразу рисуется отдельно');
  ok(oldChunk.dirty, 'старый чанк ждёт пересборки');
  ok(sameTris(B, SC, R) === true, 'из пачки вынута мгновенно (её треугольники выродились)', sameTris(B, SC, R));
  ray.set(new T.Vector3(mv.pos[0], 50, mv.pos[2]), new T.Vector3(0, -1, 0));
  clock += 100; R.preRender[0](R, clock);
  ok(B.recOf(mv.id).state === 'single', 'пока правят — отдельно');
  SC.set(mv, 'pos', [mv.pos[0], mv.pos[1], mv.pos[2] + 1]);
  clock += 300; R.preRender[0](R, clock);
  ok(B.recOf(mv.id).state === 'single', 'новая правка продлевает «горячее» время');
  clock += 500; R.preRender[0](R, clock);
  ok(B.recOf(mv.id).state === 'batched' && !mv._mesh.parent, 'утихло — снова в пачке');
  ok(B.recOf(mv.id).chunk.key === Math.floor(mv.pos[0] / 48) + ',' + Math.floor(mv.pos[2] / 48), 'в чанке нового места');
  ok(sameTris(B, SC, R) === true, 'после пересборки треугольники совпадают', sameTris(B, SC, R));
  // пересборка (цвет): новый меш, сразу отдельно
  const rc = parts.find(p => p.shape === 'cyl' && p.mat !== 'neon') || parts[3];
  SC.set(rc, 'color', '#123456');
  ok(B.recOf(rc.id).state === 'single' && rc._mesh.parent === R.scene, 'смена цвета: новый меш отдельно');
  clock += 500; R.preRender[0](R, clock);
  ok(B.recOf(rc.id).state === 'batched' && sameTris(B, SC, R) === true, 'и через паузу — в пачке с новым цветом');
  // видимость (studio3d прячет детали через _mesh.visible)
  const hv = parts[7];
  hv._mesh.visible = false;
  ok(B.recOf(hv.id).state === 'single' && hv._mesh.parent === R.scene && sameTris(B, SC, R) === true, 'спрятали — вынута из пачки');
  clock += 500; R.preRender[0](R, clock);
  ok(B.recOf(hv.id).state === 'single', 'невидимая в пачку не идёт');
  hv._mesh.visible = true; clock += 500; R.preRender[0](R, clock);
  ok(B.recOf(hv.id).state === 'batched', 'снова видна — в пачке');
  // удаление
  const del = parts[9]; SC.remove(del);
  ok(!B.recOf(del.id) && sameTris(B, SC, R) === true, 'удалили — пропала из пачки сразу');
  clock += 500; R.preRender[0](R, clock);
  ok(sameTris(B, SC, R) === true && boundsOk(R), 'после уплотнения всё совпадает');
  // свет: смена цвета — новая лампа в наборе, удаление — убрана
  SC.set(lamp1, 'color', '#ff0000');
  ok(R.lights.list.length === 1 && R.lights.list[0].src === lamp1._light && !lamp1._light.parent, 'свет после правки — новый источник в наборе');
  SC.remove(lamp1);
  ok(R.lights.list.length === 0, 'свет удалён из набора');

  // ═══ 4. Игра: незакреплённые и меняющиеся — отдельно до «Стоп»; новые — склеиваются, если не меняются ═══
  const loose1 = parts.find(p => B.recOf(p.id).state === 'batched' && p.shape === 'block' && p !== mv);
  SC.set(loose1, 'anchored', false);   // в редакторе — ещё в пачке (не падает)
  clock += 500; R.preRender[0](R, clock);
  ok(B.recOf(loose1.id).state === 'batched', 'незакреплённая в редакторе — в пачке');
  B.play();
  ok(B.recOf(loose1.id).state === 'dyn' && loose1._mesh.parent === R.scene, '▶ незакреплённая — отдельно');
  const tw = parts.find(p => B.recOf(p.id).state === 'batched' && p.shape === 'block');
  SC.set(tw, 'pos', [tw.pos[0], tw.pos[1] + .1, tw.pos[2]], true);   // твин/скрипт
  ok(B.recOf(tw.id).state === 'dyn', 'сдвинули в игре — отдельно');
  clock += 5000; R.preRender[0](R, clock);
  ok(B.recOf(tw.id).state === 'dyn', 'и остаётся отдельно до «Стоп»');
  const born = SC.add('Part', { pos: [1, 5, 1], size: [1, 1, 1] });
  R.preRender[0](R, clock);
  ok(B.recOf(born.id).state === 'pending', 'созданная скриптом — не сразу в пачку');
  clock += 2100; R.preRender[0](R, clock);
  ok(B.recOf(born.id).state === 'batched', 'не менялась 2 с — склеена');
  ok(sameTris(B, SC, R) === true, 'в игре треугольники совпадают', sameTris(B, SC, R));
  B.edit(); clock += 10; R.preRender[0](R, clock);
  ok(B.recOf(tw.id).state === 'batched', '■ Стоп — снова в пачке');
  // ═══ 5. Выключить/включить склейку (для замера «как раньше») ═══
  B.setEnabled(false);
  ok(batchMeshes(R).length === 0 && parts.every(p => !SC.get(p.id) || p._mesh.parent === R.scene), 'выключили — всё отдельно в сцене');
  B.setEnabled(true);
  ok(parts.every(p => !SC.get(p.id) || B.recOf(p.id).state === 'batched' || p === loose1), 'включили — снова в пачках');
  ok(sameTris(B, SC, R) === true, 'и треугольники совпадают', sameTris(B, SC, R));
  // ═══ 6. Загрузка мира заново (fromJSON) и выключение ═══
  const json = SC.toJSON();
  SC.fromJSON(json); R.preRender[0](R, clock);
  ok(B.stats().batched > 400 && sameTris(B, SC, R) === true, 'мир заново — склеен с первого кадра', B.stats());
  const dirty0 = R.dirtyN; SC.set(SC.all().find(o => o.cls === 'Part'), 'pos', [0, 9, 0]);
  ok(R.dirtyN > dirty0, 'правка просит перерисовать тени');
  B.dispose();
  ok(batchMeshes(R).length === 0 && R.preRender.length === 0 && SC.batch === null, 'dispose: пачки убраны, хуки сняты');
  ok(SC.all().filter(o => o.cls === 'Part').every(o => o._mesh.parent === R.scene), 'dispose: детали вернулись в сцену');
}

// ═══ 7. UV деталей-экземпляров: формула шейдера = UV scene.js ═══
{
  const { R, SC } = world();
  const p = SC.add('Part', { shape: 'ball', size: [3, 1.5, 2], mat: 'brick' });
  const tile = p._mesh.material.userData.tile, src = p._mesh.geometry;   // scene.js: несвёрнутая, UV по метрам
  const unit = new T.SphereGeometry(.5, 28, 18).toNonIndexed(), up = unit.attributes.position, un = unit.attributes.normal, s = p.size;
  let maxErr = 0;
  for (let i = 0; i < up.count; i++) {   // то же, что batchPatch в GLSL
    const P = [up.getX(i) * s[0], up.getY(i) * s[1], up.getZ(i) * s[2]], N = [un.getX(i) / s[0], un.getY(i) / s[1], un.getZ(i) / s[2]], A = N.map(Math.abs);
    const U = A[1] >= A[0] && A[1] >= A[2] ? [P[0], N[1] > 0 ? -P[2] : P[2]] : A[0] >= A[2] ? [N[0] > 0 ? -P[2] : P[2], P[1]] : [N[2] > 0 ? P[0] : -P[0], P[1]];
    maxErr = Math.max(maxErr, Math.abs(U[0] / tile - src.attributes.uv.getX(i)), Math.abs(U[1] / tile - src.attributes.uv.getY(i)));
  }
  ok(maxErr < 1e-4, 'UV шара-экземпляра (формула шейдера) = UV scene.js', maxErr);
  const c = SC.add('Part', { shape: 'cyl', size: [2, 3, 2], mat: 'wood' });
  const cu = new T.CylinderGeometry(.5, .5, 1, 28).toNonIndexed();
  ok(cu.attributes.position.count === c._mesh.geometry.attributes.position.count, 'цилиндр 28 как в scene.js');
}

// ═══ 8. Динамическое разрешение ═══
{
  const sim = (frameMs, secs, D, t0 = 0, cpu = 3) => { let t = t0; while (t < t0 + secs * 1000) { const s = D.scale, dt = typeof frameMs === 'function' ? frameMs(s) : frameMs; t += dt; D.tick(dt, cpu, t); } return t; };
  // видеокарта не успевает: время кадра ~ пиксели (масштаб²)
  let D = E.dynRes();
  let t = sim(s => Math.max(16.7, 26 * s * s), 20, D);
  ok(D.scale < 1 && D.scale >= .6 && 26 * D.scale * D.scale <= 16.7 * 1.18, 'медленно → разрешение ниже, пока не успевает', D.scale);
  const ch = D.changes;
  t = sim(s => Math.max(16.7, 26 * s * s), 120, D, t);
  ok(D.changes - ch <= 12, 'без дёрганья: за 2 минуты мало смен', D.changes - ch);
  // упираемся в скрипты: пиксели не помогут
  D = E.dynRes(); sim(25, 10, D, 0, 23);
  ok(D.scale === 1, 'кадр занят скриптами — разрешение не трогаем', D.scale);
  // экран 30 Гц: ниже не быстрее → вернуть и не трогать
  D = E.dynRes(); t = sim(33.3, 6, D);
  ok(D.scale === 1 && D.why === 'не помогло', 'не помогло — вернули', D.scale + ' ' + D.why);
  const c2 = D.changes; sim(33.3, 20, D, t);
  ok(D.changes === c2, 'и не пробуем снова (полминуты)');
  // стало легко — вверх
  D = E.dynRes(); D.set(.6); sim(16.7, 8, D);
  ok(D.scale > .6, 'запас есть — разрешение выше', D.scale);
  // всплески (сборка мусора) не считаются
  D = E.dynRes(); { let tt = 0; for (let i = 0; i < 1200; i++) { const dt = i % 15 === 0 ? 60 : 16.7; tt += dt; D.tick(dt, 3, tt); } }
  ok(D.scale === 1, 'редкие долгие кадры — не повод', D.scale);
}

// ═══ 9. Выбор ламп ═══
{
  const recs = Array.from({ length: 12 }, (_, i) => ({ score: i + 1, slot: -1 })), out = [];
  E.pickLights(recs, 4, out);
  ok(out.map(r => r.score).join() === '12,11,10,9', 'лучшие 4 по убыванию');
  recs[7].slot = 0;   // score 8 горит; новичок 9 — меньше запаса 30% → остаётся 8
  recs[8].score = 9.5; recs[9].score = 9.6; recs[10].score = 9.7; recs[11].score = 10;
  E.pickLights(recs, 4, out);
  ok(out.includes(recs[7]), 'горящая лампа не мигает из-за чуть более яркой');
  recs.forEach(r => { r.score = 0; });
  ok(E.pickLights(recs, 4, out).length === 0, 'ничего не видно — ничего не горит');
  ok(E.pickLights(recs, 0, out).length === 0, 'на low — ни одной');
}

// ═══ 10. Много деталей: время склейки и число вызовов ═══
{
  const { R, SC } = world();
  fillWorld(SC, 5000);
  const B = E.batcher(SC, { now });
  const t0 = Date.now(); B.flush(); const ms = Date.now() - t0, st = B.stats();
  ok(st.batched >= 4900, '5000 деталей склеены', st.batched);
  ok(st.groups < 700, `вызовов отрисовки (без теней): ${st.groups} вместо ~5000`, st.groups);
  ok(ms < 4000, `первая склейка 5000 деталей: ${ms} мс`, ms);
  ok(boundsOk(R), 'границы верные на 5000');
  console.log(`  5000 деталей: ${st.chunks} чанков, ${st.groups} пачек (${st.merged} склеек, экземпляров ${st.inst}), склейка ${ms} мс`);
  // правка одной детали: пересобирается один чанк
  const p = SC.all().find(o => o.cls === 'Part');
  const t1 = Date.now(); SC.set(p, 'pos', [p.pos[0] + .5, p.pos[1], p.pos[2]]); clock += 1000; B.update(); const ms1 = Date.now() - t1;
  ok(B.recOf(p.id).state === 'batched' && ms1 < 200, `правка → пересборка чанка ${ms1} мс`, ms1);
}

// ═══ 11. Графика v3 (js/engine/gfx.js): пресеты и настройки игрока, лесенка автокачества, графика мира, небо, цвет кадра ═══
{
  const P = E.GFX_PRESETS, R0 = s => E.gfxResolve(s, { q: 'high', gl2: true });
  let o = E.gfxResolve({}, { q: 'mid' });
  ok(o.preset === 'auto' && o.auto && o.tier === 'mid' && o.ao === 'off' && o.shadows, 'пресет «Авто» = по устройству (mid)', o);
  o = R0({ preset: 'ultra' });
  ok(o.tier === 'high' && o.shadowQ === 'ultra' && o.ao === 'high' && o.aa === 'msaa' && o.dist > 1.25 && !o.auto, 'Ультра: основа high, тени 4096, AO выше', o);
  o = R0({ preset: 'high', shadows: false });
  ok(!o.shadows && o.ao === 'on', '«Тени: выкл» в любом пресете');
  o = R0({ preset: 'custom', shadows: true, shadowQ: 'low', ao: 'high', water: 'simple', refl: false, aa: 'off', fog: false, dist: 3, grade: false });
  ok(o.shadowQ === 'low' && o.ao === 'high' && o.water === 'simple' && !o.refl && o.aa === 'off' && !o.fog && o.dist === 2 && !o.grade, '«Своя»: значения игрока (дальность не больше 200%)', o);
  o = R0({ preset: 'custom', shadowQ: 'mega', ao: 1, aa: 'ssaa' });
  ok(o.shadowQ === 'high' && o.ao === 'on' && o.aa === 'msaa', '«Своя»: неверное — как в основе', o);
  o = R0({ preset: 'ultra', battery: true });
  ok(o.fpsCap === 30 && o.ao === 'off' && o.shadowQ === 'mid' && o.prCap === 1 && o.aa === 'fxaa' && o.dist <= 1, 'экономия батареи: 30 кадров, без AO, тени проще, плотность 1', o);
  o = R0({ preset: 'mid', fpsCap: 45, res: 30 });
  ok(o.fpsCap === 45 && o.res === 50, 'лимит FPS и масштаб разрешения (не меньше 50%)', o);
  o = E.gfxResolve({ preset: 'high' }, { q: 'low' });
  ok(o.tier === 'high', 'пресет задаёт основу, а не устройство');
  o = E.gfxResolve({ preset: 'auto' }, { q: 'low' });
  ok(o.tier === 'low' && !o.shadows && o.ao === 'off' && o.aa === 'off' && !o.grade && o.water === 'simple', 'основа low: без теней, AO, сглаживания и цвета кадра', o);
  ok(E.gfxResolve({ preset: 'high' }, { q: 'high', gl2: false }).aa === 'fxaa', 'без WebGL2 — MSAA → FXAA');
  // лесенка автокачества: от лучшего к дешёвому, каждая ступень не дороже прошлой
  const L = E.autoSteps(R0({ preset: 'ultra' })), SQ = ['low', 'mid', 'high', 'ultra'], AO = ['off', 'on', 'high'];
  ok(L.length >= 6 && JSON.stringify(L[0]) === JSON.stringify(R0({ preset: 'ultra' })) && !L[L.length - 1].shadows, 'лесенка: от пресета до «без теней»', L.length);
  let mono = true; const RTO = ['off', 'on', 'high'];
  for (let i = 1; i < L.length; i++) { const a = L[i - 1], b = L[i]; if (AO.indexOf(b.ao) > AO.indexOf(a.ao) || SQ.indexOf(b.shadowQ) > SQ.indexOf(a.shadowQ) || RTO.indexOf(b.rt) > RTO.indexOf(a.rt) || b.dist > a.dist || (b.shadows && !a.shadows)) mono = false; }
  ok(mono, 'каждая ступень не дороже прошлой');
  ok(L[0].rt === 'high' && L[1].rt === 'on' && L[2].rt === 'off' && L[2].ao === L[0].ao, 'лесенка: сначала трассировка лучей (high → on → выкл), потом AO', L.slice(0, 3).map(x => x.rt + '/' + x.ao));
  ok(E.autoSteps(E.gfxResolve({}, { q: 'low' })).length === 1, 'на low упрощать нечего');
  // тени по качеству
  ok(['low', 'mid', 'high', 'ultra'].every((k, i, a) => !i || (E.SHADOW_Q[k].map >= E.SHADOW_Q[a[i - 1]].map && E.SHADOW_Q[k].taps > E.SHADOW_Q[a[i - 1]].taps)), 'качество теней растёт: карта и выборки');
  // графика мира: по умолчанию, проверка, пресеты
  const g = E.worldGfx();
  ok(g.grade === 'neutral' && g.bloom === 1 && g.sky.moon && g.fog.color === '' && g.water.color === '' && g.shadow.soft === E.WORLD_GFX.shadow.soft, 'графика мира по умолчанию', g);
  const bad = E.worldGfx({ sky: { haze: 9, sun: -1, moon: 0 }, fog: { density: 'x', height: 1e6, color: 'red' }, grade: 'nope', bloom: 99, exposure: -5, water: { color: '#ABCDEF', clarity: 2 }, shadow: { soft: -1 }, preset: 'zzz', junk: 1 });
  ok(bad.sky.haze === 1 && bad.sky.sun === .3 && bad.sky.moon === true && bad.fog.density === E.WORLD_GFX.fog.density && bad.fog.height === 80 && bad.fog.color === '' && bad.grade === 'neutral'
    && bad.bloom === 2.5 && bad.exposure === -1 && bad.water.color === '#abcdef' && bad.water.clarity === 1 && bad.shadow.soft === 0 && bad.preset === '' && !('junk' in bad), 'графика мира: всё проверено и в пределах', bad);
  ok(Object.keys(E.WORLD_PRESETS).join() === 'day,sunset,night,foggy,neon', 'пресеты мира: день, закат, ночь, туман, неон');
  for (const [k, p] of Object.entries(E.WORLD_PRESETS)) {
    const w = E.worldGfx({ ...p.gfx, preset: k });
    ok(w.preset === k && JSON.stringify(E.worldGfx(w)) === JSON.stringify(w) && ['time', 'brightness', 'ambient', 'fogEnd'].every(x => Number.isFinite(p.lighting[x])), 'пресет мира ' + k + ' проходит проверку без изменений');
  }
  // освещение мира: полный объект сбрасывает графику (не тянется от прошлого мира), частичный — дописывает
  const lt = { time: 14, brightness: 1, ambient: 1, fogEnd: 320, shadows: true, gfx: E.worldGfx() };
  E.mergeLighting(lt, { gfx: { grade: 'neon', sky: { haze: .8 } } });
  ok(lt.gfx.grade === 'neon' && lt.gfx.sky.haze === .8 && lt.gfx.sky.sun === 1, 'частичная графика дописывается (вложенное — тоже)');
  E.mergeLighting(lt, { time: 20 });
  ok(lt.time === 20 && lt.gfx.grade === 'neon', 'смена времени графику не трогает');
  E.mergeLighting(lt, { time: 9, brightness: 1, ambient: 1, fogEnd: 300, shadows: true });   // старый мир без gfx
  ok(lt.gfx.grade === 'neutral' && lt.gfx.sky.haze === E.WORLD_GFX.sky.haze, 'мир без графики загрузили — графика по умолчанию, не от прошлого мира');
  E.mergeLighting(lt, { time: 9, brightness: 1, ambient: 1, fogEnd: 300, gfx: { grade: 'warm' } });
  ok(lt.gfx.grade === 'warm' && lt.gfx.bloom === 1, 'мир с графикой загрузили — его графика');
  ok(JSON.parse(JSON.stringify({ ...lt })).gfx.grade === 'warm', 'графика мира сохраняется в файле (как SC.toJSON)');
  // цвет кадра
  let u = E.gradeUniforms(E.gradeOf('neutral'));
  ok(Math.abs(u.gain[0] - 1) < 1e-9 && Math.abs(u.gain[2] - 1) < 1e-9 && u.sat === 1 && u.con === 0, 'обычный цвет кадра — без изменений');
  u = E.gradeUniforms(E.gradeOf('warm'));
  ok(u.gain[0] > 1 && u.gain[2] < 1, 'тёплый: красного больше, синего меньше');
  u = E.gradeUniforms(E.gradeOf('neon'), false);
  ok(u.gain.every(x => x === 1) && u.sat === 1 && u.con === 0 && u.vig === 0, 'цвет кадра выключен игроком — без изменений');
  ok(E.gradeOf('нет такого') === E.GRADES.neutral, 'неизвестная цветокоррекция — обычная');
  // солнце и время суток
  ok(Math.abs(E.sunAt(12)[1] - Math.sin(64 * Math.PI / 180)) < 1e-9 && Math.abs(E.sunAt(6)[1]) < 1e-9 && Math.abs(E.sunAt(18)[1]) < 1e-9 && E.sunAt(0)[1] < -.8, 'солнце: восход 6, полдень выше всего (64°), закат 18');
  const circ = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); };
  ok(E.dayClock(0, 40, .2) === 6 && circ(E.dayClock(40 * 60000 * .8, 40, .2), 18) < 1e-6 && circ(E.dayClock(40 * 60000 * .9, 40, .2), 0) < 1e-6, 'общие сутки мира: ночь — пятая часть');
  let clk = true; for (let s = 0; s < 40 * 60; s += 7) { const a = E.dayClock(s * 1000, 40, .2), b = E.dayClock((s + 7) * 1000, 40, .2), d = ((b - a) % 24 + 24) % 24; if (!(d > 0 && d < 1)) clk = false; }
  ok(clk, 'время суток идёт вперёд без скачков');
  // модель неба: день, ночь, закат, без скачков
  const D = E.skyModel(13), N = E.skyModel(.5), S = E.skyModel(17.8);
  ok(D.day > .99 && D.night < .01 && D.lightI > .8 && D.light[2] > .7 && D.zen[2] > D.zen[0] && D.stars === 0 && D.sun[1] > .5, 'день: солнце высоко, свет белый, небо синее, звёзд нет', { lightI: D.lightI, light: D.light });
  ok(N.night > .99 && N.lightDir[1] >= .25 && N.lightI > .05 && N.lightI < .3 && N.stars > .5 && N.moonI > .5 && N.light[2] > N.light[0], 'ночь: светит луна (голубая, слабая), звёзды', { lightI: N.lightI, stars: N.stars });
  ok(S.dusk01 > .4 && S.light[0] > S.light[2] * 2 && S.lightI < D.lightI, 'закат: тёплый слабый свет, заря', { light: S.light, dusk: S.dusk01 });
  let smooth = true, prev = E.skyModel(0, undefined), pl = prev.lightI, ph = prev.hor.slice();
  for (let i = 1; i <= 1200; i++) { const t = i * .02, m = E.skyModel(t); if (Math.abs(m.lightI - pl) > .06 || Math.abs(m.hor[0] - ph[0]) + Math.abs(m.hor[1] - ph[1]) + Math.abs(m.hor[2] - ph[2]) > .08) { smooth = false; console.log('  скачок в', t.toFixed(2)); break; } pl = m.lightI; ph = m.hor.slice(); }
  ok(smooth, 'небо и свет меняются плавно (шаг 1,2 мин игрового времени)');
  const hz = E.skyModel(13, { haze: 1 }), clear = E.skyModel(13, { haze: 0 });
  ok(hz.hor[2] - hz.hor[0] < clear.hor[2] - clear.hor[0] && hz.glow[0] > clear.glow[0], 'дымка: горизонт белее, свечение у солнца шире');
  ok(E.skyModel(.5, { moon: false }).moonI === 0, 'без луны — нет луны');
  const out = [0, 0, 0]; E.skyColor(D, [-D.sun[0], 0, -D.sun[2]], out);
  ok(Math.abs(out[0] - D.hor[0]) < .02 && Math.abs(out[2] - D.hor[2]) < .02, 'цвет неба у горизонта (от солнца) = цвет тумана');
  ok(E.lin('#ffffff').every(x => Math.abs(x - 1) < 1e-9) && E.lin('#000000').every(x => x === 0) && Math.abs(E.lin('#808080')[0] - .2158605) < 1e-5, 'sRGB → линейный');
  const ac = E.aces([1, 1, 1], 1); ok(ac[0] > .75 && ac[0] < .85 && Math.abs(ac[0] - ac[2]) < .02, 'ACES как в three (белый → ~0,8)', ac);
}

// ═══ 12. Шейдеры three (E.gfxPatch): туман и тени — свои куски; общие данные — по ссылке у всех материалов ═══
{
  const C = T.ShaderChunk, sh0 = C.shadowmap_pars_fragment;
  ok(E.gfxPatch(T) === true && E.gfxPatch(T) === true, 'правка кусков шейдеров — один раз, повтор безопасен');
  ok(C.fog_fragment.includes('d37FogA') && C.fog_pars_fragment.includes('uniform vec4 d37FogB') && C.fog_vertex.includes('vD37Fog = mvPosition.xyz') && C.fog_pars_vertex.includes('varying vec3 vD37Fog'), 'туман: высотный и к солнцу');
  const shp = C.shadowmap_pars_fragment;
  ok(shp.includes('d37Pcf') && shp.split('float getShadow(').length === 2 && shp.split('vec2 cubeToUV(').length === 2 && shp.includes('getPointShadow') && shp.length > sh0.length * .5, 'тени: getShadow заменена один раз, остальное на месте');
  ok(E.patchShadowChunk(shp) === shp, 'повторная правка теней ничего не меняет');
  for (const k of ['standard', 'physical', 'lambert', 'phong', 'toon', 'basic', 'sprite', 'points']) ok(T.ShaderLib[k].uniforms.d37FogA?.value === E.GFXU.fogA, 'общие данные тумана у ' + k);
  ok(T.ShaderLib.standard.uniforms.d37Sh.value === E.GFXU.sh && !T.ShaderLib.basic.uniforms.d37Sh, 'данные теней — у материалов со светом');
  const cl = T.UniformsUtils.clone(T.ShaderLib.standard.uniforms);
  ok(cl.d37FogA.value === E.GFXU.fogA && cl.d37Sh.value === E.GFXU.sh, 'копия uniform (как в three при сборке) — тот же массив: одно обновление на все материалы');
  // GLSL: #if/#endif и скобки сходятся; #include — только с новой строки (иначе шейдер не собирается)
  const bal = (s, a, b) => (s.match(a) || []).length === (s.match(b) || []).length;
  const ifs = s => bal(s, /#if(n?def)?\b/g, /#endif\b/g);
  for (const [n, s] of [['fog_fragment', C.fog_fragment], ['fog_pars_fragment', C.fog_pars_fragment], ['fog_vertex', C.fog_vertex], ['fog_pars_vertex', C.fog_pars_vertex], ['shadowmap_pars_fragment', shp]])
    ok(ifs(s) && bal(s, /\{/g, /\}/g) && bal(s, /\(/g, /\)/g), 'GLSL ' + n + ': #if/#endif и скобки');
  const sky = E.skyMaterial(T), env = E.skyMaterial(T, true);
  const inc = s => s.split('\n').every(l => !l.includes('#include') || /^\s*#include <\w+>\s*$/.test(l));
  ok(inc(sky.fragmentShader) && inc(sky.vertexShader) && bal(sky.fragmentShader, /\{/g, /\}/g) && bal(sky.fragmentShader, /\(/g, /\)/g), 'купол неба: #include с новой строки, скобки');
  ok(sky.vertexShader.includes('p.w * 0.99999') && !env.vertexShader.includes('0.99999') && sky.depthTest && !env.depthTest, 'купол — на дальней плоскости; для отражений — без этого');
  const M = E.skyModel(13); E.skyUniforms(sky.uniforms, M, 5);
  ok(Math.abs(sky.uniforms.uZen.value.b - M.zen[2]) < 1e-6 && sky.uniforms.uP.value.w === 5, 'модель неба → uniform купола');
  // вода v2: правка стандартного материала (сборка шейдера — как в three, кусками)
  const fakeR = { T, waterU: { uTime: { value: 0 }, uClear: { value: .5 }, uFoam: { value: .5 }, uWQ: { value: 1 } }, normalFrom: () => new T.Texture() };
  const wm = E.waterMaterial(fakeR, '#3aa6dc', { depth: { tex: new T.Texture(), rect: [0, 0, 10, 10] } });
  const shd = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader, fragmentShader: T.ShaderLib.standard.fragmentShader };
  wm.onBeforeCompile(shd);
  ok(shd.fragmentShader.includes('wDepth') && shd.fragmentShader.includes('foam') && shd.fragmentShader.includes('tDep'), 'вода: глубина, пена, дно в шейдере');
  ok(!shd.fragmentShader.includes('#include <normal_fragment_maps>') && shd.fragmentShader.includes('vD37W.xz'), 'вода: нормаль — своя (рябь по миру)');
  ok(shd.fragmentShader.includes('#include <alphamap_fragment>\n') && shd.fragmentShader.includes('#include <output_fragment>\n') && shd.vertexShader.includes('vD37W ='), 'вода: куски three на месте, #include — с новой строки');
  ok(shd.uniforms.uWQ === fakeR.waterU.uWQ && shd.uniforms.tDep && wm.defines.D37_WDEPTH && wm.userData.water && wm.userData.noCast, 'вода: общие данные мира (качество, пена) и дно');
}

// ═══ 13. Настройки игрока (js/core/settings.js + gfx-settings.js): перенос d37_gfx, «Своя», пресеты, D37Opt.gfx ═══
{
  store.d37_gfx = 'high'; store.d37_settings = JSON.stringify({ _v: 1, shadows: true });
  globalThis.D37Opt = undefined;
  for (const f of ['js/core/settings.js', 'js/core/gfx-settings.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
  const S = globalThis.D37Settings, O = () => globalThis.D37Opt;
  ok(S && S.gfxExt && JSON.stringify(S.gfxExt.PRESETS) === JSON.stringify(E.GFX_PRESETS), 'пресеты в настройках = пресеты движка');
  ok(S.get('gfxPreset') === 'high' && O().gfx.preset === 'high', 'перенос: был d37_gfx = high — пресет «Высокая»');
  const rev0 = O().rev;
  S.set('ao', 'high', { ui: true });
  ok(S.get('gfxPreset') === 'custom' && S.get('ao') === 'high' && S.get('shadowQ') === 'high' && S.get('aa') === 'msaa' && S.get('dist') === 1.25, 'тронул AO — «Своя» с остальным как было в «Высокой»');
  ok(O().gfx.preset === 'custom' && O().gfx.ao === 'high' && O().rev > rev0, 'на живую: D37Opt.gfx и rev');
  let r = E.gfxResolve({ ...O().gfx, shadows: O().shadows }, { q: 'high' });
  ok(r.ao === 'high' && r.shadowQ === 'high' && r.preset === 'custom', 'движок получает «Своя» как выбрано');
  S.set('gfxPreset', 'low', { ui: true });
  ok(S.get('gfx') === 'low' && store.d37_gfx === 'low' && S.get('ao') === 'off' && S.get('water') === 'simple', 'пресет «Низкая»: основа low (d37_gfx), мелочи — как в пресете');
  S.set('gfxPreset', 'ultra', { ui: true });
  ok(S.get('gfx') === 'high' && S.get('shadowQ') === 'ultra' && S.get('shadows') === true, 'пресет «Ультра»: основа high');
  S.set('gfxPreset', 'auto', { ui: true });
  ok(S.get('gfx') === 'auto' && store.d37_gfx === undefined, 'пресет «Авто»: основа по устройству (d37_gfx убран)');
  S.set('fpsCap', '60', { ui: true }); S.set('battery', true, { ui: true }); S.set('res', 70, { ui: true });
  ok(O().gfx.fpsCap === 60 && O().gfx.battery === true && O().gfx.res === 70 && S.get('gfxPreset') === 'auto', 'лимит FPS, батарея, масштаб — не делают пресет «Своим»');
  r = E.gfxResolve({ ...O().gfx, shadows: O().shadows }, { q: 'mid' });
  ok(r.fpsCap === 30 && r.res === 70 && r.prCap === 1, 'экономия батареи сильнее лимита 60', r);
  S.set('fpsCap', 'x'); ok(S.get('fpsCap') === '0', 'лимит FPS: неверное — без лимита');
  S.reset();
  ok(O().gfx.preset === 'auto' && O().gfx.battery === false && S.get('gfx') === 'auto', '«Сбросить всё» — графика по умолчанию');
}

// ═══ 14. Лимит FPS (core.js E.loop) и автоматы разрешения: потолок и пауза ═══
{
  const q0 = globalThis.requestAnimationFrame;
  let cb = null; globalThis.requestAnimationFrame = f => { cb = f; return 1; }; globalThis.cancelAnimationFrame = () => { cb = null; };
  const run = (cap, hz, secs) => {
    E.fpsCap = cap; let frames = 0, steps = 0, now = 0;
    const lp = E.loop(() => { steps++; }, () => { frames++; });
    for (let i = 0; i < hz * secs; i++) { now += 1000 / hz; const f = cb; cb = null; f(now); }
    lp.stop(); E.fpsCap = 0;
    return { frames, steps };
  };
  let rr = run(30, 60, 10);
  ok(Math.abs(rr.frames - 300) <= 3 && Math.abs(rr.steps - 600) <= 6, 'лимит 30 на экране 60 Гц: 30 кадров/с, логика — 60 шагов/с', rr);
  rr = run(60, 144, 10);
  ok(rr.frames >= 560 && rr.frames <= 640, 'лимит 60 на экране 144 Гц ≈ 60 кадров/с', rr);
  rr = run(0, 60, 5);
  ok(rr.frames === 300, 'без лимита — каждый кадр');
  globalThis.requestAnimationFrame = q0;
  const D = E.dynRes({ max: .8 });
  D.set(1); ok(D.scale === .8, 'масштаб разрешения — потолок динамического');
  let t = 0; for (let i = 0; i < 600; i++) { t += 16.7; D.tick(16.7, 3, t); }
  ok(D.scale <= .8, 'запас есть — но не выше потолка', D.scale);
  const D2 = E.dynRes(); D2.hold(3000, 0); t = 0; for (let i = 0; i < 150; i++) { t += 30; D2.tick(30, 3, t); }
  ok(D2.scale === 1, 'пока «ждём» (второй автомат сменил своё) — не меняем', D2.scale);
  const D3 = E.dynRes({ min: 0, step: 1 / 6 }); D3.set(0); ok(D3.scale === 0, 'ступени автокачества: 0 — самая дешёвая');
}

// ═══ 15. «Рябь на полу» (15.10.2026) не возвращается: тени без шума по экрану, наклон приёмника; AO — размытие по плоскости,
//     глубина сцены — 24 бита. Формулы берутся прямо из текста шейдеров и считаются здесь на числах ═══
{
  const shp = T.ShaderChunk.shadowmap_pars_fragment, gs = shp.slice(shp.indexOf('uniform vec4 d37Sh;'), shp.indexOf('vec2 cubeToUV('));
  ok(gs.length > 500 && !gs.includes('gl_FragCoord'), 'тени: без шума по пикселям экрана (он ползал при движении — рябь на полу)');
  ok(/float d37Bil\(/.test(gs) && (gs.match(/d37Cmp\( map,/g) || []).length === 4 && gs.includes('s += d37Bil( map, size,'), 'тени: каждая выборка — 2×2 текселя с весами');
  const iV = gs.indexOf('#if __VERSION__ >= 300'), iD = gs.indexOf('dFdx( shadowCoord'), iF = gs.indexOf('if ( frustumTest )');
  ok(iV >= 0 && iD > iV && iD < iF && !/GL_OES_standard_derivatives/.test(gs), 'тени: наклон приёмника — по производным, только WebGL2, до ветвлений');
  ok(/rad = clamp\( sum \/ cnt \* d37Sh\.z, rad \* 0\.5, rad \* 2\.5 \)/.test(gs), 'PCSS: полутень от ½ до 2,5 радиуса (у самой заслонки — без «лесенки» текселей)');
  // наклон приёмника: формула из шейдера по производным (u, v, z) восстанавливает наклон плоскости при любом виде с экрана
  const mDet = /float det = ([^;]+);/.exec(gs), mG = /g = vec2\( ([^,]+), ([^)]+) \) \/ det;/.exec(gs);
  ok(!!(mDet && mG), 'тени: формула наклона найдена в шейдере');
  if (mDet && mG) {
    const fDet = new Function('cx', 'cy', 'return ' + mDet[1]), fx = new Function('cx', 'cy', 'return ' + mG[1]), fy = new Function('cx', 'cy', 'return ' + mG[2]);
    let worst = 0;
    for (let k = 0; k < 200; k++) {
      const gx = (Math.random() - .5) * 8, gy = (Math.random() - .5) * 8;   // dz/du, dz/dv плоскости
      const a = [(Math.random() - .5) * 1e-3, (Math.random() - .5) * 1e-3], b = [(Math.random() - .5) * 1e-3, (Math.random() - .5) * 1e-3];   // du,dv по x и y экрана
      if (Math.abs(a[0] * b[1] - a[1] * b[0]) < 1e-8) continue;
      const cx = { x: a[0], y: a[1], z: gx * a[0] + gy * a[1] }, cy = { x: b[0], y: b[1], z: gx * b[0] + gy * b[1] }, det = fDet(cx, cy);
      worst = Math.max(worst, Math.abs(fx(cx, cy) / det - gx), Math.abs(fy(cx, cy) / det - gy));
    }
    ok(worst < 1e-6, 'тени: наклон приёмника из производных — точный (иначе низкое солнце даёт полосы)', worst);
  }
  // постобработка на подставном рендерере: какие проходы, куда пишут, что читает сборка кадра
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/post.js'), 'utf8'), { filename: 'post.js' });
  let cur = null; const log = [];
  const r = { extensions: { has: () => true }, capabilities: { isWebGL2: true }, autoClear: true, info: { render: { calls: 0 } },
    getDrawingBufferSize: v => v.set(800, 450), setRenderTarget: t => { cur = t; },
    render: (scene) => { const m = scene.children[0] && scene.children[0].material, u = m && m.uniforms; log.push({ t: cur, m, fs: m && m.fragmentShader, tex: u && u.uTexel && u.uTexel.value.clone(), src: u && u.tSrc && u.tSrc.value, ao: u && u.tAO && u.tAO.value }); } };
  const P = E.post({ T, r, q: 'high', stats: {}, pr0: 1 });
  const cam = new T.PerspectiveCamera(50, 16 / 9, .2, 400); cam.updateProjectionMatrix();
  const frame = () => { log.length = 0; P.render(new T.Scene(), cam); return log.slice(); };
  P.setOpts({ ao: 'off', aa: 'fxaa' }); P.setSize(800, 450, 1);
  let L = frame();
  ok(!P.ao.on && L[0].t && L[0].t.depthTexture && L[0].t.depthTexture.type === T.UnsignedIntType, 'глубина сцены — 24 бита (текстурой) и без AO: тонкие слои пола не путаются', { on: P.ao.on });
  ok(!L.some(x => x.fs && x.fs.includes('perspectiveDepthToViewZ(texture2D(tDepth, uv)')), 'AO выключен — проходов AO нет (текстура глубины его не включает)');
  P.setOpts({ ao: 'on', aa: 'fxaa' });
  L = frame();
  const iAO = L.findIndex(x => x.fs && x.fs.includes('uAO')), b1 = L[iAO + 1], b2 = L[iAO + 2], comp = L.find(x => x.ao !== undefined && x.fs && x.fs.includes('aoUp'));
  ok(P.ao.on && iAO > 0 && L[iAO].t && b1 && b2 && b1.m === b2.m && b1.src === L[iAO].t.texture && b2.src === b1.t.texture, 'AO: расчёт → размытие вдоль → поперёк', iAO);
  ok(b1 && b2 && b1.tex.x > 0 && b1.tex.y === 0 && b2.tex.x === 0 && b2.tex.y > 0, 'AO: два прохода размытия — по x и по y');
  ok(comp && b2 && comp.ao === b2.t.texture, 'сборка кадра берёт AO после обоих проходов');
  const fsAO = L[iAO].fs, fsB = b1 && b1.fs;
  ok(!/mod\(floor\(gl_FragCoord\.xy\), 4\.0\)/.test(fsAO) && fsAO.includes('52.9829189'), 'AO: поворот — свой у пикселя, без узора 4×4 (он оставался полосами)');
  // вес размытия из шейдера: на полу под острым углом (1/глубины меняется линейно) соседи не отбрасываются, на краю предмета — да
  const mK = fsB && /float k = ([^;]+);/.exec(fsB), mW = fsB && /float wa = ([^;]+);/.exec(fsB);
  ok(!!(mK && mW), 'AO: формулы веса найдены в шейдере размытия');
  if (mK && mW) {
    const js = s => s.replace(/\bmax\(/g, 'Math.max(').replace(/\babs\(/g, 'Math.abs(');
    const fK = new Function('wc', 'wl', 'wr', 'return ' + js(mK[1])), fW = new Function('wg', 'a', 'wc', 'k', 'fi', 'return ' + js(mW[1]));
    const blurW = z => {   // z(i) — глубина соседа i (i = −4…4); доля веса Гаусса, которую размытие оставляет
      const wc = 1 / z(0), k = fK(wc, 1 / z(-1), 1 / z(1));
      let got = 0, all = 0; for (let i = 1; i <= 4; i++) { const wg = Math.exp(-i * i * .1); got += fW(wg, { y: z(i) }, wc, k, i) + fW(wg, { y: z(-i) }, wc, -k, i); all += 2 * wg; }
      return got / all;
    };
    let floorMin = 1;
    for (const [z0, step] of [[3, .05], [8, .4], [25, 2], [60, 6], [140, 15]]) {   // пол: от «под ногами» до «у горизонта»
      const w0 = 1 / z0, dw = 1 / (z0 + step) - w0;
      floorMin = Math.min(floorMin, blurW(i => 1 / (w0 + dw * i)));
    }
    ok(floorMin > .9, 'AO: на полу под углом размытие берёт соседей (было: отбрасывало — полосы, «лесенка»)', floorMin);
    // в 2 пикселях — край стула (на 25% ближе): его выборки не берутся, остальные — да
    const edge = blurW(i => i >= 2 ? 6 : 8), keep = 1 - (Math.exp(-.4) + Math.exp(-.9) + Math.exp(-1.6)) / (2 * [1, 2, 3, 4].reduce((s, i) => s + Math.exp(-i * i * .1), 0));
    ok(Math.abs(edge - keep) < .01, 'AO: через край предмета не размывает', { edge, keep });
  }
  P.dispose();
}

// ═══ 16. NVIDIA Image Scaling (NIS) — перенос NVScaler / NVSharpen (post.js): таблицы фильтров сверены с таблицами NVIDIA
//     в половинной точности (NIS_Config.h coef_scale_fp16 / coef_usm_fp16 — MIT © 2022 NVIDIA CORPORATION & AFFILIATES),
//     константы NVScalerUpdateConfig, шейдеры, проходы; эталон на JS (scripts/nis-ref.cjs) — свойства картинки ═══
{
  const N = E.NIS, ROWS = 64;
  ok(N && N.scale.length === ROWS * 6 && N.usm.length === ROWS * 6, 'NIS: таблицы 64 фазы × 6 отводов');
  // fp16 (биты half) из NIS_Config.h — 6 отводов на фазу (7-й и 8-й — нули)
  const F16S = [[0, 0, 15360, 0, 0, 0], [6640, 41601, 15360, 8898, 39671, 0], [7796, 42592, 15357, 9955, 40695, 0], [8321, 43167, 15351, 10576, 41286, 4121], [8702, 43537, 15346, 11058, 41797, 4121],
    [9029, 43871, 15339, 11408, 42146, 4121], [9280, 44112, 15328, 11672, 42402, 5145], [9411, 44256, 15316, 11944, 42690, 5669], [9535, 44401, 15304, 12216, 42979, 6169], [9667, 44528, 15288, 12396, 43137, 6378],
    [9758, 44656, 15273, 12540, 43282, 6640], [9857, 44768, 15255, 12688, 43423, 6903], [9922, 44872, 15235, 12844, 43583, 7297], [10014, 44959, 15213, 13000, 43744, 7429], [10079, 45048, 15190, 13156, 43888, 7691],
    [10112, 45092, 15167, 13316, 44040, 7796], [10178, 45124, 15140, 13398, 44120, 8058], [10211, 45152, 15112, 13482, 44201, 8256], [10211, 45180, 15085, 13566, 44279, 8387], [10242, 45200, 15054, 13652, 44360, 8518],
    [10242, 45216, 15023, 13738, 44440, 8636], [10242, 45228, 14990, 13826, 44520, 8767], [10242, 45236, 14955, 13912, 44592, 8964], [10211, 45244, 14921, 14002, 44673, 9082], [10178, 45244, 14885, 14090, 44745, 9213],
    [10145, 45244, 14849, 14178, 44817, 9280], [10112, 45236, 14810, 14266, 44887, 9378], [10079, 45228, 14770, 14346, 44953, 9437], [10014, 45216, 14731, 14390, 45017, 9503], [9981, 45204, 14689, 14434, 45064, 9601],
    [9922, 45188, 14649, 14478, 45096, 9667], [9857, 45168, 14607, 14521, 45120, 9726], [9791, 45144, 14564, 14564, 45144, 9791]];
  const F16U = [[0, 47309, 15565, 47309, 0, 0], [6640, 47326, 15563, 47289, 39408, 0], [7429, 47339, 15560, 47266, 40695, 4121], [8058, 47349, 15554, 47239, 41286, 0], [8387, 47357, 15545, 47209, 41915, 0],
    [8636, 47363, 15534, 47176, 42238, 4121], [8767, 47364, 15522, 47141, 42657, 4121], [9029, 47367, 15509, 47105, 43023, 4121], [9213, 47363, 15490, 47018, 43249, 4121], [9280, 47357, 15472, 46928, 43472, 5145],
    [9345, 47347, 15450, 46836, 43727, 5145], [9378, 47337, 15427, 46736, 43999, 5669], [9437, 47323, 15401, 46630, 44152, 5669], [9470, 47310, 15376, 46520, 44312, 6169], [9503, 47294, 15338, 46402, 44479, 6378],
    [9503, 47272, 15274, 46280, 44648, 6640], [9503, 47253, 15215, 46158, 44817, 6903], [9503, 47231, 15150, 45972, 45017, 7165], [9535, 47206, 15082, 45708, 45132, 7297], [9503, 47180, 15012, 45432, 45232, 7429],
    [9470, 47153, 14939, 45152, 45332, 7560], [9470, 47126, 14868, 44681, 45444, 7691], [9437, 47090, 14793, 44071, 45560, 7796], [9411, 47030, 14714, 42847, 45668, 7927], [9411, 46968, 14635, 8387, 45788, 8058],
    [9345, 46902, 14552, 10786, 45908, 8256], [9313, 46846, 14478, 11647, 46036, 8321], [9247, 46776, 14394, 12292, 46120, 8453], [9247, 46714, 14288, 12620, 46184, 8518], [9147, 46648, 14130, 12936, 46248, 8570],
    [9029, 46576, 13956, 13268, 46312, 8702], [8964, 46512, 13792, 13456, 46378, 8767], [8898, 46446, 13624, 13624, 46446, 8898]];
  const half = b => { const s = b & 0x8000 ? -1 : 1, e = (b >> 10) & 31, m = b & 1023; return e === 0 ? s * m * Math.pow(2, -24) : s * (1 + m / 1024) * Math.pow(2, e - 15); };
  let worst = 0, sym = 0, sumS = 0, sumU = 0;
  for (let ph = 0; ph < ROWS; ph++) {
    // фазы 33…63 у NVIDIA — зеркало 31…1 (проверяем и это)
    const src = ph <= 32 ? ph : 64 - ph, rev = ph > 32;
    for (let t = 0; t < 6; t++) {
      const tt = rev ? 5 - t : t;
      worst = Math.max(worst, Math.abs(N.scale[ph * 6 + t] - half(F16S[src][tt])), Math.abs(N.usm[ph * 6 + t] - half(F16U[src][tt])));
      if (ph >= 1) sym = Math.max(sym, Math.abs(N.scale[ph * 6 + t] - N.scale[(64 - ph) % 64 * 6 + 5 - t] * (ph === 0 ? 0 : 1)));
    }
    let s = 0, u = 0; for (let t = 0; t < 6; t++) { s += N.scale[ph * 6 + t]; u += N.usm[ph * 6 + t]; }
    sumS = Math.max(sumS, Math.abs(s - 1)); sumU = Math.max(sumU, Math.abs(u));
  }
  ok(worst < 6e-4, 'NIS: таблицы = таблицы NVIDIA (сверка с fp16 из NIS_Config.h)', worst);
  ok(sym < 1e-9, 'NIS: фазы зеркальны (64 − k = k наоборот)', sym);
  ok(sumS < .0025 && sumU < .0025, 'NIS: увеличение сохраняет яркость (сумма = 1), резкость — без сдвига (сумма = 0)', { sumS, sumU });
  // константы (NVScalerUpdateConfig, SDR)
  const c5 = E.nisConfig(.5), c0 = E.nisConfig(0), c1 = E.nisConfig(1), near = (a, b) => Math.abs(a - b) < 1e-6;
  ok(near(c5.kDetectRatio, 2 * 1127 / 1024) && near(c5.kDetectThres, 64 / 1024) && near(c5.kRatioNorm, 1 / 8) && near(c5.kEps, 1 / 255) && near(c5.kSharpScaleY, 1 / .45), 'NIS: постоянные как у NVIDIA');
  ok(near(c5.kSharpStrengthMin, .4) && near(c5.kSharpStrengthScale, 1.2) && near(c5.kSharpLimitMin, .14) && near(c5.kSharpLimitScale, .36), 'NIS: резкость 50% — середина шкалы NVIDIA', c5);
  ok(near(c0.kSharpStrengthMin, 0) && near(c0.kSharpStrengthScale, 1.6 - .5 * 1.75 * 1.8) && near(c0.kSharpLimitMin, .1) && near(c1.kSharpStrengthMin, .4 + .5 * 1.25 * 1.2) && near(c1.kSharpLimitScale, .5 + .5 * 1.25 * .6 - (.14 + .5 * 1.25 * .32)), 'NIS: 0% и 100% — по формулам NVScalerUpdateConfig', { c0, c1 });
  ok(E.nisConfig(-3).kSharpStrengthMin === c0.kSharpStrengthMin && E.nisConfig(9).kSharpStrengthMin === c1.kSharpStrengthMin, 'NIS: резкость за пределами 0…1 — по краю');
  // шейдеры: окно 6×6 / 5×5, карта краёв, 4 направления, таблицы — из текстуры
  const fsN = N.fs.scaler, fsS = N.fs.sharpen;
  ok((fsN.match(/= nL\(b \+ ivec2/g) || []).length === 36 && (fsN.match(/nEdge\(p/g) || []).length === 4 && fsN.includes('texelFetch(tCoef') && ['if (w.x > 0.0)', 'if (w.y > 0.0)', 'if (w.z > 0.0)', 'if (w.w > 0.0)'].every(s => fsN.includes(s)), 'NIS-шейдер: окно 6×6, края в 4 точках, 4 направления, таблицы — текстурой');
  ok((fsS.match(/= nL\(b \+ ivec2/g) || []).length === 25 && (fsS.match(/nUsm\(/g) || []).length >= 5 && fsS.includes('nEdge(p11, p12, p13, p21, p22, p23, p31, p32, p33)'), 'NIS-резкость: окно 5×5, 4 направления USM, края по середине');
  const bal = (s, a, b) => (s.match(a) || []).length === (s.match(b) || []).length;
  ok(bal(fsN, /\{/g, /\}/g) && bal(fsN, /\(/g, /\)/g) && bal(fsS, /\{/g, /\}/g) && bal(fsS, /\(/g, /\)/g), 'NIS-шейдеры: скобки сходятся');
  // эталон NVIDIA на JS: ровное остаётся ровным, резкость ограничена и растёт с ползунком
  const ref = require('./nis-ref.cjs')(E);
  const W = 24, H = 16, flat = new Float32Array(W * H * 3).fill(.42);
  const fl = ref.scale(flat, W, H, 37, 25, 1), fs2 = ref.sharpen(flat, W, H, 1);
  ok(fl.every(v => Math.abs(v - .42) < 1e-4) && fs2.every(v => Math.abs(v - .42) < 1e-6), 'NIS: ровная картинка остаётся ровной (и при 100% резкости)');
  const step = new Float32Array(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) step.fill(x < 12 ? .2 : .8, (y * W + x) * 3, (y * W + x) * 3 + 3);
  const prof = s => { const o = ref.scale(step, W, H, 36, 24, s), row = []; for (let x = 0; x < 36; x++) row.push(o[(12 * 36 + x) * 3 + 1]); return row; };
  const p0 = prof(0), p1 = prof(1), over = r => Math.max(...r) - .8, under = r => .2 - Math.min(...r);
  ok(over(p1) > over(p0) - 1e-6 && over(p1) < .2 && under(p1) < .2 && p1.every(v => v >= 0 && v <= 1), 'NIS: край ступеньки — резче на 100%, но без «звона» больше предела', { over0: over(p0), over1: over(p1) });
  ok(Math.abs(p1[2] - .2) < .01 && Math.abs(p1[33] - .8) < .01, 'NIS: вдали от края цвет не меняется');
  // проходы на подставном рендерере: уменьшенный кадр → NIS / FSR / просто; полный — резкость NIS
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/post.js'), 'utf8'), { filename: 'post.js' });
  let cur = null; const log = [];
  const r = { extensions: { has: () => true }, capabilities: { isWebGL2: true }, autoClear: true, info: { render: { calls: 0 } },
    getDrawingBufferSize: v => v.set(1000, 500), setRenderTarget: t => { cur = t; }, render: s => { log.push({ t: cur, fs: s.children[0]?.material?.fragmentShader || '' }); } };
  const R0 = { T, r, q: 'high', stats: {}, pr0: 1 }, P = E.post(R0);
  const cam = new T.PerspectiveCamera(50, 2, .2, 400); cam.updateProjectionMatrix();
  const passes = (up, sharp, scaled) => { P.setOpts({ ao: 'off', aa: 'fxaa', upscaler: up, sharp }); P.setSize(scaled ? 670 : 1000, scaled ? 335 : 500, scaled ? .67 : 1); log.length = 0; P.render(new T.Scene(), cam); return log.slice(1); };
  const kind = x => x.fs.includes('nPoly(') ? 'nis' : x.fs.includes('nUsm(') ? 'nisS' : x.fs.includes('eTap(') ? 'easu' : x.fs.includes('hitMin') ? 'rcas' : x.fs.includes('dir = clamp(dir * rcp') ? 'fxaa' : x.fs.includes('aoUp()') ? 'comp' : 'другое';
  const seq = (up, sh, sc) => passes(up, sh, sc).filter(x => kind(x) !== 'другое').map(x => kind(x) + (x.t ? '' : '→экран')).join(' ');
  ok(seq('nis', .5, true) === 'comp nis→экран', 'уменьшенный кадр + NIS: сборка → NVScaler на экран', seq('nis', .5, true));
  ok(seq('fsr', .5, true) === 'comp easu rcas→экран' && seq('fsr', 0, true) === 'comp easu→экран', 'уменьшенный кадр + FSR: EASU → RCAS (резкость 0 — без RCAS)', seq('fsr', 0, true));
  ok(seq('off', .5, true) === 'comp fxaa→экран', 'апскейлер выключен — просто растянуть (сглаживание FXAA)', seq('off', .5, true));
  ok(seq('nis', .5, false) === 'comp fxaa nisS→экран' && seq('nis', 0, false) === 'comp fxaa→экран' && seq('fsr', .5, false) === 'comp fxaa→экран', 'полный кадр: у NIS — резкость после FXAA (0% — без неё), у FSR — как было', seq('nis', .5, false));
  P.setOpts({ upscaler: 'nis', sharp: .5 }); P.setSize(670, 335, .67); log.length = 0; P.render(new T.Scene(), cam);
  const nisPass = P._test.M.nis.uniforms;
  ok(nisPass.uIn.value.x === 670 && nisPass.uOut.value.x === 1000 && Math.abs(nisPass.uK2.value.x - .4) < 1e-6, 'NIS: размеры входа/выхода и резкость — в шейдер');
  const g = E.gfxResolve({ upscaler: 'nis', sharp: 80 }, { q: 'high' }), g2 = E.gfxResolve({ upscaler: 'dlss', sharp: 500 }, { q: 'mid' });
  ok(g.upscaler === 'nis' && g.sharp === .8 && g2.upscaler === 'fsr' && g2.sharp === 1, 'настройки: апскейлер и резкость проверяются');
  P.dispose();
}

// ═══ 17. «Трассировка лучей» (gfx.js + post.js): код блеска в альфе, мокрое, отражения в экране, контактные тени ═══
{
  const C = T.ShaderChunk;
  ok(C.output_fragment.includes('#if defined( STANDARD ) && defined( OPAQUE )') && C.output_fragment.includes('d37Rt.y > 0.5'), 'код блеска: только стандартные непрозрачные и только пока трассировка рисует свой буфер');
  ok(C.normal_fragment_maps.includes('#ifdef STANDARD') && C.normal_fragment_maps.includes('geometryNormal') && C.roughnessmap_pars_fragment.includes('uniform vec4 d37Rt;'), 'мокрое: по геометрической нормали, данные — только у стандартных');
  ok(T.ShaderLib.standard.uniforms.d37Rt?.value === E.GFXU.rt && T.ShaderLib.physical.uniforms.d37Rt?.value === E.GFXU.rt && !T.ShaderLib.lambert.uniforms.d37Rt, 'данные трассировки — общий массив у стандартных материалов');
  // код блеска: туда и обратно, и пороги — как в шейдере отражений
  let rtOk = true;
  for (const [ro, me] of [[.1, 0], [.3, 1], [.5, 0], [.05, 1], [.2, 0]]) { const a = E.rtEncode(ro, me), d = E.rtDecode(a); if (!d.kind || (me > .5) !== (d.kind === 'metal') || d.gloss <= 0) rtOk = false; }
  ok(rtOk && E.rtEncode(.9, 0) === 1 && E.rtDecode(1).kind === null && E.rtDecode(0).kind === 'clear' && E.rtDecode(1.5).kind === null, 'код блеска: гладкое / металл / вода и стекло / обычное / свечение различаются');
  ok(E.rtDecode(.5).kind === null, 'край воды при MSAA (альфа ~0,5) — не блестит (зазор в коде)');
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/post.js'), 'utf8'), { filename: 'post.js' });
  const fsS = E.RT_FS.ssr;
  ok(fsS.includes('a < 0.25') && fsS.includes('a >= 0.875') && fsS.includes('/ 0.12') && fsS.includes('uStride') && !/gl_FragCoord|fract\(52\.98/.test(fsS), 'шейдер отражений: те же пороги кода; шаги ровные, без шума по экрану');
  ok(!/texture2D\(tDepth, uv\)/.test(fsS) && fsS.includes('textureLod(tDepth'), 'глубина в циклах — textureLod (без производных в цикле)');
  // вода и стекло: метка в альфе — смешиванием (ноль), обратно — обычное
  const wm = new T.MeshStandardMaterial({ transparent: true });
  E.rtMark(T, wm, true);
  ok(wm.blending === T.CustomBlending && wm.blendSrc === T.SrcAlphaFactor && wm.blendDst === T.OneMinusSrcAlphaFactor && wm.blendSrcAlpha === T.ZeroFactor && wm.blendDstAlpha === T.ZeroFactor, 'вода/стекло: цвет смешивается как обычно, альфа буфера — 0');
  E.rtMark(T, wm, false); ok(wm.blending === T.NormalBlending, 'трассировка выключена — обычное смешивание');
  ok(E.rtMark(T, new T.MeshStandardMaterial(), true).blending === T.NormalBlending, 'непрозрачное не трогаем');
  // проходы на подставном рендерере
  let cur = null; const log = [];
  const r = { extensions: { has: () => true }, capabilities: { isWebGL2: true }, autoClear: true, info: { render: { calls: 0 } },
    getDrawingBufferSize: v => v.set(800, 450), setRenderTarget: t => { cur = t; },
    render: s => { const m = s.children[0]?.material; log.push({ t: cur, fs: m?.fragmentShader || '', mark: E.GFXU.rt[1], u: m?.uniforms }); } };
  const marks = [];
  const R0 = { T, r, q: 'high', stats: {}, pr0: 1, sunDir: new T.Vector3(.3, .8, .2).normalize(), sky: { lightI: 1, night: 0 }, lighting: { gfx: E.worldGfx({ rt: { refl: 1.5 } }) }, rtMarkAll: on => marks.push(on) };
  const P = E.post(R0);
  const cam = new T.PerspectiveCamera(50, 16 / 9, .2, 400); cam.position.set(0, 3, 8); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  P.setOpts({ ao: 'off', aa: 'fxaa', rt: 'on' }); P.setSize(800, 450, 1);
  ok(P.rt.on && P.ao.on && marks[marks.length - 1] === true, 'трассировка: отражения + проход контактных теней (и без AO); вода и стекло помечены');
  log.length = 0; P.render(new T.Scene(), cam);
  const kind = x => x.fs.includes('uniform float uStride') ? 'ssr' : x.fs.includes('uniform vec4 uCS') ? 'ao' : x.fs.includes('s += a.xz * wa') ? 'blur' : x.fs.includes('aoUp()') ? 'comp' : x.fs ? 'другое' : 'сцена';
  const seq = log.map(kind).filter(k => k !== 'другое');
  ok(seq.join(' ').startsWith('сцена ssr ao blur blur') && seq.includes('comp'), 'проходы: сцена → отражения → AO с контактными тенями → размытие ×2 → сборка', seq.join(' '));
  ok(log[0].mark === 1 && log.slice(1).every(x => x.mark === 0) && E.GFXU.rt[1] === 0, 'код блеска пишется только при рисовании сцены в буфер (потом — 0: холст и другие рендереры не трогает)');
  const ssrL = log.find(x => kind(x) === 'ssr'), aoL = log.find(x => kind(x) === 'ao'), comp = log.find(x => kind(x) === 'comp');
  ok(ssrL.u.uSSR.value.z === 1.5 && ssrL.u.uSSR.value.x === P.rt.steps && ssrL.u.uStride.value === 3, 'сила отражений — из графики мира, шаг 3 пикселя');
  const cs = aoL.u.uCS.value, sv = R0.sunDir.clone().transformDirection(cam.matrixWorldInverse);
  ok(Math.abs(cs.x - sv.x) < 1e-6 && Math.abs(cs.y - sv.y) < 1e-6 && cs.w > 0 && aoL.u.uAO.value.z === 0, 'контактные тени: солнце в координатах камеры; AO выключен — сила AO 0');
  ok(comp.u.uSSRk.value === 1 && comp.u.tSSR.value === P._test.rt().ssr.texture && comp.u.uCSk.value > .3, 'сборка: отражения и контактные тени днём');
  R0.sky = { lightI: 0, night: 1 }; log.length = 0; P.render(new T.Scene(), cam);
  ok(log.find(x => kind(x) === 'comp').u.uCSk.value === 0, 'ночью без света — контактных теней нет');
  P.setOpts({ rt: 'high' }); log.length = 0; P.render(new T.Scene(), cam);
  ok(P.rt.steps === 96 && log.find(x => kind(x) === 'ssr').u.uStride.value === 1.5, '«Высокая»: шаг 1,5 пикселя, до 96 шагов');
  R0.lighting.gfx.rt.refl = 0; log.length = 0; P.render(new T.Scene(), cam);
  ok(!log.some(x => kind(x) === 'ssr') && log.find(x => kind(x) === 'comp').u.uSSRk.value === 0, 'отражения мира выключены (сила 0) — прохода отражений нет');
  P.setOpts({ rt: 'off', ao: 'off' });
  ok(!P.rt.on && !P.ao.on && marks[marks.length - 1] === false && !P._test.rt().ssr, 'трассировка выключена — буфер отражений убран, метка воды снята');
  // настройки и мир
  ok(E.gfxResolve({ preset: 'ultra' }, { q: 'high' }).rt === 'high' && E.gfxResolve({ preset: 'high' }, { q: 'high' }).rt === 'on' && E.gfxResolve({ preset: 'mid' }, { q: 'mid' }).rt === 'off', 'пресеты: «Ультра» — высокая, «Высокая» — вкл, «Средняя» — выкл');
  ok(E.gfxResolve({ preset: 'custom', rt: 'high' }, { q: 'mid' }).rt === 'high' && E.gfxResolve({ preset: 'ultra', battery: true }, { q: 'high' }).rt === 'off' && E.gfxResolve({ preset: 'custom', rt: 'high' }, { q: 'low' }).rt === 'off', '«Своя» — как выбрано; батарея и low — выкл');
  const wg = E.worldGfx({ rt: { refl: 9, wet: -1 } });
  ok(wg.rt.refl === 2 && wg.rt.wet === 0 && E.worldGfx().rt.refl === 1 && E.worldGfx().rt.wet === 0, 'графика мира: отражения 0…2, мокрое 0…1');
  const lt = { time: 14, brightness: 1, ambient: 1, fogEnd: 320, gfx: E.worldGfx() };
  E.mergeLighting(lt, { gfx: { rt: { wet: .4 } } });
  ok(lt.gfx.rt.wet === .4 && lt.gfx.rt.refl === 1, 'мокрое мира дописывается (сила отражений остаётся)');
  ok(E.WORLD_PRESETS.neon.gfx.rt.wet > .5, 'настроение «Неон-город» — мокрые улицы');
  P.dispose();
}

// ═══ 18. «Генерация кадров (×2)» (post.js): перекладка прошлого кадра под новую камеру — сходимость поиска (тот же
//     алгоритм, что в шейдере: 4 шага, второй старт «как будто далеко», не сошлось — дальний), подвижные, проходы ═══
{
  const fsF = E.FG.fs;
  ok((fsF.match(/for \(int k = 0; k < 4; k\+\+\)/g) || []).length === 1 && fsF.includes('solve(uv, uv + (uv - toNew(wOld(uv, 0.99995))))') && fsF.includes('dOld(s1) >= dOld(s2) ? s1 : s2'), 'шейдер перекладки: 4 шага, два старта, иначе — дальний');
  // сцена «пол + ящик» и две камеры; глубина «старого кадра» считается точно (как буфер глубины без ошибок)
  const camA = new T.PerspectiveCamera(50, 16 / 9, .2, 300); camA.position.set(0, 3, 9); camA.lookAt(0, .6, 0); camA.updateMatrixWorld();
  const box = { min: [-1, 0, -1], max: [1, 2, 1] };
  const hit = (o, d, shift) => {   // луч: ближайшее из пола y=0 и ящика (сдвинут на shift)
    let tBest = Infinity;
    if (d.y < -1e-6) tBest = -o.y / d.y;
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) { const k = 'xyz'[a], mn = box.min[a] + (shift ? shift[a] : 0), mx = box.max[a] + (shift ? shift[a] : 0);
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < mn || o[k] > mx) { t0 = Infinity; break; } continue; }
      let ta = (mn - o[k]) / d[k], tb = (mx - o[k]) / d[k]; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
    if (t0 <= t1 && t0 > 0 && t0 < tBest) return { t: t0, box: true };
    return { t: tBest, box: false };
  };
  const vp = c => new T.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
  const ray = (c, uv) => { const o = c.position.clone(), p = new T.Vector3(uv[0] * 2 - 1, uv[1] * 2 - 1, .5).unproject(c); return { o, d: p.sub(o).normalize() }; };
  const depthAt = (c, uv, shift) => { const { o, d } = ray(c, uv), h = hit(o, d, shift); if (!isFinite(h.t)) return .99995; const p = o.clone().addScaledVector(d, h.t).project(c); return Math.min((p.z + 1) / 2, .99995); };
  const run = (camB, mov) => {
    const ivpA = vp(camA).invert(), vpB = vp(camB), W = 160, H = 90;
    const wOld = (uv, d) => new T.Vector4(uv[0] * 2 - 1, uv[1] * 2 - 1, d * 2 - 1, 1).applyMatrix4(ivpA);
    const mv = p => { if (mov) { const q = [p.x - mov.c[0], p.z - mov.c[2]]; if (q[0] * q[0] + q[1] * q[1] < mov.r * mov.r && p.y > mov.c[1] - .2 && p.y < mov.c[1] + mov.h) return new T.Vector3(p.x + mov.d[0], p.y + mov.d[1], p.z + mov.d[2]); } return p; };
    const toNew = p => { const c = new T.Vector4(p.x, p.y, p.z, 1).applyMatrix4(vpB); return [c.x / c.w * .5 + .5, c.y / c.w * .5 + .5]; };
    const dOld = uv => depthAt(camA, [Math.min(1, Math.max(0, uv[0])), Math.min(1, Math.max(0, uv[1]))], null);
    const W3 = (uv) => { const h = wOld(uv, dOld(uv)); return new T.Vector3(h.x / h.w, h.y / h.w, h.z / h.w); };
    const solve = (uv, s) => { s = s.slice(); for (let k = 0; k < 4; k++) { const q = toNew(mv(W3(s))); s[0] += uv[0] - q[0]; s[1] += uv[1] - q[1]; } return s; };
    const err = (uv, s) => { const q = toNew(mv(W3(s))); return Math.hypot((q[0] - uv[0]) * W, (q[1] - uv[1]) * H); };
    let good = 0, all = 0;
    for (let y = 4; y < H - 4; y += 3) for (let x = 4; x < W - 4; x += 3) {
      const uv = [(x + .5) / W, (y + .5) / H];
      // правда: что видит новая камера (ящик сдвинут, если подвижный) — и где эта точка была в старом кадре
      const { o, d } = ray(camB, uv), h = hit(o, d, mov ? mov.d : null); if (!isFinite(h.t)) continue;
      let pw = o.clone().addScaledVector(d, h.t); if (mov && h.box) pw = pw.sub(new T.Vector3(...mov.d));
      const pa = pw.clone().project(camA), su = [pa.x * .5 + .5, pa.y * .5 + .5];
      if (su[0] < .02 || su[0] > .98 || su[1] < .02 || su[1] > .98) continue;
      if (Math.abs(depthAt(camA, su, null) - (pa.z + 1) / 2) > 1e-4) continue;   // в старом кадре точку закрывало — открывшееся, пропускаем
      const far =(() => { const h2 = wOld(uv, .99995); const q = toNew(new T.Vector3(h2.x / h2.w, h2.y / h2.w, h2.z / h2.w)); return [uv[0] + (uv[0] - q[0]), uv[1] + (uv[1] - q[1])]; })();
      const s1 = solve(uv, uv), s2 = solve(uv, far), e1 = err(uv, s1), e2 = err(uv, s2);
      const s = e1 <= 1 ? s1 : e2 <= 1 ? s2 : (dOld(s1) >= dOld(s2) ? s1 : s2);
      all++; if (Math.hypot((s[0] - su[0]) * W, (s[1] - su[1]) * H) < .75) good++;
    }
    return { share: good / Math.max(1, all), all };
  };
  const camB = camA.clone(); camB.rotateOnWorldAxis(new T.Vector3(0, 1, 0), .035); camB.position.add(new T.Vector3(.12, 0, -.15)); camB.updateMatrixWorld();
  const a = run(camB, null);
  ok(a.all > 500 && a.share > .97, 'перекладка: поворот 2° и шаг — 97%+ пикселей точно на месте (< 0,75 px)', a);
  const camC = camA.clone(); camC.rotateOnWorldAxis(new T.Vector3(0, 1, 0), .1); camC.updateMatrixWorld();
  const b = run(camC, null);
  ok(b.share > .95, 'перекладка: поворот 6° — 95%+ пикселей на месте', b);
  const c = run(camB, { c: [0, 0, 0], r: 1.6, h: 2.5, d: [.12, 0, -.15] });
  ok(c.share > .95, 'подвижный (ящик едет вместе с камерой, как свой персонаж) — на месте', c);
  // проходы
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/post.js'), 'utf8'), { filename: 'post.js' });
  let cur = null; const log = [];
  const r = { extensions: { has: () => true }, capabilities: { isWebGL2: true }, autoClear: true, info: { render: { calls: 0 } },
    getDrawingBufferSize: v => v.set(800, 450), setRenderTarget: t => { cur = t; }, render: s => { const m = s.children[0]?.material; log.push({ t: cur, fs: m?.fragmentShader || '', u: m?.uniforms }); } };
  const P = E.post({ T, r, q: 'high', stats: {}, pr0: 1 });
  P.setOpts({ ao: 'off', aa: 'fxaa' }); P.setSize(800, 450, 1);
  ok(P.renderGen(camA, []) === false, 'генерация выключена — промежуточного кадра нет');
  P.setFg(true);
  ok(P.fg.on && P._test.rt().out && P._test.rt().out.width === 800 && P.renderGen(camA, []) === false, 'включена: буфер готового кадра размером холста; до первого настоящего — нечего перекладывать');
  log.length = 0; P.render(new T.Scene(), camA);
  const last = log[log.length - 1], prev = log[log.length - 2];
  ok(last.t === null && last.fs.includes('gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0)') && prev.t === P._test.rt().out && P.fg.have, 'настоящий кадр: в свой буфер, копией — на экран');
  log.length = 0;
  ok(P.renderGen(camB, [[0, 0, 0, .7, 2.6, .1, 0, -.1]]) === true && log.length === 1 && log[0].t === null && log[0].fs.includes('uMovA'), 'промежуточный кадр — один проход перекладки прямо на экран');
  const u = log[0].u;
  ok(u.uMovN.value === 1 && u.uMovA.value[0].w === .7 && u.uMovB.value[0].x === .1 && u.uMovB.value[0].w === 2.6 && u.tDepth.value === P._test.rt().scene.depthTexture, 'подвижные и глубина настоящего кадра — в шейдер');
  const ivp = vp(camA).invert();
  ok(u.uInvVP.value.elements.every((v, i) => Math.abs(v - ivp.elements[i]) < 1e-6), 'камера настоящего кадра — обратная матрица запомнена');
  P.setFg(false);
  ok(!P.fg.on && !P._test.rt().out && P.renderGen(camB, []) === false, 'выключили — буфер убран');
  const g0 = E.gfxResolve({}, { q: 'high' }), g1 = E.gfxResolve({ framegen: true }, { q: 'high' }), g2 = E.gfxResolve({ framegen: true }, { q: 'low' });
  ok(g0.framegen === false && g1.framegen === true && g2.framegen === false, 'генерация кадров: выключена по умолчанию, на low — нет');
  P.dispose();
}

// ═══ 19. «📸 Фото с трассировкой пути» (pathtrace.js): BVH; данные для видеокарты, обойдённые так же, как в шейдере, = перебор
//     всех треугольников; сцена → треугольники (экземпляры, материалы, бюджет); шейдер без «сэмплера параметром» (грабли ANGLE) ═══
{
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/pathtrace.js'), 'utf8'), { filename: 'pathtrace.js' });
  let sd = 12345; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  // пол, 2000 мелких треугольников, 300 одинаковых (один центр — делить нечем), 40 длинных тонких поперёк всего
  const list = [[-50, 0, -50, 50, 0, -50, 50, 0, 50], [-50, 0, -50, 50, 0, 50, -50, 0, 50]];
  for (let i = 0; i < 2000; i++) { const c = [rnd() * 20 - 10, rnd() * 6, rnd() * 20 - 10], s = .2 + rnd() * .8; list.push([0, 1, 2].flatMap(() => [c[0] + (rnd() - .5) * s, c[1] + (rnd() - .5) * s, c[2] + (rnd() - .5) * s])); }
  for (let i = 0; i < 300; i++) list.push([1, 1, 1, 2, 1, 1, 1, 2, 1]);
  for (let i = 0; i < 40; i++) { const z = rnd() * 20 - 10; list.push([-30, rnd() * 4, z, 30, rnd() * 4, z + .05, 0, 5, z]); }
  const build = (list, maxD) => {
    const N = list.length, tris = new Float32Array(N * 9); list.forEach((t, i) => tris.set(t, i * 9));
    const bvh = E.ptBuild(tris, N, 4, maxD), B = bvh.nodes;
    const seen = new Uint8Array(N); let dup = 0; for (const t of bvh.order) { if (seen[t]) dup++; seen[t] = 1; }
    let inside = true, maxLeaf = 0;
    const walk = id => { const k = id * 8;
      if (B[k + 7] < 0) { const s = B[k + 3], c = -B[k + 7]; maxLeaf = Math.max(maxLeaf, c);
        for (let i = s; i < s + c; i++) { const q = bvh.order[i] * 9; for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) { const x = tris[q + v * 3 + a]; if (x < B[k + a] - 1e-4 || x > B[k + 4 + a] + 1e-4) inside = false; } }
        return; }
      for (const ch of [B[k + 3], B[k + 7]]) { const c = ch * 8; for (let a = 0; a < 3; a++) if (B[c + a] < B[k + a] - 1e-4 || B[c + 4 + a] > B[k + 4 + a] + 1e-4) inside = false; walk(ch); } };
    walk(0);
    return { N, tris, bvh, dup, all: seen.every(x => x), inside, maxLeaf };
  };
  const A = build(list);
  ok(!A.dup && A.all && A.inside && A.bvh.depth <= 36, 'BVH: каждый треугольник ровно один раз, всё внутри своих коробок, глубина ≤ 36', { dup: A.dup, inside: A.inside, depth: A.bvh.depth, maxLeaf: A.maxLeaf });
  // обход упакованных данных — строка в строку как trace()/hitTri() шейдера (fNode/fTri, лист [s, e) — номера слотов, стек 40)
  const gpuTrace = (pd, o, d) => {
    const fN = i => pd.nodes.subarray(i * 4, i * 4 + 4), fT = i => pd.tri.subarray(i * 4, i * 4 + 4), inv = d.map(x => 1 / x), st = [0];
    let best = 1e20, hit = -1, maxSp = 1, over = 0;
    while (st.length) {
      const n = st.pop(), a = fN(n * 2), b = fN(n * 2 + 1);
      let ne = 0, fa = best;
      for (let k = 0; k < 3; k++) { const t0 = (a[k] - o[k]) * inv[k], t1 = (b[k] - o[k]) * inv[k]; ne = Math.max(ne, Math.min(t0, t1)); fa = Math.min(fa, Math.max(t0, t1)); }
      if (ne > fa) continue;
      if (b[3] < 0) {
        for (let i = a[3], e = a[3] - b[3]; i < e; i++) { const t = mt(fT(i * 8), fT(i * 8 + 1), fT(i * 8 + 2), o, d); if (t > 1e-4 && t < best) { best = t; hit = i; } }
      } else if (st.length < 38) { st.push(b[3], a[3]); maxSp = Math.max(maxSp, st.length); } else over++;
    }
    return { t: hit < 0 ? Infinity : best, hit, maxSp, over };
  };
  // Мёллер — Трумбор, как в hitTri
  function mt(a, b, c, o, d){
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-10) return -1;
    const id = 1 / det, s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * id;
    if (u < 0 || u > 1) return -1;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * id;
    if (v < 0 || u + v > 1) return -1;
    return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * id;
  }
  const brute = (X, o, d) => { let best = Infinity, tri = -1; for (let i = 0; i < X.N; i++) { const q = i * 9, t = mt(X.tris.subarray(q, q + 3), X.tris.subarray(q + 3, q + 6), X.tris.subarray(q + 6, q + 9), o, d); if (t > 1e-4 && t < best) { best = t; tri = i; } } return { t: best, tri }; };
  const scOf = (X, cols) => ({ n: X.N, tris: X.tris, nrm: new Float32Array(X.N * 9), col: cols || new Float32Array(X.N * 9).fill(.5), uvs: new Float32Array(X.N * 6), mid: new Uint16Array(X.N), mats: [{ type: 0, rough: .8, metal: 0, layer: -1 }] });
  const cols = new Float32Array(A.N * 9).map(() => rnd());
  const pdA = E.ptPack(scOf(A, cols), A.bvh);
  const rays = (X, pd, n) => { let same = 0, hits = 0, js = 0, maxSp = 0, over = 0, bad = null;
    for (let i = 0; i < n; i++) {
      const o = [rnd() * 30 - 15, .5 + rnd() * 8, rnd() * 30 - 15], u = rnd() * 2 - 1, ph = rnd() * 6.2832, r = Math.sqrt(1 - u * u), d = [r * Math.cos(ph), u, r * Math.sin(ph)];
      const g = gpuTrace(pd, o, d), b = brute(X, o, d), j = E.ptTrace(X.bvh, X.tris, o, d);
      maxSp = Math.max(maxSp, g.maxSp); over += g.over;
      const eq = (t1, t2) => (t1 === Infinity && t2 === Infinity) || Math.abs(t1 - t2) <= 1e-6 * Math.max(1, t2);
      if (eq(g.t, b.t)) same++; else if (!bad) bad = { o, d, g: g.t, b: b.t };
      if ((j ? j.t : Infinity) === b.t || eq(j ? j.t : Infinity, b.t)) js++;
      if (b.tri >= 0) hits++;
    }
    return { same, hits, js, maxSp, over, bad, n };
  };
  const R1 = rays(A, pdA, 3000);
  ok(R1.same === R1.n && R1.js === R1.n && R1.hits > 1500, 'обход как в шейдере и ptTrace = перебор всех треугольников (3000 лучей)', R1);
  ok(R1.over === 0 && R1.maxSp <= A.bvh.depth + 1 && R1.maxSp < 38, 'стек обхода: занято не больше глубины + 1, не переполняется', { maxSp: R1.maxSp, depth: A.bvh.depth });
  // данные: слот i = треугольник order[i]; цвет вершины — 3 байта в одном float32 (как unpackC в шейдере)
  let packOk = true;
  for (let i = 0; i < A.N && packOk; i += 7) {
    const src = A.bvh.order[i];
    for (let v = 0; v < 3; v++) {
      for (let k = 0; k < 3; k++) if (pdA.tri[i * 32 + v * 4 + k] !== A.tris[src * 9 + v * 3 + k]) packOk = false;
      const f = pdA.tri[i * 32 + v * 4 + 3], un = [f % 256, Math.floor(f / 256) % 256, Math.floor(f / 65536)];
      for (let k = 0; k < 3; k++) if (un[k] !== Math.round(cols[src * 9 + v * 3 + k] * 255)) packOk = false;
    }
  }
  ok(packOk, 'упаковка: слоты в порядке листьев, цвет вершин 3 байта в float без потерь');
  // предел глубины (в шейдере стек на 40): глубже предела — один большой лист, обход всё равно верный (предел 3 — для проверки)
  const Ch = build(list, 3), pdC = E.ptPack(scOf(Ch), Ch.bvh), R2 = rays(Ch, pdC, 600);
  ok(Ch.bvh.depth === 3 && !Ch.dup && Ch.all && Ch.inside && Ch.maxLeaf > 100 && R2.same === R2.n, 'предел глубины BVH: дальше — большой лист, попадания те же', { depth: Ch.bvh.depth, maxLeaf: Ch.maxLeaf, same: R2.same });
  ok(E.ptBuild(A.tris, A.N, 4, 99).depth <= 36, 'предел глубины не больше 36 (стек шейдера), что бы ни попросили');
  console.log(`  трассировка пути: ${A.N} треугольников — глубина BVH ${A.bvh.depth}, лист до ${A.maxLeaf}, стек до ${R1.maxSp}, попаданий ${R1.hits}/${R1.n}`);
  // сцена → треугольники
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(60, 16 / 9, .1, 1000); cam.position.set(0, 2, 10); cam.updateMatrixWorld();
  const box = new T.Mesh(new T.BoxGeometry(2, 2, 2), new T.MeshStandardMaterial({ color: 0xff0000, roughness: .3, metalness: .8 })); box.position.set(0, 1, 0); scene.add(box);
  const grass = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ alphaTest: .5, side: T.DoubleSide }), 3);
  for (let i = 0; i < 3; i++) { grass.setMatrixAt(i, new T.Matrix4().makeTranslation(5 + i, .5, 0)); grass.setColorAt(i, new T.Color(i === 1 ? 0x00ff00 : 0xffffff)); } scene.add(grass);
  const lamp = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffeeaa })); lamp.position.set(-4, 3, 0); scene.add(lamp);
  const waterM = new T.MeshStandardMaterial({ transparent: true, opacity: .8, roughness: .05 }); waterM.userData.water = true;
  const water = new T.Mesh(new T.PlaneGeometry(4, 4), waterM); water.rotation.x = -Math.PI / 2; water.position.set(0, .05, 4); scene.add(water);
  scene.add(new T.Mesh(new T.PlaneGeometry(3, 3), new T.MeshStandardMaterial({ transparent: true, opacity: .4, roughness: .9 })));   // дым — без него
  const skyM = new T.Mesh(new T.SphereGeometry(500, 8, 4), new T.MeshBasicMaterial({ side: T.BackSide })); skyM.userData.sky = true; scene.add(skyM);
  const far = new T.Mesh(new T.SphereGeometry(1, 16, 8), new T.MeshStandardMaterial()); far.position.set(0, 0, -400); scene.add(far);
  const farN = far.geometry.index.count / 3;
  const Rm = { T, scene, camera: cam };
  const S1 = E.ptScene(Rm), S2 = E.ptScene(Rm, 22);
  const types = S1.mats.map(m => m.type).sort().join('');
  const gx = []; for (let t = 0; t < S1.n; t++) { const m = S1.mats[S1.mid[t]]; if (m.cut) for (let v = 0; v < 3; v++) gx.push(S1.tris[t * 9 + v * 3]); }
  ok(S1.n === 12 + 6 + 2 + 2 + farN && S1.skipped === 0, 'сцена: ящик 12 + трава 3×2 + лампа 2 + вода 2 + дальний шар; дым и небо — без них', { n: S1.n, farN });
  ok(S2.n === 22 && S2.skipped === 1, 'бюджет треугольников: дальнее выбрасывается первым', { n: S2.n, skipped: S2.skipped });
  const mBox = S1.mats.find(m => m.type === 0 && Math.abs(m.metal - .8) < 1e-6), mW = S1.mats.find(m => m.type === 2);
  ok(types.includes('0') && types.includes('1') && types.includes('2') && mBox && Math.abs(mBox.rough - .3) < 1e-6 && mW && mW.ior === 1.33, 'материалы: PBR (шероховатость, металл), свет (MeshBasic), вода — преломление 1,33', types);
  ok(gx.length === 18 && Math.min(...gx) >= 4.49 && Math.max(...gx) <= 7.51, 'экземпляры: матрица каждого применена (трава на x 4,5…7,5)', [Math.min(...gx), Math.max(...gx)]);
  let green = false; for (let t = 0; t < S1.n; t++) if (S1.mats[S1.mid[t]].cut && S1.col[t * 9] < .01 && S1.col[t * 9 + 1] > .99) green = true;
  ok(green, 'цвет экземпляра умножается на цвет вершин');
  const pd1 = E.ptPack(S1, E.ptBuild(S1.tris, S1.n)), cutI = S1.mats.findIndex(m => m.cut);
  ok(cutI >= 0 && pd1.mats[cutI * 8 + 7] === 0 && pd1.mats[cutI * 8 + 5] === -1, 'вырез по альфе — только у материала с текстурой (без неё — сплошной)');
  // шейдер
  const fsP = E.ptShaders.fs;
  ok(!/\w+\s*\([^)]*\bsampler\w*\s+\w+/.test(fsP) && fsP.includes('vec4 fTri(int i){ return texelFetch(tTri') && fsP.includes('vec4 fMat(int i){ return texelFetch(tMat'), 'шейдер: у каждой текстуры данных своя функция чтения, сэмплер параметром не передаётся (ANGLE путал текстуры)');
  ok(/bool hitTri\([^)]*inout vec2 bc\)/.test(fsP) && /int trace\([^)]*inout vec2 bc,/.test(fsP) && !/[^n]out vec2 bc/.test(fsP), 'шейдер: bc — inout (при «мимо» прошлое попадание не портится)');
  ok(fsP.includes('int st[40]') && fsP.includes('sp < 38') && fsP.includes('if (mm.w > 0.5)') && fsP.includes('.a < 0.5) return false;'), 'шейдер: стек 40, вырез по альфе в hitTri');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

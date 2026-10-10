// Тесты графики движка D37E в node (без браузера): склейка сцены (js/engine/batch.js) — чанки, склеенная геометрия
// и экземпляры дают ровно те же треугольники (места, нормали, цвета), что и отдельные меши; правки в редакторе и в игре,
// видимость, удаление, выбор мышью по вынутым мешам, свет в постоянный набор; автомат динамического разрешения и выбор
// ламп (render.js). Нужен three.js r149 (в репозитории его нет — сайт берёт его с jsDelivr):
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
for (const f of ['core', 'physics', 'render', 'scene', 'batch'])
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

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

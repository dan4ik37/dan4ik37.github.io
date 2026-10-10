// Тесты физики движка D37E в node: physics.js (сетка, тела на месте, reuse, события), rigid.js + Rapier (падение, стопка,
// склоны, толчок и езда игрока, закрепить/открепить, рельеф, соединения, скрипты), scene.js (с заглушкой Three.js).
// Запуск из корня сайта: node scripts/physics-test.cjs        (код выхода 1 — есть ошибки)
// Rapier в репозиторий НЕ кладём. Пакет — во временную папку вне сайта:
//   npm install --prefix "%TEMP%/d37-rapier" --ignore-scripts @dimforge/rapier3d-compat@0.19.3
// или свой путь: RAPIER_PATH=<папка пакета или папка с node_modules>. Нет пакета — проверки Rapier пропускаются (с сообщением).
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const SITE = path.join(__dirname, '..');
const RAPIER_VER = '0.19.3';
globalThis.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
for (const f of ['core', 'physics', 'controls', 'player', 'scene', 'rigid'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
const E = globalThis.D37E, U = E.UNIT, DT = 1 / 60;
let pass = 0, fail = 0, skip = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const info = (...a) => console.log('  ·', ...a);
const ms = t => t.toFixed(3) + ' мс';
const hr = () => Number(process.hrtime.bigint()) / 1e6;

// ═══ Заглушка Three.js и рендера для scene.js (только то, что scene.js трогает без браузера) ═══
const T = (() => {
  class Euler { constructor(){ this.x = this.y = this.z = 0; this.order = 'XYZ'; } set(x, y, z, o){ this.x = x; this.y = y; this.z = z; if (o) this.order = o; return this; } }
  class Matrix4 {
    constructor(){ this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
    makeRotationFromEuler(eu){   // порядок YXZ (как в three.js)
      const te = this.elements, a = Math.cos(eu.x), b = Math.sin(eu.x), c = Math.cos(eu.y), d = Math.sin(eu.y), e = Math.cos(eu.z), f = Math.sin(eu.z);
      const ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce + df * b; te[4] = de * b - cf; te[8] = a * d; te[1] = a * f; te[5] = a * e; te[9] = -b; te[2] = cf * b - de; te[6] = df + ce * b; te[10] = a * c;
      te[3] = te[7] = te[11] = te[12] = te[13] = te[14] = 0; te[15] = 1; return this;
    }
    makeRotationY(t){ const c = Math.cos(t), s = Math.sin(t); this.elements = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; return this; }
    copy(m){ this.elements = m.elements.slice(); return this; }
    multiply(m){
      const a = this.elements, b = m.elements, r = new Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k]; r[j * 4 + i] = s; }
      this.elements = r; return this;
    }
  }
  class Quaternion { constructor(){ this.x = this.y = this.z = 0; this.w = 1; } set(x, y, z, w){ this.x = x; this.y = y; this.z = z; this.w = w; return this; } }
  class Attr { constructor(arr, n){ this.array = arr; this.itemSize = n; this.count = arr.length / n; } getX(i){ return this.array[i * this.itemSize]; } getY(i){ return this.array[i * this.itemSize + 1]; } getZ(i){ return this.array[i * this.itemSize + 2]; } setXYZ(i, x, y, z){ const k = i * this.itemSize; this.array[k] = x; this.array[k + 1] = y; this.array[k + 2] = z; } }
  class Geo { constructor(){ this.index = null; this.attributes = { position: new Attr(new Float32Array(0), 3), normal: new Attr(new Float32Array(0), 3) }; } toNonIndexed(){ return this; } setAttribute(k, v){ this.attributes[k] = v; } computeBoundingSphere(){} computeBoundingBox(){} dispose(){} }
  class V { constructor(){ this.x = this.y = this.z = 0; } set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; } }
  class Obj { constructor(){ this.position = new V(); this.rotation = new Euler(); this.quaternion = new Quaternion(); this.userData = {}; this.children = []; this.visible = true; } add(c){ this.children.push(c); } traverse(f){ f(this); for (const c of this.children) c.traverse(f); } }
  class Mesh extends Obj { constructor(g, m){ super(); this.geometry = g; this.material = m; this.isMesh = true; } }
  return { Euler, Matrix4, Quaternion, Mesh, Group: Obj, BoxGeometry: Geo, SphereGeometry: Geo, CylinderGeometry: Geo, CircleGeometry: Geo, BufferGeometry: Geo,
    Float32BufferAttribute: class extends Attr { constructor(a, n){ super(new Float32Array(a), n); } }, BufferAttribute: Attr,
    MeshBasicMaterial: class { constructor(){ this.userData = {}; } clone(){ return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { userData: { ...this.userData } }); } },
    MeshLambertMaterial: class { constructor(){ this.userData = {}; } clone(){ return this; } }, MeshStandardMaterial: class { constructor(){ this.userData = {}; } clone(){ return this; } } };
})();
function stubR(){
  const mat = () => ({ userData: {}, clone(){ return { ...this, userData: { ...this.userData } }; } });
  return { T, q: 'high', r: { shadowMap: { enabled: false } }, scene: { add(){}, remove(){} }, mat, tex: mat, texMat: mat, proc: () => null, prefab(){}, shadowsOn(){}, lighting: {}, setLighting(){} };
}
const mkWorld = (o = {}) => { const ph = new E.Phys({ ground: 0 }); if (o.ground !== undefined) ph.ground = o.ground; const SC = E.scene(stubR(), ph, { edit: true }); return { ph, SC }; };
// поза детали: кватернион из rot (градусы, YXZ) и точка детали (локальная → мир)
const quat = o => E.rigid.qEuler(o.rot[0], o.rot[1], o.rot[2]);
function toWorldPt(o, l){
  const r = quat(o), tx = 2 * (r.y * l[2] - r.z * l[1]), ty = 2 * (r.z * l[0] - r.x * l[2]), tz = 2 * (r.x * l[1] - r.y * l[0]);
  return [o.pos[0] + l[0] + r.w * tx + (r.y * tz - r.z * ty), o.pos[1] + l[1] + r.w * ty + (r.z * tx - r.x * tz), o.pos[2] + l[2] + r.w * tz + (r.x * ty - r.y * tx)];
}
function toLocalPt(o, w){ const r = quat(o), c = { x: -r.x, y: -r.y, z: -r.z, w: r.w }, v = [w[0] - o.pos[0], w[1] - o.pos[1], w[2] - o.pos[2]];
  const tx = 2 * (c.y * v[2] - c.z * v[1]), ty = 2 * (c.z * v[0] - c.x * v[2]), tz = 2 * (c.x * v[1] - c.y * v[0]);
  return [v[0] + c.w * tx + (c.y * tz - c.z * ty), v[1] + c.w * ty + (c.z * tx - c.x * tz), v[2] + c.w * tz + (c.x * ty - c.y * tx)]; }
// нижняя точка коробки (по её повороту)
function lowestY(o){ const r = quat(o), h = o.size.map(s => s / 2), m10 = 2 * (r.x * r.y + r.w * r.z), m11 = 1 - 2 * (r.x * r.x + r.z * r.z), m12 = 2 * (r.y * r.z - r.w * r.x); return o.pos[1] - Math.abs(m10) * h[0] - Math.abs(m11) * h[1] - Math.abs(m12) * h[2]; }
const box = (SC, pos, size = [2, 2, 2], extra = {}) => SC.add('Part', { pos, size, anchored: false, mat: 'plastic', ...extra });
function steps(SC, sec, cb){ const n = Math.round(sec / DT); for (let i = 0; i < n; i++) { cb?.(i); SC.step(DT); } }
const mkC = () => { const C = E.controls({ listen: false }); return { C, hold(code, on = true){ C.key(code, on); } }; };
const cam = { yaw: Math.PI };   // камера сзади: вперёд = +z

// ═══ 1. physics.js без Rapier: сетка с целыми ключами, тела на месте, reuse, события ═══
{
  const ph = new E.Phys({ ground: 0 });
  const ev = [];
  const off = ph.watch((t, c) => ev.push(t + ':' + c.tag));
  const a = ph.addBox({ x: 1, y: 1, z: 1, hx: 1, hy: 1, hz: 1, tag: 'a' });
  ok([...ph.grid.keys()].every(k => typeof k === 'number' && Number.isInteger(k)), 'ключи сетки — целые числа');
  ok(ph.query(0, 0, 2, 2).includes(a), 'запрос находит тело');
  const id = a.id;
  ph.update(a, { x: 41, z: -37 });
  ok(a.id === id && ph.cols.has(a) && !ph.query(0, 0, 2, 2).includes(a) && ph.query(40, -38, 42, -36).includes(a), 'update: тело то же, переехало в другие клетки');
  ok(near(a.minx, 40, 1e-9) && near(a.top, 2, 1e-9), 'update: границы пересчитаны', [a.minx, a.top]);
  ph.update(a, { type: 'cyl', r: .5 });
  ok(a.type === 'cyl' && near(a.maxx - a.minx, 1, 1e-9) && E.Phys.circleHit(a, 41.6, -37, .2), 'update: вид меняется (коробка → цилиндр)');
  let grid0 = 0; for (const l of ph.grid.values()) grid0 += l.length;
  for (let i = 0; i < 1000; i++) ph.update(a, { x: 41 + (i % 3) * .01 });
  let grid1 = 0; for (const l of ph.grid.values()) grid1 += l.length;
  ok(grid0 === grid1, 'update на месте не плодит записей в сетке', grid0 + ' → ' + grid1);
  // reuse: те же объекты, лишнее удаляется
  const b = ph.addBox({ x: 5, y: 1, z: 5, hx: 1, hy: 1, hz: 1, tag: 'b' }), c = ph.addCyl({ x: 6, y: 1, z: 6, r: 1, hy: 1, tag: 'c' });
  ev.length = 0;
  ph.reuse([b, c]);
  const b2 = ph.addWedge({ x: 9, y: 2, z: 9, hx: 1, hy: 2, hz: 3, tag: 'b' });
  ph.reuseEnd();
  ok(b2 === b && b.type === 'wedge' && !ph.cols.has(c), 'reuse: тело то же (и вид новый), лишнее удалено');
  ok(ev.join() === 'move:b,remove:c', 'события: move и remove', ev.join());
  off();
  const d = ph.addBox({ x: 0, y: 0, z: 0, hx: 1, hy: 1, hz: 1 }); ph.remove(d);
  ok(!ev.some(e => e.startsWith('add:') && e.endsWith(':')), 'отписка работает');
  // дальние координаты и NaN не ломают сетку
  const far = ph.addBox({ x: 1e7, y: 0, z: -1e7, hx: 1, hy: 1, hz: 1 });
  ok(ph.query(1e7 - 1, -1e7 - 1, 1e7 + 1, -1e7 + 1).includes(far), 'очень далеко — тело находится (край сетки)');
  // круг против тела — общий объект без new
  const h1 = E.Phys.circleHit(b, 9, 9, .3), h2 = E.Phys.circleHit(b, 9.1, 9, .3);
  ok(h1 === h2 && h1 !== null, 'circleHit отдаёт общий объект');
}
{ // скорость: шаг персонажа и луч (на столько тел — как в «Мире Денчика»)
  const ph = new E.Phys({ ground: 0 });
  const R = E.rng(37);
  for (let i = 0; i < 2000; i++) ph.addBox({ x: (R() - .5) * 300, y: 1, z: (R() - .5) * 300, hx: .5 + R() * 2, hy: .5 + R(), hz: .5 + R() * 2, yaw: R() * 6 });
  const ch = ph.character({ x: 0, z: 0 });
  let t0 = hr();
  for (let i = 0; i < 20000; i++) { ph.move(ch, DT, { x: Math.sin(i * .01), z: Math.cos(i * .013) }, 6, i % 90 === 0); }
  const tMove = (hr() - t0) / 20000;
  t0 = hr();
  let hits = 0;
  for (let i = 0; i < 20000; i++) { const a = i * .37; if (ph.raycast(0, 3, 0, Math.cos(a), -.1, Math.sin(a), 60)) hits++; }
  const tRay = (hr() - t0) / 20000;
  t0 = hr();
  const moving = [...ph.cols].slice(0, 300);
  for (let s = 0; s < 200; s++) for (let i = 0; i < moving.length; i++) { const c = moving[i]; ph.update(c, { x: c.x + .05, z: c.z }, undefined, true); }
  const tUpd = (hr() - t0) / (200 * 300);
  info(`physics.js: шаг персонажа ${ms(tMove)}, луч 60 м ${ms(tRay)} (${hits} попаданий), update тела ${(tUpd * 1000).toFixed(2)} мкс (2000 тел)`);
  ok(tMove < .05 && tRay < .1 && tUpd < .01, 'physics.js быстрый (шаг < 0,05 мс, луч < 0,1 мс, update < 10 мкс)', [tMove, tRay, tUpd]);
}

// ═══ 2. scene.js без незакреплённых деталей: Rapier не грузится, тела деталей двигаются на месте ═══
{
  const { ph, SC } = mkWorld();
  const loadSpy = E.rigid.load; let loads = 0; E.rigid.load = (...a) => { loads++; return loadSpy(...a); };
  const p = SC.add('Part', { pos: [0, .5, 0], size: [4, 1, 2] });
  const c0 = p._cols[0];
  steps(SC, 1, i => SC.set(p, 'pos', [i * .1, .5, 0], true));
  ok(SC.rigid === null && loads === 0, 'мир без незакреплённых деталей — Rapier не грузится и не создаётся');
  ok(p._cols[0] === c0 && ph.cols.size === 1 && near(c0.x, 5.9, 1e-6), 'SC.set pos: тело Phys то же, сдвинуто на месте', c0.x);
  SC.set(p, 'rot', [0, 0, 30], true);
  ok(p._cols[0] === c0 && c0.type === 'box' && c0.hy > .5, 'наклон — описанная коробка, тело то же');
  SC.set(p, 'collide', false, true);
  ok(p._cols[0] === c0 && c0.solid === false, 'CanCollide на месте');
  E.rigid.load = loadSpy;
}

// ═══ 3. Rapier ═══
function findRapier(){
  const cands = [];
  if (process.env.RAPIER_PATH) cands.push(process.env.RAPIER_PATH, path.join(process.env.RAPIER_PATH, 'node_modules/@dimforge/rapier3d-compat'));
  cands.push(path.join(os.tmpdir(), 'd37-rapier/node_modules/@dimforge/rapier3d-compat'), path.join(SITE, '..', 'd37-rapier/node_modules/@dimforge/rapier3d-compat'));
  for (const c of cands) { try { if (fs.existsSync(c)) return { mod: require(c), at: c }; } catch (e) { /* дальше */ } }
  try { return { mod: require('@dimforge/rapier3d-compat'), at: 'node_modules' }; } catch (e) { return null; }
}

async function rapierTests(){
  const found = findRapier();
  if (!found) {
    skip++;
    console.log(`SKIP: Rapier не найден — проверки твёрдых тел пропущены. Поставь: npm install --prefix "${path.join(os.tmpdir(), 'd37-rapier')}" --ignore-scripts @dimforge/rapier3d-compat@${RAPIER_VER}  (или RAPIER_PATH=…)`);
    return;
  }
  const okLoad = await E.rigid.load(found.mod);
  ok(okLoad && E.rigid.ready, 'Rapier загружен', found.at);
  const ver = E.rigid.R.version ? E.rigid.R.version() : '?';
  if (ver !== RAPIER_VER) console.log(`  ! Rapier ${ver}, а сайт грузит ${RAPIER_VER} (E.rigid.VERSION) — цифры могут отличаться`);
  info('Rapier', ver, 'из', found.at);

  // ── 300 коробок падают в кучу, засыпают; время шага (машина может быть занята — лучший из 3 прогонов + время ЦП процесса) ──
  {
    const pile = () => {
      const { SC } = mkWorld();
      const R = E.rng(300);
      let n = 0;
      for (let ly = 0; n < 300; ly++) for (let ix = 0; ix < 6 && n < 300; ix++) for (let iz = 0; iz < 6 && n < 300; iz++, n++)
        box(SC, [(ix - 2.5) * 2.4 + (R() - .5) * .3, 1.5 + ly * 2.5, (iz - 2.5) * 2.4 + (R() - .5) * .3], [.8 + R() * 1.1, .8 + R() * 1.1, .8 + R() * 1.1], { rot: [R() * 20 - 10, R() * 360, R() * 20 - 10], mat: ['plastic', 'wood', 'concrete', 'metal'][n % 4] });
      const times = [];
      let asleepAt = -1;
      const t0 = hr(); SC.step(DT); const first = hr() - t0;
      const cpu0 = process.cpuUsage();
      for (let i = 1; i < 60 * 40; i++) {
        const t = hr(); SC.step(DT); times.push(hr() - t);
        if (SC.rigid.active === 0) { asleepAt = i / 60; break; }
      }
      const cu = process.cpuUsage(cpu0), cpu = (cu.user + cu.system) / 1000 / times.length;
      const sorted = times.slice().sort((a, b) => a - b), pct = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
      const avg = times.reduce((s, v) => s + v, 0) / times.length;
      const tw = hr(); for (let i = 0; i < 600; i++) SC.step(DT); const idle = (hr() - tw) / 600;
      return { SC, first, avg, p50: pct(.5), p95: pct(.95), p99: pct(.99), mx: sorted[sorted.length - 1], cpu, asleepAt, idle };
    };
    const runs = [];
    for (let k = 0; k < 3; k++) { runs.push(pile()); const r = runs[k]; if (r.avg < 4 && r.p50 < 4) break; }
    for (const r of runs) info(`300 коробок: создание мира ${ms(r.first)}; шаг: среднее ${ms(r.avg)} (ЦП ${ms(r.cpu)}), медиана ${ms(r.p50)}, p95 ${ms(r.p95)}, p99 ${ms(r.p99)}, макс ${ms(r.mx)}; уснули за ${r.asleepAt.toFixed(1)} с; потом ${ms(r.idle)} на шаг`);
    const best = runs.reduce((a, b) => (b.avg < a.avg ? b : a)), { SC } = runs[0];
    const lowest = Math.min(...SC.all().map(lowestY));
    ok(runs[0].asleepAt > 0 && runs[0].asleepAt < 30, '300 коробок легли и уснули', runs[0].asleepAt);
    ok(best.avg < 4 && best.p50 < 4, '300 коробок: шаг < 4 мс (среднее и медиана лучшего прогона; p95/p99/макс — в строке выше)', [best.avg, best.p50, best.p95, best.p99, best.mx]);
    ok(best.idle < .02, 'всё уснуло — шаг почти бесплатный (< 0,02 мс)', best.idle);
    info(`300 коробок: ниже всех вершина на ${lowest.toFixed(3)} (низ кучи под весом металла чуть «вминается» в землю — мягкость решателя)`);
    ok(SC.all().every(o => o.pos.every(Number.isFinite) && o.rot.every(Number.isFinite)) && lowest > -.15, 'позы конечные, сквозь землю никто не провалился (вмятие ≤ 0,15)', lowest);
    const st = SC.rigid.stats();
    ok(st.bodies === 300 && st.parts === 300, 'тел — 300', JSON.stringify(st));
  }

  // ── стопка из 10 коробок стоит 10 с ──
  {
    const { SC } = mkWorld();
    const list = [];
    for (let i = 0; i < 10; i++) list.push(box(SC, [0, 1 + i * 2, 0], [2, 2, 2]));
    steps(SC, 10);
    const top = list[9], drift = Math.hypot(top.pos[0], top.pos[2]), tilt = Math.max(...list.map(o => Math.max(Math.abs(o.rot[0]), Math.abs(o.rot[2]))));
    info(`стопка 10: сдвиг верха ${drift.toFixed(4)}, высота ${top.pos[1].toFixed(3)} (было 19), наклон ${tilt.toFixed(3)}°, активных ${SC.rigid.active}`);
    ok(drift < .05 && near(top.pos[1], 19, .1) && tilt < 1, 'стопка 10 коробок стоит 10 с');
    ok(SC.rigid.active === 0, 'стопка уснула');
  }

  // ── клин 20°: коробка съезжает; 10°: стоит (трение пластика 0,3; tg 20° = 0,36, tg 10° = 0,18) ──
  for (const [deg, slides] of [[20, true], [10, false]]) {
    const { SC } = mkWorld();
    const L = 12, h = L * Math.tan(deg * Math.PI / 180);
    SC.add('Part', { shape: 'wedge', pos: [0, h / 2, 0], size: [6, h, L], anchored: true, mat: 'plastic' });
    const n = { y: Math.cos(deg * Math.PI / 180), z: Math.sin(deg * Math.PI / 180) };
    const b = box(SC, [0, h / 2 + n.y * .51, n.z * .51], [1, 1, 1], { rot: [deg, 0, 0] });
    const z0 = b.pos[2];
    steps(SC, 3);
    const dz = b.pos[2] - z0;
    info(`клин ${deg}°: коробка сдвинулась вниз на ${dz.toFixed(3)}`);
    if (slides) ok(dz > 1.5, 'клин 20°: коробка съезжает', dz);
    else ok(Math.abs(dz) < .05 && SC.rigid.sleeping(b), 'клин 10°: коробка стоит (трение) и спит', dz);
  }

  // ── игрок толкает лёгкую коробку; тяжёлую (металл 4×4×4) — почти нет ──
  for (const [label, size, mat, min, max] of [['пластик 2×2×2', [2, 2, 2], 'plastic', 2, 99], ['металл 4×4×4', [4, 4, 4], 'metal', -1, .3]]) {
    const { ph, SC } = mkWorld();
    const b = box(SC, [0, size[1] / 2, 2 + size[2] / 2], size, { mat });
    const P = E.player(ph, { x: 0, z: 0 });
    const { C, hold } = mkC();
    SC.step(DT);
    const z0 = b.pos[2];
    hold('KeyW');
    for (let i = 0; i < 180; i++) { C.step(DT); P.update(DT, C, cam); SC.step(DT); }
    const dz = b.pos[2] - z0;
    info(`толкает ${label}: коробка +${dz.toFixed(2)} по z, игрок z=${P.ch.z.toFixed(2)}`);
    ok(dz > min && dz < max, `игрок толкает: ${label}`, dz);
    ok(P.ch.z < b.pos[2] - size[2] / 2 + .05, `${label}: игрок не прошёл сквозь коробку`, [P.ch.z, b.pos[2]]);
  }

  // ── мелочь ниже ступеньки (камешек 0,4) — игрок пинает её, а не залезает ──
  {
    const { ph, SC } = mkWorld();
    const pebble = box(SC, [0, .2, 2], [.4, .4, .4]);
    const P = E.player(ph, { x: 0, z: 0 }); const { C, hold } = mkC();
    SC.step(DT);
    hold('KeyW');
    let maxY = 0; for (let i = 0; i < 90; i++) { C.step(DT); P.update(DT, C, cam); SC.step(DT); maxY = Math.max(maxY, P.ch.y); }
    info(`камешек: улетел на z=${pebble.pos[2].toFixed(2)}, игрок поднимался до y=${maxY.toFixed(3)}`);
    ok(pebble.pos[2] > 4 && maxY < .05 && pebble._cols[0].kick, 'камешек пинается, игрок на него не залезает', [pebble.pos[2], maxY]);
  }

  // ── игрок стоит на коробке, коробка едет — игрок едет с ней (RG.addCharacter carry; в студии это делает studio3d) ──
  {
    const { ph, SC } = mkWorld();
    const b = box(SC, [0, .5, 0], [4, 1, 4], { mat: 'ice' });
    SC.step(DT);
    const P = E.player(ph, { x: 0, z: 0 });
    P.place(0, 1.0, 0);
    const { C } = mkC();
    SC.rigid.addCharacter(P.ch, { carry: true });
    let onTop = 0;
    for (let i = 0; i < 120; i++) { SC.rigid.setVelocity(b, [3, SC.rigid.getVelocity(b)[1], 0]); C.step(DT); P.update(DT, C, cam); SC.step(DT); if (P.ch.grounded && P.ch.onCol?.rb?.obj === b) onTop++; }
    info(`езда на коробке: коробка x=${b.pos[0].toFixed(2)}, игрок x=${P.ch.x.toFixed(2)}, y=${P.ch.y.toFixed(3)}, на ней ${onTop}/120 шагов`);
    ok(b.pos[0] > 5 && near(P.ch.x, b.pos[0], .3) && near(P.ch.y, 1, .05) && onTop > 110, 'игрок стоит на движущейся коробке и едет');
    // и «студийная» езда (сдвиг по data.part, как в studio3d.playStep)
    const { ph: ph2, SC: SC2 } = mkWorld();
    const b2 = box(SC2, [0, .5, 0], [4, 1, 4], { mat: 'ice' });
    SC2.step(DT);
    const P2 = E.player(ph2, { x: 0, z: 0 }); P2.place(0, 1, 0);
    const k2 = mkC(); let onId = null, onPos = null;
    for (let i = 0; i < 120; i++) {
      const on = P2.ch.grounded ? P2.ch.onCol?.data?.part : null, o = on && SC2.get(on);
      if (o && onId === on && onPos) { P2.ch.x += o.pos[0] - onPos[0]; P2.ch.y += o.pos[1] - onPos[1]; P2.ch.z += o.pos[2] - onPos[2]; }
      onId = on; onPos = o ? o.pos.slice() : null;
      SC2.rigid.setVelocity(b2, [3, SC2.rigid.getVelocity(b2)[1], 0]);
      k2.C.step(DT); P2.update(DT, k2.C, cam); SC2.step(DT);
    }
    ok(near(P2.ch.x, b2.pos[0], .3) && b2.pos[0] > 5, 'езда как в studio3d (по data.part) тоже работает', [P2.ch.x, b2.pos[0]]);
    // вес: игрок встал на доску-качели — она наклоняется
    const { ph: ph3, SC: SC3 } = mkWorld();
    SC3.add('Part', { shape: 'cyl', pos: [0, .5, 0], size: [1, 1, 1], rot: [90, 0, 0], anchored: true });
    const plank = box(SC3, [0, 1.25, 0], [10, .5, 2], { mat: 'wood' });
    steps(SC3, 1);
    const P3 = E.player(ph3, { x: 0, z: 0 }); P3.place(4, 1.5, 0);
    const k3 = mkC();
    for (let i = 0; i < 90; i++) { k3.C.step(DT); P3.update(DT, k3.C, cam); SC3.step(DT); }
    info(`качели: доска наклонилась на ${plank.rot[2].toFixed(1)}°, игрок y=${P3.ch.y.toFixed(2)}`);
    ok(Math.abs(plank.rot[2]) > 5, 'вес игрока наклоняет доску-качели', plank.rot[2]);
  }

  // ── закреплённую деталь открепили — падает; закрепили — замирает ──
  {
    const { ph, SC } = mkWorld();
    const p = SC.add('Part', { pos: [0, 5, 0], size: [2, 2, 2], rot: [0, 30, 0] });
    const dyn = box(SC, [20, 1, 20]);   // чтобы мир Rapier был
    steps(SC, 1);
    ok(near(p.pos[1], 5, 1e-9) && !SC.rigid.isDynamic(p), 'закреплённая висит');
    SC.set(p, 'anchored', false, true);
    let minY = 9; steps(SC, 2, () => { minY = Math.min(minY, p.pos[1]); });
    info(`открепили: упала до y=${p.pos[1].toFixed(3)} (ниже всего ${minY.toFixed(3)}), поворот [${p.rot.map(v => v.toFixed(1))}]`);
    ok(SC.rigid.isDynamic(p) && near(p.pos[1], 1, .05) && minY > .75 && near(p.rot[1], 30, 1), 'открепили — упала на землю', [p.pos[1], minY]);
    ok(p._cols[0].rb && near(p._cols[0].top, 2, .05), 'тело Phys детали — движущееся, на земле', p._cols[0].top);
    SC.set(p, 'pos', [3, 6, 0], true);
    SC.set(p, 'anchored', true, true);
    steps(SC, 1);
    ok(near(p.pos[1], 6, 1e-6) && !SC.rigid.isDynamic(p) && !p._cols[0].rb && near(p._cols[0].y, 6, 1e-6), 'закрепили — замерла, тело Phys снова неподвижное');
    // закреплённая сдвинулась (как TweenService) — везёт коробку на себе
    const plat = SC.add('Part', { pos: [0, 3, -10], size: [6, 1, 6], mat: 'concrete' });
    const cargo = box(SC, [0, 4.01, -10], [1, 1, 1]);
    steps(SC, .5);
    steps(SC, 2, i => SC.set(plat, 'pos', [(i + 1) * 2 / 60, 3, -10], true));
    info(`платформа уехала на ${plat.pos[0].toFixed(2)}, груз на ${cargo.pos[0].toFixed(2)}`);
    ok(near(cargo.pos[0], plat.pos[0], .3) && cargo.pos[1] > 3.9, 'закреплённая движется (кинематика) — везёт груз');
    void dyn; void ph;
  }

  // ── рельеф (карта высот): наклонная плоскость, коробка ложится на высоту рельефа (оси карты не перепутаны) ──
  {
    const { ph, SC } = mkWorld();
    const n = 65, size = 96, half = size / 2, cell = size / (n - 1), H = new Float32Array(n * n);
    const f = (x, z) => .15 * x + .05 * z + 5;
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) H[iz * n + ix] = f(-half + ix * cell, -half + iz * cell);
    ph.terrain = { n, size, H, sample: (x, z) => { let fx = (x + half) / cell, fz = (z + half) / cell; fx = Math.max(0, Math.min(n - 1, fx)); fz = Math.max(0, Math.min(n - 1, fz)); const ix = Math.min(n - 2, fx | 0), iz = Math.min(n - 2, fz | 0), tx = fx - ix, tz = fz - iz, i = iz * n + ix; return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + n] * (1 - tx) + H[i + n + 1] * tx) * tz; } };
    const b = box(SC, [10, 12, -20], [1, 1, 1]);
    steps(SC, 3);
    const g = f(b.pos[0], b.pos[2]), lift = b.pos[1] - g;
    info(`рельеф: коробка над землёй на ${lift.toFixed(3)} (половина + наклон ≈ 0,5…0,6)`);
    ok(lift > .4 && lift < .75, 'рельеф: коробка лежит на карте высот (а не на перевёрнутой)', [b.pos, g]);
    const b2 = box(SC, [70, 30, 0], [1, 1, 1]);   // за краем рельефа — «юбка»
    steps(SC, 3);
    ok(b2.pos[1] > f(48, 0) - 15 && b2.pos[1] < 30, 'за краем рельефа не проваливается', b2.pos[1]);
  }

  // ── наклонная закреплённая доска (точная форма, не описанная коробка): шар скатывается ──
  {
    const { SC } = mkWorld();
    SC.add('Part', { pos: [0, 4, 0], size: [12, .5, 4], rot: [0, 0, 20] });   // поворот вокруг z на +20°: конец +x выше
    const ball = box(SC, [4.5, 7, 0], [1, 1, 1], { shape: 'ball' });
    let landed = 9; steps(SC, 2.5, () => { if (ball.pos[0] > -6 && ball.pos[0] < 6) landed = Math.min(landed, ball.pos[1] - (4 + Math.tan(20 * Math.PI / 180) * ball.pos[0])); });
    info(`шар по наклонной доске: x ${ball.pos[0].toFixed(2)} (начал с 4,5), над доской был ≥ ${landed.toFixed(2)}`);
    ok(ball.pos[0] < -1 && landed > .6 && landed < .95, 'шар скатился по наклонной доске (точная форма, не описанная коробка)', [ball.pos, landed]);
  }

  // ── столкновения тел; голова игрока; перестройка меша не сбивает скорость; удалить; упасть за край ──
  {
    const { ph, SC } = mkWorld();
    const target = box(SC, [0, 1, 0], [2, 2, 2]);
    const ball = box(SC, [-8, 1, 0], [1.2, 1.2, 1.2], { shape: 'ball', mat: 'metal' });
    steps(SC, .1);
    SC.rigid.setVelocity(ball, [20, 0, 0]);
    steps(SC, 1.5);
    ok(target.pos[0] > 1, 'шар сбил коробку', target.pos[0]);
    // голова: коробка падает на стоящего игрока — останавливается на макушке (потом может соскользнуть с «диска» головы)
    const P = E.player(ph, { x: 10, z: 10 }); const { C } = mkC();
    const hat = box(SC, [10, 6, 10], [1, 1, 1]);
    let caught = 0, inside = 0;
    for (let i = 0; i < 150; i++) {
      C.step(DT); P.update(DT, C, cam); SC.step(DT);
      const v = SC.rigid.getVelocity(hat)[1], d = Math.hypot(hat.pos[0] - P.ch.x, hat.pos[2] - P.ch.z);
      if (Math.abs(v) < .5 && near(hat.pos[1], P.ch.y + P.ch.h + .5, .15) && d < .6) caught++;
      if (hat.pos[1] < P.ch.y + P.ch.h - .2 && d < P.ch.r) inside++;
    }
    info(`коробка на голову: ${caught} шагов лежала на макушке, внутри игрока ${inside}`);
    ok(caught > 3 && inside === 0, 'падающая коробка ложится на голову, а не проходит сквозь игрока', [caught, inside]);
    // перестройка (цвет) посреди падения — скорость та же
    const faller = box(SC, [-20, 30, -20], [1, 1, 1]);
    steps(SC, .5);
    const v0 = SC.rigid.getVelocity(faller)[1];
    SC.set(faller, 'color', '#ff0000', true);
    SC.step(DT);
    const v1 = SC.rigid.getVelocity(faller)[1];
    ok(SC.rigid.isDynamic(faller) && near(v1, v0 - SC.rigid.gravity * DT, .2) && faller._cols[0].rb, 'смена цвета (перестройка меша) не сбивает падение', [v0, v1]);
    SC.set(faller, 'size', [2, 1, 2], true);
    SC.step(DT);
    ok(near(faller._cols[0].hx * faller._cols[0].hz, 1, .2) && SC.rigid.isDynamic(faller), 'смена размера — новая форма у того же тела');
    const nb = SC.rigid.stats().parts;
    SC.remove(faller); SC.step(DT);
    ok(SC.rigid.stats().parts === nb - 1 && !SC.rigid.isDynamic(faller), 'удалили деталь — тело убрано');
  }
  {
    const { ph, SC } = mkWorld({ ground: null });
    const b = box(SC, [0, 0, 0], [1, 1, 1]);
    let fell = null; SC.step(DT); SC.rigid.on('fallen', o => { fell = o; });
    steps(SC, 6);
    ok(fell === b && b._fallen, 'упала за край мира — событие fallen, тело выключено', b.pos[1]);
    void ph;
  }

  // ── скрипты: импульс, скорость, вращение, плотность, трение ──
  {
    const { SC } = mkWorld();
    const b = box(SC, [0, 1, 0], [2, 2, 2]);
    steps(SC, .5);
    const RG = SC.rigid, m = RG.mass(b);
    ok(near(m, .7 * 8, .01), 'масса = плотность пластика × объём', m);
    RG.applyImpulse(b, [0, 0, 5 * m]); SC.step(DT);
    ok(near(RG.getVelocity(b)[2], 5, .3), 'applyImpulse → скорость', RG.getVelocity(b));
    RG.setVelocity(b, [0, 12, 0]); ok(near(RG.getVelocity(b)[1], 12, 1e-6), 'setVelocity / getVelocity');
    RG.setAngularVelocity(b, [0, 3, 0]); SC.step(DT); ok(near(RG.getAngularVelocity(b)[1], 3, .2), 'setAngularVelocity', RG.getAngularVelocity(b));
    RG.setDensity(b, 1.4); SC.step(DT);
    ok(near(RG.mass(b), 1.4 * 8, .05), 'плотность (CustomPhysicalProperties) меняет массу', RG.mass(b));
    RG.setMassless(b, true); SC.step(DT);
    ok(near(RG.mass(b), 1.4 * 8, .05), 'Massless у одиночной детали массу не обнуляет (как в Roblox)');
    // трение: лёд против бетона — по-разному далеко
    const far = [];
    for (const mat of ['ice', 'concrete']) {
      const w = mkWorld(); const s = box(w.SC, [0, 1, 0], [2, 2, 2], { mat }); w.SC.step(DT); w.SC.rigid.setVelocity(s, [10, 0, 0]); steps(w.SC, 2); far.push(s.pos[0]);
    }
    ok(far[0] > far[1] * 2, 'лёд скользит дальше бетона', far);
    RG.setAnchored(b, true); SC.step(DT);
    ok(!RG.isDynamic(b) && b.anchored === true, 'setAnchored(true)');
  }

  // ── соединения ──
  {
    const { SC } = mkWorld();
    const RG = (box(SC, [50, 1, 50], [1, 1, 1]), SC.step(DT), SC.rigid);
    // дверь на петле к миру, пределы ±90°
    const door = box(SC, [0, 3, 0], [.2, 4, 3], { mat: 'wood' });
    const J = RG.joint('hinge', door, null, { at: [0, 3, -1.5], axis: [0, 1, 0], limits: [-90, 90] });
    RG.applyImpulse(door, [6, 0, 0], [0, 3, 1.5]);
    let maxA = 0, gap = 0;
    steps(SC, 3, () => {
      maxA = Math.max(maxA, Math.abs(J.angle()));
      const r = E.rigid.qEuler(door.rot[0], door.rot[1], door.rot[2]), hx = 2 * (r.x * r.z + r.w * r.y), hz = 1 - 2 * (r.x * r.x + r.y * r.y);   // локальная ось z детали в мире
      const hinge = [door.pos[0] - hx * 1.5, door.pos[2] - hz * 1.5]; gap = Math.max(gap, Math.hypot(hinge[0], hinge[1] + 1.5));
    });
    info(`дверь: макс угол ${maxA.toFixed(1)}°, петля уходила на ${gap.toFixed(3)}`);
    ok(maxA > 20 && maxA < 95 && gap < .08, 'шарнир (дверь на петле, пределы ±90°)', [maxA, gap]);
    // маятник на верёвке
    const bob = box(SC, [3, 8, 10], [.8, .8, .8], { shape: 'ball', mat: 'metal' });
    RG.joint('rope', bob, null, { at: [3, 8, 10], at1: [0, 8, 10], length: 3 });
    let maxD = 0, minY = 99; steps(SC, 4, () => { maxD = Math.max(maxD, Math.hypot(bob.pos[0], bob.pos[1] - 8, bob.pos[2] - 10)); minY = Math.min(minY, bob.pos[1]); });
    info(`маятник на верёвке 3: дальше всего ${maxD.toFixed(3)}, ниже всего y=${minY.toFixed(2)} (ждём 5)`);
    ok(maxD < 3.05 && near(minY, 5, .15), 'верёвка держит длину 3 (маятник)', [maxD, minY]);
    // пружина: растяжение = m·g / k
    const w = box(SC, [-10, 6, 0], [1, 1, 1]);
    const k = 60;
    RG.joint('spring', w, null, { at: [-10, 6, 0], at1: [-10, 10, 0], length: 4, stiffness: k, damping: 4 });
    steps(SC, 8);
    const ext = 10 - w.pos[1] - 4, want = RG.mass(w) * RG.gravity / k;
    info(`пружина: растяжение ${ext.toFixed(3)}, ждём m·g/k = ${want.toFixed(3)}`);
    ok(near(ext, want, want * .15 + .02), 'пружина: растяжение по закону Гука', [ext, want]);
    // сварка двух коробок — одно тело; сняли — снова два
    const a1 = box(SC, [20, 6, 0], [1, 1, 1]), a2 = box(SC, [21, 6, 0], [1, 1, 1]);
    const before = RG.stats().bodies;
    const W = RG.joint('weld', a1, a2);
    ok(RG.stats().bodies === before - 1, 'сварка: две детали — одно тело (сборка)');
    RG.setAngularVelocity(a1, [2, 1, 3]);
    let worst = 0; steps(SC, 2, () => { worst = Math.max(worst, Math.abs(Math.hypot(a1.pos[0] - a2.pos[0], a1.pos[1] - a2.pos[1], a1.pos[2] - a2.pos[2]) - 1)); });
    ok(worst < 1e-3, 'сварка держит детали жёстко', worst);
    W.remove();
    ok(RG.stats().bodies === before, 'сварку сняли — снова два тела');
    // мотор: колесо на оси крутится с заданной скоростью
    const wheel = box(SC, [-20, 3, -20], [2, .5, 2], { shape: 'cyl', rot: [0, 0, 90] });
    const M = RG.joint('hinge', wheel, null, { at: [-20, 3, -20], axis: [1, 0, 0], motor: { speed: 5, torque: 500 } });
    steps(SC, 1.5);
    const wv = RG.getAngularVelocity(wheel);
    ok(near(Math.abs(wv[0]), 5, .3) && Math.abs(wv[1]) < .2 && Math.abs(wv[2]) < .2, 'мотор шарнира: 5 рад/с вокруг оси', wv);
    M.setMotor(0, 500); steps(SC, 1);
    ok(Math.abs(RG.getAngularVelocity(wheel)[0]) < .3, 'мотор остановил колесо');
    // ползунок по x: толкаем вбок — едет только по оси
    const sl = box(SC, [0, 6, -30], [1, 1, 1]);
    RG.joint('slider', sl, null, { at: [0, 6, -30], axis: [1, 0, 0], limits: [-3, 3] });
    RG.applyImpulse(sl, [RG.mass(sl) * 4, 0, RG.mass(sl) * 4]);
    steps(SC, 2);
    ok(near(sl.pos[2], -30, .05) && near(sl.pos[1], 6, .05) && Math.abs(sl.pos[0]) > .5 && Math.abs(sl.pos[0]) <= 3.05, 'ползунок: только вдоль оси, в пределах', sl.pos);
    // шарнир между двумя телами, которые уже кувыркались (система тела поворачивается — rebase)
    const t1 = box(SC, [30, 3, 30], [2, 1, 1]), t2 = box(SC, [32, 3, 30], [2, 1, 1]);
    RG.setAngularVelocity(t1, [3, 2, 1]); RG.setAngularVelocity(t2, [-1, 4, 2]);
    steps(SC, .7);
    const piv = [(t1.pos[0] + t2.pos[0]) / 2, (t1.pos[1] + t2.pos[1]) / 2, (t1.pos[2] + t2.pos[2]) / 2];
    const H2 = RG.joint('hinge', t1, t2, { at: piv, axis: [0, 0, 1] });
    const l1 = toLocalPt(t1, piv), l2 = toLocalPt(t2, piv);
    const ax1 = toLocalPt({ pos: [0, 0, 0], rot: t1.rot }, [0, 0, 1]), ax2 = toLocalPt({ pos: [0, 0, 0], rot: t2.rot }, [0, 0, 1]);
    let sep = 0, axErr = 0;
    steps(SC, 2, () => {
      const w1 = toWorldPt(t1, l1), w2 = toWorldPt(t2, l2);
      sep = Math.max(sep, Math.hypot(w1[0] - w2[0], w1[1] - w2[1], w1[2] - w2[2]));
      const a1 = toWorldPt({ pos: [0, 0, 0], rot: t1.rot }, ax1), a2 = toWorldPt({ pos: [0, 0, 0], rot: t2.rot }, ax2);
      axErr = Math.max(axErr, Math.hypot(a1[0] - a2[0], a1[1] - a2[1], a1[2] - a2[2]));
    });
    info(`шарнир между кувыркавшимися: точки петли расходились на ${sep.toFixed(4)}, оси — на ${axErr.toFixed(4)}`);
    ok(!H2.soft && sep < .05 && axErr < .05, 'шарнир между кувыркавшимися телами (система тела поворачивается — rebase)', [H2.soft, sep, axErr]);
    // оба тела уже держат другие шарниры — запасной шарнир из двух шаровых (ось всё равно держится)
    const u1 = box(SC, [40, 8, -40], [2, 1, 1]), u2 = box(SC, [43, 8, -40], [2, 1, 1]);
    RG.joint('hinge', u1, null, { at: [39, 8, -40], axis: [0, 1, 0] }); RG.joint('slider', u2, null, { at: [43, 8, -40], axis: [1, 0, 0] });
    RG.setAngularVelocity(u1, [0, 2, 0]); steps(SC, .3);
    const q3 = toWorldPt(u1, [1, 0, 0]);
    const H3 = RG.joint('hinge', u1, u2, { at: q3, axis: [0, 0, 1] });
    const m1 = toLocalPt(u1, q3), m2 = toLocalPt(u2, q3);
    let gap3 = 0; steps(SC, 1.5, () => { const w1 = toWorldPt(u1, m1), w2 = toWorldPt(u2, m2); gap3 = Math.max(gap3, Math.hypot(w1[0] - w2[0], w1[1] - w2[1], w1[2] - w2[2])); });
    ok(H3.soft === true && gap3 < .15 && [u1, u2].every(o => o.pos.every(Number.isFinite)), 'обе стороны уже держат шарнир/ползунок — запасной шарнир из двух шаровых держит точку', [H3.soft, gap3]);
  }

  // ── пока Rapier грузится — деталь падает «по-простому», потом её подхватывает Rapier с той же скоростью ──
  {
    const { SC } = mkWorld();
    const R0 = E.rigid.R, load0 = E.rigid.load;
    E.rigid.R = null; E.rigid.ready = false; let asked = 0; E.rigid.load = () => { asked++; return Promise.resolve(false); };
    const b = box(SC, [0, 30, 0], [1, 1, 1]);
    steps(SC, .5);
    const y1 = b.pos[1], vy = b._vy;
    E.rigid.R = R0; E.rigid.ready = true; E.rigid.load = load0;
    SC.step(DT);
    const v = SC.rigid.getVelocity(b)[1];
    ok(asked > 0 && y1 < 29 && SC.rigid && near(v, vy - SC.rigid.gravity * DT, .5), 'пока Rapier грузится — простое падение, потом Rapier с той же скоростью', [asked, y1, vy, v]);
    steps(SC, 3);
    ok(near(b.pos[1], .5, .05), 'и долетела до земли', b.pos[1]);
    // «Стоп» в студии: SC.fromJSON(снимок) — физика деталей уходит, тела Phys чистые
    const snap = SC.toJSON().objects;
    const rg = SC.rigid;
    SC.fromJSON({ objects: snap });
    ok(SC.rigid === null && !rg.ok && SC.all().every(o => !o._cols?.[0]?.rb), 'fromJSON (стоп игры) — мир Rapier закрыт, тела Phys без rb');
    SC.step(DT);
    ok(SC.rigid && SC.rigid.ok && SC.rigid.isDynamic(SC.all()[0]), 'снова «Играть» — новый мир Rapier');
  }

  // ── неподвижные тела Phys без детали сцены (стройка, предметы, мир): цилиндр, коробка с поворотом, клин ──
  {
    const { ph, SC } = mkWorld();
    ph.addCyl({ x: 0, y: 1, z: 0, r: 1.5, hy: 1 });
    ph.addBox({ x: 10, y: 1.5, z: 0, hx: 2, hy: 1.5, hz: 1, yaw: .7 });
    ph.addWedge({ x: 20, y: 1, z: 0, hx: 2, hy: 1, hz: 4 });
    const a = box(SC, [0, 6, 0], [1, 1, 1]), b = box(SC, [10, 6, 0], [1, 1, 1]), c = box(SC, [20, 6, -3.5], [1, 1, 1]);
    steps(SC, 2);
    ok(near(a.pos[1], 2.5, .05) && near(b.pos[1], 3.5, .05), 'на неподвижных цилиндре и коробке Phys коробки лежат сверху', [a.pos[1], b.pos[1]]);
    ok(c.pos[2] > -3.5 && c.pos[1] < 2.6, 'с клина Phys коробка съехала', c.pos);
  }

  // ── сварка к закреплённой детали: та двигается — приваренная за ней; закрепили деталь в сборке — сборка распалась ──
  {
    const { SC } = mkWorld();
    const post = SC.add('Part', { pos: [0, 5, 0], size: [1, 1, 1] });
    const hanging = box(SC, [0, 3.5, 0], [1, 2, 1]);
    SC.step(DT);
    const RG = SC.rigid;
    RG.joint('weld', hanging, post);
    steps(SC, 1);
    ok(near(hanging.pos[1], 3.5, .05), 'приварена к закреплённой — висит', hanging.pos[1]);
    steps(SC, 2, i => SC.set(post, 'pos', [(i + 1) * 3 / 60, 5, 0], true));
    ok(near(hanging.pos[0], post.pos[0], .1) && near(hanging.pos[1], 3.5, .1), 'закреплённая уехала — приваренная за ней', [hanging.pos, post.pos]);
    // сборка из трёх: среднюю закрепили — остальные остались на ней (жёстко), сборка распалась на тела
    const p1 = box(SC, [10, 6, 0], [1, 1, 1]), p2 = box(SC, [11, 6, 0], [1, 1, 1]), p3 = box(SC, [12, 6, 0], [1, 1, 1]);
    RG.joint('weld', p1, p2); RG.joint('weld', p2, p3);
    const nb = RG.stats().bodies;
    SC.set(p2, 'anchored', true, true);
    steps(SC, 1);
    ok(RG.stats().bodies === nb + 1 && near(p1.pos[1], 6, .05) && near(p3.pos[1], 6, .05), 'среднюю закрепили — сборка распалась на 2 тела, края держатся на ней', [RG.stats().bodies, nb, p1.pos[1], p3.pos[1]]);
  }

  // ── много закреплённых деталей и одна незакреплённая: создание мира и шаг (спящие/неподвижные — бесплатно) ──
  {
    const { SC } = mkWorld();
    const R = E.rng(7);
    for (let i = 0; i < 2000; i++) SC.add('Part', { pos: [(R() - .5) * 400, R() * 6, (R() - .5) * 400], size: [1 + R() * 6, 1 + R() * 3, 1 + R() * 6], rot: [0, R() * 360, i % 5 ? 0 : R() * 30] });
    const one = box(SC, [0, 40, 0], [1, 1, 1]);
    const t0 = hr(); SC.step(DT); const create = hr() - t0;
    let fallT = hr(), fallN = 0; steps(SC, 8, () => { if (SC.rigid.active) fallN++; }); fallT = (hr() - fallT) / 480;
    const sk = SC.rigid.skipped;
    const t1 = hr(); steps(SC, 2); const idle = (hr() - t1) / 120;
    info(`2000 закреплённых + 1 незакреплённая: создание мира Rapier ${ms(create)}, шаг пока падает ${ms(fallT)}, уснула (${!SC.rigid.active}, y=${one.pos[1].toFixed(2)}) — шаг ${ms(idle)}, пропущено шагов Rapier ${SC.rigid.skipped - sk}/120`);
    ok(create < 250 && idle < .02 && SC.rigid.skipped - sk === 120, 'много закреплённых: создание < 250 мс; всё спит — шаг Rapier пропускается (< 0,02 мс)', [create, idle]);
  }

  // ── персонаж пропал (не двигается 1,5 с) — его цилиндр убран; свободные тела без сцены ──
  {
    const { ph, SC } = mkWorld();
    box(SC, [30, 1, 30], [1, 1, 1]); SC.step(DT);
    const P = E.player(ph, { x: 0, z: 0 }); const { C } = mkC();
    for (let i = 0; i < 10; i++) { C.step(DT); P.update(DT, C, cam); SC.step(DT); }
    ok(SC.rigid.stats().chars === 1, 'персонаж найден сам (ph.onChar)');
    steps(SC, 2);
    ok(SC.rigid.stats().chars === 0, 'персонаж 1,5 с без шагов — его тело убрано');
    const ball = { id: 'free1', shape: 'ball', size: [1, 1, 1], pos: [0, 5, 5], mat: 'rubber' };
    const n0 = ph.cols.size;
    SC.rigid.add(ball, { vel: [4, 0, 0] });
    ok(ph.cols.size === n0 + 1 && [...ph.cols].some(c => c.rb?.obj === ball), 'свободное тело: своё тело Phys для игрока');
    steps(SC, 1);
    ok(ball.pos[0] > 2 && near(ball.pos[1], .5, .05), 'свободное тело падает и катится', ball.pos);
    SC.rigid.remove(ball);
    ok(ph.cols.size === n0 && !SC.rigid.isDynamic(ball), 'свободное тело убрано вместе с телом Phys');
  }

  // ── CanCollide = false: незакреплённая проваливается сквозь всё (как в Roblox), игрок проходит сквозь неё ──
  {
    const { SC } = mkWorld();
    const ghost = box(SC, [0, 3, 0], [1, 1, 1], { collide: false });
    steps(SC, 1);
    ok(ghost.pos[1] < -2 && ghost._cols[0].solid === false, 'CanCollide=false — проваливается, тело Phys не твёрдое', ghost.pos[1]);
  }

  // ── касания деталь–деталь ──
  {
    const { SC } = mkWorld();
    const a = box(SC, [0, 5, 0], [1, 1, 1]), floor = SC.add('Part', { pos: [0, .5, 0], size: [6, 1, 6] });
    SC.step(DT);
    const got = [];
    SC.rigid.on('touch', e => { if (e.started) got.push([e.a?.id, e.b?.id]); });
    steps(SC, 2);
    ok(got.some(([x, y]) => x === a.id && y === floor.id), 'касание: деталь упала на плиту (Touched)', JSON.stringify(got));
  }
}

rapierTests().catch(e => { fail++; console.log('FAIL исключение', e && e.stack || e); }).finally(() => {
  console.log(`\n${pass} ок, ${fail} ошибок${skip ? ', Rapier пропущен' : ''}`);
  process.exitCode = fail ? 1 : 0;
});

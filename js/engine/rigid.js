// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — твёрдые тела (Rapier): незакреплённые детали падают, кувыркаются, скользят, лежат стопкой, бьются
//  друг о друга, о статичный мир, ландшафт и игрока; соединения как в Roblox (сварка, шарнир, шар, верёвка, пружина, ползунок)
// ═══════════════════════════════════════
// Rapier (@dimforge/rapier3d-compat 0.19.3, Apache-2.0, ≈0,6 МБ brotli) грузится лениво с jsDelivr — только когда в мире есть
// незакреплённые детали (scene.js: SC.step). Мир без них Rapier не грузит вовсе. D37E.rigid.load() → Promise<bool>.
// RG = D37E.rigid(phys, { scene, gravity, killY, pushForce, charMass }) — после загрузки (D37E.rigid.ready). Каждый шаг движка
// (1/60) — RG.step(dt); RG.dispose() — всё убрать.
// Статичный мир: каждое тело Phys (кроме триггеров) — неподвижное тело Rapier; у деталей сцены — точная форма с полным
// поворотом (наклонная доска — наклонная). Рельеф — карта высот (+ «юбка» за краем), плоская земля — большая плита.
// Закреплённую деталь сдвинули (TweenService, скрипт) — она становится кинематической и везёт то, что на ней лежит.
// Незакреплённые (anchored: false) — динамические: блок → коробка, шар → шар, цилиндр → цилиндр, клин → выпуклая оболочка,
// прочее (Mesh) — коробка по size. Масса = плотность материала × объём, трение и упругость — по материалу (как в Roblox;
// свои — obj.phys = { density, friction, elasticity }, obj.massless). Позы пишутся в obj.pos / obj.rot (градусы, YXZ) и в меш.
// Тело Rapier создаётся без поворота (поворот детали — у коллайдера): тогда оси шарниров у свежих тел совпадают всегда.
// Игрок (player.js как был): каждая движущаяся деталь — тело Phys, которое двигается на месте (c.rb — её запись): на ней
// стоят и едут, упёрся — толкает (импульс по массе, ph.onPush), стоит — давит весом, падающая деталь ложится на голову
// (кинематический цилиндр персонажа; персонажей rigid находит сам через ph.onChar). Спящие тела не стоят ничего: каждый шаг —
// только активные (forEachActiveRigidBody).
// Для скриптов (хозяин мира): RG.applyImpulse(obj, [x,y,z], at?), RG.applyAngularImpulse, RG.setVelocity / getVelocity,
// RG.setAngularVelocity / getAngularVelocity (рад/с), RG.setAnchored(obj, bool), RG.setMassless, RG.setDensity, RG.setPhysical,
// RG.mass(obj), RG.sleeping(obj), RG.wake(obj). Соединения: J = RG.joint('weld' | 'hinge' | 'ball' | 'rope' | 'spring' | 'slider',
// a, b | null (мир), { at, at1, axis, length, stiffness, damping, limits: [min, max], motor: { speed, torque }, collide }) →
// J.remove(), J.setMotor(скорость, момент), J.setServo(угол), J.setLimits(min, max), J.angle(). Сварка двух незакреплённых — одно
// тело (сборка, как в Roblox). События: RG.on('fallen', obj) — упала за край мира (тело выключено), RG.on('touch', { a, b, started })
// — деталь a коснулась b (b — деталь или null: земля, игрок); Touched деталь–деталь, включается подпиской.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const VER = '0.19.3';
  const DEG = Math.PI / 180;
  // ── Материалы: плотность, трение, упругость (Roblox; упругость × 0,6 — меньше прыгают и быстрее засыпают) ──
  const MAT = {
    plastic: [.7, .3, .3], smooth: [.7, .2, .3], neon: [.7, .3, .12], glass: [2.4, .25, .12], metal: [7.85, .4, .15], diamond: [7.85, .35, .15],
    wood: [.35, .48, .12], planks: [.35, .48, .12], brick: [1.92, .8, .09], concrete: [2.4, .7, .12], cobble: [2.69, .5, .1], asphalt: [2.36, .8, .12],
    grass: [.9, .4, .06], sand: [1.6, .5, .03], rock: [2.69, .5, .1], dirt: [.9, .45, .06], snow: [.9, .3, .02], ice: [.919, .02, .09],
    marble: [2.56, .2, .1], fabric: [.7, .35, .03], tiles: [2.7, .51, .12],
  };
  const GROUND = [1, .5, .05], PLAIN = [1, .5, .1];
  const DYN = { Part: 1, Spawn: 1, Mesh: 1 };          // кто может быть незакреплённым
  const ALL = 0xFFFFFFFF, NONE = 0xFFFF0000;          // группы столкновений: со всем / ни с чем (CanCollide = false)

  // ── Кватернионы { x, y, z, w } и эйлер YXZ в градусах (как rot в scene.js) ──
  const q = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
  const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
  function qEuler(rx, ry, rz, out = q()){
    const a = rx * DEG / 2, b = ry * DEG / 2, c = rz * DEG / 2;
    const c1 = Math.cos(a), c2 = Math.cos(b), c3 = Math.cos(c), s1 = Math.sin(a), s2 = Math.sin(b), s3 = Math.sin(c);
    out.x = s1 * c2 * c3 + c1 * s2 * s3; out.y = c1 * s2 * c3 - s1 * c2 * s3; out.z = c1 * c2 * s3 - s1 * s2 * c3; out.w = c1 * c2 * c3 + s1 * s2 * s3;
    return out;
  }
  function eulerOf(x, y, z, w, out = [0, 0, 0]){
    const m13 = 2 * (x * z + w * y), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
    const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m31 = 2 * (x * z - w * y), m11 = 1 - 2 * (y * y + z * z);
    const ex = Math.asin(-Math.max(-1, Math.min(1, m23)));
    let ey, ez;
    if (Math.abs(m23) < .9999999) { ey = Math.atan2(m13, m33); ez = Math.atan2(m21, m22); } else { ey = Math.atan2(-m31, m11); ez = 0; }
    out[0] = ex / DEG; out[1] = ey / DEG; out[2] = ez / DEG;
    return out;
  }
  function qMul(a, b, out = q()){
    const x = a.w * b.x + b.w * a.x + a.y * b.z - a.z * b.y, y = a.w * b.y + b.w * a.y + a.z * b.x - a.x * b.z;
    const z = a.w * b.z + b.w * a.z + a.x * b.y - a.y * b.x, w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    out.x = x; out.y = y; out.z = z; out.w = w; return out;
  }
  const qConj = (a, out = q()) => { out.x = -a.x; out.y = -a.y; out.z = -a.z; out.w = a.w; return out; };
  function qRot(a, v, out = v3()){   // повернуть вектор v кватернионом a (out может быть v)
    const tx = 2 * (a.y * v.z - a.z * v.y), ty = 2 * (a.z * v.x - a.x * v.z), tz = 2 * (a.x * v.y - a.y * v.x);
    const x = v.x + a.w * tx + (a.y * tz - a.z * ty), y = v.y + a.w * ty + (a.z * tx - a.x * tz), z = v.z + a.w * tz + (a.x * ty - a.y * tx);
    out.x = x; out.y = y; out.z = z; return out;
  }
  const qSame = (a, b, e = 1e-4) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) + Math.abs(a.w - b.w) < e || Math.abs(a.x + b.x) + Math.abs(a.y + b.y) + Math.abs(a.z + b.z) + Math.abs(a.w + b.w) < e;
  const arr3 = a => Array.isArray(a) ? v3(+a[0] || 0, +a[1] || 0, +a[2] || 0) : a && typeof a === 'object' ? v3(+(a.x ?? a.X) || 0, +(a.y ?? a.Y) || 0, +(a.z ?? a.Z) || 0) : v3();
  const rotOf = (ob, out = q()) => qEuler(+ob.rot?.[0] || 0, +ob.rot?.[1] || 0, +ob.rot?.[2] || 0, out);

  // ── Формы деталей (размер — полный, как size в scene.js) ──
  function hullDesc(RA, pts){ return RA.ColliderDesc.convexHull(new Float32Array(pts)); }
  function wedgePts(hx, hy, hz){ return [-hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz, -hx, hy, -hz, hx, hy, -hz]; }
  function partDesc(RA, o){
    const s = o.size || [1, 1, 1], hx = Math.max(.025, Math.abs(s[0]) / 2), hy = Math.max(.025, Math.abs(s[1]) / 2), hz = Math.max(.025, Math.abs(s[2]) / 2);
    const same = (a, b) => Math.abs(a - b) <= .02 * Math.max(a, b);
    let d = null;
    if (o.shape === 'ball') {
      if (same(hx, hy) && same(hx, hz)) d = RA.ColliderDesc.ball((hx + hy + hz) / 3);
      else {   // эллипсоид — выпуклая оболочка точек
        const pts = [0, hy, 0, 0, -hy, 0];
        for (let i = 1; i < 8; i++) { const la = Math.PI * i / 8, cy = Math.cos(la), sy = Math.sin(la); for (let j = 0; j < 14; j++) { const lo = 2 * Math.PI * j / 14; pts.push(hx * sy * Math.cos(lo), hy * cy, hz * sy * Math.sin(lo)); } }
        d = hullDesc(RA, pts);
      }
    } else if (o.shape === 'cyl') {
      if (same(hx, hz)) d = RA.ColliderDesc.cylinder(hy, (hx + hz) / 2);
      else { const pts = []; for (let j = 0; j < 24; j++) { const a = 2 * Math.PI * j / 24, x = hx * Math.cos(a), z = hz * Math.sin(a); pts.push(x, -hy, z, x, hy, z); } d = hullDesc(RA, pts); }
    } else if (o.shape === 'wedge') d = hullDesc(RA, wedgePts(hx, hy, hz));
    return d || RA.ColliderDesc.cuboid(hx, hy, hz);
  }
  function physDesc(RA, c){
    const hx = Math.max(.01, c.hx), hy = Math.max(.01, c.hy), hz = Math.max(.01, c.hz);
    if (c.type === 'cyl') return RA.ColliderDesc.cylinder(hy, Math.max(.01, c.r));
    if (c.type === 'wedge') return hullDesc(RA, wedgePts(hx, hy, hz)) || RA.ColliderDesc.cuboid(hx, hy, hz);
    return RA.ColliderDesc.cuboid(hx, hy, hz);
  }
  // плотность / трение / упругость детали
  function matOf(o){
    const m = MAT[o.mat] || MAT.plastic, p = o.phys;
    if (!p || typeof p !== 'object') return m;
    const n = (v, d, lo, hi) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d;
    return [n(p.density, m[0], .01, 100), n(p.friction, m[1], 0, 2), n(p.elasticity, m[2], 0, 1)];
  }

  // Не создался (сбой внутри Rapier) — пустышка: детали просто стоят, игра живёт, каждый кадр не падает
  E.rigid = function (ph, o = {}){
    if (!E.rigid.R) throw new Error('D37E.rigid: Rapier ещё не загружен — сначала D37E.rigid.load()');
    try { return create(ph, o); }
    catch (e) {
      console.error('D37E.rigid: мир твёрдых тел не создался —', e);
      const no = () => false;
      return { ok: false, error: e, active: 0, ms: 0, moved: new Set(), step(){}, changed(){}, dispose(){}, on: () => () => {}, joint: () => null, isDynamic: no, applyImpulse: no, setVelocity: no, getVelocity: () => [0, 0, 0], stats: () => ({}) };
    }
  };
  function create(ph, o){
    const RA = E.rigid.R;
    const U = E.UNIT || 2.1 / 1.8, scene = o.scene || null, ev = E.emitter ? E.emitter() : null;
    const RG = { ok: true, ph, scene, RA, gravity: o.gravity ?? 20 * U, killY: o.killY ?? -200, pushForce: o.pushForce ?? 700, charMass: o.charMass ?? 15,
      stepNo: 0, ms: 0, active: 0, moved: new Set() };
    const world = RG.world = new RA.World(v3(0, -RG.gravity, 0));
    world.timestep = 1 / 60;
    world.lengthUnit = U;   // 1 м = U единиц движка: пороги сна и допуски Rapier — в настоящих метрах (куча засыпает вдвое быстрее)
    const parts = new Map();        // id объекта → деталь P { obj, asm, col, proxy: [тела Phys], lp, lq, welds }
    const stat = new Map();         // тело Phys → неподвижное St { c, obj, owner, col, body, key, x, y, z, q }
    const chars = new Map();        // персонаж Phys → C { body, col, seen, … }
    const byCol = new Map();        // хэндл коллайдера Rapier → P или St (касания)
    const joints = new Set();
    const orphans = new Set();
    let groundCols = [], groundSrc, groundBody = null, touchOn = false, eq = null;
    const pushes = [], pushed = [];
    let check = [], awakeNow = [], listId = 1;   // awakeNow — кого проверить после следующего шага (уснул — записать позу последний раз)
    let kick = true;                             // что-то поменялось (разбудили, сдвинули статичное, убрали тело) — шаг Rapier нужен
    RG.skipped = 0;
    // общие объекты для вызовов Rapier (без new на каждый шаг)
    const TV = v3(), TV2 = v3(), TQ = q(), TQ2 = q(), SPEC = { x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 0, r: 0, yaw: 0 }, EU = [0, 0, 0];

    // ═══ Земля: карта высот рельефа или плита ═══
    function buildGround(){
      for (const c of groundCols) world.removeCollider(c, false);
      groundCols = []; kick = true;
      const T = ph.terrain;
      groundSrc = T || ph.ground;
      const add = d => { groundCols.push(world.createCollider(d.setFriction(GROUND[1]).setRestitution(GROUND[2]))); };
      if (T && typeof T.sample === 'function') {
        let n = T.n | 0, size = +T.size || 0, H = T.H;
        if (!(n > 1 && size > 0 && H && H.length >= n * n)) {   // рельеф без сетки — снимаем высоты сами
          n = 129; size = size || 192; H = new Float32Array(n * n);
          for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) H[iz * n + ix] = T.sample(-size / 2 + ix * size / (n - 1), -size / 2 + iz * size / (n - 1));
        }
        // Rapier: строки — вдоль z, столбцы — вдоль x, матрица по столбцам: [iz + ix · n]
        const hs = new Float32Array(n * n);
        let eN = Infinity, eS = Infinity, eW = Infinity, eE = Infinity;
        for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) hs[iz + ix * n] = H[iz * n + ix];
        for (let i = 0; i < n; i++) { eN = Math.min(eN, H[i]); eS = Math.min(eS, H[(n - 1) * n + i]); eW = Math.min(eW, H[i * n]); eE = Math.min(eE, H[i * n + n - 1]); }
        add(RA.ColliderDesc.heightfield(n - 1, n - 1, hs, v3(size, 1, size)));
        // «юбка» за краем (рельеф за краем тянется крайними высотами): плиты по самой низкой точке своего края
        const h = size / 2, L = 2000, D = 100;
        add(RA.ColliderDesc.cuboid(h + L, D, L / 2).setTranslation(0, eN - D, -h - L / 2));
        add(RA.ColliderDesc.cuboid(h + L, D, L / 2).setTranslation(0, eS - D, h + L / 2));
        add(RA.ColliderDesc.cuboid(L / 2, D, h).setTranslation(-h - L / 2, eW - D, 0));
        add(RA.ColliderDesc.cuboid(L / 2, D, h).setTranslation(h + L / 2, eE - D, 0));
      } else if (ph.ground != null) add(RA.ColliderDesc.cuboid(5000, 50, 5000).setTranslation(0, ph.ground - 50, 0));
    }
    RG.refreshTerrain = buildGround;

    // ═══ Статичный мир (тела Phys) ═══
    const ownerOf = c => scene && c.data && c.data.part != null ? scene.get(c.data.part) : null;
    const exactOf = ob => ob && (ob.cls === 'Part' || ob.cls === 'Spawn') && ob.pos && ob.size ? ob : null;
    function poseOfStatic(St){
      const ob = St.obj, c = St.c;
      if (ob) { St.nx = +ob.pos[0] || 0; St.ny = +ob.pos[1] || 0; St.nz = +ob.pos[2] || 0; rotOf(ob, St.nq); }
      else { St.nx = c.x; St.ny = c.y; St.nz = c.z; const h = (c.type === 'cyl' ? 0 : c.yaw) / 2; St.nq.x = 0; St.nq.y = Math.sin(h); St.nq.z = 0; St.nq.w = Math.cos(h); }
    }
    function takePose(St){ St.x = St.nx; St.y = St.ny; St.z = St.nz; St.q.x = St.nq.x; St.q.y = St.nq.y; St.q.z = St.nq.z; St.q.w = St.nq.w; }
    // форма та же? (числами, без строк: у двигающихся каждый шаг деталей это горячий путь)
    function sameShape(St){
      const ob = St.obj, c = St.c, k = St.k;
      if (ob) { const s = ob.size || k; return k[0] === s[0] && k[1] === s[1] && k[2] === s[2] && k[3] === ob.shape && k[4] === ob.mat && k[5] === ob.phys; }
      return k[0] === c.hx && k[1] === c.hy && k[2] === c.hz && k[3] === c.type && k[4] === c.r;
    }
    function keepShape(St){
      const ob = St.obj, c = St.c, k = St.k;
      if (ob) { const s = ob.size || [1, 1, 1]; k[0] = s[0]; k[1] = s[1]; k[2] = s[2]; k[3] = ob.shape; k[4] = ob.mat; k[5] = ob.phys; }
      else { k[0] = c.hx; k[1] = c.hy; k[2] = c.hz; k[3] = c.type; k[4] = c.r; k[5] = null; }
    }
    function staticCollider(St){
      keepShape(St);
      const ob = St.obj, d = ob ? partDesc(RA, ob) : physDesc(RA, St.c), m = ob ? matOf(ob) : PLAIN;
      d.setFriction(m[1]).setRestitution(m[2]);
      if (touchOn) d.setActiveEvents(RA.ActiveEvents.COLLISION_EVENTS);
      if (!St.body) d.setTranslation(St.x, St.y, St.z).setRotation(St.q);
      St.col = world.createCollider(d, St.body || undefined);
      byCol.set(St.col.handle, St);
      kick = true;
    }
    function addStatic(c){
      const owner = ownerOf(c);
      const St = { c, obj: exactOf(owner), owner, col: null, body: null, k: [0, 0, 0, '', '', null], x: 0, y: 0, z: 0, q: q(), nx: 0, ny: 0, nz: 0, nq: q() };
      stat.set(c, St);
      if (c.solid && !c.trigger) { poseOfStatic(St); takePose(St); staticCollider(St); }
      return St;
    }
    function dropStaticCol(St){ if (St.col) { byCol.delete(St.col.handle); world.removeCollider(St.col, true); St.col = null; kick = true; } }
    function removeStatic(c){
      const St = stat.get(c); if (!St) return;
      stat.delete(c);
      dropStaticCol(St);
      if (St.body) { world.removeRigidBody(St.body); St.body = null; kick = true; }
      if (St.owner) for (const J of joints) if (J.ob === St.owner || J.oa === St.owner) J.dirty = true;
    }
    // закреплённая деталь двинулась (или к ней прицепили соединение): кинематическое тело — везёт то, что на ней лежит
    function promote(St){
      if (St.body) return St.body;
      St.body = world.createRigidBody(RA.RigidBodyDesc.kinematicPositionBased().setTranslation(St.x, St.y, St.z).setRotation(St.q));
      if (St.col) { dropStaticCol(St); staticCollider(St); }
      return St.body;
    }
    function updateStatic(St){
      const c = St.c;
      if (!c.solid || c.trigger) { dropStaticCol(St); return; }
      poseOfStatic(St);
      if (!St.col) {   // снова твёрдое
        takePose(St);
        if (St.body) { TV.x = St.x; TV.y = St.y; TV.z = St.z; St.body.setTranslation(TV, true); St.body.setRotation(St.q, true); }
        staticCollider(St);
        return;
      }
      const moved = Math.abs(St.nx - St.x) + Math.abs(St.ny - St.y) + Math.abs(St.nz - St.z) > 1e-6 || !qSame(St.nq, St.q, 1e-7);
      const reshaped = !sameShape(St);
      if (moved) {
        const jump = Math.hypot(St.nx - St.x, St.ny - St.y, St.nz - St.z) > 3;   // телепорт — без скорости
        promote(St);
        takePose(St);
        TV.x = St.x; TV.y = St.y; TV.z = St.z;
        if (jump) { St.body.setTranslation(TV, true); St.body.setRotation(St.q, true); }
        else { St.body.setNextKinematicTranslation(TV); St.body.setNextKinematicRotation(St.q); }
        kick = true;
      }
      if (reshaped) { dropStaticCol(St); staticCollider(St); }
    }
    const staticOf = ob => { if (!ob || !ob._cols) return null; for (const c of ob._cols) { const St = stat.get(c); if (St && St.col) return St; } return null; };

    // ═══ Динамические детали ═══
    const wants = ob => !!ob && ob.anchored === false && !!DYN[ob.cls] && !!ob.pos;
    function makeAsm(body){ const A = { body, parts: [], joints: new Set(), dead: false, fallen: false, seen: -1, listed: 0, tx: 0, ty: 0, tz: 0, q: q(), pushStep: -1, pushInto: 0, pushNx: 0, pushNz: 0, pushCh: null }; body.userData = A; return A; }
    function partCollider(P, body){
      const ob = P.obj, m = matOf(ob), d = partDesc(RA, ob);
      d.setTranslation(P.lp.x, P.lp.y, P.lp.z).setRotation(P.lq);
      const solo = !P.asm || P.asm.parts.length <= 1;
      d.setDensity(ob.massless && !solo ? 1e-4 : m[0]).setFriction(m[1]).setRestitution(m[2]);
      d.setCollisionGroups(ob.collide === false ? NONE : ALL);
      if (touchOn) d.setActiveEvents(RA.ActiveEvents.COLLISION_EVENTS);
      const col = world.createCollider(d, body);
      byCol.set(col.handle, P);
      return col;
    }
    const newBody = (x, y, z, rolls, small) => world.createRigidBody(RA.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(true)
      .setLinearDamping(.02).setAngularDamping(rolls ? .35 : .1).setCcdEnabled(!!small));
    // новая деталь со своим телом
    function makePart(ob){
      const s = ob.size || [1, 1, 1], small = Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) < 1;
      const body = newBody(+ob.pos[0] || 0, +ob.pos[1] || 0, +ob.pos[2] || 0, ob.shape === 'ball' || ob.shape === 'cyl', small);
      if (ob._vy) { body.setLinvel(v3(0, ob._vy, 0), true); ob._vy = 0; }   // падала по-простому, пока грузился Rapier
      const A = makeAsm(body);
      const P = { obj: ob, asm: A, col: null, proxy: [], lp: v3(), lq: rotOf(ob), welds: new Set(), free: false };
      A.parts.push(P);
      P.col = partCollider(P, body);
      parts.set(ob.id, P);
      if (ob._mesh) ob._mesh.userData.dyn = true;
      wake(A);
      return P;
    }
    function adoptProxy(P, c){
      if (stat.has(c)) removeStatic(c);
      c.rb = P;
      if (!P.proxy.includes(c)) P.proxy.push(c);
      orphans.delete(P);
      writeProxy(P, c);
    }
    function dropCol(P){ if (P.col) { byCol.delete(P.col.handle); world.removeCollider(P.col, true); P.col = null; kick = true; } }
    // убрать деталь из её тела (тело без деталей — удаляется)
    function detach(P){
      const A = P.asm; if (!A) return;
      dropCol(P);
      const i = A.parts.indexOf(P); if (i >= 0) A.parts.splice(i, 1);
      P.asm = null;
      if (!A.parts.length) { for (const J of A.joints) { dropRaw(J); J.dirty = true; } A.joints.clear(); world.removeRigidBody(A.body); A.body.userData = null; A.dead = true; }
      else { A.body.wakeUp(); wake(A); }
    }
    function destroyPart(P){
      detach(P);
      for (const c of P.proxy) { c.rb = null; c.kick = false; }
      P.proxy.length = 0;
      parts.delete(P.obj.id);
      orphans.delete(P);
      for (const J of joints) if (J.oa === P.obj || J.ob === P.obj) J.dirty = true;
    }
    function makeDynamic(ob){
      if (parts.has(ob.id) || !wants(ob)) return parts.get(ob.id) || null;
      const P = makePart(ob);
      for (const c of ob._cols || []) adoptProxy(P, c);
      relink(ob);
      return P;
    }
    function makeStatic(P){
      const ob = P.obj, cs = P.proxy.slice(), A = P.asm, rest = A ? A.parts.filter(p => p !== P) : [];
      destroyPart(P);
      if (scene && scene.colliders && scene.get(ob.id) === ob) scene.colliders(ob);   // те же тела Phys на месте → 'move' → неподвижные
      for (const c of cs) if (!stat.has(c) && ph.cols.has(c)) onAdd(c);
      if (rest.length) split(rest[0].asm);
      relink(ob);
    }
    // соединения и сварки детали после смены закреплена/нет: пересобрать
    function relink(ob){ for (const J of joints) if (J.oa === ob || J.ob === ob) { J.dirty = true; build(J); } }
    // поза тела, чтобы деталь P оказалась в (px, py, pz, pq)
    function bodyTo(P, px, py, pz, pq){
      const b = P.asm.body;
      qMul(pq, qConj(P.lq, TQ2), TQ);
      qRot(TQ, P.lp, TV2);
      TV.x = px - TV2.x; TV.y = py - TV2.y; TV.z = pz - TV2.z;
      b.setTranslation(TV, true); b.setRotation(TQ, true);
    }
    function teleport(P){ const ob = P.obj; bodyTo(P, +ob.pos[0] || 0, +ob.pos[1] || 0, +ob.pos[2] || 0, rotOf(ob, q())); wake(P.asm); }
    function refreshCollider(P){
      const A = P.asm; if (!A) return;
      if (P.col) { byCol.delete(P.col.handle); world.removeCollider(P.col, false); }
      P.col = partCollider(P, A.body);
      A.body.wakeUp(); wake(A);
    }
    function wake(A){ kick = true; if (A && A.listed !== listId) { A.listed = listId; awakeNow.push(A); } }

    // ── Тело Phys для игрока: коробка с поворотом вокруг Y (наклонённая — описанная коробка), клин, цилиндр ──
    function writeProxy(P, c, px, py, pz, qq){
      const ob = P.obj, s = ob.size || [1, 1, 1], h0 = Math.abs(s[0]) / 2, h1 = Math.abs(s[1]) / 2, h2 = Math.abs(s[2]) / 2;
      if (px === undefined) { px = +ob.pos[0] || 0; py = +ob.pos[1] || 0; pz = +ob.pos[2] || 0; qq = rotOf(ob, TQ2); }
      const x = qq.x, y = qq.y, z = qq.z, w = qq.w;
      const m00 = 1 - 2 * (y * y + z * z), m01 = 2 * (x * y - w * z), m02 = 2 * (x * z + w * y);
      const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - w * x);
      const m20 = 2 * (x * z - w * y), m21 = 2 * (y * z + w * x), m22 = 1 - 2 * (x * x + y * y);
      const a0 = Math.abs(m10), a1 = Math.abs(m11), a2 = Math.abs(m12);
      SPEC.x = px; SPEC.y = py; SPEC.z = pz;
      let type = 'box';
      if (ob.shape === 'ball' && Math.abs(h0 - h1) < .02 * h0 && Math.abs(h0 - h2) < .02 * h0) { type = 'cyl'; SPEC.r = h0; SPEC.hy = h0; }
      else if (a1 > .999 && (ob.shape === 'cyl' || ob.shape === 'ball')) { type = 'cyl'; SPEC.r = Math.max(h0, h2); SPEC.hy = h1; }
      else if (ob.shape === 'wedge' && m11 > .999) { type = 'wedge'; SPEC.yaw = Math.atan2(-m20, m00); SPEC.hx = h0; SPEC.hy = h1; SPEC.hz = h2; SPEC.r = 0; }
      else {
        // самая «вертикальная» ось детали — вверх; поворот (yaw) — по самой горизонтальной из двух других
        const k = a1 >= a0 && a1 >= a2 ? 1 : a0 >= a2 ? 0 : 2;
        let jx, jz;
        if (k === 1) { if (m00 * m00 + m20 * m20 >= m02 * m02 + m22 * m22) { jx = m00; jz = m20; } else { jx = m02; jz = m22; } }
        else if (k === 0) { if (m01 * m01 + m21 * m21 >= m02 * m02 + m22 * m22) { jx = m01; jz = m21; } else { jx = m02; jz = m22; } }
        else if (m00 * m00 + m20 * m20 >= m01 * m01 + m21 * m21) { jx = m00; jz = m20; } else { jx = m01; jz = m21; }
        const yaw = Math.atan2(-jz, jx), cs = Math.cos(yaw), sn = Math.sin(yaw);
        SPEC.yaw = yaw; SPEC.r = 0;
        SPEC.hx = Math.abs(cs * m00 - sn * m20) * h0 + Math.abs(cs * m01 - sn * m21) * h1 + Math.abs(cs * m02 - sn * m22) * h2;
        SPEC.hy = a0 * h0 + a1 * h1 + a2 * h2;
        SPEC.hz = Math.abs(sn * m00 + cs * m20) * h0 + Math.abs(sn * m01 + cs * m21) * h1 + Math.abs(sn * m02 + cs * m22) * h2;
      }
      if (type === 'cyl') { SPEC.yaw = 0; SPEC.hx = SPEC.hz = SPEC.r; }
      ph.update(c, SPEC, type, true);
      c.kick = SPEC.hy < .3 && SPEC.hx < .6 && SPEC.hz < .6;   // мелочь ниже ступеньки — игрок её пинает, а не залезает
    }
    function writePart(P, A){
      let px = A.tx, py = A.ty, pz = A.tz;
      const lp = P.lp;
      if (lp.x || lp.y || lp.z) { qRot(A.q, lp, TV2); px += TV2.x; py += TV2.y; pz += TV2.z; }
      const pq = qMul(A.q, P.lq, TQ);
      const ob = P.obj, pos = ob.pos;
      pos[0] = px; pos[1] = py; pos[2] = pz;
      eulerOf(pq.x, pq.y, pq.z, pq.w, EU);
      const rot = ob.rot || (ob.rot = [0, 0, 0]);
      rot[0] = EU[0]; rot[1] = EU[1]; rot[2] = EU[2];
      const m = ob._mesh;
      if (m) { m.position.set(px, py, pz); m.quaternion.set(pq.x, pq.y, pq.z, pq.w); if (!m.userData.dyn) m.userData.dyn = true; }
      for (let i = 0; i < P.proxy.length; i++) writeProxy(P, P.proxy[i], px, py, pz, pq);
      RG.moved.add(ob);
    }
    function readBody(A){
      const b = A.body, t = b.translation(), r = b.rotation();
      A.tx = t.x; A.ty = t.y; A.tz = t.z; A.q.x = r.x; A.q.y = r.y; A.q.z = r.z; A.q.w = r.w;
    }
    function writeAsm(A){
      if (A.dead || A.fallen) return;
      readBody(A);
      if (A.ty < RG.killY) { fallen(A); return; }
      for (let i = 0; i < A.parts.length; i++) writePart(A.parts[i], A);
    }
    function fallen(A){
      A.fallen = true;
      A.body.setEnabled(false);
      for (const P of A.parts) { P.obj._fallen = true; ev?.emit('fallen', P.obj); }
    }

    // ═══ Персонажи: кинематический цилиндр выше ступеньки (на него ложится то, что падает), толчки, вес, «езда» ═══
    function charOf(ch){
      let C = chars.get(ch);
      if (!C) { C = { ch, body: null, col: null, seen: RG.stepNo, perm: false, hh: 0, r: 0, mass: RG.charMass, carry: false, onP: null, rel: v3(), onDone: false }; chars.set(ch, C); }
      return C;
    }
    // jump — перенести без скорости (шаг Rapier пропущен или телепорт)
    function charBody(C, jump){
      const ch = C.ch, bot = Math.min((ch.step ?? .62) + .05, ch.h * .45), hh = Math.max(.1, (ch.h - bot) / 2), r = ch.r * .9;
      TV.x = ch.x; TV.y = ch.y + bot + hh; TV.z = ch.z;
      if (!C.body) {
        C.body = world.createRigidBody(RA.RigidBodyDesc.kinematicPositionBased().setTranslation(TV.x, TV.y, TV.z));
        C.col = world.createCollider(RA.ColliderDesc.cylinder(hh, r).setFriction(.6).setRestitution(0), C.body);
        C.hh = hh; C.r = r; C.x = TV.x; C.y = TV.y; C.z = TV.z;
        return;
      }
      if (Math.abs(hh - C.hh) > .02 || Math.abs(r - C.r) > .01) { C.col.setHalfHeight(hh); C.col.setRadius(r); C.hh = hh; C.r = r; }
      const d = Math.abs(C.x - TV.x) + Math.abs(C.y - TV.y) + Math.abs(C.z - TV.z);
      if (d < 1e-7) return;
      if (jump || d > 3) C.body.setTranslation(TV, false); else C.body.setNextKinematicTranslation(TV);
      C.x = TV.x; C.y = TV.y; C.z = TV.z;
    }
    // рядом с персонажем есть незакреплённая деталь (тогда шаг Rapier нужен, даже если всё спит)
    const NEAR = [];
    function nearDyn(ch){
      const R = ch.r + 1, list = ph.query(ch.x - R, ch.z - R, ch.x + R, ch.z + R, NEAR);
      let hit = false;
      for (let i = 0; i < list.length; i++) { const c = list[i]; if (c.rb && c.rb.asm && c.top > ch.y - 1 && c.bottom < ch.y + ch.h + 1) { hit = true; break; } }
      list.length = 0;
      return hit;
    }
    function dropChar(C){ if (C.body) world.removeRigidBody(C.body); C.body = C.col = null; chars.delete(C.ch); }
    const onChar = ch => { charOf(ch).seen = RG.stepNo; };
    const onPush = (ch, c, nx, nz, into) => { pushes.push(ch, c, nx, nz, into); };
    RG.addCharacter = (ch, opt = {}) => { const C = charOf(ch); C.perm = true; C.seen = RG.stepNo; if (opt.mass != null) C.mass = +opt.mass || 0; if (opt.carry != null) C.carry = !!opt.carry; return C; };
    RG.removeCharacter = ch => { const C = chars.get(ch); if (C) dropChar(C); };
    // толчки и вес персонажей; вернёт, есть ли рядом с кем-то незакреплённая деталь
    function stepChars(dt){
      let near = false;
      // толчки: на тело — самый сильный за шаг; импульс — чтобы догнать скорость персонажа, но не больше «силы рук» × dt
      for (let i = 0; i < pushes.length; i += 5) {
        const c = pushes[i + 1], P = c.rb, A = P && P.asm;
        if (!A || A.dead || A.fallen) continue;
        const into = pushes[i + 4];
        if (A.pushStep !== RG.stepNo) { A.pushStep = RG.stepNo; A.pushInto = 0; pushed.push(A); }
        if (into > A.pushInto) { A.pushInto = into; A.pushCh = pushes[i]; A.pushNx = pushes[i + 2]; A.pushNz = pushes[i + 3]; }
      }
      pushes.length = 0;
      for (let i = 0; i < pushed.length; i++) {
        const A = pushed[i], b = A.body, ch = A.pushCh, dx = -A.pushNx, dz = -A.pushNz, v = b.linvel(), need = A.pushInto - (v.x * dx + v.z * dz);
        if (need <= 0) continue;
        const J = Math.min(b.mass() * need, RG.pushForce * dt), com = b.worldCom();
        TV.x = dx * J; TV.y = 0; TV.z = dz * J;
        TV2.x = ch.x + dx * ch.r; TV2.y = com.y; TV2.z = ch.z + dz * ch.r;
        b.applyImpulseAtPoint(TV, TV2, true);
        wake(A);
      }
      pushed.length = 0;
      for (const C of chars.values()) {
        const ch = C.ch;
        if (!C.perm && RG.stepNo - C.seen > 90) { dropChar(C); continue; }   // 1,5 с без шагов — персонажа нет
        if (!near && C.body && nearDyn(ch)) near = true;
        // стоит на движущейся детали — давит весом (качели опускаются); спящую будим, только когда встал на неё
        const P = ch.grounded && ch.onCol && ch.onCol.rb, A = P && P.asm;
        if (A && !A.dead && !A.fallen && C.mass > 0) {
          const landed = C.onP !== P;   // только что встал — разбудить; дальше давит, не мешая телу уснуть (качели в покое спят)
          if (landed || !A.body.isSleeping()) {
            TV.x = 0; TV.y = -C.mass * RG.gravity * dt; TV.z = 0; TV2.x = ch.x; TV2.y = ch.y; TV2.z = ch.z;
            A.body.applyImpulseAtPoint(TV, TV2, landed);
            if (landed) wake(A);
          }
        }
        C.onP = P || null;
        // «езда»: запомнить, где стоит в системе детали (после шага — передвинуть вместе с ней)
        C.onDone = false;
        if (C.carry && P && P.asm) {
          const pos = P.obj.pos;
          rotOf(P.obj, TQ2);
          qRot(qConj(TQ2, TQ2), v3(ch.x - pos[0], ch.y - pos[1], ch.z - pos[2]), C.rel);
          C.onDone = true;
        }
      }
      return near;
    }
    function carryChars(){
      for (const C of chars.values()) {
        if (!C.onDone || !C.onP || !C.onP.asm) continue;
        const ob = C.onP.obj, pos = ob.pos, w = qRot(rotOf(ob, TQ2), C.rel, TV2);
        C.ch.x = pos[0] + w.x; C.ch.z = pos[2] + w.z; C.ch.y = pos[1] + w.y;
      }
    }

    // ═══ Шаг ═══
    // ошибка внутри шага (не должна, но) — физика деталей останавливается, игра живёт дальше (детали просто замирают)
    RG.step = (dt = 1 / 60) => {
      if (!RG.ok) return;
      try { step(dt); } catch (e) { RG.ok = false; RG.error = e; console.error('D37E.rigid: физика деталей остановлена —', e); ev?.emit('error', e); }
    };
    function step(dt){
      const t0 = now();
      RG.stepNo++;
      RG.moved.clear();
      // убрали деталь из сцены — убрать и тело (перестройка меша/тел Phys не считается: тело Phys вернулось в том же шаге)
      if (orphans.size) {
        for (const P of orphans) {
          if (P.proxy.length) continue;
          const ob = P.obj;
          if (P.free || (scene && scene.get(ob.id) === ob)) continue;
          destroyPart(P);
          for (const J of [...joints]) if (J.oa === ob || J.ob === ob) J.remove();
        }
        orphans.clear();
      }
      if ((ph.terrain || ph.ground) !== groundSrc) buildGround();
      for (let pass = 0; pass < 3; pass++) { let any = false; for (const J of joints) if (J.dirty) { any = true; build(J); } if (!any) break; }
      // кого проверить после шага: кто был активен в прошлый раз + кого будили между шагами
      const list = check; check = awakeNow; awakeNow = list; awakeNow.length = 0; listId++;
      const near = stepChars(dt);
      // всё спит, никого не будили, статичный мир не менялся, рядом с персонажами нет деталей — шаг Rapier не нужен вовсе
      // (даже спящий мир Rapier стоит ~0,05 мс на 1000 коллайдеров за шаг)
      const need = kick || RG.active > 0 || near || check.length > 0;
      kick = false;
      for (const C of chars.values()) charBody(C, !need);
      if (!need) { RG.skipped++; RG.msWorld = 0; RG.ms = now() - t0; return; }
      world.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
      const tw = now();
      if (touchOn) { world.step(eq); eq.drainCollisionEvents(onContact); } else world.step();
      RG.msWorld = now() - tw;
      // позы — только у активных (спящие ничего не стоят); уснувшие за этот шаг — последний раз
      let n = 0;
      const sn = RG.stepNo;
      world.forEachActiveRigidBody(b => { const A = b.userData; if (!A || !A.parts) return; n++; A.seen = sn; writeAsm(A); wake(A); });
      for (let i = 0; i < check.length; i++) { const A = check[i]; if (A.seen !== sn && !A.dead) { A.seen = sn; writeAsm(A); } }
      check.length = 0;
      carryChars();
      RG.active = n;
      RG.ms = now() - t0;
    }
    const now = () => (root.performance ? root.performance.now() : Date.now());

    // ═══ Сцена сообщает: свойство поменялось (SC.set → RG.changed) ═══
    RG.changed = (ob, key) => {
      if (!ob || !RG.ok) return;
      const P = parts.get(ob.id);
      if (key === 'anchored') { if (wants(ob)) { if (!P) makeDynamic(ob); } else if (P) makeStatic(P); return; }
      if (!P) return;
      if (key === 'pos' || key === 'rot') teleport(P);
      else if (key === 'size' || key === 'shape' || key === 'mat' || key === 'phys' || key === 'massless') refreshCollider(P);
      else if (key === 'collide') { if (P.col) P.col.setCollisionGroups(ob.collide === false ? NONE : ALL); if (P.asm) { P.asm.body.wakeUp(); wake(P.asm); } }
    };

    // ═══ Для скриптов ═══
    const partOf = ob => ob ? parts.get(typeof ob === 'string' ? ob : ob.id) || null : null;
    const bodyOf = ob => { const P = partOf(ob); return P && P.asm && !P.asm.dead ? P.asm.body : null; };
    RG.isDynamic = ob => !!partOf(ob);
    RG.applyImpulse = (ob, v, at) => { const b = bodyOf(ob); if (!b) return false; if (at) b.applyImpulseAtPoint(arr3(v), arr3(at), true); else b.applyImpulse(arr3(v), true); wake(b.userData); return true; };
    RG.applyAngularImpulse = (ob, v) => { const b = bodyOf(ob); if (!b) return false; b.applyTorqueImpulse(arr3(v), true); wake(b.userData); return true; };
    RG.setVelocity = (ob, v) => { const b = bodyOf(ob); if (!b) return false; b.setLinvel(arr3(v), true); wake(b.userData); return true; };
    RG.getVelocity = ob => { const b = bodyOf(ob); if (!b) return [0, 0, 0]; const v = b.linvel(); return [v.x, v.y, v.z]; };
    RG.setAngularVelocity = (ob, v) => { const b = bodyOf(ob); if (!b) return false; b.setAngvel(arr3(v), true); wake(b.userData); return true; };
    RG.getAngularVelocity = ob => { const b = bodyOf(ob); if (!b) return [0, 0, 0]; const v = b.angvel(); return [v.x, v.y, v.z]; };
    // масса сборки (AssemblyMass); у закреплённой — по материалу и объёму
    RG.mass = ob => {
      const b = bodyOf(ob); if (b) return b.mass();
      if (!ob || typeof ob !== 'object' || !ob.size) return 0;
      const s = ob.size, k = ob.shape === 'ball' ? Math.PI / 6 : ob.shape === 'cyl' ? Math.PI / 4 : ob.shape === 'wedge' ? .5 : 1;
      return matOf(ob)[0] * Math.abs(s[0] * s[1] * s[2]) * k;
    };
    RG.partMass = ob => { const P = partOf(ob); return P && P.col ? P.col.mass() : RG.mass(ob); };   // GetMass() одной детали
    RG.sleeping = ob => { const b = bodyOf(ob); return b ? b.isSleeping() : true; };
    RG.wake = ob => { const b = bodyOf(ob); if (b) { b.wakeUp(); wake(b.userData); } };
    RG.setAnchored = (ob, on) => {
      if (!ob) return;
      if (scene && scene.set && scene.get(ob.id) === ob) scene.set(ob, 'anchored', !!on, true);
      else { ob.anchored = !!on; RG.changed(ob, 'anchored'); }
    };
    RG.setMassless = (ob, on) => { if (!ob) return; ob.massless = !!on; RG.changed(ob, 'massless'); };
    RG.setDensity = (ob, d) => { if (!ob) return; ob.phys = Object.assign({}, ob.phys, { density: d }); RG.changed(ob, 'phys'); };
    RG.setPhysical = (ob, p) => { if (!ob) return; ob.phys = p && typeof p === 'object' ? { density: p.density, friction: p.friction, elasticity: p.elasticity } : null; RG.changed(ob, 'phys'); };
    RG.setGravity = g => { RG.gravity = +g || 0; world.gravity = v3(0, -RG.gravity, 0); const seen = new Set(); for (const P of parts.values()) if (P.asm && !seen.has(P.asm)) { seen.add(P.asm); P.asm.body.wakeUp(); wake(P.asm); } };
    // Свободная деталь без сцены (мир без scene.js): { id, shape, size, pos, rot, mat, _mesh } — своё тело Phys для игрока
    RG.add = (ob, opt = {}) => {
      if (!ob || ob.id == null || parts.has(ob.id)) return partOf(ob);
      ob.anchored = false; ob.cls = ob.cls || 'Part'; ob.pos = ob.pos || [0, 0, 0]; ob.rot = ob.rot || [0, 0, 0];
      const P = makePart(ob);
      P.free = true;
      if (opt.vel) P.asm.body.setLinvel(arr3(opt.vel), true);
      if (opt.proxy !== false) { const c = ph.addBox({ x: ob.pos[0], y: ob.pos[1], z: ob.pos[2], hx: .5, hy: .5, hz: .5, tag: 'part', data: { part: ob.id, floor: opt.floor || 'concrete' } }); if (!c.rb) adoptProxy(P, c); }
      return P;
    };
    RG.remove = ob => { const P = partOf(ob); if (!P) return; const cs = P.free ? P.proxy.slice() : []; destroyPart(P); for (const c of cs) ph.remove(c); };

    // ═══ Соединения (как Constraint в Roblox) ═══
    // Якоря и оси храним в системе своего объекта (obj.pos / obj.rot — всегда верная поза), для «к миру» — в мире.
    // Сторона: незакреплённая деталь → тело её сборки; закреплённая → её кинематическое тело; мир → неподвижное тело.
    function ground(){ if (!groundBody) groundBody = world.createRigidBody(RA.RigidBodyDesc.fixed()); return groundBody; }
    function toLocal(ob, w, dir){   // точка/направление мира → в систему объекта
      if (!ob) return v3(w.x, w.y, w.z);
      const r = qConj(rotOf(ob, q()));
      return dir ? qRot(r, w, v3()) : qRot(r, v3(w.x - (+ob.pos[0] || 0), w.y - (+ob.pos[1] || 0), w.z - (+ob.pos[2] || 0)));
    }
    function toWorld(ob, l, dir){
      if (!ob) return v3(l.x, l.y, l.z);
      const p = qRot(rotOf(ob, q()), l, v3());
      if (!dir) { p.x += +ob.pos[0] || 0; p.y += +ob.pos[1] || 0; p.z += +ob.pos[2] || 0; }
      return p;
    }
    function side(ob, la, ax){
      const W = toWorld(ob, la, false), Wa = ax ? toWorld(ob, ax, true) : null;
      let body = null, A = null;
      const P = ob ? parts.get(ob.id) : null;
      if (P && P.asm && !P.asm.dead) { A = P.asm; body = A.body; }
      else { const St = ob ? staticOf(ob) : null; body = St ? promote(St) : ground(); }
      const t = body.translation(), r = body.rotation(), rq = q(r.x, r.y, r.z, r.w), ir = qConj(rq, q());
      return { body, A, rot: rq, anchor: qRot(ir, v3(W.x - t.x, W.y - t.y, W.z - t.z)), axis: Wa ? qRot(ir, Wa, v3()) : null, W, Wa };
    }
    const isUnit = J => J.kind === 'hinge' || J.kind === 'slider';
    // повернуть систему тела сборки к qT (мир не меняется): тогда оси шарнира у обоих тел совпадают.
    // Остальные соединения этой сборки (не шарниры — иначе её не поворачивают) пересобираются сразу: их якоря — в системе тела
    function rebase(A, qT, except){
      const b = A.body, r = b.rotation(), R = qMul(qConj(qT, q()), q(r.x, r.y, r.z, r.w));
      for (const P of A.parts) { qRot(R, P.lp, P.lp); qMul(R, P.lq, P.lq); P.col.setTranslationWrtParent(P.lp); P.col.setRotationWrtParent(P.lq); }
      b.setRotation(qT, true);
      readBody(A);
      for (const J of [...A.joints]) if (J !== except) { J.dirty = true; build(J); }
    }
    function dropRaw(J){
      for (const r of J.raw) if (r.isValid()) world.removeImpulseJoint(r, true);
      if (J.raw.length) kick = true;
      J.raw.length = 0;
      for (const A of J.asms) A.joints.delete(J);
      J.asms.length = 0;
    }
    function build(J){
      if (J.dead) return;
      J.dirty = false;
      dropRaw(J);
      const Pa = parts.get(J.oa.id), Pb = J.ob ? parts.get(J.ob.id) : null;
      if (!Pa?.asm && !Pb?.asm) return;   // обе стороны закреплены — соединению нечего держать
      if (J.kind === 'weld' && Pa?.asm && Pb?.asm) { J.compound = true; Pa.welds.add(J); Pb.welds.add(J); merge(Pa.asm, Pb.asm); return; }
      J.compound = false;
      let e1 = [J.oa, J.la, J.axa], e2 = [J.ob, J.lb, J.axb];
      let s1 = side(...e1), s2 = side(...e2);
      if (!s1.A) { let t = s1; s1 = s2; s2 = t; t = e1; e1 = e2; e2 = t; }   // первая сторона — подвижная
      if (s1.A === s2.A) return;   // одна сборка — уже жёстко вместе
      const D = RA.JointData;
      let data = null;
      if (isUnit(J)) {
        // ось в системах обоих тел должна быть одной: шарниру — та же ось, ползунку — тот же поворот тел
        const ok = () => J.kind === 'hinge' ? Math.abs(s1.axis.x - s2.axis.x) + Math.abs(s1.axis.y - s2.axis.y) + Math.abs(s1.axis.z - s2.axis.z) < 1e-4 : qSame(s1.rot, s2.rot);
        if (!ok()) {
          const free = A => A && ![...A.joints].some(o2 => o2 !== J && isUnit(o2));
          if (free(s1.A)) { rebase(s1.A, s2.rot, J); s1 = side(...e1); }
          else if (free(s2.A)) { rebase(s2.A, s1.rot, J); s2 = side(...e2); }
        }
        if (!ok() && J.kind === 'hinge') {
          // запасной шарнир: два шаровых на оси (без пределов и мотора) — когда обе стороны уже держат другие шарниры
          const l = Math.max(.25, J.span || 1), W = s1.W, Wa = s1.Wa;
          for (const sg of [-1, 1]) {
            const p = v3(W.x + Wa.x * l * sg, W.y + Wa.y * l * sg, W.z + Wa.z * l * sg);
            J.raw.push(world.createImpulseJoint(D.spherical(localIn(s1, p), localIn(s2, p)), s1.body, s2.body, true));
          }
          J.soft = true;
        } else {
          data = J.kind === 'hinge' ? D.revolute(s1.anchor, s2.anchor, s1.axis) : D.prismatic(s1.anchor, s2.anchor, s1.axis);
          J.soft = false;
        }
      } else if (J.kind === 'ball') data = D.spherical(s1.anchor, s2.anchor);
      else if (J.kind === 'rope') data = D.rope(Math.max(0, J.length), s1.anchor, s2.anchor);
      else if (J.kind === 'spring') data = D.spring(Math.max(0, J.length), Math.max(0, J.stiffness), Math.max(0, J.damping), s1.anchor, s2.anchor);
      else if (J.kind === 'weld') data = D.fixed(s1.anchor, qConj(s1.rot, q()), s2.anchor, qConj(s2.rot, q()));   // к закреплённой или к миру
      if (data) {
        const raw = world.createImpulseJoint(data, s1.body, s2.body, true);
        J.raw.push(raw);
        raw.setContactsEnabled(J.collide);
        if (J.limits && raw.setLimits) raw.setLimits(J.limits[0], J.limits[1]);   // у шарнира пределы — только так (revolute без них в JointData)
        if (J.motor && !J.soft) motor(J);
      }
      J.asms = [s1.A]; s1.A.joints.add(J);
      if (s2.A) { J.asms.push(s2.A); s2.A.joints.add(J); s2.body.wakeUp(); wake(s2.A); }
      s1.body.wakeUp(); wake(s1.A);
    }
    function localIn(s, p){ const t = s.body.translation(); return qRot(qConj(s.rot, q()), v3(p.x - t.x, p.y - t.y, p.z - t.z)); }
    function motor(J){
      const raw = J.raw[0]; if (!raw || !raw.configureMotorVelocity || J.soft) return;
      const m = J.motor;
      raw.configureMotorModel(RA.MotorModel.ForceBased);
      if (!m) raw.configureMotorVelocity(0, 0);
      else if (m.target != null) raw.configureMotorPosition(J.kind === 'hinge' ? m.target * DEG : +m.target, m.stiffness ?? 2000, m.damping ?? 200);
      else { const sp = +m.speed || 0; raw.configureMotorVelocity(sp, Math.max(0, m.torque ?? 1e4) / Math.max(1, Math.abs(sp))); }   // момент ограничен «примерно»: ~torque на старте
      for (const A of J.asms) { A.body.wakeUp(); wake(A); }
    }
    // сварка двух незакреплённых — одно тело (сборка); скорость — по закону сохранения импульса
    function merge(A, B){
      if (A === B || A.dead || B.dead) return;
      if (B.parts.length > A.parts.length) { const t = A; A = B; B = t; }
      const ba = A.body, bb = B.body;
      const ma = ba.mass(), mb = bb.mass(), va = ba.linvel(), vb = bb.linvel(), wa = ba.angvel(), wb = bb.angvel();
      readBody(A); readBody(B);
      const inv = qConj(A.q, q());
      for (const P of B.parts.slice()) {
        const wp = qRot(B.q, P.lp, v3()); wp.x += B.tx - A.tx; wp.y += B.ty - A.ty; wp.z += B.tz - A.tz;
        const wq = qMul(B.q, P.lq, q());
        dropCol(P);
        qRot(inv, wp, P.lp); qMul(inv, wq, P.lq);
        P.asm = A; A.parts.push(P);
      }
      for (const P of B.parts) P.col = partCollider(P, ba);
      B.parts.length = 0;
      const moved = [...B.joints];
      for (const J of moved) { dropRaw(J); J.dirty = true; }
      B.joints.clear();
      world.removeRigidBody(bb); bb.userData = null; B.dead = true;
      const m = ma + mb || 1;
      ba.setLinvel(v3((va.x * ma + vb.x * mb) / m, (va.y * ma + vb.y * mb) / m, (va.z * ma + vb.z * mb) / m), true);
      ba.setAngvel(v3((wa.x * ma + wb.x * mb) / m, (wa.y * ma + wb.y * mb) / m, (wa.z * ma + wb.z * mb) / m), true);
      for (const P of A.parts) if (P.obj.massless) refreshCollider(P);
      for (const J of moved) build(J);   // соединения второй сборки — теперь к первой (система A не менялась — её соединения целы)
      wake(A);
    }
    // сварку убрали (или деталь закрепили) — сборка распадается на связные куски: каждый — своё тело с той же системой и скоростью
    function split(A){
      if (!A || A.dead || A.parts.length < 2) return;
      const left = new Set(A.parts), groups = [];
      while (left.size) {
        const s0 = left.values().next().value, g = [s0];
        left.delete(s0);
        for (let i = 0; i < g.length; i++) for (const W of g[i].welds) {
          if (W.dead || !W.compound) continue;
          const other = W.oa === g[i].obj ? parts.get(W.ob?.id) : parts.get(W.oa.id);
          if (other && left.has(other)) { left.delete(other); g.push(other); }
        }
        groups.push(g);
      }
      if (groups.length < 2) return;
      const b = A.body; readBody(A);
      const v = b.linvel(), w = b.angvel(), com = b.worldCom(), lin = v3(v.x, v.y, v.z), ang = v3(w.x, w.y, w.z), c0 = v3(com.x, com.y, com.z);
      for (let gi = 1; gi < groups.length; gi++) {
        const nb = newBody(A.tx, A.ty, A.tz, false, false);
        nb.setRotation(A.q, false);
        const N = makeAsm(nb);
        for (const P of groups[gi]) { dropCol(P); A.parts.splice(A.parts.indexOf(P), 1); P.asm = N; N.parts.push(P); }
        for (const P of N.parts) P.col = partCollider(P, nb);
        // скорость куска — скорость точки старого тела в его середине
        let cx = 0, cy = 0, cz = 0;
        for (const P of N.parts) { cx += +P.obj.pos[0] || 0; cy += +P.obj.pos[1] || 0; cz += +P.obj.pos[2] || 0; }
        const k = 1 / N.parts.length, r = v3(cx * k - c0.x, cy * k - c0.y, cz * k - c0.z);
        nb.setLinvel(v3(lin.x + ang.y * r.z - ang.z * r.y, lin.y + ang.z * r.x - ang.x * r.z, lin.z + ang.x * r.y - ang.y * r.x), true);
        nb.setAngvel(ang, true);
        wake(N);
      }
      for (const P of A.parts) if (P.obj.massless) refreshCollider(P);
      for (const J of joints) J.dirty = J.dirty || (!J.compound && J.asms.includes(A));
      A.body.wakeUp(); wake(A);
    }
    const KINDS = { weld: 'weld', hinge: 'hinge', ball: 'ball', ballsocket: 'ball', rope: 'rope', spring: 'spring', slider: 'slider', prismatic: 'slider' };
    RG.joint = (kind0, a, b, opt = {}) => {
      const kind = KINDS[String(kind0).toLowerCase()];
      if (!kind) throw new Error('RG.joint: вид ' + kind0 + ' — есть weld, hinge, ball (ballsocket), rope, spring, slider (prismatic)');
      const obOf = x => !x ? null : typeof x === 'object' ? x : scene ? scene.get(x) : null;
      let oa = obOf(a), ob = obOf(b);
      if (!oa) return null;
      let at = arr3(opt.at || opt.at0 || oa.pos), at1 = opt.at1 ? arr3(opt.at1) : at;
      if (!parts.has(oa.id) && ob && parts.has(ob.id)) { let t = oa; oa = ob; ob = t; t = at; at = at1; at1 = t; }   // первая сторона — незакреплённая (если есть)
      const axis = arr3(opt.axis || [1, 0, 0]); { const l = Math.hypot(axis.x, axis.y, axis.z) || 1; axis.x /= l; axis.y /= l; axis.z /= l; }
      const J = { kind, oa, ob, la: toLocal(oa, at), lb: toLocal(ob, at1), axa: toLocal(oa, axis, true), axb: toLocal(ob, axis, true),
        raw: [], asms: [], dead: false, dirty: false, compound: false, soft: false, span: +opt.span || 0,
        length: 0, stiffness: opt.stiffness ?? 200, damping: opt.damping ?? 10, limits: null, motor: opt.motor || null,
        collide: opt.collide ?? (kind === 'rope' || kind === 'spring') };
      if (kind === 'rope' || kind === 'spring') J.length = opt.length != null ? +opt.length : Math.hypot(at1.x - at.x, at1.y - at.y, at1.z - at.z);
      if (opt.limits) J.limits = kind === 'hinge' ? [opt.limits[0] * DEG, opt.limits[1] * DEG] : [+opt.limits[0], +opt.limits[1]];
      J.remove = () => {
        if (J.dead) return;
        J.dead = true; joints.delete(J);
        dropRaw(J);
        for (const A of J.asms) A.joints.delete(J);
        if (J.compound) {
          const Pa = parts.get(J.oa.id), Pb = J.ob && parts.get(J.ob.id);
          Pa?.welds.delete(J); Pb?.welds.delete(J);
          const A = Pa?.asm || Pb?.asm; if (A) split(A);
        }
      };
      J.setMotor = (speed, torque) => { J.motor = speed == null ? null : { speed: +speed || 0, torque: torque ?? 1e4 }; motor(J); };
      J.setServo = (angle, stiffness, damping) => { J.motor = angle == null ? null : { target: +angle || 0, stiffness, damping }; motor(J); };
      J.setLimits = (lo, hi) => { J.limits = lo == null ? null : kind === 'hinge' ? [lo * DEG, hi * DEG] : [+lo, +hi]; J.dirty = true; build(J); };
      // угол шарнира, градусы: на сколько первая сторона повернулась относительно второй (мира) вокруг оси с момента создания
      const relRot = () => qMul(qConj(J.ob ? rotOf(J.ob, q()) : q(), q()), rotOf(J.oa, q()), q());
      J.r0 = relRot();
      J.angle = () => {
        const d = qMul(relRot(), qConj(J.r0, q()), q()), ax = J.axb, s = d.x * ax.x + d.y * ax.y + d.z * ax.z;
        let a = 2 * Math.atan2(s, d.w) / DEG;
        if (a > 180) a -= 360; else if (a < -180) a += 360;
        return a;
      };
      joints.add(J);
      build(J);
      return J;
    };

    // ═══ Касания деталь–деталь (Touched): включаются, когда кто-то подписался ═══
    function onContact(h1, h2, started){
      const a = byCol.get(h1), b = byCol.get(h2), oa = a ? a.obj || a.owner : null, ob = b ? b.obj || b.owner : null;
      if (a && a.asm) ev?.emit('touch', { a: oa, b: ob || null, started: !!started });
      else if (b && b.asm) ev?.emit('touch', { a: ob, b: oa || null, started: !!started });
    }
    RG.on = (e, f) => {
      if (e === 'touch' && !touchOn) {
        touchOn = true; eq = new RA.EventQueue(true);
        for (const P of parts.values()) if (P.col) P.col.setActiveEvents(RA.ActiveEvents.COLLISION_EVENTS);
      }
      return ev ? ev.on(e, f) : () => {};
    };

    RG.stats = () => { const s = new Set(); for (const P of parts.values()) if (P.asm) s.add(P.asm); return { bodies: s.size, parts: parts.size, active: RG.active, statics: stat.size, chars: chars.size, joints: joints.size, ms: RG.ms, skipped: RG.skipped }; };
    RG.part = partOf;
    // RG.moved — детали, сдвинутые за последний шаг (Set, очищается в начале шага): скриптам/сети — кого синхронизировать
    RG.dispose = () => {
      if (!RG.ok) return;
      RG.ok = false;
      unwatch();
      if (ph.onPush === onPush) ph.onPush = null;
      if (ph.onChar === onChar) ph.onChar = null;
      for (const P of parts.values()) { for (const c of P.proxy) { c.rb = null; c.kick = false; } if (P.free) for (const c of P.proxy.slice()) ph.remove(c); }
      parts.clear(); stat.clear(); chars.clear(); joints.clear(); byCol.clear(); orphans.clear();
      try { eq?.free(); world.free(); } catch (e) { /* уже освобождён */ }
      ev?.clear();
    };

    // ═══ Слушаем Phys ═══
    function onAdd(c){
      if (c.rb) return;
      const id = c.data ? c.data.part : undefined;
      if (id != null) {
        const P = parts.get(id);
        if (P) { adoptProxy(P, c); return; }
        const ob = scene ? scene.get(id) : null;
        if (wants(ob)) { adoptProxy(makePart(ob), c); relink(ob); return; }
      }
      if (c.trigger || stat.has(c)) return;
      addStatic(c);
    }
    function onMove(c){
      if (c.rb) return;   // тело детали сдвинула сама сцена (SC.set pos) — тело Rapier двигает RG.changed
      const St = stat.get(c);
      if (!St) { onAdd(c); return; }
      updateStatic(St);
    }
    function onRemove(c){
      const P = c.rb;
      if (P) { c.rb = null; c.kick = false; const i = P.proxy.indexOf(c); if (i >= 0) P.proxy.splice(i, 1); if (!P.proxy.length) orphans.add(P); return; }
      removeStatic(c);
    }
    const unwatch = ph.watch((type, c) => { if (type === 'move') onMove(c); else if (type === 'add') onAdd(c); else if (type === 'remove') onRemove(c); });
    ph.onPush = onPush; ph.onChar = onChar;
    // то, что уже есть
    try {
      buildGround();
      for (const c of ph.cols) onAdd(c);
      if (scene) for (const ob of scene.all()) if (wants(ob) && !parts.has(ob.id)) makePart(ob);
    } catch (e) { RG.dispose(); throw e; }
    return RG;
  }

  // ═══ Загрузка Rapier (один раз на страницу) ═══
  let loading = null;
  E.rigid.VERSION = VER;
  E.rigid.URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@' + VER + '/rapier.mjs';
  E.rigid.MAT = MAT;
  E.rigid.ready = false;
  E.rigid.failed = 0;
  // src: адрес модуля или уже загруженный модуль (тесты в node: require(...))
  E.rigid.load = src => {
    if (E.rigid.R) return Promise.resolve(true);
    if (loading) return loading;
    if (E.rigid.failed && Date.now() - E.rigid.failed < 30000) return Promise.resolve(false);   // не грузится — повтор не раньше чем через 30 с
    loading = (async () => {
      const mod = src && typeof src === 'object' ? src : await import(src || E.rigid.URL);
      const R = mod && mod.World ? mod : mod.default;
      const warn = console.warn;   // Rapier сам пишет «deprecated parameters for the initialization function» — это не наше
      console.warn = (...a) => { if (!/deprecated parameters for the initiali[sz]ation/i.test(String(a[0]))) warn.apply(console, a); };
      try { await R.init(); } finally { console.warn = warn; }
      E.rigid.R = R; E.rigid.ready = true; E.rigid.failed = 0;
      return true;
    })().catch(e => { console.warn('D37E.rigid: физика деталей не загрузилась —', e?.message || e); E.rigid.failed = Date.now(); loading = null; return false; });
    return loading;
  };
  E.rigid.qEuler = qEuler; E.rigid.eulerOf = eulerOf;
})();

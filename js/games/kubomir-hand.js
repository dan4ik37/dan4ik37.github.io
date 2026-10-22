// ═══════════════════════════════════════
//  «КУБОМИР» — две руки как в Майнкрафте (правая — ячейка панели, левая — щит, факел, еда…) и свет человечков как у кубиков
// ═══════════════════════════════════════
// H = window.KubomirHand.create(st) — после st.A (свой человечек 'me'), st.VR и st.ents:
//   H.act('swing' | 'push', 'main' | 'off') — взмах (копание) / короткий толчок вперёд (поставить блок, открыть, нажать);
//   H.mine(вкл) — каждый кадр: пока копаешь, взмахи повторяются сами (как в Майнкрафте);
//   H.pose(dt, alpha) — до A.update: что в руках и движение — своему человечку (a.hold → слой поз world3d.js: серия меча, топор
//     сверху, кирка, щит, лук, факел, еда); H.frame(dt, t) — после A.update, до R.render: руки и вещи от 1-го лица, вещи у
//     человечка; H.flash() — отбил щитом; H.state() — для проверок; H.dispose().
// Еда — st.eat = { t, need, hand } (ставит kubomir.js): рука с едой ко рту, покачивание, крошки. Удары, щит и лук — из боя (st.F,
// D37E.combat: CB.pose — движение и фаза 0…3, щит, натяжка), что в какой руке — st.hands (kubomir.js hands()).
// От 1-го лица: правая рука — копия правой руки своего человечка (тот же рукав, кожа, перчатки), левая — копия левой (видна,
// когда в ней что-то есть), вещь — в кулаке (как в Bedrock), покачивание на ходу, запаздывание при повороте, смена вещи — опустить
// и поднять; руки и вещи «из глаз» (VR.entityMaterial / VR.itemMesh с fp: не уходят в стену). От 3-го лица — слой поз world3d
// (o.hold; номера — CB.HOLDS / CB.MOTIONS); нет слоя (старый world3d, проверки) — движения правой рукой поверх позы, как раньше.
// У человечка world3d armL / handL — его ПРАВАЯ рука (armR — левая: названия — для того, кто смотрит на него спереди): правая
// (главная) вещь — в handL, левая — в handR; от 1-го лица правая рука — копия armL (у заглушек проверок без armL — armR).
// Свет всех человечков (свой и других) — как у кубиков: материалы — копии VR.entityMaterial с одной униформой на человечка
// (KubomirEnts.Lit — плавно по 8 клеткам вокруг груди).
(() => {
  const PI = Math.PI, TAU = PI * 2;
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const wrap = a => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
  // длительности, с: взмах (как удар в Майнкрафте — 6 тактов), толчок, смена вещи
  const SWING = .3, PUSH = .2, EQUIP = .25;
  // рука от 1-го лица (оси камеры: x вправо, y вверх, −z вперёд): где кулак, куда смотрит рука (от плеча к кулаку), поворот
  // вокруг руки, размер; на узком экране кулак ближе к середине. Левая — зеркально (x и поворот — с другим знаком)
  const FP = { fist: [.42, -.4, -.72], dir: [-.38, .32, -1], roll: -.5, scale: .74 };
  const EMPTY = { fist: [.3, -.25, -.68], dir: [-.55, .62, -1], roll: -.4 };   // пустая рука — выше и виднее (как в Майнкрафте)
  const EAT = { fist: [.13, -.29, -.52], dir: [-.7, .75, -.6], roll: -.9 };
  // позы рук по тому, что держат (как у правой; левая — зеркально): щит — внизу сбоку, поднят — перед собой; факел — повыше;
  // лук — левая держит перед собой, правая — у тетивы (натянул — к щеке)
  const HOLD_FP = {
    shield: { fist: [.42, -.52, -.66], dir: [-.3, .5, -1], roll: -.3 }, guard: { fist: [.15, -.31, -.55], dir: [-.2, .32, -1], roll: -.15 },
    torch: { fist: [.38, -.3, -.7], dir: [-.32, .7, -1], roll: -.45 },
    bowL: { fist: [.12, -.28, -.66], dir: [-.25, .5, -1], roll: -.25 }, bowR: { fist: [.07, -.36, -.56], dir: [-.45, .55, -1], roll: -.4 }, drawR: { fist: [.15, -.3, -.31], dir: [-.85, .35, -.4], roll: -.6 },
  };
  // вещь от 1-го лица — над кулаком, в осях камеры (как в Bedrock): блок углом к нам, плоская вещь (инструмент, еда) — рукоятью
  // в кулаке, головой вверх и к середине экрана (видна обратная сторона картинки); off — от кулака, rot — повороты (XYZ), s — размер
  const ITEM = { block: { off: [-.06, .1, -.02], rot: [.42, .78, 0], s: .19 }, flat: { off: [-.09, .14, -.03], rot: [-.2, 2.55, -.25], s: .34 },
    shield: { off: [-.03, .06, -.05], rot: [-.08, .3, .05], s: .5 }, bow: { off: [.02, .05, -.04], rot: [0, .35, -.32], s: .5 }, torch: { off: [-.04, .12, -.02], rot: [-.15, 2.6, -.05], s: .34 } };
  // движения от 1-го лица (правая; левая — зеркально): [замах, конец удара] × [dx, dy, dz кулака; повороты x, y, z]
  const MOT_FP = {
    jab: [[.02, -.02, .08, .25, 0, 0], [-.07, .05, -.24, -.2, .1, 0]],
    slash: [[.16, .17, .05, .55, -.9, -.65], [-.36, .03, -.16, -.15, .9, .4]],
    back: [[-.36, .12, -.06, .3, .9, .55], [.18, -.03, -.08, -.15, -.8, -.5]],
    thrust: [[.03, -.02, .15, .12, 0, 0], [-.1, .05, -.34, -.1, .05, 0]],
    chop: [[0, .3, .08, 1.05, 0, -.1], [-.05, -.2, -.16, -1.15, .1, .12]],
    dig: [[.02, .2, .05, .75, .1, 0], [-.04, -.12, -.12, -.85, .2, 0]],
    scoop: [[.02, -.1, .02, -.4, 0, 0], [-.02, .15, -.15, .65, 0, 0]],
    shoot: [[0, 0, 0, 0, 0, 0], [.07, .03, .12, .1, 0, 0]],
    bash: [[0, 0, .06, 0, 0, 0], [.09, .06, -.2, 0, 0, 0]],
  };
  window.KubomirHand = { create, FP, EMPTY, EAT, ITEM, HOLD_FP, MOT_FP };   // числа позы — снаружи видны (подстройка на живую в консоли)

  function create(st){
    const R = st.R, T = R.T, VR = st.VR, Lit = window.KubomirEnts.Lit, V = () => window.D37E.vox, CB = () => window.D37E?.combat;
    const H = { sw: 1, push: 1, pushH: 0, eq: 1, eqL: 1, eatK: 0, mining: false, name: null, nameL: null, arm: null, armCh: null, elbow: null, hand: null, armL: null, elbowL: null, handL: null,
      fpItem: null, tpItem: null, fpOff: null, tpOff: null, fl: 0, eye: Lit.make(T), sway: { y: 0, p: 0, ok: false }, n: 0,
      tp: { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, tpFP: { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, alpha: 0, layer: false };
    const HELD = [0, 0, 0], HELD2 = [0, 0, 0];
    const fp = new T.Group(); fp.name = 'kb:fp'; fp.visible = false;
    const pose = new T.Group(), poseL = new T.Group(); fp.add(pose); fp.add(poseL);   // плечи рук: место и поворот — каждый кадр
    const ORIG = new WeakMap();   // копия материала человечка → его исходный материал (для руки от 1-го лица)
    const actors = new Map();     // ключ актёра → { ch, E, mats: Map(исходный → копия), chk, scan }
    // что в какой руке (имена вещей): бой (st.hands — с хватом: лук — левая держит, щит из панели — в левой); без него — панель и P.off
    const names = out => {
      const P = st.P, HS = st.F && st.hands;
      if (P.dead) { out[0] = ''; out[1] = ''; return out; }
      if (HS) { const two = HS.two, mo = HS.mainOff, m = P.inv[P.sel]; out[0] = two || mo ? '' : m ? m.id : ''; out[1] = two ? (m ? m.id : '') : HS.offS ? HS.offS.id : ''; }
      else { const m = P.inv[P.sel]; out[0] = m ? m.id : ''; out[1] = P.off ? P.off.id : ''; }
      return out;
    };
    const NM = ['', ''];
    const heldId = () => names(NM)[0];
    const kindOf = id => { if (!id) return ''; const it = V().item(id); if (!it) return ''; if (it.tool) return it.tool.kind; if (it.food) return 'food'; const b = it.place ? V().block(it.place) : null; return b && V().T.emit[b.id] ? 'torch' : b ? 'block' : 'item'; };
    // свой свет вещей в руках (факел в любой руке) — ярче из двух
    const heldLight = () => {
      const a = Lit.held(NM[0], HELD), b = Lit.held(NM[1], HELD2);
      if (!b) return a; if (!a) return b;
      for (let c = 0; c < 3; c++) HELD[c] = Math.max(HELD[c], HELD2[c]);
      return HELD;
    };

    // ── свет человечков ──
    function convChar(L, m){
      if (Array.isArray(m)) return m.map(x => convChar(L, x));
      if (!m || m.userData?.d37ent || m.userData?.d37vox) return m;
      let c = L.mats.get(m);
      if (!c) { c = L.plain ? m.clone() : VR.entityMaterial(m, L.E.u, { kind: 'char' }); L.mats.set(m, c); ORIG.set(c, m); }
      return c;
    }
    function scanChar(L, ch){ ch.root.traverse(o => { if (o.isMesh && o.material && !o.userData.item && !o.userData.fp) o.material = convChar(L, o.material); }); }
    function litActor(a, dt){
      if (!a.ch) return;
      let L = actors.get(a.key);
      if (!L) actors.set(a.key, L = { ch: null, E: Lit.make(T), mats: new Map(), chk: 0, scan: 0, plain: false });
      if (L.ch !== a.ch) { if (L.ch) for (const m of L.mats.values()) m.dispose(); L.mats.clear(); L.ch = a.ch; L.chk = 0; scanChar(L, a.ch); }
      else if (++L.scan >= 40) { L.scan = 0; scanChar(L, a.ch); }   // новое лицо (эмоция), вещь — тоже со светом
      const add = a.key === 'me' ? heldLight() : null;
      Lit.update(L.E, st, a.x + st.ox, a.y + 1, a.z + st.oz, dt, add);
      // свой кусок шейдера не собрался (старый телефон) — обычные копии с цветом по свету
      if (!L.plain && L.chk < 4 && ++L.chk === 4) {
        let bad = false; for (const m of L.mats.values()) if (VR.failed?.(m)) bad = true;
        if (bad) { L.plain = true; const old = [...L.mats.values()]; L.mats.clear(); scanBack(a.ch, old); scanChar(L, a.ch); for (const m of old) m.dispose(); }
      }
      if (L.plain) { const lt = window.KubomirEnts.lightTint(st.W.lightAt(a.x + st.ox, a.y + 1, a.z + st.oz), .06); for (const [src, c] of L.mats) if (c.color && src.color) { c.color.copy(src.color); c.color.r *= lt[0]; c.color.g *= lt[1]; c.color.b *= lt[2]; } }
    }
    function scanBack(ch, list){ const set = new Set(list); ch.root.traverse(o => { if (o.isMesh && set.has(o.material)) o.material = ORIG.get(o.material) || o.material; }); }
    H.light = me => actors.get(me || 'me')?.E || null;

    // ── руки от 1-го лица: копии рук человечка (правая — правой, левая — левой) ──
    function dropArms(){
      for (const [g, k] of [[pose, 'arm'], [poseL, 'armL']]) {
        const A = H[k]; if (!A) continue;
        g.remove(A);
        A.traverse(o => { if (o.isMesh && o.material && !o.userData.fp) { const m = o.material; if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose(); } });
      }
      H.arm = H.elbow = H.hand = null; H.armL = H.elbowL = H.handL = null; H.armCh = null;
    }
    function copyArm(ch, src0, elb, hnd){
      const mats = new Map();
      const conv = m => {
        if (Array.isArray(m)) return m.map(conv);
        let c = mats.get(m);
        if (!c) { const src = ORIG.get(m) || m; c = VR.entityMaterial(src, H.eye.u, { fp: true, kind: 'fp' }); mats.set(m, c); }
        return c;
      };
      let E0 = null, H0 = null;
      const copy = (src, top) => {
        const o = src.isMesh ? new T.Mesh(src.geometry, conv(src.material)) : new T.Group();
        if (!top) { o.position.copy(src.position); o.quaternion.copy(src.quaternion); o.scale.copy(src.scale); }
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 30; }
        if (src === elb) E0 = o;
        if (src === hnd) H0 = o;
        for (const c of src.children) {
          if (c.userData?.item || c === H.tpItem || c === H.tpOff || c.isSprite || c.isPoints || c.isLine) continue;
          if (c.isMesh || c.isGroup || c.isBone || c.type === 'Object3D') o.add(copy(c, false));
        }
        return o;
      };
      const A = copy(src0, true);
      A.scale.setScalar(FP.scale);
      if (E0) E0.rotation.set(-.12, 0, 0);
      return { A, E: E0, Hd: H0 };
    }
    // правая и левая рука человечка (world3d: правая — armL); заглушка без armL — одна правая (armR)
    const RIGHT = ch => ch.armL ? { A: ch.armL, E: ch.elbowL, Hd: ch.handL } : { A: ch.armR, E: ch.elbowR, Hd: ch.handR };
    const LEFT = ch => ch.armL ? { A: ch.armR, E: ch.elbowR, Hd: ch.handR } : null;
    function buildArm(ch){
      dropArms();
      if (!ch?.armR) return;
      const Rr = RIGHT(ch), Ll = LEFT(ch);
      const r = copyArm(ch, Rr.A, Rr.E, Rr.Hd);
      H.arm = r.A; H.elbow = r.E; H.hand = r.Hd;
      H.La = (Rr.A.userData?.La || .62) * FP.scale;
      pose.add(H.arm);
      if (Ll) { const l = copyArm(ch, Ll.A, Ll.E, Ll.Hd); H.armL = l.A; H.elbowL = l.E; H.handL = l.Hd; H.LaL = (Ll.A.userData?.La || .62) * FP.scale; poseL.add(H.armL); }
      H.armCh = ch;
    }
    // вещь в кулаке: как у человечка (кость кисти); блок — повёрнут углом, инструмент — рукоятью в кулаке; левая — повороты зеркально
    // (сама картинка — нет: отрицательный размер переворачивает лицевую грань, и свет вещи выходит тёмным)
    // плоская вещь у человечка: рукоять (точка h картинки) — в кулаке, клинок / голова (направление d картинки) — вверх и чуть вперёд
    // от кулака (оси кисти: −y — вдоль предплечья, +z — «вверх», когда предплечье вперёд), плашмя — вбок; инструменты и оружие —
    // по диагонали картинки (рукоять внизу слева), факел, еда и прочее — стоймя
    const GRIP_TP = { diag: { h: [-.38, -.36], d: [1, 1], s: .62 }, up: { h: [0, -.4], d: [0, 1], s: .42 } };
    const TU = new T.Vector3(), TV = new T.Vector3(), TW = new T.Vector3(0, 0, 1), TB = new T.Vector3(0, -.35, .94).normalize(), TN = new T.Vector3(1, 0, 0), TX = new T.Vector3().crossVectors(TN, TB), TM = new T.Matrix4(), TM2 = new T.Matrix4();
    function placeInHand(m, hand, side){
      if (m.parent !== hand) hand.add(m);
      if (!m.geometry.userData.flat) { m.position.set(0, -.08, .1); m.rotation.set(0, side ? -.6 : .6, 0); m.scale.setScalar(.27); return; }
      const k = m.userData.kind, G = k === 'torch' || k === 'food' || k === 'item' || k === 'block' ? GRIP_TP.up : GRIP_TP.diag;
      TU.set(G.d[0], G.d[1], 0).normalize(); TV.crossVectors(TW, TU);
      TM.makeBasis(TB, TX, TN); TM2.makeBasis(TU, TV, TW).transpose(); TM.multiply(TM2);
      m.quaternion.setFromRotationMatrix(TM); m.scale.setScalar(G.s);
      TU.set(G.h[0] * G.s, G.h[1] * G.s, 0).applyQuaternion(m.quaternion);
      m.position.set(-TU.x, -TU.y - .05, -TU.z);
    }

    // ── вещи в руках: по две сетки (из глаз и у человечка), смена — опустить и поднять ──
    function setItem(side, name){
      const kF = side ? 'fpOff' : 'fpItem', kT = side ? 'tpOff' : 'tpItem', kN = side ? 'nameL' : 'name';
      const old = H[kN]; H[kN] = name;
      for (const k of [kF, kT]) { const m = H[k]; if (m) { m.parent?.remove(m); m.geometry.dispose(); H[k] = null; } }
      if (name) {
        H[kF] = VR.itemMesh(name, 15 << 12, { fp: true }); H[kF].renderOrder = 31; H[kF].frustumCulled = false; H[kF].castShadow = false;
        H[kT] = VR.itemMesh(name, 15 << 12); H[kT].renderOrder = 20; H[kT].castShadow = true;
        fp.add(H[kF]);
        H[kT].userData.kind = kindOf(name);
      }
      if (old !== null) { if (side) H.eqL = 0; else H.eq = 0; }   // первая вещь при входе в мир — без анимации
    }
    // кисти для вещей: правая (главная) — handL человечка world3d, левая — handR (заглушка без handL — одна handR)
    const handMain = ch => ch?.handL || ch?.handR, handOff = ch => ch?.handL ? ch.handR : null;
    function tpAttach(ch){
      const hm = handMain(ch), ho = handOff(ch);
      if (H.tpItem && hm) placeInHand(H.tpItem, hm, 0);
      if (H.tpOff && ho) placeInHand(H.tpOff, ho, 1);
    }

    // ── действия ──
    H.act = (kind, which) => {
      if (kind === 'push') { H.push = 0; H.pushH = which === 'off' ? 1 : 0; return; }
      if (H.sw >= .5) H.sw = 0;   // новый взмах — если прошлый прошёл больше половины (как в Майнкрафте)
    };
    H.mine = on => { H.mining = !!on; };
    H.flash = () => { H.fl = 1; };

    // ── поза человечка (до A.update): что в руках, движение (бой — у него приоритет; иначе еда, копание, толчок) ──
    const MOI = n => window.World3D?.MOTIONS?.indexOf(n) ?? -1;
    let MO_EAT = -1, MO_SWING = -1, MO_PUSH = -1;
    H.pose = (dt, alpha) => {
      const me = st.A?.get('me'), C = CB(), F = st.F;
      H.alpha = alpha || 0;
      H.layer = !!(me && window.World3D?.HOLDS && C && F);
      if (!me) return;
      if (!H.layer) { me.hold = null; return; }
      if (MO_EAT < 0) { MO_EAT = MOI('eat'); MO_SWING = MOI('swing'); MO_PUSH = MOI('push'); }
      const P2 = H.tp;
      C.pose(F, alpha || 0, 1 / 60, P2);
      if (st.P.dead) { P2.r = 0; P2.l = 0; P2.m = 0; }
      if (!P2.m) {
        if (st.eat || H.eatK > .02) { P2.m = MO_EAT; P2.mh = st.eat?.hand === 'off' ? 1 : 0; P2.v = H.eatK; }
        else if (H.sw < 1) { P2.m = MO_SWING; P2.mh = 0; P2.v = H.sw * 3; }
        else if (H.push < 1) { P2.m = MO_PUSH; P2.mh = H.pushH; P2.v = H.push * 3; }
      }
      P2.p = -(st.rig.fp || 0);
      me.hold = P2;
    };

    // ── поза одной руки от 1-го лица: s 0 — правая (pose), 1 — левая (poseL) ──
    const qa = new T.Quaternion(), qb = new T.Quaternion(), e = new T.Euler(0, 0, 0, 'YXZ'), ie = new T.Euler(), v1 = new T.Vector3(), v2 = new T.Vector3(), DOWN = new T.Vector3(0, -1, 0);
    const F3 = [0, 0, 0], D3 = [0, 0, 0], MV = [0, 0, 0, 0, 0, 0], BASE = { fist: F3, dir: D3, roll: 0 }, B0 = { fist: [0, 0, 0], dir: [0, 0, 0], roll: 0 };
    // текущую позу — в B0 (чтобы смешать её с другой: еда)
    function keep(){ for (let i = 0; i < 3; i++) { B0.fist[i] = F3[i]; B0.dir[i] = D3[i]; } B0.roll = BASE.roll; return B0; }
    // смесь двух поз (a → b на k) в BASE
    function mix(a, b, k){ for (let i = 0; i < 3; i++) { F3[i] = a.fist[i] + (b.fist[i] - a.fist[i]) * k; D3[i] = a.dir[i] + (b.dir[i] - a.dir[i]) * k; } BASE.roll = a.roll + (b.roll - a.roll) * k; return BASE; }
    function copyBase(a){ for (let i = 0; i < 3; i++) { F3[i] = a.fist[i]; D3[i] = a.dir[i]; } BASE.roll = a.roll; return BASE; }
    // движение по фазе v 0…3 (от «держит» к замаху, к концу удара, обратно) → MV
    function motion(name, v){
      MV.fill(0);
      const K = MOT_FP[name]; if (!K || !(v > 0)) return MV;
      const seg = v < 1 ? 0 : v < 2 ? 1 : 2, u = ease(v - seg);
      for (let i = 0; i < 6; i++) { const a = seg === 0 ? 0 : K[seg - 1][i], b = seg === 2 ? 0 : K[seg][i]; MV[i] = a + (b - a) * u; }
      return MV;
    }
    const OFF = [0, 0, 0];
    function placeArm(s, g, B, mv, cam, sway){
      const m = s ? -1 : 1, La = (s ? H.LaL : H.La) || .57;
      F3[0] *= Math.max(.62, Math.min(1, (cam.aspect || 1.6) / 1.6));
      F3[0] = F3[0] * m + mv[0] * m + sway[0]; F3[1] += mv[1] + sway[1]; F3[2] += mv[2] + sway[2];   // качание и запаздывание — не зеркалить
      v1.set(D3[0] * m, D3[1], D3[2]).normalize();
      qa.setFromUnitVectors(DOWN, v1);
      qb.setFromAxisAngle(v1, B.roll * m); qa.premultiply(qb);
      e.set(mv[3] + sway[3], mv[4] * m + sway[4], mv[5] * m + sway[5], 'YXZ');
      qb.setFromEuler(e); qa.premultiply(qb);
      g.quaternion.copy(qa);
      v2.copy(v1).multiplyScalar(La).applyQuaternion(qb);
      g.position.set(F3[0] - v2.x, F3[1] - v2.y, F3[2] - v2.z);
    }
    // вещь над кулаком (в осях камеры), поворачивается вместе с движением; левая — зеркально
    function placeItem(it, s, O, k){
      const m = s ? -1 : 1;
      v2.set(O.off[0] * m, O.off[1], O.off[2]).applyQuaternion(qb);
      it.position.set(F3[0] + v2.x, F3[1] + v2.y, F3[2] + v2.z);
      ie.set(O.rot[0], O.rot[1] * m, O.rot[2] * m, 'XYZ'); it.quaternion.setFromEuler(ie).premultiply(qb);
      it.scale.setScalar(O.s * (k || 1));   // без зеркала по размеру: свет вещи «из глаз» считается по лицевой грани
    }

    // ── кадр ──
    const SWY = [0, 0, 0, 0, 0, 0], SWY0 = [0, 0, 0, 0, 0, 0];
    const qw = new T.Quaternion(), qh = new T.Quaternion(), vw = new T.Vector3(), mh = new T.Matrix4(), ef = new T.Euler(0, 0, 0, 'YXZ');
    H.frame = (dt, t) => {
      const P = st.P, A = st.A, me = A?.get('me'); H.n++;
      // свет человечков (свой — с факелом в руке)
      names(NM);
      if (A) for (const a of A.list.values()) litActor(a, dt);
      // вещи в руках
      if (NM[0] !== H.name) setItem(0, NM[0]);
      if (NM[1] !== H.nameL) setItem(1, NM[1]);
      if (me?.ch && me.ch !== H.armCh) { buildArm(me.ch); tpAttach(me.ch); }
      if (me?.ch && ((H.tpItem && H.tpItem.parent !== handMain(me.ch)) || (H.tpOff && H.tpOff.parent !== handOff(me.ch)))) tpAttach(me.ch);
      // таймеры: взмах (повтор, пока копает), толчок, смена вещи, еда, вспышка отбива
      if (H.sw < 1) H.sw = Math.min(1, H.sw + dt / SWING);
      if (H.sw >= 1 && H.mining) H.sw = 0;
      if (H.push < 1) H.push = Math.min(1, H.push + dt / PUSH);
      if (H.eq < 1) H.eq = Math.min(1, H.eq + dt / EQUIP);
      if (H.eqL < 1) H.eqL = Math.min(1, H.eqL + dt / EQUIP);
      if (H.fl > 0) H.fl = Math.max(0, H.fl - dt / .3);
      const eating = !!st.eat, eatOff = eating && st.eat.hand === 'off';
      H.eatK += ((eating ? 1 : 0) - H.eatK) * Math.min(1, dt * (eating ? 9 : 7));
      const C = CB(), F = st.F;
      if (C && F) C.pose(F, H.alpha, 1 / 60, H.tpFP);   // движение боя для 1-го лица (плавно между шагами; человечку — H.pose)
      const cm = C && F && F.mv ? C.MOTIONS[H.tpFP.m] : '', cv = cm ? H.tpFP.v : 0, guard = C && F ? F.guard : 0, draw = C && F ? C.drawK(F) : 0, shotK = C && F && F.shotT < .25 ? 1 - F.shotT / .25 : 0;
      const sp = H.sw < 1 && !cm ? H.sw : 0, a1 = Math.sin(PI * sp), b1 = Math.sin(PI * Math.sqrt(sp)), c1 = Math.sin(TAU * Math.sqrt(sp));
      const pa = H.push < 1 ? Math.sin(PI * H.push) : 0, eqd = 1 - ease(H.eq), eqdL = 1 - ease(H.eqL), ek = ease(H.eatK);
      const chew = eating && st.eat.t > .3 ? Math.abs(Math.sin(t * 14)) : 0;
      // свет у глаз (руки и вещи от 1-го лица)
      const ey = P.y + (P.sneak ? 1.27 : 1.62);
      Lit.update(H.eye, st, P.x, ey, P.z, dt, heldLight());
      if (H.fpItem) VR.itemLightF(H.fpItem.geometry, H.eye.lv);
      if (H.fpOff) VR.itemLightF(H.fpOff.geometry, H.eye.lv);
      const body = actors.get('me')?.E;
      if (body) { if (H.tpItem) VR.itemLightF(H.tpItem.geometry, body.lv); if (H.tpOff) VR.itemLightF(H.tpOff.geometry, body.lv); }
      const kR = H.tpItem?.userData.kind || '', kL = H.tpOff?.userData.kind || '', two = kL === 'bow';

      // ── от 1-го лица ──
      const first = !st.camMode;
      fp.visible = first && !!H.arm && !P.dead && !(st.hudHidden) && !P.pk && !P.hang;   // залезает, висит — руки на краю
      if (fp.visible) {
        const cam = R.camera;
        if (fp.parent !== cam) { cam.add(fp); if (!cam.parent) R.scene.add(cam); }
        // запаздывание при повороте (рука догоняет взгляд) и покачивание на ходу
        const yaw = st.rig.yaw, pit = st.rig.fp || 0, S2 = H.sway;
        if (!S2.ok) { S2.y = yaw; S2.p = pit; S2.ok = true; }
        const ks = 1 - Math.exp(-dt * 13);
        S2.y += wrap(yaw - S2.y) * ks; S2.p += (pit - S2.p) * ks;
        const dy = Math.max(-.35, Math.min(.35, wrap(S2.y - yaw))), dp = Math.max(-.3, Math.min(.3, S2.p - pit));
        const Fe = st.rig.feel, mot = st.rig.motion ?? 1, bw = Fe ? Fe.bobW * mot : 0, bp = Fe ? Fe.bobPh : 0;
        SWY[0] = Math.cos(bp) * .012 * bw - dy * .12; SWY[1] = -Math.abs(Math.sin(bp)) * .016 * bw + dp * .1; SWY[2] = 0; SWY[3] = dp * .6; SWY[4] = dy * .7; SWY[5] = 0;

        // правая: обычная поза (пустая — своя; у тетивы лука), еда, копание и толчок (как раньше) или удар боя
        const mk = H.name ? 0 : 1;
        if (two) mix(HOLD_FP.bowR, HOLD_FP.drawR, ease(draw));
        else if (kR === 'torch') copyBase(HOLD_FP.torch);
        else mix(FP, EMPTY, mk);
        const er = eatOff ? 0 : ek;
        if (er > 0) mix(keep(), EAT, er);
        let mv = MV;
        if (cm && MOT_FP[cm]) mv = motion(cm, cv);
        else if (two && shotK > 0) mv = motion('shoot', 1 + shotK);
        else {
          MV.fill(0);
          MV[0] = -.2 * b1; MV[1] = -.08 * a1 + .05 * c1 + .045 * pa - .5 * eqd + .025 * chew * er; MV[2] = -.13 * a1 - .12 * pa;
          MV[3] = -.85 * b1 + .2 * a1 + .18 * pa - .6 * eqd + .08 * chew * er; MV[4] = .42 * b1; MV[5] = -.22 * a1;
        }
        placeArm(0, pose, BASE, mv, cam, SWY);
        if (H.elbow) H.elbow.rotation.x = -.12 - .35 * er - .25 * b1;
        const it = H.fpItem;
        if (it) placeItem(it, 0, kR === 'torch' ? ITEM.torch : it.geometry.userData.flat ? ITEM.flat : ITEM.block, 1);

        // левая: видна, когда в ней что-то есть (щит, факел, еда, лук)
        poseL.visible = !!H.nameL && !!H.armL;
        if (H.fpOff) H.fpOff.visible = poseL.visible;
        if (poseL.visible) {
          const el = eatOff ? ek : 0;
          if (two) copyBase(HOLD_FP.bowL);
          else if (kL === 'shield') mix(HOLD_FP.shield, HOLD_FP.guard, ease(guard));
          else if (kL === 'torch') copyBase(HOLD_FP.torch);
          else copyBase(FP);
          if (el > 0) mix(keep(), EAT, el);
          if (two) { F3[0] -= .04 * ease(draw); F3[1] += .05 * ease(draw); }
          MV.fill(0);
          if (cm === 'bash') motion('bash', cv);
          MV[1] += -.5 * eqdL + .025 * chew * el; MV[3] += -.6 * eqdL + .08 * chew * el;
          if (H.pushH && H.push < 1) { MV[1] += .045 * pa; MV[2] -= .12 * pa; MV[3] += .18 * pa; }
          // натянутый лук чуть дрожит, когда долго держит
          if (two && draw >= 1) { MV[0] += Math.sin(t * 31) * .003; MV[1] += Math.sin(t * 27) * .003; }
          placeArm(1, poseL, BASE, MV, cam, SWY);
          if (H.elbowL) H.elbowL.rotation.x = -.12 - .35 * el - (kL === 'shield' ? .25 * ease(guard) : 0);
          const io = H.fpOff;
          if (io) placeItem(io, 1, kL === 'shield' ? ITEM.shield : kL === 'bow' ? ITEM.bow : kL === 'torch' ? ITEM.torch : io.geometry.userData.flat ? ITEM.flat : ITEM.block, kL === 'shield' ? 1 + .14 * Math.sin(PI * H.fl) : 1);
        }
      }
      // ── от 3-го лица: вещи у человечка; позы рук — слой world3d (H.pose → a.hold), без него — правой рукой поверх позы ──
      if (me?.ch && !me.hidden) {
        const ch = me.ch;
        if (!H.layer && ch.armR && ch.elbowR) {
          const arm = ch.armR, elb = ch.elbowR, hold = H.name ? 1 : 0;
          arm.rotation.x += -.32 * hold - 1.75 * b1 + .35 * a1 - .85 * pa + (-1.5 - .1 * chew) * ek;
          arm.rotation.y += .5 * b1 + .62 * ek;
          arm.rotation.z += -.22 * a1 - .12 * ek;
          elb.rotation.x += -.3 * hold - .55 * a1 - .25 * pa + (-1.55 + .15 * chew) * ek;
        }
        // щит и лук в левой — по телу (плоскость щита — лицом вперёд, лук — боком, по наклону взгляда), а не по кисти
        const io = H.tpOff, hL = handOff(ch);
        if (io && hL && (kL === 'shield' || kL === 'bow') && ch.root) {
          ch.root.updateMatrixWorld(true);
          if (kL === 'shield') ef.set(-.12 + .35 * ease(guard) * (st.rig.fp || 0), .25 * (1 - ease(guard)), 0, 'YXZ');
          else ef.set(-(st.rig.fp || 0) * ease(draw) * .8, -PI / 2, .12, 'YXZ');
          qw.setFromEuler(ef); ch.root.getWorldQuaternion(qh); qw.premultiply(qh);
          hL.getWorldQuaternion(qh); qh.invert(); io.quaternion.copy(qh).multiply(qw);
          vw.set(kL === 'shield' ? -.06 : -.02, kL === 'shield' ? .04 : 0, kL === 'shield' ? .12 : .05).applyQuaternion(qw);
          hL.getWorldPosition(v2); v2.add(vw);
          mh.copy(hL.matrixWorld).invert(); v2.applyMatrix4(mh); io.position.copy(v2);
          const sc = (kL === 'shield' ? .62 : .58) / Math.max(1e-3, hL.getWorldScale(vw).x); io.scale.set(sc, sc, sc);
        }
      }
    };
    // ── другие игроки (игра вместе, js/games/kubomir-coop.js): вещи в их руках — у человечка (правая — handL, левая — handR), свет —
    //    их (litActor, как у своего); человечка пересобрали (дальний / ближний) — вещи заново. Ушёл — H.forget(ключ) ──
    const others = new Map();   // ключ актёра → { ch, m, o, nm, nmL }
    function dropO(O){ for (const k of ['m', 'o']) { const m = O[k]; if (m) { m.parent?.remove(m); m.geometry.dispose(); O[k] = null; } } O.nm = O.nmL = ''; }
    H.remote = (a, mainId, offId) => {
      if (!a?.ch) return;
      let O = others.get(a.key); if (!O) others.set(a.key, O = { ch: null, m: null, o: null, nm: '', nmL: '' });
      if (O.ch !== a.ch) { dropO(O); O.ch = a.ch; }
      for (const side of [0, 1]) {
        const k = side ? 'o' : 'm', kn = side ? 'nmL' : 'nm', name = (side ? offId : mainId) || '';
        if (O[kn] === name) continue;
        if (O[k]) { O[k].parent?.remove(O[k]); O[k].geometry.dispose(); O[k] = null; }
        O[kn] = name;
        const hand = side ? handOff(a.ch) : handMain(a.ch);
        if (!name || !hand || !V().item(name)) continue;
        const m = VR.itemMesh(name, 15 << 12); m.castShadow = true; m.renderOrder = 20; m.userData.kind = kindOf(name); m.userData.item = true;
        placeInHand(m, hand, side); O[k] = m;
      }
      const L = actors.get(a.key);
      if (L) { if (O.m) VR.itemLightF(O.m.geometry, L.E.lv); if (O.o) VR.itemLightF(O.o.geometry, L.E.lv); }
    };
    H.forget = key => {
      const O = others.get(key); if (O) { dropO(O); others.delete(key); }
      const L = actors.get(key); if (L) { for (const m of L.mats.values()) m.dispose(); actors.delete(key); }
    };
    H.state = () => ({ swing: +H.sw.toFixed(3), push: +H.push.toFixed(3), equip: +H.eq.toFixed(3), eat: +H.eatK.toFixed(3), mining: H.mining, item: H.name, off: H.nameL, fp: fp.visible, arm: !!H.arm, armL: !!H.armL, fpL: fp.visible && poseL.visible,
      eye: [...H.eye.lv].map(x => +x.toFixed(2)), body: actors.get('me') ? [...actors.get('me').E.lv].map(x => +x.toFixed(2)) : null, layer: H.layer, hold: { ...H.tp },
      fist: H.arm && fp.visible ? (() => { const p = new T.Vector3(); (H.hand || H.arm).getWorldPosition(p); R.camera.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; })() : null,
      fistL: H.armL && fp.visible && poseL.visible ? (() => { const p = new T.Vector3(); (H.handL || H.armL).getWorldPosition(p); R.camera.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; })() : null });
    H.dispose = () => {
      dropArms();
      for (const k of ['fpItem', 'tpItem', 'fpOff', 'tpOff']) { const m = H[k]; if (m) { m.parent?.remove(m); m.geometry.dispose(); H[k] = null; } }
      fp.parent?.remove(fp);
      const me = st.A?.get('me'); if (me) me.hold = null;
      for (const [key, L] of actors) { const a = st.A?.get(key); if (a?.ch === L.ch && L.ch) scanBack(L.ch, [...L.mats.values()]); for (const m of L.mats.values()) m.dispose(); }
      actors.clear();
      for (const O of others.values()) dropO(O);
      others.clear();
    };
    return H;
  }
})();

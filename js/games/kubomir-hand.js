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
  // T-096a (владелец 22.10: «в руку плохо предметы держит… вещь висит рядом с кулаком»): вещь от 1-го лица — РЕБЁНОК кисти (копии
  // кисти человечка): куда кисть, туда и вещь (замах, удар, еда, смена вещи), рукоять всегда в кулаке. Хват задан так, как вещь
  // видна в покое (оси камеры, как в Bedrock; левая — зеркально): rot — повороты XYZ, s — размер, g — точка картинки (кубика),
  // которая сидит в кулаке (рукоять инструмента — внизу слева картинки, низ факела, середина щита и лука), o — сдвиг от середины
  // кулака (камера). Из этого при смене вещи считается место вещи в осях кисти (gripLocal) — дальше она просто едет с кистью
  const GRIP_FP = {
    tool: { rot: [-.2, 2.55, -.25], s: .34, g: [-.38, -.36, 0], o: [-.005, .015, .01] },     // кирка, топор, лопата, меч — рукоятью, головой вверх к середине
    flat: { rot: [-.12, 2.7, -.08], s: .28, g: [0, -.32, 0], o: [-.01, .03, 0] },           // еда, слитки, палки — стоймя
    block: { rot: [.42, .78, 0], s: .19, g: [0, -.36, 0], o: [-.02, .04, -.01] },          // блок — на кулаке, углом к нам
    torch: { rot: [-.15, 2.6, -.05], s: .4, g: [0, -.36, 0], o: [0, .02, 0] },             // факел — за низ ручки, огонь вверх
    // щит и лук — вещи левой руки: rotL — как видны в ЛЕВОЙ (правой — зеркально). Остальным левая — зеркало правой с поворотом
    // картинки на 180° вокруг вертикали (иначе у картинки-диагонали в кулаке оказался бы пустой угол, а не рукоять)
    shield: { rotL: [-.08, -.3, -.05], s: .5, g: [0, -.06, 0], o: [.01, .03, -.05] },        // щит — перед кулаком, лицом к нам
    bow: { rotL: [0, -.35, .32], s: .5, g: [.12, 0, 0], o: [0, 0, -.01] },                   // лук — кулак на середине дуги
  };
  const gripKind = (k, flat) => k === 'pick' || k === 'axe' || k === 'shovel' || k === 'sword' || k === 'hoe' ? 'tool' : k === 'torch' ? 'torch' : k === 'shield' ? 'shield' : k === 'bow' ? 'bow' : k === 'block' && !flat ? 'block' : 'flat';
  // руки «по делу» от 1-го лица (правая; левая — зеркально и в другой фазе): вис — кулаки вверху на краю; залезть — руки на край и
  // толкают вниз; лестница — перекладины по очереди; плывёт — брасс (к груди → вперёд → в стороны); ползком — тянутся вперёд по очереди
  const ACT_FP = {
    hang: { fist: [.27, .2, -.5], dir: [-.12, 1, -.32], roll: -.2 },
    push: { fist: [.3, -.38, -.58], dir: [-.16, -.22, -1], roll: -.3 },
    ladder: { fist: [.24, .02, -.48], dir: [-.1, .85, -.45], roll: -.25 },
    swimA: { fist: [.14, -.31, -.42], dir: [-.3, .15, -1], roll: -.6 },
    swimB: { fist: [.07, -.2, -.86], dir: [-.1, .12, -1], roll: -.3 },
    swimC: { fist: [.5, -.27, -.62], dir: [-.55, .1, -1], roll: -.2 },
    crawl: { fist: [.3, -.46, -.6], dir: [-.3, .22, -1], roll: -.45 },
  };
  // левая пустая — ниже и в стороне (видна, не мешает смотреть; владелец: «рука есть, но её просто так не видно»)
  const EMPTY_L = { fist: [.34, -.37, -.64], dir: [-.42, .5, -1], roll: -.35 };
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
  window.KubomirHand = { create, FP, EMPTY, EMPTY_L, EAT, GRIP_FP, HOLD_FP, ACT_FP, MOT_FP };   // числа позы — снаружи видны (подстройка на живую в консоли)

  function create(st){
    const R = st.R, T = R.T, VR = st.VR, Lit = window.KubomirEnts.Lit, V = () => window.D37E.vox, CB = () => window.D37E?.combat;
    const H = { sw: 1, push: 1, pushH: 0, eq: 1, eqL: 1, eatK: 0, mining: false, name: null, nameL: null, arm: null, armCh: null, elbow: null, hand: null, armL: null, elbowL: null, handL: null,
      fpItem: null, tpItem: null, fpOff: null, tpOff: null, fl: 0, eye: Lit.make(T), sway: { y: 0, p: 0, ok: false }, n: 0,
      tp: { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, tpFP: { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, alpha: 0, layer: false,
      // T-096a: хват вещи пересчитать (сменили вещь или руку), доля позы «по делу» у каждой руки (вис, лестница, брасс, ползком),
      // фазы: брасс 0…1, ползком, лестница
      gripDirty: [true, true], spk: [0, 0], actLast: '', swimC: 0, crawlPh: 0 };
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
      for (const it of [H.fpItem, H.fpOff]) if (it && it.parent !== fp) fp.add(it);   // вещи — из старых кистей (их материалы не трогаем)
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
      fpAttach(0); fpAttach(1);
    }
    // вещь от 1-го лица — в кисть руки (её копии); хват пересчитать (gripLocal) перед кадром
    function fpAttach(side){
      const it = side ? H.fpOff : H.fpItem; if (!it) return;
      const hd = side ? H.handL : H.hand;
      if (hd) { if (it.parent !== hd) hd.add(it); } else if (it.parent !== fp) fp.add(it);
      H.gripDirty[side] = true;
    }
    // Хват: рука в покое (поза по тому, что держит, без движения) → где кисть в осях камеры → где должна быть вещь (GRIP_FP) → её
    // место в осях кисти. Считается при смене вещи или руки, не каждый кадр (без мусора: свои векторы и матрицы)
    const GM = new T.Matrix4(), GI = new T.Matrix4(), GQ = new T.Quaternion(), GQ2 = new T.Quaternion(), GE = new T.Euler(), GP = new T.Vector3(), GS = new T.Vector3(), GV = new T.Vector3(), GV2 = new T.Vector3(), GS2 = new T.Vector3();
    const QY180 = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), PI), MV0 = [0, 0, 0, 0, 0, 0], SW0 = [0, 0, 0, 0, 0, 0], CH = [];
    function gripLocal(side){
      const it = side ? H.fpOff : H.fpItem, hand = side ? H.handL : H.hand, g = side ? poseL : pose, elb = side ? H.elbowL : H.elbow;
      if (!it || !hand || it.parent !== hand) return false;
      const G = GRIP_FP[it.userData.gk] || GRIP_FP.flat, m = side ? -1 : 1;
      restBase(side, it.userData.kind);
      const e0 = elb ? elb.rotation.x : 0;
      if (elb) elb.rotation.x = -.12;
      placeArm(side, g, BASE, MV0, R.camera, SW0);
      g.updateMatrix(); GM.copy(g.matrix);
      CH.length = 0; for (let o = hand; o && o !== g; o = o.parent) CH.push(o);
      for (let i = CH.length - 1; i >= 0; i--) { CH[i].updateMatrix(); GM.multiply(CH[i].matrix); }
      GM.decompose(GP, GQ, GS);   // GP — середина кулака (оси камеры), GS — размер кисти
      // поворот вещи в осях камеры: правая — rot; левая — rotL или зеркало rot с поворотом картинки на 180° (рукоять — в кулак)
      if (side && G.rotL) GE.set(G.rotL[0], G.rotL[1], G.rotL[2], 'XYZ');
      else if (!side && G.rotL) GE.set(G.rotL[0], -G.rotL[1], -G.rotL[2], 'XYZ');
      else GE.set(G.rot[0], G.rot[1] * m, G.rot[2] * m, 'XYZ');
      GQ2.setFromEuler(GE);
      if (side && !G.rotL) GQ2.multiply(QY180);
      GV.set(G.g[0] * G.s, G.g[1] * G.s, G.g[2] * G.s).applyQuaternion(GQ2);
      GV2.set(GP.x + G.o[0] * m - GV.x, GP.y + G.o[1] - GV.y, GP.z + G.o[2] - GV.z);
      GI.compose(GV2, GQ2, GS2.setScalar(G.s));
      GM.invert().multiply(GI);   // в осях кисти
      GM.decompose(it.position, it.quaternion, it.scale);
      it.userData.s0 = it.scale.x;
      if (elb) elb.rotation.x = e0;
      H.gripDirty[side] = false;
      return true;
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
        const kd = kindOf(name);
        H[kT].userData.kind = kd; H[kF].userData.kind = kd; H[kF].userData.gk = gripKind(kd, !!H[kF].geometry.userData.flat);
        fpAttach(side);
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
    // поза руки «в покое» по тому, что в ней (для хвата — gripLocal): правая — факел повыше, пусто — выше и виднее; левая — щит, лук, факел
    function restBase(s, k){
      if (!s) return copyBase(k === 'torch' ? HOLD_FP.torch : k ? FP : EMPTY);
      return copyBase(k === 'bow' ? HOLD_FP.bowL : k === 'shield' ? HOLD_FP.shield : k === 'torch' ? HOLD_FP.torch : k ? FP : EMPTY_L);
    }
    // руки «по делу» (T-096a, владелец: «рука почти бездействует»): вис, залезть, лестница, брасс, ползком — обе руки; правая и левая —
    // в разной фазе (по очереди), брасс — вместе. Поза — в SPB (правая; левую зеркалит placeArm)
    const SPB = { fist: [0, 0, 0], dir: [0, 0, 0], roll: 0 };
    function setP(o, a){ for (let i = 0; i < 3; i++) { o.fist[i] = a.fist[i]; o.dir[i] = a.dir[i]; } o.roll = a.roll; return o; }
    function lerpP(o, a, b, k){ for (let i = 0; i < 3; i++) { o.fist[i] = a.fist[i] + (b.fist[i] - a.fist[i]) * k; o.dir[i] = a.dir[i] + (b.dir[i] - a.dir[i]) * k; } o.roll = a.roll + (b.roll - a.roll) * k; return o; }
    function actNow(P){
      if (P.hang || (P.pk && P.pk.move === 'hang')) return 'hang';
      if (P.pk) return 'pk';
      if (P.climb && !P.onGround) return 'ladder';
      if (P.water > 1 && !P.onGround && !P.fly && !(P.lava > .2)) return 'swim';
      if (P.crawl) return 'crawl';
      return '';
    }
    const ACT_ELB = { hang: -.06, pk: -.2, ladder: -.45, swim: -.32, crawl: -.55 };
    function actPose(s, act){
      const P = st.P, o = SPB, ph = s ? PI : 0;
      if (act === 'hang') {
        setP(o, ACT_FP.hang);
        if (P.shimmyNow) { const q = Math.max(0, Math.sin((P.climbPh || 0) + ph)); o.fist[1] += .05 * q; o.fist[2] -= .02 * q; }   // по краю — перехват
      } else if (act === 'pk') lerpP(o, ACT_FP.hang, ACT_FP.push, ease(((P.pk ? P.pk.k || 0 : 1) - .2) / .55));   // руки на край → толкают вниз
      else if (act === 'ladder') { setP(o, ACT_FP.ladder); const q = Math.sin((P.climbPh || 0) + ph); o.fist[1] += .13 * q; o.fist[2] -= .04 * Math.max(0, q); }
      else if (act === 'swim') {
        const c = H.swimC;   // 0….45 — от груди вперёд, ….8 — в стороны, …1 — к груди
        if (c < .45) lerpP(o, ACT_FP.swimA, ACT_FP.swimB, ease(c / .45));
        else if (c < .8) lerpP(o, ACT_FP.swimB, ACT_FP.swimC, ease((c - .45) / .35));
        else lerpP(o, ACT_FP.swimC, ACT_FP.swimA, ease((c - .8) / .2));
      } else if (act === 'crawl') { setP(o, ACT_FP.crawl); const q = Math.sin(H.crawlPh + ph); o.fist[2] -= .1 * q; o.fist[1] += .05 * Math.max(0, q); }
      return o;
    }

    // ── кадр ──
    const SWY = [0, 0, 0, 0, 0, 0], SWL = [0, 0, 0, 0, 0, 0];
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
      // свет у глаз (руки и вещи от 1-го лица): глаза — по телу (присел, ползком — ниже)
      const ey = P.y + (P.crawl ? .42 : P.sneak || (P.h && P.h < 1.8 - 1e-6) ? 1.27 : 1.62);
      Lit.update(H.eye, st, P.x, ey, P.z, dt, heldLight());
      if (H.fpItem) VR.itemLightF(H.fpItem.geometry, H.eye.lv);
      if (H.fpOff) VR.itemLightF(H.fpOff.geometry, H.eye.lv);
      const body = actors.get('me')?.E;
      if (body) { if (H.tpItem) VR.itemLightF(H.tpItem.geometry, body.lv); if (H.tpOff) VR.itemLightF(H.tpOff.geometry, body.lv); }
      const kR = H.tpItem?.userData.kind || '', kL = H.tpOff?.userData.kind || '', two = kL === 'bow';
      // руки «по делу» (вис, залезть, лестница, плывёт, ползком): доля позы — плавно (≈ 0,12 с), фазы движений
      const act = actNow(P), vh = Math.hypot(P.vx || 0, P.vz || 0);
      if (act) H.actLast = act;
      if (act === 'swim') H.swimC = (H.swimC + dt * (vh > .6 ? .85 : .45)) % 1;
      if (act === 'crawl') H.crawlPh += dt * (1.2 + vh * 4);
      const kk = Math.min(1, dt / .12);
      H.spk[0] += ((act ? 1 : 0) - H.spk[0]) * kk; H.spk[1] += ((act ? 1 : 0) - H.spk[1]) * kk;
      const hk = ease(H.spk[0]), hkL = ease(H.spk[1]), aL = H.actLast || '', onEdge = act === 'hang' || act === 'pk';

      // ── от 1-го лица: обе руки видны всегда (левая пустая — ниже и в стороне), вещи — в кулаках (дети кистей) ──
      const first = !st.camMode;
      fp.visible = first && !!H.arm && !P.dead && !(st.hudHidden);
      if (fp.visible) {
        const cam = R.camera;
        if (fp.parent !== cam) { cam.add(fp); if (!cam.parent) R.scene.add(cam); }
        if (H.gripDirty[0]) gripLocal(0);
        if (H.gripDirty[1]) gripLocal(1);
        // запаздывание при повороте (рука догоняет взгляд) и покачивание на ходу; руки — навстречу шагу (правая вперёд — левая назад),
        // на месте — чуть дышат (каждая в своей фазе)
        const yaw = st.rig.yaw, pit = st.rig.fp || 0, S2 = H.sway;
        if (!S2.ok) { S2.y = yaw; S2.p = pit; S2.ok = true; }
        const ks = 1 - Math.exp(-dt * 13);
        S2.y += wrap(yaw - S2.y) * ks; S2.p += (pit - S2.p) * ks;
        const dy = Math.max(-.35, Math.min(.35, wrap(S2.y - yaw))), dp = Math.max(-.3, Math.min(.3, S2.p - pit));
        const Fe = st.rig.feel, mot = st.rig.motion ?? 1, bw = Fe ? Fe.bobW * mot : 0, bp = Fe ? Fe.bobPh : 0;
        const stride = Math.sin(bp) * .022 * bw * (1 - hk), br = Math.sin(t * 1.7) * .005 * mot, brL = Math.sin(t * 1.7 + 1.3) * .005 * mot;
        SWY[0] = Math.cos(bp) * .012 * bw - dy * .12; SWY[1] = -Math.abs(Math.sin(bp)) * .016 * bw + dp * .1; SWY[2] = 0; SWY[3] = dp * .6; SWY[4] = dy * .7; SWY[5] = 0;
        for (let i = 0; i < 6; i++) SWL[i] = SWY[i];
        SWY[1] += br; SWY[2] += stride; SWL[1] += brL; SWL[2] -= stride;

        // правая: обычная поза (пустая — своя; у тетивы лука), еда, копание и толчок (как раньше) или удар боя; «по делу» — поверх
        const mk = H.name ? 0 : 1;
        if (two) mix(HOLD_FP.bowR, HOLD_FP.drawR, ease(draw));
        else if (kR === 'torch') copyBase(HOLD_FP.torch);
        else mix(FP, EMPTY, mk);
        const er = eatOff ? 0 : ek;
        if (er > 0) mix(keep(), EAT, er);
        if (hk > .001) { keep(); mix(B0, actPose(0, aL), hk); }
        let mv = MV;
        if (cm && MOT_FP[cm]) mv = motion(cm, cv);
        else if (two && shotK > 0) mv = motion('shoot', 1 + shotK);
        else {
          MV.fill(0);
          MV[0] = -.2 * b1; MV[1] = -.08 * a1 + .05 * c1 + .045 * pa - .5 * eqd + .025 * chew * er; MV[2] = -.13 * a1 - .12 * pa;
          MV[3] = -.85 * b1 + .2 * a1 + .18 * pa - .6 * eqd + .08 * chew * er; MV[4] = .42 * b1; MV[5] = -.22 * a1;
        }
        if (hk > .001) for (let i = 0; i < 6; i++) mv[i] *= 1 - hk;   // висит, лезет, плывёт — без взмахов
        placeArm(0, pose, BASE, mv, cam, SWY);
        if (H.elbow) { const e0 = -.12 - .35 * er - .25 * b1; H.elbow.rotation.x = e0 + ((ACT_ELB[aL] ?? e0) - e0) * hk; }
        if (H.fpItem) H.fpItem.visible = !onEdge;   // на краю — руки держатся (вещь «в кармане»)

        // левая: видна всегда; держит щит, факел, лук, еду — своя поза, пустая — ниже и в стороне; правая бьёт — левая чуть назад
        poseL.visible = !!H.armL;
        if (poseL.visible) {
          const el = eatOff ? ek : 0;
          if (two) copyBase(HOLD_FP.bowL);
          else if (kL === 'shield') mix(HOLD_FP.shield, HOLD_FP.guard, ease(guard));
          else if (kL === 'torch') copyBase(HOLD_FP.torch);
          else copyBase(H.nameL ? FP : EMPTY_L);
          if (el > 0) mix(keep(), EAT, el);
          if (two) { F3[0] -= .04 * ease(draw); F3[1] += .05 * ease(draw); }
          if (hkL > .001) { keep(); mix(B0, actPose(1, aL), hkL); }
          MV.fill(0);
          if (cm === 'bash') motion('bash', cv);
          MV[1] += -.5 * eqdL + .025 * chew * el - .02 * a1; MV[2] += .035 * a1; MV[3] += -.6 * eqdL + .08 * chew * el;
          if (H.pushH && H.push < 1) { MV[1] += .045 * pa; MV[2] -= .12 * pa; MV[3] += .18 * pa; }
          // натянутый лук чуть дрожит, когда долго держит
          if (two && draw >= 1) { MV[0] += Math.sin(t * 31) * .003; MV[1] += Math.sin(t * 27) * .003; }
          if (hkL > .001) for (let i = 0; i < 6; i++) MV[i] *= 1 - hkL;
          placeArm(1, poseL, BASE, MV, cam, SWL);
          if (H.elbowL) { const e0 = -.12 - .35 * el - (kL === 'shield' ? .25 * ease(guard) : 0); H.elbowL.rotation.x = e0 + ((ACT_ELB[aL] ?? e0) - e0) * hkL; }
          const io = H.fpOff;
          if (io) { io.visible = !onEdge; if (kL === 'shield' && io.userData.s0) io.scale.setScalar(io.userData.s0 * (1 + .14 * Math.sin(PI * H.fl))); }
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
      fistL: H.armL && fp.visible && poseL.visible ? (() => { const p = new T.Vector3(); (H.handL || H.armL).getWorldPosition(p); R.camera.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; })() : null,
      // T-096a: вещь в кулаке — где её точка хвата (рукоять, низ факела) относительно середины кулака (ед. камеры) и в чьей она кисти
      grip: gripErr(0), gripL: gripErr(1), inHand: !!(H.fpItem && H.hand && H.fpItem.parent === H.hand), inHandL: !!(H.fpOff && H.handL && H.fpOff.parent === H.handL), act: H.actLast, spk: [+H.spk[0].toFixed(3), +H.spk[1].toFixed(3)] });
    function gripErr(side){
      const it = side ? H.fpOff : H.fpItem, hd = side ? H.handL : H.hand;
      if (!it || !hd || !fp.visible || it.parent !== hd) return null;
      const G = GRIP_FP[it.userData.gk] || GRIP_FP.flat, a = new T.Vector3(G.g[0], G.g[1], G.g[2]), b = new T.Vector3();
      it.updateWorldMatrix(true, false); a.applyMatrix4(it.matrixWorld); hd.getWorldPosition(b);
      R.camera.worldToLocal(a); R.camera.worldToLocal(b);
      return +a.distanceTo(b).toFixed(3);
    }
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

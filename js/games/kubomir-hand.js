// ═══════════════════════════════════════
//  «КУБОМИР» — руки как в Майнкрафте и свет человечков как у кубиков
// ═══════════════════════════════════════
// H = window.KubomirHand.create(st) — после st.A (свой человечек 'me'), st.VR и st.ents:
//   H.act('swing' | 'push') — взмах (удар, копание) / короткий толчок вперёд (поставить блок, открыть, нажать);
//   H.mine(вкл) — каждый кадр: пока копаешь, взмахи повторяются сами (как в Майнкрафте);
//   H.frame(dt, t) — после A.update (поза человечка уже посчитана), до R.render; H.state() — для проверок; H.dispose().
// Еда — st.eat = { t, need } (ставит kubomir.js): рука с едой ко рту, покачивание, крошки.
// От 1-го лица: рука — копия правой руки своего человечка (тот же рукав, кожа, перчатки), вещь — в кулаке (как в Bedrock),
// покачивание на ходу, запаздывание при повороте, смена вещи — опустить и поднять; рука и вещь «из глаз» (VR.entityMaterial
// / VR.itemMesh с fp: не уходят в стену). От 3-го лица — те же движения рукой человечка поверх позы world3d (кости плеча и
// локтя после A.update; сам world3d.js не меняем). Свет всех человечков (свой и других) — как у кубиков: материалы — копии
// VR.entityMaterial с одной униформой на человечка (KubomirEnts.Lit — плавно по 8 клеткам вокруг груди).
(() => {
  const PI = Math.PI, TAU = PI * 2;
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
  const wrap = a => { while (a > PI) a -= TAU; while (a < -PI) a += TAU; return a; };
  // длительности, с: взмах (как удар в Майнкрафте — 6 тактов), толчок, смена вещи
  const SWING = .3, PUSH = .2, EQUIP = .25;
  // рука от 1-го лица (оси камеры: x вправо, y вверх, −z вперёд): где кулак, куда смотрит рука (от плеча к кулаку), поворот
  // вокруг руки, размер; на узком экране кулак ближе к середине
  const FP = { fist: [.42, -.4, -.72], dir: [-.38, .32, -1], roll: -.5, scale: .74 };
  const EMPTY = { fist: [.3, -.25, -.68], dir: [-.55, .62, -1], roll: -.4 };   // пустая рука — выше и виднее (как в Майнкрафте)
  const EAT = { fist: [.13, -.29, -.52], dir: [-.7, .75, -.6], roll: -.9 };
  // вещь от 1-го лица — над кулаком, в осях камеры (как в Bedrock): блок углом к нам, плоская вещь (инструмент, еда) — рукоятью
  // в кулаке, головой вверх и к середине экрана (видна обратная сторона картинки); off — от кулака, rot — повороты (XYZ), s — размер
  const ITEM = { block: { off: [-.06, .1, -.02], rot: [.42, .78, 0], s: .19 }, flat: { off: [-.09, .14, -.03], rot: [-.2, 2.55, -.25], s: .34 } };
  window.KubomirHand = { create, FP, EMPTY, EAT, ITEM };   // числа позы — снаружи видны (подстройка на живую в консоли)

  function create(st){
    const R = st.R, T = R.T, VR = st.VR, Lit = window.KubomirEnts.Lit, V = () => window.D37E.vox;
    const H = { sw: 1, push: 1, eq: 1, eatK: 0, mining: false, name: null, arm: null, armCh: null, elbow: null, hand: null, fpItem: null, tpItem: null,
      eye: Lit.make(T), sway: { y: 0, p: 0, ok: false }, n: 0 };
    const HELD = [0, 0, 0];
    const fp = new T.Group(); fp.name = 'kb:fp'; fp.visible = false;
    const pose = new T.Group(); fp.add(pose);   // плечо руки: место и поворот — каждый кадр
    const ORIG = new WeakMap();   // копия материала человечка → его исходный материал (для руки от 1-го лица)
    const actors = new Map();     // ключ актёра → { ch, E, mats: Map(исходный → копия), chk, scan }
    const heldId = () => { const s = st.P.inv[st.P.sel]; return s ? s.id : ''; };

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
      const add = a.key === 'me' ? Lit.held(heldId(), HELD) : null;
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

    // ── рука от 1-го лица: копия правой руки человечка ──
    function dropArm(){
      if (!H.arm) return;
      pose.remove(H.arm);
      H.arm.traverse(o => { if (o.isMesh && o.material && !o.userData.fp) { const m = o.material; if (Array.isArray(m)) m.forEach(x => x.dispose()); else m.dispose(); } });
      H.arm = H.elbow = H.hand = null; H.armCh = null;
    }
    function buildArm(ch){
      dropArm();
      if (!ch?.armR) return;
      const mats = new Map();
      const conv = m => {
        if (Array.isArray(m)) return m.map(conv);
        let c = mats.get(m);
        if (!c) { const src = ORIG.get(m) || m; c = VR.entityMaterial(src, H.eye.u, { fp: true, kind: 'fp' }); mats.set(m, c); }
        return c;
      };
      const copy = (src, top) => {
        const o = src.isMesh ? new T.Mesh(src.geometry, conv(src.material)) : new T.Group();
        if (!top) { o.position.copy(src.position); o.quaternion.copy(src.quaternion); o.scale.copy(src.scale); }
        if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 30; }
        if (src === ch.elbowR) H.elbow = o;
        if (src === ch.handR) H.hand = o;
        for (const c of src.children) {
          if (c.userData?.item || c === H.tpItem || c.isSprite || c.isPoints || c.isLine) continue;
          if (c.isMesh || c.isGroup || c.isBone || c.type === 'Object3D') o.add(copy(c, false));
        }
        return o;
      };
      H.arm = copy(ch.armR, true);
      H.arm.scale.setScalar(FP.scale);
      if (H.elbow) H.elbow.rotation.set(-.12, 0, 0);
      H.La = (ch.armR.userData?.La || .62) * FP.scale;
      pose.add(H.arm);
      H.armCh = ch;
    }
    // вещь в кулаке: как у человечка (кость кисти); блок — повёрнут углом, инструмент — рукоятью в кулаке
    function placeInHand(m, hand){
      if (m.parent !== hand) hand.add(m);
      const flat = m.geometry.userData.flat;
      m.position.set(0, -.08, .1); m.rotation.set(flat ? -.4 : 0, flat ? 0 : .6, flat ? -1.2 : 0); m.scale.setScalar(flat ? .4 : .27);
    }

    // ── вещь в руке: две сетки (из глаз и у человечка), смена — опустить и поднять ──
    function setItem(name){
      const old = H.name; H.name = name;
      for (const k of ['fpItem', 'tpItem']) { const m = H[k]; if (m) { m.parent?.remove(m); m.geometry.dispose(); H[k] = null; } }
      if (name) {
        H.fpItem = VR.itemMesh(name, 15 << 12, { fp: true }); H.fpItem.renderOrder = 31; H.fpItem.frustumCulled = false; H.fpItem.castShadow = false;
        H.tpItem = VR.itemMesh(name, 15 << 12); H.tpItem.renderOrder = 20; H.tpItem.castShadow = true;
        fp.add(H.fpItem);
      }
      if (old !== null) H.eq = 0;   // первая вещь при входе в мир — без анимации
    }
    function tpAttach(ch){
      if (!H.tpItem || !ch?.handR) return;
      placeInHand(H.tpItem, ch.handR);
      H.tpItem.scale.multiplyScalar(.95);
    }

    // ── действия ──
    H.act = kind => {
      if (kind === 'push') { H.push = 0; return; }
      if (H.sw >= .5) H.sw = 0;   // новый взмах — если прошлый прошёл больше половины (как в Майнкрафте)
    };
    H.mine = on => { H.mining = !!on; };

    // ── кадр ──
    const qa = new T.Quaternion(), qb = new T.Quaternion(), e = new T.Euler(0, 0, 0, 'YXZ'), ie = new T.Euler(), v1 = new T.Vector3(), v2 = new T.Vector3(), DOWN = new T.Vector3(0, -1, 0);
    const F = [0, 0, 0], D = [0, 0, 0];
    H.frame = (dt, t) => {
      const P = st.P, A = st.A, me = A?.get('me'); H.n++;
      // свет человечков (свой — с факелом в руке)
      if (A) for (const a of A.list.values()) litActor(a, dt);
      // вещь в руке
      const name = P.dead ? '' : heldId();
      if (name !== H.name) setItem(name);
      if (me?.ch && me.ch !== H.armCh) { buildArm(me.ch); tpAttach(me.ch); }
      if (H.tpItem && me?.ch && H.tpItem.parent !== me.ch.handR) tpAttach(me.ch);
      // таймеры: взмах (повтор, пока копает), толчок, смена вещи, еда
      if (H.sw < 1) H.sw = Math.min(1, H.sw + dt / SWING);
      if (H.sw >= 1 && H.mining) H.sw = 0;
      if (H.push < 1) H.push = Math.min(1, H.push + dt / PUSH);
      if (H.eq < 1) H.eq = Math.min(1, H.eq + dt / EQUIP);
      const eating = !!st.eat;
      H.eatK += ((eating ? 1 : 0) - H.eatK) * Math.min(1, dt * (eating ? 9 : 7));
      const sp = H.sw < 1 ? H.sw : 0, a1 = Math.sin(PI * sp), b1 = Math.sin(PI * Math.sqrt(sp)), c1 = Math.sin(TAU * Math.sqrt(sp));
      const pa = H.push < 1 ? Math.sin(PI * H.push) : 0, eqd = 1 - ease(H.eq), ek = ease(H.eatK);
      const chew = eating && st.eat.t > .3 ? Math.abs(Math.sin(t * 14)) : 0;
      // свет у глаз (рука и вещь от 1-го лица)
      const ey = P.y + (P.sneak ? 1.27 : 1.62);
      Lit.update(H.eye, st, P.x, ey, P.z, dt, Lit.held(name, HELD));
      if (H.fpItem) VR.itemLightF(H.fpItem.geometry, H.eye.lv);
      const body = actors.get('me')?.E;
      if (H.tpItem && body) VR.itemLightF(H.tpItem.geometry, body.lv);

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
        // кулак и направление руки: обычная поза → еда (ко рту), сверху — взмах, толчок, смена вещи
        const mk = H.name ? 0 : 1;   // пустая рука — своя поза
        for (let i = 0; i < 3; i++) {
          const f0 = FP.fist[i] + (EMPTY.fist[i] - FP.fist[i]) * mk, d0 = FP.dir[i] + (EMPTY.dir[i] - FP.dir[i]) * mk;
          F[i] = f0 + (EAT.fist[i] - f0) * ek; D[i] = d0 + (EAT.dir[i] - d0) * ek;
        }
        F[0] *= Math.max(.62, Math.min(1, (cam.aspect || 1.6) / 1.6));
        F[0] += -.2 * b1 + Math.cos(bp) * .012 * bw - dy * .12;
        F[1] += -.08 * a1 + .05 * c1 - Math.abs(Math.sin(bp)) * .016 * bw + .045 * pa - .5 * eqd + .025 * chew * ek + dp * .1;
        F[2] += -.13 * a1 - .12 * pa;
        v1.set(D[0], D[1], D[2]).normalize();
        qa.setFromUnitVectors(DOWN, v1);
        const r0 = FP.roll + (EMPTY.roll - FP.roll) * mk;
        qb.setFromAxisAngle(v1, r0 + (EAT.roll - r0) * ek); qa.premultiply(qb);
        // взмах — кулак уходит вперёд и вниз (поворот вокруг оси камеры x), внутрь; толчок — чуть вверх; смена вещи — вниз
        e.set(-.85 * b1 + .2 * a1 + .18 * pa - .6 * eqd + dp * .6 + .08 * chew * ek, .42 * b1 + dy * .7, -.22 * a1, 'YXZ');
        qb.setFromEuler(e); qa.premultiply(qb);
        pose.quaternion.copy(qa);
        // плечо — так, чтобы кулак оказался в F
        v2.copy(v1).multiplyScalar(H.La || .57).applyQuaternion(qb);
        pose.position.set(F[0] - v2.x, F[1] - v2.y, F[2] - v2.z);
        if (H.elbow) H.elbow.rotation.x = -.12 - .35 * ek - .25 * b1;
        // вещь — над кулаком (в осях камеры), поворачивается вместе со взмахом
        const it = H.fpItem;
        if (it) {
          const O = it.geometry.userData.flat ? ITEM.flat : ITEM.block;
          v2.set(O.off[0], O.off[1], O.off[2]).applyQuaternion(qb);
          it.position.set(F[0] + v2.x, F[1] + v2.y, F[2] + v2.z);
          ie.set(O.rot[0], O.rot[1], O.rot[2], 'XYZ'); it.quaternion.setFromEuler(ie).premultiply(qb);
          it.scale.setScalar(O.s);
        }
      }
      // ── от 3-го лица: та же рука у человечка (поверх позы world3d — кости уже выставлены A.update) ──
      if (me?.ch && !me.hidden && me.ch.armR && me.ch.elbowR) {
        const arm = me.ch.armR, elb = me.ch.elbowR, hold = H.name ? 1 : 0;
        arm.rotation.x += -.32 * hold - 1.75 * b1 + .35 * a1 - .85 * pa + (-1.5 - .1 * chew) * ek;
        arm.rotation.y += .5 * b1 + .62 * ek;
        arm.rotation.z += -.22 * a1 - .12 * ek;
        elb.rotation.x += -.3 * hold - .55 * a1 - .25 * pa + (-1.55 + .15 * chew) * ek;
      }
    };
    H.state = () => ({ swing: +H.sw.toFixed(3), push: +H.push.toFixed(3), equip: +H.eq.toFixed(3), eat: +H.eatK.toFixed(3), mining: H.mining, item: H.name, fp: fp.visible, arm: !!H.arm,
      eye: [...H.eye.lv].map(x => +x.toFixed(2)), body: actors.get('me') ? [...actors.get('me').E.lv].map(x => +x.toFixed(2)) : null,
      fist: H.arm && fp.visible ? (() => { const p = new T.Vector3(); (H.hand || H.arm).getWorldPosition(p); R.camera.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; })() : null });
    H.dispose = () => {
      dropArm();
      for (const k of ['fpItem', 'tpItem']) { const m = H[k]; if (m) { m.parent?.remove(m); m.geometry.dispose(); H[k] = null; } }
      fp.parent?.remove(fp);
      for (const [key, L] of actors) { const a = st.A?.get(key); if (a?.ch === L.ch && L.ch) scanBack(L.ch, [...L.mats.values()]); for (const m of L.mats.values()) m.dispose(); }
      actors.clear();
    };
    return H;
  }
})();

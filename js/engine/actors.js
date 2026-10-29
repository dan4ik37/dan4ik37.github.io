// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — персонажи в сцене: человечки (World3D.kit), поворот, анимация шага/бега/прыжка/сидения,
//  позы движка (присед, кувырок, вис, лестница, паркур), эмоции, питомец бежит следом, след за спиной, дальние — экономнее
// ═══════════════════════════════════════
// A = D37E.actors(R). Свой персонаж: A.pose(key, P.pose()) каждый кадр (из player.js); чужие — то же из сети с плавным
// догоном. Поля позы: x, y, z, yaw, moving, speed (м/с), air, crouch (0…1), sit + seatY (верх сиденья), roll (0…1 или −1),
// rollBack, hang, ladder, climbPh, pk ('vault' | 'mantle' | 'climb' | 'hang' | 'pullup') + pkK (0…1), swim / dive, crawl (ползком), lie + seatY (лежит на
// спине; sleep — глаза закрыты, T-123). hidden — не рисовать
// (вид от 1-го лица). A.update(dt, t, cam) — каждый кадр (без мусора: свой объект настроек анимации у каждого).
// Взгляд: ближайший к камере (свой игрок) смотрит туда же, куда камера, а если она спереди — на неё; остальные — на соседа
// рядом или на камеру поблизости. a.lookAt = { x, y, z } — смотреть на точку (свой выбор игры).
// Дальние (дальше 30 ед.) — упрощённый человечек (LOD: меньше треугольников, без мелочей), ближе 24 — снова подробный;
// не больше одной пересборки за кадр.
// Кто-то сдвинулся или машет — R.shadowDirty(true): тени солнца перерисуются (render.js, на mid — через кадр).
// Телефон 📱 (как в ГТА, world3d.js): a.phone = '' | 'use' | 'call' | 'play' | 'photo' (или код 0…4) — достанет, будет держать,
// уберёт сам; звуки (шорох кармана, касание экрана, щелчок камеры) — здесь, у человечка. От 1-го лица (a.hidden и a.fp = rig
// камеры) — кисть с телефоном у камеры, внизу экрана (покачивание — по настройке «Покачивание камеры»).
// Руки и предметы (бой, D37E.combat): a.hold = { r, l, m, mh, v, g, d, p } (CB.pose / CB.unpack) — слой поз world3d.js; null — без него.
// Простые фигурки (V2, T-127 AI LOD P1): A.impostors({ cap, far, near }) — у актёров, добавленных с { npc: true } (жители, зомби),
// подробный человечек (V0/V1) — только у cap ближайших к камере и ближе far; остальные — простые фигурки (туловище, ноги, голова
// цветов человечка) тремя общими InstancedMesh на всех: 3 вызова отрисовки вместо 7–18 на каждого, сборка — без K.build. Новый
// житель сначала фигурка, подробным становится в update (не больше одной сборки за кадр). Сколько подробных — дело устройства
// (телефон 8, ПК 16 в «Мире»); сколько жителей есть и что они делают — у всех одинаково. A.impCount() — сколько сейчас фигурок.
(() => {
  const E = window.D37E = window.D37E || {};
  const LOD_FAR = 30, LOD_NEAR = 24, LOOK_R = 5, CAM_R = 14, ME_R = 8;
  const IMP_MAX = 128;   // фигурок на один набор актёров (больше — не рисуются)
  // цвета фигурки: верх, низ, кожа — у kit (World3D.impColors), иначе — от ключа
  const PAL = ['#4f8df7', '#e8384f', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#f472b6', '#64748b'];
  const impColors = (look, key) => {
    try { const c = window.World3D?.impColors?.(look, key); if (c) return c; } catch (e) {}
    let h = 2166136261; const k = String(key); for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
    return [PAL[(h >>> 0) % PAL.length], '#3b4252', look?.tone === 'zombie' ? '#86b36b' : '#f7cba5'];
  };
  E.actors = function (R){
    const K = R.K, list = new Map(), trail = K.trails(R.scene);
    let arr = [];   // те же, что в list, — обход без итераторов
    const sync = () => { arr = [...list.values()]; };
    function setLook(a, look, force){
      const sig = JSON.stringify(look || {});
      if (a.v2) { if (a.sig !== sig || !a.impC) { a.sig = sig; a.look = look; a.impC = impColors(look, a.key); a.impK = null; } return; }   // простая фигурка (V2)
      if (a.ch && a.sig === sig && !force) return;
      const ch = K.build(look, a.key, { lod: a.lod });
      ch.root.userData.actor = true; if (ch.pet) ch.pet.userData.actor = true;   // погода (precip.js): человечек — не крыша
      R.scene.add(ch.root);
      if (ch.pet) R.scene.add(ch.pet);
      if (a.vm) { a.vm.dispose(); a.vm = null; }   // кисть от 1-го лица — другого цвета
      if (a.ch) {
        ch.yaw = a.ch.yaw; ch.phase = a.ch.phase; ch.emote = a.ch.emote; ch.emoteT = a.ch.emoteT;
        K.phoneKeep?.(a.ch, ch);   // телефон — как был (не доставать заново)
        if (ch.pet && a.ch.pet) ch.pet.position.copy(a.ch.pet.position);
        ch.root.position.copy(a.ch.root.position); ch.root.rotation.y = a.ch.root.rotation.y; ch.root.visible = a.ch.root.visible;
        K.dispose(a.ch);
      } else ch.yaw = a.yaw;
      if (ch.pet && !a.ch) ch.pet.position.set(a.x, a.y + .5, a.z);
      a.ch = ch; a.sig = sig; a.look = look; a.impC = null;
      R.shadowsOn?.(ch.root);   // человечек отбрасывает тень
      R.shadowDirty?.();
    }
    function add(key, look, o = {}, opt = null){
      remove(key);
      const a = { key, x: o.x || 0, y: o.y || 0, z: o.z || 0, yaw: o.yaw || 0, moving: false, speed: 0, air: false, crouch: 0, sit: false, seatY: null, sitY: 0,
        roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, crawl: false, lie: false, sleep: false, hidden: false, fade: 1, lastTrail: 0, ch: null, sig: '',
        lod: 0, lookAt: null, lk: null, lkT: Math.random() * .3, lt: { x: 0, y: 0, z: 0 }, phone: '', hold: null, fp: null, vm: null, bob: { ph: 0, w: 0, k: 1 },
        ao: { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, crawl: false, lie: false, sleep: false, look: null, phone: '', hold: null },
        imp: !!opt?.npc, v2: !!(opt?.npc && L2), impC: null, impK: null, camD: 0, bobP: Math.random() * 6 };
      setLook(a, look);
      list.set(key, a); sync();
      return a;
    }
    function remove(key){ const a = list.get(key); if (a) { if (a.vm) a.vm.dispose(); if (a.ch) K.dispose(a.ch); list.delete(key); sync(); for (let i = 0; i < arr.length; i++) if (arr[i].lk === a) arr[i].lk = null; R.shadowDirty?.(); } }
    // Звуки телефона у человечка (события кадра из world3d.js: 1 — шорох кармана, 2 — касание экрана, 4 — щелчок камеры)
    const PHE = K.PHE || { POCKET: 1, TAP: 2, SHUTTER: 4 };
    function phoneSounds(a, ev, cam){
      const AU = E._audio; if (!AU) return;
      const d = cam ? Math.hypot(a.x - cam.x, a.z - cam.z) : 0;
      if (d > 18) return;
      const p = { x: a.x, y: a.y + 1, z: a.z, vol: .5 };
      if (ev & PHE.POCKET) AU.play('ph_pocket', p);
      if (ev & PHE.TAP) { p.vol = .3; AU.play('ph_tap', p); }
      if (ev & PHE.SHUTTER && d < 9) { p.vol = .45; AU.play('ph_shutter', p); }
    }
    let phBloom = false;
    // куда смотреть: точка в a.lt (общий объект актёра) или null
    function lookTarget(a, cam, me, t){
      if (a.lookAt) return a.lookAt;
      if (!cam || a.hidden) return null;
      const ch = a.ch, hy = a.y + (ch.headY || 1.6);
      if (a === me) {   // свой: камера спереди — на неё, иначе — туда, куда смотрит камера
        const dx = cam.x - a.x, dz = cam.z - a.z, f = Math.sin(ch.yaw) * dx + Math.cos(ch.yaw) * dz;
        if (f > 0) { a.lt.x = cam.x; a.lt.y = cam.y; a.lt.z = cam.z; return a.lt; }
        const l = Math.hypot(dx, dz) || 1;
        a.lt.x = a.x - dx / l * 6; a.lt.y = hy; a.lt.z = a.z - dz / l * 6;
        return a.lt;
      }
      if (t >= a.lkT) {   // сосед рядом (раз в 0,3 с) или камера поблизости
        a.lkT = t + .3;
        let best = null, bd = LOOK_R * LOOK_R;
        for (let i = 0; i < arr.length; i++) { const b = arr[i]; if (b === a || b.hidden || b.fade < .5) continue; const d = (b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z); if (d < bd) { bd = d; best = b; } }
        a.lk = best || ((cam.x - a.x) * (cam.x - a.x) + (cam.z - a.z) * (cam.z - a.z) < CAM_R * CAM_R ? cam : null);
      }
      const k = a.lk;
      if (!k) return null;
      if (k === cam) { a.lt.x = cam.x; a.lt.y = cam.y; a.lt.z = cam.z; }
      else { a.lt.x = k.x; a.lt.y = k.y + (k.ch?.headY || 1.6); a.lt.z = k.z; }
      return a.lt;
    }
    // ── простые фигурки (V2): кто подробный — cap ближайших к камере ближе far (возврат в фигурку — дальше far + 6 или не в cap) ──
    let L2 = null, IMP = null, impN = 0, tierT = 0;
    const rank = [];   // кандидаты (без мусора: тот же массив)
    function impMesh(){
      if (IMP !== null) return IMP;
      const T = window.THREE;
      if (!T || !R.scene) return (IMP = false);
      const mk = (geo, y) => { geo.translate(0, y, 0); const m = new T.InstancedMesh(geo, new T.MeshLambertMaterial({ color: '#ffffff' }), IMP_MAX); m.count = 0; m.frustumCulled = false; m.userData.actor = true; R.scene.add(m); R.shadowsOn?.(m); return m; };
      IMP = { legs: mk(new T.BoxGeometry(.42, .86, .26), .43), torso: mk(new T.BoxGeometry(.54, .66, .32), 1.19), head: mk(new T.SphereGeometry(.23, 10, 8), 1.76),
        m4: new T.Matrix4(), col: new T.Color() };
      return IMP;
    }
    function tiers(cam){
      rank.length = 0;
      for (let i = 0; i < arr.length; i++) { const a = arr[i]; if (!a.imp) continue; a.camD = cam ? Math.hypot(a.x - cam.x, a.z - cam.z) : 0; rank.push(a); }
      for (let i = 1; i < rank.length; i++) { const a = rank[i]; let j = i - 1; while (j >= 0 && rank[j].camD > a.camD) { rank[j + 1] = rank[j]; j--; } rank[j + 1] = a; }   // вставками: n — десятки
      let rigs = 0, built = false;
      for (let i = 0; i < rank.length; i++) {
        const a = rank[i], want = rigs < L2.cap && a.camD < (a.v2 ? L2.near : L2.far + 6);
        if (want) rigs++;
        if (!want && !a.v2) { if (a.vm) { a.vm.dispose(); a.vm = null; } K.dispose(a.ch); a.ch = null; a.v2 = true; a.impC = impColors(a.look, a.key); R.shadowDirty?.(); }
        else if (want && a.v2 && !built) { built = true; a.v2 = false; setLook(a, a.look, true); }   // одна сборка за проход
      }
    }
    const impSet = (m, n) => { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
    function figures(t){
      const M = impMesh(); if (!M) return false;
      let n = 0, moved = false;
      for (let i = 0; i < arr.length && n < IMP_MAX; i++) {
        const a = arr[i]; if (!a.v2 || a.hidden || a.fade < .02) continue;
        const bob = a.moving ? Math.abs(Math.sin(t * 9 + a.bobP)) * .07 : 0, y = (a.sit ? (a.seatY != null ? a.seatY - .5 : a.sitY) : a.y) + bob;
        M.m4.makeRotationY(a.yaw); M.m4.setPosition(a.x, y, a.z);
        M.legs.setMatrixAt(n, M.m4); M.torso.setMatrixAt(n, M.m4); M.head.setMatrixAt(n, M.m4);
        if (a.impK !== a.impC) { a.impK = a.impC; const c = a.impC; M.torso.setColorAt(n, M.col.set(c[0])); M.legs.setColorAt(n, M.col.set(c[1])); M.head.setColorAt(n, M.col.set(c[2])); a.impI = n; }
        else if (a.impI !== n) { const c = a.impC; M.torso.setColorAt(n, M.col.set(c[0])); M.legs.setColorAt(n, M.col.set(c[1])); M.head.setColorAt(n, M.col.set(c[2])); a.impI = n; }
        if (a.moving) moved = true;
        n++;
      }
      if (n !== impN) moved = true;
      impSet(M.legs, n); impSet(M.torso, n); impSet(M.head, n);
      impN = n;
      return moved;
    }
    function update(dt, t, cam){
      let moved = false, rebuild = true, me = null;
      if (L2 && (t >= tierT || !cam)) { tierT = t + .25; tiers(cam); rebuild = false; }   // 4 раза в секунду — кто подробный
      if (L2 || impN) { if (figures(t)) moved = true; }
      if (cam) { let bd = ME_R * ME_R; for (let i = 0; i < arr.length; i++) { const a = arr[i]; if (String(a.key).startsWith('npc:')) continue; const d = (a.x - cam.x) * (a.x - cam.x) + (a.z - cam.z) * (a.z - cam.z); if (d < bd) { bd = d; me = a; } } }
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a.ch) continue;   // простая фигурка (V2) — нарисована выше
        // дальний — упрощённый человечек (пересборка — не больше одной за кадр)
        if (cam && rebuild) {
          const d = Math.hypot(a.x - cam.x, a.z - cam.z), want = d > LOD_FAR ? 1 : d < LOD_NEAR ? 0 : a.lod;
          if (want !== a.lod) { a.lod = want; setLook(a, a.look, true); rebuild = false; }
        }
        const ch = a.ch, root = ch.root, p = root.position;
        const y = a.lie ? (a.seatY != null ? a.seatY : a.y) : a.sit ? (a.seatY != null ? a.seatY - (ch.hipY || .52) + .03 : a.sitY) : a.y;   // лежит — на месте (кровать, земля)
        if (p.x !== a.x || p.y !== y || p.z !== a.z) { moved = true; p.set(a.x, y, a.z); }
        const yaw0 = ch.yaw;
        ch.yaw = E.dampAngle(ch.yaw, a.yaw, a.sit || a.lie || a.pk || a.hang || a.ladder || a.roll >= 0 ? 40 : 14, dt);
        if (Math.abs(ch.yaw - yaw0) > 1e-4) moved = true;
        root.rotation.y = ch.yaw;
        const far = cam ? Math.hypot(a.x - cam.x, a.z - cam.z) > 42 : false;
        if (!far || (t * 20 | 0) % 3 === 0) {
          const o = a.ao;
          o.rate = a.speed < .3 ? 10.5 : 5 + a.speed; o.air = a.air; o.sit = a.sit; o.crouch = a.crouch;
          o.roll = a.roll; o.rollBack = a.rollBack; o.hang = a.hang; o.ladder = a.ladder; o.climbPh = a.climbPh; o.pk = a.pk; o.pkK = a.pkK;
          o.swim = a.swim; o.dive = a.dive; o.crawl = a.crawl; o.phone = a.phone; o.hold = a.hold; o.lie = a.lie; o.sleep = a.sleep;
          o.look = far ? null : lookTarget(a, cam, me, t);
          K.animate(ch, a.moving && !a.sit && !a.lie, far ? dt * 3 : dt, t, o);
          const ps = ch.phS;
          if (ps) {   // телефон: звуки, свечение экрана (mid/high — постобработка), от 1-го лица — кисть у камеры
            if (ps.ev) phoneSounds(a, ps.ev, cam);
            if (!phBloom && ps.o > 1 && R.bloom && R.q !== 'low' && K.phoneMats) { phBloom = true; for (const m of K.phoneMats()) R.bloom(m, .45); }
            if (a.hidden && a.fp && ps.o > 1) {
              if (!a.vm && K.phoneView) { a.vm = K.phoneView(ch); R.scene.add(a.vm.g); }
              const F = a.fp.feel, b = a.bob;
              b.ph = F ? F.bobPh : 0; b.w = F ? F.bobW : 0; b.k = a.fp.motion ?? 1;
              a.vm?.place(R.camera, ch, t, b);
            } else if (a.vm && a.vm.g.visible) a.vm.g.visible = false;
            if (ps.o > 0 && ps.o < 2) moved = true;   // достаёт / убирает — тени за рукой
          }
        }
        if (a.moving || a.air || a.roll >= 0 || a.hang || a.ladder || a.pk || a.swim || ch.emote) moved = true;
        if (a.moving && !a.air && !a.hang && !a.ladder && ch.R.trail !== 'none' && t - a.lastTrail > .09) {
          a.lastTrail = t;
          trail.emit(ch.R.trail, a.x - Math.sin(ch.yaw) * .4, a.y, a.z - Math.cos(ch.yaw) * .4, t);
        }
        if (ch.pet) {
          const tx = a.x - Math.sin(ch.yaw) * .9 + Math.cos(ch.yaw) * .7, tz = a.z - Math.cos(ch.yaw) * .9 - Math.sin(ch.yaw) * .7, pp = ch.pet.position;
          pp.x = E.damp(pp.x, tx, 5, dt); pp.z = E.damp(pp.z, tz, 5, dt);
          pp.y = E.damp(pp.y, a.y + .45, 8, dt) + Math.abs(Math.sin(t * 7 + ch.phase)) * (a.moving ? .05 : .012);
        }
        const vis = a.fade > .02 && !a.hidden;
        if (root.visible !== vis) { root.visible = vis; moved = true; }
        if (ch.pet && ch.pet.visible !== (a.fade > .02)) ch.pet.visible = a.fade > .02;
      }
      trail.update(dt);
      if (moved) R.shadowDirty?.(true);
    }
    return {
      list, add, remove, setLook, update,
      get: k => list.get(k),
      pose(key, p){ const a = list.get(key); if (a && p) Object.assign(a, p); return a; },
      emote(key, e, t){ const a = list.get(key); if (a?.ch) { a.ch.emote = e; a.ch.emoteT = t; } },
      top: key => list.get(key)?.ch?.top || 2.3,
      // простые фигурки: { cap — сколько подробных, far — дальше простая (м), near — ближе снова подробная }; null — выкл.
      impostors(o){ L2 = o ? { cap: Math.max(0, o.cap | 0), far: o.far || 56, near: o.near || (o.far || 56) - 6 } : null; tierT = 0;
        if (!L2) for (const a of arr) if (a.v2) { a.v2 = false; setLook(a, a.look, true); } },
      impCount: () => impN,
      tierOf: key => { const a = list.get(key); return !a ? null : a.v2 ? 'V2' : a.lod ? 'V1' : 'V0'; },
      dispose(){
        for (const a of list.values()) { if (a.vm) a.vm.dispose(); if (a.ch) K.dispose(a.ch); } list.clear(); arr = []; rank.length = 0; trail.clear();
        if (IMP) { for (const m of [IMP.legs, IMP.torso, IMP.head]) { m.parent?.remove(m); m.geometry.dispose(); m.material.dispose(); m.dispose?.(); } }
        IMP = null; impN = 0; R.shadowDirty?.();
      },
    };
  };
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — персонажи в сцене: человечки (World3D.kit), поворот, анимация шага/бега/прыжка/сидения,
//  позы движка (присед, кувырок, вис, лестница, паркур), эмоции, питомец бежит следом, след за спиной, дальние — экономнее
// ═══════════════════════════════════════
// A = D37E.actors(R). Свой персонаж: A.pose(key, P.pose()) каждый кадр (из player.js); чужие — то же из сети с плавным
// догоном. Поля позы: x, y, z, yaw, moving, speed (м/с), air, crouch (0…1), sit + seatY (верх сиденья), roll (0…1 или −1),
// rollBack, hang, ladder, climbPh, pk ('vault' | 'mantle' | 'climb' | 'hang' | 'pullup') + pkK (0…1). hidden — не рисовать
// (вид от 1-го лица). A.update(dt, t, cam) — каждый кадр (без мусора: свой объект настроек анимации у каждого).
// Кто-то сдвинулся или машет — R.shadowDirty(true): тени солнца перерисуются (render.js, на mid — через кадр).
(() => {
  const E = window.D37E = window.D37E || {};
  E.actors = function (R){
    const K = R.K, list = new Map(), trail = K.trails(R.scene);
    let arr = [];   // те же, что в list, — обход без итераторов
    const sync = () => { arr = [...list.values()]; };
    function setLook(a, look){
      const sig = JSON.stringify(look || {});
      if (a.ch && a.sig === sig) return;
      const ch = K.build(look, a.key);
      R.scene.add(ch.root);
      if (ch.pet) R.scene.add(ch.pet);
      if (a.ch) { ch.yaw = a.ch.yaw; ch.phase = a.ch.phase; if (ch.pet && a.ch.pet) ch.pet.position.copy(a.ch.pet.position); K.dispose(a.ch); }
      else ch.yaw = a.yaw;
      if (ch.pet) ch.pet.position.set(a.x, a.y + .5, a.z);
      a.ch = ch; a.sig = sig; a.look = look;
      R.shadowsOn?.(ch.root);   // человечек отбрасывает тень
      R.shadowDirty?.();
    }
    function add(key, look, o = {}){
      remove(key);
      const a = { key, x: o.x || 0, y: o.y || 0, z: o.z || 0, yaw: o.yaw || 0, moving: false, speed: 0, air: false, crouch: 0, sit: false, seatY: null, sitY: 0,
        roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, hidden: false, fade: 1, lastTrail: 0, ch: null, sig: '',
        ao: { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0 } };
      setLook(a, look);
      list.set(key, a); sync();
      return a;
    }
    function remove(key){ const a = list.get(key); if (a) { K.dispose(a.ch); list.delete(key); sync(); R.shadowDirty?.(); } }
    function update(dt, t, cam){
      let moved = false;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i], ch = a.ch, root = ch.root, p = root.position;
        const y = a.sit ? (a.seatY != null ? a.seatY - (ch.hipY || .52) + .03 : a.sitY) : a.y;
        if (p.x !== a.x || p.y !== y || p.z !== a.z) { moved = true; p.set(a.x, y, a.z); }
        const yaw0 = ch.yaw;
        ch.yaw = E.dampAngle(ch.yaw, a.yaw, a.sit || a.pk || a.hang || a.ladder || a.roll >= 0 ? 40 : 14, dt);
        if (Math.abs(ch.yaw - yaw0) > 1e-4) moved = true;
        root.rotation.y = ch.yaw;
        const far = cam ? Math.hypot(a.x - cam.x, a.z - cam.z) > 42 : false;
        if (!far || (t * 20 | 0) % 3 === 0) {
          const o = a.ao;
          o.rate = a.speed < .3 ? 10.5 : 5 + a.speed; o.air = a.air; o.sit = a.sit; o.crouch = a.crouch;
          o.roll = a.roll; o.rollBack = a.rollBack; o.hang = a.hang; o.ladder = a.ladder; o.climbPh = a.climbPh; o.pk = a.pk; o.pkK = a.pkK;
          K.animate(ch, a.moving && !a.sit, far ? dt * 3 : dt, t, o);
        }
        if (a.moving || a.air || a.roll >= 0 || a.hang || a.ladder || a.pk || ch.emote) moved = true;
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
      emote(key, e, t){ const a = list.get(key); if (a) { a.ch.emote = e; a.ch.emoteT = t; } },
      top: key => list.get(key)?.ch.top || 2.3,
      dispose(){ for (const a of list.values()) K.dispose(a.ch); list.clear(); arr = []; trail.clear(); R.shadowDirty?.(); },
    };
  };
})();

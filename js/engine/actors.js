// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — персонажи в сцене: человечки (World3D.kit), поворот, анимация шага/бега/прыжка/сидения,
//  позы движка (присед, кувырок, вис, лестница, паркур), эмоции, питомец бежит следом, след за спиной, дальние — экономнее
// ═══════════════════════════════════════
// A = D37E.actors(R). Свой персонаж: A.pose(key, P.pose()) каждый кадр (из player.js); чужие — то же из сети с плавным
// догоном. Поля позы: x, y, z, yaw, moving, speed (м/с), air, crouch (0…1), sit + seatY (верх сиденья), roll (0…1 или −1),
// rollBack, hang, ladder, climbPh, pk ('vault' | 'mantle' | 'climb' | 'hang' | 'pullup') + pkK (0…1), swim / dive. hidden — не рисовать
// (вид от 1-го лица). A.update(dt, t, cam) — каждый кадр (без мусора: свой объект настроек анимации у каждого).
// Взгляд: ближайший к камере (свой игрок) смотрит туда же, куда камера, а если она спереди — на неё; остальные — на соседа
// рядом или на камеру поблизости. a.lookAt = { x, y, z } — смотреть на точку (свой выбор игры).
// Дальние (дальше 30 ед.) — упрощённый человечек (LOD: меньше треугольников, без мелочей), ближе 24 — снова подробный;
// не больше одной пересборки за кадр.
// Кто-то сдвинулся или машет — R.shadowDirty(true): тени солнца перерисуются (render.js, на mid — через кадр).
(() => {
  const E = window.D37E = window.D37E || {};
  const LOD_FAR = 30, LOD_NEAR = 24, LOOK_R = 5, CAM_R = 14, ME_R = 8;
  E.actors = function (R){
    const K = R.K, list = new Map(), trail = K.trails(R.scene);
    let arr = [];   // те же, что в list, — обход без итераторов
    const sync = () => { arr = [...list.values()]; };
    function setLook(a, look, force){
      const sig = JSON.stringify(look || {});
      if (a.ch && a.sig === sig && !force) return;
      const ch = K.build(look, a.key, { lod: a.lod });
      R.scene.add(ch.root);
      if (ch.pet) R.scene.add(ch.pet);
      if (a.ch) {
        ch.yaw = a.ch.yaw; ch.phase = a.ch.phase; ch.emote = a.ch.emote; ch.emoteT = a.ch.emoteT;
        if (ch.pet && a.ch.pet) ch.pet.position.copy(a.ch.pet.position);
        ch.root.position.copy(a.ch.root.position); ch.root.rotation.y = a.ch.root.rotation.y; ch.root.visible = a.ch.root.visible;
        K.dispose(a.ch);
      } else ch.yaw = a.yaw;
      if (ch.pet && !a.ch) ch.pet.position.set(a.x, a.y + .5, a.z);
      a.ch = ch; a.sig = sig; a.look = look;
      R.shadowsOn?.(ch.root);   // человечек отбрасывает тень
      R.shadowDirty?.();
    }
    function add(key, look, o = {}){
      remove(key);
      const a = { key, x: o.x || 0, y: o.y || 0, z: o.z || 0, yaw: o.yaw || 0, moving: false, speed: 0, air: false, crouch: 0, sit: false, seatY: null, sitY: 0,
        roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, hidden: false, fade: 1, lastTrail: 0, ch: null, sig: '',
        lod: 0, lookAt: null, lk: null, lkT: Math.random() * .3, lt: { x: 0, y: 0, z: 0 },
        ao: { rate: 10.5, air: false, sit: false, crouch: 0, roll: -1, rollBack: false, hang: false, ladder: false, climbPh: 0, pk: '', pkK: 0, swim: false, dive: false, look: null } };
      setLook(a, look);
      list.set(key, a); sync();
      return a;
    }
    function remove(key){ const a = list.get(key); if (a) { K.dispose(a.ch); list.delete(key); sync(); for (let i = 0; i < arr.length; i++) if (arr[i].lk === a) arr[i].lk = null; R.shadowDirty?.(); } }
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
    function update(dt, t, cam){
      let moved = false, rebuild = true, me = null;
      if (cam) { let bd = ME_R * ME_R; for (let i = 0; i < arr.length; i++) { const a = arr[i]; if (String(a.key).startsWith('npc:')) continue; const d = (a.x - cam.x) * (a.x - cam.x) + (a.z - cam.z) * (a.z - cam.z); if (d < bd) { bd = d; me = a; } } }
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        // дальний — упрощённый человечек (пересборка — не больше одной за кадр)
        if (cam && rebuild) {
          const d = Math.hypot(a.x - cam.x, a.z - cam.z), want = d > LOD_FAR ? 1 : d < LOD_NEAR ? 0 : a.lod;
          if (want !== a.lod) { a.lod = want; setLook(a, a.look, true); rebuild = false; }
        }
        const ch = a.ch, root = ch.root, p = root.position;
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
          o.swim = a.swim; o.dive = a.dive;
          o.look = far ? null : lookTarget(a, cam, me, t);
          K.animate(ch, a.moving && !a.sit, far ? dt * 3 : dt, t, o);
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
      emote(key, e, t){ const a = list.get(key); if (a) { a.ch.emote = e; a.ch.emoteT = t; } },
      top: key => list.get(key)?.ch.top || 2.3,
      dispose(){ for (const a of list.values()) K.dispose(a.ch); list.clear(); arr = []; trail.clear(); R.shadowDirty?.(); },
    };
  };
})();

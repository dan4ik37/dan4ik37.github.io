// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — камера: от 3-го лица (крутится мышью/пальцем/стиком, приближается колесом/щипком, не залезает
//  в стены) и от 1-го лица + «ощущение тела» (перенос Player/CameraFeel.cs из Unity): покачивание на ходу, шире обзор
//  на бегу, «присед» камеры при приземлении (пружина), лёгкий наклон горизонта при шаге вбок, толчок (kick), тряска
//  (shake), кувырок от 1-го лица — нырок через плечо
// ═══════════════════════════════════════
// rig = D37E.cameraRig(camera, { yaw, pitch, dist }); rig.follow(P) — сам слушает приземления игрока (player.js);
// каждый кадр: rig.update(dt, P (или точка {x, y, z}), look {dx, dy, zoom}, phys, C). rig.mode = 'third' | 'first'.
// rig.motion — настройка «Покачивание камеры» 0…1 (localStorage d37_cam_motion), rig.sens — чувствительность.
// rig.kick(сила) — кивок при ударе; rig.shake(градусы, секунды) — тряска мира. Камеру от 3-го лица останавливают только
// тела с data.cam (стены домов), чтобы деревья и фонари не дёргали её.
(() => {
  const E = window.D37E = window.D37E || {};
  const U = E.UNIT || 2.1 / 1.8, DEG = Math.PI / 180;
  const store = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : +v; } catch (e) { return d; } };

  E.cameraRig = function (camera, o = {}){
    const rig = {
      mode: o.mode || 'third', yaw: o.yaw ?? 0, pitch: o.pitch ?? .6, fp: 0, dist: o.dist ?? 11, minD: o.minD ?? 3.2, maxD: o.maxD ?? 26,
      minP: .08, maxP: 1.38, maxLook: 85 * DEG, tx: o.x || 0, ty: 1.5, tz: o.z || 0, cur: o.dist ?? 11, lift: o.lift ?? 1.5,
      motion: E.clamp(store('d37_cam_motion', 1), 0, 1), sens: E.clamp(store('d37_cam_sens', 1), .2, 3), fovFirst: 72,
    };
    // «Ощущение тела»
    const F = { t: 0, bobPh: 0, bobW: 0, dip: 0, dipV: 0, roll: 0, kick: 0, kickRoll: 0, shUntil: 0, shDur: 0, shStr: 0, shSeed: 0 };
    rig.feel = F;
    // fwd/right — один и тот же объект (без мусора каждый шаг): читать сразу
    const FW = { x: 0, z: -1 }, RT = { x: 1, z: 0 }, SHK = { x: 0, y: 0, z: 0 }, CH0 = { x: 0, y: 0, z: 0 };
    const camOnly = c => !!c.data?.cam;
    rig.fwd = () => { FW.x = -Math.sin(rig.yaw); FW.z = -Math.cos(rig.yaw); return FW; };
    rig.right = () => { RT.x = Math.cos(rig.yaw); RT.z = -Math.sin(rig.yaw); return RT; };
    rig.snap = (x, y, z) => { rig.tx = x; rig.ty = y + rig.lift; rig.tz = z; };
    rig.setMotion = v => { rig.motion = E.clamp(+v || 0, 0, 1); try { localStorage.setItem('d37_cam_motion', String(rig.motion)); } catch (e) {} };
    // Приземление: пружина, толчок по скорости падения (CameraFeel: > 3 м/с)
    rig.land = v => { if (v > 3 * U) F.dipV -= E.clamp(v / U * .04, 0, .5) * U * Math.max(.35, rig.motion); };
    rig.kick = (k = 1) => { F.kick = Math.max(F.kick, 1.4 * k); F.kickRoll = (Math.random() < .5 ? -1 : 1) * .8 * k; };
    rig.shake = (strength, duration) => {
      if (F.t + duration > F.shUntil || strength > F.shStr) {
        F.shStr = Math.max(strength, F.t < F.shUntil ? F.shStr : 0);
        F.shDur = Math.max(.1, duration); F.shUntil = F.t + duration; F.shSeed = Math.random() * 100;
      }
    };
    rig.follow = P => { const off = [P.on('land', e => rig.land(e.v))]; return () => off.forEach(f => f()); };
    rig.toggle = () => { rig.mode = rig.mode === 'first' ? 'third' : 'first'; if (rig.mode === 'first') rig.fp = 0; return rig.mode; };

    function shakeNow(){
      const left = F.shUntil - F.t;
      if (left <= 0) { SHK.x = SHK.y = SHK.z = 0; return SHK; }
      const k = F.shStr * E.clamp(left / Math.min(1.2, F.shDur), 0, 1) * E.lerp(.35, 1, rig.motion), t = F.t * 18 + F.shSeed;
      SHK.x = (E.noise(t, 1) - .5) * 2 * k; SHK.y = (E.noise(t, 2) - .5) * 2 * k * .6; SHK.z = (E.noise(t, 3) - .5) * 2 * k * .8;
      return SHK;
    }

    rig.update = (dt, P, look, phys, C) => {
      F.t += dt;
      const ch = P?.ch || P || CH0, isP = !!P?.ch, first = rig.mode === 'first', sy = isP ? P.stepOff || 0 : 0;   // sy — плавная ступенька
      // поворот: мышь/палец + правый стик
      if (look) {
        if (first) {
          rig.yaw -= (look.dx || 0) * .0045 * rig.sens;
          rig.fp = E.clamp(rig.fp + (look.dy || 0) * .0045 * rig.sens, -rig.maxLook, rig.maxLook);
        } else {
          rig.yaw -= (look.dx || 0) * .0065 * rig.sens;
          rig.pitch = E.clamp(rig.pitch + (look.dy || 0) * .0048 * rig.sens, rig.minP, rig.maxP);
          if (look.zoom && look.zoom !== 1) rig.dist = E.clamp(rig.dist * look.zoom, rig.minD, rig.maxD);
        }
      }
      // ── ощущение тела ──
      const hv = isP ? Math.hypot(ch.vx, ch.vz) : 0, onFoot = isP && P.mode === 'move' && ch.grounded;
      const running = isP && P.running && hv > 5 * U;
      F.bobW = E.moveTo(F.bobW, onFoot && hv > .5 * U ? 1 : 0, dt * 4);
      F.bobPh += dt * 1.9 * Math.PI * 2 * E.clamp(hv / (4 * U), .6, 1.8);
      const amp = (running ? .065 : .035) * U * rig.motion;
      const bobX = Math.cos(F.bobPh) * amp * .6 * F.bobW, bobY = Math.abs(Math.sin(F.bobPh)) * amp * F.bobW;
      const breath = Math.sin(F.t * 1.3) * .006 * U * (1 - F.bobW);
      F.dipV += (-F.dip * 90 - F.dipV * 12) * dt; F.dip += F.dipV * dt;
      const strafe = C && isP && P.mode === 'move' ? C.move.x : 0;
      F.roll = E.lerp(F.roll, -strafe * .8 * rig.motion, Math.min(1, dt * 6));
      F.kick = E.moveTo(F.kick, 0, dt * 12); F.kickRoll = E.moveTo(F.kickRoll, 0, dt * 8);
      const sh = shakeNow();
      // угол обзора: на бегу шире на 8°
      const base = first ? (camera.aspect < 1 ? rig.fovFirst + 12 : rig.fovFirst) : camera.userData.fov0 || 50;
      const tf = base + (running ? 8 * rig.motion : 0);
      if (Math.abs(camera.fov - tf) > .01) { camera.fov = E.lerp(camera.fov, tf, Math.min(1, dt * 5)); camera.updateProjectionMatrix(); }

      if (!first) {
        const lift = rig.lift - (isP ? (P.crouchW || 0) * .6 : 0);
        rig.tx = E.damp(rig.tx, ch.x, 12, dt); rig.ty = E.damp(rig.ty, ch.y + sy + lift, 8, dt); rig.tz = E.damp(rig.tz, ch.z, 12, dt);
        const cp = Math.cos(rig.pitch), dx = Math.sin(rig.yaw) * cp, dy = Math.sin(rig.pitch), dz = Math.cos(rig.yaw) * cp;
        let d = rig.dist;
        if (phys) {
          const hit = phys.raycast(rig.tx, rig.ty, rig.tz, dx, dy, dz, d + .4, camOnly);
          if (hit) d = Math.max(1.4, hit.t - .4);
        }
        rig.cur = d < rig.cur ? E.damp(rig.cur, d, 30, dt) : E.damp(rig.cur, d, 5, dt);
        const ty = rig.ty + F.dip * .9;
        camera.position.set(rig.tx + dx * rig.cur, Math.max(.4, ty + dy * rig.cur + F.dip * .5), rig.tz + dz * rig.cur);
        camera.lookAt(rig.tx, ty, rig.tz);
        if (F.roll || sh.z || F.kickRoll) camera.rotateZ((F.roll * .5 + sh.z + F.kickRoll) * DEG);
        if (F.kick || sh.x) camera.rotateX(-(F.kick + sh.x) * DEG);
        if (sh.y) camera.rotateY(sh.y * DEG);
        return;
      }
      // ── от 1-го лица: глаза = рост капсулы − 0,2 м (ниже, присев и в кувырке) ──
      const eye = (ch.h ?? 2.1) - .2 * U, rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
      camera.position.set(ch.x + rx * bobX, ch.y + sy + eye + bobY + breath + F.dip, ch.z + rz * bobX);
      rig.tx = ch.x; rig.ty = ch.y + rig.lift; rig.tz = ch.z;
      // кувырок: быстро вниз (группировка), плавнее обратно; вперёд — нырок и завал на плечо, вбок — крен, назад — вверх
      let flip = 0, shoulder = 0, rollYaw = 0;
      if (isP && P.mode === 'roll' && P.roll) {
        const k = P.roll.t / (E.parkour?.ROLL_T || .8), dip = Math.sin(Math.PI * E.smooth(Math.pow(k, .8))) * rig.motion;
        const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), fwdK = P.roll.dir.x * fx + P.roll.dir.z * fz, sideK = P.roll.dir.x * rx + P.roll.dir.z * rz;
        flip = dip * (62 * Math.max(0, fwdK) + 34 * Math.abs(sideK) - 48 * Math.max(0, -fwdK));
        shoulder = dip * (-14 * Math.max(0, fwdK) - 38 * sideK);
        rollYaw = -dip * 12 * sideK;
      }
      camera.rotation.set(-rig.fp - (sh.x + flip + F.kick) * DEG, rig.yaw + (sh.y + rollYaw) * DEG, (F.roll + sh.z + shoulder + F.kickRoll) * DEG, 'YXZ');
    };
    return rig;
  };
})();

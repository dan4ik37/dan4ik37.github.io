// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — транспорт в воздухе: вертолёт ('heli': висит, наклоняется, садится на крыши) и самолёт ('plane':
//  аркадная подъёмная сила — разбег, взлёт, крен в повороте, срыв на малой скорости, мягкая посадка или авария)
// ═══════════════════════════════════════
// Ввод вертолёта: thr (W/S — вперёд/назад), steer (A/D — поворот), up (Пробел/C — вверх/вниз), boost (Shift).
// Ввод самолёта: thr (W/S — рычаг газа, держится сам), steer (A/D — крен и поворот), up (Пробел/C — нос вверх/вниз), boost.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const V = root.D37E?.vehicle; if (!V) return;
  const PI = Math.PI;
  const { clamp, moveTo, fwd, collide, impact, damage, supportAt, engine } = V.H;

  V.KINDS.heli = {
    step(v, dt, I, env){
      const d = v.def, S = d.speed, A = d.air, Hd = d.handling;
      const can = engine(v, dt, I);
      v.rotor = moveTo(v.rotor, can ? 1 : 0, dt * (can ? .55 : .22));   // раскрутка ~2 с, выбег ~4 с
      const lift = v.rotor > .75, up = clamp(+I.up || 0, -1, 1), st = clamp(+I.steer || 0, -1, 1);
      v.boost = can && !!I.boost;
      // вертикаль: тяга вверх/вниз; отпустил — висит; без тяги — вниз (с мотором выключенным — быстрее)
      const tvy = lift ? up * A.climb * (v.boost ? 1.3 : 1) : v.rotor > .3 ? -3 : -14;   // мотор встал высоко — падает (удар)
      v.vy = moveTo(v.vy, tvy, dt * (lift ? 9 : 6));
      const air = !v.grounded || v.vy > .1;
      // вперёд/назад — только в воздухе; поворот — пока винт крутится
      const tf = air && lift ? clamp(+I.thr || 0, -.5, 1) * S.max * (v.boost ? S.boost : 1) : 0;
      v.spd = moveTo(v.spd, tf, (Math.abs(tf) > Math.abs(v.spd) ? S.accel : S.accel * 1.3) * dt);
      if (v.rotor > .5) v.yaw += -Hd.turn * st * (air ? 1 : .5) * dt;
      v.steer = moveTo(v.steer, st, dt * 4);
      const [fx, fz] = fwd(v);
      v.vx = fx * v.spd; v.vz = fz * v.spd;
      v.x += v.vx * dt; v.z += v.vz * dt;
      let ny = v.y + v.vy * dt;
      // опора: земля и крыши (вертолётная площадка на небоскрёбе — тоже)
      const sy = supportAt(env, v, v.x, v.z, d.size[0] * .35, Math.max(v.y, ny) + .3);
      if (ny <= sy) {
        const hv = -v.vy; ny = sy; v.vy = 0; v.grounded = true; v.spd = moveTo(v.spd, 0, 20 * dt);
        if (hv > 9 && v.t - v.crashAt > .5) { damage(v, (hv - 9) * 8); v.crash = hv; v.crashAt = v.t; env.onCrash?.(v, hv, null); }
      } else v.grounded = false;
      v.y = ny;
      // корпус против стен (лопасти — мультяшно, по корпусу)
      const hit = collide(v, env, v.y + .3, v.y + d.size[1]);
      if (hit) { const into = impact(v, hit, env, v.vx, v.vz); if (into > 7) damage(v, into * 3); }
      // наклон: летит вперёд — нос вниз; поворот на ходу — крен
      v.pitch += (clamp(v.spd / S.max * .28, -.2, .3) - v.pitch) * Math.min(1, dt * 4);
      v.roll += ((air ? v.steer * .18 * clamp(Math.abs(v.spd) / S.max * 2, .3, 1) : 0) - v.roll) * Math.min(1, dt * 4);
    },
  };

  V.KINDS.plane = {
    step(v, dt, I, env){
      const d = v.def, S = d.speed, A = d.air, Hd = d.handling;
      const can = engine(v, dt, I);
      // рычаг газа: W/S двигают, держится сам
      if (can) v.thr = clamp(v.thr + (+I.thr || 0) * .6 * dt, 0, 1); else v.thr = moveTo(v.thr, 0, dt * .5);
      v.rotor = moveTo(v.rotor, can ? .35 + .65 * v.thr : 0, dt * .9);
      v.boost = can && !!I.boost && v.thr > .2;
      const target = v.thr * S.max * (v.boost ? S.boost : 1), st = clamp(+I.steer || 0, -1, 1), up = clamp(+I.up || 0, -1, 1);
      v.steer = moveTo(v.steer, st, dt * 3);
      if (v.grounded) {
        // по земле: руление передним колесом, тормоза (S при убранном газе); разбег → Пробел — нос вверх → взлёт
        const brake = (+I.thr || 0) < 0 && v.thr <= .05;
        v.spd = target > v.spd ? moveTo(v.spd, target, S.accel * dt) : moveTo(v.spd, target, (brake ? S.brake : S.accel * .4) * dt);
        v.yaw += -Hd.turn * .9 * v.steer * clamp(v.spd / 5, 0, 1) * (v.spd > A.takeoff * .7 ? .35 : 1) * dt;
        v.roll = moveTo(v.roll, 0, dt * 2);
        v.pitch = moveTo(v.pitch, up > 0 && v.spd >= A.takeoff * .85 ? -.22 : 0, dt * .8);
        if (v.spd >= A.takeoff && v.pitch < -.12) { v.grounded = false; v.vy = v.spd * Math.sin(-v.pitch) * .5; }
      } else {
        v.spd = target > v.spd ? moveTo(v.spd, target, S.accel * dt) : moveTo(v.spd, target, S.accel * .5 * dt);
        v.spd = Math.max(0, v.spd - 9 * Math.sin(-v.pitch) * .5 * dt);   // вверх — теряет скорость, в пике — набирает
        // нос: Пробел — вверх, C — вниз; отпустил — сам выравнивается; A/D — крен, крен — поворот
        v.pitch = moveTo(v.pitch, up ? clamp(-up * .5, -.5, .45) : 0, dt * (up ? 1.1 : .55));
        v.roll = moveTo(v.roll, v.steer * .75, dt * 2.2);
        v.yaw += -v.roll * 1.2 * clamp(v.spd / A.takeoff, .4, 1.2) * dt;
        if (v.spd < A.stall) { v.vy = moveTo(v.vy, -12, 10 * dt); v.pitch = moveTo(v.pitch, .3, dt * .9); }   // срыв: проваливается, нос вниз — набрать скорость
        else v.vy = moveTo(v.vy, v.spd * Math.sin(-v.pitch), 6 * dt);
        // у самой земли нос не тянут вверх — мягко садится (не висит над полосой)
        if (up <= 0 && v.vy > -1.5 && v.y - supportAt(env, v, v.x, v.z, 1.2, v.y + .3) < 1.4) v.vy = moveTo(v.vy, -1.5, 4 * dt);
      }
      const hs = v.spd * Math.cos(v.pitch), [fx, fz] = fwd(v);
      v.vx = fx * hs; v.vz = fz * hs;
      v.x += v.vx * dt; v.z += v.vz * dt;
      if (!v.grounded) {
        let ny = v.y + v.vy * dt;
        const sy = supportAt(env, v, v.x, v.z, 1.2, Math.max(v.y, ny) + .3);
        if (ny <= sy) {
          // касание: ровно и не круто — посадка; круто, быстро вниз или с креном — авария
          const hard = v.vy < -8 || Math.abs(v.roll) > .45 || v.pitch > .25;
          ny = sy; v.vy = 0; v.grounded = true; v.roll = 0; v.pitch = Math.min(0, v.pitch);
          if (hard && v.t - v.crashAt > .5) { damage(v, 70); v.spd *= .3; v.crash = 20; v.crashAt = v.t; env.onCrash?.(v, 20, null); }
        }
        v.y = ny;
      } else {
        const sy = supportAt(env, v, v.x, v.z, 1.2, v.y + .6);
        if (sy >= v.y - .6) v.y = sy > v.y ? Math.min(sy, v.y + 6 * dt) : sy;
        else { v.grounded = false; v.vy = 0; }   // съехал с края — летит или падает
      }
      const hit = collide(v, env, v.y + .45, v.y + d.size[1]);
      if (hit) { const into = impact(v, hit, env, v.vx, v.vz); if (!v.grounded && into > 5) damage(v, 70); }
    },
  };

  // ═══ Стандартные вертолёт и самолёт ═══
  const glow = (x, y, z, r, c) => ({ s: 'ball', x, y, z, r, m: 'glow', c, seg: 8 });
  function heliParts(c, c2){
    return [
      { s: 'box', y: 1, w: 2.2, h: 1.1, d: 3.4, c }, { s: 'ball', y: 1.62, z: .35, r: 1.25, sy: .85, c: '#bfe3f7', glass: true },
      { s: 'box', y: 1.75, z: -1.2, w: 1.6, h: .9, d: 1.2, c }, { s: 'box', y: 1.75, z: -3.6, w: .4, h: .4, d: 4.4, c },
      { s: 'box', y: 2.25, z: -5.55, w: .1, h: 1.4, d: .8, c: c2 }, { s: 'box', y: 1.9, z: -5.3, w: 1.5, h: .08, d: .5, c: c2 },
      { s: 'cyl', y: 2.55, z: -.6, r: .14, h: .7, c: '#111827', seg: 8 },
      { s: 'box', y: 2.9, z: -.6, w: 9, h: .07, d: .3, c: '#111827', spin: 'rotor', axis: 'y' }, { s: 'box', y: 2.9, z: -.6, w: .3, h: .07, d: 9, c: '#111827', spin: 'rotor', axis: 'y' },
      { s: 'box', x: -.28, y: 2.25, z: -5.55, w: .06, h: 1.5, d: .18, c: '#111827', spin: 'tail', axis: 'x' },
      ...[-1, 1].map(s => ({ s: 'box', x: s * 1.05, y: .1, z: 0, w: .12, h: .12, d: 3.2, c: '#111827' })),
      ...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => ({ s: 'box', x: sx * .95, y: .32, z: sz * .9, w: .1, h: .45, d: .1, c: '#111827' })),
      glow(1.12, 1.1, 0, .09, '#ef4444'), glow(-1.12, 1.1, 0, .09, '#22c55e'), glow(0, 2.48, -5.9, .1, '#f8fafc'),
    ];
  }
  const HSEATS = [{ pos: [.38, .75, .6], driver: true }, { pos: [-.38, .75, .6] }, { pos: [.38, .75, -.45] }, { pos: [-.38, .75, -.45] }];
  V.define({ id: 'heli', kind: 'heli', name: 'Вертолёт', icon: '🚁', size: [3.2, 3.2, 9], seats: HSEATS,
    speed: { max: 26, accel: 7, brake: 10 }, handling: { turn: 1.3 }, air: { climb: 9, maxY: 230 }, hp: 160, age: 12, cam: { dist: 17, h: 2 },
    model: { parts: heliParts('#4d5b2a', '#3f4a22') } });
  V.define({ id: 'heli_city', kind: 'heli', name: 'Городской вертолёт', icon: '🚁', size: [3.2, 3.2, 9], seats: HSEATS,
    speed: { max: 26, accel: 7, brake: 10 }, handling: { turn: 1.3 }, air: { climb: 9, maxY: 230 }, hp: 140, fuel: { cap: 80, use: .12 }, cam: { dist: 17, h: 2 },
    model: { parts: heliParts('#dc2626', '#f8fafc') } });
  // самолёт: фюзеляж, открытая кабина (видно пилота), крылья, хвост, шасси, винт на носу
  V.define({ id: 'plane', kind: 'plane', name: 'Самолёт', icon: '✈️', size: [11, 3, 10], seats: [{ pos: [0, 1.55, .6], driver: true }, { pos: [0, 1.55, -.6] }],
    speed: { max: 48, accel: 7, brake: 12 }, handling: { turn: 1 }, air: { takeoff: 24, stall: 16, climb: 12, maxY: 230 }, hp: 150, age: 12, cam: { dist: 24, h: 2 },
    model: { parts: [
      { s: 'cyl', y: 1.5, r: .9, r2: .7, h: 9, rx: PI / 2, c: '#e5e7eb', seg: 14 }, { s: 'cone', y: 1.5, z: 5.15, r: .9, h: 1.4, rx: PI / 2, c: '#dc2626', seg: 14 },
      { s: 'box', y: 2.55, z: 1.6, w: 1.1, h: .55, d: .08, c: '#bfe3f7', glass: true, rx: -.4 },
      { s: 'box', y: 1.45, z: .5, w: 11, h: .18, d: 2, c: '#cbd5e1' }, { s: 'box', y: 1.47, z: .5, w: 1.6, h: .2, d: 2.02, c: '#dc2626' },
      { s: 'box', y: 2.5, z: -4.1, w: .16, h: 1.8, d: 1.3, c: '#dc2626' }, { s: 'box', y: 1.75, z: -4.2, w: 4, h: .14, d: 1, c: '#cbd5e1' },
      { s: 'box', y: .75, z: 1.2, w: .12, h: .9, d: .12, c: '#475569' }, ...[-1, 1].map(s => ({ s: 'box', x: s * 1.4, y: .8, z: .3, w: .12, h: .9, d: .12, c: '#475569' })),
      { s: 'cyl', x: 1.4, y: .36, z: .3, r: .36, h: .25, rz: PI / 2, c: '#111827', seg: 10 }, { s: 'cyl', x: -1.4, y: .36, z: .3, r: .36, h: .25, rz: PI / 2, c: '#111827', seg: 10 }, { s: 'cyl', y: .3, z: 1.2, r: .3, h: .22, rz: PI / 2, c: '#111827', seg: 10 },
      { s: 'box', y: 1.5, z: 5.95, w: 3.2, h: .22, d: .08, c: '#111827', spin: 'prop', axis: 'z' },
      glow(5.5, 1.5, .5, .12, '#22c55e'), glow(-5.5, 1.5, .5, .12, '#ef4444'),
    ] } });
})();

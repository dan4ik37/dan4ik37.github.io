// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — транспорт на воде (вид 'boat'): катер, лодка, патрульный корабль. Плавучесть — по ph.waterLevel
//  (уровень минус осадка, качка), руль слушается и на малом ходу, лодку «несёт» боком; мель и берег — как стена
// ═══════════════════════════════════════
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const V = root.D37E?.vehicle; if (!V) return;
  const PI = Math.PI;
  const { clamp, moveTo, fwd, collide, impact, settle, engine } = V.H;
  const groundAt = (env, x, z) => (env.ph ? env.ph.groundAt(x, z) : 0);
  const waterAt = (env, x, z) => (env.water ? env.water(x, z) : -Infinity);
  // глубина под днищем хватает? (вода есть и до дна больше осадки)
  const floats = (env, d, x, z) => { const wl = waterAt(env, x, z); return wl > -Infinity && wl - groundAt(env, x, z) > d.water.draft + .15 ? wl : null; };

  V.KINDS.boat = {
    step(v, dt, I, env){
      const d = v.def, S = d.speed, Hd = d.handling, draft = d.water.draft;
      const can = engine(v, dt, I);
      const wl0 = floats(env, d, v.x, v.z);
      const thr = can && wl0 !== null ? clamp(+I.thr || 0, -1, 1) : 0, st = clamp(+I.steer || 0, -1, 1);
      v.boost = can && !!I.boost && thr > 0;
      const maxF = S.max * (v.boost ? S.boost : 1);
      if (wl0 !== null) {
        if (thr > 0) v.spd = moveTo(v.spd, maxF * thr, S.accel * dt);
        else if (thr < 0) v.spd = moveTo(v.spd, -S.reverse * -thr, S.accel * .6 * dt);
        else v.spd = moveTo(v.spd, 0, S.coast * .6 * dt);   // вода тормозит мягко
        if (I.brake) v.spd = moveTo(v.spd, 0, S.brake * .5 * dt);
      } else v.spd = moveTo(v.spd, 0, 20 * dt);   // на берегу — стоит
      // руль: работает и на малом ходу; назад — наоборот
      v.steer = moveTo(v.steer, st, dt * 3);
      const k = clamp(.25 + Math.abs(v.spd) / S.max, 0, 1), yr = -Hd.turn * v.steer * k * (v.spd >= -.3 ? 1 : -1);
      if (wl0 !== null) v.yaw += yr * dt;
      // скорость по воде догоняет нос не сразу — лодку несёт боком
      const [fx, fz] = fwd(v), gk = Math.min(1, dt * 1.8 * Hd.grip);
      v.vx += (fx * v.spd - v.vx) * gk; v.vz += (fz * v.spd - v.vz) * gk;
      const ox = v.x, oz = v.z;
      v.x += v.vx * dt; v.z += v.vz * dt;
      // мель и берег впереди — стоп (как стена)
      if (wl0 !== null && floats(env, d, v.x + fx * d.size[2] * .45, v.z + fz * d.size[2] * .45) === null) {
        const into = Math.hypot(v.vx, v.vz);
        v.x = ox; v.z = oz; v.vx *= -.2; v.vz *= -.2; v.spd *= -.2;
        if (into > 5 && v.t - v.crashAt > .5) { v.crash = into; v.crashAt = v.t; env.onCrash?.(v, into, null); }
      }
      // причалы, сваи, стенки
      const hit = collide(v, env, v.y + .05, v.y + d.size[1] + .4);
      if (hit) {
        impact(v, hit, env, v.vx, v.vz);
        const vn = v.vx * hit.nx + v.vz * hit.nz; if (vn < 0) { v.vx -= vn * hit.nx * 1.2; v.vz -= vn * hit.nz * 1.2; }
      }
      // плавает: уровень воды минус осадка, качка; на скорости нос приподнят, в повороте — крен
      const wl = floats(env, d, v.x, v.z);
      if (wl !== null) {
        v.grounded = false; v.vy = 0;
        const t = v.t + (v.home.x * .37 % 7), sp = Math.abs(v.spd) / S.max;
        v.y += (wl - draft - v.y) * Math.min(1, dt * 6);
        v.pitch += ((Math.sin(t * 1.3) * .025 - sp * .07) - v.pitch) * Math.min(1, dt * 3);
        v.roll += ((Math.sin(t * 1.7 + 1) * .035 + yr * .12) - v.roll) * Math.min(1, dt * 3);
      } else { v.grounded = v.grounded || v.y <= groundAt(env, v.x, v.z) + .05; settle(v, dt, env, .3); }
    },
  };

  // ═══ Стандартные лодки ═══
  // катер: корпус с острым носом, лобовое стекло, пульт, мотор с винтом за кормой
  V.define({ id: 'motorboat', kind: 'boat', name: 'Катер', icon: '🚤', size: [2.4, 1.5, 5.8], water: { draft: .45 },
    seats: [{ pos: [.45, .62, -.7], driver: true }, { pos: [-.45, .62, -.7] }, { pos: [.45, .62, .5] }, { pos: [-.45, .62, .5] }],
    speed: { max: 20, accel: 6, brake: 10, reverse: 5, coast: 2 }, handling: { turn: 1.2, grip: .9 }, fuel: { cap: 40, use: .07 }, hp: 90, horn: true,
    model: { parts: [
      { s: 'box', y: .4, z: -.3, w: 2.4, h: .8, d: 4.6, c: '#f8fafc' }, { s: 'cone', y: .4, z: 2.5, r: 1.2, h: 1.4, rx: PI / 2, seg: 4, yaw: PI / 4, c: '#f8fafc', flat: true },
      { s: 'box', y: .82, z: -.3, w: 2.42, h: .06, d: 4.62, c: '#0ea5e9' }, { s: 'box', y: .5, z: -.3, w: 2.2, h: .1, d: 4.2, c: '#b45309' },
      { s: 'box', y: 1.2, z: .25, w: 2, h: .55, d: .06, c: '#bfe3f7', rough: .2, glass: true }, { s: 'box', y: .95, z: -.15, w: .7, h: .45, d: .5, c: '#334155' },
      { s: 'box', y: .75, z: -2.85, w: .5, h: .8, d: .45, c: '#111827' }, { s: 'box', y: .25, z: -3.05, w: .9, h: .06, d: .25, c: '#94a3b8', spin: 'prop', axis: 'z' },
    ] } });
  // патрульный корабль боевой зоны: больше, рубка, мачта с флагом
  V.define({ id: 'patrol', kind: 'boat', name: 'Патрульный катер', icon: '🛥️', size: [3.2, 2.6, 9], water: { draft: .7 },
    seats: [{ pos: [.55, 1.2, .9], driver: true }, { pos: [-.55, 1.2, .9] }, { pos: [.6, .8, -1.6] }, { pos: [-.6, .8, -1.6] }, { pos: [.6, .8, -2.8] }, { pos: [-.6, .8, -2.8] }],
    speed: { max: 18, accel: 4.5, brake: 8, reverse: 4, coast: 1.5 }, handling: { turn: .95, grip: .8 }, hp: 220, horn: true, age: 12, cam: { dist: 15 },
    model: { parts: [
      { s: 'box', y: .55, z: -.5, w: 3.2, h: 1.1, d: 7.4, c: '#64748b' }, { s: 'cone', y: .55, z: 3.9, r: 1.6, h: 1.8, rx: PI / 2, seg: 4, yaw: PI / 4, c: '#64748b', flat: true },
      { s: 'box', y: 1.12, z: -.5, w: 3.22, h: .08, d: 7.42, c: '#e2e8f0' }, { s: 'box', y: 1.75, z: .9, w: 2.2, h: 1.2, d: 1.8, c: '#bfe3f7', glass: true }, { s: 'box', y: 2.4, z: .9, w: 2.3, h: .12, d: 1.9, c: '#94a3b8' },
      { s: 'box', y: 1.7, z: -.05, w: 2.2, h: .1, d: .1, c: '#94a3b8' }, { s: 'cyl', y: 3.4, z: .7, r: .07, h: 2.4, c: '#e5e7eb', seg: 6 },
      { s: 'box', x: -.45, y: 4.2, z: .7, w: .8, h: .5, d: .04, c: '#dc2626' }, { s: 'box', y: .4, z: -4.3, w: 1, h: .06, d: .3, c: '#94a3b8', spin: 'prop', axis: 'z' },
    ] } });
})();

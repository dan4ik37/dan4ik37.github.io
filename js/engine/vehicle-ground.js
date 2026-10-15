// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — транспорт на колёсах (вид 'car'): машина, джип, такси, карт. Аркада: газ/тормоз/назад к цели
//  (как Vehicle.cs в Backrooms), руль слабеет на скорости, ручник — занос, круги по корпусу против стен, колёса — на опору
// ═══════════════════════════════════════
// Ввод: thr (W/S), steer (A/D, вправо +), brake (Пробел — ручник), boost (Shift). В воде глубже полкорпуса — глохнет.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const V = root.D37E?.vehicle; if (!V) return;
  const PI = Math.PI;
  const { clamp, moveTo, fwd, right, collide, impact, settle, engine } = V.H;

  V.KINDS.car = {
    step(v, dt, I, env){
      const d = v.def, S = d.speed, Hd = d.handling;
      const can = engine(v, dt, I);
      const thr = can ? clamp(+I.thr || 0, -1, 1) : 0, st = clamp(+I.steer || 0, -1, 1);
      v.boost = can && !!I.boost && thr > 0;
      v.load = moveTo(v.load || 0, can ? Math.abs(thr) * (v.boost ? 1 : .8) : 0, dt * 4);
      const maxF = S.max * (v.boost ? S.boost : 1);
      if (v.grounded) {
        if (thr && Math.abs(v.spd) > .3 && Math.sign(thr) !== Math.sign(v.spd)) v.spd = moveTo(v.spd, 0, S.brake * dt);   // жмёт против хода — тормоз
        else if (thr > 0) v.spd = moveTo(v.spd, maxF * thr, S.accel * dt * (v.spd > maxF * thr ? 1.6 : 1));
        else if (thr < 0) v.spd = moveTo(v.spd, -S.reverse * -thr, S.accel * .7 * dt);
        else v.spd = moveTo(v.spd, 0, (can ? S.coast : S.coast * 1.6) * dt);   // отпустил газ — катится и тормозит сама
        if (I.brake) v.spd = moveTo(v.spd, 0, S.brake * .7 * dt);
      }
      // вода: глубже полкорпуса — мотор глохнет, машина встаёт
      const wl = env.water ? env.water(v.x, v.z) : -Infinity;
      v.wet = Math.max(0, wl - v.y);
      if (v.wet > d.size[1] * .55) { v.drown += dt; v.spd = moveTo(v.spd, 0, 10 * dt); } else v.drown = Math.max(0, v.drown - dt);
      // руль: на месте не крутит, на скорости — слабее; ручник на скорости — занос (зад уходит наружу)
      v.steer = moveTo(v.steer, st, dt * 4.5);
      const sp = Math.abs(v.spd), k = clamp(sp / 3, 0, 1) * (1 - .5 * clamp(sp / S.max, 0, 1));
      let yr = -Hd.turn * v.steer * k * (v.spd >= 0 ? 1 : -1);
      const drift = !!I.brake && sp > 6 && v.grounded;
      if (drift) yr *= 1.55;
      v.slip = moveTo(v.slip, drift ? -v.steer * sp * Hd.drift : 0, dt * (drift ? 14 : 9 * Hd.grip));
      if (!v.grounded) yr *= .25;
      v.yaw += yr * dt;
      const [fx, fz] = fwd(v), [rx, rz] = right(v), vx = fx * v.spd + rx * v.slip, vz = fz * v.spd + rz * v.slip;
      v.vx = vx; v.vz = vz;
      v.x += vx * dt; v.z += vz * dt;
      const hit = collide(v, env, v.y + d.step, v.y + d.size[1]);
      if (hit) { impact(v, hit, env, vx, vz); v.slip *= .3; }
      settle(v, dt, env, d.step);
    },
  };

  // ═══ Стандартные машины (моды добавляют свои тем же E.vehicle.define) ═══
  // колесо — цилиндр поперёк (крутится и поворачивает); колпак — неподвижный диск (круглый — не видно, что не крутится)
  const wheel = (x, z, r, steer, c = '#111827') => [{ s: 'cyl', x, y: r, z, r, h: .3, rz: PI / 2, c, seg: 12, spin: 'wheel', steer }, { s: 'cyl', x: x + Math.sign(x) * .02, y: r, z, r: r * .45, h: .32, rz: PI / 2, c: '#d1d5db', seg: 10, hub: true }];
  const glow = (x, y, z, w, h, c) => ({ s: 'box', x, y, z, w, h, d: .06, m: 'glow', c });
  // седан (и такси): корпус, кабина-стекло, крыша, бамперы, фары, колёса; сидеть: водитель слева (x > 0 — левый борт)
  function sedanParts(c, o = {}){
    const P = [
      { s: 'box', y: .72, w: 2, h: .62, d: 4.4, c },
      { s: 'box', y: 1.42, z: -.25, w: 1.78, h: .78, d: 2.3, c: '#bfe3f7', rough: .2, glass: true },
      { s: 'box', y: 1.85, z: -.3, w: 1.82, h: .1, d: 2.1, c },
      { s: 'box', y: 1.42, z: .92, w: 1.86, h: .78, d: .1, c },   // стойка у лобового (видно, где перед)
      { s: 'box', y: .52, z: 2.2, w: 2.04, h: .26, d: .2, c: '#334155', loose: 'bumper' }, { s: 'box', y: .52, z: -2.2, w: 2.04, h: .26, d: .2, c: '#334155' },
      { s: 'box', x: 1.02, y: .8, z: .35, w: .05, h: .5, d: 1.3, c, loose: 'door_l' }, { s: 'box', x: -1.02, y: .8, z: .35, w: .05, h: .5, d: 1.3, c, loose: 'door_r' },
      glow(.62, .86, 2.21, .42, .18, '#fff7cc'), glow(-.62, .86, 2.21, .42, .18, '#fff7cc'), glow(.62, .86, -2.21, .42, .16, '#ef4444'), glow(-.62, .86, -2.21, .42, .16, '#ef4444'),
      { s: 'box', x: 1.02, y: 1.25, z: .75, w: .1, h: .14, d: .26, c: '#1f2937' }, { s: 'box', x: -1.02, y: 1.25, z: .75, w: .1, h: .14, d: .26, c: '#1f2937' },
      ...wheel(.95, 1.4, .4, 1), ...wheel(-.95, 1.4, .4, 1), ...wheel(.95, -1.4, .4, 0), ...wheel(-.95, -1.4, .4, 0),
    ];
    if (o.taxi) P.push({ s: 'box', y: 2.02, z: -.3, w: .9, h: .26, d: .4, c: '#111827' }, glow(0, 2.02, -.08, .7, .16, '#fde047'), { s: 'box', y: .9, x: 1.005, w: .02, h: .16, d: 3.8, c: '#111827' }, { s: 'box', y: .9, x: -1.005, w: .02, h: .16, d: 3.8, c: '#111827' });
    if (o.police) P.push({ s: 'box', y: 1.98, z: -.3, w: 1.1, h: .14, d: .34, c: '#111827' }, glow(.32, 2.08, -.3, .4, .14, '#ef4444'), glow(-.32, 2.08, -.3, .4, .14, '#3b82f6'), { s: 'box', y: .95, x: 1.005, w: .02, h: .22, d: 3.9, c: '#1e3a8a' }, { s: 'box', y: .95, x: -1.005, w: .02, h: .22, d: 3.9, c: '#1e3a8a' });
    return P;
  }
  const SEATS4 = [{ pos: [.45, .38, .1], driver: true }, { pos: [-.45, .38, .1] }, { pos: [.45, .38, -1] }, { pos: [-.45, .38, -1] }];
  const WHEELS4 = (x, z, r) => [{ pos: [x, r, z], r, steer: 1 }, { pos: [-x, r, z], r, steer: 1 }, { pos: [x, r, -z], r }, { pos: [-x, r, -z], r }];
  V.define({ id: 'sedan', kind: 'car', name: 'Седан', icon: '🚗', size: [2, 1.9, 4.4], seats: SEATS4, wheels: WHEELS4(.95, 1.4, .4),
    speed: { max: 26, accel: 9, brake: 18, reverse: 7 }, handling: { turn: 1.9, grip: 1, drift: .35 }, fuel: { cap: 60, use: .08 }, hp: 100,
    cargo: { slots: 4, kg: 200 }, horn: true, lights: true, model: { parts: sedanParts('#2563eb') } });
  V.define({ id: 'sedan_red', kind: 'car', name: 'Седан', icon: '🚗', size: [2, 1.9, 4.4], seats: SEATS4, wheels: WHEELS4(.95, 1.4, .4),
    speed: { max: 26, accel: 9, brake: 18, reverse: 7 }, handling: { turn: 1.9, grip: 1, drift: .35 }, fuel: { cap: 60, use: .08 }, hp: 100,
    cargo: { slots: 4, kg: 200 }, horn: true, lights: true, model: { parts: sedanParts('#dc2626') } });
  V.define({ id: 'taxi', kind: 'car', name: 'Такси', icon: '🚕', size: [2, 2.1, 4.4], seats: SEATS4, wheels: WHEELS4(.95, 1.4, .4),
    speed: { max: 25, accel: 9, brake: 18, reverse: 7 }, handling: { turn: 1.95, grip: 1.05, drift: .3 }, fuel: { cap: 60, use: .08 }, hp: 100,
    horn: true, lights: true, model: { parts: sedanParts('#facc15', { taxi: true }) } });
  V.define({ id: 'police_car', kind: 'car', name: 'Полицейская машина', icon: '🚓', size: [2, 2.1, 4.4], seats: SEATS4, wheels: WHEELS4(.95, 1.4, .4),
    speed: { max: 29, accel: 10, brake: 20, reverse: 7 }, handling: { turn: 2, grip: 1.1, drift: .3 }, fuel: { cap: 70, use: .09 }, hp: 140,
    horn: true, lights: true, model: { parts: sedanParts('#f8fafc', { police: true }) } });
  // джип (открытый): видно, кто едет; запаска сзади, дуга безопасности
  V.define({ id: 'jeep', kind: 'car', name: 'Джип', icon: '🚙', size: [2.1, 2.1, 4], seats: [{ pos: [.45, .5, -.05], driver: true }, { pos: [-.45, .5, -.05] }, { pos: [.45, .5, -1.15] }, { pos: [-.45, .5, -1.15] }],
    wheels: WHEELS4(1, 1.35, .45), speed: { max: 24, accel: 9, brake: 16, reverse: 7 }, handling: { turn: 1.8, grip: 1.15, drift: .25 }, step: .85, hp: 160, horn: true, lights: true, age: 12,
    model: { parts: [
      { s: 'box', y: .9, w: 2.1, h: .7, d: 4, c: '#4d5b2a' }, { s: 'box', y: 1.33, z: 1.35, w: 1.95, h: .18, d: 1.25, c: '#3f4a22' },
      { s: 'box', y: 1.62, z: .6, w: 1.85, h: .62, d: .06, c: '#bfe3f7', rough: .2, glass: true }, { s: 'box', y: 1.95, z: .6, w: 1.95, h: .08, d: .1, c: '#1f2937' },
      { s: 'box', y: 2.05, z: -.85, w: 2, h: .1, d: .1, c: '#1f2937' }, { s: 'box', x: .95, y: 1.6, z: -.85, w: .1, h: .9, d: .1, c: '#1f2937' }, { s: 'box', x: -.95, y: 1.6, z: -.85, w: .1, h: .9, d: .1, c: '#1f2937' },
      { s: 'cyl', y: 1.1, z: -2.12, r: .42, h: .26, rx: PI / 2, c: '#111827', seg: 12, loose: 'spare' },
      glow(.65, 1.05, 2.01, .32, .22, '#fff7cc'), glow(-.65, 1.05, 2.01, .32, .22, '#fff7cc'), { s: 'box', y: .62, z: 2.06, w: 2.12, h: .24, d: .14, c: '#1f2937', loose: 'bumper' },
      ...wheel(1, 1.35, .45, 1), ...wheel(-1, 1.35, .45, 1), ...wheel(1, -1.35, .45, 0), ...wheel(-1, -1.35, .45, 0),
    ] } });
  // карт для детского городка: низкий, медленный, один седок
  V.define({ id: 'kart', kind: 'car', name: 'Карт', icon: '🏎️', size: [1.4, 1, 2.2], seats: [{ pos: [0, .2, -.2], driver: true }], wheels: WHEELS4(.66, .78, .26),
    speed: { max: 10, accel: 6, brake: 12, reverse: 4, coast: 3 }, handling: { turn: 2.4, grip: 1.3, drift: .4 }, step: .45, hp: 80, horn: true, age: 0, smash: 0, cam: { dist: 7.5, h: .9 },
    model: { parts: [
      { s: 'box', y: .3, w: 1.2, h: .2, d: 2.1, c: '#f97316' }, { s: 'box', y: .5, z: .75, w: .9, h: .28, d: .6, c: '#f97316' },
      { s: 'box', y: .62, z: -.55, w: .7, h: .55, d: .12, c: '#1f2937' }, { s: 'cyl', y: .7, z: .3, r: .2, h: .05, rx: -1, c: '#111827', seg: 12 },
      { s: 'box', y: .82, z: -1.02, w: 1.3, h: .08, d: .3, c: '#22c55e' }, { s: 'box', y: .62, z: -1, w: .08, h: .36, d: .08, c: '#1f2937' },
      ...wheel(.66, .78, .26, 1, '#1f2937'), ...wheel(-.66, .78, .26, 1, '#1f2937'), ...wheel(.66, -.78, .26, 0, '#1f2937'), ...wheel(-.66, -.78, .26, 0, '#1f2937'),
    ] } });
  // танк (боевая зона, 12+): медленный и тяжёлый — валит деревья и всё мелкое (smash 2), почти не заносит; гусеницы — коробки,
  // катки внутри крутятся; башня и ствол — вид (стрелять пока нельзя)
  V.define({ id: 'tank', kind: 'car', name: 'Танк', icon: '🛡️', size: [3.2, 2.5, 5.8], seats: [{ pos: [0, 1.55, .2], driver: true }, { pos: [0, 2.05, -.6] }],
    wheels: WHEELS4(1.25, 1.8, .5), speed: { max: 12, accel: 4, brake: 10, reverse: 5, coast: 6 }, handling: { turn: 1.15, grip: 1.6, drift: .08 }, step: 1, hp: 420,
    smash: 2, horn: false, lights: true, age: 12, cam: { dist: 13, h: 2.6 }, sound: 'veh_car',
    model: { parts: [
      { s: 'box', y: 1.05, w: 2.6, h: .9, d: 5.4, c: '#55602f' }, { s: 'box', y: 1.42, z: 2.5, w: 2.4, h: .3, d: .7, c: '#4b5527', rx: -.35 },
      { s: 'box', x: 1.45, y: .62, w: .62, h: .95, d: 5.7, c: '#2b2b2b' }, { s: 'box', x: -1.45, y: .62, w: .62, h: .95, d: 5.7, c: '#2b2b2b' },
      { s: 'box', y: 1.85, z: -.3, w: 1.9, h: .7, d: 2.4, c: '#4d5a29' }, { s: 'cyl', y: 2.3, z: -.6, r: .4, h: .2, c: '#3f4a22', seg: 12 },
      { s: 'cyl', y: 1.85, z: 2.45, r: .14, h: 3.2, rx: PI / 2, c: '#3f4a22', seg: 10 }, { s: 'box', y: 1.12, z: -2.75, w: 2.2, h: .5, d: .2, c: '#3f4a22', loose: 'bumper' },
      glow(.9, 1.3, 2.72, .28, .18, '#fff7cc'), glow(-.9, 1.3, 2.72, .28, .18, '#fff7cc'),
      ...wheel(1.25, 1.8, .5, 1, '#1f2937'), ...wheel(-1.25, 1.8, .5, 1, '#1f2937'), ...wheel(1.25, -1.8, .5, 0, '#1f2937'), ...wheel(-1.25, -1.8, .5, 0, '#1f2937'),
    ] } });
})();

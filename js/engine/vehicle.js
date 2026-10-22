// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — транспорт (D37E.vehicle): реестр машин-данных, места, управление, физика «аркада», вид, сеть
//  (docs/ENGINE_ECONOMY.md, раздел A; узоры — Backrooms Vehicles/Vehicle.cs: газ/тормоз/руль, «стоит — статична», удар о стену)
// ═══════════════════════════════════════
// Машина — ДАННЫЕ (моды и игроки добавляют свои без кода): E.vehicle.define({ id, kind, name, icon, size: [ширина, высота,
//   длина], seats: [{ pos: [x, y, z], driver }], wheels: [{ pos, r, steer }], speed: { max, accel, brake, reverse, boost, coast },
//   handling: { turn, grip, drift }, air: { climb, takeoff, stall, maxY }, water: { draft }, fuel: { cap, use } | null, hp,
//   cargo: { slots, kg } | null, sound, horn, lights, age, area, cam: { dist, h }, model: { parts: [детали R.part, spin: 'wheel' |
//   'rotor' | 'tail' | 'prop'] } }. Локально: x — влево, y — вверх, z — вперёд (yaw 0 — нос на +z, как у человечков).
// Виды физики — отдельные файлы: vehicle-ground.js (car), vehicle-water.js (boat), vehicle-air.js (heli, plane); kind → KINDS[kind].
// Режим 'arcade' (по умолчанию): своё кинематическое тело поверх physics.js — дёшево, одинаково у всех, удобно для сети и
//   телефонов. Шов для 'rapier' (песочницы «Студии 3D», rigid.js): def.physics = 'rapier' → KINDS[kind].rapier (пока нет — аркада).
// Состояние: v = E.vehicle.create(def, { id, x, y, z, yaw }) — простой объект (без Three.js; проверяется в node).
//   E.vehicle.step(v, dt, ввод, env) — шаг физики; env: { ph, water(x, z) → уровень | −∞, onCrash(v, сила, удар), bounds,
//   maxY }. Ввод: { thr −1…1 (газ/назад), steer −1…1 (вправо +), up −1…1 (вверх/вниз), boost, brake (ручник) }; из
//   управления — E.vehicle.input(C, v). ИИ-водитель: E.vehicle.follow(v, путь [[x, z, y?]…], { speed, loop, done }) → ввод сам.
// Сеть: ведёт водитель; снимок E.vehicle.pack(v) → массив, unpack; проверка у остальных E.vehicle.snapOk(def, a, b, dt) —
//   потолок скорости и «телепорты» (null — можно). Вид: E.vehicle.view(R, def, { merge }) → { g, update(v, dt), dispose() }.
// Крючки экономики: топливо (def.fuel → v.fuel, кончилось — мотор глохнет; заправить — E.vehicle.refuel(v, сколько)), груз
//   (v.cargo: load/unload по def.cargo), урон и ремонт (v.hp, v.broken; E.vehicle.repair(v)). Гараж: системе игры — spawn/despawn.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const PI = Math.PI, TAU = PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const moveTo = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

  // ═══ Реестр ═══
  const DEFS = new Map(), KINDS = {};
  const KIND_INFO = { car: ['🚗', 'Машина'], boat: ['🚤', 'Лодка'], heli: ['🚁', 'Вертолёт'], plane: ['✈️', 'Самолёт'] };
  // описание → проверенное и с полями по умолчанию (чего нет — по виду); ошибка — понятным текстом
  function define(def){
    if (!def || typeof def !== 'object') throw new Error('транспорт: нужно описание');
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(def.id || '')) throw new Error('транспорт: id — латиница, цифры, _ (2–32)');
    const kind = def.kind;
    if (!KIND_INFO[kind]) throw new Error(`транспорт ${def.id}: вид «${kind}» — car, boat, heli или plane`);
    const air = kind === 'heli' || kind === 'plane';
    const size = (Array.isArray(def.size) && def.size.length === 3 && def.size.every(n => n > 0) ? def.size : kind === 'plane' ? [10, 2.6, 9] : kind === 'heli' ? [3, 3, 8] : kind === 'boat' ? [2.4, 1.2, 5.6] : [2, 1.5, 4.4]).map(Number);
    const seats = (Array.isArray(def.seats) && def.seats.length ? def.seats : [{ pos: [.45, .55, 0], driver: true }]).slice(0, 12).map((s, i) => ({ pos: (s.pos || [0, .5, 0]).map(Number), driver: i === 0 || !!s.driver, name: s.name || '' }));
    seats[0].driver = true; for (let i = 1; i < seats.length; i++) seats[i].driver = false;
    const S = def.speed || {}, H = def.handling || {}, A = def.air || {};
    const d = {
      ...def, kind, size, seats, air,
      name: String(def.name || KIND_INFO[kind][1]).slice(0, 40), icon: def.icon || KIND_INFO[kind][0],
      speed: { max: +S.max || (kind === 'plane' ? 46 : kind === 'heli' ? 26 : kind === 'boat' ? 20 : 24), accel: +S.accel || (kind === 'plane' ? 7 : 8), brake: +S.brake || 16, reverse: +S.reverse || 6, boost: +S.boost || 1.25, coast: +S.coast || 3 },
      handling: { turn: +H.turn || (kind === 'boat' ? 1.1 : kind === 'heli' ? 1.4 : kind === 'plane' ? 1 : 1.9), grip: +H.grip || 1, drift: +H.drift || .3 },
      air: air ? { climb: +A.climb || (kind === 'heli' ? 9 : 12), takeoff: +A.takeoff || 22, stall: +A.stall || 16, maxY: +A.maxY || 230 } : null,
      water: kind === 'boat' ? { draft: +(def.water?.draft) || .45 } : null,
      wheels: Array.isArray(def.wheels) ? def.wheels.map(w => ({ pos: w.pos.map(Number), r: +w.r || .4, steer: +w.steer || 0 })) : [],
      step: +def.step || (kind === 'car' ? .7 : .35),
      hp: +def.hp || 100, fuel: def.fuel && def.fuel.cap > 0 ? { cap: +def.fuel.cap, use: +def.fuel.use || .1, kind: def.fuel.kind || 'petrol' } : null,
      cargo: def.cargo && def.cargo.slots > 0 ? { slots: def.cargo.slots | 0, kg: +def.cargo.kg || 100 } : null,
      sound: def.sound || ({ car: 'veh_car', boat: 'veh_boat', heli: 'veh_rotor', plane: 'veh_prop' }[kind]),
      age: +def.age || 0, area: def.area || null, physics: def.physics === 'rapier' ? 'rapier' : 'arcade',
      smash: def.smash ?? (kind === 'car' ? 1 : 0),   // что ломает с разгона: 0 — ничего, 1 — мелочь (столбы, скамейки), 2 — и деревья (танк, грузовик)
      cam: { dist: +(def.cam?.dist) || (kind === 'plane' ? 22 : kind === 'heli' ? 17 : kind === 'boat' ? 12 : 10), h: +(def.cam?.h) || size[1] * .8 },
      model: def.model && Array.isArray(def.model.parts) ? def.model : { parts: [{ s: 'box', y: size[1] / 2, w: size[0], h: size[1], d: size[2], c: '#94a3b8' }] },
    };
    DEFS.set(d.id, d);
    return d;
  }
  const get = id => DEFS.get(id) || null;

  // ═══ Состояние ═══
  let seq = 0;
  function create(def, o = {}){
    const d = typeof def === 'string' ? get(def) : def;
    if (!d) throw new Error('транспорт: нет описания ' + def);
    return {
      id: o.id || d.id + '#' + (++seq), def: d, kind: d.kind, x: +o.x || 0, y: +o.y || 0, z: +o.z || 0, yaw: +o.yaw || 0,
      pitch: 0, roll: 0, spd: 0, slip: 0, vy: 0, vx: 0, vz: 0, steer: 0, thr: 0, eng: false, grounded: true, wet: 0, drown: 0,
      hp: d.hp, fuel: d.fuel ? d.fuel.cap : Infinity, broken: false, t: 0, rotor: 0, crash: 0, crashAt: -9, cargo: [], ai: null,
      lights: false, horn: 0, boost: false, home: { x: +o.x || 0, y: +o.y || 0, z: +o.z || 0, yaw: +o.yaw || 0 },
    };
  }
  const fwd = v => [Math.sin(v.yaw), Math.cos(v.yaw)];
  const right = v => [-Math.cos(v.yaw), Math.sin(v.yaw)];   // правый борт (руль вправо — yaw уменьшается)
  // место в мире: локальная точка (x влево, y вверх, z вперёд) → мир (наклоны — только для высоты, без вращения позы)
  function local(v, p, out = {}){
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    out.x = v.x + p[0] * c + p[2] * s; out.z = v.z - p[0] * s + p[2] * c;
    out.y = v.y + p[1] * Math.cos(v.pitch) * Math.cos(v.roll) - p[2] * Math.sin(v.pitch) + p[0] * Math.sin(v.roll);   // нос вниз (pitch > 0) — точка спереди ниже
    out.yaw = v.yaw;
    return out;
  }

  // ═══ Общая физика (для всех видов): столкновения кругами по длине, опора под колёсами, удар ═══
  const LST = [];
  // круги по корпусу против тел мира (кроме своего и мелочи под днищем); выталкивает и возвращает самый глубокий удар
  function collide(v, env, y0, y1){
    const ph = env.ph, P = E.Phys; if (!ph || !P) return null;
    const d = v.def, w = Math.min(d.size[0], d.kind === 'plane' ? 2.4 : d.size[0]), L = d.size[2], r = w / 2, n = Math.max(1, Math.round(L / w));
    const [fx, fz] = fwd(v);
    let worst = null;
    for (let it = 0; it < 2; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : -L / 2 + r + i * (L - 2 * r) / (n - 1), cx = v.x + fx * off, cz = v.z + fz * off;
        const list = ph.query(cx - r, cz - r, cx + r, cz + r, LST);
        for (let k = 0; k < list.length; k++) {
          const c = list[k];
          if (c.trigger || !c.solid || c.data?.veh === v.id || c.data?.noVeh) continue;
          const top = c.type === 'wedge' ? P.topAt(c, cx, cz) : c.top;
          if (top <= y0 + 1e-4 || c.bottom >= y1) continue;   // ниже порога (бордюр, скат клина) — заезжаем; выше крыши — мимо
          const hit = P.circleHit(c, cx, cz, r); if (!hit) continue;
          v.x += hit.nx * hit.d; v.z += hit.nz * hit.d; moved = true;
          if (!worst || hit.d > worst.d) worst = { d: hit.d, nx: hit.nx, nz: hit.nz, col: c };
        }
        LST.length = 0;
      }
      if (!moved) break;
    }
    return worst;
  }
  // удар: скорость в стену гасится (отскок), сильный — урон и событие (камера трясётся, звук, искры — у игры)
  function impact(v, hit, env, vx, vz){
    const into = -(vx * hit.nx + vz * hit.nz);
    if (into <= 0) return 0;
    // скорость вдоль носа: в стену — почти вся гаснет, вдоль — остаётся (скользит по стене)
    const [fx, fz] = fwd(v), along = fx * -hit.nz + fz * hit.nx, k = Math.abs(along);
    v.spd *= into > 3 ? (.15 + .6 * k) : .6 + .4 * k;
    if (into > 4 && v.t - v.crashAt > .4) {
      v.crash = into; v.crashAt = v.t;
      if (into > 10) damage(v, (into - 10) * 3.2);
      env.onCrash?.(v, into, hit);
    }
    return into;
  }
  function damage(v, n){
    if (v.broken || !(n > 0)) return;
    v.hp = Math.max(0, v.hp - n);
    if (v.hp <= 0) { v.broken = true; v.eng = false; }
  }
  function repair(v, n = Infinity){ v.hp = Math.min(v.def.hp, v.hp + n); if (v.hp > v.def.hp * .25) v.broken = false; return v.hp; }
  function refuel(v, n = Infinity){ if (!v.def.fuel) return Infinity; v.fuel = Math.min(v.def.fuel.cap, v.fuel + n); return v.fuel; }
  // груз (крючок экономики): вещь { id, kg } в кузов, если влезает
  function load(v, item){
    const C = v.def.cargo; if (!C || !item) return false;
    const kg = v.cargo.reduce((s, x) => s + (+x.kg || 0), 0);
    if (v.cargo.length >= C.slots || kg + (+item.kg || 0) > C.kg) return false;
    v.cargo.push(item); return true;
  }
  const unload = (v, id) => { const i = v.cargo.findIndex(x => x.id === id); return i >= 0 ? v.cargo.splice(i, 1)[0] : null; };
  // высота опоры под точкой (не выше yMax): земля, рельеф, крыши тел (кроме своего тела)
  function supportAt(env, v, x, z, r, yMax){
    const ph = env.ph; if (!ph) return 0;
    const own = v.body || null;
    return ph.supportAt(x, z, r, yMax, own).y;
  }
  // посадка на опору: 4 точки (колёса или углы днища) → высота, тангаж, крен; в воздухе — тяжесть
  function settle(v, dt, env, step, g = 26){
    const d = v.def, hw = d.size[0] * .42, hl = d.size[2] * .4, [fx, fz] = fwd(v), [rx, rz] = right(v), yMax = v.y + step;
    const s = (a, b) => supportAt(env, v, v.x + fx * a + rx * b, v.z + fz * a + rz * b, .25, yMax);
    const fl = s(hl, -hw), fr = s(hl, hw), bl = s(-hl, -hw), br = s(-hl, hw);
    const gy = Math.max((fl + fr + bl + br) / 4, Math.min(Math.max(fl, fr), Math.max(bl, br)));   // не проваливается в яму между колёсами
    if (v.grounded && gy >= v.y - step - 1e-4) {   // едет по земле: вверх по ступеньке — плавно, вниз — следом
      v.y = gy > v.y ? Math.min(gy, v.y + Math.max(.02, step * 12 * dt)) : gy; v.vy = 0;
    } else {
      v.grounded = false;
      v.vy -= g * dt; let ny = v.y + v.vy * dt;
      const sy = Math.max(fl, fr, bl, br);
      if (ny <= sy) { const hitV = -v.vy; ny = sy; v.vy = 0; v.grounded = true; if (hitV > 14) { damage(v, (hitV - 14) * 4); env.onCrash?.(v, hitV, null); } }
      v.y = ny;
    }
    const tp = Math.atan2(((fl + fr) - (bl + br)) / 2, hl * 2), tr = Math.atan2(((fl + bl) - (fr + br)) / 2, hw * 2);
    v.pitch += (clamp(-tp, -.6, .6) - v.pitch) * Math.min(1, dt * 10);
    v.roll += (clamp(tr, -.6, .6) - v.roll) * Math.min(1, dt * 10);
    return gy;
  }
  // граница мира (env.bounds [x0, z0, x1, z1]) и потолок
  function bound(v, env){
    const B = env.bounds;
    if (B) { const x = clamp(v.x, B[0], B[2]), z = clamp(v.z, B[1], B[3]); if (x !== v.x || z !== v.z) { v.x = x; v.z = z; v.spd *= .3; } }
    const top = env.maxY ?? v.def.air?.maxY ?? 400; if (v.y > top) { v.y = top; v.vy = Math.min(0, v.vy); }
  }
  // мотор: включён, пока есть водитель (или ИИ) и он цел; топливо — по газу
  function engine(v, dt, I){
    const on = !!(I && I.on !== false) && !v.broken && !v.drown && v.fuel > 0;
    v.eng = on;
    if (on && v.def.fuel) v.fuel = Math.max(0, v.fuel - v.def.fuel.use * dt * (.15 + Math.abs(I.thr || 0) + (I.boost ? .5 : 0)));
    return on;
  }

  // ═══ Шаг ═══
  const NOIN = { thr: 0, steer: 0, up: 0, boost: 0, brake: 0, on: false };
  const AIIN = { thr: 0, steer: 0, up: 0, boost: 0, brake: 0, on: true };
  function step(v, dt, I, env = {}){
    const K = KINDS[v.kind]; if (!K) return v;
    if (v.ai) I = aiInput(v, AIIN);
    I = I || NOIN;
    v.t += dt;
    if (v.horn > 0) v.horn = Math.max(0, v.horn - dt);
    K.step(v, dt, I, env, H);
    bound(v, env);
    if (env.ph && v.body) env.ph.update(v.body, bodyOf(v));
    return v;
  }
  // тело машины в физике мира (другие игроки и машины упираются; стоящий самолёт — можно залезть на крыло)
  const bodyOf = v => { const d = v.def, h = d.kind === 'plane' ? Math.min(d.size[1], 1.6) : d.size[1], w = d.kind === 'plane' ? Math.min(2.4, d.size[0]) : d.size[0]; return { x: v.x, y: v.y + h / 2 + (d.kind === 'boat' ? .1 : .05), z: v.z, hx: w / 2, hy: h / 2, hz: d.size[2] / 2, yaw: v.yaw }; };
  function addBody(v, ph){ if (!ph || v.body) return v.body; v.body = ph.addBox({ ...bodyOf(v), tag: 'veh', data: { veh: v.id, cam: false, floor: 'metal' } }); return v.body; }
  function removeBody(v, ph){ if (v.body && ph) ph.remove(v.body); v.body = null; }

  // ═══ Ввод из управления (controls.js): машина/лодка — W/S газ и назад, A/D руль, Пробел — ручник, Shift — ускорение;
  //     вертолёт — W/S вперёд/назад, A/D поворот, Пробел/C — вверх/вниз; самолёт — W/S тяга, A/D крен, Пробел/C — нос вверх/вниз ═══
  function input(C, v, out = {}){
    const m = C ? C.move : { x: 0, z: 0 }, air = v.kind === 'heli' || v.kind === 'plane';
    out.thr = m.z; out.steer = m.x; out.boost = C?.held('run') ? 1 : 0; out.on = true;
    out.up = air ? (C?.held('jump') ? 1 : 0) - (C?.held('crouch') ? 1 : 0) : 0;
    out.brake = !air && C?.held('jump') ? 1 : 0;
    return out;
  }

  // ═══ ИИ-водитель: путь [[x, z, y?]…] — руль к следующей точке, тише на поворотах (как DriveVehicleAction в Backrooms) ═══
  function follow(v, path, o = {}){
    if (!Array.isArray(path) || !path.length) { v.ai = null; return null; }
    v.ai = { path: path.map(p => [+p[0], +p[1], p[2] == null ? null : +p[2]]), i: 0, speed: +o.speed || v.def.speed.max * .5, loop: !!o.loop, r: +o.r || Math.max(3, v.def.size[2] * .8), done: o.done || null };
    return v.ai;
  }
  function aiInput(v, out){
    const A = v.ai; out.thr = 0; out.steer = 0; out.up = 0; out.boost = 0; out.brake = 0; out.on = true;
    let p = A.path[A.i];
    if (!p) { v.ai = null; return out; }
    if (Math.hypot(p[0] - v.x, p[1] - v.z) < A.r) {
      A.i++;
      if (A.i >= A.path.length) { if (A.loop) A.i = 0; else { const f = A.done; v.ai = null; out.brake = 1; f?.(v); return out; } }
      p = A.path[A.i];
    }
    const want = Math.atan2(p[0] - v.x, p[1] - v.z), diff = angDiff(v.yaw, want);
    out.steer = clamp(-diff * 2.2, -1, 1);
    const k = clamp(A.speed / v.def.speed.max, 0, 1) * (1 - Math.min(.65, Math.abs(diff) * .8));
    out.thr = v.kind === 'plane' ? Math.max(.6, k) : k;
    if (v.kind === 'heli' || v.kind === 'plane') { const ty = p[2] ?? (v.y + 0); out.up = clamp((ty - v.y) * .3, -1, 1); }
    return out;
  }

  // ═══ Сеть: снимок и проверка ═══
  const FL = { eng: 1, lights: 2, horn: 4, boost: 8, broken: 16, parked: 32, ground: 64, capsized: 128 };   // capsized — лодку перевернуло волной (vehicle-water.js)
  function pack(v, parked = false){
    const f = (v.eng ? FL.eng : 0) | (v.lights ? FL.lights : 0) | (v.horn > 0 ? FL.horn : 0) | (v.boost ? FL.boost : 0) | (v.broken ? FL.broken : 0) | (parked ? FL.parked : 0) | (v.grounded ? FL.ground : 0) | (v.capsized ? FL.capsized : 0);
    return [r2(v.x), r2(v.y), r2(v.z), r3(v.yaw), r3(v.pitch), r3(v.roll), r2(v.spd), r2(v.vy), f, r2(v.steer), r2(v.rotor), Math.round(v.hp)];
  }
  function unpack(a){
    if (!Array.isArray(a) || a.length < 9 || !a.slice(0, 9).every(Number.isFinite)) return null;
    const f = a[8] | 0;
    return { x: a[0], y: a[1], z: a[2], yaw: a[3], pitch: clamp(a[4], -1.4, 1.4), roll: clamp(a[5], -1.4, 1.4), spd: a[6], vy: a[7], fl: f, steer: clamp(+a[9] || 0, -1, 1), rotor: clamp(+a[10] || 0, 0, 1),
      eng: !!(f & FL.eng), lights: !!(f & FL.lights), horn: !!(f & FL.horn), boost: !!(f & FL.boost), broken: !!(f & FL.broken), parked: !!(f & FL.parked), grounded: !!(f & FL.ground), capsized: !!(f & FL.capsized),
      hp: Number.isFinite(a[11]) ? Math.max(0, a[11]) : null };
  }
  // b после a через dt секунд — так может эта машина? null — да, иначе причина ('speed' — быстрее потолка, 'climb' — взлёт без крыльев)
  function snapOk(def, a, b, dt){
    if (!a || !b) return null;
    dt = Math.max(.05, Math.min(5, dt));
    const S = def.speed, maxH = S.max * S.boost * 1.3 + 4, horiz = Math.hypot(b.x - a.x, b.z - a.z);
    if (horiz > maxH * dt + 3.5) return 'speed';
    if (Math.abs(b.spd) > maxH + 2) return 'speed';
    const up = b.y - a.y;
    const climb = def.kind === 'heli' ? def.air.climb * 1.5 + 3 : def.kind === 'plane' ? S.max * 1.1 : def.kind === 'boat' ? 3 : 12;
    if (up > climb * dt + 3) return 'climb';
    return null;
  }

  // ═══ Вид (Three.js): корпус — на «подвеске» (крен в повороте, клевок при торможении, приседание при разгоне, толчки на кочках
  //     и от ударов, качка лодки), колёса — на земле; детали с loose (двери, бампер) и колёса могут отвалиться (повреждения).
  //     Всё это — только картинка: у каждого игрока из того же состояния машины, по сети не идёт ═══
  const BURNT = new WeakMap();
  function view(R, def, o = {}){
    const T = R.T, d = typeof def === 'string' ? get(def) : def, g = new T.Group(); g.name = 'veh ' + d.id;
    const cy = d.size[1] * .45, chassis = new T.Group(), body = new T.Group();   // точка качания — середина корпуса
    chassis.position.y = cy; body.position.y = -cy; chassis.add(body); g.add(chassis);
    const wheelsG = new T.Group(); g.add(wheelsG);
    const spin = [], loose = {};
    let lastWheel = null, wi = 0;
    for (const p of d.model.parts) {
      if (p.spin && !o.still) {   // still — стоит без мотора: колёса и винты склеены с корпусом (2–3 вызова отрисовки вместо 7–10)
        // колесо: руль (y) → вращение (x); винт: вокруг своей оси
        const steerG = new T.Group(); steerG.position.set(p.x || 0, p.y || 0, p.z || 0); steerG.userData.dyn = true;
        (p.spin === 'wheel' ? wheelsG : body).add(steerG);
        const rollG = new T.Group(); rollG.userData.dyn = true; steerG.add(rollG);
        R.part(rollG, { ...p, x: 0, y: 0, z: 0, spin: undefined, dyn: true, m: p.glass && o.glass ? o.glass : p.m });
        const sp = { kind: p.spin, steer: +p.steer || 0, r: +p.r || .4, s: steerG, rg: rollG, axis: p.axis || (p.spin === 'wheel' ? 'x' : p.spin === 'rotor' ? 'y' : p.spin === 'tail' ? 'x' : 'z') };
        spin.push(sp);
        if (p.spin === 'wheel') { sp.idx = wi; loose['wheel' + wi++] = steerG; lastWheel = p; }
      } else if (p.hub && lastWheel && !o.still) {   // колпак — с колесом (поворачивает и отваливается вместе с ним)
        const m = R.part(loose['wheel' + (wi - 1)], { ...p, x: (p.x || 0) - (lastWheel.x || 0), y: (p.y || 0) - (lastWheel.y || 0), z: (p.z || 0) - (lastWheel.z || 0), dyn: true });
        if (m) m.userData.dyn = true;
      } else if (p.loose && !o.still) {   // дверь, бампер: отдельно от склейки — может отвалиться
        const m = R.part(body, { ...p, dyn: true }); if (m) { m.userData.dyn = true; loose[p.loose] = m; }
      } else R.part(body, p.glass && o.glass ? { ...p, m: o.glass } : p);   // стекло — общий прозрачный материал игры (видно, кто сидит)
    }
    if (o.merge) { try { o.merge(R, body); } catch (e) { console.error(e); } }
    if (R.shadowsOn) R.shadowsOn(g, false, true);   // тень не отбрасывает: карта теней обновляется не каждый кадр — у едущей машины тень отставала бы
    let spinA = 0;
    const sus = { y: 0, vy: 0, p: 0, vp: 0, r: 0, vr: 0, spd: null, yaw: 0, py: 0, crashAt: -9, t: (d.id.length * 1.7) % 9 };
    const W = {
      g, spin, def: d, still: !!o.still, chassis, body, loose, gone: new Set(), sus,
      update(v, dt){
        g.position.set(v.x, v.y, v.z); g.rotation.set(v.pitch, v.yaw, v.roll, 'YXZ');
        spinA += dt;
        if (dt > 0 && dt < .25) suspension(v, dt);
        for (const s of spin) {
          if (s.kind === 'wheel') { s.rg.rotation.x += (v.spd / s.r) * dt; if (s.steer) s.s.rotation.y = -v.steer * .45 * s.steer; }
          else { const w = (s.kind === 'rotor' ? 26 : s.kind === 'tail' ? 40 : 34) * v.rotor * dt; s.rg.rotation[s.axis] += w; }
        }
      },
      // отвалить деталь (дверь, бампер, колесо N): спрятать; вернёт место в мире — там появится обломок
      drop(name){
        const m = loose[name]; if (!m || W.gone.has(name)) return null;
        W.gone.add(name); m.updateMatrixWorld(true);
        const p = new T.Vector3(); m.getWorldPosition(p); m.visible = false;
        return { x: p.x, y: p.y, z: p.z };
      },
      // сгоревший остов: корпус — тёмный (свой материал на время; стекло как было)
      burnt(on){
        let bm = BURNT.get(R); if (!bm) { bm = R.mat('#1c1917', { rough: 1 }); BURNT.set(R, bm); }
        body.traverse(m => { if (!m.isMesh || m.material?.transparent) return; if (on) { if (!m.userData.mat0) m.userData.mat0 = m.material; m.material = bm; } else if (m.userData.mat0) { m.material = m.userData.mat0; delete m.userData.mat0; } });
        W.isBurnt = !!on;
      },
      reset(){ for (const n of W.gone) if (loose[n]) loose[n].visible = true; W.gone.clear(); if (W.isBurnt) W.burnt(false); },
      dispose(){ g.parent?.remove(g); g.traverse(m => { if (m.isMesh && (m.userData.mzOwn || m.userData.own)) m.geometry?.dispose(); }); },
    };
    // подвеска: цель наклона — от ускорения, поворота, заноса, качки; пружина с затуханием; кочка и удар — толчок
    function suspension(v, dt){
      const kind = d.kind, S = d.speed || {}, mx = S.max || 20;
      if (sus.spd === null) { sus.spd = v.spd; sus.yaw = v.yaw; sus.py = v.y; }
      const acc = (v.spd - sus.spd) / dt, yr = angDiff(sus.yaw, v.yaw) / dt, dy = v.y - sus.py;
      sus.spd = v.spd; sus.yaw = v.yaw; sus.py = v.y; sus.t += dt;
      let tp = 0, tr = 0;
      if (kind === 'car') {
        tp = clamp(-acc * .0055, -.075, .075);                                 // разгон — нос вверх, тормоз — клевок
        tr = clamp(yr * v.spd * .003 + (v.slip || 0) * .004, -.09, .09);       // поворот и занос — крен наружу
        if (v.grounded && Math.abs(dy) > .03 && Math.abs(dy) < 1.5) sus.vy -= dy / dt * .3;   // кочка
        if (W.gone.size) for (const n of W.gone) if (n.startsWith('wheel')) { const i = +n.slice(5); tp += (i < 2 ? .06 : -.06); tr += (i % 2 ? -.07 : .07); }   // без колеса — на один угол
      } else if (kind === 'boat') {
        const s = clamp(Math.abs(v.spd) / mx, 0, 1), wv = v.wy !== undefined ? 0 : 1;   // на волнах (waves.js) качка — в самой лодке
        tp = (-.08 * s + Math.sin(sus.t * (1.6 + s * 2.5)) * (.012 + .03 * s)) * wv;   // нос над водой на ходу, качка на волне
        tr = clamp(yr * v.spd * .006, -.14, .14) + Math.sin(sus.t * 1.3 + 1) * .02 * wv;
      } else if (kind === 'heli') { tp = clamp(acc * .008, -.07, .07); tr = clamp(-yr * .05, -.06, .06); }
      if (v.crashAt !== sus.crashAt) {   // удар: толчок корпусу (сильнее — больше)
        sus.crashAt = v.crashAt; const k = clamp((v.crash || 0) * .02, .03, .28);
        sus.vp += k * 7 * (v.spd >= 0 ? 1 : -1); sus.vy += k * 5; sus.vr += (Math.sin(v.t * 13.7) > 0 ? 1 : -1) * k * 5;
      }
      const K = 150, C = 14;
      sus.vy += (-K * sus.y - C * sus.vy) * dt; sus.y = clamp(sus.y + sus.vy * dt, -.25, .25);
      sus.vp += (K * (tp - sus.p) - C * sus.vp) * dt; sus.p = clamp(sus.p + sus.vp * dt, -.3, .3);
      sus.vr += (K * (tr - sus.r) - C * sus.vr) * dt; sus.r = clamp(sus.r + sus.vr * dt, -.3, .3);
      chassis.position.y = cy + sus.y; chassis.rotation.set(sus.p, 0, sus.r);
    }
    return W;
  }

  const H = { clamp, moveTo, angDiff, fwd, right, collide, impact, damage, settle, supportAt, bound, engine, local };
  E.vehicle = { DEFS, KINDS, KIND_INFO, FL, define, get, list: () => [...DEFS.values()], create, step, input, follow, aiInput, pack, unpack, snapOk, view,
    addBody, removeBody, bodyOf, local, fwd, right, damage, repair, refuel, load, unload, H };
})();

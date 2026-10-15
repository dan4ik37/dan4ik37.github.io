// Тесты транспорта движка (js/engine/vehicle.js + vehicle-ground/water/air.js) в node: описания машин, физика «аркада»
// (машина: разгон, руль, тормоз, занос, стены, пандус, бордюр, обрыв, вода; лодка: плавает, мель, причал; вертолёт:
// раскрутка, взлёт, зависание, посадка на крышу, падение; самолёт: разбег, взлёт, вираж, срыв, посадка и авария),
// детерминизм, сеть (снимок и проверка скорости/телепортов), ИИ-водитель, тело в физике, топливо, груз, ремонт.
// Запуск из корня сайта: node scripts/vehicle-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/vehicle-air.js']) load(f);
const E = globalThis.D37E, V = E.vehicle;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const DT = 1 / 60;
const run = (v, sec, inp, env) => { for (let t = 0; t < sec; t += DT) V.step(v, DT, typeof inp === 'function' ? inp(t, v) : inp, env); return v; };
const IN = o => ({ thr: 0, steer: 0, up: 0, boost: 0, brake: 0, on: true, ...o });
const world = (o = {}) => { const ph = new E.Phys({ ground: 0 }); if (o.terrain) ph.terrain = { sample: o.terrain }; const env = { ph, water: o.water || (() => -Infinity), crashes: [], onCrash: (v, k) => env.crashes.push(k) }; return env; };

module.exports = { V };

// ═══ 1. Описания ═══
{
  const L = V.list(), SHAPES = new Set(['box', 'cyl', 'cone', 'ball', 'ico', 'torus', 'ring', 'disc', 'plane']);
  for (const id of ['sedan', 'taxi', 'police_car', 'jeep', 'kart', 'motorboat', 'patrol', 'heli', 'heli_city', 'plane']) ok(V.get(id), 'есть машина ' + id);
  for (const d of L) {
    ok(['car', 'boat', 'heli', 'plane'].includes(d.kind) && V.KINDS[d.kind], `${d.id}: вид с физикой`);
    ok(d.seats.length >= 1 && d.seats[0].driver && d.seats.slice(1).every(s => !s.driver), `${d.id}: место водителя — первое`);
    ok(d.seats.every(s => s.pos.length === 3 && s.pos.every(Number.isFinite) && Math.abs(s.pos[0]) <= d.size[0] / 2 && Math.abs(s.pos[2]) <= d.size[2] / 2), `${d.id}: места внутри корпуса`);
    ok(d.model.parts.length >= 3 && d.model.parts.every(p => SHAPES.has(p.s || 'box') && ['x', 'y', 'z', 'w', 'h', 'd', 'r'].every(k => p[k] === undefined || Number.isFinite(p[k]))), `${d.id}: детали модели — понятные фигуры`);
    ok(d.speed.max > 0 && d.speed.accel > 0 && d.hp > 0 && d.size.every(n => n > 0), `${d.id}: скорость, прочность, размер`);
    ok(d.kind !== 'car' || d.model.parts.filter(p => p.spin === 'wheel').length >= 4, `${d.id}: машина — 4 колеса крутятся`);
    ok((d.kind === 'heli' || d.kind === 'plane') === !!d.air, `${d.id}: «воздух» — только у летающих`);
    ok((d.kind === 'boat') === !!d.water, `${d.id}: осадка — только у лодок`);
    ok([0, 12, 16, 18].includes(d.age), `${d.id}: возраст ${d.age}+`);
  }
  let err = null; try { V.define({ id: 'Плохо', kind: 'car' }); } catch (e) { err = e.message; }
  ok(err && /латиница/.test(err), 'плохой id — понятная ошибка', err);
  err = null; try { V.define({ id: 'ufo', kind: 'saucer' }); } catch (e) { err = e.message; }
  ok(err && /car, boat, heli или plane/.test(err), 'неизвестный вид — понятная ошибка', err);
  const mod = V.define({ id: 'mod_bus', kind: 'car', name: 'Автобус из мода', size: [2.6, 3.2, 10], seats: [{ pos: [.8, .8, 4], driver: true }, { pos: [0, .8, 0] }] });
  ok(mod.speed.max > 0 && mod.model.parts.length === 1 && V.get('mod_bus') === mod, 'мод: своя машина без модели — коробка по размеру');
}

// ═══ 2. Машина ═══
{
  const env = world();
  let v = run(V.create('sedan', {}), 6, IN({ thr: 1 }), env);
  ok(v.spd > V.get('sedan').speed.max * .95 && v.z > 80 && Math.abs(v.x) < .01, 'газ: разгон до потолка прямо вперёд (+z)', [v.spd, v.z]);
  const z0 = v.z; run(v, 4, IN({ thr: -1 }), env);
  ok(v.spd < 0 && v.z > z0, 'тормоз против хода, потом назад', v.spd);
  v = run(V.create('sedan', {}), 2.5, IN({ thr: 1, steer: 1 }), env);
  ok(v.yaw < -.3 && v.x < -2, 'руль вправо (D) — поворот направо (yaw меньше, к −x)', [v.yaw, v.x]);
  v = run(V.create('sedan', {}), 2, IN({ thr: 0, steer: 1 }), env);
  ok(Math.abs(v.yaw) < 1e-9, 'на месте руль не крутит машину');
  const boost = run(V.create('sedan', {}), 8, IN({ thr: 1, boost: 1 }), env).spd;
  ok(boost > V.get('sedan').speed.max * 1.2, 'Shift — быстрее потолка (ускорение)', boost);
  v = run(V.create('sedan', {}), 4, IN({ thr: 1 }), env); run(v, .5, IN({ thr: 1, steer: 1, brake: 1 }), env);
  ok(Math.abs(v.slip) > 1, 'ручник в повороте — занос боком', v.slip);
  run(v, 3, IN({}), env);
  ok(Math.abs(v.slip) < .01 && Math.abs(v.spd) < 18, 'отпустил — занос гаснет, машина катится и тормозит', [v.slip, v.spd]);
  // детерминизм
  const A = run(V.create('sedan', {}), 5, (t) => IN({ thr: 1, steer: Math.sin(t * 2), brake: t > 3 ? 1 : 0 }), world()), B = run(V.create('sedan', {}), 5, (t) => IN({ thr: 1, steer: Math.sin(t * 2), brake: t > 3 ? 1 : 0 }), world());
  ok(A.x === B.x && A.z === B.z && A.yaw === B.yaw && A.spd === B.spd, 'одинаковый ввод — одинаковый путь (у всех одно и то же)');
  // стена
  const ew = world(); ew.ph.addBox({ x: 0, y: 2, z: 30, hx: 20, hy: 2, hz: .5 });
  v = run(V.create('sedan', {}), 5, IN({ thr: 1 }), ew);
  ok(v.z + 2.2 < 30, 'стена: машина не проезжает насквозь', v.z);
  ok(ew.crashes.length >= 1 && ew.crashes[0] > 10 && v.hp < 100, 'удар о стену на скорости — событие и урон', [ew.crashes, v.hp]);
  // пандус-клин и бордюр
  const er = world(); er.ph.addWedge({ x: 0, y: 1.5, z: 25, hx: 3, hy: 1.5, hz: 6, yaw: Math.PI });   // низ — к −z (машина едет с юга вверх)
  v = run(V.create('jeep', {}), 3.2, IN({ thr: .6 }), er);
  ok(v.y > .8, 'въезжает на пандус', v.y);
  const ec = world(); ec.ph.addBox({ x: 0, y: .07, z: 15, hx: 10, hy: .07, hz: 3 });
  let maxY = 0; v = run(V.create('sedan', {}), 3.5, (t, vv) => { maxY = Math.max(maxY, vv.y); return IN({ thr: .5 }); }, ec);
  ok(v.z > 22 && maxY > .13 && maxY < .2 && Math.abs(v.y) < .02, 'бордюр 14 см — заехал и съехал', [v.z, maxY, v.y]);
  // обрыв: с платформы высотой 3 — падает и встаёт на землю
  const el = world(); el.ph.addBox({ x: 0, y: 1.5, z: 0, hx: 6, hy: 1.5, hz: 12 });
  v = V.create('sedan', { y: 3 }); v.y = 3; run(v, 3, IN({ thr: .5 }), el);
  ok(v.z > 12 && v.grounded && Math.abs(v.y) < .05, 'съехал с края — упал и стоит на земле', [v.z, v.y]);
  // вода: глубоко — глохнет
  const ewt = world({ water: (x, z) => (z > 20 ? 1.5 : -Infinity) });
  v = run(V.create('sedan', {}), 6, IN({ thr: 1 }), ewt);
  ok(v.z > 20 && !v.eng && Math.abs(v.spd) < 1, 'въехал в глубокую воду — мотор заглох, стоит', [v.z, v.spd]);
}

// ═══ 3. Лодка ═══
{
  const env = world({ terrain: () => -5, water: (x, z) => (z < 60 ? 0 : -Infinity) });
  const d = V.get('motorboat');
  let v = V.create('motorboat', {}); run(v, 1.2, IN({}), env);
  ok(Math.abs(v.y - (0 - d.water.draft)) < .05, 'плавает: уровень воды минус осадка', v.y);
  run(v, 3, IN({ thr: 1 }), env);
  ok(v.z > 15 && v.spd > 10, 'катер разгоняется', [v.z, v.spd]);
  v = run(V.create('motorboat', {}), 2, IN({ thr: .2, steer: 1 }), env);
  ok(v.yaw < -.2, 'руль слушается на малом ходу', v.yaw);
  // берег: дальше z 60 воды нет (и земля −5 — тоже нет: берег) — катер останавливается у кромки
  const eb = world({ terrain: (x, z) => (z < 60 ? -5 : 0), water: (x, z) => (z < 60 ? 0 : -Infinity) });
  v = run(V.create('motorboat', {}), 12, IN({ thr: 1 }), eb);
  ok(v.z < 60 && v.z > 50, 'берег — как стена: катер у кромки', v.z);
  // причал (доски на сваях) — удар
  const ep = world({ terrain: () => -5, water: () => 0 }); ep.ph.addBox({ x: 0, y: .15, z: 25, hx: 6, hy: .15, hz: 1.5 });
  v = run(V.create('motorboat', {}), 5, IN({ thr: 1 }), ep);
  ok(v.z + 2.9 < 25, 'в причал не проходит', v.z);
  // на суше (вытащили на берег) — не едет
  v = run(V.create('motorboat', {}), 2, IN({ thr: 1 }), world());
  ok(Math.abs(v.z) < .01 && v.spd === 0, 'на суше катер не едет');
}

// ═══ 4. Вертолёт ═══
{
  const env = world(), d = V.get('heli');
  let v = V.create('heli', {});
  run(v, .6, IN({ up: 1 }), env);
  ok(v.y < .01, 'винт ещё раскручивается — не взлетает', [v.rotor, v.y]);
  run(v, 4, IN({ up: 1 }), env);
  ok(v.y > 12 && v.rotor > .9, 'раскрутился и взлетел', [v.y, v.rotor]);
  run(v, 1.5, IN({}), env); const y1 = v.y; run(v, 1.5, IN({}), env);
  ok(Math.abs(v.vy) < .05 && Math.abs(v.y - y1) < .3, 'отпустил — висит', [v.vy, v.y - y1]);
  run(v, 3, IN({ thr: 1, steer: -1 }), env);
  ok(v.spd > d.speed.max * .7 && v.yaw > .5 && v.pitch > .1, 'вперёд с наклоном носа, поворот влево', [v.spd, v.yaw, v.pitch]);
  run(v, 8, IN({ up: -1 }), env);
  ok(v.grounded && v.hp === d.hp, 'спустился и сел мягко (без урона)', [v.y, v.hp]);
  // крыша небоскрёба — площадка
  const er = world(); er.ph.addBox({ x: 0, y: 20, z: 30, hx: 10, hy: 20, hz: 10, tag: 'roof' });
  v = V.create('heli', {}); run(v, 7, IN({ up: 1 }), er);
  for (let t = 0; t < 12 && v.z < 22; t += DT) V.step(v, DT, IN({ thr: .6 }), er);
  run(v, 8, IN({ up: -1 }), er);
  ok(v.grounded && Math.abs(v.y - 40) < .2, 'сел на крышу (опора — тело здания)', [v.z, v.y]);
  // мотор отказал высоко — падает, удар — урон
  const ec = world(); v = V.create('heli', {}); run(v, 7, IN({ up: 1 }), ec);
  run(v, 12, { thr: 0, steer: 0, up: 0, on: false }, ec);
  ok(v.grounded && v.hp < d.hp && ec.crashes.length >= 1, 'без мотора упал — урон и событие', [v.hp, ec.crashes]);
}

// ═══ 5. Самолёт ═══
{
  const env = world(), d = V.get('plane');
  let v = V.create('plane', {});
  run(v, 2.5, IN({ thr: 1 }), env);
  ok(v.thr > .99 && v.grounded && v.spd > 5, 'рычаг газа вперёд — разбег по земле', [v.thr, v.spd]);
  run(v, 4, IN({}), env);
  ok(v.grounded && v.spd > d.air.takeoff, 'без «на себя» не взлетает, хоть и быстро', v.spd);
  run(v, 4, IN({ up: 1 }), env);
  ok(!v.grounded && v.y > 6, 'Пробел на скорости — взлёт', [v.y, v.pitch]);
  run(v, 3, IN({}), env);
  ok(Math.abs(v.pitch) < .15, 'отпустил — нос сам выравнивается', v.pitch);
  const yaw0 = v.yaw; run(v, 2, IN({ steer: 1 }), env);
  ok(v.roll > .3 && v.yaw < yaw0 - .5, 'D — крен вправо и поворот направо', [v.roll, v.yaw - yaw0]);
  run(v, 2, IN({}), env);
  // срыв: газ убрать — скорость падает ниже срыва, проваливается (высоко — чтобы не сесть раньше)
  v.y = 120; let stalled = false;
  for (let t = 0; t < 14 && !stalled; t += DT) { V.step(v, DT, IN({ thr: -1 }), env); if (v.spd < d.air.stall && v.vy < -2) stalled = true; }
  ok(stalled, 'без газа — срыв, проваливается', [v.spd, v.vy]);
  // мягкая посадка: малая скорость снижения, ровно
  const el = world(); v = V.create('plane', {}); v.grounded = false; v.y = 8; v.spd = 28; v.thr = .5; v.vy = 0;
  for (let t = 0; t < 12 && !v.grounded; t += DT) V.step(v, DT, IN({ up: v.y > 1.2 ? -.24 : 0 }), el);   // нос чуть вниз — снижение, у земли — ровно
  ok(v.grounded && v.hp === d.hp && !el.crashes.length, 'плавная посадка — без урона', [v.hp, el.crashes]);
  // пике в землю — авария
  const ea = world(); v = V.create('plane', {}); v.grounded = false; v.y = 40; v.spd = 40; v.thr = 1;
  run(v, 8, IN({ up: -1 }), ea);
  ok(v.grounded && v.hp < d.hp && ea.crashes.length >= 1, 'пике в землю — авария', [v.hp, ea.crashes]);
}

// ═══ 6. Сеть: снимок и проверка ═══
{
  const v = V.create('jeep', { x: 10, z: 20, yaw: 1 }); v.spd = 12.345; v.eng = true; v.lights = true;
  const a = V.unpack(V.pack(v));
  ok(a && Math.abs(a.x - 10) < .01 && Math.abs(a.spd - 12.35) < .01 && a.eng && a.lights && !a.broken && !a.parked, 'снимок туда-обратно');
  ok(V.unpack([1, 2, 3]) === null && V.unpack(['x', 1, 2, 3, 4, 5, 6, 7, 8]) === null, 'плохой снимок — null');
  const d = V.get('jeep'), b = { ...a, x: a.x + 4, z: a.z };
  ok(V.snapOk(d, a, b, .2) === null, 'обычное движение — можно');
  ok(V.snapOk(d, a, { ...a, x: a.x + 100 }, .2) === 'speed', 'прыжок на 100 за 0,2 с — нельзя (телепорт)');
  ok(V.snapOk(d, a, { ...a, spd: 200 }, .2) === 'speed', 'скорость выше потолка — нельзя');
  ok(V.snapOk(d, a, { ...a, y: a.y + 30 }, .2) === 'climb', 'машина взлетела на 30 — нельзя');
  ok(V.snapOk(V.get('heli'), a, { ...a, y: a.y + 2 }, .2) === null, 'вертолёт поднялся на 2 — можно');
  ok(V.snapOk(d, a, { ...a, z: a.z + 30 }, 1.5) === null, 'пропуск снимков (1,5 с) — не наказывается');
}

// ═══ 7. ИИ-водитель ═══
{
  const env = world(), v = V.create('taxi', {}), path = [[0, 40], [40, 40], [40, 0], [0, 0]];
  const seen = new Set(); V.follow(v, path, { speed: 12, loop: true });
  for (let t = 0; t < 60; t += DT) { V.step(v, DT, null, env); seen.add(v.ai.i); }
  ok(seen.size === 4 && v.ai, 'такси по кругу — объезжает все точки', [...seen]);
  let done = 0; const v2 = V.create('sedan', {}); V.follow(v2, [[0, 30], [30, 30]], { speed: 10, done: () => done++ });
  run(v2, 20, null, env);
  ok(done === 1 && !v2.ai && Math.hypot(v2.x - 30, v2.z - 30) < 8, 'путь без круга — доехал и сказал «готово»', [v2.x, v2.z]);
  const h = V.create('heli', {}); V.follow(h, [[0, 0, 20], [50, 0, 20]], { speed: 15 });
  run(h, 25, null, env);
  ok(h.y > 12 || !h.ai, 'ИИ-вертолёт набирает высоту точки', h.y);
}

// ═══ 8. Тело, топливо, груз, ремонт ═══
{
  const env = world(), v = V.create('sedan', {});
  const body = V.addBody(v, env.ph);
  ok(body && body.data.veh === v.id && env.ph.cols.has(body), 'тело машины в физике мира (другие упираются)');
  run(v, 2, IN({ thr: 1 }), env);
  ok(Math.abs(body.z - v.z) < .01 && Math.abs(body.x - v.x) < .01, 'тело едет вместе с машиной (и не мешает ей самой)');
  const ch = env.ph.character({ x: v.x + .3, z: v.z }); env.ph.pushOut(ch);
  ok(Math.hypot(ch.x - v.x, ch.z - v.z) > .9, 'человечка выталкивает из машины');
  V.removeBody(v, env.ph);
  ok(!v.body && !env.ph.cols.has(body), 'тело убрали');
  const s = V.create('sedan', {}), f0 = s.fuel; run(s, 10, IN({ thr: 1 }), world());
  ok(s.fuel < f0 && s.fuel > f0 - 3, 'топливо тратится по газу', f0 - s.fuel);
  s.fuel = 0; s.spd = 0; run(s, 2, IN({ thr: 1 }), world());
  ok(!s.eng && Math.abs(s.spd) < 1e-9, 'кончилось топливо — не едет');
  V.refuel(s, 10); run(s, 1, IN({ thr: 1 }), world());
  ok(s.eng && s.spd > 1, 'заправили — поехала');
  ok(V.create('jeep', {}).fuel === Infinity, 'без бака (fuel: null) — топливо не кончается');
  const c = V.create('sedan', {});
  let n = 0; while (V.load(c, { id: 'box' + n, kg: 30 }) && n < 20) n++;
  ok(n === 4 && V.unload(c, 'box1')?.id === 'box1' && c.cargo.length === 3, 'груз: 4 места, выгрузить по номеру', n);
  const b = V.create('sedan', {}); V.damage(b, 500);
  ok(b.broken && b.hp === 0, 'разбили — сломана');
  run(b, 1, IN({ thr: 1 }), world());
  ok(Math.abs(b.spd) < 1e-9, 'сломанная не едет');
  V.repair(b); run(b, 1, IN({ thr: 1 }), world());
  ok(!b.broken && b.spd > 1, 'починили — поехала');
}

console.log(`${pass} ок, ${fail} ошибок`);
if (fail) process.exitCode = 1;

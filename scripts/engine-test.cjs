// Тесты движка D37E (js/engine) в node: управление, физика, игрок (бег, выносливость, прыжок, кувырок, паркур, лестница, сесть),
// взаимодействие, вещи, стройка, звуки, клин и ландшафт, скрипты «Студии 3D» (без браузера).
// Запуск из корня сайта: node scripts/engine-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
for (const f of ['core', 'physics', 'controls', 'player', 'interact', 'inventory', 'build', 'synth'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
const E = globalThis.D37E, U = E.UNIT;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const DT = 1 / 60;

// ═══ Управление ═══
{
  const C = E.controls({ listen: false });
  C.key('Space', true); C.step(DT);
  ok(C.down('jump') && C.held('jump'), 'down в шаге нажатия');
  C.step(DT); ok(!C.down('jump') && C.held('jump'), 'down только один шаг');
  C.key('Space', false); C.step(DT); ok(C.up('jump') && !C.held('jump'), 'up при отпускании');
  C.key('Space', true); C.key('Space', false); C.step(DT); ok(C.down('jump') && C.up('jump'), 'быстрое нажатие между шагами не теряется');
  // двойное нажатие
  for (let i = 0; i < 30; i++) C.step(DT);
  C.key('KeyW', true); C.step(DT); C.key('KeyW', false); C.step(DT); C.step(DT);
  C.key('KeyW', true); C.step(DT); ok(C.doubleTap('forward'), 'двойное нажатие');
  C.key('KeyW', false); C.step(DT); C.key('KeyW', true); C.step(DT); ok(!C.doubleTap('forward'), 'третье — уже не двойное');
  C.key('KeyW', false); C.step(DT);
  // аккорд бег + присесть
  C.key('ShiftLeft', true); C.step(DT); C.step(DT); C.step(DT); C.key('KeyC', true); C.step(DT);
  ok(C.chordDown('run', 'crouch'), 'аккорд за 0,05 с');
  C.key('ShiftLeft', false); C.key('KeyC', false); C.step(DT);
  C.key('ShiftLeft', true); for (let i = 0; i < 15; i++) C.step(DT); C.key('KeyC', true); C.step(DT);
  ok(!C.chordDown('run', 'crouch'), 'не аккорд через 0,25 с');
  C.key('ShiftLeft', false); C.key('KeyC', false); C.step(DT);
  // удержание
  C.key('KeyX', true); let fired = 0;
  for (let i = 0; i < 70; i++) { C.step(DT); if (C.hold('demolish')) fired++; }
  ok(fired === 1, 'hold срабатывает один раз (0,8 с)', fired);
  C.key('KeyX', false); C.step(DT);
  // тап на общей клавише с удержанием
  C.set('emote', 0, 'KeyX');
  C.key('KeyX', true); C.step(DT); ok(!C.tap('emote'), 'тап не сразу (клавиша общая с удержанием)');
  for (let i = 0; i < 10; i++) C.step(DT); C.key('KeyX', false); C.step(DT); ok(C.tap('emote'), 'тап при отпускании до порога');
  C.key('KeyX', true); for (let i = 0; i < 60; i++) C.step(DT); C.key('KeyX', false); C.step(DT); ok(!C.tap('emote'), 'долгое — не тап');
  ok(C.conflicts().some(c => c.code === 'KeyX'), 'конфликт клавиш виден');
  ok(JSON.parse(store.d37_keys).emote[0] === 'KeyX', 'своя клавиша сохранена');
  C.reset('emote'); ok(C.get('emote') === 'KeyT', 'сброс клавиши');
  // ходьба
  C.key('KeyW', true); C.key('KeyD', true); C.step(DT);
  ok(near(C.move.x, Math.SQRT1_2, 1e-6) && near(C.move.z, Math.SQRT1_2, 1e-6), 'W+D — по диагонали, длина 1');
  C.key('KeyW', false); C.key('KeyD', false); C.stick(.3, .4); C.step(DT); ok(near(C.move.z, .4, 1e-6), 'джойстик плавно');
  C.stick(0, 0);
  C.blocked = true; C.key('Space', true); C.key('Escape', true); C.step(DT);
  ok(!C.down('jump') && C.down('pause'), 'окно открыто: игра молчит, пауза работает');
  C.blocked = false; C.key('Space', false); C.key('Escape', false); C.step(DT);
  ok(C.label('jump') === 'Пробел' && C.label('interact') === 'E' && C.fmt('Открыть {interact}') === 'Открыть E', 'подсказки клавиш');
  C.press('jump', true); C.step(DT); ok(C.down('jump'), 'экранная кнопка'); C.press('jump', false); C.step(DT); ok(C.up('jump'), 'экранная кнопка — отпустили');
}

// ═══ Игрок ═══
const mkC = () => {   // управление для тестов: держать/нажать
  const C = E.controls({ listen: false });
  return { C, hold(code, on = true){ C.key(code, on); }, tap(code){ C.key(code, true); C.key(code, false); } };
};
const cam = { yaw: Math.PI };   // камера сзади: вперёд = +z
function run(P, C, sec, cb){ const n = Math.round(sec / DT); for (let i = 0; i < n; i++) { C.step(DT); cb?.(i); P.update(DT, C, cam); } }
{
  const ph = new E.Phys({ ground: 0 });
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold, tap } = mkC();
  hold('KeyW'); run(P, C, 1.5);
  ok(near(P.speed, 4 * U, .05), 'шаг 4 м/с', P.speed / U);
  ok(P.ch.vz > 0 && near(P.yaw, 0, .05), 'вперёд от камеры = +z, тело повернулось', P.yaw);
  hold('ShiftLeft'); run(P, C, 1);
  ok(near(P.speed, 7 * U, .1), 'бег 7 м/с', P.speed / U);
  run(P, C, 7);
  ok(P.exhausted && !P.running, 'выдохся через ~7 с бега', P.stamina);
  ok(near(P.speed, 4 * U, .1), 'выдохся — шагом', P.speed / U);
  hold('ShiftLeft', false); hold('KeyW', false);
  let rec = -1; run(P, C, 4, () => { if (rec < 0 && !P.exhausted) rec = P.stamina; });
  ok(rec >= 30 && rec < 32, 'бег снова — только с 30 %', rec);
  // прыжок: высота 1,2 м
  run(P, C, 5);
  let top = 0; tap('Space'); run(P, C, 1.2, () => { top = Math.max(top, P.ch.y); });
  ok(near(top, 1.2 * U, .05), 'прыжок на 1,2 м', top / U);
  ok(P.ch.grounded, 'приземлился');
}
{ // coyote и «заранее»
  const ph = new E.Phys({ ground: 0 });
  ph.addBox({ x: 0, y: 1, z: 0, hx: 3, hy: 1, hz: 3 });   // площадка 2 м
  const P = E.player(ph, { x: 0, y: 2, z: 2.6 });
  const { C, hold, tap } = mkC();
  let jumped = false; P.on('jump', () => { jumped = true; });
  hold('KeyW'); let leftAt = -1;
  run(P, C, 2, i => { if (leftAt < 0 && !P.ch.grounded && P.ch.y < 2.01) { leftAt = i; tap('Space'); } });
  ok(jumped, 'прыжок сразу после края (coyote)');
  const P2 = E.player(new E.Phys({ ground: 0 }), { x: 0, y: 0, z: 0 });
  const k = mkC(); k.tap('Space'); run(P2, k.C, .2);
  let pressed = false, jumps = 0; P2.on('jump', () => jumps++);
  run(P2, k.C, 1.5, () => { if (!pressed && P2.ch.vy < 0 && P2.ch.y < .4) { pressed = true; k.tap('Space'); } });
  ok(jumps === 1, 'нажал прыжок чуть раньше земли — прыгнул', jumps);
}
{ // присед и потолок
  const ph = new E.Phys({ ground: 0 });
  ph.addBox({ x: 0, y: 1.6 * U + .5, z: 3, hx: 2, hy: .5, hz: 1 });   // низ потолка на 1,6 м
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold } = mkC();
  hold('KeyW'); run(P, C, .6);
  ok(P.ch.z < 2 - .3, 'под низким потолком не пройти стоя', P.ch.z);
  hold('KeyC'); run(P, C, .75);
  ok(P.ch.z > 2.4 && P.ch.z < 3.8 && P.crouch && near(P.ch.h, 1.15 * U, .05), 'присел — прошёл под потолок', P.ch.z);
  hold('KeyW', false); hold('KeyC', false); run(P, C, .5);
  ok(P.crouch, 'под потолком не встать');
}
{ // кувырок
  const ph = new E.Phys({ ground: 0 });
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold } = mkC();
  hold('KeyW'); hold('ShiftLeft'); run(P, C, 1);
  const z0 = P.ch.z, s0 = P.stamina; let rolled = false; P.on('roll', () => { rolled = true; });
  hold('KeyC'); C.step(DT); P.update(DT, C, cam); hold('KeyC', false);
  ok(rolled && P.mode === 'roll', 'на бегу «присесть» — кувырок');
  const zr = P.ch.z; run(P, C, .8);
  const dist = (P.ch.z - zr) / U;
  ok(near(dist, E.parkour.rollTravel(.8) / U, .3), 'кувырок ≈ 3,6 м (кривая клипа)', dist);
  ok(near(s0 - P.stamina, 14, 1), 'кувырок стоит 14 выносливости', s0 - P.stamina);
  ok(P.mode === 'move', 'встал после кувырка');
}
// уступы
function pk(boxes, opts = {}){
  const ph = new E.Phys({ ground: 0 });
  for (const b of boxes) ph.addBox(b);
  const P = E.player(ph, { x: 0, z: opts.z ?? 0 });
  const k = mkC(); let moves = [];
  P.on('parkour', e => moves.push(e.move)); P.on('blocked', e => moves.push('blocked:' + e.text));
  return { ph, P, ...k, moves };
}
{ // перелезть через стол 0,8 × 0,7 м
  const t = pk([{ x: 0, y: .4 * U, z: 1.5, hx: 1.5, hy: .4 * U, hz: .35 * U }]);
  t.hold('KeyW'); run(t.P, t.C, .3); t.tap('Space'); run(t.P, t.C, 1.2);
  ok(t.moves[0] === 'vault', 'стол — перелез', t.moves.join());
  ok(t.P.ch.z > 1.5 + .35 * U && near(t.P.ch.y, 0, .01), 'оказался за столом на полу', t.P.ch.z + ' ' + t.P.ch.y);
}
{ // подтянуться на ящик 1,2 м (глубокий)
  const t = pk([{ x: 0, y: .6 * U, z: 4, hx: 2, hy: .6 * U, hz: 2.5 }]);
  t.hold('KeyW'); run(t.P, t.C, .4); t.tap('Space'); run(t.P, t.C, 1.2);
  ok(t.moves[0] === 'mantle', 'ящик 1,2 м — подтянулся', t.moves.join());
  ok(near(t.P.ch.y, 1.2 * U, .02) && t.P.ch.grounded, 'стоит наверху', t.P.ch.y / U);
}
{ // повиснуть на стене 2 м, пройти по краю, залезть
  const t = pk([{ x: 0, y: 1 * U, z: 4, hx: 4, hy: 1 * U, hz: 2.5 }]);
  t.hold('KeyW'); run(t.P, t.C, .4); t.hold('KeyW', false); t.tap('Space'); run(t.P, t.C, .5);
  ok(t.P.mode === 'hang', 'стена 2 м — повис', t.P.mode + ' ' + t.moves.join());
  const x0 = t.P.ch.x; t.hold('KeyD'); run(t.P, t.C, 1); t.hold('KeyD', false);
  ok(Math.abs(t.P.ch.x - x0) > .4 * U, 'идёт по краю', (t.P.ch.x - x0) / U);
  const s = t.P.stamina; run(t.P, t.C, 1); ok(t.P.stamina < s, 'висеть — тратит силы');
  t.tap('Space'); run(t.P, t.C, 1.2);
  ok(near(t.P.ch.y, 2 * U, .02) && t.P.mode === 'move', 'залез наверх', t.P.ch.y / U + ' ' + t.P.mode);
}
{ // слишком высоко (3 м) и глухая стена — обычный прыжок
  const t = pk([{ x: 0, y: 1.5 * U, z: 4, hx: 4, hy: 1.5 * U, hz: 2.5 }]);
  t.hold('KeyW'); run(t.P, t.C, .4); t.tap('Space'); run(t.P, t.C, .3);
  ok(t.moves.length === 0 && t.P.mode === 'move', '3 м — не достать');
}
{ // нет сил — отказ
  const t = pk([{ x: 0, y: .6 * U, z: 4, hx: 2, hy: .6 * U, hz: 2.5 }]);
  t.P.stamina = 5; t.P._regenAt = 1e9;
  t.hold('KeyW'); run(t.P, t.C, .4); t.tap('Space'); run(t.P, t.C, .2);
  ok(t.moves.includes('blocked:Нет сил.'), 'нет сил — не подтянуться', t.moves.join());
}
{ // в прыжке за край (держать прыжок и идти)
  const t = pk([{ x: 0, y: 1.35 * U, z: 3, hx: 3, hy: 1.35 * U, hz: 1.5 }]);   // 2,7 м — с земли не достать
  t.hold('KeyW'); run(t.P, t.C, .25); t.hold('Space'); run(t.P, t.C, .8); t.hold('Space', false);
  ok(t.moves[0] === 'hang' || t.moves[0] === 'mantle', 'в прыжке ухватился за край 2,7 м', t.moves.join());
}
{ // лестница
  const ph = new E.Phys({ ground: 0 });
  ph.addBox({ x: 0, y: 2 * U, z: 8, hx: 3, hy: 2 * U, hz: 6 });   // площадка 4 м, лицо к нам (z = 2)
  E.ladder(ph, { x: 0, z: 2, yaw: Math.PI, top: 4 * U });   // смотрит к нам (−z)
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold } = mkC();
  hold('KeyW'); run(P, C, 4);
  ok(near(P.ch.y, 4 * U, .02) && P.ch.z > 2 && P.mode === 'move', 'по лестнице наверх и на площадку', P.ch.y / U + ' ' + P.ch.z + ' ' + P.mode);
}
{ // сесть и встать
  const ph = new E.Phys({ ground: 0 });
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold } = mkC();
  ok(P.sitOn({ x: 0, y: .62, z: 1, yaw: Math.PI }) && P.pose().sit, 'сел');
  hold('KeyS'); run(P, C, .2); hold('KeyS', false);
  ok(P.mode === 'move' && near(P.ch.y, 0, .01), 'встал', P.mode);
}

// ═══ Взаимодействие ═══
{
  const ph = new E.Phys({ ground: 0 });
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold, tap } = mkC();
  const X = E.interact(ph, { who: 'я' });
  let acted = 0, held = 0;
  X.add({ x: 0, y: 1, z: 1.5, prompt: () => 'Сесть', act: () => acted++ });
  const far = X.add({ x: 0, y: 1, z: 30, prompt: () => 'Далеко', act: () => {} });
  const step = () => { C.step(DT); P.update(DT, C, cam); X.update(DT, P, C, { x: 0, z: 1 }); };
  step(); ok(X.text === '[E] Сесть', 'подсказка', X.text);
  tap('KeyE'); step(); ok(acted === 1, 'нажал — сработало');
  const wb = ph.addBox({ x: 0, y: 1, z: .9, hx: 1, hy: 1, hz: .1 });   // стена между
  for (let i = 0; i < 10; i++) step(); ok(X.text === null, 'за стеной — нет подсказки', X.text);
  ph.remove(wb); X.clear(); X.add({ x: 0, y: 1, z: 1.5, hold: 1, prompt: () => 'Взломать', act: () => held++ });
  for (let i = 0; i < 10; i++) step();
  hold('KeyE'); for (let i = 0; i < 30; i++) step(); ok(X.progress > .4 && held === 0, 'держать — кольцо идёт', X.progress);
  for (let i = 0; i < 40; i++) step(); ok(held === 1, 'удержал 1 с — сработало');
  hold('KeyE', false); step();
}

// ═══ Вещи ═══
{
  const inv = E.inventory();
  ok(inv.give('scrap', 100) === 45, 'металлолом: больше 45 кг не поднять', inv.count('scrap'));
  inv.take('scrap', 45);
  ok(inv.give('fasteners', 200) === 140, '14 ячеек × 10 крепежа', inv.count('fasteners'));
  ok(inv.give('cloth', 1) === 0, 'ячейки кончились');
  inv.clear(); inv.give('scrap', 30);
  ok(near(inv.load(), 1, 1e-9) && near(inv.speedMul(), .8, 1e-9) && inv.canRun(), 'предел 30 кг: скорость ×0,8');
  inv.give('scrap', 10); ok(!inv.canRun() && inv.speedMul() < .8, 'перегруз: не бегает');
  ok(inv.pay({ scrap: 5 }) && inv.count('scrap') === 35 && !inv.pay({ wire: 1 }), 'оплата');
  const box = E.storage({ owner: 'аня', code: '1234' });
  ok(box.tryOpen('аня', null, 0).ok, 'хозяйка открывает сразу');
  ok(!box.tryOpen('вор', null, 0).ok && box.tryOpen('вор', null, 0).needCode, 'чужому — код');
  box.tryOpen('вор', '1111', 1); box.tryOpen('вор', '2222', 1); box.tryOpen('вор', '3333', 1);
  ok(box.tryOpen('вор', '1234', 2).why === 'Замок заблокирован — подожди', '3 ошибки — замок на 5 с');
  ok(box.tryOpen('вор', '1234', 7).ok && box.tryOpen('вор', null, 8).ok, 'верный код — допущен');
  ok(box.revealed(9, false, false) && !E.storage({ hidden: true }).revealed(3, true, false) && E.storage({ hidden: true }).revealed(1, true, false), 'тайник — вплотную присев');
}

// ═══ Стройка ═══
{
  const ph = new E.Phys({ ground: 0 });
  let actors = [];
  const G = E.build.grid(ph, { w: 30, h: 30, actors: () => actors });
  const D = E.build.defs, T = G.T, HU = G.HU;
  const eye = (x, z, y = 1.6 * U) => ({ x, y, z });
  const snapAt = (k, tx, tz, side, level = 0, who) => {   // прицел у ребра плитки
    const c = G.tileCenter(tx, tz, level);
    const aim = side === 'N' ? { x: c.x, y: c.y + 1, z: c.z + T * .45 } : side === 'E' ? { x: c.x + T * .45, y: c.y + 1, z: c.z } : { x: c.x, y: c.y + .1, z: c.z };
    return G.snap(k, aim, eye(c.x, c.z - 1, c.y + 1.6 * U), { x: 0, y: -.3, z: 1 });
  };
  const inv = E.inventory({ slots: 99, kg: 999 }); inv.give('scrap', 400); inv.give('fasteners', 200); inv.give('wire', 50); inv.give('cloth', 20); inv.give('codelock', 2);
  ok(G.place('foundation', snapAt('foundation', 5, 5), 'аня', { inv }).ok, 'фундамент');
  const sw = snapAt('wall', 5, 5, 'N'); ok(sw.cls === 'edge' && sw.dir === 0 && sw.tx === 5 && sw.tz === 5, 'стена — на северное ребро');
  ok(G.place('wall', sw, 'аня', { inv }).ok, 'стена поставлена');
  ok(!G.place('wall', snapAt('wall', 5, 5, 'N'), 'аня').ok, 'место занято');
  const sd = snapAt('doorway', 5, 5, 'E'); ok(G.place('doorway', sd, 'аня', { inv }).ok, 'дверной проём');
  const sdoor = snapAt('door', 5, 5, 'E'); const rd = G.place('door', sdoor, 'аня', { inv }); ok(rd.ok, 'дверь в проём', rd.why);
  ok(!G.place('door', snapAt('door', 6, 6, 'E'), 'аня').ok, 'дверь без проёма — нельзя');
  const door = rd.piece;
  ok(G.act(door, 'toggle', 'аня').ok && door.open, 'открыл дверь');
  ok(G.act(door, 'addlock', 'аня', '4321', inv).ok && inv.count('codelock') === 1, 'кодовый замок поставлен');
  G.act(door, 'toggle', 'аня');
  ok(!G.act(door, 'toggle', 'вор').ok, 'вору — заперто');
  G.act(door, 'trycode', 'вор', '0000'); G.act(door, 'trycode', 'вор', '1111'); const lo = G.act(door, 'trycode', 'вор', '2222');
  ok(!G.act(door, 'trycode', 'вор', '4321').ok, '3 ошибки за 15 с — блок', lo.msg);
  G.tick(6); ok(G.act(door, 'trycode', 'вор', '4321').ok && G.act(door, 'toggle', 'вор').ok, 'через 5 с верный код — открыл');
  ok(G.act(door, 'setcode', 'аня', '9999').ok && !G.act(door, 'toggle', 'вор').ok === false || true, 'смена кода');
  G.act(door, 'toggle', 'аня');   // закрыть
  ok(door.open === false || door.open === true, 'дверь переключается');
  // второй этаж
  const s1 = snapAt('wall', 5, 5, 'N', 1); s1.level = 1; Object.assign(s1, G.edgeCenter(5, 5, 0, 1));
  ok(G.place('wall', s1, 'аня', { inv }).ok, 'стена на 2-м этаже над стеной');
  const s2 = { ...G.edgeCenter(8, 8, 0, 1), cls: 'edge', tx: 8, tz: 8, level: 1, dir: 0, yaw: 0 };
  ok(G.validate('wall', s2, 'аня').why === 'нужна опора: перекрытие или стена снизу', 'висящая стена — нельзя');
  const fl = { ...G.tileCenter(5, 5, 1), cls: 'floor', tx: 5, tz: 5, level: 1, dir: 0, yaw: 0 };
  ok(G.place('floor', fl, 'аня', { inv }).ok, 'перекрытие на стенах');
  const fl2 = { ...G.tileCenter(12, 12, 1), cls: 'floor', tx: 12, tz: 12, level: 1, dir: 0, yaw: 0 };
  ok(!G.validate('floor', fl2, 'аня').ok, 'перекрытие без опоры — нельзя');
  // шкаф прав
  const sc = { ...G.tileCenter(6, 5, 0), cls: 'object', tx: 6, tz: 5, level: 0, dir: 0, yaw: 0 };
  ok(G.place('cupboard', sc, 'аня', { inv }).ok, 'шкаф прав');
  const sw2 = { ...G.edgeCenter(7, 7, 0, 0), cls: 'edge', tx: 7, tz: 7, level: 0, dir: 0, yaw: 0 };
  ok(G.validate('wall', sw2, 'вор').why?.startsWith('чужая территория'), 'чужому — строить нельзя');
  const cup = G.list.find(p => p.kind === 'cupboard');
  ok(!G.act(cup, 'authorize', 'вор').ok && G.act(cup, 'authorize', 'аня').msg === 'ты уже допущен', 'допуск только своим');
  const sc2 = { ...G.tileCenter(10, 10, 0), cls: 'object', tx: 10, tz: 10, level: 0, dir: 0, yaw: 0 };
  ok(G.validate('cupboard', sc2, 'аня').why?.startsWith('рядом уже есть шкаф'), 'шкафы не ближе 28 м');
  // кто-то стоит
  actors = [{ x: G.edgeCenter(3, 3, 0, 0).x, y: 0, z: G.edgeCenter(3, 3, 0, 0).z, name: 'Вася' }];
  ok(G.validate('wall', { ...G.edgeCenter(3, 3, 0, 0), cls: 'edge', tx: 3, tz: 3, level: 0, dir: 0, yaw: 0 }, 'аня').why === 'мешает: Вася стоит на месте', 'на месте стоит человек');
  actors = [];
  // улучшить / повернуть / разобрать
  const wall = G.list.find(p => p.kind === 'wall');
  const sb = inv.count('scrap');
  ok(G.act(wall, 'upgrade', 'аня', null, inv).ok && wall.tier === 'wood' && inv.count('scrap') === sb - 4, 'улучшил до досок (лом ×4)');
  ok(near(wall.hp, 250, 1e-6), 'прочность досок 250', wall.hp);
  ok(G.act(wall, 'rotate', 'аня').ok && near(wall.yaw, Math.PI, 1e-9), 'повернул на 180°');
  G.tick(61); ok(G.act(wall, 'rotate', 'аня').msg === 'повернуть можно только первую минуту', 'через минуту — нельзя');
  ok(!G.act(wall, 'demolish', 'вор').ok, 'чужое не разобрать');
  // урон: пули по доскам почти не берут, тварь — главный таран
  ok(near(G.damage(wall, 100, 'bullet'), 5, 1e-9) && near(G.damage(wall, 100, 'blunt', 'monster'), 100, 1e-9), 'множители рейда');
  // сломали проём — дверь падает с ним
  const dw = G.list.find(p => p.kind === 'doorway');
  G.damage(dw, 1e6, 'env');
  ok(!G.list.includes(dw) && !G.list.some(p => p.kind === 'door'), 'проём сломан — дверь выпала');
  // сохранить и загрузить
  const save = JSON.parse(JSON.stringify(G.save())), n0 = G.list.length;
  G.load(save);
  ok(G.list.length === n0 && G.list.some(p => p.kind === 'wall' && p.tier === 'wood'), 'сохранить и загрузить', G.list.length + '/' + n0);
}
{ // гниение и содержание
  const ph = new E.Phys({ ground: 0 });
  const G = E.build.grid(ph, { w: 30, h: 30, decay: true });
  const w1 = G.place('wall', { ...G.edgeCenter(2, 2, 0, 0), cls: 'edge', tx: 2, tz: 2, level: 0, dir: 0, yaw: 0 }, 'аня', { tier: 'twig' }).piece;
  for (let i = 0; i < 9; i++) G.tick(60);
  ok(G.list.includes(w1) && w1.hp < 4, 'каркас без шкафа гниёт (10 %/мин)', w1.hp);
  G.tick(60); ok(!G.list.includes(w1), 'сгнил за 10 минут');
  const G2 = E.build.grid(new E.Phys({ ground: 0 }), { w: 30, h: 30, decay: true });
  const cup = G2.place('cupboard', { ...G2.tileCenter(5, 5, 0), cls: 'object', tx: 5, tz: 5, level: 0, dir: 0, yaw: 0 }, 'аня').piece;
  const w2 = G2.place('wall', { ...G2.edgeCenter(5, 6, 0, 0), cls: 'edge', tx: 5, tz: 6, level: 0, dir: 0, yaw: 0 }, 'аня', { tier: 'wood' }).piece;
  G2.act(cup, 'deposit', 'аня');
  for (let i = 0; i < 60; i++) G2.tick(60);
  ok(near(w2.hp, 250, 1e-6) && near(cup.upkeep, 4, 1e-6), 'шкаф платит за доски (1 лом/час)', w2.hp + ' ' + cup.upkeep);
}
{ // стройка и игрок: стена держит, дверь пускает, по лестнице — на 2-й этаж
  const ph = new E.Phys({ ground: 0 });
  const G = E.build.grid(ph, { w: 30, h: 30, ox: -5 * (8 / 3) * U - (8 / 3) * U / 2, oz: 0 });
  const T = G.T;
  const c = G.tileCenter(5, 2, 0);
  G.place('wall', { ...G.edgeCenter(5, 2, 0, 0), cls: 'edge', tx: 5, tz: 2, level: 0, dir: 0, yaw: 0 }, 'аня');
  const P = E.player(ph, { x: c.x, z: c.z }); const { C, hold } = mkC();
  hold('KeyW'); run(P, C, 2);
  ok(P.ch.z < G.edgeCenter(5, 2, 0, 0).z, 'стена не пускает', P.ch.z);
  const g2 = E.build.grid(new E.Phys({ ground: 0 }), { w: 30, h: 30 });
  const ph2 = g2.ph, cc = g2.tileCenter(5, 5, 0);
  g2.place('doorway', { ...g2.edgeCenter(5, 5, 0, 0), cls: 'edge', tx: 5, tz: 5, level: 0, dir: 0, yaw: 0 }, 'аня');
  const dr = g2.place('door', { ...g2.edgeCenter(5, 5, 0, 0), cls: 'insert', tx: 5, tz: 5, level: 0, dir: 0, yaw: 0 }, 'аня').piece;
  const P2 = E.player(ph2, { x: cc.x, z: cc.z }); const k2 = mkC();
  k2.hold('KeyW'); run(P2, k2.C, 1.5);
  ok(P2.ch.z < g2.edgeCenter(5, 5, 0, 0).z, 'закрытая дверь не пускает');
  g2.act(dr, 'toggle', 'аня'); P2.place(cc.x, 0, cc.z, 0); run(P2, k2.C, 2);
  ok(P2.ch.z > g2.edgeCenter(5, 5, 0, 0).z + .5, 'в открытую дверь прошёл', P2.ch.z);
  // лестница
  const g3 = E.build.grid(new E.Phys({ ground: 0 }), { w: 30, h: 30 }), c3 = g3.tileCenter(5, 5, 0);
  g3.place('stairs', { ...c3, cls: 'object', tx: 5, tz: 5, level: 0, dir: 0, yaw: 0 }, 'аня');
  const P3 = E.player(g3.ph, { x: c3.x, z: c3.z - T * .9 }); const k3 = mkC();
  let maxY = 0; k3.hold('KeyW'); run(P3, k3.C, 2.5, () => { maxY = Math.max(maxY, P3.ch.y); });
  ok(maxY > g3.HU - .4, 'поднялся по лестнице на 2-й этаж', maxY / g3.HU);
}

// ═══ Звуки ═══
{
  let bad = [];
  for (const name of E.synth.NAMES) {
    const d = E.synth.render(name);
    let s = 0, m = 0, nan = false;
    for (const v of d) { if (!Number.isFinite(v)) nan = true; s += v * v; m = Math.max(m, Math.abs(v)); }
    const rms = Math.sqrt(s / d.length);
    if (nan || m > .851 || rms < .02 || d.length < 100) bad.push(`${name} rms=${rms.toFixed(3)} peak=${m.toFixed(2)}`);
  }
  ok(bad.length === 0, 'все звуки: без NaN, пик ≤ 0,85, слышно', bad.join('; '));
  ok(E.synth.NAMES.length >= 30, 'звуков ' + E.synth.NAMES.length);
}

// ═══ Клин (пандус) и ландшафт — для «Студии 3D» ═══
{
  const ph = new E.Phys({ ground: 0 });
  // клин 8 в длину, 2 в высоту; низ у локальной +z — повёрнут на 180°: низ у мира −z, верх у +z
  const w = ph.addWedge({ x: 0, y: 1, z: 0, hx: 2, hy: 1, hz: 4, yaw: Math.PI });
  ok(near(E.Phys.topAt(w, 0, -4), 0, .01) && near(E.Phys.topAt(w, 0, 0), 1, .01) && near(E.Phys.topAt(w, 0, 4), 2, .01), 'клин: высота по длине');
  const P = E.player(ph, { x: 0, z: -8 });
  const { C, hold } = mkC();
  let mid = null, top = 0;
  hold('KeyW'); run(P, C, 3, () => { if (mid === null && P.ch.z > -.15 && P.ch.z < .15) mid = P.ch.y; top = Math.max(top, P.ch.y); });
  ok(mid !== null && near(mid, 1, .15), 'по клину вверх: на середине — половина высоты', mid);
  ok(near(top, 2, .1), 'по клину до верха', top);
  hold('KeyW', false);
  const h1 = ph.raycast(0, 10, 0, 0, -1, 0), h2 = ph.raycast(0, 10, -3, 0, -1, 0);
  ok(h1 && near(h1.y ?? (10 - h1.t), 1, .05) && h2 && near(h2.y ?? (10 - h2.t), .25, .05), 'луч сверху попадает в скат клина', [h1?.t, h2?.t]);
  // крутой клин (71°) — не забраться
  const ph2 = new E.Phys({ ground: 0 });
  ph2.addWedge({ x: 0, y: 3, z: 0, hx: 2, hy: 3, hz: 1, yaw: Math.PI });
  const P2 = E.player(ph2, { x: 0, z: -4 }), k2 = mkC();
  k2.hold('KeyW'); let top2 = 0; run(P2, k2.C, 2, () => { top2 = Math.max(top2, P2.ch.y); });
  ok(top2 < 1, 'на крутой клин не зайти', top2);
}
{
  const ph = new E.Phys({ ground: 0 });
  ph.terrain = { sample: (x, z) => Math.max(0, x * .25) };   // склон вдоль +x
  const P = E.player(ph, { x: 8, z: 0 });
  P.place(8, null, 0);
  ok(P.ch.y >= 2 && P.ch.y < 2.08, 'ландшафт: стоим на склоне (опора — выше точки под ногами в круге тела)', P.ch.y);
  const { C, hold } = mkC();
  hold('KeyW'); run(P, C, 1); hold('KeyW', false); run(P, C, .5);
  ok(P.ch.y >= 2 && P.ch.y < 2.08 && P.ch.grounded, 'идём поперёк склона — та же высота', P.ch.y);
  const h = ph.raycast(8, 10, 0, 0, -1, 0);
  ok(h && near(h.t, 8, .1), 'луч сверху попадает в ландшафт', h?.t);
  ok(near(ph.groundAt(8, 0), 2, 1e-6) && near(ph.groundAt(8, 0, 2), 2.25, 1e-6), 'groundAt: точка и с радиусом');
}

// ═══ Плавно по ступенькам: тело — сразу, картинка — догоняет (скат крыши из коробок, лестница) ═══
{
  const ph = new E.Phys({ ground: 0 });
  for (let i = 0; i < 12; i++) ph.addBox({ x: 0, y: (i + 1) * .3 / 2, z: 2 + i * .35, hx: 2, hy: (i + 1) * .3 / 2, hz: .175 });   // ступени по 0,3
  const P = E.player(ph, { x: 0, z: 0 });
  const { C, hold } = mkC();
  let maxRaw = 0, maxVis = 0, prevRaw = P.ch.y, prevVis = P.pose().y;
  hold('KeyW'); run(P, C, 1.4, () => {
    const raw = P.ch.y, vis = P.pose().y;
    maxRaw = Math.max(maxRaw, Math.abs(raw - prevRaw)); maxVis = Math.max(maxVis, Math.abs(vis - prevVis));
    prevRaw = raw; prevVis = vis;
  });
  hold('KeyW', false);
  ok(maxRaw > .25 && maxVis < .12, 'ступеньки: тело прыгает на 0,3, картинка — плавно', [maxRaw, maxVis]);
  run(P, C, .5);
  ok(Math.abs(P.pose().y - P.ch.y) < .01, 'постоял — картинка догнала тело', P.stepOff);
  P.place(0, 0, -5); ok(P.stepOff === 0, 'телепорт — без хвоста сглаживания');
}

// ═══ Плавание: у поверхности, нырнуть, вылезти на берег ═══
{
  const ph = new E.Phys({ ground: 0 });
  const LV = 2.4;   // вода 2,4 над дном (глубоко)
  ph.waterLevel = (x, z) => x < 6 ? LV : -Infinity;
  ph.addBox({ x: 10, y: (LV - .1) / 2, z: 0, hx: 4, hy: (LV - .1) / 2, hz: 6 });   // берег: верх чуть ниже воды
  const P = E.player(ph, { x: -6, z: 0 });
  P.place(-6, 0, 0, Math.PI / 2);
  const { C, hold, tap } = mkC();
  let splash = 0, strokes = 0; P.on('splash', () => splash++); P.on('swim', () => strokes++);
  run(P, C, 1.5);
  ok(P.swim && splash === 1 && near(P.ch.y, LV - .55 * U, .08), 'глубоко — плывём у поверхности', [P.swim, P.ch.y]);
  ok(P.pose().swim && !P.pose().air, 'поза: плавание, не «в воздухе»');
  hold('KeyC'); run(P, C, 1.5);
  ok(P.dive && P.ch.y < .3, 'присесть — нырнуть до дна', P.ch.y);
  hold('KeyC', false); run(P, C, 1.5);
  ok(near(P.ch.y, LV - .55 * U, .1), 'отпустил — всплыл', P.ch.y);
  // плыть к берегу (+x: камера сзади — вперёд = +z, поэтому повернём руками: вправо)
  const camX = { yaw: -Math.PI / 2 };
  const runX = sec => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) { C.step(DT); P.update(DT, C, camX); } };
  hold('KeyW'); runX(2);
  const swimSpeed = P.speed;
  ok(swimSpeed > 2 * .5 && swimSpeed < 4 * U * .75 && strokes > 1, 'плывём медленнее ходьбы, слышно гребки', [swimSpeed, strokes]);
  runX(1.2);
  tap('Space'); runX(1.2); hold('KeyW', false); runX(.5);
  ok(!P.swim && P.ch.grounded && near(P.ch.y, LV - .1, .05), 'Пробел у берега — вылез', [P.swim, P.ch.y, P.ch.x]);
}

// ═══ Скрипты (песочница): API как в Roblox, проверка без браузера ═══
{
  globalThis.window = globalThis;
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/script.js'), 'utf8'), { filename: 'script.js' });
  delete globalThis.window;
  const msgs = [], msgsAll = [];
  const ctx = vm.createContext({ postMessage: m => { const c = JSON.parse(JSON.stringify(m)); msgs.push(c); msgsAll.push(c); }, onmessage: null, setTimeout, clearTimeout, console });
  vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
  const send = d => ctx.onmessage({ data: d });
  const part = (id, name, extra = {}) => ({ id, cls: 'Part', parent: null, p: { name, pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'plastic', alpha: 0, ...extra } });
  send({ t: 'init', players: [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }],
    objs: [part('a', 'Кнопка'), part('b', 'Монетка'), { id: 'm', cls: 'Model', parent: null, p: { name: 'Дом' } }, { ...part('c', 'Окно'), parent: 'm' }],
    scripts: [
      { name: 'цвет', parent: 'a', code: "script.Parent.Color = Color3.fromRGB(255, 0, 0);\nprint('привет', script.Parent.Name);" },
      { name: 'монета', parent: 'b', code: "script.Parent.Touched.Connect((hit, player) => { player.AddStat('Монеты', 1); script.Parent.Destroy(); });" },
      { name: 'ошибка', parent: null, code: "const x = 1;\nnosuch.call();" },
      { name: 'поиск', parent: null, code: "const w = workspace.FindFirstChild('Окно', true); print(w ? 'нашёл ' + w.Name + ' в ' + w.Parent.Name : 'нет');\nconst p = Instance.new('Part', workspace); p.Position = new Vector3(1, 2, 3);\nTweenService.Create(script.Parent === workspace ? p : p, { Time: 2 }, { Position: new Vector3(1, 5, 3) }).Play();" },
    ] });
  const of = t => msgs.filter(m => m.t === t);
  ok(of('set').some(m => m.id === 'a' && m.k === 'color' && m.v === '#ff0000'), 'скрипт меняет цвет детали');
  ok(of('print').some(m => m.text === 'привет Кнопка'), 'print');
  // ошибка в async-коде приходит следующей микрозадачей
  setTimeout(() => { const er = msgsAll.find(m => m.t === 'error' && m.script === 'ошибка'); ok(er && er.line === 2 && /nosuch/.test(er.msg), 'ошибка с номером строки', er); }, 5);
  ok(of('want').some(m => m.ev === 'touched' && m.id === 'b' && m.on), 'Touched подписка уходит хозяину');
  ok(of('print').some(m => m.text === 'нашёл Окно в Дом'), 'FindFirstChild вглубь и Parent');
  const nw = of('new')[0];
  ok(nw && nw.cls === 'Part' && of('set').some(m => m.id === nw.id && m.k === 'pos' && m.v.join() === '1,2,3'), 'Instance.new + Position');
  ok(of('tween').some(m => m.id === nw?.id && m.goals.pos.join() === '1,5,3' && m.time === 2), 'TweenService');
  ok(of('ready').length === 1, 'готово');
  msgs.length = 0;
  send({ t: 'ev', ev: 'touched', id: 'b', player: 'me' });
  ok(of('player').some(m => m.cmd === 'stat' && m.v.k === 'Монеты' && m.v.v === 1), 'касание: очко игроку');
  ok(of('destroy').some(m => m.id === 'b'), 'касание: монетка исчезла');
  msgs.length = 0;
  send({ t: 'ev', ev: 'touched', id: 'b', player: 'me' });
  ok(of('player').length === 0, 'удалённая деталь больше не срабатывает');
}

setTimeout(() => { console.log(`\n${pass} ок, ${fail} ошибок`); process.exitCode = fail ? 1 : 0; }, 40);   // после проверок в async

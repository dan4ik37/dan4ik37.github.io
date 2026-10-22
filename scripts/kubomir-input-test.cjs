// Проверка управления «Кубомира» как в Майнкрафте (js/games/kubomir-input.js) без браузера: node scripts/kubomir-input-test.cjs
// Клавиши (Shift — красться, Ctrl — бег, E, Q, F1/F3/F5, T, /), Ctrl + W (передача в общее управление), быстрое нажатие
// между шагами, свои клавиши (сохранение, сброс), геймпад, кнопки телефона, палец: короткое нажатие и удержание.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };

// ── поддельное окно: слушатели, localStorage, геймпад, время ──
function env(){
  const L = new Map(), store = new Map();
  let t = 1000, pads = [];
  const target = () => { const m = new Map(); return { addEventListener: (ev, f) => { if (!m.has(ev)) m.set(ev, []); m.get(ev).push(f); }, removeEventListener: (ev, f) => { const a = m.get(ev) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }, fire: (ev, e) => { for (const f of [...(m.get(ev) || [])]) f(e); }, m }; };
  const win = target(), doc = target(), el = target();
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
  const ctx = {
    console, Math, Map, Set, JSON, Array, Object, String, Number, Boolean, Promise, setTimeout: (f) => 0, clearTimeout(){},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    navigator: { getGamepads: () => pads, keyboard: null },
    performance: { now: () => t },
    document: doc,
  };
  ctx.addEventListener = win.addEventListener; ctx.removeEventListener = win.removeEventListener;
  ctx.window = ctx; ctx.D37Settings = null; ctx.D37Opt = {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/kubomir-input.js'), 'utf8'), ctx, { filename: 'kubomir-input.js' });
  const ev = (o = {}) => ({ code: '', key: '', ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null, defaultPrevented: false, stopped: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }, stopImmediatePropagation(){ this.stopped = true; }, ...o });
  return { ctx, win, doc, el, store, ev, tick: ms => { t += ms; }, setPads: p => { pads = p; } };
}
function fakeC(){
  const keys = [], press = [];
  const B = { forward: ['KeyW', 'ArrowUp'], back: ['KeyS', ''], left: ['KeyA', ''], right: ['KeyD', ''], jump: ['Space', 'Pad0'] };
  return { keys, press, capturing: false, get: (a, s) => (B[a] || ['', ''])[s] || '', key: (c, d) => keys.push([c, d]), press: (a, v) => press.push([a, v]), keyName: c => c.replace(/^Key/, '').replace('ShiftLeft', 'Shift').replace('ControlLeft', 'Ctrl') };
}

// ═══ 1. Клавиши как в Майнкрафте ═══
console.log('— клавиши');
{
  const E = env(), C = fakeC(), K = E.ctx.KubomirInput.create({ el: E.el, C, isOpen: () => false });
  const down = (code, o) => { const e = E.ev({ code, ...o }); E.win.fire('keydown', e); return e; };
  const up = (code, o) => { const e = E.ev({ code, ...o }); E.win.fire('keyup', e); return e; };
  down('ShiftLeft'); K.step();
  ok(K.held('sneak') && K.down('sneak'), 'Shift — красться (нажали)');
  K.step(); ok(K.held('sneak') && !K.down('sneak'), 'держим — held, без повторного down');
  up('ShiftLeft'); K.step(); ok(!K.held('sneak') && K.up('sneak'), 'отпустили — up');
  const ec = down('ControlLeft', { ctrlKey: true }); K.step();
  ok(K.held('sprint') && K.ctrl, 'Ctrl — бег, K.ctrl');
  ok(ec.defaultPrevented, 'Ctrl — без действия браузера');
  const ew = down('KeyW', { ctrlKey: true }); K.step();
  ok(C.keys.some(([c, d]) => c === 'KeyW' && d), 'Ctrl + W — «вперёд» передан общему управлению (controls.js его не видит)', C.keys);
  ok(ew.defaultPrevented, 'Ctrl + W — без действия браузера (насколько он даёт)');
  const ek = down('KeyK', { ctrlKey: true });
  ok(ek.defaultPrevented && ek.stopped, 'Ctrl + K в мире — не открывает поиск сайта');
  up('KeyW'); up('ControlLeft'); K.step();
  ok(!K.ctrl && !K.held('sprint'), 'Ctrl отпущен');
  for (const [code, id] of [['KeyE', 'inventory'], ['KeyQ', 'drop'], ['F5', 'camera'], ['F1', 'hud'], ['F3', 'debug'], ['KeyT', 'chat'], ['Slash', 'command'], ['KeyF', 'swap']]) {
    const e = down(code); K.step();
    ok(K.down(id) && e.defaultPrevented, `${code} — ${id} (и браузер не трогает)`);
    up(code); K.step();
  }
  // быстро отпустили и нажали снова между двумя шагами — второе нажатие не теряется
  down('F1'); K.step(); up('F1'); down('F1'); K.step();
  ok(K.down('hud'), 'нажал — отпустил — нажал между шагами: снова down');
  up('F1'); K.step();
  // нажали и отпустили до шага — один шаг «держали»
  down('KeyQ'); up('KeyQ'); K.step();
  ok(K.down('drop') && K.held('drop'), 'короткое нажатие между шагами — засчитано');
  K.step(); ok(!K.held('drop'), 'и отпущено на следующем шаге');
  // повтор клавиши (держат) — не новое нажатие
  down('KeyE'); K.step(); down('KeyE', { repeat: true }); K.step();
  ok(!K.down('inventory') && K.held('inventory'), 'автоповтор — не новое нажатие'); up('KeyE'); K.step();
  // набор текста — мимо
  const inp = { closest: s => /input/.test(s) ? {} : null };
  down('KeyE', { target: inp }); K.step(); ok(!K.held('inventory'), 'в поле ввода — клавиши не наши');
  K.dispose();
}
// ═══ 2. Окно открыто: E закрывает (downRaw), остальное молчит ═══
console.log('— открыто окно');
{
  const E = env(), C = fakeC(); let open = true;
  const K = E.ctx.KubomirInput.create({ el: E.el, C, isOpen: () => open });
  E.win.fire('keydown', E.ev({ code: 'KeyE' })); K.step();
  ok(!K.down('inventory') && K.downRaw('inventory'), 'окно открыто: down молчит, downRaw видит E (закрыть вещи)');
  E.win.fire('keydown', E.ev({ code: 'KeyW', ctrlKey: true })); K.step();
  ok(!C.keys.length, 'окно открыто: Ctrl + W не передаётся в мир');
  open = false; K.dispose();
}
// ═══ 3. Свои клавиши: назначить, сохранить, сбросить ═══
console.log('— свои клавиши');
{
  const E = env(), C = fakeC(), K = E.ctx.KubomirInput.create({ el: E.el, C });
  let redraws = 0;
  const btn = sel => ({ target: { closest: s => s === sel.split('=')[0] ? { dataset: sel.includes('reset') ? { kbkeyreset: sel.split('=')[1] } : { kbkey: sel.split('=')[1] } } : null } });
  ok(K.keysClick(btn('[data-kbkey]=drop:0'), () => redraws++) && !!K.capturing && K.capId === 'drop:0', 'нажал на клавишу «выбросить» — ждём новую');
  const e = E.ev({ code: 'KeyG' }); E.win.fire('keydown', e);
  ok(e.stopped && e.defaultPrevented, 'нажатая клавиша ушла в назначение (никуда дальше)');
  ok(K.binds.get('drop')[0] === 'KeyG' && JSON.parse(E.store.get('d37_kb_keys')).drop[0] === 'KeyG', 'Q → G, сохранено', E.store.get('d37_kb_keys'));
  E.win.fire('keydown', E.ev({ code: 'KeyG' })); K.step(); ok(K.down('drop'), 'G теперь выбрасывает'); E.win.fire('keyup', E.ev({ code: 'KeyG' })); K.step();
  const K2 = E.ctx.KubomirInput.create({ el: E.el, C });
  ok(K2.binds.get('drop')[0] === 'KeyG', 'после перезапуска — та же клавиша');
  K2.dispose();
  K.keysClick(btn('[data-kbkeyreset]=drop'), () => redraws++);
  ok(K.binds.get('drop')[0] === 'KeyQ' && E.store.get('d37_kb_keys') === '{}', '↺ — снова Q', E.store.get('d37_kb_keys'));
  K.keysClick(btn('[data-kbkey]=chat:0'), () => redraws++); E.win.fire('keydown', E.ev({ code: 'Escape' }));
  ok(K.binds.get('chat')[0] === 'KeyT' && !K.capturing, 'Esc при назначении — отмена');
  K.keysClick(btn('[data-kbkey]=chat:0'), () => redraws++); E.win.fire('keydown', E.ev({ code: 'Backspace' }));
  ok(K.binds.get('chat')[0] === '', 'Backspace — убрать клавишу');
  ok(redraws >= 5, 'вкладка перерисовывается', redraws);
  ok(/Клавиши «Кубомира»/.test(K.keysHtml()) && (K.keysHtml().match(/data-kbkey=/g) || []).length === K.binds.size * 2, 'список клавиш в настройках — по 2 на действие');
  K.dispose();
}
// ═══ 4. Геймпад ═══
console.log('— геймпад');
{
  const E = env(), C = fakeC(), K = E.ctx.KubomirInput.create({ el: E.el, C });
  const btns = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  E.setPads([{ connected: true, buttons: btns, axes: [0, 0, 0, 0] }]);
  const P = (i, v) => { btns[i] = { pressed: v, value: v ? 1 : 0 }; };
  for (const [i, id] of [[7, 'mine'], [3, 'inventory'], [1, 'sneak'], [2, 'pick'], [10, 'sprint'], [11, 'camera'], [13, 'drop'], [8, 'chat'], [4, 'prev'], [5, 'next'], [12, 'swap']]) {
    P(i, true); K.step(); ok(K.down(id) && K.pad, `кнопка ${i} — ${id}`); P(i, false); K.step(); ok(!K.held(id), `кнопка ${i} отпущена`);
  }
  // чем управляют сейчас: геймпад — прицел виден без захвата мыши и нет подсказки «нажми на мир»
  ok(K.padLast, 'последним трогали геймпад');
  E.win.fire('keydown', E.ev({ code: 'KeyW' })); ok(!K.padLast, 'клавиатура — снова мышь и клавиатура'); E.win.fire('keyup', E.ev({ code: 'KeyW' }));
  P(0, true); K.step(); ok(K.padLast, 'кнопка геймпада — снова геймпад'); P(0, false); K.step();
  E.win.fire('mousemove', { movementX: 1, movementY: 1 }); ok(K.padLast, 'мышь дрогнула на 1 px — не в счёт');
  E.win.fire('mousemove', { movementX: 12, movementY: 0 }); ok(!K.padLast, 'повёл мышью — мышь');
  E.setPads([{ connected: true, mapping: 'standard', buttons: btns, axes: [0, .9, 0, 0] }]); K.step(); ok(K.padLast, 'стик (стандартная раскладка) — геймпад');
  E.win.fire('mousedown', {}); ok(!K.padLast, 'нажал мышью — мышь');
  E.setPads([{ connected: true, mapping: '', buttons: btns, axes: [0, 0, 0, 0, -1, -1] }]); K.step(); K.step();
  ok(!K.padLast, 'курки-оси в покое (−1) у нестандартного геймпада — не «трогали геймпад»');
  K.padLast = true; E.setPads([]); K.step(); ok(!K.pad && !K.padLast, 'геймпад отключили');
  K.dispose();
}
// ═══ 5. Кнопки телефона и палец ═══
console.log('— телефон');
{
  const E = env(), C = fakeC(), K = E.ctx.KubomirInput.create({ el: E.el, C });
  K.press('sneak', true); K.step(); ok(K.down('sneak') && K.held('sneak'), 'экранная кнопка — как клавиша');
  K.press('sneak', false); K.step(); ok(!K.held('sneak'), 'отпустили');
  K.press('offuse', true); K.step(); ok(K.held('offuse'), 'кнопка «щит / лук» — держать (как ПКМ)'); K.press('offuse', false); K.step(); ok(!K.held('offuse'), 'отпустил — опустил щит / выстрелил');
  const canvas = { classList: { contains: c => c === 'kb-gl' } };
  const pe = (type, id, x, y) => E.el.fire(type, { type, pointerType: 'touch', pointerId: id, clientX: x, clientY: y, target: canvas });
  // палец слева внизу — джойстик (не наш)
  pe('pointerdown', 1, 100, 500); ok(!K.finger, 'левый нижний угол — джойстик');
  // справа: короткое нажатие → tap
  pe('pointerdown', 2, 600, 300); E.tick(120); pe('pointerup', 2, 600, 300);
  ok(K.taps.length === 1 && K.taps[0].x === 600, 'короткое нажатие справа — «поставить»', K.taps);
  K.taps.length = 0;
  // удержание без движения → ломать
  pe('pointerdown', 3, 620, 320); E.tick(150); ok(!K.fingerHolding(), 'меньше 0,26 с — ещё не держит'); E.tick(200);
  ok(K.fingerHolding(), 'дольше — держит (ломать)');
  pe('pointermove', 3, 680, 330); ok(K.fingerHolding() && K.finger.x === 680, 'начал ломать — можно вести пальцем');
  E.tick(100); pe('pointerup', 3, 680, 330); ok(!K.finger && !K.taps.length, 'отпустил после удержания — не «поставить»');
  // сразу протянул — «осмотреться», не ломать
  pe('pointerdown', 4, 600, 300); pe('pointermove', 4, 640, 300); E.tick(500);
  ok(!K.fingerHolding(), 'протянул сразу — не ломает (камера)');
  pe('pointerup', 4, 640, 300); ok(!K.taps.length, 'и не «поставить»');
  pe('pointerup', 1, 100, 500);
  K.dispose();
}
// ═══ 6. Захват мыши — движок (js/engine/input.js) ═══
// Владелец 16.10: «на Esc пропадает управление мышью и кружок от мышки висит». Было: «Продолжить» и закрытие вещей захватывали
// мышь ХОЛСТОМ, а движок ждал захвата рамкой игры — курсор пропадал, камера не крутилась, прицел висел.
console.log('— захват мыши (движок)');
{
  const mk = () => { const m = new Map(); return { addEventListener: (ev, f) => { if (!m.has(ev)) m.set(ev, []); m.get(ev).push(f); }, removeEventListener: (ev, f) => { const a = m.get(ev) || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }, fire: (ev, e) => { for (const f of [...(m.get(ev) || [])]) f(e); } }; };
  const win = mk(), doc = mk(), wrap = mk(), canvas = mk();
  let refuse = false, asks = 0;
  const later = [];   // отказ браузера приходит не сразу (как в Chrome): событие и отклонённое обещание — потом
  doc.pointerLockElement = null;
  const lockTo = node => () => {
    asks++;
    if (refuse) { let cb = null; later.push(() => { doc.fire('pointerlockerror', {}); cb?.(new Error('refused')); }); return { catch(f){ cb = f; } }; }
    doc.pointerLockElement = node; doc.fire('pointerlockchange', {}); return { catch(){} };
  };
  wrap.requestPointerLock = lockTo(wrap); canvas.requestPointerLock = lockTo(canvas);
  wrap.contains = n => n === wrap || n === canvas;
  wrap.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
  wrap.setPointerCapture = () => {}; wrap.clientWidth = 800; wrap.appendChild = () => {};
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.fire('pointerlockchange', {}); };
  doc.createElement = () => ({ className: '', hidden: false, style: {}, appendChild(){}, remove(){} });
  const ctx = { console, Math, Map, Set, JSON, Array, Object, String, Number, Boolean, Promise, performance: { now: () => 1000 }, document: doc, D37E: { isTouch: () => false } };
  ctx.addEventListener = win.addEventListener; ctx.removeEventListener = win.removeEventListener; ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/input.js'), 'utf8'), ctx, { filename: 'input.js' });
  const btn = []; const C = { mouse: (b, d) => btn.push([b, d]), stick(){}, press(){} };
  const I = ctx.D37E.input(wrap, { controls: C });
  const click = () => { wrap.fire('pointerdown', { type: 'pointerdown', pointerType: 'mouse', pointerId: 1, button: 0, clientX: 400, clientY: 300, target: canvas, preventDefault(){} }); wrap.fire('pointerup', { type: 'pointerup', pointerType: 'mouse', pointerId: 1, button: 0, clientX: 400, clientY: 300, target: canvas }); };
  const pressed = () => btn.some(([b, d]) => b === 0 && d);
  canvas.requestPointerLock();
  ok(I.locked, 'мышь захвачена холстом внутри рамки — для движка это тоже «захвачено»');
  doc.fire('mousemove', { movementX: 15, movementY: -4 });
  ok(I.look.dx === 15 && I.look.dy === -4, 'камера крутится от мыши', I.look); I.frameEnd();
  I.unlock(); ok(!I.locked && !doc.pointerLockElement, 'I.unlock отпускает и захват холстом');
  I.wantLock = true; btn.length = 0; click();
  ok(I.locked && !pressed(), 'нажал на мир, чтобы вернуть мышь, — только захват (блок не ломается)', btn);
  btn.length = 0; click(); ok(pressed(), 'следующее нажатие — уже в игру');
  doc.exitPointerLock(); ok(!I.locked, 'Esc — мышь отпущена');
  refuse = true; btn.length = 0; const a0 = asks; click();
  ok(asks === a0 + 1 && !I.locked && !pressed(), 'браузер ещё не ответил — нажатие не в игру');
  later.splice(0).forEach(f => f()); ok(I.lockFail === true, 'браузер отказал в захвате — I.lockFail');
  btn.length = 0; click(); ok(pressed(), 'после отказа нажатия идут в игру (не «глотаются» вечно)');
  later.splice(0).forEach(f => f());
  refuse = false; I.lock(); ok(I.locked && I.lockFail === false, 'I.lock() — захват (кнопка «Продолжить»), отказ забыт');
  const a1 = asks; I.lock(); ok(asks === a1, 'уже захвачено — второй запрос не шлём');
  I.wantLock = false; doc.exitPointerLock(); btn.length = 0; click();
  ok(!I.locked && pressed(), 'вид не «от 1-го лица» (wantLock = false) — нажатие сразу в игру, без захвата');
  I.dispose();
}
console.log(`\nkubomir-input-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

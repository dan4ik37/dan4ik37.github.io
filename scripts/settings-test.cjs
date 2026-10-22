// Тесты окна «⚙️ Настройки» и полного экрана в node (без браузера — поддельные window / document / history):
// js/core/settings.js — значения по умолчанию, проверка значений, перенос старых ключей (d37_gfx, d37_fsr, d37_keys,
// d37_games_mute, d37_cam_*, d37_world_2d) и зеркало для движка, «на живую» (window.D37Opt, события, CSS-переменные),
// вкладки по месту (мир / игра / сайт), свои вкладки и значения; js/engine/controls.js — клавиши и конфликты, живые
// управления перечитывают клавиши; js/core/fullscreen.js — вход/выход, «как полный экран» (API нет или отказал), Esc,
// «Назад», браузер вышел сам, телефон лёжа (сам во весь экран и обратно), 🔄 поворот, смена элемента, gs-noesc;
// T-043: «⭐ Главное» по месту, поиск (слова, ё, окончания), «↺ Сбросить» вкладки, пункты меню «⛶ / 🔄» (fsItems / fsPick), меню без хвостов.
// Запуск из корня сайта: node scripts/settings-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const run = f => vm.runInThisContext(src(f), { filename: f });

// ═══ Поддельный браузер ═══
const store = {};
globalThis.localStorage = {
  getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
  clear(){ for (const k of Object.keys(store)) delete store[k]; },
};
const camel = s => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
class El {
  constructor(tag, doc){
    this.tagName = tag.toUpperCase(); this.doc = doc; this.children = []; this.parentElement = null; this.dataset = {}; this.attrs = {};
    this.style = { props: {}, setProperty(k, v){ this.props[k] = String(v); } }; this._c = new Set(); this.innerHTML = ''; this.id = ''; this.et = new EventTarget();
    const c = this._c;
    this.classList = { add: (...a) => a.forEach(x => c.add(x)), remove: (...a) => a.forEach(x => c.delete(x)), contains: x => c.has(x),
      toggle: (x, on) => { const v = on === undefined ? !c.has(x) : !!on; if (v) c.add(x); else c.delete(x); return v; } };
  }
  get className(){ return [...this._c].join(' '); }
  set className(v){ this._c.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => this._c.add(x)); }
  setAttribute(k, v){ this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
  getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k){ return k in this.attrs || (k.startsWith('data-') && camel(k.slice(5)) in this.dataset); }
  appendChild(ch){ ch.remove(); ch.parentElement = this; this.children.push(ch); return ch; }
  remove(){ const p = this.parentElement; if (p) { p.children = p.children.filter(x => x !== this); this.parentElement = null; } }
  contains(o){ for (let p = o; p; p = p.parentElement) if (p === this) return true; return false; }
  get isConnected(){ let p = this; while (p.parentElement) p = p.parentElement; return p === this.doc.documentElement; }
  matches(sel){ return sel.startsWith('.') ? this._c.has(sel.slice(1)) : sel.startsWith('#') ? this.id === sel.slice(1) : this.tagName === sel.toUpperCase(); }
  closest(sel){ for (let p = this; p; p = p.parentElement) if (p.matches(sel)) return p; return null; }
  querySelector(sel){ for (const ch of this.children) { if (ch.matches(sel)) return ch; const r = ch.querySelector(sel); if (r) return r; } return null; }
  querySelectorAll(sel){ const out = [], walk = n => { for (const ch of n.children) { if (ch.matches(sel)) out.push(ch); walk(ch); } }; walk(this); return out; }
  addEventListener(...a){ this.et.addEventListener(...a); } removeEventListener(...a){ this.et.removeEventListener(...a); } dispatchEvent(e){ return this.et.dispatchEvent(e); }
}
const FS = { mode: 'ok', calls: 0, exits: 0 };   // ok — браузер разрешает, reject — отказ, hang — ответа нет
const doc = { readyState: 'complete', visibilityState: 'visible', fullscreenEnabled: true, fullscreenElement: null, et: new EventTarget() };
doc.addEventListener = (...a) => doc.et.addEventListener(...a); doc.removeEventListener = (...a) => doc.et.removeEventListener(...a); doc.dispatchEvent = e => doc.et.dispatchEvent(e);
doc.createElement = t => new El(t, doc);
doc.documentElement = new El('html', doc); doc.head = new El('head', doc); doc.body = new El('body', doc);
doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
const meta = new El('meta', doc); meta.setAttribute('name', 'viewport'); meta.setAttribute('content', 'width=device-width, initial-scale=1.0'); doc.head.appendChild(meta);
doc.querySelector = sel => sel === 'meta[name="viewport"]' ? meta : doc.documentElement.querySelector(sel);
doc.querySelectorAll = sel => sel === '[data-gs-full]' ? doc.documentElement.querySelectorAll('.gs-btnfull') : doc.documentElement.querySelectorAll(sel);
doc.getElementById = id => doc.documentElement.querySelector('#' + id);
doc.documentElement.requestFullscreen = function (){
  FS.calls++;
  if (FS.mode === 'ok') return Promise.resolve().then(() => { doc.fullscreenElement = doc.documentElement; doc.dispatchEvent(new Event('fullscreenchange')); });
  if (FS.mode === 'reject') return Promise.reject(new Error('отказ'));
  return new Promise(() => {});
};
doc.exitFullscreen = () => { FS.exits++; return Promise.resolve().then(() => { doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); }); };
globalThis.document = doc;
// окно: события, размеры, matchMedia, история, экран, Wake Lock
const WET = new EventTarget();
globalThis.addEventListener = (...a) => WET.addEventListener(...a); globalThis.removeEventListener = (...a) => WET.removeEventListener(...a); globalThis.dispatchEvent = e => WET.dispatchEvent(e);
globalThis.window = globalThis;
globalThis.innerWidth = 1280; globalThis.innerHeight = 800;
let coarse = false;
globalThis.matchMedia = q => ({ matches: /coarse/.test(q) ? coarse : false });
globalThis.requestAnimationFrame = f => setTimeout(() => f(Date.now()), 0);
const H = { stack: [{ state: null }], i: 0, pushes: 0, backs: 0 };
globalThis.history = {
  get state(){ return H.stack[H.i].state; },
  pushState(s){ H.stack.length = H.i + 1; H.stack.push({ state: s }); H.i++; H.pushes++; },
  back(){ if (H.i > 0) { H.i--; H.backs++; setTimeout(() => globalThis.dispatchEvent(new Event('popstate')), 0); } },
};
globalThis.location = { href: 'http://localhost/#/games/world', hash: '#/games/world' };
const WAKE = { active: 0, req: 0 };
const ORI = { locked: null, unlocks: 0, can: true };
Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) node-test', platform: 'Linux', maxTouchPoints: 0,
  wakeLock: { request: async () => { WAKE.req++; WAKE.active++; let on = true; return { release(){ if (on) { on = false; WAKE.active--; } return Promise.resolve(); }, addEventListener(){} }; } },
} });
globalThis.screen = { orientation: { lock: async t => { if (!ORI.can) throw new Error('нельзя'); ORI.locked = t; }, unlock: () => { ORI.locked = null; ORI.unlocks++; } } };
const setSize = (w, h) => { globalThis.innerWidth = w; globalThis.innerHeight = h; globalThis.dispatchEvent(new Event('resize')); };
const key = (k, target) => { const e = new Event('keydown', { cancelable: true }); e.key = k; e.code = k; Object.defineProperty(e, 'target', { value: target || doc.body }); globalThis.dispatchEvent(e); return e; };

// ═══ Настройки: по умолчанию ═══
run('js/core/settings.js');
const S = globalThis.D37Settings;
{
  ok(S && typeof S.get === 'function', 'D37Settings загрузился');
  const def = { gfx: 'auto', fsr: 'auto', shadows: true, fps: false, world2d: false, mute: false, vol: 100, volFx: 100, volAmb: 100, volVoice: 100,
    sens: 1, invertY: false, touchSize: 100, touchAlpha: 100, lefty: false, view: 'third', fov: 50, motion: 1, shake: true, uiScale: 100, tags: true, bubbles: true, autoFull: false, autoLand: true };
  for (const [k, v] of Object.entries(def)) ok(S.get(k) === v, 'по умолчанию ' + k, S.get(k));
  ok(JSON.stringify(S.get('keys')) === '{}', 'по умолчанию клавиши — свои не заданы');
  ok(!('d37_gfx' in store) && !('d37_keys' in store) && !('d37_games_mute' in store), 'без правок старые ключи не появляются');
  ok(JSON.parse(store.d37_settings)._v === 1, 'хранилище d37_settings создано');
  const O = globalThis.D37Opt;
  ok(O && O.sens === 1 && O.vol === 1 && O.volFx === 1 && O.fovAdd === 0 && O.shake === true && O.fsr === 'auto' && O.lefty === false, 'D37Opt для движка — по умолчанию', O);
  ok(doc.documentElement.style.props['--gs-touch'] === '1' && doc.documentElement.style.props['--gs-ui'] === '1', 'CSS-переменные по умолчанию');
  ok(S.get('нет такого') === undefined && S.set('нет такого', 1) === false, 'неизвестное значение — не трогаем');
  ok(S.sfxGain() === 1, 'громкость звуков игр по умолчанию — 1');
}

// ═══ Настройки: запись, проверка значений, зеркало старых ключей, события ═══
{
  const got = [], wev = [];
  const off = S.on(d => got.push(d));
  const wl = e => wev.push(e.detail);
  globalThis.addEventListener('d37:settings', wl);
  const rev0 = globalThis.D37Opt.rev;
  S.set('gfx', 'low'); ok(store.d37_gfx === 'low' && S.get('gfx') === 'low', 'качество → d37_gfx');
  S.set('gfx', 'auto'); ok(!('d37_gfx' in store) && S.get('gfx') === 'auto', '«авто» — старый ключ убран (движок сам выберет)');
  S.set('gfx', 'ультра'); ok(S.get('gfx') === 'auto', 'чужое значение списка — по умолчанию');
  S.set('fsr', 'balanced'); ok(store.d37_fsr === 'balanced' && globalThis.D37Opt.fsr === 'balanced', 'FSR → d37_fsr и D37Opt');
  S.set('fsr', 'native'); ok(store.d37_fsr === 'native', 'FSR 100% (native)');
  S.set('fsr', 'auto'); ok(!('d37_fsr' in store), 'FSR авто — ключ убран');
  S.set('mute', true); ok(store.d37_games_mute === '1' && globalThis.D37Opt.mute === true && S.sfxGain() === 0, 'звук выкл → d37_games_mute = 1, тишина');
  S.set('mute', false); ok(!('d37_games_mute' in store) && S.sfxGain() === 1, 'звук вкл');
  S.set('vol', 50); S.set('volFx', 50); ok(Math.abs(S.sfxGain() - .25) < 1e-9, 'общая × эффекты = 0,25', S.sfxGain());
  S.set('vol', 999); ok(S.get('vol') === 100, 'громкость не больше 100');
  S.set('vol', -5); ok(S.get('vol') === 0, 'громкость не меньше 0');
  S.set('vol', 'abc'); ok(S.get('vol') === 100, 'не число — по умолчанию');
  S.set('vol', 100); S.set('volFx', 100);
  S.set('sens', 5); ok(S.get('sens') === 3 && store.d37_cam_sens === '3', 'чувствительность не больше 3 → d37_cam_sens');
  S.set('sens', 1); ok(!('d37_cam_sens' in store), 'чувствительность 1 — ключ убран');
  S.set('motion', .35); ok(store.d37_cam_motion === '0.35' && globalThis.D37Opt.motion === .35, 'покачивание → d37_cam_motion');
  S.set('motion', 1);
  S.set('fov', 70); ok(globalThis.D37Opt.fovAdd === 20, 'угол обзора 70° → fovAdd 20');
  S.set('fov', 10); ok(S.get('fov') === 40, 'угол обзора не меньше 40');
  S.set('fov', 50);
  S.set('view', 'сверху'); ok(S.get('view') === 'third', 'вид: только 1-е / 3-е лицо');
  ok(S.get('zoomFirst') === true && globalThis.D37Opt.zoomFirst === true, '«Приблизил до упора — от 1-го лица» — включено по умолчанию (D37Opt.zoomFirst)');
  S.set('zoomFirst', false); ok(globalThis.D37Opt.zoomFirst === false, '…выключил — камера (camera.js) больше не переключает'); S.set('zoomFirst', true);
  S.set('invertY', 'true'); ok(S.get('invertY') === true && globalThis.D37Opt.invertY === true, 'инверсия: строка "true" — да');
  S.set('invertY', false);
  S.set('world2d', true); ok(store.d37_world_2d === '1', 'плоский мир → d37_world_2d');
  S.set('world2d', false); ok(!('d37_world_2d' in store), 'плоский мир выкл — ключ убран');
  S.set('touchSize', 130); S.set('touchAlpha', 60); S.set('uiScale', 120);
  ok(doc.documentElement.style.props['--gs-touch'] === '1.3' && doc.documentElement.style.props['--gs-touch-a'] === '0.6' && doc.documentElement.style.props['--gs-ui'] === '1.2', 'кнопки телефона и масштаб — CSS-переменные');
  S.set('lefty', true); S.set('tags', false); S.set('bubbles', false);
  ok(doc.documentElement.classList.contains('gs-lefty') && doc.documentElement.classList.contains('gs-notags') && doc.documentElement.classList.contains('gs-nobub'), 'левша, без ников, без облачков — классы html');
  ok(globalThis.D37Opt.lefty === true, 'левша — в D37Opt (джойстик справа, input.js)');
  ok(globalThis.D37Opt.rev > rev0, 'D37Opt.rev растёт — движок видит правку');
  const n = got.length;
  S.set('lefty', true); ok(got.length === n, 'то же значение — без события');
  S.set('lefty', false);
  ok(got.length === n + 1 && got[n].key === 'lefty' && got[n].value === false && got[n].old === true, 'событие: ключ, новое и старое значение', got[n]);
  ok(wev.length === got.length && wev[wev.length - 1].key === 'lefty', 'событие window d37:settings');
  off(); S.set('tags', true); ok(got.length === n + 1, 'отписка работает');
  globalThis.removeEventListener('d37:settings', wl);
  // сброс
  S.set('gfx', 'high'); S.set('mute', true); S.set('sens', 2);
  const all = []; const off2 = S.on(d => all.push(d.key));
  S.reset();
  ok(S.get('gfx') === 'auto' && S.get('mute') === false && S.get('sens') === 1 && S.get('touchSize') === 100 && S.get('bubbles') === true, 'сброс — всё как было');
  ok(!('d37_gfx' in store) && !('d37_games_mute' in store) && !('d37_cam_sens' in store), 'сброс убирает старые ключи');
  ok(all.includes('*'), 'сброс — событие «*»');
  off2();
}

// ═══ Перенос старых ключей (первый заход с окном настроек) ═══
{
  localStorage.clear();
  Object.assign(store, { d37_gfx: 'high', d37_fsr: 'performance', d37_games_mute: '1', d37_keys: JSON.stringify({ jump: ['KeyJ', ''] }), d37_cam_sens: '1.5', d37_cam_motion: '0.3', d37_world_2d: '1' });
  delete globalThis.D37Settings; delete globalThis.D37Opt;
  run('js/core/settings.js');
  const S2 = globalThis.D37Settings, d = JSON.parse(store.d37_settings);
  ok(d.gfx === 'high' && d.fsr === 'performance' && d.mute === true && d.sens === 1.5 && d.motion === .3 && d.world2d === true, 'старые ключи перенесены в d37_settings', d);
  ok(d.keys && d.keys.jump && d.keys.jump[0] === 'KeyJ', 'клавиши перенесены');
  ok(S2.get('gfx') === 'high' && S2.get('fsr') === 'performance' && S2.get('mute') === true && S2.get('world2d') === true, 'get — перенесённые значения');
  ok(store.d37_gfx === 'high' && store.d37_games_mute === '1', 'старые ключи остались — их читает движок');
  ok(globalThis.D37Opt.fsr === 'performance' && globalThis.D37Opt.mute === true && globalThis.D37Opt.sens === 1.5, 'D37Opt — из перенесённых');
  // кто-то по-старому пишет старый ключ (мир 2D, кнопка 🔊) — верим ему
  store.d37_world_2d = '0'; ok(S2.get('world2d') === false, 'старый ключ поменяли мимо окна — get видит');
  store.d37_games_mute = 'мусор'; ok(S2.get('mute') === true, 'мусор в старом ключе — берём из хранилища');
  // зеркало пропало — вернётся при загрузке
  localStorage.clear();
  store.d37_settings = JSON.stringify({ _v: 1, gfx: 'mid', sens: 2 });
  delete globalThis.D37Settings;
  run('js/core/settings.js');
  ok(store.d37_gfx === 'mid' && store.d37_cam_sens === '2', 'нет старого ключа — восстановлен из d37_settings (зеркало для движка)');
  ok(globalThis.D37Settings.get('gfx') === 'mid', 'и get — то же');
  localStorage.clear();
  delete globalThis.D37Settings;
  run('js/core/settings.js');
}
const ST = globalThis.D37Settings;

// ═══ Вкладки по месту, свои вкладки и значения ═══
{
  const t = ST._test.tabsFor;
  ok(t('engine').join() === 'main,gfx,sound,controls,camera,ui,site', 'в 3D-мире — «⭐ Главное» первой, потом все вкладки', t('engine'));
  ok(t('game').join() === 'main,sound,ui,site', 'в обычной игре — главное, звук, интерфейс, сайт', t('game'));
  ok(t('site').length === 7 && t('site')[0] === 'main', 'из меню сайта — все вкладки, первая — «Главное»');
  ST.addTab({ id: 'phone', icon: '📱', title: 'Телефон', order: 60, ctx: ['game', 'site'], render: () => '' });
  ok(t('game').join() === 'main,sound,ui,phone,site' && !t('engine').includes('phone'), 'своя вкладка — по порядку и по месту', t('game'));
  ST.addTab({ id: 'bad' }); ok(!t('site').includes('bad'), 'вкладка без render не добавляется');
  ST.define('ringVol', { def: 80, min: 0, max: 100 });
  ok(ST.get('ringVol') === 80, 'своё значение — по умолчанию');
  ST.set('ringVol', 150); ok(ST.get('ringVol') === 100, 'своё значение — проверяется по описанию');
  ST.define('gfx', { def: 'x', list: ['x'] }); ok(ST.get('gfx') === 'auto', 'define не перезаписывает встроенное');
}

// ═══ T-043: «⭐ Главное», поиск, «↺ Сбросить» вкладки ═══
{
  const T = ST._test;
  // «Главное»: самое нужное по месту (качество и шейдеры добавляет gfx-settings.js — здесь его нет)
  ok(T.mainFor('engine').join() === 'sens,vol,view', '«Главное» в 3D-мире: чувствительность, громкость, вид', T.mainFor('engine'));
  ok(T.mainFor('game').join() === 'vol,ui', '«Главное» в обычной игре: громкость, размер кнопок (3D-настроек нет)', T.mainFor('game'));
  ok(T.mainFor('site').join() === 'sens,vol,view,perf', '«Главное» из меню сайта: + режим сайта', T.mainFor('site'));
  ST.addMain({ id: 'x1', order: 5, ctx: ['engine'], html: () => '<div class="gs-row">x</div>' });
  ok(T.mainFor('engine')[0] === 'x1' && !T.mainFor('game').includes('x1'), 'addMain — своя строка по порядку и по месту');
  ST.addMain({ id: 'x2', order: 99, when: c => c === 'site', html: () => '' });
  ok(T.mainFor('site').includes('x2') && !T.mainFor('engine').includes('x2'), 'addMain: when(cx) — показывать ли сейчас');
  ok(ST.addMain({ id: 'bad' }) === ST && !T.mainFor('site').includes('bad'), 'addMain без html — не добавляется');
  // поиск: все слова, «ё» = «е», окончания не важны (до 2 букв, слово не короче 3)
  const tx = T.norm('Тени — выключи, если 3D тормозит. Громкость звуков, ёлка «Шейдеры»');
  ok(T.matchText(tx, ['тени']) && T.matchText(tx, ['теней']) && T.matchText(tx, ['громк']) && T.matchText(tx, ['звука']), 'поиск: «теней» → тени, «звука» → звуков, «громк» → громкость');
  ok(T.matchText(tx, ['елка']) && T.matchText(tx, ['шейдеры', 'тормозит']), 'поиск: ё = е, несколько слов — все');
  ok(!T.matchText(tx, ['тени', 'клавиши']) && !T.matchText(tx, ['zzz']) && !T.matchText(tx, ['тк']), 'поиск: нет слова — не найдено (короткое не обрезаем)');
  ok(!T.matchText(T.norm('Имена игроков. Гроза и град'), ['громк']) && T.matchText(T.norm('Кнопки на экране'), ['кнопок']) && T.matchText(T.norm('Размер кнопок'), ['кнопки']) && T.matchText(T.norm('Тени'), ['тень']), 'поиск: «громк» не находит «игроков» и «гроза»; «кнопок» ↔ «кнопки», «тень» → Тени');
  ok(T.matchText(T.norm('Счётчик кадров (FPS)'), ['fps']) && !T.matchText(T.norm('техник'), ['ник']), 'поиск: короткое слово — с начала слова (fps да, «ник» в «техник» — нет)');
  ok(T.norm('«Сбросить»: всё!') === ' сбросить  все ', 'поиск: кавычки и знаки — пробелы', T.norm('«Сбросить»: всё!'));
  // сброс вкладки: только её значения, старые ключи-зеркала — тоже, событие «*» со списком
  ok(T.tabKeys('sound').join() === 'mute,vol,volFx,volAmb,volVoice' && T.tabKeys('camera').includes('fov') && T.tabKeys('controls').includes('keys') && T.tabKeys('site').length === 0, 'у вкладок — свои значения для «↺ Сбросить»');
  ST.set('mute', true); ST.set('vol', 30); ST.set('volVoice', 40); ST.set('fov', 70); ST.set('sens', 2);
  const evs = []; const off = ST.on(d => evs.push(d));
  const done = ST.resetKeys(T.tabKeys('sound'));
  ok(done.length === 5 && ST.get('mute') === false && ST.get('vol') === 100 && ST.get('volVoice') === 100 && !('d37_games_mute' in store), '«↺ Сбросить «Звук»» — звук как было (и d37_games_mute убран)');
  ok(ST.get('fov') === 70 && ST.get('sens') === 2 && store.d37_cam_sens === '2', '…а камера и управление — не тронуты');
  ok(evs.length === 1 && evs[0].key === '*' && evs[0].keys.join() === 'mute,vol,volFx,volAmb,volVoice', 'событие «*» со списком сброшенного (games.js 🔊 ловит «*»)', evs[0]);
  ok(globalThis.D37Opt.vol === 1 && globalThis.D37Opt.mute === false, 'D37Opt — сразу (движок видит)');
  ST.set('keys', { jump: ['KeyK', 'Pad0'] }); const kr = globalThis.D37Opt.keysRev;
  ST.resetKeys(T.tabKeys('controls'));
  ok(ST.get('sens') === 1 && !('d37_cam_sens' in store) && !('d37_keys' in store) && globalThis.D37Opt.keysRev > kr, '«↺ Сбросить «Управление»» — чувствительность и клавиши (живые управления перечитают)');
  ST.resetKeys(['fov', 'нет такого']); ok(ST.get('fov') === 50, 'resetKeys: неизвестное — пропускает');
  const ne = evs.length; ok(ST.resetKeys([]).length === 0 && evs.length === ne, 'пустой список — без события');
  off();
}

// ═══ Клавиши: controls.js + окно (конфликты, живые управления перечитывают) ═══
{
  run('js/engine/controls.js');
  const E = globalThis.D37E;
  const live = E.controls({ listen: false }), edit = E.controls({ listen: false });
  ok(live.get('jump') === 'Space' && edit.conflicts().length === 0, 'клавиши по умолчанию без конфликтов');
  edit.set('jump', 0, 'KeyE');
  const cf = edit.conflicts();
  ok(cf.length === 1 && cf[0].code === 'KeyE' && cf[0].actions.includes('jump') && cf[0].actions.includes('interact'), 'E у прыжка и действия — конфликт виден', cf);
  ok(cf[0].name === 'E', 'имя клавиши для подсказки');
  const kr = globalThis.D37Opt.keysRev;
  ST.keysChanged();
  ok(globalThis.D37Opt.keysRev === kr + 1, 'окно сказало движку: клавиши поменялись');
  ok(JSON.parse(store.d37_settings).keys.jump[0] === 'KeyE', 'клавиши — и в d37_settings');
  ok(live.get('jump') === 'Space', 'до шага живое управление ещё со старой');
  live.step(1 / 60);
  ok(live.get('jump') === 'KeyE', 'живое управление перечитало клавиши на шаге');
  live.key('KeyE', true); live.step(1 / 60);
  ok(live.down('jump') && live.down('interact'), 'обе по E (конфликт — поэтому окно и предупреждает)');
  live.key('KeyE', false); live.step(1 / 60);
  edit.set('jump', 1, ''); ok(edit.get('jump', 1) === '', 'запасную клавишу можно убрать (Backspace)');
  ok(edit.set('pause', 0, 'KeyP') === false && edit.get('pause') === 'Escape', 'Esc (пауза) не переназначается');
  edit.reset('jump'); ST.keysChanged(); live.step(1 / 60);
  ok(live.get('jump') === 'Space' && live.get('jump', 1) === 'Pad0' && edit.conflicts().length === 0, '↺ — как было, и у живого');
  edit.set('emote', 0, 'KeyG'); edit.resetAll(); ST.keysChanged(); live.step(1 / 60);
  ok(live.get('emote') === 'KeyT', '«Все клавиши как были»');
  ST.set('keys', { jump: ['KeyK', 'Pad0'] }); live.step(1 / 60);
  ok(store.d37_keys && JSON.parse(store.d37_keys).jump[0] === 'KeyK' && live.get('jump') === 'KeyK', 'set(keys) — пишет d37_keys, живые перечитывают');
  ST.set('keys', {}); live.step(1 / 60);
  ok(live.get('jump') === 'Space', 'пустые клавиши — по умолчанию');
  ST.set('keys', { jump: 'KeyK', 'плохо!': ['A'] });
  ok(JSON.stringify(ST.get('keys')) === '{}', 'клавиши — только «действие: [2 строки]»');
}

// ═══ Полный экран ═══
(async () => {
  run('js/core/fullscreen.js');
  const F = globalThis.D37Full;
  ok(F && typeof F.enter === 'function', 'D37Full загрузился');
  // разметка: сайт → страница игр (с transform) → сцена игры
  const page = new El('div', doc); page.id = 'games-page'; page.className = 'wrap reveal'; doc.body.appendChild(page);
  const stage = new El('div', doc); stage.id = 'gamesStage'; page.appendChild(stage);
  const box = new El('div', doc); box.id = 'gamesStageBox'; stage.appendChild(box);
  const btn = new El('button', doc); btn.className = 'gs-btnfull'; btn.dataset.gsFull = '#gamesStage'; stage.appendChild(btn);
  const evs = []; globalThis.addEventListener('d37:fullscreen', e => evs.push(e.detail));
  const html = doc.documentElement;

  // 1. браузер разрешает (Fullscreen API)
  FS.mode = 'ok';
  const p = F.enter(stage);
  ok(html.classList.contains('gs-full') && stage.classList.contains('gs-fs'), 'вход: классы сразу');
  ok(page.classList.contains('gs-anc') && doc.body.classList.contains('gs-anc') === false, 'предки (до body) без transform — .gs-anc');
  ok(/viewport-fit=cover/.test(meta.getAttribute('content')), 'viewport-fit=cover на время полного экрана');
  ok(FS.calls === 1, 'API позвали один раз');
  ok(H.pushes === 1 && globalThis.history.state && globalThis.history.state.gsFull, 'запись в истории для «Назад»');
  await p; await tick(5);
  ok(F.state().mode === 'api', 'режим api после ответа браузера', F.state().mode);
  ok(WAKE.active === 1, 'экран не гаснет (Wake Lock)');
  ok(evs.length >= 1 && evs[0].on === true && evs[0].el === stage, 'событие d37:fullscreen — вход');
  ok(btn.getAttribute('aria-pressed') === 'true' && btn.title.includes('Выйти'), 'кнопка ⛶ сама показывает «выйти»');
  F.exit(); await tick(10);
  ok(!html.classList.contains('gs-full') && !stage.classList.contains('gs-fs') && !page.classList.contains('gs-anc'), 'выход: классы убраны');
  ok(FS.exits === 1 && doc.fullscreenElement === null, 'выход из API браузера');
  ok(meta.getAttribute('content') === 'width=device-width, initial-scale=1.0', 'meta viewport — как было');
  ok(H.backs === 1 && H.i === 0 && !globalThis.history.state, 'своя запись истории убрана (назад)');
  ok(!F.state().el, 'после popstate от своей «назад» снова не вошли');
  ok(WAKE.active === 0, 'Wake Lock отпущен');
  ok(evs[evs.length - 1].on === false && btn.getAttribute('aria-pressed') === 'false', 'событие — выход, кнопка ⛶ снова «во весь экран»');

  // 2. браузер отказал — «как полный экран»; Esc выходит
  FS.mode = 'reject';
  await F.enter(stage); await tick(5);
  ok(F.state().el === stage && F.state().mode === 'pseudo', 'отказ браузера — «как полный экран» (pseudo)');
  const e1 = key('Escape');
  ok(!F.state().el, 'Esc выходит из «как полный экран»');
  await tick(5);
  // 3. ответа нет вовсе — «Назад» всё равно выходит
  FS.mode = 'hang';
  F.enter(stage); await tick(5);
  ok(F.state().mode === 'pseudo' && H.i === 1, 'ответа API нет — режим pseudo, запись истории есть');
  globalThis.history.back(); await tick(10);
  ok(!F.state().el && !html.classList.contains('gs-full'), '«Назад» на телефоне — выход из полного экрана, игра остаётся');
  ok(globalThis.location.hash === '#/games/world', 'адрес не менялся');

  // 4. API нет (iPhone): сразу pseudo, своя кнопка выхода поверх
  doc.fullscreenEnabled = false; const rq = doc.documentElement.requestFullscreen; doc.documentElement.requestFullscreen = undefined;
  const calls0 = FS.calls;
  await F.enter(stage, { exitBtn: true }); await tick(5);
  ok(F.state().mode === 'pseudo' && FS.calls === calls0, 'API нет — без запроса, сразу pseudo');
  ok(stage.querySelector('.gs-exit'), 'кнопка выхода поверх игры (exitBtn)');
  ok(!F.supported(), 'supported() — нет');
  F.exit(); await tick(10);
  ok(!stage.querySelector('.gs-exit'), 'кнопка выхода убрана');
  // Esc внутри .gs-noesc («Мир» — Esc для меню) не выходит
  const mir = new El('div', doc); mir.className = 'wld mir gs-noesc'; box.appendChild(mir);
  await F.enter(stage); await tick(5);
  key('Escape'); ok(F.state().el === stage, 'в «Мире» (gs-noesc) Esc не выходит из полного экрана');
  const ev = new Event('keydown', { cancelable: true }); ev.key = 'Escape'; ev.preventDefault();
  mir.remove(); globalThis.dispatchEvent(ev); ok(F.state().el === stage, 'Esc, который уже забрал кто-то (preventDefault), — не выходит');
  F.exit(); await tick(10);
  doc.fullscreenEnabled = true; doc.documentElement.requestFullscreen = rq;

  // 5. браузер вышел сам (Esc / жест) — выходим и мы
  FS.mode = 'ok';
  await F.enter(stage); await tick(5);
  ok(F.state().mode === 'api', 'снова api');
  doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); await tick(10);
  ok(!F.state().el && !html.classList.contains('gs-full'), 'браузер вышел сам — CSS тоже снят');

  // 6. телефон лёжа: открытая игра сама во весь экран (без API — поворот не нажатие)
  coarse = true; setSize(412, 915);
  const calls1 = FS.calls;
  F.auto(stage);
  ok(!F.state().el, 'телефон стоя — игра не во весь экран');
  setSize(915, 412);
  ok(F.state().el === stage && F.state().auto && F.state().mode === 'pseudo', 'положили телефон — сама во весь экран (auto)');
  ok(FS.calls === calls1, 'при повороте API не зовём (браузер бы отказал)');
  ok(html.classList.contains('gs-compact') && F.state().compact, 'низкий экран лёжа — gs-compact');
  ok(H.i === 0, 'авто — без записи в истории');
  key('Escape'); ok(F.state().el === stage, 'авто: Esc не выходит (вышел бы — сам бы вернулся)');
  setSize(412, 915);
  ok(!F.state().el && !html.classList.contains('gs-compact'), 'поставили телефон — обратно сайт');
  setSize(915, 412); ok(F.state().auto, 'снова лёжа — снова во весь экран');
  // нажал ⛶ в авто-режиме, а браузер умеет полный экран — убрать и его панели (а не выйти)
  await F.toggle(stage); await tick(5);
  ok(F.state().el === stage && !F.state().auto && F.state().mode === 'api', '⛶ в авто — настоящий полный экран (не выход)');
  setSize(412, 915); ok(F.state().el === stage, 'сам включил — поворот не выключает');
  F.toggle(stage); await tick(10);
  ok(!F.state().el, '⛶ — выход');
  // iPhone: в авто ⛶ выходит, и до следующего поворота не возвращаемся
  doc.fullscreenEnabled = false;
  setSize(915, 412); ok(F.state().auto, 'лёжа — авто');
  F.toggle(stage); ok(!F.state().el && F.state().autoOff, 'вышел сам — авто отключено до поворота');
  setSize(916, 412); ok(!F.state().el, 'лёжа дальше — не возвращаемся');
  setSize(412, 915); setSize(915, 412); ok(F.state().auto, 'повернул туда-обратно — снова авто');
  F.exit(); doc.fullscreenEnabled = true;
  setSize(412, 915);
  // настройка «Повернул телефон — игра на весь экран» выключена
  ST.set('autoLand', false); setSize(915, 412); ok(!F.state().el, 'настройка autoLand выкл — лёжа не во весь экран');
  ST.set('autoLand', true); setSize(412, 915);
  // игру закрыли — авто больше не ждёт
  F.auto(null); setSize(915, 412); ok(!F.state().el, 'игра закрыта — поворот ничего не делает');
  setSize(412, 915);
  // планшет (низ экрана > 600) — не телефон
  F.auto(stage); setSize(1180, 820); ok(!F.state().el, 'планшет лёжа — не во весь экран сам');
  F.auto(null); setSize(412, 915);

  // 7. 🔄 поворот: полный экран + альбомная ориентация
  FS.mode = 'ok'; ORI.can = true;
  const okLock = await F.rotate(stage); await tick(5);
  ok(okLock && ORI.locked === 'landscape' && F.state().locked && F.state().mode === 'api', '🔄 — полный экран и поворот закреплён (Android)');
  F.exit(); await tick(10);
  ok(ORI.locked === null && ORI.unlocks >= 1, 'выход — поворот отпущен');
  // нельзя закрепить (iPhone) — подсказка «Поверни телефон»
  ORI.can = false; doc.fullscreenEnabled = false;
  await F.rotate(stage); await tick(5);
  ok(F.state().el === stage && doc.getElementById('gsRotHint'), 'нет поворота — подсказка «Поверни телефон»');
  setSize(915, 412); ok(!doc.getElementById('gsRotHint'), 'повернул — подсказка исчезла');
  ok(F.state().el === stage && !F.state().auto, 'и игра во весь экран (сам нажал 🔄)');
  F.exit(); await tick(10); setSize(412, 915);
  doc.fullscreenEnabled = true; ORI.can = true;
  // браузер не отвечает на запрос полного экрана — через 1,5 с всё равно поворот / подсказка
  FS.mode = 'hang'; ORI.can = false;
  const t0 = Date.now(); await F.rotate(stage);
  ok(Date.now() - t0 < 2500 && doc.getElementById('gsRotHint'), 'нет ответа API — подсказка через 1,5 с (не ждём вечно)');
  F.exit(); await tick(10); FS.mode = 'ok'; ORI.can = true; coarse = false;

  // 8. смена элемента и release
  const other = new El('div', doc); other.className = 'un-box'; box.appendChild(other);
  await F.enter(stage); await tick(5);
  await F.enter(other, { exitBtn: true }); await tick(5);
  ok(!stage.classList.contains('gs-fs') && other.classList.contains('gs-fs') && F.state().el === other, 'другой элемент — полный экран переехал');
  ok(other.querySelector('.gs-exit'), 'у Unity-окна — кнопка выхода');
  F.release(stage); await tick(10);
  ok(!F.state().el && !html.classList.contains('gs-full'), 'игру закрыли (release по сцене) — выход, даже если во весь экран её часть');
  await F.enter(stage); F.release(other); ok(F.state().el === stage, 'release чужого элемента не трогает');
  F.exit(); await tick(10);
  // игру закрывают переходом (студия: ← → #/games) — «назад» звать нельзя: он отменил бы переход
  await F.enter(stage); await tick(5);
  const backs0 = H.backs, depth0 = H.i;
  F.release(stage); globalThis.history.pushState(null, '', '#/games'); await tick(10);
  ok(H.backs === backs0 && H.i === depth0 + 1 && !F.state().el, 'release — без «назад» (переход игры не отменяется)');
  globalThis.history.back(); await tick(10);
  ok(!F.state().el, '«Назад» на старую запись полного экрана — ничего не включает');
  ok(F.contains(stage) === false, 'contains — после выхода нет');

  // 9а. T-043: меню игр — пункты экрана одинаковые (fsItems / fsPick), меню закрывается без хвостов (подписка на полный экран)
  {
    coarse = false; setSize(1280, 800);
    let it = ST.fsItems(stage);
    ok(it.length === 1 && it[0].id === 'full' && it[0].text === 'Во весь экран' && /<svg/.test(it[0].icon), 'компьютер: «⛶ Во весь экран» (без «Повернуть»)', it.map(x => x.id));
    coarse = true; setSize(412, 915);
    it = ST.fsItems(stage);
    ok(it.map(x => x.id).join() === 'full,rot' && it[1].text === 'Повернуть экран', 'телефон стоя: + «🔄 Повернуть экран»', it.map(x => x.id));
    setSize(915, 412); F.exit(); await tick(10);
    ok(ST.fsItems(stage).length === 1, 'телефон лёжа — «Повернуть» не нужен');
    setSize(412, 915); coarse = false; setSize(1280, 800);
    ok(ST.fsPick('settings', stage, null) === false && ST.fsPick('full', null, null) === false, 'fsPick: чужой пункт — не его (false)');
    FS.mode = 'ok';
    const m = { el: { isConnected: true }, redraws: 0, closes: 0, redraw(){ this.redraws++; }, close(){ this.closes++; } };
    ok(ST.fsPick('full', stage, m) === true, 'fsPick(«⛶») — сделано');
    await tick(150);
    ok(F.state().el === stage && m.redraws === 1 && m.closes === 0, '«⛶»: во весь экран, меню остаётся и перерисовано («Обычный экран»)');
    ok(ST.fsItems(stage)[0].text === 'Обычный экран', 'пункт — «Обычный экран»');
    ST.fsPick('full', stage, m); await tick(150);
    ok(!F.state().el, '«⛶» ещё раз — обычный экран');
    ORI.can = true;
    ok(ST.fsPick('rot', stage, m) === true, 'fsPick(«🔄») — сделано');
    await tick(50);
    ok(m.closes === 1 && F.state().el === stage, '«🔄»: полный экран и поворот, меню закрыто (играть лёжа)');
    F.exit(); await tick(10);
    // меню: открыть / закрыть — в списке открытых и в подписках полного экрана не остаётся
    const host = new El('div', doc); doc.body.appendChild(host);
    const n0 = ST._test.menus();
    let closes = 0;
    for (let i = 0; i < 20; i++) {
      const mm = ST.menu(host, { title: 'Т', items: () => [{ id: 'resume', text: 'Продолжить' }, ...ST.fsItems(stage)], onPick: () => {}, onClose: () => closes++ });
      ok(i || (ST._test.menus() === n0 + 1 && host.children.length === 1), 'меню открыто — одно в списке открытых');
      mm.close(); mm.close();
    }
    ok(ST._test.menus() === n0 && host.children.length === 0 && closes === 20, '20 открытий/закрытий: меню не копятся, onClose — по разу', { menus: ST._test.menus(), kids: host.children.length, closes });
    // полный экран поменялся — подписок от закрытых меню нет (иначе каждая звала бы draw() у удалённого меню)
    let draws = 0; const mm2 = ST.menu(host, { title: 'Т', items: () => { draws++; return []; } });
    const d0 = draws; await F.enter(stage); await tick(5);
    ok(draws > d0, 'открытое меню перерисовывается при смене полного экрана', { d0, draws });
    mm2.close(); const d1 = draws; F.exit(); await tick(10);
    ok(draws === d1, 'закрытое меню — больше не перерисовывается (подписка снята)');
    host.remove();
  }

  // 9. html кнопки ⛶
  const b1 = F.btn('#gamesStage', { cls: 'x', esc: false, label: 'Во весь экран' });
  ok(/data-gs-full="#gamesStage"/.test(b1) && /data-gs-esc="0"/.test(b1) && /aria-pressed="false"/.test(b1) && /<svg/.test(b1), 'D37Full.btn — разметка кнопки');
  ok(/data-gs-rot="#gamesStage"/.test(F.rotBtn('#gamesStage')), 'D37Full.rotBtn — разметка 🔄');

  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

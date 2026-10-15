// Тесты «игры поверх мира» (js/games/mir-play.js) в node, без браузера: свой маленький DOM, история, адрес, таймеры.
// Проверяется: куда ведут переходы игры (decide), окно: открыть → партия → итог (полоска, отсчёт) → в мир / ещё партию /
// соперник начал новую; переходы игры через «роутер» (hashchange) и ссылки, «Назад», запасной путь (игра не открылась),
// «↩ В мир» на странице игры (d37_from_world), 10 открытий/закрытий без утечек; из js/games/mir.js — правила бездействия
// (afkDue: пока играешь поверх мира, из мира не выводит) и стола (tableState: «идёт партия» / «это и моя партия»).
// Запуск из корня сайта: node scripts/mirplay-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ═══ Маленький DOM ═══
const camel = s => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
function simple(n, s){
  const m = /^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?(?:#([\w-]+))?$/i.exec(s);
  if (!m) throw new Error('селектор не поддержан: ' + s);
  if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
  if (m[2]) for (const c of m[2].split('.').filter(Boolean)) if (!n.classList.contains(c)) return false;
  if (m[3] && !n.hasAttribute(m[3])) return false;
  if (m[3] && m[4] !== undefined && n.getAttribute(m[3]) !== m[4]) return false;
  if (m[5] && n.id !== m[5]) return false;
  return true;
}
class El {
  constructor(tag){
    this.tagName = String(tag || '').toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.ls = []; this.style = {};
    this.dataset = {}; this._text = ''; this._html = ''; this.hidden = false; this.disabled = false; this.className = '';
    const me = this;
    this.classList = {
      add: (...c) => { const s = new Set(me.className.split(/\s+/).filter(Boolean)); c.forEach(x => s.add(x)); me.className = [...s].join(' '); },
      remove: (...c) => { me.className = me.className.split(/\s+/).filter(x => x && !c.includes(x)).join(' '); },
      contains: c => me.className.split(/\s+/).includes(c),
      toggle: (c, f) => { const on = f === undefined ? !me.classList.contains(c) : !!f; if (on) me.classList.add(c); else me.classList.remove(c); return on; },
    };
  }
  get id(){ return this.attrs.id || ''; } set id(v){ this.attrs.id = String(v); }
  setAttribute(k, v){ this.attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[camel(k.slice(5))] = String(v); }
  getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; }
  hasAttribute(k){ return k in this.attrs; }
  appendChild(n){ n.remove(); n.parentNode = this; this.children.push(n); return n; }
  append(...ns){ ns.forEach(n => this.appendChild(n)); }
  prepend(n){ n.remove(); n.parentNode = this; this.children.unshift(n); }
  after(n){ const p = this.parentNode; if (!p) return; n.remove(); n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
  remove(){ const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } }
  contains(n){ for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  set innerHTML(h){ this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._html = String(h); this._text = this._html.replace(/<[^>]*>/g, ''); }
  get innerHTML(){ return this._html; }
  set textContent(t){ this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._html = ''; this._text = String(t); }
  get textContent(){ return this._text + this.children.map(c => c.textContent).join(''); }
  get isConnected(){ for (let x = this; x; x = x.parentNode) if (x === document.documentElement) return true; return false; }
  matches(sel){ return sel.split(',').some(s => simple(this, s.trim())); }
  closest(sel){ for (let x = this; x; x = x.parentNode) if (x.matches?.(sel)) return x; return null; }
  querySelectorAll(sel){ const out = []; const walk = n => n.children.forEach(c => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; }
  querySelector(sel){ return this.querySelectorAll(sel)[0] || null; }
  getClientRects(){ if (!this.isConnected) return []; for (let x = this; x; x = x.parentNode) if (x.hidden) return []; return [{}]; }
  addEventListener(t, f, o){ this.ls.push({ t, f, cap: o === true || !!o?.capture }); }
  removeEventListener(t, f, o){ const cap = o === true || !!o?.capture, i = this.ls.findIndex(l => l.t === t && l.f === f && l.cap === cap); if (i >= 0) this.ls.splice(i, 1); }
  click(){ return dispatch(this, 'click'); }
  blur(){}
}
function dispatch(target, type, init = {}){
  const ev = { type, target, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, _stop: false,
    preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this._stop = true; }, ...init };
  const pth = []; for (let x = target; x; x = x.parentNode) pth.push(x);
  for (let i = pth.length - 1; i >= 0 && !ev._stop; i--) for (const l of pth[i].ls.slice()) if (l.t === type && l.cap) l.f.call(pth[i], ev);
  for (let i = 0; i < pth.length && !ev._stop; i++) for (const l of pth[i].ls.slice()) if (l.t === type && !l.cap) l.f.call(pth[i], ev);
  if (type === 'click' && !ev.defaultPrevented) { const a = target.closest('a[href]'); if (a && a.getAttribute('href').startsWith('#')) nav(a.getAttribute('href')); }
  return ev;
}
const html = new El('html'), head = new El('head'), body = new El('body');
html.append(head, body);
const document = { documentElement: html, head, body, activeElement: null, createElement: t => new El(t),
  getElementById: id => (function f(n){ for (const c of n.children) { if (c.id === id) return c; const r = f(c); if (r) return r; } return null; })(html),
  querySelector: s => html.querySelector(s) };
globalThis.document = document;
globalThis.window = globalThis;

// ═══ Окно: события, адрес, история, хранилища, таймеры ═══
const winLs = [];
globalThis.addEventListener = (t, f, o) => winLs.push({ t, f, cap: o === true || !!o?.capture });
globalThis.removeEventListener = (t, f, o) => { const cap = o === true || !!o?.capture, i = winLs.findIndex(l => l.t === t && l.f === f && l.cap === cap); if (i >= 0) winLs.splice(i, 1); };
// как в браузере: у цели сначала слушатели захвата, потом остальные; stopImmediatePropagation — дальше никому
const fireWin = (type, init = {}) => {
  const ev = { type, defaultPrevented: false, _stop: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){}, stopImmediatePropagation(){ this._stop = true; }, ...init };
  const ls = winLs.filter(l => l.t === type);
  for (const l of [...ls.filter(l => l.cap), ...ls.filter(l => !l.cap)]) { if (ev._stop) break; l.f(ev); }
  return ev;
};
// «полный экран» (как js/core/fullscreen.js): свой слушатель «Назад», подписан раньше окна игры
const fullPops = [];
globalThis.addEventListener('popstate', () => fullPops.push(location.hash));
const BASE = 'https://site.test/';
const hashOf = u => { const i = String(u).indexOf('#'); return i < 0 ? '' : String(u).slice(i); };
const H = { entries: [{ url: BASE + '#/games', state: null }, { url: BASE + '#/games/world', state: null }], i: 1, log: [], q: [] };
const routed = [];   // что «роутер» показал сам (переход не наш)
function router(oldURL){ if (MirPlay.onHash({ oldURL, newURL: H.entries[H.i].url })) return; routed.push(location.hash); }
globalThis.history = {
  get state(){ return H.entries[H.i].state; },
  get length(){ return H.entries.length; },
  pushState(st, t, url){ H.entries.splice(H.i + 1); H.entries.push({ url: url ? new URL(url, BASE).href : H.entries[H.i].url, state: st == null ? null : JSON.parse(JSON.stringify(st)) }); H.i++; H.log.push('push'); },
  replaceState(st, t, url){ H.entries[H.i] = { url: url ? new URL(url, BASE).href : H.entries[H.i].url, state: st == null ? null : JSON.parse(JSON.stringify(st)) }; H.log.push('replace'); },
  go(n){ H.log.push('go' + n); H.q.push(n); },   // как в браузере — позже (flushHistory)
  back(){ this.go(-1); },
};
function flushHistory(){
  while (H.q.length) {
    const n = H.q.shift(), j = Math.max(0, Math.min(H.entries.length - 1, H.i + n));
    if (j === H.i) continue;
    const old = H.entries[H.i].url; H.i = j;
    fireWin('popstate', { state: history.state });
    if (hashOf(old) !== hashOf(H.entries[j].url)) router(old);
  }
}
// переход по адресу (location.hash = …, ссылка): новая запись, popstate сразу, потом hashchange → роутер
function nav(hash){
  const old = H.entries[H.i].url;
  if (hashOf(old) === hash) return;
  H.entries.splice(H.i + 1); H.entries.push({ url: BASE + hash, state: null }); H.i++;
  fireWin('popstate', { state: null });
  router(old);
}
globalThis.location = { get hash(){ return hashOf(H.entries[H.i].url); }, set hash(h){ nav(h.startsWith('#') ? h : '#' + h); },
  get href(){ return H.entries[H.i].url; }, pathname: '/', search: '', origin: 'https://site.test' };
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = store(); globalThis.sessionStorage = store();
let now = 0, tid = 0;
const timers = new Map(), realT = { setTimeout, clearTimeout, setInterval, clearInterval };
globalThis.setTimeout = (f, ms) => { const id = ++tid; timers.set(id, { f, at: now + (ms || 0), every: 0 }); return id; };
globalThis.setInterval = (f, ms) => { const id = ++tid; timers.set(id, { f, at: now + ms, every: ms }); return id; };
globalThis.clearTimeout = globalThis.clearInterval = id => { timers.delete(id); };
function advance(ms){
  const end = now + ms;
  for (;;) {
    let nx = null;
    for (const [id, t] of timers) if (t.at <= end && (!nx || t.at < nx[1].at)) nx = [id, t];
    if (!nx) break;
    const [id, t] = nx; now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    t.f();
  }
  now = end;
}
const errs = []; const cerr = console.error; console.error = (...a) => errs.push(a.map(String).join(' '));

// ═══ Сайт вокруг: витрина игр, загрузчик, api, игры ═══
globalThis.GAMES = [
  { id: 'world', icon: '🌍', title: 'Мир Денчика', scripts: ['js/games/mir.js'] },
  { id: 'chess', icon: '♟️', title: 'Шахматы', scripts: ['js/games/room.js', 'js/games/table.js', 'js/games/chess.js'] },
  { id: '2048', icon: '🧩', title: '2048', scripts: ['js/games/g2048.js'] },
  { id: 'horde', icon: '🧟', title: 'Орда', scripts: ['js/games/horde.js'] },
  { id: 'broken', icon: '💥', title: 'Сломанная', scripts: ['js/games/broken.js'] },
  { id: 'wardrobe', icon: '🎭', title: 'Мой персонаж', scripts: ['js/games/wardrobe.js'] },
  { id: 'studio3d', icon: '🧱', title: 'Студия 3D', scripts: ['js/games/studio3d.js'] },
  { id: 'quiz', icon: '🧩', title: 'Тесты', href: '/quiz' },
];
const loaded = [];
globalThis.gamesLoadScript = async src => { if (src.includes('broken')) throw new Error('Не загрузилось: ' + src); loaded.push(src); };
const reports = [], toasts = [], adCtx = [];
// как games.js: report → gamesAdAfterRound → реклама в MirPlay.adStage() (полоска итога) — запоминаем, видна ли она в этот миг
globalThis.gamesApi = id => ({ id, async report(key, win, score){ const st = globalThis.MirPlay?.adStage?.(); reports.push({ id, key, win, score, adStage: !!st, adVisible: !!st && st.getClientRects().length > 0, playing: adCtx[adCtx.length - 1] }); return { ok: true }; }, toast: t => toasts.push(t), local: () => ({}), saveLocal(){}, sfx(){} });
globalThis.gameToast = t => toasts.push(t);
globalThis.D37AdPlaces = { ctx: (name, on) => { if (name === 'playing') adCtx.push(!!on); } };
const GI = globalThis.GAME_IMPL = {};
function fakeGame(id){
  const G = { mounts: 0, unmounts: 0, api: null, el: null, again: 0, params: [] };
  GI[id] = {
    mount(el, api){ G.mounts++; G.api = api; G.el = el; G.params.push(api.param); const st = document.createElement('div'); st.textContent = `${id}: ${api.param || 'меню'}`; el.appendChild(st); G.st = st; },
    unmount(){ G.unmounts++; G.el = null; },
  };
  return G;
}
const CH = fakeGame('chess'), G2 = fakeGame('2048'), HD = fakeGame('horde');
// экран итога в игре: again — кнопка «↻ Ещё партия», wait — «Ждём хозяина», paid — только «за рекламу», link — ссылка «выйти»
function endScreen(G, kind){
  G.st.textContent = 'Мат! Победили белые';
  if (kind === 'again') { const b = document.createElement('button'); b.className = 'ct-start'; b.setAttribute('data-act', 'again'); b.textContent = '↻ Ещё партия'; b.addEventListener('click', () => { G.again++; }); G.el.appendChild(b); }
  if (kind === 'wait') { const s = document.createElement('span'); s.textContent = 'Ждём, пока хозяин начнёт новую…'; G.el.appendChild(s); }
  if (kind === 'paid') { const b = document.createElement('button'); b.className = 'ct-start'; b.textContent = '📺 Посмотреть рекламу → ещё одна'; G.el.appendChild(b); }
  if (kind === 'link') { const a = document.createElement('a'); a.setAttribute('href', `#/games/${G === CH ? 'chess' : '2048'}`); a.textContent = '🚪 Выйти'; G.el.appendChild(a); return a; }
}

vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-play.js'), 'utf8'), { filename: 'mir-play.js' });
const MP = globalThis.MirPlay, T = MP._test;
const wrap = new El('div'); wrap.className = 'wld-wrap'; body.appendChild(wrap);
const calls = [];
const opts = (extra = {}) => ({ wrap, onClose: why => calls.push('close:' + why), onFail: err => calls.push('fail:' + (err?.message || '')), onRoute: (g, p) => calls.push(`route:${g}/${p}`), ...extra });
const overlay = () => wrap.querySelector('.mp');
const bar = () => overlay()?.querySelector('.mp-end');
const winCount = t => winLs.filter(l => l.t === t).length;
const tick = s => advance(s * 1000);
MP.P.back = 10;

(async () => {
  // ═══ Куда ведут переходы игры ═══
  {
    ok(JSON.stringify(T.parse('#/games/chess/abc123')) === '{"g":"chess","param":"abc123"}', 'parse: игра и код');
    ok(T.parse('#/games/horde/coop/x1y2z3').param === 'coop/x1y2z3', 'parse: coop/<код>');
    ok(T.parse('#/games') === null && T.parse('#/home') === null && T.parse('') === null, 'parse: витрина и другие разделы — не игра');
    const tab = { g: 'chess', param: 'abc123', p0: 'abc123' }, solo = { g: '2048', param: null, p0: null }, duel = { g: '2048', param: 'k2k2k2', p0: null };
    const d = (c, h) => T.decide(c, h);
    ok(d(tab, '#/games/chess/zz9zz9').act === 'reroute' && d(tab, '#/games/chess/zz9zz9').param === 'zz9zz9', 'стол: «онлайн» с новым кодом — в том же окне');
    ok(d(tab, '#/games/chess/abc123').act === 'stay', 'тот же адрес — ничего');
    ok(d(tab, '#/games/chess').act === 'close' && d(tab, '#/games/chess').why === 'leave', 'стол: «выйти» — в мир');
    ok(d(solo, '#/games/2048').act === 'stay', 'автомат: меню → меню — ничего');
    ok(d(duel, '#/games/2048').act === 'reroute' && d(duel, '#/games/2048').param === null, 'автомат: «выйти» из дуэли — в меню игры, не в мир');
    ok(d(tab, '#/games/world').act === 'close' && d(tab, '#/games/world').why === 'world', '«в мир» — закрыть окно');
    ok(d(tab, '#/games/wardrobe').act === 'editor', 'гардероб — редактор мира');
    ok(d(tab, '#/games/horde/coop/a1b2c3').act === 'reroute' && d(tab, '#/games/horde/coop/a1b2c3').g === 'horde', 'другая игра — в окне');
    for (const h of ['#/games/studio3d', '#/games/quiz', '#/games', '#/home', '#/profile/42', '#/chat']) ok(d(tab, h).act === 'pass', 'обычный переход сайта: ' + h);
    ok(MP.can('chess') && MP.can('horde') && !MP.can('world') && !MP.can('wardrobe') && !MP.can('studio3d') && !MP.can('quiz') && !MP.can('nope'), 'can: какие игры открываются поверх мира');
  }

  // ═══ Открыть → партия → итог → сам в мир ═══
  {
    calls.length = 0; H.log.length = 0;
    const r = await MP.open('chess', 'abc123', opts({ auto: { g: 'chess', c: 'abc123', n: 2 } }));
    const st = MP.state();
    ok(r === true && st.phase === 'playing' && st.g === 'chess' && st.param === 'abc123' && st.p0 === 'abc123', 'открылась: идёт партия', st);
    ok(CH.mounts === 1 && CH.api.param === 'abc123' && CH.api.inWorld === true && typeof CH.api.exit === 'function', 'игра смонтирована: param, inWorld, exit()');
    ok(loaded.join(',') === 'js/games/room.js,js/games/table.js,js/games/chess.js', 'скрипты игры — через gamesLoadScript по порядку', loaded);
    ok(overlay() && overlay().querySelector('.mp-game').contains(CH.st) && html.classList.contains('mir-playing'), 'окно внутри wrap мира, html.mir-playing');
    ok(overlay().querySelector('.mp-title').textContent === '♟️ Шахматы', 'заголовок окна');
    ok(H.log.includes('push') && history.state?.mp && history.state.mpd === 1 && location.hash === '#/games/world', 'своя запись истории, адрес мира не менялся');
    ok(winCount('popstate') === 2 && winLs.some(l => l.t === 'popstate' && l.cap) && winCount('keydown') === 1, 'слушатели окна: «Назад» (захват, раньше полного экрана) и клавиши');
    ok(bar().hidden === true, 'полоски итога пока нет');
    await CH.api.report('chess_online', true, 1, 1);
    ok(reports.length === 1 && reports[0].key === 'chess_online', 'report дошёл до сайта (XP, рекорды)');
    ok(MP.state().phase === 'ended' && bar().hidden === false, 'после партии — полоска');
    ok(/Победа/.test(bar().textContent) && /↩ В мир \(10\)/.test(bar().textContent) && /Ещё партию/.test(bar().textContent), 'полоска: «Победа», «↩ В мир (10)», «▶ Ещё партию»', bar().textContent);
    endScreen(CH, 'none');   // экран итога без кнопок
    tick(3);
    ok(/\(7\)/.test(bar().textContent), 'отсчёт идёт', bar().textContent);
    tick(7);
    ok(!MP.isOpen() && calls.includes('close:auto') && CH.unmounts === 1, 'через 10 с — сам в мир, игра размонтирована', calls);
    ok(!overlay() && !html.classList.contains('mir-playing') && winCount('popstate') === 1 && winCount('keydown') === 0, 'окно и слушатели убраны');
    ok(H.log.includes('go-1'), 'своя запись истории — назад', H.log);
    flushHistory();
    ok(location.hash === '#/games/world' && history.state == null && routed.length === 0, 'вернулись на запись мира, роутер не трогали');
  }

  // ═══ Нажал в игре — партия продолжается ═══
  {
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    await CH.api.report('chess_online', false, 0, 0);
    ok(bar().hidden === false && !/Победа/.test(bar().textContent), 'проигрыш — без «Победа»');
    dispatch(CH.st, 'pointerdown');
    ok(MP.state().phase === 'playing' && bar().hidden === true, 'нажал в игре — полоска спряталась');
    tick(30);
    ok(MP.isOpen(), 'и окно не закрылось само');
    await CH.api.report('chess_online', true, 1, 1);
    fireWin('keydown', { key: 'Shift' });
    ok(MP.state().phase === 'ended', 'Shift — не считается');
    fireWin('keydown', { key: 'a' });
    ok(MP.state().phase === 'playing', 'клавиша в игре — партия продолжается');
    MP.close('back'); flushHistory();
    ok(calls.includes('close:back'), '«↩ В мир» — close(back)');
  }

  // ═══ «▶ Ещё партию» ═══
  {
    // у игры своя кнопка «↻ Ещё партия» — жмём её
    await MP.open('chess', 'abc123', opts({ auto: { g: 'chess', c: 'abc123', n: 2 } }));
    const m0 = CH.mounts;
    await CH.api.report('chess_online', true, 1, 1);
    endScreen(CH, 'again');
    overlay().querySelector('.mp-end-again').click();
    ok(CH.again === 1 && CH.mounts === m0 && MP.state().phase === 'playing' && bar().hidden, '«Ещё партию» — нажата кнопка игры, без перезапуска');
    // соперник — хозяин, ждём его
    await CH.api.report('chess_online', false, 0, 0);
    CH.st.textContent = 'Ничья'; [...CH.el.querySelectorAll('button')].forEach(b => b.remove());
    endScreen(CH, 'wait');
    toasts.length = 0;
    overlay().querySelector('.mp-end-again').click();
    ok(CH.mounts === m0 && toasts.some(t => /Ждём/.test(t)), 'гость: «Ждём, пока соперник начнёт» — без перезапуска', toasts);
    // против бота, кнопок нет — та же игра заново, тот же код; d37_autostart — снова
    sessionStorage.removeItem('d37_autostart');
    await CH.api.report('chess_online', true, 1, 1);
    CH.el.querySelectorAll('span').forEach(s => s.remove());
    const u0 = CH.unmounts;
    overlay().querySelector('.mp-end-again').click();
    await new Promise(r => setImmediate(r));
    const a = JSON.parse(sessionStorage.getItem('d37_autostart') || 'null');
    ok(CH.mounts === m0 + 1 && CH.unmounts === u0 + 1 && CH.api.param === 'abc123', 'нет кнопки — та же игра заново, тот же код');
    ok(a && a.g === 'chess' && a.c === 'abc123' && a.n === 2, 'стол: d37_autostart снова (хозяин сам нажмёт «Начать»)', a);
    // кнопки «за рекламу» сами не жмём
    await CH.api.report('chess_online', true, 1, 1);
    endScreen(CH, 'paid');
    ok(T.findAgain(CH.el) === null, 'кнопка «за рекламу» — не «ещё партия»');
    MP.close('back'); flushHistory();
  }

  // ═══ Соперник уже начал новую партию — на исходе отсчёта остаёмся ═══
  {
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    await CH.api.report('chess_online', false, 0, 0);
    endScreen(CH, 'wait');
    tick(2);   // экран итога запомнен
    CH.st.textContent = '⏳ Ходит соперник… новая партия'; CH.el.querySelectorAll('span').forEach(s => s.remove());
    tick(9);
    ok(MP.isOpen() && MP.state().phase === 'playing' && bar().hidden, 'экран сменился, кнопки «ещё» нет — остаёмся в новой партии');
    // экран тот же — уходим
    await CH.api.report('chess_online', true, 1, 1);
    endScreen(CH, 'again');
    tick(11);
    ok(!MP.isOpen() && calls.includes('close:auto'), 'экран итога не менялся — сам в мир');
    flushHistory();
  }

  // ═══ Переходы игры (роутер) ═══
  {
    calls.length = 0; routed.length = 0;
    await MP.open('chess', 'abc123', opts());
    const m0 = CH.mounts, u0 = CH.unmounts, len0 = H.entries.length;
    location.hash = '#/games/chess/zz9zz9';   // «🌐 Онлайн с другом» внутри окна
    await new Promise(r => setImmediate(r));
    ok(MP.isOpen() && CH.mounts === m0 + 1 && CH.unmounts === u0 + 1 && CH.api.param === 'zz9zz9', 'новый код — та же игра в окне');
    ok(location.hash === '#/games/world' && routed.length === 0 && history.state?.mp && history.state.mpd === 2, 'адрес мира вернулся, роутер страницу не менял');
    ok(H.entries.length === len0 + 1 && calls.includes('route:chess/zz9zz9'), 'одна запись истории за переход; мир знает новый код', calls);
    location.hash = '#/games/chess';   // «🚪 Выйти»
    ok(!MP.isOpen() && calls.includes('close:leave') && routed.length === 0, '«выйти» — окно закрыто, в мир');
    ok(H.log.slice(-1)[0] === 'go-3', 'все свои записи истории — назад разом', H.log.slice(-3));
    flushHistory();
    ok(location.hash === '#/games/world' && history.state == null && routed.length === 0, 'стоим на записи мира');
    // автомат: дуэль и обратно в меню игры — окно не закрывается
    await MP.open('2048', null, opts());
    location.hash = '#/games/2048/k2k2k2';
    await new Promise(r => setImmediate(r));
    ok(MP.state().param === 'k2k2k2' && G2.api.param === 'k2k2k2', 'автомат: «с другом» — в окне');
    location.hash = '#/games/2048';
    await new Promise(r => setImmediate(r));
    ok(MP.isOpen() && MP.state().param === null && G2.api.param === null, 'автомат: «выйти» из дуэли — меню игры');
    // ссылка «выйти» в игре — без записи истории
    const len1 = H.entries.length;
    MP.close('back'); flushHistory();
    await MP.open('chess', 'abc123', opts());
    const a = endScreen(CH, 'link'), ev = dispatch(a, 'click');
    ok(ev.defaultPrevented && !MP.isOpen() && calls.includes('close:leave'), 'ссылка «#/games/<игра>» — закрыть окно сразу');
    flushHistory();
    ok(H.entries.length <= len1 + 1 && location.hash === '#/games/world', 'ссылка не добавила записей');
    // другой раздел сайта — окно закрывается, роутер ведёт как обычно
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    const l0 = H.log.length;
    location.hash = '#/home';
    ok(!MP.isOpen() && calls.includes('close:nav') && routed.slice(-1)[0] === '#/home', 'другой раздел: окно закрыто (nav), роутер показал страницу');
    ok(!H.log.slice(l0).some(x => x.startsWith('go')), 'nav — историю не откатываем', H.log.slice(l0));
    history.back(); flushHistory();   // назад в мир
    routed.length = 0;
    // гардероб — закрыть и открыть редактор мира
    calls.length = 0;
    H.entries.splice(H.i + 1); H.entries[H.i] = { url: BASE + '#/games/world', state: null };
    await MP.open('chess', null, opts());
    location.hash = '#/games/wardrobe';
    ok(!MP.isOpen() && calls.includes('close:editor') && routed.length === 0, 'гардероб — редактор мира, страница не меняется');
    flushHistory();
  }

  // ═══ «Назад» в браузере / на телефоне ═══
  {
    calls.length = 0; routed.length = 0;
    await MP.open('chess', 'abc123', opts());
    history.back(); flushHistory();
    ok(!MP.isOpen() && calls.includes('close:popstate') && location.hash === '#/games/world' && routed.length === 0, '«Назад» — окно закрыто, мир на месте');
    // после перехода внутри окна: «Назад» — тоже в мир (и лишние записи — разом)
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    location.hash = '#/games/chess/q1q1q1';
    history.back(); flushHistory();
    ok(!MP.isOpen() && calls.includes('close:popstate'), '«Назад» после перехода в окне — в мир');
    ok(history.state == null && location.hash === '#/games/world', 'свои записи пройдены');
  }

  // ═══ Реклама: «идёт партия» и полоска итога (ad-places.js) ═══
  {
    adCtx.length = 0; reports.length = 0;
    await MP.open('chess', 'abc123', opts());
    ok(adCtx[adCtx.length - 1] === true, 'открыли — D37AdPlaces.ctx(playing, true)');
    ok(MP.adStage() && MP.adStage().classList.contains('mp-end-ad'), 'adStage — место в полоске итога');
    await CH.api.report('chess_online', true, 1, 1);
    ok(reports[0].playing === false && reports[0].adStage && reports[0].adVisible, 'к отчёту: партия не идёт, полоска уже видна — реклама ляжет в неё', reports[0]);
    dispatch(CH.st, 'pointerdown');
    ok(adCtx[adCtx.length - 1] === true && bar().hidden, 'снова играет — ctx(playing) и полоска (с рекламой) спрятана');
    MP.close('back'); flushHistory();
    ok(adCtx[adCtx.length - 1] === false && MP.adStage() === null, 'закрыли — ctx(playing) снят, adStage — null (реклама снова под игрой)');
  }

  // ═══ Полный экран (fullscreen.js) и Esc ═══
  {
    calls.length = 0;
    H.entries[H.i] = { url: BASE + '#/games/world', state: { gsFull: 7 } };   // мир во весь экран: своя запись «полного экрана»
    await MP.open('chess', 'abc123', opts());
    ok(JSON.stringify(history.state) === JSON.stringify({ mp: history.state?.mp, mpd: 1 }), 'своя запись — без gsFull (не притворяемся записью полного экрана)', history.state);
    const f0 = fullPops.length;
    location.hash = '#/games/chess/w7w7w7';
    ok(fullPops.length === f0 && MP.isOpen(), 'переход игры внутри окна — «полный экран» о нём не узнал (не выключится)');
    history.back(); flushHistory();
    ok(!MP.isOpen() && calls.includes('close:popstate') && fullPops.length > f0, '«Назад» — окно закрыто, «полный экран» своё «назад» увидел');
    ok(history.state?.gsFull === 7 && location.hash === '#/games/world', 'стоим на записи полного экрана мира', history.state);
    // ⛶ нажали уже в окне: поверх нашей записи — запись полного экрана; закрыли окно — историю не трогаем
    await MP.open('chess', 'abc123', opts());
    history.pushState({ ...history.state, gsFull: 8 }, '', location.href);
    const g0 = H.log.length;
    MP.close('back');
    ok(!H.log.slice(g0).some(x => x.startsWith('go')), 'поверх — запись полного экрана: «назад» не делаем (не выключаем полный экран)');
    H.entries.splice(H.i + 1); H.entries[H.i] = { url: BASE + '#/games/world', state: null };
    // Esc
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    const e1 = fireWin('keydown', { key: 'Escape', target: body });
    ok(MP.isOpen() && !e1.defaultPrevented, 'Esc во время партии — игре (окно не закрывается)');
    await CH.api.report('chess_online', true, 1, 1);
    const inp = new El('input'); CH.el.appendChild(inp);
    fireWin('keydown', { key: 'Escape', target: inp });
    ok(MP.isOpen(), 'Esc в поле ввода игры — не наш');
    const e2 = fireWin('keydown', { key: 'Escape', target: body });
    ok(!MP.isOpen() && calls.includes('close:back') && e2.defaultPrevented, 'Esc после партии — в мир');
    flushHistory();
  }

  // ═══ Не открылась — по-старому ═══
  {
    calls.length = 0; errs.length = 0;
    const pushes = H.log.filter(x => x === 'push').length;
    const r = await MP.open('broken', 'abc123', opts());
    ok(r === false && !MP.isOpen() && calls.join() === 'close:fail,fail:Не загрузилось: js/games/broken.js', 'скрипт не загрузился: onClose(fail) + onFail', calls);
    ok(!overlay() && !html.classList.contains('mir-playing') && winCount('popstate') === 1 && H.log.filter(x => x === 'push').length === pushes, 'окна и записи истории не осталось');
    calls.length = 0;
    GI.boom = { mount(){ throw new Error('mount упал'); }, unmount(){ calls.push('boom-unmount'); } };
    GAMES.push({ id: 'boom', icon: '💣', title: 'Бум', scripts: ['js/games/boom.js'] });
    ok(await MP.open('boom', null, opts()) === false && calls.includes('close:fail') && calls.some(c => c.startsWith('fail:mount')), 'ошибка mount — запасной путь', calls);
    calls.length = 0;
    ok(await MP.open('studio3d', null, opts()) === false && calls.includes('close:fail') && calls.some(c => c.startsWith('fail:')), 'игра не для окна — сразу запасной путь');
    // внутри окна другая игра не загрузилась — окно остаётся, в нём ошибка
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    location.hash = '#/games/broken/x1x1x1';
    await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
    ok(MP.isOpen() && /не загрузилась/.test(overlay().querySelector('.mp-game').textContent), 'внутри окна: «Игра не загрузилась», окно открыто');
    MP.close('back'); flushHistory();
    // мир закрылся — окно с ним, историю не трогаем
    await MP.open('chess', 'abc123', opts());
    const l0 = H.log.length;
    MP.close('unmount');
    ok(!MP.isOpen() && calls.includes('close:unmount') && !H.log.slice(l0).some(x => x.startsWith('go')), 'unmount: окно закрыто, история не тронута');
    H.entries.splice(H.i + 1); H.entries[H.i] = { url: BASE + '#/games/world', state: null };
    // exit() из игры
    calls.length = 0;
    await MP.open('chess', 'abc123', opts());
    CH.api.exit();
    ok(!MP.isOpen() && calls.includes('close:exit'), 'api.exit() — в мир');
    flushHistory();
  }

  // ═══ Страница игры, пришли из мира: «↩ В мир» в шапке ═══
  {
    const stageBar = new El('div'); stageBar.className = 'gm-stage-bar';
    const back = new El('button'); back.className = 'gm-back'; stageBar.appendChild(back); body.appendChild(stageBar);
    T.track(BASE + '#/games/world', '#/games/chess/abc123');
    ok(T.flag()?.g === 'chess', 'мир → страница игры: d37_from_world');
    H.entries[H.i] = { url: BASE + '#/games/chess/abc123', state: null };
    MP.shell();
    const b = stageBar.querySelector('.mp-shell');
    ok(b && !b.hidden && stageBar.children[1] === b && /В мир/.test(b.textContent), 'в шапке игры — «↩ В мир» после «Все игры»');
    routed.length = 0;
    b.click();
    ok(location.hash === '#/games/world' && T.flag() === null && b.hidden, '«↩ В мир» — в мир, отметка снята, кнопка спрятана');
    T.track(BASE + '#/games/chess', '#/home'); T.track(BASE + '#/games/world', '#/games/quiz');
    ok(T.flag() === null, 'с витрины/в другой раздел — не «из мира»');
    T.track(BASE + '#/games/world', '#/games/horde'); T.track(BASE + '#/games/horde', '#/games');
    ok(T.flag() === null, 'ушли на витрину — отметка снята');
  }

  // ═══ 10 открытий и закрытий — без утечек ═══
  {
    const ls0 = winLs.length, kids0 = wrap.children.length, m0 = CH.mounts, u0 = CH.unmounts, t0 = timers.size;
    for (let i = 0; i < 10; i++) {
      await MP.open('chess', 'abc123', opts());
      await CH.api.report('chess_online', i % 2 === 0, 1, 1);
      if (i % 3 === 0) { location.hash = '#/games/chess/r' + i + 'r' + i + 'r' + i; if (i % 2) await new Promise(r => setImmediate(r)); }
      MP.close(i % 2 ? 'back' : 'auto'); flushHistory();
    }
    ok(winLs.length === ls0 && wrap.children.length === kids0, '10 раз: слушатели окна и элементы — как было', { ls: winLs.length, ls0, kids: wrap.children.length });
    // i = 3 и 9: переход внутри окна успел смонтироваться (+2); i = 0 и 6: закрыли, пока грузилось — не смонтирован
    ok(CH.mounts - m0 === CH.unmounts - u0 && CH.mounts - m0 === 12, 'каждый mount — с unmount (и переход, закрытый на загрузке, не монтируется)', { m: CH.mounts - m0, u: CH.unmounts - u0 });
    ok(timers.size === t0, 'таймеры отсчёта не висят', { t: timers.size, t0 });
    ok(document.head.querySelectorAll('style').length === 1, 'стили окна — один раз');
    ok(location.hash === '#/games/world' && history.state == null, 'история — на записи мира');
  }

  // ═══ «Мир Денчика»: бездействие и стол (js/games/mir.js) ═══
  {
    vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir.js'), 'utf8'), { filename: 'mir.js' });
    const W = globalThis.GAME_IMPL.world?._test;
    ok(W && typeof W.afkDue === 'function' && typeof W.tableState === 'function', 'mir.js: afkDue и tableState в _test');
    const t = 100 * 60e3, M = 60e3;
    ok(W.afkDue({ idleAt: t - 16 * M, hiddenAt: 0 }, t) === true, 'стоит 16 мин — выводим из мира');
    ok(W.afkDue({ idleAt: t - 5 * M, hiddenAt: 0 }, t) === false, 'стоит 5 мин — нет');
    ok(W.afkDue({ idleAt: t, hiddenAt: t - 11 * M }, t) === true, 'вкладка спрятана 11 мин — выводим');
    ok(W.afkDue({ idleAt: t - 90 * M, hiddenAt: 0, playing: { g: 'chess' } }, t) === false, 'играет поверх мира 90 мин — не выводим');
    ok(W.afkDue({ idleAt: t, hiddenAt: t - 11 * M, playing: { g: 'chess' } }, t) === false, 'играет, вкладка спрятана 11 мин — не выводим');
    ok(W.afkDue({ idleAt: t, hiddenAt: t - 31 * M, playing: { g: 'chess' } }, t) === true, 'играет, вкладка спрятана 31 мин — выводим');
    const me = { key: 'me' }, my = { c: 'abc123', t: 1000 };
    const it = (playing, plAt, c = 'abc123') => ({ p: { key: 'x' + Math.random(), playing, plAt }, c });
    const S = (...l) => JSON.stringify(W.tableState([{ p: me, c: 'abc123' }, ...l], me, my));
    ok(S(it(null, 0)) === '{"busy":false,"join":false}', 'за столом сидят, никто не играет — обычный отсчёт');
    ok(S(it({ g: 'chess', c: 'abc123' }, 2000)) === '{"busy":false,"join":true}', 'начали после того, как я сел, с кодом стола — это моя партия');
    ok(S(it({ g: 'chess', c: 'abc123' }, 500)) === '{"busy":true,"join":false}', 'начали до меня — стол занят');
    ok(S(it({ g: 'chess', c: null }, 2000)) === '{"busy":true,"join":false}', 'играет с ботом — стол занят');
    ok(S(it({ g: 'chess', c: 'zzz999' }, 2000)) === '{"busy":true,"join":false}', 'другой код — стол занят');
    me.playing = { g: 'chess', c: 'abc123' }; me.plAt = 5;
    ok(JSON.stringify(W.tableState([{ p: me, c: 'abc123' }], me, my)) === '{"busy":false,"join":false}', 'сам себе — не помеха');
    delete me.playing;
  }

  console.error = cerr;
  Object.assign(globalThis, realT);
  const bad = errs.filter(e => !/Не загрузилось|mount упал|не открывается поверх мира|Нет игры|broken/.test(e));
  ok(bad.length === 0, 'нет неожиданных ошибок', bad);
  console.log(`mirplay-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error = cerr; console.error(e); process.exit(1); });

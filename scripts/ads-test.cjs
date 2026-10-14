// Тесты рекламы (js/core/ads-core.js + js/core/ad-places.js + js/games/mir-promo.js) в node, без браузера:
//  1) диспетчер: частота (первые секунды визита, промежуток, максимум, общий лимит), визит в sessionStorage, номера блоков
//     с запасными, VIP и персонал без рекламы (и после выхода — снова с рекламой), «рядом нельзя» (кейсы, чужие игры, партия);
//  2) ads-core: render через диспетчер (тёмная тема и statId РСЯ, «детская» обработка Google), полоска (320–420 px),
//     полноэкранная между партиями (не после первой, не чаще раза в 3 мин);
//  3) экран загрузки: быстро загрузилось — ничего; дольше 1,5 с — реклама под прогрессом и сразу прочь по done();
//     передача времени от games.js миру; чужой мир — без рекламы; карточка компилятора в углу;
//  4) после партии: «Перерыв» каждую 3-ю на компьютере, без обновления рекламы Google, гаснет при игре; телефон — game_over;
//  5) карточки в списках: шаг, не последней, лимит, «азартные» ролики, VIP, своя подсказка, если рекламы нет;
//  6) столбик справа: ширина экрана, свободное место, 150 px от игры у Google, окно студии;
//  7) монеты за рекламу: только при rewardReady/canAd, раз в 10 минут, награда только после досмотра;
//  8) спонсор щитов: проверка полей и ссылок; щиты мира (mir-promo.js) — список промо, VIP, рисование;
//  9) серверные страницы и правки игр: скрипты подключены, места в ленте /videos, хуки в играх.
// Запуск из корня сайта: node scripts/ads-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };

// ═══ Подменный DOM (ровно столько, сколько нужно модулям) ═══
const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr']);
const decode = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
const camel = s => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
class Text { constructor(t){ this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent(){ return this.data; } remove(){ if (this.parentNode) this.parentNode._rm(this); } }
class El {
  constructor(tag){
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.parentNode = null; this.attrs = {};
    this.style = {}; this.listeners = {}; this._rect = null; this.hidden = false; this.disabled = false;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (o, k) => self.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())],
      set: (o, k, v) => { self.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(v); return true; },
      deleteProperty: (o, k) => { delete self.attrs['data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())]; return true; },
      has: (o, k) => ('data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())) in self.attrs,
    });
  }
  get id(){ return this.attrs.id || ''; } set id(v){ this.attrs.id = String(v); }
  get className(){ return this.attrs.class || ''; } set className(v){ this.attrs.class = String(v); }
  get classList(){
    const el = this, list = () => el.className.split(/\s+/).filter(Boolean);
    return { add: (...c) => { el.className = [...new Set([...list(), ...c])].join(' '); }, remove: (...c) => { el.className = list().filter(x => !c.includes(x)).join(' '); },
      contains: c => list().includes(c), toggle: (c, f) => { const has = list().includes(c), want = f === undefined ? !has : !!f; if (want && !has) el.classList.add(c); if (!want && has) el.classList.remove(c); return want; } };
  }
  setAttribute(k, v){ this.attrs[k] = String(v); } getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; } hasAttribute(k){ return k in this.attrs; } removeAttribute(k){ delete this.attrs[k]; }
  get children(){ return this.childNodes.filter(n => n.nodeType === 1); }
  get childElementCount(){ return this.children.length; }
  get firstChild(){ return this.childNodes[0] || null; } get firstElementChild(){ return this.children[0] || null; } get lastElementChild(){ const c = this.children; return c[c.length - 1] || null; }
  get parentElement(){ return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get nextElementSibling(){ if (!this.parentNode) return null; const c = this.parentNode.children; return c[c.indexOf(this) + 1] || null; }
  get isConnected(){ let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
  _rm(n){ const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  appendChild(n){ if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns){ ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  insertBefore(n, ref){ if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode._rm(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; }
  after(...ns){ const p = this.parentNode; if (!p) return; let ref = p.childNodes[p.childNodes.indexOf(this) + 1] || null; for (const n of ns) p.insertBefore(n, ref); }
  before(...ns){ const p = this.parentNode; if (!p) return; for (const n of ns) p.insertBefore(n, this); }
  replaceWith(n){ const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p._rm(this); }
  remove(){ if (this.parentNode) this.parentNode._rm(this); }
  get textContent(){ return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(t){ this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (t !== '' && t != null) this.appendChild(new Text(String(t))); }
  set innerHTML(html){ this.textContent = ''; parseInto(this, String(html)); }
  get innerHTML(){ return this.childNodes.map(serialize).join(''); }
  get outerHTML(){ return serialize(this); }
  insertAdjacentHTML(pos, html){ const tmp = new El('div'); parseInto(tmp, html); const ns = [...tmp.childNodes]; if (pos === 'beforeend') ns.forEach(n => this.appendChild(n)); else if (pos === 'afterend') this.after(...ns); else if (pos === 'beforebegin') this.before(...ns); else if (pos === 'afterbegin') ns.reverse().forEach(n => this.insertBefore(n, this.firstChild)); }
  getBoundingClientRect(){ const r = this._rect || { left: 0, top: 0, width: 0, height: 0 }; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; }
  get offsetWidth(){ return this.hidden ? 0 : (this._rect ? this._rect.width : 0); }
  addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn){ this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatch(type, extra = {}){ const ev = { type, target: this, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }, ...extra }; fire(ev); return ev; }
  click(){ return this.dispatch('click'); }
  querySelectorAll(sel){ return qsa(this, sel); }
  querySelector(sel){ return qsa(this, sel)[0] || null; }
  closest(sel){ let n = this; while (n && n.nodeType === 1) { if (matches(n, sel, null)) return n; n = n.parentNode; } return null; }
  matches(sel){ return matches(this, sel, null); }
  focus(){} blur(){}
}
function serialize(n){
  if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  const t = n.tagName.toLowerCase();
  return VOID.has(t) ? `<${t}${a}>` : `<${t}${a}>${n.childNodes.map(serialize).join('')}</${t}>`;
}
function parseInto(root, html){
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { const t = m[1].toUpperCase(); for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === t) { stack.length = i; break; } continue; }
    if (m[2]) {
      const el = new El(m[2]);
      const ar = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g; let a;
      while ((a = ar.exec(m[3] || ''))) {
        const v = decode(a[2] ?? a[3] ?? a[4] ?? '');
        if (a[1] === 'hidden') el.hidden = true; else if (a[1] === 'disabled') { el.disabled = true; el.attrs.disabled = ''; } else el.attrs[a[1]] = v;
      }
      top.appendChild(el);
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] && m[5].trim()) top.appendChild(new Text(decode(m[5])));
  }
}
// Селекторы: список через запятую; составной: tag#id.cls[attr][attr="v"]; сочетания: пробел и >; :scope
function parseSel(sel){
  return sel.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const toks = s.replace(/\s*>\s*/g, ' > ').split(/\s+/);
    const parts = []; let comb = ' ';
    for (const t of toks) { if (t === '>') { comb = '>'; continue; } parts.push({ comb, c: compound(t) }); comb = ' '; }
    return parts;
  });
}
function compound(t){
  const c = { tag: null, id: null, cls: [], attrs: [], scope: false, not: [] };
  const re = /^([a-zA-Z*][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)"?([^"\]]*)"?)?\]|(:scope)|:not\(([^)]*)\)/g; let m;
  while ((m = re.exec(t))) {
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toUpperCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]);
    else if (m[4]) c.attrs.push([m[4], m[5], m[6]]); else if (m[7]) c.scope = true; else if (m[8]) c.not.push(m[8]);
    if (m[0] === '') re.lastIndex++;
  }
  return c;
}
function attrOf(el, k){ if (k === 'hidden') return el.hidden ? '' : null; if (k === 'disabled') return el.disabled ? '' : null; return k in el.attrs ? el.attrs[k] : null; }
function matchC(el, c, scope){
  if (el.nodeType !== 1) return false;
  if (c.scope) return el === scope;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.cls) if (!el.classList.contains(k)) return false;
  for (const [k, op, v] of c.attrs) { const a = attrOf(el, k); if (a === null) return false; if (op === '=' && a !== v) return false; }
  for (const n of c.not) if (matches(el, n, scope)) return false;
  return true;
}
function matchParts(el, parts, i, scope){
  if (!matchC(el, parts[i].c, scope)) return false;
  if (i === 0) return true;
  const comb = parts[i].comb;
  let p = el.parentNode;
  if (comb === '>') return !!p && p.nodeType === 1 && matchParts(p, parts, i - 1, scope);
  while (p && p.nodeType === 1) { if (matchParts(p, parts, i - 1, scope)) return true; p = p.parentNode; }
  return false;
}
const matches = (el, sel, scope) => parseSel(sel).some(parts => matchParts(el, parts, parts.length - 1, scope));
function qsa(root, sel){
  const out = [], list = parseSel(sel);
  const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (list.some(parts => matchParts(c, parts, parts.length - 1, root))) out.push(c); walk(c); } };
  walk(root);
  return out;
}
// события: у элементов (с всплытием) и у документа/окна (с захватом — сначала документ)
const docListeners = {}, winListeners = {};
function fire(ev){
  const path = []; let n = ev.target; while (n && n.nodeType === 1) { path.push(n); n = n.parentNode; }
  for (const fn of (docListeners[ev.type] || []).filter(x => x.cap).map(x => x.fn)) { fn(ev); if (ev.stopped) return; }
  for (const el of path) { for (const fn of el.listeners[ev.type] || []) fn(ev); if (ev.stopped) return; }
  for (const fn of (docListeners[ev.type] || []).filter(x => !x.cap).map(x => x.fn)) fn(ev);
}
const html = new El('html'), head = new El('head'), body = new El('body');
html.appendChild(head); html.appendChild(body);
const doc = {
  documentElement: html, head, body, readyState: 'complete', fullscreenElement: null,
  createElement: t => new El(t), createTextNode: t => new Text(t),
  getElementById: id => qsa(html, '#' + id)[0] || null,
  querySelector: s => qsa(html, s)[0] || null, querySelectorAll: s => qsa(html, s),
  addEventListener: (t, fn, cap) => { (docListeners[t] = docListeners[t] || []).push({ fn, cap: !!(cap === true || cap?.capture) }); },
  removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(x => x.fn !== fn); },
};
Object.defineProperty(html, 'clientWidth', { get: () => ENV.width });

// ═══ Окно: часы, таймеры, хранилища, экран ═══
const ENV = { width: 1280, coarse: false };
const clock = { t: Date.UTC(2026, 9, 15, 10, 0, 0) };
const realNow = Date.now;
Date.now = () => clock.t;
let timers = [], tid = 0;
globalThis.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: clock.t + Math.max(0, ms || 0), fn }); return id; };
globalThis.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
globalThis.setInterval = (fn, ms) => { const id = ++tid; const t = { id, at: clock.t + ms, fn, every: ms }; timers.push(t); return id; };
globalThis.clearInterval = globalThis.clearTimeout;
function advance(ms){
  const end = clock.t + ms;
  for (;;) {
    const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    clock.t = Math.max(clock.t, due.at);
    if (due.every) due.at += due.every; else timers = timers.filter(t => t !== due);
    try { due.fn(); } catch (e) { console.log('timer error', e); }
  }
  clock.t = end;
}
const flushMicro = () => new Promise(r => setImmediate(r));
const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; }, _s: s }; };
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.location = { hash: '#/home', search: '', pathname: '/', hostname: 'dan4ik37.vercel.app', origin: 'https://dan4ik37.vercel.app', href: 'https://dan4ik37.vercel.app/' };
Object.defineProperty(globalThis, 'innerWidth', { get: () => ENV.width, configurable: true });
globalThis.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) ? ENV.coarse : (m => m ? ENV.width <= +m[1] : false)(/max-width:\s*(\d+)px/.exec(q)) });
globalThis.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); };
globalThis.dispatchEvent = ev => { (winListeners[ev.type] || []).forEach(fn => fn(ev)); return true; };
globalThis.Event = class { constructor(t){ this.type = t; } };
const IO = { list: new Map() };
globalThis.IntersectionObserver = class { constructor(cb, o){ this.cb = cb; this.o = o; IO.obs = this; } observe(el){ IO.list.set(el, this); } unobserve(el){ IO.list.delete(el); } disconnect(){} };
const showIO = el => { const o = IO.list.get(el); if (o) o.cb([{ target: el, isIntersecting: true }]); };
globalThis.console = console;
const yaCalls = [];
globalThis.Ya = { Context: { AdvManager: { render: (p, alt) => { yaCalls.push({ p, alt }); } } } };
const flushYa = () => { const q = window.yaContextCb || []; while (q.length) q.shift()(); };
const setHash = h => { location.hash = h; (winListeners.hashchange || []).forEach(fn => fn({ type: 'hashchange' })); };

// профиль (как в js/features/profile.js)
globalThis.currentUser = null; globalThis.currentProfile = null; globalThis.currentRole = null;
globalThis.isVipActive = p => !!p?.is_vip && (!p.vip_until || new Date(p.vip_until) > new Date(Date.now()));
globalThis.getVipTier = p => p && p.vip_tier !== undefined ? (p.vip_tier ? { key: p.vip_tier } : null) : (isVipActive(p) ? { key: 'bronze' } : null);
const toasts = [];
globalThis.xpToast = t => toasts.push(t);

vm.runInThisContext(read('js/core/ads-core.js'), { filename: 'ads-core.js' });
vm.runInThisContext(read('js/core/ad-places.js'), { filename: 'ad-places.js' });
const A = window.D37Ads, M = window.D37AdPlaces, T = M._test;
const IDS = JSON.parse(JSON.stringify(window.ADS_IDS));
function fresh(o = {}){
  T.reset();
  window.ADS_IDS = JSON.parse(JSON.stringify(IDS));
  Object.assign(ENV, { width: 1280, coarse: false }, o.env || {});
  localStorage.removeItem('d37_noads'); localStorage.removeItem('d37_coinad_at');
  currentUser = null; currentProfile = null; currentRole = null;
  T.dbg.on = false; T.dbg.nocaps = false;
  location.hash = o.hash || '#/home';
  yaCalls.length = 0; window.yaContextCb = [];
  timers = timers.filter(t => t.every);   // интервалы модуля оставляем
  T.st();   // визит начинается сейчас
}
ok(typeof A.render === 'function' && typeof M.why === 'function' && typeof M.loading === 'function', 'модули загрузились');

// ═══ 1. Диспетчер ═══
{
  fresh();
  ok(M.why('loading') === '' && M.net('loading') === 'g', 'Google: у загрузки нет своего блока — берёт game_over', M.why('loading'));
  window.ADS_IDS.google = {};
  ok(M.why('loading') === 'id', 'нет номера блока — нельзя (id)');
  window.ADS_IDS.yandex.loading = 'R-A-1-1';
  ok(M.why('loading') === '', 'есть номер — можно', M.why('loading'));
  window.ADS_IDS.google = JSON.parse(JSON.stringify(IDS.google));
  // запасные номера
  ok(M.ids('loading').g === IDS.google.game_over, 'Google: loading берёт блок game_over');
  ok(M.ids('feed_games').g === IDS.google.games_hub && M.ids('rail').g === IDS.google.game_over, 'Google: feed → games_hub, rail → game_over');
  window.ADS_IDS.yandex.game_over = 'R-A-1-9';
  ok(M.ids('break').ya === 'R-A-1-9', 'Яндекс: перерыв без своего блока — блок game_over');
  window.ADS_IDS.yandex.feed = 'R-A-1-5';
  ok(M.ids('feed_videos').ya === 'R-A-1-5' && M.net('feed_videos') === 'ya', 'feed_videos → общий feed');
  ok(!M.hasId('floor') && !M.hasId('interstitial'), 'floor и полноэкранная — только Яндекс (Google нет)');
  window.ADS_IDS.h5games = true;
  ok(M.hasId('interstitial'), 'полноэкранная: H5 Games тоже считается');
  window.ADS_IDS.h5games = false;

  // частота: промежуток и максимум у loading (90 с, 6 за визит)
  M.mark('loading');
  ok(M.why('loading') === 'gap', 'loading: второй раз сразу — gap');
  advance(91e3);
  ok(M.why('loading') === '', 'через 91 с — можно');
  for (let i = 0; i < 5; i++) { M.mark('loading'); advance(91e3); }
  ok(M.why('loading') === 'max', '6 показов за визит — больше нельзя', M.why('loading'));
  // визит сохраняется в вкладке и сбрасывается после 30 минут тишины
  ok(JSON.parse(sessionStorage.getItem('d37_ads_s')).p.loading.n === 6, 'визит записан в sessionStorage');
  T.reset(); sessionStorage.setItem('d37_ads_s', JSON.stringify({ t0: clock.t - 5e3, at: clock.t, n: 3, p: { loading: { n: 6, at: clock.t - 100e3 } } }));
  ok(M.why('loading') === 'max', 'обновил страницу — лимит визита остался');
  advance(31 * 60e3); T.reset(); sessionStorage.setItem('d37_ads_s', JSON.stringify({ t0: clock.t - 40 * 60e3, at: clock.t - 31 * 60e3, n: 3, p: { loading: { n: 6, at: clock.t - 31 * 60e3 } } }));
  ok(M.why('loading') === '', '30 минут тишины — новый визит', M.why('loading'));

  // первые секунды визита: перерыв — не раньше 2 минут
  fresh(); window.ADS_IDS.yandex.game_over = 'R-A-1-9';
  ok(M.why('break') === 'first', 'перерыв в первые 2 минуты визита — нельзя');
  advance(121e3);
  ok(M.why('break') === '', 'через 2 минуты — можно', M.why('break'));
  ENV.coarse = true;
  ok(M.why('break') === 'desk', 'перерыв — только компьютер');
  ENV.coarse = false;
  // общий лимит визита
  fresh(); window.ADS_IDS.yandex.games_hub = 'R-A-1-2';
  for (let i = 0; i < 40; i++) M.mark('games_hub');
  ok(M.why('games_hub') === 'budget', '40 показов за визит — общий лимит');
  T.dbg.nocaps = true;
  ok(M.why('games_hub') === '', 'отладка «без лимитов» (adsdebug=2) — лимиты не мешают');
}

// ═══ 1б. VIP и персонал ═══
{
  fresh(); window.ADS_IDS.yandex.games_hub = 'R-A-1-2';
  currentUser = { id: 'u1' }; currentProfile = { id: 'u1', role: 'user', is_vip: true, vip_until: new Date(clock.t + 20 * 864e5).toISOString() };
  ok(M.why('games_hub') === 'vip', 'VIP — без рекламы');
  ok(M.noAdsPerk(), 'noAdsPerk у VIP');
  dispatchEvent(new Event('d37:auth')); advance(100);
  const c = JSON.parse(localStorage.getItem('d37_noads') || 'null');
  ok(c && c.until > clock.t && c.until <= clock.t + 7 * 864e5 + 1, 'после входа VIP запомнен в браузере (не дольше недели)', c);
  ok(window.adsbygoogle?.pauseAdRequests === 1, 'запросы AdSense на паузе');
  currentProfile = null;   // серверная страница / профиль ещё грузится
  ok(M.noAdsPerk(), 'без профиля — по памяти браузера');
  currentProfile = { id: 'u1', role: 'user', is_vip: false };
  ok(!M.noAdsPerk(), 'VIP кончился — реклама вернётся (профиль важнее памяти)');
  currentUser = null; currentProfile = null; dispatchEvent(new Event('d37:auth')); advance(100);
  ok(localStorage.getItem('d37_noads') === null && !M.noAdsPerk(), 'вышел — память стёрта, реклама есть');
  ok(window.adsbygoogle.pauseAdRequests === 0, 'пауза AdSense снята');
  currentUser = { id: 'm1' }; currentProfile = { id: 'm1', role: 'user' }; currentRole = 'moderator';
  ok(M.why('games_hub') === 'vip', 'персонал — без рекламы (и без своих случайных кликов)');
  currentRole = 'user'; currentProfile = { id: 'u2', vip_tier: 'silver' };
  ok(M.why('games_hub') === 'vip', 'VIP за уровень (vip_tier из profiles_public)');
  currentProfile = { id: 'u2', vip_tier: null, is_vip: false };
  ok(M.why('games_hub') === '', 'обычный игрок — с рекламой');
  // вошёл VIP, а реклама уже показана — убрать
  currentUser = { id: 'u3' }; currentProfile = { id: 'u3', role: 'user', is_vip: true };
  const slot = new El('div'); slot.className = 'd37-ad'; slot.innerHTML = '<span>Реклама</span>'; body.appendChild(slot);
  const fd = new El('div'); fd.className = 'd37-feed'; body.appendChild(fd);
  dispatchEvent(new Event('d37:auth')); advance(100);
  ok(slot.hidden && slot.innerHTML === '' && !fd.isConnected, 'вошёл VIP — показанная реклама убрана');
  slot.remove();
  // рекламу за награду VIP не отнимаем (она по кнопке)
  window.ADS_IDS.yandex.rewarded_desktop = 'R-A-1-7';
  ok(A.rewardReady(), 'VIP: реклама за награду по кнопке остаётся');
}

// ═══ 1в. «Рядом нельзя» ═══
{
  fresh(); for (const k of ['loading', 'game_over', 'rail', 'feed', 'games_hub']) window.ADS_IDS.yandex[k] = 'R-A-1-' + k;
  M.ctx('gambling', true);
  ok(['loading', 'game_over', 'rail', 'feed', 'games_hub'].every(k => M.why(k) === 'gambling'), 'ролики про кейсы — нигде нельзя');
  M.ctx('gambling', false);
  location.hash = '#/games/studio/play/abc123';
  ok(M.why('loading') === 'ugc' && M.why('rail') === 'ugc' && M.why('feed') === 'ugc', 'чужая игра (не знаем, проверена ли) — без загрузки, столбика, ленты');
  ok(M.why('game_over') === '', 'а game_over у игр «в каталоге» студия ставит сама (знает статус)');
  location.hash = '#/games/studio3d/join/x1y2';
  ok(M.why('loading') === 'ugc', 'вход в чужой мир по ссылке — ugc');
  location.hash = '#/games/unity/edit/zz';
  ok(M.why('rail') === 'ugc', 'Unity: редактор чужой сборки — ugc');
  location.hash = '#/games/studio';
  ok(M.why('feed') === '', 'главная «Студии игр» (каталог проверенных) — можно');
  location.hash = '#/games/studio3d';
  ok(M.why('loading') === '', 'Студия 3D: свой мир в редакторе — можно');
  ok(M.why('loading', { ugc: true }) === 'ugc', 'явный флаг ugc');
  M.ctx('playing', true);
  ok(M.why('break', { ignoreId: true }) === 'playing', 'идёт партия — перерыва нет');
  M.ctx('playing', false);
  // азартные — копия правила с сервера
  const src = /const GAMBLING_RE = (\/.+\/i);/.exec(read('api/_lib/yt.js'))[1];
  ok(T.GAMBLING_RE.toString() === src, 'GAMBLING_RE как в api/_lib/yt.js', [T.GAMBLING_RE.toString(), src]);
  ok(M.gambling(['Открыл кейсы на GGDROP', 'x']) && !M.gambling(['Minecraft выживание', 'Roblox']), 'азартные названия узнаются');
}

// ═══ 2. ads-core через диспетчер ═══
{
  fresh(); window.ADS_IDS.google = {};
  const el = new El('div'); body.appendChild(el);
  ok(A.render(el, 'games_hub') === false && el.hidden, 'нет номера — место скрыто');
  T.dbg.on = true;
  ok(A.render(el, 'games_hub') === true && /d37-ad-ph/.test(el.innerHTML) && /games_hub/.test(el.innerHTML), 'отладка: пустое место — рамка с подписью', el.innerHTML);
  T.dbg.on = false;
  window.ADS_IDS.yandex.game_over = 'R-A-9-1';
  ok(A.render(el, 'game_over') === true && el.classList.contains('d37-ad') && /Реклама/.test(el.textContent), 'Яндекс: место с подписью «Реклама»');
  flushYa();
  const call = yaCalls.pop();
  ok(call && call.p.blockId === 'R-A-9-1' && call.p.darkTheme === true && call.p.statId === 14 && typeof call.alt === 'function', 'РСЯ: тёмная тема, statId места, обработчик «нет рекламы»', call && call.p);
  ok(T.st().p.game_over?.n === 1, 'показ засчитан');
  let empty = 0;
  A.render(el, 'game_over', { checked: true, onEmpty: () => empty++ }); flushYa(); yaCalls.pop().alt();
  ok(empty === 1, 'нет рекламы у РСЯ → onEmpty');
  // Google: «детская» обработка
  fresh(); window.ADS_IDS.kids = 1;
  const g = new El('div'); body.appendChild(g);
  window.adsbygoogle = [];
  ok(A.render(g, 'games_hub') === true, 'Google: блок есть (games_hub)');
  const ins = g.querySelector('ins');
  ok(ins && ins.getAttribute('data-ad-slot') === IDS.google.games_hub && ins.getAttribute('data-tag-for-age-treatment') === '1', 'Google: data-tag-for-age-treatment="1"', ins && ins.attrs);
  // VIP — даже прямой вызов render не показывает
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  const g2 = new El('div'); body.appendChild(g2);
  ok(A.render(g2, 'games_hub') === false && g2.hidden, 'VIP: прямой render тоже пусто');
  g.remove(); g2.remove(); el.remove();

  // полоска на телефоне: 320–420 px, не раньше 15 с
  fresh({ env: { coarse: true, width: 400 } }); window.ADS_IDS.yandex.floor = 'R-A-9-2';
  ok(M.why('floor') === 'first', 'полоска: в первые 15 с — нет');
  advance(16e3);
  ok(M.why('floor') === '', 'полоска: 400 px, 16 с — можно');
  ENV.width = 600;
  ok(M.why('floor') === 'wide', 'полоска: 600 px (планшет, телефон боком) — нельзя (РСЯ: overlay 320–420 px)');

  // полноэкранная между партиями: не после первой, не раньше минуты визита, не чаще раза в 3 минуты, только телефон
  fresh({ env: { coarse: true, width: 400 } }); window.ADS_IDS.yandex.fullscreen = 'R-A-9-3';
  advance(61e3);
  ok(A.interstitial('t') === false, 'первая партия визита — без полноэкранной');
  ok(A.interstitial('t') === true, 'вторая — можно');
  flushYa();
  ok(yaCalls.some(c => c.p.type === 'fullscreen'), 'РСЯ fullscreen вызван');
  ok(A.interstitial('t') === false, 'сразу третья — нельзя (3 минуты)');
  advance(181e3);
  ok(A.interstitial('t') === true, 'через 3 минуты — снова можно');
  ENV.coarse = false; ENV.width = 1280;
  advance(181e3);
  ok(A.interstitial('t') === false, 'компьютер — полноэкранной нет (РСЯ: на компьютере только при переходе между страницами)');
}

console.log(`\nads-test: ${pass} ok, ${fail} fail`);
Date.now = realNow;
process.exit(fail ? 1 : 0);

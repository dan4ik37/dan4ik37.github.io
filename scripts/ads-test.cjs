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
    this.listeners = {}; this._rect = null; this.hidden = false; this.disabled = false;
    const style = {};
    Object.defineProperty(style, 'cssText', { enumerable: false, get: () => Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';'),
      set: t => { for (const k of Object.keys(style)) delete style[k]; String(t).split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) style[camel(p.slice(0, i).trim())] = p.slice(i + 1).trim(); }); } });
    this.style = style;
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
  contains(n){ while (n) { if (n === this) return true; n = n.parentNode; } return false; }
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
globalThis.getComputedStyle = el => ({ position: el.style.position || (el.classList.contains('wld-status') || el.classList.contains('s3-loading') ? 'absolute' : 'static') });
const IO = { list: new Map() };
globalThis.IntersectionObserver = class { constructor(cb, o){ this.cb = cb; this.o = o; IO.obs = this; } observe(el){ IO.list.set(el, this); } unobserve(el){ IO.list.delete(el); } disconnect(){} };
const showIO = el => { const o = IO.list.get(el); if (o) o.cb([{ target: el, isIntersecting: true }]); };
globalThis.console = console;
const yaCalls = [], YA = { fill: false };
globalThis.Ya = { Context: { AdvManager: { render: (p, alt) => { yaCalls.push({ p, alt }); if (YA.fill && p.renderTo) doc.getElementById(p.renderTo)?.appendChild(new El('iframe')); } } } };
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
  T.dbg.on = false; T.dbg.frames = false; T.dbg.nocaps = false;
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
  // под плеером в чате (chatplayer.js): тот же блок, что под игрой; только компьютер; раз в 2 минуты, до 8; кейсы — нельзя
  ok(M.why('chat_player') === '', 'место под плеером чата — можно (запасной блок game_over)', M.why('chat_player'));
  M.mark('chat_player'); advance(60e3);
  ok(M.why('chat_player') === 'gap', 'под плеером — не чаще раза в 2 минуты');
  advance(61e3);
  ok(M.why('chat_player') === '', 'через 2 минуты — снова можно');
  ENV.coarse = true; ok(M.why('chat_player') === 'desk', 'под плеером — только компьютер (на телефоне плеер и так сверху)'); ENV.coarse = false;
  M.ctx('gambling', true); ok(M.why('chat_player') === 'gambling', 'в плеере кейсы — рекламы нет'); M.ctx('gambling', false);
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
  const ga = new El('div'); ga.id = 'gamesAd'; ga.innerHTML = '<div class="d37-break"><div class="d37-break-t">☕ Перерыв</div><div class="d37-break-ad d37-ad"></div></div>'; body.appendChild(ga);
  dispatchEvent(new Event('d37:auth')); advance(100);
  ok(slot.hidden && slot.innerHTML === '' && !fd.isConnected, 'вошёл VIP — показанная реклама убрана');
  ok(ga.hidden && ga.innerHTML === '', 'и «Перерыв» под игрой — тоже');
  slot.remove(); ga.remove();
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
  T.dbg.on = T.dbg.frames = true;
  ok(A.render(el, 'games_hub') === true && /d37-ad-ph/.test(el.innerHTML) && /games_hub/.test(el.innerHTML) && /номера блока нет/.test(el.innerHTML), 'отладка: место — рамка с подписью (запросов в сеть нет)', el.innerHTML);
  window.ADS_IDS.yandex.game_over = 'R-A-9-1';
  ok(A.render(el, 'game_over') === true && /R-A-9-1/.test(el.innerHTML) && !el.querySelector('[id^="yandex_rtb"]'), 'отладка: и с номером блока — рамка, где видно номер');
  T.dbg.on = T.dbg.frames = false;
  fresh(); window.ADS_IDS.google = {};
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
  ok(ins.getAttribute('data-ad-format') === 'auto' && ins.getAttribute('data-full-width-responsive') === 'true', 'Google: обычное место — auto, на всю ширину');
  const gr = new El('div'); body.appendChild(gr);
  ok(M.show(gr, 'rail', { checked: true }) && gr.querySelector('ins')?.getAttribute('data-ad-format') === 'vertical' && !gr.querySelector('ins').hasAttribute('data-full-width-responsive'), 'Google: столбик — вертикальный формат, не растягивать');
  gr.remove();
  // VIP — даже прямой вызов render не показывает
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  const g2 = new El('div'); body.appendChild(g2);
  ok(A.render(g2, 'games_hub') === false && g2.hidden, 'VIP: прямой render тоже пусто');
  g.remove(); g2.remove(); el.remove();

  // полоска на телефоне: 320–420 px, не раньше 15 с
  fresh({ env: { coarse: true, width: 400 } }); window.ADS_IDS.yandex.floor = 'R-A-9-2';
  ok(M.why('floor') === 'first', 'полоска: в первые 12 с визита — нет');
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

// ═══ 3. Экран загрузки ═══
{
  fresh(); window.ADS_IDS.yandex.loading = 'R-A-2-1';
  const box = new El('div'); body.appendChild(box); box.innerHTML = '<div class="gm-loading">Загружаем игру…</div>';
  let h = M.loading({ anchor: box.firstChild, game: 'snake' });
  advance(1000); h.done(); advance(2000);
  ok(!box.querySelector('.d37-adload') && !T.st().p.loading, 'загрузилось за 1 с — рекламы нет');
  h = M.loading({ anchor: box.firstChild, game: 'horde' });
  advance(1400);
  ok(!box.querySelector('.d37-adload'), '1,4 с — ещё нет');
  advance(200);
  const ld = box.querySelector('.d37-adload');
  ok(ld && ld.parentNode === box.firstChild && /💡/.test(ld.textContent) && ld.querySelector('.d37-ad') && /Реклама/.test(ld.textContent), '1,6 с — реклама под прогрессом, рядом подсказка', ld && ld.outerHTML);
  flushYa();
  ok(yaCalls.some(c => c.p.blockId === 'R-A-2-1' && c.p.statId === 11), 'РСЯ: блок загрузки, statId 11');
  h.done();
  ok(!box.querySelector('.d37-adload'), 'done() — реклама убрана сразу (игру не задерживаем)');
  h = M.loading({ anchor: box.firstChild, game: 'td' }); advance(3000);
  ok(!box.querySelector('.d37-adload'), 'через 3 с снова грузится — без рекламы (не чаще раза в 90 с)');
  h.done();
  // мир: games.js рекламу не ставит, а потраченное время засчитывается экрану мира
  advance(100e3);
  const g1 = M.loading({ anchor: box.firstChild, game: 'world' });
  advance(1300);
  ok(!box.querySelector('.d37-adload'), 'мир: на общем экране загрузки рекламы нет');
  const st = new El('div'); st.className = 'wld-status'; st._rect = { left: 0, top: 0, width: 1100, height: 600 }; body.appendChild(st);
  const g2 = M.loading({ anchor: st, tip: 'world' });
  g1.done();
  advance(400);
  ok(!st.querySelector('.d37-adload'), 'экран мира: только что открылся — ещё нет (≥ 0,6 с на новом экране)');
  advance(300);
  ok(!!st.querySelector('.d37-adload') && /Сядь|плавать|участок|карточка|костра/.test(st.textContent), 'экран мира: всего 2 с загрузки — реклама и подсказка про мир', st.textContent);
  g2.done();
  advance(100e3);
  st._rect = { left: 0, top: 0, width: 380, height: 300 };   // низкое окно мира (телефон боком): реклама бы обрезалась
  const g2b = M.loading({ anchor: st, tip: 'world' }); advance(2000);
  ok(!st.querySelector('.d37-adload'), 'экран загрузки поверх окна ниже 380 px — без рекламы (обрезанной не бывает)');
  g2b.done(); st.remove();
  // чужое
  advance(100e3);
  const s3 = new El('div'); s3.className = 's3-loading'; body.appendChild(s3);
  const g3 = M.loading({ anchor: s3, tip: 'studio', ugc: true }); advance(3000);
  ok(!s3.querySelector('.d37-adload'), 'чужой мир (play/join) — экран загрузки без рекламы');
  g3.done(); s3.remove();
  const g4 = M.loading({ anchor: box.firstChild, game: 'studio', param: 'play/abc' }); advance(3000);
  ok(!box.querySelector('.d37-adload'), 'чужая игра «Студии игр» — без рекламы на загрузке');
  g4.done();
  const tmp = new El('div'); body.appendChild(tmp);
  M.loading({ anchor: tmp }); tmp.remove(); advance(3000);
  ok(!tmp.querySelector('.d37-adload'), 'экран загрузки уже закрыт — ничего не вставляем');
  // компилятор: карточка в углу, если окно не тесное
  advance(100e3);
  const view = new El('div'); view._rect = { left: 0, top: 0, width: 900, height: 600 }; body.appendChild(view);
  const c1 = M.loading({ host: view, card: '⚙️ Сборка C++', tip: 'compile' });
  c1.step('загрузка компилятора 12%'); advance(1600);
  const card = view.querySelector('.d37-adcard');
  ok(card && /12%/.test(card.textContent) && card.querySelector('.d37-adcard-x') && card.querySelector('.d37-ad'), 'компилятор: карточка с прогрессом, «✕» и рекламой', card && card.outerHTML);
  c1.step('загрузка компилятора 64%');
  ok(card && /64%/.test(card.textContent), 'прогресс обновляется');
  card?.querySelector('.d37-adcard-x').click();
  ok(!view.querySelector('.d37-adcard'), '«✕» — карточку можно скрыть');
  c1.done();
  advance(100e3);
  view._rect = { left: 0, top: 0, width: 360, height: 500 };
  const c2 = M.loading({ host: view, card: '⚙️', tip: 'compile' }); advance(2000);
  ok(!view.querySelector('.d37-adcard'), 'тесное окно (телефон) — без карточки');
  c2.done();
  advance(100e3); currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  const g6 = M.loading({ anchor: box.firstChild, game: 'horde' }); advance(2000);
  ok(!box.querySelector('.d37-adload'), 'VIP — экран загрузки без рекламы');
  g6.done();
  // нет рекламы у РСЯ — убираем блок, подсказка остаётся
  fresh(); window.ADS_IDS.yandex.loading = 'R-A-2-1';
  const b2 = new El('div'); body.appendChild(b2);
  const g7 = M.loading({ anchor: b2 }); advance(1600); flushYa(); yaCalls.pop().alt();
  ok(b2.querySelector('.d37-adload') && !b2.querySelector('.d37-adload-ad') && /💡/.test(b2.textContent), 'у сети нет рекламы — пустого места нет, подсказка осталась');
  g7.done(); b2.remove(); box.remove(); view.remove();
}

// ═══ 4. После партии: под игрой и «☕ Перерыв» ═══
{
  fresh({ hash: '#/games/snake' }); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.game_over = 'R-A-4-1';
  const stage = new El('div'); stage.id = 'gamesStage'; const sb = new El('div'); sb.id = 'gamesStageBox'; stage.appendChild(sb); body.appendChild(stage);
  ok(M.afterRound(stage) === 'game_over', '1-я партия — реклама под игрой (game_over)');
  const box = stage.querySelector('#gamesAd');
  ok(box && !box.hidden && box.dataset.net === 'ya' && box.parentNode === stage && box.previousElementSibling !== box, 'место под игрой (после поля), сеть — Яндекс');
  advance(30e3);
  ok(M.afterRound(stage) === false && box.querySelector('[id^="yandex_rtb"]'), 'через 30 с — то же объявление (обновление не чаще 90 с)');
  advance(70e3);
  ok(M.afterRound(stage) === 'game_over' && !box.querySelector('.d37-break'), '3-я партия, но визиту < 2 мин — без перерыва, обычное обновление (Яндекс, ≥ 90 с)');
  advance(100e3); M.afterRound(stage);
  advance(100e3); M.afterRound(stage);
  advance(100e3);
  ok(M.afterRound(stage) === 'break' && box.querySelector('.d37-break') && /Перерыв/.test(box.textContent) && /6 партий подряд/.test(box.textContent), '6-я партия — «☕ Перерыв · 6 партий подряд»', box.textContent);
  ok(!!box.querySelector('.d37-break-ad.d37-ad'), 'в перерыве — блок рекламы с подписью');
  flushYa();
  ok(yaCalls.some(c => c.p.statId === 12 && c.p.blockId === 'R-A-4-1'), 'перерыв без своего блока — блок game_over, statId 12');
  advance(1000); sb.dispatch('pointerdown');
  ok(box.querySelector('.d37-break'), 'нажатие в первые 1,5 с не гасит перерыв (случайное)');
  advance(1000); sb.dispatch('pointerdown');
  ok(!box.querySelector('.d37-break-t') && !box.querySelector('.d37-break') && !!box.querySelector('.d37-ad'), 'снова играет — «Перерыв» погас, реклама осталась (без перезагрузки)');
  ok(M.state().playing === true, 'идёт партия');
  for (let i = 0; i < 3; i++) { advance(91e3); M.afterRound(stage); }   // 9-я партия — через 273 с после перерыва
  ok(!box.querySelector('.d37-break'), 'следующий перерыв — не раньше чем через 5 минут');
  for (let i = 0; i < 3; i++) { advance(91e3); M.afterRound(stage); }   // 12-я — через 546 с
  ok(box.querySelector('.d37-break'), '12-я партия, прошло > 5 минут — снова перерыв');
  // ушёл из игры — объявление под ней убираем совсем
  setHash('#/games/td');
  ok(box.innerHTML === '' && !box.dataset.net, 'ушёл в другую игру — место под игрой очищено (скрытой рекламы нет)');
  // телефон — только game_over
  fresh({ hash: '#/games/snake', env: { coarse: true, width: 400 } }); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.game_over = 'R-A-4-1';
  advance(200e3);
  const res = []; for (let i = 0; i < 3; i++) { res.push(M.afterRound(stage)); advance(91e3); }
  ok(res[2] === 'game_over' && !box.querySelector('.d37-break'), 'телефон: перерывов нет (там полноэкранная от игры)', res);
  // Google: без обновлений и без перерыва в том же месте
  fresh({ hash: '#/games/snake' }); window.ADS_IDS.yandex = {};
  box.innerHTML = ''; delete box.dataset.net;
  ok(M.afterRound(stage) === 'game_over' && box.dataset.net === 'g', 'Google: место под игрой');
  advance(200e3);
  ok(M.afterRound(stage) === false && M.afterRound(stage) === false, 'Google: то же объявление, обновлять нельзя (только по просьбе человека)');
  // лимит визита кончился — показанное не стираем
  fresh({ hash: '#/games/snake' }); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.game_over = 'R-A-4-1';
  box.innerHTML = ''; delete box.dataset.net;
  M.afterRound(stage);
  for (let i = 0; i < 40; i++) M.mark('games_hub');
  advance(100e3);
  ok(M.afterRound(stage) === false && !!box.querySelector('[id^="yandex_rtb"]'), 'лимит визита — новое не показываем, показанное не стираем');
  stage.remove();
}

// ═══ 5. Карточки «Реклама» в списках ═══
{
  fresh(); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.feed = 'R-A-5-1';
  const grid = new El('div'); body.appendChild(grid);
  const fill = (n, t) => { grid.innerHTML = Array.from({ length: n }, (_, i) => `<a class="gm-card">${t ? t(i) : 'Игра ' + (i + 1)}</a>`).join(''); };
  fill(40);
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 2 }) === 2, 'витрина из 40 игр — 2 карточки');
  let kids = grid.children;
  ok(kids[10].classList.contains('d37-feed') && kids[21].classList.contains('d37-feed') && kids.filter(k => k.classList.contains('d37-feed')).length === 2, 'после 10-й и 20-й игры', kids.map(k => k.className).join(','));
  ok(!kids[10].querySelector('.d37-ad-label') && !T.st().p.feed, 'реклама не грузится, пока карточка далеко от экрана');
  showIO(kids[10]); flushYa();
  ok(kids[10].classList.contains('d37-ad') && /Реклама/.test(kids[10].textContent) && yaCalls.some(c => c.p.blockId === 'R-A-5-1' && c.p.statId === 21), 'подъехала — реклама с подписью «Реклама», statId 21');
  ok(T.st().p.feed?.n === 1, 'засчитана одна (вторая ещё не видна)');
  M.feed(grid, { place: 'feed_games', every: 10, max: 2 });
  ok(grid.children.filter(k => k.classList.contains('d37-feed')).length === 2, 'перерисовка списка — карточки не копятся');
  fill(20);
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 3 }) === 1 && !grid.lastElementChild.classList.contains('d37-feed'), 'не последней в списке (после 20-й из 20 — нет)');
  fill(8);
  ok(M.feed(grid, { place: 'feed_games', every: 10 }) === 0, 'короткий список — без рекламы');
  fill(40, i => i === 33 ? 'Открываю кейсы GGDROP' : 'Ролик ' + i);
  ok(M.feed(grid, { place: 'feed_videos', every: 12, start: 16, titles: grid.children.map(c => c.textContent) }) === 0, 'в списке есть ролик про кейсы — в нём рекламы нет совсем');
  fill(40);
  ok(M.feed(grid, { place: 'feed_videos', every: 12, start: 16, max: 3 }) === 2 && grid.children[16].classList.contains('d37-feed'), 'видео: после 16-й и 28-й', grid.children.map(k => k.className).join(','));
  // нет рекламы у сети — своя подсказка (место не пустует и не прыгает)
  showIO(grid.children[16]); flushYa(); yaCalls.pop().alt();
  const hc = grid.children[16];
  ok(hc.classList.contains('d37-house') && hc.querySelector('a') && !/Реклама/.test(hc.textContent), 'у сети нет рекламы — своя подсказка без пометки «Реклама»', hc.outerHTML);
  // блокировщик рекламы: скрипт РСЯ не пришёл — через 8 с своя подсказка; пришла реклама — остаётся
  fill(40);
  M.feed(grid, { place: 'feed_videos', every: 12, start: 16, max: 3 });
  const a1 = grid.children[16], a2 = grid.children[29];
  showIO(a1); advance(8100);
  ok(a1.classList.contains('d37-house'), 'блокировщик: через 8 с пустая карточка «Реклама» → своя подсказка');
  YA.fill = true; showIO(a2); flushYa(); advance(8100); YA.fill = false;
  ok(a2.classList.contains('d37-ad') && !a2.classList.contains('d37-house') && a2.querySelector('iframe'), 'реклама пришла — карточка остаётся рекламой');
  // строка на всю ширину (мелкие карточки «Студии игр»)
  fill(30);
  M.feed(grid, { place: 'feed_ugc', every: 8, row: true, max: 2 });
  ok(grid.children[8].classList.contains('row'), 'каталог игр игроков — карточка на всю строку');
  // VIP вошёл, пока листал — карточка исчезает до загрузки
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  const c8 = grid.children[8]; showIO(c8);
  ok(!c8.isConnected, 'VIP вошёл, пока листал — карточка убрана');
  ok(M.feed(grid, { place: 'feed_ugc', every: 8, row: true }) === 0, 'VIP — карточек нет');
  currentUser = null; currentProfile = null;
  // лимит за визит (16)
  fresh(); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.feed = 'R-A-5-1';
  for (let i = 0; i < 15; i++) M.mark('feed_games');
  fill(40);
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 3 }) === 1, 'за визит не больше 16 — осталась одна');
  // отладка: рамки, даже без номера блока
  fresh(); window.ADS_IDS.google = {}; T.dbg.on = T.dbg.frames = true;
  fill(40);
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 2 }) === 2, 'отладка: места видны и без номера блока');
  showIO(grid.children[10]);
  ok(/feed_games/.test(grid.children[10].textContent) && grid.children[10].querySelector('.d37-ad-ph'), 'отладка: рамка с названием места');
  T.dbg.on = T.dbg.frames = false;
  grid.remove();
}

// ═══ 6. Столбик справа от игры ═══
{
  fresh({ hash: '#/games/2048', env: { width: 1920 } }); window.ADS_IDS.google = {}; window.ADS_IDS.yandex.rail = 'R-A-6-1';
  YA.fill = true;   // сети «отвечают» (иначе через 8 с пустой столбик убирается — это проверено отдельно ниже)
  window.yaContextCb = { push: f => f() };   // скрипт РСЯ «загружен»: очередь выполняется сразу
  const savedIntervals = timers.filter(t => t.every); timers = timers.filter(t => !t.every);   // проверка раз в 2 с — вручную
  window.adsbygoogle = { push(){ doc.querySelectorAll('ins.adsbygoogle').forEach(i => { if (!i.hasAttribute('data-ad-status')) i.setAttribute('data-ad-status', 'filled'); }); } };
  const page = new El('div'); page.id = 'games-page';
  const stage = new El('div'); stage.id = 'gamesStage';
  const sbox = new El('div'); sbox.id = 'gamesStageBox';
  const cv = new El('canvas');
  sbox.appendChild(cv); stage.appendChild(sbox); page.appendChild(stage); body.appendChild(page);
  const layout = W => {   // как в index.html: .wrap до 1200 px по центру, поля 32 px; игра — поле 560 px посередине
    ENV.width = W;
    const pl = Math.max(0, (W - 1200) / 2), pw = Math.min(W, 1200);
    page._rect = { left: pl, top: 0, width: pw, height: 2000 };
    stage._rect = { left: pl + 32, top: 160, width: pw - 64, height: 760 };
    sbox._rect = { left: pl + 50, top: 220, width: pw - 100, height: 680 };
    cv._rect = { left: W / 2 - 280, top: 240, width: 560, height: 560 };
  };
  layout(1920);
  M.railTick();
  ok(!T.RAIL.el, 'первые 15 с визита — столбика нет');
  advance(16e3); M.railTick();
  const r = T.RAIL.el;
  ok(r && r.parentNode === page && T.RAIL.w === 300, '1920 px: столбик 300 px в поле справа', T.RAIL.w);
  const L = parseFloat(r?.style.left), stR = 360 + 1136 + 32 - 360;   // правый край игры от раздела = 32 + 1136
  ok(L >= 1168 + 40 && L + 300 <= 1920 - 360 - 16 + 360 - 16 + 16 && L + 360 + 300 <= 1920 - 16, 'не ближе 40 px к игре и 16 px к краю экрана (полоса прокрутки)', { L, stR });
  ok(r.style.top === '160px' && parseFloat(r.style.height) >= 640, 'сверху вровень с игрой, высота — на всю игру (липкий внутри)');
  ok(r.querySelector('.d37-rail-in.d37-ad') && /Реклама/.test(r.textContent), 'внутри — липкий блок с подписью «Реклама»');
  flushYa();
  ok(yaCalls.some(c => c.p.blockId === 'R-A-6-1' && c.p.statId === 13), 'РСЯ: блок столбика, statId 13');
  advance(9e3); M.railTick();
  ok(!!T.RAIL.el, 'реклама пришла — столбик стоит (без обновлений)');
  layout(1600); M.railTick();
  ok(!T.RAIL.el, '1600 px — 300 px не влезает: убран, новый (160 px) — не раньше чем через минуту');
  advance(61e3); M.railTick();
  ok(T.RAIL.el && T.RAIL.w === 160, '1600 px через минуту — узкий столбик 160 px');
  layout(1500); M.railTick();
  ok(!T.RAIL.el, '1500 px — места нет (меньше 160 + отступы) — столбик убран');
  layout(1366); M.railTick();
  ok(!T.RAIL.el, '1366 px (меньше 1400) — нет');
  layout(1920); advance(61e3); M.railTick();
  ok(!!T.RAIL.el, 'снова широко, прошла минута — столбик вернулся');
  html.classList.add('s3-open'); M.railTick();
  ok(!T.RAIL.el, 'окно Студии 3D поверх — столбик убран (скрытой рекламы не бывает)');
  html.classList.remove('s3-open');
  advance(61e3); M.railTick();
  ok(!!T.RAIL.el, 'студию закрыли — вернулся (через минуту)');
  html.classList.add('hd-lock'); M.railTick();
  ok(!T.RAIL.el, '«Орда» на весь экран (hd-lock) — столбика нет');
  html.classList.remove('hd-lock'); advance(61e3); M.railTick();
  // «липкий» вручную (у сайта overflow-x: hidden на html и body — position: sticky не работает)
  const rin = T.RAIL.el.firstChild, scrollTo = r => { T.RAIL.el._rect = r; dispatchEvent(new Event('scroll')); advance(20); };
  scrollTo({ left: 1600, top: 200, width: 300, height: 900 });
  ok(rin.style.position === 'absolute' && rin.style.top === '0', 'раздел игры ещё внизу — блок стоит в начале столбика (едет со страницей)');
  scrollTo({ left: 1600, top: -150, width: 300, height: 900 });
  ok(rin.style.position === 'fixed' && rin.style.top === '84px' && rin.style.left === '1600px' && rin.style.width === '300px', 'раздел на экране — блок держится на 84 px сверху', rin.style);
  scrollTo({ left: 1600, top: -700, width: 300, height: 900 });
  ok(rin.style.position === 'absolute' && rin.style.bottom === '0', 'раздел уезжает — блок уезжает вместе с ним (не висит над другим)');
  // что-то легло поверх столбика: маленькая всплывашка — не страшно; окно на весь экран своим способом — убрать
  Object.defineProperty(globalThis, 'innerHeight', { value: 1080, configurable: true });
  T.RAIL.el.firstChild._rect = { left: 1600, top: 84, width: 300, height: 600 };
  const toastEl = new El('div'); toastEl._rect = { left: 1650, top: 350, width: 200, height: 60 }; body.appendChild(toastEl);
  doc.elementFromPoint = () => toastEl; M.railTick();
  ok(!!T.RAIL.el, 'всплывашка поверх части столбика — столбик остаётся');
  const cover = new El('div'); cover._rect = { left: 0, top: 0, width: 1920, height: 1080 }; const inCover = new El('canvas'); inCover._rect = { left: 1500, top: 300, width: 100, height: 100 }; cover.appendChild(inCover); body.appendChild(cover);
  doc.elementFromPoint = () => inCover; M.railTick();
  ok(!T.RAIL.el, 'окно «на весь экран» накрыло столбик — убран (скрытой рекламы не бывает)');
  delete doc.elementFromPoint; toastEl.remove(); cover.remove(); advance(61e3); M.railTick();
  setHash('#/games'); M.railTick();
  ok(!T.RAIL.el, 'ушёл из игры в витрину — столбика нет');
  setHash('#/games/2048'); advance(10e3); M.railTick();
  ok(!T.RAIL.el, 'вернулся в игру через 10 с — новый столбик не раньше минуты');
  advance(61e3); M.railTick();
  ok(!!T.RAIL.el, 'через минуту — есть');
  ENV.coarse = true; M.railTick();
  ok(!T.RAIL.el, 'сенсорный экран (планшет) — нет: липкие только на компьютере');
  ENV.coarse = false;
  // Google: от края игры не ближе 150 px
  window.ADS_IDS.yandex.rail = ''; window.ADS_IDS.google = { game_over: 'G-1' };
  advance(61e3); layout(1920); M.railTick();
  const gl = parseFloat(T.RAIL.el?.style.left) + 360;
  ok(T.RAIL.el && gl - (960 + 280) >= 150, 'Google: столбик ≥ 150 px от игры (поле 560 px)', gl);
  T.RAIL.el && T.RAIL.el.remove(); T._test?.reset;
  cv._rect = { left: 410, top: 240, width: 1100, height: 560 };   // игра во всю ширину (мир, Орда)
  sbox._rect.width = 1100;
  advance(61e3); M._test.RAIL.el = null; M.railTick();
  ok(!T.RAIL.el, 'Google: игра во всю ширину — до поля меньше 150 px — столбика нет');
  window.ADS_IDS.yandex.rail = 'R-A-6-1'; window.ADS_IDS.google = {};
  M.railTick();
  ok(!!T.RAIL.el, 'РСЯ (правила 150 px нет): та же игра во всю ширину — столбик в поле');
  // кнопка у правого края экрана (#perfToggle, «наверх») — столбик левее неё, без наложения
  advance(61e3); layout(1920); M.railTick();
  const pt = new El('button'); pt.id = 'perfToggle'; pt.style.position = 'fixed'; pt._rect = { left: 1920 - 40, top: 500, width: 40, height: 86 }; body.appendChild(pt);
  M.railTick(); advance(61e3); M.railTick();
  ok(T.RAIL.el && T.RAIL.w === 160 && parseFloat(T.RAIL.el.style.left) + 360 + 160 <= 1920 - 40 - 16, 'кнопка у края экрана — столбик уже и левее её, без наложения', T.RAIL.el?.style.left);
  pt.remove();
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  dispatchEvent(new Event('d37:auth')); advance(100);
  ok(!T.RAIL.el, 'вошёл VIP — столбик убран');
  currentUser = null; currentProfile = null; dispatchEvent(new Event('d37:auth')); advance(100);
  // блокировщик: столбик с пустой «Рекламой» убирается через 8 с
  YA.fill = false; advance(61e3); M.railTick();
  const r2 = T.RAIL.el;
  advance(8100);
  ok(r2 && !r2.isConnected, 'реклама не пришла (блокировщик) — через 8 с пустой столбик убран');
  page.remove(); window.adsbygoogle = [];
  timers.push(...savedIntervals);
}

// ═══ 8. Спонсор щитов и щиты «Мира Денчика» ═══
{
  fresh();
  const C = T.cleanSponsor, good = { on: true, title: '🎧 Наушники', text: 'Скидка', url: 'https://shop.example/x?a=1', advertiser: 'ООО «Пример»', erid: '2Vtz-q_X!', bg: '#112233', fg: 'red', until: '2026-12-31' };
  const c = C(good);
  ok(c && c.title === '🎧 Наушники' && c.url === 'https://shop.example/x?a=1' && c.erid === '2Vtz-q_X' && c.bg === '#112233' && c.fg === '#ffffff', 'спонсор: поля чистятся (erid — только буквы/цифры/-/_, цвет — #rrggbb)', c);
  ok(C({ ...good, on: false }) === null && C({ ...good, title: '' }) === null && C({ ...good, url: '' }) === null, 'выключен / нет заголовка / нет ссылки — не показываем');
  for (const u of ['javascript:alert(1)', 'http://shop.example/', '//evil.example/x', 'data:text/html,1', 'https://user:pw@shop.example/'])
    ok(C({ ...good, url: u }) === null, 'плохая ссылка отклонена: ' + u);
  ok(C({ ...good, url: '/vip' })?.url === '/vip' && C({ ...good, url: '#/games/horde' })?.url === '#/games/horde', 'ссылка на свой раздел — можно');
  ok(C({ ...good, until: '2026-10-01' }) === null && !!C({ ...good, until: '2026-10-15' }), 'срок вышел — щит пустеет сам (по МСК, включительно)');
  const nl = String.fromCharCode(10), bell = String.fromCharCode(7);
  ok(C({ ...good, title: 'А' + nl + 'Б' + bell + 'В' })?.title === 'А Б В', 'управляющие символы из заголовка убраны');
  ok(C({ ...good, title: 'x'.repeat(100) }).title.length === 40 && C({ ...good, text: 'y'.repeat(300) }).text.length === 90, 'длины: заголовок 40, текст 90');
  // щиты: что на них
  vm.runInThisContext(read('js/games/mir-promo.js'), { filename: 'mir-promo.js' });
  const P = window.MirPromo._test;
  globalThis.wordsDayNo = () => 13; globalThis.wordsToday = () => ({ done: true }); globalThis.sudokuDayNo = () => 6;
  localStorage.setItem('dan4ik37_cache_v2', JSON.stringify({ ts: clock.t, d: { vids: [{ id: 'g1', title: 'Открыл кейсы на GGDROP' }, { id: 'v2', title: 'Roblox: строю базу' }] } }));
  let r = P.promos({ live: false }, null);
  ok(!r.ad && r.list.map(p => p.id).join(',') === 'words,sudoku,video,look,vip,horde,studio', 'промо по порядку: слово дня, судоку, видео, персонаж, VIP, игры', r.list.map(p => p.id));
  ok(r.list[0].d.includes('угадано') && r.list[2].href === '/v/v2', 'слово дня угадано — так и пишем; ролик про кейсы пропущен — берём следующий');
  r = P.promos({ live: true }, c);
  ok(r.list[0].id === 'live' && r.ad && r.ad.sponsor === c && r.ad.href === c.url, 'эфир — первым; спонсор — отдельно (свой щит)');
  ok(P.markText(c) === 'Реклама · ООО «Пример» · erid: 2Vtz-q_X', 'пометка спонсора: «Реклама · рекламодатель · erid»');
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  r = P.promos({ live: false }, c);
  ok(!r.ad && !r.list.some(p => p.id === 'vip'), 'VIP: ни спонсора, ни «купи VIP»');
  currentUser = null; currentProfile = null;
  localStorage.removeItem('dan4ik37_cache_v2');
  ok(P.promos({}, null).list.find(p => p.id === 'videos')?.href === '/videos', 'роликов в кэше нет — «Почти 6000 роликов» → /videos');
  // рисование (подменный canvas): рамка, заголовок, пометка «РЕКЛАМА» у спонсора
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === 'measureText' ? (t => ({ width: String(t).length * 20 })) : k === 'createLinearGradient' ? (() => ({ addColorStop(){} })) : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
  const b = { cur: { id: 'sponsor', sponsor: c, ic: '', t: c.title, d: c.text, c: [c.bg, c.bg], fg: c.fg }, ctx: g, cv: { width: 1024, height: 512 }, tex: { needsUpdate: false } };
  P.draw(b);
  const texts = calls.filter(x => x[0] === 'fillText').map(x => x[1]);
  ok(texts.includes(c.title) && texts.includes('РЕКЛАМА') && texts.some(t => /erid: 2Vtz-q_X/.test(t)) && b.tex.needsUpdate, 'щит спонсора: заголовок, «РЕКЛАМА» в углу и строка с erid', texts);
  calls.length = 0; b.cur = r = P.promos({}, null).list[0]; b.cur = P.promos({}, null).list[0]; P.draw(b);
  ok(!calls.some(x => x[0] === 'fillText' && x[1] === 'РЕКЛАМА'), 'свои промо — без пометки «Реклама» (это не реклама)');
}

(async () => {
// ═══ 7. Монеты за рекламу (обычные монеты, не донатная валюта) ═══
{
  fresh();
  const W = { n: 100, ads: 0 };
  window.D37Coins = { RULES: { ad: 40 }, canAd: () => W.ads < 8, coins: () => W.n, adCoins: async () => { W.ads++; W.n += 40; return { ok: true, got: 40, coins: W.n }; } };
  ok(M.coinOffer('hub') === '', 'нет блока «за награду» — кнопки «за рекламу» нет вовсе');
  window.ADS_IDS.yandex.rewarded_desktop = 'R-A-7-1';
  let html = M.coinOffer('hub');
  ok(/data-d37-reward="coins"/.test(html) && /Реклама → \+40 🪙/.test(html), 'есть блок — «📺 Реклама → +40 🪙» (на кнопке: что будет реклама и что дадут)', html);
  const box = new El('div'); body.appendChild(box); box.innerHTML = html;
  let watched = false, shown = 0;
  const origShow = A.showReward;
  A.showReward = async () => { shown++; return watched; };
  const events = []; addEventListener('d37:coinad', e => events.push(e.detail));
  globalThis.CustomEvent = class { constructor(t, o){ this.type = t; this.detail = o?.detail; } };
  let b = box.querySelector('button');
  b.click(); await flushMicro(); await flushMicro();
  ok(shown === 1 && W.n === 100 && toasts.pop() === 'Реклама не досмотрена — монет нет' && !b.disabled, 'закрыл рекламу раньше — монет нет, кнопка снова доступна');
  watched = true;
  b.click(); await flushMicro(); await flushMicro(); await flushMicro();
  ok(W.n === 140 && /\+40/.test(toasts.pop()) && /снова через 10 мин/.test(b.textContent) && b.disabled, 'досмотрел — +40 🪙, кнопка «снова через 10 мин»', b.textContent);
  ok(events.length === 1 && events[0].where === 'hub', 'событие d37:coinad — игра перерисует магазин');
  html = M.coinOffer('hub');
  ok(/disabled/.test(html) && /через 10 мин/.test(html) && !/data-d37-reward/.test(html), 'следующие 10 минут — кнопка серая с таймером (раз в 10 минут)');
  advance(10 * 60e3 + 1000);
  ok(/data-d37-reward="coins"/.test(M.coinOffer('hub')), 'через 10 минут — снова можно');
  W.ads = 8;
  ok(M.coinOffer('hub') === '', '8 наград за день (лимит сервера coins_ad) — кнопки нет');
  W.ads = 0; currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  ok(/data-d37-reward/.test(M.coinOffer('hub')), 'VIP: реклама за награду по кнопке остаётся (это его выбор)');
  currentUser = null; currentProfile = null;
  A.showReward = origShow; box.remove(); delete window.D37Coins;
}

// ═══ 9. Серверные страницы и крючки в играх ═══
{
  const os = require('os'), { pathToFileURL } = require('url');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-ads-'));
  fs.mkdirSync(path.join(tmp, 'api/_lib/routes'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  for (const f of ['yt.js', 'page.js', 'topics.js', 'age.js', 'uploads-snapshot.js', 'routes/videos.js']) fs.copyFileSync(path.join(SITE, 'api/_lib', f), path.join(tmp, 'api/_lib', f));
  globalThis.fetch = async () => { throw new Error('нет сети'); };   // свежих роликов нет — только снимок
  try {
    const { page } = await import(pathToFileURL(path.join(tmp, 'api/_lib/page.js')).href);
    const html1 = page({ title: 't', body: '<main></main>' });
    ok(html1.indexOf('pauseAdRequests') > 0 && html1.indexOf('pauseAdRequests') < html1.indexOf('adsbygoogle.js'), 'серверные страницы: пауза AdSense для VIP — до скрипта AdSense');
    ok(/ads-core\.js"><\/script>\s*<script src="\/js\/core\/ad-places\.js"><\/script>/.test(html1), 'серверные страницы: ad-places.js сразу после ads-core.js');
    const html2 = page({ title: 't', body: '<main></main>', noAds: true });
    ok(!/adsbygoogle\.js/.test(html2) && /ctx\("gambling",true\)/.test(html2), 'страница с роликом про кейсы: без AdSense, и полоска РСЯ тоже нельзя (gambling)');
    const { default: videos } = await import(pathToFileURL(path.join(tmp, 'api/_lib/routes/videos.js')).href);
    const run = async p => { const res = { h: {}, setHeader(k, v){ this.h[k] = v; }, status(c){ this.code = c; return this; }, send(x){ this.html = x; } }; await videos({ query: { p: String(p) } }, res); return res; };
    const r1 = await run(1);
    const n1 = (r1.html.match(/data-ad="feed_videos"/g) || []).length;
    ok(r1.code === 200 && n1 === 7 && /class="d37-feed" data-ad="feed_videos" data-ad-lazy hidden/.test(r1.html), '/videos: 240 роликов — 7 карточек «Реклама» (каждая 30-я, не последней), грузятся у экрана', n1);
    let gp = 0;
    for (let p = 2; p <= 12 && !gp; p++) { const r = await run(p); if (!/adsbygoogle\.js/.test(r.html)) { gp = p; ok(!/data-ad=/.test(r.html), `/videos?p=${p} (есть ролики про кейсы) — ни одного места рекламы`); } }
    ok(gp > 0, 'нашлась страница архива с роликами про кейсы');
  } catch (e) { ok(false, 'серверные страницы', String(e && e.stack || e)); }
  fs.rmSync(tmp, { recursive: true, force: true });
  // крючки: что и где подключено (если кто-то случайно удалит строку при слиянии)
  const has = (f, re, name) => ok(re.test(read(f)), name);
  has('index.html', /ads-core\.js"><\/script>\s*<script src="js\/core\/ad-places\.js"><\/script>/, 'index.html: ad-places.js сразу после ads-core.js');
  has('index.html', /pauseAdRequests=1}catch\(e\){}<\/script>\s*<script async src="https:\/\/pagead2/, 'index.html: пауза AdSense для VIP — до скрипта AdSense');
  has('js/features/games.js', /D37AdPlaces\?\.loading\(\{ anchor: box\.firstChild, game: id/, 'games.js: экран загрузки игры');
  has('js/features/games.js', /finally \{ adL\?\.done\(\); \}/, 'games.js: загрузка кончилась — реклама убирается');
  has('js/features/games.js', /D37AdPlaces\.afterRound\(stage\)/, 'games.js: после партии — диспетчер');
  has('js/features/games.js', /feed\(grid, \{ place: 'feed_games'/, 'games.js: карточки в витрине игр');
  has('js/features/games.js', /coinOffer\?\.\('hub'\)/, 'games.js: монеты за рекламу на плашке «Мой персонаж»');
  has('js/games/mir.js', /loading\(\{ anchor: q\('\.wld-status'\)/, 'mir.js: реклама под «Загружаем мир…»');
  has('js/games/mir.js', /E\.load\(\)\.then\(ok => \{\s*adL\?\.done\(\);/, 'mir.js: мир загрузился — реклама прочь');
  has('js/games/mir.js', /worldPromo\?\.\(S, \{ panel, go \}\)/, 'mir.js: щиты');
  has('js/games/mir.js', /else S\.promo\?\.tap\(tp\.x, tp\.y\)/, 'mir.js: нажатие по щиту');
  has('js/games/mir.js', /s\.promo\?\.dispose\(\)/, 'mir.js: щиты убираются при выходе');
  has('js/games/studio3d.js', /loading\(\{ anchor: q\('\.s3-loading'\), tip: 'studio', ugc: !!\(ED\.playId \|\| ED\.joinCode\)/, 'studio3d.js: загрузка студии (чужой мир — без рекламы)');
  has('js/games/studio3d.js', /loading\(\{ host: ed\.q\('\.s3-view'\), card:/, 'studio3d.js: карточка сборки C++/Rust');
  has('js/games/studio3d.js', /finally \{ adL\?\.done\(\); ed\.building = false;/, 'studio3d.js: сборка кончилась — карточка прочь');
  has('js/games/studio.js', /eq\('status', 'public'\)[\s\S]{0,900}feed\(box\.firstChild, \{ place: 'feed_ugc'/, 'studio.js: реклама только в каталоге проверенных игр');
  has('js/games/unity-host.js', /eq\('status', 'public'\)[\s\S]{0,900}feed\(box\.firstChild, \{ place: 'feed_ugc'/, 'unity-host.js: реклама только в каталоге проверенных игр');
  has('js/features/youtube.js', /feed\(grid, \{ place: 'feed_videos'[^\n]*titles: vids\.map/, 'youtube.js: карточки в ленте видео (с проверкой «азартных»)');
  has('js/games/horde.js', /coinOffer\?\.\('horde_shop'\)/, 'horde.js: монеты за рекламу в магазине');
  has('js/games/horde.js', /'d37:coinad'/, 'horde.js: после награды магазин перерисовывается');
  // каждая кнопка «за рекламу» в играх — только когда есть блок (rewardReady) и говорит, что дадут
  for (const f of fs.readdirSync(path.join(SITE, 'js/games')).filter(f => f.endsWith('.js'))) {
    const src = read('js/games/' + f);
    const btns = src.match(/📺[^<`'"]*(?:рекламу|Реклама)[^<`'"]*/g) || [];
    for (const t of btns) ok(/→|и |за рекламу/.test(t) && !/^📺 Посмотреть рекламу$/.test(t.trim()), `${f}: кнопка «${t.trim().slice(0, 50)}» говорит, что дадут`);
    if (/showReward\(/.test(src)) ok(/rewardReady\?\.\(\)/.test(src), `${f}: кнопки «за рекламу» — только при rewardReady()`);
  }
}

console.log(`\nads-test: ${pass} ok, ${fail} fail`);
Date.now = realNow;
process.exit(fail ? 1 : 0);
})();

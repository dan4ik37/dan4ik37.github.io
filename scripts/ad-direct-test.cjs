// Тесты прямой рекламы (кабинет рекламодателя #/adv: js/core/ad-direct.js + крючки в ad-places.js / ads-core.js /
// mir-promo.js, правила api/_lib/ad-rules.js, переход /go/<id> и /api/geo — api/_lib/routes/adgo.js) в node, без браузера:
//  1) приоритет: работающая кампания подходит — она вместо сети; не нашлось — сеть / своя подсказка / пусто как раньше;
//     нет таких кампаний (ad_live) — ни одного лишнего запроса; ads.sql не выполнен (PGRST202) — тихо выключено;
//  2) VIP, персонал и «рядом нельзя» (кейсы, чужие игры) — прямой рекламы тоже нет;
//  3) контекст выдачи: раздел, устройство, возраст (D37Age), страна (/api/geo; нет ответа — '' = как Россия), ширина;
//     размер баннера и столбика по месту; пометка «Реклама · рекламодатель · erid», «О рекламе», ссылка /go/<id>;
//  4) показ засчитывается: видно ≥ 50 % не меньше секунды, вкладка на экране, один раз; отладка — не засчитывается;
//  5) под игрой: «dir» — можно обновлять через 90 с; ads-core.render напрямую тоже берёт прямую рекламу;
//  6) щит «Мира Денчика»: кампания «щит» на месте спонсора, картинка + пометка, показ — щит в кадре секунду;
//  7) правила ссылок и слов: браузер = сервер сайта; переход /go/<id> (302, снята — страница, отладка) и /api/geo.
// Запуск из корня сайта: node scripts/ad-direct-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0, last = '', finished = false;
const ok = (c, name, extra) => { last = name; if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
// обещание повисло (ждём то, что не случится) — node просто выходит; скажем, где
process.on('beforeExit', () => { if (!finished) { console.log(`ad-direct-test: ЗАВИСЛО после «${last}» (${pass} ok, ${fail} fail)`); process.exitCode = 1; } });

// ═══ Подменный DOM (как в scripts/ads-test.cjs) ═══
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
  get isConnected(){ let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
  _rm(n){ const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  appendChild(n){ if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.childNodes.push(n); return n; }
  insertBefore(n, ref){ if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode._rm(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; }
  after(...ns){ const p = this.parentNode; if (!p) return; let ref = p.childNodes[p.childNodes.indexOf(this) + 1] || null; for (const n of ns) p.insertBefore(n, ref); }
  remove(){ if (this.parentNode) this.parentNode._rm(this); }
  get textContent(){ return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(t){ this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (t !== '' && t != null) this.appendChild(new Text(String(t))); }
  set innerHTML(h){ this.textContent = ''; parseInto(this, String(h)); }
  get innerHTML(){ return this.childNodes.map(serialize).join(''); }
  get outerHTML(){ return serialize(this); }
  insertAdjacentHTML(pos, h){ const tmp = new El('div'); parseInto(tmp, h); const ns = [...tmp.childNodes]; if (pos === 'beforeend') ns.forEach(n => this.appendChild(n)); else if (pos === 'afterend') this.after(...ns); }
  getBoundingClientRect(){ const r = this._rect || { left: 0, top: 0, width: 0, height: 0 }; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top }; }
  addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn){ this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  dispatch(type, extra = {}){ const ev = { type, target: this, defaultPrevented: false, preventDefault(){ this.defaultPrevented = true; }, stopPropagation(){ this.stopped = true; }, ...extra }; fire(ev); return ev; }
  click(){ return this.dispatch('click'); }
  querySelectorAll(sel){ return qsa(this, sel); }
  querySelector(sel){ return qsa(this, sel)[0] || null; }
  closest(sel){ let n = this; while (n && n.nodeType === 1) { if (matches(n, sel, null)) return n; n = n.parentNode; } return null; }
  contains(n){ while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  getContext(){ return this._ctx || (this._ctx = canvasCtx()); }
  focus(){} blur(){}
}
function serialize(n){
  if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
  const t = n.tagName.toLowerCase();
  return VOID.has(t) ? `<${t}${a}>` : `<${t}${a}>${n.childNodes.map(serialize).join('')}</${t}>`;
}
function parseInto(root, h){
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(h))) {
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
const docListeners = {}, winListeners = {};
function fire(ev){
  const p = []; let n = ev.target; while (n && n.nodeType === 1) { p.push(n); n = n.parentNode; }
  for (const fn of (docListeners[ev.type] || []).filter(x => x.cap).map(x => x.fn)) { fn(ev); if (ev.stopped) return; }
  for (const el of p) { for (const fn of el.listeners[ev.type] || []) fn(ev); if (ev.stopped) return; }
  for (const fn of (docListeners[ev.type] || []).filter(x => !x.cap).map(x => x.fn)) fn(ev);
}
const html = new El('html'), head = new El('head'), body = new El('body');
html.appendChild(head); html.appendChild(body);
const doc = {
  documentElement: html, head, body, readyState: 'complete', fullscreenElement: null, visibilityState: 'visible',
  createElement: t => new El(t), createTextNode: t => new Text(t),
  getElementById: id => qsa(html, '#' + id)[0] || null,
  querySelector: s => qsa(html, s)[0] || null, querySelectorAll: s => qsa(html, s),
  addEventListener: (t, fn, cap) => { (docListeners[t] = docListeners[t] || []).push({ fn, cap: !!(cap === true || cap?.capture) }); },
  removeEventListener: (t, fn) => { docListeners[t] = (docListeners[t] || []).filter(x => x.fn !== fn); },
};
const ENV = { width: 1280, coarse: false };
Object.defineProperty(html, 'clientWidth', { get: () => ENV.width });
// холст-заглушка: запоминает, что рисовали
function canvasCtx(){
  const calls = [];
  return new Proxy({ calls }, { get: (o, k) => k in o ? o[k] : (k === 'measureText' ? (t => ({ width: String(t).length * 20 })) : k === 'createLinearGradient' ? (() => ({ addColorStop(){} })) : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; return true; } });
}

// ═══ Окно: часы, таймеры, хранилища, сеть ═══
const RT = { setTimeout, clearTimeout };   // настоящие таймеры — для сервера сайта (повтор запроса ждёт 0,4 с)
const clock = { t: Date.UTC(2026, 9, 15, 10, 0, 0) };
const realNow = Date.now;
Date.now = () => clock.t;
let timers = [], tid = 0;
globalThis.setTimeout = (fn, ms) => { const id = ++tid; timers.push({ id, at: clock.t + Math.max(0, ms || 0), fn }); return id; };
globalThis.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
globalThis.setInterval = (fn, ms) => { const id = ++tid; timers.push({ id, at: clock.t + ms, fn, every: ms }); return id; };
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
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; }, _s: s }; };
globalThis.window = globalThis;
globalThis.document = doc;
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.location = { hash: '#/games', search: '', pathname: '/', hostname: 'dan4ik37.vercel.app', origin: 'https://dan4ik37.vercel.app', href: 'https://dan4ik37.vercel.app/' };
Object.defineProperty(globalThis, 'innerWidth', { get: () => ENV.width, configurable: true });
globalThis.matchMedia = q => ({ matches: /pointer:\s*coarse/.test(q) ? ENV.coarse : (m => m ? ENV.width <= +m[1] : false)(/max-width:\s*(\d+)px/.exec(q)) });
globalThis.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); };
globalThis.dispatchEvent = ev => { (winListeners[ev.type] || []).forEach(fn => fn(ev)); return true; };
globalThis.Event = class { constructor(t){ this.type = t; } };
globalThis.getComputedStyle = el => ({ position: el.style.position || 'static' });
globalThis.prompt = () => 'реклама не для детей';
// IntersectionObserver: видимость задаёт тест (доля на экране)
const IO = new Map();
globalThis.IntersectionObserver = class { constructor(cb, o){ this.cb = cb; this.o = o; } observe(el){ if (!IO.has(el)) IO.set(el, new Set()); IO.get(el).add(this); } unobserve(el){ IO.get(el)?.delete(this); } disconnect(){ for (const s of IO.values()) s.delete(this); } };
const vis = (el, ratio) => { for (const o of [...(IO.get(el) || [])]) o.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio }]); };
// картинка щита — грузится сразу
globalThis.Image = class { set src(v){ this._src = v; setImmediate(() => this.onload?.()); } get src(){ return this._src; } };
const U = '11111111-1111-1111-1111-111111111111';
const SIZES = { native: [640, 360], b300x250: [600, 500], b728x90: [1456, 180], r160x600: [320, 1200], r300x600: [600, 1200], board: [1024, 512] };
const PK = (id, g, kinds, o = {}) => ({ id, g, adv: 'ИП Блогеров', inn: '770123456789', erid: 'Kra23abc', host: 'youtube.com',
  t: `${Math.floor(clock.t / 1000)}.0123456789ab.${o.place || 'feed_games'}.sig${id}`,
  cr: kinds.map(k => ({ kind: k, title: 'Канал Блогера', body: 'Ролики каждую неделю', cta: 'Смотреть', image: `${U}/img${k}aaaa.webp`, w: SIZES[k][0], h: SIZES[k][1] })), ...o });
// Supabase и сервер сайта
const NET = { calls: [], live: { on: true, f: { native: 1, banner: 1, rail: 1, board: 1 } }, pick: null, geo: 'KZ', off: false };
const J = (status, j) => ({ ok: status < 300, status, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url, o = {}) => {
  const b = o.body ? JSON.parse(o.body) : null;
  NET.calls.push({ url, body: b, headers: o.headers || {} });
  if (url === '/api/geo') return NET.geo === null ? J(404, {}) : J(200, { c: NET.geo });
  const m = /\/rest\/v1\/rpc\/(\w+)$/.exec(url);
  if (m) {
    if (NET.off) return J(404, { code: 'PGRST202', message: 'Could not find the function public.' + m[1] });
    if (m[1] === 'ad_live') return NET.liveErr ? J(500, { message: 'упал' }) : J(200, NET.live);
    if (m[1] === 'ad_pick') return J(200, typeof NET.pick === 'function' ? NET.pick(b) : NET.pick);
    if (m[1] === 'ad_view') return J(200, { ok: true, counted: true });
    if (m[1] === 'ad_report') return J(200, { ok: true, reports: 1 });
  }
  if (/\/storage\/v1\/object\/sign\/ads\//.test(url)) return J(200, { signedURL: '/object/sign/ads/' + url.split('/object/sign/ads/')[1] + '?token=sig' });
  return J(404, {});
};
const rpcCalls = fn => NET.calls.filter(c => c.url.endsWith('/rpc/' + fn));
const setHash = h => { location.hash = h; (winListeners.hashchange || []).forEach(fn => fn({ type: 'hashchange' })); };

globalThis.currentUser = null; globalThis.currentProfile = null; globalThis.currentRole = null;
globalThis.isVipActive = p => !!p?.is_vip;
globalThis.getVipTier = p => p && p.is_vip ? { key: 'bronze' } : null;

vm.runInThisContext(read('js/core/ads-core.js'), { filename: 'ads-core.js' });
vm.runInThisContext(read('js/core/ad-places.js'), { filename: 'ad-places.js' });
vm.runInThisContext(read('js/core/ad-direct.js'), { filename: 'ad-direct.js' });
const A = window.D37Ads, M = window.D37AdPlaces, D = window.D37AdDirect, T = M._test, DT = D._test;
const IDS = JSON.parse(JSON.stringify(window.ADS_IDS));
function fresh(o = {}){
  T.reset();
  window.ADS_IDS = JSON.parse(JSON.stringify(IDS));
  Object.assign(ENV, { width: 1280, coarse: false }, o.env || {});
  currentUser = null; currentProfile = null; currentRole = null;
  T.dbg.on = false; T.dbg.frames = false; T.dbg.nocaps = false;
  location.hash = o.hash || '#/games'; location.pathname = o.path || '/';
  doc.visibilityState = 'visible';
  NET.calls.length = 0; NET.pick = null; NET.geo = 'KZ'; NET.off = false;
  NET.live = { on: true, f: { native: 1, banner: 1, rail: 1, board: 1 } };
  DT.setOff(false); DT.setLive({ on: true, f: { ...NET.live.f }, t: clock.t }); DT.shown.clear();
  sessionStorage.clear(); localStorage.clear();
  body.childNodes.slice().forEach(n => n.remove());
  timers = timers.filter(t => t.every);
}
const box = (w = 340) => { const el = new El('div'); el._rect = { left: 0, top: 0, width: w, height: 250 }; body.appendChild(el); return el; };
ok(typeof D.fill === 'function' && typeof M.direct === 'function' && typeof D.billboard === 'function', 'модули загрузились');

(async () => {
// ═══ 1. Сводка «что работает» и выключенный SQL ═══
{
  fresh(); DT.setLive(null); NET.live = { on: true, f: { native: 2 } };
  await D.refresh(); await flush();
  ok(D.live()?.f?.native === 2 && rpcCalls('ad_live').length === 1, 'ad_live: сводка загружена', D.live());
  ok(JSON.parse(localStorage.getItem('d37_adlive')).f.native === 2, 'сводка сохранена в браузере (подсказка следующей странице)');
  ok(D.has('feed_games') && D.has('feed_videos') && !D.has('loading') && !D.has('rail'), 'has(): лента — да; баннеров и столбиков сейчас нет');
  ok(!D.has('interstitial') && !D.has('floor') && !D.has('rewarded'), 'полноэкранная, полоска, за награду — не для прямой рекламы');
  // сервер не отвечает (500) — не долбим: следующий запрос сводки не раньше чем через минуту
  fresh(); DT.setLive(null); NET.liveErr = true;
  for (let i = 0; i < 5; i++) { D.has('feed_games'); await flush(); advance(2000); }
  ok(rpcCalls('ad_live').length === 1 && !D.has('feed_games'), 'ad_live не ответил — повтор не раньше чем через минуту', { n: rpcCalls('ad_live').length, calls: NET.calls.map(c => c.url.slice(-30)), off: D.isOff(), live: D.live() });
  advance(61e3); D.has('feed_games'); await flush();
  ok(rpcCalls('ad_live').length === 2, 'через минуту — спросили снова');
  NET.liveErr = false;
  fresh(); NET.off = true; DT.setLive(null);
  await D.refresh(); await flush();
  ok(D.isOff() && !D.has('feed_games') && sessionStorage.getItem('d37_adoff'), 'ads.sql не выполнен (PGRST202) — тихо выключено до конца визита');
  NET.calls.length = 0; ok(await DT.rpc('ad_pick', {}) === null && NET.calls.length === 0, 'выключено — больше ни одного запроса');
}

// ═══ 2. Приоритет: своя кампания → сеть → своя подсказка ═══
{
  fresh(); window.ADS_IDS.yandex.feed = '';   // Google: feed берёт games_hub
  NET.pick = b => PK('camp000001', 'native', ['native'], { place: b.p_place });
  const grid = new El('div'); grid._rect = { left: 0, top: 0, width: 900, height: 2000 }; body.appendChild(grid);
  grid.innerHTML = Array.from({ length: 30 }, (_, i) => `<a class="gm-card">Игра ${i}</a>`).join('');
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 2 }) === 2, 'витрина: 2 места');
  const c1 = grid.children[10];
  c1._rect = { left: 0, top: 0, width: 300, height: 260 };
  vis(c1, 1); await flush();
  const dad = c1.querySelector('.dad-native');
  ok(dad && !c1.querySelector('ins.adsbygoogle') && c1.classList.contains('d37-dad'), 'место заняла прямая реклама (не сеть)', c1.outerHTML.slice(0, 300));
  ok(/Реклама · ИП Блогеров · erid: Kra23abc/.test(c1.textContent.replace(/\s+/g, ' ')), 'пометка «Реклама · рекламодатель · erid»', c1.textContent);
  const a = c1.querySelector('a.dad-a');
  ok(a && /^\/go\/camp000001\?t=/.test(a.getAttribute('href')) && /sponsored/.test(a.getAttribute('rel')) && a.getAttribute('target') === '_blank', 'ссылка — /go/<id> с подписью, rel="sponsored"', a && a.attrs);
  const img = c1.querySelector('img');
  ok(img && /^https:\/\/zdisuowyjgqirhvcyjfq\.supabase\.co\/storage\/v1\/object\/sign\/ads\/11111111-1111-1111-1111-111111111111\/imgnativeaaaa\.webp\?token=sig$/.test(img.getAttribute('src')), 'картинка — подписанная ссылка закрытого хранилища', img && img.getAttribute('src'));
  ok(/youtube\.com ↗/.test(c1.textContent) && /Смотреть/.test(c1.textContent), 'на карточке — настоящий сайт рекламодателя и кнопка');
  ok(T.st().p.feed?.n === 1, 'место засчитано диспетчером (частота и лимит визита общие)');
  const pk = rpcCalls('ad_pick')[0].body;
  ok(pk.p_place === 'feed_games' && pk.p_ctx.section === 'games' && pk.p_ctx.device === 'desktop' && pk.p_ctx.age === 'unknown' && pk.p_ctx.country === 'KZ' && pk.p_ctx.w === 300,
    'выдача: место, раздел, устройство, возраст, страна, ширина', pk);
  // второе место того же списка: уже показанную не просим
  NET.pick = b => (b.p_ctx.ex || []).includes('camp000001') ? null : PK('camp000001', 'native', ['native']);
  const c2 = grid.children[21];
  vis(c2, 1); await flush();
  ok(rpcCalls('ad_pick')[1].body.p_ctx.ex.includes('camp000001'), 'вторая карточка: уже показанные на странице — в ex');
  ok(c2.querySelector('ins.adsbygoogle') && !c2.querySelector('.dad'), 'своей кампании больше нет — реклама сети, как раньше', c2.outerHTML.slice(0, 200));
  // нет кампании и нет сети — своя подсказка
  window.ADS_IDS.google = {}; NET.pick = null;
  grid.innerHTML = Array.from({ length: 30 }, (_, i) => `<a class="gm-card">Игра ${i}</a>`).join('');
  ok(M.feed(grid, { place: 'feed_games', every: 10, max: 1 }) === 1, 'без номеров блоков, но кампании работают — место есть (hasId)');
  vis(grid.children[10], 1); await flush();
  ok(grid.children[10].classList.contains('d37-house') && !/Реклама/.test(grid.children[10].textContent), 'выдача пустая, сети нет — своя подсказка без «Реклама»');
  // сводка: карточек сейчас нет — ни запроса, сразу сеть
  fresh(); DT.setLive({ on: true, f: { banner: 1 }, t: clock.t });
  const before = rpcCalls('ad_pick').length;
  const g1 = box(320);
  ok(M.show(g1, 'feed_games', { checked: true }) && g1.querySelector('ins.adsbygoogle') && rpcCalls('ad_pick').length === before, 'нет работающих карточек — сразу сеть, без лишнего запроса');
}

// ═══ 3. VIP, персонал, «рядом нельзя» ═══
{
  fresh(); NET.pick = () => PK('camp000002', 'banner', ['b300x250']);
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  const v1 = box();
  ok(M.show(v1, 'game_over') === false && rpcCalls('ad_pick').length === 0 && !D.has('game_over'), 'VIP — ни прямой рекламы, ни запроса');
  currentUser = { id: 'm' }; currentProfile = { id: 'm', role: 'moderator' }; currentRole = 'moderator';
  ok(M.show(box(), 'game_over') === false, 'персонал — тоже');
  currentUser = null; currentProfile = null; currentRole = null;
  M.ctx('gambling', true);
  ok(M.show(box(), 'video_page') === false && rpcCalls('ad_pick').length === 0, 'ролик про кейсы — рядом нельзя никакой рекламы');
  M.ctx('gambling', false);
  location.hash = '#/games/studio/play/abc123';
  ok(M.why('feed_ugc') === 'ugc' && M.why('loading') === 'ugc', 'чужая непроверенная игра — без ленты и загрузки (и прямой)');
}

// ═══ 4. Контекст: раздел, страна, возраст, размер баннера и столбика ═══
{
  fresh();
  const cases = [['#/games/world', '/', 'world'], ['#/games/studio3d', '/', 'studio'], ['#/games/unity/play/x', '/', 'studio'], ['#/games/horde', '/', 'games'],
    ['#/home', '/', 'videos'], ['', '/', 'videos'], ['#/chat', '/', 'chat'], ['#/forum/12', '/', 'chat'], ['#/shop', '/', 'other'],
    ['', '/v/abc', 'videos'], ['', '/videos', 'videos'], ['', '/topic/minecraft', 'videos'], ['', '/games/horde', 'games'], ['', '/quiz/x', 'games'], ['', '/g/ab12', 'studio'], ['', '/vip', 'other']];
  for (const [h, p, want] of cases) { location.hash = h; location.pathname = p; ok(D.section() === want, `раздел ${h || p} → ${want}`, D.section()); }
  fresh(); NET.geo = null; sessionStorage.clear(); DT.resetGeo();
  window.D37Age = { group: () => 'adult' };
  NET.pick = () => PK('camp000003', 'banner', ['b300x250', 'b728x90'], { place: 'loading' });
  ENV.coarse = true;
  const wide = box(760);
  M.show(wide, 'loading', { checked: true }); await flush();
  let b = rpcCalls('ad_pick').pop().body.p_ctx;
  ok(b.country === '' && b.age === 'adult' && b.device === 'mobile' && b.w === 760, 'страна не узнана — пусто (сервер считает Россией), возраст из D37Age, телефон', b);
  ok(wide.querySelector('.dad-k-b728x90 img')?.getAttribute('width') === '728', 'широкое место — баннер 728×90');
  delete window.D37Age;
  const narrow = box(360);
  M.show(narrow, 'loading', { checked: true }); await flush();
  ok(narrow.querySelector('.dad-k-b300x250 img')?.getAttribute('height') === '250', 'узкое место — 300×250');
  NET.pick = () => PK('camp000004', 'rail', ['r160x600', 'r300x600'], { place: 'rail' });
  const r3 = box(300), r1 = box(160);
  M.show(r3, 'rail', { checked: true }); M.show(r1, 'rail', { checked: true }); await flush();
  ok(r3.querySelector('.dad-k-r300x600') && r1.querySelector('.dad-k-r160x600'), 'столбик: 300 — 300×600, 160 — 160×600');
  ok(DT.chooseKind({ cr: [{ kind: 'b728x90' }] }, 'banner', 300) === 'b728x90', 'есть только 728×90 — ужмётся по ширине (сервер такую на узкое место не выдаёт)');
}

// ═══ 5. Показ засчитывается: ≥ 50 % не меньше секунды, вкладка на экране, один раз ═══
{
  fresh(); NET.pick = () => PK('camp000005', 'banner', ['b300x250'], { place: 'game_over' });
  const el = box(400);
  M.show(el, 'game_over', { checked: true }); await flush();
  const d = el.querySelector('.dad');
  ok(d, 'баннер на месте');
  vis(d, 0.4); advance(2000); await flush();
  ok(rpcCalls('ad_view').length === 0, 'видно 40 % — не засчитан');
  vis(d, 0.6); advance(900); vis(d, 0.2); advance(500); await flush();
  ok(rpcCalls('ad_view').length === 0, 'видно 60 %, но меньше секунды — не засчитан');
  doc.visibilityState = 'hidden'; dispatchEvent(new Event('x'));
  vis(d, 1); advance(1500); await flush();
  ok(rpcCalls('ad_view').length === 0, 'вкладка свёрнута — не засчитан');
  doc.visibilityState = 'visible'; (docListeners.visibilitychange || []).forEach(x => x.fn());
  advance(1000); await flush();
  const v = rpcCalls('ad_view');
  ok(v.length === 1 && v[0].body.p_id === 'camp000005' && /\.game_over\./.test(v[0].body.p_token), 'вернулся на вкладку, видно секунду — засчитан (с подписью выдачи)', v.map(x => x.body));
  vis(d, 0); vis(d, 1); advance(3000); await flush();
  ok(rpcCalls('ad_view').length === 1, 'один раз на выдачу');
  // убрали со страницы до секунды — не засчитан
  NET.pick = () => PK('camp000006', 'banner', ['b300x250']);
  const el2 = box(400); M.show(el2, 'game_over', { checked: true }); await flush();
  vis(el2.querySelector('.dad'), 1); advance(500); el2.remove(); advance(800); await flush();
  ok(rpcCalls('ad_view').length === 1, 'убрали с экрана раньше секунды — не засчитан');
  // отладка (?adsdebug) — показы не засчитываются, клик с пометкой d=1
  fresh(); T.dbg.on = true; NET.pick = () => PK('camp000007', 'banner', ['b300x250']);
  const el3 = box(400); M.show(el3, 'game_over', { checked: true }); await flush();
  vis(el3.querySelector('.dad'), 1); advance(2000); await flush();
  ok(rpcCalls('ad_view').length === 0 && /&d=1$/.test(el3.querySelector('a.dad-a').getAttribute('href')), 'отладка: показ не засчитан, переход помечен d=1');
  T.dbg.on = false;
  // вход: токен сессии в заголовке (сервер не засчитает свои показы рекламодателя)
  fresh(); localStorage.setItem('sb-zdisuowyjgqirhvcyjfq-auth-token', JSON.stringify({ access_token: 'jwt-abc', expires_at: Math.floor(clock.t / 1000) + 3600 }));
  NET.pick = () => PK('camp000008', 'banner', ['b300x250']);
  const el4 = box(400); M.show(el4, 'game_over', { checked: true }); await flush();
  ok(rpcCalls('ad_pick')[0].headers.Authorization === 'Bearer jwt-abc', 'вошёл — запросы с токеном сессии');
  localStorage.setItem('sb-zdisuowyjgqirhvcyjfq-auth-token', JSON.stringify({ access_token: 'old', expires_at: Math.floor(clock.t / 1000) - 10 }));
  ok(DT.session() === '', 'просроченный токен — как гость');
}

// ═══ 6. «О рекламе» и жалоба ═══
{
  fresh(); NET.pick = () => PK('camp000009', 'native', ['native']);
  const el = box(320); M.show(el, 'feed_games', { checked: true }); await flush();
  el.querySelector('[data-dad-about]').click();
  const pop = doc.querySelector('.dad-pop');
  const t = pop?.textContent.replace(/\s+/g, ' ') || '';
  ok(pop && /Рекламодатель\s*ИП Блогеров/.test(t) && /ИНН \/ БИН\s*770123456789/.test(t) && /erid\s*Kra23abc/.test(t) && /youtube\.com/.test(t) && pop.querySelector('a[href="/ads-terms"]'), '«О рекламе»: рекламодатель, ИНН/БИН, erid, сайт, правила', t);
  await pop.querySelector('[data-dad-rep]').onclick({ currentTarget: pop.querySelector('[data-dad-rep]') });
  ok(/войди/i.test(pop.querySelector('.dad-pop-st').textContent) && rpcCalls('ad_report').length === 0, 'жалоба гостя — «войди», без запроса');
  localStorage.setItem('sb-zdisuowyjgqirhvcyjfq-auth-token', JSON.stringify({ access_token: 'jwt-x', expires_at: Math.floor(clock.t / 1000) + 3600 }));
  await pop.querySelector('[data-dad-rep]').onclick({ currentTarget: pop.querySelector('[data-dad-rep]') }); await flush();
  ok(rpcCalls('ad_report')[0]?.body.p_id === 'camp000009' && /Спасибо/.test(pop.querySelector('.dad-pop-st').textContent), 'жалоба вошедшего — ушла модератору');
}

// ═══ 7. Под игрой и прямой вызов ads-core ═══
{
  fresh(); NET.pick = () => PK('camp000010', 'banner', ['b728x90'], { place: 'game_over' });
  advance(121e3);
  const stage = new El('div'); stage._rect = { left: 0, top: 0, width: 1000, height: 600 }; body.appendChild(stage);
  const r = M.afterRound(stage); await flush();
  const gb = stage.querySelector('#gamesAd');
  ok(r === 'game_over' && gb.dataset.net === 'dir' && gb.querySelector('.dad-k-b728x90'), 'после партии: под игрой прямая реклама, сеть помечена «dir»', { r, net: gb.dataset.net });
  ok(!T.refreshOk(gb) && (advance(91e3), T.refreshOk(gb)), 'обновить можно через 90 с (как у Яндекса; Google не трогаем)');
  // прямой вызов (как games.js для games_hub)
  NET.pick = () => PK('camp000011', 'banner', ['b300x250'], { place: 'games_hub' });
  const hub = box(600); hub.hidden = true;
  ok(A.render(hub, 'games_hub') === true, 'D37Ads.render напрямую — тоже через прямую рекламу');
  await flush();
  ok(!hub.hidden && hub.querySelector('.dad-k-b300x250'), 'место открылось с прямой рекламой');
  NET.pick = null;
  const hub2 = box(600);
  A.render(hub2, 'games_hub'); await flush();
  ok(hub2.querySelector('ins.adsbygoogle'), 'нет кампании — как раньше (AdSense)');
}

// ═══ 8. Щит «Мира Денчика» ═══
{
  fresh(); NET.pick = b => b.p_place === 'billboard' ? PK('camp000012', 'board', ['board'], { place: 'billboard' }) : null;
  const sp = await D.billboard(); await flush();
  const pb = rpcCalls('ad_pick')[0]?.body;
  ok(sp && sp.direct.id === 'camp000012' && /^\/go\/camp000012\?t=/.test(sp.url) && sp.img && sp.advertiser === 'ИП Блогеров' && sp.erid === 'Kra23abc', 'щит: кампания, переход /go, картинка', sp && { ...sp, img: !!sp.img, direct: 0 });
  ok(pb.p_place === 'billboard' && pb.p_ctx.section === 'world' && pb.p_ctx.w === 1024, 'щит просят как «мир»', pb);
  vm.runInThisContext(read('js/games/mir-promo.js'), { filename: 'mir-promo.js' });
  const P = window.MirPromo._test;
  globalThis.wordsDayNo = () => 13; globalThis.sudokuDayNo = () => 6;
  const r = P.promos({ live: false }, sp);
  ok(r.ad && r.ad.id === 'direct:' + sp.direct.t && r.ad.img === sp.img && r.ad.href === sp.url, 'щит спонсора — прямая реклама (с картинкой)');
  const g = canvasCtx(), b = { cur: r.ad, ctx: g, cv: { width: 1024, height: 512 }, tex: { needsUpdate: false } };
  P.draw(b);
  const texts = g.calls.filter(x => x[0] === 'fillText').map(x => x[1]);
  ok(g.calls.some(x => x[0] === 'drawImage' && x[1] === sp.img) && texts.includes('РЕКЛАМА') && texts.some(t => /^Реклама · ИП Блогеров · erid: Kra23abc$/.test(t)) && b.tex.needsUpdate,
    'щит: картинка рекламодателя + «РЕКЛАМА» и «Реклама · кто · erid» поверх', texts);
  currentUser = { id: 'v' }; currentProfile = { id: 'v', is_vip: true };
  ok(!P.promos({}, sp).ad && await D.billboard() === null, 'VIP: щит без рекламы');
  currentUser = null; currentProfile = null;
  // Показ щита: в кадре лицом к камере секунду — засчитан; партия поверх мира — нет
  class V3 { constructor(x = 0, y = 0, z = 0){ this.x = x; this.y = y; this.z = z; } set(x, y, z){ this.x = x; this.y = y; this.z = z; return this; } copy(v){ return this.set(v.x, v.y, v.z); } project(c){ return this.set(c.ndc.x, c.ndc.y, c.ndc.z); } }
  class Obj { constructor(){ this.position = new V3(); this.rotation = { y: 0 }; this.scale = { y: 1, set(){} }; this.children = []; this.userData = {}; } add(c){ this.children.push(c); c.parent = this; } remove(c){ this.children = this.children.filter(x => x !== c); } }
  const Th = { MeshStandardMaterial: class { dispose(){} }, BoxGeometry: class { dispose(){} }, PlaneGeometry: class { dispose(){} }, MeshBasicMaterial: class { dispose(){} },
    CanvasTexture: class { dispose(){} }, Group: Obj, Mesh: class extends Obj { constructor(g, m){ super(); this.geometry = g; this.material = m; } }, Raycaster: class {}, Vector2: class {}, Vector3: V3, sRGBEncoding: 1 };
  const cam = { position: new V3(0, 2, 0), ndc: { x: 0, y: 0, z: .5 } };
  const S = { R: { T: Th, scene: new Obj(), camera: cam, q: 'mid' }, X: { add: () => ({}), remove(){} }, ph: { addBox(){} }, live: false };
  NET.calls.length = 0;
  const h = window.MirPromo.start(S, {});
  await flush(12);
  ok(h._st.sponsor?.direct?.id === 'camp000012' && h._st.boards[0].cur?.sponsor === h._st.sponsor, 'мир: первый щит занят прямой рекламой');
  window.MirPlay = { isOpen: () => true };
  advance(1500); await flush();
  ok(rpcCalls('ad_view').length === 0, 'поверх мира партия — щит не засчитан');
  window.MirPlay = { isOpen: () => false };
  cam.position.set(0, 2, 60); advance(1500); await flush();
  ok(rpcCalls('ad_view').length === 0, 'далеко (больше 40 ед.) — не засчитан');
  cam.position.set(30, 2, -30); advance(1500); await flush();
  ok(rpcCalls('ad_view').length === 0, 'сзади щита — не засчитан');
  cam.position.set(0, 2, 0); advance(600); await flush();
  ok(rpcCalls('ad_view').length === 0, 'в кадре 0,6 с — ещё нет');
  advance(600); await flush();
  ok(rpcCalls('ad_view').length === 1 && rpcCalls('ad_view')[0].body.p_id === 'camp000012', 'в кадре секунду — засчитан');
  advance(5000); await flush();
  ok(rpcCalls('ad_view').length === 1, 'один раз за выдачу');
  h.dispose();
  delete window.MirPlay;
}

// ═══ 8б. Возраст (js/core/age.js → ADS_RULES.age): метка кампании и места, выключенные для группы ═══
{
  fresh(); NET.pick = b => b.p_place === 'billboard' ? PK('camp000020', 'board', ['board'], { place: 'billboard', age: 6 }) : PK('camp000021', 'native', ['native'], { age: 12 });
  const el = box(320); M.show(el, 'feed_games', { checked: true }); await flush();
  let pc = rpcCalls('ad_pick').pop().body.p_ctx;
  ok(pc.age === 'unknown' && pc.ar === 'teen', 'возраст не указан: таргетингу — «не указан», метке — как решает ADS_RULES.age.unknown (подросток)', pc);
  ok(/Реклама\s*12\+\s*·/.test(el.textContent) && el.querySelector('.dad-age')?.textContent === '12+', 'на рекламе — её возрастная метка', el.textContent);
  el.querySelector('[data-dad-about]').click();
  ok(/Возраст\s*12\+/.test(doc.querySelector('.dad-pop')?.textContent || ''), '«О рекламе»: возрастная метка');
  window.D37Age = { group: () => 'child' };
  ok(M.adAge() === 'child' && D.has('feed_games') && !D.has('billboard'), 'ребёнок: в ленте прямая реклама может быть (сервер даст только 0+ и 6+), щита — нет');
  const before = rpcCalls('ad_pick').length;
  ok(await D.billboard() === null && rpcCalls('ad_pick').length === before, 'ребёнок: щит мира без прямой рекламы — даже не спрашиваем сервер');
  const el2 = box(320); M.show(el2, 'feed_games', { checked: true }); await flush();
  pc = rpcCalls('ad_pick').pop().body.p_ctx;
  ok(pc.age === 'child' && pc.ar === 'child', 'ребёнок: сервер получает группу (без года и возраста)');
  window.D37Age = { group: () => 'adult' };
  const sp = await D.billboard(); await flush();
  ok(sp && sp.age === '6+', 'взрослый: щит есть, с меткой');
  const P = window.MirPromo._test;
  ok(P.markText(sp) === 'Реклама 6+ · ИП Блогеров · erid: Kra23abc', 'на щите — «Реклама 6+ · кто · erid»', P.markText(sp));
  window.D37Age = { group: () => 'child' };
  ok(!P.promos({}, sp).ad, 'щит уже показывал рекламу, а зритель оказался ребёнком — со следующей перерисовки только свои промо');
  delete window.D37Age;
}

// ═══ 9. Правила ссылок и слов: браузер = сервер сайта ═══
const R = D.rules;
const urls = ['https://example.com/', 'http://example.com/', 'https://bit.ly/x', 'https://sub.vk.cc/x', 'https://casino.example/', 'https://1.2.3.4/',
  'https://u:p@example.com/', 'https://example.com:8080/', 'https://example/', 'https://exa mple.com/', 'https://t.me/blogger', 'https://ggdrop.example/promo',
  'https://.example.com/', 'javascript:alert(1)', '', 'https://example.com/<script>', 'https://example.com/a"b'];
ok(R.urlBad('https://www.youtube.com/@blogger') === '' && R.urlBad('http://x.ru') === 'https' && R.urlBad('https://bit.ly/x') === 'short' && R.urlBad('https://casino.example') === 'bad', 'ссылки: https, короткие, запрещённые темы');
ok(R.textBad('Лучшее КАЗИНО') === 'казино' && R.textBad('кaзино') === 'казино' && R.textBad('Ёжик и Пиво') === 'пиво' && R.textBad('Канал про Minecraft') === '', 'слова: регистр, латинские двойники, ё');
ok(R.hostOf('https://www.YouTube.com/@x') === 'youtube.com', 'домен для карточки — без www');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-adgo-'));
  fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  try {
    const S = await import(pathToFileURL(path.join(tmp, 'api/_lib/ad-rules.js')).href);
    for (const u of urls) ok(S.urlBad(u) === R.urlBad(u), `ссылка «${u}»: браузер = сервер сайта`, [S.urlBad(u), R.urlBad(u)]);
    ok(JSON.stringify(S.BAD_WORDS) === JSON.stringify(R.BAD_WORDS) && JSON.stringify(S.SHORT_HOSTS) === JSON.stringify(R.SHORT_HOSTS), 'списки: браузер = сервер сайта');
    ok(JSON.stringify(S.DEF) === JSON.stringify(D.DEF) && JSON.stringify(S.SIZES) === JSON.stringify(R.SIZES), 'цены по умолчанию и размеры: браузер = сервер сайта');
    // список запрещённых слов — тот же, что в ads.sql (ad_bad_words)
    const sqlWords = /ad_bad_words\(\) returns text\[\][\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(read('ads.sql'))[1].match(/'([^']*)'/g).map(s => s.slice(1, -1));
    ok(JSON.stringify(sqlWords) === JSON.stringify(R.BAD_WORDS), 'запрещённые слова: браузер = ads.sql');
    const sqlShort = /ad_short_hosts\(\) returns text\[\][\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(read('ads.sql'))[1].match(/'([^']*)'/g).map(s => s.slice(1, -1));
    ok(JSON.stringify(sqlShort) === JSON.stringify(R.SHORT_HOSTS), 'короткие ссылки: браузер = ads.sql');
    const sqlPrices = JSON.parse(/prices jsonb not null default '([^']+)'::jsonb/.exec(read('ads.sql'))[1]);
    ok(JSON.stringify(sqlPrices) === JSON.stringify(D.DEF.prices), 'цены по умолчанию: браузер = ads.sql');

    // ═══ 10. Переход /go/<id> и /api/geo ═══
    const { default: pages } = await import(pathToFileURL(path.join(tmp, 'api/pages.js')).href);
    const fakeST = globalThis.setTimeout, fakeCT = globalThis.clearTimeout;
    globalThis.setTimeout = RT.setTimeout; globalThis.clearTimeout = RT.clearTimeout;   // сервер сайта — на настоящих таймерах
    const run = async (q, hdr = {}) => { const res = { h: {}, setHeader(k, v){ this.h[k] = v; }, status(c){ this.code = c; return this; }, send(x){ this.body = x; }, end(){} }; await pages({ query: q, headers: hdr }, res); return res; };
    let sb = null, sbCalls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u, o) => { sbCalls.push({ u, b: JSON.parse(o.body || '{}'), h: o.headers }); if (sb instanceof Error) throw sb; return { ok: !!sb, status: sb ? 200 : 500, text: async () => JSON.stringify(sb || { message: 'ошибка' }) }; };
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let res = await run({ page: 'go', id: 'abcdef1234', t: 'x' });
    ok(res.code === 503 && /больше не показывается/.test(res.body) && /noindex/.test(res.body), 'нет ключей сервера — страница «реклама больше не показывается»');
    process.env.SUPABASE_URL = 'https://sb.example.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    sb = { ok: true, url: 'https://www.youtube.com/@blogger', counted: true };
    res = await run({ page: 'go', id: 'abcdef1234', t: '1760522400.0123456789ab.feed_games.sig' }, { 'x-real-ip': '5.6.7.8', 'x-forwarded-for': '1.1.1.1', 'user-agent': 'Mozilla/5.0' });
    const call = sbCalls.pop();
    ok(res.code === 302 && res.h.Location === 'https://www.youtube.com/@blogger' && res.h['Cache-Control'] === 'private, no-store', '/go: 302 на сайт рекламодателя, без кэша', res.h);
    ok(call.u === 'https://sb.example.co/rest/v1/rpc/ad_go' && call.b.p_id === 'abcdef1234' && call.b.p_ip === '5.6.7.8' && call.b.p_ua === 'Mozilla/5.0' && /^1760522400\./.test(call.b.p_token) && call.h.Authorization === 'Bearer service-key',
      '/go: клик засчитывает база (ключ сервера, IP и браузер зрителя, подпись выдачи)', call);
    res = await run({ page: 'go', id: 'abcdef1234', t: 'x', d: '1' }, { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' });
    ok(sbCalls.pop().b.p_token === '' && res.code === 302, '/go?d=1 (отладка) — без подписи: переход есть, клик не считается');
    ok((await run({ page: 'go', id: 'abc', t: 'x' }, {})).code === 404, '/go: кривой номер — 404');
    sb = { ok: false, reason: 'gone' };
    res = await run({ page: 'go', id: 'abcdef1234' });
    ok(res.code === 410 && !res.h.Location && /больше не показывается/.test(res.body), '/go: снятая с показа — страница, без перехода');
    for (const bad of ['http://evil.example/', 'https://bit.ly/x', 'javascript:alert(1)', 'https://casino.example/']) {
      sb = { ok: true, url: bad };
      res = await run({ page: 'go', id: 'abcdef1234' });
      ok(res.code === 410 && !res.h.Location, `/go: ссылка из базы плохая (${bad}) — не перенаправляем`);
    }
    sb = new Error('сеть');
    ok((await run({ page: 'go', id: 'abcdef1234' })).code === 503, '/go: база не ответила — страница, без перехода');
    res = await run({ page: 'geo' }, { 'x-vercel-ip-country': 'ru' });
    ok(res.code === 200 && res.body === '{"c":"RU"}' && res.h['Cache-Control'] === 'private, no-store', '/api/geo: только код страны, без кэша');
    ok((await run({ page: 'geo' }, { 'x-vercel-ip-country': '<script>' })).body === '{"c":""}' && (await run({ page: 'geo' }, {})).body === '{"c":""}', '/api/geo: мусор или нет заголовка — пусто');
    // Правила для рекламодателей /ads-terms
    res = await run({ page: 'adsterms' });
    const tb = res.body || '';
    ok(res.code === 200 && /Правила рекламы на сайте/.test(tb) && /показать юристу/.test(tb), '/ads-terms: страница, пометка «шаблон — показать юристу»');
    ok(/38-ФЗ/.test(tb) && /erid/.test(tb) && /ОРД/.test(tb) && /Казахстан/.test(tb) && /партнёрский материал/.test(tb), '/ads-terms: маркировка — Россия (erid, ОРД) и Казахстан');
    ok(/азартные игры/.test(tb) && /вейпы/.test(tb) && /криптовалюты/.test(tb) && /ты выиграл/.test(tb), '/ads-terms: запрещённые темы');
    ok(/0\+, 6\+, 12\+, 16\+ или 18\+/.test(tb) && /до 13 лет — только 0\+ и 6\+/.test(tb), '/ads-terms: возрастные метки');
    ok(/Возврат неизрасходованного бюджета/.test(tb) && new RegExp(`Минимальный бюджет — ${D.DEF.min_budget}`).test(tb) && /noindex/.test(tb) === false && !/adsbygoogle\.js/.test(tb), '/ads-terms: возврат, цены из правил, без рекламы');
    const rk = await run({ page: 'reklama' });
    ok(rk.code === 200 && /Разместить рекламу самостоятельно/.test(rk.body) && /href="\/#\/adv"/.test(rk.body) && /href="\/ads-terms"/.test(rk.body), '/reklama: блок «Разместить рекламу самостоятельно» → кабинет и правила');
    globalThis.fetch = realFetch; globalThis.setTimeout = fakeST; globalThis.clearTimeout = fakeCT;
  } catch (e) { ok(false, 'сервер сайта', String(e && e.stack || e)); }
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ═══ 11. Крючки подключены ═══
{
  const has = (f, re, name) => ok(re.test(read(f)), name);
  has('index.html', /ad-places\.js"><\/script>\s*<script src="js\/core\/ad-direct\.js"><\/script>/, 'index.html: ad-direct.js сразу после ad-places.js');
  has('api/_lib/page.js', /ad-places\.js"><\/script>\s*<script src="\/js\/core\/ad-direct\.js"><\/script>/, 'серверные страницы: ad-direct.js после ad-places.js');
  has('api/_lib/page.js', /D37AdDirect\.ready\(f\)/, 'серверные страницы: места заполняются, когда известна сводка (не дольше 0,7 с)');
  has('js/core/ad-places.js', /if \(direct\(el, key, o\)\) \{ mark\(key\); return true; \}/, 'ad-places.js: прямая реклама раньше сети');
  has('js/core/ads-core.js', /M\.direct\?\.\(el, key, o\)/, 'ads-core.js: прямой вызов render — тоже');
  has('js/games/mir-promo.js', /D37AdDirect\?\.billboard\?\.\(\)/, 'mir-promo.js: щит — прямая реклама');
  has('api/pages.js', /go: adgo, geo/, 'api/pages.js: маршруты go и geo');
  const vj = JSON.parse(read('vercel.json'));
  ok(vj.rewrites.some(r => r.source === '/go/:id' && r.destination === '/api/pages?page=go&id=:id') && vj.rewrites.some(r => r.source === '/api/geo') && vj.rewrites.some(r => r.source === '/ads-terms' && r.destination === '/api/pages?page=adsterms'), 'vercel.json: /go/:id, /api/geo, /ads-terms');
  has('js/ui/router.js', /adv:\s*\['adv-page'\]/, 'router.js: раздел #/adv');
  has('js/ui/router.js', /route==='adv'\) window\.D37AdDirect\?\.cabinet\?\.\(currentRouteParam\(\)\)/, 'router.js: кабинет грузится при входе');
  has('index.html', /id="adv-page"[\s\S]{0,400}id="advRoot"/, 'index.html: блок кабинета');
  has('index.html', /href="#\/adv" data-route="adv"/, 'index.html: кабинет в меню сайта');
  has('js/features/fx.js', /'ads', 'adv'\]/, 'fx.js: кабинет в «Ещё ▾»');
  has('js/features/shop.js', /href="#\/adv"/, 'магазин: ссылка на кабинет');
  has('js/features/shop.js', /ads: 'Реклама на сайте', ads_refund: 'Возврат остатка рекламы'/, 'магазин: подписи в истории 💎');
  has('api/_lib/page.js', /href="\/#\/adv"/, 'серверные страницы: кабинет в меню и подвале');
  for (const f of ['js/features/adcab.js', 'css/adcab.css']) ok(fs.existsSync(path.join(SITE, f)), 'есть ' + f);
  ok(fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'функций Vercel не больше 12');
}

finished = true;
console.log(`\nad-direct-test: ${pass} ok, ${fail} fail`);
Date.now = realNow;
process.exit(fail ? 1 : 0);
})().catch(e => { finished = true; console.log('ad-direct-test: ОШИБКА после «' + last + '»', e); process.exit(1); });

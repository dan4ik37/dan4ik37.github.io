// Тесты возраста (js/core/age.js + реклама ad-places.js / ads-core.js + метки) в node, без браузера:
//  1) группы по году рождения и по дате (Новый год по МСК, «день рождения уже был»), allows(), canOpen() (мягкая обложка),
//     смена года: опечатка в первые сутки, 2 смены за 30 дней, «остывание» 30 дней, «стереть»;
//  2) ранняя метка в <head> (index.html и api/_lib/page.js — один и тот же код) = то, что ставит age.js;
//  3) метки роликов: VIDEO_RULES = api/_lib/topics.js, GAMBLING_RE = api/_lib/yt.js; метки игр: GAMES[].age = api/_lib/age.js;
//  4) реклама по группам: data-tag-for-age-treatment (1 / 2 / нет), без персональной (requestNonPersonalizedAds), детям — без
//     полноэкранной, полоски, рекламы за награду и спонсора, лимит 20; ADS_IDS.kids — на весь сайт; ADS_RULES.age.unknown;
//  5) гость → аккаунт (перенос один раз), выход — копия стёрта; без age.sql — всё в браузере;
//  6) тайна: возраст не уходит в адреса, сеть (кроме своих RPC), presence, события, рекламу (только признак), аналитику;
//  7) обложки, разделы, строка настроек, поле регистрации, окошко первого захода; детский фильтр текста;
//  8) серверные страницы: /v/<id> 18+ — data-age-page, списки — data-age="18", /api/ids — g.
// Запуск из корня сайта: node scripts/age-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
const { pathToFileURL } = require('url');
const SITE = process.argv[2] || path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

// ═══ Мини-DOM (разбор innerHTML, селекторы tag#id.cls[attr], события) — в каждом контексте свой ═══
function makeDom(){
  const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'wbr', 'option']);
  const decode = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
  let doc;
  class Text { constructor(t){ this.nodeType = 3; this.data = t; this.parentNode = null; } get textContent(){ return this.data; } remove(){ if (this.parentNode) this.parentNode._rm(this); } }
  class El {
    constructor(tag){
      this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.parentNode = null; this.attrs = {}; this.listeners = {};
      this.hidden = false; this.disabled = false; this.value = ''; this.style = {};
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
    get firstChild(){ return this.childNodes[0] || null; }
    get isConnected(){ let n = this; while (n.parentNode) n = n.parentNode; return n === doc.documentElement; }
    _rm(n){ const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
    appendChild(n){ if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.childNodes.push(n); return n; }
    prepend(n){ if (n.parentNode) n.parentNode._rm(n); n.parentNode = this; this.childNodes.unshift(n); return n; }
    insertBefore(n, ref){ if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode._rm(n); const i = this.childNodes.indexOf(ref); n.parentNode = this; this.childNodes.splice(i, 0, n); return n; }
    insertAdjacentElement(pos, n){ if (pos === 'afterend' && this.parentNode) { const p = this.parentNode, i = p.childNodes.indexOf(this); if (n.parentNode) n.parentNode._rm(n); n.parentNode = p; p.childNodes.splice(i + 1, 0, n); } return n; }
    remove(){ if (this.parentNode) this.parentNode._rm(this); }
    get textContent(){ return this.childNodes.map(n => n.textContent).join(''); }
    set textContent(t){ this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; if (t !== '' && t != null) this.appendChild(new Text(String(t))); }
    set innerHTML(html){ this.textContent = ''; parseInto(this, String(html)); }
    get innerHTML(){ return this.childNodes.map(serialize).join(''); }
    get outerHTML(){ return serialize(this); }
    addEventListener(t, fn){ (this.listeners[t] = this.listeners[t] || []).push(fn); }
    removeEventListener(t, fn){ this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
    dispatch(type){ const ev = { type, target: this, preventDefault(){}, stopPropagation(){} }; fire(ev); return ev; }
    click(){ return this.dispatch('click'); }
    querySelectorAll(sel){ return qsa(this, sel); }
    querySelector(sel){ return qsa(this, sel)[0] || null; }
    closest(sel){ let n = this; while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    focus(){} getBoundingClientRect(){ return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  }
  function serialize(n){
    if (n.nodeType === 3) return n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('');
    const t = n.tagName.toLowerCase();
    return VOID.has(t) && t !== 'option' ? `<${t}${a}>` : `<${t}${a}>${n.childNodes.map(serialize).join('')}</${t}>`;
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
        while ((a = ar.exec(m[3] || ''))) { const v = decode(a[2] ?? a[3] ?? a[4] ?? ''); if (a[1] === 'hidden') el.hidden = true; else el.attrs[a[1]] = v; }
        top.appendChild(el);
        if (el.tagName === 'OPTION' && 'value' in el.attrs) el.value = el.attrs.value;
        if (!VOID.has(m[2].toLowerCase()) || m[2].toLowerCase() === 'option') { if (!m[4]) stack.push(el); }
        continue;
      }
      if (m[5] && m[5].trim()) top.appendChild(new Text(decode(m[5])));
    }
    // <select>: значение — выбранный вариант
    for (const s of qsa(root, 'select')) { const o = s.children.find(x => 'selected' in x.attrs) || s.children[0]; s.value = o ? (o.attrs.value ?? '') : ''; }
  }
  function compound(t){
    const c = { tag: null, id: null, cls: [], attrs: [], not: [] };
    const re = /^([a-zA-Z*][a-zA-Z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*]?=)"?([^"\]]*)"?)?\]|:not\(([^)]*)\)|(:scope)/g; let m;
    while ((m = re.exec(t))) { if (m[1]) c.tag = m[1] === '*' ? null : m[1].toUpperCase(); else if (m[2]) c.id = m[2]; else if (m[3]) c.cls.push(m[3]); else if (m[4]) c.attrs.push([m[4], m[5], m[6]]); else if (m[7]) c.not.push(m[7]); if (m[0] === '') re.lastIndex++; }
    return c;
  }
  const parseSel = sel => sel.split(',').map(s => s.trim()).filter(Boolean).map(s => { const toks = s.replace(/\s*>\s*/g, ' > ').split(/\s+/); const parts = []; let comb = ' '; for (const t of toks) { if (t === '>') { comb = '>'; continue; } if (t === ':scope') continue; parts.push({ comb, c: compound(t) }); comb = ' '; } return parts; });
  function matchC(el, c){
    if (el.nodeType !== 1) return false;
    if (c.tag && el.tagName !== c.tag) return false;
    if (c.id && el.id !== c.id) return false;
    for (const k of c.cls) if (!el.classList.contains(k)) return false;
    for (const [k, op, v] of c.attrs) { const a = k in el.attrs ? el.attrs[k] : null; if (a === null) return false; if (op === '=' && a !== v) return false; }
    for (const n of c.not) if (matches(el, n)) return false;
    return true;
  }
  function matchParts(el, parts, i){
    if (!matchC(el, parts[i].c)) return false;
    if (i === 0) return true;
    let p = el.parentNode;
    if (parts[i].comb === '>') return !!p && p.nodeType === 1 && matchParts(p, parts, i - 1);
    while (p && p.nodeType === 1) { if (matchParts(p, parts, i - 1)) return true; p = p.parentNode; }
    return false;
  }
  const matches = (el, sel) => parseSel(sel).some(parts => parts.length && matchParts(el, parts, parts.length - 1));
  function qsa(root, sel){ const out = [], list = parseSel(sel); const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (list.some(parts => parts.length && matchParts(c, parts, parts.length - 1))) out.push(c); walk(c); } }; walk(root); return out; }
  const docListeners = {};
  function fire(ev){
    const pathEls = []; let n = ev.target; while (n && n.nodeType === 1) { pathEls.push(n); n = n.parentNode; }
    for (const el of pathEls) for (const fn of el.listeners[ev.type] || []) fn(ev);
    for (const fn of docListeners[ev.type] || []) fn(ev);
  }
  const html = new El('html'), head = new El('head'), body = new El('body');
  html.appendChild(head); html.appendChild(body);
  doc = { documentElement: html, head, body, readyState: 'complete', createElement: t => new El(t), createTextNode: t => new Text(t),
    getElementById: id => qsa(html, '#' + id)[0] || null, querySelector: s => qsa(html, s)[0] || null, querySelectorAll: s => qsa(html, s),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }, removeEventListener(){} };
  Object.defineProperty(html, 'clientWidth', { get: () => 1280 });
  return { doc, El };
}

// ═══ Контекст: окно, часы, хранилища, таймеры (ручные), сеть под замком ═══
function makeCtx(o = {}){
  const { doc } = makeDom();
  const clock = { t: o.t ?? Date.UTC(2026, 9, 15, 9, 0, 0) };
  const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, _s: s }; };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a){ if (!a.length) super(clock.t); else super(...a); } static now(){ return clock.t; } }
  let timers = [], tid = 0;
  const net = [], winL = {};
  const ctx = {
    console, Math, JSON, Promise, Number, String, Array, Object, Set, Map, WeakMap, RegExp, Error, Symbol, Proxy, Reflect, parseInt, parseFloat, isFinite, encodeURIComponent,
    Date: FakeDate, document: doc, localStorage: mem(), sessionStorage: mem(),
    location: { hash: '#/home', search: '', pathname: '/', hostname: 'dan4ik37.vercel.app', origin: 'https://dan4ik37.vercel.app', href: 'https://dan4ik37.vercel.app/' },
    history: { length: 1, back(){}, replaceState(){}, pushState(){} },
    innerWidth: 1280, matchMedia: q => ({ matches: /pointer:\s*coarse/.test(q) ? !!ctx.__touch : /max-width:\s*(\d+)px/.test(q) ? (ctx.__touch ? 400 : 1280) <= +/max-width:\s*(\d+)px/.exec(q)[1] : false }),
    setTimeout: (fn, ms) => { const id = ++tid; timers.push({ id, at: clock.t + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout: id => { timers = timers.filter(x => x.id !== id); },
    setInterval: () => 0, clearInterval: () => {},
    addEventListener: (t, fn) => { (winL[t] = winL[t] || []).push(fn); }, removeEventListener(){},
    dispatchEvent: ev => { (winL[ev.type] || []).forEach(fn => fn(ev)); return true; },
    CustomEvent: class { constructor(t, x){ this.type = t; this.detail = x?.detail; } }, Event: class { constructor(t){ this.type = t; } },
    IntersectionObserver: class { observe(){} unobserve(){} },
    getComputedStyle: () => ({ position: 'static' }),
    fetch: async u => { net.push(String(u)); throw new Error('сеть закрыта в тесте'); },
    navigator: { sendBeacon: u => { net.push('beacon:' + u); return true; } },
    Ya: { Context: { AdvManager: { render: p => { net.push('ya:' + p.blockId); } } } },
  };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  ctx.__clock = clock; ctx.__net = net;
  ctx.__advance = ms => { const end = clock.t + ms; for (;;) { const due = timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; clock.t = Math.max(clock.t, due.at); timers = timers.filter(x => x !== due); try { due.fn(); } catch (e) { console.log('таймер', e); } } clock.t = end; };
  vm.createContext(ctx);
  ctx.__run = f => vm.runInContext(read(f), ctx, { filename: f });
  return ctx;
}
const flush = () => new Promise(r => setImmediate(r));

const YEAR = 2026, NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
// ═══ 1. Группы, allows, смена года ═══
{
  const c = makeCtx(); c.__run('js/core/age.js'); c.__advance(10);
  const A = c.D37Age, T = A._test;
  ok(T.yearNow() === YEAR, 'год по МСК', T.yearNow());
  ok(A.group() === 'unknown' && !A.known() && A.age() === null, 'по умолчанию возраст не указан');
  ok(A.allows(0) && A.allows('6+') && A.allows(12) && A.allows('16+') && !A.allows(18), 'не указан: всё, кроме 18+');
  ok(A.listOk(18) && !A.hide18(), 'не указан: 18+ в списках видно (с меткой)');
  A.confirm18();
  ok(A.allows(18) && A.listOk(18), '«Мне есть 18» — 18+ открывается');
  T.reset(); c.sessionStorage.removeItem('d37_age_ok');
  const cases = [[2015, 10, 'child'], [2014, 11, 'child'], [2013, 12, 'child'], [2012, 13, 'teen'], [2010, 15, 'teen'], [2009, 16, 'teen16'], [2008, 17, 'teen16'], [2007, 18, 'adult'], [1980, 45, 'adult']];
  for (const [y, a, g] of cases) {
    T.reset(); T.localSet(y);
    ok(A.group() === g && A.age() === a, `${y} → ${a} лет, ${g}`, { g: A.group(), a: A.age() });
  }
  T.reset(); T.localSet(2013);
  ok(A.allows(12) && !A.allows(16) && A.kid() && A.minor() && A.hide18(), '12 лет: 12+ можно (но правила ребёнка), 16+ нельзя, 18+ скрыты');
  T.reset(); T.localSet(2014);
  ok(A.allows(6) && !A.allows(12), '11 лет: 6+ можно, 12+ нельзя');
  const r0 = T.localSet(2002);
  ok(r0.ok && !r0.cooling && A.group() === 'adult', 'в первые сутки — опечатка: взрослый сразу, без «остывания»', { r0, g: A.group() });
  // Новый год по Москве: 31.12 23:00 МСК — ещё 2026, 00:30 1.01 — уже 2027
  {
    const c2 = makeCtx({ t: Date.UTC(2026, 11, 31, 20, 0, 0) }); c2.__run('js/core/age.js');
    const B = c2.D37Age; B._test.localSet(2013);
    ok(B._test.yearNow() === 2026 && B.age() === 12 && B.group() === 'child', '31.12, 23:00 МСК: рождённый в 2013 — ещё 12');
    c2.__clock.t = Date.UTC(2026, 11, 31, 21, 30, 0);
    ok(B._test.yearNow() === 2027 && B.age() === 13 && B.group() === 'teen', '1.01, 00:30 МСК: уже 13 — подросток (группа «взрослеет» сама)');
  }
  // «день рождения уже был»: 2008 → 17 по году, 18 по нажатию; группа (реклама, сервер) — прежняя
  T.reset(); T.localSet(2008);
  ok(!A.allows(18) && /Мне уже исполнилось 18/.test(A.coverHtml(18)), '2008: 18+ закрыто, на обложке — «Мне уже исполнилось 18»');
  A.birthdayPassed();
  ok(A.allows(18) && A.age() === 18 && A.group() === 'teen16', '«исполнилось 18» — 18+ открыто, а группа для правил — 16–17 до 1 января');
  T.reset(); T.localSet(2015);
  ok(!/Мне уже исполнилось/.test(A.coverHtml(12)), '10–11 лет: на обложке 12+ кнопки «исполнилось» нет');
  // «остывание»: ребёнок через 2 дня выбрал 2000
  T.reset(); T.localSet(2015); c.__clock.t += 2 * 864e5;
  let r = T.localSet(2000);
  ok(r.ok && r.cooling && A.group() === 'child' && !A.allows(16) && A.year() === 2000, 'стал «взрослым» через 2 дня — 30 дней правила ребёнка («остывание»)', { r, g: A.group() });
  ok(A.hide18(), 'во время «остывания» 18+ в списках скрыты');
  r = T.localSet(1999);
  ok(r.ok, 'вторая смена за 30 дней — можно');
  r = T.localSet(1998);
  ok(!r.ok && r.reason === 'rate' && r.next_at, 'третья смена за 30 дней — нельзя (rate, next_at)', r);
  c.__clock.t += 31 * 864e5;
  ok(A.group() === 'adult' && A.allows(18), 'через 30 дней — взрослый');
  ok(T.localSet(1997).ok, 'через 30 дней — снова можно менять');
  c.__clock.t = NOW;
  // стереть: был подростком — 30 дней правила подростка; года нет
  T.reset(); T.localSet(2011); c.__clock.t += 3 * 864e5;
  A.clear();   // гость: без сервера — сразу
  ok(A.year() === null && A.group() === 'teen' && !A.allows(16), 'стёр год: года нет, 30 дней правила подростка');
  c.__clock.t = NOW;
  // «не хочу указывать»
  T.reset(); A.skip();
  ok(A.group() === 'unknown' && T.S().no === 1, '«Не хочу указывать» — возраст не указан, больше не спрашиваем');
  // мягкая обложка: «Взрослый разрешил» — 12+/16+ до конца визита, 18+ — никогда
  T.reset(); T.localSet(2015); c.sessionStorage.removeItem('d37_age_ok');
  ok(!A.canOpen(12) && /Взрослый разрешил/.test(A.coverHtml(12)), 'ребёнку 12+ — обложка с «Взрослый разрешил»');
  c.sessionStorage.setItem('d37_age_ok', '16');
  ok(A.canOpen(12) && A.canOpen(16) && !A.allows(16), '«Взрослый разрешил» — открывается до конца визита (allows по-прежнему строгий)');
  ok(!A.canOpen(18) && !/Взрослый разрешил/.test(A.coverHtml(18)) && !/Мне есть 18/.test(A.coverHtml(18)), '18+ несовершеннолетнему — без «разрешил» и без «Мне есть 18»');
  c.sessionStorage.removeItem('d37_age_ok');
  T.reset();
  ok(/Мне есть 18/.test(A.coverHtml(18)) && !/Взрослый разрешил/.test(A.coverHtml(18)), 'возраст не указан: на 18+ — «Мне есть 18»');
  // года вне 3…100 лет — нельзя
  A.set(YEAR - 2);
  ok(A.year() !== YEAR - 2, 'младше 3 лет — не принимаем');
  A.set(YEAR - 101);
  ok(A.year() !== YEAR - 101, 'старше 100 лет — не принимаем');
}

// ═══ 2. Ранняя метка в <head>: index.html и page.js — один код, и он совпадает с age.js ═══
(async () => {
  const idx = read('index.html'), pageSrc = read('api/_lib/page.js');
  const m = /export const AGE_HEAD = `([^`]+)`;/.exec(pageSrc);
  ok(!!m && idx.includes(m[1]), 'index.html и api/_lib/page.js: ранняя метка возраста — один и тот же код', !!m);
  const headJs = m ? m[1].replace(/^<script>|<\/script>$/g, '') : '';
  ok(idx.indexOf(m && m[1]) < idx.indexOf('adsbygoogle.js'), 'ранняя метка — до скрипта AdSense');
  const states = [{}, { c18: 1 }, { y: 2015 }, { y: 2008 }, { y: 2008, bd: 2026 }, { y: 1990 }, { y: 1990, fg: 'child', fu: NOW + 864e5 }, { y: 1990, fg: 'teen16', fu: NOW - 1 }, { no: 1, fg: 'teen', fu: NOW + 1e6 }, { y: 2026 }];
  for (const s of states) {
    const c = makeCtx(); c.localStorage.setItem('d37_age', JSON.stringify(s));
    vm.runInContext(headJs, c);
    const early = [...['d37-h18', 'd37-c18']].filter(x => c.document.documentElement.classList.contains(x)).join(',');
    c.document.documentElement.className = '';
    c.__run('js/core/age.js');
    const late = [...['d37-h18', 'd37-c18']].filter(x => c.document.documentElement.classList.contains(x)).join(',');
    ok(early === late, 'ранняя метка = age.js для ' + JSON.stringify(s), { early, late });
  }

  // ═══ 3. Метки роликов и игр — одни и те же на сервере и в браузере ═══
  const topics = await import(pathToFileURL(path.join(SITE, 'api/_lib/topics.js')).href);
  const c3 = makeCtx(); c3.__run('js/core/age.js');
  const A3 = c3.D37Age, VR = A3._test.VIDEO_RULES;
  const srvRules = [...topics.TOPICS, ...topics.AGE_EXTRA].map(t => [t.re.source, t.re.flags, t.age, t.ageWhy]);
  ok(VR.length === srvRules.length && VR.every((r, i) => r[0].source === srvRules[i][0] && r[0].flags === srvRules[i][1] && r[1] === srvRules[i][2] && r[2] === srvRules[i][3]),
    'VIDEO_RULES (age.js) = TOPICS + AGE_EXTRA (api/_lib/topics.js): регулярки, метки, «почему»');
  ok(A3.VIDEO_DEFAULT === topics.VIDEO_AGE_DEFAULT, 'метка ролика без темы — одна и та же');
  const yt = read('api/_lib/yt.js');
  const gm = /const GAMBLING_RE = (\/.+\/i);/.exec(yt);
  ok(gm && A3._test.GAMBLING_RE.source === eval(gm[1]).source, 'GAMBLING_RE: age.js = api/_lib/yt.js');
  const v = t => A3.video(t).age;
  ok(v('✅ ОТКРЫВАЮ КЕЙСЫ НА GGDROP! МОЙ ГГДРОП КОД') === 18 && v('CASE BATTLE промокод на деп') === 18, 'кейсы и промокоды на депозит — 18+');
  ok(v('Играем в CS2 — клатч') === 16 && v('Apex топ 1') === 16 && v('Metro 2033 финал') === 16 && v('Скилл тесты в гта 5 онлайн!') === 16 && v('Играем в самп #2') === 16, 'CS2, Apex, Metro, GTA/SAMP — 16+');
  ok(v('FNAF секреты') === 12 && v('Хоррор в роблокс') === 12 && v('Мёртвые рельсы ивент') === 12, 'хорроры, FNAF, «Мёртвые рельсы» — 12+');
  ok(v('Roblox обби с подписчиками') === 6 && v('Minecraft выживание') === 6, 'Роблокс без хоррора, Майнкрафт — 6+');
  ok(v('Duolingo walkthrough') === 12 && v('Dying light на русском') === 12, 'без темы — 12+');
  ok(v('Сгта') === 12 && v('ГТА 5 трюки') === 16, '«гта» — только отдельным словом');
  // игры: GAMES[].age (games.js) = GAME_AGE (api/_lib/age.js)
  const gsrc = read('js/features/games.js');
  const block = gsrc.slice(gsrc.indexOf('const GAMES = ['), gsrc.indexOf('];', gsrc.indexOf('const GAMES = [')) + 1).replace('const GAMES = ', '');
  const GAMES = eval(block);
  const hb = gsrc.slice(gsrc.indexOf('const GAMES_HIDDEN = ['), gsrc.indexOf('];', gsrc.indexOf('const GAMES_HIDDEN = [')) + 1).replace('const GAMES_HIDDEN = ', '');
  const HIDDEN = eval(hb);
  const { GAME_AGE, videoAge, ageBadge } = await import(pathToFileURL(path.join(SITE, 'api/_lib/age.js')).href);
  ok(GAMES.length >= 40 && GAMES.every(g => /^(0|6|12|16|18)\+$/.test(g.age)), 'у каждой игры в GAMES — метка 0+/6+/12+/16+/18+', GAMES.filter(g => !g.age).map(g => g.id));
  ok(HIDDEN.every(g => /^(0|6|12|16|18)\+$/.test(g.age)), 'у скрытых страниц (GAMES_HIDDEN) — тоже');
  ok(GAMES.every(g => GAME_AGE[g.id] && GAME_AGE[g.id][0] === parseInt(g.age) && (GAME_AGE[g.id][1] || '') === (g.ageWhy || '')), 'метки и «почему» игр: games.js = api/_lib/age.js',
    GAMES.filter(g => !GAME_AGE[g.id] || GAME_AGE[g.id][0] !== parseInt(g.age)).map(g => g.id));
  ok(GAMES.every(g => g.age === '0+' || g.ageWhy), 'у каждой метки выше 0+ есть «почему»');
  ok(Object.keys(GAME_AGE).every(id => GAMES.some(g => g.id === id)), 'в GAME_AGE нет лишних игр');
  const ga = id => GAMES.find(g => g.id === id).age;
  ok(ga('world') === '12+' && ga('arena') === '12+' && ga('horde') === '12+' && ga('chess') === '0+' && ga('td') === '6+' && ga('studio') === '6+' && ga('unity') === '12+', 'мир, «Арена», «Орда» — 12+; шахматы — 0+; «Башни», студия — 6+; Unity — 12+');
  ok(videoAge('ggdrop кейсы').age === 18 && videoAge('Roblox').age === 6 && videoAge('x').age === 12, 'сервер: videoAge');
  ok(ageBadge(16) === '<span class="age-b age-b16">16+</span>' && ageBadge(12, { min: 16 }) === '', 'сервер: значок; в списках — от 16+');
  // разделы
  ok(A3.area('chat').age === 12 && A3.area('forum').age === 12 && A3.area('lfg').age === 12 && A3.area('shop').age === 0 && A3.SITE_AGE === 12, 'разделы: чат/форум/тиммейты 12+, магазин 0+, сайт 12+');
  const pg = await import(pathToFileURL(path.join(SITE, 'api/_lib/page.js')).href);
  ok(pg.SITE_AGE === A3.SITE_AGE && read('index.html').includes(`class="age-mark"`) && read('index.html').includes(`>${A3.SITE_AGE}+</span>`), 'метка сайта в подвале SPA и серверных страниц — одна');

  // ═══ 4. Реклама по возрасту ═══
  const adsCtx = (state, o = {}) => {
    const c = makeCtx();
    if (state) c.localStorage.setItem('d37_age', JSON.stringify(state));
    c.__touch = !!o.touch;
    if (o.preRules) c.ADS_RULES = o.preRules;
    c.adsbygoogle = []; c.adsbygoogle.pauseAdRequests = 1; c.__d37Paused = true;   // как строчка в <head>
    c.__run('js/core/age.js'); c.__run('js/core/ads-core.js');
    c.ADS_IDS.yandex.rewarded = 'R-A-1-7'; c.ADS_IDS.yandex.rewarded_desktop = 'R-A-1-8'; c.ADS_IDS.yandex.fullscreen = 'R-A-1-9'; c.ADS_IDS.yandex.floor = 'R-A-1-10';
    if (o.kids != null) c.ADS_IDS.kids = o.kids;
    c.__run('js/core/ad-places.js');
    c.__advance(5);
    return c;
  };
  const tagOf = c => { const el = c.document.createElement('div'); c.document.body.appendChild(el); c.D37Ads.render(el, 'games_hub'); const ins = el.querySelector('ins'); return ins ? ins.getAttribute('data-tag-for-age-treatment') : 'нет блока'; };
  const G = { child: { y: 2015 }, teen: { y: 2011 }, teen16: { y: 2009 }, adult: { y: 1990 }, unknown: null };
  const exp = { child: ['1', 1], teen: ['2', 1], teen16: ['2', 1], adult: [null, 0], unknown: ['2', 1] };
  for (const [g, st] of Object.entries(G)) {
    const c = adsCtx(st);
    ok(c.D37AdPlaces.adAge() === (g === 'unknown' ? 'teen' : g), `${g}: группа рекламы`, c.D37AdPlaces.adAge());
    ok(tagOf(c) === exp[g][0], `${g}: Google data-tag-for-age-treatment = ${exp[g][0] || 'нет'}`, tagOf(c));
    ok(c.adsbygoogle.requestNonPersonalizedAds === exp[g][1], `${g}: без персональной рекламы = ${exp[g][1]}`);
    ok(c.adsbygoogle.pauseAdRequests === 0, `${g}: пауза из <head> снята (не VIP)`);
  }
  {
    const c = adsCtx(G.child, { touch: true }), M = c.D37AdPlaces;
    ok(M.why('interstitial') === 'age' && M.why('floor') === 'age', 'ребёнок: без полноэкранной и полоски (why → age)', [M.why('interstitial'), M.why('floor')]);
    ok(c.D37Ads.rewardReady() === false && M.coinOffer('hub') === '', 'ребёнок: реклама за награду не предлагается (и монеты за рекламу)');
    ok(await c.D37Ads.showReward('x') === false && await c.D37Ads.prepareReward('x') === false, 'ребёнок: showReward/prepareReward — сразу нет');
    ok(c.D37Ads.interstitial('t') === false && c.D37Ads.interstitial('t') === false, 'ребёнок: полноэкранная между партиями не показывается');
    ok(await M.sponsor() === null, 'ребёнок: спонсор щитов не показывается');
    for (let i = 0; i < 20; i++) M.mark('games_hub');
    ok(M.why('games_hub') === 'budget', 'ребёнок: не больше 20 показов за визит');
  }
  {
    const c = adsCtx(G.teen, { touch: true }), M = c.D37AdPlaces;
    ok(M.why('interstitial') !== 'age' && M.why('floor') !== 'age' && c.D37Ads.rewardReady() === true, 'подросток: полноэкранная, полоска и за награду — по обычным правилам');
    for (let i = 0; i < 20; i++) M.mark('games_hub');
    ok(M.why('games_hub') === '', 'подросток: общий лимит 40, не 20');
  }
  {
    const c = adsCtx(G.adult, { kids: 1 });
    ok(c.D37AdPlaces.adAge() === 'child' && tagOf(c) === '1' && c.D37Ads.rewardReady() === false, 'ADS_IDS.kids = 1: весь сайт как для ребёнка');
    const c2 = adsCtx(G.adult, { kids: 2 });
    ok(c2.D37AdPlaces.adAge() === 'teen' && tagOf(c2) === '2', 'ADS_IDS.kids = 2: взрослым — не старше подростка');
    const c3b = adsCtx(G.child, { kids: 2 });
    ok(c3b.D37AdPlaces.adAge() === 'child' && tagOf(c3b) === '1', 'ADS_IDS.kids = 2: ребёнок остаётся ребёнком (строже из двух)');
  }
  {
    const c = adsCtx(null, { preRules: { age: { unknown: 'adult', child: { tfat: 1, npa: 1, off: ['interstitial', 'floor', 'reward', 'sponsor'], budget: 20 }, teen: { tfat: 2, npa: 1, off: [] }, teen16: { tfat: 2, npa: 1, off: [] }, adult: { tfat: 0, npa: 0, off: [] } } } });
    ok(c.D37AdPlaces.adAge() === 'adult' && tagOf(c) === null && c.adsbygoogle.requestNonPersonalizedAds === 0, 'ADS_RULES.age.unknown = «adult»: без возраста — обычная реклама (одно место настройки)');
  }
  {
    const c = adsCtx(G.adult);
    c.localStorage.setItem('d37_noads', JSON.stringify({ until: NOW + 864e5 }));
    c.D37AdPlaces.gate();
    ok(c.adsbygoogle.pauseAdRequests === 1, 'VIP: запросы на паузе');
    // сменил возраст — правила рекламы сразу
    const d = adsCtx(G.adult);
    d.D37Age._test.localSet(2015);   // опечатка в первые сутки — сразу ребёнок
    d.dispatchEvent(new d.Event('d37:age')); d.__advance(5);
    ok(d.adsbygoogle.requestNonPersonalizedAds === 1 && tagOf(d) === '1', 'указал другой возраст — реклама по новой группе сразу');
    ok(!JSON.stringify(d.document.body.innerHTML).includes('2015'), 'в разметке рекламы нет года рождения');
  }

  // ═══ 5. Гость → аккаунт; выход; без age.sql ═══
  const fakeSb = (srv) => {
    const calls = [];
    return { calls, rpc: async (name, args) => {
      calls.push([name, args]);
      if (srv.missing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      if (name === 'my_age_group') return { data: { ok: true, year: srv.year ?? null, group: 'x', changes_left: 2 }, error: null };
      if (name === 'age_set') { srv.year = args.p_year; return { data: { ok: true, year: args.p_year, first_at: new Date(NOW).toISOString(), changes_left: 2, kid_defaults: false }, error: null }; }
      if (name === 'age_clear') { srv.year = null; return { data: { ok: true, year: null, changes_left: 1 }, error: null }; }
      return { data: null, error: { message: 'нет' } };
    } };
  };
  {
    const c = makeCtx(); c.__run('js/core/age.js'); c.__advance(5);
    const A = c.D37Age;
    A._test.localSet(2011);   // гость указал
    const srv = { year: null }; c.sbClient = fakeSb(srv); c.currentUser = { id: 'u1' };
    c.dispatchEvent(new c.Event('d37:auth')); c.__advance(5); await flush(); await flush(); await flush();
    const sets = c.sbClient.calls.filter(x => x[0] === 'age_set');
    ok(sets.length === 1 && sets[0][1].p_year === 2011 && srv.year === 2011, 'вход: гостевой год перенесён в аккаунт (один раз)', c.sbClient.calls);
    ok(A._test.S().s === 'a' && A.year() === 2011, 'в браузере — копия аккаунта');
    // выход — копия стёрта; второй вход — не переносим снова
    c.currentUser = null; c.dispatchEvent(new c.Event('d37:auth')); c.__advance(5);
    ok(A.year() === null && A.group() === 'unknown' && c.localStorage.getItem('d37_age') === null, 'выход: год аккаунта стёрт из браузера (общий компьютер)');
    c.currentUser = { id: 'u1' }; c.dispatchEvent(new c.Event('d37:auth')); c.__advance(5); await flush(); await flush();
    ok(A.year() === 2011 && c.sbClient.calls.filter(x => x[0] === 'age_set').length === 1, 'снова вошёл: год пришёл с сервера, повторного переноса нет');
    // у аккаунта уже есть год — гостевой не перетирает
    const c2 = makeCtx(); c2.__run('js/core/age.js'); c2.__advance(5);
    c2.D37Age._test.localSet(2015);
    const srv2 = { year: 1990 }; c2.sbClient = fakeSb(srv2); c2.currentUser = { id: 'u2' };
    c2.dispatchEvent(new c2.Event('d37:auth')); c2.__advance(5); await flush(); await flush();
    ok(c2.D37Age.year() === 1990 && !c2.sbClient.calls.some(x => x[0] === 'age_set'), 'у аккаунта есть год — гостевой не переносим, берём аккаунта');
    // смена года вошедшим — через сервер
    const r = await c2.D37Age.set(1991);
    ok(r.ok && srv2.year === 1991 && c2.D37Age.year() === 1991, 'вошёл: смена года — через age_set');
    await c2.D37Age.clear();
    ok(srv2.year === null && c2.D37Age.year() === null, 'вошёл: «Удалить» — через age_clear');
    // без age.sql — всё в браузере
    const c3 = makeCtx(); c3.__run('js/core/age.js'); c3.__advance(5);
    c3.sbClient = fakeSb({ missing: true }); c3.currentUser = { id: 'u3' };
    c3.dispatchEvent(new c3.Event('d37:auth')); c3.__advance(5); await flush(); await flush();
    const r3 = await c3.D37Age.set(2010);
    ok(r3.ok && c3.D37Age.year() === 2010 && c3.D37Age._test.srv() === false, 'нет age.sql (PGRST202): год хранится в браузере, без ошибок');
  }

  // ═══ 6. Тайна: адреса, сеть, события, presence, аналитика ═══
  {
    const src = read('js/core/age.js');
    ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|\bym\(|window\.va\(|\bva\(|\.track\(/.test(src), 'age.js: никакой сети, кроме своих RPC (нет fetch, Метрики, Vercel, presence)');
    const rpcs = [...src.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1]);
    ok(rpcs.every(n => ['my_age_group', 'age_set', 'age_clear', 'age_set_rating', 'kid_contact'].includes(n)), 'age.js: только RPC age.sql', rpcs);
    ok(!/location\.(href|hash)\s*=\s*[^;]*(S\.y|year|age\(\))/.test(src) && !/pushState|replaceState/.test(src), 'age.js: возраст не попадает в адрес');
    ok(/detail: \{ group: group\(\) \}/.test(src) && !/detail:[^}]*\by\b/.test(src), 'событие d37:age — только группа, без года');
    // presence / broadcast / аналитика в остальных файлах — без возраста
    const files = [];
    const walk = d => { for (const f of fs.readdirSync(path.join(SITE, d))) { const p = d + '/' + f; if (fs.statSync(path.join(SITE, p)).isDirectory()) walk(p); else if (/\.js$/.test(f)) files.push(p); } };
    walk('js');
    const bad = [];
    for (const f of files) {
      if (f === 'js/core/age.js') continue;
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (/\.track\(|type: 'broadcast'|\.send\(\{|window\.va\(|\bym\(/.test(l) && /D37Age|birth|d37_age|ageGroup|\.year\(\)/.test(l)) bad.push(f + ':' + (i + 1));
        if (/d37_age['"]/.test(l)) bad.push(f + ':' + (i + 1) + ' читает d37_age');
      });
    }
    ok(!bad.length, 'никто, кроме age.js (и ранней метки), не читает год и не шлёт возраст в presence / сообщения / аналитику', bad);
    // настоящий прогон: указал и стёр год — адрес и сеть не тронуты
    const c = makeCtx(); c.__run('js/core/age.js'); c.__advance(5);
    const before = JSON.stringify(c.location);
    await c.D37Age.set(2012); await c.D37Age.clear(); c.D37Age.confirm18(); c.D37Age.birthdayPassed();
    ok(JSON.stringify(c.location) === before && c.__net.length === 0, 'указал / стёр / подтвердил: адрес не менялся, запросов в сеть нет', c.__net);
    const meta = read('index.html').match(/ym\(113596397,'init',\{[^}]*\}\)/)?.[0] || '';
    ok(meta && !/webvisor:true/.test(meta), 'Метрика: Вебвизор выключен (поле года никто не записывает)');
    ok(/ym-disable-keys/.test(src) && /ym-hide-content/.test(src), 'поля года помечены для Метрики: не записывать нажатия и содержимое');
  }

  // ═══ 7. Обложки, разделы, настройки, регистрация, окошко первого захода, детский фильтр ═══
  {
    const c = makeCtx(); c.__run('js/core/age.js'); c.__advance(5);
    const A = c.D37Age, doc = c.document;
    // раздел чата ребёнку 10 лет — обложка, сам раздел спрятан
    A._test.localSet(2015);
    const chat = doc.createElement('div'); chat.id = 'chat'; doc.body.appendChild(chat);
    ok(A.gateRoute('chat', ['chat']) === true && chat.style.display === 'none' && doc.getElementById('ageGate'), 'чат ребёнку 10 лет — обложка вместо раздела');
    ok(A.gateRoute('home', ['hero']) === false && !doc.getElementById('ageGate'), 'ушёл на главную — обложка убрана');
    // «Взрослый разрешил» → раздел открывается
    A.gateRoute('chat', ['chat']);
    let reopened = 0; c.showPage = () => { reopened++; }; c.currentRoute = () => 'chat';
    doc.querySelector('#ageGate [data-age-act="soft"]').click();
    ok(reopened === 1 && !doc.getElementById('ageGate') && A.canOpen(12), '«Взрослый разрешил» — чат открывается до конца визита');
    // подростку чат — без обложки
    A._test.reset(); c.sessionStorage.removeItem('d37_age_ok'); A._test.localSet(2011);
    ok(A.gateRoute('chat', ['chat']) === false, 'подростку чат — без обложки');
    // сменил возраст, стоя в чате: раздел пересобирается сам (обложка нужна), а если ничего не поменялось — не трогаем
    reopened = 0;
    await A.set(2015); c.__advance(5);
    ok(reopened === 1, 'стал «ребёнком», стоя в чате, — раздел пересобран (обложка появится сразу)', reopened);
    A.gateRoute('chat', ['chat']); reopened = 0;
    A.confirm18(); c.__advance(5);
    ok(reopened === 0, 'обложка уже стоит и нужна — лишней пересборки нет');
    A._test.reset(); A._test.localSet(2011); A.gateRoute('chat', ['chat']);
    // обложка игры: «Мне есть 18» для не указавшего возраст
    A._test.reset();
    const box = doc.createElement('div'); doc.body.appendChild(box);
    let opened = 0;
    ok(A.cover(box, 18, { why: 'тест', onOpen: () => opened++ }) === true && box.classList.contains('age-on'), 'не указан: 18+ — обложка');
    box.querySelector('[data-age-act="ok18"]').click();
    ok(opened === 1 && !box.classList.contains('age-on') && A.allows(18), '«Мне есть 18» — открыто и запомнено');
    ok(A.cover(box, 18, {}) === false, 'второй раз — без обложки');
    // строка настроек
    A._test.reset(); A._test.localSet(2010);
    const row = A.settingsRow();
    ok(/data-age-act="change"/.test(row) && /data-age-act="clear"/.test(row) && /2010/.test(row) && /15–16 лет/.test(row), '⚙️ «Сайт»: «🎂 Возраст» — год, «Изменить», «Удалить»', row.slice(0, 300));
    A._test.reset();
    ok(/Указать год/.test(A.settingsRow()) && !/data-age-act="clear"/.test(A.settingsRow()), 'не указан: «Указать год»');
    ok(read('js/core/settings.js').includes('D37Age.settingsRow()'), 'settings.js: строка возраста во вкладке «Сайт»');
    // окошко «Изменить» → выбрать год → «Сохранить»
    A._test.reset();
    doc.querySelector('body').appendChild(Object.assign(doc.createElement('button'), {})).setAttribute('data-age-act', 'change');
    doc.querySelector('[data-age-act="change"]').click();
    const sheet = doc.querySelector('.age-sheet');
    ok(!!sheet && sheet.classList.contains('edit') && sheet.querySelectorAll('option').length >= 90, '«Изменить» — окошко с годами', sheet && sheet.querySelectorAll('option').length);
    sheet.querySelector('.age-sel').value = '2005';
    sheet.querySelector('[data-age-act="save"]').click(); await flush(); await flush();
    ok(A.year() === 2005 && !doc.querySelector('.age-sheet'), '«Сохранить» — год сохранён, окошко закрыто');
    // регистрация: поле «Год рождения» перед кнопкой
    const c2 = makeCtx(); const d2 = c2.document;
    d2.body.innerHTML = '<div id="globalAuthModal"></div><div id="gauthRegisterFields"><input id="gauthRegNick"><button class="auth-submit">ЗАРЕГИСТРИРОВАТЬСЯ</button></div>';
    c2.__run('js/core/age.js'); c2.__advance(5);
    const reg = d2.querySelector('#gauthRegisterFields .age-reg');
    const kids = d2.getElementById('gauthRegisterFields').children;
    ok(!!reg && kids.indexOf(reg) === kids.length - 2, 'регистрация: «🎂 Год рождения» прямо перед кнопкой');
    ok(/Не хочу указывать/.test(reg.innerHTML), 'регистрация: можно не указывать');
    const sel = reg.querySelector('select'); sel.value = '2012'; sel.dispatch('change'); await flush();
    ok(c2.D37Age.year() === 2012 && c2.D37Age._test.S().s === 'g', 'регистрация: год запомнен как гостевой (после входа уйдёт в аккаунт)');
    // окошко первого захода: SPA, через 7 с, «Потом» — на 3 дня, «Не хочу» — больше не спрашиваем
    const c3b = makeCtx(); c3b.document.body.innerHTML = '<div id="globalAuthModal"></div>';
    c3b.__run('js/core/age.js'); c3b.__advance(3000);
    ok(!c3b.document.querySelector('.age-sheet'), 'первые секунды — без окошка');
    c3b.__advance(5000);
    const sh = c3b.document.querySelector('.age-sheet');
    ok(!!sh && !sh.classList.contains('edit') && /Сколько тебе лет/.test(sh.innerHTML) && /никто|только ты/i.test(sh.innerHTML), 'через 7 с — спокойное окошко «Сколько тебе лет?» (не стена) и что год видишь только ты');
    sh.querySelector('[data-age-act="later"]').click();
    ok(!c3b.document.querySelector('.age-sheet') && +c3b.localStorage.getItem('d37_age_ask') > NOW + 2 * 864e5, '«Потом» — закрыто, спросим через 3 дня');
    const c4 = makeCtx(); c4.document.body.innerHTML = '<div id="globalAuthModal"></div>'; c4.__run('js/core/age.js'); c4.__advance(8000);
    c4.document.querySelector('.age-sheet [data-age-act="no"]').click();
    ok(c4.D37Age._test.S().no === 1 && !c4.document.querySelector('.age-sheet'), '«Не хочу указывать» — больше не спрашиваем');
    const c5 = makeCtx(); c5.document.body.innerHTML = '<div id="globalAuthModal"></div>'; c5.document.body.classList.add('game-on'); c5.__run('js/core/age.js'); c5.__advance(8000);
    ok(!c5.document.querySelector('.age-sheet'), 'идёт игра — окошко не мешает');
    const c6 = makeCtx(); c6.__run('js/core/age.js'); c6.__advance(8000);
    ok(!c6.document.querySelector('.age-sheet'), 'серверные страницы — без окошка');
    // детский фильтр текста
    const K = c.D37Age.kidText;
    ok(K('пиши в тг: @vasya_77') === 'пиши в [скрыто]: [скрыто]', 'дети: «тг» и ник соцсети — скрыто', K('пиши в тг: @vasya_77'));
    ok(K('мой номер +7 900 123-45-67') === 'мой номер [скрыто]' && K('почта vasya@mail.ru') === 'почта [скрыто]', 'дети: телефон и почта — скрыто');
    ok(K('скинь фото') === '[скрыто]' && /\[скрыто\]/.test(K('а где ты живёшь?')), 'дети: «скинь фото», «где живёшь» — скрыто');
    ok(K('вкусно сыграли, рекорд 12345') === 'вкусно сыграли, рекорд 12345', 'обычный текст и короткие числа — как есть');
    ok(K('@Vasya привет', { at: false }) === '@Vasya привет', 'в чате сайта @ник (упоминание) — можно');
    ok(read('js/games/world.js').includes('D37Age.kidText(out)') && read('js/games/mir.js').includes('D37Age.kidText(out)'), 'мир (2D и 3D, «Весь мир»): строгий фильтр для детей');
    // чат сайта (msgview.js): ребёнку ссылки скрыты, кроме роликов и игр
    const c7 = makeCtx(); c7.__run('js/core/age.js'); c7.D37Age._test.localSet(2015);
    c7.D37Phone = { clean: s => s, onlyEmoji: () => false, plural: (n, a) => a, me: () => null, myNick: () => '' };
    c7.__run('js/features/msgview.js');
    const MV = c7.MsgView;
    const kid = MV.rich('го https://dan4ik37.vercel.app/g/abcdef12 и https://dan4ik37.vercel.app/v/dQw4w9WgXcQ #/c/abcdefgh +79001234567', '', { kid: true });
    ok(/\[ссылка\]/.test(kid.html) && kid.cards.some(x => x.t === 'video') && !kid.cards.some(x => x.t === 'ugc' || x.t === 'invite') && /\[скрыто\]/.test(kid.html), 'чат: ребёнку игры игроков и приглашения — «[ссылка]», ролики — можно, телефон — скрыт', kid);
    const adult = MV.rich('https://dan4ik37.vercel.app/g/abcdef12', '', {});
    ok(adult.cards.some(x => x.t === 'ugc'), 'чат: остальным ссылка на игру игрока — карточкой');
    ok(read('js/features/msgview.js').includes("!/^dm:/.test(V.A?.key || '')"), 'ЛС (только друзья) — без детских ограничений ссылок');
  }

  // ═══ 8. Серверные страницы ═══
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-age-'));
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('нет сети'); };
    const res = () => ({ h: {}, setHeader(k, v){ this.h[k] = v; return this; }, status(c){ this.code = c; return this; }, send(x){ this.html = x; return this; } });
    const imp = f => import(pathToFileURL(path.join(tmp, f)).href);
    try {
      const { SNAPSHOT } = await imp('api/_lib/uploads-snapshot.js');
      const lines = SNAPSHOT.split('\n').map(l => l.split('\t'));
      const gam = lines.find(l => /ggdrop/i.test(l[2]));
      const { default: video } = await imp('api/video.js');
      let r = res(); await video({ query: { id: gam[0] } }, r);
      ok(r.code === 200 && /<main class="wrap" data-age-page="18"/.test(r.html) && /age-b18/.test(r.html), '/v/<кейсы>: data-age-page="18" и значок 18+');
      ok(r.html.includes(pg.AGE_HEAD) && /<script src="\/js\/core\/age\.js"><\/script>\s*<script src="\/js\/core\/ads-core\.js">/.test(r.html), '/v/<id>: ранняя метка и age.js (до рекламы)');
      ok(/class="age-mark"[^>]*>12\+<\/span>/.test(r.html), 'серверные страницы: метка сайта 12+ в подвале');
      ok(!/birth|d37_age.*=/.test(r.html.replace(pg.AGE_HEAD, '')), 'страница не знает возраста посетителя');
      const { default: videos } = await imp('api/_lib/routes/videos.js');
      let found = 0;
      for (let p = 1; p <= 25 && !found; p++) {
        r = res(); await videos({ query: { p: String(p) } }, r);
        const g18 = (r.html.match(/<a class="card"[^>]*data-age="18"/g) || []).length;
        const gTitles = (r.html.match(/<a class="card" href="\/v\/[^"]+"[^>]*>[\s\S]*?<\/a>/g) || []).filter(x => /ggdrop|ггдроп|case\s*battle|кейс\s*батл|казино|casino|депозит/i.test(x)).length;
        if (g18) { found = p; ok(g18 >= gTitles && g18 > 0, `/videos?p=${p}: ролики про кейсы — data-age="18" (несовершеннолетнему спрятаны)`, { g18, gTitles }); }
      }
      ok(found > 0, 'в архиве нашлась страница с роликами 18+');
      const { default: ids } = await imp('api/_lib/routes/ids.js');
      r = res(); await ids({ query: {} }, r);
      const d = JSON.parse(r.html);
      ok(d.g && d.g.length % 11 === 0 && d.g.length > 11 * 100 && d.ids.includes(d.g.slice(0, 11)), '/api/ids: g — ролики 18+ («Удиви меня» несовершеннолетнему их не выберет)');
      ok(read('js/core/surprise.js').includes("D37Age.listOk(18)"), 'surprise.js: несовершеннолетнему 18+ не выпадают');
      const { default: game } = await imp('api/game.js');
      r = res(); game({ query: { id: 'horde' } }, r);
      ok(/"contentRating":"12\+"/.test(r.html) && /age-b12/.test(r.html), '/games/horde: метка 12+ и contentRating в JSON-LD');
      r = res(); game({ query: {} }, r);
      ok((r.html.match(/class="age-b age-b\d+"/g) || []).length >= 30, '/games: значки на всех карточках');
    } catch (e) { ok(false, 'серверные страницы', String(e && e.stack || e)); }
    globalThis.fetch = oldFetch;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ═══ 9. Подключено, где надо (если кто-то сотрёт строку при слиянии) ═══
  const has = (f, re, name) => ok(re.test(read(f)), name);
  has('index.html', /<script src="js\/core\/config\.js"><\/script>\s*(?:<!--[^>]*-->\s*<script src="js\/ui\/router\.js"><\/script>\s*)?<script src="js\/core\/age\.js"><\/script>\s*<script src="js\/core\/ads-core\.js">/, 'index.html: age.js перед рекламой (роутер — только карта адресов, рекламы не трогает)');
  has('index.html', /window\.__d37Paused=true;\(window\.adsbygoogle=window\.adsbygoogle\|\|\[\]\)\.pauseAdRequests=1/, 'index.html: запросы AdSense на паузе с самого начала');
  has('js/ui/router.js', /D37Age\?\.gateRoute\?\.\(route, activeIds\)/, 'router.js: разделы по возрасту');
  has('js/features/games.js', /D37Age\?\.cover\(box, g\.age/, 'games.js: обложка игры не по возрасту');
  has('js/ui/modal.js', /D37Age\.cover\(box, va\.age/, 'modal.js: обложка ролика');
  has('js/features/youtube.js', /D37Age\.listOk\(D37Age\.video\(v\.title\)\.age\)/, 'youtube.js: 18+ не в ленте несовершеннолетнего');
  has('js/features/shorts.js', /D37Age\.allows\(D37Age\.video\(v\.title\)\.age\)/, 'shorts.js: лента Shorts — по возрасту');
  has('js/games/studio.js', /AU\(\)\.age\(g\.age_rating\)/, 'Студия игр: обложка чужой игры');
  has('js/games/studio3d.js', /AG\.cover\(L, n/, 'Студия 3D: обложка чужого мира');
  has('js/games/unity-host.js', /AU\(\)\.age\(g\.age_rating\)/, 'Unity-игры: обложка чужой игры');
  has('js/features/shop.js', /pa === 'age_child' \|\| pa === 'age_unknown'/, 'магазин: до 14 и без года — без оплаты (premium_pay_age)');
  has('js/features/phone.js', /id === 'comm' && area && !AG\.canOpen/, 'телефон: сообщества — как чат (12+)');
  has('privacy.html', /Возраст \(по желанию\)/, 'политика конфиденциальности (/privacy): про год рождения');
  has('index.html', /Возраст \(по желанию\):<\/strong>/, 'политика конфиденциальности (окно): про год рождения');
  // Функции магазина — только в premium.sql (22.10): оплата по возрасту — premium_pay_age (до 14 — нельзя), лимиты — age_shop_caps
  const fn = (s, name) => { const i = s.indexOf('create or replace function public.' + name + '('); return i < 0 ? '' : s.slice(i, s.indexOf('$$;', i) + 3); };
  const AS = read('age.sql'), PS = read('premium.sql');
  ok(!fn(AS, 'premium_state') && !fn(AS, 'premium_order_create') && /premium_pay_age/.test(fn(PS, 'premium_order_create'))
    && /age_shop_caps/.test(fn(PS, 'premium_order_create')) && /v_age < 14/.test(fn(PS, 'premium_pay_age')),
    'магазин: функции только в premium.sql, оплата с 14 лет (premium_pay_age), лимиты по возрасту — age_shop_caps (age.sql)');
  ok(!/to authenticated|to anon/.test(AS.slice(AS.indexOf('function public.age_group_of'), AS.indexOf('$$;', AS.indexOf('function public.age_group_of')))) && /revoke execute on function public\.age_group_of\(uuid\) from public, anon, authenticated;/.test(AS), 'age.sql: age_group_of закрыта от клиентов');
  ok(/create policy "Свой возраст видит только сам" on public\.user_age for select to authenticated using \(auth\.uid\(\) = user_id\);/.test(AS) && !/user_age[^;]*(moderator|admin)/.test(AS), 'age.sql: свой год видит только сам (без исключений для персонала)');

  // ═══ 10. Безопасность детей (T-010, docs/REALMS.md «лёгкий вариант»): до 9, ребёнок ↔ взрослый, тексты = сервер, подключено ═══
  {
    const c = makeCtx(); c.__run('js/core/age.js'); c.__advance(5);
    const A = c.D37Age, T = A._test, DAY = 864e5;
    T.reset(); T.localSet(YEAR - 8);
    ok(A.u9() && A.chatRO() && A.kid(), 'до 9 (7 лет): u9, чат только читать, ребёнок');
    T.reset(); T.localSet(YEAR - 10);
    ok(!A.u9() && A.kid(), '9 лет: не «до 9», но ребёнок');
    T.reset(); T.localSet(YEAR - 8); T.localSet(YEAR - 11);
    ok(!A.u9(), 'опечатка в первые сутки: из «до 9» сразу 10 лет');
    T.reset(); T.localSet(YEAR - 8); c.__advance(2 * DAY); T.localSet(YEAR - 11);
    ok(A.u9() && A.group() === 'child', 'после суток сменил год на 10 лет — ещё 30 дней «до 9»');
    c.__advance(31 * DAY);
    ok(!A.u9(), 'через 30 дней — уже не «до 9»');
    T.reset(); T.localSet(YEAR - 8); c.__advance(2 * DAY); await A.clear();
    ok(A.u9() && A.year() === null, 'стёр год — ещё 30 дней «до 9»');
    T.reset(); T.fromServer({ year: YEAR - 10, u9_until: new Date(c.__clock.t + 5 * DAY).toISOString(), kidsafe: true });
    ok(A.u9(), 'с сервера: «остывание» до 9 (u9_until)');
    T.fromServer({ year: YEAR - 8, kidsafe: false });
    ok(!A.u9() && !A.kidsafe(), "с сервера: выключатель kidsafe = 'off' — правил нет");
    // кому нельзя лично (kid_contact): спрашивает только ребёнок; взрослому — без запроса (возраст других сервер не раскрывает)
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const sb = { calls: [], rpc: async (name, args) => { sb.calls.push([name, args]); return name === 'kid_contact' ? { data: { ok: true, on: true, u9: false, child: true, age: [ids[1]] }, error: null } : { data: null, error: { message: 'нет' } }; } };
    T.reset(); T.localSet(YEAR - 30); c.sbClient = sb; c.currentUser = { id: 'me' };
    let m = await A.contacts(ids);
    ok(m.size === 0 && !sb.calls.length, 'взрослый: пусто и без запроса');
    T.reset(); T.localSet(YEAR - 11);
    m = await A.contacts(ids);
    ok(m.get(ids[1]) === 'age' && !m.has(ids[0]) && sb.calls.length === 1, 'ребёнок: взрослый из списка — нельзя (kid_contact)', [...m]);
    await A.contacts(ids);
    ok(sb.calls.length === 1, 'ответ kid_contact — из кэша (5 минут)');
    ok(await A.friendBlock(ids[1]) === 'age' && !(await A.friendBlock(ids[0])), 'дружба: правило пары (ребёнок ↔ взрослый)');
    T.reset(); T.localSet(YEAR - 7);
    m = await A.contacts(ids);
    ok(m.get(ids[0]) === 'u9' && m.get(ids[1]) === 'u9', 'до 9: ЛС и звонков нет ни с кем');
    ok(await A.friendBlock(ids[0]) === null && await A.friendBlock(ids[1]) === 'age', 'до 9: дружить с ребятами — можно (правило пары)');
    c.currentUser = null; T.reset(); T.localSet(YEAR - 11);
    ok((await A.contacts(ids)).size === 0, 'гость: подсказок нет (ЛС и дружба — только вошедшим)');
    // тексты — те же, что у сервера (отказ старых вкладок тоже понятный)
    const CS = read('community.sql');
    for (const k of ['u9', 'age', 'agefriend']) ok(CS.includes(A.KID_MSG[k]), `текст «${k}» — тот же, что в community.sql`);
    ok(CS.includes(A.KID_MSG.u9chat.split(' — ')[0]), 'текст «u9chat» — как в chat_guard');
    // подключено
    has('js/features/chat.js', /D37Age\?\.chatRO\?\.\(\) && !isChatStaff\(\)\) return \{ mode: 'readonly', react: true/, 'чат: до 9 — только читать и реакции');
    has('js/features/chat.js', /!\(window\.D37Age\?\.kid\?\.\(\) && window\.D37Age\?\.kidsafe\?\.\(\)\)/, 'кто онлайн: ребёнок не рассылает всем код комнаты');
    has('js/features/community.js', /D37Age\?\.chatRO\?\.\(\) && !C\.staff\) return \{ mode: 'readonly', react: true/, 'сообщества: до 9 — только читать и реакции');
    has('js/features/msgview.js', /V\.canReact = V\.canWrite \|\| !!st\.react/, 'лента: реакции при «только читать»');
    has('js/features/calls.js', /P\.rpc\('call_pass'/, 'звонки: пропуск с сервера (call_pass / call_check)');
    has('js/features/phone-apps.js', /block \? \{ mode: 'readonly', note: kidMsg\(block\) \}/, 'ЛС в телефоне: ребёнку со взрослым — только читать');
    has('js/features/friends.js', /D37Age\?\.friendBlock\?\.\(targetId\)/, 'заявка в друзья: подсказка ребёнку');
    has('js/games/mir.js', /S\.chatRO = true/, 'мир 3D: чат до 9 — только читать');
    has('js/games/mir.js', /kidOk\(p\.v\?\.uid \|\| null\)/, 'мир 3D: приглашение ребёнку — только от тех, кого пускает сервер');
    has('js/games/world.js', /S\.chatRO = true/, 'мир 2D: чат до 9 — только читать');
    // ники детей на публичных страницах (api/_lib/age.js): только «прятать или нет», без возраста
    const AJ = await import(pathToFileURL(path.join(SITE, 'api/_lib/age.js')).href);
    const conf = () => true;
    let k = await AJ.publicKids([ids[0], ids[1], 'x'], async (fn, a) => (fn === 'age_public_kids' && a.p_ids.length === 2 ? [ids[1]] : []), conf);
    ok(!k.has(ids[0]) && k.has(ids[1]) && AJ.publicNick(k, ids[1], 'Петя', 'user') === 'Игрок' && AJ.publicNick(k, ids[0], 'Вася', 'user') === 'Вася', 'публичные страницы: ник ребёнка — «Игрок»');
    ok(AJ.publicNick(k, ids[1], 'Денчик', 'admin') === 'Денчик', 'публичные страницы: у команды сайта — свой ник');
    k = await AJ.publicKids(ids, async () => { throw new Error('rpc age_public_kids: HTTP 404 {"code":"PGRST202"}'); }, conf);
    ok(!k.has(ids[1]), 'нет age.sql — ники как раньше');
    k = await AJ.publicKids(ids, async () => { throw new Error('rpc age_public_kids: HTTP 503'); }, conf);
    ok(k.has(ids[0]) && k.failed, 'база не ответила — «Игрок» у всех (кроме команды)');
    k = await AJ.publicKids(ids, async () => [ids[0]], () => false);
    ok(!k.has(ids[0]), 'без ключей сервера (локально) — без запроса');
    for (const [f, re] of [['api/_lib/routes/forum.js', /publicNick\(kids, p\.id, p\.nick, p\.role\)/], ['api/_lib/routes/forum.js', /publicNick\(kids, r\.author_id, r\.author_nick, r\.author_role\)/], ['api/_lib/routes/ugc.js', /maskAuthors\(\[\.\.\.top, \.\.\.fresh\]\)/]])
      has(f, re, f + ': ники детей прячутся');
  }

  console.log(`\nage-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL падение теста', e); process.exit(1); });

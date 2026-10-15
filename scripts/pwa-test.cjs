// Тесты приложения (PWA) в node, без браузера: js/features/app.js (где открыт сайт и какие шаги показать, разовая карточка,
// «Поделиться», web+denchik:, адреса запуска, значок на иконке), js/features/app-guide.js (шаги и картинки).
// Запуск из корня сайта: node scripts/pwa-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
// обещание, которое никогда не выполнится, node «тихо» завершает — так зависший тест не сойдёт за пройденный
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL тест не дошёл до конца (зависло обещание)'); process.exitCode = 1; } });

// ═══ Поддельный браузер (ровно столько, сколько нужно app.js) ═══
class El {
  constructor(tag){ this.tagName = String(tag).toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.hidden = false; this.id = ''; this.innerHTML = ''; this.textContent = ''; this.et = new EventTarget(); this.parent = null;
    const c = this._c = new Set(); this.classList = { add: (...a) => a.forEach(x => c.add(x)), remove: (...a) => a.forEach(x => c.delete(x)), contains: x => c.has(x), toggle: (x, on) => { const v = on === undefined ? !c.has(x) : !!on; v ? c.add(x) : c.delete(x); return v; } };
    this.style = { props: {}, setProperty(k, v){ this.props[k] = String(v); } }; }
  set className(v){ this._c.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => this._c.add(x)); }
  get className(){ return [...this._c].join(' '); }
  setAttribute(k, v){ this.attrs[k] = String(v); } getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; }
  appendChild(ch){ ch.parent = this; this.children.push(ch); return ch; }
  remove(){ if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
  querySelector(sel){ return (this._q = this._q || {})[sel] || (this._q[sel] = new El('stub')); } querySelectorAll(){ return []; } closest(){ return null; } focus(){} getClientRects(){ return [1]; }
  addEventListener(t, f, ...a){ ((this.ls = this.ls || {})[t] = this.ls[t] || []).push(f); this.et.addEventListener(t, f, ...a); } removeEventListener(...a){ this.et.removeEventListener(...a); } dispatchEvent(e){ return this.et.dispatchEvent(e); }
}
// Поддельный navigator.serviceWorker: регистрация с новой версией, которая ждёт (waiting), и «старой», которая работает
function fakeSW(){
  const posted = [], et = new EventTarget();
  const waiting = { state: 'installed', postMessage: m => posted.push(['waiting', m]) };
  const active = { state: 'activated', postMessage: m => posted.push(['active', m]) };
  const reg = { waiting, active, installing: null, addEventListener(){}, update: () => Promise.resolve() };
  return { posted, reg, et, api: { controller: {}, register: () => Promise.resolve(reg), addEventListener: (...a) => et.addEventListener(...a), ready: Promise.resolve(reg) } };
}
function fakeBrowser(o = {}){
  const W = new EventTarget(), store = {}, sstore = {};
  const doc = new EventTarget();
  Object.assign(doc, { readyState: 'complete', visibilityState: 'visible', referrer: o.referrer || '', createElement: t => new El(t), head: new El('head'), body: new El('body'), documentElement: new El('html') });
  const byId = {};
  doc.getElementById = id => byId[id] || doc.body.children.find(c => c.id === id) || null;
  doc.querySelector = sel => (sel === 'meta[name="theme-color"]' ? (doc._meta = doc._meta || new El('meta')) : null);
  doc.querySelectorAll = () => [];
  const badge = { set: [], clear: 0 };
  const nav = { userAgent: o.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36', platform: o.platform || 'Win32', maxTouchPoints: 0,
    setAppBadge: n => { badge.set.push(n); return Promise.resolve(); }, clearAppBadge: () => { badge.clear++; return Promise.resolve(); } };
  if (o.sw) nav.serviceWorker = o.sw.api;
  // таймеры быстрее в o.fast раз (ожидания по 20 с — за доли секунды)
  const st = o.fast ? (f, ms, ...a) => setTimeout(f, (ms || 0) / o.fast, ...a) : setTimeout;
  const href = o.href || 'https://dan4ik37.vercel.app/#/home';
  const u = new URL(href);
  const loc = { href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assigned: null, assign(x){ this.assigned = x; }, replace(x){ this.hash = x; }, reload(){ this.reloaded = true; } };
  const hist = { state: null, pushes: 0, replaced: [], pushState(s){ this.state = s; this.pushes++; }, replaceState(s, t, url){ this.state = s; this.replaced.push(url); }, back(){} };
  const sandbox = {
    document: doc, navigator: nav, location: loc, history: hist,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: k => (k in sstore ? sstore[k] : null), setItem: (k, v) => { sstore[k] = String(v); }, removeItem: k => { delete sstore[k]; } },
    matchMedia: q => ({ matches: !!(o.standalone && /display-mode: standalone/.test(q)) }),
    requestAnimationFrame: f => setTimeout(f, 0), setTimeout: st, clearTimeout, console, URL, URLSearchParams, Event, CustomEvent, EventTarget, MutationObserver: class { observe(){} disconnect(){} },
    addEventListener: (...a) => W.addEventListener(...a), removeEventListener: (...a) => W.removeEventListener(...a), dispatchEvent: e => W.dispatchEvent(e),
    isSecureContext: true, innerWidth: 1280, va: (...a) => (sandbox._va = sandbox._va || []).push(a),
  };
  if (o.games) { sandbox.GAMES = o.games; sandbox.GAMES_VER = o.gamesVer || '62'; }
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('js/features/app.js'), sandbox, { filename: 'app.js' });
  return { W: sandbox, doc, badge, store, sstore, loc, hist, nav };
}

// ═══ 1. Где открыт сайт → какие шаги ═══
const UA = {
  iphone18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphone26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  ipadMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1',
  iosInsta: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36',
  androidYa: 'Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/25.4.1.100 Mobile Safari/537.36',
  androidFx: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  androidWv: 'Mozilla/5.0 (Linux; Android 13; SM-A525F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidVk: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 VKAndroidApp/8.90',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
  winYa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/25.4.0.0 Safari/537.36',
  winFx: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
  macFx: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:144.0) Gecko/20100101 Firefox/144.0',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  winOpera: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
};
const B = fakeBrowser();
const T = B.W.D37App._test;
const how = (ua, o) => T.detect(ua, o).how;
ok(how(UA.iphone18) === 'ios', 'iPhone Safari → ios');
ok(T.detect(UA.iphone26).ios26 === true && T.detect(UA.iphone18).ios26 === false, 'Safari 26 узнаём по Version/26');
ok(how(UA.ipadMac, { platform: 'MacIntel', touch: 5 }) === 'ios', 'iPad «как Mac» (касания) → ios');
ok(how(UA.ipadMac, { platform: 'MacIntel', touch: 0 }) === 'mac-safari', 'настоящий Mac Safari → mac-safari');
ok(how(UA.iosChrome) === 'ios-other', 'Chrome на iPhone → ios-other');
ok(how(UA.iosInsta) === 'inapp', 'Instagram на iPhone → inapp');
ok(how(UA.android) === 'android' && T.detect(UA.android).mobile, 'Chrome Android → android');
ok(how(UA.androidYa) === 'android' && T.detect(UA.androidYa).br === 'yandex', 'Яндекс на Android → android (яндекс)');
ok(how(UA.androidFx) === 'android-firefox', 'Firefox Android');
ok(how(UA.androidSamsung) === 'android' && T.detect(UA.androidSamsung).br === 'samsung', 'Samsung Internet');
ok(how(UA.androidWv) === 'inapp', 'WebView в приложении → inapp');
ok(how(UA.androidVk) === 'inapp', 'ВКонтакте → inapp');
ok(how(UA.winChrome) === 'desktop-chrome' && T.detect(UA.winChrome).os === 'windows', 'Chrome Windows');
ok(how(UA.winEdge) === 'desktop-edge', 'Edge Windows');
ok(how(UA.winYa) === 'desktop-yandex', 'Яндекс Браузер Windows');
ok(how(UA.winFx) === 'firefox-win', 'Firefox Windows → панель задач (143+)');
ok(how(UA.macFx) === 'firefox-no', 'Firefox Mac → нельзя');
ok(how(UA.macSafari) === 'mac-safari', 'Safari Mac → «Добавить в Dock»');
ok(how(UA.linuxChrome) === 'desktop-chrome', 'Chrome Linux');
ok(how(UA.winOpera) === 'none', 'Opera на ПК не ставит сайты → none');
ok(how('') === 'none', 'пустая строка браузера → none');

// ═══ 2. Разовая карточка ═══
const env = (o = {}) => Object.assign({ standalone: false, installed: false, can: true, ageSession: false, busy: false, hidden: false, sinceLoad: 30e3, touched: true }, o);
const due = (s, e) => T.cardDue(s, env(e));
ok(!due({ v: 1 }) && !due({ v: 2 }) && due({ v: 3 }), 'карточка — с 3-го захода');
ok(!due({ v: 5 }, { sinceLoad: 10e3 }), 'не раньше 25 с на странице');
ok(!due({ v: 5 }, { touched: false }), 'пока ничего не нажимал — нет');
ok(!due({ v: 5 }, { ageSession: true }), 'не в тот заход, когда было окошко возраста');
ok(!due({ v: 5 }, { busy: true }), 'не поверх игры / окна / звонка');
ok(!due({ v: 5 }, { hidden: true }), 'вкладка не видна — нет');
ok(!due({ v: 5 }, { standalone: true }) && !due({ v: 5 }, { installed: true }) && !due({ v: 5, inst: 1 }), 'в приложении и после установки — нет');
ok(!due({ v: 5 }, { can: false }), 'нечем установить в пару касаний (ПК без кнопки браузера) — нет');
ok(!due({ v: 9, x: 1 }), 'после ✕ / «Установить» — никогда');
ok(!due({ v: 4, n: 1, sv: 3 }) && !due({ v: 5, n: 1, sv: 3 }) && due({ v: 6, n: 1, sv: 3 }), 'второй показ — через 3 захода после первого');
ok(!due({ v: 20, n: 2, sv: 9 }), 'больше двух показов — никогда');
ok(T.easyHow('ios') && T.easyHow('android') && !T.easyHow('desktop-chrome') && !T.easyHow('inapp'), 'easyHow: телефоны — да, ПК без кнопки и встроенный просмотр — нет');

// ═══ 3. «Поделиться» → текст сообщения ═══
ok(T.shareText({ title: 'Ролик', text: 'Смотри!', url: 'https://youtu.be/abc' }) === 'Ролик\nСмотри!\nhttps://youtu.be/abc', 'заголовок + текст + ссылка');
ok(T.shareText({ text: 'Смотри https://youtu.be/abc', url: 'https://youtu.be/abc' }) === 'Смотри https://youtu.be/abc', 'ссылка уже в тексте — не повторяем');
ok(T.shareText({ title: 'https://x.ru/a', url: 'https://x.ru/a' }) === 'https://x.ru/a', 'заголовок = ссылка — один раз');
ok(T.shareText({ url: 'javascript:alert(1)' }) === '', 'не http-ссылку не берём');
ok(T.shareText({ text: 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(7) + 'c\nd' }) === 'abc\nd', 'управляющие символы убраны, перенос строки остался');
ok(T.shareText({ text: 'я'.repeat(3000) }).length === 1000, 'не длиннее 1000');
ok(T.shareText({}) === '', 'пусто → пусто');

// ═══ 4. web+denchik: → адрес ═══
ok(T.protoTarget('web+denchik://c/AbC123') === '/#/chat/join/abc123', 'приглашение в сообщество');
ok(T.protoTarget(encodeURIComponent('web+denchik://c/abc123')) === '/#/chat/join/abc123', 'закодированная ссылка');
ok(T.protoTarget('web+denchik:games/chess/k3j9x2') === '/#/games/chess/k3j9x2', 'комната игры');
ok(T.protoTarget('web+denchik://games/horde/coop/ab12cd') === '/#/games/horde/coop/ab12cd', 'кооп «Орды»');
ok(T.protoTarget('web+denchik://world') === '/#/games/world', 'мир');
ok(T.protoTarget('web+denchik://g/Ab12Cd34') === '/g/Ab12Cd34', 'игра игрока');
ok(T.protoTarget('web+denchik://v/dQw4w9WgXcQ') === '/v/dQw4w9WgXcQ', 'ролик');
ok(T.protoTarget('web+denchik://call/abcd1234ef') === '/#/phone/call/abcd1234ef', 'звонок');
ok(T.protoTarget('web+denchik://evil.com/x') === '/#/home', 'чужое — на главную');
ok(T.protoTarget('web+denchik://games/../../x') === '/#/home', '«..» не пропускаем');
ok(T.protoTarget('web+denchik://chat/<script>') === '/#/home', 'странные символы — на главную');
ok(T.protoTarget('web+denchik:javascript:alert(1)') === '/#/home', 'javascript: — на главную');
ok(T.protoTarget('web+dan4ik37://c/abc123') === '/#/chat/join/abc123', 'старое написание web+dan4ik37 тоже понимаем');

// ═══ 5. Адрес запуска ═══
const O = 'https://dan4ik37.vercel.app';
const la = h => T.launchAction(h, O);
ok(JSON.stringify(la(O + '/?share_title=T&share_text=Hi&share_url=https%3A%2F%2Fx.ru')) === JSON.stringify({ share: { title: 'T', text: 'Hi', url: 'https://x.ru' } }), '«Поделиться» → share');
ok(la(O + '/?proto=web%2Bdan4ik37%3A%2F%2Fc%2Fabc123').go === '#/chat/join/abc123', 'web+denchik → переход');
ok(la(O + '/?proto=web%2Bdan4ik37%3A%2F%2Fv%2FdQw4w9WgXcQ').open === '/v/dQw4w9WgXcQ', 'web+denchik → серверная страница');
ok(la(O + '/#/chat').go === '#/chat', 'ярлык «Чат» → переход в том же окне');
ok(la(O + '/').focus === true && la(O + '/#/').focus === true, 'значок приложения → просто показать окно');
ok(la(O + '/games/sudoku').open === '/games/sudoku', 'страница сервера → открыть');
ok(la('https://evil.example/#/chat') === null, 'чужой адрес — ничего');

// ═══ 6. Значок на иконке (события, без опросов) ═══
(async () => {
  ok(T.badgeCount({ msgs: 2, calls: 1, notif: 3 }) === 6 && T.badgeCount({}) === 0, 'число на значке = ЛС + звонки + уведомления');
  await tick(5);
  B.W.dispatchEvent(new B.W.CustomEvent('d37:dm-unread', { detail: 2 }));
  B.W.dispatchEvent(new B.W.CustomEvent('d37:notif', { detail: 3 }));
  await tick(300);
  ok(B.badge.set.at(-1) === 5, 'ЛС 2 + 🔔 3 → значок 5', B.badge.set);
  B.W.dispatchEvent(new B.W.CustomEvent('d37:badges', { detail: { msgs: 2, calls: 4, notif: 3, comm: 9, friends: 1 } }));
  await tick(300);
  ok(B.badge.set.at(-1) === 9, 'пропущенные звонки из телефона (+4), сообщества и друзья не считаем', B.badge.set);
  const nSet = B.badge.set.length;
  B.W.dispatchEvent(new B.W.CustomEvent('d37:badges', { detail: { msgs: 2, calls: 4, notif: 3 } }));
  await tick(300);
  ok(B.badge.set.length === nSet, 'то же число — не дёргаем систему');
  B.W.dispatchEvent(new B.W.CustomEvent('d37:dm-unread', { detail: 0 }));
  B.W.dispatchEvent(new B.W.CustomEvent('d37:notif', { detail: 0 }));
  B.W.dispatchEvent(new B.W.CustomEvent('d37:badges', { detail: { calls: 0 } }));
  await tick(300);
  ok(B.badge.clear >= 2, 'всё прочитано → значок убран', B.badge);

  // ═══ 7. Окно приложения: классы, тёмная полоса, «Поделиться» при запуске, ?app=play ═══
  const A = fakeBrowser({ standalone: true, ua: UA.android, href: O + '/?app=play&share_text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82#/home' });
  await tick(5);
  const H = A.doc.documentElement;
  ok(A.W.D37App.standalone() === true && H.classList.contains('app-standalone') && H.classList.contains('app-android'), 'окно приложения → html.app-standalone app-android');
  ok(H.classList.contains('app-play') && A.W.D37App.source() === 'play', '?app=play → html.app-play (покупки скрыты)');
  ok(A.doc._meta && A.doc._meta.getAttribute('content') === '#09090f', 'в приложении полоса окна — цвета шапки');
  ok(A.hist.replaced.some(u => u === '/#/home'), 'служебные параметры убраны из адреса', A.hist.replaced);
  await tick(450);
  ok(!!A.doc.getElementById('appShare'), '«Поделиться» при запуске → окошко «В общий чат / Другу»');
  ok(JSON.parse(A.store.d37_app).ao === 1 && JSON.parse(A.store.d37_app).inst === 1, 'запуск приложения посчитан, «установлено» запомнено');
  ok((A.W._va || []).some(a => a[1]?.name === 'app_open'), 'событие app_open в Vercel Analytics');
  // вкладка браузера: заходы считаются, appinstalled → спасибо и событие
  const C = fakeBrowser({ href: O + '/#/games' });
  await tick(5);
  ok(JSON.parse(C.store.d37_app).v === 1, 'заход во вкладке посчитан');
  C.W.dispatchEvent(new C.W.Event('appinstalled'));
  ok(JSON.parse(C.store.d37_app).inst === 1, 'appinstalled → установлено');
  ok((C.W._va || []).some(a => a[1]?.name === 'app_installed' && a[1].data && !('uid' in a[1].data)), 'app_installed в аналитике — без личных данных');
  ok(!!C.doc.getElementById('appToast'), 'appinstalled → «спасибо»');
  // кнопка браузера: beforeinstallprompt перехвачен (своя карточка), «установлено» сброшено (приложение удалили)
  let prevented = false;
  const ev = new C.W.Event('beforeinstallprompt'); ev.preventDefault = () => { prevented = true; };
  C.W.dispatchEvent(ev);
  ok(prevented && C.W.D37App.state().prompt === true && JSON.parse(C.store.d37_app).inst === 0, 'beforeinstallprompt: перехвачен, «установлено» сброшено');

  // ═══ 8. Инструкция: шаги и картинки ═══
  const G = { window: {}, document: undefined };
  G.window = G; vm.createContext(G);
  vm.runInContext(src('js/features/app-guide.js'), G, { filename: 'app-guide.js' });
  const AG = G.D37AppGuide;
  const HOWS = ['ios', 'ios-other', 'android', 'android-firefox', 'desktop-chrome', 'desktop-edge', 'desktop-yandex', 'firefox-win', 'firefox-no', 'mac-safari', 'inapp', 'none'];
  ok(HOWS.every(h => AG.steps(h).length >= 2), 'у каждого способа ≥ 2 шагов', HOWS.filter(h => AG.steps(h).length < 2));
  ok(HOWS.every(h => AG.steps(h).every(s => !s.pic || AG.PICS[s.pic])), 'все картинки шагов на месте');
  ok(AG.steps('ios', { ios26: true })[0].pic === 'ios-dots' && AG.steps('ios')[0].pic === 'ios-share', 'iOS 26 — «•••», раньше — «Поделиться»');
  ok(Object.values(AG.PICS).every(p => /^<svg[^>]+viewBox="0 0 240 150"/.test(p) && /class="apg-hl"/.test(p)), 'у каждой картинки обведено, куда нажать');
  ok(Object.values(AG.PICS).every(p => (p.match(/<svg/g) || []).length === 1 && (p.match(/<\/svg>/g) || []).length === 1), 'SVG целые');
  ok(AG.steps('unknown-how')[0].text === AG.steps('none')[0].text, 'неизвестный способ → «этот браузер не умеет»');
  // каждое «how» из detect() — есть в инструкции
  const seen = new Set(Object.values(UA).map(u => how(u)).concat(how(UA.ipadMac, { platform: 'MacIntel', touch: 5 })));
  ok([...seen].every(h => AG.STEPS[h]), 'все способы из detect() описаны', [...seen].filter(h => !AG.STEPS[h]));

  testManifest();
  await testUpdateFlow();
  await testSW();
  testOfflinePage();
  testStores();
  finished = true;
  console.log(`\npwa-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

// ═══ 10. app.js: «Доступна новая версия — Обновить», игры без интернета ═══
async function testUpdateFlow(){
  const S = fakeSW();
  const U = fakeBrowser({ sw: S, href: 'https://dan4ik37.vercel.app/#/home' });
  await tick(1000);   // новая версия ждёт → через 0,8 с — полоска
  const t = U.doc.getElementById('appUpdate');
  ok(!!t, 'новый sw.js ждёт → «Доступна новая версия»');
  const click = k => (t.ls.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { upd: k } }) } }));
  click('go');
  ok(S.posted.some(([w, m]) => w === 'waiting' && m.type === 'SKIP_WAITING'), '«Обновить» → SKIP_WAITING новой версии');
  S.et.dispatchEvent(new Event('controllerchange'));
  ok(U.loc.reloaded === true, 'новая версия встала → страница перезагрузилась');
  // «✕» — до конца захода не показываем
  const S2 = fakeSW(), U2 = fakeBrowser({ sw: S2 });
  await tick(1000);
  const t2 = U2.doc.getElementById('appUpdate');
  (t2?.ls.click || []).forEach(f => f({ target: { closest: () => ({ dataset: { upd: 'x' } }) } }));
  ok(!U2.doc.getElementById('appUpdate') && U2.sstore.d37_app_updx === '1', '«✕» — полоска убрана до конца захода');
  S2.et.dispatchEvent(new Event('controllerchange'));
  ok(!U2.loc.reloaded, 'новая версия встала сама (без «Обновить») — без перезагрузки посреди дела');
  // в игре — не показываем, только после
  const S3 = fakeSW(), U3 = fakeBrowser({ sw: S3 });
  U3.doc.body.classList.add('game-on');
  await tick(1000);
  ok(!U3.doc.getElementById('appUpdate'), 'идёт игра — полоски нет');
  U3.doc.body.classList.remove('game-on');
  U3.W.dispatchEvent(new Event('hashchange'));
  await tick(1000);
  ok(!!U3.doc.getElementById('appUpdate'), 'вышел из игры — полоска появилась');
  // установленное приложение: файлы игр без интернета → sw.js (один раз на GAMES_VER)
  const G = [{ id: 'sudoku', scripts: ['js/games/room.js', 'js/games/versus.js', 'js/games/sudoku.js'] }, { id: '2048', scripts: ['js/games/g2048.js'] }, { id: 'world', scripts: ['js/games/world.js'] }];
  const S4 = fakeSW(), U4 = fakeBrowser({ sw: S4, standalone: true, fast: 100, games: G, gamesVer: '62', ua: UA.android });
  await tick(400);
  const msg = S4.posted.find(([w, m]) => w === 'active' && m.type === 'CACHE_URLS');
  ok(!!msg, 'приложение: список файлов игр ушёл в sw.js');
  const urls = msg ? msg[1].urls : [];
  ok(urls.includes('/js/games/sudoku.js?v=62') && urls.includes('/js/games/g2048.js?v=62') && !urls.some(u => /world/.test(u)), 'в списке — игры без интернета с ?v=GAMES_VER, без «Мира»', urls);
  ok(U4.store.d37_app_off === '62:' + U4.W.D37App._test.OFFLINE_GAMES.length, 'запомнено: повторно до смены GAMES_VER не шлём');
}

// ═══ 11. sw.js: куда какой запрос, установка, обновление, офлайн, push ═══
async function testSW(){
  const ORIGIN = 'https://dan4ik37.vercel.app';
  // ── поддельный Cache Storage ──
  class FakeCache {
    constructor(){ this.m = new Map(); }
    key(r){ return typeof r === 'string' ? new URL(r, ORIGIN).href : r.url; }
    async match(r, o = {}){
      const k = this.key(r);
      if (this.m.has(k)) return this.m.get(k).clone();
      if (o.ignoreSearch) { const base = k.split('?')[0]; for (const [kk, v] of this.m) if (kk.split('?')[0] === base) return v.clone(); }
      return undefined;
    }
    async put(r, res){ this.m.set(this.key(r), res); }
    async add(r){ const res = await NET.fetch(typeof r === 'string' ? new Request(new URL(r, ORIGIN)) : r); if (!res.ok) throw new TypeError('bad status'); this.m.set(this.key(r), res); }
    async keys(){ return [...this.m.keys()].map(url => ({ url })); }
    async delete(r){ return this.m.delete(this.key(r)); }
  }
  const CS = new Map();
  const caches = {
    async open(n){ if (!CS.has(n)) CS.set(n, new FakeCache()); return CS.get(n); },
    async keys(){ return [...CS.keys()]; }, async has(n){ return CS.has(n); }, async delete(n){ return CS.delete(n); },
    async match(r, o = {}){ for (const [n, c] of CS) { if (o.cacheName && o.cacheName !== n) continue; const x = await c.match(r, o); if (x) return x; } return undefined; },
  };
  // «непрозрачный» ответ (чужой скрипт без crossorigin): тип opaque, статус 0
  const opaque = () => ({ type: 'opaque', ok: false, status: 0, headers: new Headers(), clone(){ return opaque(); } });
  // ── поддельная сеть: свои файлы — с диска, «сеть пропала» — ошибка ──
  const NET = {
    mode: 'online', calls: [], dateAgo: 0,
    async fetch(input, init){
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      NET.calls.push(url.href);
      if (NET.mode === 'offline') throw new TypeError('Failed to fetch');
      if (NET.mode === 'hang') return new Promise(() => {});
      if (url.origin !== ORIGIN) return opaque();
      const p = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(SITE, p);
      const date = new Date(Date.now() - NET.dateAgo).toUTCString();
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('нет', { status: 404, headers: { date } });
      const body = url.pathname === '/' ? '<!-- net -->' + fs.readFileSync(file, 'utf8') : fs.readFileSync(file);
      return new Response(body, { status: 200, headers: { date, 'content-type': /\.html$|^\/$/.test(url.pathname) ? 'text/html' : 'application/octet-stream' } });
    },
  };
  // ── поддельный ServiceWorkerGlobalScope ──
  const H = {}, notes = [], opened = [], navigated = [];
  let skipped = 0, claimed = 0, preloadOn = 0;
  const client = { url: ORIGIN + '/#/games', focus(){ return Promise.resolve(this); }, navigate(u){ navigated.push(u); return Promise.resolve(this); } };
  let clientList = [client];
  // как в браузере: относительный адрес — от адреса sw.js; mode no-cors node не знает — запоминаем сами
  class SWRequest extends Request {
    constructor(input, init = {}){
      const { mode, ...rest } = init;
      super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, rest);
      if (mode) Object.defineProperty(this, 'mode', { value: mode });
    }
  }
  const SWG = {
    location: new URL(ORIGIN + '/sw.js'), caches, fetch: (...a) => NET.fetch(...a), Request: SWRequest, Response, Headers, URL, console, Date, Promise,
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 30)), clearTimeout,
    addEventListener(t, f){ (H[t] = H[t] || []).push(f); },
    skipWaiting(){ skipped++; return Promise.resolve(); },
    registration: { navigationPreload: { enable(){ preloadOn++; return Promise.resolve(); } }, showNotification(title, o){ notes.push({ title, o }); return Promise.resolve(); } },
    clients: { claim(){ claimed++; return Promise.resolve(); }, matchAll(){ return Promise.resolve(clientList); }, openWindow(u){ opened.push(u); return Promise.resolve(null); } },
  };
  SWG.self = SWG;
  vm.createContext(SWG);
  vm.runInContext(src('sw.js'), SWG, { filename: 'sw.js' });
  const X = SWG.__d37sw;
  const fire = async (type, ev) => { const ps = []; ev.waitUntil = p => ps.push(p); for (const f of H[type] || []) f(ev); await Promise.all(ps.map(p => Promise.resolve(p).catch(e => e))); return ev; };
  // запрос «как из браузера»: mode navigate нельзя задать в new Request — подменяем свойство
  const rq = (url, o = {}) => { const r = new Request(new URL(url, ORIGIN), { method: o.method || 'GET', headers: o.headers }); if (o.mode) Object.defineProperty(r, 'mode', { value: o.mode }); return r; };
  async function get(url, o = {}){
    const ev = { request: rq(url, o), preloadResponse: undefined, responded: null };
    ev.respondWith = p => { ev.responded = p; };
    const ps = []; ev.waitUntil = p => ps.push(p);
    for (const f of H.fetch) f(ev);
    const res = ev.responded ? await ev.responded : null;
    await Promise.all(ps.map(p => Promise.resolve(p).catch(() => {})));
    return { res, passed: !ev.responded, text: res && res.text ? await res.clone().text().catch(() => '') : '' };
  }

  // 11.1 куда какой запрос
  const R = (url, o = {}) => X.route(rq(url, o));
  ok(R('/api/feed') === 'pass' && R('/api/push-check?pubkey=1') === 'pass' && R('/_vercel/insights/script.js') === 'pass', 'API и аналитика Vercel — мимо кэша');
  ok(R('/api/geo') === 'pass' && R('/api') === 'pass' && R('/go/abc123', { mode: 'navigate' }) === 'pass' && R('/go/abc123') === 'pass' && R('/go', { mode: 'navigate' }) === 'pass', '/api/geo и /go/* (переходы по рекламе кабинета) — мимо кэша');
  ok(R('https://zdisuowyjgqirhvcyjfq.supabase.co/storage/v1/object/public/ads/banner.webp') === 'pass', 'картинки рекламы из хранилища Supabase — мимо кэша');
  ok(R('/gold.png') === 'swr' && R('/games/sudoku', { mode: 'navigate' }) === 'page', '/go… не задевает похожие адреса');
  ok(R('/studio', { mode: 'navigate' }) === 'page' && R('/ads-terms', { mode: 'navigate' }) === 'page', '/studio (страница «Конструктор игр») и /ads-terms — обычные серверные страницы');
  ok(R('/', { mode: 'navigate' }) === 'shell' && R('/?share_text=x', { mode: 'navigate' }) === 'shell' && R('/index.html', { mode: 'navigate' }) === 'shell', 'главная (и с параметрами) — оболочка');
  ok(R('/v/dQw4w9WgXcQ', { mode: 'navigate' }) === 'page' && R('/games/sudoku', { mode: 'navigate' }) === 'page', 'серверные страницы — сеть, без сети — офлайн-страница');
  ok(R('/js/games/sudoku.js?v=62') === 'swr' && R('/js/features/app-guide.js?v=1') === 'swr', 'файлы с ?v= — из кэша и тихо обновить');
  ok(R('/js/core/config.js') === 'net' && R('/css/premium.css') === 'net' && R('/manifest.json') === 'net', 'скрипты и стили без номера — сначала сеть');
  ok(R('/img/app/sc-chat.png') === 'swr' && R('/icon-192.png') === 'swr', 'картинки — stale-while-revalidate');
  ok(R('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js') === 'cdn', 'supabase-js с точной версией — неизменный, из кэша');
  ok(R('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js') === 'pass' && R('https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js') === 'pass', 'без точной версии и прочие пакеты CDN — мимо');
  ok(R('https://fonts.gstatic.com/s/montserrat/v1/x.woff2') === 'cdn' && R('https://fonts.googleapis.com/css2?family=Montserrat') === 'swr', 'шрифты Google — из кэша');
  const NEVER = ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1', 'https://googleads.g.doubleclick.net/pagead/ads', 'https://tpc.googlesyndication.com/x.png',
    'https://an.yandex.ru/meta/123', 'https://yandex.ru/ads/system/context.js', 'https://mc.yandex.ru/metrika/tag.js?id=113596397', 'https://yastatic.net/x.js',
    'https://zdisuowyjgqirhvcyjfq.supabase.co/rest/v1/messages', 'https://zdisuowyjgqirhvcyjfq.supabase.co/realtime/v1/websocket', 'https://www.googleapis.com/youtube/v3/videos',
    'https://i.ytimg.com/vi/x/hq.jpg', 'https://www.youtube.com/embed/x', 'https://player.twitch.tv/?channel=dan4ik37', 'https://decapi.me/twitch/uptime/dan4ik37',
    'https://www.donationalerts.com/r/dan4ik37', 'https://ep1.adtrafficquality.google/x', 'https://example.com/x.png'];
  ok(NEVER.every(u => R(u) === 'pass'), 'реклама, Метрика, Supabase, YouTube, Twitch, донаты, чужие адреса — НИКОГДА не через кэш', NEVER.filter(u => R(u) !== 'pass'));
  ok(R('/api/feed', { method: 'POST' }) === 'pass' && R('/x.png', { method: 'POST' }) === 'pass', 'не GET — мимо');
  ok(R('/studio/rust.html', { mode: 'navigate' }) === 'pass' && R('/studio/frame.html?v=62') === 'pass', 'студия (Rust с особыми заголовками) — мимо');
  ok(R('/.well-known/assetlinks.json') === 'pass' && R('/sw.js') === 'pass' && R('/ads.txt') === 'pass' && R('/sitemap.xml') === 'pass', 'assetlinks, sw.js, ads.txt, карта сайта — мимо');
  ok(R('/img/x.mp3', { headers: { range: 'bytes=0-' } }) === 'pass', 'запросы частями (видео/звук) — мимо');

  // 11.2 список оболочки — прямо из index.html
  const list = X.shellAssets(src('index.html'));
  ok(list.includes('/js/features/app.js') && list.includes('/css/app.css') && list.includes('/js/core/config.js') && list.includes('/js/ui/router.js'), 'оболочка: скрипты и стили из index.html', list.length);
  ok(list.some(u => /supabase-js@\d+\.\d+\.\d+/.test(u)), 'оболочка: supabase-js с точной версией');
  ok(!list.some(u => /googlesyndication|mc\.yandex|_vercel|fonts\.googleapis/.test(u)), 'в оболочке нет рекламы, Метрики, аналитики');
  const idxScripts = (src('index.html').match(/<script[^>]*\ssrc="(js\/[^"]+)"/g) || []).length;
  ok(list.filter(u => /^\/js\//.test(u)).length === idxScripts, 'все свои скрипты index.html — в оболочке', [list.filter(u => /^\/js\//.test(u)).length, idxScripts]);
  ok(X.shellAssets('<script src="js/../api/x.js"></script><script src="https://evil.example/x.js"></script>').length === 0, 'чужое и «..» в оболочку не попадает');

  // 11.3 установка: офлайн-страница, оболочка; без старого sw.js — ждём кнопки (skipWaiting не зовём)
  await fire('install', {});
  const shell = CS.get(X.SHELL);
  ok(!!shell && !!(await shell.match('/offline.html')) && !!(await shell.match('/')), 'установка: офлайн-страница и главная в кэше');
  ok(!!(await shell.match('/js/features/app.js')) && !!(await shell.match('/css/premium.css')), 'установка: скрипты и стили из index.html в кэше');
  ok(!!(await caches.match('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js')), 'установка: supabase-js (непрозрачный ответ — через put)');
  ok(skipped === 0, 'обновление не встаёт само — ждёт «Обновить»');
  // переход со старого sw.js (кэш dan4ik37-shell-v2): сразу
  await caches.open('dan4ik37-shell-v2'); await caches.open('d37-shell-v2'); await caches.open('d37-rust-0.2.1');
  await fire('install', {});
  ok(skipped === 1, 'был старый sw.js — новая версия встаёт сразу');

  // 11.4 включение: чистим только свои старые кэши
  await fire('activate', {});
  const names = await caches.keys();
  ok(!names.includes('dan4ik37-shell-v2') && !names.includes('d37-shell-v2'), 'старые кэши sw.js удалены');
  ok(names.includes('d37-rust-0.2.1') && names.includes(X.SHELL), 'чужой кэш (сборка Rust) и текущий — на месте');
  ok(claimed === 1 && preloadOn === 1, 'clients.claim и navigation preload');

  // 11.5 главная: сеть / без сети — копия / без копии — офлайн-страница
  NET.mode = 'online';
  let r = await get('/', { mode: 'navigate' });
  ok(r.res && r.res.status === 200 && r.text.startsWith('<!-- net -->'), 'главная с сетью — свежая из сети');
  NET.mode = 'offline';
  r = await get('/?share_text=hi', { mode: 'navigate' });
  ok(r.res && r.res.status === 200 && /<title>/.test(r.text), 'главная без сети — копия (и с параметрами)');
  NET.mode = 'hang';
  r = await get('/', { mode: 'navigate' });
  ok(r.res && r.res.status === 200, 'сеть «висит» — через NET_WAIT копия');
  NET.mode = 'offline';
  r = await get('/v/dQw4w9WgXcQ', { mode: 'navigate' });
  ok(r.res && /Нет интернета/.test(r.text), 'серверная страница без сети — офлайн-страница');
  await shell.delete('/');
  r = await get('/', { mode: 'navigate' });
  ok(r.res && /Нет интернета/.test(r.text), 'нет ни сети, ни копии — офлайн-страница');
  NET.mode = 'online';
  r = await get('/', { mode: 'navigate' });
  ok(!!(await shell.match('/')), 'с сетью копия главной снова в кэше');

  // 11.6 скрипты без номера: сеть, без сети — копия; нет копии — ошибка сети
  r = await get('/js/core/config.js');
  ok(r.res && r.res.status === 200, 'скрипт с сетью — из сети');
  NET.mode = 'offline';
  r = await get('/js/core/config.js');
  ok(r.res && r.res.status === 200, 'скрипт без сети — копия');
  r = await get('/js/core/nope.js');
  ok(r.res && r.res.type === 'error', 'нет ни сети, ни копии — ошибка сети (как без sw.js)');

  // 11.7 ?v=: из кэша, тихо обновить; новый номер — старый удалён; без сети — старый номер лучше, чем ничего
  NET.mode = 'online'; NET.calls.length = 0;
  r = await get('/js/games/sudoku.js?v=61');
  ok(r.res && r.res.status === 200 && NET.calls.length === 1, 'первый раз — сеть');
  NET.calls.length = 0;
  r = await get('/js/games/sudoku.js?v=61');
  ok(r.res && r.res.status === 200 && NET.calls.length === 0, 'второй раз — из кэша, без сети (копия свежая)');
  const rt = CS.get(X.RT);
  const k61 = rt.m.get(ORIGIN + '/js/games/sudoku.js?v=61');
  rt.m.set(ORIGIN + '/js/games/sudoku.js?v=61', new Response(await k61.clone().text(), { headers: { date: new Date(Date.now() - 2 * 3600e3).toUTCString() } }));
  NET.calls.length = 0;
  r = await get('/js/games/sudoku.js?v=61');
  ok(r.res && NET.calls.length === 1, 'копия старше часа — отдали из кэша и тихо обновили');
  r = await get('/js/games/sudoku.js?v=62');
  ok(!rt.m.has(ORIGIN + '/js/games/sudoku.js?v=61') && rt.m.has(ORIGIN + '/js/games/sudoku.js?v=62'), 'новый GAMES_VER — старый номер файла удалён');
  NET.mode = 'offline';
  r = await get('/js/games/sudoku.js?v=63');
  ok(r.res && r.res.status === 200, 'без сети и без нового номера — старый номер того же файла');

  // 11.8 никогда не кэшируем API и рекламу (даже после запросов)
  NET.mode = 'online';
  for (const u of ['/api/feed', '/api/ids?t=1', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://mc.yandex.ru/metrika/tag.js', 'https://zdisuowyjgqirhvcyjfq.supabase.co/rest/v1/x']) {
    const x = await get(u);
    ok(x.passed, 'мимо sw.js: ' + u);
  }
  const allKeys = [];
  for (const c of CS.values()) for (const k of await c.keys()) allKeys.push(k.url);
  // supabase-js с jsDelivr — библиотека (её храним), а сам Supabase (*.supabase.co: база, хранилище, Realtime) — никогда
  const BAD = /\/api\/|\/go\/|googlesyndication|doubleclick|yandex|supabase\.co|ytimg|youtube\.com/;
  ok(!allKeys.some(u => BAD.test(u)), 'в кэше нет ни API, ни рекламы, ни Supabase', allKeys.filter(u => BAD.test(u)));

  // 11.9 сообщения: SKIP_WAITING, файлы игр без интернета (только свои js с ?v=)
  const before = skipped;
  await fire('message', { data: { type: 'SKIP_WAITING' } });
  ok(skipped === before + 1, 'SKIP_WAITING → новая версия встаёт');
  const posted = [];
  await fire('message', { data: { type: 'CACHE_URLS', urls: ['/js/games/g2048.js?v=62', '/js/games/../../api/x.js?v=1', 'https://evil.example/x.js?v=1', '/api/feed?v=1', '/js/games/memory.js'] }, source: { postMessage: m => posted.push(m) } });
  ok(rt.m.has(ORIGIN + '/js/games/g2048.js?v=62') && !allKeysNow().some(u => /evil|\/api\/|memory\.js$/.test(u)), 'в кэш — только свои скрипты игр с ?v=');
  ok(posted[0] && posted[0].type === 'CACHED' && posted[0].n === 1, 'ответ CACHED с числом файлов', posted);
  function allKeysNow(){ const out = []; for (const c of CS.values()) for (const k of c.m.keys()) out.push(k); return out; }

  // 11.10 лишнее из d37-rt удаляется (не больше 400 записей)
  for (let i = 0; i < 420; i++) rt.m.set(ORIGIN + '/img/fake-' + i + '.png', new Response('x'));
  NET.mode = 'online';
  await get('/img/app/sc-world.png');
  ok(rt.m.size <= 400, 'd37-rt не больше 400 записей', rt.m.size);

  // 11.11 push и нажатие на уведомление (обработчики на месте)
  await fire('push', { data: { json: () => ({ title: 'Стрим!', body: 'dan4ik37 в эфире', url: '/#/home', tag: 'live' }) } });
  ok(notes[0] && notes[0].title === 'Стрим!' && notes[0].o.badge === '/img/app/badge-96.png' && notes[0].o.renotify === true && notes[0].o.data.url === '/#/home', 'push → уведомление (значок для строки состояния — одноцветный)');
  await fire('notificationclick', { notification: { data: { url: '/#/chat' }, close(){} } });
  ok(navigated[0] === ORIGIN + '/#/chat', 'нажал уведомление — открытое окно переходит по ссылке');
  clientList = [];
  await fire('notificationclick', { notification: { data: { url: '/#/games' }, close(){} } });
  ok(opened[0] === ORIGIN + '/#/games', 'окна нет — открывается новое');
  ok(X.SHELL === 'd37-shell-' + X.VERSION && !/^(d37-shell-|d37-rt-|dan4ik37-shell-)/.test('d37-rust-1'), 'версия в имени кэша; кэши Rust — не наши');
}

// ═══ 13. Магазины: assetlinks.json, конфиги Bubblewrap (Google Play, RuStore), ключи не в репозитории ═══
function testStores(){
  let AL = null;
  try { AL = JSON.parse(src('.well-known/assetlinks.json')); } catch (e) { ok(false, 'assetlinks.json — правильный JSON', e.message); return; }
  ok(Array.isArray(AL) && AL.every(s => s.relation?.includes('delegate_permission/common.handle_all_urls') && s.target?.namespace === 'android_app' && Array.isArray(s.target.sha256_cert_fingerprints)), 'assetlinks.json: формат Digital Asset Links');
  const pkgs = AL.map(s => s.target.package_name);
  const REQ = ['backgroundColor', 'enableNotifications', 'host', 'iconUrl', 'name', 'navigationColor', 'packageId', 'signingKey', 'splashScreenFadeOutDuration', 'startUrl', 'themeColor', 'themeColorDark'];
  for (const [dir, app] of [['play', 'play'], ['rustore', 'rustore']]) {
    let M = null;
    try { M = JSON.parse(src(`apps/android/${dir}/twa-manifest.json`)); } catch (e) { ok(false, `twa-manifest ${dir} — правильный JSON`, e.message); continue; }
    ok(REQ.every(k => k in M), `twa-manifest ${dir}: все обязательные поля Bubblewrap`, REQ.filter(k => !(k in M)));
    ok(M.host === 'dan4ik37.vercel.app' && M.startUrl === '/?app=' + app, `twa-manifest ${dir}: сайт и startUrl /?app=${app}`);
    ok(pkgs.includes(M.packageId), `twa-manifest ${dir}: пакет ${M.packageId} есть в assetlinks.json`);
    ok(M.fallbackType === 'customtabs', `twa-manifest ${dir}: запасной вариант — Custom Tabs (WebView без SDK — нельзя AdSense)`);
    ok((M.shortcuts || []).every(s => s.url.includes('?app=' + app)), `twa-manifest ${dir}: ярлыки помечены ?app=${app}`);
    ok(M.shareTarget?.params?.text === 'share_text' && M.protocolHandlers?.[0]?.protocol === 'web+denchik', `twa-manifest ${dir}: «Поделиться» и web+denchik как в manifest.json`);
    const T = fakeBrowser().W.D37App._test;
    ok(T.srcOf(null, 'android-app://' + M.packageId + '/') === app, `запуск из приложения ${M.packageId} → источник «${app}»`);
  }
  ok(!/"shortName": "Магазин"/.test(src('apps/android/play/twa-manifest.json')), 'в сборке для Google Play нет ярлыка «Магазин» (покупки — только через Play Billing)');
  const T = fakeBrowser().W.D37App._test;
  ok(T.srcOf('play', '') === 'play' && T.srcOf('evil', '') === '' && T.srcOf(null, 'https://google.com/') === '' && T.srcOf(null, 'android-app://com.other.app/') === 'twa', 'srcOf: только известные значения');
  const gi = src('.gitignore');
  ok(['*.keystore', '*.jks', '*.apk', '*.aab', 'signing-key-info.txt'].every(x => gi.includes(x)), '.gitignore: ключи подписи и сборки не попадут в репозиторий');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]);
  ok(!walk(path.join(SITE, 'apps')).some(f => /\.(keystore|jks|apk|aab)$/.test(f)), 'в apps/ нет ключей и сборок');
  const doc = src('docs/APPS.md');
  ok(/support\.google\.com\/adsense\/answer\/48182/.test(doc) && /requirement-apps/.test(doc) && /ЗАМЕНИТЬ-1/.test(doc) && /ЗАМЕНИТЬ-3/.test(doc), 'docs/APPS.md: источники и как заполнить assetlinks');
}

// ═══ 12. Офлайн-страница: те же игры, что OFFLINE_GAMES в app.js; без внешних файлов ═══
function testOfflinePage(){
  const h = src('offline.html');
  const ids = [...h.matchAll(/\['([\w]+)', '[^']*', '[^']*', '[\w.-]+\.js'\]/g)].map(m => m[1]);
  const T = fakeBrowser().W.D37App._test;
  ok(JSON.stringify(ids) === JSON.stringify(T.OFFLINE_GAMES), 'офлайн-страница: те же игры, что в app.js', [ids, T.OFFLINE_GAMES]);
  const files = [...h.matchAll(/'([\w.-]+\.js)'\]/g)].map(m => m[1]);
  ok(files.every(f => fs.existsSync(path.join(SITE, 'js/games', f))), 'файлы игр на офлайн-странице существуют', files.filter(f => !fs.existsSync(path.join(SITE, 'js/games', f))));
  const gamesSrc = src('js/features/games.js');
  ok(T.OFFLINE_GAMES.every(id => new RegExp(`id: '${id}'`).test(gamesSrc)), 'все игры из OFFLINE_GAMES есть в GAMES');
  ok(!/<script[^>]+src=|<link[^>]+stylesheet|https?:\/\/(?!dan4ik37)/.test(h.replace(/<!--[\s\S]*?-->/g, '')), 'офлайн-страница без внешних скриптов, стилей и адресов');
  ok(/noindex/.test(h) && /addEventListener\('online'/.test(h), 'не индексируется; сеть появилась — обновится сама');
}

// ═══ 9. manifest.json: обязательное, значки, снимки, ярлыки, «Поделиться», ссылки web+denchik ═══
function imgSize(file){
  const b = fs.readFileSync(path.join(SITE, file.replace(/^\//, '')));
  if (b.slice(1, 4).toString() === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') {
    const kind = b.slice(12, 16).toString();
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
  }
  return null;
}
function testManifest(){
  let M = null;
  try { M = JSON.parse(src('manifest.json')); } catch (e) { ok(false, 'manifest.json — правильный JSON', e.message); return; }
  const hex = c => /^#[0-9a-f]{6}$/i.test(c || '');
  ok(M.id === '/' && M.start_url === '/' && M.scope === '/', 'id / start_url / scope — «/» (прежние установки — то же приложение)');
  ok(!!M.name && !!M.short_name && M.short_name.length <= 12, 'name и короткое имя (≤ 12 знаков под значком)', M.short_name);
  ok(M.lang === 'ru' && hex(M.background_color) && hex(M.theme_color), 'язык и цвета');
  ok(M.display === 'standalone' && Array.isArray(M.display_override) && M.display_override[0] === 'window-controls-overlay' && M.display_override.includes('standalone'), 'standalone + window-controls-overlay');
  ok(M.display_override.every(d => ['window-controls-overlay', 'standalone', 'minimal-ui', 'fullscreen', 'browser', 'tabbed'].includes(d)), 'display_override — только известные значения');
  ok(Array.isArray(M.categories) && M.categories.includes('games'), 'категории');
  const icons = M.icons || [];
  const has = (size, purpose) => icons.some(i => i.sizes === size && (i.purpose || 'any').split(' ').includes(purpose));
  ok(has('192x192', 'any') && has('512x512', 'any'), 'значки any 192 и 512 (нужны для установки)');
  ok(has('192x192', 'maskable') && has('512x512', 'maskable'), 'маскируемые 192 и 512');
  ok(has('512x512', 'monochrome'), 'одноцветный значок');
  ok(!icons.some(i => /any maskable|maskable any/.test(i.purpose || '')), 'без «any maskable» в одном значке');
  for (const i of icons) {
    const s = imgSize(i.src);
    ok(s && `${s[0]}x${s[1]}` === i.sizes, `значок ${i.src}: размер файла = ${i.sizes}`, s);
  }
  // снимки: wide — для ПК, narrow — для телефона; в каждой группе один размер; 320…3840, стороны не больше 2,3:1
  const shots = M.screenshots || [];
  ok(shots.some(s => s.form_factor === 'wide') && shots.some(s => s.form_factor === 'narrow'), 'снимки для ПК и телефона');
  for (const ff of ['wide', 'narrow']) ok(new Set(shots.filter(s => s.form_factor === ff).map(s => s.sizes)).size === 1, `снимки ${ff} — одного размера`);
  for (const s of shots) {
    const z = imgSize(s.src), [w, h] = (s.sizes || '').split('x').map(Number);
    ok(z && z[0] === w && z[1] === h, `снимок ${s.src}: файл ${z} = ${s.sizes}`);
    ok(w >= 320 && h >= 320 && w <= 3840 && h <= 3840 && Math.max(w, h) / Math.min(w, h) <= 2.3, `снимок ${s.src}: размеры в правилах Chrome`);
    ok(s.form_factor === 'wide' ? w > h : h > w, `снимок ${s.src}: ориентация как form_factor`);
    ok(!!s.label && s.type === 'image/webp', `снимок ${s.src}: подпись и тип`);
  }
  // ярлыки: Мир, Чат, Игры, Слово дня, Магазин — в своей области, значки ≥ 96
  const sc = M.shortcuts || [];
  ok(sc.length >= 5 && sc.length <= 10, 'ярлыков 5…10', sc.length);
  const urls = sc.map(s => s.url);
  ok(['/#/games/world', '/#/chat', '/#/games', '/#/games/words', '/#/shop'].every(u => urls.includes(u)), 'ярлыки: Мир, Чат, Игры, Слово дня, Магазин', urls);
  for (const s of sc) {
    ok(!!s.name && s.url.startsWith('/'), `ярлык «${s.name}»: имя и адрес на сайте`);
    ok((s.icons || []).some(i => +String(i.sizes).split('x')[0] >= 96) && (s.icons || []).every(i => { const z = imgSize(i.src); return z && `${z[0]}x${z[1]}` === i.sizes; }), `ярлык «${s.name}»: значки ≥ 96 и размеры верны`);
  }
  // «Поделиться»: GET на «/» с параметрами, которые понимает app.js (launchAction)
  const st = M.share_target || {};
  ok(st.action === '/' && (st.method || 'GET').toUpperCase() === 'GET', 'share_target: GET на главную');
  const p = st.params || {};
  ok(p.title === 'share_title' && p.text === 'share_text' && p.url === 'share_url', 'share_target: свои имена параметров (их ждёт app.js)');
  const T2 = fakeBrowser().W.D37App._test;
  const shareUrl = 'https://dan4ik37.vercel.app/?' + new URLSearchParams({ [p.title]: 'Т', [p.text]: 'Привет', [p.url]: 'https://x.ru' });
  ok(!!T2.launchAction(shareUrl, 'https://dan4ik37.vercel.app')?.share, 'адрес «Поделиться» из manifest → окошко «Поделиться» в app.js');
  // web+denchik:
  const ph = (M.protocol_handlers || [])[0] || {};
  ok(/^web\+[a-z]+$/.test(ph.protocol) && ph.protocol === 'web+denchik' && /%s/.test(ph.url) && ph.url.startsWith('/?proto='), 'protocol_handlers: web+denchik → /?proto=%s');
  ok(T2.launchAction('https://dan4ik37.vercel.app' + ph.url.replace('%s', encodeURIComponent('web+denchik://c/abc123')), 'https://dan4ik37.vercel.app').go === '#/chat/join/abc123', 'web+denchik://c/<код> → приглашение');
  const lh = M.launch_handler || {};
  ok([].concat(lh.client_mode)[0] === 'focus-existing', 'launch_handler: focus-existing (ярлык — в уже открытом окне)');
  ok(M.handle_links === 'preferred', 'handle_links: preferred');
  ok((M.related_applications || []).some(a => a.platform === 'webapp' && /\/manifest\.json$/.test(a.url)) && M.prefer_related_applications === false, 'related_applications: сам сайт (getInstalledRelatedApps), магазины не навязываем');
  // подключение на страницах
  const idx = src('index.html');
  ok(/<link rel="manifest" href="\/manifest\.json">/.test(idx) && /css\/app\.css/.test(idx) && /js\/features\/app\.js/.test(idx), 'index.html: manifest, app.css, app.js');
  ok(!/pwaBanner/.test(idx) && !/pwaBanner/.test(src('js/features/push-pwa.js')), 'старой полоски #pwaBanner больше нет');
  ok(/apple-mobile-web-app-status-bar-style/.test(idx) && /apple-mobile-web-app-title/.test(idx), 'iPhone: строка состояния и подпись значка');
  ok(/data-app-install data-app-act="install" data-from="profile"/.test(idx), 'кнопка в профиле');
  ok(/rel="manifest" href="\/manifest\.json"/.test(src('api/_lib/page.js')), 'серверные страницы тоже с manifest (ставится и с /games/<id>)');
  ok(/d37:badges/.test(src('js/features/phone.js')), 'phone.js шлёт d37:badges (значок на иконке)');
  ok(/D37App\?\.settingsRow/.test(src('js/core/settings.js')), '⚙️ Настройки → Сайт: строка «Приложение»');
  // vercel.json: заголовки для manifest, sw.js, assetlinks
  const V = JSON.parse(src('vercel.json'));
  const hdr = (s, k) => (V.headers.find(h => h.source === s)?.headers || []).find(h => h.key.toLowerCase() === k.toLowerCase())?.value;
  ok(/manifest\+json/.test(hdr('/manifest.json', 'Content-Type') || ''), 'vercel.json: manifest — application/manifest+json');
  ok(hdr('/sw.js', 'Cache-Control') === 'no-cache', 'vercel.json: sw.js — no-cache');
  ok(hdr('/.well-known/assetlinks.json', 'Content-Type') === 'application/json', 'vercel.json: assetlinks.json — application/json');
  ok(Object.keys(V.functions || {}).length <= 12 && fs.readdirSync(path.join(SITE, 'api')).filter(f => f.endsWith('.js')).length <= 12, 'функций Vercel не больше 12');
}

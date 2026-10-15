// Тесты приложения (PWA) в node, без браузера: js/features/app.js (где открыт сайт и какие шаги показать, разовая карточка,
// «Поделиться», web+dan4ik37:, адреса запуска, значок на иконке), js/features/app-guide.js (шаги и картинки).
// Запуск из корня сайта: node scripts/pwa-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

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
  querySelector(){ return null; } querySelectorAll(){ return []; } closest(){ return null; } focus(){} getClientRects(){ return [1]; }
  addEventListener(...a){ this.et.addEventListener(...a); } removeEventListener(...a){ this.et.removeEventListener(...a); } dispatchEvent(e){ return this.et.dispatchEvent(e); }
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
  const href = o.href || 'https://dan4ik37.vercel.app/#/home';
  const u = new URL(href);
  const loc = { href, origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, assigned: null, assign(x){ this.assigned = x; }, replace(x){ this.hash = x; }, reload(){ this.reloaded = true; } };
  const hist = { state: null, pushes: 0, replaced: [], pushState(s){ this.state = s; this.pushes++; }, replaceState(s, t, url){ this.state = s; this.replaced.push(url); }, back(){} };
  const sandbox = {
    document: doc, navigator: nav, location: loc, history: hist,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: k => (k in sstore ? sstore[k] : null), setItem: (k, v) => { sstore[k] = String(v); }, removeItem: k => { delete sstore[k]; } },
    matchMedia: q => ({ matches: !!(o.standalone && /display-mode: standalone/.test(q)) }),
    requestAnimationFrame: f => setTimeout(f, 0), setTimeout, clearTimeout, console, URL, URLSearchParams, Event, CustomEvent, EventTarget, MutationObserver: class { observe(){} disconnect(){} },
    addEventListener: (...a) => W.addEventListener(...a), removeEventListener: (...a) => W.removeEventListener(...a), dispatchEvent: e => W.dispatchEvent(e),
    isSecureContext: true, innerWidth: 1280, va: (...a) => (sandbox._va = sandbox._va || []).push(a),
  };
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

// ═══ 4. web+dan4ik37: → адрес ═══
ok(T.protoTarget('web+dan4ik37://c/AbC123') === '/#/chat/join/abc123', 'приглашение в сообщество');
ok(T.protoTarget(encodeURIComponent('web+dan4ik37://c/abc123')) === '/#/chat/join/abc123', 'закодированная ссылка');
ok(T.protoTarget('web+dan4ik37:games/chess/k3j9x2') === '/#/games/chess/k3j9x2', 'комната игры');
ok(T.protoTarget('web+dan4ik37://games/horde/coop/ab12cd') === '/#/games/horde/coop/ab12cd', 'кооп «Орды»');
ok(T.protoTarget('web+dan4ik37://world') === '/#/games/world', 'мир');
ok(T.protoTarget('web+dan4ik37://g/Ab12Cd34') === '/g/Ab12Cd34', 'игра игрока');
ok(T.protoTarget('web+dan4ik37://v/dQw4w9WgXcQ') === '/v/dQw4w9WgXcQ', 'ролик');
ok(T.protoTarget('web+dan4ik37://call/abcd1234ef') === '/#/phone/call/abcd1234ef', 'звонок');
ok(T.protoTarget('web+dan4ik37://evil.com/x') === '/#/home', 'чужое — на главную');
ok(T.protoTarget('web+dan4ik37://games/../../x') === '/#/home', '«..» не пропускаем');
ok(T.protoTarget('web+dan4ik37://chat/<script>') === '/#/home', 'странные символы — на главную');
ok(T.protoTarget('web+dan4ik37:javascript:alert(1)') === '/#/home', 'javascript: — на главную');

// ═══ 5. Адрес запуска ═══
const O = 'https://dan4ik37.vercel.app';
const la = h => T.launchAction(h, O);
ok(JSON.stringify(la(O + '/?share_title=T&share_text=Hi&share_url=https%3A%2F%2Fx.ru')) === JSON.stringify({ share: { title: 'T', text: 'Hi', url: 'https://x.ru' } }), '«Поделиться» → share');
ok(la(O + '/?proto=web%2Bdan4ik37%3A%2F%2Fc%2Fabc123').go === '#/chat/join/abc123', 'web+dan4ik37 → переход');
ok(la(O + '/?proto=web%2Bdan4ik37%3A%2F%2Fv%2FdQw4w9WgXcQ').open === '/v/dQw4w9WgXcQ', 'web+dan4ik37 → серверная страница');
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

  console.log(`\npwa-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

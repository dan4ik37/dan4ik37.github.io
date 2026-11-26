// «👍 Лайк на YouTube» по-настоящему (js/core/ytlike.js) — быстрые проверки без браузера (сам путь в Chrome — scripts/ytlike-e2e.cjs):
//  1) флаг как на сайте: YT_LIKE_REAL 'off' или нет ID клиента → нажатие не берётся (ссылка как раньше), кнопки не трогаются;
//  2) подмена флага работает только на localhost (на dan4ik37.vercel.app window.__d37YtLikeTest ничего не включает);
//  3) ответы YouTube API → причина: квота, нет канала, токен, право, ролик, сеть; день квоты — по Тихоокеанскому времени;
//  4) ответ Google во фрагменте: чужая метка state не принимается, токен не попадает в localStorage; право без YouTube — отказ;
//  5) код: токен не пишется в localStorage и консоль, единственное право — youtube.force-ssl, вход Google (social-login / global-auth)
//     не просит права YouTube, наград за лайк нет.
// Запуск из корня сайта: node scripts/ytlike-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

function store() { const s = {}; return { s, getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, get length() { return Object.keys(s).length; }, key: i => Object.keys(s)[i] }; }
// окно-заглушка: config.js как на сайте (или со своими строками), D37Intent-заглушка, вошедший админ
function load({ host = 'dan4ik37.vercel.app', cfgPatch = null, test = null, hash = '', ytHash, user = { id: 'u1' }, roleName = 'admin', ss } = {}) {
  let cfg = src('js/core/config.js');
  if (cfgPatch) for (const [a, b] of cfgPatch) cfg = cfg.replace(a, () => b);
  const logs = [];
  const w = {
    location: { hostname: host, hash, pathname: '/', search: '', origin: 'https://' + host, assign(u) { w.went = u; } },
    history: { replaceState() { w.replaced = true; } },
    sessionStorage: ss || store(), localStorage: store(),
    navigator: { userAgent: 'Mozilla/5.0 Chrome/120' },
    document: { documentElement: { classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} }, readyState: 'complete', querySelectorAll: () => [], getElementById: () => null, addEventListener() {} },
    crypto: require('crypto').webcrypto, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) },
    setTimeout, clearTimeout, URLSearchParams, Date, JSON, Promise, Map, Set, Array, String, Number, Math, Object, Uint8Array,
    fetch: async () => { throw new Error('no net'); }, addEventListener() {},
    D37Intent: { ON: true, park: async () => true, need: async () => false, on() {}, inApp: () => false, pending: () => null, busy: () => false },
    __d37YtLikeTest: test, __d37YtHash: ytHash,
  };
  w.window = w; w.globalThis = w;
  const ctx = vm.createContext(w);
  vm.runInContext(cfg + `\n;var currentUser = ${JSON.stringify(user)}, currentRole = ${JSON.stringify(roleName)};`, ctx, { filename: 'config.js' });
  vm.runInContext(src('js/core/ytlike.js'), ctx, { filename: 'ytlike.js' });
  return { w, Y: w.D37YtLike, logs };
}
const CID = '123456789012-abc.apps.googleusercontent.com';
const ev = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };

(async () => {
  // ═══ 1. Флаг как на сайте ═══
  const cfgSrc = src('js/core/config.js');
  ok(/const YT_LIKE_REAL = '(off|test|on)';/.test(cfgSrc) && /const YT_CLIENT_ID = '[^']*';/.test(cfgSrc) && /const YT_LIKE_TEST_IDS = \[/.test(cfgSrc), 'config.js: YT_LIKE_REAL, YT_CLIENT_ID, YT_LIKE_TEST_IDS на месте');
  const live = cfgSrc.match(/const YT_LIKE_REAL = '(\w+)';/)[1], liveCid = cfgSrc.match(/const YT_CLIENT_ID = '([^']*)';/)[1];
  ok(live !== 'on', "на сайте не 'on', пока Google не проверил приложение (смени эту проверку вместе с флагом)", live);
  ok(live === 'off' || /\.apps\.googleusercontent\.com$/.test(liveCid), "'test' — только с ID клиента", { live, liveCid });
  ok(!/GOCSPX-|client_secret/i.test(cfgSrc + src('js/core/ytlike.js')), 'секрета клиента в коде нет');
  {
    const { Y } = load();
    const e = ev();
    ok(Y.mode() === (liveCid ? live : 'off') && (Y.mode() !== 'off' || Y.tap(e, null, 'dQw4w9WgXcQ') === false) && !e.prevented, 'как на сайте: нажатие не берётся — ссылка как раньше', Y.mode());
  }
  {
    const { Y } = load({ cfgPatch: [["const YT_LIKE_REAL = '" + live + "';", "const YT_LIKE_REAL = 'on';"]] });
    ok(Y.mode() === 'off', "'on' без ID клиента — выключено");
  }
  // ═══ 2. Подмена флага — только localhost ═══
  {
    const { Y } = load({ test: { mode: 'on', cid: CID } });
    ok(Y.mode() === 'off', 'на сайте __d37YtLikeTest ничего не включает');
    const L = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID } });
    ok(L.Y.mode() === 'on' && L.Y.why() === null, 'на localhost проверка включает');
    const e = ev();
    ok(L.Y.tap(e, null, 'dQw4w9WgXcQ') === true && e.prevented, "'on', вошёл: нажатие берётся (ссылка не открывается)");
    ok(L.Y.tap(ev(), null, 'bad id') === false, 'плохой id — не берётся');
    const T = load({ host: '127.0.0.1', test: { mode: 'test', cid: CID }, roleName: 'user' });
    ok(T.Y.why() === 'off', "'test': обычный человек — как раньше");
    const T2 = load({ host: '127.0.0.1', test: { mode: 'test', cid: CID, ids: ['u1'] }, roleName: 'user' });
    ok(T2.Y.why() === null, "'test': аккаунт из YT_LIKE_TEST_IDS — да");
    const G = load({ host: '127.0.0.1', test: { mode: 'test', cid: CID }, user: null, roleName: null });
    ok(G.Y.why() === 'off', "'test': гость — как раньше");
    const K = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID } });
    K.w.D37Age = { kid: () => true };
    ok(K.Y.why() === 'off', 'ребёнок до 13 — как раньше (ссылка)');
    K.w.D37Age = { kid: () => false }; K.w.D37Intent.inApp = () => true;
    ok(K.Y.why() === 'inapp', 'встроенный браузер — ссылка со строкой');
    K.w.D37Intent.inApp = () => false; K.w.localStorage.setItem('d37_ytl_quota', K.Y._test.ptDay());
    ok(K.Y.why() === 'quota', 'квота кончилась сегодня (PT) — ссылка');
    K.w.localStorage.setItem('d37_ytl_quota', '2000-01-01');
    ok(K.Y.why() === null, 'вчерашняя квота не мешает');
  }
  // ═══ 3. Ответы YouTube API → причина ═══
  {
    const { Y } = load();
    const c = Y._test.classify;
    ok(c(403, 'quotaExceeded') === 'quota' && c(403, 'dailyLimitExceeded') === 'quota', 'квота');
    ok(c(401, 'youtubeSignupRequired') === 'channel' && c(400, 'emailNotVerified') === 'channel', 'нет канала / почта не подтверждена');
    ok(c(401, 'authError') === 'expired', 'токен отозван / истёк');
    ok(c(403, 'insufficientPermissions') === 'denied', 'нет права');
    ok(c(403, 'videoRatingDisabled') === 'video' && c(404, 'videoNotFound') === 'video' && c(403, 'forbidden') === 'video', 'ролик не даёт лайк');
    ok(c(500, '') === 'broken' && c(403, 'rateLimitExceeded') === 'broken', 'прочее — сеть / сбой (не квота на весь день)');
    ok(Y._test.COST.rate === 50 && Y._test.COST.getRating === 1, 'цена: rate 50, getRating 1');
    ok(/^\d{4}-\d\d-\d\d$/.test(Y._test.ptDay()), 'день квоты — дата PT');
  }
  // ═══ 4. Ответ Google ═══
  {
    const ss = store();
    ss.setItem('d37_ytl_state', JSON.stringify({ n: 'goodnonce1234567', id: 'dQw4w9WgXcQ', at: Date.now(), u: 'u1' }));
    const tokn = 'ya29.TESTONLY_abcdefghijklmnop';
    const A = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss, ytHash: `#state=ytl.goodnonce1234567&access_token=${tokn}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(SCOPE + ' openid')}` });
    ok(A.Y._test.token() === tokn && A.Y._test.ret()?.id === 'dQw4w9WgXcQ' && !A.Y._test.ret().err, 'свой ответ: токен принят, ждёт этот ролик');
    ok(!JSON.stringify(A.w.localStorage.s).includes(tokn), 'токен не в localStorage');
    ok(!A.w.sessionStorage.getItem('d37_ytl_state'), 'метка одноразовая — стёрта');
    const ss2 = store();
    ss2.setItem('d37_ytl_state', JSON.stringify({ n: 'goodnonce1234567', id: 'dQw4w9WgXcQ', at: Date.now(), u: 'u1' }));
    const B = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss: ss2, ytHash: `#state=ytl.EVILnonce1234567&access_token=${tokn}&expires_in=3599&scope=${encodeURIComponent(SCOPE)}` });
    ok(B.Y._test.token() === null && B.Y._test.ret()?.err === 'state', 'чужая метка state — токен НЕ принят');
    const ss3 = store();
    ss3.setItem('d37_ytl_state', JSON.stringify({ n: 'goodnonce1234567', id: 'dQw4w9WgXcQ', at: Date.now(), u: 'u1' }));
    const C = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss: ss3, ytHash: `#state=ytl.goodnonce1234567&access_token=${tokn}&expires_in=3599&scope=openid%20email` });
    ok(C.Y._test.token() === null && C.Y._test.ret()?.err === 'denied', 'галочку YouTube сняли — это отказ');
    const ss4 = store();
    ss4.setItem('d37_ytl_state', JSON.stringify({ n: 'goodnonce1234567', id: 'dQw4w9WgXcQ', at: Date.now(), u: 'u1' }));
    const D = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss: ss4, ytHash: '#error=access_denied&state=ytl.goodnonce1234567' });
    ok(D.Y._test.ret()?.err === 'denied', '«Отмена» на экране Google — отказ');
    const E = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss: (() => { const s = store(); s.setItem('d37_ytl_tok', JSON.stringify({ t: tokn, exp: Date.now() + 3e6, u: 'someone-else' })); return s; })() });
    ok(E.Y._test.token() === null, 'токен другого аккаунта сайта — стёрт');
    ok(!A.logs.concat(B.logs, C.logs, D.logs).some(l => l.includes(tokn)), 'в консоль ничего с токеном');
  }
  // ═══ 5. Код ═══
  {
    const y = src('js/core/ytlike.js');
    ok(!/localStorage\.setItem\([^)]*TOK|lsSet\(TOK/.test(y), 'токен не пишется в localStorage');
    ok(!/console\.(log|info|warn|error|debug)/.test(y), 'в ytlike.js нет вывода в консоль');
    ok((y.match(/https:\/\/www\.googleapis\.com\/auth\/[\w.-]+/g) || []).every(s => s === SCOPE), 'единственное право — youtube.force-ssl');
    ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(y), 'разметка не собирается из строк (только textContent)');
    const login = src('js/features/social-login.js') + src('js/features/global-auth.js');
    ok(!/youtube/i.test((login.match(/signInWithOAuth\([^)]*\)/g) || []).join(' ')) && !/scopes\s*:/.test(login), 'вход Google не просит права YouTube (scopes нигде нет)');
    ok(!/addXp|addXP|grantXp|claim_\w+|\bcoins?\b|🪙|reward|награ/i.test(y.replace(/\/\/[^\n]*/g, '')), 'никаких наград за лайк (III.F.3.c)');
    const html = src('index.html');
    ok(/y=\/\(\?:\^#\|&\)state=ytl\\\./.test(html) && /window\.__d37YtHash=h/.test(html), 'скрипт в <head> забирает ответ Google до счётчиков');
    ok(html.indexOf('src="js/core/ytlike.js"') > html.indexOf('src="js/features/auth-intent.js"'), 'ytlike.js — после auth-intent.js');
    ok(/\^ytl\\.\/\.test\(q\.get\('state'\)/.test(src('js/features/auth-guard.js')), 'auth-guard.js не принимает ответ Google за вход');
  }
  console.log(`ytlike-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e?.stack || e); process.exit(1); });

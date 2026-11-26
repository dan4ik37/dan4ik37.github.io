// «👍 Лайк на YouTube» по-настоящему (js/core/ytlike.js) — быстрые проверки без браузера (сам путь в Chrome — scripts/ytlike-e2e.cjs):
//  1) флаг как на сайте: YT_LIKE_REAL 'off' или нет ID клиента → нажатие не берётся (ссылка как раньше), кнопки не трогаются;
//  2) подмена флага работает только на localhost (на dan4ik37.vercel.app window.__d37YtLikeTest ничего не включает);
//  3) ответы YouTube API → причина: квота, нет канала, токен, право, ролик, сеть; день квоты — по Тихоокеанскому времени;
//  4) ответ Google во фрагменте: чужая метка state не принимается, токен не попадает в localStorage; право без YouTube — отказ;
//  5) код: токен не пишется в localStorage и консоль, единственное право — youtube.force-ssl, вход Google (social-login / global-auth)
//     не просит права YouTube, наград за лайк нет;
//  6) к Google без нажатия не ходим (только сразу после входа гостя); вернулся без ответа Google или метка не та — лайка нет;
//     обещание строки держим: «откроется YouTube» → следующее нажатие ссылка (ролик не даёт лайк, сбой сети, 401 на свежем токене),
//     «Google спросит снова» (401) → следующее нажатие — экран Google;
//  7) D37Intent.park принадлежит вкладке: в новой вкладке его не видно.
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
    const { Y } = load({ cfgPatch: [["const YT_LIKE_REAL = '" + live + "';", "const YT_LIKE_REAL = 'on';"], ["const YT_CLIENT_ID = '" + liveCid + "';", "const YT_CLIENT_ID = '';"]] });
    ok(Y.mode() === 'off', "'on' без ID клиента — выключено");
  }
  // ═══ 2. Подмена флага — только localhost ═══
  {
    const { Y } = load({ test: { mode: 'on', cid: CID } });
    const siteMode = load().Y.mode();   // что на сайте и без подмены (сейчас 'test' у админа или 'off')
    ok(Y.mode() === siteMode && Y.mode() !== 'on', 'на сайте __d37YtLikeTest ничего не включает', { with: Y.mode(), without: siteMode });
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
  // ═══ 6. Без нажатия к Google не ходим; обещание «нажми ещё раз — откроется YouTube» держим (проверщик 26.11) ═══
  {
    const V = 'dQw4w9WgXcQ', tokn = 'ya29.TESTONLY_abcdefghijklmnop';
    const tick = () => new Promise(r => setTimeout(r, 20));
    const mk = (o = {}) => {
      const L = load({ host: '127.0.0.1', test: { mode: 'on', cid: CID }, ss: o.ss, ytHash: o.ytHash, user: o.user === undefined ? { id: 'u1' } : o.user });
      L.toasts = []; L.w.xpToast = t => L.toasts.push(t); L.parked = []; L.calls = [];
      L.w.D37Intent.park = async (k, a) => { L.parked.push([k, a]); return true; };
      L.w.fetch = async (u, opt) => { L.calls.push(String(u)); return o.fetch ? o.fetch(u, opt) : { ok: true, status: 204, json: async () => ({}) }; };
      return L;
    };
    const tokSS = at => { const s = store(); s.setItem('d37_ytl_tok', JSON.stringify({ t: tokn, exp: Date.now() + 3e6, u: 'u1', at })); return s; };
    const rates = L => L.calls.filter(u => u.includes('/videos/rate')).length;
    // нажатие → экран Google: в задуманном — метка этого перехода (та же, что в state и в sessionStorage)
    {
      const L = mk();
      ok(L.Y.tap(ev(), null, V) === true, 'нажатие без разрешения — берётся');
      await tick();
      const st = JSON.parse(L.w.sessionStorage.getItem('d37_ytl_state') || 'null');
      ok(L.parked.length === 1 && L.parked[0][1].p && st && L.parked[0][1].p === st.n && String(L.w.went || '').includes('state=ytl.' + st.n), 'переход на Google: метка в задуманном = метка в state', { parked: L.parked, st, went: L.w.went });
    }
    // вернулись БЕЗ ответа Google (Назад, вкладка из кэша, перезагрузка, новая вкладка) — к Google сами не идём
    {
      const L = mk();
      await L.Y._test.resumed({ id: V, p: 'nonceFromEarlierTry123' }, {});
      ok(!L.w.went && !L.calls.length, 'вернулись без ответа Google: на Google не уходим, rate не зовём', { went: L.w.went, calls: L.calls });
      ok(L.toasts.some(t => /не дано/.test(t) && /Нажми 👍 ещё раз/.test(t)), 'строка: разрешение не дано — нажми ещё раз', L.toasts);
    }
    {
      const L = mk();
      await L.Y._test.resumed({ id: V }, {});
      ok(!L.w.went && !L.calls.length, 'задуманное без метки и не от входа гостя — без нажатия на Google не уходим', { went: L.w.went });
    }
    {
      const L = mk();
      await L.Y._test.resumed({ id: V, g: 1 }, {});
      ok(String(L.w.went || '').startsWith('https://accounts.google.com/'), 'сразу после входа гостя (задумано гостем) — экран разрешения Google, как в задании');
    }
    // ответ Google с ЧУЖОЙ меткой задуманного — лайк не ставим
    {
      const mkSS = () => { const s = store(); s.setItem('d37_ytl_state', JSON.stringify({ n: 'goodnonce1234567', id: V, at: Date.now(), u: 'u1' })); return s; };
      const hash = `#state=ytl.goodnonce1234567&access_token=${tokn}&expires_in=3599&scope=${encodeURIComponent(SCOPE)}`;
      const A = mk({ ss: mkSS(), ytHash: hash });
      await A.Y._test.resumed({ id: V, p: 'goodnonce1234567' }, {});
      ok(rates(A) === 1, 'ответ Google с той же меткой — лайк ставится', A.calls);
      const B = mk({ ss: mkSS(), ytHash: hash });
      await B.Y._test.resumed({ id: V, p: 'othernonce999999' }, {});
      ok(rates(B) === 0 && !B.w.went, 'метка не совпала — лайка нет, на Google не уходим', B.calls);
    }
    // ролик не даёт лайк, нажатие уже «остыло» (медленная сеть / нет navigator.userActivation): следующее нажатие — ссылка
    {
      const L = mk({ ss: tokSS(Date.now() - 30 * 60e3), fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'videoRatingDisabled' }] } }) }) });
      ok(L.Y.tap(ev(), null, V) === true, 'ролик: первое нажатие — videos.rate');
      await tick();
      ok(L.toasts.some(t => /откроется YouTube/.test(t)), 'строка обещает YouTube', L.toasts);
      const e2 = ev();
      ok(L.Y.tap(e2, null, V) === false && !e2.prevented && rates(L) === 1, 'ролик: следующее нажатие — ссылка на YouTube, rate снова не зовём', { rates: rates(L) });
      ok(L.Y.tap(ev(), null, V) === false && rates(L) === 1, 'ролик: и дальше ссылка (ролик лайк не даёт)');
      ok(L.Y.tap(ev(), null, 'aaaaaaaaaa1') === true, 'другой ролик — снова настоящий лайк');
    }
    // сеть подвела: следующее нажатие — ссылка (как обещали), потом снова попытка; два сбоя — ссылка до конца визита
    {
      const L = mk({ ss: tokSS(Date.now() - 30 * 60e3), fetch: async () => { throw new TypeError('Failed to fetch'); } });
      L.Y.tap(ev(), null, V); await tick();
      ok(L.toasts.some(t => /откроется YouTube/.test(t)), 'сеть: строка обещает YouTube', L.toasts);
      ok(L.Y.tap(ev(), null, V) === false, 'сеть: следующее нажатие — ссылка');
      ok(L.Y.tap(ev(), null, V) === true, 'сеть: потом — снова попытка');
      await tick();
      ok(L.Y.why() === 'broken' && L.Y.tap(ev(), null, V) === false, 'сеть: два сбоя подряд — ссылка до конца визита', L.Y.why());
    }
    // разрешение истекло (401): строка обещает Google — и следующее нажатие ведёт на Google
    {
      const L = mk({ ss: tokSS(Date.now() - 50 * 60e3), fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { errors: [{ reason: 'authError' }] } }) }) });
      L.Y.tap(ev(), null, V); await tick();
      ok(L.toasts.some(t => /Google спросит/.test(t)) && !L.toasts.some(t => /откроется YouTube/.test(t)), '401: строка обещает экран Google, не YouTube', L.toasts);
      ok(L.Y.tap(ev(), null, V) === true, '401: следующее нажатие берётся');
      await tick();
      ok(String(L.w.went || '').startsWith('https://accounts.google.com/'), '401: и ведёт на Google, как сказано', L.w.went);
    }
    // 401 на только что выданном токене — это не «истёк»: ссылка, чтобы не ходить по кругу через Google
    {
      const L = mk({ ss: tokSS(Date.now() - 10e3), fetch: async () => ({ ok: false, status: 401, json: async () => ({ error: { errors: [{ reason: 'authError' }] } }) }) });
      L.Y.tap(ev(), null, V); await tick();
      ok(L.toasts.some(t => /откроется YouTube/.test(t)), '401 на свежем токене: строка обещает YouTube', L.toasts);
      ok(L.Y.tap(ev(), null, V) === false && !L.w.went, '401 на свежем токене: следующее нажатие — ссылка, не Google');
    }
  }
  // ═══ 8. Подписка (владелец 26.11: «а с подпиской так можно сделать? Как с лайками») — та же система ═══
  {
    const tokn = 'ya29.TESTONLY_abcdefghijklmnop', CH = 'UCztYAfPrieiG6kI93yE-Hdg';
    const tick = () => new Promise(r => setTimeout(r, 20));
    // YT: { subbed, insert: 'ok' | 'dup' | 'forbidden' | 'quota' } — поддельный YouTube API
    const mk = (o = {}) => {
      const YT = { subbed: !!o.subbed, insert: o.insert || 'ok' };
      const L = load({ host: '127.0.0.1', test: { mode: o.mode || 'on', cid: CID }, ss: o.ss, ytHash: o.ytHash, user: o.user === undefined ? { id: 'u1' } : o.user, roleName: o.roleName || 'admin' });
      L.toasts = []; L.w.xpToast = t => L.toasts.push(t); L.parked = []; L.needed = []; L.calls = [];
      L.w.D37Intent.park = async (k, a) => { L.parked.push([k, a]); return true; };
      L.w.D37Intent.need = async (k, a, x) => { L.needed.push([k, a, x]); return false; };
      L.w.fetch = async (u, opt = {}) => {
        u = String(u); L.calls.push([opt.method, u, opt.body || '', String(opt.headers?.Authorization || '')]);
        const j = (b, s = 200) => ({ ok: s < 300, status: s, json: async () => b });
        if (u.includes('/youtube/v3/subscriptions') && opt.method === 'GET') return j({ items: YT.subbed ? [{ id: 'sub1' }] : [] });
        if (u.includes('/youtube/v3/subscriptions') && opt.method === 'POST') {
          if (YT.insert === 'dup') return j({ error: { errors: [{ reason: 'subscriptionDuplicate' }] } }, 400);
          if (YT.insert === 'forbidden') return j({ error: { errors: [{ reason: 'subscriptionForbidden' }] } }, 400);
          if (YT.insert === 'quota') return j({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
          YT.subbed = true; return j({ kind: 'youtube#subscription', id: 'sub1' });
        }
        return j({}, 204);
      };
      return L;
    };
    const tokSS = () => { const s = store(); s.setItem('d37_ytl_tok', JSON.stringify({ t: tokn, exp: Date.now() + 3e6, u: 'u1', at: Date.now() - 30 * 60e3 })); return s; };
    const ins = L => L.calls.filter(c => c[0] === 'POST' && c[1].includes('/subscriptions'));
    const lst = L => L.calls.filter(c => c[0] === 'GET' && c[1].includes('/subscriptions'));
    {
      const { Y } = load();
      const c = Y._test.classify;
      ok(c(400, 'subscriptionForbidden') === 'video' && c(404, 'publisherNotFound') === 'video', 'подписка: YouTube отказал (свой канал, лимит) — «этот канал не даёт»');
      ok(c(404, 'subscriberNotFound') === 'channel' && c(403, 'accountSuspended') === 'channel', 'подписка: у аккаунта нет канала / закрыт');
      ok(Y._test.COST.subInsert === 50 && Y._test.COST.subList === 1, 'цена: subscriptions.insert 50, subscriptions.list 1');
      ok(Y.CHANNEL === CH, 'канал @Dan4ik37Yt — ' + CH);
    }
    {
      const L = mk();
      const e = ev();
      ok(L.Y.tapSub(e) === true && e.prevented, 'подписка без разрешения: нажатие берётся');
      await tick();
      const st = JSON.parse(L.w.sessionStorage.getItem('d37_ytl_state') || 'null');
      ok(L.parked.length === 1 && L.parked[0][0] === 'ytsub' && L.parked[0][1].p === st?.n && st?.id === 'sub' && String(L.w.went || '').includes('state=ytl.' + st.n) && String(L.w.went).includes(encodeURIComponent(SCOPE)), 'подписка → тот же экран Google с тем же правом, отложено ytsub с меткой', { parked: L.parked, st, went: L.w.went });
    }
    {
      const L = mk({ user: null, roleName: null });
      ok(L.Y.tapSub(ev()) === true, "гость ('on'): нажатие берётся");
      await tick();
      ok(L.needed.length === 1 && L.needed[0][0] === 'ytsub' && L.needed[0][1].g === 1 && /подписка/.test(L.needed[0][2]?.label || ''), 'гость → то же окно входа D37Intent.need(ytsub)', L.needed);
    }
    {
      const L = mk({ ss: tokSS() });
      ok(L.Y.tapSub(ev()) === true, 'есть разрешение, не подписан: нажатие берётся');
      await tick(); await tick();
      const i = ins(L);
      ok(lst(L).length === 1 && /mine=true/.test(lst(L)[0][1]) && lst(L)[0][1].includes('forChannelId=' + CH) && i.length === 1, 'list (mine, forChannelId) → insert ровно один раз', L.calls);
      ok(i.length === 1 && JSON.parse(i[0][2]).snippet.resourceId.channelId === CH && JSON.parse(i[0][2]).snippet.resourceId.kind === 'youtube#channel' && /part=snippet/.test(i[0][1]) && i[0][3] === 'Bearer ' + tokn, 'insert: канал @Dan4ik37Yt, токен в заголовке', i);
      ok(!L.calls.some(c => c[1].includes(tokn)), 'токена нет в адресе запроса');
      ok(L.Y._test.subbed() === true && L.toasts.some(t => /✓ Ты подписан на канал на YouTube/.test(t)), 'строка «✓ Ты подписан на канал на YouTube»', L.toasts);
      const e2 = ev();
      ok(L.Y.tapSub(e2) === false && !e2.prevented && ins(L).length === 1, 'второе нажатие на «✓ Ты подписан» — ссылка на канал (отписки нет), insert не зовём');
      ok(L.Y._test.stats.units === 51, 'квота подписки: list 1 + insert 50 = 51 ед.', L.Y._test.stats);
    }
    {
      const L = mk({ ss: tokSS(), subbed: true });
      L.Y.tapSub(ev()); await tick(); await tick();
      ok(ins(L).length === 0 && L.Y._test.subbed() === true && L.toasts.some(t => /уже подписан/.test(t)), 'уже подписан: ✓ без вызова insert', { calls: L.calls, toasts: L.toasts });
    }
    {
      const L = mk({ ss: tokSS(), insert: 'dup' });
      L.Y.tapSub(ev()); await tick(); await tick();
      ok(ins(L).length === 1 && L.Y._test.subbed() === true, 'insert ответил subscriptionDuplicate — тоже «подписан»');
    }
    {
      const L = mk({ ss: tokSS(), insert: 'forbidden' });
      L.Y.tapSub(ev()); await tick(); await tick();
      ok(L.toasts.some(t => /не дал подписаться/.test(t) && /Нажми «Подписаться» ещё раз — откроется YouTube/.test(t)), 'отказ YouTube (свой канал / лимит): строка и обещание ссылки', L.toasts);
      ok(L.Y.tapSub(ev()) === false && L.Y.tapSub(ev()) === false && ins(L).length === 1, 'дальше — ссылка, insert больше не зовём');
      ok(L.Y.tap(ev(), null, 'dQw4w9WgXcQ') === true, 'лайк при этом работает (отказ подписки — только для подписки)');
    }
    {
      const L = mk({ ss: tokSS(), insert: 'quota' });
      L.Y.tapSub(ev()); await tick(); await tick();
      ok(L.Y.why() === 'quota' && L.toasts.some(t => /Подписки с сайта на сегодня закончились/.test(t)), 'квота: строка, до полуночи PT — ссылка', L.toasts);
      ok(L.Y.tapSub(ev()) === false && ins(L).length === 1, 'квота: дальше ссылка');
    }
    {
      const T = mk({ mode: 'test', roleName: 'user' });
      ok(T.Y.tapSub(ev()) === false && !T.calls.length && !T.toasts.length, "'test', не админ: подписка — ссылка, как раньше, без слов");
      const G = mk({ mode: 'test', user: null, roleName: null });
      ok(G.Y.tapSub(ev()) === false && !G.needed.length, "'test', гость: ссылка");
      const K = mk(); K.w.D37Age = { kid: () => true };
      ok(K.Y.tapSub(ev()) === false && !K.calls.length, 'ребёнок до 13 — ссылка');
      const I = mk(); I.w.D37Intent.inApp = () => true;
      ok(I.Y.tapSub(ev()) === false && I.toasts.some(t => /встроенном браузере/.test(t) && /подписка/.test(t)), 'встроенный браузер — ссылка со строкой про подписку', I.toasts);
      const O = load({ host: '127.0.0.1', test: { mode: 'off', cid: CID } });
      ok(O.Y.tapSub(ev()) === false, "'off' — ссылка");
    }
    // возврат с Google: ответ с меткой подписки → list + insert без второго нажатия; без ответа — не уводим
    {
      const mkSS = () => { const s = store(); s.setItem('d37_ytl_state', JSON.stringify({ n: 'subnonce12345678', id: 'sub', at: Date.now(), u: 'u1' })); return s; };
      const hash = `#state=ytl.subnonce12345678&access_token=${tokn}&expires_in=3599&scope=${encodeURIComponent(SCOPE)}`;
      const A = mk({ ss: mkSS(), ytHash: hash });
      ok(A.Y._test.ret()?.id === 'sub' && A.Y._test.token() === tokn, 'ответ Google для подписки принят');
      await A.Y._test.resumed({ p: 'subnonce12345678' }, {}, true);
      ok(ins(A).length === 1 && A.Y._test.subbed() === true, 'вернулись с разрешением — подписка ровно один раз, без второго нажатия', A.calls);
      const B = mk({ ss: mkSS(), ytHash: hash });
      await B.Y._test.resumed({ p: 'othernonce999999' }, {}, true);
      ok(ins(B).length === 0 && !B.w.went, 'метка не та — не подписываем, на Google не уходим');
      const C = mk();
      await C.Y._test.resumed({ p: 'nonceFromEarlierTry123' }, {}, true);
      ok(!C.w.went && !C.calls.length && C.toasts.some(t => /подписка не оформлена/.test(t) && /снова откроется экран Google/.test(t)), '«Назад» с экрана Google: строка, сам не уводит', C.toasts);
      const D = mk();
      await D.Y._test.resumed({ g: 1 }, {}, true);
      ok(String(D.w.went || '').startsWith('https://accounts.google.com/'), 'сразу после входа гостя — экран разрешения Google');
      const E = mk({ ss: (() => { const s = store(); s.setItem('d37_ytl_state', JSON.stringify({ n: 'subnonce12345678', id: 'sub', at: Date.now(), u: 'u1' })); return s; })(), ytHash: '#error=access_denied&state=ytl.subnonce12345678' });
      await E.Y._test.resumed({ p: 'subnonce12345678' }, {}, true);
      ok(!E.calls.length && E.Y.why() === 'denied' && E.toasts.some(t => /Без разрешения Google сайт не подписывает/.test(t)), 'отказ на экране Google — строка, дальше ссылка', E.toasts);
    }
    // код и страницы
    {
      const y = src('js/core/ytlike.js');
      ok(!/'DELETE'/.test(y), 'отписки с сайта нет (subscriptions.delete не зовётся)');
      const subs = [];
      for (const f of ['index.html', 'js/features/shorts.js']) for (const m of src(f).matchAll(/<a [^>]*sub_confirmation=1[^>]*>([\s\S]*?)<\/a>/g)) subs.push([f, m[1].replace(/<[^>]+>/g, '')]);
      ok(subs.length >= 5 && subs.every(([, t]) => /на YouTube/.test(t)), 'все кнопки подписки в SPA — «… на YouTube»', subs);
      const p = src('privacy.html');
      ok(/YouTube API Services/.test(p) && p.includes('https://www.youtube.com/t/terms') && p.includes('https://policies.google.com/privacy') && p.includes('security.google.com/settings/security/permissions'), '/privacy: YouTube API Services, Условия YouTube, Политика Google, страница отзыва доступа');
      ok(/subscriptions\.insert/.test(p) && /subscriptions\.list/.test(p) && /videos\.rate/.test(p) && /videos\.getRating/.test(p) && /id="youtube-en"/.test(p) && /Limited Use/.test(p), '/privacy: все четыре действия, английский раздел, Limited Use');
      ok(/Twitch и DonationAlerts/.test(p) && /Google AdSense/.test(p) && /3\. YouTube API и встроенные видео/.test(p), '/privacy: прежние разделы на месте');
    }
  }
  // ═══ 7. D37Intent.park принадлежит вкладке: новая вкладка (свой sessionStorage) его не видит и никуда не уводит ═══
  {
    const ls = store(), tabA = store(), tabB = store();
    const w = { localStorage: ls, sessionStorage: tabA, location: { hash: '#/shorts/aaaaaaaaaa1' }, scrollY: 0, document: { readyState: 'complete', getElementById: () => null, querySelector: () => null, addEventListener() {} },
      addEventListener() {}, setTimeout, clearTimeout, JSON, Date, Math, Map, WeakMap, Promise, String, Number, Object, Array, console };
    w.window = w; w.globalThis = w;
    const ctx = vm.createContext(w);
    vm.runInContext(src('js/features/auth-intent.js'), ctx, { filename: 'auth-intent.js' });
    const I = w.D37Intent;
    await I.park('ytlike', { id: 'aaaaaaaaaa1', p: 'n1' });
    ok(I.pending()?.kind === 'ytlike', 'park: своя вкладка видит отложенное');
    w.sessionStorage = tabB;
    ok(I.pending() === null, 'park: в новой вкладке отложенного нет (ни места, ни действия)');
    w.sessionStorage = tabA;
    ok(I.pending()?.args?.p === 'n1', 'park: своя вкладка — снова видит (из новой вкладки его не стёрли)');
    await I.need('x', { a: 1 });   // need() гостя — как было: не привязано к вкладке (вход через сервис может вернуть в любую)
    w.sessionStorage = tabB;
    ok(I.pending()?.kind === 'x', 'need (гость): как раньше, видно и в другой вкладке');
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

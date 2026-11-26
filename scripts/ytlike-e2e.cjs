// «👍 Лайк на YouTube» по-настоящему (YT_LIKE_REAL, js/core/ytlike.js; владелец 26.11.2026: «Yes, prepare it») — проверка в настоящем
// Chrome (headless, загрузки запрещены) через ОБЫЧНЫЙ путь сайта. Стенд — scripts/auth-social-e2e.cjs (поддельный Supabase); здесь
// ещё ПОДДЕЛАНЫ Google (экран разрешения accounts.google.com — ответ 302 с токеном или отказом во фрагменте, как настоящий) и YouTube
// Data API (videos.rate / videos.getRating) — в настоящий Google и YouTube НИЧЕГО не уходит, аккаунтов и лайков нет.
//  (off)    флаг как на сайте ('off', без ID клиента): гость и вошедший — кнопка ведёт себя как раньше (ссылка, ✓ в браузере), к Google
//           ни одного запроса;
//  (shorts) 'on', телефон, тёмная: гость в Shorts → 👍 → окно входа → Google (вход БЕЗ права YouTube) → новый аккаунт (год) → экран
//           разрешения Google (одно право youtube.force-ssl) → тот же Short → videos.rate(like) ровно один раз без второго нажатия →
//           залитая 👍, строка «👍 Лайк поставлен на YouTube»; токена нет в localStorage, адресе, консоли;
//  (video)  'test', 1920, светлая: гость — ссылка как раньше; вход почтой (админ) — входу Google право YouTube не нужно; окно ролика
//           на 42-й секунде → 👍 → Google → тот же ролик с 42-й → лайк; второе нажатие — rating=none; перезагрузка — getRating
//           показывает залитую 👍; обычный (не админ) в 'test' — ссылка;
//  (deny)   отказ на экране Google и снятая галочка YouTube → лайка нет, строка «почему», следующее нажатие — ссылка;
//  (quota)  YouTube ответил quotaExceeded → строка, до полуночи PT — ссылка, больше вызовов rate нет;
//  (inapp)  встроенный браузер (Instagram) → ссылка + строка «открой в Chrome или Safari», к Google не ходим;
//  (look)   390×844, 800×600, 1920×1080, 3440×1440 × тёмная / светлая: залитая 👍 в окне ролика и в Shorts, вбок не прокручивается, ошибок нет.
//  Проверщик 26.11 — пути, которых не было:
//  (card)   'on', вошёл: 👍 на КАРТОЧКЕ ленты (youtube.js, a.vlike) → Google → та же главная, та же прокрутка → лайк этому ролику (390 и 1920);
//  (back)   экран Google открыт, человек нажал «Назад»: строка «разрешение не дано», к Google сам НЕ уходит ни сразу, ни после перезагрузки;
//           следующее нажатие — снова экран Google (как обещано);
//  (newtab) экран Google брошен, сайт открыт заново в новой вкладке (свой sessionStorage) в пределах 10 минут: на Google не уходит,
//           на старый Short не переносит;
//  (r401)   videos.rate ответил 401 (разрешение истекло): строка «Google спросит снова» → следующее нажатие ведёт на Google; 401 на только
//           что выданном токене — строка «откроется YouTube» → следующее нажатие — ссылка (не круг через Google);
//  (slow403) ролик не даёт лайк, ответ через 6,5 с (нажатие «остыло», вкладку открыть нельзя): строка «откроется YouTube» → следующие
//           нажатия — ссылка, videos.rate больше не зовём;
//  (net2)   два сбоя сети подряд: после первого следующее нажатие — ссылка, потом снова попытка, после второго — ссылка до конца визита.
//  ПОДПИСКА (ytlike-2, 26.11: «а с подпиской так можно сделать? Как с лайками») — та же система, подделан и subscriptions.list/insert:
//  (sub)     'on', телефон: гость в окне ролика на 42-й секунде → «▶ Подписаться на YouTube» → окно входа → Google (без права YouTube)
//            → экран разрешения → тот же ролик с 42-й → list, потом insert ровно один раз → «✓ Ты подписан» (и на главной);
//            второе нажатие — канал на YouTube (отписки нет);
//  (subtest) 'test': гость — ссылка; админ, уже подписан — «✓» по list без insert и без экрана Google; не админ — ссылка;
//  (subfall) отказ на экране Google / квота / YouTube отказал (свой канал, лимит) / встроенный браузер → строка, дальше ссылка;
//  (sublook) 390×844, 800×600, 1920×1080, 3440×1440 × тёмная / светлая: «✓ Ты подписан» на главной, в окне ролика, в Shorts.
// Запуск из корня сайта: node scripts/ytlike-e2e.cjs   (CHROME=…, PYTHON=…, BASE=…, SHOTS=<папка>,
//   ONLY=off,shorts,video,deny,quota,inapp,look,card,back,newtab,r401,slow403,net2,sub,subtest,subfall,sublook)
const H = require('./auth-social-e2e.cjs');
const { startSite, chrome, newGoogleUser, newProfile, READY, SIGNED, VISIBLE, FEED, SB, ME, V, V2, V3 } = H;
const ONLY = new Set((process.env.ONLY || '').split(',').filter(Boolean));
const want = k => !ONLY.size || ONLY.has(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); if (!c) fails++; };

const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const CID = '123456789012-ytliketest0.apps.googleusercontent.com';
const TOKEN = 'ya29.TESTONLY_ytlike_9f8e7d6c5b4a3210';
// лента для проверки карточек: к двум Shorts и одному длинному ролику (он уходит в «главный» блок) — ещё два длинных, чтобы были карточки
const V4 = 'cccccccccc3', V5 = 'dddddddddd4';
const FEED_YT = () => { const f = FEED(); f.vids.push({ id: V4, title: 'Длинный ролик два', ts: Date.now() - 4e5, views: 4, duration: 'PT8M' }, { id: V5, title: 'Длинный ролик три', ts: Date.now() - 5e5, views: 3, duration: 'PT12M' }); f.stats.vids = 5; return f; };
const initMode = mode => `window.__d37YtLikeTest = { mode: ${JSON.stringify(mode)}, cid: ${JSON.stringify(CID)} };`;
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];

// ═══ Поддельные Google (экран разрешения) и YouTube Data API ═══
// G: { answer: 'grant' | 'deny' | 'noscope' | 'stay' (человек стоит на экране Google), quota, rate: '401' | 'video', liked: Set, J: журнал }
function mockGoogle(G) {
  G.J = []; G.liked = G.liked || new Set(); G.sbAuthorize = [];
  return {
    patterns: ['https://accounts.google.com/*', 'https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'],
    answer(req) {
      const u = new URL(req.url);
      if (req.url.startsWith(SB + '/auth/v1/authorize')) { G.sbAuthorize.push(Object.fromEntries(u.searchParams)); return null; }   // журнал входа; ответ — поддельный Supabase
      const json = (b, code = 200) => ({ code, body: b === undefined ? '' : JSON.stringify(b), headers: [...CORS, { name: 'Content-Type', value: 'application/json' }] });
      if (u.host === 'accounts.google.com') {
        // Chrome сам просит /favicon.ico у страницы-заглушки — это не переход на экран разрешения, в счёт 'auth' не идёт
        if (u.pathname !== '/o/oauth2/v2/auth') { G.J.push(['gother', u.pathname]); return { code: 404, body: '', headers: [{ name: 'Content-Type', value: 'text/plain' }] }; }
        const q = Object.fromEntries(u.searchParams);
        G.J.push(['auth', q]);
        if (G.answer === 'stay') return { code: 200, body: '<!doctype html><meta charset="utf-8"><title>Google (заглушка)</title><p>экран разрешения (заглушка проверки)</p>', headers: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] };
        const st = encodeURIComponent(q.state || '');
        const frag = G.answer === 'deny' ? `error=access_denied&state=${st}`
          : `state=${st}&access_token=${TOKEN}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent((G.answer === 'noscope' ? '' : SCOPE + ' ') + 'openid https://www.googleapis.com/auth/userinfo.email')}`;
        return { code: 302, body: '', headers: [{ name: 'Location', value: q.redirect_uri + '#' + frag }] };
      }
      if (!(u.host === 'oauth2.googleapis.com' || (u.host === 'www.googleapis.com' && /^\/youtube\/v3\/(videos\/(rate|getRating)|subscriptions)$/.test(u.pathname)))) return null;   // остальное — как в стенде
      if (req.method === 'OPTIONS') return { code: 204, body: '', headers: CORS };
      const auth = String(req.headers?.Authorization || req.headers?.authorization || '');
      // подписка (ytlike-2): subscriptions.list (mine, forChannelId) и subscriptions.insert; G.subbed — подписан ли «аккаунт YouTube»,
      // G.sub: 'quota' | 'forbidden' — ответ insert (квоту list в этой подделке не видит: ответ квоты проверяется на самом действии)
      if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/subscriptions') {
        const okA = auth === 'Bearer ' + TOKEN, q = Object.fromEntries(u.searchParams);
        if (req.method === 'GET') {
          G.J.push(['subList', q, okA]);
          if (!okA) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
          return json({ kind: 'youtube#subscriptionListResponse', pageInfo: { totalResults: G.subbed ? 1 : 0 }, items: G.subbed ? [{ kind: 'youtube#subscription', id: 'sub-test-1' }] : [] });
        }
        let body = null; try { body = JSON.parse(req.postData || 'null'); } catch (e) {}
        G.J.push(['subInsert', q, body, okA, req.method]);
        if (!okA) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
        if (G.sub === 'quota') return json({ error: { code: 403, message: 'quota', errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] } }, 403);
        if (G.sub === 'forbidden') return json({ error: { code: 400, errors: [{ domain: 'youtube.subscription', reason: 'subscriptionForbidden' }] } }, 400);
        if (G.subbed) return json({ error: { code: 400, errors: [{ domain: 'youtube.subscription', reason: 'subscriptionDuplicate' }] } }, 400);
        G.subbed = true;
        return json({ kind: 'youtube#subscription', id: 'sub-test-1', snippet: { resourceId: body?.snippet?.resourceId || null } });
      }
      if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos/rate') {
        G.J.push(['rate', u.searchParams.get('id'), u.searchParams.get('rating'), auth === 'Bearer ' + TOKEN, req.method]);
        if (auth !== 'Bearer ' + TOKEN) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
        if (G.rate === '401') return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
        if (G.rate === 'video') return json({ error: { code: 403, errors: [{ domain: 'youtube.video', reason: 'videoRatingDisabled' }] } }, 403);
        if (G.quota) return json({ error: { code: 403, message: 'quota', errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded' }] } }, 403);
        if (u.searchParams.get('rating') === 'like') G.liked.add(u.searchParams.get('id')); else G.liked.delete(u.searchParams.get('id'));
        return { code: 204, body: '', headers: CORS };
      }
      if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos/getRating') {
        const ids = String(u.searchParams.get('id') || '').split(',');
        G.J.push(['getRating', ids, auth === 'Bearer ' + TOKEN]);
        if (auth !== 'Bearer ' + TOKEN) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
        return json({ kind: 'youtube#videoGetRatingResponse', items: ids.map(id => ({ videoId: id, rating: G.liked.has(id) ? 'like' : 'none' })) });
      }
      if (u.host === 'oauth2.googleapis.com') { G.J.push(['revoke']); return { code: 200, body: '', headers: CORS }; }
      return json({ error: { code: 404 } }, 404);
    },
  };
}
const count = (G, k) => G.J.filter(x => x[0] === k).length;
// нажать кнопку и узнать, ушло бы нажатие по ссылке (как раньше) — сама вкладка YouTube не открывается (журнал + отмена в самом конце)
const TAP = sel => `(() => { const a = document.querySelector(${JSON.stringify(sel)}); if (!a) return null; a.scrollIntoView({ block: 'center' });
  let prevented = null; const f = e => { prevented = e.defaultPrevented; e.preventDefault(); }; window.addEventListener('click', f);
  a.click(); window.removeEventListener('click', f); return { prevented, href: a.getAttribute('href'), target: a.getAttribute('target') }; })()`;
const TOAST = `(document.getElementById('xpToast')?.textContent || '')`;
// токен — только sessionStorage: проверить localStorage, адрес, консоль
const LEAK = `(() => { const t = ${JSON.stringify(TOKEN)}; const ls = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (String(localStorage.getItem(k)).includes(t) || k.includes(t)) ls.push(k); }
  return { ls, url: location.href.includes(t) || location.href.includes('access_token'), ss: String(sessionStorage.getItem('d37_ytl_tok') || '').includes(t) }; })()`;
const oldUser = (role, provider = 'email') => {
  const old = new Date(Date.now() - 60 * 864e5).toISOString();
  return { user: { id: ME, aud: 'authenticated', role: 'authenticated', email: 'yt.test@example.test', email_confirmed_at: old, created_at: old, app_metadata: { provider, providers: [provider] }, user_metadata: {}, identities: [{ id: 'i1', provider, identity_data: {}, created_at: old }] },
    profile: { id: ME, nick: 'Тестер', role } };
};
// вход почтой без окна (тестовые значения только для подделанного сервера)
// как человек: окно входа → почта → «Войти» (doGlobalLogin), тот же путь, что в auth-social-e2e (email)
const PASSWORD_LOGIN = `(async () => { openGlobalAuth('login'); for (let i = 0; i < 40 && !document.getElementById('gauthEmail'); i++) await new Promise(r => setTimeout(r, 100));
  document.getElementById('gauthEmail').value = 'yt.test@example.test'; document.getElementById('gauthPassword').value = 'test-only-123'; doGlobalLogin(); return true; })()`;
async function signedIn(c) { await c.ev(PASSWORD_LOGIN, true); const r = await c.until(`${SIGNED} && !!currentRole && !document.getElementById('globalAuthModal')?.classList.contains('open')`, 15000); await sleep(400); return r; }
const noOverflow = `document.documentElement.scrollWidth <= innerWidth + 1`;
// разрешение «уже есть» (как после экрана Google раньше: at — когда выдано). Кладём ПОСЛЕ входа: до входа сайт по праву стирает
// токен (token() без вошедшего = dropTok), а человек с таким токеном на деле уже вошёл
const presetTok = (c, agoMs) => c.ev(`sessionStorage.setItem('d37_ytl_tok', JSON.stringify({ t: ${JSON.stringify(TOKEN)}, exp: Date.now() + 9e5, u: ${JSON.stringify(ME)}, at: Date.now() - ${agoMs} })); !!D37YtLike._test.token()`);
// window.open (вкладка YouTube) — не открываем по-настоящему: журнал и «браузер не дал» (null), как на телефоне без свежего нажатия
const NOPOPUP = `window.__opened = []; window.open = function (u) { window.__opened.push(String(u)); return null; };`;
// ответ videos.rate через 6,5 с (медленная сеть телефона): Chrome «остужает» нажатие через ~5 с
const DELAY_RATE = `(() => { const of = window.fetch; window.fetch = function (u, o) { if (String(u && u.url || u).includes('/youtube/v3/videos/rate')) return new Promise(r => setTimeout(r, 6500)).then(() => of.call(window, u, o)); return of.apply(this, arguments); }; })();`;
// сбой сети на videos.rate (запрос не уходит): счётчик попыток
const NETFAIL = `(() => { const of = window.fetch; window.__rateCalls = 0; window.fetch = function (u, o) { if (String(u && u.url || u).includes('/youtube/v3/videos/rate')) { window.__rateCalls++; return Promise.reject(new TypeError('Failed to fetch')); } return of.apply(this, arguments); }; })();`;
// «новая вкладка»: при следующем заходе на сайт (не на Google) — чистый sessionStorage (localStorage общий, вход остаётся)
const NEWTAB = `try { if (location.port && localStorage.getItem('ytl_newtab') === '1') { localStorage.removeItem('ytl_newtab'); sessionStorage.clear(); } } catch (e) {}`;
const ON_GOOGLE = `location.host === 'accounts.google.com'`;
const authN = G => G.J.filter(x => x[0] === 'auth').length;
// Chrome сам пишет в журнал каждый ответ 4xx (из JS не спрятать): ровно столько строк про videos.rate, сколько ждали, других ошибок нет
const onlyRateErrs = (errs, code, nWant) => { const r = errs.filter(e => new RegExp('status of ' + code + '.*googleapis\\.com/youtube/v3/videos/rate').test(e)); return r.length === nWant && errs.length === nWant; };

(async () => {
  const site = await startSite();
  const B = site.base;
  console.log('ytlike-e2e: ' + B);
  try {
    // ═══ (off) как на сайте сейчас ═══
    if (want('off')) for (const [w, h, ph, theme] of [[390, 844, true, 'dark'], [1920, 1080, false, 'light']]) {
      console.log(`— флаг 'off' (откат), ${w}×${h} ${theme}: всё как раньше` + (process.env.BASE ? ' — ' + process.env.BASE : ''));
      const G = {}, X = mockGoogle(G);
      const { user, profile } = oldUser('admin');
      const S = { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED };
      // флаг выключен явно (с 26.11 на сайте 'test' с ID клиента; это сечение проверяет «off» — откат одной строкой)
      const c = await chrome({ w, h, phone: ph, theme, S, extra: X, init: initMode('off') });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        const sel = `.sh-item[data-id="${V2}"] .sh-like`;
        await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 10000);
        ok(await c.ev(`D37YtLike.mode()`) === 'off', "флаг 'off' — выключено");
        const t1 = await c.ev(TAP(sel), true);
        ok(t1 && t1.prevented === false && t1.target === '_blank' && /youtube\.com\/shorts\//.test(t1.href), 'гость: 👍 — обычная ссылка на YouTube', t1);
        ok(await c.ev(`D37VLike.marked(${JSON.stringify(V2)})`), 'гость: ✓ в этом браузере, как раньше');
        ok(await signedIn(c), 'вход (админ)');
        const t2 = await c.ev(TAP(sel), true);
        ok(t2 && t2.prevented === false, 'админ при off: тоже ссылка', t2);
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const t3 = await c.ev(TAP('#mLike'), true);
        ok(t3 && t3.prevented === false && /watch\?v=/.test(t3.href), 'окно ролика: ссылка', t3);
        ok(!G.J.length, 'к Google и YouTube API — ни одного запроса', G.J);
        ok(!(await c.ev(`!!document.querySelector('.ytl-on,.ytl-busy,[data-vlike][aria-pressed]')`)), 'кнопки не тронуты (нет новых классов)');
        await c.shot(`ytl-off-${w}x${h}-${theme}`);
        ok(!c.errs.length, 'off: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (shorts) гость в Shorts → вход → разрешение → тот же Short → лайк ═══
    if (want('shorts')) {
      console.log('— Shorts (on): гость → вход Google → разрешение YouTube → лайк');
      const G = { answer: 'grant' }, X = mockGoogle(G);
      const S = { providers: { google: true }, user: newGoogleUser(), profile: newProfile(), feed: FEED };
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S, extra: X, init: initMode('on') });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        const sel = `.sh-item[data-id="${V2}"] .sh-like`;
        ok(await c.until(VISIBLE(sel), 10000), 'у Short видна «👍 Лайк на YouTube» (там же, где была)');
        await c.shot('ytl-shorts-1');
        const t = await c.ev(TAP(sel), true);
        ok(t?.prevented === true, 'нажатие взял настоящий лайк (ссылка не открылась)', t);
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), 'гость → то же окно входа');
        const it = await c.ev(`D37Intent.pending()`);
        ok(it?.kind === 'ytlike' && it.args?.id === V2 && it.hash === '#/shorts/' + V2, 'запомнено: лайк этому Short и место в ленте', it);
        ok(/👍/.test(await c.ev(`document.getElementById('gauthIntent')?.textContent || ''`)), 'в окне сказано, что 👍 поставится сам');
        ok(!G.J.length, 'до входа к Google за правом YouTube не ходили');
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вошли через «Google»');
        ok(G.sbAuthorize.length === 1 && !G.sbAuthorize[0].scopes && !/youtube/i.test(JSON.stringify(G.sbAuthorize[0])), 'вход Google (Supabase) — без права YouTube', G.sbAuthorize);
        if (await c.until(`!!document.querySelector('.wlc-ov')`, 8000)) { await c.ev(`(() => { document.querySelector('.wlc-year').value = String(new Date().getFullYear() - 25); return true; })()`); await c.click('.wlc-ok'); }
        ok(await c.until(`${READY} && ${SIGNED} && !!document.querySelector(${JSON.stringify(sel)})?.classList.contains('ytl-on')`, 30000), 'после разрешения — залитая 👍 (без второго нажатия)');
        const auth = G.J.filter(x => x[0] === 'auth').map(x => x[1]);
        ok(auth.length === 1 && auth[0].scope === SCOPE && auth[0].response_type === 'token' && auth[0].include_granted_scopes === 'true' && auth[0].client_id === CID && auth[0].redirect_uri === B + '/' && /^ytl\./.test(auth[0].state || ''), 'экран разрешения Google: одно право youtube.force-ssl, токен, include_granted_scopes', auth);
        const rates = G.J.filter(x => x[0] === 'rate');
        ok(rates.length === 1 && rates[0][1] === V2 && rates[0][2] === 'like' && rates[0][3] && rates[0][4] === 'POST', 'videos.rate вызван ОДИН раз: этот Short, rating=like, токен в заголовке', rates);
        ok(/👍 Лайк поставлен на YouTube/.test(await c.ev(TOAST)), 'строка «👍 Лайк поставлен на YouTube»', await c.ev(TOAST));
        const st = await c.ev(`({ hash: D37Route.hash(), route: document.body.dataset.route, units: D37YtLike._test.stats.units })`);
        ok(st.route === 'shorts' && st.hash === '#/shorts/' + V2, 'та же лента, тот же Short', st);
        const lk = await c.ev(LEAK);
        ok(!lk.ls.length && !lk.url && lk.ss, 'токен — только в sessionStorage: не в localStorage, не в адресе', lk);
        ok(!c.logs.some(l => l.includes(TOKEN)), 'токена нет в консоли');
        console.log(`    квота за этот лайк: ${st.units} ед. (rate 50 + getRating 1 за ленту)`);
        await c.shot('ytl-shorts-2-done');
        ok(!c.errs.length, 'Shorts: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (video) 'test': гость — ссылка; админ — окно ролика на 42-й секунде ═══
    if (want('video')) {
      console.log('— окно ролика (test): гость — ссылка, админ — лайк с той же секунды');
      const G = { answer: 'grant' }, X = mockGoogle(G);
      const { user, profile } = oldUser('admin');
      const S = { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED };
      const c = await chrome({ w: 1920, h: 1080, theme: 'light', S, extra: X, init: initMode('test') });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const g = await c.ev(TAP('#mLike'), true);
        ok(g?.prevented === false, "гость при 'test': ссылка, как раньше", g);
        await c.ev(`closeModal()`, true);
        ok(await signedIn(c), 'вход почтой (админ)');
        ok(!G.J.length && !G.sbAuthorize.length, 'вход — без экрана Google и без права YouTube');
        await c.ev(`(async () => { document.body.style.minHeight = '3000px'; scrollTo(0, 500); openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', ''); })()`, true);
        await c.until(`document.getElementById('modal').classList.contains('open') && !!document.querySelector('#mVid iframe')`, 8000);
        await c.ev(`(() => { const fr = document.querySelector('#mVid iframe'); window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 42.4 } }), origin: 'https://www.youtube.com', source: fr.contentWindow })); return true; })()`);
        const t = await c.ev(TAP('#mLike'), true);
        ok(t?.prevented === true, 'админ: нажатие взял настоящий лайк', t);
        ok(await c.until(`${READY} && ${SIGNED} && !!document.getElementById('mLike')?.classList.contains('ytl-on')`, 30000), 'вернулись — 👍 в окне ролика залита');
        const back = await c.ev(`({ open: document.getElementById('modal').classList.contains('open'), vid: modalVidId, src: document.querySelector('#mVid iframe')?.getAttribute('src') || '', y: scrollY, path: location.pathname, hash: location.hash })`);
        ok(back.open && back.vid === V3 && /[?&]start=42(&|$)/.test(back.src), 'тот же ролик с 42-й секунды', back);
        ok(back.path === '/' && !back.hash, 'адрес чистый (фрагмент Google стёрт)', back);
        ok(count(G, 'rate') === 1 && G.J.find(x => x[0] === 'rate')[2] === 'like', 'videos.rate: like, один раз', G.J);
        await c.shot('ytl-video-1-liked');
        await sleep(400);
        const t2 = await c.ev(TAP('#mLike'), true);
        ok(t2?.prevented === true && await c.until(`!document.getElementById('mLike').classList.contains('ytl-on')`, 8000), 'второе нажатие — лайк снят', t2);
        ok(G.J.filter(x => x[0] === 'rate').map(x => x[2]).join() === 'like,none' && count(G, 'auth') === 1, 'rating=none, повторного экрана Google нет', G.J);
        // перезагрузка: разрешение ещё живо (sessionStorage) — getRating покажет, что YouTube знает
        G.liked.add(V3);
        await c.ev(`window.__preReload = 1`);
        await c.send('Page.reload');
        await c.until(`!window.__preReload && ${READY} && ${SIGNED} && !!currentRole`, 20000);
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        ok(await c.until(`!!document.getElementById('mLike')?.classList.contains('ytl-on')`, 10000), 'после перезагрузки: getRating → залитая 👍 (аккаунт YouTube уже лайкнул)');
        ok(G.J.some(x => x[0] === 'getRating' && x[1].includes(V3) && x[2]), 'videos.getRating с токеном в заголовке', G.J.filter(x => x[0] === 'getRating'));
        const lk = await c.ev(LEAK);
        ok(!lk.ls.length && !lk.url, 'токена нет в localStorage и адресе', lk);
        ok(!c.logs.some(l => l.includes(TOKEN)), 'токена нет в консоли');
        await c.shot('ytl-video-2-reload');
        ok(!c.errs.length, 'окно ролика: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
      // обычный человек при 'test' — ссылка
      const G2 = {}, X2 = mockGoogle(G2), u2 = oldUser('user');
      const c2 = await chrome({ w: 1920, h: 1080, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: u2.user, profile: u2.profile, feed: FEED }, extra: X2, init: initMode('test') });
      try {
        await c2.send('Page.navigate', { url: B + '/' });
        await c2.until(READY);
        ok(await signedIn(c2), 'вход почтой (не админ)');
        await c2.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const t = await c2.ev(TAP('#mLike'), true);
        ok(t?.prevented === false && !G2.J.length, "не админ при 'test': ссылка, к Google не ходим", { t, J: G2.J });
        ok(!c2.errs.length, 'не админ: ошибок нет', c2.errs);
      } finally { await c2.close(); }
    }

    // ═══ (deny) отказ на экране Google; снятая галочка YouTube ═══
    if (want('deny')) for (const answer of ['deny', 'noscope']) {
      console.log(`— отказ (${answer === 'deny' ? 'кнопка «Отмена»' : 'снята галочка YouTube'})`);
      const G = { answer }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'light', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await c.ev(TAP('#mLike'), true);
        ok(await c.until(`${READY} && ${SIGNED} && /Без разрешения Google/.test(${TOAST})`, 30000), 'вернулись: строка «без разрешения — лайк на самом YouTube»', await c.ev(TOAST).catch(() => ''));
        ok(/Нажми 👍 ещё раз — откроется YouTube/.test(await c.ev(TOAST)), 'и что делать: «нажми ещё раз — откроется YouTube»');
        ok(!count(G, 'rate'), 'videos.rate не вызывался');
        ok(await c.ev(`document.getElementById('modal').classList.contains('open') && modalVidId === ${JSON.stringify(V3)}`), 'тот же ролик открыт');
        const t = await c.ev(TAP('#mLike'), true);
        ok(t?.prevented === false && count(G, 'auth') === 1, 'следующее нажатие — ссылка на YouTube (не мёртвая кнопка, не круг через Google)', { t, auth: count(G, 'auth') });
        ok(!(await c.ev(LEAK)).ls.length, 'в localStorage токена нет');
        await c.shot(`ytl-${answer}`);
        ok(!c.errs.length, 'отказ: ошибок нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (quota) кончилась квота YouTube ═══
    if (want('quota')) {
      console.log('— квота YouTube кончилась');
      const G = { answer: 'grant', quota: true }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 1920, h: 1080, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await c.ev(TAP('#mLike'), true);
        ok(await c.until(`${READY} && ${SIGNED} && /закончились/.test(${TOAST})`, 30000), 'строка «лайки с сайта на сегодня закончились»', await c.ev(TOAST).catch(() => ''));
        const q = await c.ev(`({ day: localStorage.getItem('d37_ytl_quota'), pt: D37YtLike._test.ptDay(), why: D37YtLike.why() })`);
        ok(q.day === q.pt && q.why === 'quota', 'запомнено до полуночи по Тихоокеанскому времени', q);
        const t = await c.ev(TAP('#mLike'), true);
        ok(t?.prevented === false && count(G, 'rate') === 1, 'дальше — ссылка, rate больше не зовём', { t, rate: count(G, 'rate') });
        await c.ev(TAP('#mLike'), true);
        ok(count(G, 'rate') === 1 && count(G, 'getRating') <= 1, 'нет потока запросов', G.J.map(x => x[0]));
        // Chrome сам пишет в журнал сети любой ответ 4xx («Failed to load resource … 403») — это ответ YouTube «квота кончилась», которого
        // мы и ждём (из JS его не спрятать); других строк быть не должно, и 403 — ровно одна (нет потока запросов)
        const q403 = c.errs.filter(e => /status of 403.*googleapis\.com\/youtube\/v3\/videos\/rate/.test(e));
        ok(q403.length === 1 && c.errs.length === 1, 'квота: в журнале только одна строка Chrome о 403 от YouTube, ошибок сайта нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (inapp) встроенный браузер ═══
    if (want('inapp')) {
      console.log('— встроенный браузер Instagram');
      const G = {}, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0';
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on'), ua });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const t = await c.ev(TAP('#mLike'), true);
        ok(t?.prevented === false && !G.J.length, 'ссылка на YouTube, к Google не ходим', { t, J: G.J });
        ok(/встроенном браузере/.test(await c.ev(TOAST)) && /Chrome или Safari/.test(await c.ev(TOAST)), 'строка «открой в Chrome или Safari»', await c.ev(TOAST));
        ok(!c.errs.length, 'встроенный браузер: ошибок нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (card) карточка ленты на главной: 'on', вошёл ═══
    if (want('card')) for (const [w, h, ph, theme] of [[390, 844, true, 'dark'], [1920, 1080, false, 'light']]) {
      console.log(`— карточка ленты (on), ${w}×${h} ${theme}: вошёл → 👍 на карточке → Google → то же место → лайк`);
      const G = { answer: 'grant' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w, h, phone: ph, theme, S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED_YT }, extra: X, init: initMode('on') + NOPOPUP });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        const sel = `.vcard a.vlike[data-vlike="${V4}"]`;
        ok(await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 15000), 'в ленте есть карточка с «Лайк на YouTube»', await c.ev(`document.querySelectorAll('.vcard').length`));
        await c.ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); true`);
        await sleep(300);
        const before = await c.ev(`({ y: Math.round(scrollY), hash: location.hash, route: document.body.dataset.route || '' })`);
        const t = await c.ev(TAP(sel), true);
        ok(t?.prevented === true, 'нажатие на карточке взял настоящий лайк (ссылка не открылась)', t);
        ok(await c.until(`${READY} && ${SIGNED} && !!document.querySelector(${JSON.stringify(sel)})?.classList.contains('ytl-on')`, 30000), 'вернулись — 👍 на этой карточке залита', await c.ev(`({ n: document.querySelectorAll(${JSON.stringify(sel)}).length, all: [...document.querySelectorAll('a[data-vlike="${V4}"]')].map(a => a.className + '|' + (a.closest('[class]')?.parentElement?.className || '')), tok: !!D37YtLike._test.token(), why: D37YtLike.why(), rating: [...D37YtLike._test.rating], ss: !!sessionStorage.getItem('d37_ytl_tok') })`).catch(e => String(e)));
        const after = await c.ev(`({ y: Math.round(scrollY), hash: location.hash, route: document.body.dataset.route || '', toast: ${TOAST} })`);
        ok(after.hash === before.hash && after.route === before.route && Math.abs(after.y - before.y) < 200, 'та же главная, та же прокрутка (±200 px)', { before, after });
        const rates = G.J.filter(x => x[0] === 'rate');
        ok(authN(G) === 1 && rates.length === 1 && rates[0][1] === V4 && rates[0][2] === 'like', 'один экран Google, videos.rate(like) ровно этому ролику', G.J.map(x => x.slice(0, 3)));
        ok(/👍 Лайк поставлен на YouTube/.test(after.toast), 'строка «👍 Лайк поставлен на YouTube»', after.toast);
        ok(!(await c.ev(`window.__opened.length`)), 'вкладка YouTube не открывалась');
        // лента перерисовалась (свежий ответ /api/feed после кэша — новые карточки): 👍 на новой карточке тоже залита, getRating не нужен
        const gr0 = count(G, 'getRating');
        await c.ev(`renderCurrentVids(); true`);
        ok(await c.until(`!!document.querySelector(${JSON.stringify(sel)})?.classList.contains('ytl-on')`, 3000) && count(G, 'getRating') === gr0, 'лента перерисована — 👍 на новой карточке всё ещё залита', { gr0, gr: count(G, 'getRating') });
        await c.shot(`ytl-card-${w}x${h}-${theme}`);
        ok(!c.errs.length, 'карточка: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (back) экран Google открыт — человек нажал «Назад» ═══
    if (want('back')) {
      console.log('— «Назад» с экрана Google: сам на Google больше не уходит');
      const G = { answer: 'stay' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        const sel = `.sh-item[data-id="${V2}"] .sh-like`;
        await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 10000);
        await c.ev(`window.__beforeGoogle = 1; true`);
        ok((await c.ev(TAP(sel), true))?.prevented === true, 'нажатие → экран Google');
        ok(await c.until(ON_GOOGLE, 10000) && authN(G) === 1, 'на экране Google (заглушка), запрос один', authN(G));
        try { await c.ev(`history.back(); true`); } catch (e) {}
        ok(await c.until(`location.port !== '' && ${READY} && ${SIGNED}`, 20000), '«Назад» — снова сайт');
        const how = await c.ev(`({ cache: window.__beforeGoogle === 1, nav: performance.getEntriesByType('navigation')[0]?.type })`);
        console.log(`    страница вернулась ${how.cache ? 'из кэша браузера (bfcache)' : 'загрузкой заново (' + how.nav + ')'}`);
        ok(await c.until(`/не дано/.test(${TOAST}) && /снова откроется экран Google/.test(${TOAST})`, 10000), 'строка «разрешение не дано — нажми ещё раз, снова откроется экран Google»', await c.ev(TOAST));
        await sleep(6000);
        ok(authN(G) === 1 && await c.ev(`location.port !== ''`), 'за 6 с сам на Google не ушёл', authN(G));
        ok(!(await c.ev(`D37Intent.pending()`))?.kind, 'отложенное для Google забыто');
        ok(await c.ev(`D37Route.hash() === '#/shorts/${V2}'`), 'человек там же, в ленте Shorts');
        await c.shot('ytl-back-1');
        await c.ev(`window.__preReload = 1`);
        await c.send('Page.reload');
        await c.until(`!window.__preReload && ${READY} && ${SIGNED}`, 20000);
        await sleep(6000);
        ok(authN(G) === 1 && await c.ev(`location.port !== ''`), 'перезагрузка — тоже без перехода на Google', authN(G));
        await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 10000);
        ok((await c.ev(TAP(sel), true))?.prevented === true && await c.until(ON_GOOGLE, 10000) && authN(G) === 2, 'новое нажатие — снова экран Google (как сказала строка)', authN(G));
        ok(!c.errs.length, '«Назад»: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (newtab) экран Google брошен, сайт открыт заново в новой вкладке ═══
    if (want('newtab')) {
      console.log('— экран Google брошен, сайт в новой вкладке в пределах 10 минут');
      const G = { answer: 'stay' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP + NEWTAB });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        const sel = `.sh-item[data-id="${V2}"] .sh-like`;
        await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 10000);
        await c.ev(`localStorage.setItem('ytl_newtab', '1'); true`);
        ok((await c.ev(TAP(sel), true))?.prevented === true && await c.until(ON_GOOGLE, 10000) && authN(G) === 1, 'нажатие → экран Google (брошен)');
        await c.send('Page.navigate', { url: B + '/' });
        ok(await c.until(`location.port !== '' && ${READY} && ${SIGNED}`, 20000), 'новая вкладка: сайт открылся, вход на месте');
        await sleep(8000);
        const st = await c.ev(`({ port: location.port, hash: D37Route.hash(), pend: D37Intent.pending(), stored: (JSON.parse(localStorage.getItem('d37_intent') || 'null') || {}).kind || null, toast: ${TOAST} })`);
        ok(authN(G) === 1 && st.port !== '', 'новая вкладка: на Google не ушла (без нажатия)', { auth: authN(G), st });
        ok(st.hash !== '#/shorts/' + V2 && !st.pend, 'новая вкладка: на старый Short не перенесла, отложенного другой вкладки не видит', st);
        ok(!/Лайк|лайк/.test(st.toast), 'новая вкладка: никаких строк про лайк', st.toast);
        await c.shot('ytl-newtab');
        ok(!c.errs.length, 'новая вкладка: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (r401) videos.rate ответил 401 ═══
    if (want('r401')) {
      console.log('— videos.rate: 401 (разрешение истекло / отозвано)');
      // getRating отвечает как обычно (иначе токен стёрся бы ещё при показе кнопки и нажатие сразу ушло бы на Google — тоже верно, но
      // здесь проверяем ответ самого videos.rate)
      const G = { answer: 'stay', rate: '401' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 1920, h: 1080, theme: 'light', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c) && await presetTok(c, 50 * 60e3), 'вход почтой (разрешение выдано 50 мин назад)');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await sleep(800);
        ok((await c.ev(TAP('#mLike'), true))?.prevented === true, '401: нажатие → videos.rate');
        ok(await c.until(`/Google спросит разрешение снова/.test(${TOAST})`, 10000) && !/откроется YouTube/.test(await c.ev(TOAST)), '401: строка «нажми ещё раз — Google спросит разрешение снова»', await c.ev(TOAST));
        ok(count(G, 'rate') === 1 && authN(G) === 0, '401: rate один раз, на Google сам не ушёл');
        ok((await c.ev(TAP('#mLike'), true))?.prevented === true && await c.until(ON_GOOGLE, 10000) && authN(G) === 1, '401: следующее нажатие — экран Google, как обещано');
        // Google выдаёт новый токен, а YouTube опять 401 — не ходить по кругу
        G.answer = 'grant';
        const e0 = c.errs.slice();
        try { await c.ev(`history.back(); true`); } catch (e) {}
        await c.until(`location.port !== '' && ${READY} && ${SIGNED}`, 20000);
        // страница вернулась из кэша браузера (bfcache) — Chrome заново присылает в журнал её прежние строки (тот же первый 401, запроса нет:
        // журнал заглушки это подтверждает); такие повторы не считаем новыми ошибками
        const replay = c.errs.slice(e0.length).filter(x => e0.includes(x)).length;
        await c.until(`/не дано/.test(${TOAST})`, 10000);
        await c.ev(`(async () => { if (!(document.getElementById('modal').classList.contains('open') && modalVidId === ${JSON.stringify(V3)})) openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', ''); await new Promise(r => setTimeout(r, 600)); return true; })()`, true);
        ok((await c.ev(TAP('#mLike'), true))?.prevented === true, '401 на свежем: нажатие → Google → назад');
        ok(await c.until(`location.port !== '' && ${READY} && ${SIGNED} && /откроется YouTube/.test(${TOAST})`, 30000), '401 на только что выданном токене: строка «нажми ещё раз — откроется YouTube»', await c.ev(TOAST).catch(() => ''));
        const n0 = { auth: authN(G), rate: count(G, 'rate') };
        ok(n0.auth === 2 && n0.rate === 2, '401 на свежем: Google ещё раз, rate ещё раз', n0);
        await c.until(`document.getElementById('modal').classList.contains('open') && !!document.getElementById('mLike')`, 8000);
        const t = await c.ev(TAP('#mLike'), true);
        await sleep(1500);
        ok(t?.prevented === false && authN(G) === 2 && count(G, 'rate') === 2, '401 на свежем: следующее нажатие — ссылка на YouTube (не круг через Google)', { t, auth: authN(G), rate: count(G, 'rate') });
        ok(count(G, 'rate') === 2 && onlyRateErrs(c.errs, 401, 2 + replay), '401: в журнале только строки Chrome о двух 401 от videos.rate (+ повтор журнала при возврате из bfcache: ' + replay + ')', { replay, errs: c.errs });
        await c.shot('ytl-r401');
      } finally { await c.close(); }
    }

    // ═══ (slow403) ролик не даёт лайк, ответ через 6,5 с ═══
    if (want('slow403')) {
      console.log('— ролик не даёт лайк (403 videoRatingDisabled), ответ через 6,5 с');
      const G = { answer: 'stay', rate: 'video' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP + DELAY_RATE });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c) && await presetTok(c, 20 * 60e3), 'вход почтой (разрешение выдано 20 мин назад)');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await sleep(800);
        const t1 = await c.ev(TAP('#mLike'), true);
        ok(t1?.prevented === true, 'первое нажатие — videos.rate', t1);
        ok(await c.until(`/не дал поставить лайк этому ролику/.test(${TOAST}) && /откроется YouTube/.test(${TOAST})`, 12000), 'через 6,5 с: строка «нажми ещё раз — откроется YouTube»', await c.ev(TOAST));
        const ua = await c.ev(`({ opened: window.__opened.length, active: !!navigator.userActivation?.isActive })`);
        console.log(`    вкладка YouTube сама: ${ua.opened ? 'пробовали открыть' : 'не открывали'} (нажатие «остыло»: isActive=${ua.active})`);
        const t2 = await c.ev(TAP('#mLike'), true);
        await sleep(1500);
        ok(t2?.prevented === false && /youtube\.com\/watch\?v=/.test(t2.href) && count(G, 'rate') === 1, 'второе нажатие — ссылка на YouTube, rate снова не зовём', { t2, rate: count(G, 'rate') });
        const t3 = await c.ev(TAP('#mLike'), true);
        await sleep(1500);
        ok(t3?.prevented === false && count(G, 'rate') === 1, 'третье — тоже ссылка (ролик лайк не даёт), квоту не тратим', { t3, rate: count(G, 'rate'), units: await c.ev(`D37YtLike._test.stats.units`) });
        ok(onlyRateErrs(c.errs, 403, 1), 'в журнале только одна строка Chrome о 403 от videos.rate', c.errs);
        await c.shot('ytl-slow403');
      } finally { await c.close(); }
    }

    // ═══ (net2) два сбоя сети подряд ═══
    if (want('net2')) {
      console.log('— два сбоя сети подряд');
      const G = { answer: 'stay' }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const c = await chrome({ w: 800, h: 600, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP + NETFAIL });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c) && await presetTok(c, 20 * 60e3), 'вход почтой (разрешение выдано 20 мин назад)');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await sleep(800);
        ok((await c.ev(TAP('#mLike'), true))?.prevented === true, 'сбой 1: нажатие → videos.rate');
        ok(await c.until(`/Не получилось связаться с YouTube/.test(${TOAST})`, 8000), 'сбой 1: строка «не получилось связаться»', await c.ev(TOAST));
        const opened1 = await c.ev(`window.__opened.length`);
        console.log(`    сбой 1: ${opened1 ? 'вкладку YouTube пробовали открыть — браузер не дал (null)' : 'вкладку не пробовали открыть'}`);
        ok(/откроется YouTube/.test(await c.ev(TOAST)), 'сбой 1: и обещание «нажми ещё раз — откроется YouTube»');
        const t2 = await c.ev(TAP('#mLike'), true);
        ok(t2?.prevented === false && await c.ev(`window.__rateCalls`) === 1, 'после сбоя 1: следующее нажатие — ссылка (как обещано)', t2);
        ok((await c.ev(TAP('#mLike'), true))?.prevented === true, 'потом — снова попытка');
        await sleep(1200);
        ok(await c.ev(`window.__rateCalls`) === 2 && await c.ev(`D37YtLike.why()`) === 'broken', 'сбой 2: дальше ссылка до конца визита', { calls: await c.ev(`window.__rateCalls`), why: await c.ev(`D37YtLike.why()`) });
        const t4 = await c.ev(TAP('#mLike'), true);
        ok(t4?.prevented === false && await c.ev(`window.__rateCalls`) === 2, 'после сбоя 2: ссылка, запросов больше нет', t4);
        ok(!c.errs.length, 'сеть: ошибок в консоли нет', c.errs);
        await c.shot('ytl-net2');
      } finally { await c.close(); }
    }

    // ═══ ПОДПИСКА (ytlike-2, владелец 26.11: «а с подпиской так можно сделать? Как с лайками») ═══
    const CH = 'UCztYAfPrieiG6kI93yE-Hdg', CH_URL = 'https://www.youtube.com/@Dan4ik37Yt';
    const SUBBTN = '#modal .modal-act-yt', HERO = '.hero-btn.is-yt';
    const subTxt = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '')`;
    const SUBBED = sel => `/✓ Ты подписан/.test(${subTxt(sel)})`;
    const onlyErrs = (errs, re, nWant) => errs.filter(e => re.test(e)).length === nWant && errs.length === nWant;
    const at42 = `(() => { const fr = document.querySelector('#mVid iframe'); window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 42.4 } }), origin: 'https://www.youtube.com', source: fr.contentWindow })); return true; })()`;

    // (sub) 'on', телефон: гость в окне ролика на 42-й секунде → «▶ Подписаться на YouTube» → вход → разрешение → тот же ролик → подписан
    if (want('sub')) {
      console.log('— подписка (on), 390×844 тёмная: гость в окне ролика → вход Google → разрешение YouTube → тот же ролик → подписан');
      const G = { answer: 'grant' }, X = mockGoogle(G);
      const S = { providers: { google: true }, user: newGoogleUser(), profile: newProfile(), feed: FEED };
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S, extra: X, init: initMode('on') + NOPOPUP });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await c.until(`document.getElementById('modal').classList.contains('open') && !!document.querySelector('#mVid iframe')`, 8000);
        await c.ev(at42);
        ok(await c.until(VISIBLE(SUBBTN), 5000), 'в окне ролика видна «▶ Подписаться на YouTube» (там же, где была)');
        await c.shot('ytsub-1-guest');
        const t = await c.ev(TAP(SUBBTN), true);
        ok(t?.prevented === true, 'нажатие взяла настоящая подписка (ссылка не открылась)', t);
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), 'гость → то же окно входа');
        const it = await c.ev(`D37Intent.pending()`);
        ok(it?.kind === 'ytsub' && it.args?.g === 1 && it.media?.id === V3, 'запомнено: подписка и ролик (D37Intent, та же система)', it);
        ok(/подписка/.test(await c.ev(`document.getElementById('gauthIntent')?.textContent || ''`)), 'в окне входа сказано, что подписка оформится сама');
        ok(!G.J.length, 'до входа к Google и YouTube API не ходили');
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вошли через «Google»');
        ok(G.sbAuthorize.length === 1 && !G.sbAuthorize[0].scopes && !/youtube/i.test(JSON.stringify(G.sbAuthorize[0])), 'вход Google (Supabase) — без права YouTube', G.sbAuthorize);
        if (await c.until(`!!document.querySelector('.wlc-ov')`, 8000)) { await c.ev(`(() => { document.querySelector('.wlc-year').value = String(new Date().getFullYear() - 25); return true; })()`); await c.click('.wlc-ok'); }
        ok(await c.until(`${READY} && ${SIGNED} && ${SUBBED(SUBBTN)}`, 30000), 'после разрешения — «✓ Ты подписан» в окне ролика (без второго нажатия)', await c.ev(subTxt(SUBBTN)).catch(() => ''));
        const auth = G.J.filter(x => x[0] === 'auth').map(x => x[1]);
        ok(auth.length === 1 && auth[0].scope === SCOPE && auth[0].response_type === 'token' && auth[0].include_granted_scopes === 'true' && auth[0].client_id === CID && /^ytl\./.test(auth[0].state || ''), 'тот же экран разрешения Google: одно право youtube.force-ssl', auth);
        const ins = G.J.filter(x => x[0] === 'subInsert'), lst = G.J.filter(x => x[0] === 'subList');
        ok(ins.length === 1 && ins[0][2]?.snippet?.resourceId?.channelId === CH && ins[0][2].snippet.resourceId.kind === 'youtube#channel' && ins[0][1].part === 'snippet' && ins[0][3] && ins[0][4] === 'POST', 'subscriptions.insert ОДИН раз: канал @Dan4ik37Yt, токен в заголовке', ins);
        ok(lst.length >= 1 && lst.every(x => x[1].mine === 'true' && x[1].forChannelId === CH && x[2]) && G.J.findIndex(x => x[0] === 'subList') < G.J.findIndex(x => x[0] === 'subInsert'), 'сначала subscriptions.list (mine, только этот канал), потом insert', lst);
        const back = await c.ev(`({ open: document.getElementById('modal').classList.contains('open'), vid: modalVidId, src: document.querySelector('#mVid iframe')?.getAttribute('src') || '', path: location.pathname, hash: location.hash, toast: ${TOAST} })`);
        ok(back.open && back.vid === V3 && /[?&]start=42(&|$)/.test(back.src), 'тот же ролик с 42-й секунды', back);
        ok(back.path === '/' && !back.hash, 'адрес чистый (фрагмент Google стёрт)', back);
        ok(/✓ Ты подписан на канал на YouTube/.test(back.toast), 'строка «✓ Ты подписан на канал на YouTube»', back.toast);
        ok(await c.ev(SUBBED(HERO)), 'и на главной кнопка «Подписаться» тоже стала «✓ Ты подписан»', await c.ev(subTxt(HERO)));
        const lk = await c.ev(LEAK);
        ok(!lk.ls.length && !lk.url && lk.ss, 'токен — только в sessionStorage: не в localStorage, не в адресе', lk);
        ok(!c.logs.some(l => l.includes(TOKEN)), 'токена нет в консоли');
        await c.shot('ytsub-2-done');
        const t2 = await c.ev(TAP(SUBBTN), true);
        ok(t2?.prevented === false && t2.href === CH_URL && t2.target === '_blank' && G.J.filter(x => x[0] === 'subInsert').length === 1, 'второе нажатие на «✓ Ты подписан» — открывает канал (отписки нет), insert не зовём', t2);
        console.log(`    квота за подписку: ${await c.ev(`D37YtLike._test.stats.units`)} ед. (list 1 + insert 50)`);
        ok(!c.errs.length, 'подписка: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // (subtest) 'test', 1920 светлая: гость — ссылка; админ, уже подписан — «✓» без insert; обычный человек — ссылка
    if (want('subtest')) {
      console.log("— подписка ('test'), 1920×1080 светлая: гость — ссылка; админ уже подписан — ✓ без insert; не админ — ссылка");
      const G = { answer: 'grant', subbed: true }, X = mockGoogle(G);
      const { user, profile } = oldUser('admin');
      const c = await chrome({ w: 1920, h: 1080, theme: 'light', S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('test') });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        const h0 = await c.ev(TAP(HERO), true);
        ok(h0?.prevented === false && /sub_confirmation=1/.test(h0.href), "гость при 'test': «Подписаться» на главной — ссылка, как раньше", h0);
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const g = await c.ev(TAP(SUBBTN), true);
        ok(g?.prevented === false && /sub_confirmation=1/.test(g.href) && !G.J.length, "гость при 'test': и в окне ролика — ссылка, к Google не ходим", { g, J: G.J });
        ok(!(await c.ev(`!!document.querySelector('[data-ytsub],.ytl-on,.ytl-busy')`)), 'гость: кнопки не тронуты');
        await c.ev(`closeModal()`, true);
        ok(await signedIn(c) && await presetTok(c, 10 * 60e3), 'вход почтой (админ), разрешение выдано 10 мин назад');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        ok(await c.until(SUBBED(SUBBTN), 10000), 'уже подписан на YouTube: «✓ Ты подписан» (subscriptions.list)', await c.ev(subTxt(SUBBTN)));
        ok(await c.ev(SUBBED(HERO)), 'на главной — тоже ✓');
        const t = await c.ev(TAP(SUBBTN), true);
        ok(t?.prevented === false && t.href === CH_URL, '«✓ Ты подписан» — ссылка на канал', t);
        ok(!G.J.some(x => x[0] === 'subInsert') && G.J.filter(x => x[0] === 'subList').length === 1 && authN(G) === 0, 'insert не вызывался, list — один раз, экрана Google не было', G.J.map(x => x[0]));
        await c.shot('ytsub-test-admin-subbed');
        ok(!c.errs.length, "'test' админ: ошибок нет", c.errs);
      } finally { await c.close(); }
      const G2 = {}, X2 = mockGoogle(G2), u2 = oldUser('user');
      const c2 = await chrome({ w: 1920, h: 1080, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: u2.user, profile: u2.profile, feed: FEED }, extra: X2, init: initMode('test') });
      try {
        await c2.send('Page.navigate', { url: B + '/' });
        await c2.until(READY);
        ok(await signedIn(c2), 'вход почтой (не админ)');
        await c2.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        const t = await c2.ev(TAP(SUBBTN), true);
        ok(t?.prevented === false && /sub_confirmation=1/.test(t.href) && !G2.J.length, "не админ при 'test': подписка — ссылка, к Google не ходим", { t, J: G2.J });
        ok(!c2.errs.length, 'не админ: ошибок нет', c2.errs);
      } finally { await c2.close(); }
    }

    // (subfall) отказ на экране Google, квота, YouTube отказал (свой канал / лимит), встроенный браузер → ссылка и одна строка
    if (want('subfall')) for (const [kind, w, h, ph, theme] of [['deny', 390, 844, true, 'light'], ['quota', 1920, 1080, false, 'dark'], ['forbidden', 800, 600, false, 'dark'], ['inapp', 390, 844, true, 'dark']]) {
      console.log(`— подписка, запасной путь «${kind}» (${w}×${h} ${theme})`);
      const G = { answer: kind === 'deny' ? 'deny' : 'stay', sub: kind === 'quota' || kind === 'forbidden' ? kind : undefined }, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const ua = kind === 'inapp' ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0' : undefined;
      const c = await chrome({ w, h, phone: ph, theme, S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('on') + NOPOPUP, ua });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        ok(await signedIn(c), 'вход почтой');
        if (kind === 'quota' || kind === 'forbidden') ok(await presetTok(c, 20 * 60e3), 'разрешение выдано 20 мин назад');
        await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
        await sleep(800);
        const t1 = await c.ev(TAP(SUBBTN), true);
        if (kind === 'deny') {
          ok(t1?.prevented === true, 'нажатие → экран Google', t1);
          ok(await c.until(`${READY} && ${SIGNED} && /Без разрешения Google сайт не подписывает/.test(${TOAST})`, 30000), 'вернулись: «без разрешения — подписка на самом YouTube»', await c.ev(TOAST).catch(() => ''));
          ok(/Нажми «Подписаться» ещё раз — откроется YouTube/.test(await c.ev(TOAST)), 'и что делать: «нажми ещё раз — откроется YouTube»');
          ok(await c.ev(`document.getElementById('modal').classList.contains('open') && modalVidId === ${JSON.stringify(V3)}`), 'тот же ролик открыт');
        } else if (kind === 'inapp') {
          ok(t1?.prevented === false && !G.J.length, 'встроенный браузер: ссылка, к Google не ходим', { t1, J: G.J });
          ok(/встроенном браузере/.test(await c.ev(TOAST)) && /подписка/.test(await c.ev(TOAST)) && /Chrome или Safari/.test(await c.ev(TOAST)), 'строка «открой в Chrome или Safari»', await c.ev(TOAST));
        } else {
          ok(t1?.prevented === true, 'нажатие → subscriptions.list → insert', t1);
          const re = kind === 'quota' ? /Подписки с сайта на сегодня закончились/ : /не дал подписаться/;
          ok(await c.until(`${re}.test(${TOAST})`, 10000), kind === 'quota' ? 'строка «подписки с сайта на сегодня закончились»' : 'строка «YouTube не дал подписаться с сайта»', await c.ev(TOAST));
          if (kind === 'quota') ok(await c.ev(`D37YtLike.why()`) === 'quota', 'запомнено до полуночи по Тихоокеанскому времени');
        }
        const t2 = await c.ev(TAP(SUBBTN), true);
        await sleep(800);
        ok(t2?.prevented === false && /sub_confirmation=1/.test(t2.href) && G.J.filter(x => x[0] === 'subInsert').length <= 1 && authN(G) <= 1, 'следующее нажатие — ссылка на YouTube (не мёртвая кнопка, без повторных запросов)', { t2, J: G.J.map(x => x[0]) });
        ok(!(await c.ev(LEAK)).ls.length, 'в localStorage токена нет');
        await c.shot(`ytsub-fall-${kind}`);
        // квота / отказ YouTube: Chrome сам пишет в журнал ответ 4xx от YouTube (из JS не спрятать) — ровно одна такая строка, других нет
        if (kind === 'quota') ok(onlyErrs(c.errs, /status of 403.*googleapis\.com\/youtube\/v3\/subscriptions/, 1), 'квота: в журнале только одна строка Chrome о 403 от YouTube', c.errs);
        else if (kind === 'forbidden') ok(onlyErrs(c.errs, /status of 400.*googleapis\.com\/youtube\/v3\/subscriptions/, 1), 'отказ YouTube: в журнале только одна строка Chrome о 400 от YouTube', c.errs);
        else ok(!c.errs.length, `${kind}: ошибок в консоли нет`, c.errs);
      } finally { await c.close(); }
    }

    // (sublook) 4 размера × 2 темы: «✓ Ты подписан» на главной, в окне ролика и в Shorts — целиком на экране, вбок не едет
    if (want('sublook')) {
      console.log('— подписка, вид: 4 размера × 2 темы');
      for (const [w, h, ph] of [[390, 844, true], [800, 600, false], [1920, 1080, false], [3440, 1440, false]]) for (const theme of ['dark', 'light']) {
        const G = { answer: 'grant', subbed: true }, X = mockGoogle(G);
        const { user, profile } = oldUser('admin');
        const tok = `try{sessionStorage.setItem('d37_ytl_tok', JSON.stringify({ t: ${JSON.stringify(TOKEN)}, exp: Date.now() + 3e6, u: ${JSON.stringify(ME)} }))}catch(e){}`;
        const c = await chrome({ w, h, phone: ph, theme, S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('test') + tok });
        const fits = sel => c.ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); if (!a) return null; a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, iw: innerWidth, wrap: r.height > 80 }; })()`);
        try {
          await c.send('Page.navigate', { url: B + '/' });
          await c.until(READY);
          ok(await signedIn(c), `${w}×${h} ${theme}: вход`);
          ok(await c.until(SUBBED(HERO), 10000), `${w}×${h} ${theme}: главная — «✓ Ты подписан»`, await c.ev(subTxt(HERO)));
          const r0 = await fits(HERO);
          ok(r0 && r0.w > 40 && r0.l >= 0 && r0.r <= r0.iw + 1 && !r0.wrap && await c.ev(noOverflow), `${w}×${h} ${theme}: кнопка на главной целиком на экране`, r0);
          await c.shot(`ytsub-look-home-${w}x${h}-${theme}`);
          await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
          ok(await c.until(SUBBED(SUBBTN), 8000), `${w}×${h} ${theme}: окно ролика — «✓ Ты подписан»`);
          const r1 = await fits(SUBBTN);
          ok(r1 && r1.w > 40 && r1.l >= 0 && r1.r <= r1.iw + 1 && await c.ev(noOverflow), `${w}×${h} ${theme}: в окне ролика целиком на экране`, r1);
          await c.shot(`ytsub-look-modal-${w}x${h}-${theme}`);
          await c.ev(`closeModal(); D37Route.go('#/shorts/${V2}'); true`, true);
          const ssel = `.sh-item[data-id="${V2}"] .sh-sub`;
          ok(await c.until(SUBBED(ssel), 12000), `${w}×${h} ${theme}: Shorts — «✓ Ты подписан»`, await c.ev(subTxt(ssel)));
          ok(await c.ev(noOverflow), `${w}×${h} ${theme}: Shorts вбок не прокручиваются`);
          await c.shot(`ytsub-look-shorts-${w}x${h}-${theme}`);
          ok(G.J.filter(x => x[0] === 'subList').length === 1 && !G.J.some(x => x[0] === 'subInsert'), `${w}×${h} ${theme}: subscriptions.list один раз на визит, insert нет`, G.J.map(x => x[0]));
          ok(!c.errs.length, `${w}×${h} ${theme}: ошибок в консоли нет`, c.errs);
        } finally { await c.close(); }
      }
    }

    // ═══ (look) размеры и темы: залитая 👍 в окне ролика и в Shorts ═══
    if (want('look')) {
      console.log('— вид: 4 размера × 2 темы');
      for (const [w, h, ph] of [[390, 844, true], [800, 600, false], [1920, 1080, false], [3440, 1440, false]]) for (const theme of ['dark', 'light']) {
        const G = { answer: 'grant', liked: new Set([V2, V3]) }, X = mockGoogle(G);
        const { user, profile } = oldUser('admin');
        const tok = `try{sessionStorage.setItem('d37_ytl_tok', JSON.stringify({ t: ${JSON.stringify(TOKEN)}, exp: Date.now() + 3e6, u: ${JSON.stringify(ME)} }))}catch(e){}`;
        const c = await chrome({ w, h, phone: ph, theme, S: { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED }, extra: X, init: initMode('test') + tok });
        try {
          await c.send('Page.navigate', { url: B + '/' });
          await c.until(READY);
          ok(await signedIn(c), `${w}×${h} ${theme}: вход`);
          await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
          ok(await c.until(`!!document.getElementById('mLike')?.classList.contains('ytl-on')`, 10000), `${w}×${h} ${theme}: окно ролика — залитая 👍 (getRating)`);
          const r = await c.ev(`(() => { const a = document.getElementById('mLike').getBoundingClientRect(); return { w: a.width, l: a.left, r: a.right, iw: innerWidth }; })()`);
          ok(r.w > 40 && r.l >= 0 && r.r <= r.iw + 1 && await c.ev(noOverflow), `${w}×${h} ${theme}: кнопка целиком на экране, вбок не прокручивается`, r);
          await c.shot(`ytl-look-modal-${w}x${h}-${theme}`);
          await c.ev(`closeModal(); D37Route.go('#/shorts/${V2}'); true`, true);
          const sel = `.sh-item[data-id="${V2}"] .sh-like`;
          ok(await c.until(`!!document.querySelector(${JSON.stringify(sel)})?.classList.contains('ytl-on')`, 12000), `${w}×${h} ${theme}: Shorts — залитая 👍`);
          ok(await c.ev(noOverflow), `${w}×${h} ${theme}: Shorts вбок не прокручиваются`);
          await c.shot(`ytl-look-shorts-${w}x${h}-${theme}`);
          ok(count(G, 'getRating') <= 3, `${w}×${h} ${theme}: getRating пачкой (${count(G, 'getRating')} запр.)`, G.J.filter(x => x[0] === 'getRating'));
          ok(!c.errs.length, `${w}×${h} ${theme}: ошибок в консоли нет`, c.errs);
        } finally { await c.close(); }
      }
    }
  } finally { site.stop(); }
  console.log(`\nytlike-e2e: ${n - fails} ok, ${fails} fail`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e?.stack || e)); process.exit(1); });

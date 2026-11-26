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
// Запуск из корня сайта: node scripts/ytlike-e2e.cjs   (CHROME=…, PYTHON=…, BASE=…, SHOTS=<папка>, ONLY=off,shorts,video,deny,quota,inapp,look)
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
const initMode = mode => `window.__d37YtLikeTest = { mode: ${JSON.stringify(mode)}, cid: ${JSON.stringify(CID)} };`;
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,content-type' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }];

// ═══ Поддельные Google (экран разрешения) и YouTube Data API ═══
// G: { answer: 'grant' | 'deny' | 'noscope', quota, liked: Set, J: журнал }
function mockGoogle(G) {
  G.J = []; G.liked = G.liked || new Set(); G.sbAuthorize = [];
  return {
    patterns: ['https://accounts.google.com/*', 'https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'],
    answer(req) {
      const u = new URL(req.url);
      if (req.url.startsWith(SB + '/auth/v1/authorize')) { G.sbAuthorize.push(Object.fromEntries(u.searchParams)); return null; }   // журнал входа; ответ — поддельный Supabase
      const json = (b, code = 200) => ({ code, body: b === undefined ? '' : JSON.stringify(b), headers: [...CORS, { name: 'Content-Type', value: 'application/json' }] });
      if (u.host === 'accounts.google.com') {
        const q = Object.fromEntries(u.searchParams);
        G.J.push(['auth', q]);
        const st = encodeURIComponent(q.state || '');
        const frag = G.answer === 'deny' ? `error=access_denied&state=${st}`
          : `state=${st}&access_token=${TOKEN}&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent((G.answer === 'noscope' ? '' : SCOPE + ' ') + 'openid https://www.googleapis.com/auth/userinfo.email')}`;
        return { code: 302, body: '', headers: [{ name: 'Location', value: q.redirect_uri + '#' + frag }] };
      }
      if (req.method === 'OPTIONS') return { code: 204, body: '', headers: CORS };
      const auth = String(req.headers?.Authorization || req.headers?.authorization || '');
      if (u.host === 'www.googleapis.com' && u.pathname === '/youtube/v3/videos/rate') {
        G.J.push(['rate', u.searchParams.get('id'), u.searchParams.get('rating'), auth === 'Bearer ' + TOKEN, req.method]);
        if (auth !== 'Bearer ' + TOKEN) return json({ error: { code: 401, errors: [{ reason: 'authError' }] } }, 401);
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
const PASSWORD_LOGIN = `sbClient.auth.signInWithPassword({ email: 'yt.test@example.test', password: 'test-only-123' }).then(r => !r.error)`;
async function signedIn(c) { await c.ev(PASSWORD_LOGIN, true); return c.until(`${SIGNED} && !!currentRole`, 15000); }
const noOverflow = `document.documentElement.scrollWidth <= innerWidth + 1`;

(async () => {
  const site = await startSite();
  const B = site.base;
  console.log('ytlike-e2e: ' + B);
  try {
    // ═══ (off) как на сайте сейчас ═══
    if (want('off')) for (const [w, h, ph, theme] of [[390, 844, true, 'dark'], [1920, 1080, false, 'light']]) {
      console.log(`— флаг как на сайте (off), ${w}×${h} ${theme}: всё как раньше` + (process.env.BASE ? ' — ' + process.env.BASE : ''));
      const G = {}, X = mockGoogle(G);
      const { user, profile } = oldUser('admin');
      const S = { providers: { google: true }, user: null, passwordUser: user, profile, feed: FEED };
      const c = await chrome({ w, h, phone: ph, theme, S, extra: X });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        const sel = `.sh-item[data-id="${V2}"] .sh-like`;
        await c.until(`!!document.querySelector(${JSON.stringify(sel)})`, 10000);
        ok(await c.ev(`D37YtLike.mode()`) === 'off', 'флаг на сайте — off (нет ID клиента)');
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
      const S = { providers: { google: true }, user: null, passwordUser: user, profile };
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
        await c.send('Page.reload');
        await c.until(`${READY} && ${SIGNED}`, 20000);
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
      const c2 = await chrome({ w: 1920, h: 1080, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: u2.user, profile: u2.profile }, extra: X2, init: initMode('test') });
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
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'light', S: { providers: { google: true }, user: null, passwordUser: user, profile }, extra: X, init: initMode('on') });
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
      const c = await chrome({ w: 1920, h: 1080, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile }, extra: X, init: initMode('on') });
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
        ok(!c.errs.length, 'квота: ошибок нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (inapp) встроенный браузер ═══
    if (want('inapp')) {
      console.log('— встроенный браузер Instagram');
      const G = {}, X = mockGoogle(G);
      const { user, profile } = oldUser('user');
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Instagram 300.0.0.0';
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S: { providers: { google: true }, user: null, passwordUser: user, profile }, extra: X, init: initMode('on'), ua });
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

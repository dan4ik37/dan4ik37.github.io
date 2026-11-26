// AUTH_SOCIAL (владелец 25.11.2026: «вход через гугл и другие платформы, чтобы люди могли ставить нормально лайк и смотреть видео и
// стримы») — проверка в настоящем Chrome (headless, загрузки запрещены) через ОБЫЧНЫЙ путь сайта: кнопка → supabase-js → переход на
// «Google» → возврат с токенами → auth-guard.js → D37Intent. Сервис входа ПОДДЕЛАН: ВСЕ запросы к Supabase (вход, профиль, чтение и
// запись) перехватывает Chrome (Fetch.requestPaused) и отвечает сам — в настоящую базу НИЧЕГО не уходит, аккаунтов не создаём;
// realtime (WebSocket) заблокирован. «Google» — ответ 302 на /auth/v1/authorize с токенами во фрагменте, как у настоящего Supabase.
//  (sheet)  окно входа гостем: телефон 390×844, 800×600, 1920×1080, 3440×1440 — тёмная и светлая: «Продолжить с Google» первой,
//           выключенные сервисы (Discord, Twitch, GitHub, VK…) — без кнопок, вбок не прокручивается, ошибок нет;
//  (video)  гость на ролике (окно ролика, 42-я секунда, прокрутка 600) → ❤ → окно → Google → новый аккаунт → год + ник (подсказка
//           «Иван» из имени Google) → тот же ролик с 42-й секунды, та же прокрутка, ❤ поставлен (site_like p_on=true);
//  (stream) телефон, светлая: гость у плеера Twitch → ❤ → Google с УЖЕ существующим аккаунтом (почта + Google — один аккаунт) →
//           без первого входа, ник не трогаем, плеер раскрыт, ❤ стриму поставлен;
//  (game)   страница игры студии /play/studio/play/<id> → ❤ → Google → новый аккаунт → та же страница, ugc_like вызван;
//  (email)  вход почтой с ❤ (без перехода): после входа — не в профиль, а там же, ❤ поставлен;
//  (close)  закрыл окно, не войдя, — задуманное забыто; (inapp) встроенный браузер Instagram — вместо Google подсказка «Открыть в браузере».
//  (hide)   ❤ НЕ ВИДНО (проверка по getComputedStyle / getClientRects, не по свойству .hidden — проверщик 26.11: CSS сайта
//           .modal-act / .tw-btn перебивал [hidden], и мёртвая ❤ была видна всем): нет ч. 20 — ни у ролика, ни у стрима, ни в Shorts
//           (телефон и 1920); ч. 20 есть, но эфира нет и плеер закрыт — у стрима нет; ролик не по возрасту (обложка) — нет;
//  (shorts) лента Shorts (телефон): ❤ на сайте видна у ролика → гость нажал → Google → та же лента и тот же Short, ❤ стоит.
// Запуск из корня сайта: node scripts/auth-social-e2e.cjs  (CHROME=…, PYTHON=…, BASE=…, SHOTS=<папка>, ONLY=sheet,video,stream,game,email,close,inapp,hide,shorts)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/auth' : os.tmpdir());
const SHOTS = process.env.SHOTS || '';
const ONLY = new Set((process.env.ONLY || '').split(',').filter(Boolean));
const want = k => !ONLY.size || ONLY.has(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 700) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
// шум не про сайт: локальный сервер не умеет /api и аналитику Vercel; заблокированные нами чужие плееры, реклама, счётчики
const NOISE = /\/api\/|_vercel\/|status of 501|i\.ytimg\.com|googlesyndication|doubleclick|googleads|yandex\.(ru|net)|mc\.yandex|adsbygoogle|ERR_BLOCKED_BY_CLIENT|favicon|navigator\.vibrate|decapi\.me|telegram\.org/i;
const SB = 'https://zdisuowyjgqirhvcyjfq.supabase.co';
const ME = '00000000-0000-4000-8000-0000000000a1';
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const V = 'dQw4w9WgXcQ', GID = 'g_test_auth01', V2 = 'aaaaaaaaaa1', V3 = 'bbbbbbbbbb2';
// видно ли элемент на самом деле: стиль (а не свойство .hidden), есть прямоугольник, не прозрачный, предки не скрыты
const VIS_FN = `(e => { if (!e) return false; const r = e.getBoundingClientRect(); if (!e.getClientRects().length || r.width < 2 || r.height < 2) return false;
  for (let x = e; x && x.nodeType === 1; x = x.parentElement) { const c = getComputedStyle(x); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0) return false; } return true; })`;
const VISIBLE = sel => `${VIS_FN}(document.querySelector(${JSON.stringify(sel)}))`;
const ANY_VISIBLE = sel => `[...document.querySelectorAll(${JSON.stringify(sel)})].some(${VIS_FN})`;
const STYLE_OF = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e && { hidden: e.hidden, display: getComputedStyle(e).display }; })()`;
// поддельный /api/feed (локальный сервер его не умеет): два Shorts и обычный ролик
const FEED = () => ({ vids: [{ id: V, title: 'Тестовый шорт #shorts', ts: Date.now() - 1e5, views: 10, duration: 'PT40S' }, { id: V2, title: 'Второй шорт #shorts', ts: Date.now() - 2e5, views: 5, duration: 'PT30S' },
  { id: V3, title: 'Обычный ролик', ts: Date.now() - 3e5, views: 7, duration: 'PT10M' }], stats: { subs: 1, views: 1, vids: 3 }, at: new Date().toISOString() });

// ═══ Поддельный Supabase (в Chrome, через Fetch): что вернуть на каждый запрос; журнал — что сайт пытался записать ═══
function mockSupabase(S){
  // S: { user (после входа), profile, providers }
  const J = S.journal = [];
  const now = () => Math.floor(Date.now() / 1000);
  const token = () => [b64u({ alg: 'HS256', typ: 'JWT' }), b64u({ sub: S.user.id, aud: 'authenticated', role: 'authenticated', email: S.user.email, exp: now() + 3600, iat: now(), amr: [{ method: 'oauth', timestamp: now() }], session_id: 's1' }), 'sig'].join('.');
  const session = () => ({ access_token: token(), refresh_token: 'rt_test_' + Math.random().toString(36).slice(2, 10), expires_in: 3600, expires_at: now() + 3600, token_type: 'bearer', user: S.user });
  return function answer(req){
    const u = new URL(req.url), p = u.pathname, m = req.method, accept = String(req.headers?.Accept || req.headers?.accept || '');
    const json = (body, code = 200, extra = []) => ({ code, body: body === undefined ? '' : JSON.stringify(body), headers: [{ name: 'Content-Type', value: 'application/json' }, ...extra] });
    let body = null; try { body = req.postData ? JSON.parse(req.postData) : null; } catch (e) {}
    if (m === 'OPTIONS') return { code: 204, body: '', headers: [] };
    if (p === '/auth/v1/settings') return json({ external: { email: true, google: !!S.providers.google, discord: !!S.providers.discord, twitch: false, github: false, apple: false }, disable_signup: false });
    if (p === '/auth/v1/authorize') {   // «Google»: сразу назад, токены во фрагменте (как implicit-поток Supabase)
      J.push(['authorize', u.searchParams.get('provider')]);
      const s = session(), back = u.searchParams.get('redirect_to');
      S.issued = s;
      return { code: 302, body: '', headers: [{ name: 'Location', value: back + '#access_token=' + s.access_token + '&expires_at=' + s.expires_at + '&expires_in=3600&provider_token=ptok&refresh_token=' + s.refresh_token + '&token_type=bearer' }] };
    }
    if (p === '/auth/v1/user') return S.user ? json(S.user) : json({ msg: 'no' }, 401);
    if (p === '/auth/v1/token') {
      const g = u.searchParams.get('grant_type');
      J.push(['token', g]);
      if (g === 'password' && S.passwordUser) { S.user = S.passwordUser; return json(session()); }
      if (g === 'refresh_token' && S.user) return json(session());
      return json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400);
    }
    if (p === '/auth/v1/logout') return { code: 204, body: '', headers: [] };
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      J.push(['rpc', fn, body]);
      if (fn === 'site_like') return json({ ok: true, liked: body?.p_on !== false, n: body?.p_on === false ? 0 : 1 });
      if (fn === 'site_like_info') return json({ ok: true, items: Object.fromEntries((body?.p_items || []).map(i => [i, { n: 0, mine: false }])) });
      if (fn === 'ugc_like' || fn === 'unity_like') { S.likes = (S.likes || 0) + 1; return json({ ok: true, liked: true, likes: 4 }); }
      if (fn === 'age_set') return json({ ok: true, year: body?.p_year, group: 'adult' });
      if (fn === 'my_age_group') return json({ ok: true, year: null });
      if (fn === 'nick_my_lock') return json({ locked: false });
      return json(null);
    }
    if (p.startsWith('/rest/v1/')) {
      const t = p.slice('/rest/v1/'.length);
      const one = /vnd\.pgrst\.object/.test(accept);
      if (m !== 'GET' && m !== 'HEAD') { J.push([m, t, u.search, body]); if (t === 'profiles' && body?.nick && S.profile) S.profile.nick = body.nick; return { code: 204, body: '', headers: [] }; }
      if (t === 'site_config') { const k = (u.searchParams.get('key') || '').replace(/^eq\./, ''); const row = k === 'part20' && S.part20 !== false ? { key: 'part20', value: '1' } : null; return json(one ? row : row ? [row] : []); }
      if ((t === 'profiles' || t === 'profiles_public') && S.profile && (u.searchParams.get('id') || '') === 'eq.' + S.profile.id) return json(one ? S.profile : [S.profile]);
      if (t === 'ugc_games' && (u.searchParams.get('id') || '').includes(GID)) { const g = { id: GID, title: 'Тестовая игра', icon: '🎮', descr: 'для проверки', kind: 'tpl', tpl: 'catch', status: 'public', plays: 7, likes: 3, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', author: '22222222-2222-4222-8222-222222222222', profiles: { nick: 'автор' }, data: {}, age_rating: 0 }; return json(one ? g : [g]); }
      return json(one ? null : [], one ? 406 : 200);
    }
    return json({});   // storage и прочее
  };
}

// extra (ytlike-e2e.cjs): { patterns: [шаблоны Fetch], answer(req) → { code, body, headers } | null } — подделать ещё сервисы (Google, YouTube API);
// init — свой скрипт до страницы; logs — ВСЕ строки консоли (проверка «токена нет в журнале»)
async function chrome({ w = 1440, h = 900, phone = false, theme = 'dark', S, ua, extra, init } = {}){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], leaked = [], logs = [];
  const answer = mockSupabase(S);
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Fetch.requestPaused') {
      const r = d.params.request;
      const xa = extra ? extra.answer(r) : null;
      if (xa) { send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: xa.code, responseHeaders: xa.headers || [], body: Buffer.from(xa.body || '').toString('base64') }).catch(() => {}); return; }
      if (S.feed && /\/api\/feed(\?|$)/.test(r.url)) { send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(S.feed())).toString('base64') }).catch(() => {}); return; }
      if (!r.url.startsWith(SB)) { send('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {}); return; }
      const a = answer(r);
      const hdr = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,PUT,OPTIONS' }, { name: 'Access-Control-Expose-Headers', value: '*' }, ...a.headers];
      send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: a.code, responseHeaders: hdr, body: Buffer.from(a.body || '').toString('base64') }).catch(() => {});
      return;
    }
    if (d.method === 'Network.requestWillBeSent' && d.params.request.url.startsWith(SB) && !/^(GET|HEAD|OPTIONS)$/.test(d.params.request.method) && !d.params.request.url.includes('/auth/v1/')) leaked.push(d.params.request.method + ' ' + d.params.request.url);   // для журнала — все они перехвачены Fetch
    if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    let e = '';
    if (d.method === 'Runtime.exceptionThrown') e = 'EXC ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '');
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') e = 'CON ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') e = 'LOG ' + (d.params.entry.text || '') + ' ' + (d.params.entry.url || '');
    if (e && !NOISE.test(e)) errs.push(e.slice(0, 300)); };
  const ev = async (expr, gesture) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!gesture }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Fetch.enable', { patterns: [{ urlPattern: SB + '/*', requestStage: 'Request' }, ...(S.feed ? [{ urlPattern: '*/api/feed*', requestStage: 'Request' }] : []), ...((extra && extra.patterns) || []).map(u => ({ urlPattern: u, requestStage: 'Request' }))] });
  // realtime Supabase (WebSocket — Fetch его не видит), чужие плееры и реклама — не грузим; превью YouTube — тоже (у тестовых роликов
  // их нет: 404 картинки Chrome пишет в журнал от имени shorts.js / youtube.js, и это выглядело как «нет файла сайта»)
  await send('Network.setBlockedURLs', { urls: ['*i.ytimg.com*', '*supabase.co/realtime*', '*youtube.com/embed*', '*player.twitch.tv*', '*googlesyndication*', '*doubleclick*', '*mc.yandex*', '*yandex.ru/ads*', '*an.yandex*', '*telegram.org*'] });
  if (ua) await send('Emulation.setUserAgentOverride', { userAgent: ua });
  const size = async (w2, h2, ph) => { await send('Emulation.setDeviceMetricsOverride', { width: w2, height: h2, deviceScaleFactor: ph ? 2 : 1, mobile: !!ph }); await send('Emulation.setTouchEmulationEnabled', { enabled: !!ph, maxTouchPoints: 5 }); };
  await size(w, h, phone);
  // первый заход: тема, без окошка «Сколько тебе лет?» и баннера приложения (возраст гостю НЕ задаём — новый аккаунт должен его спросить)
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme };
  if (init) await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('aset')){sessionStorage.setItem('aset','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(r.data, 'base64')); };
  const click = async sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({ block: 'center' }); e.click(); return true; })()`, true);
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs, shot, size, click, leaked, logs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Intent && !!window.D37Login && document.readyState === 'complete'`;
const SIGNED = `typeof currentUser !== 'undefined' && !!currentUser`;
const newGoogleUser = () => ({ id: ME, aud: 'authenticated', role: 'authenticated', email: 'ivan.test@gmail.com', email_confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(),
  app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: 'Иван Петров', given_name: 'Иван', name: 'Иван Петров', email: 'ivan.test@gmail.com' },
  identities: [{ id: 'g1', provider: 'google', identity_data: { full_name: 'Иван Петров', email: 'ivan.test@gmail.com' }, created_at: new Date().toISOString() }] });
const newProfile = () => ({ id: ME, nick: 'user_' + ME.replace(/-/g, ''), role: 'user' });
const sheetInfo = `(() => { const m = document.getElementById('globalAuthModal'); const box = document.getElementById('gauthOauth');
  const btns = [...document.querySelectorAll('#gauthOauth [data-lgn-login]')].map(b => b.dataset.lgnLogin);
  const g = document.querySelector('#gauthOauth .lgn-main'); const r = g ? g.getBoundingClientRect() : null;
  return { open: !!m?.classList.contains('open'), shown: box && !box.hidden, btns, main: g ? g.textContent.trim() : '', mainVisible: !!r && r.width > 100 && r.left >= 0 && r.right <= innerWidth + 1,
    intent: (document.getElementById('gauthIntent')?.hidden === false) ? document.getElementById('gauthIntent').textContent : '', overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    emailLast: !!document.getElementById('gauthLoginFields') && (box.compareDocumentPosition(document.getElementById('gauthLoginFields')) & 4) > 0, inapp: !!document.querySelector('#gauthOauth .lgn-inapp') }; })()`;

// общий стенд для других проверок входа (scripts/ytlike-e2e.cjs): require — без запуска своих проверок
module.exports = { startSite, chrome, mockSupabase, newGoogleUser, newProfile, sheetInfo, READY, SIGNED, VISIBLE, ANY_VISIBLE, FEED, SB, ME, V, V2, V3, NOISE, ok: (...a) => ok(...a), counts: () => ({ n, fails }) };
if (require.main === module) (async () => {
  const site = await startSite();
  const B = site.base;
  console.log('auth-social-e2e: ' + B);
  try {
    // ═══ (sheet) окно входа на 4 размерах, обе темы ═══
    if (want('sheet')) {
      console.log('— окно входа: размеры и темы');
      for (const [w, h, ph] of [[390, 844, true], [800, 600, false], [1920, 1080, false], [3440, 1440, false]]) for (const theme of ['dark', 'light']) {
        const S = { providers: { google: true, discord: false }, user: null };
        const c = await chrome({ w, h, phone: ph, theme, S });
        try {
          await c.send('Page.navigate', { url: B + '/' });
          await c.until(READY);
          await c.ev(`openGlobalAuth('login')`, true);
          await c.until(`!!document.querySelector('#gauthOauth .lgn-main')`, 8000);
          const s = await c.ev(sheetInfo);
          ok(s.open && s.shown && s.btns[0] === 'google' && /Продолжить с Google/.test(s.main) && s.mainVisible, `${w}×${h} ${theme}: «Продолжить с Google» первой и видна целиком`, s);
          ok(s.btns.length === 1, `${w}×${h} ${theme}: выключенные сервисы — без кнопок (нет мёртвых кнопок)`, s.btns);
          ok(s.emailLast && !s.overflowX, `${w}×${h} ${theme}: почта — последней, вбок не прокручивается`, s);
          await c.shot(`sheet-${w}x${h}-${theme}`);
          ok(!c.errs.length, `${w}×${h} ${theme}: ошибок в консоли нет`, c.errs);
        } finally { await c.close(); }
      }
    }

    // ═══ (video) гость на ролике → ❤ → Google → новый аккаунт → год + ник → тот же ролик и секунда, ❤ стоит ═══
    if (want('video')) {
      console.log('— ролик: ❤ гостем → Google (новый аккаунт)');
      const S = { providers: { google: true }, user: newGoogleUser(), profile: newProfile() };
      const c = await chrome({ w: 1440, h: 900, theme: 'dark', S });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`(async () => { document.body.style.minHeight = '3000px'; scrollTo(0, 600); openVid(${JSON.stringify(V)}, 'Тестовый ролик', '', ''); })()`, true);
        ok(await c.until(`!!document.getElementById('mHeart') && !document.getElementById('mHeart').hidden`, 8000), 'в окне ролика есть «❤ Нравится» (ч. 20 есть)');
        // плеер YouTube «сказал» 42.7 с (настоящий заблокирован в проверке — сообщение от его окна, как шлёт YouTube)
        await c.ev(`(() => { const fr = document.querySelector('#mVid iframe'); window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 42.7 } }), origin: 'https://www.youtube.com', source: fr.contentWindow })); return true; })()`);
        const y0 = await c.ev('scrollY');
        await c.click('#mHeart');
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), '❤ гостем → одно окно входа');
        const s = await c.ev(sheetInfo);
        ok(/❤/.test(s.intent), 'в окне сказано, что ❤ поставится сам', s.intent);
        const it = await c.ev(`D37Intent.pending()`);
        ok(it?.kind === 'site_like' && it.args?.item === V && it.media?.k === 'yt' && it.media.t === 42 && Math.abs(it.y - y0) < 2, 'запомнено: ❤ ролику, ролик и 42-я секунда, прокрутка', { it, y0 });
        await c.shot('video-1-sheet');
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вернулись с «Google» и вошли (auth-guard принял свой вход молча)');
        ok(S.journal.some(x => x[0] === 'authorize' && x[1] === 'google'), 'переход шёл через /auth/v1/authorize?provider=google (как настоящий)');
        ok(await c.until(`!!document.querySelector('.wlc-ov')`, 10000), 'новый аккаунт через Google → короткий первый вход (год и ник)');
        const w0 = await c.ev(`({ nick: document.querySelector('.wlc-nick')?.value, year: !!document.querySelector('.wlc-year'), links: [...document.querySelectorAll('.wlc-links a')].map(a => a.getAttribute('href')) })`);
        ok(w0.nick === 'Иван' && w0.year, 'ник подсказан из имени Google (только имя, без фамилии), год спрошен', w0);
        await c.shot('video-2-welcome');
        // «Готово» без года нельзя пропустить молча: выбираем год, ник — свой со смайликом
        await c.ev(`(() => { const s = document.querySelector('.wlc-year'); s.value = String(new Date().getFullYear() - 30); const i = document.querySelector('.wlc-nick'); i.value = 'Ваня 🔥'; return true; })()`);
        await c.click('.wlc-ok');
        ok(await c.until(`!document.querySelector('.wlc-ov')`, 8000), 'первый вход закрылся после «Готово»');
        ok(S.journal.some(x => x[0] === 'rpc' && x[1] === 'age_set' && x[2]?.p_year === new Date().getFullYear() - 30), 'год ушёл в аккаунт (age_set)');
        ok(S.journal.some(x => x[0] === 'PATCH' && x[1] === 'profiles' && x[3]?.nick === 'Ваня 🔥'), 'ник со смайликом сохранён (profiles.nick)');
        ok(await c.until(`document.getElementById('mHeart')?.classList.contains('on')`, 15000), '❤ ролику поставлен сам после входа');
        ok(S.journal.some(x => x[0] === 'rpc' && x[1] === 'site_like' && x[2]?.p_kind === 'video' && x[2]?.p_item === V && x[2]?.p_on === true), 'site_like: ролик, «поставить» (не переключить)');
        const back = await c.ev(`({ path: location.pathname, open: document.getElementById('modal').classList.contains('open'), vid: modalVidId, src: document.querySelector('#mVid iframe')?.getAttribute('src') || '', y: scrollY, prof: /^#\\/profile/.test(D37Route.hash()), left: localStorage.getItem('d37_intent') })`);
        ok(back.path === '/' && !back.prof, 'остались на той же странице (не увело в профиль)', back);
        ok(back.open && back.vid === V && /[?&]start=42(&|$)/.test(back.src), 'тот же ролик открыт с 42-й секунды', back);
        ok(Math.abs(back.y - y0) < 4, 'та же прокрутка', { y: back.y, y0 });
        ok(back.left === null, 'задуманное стёрто после выполнения');
        await c.shot('video-3-done');
        ok(!c.errs.length, 'ролик: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (stream) телефон, светлая: существующий аккаунт (почта + Google — один) ═══
    if (want('stream')) {
      console.log('— стрим: ❤ гостем → Google (уже есть аккаунт по почте)');
      const old = new Date(Date.now() - 90 * 864e5).toISOString();
      const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'ivan.test@gmail.com', email_confirmed_at: old, created_at: old,
        app_metadata: { provider: 'email', providers: ['email', 'google'] }, user_metadata: { full_name: 'Иван Петров', given_name: 'Иван' },
        identities: [{ id: 'e1', provider: 'email', identity_data: { email: 'ivan.test@gmail.com' }, created_at: old }, { id: 'g1', provider: 'google', identity_data: { email: 'ivan.test@gmail.com' }, created_at: new Date().toISOString() }] };
      const S = { providers: { google: true }, user, profile: { id: ME, nick: 'СтарыйНик', role: 'user' } };
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'light', S });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`(() => { if (typeof setTwitchOpen === 'function') setTwitchOpen(true); document.getElementById('autoStreamWrap')?.scrollIntoView(); return true; })()`, true);
        ok(await c.until(`!!document.getElementById('twHeart') && !document.getElementById('twHeart').hidden`, 8000), 'у плеера Twitch есть «❤ Нравится»');
        await c.click('#twHeart');
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), '❤ гостем → окно входа');
        ok((await c.ev(`D37Intent.pending()`))?.media?.k === 'tw', 'запомнено: плеер раскрыт');
        await c.shot('stream-1-sheet');
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вернулись с «Google» и вошли');
        ok(await c.until(`document.getElementById('twHeart')?.classList.contains('on')`, 15000), '❤ стриму поставлен сам');
        ok(S.journal.some(x => x[0] === 'rpc' && x[1] === 'site_like' && x[2]?.p_kind === 'stream' && x[2]?.p_item === 'live' && x[2]?.p_on === true), 'site_like: сегодняшний стрим (live), «поставить»');
        const st = await c.ev(`({ welcome: !!document.querySelector('.wlc-ov'), uid: currentUser.id, nick: currentProfile?.nick, open: document.getElementById('autoStreamWrap').classList.contains('open'), path: location.pathname })`);
        ok(!st.welcome && st.uid === ME && st.nick === 'СтарыйНик', 'тот же аккаунт (почта + Google): первого входа нет, ник не тронут', st);
        ok(!S.journal.some(x => x[0] === 'PATCH' && x[1] === 'profiles'), 'профиль не переписан (второго аккаунта и нового ника нет)');
        ok(st.open && st.path === '/', 'на той же странице, плеер раскрыт', st);
        await c.shot('stream-2-done');
        ok(!c.errs.length, 'стрим: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (game) страница игры студии ═══
    if (want('game')) {
      console.log('— игра: ❤ гостем → Google (новый аккаунт)');
      const S = { providers: { google: true }, user: newGoogleUser(), profile: newProfile() };
      const c = await chrome({ w: 1920, h: 1080, theme: 'light', S });
      try {
        await c.send('Page.navigate', { url: B + '/play/studio/play/' + GID });
        await c.until(READY);
        ok(await c.until(`!!document.querySelector('[data-act="like"]')`, 20000), 'страница игры: кнопка ❤ есть');
        await c.click('[data-act="like"]');
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), '❤ гостем → окно входа');
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вошли через «Google»');
        ok(await c.until(`!!document.querySelector('.wlc-ov')`, 10000), 'новый аккаунт → год и ник');
        await c.ev(`(() => { document.querySelector('.wlc-year').value = ''; return true; })()`);   // «Не хочу указывать» — тоже ответ (правила «возраст не указан»)
        await c.click('.wlc-ok');
        ok(await c.until(`!document.querySelector('.wlc-ov')`, 8000), 'первый вход закрыт («не хочу указывать» год — правила как без возраста)');
        ok(await c.until(`location.pathname === '/play/studio/play/${GID}'`, 10000), 'вернулись на ту же страницу игры', await c.ev('location.pathname'));
        ok(await c.until(`!!document.querySelector('[data-act="like"]')`, 15000), 'страница игры снова открыта');
        await c.until(`${JSON.stringify('x')} === 'y'`, 1500);   // пауза: обработчик ugc_like ждёт загрузки студии
        ok(S.journal.some(x => x[0] === 'rpc' && x[1] === 'ugc_like' && x[2]?.p_id === GID), 'ugc_like вызван сам после входа');
        ok(await c.until(`document.querySelector('[data-act="like"]')?.classList.contains('on')`, 8000), 'кнопка ❤ игры — нажата');
        await c.shot('game-done');
        ok(!c.errs.length, 'игра: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (email) вход почтой с ❤: без перехода, после входа — там же ═══
    if (want('email')) {
      console.log('— почта: ❤ гостем → вход почтой (последний способ в окне)');
      const old = new Date(Date.now() - 30 * 864e5).toISOString();
      const pu = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'test@example.test', email_confirmed_at: old, created_at: old, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [{ id: 'e1', provider: 'email', identity_data: {}, created_at: old }] };
      const S = { providers: { google: true }, user: null, passwordUser: pu, profile: { id: ME, nick: 'Почтовик', role: 'user' } };
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`openVid(${JSON.stringify(V)}, 'Тестовый ролик', '', '')`, true);
        await c.until(`!document.getElementById('mHeart')?.hidden`, 8000);
        await c.click('#mHeart');
        await c.until(`document.getElementById('globalAuthModal').classList.contains('open')`, 8000);
        // тестовые значения только для этой проверки (сервер подделан, никуда не уходят)
        await c.ev(`(() => { document.getElementById('gauthEmail').value = 'test@example.test'; document.getElementById('gauthPassword').value = 'test-only-123'; doGlobalLogin(); return true; })()`, true);
        ok(await c.until(SIGNED, 15000), 'вход почтой прошёл');
        ok(await c.until(`document.getElementById('mHeart')?.classList.contains('on')`, 15000), '❤ поставлен сам');
        const st = await c.ev(`({ prof: /^#\\/profile/.test(D37Route.hash()), open: document.getElementById('modal').classList.contains('open'), welcome: !!document.querySelector('.wlc-ov') })`);
        ok(!st.prof && st.open && !st.welcome, 'не увело в профиль, ролик открыт, первого входа нет (аккаунт старый)', st);
        ok(!c.errs.length, 'почта: ошибок в консоли нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (close) закрыл окно, не войдя ═══
    if (want('close')) {
      console.log('— закрыл окно — задуманное забыто');
      const S = { providers: { google: true }, user: null };
      const c = await chrome({ w: 1440, h: 900, theme: 'dark', S });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`openVid(${JSON.stringify(V)}, 'Тестовый ролик', '', '')`, true);
        await c.until(`!document.getElementById('mHeart')?.hidden`, 8000);
        await c.click('#mHeart');
        await c.until(`!!D37Intent.pending()`, 5000);
        await c.ev(`closeGlobalAuth()`, true);
        ok(await c.until(`localStorage.getItem('d37_intent') === null`, 4000), 'закрыл окно — ❤ не поставится потом сам');
        ok(!S.journal.some(x => x[0] === 'rpc' && x[1] === 'site_like'), 'гостем ничего не записано');
        ok(!c.errs.length, 'закрытие: ошибок нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (inapp) встроенный браузер Instagram ═══
    if (want('inapp')) {
      console.log('— встроенный браузер: подсказка вместо Google');
      const S = { providers: { google: true }, user: null };
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0.0 Android';
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'light', S, ua });
      try {
        await c.send('Page.navigate', { url: B + '/' });
        await c.until(READY);
        await c.ev(`openGlobalAuth('login')`, true);
        await c.until(`!!document.querySelector('#gauthOauth .lgn-inapp')`, 8000);
        const s = await c.ev(sheetInfo);
        ok(s.inapp && !s.main && /Открыть в браузере/.test(await c.ev(`document.querySelector('[data-lgn-outside]')?.textContent || ''`)), 'Instagram: вместо Google — «Открыть в браузере» (Google там не пускает)', s);
        await c.shot('inapp-sheet');
        ok(!c.errs.length, 'встроенный браузер: ошибок нет', c.errs);
      } finally { await c.close(); }
    }

    // ═══ (hide) ❤ не видно, где её быть не должно — по стилю, а не по свойству .hidden ═══
    if (want('hide')) {
      console.log('— ❤ не видно: нет ч. 20 / нет эфира / ролик не по возрасту');
      for (const [w, h, ph] of [[390, 844, true], [1920, 1080, false]]) {
        const S = { providers: { google: true }, user: null, part20: false, feed: FEED };
        const c = await chrome({ w, h, phone: ph, theme: 'dark', S });
        try {
          await c.send('Page.navigate', { url: B + '/' });
          await c.until(READY);
          ok(await c.until(`!!document.getElementById('twHeart')`, 8000) && (await c.ev(`D37SiteLike.part20()`)) === false, `${w}×${h}: нет ч. 20 — сайт это видит`);
          await c.ev(`D37SiteLike.refresh('stream')`);
          ok(!(await c.ev(VISIBLE('#twHeart'))), `${w}×${h}: нет ч. 20 — у блока стрима ❤ не видно`, await c.ev(STYLE_OF('#twHeart')));
          await c.shot(`hide-nop20-home-${w}x${h}`);
          await c.ev(`(() => { if (typeof setTwitchOpen === 'function') setTwitchOpen(true); return true; })()`, true);
          await c.ev(`D37SiteLike.refresh('stream')`);
          ok(!(await c.ev(VISIBLE('#twHeart'))), `${w}×${h}: нет ч. 20 — и при раскрытом плеере ❤ стрима не видно`, await c.ev(STYLE_OF('#twHeart')));
          await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
          await c.until(`document.getElementById('modal').classList.contains('open')`, 5000);
          await c.ev(`D37SiteLike.refresh('video')`);
          ok(!(await c.ev(VISIBLE('#mHeart'))), `${w}×${h}: нет ч. 20 — в окне ролика ❤ не видно`, await c.ev(STYLE_OF('#mHeart')));
          await c.shot(`hide-nop20-video-${w}x${h}`);
          await c.ev(`closeModal()`, true);
          await c.ev(`D37Route.go('#/shorts/${V}')`, true);
          ok(await c.until(`!!document.querySelector('.sh-item[data-id="${V}"] .sh-side')`, 10000), `${w}×${h}: лента Shorts открылась`);
          await c.until(`'x' === 'y'`, 800);
          ok(!(await c.ev(ANY_VISIBLE('.sh-item .sl-btn'))), `${w}×${h}: нет ч. 20 — в Shorts ❤ не видно`);
          ok(!c.errs.length, `${w}×${h}: нет ч. 20 — ошибок нет`, c.errs);
        } finally { await c.close(); }
      }
      {
        const S = { providers: { google: true }, user: null };
        const c = await chrome({ w: 1440, h: 900, theme: 'light', S });
        try {
          await c.send('Page.navigate', { url: B + '/' });
          await c.until(READY);
          await c.until(`!!document.getElementById('twHeart')`, 8000);
          await c.ev(`(() => { twLive = false; if (typeof setTwitchOpen === 'function') setTwitchOpen(false); return true; })()`, true);
          await c.ev(`D37SiteLike.refresh('stream')`);
          ok(!(await c.ev(VISIBLE('#twHeart'))), 'ч. 20 есть, эфира нет, плеер закрыт — ❤ стрима не видно', await c.ev(STYLE_OF('#twHeart')));
          await c.ev(`(() => { setTwitchOpen(true); return true; })()`, true);
          await c.ev(`D37SiteLike.refresh('stream')`);
          ok(await c.ev(VISIBLE('#twHeart')), 'ч. 20 есть, плеер раскрыт — ❤ стрима видна');
          await c.ev(`openVid(${JSON.stringify(V3)}, 'Открываю кейсы в казино 18+', '', '')`, true);
          await c.until(`document.getElementById('modal').classList.contains('open') && document.getElementById('mVid').classList.contains('age-on')`, 5000);
          await c.ev(`D37SiteLike.refresh('video')`);
          ok(!(await c.ev(VISIBLE('#mHeart'))), 'ролик не по возрасту (обложка) — ❤ не видно', await c.ev(`({ cover: document.getElementById('mVid').classList.contains('age-on'), like: document.getElementById('mLike')?.hidden, display: getComputedStyle(document.getElementById('mHeart')).display })`));
          await c.ev(`closeModal()`, true);
          await c.ev(`openVid(${JSON.stringify(V3)}, 'Обычный ролик', '', '')`, true);
          await c.ev(`D37SiteLike.refresh('video')`);
          ok(await c.ev(VISIBLE('#mHeart')), 'обычный ролик — ❤ видна');
          ok(!c.errs.length, 'ч. 20 есть: ошибок нет', c.errs);
        } finally { await c.close(); }
      }
    }

    // ═══ (shorts) лента Shorts: ❤ гостем → Google → тот же Short, ❤ стоит ═══
    if (want('shorts')) {
      console.log('— Shorts: ❤ гостем → Google (новый аккаунт)');
      const S = { providers: { google: true }, user: newGoogleUser(), profile: newProfile(), feed: FEED };
      const c = await chrome({ w: 390, h: 844, phone: true, theme: 'dark', S });
      try {
        await c.send('Page.navigate', { url: B + '/#/shorts/' + V2 });
        await c.until(READY);
        const sel = `.sh-item[data-id="${V2}"] .sl-btn`;
        ok(await c.until(VISIBLE(sel), 10000), 'в ленте Shorts у ролика видна «❤ Нравится»');
        await c.shot('shorts-1-heart');
        await c.click(sel);
        ok(await c.until(`document.getElementById('globalAuthModal').classList.contains('open') && !!document.querySelector('#gauthOauth .lgn-main')`, 8000), '❤ гостем → окно входа');
        const it = await c.ev(`D37Intent.pending()`);
        ok(it?.kind === 'site_like' && it.args?.kind === 'video' && it.args?.item === V2 && it.hash === '#/shorts/' + V2, 'запомнено: ❤ этому Short и место в ленте', it);
        await c.click('#gauthOauth .lgn-main');
        ok(await c.until(`${READY} && ${SIGNED}`, 25000), 'вернулись с «Google» и вошли');
        if (await c.until(`!!document.querySelector('.wlc-ov')`, 8000)) { await c.ev(`(() => { document.querySelector('.wlc-year').value = String(new Date().getFullYear() - 25); return true; })()`); await c.click('.wlc-ok'); }
        ok(await c.until(`document.querySelector(${JSON.stringify(sel)})?.classList.contains('on')`, 15000), '❤ этому Short поставлен сам');
        ok(S.journal.some(x => x[0] === 'rpc' && x[1] === 'site_like' && x[2]?.p_kind === 'video' && x[2]?.p_item === V2 && x[2]?.p_on === true), 'site_like: этот Short, «поставить»');
        const st = await c.ev(`({ hash: D37Route.hash(), route: document.body.dataset.route })`);
        ok(st.route === 'shorts' && st.hash === '#/shorts/' + V2, 'та же лента, тот же Short', st);
        await c.shot('shorts-2-done');
        ok(!c.errs.length, 'Shorts: ошибок нет', c.errs);
      } finally { await c.close(); }
    }
  } finally { site.stop(); }
  console.log(`\nauth-social-e2e: ${n - fails} ok, ${fails} fail`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e?.stack || e)); process.exit(1); });

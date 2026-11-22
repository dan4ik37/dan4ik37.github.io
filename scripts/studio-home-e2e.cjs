// Главная студии — одна дверь (T-176, EDITOR_ONE S1) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на scripts/serve.py.
// Запуск из корня сайта:
//   node scripts/studio-home-e2e.cjs [ci]   — путь человека на телефоне (390 × 844) и ПК (1440 × 900), тёмная и светлая тема:
//       главная → десять карточек с картинками → «Царь горы» → мир открыт, окно «🎮 Режим игры и ракурс» открыто → ползунок →
//       «▶ Проверить» (игра пошла) → «Стоп» → «Назад» → «Мои проекты» показывает этот мир → он же открывается по open/<id>;
//       неизвестная заготовка мир не создаёт; «Игры игроков» — ошибка с «Повторить», потом список (по возрасту, как /hub); флаг
//       STUDIO_ONE = false — прежняя главная. 0 ошибок в консоли. Снимки — <D37_TMP>\shots\*.jpg
//   node scripts/studio-home-e2e.cjs shots  — картинки карточек img/studio/modes/<id>.webp: снимок каждой заготовки «Студии 3D»
//       (её собственный мир в редакторе, камера на весь мир, без окон), 480 × 270
// Вход подделан (currentUser в странице), Supabase подменён в браузере: чтение ugc_games — поддельные строки, любая запись — отказ
// без отправки (в базу ничего не уходит). Загрузки запрещены (Page.setDownloadBehavior deny), «Выгрузить» не нажимается.
// Chrome — переменная CHROME; временное — D37_TMP (по умолчанию M:\d37\claude-tmp\studio-s1).
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const MODE = process.argv[2] || 'ci';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/studio-s1' : path.join(require('os').tmpdir(), 'studio-s1'));
const SHOTS = path.join(TMP, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } };
const BLANKS = (() => { const s = fs.readFileSync(path.join(SITE, 'js/games/studio-blanks.js'), 'utf8'); const w = {}; new Function('window', s)(w); return w.D37StudioBlanks; })();

function startServe(port){ return spawn('python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' }); }
const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
async function waitPort(port){ for (let i = 0; i < 100; i++) { if (await getRaw(port, '/robots.txt')) return true; await sleep(150); } return false; }
// чужие сайты (кроме jsDelivr — оттуда three.js и supabase-js); Supabase не здесь — его подменяет Fetch ниже
const BLOCK = ['*://*.googleapis.com/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*', '*://*.yandex.ru/*', '*://*.yandex.net/*', '*://yastatic.net/*',
  '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://*.gstatic.com/*',
  '*://localhost:*/_vercel/*', '*://127.0.0.1:*/_vercel/*', 'wss://*.supabase.co/*'];
const realErrors = errs => errs.filter(e => !/Failed to fetch|NetworkError|ERR_BLOCKED|ERR_INTERNET|net::|AbortError|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights|WebSocket connection|realtime/i.test(String(e)));

// ── поддельный Supabase: ugc_games — строки по виду запроса; всё остальное — пусто; запись — отказ ──
const XSS = '<img src=x onerror=window.__xss=1>';
const MINE = [
  { id: 'srvg1', title: 'Моя игра ' + XSS, icon: '🏃', descr: '', kind: 'tpl', tpl: 'runner', status: 'link', plays: 12, likes: 3, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z', author: 'u-test', age_rating: 6, profiles: { nick: 'Я' } },
  { id: 'srvw1', title: 'Мой 3D-мир на сайте', icon: '🧱', descr: '', kind: 'place', tpl: null, status: 'public', plays: 5, likes: 1, created_at: '2026-11-19T10:00:00Z', updated_at: '2026-11-19T10:00:00Z', author: 'u-test', age_rating: 12, profiles: { nick: 'Я' } },
];
const CAT = [
  { id: 'pub6', title: 'Детская игра', icon: '🐱', kind: 'tpl', tpl: 'catcher', status: 'public', plays: 50, likes: 5, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', author: 'u-a', age_rating: 6, profiles: { nick: 'Ник ' + XSS } },
  { id: 'pub16', title: 'Игра 16 плюс', icon: '🔪', kind: 'html', tpl: null, status: 'public', plays: 40, likes: 4, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', author: 'u-b', age_rating: 16, profiles: { nick: 'Б' } },
  { id: 'pubN', title: 'Мир без метки', icon: '🌍', kind: 'place', tpl: null, status: 'public', plays: 30, likes: 2, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:00:00Z', author: 'u-c', age_rating: null, profiles: { nick: 'В' } },
];

async function chrome(net){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9100 + Math.floor(Math.random() * 500), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const cb = new Map(), subs = new Set(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr, 10000)) return true; } catch (e) {} await sleep(150); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Network.setBlockedURLs', { urls: BLOCK });
  // Supabase и config.js — подмена в браузере
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/*', requestStage: 'Request' }, { urlPattern: '*js/core/config.js*', requestStage: 'Response' }] });
  subs.add(d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const rq = d.params.request, u = rq.url, rid = d.params.requestId;
    const reply = (code, body, type = 'application/json') => send('Fetch.fulfillRequest', { requestId: rid, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }, { name: 'Content-Range', value: '0-0/0' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
    if (/js\/core\/config\.js/.test(u)) {
      const body = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8').replace(/^const STUDIO_ONE = (true|false);/m, `const STUDIO_ONE = ${net.flag !== false};`);
      return reply(200, body, 'text/javascript; charset=utf-8');
    }
    if (rq.method === 'OPTIONS') return reply(204, '');
    net.log.push(rq.method + ' ' + u.replace(/^https:\/\/[^/]+/, '').slice(0, 160));
    if (rq.method !== 'GET' && rq.method !== 'HEAD') { if (!/\/rpc\//.test(u) && !/\/auth\//.test(u)) net.writes.push(rq.method + ' ' + u); return reply(/\/rpc\//.test(u) ? 200 : 403, /\/rpc\//.test(u) ? 'null' : '{"message":"запись в тесте запрещена"}'); }
    if (/\/rest\/v1\/ugc_games/.test(u)) {
      const q = decodeURIComponent(u);
      if (/status=eq\.public/.test(q)) { if (net.failCat > 0) { net.failCat--; return reply(500, '{"code":"XX000","message":"тестовый отказ"}'); } return reply(200, JSON.stringify(CAT)); }
      if (/author=eq\./.test(q)) return reply(200, JSON.stringify(MINE));
      return reply(200, '[]');
    }
    return reply(200, /\/auth\//.test(u) ? '{}' : '[]');
  });
  const L = { d37_perf: 'mid', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_s3_tut: '1', d37_s3_learn: '1', d37_fsr: 'native', d37_theme: net.theme || 'dark' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const shot = async (name, o = {}) => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: !!o.full }); const f = path.join(SHOTS, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && document.readyState === 'complete' && typeof gamesLoadScript === 'function'`;
const S3 = `window.GAME_IMPL?.studio3d?._test?.state()`;
const VIEW = { phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, pc: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } };
async function setView(B, v){
  await B.send('Emulation.setDeviceMetricsOverride', VIEW[v]);
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: v === 'phone', maxTouchPoints: v === 'phone' ? 5 : 1 });
  if (v === 'phone') await B.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
}

// ═══ Путь человека ═══
async function walk(port, view, theme){
  const tag = `${view}-${theme}`;
  const net = { log: [], writes: [], failCat: 1, theme, flag: true };
  const B = await chrome(net);
  try {
    await setView(B, view);
    await B.send('Page.navigate', { url: `http://localhost:${port}/` });
    ok(await B.until(READY, 90000), `${tag}: сайт загрузился`);
    ok(await B.ev(`STUDIO_ONE === true`), `${tag}: STUDIO_ONE включён`);
    await B.ev(`currentUser = { id: 'u-test' }; 1`);   // поддельный вход: только чтение «моих» строк (подменено)
    // мир из прошлого раза в браузере: должен попасть в «Мои проекты»
    await B.ev(`localStorage.setItem('d37_s3_index', JSON.stringify([{ id: 'oldw1234', name: 'Старый мир ${XSS.replace(/'/g, "\\'")}', t: Date.now() - 864e5, n: 7 }])); localStorage.setItem('d37_s3_oldw1234', JSON.stringify({ name: 'Старый мир', objects: [], settings: {} })); 1`);
    await B.ev(`D37Route.go('#/games/studio'); 1`);
    ok(await B.until(`document.querySelectorAll('#gamesStageBox .so-mode').length === 10`, 30000), `${tag}: главная студии — десять карточек «Создать режим»`);
    ok(await B.ev(`!document.querySelector('script[src*="three"]') && !window.THREE`), `${tag}: на главной three.js не загружен`);
    ok(await B.until(`[...document.querySelectorAll('.so-pic img')].length === 10 && [...document.querySelectorAll('.so-pic img')].every(i => i.complete && i.naturalWidth === 480)`, 20000), `${tag}: у всех десяти карточек загрузилась картинка 480 × 270`);
    const names = await B.ev(`[...document.querySelectorAll('.so-mode b')].map(b => b.textContent)`);
    ok(BLANKS.every((b, i) => names[i] === `${b.icon} ${b.name}`), `${tag}: названия карточек — из заготовок`, names);
    ok(await B.ev(`[...document.querySelectorAll('.so-tile')].length === 8 && !!document.querySelector('.so-tile[href="#/games/studio3d/new/grass"]') && !!document.querySelector('.so-tile[href="#/games/studio/new/code"]')`), `${tag}: «Создать» — 3D-мир, шесть шаблонов, «Свой код + ИИ»`);
    ok(await B.until(`!!document.querySelector('.so-mine .so-list')`, 15000), `${tag}: «Мои проекты» загрузились`);
    const mine = await B.ev(`[...document.querySelectorAll('.so-mine .so-row')].map(r => ({ t: r.querySelector('b').textContent, a: [...r.querySelectorAll('a')].map(a => a.getAttribute('href')) }))`);
    ok(mine.some(r => r.t.startsWith('Моя игра <img') && r.a.includes('#/games/studio/play/srvg1')) && mine.some(r => r.t.startsWith('Мой 3D-мир на сайте') && r.a.includes('#/games/studio3d/play/srvw1')) && mine.some(r => r.t.startsWith('Старый мир') && r.a.includes('#/games/studio3d/open/oldw1234')),
      `${tag}: «Мои проекты» — игры с сайта и 3D-мир этого браузера одним списком, у каждого свой адрес`, mine);
    ok(await B.ev(`!window.__xss && !document.querySelector('img[src="x"]')`), `${tag}: чужой текст в названиях не стал разметкой`);
    // «Игры игроков»: первый ответ — отказ → «Повторить» → список по возрасту
    ok(await B.until(`!!document.querySelector('.so-cat .so-err [data-retry="cat"]')`, 15000), `${tag}: «Игры игроков» не загрузились — честная ошибка и «Повторить»`, await B.ev(`document.querySelector('.so-cat')?.textContent`));
    await B.ev(`document.querySelector('.so-cat [data-retry="cat"]').click(); 1`);
    ok(await B.until(`document.querySelectorAll('.so-cat .so-card').length > 0`, 15000), `${tag}: «Повторить» — список загрузился`);
    const cat = await B.ev(`[...document.querySelectorAll('.so-cat .so-card b')].map(b => b.textContent)`);
    ok(cat.some(t => t.startsWith('Детская игра')) && cat.some(t => t.startsWith('Мир без метки')) && !cat.some(t => t.startsWith('Игра 16 плюс')), `${tag}: «Игры игроков» по возрасту, как /hub (16+ скрыта, без метки видна)`, cat);
    await B.ev(`window.scrollTo(0, 0); 1`); await sleep(400);
    await B.shot(`home-${tag}`, { full: false });
    await B.shot(`home-${tag}-full`, { full: true });
    // ── «Царь горы» → мир с окном режима ──
    const idx0 = await B.ev(`JSON.parse(localStorage.getItem('d37_s3_index') || '[]').length`);
    await B.ev(`document.querySelector('.so-mode[data-blank="m-koth"]').click(); 1`);
    ok(await B.until(`(${S3})?.SC && (${S3})?.placeId && document.querySelector('.s3x-sheet[data-sheet="mode"]')`, 90000), `${tag}: «Царь горы» — мир открыт, окно «🎮 Режим игры и ракурс» открыто`, await B.ev(`document.querySelector('.s3-loading')?.textContent || ''`));
    const st = await B.ev(`(() => { const e = ${S3}; return { mode: e.SC.settings?.game?.mode, age: e.SC.settings?.age, name: e.q('.s3-name').value, hill: e.SC.all().some(o => o.touch === 'hill'), url: location.pathname + location.hash, title: document.querySelector('.s3x-sheet[data-sheet="mode"]')?.textContent.includes('Режим игры и ракурс') }; })()`);
    ok(st.mode === 'koth' && st.age === 12 && st.name === 'Царь горы' && st.hill && st.title, `${tag}: новый мир — заготовка «Царь горы» (режим koth, 12+, зона холма)`, st);
    ok(/studio3d\/open\/[a-z0-9]+$/.test(st.url), `${tag}: адрес стал open/<мир> (обновил страницу — тот же мир)`, st.url);
    await B.until(`JSON.parse(localStorage.getItem('d37_s3_index') || '[]').length > ${idx0}`, 10000); await sleep(1000);   // сохранение мира — асинхронное
    ok(await B.ev(`JSON.parse(localStorage.getItem('d37_s3_index') || '[]').length`) === idx0 + 1, `${tag}: в браузере ровно один новый мир`, await B.ev(`localStorage.getItem('d37_s3_index')`));
    ok(await B.ev(`!!document.querySelector('.s3x-sheet[data-sheet="mode"] [data-go="play"]') && !!document.querySelector('.s3x-sheet[data-sheet="mode"] [data-go="test"]')`), `${tag}: в окне есть «▶ Проверить» и «👥 Вдвоём»`);
    await sleep(1500);
    await B.shot(`mode-${tag}`);
    // ползунок
    const sl = await B.ev(`(() => { const r = document.querySelector('.s3x-sheet[data-sheet="mode"] input[type=range][data-g]'); if (!r) return null; const k = r.dataset.g, v0 = +r.value, v = +r.value === +r.max ? +r.min : +r.max; r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return { k, v0, v, now: (${S3}).SC.settings.game[k] }; })()`);
    ok(sl && sl.now === sl.v && sl.v !== sl.v0, `${tag}: ползунок правил двигается и меняет режим`, sl);
    // ▶ Проверить
    await B.ev(`document.querySelector('.s3x-sheet[data-sheet="mode"] [data-go="play"]').click(); 1`);
    ok(await B.until(`!!(${S3})?.playing`, 30000), `${tag}: «▶ Проверить» — игра пошла`);
    await sleep(2500);
    await B.shot(`play-${tag}`);
    await B.ev(`(${S3}).q('[data-a="play"]').click(); 1`);   // та же кнопка «▶ Играть / ■ Стоп» верхней панели
    ok(await B.until(`!(${S3})?.playing`, 15000), `${tag}: «Стоп» — снова редактор`);
    const placeId = await B.ev(`(${S3}).placeId`);
    // «←» редактора — на главную студии
    await B.ev(`(${S3}).q('[data-a="exit"]').click(); 1`);
    ok(await B.until(`!(${S3}) && !!document.querySelector('#gamesStageBox .so-mine .so-list')`, 20000), `${tag}: «←» в редакторе — главная студии`, await B.ev('location.pathname + location.hash'));
    const row = await B.ev(`(() => { const a = document.querySelector('.so-mine a[href="#/games/studio3d/open/${placeId}"]'); return a ? a.closest('.so-row').querySelector('b').textContent : null; })()`);
    ok(row === 'Царь горы', `${tag}: «Мои проекты» показывает новый режим «Царь горы»`, row);
    // он же открывается своим адресом, с ползунком как поставили
    await B.ev(`document.querySelector('.so-mine a[href="#/games/studio3d/open/${placeId}"]').click(); 1`);
    ok(await B.until(`(${S3})?.SC && (${S3})?.placeId === '${placeId}'`, 60000), `${tag}: из «Моих проектов» открылся именно этот мир`);
    ok(await B.ev(`(${S3}).SC.settings?.game?.${sl?.k || 'x'} === ${JSON.stringify(sl?.v)}`), `${tag}: настройка режима сохранилась`);
    // неизвестная заготовка
    const idx1 = await B.ev(`JSON.parse(localStorage.getItem('d37_s3_index') || '[]').length`);
    await B.ev(`D37Route.go('#/games/studio3d/new/m-nope'); 1`);
    await B.until(`(${S3})?.SC && (${S3})?.placeId`, 60000); await sleep(800);
    ok(await B.ev(`JSON.parse(localStorage.getItem('d37_s3_index') || '[]').length`) === idx1 && await B.ev(`(${S3}).placeId === '${placeId}'`), `${tag}: неизвестная заготовка мир не создаёт — открыт последний`);
    ok(net.writes.length === 0, `${tag}: в базу ничего не отправлено`, net.writes);
    ok(realErrors(B.errs).length === 0, `${tag}: 0 ошибок в консоли`, realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}

// ═══ Флаг выключен — прежняя главная ═══
async function flagOff(port){
  const net = { log: [], writes: [], failCat: 0, theme: 'dark', flag: false };
  const B = await chrome(net);
  try {
    await setView(B, 'pc');
    await B.send('Page.navigate', { url: `http://localhost:${port}/#/games/studio` });
    ok(await B.until(READY, 90000), 'выкл: сайт загрузился');
    ok(await B.ev(`STUDIO_ONE === false`), 'выкл: STUDIO_ONE = false');
    ok(await B.until(`!!document.querySelector('#gamesStageBox .st-tpls')`, 30000), 'выкл: прежняя главная «Студии игр» (шаблоны)');
    ok(await B.ev(`!document.querySelector('.so') && !window.D37StudioHome && !window.D37StudioBlanks`), 'выкл: новая главная и список карточек не загружены');
    ok(await B.ev(`/Из шаблона — без кода/.test(document.querySelector('#gamesStageBox').textContent) && /Мои игры/.test(document.querySelector('#gamesStageBox').textContent)`), 'выкл: тексты прежней главной на месте');
    await B.shot('flag-off-pc');
    ok(net.writes.length === 0, 'выкл: в базу ничего не отправлено', net.writes);
    ok(realErrors(B.errs).length === 0, 'выкл: 0 ошибок в консоли', realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}

// ═══ Картинки карточек: снимок каждой заготовки ═══
async function shots(port){
  const net = { log: [], writes: [], failCat: 0, theme: 'dark', flag: true };
  const B = await chrome(net);
  const out = path.join(SITE, 'img/studio/modes'); fs.mkdirSync(out, { recursive: true });
  try {
    await setView(B, 'pc');
    await B.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await B.send('Page.navigate', { url: `http://localhost:${port}/` });
    ok(await B.until(READY, 90000), 'снимки: сайт загрузился');
    for (const b of BLANKS) {
      await B.ev(`D37Route.go('#/games/studio3d/new/${b.id}'); 1`);
      const okW = await B.until(`(${S3})?.SC && (${S3})?.fromBlank === '${b.id}' && !document.querySelector('.s3-loading')`, 90000);
      ok(okW, `снимки: ${b.id} открыт`);
      if (!okW) continue;
      // без окон и кнопок (видно только сам мир); камера — по диагонали сверху, чуть ближе, чем «весь мир в кадре» редактора
      await B.ev(`window.D37E.s3ui?.closeSheet?.(); (() => { let s = document.getElementById('shot-css'); if (!s) { s = document.createElement('style'); s.id = 'shot-css'; s.textContent = '.s3 *{visibility:hidden!important}.s3 canvas{visibility:visible!important}'; document.head.appendChild(s); }
        const e = ${S3}, T3 = e.R.T, b = new T3.Box3(); for (const o of e.SC.all()) if (['Part', 'Spawn', 'Prefab', 'Model'].includes(o.cls)) b.union(e.SC.box(o));
        const c = b.getCenter(new T3.Vector3()), s3 = b.getSize(new T3.Vector3()), r = Math.max(12, Math.min(150, Math.hypot(s3.x, s3.z) * .52 + s3.y * .5)), yaw = .7, pitch = .58;
        Object.assign(e.cam, { yaw, pitch, x: c.x + Math.sin(yaw) * Math.cos(pitch) * r, y: c.y + Math.sin(pitch) * r, z: c.z + Math.cos(yaw) * Math.cos(pitch) * r }); })(); 1`);
      await sleep(3500);   // тени, деревья, небо
      // где мир виден: пересечение окна мира и холста (над холстом бывает полоса панели)
      const r = await B.ev(`(() => { const v = (${S3}).box.querySelector('.s3-view').getBoundingClientRect(), c = (${S3}).box.querySelector('.s3-view canvas, canvas.s3-gl').getBoundingClientRect();
        const x = Math.max(v.left, c.left), y = Math.max(v.top, c.top), x2 = Math.min(v.right, c.right), y2 = Math.min(v.bottom, c.bottom); return { x: x + 2 + scrollX, y: y + 2 + scrollY, w: x2 - x - 4, h: y2 - y - 4 }; })()`);   // clip — в координатах страницы (окно студии fixed, страница могла прокрутиться)
      // 16 : 9 по центру окна мира
      let w = r.w, h = w * 9 / 16; if (h > r.h) { h = r.h; w = h * 16 / 9; }
      const clip = { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, width: w, height: h, scale: 480 / w };
      if (process.env.SHOT_DEBUG) { console.log(JSON.stringify({ r, clip, at: await B.ev(`(() => { const el = document.elementFromPoint(${clip.x + clip.width / 2}, ${clip.y + 10}); return el ? el.tagName + '.' + el.className + ' ' + JSON.stringify(el.getBoundingClientRect()) : null; })()`) })); await B.shot('debug-' + b.id); }
      const img = await B.send('Page.captureScreenshot', { format: 'webp', quality: 72, clip });
      const f = path.join(out, b.id + '.webp'); fs.writeFileSync(f, Buffer.from(img.data, 'base64'));
      console.log('  картинка', f, Math.round(fs.statSync(f).size / 1024) + ' КБ');
    }
    ok(net.writes.length === 0, 'снимки: в базу ничего не отправлено', net.writes);
    ok(realErrors(B.errs).length === 0, 'снимки: 0 ошибок в консоли', realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}

(async () => {
  const port = 6100 + Math.floor(Math.random() * 300);
  const srv = startServe(port);
  try {
    ok(await waitPort(port), 'scripts/serve.py запустился');
    if (MODE === 'shots') await shots(port);
    else {
      for (const [v, t] of [['phone', 'dark'], ['phone', 'light'], ['pc', 'dark'], ['pc', 'light']]) await walk(port, v, t);   // по одному Chrome за раз
      await flagOff(port);
    }
  } catch (e) { fail++; console.log('ОШИБКА', e.stack || e.message); }
  finally { srv.kill(); }
  console.log(`\nstudio-home-e2e (${MODE}): ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

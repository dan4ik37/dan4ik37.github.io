// Настоящие адреса разделов (js/ui/router.js) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на scripts/serve.py:
//  открыть по адресу (/chat, /profile, /play/2048), старые ссылки #/…, переходы без перезагрузки, «Назад»/«Вперёд», location.hash
//  = '#/…', игра открыть/закрыть, 404 и переадресации, откат ROUTING = 'hash', «игра поверх мира» (MirPlay) в режиме адресов;
//  скорость и утечки: 100 переходов — время, слушатели, память; первая загрузка на профиле телефона (CPU ×4).
//  D37_BEFORE=<папка со старым сайтом> — та же первая загрузка у старого сайта (#/…) для сравнения «до/после».
// Запуск из корня сайта: node scripts/routes-e2e.cjs   (Chrome — переменная CHROME; профиль и временное — D37_TMP, по умолчанию
// E:\claude-tmp\routes). Внешние адреса (Supabase, YouTube, реклама, Метрика) заблокированы — проверяем только свой код.
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || 'E:/claude-tmp/routes';
const BEFORE = process.env.D37_BEFORE || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

function startServe(root, port){
  const p = spawn('python', [path.join(root, 'scripts/serve.py'), String(port)], { cwd: root, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' });
  return p;
}
const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res({ status: r.statusCode, location: r.headers.location || '' }); }).on('error', () => res({ status: 0 })));
async function waitPort(port){ for (let i = 0; i < 80; i++) { const r = await getRaw(port, '/robots.txt'); if (r.status) return true; await sleep(150); } return false; }

// только чужие сайты (свой js/features/youtube.js под «*youtube*» не попадает: шаблоны — по имени сайта)
const BLOCK = ['*://*.supabase.co/*', '*://*.googleapis.com/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*',
  '*://*.yandex.ru/*', '*://*.yandex.net/*', '*://yastatic.net/*', '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://*.gstatic.com/*', '*://localhost:*/_vercel/*'];

async function chrome(tag){
  const port = 9700 + Math.floor(Math.random() * 250);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-' + tag + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('Chrome не запустился');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const cb = new Map(), subs = new Set(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text); });
  const C = {
    send, errors, subs,
    load: url => new Promise(r => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); r(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(r, 30000); }),
    ev: async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; },
    until: async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await C.ev(expr)) return true; } catch (e) {} await sleep(100); } return false; },
    close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} },
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: BLOCK });
  // без окошек «Сколько тебе лет?» и «Установи приложение» поверх
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}))}catch(e){}
    (function(){var t0=performance.now();new MutationObserver(function(m,o){var b=document.body;if(b&&b.dataset.route){window.__routeShownAt=performance.now();o.disconnect()}}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-route']})})();` });
  return C;
}
const realErrors = errs => errs.filter(e => !/Failed to fetch|NetworkError|ERR_BLOCKED|ERR_|Load failed|net::|supabase|AbortError|Не загрузилось|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights/i.test(String(e)));

// Первая загрузка на профиле телефона: 412×915, CPU ×4, без кэша; медиана из N раз. Сайты (до/после) — по очереди в одном Chrome,
// чтобы шум машины делился поровну. targets: [[метка, адрес]]
async function firstLoad(targets, n = 7){
  const acc = Object.fromEntries(targets.map(([k]) => [k, { shown: [], dcl: [], load: [] }]));
  const C = await chrome('perf');
  try {
    await C.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true });
    await C.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await C.send('Network.setCacheDisabled', { cacheDisabled: true });
    for (let i = 0; i < n; i++) {
      for (const [k, url] of (i % 2 ? [...targets].reverse() : targets)) {
        await C.load('about:blank');
        await C.load(url);
        await C.until('window.__routeShownAt > 0', 20000);
        const m = await C.ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { shown: window.__routeShownAt || -1, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd }; })()`);
        acc[k].shown.push(m.shown); acc[k].dcl.push(m.dcl); acc[k].load.push(m.load);
      }
    }
  } finally { await C.close(); }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { shown: Math.round(median(v.shown)), dcl: Math.round(median(v.dcl)), load: Math.round(median(v.load)) }]));
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const port = 5800 + Math.floor(Math.random() * 150);
  const srv = startServe(SITE, port);
  const BASE = 'http://localhost:' + port;
  let C = null;
  try {
    ok(await waitPort(port), 'scripts/serve.py запустился');
    // ── сервер: адреса как на Vercel ──
    for (const [p, st] of [['/', 200], ['/chat', 200], ['/play/2048', 200], ['/profile/vip', 200], ['/shop/o/D37-x', 200], ['/robots.txt', 200], ['/nope-xyz', 404], ['/forum', 404], ['/api/feed', 404]])
      ok((await getRaw(port, p)).status === st, `serve.py: ${p} → ${st}`);
    let r = await getRaw(port, '/home');
    ok(r.status === 308 && r.location === '/', '/home → 308 на «/»', r);
    r = await getRaw(port, '/games/chess/abcd');
    ok(r.status === 307 && r.location === '/play/chess/abcd', '/games/chess/abcd → 307 на /play/chess/abcd', r);
    r = await getRaw(port, '/chat/');
    ok(r.status === 308 && r.location === '/chat', '/chat/ → /chat (без косой черты в конце)', r);

    C = await chrome('func');
    await C.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const route = () => C.ev('document.body.dataset.route');
    const where = () => C.ev('location.pathname + location.search + location.hash');
    // 1) открыть по адресу
    await C.load(BASE + '/chat');
    ok(await C.until(`document.body.dataset.route === 'chat'`, 25000), '/chat — открылся раздел «Чат»', await C.ev(`JSON.stringify({ r: document.body && document.body.dataset.route, u: location.href, t: document.title, ready: document.readyState })`).catch(e => String(e)));
    ok(await where() === '/chat', 'адрес остался /chat', await where());
    ok(/Чат dan4ik37/.test(await C.ev('document.title')) && await C.ev(`document.querySelector('link[rel=canonical]').href`) === 'https://dan4ik37.vercel.app/chat', 'заголовок и canonical раздела');
    ok(await C.ev(`document.baseURI`) === BASE + '/' && await C.ev(`[...document.scripts].filter(s => s.src).every(s => !s.src.includes('/chat/'))`), '<base href="/">: скрипты — от корня, а не от /chat/');
    // 2) переходы без перезагрузки, «Назад»/«Вперёд»
    await C.ev('window.__mark = 42; 1');
    await C.ev(`document.querySelector('.nav-links a[data-route="forum"]').click(); 1`);
    ok(await C.until(`document.body.dataset.route === 'forum'`), 'клик «Форум» в меню → раздел форума');
    ok(await where() === '/forum' && await C.ev('window.__mark') === 42, 'адрес /forum, страница не перезагружалась');
    await C.ev(`document.querySelector('.nav-links a[data-route="ideas"]').click(); 1`);
    ok(await C.until(`document.body.dataset.route === 'ideas'`) && await where() === '/ideas', 'клик «Идеи» → /ideas');
    await C.ev('history.back(); 1');
    ok(await C.until(`document.body.dataset.route === 'forum' && location.pathname === '/forum'`), '«Назад» → /forum');
    await C.ev('history.back(); 1');
    ok(await C.until(`document.body.dataset.route === 'chat' && location.pathname === '/chat'`), '«Назад» → /chat');
    await C.ev('history.forward(); 1');
    ok(await C.until(`document.body.dataset.route === 'forum' && location.pathname === '/forum'`) && await C.ev('window.__mark') === 42, '«Вперёд» → /forum, без перезагрузки');
    // 3) старая ссылка и location.hash = '#/…'
    await C.load(BASE + '/#/ideas');
    ok(await C.until(`document.body.dataset.route === 'ideas'`) && await where() === '/ideas', 'старая ссылка /#/ideas → /ideas', await where());
    const len0 = await C.ev('history.length');
    await C.ev(`location.hash = '#/donate'; 1`);
    ok(await C.until(`document.body.dataset.route === 'donate'`) && await where() === '/donate', 'location.hash = «#/donate» → /donate', await where());
    ok(await C.ev('history.length') === len0 + 1, 'одна запись в истории за переход', [len0, await C.ev('history.length')]);
    await C.ev('history.back(); 1');
    ok(await C.until(`document.body.dataset.route === 'ideas' && location.pathname === '/ideas'`), '«Назад» после старой записи → /ideas');
    // 4) игра: открыть по адресу, закрыть
    await C.load(BASE + '/play/2048');
    ok(await C.until(`typeof gamesActive !== 'undefined' && gamesActive === '2048' && document.getElementById('gamesStageBox').childElementCount > 0`, 20000), '/play/2048 — игра открылась (файлы игры — от корня)');
    ok(/2048/.test(await C.ev('document.title')) && await C.ev(`document.querySelector('meta[name=robots]')?.content`) === 'noindex', 'игра: заголовок с названием, noindex (страница для поиска — /games/2048)');
    await C.ev(`document.querySelector('.gm-back').click(); 1`);
    ok(await C.until(`gamesActive === null && location.pathname === '/play' && !document.getElementById('gamesHub').hidden`), '«← Все игры» → /play, витрина', await where());
    await C.ev(`document.querySelector('#gamesGrid a.gm-card[href="/play/2048"]')?.click(); 1`);
    ok(await C.until(`gamesActive === '2048' && location.pathname === '/play/2048'`), 'карточка игры (href="/play/2048") → игра без перезагрузки');
    // 5) профиль — noindex; витрина «Сегодня» на главной — настоящие адреса
    await C.load(BASE + '/profile');
    ok(await C.until(`document.body.dataset.route === 'profile'`) && await C.ev(`document.querySelector('meta[name=robots]')?.content`) === 'noindex', '/profile — noindex');
    await C.load(BASE + '/');
    ok(await C.until(`document.body.dataset.route === 'home'`) && await where() === '/', '/ — главная');
    ok(await C.until(`!!document.querySelector('#today a.today-card[href="/play/words"]')`, 8000), '«Сегодня на сайте» — ссылки /play/…');
    ok(await C.ev(`!document.querySelector('meta[name=robots]') && document.querySelector('link[rel=canonical]').href === 'https://dan4ik37.vercel.app/'`), 'главная: canonical «/», индексируется');
    // 6) 404
    await C.load(BASE + '/nope-xyz');
    ok(/Страница не найдена/.test(await C.ev('document.title')), 'мусорный адрес — страница 404');
    // 7) «Игра поверх мира» в режиме адресов: переходы игры — в окне, адрес мира на месте, «Назад» закрывает окно
    await C.load(BASE + '/play');
    ok(await C.until(`document.body.dataset.route === 'games'`), 'витрина игр');
    await C.ev(`D37Route.setUrl('#/games/world'); 1`);
    await C.ev(`gamesLoadScript('js/games/mir-play.js').then(() => MirPlay.open('2048', null, { wrap: document.body })).then(v => (window.__mp = v))`);
    ok(await C.until(`window.__mp === true && MirPlay.isOpen() && MirPlay.state().phase !== 'loading'`, 15000), 'MirPlay.open(2048) поверх «мира»', await C.ev('MirPlay.state()'));
    const r0 = await route();
    await C.ev(`location.hash = '#/games/2048/zz9zz9'; 1`);
    ok(await C.until(`MirPlay.state()?.param === 'zz9zz9'`, 8000), 'переход игры (location.hash) — в том же окне', await C.ev('MirPlay.state()'));
    ok(await where() === '/play/world' && await route() === r0, 'адрес мира (/play/world) на месте, раздел не менялся', await where());
    await C.ev('history.back(); 1');
    ok(await C.until(`!MirPlay.isOpen()`, 8000) && await where() === '/play/world', '«Назад» — окно закрыто, адрес мира', await where());
    ok(realErrors(C.errors).length === 0, 'без ошибок в консоли (режим адресов)', realErrors(C.errors).slice(0, 5));

    // 8) скорость и утечки: 100 переходов
    await C.load(BASE + '/');
    await C.until(`document.body.dataset.route === 'home'`);
    await C.ev(`document.body.classList.add('low'); 1`);   // без затухания 150 мс — меряем саму работу перехода
    const winId = (await C.send('Runtime.evaluate', { expression: 'window' })).result.objectId;
    const listeners = async () => {
      const { listeners: L } = await C.send('DOMDebugger.getEventListeners', { objectId: winId });
      const c = {}; for (const l of L) c[l.type] = (c[l.type] || 0) + 1; return c;
    };
    const heap = async () => { await C.send('HeapProfiler.collectGarbage'); await sleep(200); await C.send('HeapProfiler.collectGarbage'); return (await C.send('Runtime.getHeapUsage')).usedSize; };
    await C.send('HeapProfiler.enable');
    const SEQ = ['#/chat', '#/forum', '#/ideas', '#/shorts', '#/donate', '#/lfg', '#/poll', '#/soundboard', '#/profile', '#/shop', '#/about', '#/games', '#/home'];
    const walkRoutes = async n => C.ev(`(async () => { const S = ${JSON.stringify(SEQ)}, t = []; for (let i = 0; i < ${n}; i++) { const h = S[i % S.length], want = h.slice(2) || 'home';
        const t0 = performance.now(); D37Route.go(h); while (document.body.dataset.route !== want || D37Route.hash() !== h) await new Promise(r => setTimeout(r, 0)); t.push(performance.now() - t0); }
        t.sort((a, b) => a - b); return { med: t[t.length >> 1], p95: t[Math.floor(t.length * .95)], max: t[t.length - 1] }; })()`);
    await walkRoutes(26);   // прогрев: разделы один раз нарисовались
    const l0 = await listeners(), h0 = await heap();
    const T = await walkRoutes(100);
    const l1 = await listeners(), h1 = await heap();
    const grew = Object.keys({ ...l0, ...l1 }).filter(k => (l1[k] || 0) !== (l0[k] || 0)).map(k => `${k}: ${l0[k] || 0}→${l1[k] || 0}`);
    ok(grew.length === 0, 'после 100 переходов слушатели окна не размножились', grew);
    ok(h1 - h0 < 2e6, `память после 100 переходов: ${((h1 - h0) / 1e6).toFixed(2)} МБ (меньше 2 МБ)`, [h0, h1]);
    ok(T.med < 50, `переход раздела: медиана ${T.med.toFixed(1)} мс, p95 ${T.p95.toFixed(1)}, макс ${T.max.toFixed(1)}`, T);
    console.log(`100 переходов: медиана ${T.med.toFixed(1)} мс, p95 ${T.p95.toFixed(1)} мс, макс ${T.max.toFixed(1)} мс; память ${((h1 - h0) / 1e6).toFixed(2)} МБ; слушатели окна: ${JSON.stringify(l1)}`);
    ok(realErrors(C.errors).length === 0, 'без ошибок в консоли после 100 переходов', realErrors(C.errors).slice(0, 5));
    await C.close(); C = null;

    // 9) откат: ROUTING = 'hash' (config.js подменяем в браузере)
    C = await chrome('hash');
    await C.send('Fetch.enable', { patterns: [{ urlPattern: '*js/core/config.js*', requestStage: 'Response' }] });
    C.subs.add(async d => {
      if (d.method !== 'Fetch.requestPaused') return;
      const body = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8').replace("const ROUTING = 'path';", "const ROUTING = 'hash';");
      C.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
    });
    await C.load(BASE + '/chat');
    ok(await C.until(`typeof D37Route !== 'undefined' && D37Route.mode === 'hash' && document.body.dataset.route === 'chat'`), 'ROUTING = hash: раздел «Чат»');
    ok(await where() === '/#/chat', 'ROUTING = hash: адрес /#/chat (как раньше)', await where());
    await C.ev('window.__mark = 7; 1');
    await C.ev(`document.querySelector('.nav-links a[data-route="forum"]').click(); 1`);
    ok(await C.until(`document.body.dataset.route === 'forum'`) && await where() === '/#/forum' && await C.ev('window.__mark') === 7, 'ROUTING = hash: клик /forum → /#/forum без перезагрузки', await where());
    await C.ev('history.back(); 1');
    ok(await C.until(`document.body.dataset.route === 'chat'`) && await where() === '/#/chat', 'ROUTING = hash: «Назад»');
    ok(realErrors(C.errors).length === 0, 'без ошибок в консоли (режим hash)', realErrors(C.errors).slice(0, 5));
    await C.close(); C = null;

    // 10) первая загрузка на профиле телефона (CPU ×4): до (старый сайт, #/…) и после — по очереди
    const PAIRS = [['/', '/#/home'], ['/chat', '/#/chat'], ['/play/2048', '/#/games/2048']];
    const haveBefore = BEFORE && fs.existsSync(path.join(BEFORE, 'index.html'));
    const bport = port + 200, bsrv = haveBefore ? startServe(BEFORE, bport) : null;
    try {
      if (bsrv) await waitPort(bport);
      const targets = PAIRS.flatMap(([a, b]) => [['после ' + a, BASE + a], ...(bsrv ? [['до ' + b, `http://localhost:${bport}${b}`]] : [])]);
      const R = await firstLoad(targets);
      console.log('первая загрузка (телефон 412×915, CPU ×4, без кэша, медиана из 7; shown — раздел показан, dcl — DOMContentLoaded, мс):');
      for (const [k, v] of Object.entries(R)) console.log(`  ${k.padEnd(22)} shown ${v.shown}  dcl ${v.dcl}  load ${v.load}`);
      ok(PAIRS.every(([a]) => R['после ' + a].shown > 0), 'первая загрузка: раздел показан');
      if (bsrv) for (const [a, b] of PAIRS) {
        const x = R['после ' + a], y = R['до ' + b];
        ok(x.shown <= y.shown * 1.1 + 60, `первая загрузка ${a}: ${x.shown} мс против ${y.shown} мс у старого ${b} (не медленнее, допуск 10 %)`, { after: x, before: y });
      }
    } finally { bsrv?.kill(); }
  } finally {
    if (C) await C.close();
    srv.kill();
  }
  console.log(`\nroutes-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// Проверка sw.js и приложения в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): свой маленький сервер сайта, чтобы
// подменять sw.js (старый → новый → ещё новее) и «выключать интернет» (сервер перестаёт отвечать).
//  1) старый sw.js (dan4ik37-shell-v2) → новый встаёт сам, без кнопки, старый кэш удалён;
//  2) оболочка в кэше: главная, офлайн-страница, скрипты index.html, supabase-js; реклама/API/Supabase — не в кэше;
//  3) сервер «упал»: главная открывается из кэша, сайт живой; серверная страница → офлайн-страница; судоку — играется;
//  4) новая версия sw.js ждёт → «Доступна новая версия» → «Обновить» → перезагрузка, кэш новой версии.
// Запуск из корня сайта: node scripts/pwa-e2e.cjs   (Chrome — переменная CHROME или стандартный путь Windows)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn, execSync } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// ── сервер: файлы сайта; sw.js — какой скажем; down — «нет интернета» ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const S = { sw: null, down: false };
const OLD_SW = (() => { try { return execSync('git show 64206b0:sw.js', { cwd: SITE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return null; } })();
const server = http.createServer((req, res) => {
  if (S.down) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/sw.js' && S.sw) { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' }); res.end(S.sw); return; }
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', Date: new Date().toUTCString() });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port;
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('Chrome не запустился');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), subs = new Set(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => { if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text); });
  const load = url => new Promise(r => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); r(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(r, 20000); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(250); } return false; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}))}catch(e){}` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const cacheNames = () => ev('caches.keys()');
  const cacheHas = (name, url) => ev(`caches.open(${JSON.stringify(name)}).then(c => c.match(${JSON.stringify(url)})).then(r => !!r)`);
  try {
    // 1) старый sw.js → новый
    if (OLD_SW) {
      S.sw = OLD_SW;   // адрес тот же (/sw.js): раньше его регистрировал push-pwa.js, теперь app.js
      await load(BASE + '/#/home');
      ok(await until(`navigator.serviceWorker.controller && caches.has('dan4ik37-shell-v2')`), 'старый sw.js встал (кэш dan4ik37-shell-v2)');
      S.sw = null;   // дальше — sw.js из репозитория
      await ev(`navigator.serviceWorker.getRegistration().then(r => r.update())`);
      ok(await until(`caches.keys().then(k => k.includes('d37-shell-v3') && !k.includes('dan4ik37-shell-v2'))`, 20000), 'новый sw.js встал сам (без кнопки), старый кэш удалён', await cacheNames());
      ok(!(await ev(`!!document.getElementById('appUpdate')`)), 'при переходе со старого sw.js полоски «Новая версия» нет');
    } else {
      console.log('(git show 64206b0:sw.js недоступен — переход со старого sw.js не проверяем)');
      await load(BASE + '/#/home');
      ok(await until(`navigator.serviceWorker.controller && caches.has('d37-shell-v3')`, 20000), 'sw.js встал');
    }
    // 2) оболочка
    await load(BASE + '/?r=1#/games/sudoku');
    await sleep(3500);
    const names = await cacheNames();
    const shell = names.find(n => /^d37-shell-/.test(n));
    ok(!!shell, 'кэш оболочки есть', names);
    ok(await cacheHas(shell, BASE + '/') && await cacheHas(shell, BASE + '/offline.html'), 'главная и офлайн-страница в кэше');
    ok(await cacheHas(shell, BASE + '/js/features/app.js') && await cacheHas(shell, BASE + '/css/app.css'), 'скрипты и стили index.html в кэше');
    ok(await ev(`caches.match('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js').then(r => !!r)`), 'supabase-js в кэше');
    const keys = await ev(`Promise.all(${JSON.stringify(names)}.filter(n => /^d37-/.test(n)).map(n => caches.open(n).then(c => c.keys()).then(k => k.map(r => r.url)))).then(a => a.flat())`);
    ok(!keys.some(u => /\/api\/|\/go\/|googlesyndication|doubleclick|yandex|supabase\.co|_vercel|ytimg|youtube\.com/.test(u)), 'в кэше нет API, рекламы, Метрики, Supabase', keys.filter(u => /\/api\/|googlesyndication|yandex|supabase\.co/.test(u)));
    ok(keys.some(u => /\/js\/games\/sudoku\.js\?v=/.test(u)), 'файл судоку (?v=) — в кэше после открытия');
    // 3) «нет интернета»
    S.down = true;
    await load(BASE + '/?r=2#/home');
    ok(await until(`typeof showPage === 'function' && document.body.dataset.route === 'home'`, 15000), 'без сети главная открылась из кэша, сайт живой');
    await ev(`location.hash = '#/games/sudoku'; 1`);
    ok(await until(`!!(window.GAME_IMPL && GAME_IMPL.sudoku) && !!document.querySelector('#gamesStage .sd-grid')`, 15000), 'без сети судоку открылось и рисуется');
    await load(BASE + '/videos');
    ok(await until(`/Нет интернета/.test(document.body.innerText)`, 10000), 'серверная страница без сети → офлайн-страница');
    ok(await until(`document.querySelectorAll('.g:not(.off)').length >= 1`, 5000), 'офлайн-страница видит игры в кэше');
    S.down = false;
    // 4) новая версия sw.js ждёт → «Обновить»
    const cur = fs.readFileSync(path.join(SITE, 'sw.js'), 'utf8');
    S.sw = cur.replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'");
    await load(BASE + '/?r=3#/home');
    await sleep(1500);
    await ev(`navigator.serviceWorker.getRegistration().then(r => r.update())`);
    ok(await until(`navigator.serviceWorker.getRegistration().then(r => !!r.waiting)`, 20000), 'новая версия sw.js установилась и ждёт');
    ok(await until(`!!document.getElementById('appUpdate')`, 8000), 'появилось «Доступна новая версия — Обновить»');
    await ev(`document.querySelector('#appUpdate [data-upd="go"]').click(); 1`);
    await sleep(3000);
    ok(await until(`caches.keys().then(k => k.some(n => /-next$/.test(n)))`, 15000), '«Обновить» → новая версия встала, кэш новой версии', await cacheNames().catch(() => []));
    ok(await until(`navigator.serviceWorker.getRegistration().then(r => !r.waiting && !!r.active)`, 8000), 'ожидающей версии больше нет');
    ok(errors.filter(e => !/Failed to fetch|NetworkError|_vercel|ERR_/.test(e)).length === 0, 'без ошибок в консоли', errors.slice(0, 5));
  } finally {
    ws.close(); proc.kill(); server.close(); await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(`\npwa-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

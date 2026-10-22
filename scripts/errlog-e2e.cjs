// Мониторинг ошибок сайта (T-016) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на scripts/serve.py:
//  страница открывается по настоящему адресу https://dan4ik37.vercel.app/, но запросы к нему Chrome отдаёт сам скрипт (Fetch.requestPaused →
//  scripts/serve.py на localhost; в сеть Chrome не выходит вообще: DNS закрыт), поэтому POST /api/diag перехватывается;
//  1) без ошибок — этап 1 стоит, файл этапа 2 не грузится, на /api/diag ничего не уходит;
//  2) ошибки (исключение, промис, не загрузившийся скрипт, свой d37Err) → этап 2 подгружен ОДИН раз → одна пачка с очищенным текстом,
//     версией, браузером, системой, устройством, разделом; запроса и токенов в пачке нет; ответ { stop } запоминается;
//  3) затраты: разбор + запуск этапа 1 (на профиле телефона, CPU ×4) и первая загрузка главной «с блоком» и «без блока» — медианы.
// Запуск из корня сайта: node scripts/errlog-e2e.cjs   (Chrome — переменная CHROME; профиль и временное — D37_TMP, по умолчанию
// E:\claude-tmp\ops). Внешние адреса (Supabase, YouTube, реклама, Метрика) заблокированы — проверяем только свой код.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/ops' : os.tmpdir());
const PORT = 5593;
const ORIGIN = 'https://dan4ik37.vercel.app';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
fs.mkdirSync(TMP, { recursive: true });

const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
const BLOCK = ['*://*.supabase.co/*', '*://*.googleapis.com/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*',
  '*://*.yandex.ru/*', '*://*.yandex.net/*', '*://yastatic.net/*', '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*',
  '*://*.youtube-nocookie.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://*.gstatic.com/*'];

async function chrome(tag) {
  const port = 9300 + Math.floor(Math.random() * 300);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-' + tag + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE cdn.jsdelivr.net', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('Chrome не запустился');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0; const cb = new Map(), subs = new Set();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const C = {
    send, subs,
    load: url => new Promise(r => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); r(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(r, 30000); }),
    ev: async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; },
    until: async (expr, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await C.ev(expr)) return true; } catch (e) {} await sleep(100); } return false; },
    close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} },
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: BLOCK });
  // без окошек «Сколько тебе лет?» и «Установи приложение» поверх
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}))}catch(e){}
    window.__e2eErrs=[];addEventListener('error',function(e){var t=e.target;__e2eErrs.push(t&&t!==window&&t.tagName?('res:'+t.tagName+':'+(t.src||t.href)):(e.message+' @'+(e.filename||'')+':'+e.lineno))},true);addEventListener('unhandledrejection',function(e){__e2eErrs.push('rej:'+String(e.reason&&e.reason.message||e.reason))});` });
  return C;
}

// «Сервер» для https://dan4ik37.vercel.app/*: файлы и переписывания — от scripts/serve.py, POST /api/diag — свой ответ, /sw.js — нет (без service worker)
async function virtualServer(C, st) {
  await C.send('Fetch.enable', { patterns: [{ urlPattern: ORIGIN + '/*' }] });
  C.subs.add(async d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = d.params;
    const u = new URL(request.url);
    const reply = (code, headers, body) => C.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(body).toString('base64') });
    try {
      if (u.pathname === '/api/diag') {
        st.posts.push({ method: request.method, body: request.postData || '', type: request.headers['Content-Type'] || request.headers['content-type'] });
        const body = JSON.stringify(typeof st.reply === 'function' ? st.reply(st.posts.length) : st.reply);
        return await reply(200, { 'Content-Type': 'application/json' }, body);
      }
      if (u.pathname.startsWith('/api/')) return await reply(404, { 'Content-Type': 'text/plain' }, 'нет (локально)');
      if (u.pathname.startsWith('/_vercel/')) return await reply(200, { 'Content-Type': 'text/javascript' }, '/* статистика Vercel: на настоящем сайте есть, здесь заглушка */');
      if (u.pathname === '/sw.js') return await reply(404, { 'Content-Type': 'text/plain' }, 'без service worker');
      // свой «сломанный» скрипт: 51 раз одно и то же исключение на строке 1 (настоящий файл и стек в Chrome)
      if (u.pathname === '/js/e2e-throw.js') return await reply(200, { 'Content-Type': 'text/javascript' }, ['function e2eThrow(){ var o = null; return o.nick_e2e_secret.length; }', 'for (var i = 0; i < 51; i++) setTimeout(e2eThrow, 5 + i);', ''].join('\n'));
      if (u.pathname === '/js/core/errlog.js') st.stage2++;
      const r = await fetch('http://127.0.0.1:' + PORT + u.pathname + u.search, { method: request.method, redirect: 'manual' });
      const buf = Buffer.from(await r.arrayBuffer());
      const headers = {};
      r.headers.forEach((v, k) => { if (!/^(content-encoding|transfer-encoding|content-length|connection)$/i.test(k)) headers[k] = v; });
      let body = buf;
      if (st.strip && (u.pathname === '/' || u.pathname === '/index.html')) {
        // документ без блока этапа 1
        let html = buf.toString('utf8');
        const i = html.indexOf('<!-- errlog:begin'), j = html.indexOf('<!-- errlog:end -->');
        if (i >= 0 && j > i) html = html.slice(0, i) + html.slice(j + '<!-- errlog:end -->'.length);
        body = Buffer.from(html);
      }
      return await reply(r.status, headers, body);
    } catch (e) { try { await reply(502, { 'Content-Type': 'text/plain' }, String(e && e.message)); } catch (x) {} }
  });
}

(async () => {
  const serve = spawn('python', [path.join(SITE, 'scripts/serve.py'), String(PORT)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = !!(await getRaw(PORT, '/robots.txt')); if (!up) await sleep(150); }
  if (!up) { console.log('FAIL scripts/serve.py не запустился'); process.exit(1); }
  try {
    // ═══ 1–2. Страница, ошибки, пачка ═══
    {
      const C = await chrome('e2e');
      const st = { posts: [], stage2: 0, reply: { ok: 1, rate: 1 }, strip: false };
      await virtualServer(C, st);
      try {
        await C.load(ORIGIN + '/');
        ok(await C.until('document.body && document.body.dataset.route', 20000), 'страница открылась (роутер показал раздел)');
        await sleep(2500);
        const s1 = await C.ev(`({ ready: !!window.__d37el, q: window.__d37el && window.__d37el.q.length, on: !!(window.__d37el && window.__d37el.on), d37Err: typeof window.d37Err })`);
        console.log('  · после загрузки главной (внешние адреса заблокированы): записей в очереди —', s1.q, ', этап 2 запрошен раз:', st.stage2, ', отправок:', st.posts.length);
        ok(s1.ready && s1.d37Err === 'function', 'этап 1 стоит (window.__d37el, d37Err)', s1);
        ok(st.stage2 === 0 && st.posts.length === 0 && !s1.on, 'без своих ошибок: файл этапа 2 не запрошен, на /api/diag ничего не ушло (реклама, Метрика и шрифты заблокированы — этап 1 их отсеял)', { stage2: st.stage2, posts: st.posts.length });
        const own = await C.ev(`window.__e2eErrs.slice(0, 20)`);
        console.log('  · события ошибок при загрузке главной (до наших искусственных):', own.length ? JSON.stringify(own).slice(0, 700) : 'нет');
        const base = st.posts.length;
        // искусственные ошибки: исключение, необработанный промис, не загрузившийся скрипт, свой d37Err
        await C.ev(`(function () {
          var t = document.createElement('script'); t.src = '/js/e2e-throw.js?v=1'; document.head.appendChild(t);
          setTimeout(function () { Promise.reject(new Error('e2e промис user@mail.ru token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')); }, 20);
          var s = document.createElement('script'); s.src = '/js/e2e-nope.js?token=SECRETQ'; document.head.appendChild(s);
          setTimeout(function () { window.d37Err('e2e.manual', new Error('ручное сообщение')); }, 30);
          return 1; })()`);
        ok(await C.until(`window.__d37el && window.__d37el.on`, 8000), 'после первой ошибки подгрузился этап 2 (window.__d37el.on)');
        for (let i = 0; i < 80 && st.posts.length === base; i++) await sleep(100);
        ok(st.posts.length > base, 'через ~4 с ушла пачка на /api/diag');
        await sleep(500);
        ok(st.stage2 === 1, 'файл этапа 2 запрошен ровно один раз', st.stage2);
        ok(st.posts.length === base + 1, 'пачка одна', st.posts.length - base);
        const P = st.posts[st.posts.length - 1] || { body: '{}' };
        const body = JSON.parse(P.body), items = body.e || [];
        ok(P.method === 'POST' && /text\/plain/.test(P.type || ''), 'POST text/plain', { m: P.method, t: P.type });
        ok(/^chrome\/\d+$/.test(body.b) && body.o === 'windows' && body.d === 'd', 'браузер, система, устройство', body);
        const gv = await C.ev(`typeof GAMES_VER !== 'undefined' ? String(GAMES_VER) : ''`);
        ok(body.v === gv && gv !== '', 'версия сайта = GAMES_VER', { v: body.v, gv });
        const find = re => items.find(x => re.test(x.m));
        const ex = find(/Cannot read properties of null/), rej = find(/e2e промис/), res = items.find(x => x.t === 'r' && /e2e-nope/.test(x.f)), man = find(/e2e\.manual/);
        ok(ex && ex.t === 'e' && ex.n === 51 && ex.r === 'home' && ex.m === "TypeError: Cannot read properties of null (reading 'nick_e2e_secret')" && ex.f === '/js/e2e-throw.js' && ex.l === 1 && /^e2eThrow \/js\/e2e-throw\.js:1:\d+/.test(ex.s), 'исключение: 51 повтор в одной записи, раздел home, текст без «Uncaught», файл без запроса, строка, стек с именем функции', ex);
        ok(rej && rej.t === 'p' && /<email>/.test(rej.m) && !/ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/.test(rej.m), 'промис: тип p, почта и ключ заменены', rej);
        ok(res && res.f === '/js/e2e-nope.js', 'не загрузился скрипт: тип r, путь без запроса', res);
        ok(man && man.t === 'x', 'd37Err: тип x', man);
        ok(ex && rej && res && man && items.length >= 4, 'все четыре искусственные ошибки в пачке', items.map(x => x.m));
        ok(!/user@mail\.ru|SECRETQ/.test(P.body), 'в пачке нет почты и токена из адреса');
        if (ex) console.log('  · исключение в настоящем Chrome: файл', JSON.stringify(ex.f), 'строка', ex.l, 'столбец', ex.c, 'стек', JSON.stringify(ex.s));
        const ls1 = await C.ev(`JSON.parse(localStorage.getItem('d37_el') || 'null')`);
        ok(ls1 && ls1.n === items.length && ls1.s === 1, 'localStorage d37_el: за сутки столько записей, сколько ушло, 1 отправка', { ls1, items: items.length });
        // новый визит: сервер велит молчать → { stop } запоминается, дальше не шлём (и в этом, и в следующем визите)
        st.reply = { ok: 0, stop: 3600 };
        const n1 = st.posts.length;
        await C.load(ORIGIN + '/');
        await C.until('document.body && document.body.dataset.route', 20000);
        await C.ev(`(function () { window.d37Err('e2e.stop.first', new Error('первая')); return 1; })()`);
        for (let i = 0; i < 80 && st.posts.length === n1; i++) await sleep(100);
        ok(st.posts.length === n1 + 1, 'новый визит: пачка ушла');
        await sleep(300);
        const ls2 = await C.ev(`JSON.parse(localStorage.getItem('d37_el') || 'null')`);
        ok(ls2 && ls2.off > Date.now() + 3000e3 && ls2.off < Date.now() + 3700e3, 'ответ { stop: 3600 } запомнен в браузере (off ≈ через час)', ls2);
        await C.ev(`(function () { window.d37Err('e2e.stop.second', new Error('вторая')); return 1; })()`);
        await sleep(6000);
        ok(st.posts.length === n1 + 1, 'после { stop } вторая пачка не уходит');
        await C.load(ORIGIN + '/');
        await C.until('document.body && document.body.dataset.route', 20000);
        await C.ev(`(function () { window.d37Err('e2e.stop.third', new Error('третья')); return 1; })()`);
        await sleep(6000);
        ok(st.posts.length === n1 + 1, 'и в следующем визите — молчим');
      } finally { await C.close(); }
    }

    // ═══ 3. Затраты ═══
    {
      const C = await chrome('perf');
      const st = { posts: [], stage2: 0, reply: { ok: 1 }, strip: false };
      await virtualServer(C, st);
      try {
        await C.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true });
        await C.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await C.load(ORIGIN + '/');
        await C.until('document.body && document.body.dataset.route', 20000);
        const cost = await C.ev(`(function () {
          var el = Array.prototype.find.call(document.scripts, function (s) { return /errHook/.test(s.text); });
          if (!el) return null;
          var code = el.text, n = 400, t0 = performance.now(), i, w;
          for (i = 0; i < n; i++) {
            w = { location: { protocol: 'https:', hostname: 'dan4ik37.vercel.app', pathname: '/' }, addEventListener: function () {}, removeEventListener: function () {} };
            new Function('window', code)(w);
          }
          return { us: (performance.now() - t0) / n * 1000, bytes: code.length };
        })()`);
        console.log('  · этап 1: разбор и запуск —', cost && cost.us.toFixed(0), 'мкс (профиль телефона, CPU ×4), текст', cost && cost.bytes, 'знаков');
        ok(cost && cost.us < 1500, 'этап 1 (разбор + запуск) < 1,5 мс на телефоне', cost);
        // первая загрузка: с блоком и без, по очереди, медианы
        await C.send('Network.setCacheDisabled', { cacheDisabled: true });
        await C.send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){new MutationObserver(function(m,o){var b=document.body;if(b&&b.dataset.route){window.__routeShownAt=performance.now();o.disconnect()}}).observe(document,{subtree:true,attributes:true,attributeFilter:['data-route']})})();` });
        const acc = { 'с': { dcl: [], shown: [] }, 'без': { dcl: [], shown: [] } };
        for (let i = 0; i < 7; i++) {
          for (const k of (i % 2 ? ['без', 'с'] : ['с', 'без'])) {
            st.strip = k === 'без';
            await C.load('about:blank'); await C.load(ORIGIN + '/');
            await C.until('window.__routeShownAt > 0', 20000);
            const m = await C.ev(`(function () { var n = performance.getEntriesByType('navigation')[0]; return { dcl: n.domContentLoadedEventEnd, shown: window.__routeShownAt || -1, has: !!window.__d37el }; })()`);
            if (m.has === st.strip) ok(false, 'вариант «' + k + '» загрузился не так (блок ' + (m.has ? 'есть' : 'нет') + ')');
            acc[k].dcl.push(m.dcl); acc[k].shown.push(m.shown);
          }
        }
        const r = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, { dcl: Math.round(median(v.dcl)), shown: Math.round(median(v.shown)) }]));
        console.log('  · первая загрузка главной, телефон (412×915, CPU ×4, без кэша), медиана из 7: DOMContentLoaded с блоком', r['с'].dcl, 'мс / без', r['без'].dcl, 'мс; раздел показан', r['с'].shown, '/', r['без'].shown, 'мс');
        ok(r['с'].dcl <= r['без'].dcl * 1.1 + 100, 'первая загрузка: с блоком этапа 1 не медленнее, чем без него (запас на шум 10 % + 100 мс)', r);
      } finally { await C.close(); }
    }
  } finally { serve.kill(); }
  console.log(`errlog-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ПАДЕНИЕ:', e && e.stack || e); process.exit(1); });

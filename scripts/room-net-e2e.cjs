// T-039 в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): комнаты по ссылке-приглашению, когда сайт ещё не подключил Supabase,
// и игры без интернета в приложении. Свой маленький сервер сайта (как vercel.json: настоящие адреса /play/…), настоящий supabase-js и
// настоящий Supabase Realtime (каналы со случайными кодами, несколько сообщений на игру), без входа и без ключей.
//  A) «сети ещё нет»: после загрузки сайта sbClient на время прячем (имитация «игра открылась раньше init.js»), переходим на
//     /play/<игра>/<код> — через DELAY клиент возвращается: комната подключилась сама (стол, дуэль, «Города», «Крокодил», io-игры);
//     клиента нет совсем — через 8 с «Нет связи — попробуй ещё раз», «Ещё раз» → перезагрузка → комната работает;
//  B) 20 входов/выходов подряд: каналы Supabase, слушатели pagehide и память до/после;
//  C) приложение: «Клеточки» и «Червячки» уходят в кэш sw.js (OFFLINE_GAMES), без интернета открываются и играются с ботами,
//     офлайн-страница видит их.
// Запуск из корня сайта:  node scripts/room-net-e2e.cjs [A|B|C]   (Chrome — переменная CHROME; временные файлы — D37_TMP, диск C полный)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || 'E:/claude-tmp/t039';
const ONLY = (process.argv[2] || 'ABC').toUpperCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
// Шум, не относящийся к проверке: сеть/реклама; renderXpTop — сайт зовёт sbClient.rpc, пока мы нарочно прячем клиент (сценарий A);
// adsbygoogle — исключение самого скрипта Google; load — в части C страницы грузятся без сети
const NOISE = /Failed to fetch|NetworkError|_vercel|ERR_|net::|ResizeObserver|adsbygoogle|renderXpTop/;
const NOISE_OFFLINE = new RegExp(NOISE.source + '|load|Load');
const rnd = () => Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');

// ── сервер: файлы сайта + настоящие адреса из vercel.json; down — «нет интернета» ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const S = { down: false };
const SPA = JSON.parse(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8')).rewrites.filter(r => r.destination === '/index.html').map(r => new RegExp('^' + r.source.replace(/\/:path\+$/, '/.+') + '$'));
const server = http.createServer((req, res) => {
  if (S.down) { req.socket.destroy(); return; }
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || SPA.some(rx => rx.test(p))) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', Date: new Date().toUTCString() });
  fs.createReadStream(f).pipe(res);
});

// ── Chrome ──
async function browser(tag, init = ''){
  const port = 9700 + Math.floor(Math.random() * 250);
  fs.mkdirSync(TMP, { recursive: true });
  const profile = fs.mkdtempSync(path.join(TMP, 'rn-' + tag + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('Chrome не запустился');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), subs = new Set(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails || {}; errors.push(((x.exception?.description || x.exception?.value || x.text || '') + ' @' + (x.url || '').split('/').slice(-2).join('/') + ':' + x.lineNumber).slice(0, 240)); }
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // без окошек сайта поверх игры: возраст, «установить приложение»; звук выключен
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1,last:Date.now()}));localStorage.setItem('d37_games_mute','1')}catch(e){}${init}` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 760, deviceScaleFactor: 1, mobile: false });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const until = async (expr, ms = 15000, step = 60) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await ev(expr); if (v) return v; } catch (e) {} await sleep(step); } return false; };
  const load = url => new Promise(r => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); r(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(r, 20000); });
  return { send, ev, until, load, errors, subs, close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}
const siteReady = `typeof D37Route === 'object' && typeof sbClient === 'object' && !!sbClient && typeof showPage === 'function' && typeof GAME_IMPL === 'object'`;

// игра → адрес, что значит «в комнате», какой канал должен появиться
const GAMES = [
  { id: 'chess',       delay: 2000, topic: c => `chess-table-${c}`,       ready: `!!document.querySelector('.tb-seat.me')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'checkers',    delay: 2500, topic: c => `checkers-duel-${c}`,     ready: `/Ждём друга/.test(document.querySelector('.rm-text')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'catch',       delay: 1500, topic: c => `catch-duel-${c}`,        ready: `/Ждём соперника/.test(document.querySelector('.rm-text')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'cities',      delay: 3000, topic: c => `cities-duel-${c}`,       ready: `/Ждём друга/.test(document.querySelector('#ctLobbyText')?.innerText || '')`, err: `/нет связи/i.test(document.querySelector('#ctLobbyText')?.innerText || document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'krokodil',    delay: 2000, topic: c => `krokodil-party-${c}`,    ready: `!!document.querySelector('.kr-pl') && document.querySelector('.kr-pl').children.length >= 1`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'kletochki',   delay: 2000, topic: c => `kletochki-io-${c}`,      ready: `GAME_IMPL.kletochki?._test?.S?.role === 'host'`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'chervyachki', delay: 3000, topic: c => `chervyachki-io-${c}`,    ready: `GAME_IMPL.chervyachki?._test?.S?.role === 'host'`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'arena',       delay: 1800, topic: c => `arena-duel-${c}`,        ready: `/Ждём соперника/.test(document.querySelector('.rm-text')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'ttt',         delay: 2200, topic: c => `ttt-duel-${c}`,          ready: `/Ждём друга/.test(document.querySelector('.rm-text')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'uno',         delay: 2400, topic: c => `uno-table-${c}`,         ready: `!!document.querySelector('.tb-seat.me')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'horde',       delay: 1700, sub: 'coop/', topic: c => `horde-coop-duel-${c}`, ready: `/Ждём напарника/.test(document.getElementById('gamesStage')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
  { id: 'td',          delay: 2600, sub: 'coop/', topic: c => `td-coop-duel-${c}`,    ready: `/Ждём напарника/.test(document.getElementById('gamesStage')?.innerText || '')`, err: `/нет связи/i.test(document.getElementById('gamesStage')?.innerText || '')` },
];
const hasTopic = (t) => `sbClient.getChannels().some(c => c.topic === 'realtime:${t}')`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port;
  const report = {};
  let B = null;
  try {
    if (ONLY.includes('A')) {
      B = await browser('a');
      await B.send('Network.setBypassServiceWorker', { bypass: true });
      await B.load(BASE + '/play');
      ok(await B.until(siteReady, 20000), 'A: сайт загрузился, sbClient есть');
      for (const g of GAMES) {
        const code = 'e' + rnd(), R = report['A:' + g.id] = {};
        // 1) клиента нет, пока открывается игра; возвращается через delay
        await B.ev(`(() => { window.__real = sbClient; sbClient = null; window.__t0 = performance.now(); window.__back = 0; window.__impl = 0; window.__ready = 0;
          clearInterval(window.__poll); window.__poll = setInterval(() => { const t = Math.round(performance.now() - window.__t0); if (!window.__impl && GAME_IMPL['${g.id}']) window.__impl = t; if (!window.__ready && window.__back && (${g.ready})) window.__ready = t; }, 10);
          setTimeout(() => { sbClient = window.__real; window.__back = Math.round(performance.now() - window.__t0); }, ${g.delay}); D37Route.go('/play/${g.id}/${g.sub || ''}${code}'); return 1; })()`);
        await sleep(Math.min(g.delay - 700, 1500));
        R.during = await B.ev(`({ net: typeof sbClient !== 'undefined' && !!sbClient, err: ${g.err}, text: (document.getElementById('gamesStage')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 90) })`);
        ok(R.during.net === false && R.during.err === false, `A ${g.id}: пока клиента нет — идёт подключение, ошибки нет`, R.during);
        ok(await B.until(`window.__ready > 0`, g.delay + 9000), `A ${g.id}: клиент вернулся — комната подключилась сама`, await B.ev(`({ impl: window.__impl, back: window.__back, ready: window.__ready, text: (document.getElementById('gamesStage')?.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) })`));
        const t = await B.ev(`({ impl: window.__impl, back: window.__back, ready: window.__ready })`);
        Object.assign(R, t);
        ok(t.impl > 0 && t.impl < t.back, `A ${g.id}: игра открылась (${t.impl} мс) РАНЬШЕ, чем вернулся клиент (${t.back} мс) — гонка воспроизведена`, t);
        ok(await B.ev(hasTopic(g.topic(code))), `A ${g.id}: канал ${g.topic(code)} создан`, await B.ev(`sbClient.getChannels().map(c => c.topic)`));
        R.toRoomMs = t.ready - t.back;
        await B.ev(`clearInterval(window.__poll); D37Route.go('/play'); 1`);
        await sleep(400);
        ok(!(await B.ev(hasTopic(g.topic(code)))), `A ${g.id}: вышел — канал снят`, await B.ev(`sbClient.getChannels().map(c => c.topic)`));
      }
      // 2) клиента нет совсем
      for (const g of [GAMES[0], GAMES[3], GAMES[5], GAMES[4]]) {
        const code = 'n' + rnd(), R = report['A-нет связи:' + g.id] = {};
        await B.ev(`(() => { window.__real = window.__real || sbClient; if (typeof sbClient !== 'undefined' && sbClient) window.__real = sbClient; sbClient = null; window.__errAt = 0; window.__t0 = performance.now();
          clearInterval(window.__poll); window.__poll = setInterval(() => { if (!window.__errAt && (${g.err} || /нет связи/i.test(document.body.innerText))) window.__errAt = Math.round(performance.now() - window.__t0); }, 25); D37Route.go('/play/${g.id}/${g.sub || ''}${code}'); return 1; })()`);
        await sleep(6000);
        ok(!(await B.ev(`window.__errAt`)), `A нет связи ${g.id}: через 6 с ошибки ещё нет`, await B.ev(`window.__errAt`));
        ok(await B.until(`window.__errAt > 0`, 5000), `A нет связи ${g.id}: появилось «Нет связи»`);
        R.errAtMs = await B.ev(`window.__errAt`);
        ok(R.errAtMs >= 7900 && R.errAtMs <= 9800, `A нет связи ${g.id}: ошибка на ${R.errAtMs} мс (ждали 8 с)`, R.errAtMs);
        const html = await B.ev(`(document.getElementById('gamesStage') || document.body).innerText.replace(/\\s+/g, ' ')`);
        ok(/нет связи/i.test(html) && /ещё раз/i.test(html), `A нет связи ${g.id}: «Нет связи… попробуй ещё раз» и кнопка`, html.slice(0, 200));
        // «Ещё раз»: клиент вернулся → кнопка → страница перезагружается и комната работает
        await B.ev(`clearInterval(window.__poll); sbClient = window.__real; 1`);
        const sel = `[data-io="retry"], button[onclick*="location.reload"]`;
        const btn = await B.ev(`!!document.querySelector('${sel}')`);
        ok(btn, `A нет связи ${g.id}: кнопка «Ещё раз» есть`);
        if (btn) {
          await B.ev(`document.querySelector('${sel}').click(); 1`);   // комнаты — перезагрузка страницы, io-игры — заново без перезагрузки
          ok(await B.until(g.ready, 25000), `A нет связи ${g.id}: после «Ещё раз» комната работает`, await B.ev(`(document.getElementById('gamesStage') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 160)`));
        }
        await B.ev(`D37Route.go('/play'); 1`);
        await sleep(300);
        await B.load(BASE + '/play');
        await B.until(siteReady, 20000);
      }
      ok(B.errors.filter(e => !NOISE.test(e)).length === 0, 'A: без ошибок в консоли', B.errors.slice(0, 6));
      await B.close(); B = null;
    }

    if (ONLY.includes('B')) {
      B = await browser('b');
      await B.send('Network.setBypassServiceWorker', { bypass: true });
      await B.load(BASE + '/play');
      ok(await B.until(siteReady, 20000), 'B: сайт загрузился');
      const listeners = async type => {
        const w = await B.send('Runtime.evaluate', { expression: 'window', objectGroup: 'g' });
        const l = await B.send('DOMDebugger.getEventListeners', { objectId: w.result.objectId });
        await B.send('Runtime.releaseObjectGroup', { objectGroup: 'g' });
        return l.listeners.filter(x => x.type === type).length;
      };
      const heap = async () => { await B.send('HeapProfiler.enable'); await B.send('HeapProfiler.collectGarbage'); await sleep(200); return Math.round((await B.ev('performance.memory.usedJSHeapSize')) / 1024); };
      for (const cycle of [{ id: 'chess', topic: c => `chess-table-${c}`, ready: `!!document.querySelector('.tb-seat.me')` }, { id: 'checkers', topic: c => `checkers-duel-${c}`, ready: `/Ждём друга/.test(document.querySelector('.rm-text')?.innerText || '')` },
        { id: 'kletochki', topic: c => `kletochki-io-${c}`, ready: `GAME_IMPL.kletochki?._test?.S?.role === 'host'` }]) {
        // один «прогрев» (скрипты игры загружены), потом замер
        const warm = 'w' + rnd();
        await B.ev(`D37Route.go('/play/${cycle.id}/${warm}'); 1`);
        ok(await B.until(cycle.ready, 15000), `B ${cycle.id}: прогревочный вход`);
        await B.ev(`D37Route.go('/play'); 1`);
        await sleep(800);
        const ch0 = await B.ev(`sbClient.getChannels().length`), ph0 = await listeners('pagehide'), h0 = await heap();
        let joined = 0;
        for (let i = 0; i < 20; i++) {
          const code = 'j' + rnd();
          await B.ev(`D37Route.go('/play/${cycle.id}/${code}'); 1`);
          if (await B.until(cycle.ready, 12000)) joined++;
          if (i === 9) { const mid = await B.ev(`sbClient.getChannels().map(c => c.topic).filter(t => /${cycle.id}/.test(t)).length`); report['B:' + cycle.id + ' mid'] = mid; }
          await B.ev(`D37Route.go('/play'); 1`);
          await sleep(120);
        }
        await sleep(2500);
        const ch1 = await B.ev(`sbClient.getChannels().length`), ph1 = await listeners('pagehide'), h1 = await heap();
        report['B:' + cycle.id] = { joined, channels: [ch0, ch1], pagehide: [ph0, ph1], heapKB: [h0, h1] };
        ok(joined === 20, `B ${cycle.id}: все 20 входов в комнату удались`, joined);
        ok(ch1 === ch0, `B ${cycle.id}: каналов Supabase после 20 входов/выходов столько же (${ch0} → ${ch1})`, await B.ev(`sbClient.getChannels().map(c => c.topic)`));
        ok(ph1 <= ph0, `B ${cycle.id}: слушателей pagehide не прибавилось (${ph0} → ${ph1})`);
        ok(h1 - h0 < 3000, `B ${cycle.id}: память после 20 входов/выходов (${h0} → ${h1} КБ)`);
      }
      ok(B.errors.filter(e => !NOISE.test(e)).length === 0, 'B: без ошибок в консоли', B.errors.slice(0, 6));
      await B.close(); B = null;
    }

    if (ONLY.includes('C')) {
      // установленное приложение: окно «standalone»
      // окно установленного приложения: app.js узнаёт его по display-mode или navigator.standalone (iOS) — подставляем второе
      B = await browser('c', `try{Object.defineProperty(navigator,'standalone',{get:()=>true})}catch(e){}`);
      await B.load(BASE + '/');
      ok(await B.until(`navigator.serviceWorker.controller && caches.keys().then(k => k.some(n => /^d37-shell-/.test(n)))`, 30000), 'C: sw.js встал');
      const gv = await B.ev(`GAMES_VER`);
      ok(await B.until(`caches.match('/js/games/kletochki.js?v=${await gv}').then(r => !!r)`, 45000, 500), 'C: «Клеточки» ушли в кэш приложения сами (OFFLINE_GAMES), игру не открывали');
      ok(await B.until(`caches.match('/js/games/chervyachki.js?v=${await gv}').then(r => !!r)`, 5000, 300), 'C: «Червячки» — тоже');
      ok(await B.until(`caches.match('/js/games/iokit.js?v=${await gv}').then(r => !!r)`, 5000, 300), 'C: общий файл io-игр (iokit.js) — в кэше');
      // «нет интернета»
      S.down = true;
      await B.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
      for (const g of ['kletochki', 'chervyachki']) {
        await B.load(BASE + '/play/' + g + '/bots');
        ok(await B.until(`location.pathname === '/play/${g}/bots' && GAME_IMPL?.${g}?._test?.S?.role === 'off'`, 25000), `C: без интернета ${g} открылась и играет с ботами`, await B.ev(`({ path: location.pathname, impl: Object.keys(window.GAME_IMPL || {}), text: document.body.innerText.slice(0, 120) })`).catch(e => String(e)));
        await sleep(1500);
        const st = await B.ev(`({ role: GAME_IMPL.${g}._test.S.role, owners: GAME_IMPL.${g}._test.S.W ? GAME_IMPL.${g}._test.S.W.owners.filter(o => o && o.alive).length : -1, err: /нет связи/i.test(document.body.innerText) })`);
        ok(st.role === 'off' && st.owners >= 2 && !st.err, `C: без интернета ${g}: ${st.owners} живых участников, ошибки нет`, st);
        // «▶ Играть» без интернета — не 8 секунд ожидания: сразу с ботами
        await B.load(BASE + '/play/' + g);
        ok(await B.until(`!!document.querySelector('[data-io="play"]')`, 25000), `C: без интернета ${g}: меню открылось`);
        const net = await B.ev(`({ client: typeof sbClient !== 'undefined' && !!sbClient, onLine: navigator.onLine })`);
        const t0 = Date.now();
        await B.ev(`document.querySelector('[data-io="play"]').click(); 1`);
        const quick = await B.until(`GAME_IMPL.${g}?._test?.S?.role === 'off'`, 20000, 50);
        const playMs = Date.now() - t0;
        report['C:' + g] = { ...net, playOfflineMs: playMs };
        ok(quick && playMs < 4000, `C: без интернета «▶ Играть» в ${g} — боты за ${playMs} мс (клиент Supabase есть: ${net.client}), а не после долгого ожидания`, [quick, playMs, net]);
      }
      await B.load(BASE + '/offline.html');
      ok(await B.until(`document.querySelectorAll('.g').length >= 21`, 10000), 'C: офлайн-страница нарисовала игры');
      const offl = await B.ev(`[...document.querySelectorAll('.g')].filter(a => /kletochki|chervyachki/.test(a.getAttribute('href'))).map(a => ({ href: a.getAttribute('href'), off: a.classList.contains('off'), text: a.innerText.replace(/\\s+/g, ' ') }))`);
      ok(offl.length === 2 && offl.every(a => !a.off), 'C: на офлайн-странице «Клеточки» и «Червячки» доступны (файлы в кэше)', offl);
      await B.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      S.down = false;
      ok(B.errors.filter(e => !NOISE_OFFLINE.test(e)).length === 0, 'C: без ошибок в консоли', B.errors.slice(0, 6));
      await B.close(); B = null;
    }
  } catch (e) {
    fail++; console.log('FAIL необработанная ошибка', e && e.stack || e);
  } finally {
    if (B) await B.close();
    server.close();
  }
  console.log(JSON.stringify(report));
  console.log(`\nroom-net-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

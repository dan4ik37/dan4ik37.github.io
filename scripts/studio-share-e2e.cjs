// «Арена» → на сайт (T-176 S3, js/games/studio-arena.js, флаг STUDIO_SHARE) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на
// scripts/serve.py, движок — папка d37-preview/ этого сайта. Supabase подменён поддельной базой в памяти теста (ugc_games, кошелёк,
// site_config part19) — на настоящий сервер не уходит ни один запрос, вход — поддельный (currentUser), загрузки запрещены.
// Путь: «Из примера» → без метки возраста отказ → метка 6+ → «☁️ Сохранить на сайте» → «🔗 Ссылка для друзей» → «🌍 Выложить за 500 🪙»
// (списано 500 один раз, второй раз — 0) → «Игры игроков» показывает арену с «не проверено» → старый адрес #/games/studio/play/<id>
// уводит на страницу арены (в песочницу страниц-игр — никогда) → файл проверен движком, «▶ Играть» — НАШ движок (umode) → без части 19
// «после обновления базы», гость — «Войди» → флаг выключен — «скоро», как в S2.
// Запуск из корня сайта: node scripts/studio-share-e2e.cjs (харнесс Chrome — копия из studio-arena-e2e.cjs)
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/share' : path.join(require('os').tmpdir(), 'share'));
const SHOTS = path.join(TMP, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } };

function startServe(port){ return spawn('python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' }); }
const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
async function waitPort(port){ for (let i = 0; i < 100; i++) { if (await getRaw(port, '/robots.txt')) return true; await sleep(150); } return false; }
const BLOCK = ['*://*.googleapis.com/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*', '*://*.yandex.ru/*', '*://*.yandex.net/*', '*://yastatic.net/*',
  '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*', '*://*.youtube-nocookie.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://*.gstatic.com/*',
  '*://localhost:*/_vercel/*', '*://127.0.0.1:*/_vercel/*', 'wss://*.supabase.co/*'];
const realErrors = errs => errs.filter(e => !/Failed to fetch|NetworkError|ERR_BLOCKED|ERR_INTERNET|net::|AbortError|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights|WebSocket connection|realtime/i.test(String(e)));

async function chrome(net){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9100 + Math.floor(Math.random() * 500), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/*', requestStage: 'Request' }, { urlPattern: '*js/core/config.js*', requestStage: 'Response' }] });
  subs.add(d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const rq = d.params.request, u = rq.url, rid = d.params.requestId;
    const reply = (code, body, type = 'application/json') => send('Fetch.fulfillRequest', { requestId: rid, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }, { name: 'Content-Range', value: '0-0/0' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
    if (/js\/core\/config\.js/.test(u)) {
      const body = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8').replace(/^const STUDIO_ONE = (true|false);/m, 'const STUDIO_ONE = true;').replace(/^const STUDIO_ARENA = (true|false);/m, 'const STUDIO_ARENA = true;').replace(/^const STUDIO_SHARE = (true|false);/m, `const STUDIO_SHARE = ${net.flag !== false};`);
      return reply(200, body, 'text/javascript; charset=utf-8');
    }
    if (rq.method === 'OPTIONS') return reply(204, '');
    const fk = fake(net, rq);   // поддельная база в памяти теста (ничего не уходит на настоящий сервер)
    if (fk) return reply(fk[0], JSON.stringify(fk[1]));
    if (rq.method !== 'GET' && rq.method !== 'HEAD') { if (!/\/rpc\//.test(u) && !/\/auth\//.test(u)) net.writes.push(rq.method + ' ' + u); return reply(/\/rpc\//.test(u) ? 200 : 403, /\/rpc\//.test(u) ? 'null' : '{"message":"запись в тесте запрещена"}'); }
    return reply(200, /\/auth\//.test(u) ? '{}' : '[]');
  });
  const L = { d37_perf: 'mid', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_fsr: 'native', d37_theme: net.theme || 'dark' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const shot = async name => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }); const f = path.join(SHOTS, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && document.readyState === 'complete' && typeof gamesLoadScript === 'function'`;
const UID = '00000000-0000-4000-8000-0000000000aa';
// ── поддельная база: только то, что зовёт студия ──
function fake(net, rq){
  const u = new URL(rq.url), p = u.pathname, db = net.db;
  if (!/supabase\.co$/.test(u.hostname)) return null;
  const body = (() => { try { return JSON.parse(rq.postData || '{}'); } catch (e) { return {}; } })();
  const hd = rq.headers || {};
  const one = /vnd\.pgrst\.object/.test(hd.Accept || hd.accept || '');
  const out = rows => one ? (rows.length ? [200, rows[0]] : [406, { code: 'PGRST116', message: 'no rows' }]) : [200, rows];
  if (p.endsWith('/rest/v1/site_config') && rq.method === 'GET') return out(net.p19 && u.searchParams.get('key') === 'eq.part19' ? [{ value: '1' }] : []);
  if (p.endsWith('/rest/v1/ugc_games') && rq.method === 'GET') {
    let rows = db.rows.slice();
    for (const [k, v] of u.searchParams) { if (['select', 'order', 'limit', 'offset'].includes(k)) continue; const m = /^eq\.(.*)$/.exec(v); if (m) rows = rows.filter(r => String(r[k]) === m[1]); }
    return out(rows.map(r => ({ ...r, profiles: { nick: 'Тестер' } })));
  }
  const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(p); if (!m || rq.method !== 'POST') return null;
  const f = m[1]; net.calls.push(f);
  if (!net.p19 && /^ugc_arena_/.test(f)) return [404, { code: 'PGRST202', message: 'Could not find the function' }];
  if (f === 'ugc_arena_rule') return [200, body.p_key === 'price' ? 500 : null];
  if (f === 'ugc_arena_save') {
    if (!net.uid) return [200, { ok: false, reason: 'auth' }];
    let r = body.p_id ? db.rows.find(x => x.id === body.p_id) : null;
    if (!r) { r = { id: 'ar' + (db.rows.length + 1) + 'x0000', author: net.uid, kind: 'arena', status: 'draft', plays: 0, likes: 0, unchecked: false, created_at: new Date().toISOString() }; db.rows.push(r); }
    Object.assign(r, { title: body.p_title, descr: body.p_descr, icon: body.p_icon, data: body.p_data, age_rating: body.p_age ?? 12, age_ok: body.p_age != null, updated_at: new Date().toISOString() });
    return [200, { ok: true, id: r.id, status: r.status }];
  }
  if (f === 'ugc_status') { const r = db.rows.find(x => x.id === body.p_id); if (!r) return [200, { ok: false, reason: 'not_found' }]; r.status = body.p_status; return [200, { ok: true, status: r.status }]; }
  if (f === 'ugc_arena_publish') {
    const r = db.rows.find(x => x.id === body.p_id); if (!r) return [200, { ok: false, reason: 'not_found' }];
    if (!r.age_ok) return [200, { ok: false, reason: 'age' }];
    if (r.paid) { r.status = 'public'; return [200, { ok: true, status: 'public', charged: 0 }]; }
    if (db.coins < 500) return [200, { ok: false, reason: 'coins', coins: db.coins, price: 500 }];
    db.coins -= 500; db.charges++; r.paid = true; r.status = 'public'; r.unchecked = true;
    return [200, { ok: true, status: 'public', charged: 500, coins: db.coins }];
  }
  if (f === 'ugc_play') { db.plays++; return [200, { ok: true, counted: true }]; }
  return null;
}
const st = `window.D37StudioArena?._test`;
const MS = `(() => { try { return ${st}.host()?.lobby.state() || null; } catch (e) { return null; } })()`;
const shareSt = `(document.querySelector('.sa-share-st')?.textContent || '')`;
const click = sel => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`;

async function walk(port){
  const net = { writes: [], calls: [], theme: 'dark', flag: true, p19: true, uid: UID, db: { rows: [], coins: 1200, charges: 0, plays: 0 } };
  const B = await chrome(net);
  try {
    await B.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await B.send('Page.navigate', { url: `http://localhost:${port}/` });
    ok(await B.until(READY, 90000), 'сайт загрузился');
    ok(await B.ev(`STUDIO_SHARE === true`), 'STUDIO_SHARE включён');
    await B.ev(`currentUser = { id: '${UID}' }; 1`);   // поддельный вход: только в этой странице
    await B.ev(`D37Route.go('#/games/studio/arena/demo'); 1`);
    ok(await B.until(`!!document.querySelector('.sa-share') && /✓/.test(document.querySelector('.sa-st')?.textContent || '')`, 90000), 'редактор: блок «На сайт», файл примера в порядке');
    ok(await B.until(`document.querySelector('.sa-price')?.textContent === '500'`, 10000), 'цена с сервера: 500 🪙');
    await B.ev(`confirm = () => true; 1`);
    await B.ev(click('[data-spub]'));
    ok(await B.until(`/возраст/.test(${shareSt})`, 10000), 'без метки возраста — «Выбери, для какого возраста»', await B.ev(shareSt));
    ok(net.db.charges === 0, 'монеты не тронуты');
    await B.ev(`(() => { const s = document.querySelector('.sa-age'); s.value = '6'; s.dispatchEvent(new Event('change', { bubbles: true })); const d = document.querySelector('.sa-descr'); d.value = '<b>Беги</b> и собирай'; d.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
    await B.ev(click('[data-ssave]'));
    ok(await B.until(`/✓ Сохранено на сайте/.test(${shareSt})`, 15000), '«Сохранить на сайте» — ок', await B.ev(shareSt));
    const row = net.db.rows[0];
    ok(row && row.kind === 'arena' && row.data?.format === 1 && row.age_rating === 6 && row.status === 'draft', 'в базе: вид arena, файл режима, метка 6+, черновик', row && { ...row, data: undefined });
    await B.ev(click('[data-slink]'));
    ok(await B.until(`/Ссылка для друзей/.test(${shareSt}) && ${shareSt}.includes('arena/play/${row?.id}')`, 15000), '«Ссылка для друзей» — адрес страницы арены', await B.ev(shareSt));
    ok(row?.status === 'link', 'статус «по ссылке» (старая ugc_status)');
    await B.ev(click('[data-spub]'));
    ok(await B.until(`/Выложено/.test(${shareSt})`, 15000), '«Выложить за 500 🪙» — выложено', await B.ev(shareSt));
    ok(/списано 500/.test(await B.ev(shareSt)) && net.db.coins === 700 && net.db.charges === 1 && row.status === 'public', 'списано 500 один раз, в каталоге', { coins: net.db.coins, charges: net.db.charges });
    await B.ev(click('[data-spub]'));
    await B.until(`/Выложено/.test(${shareSt}) && !/списано/.test(${shareSt})`, 15000);
    ok(net.db.charges === 1 && net.db.coins === 700, 'второй раз — без списания');
    await B.shot('share-editor');
    await B.ev(`D37Route.go('#/games/studio'); 1`);
    ok(await B.until(`!!document.querySelector('.so-cat a.so-card[href*="arena/play/${row.id}"]')`, 30000), '«Игры игроков»: арена в каталоге');
    ok(await B.ev(`/не проверено/.test(document.querySelector('.so-cat a.so-card[href*="arena/play/${row.id}"]').textContent)`), 'на карточке — «не проверено»');
    ok(await B.until(`[...document.querySelectorAll('.so-mine .so-row')].filter(r => /Арена/.test(r.textContent)).length === 1`, 15000), '«Мои проекты»: одна строка арены (с сайта), без дубля из браузера');
    await B.ev(`D37Route.go('#/games/studio/play/${row.id}'); 1`);
    ok(await B.until(`location.href.includes('arena/play/${row.id}') && !!document.querySelector('.sa-pp')`, 30000), 'старый адрес #/games/studio/play/<id> → страница арены');
    ok(await B.ev(`!document.querySelector('iframe.st-frame')`), 'арена не открылась в песочнице страниц-игр');
    ok(await B.until(`!document.querySelector('.sa-pp-go').hidden`, 90000), 'страница арены: файл проверен движком, «▶ Играть» есть', await B.ev(`document.querySelector('.sa-st')?.textContent`));
    ok(await B.ev(`!!document.querySelector('.sa-unchecked') && /не проверено/.test(document.querySelector('.sa-unchecked').textContent)`), 'метка «не проверено модератором» видна');
    ok(await B.ev(`document.querySelector('.sa-descr-t').textContent === '<b>Беги</b> и собирай' && !document.querySelector('.sa-descr-t b')`), 'описание — только текстом (разметка не исполняется)');
    await B.ev(click('.sa-pp-go'));
    ok(await B.until(`(${MS})?.game === 'umode'`, 180000), '«▶ Играть» — НАШ движок играет файл арены (umode)', await B.ev(`document.querySelector('.sa-st')?.textContent`));
    await sleep(2500);
    await B.shot('share-play');
    ok(net.db.plays >= 1, 'запуск засчитан (ugc_play)');
    net.p19 = false;
    await B.ev(`${st}.setP19(null); D37Route.go('#/games/studio/arena/demo'); 1`);
    ok(await B.until(`/после обновления базы/.test(${shareSt})`, 60000), 'без части 19: «после обновления базы»', await B.ev(shareSt));
    await B.until(`/✓/.test(document.querySelector('.sa-st')?.textContent || '')`, 30000);
    const n0 = net.calls.filter(c => /^ugc_arena_/.test(c)).length;
    await B.ev(click('[data-ssave]'));
    await sleep(1200);
    ok(/после обновления базы/.test(await B.ev(shareSt)) && net.calls.filter(c => /^ugc_arena_/.test(c)).length === n0, 'без части 19 кнопка ничего не зовёт');
    await B.ev(`currentUser = null; 1`);
    await B.ev(click('[data-ssave]'));
    ok(await B.until(`/Войди/.test(${shareSt})`, 5000), 'гость — «Войди на сайт»');
    ok(net.writes.length === 0, 'ни одной записи мимо функций', net.writes);
    ok(realErrors(B.errs).length === 0, '0 ошибок в консоли', realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}
async function flagOff(port){
  const net = { writes: [], calls: [], theme: 'light', flag: false, p19: true, uid: null, db: { rows: [], coins: 0, charges: 0, plays: 0 } };
  const B = await chrome(net);
  try {
    await B.send('Page.navigate', { url: `http://localhost:${port}/` });
    ok(await B.until(READY, 90000), 'выкл: сайт загрузился');
    await B.ev(`D37Route.go('#/games/studio/arena/demo'); 1`);
    ok(await B.until(`!!document.querySelector('.sa-form .sa-sec')`, 90000), 'выкл: редактор арены как в S2');
    ok(await B.ev(`!document.querySelector('.sa-share') && /скоро/.test(document.querySelector('.sa-files').textContent)`), 'выкл: «Выложить — скоро», блока «На сайт» нет');
    ok(realErrors(B.errs).length === 0, 'выкл: 0 ошибок в консоли', realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}
(async () => {
  const port = 6700 + Math.floor(Math.random() * 300);
  const srv = startServe(port);
  try {
    ok(await waitPort(port), 'scripts/serve.py запустился');
    await walk(port);
    await flagOff(port);
  } catch (e) { fail++; console.log('ОШИБКА', e.stack || e.message); }
  finally { srv.kill(); }
  console.log(`\nstudio-share-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

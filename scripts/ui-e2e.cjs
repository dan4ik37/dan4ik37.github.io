// T-086: общая мини-карточка игрока, профиль 2.0 и светлая тема — замеры и снимки в настоящем Chrome (headless, без npm).
// Режимы (первый аргумент, по умолчанию perf):
//   perf  — профиль телефона (412×915, ЦП ×4 медленнее): мини-карточка — до первого кадра и до «всё догрузилось» (первый раз и
//           повтор), страница профиля — время ЦП (скрипты + стили + раскладка) и «до последнего изменения»; медианы, мс
//   leak  — 20 раз открыть/закрыть мини-карточку и 10 раз зайти в профиль: слушатели window/document, узлы DOM, память (после сборки)
//   cls   — тема до первого кадра (тёмная, светлая, «Авто» при светлой и тёмной системе): фон и data-theme первого кадра = после
//           загрузки, сдвигов у светлой не больше, чем у тёмной (CLS_PATH — какую страницу, по умолчанию «/»)
//   shots — снимки: телефон и ПК × тёмная и светлая — главная, профиль, мини-карточка, чат (SHOTS — папка; по умолчанию D37_TMP)
//   flags — откат: UI_V2 = false и THEME_LIGHT = false (config.js подменяется на лету) — профиль старый, светлой темы нет, без ошибок
//   ci    — leak + cls + flags (так зовёт scripts/ci-run.cjs --e2e)
// Сайт отдаёт scripts/serve.py (поднимается сам на свободном порту) или BASE=http://localhost:5500. UID — чей профиль открывать
// (по умолчанию — первый профиль с аватаркой). Данные — настоящий Supabase (только чтение; без входа). Временное — D37_TMP.
// Запуск из корня сайта: node scripts/ui-e2e.cjs [perf|leak|cls|shots|flags|ci|all]
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = process.env.SHOTS || path.join(TMP, 't086-shots');
const TAG = process.env.TAG || 'after';
const MODE = process.argv[2] || 'perf';
const RUNS = +(process.env.RUNS || 5);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const r1 = v => Math.round(v * 10) / 10;
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };

// ═══ Сайт: scripts/serve.py на свободном порту (как на Vercel: /profile/<id>, /chat → index.html) ═══
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}

// ═══ Chrome через протокол отладки ═══
async function chrome({ phone = true, w = 412, h = 915, cpu = 1, ls = {}, scheme = 'dark', block = [], intercept = null, init = '' } = {}){
  const port = 9600 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'd37-ui-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], warns = [], on = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') warns.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    for (const f of on) f(d); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
  } else await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  if (cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  if (block.length) { await send('Network.enable'); await send('Network.setBlockedURLs', { urls: block }); }
  if (intercept) {
    await send('Fetch.enable', { patterns: intercept.map(x => ({ urlPattern: x.url })) });
    on.push(async d => {
      if (d.method !== 'Fetch.requestPaused') return;
      const x = intercept.find(i => d.params.request.url.includes(i.match));
      if (!x) { send('Fetch.continueRequest', { requestId: d.params.requestId }).catch(() => {}); return; }
      send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: x.type || 'text/javascript; charset=utf-8' }], body: Buffer.from(x.body).toString('base64') }).catch(() => {});
    });
  }
  // без окошек сайта (возраст, «установить приложение», выбор режима); режим «Слабое» — как средний телефон
  const L = Object.assign({ d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' }, ls);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('d37_e2e_ls')){${Object.entries(L).map(([k, v]) => v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}sessionStorage.setItem('d37_e2e_ls','1')}}catch(e){}` });
  if (init) await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const shot = async file => { const s = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(s.data, 'base64')); return file; };
  const go = async (url, wait = 0) => { await send('Page.navigate', { url }); if (wait) await sleep(wait); };
  const until = async (expr, ms = 20000, step = 100) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(step); } return false; };
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const tap = async (x, y) => {
    if (phone) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(40); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(30); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); }
  };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, shot, go, until, metrics, tap, close, errs, warns };
}

// Профиль для замеров: UID или первый профиль с аватаркой (только чтение)
const FIND_UID = `(async () => { for (let i = 0; i < 80 && !(typeof sbClient !== 'undefined' && sbClient); i++) await new Promise(r => setTimeout(r, 100));
  const { data } = await (await sbProfiles()).select('id,nick').not('avatar_url', 'is', null).limit(1); return data && data[0] ? data[0].id + '|' + data[0].nick : ''; })()`;
const READY = `typeof sbClient !== 'undefined' && !!sbClient && typeof renderProfilePage === 'function' && document.readyState === 'complete'`;

// Мини-карточка: открыть у якоря, время до первого кадра и до последнего изменения карточки (тишина 350 мс)
const MINI_OPEN = (uid, nick) => `(async () => {
  let a = document.getElementById('e2eAnchor');
  if (!a) { a = document.createElement('a'); a.id = 'e2eAnchor'; a.textContent = ${JSON.stringify(nick)}; a.href = '#'; a.style.cssText = 'position:fixed;left:40px;top:180px;z-index:1;color:inherit'; document.body.appendChild(a); }
  const t0 = performance.now();
  const p = window.D37Mini ? D37Mini.open(${JSON.stringify(uid)}, { nick: ${JSON.stringify(nick)}, anchor: a }) : openMiniProfile(${JSON.stringify(uid)}, ${JSON.stringify(nick)}, a);
  const card = () => document.querySelector('.d37m-card') || document.getElementById('miniProfilePopover');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const vis = performance.now() - t0;
  let last = performance.now();
  const mo = new MutationObserver(() => { last = performance.now(); });
  const c = card(); if (c) mo.observe(c, { subtree: true, childList: true, attributes: true, characterData: true });
  try { await p; } catch (e) {}
  while (performance.now() - last < 350) await new Promise(r => setTimeout(r, 50));
  mo.disconnect();
  const shown = !!c && getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().height > 50;
  return { vis, done: last - t0, shown };
})()`;
const MINI_CLOSE = `(() => { if (window.D37Mini) D37Mini.close(); else { const p = document.getElementById('miniProfilePopover'); if (p) p.style.display = 'none'; } return true; })()`;

// Страница профиля: переход, время ЦП (скрипты, стили, раскладка) и «до последнего изменения» (тишина 500 мс)
const PROFILE_OPEN = uid => `(async () => {
  const box = document.getElementById('profile-page');
  let last = performance.now(); const t0 = last;
  const mo = new MutationObserver(() => { last = performance.now(); });
  const nk = document.getElementById('profileNick'); if (nk) nk.textContent = '';
  mo.observe(box, { subtree: true, childList: true, attributes: true, characterData: true });
  D37Route.go('#/profile/' + ${JSON.stringify(uid)});
  for (let i = 0; i < 200 && !(document.getElementById('profileNick')?.textContent || '').trim(); i++) await new Promise(r => setTimeout(r, 25));
  const first = performance.now() - t0;
  while (performance.now() - last < 500) await new Promise(r => setTimeout(r, 50));
  mo.disconnect();
  return { first, done: last - t0, nodes: box.getElementsByTagName('*').length };
})()`;
const LEAVE = `(async () => { D37Route.go('#/home'); await new Promise(r => setTimeout(r, 400)); return true; })()`;

async function counter(B){
  await B.send('HeapProfiler.collectGarbage'); await sleep(120); await B.send('HeapProfiler.collectGarbage');
  const L = {};
  for (const nm of ['window', 'document']) {
    const o = await B.send('Runtime.evaluate', { expression: nm });
    L[nm] = (await B.send('DOMDebugger.getEventListeners', { objectId: o.result.objectId })).listeners.length;
  }
  const nodes = await B.ev(`document.getElementsByTagName('*').length`);
  const heap = await B.send('Runtime.getHeapUsage');
  return { win: L.window, doc: L.document, nodes, heapMB: r1(heap.usedSize / 1048576) };
}

async function perf(site){
  console.log('\n— perf: телефон 412×915, ЦП ×4');
  const B = await chrome({ cpu: 4 });
  await B.go(site.base + '/', 0);
  ok(await B.until(READY, 30000), 'сайт загрузился');
  const [uid, nick] = (process.env.UID ? process.env.UID + '|игрок' : await B.ev(FIND_UID)).split('|');
  ok(!!uid, 'есть профиль для замеров');
  await sleep(2500);
  // мини-карточка: первый раз (новый uid, пустой кэш) и повторы
  const first = await B.ev(MINI_OPEN(uid, nick)); await B.ev(MINI_CLOSE); await sleep(300);
  const rep = [];
  for (let i = 0; i < RUNS; i++) { rep.push(await B.ev(MINI_OPEN(uid, nick))); await B.ev(MINI_CLOSE); await sleep(250); }
  ok(first.shown, 'мини-карточка видна', first);
  const mini = { firstVis: r1(first.vis), firstDone: r1(first.done), repVis: r1(med(rep.map(r => r.vis))), repDone: r1(med(rep.map(r => r.done))) };
  console.log('  мини-карточка, мс:', JSON.stringify(mini));
  // профиль: ЦП и время
  const prof = [];
  for (let i = 0; i < RUNS; i++) {
    await B.ev(LEAVE); await sleep(400);
    const m0 = await B.metrics();
    const r = await B.ev(PROFILE_OPEN(uid));
    const m1 = await B.metrics();
    prof.push({ ...r, script: (m1.ScriptDuration - m0.ScriptDuration) * 1000, style: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000, layout: (m1.LayoutDuration - m0.LayoutDuration) * 1000, task: (m1.TaskDuration - m0.TaskDuration) * 1000 });
  }
  const P = { first: r1(med(prof.map(p => p.first))), done: r1(med(prof.map(p => p.done))), cpuScript: r1(med(prof.map(p => p.script))), cpuStyle: r1(med(prof.map(p => p.style))), cpuLayout: r1(med(prof.map(p => p.layout))), cpuTask: r1(med(prof.map(p => p.task))), nodes: prof[prof.length - 1].nodes };
  console.log('  профиль, мс:', JSON.stringify(P));
  ok(!B.errs.length, 'без ошибок в консоли', B.errs.slice(0, 5));
  await B.close();
  return { mini, profile: P };
}

async function leak(site){
  console.log('\n— leak: 20 × мини-карточка, 10 × профиль (телефон)');
  const B = await chrome({ cpu: 1 });
  await B.go(site.base + '/', 0);
  ok(await B.until(READY, 30000), 'сайт загрузился');
  const [uid, nick] = (process.env.UID ? process.env.UID + '|игрок' : await B.ev(FIND_UID)).split('|');
  await sleep(2500);
  // прогрев: один круг (первое открытие создаёт карточку и кэш)
  await B.ev(MINI_OPEN(uid, nick)); await B.ev(MINI_CLOSE);
  await B.ev(PROFILE_OPEN(uid)); await B.ev(LEAVE);
  const c0 = await counter(B);
  for (let i = 0; i < 20; i++) { await B.ev(MINI_OPEN(uid, nick)); await B.ev(MINI_CLOSE); }
  const c1 = await counter(B);
  for (let i = 0; i < 10; i++) { await B.ev(PROFILE_OPEN(uid)); await B.ev(LEAVE); }
  const c2 = await counter(B);
  console.log('  до:', JSON.stringify(c0), '\n  после 20 карточек:', JSON.stringify(c1), '\n  после 10 профилей:', JSON.stringify(c2));
  ok(c1.win <= c0.win && c1.doc <= c0.doc, 'карточка: слушатели не растут', [c0.win, c0.doc, c1.win, c1.doc]);
  ok(c1.nodes - c0.nodes <= 5, 'карточка: узлы DOM не растут', [c0.nodes, c1.nodes]);
  ok(c2.win <= c1.win + 1 && c2.doc <= c1.doc + 1, 'профиль: слушатели не растут', [c1.win, c1.doc, c2.win, c2.doc]);
  ok(c2.nodes - c1.nodes <= 40, 'профиль: узлы DOM не растут (±40 — счётчики, «Lv»)', [c1.nodes, c2.nodes]);
  ok(c2.heapMB - c0.heapMB < 3, 'память не растёт (< 3 МБ за 30 кругов)', [c0.heapMB, c2.heapMB]);
  ok(!B.errs.length, 'без ошибок в консоли', B.errs.slice(0, 5));
  await B.close();
  return { c0, c1, c2 };
}

// CLS и первый кадр: тема ставится до первой отрисовки — фон и data-theme в первом кадре те же, что после загрузки, а сдвигов
// у светлой не больше, чем у тёмной (сама тема ничего не двигает). Первый кадр — первый requestAnimationFrame после появления <body>
// (раньше браузер не рисует: стили в <head> держат отрисовку).
const FIRST = `(() => { try { const rec = () => { if (window.__d37first) return; window.__d37first = { bg: getComputedStyle(document.body).backgroundColor, theme: document.documentElement.dataset.theme || '', t: Math.round(performance.now()) }; };
  new MutationObserver((l, o) => { if (document.body) { o.disconnect(); requestAnimationFrame(rec); } }).observe(document, { childList: true, subtree: true }); } catch (e) {} })()`;
const CLS_PROBE = `new Promise(res => { let cls = 0; try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
  setTimeout(() => res({ cls: Math.round(cls * 1000) / 1000, theme: document.documentElement.dataset.theme || '', bg: getComputedStyle(document.body).backgroundColor }), 2500); })`;
async function cls(site){
  const at = process.env.CLS_PATH || '/';
  console.log('\n— cls: тема до первого кадра (' + at + ', телефон, ЦП ×4)');
  const out = {};
  for (const [name, ls, scheme, want] of [['dark', {}, 'dark', ''], ['light', { d37_theme: 'light' }, 'dark', 'light'], ['auto-light', { d37_theme: 'auto' }, 'light', 'light'], ['auto-dark', { d37_theme: 'auto' }, 'dark', '']]) {
    const B = await chrome({ cpu: 4, ls, scheme, init: FIRST });
    await B.go(site.base + at, 0);
    await B.until(READY, 30000);
    const r = await B.ev(CLS_PROBE), f = await B.ev('window.__d37first || null');
    out[name] = { ...r, first: f };
    console.log(' ', name.padEnd(10), JSON.stringify(out[name]));
    ok(r.theme === want, `${name}: тема ${want || 'тёмная'}`, r.theme);
    ok(!!f && f.theme === r.theme && f.bg === r.bg, `${name}: первый кадр — уже этой темы (без «вспышки»)`, [f, r.bg]);
    if (name !== 'dark') ok(r.cls <= out.dark.cls + .05, `${name}: сдвигов не больше, чем у тёмной (тема ничего не двигает)`, [r.cls, out.dark.cls]);
    ok(!B.errs.length, `${name}: без ошибок`, B.errs.slice(0, 3));
    await B.close();
  }
  return out;
}

async function shots(site){
  console.log('\n— shots →', SHOTS);
  for (const [kind, w, h] of [['phone', 412, 915], ['pc', 1366, 900]]) {
    for (const theme of ['dark', 'light']) {
      const B = await chrome({ phone: kind === 'phone', w, h, ls: { d37_theme: theme } });
      await B.go(site.base + '/', 0); await B.until(READY, 30000); await sleep(3500);
      await B.shot(path.join(SHOTS, `${TAG}-${kind}-${theme}-home.jpg`));
      const [uid, nick] = (process.env.UID ? process.env.UID + '|игрок' : await B.ev(FIND_UID)).split('|');
      await B.ev(PROFILE_OPEN(uid)); await sleep(800);
      await B.shot(path.join(SHOTS, `${TAG}-${kind}-${theme}-profile.jpg`));
      await B.ev(`window.scrollTo(0, 0)`);
      await B.ev(MINI_OPEN(uid, nick)); await sleep(500);
      await B.shot(path.join(SHOTS, `${TAG}-${kind}-${theme}-mini.jpg`));
      await B.ev(MINI_CLOSE);
      await B.ev(`D37Route.go('#/chat')`); await sleep(3500);
      await B.shot(path.join(SHOTS, `${TAG}-${kind}-${theme}-chat.jpg`));
      ok(!B.errs.length, `${kind} ${theme}: без ошибок`, B.errs.slice(0, 3));
      await B.close();
    }
  }
}

// Откат: UI_V2 = false и THEME_LIGHT = false — config.js подменяется ответом с выключенными флагами
async function flags(site){
  console.log('\n— flags: откат одной строкой');
  const cfg = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8').replace(/const UI_V2 = true/, 'const UI_V2 = false').replace(/const THEME_LIGHT = true/, 'const THEME_LIGHT = false');
  ok(/const UI_V2 = false/.test(cfg) && /const THEME_LIGHT = false/.test(cfg), 'в config.js есть флаги UI_V2 и THEME_LIGHT');
  const B = await chrome({ phone: true, ls: { d37_theme: 'light' }, intercept: [{ url: '*config.js*', match: '/js/core/config.js', body: cfg }] });
  await B.go(site.base + '/', 0); await B.until(READY, 30000); await sleep(2000);
  const st = await B.ev(`({ theme: document.documentElement.dataset.theme || '', ui2: document.documentElement.classList.contains('ui2'), ls: localStorage.getItem('d37_theme'), mini: !!window.D37Mini })`);
  console.log('  ', JSON.stringify(st));
  ok(st.theme !== 'light' && !st.ls, 'THEME_LIGHT = false: светлой темы нет, выбор стёрт', st);
  ok(!st.ui2, 'UI_V2 = false: профиль — старый вид', st);
  const [uid, nick] = (process.env.UID ? process.env.UID + '|игрок' : await B.ev(FIND_UID)).split('|');
  await B.ev(PROFILE_OPEN(uid));
  const m = await B.ev(MINI_OPEN(uid, nick));
  ok(m.shown, 'мини-карточка всё равно открывается (одна на сайт)', m);
  ok(!B.errs.length, 'без ошибок', B.errs.slice(0, 3));
  await B.close();
}

(async () => {
  const site = await startSite();
  const res = {};
  try {
    const on = m => MODE === m || MODE === 'all' || (MODE === 'ci' && ['leak', 'cls', 'flags'].includes(m));
    if (on('perf')) res.perf = await perf(site);
    if (on('leak')) res.leak = await leak(site);
    if (on('cls')) res.cls = await cls(site);
    if (on('shots')) await shots(site);
    if (on('flags')) await flags(site);
  } finally { site.stop(); }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(res, null, 1));
  console.log(fails ? `\n✗ провалов: ${fails}` : '\n✓ всё в порядке');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

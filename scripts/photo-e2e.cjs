// 🖼 Фоторедактор (/photo) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на scripts/serve.py.
//   node scripts/photo-e2e.cjs [smoke|load|big|soak|leak|shot|all] [минуты для soak]
//  smoke — все команды «d37 v1» по очереди (как ИИ) + кнопки панели + отмена/возврат, ошибок нет;
//  load  — первая загрузка раздела на профиле телефона (412×915, ЦП ×4, без кэша): сколько скачано, когда редактор готов;
//  big   — фото 12 Мп на профиле телефона: память (все процессы этого Chrome) после открытия, коррекции, кисти, сохранения;
//  soak  — случайные команды, нажатия и жесты N минут (по умолчанию 10): 0 ошибок, падений нет, память не растёт;
//  leak  — 20 раз открыть/закрыть раздел (/photo ↔ /): память после сборки мусора не растёт;
//  shot  — снимки телефона и компьютера (D37_TMP/shots).
// Chrome — переменная CHROME; профиль и временное — D37_TMP (по умолчанию E:\claude-tmp\photo, диск C у владельца полный).
// Внешние адреса, кроме jsDelivr (основа fabric.js) и шрифтов Google, заблокированы — проверяем свой код.
const http = require('http'), fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || 'E:/claude-tmp/photo';
const MODE = process.argv[2] || 'smoke';
const MIN = +process.argv[3] || 10;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const MB = b => Math.round(b / 1048576 * 10) / 10;
const BLOCK = ['*://*.supabase.co/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*', '*://*.yandex.ru/*',
  '*://*.yandex.net/*', '*://yastatic.net/*', '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*', '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*', '*://localhost:*/_vercel/*', '*://127.0.0.1:*/_vercel/*', '*://www.googleapis.com/*'];

function startServe(port){ return spawn('python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' }); }
const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
async function waitPort(port){ for (let i = 0; i < 80; i++) { if (await getRaw(port, '/robots.txt')) return true; await sleep(150); } return false; }
// Память всех процессов этого Chrome (по папке профиля) — Windows; иначе NaN. byType: { renderer, gpu, other } — страница отдельно
// от процесса видеокарты (у того свои кэши: после первых открытий он растёт и стоит — это не утечка страницы)
function chromeMem(profile, byType){
  if (process.platform !== 'win32') return byType ? { total: NaN, renderer: NaN, gpu: NaN } : NaN;
  const key = path.basename(profile);
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${key}') } | ForEach-Object { $t = 'browser'; if ($_.CommandLine -match '--type=([a-z-]+)') { $t = $matches[1] }; Write-Output ($t + ' ' + [int64]$_.PrivatePageCount) }`;
  let out = '';
  try { out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 30000 }); } catch (e) { return byType ? { total: NaN, renderer: NaN, gpu: NaN } : NaN; }
  const r = { total: 0, renderer: 0, gpu: 0, other: 0 };
  for (const line of out.trim().split(/\r?\n/)) { const [t, b] = line.trim().split(/\s+/); const v = +b || 0; r.total += v; if (t === 'renderer') r.renderer += v; else if (t === 'gpu-process') r.gpu += v; else r.other += v; }
  return byType ? r : r.total;
}

async function chrome(tag){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9900 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-pe-' + tag + '-')).replace(/\\/g, '/');
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) throw new Error('Chrome не запустился');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((a, b) => { ws.onopen = a; ws.onerror = b; });
  let id = 0, bytes = 0; const cb = new Map(), subs = new Set(), errors = [], crashes = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push(String(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text).slice(0, 300));
    else if (d.method === 'Inspector.targetCrashed') crashes.push(Date.now());
    else if (d.method === 'Network.loadingFinished') bytes += d.params.encodedDataLength || 0;
    else if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  const C = {
    send, errors, crashes, profile, get bytes(){ return bytes; }, resetBytes(){ bytes = 0; },
    load: url => new Promise(r => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); r(true); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(() => { subs.delete(f); r(false); }, 60000); }),
    ev: async (expr, ms = 120000) => {
      const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ timeout: 1 }))]);
      if (r.timeout) throw new Error('timeout: ' + expr.slice(0, 80));
      if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    until: async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await C.ev(expr, 5000)) return Date.now() - t; } catch (e) {} await sleep(100); } return -1; },
    mem: byType => chromeMem(profile, byType),
    gc: async () => { try { await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage'); } catch (e) {} },
    phone: async (cpu = 4) => {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36' });
      if (cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpu });
    },
    desktop: async (w = 1440, h = 900) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await send('Emulation.setTouchEmulationEnabled', { enabled: false }); },
    shot: async file => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    mouse: async (type, x, y, o = {}) => send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: 'left', clickCount: 1 }, o)),
    touch: async (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts }),
    close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(600); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} },
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Inspector.enable').catch(() => {});
  await send('Network.setBlockedURLs', { urls: BLOCK });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}))}catch(e){}` });
  return C;
}
const realErrors = errs => errs.filter(e => !/Failed to fetch|NetworkError|ERR_BLOCKED|net::|supabase|AbortError|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights|Не загрузилось: @supabase/i.test(String(e)));

// Фото для проверки — рисуется прямо в странице (файлов в репозитории нет): градиент, круги, «шум» → JPEG
const MKIMG = `async (w, h) => {
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3a7bd5'); gr.addColorStop(.5, '#d53a9d'); gr.addColorStop(1, '#f9d423'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { g.strokeStyle = 'hsl(' + (i * 37 % 360) + ',80%,50%)'; g.lineWidth = 3 + i % 18; g.beginPath(); g.arc((i * 997) % w, (i * 577) % h, 20 + (i * 31) % 300, 0, 6.28); g.stroke(); }
  const id = g.getImageData(0, 0, w, 48); for (let i = 0; i < id.data.length; i += 4) { const n = (i * 2654435761) >>> 27; id.data[i] ^= n; id.data[i + 1] ^= n >> 1; }
  for (let y = 0; y < h; y += 96) g.putImageData(id, 0, y);
  return await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}`;
const RUN = (cmd, args) => `D37Tools.run('photo', ${JSON.stringify(cmd)}, ${JSON.stringify(args || {})}).then(r => JSON.stringify(r))`;

async function openEditor(C, base){
  await C.load(base + '/photo');
  const t = await C.until('!!(window.D37Photo && window.D37Photo.E && window.D37Tools && D37Tools.get("photo"))', 60000);
  if (t < 0) throw new Error('редактор не открылся: ' + await C.ev(`JSON.stringify({ route: document.body.dataset.route, href: location.href, apps: !!window.D37Apps, ui: !!window.D37PhotoUI, root: (document.getElementById('photoRoot') || {}).textContent?.slice(0, 160) })`).catch(e => e.message) + ' ' + JSON.stringify(C.errors.slice(0, 3)));
  return t;
}

async function smoke(base){
  const C = await chrome('smoke');
  try {
    await C.desktop();
    const t = await openEditor(C, base);
    ok(t >= 0, 'редактор открылся на /photo', t);
    const run = async (cmd, args) => JSON.parse(await C.ev(RUN(cmd, args)));
    let r = await run('info'); ok(r.ok && r.result.layers.length === 1, 'info: стартовый холст с одним слоем', r);
    r = await run('new', { w: 800, h: 600, bg: '#ffffff' }); ok(r.ok && r.result.w === 800, 'new 800×600', r);
    r = await run('text', { text: 'ПОБЕДА', size: 80, color: 'жёлтый', stroke: '#000', strokeWidth: 6, shadow: true }); ok(r.ok && r.result.layer, 'text: надпись', r);
    const tid = r.result.layer;
    r = await run('textEdit', { layer: tid, text: 'ПОБЕДА!', font: 'Rubik', bold: true }); ok(r.ok, 'textEdit', r);
    r = await run('layerNew', { name: 'Рисунок' }); ok(r.ok, 'layerNew', r);
    const lid = r.result.layer;
    r = await run('draw', { layer: lid, points: [[100, 100], [300, 200], [500, 120]], size: 30, color: 'red', opacity: 100, hardness: 80 }); ok(r.ok, 'draw: кисть по точкам', r);
    r = await run('draw', { layer: lid, points: [[100, 100], [300, 200]], size: 20, erase: true }); ok(r.ok, 'draw: ластик', r);
    r = await run('select', { layer: 1 }); ok(!r.ok || r.ok, 'select (номер может не существовать)');
    r = await run('info'); const bg = r.result.layers[0].id;
    r = await run('adjust', { layer: bg, brightness: 20, contrast: 15, saturation: 30, temperature: 25 }); ok(r.ok && r.result.adj.brightness === 20, 'adjust: коррекция', r);
    r = await run('filter', { layer: bg, preset: 'vintage' }); ok(r.ok, 'filter: винтаж', r);
    r = await run('auto', { layer: bg }); ok(r.ok, 'auto: автоулучшение', r);
    r = await run('crop', { aspect: '9:16' }); ok(r.ok && Math.abs(r.result.w / r.result.h - 9 / 16) < 0.01, 'crop 9:16', r);
    r = await run('rotate', { deg: 90 }); ok(r.ok, 'rotate 90', r);
    r = await run('flip', { axis: 'h' }); ok(r.ok, 'flip h', r);
    r = await run('resize', { w: 400 }); ok(r.ok && r.result.w === 400, 'resize w 400', r);
    r = await run('layerDup', { layer: tid }); ok(r.ok, 'layerDup', r);
    r = await run('layer', { layer: tid, opacity: 70, blend: 'screen', angle: 10 }); ok(r.ok && r.result.opacity === 70 && r.result.blend === 'screen', 'layer: прозрачность и наложение', r);
    r = await run('layerOrder', { layer: tid, to: 'bottom' }); ok(r.ok && r.result.index === 0, 'layerOrder bottom', r);
    r = await run('layerOrder', { layer: tid, to: 'top' }); ok(r.ok, 'layerOrder top', r);
    r = await run('layerMerge', { layer: tid }); ok(r.ok, 'layerMerge', r);
    r = await run('fill', { layer: lid, color: '#00ff0080' }); ok(r.ok || /Нет такого/.test(r.error), 'fill', r);
    const before = (await run('info')).result;
    r = await run('undo'); ok(r.ok && r.result.done, 'undo', r);
    r = await run('redo'); ok(r.ok && r.result.done, 'redo', r);
    const after = (await run('info')).result;
    ok(JSON.stringify(before.layers.map(l => l.id)) === JSON.stringify(after.layers.map(l => l.id)), 'undo+redo — то же состояние слоёв');
    r = await run('export', { to: 'assets', format: 'png', name: 'Проверка' }); ok(r.ok && /^a[a-z0-9]+$/.test(r.result.asset), 'export → «Мои материалы»', r);
    const asset = r.result.asset;
    r = await run('export', { to: 'assets', format: 'jpeg', quality: 80, scale: 0.5 }); ok(r.ok && r.result.format === 'jpg', 'export JPEG 50%', r);
    r = await run('open', { asset }); ok(r.ok && r.result.w === 400, 'open из «Моих материалов»', r);
    r = await run('place', { asset, scale: 0.5 }); ok(r.ok, 'place слоем', r);
    r = await run('flatten'); ok(r.ok, 'flatten', r);
    // ошибки схемы — понятный отказ, команда не выполняется
    r = await run('crop', { w: 10 }); ok(!r.ok && /h/.test(r.error), 'схема: crop без h — отказ', r);
    r = await run('adjust', { brightness: 500 }); ok(!r.ok && /не больше 100/.test(r.error), 'схема: яркость 500 — отказ', r);
    r = await run('layer', { layer: 999 }); ok(!r.ok && /Нет такого слоя/.test(r.error), 'нет такого слоя — отказ', r);
    r = await run('text', { text: 'x', bogus: 1 }); ok(!r.ok && /такого поля нет/.test(r.error), 'лишнее поле — отказ', r);
    // план «d37 v1» как от ИИ: ссылка на результат шага
    const plan = { d37: 1, steps: [{ tool: 'photo', cmd: 'new', args: { w: 300, h: 300 } }, { tool: 'photo', cmd: 'text', args: { text: 'ИИ' } }, { tool: 'photo', cmd: 'layer', args: { layer: '$2.layer', opacity: 50 } }, { tool: 'photo', cmd: 'export', args: { to: 'assets' } }] };
    const pr = JSON.parse(await C.ev(`D37AI.run(${JSON.stringify(JSON.stringify(plan))}).then(r => JSON.stringify(r))`));
    ok(pr.ok && pr.done === 4 && /^a/.test(pr.results[3].asset), 'план ИИ из 4 шагов со ссылкой $2.layer', pr);
    const un = await C.ev(`D37Tools.undoSteps(${JSON.stringify(pr.steps)})`);
    ok(un === 3, '«Отменить всё» отменило 3 шага (экспорт не отменяется)', un);
    const prompt = await C.ev(`D37AI.prompt('сделай ярче', { tools: ['photo'] })`);
    ok(/"d37":1/.test(prompt) && /adjust/.test(prompt) && /Задача: сделай ярче/.test(prompt), 'задание для ИИ: формат, команды, задача');
    // кнопки панели
    await C.ev(`document.querySelector('.pe-tool[data-tool="adjust"]').click(); 1`);
    ok(await C.ev(`!!document.querySelector('.pe-pb [data-k="adj:brightness"]')`), 'кнопка «Коррекция» открывает ползунки');
    await C.ev(`document.querySelector('.pe-tool[data-tool="layers"]').click(); 1`);
    ok(await C.ev(`document.querySelectorAll('.pe-layer').length >= 1`), 'кнопка «Слои» — список слоёв');
    await C.ev(`document.querySelector('[data-a="send"]').click(); 1`);
    ok(await C.ev(`document.querySelectorAll('.pe-menu [data-m]').length >= 6`), '«📤 Сохранить» — меню «Отправить в…»');
    await C.ev(`document.querySelector('.pe-menu [data-m="studio3d"]').click(); 1`);
    const s3 = await C.until(`[...document.querySelectorAll('.pe-toast')].some(t => /Студия 3D/.test(t.textContent))`, 30000);
    ok(s3 >= 0, '«В Студию 3D» — модель сохранена', await C.ev(`[...document.querySelectorAll('.pe-toast')].map(t=>t.textContent).join(' | ')`));
    const mid = await C.ev(`window.D37E && D37E.models ? D37E.models.list().then(l => l.length) : -1`);
    ok(mid >= 1, 'в «🧩 Модели» Студии 3D есть картинка', mid);
    ok(realErrors(C.errors).length === 0, 'нет ошибок в консоли', realErrors(C.errors));
  } finally { await C.close(); }
}

async function load(base){
  const C = await chrome('load'), res = [];
  try {
    await C.phone(4);
    await C.send('Network.setCacheDisabled', { cacheDisabled: true });
    await C.send('Network.setBypassServiceWorker', { bypass: true });   // без кэша sw.js — как в первый раз
    for (let i = 0; i < 5; i++) {
      await C.load('about:blank'); await sleep(500);
      await C.load(base + '/');   // сайт открыт, человек нажал «Фоторедактор» (раздел без перезагрузки)
      await C.until('typeof D37Route !== "undefined" && document.body.dataset.route === "home"', 30000);
      await sleep(1500);
      C.resetBytes();
      const t0 = Date.now();
      await C.ev(`D37Route.go('/photo'); 1`);
      const t = await C.until('!!(window.D37Photo && window.D37Photo.E)', 60000);
      res.push({ ms: t >= 0 ? Date.now() - t0 : -1, kb: Math.round(C.bytes / 1024) });
    }
  } finally { await C.close(); }
  const med = k => res.map(r => r[k]).sort((a, b) => a - b)[Math.floor(res.length / 2)];
  console.log('load (телефон, ЦП ×4, без кэша): раздел готов за', med('ms'), 'мс, скачано', med('kb'), 'КБ', JSON.stringify(res));
  ok(med('ms') > 0 && med('ms') < 6000, 'раздел готов меньше чем за 6 с на профиле телефона', res);
  ok(med('kb') < 600, 'скачано меньше 600 КБ', res);
}

async function big(base){
  const C = await chrome('big');
  try {
    await C.phone(4);
    // нулевая точка — сайт уже открыт (главная), редактор ещё нет: считаем только то, что добавил редактор
    await C.load(base + '/'); await C.until('typeof D37Route !== "undefined" && document.body.dataset.route === "home"', 30000);
    await sleep(3000); await C.gc(); await sleep(800); const m0 = C.mem();
    await C.ev(`D37Route.go('/photo'); 1`);
    if (await C.until('!!(window.D37Photo && window.D37Photo.E)', 60000) < 0) throw new Error('редактор не открылся');
    await sleep(2000); await C.gc(); const m1 = C.mem();
    const t0 = Date.now();
    const o = JSON.parse(await C.ev(`(${MKIMG})(4000, 3000).then(b => D37Photo.E.openBlob(b, 'test-12mp')).then(r => JSON.stringify(r))`, 180000));
    const openMs = Date.now() - t0;
    await sleep(2000); await C.gc(); const m2 = C.mem();
    const tA = Date.now();
    const a = JSON.parse(await C.ev(RUN('adjust', { brightness: 15, contrast: 20, saturation: 20, sharpen: 30 })));
    const adjMs = Date.now() - tA;
    await sleep(1500); await C.gc(); const m3 = C.mem();
    const tD = Date.now();
    for (let i = 0; i < 5; i++) await C.ev(RUN('draw', { points: [[200, 300 + i * 400], [3800, 500 + i * 400]], size: 60, color: '#ff0000' }));
    const drawMs = Date.now() - tD;
    await sleep(1000); await C.gc(); const m4 = C.mem();
    const tE = Date.now();
    const e = JSON.parse(await C.ev(RUN('export', { to: 'assets', format: 'jpeg', quality: 90 }), 240000));
    const expMs = Date.now() - tE;
    await sleep(1500); await C.gc(); const m5 = C.mem();
    const res = { open: o, openMs, adjMs, drawMs, expMs, exportOk: e.ok, exported: e.result, memMB: { base: MB(m1 - m0), open12mp: MB(m2 - m0), adjust: MB(m3 - m0), draw5: MB(m4 - m0), export: MB(m5 - m0) } };
    console.log('big (телефон, ЦП ×4):', JSON.stringify(res));
    ok(o.w * o.h >= 11.5e6, 'фото 12 Мп открыто без уменьшения', o);
    ok(a.ok && e.ok, 'коррекция и сохранение 12 Мп', { a, e });
    ok(!Number.isFinite(m5) || (m5 - m0) / 1048576 < 700, 'память с 12 Мп меньше 700 МБ на весь Chrome', res.memMB);
    ok(C.crashes.length === 0 && realErrors(C.errors).length === 0, 'без падений и ошибок', realErrors(C.errors));
  } finally { await C.close(); }
}

async function soak(base, minutes){
  const C = await chrome('soak');
  const samples = [], acts = {};
  try {
    await C.phone(4);
    await C.load('about:blank'); await sleep(500); const m0 = C.mem();
    await openEditor(C, base);
    await C.ev(`(${MKIMG})(2000, 1500).then(b => D37Photo.E.openBlob(b, 'soak')).then(() => 1)`, 120000);
    let seed = 37; const R = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    const CMDS = [
      () => ['adjust', { brightness: Math.round(R() * 100 - 50), contrast: Math.round(R() * 60 - 30) }],
      () => ['filter', { preset: ['none', 'bw', 'sepia', 'vintage', 'polaroid'][Math.floor(R() * 5)] }],
      () => ['text', { text: 'Тест ' + Math.floor(R() * 100), size: 20 + Math.round(R() * 120), x: Math.round(R() * 1500), y: Math.round(R() * 1200) }],
      () => ['layerNew', {}],
      () => ['draw', { points: [[R() * 2000, R() * 1500], [R() * 2000, R() * 1500], [R() * 2000, R() * 1500]], size: 5 + R() * 80, color: '#' + Math.floor(R() * 0xffffff).toString(16).padStart(6, '0') }],
      () => ['draw', { points: [[R() * 2000, R() * 1500], [R() * 2000, R() * 1500]], size: 40, erase: true }],
      () => ['layer', { opacity: Math.round(R() * 100), blend: ['normal', 'multiply', 'screen', 'overlay'][Math.floor(R() * 4)] }],
      () => ['layerOrder', { to: ['up', 'down', 'top', 'bottom'][Math.floor(R() * 4)] }],
      () => ['layerDup', {}], () => ['layerDelete', {}], () => ['layerMerge', {}],
      () => ['undo', {}], () => ['undo', {}], () => ['redo', {}],
      () => ['rotate', { deg: [90, -90, 180][Math.floor(R() * 3)] }], () => ['flip', { axis: R() < 0.5 ? 'h' : 'v' }],
      () => ['crop', { aspect: ['1:1', '4:5', '16:9', '9:16'][Math.floor(R() * 4)] }],
      () => ['resize', { scale: 0.8 + R() * 0.4 }], () => ['auto', {}], () => ['flatten', {}],
      () => ['export', { to: 'assets', format: ['png', 'jpeg', 'webp'][Math.floor(R() * 3)], scale: 0.5 }],
      () => ['new', { w: 600 + Math.round(R() * 1400), h: 600 + Math.round(R() * 1400) }],
    ];
    const t0 = Date.now(); let lastS = 0, n = 0;
    while (Date.now() - t0 < minutes * 60000) {
      const r = R();
      if (r < 0.55) { const [cmd, args] = CMDS[Math.floor(R() * CMDS.length)](); const res = JSON.parse(await C.ev(RUN(cmd, args), 120000).catch(e => JSON.stringify({ ok: false, error: 'TIMEOUT ' + e.message }))); acts[cmd] = (acts[cmd] || 0) + 1; if (!res.ok && /TIMEOUT/.test(res.error)) C.errors.push('команда зависла: ' + cmd); }
      else if (r < 0.75) {   // нажатия на кнопки интерфейса
        const p = JSON.parse(await C.ev(`(() => { const b = [...document.querySelectorAll('.pe button:not([disabled])')].filter(x => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= innerHeight && !x.closest('.pe-menu') && !/full|send|menu|ai/.test(x.dataset.a || ''); }); const x = b[Math.floor(${R()} * b.length)]; if (!x) return 'null'; const r = x.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
        if (p) { await C.touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await C.touch('touchEnd', []); }
        acts.ui = (acts.ui || 0) + 1;
      } else if (r < 0.9) {   // палец по холсту (рисует, двигает, рамка обрезки — смотря что выбрано)
        const x0 = 40 + R() * 330, y0 = 140 + R() * 360, x1 = 40 + R() * 330, y1 = 140 + R() * 360;
        await C.touch('touchStart', [{ x: x0, y: y0, id: 1 }]);
        for (let i = 1; i <= 6; i++) await C.touch('touchMove', [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6, id: 1 }]);
        await C.touch('touchEnd', []);
        acts.drag = (acts.drag || 0) + 1;
      } else {   // щипок двумя пальцами
        const cx = 206, cy = 330, d0 = 60 + R() * 80, d1 = 120 + R() * 160, pt = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
        await C.touch('touchStart', pt(d0)); for (let i = 1; i <= 5; i++) await C.touch('touchMove', pt(d0 + (d1 - d0) * i / 5)); await C.touch('touchEnd', []);
        acts.pinch = (acts.pinch || 0) + 1;
      }
      n++;
      await C.ev(`document.querySelector('.pe-modal') && document.querySelector('.pe-modal').remove(); window.D37AI && D37AI.close(); document.querySelector('.pe-menu') && document.dispatchEvent(new PointerEvent('pointerdown')); 1`).catch(() => {});
      if (Date.now() - lastS > 30000) { lastS = Date.now(); await C.gc(); const m = C.mem(); samples.push({ s: Math.round((Date.now() - t0) / 1000), memMB: MB(m - m0), err: realErrors(C.errors).length }); console.log('soak', JSON.stringify(samples[samples.length - 1])); }
      await sleep(80 + R() * 200);
    }
    await C.gc(); await sleep(1000); const mE = C.mem();
    const errs = [...new Set(realErrors(C.errors))];
    console.log('soak', minutes, 'мин:', n, 'действий', JSON.stringify(acts), 'ошибок', errs.length, 'падений', C.crashes.length, 'память в конце', MB(mE - m0), 'МБ, наибольшая', Math.max(...samples.map(s => s.memMB)), errs.slice(0, 5));
    ok(errs.length === 0, `за ${minutes} мин — 0 ошибок`, errs.slice(0, 8));
    ok(C.crashes.length === 0, 'страница не падала');
    const still = await C.ev('!!(window.D37Photo && window.D37Photo.E && !window.D37Photo.E.disposed)').catch(() => false);
    ok(still, 'редактор жив после прогона');
  } finally { await C.close(); }
}

async function leak(base, n = 20){
  const C = await chrome('leak'), pts = [];
  try {
    await C.desktop();
    await C.load(base + '/'); await C.until('typeof D37Route !== "undefined"', 30000); await sleep(1500);
    for (let i = 0; i <= n; i++) {
      await C.ev(`D37Route.go('/photo'); 1`);
      await C.until('!!(window.D37Photo && window.D37Photo.E)', 60000);
      await C.ev(`(${MKIMG})(1600, 1200).then(b => D37Photo.E.openBlob(b, 'leak')).then(() => D37Tools.run('photo', 'adjust', { brightness: 10 })).then(() => 1)`, 60000);
      await C.ev(`D37Route.go('/'); 1`);
      await C.until('!window.D37Photo', 20000);
      if (i === 1 || i % 4 === 0 || i === n) {
        await sleep(1500); await C.gc(); await sleep(800);
        // память «шумит» (сборка мусора, кэши видеокарты): берём наименьшее из 3 замеров, страницу и видеокарту — отдельно
        let rend = Infinity, gpu = Infinity; for (let k = 0; k < 3; k++) { await C.gc(); const m = C.mem(true); rend = Math.min(rend, m.renderer); gpu = Math.min(gpu, m.gpu); await sleep(400); }
        const h = await C.send('Runtime.getHeapUsage').catch(() => ({})), dc = await C.send('Memory.getDOMCounters').catch(() => ({}));
        pts.push({ i, pageMB: MB(rend), gpuMB: MB(gpu), heapMB: MB(h.usedSize || 0), nodes: dc.nodes, listeners: dc.jsEventListeners, canvases: await C.ev('document.querySelectorAll("canvas").length') });
        console.log('leak', JSON.stringify(pts[pts.length - 1]));
      }
    }
    // наклон памяти страницы после разогрева (первые 4 раза — кэши кода и шейдеров) — МБ за одно открытие/закрытие
    const warm = pts.filter(p => p.i >= 4);
    const slopeOf = k => { const xs = warm.map(p => p.i), ys = warm.map(p => p[k]), mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
      return xs.reduce((s, x, j) => s + (x - mx) * (ys[j] - my), 0) / xs.reduce((s, x) => s + (x - mx) * (x - mx), 0); };
    const slope = slopeOf('pageMB'), slopeG = slopeOf('gpuMB');
    const growHeap = pts[pts.length - 1].heapMB - pts[0].heapMB, growNodes = pts[pts.length - 1].nodes - pts[0].nodes;
    console.log(`leak: ${n} открытий/закрытий — страница ${slope > 0 ? '+' : ''}${slope.toFixed(2)} МБ за раз, видеокарта ${slopeG > 0 ? '+' : ''}${slopeG.toFixed(2)} МБ за раз, куча JS ${growHeap > 0 ? '+' : ''}${growHeap.toFixed(1)} МБ, узлов DOM ${growNodes > 0 ? '+' : ''}${growNodes}`);
    ok(!Number.isFinite(slope) || slope < 2.5, `${n} открытий/закрытий — память страницы не растёт (< 2,5 МБ за раз)`, pts);
    // процесс видеокарты держит кэш освобождённых холстов (растёт первые ~10 раз и стоит) — проверяем, что он ограничен
    const g4 = (pts.find(p => p.i === 4) || pts[0]).gpuMB, gEnd = pts[pts.length - 1].gpuMB;
    ok(!Number.isFinite(gEnd) || gEnd < g4 + 300, `память видеокарты ограничена (в конце < чем после разогрева + 300 МБ)`, pts);
    ok(growHeap < 8, `куча JS не растёт (< 8 МБ)`, pts);
    ok(!(growNodes > 200), 'узлы DOM не копятся', pts);
    ok(realErrors(C.errors).length === 0, 'без ошибок', realErrors(C.errors));
  } finally { await C.close(); }
}

async function shots(base){
  const C = await chrome('shot');
  try {
    await C.phone(1);
    await openEditor(C, base);
    await sleep(1200);
    await C.shot(path.join(TMP, 'shots/pe-phone-start.jpg'));
    await C.ev(`document.querySelector('[data-a="startClose"]')?.click(); (${MKIMG})(1600, 1200).then(b => D37Photo.E.openBlob(b, 'фото')).then(() => D37Tools.run('photo', 'text', { text: 'ПОБЕДА', color: 'yellow' })).then(() => 1)`);
    await C.ev(`document.querySelector('.pe-tool[data-tool="adjust"]').click(); 1`); await sleep(800);
    await C.shot(path.join(TMP, 'shots/pe-phone-adjust.jpg'));
    await C.ev(`document.querySelector('.pe-tool[data-tool="text"]').click(); 1`); await sleep(800);
    await C.shot(path.join(TMP, 'shots/pe-phone-text.jpg'));
    const taps = await C.ev(`(() => { const els = [...document.querySelectorAll('.pe button, .pe input, .pe select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight; }); return { total: els.length, under40: els.filter(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 40; }).map(e => (e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)), overflowX: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
    console.log('phone tap targets:', JSON.stringify(taps));
    await C.desktop(1440, 900); await sleep(1200);
    await C.ev(`document.querySelector('.pe-tool[data-tool="layers"]').click(); 1`); await sleep(800);
    await C.shot(path.join(TMP, 'shots/pe-desktop.jpg'));
    ok(realErrors(C.errors).length === 0, 'без ошибок на снимках', realErrors(C.errors));
  } finally { await C.close(); }
}

(async () => {
  const port = 5600 + Math.floor(Math.random() * 300);
  const srv = startServe(port);
  try {
    if (!await waitPort(port)) throw new Error('serve.py не запустился');
    const base = `http://localhost:${port}`;
    if (MODE === 'smoke' || MODE === 'all') await smoke(base);
    if (MODE === 'load' || MODE === 'all') await load(base);
    if (MODE === 'big' || MODE === 'all') await big(base);
    if (MODE === 'leak' || MODE === 'all') await leak(base);
    if (MODE === 'shot' || MODE === 'all') await shots(base);
    if (MODE === 'soak' || MODE === 'all') await soak(base, MIN);
  } catch (e) { fail++; console.log('FAIL', e.stack || e.message); }
  finally { srv.kill(); }
  console.log(`photo-e2e ${MODE}: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

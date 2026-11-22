// «Арена» на нашем движке (T-176 S2, js/games/studio-arena.js) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) на
// scripts/serve.py, движок — папка d37-preview/ этого сайта. Путь человека на телефоне (390 × 844, тёмная тема) и ПК (1440 × 900, светлая):
//   главная студии → карточка «⚡ Арена на нашем движке» → «Из примера» → поменять число → «▶ Проверить» — режим идёт на НАШЕМ движке
//   (раунд из файла человека: карта «mine») → поменять ещё → «Проверить ещё раз» — тот же движок, раунд заново за пару секунд →
//   добавить правило из меню → проверка движка «в порядке» → сломать значение → причина по-русски у своего поля → «Сохранить в файл»
//   / «Открыть из файла» текстом → «■ Стоп» → «Мои проекты» показывает «Арена»; флаг STUDIO_ARENA = false — карточки и адреса нет.
// 0 ошибок в консоли, загрузки запрещены (Page.setDownloadBehavior deny), Supabase подменён (любая запись — отказ без отправки).
// Снимки — <D37_TMP>\shots\arena-*.jpg. Запуск из корня сайта: node scripts/studio-arena-e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/arena' : path.join(require('os').tmpdir(), 'arena'));
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
      const body = fs.readFileSync(path.join(SITE, 'js/core/config.js'), 'utf8').replace(/^const STUDIO_ONE = (true|false);/m, 'const STUDIO_ONE = true;').replace(/^const STUDIO_ARENA = (true|false);/m, `const STUDIO_ARENA = ${net.flag !== false};`).replace(/^const STUDIO_SHARE = (true|false);/m, 'const STUDIO_SHARE = false;');   // S2 как было; «На сайт» — studio-share-e2e
      return reply(200, body, 'text/javascript; charset=utf-8');
    }
    if (rq.method === 'OPTIONS') return reply(204, '');
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
const VIEW = { phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, pc: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } };
async function setView(B, v){
  await B.send('Emulation.setDeviceMetricsOverride', VIEW[v]);
  await B.send('Emulation.setTouchEmulationEnabled', { enabled: v === 'phone', maxTouchPoints: v === 'phone' ? 5 : 1 });
  if (v === 'phone') await B.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
}
const T = `window.D37StudioArena?._test`;
const MS = `(() => { try { return ${T}.host()?.lobby.state() || null; } catch (e) { return null; } })()`;   // состояние режима движка
// поставить значение полю формы и послать change (как человек: ввёл и ушёл из поля)
const setField = (p, v) => `(() => { const e = document.querySelector('.sa-form [data-path="${p}"]'); if (!e) return false; e.value = ${JSON.stringify(String(v))}; e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;

async function walk(port, view, theme){
  const tag = `${view}-${theme}`;
  const net = { writes: [], theme, flag: true };
  const B = await chrome(net);
  try {
    await setView(B, view);
    await B.send('Page.navigate', { url: `http://localhost:${port}/` });
    ok(await B.until(READY, 90000), `${tag}: сайт загрузился`);
    ok(await B.ev(`STUDIO_ARENA === true`), `${tag}: STUDIO_ARENA включён`);
    await B.ev(`D37Route.go('#/games/studio'); 1`);
    ok(await B.until(`!!document.querySelector('#gamesStageBox .so-modes .so-arena')`, 30000), `${tag}: на главной студии карточка «⚡ Арена на нашем движке»`);
    ok(await B.ev(`document.querySelector('.so-modes').firstElementChild.classList.contains('so-arena') && document.querySelectorAll('.so-mode').length === 10`), `${tag}: карточка — первая в ряду, десять заготовок на месте`);
    ok(await B.ev(`!window.D37Engine && !document.querySelector('canvas.d37h-canvas')`), `${tag}: на главной движок не грузится`);
    // «Из примера»
    await B.ev(`document.querySelector('.so-arena [data-arena="demo"]').click(); 1`);
    ok(await B.until(`!!document.querySelector('.sa-form [data-path="rules[0].len_s"]') && /✓/.test(document.querySelector('.sa-st').textContent)`, 90000), `${tag}: «Из примера» — форма из blocks.json, проверка движка «в порядке»`, await B.ev(`document.querySelector('.sa-st')?.textContent`));
    const form = await B.ev(`(() => { const f = document.querySelector('.sa-form'); return { secs: [...f.querySelectorAll('.sa-sec')].map(s => s.dataset.sec), laws: f.querySelectorAll('.sa-law').length, url: location.hash, h: [...f.querySelectorAll('.sa-h')].map(h => h.firstChild.textContent.trim()), when: [...f.querySelectorAll('.sa-w-k')].slice(0, 3).map(e => e.textContent) }; })()`);
    ok(form.secs.join() === 'rules,objects,laws,texts' && form.laws === 12 && /arena\/open\/[a-z0-9]+$/.test(form.url), `${tag}: разделы по file.sections, 12 правил примера, адрес open/<проект>`, form);
    ok(form.when.join('|') === 'Когда|Если|То', `${tag}: правило читается «Когда — Если — То» (имена категорий движка)`, form.when);
    // поменять число → ▶ Проверить
    ok(await B.ev(setField('rules[0].len_s', 60)), `${tag}: поле «длина раунда» есть`);
    await B.until(`${T}.state()?.file?.rules?.[0]?.len_s === 60 && ${T}.state()?.report?.ok`, 5000);
    await B.ev(`document.querySelector('.sa-run').click(); 1`);
    ok(await B.until(`${T}.state()?.running === true`, 180000), `${tag}: «▶ Проверить» — движок загрузился в рамке редактора`, await B.ev(`document.querySelector('.sa-st')?.textContent`));
    ok(await B.until(`(${MS})?.game === 'umode' && (${MS})?.map === 'mine'`, 30000), `${tag}: движок играет СВОЙ файл человека (режим umode, карта mine)`, await B.ev(MS));
    ok(await B.ev(`!!document.querySelector('.sa-stage canvas') && document.querySelector('.sa-cover').hidden && !document.querySelector('.sa-stop').hidden`), `${tag}: игра в рамке, «■ Стоп» видна`);
    await sleep(4000);
    const s1 = await B.ev(MS);
    await B.shot(`arena-${tag}-play`);
    // правка → «Проверить ещё раз»: тот же движок, раунд заново
    ok(await B.ev(setField('objects[0].r', 400)), `${tag}: поле «радиус зоны» есть`);
    await B.until(`${T}.state()?.report?.ok && ${T}.state()?.file?.objects?.[0]?.r === 400`, 5000);
    const t0 = Date.now();
    await B.ev(`document.querySelector('.sa-run').click(); 1`);
    ok(await B.until(`(${MS})?.step < ${JSON.stringify(s1?.step || 0)} && (${MS})?.map === 'mine'`, 5000), `${tag}: правка → «Проверить ещё раз» — раунд с начала на том же движке без перезагрузки`, { s1, now: await B.ev(MS) });
    ok(Date.now() - t0 < 3000, `${tag}: перезапуск быстрее 3 с`, Date.now() - t0);
    ok(await B.ev(`document.querySelectorAll('canvas.d37h-canvas').length === 1`), `${tag}: движок один (не запущен второй раз)`);
    // правило из меню
    const n0 = await B.ev(`document.querySelectorAll('.sa-law').length`);
    await B.ev(`document.querySelector('.sa-addlaw').click(); 1`);
    ok(await B.until(`document.querySelectorAll('.sa-law').length === ${n0 + 1}`, 5000), `${tag}: «+ Правило» — новая карточка`);
    const added = await B.ev(`(() => { const law = [...document.querySelectorAll('.sa-law')].pop(); const s = law.querySelectorAll('select[data-add]')[1]; const o = [...s.options].find(o => o.value && !o.disabled && /Сменить|Дать|Звук|Надпись/.test(o.textContent)) || [...s.options].find(o => o.value && !o.disabled); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return o.textContent; })()`);
    ok(await B.until(`${T}.state()?.file?.laws?.length === ${n0 + 1} && ${T}.state()?.file?.laws?.at(-1)?.do?.length === 2 && ${T}.state()?.report?.ok && /✓/.test(document.querySelector('.sa-st').textContent)`, 5000), `${tag}: действие «${added}» из меню добавлено — проверка движка «в порядке»`, await B.ev(`document.querySelector('.sa-st').textContent`));
    // сломать значение → причина по-русски у своего поля
    await B.ev(setField('objects[0].r', ''));
    ok(await B.until(`${T}.state()?.report && !${T}.state().report.ok`, 5000), `${tag}: пустое число — движок файл не принял`);
    const err = await B.ev(`(() => { const f = document.querySelector('.sa-form [data-path="objects[0].r"]').closest('.sa-f'); const n = f.nextElementSibling; return { at: !!n && n.classList.contains('sa-err'), text: n?.textContent || '', st: document.querySelector('.sa-st').textContent, run: document.querySelector('.sa-run').disabled }; })()`);
    ok(err.at && /^objects\[0\]\.r: .*[а-я]/.test(err.text) && /^⚠/.test(err.st) && err.run, `${tag}: причина по-русски — прямо под полем, «Проверить» не даёт запустить сломанный файл`, err);
    await B.shot(`arena-${tag}-error`);
    await B.ev(setField('objects[0].r', 300));
    ok(await B.until(`${T}.state()?.report?.ok && !document.querySelector('.sa-form .sa-err')`, 5000), `${tag}: исправил — причина ушла`);
    // «Сохранить в файл» / «Открыть из файла» — текстом
    await B.ev(`document.querySelector('[data-save]').click(); 1`);
    const saved = await B.ev(`(() => { const t = document.querySelector('.sa-io-t').value; try { const f = JSON.parse(t); return { ok: !document.querySelector('.sa-io').hidden, laws: f.laws.length, r: f.objects[0].r, fmt: f.format }; } catch (e) { return null; } })()`);
    ok(saved && saved.ok && saved.laws === n0 + 1 && saved.r === 300 && saved.fmt === 1, `${tag}: «Сохранить в файл» — текст файла режима`, saved);
    await B.ev(`document.querySelector('[data-open]').click(); 1`);
    await B.ev(`(() => { const f = ${T}.state().file; const c = JSON.parse(JSON.stringify(f)); c.rules[0].len_s = 45; document.querySelector('.sa-io-t').value = JSON.stringify(c); document.querySelector('[data-io-ok]').click(); return 1; })()`);
    ok(await B.until(`${T}.state()?.file?.rules?.[0]?.len_s === 45 && document.querySelector('.sa-form [data-path="rules[0].len_s"]').value === '45' && ${T}.state()?.report?.ok`, 5000), `${tag}: «Открыть из файла» — форма из открытого текста`);
    // ep39: «Вдвоём — скоро» больше нет — на его месте общий блок комнат (D37Join, игра umode); «Выложить — скоро» только без флага
    ok(await B.ev(`[...document.querySelectorAll('.sa-files button[disabled]')].every(b => /Выложить — скоро/.test(b.textContent)) && !/Вдвоём — скоро/.test(document.querySelector('.sa').textContent) && !!document.querySelector('.sa-rooms')`), `${tag}: «Вдвоём — скоро» заменён общим блоком комнат`);
    if (view === 'phone') ok(await B.ev(`(() => { const p = document.querySelector('.sa-play').getBoundingClientRect(), f = document.querySelector('.sa-form').getBoundingClientRect(); return p.bottom <= f.top + 1 && document.documentElement.scrollWidth <= 391; })()`), `${tag}: телефон — игра сверху, форма ниже, без сдвига вбок`);
    else ok(await B.ev(`(() => { const p = document.querySelector('.sa-play').getBoundingClientRect(), f = document.querySelector('.sa-right').getBoundingClientRect(); return f.left >= p.right - 1; })()`), `${tag}: ПК — игра и форма рядом`);
    // ■ Стоп
    await B.ev(`document.querySelector('.sa-stop').click(); 1`);
    ok(await B.until(`!${T}.state()?.hasHost && !document.querySelector('.sa-stage canvas') && !document.querySelector('.sa-cover').hidden`, 5000), `${tag}: «■ Стоп» — движок закрыт`);
    // «Мои проекты»
    const pid = await B.ev(`${T}.state().id`);
    await B.ev(`D37Route.go('#/games/studio'); 1`);
    ok(await B.until(`!!document.querySelector('.so-mine a[href="#/games/studio/arena/open/${pid}"]')`, 20000), `${tag}: «Мои проекты» — «Арена» этого браузера`);
    ok(await B.ev(`/Арена · только в этом браузере/.test(document.querySelector('.so-mine a[href="#/games/studio/arena/open/${pid}"]').closest('.so-row').textContent)`), `${tag}: подпись «только в этом браузере»`);
    await B.ev(`document.querySelector('.so-mine a[href="#/games/studio/arena/open/${pid}"]').click(); 1`);
    ok(await B.until(`${T}.state()?.id === '${pid}' && ${T}.state()?.file?.rules?.[0]?.len_s === 45`, 20000), `${tag}: проект открылся с правками`);
    ok(net.writes.length === 0, `${tag}: в базу ничего не отправлено`, net.writes);
    ok(realErrors(B.errs).length === 0, `${tag}: 0 ошибок в консоли`, realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}

async function flagOff(port){
  const net = { writes: [], theme: 'dark', flag: false };
  const B = await chrome(net);
  try {
    await setView(B, 'phone');
    await B.send('Page.navigate', { url: `http://localhost:${port}/#/games/studio` });
    ok(await B.until(READY, 90000), 'выкл: сайт загрузился');
    ok(await B.until(`document.querySelectorAll('#gamesStageBox .so-mode').length === 10`, 30000), 'выкл: главная студии как была');
    ok(await B.ev(`STUDIO_ARENA === false && !document.querySelector('.so-arena') && !window.D37StudioArena`), 'выкл: карточки «Арена» нет, редактор не загружен');
    await B.ev(`D37Route.go('#/games/studio/arena/demo'); 1`); await sleep(1500);
    ok(await B.ev(`!document.querySelector('.sa') && !!document.querySelector('.so')`), 'выкл: адрес …/arena/… открывает главную студии');
    ok(realErrors(B.errs).length === 0, 'выкл: 0 ошибок в консоли', realErrors(B.errs).slice(0, 6));
  } finally { await B.close(); }
}

(async () => {
  const port = 6400 + Math.floor(Math.random() * 300);
  const srv = startServe(port);
  try {
    ok(await waitPort(port), 'scripts/serve.py запустился');
    for (const [v, t] of [['phone', 'dark'], ['pc', 'light']]) await walk(port, v, t);   // по одному Chrome за раз
    await flagOff(port);
  } catch (e) { fail++; console.log('ОШИБКА', e.stack || e.message); }
  finally { srv.kill(); }
  console.log(`\nstudio-arena-e2e: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

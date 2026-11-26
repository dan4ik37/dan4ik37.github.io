// «Студия 3D» на НАШЕМ движке (EDITOR_ONE S7 / S8, js/games/studio3d-d37.js, флаг STUDIO_D37) в настоящем Chrome (headless,
// DevTools Protocol, без npm) на scripts/serve.py; движок — папка d37-preview/ этого сайта. Путь человека через саму страницу студии:
//   урок «Первый мир за 5 минут» на месте → ярлык «⚡ Наш движок» → «🪟 Рядом» (старый | наш, тот же мир, та же камера) → «▶ Играть» —
//   мир идёт на нашем движке, кадры в движении (идём, бежим) → «■ Стоп» — мир как был;
//   шаблоны «Пустой», «Обби» (скрипты JS), «Площадка»; ворота: «Остров» (холмы, вода) и заготовка режима остаются на старом движке и
//   говорят почему; мир со скриптом на КАЖДОМ из шести языков (JS — дверь на касание, Lua — счётчик, C# — плавное движение, Java —
//   сообщение, Rust — монетка, C++ — крутилка; C++ и Rust собираются кнопкой сайта «⚙️ Собрать» — компиляторы с CDN, как у людей);
//   зависший скрипт убит за 3 с и на нашем движке; старый мир после игры открывается тем же.
// Запуск из корня сайта: node scripts/studio-d37-e2e.cjs [--gl 0|1] [--view phone|800|1920|3440|pc] [--only lesson,empty,obby,gate,s8,langs,old]
// Снимки — <D37_TMP>\shots\s3d-*.jpg (по умолчанию M:/d37/claude-tmp/studio/shots).
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/studio' : path.join(require('os').tmpdir(), 'studio-d37'));
const SHOTS = path.join(TMP, 'shots');
const A = {}; for (let i = 2; i < process.argv.length; i += 2) A[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const GL = A.gl === '1' ? '1' : '0', VIEWN = A.view || 'pc', ONLY = A.only ? new Set(A.only.split(/[,+]/)) : null;
const want = k => !ONLY || ONLY.has(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('ok  ', name); } else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 900)); } };
const VIEW = { phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, '800': { width: 800, height: 600, deviceScaleFactor: 1, mobile: false },
  '1920': { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, '3440': { width: 3440, height: 1440, deviceScaleFactor: 1, mobile: false }, pc: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } };

function startServe(port){ return spawn('python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, env: { ...process.env, D37_SERVE_QUIET: '1' }, stdio: 'ignore' }); }
const getRaw = (port, p) => new Promise(res => http.get({ host: '127.0.0.1', port, path: p }, r => { r.resume(); res(r.statusCode); }).on('error', () => res(0)));
async function waitPort(port){ for (let i = 0; i < 100; i++) { if (await getRaw(port, '/robots.txt')) return true; await sleep(150); } return false; }
const BLOCK = ['*://*.googleapis.com/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*', '*://*.yandex.ru/*', '*://*.yandex.net/*', '*://yastatic.net/*',
  '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*', '*://localhost:*/_vercel/*', '*://127.0.0.1:*/_vercel/*', 'wss://*.supabase.co/*'];
const realErrors = errs => errs.filter(e => !/Failed to fetch|NetworkError|ERR_BLOCKED|ERR_INTERNET|net::|AbortError|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights|WebSocket connection|realtime/i.test(String(e)));

async function chrome(){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9600 + Math.floor(Math.random() * 300), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
    if (process.env.D37_E2E_CONSOLE && d.method === 'Runtime.consoleAPICalled') console.log('  [консоль ' + d.params.type + ' ' + new Date().toISOString().slice(11, 19) + ']', d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 240));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await ev(expr, 10000); if (v && v !== '__timeout') return true; } catch (e) {} await sleep(200); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Network.setBlockedURLs', { urls: BLOCK });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/*', requestStage: 'Request' }] });
  subs.add(d => {
    if (d.method !== 'Fetch.requestPaused') return;
    const rq = d.params.request, u = rq.url, rid = d.params.requestId;
    const reply = (code, body, type = 'application/json') => send('Fetch.fulfillRequest', { requestId: rid, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: '*' }, { name: 'Content-Range', value: '0-0/0' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
    if (rq.method === 'OPTIONS') return reply(204, '');
    if (rq.method !== 'GET' && rq.method !== 'HEAD') return reply(/\/rpc\//.test(u) ? 200 : 403, /\/rpc\//.test(u) ? 'null' : '{"message":"запись в тесте запрещена"}');
    return reply(200, /\/auth\//.test(u) ? '{}' : '[]');
  });
  const L = { d37_perf: 'mid', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_fsr: 'native', d37_theme: 'dark' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const shot = async name => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await Promise.race([send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }), sleep(45000).then(() => null)]); if (!r) { errs.push('снимок ' + name + ': страница не ответила за 45 с (зависла?)'); console.log('FAIL', 'снимок ' + name + ' — страница не ответила за 45 с'); fail++; return null; } const f = path.join(SHOTS, `s3d-${name}-gl${GL}-${VIEWN}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const key = async (code, down) => { const k = { KeyW: ['w', 87], ShiftLeft: ['Shift', 16], Space: [' ', 32], KeyA: ['a', 65], KeyD: ['d', 68] }[code]; await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k[0], windowsVirtualKeyCode: k[1], nativeVirtualKeyCode: k[1] }); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, key, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && document.readyState === 'complete' && typeof gamesLoadScript === 'function'`;
const ST = `(window.D37E && D37E.studioD37 ? D37E.studioD37.state() : null)`;
const HOOK = `(() => { const E = window.D37E = window.D37E || {}; E.studioExt = E.studioExt || []; if (!E.studioExt.some(x => x.id === 'e2e')) E.studioExt.push({ id: 'e2e', mount(a){ window.__s3 = a; } }); return 1; })()`;
const OUT = `(document.querySelector('.s3-out')?.textContent || '')`;

// студия по адресу: дождаться редактора и проверки движка
async function open(B, hash, tag){
  await B.ev(`D37Route.go(${JSON.stringify(hash)}); 1`);
  const up = await B.until(`!!window.D37E?.studioD37 && !!document.querySelector('.s3 .s3-view canvas')`, 120000);
  ok(up, `${tag}: студия открылась (${hash})`);
  await B.ev(HOOK);
  await B.until(`!!window.__s3?.ed?.SC`, 20000);
  const g = await B.until(`${ST}?.gate !== null && ${ST}?.gate !== undefined`, 120000);
  ok(g, `${tag}: движок проверил мир (ворота)`, await B.ev(ST));
  return B.ev(ST);
}
// «▶ Играть» → на нашем движке, кадры в движении, «■ Стоп»
async function play(B, tag, frames = true){
  await B.ev(`document.querySelector('.s3-play').click(); 1`);
  const on = await B.until(`${ST}?.playing === true && ${ST}?.engine === true && !document.querySelector('.s3d-wait:not([hidden])')`, 180000);
  ok(on, `${tag}: «▶ Играть» — мир играется на НАШЕМ движке`, await B.ev(ST));
  ok(await B.ev(`!window.__s3.ed.playing && document.querySelector('.s3-play').textContent.includes('Стоп')`), `${tag}: старый движок не запускался, кнопка «■ Стоп»`);
  ok(await B.until(`!document.querySelector('.s3x-sheet')`, 3000), `${tag}: листы редактора закрыты (как при игре на старом движке)`);
  await sleep(2500);
  await B.shot(`${tag}-play`);
  if (frames) {
    await B.ev(`document.querySelector('.s3d-stage canvas')?.focus(); 1`);
    await B.key('KeyW', true);
    for (let i = 0; i < 4; i++) { await sleep(300); await B.shot(`${tag}-walk${i}`); }
    await B.key('ShiftLeft', true);
    for (let i = 0; i < 3; i++) { await sleep(300); await B.shot(`${tag}-run${i}`); }
    await B.key('ShiftLeft', false); await B.key('KeyW', false);
    const me = await B.ev(`${ST}?.me`);
    ok(Array.isArray(me) && Math.hypot(me[0], me[2]) > 0.5, `${tag}: персонаж идёт по миру (движок сообщает место)`, me);
  }
  const before = await B.ev(`JSON.stringify(window.__s3.ed.SC.toJSON().objects)`);
  await B.ev(`document.querySelector('.s3-play').click(); 1`);
  ok(await B.until(`${ST}?.playing === false && document.querySelector('.s3-play').textContent.includes('Играть')`, 15000), `${tag}: «■ Стоп» — назад в редактор`);
  ok(await B.ev(`JSON.stringify(window.__s3.ed.SC.toJSON().objects)`) === before, `${tag}: мир в редакторе тот же (игра на движке его не трогает)`);
}

async function run(port){
  const B = await chrome();
  try {
    await B.send('Emulation.setDeviceMetricsOverride', VIEW[VIEWN] || VIEW.pc);
    if (VIEWN === 'phone') { await B.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    await B.send('Page.navigate', { url: `http://localhost:${port}/?gl=${GL}` });
    ok(await B.until(READY, 90000), 'сайт загрузился');
    ok(await B.ev(`typeof STUDIO_D37 !== 'undefined' && STUDIO_D37 === true`), 'флаг STUDIO_D37 включён');

    if (want('lesson')) {
      // первый раз в студии: урок открывается сам, мир — «Площадка»
      const s = await open(B, '#/games/studio3d', 'урок');
      ok(await B.until(`!!document.querySelector('.s3x-tut')`, 8000), 'урок: «Первый мир за 5 минут» на месте');
      await B.shot('lesson-editor');
      ok(s?.gate?.fits === true, 'урок: мир урока проходит ворота (движку хватает всего)', s?.gate);
      ok(await B.ev(`document.querySelector('.s3d-eng')?.textContent.includes('Наш движок')`), 'урок: ярлык «⚡ Наш движок»');
      await B.ev(`document.querySelector('.s3x-tut [data-l="close"]')?.click(); 1`);
      await B.ev(`document.querySelector('.s3d-side').click(); 1`);
      ok(await B.until(`${ST}?.engine === true && !document.querySelector('.s3d-wait:not([hidden])')`, 180000), 'урок: «🪟 Рядом» — наш движок справа');
      await sleep(4000);
      await B.shot('lesson-side');
      await B.ev(`document.querySelector('.s3d-side').click(); 1`);
      await play(B, 'lesson');
    }
    for (const [k, tpl] of [['empty', 'empty'], ['obby', 'obby'], ['grass', 'grass']]) {
      if (!want(k) && !(k === 'grass' && want('empty'))) continue;
      const s = await open(B, '#/games/studio3d/new/' + tpl, 'шаблон ' + tpl);
      ok(s?.gate?.fits === true, `шаблон ${tpl}: проходит ворота`, s?.gate?.missing);
      await play(B, 'tpl-' + tpl, tpl !== 'grass');
      if (tpl === 'obby') ok((await B.ev(OUT)).includes('Скрипты запущены (наш движок)'), 'обби: скрипты (JavaScript) запущены на нашем движке', (await B.ev(OUT)).slice(-400));
    }
    if (want('gate')) {
      const s = await open(B, '#/games/studio3d/new/island', 'ворота «Остров»');
      ok(s?.gate?.fits === false && (s.gate.missing || []).includes('terrain.relief'), 'ворота: «Остров» (холмы, вода) — пока на старом движке, причина названа', s?.gate);
      ok(await B.ev(`document.querySelector('.s3d-eng')?.textContent.includes('Старый движок')`), 'ворота: ярлык «🧱 Старый движок»');
      await B.ev(`document.querySelector('.s3d-eng').click(); 1`);
      await sleep(400);
      ok(await B.ev(`/холмы/.test(document.querySelector('.s3d-sheet')?.textContent || '')`), 'ворота: окно говорит по-русски, чего не хватает');
      await B.shot('gate-island');
      await B.ev(`document.querySelector('.s3d-sheet .s3d-x')?.click(); document.querySelector('.s3-play').click(); 1`);
      ok(await B.until(`!!window.__s3.ed.playing && !${ST}?.playing`, 20000), 'ворота: «▶ Играть» — на старом движке, как раньше');
      await sleep(1500); await B.shot('gate-island-r0');
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      await sleep(800);
      const blank = await B.ev(`Object.keys(window.D37E.studioTemplates || {})[0] || ''`);
      if (blank) {
        const s2 = await open(B, '#/games/studio3d/new/' + blank, 'заготовка режима ' + blank);
        ok(s2?.gate?.fits === false && (s2.gate.missing || []).some(m => m.startsWith('game.')), `ворота: заготовка режима «${blank}» — на старом движке (режимы игры — следующий этап)`, s2?.gate?.missing);
      }
    }
    if (want('s8')) {
      // S8: незакреплённые детали (падают), огонь, зомби (догоняет и кусает) — на нашем движке
      await open(B, '#/games/studio3d/new/empty', 'S8 физика, огонь, зомби');
      await B.ev(`(() => { const a = window.__s3, SC = a.ed.SC;
        for (let i = 0; i < 4; i++) SC.add('Part', { name: 'Ящик ' + (i + 1), pos: [3 + (i % 2) * 0.4, 3 + i * 2.2, 6], size: [2, 2, 2], color: '#c08040', mat: 'wood', anchored: false });
        SC.add('Part', { name: 'Шар', shape: 'ball', pos: [-3, 6, 6], size: [2, 2, 2], color: '#e11d48', anchored: false });
        SC.add('Effect', { name: 'Огонь', kind: 'fire', pos: [0, 1, 9] });
        SC.add('NPC', { name: 'Зомби', look: 'zombie', act: 'follow', damage: 20, speed: .75, radius: 30, pos: [0, 0.2, 14], text: 'Ммм… мозги…' });
        a.refresh(); return SC.all().length; })()`);
      await B.until(`(${ST}?.gate?.needs || []).includes('npc.follow')`, 8000);
      const g = (await B.ev(ST))?.gate;
      ok(g?.fits === true && ['part.loose', 'fx.fire', 'npc.follow'].every(n => g.needs.includes(n)), 'S8: мир с падающими деталями, огнём и зомби проходит ворота', g);
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      ok(await B.until(`${ST}?.playing === true && ${ST}?.engine === true && !document.querySelector('.s3d-wait:not([hidden])')`, 180000), 'S8: играем на нашем движке');
      for (let i = 0; i < 6; i++) { await sleep(600); await B.shot(`s8-${i}`); }
      const hp0 = (await B.ev(ST))?.hp;
      // стоим и ждём зомби (он догоняет и кусает)
      let bitten = false;
      for (let i = 0; i < 40 && !bitten; i++) { await sleep(500); const h = (await B.ev(ST))?.hp; bitten = typeof h === 'number' && typeof hp0 === 'number' && h < hp0; }
      await B.shot('s8-bite');
      ok(bitten, 'S8: зомби догнал и укусил (здоровье упало — сообщает движок)', { hp0, hp: (await B.ev(ST))?.hp });
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      ok(await B.until(`${ST}?.playing === false`, 15000), 'S8: «■ Стоп» — назад в редактор');
      await sleep(600);
      // тот же адрес new/empty дальше открывает тот же мир — убрать своё
      await B.ev(`(() => { const a = window.__s3, SC = a.ed.SC; for (const o of SC.all().filter(x => x.name.startsWith('Ящик ') || ['Шар', 'Огонь', 'Зомби'].includes(x.name))) SC.remove(o); a.refresh(); return SC.all().length; })()`);
      await sleep(400);
    }
    if (want('langs')) {
      await open(B, '#/games/studio3d/new/empty', 'шесть языков');
      const L = await B.ev(`(() => { const E = window.D37E; return Object.keys(E.langs || {}); })()`);
      ok(['js', 'lua', 'cs', 'java', 'cpp', 'rust'].every(x => L.includes(x)), 'шесть языков подключены в студии', L);
      // мир: дверь (JS), счётчик (Lua), платформа (C#), привет (Java), монетка (Rust), крутилка (C++)
      const W = `(() => { const a = window.__s3, SC = a.ed.SC;
        const P = (name, p) => SC.add('Part', Object.assign({ name }, p));
        const S = (par, name, lang, code) => SC.add('Script', { name, lang, code }, par);
        const door = P('Дверь', { pos: [0, 2, 8], size: [4, 4, 0.6], color: '#a05a2c', mat: 'wood' });
        S(door, 'JS дверь', 'js', "const d = script.Parent; let open = false;\\nd.Touched.Connect(() => { if (open) return; open = true; const t = TweenService.Create(d, { Time: 0.6 }, { Position: d.Position.add(new Vector3(0, 4, 0)) }); t.Completed.Connect(() => print('JS: дверь открылась на движке')); t.Play(); });");
        const sign = P('Табло', { pos: [-6, 1, -2], size: [2, 2, 0.4], color: '#2563eb' });
        S(sign, 'Lua счётчик', 'lua', "local n = 0\\nwhile n < 5 do\\n  n = n + 1\\n  gui.text('lua', 'Lua: ' .. n)\\n  print('Lua: ' .. n)\\n  task.wait(0.5)\\nend");
        const plat = P('Платформа', { pos: [6, 1, -2], size: [3, 0.6, 3], color: '#16a34a', mat: 'smooth' });
        S(plat, 'C# платформа', 'cs', "var p = script.Parent;\\nvar t = TweenService.Create(p, new TweenInfo(1.2), new { Position = p.Position + new Vector3(0, 3, 0) });\\nt.Completed.Connect(() => print(\\"C#: платформа доехала\\"));\\nt.Play();");
        S(null, 'Java привет', 'java', "Players.PlayerAdded.Connect(player -> { player.Message(\\"Java: привет на нашем движке!\\", 4); print(\\"Java: привет\\"); });");
        const coin = P('Монетка', { shape: 'cyl', pos: [0, 1, 3], rot: [0, 0, 90], size: [0.3, 1.2, 1.2], color: '#f5cd30', mat: 'metal', collide: false });
        S(coin, 'Rust монетка', 'rust', '');
        const spin = P('Крутилка', { pos: [-6, 1, 4], size: [3, 0.5, 0.5], color: '#e11d48' });
        S(spin, 'C++ крутилка', 'cpp', '');
        a.refresh(); return SC.all().length; })()`;
      ok(await B.ev(W) > 8, 'мир с шестью скриптами собран');
      // C++ и Rust — кнопкой сайта: компиляторы с CDN (как у человека), результат — в код скрипта
      for (const [lang, file, add] of [['rust', 'coin.rs', 'print("Rust: монетка взята");'], ['cpp', 'spinner.cpp', 'print("C++: кручусь");']]) {
        const src = fs.readFileSync(path.join(SITE, 'sdk/examples', file), 'utf8').replace(lang === 'rust' ? 'coin.destroy();' : 'part = script_parent();', lang === 'rust' ? 'coin.destroy(); ' + add : 'part = script_parent(); ' + add);
        const r = await B.ev(`(async () => { const E = window.D37E, o = window.__s3.ed.SC.all().find(x => x.cls === 'Script' && x.lang === ${JSON.stringify(lang)});
          try { const out = await E.langs[${JSON.stringify(lang)}].compile(${JSON.stringify(src)}, { name: o.name, onStep: () => {} }); const w = out instanceof Uint8Array ? out : out.wasm; let s = ''; for (let i = 0; i < w.length; i += 0x8000) s += String.fromCharCode.apply(null, w.subarray(i, i + 0x8000));
            window.__s3.ed.SC.set(o, 'src', ${JSON.stringify(src)}, true); window.__s3.ed.SC.set(o, 'code', btoa(s), true); return 'ok ' + w.length; } catch (e) { return 'err ' + String(e && (e.log || e.message) || e).slice(0, 300); } })()`, 600000);
        ok(/^ok \d+/.test(r), `${lang}: собран кнопкой сайта`, r);
      }
      const s = await B.ev(`(async () => { await new Promise(r => setTimeout(r, 400)); return ${ST}; })()`);
      await B.until(`${ST}?.gate?.needs?.includes('script.rust')`, 8000);
      const g = (await B.ev(ST))?.gate;
      ok(g?.fits === true && ['script.js', 'script.lua', 'script.cs', 'script.java', 'script.cpp', 'script.rust'].every(n => g.needs.includes(n)), 'шесть языков: мир проходит ворота', g);
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      ok(await B.until(`${ST}?.playing === true && ${ST}?.engine === true`, 180000), 'шесть языков: играем на нашем движке');
      await sleep(3500);
      await B.shot('langs-play');
      // к двери (касание → твин на движке → Completed в скрипте) и через монетку
      await B.ev(`document.querySelector('.s3d-stage canvas')?.focus(); 1`);
      await B.key('KeyW', true);
      for (let i = 0; i < 10; i++) { await sleep(350); await B.shot(`langs-walk${i}`); }   // персонаж «Студии» на движке ходит медленнее старого (2.2 м/с против 4) — дальше идти
      await B.key('KeyW', false);
      await sleep(1500);
      const out = await B.ev(OUT), st = await B.ev(ST);
      await B.shot('langs-after');
      for (const [lang, mark] of [['JavaScript', 'JS: дверь открылась на движке'], ['Lua', 'Lua: 3'], ['C#', 'C#: платформа доехала'], ['Java', 'Java: привет'], ['C++', 'C++: кручусь']]) ok(out.includes(mark), `шесть языков: ${lang} работает на нашем движке («${mark}»)`, out.slice(-600));
      ok(out.includes('Rust: монетка взята') || (st?.stats && st.stats['Монеты'] >= 1), 'шесть языков: Rust — монетка (касание на движке → скрипт)', { stats: st?.stats, out: out.slice(-300) });
      ok(/Lua: \d/.test(JSON.stringify(st?.labels || {})), 'шесть языков: надпись Lua на экране', st?.labels);
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      await sleep(800);
      // зависший скрипт: убит за 3 с и на нашем движке
      await B.ev(`(() => { const a = window.__s3, SC = a.ed.SC; for (const o of SC.all().filter(x => x.cls === 'Script')) SC.remove(o); SC.add('Script', { name: 'Зависалка', lang: 'js', code: 'while (true) {}' }); a.refresh(); return 1; })()`);
      await sleep(600);
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      ok(await B.until(`/завис/.test(${OUT})`, 15000), 'зависший скрипт остановлен (3000 мс) — и на нашем движке', (await B.ev(OUT)).slice(-300));
      ok(await B.ev(`${ST}?.playing === true`), 'игра на движке живёт после убитого скрипта');
      await B.ev(`document.querySelector('.s3-play').click(); 1`);
      await sleep(600);
    }
    if (want('old')) {
      // мир, сохранённый ДО этого изменения (старый формат), открывается тем же после игры на движке
      const old = { v: 1, objects: [{ id: 'o1', cls: 'Part', parent: null, name: 'Старая деталь', shape: 'block', pos: [0, 0.5, 0], rot: [0, 0, 0], size: [8, 1, 8], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true },
        { id: 'o2', cls: 'Spawn', parent: null, name: 'Точка появления', shape: 'block', pos: [0, 1.2, 0], rot: [0, 0, 0], size: [6, 0.4, 6], color: '#5b6b82', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true }],
        lighting: { time: 10, brightness: 1, ambient: 1, fogEnd: 360, shadows: true, cycle: 0 }, terrain: { size: 192, n: 129, flat: true, enabled: false, water: false }, name: 'Старый мир' };
      await B.ev(`(() => { localStorage.setItem('d37_s3_oldw1', ${JSON.stringify(JSON.stringify(old))}); const ix = JSON.parse(localStorage.getItem('d37_s3_index') || '[]'); ix.unshift({ id: 'oldw1', name: 'Старый мир', t: Date.now(), n: 2 }); localStorage.setItem('d37_s3_index', JSON.stringify(ix)); return 1; })()`);
      await open(B, '#/games/studio3d/open/oldw1', 'старый мир');
      const a = await B.ev(`JSON.stringify(window.__s3.ed.SC.toJSON().objects)`);
      await play(B, 'old', false);
      await B.ev(`window.__s3.core.save(true); 1`);
      await sleep(600);
      const b = await B.ev(`JSON.stringify(JSON.parse(localStorage.getItem('d37_s3_oldw1')).objects)`);
      ok(a === b, 'старый мир: после игры на движке и сохранения — те же объекты', { a: a.slice(0, 200), b: b.slice(0, 200) });
    }
    const errs = realErrors(B.errs);
    ok(errs.length === 0, 'ошибок в консоли нет', errs.slice(0, 6));
  } finally { await B.close(); }
}

(async () => {
  const port = 8700 + Math.floor(Math.random() * 200);
  const srv = startServe(port);
  try {
    if (!await waitPort(port)) throw new Error('serve.py не поднялся');
    await run(port);
  } catch (e) { fail++; console.log('FAIL', 'прогон', String(e && e.stack || e).slice(0, 600)); }
  finally { srv.kill(); }
  console.log(`\nstudio-d37-e2e gl${GL} ${VIEWN}: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

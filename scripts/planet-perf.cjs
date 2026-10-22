// Замер планеты движка (T-051, docs/plans/planet.md §12) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm), профиль
// телефона: экран 412 × 915 × 2, ЦП замедлен в N раз (×4 — как слабый телефон), качество «средняя».
// Режимы:  node scripts/planet-perf.cjs [perf]            — орбита, спуск с орбиты до земли (40 с), посадка и бег по земле: ЦП мс на кадр
//                                                          (среднее, 95 %, худший), рывки > 50 мс, вызовы отрисовки, куски, сборка в потоке
//                                                          и на странице, выбор кусков, память JS и данных кусков; снимки
//          node scripts/planet-perf.cjs soak [минут=10]    — долгий полёт: орбита ↔ земля по кругу, перелёты по планете, ходьба;
//                                                          ошибки и рост памяти по минутам
//          node scripts/planet-perf.cjs reopen [раз=20]    — открыть/закрыть страницу планеты N раз: холсты, потоки, память
//          node scripts/planet-perf.cjs map [раз=20]       — T-079: карта «🪐 Система» и телескоп N раз: узлы, слушатели, память
//          node scripts/planet-perf.cjs golden             — T-079: «золотые» значения O.m / рельсов / неба в Chrome = в node (до бита)
// Переменные: RATE (замедление ЦП, 4), Q (качество, mid), PC=1 — компьютер 1280 × 720 без замедления, CHROME, D37_TMP (временное — на E:).
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
// SITE_DIR — другая копия сайта (замер «до» на старых файлах тем же скриптом), D37_OUT — папка отчётов и снимков (в D37_TMP),
// V2=1 / V2=0 — флаги T-075 вкл / выкл (localStorage d37_planet_v2: LOD v2, перетекание, два диапазона глубины, тени, дымка, погода;
// без V2 — по умолчанию), PF='{"weather":false}' — отдельные флаги поверх (localStorage d37_planet_flags)
const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, '..');
const [MODE = 'perf', ARG = ''] = process.argv.slice(2);
const PC = !!process.env.PC, RATE = PC ? 1 : +(process.env.RATE || 4), Q = process.env.Q || (PC ? 'high' : 'mid');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, process.env.D37_OUT || 't075');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
// в странице: замер кадров (после кадра игры — свой requestAnimationFrame)
const SAMPLER = `(() => {
  if (window.__plS) return;
  const S = window.__plS = { on: false, f: [] };
  const tick = t => { requestAnimationFrame(tick); if (!S.on) return; const T = window.GAME_IMPL?.planet?._test?.S; if (!T?.R) return;
    const st = T.R.stats, v = T.V.stats ? T.V : null;
    S.f.push([t, st.cpuFrame || 0, st.calls || 0, st.tris || 0, v ? v.cpu || 0 : 0, T.SV ? T.SV.cpu || 0 : 0]); };
  requestAnimationFrame(tick);
})()`;
const summary = f => {
  if (f.length < 3) return { frames: f.length };
  const dts = []; for (let i = 1; i < f.length; i++) dts.push(f[i][0] - f[i - 1][0]);
  const cpu = f.map(x => x[1]).sort((a, b) => a - b), calls = f.map(x => x[2]), tris = f.map(x => x[3]), pv = f.map(x => x[4]).sort((a, b) => a - b), sky = f.map(x => x[5] || 0).sort((a, b) => a - b);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length, p = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { frames: f.length, fps: +(1000 / avg(dts)).toFixed(1), long50: dts.filter(d => d > 50).length, worstDt: +Math.max(...dts).toFixed(0),
    cpuAvg: +avg(cpu).toFixed(2), cpuP95: +p(cpu, .95).toFixed(2), cpuMax: +cpu[cpu.length - 1].toFixed(1),
    planetAvg: +avg(pv).toFixed(3), planetP95: +p(pv, .95).toFixed(3), planetMax: +pv[pv.length - 1].toFixed(2),
    callsAvg: Math.round(avg(calls)), callsMax: Math.max(...calls), trisAvg: Math.round(avg(tris)),
    skyAvg: +avg(sky).toFixed(3), skyP95: +p(sky, .95).toFixed(3), skyMax: +sky[sky.length - 1].toFixed(2) };
};
(async () => {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-planet-perf-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 }); fs.writeFileSync(path.join(OUT, 'shots', name + '.jpg'), Buffer.from(data, 'base64')); };
  const T = 'GAME_IMPL.planet._test';
  // сколько живых объектов three (рендереры, геометрии, материалы, буферы кадра, текстуры) — Runtime.queryObjects; ручки отпускаем
  const countObjs = async () => {
    const o = {};
    for (const [k, proto] of [['renderers', 'THREE.WebGLRenderer.prototype'], ['geometries', 'THREE.BufferGeometry.prototype'], ['materials', 'THREE.Material.prototype'], ['targets', 'THREE.WebGLRenderTarget.prototype'], ['textures', 'THREE.Texture.prototype']]) {
      try {
        const p = await send('Runtime.evaluate', { expression: proto, objectGroup: 'cnt' });
        const q = await send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId, objectGroup: 'cnt' });
        const n = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){ return this.length; }', returnByValue: true });
        o[k] = n.result.value;
      } catch (e) { o[k] = null; }
      await send('Runtime.releaseObjectGroup', { objectGroup: 'cnt' });
    }
    return o;
  };
  // страж графики после сессии на планете: ничего не выключено ни навсегда (localStorage), ни на сессию
  const guard = () => ev(`(() => { const R = window.GAME_IMPL?.planet?._test?.S?.R; let st = null; try { st = localStorage.getItem('d37_gfx_guard'); } catch (e) {} return { stored: st, off: window.D37E?.gfxGuardInfo?.().off || [], vol: R && R.guard ? Object.keys(R.guard.vol || {}) : [], log: R && R.guard ? R.guard.log.slice(-8) : [], tests: R && R.guard ? R.guard.tests : null }; })()`);
  const stats = async () => ev(`(() => { const s = ${T}.stats(), st = ${T}.state(); return { ...s, mode: st.mode, heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()`);
  const measure = async (ms, during) => {
    await ev(`(window.__plS.f = [], window.__plS.on = true)`);
    if (during) await during(); else await sleep(ms);
    const f = await ev(`(() => { window.__plS.on = false; const f = window.__plS.f; window.__plS.f = []; return f; })()`);
    return summary(f);
  };
  const out = { mode: MODE, rate: RATE, q: Q, pc: PC, when: new Date().toISOString() };
  let failed = false;
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Target.setDiscoverTargets', { discover: true });
    if (PC) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    else {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q };
    if (process.env.V2 === '1' || process.env.V2 === '0') ls.d37_planet_v2 = process.env.V2;
    if (process.env.PF) ls.d37_planet_flags = process.env.PF;   // отдельные флаги поверх: PF='{"weather":false}'
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    const open = async () => {
      await send('Page.navigate', { url: BASE + '/#/games/planet' });
      let ok = false; for (let i = 0; i < 160 && !ok; i++) { await sleep(500); try { ok = await ev(`!!(window.GAME_IMPL?.planet?._test?.S?.V)`, 5000); } catch (e) {} }
      if (!ok) throw new Error('страница планеты не открылась');
      await ev(SAMPLER);
    };
    const workers = async () => { const t = await send('Target.getTargets'); return t.targetInfos.filter(x => x.type === 'worker' || x.type === 'dedicated_worker').length; };
    if (MODE === 'perf') {
      await open();
      await send('Emulation.setCPUThrottlingRate', { rate: RATE });
      await sleep(3000);
      out.orbit = { ...(await measure(5000)), ...(await stats()) }; await shot((PC ? 'pc' : 'phone') + '-1-orbit');
      // T-079: Луна в телескоп (одна картинка — всё небо системы), карта системы (холст, ~30 кадров/с)
      if (await ev(`!!${T}.sky`)) {
        await ev(`${T}.look('luna')`); await sleep(1200);
        out.moon = await measure(3000); await shot((PC ? 'pc' : 'phone') + '-1b-moon');
        await ev(`${T}.untele()`);
        await ev(`(${T}.S.map.stats = { n: 0, ms: 0, max: 0 }, ${T}.map(true))`); await sleep(4000);
        out.map = await ev(`(() => { const m = ${T}.S.map.stats; return { frames: m.n, drawAvg: +(m.ms / Math.max(1, m.n)).toFixed(3), drawMax: +m.max.toFixed(2) }; })()`);
        await shot((PC ? 'pc' : 'phone') + '-1c-map');
        await ev(`${T}.map(false)`); await sleep(500);
      }
      // спуск с орбиты до земли (сам), 40 с
      out.descent = await measure(0, async () => { await ev(`${T}.descend(40)`); for (let k = 0; k < 44; k++) { await sleep(1000); if (k === 14) await shot((PC ? 'pc' : 'phone') + '-2-descent'); const st = await ev(`${T}.state()`); if (!st.fly.auto && k > 5) break; } });
      out.descentEnd = await stats();
      await shot((PC ? 'pc' : 'phone') + '-3-low');
      await ev(`${T}.goto(29, 81, 30)`); await sleep(1500); await ev(`${T}.land()`); await sleep(2500);
      out.ground = { ...(await measure(6000)), ...(await stats()) }; await shot((PC ? 'pc' : 'phone') + '-4-ground');
      out.run = await measure(0, async () => { await ev(`${T}.move(0.4, 1, true)`); await sleep(20000); await ev(`${T}.move(0, 0, false)`); });
      out.runEnd = { ...(await stats()), state: await ev(`${T}.state()`) }; await shot((PC ? 'pc' : 'phone') + '-5-run');
      // свежий спуск в другом месте (новые куски): чем загружен кадр, пока строится
      await ev(`${T}.fly()`); await ev(`${T}.goto(-12, -40, 90000)`); await sleep(2000);
      out.flyover = await measure(0, async () => { await ev(`${T}.descend(30)`); await sleep(30000); });
      out.flyoverEnd = await stats();
      out.workers = await workers();
      out.guard = await guard();
    } else if (MODE === 'soak') {
      const mins = +ARG || 10;
      await open();
      await send('Emulation.setCPUThrottlingRate', { rate: RATE });
      out.minutes = [];
      const t0 = Date.now(), places = [[29, 81], [-12, -40], [55, 10], [5, 140], [-35, 70], [40, -100], [70, 30], [-60, -150]];
      let k = 0;
      while (Date.now() - t0 < mins * 60000) {
        const pl = places[k++ % places.length];
        await ev(`${T}.fly()`); await ev(`${T}.goto(${pl[0]}, ${pl[1]}, 120000)`); await sleep(1500);
        await ev(`${T}.descend(25)`); await sleep(26000);
        await ev(`${T}.goto(${pl[0]}, ${pl[1]}, 25)`); await sleep(1200); await ev(`${T}.land()`);
        await ev(`${T}.move(${(k % 3) - 1}, 1, true)`); await sleep(15000); await ev(`${T}.move(0, 0, false)`);
        await ev(`${T}.time(null, ${k % 2 ? 300 : 1})`);
        await ev(`${T}.orbit()`); await sleep(3000);
        await ev('window.gc && window.gc()');
        const s = await stats(), ob = await countObjs();
        out.minutes.push({ t: +((Date.now() - t0) / 60000).toFixed(1), heap: s.heap, cached: s.cached, nodes: s.nodes, gpuKB: s.gpuKB, errors: s.errors, built: s.built, rebases: s.rebases, logs: logs.length,
          geo: ob.geometries, mat: ob.materials, tex: ob.textures, rnd: ob.renderers, workers: s.workers });
        console.log('  ', JSON.stringify(out.minutes[out.minutes.length - 1]));
      }
      out.workers = await workers();
      out.guard = await guard(); console.log('страж:', JSON.stringify(out.guard));
    } else if (MODE === 'golden') {
      // одинаковость до бита: то же число в node и в Chrome
      const node = (() => { for (const f of ['climate', 'planet', 'orbit', 'system']) require(path.join(SITE, 'js/engine', f + '.js')); return globalThis.D37E.orbitGolden(); })();
      await open();
      const chrome = await ev(`window.D37E.orbitGolden()`);
      out.golden = { node, chrome, same: node.hash === chrome.hash };
      console.log(out.golden.same ? 'ЗОЛОТЫЕ СОВПАЛИ' : 'ЗОЛОТЫЕ РАЗНЫЕ', JSON.stringify(out.golden));
      if (!out.golden.same) failed = true;
    } else if (MODE === 'map') {
      const n = +ARG || 20;
      await open(); await sleep(3000);
      const probe = async () => ev(`(() => { const c = document.getElementsByTagName('*').length; return { nodes: c, sm: document.querySelectorAll('.sm').length, canvases: document.querySelectorAll('canvas').length, heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; })()`);
      const lis = async () => { const r = await send('Runtime.evaluate', { expression: 'getEventListeners(window).keydown ? getEventListeners(window).keydown.length : 0', includeCommandLineAPI: true, returnByValue: true }); return r.result.value; };
      await ev('window.gc && window.gc()');
      out.base = { ...(await probe()), keydown: await lis() };
      out.cycles = [];
      for (let i = 0; i < n; i++) {
        await ev(`${T}.map(true)`); await sleep(350);
        await ev(`${T}.S.map._focus(['sun', 'home', 'desert'][${i} % 3], true)`); await sleep(250);
        await ev(`${T}.map(false)`);
        await ev(`${T}.look(['luna', 'desert'][${i} % 2])`); await sleep(250); await ev(`${T}.untele()`);
        if (i % 5 === 4) { await ev('window.gc && window.gc()'); await sleep(300); out.cycles.push({ i: i + 1, ...(await probe()), keydown: await lis() }); console.log('  ', JSON.stringify(out.cycles[out.cycles.length - 1])); }
      }
    } else if (MODE === 'reopen') {
      const n = +ARG || 20;
      await open(); await sleep(4000);
      await ev('window.gc && window.gc()');
      const base = await ev(`({ heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), canvases: document.querySelectorAll('canvas').length })`);
      base.workers = await workers(); Object.assign(base, await countObjs());
      out.base = base; out.cycles = []; console.log('  база', JSON.stringify(base));
      for (let i = 0; i < n; i++) {
        await send('Page.navigate', { url: BASE + '/#/games' }); await sleep(800);
        await ev(`location.hash = '#/games/planet'`);
        let ok = false; for (let q = 0; q < 60 && !ok; q++) { await sleep(400); try { ok = await ev(`!!(window.GAME_IMPL?.planet?._test?.S?.V)`, 5000); } catch (e) {} }
        await ev(`${T}.goto(29, 81, 30)`); await sleep(1500); await ev(`${T}.land()`); await sleep(1500);
        await ev(`location.hash = '#/games'`); await sleep(700);
        if (i % 5 === 4) { await ev('window.gc && window.gc()'); await sleep(300); out.cycles.push({ i: i + 1, heap: await ev(`+(performance.memory.usedJSHeapSize / 1048576).toFixed(1)`), canvases: await ev(`document.querySelectorAll('canvas').length`), workers: await workers(), ...(await countObjs()) }); console.log('  ', JSON.stringify(out.cycles[out.cycles.length - 1])); }
      }
      out.guard = await guard();
    }
  } catch (e) { failed = true; console.log('ОШИБКА', e.message); out.error = e.message; }
  out.logs = logs.slice(0, 40);
  const file = path.join(OUT, `perf-${MODE}-${PC ? 'pc' : 'phone'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
  console.log('записано:', file, '· ошибок в журнале:', logs.filter(l => !/X3595/.test(l)).length);
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 800);
})();

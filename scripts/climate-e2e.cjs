// Погода и праздники в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): «Студия 3D» и «Кубомир» — до/после (снег зимой,
// дождь, осень), все программы шейдеров собрались, страж графики ничего не выключил, замер (ЦП мс на кадр и вызовы отрисовки:
// погода выкл / вкл), салют и новогоднее задание поверх страницы. Снимки — <папка временных файлов>/climate/shots.
// Запуск из корня сайта: node scripts/climate-e2e.cjs [d3d11|swiftshader|gl|vulkan] [high|mid|low]
// (Chrome — переменная CHROME или стандартный путь Windows; временная папка — D37_TMP, иначе E:\claude-tmp, иначе системная)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [angle = 'd3d11', preset = 'high'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, 'climate', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-climate-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), subs = new Set(), logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
  });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: null } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); const f = path.join(SHOTS, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
  // замер в странице: n кадров — среднее ЦП кадра (R.stats.cpu: от R.render до конца) и вызовов отрисовки
  const MEASURE = `async (R, n = 150) => { let c = 0, calls = 0, k = 0, t0 = performance.now(); const st = R.stats; await new Promise(res => { const f = () => { c += st.cpu; calls += st.calls; if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); return { cpu: +(c / k).toFixed(2), calls: Math.round(calls / k), fps: +(k / ((performance.now() - t0) / 1000)).toFixed(1) }; }`;
  const progsOk = `R => { const L = R.r.info.programs || []; return { n: L.length, bad: L.filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || '').slice(0, 200)),
    warn: L.filter(p => p.diagnostics && ((p.diagnostics.fragmentShader.log || '') + (p.diagnostics.vertexShader.log || '') + (p.diagnostics.programLog || '')).trim()).map(p => p.name + ' [' + p.cacheKey.slice(0, 60) + ']: ' + ((p.diagnostics.programLog || '') + (p.diagnostics.fragmentShader.log || '')).slice(0, 160)) }; }`;
  const res = {};
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const base = preset === 'ultra' ? 'high' : preset;
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: base, d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base, shaders: 'normal' }), d37_s3_learn: '1' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });

    // ═══ 1. «Студия 3D»: до (погода выкл) и после (зима со снегом, дождь летом, осень) ═══
    await send('Page.navigate', { url: BASE + '/#/games/studio3d' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.studio3d?._test?.state()?.R && window.D37E?.studioWeather)`, 5000); } catch (e) {} }
    ok(up, 'студия открылась, погода подключена');
    if (!up) throw new Error('студия не открылась');
    const studio = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ED = GAME_IMPL.studio3d._test.state(), R = ED.R, M = ${MEASURE}, P = ${progsOk};
      GAME_IMPL.studio3d._test.template(ED.SC, ED.TR, 'camp');
      ED.cam = { x: 16, y: 9, z: 18, yaw: .75, pitch: .32 };
      R.setLighting({ time: 13 });
      const set = w => { ED.SC.settings.weather = w; D37E.studioWeather.play.settings(); };
      const out = {};
      set({ mode: 'off' }); await wait(2500);
      out.off = await M(R);
      document.querySelector('.s3')?.classList.add('s3-shot');
      return out;
    })()`, 120000);
    res.studioOff = studio.off;
    await shot('studio-before-off');
    const studio2 = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ED = GAME_IMPL.studio3d._test.state(), R = ED.R, M = ${MEASURE}, P = ${progsOk}, X = D37E.studioWeather.X();
      const set = w => { ED.SC.settings.weather = w; D37E.studioWeather.play.settings(); };
      const out = {};
      set({ mode: 'fixed', season: 'winter', weather: 'snow', seed: 'e2e' }); await wait(14000);
      out.winter = await M(R); out.winterSt = X.stats(); out.progs = P(R);
      return out;
    })()`, 120000);
    Object.assign(res, { studioWinter: studio2.winter, studioWinterSt: studio2.winterSt, studioProgs: studio2.progs });
    await shot('studio-after-winter-snow');
    const studio3 = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ED = GAME_IMPL.studio3d._test.state(), R = ED.R, M = ${MEASURE}, X = D37E.studioWeather.X();
      const set = w => { ED.SC.settings.weather = w; D37E.studioWeather.play.settings(); };
      set({ mode: 'fixed', season: 'summer', weather: 'rain', seed: 'e2e' }); await wait(14000);
      return { rain: await M(R), rainSt: X.stats() };
    })()`, 120000);
    Object.assign(res, { studioRain: studio3.rain, studioRainSt: studio3.rainSt });
    await shot('studio-after-summer-rain');
    const studio4 = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const ED = GAME_IMPL.studio3d._test.state(), X = D37E.studioWeather.X();
      const set = w => { ED.SC.settings.weather = w; D37E.studioWeather.play.settings(); };
      set({ mode: 'fixed', season: 'autumn', weather: 'clear', seed: 'e2e' }); await wait(12000);
      return { st: X.stats(), autumn: +X.vis.autumn.toFixed(2), guard: D37E.gfxGuardInfo().off, shaders: D37E.climShaders };
    })()`, 120000);
    res.studioAutumn = studio4;
    await shot('studio-after-autumn');
    ok(!res.studioProgs.bad.length, 'студия: все программы шейдеров собрались (с погодой)', res.studioProgs);
    if (res.studioProgs.warn.length) console.log('  предупреждения компилятора (студия):', JSON.stringify(res.studioProgs.warn).slice(0, 900));
    ok(studio4.shaders && !studio4.guard.length, 'студия: кусок погоды в шейдерах, страж ничего не выключил', studio4);
    ok(res.studioWinterSt.cover > .5 && res.studioWinterSt.flakes > 50 && res.studioWinterSt.occ > 0, 'студия зимой: снег лежит, хлопья вокруг, карта «что над головой» нарисована', res.studioWinterSt);
    ok(res.studioRainSt.drops > 50 && res.studioRainSt.wet > .3, 'студия летом в дождь: капли, мокро', res.studioRainSt);
    ok(studio4.autumn > .5, 'студия осенью: листва желтеет', studio4.autumn);

    // ═══ 2. «Кубомир»: снег на блоках зимой ═══
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(500);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 'зима37'; const c = document.querySelector('[data-f="mode"] [data-v="creative"]'); c && c.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.WX && GAME_IMPL.kubomir._test.state().R)`, 3000).catch(() => false); }
    ok(kb, '«Кубомир»: мир открылся');
    if (kb) {
      await sleep(6000);
      const k1 = await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), R = S.R, M = ${MEASURE};
        S.R.lighting.time = 12; GAME_IMPL.kubomir._test.hud?.(false);
        S.WX.clim.setWorld({ seed: 'kb', mode: 'off' }); await wait(9000);
        return { off: await M(R) };
      })()`, 90000);
      res.kubomirOff = k1.off;
      await shot('kubomir-before-off');
      const k2 = await ev(`(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const S = GAME_IMPL.kubomir._test.state(), R = S.R, M = ${MEASURE}, P = ${progsOk};
        S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'winter', weather: 'snow', lapse: -.12, seaY: 52 }); await wait(14000);
        return { on: await M(R), st: S.WX.stats(), progs: P(R), guard: D37E.gfxGuardInfo().off };
      })()`, 90000);
      Object.assign(res, { kubomirWinter: k2.on, kubomirSt: k2.st });
      await shot('kubomir-after-winter-snow');
      ok(!k2.progs.bad.length && !k2.guard.length, '«Кубомир»: все программы собрались, страж чист', k2);
      if (k2.progs.warn.length) console.log('  предупреждения компилятора («Кубомир»):', JSON.stringify(k2.progs.warn).slice(0, 900));
      ok(k2.st.cover > .5 && k2.st.season === 'winter', '«Кубомир» зимой: снег на блоках', k2.st);
    }

    // ═══ 3. Салют и новогоднее задание поверх страницы ═══
    await send('Page.navigate', { url: BASE + '/#/home' });
    await sleep(4000);
    await ev(`(() => { const C = D37E.climate; C.advent = () => ({ day: 15, year: 2026, left: 16 * 86400 + 4 * 3600 + 12 * 60, newYear: 2027 }); D37Celebrate._test.advRender(true); D37Celebrate._test.second(); return true; })()`);
    await sleep(800);
    await shot('site-advent-banner');
    await ev(`(() => { location.hash = '#/games'; return true; })()`); await sleep(2500);
    await ev(`(() => { D37Celebrate._test.second(); return true; })()`); await sleep(600);
    await shot('site-advent-card');
    await ev(`(() => { D37Celebrate.countdown(3); return true; })()`); await sleep(400);
    await shot('newyear-countdown');
    await ev(`(() => { D37Celebrate.show('newyear', { big: true, sec: 12 }); return true; })()`); await sleep(2600);
    await shot('newyear-fireworks');
    await ev(`(() => { D37Celebrate.stop(); D37Celebrate.show('nauryz', { sec: 8 }); return true; })()`); await sleep(2200);
    await shot('nauryz-greeting');
    await ev(`(() => { D37Celebrate.stop(); D37Celebrate.show('lunar', { sec: 8 }); return true; })()`); await sleep(2600);
    await shot('lunar-lanterns');
    const ui = await ev(`({ adv: !!document.querySelector('.cel-adv'), canvas: !!document.querySelector('.cel-fx'), card: !!document.querySelector('.cel-card') })`);
    ok(ui.adv && ui.canvas && ui.card, 'праздник: карточка задания, холст салюта, поздравление', ui);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|страж графики|exception|погода/i.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров и погоды', bad.slice(0, 5));
  } catch (e) {
    fail++; console.log('ОШИБКА', e.message);
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
  }
  finally {
    console.log('ЗАМЕР', JSON.stringify(res, null, 1));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('снимки:', SHOTS);
  console.log(fail ? `climate-e2e: ${fail} ошибок` : 'climate-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

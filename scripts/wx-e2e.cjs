// Погода по биомам в НАСТОЯЩЕМ Chrome (T-135 WX2; headless, DevTools Protocol, без npm): «Мир Денчика» и «Кубомир» —
// ясно / пыльная буря / буран / песчаная буря / белая мгла: картинка включилась (частицы, туман ближе — как видимость, небо цвета
// бури), сколько стоит кадр (весь кадр ЦП — R.stats.cpuFrame, и отдельно картинка бури wx-fx и W.at — по замеру внутри), вызовы
// отрисовки, 0 ошибок; «soak» — долгий прогон со сменой бурь. Загрузки запрещены (Page/Browser.setDownloadBehavior deny).
// Запуск из корня сайта: node scripts/wx-e2e.cjs [phone|pc] [all|mir|kubomir|soak] [секунд soak = 600]
//   phone — 412×915, «средняя», ЦП ×4 (RATE=…); снимки и профиль Chrome — D37_TMP (по умолчанию E:\claude-tmp\t145)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [PROF = 'phone', WHAT = 'all', SOAK_ = '600'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t145' : os.tmpdir());
const SHOTS = path.join(TMP, 'wx-shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.keepAliveTimeout = 1000;
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); };
// in the page: time the special's own work (wx-fx frame, precip push, W.at) and the whole frame over n frames
const TIMERS = `(() => { if (window.__wxT) return; window.__wxT = { fx: 0, at: 0, nFx: 0, nAt: 0 }; })()`;
const WRAP = `(F, W) => { const T = window.__wxT; if (F && !F.__t) { const f0 = F.frame; F.frame = function(){ const t = performance.now(); try { return f0.apply(this, arguments); } finally { T.fx += performance.now() - t; T.nFx++; } }; F.__t = 1; }
  if (W && !W.__t) { const a0 = W.at; W.at = function(){ const t = performance.now(); try { return a0.apply(this, arguments); } finally { T.at += performance.now() - t; T.nAt++; } }; W.__t = 1; } return 1; }`;
const MEASURE = `async (R, n = 240) => { const st = R.stats, T = window.__wxT, a = []; let calls = 0, k = 0; T.fx = T.at = T.nFx = T.nAt = 0; const t0 = performance.now();
  await new Promise(res => { const f = () => { a.push(st.cpuFrame); calls += st.calls; if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  a.sort((x, y) => x - y); const avg = a.reduce((s, v) => s + v, 0) / a.length;
  return { cpu: +avg.toFixed(2), p95: +a[Math.floor(a.length * .95)].toFixed(2), calls: Math.round(calls / k), fps: +(k / ((performance.now() - t0) / 1000)).toFixed(1),
    fx: +(T.fx / Math.max(1, T.nFx)).toFixed(4), at: +(T.at / Math.max(1, T.nAt)).toFixed(4), atN: T.nAt }; }`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-wx-'));
  const dl = path.join(TMP, 'no-downloads'); fs.mkdirSync(dl, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null, browserWs = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  // downloads denied for the whole browser (owner rule: e2e never writes into «Загрузки» on C)
  try { const bw = new WebSocket(browserWs); await new Promise((r, j) => { bw.onopen = r; bw.onerror = j; }); bw.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } })); await sleep(200); bw.close(); } catch (e) {}
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); const f = path.join(SHOTS, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
  const phone = PROF === 'phone', Q = phone ? 'mid' : 'high', RATE = +(process.env.RATE || (phone ? 4 : 1));
  const res = { prof: PROF, rate: RATE, q: Q };
  // real (unmodified) game errors that are not ours: offline services in a local run (Supabase, ads) are filtered out
  const ourErr = () => errs.filter(e => !/supabase|realtime|ERR_|Failed to fetch|NetworkError|adsbygoogle|googlesyndication|yandex|net::|WebSocket|401|403|404|CORS/i.test(e));
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
    try { await send('Page.setDownloadBehavior', { behavior: 'deny', downloadPath: dl }); } catch (e) {}
    await send('Emulation.setDeviceMetricsOverride', phone ? { width: 412, height: 915, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    if (phone) {
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    if (RATE > 1) await send('Emulation.setCPUThrottlingRate', { rate: RATE });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q, d37_s3_learn: 'done' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 80 && !(await ev(`!!(window.D37Route && window.GAME_IMPL !== undefined && document.readyState === 'complete')`).catch(() => false)); i++) await sleep(250);
    await sleep(2000);
    await ev(TIMERS);
    const SET = ['clear', 'duststorm', 'buran', 'sandstorm', 'whiteout'];
    // ═══ «Мир Денчика» ═══
    const openMir = async () => {
      const t0 = Date.now();
      await ev(`location.hash = '#/games/world'`);
      let up = false; for (let i = 0; i < 240 * Math.max(1, RATE / 2) && !up; i++) { await sleep(250); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv && window.GAME_IMPL.world._test.state().wx)`, 5000); } catch (e) {} }
      return up ? Date.now() - t0 : -1;
    };
    const runMir = async () => {
      const ms = await openMir();
      ok(ms > 0, 'Мир открылся', ms);
      if (ms < 0) return;
      await sleep(4000);
      ok(await ev(`!!(window.D37E?.wx && window.D37E?.wxfx && GAME_IMPL.world._test.state().wx.wfx)`), 'ядро погоды и картинка бурь загружены, подключены к погоде мира');
      // W.at before / after (C.SPECIAL off / on) on this device: fresh worlds of the same settings, 300 calls each, alternating
      res.wat = await ev(`(() => { const C = D37E.climate, X = GAME_IMPL.world._test.state().wx, o = { seed: 'mir-bench', mode: 'calendar', climateAt: X.W.climateAt, wxRegionAt: X.W.wxRegionAt, hourAt: X.W.hourAt, seaY: 0, lapse: -.12, wx: true };
        const run = on => { C.SPECIAL = on; const W = C.world(o), t0 = performance.now(), ms0 = Date.now(); for (let i = 0; i < 300; i++) W.at(100 + i * 3, 40 + i, ms0 + i * 500, 5); return (performance.now() - t0) / 300; };
        let off = 0, on = 0; for (let k = 0; k < 3; k++) { off += run(false); on += run(true); } C.SPECIAL = true; return { off: +(off / 3).toFixed(4), on: +(on / 3).toFixed(4) }; })()`);
      console.log('  W.at (' + PROF + ', ×' + RATE + '): без особой погоды ' + res.wat.off + ' мс, с ней ' + res.wat.on + ' мс');
      await ev(`(${WRAP})(GAME_IMPL.world._test.state().wx.wfx, GAME_IMPL.world._test.state().wx.W)`);
      const M = res.mir = {};
      for (const pass of [1, 2]) for (const st of SET) {
        await ev(`GAME_IMPL.world._test.state().wx.force('${st}')`);
        await sleep(st === 'clear' ? 7000 : 11000);   // the look comes in over ~3 s (smoothing)
        const m = await ev(`(${MEASURE})(GAME_IMPL.world._test.state().R, ${phone ? 180 : 300})`, 180000);
        const info = await ev(`(() => { const S = GAME_IMPL.world._test.state(), X = S.wx, R = S.R, s = X.stats(), w = R.weatherSky?.() || {}; const bg = R.scene.background;
          return { special: s.special, wx: s.wx, fogFar: Math.round(R.scene.fog.far), camFar: Math.round(R.camera.far), vis: w.vis ? Math.round(w.vis) : 0, bg: bg && bg.r !== undefined ? [+bg.r.toFixed(3), +bg.g.toFixed(3), +bg.b.toFixed(3)] : null, stateX: X.state.stateX, state: X.state.state, wxObj: Object.values(X.wfx.objects()).filter(o => o && o.visible).length }; })()`);
        (M[st] || (M[st] = [])).push({ ...m, ...info });
        if (pass === 1) { await shot(`mir-${PROF}-${st}`); console.log(`  Мир, ${st}: кадр ${m.cpu} мс (p95 ${m.p95}), вызовов ${m.calls}, wx-fx ${m.fx} мс, W.at ${m.at} мс ×${m.atN}; ${JSON.stringify(info)}`); }
      }
      const avg = (st, k) => M[st].reduce((s, v) => s + v[k], 0) / M[st].length;
      for (const st of SET.slice(1)) {
        const a = M[st][1];
        ok(a.stateX === ({ duststorm: 'duststorm', buran: 'buran', sandstorm: 'sandstorm', whiteout: 'whiteout' })[st], `Мир, ${st}: stateX`, a.stateX);
        ok(a.vis > 0 && a.fogFar <= a.vis + 1, `Мир, ${st}: туман кончается на видимости бури`, { vis: a.vis, fogFar: a.fogFar });
        if (st !== 'whiteout') ok((a.wx.grains + a.wx.streaks) > 0 && (a.wx.grains + a.wx.streaks) <= (phone ? 350 : 770), `Мир, ${st}: частицы в пределах (телефон — 45 %)`, a.wx);
        ok(a.wxObj <= 2, `Мир, ${st}: картинка бури — не больше 2 вызовов отрисовки (бюджет — 3)`, { wxObj: a.wxObj, storm: a.calls, clear: Math.round(avg('clear', 'calls')) });
        // the added work over the same scene in clear weather (spec §10): timers are coarse (100 µs, jittered) — compare with clear
        ok(avg(st, 'fx') - avg('clear', 'fx') <= .25, `Мир, ${st}: картинка бури — не больше +0,25 мс на кадр к ясной погоде (${PROF}, ×${RATE})`, { storm: +avg(st, 'fx').toFixed(4), clear: +avg('clear', 'fx').toFixed(4) });
      }
      ok(M.clear[1].wx.grains === 0 && M.clear[1].wx.streaks === 0, 'Мир, ясно: частиц бури нет (0 вызовов)', M.clear[1].wx);
      res.mirSummary = Object.fromEntries(SET.map(st => [st, { cpu: +avg(st, 'cpu').toFixed(2), p95: +avg(st, 'p95').toFixed(2), calls: Math.round(avg(st, 'calls')), fx: +avg(st, 'fx').toFixed(4), at: +avg(st, 'at').toFixed(4) }]));
      console.log('  Мир, итог:', JSON.stringify(res.mirSummary));
      await ev(`GAME_IMPL.world._test.state().wx.force(null)`);
    };
    // ═══ «Кубомир»: новый мир (творчество), буря «одна всегда» через погоду движка ═══
    const runKb = async () => {
      await ev(`location.hash = '#/home'`); await sleep(1500);
      await ev(`location.hash = '#/games/kubomir'`);
      for (let i = 0; i < 120 && !(await ev(`!!document.querySelector('.kb-menu .kb-worlds')`).catch(() => false)); i++) await sleep(250);
      await sleep(800);
      await ev(`(() => { const b = [...document.querySelectorAll('.kb-mbtns button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`); await sleep(600);
      await ev(`(() => { const c = document.querySelector('[data-f="mode"] [data-v="creative"]'); c && c.click(); document.querySelector('[data-n="go"]')?.click(); })()`);
      let up = false; for (let i = 0; i < 360 && !up; i++) { await sleep(500); up = await ev(`!!GAME_IMPL.kubomir?._test?.state()?.ready`).catch(() => false); }
      ok(up, 'Кубомир: мир открылся');
      if (!up) return;
      await sleep(5000);
      ok(await ev(`!!GAME_IMPL.kubomir._test.state().WX?.wfx`), 'Кубомир: картинка бурь подключена');
      await ev(`(${WRAP})(GAME_IMPL.kubomir._test.state().WX.wfx, GAME_IMPL.kubomir._test.state().WX.clim?.W)`);
      const K = res.kb = {};
      for (const st of ['clear', 'sandstorm', 'buran', 'clear', 'sandstorm']) {
        await ev(`GAME_IMPL.kubomir._test.state().WX.clim.force('${st}')`);
        await sleep(11000);
        const m = await ev(`(${MEASURE})(GAME_IMPL.kubomir._test.state().R, ${phone ? 150 : 300})`, 180000);
        const info = await ev(`(() => { const st = GAME_IMPL.kubomir._test.state(), R = st.R, w = R.weatherSky?.() || {}; return { special: st.WX.clim.state.special, wx: st.WX.wfx.stats(), fogFar: Math.round(R.scene.fog.far), vis: w.vis ? Math.round(w.vis) : 0, snow: +st.WX.snow.toFixed(2) }; })()`);
        (K[st] || (K[st] = [])).push({ ...m, ...info });
        console.log(`  Кубомир, ${st}: кадр ${m.cpu} мс (p95 ${m.p95}), вызовов ${m.calls}, wx-fx ${m.fx} мс; ${JSON.stringify(info)}`);
        if (K[st].length === 1) await shot(`kb-${PROF}-${st}`);
      }
      const s = K.sandstorm[1], b = K.buran[0];
      ok(s.special === 'sandstorm' && s.wx.grains > 0 && s.vis > 0 && s.fogFar <= s.vis + 1, 'Кубомир, песчаная буря: частицы, видимость и туман', s);
      ok(b.special === 'buran' && b.snow > .3, 'Кубомир, буран: идёт снег (свои частицы «Кубомира»)', { special: b.special, snow: b.snow });
      ok(K.clear[1].wx.grains === 0 && K.clear[1].vis === 0, 'Кубомир, ясно: бури нет, небо — как его рисует «Кубомир»', K.clear[1]);
      ok(Math.max(...K.sandstorm.map(x => x.fx)) - Math.min(...K.clear.map(x => x.fx)) <= .3, `Кубомир: картинка бури — не больше +0,3 мс на кадр к ясной погоде (${PROF}, ×${RATE})`, { storm: K.sandstorm.map(x => x.fx), clear: K.clear.map(x => x.fx) });
      res.kbSummary = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, { cpu: +(v.reduce((a, x) => a + x.cpu, 0) / v.length).toFixed(2), calls: Math.round(v.reduce((a, x) => a + x.calls, 0) / v.length), fx: +(v.reduce((a, x) => a + x.fx, 0) / v.length).toFixed(4) }]));
      console.log('  Кубомир, итог:', JSON.stringify(res.kbSummary));
      await ev(`GAME_IMPL.kubomir._test.state().WX.clim.force(null)`);
    };
    // ═══ soak: the world for N s, a different special every 30 s (and the real schedule between), 0 errors, heap stays flat ═══
    const runSoak = async () => {
      const ms = await openMir(); ok(ms > 0, 'soak: Мир открылся'); if (ms < 0) return;
      await sleep(5000);
      const heap = async () => { await send('HeapProfiler.collectGarbage'); await sleep(80); return +((await send('Runtime.getHeapUsage')).usedSize / 1048576).toFixed(1); };
      const h0 = await heap(), e0 = ourErr().length, t0 = Date.now(), dur = (+SOAK_ || 600) * 1000, hs = [h0];
      const cyc = ['duststorm', 'buran', 'sandstorm', null, 'whiteout', 'hail', 'downpour', 'seafog', 'freezing_rain', null];
      let k = 0;
      while (Date.now() - t0 < dur) {
        // a playing user: the world's AFK rule (8 min standing still → out of the world) must not end the soak
        await ev(`(() => { const S = GAME_IMPL.world._test.state(); S.idleAt = Date.now(); S.wx.force(${cyc[k % cyc.length] ? `'${cyc[k % cyc.length]}'` : 'null'}); return 1; })()`); k++;
        for (let w = 0; w < 6; w++) { await sleep(5000); await ev(`(() => { const S = GAME_IMPL.world._test.state(); if (S) S.idleAt = Date.now(); return 1; })()`); }
        if (k % 4 === 0) { hs.push(await heap()); console.log(`  soak ${Math.round((Date.now() - t0) / 1000)} с: куча ${hs[hs.length - 1]} МБ, ошибок ${ourErr().length - e0}`); }
      }
      const h1 = await heap();
      res.soak = { sec: Math.round((Date.now() - t0) / 1000), heap0: h0, heap1: h1, heaps: hs, errors: ourErr().length - e0, switches: k };
      ok(ourErr().length - e0 === 0, `soak ${res.soak.sec} с: 0 ошибок`, ourErr().slice(e0, e0 + 5));
      ok(h1 - h0 < 12, 'soak: куча не растёт (≤ +12 МБ: кэши мира прогреваются)', { h0, h1 });
    };
    if (WHAT === 'all' || WHAT === 'mir') await runMir();
    if (WHAT === 'all' || WHAT === 'kubomir') await runKb();
    if (WHAT === 'soak') await runSoak();
    ok(ourErr().length === 0, 'без ошибок и исключений', ourErr().slice(0, 6));
  } catch (e) { fail++; console.log('FAIL', e.message); }
  fs.writeFileSync(path.join(TMP, `wx-e2e-${PROF}-${WHAT}.json`), JSON.stringify(res, null, 1));
  console.log(`\nwx-e2e (${PROF}, ${WHAT}): ${fail ? fail + ' FAIL' : 'всё ок'}; снимки — ${SHOTS}`);
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();

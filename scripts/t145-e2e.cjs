// T-145 in a REAL Chrome (headless, DevTools Protocol, no npm): «Планета» and «Новая земля» open to everyone, weather by biome on both.
//   planet  — the catalog shows it; ground: lands in a desert latitude, forced sandstorm reaches the planet's own sky / ground hook
//             (V.setWeather: dust, tint, visibility) and wx-fx grains fly; space: orbit 300 km; frame CPU on the ground / in space
//   terra   — the catalog shows it; digging (edits applied), weather by biome: region record from D37E.biomes, forced sandstorm (grains,
//             visibility), frame CPU walking with and without the storm
//   kubomir — a NEW world of generator v4 (logical biomes): G.ver 4, biomes from D37E.biomes, the weather cell record = B.region
//   reopen  — N rounds (default 20) planet ↔ terra: heap after GC, live workers, canvases, 0 errors
//   soak    — S seconds (default 600): planet ground → orbit → terra digging, storms on and off, heap stays flat, 0 errors
// Downloads denied (Browser + Page.setDownloadBehavior). Temp: D37_TMP (default E:\claude-tmp\t145\all).
// Run from the site root: node scripts/t145-e2e.cjs [phone|pc] [all|planet|terra|kubomir|reopen|soak] [rounds|seconds]
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [PROF = 'phone', WHAT = 'all', ARG = ''] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t145/all' : os.tmpdir());
const SHOTS = path.join(TMP, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
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
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); };
// whole frame CPU (render.js R.stats.cpuFrame) over n frames
const MEASURE = `async (R, n = 180) => { const st = R.stats, a = []; let calls = 0, k = 0; const t0 = performance.now();
  await new Promise(res => { const f = () => { a.push(st.cpuFrame); calls += st.calls; if (++k >= n) res(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
  a.sort((x, y) => x - y); const avg = a.reduce((s, v) => s + v, 0) / a.length;
  return { cpu: +avg.toFixed(2), p95: +a[Math.floor(a.length * .95)].toFixed(2), calls: Math.round(calls / k), fps: +(k / ((performance.now() - t0) / 1000)).toFixed(1) }; }`;
// live workers and WebGL canvases (wrapped before any page script)
const PRE = `(() => { const W0 = window.Worker; if (!W0 || W0.__t) return; const live = window.__liveW = new Set();
  function W(...a){ const w = new W0(...a); live.add(w); const t = w.terminate.bind(w); w.terminate = () => { live.delete(w); return t(); }; return w; }
  W.prototype = W0.prototype; W.__t = 1; window.Worker = W; })();`;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const dl = path.join(TMP, 'no-downloads'); fs.mkdirSync(dl, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null, browserWs = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); browserWs = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  try { const bw = new WebSocket(browserWs); await new Promise((r, j) => { bw.onopen = r; bw.onerror = j; }); bw.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } })); await sleep(200); bw.close(); } catch (e) {}
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) errs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 75 }); const f = path.join(SHOTS, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
  const phone = PROF === 'phone', Q = phone ? 'mid' : 'high', RATE = +(process.env.RATE || (phone ? 4 : 1));
  // errors that are not ours: offline services in a local run (Supabase, ads, our game server), the planet clock's fallback note
  const ourErr = () => errs.filter(e => /^(exception|error)/.test(e) && !/supabase|realtime|ERR_|Failed to fetch|NetworkError|adsbygoogle|googlesyndication|yandex|net::|WebSocket|401|403|404|CORS|130\.61\.75\.73|world_now/i.test(e));
  const weatherWarn = () => errs.filter(e => /погода|wx|terra|терра|планета/i.test(e) && /^warning/.test(e));
  const heap = async () => { await send('HeapProfiler.collectGarbage'); await sleep(300); await send('HeapProfiler.collectGarbage'); return +(await ev(`performance.memory.usedJSHeapSize / 1048576`)).toFixed(1); };
  // live objects of a prototype (DevTools queryObjects): three.js scenes, renderers, geometries left after a game closed
  const live = async expr => { try { const p = await send('Runtime.evaluate', { expression: expr }); if (!p.result?.objectId) return -1; const q = await send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId });
    const n = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){ return this.length; }', returnByValue: true }); return n.result.value; } catch (e) { return -1; } };
  const res = { prof: PROF, rate: RATE, q: Q };
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: PRE + `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 80 && !(await ev(`!!(window.D37Route && window.GAME_IMPL !== undefined && document.readyState === 'complete')`).catch(() => false)); i++) await sleep(250);
    await sleep(2000);
    const T = { planet: 'GAME_IMPL.planet._test', terra: 'GAME_IMPL.terra._test' };
    const open = async (gid, ready, maxS = 120) => {
      await ev(`location.hash = '#/home'`); await sleep(1200);
      const t0 = Date.now();
      await ev(`location.hash = '#/games/${gid}'`);
      let up = false; for (let i = 0; i < maxS * 4 * Math.max(1, RATE / 2) && !up; i++) { await sleep(250); up = await ev(`!!(${ready})`, 5000).catch(() => false); }
      if (!up) { const d = await ev(`(() => ({ route: D37Route.hash(), loc: location.href, impl: Object.keys(window.GAME_IMPL || {}), st: (() => { try { const t = window.GAME_IMPL?.['${gid}']?._test; return t ? { s: !!t.state(), stats: t.stats() } : null; } catch (e) { return String(e); } })(), text: (document.querySelector('#games-page')?.innerText || '').slice(0, 300) }))()`).catch(e => String(e)); console.log('  не открылась:', JSON.stringify(d).slice(0, 900), errs.slice(-8)); }
      return up ? Date.now() - t0 : -1;
    };
    const close = async () => { await ev(`location.hash = '#/home'`); await sleep(1500); };
    // ── the catalog: both open to everyone (no «проверка»), SEO card exists ──
    if (WHAT === 'all' || WHAT === 'planet' || WHAT === 'terra') {
      await ev(`location.hash = '#/games'`); await sleep(2500);
      const cat = await ev(`(() => { const t = document.body.textContent; return { planet: /Планета/.test(t), terra: /Новая земля/.test(t), test: /\\(проверка\\)/.test(t), n: typeof GAMES !== 'undefined' ? GAMES.length : -1, hid: typeof GAMES_HIDDEN !== 'undefined' ? GAMES_HIDDEN.map(g => g.id) : null }; })()`);
      ok(cat.planet && cat.terra && !cat.test && cat.hid && !cat.hid.includes('planet') && !cat.hid.includes('terra'), 'каталог: «Планета» и «Новая земля» видны всем, без «(проверка)»', cat);
    }
    // ═══ «Планета» ═══
    const planetReady = `window.GAME_IMPL?.planet?._test?.state() && GAME_IMPL.planet._test.stats()?.shown >= 8`;
    if (WHAT === 'all' || WHAT === 'planet') {
      const ms = await open('planet', planetReady);
      ok(ms > 0, 'Планета открылась', ms);
      if (ms > 0) {
        res.planetOpenMs = ms;
        ok(await ev(`!!(window.D37E?.wx && window.D37E?.wxfx && ${T.planet}.S.wx && ${T.planet}.S.wx.wfx)`), 'планета: ядро погоды по биомам и картинка бурь загружены и подключены');
        ok(await ev(`!!document.querySelector('.pl-st')?.hidden`), 'планета: строка отладки скрыта (F3)');
        // T-145 проверка P1: оболочка неба (ореол с орбиты) — без «погоды»: new Vector4() давал w = 1 → цвет оболочки умножался на 0
        const halo = await ev(`(() => { let n = 0, bad = []; ${T.planet}.S.R.scene.traverse(o => { const m = o.material, u = m && m.uniforms; if (m && m.name === 'planet-sky' && u.uMode && u.uMode.value === 1) { n++; if (!u.uSkyWx || u.uSkyWx.value.w !== 0) bad.push(u.uSkyWx && u.uSkyWx.value.toArray()); } }); return { n, bad }; })()`);
        ok(halo.n === 1 && !halo.bad.length, 'планета: ореол атмосферы с орбиты — оболочка неба без погоды (uSkyWx.w = 0)', halo);
        await shot('planet-orbit-open-' + PROF);
        // T-145 проверка W2: погода берёт свой климат места — у экватора в январе снега нет, на 45° ю. ш. в январе лето
        const pw = await ev(`(() => { const S = ${T.planet}.S, W = S.W, R = S.P.R, D = Math.PI / 180; if (!W) return null; const J = Date.UTC(2027, 0, 15); let sn = 0, mn = 99;
          for (let h = 0; h < 72; h += 1.7) { const s = W.at(120 * D * R, -10 * D * R, J + h * 3600000, 0); if (s.snow > .05) sn++; if (s.temp < mn) mn = s.temp; }
          return { place: typeof W.placeAt === 'function', sn, mn: +mn.toFixed(1), north: W.at(30 * D * R, -45 * D * R, J, 0).season, south: W.at(30 * D * R, 45 * D * R, J, 0).season }; })()`);
        ok(pw && pw.place && pw.sn === 0 && pw.mn > 12 && pw.north === 'winter' && pw.south === 'summer', 'планета: у экватора (10° с. ш.) в январе без снега; 45° с. ш. — зима, 45° ю. ш. — лето', pw);
        // a desert latitude: the planet's own climate by latitude
        const des = await ev(`(() => { const S = ${T.planet}.S; let any = null; for (let lat = 0; lat <= 60; lat += 2) for (let lon = -180; lon < 180; lon += 15) { const d = S.P.dirFromLatLon(lat, lon); if (S.P.climateAt(d) !== 'desert') continue; any = any || [lat, lon]; const h = S.P.localHour(d, S.t); if (h > 9 && h < 15) return [lat, lon]; } return any; })()`);
        ok(!!des, 'планета: есть пустынная широта', des);
        const ll = des || [29, 81];
        await ev(`${T.planet}.goto(${ll[0]}, ${ll[1]}, 30)`); await sleep(2500); await ev(`${T.planet}.land()`); await sleep(6000);
        const g0 = await ev(`(() => { const s = ${T.planet}.state(); return { mode: s.mode, grounded: s.player?.grounded, shown: ${T.planet}.stats().shown, region: ${T.planet}.S.W?.__wx?.reg?.r || null }; })()`);
        ok(g0.mode === 'walk', 'планета: сели на землю в пустыне', g0);
        // HUD 2.0 (D8): on the bar only the contextual button and ☰, inside the window; one status line; ☰ → «Подняться на орбиту» works
        const hu = await ev(`(() => { const w = document.querySelector('.pl-wrap'), wr = w.getBoundingClientRect(), bs = [...w.querySelectorAll('.pl-bar button')].filter(b => b.offsetParent && getComputedStyle(b).opacity > .3);
          return { v2: w.classList.contains('pl-v2'), n: bs.length, inside: bs.every(b => { const r = b.getBoundingClientRect(); return r.left >= wr.left - 1 && r.right <= wr.right + 1; }), lines: (w.querySelector('.pl-hud > div')?.textContent || '').split('\\n').length,
            shellMenu: [...document.querySelectorAll('#gamesStage .gs2-menubtn')].filter(b => b.offsetParent).length }; })()`);
        console.log('  планета, интерфейс:', JSON.stringify(hu));
        ok(hu.v2 && hu.n === 2 && hu.inside && hu.lines === 1 && hu.shellMenu === 0, 'планета: интерфейс 2.0 — на панели 2 кнопки (по делу и ☰) в окне, одна строка состояния, одно ☰', hu);
        await ev(`document.querySelector('.pl-bar .pl-menu').click()`); await sleep(500);
        const mi = await ev(`[...document.querySelectorAll('.gs-menu-it')].map(b => b.dataset.mi)`);
        await ev(`document.querySelector('.gs-menu-it[data-mi="orbit"]')?.click()`); await sleep(5000);
        const mo = await ev(`(() => ({ mode: ${T.planet}.state().mode, alt: Math.round((${T.planet}.state().alt || 0) / 1000), open: !!document.querySelector('.gs-menu-it') }))()`);
        ok(mi.includes('orbit') && mi.includes('time') && mi.includes('sh-back') && mo.mode === 'fly' && !mo.open, 'планета: ☰ — орбита, время, «Все игры»; «Подняться на орбиту» из ☰ взлетает', { mi, mo });
        await shot('planet-hud2-orbit-' + PROF);
        await ev(`${T.planet}.goto(${ll[0]}, ${ll[1]}, 30)`); await sleep(2500); await ev(`${T.planet}.land()`); await sleep(6000);
        res.planetGround = await ev(`(${MEASURE})(${T.planet}.S.R, ${phone ? 150 : 300})`, 240000);
        console.log('  планета, земля (' + PROF + ' ×' + RATE + '):', JSON.stringify(res.planetGround));
        // A/B on the same page: without the specials core and visuals (D37E.climate.SPECIAL / D37E.wxfx.ON — the one-line rollbacks)
        res.planetGroundOff = await ev(`(async () => { D37E.climate.SPECIAL = false; D37E.wxfx.ON = false; await new Promise(r => setTimeout(r, 1500)); const m = await (${MEASURE})(${T.planet}.S.R, ${phone ? 150 : 300}); D37E.climate.SPECIAL = true; D37E.wxfx.ON = true; return m; })()`, 240000);
        console.log('  планета, земля без особой погоды (откат):', JSON.stringify(res.planetGroundOff));
        res.planetGround2 = await ev(`(${MEASURE})(${T.planet}.S.R, ${phone ? 150 : 300})`, 240000);
        console.log('  планета, земля снова с особой погодой (порядок A/B/A):', JSON.stringify(res.planetGround2));
        await ev(`${T.planet}.S.wx.force('sandstorm')`); await sleep(9000);
        const sd = await ev(`(() => { const S = ${T.planet}.S, d = S.V._dbg && S.V._dbg(), n = d && d.showList.find(n => n.ch && n.ch.mesh), U = n ? n.ch.mesh.material.uniforms : {}, K = S.wx.wfx.K; return { special: S.wx.state.special, dust: +K.dust.toFixed(2), vis: Math.round(K.vis), grains: S.wx.wfx.stats().grains,
          uWv: U.uWv ? +U.uWv.value.x.toFixed(5) : null, uWt: U.uWt ? [+U.uWt.value.x.toFixed(2), +U.uWt.value.y.toFixed(2), +U.uWt.value.z.toFixed(2), U.uWt.value.w] : null }; })()`);
        ok(sd.special === 'sandstorm' && sd.dust > .2 && sd.vis < 300 && (sd.uWv === null || sd.uWv > 0), 'планета: песчаная буря — пыль, видимость, крючок земли планеты (V.setWeather)', sd);
        ok(phone ? sd.grains >= 0 : sd.grains > 0, 'планета: песок в воздухе (wx-fx)', sd.grains);
        await shot('planet-sandstorm-' + PROF);
        res.planetStorm = await ev(`(${MEASURE})(${T.planet}.S.R, ${phone ? 150 : 300})`, 240000);
        console.log('  планета, песчаная буря:', JSON.stringify(res.planetStorm));
        // space: orbit 300 km — straight from the storm (the storm below must not tint the planet seen from orbit)
        await ev(`${T.planet}.orbit()`); await sleep(7000);
        const sp = await ev(`(() => { const s = ${T.planet}.state(); return { mode: s.mode, altKm: Math.round((s.alt || 0) / 1000), shown: ${T.planet}.stats().shown, flushes: ${T.planet}.stats().flushes, uWv: (() => { const d = ${T.planet}.S.V._dbg(), n = d.showList.find(n => n.ch && n.ch.mesh); return n ? n.ch.mesh.material.uniforms.uWv.value.x : -1; })() }; })()`);
        ok(sp.mode === 'fly' && sp.shown > 0 && sp.shown <= 60 && sp.uWv === 0, 'планета: орбита после посадки — планета целиком (крупные куски, без дыр), без цвета бури снизу', sp);
        await shot('planet-orbit-' + PROF);
        res.planetOrbit = await ev(`(${MEASURE})(${T.planet}.S.R, ${phone ? 150 : 300})`, 240000);
        console.log('  планета, орбита:', JSON.stringify(res.planetOrbit));
        await ev(`${T.planet}.S.wx.force(null)`);
        const e = ourErr(); ok(!e.length, 'планета: 0 ошибок', e.slice(0, 5));
      }
      await close();
    }
    // ═══ «Новая земля» ═══
    const terraReady = `window.GAME_IMPL?.terra?._test?.state() && GAME_IMPL.terra._test.stats()?.tm?.live > 20`;
    if (WHAT === 'all' || WHAT === 'terra') {
      const ms = await open('terra', terraReady);
      ok(ms > 0, 'Новая земля открылась', ms);
      if (ms > 0) {
        res.terraOpenMs = ms;
        await sleep(3000);
        await shot('terra-open-' + PROF);
        const w0 = await ev(`${T.terra}.wx()`);
        ok(w0 && w0.region && Number.isInteger(w0.region.cls), 'новая земля: погода подключена, запись места — из логичных биомов', w0 && { state: w0.state, region: w0.region });
        // T-145 проверка: W1 — свой климат места (саванна у пустыни без снега), W3 — сутки и часы погоды идут, TECH-4 — origin без мусора,
        // T1 — туман сплошной к краю колец блоков
        const tc = await ev(`(() => { const S = ${T.terra}.S, W = S.W, J = Date.UTC(2027, 0, 1), U = 2.1 / 1.8; let sn = 0, mn = 99;
          for (let h = 0; h < 31 * 24; h += 7.3) { const s = W.at(-11600, -10400, J + h * 3600000, 38); if (s.snow > .05) sn++; if (s.temp < mn) mn = s.temp; }
          const ms = Date.now(), lt = S.R.lighting.time, dc = D37E.dayClock(ms, 40, .2);
          return { place: typeof W.placeAt === 'function', savSnow: sn, savMin: +mn.toFixed(1), light: +lt.toFixed(2), clock: +dc.toFixed(2), hourMoves: W.hourAt(ms) !== W.hourAt(ms + 600000),
            origin: S.wxOrigin() === S.wxOrigin(), fogFar: +S.R.scene.fog.far.toFixed(1), edge: +((S.TS.radius - .5) * 32 * U).toFixed(1), dist: S.R.opt.dist }; })()`);
        ok(tc.place && tc.savSnow === 0 && tc.savMin > 5, 'новая земля: саванна у пустыни в январе — без снега и мороза (свой климат места)', tc);
        await sleep(5000); const lt2 = await ev(`${T.terra}.S.R.lighting.time`);
        ok(Math.abs(tc.light - tc.clock) < .3 && tc.hourMoves && lt2 !== tc.light, 'новая земля: сутки идут (свет = общее время мира), часы погоды — от момента', { light: tc.light, clock: tc.clock, light5s: lt2 });
        ok(tc.origin, 'новая земля: origin погоды — один массив (кадр без мусора)');
        ok(tc.fogFar <= tc.edge + 1, 'новая земля: туман сплошной до края колец блоков (среза мира не видно)', tc);
        res.terraWalk = await ev(`(async () => { ${T.terra}.move(0, -1, false); const m = await (${MEASURE})(${T.terra}.S.R, ${phone ? 150 : 300}); ${T.terra}.move(0, 0, false); return m; })()`, 240000);
        console.log('  новая земля, ходьба (' + PROF + ' ×' + RATE + '):', JSON.stringify(res.terraWalk));
        // digging: 6 digs, edits applied
        const pS = s => s && { mode: s.mode, y: +s.player.y.toFixed(1), grounded: s.player.grounded, swim: s.player.swim, wx: Math.round(s.player.wx), wz: Math.round(s.player.wz) };
        console.log('  после ходьбы:', JSON.stringify(pS(await ev(`${T.terra}.state()`))), JSON.stringify(await ev(`${T.terra}.t145()`)));
        const e0 = (await ev(`${T.terra}.state().edits`)) || 0;
        for (let i = 0; i < 6; i++) { await ev(`${T.terra}.dig()`); await sleep(700); }
        await sleep(2500);
        const e1 = (await ev(`${T.terra}.state().edits`)) || 0, ts = await ev(`${T.terra}.stats().ts`);
        ok(e1 > e0, 'новая земля: копаем — правки применились', { before: e0, after: e1, coreEdits: ts.edits });
        console.log('  после копания:', JSON.stringify(pS(await ev(`${T.terra}.state()`))));
        await shot('terra-dig-' + PROF);
        // T-145 проверка TECH-6: небо кончается над рельефом с правками — в выкопанной яме дождь доходит до дна
        const sk = await ev(`(() => { const S = ${T.terra}.S, s = ${T.terra}.state(), T1 = D37E.terraCore; let lo = 0; for (let dx = -10; dx <= 10; dx += 1) for (let dz = -10; dz <= 10; dz += 1) { const x = s.player.wx + dx, z = s.player.wz + dz, d = S.TS.skyTop(x, z) - T1.height(1337, x, z); if (d < lo) lo = d; } return +lo.toFixed(2); })()`);
        ok(sk < -1, 'новая земля: в выкопанной яме небо ниже прежней земли (TS.skyTop с правками)', sk);
        await ev(`(() => { ${T.terra}.S.wx.force('clear'); ${T.terra}.fly(true); ${T.terra}.vert(1); return 1; })()`); await sleep(phone ? 9000 : 5000); await ev(`(() => { ${T.terra}.vert(0); ${T.terra}.look(0.6, -1.1); return 1; })()`); await sleep(4000);
        await shot('terra-air-' + PROF);
        const air = await ev(`(() => { const s = ${T.terra}.state(), S = ${T.terra}.S, U = 2.1 / 1.8, g = Math.max(0, S.TS.height(s.fly.wx, s.fly.wz)) * U; return { y: Math.round(s.fly.y), above: Math.round(s.fly.y - g), fogFar: Math.round(S.R.scene.fog.far), fogNear: Math.round(S.R.scene.fog.near), far: Math.round(S.R.camera.far), wx: S.wx && S.wx.state.state, gh: +Math.max(...[0, 1, 2].map(j => Math.abs(S.R.sky.gnd[j] - S.R.sky.hor[j]))).toFixed(4), nk: S.R.lighting.fogNearK }; })()`);
        console.log('  полёт:', JSON.stringify(air));
        ok(air.nk > .3 && air.gh < .02, 'новая земля: в полёте низ купола неба — цвета тумана (край колец блоков не стоит силуэтом на тёмном небе)', air);
        // земля прямо под тобой — меньше половины тумана (туман с fogNearK у высоты камеры), край колец — по косой дальше, в тумане
        air.nadir = +Math.max(0, (air.above - air.fogNear) / Math.max(1, air.fogFar - air.fogNear)).toFixed(2);
        ok(air.fogFar > air.above && air.nadir < .5, 'новая земля: в полёте в ясную погоду землю под собой видно (туман — от края на высоте камеры)', air);
        await ev(`${T.terra}.S.wx.force(null)`);
        await ev(`(() => { ${T.terra}.fly(false); return 1; })()`); await sleep(2500);
        await ev(`${T.terra}.S.wx.force('sandstorm')`); await sleep(9000);
        const sd = await ev(`${T.terra}.wx()`);
        ok(sd.special === 'sandstorm' && sd.wx && sd.wx.dust > .2 && sd.wx.vis < 300, 'новая земля: песчаная буря — пыль, видимость, небо', sd.wx);
        ok(sd.wx && sd.wx.grains > 0, 'новая земля: песок в воздухе', sd.wx && sd.wx.grains);
        await shot('terra-sandstorm-' + PROF);
        res.terraStorm = await ev(`(async () => { ${T.terra}.move(0, -1, false); const m = await (${MEASURE})(${T.terra}.S.R, ${phone ? 150 : 300}); ${T.terra}.move(0, 0, false); return m; })()`, 240000);
        console.log('  новая земля, ходьба в бурю:', JSON.stringify(res.terraStorm));
        await ev(`${T.terra}.S.wx.force(null)`); await sleep(6000);
        res.terraClear = await ev(`(async () => { ${T.terra}.move(0, -1, false); const m = await (${MEASURE})(${T.terra}.S.R, ${phone ? 150 : 300}); ${T.terra}.move(0, 0, false); return m; })()`, 240000);
        await ev(`(() => { const S = ${T.terra}.S; S.wx.dispose(); S.wx = null; return 1; })()`); await sleep(1500);
        res.terraNoWx = await ev(`(async () => { ${T.terra}.move(0, -1, false); const m = await (${MEASURE})(${T.terra}.S.R, ${phone ? 150 : 300}); ${T.terra}.move(0, 0, false); return m; })()`, 240000);
        console.log('  новая земля, ясно с погодой / без погоды (TERRA_WX = false):', JSON.stringify(res.terraClear), JSON.stringify(res.terraNoWx));
        const e = ourErr(); ok(!e.length, 'новая земля: 0 ошибок', e.slice(0, 5));
      }
      await close();
    }
    // ═══ «Кубомир»: новый мир генератора v4 ═══
    if (WHAT === 'all' || WHAT === 'kubomir') {
      await ev(`location.hash = '#/games/kubomir'`);
      for (let i = 0; i < 160 && !(await ev(`!!document.querySelector('.kb-menu .kb-worlds') && !!window.D37E?.vox?.store`).catch(() => false)); i++) await sleep(250);
      // a NEW world made through the menu (survival): the generator version comes from KB_GEN (D4), hail harms (D5), storm sky (D2)
      await sleep(800);
      await ev(`(() => { const b = [...document.querySelectorAll('.kb-mbtns button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`); await sleep(600);
      await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 't145-biomes'; document.querySelector('[data-f="mode"] [data-v="survival"]')?.click(); document.querySelector('[data-n="go"]')?.click(); })()`);
      let up = false; for (let i = 0; i < 360 && !up; i++) { await sleep(500); up = await ev(`!!GAME_IMPL.kubomir?._test?.state()?.ready`).catch(() => false); }
      const wid = up ? await ev(`GAME_IMPL.kubomir._test.state().meta.id`) : '';
      ok(up, 'Кубомир: новый мир v4 открылся');
      if (up) {
        await sleep(5000);
        const k = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), B = D37E.biomes, src = B.kb(S.G), p = S.P || { x: 0, z: 0 };
          const x = Math.floor(p.x || 0), z = Math.floor(p.z || 0), seen = {};
          for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) { const r = B.at(src, x + i * 128, z + j * 128); seen[r.id] = (seen[r.id] || 0) + 1; }
          const W = S.WX?.clim?.W, rec = W && W.wxRegionAt ? W.wxRegionAt(x, z) : null, q = B.region(src, x, z, 128, {});
          return { ver: S.G.ver, here: B.at(src, x, z).id, seen, rec, q: { cls: q.cls, smask: q.smask, F: q.F } }; })()`);
        ok(k.ver === 4 && (await ev(`GAME_IMPL.kubomir._test.state().meta.genVer`)) === 4, 'Кубомир: новый мир из меню — генератор v4 (логичные биомы), meta.genVer 4', k.ver);
        // hail harms (D5): «всегда град», a nearly full fraction of a point → the next 0.5 s weather tick takes one point (or the roof saves)
        await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); window.__hail = 0; const h0 = S.WX.hurt; S.WX.hurt = n => { window.__hail += n; h0(n); }; S.P.hp = 20; S.WX.clim.force('hail'); const P = S.P, t = S.WX.top(P.x, P.z); if (t > P.y + 1) P.y = t + .02; return 1; })()`);   // под деревом — на его верх (открытое небо)
        await sleep(4000);
        await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), P = S.P, t = S.WX.top(P.x, P.z); if (t > P.y + 1) P.y = t + .02; S.WX.hailAcc.f = .999; return 1; })()`); await sleep(2500);
        const hl = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), c = S.WX.clim.state, P = S.P; return { hit: window.__hail, hp: P.hp, special: c.special, cls: c.hailCls, hail: +(c.hail || 0).toFixed(2), sp: +(c.sp || 0).toFixed(2), roof: S.WX.top(P.x, P.z) > P.y + 1, creative: !!S.creative }; })()`);
        console.log('  Кубомир, град:', JSON.stringify(hl));
        ok(hl.cls > 0 && hl.hail > .25 && (hl.roof ? hl.hit === 0 : hl.hit >= 1 && hl.hp >= 10), 'Кубомир: град ранит под открытым небом (не ниже половины), под крышей — нет', hl);
        // storm wall (D2): the sky dome is the horizon colour = fog colour
        await ev(`GAME_IMPL.kubomir._test.state().WX.clim.force('sandstorm')`); await sleep(9000);
        const sk = await ev(`(() => { const R = GAME_IMPL.kubomir._test.state().R, M = R.sky, f = R.scene.fog.color, d = (a, b) => Math.max(...[0, 1, 2].map(j => Math.abs(a[j] - b[j])));
          return { zh: +d(M.zen, M.hor).toFixed(4), gh: +d(M.gnd, M.hor).toFixed(4), fh: +d([f.r, f.g, f.b], M.hor).toFixed(4), far: Math.round(R.scene.fog.far) }; })()`);
        console.log('  Кубомир, песчаная буря — небо:', JSON.stringify(sk));
        await shot('kubomir-sandstorm-' + PROF);
        ok(sk.zh < .02 && sk.gh < .02 && sk.fh < .03, 'Кубомир: песчаная буря — купол неба цвета горизонта и тумана (без силуэта земли)', sk);
        await ev(`GAME_IMPL.kubomir._test.state().WX.clim.force(null)`);
        ok(Object.keys(k.seen).length >= 2, 'Кубомир v4: несколько биомов вокруг (2 км)', k.seen);
        ok(!k.rec || (k.rec.cls === k.q.cls && k.rec.smask === k.q.smask), 'Кубомир v4: запись погоды клетки = D37E.biomes.region', { rec: k.rec, q: k.q, here: k.here });
        res.kubomirV4 = k;
        await shot('kubomir-v4-' + PROF);
        res.kubomirFrame = await ev(`(${MEASURE})(GAME_IMPL.kubomir._test.state().R, ${phone ? 150 : 300})`, 240000);
        console.log('  Кубомир v4 (' + PROF + ' ×' + RATE + '):', JSON.stringify(res.kubomirFrame));
        const e = ourErr(); ok(!e.length, 'Кубомир v4: 0 ошибок', e.slice(0, 5));
        try { await ev(`GAME_IMPL.kubomir._test.stop()`, 30000); } catch (e2) {}
        try { await ev(`D37E.vox.store.delWorld('${wid}')`, 10000); } catch (e2) {}
      }
      await close();
    }
    // ═══ 20× reopen: planet ↔ terra ═══
    if (WHAT === 'all' || WHAT === 'reopen') {
      const N = +(WHAT === 'reopen' && ARG ? ARG : 20), H = [];
      const h0 = await heap();
      for (let r = 0; r < N; r++) {
        const gid = r % 2 ? 'terra' : 'planet';
        const ms = await open(gid, gid === 'planet' ? planetReady : terraReady, 90);
        if (ms < 0) { console.log('  круг ' + r + ': ' + gid + ' не открылся за 90 с — пропуск'); await close(); continue; }
        if (gid === 'planet') { await ev(`${T.planet}.S.wx && ${T.planet}.S.wx.force('sandstorm')`); } else { await ev(`${T.terra}.dig()`); await ev(`${T.terra}.S.wx && ${T.terra}.S.wx.force('duststorm')`); }
        await sleep(2500);
        await close(); await sleep(1500);
        const h = await heap(), w = await ev(`window.__liveW ? window.__liveW.size : -1`), cv = await ev(`document.querySelectorAll('canvas').length`);
        const sc = await live('window.THREE ? THREE.Scene.prototype : null'), rd = await live('window.THREE ? THREE.WebGLRenderer.prototype : null'), bg = await live('window.THREE ? THREE.BufferGeometry.prototype : null');
        H.push({ r, gid, ms, heap: h, workers: w, canvases: cv, scenes: sc, renderers: rd, geoms: bg });
        console.log(`  круг ${r + 1}/${N} ${gid}: открылась за ${ms} мс, память после сборки ${h} МБ, потоков ${w}, холстов ${cv}, сцен ${sc}, рендереров ${rd}, геометрий ${bg}`);
      }
      res.reopen = { h0, rounds: H };
      const last = H[H.length - 1] || {}, mid = H[Math.floor(H.length / 2)] || {};
      ok(H.length >= N * .8, 'переоткрытия: прошли', H.length);
      ok(last.heap - h0 < 12 && last.heap - mid.heap < 6, 'переоткрытия: память не растёт', { h0, mid: mid.heap, last: last.heap });
      ok(H.every(x => x.workers === 0), 'переоткрытия: потоков после закрытия 0', H.map(x => x.workers));
      const e = ourErr(); ok(!e.length, 'переоткрытия: 0 ошибок', e.slice(0, 5));
    }
    // ═══ soak ═══
    if (WHAT === 'all' || WHAT === 'soak') {
      const SEC = +(WHAT === 'soak' && ARG ? ARG : 600), t0 = Date.now(), H = [], errs0 = ourErr().length;
      let k = 0;
      while (Date.now() - t0 < SEC * 1000) {
        const left = SEC * 1000 - (Date.now() - t0);
        if (k % 2 === 0) {
          const ms = await open('planet', planetReady, 90);
          if (ms > 0) {
            await ev(`${T.planet}.goto(${20 + (k % 7) * 3}, ${k * 23 % 300 - 150}, 30)`); await sleep(2000); await ev(`${T.planet}.land()`);
            await ev(`${T.planet}.move(0, -1, true)`);
            await ev(`${T.planet}.S.wx && ${T.planet}.S.wx.force(${k % 4 === 0 ? "'sandstorm'" : 'null'})`);
            await sleep(Math.min(left, 90000));
            await ev(`${T.planet}.move(0, 0, false)`); await ev(`${T.planet}.orbit()`); await sleep(Math.min(Math.max(0, SEC * 1000 - (Date.now() - t0)), 20000));
          }
        } else {
          const ms = await open('terra', terraReady, 90);
          if (ms > 0) {
            await ev(`${T.terra}.S.wx && ${T.terra}.S.wx.force(${k % 4 === 1 ? "'duststorm'" : 'null'})`);
            const until = Date.now() + Math.min(left, 110000);
            let d = 0; while (Date.now() < until) { await ev(`${T.terra}.move(${Math.sin(d) * .6}, -1, ${d % 3 === 0})`); if (d % 2 === 0) await ev(`${T.terra}.dig()`); await sleep(2500); d++; }
            await ev(`${T.terra}.move(0, 0, false)`);
          }
        }
        await close();
        const h = await heap(); H.push({ s: Math.round((Date.now() - t0) / 1000), heap: h, game: k % 2 ? 'terra' : 'planet' });
        console.log(`  soak ${Math.round((Date.now() - t0) / 1000)} с: ${k % 2 ? 'новая земля' : 'планета'}, память после сборки ${h} МБ`);
        k++;
      }
      res.soak = { sec: Math.round((Date.now() - t0) / 1000), heap: H };
      const e = ourErr().slice(errs0); ok(!e.length, 'долгий прогон ' + res.soak.sec + ' с: 0 ошибок', e.slice(0, 5));
      const hs = H.map(x => x.heap); ok(hs.length < 3 || hs[hs.length - 1] - Math.min(...hs.slice(1)) < 10, 'долгий прогон: память ровная', hs);
    }
    const ww = weatherWarn(); if (ww.length) console.log('  предупреждения погоды:', ww.slice(0, 5));
    res.errors = ourErr().slice(0, 10);
  } catch (e) { fail++; console.log('FAIL исключение', e.message); }
  fs.writeFileSync(path.join(TMP, `t145-e2e-${PROF}-${WHAT}.json`), JSON.stringify(res, null, 1));
  console.log(`\nt145-e2e ${PROF} ${WHAT}: ${fail ? fail + ' FAIL' : 'всё ok'}  (${path.join(TMP, `t145-e2e-${PROF}-${WHAT}.json`)})`);
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();

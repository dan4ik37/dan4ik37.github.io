// Волны (T-022c, js/engine/waves.js) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): «Мир Денчика», гавань боевой зоны.
// Режимы (первый аргумент):
//   look  — снимки (тихо / ветер / шторм; сверху и с катера), программы шейдеров собрались, страж ничего не выключил, «блин» на месте;
//           сверка видеокарты с JS: та же функция волн (кусок GLSL) считает смещение точек в шейдере → читаем → сравниваем с F.disp
//   perf  — видеокарта: вода (время отрисовки водных сеток, таймер EXT_disjoint_timer_query_webgl2) и кадр целиком, ЦП кадра;
//           профиль: pc (1280×720, «высокая») или phone (412×915, ЦП ×4, «средняя»): node scripts/waves-e2e.cjs perf phone
//   soak  — 10 минут: катер в шторм (газ, повороты, переворот), пловец, смена погоды; ошибки, память, слушатели
// «До»: D37_OVERRIDE=<папка со старыми файлами> (как world-perf.cjs). Снимки — SHOTS (по умолчанию E:\claude-tmp\t022c\shots).
// Запуск из корня сайта: node scripts/waves-e2e.cjs [look|perf|soak] [pc|phone] [минут для soak]
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [MODE = 'look', PROF = 'pc', MIN = '10'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = process.env.SHOTS || path.join(TMP, 't022c', 'shots');
const TAG = process.env.TAG || (process.env.D37_OVERRIDE ? 'before' : 'after');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  if (process.env.D37_OVERRIDE) { const o = path.join(process.env.D37_OVERRIDE, p); if (fs.existsSync(o)) f = o; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); };
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-waves-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', ...(process.env.ANGLE ? [`--use-angle=${process.env.ANGLE}`, '--enable-unsafe-swiftshader'] : []), 'about:blank'],
    { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); const f = path.join(SHOTS, `${TAG}-${PROF}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(data, 'base64')); return f; };
  const phone = PROF === 'phone', Q = phone ? 'mid' : 'high';
  // ═══ «Подземье» (2D): открытый бассейн у точки появления, шторм; снимки; время прохода жидкостей на видеокарте (волны / без волн) ═══
  async function podzem(){
    if (phone) { await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    await send('Page.navigate', { url: BASE + '/#/games/podzem' });
    let up = false;
    for (let i = 0; i < 160 && !up; i++) { await sleep(250); try { up = await ev(`!!(window.GAME_IMPL?.podzem?._test?.G?.U)`, 3000); } catch (e) {} }
    ok(up, 'Подземье открылось');
    const st = await ev(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)), A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test, G = () => T.G;
      const wait = async (fn, ms) => { const t = performance.now(); while (performance.now() - t < ms) { try { if (fn()) return true; } catch (e) {} await sleep(80); } return false; };
      await wait(() => document.querySelector('.pz-menu') && !document.querySelector('.pz-menu').hidden, 25000);
      const w = A.newWorldRecord('Волны', 'podzem-waves'); await A.put('worlds', w); const c = A.newCharRecord('Денчик'); await A.put('chars', c);
      G().U.menu(null); await A.play(w.id, c.id);
      await wait(() => G().state === 'play', 40000);
      T.god(true); G().spawnGrace = 1e9; G().mobs.length = 0; G().noCursor = true;
      try { window.D37Full?.enter(document.getElementById('gamesStage'), { api: false, history: false }); await sleep(400); A.resize(); } catch (e) {}
      const g = G(), TL = A.PZ.TILE, sx = g.W.spawn.x + 40, gy = g.gen.colInfo(sx).h;
      for (let x = sx - 30; x <= sx + 30; x++) { for (let y = gy - 20; y < gy; y++) T.setCell(x, y, 0, 0, 0, 0, 0); for (let y = gy; y < gy + 9; y++) T.setCell(x, y, TL.stone.id, 0, 0); }
      for (let x = sx - 26; x <= sx + 26; x++) for (let y = gy; y < gy + 6; y++) T.setCell(x, y, 0, 0, 0, 255, 1);
      for (let x = sx - 30; x <= sx - 27; x++) for (let y = gy - 1; y < gy; y++) T.setCell(x, y, TL.stone.id, 0, 0);
      const p = g.pl; T.tp(sx - 28 - p.w / 2, gy - 1 - p.h); p.dir = 1; g.W.time = .3;
      await wait(() => g.pending.size === 0, 15000); await sleep(2500);
      return { sx, gy, hq: g.R.hq, wv: !!g.wv };
    })()`, 120000);
    console.log('  Подземье:', JSON.stringify(st));
    if (!process.env.D37_OVERRIDE) ok(st.hq && st.hq.chunk && st.wv, '«красивый» шейдер клеток собрался, волны включены', st);
    for (const [lbl, wx] of [['calm', { wind: 2, windDir: 0, thunder: 0 }], ['storm', { wind: 17, windDir: 0, thunder: 1 }]]) {
      await ev(`(async () => { GAME_IMPL.podzem._test.waves?.(${JSON.stringify(wx)}); await new Promise(r => setTimeout(r, 1500)); return 1; })()`);
      console.log('  снимок', await shot('podzem-' + lbl));
    }
    // герой в воде у гребней: снимок
    await ev(`(async () => { const T = GAME_IMPL.podzem._test, g = T.G, p = g.pl; T.tp(${st.sx} - 8, ${st.gy} - 1.2); await new Promise(r => setTimeout(r, 2500)); return 1; })()`);
    console.log('  снимок', await shot('podzem-swim'));
    // видеокарта: проход жидкостей (R.chunks pass 1) — шторм / без волн; ЦП кадра
    if (phone) await send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const meas = async label => ev(`(async () => {
      const g = GAME_IMPL.podzem._test.G, R = g.R, gl = R.gl || document.querySelector('.pz-gl').getContext('webgl2'), ext = gl && gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const c0 = R.chunks, qs = [], out = []; let run = true;
      R.chunks = function (list, s, pass) { let q = null; if (ext && run && pass === 1) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } const o = c0.call(this, list, s, pass); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); } return o; };
      g.perf.cpu.length = 0;
      await new Promise(r => setTimeout(r, 5000)); run = false;
      for (let k = 0; k < 100 && qs.length; k++) { while (qs.length && gl.getQueryParameter(qs[0], gl.QUERY_RESULT_AVAILABLE)) { const q = qs.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } if (qs.length) await new Promise(r => setTimeout(r, 16)); }
      R.chunks = c0;
      out.sort((a, b) => a - b); const cpu = g.perf.cpu.slice().sort((a, b) => a - b);
      const med = a => a.length ? +a[Math.floor(a.length / 2)].toFixed(4) : null;
      return { label: ${JSON.stringify(label)}, ext: !!ext, liquidsGpuMs: med(out), n: out.length, cpuMs: med(cpu), dynMs: g.perf.dynMs && +g.perf.dynMs.toFixed(3), renderMs: g.perf.renderMs && +g.perf.renderMs.toFixed(3), H: g.wv ? +g.wv.F.H.toFixed(3) : null, swim: !!g.pl.inLq };
    })()`, 60000);
    if (process.env.PROF) {   // профиль ЦП 5 с: самые дорогие функции (собственное время)
      await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start');
      await sleep(5000);
      const { profile: pr } = await send('Profiler.stop');
      const self = new Map(), dt = pr.timeDeltas || [], byId = new Map(pr.nodes.map(n => [n.id, n]));
      for (let i = 0; i < pr.samples.length; i++) { const n = byId.get(pr.samples[i]), cf = n.callFrame, k = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop().split('?')[0]}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0) / 1000); }
      const tot = [...self.values()].reduce((s, v) => s + v, 0);
      const WF = /^(waveK|skyK|surfAt|waveBob|wvRows|surfCell|waveSpray|wavesStep|wavesSync|wavesWeather|F\.at1|F\.vel1|W\.sync1|W\.clock|at1|vel1|sync1|clock|smoothK) /;
      const wsum = [...self.entries()].filter(([k]) => WF.test(k)).reduce((s, [, v]) => s + v, 0), js = [...self.entries()].filter(([k]) => !/^\((program|idle|garbage)/.test(k)).reduce((s, [, v]) => s + v, 0);
      console.log('  профиль ЦП (мс за 5 с):', [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' | '), '· всего', tot.toFixed(0), '· JS', js.toFixed(0), '· волны (JS)', wsum.toFixed(1));
      fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} podzem-prof ${TAG} ${PROF} waves ${wsum.toFixed(1)} ms / js ${js.toFixed(0)} ms / 5 s\n`);
    }
    const a = await meas(process.env.D37_OVERRIDE ? 'before' : 'storm');
    console.log(`  ЗАМЕР Подземье ${TAG} ${PROF}:`, JSON.stringify(a));
    fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} podzem ${TAG} ${PROF} ${JSON.stringify(a)}\n`);
    if (!process.env.D37_OVERRIDE) {
      await ev(`(async () => { const T = GAME_IMPL.podzem._test, g = T.G; g.wv.F.gain = 0; g.wv.F.weather({}); g.wv.force = { wind: 0 }; await new Promise(r => setTimeout(r, 600)); return 1; })()`);
      const b = await meas('off');
      console.log(`  ЗАМЕР Подземье ${TAG}-off ${PROF}:`, JSON.stringify(b));
      fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} podzem ${TAG}-off ${PROF} ${JSON.stringify(b)}\n`);
    }
    if (phone) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const bad = logs.filter(l => /Шейдер|shader|exception|TypeError|ReferenceError/i.test(l) && !/X3595/.test(l));
    ok(!bad.length, 'Подземье: в консоли — без ошибок', bad.slice(0, 6));
  }
  try {
    await send('Page.enable'); await send('Runtime.enable');
    if (phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q, view: 'third' }), d37_gfx: Q, d37_world_2d: '0' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    if (MODE === 'podzem') { await podzem(); return; }
    await send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
    ok(up, 'мир открылся');
    if (!up) throw new Error('мир не открылся');
    // гавань боевой зоны: возраст — взрослый (вход 12+), полдень, зона построена, у причала
    const prep = await ev(`(async () => {
      const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
      const S = GAME_IMPL.world._test.state(), z = S.zones, zs = z.zoneState('war');
      try { window.D37Full?.enter(document.querySelector('#gamesStage'), { api: false, history: false }); } catch (e) {}
      await new Promise(r => setTimeout(r, 400)); S.R.resize();
      S.fixedTime = 13; S.R.setLighting({ time: 13 });
      S.P.place(-361, MirZones.terrain(-361, 404) + .3, 404, -Math.PI / 2);
      if (!zs.ready) await z.buildNow(zs);
      if (!zs.shown) z.setShown?.(zs, true);
      await new Promise(r => setTimeout(r, 2500));
      const W = D37E.waves, V = z.veh;
      return { waves: !!W, enabled: W?.enabled, mats: W ? W.mats.size : 0, patches: W ? W.patches.size : 0, sea: !!S.waves?.F.ocean, grid: !!S.waves?.F.ocean?.grid, boats: V ? [...V.list.values()].filter(v => v.kind === 'boat').map(v => v.id) : [], q: S.R.q };
    })()`, 240000);
    console.log('  подготовка:', JSON.stringify(prep));
    const isAfter = !process.env.D37_OVERRIDE;
    if (isAfter) ok(prep.waves && prep.enabled && prep.mats >= 3 && prep.patches === 1 && prep.grid, 'волны включены: материалы воды с волнами, «блин» моря, сетка глубины', prep);

    // камера смотрит на гавань с причала; погода волн — своя (force) или как у всех
    const setView = (wx, label) => ev(`(async () => {
      const S = GAME_IMPL.world._test.state();
      S.waves?.force(${JSON.stringify(wx)});
      S.rig.mode = 'third'; S.rig.dist = 14; S.rig.pitch = .22; S.rig.yaw = Math.PI / 2 - .25;
      await new Promise(r => setTimeout(r, 1800));
      return 'ok';
    })()`, 60000);

    if (MODE === 'look' || MODE === 'perf') {
      // сверка: видеокарта считает смещение точек тем же куском GLSL (waves.js GLSL.pars), что и вода; JS — F.disp
      if (isAfter) {
        const gpu = await ev(`(() => {
          const S = GAME_IMPL.world._test.state(), R = S.R, T = R.T, W = D37E.waves, F = S.waves.F.ocean;
          F.weather({ wind: 17, windDir: 1.2, thunder: 1 });
          const t = W.time(), N = 64, pts = new Float32Array(N * 3);
          const ox = Math.round(R.camera.position.x / 256) * 256, oz = Math.round(R.camera.position.z / 256) * 256;
          W.uniforms(F); W.sync(F, t, ox, oz); W.bindGrid(F);
          for (let i = 0; i < N; i++) { pts[i * 3] = -480 + (i % 8) * 13.7; pts[i * 3 + 2] = 300 + Math.floor(i / 8) * 11.3; }
          const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pts, 3));
          const idx = new Float32Array(N); for (let i = 0; i < N; i++) idx[i] = i; g.setAttribute('aI', new T.BufferAttribute(idx, 1));
          const rt = new T.WebGLRenderTarget(N, 1, { type: T.FloatType, format: T.RGBAFormat, depthBuffer: false });
          const m = new T.ShaderMaterial({ uniforms: Object.assign({}, F.U), defines: { D37_GW: 1, D37_GWG: 1 },
            vertexShader: W.GLSL.pars() + '\\nattribute float aI; varying vec4 vO;\\nvoid main(){ vec3 n; float j; vec3 d = d37Gerst( position.xz, -1.0, n, j ); vO = vec4( d, j ); gl_PointSize = 1.0; gl_Position = vec4( ( aI + 0.5 ) / ${64}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0 ); }',
            fragmentShader: 'varying vec4 vO; void main(){ gl_FragColor = vO; }' });
          const pt = new T.Points(g, m), sc = new T.Scene(); pt.frustumCulled = false; sc.add(pt);
          const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
          const prev = R.r.getRenderTarget(); R.r.setRenderTarget(rt); R.r.setClearColor(0, 0); R.r.clear(); R.r.render(sc, cam); R.r.setRenderTarget(prev);
          const out = new Float32Array(N * 4); R.r.readRenderTargetPixels(rt, 0, 0, N, 1, out);
          let worst = 0, worstJ = 0; const o = {};
          for (let i = 0; i < N; i++) {
            F.disp(pts[i * 3], pts[i * 3 + 2], t, o);
            worst = Math.max(worst, Math.abs(out[i * 4] - o.x), Math.abs(out[i * 4 + 1] - o.y), Math.abs(out[i * 4 + 2] - o.z));
            worstJ = Math.max(worstJ, Math.abs(out[i * 4 + 3] - o.jac));
          }
          // и высота в точке мира (Ньютон в JS) — равна смещённой видеокартой точке
          let wh = 0; const s = {};
          for (let i = 0; i < N; i++) { const x = pts[i * 3] + out[i * 4], z = pts[i * 3 + 2] + out[i * 4 + 2]; F.sample(x, z, t, s); wh = Math.max(wh, Math.abs(s.y - out[i * 4 + 1])); }
          rt.dispose(); g.dispose(); m.dispose();
          return { worst: +worst.toExponential(2), worstJ: +worstJ.toExponential(2), heightVsGpu: +wh.toExponential(2), H: +F.H.toFixed(2), sampleY: [...out].filter((v, i) => i % 4 === 1).slice(0, 4).map(v => +v.toFixed(3)) };
        })()`, 60000);
        console.log('  видеокарта против JS:', JSON.stringify(gpu));
        ok(gpu.worst < 2e-3 && gpu.worstJ < 2e-3 && gpu.heightVsGpu < 3e-3, 'та же волна: видеокарта (GLSL) и JS (смещение, «сжатие», высота в точке) — разница < 2–3 мм', gpu);
      }
    }

    if (MODE === 'look') {
      for (const [lbl, wx] of [['calm', { wind: 3, windDir: 1.2, thunder: 0 }], ['wind', { wind: 11, windDir: 1.2, thunder: 0 }], ['storm', { wind: 17, windDir: 1.2, thunder: 1 }]]) {
        await setView(wx, lbl);
        console.log('  снимок', lbl, await shot('harbour-' + lbl));
      }
      // с катера: сесть, проехать в шторм, снимок; и сверху — гребни и пена
      const ride = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones, V = z.veh, v = V.list.get('w_boat1'), VE = D37E.vehicle;
        if (!v) return { no: true };
        V._.enter(v, 0);
        const orig = VE.input; VE.input = (C, vv, out) => Object.assign(out, { thr: .8, steer: .15, up: 0, boost: 0, brake: 0, on: true });
        const y0 = [], p0 = [], r0 = [];
        for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 100)); y0.push(v.y); p0.push(v.pitch); r0.push(v.roll); }
        VE.input = orig;
        const span = a => +(Math.max(...a) - Math.min(...a)).toFixed(3);
        return { y: span(y0), pitch: span(p0), roll: span(r0), wy: v.wy !== undefined, x: +v.x.toFixed(1), z: +v.z.toFixed(1), local: v.local };
      })()`, 60000);
      console.log('  катер в шторм:', JSON.stringify(ride));
      if (isAfter) ok(ride.wy && ride.y > .1 && ride.pitch > .02 && ride.roll > .02, 'катер качается на волнах (подъём, тангаж, крен)', ride);
      console.log('  снимок', await shot('boat-storm'));
      await ev(`(async () => { const S = GAME_IMPL.world._test.state(); S.rig.pitch = 1.1; S.rig.dist = 22; await new Promise(r => setTimeout(r, 1200)); return 1; })()`);
      console.log('  снимок', await shot('boat-storm-top'));
      // программы и страж
      const st = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), R = S.R, G = R.guard;
        let rep = null; if (G) { G.check(x => { rep = x; }); for (let i = 0; i < 80 && !rep; i++) await new Promise(r => setTimeout(r, 100)); }
        const progs = R.r.info.programs.map(p => ({ name: p.name, ok: !p.diagnostics || p.diagnostics.runnable !== false, log: p.diagnostics ? (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || p.diagnostics.programLog || '').slice(0, 200) : '' }));
        const water = []; R.scene.traverse(o => { const m = o.material; if (o.isMesh && m?.userData?.water && o.visible) water.push({ name: o.name || m.name, defs: Object.keys(m.defines || {}).filter(k => k.startsWith('D37_GW')).join(','), verts: o.geometry.attributes.position.count }); });
        return { progs: progs.length, failed: progs.filter(p => !p.ok), withLog: progs.filter(p => p.log).slice(0, 4), off: D37E.gfxGuardInfo().off, rep: rep && { log: rep.log }, water, calls: R.stats?.calls };
      })()`, 60000);
      console.log('  шейдеры:', JSON.stringify(st).slice(0, 900));
      ok(!st.failed.length, 'все программы собрались', st.failed);
      ok(!st.off.length, 'страж графики ничего не выключил', st.off);
    }

    if (MODE === 'perf') {
      await setView({ wind: 11, windDir: 1.2, thunder: 0 }, 'perf');
      // сцена A — стоим на набережной, камера неподвижно смотрит на гавань (цена картинки); B — с катера носом в море (всё вместе)
      const sceneA = () => ev(`(async () => { const S = GAME_IMPL.world._test.state(), V = S.zones.veh; if (V.inVeh()) V._.exit({ force: true }); S.P.place(-361, MirZones.terrain(-361, 330) + .3, 330, -Math.PI / 2); S.rig.yaw = Math.PI / 2; S.rig.pitch = .2; S.rig.dist = 12; await new Promise(r => setTimeout(r, 1500)); return 1; })()`);
      const sceneB = () => ev(`(async () => { const S = GAME_IMPL.world._test.state(), V = S.zones.veh, v = V.list.get('w_boat1'); if (v && !V.inVeh()) { V._.enter(v, 0); v.x = -450; v.z = 330; v.yaw = -Math.PI / 2; } S.rig.yaw = Math.PI / 2; S.rig.pitch = .2; await new Promise(r => setTimeout(r, 1500)); return 1; })()`);
      await sceneA();
      if (phone) await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const measure = () => ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), R = S.R, gl = R.r.getContext(), ext = R.r.capabilities.isWebGL2 && gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const waters = []; R.scene.traverse(o => { if (o.isMesh && o.material?.userData?.water) waters.push(o); });
        const qw = [], qf = [], gw = [], gf = [], cpu = []; let cur = null, run = true, curW = 0;
        // время воды: запрос вокруг каждой водной сетки (кадр — отдельно, они не вложены: кадр меряем в другом кадре)
        let measureWater = true;
        for (const o of waters) { o.onBeforeRender = () => { if (ext && run && measureWater && !cur) { cur = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, cur); } }; o.onAfterRender = () => { if (cur) { gl.endQuery(ext.TIME_ELAPSED_EXT); qw.push([curW, cur]); cur = null; } }; }
        const ST = R.stats, st0 = { f: ST.frames, c: ST.sumCpu, r: ST.sumR };   // ЦП кадра целиком (логика + отрисовка), как R.stats
        // волны в ЦП: шаг лодок (свой — физика, чужие/стоящие — качка) и фазы у камеры — отдельным счётом
        const VE = D37E.vehicle, B = VE.KINDS.boat, W = D37E.waves || {}, wcpu = { step: 0, pose: 0, sync: 0, n: 0 };
        const st1 = B.step, po1 = B.pose, sy1 = W.sync;
        B.step = function (...a) { const t = performance.now(); const o = st1.apply(this, a); wcpu.step += performance.now() - t; return o; };
        if (po1) B.pose = function (...a) { const t = performance.now(); const o = po1.apply(this, a); wcpu.pose += performance.now() - t; return o; };
        if (sy1) W.sync = function (...a) { const t = performance.now(); const o = sy1.apply(this, a); wcpu.sync += performance.now() - t; return o; };
        const r0 = R.render; let n = 0;
        R.render = function (...a) { n++; measureWater = n % 2 === 0; curW = n; let q = null; if (ext && run && !measureWater) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } const t0 = performance.now(); const o = r0.apply(this, a); cpu.push(performance.now() - t0); if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qf.push(q); } return o; };
        await new Promise(r => setTimeout(r, 6000));
        run = false;
        const take = (list, out, pair) => { for (let k = 0; k < 200 && list.length; k++) { const it = list[0], q = pair ? it[1] : it; if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break; list.shift(); if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) out.push(pair ? [it[0], gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6] : gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); } };
        for (let k = 0; k < 120 && (qw.length || qf.length); k++) { take(qw, gw, true); take(qf, gf, false); if (qw.length || qf.length) await new Promise(r => setTimeout(r, 16)); }
        R.render = r0; for (const o of waters) { o.onBeforeRender = () => {}; o.onAfterRender = () => {}; }
        B.step = st1; if (po1) B.pose = po1; if (sy1) W.sync = sy1;
        const nf = Math.max(1, ST.frames - st0.f), frameCpu = +((ST.sumCpu - st0.c) / nf).toFixed(3), waveCpu = +((wcpu.step + wcpu.pose + wcpu.sync) / nf).toFixed(4);
        const byF = new Map(); for (const [f, ms] of gw) byF.set(f, (byF.get(f) || 0) + ms);
        const wf = [...byF.values()].sort((a, b) => a - b), ff = gf.slice().sort((a, b) => a - b), cf = cpu.slice().sort((a, b) => a - b);
        const med = a => a.length ? +a[Math.floor(a.length / 2)].toFixed(3) : null, avg = a => a.length ? +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3) : null;
        return { ext: !!ext, frames: n, waterMs: { med: med(wf), avg: avg(wf), n: wf.length }, frameGpuMs: { med: med(ff), avg: avg(ff), n: ff.length }, cpuMs: { med: med(cf), avg: avg(cf) },
          frameCpu, boatsCpuPerFrame: waveCpu, boatStepMs: +(wcpu.step / nf).toFixed(4), poseMs: +(wcpu.pose / nf).toFixed(4), syncMs: +(wcpu.sync / nf).toFixed(4),
          water: waters.filter(o => o.visible).map(o => (o.name || o.material.name) + ':' + o.geometry.attributes.position.count), q: R.q, calls: R.stats?.calls, tris: R.stats?.tris };
      })()`, 120000);
      const run = async tag => {
        for (const [sc, go] of [['A-набережная', sceneA], ['B-катер', sceneB]]) {
          await go();
          const r = await measure();
          console.log(`  ЗАМЕР ${tag} ${PROF} ${sc}:`, JSON.stringify(r));
          fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} ${tag} ${PROF} ${sc} ${JSON.stringify(r)}\n`);
        }
      };
      if (isAfter && process.env.AB) {   // A/B в одной вкладке без пересборки: «блин» ↔ обычная сетка моря и волны в физике ↔ нет (4 раза)
        const tog = on => ev(`(async () => { const W = D37E.waves; for (const P of W.patches) P.show(${on}); for (const F of W.fields) { F.gain = ${on ? 1 : 0}; F.weather({ wind: 11, windDir: 1.2 }); } await new Promise(r => setTimeout(r, 1200)); return 1; })()`);
        for (const [sc, go] of [['A-набережная', sceneA], ['B-катер', sceneB]]) {
          await go();
          const acc = { on: [], off: [] };
          for (let k = 0; k < 4; k++) for (const on of [true, false]) { await tog(on); const r = await measure(); acc[on ? 'on' : 'off'].push(r); }
          const mean = (L, f) => +(L.reduce((s, r) => s + f(r), 0) / L.length).toFixed(3);
          const sum = L => ({ waterGpu: mean(L, r => r.waterMs.med), frameGpu: mean(L, r => r.frameGpuMs.med), frameCpu: mean(L, r => r.frameCpu), renderCpu: mean(L, r => r.cpuMs.med), boats: mean(L, r => r.boatsCpuPerFrame) });
          const line = `A/B ${PROF} ${sc}: волны ${JSON.stringify(sum(acc.on))} · без волн ${JSON.stringify(sum(acc.off))}`;
          console.log('  ЗАМЕР', line); fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} ${line}\n`);
        }
        await tog(true);
      } else await run(TAG);
      if (isAfter && !process.env.AB) {   // тот же мир без волн (как выключает страж): обычная сетка моря, вода без кусков волн
        await ev(`(async () => { D37E.waves.disable(); await new Promise(r => setTimeout(r, 2500)); return 1; })()`);
        await run(TAG + '-off');
      }
      if (phone) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }

    if (MODE === 'reopen') {   // мир закрыть и открыть N раз (по умолчанию 20): поля, «блины», материалы волн и память не растут
      const n = Math.max(2, +MIN || 20), cnt = () => ev(`(() => { if (window.gc) gc(); const W = D37E.waves || { fields: new Set(), patches: new Set(), mats: new Set() }; return { fields: W.fields.size, patches: W.patches.size, mats: W.mats.size, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0, pre: GAME_IMPL.world._test.state()?.R?.preRender?.length || 0 }; })()`);
      const first = await cnt(), hist = [first];
      for (let k = 0; k < n; k++) {
        await ev(`location.hash = '#/home'`); await sleep(900);
        await ev(`location.hash = '#/games/world'`);
        let ok2 = false; for (let i = 0; i < 120 && !ok2; i++) { await sleep(500); try { ok2 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
        await sleep(1500);
        if (k === 1 || k === n - 1 || k % 5 === 4) hist.push(await cnt());
      }
      const last = hist[hist.length - 1];
      console.log('  закрыть/открыть:', JSON.stringify(hist));
      ok(last.fields === first.fields && last.patches === first.patches && last.mats <= first.mats && last.pre === first.pre, `${n} раз закрыть и открыть мир: поля, «блины», материалы волн и кадровые крючки не копятся`, { first, last });
      ok(last.heapMB - hist[2].heapMB < 25, `${n} раз: память JS не растёт (после 2-го открытия)`, hist.map(h => h.heapMB));
      fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} reopen ${PROF} ${n} ${JSON.stringify(hist)}\n`);
    }
    if (MODE === 'soak') {
      const minutes = Math.max(1, +MIN || 10);
      const r = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones, V = z.veh, v = V.list.get('w_boat1'), VE = D37E.vehicle, W = D37E.waves;
        const err = []; const onErr = e => err.push(String(e.message || e).slice(0, 200)); window.addEventListener('error', onErr);
        const mem0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
        const orig = VE.input; let phase = 0, caps = 0, slams = 0, swims = 0, enters = 0;
        const oc = V._.env.onCapsize, os = V._.env.onSlam;
        V._.env.onCapsize = vv => { caps++; oc(vv); }; V._.env.onSlam = (vv, k) => { slams++; os(vv, k); };
        VE.input = (C, vv, out) => { const t = performance.now() / 1000; return Object.assign(out, { thr: phase % 3 === 2 ? .3 : 1, steer: phase % 3 === 1 ? Math.sin(t * .7) : Math.sin(t * .2) * .4, up: 0, boost: phase % 4 === 0 ? 1 : 0, brake: 0, on: true }); };
        const t0 = performance.now(), T = ${minutes} * 60000; let last = 0, wx = 0;
        const WX = [{ wind: 17, windDir: 1.2, thunder: 1 }, { wind: 8, windDir: 2.4, thunder: 0 }, { wind: 14, windDir: .3, thunder: .5 }, null];
        while (performance.now() - t0 < T) {
          await new Promise(r => setTimeout(r, 500));
          const el = performance.now() - t0;
          if (el - last > 20000) { last = el; phase++; S.waves.force(WX[wx++ % WX.length]); }
          if (!V.inVeh() && v && !v.capsized) { V._.enter(v, 0); enters++; }
          if (S.P.swim) swims++;
          if (Math.hypot(v.x - (-430), v.z - 300) > 120 && V.inVeh()) { V._.exit({ force: true }); V._.home(v); }
        }
        VE.input = orig; V._.env.onCapsize = oc; V._.env.onSlam = os; window.removeEventListener('error', onErr);
        if (window.gc) window.gc();
        await new Promise(r => setTimeout(r, 1500));
        const mem1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
        return { minutes: ${minutes}, err, caps, slams, swims, enters, memMB: +((mem1 - mem0) / 1048576).toFixed(1), mats: W.mats.size, patches: W.patches.size, fields: W.fields.size, off: D37E.gfxGuardInfo().off, fps: S.R.stats?.fps };
      })()`, (minutes + 3) * 60000);
      console.log('  ПРОГОН:', JSON.stringify(r));
      ok(r.err.length === 0, `${r.minutes} мин: без ошибок`, r.err.slice(0, 4));
      ok(!r.off.length, 'страж ничего не выключил', r.off);
      ok(r.slams > 0, 'удары о волну были', r.slams);
      fs.appendFileSync(path.join(TMP, 't022c', 'perf.txt'), `${new Date().toISOString()} soak ${PROF} ${JSON.stringify(r)}\n`);
    }
    // X3595 (Direct3D: выборка текстуры в цикле постобработки) — было и до волн (CLAUDE.md, «Погода»): не считаем
    const bad = logs.filter(l => /WebGLProgram|Shader Error|страж графики|exception|TypeError|ReferenceError/i.test(l) && !/X3595/.test(l));
    ok(!bad.length, 'в консоли — без ошибок', bad.slice(0, 6));
  } catch (e) {
    fail++; console.log('ОШИБКА', e.message);
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
  }
  finally { try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(fail ? `waves-e2e: ${fail} ошибок` : 'waves-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

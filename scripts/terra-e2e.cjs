// Terrain W1 (T-111) in REAL headless Chrome (DevTools Protocol, no npm): the hidden page /play/terra (#/games/terra).
// Modes:  node scripts/terra-e2e.cjs perf            — load time, walking 20 s, flying fast (100 m/s) 20 s: frame CPU (avg, p95, worst),
//                                                     FPS, long frames, worker ms per block, main-thread ms per mesh upload; wasm, then JS
//                                                     fallback (localStorage d37_terra_wasm = 0)
//         node scripts/terra-e2e.cjs leak [20]       — open/close the page N times (in-page navigation): heap after GC, canvases,
//                                                     workers, three.js objects
//         node scripts/terra-e2e.cjs soak [10]       — N minutes: walk, fly, dig, fill at random; errors and heap per minute
//         node scripts/terra-e2e.cjs shots           — screenshots (walk, fly, crater) into D37_TMP/t111/shots
// Profiles: phone (default) — 412 × 915 × 2, CPU ×4 (RATE), quality "mid" (Q); PC=1 — 1280 × 720, no throttle, "high".
// NOTE: Chrome's CPU throttling does not slow workers down — worker build times are desktop numbers (×4 for a phone estimate).
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, '..');
const [MODE = 'perf', ARG = ''] = process.argv.slice(2);
const PC = !!process.env.PC, RATE = PC ? 1 : +(process.env.RATE || 4), Q = process.env.Q || (PC ? 'high' : 'mid');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, process.env.D37_OUT || 't111');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
const T = 'GAME_IMPL.terra._test';
const SAMPLER = `(() => {
  if (window.__trS) return;
  const S = window.__trS = { on: false, f: [] };
  const tick = t => { requestAnimationFrame(tick); if (!S.on) return; const st = window.GAME_IMPL?.terra?._test?.S; if (!st?.R) return;
    const r = st.R.stats; S.f.push([t, r.cpuFrame || 0, r.calls || 0, r.tris || 0, st.TM ? st.TM.stats().lastFrameMs : 0]); };
  requestAnimationFrame(tick);
})()`;
const summary = f => {
  if (f.length < 3) return { frames: f.length };
  const dts = []; for (let i = 1; i < f.length; i++) dts.push(f[i][0] - f[i - 1][0]);
  const cpu = f.map(x => x[1]).sort((a, b) => a - b), up = f.map(x => x[4]).sort((a, b) => a - b);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length, p = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { frames: f.length, fps: +(1000 / avg(dts)).toFixed(1), long50: dts.filter(d => d > 50).length, worstDt: Math.round(Math.max(...dts)),
    cpuAvg: +avg(cpu).toFixed(2), cpuP95: +p(cpu, .95).toFixed(2), cpuMax: +cpu[cpu.length - 1].toFixed(1),
    uploadFrameAvg: +avg(up).toFixed(3), uploadFrameMax: +up[up.length - 1].toFixed(2), callsAvg: Math.round(avg(f.map(x => x[2]))), trisAvg: Math.round(avg(f.map(x => x[3]))) };
};
(async () => {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-terra-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome did not start'); proc.kill(); server.close(); process.exit(1); }
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
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 }); fs.writeFileSync(path.join(OUT, 'shots', name + '.jpg'), Buffer.from(data, 'base64')); };
  const countObjs = async () => {
    const o = {};
    for (const [k, proto] of [['renderers', 'THREE.WebGLRenderer.prototype'], ['geometries', 'THREE.BufferGeometry.prototype'], ['materials', 'THREE.Material.prototype']]) {
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
  const workers = async () => { const t = await send('Target.getTargets'); return t.targetInfos.filter(x => x.type === 'worker' || x.type === 'dedicated_worker').length; };
  const heap = () => ev(`+(performance.memory.usedJSHeapSize / 1048576).toFixed(1)`);
  const stats = () => ev(`${T}.stats()`);
  const measure = async during => {
    await ev(`(window.__trS.f = [], window.__trS.on = true)`);
    await during();
    return summary(await ev(`(() => { window.__trS.on = false; const f = window.__trS.f; window.__trS.f = []; return f; })()`));
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
    const setLs = async extra => send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries({ ...ls, ...extra }).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    const ready = async () => { let ok = false; for (let i = 0; i < 160 && !ok; i++) { await sleep(250); try { ok = await ev(`!!(${T}.S?.TS)`, 5000); } catch (e) {} } if (!ok) throw new Error('terra page did not open'); };
    const open = async () => { await send('Page.navigate', { url: BASE + '/#/games/terra' }); await ready(); await ev(SAMPLER); };
    const go = async hash => ev(`(window.D37Route?.go ? D37Route.go(${JSON.stringify(hash)}) : (location.hash = ${JSON.stringify(hash)}), 1)`);
    const throttle = () => RATE > 1 ? send('Emulation.setCPUThrottlingRate', { rate: RATE }) : null;
    // wait until the ring around the player is loaded: queue empty and nothing in flight (max ms)
    const settle = async (ms = 60000) => { const t0 = Date.now(); let s; do { await sleep(400); s = await stats(); } while (Date.now() - t0 < ms && (s.ts.queued + s.ts.inflight + s.ts.ready > 0 || s.tm.live < 8)); return { ms: Date.now() - t0, live: s.tm.live, built: s.ts.built }; };
    const walk = async ms => { await ev(`${T}.fly(false)`); await ev(`${T}.move(0, 1, true)`); await sleep(ms); await ev(`${T}.move(0, 0, false)`); };
    const flyFast = async ms => { await ev(`${T}.fly(true)`); await ev(`${T}.look(0.6, -0.12)`); await ev(`${T}.move(0, 1, true)`); await sleep(ms); await ev(`${T}.move(0, 0, false)`); };
    const pass = async label => {
      await open(); await throttle();
      const t0 = Date.now(), first = await settle(90000);
      const r = { label, load: first };
      const s0 = await stats();
      r.kind = s0.ts.kinds;
      r.idle = await measure(() => sleep(4000));
      const sw = await stats();
      r.walk = await measure(() => walk(20000));
      const s1 = await stats();
      r.walkState = await ev(`${T}.state()`);
      r.fly = await measure(() => flyFast(20000));
      const s2 = await stats();
      r.flyBacklog = { queued: s2.ts.queued, inflight: s2.ts.inflight, ready: s2.ts.ready, live: s2.tm.live };
      const dB = (a, b) => ({ built: b.ts.built - a.ts.built, buildAvg: +((b.ts.buildMs - a.ts.buildMs) / Math.max(1, b.ts.built - a.ts.built)).toFixed(2),
        uploads: b.tm.uploads - a.tm.uploads, uploadAvg: +((b.tm.upMs - a.tm.upMs) / Math.max(1, b.tm.uploads - a.tm.uploads)).toFixed(3) });
      r.walkBlocks = dB(sw, s1); r.flyBlocks = dB(s1, s2);
      r.totals = { buildMax: +s2.ts.buildMax.toFixed(1), uploadMax: +s2.tm.upMax.toFixed(2), gpuMB: s2.tm.mb, geos: s2.tm.created, reused: s2.tm.reused, rebases: (await ev(`${T}.state()`)).rebases, fallbacks: s2.ts.fallbacks, errors: s2.ts.errors, wasmErr: s2.ts.wasmErr || '' };
      r.heap = await heap();
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      console.log(label, JSON.stringify(r));
      return r;
    };
    if (MODE === 'perf') {
      await setLs({});
      out.wasm = await pass('wasm');
      await shot((PC ? 'pc' : 'phone') + '-fly');
      await setLs({ d37_terra_wasm: '0' });
      out.js = await pass('js');
    } else if (MODE === 'shots') {
      await setLs({});
      await open(); await settle(60000);
      await shot('walk-start');
      await ev(`${T}.look(2.2)`); await sleep(1500); await shot('walk-turn');
      for (let i = 0; i < 6; i++) { await ev(`${T}.dig()`); await sleep(350); }
      await settle(20000); await sleep(800); await shot('crater');
      for (let i = 0; i < 4; i++) { await ev(`${T}.fill()`); await sleep(350); }
      await settle(20000); await sleep(800); await shot('filled');
      await ev(`${T}.fly(true)`); await ev(`${T}.vert(1)`); await sleep(3000); await ev(`${T}.vert(0)`); await ev(`${T}.look(0.4, -0.35)`);
      await settle(30000); await sleep(1000); await shot('fly-high');
      out.state = await ev(`${T}.state()`); out.stats = await stats();
    } else if (MODE === 'leak') {
      const n = +ARG || 20;
      await setLs({});
      await open(); await settle(60000); await go('#/games'); await sleep(1500);
      await ev('window.gc && window.gc()'); await sleep(300);
      const base = { heap: await heap(), canvases: await ev(`document.querySelectorAll('canvas').length`), workers: await workers(), ...(await countObjs()) };
      out.base = base; out.cycles = []; console.log('  base (after 1st close)', JSON.stringify(base));
      for (let i = 0; i < n; i++) {
        await go('#/games/terra'); await ready(); await sleep(2500);
        await ev(`${T}.move(0.3, 1, true)`); await sleep(800); await ev(`${T}.dig()`); await sleep(600); await ev(`${T}.move(0, 0, false)`);
        await go('#/games'); await sleep(900);
        if (i % 5 === 4) {
          await ev('window.gc && window.gc()'); await sleep(400);
          const c = { i: i + 1, heap: await heap(), canvases: await ev(`document.querySelectorAll('canvas').length`), workers: await workers(), ...(await countObjs()) };
          out.cycles.push(c); console.log('  ', JSON.stringify(c));
        }
      }
    } else if (MODE === 'soak') {
      const min = +ARG || 10;
      await setLs({});
      await open(); await throttle(); await settle(90000);
      out.minutes = [];
      const t0 = Date.now(); let k = 0, digs = 0;
      while (Date.now() - t0 < min * 60000) {
        const r = k++ % 10;
        if (r < 5) { await ev(`${T}.fly(false)`); await ev(`${T}.look(${(Math.random() * 6.28).toFixed(2)})`); await ev(`${T}.move(${(Math.random() - .5).toFixed(2)}, 1, ${Math.random() < .5})`); await sleep(2500); }
        else if (r < 8) { await ev(`${T}.move(0, 0, false)`); for (let j = 0; j < 4; j++) { await ev(Math.random() < .6 ? `${T}.dig()` : `${T}.fill()`); digs++; await sleep(300); } }
        else { await ev(`${T}.fly(true)`); await ev(`${T}.look(${(Math.random() * 6.28).toFixed(2)}, -0.1)`); await ev(`${T}.move(0, 1, true)`); await sleep(4000); await ev(`${T}.move(0, 0, false)`); }
        const m = Math.floor((Date.now() - t0) / 60000);
        if (m > out.minutes.length - 1 && m >= 1 && out.minutes.length < m) {
          await ev('window.gc && window.gc()');
          const s = await stats();
          out.minutes.push({ min: m, heap: await heap(), errors: logs.length, live: s.tm.live, gpuMB: s.tm.mb, edits: s.ts.edits, built: s.ts.built, kinds: s.ts.kinds, fallbacks: s.ts.fallbacks, tsErr: s.ts.errors });
          console.log('  ', JSON.stringify(out.minutes[out.minutes.length - 1]));
        }
      }
      out.digs = digs; out.state = await ev(`${T}.state()`);
    }
  } catch (e) { failed = true; console.log('ERROR', e.message); out.error = e.message; }
  out.logs = logs.slice(0, 40);
  out.errorCount = logs.filter(l => !/X3595/.test(l)).length;
  const file = path.join(OUT, `terra-${MODE}-${PC ? 'pc' : 'phone'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('written:', file, '· log errors/warnings:', out.errorCount);
  if (out.errorCount) console.log(out.logs.slice(0, 12).join('\n'));
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(failed ? 1 : 0); }, 800);
})();

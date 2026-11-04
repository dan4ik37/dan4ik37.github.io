// C-002 in REAL headless Chrome (DevTools Protocol, no npm): the shared core d37-core on the site through js/engine/core-world.js.
// Modes:  node scripts/core-world-e2e.cjs load        — home page: 0 bytes of the core, startup JS (gzip) and LCP / CLS before (main
//                                                      checkout, MAIN_DIR) vs after (this checkout); core load + init in the page (in-thread
//                                                      and Worker, 5× each), fallbacks in the browser, 30 / 60 / 144 FPS → one hash (the same
//                                                      hash as node scripts/core-world-test.cjs), «Новая земля» with CORE_WASM on (wasm in a
//                                                      Worker, the debug line) and off (no core request, no core worker)
//         node scripts/core-world-e2e.cjs leak [20]   — «Новая земля» opened and closed N times: heap after GC, workers, core counters flat
//         node scripts/core-world-e2e.cjs soak [15]   — N minutes walking (≥ 2 km) with digs: 0 errors, core ticks, minute-10 vs minute-1
//                                                      (frame CPU, the core's main-thread cost), wasm memory pages flat
// Profiles: phone (default) — 412 × 915 × 2, CPU ×4 (RATE), quality "mid"; PC=1 — 1280 × 720, no throttle, "high".
// NOTE: Chrome's CPU throttling does not slow workers down — the core worker's own times are desktop numbers (×4 for a phone estimate).
// Heavy job: node E:\d37-core\scripts\heavy-lock.mjs run --session site/<agent> --job "core-world e2e <mode>" --min 15 -- node scripts/core-world-e2e.cjs <mode>
'use strict';
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), { spawn } = require('child_process');
const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, '..');
const MAIN_DIR = process.env.MAIN_DIR ? path.resolve(process.env.MAIN_DIR) : '';
const [MODE = 'load', ARG = ''] = process.argv.slice(2);
const PC = !!process.env.PC, RATE = PC ? 1 : +(process.env.RATE || 4), Q = process.env.Q || (PC ? 'high' : 'mid');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, process.env.D37_OUT || 'eng/c002');
const DL = path.join(os.homedir(), 'Downloads');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.wasm': 'application/wasm' };
// server switches (set between phases): flagOff → js/core/config.js with CORE_WASM = false; ?corrupt=1 / ?abi3=1 on the wasm
const SW = { flagOff: !!process.env.FLAG_OFF, root: SITE };   // FLAG_OFF=1 leak — the same run with CORE_WASM = false (what the game alone costs)
const name = Array.from('d37_abi_version', ch => ch.charCodeAt(0));
const ABI3 = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 5, 1, 0x60, 0, 1, 0x7f, 3, 2, 1, 0, 7, 4 + name.length, 1, name.length, ...name, 0, 0, 10, 6, 1, 4, 0, 0x41, 3, 0x0b]);
function serve(req, res) {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname); if (p === '/' || /^\/(play|chat|games)(\/|$)/.test(p)) p = '/index.html';
  const root = SW.root, f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  let body = fs.readFileSync(f);
  if (p === '/js/core/config.js' && SW.flagOff) body = Buffer.from(body.toString('utf8').replace('const CORE_WASM = true;', 'const CORE_WASM = false;'));
  if (p.endsWith('d37core.wasm') && u.searchParams.get('corrupt')) { body = Buffer.from(body); for (const k of [3000, 9000, 40000]) body[k] ^= 0xFF; }
  if (p.endsWith('d37core.wasm') && u.searchParams.get('abi3')) body = ABI3;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}
const server = http.createServer(serve);
const T = 'GAME_IMPL.terra._test';
const SAMPLER = `(() => {
  if (window.__trS) return;
  const S = window.__trS = { on: false, f: [] };
  const tick = t => { requestAnimationFrame(tick); if (!S.on) return; const st = window.GAME_IMPL?.terra?._test?.S; if (!st?.R) return;
    const r = st.R.stats; S.f.push([t, r.cpuFrame || 0]); };
  requestAnimationFrame(tick);
})()`;
const summary = f => {
  if (f.length < 3) return { frames: f.length };
  const dts = []; for (let i = 1; i < f.length; i++) dts.push(f[i][0] - f[i - 1][0]);
  const cpu = f.map(x => x[1]).sort((a, b) => a - b);
  const avg = a => a.reduce((s, x) => s + x, 0) / a.length, p = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
  return { frames: f.length, fps: +(1000 / avg(dts)).toFixed(1), long50: dts.filter(d => d > 50).length, cpuAvg: +avg(cpu).toFixed(2), cpuP95: +p(cpu, .95).toFixed(2), cpuMax: +cpu[cpu.length - 1].toFixed(1) };
};
// the page side of the determinism check: the same game loop and commands as play() in scripts/core-world-test.cjs
const PLAY = `window.__play = async (fps, o, totalSteps, cmdsWanted) => {
  const CW = D37CoreWorld, J = D37Core.js;
  function Rng(seed) { this.st = J.smState(seed >>> 0); }
  Rng.prototype.below = function (n) { return J.smBelowS(this.st, n >>> 0); };
  const id = new Uint32Array(2), props = [];
  const s = CW.session(Object.assign({ seed: 937, hashEvery: 0, onReset(ss) {
    J.worldId(937, 0, 1, 0, 0, 0, 0, id);
    ss.cmd(1, 0, id[0], id[1], 0, CW.pack.spawnKind(1, 0, 1, 0), 0, 0, 0, CW.pack.hpBrk(1600, 0), 75000);
    ss.cmd(7, 0, 0, 0, 0, 1, 1, id[0], id[1], 0, 0);
  } }, o));
  const r = new Rng(0xF95), plan = new Int32Array(totalSteps);
  for (let k = 0; k < cmdsWanted; k++) plan[r.below(totalSteps)]++;
  const gr = new Rng(0xC0DE), dt = 1 / fps;
  let acc = 0, steps = 0, sent = 0, frames = 0;
  while (steps < totalSteps) {
    frames++; acc += dt; let n = 0;
    while (acc >= 1 / 60 && n < 5 && steps < totalSteps) {
      for (let c = 0; c < plan[steps]; c++) {
        const op = gr.below(5);
        if (op === 0 || props.length < 2) { J.worldId(937, 0, 1, 1 + gr.below(30), 0, 0, 100 + sent, id); props.push(id[0], id[1]); s.cmd(1, 0, id[0], id[1], 0, CW.pack.spawnKind(2 + gr.below(9), 0, 2, 16 + gr.below(8)), gr.below(4), 6, 0, CW.pack.hpBrk(400 + gr.below(1200), 2000 + gr.below(3000)), 1000 + gr.below(30000)); }
        else {
          const k = gr.below(props.length / 2) * 2, lo = props[k], hi = props[k + 1];
          if (op === 1) s.cmd(3, 1, lo, hi, 0, 1, 0, 0, 0, 0, 800);
          else if (op === 2) s.cmd(4, 1, lo, hi, 0, 1, 0, 0, 0, 0, 800);
          else if (op === 3) s.cmd(5, 1, lo, hi, 0, 0, 1000 + gr.below(7000), 1 | (gr.below(5) << 8), 0, 0, 900);
          else s.cmd(6, 1, lo, hi, 0, gr.below(4), -1, 0, 0, 0, 700);
        }
        sent++;
      }
      s.step(); steps++; acc -= 1 / 60; n++;
    }
    if (n === 5) acc = 0;
    if (frames % 50 === 0) await new Promise(rs => setTimeout(rs, 0));
  }
  await s.started;
  for (let i = 0; i < 400 && (s.stats.backlog > 0 || !s.ready); i++) await new Promise(rs => setTimeout(rs, 5));
  const h = new Uint32Array(2), hc = s.world ? await s.world.hash(h) : -1;
  const res = { hash: (h[1] >>> 0).toString(16).padStart(8, '0') + (h[0] >>> 0).toString(16).padStart(8, '0'), hc, ticks: s.stats.ticks, cmds: s.stats.cmds, backend: s.backend, transport: s.transport };
  s.dispose();
  return res;
};`;
// loads d37core.js + core-world.js the way the game loader does (script tags, ?v=GAMES_VER); resolves with the parse ms
const LOADCORE = `window.__loadCore = () => new Promise(ok => {
  if (window.D37CoreWorld) { ok(0); return; }
  const t0 = performance.now(), v = typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1';
  const a = document.createElement('script'); a.src = 'js/engine/d37core.js?v=' + v;
  a.onload = () => { const b = document.createElement('script'); b.src = 'js/engine/core-world.js?v=' + v; b.onload = () => ok(performance.now() - t0); document.head.appendChild(b); };
  document.head.appendChild(a);
});`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dl0 = fs.existsSync(DL) ? fs.readdirSync(DL).length : -1;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-core-e2e-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null, ver = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome did not start'); proc.kill(); server.close(); process.exit(1); }
  // downloads denied on the browser target too (skill d37-chrome-e2e)
  try {
    const bw = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r, j) => { bw.onopen = r; bw.onerror = j; });
    bw.send(JSON.stringify({ id: 1, method: 'Browser.setDownloadBehavior', params: { behavior: 'deny' } }));
    await sleep(200); bw.close();
  } catch (e) { console.log('browser download deny: ' + e.message); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [], net = [];
  let netOn = false;
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (netOn && d.method === 'Network.responseReceived') net.push({ url: d.params.response.url, type: d.params.type, id: d.params.requestId });
    if (netOn && d.method === 'Network.requestWillBeSent') net.push({ url: d.params.request.url, type: 'req:' + (d.params.type || ''), id: d.params.requestId });
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  try { await send('Page.setDownloadBehavior', { behavior: 'deny' }); } catch (e) {}   // never save files into Downloads on C:
  const ev = async (expr, ms = 180000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval error').slice(0, 300));
    return r.result.value;
  };
  const workers = async () => { const t = await send('Target.getTargets'); return t.targetInfos.filter(x => x.type === 'worker' || x.type === 'dedicated_worker').length; };
  const heap = () => ev(`+(performance.memory.usedJSHeapSize / 1048576).toFixed(1)`);
  const heapMin = async () => { let m = Infinity; for (let k = 0; k < 3; k++) { await ev('window.gc && window.gc()'); await sleep(500); m = Math.min(m, await heap()); } return m; };
  const throttle = r => send('Emulation.setCPUThrottlingRate', { rate: r == null ? RATE : r });
  const out = { mode: MODE, rate: RATE, q: Q, pc: PC, when: new Date().toISOString() };
  const why = [];
  const check = (c, msg) => { if (!c) why.push(msg); return c; };
  try {
    await send('Runtime.enable'); await send('Target.setDiscoverTargets', { discover: true });
    if (PC) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    else {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q };
    let lsScript = null;
    const setLs = async extra => {
      if (lsScript) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: lsScript });
      const src = `try{${Object.entries({ ...ls, ...extra }).map(([k, v]) => v === null ? `localStorage.removeItem(${JSON.stringify(k)});` : `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}`;
      lsScript = (await send('Page.addScriptToEvaluateOnNewDocument', { source: src })).identifier;
    };
    // count d37Err calls (errlog only runs on the real host; here we count what it would get)
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__errs = []; window.d37Err = (w, e) => window.__errs.push(String(w) + (e && e.message ? ': ' + e.message : ''));` });
    const ready = async () => { let ok = false; for (let i = 0; i < 160 && !ok; i++) { await sleep(250); try { ok = await ev(`!!(${T}.S?.TS)`, 5000); } catch (e) {} } if (!ok) throw new Error('terra page did not open'); };
    const coreReady = async (ms = 30000) => { const t0 = Date.now(); let c = null; do { await sleep(200); c = await ev(`${T}.core()`); } while (Date.now() - t0 < ms && !(c && c.ready && c.stats.ticks > 3)); return c; };
    const go = async hash => ev(`(window.D37Route?.go ? D37Route.go(${JSON.stringify(hash)}) : (location.hash = ${JSON.stringify(hash)}), 1)`);
    const nav = async (u, wait = 2500) => { await send('Page.navigate', { url: u }); await sleep(wait); };

    if (MODE === 'load') {
      await setLs({});
      // ── home page: core bytes, startup JS (gzip), LCP / CLS — after (this checkout) and before (MAIN_DIR = main); one warm-up
      //    navigation first (cold DNS / fonts / CDN), then RUNS (5) runs per checkout, interleaved, median
      await send('Network.enable');
      await send('Network.setCacheDisabled', { cacheDisabled: true });
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__cwv = { lcp: 0, cls: 0 }; try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__cwv.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cwv.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}` });
      const RUNS = +(process.env.RUNS || 5);
      const H = {};
      const homeRun = async (root, label) => {
        SW.root = root;
        const h = H[label] || (H[label] = { runs: [], core: 0, jsList: null });
        {
          net.length = 0; netOn = true;
          await throttle();
          await nav(BASE + '/', 9000);
          const cwv = await ev(`({ lcp: Math.round(window.__cwv.lcp), cls: +window.__cwv.cls.toFixed(4) })`);
          await throttle(1);
          netOn = false;
          const urls = [...new Set(net.map(x => x.url))];
          h.core += urls.filter(u => /d37core|core-world/.test(u)).length;
          const js = [...new Set(net.filter(x => x.type === 'Script' && x.url.startsWith(BASE)).map(x => new URL(x.url).pathname))].sort();
          if (!h.jsList) h.jsList = js;
          h.runs.push(cwv);
        }
      };
      const home = (root, label) => {
        const h = H[label], runs = h.runs, core = h.core, jsList = h.jsList;
        let raw = 0, gz = 0;
        for (const p of jsList) { if (!fs.existsSync(path.join(root, p))) continue; const b = fs.readFileSync(path.join(root, p)); raw += b.length; gz += zlib.gzipSync(b, { level: 9 }).length; }
        const med = k => runs.map(r => r[k]).sort((a, b) => a - b)[runs.length >> 1];
        const r = { label, coreRequests: core, startupScripts: jsList.length, startupJsKiB: +(raw / 1024).toFixed(1), startupJsGzKiB: +(gz / 1024).toFixed(2), lcpMs: med('lcp'), cls: med('cls'), runs };
        console.log('home', label, JSON.stringify(r));
        return r;
      };
      await nav(BASE + '/', 6000);   // warm-up (not counted)
      for (let k = 0; k < RUNS; k++) { await homeRun(SITE, 'after'); if (MAIN_DIR) await homeRun(MAIN_DIR, 'before'); }
      out.homeAfter = home(SITE, 'after');
      if (MAIN_DIR) out.homeBefore = home(MAIN_DIR, 'before');
      SW.root = SITE;
      await send('Network.setCacheDisabled', { cacheDisabled: false });
      check(out.homeAfter.coreRequests === 0, `home page requested the core ${out.homeAfter.coreRequests}×`);
      check(out.homeAfter.lcpMs <= 2500, `home LCP ${out.homeAfter.lcpMs} ms > 2.5 s`);
      check(out.homeAfter.cls <= 0.1, `home CLS ${out.homeAfter.cls} > 0.1`);
      if (out.homeBefore) {
        const dGz = out.homeAfter.startupJsGzKiB - out.homeBefore.startupJsGzKiB;
        out.homeStartupGzDeltaKiB = +dGz.toFixed(2);
        check(Math.abs(dGz) < 0.5, `home startup JS gzip changed by ${dGz.toFixed(2)} KiB`);
        check(out.homeAfter.startupScripts === out.homeBefore.startupScripts, `home startup scripts ${out.homeBefore.startupScripts} → ${out.homeAfter.startupScripts}`);
      }
      // ── core load + init in the page (the way a game does it), phone ×4: in-thread 5× fresh, worker host 5×
      await nav(BASE + '/', 6000);
      await ev(LOADCORE); await ev(PLAY);
      await throttle();
      const parseMs = await ev(`__loadCore()`);
      const inl = await ev(`(async () => { const r = []; for (let k = 0; k < 5; k++) { const t0 = performance.now(); const c = await D37CoreWorld.load({ fresh: true }); const t1 = performance.now(); const w = c.createWorld({ seed: 1 }); const t2 = performance.now(); w.world.destroy();
        r.push({ backend: c.backend, err: c.error, fetch: +c.fetchMs.toFixed(2), init: +c.initMs.toFixed(2), loadInit: +(t2 - t0).toFixed(2), create: +(t2 - t1).toFixed(2) }); } return r; })()`);
      const wk = await ev(`(async () => { const r = []; for (let k = 0; k < 5; k++) { const t0 = performance.now(); const h = await D37CoreWorld.host({ desc: { seed: 1 } }); const t1 = performance.now(); const w = await (h.first || h.createWorld({ seed: 1 })); const t2 = performance.now();
        await w.world.destroy(); h.dispose(); const b = h.boot || {}; r.push({ kind: h.kind, backend: h.backend, err: h.error, workerFetch: +(h.fetchMs || 0).toFixed(2), workerInit: +(h.initMs || 0).toFixed(2), ready: +(t1 - t0).toFixed(2), loadInit: +(t2 - t0).toFixed(2),
          spawn: +(b.spawnMs || 0).toFixed(1), scripts: +(b.scriptsMs || 0).toFixed(1), core: +(b.coreMs || 0).toFixed(1), deliver: +(b.deliverMs || 0).toFixed(1) }); } return r; })()`);
      // where the worker path's time goes: a bare worker (Blob, posts at once) vs the core worker with the JS core (no wasm)
      const boot = await ev(`(async () => { const r = []; const v = typeof GAMES_VER !== 'undefined' ? GAMES_VER : '1';
        for (let k = 0; k < 5; k++) {
          let t0 = performance.now(); const u = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' })); const w = new Worker(u);
          await new Promise(ok => { w.onmessage = ok; }); const bare = performance.now() - t0; w.terminate(); URL.revokeObjectURL(u);
          t0 = performance.now(); const w2 = new Worker('js/engine/core-world.js?v=' + v, { name: 'd37-core-world' }); const tNew = performance.now() - t0;
          w2.postMessage({ t: 'init', wasm: null }); await new Promise(ok => { w2.onmessage = ok; setTimeout(ok, 10000); }); const jsReady = performance.now() - t0; w2.terminate();
          r.push({ bare: +bare.toFixed(1), newWorker: +tNew.toFixed(2), scriptsReadyJs: +jsReady.toFixed(1) }); }
        return r; })()`);
      await throttle(1);
      const med = (a, k) => a.map(x => x[k]).sort((p, q) => p - q)[2];
      out.workerBoot = { rows: boot, bareMed: med(boot, 'bare'), newWorkerMed: med(boot, 'newWorker'), scriptsReadyJsMed: med(boot, 'scriptsReadyJs') };
      console.log('worker boot', JSON.stringify(out.workerBoot));
      out.coreLoad = { rate: RATE, scriptsParseMs: +parseMs.toFixed(1), inThread: inl, worker: wk,
        inThreadLoadInitMedMs: med(inl, 'loadInit'), inThreadInitMedMs: med(inl, 'init'), inThreadFetchMedMs: med(inl, 'fetch'), workerLoadInitMedMs: med(wk, 'loadInit'), workerInitMedMs: med(wk, 'workerInit') };
      console.log('core load + init', JSON.stringify(out.coreLoad));
      check(inl.every(x => x.backend === 'wasm'), 'in-thread backend not wasm: ' + JSON.stringify(inl[0]));
      check(wk.every(x => x.kind === 'worker' && x.backend === 'wasm'), 'worker host not worker/wasm: ' + JSON.stringify(wk[0]));
      check(out.coreLoad.inThreadLoadInitMedMs <= 50, `in-thread load + init ${out.coreLoad.inThreadLoadInitMedMs} ms > 50 ms at ×${RATE}`);
      // the worker path's wall time = Chrome's worker thread start (spawn) + our scripts + the core + delivering 'ready' to the busy
      // throttled page; the part the core owns (scripts + core) has the 50 ms budget, the wall time is reported and the game must
      // never wait for it (checked on «Новая земля» below: the core is ready before the game's first step)
      out.coreLoad.workerOwnMedMs = med(wk.map(x => ({ own: +(x.scripts + x.core).toFixed(1) })), 'own');
      out.coreLoad.workerSpawnMedMs = med(wk, 'spawn'); out.coreLoad.workerDeliverMedMs = med(wk, 'deliver');
      check(out.coreLoad.workerOwnMedMs <= 50, `worker: scripts + core ${out.coreLoad.workerOwnMedMs} ms > 50 ms`);
      // ── fallbacks in the browser (warnings expected here: not counted)
      const nLog = logs.length;
      const fb = await ev(`(async () => {
        const o = {};
        const one = async (label, opts) => { const c = await D37CoreWorld.load(Object.assign({ fresh: true }, opts)); const r = c.createWorld({ seed: 37 }); const w = r.world; let ok = !!w; if (w) { const cm = new Int32Array(13); cm[0] = 1; cm[1] = 9; cm[3] = 5; cm[5] = 1; cm[7] = D37CoreWorld.pack.spawnKind(3, 0, 2, 16); cm[12] = 1000; const res = new Int32Array(4); w.apply(cm, 1, res); ok = res[0] === 0; w.destroy(); } o[label] = c.backend + (ok ? ' ok' : ' DEAD') + ' (' + c.error.slice(0, 50) + ')'; };
        await one('missing (404)', { wasm: 'js/engine/no-such.wasm' });
        await one('corrupted', { wasm: 'js/engine/d37core.wasm?corrupt=1' });
        await one('abi 3', { wasm: 'js/engine/d37core.wasm?abi3=1' });
        await one('forced d37_core=js', { force: 'js' });
        const h = await D37CoreWorld.host({ wasm: 'js/engine/d37core.wasm?corrupt=1' }); o['worker + corrupted'] = h.kind + '/' + h.backend; h.dispose();
        const h2 = await D37CoreWorld.host({ workerUrl: 'js/engine/no-such-worker.js' }); o['worker script 404'] = h2.kind + '/' + h2.backend; h2.dispose();
        o.errlog = window.__errs.slice();
        return o; })()`);
      logs.length = nLog;
      out.fallbacks = fb;
      console.log('fallbacks', JSON.stringify(fb));
      check(/^js-fallback ok/.test(fb['missing (404)']) && /^js-fallback ok/.test(fb.corrupted) && /^js-fallback ok/.test(fb['abi 3']) && /^js-fallback ok/.test(fb['forced d37_core=js']), 'a browser fallback case failed');
      check(fb['worker + corrupted'] === 'worker/js-fallback' && fb['worker script 404'] === 'inline/wasm', 'worker fallback cases');
      check(fb.errlog.some(x => /js-fallback/.test(x)) && fb.errlog.some(x => /worker failed/.test(x)), 'fallbacks were not reported to the error log (d37Err)');
      // ── 30 / 60 / 144 FPS in Chrome → the node hash
      const det = await ev(`(async () => { const r = []; for (const [label, o] of [['inline/wasm', { worker: false }], ['inline/js', { worker: false, wasm: false }], ['worker/wasm', {}], ['worker/js', { wasm: false }]])
        for (const fps of [30, 60, 144]) { const x = await __play(fps, o, 1200, 100); r.push(label + '@' + fps + ' ' + x.hash + ' ' + x.transport + '/' + x.backend + ' ' + x.cmds); } return r; })()`, 300000);
      const hashes = new Set(det.map(x => x.split(' ')[1]));
      out.determinism = { runs: det.length, hashes: [...hashes], rows: det };
      console.log('determinism (Chrome)', JSON.stringify(out.determinism));
      check(hashes.size === 1 && hashes.has('bb1cc99c96f90a01'), `Chrome 30/60/144: ${hashes.size} hashes ${[...hashes].join(',')} (node: bb1cc99c96f90a01)`);
      check(det.every(x => / 102$/.test(x)), 'a determinism run lost commands');
      // ── «Новая земля» with CORE_WASM on (phone ×4)
      await nav('about:blank', 300);
      net.length = 0; netOn = true;
      await nav(BASE + '/#/games/terra', 500); await ready(); await ev(SAMPLER); await throttle();
      const t0 = Date.now();
      const c = await coreReady();
      out.terraOn = { core: c, readyAfterTerraMs: Date.now() - t0, workers: await workers() };
      await sleep(5000);
      out.terraOn.core = await ev(`${T}.core()`);
      await ev(`(${T}.S.dbg && ${T}.S.dbg.show(true), 1)`); await sleep(1200);   // the hidden debug panel (F3)
      out.terraOn.debug = await ev(`(() => { const d = document.querySelector('.e2-debug'); return d && !d.hidden ? (d.textContent.split('\\n').filter(l => /ядро D37/.test(l))[0] || 'no core line') : 'panel hidden'; })()`);
      await ev(`(${T}.S.dbg && ${T}.S.dbg.show(false), 1)`);
      await throttle(1);
      netOn = false;
      out.terraOn.coreRequests = [...new Set(net.filter(x => /d37core|core-world/.test(x.url)).map(x => new URL(x.url).pathname))];
      console.log('terra CORE_WASM on', JSON.stringify(out.terraOn));
      check(out.terraOn.core && out.terraOn.core.backend === 'wasm' && out.terraOn.core.transport === 'worker' && out.terraOn.core.stats.ticks > 50, 'terra core not wasm/worker or no ticks');
      check(out.terraOn.core && out.terraOn.core.stats.applied === 2 && out.terraOn.core.stats.errors === 0 && out.terraOn.core.stats.resets === 0, 'terra core: player spawn + actor not applied, or errors');
      check(/^ядро D37: wasm · worker/.test(out.terraOn.debug), 'debug panel line: ' + out.terraOn.debug);
      check(out.terraOn.core && out.terraOn.core.readyMs > 0 && out.terraOn.core.readyMs < out.terraOn.core.gameStartMs, `the game waited for the core: core ready ${out.terraOn.core && out.terraOn.core.readyMs} ms, game start ${out.terraOn.core && out.terraOn.core.gameStartMs} ms`);
      // ── CORE_WASM = false (the one-line rollback): no core request, no core worker, the game runs
      await go('#/games'); await sleep(1500);
      SW.flagOff = true;
      await nav('about:blank', 300);
      net.length = 0; netOn = true;
      await nav(BASE + '/#/games/terra', 500); await ready(); await sleep(6000);
      netOn = false;
      const off = { core: (await ev(`${T}.core()`)) || null, on: await ev(`window.D37CoreWorld ? D37CoreWorld.on() : null`), wasmRequests: net.filter(x => /d37core\.wasm/.test(x.url)).length,
        scriptsLoaded: [...new Set(net.filter(x => /d37core\.js|core-world/.test(x.url)).map(x => new URL(x.url).pathname))], workers: await workers(), terraWorkers: await ev(`${T}.stats().ts.kinds`), state: await ev(`${T}.state()`) };
      SW.flagOff = false;
      out.terraOff = off;
      console.log('terra CORE_WASM off', JSON.stringify(off));
      check(off.core === null && off.on === false && off.wasmRequests === 0 && off.state && off.state.player, 'flag off: the core still ran or the game did not: ' + JSON.stringify(off).slice(0, 200));
      check(off.workers === out.terraOn.workers - 1, `flag off: workers ${off.workers} (on: ${out.terraOn.workers}) — the core worker must be the only difference`);
    } else if (MODE === 'leak') {
      const n = +ARG || 20;
      await setLs({});
      const counters = () => ev(`window.D37CoreWorld ? D37CoreWorld.stats() : null`);
      const OFF = SW.flagOff;
      await nav(BASE + '/#/games/terra', 500); await ready(); if (!OFF) await coreReady(); await go('#/games'); await sleep(1500);
      const snap = async i => ({ i, heap: await heapMin(), workers: await workers(), canvases: await ev(`document.querySelectorAll('canvas').length`), core: await counters() });
      out.base = await snap(0); out.cycles = [];
      console.log('  base (after 1st close)', JSON.stringify(out.base));
      for (let i = 0; i < n; i++) {
        await go('#/games/terra'); await ready();
        if (!OFF) { const c = await coreReady(15000); if (!(c && c.ready)) why.push(`cycle ${i + 1}: core not ready`); } else await sleep(1500);
        await ev(`${T}.move(0.3, 1, true)`); await sleep(800); await ev(`${T}.dig()`); await sleep(400); await ev(`${T}.move(0, 0, false)`);
        await go('#/games'); await sleep(900);
        if (i % 5 === 4) { const s = await snap(i + 1); out.cycles.push(s); console.log('  ', JSON.stringify(s)); }
      }
      const last = out.cycles[out.cycles.length - 1], lim = +(process.env.LEAK_MB || 6);
      check(last && last.heap - out.base.heap <= lim, `heap +${last && (last.heap - out.base.heap).toFixed(1)} MB > ${lim} MB`);
      check(last && last.workers === 0, `${last && last.workers} workers alive after close`);
      check(last && last.canvases === out.base.canvases, 'canvases');
      const k = last && last.core;
      if (!OFF) check(k && k.sessionsLive === 0 && k.worldsLive === 0 && k.hostsLive === 0 && k.workersLive === 0, 'core counters after close: ' + JSON.stringify(k));
      if (!OFF) check(k && k.loads === out.base.core.loads, 'the in-page core was loaded again on reopen: ' + (k && k.loads));
    } else if (MODE === 'soak') {
      const min = +ARG || 15;
      await setLs({});
      await nav(BASE + '/#/games/terra', 500); await ready(); await ev(SAMPLER); await throttle();
      const c0 = await coreReady(60000);
      check(c0 && c0.ready, 'core not ready');
      out.minutes = [];
      const pos = () => ev(`(() => { const s = ${T}.state(); return [s.player.wx, s.player.wz, s.mode]; })()`);
      let [px, pz] = await pos(), dist = 0, yaw = 0, digs = 0, lastCheck = Date.now(), lx = px, lz = pz;
      await ev(`${T}.fly(false)`); await ev(`${T}.look(${yaw})`); await ev(`${T}.move(0, 1, true)`);
      await ev(`(window.__trS.f = [], window.__trS.on = true)`);
      const t0 = Date.now();
      let nextDig = 60000, minuteAt = 60000;
      while (Date.now() - t0 < min * 60000) {
        await sleep(1000);
        const [x, z] = await pos();
        dist += Math.hypot(x - px, z - pz); px = x; pz = z;
        if (Date.now() - lastCheck > 5000) {   // stuck (cliff, water edge): turn 90°
          if (Math.hypot(x - lx, z - lz) < 6) { yaw += 1.5708; await ev(`${T}.look(${yaw.toFixed(3)})`); await ev(`${T}.move(0, 1, true)`); }
          lx = x; lz = z; lastCheck = Date.now();
        }
        if (Date.now() - t0 > nextDig) { await ev(`${T}.dig()`); digs++; nextDig += 60000; }
        if (Date.now() - t0 >= minuteAt) {
          minuteAt += 60000;
          const f = summary(await ev(`(() => { const f = window.__trS.f; window.__trS.f = []; return f; })()`));
          const c = await ev(`${T}.core()`), pages = await ev(`${T}.S.core.host.pages()`);
          const m = { min: out.minutes.length + 1, distM: Math.round(dist), heap: await heap(), errors: logs.length, fps: f.fps, cpuAvg: f.cpuAvg, cpuP95: f.cpuP95, long50: f.long50,
            ticks: c.stats.ticks, tickMs: +c.stats.tickMs.toFixed(4), mainMs: +c.stats.mainMs.toFixed(4), mainMax: +c.stats.mainMax.toFixed(3), rtMs: +c.stats.rtMs.toFixed(2), pages, resets: c.stats.resets, coreErr: c.stats.errors, backend: c.backend, transport: c.transport };
          out.minutes.push(m); console.log('  ', JSON.stringify(m));
        }
      }
      await ev(`${T}.move(0, 0, false)`);
      out.digs = digs; out.distM = Math.round(dist);
      const M = out.minutes, a = M[0], b = M[Math.min(9, M.length - 1)];
      check(M.length >= Math.min(10, min), 'too few minutes measured');
      check(out.distM >= 2000 || min < 10, `walked ${out.distM} m < 2 km`);
      if (a && b) {
        out.flat = { cpuMin1: a.cpuAvg, cpuMin10: b.cpuAvg, mainMin1: a.mainMs, mainMin10: b.mainMs, pagesMin1: a.pages, pagesLast: M[M.length - 1].pages };
        check(b.mainMs <= a.mainMs * 1.05 + 0.005, `core main-thread cost minute-10 ${b.mainMs} > minute-1 ${a.mainMs} + 5 %`);
        check(M[M.length - 1].pages === a.pages, `wasm pages ${a.pages} → ${M[M.length - 1].pages}`);
        out.flat.frameCpuFlat = b.cpuAvg <= a.cpuAvg * 1.05;   // frame CPU: terrain-dependent, reported (the core's own share is mainMs)
      }
      const last = M[M.length - 1];
      check(last && last.resets === 0 && last.coreErr === 0 && last.backend === 'wasm', 'core resets / errors during the soak');
      check(last && last.ticks >= (min * 60 - 30) * 20 * 0.9, `core ticks ${last && last.ticks} for ${min} min (want ~${min * 1200})`);
    }
  } catch (e) { why.push('ERROR ' + e.message); console.log('ERROR', e.message); }
  out.logs = logs.slice(0, 40);
  out.errorCount = logs.filter(l => !/X3595/.test(l)).length;
  if (out.errorCount) why.push(out.errorCount + ' console errors/warnings');
  const dl1 = fs.existsSync(DL) ? fs.readdirSync(DL).length : -1;
  out.downloads = { before: dl0, after: dl1 };
  if (dl1 !== dl0) why.push(`Downloads folder ${dl0} → ${dl1} files`);
  out.fail = why;
  const file = path.join(OUT, `core-world-${MODE}${SW.flagOff ? '-off' : ''}-${PC ? 'pc' : 'phone'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(why.length ? 'FAIL: ' + why.join('; ') : `core-world e2e ${MODE} OK`, '· written:', file, '· downloads', dl0, '→', dl1);
  if (out.errorCount) console.log(out.logs.slice(0, 12).join('\n'));
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(why.length ? 1 : 0); }, 800);
})();

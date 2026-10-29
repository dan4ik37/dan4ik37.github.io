// T-131 (AI3D A2) in REAL headless Chrome (DevTools Protocol, no npm): «Студия 3D» with 20 animated (skinned) models.
// The AI3D human GLB comes from scripts/anim-test.cjs (D37_TMP/t138/hm.glb: make human → skel → actions → r149 GLTFExporter);
// the page compiles it with D37E.models (skin, clips), saves it and places 20 copies doing different actions.
//   perf  — phone profile (412×915×2, touch, CPU ×4): frame CPU p50/p95 with the 20 models static (D37E.models.SKIN = false, the
//           rollback path) and animated; time inside D37E.models.animate; LOD (near/far update counts); heap; a screenshot
//   leak  — 20× close/open of the studio (the world reloads the 20 animated models): live instances after each close, heap after GC
// Run from the site root: node scripts/anim-e2e.cjs [perf|leak|all] [cycles=20]   (RATE=4 CPU throttle, PC=1 for desktop)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [MODE = 'all', ARG = '20'] = process.argv.slice(2);
const PC = !!process.env.PC, RATE = PC ? 1 : +(process.env.RATE || 4);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = path.join(process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir()), 't138');
const OUT = path.join(TMP, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const GLB = path.join(TMP, 'hm.glb');
if (!fs.existsSync(GLB)) { console.log('no ' + GLB + ' — run node scripts/anim-test.cjs first'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  if (p === '/__t138/hm.glb') { res.writeHead(200, { 'Content-Type': 'model/gltf-binary' }); fs.createReadStream(GLB).pipe(res); return; }
  let f = path.join(SITE, p);
  if ((!fs.existsSync(f) || fs.statSync(f).isDirectory()) && !path.extname(p)) f = path.join(SITE, 'index.html');
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome did not start'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), subs = new Set(), logs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  subs.add(d => {
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
  });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: null } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const res = {};
  const up = async () => { for (let i = 0; i < 240; i++) { await sleep(400); if (await ev(`!!(window.GAME_IMPL?.studio3d?._test?.state()?.SC && window.D37E?.models?.animate)`, 5000).catch(() => false)) return true; } return false; };
  const heap = async () => { await send('HeapProfiler.collectGarbage'); await sleep(300); await send('HeapProfiler.collectGarbage'); return +((await ev('performance.memory.usedJSHeapSize')) / 1e6).toFixed(1); };
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
    if (PC) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    else { await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true }); await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_s3_learn: 'done' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/studio3d' });
    ok(await up(), 'studio opened');
    // the AI3D human → D37E.models (in the page), 20 copies doing different actions
    res.setup = await ev(`(async () => {
      const ED = GAME_IMPL.studio3d._test.state(), SC = ED.SC, M = D37E.models;
      const buf = await (await fetch('/__t138/hm.glb')).arrayBuffer(), t0 = performance.now();
      const m = await M.compile([{ name: 'hm.glb', data: buf }], { name: 'Человек AI3D' }); await M.save(m);
      const tc = performance.now() - t0;
      for (const o of SC.all().slice()) if (o.cls !== 'Spawn') SC.remove(o);
      const acts = ['loco.walk.fwd', 'loco.jog.fwd', 'loco.idle', 'stance.crouch.fwd', 'loco.sprint.fwd', 'carry.carry.fwd', 'loco.idle.fidget_look', 'loco.walk.left', 'loco.turn.l90', 'gesture.stretch'];
      for (let i = 0; i < 20; i++) { const x = (i % 5 - 2) * 3, z = [4, -6, -22, -48][i / 5 | 0]; SC.add('Mesh', { model: m.id, pos: [x, m.size[1] / 2, z], size: m.size.slice(), act: acts[i % acts.length] }); }
      ED.cam.x = 0; ED.cam.y = 3.2; ED.cam.z = 14; ED.cam.yaw = 0; ED.cam.pitch = .12;
      await new Promise(r => setTimeout(r, 1500));
      const meshes = SC.all().filter(o => o.cls === 'Mesh');
      return { compileMs: Math.round(tc), bones: m.skin && m.skin.n, clips: (m.anims || []).length, tris: m.tris, kb: Math.round(m.bytes / 1024), meshes: meshes.length, animated: meshes.filter(o => o._anim).length, live: M.live(), humanoid: M.actions(m).humanoid };
    })()`);
    ok(res.setup && res.setup.animated === 20 && res.setup.live === 20 && res.setup.humanoid, '20 animated copies of the AI3D human', res.setup);
    const measure = (label) => `(async () => {
      const R = GAME_IMPL.studio3d._test.state().R, ST = R.stats, M = D37E.models, cpu = [], an = { t: 0, n: 0 }, real = M.animate;
      M.animate = (dt, c) => { const a = performance.now(); real(dt, c); an.t += performance.now() - a; an.n++; };
      await new Promise(r => setTimeout(r, 1200));
      let f = ST.frames, go = true; const t0 = performance.now();
      const tick = () => { if (!go) return; if (ST.frames !== f) { f = ST.frames; cpu.push(ST.cpuFrame); } requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      an.t = 0; an.n = 0;
      await new Promise(r => setTimeout(r, 5000)); go = false; M.animate = real;
      cpu.sort((a, b) => a - b); const q = p => +(cpu[Math.min(cpu.length - 1, Math.floor(cpu.length * p))] || 0).toFixed(2), secs = (performance.now() - t0) / 1000;
      return { label: ${JSON.stringify(label)}, frames: cpu.length, fps: +(cpu.length / secs).toFixed(1), p50: q(.5), p95: q(.95), max: q(1), over50: cpu.filter(x => x > 50).length, animateMs: an.n ? +(an.t / an.n).toFixed(3) : 0, calls: ST.calls, heapMB: +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) };
    })()`;
    if (MODE === 'perf' || MODE === 'all') {
      if (RATE > 1) await send('Emulation.setCPUThrottlingRate', { rate: RATE });
      await ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(); D37E.models.SKIN = false; for (const o of ED.SC.all()) if (o.cls === 'Mesh') ED.SC.set(o, 'model', o.model, true); await new Promise(r => setTimeout(r, 800)); return 1; })()`);
      res.static = await ev(measure('static (SKIN=false)')); console.log('static  ', JSON.stringify(res.static));
      await ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(); D37E.models.SKIN = true; for (const o of ED.SC.all()) if (o.cls === 'Mesh') ED.SC.set(o, 'model', o.model, true); await new Promise(r => setTimeout(r, 800)); return D37E.models.live(); })()`);
      res.anim = await ev(measure('animated')); console.log('animated', JSON.stringify(res.anim));
      ok(res.anim.frames > 20 && res.anim.over50 <= Math.max(3, res.anim.frames * .05), 'phone ×' + RATE + ': 20 animated models — frames over 50 ms ≤ 5 %', { p50: res.anim.p50, p95: res.anim.p95, over50: res.anim.over50 });
      ok(res.anim.animateMs < 2, 'D37E.models.animate for 20 models < 2 ms per frame', res.anim.animateMs);
      // LOD: count mixer updates near vs far over 2 s
      res.lod = await ev(`(async () => { const L = []; const M = D37E.models, ED = GAME_IMPL.studio3d._test.state(); const objs = ED.SC.all().filter(o => o.cls === 'Mesh' && o._anim);
        const mid = objs.filter(o => Math.abs(o.pos[0]) < .1), near = mid.reduce((a, o) => o.pos[2] > a.pos[2] ? o : a), far = mid.reduce((a, o) => o.pos[2] < a.pos[2] ? o : a); let n = 0, f = 0;
        const wrap = (h, inc) => { const u = h.mixer.update.bind(h.mixer); h.mixer.update = d => { inc(); return u(d); }; return () => { h.mixer.update = u; }; };
        const a = wrap(near._anim, () => n++), b = wrap(far._anim, () => f++); await new Promise(r => setTimeout(r, 2000)); a(); b(); return { near: n, far: f }; })()`);
      ok(res.lod && res.lod.near > res.lod.far * 3, 'LOD: the near model updates far more often than the far one', res.lod);
      if (RATE > 1) await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      // a picture (walkers, joggers, crouch, sprint…)
      const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'studio20' + (PC ? '-pc' : '') + '.png'), Buffer.from(shot.data, 'base64'));
      // switching the action is a cross-fade, not a rebuild
      res.switch = await ev(`(() => { const ED = GAME_IMPL.studio3d._test.state(), o = ED.SC.all().find(x => x.cls === 'Mesh' && x._anim), h = o._anim, m0 = o._mesh; ED.SC.set(o, 'act', 'loco.sprint.fwd'); return { same: o._mesh === m0 && o._anim === h, name: h.name, acts: h.acts.length }; })()`);
      ok(res.switch && res.switch.same && res.switch.name === 'loco.sprint.fwd', 'act property: action switches without a rebuild', res.switch);
      // the property panel offers the actions
      res.panel = await ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(), o = ED.SC.all().find(x => x.cls === 'Mesh'); GAME_IMPL.studio3d._test.select?.(o); await new Promise(r => setTimeout(r, 300)); const s = document.querySelector('select[data-p="act"]'); return s ? { n: s.options.length } : null; })()`);
      if (res.panel !== null) ok(res.panel.n >= 37, 'property panel: 🦴 Действие with the shared actions', res.panel);
      await ev(`(() => { const ED = GAME_IMPL.studio3d._test.state(); ED.dirty = true; return 1; })()`);
    }
    if (MODE === 'leak' || MODE === 'all') {
      const N = +ARG || 20;
      await ev(`(() => { const ED = GAME_IMPL.studio3d._test.state(); ED.dirty = true; return 1; })()`);
      if (process.env.SKIN0) await ev(`(D37E.models.SKIN = false, 1)`);   // baseline: the same world with static models
      if (process.env.EMPTY) await ev(`(() => { const ED = GAME_IMPL.studio3d._test.state(); for (const o of ED.SC.all().slice()) if (o.cls === 'Mesh') ED.SC.remove(o); ED.dirty = true; return 1; })()`);   // baseline: no models
      res.leak = { heap: [], live: [], canvases: [] };
      for (let c = 0; c <= N; c++) {
        await ev(`(location.hash = '#/', 1)`); await sleep(900);
        const after = await ev(`({ live: D37E.models.live(), canvases: document.querySelectorAll('canvas').length })`);
        res.leak.live.push(after.live); res.leak.canvases.push(after.canvases);
        if (c === 0 || c === 1 || c === Math.floor(N / 2) || c === N) res.leak.heap.push([c, await heap()]);
        if (c === N) break;
        await ev(`(location.hash = '#/games/studio3d', 1)`);
        if (!(await up())) { ok(false, 'studio reopened (cycle ' + c + ')'); break; }
        await sleep(1200);
        const n = await ev(`D37E.models.live()`);
        if (c === 0 && !process.env.SKIN0 && !process.env.EMPTY) ok(n === 20, 'reopened world: the 20 animated models come back', n);
      }
      // what stays alive after the last close (three.js objects by prototype)
      res.leak.alive = {};
      for (const k of ['Bone', 'SkinnedMesh', 'Skeleton', 'AnimationMixer', 'AnimationAction', 'WebGLRenderer', 'Scene', 'Mesh', 'Group', 'BufferGeometry', 'DataTexture']) {
        try { const pr = await send('Runtime.evaluate', { expression: 'THREE.' + k + '.prototype' }); const q = await send('Runtime.queryObjects', { prototypeObjectId: pr.result.objectId }); const n = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){ return this.length; }', returnByValue: true }); res.leak.alive[k] = n.result.value; } catch (e) { res.leak.alive[k] = 'err'; }
      }
      console.log('leak', JSON.stringify(res.leak));
      ok(res.leak.live.every(x => x === 0), N + '× close: 0 live animated instances after every close', res.leak.live);
      // the studio itself warms up ~5 MB over the first cycles (same with static models or an empty world); after that it must stay flat
      const h = res.leak.heap, growth = h.length > 3 ? h[h.length - 1][1] - h[h.length - 2][1] : 0;
      ok(growth < 1.5, N + '× open/close: heap after GC flat in the second half (cycle ' + (h[h.length - 2] || [])[0] + ' → ' + N + ' < 1.5 MB)', h);
      ok(res.leak.alive.Bone === 0 && res.leak.alive.SkinnedMesh === 0 && res.leak.alive.AnimationMixer === 0 && res.leak.alive.Skeleton === 0, 'after the last close: no bones, skinned meshes, skeletons or mixers alive', res.leak.alive);
    }
    const errs = logs.filter(l => !/X3595|DevTools|favicon|Rapier|rapier|supabase|ERR_|net::|Failed to load resource|GPU stall|WebGL: INVALID|AudioContext/i.test(l));
    ok(!errs.length, 'console: no errors or exceptions', errs.slice(0, 6));
  } catch (e) { fail++; console.log('ERROR', e.message); for (const l of logs.slice(-8)) console.log('  console:', l.slice(0, 240)); }
  finally {
    console.log('NUMBERS', JSON.stringify(res));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(fail ? `anim-e2e: ${fail} failed` : 'anim-e2e: all ok');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// AI3D /tools/3d (T-112, A1) in REAL headless Chrome (DevTools Protocol, no npm) — the first real browser run of the owner's editor.
// Modes:  node scripts/ai3d-e2e.cjs smoke   — page opens, selftest() (all rows), every demo scene, every owner button, GLB from the page
//                                             (magic, no extras, linear colour), «📦 В Студию 3D» (D37E.models), rollback, WebGL context
//                                             loss → restore, no-WebGL fallback (page lives), hotkeys stay out, 0 console errors
//         node scripts/ai3d-e2e.cjs shots   — the six demo scenes, PC 1280×720 and phone 412×915 (+ the AI's 2×2 view) → D37_TMP/t112/shots
//         node scripts/ai3d-e2e.cjs perf    — phone (CPU ×RATE): open time (cold, in-page), demo build ms, frame CPU p50/p95 and FPS while
//                                             orbiting with touch drags, JS heap, draw calls / triangles
//         node scripts/ai3d-e2e.cjs leak [20] — open/close N times by in-page navigation (demo + export each time): heap after GC, canvases,
//                                             WebGL contexts, three.js objects, window/document listeners
//         node scripts/ai3d-e2e.cjs soak [10] — N minutes of random ops (self-test rows, demos, undo/redo, rollback, export, studio, views,
//                                             play, orbit): errors, rollbacks, heap per minute
//         node scripts/ai3d-e2e.cjs retain   — what stays alive after closing (three.js renderers, geometries by size)
//         CMDS='[…]' VIEW='th,ph,dist' node scripts/ai3d-e2e.cjs look <name> — a close-up screenshot of any commands
// The smoke mode also runs scripts/ai3d/ops-extra.json — with the self-test rows and demos every one of the 63 ops runs in Chrome.
// Profiles: phone (default) — 412 × 915 × 2, touch, CPU ×4 (RATE); PC=1 — 1280 × 720, no throttle. Chrome profile and output:
// D37_TMP/t112 (E:\claude-tmp\t112). Needs internet to jsDelivr (three r149, GLTFExporter); the site's own noise (Supabase, ads) is blocked.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, '..');
const [MODE = 'smoke', ARG = ''] = process.argv.slice(2);
const PC = !!process.env.PC, RATE = PC ? 1 : +(process.env.RATE || 4);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't112');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };
// static site + SPA rewrites like vercel.json (a path without a file extension → index.html)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE)) { res.writeHead(403); res.end(); return; }
  if ((!fs.existsSync(f) || fs.statSync(f).isDirectory()) && !path.extname(p)) f = path.join(SITE, 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
const BLOCK = ['*://*.supabase.co/*', '*://*.googlesyndication.com/*', '*://*.doubleclick.net/*', '*://*.adtrafficquality.google/*', '*://*.yandex.ru/*', '*://*.yandex.net/*',
  '*://yastatic.net/*', '*://*.twitch.tv/*', '*://decapi.me/*', '*://*.ytimg.com/*', '*://*.youtube.com/*', '*://*.google-analytics.com/*', '*://*.googletagmanager.com/*',
  '*://localhost:*/_vercel/*', '*://127.0.0.1:*/_vercel/*', '*://www.googleapis.com/*', '*://api.allorigins.win/*', '*://*/api/*'];
const realErrors = errs => errs.filter(e => !/^mark:|Failed to fetch|NetworkError|ERR_BLOCKED|net::|supabase|AbortError|googleapis|Twitch|ytimg|adsbygoogle|ym is not|insights|Не загрузилось: @supabase|status of 404|favicon/i.test(String(e)));
// self-test command rows straight from the editor file (the same list selftest() runs)
function selfRows(){
  const src = fs.readFileSync(path.join(SITE, 'js/apps/ai3d/ai3d-core.js'), 'utf8'), a = src.indexOf('const T=[', src.indexOf('function selftest(')), b = src.indexOf('];', a);
  const stubs = ['state', 'build', 'g', 'THREE', 'queryRun', 'REF', 'run', 'snap', 'summary', 'manifestOf', 'CON', 'LAYERS', 'ANIM', 'group', 'decimate', 'lodUpdate', 'stats', 'obj', 'clips', 'document', 'cmpMasks', 'maskFromData', 'refCompare'];
  return new Function(...stubs, 'return ' + src.slice(a + 8, b + 1))().filter(r => Array.isArray(r[1])).map(r => ({ n: r[0], c: r[1] }));
}
const pct = (a, q) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0;

(async () => {
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-' + MODE + '-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'],
    { stdio: process.env.DEBUG_CHROME ? "inherit" : ["ignore", "pipe", "pipe"], env: { ...process.env, TMP: OUT, TEMP: OUT } });
  if (proc.stdout) proc.stdout.resume(); if (proc.stderr) proc.stderr.resume();   // drained pipes: Chrome started slowly with stdio "ignore" here
  let page = null;
  for (let i = 0; i < 600 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome did not start'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 400));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') logs.push('warning: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Log.entryAdded' && (d.params.entry.level === 'error' || /GL_|WebGL/.test(d.params.entry.text || ''))) logs.push('log: ' + (d.params.entry.text || '').slice(0, 300) + ' ' + (d.params.entry.url || ''));   // WebGL errors (GL_INVALID_…) come as rendering warnings — counted as errors
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 180000) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').slice(0, 400));
    return r.result.value;
  };
  const shot = async name => { const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }); fs.writeFileSync(path.join(OUT, 'shots', name + '.jpg'), Buffer.from(data, 'base64')); };
  const gc = async () => { await send('HeapProfiler.collectGarbage'); await sleep(150); await send('HeapProfiler.collectGarbage'); };
  const heap = () => ev(`+(performance.memory.usedJSHeapSize / 1048576).toFixed(1)`);
  const countProto = async proto => {
    try {
      const p = await send('Runtime.evaluate', { expression: proto, objectGroup: 'cnt' });
      if (!p.result.objectId) return null;
      const q = await send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId, objectGroup: 'cnt' });
      const n = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: 'function(){ return this.filter(x => !Object.prototype.hasOwnProperty.call(x, "constructor")).length; }', returnByValue: true });   // instances only (subclass prototypes are in the list too)
      return n.result.value;
    } catch (e) { return null; } finally { await send('Runtime.releaseObjectGroup', { objectGroup: 'cnt' }); }
  };
  const listeners = async expr => {
    try { const o = await send('Runtime.evaluate', { expression: expr, objectGroup: 'ls' }); const l = await send('DOMDebugger.getEventListeners', { objectId: o.result.objectId }); return l.listeners.length; }
    catch (e) { return null; } finally { await send('Runtime.releaseObjectGroup', { objectGroup: 'ls' }); }
  };
  const counts = async () => ({ heap: await heap(), canvases: await ev(`document.querySelectorAll('canvas').length`), canvasObjs: await countProto('HTMLCanvasElement.prototype'),
    gl2: await countProto('WebGL2RenderingContext.prototype'), gl1: await countProto('WebGLRenderingContext.prototype'),
    renderers: await countProto('THREE.WebGLRenderer.prototype'), geometries: await countProto('THREE.BufferGeometry.prototype'), materials: await countProto('THREE.Material.prototype'),
    textures: await countProto('THREE.Texture.prototype'), winListeners: await listeners('window'), docListeners: await listeners('document') });
  const out = { mode: MODE, rate: RATE, pc: PC, when: new Date().toISOString() };
  let failed = false;
  const READY = `!!(window.D37AI3D && window.D37AI3D.active && window.D37AI3D.core && window.AI3D)`;
  const ready = async (ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(READY, 5000) === true) return Date.now() - t0; } catch (e) {} await sleep(100); } throw new Error('AI3D did not open'); };
  const go = hash => ev(`(D37Route.go(${JSON.stringify(hash)}), 1)`);
  // in-page open: time from the route change to the first frame after mount (page clock)
  const openInPage = () => ev(`new Promise(res => { const t0 = performance.now(); D37Route.go('#/ai3d'); (function f(){ if (${READY}) requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - t0)))); else setTimeout(f, 16); })(); })`);
  const closeInPage = async () => { await go('#/home'); for (let i = 0; i < 50; i++) { if (await ev(`!(window.D37AI3D && window.D37AI3D.active) && !document.querySelector('#ai3dRoot .a3')`)) return; await sleep(100); } throw new Error('AI3D did not close'); };
  const throttle = r => send('Emulation.setCPUThrottlingRate', { rate: r });
  const demo = idd => ev(`(() => { const s = document.querySelector('#a3-demo'); const t0 = performance.now(); s.value = ${JSON.stringify(idd)}; s.dispatchEvent(new Event('change')); return { ms: Math.round(performance.now() - t0), out: document.querySelector('#a3-out').textContent.slice(0, 160), err: document.querySelector('#a3-out').className === 'err', st: D37AI3D.core.stats() }; })()`);
  const click = idd => ev(`(document.querySelector('#a3-${idd}').click(), 1)`);
  const outText = () => ev(`document.querySelector('#a3-out').textContent`);
  const canvasBox = () => ev(`(() => { const r = document.querySelector('#a3-c').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  // a real orbit drag: touch on the phone, mouse on PC
  async function drag(ms, dx = 1){
    const b = await canvasBox(), cx = b.x + b.w / 2, cy = b.y + b.h / 2, steps = Math.max(4, Math.round(ms / 16));
    if (PC) await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    else await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      const x = cx + Math.sin(i / steps * Math.PI * 2) * b.w * .3 * dx, y = cy + Math.sin(i / steps * Math.PI * 4) * b.h * .08;
      if (PC) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      else await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
      await sleep(16);
    }
    if (PC) await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
    else await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // GLB from the page (base64), checked here
  const pageGLB = () => ev(`AI3D.exportGLB().then(b => { const u = new Uint8Array(b); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); })`);
  const glbInfo = b64 => {
    const buf = Buffer.from(b64, 'base64'), magic = buf.readUInt32LE(0), jl = buf.readUInt32LE(12), J = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
    const extras = []; (function walk(o, p){ if (o && typeof o === 'object') for (const k in o) { if (k === 'extras') extras.push(p + '.extras:' + Object.keys(o[k]).join('|')); walk(o[k], p + '.' + k); } })(J, '');
    return { bytes: buf.length, magic: magic === 0x46546C67, jsonKB: +(jl / 1024).toFixed(1), nodes: J.nodes.length, anims: (J.animations || []).length, images: (J.images || []).length,
      badExtras: extras.filter(x => !/^\.meshes\.\d+\.extras:targetNames$/.test(x)), J };
  };

  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: BLOCK });
    if (PC) await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    else {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_perf','high')}catch(e){}` });
    const coldOpen = async () => { const t0 = Date.now(); await send('Page.navigate', { url: BASE + '/tools/3d' }); await ready(); const nav = await ev(`Math.round(performance.now())`); return { wallMs: Date.now() - t0, pageMs: nav }; };

    if (MODE === 'smoke') {
      out.cold = await coldOpen();
      console.log('cold open', JSON.stringify(out.cold));
      const meta = await ev(`({ path: location.pathname, robots: (document.querySelector('meta[name="robots"]') || {}).content || '', title: document.title, body: document.body.classList.contains('a3-on') })`);
      ok(meta.path === '/tools/3d' && /noindex/.test(meta.robots) && meta.body, 'route /tools/3d, noindex, editor on', meta);
      ok(await ev(`THREE.REVISION === '149' && document.querySelectorAll('script[src*="three.min.js"]').length === 1`), 'three r149, one copy');
      // owner's self-test (all 50 rows, incl. snapshots and reference compare in a real WebGL context)
      const t0 = Date.now(), st = String(await ev(`AI3D.selftest()`)); out.selftest = { ms: Date.now() - t0, head: st.split('\n')[0], bad: st.split('\n').filter(l => l.startsWith('✗')) };
      ok(/^Все \d+ проверок прошли/.test(out.selftest.head) && !out.selftest.bad.length, 'AI3D.selftest() in Chrome', out.selftest);
      console.log('selftest', JSON.stringify(out.selftest));
      // every demo through the real <select>
      out.demos = {};
      for (const d of ['table', 'dog', 'human', 'fox', 'dragon', 'land']) {
        const r = await demo(d); await sleep(300);
        ok(!r.err && /готов/.test(r.out), 'demo ' + d, r);
        out.demos[d] = { ms: r.ms, objects: r.st.objects, tris: r.st.tris_full };
      }
      console.log('demos', JSON.stringify(out.demos));
      // the ops the self-test rows and demos do not reach (with them: all 63 ops of run())
      const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'ai3d', 'ops-extra.json'), 'utf8'));
      const exRes = await ev(`(() => { D37AI3D.core.reset(); const X = ${JSON.stringify(extra)}, bad = []; for (const [n, c] of X) { const r = D37AI3D.core.run(c); if (!r.ok) bad.push(n + ': ' + r.error); } return bad; })()`);
      ok(exRes.length === 0, 'remaining ops in Chrome (mesh, parent, unconstrain, fur, addon, play, anim_del, jiggle, del, clear)', exRes);
      // GLB from the page (land is on screen now; then the table)
      await demo('table');
      const g = glbInfo(await pageGLB()), top = g.J.nodes.find(n => n.name === 'столешница'), bf = top && g.J.materials[g.J.meshes[top.mesh].primitives[0].material].pbrMetallicRoughness.baseColorFactor;
      ok(g.magic && !g.badExtras.length && bf && Math.abs(bf[0] - .392) < .001, 'GLB in Chrome: binary, no extras, #a8754a → 0.392', { bytes: g.bytes, bf, extras: g.badExtras });
      await demo('dog');
      const gd = glbInfo(await pageGLB());
      ok(gd.magic && !gd.badExtras.length && gd.jsonKB < 300 && gd.anims === 1 && gd.nodes >= 41, 'dog GLB in Chrome (was 4.4 MB, 97% extras)', { bytes: gd.bytes, jsonKB: gd.jsonKB, nodes: gd.nodes });
      out.glb = { table: g.bytes, dog: gd.bytes, dogJsonKB: gd.jsonKB };
      // a textured scene (drawn card + anime face) exports with PNG images
      ok(await ev(`(D37AI3D.core.reset(), D37AI3D.core.run([{op:'art',name:'ar1',pos:[0,1,0],w:.5,h:.5,shapes:[{t:'ell',c:[.5,.5],r:[.4,.4],fill:'#ff8a3a'}]},{op:'puppet',name:'pp',pos:[1,1,0],width:.6}]).ok)`), 'textured scene (art card, puppet face)');
      const gt = glbInfo(await pageGLB());
      ok(gt.magic && gt.images >= 1 && !gt.badExtras.length, 'textured GLB: images inside, no extras', { images: gt.images, bytes: gt.bytes });
      fs.writeFileSync(path.join(OUT, 'glb', 'textured-chrome.glb'), Buffer.from(await pageGLB(), 'base64'));
      // «📦 В Студию 3D» with the real button → D37E.models (IndexedDB)
      await demo('dragon');
      await click('studio');
      let said = ''; for (let i = 0; i < 100 && !/Готово|Не получилось/.test(said); i++) { await sleep(150); said = await outText(); }
      const list = await ev(`D37E.models.list().then(l => l.map(m => ({ name: m.name, tris: m.tris })))`);
      ok(/Готово/.test(said) && list.some(m => m.name === 'd' && m.tris > 20000), '«📦 В Студию 3D»: the model is in D37E.models', { said, list });
      // every owner button
      for (const b of ['run', 'undo', 'redo', 'snap', 'sum', 'json', 'obj', 'glb', 'play', 'play', 'test', 'ins']) { await click(b); await sleep(b === 'test' ? 2500 : b === 'glb' ? 1500 : 250); }
      ok(await ev(`document.querySelector('#a3-shot').src.startsWith('data:image/png') && document.querySelector('#a3-shot').style.display === 'block'`), 'Виды 2×2 picture');
      // rollback: a bad batch changes nothing
      await demo('table');
      const before = await ev(`JSON.stringify(AI3D.state())`);
      await ev(`(document.querySelector('#a3-cmd').value = JSON.stringify([{op:'set',name:'столешница',color:'#ff0000'},{op:'del',name:'нет такого'}]), document.querySelector('#a3-run').click(), 1)`);
      ok(await ev(`JSON.stringify(AI3D.state())`) === before && /Сцена не изменилась/.test(await outText()), 'atomic rollback (error → scene unchanged)');
      // keyboard: the site's arrows must not leave the editor
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await sleep(400);
      ok(await ev(`currentRoute() === 'ai3d'`), 'site hotkeys (arrows) do not leave the editor');
      logs.push('mark: context loss');   // WebGL context loss → notice → restore → renders again
      await ev(`(window.__a3lose = document.querySelector('#a3-c').getContext('webgl2').getExtension('WEBGL_lose_context'), __a3lose.loseContext(), 1)`); await sleep(500);
      const lostShown = await ev(`!document.querySelector('.a3-lost').hidden`);
      await ev(`(__a3lose.restoreContext(), 1)`); await sleep(1200); await demo('fox'); await sleep(300); await drag(300);   // a rebuild after the restore too
      await sleep(300);
      ok(lostShown && await ev(`document.querySelector('.a3-lost').hidden`) && (await ev(`D37AI3D.core.frames().length`)) > 0, 'context loss: notice, then restored and drawing');
      // theme: light tokens follow the site theme
      const bgD = await ev(`getComputedStyle(document.querySelector('.a3')).getPropertyValue('--bg').trim()`);
      await ev(`(document.documentElement.setAttribute('data-theme','light'), 1)`);
      const bgL = await ev(`getComputedStyle(document.querySelector('.a3')).getPropertyValue('--bg').trim()`);
      await ev(`(document.documentElement.removeAttribute('data-theme'), 1)`);
      ok(bgD !== bgL && bgL === '#e9edf0', 'dark and light themes', { bgD, bgL });
      logs.push('mark: close');   // close and reopen in the page
      await closeInPage(); out.reopenMs = await openInPage();
      ok(out.reopenMs > 0, 'in-page reopen', out.reopenMs);
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      out.warnings = [...new Set(logs.filter(l => l.startsWith('warning')).map(l => l.slice(0, 160)))];
      ok(out.errors.length === 0, '0 console errors / exceptions', out.errors.slice(0, 8));
      // no WebGL: the page lives, the editor says why
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(t, o){ return /webgl/i.test(t) ? null : g.call(this, t, o); }; })()` });
      await send('Page.navigate', { url: BASE + '/tools/3d' });
      let fb = null; for (let i = 0; i < 100 && !fb; i++) { await sleep(150); try { fb = await ev(`document.querySelector('.a3-fail') ? document.querySelector('.a3-fail').textContent : null`); } catch (e) {} }
      await go('#/home'); await sleep(600);
      ok(fb && /не запустилась/.test(fb) && await ev(`currentRoute() === 'home' && !document.body.classList.contains('a3-on')`), 'no WebGL: fallback message, site keeps working', fb);
    } else if (MODE === 'shots') {
      await coldOpen();
      for (const d of ['table', 'dog', 'human', 'fox', 'dragon', 'land']) {
        await demo(d); await sleep(900);
        await shot((PC ? 'pc-' : 'phone-') + d);
      }
      await demo('fox'); await click('snap'); await sleep(800);
      const png = await ev(`document.querySelector('#a3-shot').src`);
      fs.writeFileSync(path.join(OUT, 'shots', (PC ? 'pc' : 'phone') + '-fox-views2x2.png'), Buffer.from(png.split(',')[1], 'base64'));
      // the textured faces (anime puppet, 3D anime face, realistic face)
      await ev(`(D37AI3D.core.reset(), D37AI3D.core.run([{op:'puppet',name:'pp',pos:[-1.2,1.6,0],width:.6},{op:'facegen',name:'fg',pos:[0,1.65,0],style:'anime',eye:'#ff8a3a'},{op:'facegen',name:'fr',pos:[1.2,1.65,0],style:'real',skin:'#e8b99a',eye:'#6a4a2a'}]), D37AI3D.core.frame(), 1)`);
      await sleep(900); await shot((PC ? 'pc-' : 'phone-') + 'faces');
      out.files = fs.readdirSync(path.join(OUT, 'shots')).filter(f => f.startsWith(PC ? 'pc-' : 'phone-'));
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      ok(out.errors.length === 0, '0 console errors', out.errors.slice(0, 6));
    } else if (MODE === 'retain') {
      // what stays after closing: the live three.js renderers / geometries and whose they are
      await coldOpen(); await demo('dog'); await closeInPage(); await sleep(500); await gc();
      const p = await send('Runtime.evaluate', { expression: 'THREE.WebGLRenderer.prototype', objectGroup: 'r' });
      const q = await send('Runtime.queryObjects', { prototypeObjectId: p.result.objectId, objectGroup: 'r' });
      const info = await send('Runtime.callFunctionOn', { objectId: q.objects.objectId, returnByValue: true, functionDeclaration: `function(){ return this.filter(r => r.domElement).map(r => ({ id: r.domElement.id, w: r.domElement.width, h: r.domElement.height, connected: r.domElement.isConnected, geos: r.info.memory.geometries, progs: (r.info.programs || []).length, cls: r.domElement.className, parent: r.domElement.parentElement ? r.domElement.parentElement.id || r.domElement.parentElement.className : null })); }` });
      out.renderers = info.result.value; console.log('renderers after close', JSON.stringify(out.renderers), JSON.stringify(info.exceptionDetails || '').slice(0, 300));
      const gq = await send('Runtime.evaluate', { expression: 'THREE.BufferGeometry.prototype', objectGroup: 'r' });
      const gqq = await send('Runtime.queryObjects', { prototypeObjectId: gq.result.objectId, objectGroup: 'r' });
      const gi = await send('Runtime.callFunctionOn', { objectId: gqq.objects.objectId, returnByValue: true, functionDeclaration: `function(){ const c = {}; this.filter(g => g.attributes).forEach(g => { const k = g.type + ':' + (g.attributes.position ? g.attributes.position.count : 0); c[k] = (c[k] || 0) + 1; }); return c; }` });
      out.geometries = gi.result.value; console.log('geometries after close', JSON.stringify(out.geometries));
      out.globals = await ev(`Object.keys(window).filter(k => /^(D37AI3D|AI3D|THREE)/.test(k)).map(k => k + ':' + typeof window[k])`);
      console.log('globals', JSON.stringify(out.globals), 'D37E?', await ev(`typeof D37E`));
      await send('Runtime.releaseObjectGroup', { objectGroup: 'r' });
    } else if (MODE === 'look') {
      // ad-hoc close-up: CMDS='[…commands…]' VIEW='th,ph,dist' node scripts/ai3d-e2e.cjs look <name>
      await coldOpen();
      const r = await ev(`(D37AI3D.core.reset(), D37AI3D.core.run(${process.env.CMDS || '[]'}))`);
      ok(r.ok, 'look: commands', r.error);
      await ev(`(D37AI3D.core.frame(), ${process.env.VIEW ? `D37AI3D.core.cam(${process.env.VIEW}),` : ''} 1)`);
      await sleep(900); await shot((PC ? 'pc-' : 'phone-') + 'look-' + (ARG || 'x'));
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      ok(out.errors.length === 0, '0 console errors', out.errors.slice(0, 6));
    } else if (MODE === 'perf') {
      // cold open (first visit, three from the network), CPU ×RATE from the start
      await throttle(RATE);
      out.cold = await coldOpen();
      await sleep(1500);
      await closeInPage(); await sleep(800);
      out.reopen = []; for (let i = 0; i < 3; i++) { out.reopen.push(await openInPage()); await sleep(800); if (i < 2) { await closeInPage(); await sleep(600); } }
      out.sceneRuns = {}; out.orbit = {};
      for (const d of ['table', 'dog', 'fox', 'land']) {
        const r = await demo(d); out.sceneRuns[d] = r.ms;
        await sleep(1200);
        await ev(`(D37AI3D.core.frames(), window.__a3dt = [], window.__a3on = true, (function f(t){ if (!window.__a3on) return; __a3dt.push(t); requestAnimationFrame(f); })(performance.now()), 1)`);
        await drag(6000); await drag(3000, -1);
        const f = await ev(`(() => { window.__a3on = false; const d = []; for (let i = 1; i < __a3dt.length; i++) d.push(__a3dt[i] - __a3dt[i - 1]); return { cpu: Array.from(D37AI3D.core.frames()), dt: d, st: D37AI3D.core.stats(), info: (() => { const c = document.querySelector('#a3-c'); return { w: c.width, h: c.height }; })() }; })()`);
        const cpu = f.cpu.slice().sort((a, b) => a - b), dt = f.dt.slice().sort((a, b) => a - b);
        out.orbit[d] = { frames: cpu.length, cpuP50: +pct(cpu, .5).toFixed(2), cpuP95: +pct(cpu, .95).toFixed(2), cpuMax: +(cpu[cpu.length - 1] || 0).toFixed(1),
          fps: dt.length ? +(1000 / (dt.reduce((s, x) => s + x, 0) / dt.length)).toFixed(1) : 0, dtP95: +pct(dt, .95).toFixed(1), long50: f.dt.filter(x => x > 50).length,
          tris: f.st.tris_full, trisNow: f.st.tris_now, drawn: f.st.drawn, pixelRatio: f.st.pixelRatio, canvas: f.info, heapMB: await heap() };
        console.log(d, 'build', r.ms, 'ms', JSON.stringify(out.orbit[d]));
      }
      await gc(); out.heapAfterGC = await heap();
      out.idle = await ev(`new Promise(res => { D37AI3D.core.frames(); setTimeout(() => res(D37AI3D.core.frames().length), 3000); })`);
      ok(out.idle === 0, 'idle: no frames rendered when nothing changes (render on demand)', out.idle);
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      ok(out.errors.length === 0, '0 console errors', out.errors.slice(0, 6));
      await throttle(1);
    } else if (MODE === 'leak') {
      const n = +ARG || 20;
      await coldOpen(); await demo('dog'); await sleep(500);
      await closeInPage(); await sleep(500); await gc();
      out.base = await counts(); console.log('  base (after the 1st close)', JSON.stringify(out.base));
      out.cycles = [];
      for (let i = 0; i < n; i++) {
        await openInPage();
        await demo(['dog', 'fox', 'land', 'human', 'dragon'][i % 5]); await drag(400);
        if (i % 4 === 0) await pageGLB();
        if (i % 5 === 2) await click('snap');
        await sleep(300);
        await closeInPage(); await sleep(300);
        if (i % 5 === 4 || i === n - 1) { await gc(); const c = { i: i + 1, ...(await counts()) }; out.cycles.push(c); console.log('  ', JSON.stringify(c)); }
      }
      const last = out.cycles[out.cycles.length - 1];
      ok(last.canvases === out.base.canvases && last.gl2 <= out.base.gl2 + 1 && last.renderers <= out.base.renderers, 'no canvases / WebGL contexts / renderers left', { base: out.base, last });
      ok(last.winListeners <= out.base.winListeners && last.docListeners <= out.base.docListeners, 'no listeners left on window/document', { base: [out.base.winListeners, out.base.docListeners], last: [last.winListeners, last.docListeners] });
      ok(last.heap < out.base.heap + 8, 'heap after GC: no growth (≤ +8 MB after ' + n + ' cycles)', { base: out.base.heap, last: last.heap });
      ok(last.geometries <= out.base.geometries + 5 && last.materials <= out.base.materials + 5, 'three.js geometries / materials released', { base: [out.base.geometries, out.base.materials], last: [last.geometries, last.materials] });
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      ok(out.errors.length === 0, '0 console errors', out.errors.slice(0, 6));
    } else if (MODE === 'soak') {
      const min = +ARG || 10, rows = selfRows();
      await coldOpen(); await throttle(RATE);
      out.minutes = []; const N = { ops: 0, rows: 0, rowsOk: 0, demos: 0, undo: 0, redo: 0, rollback: 0, rollbackBad: 0, exports: 0, exportBad: 0, studio: 0, views: 0, play: 0, orbit: 0, selftest: 0, selftestBad: 0, thrown: 0 };
      const t0 = Date.now(); let lastMin = 0, studioN = 0;
      const pick = a => a[Math.floor(Math.random() * a.length)];
      while (Date.now() - t0 < min * 60000) {
        const r = Math.random(); N.ops++;
        try {
          if (r < .40) {   // self-test rows in order from the start (they build on each other), sometimes from a fresh scene
            const k = 1 + Math.floor(Math.random() * Math.min(rows.length, 12)), fresh = Math.random() < .35;
            const res = await ev(`(() => { ${fresh ? 'D37AI3D.core.reset();' : ''} const R = ${JSON.stringify(rows.slice(0, k).map(x => x.c))}; let ok = 0; for (const c of R) if (D37AI3D.core.run(c).ok) ok++; return ok; })()`);
            N.rows += k; N.rowsOk += res;
          } else if (r < .52) { await demo(pick(['table', 'dog', 'human', 'fox', 'dragon', 'land'])); N.demos++; }
          else if (r < .62) { const u = Math.random() < .6 ? 'undo' : 'redo'; await click(u); N[u]++; }
          else if (r < .70) {   // a broken batch must leave the scene as it was
            const res = await ev(`(() => { const b = JSON.stringify(AI3D.state()); const s = AI3D.state()[0]; const x = D37AI3D.core.run([s ? {op:'set',name:s.name,color:'#00ff00'} : {op:'add',name:'q',type:'box'}, {op:'add',type:'nope-type'}]); return !x.ok && JSON.stringify(AI3D.state()) === b; })()`);
            N.rollback++; if (!res) N.rollbackBad++;
          } else if (r < .77) { const has = await ev(`AI3D.state().filter(o => !o.hidden).length > 0`); if (has) { const g = glbInfo(await pageGLB()); N.exports++; if (!g.magic || g.badExtras.length) N.exportBad++; } }
          else if (r < .79 && studioN < 6) { if (await ev(`AI3D.state().length > 0`)) { await click('studio'); studioN++; N.studio++; await sleep(1500); } }
          else if (r < .84) { await click('snap'); N.views++; }
          else if (r < .88) { await click('play'); await sleep(1200); await click('play'); N.play++; }
          else if (r < .985) { await drag(900, Math.random() < .5 ? 1 : -1); N.orbit++; }
          else { const st = String(await ev(`AI3D.selftest()`)); N.selftest++; if (!/^Все \d+ проверок прошли/.test(st)) { N.selftestBad++; logs.push('selftest: ' + st.split('\n').filter(l => l.startsWith('✗')).join(' | ').slice(0, 300)); } }
        } catch (e) { N.thrown++; logs.push('thrown: ' + e.message.slice(0, 300)); }
        const m = Math.floor((Date.now() - t0) / 60000);
        if (m > lastMin) { lastMin = m; await gc(); const s = await ev(`D37AI3D.core.stats()`); const e = realErrors(logs.filter(l => !l.startsWith('warning'))).length;
          out.minutes.push({ min: m, heap: await heap(), errors: e, ops: N.ops, objects: s.objects, tris: s.tris_full, geomCache: s.geom_cache });
          console.log('  ', JSON.stringify(out.minutes[out.minutes.length - 1])); }
      }
      await throttle(1);
      out.counts = N;
      // what is left after an empty scene (undo history dropped): a leak would stay here
      await ev(`(D37AI3D.core.reset(), 1)`); await gc(); out.heapAfterReset = await heap();
      console.log('  heap after reset + GC', out.heapAfterReset, 'MB');
      console.log('  ops', JSON.stringify(N));
      out.errors = realErrors(logs.filter(l => !l.startsWith('warning')));
      ok(out.errors.length === 0 && N.thrown === 0, min + ' min random ops: 0 errors', out.errors.slice(0, 8));
      ok(N.rollbackBad === 0 && N.exportBad === 0 && N.selftestBad === 0, 'rollbacks keep the scene, exports are clean GLB, selftest passes', N);
      const h = out.minutes.map(x => x.heap);
      ok(h.length < 2 || Math.max(...h) < 400, 'heap stays bounded', h);
    }
  } catch (e) { failed = true; console.log('ERROR', e.stack || e.message); out.error = e.message; }
  out.logs = logs.slice(0, 60);
  out.pass = pass; out.fail = fail;
  const file = path.join(OUT, `ai3d-${MODE}-${PC ? 'pc' : 'phone'}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('written:', file);
  const warnU = [...new Set(logs.filter(l => l.startsWith('warning')).map(l => l.slice(0, 140)))];
  if (warnU.length) console.log('warnings (unique):', warnU.slice(0, 8).join(' | '));
  console.log(`ai3d-e2e ${MODE}: ${pass} ok, ${fail} failed${failed ? ' (crashed)' : ''}`);
  try { ws.close(); } catch (e) {}
  proc.kill(); server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(failed || fail ? 1 : 0); }, 800);
})();

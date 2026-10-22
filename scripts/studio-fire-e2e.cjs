// «Студия 3D» — огонь (T-022d) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): хижина из досок и брёвен, костёр
// (вечный огонь), стена «загорится при ▶»; ▶ Играть — пламя движка (fx.js FX.flames) собралось и рисуется, огонь идёт по стенам,
// сгоревшее исчезает; ЦП кадра до и в пожаре; снимок; ошибок в консоли нет.
// Запуск из корня сайта: node scripts/studio-fire-e2e.cjs [d3d11|swiftshader]   (снимки — <D37_TMP или E:\claude-tmp\t022d>\shots)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [angle = 'd3d11'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t022d' : path.join(os.tmpdir(), 't022d'));
const OUT = path.join(TMP, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  const ev = async (expr, ms = 90000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: null } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const res = {};
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_s3_learn: 'done' };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/studio3d' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await ev(`!!(window.GAME_IMPL?.studio3d?._test?.state()?.R && window.D37E?.studioFire)`, 5000).catch(() => false); }
    ok(up, 'студия открылась, огонь подключён');
    if (!up) throw new Error('студия не открылась');
    // хижина: пол, стены из досок и брёвен вплотную, крыша, костёр рядом, «загорится при ▶»
    res.build = await ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(), SC = ED.SC, wait = ms => new Promise(r => setTimeout(r, ms));
      for (const o of SC.all().slice()) if (o.cls === 'Part' || o.cls === 'Model' || o.cls === 'Prefab') SC.remove(o);
      const add = (o) => SC.add('Part', Object.assign({ anchored: true, color: '#a8743e' }, o));
      add({ name: 'Пол', pos: [0, .25, 0], size: [18, .5, 18], mat: 'concrete', color: '#9ca3af' });
      for (let i = -3; i <= 3; i++) { add({ name: 'С', pos: [i * 2, 2.5, -6], size: [2, 4, .5], mat: 'planks' }); add({ name: 'Ю', pos: [i * 2, 2.5, 6], size: [2, 4, .5], mat: 'planks' }); }
      for (let j = -2; j <= 2; j++) { add({ name: 'З', pos: [-7, 2.5, j * 2.4], size: [.5, 4, 2.4], mat: 'wood', color: '#7a5232' }); add({ name: 'В', pos: [7, 2.5, j * 2.4], size: [.5, 4, 2.4], mat: 'wood', color: '#7a5232' }); }
      add({ name: 'Костёр', pos: [10, .5, 0], size: [1.5, 1, 1.5], mat: 'wood', color: '#5a3a20', fire: 'eternal' });
      add({ name: 'Поджог', pos: [-6, 2.5, -6], size: [2, 4, .5], mat: 'planks', fire: 'start' });
      ED.cam = { x: 18, y: 12, z: 20, yaw: .75, pitch: .35 };
      await wait(1500); return { parts: SC.all().filter(o => o.cls === 'Part').length }; })()`, 60000);
    console.log('постройка', JSON.stringify(res.build));
    res.play = await ev(`(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)); document.querySelector('.s3-play')?.click(); await wait(3000);
      const ED = GAME_IMPL.studio3d._test.state(), st = D37E.studioFire.stats(), R = ED.R, info = R.r.info;
      const bad = (info.programs || []).filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name);
      return { playing: !!ED.playing, st, programs: (info.programs || []).length, bad }; })()`, 60000);
    console.log('играем', JSON.stringify(res.play));
    ok(res.play.playing && res.play.st.burning >= 2, '▶ Играть: костёр и «загорится при ▶» горят', res.play);
    ok(!res.play.bad.length, 'шейдеры пламени собрались', res.play.bad);
    const cpu = `(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)), R = GAME_IMPL.studio3d._test.state().R, s = R.stats; const f0 = s.frames, c0 = s.sumCpu; await wait(4000); const n = Math.max(1, s.frames - f0); return { cpu: +((s.sumCpu - c0) / n).toFixed(2), calls: s.calls, burning: D37E.studioFire.stats().burning }; })()`;
    res.cpu1 = await ev(cpu, 30000); console.log('начало', JSON.stringify(res.cpu1));
    await sleep(22000);
    res.cpu2 = await ev(cpu, 30000); console.log('пожар', JSON.stringify(res.cpu2));
    // снимок: герой снаружи у северной стены, смотрит на хижину
    await ev(`(async () => { const ED = GAME_IMPL.studio3d._test.state(), pl = ED.playing; pl.P.place(4, 1.2, -16, 0); if (pl.rig) { pl.rig.yaw = Math.PI; pl.rig.pitch = .25; } await new Promise(r => setTimeout(r, 900)); return 1; })()`).catch(() => 0);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); fs.writeFileSync(path.join(OUT, 'studio-fire.jpg'), Buffer.from(r.data, 'base64')); console.log('  снимок', path.join(OUT, 'studio-fire.jpg'));
    res.after = await ev(`(async () => { await new Promise(r => setTimeout(r, 30000)); return D37E.studioFire.stats(); })()`, 60000);
    console.log('через 30 с', JSON.stringify(res.after));
    ok(res.after.ignited > 6 && res.after.burnt > 3, 'огонь перекинулся по стенам, сгоревшее исчезло', res.after);
    await ev(`(async () => { document.querySelector('.s3-play')?.click(); await new Promise(r => setTimeout(r, 1500)); return 1; })()`);
    res.stopped = await ev(`(() => { const ED = GAME_IMPL.studio3d._test.state(); return { playing: !!ED.playing, parts: ED.SC.all().filter(o => o.cls === 'Part').length }; })()`);
    ok(!res.stopped.playing && res.stopped.parts === res.build.parts, '■ Стоп — мир как был (все детали на месте)', res.stopped);
    const errs = logs.filter(l => !/X3595|DevTools|favicon|Rapier|rapier/i.test(l));
    ok(!errs.length, 'в консоли — без ошибок и исключений', errs.slice(0, 6));
  } catch (e) { fail++; console.log('ОШИБКА', e.message); for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240)); }
  finally {
    console.log('ЗАМЕР', JSON.stringify(res));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(fail ? `studio-fire-e2e: ${fail} ошибок` : 'studio-fire-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

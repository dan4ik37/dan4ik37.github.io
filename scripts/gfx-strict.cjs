// Графика на «чужих» бэкендах: «Мир Денчика» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) с профилем телефона и
// ANGLE не на Direct3D — SwiftShader (Vulkan → SPIR-V, программно), Vulkan или OpenGL драйвера видеокарты. Компьютер с Direct3D
// многое прощает; здесь шейдеры проходят другой путь сборки (16.10.2026, после «чёрной земли» на телефоне владельца).
// Проверяет: все программы собрались (three: diagnostics), страж графики (post.js) ничего лишнего не выключил, его самопроверка
// прошла, кадр в полдень не чёрный. Картинка — <папка временных файлов>/gfx-strict-<бэкенд>-<пресет>.png.
// Запуск из корня сайта: node scripts/gfx-strict.cjs [swiftshader|vulkan|gl|d3d11] [high|mid|ultra|auto] [плотность пикселей]
// (Chrome — переменная CHROME или стандартный путь Windows; временная папка — D37_TMP, иначе E:\claude-tmp, иначе системная)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [angle = 'swiftshader', preset = 'high', DSF = '1'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
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
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-gfx-strict-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: +DSF || 1, mobile: true });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const base = preset === 'ultra' ? 'high' : preset;
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');${preset === 'auto' ? `localStorage.removeItem('d37_gfx');` : `localStorage.setItem('d37_gfx',${JSON.stringify(base)});`}}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.R)`, 5000); } catch (e) {} }
    ok(up, 'мир открылся');
    if (!up) throw new Error('мир не открылся');
    for (let i = 0; i < 240; i++) { await sleep(500); const t = await ev(`(GAME_IMPL.world._test.state().R.guard || {}).tests ?? -1`, 5000).catch(() => -2); if (t >= 1 || t === -1) break; }
    const res = await ev(`(async () => {
      const S = GAME_IMPL.world._test.state(), R = S.R, P = R.post, G = R.guard;
      S.fixedTime = 12; R.setLighting({ time: 12 });
      await new Promise(r => setTimeout(r, 1500));
      let rep = null; if (G) { G.check(x => { rep = x; }); for (let i = 0; i < 60 && !rep; i++) await new Promise(r => setTimeout(r, 100)); }
      R.render(); const c = R.r.domElement, k = document.createElement('canvas'); k.width = 206; k.height = Math.round(c.height * 206 / c.width);
      const g = k.getContext('2d'); g.drawImage(c, 0, 0, k.width, k.height); const d = g.getImageData(0, 0, k.width, k.height).data;
      let sum = 0, black = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const L = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; sum += L; if (L < 12) black++; n++; }
      const gl = R.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const progs = R.r.info.programs.map(p => ({ name: p.name, ok: !p.diagnostics || p.diagnostics.runnable !== false, log: p.diagnostics ? (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || p.diagnostics.programLog || '').slice(0, 160) : '' }));
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), mobile: D37E.isMobile(), q: R.q,
        post: P && { on: P.on, depthOK: P.depthOK, ao: P.ao.on, rt: P.rt.on, fol: P.fol, codes: P.codesOn() }, rep: rep && { sum: rep.sum, log: rep.log }, off: D37E.gfxGuardInfo().off,
        programs: progs.length, failed: progs.filter(p => !p.ok), withLog: progs.filter(p => p.log).slice(0, 4), frame: { mean: +(sum / n).toFixed(1), black: +(black / n).toFixed(3) }, shot: k.toDataURL('image/png') };
    })()`, 120000);
    const out = path.join(TMP, `gfx-strict-${angle}-${preset}.png`);
    fs.writeFileSync(out, Buffer.from(res.shot.split(',')[1], 'base64')); delete res.shot;
    console.log(`  ${res.renderer} · телефон: ${res.mobile} · качество ${res.q} · программ ${res.programs} · кадр ${JSON.stringify(res.frame)} · ${out}`);
    ok(res.mobile, 'профиль телефона (E.isMobile)');
    ok(!res.failed.length, 'все программы шейдеров собрались', res.failed);
    ok(!res.withLog.length, 'без предупреждений компилятора', res.withLog);
    ok(!res.off.length, 'страж графики ничего не выключил', res.off);
    ok(!res.rep || !res.rep.log.length, 'самопроверка кадра прошла', res.rep);
    ok(res.frame.mean > 60 && res.frame.black < .2, 'кадр в полдень не чёрный', res.frame);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|страж графики|exception/i.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров', bad.slice(0, 4));
  } catch (e) { fail++; console.log('ОШИБКА', e.message); }
  finally { try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
  console.log(fail ? `gfx-strict: ${fail} ошибок` : 'gfx-strict: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

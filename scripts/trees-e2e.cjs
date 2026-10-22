// Деревья «как в модах» (T-022b) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): снимки и замеры «до/после».
// Запуск из корня сайта: node scripts/trees-e2e.cjs <режим> [метка]
//   kb-shots   — «Кубомир», новый мир (зерно «озеро37»): дуб, берёза, ель, сосна, акация, ива, тропическое, сухое, великаны — снимки
//   kb-perf    — «Кубомир» в профиле телефона (412 × 915, ЦП ×4, «средняя»): в лесу — ЦП мс на кадр (среднее, 95 %), FPS, вызовы;
//                генерация чанка (в странице — ЦП ×4, как телефон; и в потоке — по статистике подгрузки), память JS
//   kb-reopen  — «Кубомир»: мир закрыть и открыть N раз (TR_N, 20) — память JS после сборки мусора не растёт
//   kb-soak    — «Кубомир»: TR_MIN минут (10) летает по лесам, рубит деревья, сажает ростки (время игры вперёд), зима/лето — без
//                ошибок в консоли, память не растёт
//   mir-shots  — «Мир Денчика»: лес у озера, боевая зона (танк валит дерево — снимок), снимки
//   mir-perf   — «Мир Денчика» в профиле телефона: лес — ЦП, FPS, вызовы отрисовки, треугольники, память; пролёт над лесом
//   mir-tank   — «Мир Денчика»: удар по дереву в боевой зоне — ствол ломается по месту удара (пень, падает верх), обломки, назад
//   studio     — «Студия 3D»: «🌳 Деревья» в ➕ Деталь, все породы — вставить, снимок; 20 раз новый мир — память
//   SITE_DIR=папка — снимать другую копию сайта («до»: выгрузка прошлого коммита). TR_PHONE=1 — профиль телефона и для снимков.
// Снимки — <D37_TMP или E:\claude-tmp>\t022b\shots\<метка>-<режим>-*.jpg; числа — в конце вывода (JSON)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [MODE = 'kb-shots', label = 'now'] = process.argv.slice(2);
const PHONE = /perf/.test(MODE) || !!process.env.TR_PHONE;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't022b'), SHOTS = path.join(OUT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
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
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } else console.log('ok  ', name); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  fs.mkdirSync(path.join(OUT, 'chrome'), { recursive: true });
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome', 'p-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: OUT, TEMP: OUT } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), logs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }); const f = path.join(SHOTS, `${label}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const res = { mode: MODE, label, site: SITE };
  try {
    await send('Page.enable'); await send('Runtime.enable');
    if (PHONE) {
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const Q = PHONE ? 'mid' : 'high';
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: Q, d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q, shaders: 'auto' }), d37_s3_learn: '1', d37_fsr: 'native',
      d37_kb_opt: JSON.stringify({ rd: PHONE ? 6 : 8, tips: false }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');localStorage.removeItem('d37_mir_pos');}catch(e){}` });
    if (MODE.startsWith('kb')) await kubomir();
    else if (MODE.startsWith('mir')) await mir();
    else if (MODE === 'studio') await studio();
  } catch (e) { if (e.message !== '__готово') { console.log('ОШИБКА', e.message); fail++; } }
  finally {
    const bad = logs.filter(l => /exception|TypeError|ReferenceError|RangeError|Shader Error|WebGLProgram/i.test(l) && !/X3595|favicon|ERR_|net::/.test(l));
    res.errors = bad.slice(0, 12); res.logs = logs.length;
    if (bad.length) { console.log('ОШИБКИ В КОНСОЛИ:'); for (const l of bad.slice(0, 12)) console.log('  ', l); }
    console.log('ИТОГ', JSON.stringify(res));
    fs.writeFileSync(path.join(OUT, `res-${label}-${MODE}.json`), JSON.stringify(res, null, 1));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(fail || (bad.length && !/shots/.test(MODE)) ? 1 : 0);
  }

  // ═══ «Кубомир» ═══
  async function openKubomir(seed = 'озеро37', creative = true){
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(500);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = ${JSON.stringify(seed)}; document.querySelector('[data-f="mode"] [data-v="${creative ? 'creative' : 'survival'}"]')?.click(); document.querySelector('[data-f="diff"] [data-v="peaceful"]')?.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready && GAME_IMPL.kubomir._test.state().WX)`, 3000).catch(() => false); }
    ok(kb, '«Кубомир»: мир открылся');
    if (!kb) throw new Error('мир не открылся');
    res.genVer = await ev(`GAME_IMPL.kubomir._test.state().meta.genVer`);
    await ev(`(async () => { const st = document.createElement('style'); st.textContent = '.kb-lockhint,.e-toast,.kb-tip{display:none!important}'; document.head.appendChild(st); window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); GAME_IMPL.kubomir._test.cam(0); await new Promise(r => setTimeout(r, 1500)); return 1; })()`, 20000);
  }
  function idle(){ return ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); for (let i = 0; i < 160; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await new Promise(r => setTimeout(r, 500)); } return true; })()`, 120000); }
  // встать в стороне от дерева (x, y, z) и смотреть на него: d — расстояние, h — высота глаз над корнем
  function lookAt(x, y, z, d, h, a = 0, c = h){ return ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(), P = S.P; P.fly = true;
    const ax = ${x} + .5 - Math.cos(${a}) * ${d}, az = ${z} + .5 - Math.sin(${a}) * ${d};
    GAME_IMPL.kubomir._test.command('/tp ' + ax.toFixed(1) + ' ' + (${y} + ${h}) + ' ' + az.toFixed(1));
    for (let i = 0; i < 80 && !S.ready; i++) await new Promise(r => setTimeout(r, 300));
    P.fly = true; P.vx = P.vy = P.vz = 0;
    const dx = ${x} + .5 - P.x, dz = ${z} + .5 - P.z; S.rig.yaw = Math.atan2(-dx, -dz); S.rig.fp = Math.atan2(P.y + 1.62 - (${y} + ${c}), Math.sqrt(dx * dx + dz * dz)); S.rig.pitch = S.rig.fp;
    S.R.lighting.time = 10.5; S.paused = true; GAME_IMPL.kubomir._test.hud(false);
    return { x: P.x, y: P.y, z: P.z }; })()`, 120000); }
  async function kubomir(){
    if (MODE === 'kb-perf') {
      // генерация чанка в странице (главный поток, ЦП ×4 — как телефон): одно и то же зерно и чанки «до» и «после» (версия мира — своя)
      await send('Page.navigate', { url: BASE + '/#/games' }); await sleep(3000);
      await ev(`(async () => { for (const f of ['js/engine/voxel.js', 'js/engine/trees.js', 'js/engine/voxel-gen.js']) { const r = await fetch(f, { cache: 'reload' }); if (!r.ok) continue; (0, eval)(await r.text()); } return !!D37E.vox.genChunk; })()`);
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      res.genPhone = await ev(`(() => { const V = D37E.vox, out = {};
        for (const ver of [2, 3]) { if (ver === 3 && !D37E.trees) continue; const G = V.genInit('озеро37', { ver }); V.genChunk(G, 40, 40); const t = performance.now(); let n = 0;
          for (let cx = -9; cx < -1; cx++) for (let cz = -5; cz < 3; cz++) { V.genChunk(G, cx, cz); n++; } out['v' + ver] = +((performance.now() - t) / n).toFixed(2); }
        return out; })()`, 600000);
      console.log('ГЕНЕРАЦИЯ ЧАНКА (ЦП ×4), мс:', JSON.stringify(res.genPhone));
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    }
    await openKubomir();
    await idle();
    if (MODE === 'kb-gallery') {
      // ровная поляна у начала мира, все породы рядом (как ставит генератор v3: ствол, ветки, листва своей породы) — снимки с трёх сторон
      const g = await ev(`(async () => {
        const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, TR = D37E.trees, W = S.W, P = S.P, ID = V.ID;
        const x0 = Math.floor(P.x) - 40, z0 = Math.floor(P.z) - 14, gy = Math.max(60, Math.floor(P.y));
        const set = (x, y, z, v) => W.set(x, y, z, v, { urgent: 1 });
        for (let x = x0 - 6; x <= x0 + 92; x++) for (let z = z0 - 18; z <= z0 + 46; z++) { for (let y = gy; y <= gy + 40; y++) if (W.raw(x, y, z) > 0) set(x, y, z, 0); set(x, gy - 1, z, ID.grass); for (let y = gy - 4; y < gy - 1; y++) set(x, y, z, ID.dirt); }
        const L = ${JSON.stringify(['oak', 'birch', 'spruce', 'pine', 'acacia', 'willow', 'tropical', 'dead', 'giant_oak', 'giant_spruce'])};
        const W2 = { oak: 'oak', birch: 'birch', spruce: 'spruce', pine: 'spruce', giant_spruce: 'spruce', acacia: 'acacia', tropical: 'jungle', willow: 'oak', dead: 'oak', giant_oak: 'oak' }, LF = { willow: 'willow', tropical: 'jungle', pine: 'spruce', giant_spruce: 'spruce', giant_oak: 'oak', dead: 'oak' };
        const at = [];
        L.forEach((sp, i) => { const big = /giant/.test(sp), x = x0 + (big ? 20 + (i - 8) * 34 : i * 10), z = big ? z0 + 30 : z0, w = W2[sp], log = ID['log_' + w], thin = ID['log_' + w + '_thin'], leaf = ID['leaves_' + (LF[sp] || w)];
          const vx = TR.voxels(TR.grow(sp, 1000 + i * 77)); at.push([sp, x, z]);
          for (let k = 0; k < vx.n; k++) { const a = x + vx.x[k], b = gy + vx.y[k], c = z + vx.z[k], t = vx.t[k]; if (b < gy - 1) continue; if (t === 0) { if (W.raw(a, b, c) === 0) set(a, b, c, leaf); } else set(a, b, c, V.cell(t === 1 ? thin : log, vx.a[k])); } });
        return { x0, z0, gy, at };
      })()`, 120000);
      await idle(); await sleep(3000);
      const v = async (name, x, y, z, yaw, fp) => { await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(), P = S.P; P.fly = true; Object.assign(P, { x: ${x}, y: ${y}, z: ${z}, vx: 0, vy: 0, vz: 0 }); S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; S.R.lighting.time = 10.5; S.paused = true; GAME_IMPL.kubomir._test.hud(false); await new Promise(r => setTimeout(r, 2500)); return 1; })()`, 30000); await shot('kb-gallery-' + name); };
      const { x0, z0, gy } = g;
      await v('row1', x0 + 18, gy + 6, z0 - 22, Math.PI, .05);        // первые породы — с юга
      await v('row2', x0 + 62, gy + 6, z0 - 22, Math.PI, .05);
      await v('giants', x0 + 22, gy + 12, z0 + 6, Math.PI, -.1);        // великаны — из-за ряда
      await v('top', x0 + 45, gy + 45, z0 - 20, Math.PI, .9);           // сверху
      res.gallery = g;
      // зима: опала листва
      await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); try { S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'winter', weather: 'clear', lapse: 0, seaY: 52 }); } catch (e) {} await new Promise(r => setTimeout(r, 2500)); return 1; })()`, 30000);
      await idle(); await sleep(4000);
      await v('row1-winter', x0 + 18, gy + 6, z0 - 22, Math.PI, .05);
      await v('giants-winter', x0 + 22, gy + 12, z0 + 6, Math.PI, -.1);
      return;
    }
    if (MODE === 'kb-shots') {
      const SP = [['oak', 27, 60, 0, 15, 5, 5], ['acacia', 16, 54, 30, 15, 4, 4], ['birch', -65, 54, -9, 14, 5, 6], ['spruce', 46, 84, 94, 16, 6, 6], ['willow', 18, 87, 89, 15, 4, 4], ['pine', -70, 85, 88, 18, 8, 8],
        ['dead', 23, 66, 129, 11, 3, 4], ['giant_oak', -143, 53, -59, 34, 12, 11], ['giant_spruce', -128, 56, 115, 34, 13, 13], ['tropical', -46, 53, -323, 24, 9, 10]];
      for (const [name, x, y, z, d, h, c] of SP) {
        if (process.env.TR_ONLY && !process.env.TR_ONLY.split(',').includes(name)) continue;
        await lookAt(x, y, z, d, h, 0, c);
        await idle(); await sleep(2500);
        await shot('kb-' + name);
      }
      // зима: те же дубы — голые ветки (сетка без опавшей листвы)
      await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); try { S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'winter', weather: 'clear', lapse: 0, seaY: 52 }); } catch (e) {} await new Promise(r => setTimeout(r, 2500)); return S.WX.clim?.state?.bare; })()`, 30000);
      await lookAt(-143, 53, -59, 34, 12, 0, 11); await idle(); await sleep(3500); await shot('kb-giant_oak-winter');
      await lookAt(27, 60, 0, 15, 5, 0, 5); await idle(); await sleep(3000); await shot('kb-oak-winter');
      res.bare = await ev(`GAME_IMPL.kubomir._test.state().ST.bare`);
      return;
    }
    if (MODE === 'kb-perf') {
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const spots = [['лес (великан, дубы)', -143, 53, -59, 16, 3], ['ели', -128, 56, 115, 14, 3], ['равнина (дуб, акация)', 27, 60, 0, 12, 3]];
      res.perf = {};
      for (const [name, x, y, z, d, h] of spots) {
        await lookAt(x, y, z, d, h);
        await send('Emulation.setCPUThrottlingRate', { rate: 1 }); await idle(); await send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await sleep(4000);
        const r = await ev(`(async () => {
          const S = GAME_IMPL.kubomir._test.state(); S.paused = false;
          const cpu = [], dts = []; let run = true;
          const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          await new Promise(r => setTimeout(r, 12000)); run = false;
          cpu.sort((a, b) => a - b);
          const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length), info = S.R.r.info;
          return { frames: cpu.length, cpu: +avg(cpu).toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls, tris: info.render.triangles, q: S.R.q, chunks: S.W.chunks.size };
        })()`, 90000);
        res.perf[name] = r; console.log('ЗАМЕР', name, JSON.stringify(r));
      }
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      res.genWorker = await ev(`(() => { const s = GAME_IMPL.kubomir._test.state().ST.stats; return { gen: s.gen, genMs: +(s.genMs / Math.max(1, s.gen)).toFixed(2), mesh: s.mesh, meshMs: +(s.meshMs / Math.max(1, s.mesh)).toFixed(2) }; })()`);
      console.log('ПОТОК (ЦП ПК): генерация и сетка на чанк, мс', JSON.stringify(res.genWorker));
      res.heapMB = await heap(); console.log('память JS, МБ', res.heapMB);
      return;
    }
    if (MODE === 'kb-reopen') {
      const hs = [], N = +process.env.TR_N || 20;
      for (let i = 0; i < N; i++) {
        await idle(); await sleep(1500); hs.push(await heap());
        await ev(`(async () => { await GAME_IMPL.kubomir._test.stop(); GAME_IMPL.kubomir._test.menu(); return true; })()`, 60000);
        for (let k = 0; k < 60; k++) { await sleep(500); if (await ev(`!!document.querySelector('.kb-world [data-w="play"]')`, 3000).catch(() => false)) break; }
        await ev(`(() => { const b = document.querySelector('.kb-world [data-w="play"]'); b && b.click(); return !!b; })()`);
        let up = false; for (let k = 0; k < 240 && !up; k++) { await sleep(500); up = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready)`, 3000).catch(() => false); }
        if (!up) { ok(false, 'мир снова открылся (' + (i + 1) + ')'); break; }
        if (i % 3 === 0) await lookAt(-143, 53, -59, 16, 3);   // в лесу у великана (деревья в кэше потоков и сетки)
      }
      await idle(); await sleep(1500); hs.push(await heap());
      res.reopen = hs; console.log('ЗАМЕР reopen, память JS после сборки мусора (МБ):', hs.join(' → '));
      ok(hs.length >= N && hs[hs.length - 1] - hs[1] < 25, 'закрыть/открыть мир ' + N + ' раз — память не растёт', hs);
      return;
    }
    if (MODE === 'kb-soak') {
      const MIN = +process.env.TR_MIN || 10, t0 = Date.now(), hs = [await heap()];
      const SP = [[27, 60, 0], [16, 54, 30], [-65, 54, -9], [46, 84, 94], [18, 87, 89], [-70, 85, 88], [23, 66, 129], [-143, 53, -59], [-128, 56, 115]];
      let k = 0, felled = 0, planted = 0, grown = 0;
      while (Date.now() - t0 < MIN * 60000) {
        const [x, y, z] = SP[k++ % SP.length];
        await lookAt(x, y, z, 6, 2, k * .7);
        await idle(); await sleep(1200);
        const r = await ev(`(async () => {
          const S = GAME_IMPL.kubomir._test.state(), W = S.W, V = D37E.vox, out = { fell: 0, plant: 0, grown: 0 };
          // срубить низ ствола (все клетки ствола у корня) — дерево валится
          let cut = 0; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const v = W.raw(${x} + dx, ${y}, ${z} + dz); if (v > 0 && V.T.tree[v & 0xfff] === 1) { W.set(${x} + dx, ${y}, ${z} + dz, 0, { urgent: 3 }); if (S.ents.fellTree(${x} + dx, ${y}, ${z} + dz, S.P)) out.fell++; cut++; } }
          // посадить ростки рядом и промотать время игры
          const kinds = ['oak', 'birch', 'spruce', 'acacia', 'jungle', 'willow'];
          for (let i = 0; i < 3; i++) { const px = ${x} + 4 + i * 3, pz = ${z} + 4, py = W.heightAt(px, pz); if (py > 0 && W.get(px, py, pz) === 0) { W.set(px, py, pz, V.cell(V.ID['sapling_' + kinds[(i + ${k}) % kinds.length]]), { urgent: 1 }); out.plant++; } }
          S.meta.gt = (S.meta.gt || 0) + 2000; const g0 = S.ents.grow.size; S.ents.growTick(); out.grown = g0 - S.ents.grow.size;
          S.paused = false; const C = S.C; C.press('forward', true); await new Promise(r => setTimeout(r, 2500)); C.press('forward', false);
          // времена года: зима ↔ лето
          try { S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: ${k} % 2 ? 'winter' : 'summer', weather: ${k} % 3 ? 'clear' : 'rain', lapse: 0, seaY: 52 }); } catch (e) {}
          return out; })()`, 60000);
        felled += r.fell; planted += r.plant; grown += r.grown;
        if (k % 6 === 0) { hs.push(await heap()); console.log('  прогон', Math.round((Date.now() - t0) / 1000), 'с: срублено', felled, 'посажено', planted, 'выросло', grown, 'память', hs[hs.length - 1], 'МБ'); }
      }
      hs.push(await heap());
      res.soak = { min: MIN, felled, planted, grown, heap: hs };
      ok(felled > 5 && grown > 0, 'деревья падают, ростки растут', res.soak);
      ok(hs[hs.length - 1] - Math.min(...hs.slice(1, 3)) < 40, 'память JS за прогон не растёт', hs);
      return;
    }
  }

  // ═══ «Мир Денчика» ═══
  async function openMir(){
    await send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
    ok(up, '«Мир Денчика»: открылся');
    if (!up) throw new Error('мир не открылся');
    await ev(`(() => { const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; } const S = GAME_IMPL.world._test.state(); S.fixedTime = 11; const st = document.createElement('style'); st.textContent = '.e-toast,.wld-hint{display:none!important}'; document.head.appendChild(st); return 1; })()`);
  }
  // точка в лесу: самое лесистое место у (x, z) — по WM.forest
  function mirPlace(x, z, yaw, dist){ return ev(`(async () => { const S = GAME_IMPL.world._test.state(), z = S.zones, W = MirZones.worldMap();
    let best = null; for (let r = 0; r < 600 && !best; r += 20) for (let a = 0; a < 16; a++) { const px = ${x} + Math.cos(a / 16 * 6.283) * r, pz = ${z} + Math.sin(a / 16 * 6.283) * r; if (W.forest(px, pz) > .9 && W.height(px, pz) > W.SEA + 4 && W.height(px, pz) < 110) { best = [px, pz]; break; } }
    if (!best) best = [${x}, ${z}];
    S.P.place(best[0], W.height(best[0], best[1]) + .3, best[1], ${yaw});
    if (S.rig) { S.rig.yaw = ${yaw}; if (${dist}) { S.rig.dist = ${dist}; S.rig.pitch = .32; } }
    await new Promise(r => setTimeout(r, 3500)); return best; })()`, 60000); }
  async function mir(){
    await openMir();
    if (MODE === 'mir-shots') {
      res.place = await mirPlace(-760, -560, 0, 9);
      await sleep(2500); await shot('mir-forest');
      await ev(`(() => { const S = GAME_IMPL.world._test.state(); S.rig.yaw += 2.2; S.rig.dist = 16; S.rig.pitch = .5; return 1; })()`); await sleep(2500); await shot('mir-forest-2');
      await ev(`(() => { const S = GAME_IMPL.world._test.state(); S.rig.dist = 40; S.rig.pitch = .55; return 1; })()`); await sleep(3500); await shot('mir-forest-far');
      await mirPlace(-300, -1500, 1, 10); await sleep(3000); await shot('mir-conifer');
      return;
    }
    if (MODE === 'mir-perf') {
      res.place = await mirPlace(-760, -560, 0, 9);
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await sleep(5000);
      res.perf = {};
      for (const [name, js] of [['лес', ''], ['лес, вид сверху', 'S.rig.dist = 40; S.rig.pitch = .55;']]) {
        const r = await ev(`(async () => { const S = GAME_IMPL.world._test.state(), R = S.R; ${js}
          await new Promise(r => setTimeout(r, 3000)); const ST = R.stats; ST.frames = ST.sumDt = ST.maxDt = ST.sumCpu = ST.maxCpu = ST.sumR = 0;
          await new Promise(r => setTimeout(r, 10000));
          const n = Math.max(1, ST.frames), m = R.r.info.memory, wm = S.zones.wmv;
          return { fps: +(1000 / (ST.sumDt / n)).toFixed(1), cpu: +(ST.sumCpu / n).toFixed(2), cpuMax: +ST.maxCpu.toFixed(1), calls: ST.calls, tris: R.r.info.render.triangles, geo: m.geometries, tex: m.textures, trees: wm?.treeStats?.() || null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; })()`, 60000);
        res.perf[name] = r; console.log('ЗАМЕР', name, JSON.stringify(r));
      }
      // пролёт над лесом: подгрузка деревьев (рывки)
      const r2 = await ev(`(async () => { const S = GAME_IMPL.world._test.state(), W = MirZones.worldMap(), P = S.P; const dts = []; let last = performance.now(), d = 0;
        const x0 = P.ch.x, z0 = P.ch.z;
        await new Promise(done => { const t = now => { dts.push(now - last); last = now; d += 22 * Math.min(.1, dts[dts.length - 1] / 1000); const x = x0 + d, z = z0 + d * .4; P.place(x, W.height(x, z) + .3, z, 1.2); if (d < 400) requestAnimationFrame(t); else done(); }; requestAnimationFrame(n => { last = n; requestAnimationFrame(t); }); });
        dts.sort((a, b) => a - b); return { frames: dts.length, p50: +dts[dts.length >> 1].toFixed(1), p95: +dts[Math.floor(dts.length * .95)].toFixed(1), long: dts.filter(x => x > 50).length, worst: +dts[dts.length - 1].toFixed(0) }; })()`, 240000);
      res.perf.flight = r2; console.log('ПРОЛЁТ', JSON.stringify(r2));
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      res.heapMB = await heap();
      return;
    }
    if (MODE === 'mir-tank') {
      // боевая зона: дерево карты в зоне войны (или любое рядом) — удар на высоте 1,2 → пень и падающий верх
      const r = await ev(`(async () => { const S = GAME_IMPL.world._test.state(), z = S.zones, DS = z.destruct, W = MirZones.worldMap();
        let t = null; W.trees(-700, -700, 700, 700, (x, y, zz, k, pine) => { if (!t && Math.hypot(x - S.P.ch.x, zz - S.P.ch.z) < 2000) { const zn = z.zoneAt ? z.zoneAt(x, zz) : null; if (!zn || zn.id === 'war') t = { x, y, z: zz, k, pine }; } });
        if (!t) return { none: true };
        S.P.place(t.x - 6, W.height(t.x - 6, t.z) + .3, t.z, Math.PI / 2); S.rig.yaw = -Math.PI / 2; S.rig.dist = 9; S.rig.pitch = .25;
        await new Promise(r => setTimeout(r, 2500));
        const n = DS.hit(t.x, t.z, .6, 9, { y: t.y + 1.2, dx: 1, dz: 0 });
        await new Promise(r => setTimeout(r, 250));
        return { t, n, stats: DS.stats() }; })()`, 60000);
      res.tank = r; console.log('УДАР', JSON.stringify(r));
      await shot('mir-tree-hit-0');
      await sleep(900); await shot('mir-tree-hit-1');
      await sleep(2200); await shot('mir-tree-hit-2');
      res.tank2 = await ev(`GAME_IMPL.world._test.state().zones.destruct.stats()`);
      ok(r.n >= 1, 'удар валит дерево', r);
      return;
    }
  }

  // ═══ «Студия 3D» ═══
  async function studio(){
    await send('Page.navigate', { url: BASE + '/#/games/studio3d' });
    let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await ev(`!!(GAME_IMPL.studio3d?._test?.state()?.SC)`, 3000).catch(() => false); }
    ok(up, '«Студия 3D»: открылась');
    if (!up) throw new Error('студия не открылась');
    const r = await ev(`(async () => { const ed = GAME_IMPL.studio3d._test.state(), list = window.D37E.trees?.LIST || [];
      const btn = ed.q('[data-a="menu:part"]'); btn?.click(); await new Promise(r => setTimeout(r, 300));
      const items = [...ed.q('.s3-menu').querySelectorAll('[data-m^="tree:"]')].map(b => b.dataset.m);
      ed.q('.s3-menu').hidden = true;
      let i = 0; for (const k of list) { const o = ed.SC.add('Prefab', { kind: 'tree_' + k, pos: [(i % 5) * 9 - 18, 0, Math.floor(i / 5) * 12 - 6] }); i++; }
      ed.R.camera.position.set(0, 14, 34); ed.R.camera.lookAt(0, 6, 0);
      await new Promise(r => setTimeout(r, 1500));
      return { menu: items, n: ed.SC.all().filter(o => o.cls === 'Prefab' && /^tree_/.test(o.kind)).length, calls: ed.R.r.info.render.calls }; })()`, 60000);
    res.studio = r; console.log('СТУДИЯ', JSON.stringify(r));
    await shot('studio-trees');
    ok(r.menu.length >= 8 && r.n >= 8, '«🌳 Деревья» в ➕ Деталь, все породы ставятся', r);
  }
})().catch(e => { console.error(e); process.exit(1); });

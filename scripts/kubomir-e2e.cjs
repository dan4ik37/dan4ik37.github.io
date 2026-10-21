// «Кубомир» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm): снимки для сравнения «до/после» — зимнее озеро с берёзами
// при низком солнце (отражения, тени, снег на блоках, лёд), даль от 1-го лица (чёткость), рамка постройки на снегу и в пещере,
// дождь; все программы шейдеров собрались, страж графики ничего не выключил.
// Запуск из корня сайта: node scripts/kubomir-e2e.cjs [метка] [ultra|high|mid] [d3d11|swiftshader]
//   SITE_DIR=папка — снимать другую копию сайта (например, выгрузку прошлого коммита: «до»)
// Снимки — <D37_TMP или E:\claude-tmp>\kubomir2\shots\<метка>-<пресет>-*.jpg
// KB_MODE=perf — замер в профиле телефона (412 × 915, ЦП ×4 медленнее, пресет из аргумента — «средняя» = mid): ясно, снег, дождь —
//   ЦП мс на кадр (среднее, 95 %, худший), FPS, вызовы, память JS; «до» — SITE_DIR=выгрузка прошлого коммита
// KB_MODE=soak — 10 мин игры (KB_MIN — другое число минут): ходит, прыгает, плавает и лезет на стены, ставит и ломает блоки,
//   погода и время суток меняются, телепорты — ошибок и исключений в консоли нет, память JS после сборки мусора — не растёт
// KB_MODE=reopen — мир закрыть и открыть 8 раз: память JS после сборки мусора — не растёт
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [label = 'now', preset = 'ultra', angle = 'd3d11'] = process.argv.slice(2);
const MODE = process.env.KB_MODE || '';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = path.join(TMP, 'kubomir2', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
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
  const profile = fs.mkdtempSync(path.join(TMP, 'kubomir2', 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: path.join(TMP, 'kubomir2'), TEMP: path.join(TMP, 'kubomir2') } });
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
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 }); const f = path.join(SHOTS, `${label}-${preset}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f; };
  const progsOk = `R => { const L = R.r.info.programs || []; return { n: L.length, bad: L.filter(p => p.diagnostics && p.diagnostics.runnable === false).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || p.diagnostics.vertexShader.log || '').slice(0, 300)) }; }`;
  const res = {};
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const idle = () => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); for (let i = 0; i < 160; i++) { const s = S.ST?.stats; if (S.ready && s && !s.jobs && !s.pend) break; await new Promise(r => setTimeout(r, 500)); } return true; })()`, 120000);
  async function runMode(){
    if (MODE === 'perf') {
      await idle(); await sleep(8000);
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const CL = { mode: 'fixed', season: 'summer', weather: 'clear' }, SN = { mode: 'fixed', season: 'winter', weather: 'snow' }, RN = { mode: 'fixed', season: 'summer', weather: 'rain' };
      const Y0 = await ev(`GAME_IMPL.kubomir._test.state().rig.yaw`);
      for (const [name, w] of [['прогрев', CL], ['ясно', CL], ['снег', SN], ['дождь', RN], ['ясно 2', CL], ['снег 2', SN], ['дождь 2', RN]]) {
        const r = await ev(`(async () => {
          const S = GAME_IMPL.kubomir._test.state(), wait = ms => new Promise(r => setTimeout(r, ms));
          S.R.lighting.time = 12;
          try { S.WX.clim.setWorld(Object.assign({ seed: 'kb', lapse: 0, seaY: 52 }, ${JSON.stringify(w)})); if ('cover' in S.WX) S.WX.cover = -1; } catch (e) {}
          await wait(7000);
          const cpu = [], dts = []; let run = true;
          S.rig.yaw = ${Y0}; S.rig.fp = .15;   // камера стоит (одни и те же чанки в кадре — сравнимо «до» и «после»)
          const tick = () => { if (!run) return; const st = S.R.stats; cpu.push(st.cpuFrame); dts.push(st.dt); requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          await wait(15000); run = false;
          cpu.sort((a, b) => a - b);
          const avg = a => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
          return { frames: cpu.length, cpu: +avg(cpu).toFixed(2), p95: +cpu[Math.floor(cpu.length * .95)].toFixed(2), max: +cpu[cpu.length - 1].toFixed(2), fps: +(1000 / avg(dts)).toFixed(1), calls: S.R.stats.calls, q: S.R.q, wx: S.WX.stats?.() };
        })()`, 90000);
        res['perf ' + name] = r; console.log('ЗАМЕР', name, JSON.stringify({ ...r, wx: undefined }));
      }
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      res.heapMB = await heap(); console.log('память JS, МБ', res.heapMB);
      return;
    }
    if (MODE === 'soak') {
      const MIN = +process.env.KB_MIN || 10, t0 = Date.now(), h0 = await heap(), ex0 = logs.length;
      await idle();
      let n = 0;
      while (Date.now() - t0 < MIN * 60000) {
        n++;
        const r = await ev(`(async () => {
          const n = ${n}, S = GAME_IMPL.kubomir._test.state(), T = GAME_IMPL.kubomir._test, wait = ms => new Promise(r => setTimeout(r, ms)), C = S.C, rnd = Math.random;
          if (!S || !S.ready) { await wait(2000); return { n, wait: true }; }
          const dead = document.querySelector('.kb-dead [data-m]'); if (dead) { dead.click(); await wait(1500); }
          if (n % 6 === 0) { const W = [{ mode: 'fixed', season: 'winter', weather: 'snow' }, { mode: 'fixed', season: 'summer', weather: 'rain' }, { mode: 'fixed', season: 'summer', weather: 'clear' }, { mode: 'fixed', season: 'winter', weather: 'clear' }][(n / 6) % 4 | 0]; try { S.WX.clim.setWorld(Object.assign({ seed: 'kb', lapse: 0, seaY: 52 }, W)); } catch (e) {} }
          if (n % 9 === 0) S.R.lighting.time = [6, 12, 18.5, 23, 2][(n / 9) % 5 | 0];
          if (n % 15 === 0) { S.dbg = !S.dbg; }
          if (n % 20 === 0) T.cam?.((n / 20) % 3 | 0);
          if (n % 25 === 0) { const P = S.P, x = P.x + (rnd() - .5) * 500, z = P.z + (rnd() - .5) * 500; if (T.teleport) T.teleport(x, 110, z); else T.command('/tp ' + x.toFixed(1) + ' 110 ' + z.toFixed(1)); await wait(3000); for (let i = 0; i < 40 && !S.ready; i++) await wait(500); }
          // ходит, прыгает (у стен — лезет, в воде — плывёт и вылезает), смотрит по сторонам
          S.rig.yaw += (rnd() - .5) * 2.5; S.rig.fp = (rnd() - .4) * .5;
          C.press('forward', true); if (rnd() < .6) C.press('jump', true); if (rnd() < .3) C.press('run', true);
          await wait(3500);
          C.press('jump', false); C.press('run', false); C.press('forward', false);
          // ставит и ломает
          if (n % 3 === 0) { T.give?.({ id: ['planks_oak', 'stone', 'torch', 'glass'][n % 4], n: 16 }); S.P.sel = 0; for (let i = 0; i < 3; i++) { T.use?.(); await wait(150); T.dig?.(); await wait(150); } }
          await wait(800);
          return { n, x: Math.round(S.P.x), y: Math.round(S.P.y), z: Math.round(S.P.z), hp: S.P.hp, pk: !!S.P.pk, hang: !!S.P.hang, water: S.P.water > .3, wx: S.WX.stats?.().zone };
        })()`, 60000).catch(e => ({ n, err: e.message }));
        if (n % 10 === 0) console.log('  шаг', JSON.stringify(r), Math.round((Date.now() - t0) / 1000) + ' с');
      }
      const h1 = await heap(), errs = logs.slice(ex0).filter(l => !/X3595|DevTools|favicon/i.test(l));
      res.soak = { minutes: MIN, steps: n, heap0: h0, heap1: h1, errors: errs.length, first: errs.slice(0, 6) };
      console.log('ЗАМЕР soak', JSON.stringify(res.soak));
      ok(!errs.length, MIN + ' мин игры — без ошибок и исключений в консоли', errs.slice(0, 6));
      return;
    }
    if (MODE === 'reopen') {
      const hs = [];
      for (let i = 0; i < 8; i++) {
        await idle(); await new Promise(r => setTimeout(r, 2000));
        hs.push(await heap());
        await ev(`(async () => { await GAME_IMPL.kubomir._test.stop(); GAME_IMPL.kubomir._test.menu(); return true; })()`, 60000);
        for (let k = 0; k < 60; k++) { await sleep(500); if (await ev(`!!document.querySelector('.kb-world [data-w="play"]')`, 3000).catch(() => false)) break; }
        await ev(`(() => { const b = document.querySelector('.kb-world [data-w="play"]'); b && b.click(); return !!b; })()`);
        let up = false; for (let k = 0; k < 240 && !up; k++) { await sleep(500); up = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready)`, 3000).catch(() => false); }
        if (!up) { ok(false, 'мир снова открылся (' + (i + 1) + ')'); break; }
      }
      await idle(); await new Promise(r => setTimeout(r, 2000)); hs.push(await heap());
      res.reopen = hs; console.log('ЗАМЕР reopen, память JS после сборки мусора (МБ):', hs.join(' → '));
      ok(hs.length >= 8 && hs[hs.length - 1] - hs[1] < 25, 'закрыть/открыть мир 8 раз — память не растёт', hs);
      return;
    }
  }
  try {
    await send('Page.enable'); await send('Runtime.enable');
    if (MODE === 'perf') {   // профиль телефона
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const base = preset === 'ultra' ? 'high' : preset;
    // настройки как у владельца: пресет графики, наборы шейдеров — «Авто» (у «Ультра» — «Ультра»), без генерации кадров
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: base, d37_settings: JSON.stringify({ gfxPreset: preset, gfx: base, shaders: 'auto' }), d37_s3_learn: '1', d37_fsr: 'native',
      d37_kb_opt: JSON.stringify({ rd: 8, tips: false }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_gfx_guard');}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
    for (let i = 0; i < 120; i++) { await sleep(500); const okm = await ev(`!!document.querySelector('.kb-menu')`, 3000).catch(() => false); if (okm) break; }
    await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`);
    await sleep(500);
    await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 'озеро37'; const c = document.querySelector('[data-f="mode"] [data-v="${MODE === 'soak' ? 'survival' : 'creative'}"]'); c && c.click(); const g = document.querySelector('[data-n="go"]'); g && g.click(); return !!g; })()`);
    let kb = false;
    for (let i = 0; i < 240 && !kb; i++) { await sleep(500); kb = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready && GAME_IMPL.kubomir._test.state().WX)`, 3000).catch(() => false); }
    if (!kb) { await shot('debug-open'); console.log('  состояние:', JSON.stringify(await ev(`(() => { const S = GAME_IMPL.kubomir?._test?.state(); return S ? { ready: S.ready, wx: !!S.WX, view: document.querySelector('.kb-screen')?.textContent?.slice(0, 200) } : { none: true, html: document.querySelector('.kb-screen')?.innerText?.slice(0, 300) }; })()`).catch(e => e.message))); }
    ok(kb, '«Кубомир»: мир открылся');
    if (!kb) throw new Error('мир не открылся');
    if (MODE) { await runMode(); throw new Error('__готово'); }
    // ── сцена: ровная площадка, озеро, берёзы (одинаково «до» и «после»: только публичное — st.W, st.P, st.rig) ──
    // сцена — в обычной климатической зоне (снег и лёд зимой; у новых версий — зоны «всегда зима» / «зимы нет»), рядом с началом
    res.place = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, P = S.P;
      if (!G || !V.climZoneAt) return { moved: false, why: 'старая версия' };
      const col = {}, good = (x, z) => { for (let dx = -18; dx <= 30; dx += 4) for (let dz = -20; dz <= 20; dz += 4) { if (V.climZoneAt(G, x + dx, z + dz, col) !== 0) return false; const c = V.genColumn(G, x + dx, z + dz, col); if (c.h <= V.SEA + 1 || c.h > V.SEA + 24) return false; } return true; };
      const x0 = Math.floor(P.x), z0 = Math.floor(P.z);
      if (good(x0, z0)) return { moved: false };
      for (let r = 48; r < 3000; r += 48) for (let a = 0; a < 32; a++) {
        const x = Math.round(x0 + r * Math.cos(a / 32 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 32 * 6.2832));
        if (!good(x, z)) continue;
        const h = V.genColumn(G, x, z, col).h;
        GAME_IMPL.kubomir._test.command('/tp ' + (x + .5) + ' ' + (h + 2) + ' ' + (z + .5));
        for (let i = 0; i < 80 && !S.ready; i++) await wait(500);
        await wait(5000);
        for (let i = 0; i < 40 && !P.onGround; i++) await wait(250);
        return { moved: true, x, z, h, ready: S.ready };
      }
      return { moved: false, why: 'нет места' };
    })()`, 120000);
    const scene = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID;
      const cx = Math.floor(P.x), cz = Math.floor(P.z), gy = Math.floor(P.y);
      const set = (x, y, z, n) => W.set(x, y, z, n ? V.cell(ID[n]) : 0, { urgent: 1 });
      for (let x = cx - 14; x <= cx + 26; x++) for (let z = cz - 16; z <= cz + 16; z++) {
        for (let y = gy; y <= gy + 24; y++) if (W.raw(x, y, z) > 0) set(x, y, z, null);
        set(x, gy - 1, z, 'grass'); for (let y = gy - 5; y < gy - 1; y++) set(x, y, z, 'dirt');
      }
      for (let x = cx + 3; x <= cx + 13; x++) for (let z = cz - 6; z <= cz + 6; z++) for (let y = gy - 4; y <= gy - 1; y++) set(x, y, z, 'water');
      const tree = (x, z, h) => { for (let y = gy; y < gy + h; y++) set(x, y, z, 'log_birch'); const t = gy + h - 1; for (let y = t - 2; y <= t + 1; y++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { if (y > t - 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue; if (dx || dz || y > t) if (W.raw(x + dx, y, z + dz) === 0) set(x + dx, y, z + dz, 'leaves_birch'); } };
      tree(cx + 4, cz + 9, 6); tree(cx + 9, cz + 9, 7); tree(cx + 14, cz + 8, 6); tree(cx + 16, cz - 2, 7); tree(cx + 2, cz - 9, 6); tree(cx + 11, cz - 9, 6);
      Object.assign(P, { x: cx - 2.5, y: gy, z: cz + .5, vx: 0, vy: 0, vz: 0, fly: false });
      S.rig.yaw = -Math.PI / 2; S.rig.fp = .32;
      await wait(4000);
      return { cx, cz, gy };
    })()`, 120000);
    res.scene = scene;
    // зоны климата вокруг (по чанкам: какие зоны в чанке; '-' — чанка нет / без зон)
    res.zoneMap = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, cx = Math.floor(S.P.x) >> 4, cz = Math.floor(S.P.z) >> 4, rows = [];
      for (let dz = -2; dz <= 2; dz++) { let r = ''; for (let dx = -2; dx <= 2; dx++) { const c = W.chunk(cx + dx, cz + dz); r += (c && c.zone ? [...new Set(c.zone)].sort().join('') : '-').padEnd(4); } rows.push(r); }
      const G = S.G, col = {}; let mism = 0; if (G && V.climZoneAt) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) { const c = W.chunk(cx + dx, cz + dz); if (!c || !c.zone) continue; for (let i = 0; i < 256; i += 5) if (c.zone[i] !== V.climZoneAt(G, (cx + dx) * 16 + (i >> 4), (cz + dz) * 16 + (i & 15), col)) mism++; }
      return { rows, mism, wx: S.WX.stats() }; })()`);
    // во весь окно (без шапки сайта), без подсказок поверх (тост, «нажми на мир») — чтобы на снимке был только мир
    await ev(`(async () => { const st = document.createElement('style'); st.textContent = '.kb-lockhint,.e-toast,.kb-tip{display:none!important}'; document.head.appendChild(st); window.D37Full?.toggle(document.querySelector('#gamesStage'), { esc: false }); await new Promise(r => setTimeout(r, 1500)); return !!document.querySelector('.gs-fs'); })()`, 20000);
    // время и погода: низкое солнце, зима со снегом (вид «как у владельца»)
    const setup = async (time, w) => ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state();
      S.R.lighting.time = ${time}; S.paused = true;
      try { S.WX.clim.setWorld(${JSON.stringify(w)}); if ('cover' in S.WX) S.WX.cover = -1; } catch (e) {}   // снег на земле — заново по новой погоде
      await wait(9000);
      return { st: S.WX.stats?.(), pack: S.R.packFx?.()?.id, opt: { ao: S.R.opt?.ao, rt: S.R.opt?.rt, aa: S.R.opt?.aa }, res: S.R.pixelRatio?.(), scaled: !!S.R.post?.scaled, dof: !!S.R.post?.dofOn };
    })()`, 60000);
    const view = async (yaw, fp, cam = 0) => ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.rig.yaw = ${yaw}; S.rig.fp = ${fp}; GAME_IMPL.kubomir._test.cam(${cam}); GAME_IMPL.kubomir._test.hud(false); await new Promise(r => setTimeout(r, 1800)); return true; })()`, 20000);
    const winter = { seed: 'kb', mode: 'fixed', season: 'winter', weather: 'snow', lapse: -.12, seaY: 52 };
    res.winter = await setup(9.6, winter);
    await view(-Math.PI / 2, .32); await shot('winter-lake-fp');
    await view(-Math.PI / 2 + .5, .22, 1); await shot('winter-lake-tp');
    await view(-Math.PI / 2 - .35, .02, 0); await shot('winter-far-fp');
    // рамка постройки: доски в руке, прицел в снег перед собой; потом ночь в «пещере» под каменной крышей
    await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.inv[S.P.sel] = { id: 'planks_oak', n: 64 }; return true; })()`);
    await view(-Math.PI / 2, .75, 0); await shot('preview-snow');
    res.preview = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); return { hit: !!S.hit, place: S.placeAt || null }; })()`);
    await ev(`(async () => {
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, ID = V.ID, x0 = Math.floor(P.x), z0 = Math.floor(P.z), y0 = Math.floor(P.y);
      for (let x = x0 - 4; x <= x0 + 4; x++) for (let z = z0 - 4; z <= z0 + 4; z++) { W.set(x, y0 + 3, z, V.cell(ID.stone), { urgent: 1 }); if (Math.abs(x - x0) === 4 || Math.abs(z - z0) === 4) for (let y = y0; y < y0 + 3; y++) W.set(x, y, z, V.cell(ID.stone), { urgent: 1 }); }
      S.R.lighting.time = 23; await new Promise(r => setTimeout(r, 5000)); return true; })()`, 30000);
    await view(-Math.PI / 2, .75, 0); await shot('preview-cave-night');
    // дождь летом (дымка не «съедает» картинку)
    res.rain = await setup(13, { seed: 'kb', mode: 'fixed', season: 'summer', weather: 'rain', lapse: -.12, seaY: 52 });
    await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, W = S.W, P = S.P, x0 = Math.floor(P.x), z0 = Math.floor(P.z), y0 = Math.floor(P.y); for (let x = x0 - 4; x <= x0 + 4; x++) for (let z = z0 - 4; z <= z0 + 4; z++) for (let y = y0; y <= y0 + 3; y++) W.set(x, y, z, 0, { urgent: 1 }); await new Promise(r => setTimeout(r, 4000)); return true; })()`, 30000);
    await view(-Math.PI / 2 - .2, .1, 0); await shot('summer-rain-fp');
    // климатические зоны (летом, ясно): граница «всегда зима» (снег на кронах и земле) и обычной (зелено) — сверху
    res.zones = await ev(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const S = GAME_IMPL.kubomir._test.state(), V = D37E.vox, G = S.G, P = S.P;
      if (!G || !V.climZone || !('cover' in S.WX)) return { none: 'старая версия' };
      const col = {}, x0 = Math.floor(P.x), z0 = Math.floor(P.z); let best = null;
      for (let r = 32; r < 2400 && !best; r += 24) for (let a = 0; a < 48 && !best; a++) {
        const x = Math.round(x0 + r * Math.cos(a / 48 * 6.2832)), z = Math.round(z0 + r * Math.sin(a / 48 * 6.2832));
        const c1 = V.genColumn(G, x, z, col); if (V.climZone(c1.T, c1.h, c1.b) !== 1 || c1.h > V.SEA + 30 || c1.h <= V.SEA) continue;
        for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) { const c2 = V.genColumn(G, x + dx, z + dz, col); if (V.climZone(c2.T, c2.h, c2.b) === 0 && c2.h > V.SEA && c2.h <= V.SEA + 30) { best = { x, z, dx, dz, h: c1.h }; break; } }
      }
      if (!best) return { none: 'нет границы' };
      S.WX.clim.setWorld({ seed: 'kb', mode: 'fixed', season: 'summer', weather: 'clear', lapse: 0, seaY: 52 }); S.WX.cover = 0;
      S.R.lighting.time = 12; P.fly = true;
      GAME_IMPL.kubomir._test.command('/tp ' + (best.x - best.dx) + ' ' + (best.h + 24) + ' ' + (best.z - best.dz));
      for (let i = 0; i < 60 && !S.ready; i++) await wait(500);
      await wait(8000);
      S.rig.yaw = Math.atan2(-best.dx, -best.dz);
      return { best, ready: S.ready, st: S.WX.stats() };
    })()`, 90000);
    if (res.zones && res.zones.best) { await view(Math.atan2(-res.zones.best.dx, -res.zones.best.dz), .55, 0); await shot('zones-summer'); }
    const pr = await ev(`(${progsOk})(GAME_IMPL.kubomir._test.state().R)`);
    const guard = await ev(`D37E.gfxGuardInfo ? D37E.gfxGuardInfo().off : []`);
    res.progs = pr; res.guard = guard;
    ok(!pr.bad.length, 'все программы шейдеров собрались', pr.bad);
    ok(!guard || !guard.length, 'страж графики ничего не выключил', guard);
    const bad = logs.filter(l => /WebGLProgram|Shader Error|exception/i.test(l) && !/X3595/.test(l));
    ok(!bad.length, 'в консоли — без ошибок шейдеров и исключений', bad.slice(0, 5));
  } catch (e) {
    if (e.message !== '__готово') { fail++; console.log('ОШИБКА', e.message); }
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
  } finally {
    console.log('ЗАМЕР', JSON.stringify(res, null, 1).slice(0, 3000));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log('снимки:', SHOTS);
  console.log(fail ? `kubomir-e2e: ${fail} ошибок` : 'kubomir-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

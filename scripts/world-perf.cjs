// Замер «Мира Денчика» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) в профиле телефона: экран 412 × 915, ЦП
// замедлен в N раз (как слабый телефон), качество «средняя». Места: столица, Большой город с движением, боевая зона, природа,
// пролёт над картой (камера летит над рельефом — подгрузка узлов и деревьев), второй круг — растёт ли память.
// Отчёт: FPS, ЦП мс на кадр (среднее и худший), кадры дольше 50 мс (рывки), вызовы отрисовки, треугольники, узлы рельефа,
// деревья, жители и машины рядом, интерьеры, видимые зоны, память JS и видеокарты. Бюджеты — docs/WORLD_MAP.md §7.
// Запуск из корня сайта: node scripts/world-perf.cjs [замедление ЦП, 4] [качество, mid] [плотность пикселей, 2]
// (Chrome — переменная CHROME или стандартный путь Windows; временная папка — D37_TMP, иначе E:\claude-tmp, иначе системная)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [RATE = '4', Q = 'mid', DSF = '2', MODE = ''] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  // D37_OVERRIDE=папка — файлы оттуда вместо сайта (замер «до»: старые версии нескольких файлов)
  if (process.env.D37_OVERRIDE) { const o = path.join(process.env.D37_OVERRIDE, p); if (fs.existsSync(o)) f = o; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-world-perf-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 90000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const rows = [];
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: +DSF || 2, mobile: true });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');}catch(e){}` });
    if (MODE === 'brk') {   // разрушения, этап 2 в настоящем мире: стена здания боевой зоны → дыра (кусок спрятан, тела нет) → назад
      await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok8 = false; for (let i = 0; i < 240 && !ok8; i++) { await sleep(500); try { ok8 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      const r = await ev(`(async () => {
        const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = GAME_IMPL.world._test.state(), z = S.zones, zs = z.zoneState('war'), DS = z.destruct;
        S.fixedTime = 13; S.P.place(-120, MirZones.terrain(-120, 150) + .3, 150, 0);
        if (!zs.ready) await z.buildNow(zs);
        const walls = [...DS.list.values()].filter(b => b.kind === 'wall'), tough = walls.filter(b => b.power === 3);
        const w = walls.find(b => b.power !== 3 && b.id.startsWith('p:w_hq:wall')) || walls.find(b => b.power !== 3);
        const body = w.bodies[0], had = S.ph.cols.has(body);
        S.P.place(w.x, MirZones.terrain(w.x, w.z) + .3, w.z + 7, Math.PI); await new Promise(res => setTimeout(res, 1500));
        let n = 0; for (let k = 0; k < 8 && !DS.broken.has(w.id); k++) n += DS.hit(w.x, w.z, .9, 1, { y: w.y + 1.5 });
        const broke = DS.broken.has(w.id), gone = !S.ph.cols.has(body), st = DS.stats();
        await new Promise(res => setTimeout(res, 600));
        return { walls: walls.length, tough: tough.length, id: w.id, had, broke, gone, debris: st.box, n };
      })()`, 180000);
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
      fs.mkdirSync(path.join(TMP, 'world', 'shots'), { recursive: true }); fs.writeFileSync(path.join(TMP, 'world', 'shots', 'brk-wall.jpg'), Buffer.from(data, 'base64'));
      const r2 = await ev(`(() => { const z = GAME_IMPL.world._test.state().zones, DS = z.destruct, id = ${JSON.stringify('')} || [...DS.broken.keys()][0]; DS.restore(id); const b = DS.list.get(id); return { restored: !DS.broken.has(id), body: GAME_IMPL.world._test.state().ph.cols.has(b.bodies[0]) }; })()`);
      console.log('стена', JSON.stringify({ ...r, ...r2 }));
      throw new Error('проверка стены готова');
    }
    if (MODE === 'btime') {   // сколько времени строится каждая зона целиком (buildNow: 24 мс за раз), ЦП замедлен — как телефон
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok7 = false; for (let i = 0; i < 240 && !ok7; i++) { await sleep(500); try { ok7 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      const r = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones, out = {};
        S.P.place(0, 30, -900, 0); await new Promise(res => setTimeout(res, 1500));
        for (const id of ['kids', 'metro', 'war']) { const zs = z.zoneState(id); const t0 = performance.now(); z.prof = []; if (!zs.ready) await z.buildNow(zs);
          const by = {}; for (const p of z.prof) by[p[0]] = Math.round((by[p[0]] || 0) + p[3]);
          out[id] = { ms: Math.round(performance.now() - t0), was: zs.ready && !z.prof.length ? 'уже' : '', by }; }
        z.prof = null; return out;
      })()`, 240000);
      console.log('постройка', JSON.stringify(r));
      throw new Error('замер постройки готов');
    }
    if (MODE === 'lbl') {   // надписи зоны в настоящей постройке: сколько стоит каждая (телефон — замедление ЦП)
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__d37lbl = [];' });
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok6 = false; for (let i = 0; i < 240 && !ok6; i++) { await sleep(500); try { ok6 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      const r = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones; window.__d37lbl.length = 0;
        const zs = z.zoneState('kids'); if (!zs.built) await z.buildNow(zs);
        const L = window.__d37lbl, ms = L.map(x => x[0]);
        return { n: L.length, sum: Math.round(ms.reduce((a, b) => a + b, 0)), top: L.slice().sort((a, b) => b[0] - a[0]).slice(0, 10), oc: typeof OffscreenCanvas };
      })()`, 240000);
      console.log('надписи зоны', JSON.stringify(r));
      throw new Error('замер надписей зоны готов');
    }
    if (MODE === 'text') {   // сколько стоит одна надпись на холсте (как вывеска зоны): обычный холст / ускоренный / OffscreenCanvas
      await send('Page.navigate', { url: BASE + '/#/games' }); await sleep(4000);
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      const r = await ev(`(async () => {
        const T = ['🏛️ Работа — в мэрии', '🚒 Пожарная часть', '🏫 Школа', 'Сити-1', '🛍️ ТЦ «Галерея»', '🚩 A · Северная точка', '2 + 2 = 4   🍎 Урок!', '🏯 Застава · WB01'];
        const run = (g, n) => { const t = performance.now(); for (let i = 0; i < n; i++) { const x = (i % 2) * 512, y = (i >> 1) * 100 % 900; g.fillStyle = '#7c3aed'; g.fillRect(x, y, 512, 96); g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 4; g.strokeRect(x + 3, y + 3, 506, 90); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 53px Montserrat, Arial, sans-serif'; g.fillText(T[i % T.length] + ' ' + i, x + 256, y + 50, 480); } return +((performance.now() - t) / n).toFixed(2); };
        const out = {}, gc = document.createElement('canvas'), gl = gc.getContext('webgl2');
        // как three r149 (WebGL2): texStorage2D + texSubImage2D, переворот по Y, мипмапы; дважды (второй раз — без разовых затрат)
        const up = (src, flip = true) => { const t = performance.now(), tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flip); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texStorage2D(gl.TEXTURE_2D, 11, gl.SRGB8_ALPHA8, 1024, 1024); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src); gl.generateMipmap(gl.TEXTURE_2D); return +(performance.now() - t).toFixed(1); };
        up(document.createElement('canvas'));   // разовые затраты контекста
        for (const [k, opt] of [['обычный', {}], ['willRead', { willReadFrequently: true }]]) { const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d', opt); out[k + ' первые 8'] = run(g, 8); out[k + ' ещё 40'] = run(g, 40); out[k + ' в текстуру'] = up(c) + ' / ' + up(c); }
        const oc = new OffscreenCanvas(1024, 1024), og = oc.getContext('2d'); out['offscreen первые 8'] = run(og, 8); out['offscreen ещё 40'] = run(og, 40); out['offscreen в текстуру'] = up(oc) + ' / ' + up(oc);
        const ob = new OffscreenCanvas(1024, 1024), obg = ob.getContext('2d'); run(obg, 48); const t1 = performance.now(), bm = ob.transferToImageBitmap(); out['bitmap перенос'] = +(performance.now() - t1).toFixed(2); out['bitmap в текстуру'] = up(bm, false) + ' / ' + up(bm, false);
        return out;
      })()`, 120000);
      console.log('надписи', JSON.stringify(r));
      throw new Error('замер надписей готов');
    }
    if (MODE === 'shot') {   // снимки вывесок зон (проверка надписей и показа зон): E:\claude-tmp\world\shots\zone-*.jpg
      await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok5 = false; for (let i = 0; i < 240 && !ok5; i++) { await sleep(500); try { ok5 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      const dir = path.join(TMP, 'world', 'shots'); fs.mkdirSync(dir, { recursive: true });
      for (const [zid, x, z, yaw] of [['kids', 117, -27, Math.PI], ['metro', 96, 133, 0], ['war', -90, 132, Math.PI]]) {
        await ev(`(async () => {
          const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
          const S = GAME_IMPL.world._test.state(), z = S.zones, zs = z.zoneState('${zid}');
          S.fixedTime = 13; S.P.place(${x}, MirZones.terrain(${x}, ${z}) + .3, ${z}, ${yaw});
          if (!zs.built || !zs.ready) await z.buildNow(zs);
          await new Promise(r => setTimeout(r, 2500)); return zs.shown;
        })()`, 120000);
        const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 72 });
        fs.writeFileSync(path.join(dir, 'zone-' + zid + '.jpg'), Buffer.from(data, 'base64'));
        console.log('снимок', zid);
      }
      throw new Error('снимки готовы');
    }
    if (MODE === 'kprof') {   // сколько стоят функции набора постройки зон (все три зоны, без спешки)
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__d37profK = {};' });
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok4 = false; for (let i = 0; i < 240 && !ok4; i++) { await sleep(500); try { ok4 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      const r = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones;
        for (const id of ['kids', 'metro', 'war']) { const zs = z.zoneState(id); if (!zs.built) await z.buildNow(zs); }
        const P = window.__d37profK, L = Object.keys(P).filter(k => k[0] !== '#').map(k => [k, Math.round(P[k]), P['#' + k] || 0]).sort((a, b) => b[1] - a[1]);
        return L.slice(0, 30);
      })()`, 240000);
      console.log('набор', JSON.stringify(r));
      throw new Error('замер набора готов');
    }
    if (MODE === 'progs') {   // сколько стоят новые программы шейдеров зоны: построить спрятанной → показать → один кадр
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok3 = false; for (let i = 0; i < 240 && !ok3; i++) { await sleep(500); try { ok3 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      const r = await ev(`(async () => {
        const S = GAME_IMPL.world._test.state(), z = S.zones, R = S.R, r = R.r, gl = r.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info'), out = { gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?', par: !!gl.getExtension('KHR_parallel_shader_compile'), zones: [] };
        const orig = gl.getProgramInfoLog.bind(gl), calls = [];
        gl.getProgramInfoLog = p => { const t = performance.now(), s = orig(p); calls.push(+(performance.now() - t).toFixed(1)); return s; };
        S.P.place(0, 30, -900, 0); await new Promise(res => setTimeout(res, 1500));
        for (const id of ['kids', 'metro', 'war']) {
          const zs = z.zoneState(id); if (!zs.built) await z.buildNow(zs);
          if (z.warmNow) await z.warmNow(zs);
          calls.length = 0; const p0 = r.info.programs.length, old = new Set(r.info.programs), t0 = performance.now();
          zs.grp.visible = true; if (zs.proxy) zs.proxy.visible = false; R.render();
          const ms = Math.round(performance.now() - t0), fresh = r.info.programs.filter(p => !old.has(p));
          const who = fresh.map(pg => { const L = []; zs.grp.traverse(o => { if (o.material && !Array.isArray(o.material) && r.properties.get(o.material).currentProgram === pg && L.length < 4) L.push((o.isInstancedMesh ? 'inst ' : '') + o.material.type + ' ' + (o.name || o.parent?.name || '')); }); return pg.name + ' | ' + L.join('; ') + ' | ' + pg.cacheKey.slice(0, 300); });
          out.zones.push({ id, ms, progs: r.info.programs.length - p0, calls: calls.slice(), who });
          zs.grp.visible = false; if (zs.proxy) zs.proxy.visible = true;
        }
        return out;
      })()`, 240000);
      console.log('программы', JSON.stringify(r));
      throw new Error('замер программ готов');
    }
    if (MODE === 'base') {   // военные базы боевой зоны (mir-base.js, startWar): у базы и в центре кольца; есть _test.fill — 12 баз штаба 5
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let ok9 = false; for (let i = 0; i < 240 && !ok9; i++) { await sleep(500); try { ok9 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      if (!ok9) throw new Error('мир не открылся');
      const prep = await ev(`(async () => {
        const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = GAME_IMPL.world._test.state(), z = S.zones, P = S.P, L = MirWar.PLOTS, Q = L[1];
        S.fixedTime = 13; P.place(Q.cx, MirZones.terrain(Q.cx, Q.cz) + .3, Q.cz, 0);
        const zs = z.zoneState('war'); if (!zs.ready) await z.buildNow(zs);
        const W = S.base?.war; let filled = 0;
        if (W?._test?.fill) filled = await W._test.fill(5);
        await new Promise(r => setTimeout(r, 4000));
        window.__long = 0; window.__fr = 0; let last = performance.now();
        const tick = t => { const d = t - last; last = t; window.__fr++; if (d > 50) window.__long++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return { filled, views: W?._test?.views?.() ?? null };
      })()`, 240000);
      console.log('подготовка', JSON.stringify(prep));
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      for (const [name, js] of [['у базы (участок wb02)', `const Q = MirWar.PLOTS[1]; P.place(Q.cx, MirZones.terrain(Q.cx, Q.cz) + .3, Q.z1 - 6, 0); S.rig.yaw = 0`],
        ['центр кольца баз', `const C = MirWar.CENTER; P.place((C.x0 + C.x1) / 2, .3, C.z0 + 4, 0); S.rig.yaw = 0`], ['у базы wb07 (юго-запад)', `const Q = MirWar.PLOTS[6]; P.place(Q.cx, .3, Q.z0 + 8, Math.PI); S.rig.yaw = Math.PI`]]) {
        await ev(`(async () => { const S = GAME_IMPL.world._test.state(), P = S.P; ${js}; await new Promise(r => setTimeout(r, 3000)); const ST = S.R.stats; ST.frames = ST.sumDt = ST.maxDt = ST.sumCpu = ST.maxCpu = ST.sumR = 0; window.__long = 0; window.__fr = 0; })()`, 60000);
        await sleep(6000);
        const s = await ev(`(() => { const S = GAME_IMPL.world._test.state(), R = S.R, ST = R.stats, n = Math.max(1, ST.frames), m = R.r.info.memory;
          return { fps: +(1000 / (ST.sumDt / n)).toFixed(1), cpu: +(ST.sumCpu / n).toFixed(2), cpuMax: +ST.maxCpu.toFixed(1), long: window.__long, frames: window.__fr, calls: ST.calls, tris: R.r.info.render.triangles,
            geo: m.geometries, tex: m.textures, bodies: S.ph.cols?.size ?? null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, q: R.q, views: S.base?.war?._test?.views?.() ?? null }; })()`);
        s.name = name; rows.push(s); console.log(name.padEnd(30), JSON.stringify(s));
      }
      throw new Error('замер баз готов');
    }
    if (MODE === 'fire') {   // огонь боевой зоны (mir-fire.js, T-022d): у мешков укрытий — до пожара, в пожаре, после; снимок
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let okF = false; for (let i = 0; i < 240 && !okF; i++) { await sleep(500); try { okF = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      if (!okF) throw new Error('мир не открылся');
      const prep = await ev(`(async () => {
        const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = GAME_IMPL.world._test.state(), z = S.zones, P = S.P;
        S.fixedTime = 13; P.place(-200, MirZones.terrain(-200, 190) + .3, 196, 0);
        const zs = z.zoneState('war'); if (!zs.ready) await z.buildNow(zs);
        const X = z.fire, L = [...z.destruct.list.values()].filter(b => ['bag', 'crate', 'barrel', 'fence', 'tree', 'pine'].includes(b.kind));
        let hot = L[0], best = 0; for (const b of L) { const n = L.filter(u => Math.hypot(u.x - b.x, u.z - b.z) < 6).length; if (n > best) { best = n; hot = b; } }
        window.__hot = { x: hot.x, y: hot.y || 0, z: hot.z, n: best };
        P.place(hot.x, MirZones.terrain(hot.x, hot.z + 9) + .3, hot.z + 9, 0); S.rig.yaw = 0;
        await new Promise(r => setTimeout(r, 4000));
        window.__long = 0; window.__fr = 0; let last = performance.now();
        const tick = t => { const d = t - last; last = t; window.__fr++; if (d > 50) window.__long++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
        return { fire: !!X, parts: X?.stats.parts, hot: window.__hot };
      })()`, 240000);
      console.log('подготовка', JSON.stringify(prep));
      const snap = `(() => { const S = GAME_IMPL.world._test.state(), R = S.R, ST = R.stats, n = Math.max(1, ST.frames), X = S.zones.fire;
        return { fps: +(1000 / (ST.sumDt / n)).toFixed(1), cpu: +(ST.sumCpu / n).toFixed(2), cpuMax: +ST.maxCpu.toFixed(1), long: window.__long, frames: window.__fr, calls: ST.calls, tris: R.r.info.render.triangles,
          burning: X?.F.n ?? null, ignited: X?.F.stats.ignited ?? null, tongues: X?.flames?.()?.stats?.tongues ?? null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }; })()`;
      const reset = `(() => { const ST = GAME_IMPL.world._test.state().R.stats; ST.frames = ST.sumDt = ST.maxDt = ST.sumCpu = ST.maxCpu = ST.sumR = 0; window.__long = 0; window.__fr = 0; return 1; })()`;
      await sleep(15000);   // зона достроилась, шейдеры собрались (иначе «до пожара» меряет постройку)
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      await ev(reset); await sleep(6000); const before = await ev(snap); console.log('до пожара'.padEnd(20), JSON.stringify(before)); rows.push({ name: 'до пожара', ...before });
      // поджечь три самых густых места рядом (не ближе 12 м друг к другу); замер — окнами «идёт / на паузе» по 2 с, 4 раза: на паузе
      // пожар стоит (не догорает за время замера), сравнение рядом по времени честнее (машина под нагрузкой)
      const lit = await ev(`(() => { const S = GAME_IMPL.world._test.state(), z = S.zones, X = z.fire, h = window.__hot;
        const L = [...z.destruct.list.values()].filter(b => ['bag', 'crate', 'barrel', 'fence', 'tree', 'pine'].includes(b.kind) && Math.hypot(b.x - h.x, b.z - h.z) < 40);
        const dens = b => L.filter(u => Math.hypot(u.x - b.x, u.z - b.z) < 6).length, C = [];
        for (const b of L.map(b => [dens(b), b]).sort((a, c) => c[0] - a[0]).map(q => q[1])) { if (C.every(q => Math.hypot(q.x - b.x, q.z - b.z) > 12)) C.push(b); if (C.length >= 3) break; }
        let s = 77; for (const b of C) X.ignite(b.x, (b.y || 0) + .5, b.z, 5, s++, true);
        return { spots: C.length, near: L.length, burning: X.F.n }; })()`);
      console.log('подожгли', JSON.stringify(lit));
      await sleep(1500);
      const ab = { off: [], on: [] };
      for (let r = 0; r < 4; r++) for (const p of [false, true]) {
        await ev(`(() => { GAME_IMPL.world._test.state().zones.fire.paused = ${p}; return 1; })()`); await sleep(300); await ev(reset); await sleep(2000);
        const q = await ev(snap); ab[p ? 'off' : 'on'].push(q);
        if (!p && !r) { console.log('пожар'.padEnd(20), JSON.stringify(q)); rows.push({ name: 'пожар', ...q }); }
      }
      await ev(`(() => { GAME_IMPL.world._test.state().zones.fire.paused = false; return 1; })()`);
      const med = (a, k) => { const v = a.map(q => q[k]).sort((x, y) => x - y); return v[v.length >> 1]; };
      const abRow = k => ({ cpu: med(ab[k], 'cpu'), cpuMax: med(ab[k], 'cpuMax'), calls: med(ab[k], 'calls'), burning: med(ab[k], 'burning'), tongues: med(ab[k], 'tongues') });
      console.log('идёт / пауза (медианы четырёх)', JSON.stringify({ on: abRow('on'), off: abRow('off') })); rows.push({ name: 'идёт', ...abRow('on') }, { name: 'пауза', ...abRow('off') });
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 84 });
      const dirS = path.join(TMP, 't022d', 'shots'); fs.mkdirSync(dirS, { recursive: true }); fs.writeFileSync(path.join(dirS, 'mir-fire.jpg'), Buffer.from(data, 'base64')); console.log('  снимок', path.join(dirS, 'mir-fire.jpg'));
      await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
      await ev(`(() => { GAME_IMPL.world._test.state().zones.fire.F.clear(); return 1; })()`); await sleep(1500); await ev(reset); await sleep(6000);
      const after = await ev(snap); console.log('после'.padEnd(20), JSON.stringify(after)); rows.push({ name: 'после', ...after });
      throw new Error('замер огня готов');
    }
    if (MODE === 'approach') {   // въезд в каждую зону — на свежей странице (зона строится один раз)
      for (const [zid, from] of [['metro', [650, 225]], ['war', [-288, 720]], ['kids', [230, -330]]].filter(([k]) => !process.env.ZONES || process.env.ZONES.split(',').includes(k))) {
        await send('Page.navigate', { url: 'about:blank' }); await sleep(300);
        await send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await send('Page.navigate', { url: BASE + '/#/games/world' });
        let ok2 = false; for (let i = 0; i < 240 && !ok2; i++) { await sleep(500); try { ok2 = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
        if (!ok2) { console.log('мир не открылся'); continue; }
        await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
        await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 250 });
        const t0p = await ev(`performance.now()`); await send('Profiler.start');
        const r = await ev(`(async () => {
          const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
          const S = GAME_IMPL.world._test.state(), z = S.zones, Zn = MirZones.ZONES['${zid}'], P = S.P;
          S.fixedTime = 13; z.prof = [];
          const cx = (Zn.x0 + Zn.x1) / 2, cz = (Zn.z0 + Zn.z1) / 2, sx = ${from[0]}, sz = ${from[1]};
          const L = Math.hypot(cx - sx, cz - sz), dx = (cx - sx) / L, dz = (cz - sz) / L;
          // сначала — 8 с у появления в столице (зоны рядом строятся в фоне): рывки при старте мира
          const sfn = [];
          const st = await new Promise(done => { const a = []; let l = 0, t0 = 0; const f = t => { a.push(t - l); sfn.push(z.frameNo || 0); l = t; if (t - t0 < 8000) requestAnimationFrame(f); else done(a); }; requestAnimationFrame(t => { l = t0 = t; requestAnimationFrame(f); }); });
          const stL = st.filter(x => x > 50), start = { frames: st.length, long: stL.length, worst: Math.round(Math.max(...st)), stutter: Math.round(stL.reduce((a, b) => a + b, 0)),
            why: st.map((x, i) => [x, i]).filter(([x]) => x > 50).map(([x, i]) => [Math.round(x), z.prof.filter(p => p[4] === sfn[i] || p[4] === sfn[i] - 1).map(p => p[0] + ':' + p[1] + ':' + p[2] + ':' + p[3]).slice(0, 5)]) };
          P.place(sx, MirZones.terrain(sx, sz) + .3, sz, Math.atan2(dx, dz)); await new Promise(r => setTimeout(r, 2500));
          const dts = []; let last = performance.now(), d = 0, heap0 = performance.memory?.usedJSHeapSize || 0;
          const gl = S.R.r.getContext(), oil = gl.getProgramInfoLog.bind(gl), plog = [];   // синхронная сборка программ (сколько ждали)
          const nm = p => { try { for (const sh of gl.getAttachedShaders(p) || []) { const m = /#define SHADER_NAME (\S+)/.exec(gl.getShaderSource(sh) || ''); if (m) return m[1]; } } catch (e) {} return '?'; };
          gl.getProgramInfoLog = p => { const t = performance.now(), s = oil(p); plog.push([z.frameNo || 0, +(performance.now() - t).toFixed(1) + ' ' + nm(p)]); return s; };
          const zs0 = z.zoneState('${zid}'), ev = [], fno = [], prg = [], tex = [], geo = [], ends = []; let wasB = false, wasS = false, wasR = false; const tA = performance.now(); let tReady = null;
          await new Promise(done => { const tick = t => { const dt = t - last; last = t; dts.push(dt); ends.push(t); fno.push(z.frameNo || 0); prg.push(S.R.r.info.programs?.length || 0); tex.push(S.R.r.info.memory.textures); geo.push(S.R.r.info.memory.geometries); d += 18 * Math.min(dt, 100) / 1000;
            if (zs0.built !== wasB) { wasB = zs0.built; ev.push(['built', dts.length]); } if (zs0.shown !== wasS) { wasS = zs0.shown; ev.push(['shown', dts.length]); }
            if (!!zs0.ready !== wasR) { wasR = !!zs0.ready; ev.push(['ready', dts.length]); if (wasR && tReady == null) tReady = Math.round((t - tA) / 100) / 10; }
            if (d < L - 10) { const x = sx + dx * d, zz = sz + dz * d; P.place(x, MirZones.terrain(x, zz) + .3, zz, Math.atan2(dx, dz)); requestAnimationFrame(tick); } else setTimeout(done, 3000); };
            requestAnimationFrame(t => { last = t; requestAnimationFrame(tick); }); });
          const longT = []; { let tt = 0; } 
          const long = dts.filter(x => x > 50), prof = z.prof.filter(p => p[3] > 8).sort((a, b) => b[3] - a[3]).slice(0, 8);
          // что было в долгих кадрах (по номеру кадра мира)
          const D = (a, i) => (a[i] || 0) - (a[i - 1] || a[i] || 0);
          const why = dts.map((x, i) => [x, i]).filter(([x]) => x > 50).map(([x, i]) => [Math.round(x), 'prog+' + D(prg, i) + '/' + D(prg, i + 1) + ' tex+' + D(tex, i) + '/' + D(tex, i + 1) + ' geo+' + D(geo, i) + '/' + D(geo, i + 1),
            z.prof.filter(p => p[4] === fno[i] || p[4] === fno[i] - 1).map(p => p[0] + ':' + p[1] + ':' + p[2] + ':' + p[3]).slice(0, 6), plog.filter(p => p[0] === fno[i] || p[0] === fno[i] - 1).map(p => p[1]),
            'кадр ' + i + ' / показ ' + (ev.find(e => e[0] === 'shown')?.[1] ?? '-')]);
          gl.getProgramInfoLog = oil;
          z.prof = null;
          const around = ev.map(([k, i]) => [k, dts.slice(Math.max(0, i - 2), i + 3).map(Math.round)]);
          const longW = dts.map((x, i) => [x, i]).filter(([x]) => x > 50).map(([x, i]) => [ends[i] - x, ends[i]]);
          return { zone: '${zid}', start, tReady, plogAll: plog.filter(p => parseFloat(p[1]) > 10).slice(0, 12), longW, why, around, frames: dts.length, long: long.length, worst: Math.round(Math.max(...dts)), stutter: Math.round(long.reduce((a, b) => a + b, 0)), built: z.zoneState('${zid}').built, shown: z.zoneState('${zid}').shown, prof, warm: z.warm ? { ext: z.warm.ext, n: z.warm.n, log: z.warm.log } : null };
        })()`, 240000);
        const { profile: pr } = await send('Profiler.stop');
        if (r && r.longW && pr) {   // что считал процессор в долгих кадрах (по своему времени функций)
          const byId = new Map(pr.nodes.map(n => [n.id, n])); let tt = pr.startTime; const self = new Map();
          for (let i = 0; i < pr.samples.length; i++) {
            tt += pr.timeDeltas[i] || 0; const pageT = (tt - pr.startTime) / 1000 + t0p;
            if (!r.longW.some(([a, b]) => pageT >= a && pageT <= b)) continue;
            const n = byId.get(pr.samples[i]), cf = n.callFrame, k = (cf.functionName || '(анон)') + ' ' + (cf.url || '').split('/').pop().split('?')[0] + ':' + (cf.lineNumber + 1);
            self.set(k, (self.get(k) || 0) + (pr.timeDeltas[i + 1] || 250) / 1000);
          }
          r.hot = [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => k + ' ' + Math.round(v) + 'мс');
          delete r.longW;
        }
        console.log('въезд', JSON.stringify(r));
        rows.push(r);
      }
      throw new Error('замер въездов готов');
    }
    await send('Page.navigate', { url: BASE + '/#/games/world' });
    let up = false;
    for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
    if (!up) throw new Error('мир не открылся');
    await send('Emulation.setCPUThrottlingRate', { rate: +RATE || 4 });
    // помощники в странице: «взрослый» (только в этой вкладке), замер окна, полёт камеры по пути
    await ev(`(() => {
      const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
      const S = GAME_IMPL.world._test.state(), R = S.R, z = S.zones;
      S.fixedTime = 13;
      window.__long = 0; window.__fr = 0; let last = performance.now();
      const tick = t => { const d = t - last; last = t; window.__fr++; if (d > 50) window.__long++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      window.__reset = () => { const ST = R.stats; ST.frames = ST.sumDt = ST.maxDt = ST.sumCpu = ST.maxCpu = ST.sumR = 0; window.__long = 0; window.__fr = 0; };
      window.__snap = () => { const ST = R.stats, n = Math.max(1, ST.frames), m = R.r.info.memory, npc = S.NPC?.list?.size ?? null;
        const zs = [...z.zones.values()].map(q => q.Z.id + (q.shown ? '+' : q.built ? '~' : '-')).join(' ');
        return { fps: +(1000 / (ST.sumDt / n)).toFixed(1), cpu: +(ST.sumCpu / n).toFixed(2), cpuMax: +ST.maxCpu.toFixed(1), dtMax: +ST.maxDt.toFixed(0), long: window.__long, frames: window.__fr,
          calls: ST.calls, tris: R.r.info.render.triangles, nodes: z.wmv?.nodes?.() ?? 0, built: z.wmv?.built ?? 0, cache: z.wmv?.cache?.() ?? 0,
          npc, veh: z.veh?.list?.size ?? 0, ints: z.mountedCount?.() ?? null, zones: zs, geo: m.geometries, tex: m.textures,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, q: R.q };
      };
      // полёт: камера ведёт точку по пути (как вертолёт), высота — над землёй
      window.__fly = (pts, speed, h) => new Promise(done => {
        const W = MirZones.worldMap(), pt = { x: pts[0][0], y: 0, z: pts[0][1] }; let i = 1, prev = performance.now();
        const old = z.camTarget; z.camTarget = () => pt;
        const rig = S.rig, keep = { dist: rig.dist, pitch: rig.pitch, maxD: rig.maxD }; Object.assign(rig, { dist: 40, maxD: 60, pitch: .45 });
        const step = t => { const dt = Math.min(.1, (t - prev) / 1000); prev = t;
          const [tx, tz] = pts[i], dx = tx - pt.x, dz = tz - pt.z, d = Math.hypot(dx, dz), s = speed * dt;
          if (d <= s) { pt.x = tx; pt.z = tz; i++; } else { pt.x += dx / d * s; pt.z += dz / d * s; rig.yaw = Math.atan2(-dx, -dz); }
          pt.y = Math.max(0, W ? W.height(pt.x, pt.z) : 0) + h;
          if (i >= pts.length) { z.camTarget = old; Object.assign(rig, keep); done(true); return; }
          requestAnimationFrame(step); };
        requestAnimationFrame(step);
      });
      return true;
    })()`);
    const at = async (name, js, ms, settle = 2500) => {
      await ev(`(async () => { ${js}; await new Promise(r => setTimeout(r, ${settle})); __reset(); })()`);
      await sleep(ms);
      const s = await ev(`__snap()`); s.name = name; rows.push(s); console.log(name.padEnd(30), JSON.stringify(s));
    };
    const Zs = `GAME_IMPL.world._test.state().zones`;
    await at('столица (площадь)', `${Zs}.padGo('hub')`, 6000);
    await at('Большой город: подгрузка', `${Zs}.padGo('metro')`, 9000, 300);
    await at('Большой город (движение)', ``, 6000, 500);
    if (process.env.D37_PROFILE) {   // где ЦП в городе: профиль 4 с, сумма «своего» времени по функциям
      await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); await sleep(4000);
      const { profile: pr } = await send('Profiler.stop'), self = new Map(), byId = new Map(pr.nodes.map(n => [n.id, n]));
      const dt = pr.timeDeltas, cnt = new Map(); for (let i = 0; i < pr.samples.length; i++) cnt.set(pr.samples[i], (cnt.get(pr.samples[i]) || 0) + (dt[i] || 0));
      for (const [nid, t] of cnt) { const n = byId.get(nid), cf = n.callFrame, k = `${cf.functionName || '(анон)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + t); }
      const tot = [...self.values()].reduce((a, b) => a + b, 0);
      console.log('ПРОФИЛЬ (Большой город, своё время):'); for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log('  ', (t / tot * 100).toFixed(1).padStart(5) + '%', k);
      // кто зовёт самые «дорогие» встроенные функции (по цепочке вверх до своего кода)
      const par = new Map(); for (const n of pr.nodes) for (const c of n.children || []) par.set(c, n.id);
      const chain = nid => { const out = []; let p = par.get(nid); while (p && out.length < 6) { const cf = byId.get(p).callFrame; if (cf.url) out.push(`${cf.functionName || '(анон)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`); p = par.get(p); } return out.join(' ← '); };
      const by = new Map(); for (const [nid, t] of cnt) { const cf = byId.get(nid).callFrame; if (cf.url || !/measureText|program|fillText/.test(cf.functionName)) continue; const k = cf.functionName + ' ← ' + chain(nid); by.set(k, (by.get(k) || 0) + t); }
      for (const [k, t] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log('   кто:', (t / tot * 100).toFixed(1) + '%', k.slice(0, 300));
      if (process.env.D37_PROFILE === 'only') throw new Error('профиль снят');
    }
    await at('Боевая зона: подгрузка', `${Zs}.padGo('war')`, 9000, 300);
    await at('Боевая зона', ``, 6000, 500);
    await at('Солнечный городок: подгрузка', `${Zs}.padGo('kids')`, 9000, 300);
    await at('Солнечный городок', ``, 6000, 500);
    await at('природа (лес у озера)', `${Zs}.place(-760, -560, 0)`, 6000);
    // пролёт над картой: столица → горы на севере → запад → вдоль пролива → к городу — два круга (память)
    const PATH = JSON.stringify([[0, -160], [0, -900], [-700, -1500], [-1300, -900], [-900, -200], [-700, 300], [-200, 600], [300, 700], [900, 300], [700, -300], [200, -200], [0, -160]]);
    for (const lap of [1, 2]) {
      await ev(`(async () => { __reset(); await __fly(${PATH}, 60, 70); })()`, 240000);
      await ev(`(async () => { if (window.gc) { gc(); gc(); } await new Promise(r => setTimeout(r, 1500)); })()`);
      const s = await ev(`__snap()`); s.name = 'пролёт над картой, круг ' + lap; rows.push(s); console.log(s.name.padEnd(30), JSON.stringify(s));
    }
  } catch (e) {
    console.log('ОШИБКА', e.message);
  } finally {
    for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  const out = path.join(TMP, `world-perf-x${RATE}-${Q}.json`); fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log('итог:', out);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

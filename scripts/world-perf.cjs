// Замер «Мира Денчика» в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm) в профиле телефона: экран 412 × 915, ЦП
// замедлен в N раз (как слабый телефон), качество «средняя». Места: столица, Большой город с движением, боевая зона, природа,
// пролёт над картой (камера летит над рельефом — подгрузка узлов и деревьев), второй круг — растёт ли память.
// Отчёт: FPS, ЦП мс на кадр (среднее и худший), кадры дольше 50 мс (рывки), вызовы отрисовки, треугольники, узлы рельефа,
// деревья, жители и машины рядом, интерьеры, видимые зоны, память JS и видеокарты. Бюджеты — docs/WORLD_MAP.md §7.
// Запуск из корня сайта: node scripts/world-perf.cjs [замедление ЦП, 4] [качество, mid] [плотность пикселей, 2]
// (Chrome — переменная CHROME или стандартный путь Windows; временная папка — D37_TMP, иначе E:\claude-tmp, иначе системная)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [RATE = '4', Q = 'mid', DSF = '2'] = process.argv.slice(2);
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
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

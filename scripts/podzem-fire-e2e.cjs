// «Подземье» — огонь (T-022d) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm), профиль телефона (412 × 915, ЦП ×4
// медленнее, «средняя» графика): зал под землёй — лес (трава, деревья) и дом из досок; время кадра (ЦП) и вызовы рисования до
// пожара, во время (худший кадр, p95) и после; снимки; мир с пожаром закрыть и открыть 20 раз — память; N минут случайной игры с
// огнём — без ошибок в консоли.
// Запуск из корня сайта: node scripts/podzem-fire-e2e.cjs [perf|reopen|soak] [d3d11|swiftshader]   (SOAK_MIN — минут, по умолчанию 10;
// снимки — <D37_TMP или E:\claude-tmp>\t022d\shots; SITE_DIR — другая копия сайта, например «до»)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [MODE = 'perf', angle = 'd3d11'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t022d' : path.join(os.tmpdir(), 't022d'));
const OUT = path.join(TMP, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const SOAK_MIN = +(process.env.SOAK_MIN || 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
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
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  const heap = async () => ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 300)); } return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null; })()`, 30000);
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86 }); const f = path.join(OUT, name + '.jpg'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); };
  const throttle = rate => send('Emulation.setCPUThrottlingRate', { rate });
  const res = {};
  const SETUP = `const A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test, G = T.G, PZ = window.PZ, ID = k => PZ.TILE[k].id, wait = ms => new Promise(r => setTimeout(r, ms));
    const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T.setCell(x, y, f, 0, null, 0); };
    const tree = (x, y0, h, r) => { for (let k = 0; k < h; k++) T.setCell(x, y0 - k, ID('trunk'), 0, null, 0); const cy = y0 - h - r + 1; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1 && T.fgAt(x + dx, cy + dy) === 0) T.setCell(x + dx, cy + dy, ID('leaves'), 0, null, 0); };
    const perf = () => { const c = G.perf.cpu.slice(), s = c.slice().sort((a, b) => a - b), avg = c.reduce((a, b) => a + b, 0) / Math.max(1, c.length); return { cpu: +avg.toFixed(2), p95: +(s[Math.floor(s.length * .95)] || 0).toFixed(2), max: +(s[s.length - 1] || 0).toFixed(2), draws: G.R?.stats.draws, sprites: G.R?.stats.sprites, n: c.length }; };`;
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: 'mid', d37_settings: JSON.stringify({ gfxPreset: 'mid', gfx: 'mid', shaders: 'auto' }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/podzem' });
    let up = false;
    for (let i = 0; i < 160 && !up; i++) { await sleep(250); up = await ev(`!!(window.GAME_IMPL?.podzem?._test?.G)`, 3000).catch(() => false); }
    ok(up, '«Подземье» загрузилось');
    res.open = await ev(`(async () => { const A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test;
      const w = A.newWorldRecord('Огонь', 'обрушение', [], undefined, 'spread'), c = A.newCharRecord('Герой'); await A.put('worlds', w); await A.put('chars', c); window.__pzIds = [w.id, c.id];
      await A.play(w.id, c.id);
      for (let i = 0; i < 200 && T.G.state !== 'play'; i++) await new Promise(r => setTimeout(r, 100));
      T.god(true); T.G.U?.menu?.(null); T.tp(45, 508); await new Promise(r => setTimeout(r, 4000));
      return { state: T.G.state, fire: !!T.G.fire, spread: T.G.fire?.spread, chunks: T.G.chunks.size, q: T.G.q, shaders: T.G.fl?.id }; })()`, 120000);
    console.log('мир', JSON.stringify(res.open));
    ok(res.open?.state === 'play' && res.open.fire && res.open.spread, 'мир «Огонь распространяется» открылся', res.open);
    // зал в скале: трава, деревья через 5 клеток (кроны касаются), дом из досок; герой посередине
    const SCENE = `fill(0, 470, 92, 516, 0); fill(0, 517, 92, 532, ID('stone'));
      for (let x = 2; x <= 90; x++) T.setCell(x, 516, ID('tallgrass'), 0, null, 0);
      for (let x = 4; x <= 54; x += 5) tree(x, 516, 9 + ((x * 7) & 3), 3);
      for (let x = 62; x <= 78; x++) { T.setCell(x, 516, ID('planks'), 0, null, 0); T.setCell(x, 507, ID('planks'), 0, null, 0); }
      for (let y = 508; y <= 515; y++) { T.setCell(62, y, ID('planks'), 0, null, 0); if (y < 512) T.setCell(78, y, ID('planks'), 0, null, 0); }
      for (let k = 0; k < 3; k++) T.setCell(78, 512 + k, ID('door'), k << 4, null, 0);
      for (let x = 63; x <= 77; x++) for (let y = 508; y <= 515; y++) T.setCell(x, y, null, null, PZ.WALL.woodwall.id, null);
      T.setCell(66, 515, ID('workbench'), 0, null, 0); T.setCell(67, 515, ID('workbench'), 1 << 4, null, 0);
      T.setCell(72, 512, ID('torch'), 0, null, 0);`;
    if (MODE === 'perf') {
      // замер окнами по 2,5 с (последние 120 кадров): ЦП кадра (логика + рисование), p95, худший, вызовы рисования
      const WIN = `const win = async () => { await wait(2500); return perf(); }; const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
        const sum = w => ({ cpu: med(w.map(p => p.cpu)), p95: med(w.map(p => p.p95)), max: Math.max(0, ...w.map(p => p.max)), draws: Math.max(0, ...w.map(p => p.draws)), sprites: Math.max(0, ...w.map(p => p.sprites)) });`;
      res.scene = await ev(`(async () => { ${SETUP} ${SCENE} T.tp(30, 513); T.time(.3); await wait(2500); return { chunks: G.chunks.size }; })()`, 60000);
      await throttle(4);
      res.before = await ev(`(async () => { ${SETUP} ${WIN} const w = []; for (let k = 0; k < 4; k++) w.push(await win()); return Object.assign(sum(w), { dynMs: +(G.perf.dynMs || 0).toFixed(3), fireMs: +(G.perf.fireMs || 0).toFixed(3) }); })()`, 60000);
      console.log('до пожара', JSON.stringify(res.before));
      await shot('podzem-before');
      // большой пожар: подожгли все стволы у корней и кроны; первые 3 окна — разгар (много загораний и сгоревших плиток)
      if (process.env.PZ_PROF) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start'); }
      res.start = await ev(`(async () => { ${SETUP} ${WIN} const X = G.fire; for (let x = 4; x <= 54; x += 5) { X.igniteAt(x, 516); X.igniteAt(x, 516 - 12); } X.igniteAt(62, 516); X.igniteAt(70, 516);
        const w = []; for (let k = 0; k < 3; k++) { const p = await win(); p.n = X.F.n; p.vis = X.vis; w.push(p); }
        return Object.assign(sum(w), { n: Math.max(...w.map(p => p.n)), vis: Math.max(...w.map(p => p.vis)), series: w.map(p => [p.n, p.vis, p.cpu, p.p95, p.max]) }); })()`, 120000);
      console.log('разгар', JSON.stringify(res.start));
      if (process.env.PZ_PROF) {
        const { profile: pf } = await send('Profiler.stop'), self = new Map(), byId = new Map(pf.nodes.map(n => [n.id, n]));
        const dt = pf.timeDeltas, sm = pf.samples; for (let i = 0; i < sm.length; i++) { const n = byId.get(sm[i]); const k = (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + (n.callFrame.lineNumber + 1); self.set(k, (self.get(k) || 0) + (dt[i] || 0)); }
        const tot = [...self.values()].reduce((a, b) => a + b, 0);
        console.log('ПРОФИЛЬ (собственное время, %):\n' + [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => '  ' + (v / tot * 100).toFixed(1).padStart(5) + '  ' + k).join('\n'));
      }
      // тот же кадр, огонь «заморожен» (такт стоит): рисовать огонь — вкл / выкл по очереди (цена картинки и света огня)
      res.ab = await ev(`(async () => { ${SETUP} ${WIN} const X = G.fire, tick = X.tick, draw = X.draw, lights = X.lights, heat = X.heatField; X.tick = () => {};
        const on = [], off = []; let n = 0, vis = 0;
        for (let k = 0; k < 6; k++) { const no = k & 1; X.draw = no ? () => 0 : draw; X.lights = no ? () => 0 : lights; X.heatField = no ? () => false : heat; const p = await win(); (no ? off : on).push(p); if (!no) { n = X.F.n; vis = X.vis; } }
        X.tick = tick; X.draw = draw; X.lights = lights; X.heatField = heat;
        return { n, vis, on: sum(on), off: sum(off) }; })()`, 120000);
      console.log('огонь на кадре вкл / выкл (такт стоит)', JSON.stringify(res.ab));
      // дальше горит само: окна, пока больше 60 клеток
      res.fire = await ev(`(async () => { ${SETUP} ${WIN} const X = G.fire; const w = []; let peak = 0;
        for (let k = 0; k < 8 && X.F.n > 20; k++) { const p = await win(); p.n = X.F.n; p.vis = X.vis; w.push(p); if (X.F.n > peak) peak = X.F.n; }
        const hot = w.filter(p => p.n > 60);
        return Object.assign(hot.length ? sum(hot) : {}, { windows: hot.length, ignited: X.F.stats.ignited, burnt: X.F.stats.burnt, peakAll: X.F.stats.peak, fireMs: +(G.perf.fireMs || 0).toFixed(3), dynMs: +(G.perf.dynMs || 0).toFixed(3), series: w.map(p => [p.n, p.vis, p.cpu, p.p95, p.max]) }); })()`, 120000);
      console.log('пожар идёт', JSON.stringify(res.fire));
      ok(res.fire.peakAll > 150 && res.fire.burnt > 150, 'лес и дом горят: сразу больше 150 клеток', { peak: res.fire.peakAll, burnt: res.fire.burnt });
      await throttle(1);
      await shot('podzem-fire-forest');
      await ev(`(async () => { ${SETUP} G.fire.F.clear(); ${SCENE} T.tp(70, 513); await wait(1500); G.fire.igniteAt(62, 516); G.fire.igniteAt(66, 516); await wait(12000); return 1; })()`, 60000);
      await shot('podzem-fire-house');
      await throttle(4);
      res.after = await ev(`(async () => { ${SETUP} ${WIN} G.fire.F.clear(); const w = []; for (let k = 0; k < 4; k++) w.push(await win()); return sum(w); })()`, 60000);
      await throttle(1);
      console.log('после (огонь погашен)', JSON.stringify(res.after));
      const errs = logs.filter(l => !/X3595|DevTools|favicon/i.test(l));
      ok(!errs.length, 'в консоли — без ошибок и исключений', errs.slice(0, 6));
    }
    if (MODE === 'look') {
      // крупно: лес и дом горят — снимки части экрана вокруг огня и что знает «живой» свет
      const clip = async (name, wx, wy, cw, ch) => {
        const r = await ev(`(() => { const G = GAME_IMPL.podzem._test.G, cv = document.querySelector('.pz-gl').getBoundingClientRect(), k = G.cam.tile / G.res;
          return { x: cv.left + ((${wx} - G.cam.x) * G.cam.tile + G.R.w / 2) / G.res, y: cv.top + ((${wy} - G.cam.y) * G.cam.tile + G.R.h / 2) / G.res, k }; })()`);
        const w = cw * r.k, h = ch * r.k;
        const im = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, clip: { x: Math.max(0, r.x - w / 2), y: Math.max(0, r.y - h / 2), width: w, height: h, scale: 1 } });
        const f = path.join(OUT, name + '.jpg'); fs.writeFileSync(f, Buffer.from(im.data, 'base64')); console.log('  снимок', f);
      };
      await ev(`(async () => { ${SETUP} ${SCENE} T.tp(30, 513); T.time(.3); await wait(2500); const X = G.fire; for (const x of [19, 29, 39]) X.igniteAt(x, 516); return 1; })()`, 60000);
      for (const t of [4, 10]) {
        const d = await ev(`(async () => { ${SETUP} const T0 = G.fire.F.T, t0 = performance.now(); await wait(${t === 4 ? 4000 : 6000}); return { n: G.fire.F.n, vis: G.fire.vis, tps: +((G.fire.F.T - T0) / ((performance.now() - t0) / 1000)).toFixed(1), dyn: T.dyn(), fps: T.state().fps }; })()`, 60000);
        console.log('через', t, 'с', JSON.stringify(d));
        await clip('podzem-look-forest-' + t, 30, 506, 30, 22);
      }
      await shot('podzem-look-full');
      await ev(`(async () => { ${SETUP} G.fire.F.clear(); ${SCENE} T.tp(70, 513); await wait(1500); G.fire.igniteAt(62, 516); G.fire.igniteAt(66, 516); await wait(12000); return 1; })()`, 60000);
      await clip('podzem-look-house', 70, 511, 24, 14);
    }
    if (MODE === 'reopen') {
      // мир с пожаром: закрыть (сохранить, что горит) и открыть 20 раз — огонь продолжается, память JS не растёт
      await ev(`(async () => { ${SETUP} ${SCENE} T.tp(42, 513); await wait(1500); G.fire.igniteAt(29, 516); await wait(6000); return G.fire.F.n; })()`, 60000);
      const reo = n => ev(`(async () => { const A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test, [w, c] = window.__pzIds, wait = ms => new Promise(r => setTimeout(r, ms)); let bad = 0, ms = 0, lost = 0;
        for (let k = 0; k < ${n}; k++) { const n0 = T.G.fire?.F.n || 0, t0 = performance.now(); await A.stopWorld(true); await A.play(w, c); const n1 = T.G.fire?.F.n || 0; if (n0 && n1 !== n0) lost++;
          for (let i = 0; i < 300 && T.G.state !== 'play'; i++) await wait(100); ms = Math.max(ms, performance.now() - t0); T.G.U?.menu?.(null); if (T.G.state !== 'play' || !T.G.fire) bad++;
          if (!T.G.fire.F.n) T.G.fire.igniteAt(29, 516); await wait(700); }
        return { bad, lost, maxOpenMs: Math.round(ms), n: T.G.fire.F.n }; })()`, 900000);
      const ra = await reo(2), h0 = await heap(), rb = await reo(18), h1 = await heap();
      res.reopen = { n: 20, bad: ra.bad + rb.bad, lost: ra.lost + rb.lost, maxOpenMs: Math.max(ra.maxOpenMs, rb.maxOpenMs), h0, h1 };
      console.log('закрыть и открыть мир с пожаром 20 раз', JSON.stringify(res.reopen));
      ok(res.reopen.bad === 0 && res.reopen.lost === 0 && h1 - h0 < 8, '20 раз закрыть и открыть: открывается, горит то же, память JS не растёт', res.reopen);
      const errs = logs.filter(l => !/X3595|DevTools|favicon/i.test(l));
      ok(!errs.length, 'в консоли — без ошибок и исключений', errs.slice(0, 6));
    }
    if (MODE === 'soak') {
      // N минут: строим, сажаем траву и деревья, поджигаем, роняем факелы, льём воду, ломаем; герой бегает по залу
      await ev(`(async () => { ${SETUP} ${SCENE} T.tp(42, 513); await wait(1500); return 1; })()`, 60000);
      const h0 = await heap(), t0 = Date.now();
      res.soak = await ev(`(async () => { ${SETUP} let s = 7, act = 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
        const end = performance.now() + ${SOAK_MIN} * 60000, X = G.fire;
        while (performance.now() < end) {
          const r = rnd(), x = 3 + Math.floor(rnd() * 86), y = 476 + Math.floor(rnd() * 40);
          if (r < .3) { if (!T.fgAt(x, y)) T.setCell(x, y, rnd() < .5 ? ID('planks') : ID('tallgrass'), 0, null, 0); }
          else if (r < .38) { if (x % 6 === 0 && !T.fgAt(x, 516)) tree(x, 516, 6 + Math.floor(rnd() * 5), 2); }
          else if (r < .5) X.igniteAt(x, y);
          else if (r < .55) A.dropItem('torch', 1, x + .5, y + .5, 0, 0);
          else if (r < .6) { if (!T.fgAt(x, y)) T.setCell(x, y, null, null, null, 200, 1); }
          else if (r < .75) { if (T.fgAt(x, y) && T.fgAt(x, y) !== 255) T.breakTile(x, y, true); }
          else T.tp(5 + Math.floor(rnd() * 80), 513);
          if (G.items.length > 250) G.items.length = 0;
          act++; await wait(250);
        }
        return { act, ignited: X.F.stats.ignited, burnt: X.F.stats.burnt, peak: X.F.stats.peak, state: G.state }; })()`, SOAK_MIN * 60000 + 120000);
      const h1 = await heap();
      res.soak.min = +((Date.now() - t0) / 60000).toFixed(1); res.soak.h0 = h0; res.soak.h1 = h1;
      console.log('игра с огнём', JSON.stringify(res.soak));
      const errs = logs.filter(l => !/X3595|DevTools|favicon/i.test(l));
      ok(res.soak.state === 'play' && res.soak.ignited > 100 && !errs.length, `${SOAK_MIN} мин игры с огнём — без ошибок в консоли`, { soak: res.soak, errs: errs.slice(0, 6) });
    }
  } catch (e) { fail++; console.log('ОШИБКА', e.message); for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240)); }
  finally {
    console.log('ЗАМЕР', JSON.stringify(res));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(fail ? `podzem-fire-e2e: ${fail} ошибок` : 'podzem-fire-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

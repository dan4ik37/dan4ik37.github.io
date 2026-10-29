// «Подземье» — обрушение (T-022a) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm), профиль телефона (390 × 844,
// ЦП ×4 медленнее): мир «реализм», стена из 1000 плиток — пересчёт при ломании по плитке; мост ~80 плиток падает куском — время
// кадра; 12 кругов «построил — подрубил — упало — убрал» — память; мир закрыть и открыть 20 раз — память; снимок падающего;
// ошибок в консоли нет.
// Запуск из корня сайта: node scripts/podzem-support-e2e.cjs [d3d11|swiftshader]   (снимки — <D37_TMP или E:\claude-tmp>\podzem-support)
// PZ_LOAD=1 — мир с нагрузкой (T-124, W.load = 1): пересчёт — заданием по кусочкам в такте мира (худший такт при ЦП ×4)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [angle = 'd3d11'] = process.argv.slice(2);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 'podzem-support'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOAD = !!process.env.PZ_LOAD;
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
  const profile = fs.mkdtempSync(path.join(OUT, 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--use-angle=${angle}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: OUT, TEMP: OUT } });
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
  const res = {};
  try {
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_age: JSON.stringify({ y: 2000, at: Date.now() - 864e6 }), d37_app: JSON.stringify({ x: 1, v: 1 }) };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
    await send('Page.navigate', { url: BASE + '/#/games/podzem' });
    let up = false;
    for (let i = 0; i < 160 && !up; i++) { await sleep(250); up = await ev(`!!(window.GAME_IMPL?.podzem?._test?.G)`, 3000).catch(() => false); }
    ok(up, '«Подземье» загрузилось');
    // мир «реализм» и герой — через api игры (как кнопки «Новый мир» / «Играть»)
    res.open = await ev(`(async () => { const A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test;
      const w = A.newWorldRecord('Обрушение', 'обрушение', [], 'real'), c = A.newCharRecord('Герой'); if (${LOAD ? 1 : 0}) w.load = 1; await A.put('worlds', w); await A.put('chars', c); window.__pzIds = [w.id, c.id];
      await A.play(w.id, c.id);
      for (let i = 0; i < 200 && T.G.state !== 'play'; i++) await new Promise(r => setTimeout(r, 100));
      T.god(true); T.G.U?.menu?.(null); T.tp(40, 516); await new Promise(r => setTimeout(r, 4000));   // меню поверх игры — убрать
      return { state: T.G.state, sup: T.G.sup?.mode || null, load: !!T.G.sup?.load, chunks: T.G.chunks.size }; })()`, 120000);
    console.log('мир', JSON.stringify(res.open));
    ok(res.open?.state === 'play' && res.open.sup === 'real', 'мир «Обрушение: реализм» открылся', res.open);
    const SETUP = `const T = GAME_IMPL.podzem._test, G = T.G, PZ = window.PZ, ID = k => PZ.TILE[k].id, wait = ms => new Promise(r => setTimeout(r, ms));
      const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T.setCell(x, y, f, 0, null, 0); };
      const put = (x, y, f) => { T.setCell(x, y, f, 0, null, 0); G.sup.placed(x, y); };
      const supIdle = async (ms = 10000) => { const t = performance.now(); while (G.sup?.jobs && performance.now() - t < ms) { const j = G.sup.jobs(); if (!j.busy && !j.queued) break; await wait(30); } };`;
    // площадка: зал в скале, пол — скала; стена из 1000 плиток (досок и кирпича) на полу
    res.wall = await ev(`(async () => { ${SETUP}
      fill(0, 488, 90, 516, 0); fill(0, 517, 90, 532, ID('stone'));   // пол — толща скалы (под ней не пещера)
      let n = 0; for (let y = 497; y <= 516; y++) for (let x = 6; x < 56; x++) { put(x, y, (x + y) % 4 ? ID('planks') : ID('brick')); n++; }
      T.tp(70, 515); await wait(1500); return { n }; })()`, 60000);
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // пересчёт по плитке: ломаем низ стены по одной (как игрок), стена стоит
    res.cell = await ev(`(async () => { ${SETUP}
      const st = G.sup.stats, ms0 = st.ms, n0 = st.solves; st.maxMs = 0;
      st.maxTickMs = 0; const tk0 = st.ticks || 0, tm0 = st.tickMs || 0;
      for (let k = 0; k < 10; k++) { T.breakTile(10 + k * 4, 516, true); await wait(80); await supIdle(); put(10 + k * 4, 516, ID('planks')); }
      const n = st.solves - n0; return { solves: n, avgMs: +((st.ms - ms0) / Math.max(1, n)).toFixed(3), maxMs: +st.maxMs.toFixed(3), groups: st.groups, load: !!G.sup.load, maxTickMs: +(st.maxTickMs || 0).toFixed(3), tickAvgMs: st.ticks > tk0 ? +((st.tickMs - tm0) / (st.ticks - tk0)).toFixed(3) : 0, lastTicks: st.lastTicks || 0 }; })()`, 120000);
    console.log('пересчёт по плитке (стена 1000)', JSON.stringify(res.cell));
    ok(res.cell.solves === 10 && res.cell.groups === 0, 'стена из 1000 плиток: ломаем по плитке — пересчёт есть, ничего не падает', res.cell);
    if (LOAD) ok(res.cell.load && res.cell.maxTickMs <= 2.5, 'нагрузка: задание по кусочкам — худший такт ' + res.cell.maxTickMs + ' мс при ЦП ×4 (заданию нужно ' + res.cell.lastTicks + ' такт.)', res.cell);
    // мост ~80 плиток падает куском: время кадра (ЦП) до и во время
    const bridge = `for (let y = 503; y <= 516; y++) put(60, y, ID('brick')); for (let x = 61; x <= 64; x++) for (let y = 498; y <= 503; y++) put(x, y, ID('planks'));
      for (let x = 61; x <= 64; x++) for (let y = 504; y <= 506; y++) put(x, y, ID('planks'));`;
    const cycle = `(async () => { ${SETUP} ${bridge}
      await wait(1800); const a = G.perf.cpu.slice();   // последние 120 кадров до
      T.breakTile(60, 512, true); if (G.sup.load) { const t = performance.now(); while (!G.sup.groups.length && performance.now() - t < 6000) await wait(20); }
      const groups = G.sup.groups.length, cells = G.sup.groups[0] ? G.sup.groups[0].cells.length / 5 : 0;
      for (let i = 0; i < 40 && G.sup.groups.length; i++) await wait(100); await wait(200);
      const b = G.perf.cpu.slice();   // последние 120 кадров — падение и посадка
      fill(58, 488, 68, 516, 0); for (const it of G.items.splice(0)) void it;
      const avg = q => q.reduce((s, v) => s + v, 0) / Math.max(1, q.length); b.sort((x, y) => x - y);
      return { groups, cells, cpuBefore: +avg(a).toFixed(2), cpuFall: +avg(b).toFixed(2), p95Fall: +(b[Math.floor(b.length * .95)] || 0).toFixed(2), maxFall: +(b[b.length - 1] || 0).toFixed(2) }; })()`;
    res.fall = await ev(cycle, 60000);
    console.log('мост падает куском', JSON.stringify(res.fall));
    ok(res.fall.groups === 1 && res.fall.cells > 30, 'подрубил опору моста — мост падает одним куском', res.fall);
    // снимок падающего куска
    await ev(`(async () => { ${SETUP} ${bridge} await wait(500); T.breakTile(60, 512, true); if (G.sup.load) { const t = performance.now(); while (!G.sup.groups.length && performance.now() - t < 6000) await wait(20); } await wait(260); return 1; })()`);
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }); fs.writeFileSync(path.join(OUT, 'falling.jpg'), Buffer.from(r.data, 'base64')); console.log('  снимок', path.join(OUT, 'falling.jpg'));
    await ev(`(async () => { ${SETUP} await new Promise(r => setTimeout(r, 3000)); fill(58, 488, 68, 516, 0); return 1; })()`);
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const h0 = await heap();
    for (let k = 0; k < 12; k++) await ev(cycle, 60000);
    const h1 = await heap();
    res.heap = { h0, h1 }; console.log('память, МБ', JSON.stringify(res.heap));
    ok(h1 - h0 < 4, '12 кругов «построил — подрубил — упало — убрал»: память JS не растёт', res.heap);
    // 20 раз закрыть и открыть мир «реализм»: открывается, обрушение на месте (переходник — с миром), память JS не растёт
    const reo = n => ev(`(async () => { const A = GAME_IMPL.podzem.api, T = GAME_IMPL.podzem._test, [w, c] = window.__pzIds, wait = ms => new Promise(r => setTimeout(r, ms)); let bad = 0, ms = 0;
      for (let k = 0; k < ${n}; k++) { const t0 = performance.now(); await A.stopWorld(true); await A.play(w, c); for (let i = 0; i < 300 && T.G.state !== 'play'; i++) await wait(100); ms = Math.max(ms, performance.now() - t0); T.G.U?.menu?.(null); if (T.G.state !== 'play' || T.G.sup?.mode !== 'real' || !!T.G.sup?.load !== ${LOAD}) bad++; await wait(300); }
      return { bad, maxOpenMs: Math.round(ms) }; })()`, 900000);
    const ra = await reo(2), r0 = await heap(), rb = await reo(18), r1 = await heap();
    res.reopen = { n: 20, bad: ra.bad + rb.bad, maxOpenMs: Math.max(ra.maxOpenMs, rb.maxOpenMs), h0: r0, h1: r1 }; console.log('закрыть и открыть мир 20 раз', JSON.stringify(res.reopen));
    ok(res.reopen.bad === 0 && r1 - r0 < 8, '20 раз закрыть и открыть мир «реализм»: открывается, обрушение на месте, память JS не растёт', res.reopen);
    const errs = logs.filter(l => !/X3595|DevTools|favicon/i.test(l));
    ok(!errs.length, 'в консоли — без ошибок и исключений', errs.slice(0, 6));
  } catch (e) { fail++; console.log('ОШИБКА', e.message); for (const l of logs.slice(-8)) console.log('  консоль:', l.slice(0, 240)); }
  finally {
    console.log('ЗАМЕР', JSON.stringify(res));
    try { ws.close(); } catch (e) {} proc.kill(); server.close(); await sleep(800); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  console.log(fail ? `podzem-support-e2e: ${fail} ошибок` : 'podzem-support-e2e: всё в порядке');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

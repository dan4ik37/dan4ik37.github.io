// «Мир Денчика»: закрыть и открыть мир N раз (T-085; владелец: «чтобы не вылетало и не лагало» — без утечек за 20 открытий/закрытий)
// в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm). Каждый раз: открыть /play/world, дождаться мира, постоять, закрыть
// (на главную). Проверяет, что прошлые миры уходят из памяти целиком (WeakRef на состояние мира и на контекст WebGL — после сборки
// мусора пусто), память JS после сборки мусора не растёт (до/после — в пределах нескольких МБ, прирост на круг ~0), слушатели
// window/document, setInterval, ожидающие requestAnimationFrame, потоки (Worker), каналы Supabase, живые контексты WebGL и узлы DOM
// — как до первого открытия; без исключений и без «Too many active WebGL contexts».
// Было (до T-085): каждое открытие оставляло весь прошлый мир (~25–30 МБ JS, +1 контекст WebGL): 77 → 350 МБ за 10 раз.
// Держали: подписка D37Age.on в mir-zones.js без отписки; слушатель «click» на рамке игры (#gamesStageBox — живёт дольше мира;
// заодно кнопки срабатывали столько раз, сколько входили); BUILT в mir-zones.js и TABLES[].tag в mir.js (данные модуля держали
// прошлый мир); свой геттер timeMul у каждого игрока (player.js — V8 держит его в общей «форме» объекта); слушатель «dispose» на
// общей геометрии спрайтов three r149 (каждый рендерер — свой, render.js R.dispose теперь снимает).
// Как искать новое: снимок кучи после 1-го закрытия и после N-го, «что держит» прошлый мир — пути от корней (DevTools → Memory →
// Comparison / Retainers; или свой разбор, как в отчёте T-085). Полный прогон: ~4–6 мин.
// Запуск из корня сайта: node scripts/world-reopen-e2e.cjs [N=20] [pc|phone]   (CHROME — путь к Chrome; D37_TMP — временная папка;
// D37_OVERRIDE=<папка> — файлы оттуда вместо сайта: замер «до»; WAIT_MS — сколько ждать после закрытия перед итогом, 12000)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const [N_ = '20', PROF = 'pc'] = process.argv.slice(2);
const N = Math.max(2, +N_ || 20);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't085');
const WAIT = +process.env.WAIT_MS || 12000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  let f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  if (process.env.D37_OVERRIDE) { const o = path.join(process.env.D37_OVERRIDE, p); if (fs.existsSync(o)) f = o; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
server.keepAliveTimeout = 1000;
let fail = 0; const ok = (c, name, extra) => { if (!c) { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } else console.log('ok  ', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); };
// Счётчики страницы (ставятся до скриптов сайта): живые setInterval, ожидающие requestAnimationFrame, потоки, контексты WebGL (WeakRef)
const INSTR = `(() => { if (window.__d37leak) return; const T = window.__d37leak = { iv: new Map(), raf: new Map(), wk: new Set(), gl: [] };
  const where = () => (new Error().stack || '').split('\\n').slice(2, 4).map(s => s.trim().replace(/https?:\\/\\/[^/]+\\//, '').replace(/\\?v=\\d+/, '')).join(' < ');
  const si = setInterval, ci = clearInterval, ra = requestAnimationFrame, ca = cancelAnimationFrame;
  window.setInterval = function(f, ms, ...a){ const id = si(f, ms, ...a); T.iv.set(id, where()); return id; };
  window.clearInterval = function(id){ T.iv.delete(id); return ci(id); };
  window.requestAnimationFrame = function(f){ let id; id = ra(t => { T.raf.delete(id); f(t); }); T.raf.set(id, where()); return id; };
  window.cancelAnimationFrame = function(id){ T.raf.delete(id); return ca(id); };
  const W = window.Worker; if (W) { window.Worker = function(u, o){ const w = new W(u, o), rec = String(u).slice(0, 60) + ' @ ' + where(); T.wk.add(rec); const t = w.terminate.bind(w); w.terminate = () => { T.wk.delete(rec); t(); }; return w; }; window.Worker.prototype = W.prototype; }
  const gc0 = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(k, o){ const c = gc0.call(this, k, o); if (c && /webgl/.test(k) && !c.__d37leak) { c.__d37leak = 1; T.gl.push(new WeakRef(c)); } return c; };
  T.count = () => { const by = m => { const o = {}; for (const v of m.values()) o[v] = (o[v] || 0) + 1; return o; };
    T.gl = T.gl.filter(w => w.deref());
    return { iv: T.iv.size, ivBy: by(T.iv), raf: T.raf.size, rafBy: by(T.raf), wk: [...T.wk], gl: T.gl.filter(w => !w.deref().isContextLost?.()).length, glObj: T.gl.length,
      ch: (window.sbClient?.getChannels?.() || []).map(c => c.topic).sort(), nodes: document.getElementsByTagName('*').length }; };
})();`;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port, port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(TMP, 'd37-reopen-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { console.log('Chrome не запустился'); proc.kill(); server.close(); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) errs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, ms = 120000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const gc = async () => { await send('HeapProfiler.collectGarbage'); await sleep(60); await send('HeapProfiler.collectGarbage'); };
  const heapMB = async () => { await gc(); const h = await send('Runtime.getHeapUsage'); return +(h.usedSize / 1048576).toFixed(1); };
  // слушатели window, document и рамки игры (#gamesStageBox и #gamesStage живут дольше мира — мир вешал на рамку «click» и не снимал)
  const listeners = async () => {
    const L = {};
    for (const [nm, ex] of [['window', 'window'], ['document', 'document'], ['box', `document.getElementById('gamesStageBox')`], ['stage', `document.getElementById('gamesStage')`]]) {
      const o = await send('Runtime.evaluate', { expression: ex });
      L[nm] = o.result.objectId ? (await send('DOMDebugger.getEventListeners', { objectId: o.result.objectId })).listeners.length : -1;
    }
    return L;
  };
  const snap = async () => ({ heapMB: await heapMB(), ...(await listeners()), ...(await ev('__d37leak.count()')) });
  const phone = PROF === 'phone', Q = phone ? 'mid' : 'high';
  const res = { prof: PROF, n: N, closedMB: [], openMB: [], openMs: [] };
  try {
    await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
    await send('Emulation.setDeviceMetricsOverride', phone ? { width: 412, height: 915, deviceScaleFactor: 2, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    if (phone) {
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: Q, gfx: Q }), d37_gfx: Q };
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');}catch(e){}` + INSTR });
    await send('Page.navigate', { url: BASE + '/' });
    for (let i = 0; i < 80 && !(await ev(`!!(window.D37Route && window.GAME_IMPL !== undefined && document.readyState === 'complete')`).catch(() => false)); i++) await sleep(250);
    await sleep(2500);
    const open = async (sec = 40) => {
      const t0 = Date.now();
      await ev(`location.hash = '#/games/world'`);
      let up = false; for (let i = 0; i < sec * 4 && !up; i++) { await sleep(250); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 5000); } catch (e) {} }
      return up ? Date.now() - t0 : -1;
    };
    const close = async () => { await ev(`location.hash = '#/home'`); };
    // разогрев — 2 круга: первое открытие грузит скрипты движка и мира, three.js с jsDelivr (остаются — это не утечка), второе — V8
    // дособирает горячий код; дальше память «до» — честная
    for (let w = 1; w <= 2; w++) {
      const ms0 = await open(w === 1 ? 120 : 40);
      if (ms0 < 0) { ok(false, `мир не открылся (разогрев ${w})`); throw new Error('мир не открылся'); }
      console.log(`  разогрев ${w}: мир открылся за ${ms0} мс`);
      await sleep(2500); await close(); await sleep(w === 1 ? 2000 : WAIT);
    }
    const B = await snap();
    console.log('  до (после разогрева, мир закрыт):', JSON.stringify(B));
    for (let k = 1; k <= N; k++) {
      const ms = await open(); res.openMs.push(ms);
      if (ms < 0) { ok(false, `открытие ${k}: мир не открылся`); break; }
      await sleep(2500);
      if (k === 1 || k === N || k % 5 === 0) res.openMB.push([k, await heapMB()]);   // мир открыт — то, что видит игрок
      await ev(`(() => { const S = GAME_IMPL.world._test.state(); window.__d37worlds = window.__d37worlds || []; window.__d37worlds.push([new WeakRef(S), S.R?.r ? new WeakRef(S.R.r.getContext()) : null]); return 1; })()`);
      await close(); await sleep(1500);
      res.closedMB.push(await heapMB());
      if (k % 5 === 0) console.log(`  ${k}/${N}: мир закрыт — память JS ${res.closedMB.slice(-5).join(' · ')} МБ, открытие ${res.openMs.slice(-5).join(' · ')} мс`);
    }
    await sleep(WAIT);
    const F = await snap();
    const alive = await ev(`(window.__d37worlds || []).map(([s, g], i) => (s.deref() ? 'S' : '') + (g?.deref() ? 'G' : '')).map((v, i) => v ? (i + 1) + v : '').filter(Boolean)`);
    res.before = B; res.after = F; res.alive = alive;
    console.log('  после ' + N + ' (мир закрыт):', JSON.stringify(F));
    console.log('  память JS, мир закрыт (после каждого круга):', res.closedMB.join(' → '));
    console.log('  память JS, мир открыт:', res.openMB.map(([k, v]) => `#${k} ${v}`).join(' · '));
    // ── проверки ──
    ok(!alive.length, `${N} закрытий: ни одного прошлого мира и контекста WebGL в памяти (WeakRef после сборки мусора)`, alive);
    const grow = +(F.heapMB - B.heapMB).toFixed(1);
    // прирост на круг — по медианам начала и конца (код, который V8 дособирает горячим, растёт в первых кругах и выходит на полку;
    // одиночный выброс — то, что было в пути в момент закрытия, — медиана не замечает)
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const C = res.closedMB, q = Math.max(2, Math.min(5, C.length >> 2)), early = med(C.slice(q, 2 * q)), late = med(C.slice(-q)), span = Math.max(1, C.length - 2.5 * q);
    const slope = (late - early) / span;
    ok(grow <= 6, `память JS после сборки мусора: до ${B.heapMB} → после ${N} кругов ${F.heapMB} МБ (+${grow}, допуск 6)`, { grow });
    ok(slope <= .2, `прирост на круг: ${slope.toFixed(2)} МБ (медианы ${early} → ${late}; допуск 0,2)`, C);
    ok(F.window <= B.window && F.document <= B.document, `слушатели window / document: ${B.window}/${B.document} → ${F.window}/${F.document}`);
    ok(F.box <= B.box && F.stage <= B.stage, `слушатели рамки игры (#gamesStageBox / #gamesStage): ${B.box}/${B.stage} → ${F.box}/${F.stage}`);
    ok(F.iv <= B.iv, `setInterval: ${B.iv} → ${F.iv}`, F.iv > B.iv ? F.ivBy : undefined);
    ok(F.raf <= B.raf + 1, `ожидающие requestAnimationFrame: ${B.raf} → ${F.raf}`, F.raf > B.raf + 1 ? F.rafBy : undefined);
    ok(F.wk.length <= B.wk.length, `потоки (Worker): ${B.wk.length} → ${F.wk.length}`, F.wk);
    ok(F.ch.length <= B.ch.length, `каналы Supabase: ${B.ch.length} → ${F.ch.length}`, F.ch);
    ok(F.gl <= B.gl, `живые контексты WebGL: ${B.gl} → ${F.gl} (объектов контекста ${B.glObj} → ${F.glObj})`);
    ok(F.glObj <= B.glObj, `объекты контекстов WebGL в памяти: ${B.glObj} → ${F.glObj}`);
    ok(F.nodes <= B.nodes + 5, `узлы DOM: ${B.nodes} → ${F.nodes}`);
    // мир открыт: сколько успело построиться за 2,5 с, каждый раз по-разному (±15 МБ) — проверяем только, что не копится:
    // до T-085 каждый круг добавлял ~25–30 МБ (за 20 кругов — сотни МБ)
    if (res.openMB.length >= 2) { const o0 = res.openMB[0][1], omax = Math.max(...res.openMB.map(o => o[1])); ok(omax - o0 <= 20, `мир открыт: память JS #1 ${o0} МБ, наибольшая ${omax} МБ (допуск +20: зоны догружаются по-разному; было +25–30 за круг)`); }
    const bad = errs.filter(e => /exception|Too many active WebGL|CONTEXT_LOST|out of memory/i.test(e));
    ok(!bad.length, 'без исключений и без «Too many active WebGL contexts»', bad.slice(0, 4));
  } catch (e) { ok(false, 'исключение: ' + (e.stack || e.message)); }
  res.fail = fail;
  try { fs.writeFileSync(path.join(OUT, `reopen-${PROF}${process.env.D37_OVERRIDE ? '-before' : ''}.json`), JSON.stringify(res, null, 1)); } catch (e) {}
  console.log(fail ? `world-reopen-e2e: ${fail} FAIL` : 'world-reopen-e2e: всё ok');
  try { ws.close(); } catch (e) {} proc.kill(); server.closeAllConnections?.(); server.close();
  await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();

// Мини-игры на ArcadeKit (T-140) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm), «телефон»: 412×915, касания, CPU ×4.
//   1) одиночная партия: старт не кончает игру сам (баг прототипа «нажал — сразу конец»), бот игры (scripts/arcade/<id>.cjs → e2e)
//      играет N с — время шага+рисования на кадр (среднее / p95 / p99), кадры в секунду, пауза при скрытой вкладке, конец партии,
//      рекорд сохранён, «↻ Ещё раз»;
//   2) 20 открытий/закрытий игры: слушатели window/document, requestAnimationFrame, узлы .ak и память до/после;
//   3) «⚔️ Соревнование» двумя браузерами (разные гости) через настоящий Supabase Realtime: одинаковые плитки/дома у обоих,
//      счёт соперника вживую, итог «Ты победил» / «Победил …» у обоих.
// Запуск из корня сайта:  node scripts/arcade-e2e.cjs [tiles,lights] [сек]   (Chrome — переменная CHROME; временное — D37_TMP)
//   E2E_LEAK=id,id / E2E_DUEL=id,id — 2) и 3) только для этих игр (none — ни для одной; по умолчанию — для всех из списка).
// Снимки — <D37_TMP>/shots.
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || 'E:/claude-tmp/t140';
const OUT = path.join(TMP, 'shots');
const IDS = (process.argv[2] || 'tiles,lights').split(',');
const SECS = +process.argv[3] || 15;
const only = v => (v === undefined || v === '' || v === 'all' ? IDS : v === 'none' ? [] : v.split(','));
const LEAK = only(process.env.E2E_LEAK), DUEL = only(process.env.E2E_DUEL);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; } console.log(c ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); };
const NOISE = /Failed to fetch|NetworkError|_vercel|ERR_|net::|ResizeObserver|adsbygoogle|googlesyndication|pagead|favicon/;
fs.mkdirSync(OUT, { recursive: true });

// ── сервер сайта (настоящие адреса из vercel.json → index.html) ──
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
const SPA = JSON.parse(fs.readFileSync(path.join(SITE, 'vercel.json'), 'utf8')).rewrites.filter(r => r.destination === '/index.html').map(r => new RegExp('^' + r.source.replace(/\/:path\+$/, '/.+') + '$'));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' || SPA.some(rx => rx.test(p))) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});

// ── Chrome: один процесс — один игрок (свой профиль: свой гость) ──
async function browser(tag){
  let port = 0;   // Chrome picks a free port and writes it to <profile>/DevToolsActivePort (a fixed range collided with other Chromes)
  const profile = fs.mkdtempSync(path.join(TMP, 'chrome-' + tag + '-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--hide-scrollbars', '--enable-precise-memory-info', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 240 && !page; i++) { try { if (!port) port = parseInt(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'), 10) || 0; if (port) page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился: ' + CHROME); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails || {}; errors.push(((x.exception?.description || x.exception?.value || x.text || '') + ' @' + (x.url || x.stackTrace?.callFrames?.[0]?.url || '').split('/').slice(-2).join('/') + ':' + (x.lineNumber ?? '')).slice(0, 300)); }
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push('console.error ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 300)); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_app',JSON.stringify({x:1,v:1,last:Date.now()}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const B = { tag, send, ev, errors,
    go: async url => { await send('Page.navigate', { url }); await sleep(700); },
    waitFor: async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; },
    shot: async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); return name; },
    close: async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} },
  };
  return B;
}

// ── в странице: замер (шаг + рисование на кадр, интервалы кадров) и боты ──
const PROBE = id => `(() => {
  const sp = GAME_IMPL.${id}._test.spec, P = { work: new Float32Array(30000), dt: new Float32Array(30000), n: 0, last: 0, acc: 0 };
  if (!sp.__probe) {
    sp.__probe = true;
    const st = sp.step, dr = sp.draw;
    sp.step = function (s, dt, inp){ const t0 = performance.now(); st(s, dt, inp); window.__ak && (window.__ak.acc += performance.now() - t0); };
    sp.draw = function (G, s, a){ const t0 = performance.now(); dr(G, s, a); window.__ak && (window.__ak.acc += performance.now() - t0); };
  }
  const loop = now => { if (P.last && P.n < 30000) { P.dt[P.n] = now - P.last; P.work[P.n] = P.acc; P.n++; } P.acc = 0; P.last = now; P.raf = requestAnimationFrame(loop); };
  P.raf = requestAnimationFrame(loop);
  window.__ak = P; return 1; })()`;
const STATS = `(() => { const P = window.__ak; cancelAnimationFrame(P.raf); const n = P.n;
  const w = Array.from(P.work.subarray(0, n)).sort((a, b) => a - b), d = Array.from(P.dt.subarray(0, n)).sort((a, b) => a - b), q = (a, k) => a[Math.min(a.length - 1, Math.floor(a.length * k))];
  const sum = a => a.reduce((x, y) => x + y, 0);
  return { frames: n, fps: +(1000 * n / sum(d)).toFixed(1), workAvg: +(sum(w) / n).toFixed(3), workP95: +q(w, .95).toFixed(3), workP99: +q(w, .99).toFixed(3), workMax: +w[n - 1].toFixed(2),
    dtP99: +q(d, .99).toFixed(1), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 0 }; })()`;
// бот игры — scripts/arcade/<id>.cjs → e2e: { bot(gap, stopAfter) → строка JS (ставит window.__bot), gap, stopB, endByStop, endMs,
// field (поле состояния, одинаковое у соперников), before / after (свои проверки) }
const STOP_BOT = 'clearInterval(window.__bot), 1';
const CUR = id => `GAME_IMPL.${id}._test.cur()`;
const conf = id => { const f = path.join(__dirname, 'arcade', id + '.cjs'); return fs.existsSync(f) ? require(f).e2e : null; };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://localhost:${server.address().port}`;
  const report = {};
  let A = null, Bp = null;
  try {
    A = await browser('a');
    for (const id of IDS) {
      const R = report[id] = {}, E = conf(id), cur = CUR(id);
      if (!E) { ok(false, id + ': нет scripts/arcade/' + id + '.cjs с e2e-ботом'); continue; }
      // ── 1) одиночная партия ──
      await A.go(`${BASE}/#/games/${id}`);
      let opened = await A.waitFor(`!!document.querySelector('.ak .ak-go') && !!${cur}`, 30000);
      if (!opened) R.diag = await A.ev(`({ href: location.href, impl: !!window.GAME_IMPL?.['${id}'], ak: !!document.querySelector('.ak'), stage: (document.querySelector('#gamesStageBox')?.innerText || '').slice(0, 120), pending: performance.getEntriesByType('resource').filter(r => !r.responseEnd).map(r => r.name.split('/').slice(-2).join('/')), scripts: [...document.scripts].filter(x => x.src.includes('/arcade/')).map(x => x.src.split('/').pop()), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 })`).catch(e => String(e));
      if (!opened) { await A.go(`${BASE}/#/games/${id}`); opened = (await A.waitFor(`!!document.querySelector('.ak .ak-go') && !!${cur}`, 30000)) && 2; }
      ok(opened, id + ': игра открылась (оболочка ArcadeKit)' + (opened === 2 ? ' — со 2-й попытки' : ''), opened === true ? undefined : R.diag);
      if (!opened) continue;
      await sleep(600);
      await A.shot(`${id}-1-start.png`);
      await A.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await A.ev(`document.querySelector('.ak-go').click(), 1`);
      await sleep(1500);
      ok(await A.ev(`!${cur}.over && GAME_IMPL.${id}._test.running()`), id + ': через 1,5 с после «▶ Начать» без нажатий игра идёт (не кончилась сама)');
      if (E.before) await E.before(A, ok, cur, sleep);
      await A.ev(PROBE(id));
      await A.ev(E.bot(E.gap));
      await sleep(SECS * 1000 / 2);
      await A.shot(`${id}-2-play.png`);
      // пауза: вкладку «свернули» — шаги стоят, оверлей «Пауза»; «Продолжить» — дальше
      const p0 = await A.ev(`(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
        return { over: ${cur}.over, run: GAME_IMPL.${id}._test.running() }; })()`);
      await sleep(800);
      const p1 = await A.ev(`({ run: GAME_IMPL.${id}._test.running(), title: document.querySelector('.ak-ot').textContent, shown: !document.querySelector('.ak-over').hidden })`);
      ok(p0.over || (!p0.run && !p1.run && p1.shown && /Пауза/.test(p1.title)), id + ': вкладка скрыта — пауза', { p0, p1 });
      await A.ev(`(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return 1; })()`);
      await sleep(450);
      if (!p0.over) await A.ev(`document.querySelector('.ak-go').click(), 1`);
      await sleep(SECS * 1000 / 2);
      R.perf = await A.ev(STATS);
      // бюджет кадра 60 Гц — 16,7 мс; редкие пики (сборка мусора, JIT) на «телефоне» ×4 — до половины кадра
      ok(R.perf.workP95 < 3 && R.perf.workP99 < 8, id + ': шаг + рисование на «телефоне» (CPU ×4): p95 < 3 мс, p99 < 8 мс на кадр', R.perf);
      if (E.endByStop) await A.ev(STOP_BOT);
      ok(await A.waitFor(`${cur}?.over && !document.querySelector('.ak-over').hidden`, E.endMs || 20000), id + ': партия кончилась, оверлей итога');
      await A.ev(STOP_BOT);
      await sleep(300);
      await A.shot(`${id}-3-over.png`);
      R.end = await A.ev(`(() => { const s = ${cur}; return { score: s.score, title: document.querySelector('.ak-ot').textContent, text: document.querySelector('.ak-os').textContent,
        btn: document.querySelector('.ak-go').textContent, best: JSON.parse(localStorage.getItem('d37_game_${id}') || '{}').best || 0 }; })()`);
      ok(R.end.score > 0 && R.end.best >= R.end.score && /Ещё раз/.test(R.end.btn), id + ': счёт > 0, рекорд сохранён (gamesApi.report), кнопка «↻ Ещё раз»', R.end);
      if (E.after) await E.after(A, ok, cur, sleep);
      // «↻ Ещё раз» — новая партия (новый seed), сразу идёт
      const f0 = await A.ev(`Array.from(${cur}.${E.field}).join('')`);
      await A.ev(`document.querySelector('.ak-go').click(), 1`);
      await sleep(400);
      const again = await A.ev(`(() => { const s = ${cur}; return { over: s.over, score: s.score, hidden: document.querySelector('.ak-over').hidden, run: GAME_IMPL.${id}._test.running() }; })()`);
      const f1 = await A.ev(`Array.from(${cur}.${E.field}).join('')`);
      ok(!again.over && again.score === 0 && again.hidden && again.run && f0 !== f1, id + ': «↻ Ещё раз» — новая партия (новое поле) идёт', again);
      await A.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      // ── 2) 20 открытий / закрытий ──
      if (!LEAK.includes(id)) continue;
      // живые слушатели window / document (функция + тип + capture); снятие незнакомого (добавлен до замера) не считается
      await A.ev(`(() => { if (window.__lc) return 1; const c = window.__lc = { win: 0, doc: 0 };
        for (const [o, k] of [[window, 'win'], [document, 'doc']]) { const a = o.addEventListener, r = o.removeEventListener, reg = new Map();
          const key = (t, x) => t + '|' + !!(x === true || x?.capture);
          o.addEventListener = function (t, f, x){ if (f) { let s = reg.get(f); if (!s) reg.set(f, s = new Set()); if (!s.has(key(t, x))) { s.add(key(t, x)); c[k]++; } } return a.call(this, t, f, x); };
          o.removeEventListener = function (t, f, x){ const s = f && reg.get(f); if (s && s.delete(key(t, x))) c[k]--; return r.call(this, t, f, x); }; }
        return 1; })()`);
      const cycle = async () => { await A.ev(`location.hash = '#/games', 1`); await sleep(250); await A.ev(`location.hash = '#/games/${id}', 1`); await A.waitFor(`!!document.querySelector('.ak .ak-go')`, 8000); await sleep(150); await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(200); };
      await cycle(); await A.ev(`location.hash = '#/games', 1`); await sleep(400);
      await A.send('HeapProfiler.collectGarbage');
      const L0 = await A.ev(`({ win: __lc.win, doc: __lc.doc, ak: document.querySelectorAll('.ak').length, heap: performance.memory.usedJSHeapSize })`);
      for (let i = 0; i < 20; i++) await cycle();
      await A.ev(`location.hash = '#/games', 1`); await sleep(500);
      await A.send('HeapProfiler.collectGarbage'); await sleep(200); await A.send('HeapProfiler.collectGarbage');
      const L1 = await A.ev(`({ win: __lc.win, doc: __lc.doc, ak: document.querySelectorAll('.ak').length, heap: performance.memory.usedJSHeapSize, inst: !!GAME_IMPL.${id}._test.inst() })`);
      R.leak = { winListeners: L1.win - L0.win, docListeners: L1.doc - L0.doc, akNodes: L1.ak, heapKB: Math.round((L1.heap - L0.heap) / 1024), instAfterClose: L1.inst };
      ok(L1.win === L0.win && L1.doc === L0.doc && L1.ak === 0 && !L1.inst && L1.heap - L0.heap < 1.5 * 1048576, id + ': 20 открытий/закрытий — без лишних слушателей, узлов и памяти', R.leak);
    }

    // ── 3) «⚔️ Соревнование» двумя браузерами ──
    for (const id of DUEL) {
      const E = conf(id), cur = CUR(id);
      if (!E || !report[id]) continue;
      const D = report[id].duel = {};
      Bp = Bp || await browser('b');
      const code = 't' + Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
      await A.go(`${BASE}/#/games`);
      await A.go(`${BASE}/#/games/${id}/${code}`);
      await sleep(1200);
      await Bp.go(`${BASE}/#/games/${id}/${code}`);
      const both = (await A.waitFor(`!!document.querySelector('.vs .ak-go')`, 30000)) && (await Bp.waitFor(`!!document.querySelector('.vs .ak-go')`, 30000));
      ok(both, id + ': ⚔️ оба в комнате, партия началась (Supabase Realtime)');
      if (!both) { D.err = await A.ev(`document.querySelector('#gamesStageBox')?.innerText.slice(0, 200)`); continue; }
      await A.shot(`${id}-4-duel-start.png`);
      const fa = await A.ev(`Array.from(${cur}.${E.field}).join('')`), fb = await Bp.ev(`Array.from(${cur}.${E.field}).join('')`);
      ok(fa === fb, id + ': ⚔️ одинаковое поле у обоих (seed хозяина)', { a: fa, b: fb });
      await sleep(500);
      await A.ev(`document.querySelector('.ak-go').click(), 1`); await Bp.ev(`document.querySelector('.ak-go').click(), 1`);
      // A играет дольше, B бросает раньше (E.stopB): у A больше очков
      await A.ev(E.bot(E.gap)); await Bp.ev(E.bot(E.gap, E.stopB));
      await sleep(6000);
      D.live = await A.ev(`({ me: document.querySelector('#vsMe')?.textContent, opp: document.querySelector('#vsOpp')?.textContent })`);
      ok(+String(D.live.opp).replace(/\D/g, '') > 0, id + ': ⚔️ счёт соперника виден по ходу', D.live);
      if (E.endByStop) { await sleep(3000); await A.ev(STOP_BOT); }
      const doneA = await A.waitFor(`!!document.querySelector('.vs-result')`, (E.endMs || 20000) + 15000), doneB = await Bp.waitFor(`!!document.querySelector('.vs-result')`, (E.endMs || 20000) + 15000);
      D.a = await A.ev(`document.querySelector('.vs-result')?.innerText`); D.b = await Bp.ev(`document.querySelector('.vs-result')?.innerText`);
      await A.shot(`${id}-5-duel-a.png`); await Bp.shot(`${id}-5-duel-b.png`);
      ok(doneA && doneB && /Ты победил/.test(D.a || '') && /Победил/.test(D.b || '') && !/Ты победил/.test(D.b || ''), id + ': ⚔️ итог у обоих: A «Ты победил», B «Победил …»', D);
      await A.ev(STOP_BOT); await Bp.ev(STOP_BOT);
      await A.go(`${BASE}/#/games`); await Bp.go(`${BASE}/#/games`);
    }
  } catch (e) { report.error = String(e.stack || e); ok(false, 'без исключений в самой проверке', report.error); }
  const all = [...(A?.errors || []), ...(Bp?.errors || [])], errs = all.filter(e => !NOISE.test(e));
  if (process.env.E2E_ALL_ERR) console.log('все ошибки консоли:', all);
  ok(!errs.length, 'нет ошибок в консоли', errs.slice(0, 5));
  console.log(JSON.stringify(report, null, 1));
  console.log(`arcade-e2e: ${pass} ok, ${fail} fail; снимки — ${OUT}`);
  await A?.close(); await Bp?.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();

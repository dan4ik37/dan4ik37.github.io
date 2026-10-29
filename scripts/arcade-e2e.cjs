// Мини-игры на ArcadeKit (T-140) в НАСТОЯЩЕМ Chrome (headless, DevTools Protocol, без npm), «телефон»: 412×915, касания, CPU ×4.
//   1) одиночная партия: старт не кончает игру сам (баг прототипа «нажал — сразу конец»), бот игры (scripts/arcade/<id>.cjs → e2e)
//      играет N с — время шага+рисования на кадр (среднее / p95 / p99), кадры в секунду, пауза при скрытой вкладке, конец партии,
//      рекорд сохранён, «↻ Ещё раз»;
//   2) 20 открытий/закрытий игры: слушатели window/document, requestAnimationFrame, узлы .ak и память до/после;
//   3) «⚔️ Соревнование» двумя браузерами (разные гости) через настоящий Supabase Realtime: одинаковые плитки/дома у обоих,
//      счёт соперника вживую, итог «Ты победил» / «Победил …» у обоих.
// Запуск из корня сайта:  node scripts/arcade-e2e.cjs [tiles,lights] [сек]   (Chrome — переменная CHROME; временное — D37_TMP)
//   E2E_LEAK=id,id / E2E_DUEL=id,id — 2) и 3) только для этих игр (none — ни для одной; по умолчанию — для всех из списка).
//   0) до игр (проверка T-140): E2E_CORE=none — без проверок самого ядра (два пальца в «Поп-ите», пауза под окнами сайта,
//      пробел и стрелки не листают страницу, потеря фокуса отпускает клавишу); E2E_HUD=id,id|none — строка HUD на телефоне
//      360 px: все строки HUD из партии бота (node) при счёте и рекорде в 5 цифр (предел очков игры) не обрезаются.
// Снимки — <D37_TMP>/shots.
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || 'E:/claude-tmp/t140';
const OUT = path.join(TMP, 'shots');
const IDS = (process.argv[2] || 'tiles,lights').split(',');
const SECS = +process.argv[3] || 15;
const only = v => (v === undefined || v === '' || v === 'all' ? IDS : v === 'none' ? [] : v.split(','));
const LEAK = only(process.env.E2E_LEAK), DUEL = only(process.env.E2E_DUEL), HUD = only(process.env.E2E_HUD), CORE = process.env.E2E_CORE !== 'none';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; } console.log(c ? 'ok  ' : 'FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, +process.env.E2E_EXTRA || 700)); };
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

// ── 0) ядро в настоящем Chrome (проверка T-140) ──
const PHONE = { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true };
const KEYS = { Space: [' ', 32], Enter: ['Enter', 13], ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40] };
const keyEv = (B, type, code) => { const [key, kc] = KEYS[code]; return B.send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, text: type === 'keyDown' && key.length === 1 ? key : type === 'keyDown' && code === 'Enter' ? '\r' : undefined }); };
const press = async (B, code) => { await keyEv(B, 'keyDown', code); await sleep(40); await keyEv(B, 'keyUp', code); };
// DevTools: touchPoints — пальцы, что ДЕРЖАТ после события (пропал из списка — отпущен); touchEnd / touchCancel — без точек
// (с точками Chrome мог «залипнуть», и следующие касания на странице не приходили вовсе)
const touch = (B, type, pts) => B.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 4, radiusY: 4, force: 1 })) });
async function openGame(B, BASE, id){
  await B.go(`${BASE}/#/games/${id}`);
  const ok1 = await B.waitFor(`!!document.querySelector('.ak .ak-go') && !!${CUR(id)}`, 30000);
  await B.ev(`(() => { document.querySelector('.ak')?.scrollIntoView({ block: 'end' }); return 1; })()`); await sleep(300);
  return ok1;
}
const RUN = id => `GAME_IMPL.${id}._test.running()`;
const UI = `({ shown: !document.querySelector('.ak-over').hidden, title: document.querySelector('.ak-ot').textContent, btn: document.querySelector('.ak-go').textContent })`;
async function coreE2E(A, BASE){
  // P1: «Поп-ит» на телефоне — два пальца внахлёст (второй нажал до того, как отпустил первый): каждая пупырка лопается;
  // одиночный тап — ровно одна (pointerdown, без второго счёта от click); Enter на пупырке с клавиатуры — тоже
  if (await openGame(A, BASE, 'popit')) {
    await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(300);
    const c = i => A.ev(`(() => { const r = document.querySelectorAll('.pp-b')[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const pops = () => A.ev(`${CUR('popit')}.pops`);
    for (let i = 0; i < 6; i++) { const p = await c(i); await touch(A, 'touchStart', [{ ...p, id: 1 }]); await sleep(50); await touch(A, 'touchEnd', []); await sleep(70); }
    await sleep(150);
    const single = await pops();
    for (let i = 0; i < 6; i++) {
      const L = await c(10 + i * 2), Rr = await c(11 + i * 2);
      await touch(A, 'touchStart', [{ ...L, id: 1 }]); await sleep(40);
      await touch(A, 'touchStart', [{ ...L, id: 1 }, { ...Rr, id: 2 }]); await sleep(40);
      await touch(A, 'touchMove', [{ ...L, id: 1 }]); await sleep(40);   // 2-й палец отпущен, 1-й ещё держит (touchEnd — без точек)
      await touch(A, 'touchEnd', []); await sleep(60);
    }
    await sleep(200);
    const two = (await pops()) - single;
    await A.ev(`document.querySelectorAll('.pp-b')[25].focus(), 1`); await press(A, 'Enter'); await sleep(250);
    const kb = (await pops()) - single - two;
    ok(single === 6 && two === 12 && kb === 1, 'core: «Поп-ит» — 6 одиночных тапов = 6, два пальца внахлёст 12 из 12, Enter с клавиатуры — 1', { single, two, kb });
  } else ok(false, 'core: «Поп-ит» открылся');
  // D1: остальные DOM-игры (pick 'tap' по умолчанию) — два пальца внахлёст тоже считаются оба (браузер не шлёт click),
  // одиночный тап — ровно один, свайп по полю листает страницу и нажатием не считается, Enter с клавиатуры — нажатие
  const thumbs = async (a, b) => {
    await touch(A, 'touchStart', [{ ...a, id: 1 }]); await sleep(40);
    await touch(A, 'touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]); await sleep(40);
    await touch(A, 'touchMove', [{ ...a, id: 1 }]); await sleep(40);   // 2-й палец отпущен, 1-й ещё держит
    await touch(A, 'touchEnd', []); await sleep(80);
  };
  const center = (sel, i) => A.ev(`(() => { const r = document.querySelectorAll(${JSON.stringify(sel)})[${i}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (await openGame(A, BASE, 'parking')) {
    // «▶ Начать» не нажимается в первые 350 мс после показа (поздний тап из игры) — подождать
    await sleep(400); await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(400);
    const act = () => A.ev(`(${CUR('parking')}.gone + ${CUR('parking')}.bumps)`), a0 = await act();
    await thumbs(await center('.ak-dom [data-k]', 0), await center('.ak-dom [data-k]', 1)); await sleep(300);
    ok((await act()) - a0 === 2 && await A.ev(RUN('parking')), 'core: «Парковка» — два пальца внахлёст по двум машинам — два действия', { actions: (await act()) - a0 });
  } else ok(false, 'core: «Парковка» открылась');
  // «Свет в окнах» — события указателя из страницы (CDP-касания в headless Chrome после двух мультитач-жестов во вкладке
  // перестают доходить до страницы вовсе — это эмуляция, не игра; настоящие касания по «Свету» — scripts в отчёте T-140):
  // тап (down + up + click detail 1) = 1, два пальца внахлёст (click нет) = 2, свайп (pointercancel) = 0, увёл палец с окна = 0
  if (await openGame(A, BASE, 'lights')) {
    await sleep(400); await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(400);
    const mv = () => A.ev(`${CUR('lights')}.moves`), m0 = await mv();
    const P = (type, i, id, dx = 0) => A.ev(`(() => { const b = document.querySelectorAll('.lt-win')[${i}], r = b.getBoundingClientRect();
      const o = { clientX: r.left + r.width / 2 + ${dx}, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, pointerId: ${id}, pointerType: 'touch', isPrimary: ${id} === 21, button: ${type === 'pointermove' ? -1 : 0} };
      b.dispatchEvent('${type}' === 'click' ? new MouseEvent('click', { ...o, detail: 1 }) : new PointerEvent('${type}', o)); return 1; })()`);
    await P('pointerdown', 0, 21); await P('pointerup', 0, 21); await P('click', 0, 21); await sleep(150);
    const m1 = await mv();
    await P('pointerdown', 2, 21); await P('pointerdown', 6, 22); await P('pointerup', 6, 22); await P('pointerup', 2, 21); await sleep(150);
    const m2 = await mv();
    await P('pointerdown', 4, 21); await P('pointercancel', 4, 21); await sleep(100);
    await P('pointerdown', 4, 21); await P('pointerup', 4, 21, 300); await sleep(150);
    const m3 = await mv();
    await A.ev(`document.querySelectorAll('.lt-win')[8].focus(), 1`); await press(A, 'Enter'); await sleep(250);
    const m4 = await mv();
    ok(m1 - m0 === 1 && m2 - m1 === 2 && m3 === m2 && m4 - m3 === 1, 'core: «Свет в окнах» — тап = 1 ход, два пальца внахлёст = 2, свайп / увёл палец — не ход, Enter = 1', { single: m1 - m0, two: m2 - m1, swipe: m3 - m2, kb: m4 - m3 });
  } else ok(false, 'core: «Свет в окнах» открылся');
  // «Повтори мелодию» (pick 'down'): нота — при касании; два пальца внахлёст — обе ноты по порядку касаний (палец, что
  // отпустили раньше, не «обгоняет»), сердечки целы
  if (await openGame(A, BASE, 'repeat')) {
    await sleep(400); await A.ev(`document.querySelector('.ak-go').click(), 1`);
    const S = CUR('repeat');
    const P = (type, i, id) => A.ev(`(() => { const b = document.querySelectorAll('.rp-k')[${i}], r = b.getBoundingClientRect();
      b.dispatchEvent(new PointerEvent('${type}', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, pointerId: ${id}, pointerType: 'touch', isPrimary: ${id} === 31, button: 0 })); return 1; })()`);
    let res = null;
    for (let round = 1; round <= 6 && !res; round++) {
      if (!await A.waitFor(`${S}.phase === 2 && ${S}.round === ${round}`, 20000)) break;
      const seq = await A.ev(`Array.from(${S}.seq.subarray(0, ${round}))`);
      let j = -1; for (let i = 0; i + 1 < seq.length; i++) if (seq[i] !== seq[i + 1]) { j = i; break; }
      for (let i = 0; i < seq.length; i++) {
        if (i === j) {
          const h0 = await A.ev(`${S}.hearts`);
          await P('pointerdown', seq[i], 31); await sleep(30); await P('pointerdown', seq[i + 1], 32); await sleep(30); await P('pointerup', seq[i + 1], 32); await P('pointerup', seq[i], 31);
          await sleep(200);
          res = { round, j, notes: [seq[i], seq[i + 1]], hearts: [h0, await A.ev(`${S}.hearts`)], pos: await A.ev(`${S}.pos`), now: await A.ev(`${S}.round`) };
          break;
        }
        await P('pointerdown', seq[i], 31); await P('pointerup', seq[i], 31); await sleep(120);
      }
    }
    ok(res && res.hearts[0] === res.hearts[1] && (res.now > res.round || res.pos === res.j + 2), 'core: «Повтори мелодию» — две ноты двумя пальцами внахлёст засчитаны по порядку касаний, сердечки целы', res);
  } else ok(false, 'core: «Повтори мелодию» открылась');
  // P4: окно сайта поверх игры — соло на паузе («⏸ Пауза»), закрыл — «▶ Продолжить»: 📖 правила (GameKit) в «Дроне»,
  // ☰ меню игры и ⚙️ настройки в «Чёрной дыре»
  if (await openGame(A, BASE, 'drone')) {
    await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(200);
    const r0 = await A.ev(`(() => { const cv = document.querySelector('.ak-cv'), r = cv.getBoundingClientRect(), o = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true };
      cv.dispatchEvent(new PointerEvent('pointerdown', o)); GameKit.rules(''); return { run: ${RUN('drone')} }; })()`);
    await sleep(2500);
    const r1 = await A.ev(`({ over: ${CUR('drone')}.over, run: ${RUN('drone')}, modal: GameKit.isOpen(), ui: ${UI} })`);
    await A.ev(`GameKit.close(), 1`); await sleep(500);
    await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(150);
    const r2 = await A.ev(`({ run: ${RUN('drone')}, shown: !document.querySelector('.ak-over').hidden })`);
    ok(r1.modal && !r1.over && !r1.run && r1.ui.shown && /Пауза/.test(r1.ui.title) && r2.run && !r2.shown, 'core: 📖 правила посреди полёта — «Дрон» на паузе (не разбился), «▶ Продолжить» — летит дальше', { r0, r1, r2 });
  } else ok(false, 'core: «Дрон» открылся');
  if (await openGame(A, BASE, 'hole')) {
    await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(400);
    const t0 = await A.ev(`${CUR('hole')}.t`);
    await A.ev(`(window.__m = D37Shell.menu(), 1)`); await sleep(1200);
    const m1 = await A.ev(`({ t: ${CUR('hole')}.t, run: ${RUN('hole')}, menu: !!document.querySelector('.gs-menu'), ui: ${UI} })`);
    await A.ev(`(window.__m?.close(), 1)`); await sleep(400);
    await A.ev(`document.querySelector('.ak-go').click(), 1`); await sleep(300);
    const run2 = await A.ev(RUN('hole'));
    await A.ev(`(D37Settings.open({ ctx: 'game' }), 1)`); await sleep(800);
    const s1 = await A.ev(`({ run: ${RUN('hole')}, open: D37Settings.isOpen(), ui: ${UI} })`);
    await A.ev(`(D37Settings.close(), 1)`); await sleep(300);
    ok(m1.menu && !m1.run && Math.abs(m1.t - t0) < 60 && /Пауза/.test(m1.ui.title) && run2 && s1.open && !s1.run && /Пауза/.test(s1.ui.title), 'core: ☰ меню и ⚙️ настройки поверх игры — «Чёрная дыра» на паузе, «Продолжить» — дальше', { t0, m1, run2, s1 });
  } else ok(false, 'core: «Чёрная дыра» открылась');
  // компьютер: мышь и клавиатура, без касаний
  await A.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await A.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  // P5: пробел и стрелки, которые игре не нужны, во время партии не листают страницу (партия не уезжает с экрана)
  const scroll = {};
  for (const [id, codes] of [['descent', ['Space', 'Space', 'ArrowDown']], ['jumper', ['Space', 'Space', 'ArrowDown']], ['shield', ['Space', 'Space', 'ArrowDown']], ['slice', ['Space', 'Space', 'ArrowUp']], ['lights', ['Space', 'ArrowDown', 'Space']]]) {
    if (!await openGame(A, BASE, id)) { scroll[id] = 'not open'; continue; }
    await A.ev(`(document.activeElement?.blur?.(), scrollTo(0, 0), 1)`); await sleep(150);
    const y0 = await A.ev('scrollY');
    for (const k of codes) { await press(A, k); await sleep(250); }
    scroll[id] = { dy: (await A.ev('scrollY')) - y0, run: await A.ev(RUN(id)), over: await A.ev(`${CUR(id)}.over`) };
  }
  ok(Object.values(scroll).every(v => v.dy === 0 && (v.run || v.over)), 'core: компьютер — пробел и стрелки во время партии не листают страницу (descent, jumper, shield, slice, lights)', scroll);
  // R2: зажал ← и ушёл из окна (alt-tab, клик в рекламу): keyup не придёт — ядро отпускает клавишу, дощечка стоит
  if (await openGame(A, BASE, 'bricks')) {
    await A.ev(`(document.activeElement?.blur?.(), 1)`); await press(A, 'Space'); await sleep(300);
    await keyEv(A, 'keyDown', 'ArrowLeft'); await sleep(250);
    const k1 = await A.ev(`GAME_IMPL.bricks._test.inst().run.inp.keys`);
    await A.ev(`(window.dispatchEvent(new Event('blur')), 1)`); await sleep(150);
    const p1 = await A.ev(`${CUR('bricks')}.px`); await sleep(400);
    const b = await A.ev(`({ keys: GAME_IMPL.bricks._test.inst().run.inp.keys, px: ${CUR('bricks')}.px, run: ${RUN('bricks')} })`);
    await keyEv(A, 'keyUp', 'ArrowLeft');
    ok(k1 !== 0 && b.keys === 0 && Math.abs(b.px - p1) < 1e-6 && b.run, 'core: потеря фокуса с зажатой ← — клавиша отпущена, дощечка стоит, игра идёт', { k1, p1, b });
  } else ok(false, 'core: «Кирпичики» открылись');
  // D5: ⚔️ (партия идёт под окнами сайта) — зажал ←, открыл ☰, отпустил ← под меню, закрыл: клавиша не «залипла»
  // (под окном keyup игре не идёт — ядро отпускает клавиши, как только окно открылось). Соревнование здесь — та же партия
  // с флагом duel (без второго браузера): ветка tick() та же
  if (await openGame(A, BASE, 'bricks')) {
    await A.ev(`(document.activeElement?.blur?.(), 1)`); await press(A, 'Space'); await sleep(300);
    await A.ev(`(() => { const I = GAME_IMPL.bricks._test.inst(); I.duel = true; I.run.real = true; return 1; })()`);
    await keyEv(A, 'keyDown', 'ArrowLeft'); await sleep(200);
    const k1 = await A.ev(`GAME_IMPL.bricks._test.inst().run.inp.keys`), st0 = await A.ev(`GAME_IMPL.bricks._test.inst().run.steps`);
    await A.ev(`(window.__m = D37Shell.menu(), 1)`); await sleep(400);
    const u = await A.ev(`({ keys: GAME_IMPL.bricks._test.inst().run.inp.keys, run: ${RUN('bricks')}, steps: GAME_IMPL.bricks._test.inst().run.steps, menu: !!document.querySelector('.gs-menu') })`);
    await keyEv(A, 'keyUp', 'ArrowLeft'); await sleep(150);
    await A.ev(`(window.__m?.close(), 1)`); await sleep(300);
    const p1 = await A.ev(`${CUR('bricks')}.px`); await sleep(300);
    const b = await A.ev(`({ keys: GAME_IMPL.bricks._test.inst().run.inp.keys, px: ${CUR('bricks')}.px, run: ${RUN('bricks')} })`);
    ok(k1 !== 0 && u.menu && u.run && u.steps > st0 + 10 && u.keys === 0 && b.keys === 0 && Math.abs(b.px - p1) < 1e-6,
      'core: ⚔️ — ← отпущена под ☰ меню: партия шла, клавиша не залипла после меню, дощечка стоит', { k1, st0, u, p1, b });
  } else ok(false, 'core: «Кирпичики» (⚔️) открылись');
  await A.send('Emulation.setDeviceMetricsOverride', PHONE);
  await A.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}

// ── 0) строка HUD на телефоне 360 px (проверка T-140, P6): все строки, что бот увидел за партию в node, при счёте и рекорде
// с предел очков игры (5 цифр у многих) — не обрезаются многоточием ──
function hudStrings(id){
  const vm = require('vm'), DIR = path.join(SITE, 'js/games/arcade');
  const sb = { console, setTimeout, clearTimeout, performance: { now: () => 0 }, GAME_IMPL: {} };
  sb.window = sb; vm.createContext(sb);
  for (const f of ['core.js', id + '.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sb, { filename: f });
  const K = sb.ArcadeKit, spec = sb.GAME_IMPL[id]._test.spec, M = require(path.join(__dirname, 'arcade', id + '.cjs'));
  const out = new Set();
  if (!spec.hud) return [];
  for (const seed of [1, 2, 3]) {
    let last = NaN;
    const inner = M.bot ? M.bot(K, spec) : null;
    const s0 = spec.create(K.rng(seed), {}); out.add(spec.hud(s0));
    K.sim(spec, { seed, fps: 60, maxMs: M.maxMs || 120000, bot: (s, k, push) => { const h = spec.hudKey(s); if (h !== last) { last = h; out.add(spec.hud(s)); } if (inner) inner(s, k, push); } });
  }
  return [...out];
}
async function hudE2E(A, BASE, ids){
  await A.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2, mobile: true });
  const bad = {};
  let n = 0;
  for (const id of ids) {
    const card = JSON.parse(fs.readFileSync(path.join(SITE, 'js/games/arcade', id + '.json'), 'utf8'));
    const strs = hudStrings(id);
    if (!strs.length) continue;
    if (!await openGame(A, BASE, id)) { bad[id] = 'not open'; continue; }
    const big = Number(card.server.cap).toLocaleString('ru');
    const r = await A.ev(`(() => { const h = document.querySelector('.ak-hx'), sc = document.querySelector('.ak-sc'), be = document.querySelector('.ak-best'), t0 = [h.textContent, sc.textContent, be.textContent];
      sc.textContent = be.textContent = ${JSON.stringify(big)};
      const cut = []; let worst = 0;
      for (const t of ${JSON.stringify(strs)}) { h.textContent = t; const over = h.scrollWidth - h.clientWidth; if (over > 1) cut.push(t + ' (+' + over + ' px)'); worst = Math.max(worst, over); }
      [h.textContent, sc.textContent, be.textContent] = t0;
      return { cut: cut.slice(0, 4), n: cut.length, worst, w: h.clientWidth }; })()`);
    n += strs.length;
    if (r.n) bad[id] = { score: big, ...r };
  }
  for (const [id, v] of Object.entries(bad)) console.log('  HUD 360 px —', id, typeof v === 'string' ? v : 'счёт ' + v.score + ', ширина ' + v.w + ' px, обрезано строк: ' + v.n + ', хуже всего +' + v.worst + ' px: ' + v.cut.join(' | '));
  ok(!Object.keys(bad).length, `HUD: телефон 360 px, счёт и рекорд — предел игры: ${n} строк HUD из партий ботов (${ids.length} игр) не обрезаются`, bad);
  await A.send('Emulation.setDeviceMetricsOverride', PHONE);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = `http://localhost:${server.address().port}`;
  const report = {};
  let A = null, Bp = null;
  try {
    A = await browser('a');
    if (CORE) await coreE2E(A, BASE);
    if (HUD.length) await hudE2E(A, BASE, HUD);
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

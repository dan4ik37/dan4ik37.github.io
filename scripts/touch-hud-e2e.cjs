// Кнопки и экран игры на ТЕЛЕФОНЕ в настоящем Chrome (headless, DevTools Protocol, без npm) — T-074 (владелец 22.10: «сделай не так
// размашисто кнопку «Инвентарь» и другие тоже получше. А то пол-экрана всё»).
// Для каждого экрана (лёжа 844×390 и 915×412, стоя 390×844 и 360×780; касание, профиль телефона): «Кубомир» (новый мир «Выживание»),
// снимок и доля экрана под интерфейсом игры (кнопки, панель вещей, сердечки и еда, подсказка, значки сверху — объединение
// прямоугольников «с краской» в окне игры, сетка 2 px), цель лёжа — не больше 20 %.
// TH_MODE=full — ещё (только новая версия): каждая кнопка под пальцем — своя (середина и края не накрыты ничем), нажатие → её
// действие; кнопки не наезжают друг на друга, на панель вещей, сердечки и середину экрана (прицел); левша — зеркально; размер кнопок
// 130 % — тоже без наложений; «⚙️ → Управление → Настроить кнопки»: перетащил и увеличил «прыжок» — встал там (и после
// перезапуска мира), «Как было» — на место; вещи 20 раз открыть/закрыть и редактор 10 раз — узлы и слушатели не растут; в покое
// интерфейс не перестраивается каждый кадр (пересчёты стилей и раскладки в секунду); ошибок в консоли нет.
// GAME=podzem — «Подземье» (снимок и доля), GAME=world — «Мир Денчика» (снимок и доля).
// Запуск из корня сайта: node scripts/touch-hud-e2e.cjs [метка]   (SITE_DIR — другая копия сайта, например «до»; SCREENS='[[844,390]]')
// Снимки — <D37_TMP или E:\claude-tmp>\t074\shots\<метка>-<игра>-<Ш>x<В>.jpg
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const [label = 'now'] = process.argv.slice(2);
const MODE = process.env.TH_MODE || 'measure', GAME = process.env.GAME || 'kubomir';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const OUT = path.join(TMP, 't074'), SHOTS = path.join(OUT, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const SCREENS = process.env.SCREENS ? JSON.parse(process.env.SCREENS) : [[844, 390], [390, 844], [915, 412], [360, 780]];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p.startsWith('/play/')) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x).slice(0, 700) : '')); if (!c) fails++; };
const results = [];

// ── доля экрана под интерфейсом (в странице): объединение «закрашенных» прямоугольников внутри окна игры ──
// root — окно игры; extra — что ещё считать (значки сверху поверх игры); оверлеи на всё окно (вспышки, затемнения) — не в счёт
const COVER = `(rootSel, extraSel, skipSel) => {
  const rootEl = document.querySelector(rootSel); if (!rootEl) return null;
  const B = rootEl.getBoundingClientRect(), W = Math.round(B.width), H = Math.round(B.height), C = 2, gw = Math.ceil(W / C), gh = Math.ceil(H / C), g = new Uint8Array(gw * gh);
  const vis = el => { let op = 1; for (let p = el; p && p !== document.documentElement; p = p.parentElement) { if (p.hidden) return 0; const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden') return 0; op *= +s.opacity; } return op; };
  const mark = q => { const x0 = Math.max(0, Math.floor((q.left - B.left) / C)), x1 = Math.min(gw, Math.ceil((q.right - B.left) / C)), y0 = Math.max(0, Math.floor((q.top - B.top) / C)), y1 = Math.min(gh, Math.ceil((q.bottom - B.top) / C)); for (let y = y0; y < y1; y++) g.fill(1, y * gw + x0, y * gw + Math.max(x0, x1)); };
  const els = [...rootEl.querySelectorAll('*'), ...(extraSel ? document.querySelectorAll(extraSel) : [])];
  const parts = [];
  for (const el of els) {
    if (el.tagName === 'CANVAS' || (skipSel && el.closest(skipSel))) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (r.width * r.height > W * H * .45) continue;
    const cs = getComputedStyle(el);
    const bg = (cs.backgroundColor && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.backgroundColor)) || (cs.backgroundImage && cs.backgroundImage !== 'none');
    const bd = parseFloat(cs.borderTopWidth) > 0 && !/rgba\\(0, 0, 0, 0\\)/.test(cs.borderTopColor) && cs.borderTopStyle !== 'none';
    const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!bg && !bd && !txt && el.tagName !== 'svg') continue;
    const op = vis(el); if (op < .05) continue;
    if (bg || bd || el.tagName === 'svg') { mark(r); parts.push(el.className?.baseVal ?? el.className); }
    else { const rg = document.createRange(); for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) mark(q); } parts.push(el.className); }
  }
  let n = 0; for (let i = 0; i < g.length; i++) n += g[i];
  return { pct: +(100 * n / g.length).toFixed(1), W, H, parts: [...new Set(parts.map(String))].slice(0, 40) };
}`;

async function chrome(VW, VH){
  const port = 9300 + Math.floor(Math.random() * 500), profile = fs.mkdtempSync(path.join(OUT, 'chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP: OUT, TEMP: OUT } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
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
  const ev = async (expr, ms = 60000) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), sleep(ms).then(() => ({ result: { value: '__timeout' } }))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true, screenOrientation: VW > VH ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; 23078PND5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l' });
  const close = () => { try { ws.close(); } catch (e) {} proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 1500); };
  return { send, ev, logs, close };
}
const touch = async (send, x, y, holdMs = 70, move) => {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }] });
  if (move) for (const [mx, my] of move) { await sleep(30); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx, y: my, id: 1, radiusX: 4, radiusY: 4 }] }); }
  await sleep(holdMs);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(60);
};

async function openKubomir(B, VW, VH){
  const { send, ev } = B;
  const ls = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: 'low', d37_settings: JSON.stringify({ gfxPreset: 'low', gfx: 'low', autoLand: true }), d37_kb_opt: JSON.stringify({ rd: 4 }) };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `if(!localStorage.getItem(${JSON.stringify(k)}))localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  await send('Page.navigate', { url: BASE + '/#/games/kubomir' });
  let menu = false;
  for (let i = 0; i < 120 && !menu; i++) { await sleep(500); menu = await ev(`!!document.querySelector('.kb-menu [data-m="new"]')`, 3000).catch(() => false); }
  if (!menu) { await shot(send, `kubomir-${VW}x${VH}-debug-open`); throw new Error('меню миров не появилось: ' + JSON.stringify(await ev(`({ hash: location.hash, path: location.pathname, stage: document.querySelector('#gamesStage')?.className, txt: document.body.innerText.slice(0, 300) })`).catch(e => e.message))); }
  // меню миров может перерисоваться (облако, список) — нажимать «Новый мир», пока не откроется окно нового мира
  for (let i = 0; i < 20; i++) { if (await ev(`(() => { if (document.querySelector('[data-f="seed"]')) return true; document.querySelector('.kb-menu [data-m="new"]')?.click(); return !!document.querySelector('[data-f="seed"]'); })()`)) break; await sleep(300); }
  await sleep(400);
  await ev(`(() => { const s = document.querySelector('[data-f="seed"]'); if (s) s.value = 't074'; document.querySelector('[data-f="mode"] [data-v="survival"]')?.click(); document.querySelector('[data-f="diff"] [data-v="peaceful"]')?.click(); document.querySelector('[data-n="go"]')?.click(); return 1; })()`);
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await ev(`!!(GAME_IMPL.kubomir?._test?.state()?.ready)`, 3000).catch(() => false); }
  if (!up) throw new Error('мир не открылся');
  // день, без лишнего поверх (окошко возраста, карточка приложения); подождать, пока название вещи в руке погаснет
  await ev(`(async () => { const S = GAME_IMPL.kubomir._test.state(); S.R.lighting.time = 11; document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast').forEach(e => e.remove()); await new Promise(r => setTimeout(r, 3500)); return 1; })()`, 20000);
}
async function shot(send, name){
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  const f = path.join(SHOTS, `${label}-${name}.jpg`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('  снимок', f); return f;
}
// пересчёты стилей и раскладки в секунду, пока игрок стоит (интерфейс не должен перестраиваться каждый кадр)
async function thrash(send, ms = 4000){
  const m = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const a = await m(); await sleep(ms); const b = await m(), s = ms / 1000;
  return { layouts: +((b.LayoutCount - a.LayoutCount) / s).toFixed(1), styles: +((b.RecalcStyleCount - a.RecalcStyleCount) / s).toFixed(1), layoutMs: +((b.LayoutDuration - a.LayoutDuration) * 1000 / s).toFixed(2), styleMs: +((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000 / s).toFixed(2) };
}
async function counters(send, ev){
  await ev(`(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise(r => setTimeout(r, 200)); } return 1; })()`);
  await send('HeapProfiler.collectGarbage').catch(() => {});
  const c = await send('Memory.getDOMCounters');
  return { nodes: c.nodes, listeners: c.jsEventListeners };
}

let BASE = '';
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  BASE = 'http://localhost:' + server.address().port;
  console.log('Сайт:', SITE, '· режим', MODE, '· игра', GAME);
  for (const [VW, VH] of SCREENS) {
    const land = VW > VH, tag = `${GAME}-${VW}x${VH}`;
    console.log(`\n${land ? 'Лёжа' : 'Стоя'} ${VW}×${VH}`);
    let B = null;
    try {
      B = await chrome(VW, VH);
      const { send, ev, logs } = B;
      if (GAME === 'kubomir') {
        await openKubomir(B, VW, VH);
        const cov = await ev(`(${COVER})('.kb-wrap', '.kb-top *', '.kb-screen')`);
        const fs0 = await ev(`(() => ({ compact: document.documentElement.classList.contains('gs-compact'), full: !!window.D37Full?.active?.() }))()`);
        console.log('  полный экран:', JSON.stringify(fs0), '· интерфейс занимает', cov.pct + '%', 'окна', cov.W + '×' + cov.H);
        await shot(send, tag);
        const row = { screen: VW + '×' + VH, pct: cov.pct };
        // подсказка новичку свернулась (через несколько секунд) — сколько тогда
        await sleep(7000);
        const cov2 = await ev(`(${COVER})('.kb-wrap', '.kb-top *', '.kb-screen')`);
        row.pctLater = cov2.pct;
        console.log('  через 7 с:', cov2.pct + '%');
        await shot(send, tag + '-later');
        if (land) ok(cov2.pct <= 20, `лёжа — интерфейс не больше 20 % экрана (${cov2.pct} %)`, cov2.parts);
        row.thrash = await thrash(send);
        console.log('  в покое, в секунду:', JSON.stringify(row.thrash));
        if (MODE === 'full') await fullChecks(B, VW, VH, row);
        results.push(row);
        const errs = logs.filter(l => !/favicon|ERR_|net::|Failed to load resource|supabase|websocket|WebSocket|realtime/i.test(l));
        ok(!errs.length, 'ошибок в консоли нет', errs.slice(0, 5));
      } else if (GAME === 'podzem') {
        const lsP = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ autoLand: true }) };
        await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(lsP).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
        await send('Page.navigate', { url: BASE + '/#/games/podzem' });
        let up = false;
        for (let i = 0; i < 120 && !up; i++) { await sleep(500); up = await ev(`!!(window.GAME_IMPL?.podzem?._test)`, 3000).catch(() => false); }
        // новый мир — первая кнопка «Играть» / «Новый мир» в меню
        await ev(`(async () => { for (let i = 0; i < 40; i++) { const g = GAME_IMPL.podzem._test.state?.(); if (g?.state === 'play' || g?.state === 'loading') return 1; const b = document.querySelector('.pz-menu [data-a="quick"], .pz-menu [data-a="play"]:not([disabled])'); if (b) b.click(); await new Promise(r => setTimeout(r, 700)); } return 0; })()`, 40000);
        for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(`GAME_IMPL.podzem._test.state?.()?.state === 'play'`, 3000).catch(() => false)) break; }
        // палец по холсту — включить кнопки телефона (они появляются после первого касания)
        await touch(send, Math.round(VW * .7), Math.round(VH * .4), 60);
        await sleep(2500);
        const cov = await ev(`(${COVER})('.pz-wrap', null, '.pz-ko,.pz-load,.pz-menu')`);
        console.log('  интерфейс занимает', cov?.pct + '%', cov && cov.W + '×' + cov.H);
        await shot(send, tag);
        results.push({ screen: VW + '×' + VH, pct: cov?.pct });
        if (land && MODE === 'full') ok(cov.pct <= 25, `«Подземье» лёжа — интерфейс не больше 25 % (${cov.pct} %)`, cov.parts);
        if (MODE === 'full') await podzemChecks(B, VW, VH);
      } else if (GAME === 'world') {
        const lsW = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_gfx: 'low', d37_settings: JSON.stringify({ gfxPreset: 'low', gfx: 'low', autoLand: true }) };
        await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(lsW).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');}catch(e){}` });
        await send('Page.navigate', { url: BASE + '/#/games/world' });
        let up = false;
        for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`, 3000).catch(() => false); }
        await ev(`(async () => { document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast,.wld-panel').forEach(e => e.remove()); GAME_IMPL.world._test.state().fixedTime = 13; await new Promise(r => setTimeout(r, 2500)); return 1; })()`, 20000);
        const cov = await ev(`(${COVER})('.wld-wrap', '.wld-top *', '.wld-pop,.wld-panel,.mp')`);
        console.log('  интерфейс занимает', cov?.pct + '%', cov && cov.W + '×' + cov.H);
        await shot(send, tag);
        results.push({ screen: VW + '×' + VH, pct: cov?.pct });
        if (MODE === 'full') await worldChecks(B, VW, VH);
      }
    } catch (e) { ok(false, 'прогон упал: ' + (e.message || e)); }
    finally { B?.close(); }
  }
  console.log('\nИтог (' + label + ', ' + GAME + '):');
  for (const r of results) console.log(' ', r.screen.padEnd(9), String(r.pct).padStart(5) + ' %', r.pctLater != null ? '→ через 7 с ' + r.pctLater + ' %' : '', r.thrash ? '· в секунду: раскладок ' + r.thrash.layouts + ', стилей ' + r.thrash.styles : '');
  fs.writeFileSync(path.join(OUT, `result-${label}-${GAME}.json`), JSON.stringify(results, null, 1));
  console.log(fails ? `\n✗ провалов: ${fails}` : '\n✓ всё в порядке');
  server.close();
  process.exit(fails ? 1 : 0);
})();

// ═══ Полная проверка (новая версия): кнопки под пальцем, действия, наложения, левша, размер, редактор, утечки ═══
async function fullChecks(B, VW, VH, row){
  const { send, ev } = B;
  const land = VW > VH;
  // интерфейс 2.0 «Кубомира» (T-123, флаг HUD2.kubomir): кнопки — поза и прыжок (🎒 — в лотке, 🔄 — ячейка левой руки, 🐛 — в круге позы)
  const v2 = await ev(`!!document.querySelector('.kb-e2')`);
  // все видимые кнопки: середина, края, что под ними; наложения
  const geo = () => ev(`(() => {
    const wrap = document.querySelector('.kb-wrap').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.kb-tbar [data-id]')].filter(b => !b.hidden && b.getBoundingClientRect().width).map(b => { const r = b.getBoundingClientRect(); return { id: b.dataset.id, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, x: r.left + r.width / 2, y: r.top + r.height / 2, rx: r.left + r.width / 2 - wrap.left, ry: r.top + r.height / 2 - wrap.top }; });
    const R = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    const covered = [];
    for (const b of btns) for (const [x, y] of [[b.x, b.y], [b.l + b.w * .2, b.t + b.w * .2], [b.r - b.w * .2, b.t + b.w * .2], [b.l + b.w * .2, b.b - b.w * .2], [b.r - b.w * .2, b.b - b.w * .2]]) { const el = document.elementFromPoint(x, y); if (!el || el.closest('[data-id]')?.dataset.id !== b.id) covered.push({ id: b.id, at: [Math.round(x), Math.round(y)], top: el ? String(el.className || el.tagName).slice(0, 40) : null }); }
    return { wrap: { l: wrap.left, t: wrap.top, r: wrap.right, b: wrap.bottom, w: wrap.width, h: wrap.height }, btns, hot: R('.kb-hotbar'), bars: R('.kb-bars'), oslot: R('.kb-oslot'), top: R('.kb-top .wld-topbtns'), covered };
  })()`);
  const over = (a, b, pad = 0) => a && b && a.l < b.r + pad && a.r > b.l - pad && a.t < b.b + pad && a.b > b.t - pad;
  const checkGeo = async (what) => {
    const G = await geo(), bad = [];
    for (let i = 0; i < G.btns.length; i++) for (let j = i + 1; j < G.btns.length; j++) if (over(G.btns[i], G.btns[j], 2)) bad.push(G.btns[i].id + '×' + G.btns[j].id);
    for (const b of G.btns) for (const [n, q] of [['панель вещей', G.hot], ['сердечки', G.bars], ['левая рука', G.oslot], ['значки сверху', G.top]]) if (over(b, q, 2)) bad.push(b.id + ' на «' + n + '»');
    const cx = G.wrap.l + G.wrap.w / 2, cy = G.wrap.t + G.wrap.h / 2;
    for (const b of G.btns) if (over(b, { l: cx - 40, r: cx + 40, t: cy - 40, b: cy + 40 })) bad.push(b.id + ' у прицела');
    for (const b of G.btns) if (b.l < G.wrap.l - 1 || b.r > G.wrap.r + 1 || b.t < G.wrap.t - 1 || b.b > G.wrap.b + 1) bad.push(b.id + ' за краем');
    ok(!bad.length, what + ': кнопки не наезжают друг на друга, на панель вещей, сердечки, значки, прицел, не за краем', bad);
    ok(!G.covered.length, what + ': каждая кнопка под пальцем — своя (середина и края)', G.covered.slice(0, 6));
    return G;
  };
  const G = await checkGeo('по умолчанию');
  const sizes = G.btns.map(b => b.id + ' ' + Math.round(b.w)).join(', ');
  console.log('  кнопки:', sizes);
  ok(G.btns.length >= (v2 ? 2 : 4) && G.btns.every(b => b.w >= 38 && b.w <= 64), 'кнопки — 40…60 px (по умолчанию)', sizes);
  const jump = G.btns.find(b => b.id === 'jump');
  ok(jump && G.btns.every(b => b.w <= jump.w), '«прыжок» — самая крупная');
  ok(jump && jump.x > G.wrap.l + G.wrap.w * .6, '«прыжок» — справа (под большим пальцем)', jump);
  // пересчитать раскладку ещё раз — кнопки там же (раскладка не зависит от того, когда её считали)
  const dbg = await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), w = document.querySelector('.kb-wrap').getBoundingClientRect(), r = s => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.top - w.top), Math.round(q.bottom - w.top), Math.round(q.height)]; }; const a = { bottom: r('.kb-bottom'), bars: r('.kb-bars'), hot: r('.kb-hotbar'), air: r('.kb-air'), iname: r('.kb-iname'), s: getComputedStyle(document.querySelector('.kb-hud')).getPropertyValue('--kb-s'), av: S.tl.o.avoid().map(q => [q.label, Math.round(q.t), Math.round(q.b), Math.round(q.l), Math.round(q.r)]), def: (d => [Math.round(d.jump.x), Math.round(d.jump.y)])(S.tl.o.defaults(S.tl.W, S.tl.H, 1, {})) }; a.before = [S.tl.W, S.tl.H, Math.round(S.tl.pos.get('jump')?.y), document.querySelector('.kb-tbar [data-id="jump"]').style.top, document.querySelectorAll('.kb-tbar').length, D37TouchLayout._test.live()]; S.tl.layout(true); a.after = [S.tl.W, S.tl.H, Math.round(S.tl.pos.get('jump')?.y), document.querySelector('.kb-tbar [data-id="jump"]').style.top]; return a; })()`);
  const jr = (await geo()).btns.find(b => b.id === 'jump');
  ok(jr && Math.abs(jr.rx - jump.rx) < 1 && Math.abs(jr.ry - jump.ry) < 1, 'раскладка пересчитана заново — кнопки на тех же местах', [jump, jr, dbg]);
  // нажатия: каждая кнопка → своё действие
  await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); window.__tl = []; const C = S.C, K = S.K; const cp = C.press, kp = K.press; C.press = (a, v) => { __tl.push('C:' + a + ':' + v); return cp(a, v); }; K.press = (a, v) => { __tl.push('K:' + a + ':' + v); return kp(a, v); }; return 1; })()`);
  const tapBtn = async (id, holdMs = 90) => { const b = (await geo()).btns.find(x => x.id === id); if (!b) return false; await touch(send, b.x, b.y, holdMs); return true; };
  // прыжок: держать — нажат «прыжок», отпустил — отпущен
  await tapBtn('jump', 150);
  let log = await ev(`__tl.splice(0)`);
  ok(log.includes('C:jump:true') && log.includes('C:jump:false'), 'кнопка «прыжок» → прыжок (нажал и отпустил)', log);
  const at = async sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width ? [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)] : null; })()`);
  if (v2) {
    // короткое нажатие — с метками времени касания (90 мс): CDP шлёт «отпустил» только после того, как медленная страница (swiftshader)
    // обработала «нажал», — без меток игра (нажал / удержал — по времени событий) видит «удержал»
    // смахнуть — тоже с метками: касание 30 мс на шаг
    const qswipe = async (x, y, moves) => { const t = Date.now() / 1000; await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }], timestamp: t }); let k = 0; for (const [mx, my] of moves) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx, y: my, id: 1, radiusX: 4, radiusY: 4 }], timestamp: t + .03 * ++k }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + .03 * (k + 2) }); await sleep(150); };
    const qtapXY = async (x, y) => { const t = Date.now() / 1000; await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }], timestamp: t }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + .09 }); await sleep(150); };
    // лоток: нажал — весь ряд и 🎒; 🎒 — окно вещей (лист); смахнул вбок — соседняя вещь; удержал — круг вещей
    let p = await at('.kb-hrow .kb-slot.on'); if (p) await qtapXY(p[0], p[1]);
    ok(await ev(`!!document.querySelector('.kb-hrow.kb-open')`), 'лоток: нажал — раскрылся (весь ряд и 🎒)');
    p = await at('.kb-hrow .kb-bag'); if (p) await qtapXY(p[0], p[1]);
    ok(await ev(`GAME_IMPL.kubomir._test.state().ui.isOpen() && !!document.querySelector('.kb-inv.kb-sheet')`), 'лоток → 🎒 → окно вещей листом');
    await ev(`GAME_IMPL.kubomir._test.state().ui.close()`); await sleep(3300);
    ok(!(await ev(`!!document.querySelector('.kb-hrow.kb-open')`)), 'лоток свернулся сам (3 с)');
    const kst = () => ev(`(() => { const S = GAME_IMPL.kubomir._test.state(), e = document.elementFromPoint(...${'${JSON.stringify(p || [0, 0])}'}); return { sel: S.P.sel, open: !!document.querySelector('.kb-hrow.kb-open'), inv: S.ui.isOpen(), rad: !!S.rad?.isOpen(), sneak: !!S.touchSneak, pose: GAME_IMPL.kubomir._test.poseCur(), under: e ? String(e.className || e.tagName).slice(0, 30) : null }; })()`.replace('${JSON.stringify(p || [0, 0])}', JSON.stringify(p || [0, 0])));
    const sel0 = await ev(`GAME_IMPL.kubomir._test.state().P.sel`);
    if (process.env.TH_DBG) await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); window.__mv = []; for (const n of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(n, e => __mv.push(n.slice(7, 11) + ':' + Math.round(e.clientX) + ',' + Math.round(e.clientY) + ':' + S.P.sel + ':' + e.pointerId + ':' + JSON.stringify(GAME_IMPL.kubomir._test.trayS?.()) + ':' + String(e.target.className || e.target.tagName).slice(0, 10)), true); return 1; })()`);
    p = await at('.kb-hrow .kb-slot.on'); if (p) await qswipe(p[0], p[1], [[p[0] + 15, p[1]], [p[0] + 34, p[1]], [p[0] + 44, p[1]]]);
    if (process.env.TH_DBG) console.log('   события:', await ev(`JSON.stringify(window.__mv.splice(0))`));
    ok(await ev(`GAME_IMPL.kubomir._test.state().P.sel`) === (sel0 + 1) % 9, 'лоток: смахнул вправо — следующая вещь (не раскрываясь)', { sel0, p, st: await kst() });
    p = await at('.kb-hrow .kb-slot.on'); if (p) await touch(send, p[0], p[1], 600);
    ok(await ev(`!!document.querySelector('.kb-wrap .e2-radial:not([hidden])')`), 'лоток: удержал — круг вещей');
    await sleep(3300);   // круг ждал нажатия 3 с (палец отпустили, не ведя) — закрылся
    p = await at('.kb-hrow .kb-slot.on'); if (p) await qswipe(p[0], p[1], [[p[0], p[1] - 20], [p[0], p[1] - 44]]);
    ok(await ev(`GAME_IMPL.kubomir._test.state().ui.isOpen()`), 'лоток: смахнул вверх — окно вещей', { p, st: await kst() });
    await ev(`GAME_IMPL.kubomir._test.state().ui.close()`); await sleep(200);
    // поза: нажал — красться (ещё раз — встал); удержал и повёл к 🪑 — сел. Короткое нажатие — с метками времени касания (90 мс):
    // CDP шлёт «отпустил» только после того, как медленная страница (swiftshader) обработала «нажал», — без меток это «удержал»
    const qtap = async id => { const b = (await geo()).btns.find(x => x.id === id); if (b) await qtapXY(b.x, b.y); };
    await qtap('pose');
    ok(await ev(`!!GAME_IMPL.kubomir._test.state().touchSneak`), 'кнопка позы: нажал — красться', await kst());
    await qtap('pose');
    ok(!(await ev(`!!GAME_IMPL.kubomir._test.state().touchSneak`)), 'кнопка позы: ещё раз — встал', await kst());
    const pb = (await geo()).btns.find(b => b.id === 'pose');
    if (pb) {   // круг из четырёх (по часовой от верха): ⬇ красться, 🐛 ползком, 🪑 сесть, 🛌 лечь — повёл влево — лечь
      await touch(send, pb.x, pb.y, 120, [[pb.x - 10, pb.y], [pb.x - 30, pb.y], [pb.x - 60, pb.y]]);
      await sleep(300);
      ok(await ev(`GAME_IMPL.kubomir._test.poseCur()`) === 'lie', 'круг позы: удержал ⬇ и повёл влево — лёг', await ev(`GAME_IMPL.kubomir._test.poseCur()`));
      await qtap('pose'); await sleep(200);
      ok(!(await ev(`GAME_IMPL.kubomir._test.poseCur()`)), 'лежит — нажал позу — встал');
      await touch(send, pb.x, pb.y, 500); await sleep(200);   // удержал, не ведя, — круг ждёт нажатия (3 с): 🪑
      const cs = await at('.kb-wrap .e2-radial:not([hidden]) .e2-rad-it[data-i="2"]'); if (cs) await touch(send, cs[0], cs[1], 60);
      await sleep(300);
      ok(await ev(`GAME_IMPL.kubomir._test.poseCur()`) === 'sit', 'круг позы: удержал и нажал 🪑 — сел', await ev(`GAME_IMPL.kubomir._test.poseCur()`));
      await qtap('pose'); await sleep(200);
    }
    // руки: факел в правой → нажал ячейку левой руки → в левой
    await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.inv[S.P.sel] = { id: 'torch', n: 3 }; S.P.off = null; return 1; })()`);
    await sleep(200); p = await at('.kb-oslot'); if (p) await qtapXY(p[0], p[1]);
    ok(await ev(`GAME_IMPL.kubomir._test.state().P.off?.id === 'torch'`), 'ячейка левой руки → факел в левой руке');
  } else {
  // вещи
  await tapBtn('inv');
  ok(await ev(`GAME_IMPL.kubomir._test.state().ui.isOpen()`), 'кнопка «вещи» → окно вещей');
  await ev(`GAME_IMPL.kubomir._test.state().ui.close()`);
  // красться — переключатель
  const sn0 = await ev(`!!GAME_IMPL.kubomir._test.state().touchSneak`);
  await tapBtn('sneak');
  ok(await ev(`!!GAME_IMPL.kubomir._test.state().touchSneak`) !== sn0, 'кнопка «красться» → красться (нажал — отжал)');
  await tapBtn('sneak');
  // руки: факел в правой → после нажатия в левой
  await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.inv[S.P.sel] = { id: 'torch', n: 3 }; S.P.off = null; return 1; })()`);
  await tapBtn('swap');
  ok(await ev(`GAME_IMPL.kubomir._test.state().P.off?.id === 'torch'`), 'кнопка «руки» → факел в левой руке');
  }
  // щит: появляется, держать — «щит»
  await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.off = { id: 'shield', n: 1 }; return 1; })()`);
  await sleep(500);
  const hasOff = (await geo()).btns.some(b => b.id === 'off');
  ok(hasOff, 'щит в руке — кнопка «щит» появилась');
  if (hasOff) { await tapBtn('off', 160); log = await ev(`__tl.splice(0)`); ok(log.includes('K:offuse:true') && log.includes('K:offuse:false'), 'кнопка «щит» → держать щит', log); await checkGeo('со щитом'); }
  await ev(`(() => { const S = GAME_IMPL.kubomir._test.state(); S.P.off = null; S.P.inv[S.P.sel] = null; return 1; })()`);
  // подсказка новичку: свёрнута — нажал — развернулась
  const tip = await ev(`(() => { const t = document.querySelector('.kb-tip'); return t ? { hidden: t.hidden, mini: t.classList.contains('mini'), h: Math.round(t.getBoundingClientRect().height) } : null; })()`);
  if (tip && !tip.hidden && !v2) {   // 2.0: подсказка — один раз на устройство, без значка 💡
    ok(tip.mini, 'подсказка через несколько секунд — свёрнута в значок', tip);
    const r = await ev(`(() => { const r = document.querySelector('.kb-tip').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    await touch(send, r[0], r[1], 60);
    const t2 = await ev(`(() => { const t = document.querySelector('.kb-tip'); return { mini: t.classList.contains('mini'), h: Math.round(t.getBoundingClientRect().height) }; })()`);
    ok(!t2.mini, 'нажал на значок — подсказка видна снова', t2);
  }
  // режим «прицел»: кнопки ⛏ и 🧱 тоже на месте
  await ev(`(() => { D37Settings.open({ ctx: 'engine', tab: 'kubomir' }); return 1; })()`); await sleep(300);
  await ev(`(() => { document.querySelector('[data-kbo="touchMode:cross"]')?.click(); D37Settings.close(); return 1; })()`); await sleep(400);
  const Gc = await checkGeo('режим «прицел»');
  ok(Gc.btns.some(b => b.id === 'mine') && Gc.btns.some(b => b.id === 'place'), 'режим «прицел» — есть ⛏ и 🧱');
  await tapBtn('mine', 140); log = await ev(`__tl.splice(0)`); ok(log.includes('C:mine:true'), 'кнопка ⛏ → ломать', log);
  await tapBtn('place', 90); log = await ev(`__tl.splice(0)`); ok(log.includes('C:place:true'), 'кнопка 🧱 → поставить', log);
  await ev(`(() => { D37Settings.open({ ctx: 'engine', tab: 'kubomir' }); return 1; })()`); await sleep(300);
  await ev(`(() => { document.querySelector('[data-kbo="touchMode:tap"]')?.click(); D37Settings.close(); return 1; })()`); await sleep(400);
  // левша — зеркально
  await ev(`(() => { D37Settings.set('lefty', true); return 1; })()`); await sleep(500);
  const Gl = await checkGeo('левша');
  const jl = Gl.btns.find(b => b.id === 'jump');
  ok(jl && jl.x < Gl.wrap.l + Gl.wrap.w * .4, 'левша — «прыжок» слева', jl);
  await ev(`(() => { D37Settings.set('lefty', false); return 1; })()`); await sleep(400);
  // крупные кнопки (⚙️ → Управление → Размер кнопок 130 %)
  await ev(`(() => { D37Settings.set('touchSize', 130); return 1; })()`); await sleep(500);
  const Gb = await checkGeo('размер кнопок 130 %');
  const jb = Gb.btns.find(b => b.id === 'jump');
  ok(jb && jump && jb.w > jump.w * 1.2, 'размер кнопок 130 % — «прыжок» крупнее', [jb?.w, jump?.w]);
  await ev(`(() => { D37Settings.set('touchSize', 100); return 1; })()`); await sleep(400);
  await shot(send, `kubomir-${VW}x${VH}-full`);
  // ── «⚙️ → Управление → Настроить кнопки» ──
  await ev(`(() => { D37Settings.open({ ctx: 'engine', tab: 'controls' }); return 1; })()`); await sleep(500);
  const hasRow = await ev(`!!document.querySelector('#gsSettings [data-tl-edit]')`);
  ok(hasRow, '⚙️ → Управление: есть «Настроить кнопки»');
  if (!hasRow) return;
  await ev(`(() => { document.querySelector('#gsSettings [data-tl-edit]').click(); return 1; })()`); await sleep(600);
  const ed = await ev(`(() => { const e = document.querySelector('.tl-ed'); if (!e) return null; return { settings: !!document.querySelector('#gsSettings'), n: e.querySelectorAll('.tl-p').length, ids: [...e.querySelectorAll('.tl-p')].map(p => p.dataset.id) }; })()`);
  ok(ed && !ed.settings && ed.n >= (v2 ? 3 : 5), 'редактор открылся поверх игры (все кнопки, окно настроек закрыто)', ed);
  if (!ed) return;
  await shot(send, `kubomir-${VW}x${VH}-editor`);
  const pj = await ev(`(() => { const r = document.querySelector('.tl-ed .tl-p[data-id="jump"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  const dx = land ? -150 : -90, dy = land ? -60 : -120;
  const steps = []; for (let i = 1; i <= 6; i++) steps.push([pj.x + dx * i / 6, pj.y + dy * i / 6]);
  await touch(send, pj.x, pj.y, 60, steps);
  for (let i = 0; i < 2; i++) {   // «＋» два раза; ждём, пока надпись размера сменится (касание доходит до страницы не мгновенно)
    const p = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="bigger"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, document.querySelector('.tl-ed-sz').textContent]; })()`);
    await touch(send, p[0], p[1], 50);
    await ev(`(async () => { const was = ${JSON.stringify(p[2])}; for (let i = 0; i < 40 && document.querySelector('.tl-ed-sz').textContent === was; i++) await new Promise(r => setTimeout(r, 25)); return 1; })()`);
  }
  const pj2 = await ev(`(() => { const r = document.querySelector('.tl-ed .tl-p[data-id="jump"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  ok(Math.abs(pj2.x - (pj.x + dx)) < 6 && Math.abs(pj2.y - (pj.y + dy)) < 6, 'в редакторе «прыжок» перетащился пальцем', [pj, pj2]);
  ok(pj2.w > pj.w * 1.12, 'кнопка «+» — «прыжок» крупнее', [pj.w, pj2.w]);
  const done = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="done"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await touch(send, done[0], done[1], 50); await sleep(400);
  const after = (await geo()).btns.find(b => b.id === 'jump');
  ok(!(await ev(`!!document.querySelector('.tl-ed')`)) && after && Math.abs(after.x - pj2.x) < 6 && Math.abs(after.y - pj2.y) < 6 && Math.abs(after.w - pj2.w) < 4, '«Готово» — в игре «прыжок» там же и такого же размера', [after, pj2]);
  const saved = await ev(`localStorage.getItem('d37_touch_layout')`);
  ok(/kubomir/.test(saved || ''), 'раскладка сохранена на этом устройстве', saved);
  await tapBtn('jump', 120); log = await ev(`__tl.splice(0)`); ok(log.includes('C:jump:true'), 'на новом месте «прыжок» прыгает', log);
  // перезапуск мира — раскладка та же
  await ev(`(async () => { const T = GAME_IMPL.kubomir._test, id = T.state().meta.id, wait = ms => new Promise(r => setTimeout(r, ms)); await T.stop(); T.menu();
    for (let i = 0; i < 40 && !document.querySelector('.kb-world[data-id="' + id + '"] [data-w="play"]'); i++) await wait(250);
    document.querySelector('.kb-world[data-id="' + id + '"] [data-w="play"]')?.click(); for (let i = 0; i < 120 && !T.state()?.ready; i++) await wait(500); await wait(1500); return !!T.state()?.ready; })()`, 90000);
  const again = (await geo()).btns.find(b => b.id === 'jump');
  ok(again && Math.abs(again.rx - after.rx) < 2 && Math.abs(again.ry - after.ry) < 2, 'после перезапуска мира — «прыжок» на своём месте', [again, after]);
  // «Как было»
  await ev(`(() => { D37TouchLayout.edit(); return 1; })()`); await sleep(400);
  for (const k of ['reset', 'done']) { const p = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="${k}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await touch(send, p[0], p[1], 50); await sleep(300); }
  const back = (await geo()).btns.find(b => b.id === 'jump');
  const dbg2 = await ev(`(() => { const w = document.querySelector('.kb-wrap').getBoundingClientRect(), r = s => { const e = document.querySelector(s); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.top - w.top), Math.round(q.bottom - w.top), Math.round(q.height), e.hidden ? 'h' : '']; }; return { bottom: r('.kb-bottom'), bars: r('.kb-bars'), hot: r('.kb-hotbar'), oslot: r('.kb-oslot'), air: r('.kb-air'), s: getComputedStyle(document.querySelector('.kb-hud')).getPropertyValue('--kb-s'), wrap: [w.width, w.height], av: (S => S.tl.o.avoid().map(q => [q.label, Math.round(q.t), Math.round(q.b), Math.round(q.l), Math.round(q.r)]))(GAME_IMPL.kubomir._test.state()), def: (S => (d => [Math.round(d.jump.x), Math.round(d.jump.y)])(S.tl.o.defaults(S.tl.W, S.tl.H, 1, {})))(GAME_IMPL.kubomir._test.state()) }; })()`);
  ok(back && Math.abs(back.rx - jump.rx) < 2 && Math.abs(back.ry - jump.ry) < 2 && Math.abs(back.w - jump.w) < 2, '«Как было» — «прыжок» на месте по умолчанию', [back, jump, dbg, dbg2]);
  // ── утечки: вещи 20 раз, редактор 10 раз ──
  const c0 = await counters(send, ev);
  for (let i = 0; i < 20; i++) {
    if (v2) await ev(`GAME_IMPL.kubomir._test.state().ui.open('inv')`); else { const b = (await geo()).btns.find(x => x.id === 'inv'); await touch(send, b.x, b.y, 40); }
    await ev(`(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); GAME_IMPL.kubomir._test.state().ui.close(); return 1; })()`);
  }
  for (let i = 0; i < 10; i++) await ev(`(async () => { D37TouchLayout.edit(); await new Promise(r => requestAnimationFrame(r)); document.querySelector('.tl-ed [data-tl="cancel"]').click(); await new Promise(r => requestAnimationFrame(r)); return 1; })()`);
  const c1 = await counters(send, ev);
  for (let i = 0; i < 20; i++) {
    if (v2) await ev(`GAME_IMPL.kubomir._test.state().ui.open('inv')`); else { const b = (await geo()).btns.find(x => x.id === 'inv'); await touch(send, b.x, b.y, 40); }
    await ev(`(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); GAME_IMPL.kubomir._test.state().ui.close(); return 1; })()`);
  }
  for (let i = 0; i < 10; i++) await ev(`(async () => { D37TouchLayout.edit(); await new Promise(r => requestAnimationFrame(r)); document.querySelector('.tl-ed [data-tl="cancel"]').click(); await new Promise(r => requestAnimationFrame(r)); return 1; })()`);
  const c2 = await counters(send, ev);
  console.log('  узлы / слушатели: до', JSON.stringify(c0), '→ после 20+10', JSON.stringify(c1), '→ ещё 20+10', JSON.stringify(c2));
  row.leak = { c0, c1, c2 };
  ok(c2.listeners - c1.listeners <= 2 && c2.nodes - c1.nodes <= 60, 'вещи 20 раз и редактор 10 раз — слушатели и узлы не растут', { c0, c1, c2 });
}

// ═══ «Мир Денчика»: кнопки движка (.e-btn) — сетка, пока игрок не переставил; переставил — свободно (.tl-free), «Как было» — снова сетка ═══
async function worldChecks(B, VW, VH){
  const { send, ev } = B;
  const geo = () => ev(`(() => { const w = document.querySelector('.wld-wrap').getBoundingClientRect(), eb = document.querySelector('.e-btns');
    const btns = [...document.querySelectorAll('.e-btns .e-btn')].filter(b => !b.hidden && b.getBoundingClientRect().width).map((b, i) => { const r = b.getBoundingClientRect(); return { i, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, x: r.left + r.width / 2, y: r.top + r.height / 2, rx: r.left + r.width / 2 - w.left, ry: r.top + r.height / 2 - w.top }; });
    return { btns, free: eb?.classList.contains('tl-free') }; })()`);
  if (process.env.TH_DBG) console.log('   d37e-css:', JSON.stringify(await ev(`(() => { const t = document.getElementById('d37e-css')?.textContent || ''; const i = t.indexOf('tl-free'); return [t.length, t.slice(Math.max(0, i - 30), i + 260), [...document.getElementById('d37e-css').sheet.cssRules].filter(r => r.cssText.includes('tl-free')).map(r => r.cssText)]; })()`)));
  if (process.env.TH_DBG) console.log('   переход:', JSON.stringify(await ev(`(() => { const s = getComputedStyle(document.querySelector('.e-btns')); return [s.transitionProperty, s.transitionDuration, s.animationName]; })()`)));
  if (process.env.TH_DBG) console.log('   переключение tl-free:', JSON.stringify(await ev(`(() => { const eb = document.querySelector('.e-btns'), c = () => { const s = getComputedStyle(eb); return s.right + '/' + s.bottom + '/' + s.paddingBottom + '/' + s.display; }; const a = c(); eb.classList.add('tl-free'); const b = c(); eb.classList.remove('tl-free'); const d = c(); void eb.offsetWidth; const e = c(); return [a, b, d, e]; })()`)));
  const G = await geo();
  ok(G.btns.length >= 2 && G.btns.every(b => b.w >= 46 && b.w <= 64) && !G.free, '«Мир»: кнопки движка 50 / 62 px, сеткой', G.btns.map(b => Math.round(b.w)));
  const jb = G.btns.reduce((a, b) => b.w > a.w ? b : a, G.btns[0]);   // «прыжок» — большая
  await ev(`(() => { D37Settings.open({ ctx: 'engine', tab: 'controls' }); return 1; })()`); await sleep(500);
  const row = await ev(`!!document.querySelector('#gsSettings [data-tl-edit]:not([disabled])')`);
  ok(row, '«Мир»: ⚙️ → Управление — есть «Настроить кнопки»');
  if (!row) { await ev(`D37Settings.close()`); return; }
  await ev(`(() => { document.querySelector('#gsSettings [data-tl-edit]').click(); return 1; })()`); await sleep(500);
  const pj = await ev(`(() => { const p = document.querySelector('.tl-ed .tl-p[data-id="jump"]'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, n: document.querySelectorAll('.tl-ed .tl-p').length }; })()`);
  ok(!!pj && Math.abs(pj.x - jb.x) < 12 && Math.abs(pj.y - jb.y) < 2, '«Мир»: в редакторе «прыжок» там же, где в сетке (сетка — с кнопкой «действие»: без неё сдвиг на промежуток)', [pj, jb]);
  if (!pj) return;
  const steps = []; for (let i = 1; i <= 6; i++) steps.push([pj.x - 90 * i / 6, pj.y - 70 * i / 6]);
  await touch(send, pj.x, pj.y, 60, steps);
  const done = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="done"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await touch(send, done[0], done[1], 50); await sleep(400);
  const G1 = await geo(), j1 = G1.btns.reduce((a, b) => b.w > a.w ? b : a, G1.btns[0]);
  ok(G1.free && Math.abs(j1.x - (pj.x - 90)) < 4 && Math.abs(j1.y - (pj.y - 70)) < 4 && Math.abs(j1.w - jb.w) < 2, '«Мир»: «Готово» — «прыжок» на новом месте, кнопки — свободно', [j1, pj, G1.free]);
  await ev(`(() => { const S = GAME_IMPL.world._test.state(); window.__wj = []; const C = S.C, cp = C.press; C.press = (a, v) => { __wj.push(a + ':' + v); return cp(a, v); }; return 1; })()`);
  const hitEl = await ev(`(() => { const e = document.elementFromPoint(${j1.x}, ${j1.y}); if (!e) return null; const path = []; for (let p = e; p && path.length < 6; p = p.parentElement) path.push((p.tagName + '.' + String(p.className || '').split(' ').join('.')).slice(0, 40)); return (e.closest('.e-btn') ? 'кнопка' : 'не кнопка') + ': ' + path.join(' < ') + ' | ' + e.outerHTML.slice(0, 160); })()`);
  await touch(send, j1.x, j1.y, 120);
  const log = await ev(`window.__wj || []`);
  ok(log.includes('jump:true') && log.includes('jump:false'), '«Мир»: на новом месте «прыжок» прыгает', [log, hitEl]);
  const vis0 = await ev(`[...document.querySelectorAll('.e-btns .e-btn')].map(b => b.hidden ? 0 : 1).join('')`);
  await ev(`(() => { D37TouchLayout.edit(); return 1; })()`); await sleep(300);
  for (const k of ['reset', 'done']) { const p = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="${k}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await touch(send, p[0], p[1], 50); await sleep(300); }
  const G2 = await geo(), j2 = G2.btns.reduce((a, b) => b.w > a.w ? b : a, G2.btns[0]);
  const dump = await ev(`(() => { const all = [...document.querySelectorAll('.e-btns')], eb = all[0], cs = getComputedStyle(eb); return { n: all.length, par: eb.parentElement.className, cls: eb.className, st: eb.getAttribute('style'), pad: cs.paddingBottom, tr: cs.transform, bottom: cs.bottom, right: cs.right, pos: cs.position, disp: cs.display, vis: [...eb.children].map(b => (b.hidden ? 'h' : 'v') + ':' + b.getAttribute('style')).join(' | '), vis0: '${vis0}', css: [...document.styleSheets].filter(s => { try { return [...s.cssRules].some(r => r.cssText?.includes('e-btns')); } catch (e) { return false; } }).map(s => (s.href || s.ownerNode?.id || 'inline').slice(-30)) }; })()`);
  ok(!G2.free && Math.abs(j2.rx - jb.rx) < 2 && Math.abs(j2.ry - jb.ry) < 2, '«Мир»: «Как было» — снова сетка, «прыжок» на месте', [j2, jb, G2.free, dump]);
  if (process.env.TH_DBG) {
    await send('DOM.enable'); await send('CSS.enable');
    const doc = await send('DOM.getDocument', { depth: 1 });
    const n = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '.e-btns' });
    const m = await send('CSS.getMatchedStylesForNode', { nodeId: n.nodeId });
    for (const r of m.matchedCSSRules) console.log('   правило:', r.rule.selectorList.text, '→', r.rule.style.cssProperties.filter(p => /right|bottom|padding|inset/.test(p.name)).map(p => p.name + ':' + p.value + (p.important ? '!' : '')).join('; '));
    if (m.inlineStyle) console.log('   inline:', m.inlineStyle.cssText);
  }
}

// ═══ «Подземье»: кнопки не наезжают, под пальцем — свои, «Настроить кнопки» в ⚙️ → «⛏ Подземье» двигает их (CSS-переменные) ═══
async function podzemChecks(B, VW, VH){
  const { send, ev } = B;
  const geo = () => ev(`(() => { const w = document.querySelector('.pz-wrap').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.pz-touch [data-t]')].filter(b => !b.hidden && b.getBoundingClientRect().width).map(b => { const r = b.getBoundingClientRect(); return { id: b.dataset.t, l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, x: r.left + r.width / 2, y: r.top + r.height / 2, rx: r.left + r.width / 2 - w.left, ry: r.top + r.height / 2 - w.top }; });
    const covered = []; for (const b of btns) for (const [x, y] of [[b.x, b.y], [b.l + b.w * .25, b.y], [b.r - b.w * .25, b.y]]) { const el = document.elementFromPoint(x, y); if (!el || el.closest('[data-t]')?.dataset.t !== b.id) covered.push({ id: b.id, top: el ? String(el.className || el.tagName).slice(0, 30) : null }); }
    return { btns, covered }; })()`);
  const G = await geo();
  const bad = []; for (let i = 0; i < G.btns.length; i++) for (let j = i + 1; j < G.btns.length; j++) { const a = G.btns[i], b = G.btns[j]; if (Math.hypot(a.x - b.x, a.y - b.y) < (a.w + b.w) / 2 + 2) bad.push(a.id + '×' + b.id); }
  ok(!bad.length && G.btns.length >= 4, '«Подземье»: кнопки не наезжают друг на друга', bad);
  ok(!G.covered.length, '«Подземье»: каждая кнопка под пальцем — своя', G.covered.slice(0, 5));
  ok(G.btns.every(b => b.w >= 40 && b.w <= 60), '«Подземье»: кнопки 42–58 px', G.btns.map(b => b.id + ' ' + Math.round(b.w)));
  const j0 = G.btns.find(b => b.id === 'jump');
  await ev(`(() => { D37Settings.open({ tab: 'podzem' }); return 1; })()`); await sleep(500);
  const row = await ev(`!!document.querySelector('#gsSettings [data-tl-edit]:not([disabled])')`);
  ok(row, '«⚙️ → ⛏ Подземье»: есть «Настроить кнопки»');
  if (!row) { await ev(`D37Settings.close()`); return; }
  await ev(`(() => { document.querySelector('#gsSettings [data-tl-edit]').click(); return 1; })()`); await sleep(500);
  const pj = await ev(`(() => { const p = document.querySelector('.tl-ed .tl-p[data-id="jump"]'); if (!p) return null; const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  ok(!!pj && Math.abs(pj.x - j0.x) < 2 && Math.abs(pj.y - j0.y) < 2, '«Подземье»: в редакторе «прыжок» там же, где в игре', [pj, j0]);
  if (!pj) return;
  const st = await ev(`GAME_IMPL.podzem._test.state().state`);
  ok(st === 'paused', '«Подземье»: пока настраиваешь — мир на паузе', st);
  const steps = []; for (let i = 1; i <= 6; i++) steps.push([pj.x - 110 * i / 6, pj.y - 50 * i / 6]);
  await touch(send, pj.x, pj.y, 60, steps);
  const done = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="done"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await touch(send, done[0], done[1], 50); await sleep(400);
  const j1 = (await geo()).btns.find(b => b.id === 'jump');
  ok(j1 && Math.abs(j1.x - (pj.x - 110)) < 4 && Math.abs(j1.y - (pj.y - 50)) < 4 && Math.abs(j1.w - j0.w) < 2, '«Подземье»: «Готово» — «прыжок» на новом месте', [j1, pj]);
  ok(await ev(`GAME_IMPL.podzem._test.state().state`) === 'play', '«Подземье»: закрыл редактор — играем дальше');
  await ev(`(() => { D37TouchLayout.edit(); return 1; })()`); await sleep(300);
  for (const k of ['reset', 'done']) { const p = await ev(`(() => { const r = document.querySelector('.tl-ed [data-tl="${k}"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await touch(send, p[0], p[1], 50); await sleep(300); }
  const j2 = (await geo()).btns.find(b => b.id === 'jump');
  ok(j2 && Math.abs(j2.rx - j0.rx) < 2 && Math.abs(j2.ry - j0.ry) < 2, '«Подземье»: «Как было» — «прыжок» на месте', [j2, j0]);
  // левша: кнопки зеркалит CSS (.pz-tc), редактор показывает их там же, где они на экране
  await ev(`(() => { D37Settings.set('lefty', true); return 1; })()`); await sleep(400);
  const jl = (await geo()).btns.find(b => b.id === 'jump');
  await ev(`(() => { D37TouchLayout.edit(); return 1; })()`); await sleep(300);
  const pl = await ev(`(() => { const r = document.querySelector('.tl-ed .tl-p[data-id="jump"]').getBoundingClientRect(); document.querySelector('.tl-ed [data-tl="cancel"]').click(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  ok(jl && jl.rx < VW / 2 && Math.abs(pl.x - jl.x) < 2 && Math.abs(pl.y - jl.y) < 2, '«Подземье», левша: «прыжок» слева, в редакторе — там же', [jl, pl]);
  await ev(`(() => { D37Settings.set('lefty', false); return 1; })()`); await sleep(300);
  await shot(send, `podzem-${VW}x${VH}-after-editor`);
}

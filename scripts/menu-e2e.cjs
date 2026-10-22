// T-043: одно меню и понятные настройки — в настоящем Chrome (headless, без npm). Владелец 22.10: «Сделай понятнее и лучше
// настройки. Зачем вот тут 2 меню?» — у «Мира Денчика» панель сверху повторяла меню Esc (Персонаж, Настройки, ⛶, ❓).
// Режимы (первый аргумент, по умолчанию all):
//   shots — снимки «Мира Денчика»: панель, меню, ⚙️ Настройки (и поиск) на телефоне 390×844 и ПК 1440×900;
//   games — «Кубомир» (меню миров), «Подземье» (пауза), обычная игра (шапка), «Студия 3D»: где ⚙️ ⛶ ❓ и сколько раз;
//   perf  — телефон (ЦП ×4 медленнее): меню открывается (☰ и Esc), окно ⚙️ открывается, вкладка, поиск — медианы, мс;
//   leak  — 20 раз меню → ⚙️ → вкладка → поиск → закрыть: слушатели window/document, узлы DOM, память после сборки мусора;
//   pad   — поддельный геймпад и клавиатура: ↑↓ по меню, Ⓐ / Ⓑ, LB/RB — вкладки, → / ← у ползунка, Esc в поиске;
//   tour  — (не входит в all) снимок каждой вкладки окна ⚙️, подсказки в одну строку, несколько поисков — посмотреть глазами.
// SITE_DIR — другая копия сайта (снимки «до»), TAG — подпись снимков (before / after), SHOTS — папка снимков (иначе D37_TMP).
// Запуск из корня сайта: node scripts/menu-e2e.cjs [shots|games|perf|leak|pad|all]   (CHROME — путь к Chrome)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const SHOTS = process.env.SHOTS || TMP;
const TAG = process.env.TAG || 'after';
const MODE = process.argv[2] || 'all';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p.startsWith('/play/') || p === '/games') p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const r1 = v => Math.round(v * 10) / 10;

// ═══ Chrome через протокол отладки ═══
async function chrome(screen){
  const [kind, VW, VH] = screen;
  const port = 9300 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'd37-menu-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; } if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  if (kind === 'phone') {
    await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
  } else await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  // без окошек сайта (возраст, «установить приложение»), графика низкая (SwiftShader), место в мире — по умолчанию
  const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: 'low', gfx: 'low' }), d37_gfx: 'low', d37_s3_learn: '1', d37_s3_tut: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `if(!sessionStorage.getItem('d37_e2e_ls'))localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}sessionStorage.setItem('d37_e2e_ls','1');localStorage.removeItem('d37_mir_pos');}catch(e){}` });
  const shot = async name => { const s = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(SHOTS, `${TAG}-${kind}-${VW}x${VH}-${name}.png`); fs.writeFileSync(f, Buffer.from(s.data, 'base64')); return f; };
  const tap = async (x, y) => {
    if (kind === 'phone') { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(40); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(30); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); }
  };
  // нажать на элемент по селектору — как человек (касание / мышь в его середину)
  const tapSel = async sel => { const p = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (!p) return false; await tap(p[0], p[1]); return true; };
  const VK = { Escape: 27, Enter: 13, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39 };
  const key = async (k, code) => { const vk = VK[k] || 0, base = { key: k, code: code || k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }; await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(k === 'Enter' ? { text: String.fromCharCode(13), unmodifiedText: String.fromCharCode(13) } : {}) }); await sleep(20); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
  const close = async () => { try { ws.close(); } catch (e) {} proc.kill(); await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { kind, VW, VH, send, ev, shot, tap, tapSel, key, close, errs };
}
const BASE = () => 'http://localhost:' + server.address().port;
// убрать окошки сайта поверх (возраст, приложение, всплывашки) — они к проверке не относятся
const CLEAN = `document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast,.wld-hint,.cel-adv,.cel-ban').forEach(e => e.remove())`;

async function openWorld(B){
  await B.send('Page.navigate', { url: BASE() + '/#/games/world' });
  let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await B.ev(`!!(window.GAME_IMPL?.world?._test?.state()?.R && document.querySelector('.wld-topbtns .mir-phone') && document.querySelector('.wld-topbtns .mz-mapbtn'))`); } catch (e) {} }
  if (!up) throw new Error('мир не загрузился');
  await B.ev(`(() => { const S = GAME_IMPL.world._test.state(); S.fixedTime = 13; ${CLEAN}; })()`);
  await sleep(1200);
  await B.ev(CLEAN);
}
// кнопки панели мира (видимые) и пункты меню
const BAR = `[...document.querySelectorAll('.wld-topbtns > *')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.textContent || b.getAttribute('aria-label') || b.title || '').trim().replace(/\\s+/g, ' ') || b.className)`;
const MENU = `[...document.querySelectorAll('.gs-menu .gs-menu-it')].map(b => b.textContent.trim().replace(/\\s+/g, ' '))`;
async function openMenuWorld(B){
  const hasBtn = await B.ev(`!!document.querySelector('.wld-menubtn')`);
  if (hasBtn) await B.tapSel('.wld-menubtn'); else await B.ev(`(() => { const S = GAME_IMPL.world._test.state(); S.C.key('Escape', true); setTimeout(() => S.C.key('Escape', false), 60); })()`);
  for (let i = 0; i < 40; i++) { if (await B.ev(`!!document.querySelector('.gs-menu')`)) return true; await sleep(50); }
  return false;
}

// ═══ Снимки «Мира Денчика»: панель, меню, настройки ═══
async function shots(screen){
  const B = await chrome(screen);
  try {
    console.log(`Мир: ${screen.join(' ')} (${TAG})`);
    await openWorld(B);
    const bar = await B.ev(BAR);
    console.log('  панель:', bar.join(' · '));
    await B.shot('1-world');
    ok(await openMenuWorld(B), 'меню открылось');
    await sleep(300);
    const items = await B.ev(MENU);
    console.log('  меню:', items.join(' · '));
    await B.shot('2-menu');
    // одно место на действие: в панели мира нет того, что есть в меню
    if (TAG !== 'before') {
      const dup = bar.filter(t => /Персонаж|Настройки|Как играть|весь экран|^❓|^⚙️|^🎭/.test(t));
      ok(!dup.length, 'в панели мира нет пунктов меню (Персонаж, Настройки, ⛶, ❓)', dup);
      ok(bar.some(t => /Карта/.test(t)) && bar.some(t => /Участок/.test(t)) && bar.some(t => /Телефон/.test(t) || t === 'mir-phone') && bar.some(t => /Меню/.test(t)), 'в панели: 🗺 Карта, 🏘 Участок, 📱 Телефон, ☰ Меню', bar);
      ok(['Продолжить', 'Настройки', 'Персонаж', 'весь экран', 'Как играть', 'Выйти'].every(w => items.some(t => t.includes(w))), 'в меню: продолжить, настройки, персонаж, во весь экран, как играть, выйти', items);
    }
    await B.tapSel('.gs-menu [data-mi="settings"]');
    for (let i = 0; i < 40 && !(await B.ev(`!!document.querySelector('.gs-set')`)); i++) await sleep(50);
    await sleep(400);
    const tabs = await B.ev(`[...document.querySelectorAll('.gs-set-tabs button')].map(b => b.textContent.trim())`);
    console.log('  вкладки:', tabs.join(' · '));
    await B.shot('3-settings');
    if (await B.ev(`!!document.querySelector('.gs-set-find')`)) {
      await B.ev(`(() => { const i = document.querySelector('.gs-set-find'); i.focus(); i.value = 'громк'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await sleep(300);
      const found = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-row')].filter(r => r.offsetParent).map(r => r.querySelector('.gs-lbl b')?.textContent.trim())`);
      console.log('  поиск «громк»:', found.join(' · '));
      ok(found.length >= 3 && found.some(t => /Громкость/i.test(t)), 'поиск «громк» находит громкости', found);
      await B.shot('4-search');
      // вкладка «Графика» — как выглядит
      await B.ev(`(() => { const i = document.querySelector('.gs-set-find'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    }
    await B.tapSel('.gs-set-tabs [data-tab="gfx"]'); await sleep(300);
    await B.shot('5-gfx');
    await B.tapSel('.gs-set-x'); await sleep(200);
    ok(!(await B.ev(`!!document.querySelector('.gs-set')`)), '✕ закрыл настройки');
    ok(await B.ev(`!!document.querySelector('.gs-menu')`), 'меню под настройками осталось');
    await B.tapSel('.gs-menu [data-mi="resume"]'); await sleep(200);
    ok(!(await B.ev(`!!document.querySelector('.gs-menu')`)), '«Продолжить» закрыл меню');
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Другие игры: где ⚙️ ⛶ ❓ (по одному месту) ═══
async function games(screen){
  const B = await chrome(screen);
  const vis = sel => B.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && getComputedStyle(b).visibility !== 'hidden'; }).length`);
  const stageBar = `[...document.querySelectorAll('#gamesStage > .gm-stage-bar > *')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.textContent || b.title || '').trim().replace(/\\s+/g, ' ') || b.title || b.className)`;
  try {
    console.log(`Игры: ${screen.join(' ')} (${TAG})`);
    // обычная игра: шапка — единственное место (⚙️ 🔄/⛶ 📖)
    await B.send('Page.navigate', { url: BASE() + '/#/games/2048' });
    for (let i = 0; i < 60 && !(await B.ev(`!!document.querySelector('#gamesStageBox > *:not(.gm-loading)')`)); i++) await sleep(250);
    await sleep(600); await B.ev(CLEAN);
    console.log('  2048, шапка:', (await B.ev(stageBar)).join(' · '));
    ok(await vis('#gamesStage [data-gs-set]') === 1 && await vis('#gamesStage [data-gs-full]') === 1, 'обычная игра: ⚙️ и ⛶ — по одному, в шапке');
    await B.shot('g1-2048');
    // «Кубомир»: меню миров
    await B.send('Page.navigate', { url: BASE() + '/#/games/kubomir' });
    for (let i = 0; i < 80 && !(await B.ev(`!!document.querySelector('.kb-menu .kb-worlds')`)); i++) await sleep(250);
    await sleep(800); await B.ev(CLEAN);
    console.log('  Кубомир, шапка:', (await B.ev(stageBar)).join(' · '), '| панель:', (await B.ev(BAR)).join(' · '));
    await B.shot('g2-kubomir');
    if (await B.ev(`!!document.querySelector('.kb-top [data-kb="menu"]')`)) {
      await B.tapSel('.kb-top [data-kb="menu"]'); await sleep(300);
      console.log('  Кубомир, меню:', (await B.ev(MENU)).join(' · '));
      ok(await vis('#gamesStage [data-gs-set]') === 0 && await vis('#gamesStage [data-gs-full]') === 0, 'Кубомир: ⚙️ и ⛶ — только в меню ☰');
      await B.shot('g3-kubomir-menu');
      await B.tapSel('.gs-menu [data-mi="resume"]'); await sleep(200);
      // в мире: ☰ — то же меню паузы, что Esc (моды, импорт, «Я застрял», выход)
      if (process.env.KB_WORLD !== '0') {
        await B.ev(`(() => { const b = [...document.querySelectorAll('.kb-mbtns button')].find(x => /Новый мир/.test(x.textContent)); b && b.click(); return !!b; })()`); await sleep(500);
        await B.ev(`(() => { const c = document.querySelector('[data-f="mode"] [data-v="creative"]'); c && c.click(); document.querySelector('[data-n="go"]')?.click(); })()`);
        let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); up = await B.ev(`!!GAME_IMPL.kubomir?._test?.state()?.ready`).catch(() => false); }
        if (up) {
          await sleep(1500); await B.ev(CLEAN);
          await B.tapSel('.kb-top [data-kb="menu"]');
          for (let i = 0; i < 20 && !(await B.ev(`!!document.querySelector('.gs-menu')`)); i++) await sleep(100);
          await sleep(200);
          const km = await B.ev(MENU);
          console.log('  Кубомир в мире, меню:', km.join(' · '));
          if (TAG !== 'before') ok(['Продолжить', 'Настройки', 'Моды мира', 'весь экран', 'Как играть', 'Я застрял', 'выйти'].every(w => km.some(t => t.includes(w))), 'Кубомир в мире: ☰ — меню паузы (моды, «Я застрял», полный экран, выход)', km);
          await B.shot('g3b-kubomir-world-menu');
          await B.tapSel('.kb-top [data-kb="menu"]'); await sleep(250);
          ok(!(await B.ev(`!!document.querySelector('.gs-menu')`)), 'Кубомир: ☰ ещё раз — меню закрыто');
        } else ok(false, 'Кубомир: мир не открылся');
      }
    }
    // «Подземье»: стартовый экран (свои ❓ ⚙️ ⛶), игра и пауза ☰ (новый мир — «▶ Новая игра»)
    await B.send('Page.navigate', { url: BASE() + '/#/games/podzem' });
    for (let i = 0; i < 80 && !(await B.ev(`!!document.querySelector('.pz-start [data-a="quick"], .pz-start [data-a="play"]')`)); i++) await sleep(250);
    await sleep(800); await B.ev(CLEAN);
    const pzFoot = await B.ev(`[...document.querySelectorAll('.pz-start .pz-foot button')].map(b => b.textContent.trim())`);
    console.log('  Подземье, шапка:', (await B.ev(stageBar)).join(' · '), '| старт:', pzFoot.join(' · '));
    if (TAG !== 'before') {
      ok(await vis('#gamesStage [data-gs-set]') === 0 && await vis('#gamesStage [data-gs-full]') === 0, 'Подземье: в шапке игры нет ⚙️ и ⛶ (они в меню ☰ и на стартовом экране)');
      ok(pzFoot.some(t => /Настройки/.test(t)) && pzFoot.some(t => /весь экран|Обычный экран/.test(t)), 'Подземье, старт: ⚙️ Настройки и ⛶ — по одному', pzFoot);
    }
    await B.shot('g4-podzem');
    await B.tapSel('.pz-start [data-a="quick"], .pz-start [data-a="play"]');
    for (let i = 0; i < 120 && (await B.ev(`GAME_IMPL.podzem?._test?.state()?.state || ''`)) !== 'play'; i++) await sleep(250);
    await sleep(1500); await B.ev(CLEAN);
    if (await B.ev(`!!document.querySelector('[data-a="pause"]')`)) {
      await B.tapSel('[data-a="pause"]');
      for (let i = 0; i < 20 && !(await B.ev(`!!document.querySelector('.gs-menu')`)); i++) await sleep(100);
      await sleep(300);
      const pm = await B.ev(MENU);
      console.log('  Подземье, меню:', pm.join(' · '));
      if (TAG !== 'before') ok(pm.some(t => /Настройки/.test(t)) && pm.some(t => /весь экран|Обычный экран/.test(t)), 'Подземье, пауза ☰: настройки и ⛶ есть', pm);
      await B.shot('g5-podzem-menu');
      await B.tapSel('.gs-menu [data-mi="resume"]'); await sleep(200);
    } else ok(false, 'Подземье: игра не началась');
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Скорость на телефоне (ЦП ×4): меню, окно ⚙️, вкладка, поиск ═══
async function perf(){
  const B = await chrome(['phone', 390, 844]);
  try {
    console.log(`Скорость: телефон 390×844, ЦП ×4 (${TAG})`);
    await openWorld(B);
    await B.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(1500);
    const res = await B.ev(`(async () => {
      const S = GAME_IMPL.world._test.state(), raf = () => new Promise(r => requestAnimationFrame(() => r()));
      const out = { menuBtn: [], menuBtnFrame: [], menuEsc: [], set: [], setFrame: [], tab: [], find: [] };
      const btn = document.querySelector('.wld-menubtn');
      for (let i = 0; i < 8; i++) {
        // ☰ (новое) — нажатие → меню на экране (скрипт + стиль + раскладка), и до следующего кадра
        if (btn) { const t0 = performance.now(); btn.click(); document.querySelector('.gs-menu')?.getBoundingClientRect(); const t1 = performance.now(); await raf(); out.menuBtn.push(t1 - t0); out.menuBtnFrame.push(performance.now() - t0); }
        else {   // «до»: только Esc — шаг игры открывает меню
          const t0 = performance.now(); S.C.key('Escape', true);
          while (!document.querySelector('.gs-menu') && performance.now() - t0 < 2000) await raf();
          document.querySelector('.gs-menu')?.getBoundingClientRect(); out.menuEsc.push(performance.now() - t0); S.C.key('Escape', false);
        }
        await new Promise(r => setTimeout(r, 120));
        // ⚙️ из меню
        let t0 = performance.now(); document.querySelector('.gs-menu [data-mi="settings"]').click(); document.querySelector('.gs-set')?.getBoundingClientRect(); let t1 = performance.now(); await raf();
        out.set.push(t1 - t0); out.setFrame.push(performance.now() - t0);
        await new Promise(r => setTimeout(r, 120));
        const tb = document.querySelector('.gs-set-tabs [data-tab="gfx"]');
        if (tb) { t0 = performance.now(); tb.click(); document.querySelector('.gs-set-body').getBoundingClientRect(); out.tab.push(performance.now() - t0); }
        const f = document.querySelector('.gs-set-find');
        if (f) { t0 = performance.now(); f.value = 'тени'; f.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.gs-set-body').getBoundingClientRect(); out.find.push(performance.now() - t0); f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
        document.querySelector('.gs-set-x').click();
        await new Promise(r => setTimeout(r, 80));
        document.querySelector('.gs-menu [data-mi="resume"]')?.click();
        await new Promise(r => setTimeout(r, 200));
        // Esc (и «после») — чтобы сравнить с «до»
        if (btn) {
          const t2 = performance.now(); S.C.key('Escape', true);
          while (!document.querySelector('.gs-menu') && performance.now() - t2 < 2000) await raf();
          document.querySelector('.gs-menu')?.getBoundingClientRect(); out.menuEsc.push(performance.now() - t2); S.C.key('Escape', false);
          await new Promise(r => setTimeout(r, 100));
          document.querySelector('.gs-menu [data-mi="resume"]')?.click();
          await new Promise(r => setTimeout(r, 200));
        }
      }
      return out;
    })()`);
    const M = {}; for (const [k, v] of Object.entries(res)) if (v.length) M[k] = r1(med(v));
    console.log('  медианы, мс:', JSON.stringify(M));
    if (res.menuBtn.length) ok(M.menuBtn < 50, `☰ → меню на экране: ${M.menuBtn} мс (< 50; до следующего кадра ${M.menuBtnFrame})`);
    ok(M.set < 120, `окно ⚙️ открывается: ${M.set} мс (< 120; до следующего кадра ${M.setFrame})`);
    fs.writeFileSync(path.join(SHOTS, `${TAG}-perf.json`), JSON.stringify({ medians: M, raw: res }, null, 1));
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Утечки: 20 раз меню → ⚙️ → вкладки → поиск → закрыть ═══
// Мир сам растёт, пока подгружает зоны (подписи жителей, кусочки построек), — поэтому в мире считаем то, что от меню и окна:
// слушатели window/document, узлы DOM без живых слоёв мира (подписи, журнал) и что окна после закрытия нет; память — с поправкой
// на «мир сам по себе» (столько же времени без меню). Окно ⚙️ отдельно — на странице игр (там ничего не растёт само).
const COUNT_NODES = `(() => { let n = document.getElementsByTagName('*').length; for (const e of document.querySelectorAll('.wld-tags, .mz-tags, .wld-log, .mb-tags, .wb-names-tags, .wld-pop, .mz-hud > :not(.mz-tags)')) n -= e.getElementsByTagName('*').length; return n; })()`;
async function counter(B){
  await B.send('HeapProfiler.collectGarbage'); await sleep(100); await B.send('HeapProfiler.collectGarbage');
  const L = {};
  for (const [nm, ex] of [['window', 'window'], ['document', 'document']]) {
    const o = await B.send('Runtime.evaluate', { expression: ex });
    const r = await B.send('DOMDebugger.getEventListeners', { objectId: o.result.objectId });
    L[nm] = r.listeners.length;
  }
  const nodes = await B.ev(COUNT_NODES), all = await B.ev(`document.getElementsByTagName('*').length`);
  // своё: прямые дети body (окна поверх) и всё с классами gs-* (меню, окно ⚙️, кнопки) — страница игр сама догружает ролики
  const own = await B.ev(`document.body.children.length + document.querySelectorAll('[class*="gs-"]').length`);
  const heap = await B.send('Runtime.getHeapUsage');
  return { win: L.window, doc: L.document, nodes, all, own, heapMB: r1(heap.usedSize / 1048576) };
}
const SET_CYCLE = `
      for (const id of ['main', 'gfx', 'sound', 'controls', 'camera', 'ui', 'site']) { document.querySelector('.gs-set-tabs [data-tab="' + id + '"]')?.click(); await wait(10); }
      const f = document.querySelector('.gs-set-find'); if (f) { for (const w of ['кноп', 'тени', 'громк', 'zzz']) { f.value = w; f.dispatchEvent(new Event('input', { bubbles: true })); await wait(10); } f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('.gs-set-x').click(); await wait(30);`;
async function leak(){
  const B = await chrome(['pc', 1440, 900]);
  try {
    console.log(`Утечки: ПК 1440×900, 20 открытий/закрытий (${TAG})`);
    await openWorld(B);
    await sleep(6000);   // мир догружает ближние зоны
    const cycle = () => B.ev(`(async () => {
      const S = GAME_IMPL.world._test.state(), wait = ms => new Promise(r => setTimeout(r, ms));
      const btn = document.querySelector('.wld-menubtn');
      if (btn) btn.click(); else { S.C.key('Escape', true); await wait(80); S.C.key('Escape', false); }
      for (let i = 0; i < 40 && !document.querySelector('.gs-menu'); i++) await wait(25);
      document.querySelector('.gs-menu [data-mi="settings"]').click(); await wait(30);
      ${SET_CYCLE}
      document.querySelector('.gs-menu [data-mi="resume"]')?.click(); await wait(60);
      return !document.querySelector('.gs-menu') && !document.querySelector('.gs-set');
    })()`);
    ok(await cycle(), 'мир: первый круг — всё закрылось');
    const a = await counter(B), t0 = Date.now();
    let allClosed = true;
    for (let i = 0; i < 20; i++) if (!(await cycle())) allClosed = false;
    const b = await counter(B), dt = Date.now() - t0;
    await sleep(dt);   // столько же времени — мир сам по себе
    const c = await counter(B);
    console.log('  мир, после 1-го круга:', JSON.stringify(a), ' после ещё 20:', JSON.stringify(b), ` и ещё ${Math.round(dt / 1000)} с без меню:`, JSON.stringify(c));
    ok(allClosed, 'мир: 20 кругов — меню и окно каждый раз закрываются');
    ok(b.win <= a.win && b.doc <= a.doc, `мир: слушатели window/document не растут: ${a.win}/${a.doc} → ${b.win}/${b.doc}`);
    ok(b.nodes <= a.nodes + 10, `мир: узлы DOM (без живых слоёв мира) не растут: ${a.nodes} → ${b.nodes}`);
    const heapMenu = r1((b.heapMB - a.heapMB) - Math.max(0, c.heapMB - b.heapMB));
    ok(heapMenu <= 2, `мир: память за 20 кругов (за вычетом «мир сам по себе» ${r1(c.heapMB - b.heapMB)} МБ): ${heapMenu} МБ`);
    // окно ⚙️ на странице игр
    await B.send('Page.navigate', { url: BASE() + '/#/games' });
    for (let i = 0; i < 60 && !(await B.ev(`!!window.D37Settings && !!document.querySelector('#gamesGrid > *')`)); i++) await sleep(250);
    await sleep(2500); await B.ev(CLEAN);
    const cyc2 = () => B.ev(`(async () => { const wait = ms => new Promise(r => setTimeout(r, ms));
      D37Settings.open({ ctx: 'site' }); await wait(30);
      ${SET_CYCLE}
      return !document.querySelector('.gs-set');
    })()`);
    await cyc2();
    const d = await counter(B);
    let closed2 = true;
    for (let i = 0; i < 20; i++) if (!(await cyc2())) closed2 = false;
    const e = await counter(B);
    console.log('  страница игр, после 1-го:', JSON.stringify(d), ' после ещё 20:', JSON.stringify(e));
    ok(closed2 && e.win <= d.win && e.doc <= d.doc && e.own <= d.own, `окно ⚙️: слушатели ${d.win}/${d.doc} → ${e.win}/${e.doc}, свои узлы ${d.own} → ${e.own} (вся страница ${d.all} → ${e.all} — сама догружает ролики)`);
    ok(e.heapMB <= d.heapMB + 1.5, `окно ⚙️: память ${d.heapMB} → ${e.heapMB} МБ`);
    fs.writeFileSync(path.join(SHOTS, `${TAG}-leak.json`), JSON.stringify({ world: { first: a, after20: b, idle: c }, settings: { first: d, after20: e } }, null, 1));
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Геймпад и клавиатура в меню и окне ⚙️ (поддельный геймпад: navigator.getGamepads) ═══
async function pad(){
  const B = await chrome(['pc', 1440, 900]);
  try {
    console.log(`Геймпад и стрелки: ПК 1440×900 (${TAG})`);
    await openWorld(B);
    // поддельный геймпад: кнопки/оси меняет проверка, опрос меню — каждый кадр
    await B.ev(`(() => { const P = window.__pad = { id: 'test', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), timestamp: 0 };
      navigator.getGamepads = () => [P, null, null, null];
      window.__press = async i => { P.buttons[i] = { pressed: true, value: 1 }; await new Promise(r => setTimeout(r, 230)); P.buttons[i] = { pressed: false, value: 0 }; await new Promise(r => setTimeout(r, 170)); };   // кадр мира в SwiftShader бывает 100+ мс — нажатие держим дольше кадра
      return true; })()`);
    const focus = () => B.ev(`(() => { const a = document.activeElement; return a ? (a.getAttribute('data-mi') || a.getAttribute('data-tab') || a.getAttribute('data-set') && a.getAttribute('data-set') + '=' + a.dataset.v || a.getAttribute('data-range') || a.getAttribute('data-sw') || a.className || a.tagName) : null; })()`);
    await B.tapSel('.wld-menubtn'); await sleep(300);
    ok(await focus() === 'resume', 'меню открылось — фокус на «Продолжить»', await focus());
    await B.ev(`__press(13)`); await sleep(100);
    ok(await focus() === 'settings', 'крестовина ↓ — «Настройки»', await focus());
    await B.ev(`__press(12)`); await B.ev(`__press(12)`); await sleep(100);
    ok(await focus() === 'exit', '↑ с первого пункта — по кругу на последний («Выйти»)', await focus());
    await B.ev(`__press(13)`); await B.ev(`__press(13)`); await sleep(100);
    ok(await focus() === 'settings', '↓↓ — снова «Настройки»', await focus());
    // Ⓐ — при отпускании: открывает окно ⚙️
    await B.ev(`__press(0)`); await sleep(400);
    ok(await B.ev(`!!document.querySelector('.gs-set')`), 'Ⓐ на «Настройки» — окно открылось');
    await B.ev(`__press(5)`); await sleep(250);
    ok(await B.ev(`document.querySelector('.gs-set-tabs .on')?.dataset.tab`) === 'gfx' && await focus() === 'gfx', 'RB — следующая вкладка («Графика»), фокус на ней', await focus());
    await B.ev(`__press(4)`); await sleep(250);
    ok(await B.ev(`document.querySelector('.gs-set-tabs .on')?.dataset.tab`) === 'main', 'LB — назад («Главное»)');
    // → из вкладок в строки, ↓ по строкам (группы вариантов — целиком), ← → у ползунка меняют значение
    await B.ev(`__press(15)`); await sleep(150);
    const f1 = await focus();
    ok(/^gfxPreset=/.test(f1 || ''), '→ из вкладки — в первую строку (на выбранный вариант)', f1);
    let f = f1; for (let i = 0; i < 6 && !/^sens$/.test(f || ''); i++) { await B.ev(`__press(13)`); f = await focus(); }
    ok(f === 'sens', '↓ — по строкам: варианты перескакивает целиком, дошли до «Чувствительность»', f);
    const s0 = await B.ev(`D37Settings.get('sens')`);
    await B.ev(`__press(15)`); await sleep(120);
    const s1 = await B.ev(`D37Settings.get('sens')`);
    ok(Math.abs(s1 - s0 - .05) < 1e-6, `→ у ползунка — +5% (${s0} → ${s1})`);
    await B.ev(`__press(14)`); await sleep(120);
    ok(await B.ev(`D37Settings.get('sens')`) === s0, '← — обратно');
    ok(await B.ev(`!!document.querySelector('.gs-set-box.gs-pad')`), 'геймпад — видимая рамка фокуса (gs-pad)');
    // Ⓑ — закрыть окно, фокус — в меню на «Настройки»; Ⓑ ещё раз — меню закрыто
    await B.ev(`__press(1)`); await sleep(250);
    ok(!(await B.ev(`!!document.querySelector('.gs-set')`)) && await focus() === 'settings', 'Ⓑ — окно закрыто, фокус в меню на «Настройки»', await focus());
    await B.ev(`__press(1)`); await sleep(250);
    ok(!(await B.ev(`!!document.querySelector('.gs-menu')`)), 'Ⓑ ещё раз — меню закрыто (игра дальше)');
    ok(await B.ev(`!D37Settings._test.nav().raf`), 'опрос геймпада остановлен (ничего не открыто)');
    // клавиатура: стрелки по меню, Esc в поиске — сначала очищает
    await B.tapSel('.wld-menubtn'); await sleep(250);
    await B.key('ArrowDown', 'ArrowDown'); await sleep(60);
    ok(await focus() === 'settings', 'стрелка ↓ в меню — следующий пункт');
    await B.key('Enter', 'Enter'); await sleep(350);
    // компьютер без сенсорного экрана — фокус сразу в поиске; есть касание (headless Chrome так о себе и говорит) — на ✕
    const touchy = await B.ev(`matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window`);
    ok(await B.ev(`!!document.querySelector('.gs-set') && document.activeElement?.classList.contains(${JSON.stringify(touchy ? 'gs-set-x' : 'gs-set-find')})`), `Enter — окно открыто, фокус ${touchy ? 'на ✕ (есть касание — без экранной клавиатуры)' : 'сразу в поиске'}`);
    if (touchy) await B.ev(`document.querySelector('.gs-set-find').focus()`);
    await B.send('Input.insertText', { text: 'тень' }); await sleep(200);
    const found = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-row')].filter(r => r.offsetParent).map(r => r.querySelector('.gs-lbl b')?.textContent.trim())`);
    ok(found.includes('Тени') && found.includes('Качество теней'), 'поиск «тень» → «Тени», «Качество теней»', found);
    await B.key('Escape', 'Escape'); await sleep(200);
    ok(await B.ev(`!!document.querySelector('.gs-set') && document.querySelector('.gs-set-find').value === '' && !!document.querySelector('.gs-set-tabs .on')`), 'Esc в поиске — очистил поиск, окно осталось');
    await B.key('Escape', 'Escape'); await sleep(200);
    ok(!(await B.ev(`!!document.querySelector('.gs-set')`)) && await B.ev(`!!document.querySelector('.gs-menu')`), 'Esc ещё раз — окно закрыто, меню на месте');
    await B.key('Escape', 'Escape'); await sleep(300);
    ok(!(await B.ev(`!!document.querySelector('.gs-menu')`)), 'Esc — меню закрыто');
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Обзор: снимок каждой вкладки окна ⚙️ в мире и несколько поисков (глазами — понятно ли) ═══
async function tour(screen){
  const B = await chrome(screen);
  try {
    console.log(`Обзор вкладок: ${screen.join(' ')} (${TAG})`);
    await openWorld(B);
    await B.ev(`D37Settings.open({ ctx: 'engine' })`); await sleep(300);
    const tabs = await B.ev(`[...document.querySelectorAll('.gs-set-tabs [data-tab]')].map(b => b.dataset.tab)`);
    for (const id of tabs) {
      await B.ev(`document.querySelector('.gs-set-tabs [data-tab="${id}"]').click()`); await sleep(350);
      const rows = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-row')].map(r => { const b = r.querySelector('.gs-lbl b'), s = r.querySelector('.gs-lbl small'); return [b ? b.textContent.trim() : '', s ? s.getClientRects().length : 0]; })`);
      // подсказка в одну строку: сколько строк занимает <small> (по прямоугольникам строк)
      const lines = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-lbl small')].map(s => { const r = s.getBoundingClientRect(), lh = parseFloat(getComputedStyle(s).lineHeight) || 16; return Math.round(r.height / lh); })`);
      const longs = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-lbl small')].filter(s => s.getBoundingClientRect().height > (parseFloat(getComputedStyle(s).lineHeight) || 16) * 1.5).map(s => s.parentElement.querySelector('b')?.textContent.trim() || '?')`);
      if (longs.length) console.log('    в 2+ строки:', longs.join(' · '));
      console.log(`  ${id}: строк ${rows.length}, подсказок в 1 строку ${lines.filter(n => n <= 1).length}/${lines.length}${lines.some(n => n > 2) ? ' (длинные: ' + lines.filter(n => n > 2).length + ')' : ''}; сброс: ${await B.ev(`(() => { const b = document.querySelector('[data-gs="reset"]'); return b.hidden ? 'нет' : b.textContent; })()`)}`);
      await B.shot('t-' + id);
    }
    for (const q of ['клавиши', 'fps', 'кнопки', 'мышь', 'тормозит', 'звук']) {
      await B.ev(`(() => { const i = document.querySelector('.gs-set-find'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(250);
      const found = await B.ev(`[...document.querySelectorAll('.gs-set-body .gs-row, .gs-set-body .gs-krow')].filter(r => r.offsetParent).map(r => (r.querySelector('.gs-lbl b') || r.querySelector('span'))?.textContent.trim()).filter(Boolean)`);
      console.log(`  поиск «${q}»: ${found.length} — ${found.slice(0, 8).join(' · ')}${found.length > 8 ? ' …' : ''}`);
      if (q === 'кнопки') await B.shot('t-search-knopki');
    }
    ok(!B.errs.length, 'без ошибок страницы', B.errs.slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

// ═══ Что растёт в DOM после открытий окна ⚙️ (по вкладкам) — для разбора ═══
async function diag(){
  const B = await chrome(['pc', 1440, 900]);
  try {
    await B.send('Page.navigate', { url: BASE() + '/#/games' });
    for (let i = 0; i < 60 && !(await B.ev(`!!window.D37Settings && !!document.querySelector('#gamesGrid > *')`)); i++) await sleep(250);
    await sleep(2500); await B.ev(CLEAN);
    const tabs = await B.ev(`(() => { D37Settings.open({ ctx: 'site' }); const t = [...document.querySelectorAll('.gs-set-tabs [data-tab]')].map(b => b.dataset.tab); D37Settings.close(); return t; })()`);
    for (const id of tabs) {
      const r = await B.ev(`(async () => { const wait = ms => new Promise(r => setTimeout(r, ms)), sig = () => { const m = new Map(); for (const e of document.getElementsByTagName('*')) { const k = (e.parentElement ? e.parentElement.tagName + '.' + String(e.parentElement.className).split(' ')[0] + ' > ' : '') + e.tagName + '.' + String(e.className).split(' ')[0]; m.set(k, (m.get(k) || 0) + 1); } return m; };
        const a = sig();
        for (let i = 0; i < 5; i++) { D37Settings.open({ ctx: 'site', tab: ${JSON.stringify(id)} }); await wait(150); D37Settings.close(); await wait(50); }
        const b = sig(), out = {}; for (const [k, v] of b) if (v > (a.get(k) || 0)) out[k] = v - (a.get(k) || 0); return out; })()`);
      console.log(`  вкладка ${id}: +`, JSON.stringify(r));
    }
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  await B.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (MODE === 'diag') { await new Promise(r => server.listen(0, '127.0.0.1', r)); await diag(); server.close(); process.exit(0); }
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const screens = process.env.SCREENS ? JSON.parse(process.env.SCREENS) : [['phone', 390, 844], ['pc', 1440, 900]];
  if (MODE === 'shots' || MODE === 'all') for (const s of screens) await shots(s);
  if (MODE === 'games' || MODE === 'all') for (const s of screens) await games(s);
  if (MODE === 'perf' || MODE === 'all') await perf();
  if (MODE === 'leak' || MODE === 'all') await leak();
  if (MODE === 'pad' || MODE === 'all') await pad();
  if (MODE === 'tour') for (const s of screens) await tour(s);
  server.close();
  console.log(fails ? `✗ ${fails} проверок не прошло` : '✓ всё прошло', '· снимки:', SHOTS);
  process.exit(fails ? 1 : 0);
})();

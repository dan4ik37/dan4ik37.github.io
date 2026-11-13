// 🎮 W9 «клавиши игры» (владелец 13.11: «Esc не игровой и другие клавиши F1–F12»): headless Chrome, загрузки запрещены.
// /hub/play/tribe → мир движка загружен → настоящие нажатия (CDP Input.dispatchKeyEvent) Esc / F1 / F3 / F5 / F2:
//   • сайт их не видит (слушатель на document не получает ни одной клавиши, адрес и разделы те же, модалки не открылись);
//   • Esc открывает паузу игры (движок: game_paused), Esc ещё раз — закрывает; F1 — пауза на странице «Управление»;
//   • F5 не перезагружает страницу; F3 — сведения; F2 — снимок в галерее хаба (IndexedDB 'shots'), без скачивания;
//   • потеря захвата мыши (так браузер «съедает» Esc вне полного экрана) открывает паузу;
//   • пауза → стрелки → «НА САЙТ» → Enter: игра закрыта, адрес /hub.
// Картинки — SHOTS (по умолчанию M:/d37/d37-play/EP9-shots/keys). Запуск: node scripts/hub-keys-e2e.cjs
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/w9/keys/chrome' : os.tmpdir());
const SHOTS = process.env.SHOTS || (fs.existsSync('M:/d37/d37-play') ? 'M:/d37/d37-play/EP9-shots/keys' : path.join(TMP, 'shots'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
async function chrome(){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1366,800', 'about:blank'],
  { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
  };
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); console.log('    картинка ' + path.join(SHOTS, name)); };
  // настоящее нажатие (isTrusted): keyDown + keyUp
  const VK = { Escape: 27, F1: 112, F2: 113, F3: 114, F5: 116, F11: 122, ArrowDown: 40, Enter: 13 };
  const press = async (code) => {
    const key = code, vk = VK[code] || 0;
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (code === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', key, code, text: '\r', windowsVirtualKeyCode: vk });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
  };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, press, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!sbClient && !!window.D37Route && !!window.D37Hub && document.readyState === 'complete'`;
const LOADED = `!!(D37Hub._st.h && D37Hub._st.h.state.loaded)`;
const APP = `D37Hub._st.h.state.app`;
// что видит сайт: адрес, открытые окна сайта, ключи, дошедшие до document
const SITE_STATE = `({ path: location.pathname, mark: window.__keysMark === 1, keys: (window.__siteKeys || []).slice(), modals: document.querySelectorAll('.modal.open, #modal.open, .age-sheet, .gs-set-win, .hub-sheet-bg, #notifPanel.open').length, hub: D37Hub.active === true })`;

(async () => {
  const site = await startSite();
  const C = await chrome();
  try {
    await C.send('Page.navigate', { url: site.base + '/hub' });
    ok(await C.until(READY + ` && document.querySelectorAll('#hub-page .hub-tile').length >= 6`, 60000), 'меню /hub');
    await C.ev(`(D37Route.go('/hub/play/tribe'), true)`);
    const t0 = Date.now();
    const loaded = await C.until(LOADED, 150000);
    ok(loaded, `мир загружен за ${((Date.now() - t0) / 1000).toFixed(1)} с`, await C.ev(`({ errors: D37Hub._st.errors, backend: D37Hub._st.h && D37Hub._st.h.state.backend, game: !!(D37Hub._st.h && D37Hub._st.h.state.game) })`));
    if (!loaded) throw new Error('мир не загрузился');
    ok(await C.ev(`typeof ${APP}.game_paused === 'function' && typeof ${APP}.game_act === 'function'`), 'движок с паузой (game_paused / game_act)');
    await sleep(2500);
    // сайт слушает клавиши на document (как hotkeys.js / modal.js): пока игра живая, сюда не должно дойти ничего
    await C.ev(`(window.__keysMark = 1, window.__siteKeys = [], document.addEventListener('keydown', e => window.__siteKeys.push(e.code)), document.querySelector('.d37h-canvas').focus(), true)`);
    const before = await C.ev(SITE_STATE);

    await C.press('Escape');
    ok(await C.ev(`${APP}.game_paused()`), 'Esc → пауза игры открыта');
    await sleep(300); await C.shot('pause_menu.png');
    await C.press('ArrowDown'); await C.press('Enter');
    await sleep(300); await C.shot('pause_settings.png');
    await C.press('Escape');
    ok(await C.ev(`${APP}.game_paused()`), 'Esc на странице «Настройки» → назад в паузу (пауза открыта)');
    await C.press('Escape');
    ok(await C.ev(`!${APP}.game_paused()`), 'Esc ещё раз → игра продолжается');

    await C.press('F1');
    ok(await C.ev(`${APP}.game_paused()`), 'F1 → помощь (пауза на «Управление»)');
    await sleep(300); await C.shot('help_f1.png');
    await C.press('F1');
    ok(await C.ev(`!${APP}.game_paused()`), 'F1 ещё раз → закрыто');

    await C.press('F3');
    await sleep(700); await C.shot('info_f3.png');
    await C.press('F3');
    await C.press('F5');
    await sleep(900); await C.shot('camera_f5.png');
    await C.press('F5');
    ok(await C.ev(`window.__keysMark === 1 && D37Hub.active === true`), 'F5 не перезагрузил страницу (игра та же)');

    await C.press('F2');
    ok(await C.until(`D37Hub._idb.get('shots').then(l => Array.isArray(l) && l.length >= 1 && l[0].blob instanceof Blob && l[0].blob.size > 1000)`, 8000), 'F2 → снимок в галерее хаба (IndexedDB), без скачивания', await C.ev(`D37Hub._idb.get('shots').then(l => (l || []).map(x => ({ w: x.w, h: x.h, kb: Math.round(x.blob.size / 1024) })))`));

    const after = await C.ev(SITE_STATE);
    ok(after.keys.length === 0, 'сайт не увидел ни одной клавиши (Esc, F1, F2, F3, F5, стрелки, Enter)', after.keys);
    ok(after.path === before.path && after.modals === before.modals && after.hub, 'адрес и окна сайта не изменились', { before, after });

    // браузер отпустил мышь (Esc вне полного экрана: клавиша до страницы не доходит) → пауза игры
    await C.ev(`(() => { const c = document.querySelector('.d37h-canvas'); window.__pl = c; Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => window.__pl }); document.dispatchEvent(new Event('pointerlockchange')); window.__pl = null; document.dispatchEvent(new Event('pointerlockchange')); return true; })()`);
    ok(await C.ev(`${APP}.game_paused()`), 'мышь отпущена браузером → пауза игры');
    await C.ev(`(delete document.pointerLockElement, true)`);
    await sleep(500);   // то же Esc, что отпустило мышь, паузу не закрывает (окно 400 мс)

    // пауза → «НА САЙТ» стрелками → Enter: на сайт
    await C.press('ArrowDown'); await C.press('ArrowDown'); await C.press('ArrowDown'); await C.press('Enter');
    ok(await C.until(`location.pathname === '/hub' && D37Hub.active === false`, 15000), 'пауза → «НА САЙТ» → игра закрыта, адрес /hub', await C.ev(`({ path: location.pathname, active: D37Hub.active })`));
    await sleep(600); await C.shot('back_on_site.png');
    ok(C.errs.length === 0, 'нет ошибок в странице', C.errs.slice(0, 5));
  } catch (e) { ok(false, 'исключение: ' + e.message); }
  finally { await C.close(); site.stop(); }
  console.log(fails ? `ПРОВАЛЕНО: ${fails}` : 'ВСЁ ЗЕЛЁНОЕ');
  process.exit(fails ? 1 : 0);
})();

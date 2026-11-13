// 🎮 Платформа D37 (/hub): W8 — одно «Играть» (продолжить свой мир), «Новый мир» / «Пропустить к племени», выбор места появления
// («Где я был» / «Домой в лагерь» / «С орбиты»), панель «Путь» (Клетка → … → Космос, текущий шаг — из сохранения), «Творческий режим».
// Настоящий Chrome (headless, без npm, загрузки запрещены), телефон и ПК, тёмная и светлая. Движок здесь не проверяется (это
// hub-e2e.cjs): только меню и что адреса /hub/play/<где> доходят до игры (D37Hub._st.opt).
//   node scripts/hub-path-e2e.cjs            (картинки — SHOTS, по умолчанию M:/d37/claude-tmp/w8/hub)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/w8/hub' : os.tmpdir());
const SHOTS = process.env.SHOTS || TMP;
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
    '--disable-background-timer-throttling', '--window-size=1366,800', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
    if (d.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: false }).catch(() => {});
  };
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); console.log('    картинка ' + path.join(SHOTS, name)); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, view, shot, close, errs };
}
const READY = `!!window.D37Route && !!window.D37Hub && document.readyState === 'complete' && !!document.querySelector('#hub-page [data-tile="play"] .hub-path')`;
const CARD = `(() => { const c = document.querySelector('[data-tile="play"]'); if (!c) return null; return {
  tt: c.querySelector('.hub-tt').textContent, cont: c.querySelector('.hub-cont').textContent, main: c.querySelector('.hub-play-main').getAttribute('href'),
  chips: [...c.querySelectorAll('a.hub-chip')].map(a => a.getAttribute('href')), steps: c.querySelectorAll('.hub-path-s').length,
  on: (c.querySelector('.hub-path-s.on .hub-path-n') || {}).textContent || '', done: c.querySelectorAll('.hub-path-s.done').length,
  creative: (document.querySelector('[data-tile="planet"] .hub-tt') || {}).textContent || '', overflow: document.documentElement.scrollWidth > innerWidth + 1 }; })()`;
// сохранение мира как у движка (байты SaveV1 с разделом игры: «"progress": "(v:1,stage:2,era:1,…»)
const FAKE_SAVE = `D37Hub._idb.put('planet', { bytes: new TextEncoder().encode('D37S\\u0001\\u0000GAME"progress": "(v:1,stage:2,era:1,field:1,deeds:[],crafted:[plank],heritage:[],journal:[])"'), at: Date.now(), gt: 1500, cloud: { on: false, ver: null } })`;

(async () => {
  const site = await startSite();
  const C = await chrome();
  try {
    for (const [w, h, mob, tag] of [[1366, 860, false, 'pc'], [390, 844, true, 'phone']]) {
      await C.view(w, h, mob);
      for (const theme of ['dark', 'light']) {
        await C.send('Page.navigate', { url: site.base + '/hub' });
        await sleep(400);
        await C.ev(`(localStorage.setItem('d37_theme', ${JSON.stringify(theme)}), true)`);
        await C.send('Page.reload');
        ok(await C.until(READY, 60000), `${tag} ${theme}: меню /hub`);
        // без сохранения (как в первый раз)
        await C.ev(`(async () => { await D37Hub._idb.put('planet', null); D37Hub.render(''); return true; })()`);
        await C.until(`(${CARD}) && (${CARD}).tt === 'Новый мир'`, 6000);
        const a = await C.ev(CARD);
        ok(a && a.tt === 'Новый мир' && a.main === '/hub/play/new' && a.chips.join() === '/hub/play/tribe', `${tag} ${theme}: сохранения нет — «Новый мир» (с клетки) и «Пропустить к племени»`, a);
        ok(a && a.steps === 7 && a.on === '' && a.creative === 'Творческий режим' && !a.overflow, `${tag} ${theme}: «Путь» из 7 шагов, ничего не горит; плитка «Творческий режим»; нет прокрутки вбок`, a);
        await C.shot(`hub-${tag}-${theme}-new.png`);
        await C.ev(`(async () => { await ${FAKE_SAVE}; D37Hub.render(''); return true; })()`);
        await C.until(`(${CARD}) && (${CARD}).tt === 'Играть'`, 6000);
        const b = await C.ev(CARD);
        ok(b && b.tt === 'Играть' && /Продолжить мой мир · 25 мин/.test(b.cont) && b.main === '/hub/play', `${tag} ${theme}: есть мир — «▶ Продолжить мой мир»`, b);
        ok(b && b.chips.join() === '/hub/play,/hub/play/home,/hub/play/orbit', `${tag} ${theme}: где появиться — «Где я был» / «Домой в лагерь» / «С орбиты»`, b && b.chips);
        ok(b && b.on === 'Посёлок' && b.done === 3 && !b.overflow, `${tag} ${theme}: «Путь» — горит «Посёлок» (стадия 2, эпоха E1 из сохранения)`, b);
        await C.ev(`window.scrollTo(0, 0), true`);
        await C.shot(`hub-${tag}-${theme}-continue.png`);
      }
    }
    // адреса доходят до игры: где начать (движок не ждём — сразу назад в меню)
    await C.view(1366, 860, false);
    for (const [url, want] of [['/hub/play/home', 'home'], ['/hub/play/orbit', 'orbit'], ['/hub/play', '']]) {
      await C.ev(`(D37Route.go(${JSON.stringify(url)}), true)`);
      const got = await C.until(`D37Hub._st.mode === 'play' && D37Hub._st.opt === ${JSON.stringify(want)}`, 8000);
      ok(got, `${url} → игра, место: «${want || 'где был'}»`, await C.ev(`[D37Hub._st.mode, D37Hub._st.opt]`));
      await C.ev(`(D37Route.go('/hub'), true)`);
      await C.until(`!D37Hub.active`, 15000);
    }
    // новый мир поверх сохранённого: «нет» в вопросе — продолжаем свой; «да» — новый мир
    await C.ev(`(window.confirm = () => false, D37Route.go('/hub/play/new'), true)`);
    ok(await C.until(`D37Hub._st.mode === 'play' && D37Hub._st.opt === ''`, 8000), '/hub/play/new при сохранении, ответ «нет» → свой мир');
    await C.ev(`(D37Route.go('/hub'), true)`); await C.until(`!D37Hub.active`, 15000);
    await C.ev(`(window.confirm = () => true, D37Route.go('/hub/play/tribe'), true)`);
    ok(await C.until(`D37Hub._st.mode === 'play' && D37Hub._st.opt === 'tribe'`, 8000), '/hub/play/tribe, ответ «да» → новый мир с племени');
    await C.ev(`(D37Route.go('/hub'), true)`); await C.until(`!D37Hub.active`, 15000);
    const errs = C.errs.filter(e => !/WebGPU|webgpu|adapter|wasm|GPU/i.test(e));
    ok(errs.length === 0, 'нет ошибок JS на странице', errs.slice(0, 5));
  } catch (e) { ok(false, 'исключение: ' + (e && e.stack || e)); }
  finally { await C.close(); site.stop(); }
  console.log(fails ? `hub-path-e2e: ${fails} упало` : 'hub-path-e2e: всё прошло');
  process.exit(fails ? 1 : 0);
})();

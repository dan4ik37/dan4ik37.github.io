// Боевая зона «Мира Денчика» в настоящем Chrome (headless, без npm): нижняя панель оружия отвечает на касание и клик.
// Владелец 22.10: «почему нижняя панель ни за что не отвечает?» — на телефоне стоя очки «Каждый сам за себя» лежали поверх
// ячеек 2–5 (ловили нажатия), а кнопки телефона заходили под панель. Проверки на экранах: телефон 412×915 и 360×780, лёжа 915×412 и
// 780×360, планшет 768×1024 (касание), ПК 1280×800 (мышь): ячейки целиком свободны (середина и углы), не на кнопках телефона,
// жизни — тоже; нажатие по ячейке 2, 4, 5, 3, 1 → выбрано это оружие. Снимки — в D37_TMP (иначе E:\claude-tmp, иначе системная).
// Запуск из корня сайта: node scripts/war-hud-e2e.cjs   (SCREENS='[["phone",360,780]]' — свои экраны; CHROME — путь к Chrome)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const SITE = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/' || p.startsWith('/play/')) p = '/index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
const SCREENS = process.env.SCREENS ? JSON.parse(process.env.SCREENS) : [['phone', 412, 915], ['phone', 360, 780], ['phone', 915, 412], ['phone', 780, 360], ['phone', 768, 1024], ['pc', 1280, 800]];
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://localhost:' + server.address().port;
  let fails = 0;
  const ok = (c, m, x) => { console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined && !c ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
  for (const [mode, VW, VH] of SCREENS) {
    const port = 9300 + Math.floor(Math.random() * 400), profile = fs.mkdtempSync(path.join(TMP, 'd37-warhud-'));
    const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--ignore-gpu-blocklist', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
    let page = null;
    for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
    if (!page) { ok(false, 'Chrome не запустился'); proc.kill(); continue; }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const cb = new Map(), errs = [];
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; } if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || '').slice(0, 300)); };
    const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    try {
      console.log((mode === 'phone' ? 'Касание ' : 'Мышь ') + VW + '×' + VH);
      await send('Page.enable'); await send('Runtime.enable');
      if (mode === 'phone') {
        await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 2, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
      } else await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
      const ls = { d37_perf: 'high', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_settings: JSON.stringify({ gfxPreset: 'low', gfx: 'low' }), d37_gfx: 'low' };
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}localStorage.removeItem('d37_mir_pos');}catch(e){}` });
      await send('Page.navigate', { url: BASE + '/#/games/world' });
      let up = false; for (let i = 0; i < 240 && !up; i++) { await sleep(500); try { up = await ev(`!!(window.GAME_IMPL?.world?._test?.state()?.zones?.wmv)`); } catch (e) {} }
      // в боевую зону (12+: проверка возраста — как у взрослого), в середину
      const st = await ev(`(async () => { const A = window.D37Age; if (A) { A.known = () => true; A.canOpen = () => true; A.allows = () => true; A.group = () => 'adult'; }
        const S = GAME_IMPL.world._test.state(), z = S.zones, C = MirWar.CENTER; S.fixedTime = 13;
        const zs = z.zoneState('war'); if (!zs.ready) await z.buildNow(zs);
        S.P.place((C.x0 + C.x1) / 2, MirZones.terrain((C.x0 + C.x1) / 2, C.z0 + 4) + .4, C.z0 + 4, 0);
        for (let i = 0; i < 60 && !(document.querySelector('.mz-war') && !document.querySelector('.mz-war').hidden); i++) await new Promise(r => setTimeout(r, 150));
        await new Promise(r => setTimeout(r, 1500));
        document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast,.wld-panel').forEach(e => e.remove());
        const war = document.querySelector('.mz-war');
        return { inZone: !!(war && !war.hidden), n: document.querySelectorAll('.mz-wpn button').length };
      })()`);
      ok(st.inZone && st.n === 5, 'в зоне: панель оружия на экране', st);
      const bad = await ev(`(() => { const btns = [...document.querySelectorAll('.e-btn')].filter(b => !b.hidden && b.getBoundingClientRect().width).map(b => b.getBoundingClientRect()), bad = [];
        [...document.querySelectorAll('.mz-wpn button')].forEach((b, i) => { const r = b.getBoundingClientRect();
          for (const [x, y] of [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]]) { const el = document.elementFromPoint(x, y); if (!el || el.closest('.mz-wpn button') !== b) bad.push({ slot: i + 1, at: [Math.round(x), Math.round(y)], top: el ? String(el.className || el.tagName) : null }); }
          for (const q of btns) if (q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top) bad.push({ slot: i + 1, overlap: 'кнопка телефона' }); });
        const hp = document.querySelector('.mz-hp')?.getBoundingClientRect(); if (hp) for (const q of btns) if (q.left < hp.right && q.right > hp.left && q.top < hp.bottom && q.bottom > hp.top) bad.push({ hp: 'жизни на кнопке телефона' });
        return bad; })()`);
      ok(!bad.length, 'ячейки целиком свободны (середина и углы), не на кнопках телефона; жизни — тоже', bad.slice(0, 6));
      const pts = await ev(`[...document.querySelectorAll('.mz-wpn button')].map(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })`);
      const sel = () => ev(`[...document.querySelectorAll('.mz-wpn button')].findIndex(b => b.classList.contains('on'))`);
      for (const k of [1, 3, 4, 2, 0]) {
        const [x, y] = pts[k];
        if (mode === 'phone') {
          await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(60);
          await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await sleep(40);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        }
        await sleep(250);
        const s = await sel();
        ok(s === k, `${mode === 'phone' ? 'касание' : 'клик'} по ячейке ${k + 1} → выбрано оружие ${k + 1}`, { выбрано: s + 1 });
      }
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
      fs.writeFileSync(path.join(TMP, `war-hud-${mode}-${VW}x${VH}.jpg`), Buffer.from(shot.data, 'base64'));
    } catch (e) { ok(false, 'исключение: ' + e.message); }
    ok(!errs.length, 'без ошибок страницы', errs.slice(0, 3));
    ws.close(); proc.kill(); await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
  server.close();
  console.log(fails ? `✗ ${fails} проверок не прошло` : '✓ всё прошло', '· снимки:', TMP);
  process.exit(fails ? 1 : 0);
})();

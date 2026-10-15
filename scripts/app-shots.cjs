// Снимки экрана для окна установки приложения (manifest.json → screenshots): ПК (wide, 1920×1080) и телефон (narrow,
// 1080×1920) — настоящий сайт в headless Chrome через DevTools Protocol, без npm-пакетов (WebSocket встроен в Node 22+).
// Запуск: python scripts/serve.py 5555   (в другом окне), потом   node scripts/app-shots.cjs http://localhost:5555
// Chrome: переменная CHROME или стандартный путь Windows. Снимки — img/app/shot-*.webp (вписаны в manifest.json).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = (process.argv[2] || 'http://localhost:5555').replace(/\/+$/, '');
const OUT = path.join(__dirname, '..', 'img', 'app');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

// что снимать: [файл, адрес, ширина, высота, масштаб, телефон, ждать мс]
const SHOTS = [
  ['shot-wide-home.webp', '/#/home', 1280, 720, 1.5, false, 4500],
  ['shot-wide-games.webp', '/#/games', 1280, 720, 1.5, false, 4500],
  ['shot-wide-world.webp', '/#/games/world', 1280, 720, 1.5, false, 15000],
  ['shot-narrow-home.webp', '/#/home', 360, 640, 3, true, 4500],
  ['shot-narrow-games.webp', '/#/games', 360, 640, 3, true, 4500],
  ['shot-narrow-kosynka.webp', '/#/games/kosynka', 360, 640, 3, true, 5000],
];

(async () => {
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-shots-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 60 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился: ' + CHROME); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), subs = new Set();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [ok, bad] = cb.get(d.id); cb.delete(d.id); d.error ? bad(new Error(d.error.message)) : ok(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  const load = url => new Promise(res => { const f = d => { if (d.method === 'Page.loadEventFired') { subs.delete(f); res(); } }; subs.add(f); send('Page.navigate', { url }); setTimeout(res, 20000); });
  await send('Page.enable'); await send('Runtime.enable');
  // чистый вид: без окошка возраста и карточки «установи», мощный режим, без звука
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_perf','high');localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  try {
    const only = process.argv[3] ? new RegExp(process.argv[3]) : null;   // node scripts/app-shots.cjs <адрес> world — снять только подходящие
    for (const [file, url, w, h, dpr, mobile, wait] of SHOTS) {
      if (only && !only.test(file)) continue;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
      await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await send('Emulation.setUserAgentOverride', { userAgent: mobile ? PHONE : '' });
      await load(BASE + '/?shot=' + Date.now() + url);
      await sleep(wait || 4500);
      await send('Runtime.evaluate', { expression: `document.querySelectorAll('.age-sheet,#appCard,.apu,.apt,.notif-toast,.chat-toast').forEach(e=>e.remove());window.scrollTo(0,0);1` });
      await sleep(600);
      const r = await send('Page.captureScreenshot', { format: 'webp', quality: 82 });
      fs.writeFileSync(path.join(OUT, file), Buffer.from(r.data, 'base64'));
      console.log(file, Math.round(Buffer.from(r.data, 'base64').length / 1024) + ' КБ');
    }
  } finally {
    ws.close(); proc.kill(); await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})().catch(e => { console.error(e); process.exit(1); });

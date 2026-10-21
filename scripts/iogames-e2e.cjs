// «Клеточки» и «Червячки» в настоящем Chrome (headless, DevTools Protocol, без npm): снимки меню и игры (ПК и телефон), ошибки в
// консоли, замер «телефона» — CPU ×4 медленнее, 412×915, полная комната (16 участников, вся еда) и хозяин шлёт снимки 9 гостям:
// время кадра (шаги + рисунок), кадров в секунду, размер снимков, память до/после.
// Запуск: python scripts/serve.py 5571   (в другом окне), потом   node scripts/iogames-e2e.cjs http://localhost:5571 [kletochki|chervyachki] [сек]
// Снимки — E:\claude-tmp\iogames\shots (диск C у владельца почти полный — профиль Chrome тоже на E).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const BASE = (process.argv[2] || 'http://localhost:5571').replace(/\/+$/, '');
const ONLY = process.argv[3] && process.argv[3] !== 'all' ? [process.argv[3]] : ['kletochki', 'chervyachki'];
const SECS = +process.argv[4] || 12;
const TMP = 'E:/claude-tmp/iogames', OUT = path.join(TMP, 'shots');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const port = 9600 + Math.floor(Math.random() * 300);
  const profile = path.join(TMP, 'chrome-' + Date.now().toString(36));
  fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился: ' + CHROME); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const cb = new Map(), subs = new Set();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [ok, bad] = cb.get(d.id); cb.delete(d.id); d.error ? bad(new Error(d.error.message)) : ok(d.result); } else if (d.method) subs.forEach(f => f(d)); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; cb.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result.value; };
  const errors = [];
  subs.add(d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('d37_age_ask',String(Date.now()+864e6));localStorage.setItem('d37_perf','high');localStorage.setItem('d37_app',JSON.stringify({x:1,v:1}));localStorage.setItem('d37_games_mute','1')}catch(e){}` });
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); return name; };
  const go = async url => { await send('Page.navigate', { url }); await sleep(600); };
  const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const report = {};
  try {
    for (const g of ONLY) {
      const R = report[g] = { shots: [] };
      // ПК: меню и игра с ботами
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
      await go(`${BASE}/#/games/${g}`);
      R.menu = await waitFor(`!!document.querySelector('[data-io="bots"]')`);
      await sleep(800);
      R.shots.push(await shot(`${g}-menu-pc.png`));
      await ev(`document.querySelector('[data-io="bots"]').click(), 1`);
      R.play = await waitFor(`!!(window.GAME_IMPL?.${g}?._test?.S?.W)`);
      await sleep(7000);
      R.shots.push(await shot(`${g}-play-pc.png`));
      // телефон: сразу игра с ботами
      await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await go(`${BASE}/#/home`); await sleep(300);
      await go(`${BASE}/#/games/${g}/bots`);
      R.phone = await waitFor(`!!(window.GAME_IMPL?.${g}?._test?.S?.W)`);
      await sleep(5000);
      R.shots.push(await shot(`${g}-play-phone.png`));
      // замер: CPU ×4, полная комната, хозяин шлёт снимки 9 гостям
      await send('HeapProfiler.enable');
      await send('HeapProfiler.collectGarbage');
      const heap0 = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
      await send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await ev(`(window.__st = GAME_IMPL.${g}._test.stress({ guests: 9 })) ? 1 : 0`);
      await sleep(2000);
      await ev('window.__st.n = 0, window.__st.bytes = 0, window.__st.snaps = 0, 1');
      await sleep(SECS * 1000);
      const P = await ev(`(() => { const s = window.__st, a = Array.from(s.ms.subarray(0, s.n)).sort((x, y) => x - y), q = k => a[Math.min(a.length - 1, Math.floor(a.length * k))];
        const dur = (s.t[s.n - 1] - s.t[0]) / 1000; const V = GAME_IMPL.${g}._test.S.W;
        return { frames: s.n, fps: +(s.n / dur).toFixed(1), avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), p99: +q(.99).toFixed(2), max: +a[a.length - 1].toFixed(2),
          snapAvg: Math.round(s.bytes / Math.max(1, s.snaps)), kbps9: +(s.bytes / 1024 / dur).toFixed(1), owners: V.owners.filter(Boolean).length,
          part: ['dr', 'en', 'st'].map(k => { const b = Array.from(s[k].subarray(0, s.n)).sort((x, y) => x - y); return k + ' avg ' + (b.reduce((x, y) => x + y, 0) / b.length).toFixed(2) + ' p99 ' + b[Math.floor(b.length * .99)].toFixed(1) + ' max ' + b[b.length - 1].toFixed(1); }) }; })()`);
      await send('Emulation.setCPUThrottlingRate', { rate: 1 });
      R.shots.push(await shot(`${g}-stress-phone.png`));
      await send('HeapProfiler.collectGarbage');
      const heap1 = await ev('performance.memory ? performance.memory.usedJSHeapSize : 0');
      R.perf = { ...P, heapMB0: +(heap0 / 1048576).toFixed(1), heapMB1: +(heap1 / 1048576).toFixed(1) };
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  } catch (e) { report.error = String(e.stack || e); }
  report.errors = errors;
  console.log(JSON.stringify(report, null, 1));
  try { ws.close(); } catch (e) {}
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
})();

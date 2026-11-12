// T-141 «наш Дискорд»: замеры в настоящем Chrome (headless, без npm), профиль телефона (412×915, ЦП ×4), загрузки запрещены.
// Режимы: nav   — переходы по разделам сайта: время от перехода до первого кадра нового раздела и длинные задачи (медианы; TAG=before|after)
//         leak  — 20× открыть / закрыть чат (#/chat ↔ главная) и 20× мини-карточку: память после GC, слушатели window/document,
//                 каналы Realtime (sbClient.getChannels) — должны стоять на месте
//         video — плеер в чате играет ролик 2 минуты: кадры > 50 мс в минуту (длинные задачи страницы)
//         soak  — 10 минут в чате (переходы по каналам, прокрутка): ошибки в консоли = 0
// Данные — настоящий Supabase, только чтение, без входа (ничего не пишем). Сайт — scripts/serve.py на свободном порту или BASE=…
// Запуск (тяжёлое — под замком): node E:\d37-core\scripts\heavy-lock.mjs run --session site --job t141 --min 15 -- node scripts/t141-e2e.cjs nav
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('E:/claude-tmp') ? 'E:/claude-tmp/t141' : os.tmpdir());
const MODE = process.argv[2] || 'nav';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const med = a => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const r1 = v => Math.round(v * 10) / 10;
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
async function chrome(cpu = 4){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9600 + Math.floor(Math.random() * 600), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, api) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, includeCommandLineAPI: !!api }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (cpu > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const L = { d37_perf: 'low', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}
    window.__lt=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([e.startTime,e.duration])}).observe({type:'longtask',buffered:true})}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(100); } return false; };
  const heap = async () => { await ev('window.gc&&gc()'); await sleep(200); await ev('window.gc&&gc()'); const h = await send('Runtime.getHeapUsage'); return h.usedSize; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, heap, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!sbClient && !!window.D37Route && document.readyState === 'complete'`;
// Переход: от смены адреса до первого кадра после события d37:route (2 rAF) + сумма длинных задач за 1,5 с
const NAV = h => `(async () => {
  const lt0 = window.__lt.length, t0 = performance.now();
  let tr = 0; const f = () => { tr = performance.now(); }; addEventListener('d37:route', f, { once: true });
  D37Route.go(${JSON.stringify(h)});
  for (let i = 0; i < 200 && !tr; i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const frame = performance.now() - t0;
  await new Promise(r => setTimeout(r, 1500));
  const lts = window.__lt.slice(lt0).filter(x => x[0] >= t0 - 5);
  return { frame, long: lts.reduce((s, x) => s + x[1], 0), max: lts.reduce((m, x) => Math.max(m, x[1]), 0) };
})()`;
(async () => {
  const site = await startSite();
  const C = await chrome(+(process.env.CPU || 4));
  try {
    await C.send('Page.navigate', { url: site.base + '/' });
    ok(await C.until(READY, 40000), 'сайт загрузился');
    await sleep(5000);
    if (MODE === 'nav') {
      const ROUTES = (process.env.ROUTES || '/chat,/,/play,/chat,/about,/').split(',');
      const res = {};
      for (let run = 0; run < +(process.env.RUNS || 4); run++) for (const h of ROUTES) { const r = await C.ev(NAV(h)); (res[h] = res[h] || []).push(r); }
      const all = Object.values(res).flat();
      const out = { tag: process.env.TAG || 'after', frameMed: r1(med(all.map(x => x.frame))), longMed: r1(med(all.map(x => x.long))), per: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { frame: r1(med(v.map(x => x.frame))), long: r1(med(v.map(x => x.long))) }])) };
      console.log(JSON.stringify(out));
      fs.writeFileSync(path.join(TMP, `nav-${out.tag}.json`), JSON.stringify(out, null, 1));
      ok(!C.errs.length, 'ошибок в консоли нет', C.errs.slice(0, 3));
    } else if (MODE === 'prof') {
      // где тратится время перехода: профиль ЦП одного перехода (PROF_TO), самые дорогие функции (собственное время)
      const to = process.env.PROF_TO || '/play';
      for (const h of (process.env.PROF_PRE || to + ',/').split(',')) await C.ev(NAV(h));
      await C.send('Profiler.enable'); await C.send('Profiler.setSamplingInterval', { interval: 200 }); await C.send('Profiler.start');
      const r = await C.ev(NAV(to));
      const { profile } = await C.send('Profiler.stop');
      const self = new Map(), dtm = profile.timeDeltas || [], byId = new Map(profile.nodes.map(n => [n.id, n]));
      profile.samples.forEach((id, i) => { const n = byId.get(id), f = n.callFrame, k = (f.functionName || '(anon)') + ' ' + (f.url || '').split('/').slice(-1)[0] + ':' + (f.lineNumber + 1); self.set(k, (self.get(k) || 0) + (dtm[i] || 0) / 1000); });
      console.log(JSON.stringify(r)); console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => r1(v) + 'ms ' + k).join(String.fromCharCode(10)));
    } else if (MODE === 'leak') {
      const probe = async () => ({ heap: await C.heap(), lw: await C.ev(`Object.values(getEventListeners(window)).reduce((s,a)=>s+a.length,0)`, true), ld: await C.ev(`Object.values(getEventListeners(document)).reduce((s,a)=>s+a.length,0)`, true), ch: await C.ev(`sbClient.getChannels?.().length||0`), nodes: await C.ev('document.getElementsByTagName("*").length') });
      await C.ev(NAV('/chat')); await sleep(3000); await C.ev(NAV('/')); await sleep(1500);
      const a = await probe();
      for (let i = 0; i < 20; i++) { await C.ev(NAV('/chat')); await sleep(1200); await C.ev(NAV('/')); await sleep(600); }
      const b = await probe();
      console.log('chat 20×', JSON.stringify({ a, b }));
      ok(b.heap - a.heap < 2 * 1048576, `чат 20×: память +${r1((b.heap - a.heap) / 1048576)} МБ (≤ 2)`);
      ok(b.lw - a.lw <= 2 && b.ld - a.ld <= 2, 'чат 20×: слушатели window/document на месте', [a.lw, b.lw, a.ld, b.ld]);
      ok(b.ch <= a.ch + 1, 'чат 20×: каналы Realtime на месте', [a.ch, b.ch]);
      const uid = await C.ev(`(async()=>{const {data}=await (await sbProfiles()).select('id').limit(1);return data?.[0]?.id||''})()`);
      const m0 = await probe();
      for (let i = 0; i < 20; i++) { await C.ev(`D37Mini.open(${JSON.stringify(uid)},{nick:'x'})`); await sleep(500); await C.ev('D37Mini.close()'); await sleep(150); }
      const m1 = await probe();
      ok(m1.heap - m0.heap < 2 * 1048576 && m1.lw - m0.lw <= 1 && m1.ld - m0.ld <= 1, `мини-карточка 20×: память +${r1((m1.heap - m0.heap) / 1048576)} МБ, слушатели на месте`, [m0.lw, m1.lw, m0.ld, m1.ld]);
      ok(!C.errs.length, 'ошибок в консоли нет', C.errs.slice(0, 3));
    } else if (MODE === 'video') {
      await C.ev(NAV('/chat')); await sleep(4000);
      const id = await C.ev(`(typeof allVids!=='undefined'&&allVids.find(v=>D37Player.videoOk(v.id).ok)?.id)||''`);
      ok(!!id, 'есть ролик из ленты', id);
      await C.ev(`D37Player.open({kind:'yt',id:${JSON.stringify(id)}})`);
      await sleep(8000);
      const n0 = await C.ev('window.__lt.length'), t0 = Date.now();
      await sleep(+(process.env.SEC || 120) * 1000);
      const lts = await C.ev(`window.__lt.slice(${n0}).map(x=>x[1])`);
      const min = (Date.now() - t0) / 60000, over = lts.filter(d => d > 50).length;
      const st = await C.ev('JSON.stringify(D37Player.wt?.())');
      console.log(JSON.stringify({ min: r1(min), over50: over, perMin: r1(over / min), max: r1(Math.max(0, ...lts)), wt: st }));
      ok(over / min <= 1, `кадров > 50 мс: ${r1(over / min)} в минуту (≤ 1)`);
      ok(!C.errs.length, 'ошибок в консоли нет', C.errs.slice(0, 3));
    } else if (MODE === 'soak') {
      await C.ev(NAV('/chat')); await sleep(4000);
      const end = Date.now() + +(process.env.MIN || 10) * 60000; let i = 0;
      while (Date.now() < end) {
        await C.ev(`(()=>{const a=[...document.querySelectorAll('.ds-chans [href*="/chat"],.ds-chans a')];const x=a[(Math.random()*a.length|0)];x&&x.click();const b=document.querySelector('.mv-list,.ds-body');if(b)b.scrollTop=Math.random()*b.scrollHeight;return a.length})()`).catch(() => 0);
        await sleep(15000); i++;
      }
      console.log(JSON.stringify({ steps: i, errs: C.errs.slice(0, 5) }));
      ok(!C.errs.length, `10 минут в чате (${i} шагов): ошибок в консоли нет`, C.errs.slice(0, 3));
    }
  } catch (e) { console.error(e); fails++; }
  finally { await C.close(); site.stop(); }
  console.log(fails ? `t141-e2e ${MODE}: ${fails} FAIL` : `t141-e2e ${MODE}: OK`);
  process.exit(fails ? 1 : 0);
})();

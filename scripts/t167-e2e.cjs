// T-167: голос и камера в настоящем Chrome (headless, ненастоящие камера и микрофон Chrome, загрузки запрещены, без входа, без записи в базу).
//  1) «🎛 Проверка»: список устройств, уровень микрофона, картинка камеры (возраст 16 — можно), выбор запоминается, после закрытия
//     камера и микрофон выключены; 20 раз открыть / закрыть — ни одной включённой дорожки;
//  2) двое в одной комнате (настоящий Supabase Realtime, случайный код): время соединения; камера у одного → у второго плитка с видео;
//     ограничение видео по числу людей; перезапуск ICE (вместо обрыва сети: DevTools не умеет рвать WebRTC) — время и успех;
//  3) черновик сообщения остаётся у канала; ошибок JS нет. Профиль телефона у первого (390x844, касания, CPU ×4).
// Запуск из корня сайта: node scripts/t167-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t167-ds2' : os.tmpdir());
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
async function chrome(phone){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const y = new Date().getFullYear() - 17;
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1', d37_age: JSON.stringify({ y, s: 'g', fa: Date.now() - 40 * 864e5 }) };
  // все включённые дорожки камеры / микрофона — в список (проверка «после закрытия всё выключено»)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}
    window.__trk=[];(()=>{const md=navigator.mediaDevices;if(!md)return;const g=md.getUserMedia.bind(md);md.getUserMedia=async c=>{const s=await g(c);s.getTracks().forEach(t=>__trk.push(t));return s;};})();` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Phone && document.readyState === 'complete'`;

(async () => {
  const site = await startSite();
  const A = await chrome(true), B = await chrome(false);
  try {
    await Promise.all([A.send('Page.navigate', { url: site.base + '/' }), B.send('Page.navigate', { url: site.base + '/' })]);
    ok(await A.until(READY, 40000) && await B.until(READY, 40000), 'сайт загрузился в двух Chrome');
    // 1) проверка устройств
    await A.ev(`D37Phone.open('devcheck'), 1`);
    ok(await A.until(`!!document.querySelector('.dc [data-dc-a="mic"]')`, 20000), '🎛 Проверка открылась (телефон 📱 → devcheck)');
    await A.ev(`document.querySelector('[data-dc-a="mic"]').click(), 1`);
    ok(await A.until(`parseFloat(document.querySelector('.dc-meter i')?.style.width || 0) > 0`, 15000), 'уровень микрофона двигается');
    ok(await A.ev(`!!document.querySelector('[data-dc="camId"]')`), 'камера доступна (возраст 16)');
    await A.ev(`document.querySelector('[data-dc-a="cam"]').click(), 1`);
    ok(await A.until(`(document.querySelector('.dc-cam video')?.videoWidth || 0) > 0`, 15000), 'картинка с камеры видна');
    const opts = await A.ev(`[...document.querySelectorAll('[data-dc="micId"] option')].map(o => o.textContent).length`);
    ok(opts >= 1, 'список микрофонов с названиями', opts);
    await A.ev(`(() => { const s = document.querySelector('[data-dc="micId"]'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    ok(await A.until(`!!D37Phone.set.micId`, 5000), 'выбор микрофона запомнился (d37_phone)');
    await A.ev(`document.querySelector('[data-dc-a="tone"]').click(), 1`);
    await A.ev(`D37Phone.close?.() ?? D37Phone.back?.(), 1`); await sleep(800);
    ok(await A.ev(`window.__trk.filter(t => t.readyState === 'live').length`) === 0, 'после закрытия камера и микрофон выключены');
    for (let i = 0; i < 20; i++) {
      await A.ev(`D37Phone.open('devcheck'), 1`); await A.until(`!!document.querySelector('[data-dc-a="mic"]')`, 8000);
      await A.ev(`document.querySelector('[data-dc-a="mic"]').click(), 1`); await A.until(`window.__trk.some(t => t.readyState === 'live')`, 8000);
      await A.ev(`D37Phone.close?.() ?? D37Phone.back?.(), 1`); await sleep(150);
    }
    await sleep(500);
    ok(await A.ev(`window.__trk.filter(t => t.readyState === 'live').length`) === 0, '20 раз открыть / закрыть проверку — ни одной включённой дорожки', await A.ev(`window.__trk.length`));
    // 2) двое в одной комнате
    const code = 't167' + Math.random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, 'a');
    await Promise.all([A.ev(`D37Phone.need('calls').then(() => 1)`), B.ev(`D37Phone.need('calls').then(() => 1)`)]);
    const t0 = Date.now();
    const [ra, rb] = await Promise.all([A.ev(`D37Calls._test.party(${JSON.stringify(code)}, 'Телефон', true)`), B.ev(`D37Calls._test.party(${JSON.stringify(code)}, 'Компьютер', true)`)]);
    ok(ra === true && rb === true, 'оба вошли в комнату', [ra, rb]);
    const conn = await A.until(`(D37Calls._test.net()?.peers || []).some(p => p.state === 'ok')`, 45000) && await B.until(`(D37Calls._test.net()?.peers || []).some(p => p.state === 'ok')`, 20000);
    const tWall = Date.now() - t0, tcA = await A.ev(`D37Calls._test.net().peers[0]?.tc`), tcB = await B.ev(`D37Calls._test.net().peers[0]?.tc`);
    ok(conn, 'соединились напрямую', { wall_ms: tWall, pc_ms: [tcA, tcB] });
    console.log('    ВРЕМЯ СОЕДИНЕНИЯ: от входа обоих ' + tWall + ' мс; RTCPeerConnection: ' + tcA + ' / ' + tcB + ' мс');
    ok(await A.until(`(() => { const R = D37Calls._test.room(); const p = R && [...R.peers.values()][0]; if (!p?.an) return false; p.an.an.getFloatTimeDomainData(p.an.buf); return p.an.buf.some(v => Math.abs(v) > 0.001); })()`, 15000), 'звук собеседника доходит (уровень > 0)');
    await B.ev(`D37Calls.camToggle(), 1`);
    ok(await B.until(`!!D37Calls._test.room().camTrack`, 10000), 'камера включилась у второго');
    await A.ev(`D37Phone.open('incall'), 1`);
    ok(await A.until(`(document.querySelector('.vc-tile.vid video')?.videoWidth || 0) > 0`, 20000), 'у первого (телефон) — плитка с видео второго');
    const enc = await B.ev(`(() => { const p = [...D37Calls._test.room().peers.values()][0]; const e = p?.vt?.sender?.getParameters?.().encodings?.[0]; return e ? e.maxBitrate : null; })()`);
    ok(enc === 600000, 'видео ограничено по числу людей (двое → 600 кбит/с)', enc);
    ok(await A.ev(`!!document.querySelector('.vc-ctrl [data-v="cam"]')`), 'кнопка 📷 в разговоре');
    // перезапуск ICE
    const r0 = Date.now();
    const offerer = await A.ev(`[...D37Calls._test.room().peers.values()][0]?.offerer`) ? A : B;
    await offerer.ev(`D37Calls._test.restart(), 1`);
    await sleep(200);
    const back = await offerer.until(`(() => { const x = D37Calls._test.net(); return x.net.restarts >= 1 && x.peers[0]?.state === 'ok'; })()`, 20000);
    const tR = Date.now() - r0;
    ok(back, 'перезапуск ICE: связь вернулась сама', { ms: tR });
    console.log('    ПЕРЕПОДКЛЮЧЕНИЕ (перезапуск ICE): ' + tR + ' мс, успешно: ' + back);
    ok(await A.until(`(document.querySelector('.vc-tile.vid video')?.videoWidth || 0) > 0`, 10000), 'после перезапуска видео на месте');
    await Promise.all([A.ev(`D37Calls.leave(), 1`), B.ev(`D37Calls.leave(), 1`)]); await sleep(3200);
    ok(await A.ev(`window.__trk.filter(t => t.readyState === 'live').length`) === 0 && await B.ev(`window.__trk.filter(t => t.readyState === 'live').length`) === 0, 'вышли — микрофон и камера выключены у обоих');
    // 3) черновик
    const dr = await A.ev(`(async () => {
      await D37Phone.need('mv');
      const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column'; document.body.appendChild(box);
      const mk = k => ({ key: k, title: '#' + k, maxLen: 500, caps: { reply: true }, load: async () => ({ list: [], more: false }), sub(){ return () => {}; }, send: async () => ({ ok: true }), state: () => ({ mode: 'write' }), me: () => ({ uid: 'me', nick: 'Я' }) });
      const v = MsgView.mount(box, { noFocus: true }); await v.setAdapter(mk('test:a'));
      const inp = box.querySelector('.mv-in'); inp.value = 'недописал…'; inp.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 600));
      await v.setAdapter(mk('test:b')); const other = inp.value;
      await v.setAdapter(mk('test:a')); const back = inp.value;
      v.destroy(); box.remove(); MsgView.drafts.put('test:a', '');
      return { other, back };
    })()`);
    ok(dr.other === '' && dr.back === 'недописал…', 'черновик остаётся у своего канала', dr);
    ok(!A.errs.length && !B.errs.length, 'ошибок JS нет', [...A.errs, ...B.errs].slice(0, 3));
  } catch (e) { ok(false, 'исключение: ' + (e.message || e)); }
  finally { await A.close(); await B.close(); site.stop(); }
  console.log(`\nT-167 e2e: ${n - fails}/${n} ok`);
  process.exit(fails ? 1 : 0);
})();

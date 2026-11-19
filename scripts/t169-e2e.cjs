// T-169: «Дискорд», третий заход — проверка в настоящем Chrome (headless, без npm, загрузки запрещены; вход подделан в странице,
// ответы сервера на запись подменены — в базу ничего не уходит).
//  (1) лимит голосового канала сайта меняется (ч. 16), несколько голосовых сайта, без ч. 16 — как раньше и понятная строка;
//  (2) 🛡 жалобы: «👁 Открыть файл» (миниатюра из жалобы) и «↗ Перейти к сообщению»; (3) на своё сообщение пожаловаться нельзя.
// Запуск из корня сайта: node scripts/t169-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t169' : os.tmpdir());
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
async function chrome({ phone, theme }){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], net = { rest: [], wsOut: 0, wsIn: 0 };
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Network.requestWillBeSent' && /supabase\.co\/(rest|auth|storage)\//.test(d.params.request.url)) net.rest.push(d.params.request.url.replace(/^.*\/(rest|auth|storage)\/v1\//, '').split('?')[0]);
    if (d.method === 'Network.webSocketFrameSent') net.wsOut++; if (d.method === 'Network.webSocketFrameReceived') net.wsIn++;
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme, d37_age: JSON.stringify({ y: new Date().getFullYear() - 17, s: 'g', fa: Date.now() - 40 * 864e5 }) };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('t168')){sessionStorage.setItem('t168','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs, net };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Phone && document.readyState === 'complete'`;
const XSS = '<img src=x onerror="window.__xss=1">';
// подделанный вход админа сайта + подмена ответов сервера (чтение — настоящее, запись — отвечаем сами; в базу ничего не уходит)
const STUB = (opt = {}) => `(async () => {
  await D37Phone.need('ds');
  window.__rpc = []; const real = window.__realRpc = window.__realRpc || D37Phone.rpc;
  const X = ${JSON.stringify(XSS)}, O = ${JSON.stringify(opt)};
  const sv = [{ id: 0, name: 'Общий', position: 0, limit: 0, max: 6, n: 1 }, { id: -1, name: 'Игра', position: 1, limit: 4, max: 4, n: 0 }, { id: -2, name: 'Тихий ' + X, position: 2, limit: 0, max: 6, n: 0 }];
  const chat = { kind: 'chat', key: 501, mid: 501, cid: null, cname: '', channel: 'games', author: 'вася', target: '11111111-1111-4111-8111-111111111111', text: 'плохое', n: 1, reasons: '', at: new Date().toISOString(), state: 'new' };
  const file = { kind: 'file', key: 7, mid: 600, cid: null, cname: '', channel: 'chat', author: 'петя', target: '22222222-2222-4222-8222-222222222222', text: '', n: 1, reasons: '', at: new Date().toISOString(), state: 'new',
    att: { name: X + '.png', mime: 'image/png', size: 2048, w: 2, h: 2, fkind: 'chat', thumb: 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of' } };
  const FX = {
    site_voice_list: O.svMissing ? null : { ok: true, can: true, cap: 6, channels: sv },
    cv_who: { ok: true, max: 6, cap: 6, limit: 0, people: [{ uid: '33333333-3333-4333-8333-333333333333', nick: 'Аня ' + X }], can_set: !O.svMissing },
    cm_voice_limit_set: { ok: true, limit: 4, max: 4, cap: 6 }, site_voice_save: { ok: true, id: -3 }, site_voice_delete: { ok: true },
    mod_reports: { ok: true, list: [chat, file] }, mod_overview: { ok: true, new: 1, work: 0, files: 1, owner: 0, joins10: 0, automod10: 0, muted: 0, log: [] },
    cm_my: [], ds_friends: { ok: true, friends: [], incoming: [], outgoing: [], blocked: [], ignored: [] }, ds_me: { ok: true, status: 'online' },
  };
  const READ = /^(cm_list_public|cm_server_get|cm_layout|cm_events|cm_catalog|ds2_info|dsm_info|cf_server_get|ds_people_meta|cm_notif_get|chat_info)$/;
  D37Phone.rpc = async (n, a) => { __rpc.push([n, a]); if (n in FX) return FX[n] === null ? { data: null, error: { code: 'PGRST202', message: 'missing' }, missing: true } : { data: FX[n], error: null };
    if (READ.test(n)) return real(n, a); return { data: { ok: false, reason: 'auth' }, error: null }; };
  currentUser = { id: '00000000-0000-4000-8000-000000000001' }; currentProfile = { id: currentUser.id, nick: 'Тест', role: 'admin' }; currentRole = 'admin'; try { chatNick = 'Тест'; } catch (e) {}
  if (O.svMissing) { D37DS.sv.missing = true; D37DS.sv.list = null; } else { D37DS.sv.missing = false; D37DS.sv.list = null; D37DS.sv.at = 0; }
  window.dispatchEvent(new Event('d37:auth')); return 1;
})()`;

(async () => {
  const site = await startSite();
  const B = await chrome({ phone: false, theme: 'dark' });
  try {
    await B.send('Page.navigate', { url: site.base + '/' });
    ok(await B.until(READY, 90000), 'сайт загрузился');
    await B.ev(STUB());
    // ═══ (1) лимит голосового канала сайта и несколько голосовых сайта ═══
    await B.ev(`location.hash = '#/chat', 1`);
    ok(await B.until(`document.querySelectorAll('.ds-chans a.ds-ch[href*="/chat/voice"]').length === 3`, 30000), 'сервер сайта: три голосовых канала из site_voice_list',
      await B.ev(`[...document.querySelectorAll('.ds-chans a.ds-ch')].map(a => a.getAttribute('href'))`));
    const vch = await B.ev(`[...document.querySelectorAll('.ds-chans a.ds-ch[href*="/chat/voice"]')].map(a => [a.getAttribute('href').replace(/^.*#/, '#'), a.textContent.trim(), a.nextElementSibling?.dataset.vch])`);
    ok(vch[0][0] === '#/chat/voice' && vch[1][0] === '#/chat/voice-1' && vch[1][2] === 'o-1' && vch[0][2] === 'o0', 'адреса: «Общий» — #/chat/voice (старые ссылки), «Игра» — #/chat/voice-1', vch);
    ok(await B.ev(`!window.__xss && [...document.querySelectorAll('.ds-chans a.ds-ch')].some(a => a.textContent.includes('<img'))`), 'название канала — только текстом');
    await B.ev(`location.hash = '#/chat/voice-1', 1`);
    ok(await B.until(`!!document.querySelector('.vc-who [data-v="lim"]')`, 15000), 'голосовой «Игра»: кто внутри и лимит для управляющего');
    ok(await B.ev(`/Аня/.test(document.querySelector('.vc-who').textContent) && !window.__xss`), '«кто внутри» до входа (ник — текстом)');
    await B.ev(`(() => { const s = document.querySelector('[data-v="lim"]'); s.value = '4'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    ok(await B.until(`__rpc.some(c => c[0] === 'cm_voice_limit_set' && c[1].p_channel === -1 && c[1].p_limit === 4)`, 5000), 'лимит меняется: cm_voice_limit_set(-1, 4)');
    ok(await B.ev(`(document.querySelector('.ds-ttl')?.textContent || '').includes('Игра')`), 'шапка: 🔊 Игра');
    // ═══ (5) карточка канала: голосовые сайта своим списком, подсказка под каждым полем, «по умолчанию», сохранение ═══
    await B.ev(`location.hash = '#/chat/channels', 1`);
    ok(await B.until(`document.querySelectorAll('[data-vi]').length === 3`, 20000), '📁 Каналы: «🔊 Голосовые каналы сайта» — три строки', await B.ev(`document.querySelector('.ds-body')?.innerText.slice(0, 300)`));
    await B.ev(`document.querySelector('[data-vi="1"] [data-a="set"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('.ds4-card [data-s="limit"]')`, 5000), '⚙️ «Игра»: карточка с пределом людей');
    const card = await B.ev(`({ hints: document.querySelectorAll('.ds4-card .ds4-hint').length, lim: document.querySelector('.ds4-card [data-s="limit"]').value, dflt: !!document.querySelector('.ds4-card [data-a="dflt"]'), close: !!document.querySelector('.ds4-card .ds4-sethd [data-a="set"]') })`);
    ok(card.hints >= 2 && card.lim === '4' && card.dflt && card.close, 'под каждым полем — одна фраза, «↺ По умолчанию», ✕', card);
    ok(await B.until(`/Сейчас внутри/.test(document.querySelector('.ds4-card .ds4-vwho')?.textContent || '')`, 5000), 'в карточке — кто сейчас внутри');
    await B.ev(`document.querySelector('.ds4-card [data-a="dflt"]').click(), 1`);
    ok(await B.ev(`document.querySelector('.ds4-card [data-s="limit"]').value`) === '0', '«по умолчанию» подставляет обычный предел');
    await B.ev(`document.querySelector('.ds4-card [data-a="save"]').click(), 1`);
    ok(await B.until(`__rpc.some(c => c[0] === 'site_voice_save' && c[1].p_id === -1 && c[1].p_limit === 0)`, 5000), '💾 Сохранить → site_voice_save(-1, предел 0)');
    // без ч. 16: один «Голосовой», админу — понятная строка вместо молчащего лимита
    await B.ev(STUB({ svMissing: true }));
    await B.ev(`location.hash = '#/chat/general', 1`); await sleep(800);
    await B.ev(`location.hash = '#/chat/voice', 1`);
    ok(await B.until(`/часть 16/.test(document.querySelector('.vc-who')?.textContent || '')`, 15000), 'без ч. 16: админ видит «лимит — после обновления базы»');
    ok(await B.ev(`document.querySelectorAll('.ds-chans a.ds-ch[href*="/chat/voice"]').length`) === 1, 'без ч. 16: один голосовой, как раньше');
    // ═══ (2) из жалобы — к файлу и к сообщению ═══
    await B.ev(STUB());
    await B.ev(`(async () => { document.getElementById('mdt')?.remove(); const box = document.createElement('div'); box.id = 'mdt'; box.style.cssText = 'position:fixed;inset:0;z-index:99990;overflow:auto;background:#111';
      document.body.appendChild(box); await D37Mod.hub(box, 'page', { official: true, id: D37DS.OFF_ID, staff: 'admin', name: 'Денчик37', channels: [{ id: 'general', name: 'общий', kind: 'text' }] }, ['reports']); return 1; })()`);
    ok(await B.until(`document.querySelectorAll('#mdt .dm-rep').length === 2`, 8000), 'жалобы: сообщение и файл');
    ok(await B.ev(`document.querySelectorAll('#mdt [data-ra="goto"]').length === 2 && document.querySelectorAll('#mdt [data-ra="fopen"]').length === 1`), 'у жалоб — «↗ Перейти к сообщению», у файла — «👁 Открыть файл»');
    await B.ev(`document.querySelector('#mdt [data-ra="fopen"]').click(), 1`);
    ok(await B.until(`/^data:image\\/webp;base64,/.test(document.querySelector('.ds4-sh img.dm-fprev')?.getAttribute('src') || '')`, 3000), '«👁 Открыть файл»: миниатюра из жалобы (без чужих адресов)');
    ok(await B.ev(`document.querySelector('.ds4-sh').textContent.includes('<img') && !window.__xss && !document.querySelector('.ds4-sh a[download], .ds4-sh [data-f="get"]')`), 'имя файла текстом, кнопок «скачать» нет');
    await B.ev(`document.querySelector('.ds4-sh [data-v=""]').click(), 1`);
    // к сообщению: подменяем чтение «в каком канале сообщение» (настоящее чтение из базы не нужно)
    await B.ev(`(() => { window.__from = sbClient.from; sbClient.from = t => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'messages' ? { channel: 'games' } : null }) }) }) }); return 1; })()`);
    await B.ev(`document.querySelector('#mdt .dm-rep[data-k="chat"] [data-ra="goto"]').click(), 1`);
    ok(await B.until(`/chat\\/games/.test(location.pathname + location.hash)`, 8000), '«↗ Перейти к сообщению» открывает канал #игры');
    await B.ev(`sbClient.from = window.__from, document.getElementById('mdt')?.remove(), 1`);
    ok(await B.until(`D37DS.pendingJump === null`, 15000), 'лента ищет само сообщение (подсвечивает, если оно ещё есть)');
    // ═══ (3) на своё — не жаловаться ═══
    const own = await B.ev(`({ nick: MsgView.isMine({ id: 1, nick: 'Тест' }), uid: MsgView.noReport({ id: 2, uid: currentUser.id, nick: 'x' }), other: MsgView.noReport({ id: 3, uid: '44444444-4444-4444-8444-444444444444', nick: 'вася', role: 'user' }), nickNo: MsgView.noReport({ id: 4, nick: 'Тест' }) })`);
    ok(own.nick && own.uid && own.nickNo && !own.other, 'своё сообщение (по id и по нику, если id нет) — без «🚩 Пожаловаться»; чужое — с ней', own);
    ok(B.errs.length === 0, 'ошибок JS нет', B.errs);
  } finally { await B.close(); }
  // ═══ (4) два браузера: переход между голосовыми каналами сайта без выхода из голоса (настоящий Supabase Realtime, пропуск подменён) ═══
  {
    const tag = 't169' + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, 'a');
    const VFAKE = uid => `(async () => {
      await D37Phone.need('calls'); window.__realRpc2 = window.__realRpc2 || D37Phone.rpc; window.__asked = 0;
      const ask0 = D37Phone.ask; D37Phone.ask = (...a) => { window.__asked++; return ask0(...a); };
      currentUser = { id: '${uid}' }; currentProfile = { id: currentUser.id, nick: 'Игрок-${uid.slice(0, 4)}' }; try { chatNick = currentProfile.nick; } catch (e) {}
      D37Phone.rpc = async (n, a) => {
        if (n === 'cv_pass') return { data: { ok: true, max: 6, cam: false, topic: '${tag}' + String(a.p_channel).replace('-', 'm'), pass: 'p.' + currentUser.id }, error: null };
        if (n === 'cv_check') return { data: { uid: String(a.p_pass).slice(2), nick: 'сосед' }, error: null };
        if (/^cv_(ping|leave|who)$/.test(n)) return { data: { ok: true, people: [], max: 6, cap: 6 }, error: null };
        if (n === 'cam_me') return window.__realRpc2(n, a);
        return { data: { ok: false, reason: 'auth' }, error: null };   // запись — не на сервер
      };
      return 1;
    })()`;
    const A = await chrome({ phone: true, theme: 'dark' }), Bv = await chrome({ phone: false, theme: 'light' });
    try {
      await Promise.all([A.send('Page.navigate', { url: site.base + '/' }), Bv.send('Page.navigate', { url: site.base + '/' })]);
      ok(await A.until(READY, 90000) && await Bv.until(READY, 90000), 'голос: два Chrome загрузили сайт');
      await A.ev(VFAKE('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')); await Bv.ev(VFAKE('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
      const j = s2 => `D37Calls.voiceJoin({ kind: 'official', channel: ${s2}, title: 'Канал ${s2} · Денчик37', name: 'Канал ${s2}' }).then(r => !!r.ok)`;
      const [ja, jb] = await Promise.all([A.ev(j(-1)), Bv.ev(j(-1))]);
      ok(ja && jb, 'оба вошли в «Игра» (-1)');
      ok(await A.until(`(D37Calls._test.net()?.peers || []).some(p => p.state === 'ok')`, 45000), 'соединились в «Игра»');
      const t0 = Date.now();
      const [sa, sb] = await Promise.all([A.ev(j(-2)), Bv.ev(j(-2))]);
      ok(sa && sb && await A.ev('window.__asked') === 0 && await Bv.ev('window.__asked') === 0, 'переход в «Тихий» (-2) — без вопроса «выйти?»');
      ok(await A.ev(`D37Calls.voiceInfo()?.channel`) === -2 && /Канал -2/.test(await A.ev(`D37Calls.voiceInfo()?.title || ''`)), 'зелёная плашка: видно, в каком ты канале');
      const back = await A.until(`(D37Calls._test.net()?.peers || []).some(p => p.state === 'ok')`, 45000);
      ok(back, 'в новом канале снова слышат друг друга', { ms: Date.now() - t0 });
      console.log('    ПЕРЕХОД МЕЖДУ ГОЛОСОВЫМИ: ' + (Date.now() - t0) + ' мс до связи');
      await Promise.all([A.ev(`D37Calls.leave(), 1`), Bv.ev(`D37Calls.leave(), 1`)]); await sleep(1500);
      ok(A.errs.length === 0 && Bv.errs.length === 0, 'голос: ошибок JS нет', [A.errs, Bv.errs]);
    } finally { await A.close(); await Bv.close(); }
  }
  // ═══ (7) сильный шумодав (d37-ns.wasm, флаг NS2_ON выключен; здесь включён пробой d37_ns2 = '1'): скорость, задержка, A/B ═══
  for (const prof of ['desk', 'phone']) {
    const N2 = await chrome({ phone: prof === 'phone', theme: 'dark' });
    try {
      await N2.send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('d37_ns2','1')}catch(e){}" });
      if (prof === 'phone') await N2.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await N2.send('Page.navigate', { url: site.base + '/' });
      ok(await N2.until(READY, 90000), `шумодав (${prof}): сайт загрузился`);
      ok(await N2.ev(`D37Phone.need('calls').then(() => !!window.D37NS2?.on && D37NS2.supported())`), `шумодав (${prof}): модуль загружен (проба включена)`);
      const bm = await N2.ev(`D37NS2.bench(600)`);
      console.log(`    ШУМОДАВ ${prof === 'phone' ? 'телефон (CPU ×4)' : 'компьютер'}: ${bm.msPerFrame} мс на кадр 10 мс (наибольшее ${bm.maxMs} мс)`);
      ok(bm.msPerFrame < (prof === 'phone' ? 5 : 2), `шумодав (${prof}): успевает в реальном времени (< ${prof === 'phone' ? 5 : 2} мс на 10 мс)`, bm);
      // A/B: шум 1,5 с, потом «голос» (200 Гц с гармониками и слогами) + шум; меряем громкость шума до и после (звук только внутри страницы)
      const ab = await N2.ev(`(async () => {
        const ctx = new AudioContext({ sampleRate: 48000 }); await ctx.resume();
        const len = 48000 * 3, buf = ctx.createBuffer(1, len, 48000), d = buf.getChannelData(0); let sd = 7;
        const rnd = () => ((sd = (sd * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
        for (let i = 0; i < len; i++) { const t = i / 48000, env = 0.5 + 0.5 * Math.max(0, Math.sin(2 * Math.PI * 4 * t));
          const v = t >= 1.5 ? env * 0.25 * (Math.sin(2 * Math.PI * 200 * t) + 0.5 * Math.sin(2 * Math.PI * 400 * t) + 0.25 * Math.sin(2 * Math.PI * 600 * t)) : 0; d[i] = v + 0.03 * rnd(); }
        const src = ctx.createBufferSource(); src.buffer = buf; const dst = ctx.createMediaStreamDestination(); src.connect(dst);
        const w = await D37NS2.wrap(dst.stream); if (!w) return { err: 'wrap' };
        const c2 = w.ctx, an = c2.createAnalyser(); an.fftSize = 2048; c2.createMediaStreamSource(w.stream).connect(an);
        const anIn = ctx.createAnalyser(); anIn.fftSize = 2048; src.connect(anIn);
        const rms = a => { const x = new Float32Array(a.fftSize); a.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
        src.start(); const t0 = performance.now(), nIn = [], nOut = [], vIn = [], vOut = [];
        while (performance.now() - t0 < 2900) { await new Promise(r => setTimeout(r, 40)); const t = (performance.now() - t0) / 1000;
          if (t > 0.6 && t < 1.4) { nIn.push(rms(anIn)); nOut.push(rms(an)); } if (t > 1.9 && t < 2.8) { vIn.push(rms(anIn)); vOut.push(rms(an)); } }
        const st = await w.stats(); w.stop(); ctx.close();
        const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length), db = (a, b) => +(20 * Math.log10(avg(b) / avg(a))).toFixed(1);
        return { noiseDb: db(nIn, nOut), voiceDb: db(vIn, vOut), frames: st?.frames || 0, workletMs: st && st.frames ? +(st.busyMs / st.frames).toFixed(3) : null, maxMs: st?.maxMs ?? null };
      })()`);
      console.log(`    ШУМОДАВ A/B (${prof}): шум ${ab.noiseDb} дБ, «голос» ${ab.voiceDb} дБ, кадров ${ab.frames}, в ворклете ${ab.workletMs} мс/кадр (наиб. ${ab.maxMs})`);
      ok(!ab.err && ab.frames > 100, `шумодав (${prof}): ворклет обрабатывает кадры`, ab);
      ok(ab.noiseDb < -10 && ab.voiceDb > -6, `шумодав (${prof}): шум тише больше чем на 10 дБ, «голос» остаётся`, ab);
      if (prof === 'desk') {
        await N2.ev(`D37Phone.open('devcheck'), 1`);
        ok(await N2.until(`!!document.querySelector('[data-dc-sw="ns2"]')`, 15000), '«🎛 Проверка»: переключатель «🧠 Сильный шумодав (проба)»');
        await N2.ev(`(() => { const c = document.querySelector('[data-dc-sw="ns2"]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-dc-a="mic"]').click(); })()`);
        ok(await N2.until(`!!document.querySelector('[data-dc-a="ab"][data-ab="ns"]')`, 15000), '«послушать себя»: обычный / с шумодавом');
        await N2.ev(`D37Phone.close?.() ?? D37Phone.back?.(), 1`);
      }
      ok(N2.errs.length === 0, `шумодав (${prof}): ошибок JS нет`, N2.errs);
    } finally { await N2.close(); }
  }
  // ═══ (6) нагрузка: сколько запросов к серверу за минуту у гостя на /chat (настоящие запросы, только чтение) ═══
  if (!process.env.NO_LOAD) {
    const G = await chrome({ phone: true, theme: 'dark' });
    try {
      await G.send('Network.enable');
      await G.send('Page.navigate', { url: site.base + '/chat' });
      await G.until(`!!document.querySelector('#dsHost .mv-m, #dsHost .mv-empty')`, 60000);
      const start = { rest: G.net.rest.length, out: G.net.wsOut, inn: G.net.wsIn };
      console.log('    загрузка /chat: REST ' + start.rest + ' (' + [...new Set(G.net.rest)].slice(0, 30).join(', ') + ')');
      await sleep(60000);
      const r = { rest: G.net.rest.length - start.rest, wsOut: G.net.wsOut - start.out, wsIn: G.net.wsIn - start.inn, which: G.net.rest.slice(start.rest) };
      console.log('    НАГРУЗКА гость /chat, 1 мин в покое: REST ' + r.rest + ', WS отправлено ' + r.wsOut + ', получено ' + r.wsIn + ' ' + JSON.stringify(r.which));
      ok(r.rest <= 12, 'гость в покое: не больше 12 запросов REST в минуту (было 18 до T-169)', r);
    } finally { await G.close(); }
  }
  site.stop();
  console.log(`\nt169-e2e: ${n - fails} из ${n} прошло${fails ? ', упало ' + fails : ''}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// T-177: звонки и ники — проверка в настоящем Chrome (headless, ненастоящие камера и микрофон Chrome, загрузки запрещены; вход подделан
// в странице, ответы сервера на запись подменены — в базу ничего не уходит, аккаунтов не создаём, паролей не вводим).
//  (1) ник из смайликов: принят (проверка сайта), виден в чате (@упоминание), в мини-карточке, на плитке голосового; запрещённое — отказ с причиной;
//  (2) админ меняет ник: на время / навсегда / сброс (сервер подменён), у модератора и игрока кнопок нет, без ч. 17 — понятная строка;
//  (3) плитка камеры: увеличить / полоска / ⛶ на весь экран / 📌 / Esc — компьютер и 390×844;
//  (4) окно телефона: своя плитка с камерой НЕ чёрная (пиксели кадра), и в чате тоже, после выкл / вкл камеры;
//  (5) проверка микрофона: слышно себя (играет запись 3 с, «слышать себя» вживую, уровень > 0), всё выключается при закрытии;
//  (6) адрес админа скрыт по умолчанию, у обычного 18+ — как было; строка над плитками говорит правду;
//  (7) один список действий над человеком: гость / игрок / модератор / админ, причина у недоступного, «⋯» профиля — без шапки.
// Запуск из корня сайта: node scripts/t177-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500, SHOTS=<папка для снимков>, ONLY=cam,mic,…)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t177' : os.tmpdir());
const SHOTS = process.env.SHOTS || '';
const ONLY = new Set((process.env.ONLY || '').split(',').filter(Boolean));
const want = k => !ONLY.size || ONLY.has(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
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
  const ev = async (expr, gesture) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!gesture }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme, d37_age: JSON.stringify({ y: new Date().getFullYear() - 30, s: 'g', fa: Date.now() - 40 * 864e5 }) };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('t177')){sessionStorage.setItem('t177','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs, shot };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Phone && document.readyState === 'complete'`;
const ME = '00000000-0000-4000-8000-000000000001', OTHER = '22222222-2222-4222-8222-222222222222', KID = '33333333-3333-4333-8333-333333333333';
// вход подделан, роль и возраст — подменены; запись на сервер — отвечаем сами (в базу ничего не уходит)
const LOGIN = (role, nick, opt = {}) => `(async () => {
  await D37Phone.need('calls'); await D37Phone.need('ds');
  window.__rpc = []; const real = window.__realRpc = window.__realRpc || D37Phone.rpc; const O = ${JSON.stringify(opt)};
  const tag = window.__tag = window.__tag || ('t177' + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, 'a'));
  D37Phone.rpc = async (n, a) => {
    __rpc.push([n, a]);
    if (O.p17missing && /^nick_/.test(n)) return { data: null, error: { code: 'PGRST202', message: 'missing' }, missing: true };
    if (n === 'cv_pass') return { data: { ok: true, max: 6, cam: true, topic: tag + String(a.p_channel).replace('-', 'm'), pass: 'p.' + currentUser.id }, error: null };
    if (n === 'cv_check') return { data: { uid: String(a.p_pass).slice(2), nick: 'сосед' }, error: null };
    if (/^cv_(ping|leave|who)$/.test(n)) return { data: { ok: true, people: [], max: 6, cap: 6 }, error: null };
    if (n === 'cam_me') return { data: { cam: true }, error: null };
    if (n === 'cm_my') return { data: [], error: null };
    if (n === 'ds_friends') return { data: { ok: true, friends: [], incoming: [], outgoing: [], blocked: [], ignored: [] }, error: null };
    if (n === 'ds_me') return { data: { ok: true, status: 'online' }, error: null };
    if (n === 'mod_member') return { data: { ok: true, can: true, notes: [], log: [] }, error: null };
    if (n === 'nick_admin_set') return { data: { ok: true, old: 'Вася', nick: a.p_nick, forever: a.p_minutes === 0, until: a.p_minutes ? new Date(Date.now() + a.p_minutes * 6e4).toISOString() : null }, error: null };
    if (n === 'nick_admin_reset') return { data: { ok: true, old: 'Вася', nick: 'Игрок123456' }, error: null };
    if (n === 'nick_my_lock') return { data: { locked: false }, error: null };
    if (/^(site_voice_list|cm_list_public|cm_server_get|cm_layout|ds2_info|dsm_info|chat_info|ds_people_meta|cm_notif_get)$/.test(n)) return real(n, a);
    return { data: { ok: false, reason: 'auth' }, error: null };
  };
  currentUser = { id: '${ME}' }; currentProfile = { id: currentUser.id, nick: ${JSON.stringify(nick)}, role: '${role}' }; currentRole = '${role}'; try { chatNick = currentProfile.nick; } catch (e) {}
  if (window.D37Age) { D37Age.group = () => O.kid ? 'kid' : 'adult'; }
  window.dispatchEvent(new Event('d37:auth')); return 1;
})()`;
// яркость кадра <video>: средняя и разброс (чёрный кадр — 0 / 0)
const PIX = sel => `(() => { const v = document.querySelector(${JSON.stringify(sel)}); if (!v || !v.videoWidth) return { w: 0 };
  const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36);
  const d = x.getImageData(0, 0, 64, 36).data; let s = 0, s2 = 0; for (let i = 0; i < d.length; i += 4) { const y = (d[i] + d[i + 1] + d[i + 2]) / 3; s += y; s2 += y * y; }
  const k = d.length / 4, m = s / k; return { w: v.videoWidth, mean: Math.round(m), sd: Math.round(Math.sqrt(Math.max(0, s2 / k - m * m))), paused: v.paused }; })()`;
const JOIN = ch => `D37Calls.voiceJoin({ kind: 'official', channel: ${ch}, title: 'Тихий · Денчик37', name: 'Тихий' }).then(r => !!r.ok)`;

setTimeout(() => { console.log('  ✗ зависло — больше 12 минут'); process.exit(2); }, 12 * 60e3).unref();
(async () => {
  const site = await startSite();
  // ═══ компьютер, тёмная тема: камера, плитки, телефон, микрофон, адрес, ники, админ, список действий ═══
  for (const prof of ['desk', 'phone']) {
    const B = await chrome({ phone: prof === 'phone', theme: prof === 'phone' ? 'light' : 'dark' });
    const P = prof === 'phone' ? '[390×844, светлая] ' : '[компьютер, тёмная] ';
    try {
      await B.send('Page.navigate', { url: site.base + '/' });
      ok(await B.until(READY, 90000), P + 'сайт загрузился');
      // ── (6) адрес: админ скрыт по умолчанию, обычный 18+ — нет ──
      if (want('ip') && prof === 'desk') {
        await B.ev(LOGIN('user', 'Игрок'));
        const u = await B.ev(`(D37Phone.set.hide = 'auto', D37Calls.hideIp())`);
        await B.ev(LOGIN('admin', 'dan4ik37'));
        const a = await B.ev(`(D37Phone.set.hide = 'auto', D37Calls.hideIp())`), aoff = await B.ev(`(D37Phone.set.hide = 'off', D37Calls.hideIp())`);
        await B.ev(`D37Phone.set.hide = 'auto', 1`);
        ok(u === false && a === true && aoff === false, P + 'адрес: обычный 18+ — напрямую (как было); админ — скрыт по умолчанию; админ выключил «Скрыть» — напрямую', { u, a, aoff });
        const pol = await B.ev(`D37Phone.need('join').catch(() => {}).then(() => window.D37JoinP2P?._test?.p2pPolicy ? D37JoinP2P._test.p2pPolicy({ adult: true, admin: true, hideSet: 'auto' }, { adult: true, friend: true }) : 'нет')`).catch(() => 'нет');
        ok(pol === 'relay' || pol === 'нет', P + 'комнаты игр (p2pPolicy) — то же правило для админа', pol);
      }
      // ── вход в голосовой как админ с ником из смайликов ──
      const NICK = prof === 'phone' ? '🐱 Вася' : '🔥🔥';
      await B.ev(LOGIN('admin', NICK));
      await B.ev(`window.D37_TURN = [{ urls: 'turn:127.0.0.1:3478', username: 't', credential: 't' }], 1`);   // посредник «есть» (для строки адреса)
      // экран голосового канала — та же функция, что рисует его на странице чата (D37Calls.voiceView), в своём блоке страницы
      await B.ev(`(() => { const d = document.createElement('div'); d.id = 'vchat'; d.style.cssText = 'position:fixed;inset:60px 0 0 0;z-index:900;overflow:auto;padding:12px;background:var(--bg,#111);display:flex;flex-direction:column';
        document.body.appendChild(d); D37Calls.voiceView(d, { kind: 'official', channel: 0, name: 'Тихий', title: 'Тихий · Денчик37' }); return 1; })()`);
      const vOpen = await B.until(`!!document.querySelector('#vchat .vc')`, 15000);
      ok(vOpen, P + 'страница голосового канала открылась', vOpen ? undefined : await B.ev(`location.href + ' · ' + (document.querySelector('.ds-body')?.innerText || document.body.innerText).slice(0, 200)`));
      const joined = await B.ev(JOIN(0));
      ok(joined, P + 'вошёл в голосовой «Тихий» (пропуск подменён, связь — настоящий Supabase Realtime)');
      ok(await B.until(`[...document.querySelectorAll('.vc-tile b')].some(b => b.textContent.includes(${JSON.stringify(NICK)}))`, 15000), P + `плитка голосового: ник «${NICK}» (ты)`);
      if (want('ip')) {
        const banner = await B.ev(`(document.querySelector('.vc-priv') || document.querySelector('.vc-note.bad'))?.textContent || ''`);
        ok(/адрес скрыт/.test(banner) && /админу — по умолчанию/.test(banner), P + 'строка адреса у админа: «🕶 Твой адрес скрыт… (админу — по умолчанию)»', banner);
      }
      // ── (4) камера: в чате и в окне телефона одновременно — обе плитки показывают картинку ──
      if (want('cam')) {
        await B.ev(`D37Calls.camToggle().then(() => 1)`);
        ok(await B.until(`!!document.querySelector('.ds-body .vc-tile.vid video, .vc-tile.vid video')`, 8000), P + 'камера включилась — плитка с видео');
        await B.ev(`D37Phone.open('incall'), 1`);
        ok(await B.until(`document.querySelectorAll('.vc-tile.vid video').length >= 2`, 8000), P + 'чат и окно телефона: у каждого экрана свой <video>', await B.ev(`document.querySelectorAll('.vc-tile.vid video').length`));
        await sleep(1200);
        const vids = await B.ev(`[...document.querySelectorAll('.vc-tile.vid video')].map((v, i) => (v.dataset.t177 = i, i))`);
        const px = []; for (const i of vids) px.push(await B.ev(PIX(`video[data-t177="${i}"]`)));
        ok(px.length >= 2 && px.every(p => p.w > 0 && (p.mean > 8 || p.sd > 4) && !p.paused), P + 'кадр НЕ чёрный в обоих экранах (средняя яркость / разброс пикселей)', px);
        const inPhone = await B.ev(`(() => { const v = document.querySelector('.ph .vc-tile.vid video'); return !!v && v.isConnected; })()`);
        ok(inPhone, P + 'своя плитка в окне телефона — с видео (было: пустая чёрная)');
        await B.shot(`${prof}-phone-cam`);
        // выкл / вкл камеры — снова картинка
        await B.ev(`D37Calls.camToggle().then(() => 1)`); await sleep(600);
        await B.ev(`D37Calls.camToggle().then(() => 1)`); await sleep(1500);
        const px2 = await B.ev(PIX('.ph .vc-tile.vid video'));
        ok(px2.w > 0 && (px2.mean > 8 || px2.sd > 4), P + 'после выкл / вкл камеры — снова картинка в телефоне', px2);
        await B.ev(`D37Phone.close(), 1`); await sleep(400);
      }
      // ── (3) увеличение плитки ──
      if (want('zoom')) {
        await B.ev(`document.querySelector('.vc-tile.vid[data-vf]')?.click(), 1`);
        ok(await B.until(`!!document.querySelector('.vc-grid.vc-focus .vc-big .vc-tile.fx')`, 3000), P + 'нажал на плитку — она большая (остальные — полоской)');
        const sz = await B.ev(`(() => { const r = document.querySelector('.vc-big .vc-tile').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth }; })()`);
        ok(sz.w >= Math.min(320, sz.vw - 60) && sz.h > 150, P + 'большая плитка — во всю ширину области звонка', sz);
        await B.shot(`${prof}-zoom`);
        await B.ev(`document.querySelector('.vc-tb [data-vt="pin"]').click(), 1`); await sleep(300);
        ok(await B.ev(`!!document.querySelector('.vc-tb [data-vt="pin"].on')`), P + '📌 закрепить — кнопка включена');
        await B.ev(`document.querySelector('.vc-tb [data-vt="pin"]').click(), 1`); await sleep(300);
        // headless Chrome может отказать в настоящем полном экране — смотрим, КТО просит полный экран и чем кончилось
        await B.ev(`(() => { window.__fs = []; const o = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function(){ window.__fs.push({ big: !!this.querySelector?.('.vc-big'), fsh: this.classList.contains('vc-fsh') });
          return o.call(this).then(() => { window.__fs.push('ok'); }, er => { window.__fs.push('отказ: ' + er.message); throw er; }); }; return 1; })()`);
        await B.ev(`document.querySelector('.vc-tb [data-vt="fs"]').click(), 1`, true); await sleep(600);
        const fsl = await B.ev(`window.__fs`);
        const fs1 = await B.ev(`!!document.fullscreenElement`);
        ok(fsl[0] && fsl[0].big && fsl[0].fsh, P + '⛶ на весь экран — просит вся область звонка с большой плиткой' + (fs1 ? ' (и вошла)' : ' (headless: ' + JSON.stringify(fsl[1] || '') + ')'), fsl);
        if (fs1) { await B.ev(`document.exitFullscreen().then(() => 1)`, true); await sleep(400); }
        await B.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1`); await sleep(300);
        ok(await B.ev(`!document.querySelector('.vc-focus')`), P + 'Esc — плитка вернулась на место');
        await B.ev(`(() => { const t = document.querySelector('.vc-tile.vid[data-vf]'); t.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return 1; })()`, true); await sleep(800);
        ok(await B.ev(`!!document.querySelector('.vc-focus') && window.__fs.filter(x => x && x.big).length >= 2`), P + 'двойное нажатие — большая и просит весь экран', await B.ev('window.__fs'));
        if (await B.ev('!!document.fullscreenElement')) { await B.ev(`document.exitFullscreen().then(() => 1)`, true); await sleep(300); }
        await B.ev(`D37Calls.focus(null), 1`);
        const scroll = await B.ev(`document.documentElement.scrollWidth <= innerWidth + 1`);
        ok(scroll, P + 'страница не уехала вбок');
      }
      await B.ev(`D37Calls.leave(), 1`); await sleep(800);
      await B.ev(`document.getElementById('vchat')?.remove(), 1`);
      // ── (5) проверка микрофона: слышно себя ──
      if (want('mic')) {
        await B.ev(`D37Phone.open('devcheck'), 1`);
        ok(await B.until(`!!document.querySelector('[data-dc-a="mic"]')`, 8000), P + 'экран «🎛 Проверка» открылся');
        await B.ev(`document.querySelector('[data-dc-a="mic"]').click(), 1`, true);
        ok(await B.until(`D37Calls._dc().rec === 'rec'`, 6000), P + '«Проверить микрофон» → сразу запись 3 с («Говори…»)');
        const lv = []; for (let i = 0; i < 6; i++) { lv.push(+(await B.ev(`D37Calls._dc().level`)).toFixed(4)); await sleep(150); }
        ok(lv.some(x => x > 0.001), P + 'уровень с ненастоящего микрофона > 0', lv);
        ok(await B.until(`D37Calls._dc().recPlaying === true`, 7000), P + 'через 3 с — играет запись своего голоса (элемент <audio> не на паузе)', await B.ev(`D37Calls._dc()`));
        await B.shot(`${prof}-miccheck`);
        await B.ev(`document.querySelector('[data-dc-a="mon"]').click(), 1`, true); await sleep(500);
        ok(await B.ev(`D37Calls._dc().monitor === true`), P + '«🎧 Слышать себя» — живой звук идёт в динамик');
        await B.ev(`D37Phone.close(), 1`); await sleep(500);
        const st = await B.ev(`D37Calls._dc()`);
        ok(!st.mic && !st.monitor && !st.recPlaying, P + 'закрыл проверку — микрофон, «слышать себя» и запись выключены (эха не будет)', st);
      }
      // ── (1) ники ──
      if (want('nick') && prof === 'desk') {
        const acc = await B.ev(`['🔥🔥', '🐱 Вася', 'Ника✨', '👨‍👩‍👧 семья', '❤️❤️'].map(x => D37Nick.check(x).ok)`);
        ok(acc.every(Boolean), 'ник из смайликов (один или с буквами) — принят', acc);
        const ref = await B.ev(`[['🔥', 'от 2'], ['   ', 'пустым'], ['_._', 'только из'], ['Аноним🔥', 'занят системой'], ['dan4ik37🔥', 'команды'], ['dаn4ik37', 'команды'], ['Ва\\u200bся', 'невидимые'], ['🔥\\u202e🔥', 'невидимые'], ['сука🔥', 'мата'], ['🔥<b>', 'буквы']]
          .map(([x, w]) => { const c = D37Nick.check(x, { self: false }); return [x, !c.ok && c.err.includes(w), c.err]; })`);
        ok(ref.every(r => r[1]), 'запрещённое — отказ с понятной причиной', ref.filter(r => !r[1]));
        // профиль: сохранение ника из смайликов уходит на сервер без изменений (запрос подменён)
        const save = await B.ev(`(async () => { const from0 = sbClient.from, role0 = currentRole; currentRole = 'user'; let sent = null;
          sbClient.from = t => ({ update: v => ({ eq: async () => { sent = v; return { error: null }; } }), select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) });
          document.getElementById('profileNickInput').value = '🔥🔥'; await saveProfileNick(); const e1 = document.getElementById('profileNickError').textContent;
          document.getElementById('profileNickInput').value = 'dan4ik37🔥'; sent = sent; const s1 = sent; sent = null; await saveProfileNick(); const e2 = document.getElementById('profileNickError').textContent;
          sbClient.from = from0; currentRole = role0; return { s1, e1, sent2: sent, e2 }; })()`);
        ok(save.s1?.nick === '🔥🔥' && !save.e1 && !save.sent2 && /команды/.test(save.e2), 'профиль: «🔥🔥» сохраняется; «dan4ik37🔥» — отказ до сервера', save);
        // лента: @упоминание и ник — текстом
        const rich = await B.ev(`(async () => { await D37Phone.need('mv'); const r = MsgView.rich('привет @🔥🔥 и @Вася!', '🔥🔥'); return r.html; })()`);
        ok(/<b class="mv-at me">@🔥🔥<\/b>/.test(rich) && /mv-at">@Вася<\/b>/.test(rich), '@упоминание ника из смайликов подсвечивается (и «меня» тоже)', rich);
        // мини-карточка
        await B.ev(`(() => { const T = D37Mini._t; T.PC.set('${OTHER}', { p: { id: '${OTHER}', nick: '🦊🦊', role: 'user' }, t: Date.now() }); T.FC.set('${OTHER}', { v: 'none', t: Date.now(), me: '${ME}' }); return 1; })()`);
        await B.ev(`D37Mini.open('${OTHER}', { nick: '🦊🦊' }).then(() => 1)`);
        const mc = await B.ev(`({ nick: document.querySelector('.d37m-nick').textContent, ava: document.querySelector('.d37m-ava').textContent })`);
        ok(mc.nick === '🦊🦊' && mc.ava === '🦊', 'мини-карточка: ник и «буква» аватара — смайлик (не «?»)', mc);
        await B.shot('desk-minicard-admin');
        await B.ev(`D37Mini.close(), 1`);
      }
      // ── (7) один список действий ──
      if (want('acts') && prof === 'desk') {
        const sig = `(r => r.groups.map(g => g.id + ':' + g.rows.map(x => (x.k || '-') + (x.dis ? '!' : '')).join(',')).join(' | '))`;
        const A = (s) => `${sig}(D37Mini._test.actions(Object.assign({ uid: '${OTHER}', self: false, logged: true, guest: false, status: 'none', mods: [] }, ${JSON.stringify(s)})))`;
        const guest = await B.ev(A({ logged: false, status: null }));
        const player = await B.ev(A({}));
        const friend = await B.ev(A({ status: 'friends' }));
        const kid = await B.ev(`D37Mini._test.actions({ uid: '${KID}', self: false, logged: true, status: 'friends', kb: 'agecall', mods: [] }).groups.find(g => g.id === 'talk').rows.find(x => x.t.includes('Написать'))`);
        const moder = await B.ev(A({ staff: 'moderator', canMod: true, mods: [['mute10', 'Мут 10 мин']] }));
        const admin = await B.ev(A({ staff: 'admin', canMod: true, mods: [['mute10', 'Мут 10 мин'], ['ban', 'Бан']] }));
        const onStaff = await B.ev(A({ staff: 'moderator', canMod: true, tstaff: 'admin', mods: [['mute10', 'x']] }));
        ok(!/talk|mod/.test(guest) && /copy-link/.test(guest), 'гость: профиль и ссылка, без «Написать» и модерации', guest);
        ok(/talk:-!,-!,mention/.test(player) && /friend-add/.test(player) && /report|-!/.test(player) && !/mod:/.test(player), 'игрок (не друг): «Написать / Позвонить» видны приглушённо с причиной, «Упомянуть», «В друзья»; модерации нет', player);
        ok(/talk:dm,call,mention/.test(friend) && /inv/.test(friend) && /friend-del/.test(friend), 'друг: «Написать», «Позвонить», «Позвать в игру», «Убрать из друзей»', friend);
        ok(kid && kid.dis && kid.why, 'разный возраст: «Написать» — приглушено и ПОЧЕМУ', kid);
        ok(/mod:mod:mute10,modcard$/.test(moder), 'модератор: мут + «🛡 Ещё…» (без смены ника)', moder);
        ok(/mod:mod:mute10,mod:ban,modcard,nickset,nickreset/.test(admin), 'админ: + «✏️ Сменить ник», «♻️ Сбросить ник»', admin);
        ok(/mod:-!$/.test(onStaff), 'модератор на создателя — приглушено с причиной', onStaff);
        // настоящий (чужой) профиль — только ЧТЕНИЕ из базы; дружба и профиль в карточке — подложены в кэш
        const RU = await B.ev(`(async () => { const { data } = await (await sbProfiles()).select('id').neq('role', 'admin').limit(1); return data?.[0]?.id || '' })()`);
        await B.ev(`(() => { D37Mini._t.PC.set('${RU}', { p: { id: '${RU}', nick: '🦊🦊', role: 'user' }, t: Date.now() }); return 1; })()`);
        // тот же список — откуда бы ни открыли (чат, друзья, голосовой, профиль): карточка одна, список считает одна функция
        await B.ev(`(() => { const T = D37Mini._t; T.FC.set('${RU}', { v: 'friends', t: Date.now(), me: '${ME}' }); return 1; })()`);
        const fromPlaces = [];
        for (const place of ['chat', 'friends', 'voice']) {
          await B.ev(`(() => { const a = document.createElement('a'); a.id = 'anc-${place}'; a.textContent = '🦊🦊'; a.style.cssText = 'position:fixed;left:20px;top:200px'; document.body.appendChild(a); return 1; })()`);
          await B.ev(`D37Mini.open('${RU}', { nick: '🦊🦊', anchor: document.getElementById('anc-${place}') }).then(() => 1)`);
          fromPlaces.push(await B.ev(`[...document.querySelectorAll('.d37m-acts .d37m-btn')].map(b => b.textContent.trim()).join('|')`));
          await B.ev(`D37Mini.close(), document.getElementById('anc-${place}').remove(), 1`);
        }
        ok(fromPlaces.every(x => x === fromPlaces[0]) && /Сменить ник/.test(fromPlaces[0]) && /Написать/.test(fromPlaces[0]), 'чат / друзья / голосовой — один и тот же полный список', fromPlaces[0]);
        // профиль: «⋯» — те же действия, без шапки карточки
        await B.ev(`D37Route.go ? D37Route.go('/profile/${RU}') : (location.hash = '#/profile/${RU}'), 1`);
        await sleep(2500);
        const more = await B.ev(`!!document.querySelector('.pf-more')`);
        if (more) {
          await B.ev(`document.querySelector('.pf-more').click(), 1`);
          ok(await B.until(`!!document.querySelector('.d37m.pmenu:not([hidden]) .d37m-grp')`, 6000), 'профиль: «⋯» — меню действий (без шапки, страница и так про него)');
          const pm = await B.ev(`[...document.querySelectorAll('.d37m-acts .d37m-btn')].map(b => b.textContent.trim()).join('|')`);
          ok(pm === fromPlaces[0].replace('👤 Профиль|', ''), 'профиль: тот же список, кроме «Профиль»', { pm, card: fromPlaces[0] });
          await B.shot('desk-profile-menu');
          await B.ev(`D37Mini.close(), 1`);
        } else ok(false, 'профиль: кнопка «⋯» не найдена');
      }
      // ── (2) админ меняет ник (сервер подменён) ──
      if (want('rename') && prof === 'desk') {
        await B.ev(`D37Mod.member('${OTHER}', 'Вася'), 1`);
        ok(await B.until(`!!document.querySelector('.dm-card [data-ca="nickset"]') && !!document.querySelector('.dm-card [data-ca="nickreset"]')`, 6000), 'админ: в карточке модерации «✏️ Сменить ник» и «♻️ Сбросить ник»');
        const doSet = async (nick, pick, reason) => {
          await B.ev(`document.querySelector('.dm-card [data-ca="nickset"]').click(), 1`);
          await B.until(`!!document.querySelector('.ds4-sh:not(.dm-cardsh) [data-f="nick"]')`, 4000);
          await B.ev(`(() => { const w = [...document.querySelectorAll('.ds4-sh')].pop(); w.querySelector('[data-f="nick"]').value = ${JSON.stringify(nick)}; w.querySelector('[data-pick="${pick}"]').click(); w.querySelector('[data-f="reason"]').value = ${JSON.stringify(reason)}; w.querySelector('[data-v="go"]').click(); return 1; })()`);
          await sleep(500);
        };
        await doSet('Тихоня🙂', 1440, 'оскорбительный ник');
        ok(await B.ev(`__rpc.some(c => c[0] === 'nick_admin_set' && c[1].p_nick === 'Тихоня🙂' && c[1].p_minutes === 1440 && c[1].p_reason === 'оскорбительный ник')`), '«на 1 день»: nick_admin_set(новый ник, 1440 мин, причина)');
        await doSet('Игрок1', 0, 'реклама');
        ok(await B.ev(`__rpc.some(c => c[0] === 'nick_admin_set' && c[1].p_minutes === 0)`), '«навсегда»: nick_admin_set(…, 0)');
        const nb = await B.ev(`__rpc.filter(c => c[0] === 'nick_admin_set').length`);
        await doSet('dan4ik37', 60, 'тест');
        ok(await B.ev(`__rpc.filter(c => c[0] === 'nick_admin_set').length`) === nb, 'ник «под команду» — отказ ещё до сервера');
        await B.ev(`document.querySelector('.dm-card [data-ca="nickreset"]').click(), 1`); await B.until(`!!document.querySelector('.ds4-sh:not(.dm-cardsh) [data-f="reason"]')`, 4000);
        await B.ev(`(() => { const w = [...document.querySelectorAll('.ds4-sh')].pop(); w.querySelector('[data-f="reason"]').value = 'ник под админа'; w.querySelector('[data-v="go"]').click(); return 1; })()`); await sleep(500);
        ok(await B.ev(`__rpc.some(c => c[0] === 'nick_admin_reset' && c[1].p_reason === 'ник под админа')`), '«Сбросить ник»: nick_admin_reset(причина)');
        await B.shot('desk-rename');
        await B.ev(`document.querySelector('.dm-card [data-cx]')?.click(), 1`);
        // без ч. 17 — понятная строка
        await B.ev(LOGIN('admin', 'dan4ik37', { p17missing: true }));
        await B.ev(`(D37Mod.nickAdmin('${OTHER}', 'Вася', true), 1)`); await B.until(`!!document.querySelector('.ds4-sh:not(.dm-cardsh) [data-f="reason"]')`, 4000);
        await B.ev(`(() => { const w = [...document.querySelectorAll('.ds4-sh')].pop(); if (!w) return 0; w.querySelector('[data-f="reason"]').value = 'x'; w.querySelector('[data-v="go"]').click(); return 1; })()`); await sleep(600);
        const toastTxt = await B.ev(`[...document.querySelectorAll('.ph-toast, .toast, [class*="toast"]')].map(x => x.textContent).join(' ')`);
        ok(/часть 17/.test(toastTxt), 'без ч. 17: «заработает после обновления базы (часть 17)»', toastTxt.slice(0, 200));
        // модератор и игрок — кнопок нет
        await B.ev(LOGIN('moderator', 'Модер'));
        await B.ev(`D37Mod.member('${OTHER}', 'Вася'), 1`); await B.until(`!!document.querySelector('.dm-card .dm-cacts')`, 5000);
        ok(await B.ev(`!document.querySelector('.dm-card [data-ca="nickset"]')`), 'модератор: «Сменить ник» нет (права не расширены)');
        await B.ev(`document.querySelector('.dm-card [data-cx]')?.click(), 1`);
        const pl = await B.ev(`D37Mini._test.actions({ uid: '${OTHER}', logged: true, status: 'none', staff: null, mods: [] }).groups.some(g => g.id === 'mod')`);
        ok(!pl, 'игрок: модерации и смены ника нет');
      }
      ok(B.errs.length === 0, P + 'ошибок JS нет', B.errs);
    } finally { await B.close(); }
  }
  site.stop();
  console.log(`\n${n - fails}/${n} ✓${fails ? ' — ОШИБКИ: ' + fails : ''}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

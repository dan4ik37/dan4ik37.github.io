// 🎮 Платформа D37 (/hub, js/features/hub.js): проверка в настоящем Chrome (headless, без npm, загрузки запрещены).
//   guest   — меню (телефон и ПК, тёмная и светлая), «Играть» → экран загрузки → игра движка внутри сайта; гардероб: «Мальчик» + цвет
//             → образ в настройках браузера; выход — мир в IndexedDB; перезагрузка → /hub/wardrobe: тот же образ в движке; /hub/play —
//             продолжение с сохранения
//             T-163: плашка «кто ты в игре», строка «Игры игроков» и страница «Все» (/hub/games); лёгкий гардероб (/hub/wardrobe —
//             только персонаж, без планеты: is_planet = false, время до персонажа); «Творческий режим» — свой мир (/hub/creative,
//             своё сохранение 'creative', главный мир не трогает)
//   phone   — телефон с касаниями: кнопки ⤒ 🌍 👕 на экране, графика «быстро», зажал 🌍 — полёт с орбиты вниз до посадки («приземлился»)
//   account — поддельный вход (currentUser в странице; ответы Supabase подменяет сам тест через Fetch — в базу ничего не пишется):
//             образ уходит в аккаунт (prefs_set), мир — в облако (cloud_begin → файл → cloud_commit); браузер очищен → вход → образ
//             из аккаунта, мир из облака (продолжение)
// Картинки — SHOTS (по умолчанию M:/d37/d37-play/EP7-shots/site). Запуск под очередью:
//   node M:/d37/d37-core/scripts/heavy-lock.mjs run --session site/ep7-site --job hub-e2e --min 10 -- node scripts/hub-e2e.cjs [guest,account]
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/hub-e2e' : os.tmpdir());
const SHOTS = process.env.SHOTS || (fs.existsSync('M:/d37/d37-play') ? 'M:/d37/d37-play/EP7-shots/site' : path.join(TMP, 'shots'));
const MODES = (process.argv[2] || 'guest,account,phone').split(',');
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

// ── поддельный Supabase для режима account: только функции платформы; остальное идёт как обычно ──
const UID = '0b6f0000-0000-4000-8000-00000000e2e7';
const FAKE = { prefs: null, prefsAt: 0, row: null, files: new Map(), calls: [] };
function fakeAnswer(req){
  const u = new URL(req.url), p = u.pathname;
  const body = () => { try { if (req.postDataEntries && req.postDataEntries.length) return Buffer.concat(req.postDataEntries.map(e => Buffer.from(e.bytes || '', 'base64'))); } catch (e) {} return Buffer.from(req.postData || '', 'utf8'); };
  const json = () => { try { return JSON.parse(body().toString('utf8') || '{}'); } catch (e) { return {}; } };
  if (req.method === 'OPTIONS') return { code: 204, body: '' };
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p);
  if (rpc) {
    const fn = rpc[1], a = json();
    if (fn === 'prefs_get') { FAKE.calls.push(fn); return { body: FAKE.prefs ? { prefs: FAKE.prefs, at: FAKE.prefsAt } : null }; }
    if (fn === 'prefs_set') { FAKE.calls.push(fn); FAKE.prefs = a.p_prefs; FAKE.prefsAt = Date.now(); return { body: { ok: true, at: FAKE.prefsAt } }; }
    if (fn === 'cloud_list') { FAKE.calls.push(fn); return { body: { ok: true, slots: 2, max_bytes: 2097152, plus: false, full: false, used: FAKE.row ? 1 : 0, list: FAKE.row ? [FAKE.row] : [] } }; }
    if (fn === 'cloud_begin') { FAKE.calls.push(fn); const ver = FAKE.row ? FAKE.row.ver : 0; FAKE.pending = `${UID}/${a.p_game}/${a.p_world}/${ver + 1}-e2e${Date.now() % 1e6}.kbw`; return { body: { ok: true, path: FAKE.pending, ver } }; }
    if (fn === 'cloud_commit') {
      FAKE.calls.push(fn);
      const old = FAKE.row && FAKE.row.path, ver = (FAKE.row ? FAKE.row.ver : 0) + 1;
      FAKE.row = { world: a.p_world, name: a.p_name, bytes: +a.p_bytes, ver, gt: +a.p_gt, device: a.p_device, at: new Date().toISOString(), path: a.p_path };
      return { body: { ok: true, ver, old } };
    }
    return null;
  }
  const so = /^\/storage\/v1\/object\/(.+)$/.exec(p);
  if (so) {
    const rest = decodeURIComponent(so[1]);
    if (/^list\/saves/.test(rest)) return { body: [] };
    if (req.method === 'DELETE') return { body: [] };
    const key = rest.replace(/^(authenticated|public)\//, '').replace(/^saves\//, '');
    if (req.method === 'POST' || req.method === 'PUT') {
      // supabase-js шлёт Blob как multipart/form-data: файл — часть, которая не поле cacheControl
      FAKE.calls.push('upload');
      let b = body();
      const ct = Object.entries(req.headers || {}).find(([k]) => k.toLowerCase() === 'content-type');
      const m = ct && /boundary=([^;]+)/.exec(ct[1]);
      if (m) {
        const sep = Buffer.from('--' + m[1]);
        for (let i = b.indexOf(sep); i >= 0;) {
          const j = b.indexOf(sep, i + sep.length); if (j < 0) break;
          const part = b.subarray(i + sep.length, j), h = part.indexOf('\r\n\r\n');
          if (h >= 0 && !/name="cacheControl"/.test(part.subarray(0, h).toString('utf8'))) { b = part.subarray(h + 4, part.length - 2); break; }
          i = j;
        }
      }
      FAKE.files.set(key, Buffer.from(b));
      return { body: { Key: 'saves/' + key, Id: 'e2e' } };
    }
    if (req.method === 'GET') { FAKE.calls.push('download'); const b = FAKE.files.get(key); return b ? { body: b, type: 'application/octet-stream' } : { code: 404, body: { error: 'not found' } }; }
  }
  return null;
}

async function chrome(o = {}){
  fs.mkdirSync(TMP, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 600), profile = o.profile || fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1366,800', 'about:blank'],
  { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
  let page = null;
  for (let i = 0; i < 80 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) {} if (!page) await sleep(250); }
  if (!page) { proc.kill(); throw new Error('Chrome не запустился'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const cb = new Map(), errs = [], logs = [];
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && cb.has(d.id)) { const [a, b] = cb.get(d.id); cb.delete(d.id); d.error ? b(new Error(d.error.message)) : a(d.result); return; }
    if (d.method === 'Runtime.exceptionThrown') errs.push((d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push(d.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
    if (d.method === 'Fetch.requestPaused') {
      const q = d.params, ans = o.fake ? fakeAnswer(q.request) : null;
      if (!ans) { send('Fetch.continueRequest', { requestId: q.requestId }).catch(() => {}); return; }
      const raw = Buffer.isBuffer(ans.body) ? ans.body : Buffer.from(ans.body === '' ? '' : JSON.stringify(ans.body), 'utf8');
      send('Fetch.fulfillRequest', { requestId: q.requestId, responseCode: ans.code || 200, body: raw.toString('base64'), responseHeaders: [
        { name: 'content-type', value: ans.type || 'application/json' }, { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-headers', value: '*' }, { name: 'access-control-allow-methods', value: 'GET,POST,PUT,DELETE,OPTIONS' }] }).catch(() => {});
    }
  };
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  if (o.fake) await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/rest/v1/rpc/*' }, { urlPattern: '*supabase.co/storage/v1/*' }] });
  // без вопросов сайта поверх (возраст, «установить приложение», подсказки)
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_ds_tip: '1' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile });
  const shot = async (name) => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); console.log('    картинка ' + path.join(SHOTS, name)); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); if (!o.keep) try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, view, shot, close, errs, logs, profile };
}
const READY = `typeof sbClient !== 'undefined' && !!sbClient && !!window.D37Route && !!window.D37Hub && document.readyState === 'complete'`;
const GO = p => `(D37Route.go(${JSON.stringify(p)}), true)`;
const LOADED = `!!(D37Hub._st.h && D37Hub._st.h.state.loaded)`;
const ENGINE_LOOK = `(() => { const h = D37Hub._st.h; if (!h) return null; const s = h.stats(); return { body: s && s.body, text: h.state.app.wardrobe_look() }; })()`;
// гардероб в движке: «👕» → «Мальчик» → первый ещё не выбранный цвет первой части (настоящие кнопки панели)
const DRESS = `(async () => {
  const w = document.querySelector('.d37h-ward'); if (!w) return 'нет кнопки гардероба';
  if (document.querySelector('.d37h-wardrobe').style.display !== 'block') w.click();
  for (let i = 0; i < 30 && document.querySelector('.d37h-wardrobe').style.display !== 'block'; i++) await new Promise(r => setTimeout(r, 100));
  const boy = [...document.querySelectorAll('.d37h-wardrobe button')].find(b => /Мальч/i.test(b.textContent)); if (!boy) return 'нет кнопки «Мальчик»';
  boy.click();
  // ждём, пока движок возьмёт тело и панель перерисуется под мальчика (его части и цвета)
  for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 100)); const s = D37Hub._st.h.stats(); const on = [...document.querySelectorAll('.d37h-wardrobe button.on')].some(b => /Мальч/i.test(b.textContent)); if (s && s.body === 'boy' && on && document.querySelector('.d37h-wardrobe button.sw')) break; }
  const sw = [...document.querySelectorAll('.d37h-wardrobe button.sw')].find(b => !b.classList.contains('on')); if (!sw) return 'нет цветов';
  sw.click();
  return 'ok:' + sw.title;
})()`;

async function playUntilLoaded(C, label){
  const t0 = Date.now();
  const ok1 = await C.until(LOADED, 120000);
  const st = await C.ev(`({ loaded: ${LOADED}, errors: D37Hub._st.errors, events: D37Hub._st.events, backend: D37Hub._st.h && D37Hub._st.h.state.backend, frames: D37Hub._st.h && D37Hub._st.h.state.frames })`);
  ok(ok1, `${label}: движок загрузил планету за ${((Date.now() - t0) / 1000).toFixed(1)} с`, st);
  return ok1;
}

(async () => {
  const site = await startSite();
  try {
    for (const MODE of MODES) {
      console.log(`— ${MODE}`);
      if (MODE === 'guest') {
        const C = await chrome();
        try {
          await C.view(412, 915, true);
          await C.send('Page.navigate', { url: site.base + '/hub' });
          ok(await C.until(READY + ` && document.querySelectorAll('#hub-page .hub-tile').length >= 6`, 60000), 'меню /hub: 6 плиток');
          ok(await C.ev(`document.querySelector('.bt-item[data-route="hub"]') && !document.querySelector('.bt-item[data-route="hub"]').hidden && getComputedStyle(document.getElementById('hub-page')).display !== 'none'`), 'нижнее меню телефона: «Играть» видно, раздел открыт');
          ok(await C.ev(`[...document.querySelectorAll('#hub-page .hub-tile')].map(t => t.dataset.tile).join(',') === 'play,wardrobe,creative,world,studio,mini,invite,howto,gfx,save'`), 'плитки: Играть, Гардероб, Творческий режим, Мир Денчика, Студия, Мини-игры, Позвать друга, Как играть, Графика, Сохранение');
          // T-163: «кто ты в игре» и строка «Игры игроков» (игроки ещё ничего не выложили — витрина Денчика и «Сделай первую игру»)
          ok(await C.until(`(() => { const p = document.querySelector('#hub-page [data-tile="play"]').getBoundingClientRect(), m = document.querySelector('.hc-me').getBoundingClientRect(), r = document.querySelector('[data-row="people"]').getBoundingClientRect(); return p.bottom <= innerHeight && p.top < m.top && m.top < r.top && m.height < 90; })()`, 8000), 'телефон: «Играть» на первом экране, под ним плашка в одну строку, потом строка игр', await C.ev(`[...document.querySelectorAll('#hub-page [data-tile="play"], .hc-me, [data-row="people"]')].map(e => Math.round(e.getBoundingClientRect().top) + '/' + Math.round(e.getBoundingClientRect().height))`));
          ok(await C.ev(`(() => { const w = () => getComputedStyle(document.querySelector('.hc-worlds')).display; const a = w(); document.querySelector('.hc-more').click(); const b = w(); document.querySelector('.hc-more').click(); return a === 'none' && b !== 'none'; })()`), 'телефон: «Подробнее ▾» раскрывает миры, друзей и кнопки');
          ok(await C.ev(`!!document.querySelector('.hc-me .hc-who') && !!document.querySelector('.hc-me [data-act="invite"]') && !!document.querySelector('.hc-me a[href="/hub/wardrobe"]')`), 'плашка «Ты играешь как…»: персонаж, гардероб, «Позвать друга»');
          ok(await C.until(`/в игре|ещё не начат/.test(document.querySelector('.hc-worlds')?.textContent || '') && !!document.querySelector('.hc-fr b')`, 5000), 'плашка: твой мир, творческий мир, друзья онлайн', await C.ev(`document.querySelector('.hc-me-tx')?.textContent`));
          ok(await C.until(`document.querySelectorAll('[data-row="people"] .hc-card').length >= 3`, 15000), 'строка «Игры игроков» показана', await C.ev(`({ n: document.querySelectorAll('[data-row="people"] .hc-card').length, players: document.querySelector('[data-row="people"]')?.dataset.count })`));
          ok(await C.ev(`(() => { const r = document.querySelector('[data-row="people"]'); if (+r.dataset.count > 0) return !!r.querySelector('a.hc-card .hc-by'); return !!r.querySelector('.hc-make a[href="/play/studio3d"]') && /Сделай первую игру/.test(r.textContent) && [...r.querySelectorAll('a.hc-card .hc-by')].every(b => /от Денчика/.test(b.textContent)); })()`), 'нет игр игроков — «Сделай первую игру» и честно подписанные игры Денчика (не выдаём за игры игроков)');
          ok(await C.ev(`getComputedStyle(document.querySelector('.hc-strip')).overflowX === 'auto' && document.querySelector('.hc-strip').scrollWidth > document.querySelector('.hc-strip').clientWidth`), 'строка листается вбок (телефон)');
          await C.ev(GO('/hub/games'));
          ok(await C.until(`location.pathname === '/hub/games' && document.querySelectorAll('.hc-filt .hc-chip').length >= 6 && document.querySelectorAll('.hc-grid .hc-card').length >= 1`, 15000), '«Все» (/hub/games): фильтры «Популярные / Новые» и жанры, карточки');
          ok(await C.ev(`(() => { const b = [...document.querySelectorAll('.hc-chip')].find(x => x.dataset.genre === 'place'); b.click(); return document.querySelector('.hc-chip[data-genre="place"]').classList.contains('on'); })()`), 'фильтр жанра «3D-миры» включается');
          await sleep(400); await C.shot('games_all_phone.png');
          await C.ev(GO('/hub')); await C.until(`document.querySelectorAll('#hub-page .hub-tile').length >= 6`, 10000);
          ok(await C.ev(`(document.querySelector('[data-tile="howto"]').click(), !!document.querySelector('.hub-sheet .hub-sheet-row'))`), '«Как играть» открывает лист с кнопками');
          await sleep(300); await C.shot('howto_phone.png');
          await C.ev(`(document.querySelector('.hub-sheet-x').click(), true)`);
          ok(await C.ev(`(() => { const t = document.querySelector('[data-tile="gfx"]'); t.click(); const a = localStorage.getItem('d37_hub_gfx'); t.click(); t.click(); t.click(); t.click(); return a === 'max' && !localStorage.getItem('d37_hub_gfx'); })()`), '«Графика»: Авто → Красиво → … → снова Авто');
          ok(await C.ev(`document.querySelector('#hub-page a[href="/play"]') && document.querySelector('#hub-page a[href="/play/world"]') && document.querySelector('#hub-page a[href="/play/studio3d"]') ? true : false`), 'ссылки на Мини-игры, Мир Денчика, Студию');
          await sleep(600); await C.shot('hub_phone_dark.png');
          await C.ev(`(document.querySelector('[data-row="people"]').scrollIntoView(), true)`); await sleep(500); await C.shot('hub_phone_row.png'); await C.ev(`(scrollTo(0, 0), true)`);
          await C.view(1366, 800, false); await sleep(500); await C.shot('hub_pc_dark.png');
          await C.ev(`localStorage.setItem('d37_theme','light'), true`); await C.send('Page.reload'); await C.until(READY + ` && document.querySelectorAll('#hub-page .hub-tile').length >= 6`, 60000);
          ok(await C.ev(`document.documentElement.getAttribute('data-theme') === 'light'`), 'светлая тема включилась');
          await sleep(600); await C.shot('hub_pc_light.png');
          await C.view(412, 915, true); await sleep(400); await C.shot('hub_phone_light.png');
          await C.ev(`localStorage.removeItem('d37_theme'), true`); await C.send('Page.reload'); await C.until(READY, 60000);
          // «Играть» — экран загрузки, потом планета внутри сайта
          await C.view(1366, 800, false);
          await C.ev(`(document.querySelector('#hub-page [data-tile="play"] a[href="/hub/play/tribe"]') || document.querySelector('#hub-page [data-tile="play"] a.hub-play-main')).click(), true`);   // W8: без сохранения главная кнопка — «Новый мир» (клетка); рубить дерево — сразу с племени
          ok(await C.until(`!!document.querySelector('.hub-play .hub-load') && !document.querySelector('.hub-play .hub-load').hidden`, 10000), 'экран загрузки показан');
          await C.until(`/[1-9]/.test(document.querySelector('.hub-pct')?.textContent || '')`, 15000);
          await C.shot('loading_pc.png');
          ok(await C.ev(`location.pathname.startsWith('/hub/play') && D37Hub.active === true && document.body.classList.contains('hub-on')`), 'адрес /hub/play, игра поверх сайта');
          if (await playUntilLoaded(C, 'гость')) {
            await sleep(2500);
            ok(await C.ev(`document.querySelector('.hub-play .hub-load').hidden === true`), 'экран загрузки убран');
            await C.shot('game_in_site_pc.png');
            const look0 = await C.ev(ENGINE_LOOK);
            const r = await C.ev(DRESS);
            ok(/^ok:/.test(r), 'гардероб: «Мальчик» + цвет', r);
            ok(await C.until(`D37Settings.get('d37body') === 'boy' && D37Settings.get('d37look') !== ''`, 8000), 'образ записан в настройки браузера', await C.ev(`[D37Settings.get('d37body'), D37Settings.get('d37look')]`));
            await C.shot('wardrobe_open_pc.png');
            const want = await C.ev(ENGINE_LOOK);
            ok(want && want.body === 'boy' && want.text && want.text !== look0.text, 'движок: мальчик, цвета поменялись', { before: look0, after: want });
            // EP7: игра в долине — дерево рубится действием (E), верстак ставится, автосохранение уходит в мир
            const GS = `D37Hub._st.h.gameStats()`;
            const g0 = await C.ev(GS);
            ok(g0 && g0.on === true && g0.ring > 150, 'долина: игровой слой включён, вокруг деревья, камни, ягоды', g0);
            await C.ev(`(D37Hub._st.h.send({ t: 'wardrobe', on: false }), D37Hub._st.h.state.app.admin('game plant tree_broad 1.2'), true)`);
            await sleep(300);
            await C.ev(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true })), setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true })), 6500), true)`);
            await sleep(9000);
            const g1 = await C.ev(GS);
            ok(g1 && (g1.items > g0.items || g1.drops > g0.drops), 'E (действие) рубит дерево: брёвна / палки', { before: g0, after: g1 });
            await C.shot('game_chop_pc.png');
            await C.ev(`(D37Hub._st.h.state.app.admin('game give plank 6; game give stick 2; game craft workbench; game place workbench 2.5 1.5 0'), true)`);
            ok(await C.until(`(() => { const g = ${GS}; return g && g.parts === 1 && g.saves > 0; })()`, 8000), 'верстак сделан и поставлен, игра сохранилась сама', await C.ev(GS));
            const gBuilt = await C.ev(GS);
            await sleep(1500); await C.shot('game_build_pc.png');
            const er = await C.ev(`(() => { window.__e2eErr = []; window.d37Err = (w, e) => __e2eErr.push(w + ': ' + (e && e.message)); D37Hub._st.h.send({ t: 'nope' }); return __e2eErr; })()`);
            ok(er.length === 1 && /^engine:host_in: .*nope/.test(er[0]), 'ошибка движка ушла в мониторинг (d37Err)', er);
            // ← На сайт: мир сохранён в браузере, движок выгружен
            await C.ev(`document.querySelector('.hub-back').click(), true`);
            ok(await C.until(`!D37Hub.active && location.pathname === '/hub' && !document.querySelector('.hub-play')`, 15000), '«← На сайт»: игра закрыта, снова меню');
            const rec = await C.ev(`D37Hub._idb.get('planet').then(r => r ? { n: r.bytes.length, magic: String.fromCharCode(...r.bytes.slice(0, 4)), gt: r.gt } : null)`);
            ok(rec && rec.magic === 'D37S' && rec.n > 40, 'мир сохранён в браузере (IndexedDB, D37S)', rec);
            ok(await C.until(`/в игре/.test(document.querySelector('[data-tile="save"] .hub-ts')?.textContent || '') && /Продолжить/.test(document.querySelector('.hub-cont')?.textContent || '')`, 5000), 'меню: «▶ Продолжить» и плитка «Сохранение» знают про мир');
            // перезагрузка → сразу в гардероб (T-163: лёгкий — только персонаж, без планеты): образ тот же
            await C.send('Page.navigate', { url: site.base + '/hub/wardrobe' });
            await C.until(READY, 60000);
            const tw = Date.now();
            if (await playUntilLoaded(C, 'гардероб после перезагрузки')) {
              ok(await C.ev(`D37Hub._st.h.state.app.is_planet() === false && D37Hub._st.mode === 'wardrobe' && !document.querySelector('.d37h-orbit') && !document.querySelector('.d37h-jump')`), 'лёгкий гардероб: без планеты, без кнопок полёта и прыжка', { ms: Date.now() - tw, pos: await C.ev(`D37Hub._st.h.stats().pos`) });
              await C.until(`(() => { const l = ${ENGINE_LOOK}; return l && l.body === 'boy'; })()`, 10000);
              const got = await C.ev(ENGINE_LOOK);
              ok(got && got.body === want.body && got.text === want.text, 'после перезагрузки образ тот же', { want, got });
              ok(await C.ev(`document.querySelector('.d37h-wardrobe').style.display === 'block'`), '/hub/wardrobe открыл гардероб сам');
              await sleep(1500); await C.shot('wardrobe_after_reload_pc.png');
              await C.view(412, 915, true); await sleep(1500); await C.shot('wardrobe_phone.png');
            }
            // продолжение: /hub/play берёт сохранение
            await C.ev(GO('/hub/play'));
            if (await playUntilLoaded(C, 'продолжение')) {
              ok(await C.ev(`!!D37Hub._st.resumed && D37Hub._st.resumed.scene === 'valley'`), 'игра продолжилась с сохранения', await C.ev(`D37Hub._st.resumed`));
              ok(await C.until(`(() => { const g = D37Hub._st.h.gameStats(); return g && g.parts === 1; })()`, 8000), 'долина та же: верстак на месте, вещи те же', { want: gBuilt, got: await C.ev(`D37Hub._st.h.gameStats()`) });
              await sleep(2000); await C.shot('game_in_site_phone.png');
            }
            // T-163: «Творческий режим» — свой мир: своё сохранение, главный мир (долина) не трогает
            await C.ev(GO('/hub'));
            await C.until(`!D37Hub.active && document.querySelectorAll('#hub-page .hub-tile').length >= 6`, 15000);
            const main0 = await C.ev(`D37Hub._idb.get('planet').then(r => r ? r.at : 0)`);
            await C.view(1366, 800, false);
            await C.ev(`document.querySelector('#hub-page a[data-tile="creative"]').click(), true`);
            if (await playUntilLoaded(C, 'творческий режим')) {
              ok(await C.ev(`location.pathname === '/hub/creative' && D37Hub._st.mode === 'creative' && D37Hub._st.h.state.app.is_planet() === true && D37Hub._st.h.gameStats() === null && !!document.querySelector('.d37h-orbit')`), 'творческий режим: планета, полёт (🌍), без игрового слоя (без выживания)');
              await sleep(1500); await C.shot('creative_pc.png');
              await C.ev(`document.querySelector('.hub-back').click(), true`);
              ok(await C.until(`!D37Hub.active && location.pathname === '/hub'`, 15000), 'из творческого режима — в меню');
              const cr = await C.ev(`Promise.all([D37Hub._idb.get('creative'), D37Hub._idb.get('planet')]).then(([c, p]) => ({ c: c ? String.fromCharCode(...c.bytes.slice(0, 4)) : null, main: p ? p.at : 0 }))`);
              ok(cr.c === 'D37S' && cr.main === main0, 'творческий мир сохранён отдельно (слот creative), главный мир не тронут', cr);
            }
            await C.ev(GO('/hub'));
            await C.until(`!D37Hub.active`, 15000);
          }
          const errs = C.errs.filter(e => !/supabase|realtime|websocket|Failed to fetch|NetworkError/i.test(e));
          ok(errs.length === 0, 'нет ошибок JS на странице', errs.slice(0, 5));
        } finally { await C.close(); }
      }
      if (MODE === 'phone') {
        const C = await chrome();
        try {
          await C.view(412, 915, true);
          await C.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
          await C.send('Page.navigate', { url: site.base + '/hub/planet' });
          ok(await C.until(READY, 60000), 'сайт загрузился (телефон)');
          if (await playUntilLoaded(C, 'телефон')) {
            ok(await C.ev(`!!(document.querySelector('.d37h-jump') && document.querySelector('.d37h-orbit') && document.querySelector('.d37h-ward'))`), 'кнопки на экране: прыжок, орбита ↔ земля, гардероб');
            ok(await C.ev(`D37Hub._st.h.state.app.quality() === 'low'`), 'телефон: графика «быстро» (low)', await C.ev(`D37Hub._st.h.state.app.quality()`));
            const alt0 = await C.ev(`JSON.parse(D37Hub._st.h.state.app.planet_stats()).alt`);
            await C.ev(`(() => { const b = document.querySelector('.d37h-orbit'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); setTimeout(() => b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })), 600); return true; })()`);
            await sleep(4000);
            const p1 = await C.ev(`JSON.parse(D37Hub._st.h.state.app.planet_stats())`);
            ok(p1.auto || p1.alt < alt0 * 0.98, 'зажал 🌍 — полёт с орбиты вниз', { alt0, alt: p1.alt, auto: p1.auto });
            await C.shot('descent_phone.png');
            const landed = await C.until(`D37Hub._st.events.includes('landed')`, 120000);
            const p2 = await C.ev(`JSON.parse(D37Hub._st.h.state.app.planet_stats())`);
            ok(landed, 'приземлился (событие движка «landed», тост на экране)', { alt: p2.alt, events: await C.ev(`D37Hub._st.events`) });
            await sleep(5000);
            await C.shot('landed_phone.png');
            // шаг вперёд левым «стиком»: касание слева внизу и сдвиг вверх
            const pos0 = await C.ev(`D37Hub._st.h.stats().pos`);
            await C.ev(`(() => { const c = document.querySelector('.hub-stage canvas'), r = c.getBoundingClientRect(), x = r.left + r.width * 0.25, y = r.top + r.height * 0.75;
              const ev = (t, yy) => c.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: yy }));
              ev('pointerdown', y); ev('pointermove', y - 60); setTimeout(() => ev('pointerup', y - 60), 2500); return true; })()`);
            await sleep(3200);
            const pos1 = await C.ev(`D37Hub._st.h.stats().pos`);
            const moved = Math.hypot(pos1[0] - pos0[0], pos1[2] - pos0[2]);
            ok(moved > 1, 'левый «стик» на телефоне двигает персонажа', { moved: Math.round(moved * 10) / 10 });
            await C.shot('walk_phone.png');
            // долина на телефоне: игровой слой с кнопками ДЕЙСТВИЕ / СУМКА / РЕМЕСЛО (рисует движок)
            await C.ev(GO('/hub/play'));
            await C.until(`D37Hub._st.mode === 'play' && !!D37Hub._st.h`, 30000);
            if (await playUntilLoaded(C, 'долина на телефоне')) {
              ok(await C.ev(`D37Hub._st.h.state.game === true && !document.querySelector('.d37h-orbit')`), 'телефон: долина с игровым слоем, без кнопки орбиты');
              await sleep(3000); await C.shot('game_phone.png');
            }
          }
          const errs = C.errs.filter(e => !/supabase|realtime|websocket|Failed to fetch|NetworkError/i.test(e));
          ok(errs.length === 0, 'нет ошибок JS на странице', errs.slice(0, 5));
        } finally { await C.close(); }
      }
      if (MODE === 'account') {
        const C = await chrome({ fake: true });
        const login = `(currentUser = { id: '${UID}' }, currentProfile = { nick: 'Тестер', role: 'user' }, window.dispatchEvent(new Event('d37:auth')), true)`;
        try {
          await C.view(1366, 800, false);
          await C.send('Page.navigate', { url: site.base + '/hub' });
          ok(await C.until(READY, 60000), 'сайт загрузился');
          await C.ev(login);
          await sleep(1500);
          ok(await C.until(`/Тестер/.test((document.querySelector('#hub-page .hub-acc') || document.querySelector('#hub-page .hc-me'))?.textContent || '')`, 8000), 'меню: «Ты играешь как Тестер»');
          await C.ev(GO('/hub/play'));
          if (await playUntilLoaded(C, 'вход')) {
            ok(FAKE.calls.includes('cloud_list'), 'облако спрошено при входе в игру (cloud_list)', FAKE.calls);
            const r = await C.ev(DRESS);
            ok(/^ok:/.test(r), 'гардероб: «Мальчик» + цвет', r);
            ok(await C.until(`D37Settings.get('d37body') === 'boy'`, 8000), 'образ в настройках');
            const want = await C.ev(ENGINE_LOOK);
            for (let i = 0; i < 50 && !(FAKE.prefs && FAKE.prefs.d37body === 'boy'); i++) await sleep(200);
            ok(FAKE.prefs && FAKE.prefs.d37body === 'boy' && FAKE.prefs.d37look === want.text, 'образ ушёл в аккаунт (prefs_set)', FAKE.prefs && { body: FAKE.prefs.d37body, look: FAKE.prefs.d37look });
            await C.ev(`(D37Hub._st.lastCloud = 0, true)`);
            const saved = await C.ev(`D37Hub.saveWorld('exit')`);
            for (let i = 0; i < 50 && !FAKE.row; i++) await sleep(200);
            ok(saved && FAKE.row && FAKE.row.ver === 1 && FAKE.calls.includes('upload'), 'мир ушёл в облако (cloud_begin → файл → cloud_commit)', { row: FAKE.row, calls: FAKE.calls.slice(-6) });
            // браузер очищен (другое устройство): вход → образ из аккаунта, мир из облака
            await C.ev(GO('/profile'));
            ok(await C.until(`!!document.querySelector('#profileContent .hub-pcard')`, 8000), 'свой профиль: карточка «Планета D37» (Играть, Гардероб)');
            await sleep(800); await C.shot('profile_card_pc.png');
            await C.ev(GO('/hub'));
            await C.until(`!D37Hub.active`, 15000);
            await C.ev(`(localStorage.removeItem('d37_settings'), localStorage.removeItem('d37_settings_at'), new Promise(r => { const q = indexedDB.deleteDatabase('d37-hub'); q.onsuccess = q.onerror = q.onblocked = () => r(true); }))`);
            await C.send('Page.reload');
            ok(await C.until(READY, 60000), 'перезагрузка');
            ok(await C.ev(`D37Settings.get('d37body') === 'girl'`), 'браузер чистый: образ по умолчанию');
            await C.ev(login);
            ok(await C.until(`D37Settings.get('d37body') === 'boy'`, 10000), 'образ пришёл из аккаунта (prefs_get)', await C.ev(`[D37Settings.get('d37body'), D37Settings.get('d37look')]`));
            await C.ev(GO('/hub/play'));
            if (await playUntilLoaded(C, 'другое устройство')) {
              ok(FAKE.calls.includes('download'), 'мир скачан из облака', FAKE.calls.slice(-6));
              ok(await C.ev(`!!D37Hub._st.resumed && D37Hub._st.resumed.body === 'boy'`), 'игра продолжилась с облачного сохранения', await C.ev(`D37Hub._st.resumed`));
              await C.until(`(() => { const l = ${ENGINE_LOOK}; return l && l.body === 'boy'; })()`, 10000);
              const got = await C.ev(ENGINE_LOOK);
              ok(got && got.body === 'boy' && got.text === want.text, 'образ в движке тот же', { want, got });
              await sleep(1500); await C.shot('game_account_pc.png');
            }
          }
          const errs = C.errs.filter(e => !/supabase|realtime|websocket|Failed to fetch|NetworkError|JWT|401|permission/i.test(e));
          ok(errs.length === 0, 'нет ошибок JS на странице', errs.slice(0, 5));
        } finally { await C.close(); }
      }
    }
  } finally { site.stop(); }
  console.log(fails ? `\nhub-e2e: ${fails} FAIL` : '\nhub-e2e: всё прошло');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

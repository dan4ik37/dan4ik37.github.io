// T-177 остатки, T-172, T-170, T-171 — проверка в настоящем Chrome (headless; загрузки запрещены; вход подделан в странице, запись на
// сервер подменена — в базу НИЧЕГО не уходит, аккаунтов не создаём, паролей не вводим; настоящий сервер — только чтение гостем).
//  (pages) страницы гостем: компьютер 1440 и 1920, телефон 390 — тёмная и светлая: ошибок в консоли нет, вбок не прокручивается;
//  (mod)   карточка игрока: без ч. 18 новые пункты приглушены и запросов «функции нет» нет; с ч. 18 — админ / модератор / хелпер /
//          игрок видят своё; окна «из голосового», «последние сообщения», «роль», «жалоба на человека» шлют правильные вызовы;
//          свой срок тайм-аута; список «👤 Люди» в 🛡 центре;
//  (voice) убранного из голосового отключает (cv_ping2), вход раньше срока — понятный текст; соседи отключают убранного;
//  (prof)  профиль на ширину экрана: шапка, колонки, вкладки, размер текста; откат PROFILE_WIDE;
//  (fol)   «Следить»: кнопка, счётчик, колокольчик, лента; без ч. 18 — запасной путь; возраст;
//  (mode)  страница режима: игра сайта, режим движка, нет такой игры, «ⓘ» на карточках, «кто играет».
// Запуск из корня сайта: node scripts/part18-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500, SHOTS=<папка>, ONLY=pages,mod,voice,prof,fol,mode)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/site-lane' : os.tmpdir());
const SHOTS = process.env.SHOTS || '';
const ONLY = new Set((process.env.ONLY || '').split(',').filter(Boolean));
const want = k => !ONLY.size || ONLY.has(k);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 600) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
// шум, который не про сайт: локальный сервер не умеет /api и аналитику Vercel; чужие картинки-обложки, которых нет у YouTube; реклама
// (и отказ Chrome вибрировать без нажатия пальцем — в проверке нажатий человека нет)
const NOISE = /\/api\/|_vercel\/|status of 501|i\.ytimg\.com|googlesyndication|doubleclick|googleads|yandex\.(ru|net)|mc\.yandex|adsbygoogle|ERR_BLOCKED_BY_CLIENT|favicon|navigator\.vibrate/i;
async function chrome({ w = 1440, h = 900, phone = false, theme = 'dark' } = {}){
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
    let e = '';
    if (d.method === 'Runtime.exceptionThrown') e = 'EXC ' + (d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || '');
    else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') e = 'CON ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') e = 'LOG ' + (d.params.entry.text || '') + ' ' + (d.params.entry.url || '');
    if (e && !NOISE.test(e)) errs.push(e.slice(0, 300)); };
  const send = (method, params = {}) => new Promise((a, b) => { const i = ++id; cb.set(i, [a, b]); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, gesture) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: !!gesture }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  const size = async (w2, h2, ph) => { await send('Emulation.setDeviceMetricsOverride', { width: w2, height: h2, deviceScaleFactor: ph ? 2 : 1, mobile: !!ph }); await send('Emulation.setTouchEmulationEnabled', { enabled: !!ph, maxTouchPoints: 5 }); };
  await size(w, h, phone);
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme, d37_age: JSON.stringify({ y: new Date().getFullYear() - 30, s: 'g', fa: Date.now() - 40 * 864e5 }) };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('p18t')){sessionStorage.setItem('p18t','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 55 }); fs.writeFileSync(path.join(SHOTS, name + '.jpg'), Buffer.from(r.data, 'base64')); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs, shot, size };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Phone && document.readyState === 'complete'`;
const ME = '00000000-0000-4000-8000-000000000001', OTHER = '22222222-2222-4222-8222-222222222222';
// Вход подделан; ЛЮБАЯ запись на сервер подменена: P.rpc и sbClient.rpc отвечают сами (кроме явного списка функций только для чтения),
// insert / update / upsert / delete у таблиц — пустышки. __rpc — журнал вызовов.
const LOGIN = (role, nick, opt = {}) => `(async () => {
  await D37Phone.need('calls'); await D37Phone.need('ds');
  const O = ${JSON.stringify(opt)};
  window.__rpc = []; window.__O = O;
  const READ = /^(site_voice_list|ds2_info|ds3_info|dsm_info|nick17_info|game_top|game_top_week|forum_feed)$/;
  const tag = window.__tag = window.__tag || ('p18' + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, 'a'));
  const mock = (n, a) => {
    __rpc.push([n, a]);
    const D = d => ({ data: d, error: null });
    if (__O.kickErr && n === 'cv_pass') return { data: null, error: { code: 'P0001', message: 'voice_kicked:7' } };
    if (n === 'cv_pass') return D({ ok: true, max: 6, cam: false, topic: tag + String(a.p_channel).replace('-', 'm'), pass: 'p.' + currentUser.id });
    if (n === 'cv_check') return D({ uid: String(a.p_pass).slice(2), nick: 'сосед' });
    if (n === 'cv_ping2') return D(window.__ping2 || { ok: true, kicked: false, out: [] });
    if (/^cv_(ping|leave|who)$/.test(n)) return D({ ok: true, people: [], max: 6, cap: 6 });
    if (n === 'cam_me') return D({ cam: false });
    if (n === 'cm_my') return D([]);
    if (n === 'ds_friends') return D({ ok: true, friends: [], incoming: [], outgoing: [], blocked: [], ignored: [] });
    if (n === 'ds_me') return D({ ok: true, status: 'online' });
    if (n === 'mod_member') return D({ ok: true, can: true, notes: [], log: [] });
    if (n === 'mod_overview') return D({ ok: true, new: 0, work: 0, files: 0, joins10: 0, automod10: 0, muted: 0, log: [] });
    if (n === 'mod_reports') return D({ ok: true, list: [] });
    if (n === 'mod_user_reports') return D({ ok: true, list: [{ target: '${OTHER}', nick: 'Вася<b>', n: 2, state: 'new', kinds: 'nick,voice', reasons: 'плохой ник · шумит <img src=x onerror=window.__xss=1>', at: new Date().toISOString(), to_owner: false, by_nick: null }] });
    if (/^(mod_voice_kick|mod_purge_user|mod_role_set|user_report|mod_user_report_set|chat_mod|mod_site_ban)$/.test(n)) return D(Object.assign({ ok: true, n: 3, minutes: a.p_minutes }, __O.fail && __O.fail[n] ? { ok: false, reason: __O.fail[n] } : {}));
    if (n === 'follow_info') return D(Object.assign({ ok: true, followers: 12, following: !!window.__fol, notify: !!window.__bell, can: true, why: null, mine: a.p_user === currentUser.id ? 3 : null }, __O.folInfo || {}));
    if (n === 'follow_set') { if (__O.folFail) return D({ ok: false, reason: __O.folFail }); window.__fol = !!a.p_on; if (a.p_notify != null) window.__bell = !!a.p_notify; if (!a.p_on) window.__bell = false; return D({ ok: true, follow: window.__fol, notify: !!window.__bell, followers: 12 + (window.__fol ? 1 : 0) }); }
    if (n === 'forum_follow') { window.__fol = !!a.p_on; return D({ ok: true, follow: window.__fol }); }
    if (n === 'follow_list') return D({ ok: true, list: window.__fol === false ? [] : [{ id: '${OTHER}', nick: 'Автор<i>', notify: true, at: new Date().toISOString() }] });
    if (n === 'follow_feed') return D({ ok: true, list: [{ kind: 'thread', id: '42', title: 'Как строить дом <script>', author: '${OTHER}', nick: 'Автор<i>', at: new Date(Date.now() - 3600e3).toISOString(), icon: '', descr: 'Короткий текст' },
      { kind: 'game', id: 'g1', title: 'Гонки', author: '${OTHER}', nick: 'Автор<i>', at: new Date(Date.now() - 86400e3).toISOString(), icon: '🏎', descr: '' }, { kind: 'unity', id: 'u1', title: 'Платформер', author: '${OTHER}', nick: 'Автор<i>', at: new Date(Date.now() - 2 * 86400e3).toISOString(), icon: '🕹️', descr: '' }] });
    if (n === 'nick_my_lock') return D({ locked: false });
    return null;
  };
  if (!window.__realPrpc) { window.__realPrpc = D37Phone.rpc; window.__realSrpc = sbClient.rpc.bind(sbClient); window.__realFrom = sbClient.from.bind(sbClient); }
  D37Phone.rpc = async (n, a) => { const m = mock(n, a || {}); if (m) return Object.assign({ missing: false }, m); if (READ.test(n)) return __realPrpc(n, a); return { data: { ok: false, reason: 'auth' }, error: null, missing: false }; };
  sbClient.rpc = (n, a) => { const m = mock(n, a || {}); if (m) return Promise.resolve(m); if (READ.test(n)) return __realSrpc(n, a); return Promise.resolve({ data: null, error: { code: 'TEST', message: 'запись в проверке подменена: ' + n } }); };
  sbClient.from = t => { const q = __realFrom(t); const no = () => { __rpc.push(['WRITE:' + t, null]); const r = Promise.resolve({ data: null, error: { code: 'TEST', message: 'запись в проверке подменена' } }); const c = { eq: () => c, or: () => c, in: () => c, match: () => c, select: () => c, then: r.then.bind(r) }; return c; };
    q.insert = no; q.update = no; q.upsert = no; q.delete = no;
    if (t === 'forum_follows') { const r = Promise.resolve({ data: window.__fol ? [{ author: '${OTHER}', created_at: new Date().toISOString() }] : [], error: null }); const c = { eq: () => c, order: () => c, limit: () => c, select: () => c, then: r.then.bind(r) }; q.select = () => c; }
    return q; };
  currentUser = { id: O.me || '${ME}' }; currentProfile = { id: currentUser.id, nick: ${JSON.stringify(nick)}, role: '${role}' }; currentRole = '${role}'; try { chatNick = currentProfile.nick; } catch (e) {}
  if (window.D37Age) { D37Age.group = () => O.kid ? 'kid' : 'adult'; D37Age.friendBlock = async () => (O.agePair ? 'age' : null); D37Age.contact = async () => null; }
  window.getFriendshipStatus = async () => O.friend || 'none'; window.friendBlockReason = async () => null;
  if (O.p18 === 'real') { D37Mini._t.p18set(null); try { sessionStorage.removeItem('d37_p18'); } catch (e) {} }   // как есть на сервере (метка site_config part18)
  else if (O.p18 === false) { try { sessionStorage.removeItem('d37_p18'); } catch (e) {} D37Mini._t.p18set(false, true); }   // «части 18 нет» — закреплено (на сервере она уже есть)
  else D37Mini._t.p18set(true);
  D37Follow.drop();
  window.dispatchEvent(new Event('d37:auth')); return 1;
})()`;
const CARD = (uid, nick) => `(async () => { D37Mini.close(); await D37Mini.open('${uid}', { nick: ${JSON.stringify(nick)} }); await new Promise(r => setTimeout(r, 250));
  return [...document.querySelectorAll('.d37m-acts .d37m-btn')].map(b => ({ k: b.dataset.mk || (b.dataset.mod ? 'mod:' + b.dataset.mod : ''), t: b.textContent.trim().slice(0, 200), dis: !!b.disabled })); })()`;
const SHEET = `(() => { const w = [...document.querySelectorAll('.ds4-sh')].pop(); return w ? { t: w.querySelector('.ds4-t')?.textContent || '', opts: [...w.querySelectorAll('.ds4-opt')].map(x => x.textContent.trim()), own: !!w.querySelector('[data-f="own"]') } : null; })()`;
const SHEET_GO = (o = {}) => `(async () => { const w = [...document.querySelectorAll('.ds4-sh')].pop(); if (!w) return 'нет окна';
  ${o.pick != null ? `const p = [...w.querySelectorAll('.ds4-opt')].find(x => x.dataset.pick === ${JSON.stringify(String(o.pick))}); if (!p) return 'нет варианта'; p.click();` : ''}
  ${o.own ? `const i = w.querySelector('[data-f="own"]'); i.value = '${o.own[0]}'; i.dispatchEvent(new Event('input', { bubbles: true })); w.querySelector('[data-f="ownu"]').value = '${o.own[1]}';` : ''}
  ${o.reason != null ? `w.querySelector('[data-f="reason"]').value = ${JSON.stringify(o.reason)};` : ''}
  w.querySelector('.ds4-go').click(); await new Promise(r => setTimeout(r, 350)); return 'ok'; })()`;
// надписи мельче 12 px в профиле (с учётом увеличения): [класс, размер, текст]
const SMALL = `(() => { const box = document.getElementById('profileContent'), z = parseFloat(getComputedStyle(box).zoom) || 1, out = []; const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || !el.offsetParent) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize) * z; if (fs && fs < 11.95) out.push([String(el.className || el.id || el.tagName).slice(0, 30), +fs.toFixed(1), t.slice(0, 20)]); } return out; })()`;
const LAST = name => `(() => { const r = [...(window.__rpc || [])].reverse().find(x => x[0] === '${name}'); return r ? r[1] : null; })()`;

setTimeout(() => { console.log('  ✗ зависло — больше 20 минут'); process.exit(2); }, 20 * 60e3).unref();
(async () => {
  const site = await startSite();
  let adminId = '';
  // ═══ (pages) гостем: 4 вида × страницы — ошибок в консоли нет, вбок не едет ═══
  if (want('pages')) {
    const VIEWS = [['компьютер 1440, тёмная', 1440, 900, false, 'dark'], ['компьютер 1920, светлая', 1920, 1080, false, 'light'], ['телефон 390, светлая', 390, 844, true, 'light'], ['телефон 390, тёмная', 390, 844, true, 'dark']];
    for (const [name, w, h, phone, theme] of VIEWS) {
      const B = await chrome({ w, h, phone, theme });
      try {
        await B.send('Page.navigate', { url: site.base + '/' });
        ok(await B.until(READY, 90000), `[${name}] сайт загрузился`);
        if (!adminId) adminId = await B.ev(`(async () => { const { data } = await (await sbProfiles()).select('id').eq('role', 'admin').limit(1); return (data && data[0] && data[0].id) || ''; })()`);
        const PAGES = ['/chat', '/hub', '/hub/mode/chess', '/hub/mode/e-klet', '/hub/mode/kletochki', '/hub/mode/net-takoy', '/play', '/profile/' + adminId, '/profile'];
        let wide = [], seen = 0;
        for (const p of PAGES) {
          await B.ev(`D37Route.go(${JSON.stringify(p)}), 1`);
          await sleep(p.startsWith('/profile/') ? 3500 : 1800);
          const m = await B.ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth, path: location.pathname })`);
          seen++;
          if (m.sw > m.iw + 2) wide.push(p + ' ' + m.sw + '>' + m.iw);
          await B.shot(`pages-${w}-${theme}-${p.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`);
        }
        ok(!wide.length, `[${name}] ${seen} страниц: вбок не прокручивается`, wide);
        ok(B.errs.length === 0, `[${name}] ${seen + 1} страниц: ошибок в консоли — ${B.errs.length}`, B.errs.slice(0, 6));
      } finally { await B.close(); }
    }
  }
  // ═══ (live18) часть 18 на сервере: только по запросу ONLY=live18 (обычно с BASE=https://… — живой сайт). Только чтение: метку
  //     читает сам сайт, вход подделан, каждая запись подменена; кнопки не нажимаются до отправки. ═══
  if (ONLY.has('live18')) {
    const B = await chrome({ w: 1440, h: 900, theme: 'dark' });
    const T = '[часть 18 на сервере] ';
    try {
      await B.send('Page.navigate', { url: site.base + '/' });
      ok(await B.until(READY, 90000), T + 'сайт загрузился');
      if (!adminId) adminId = await B.ev(`(async () => { const { data } = await (await sbProfiles()).select('id').eq('role', 'admin').limit(1); return (data && data[0] && data[0].id) || ''; })()`);
      ok(await B.ev(`D37Mini.p18()`) === true, T + 'сайт сам увидел метку «часть 18 выполнена» (site_config part18)');
      // гость: в карточке нет ни модерации, ни жалобы; число подписчиков в профиле видно
      let a = await B.ev(CARD(OTHER, 'Вася'));
      ok(!a.some(x => ['vkick', 'purge', 'role', 'ureport', 'follow', 'modcard', 'nickset'].includes(x.k)), T + 'гость: в карточке нет модерации, жалобы и «Следить»', a.map(x => x.k + '|' + x.t.slice(0, 24)));
      await B.ev(`D37Mini.close(), D37Route.go('/profile/${adminId}'), 1`);
      ok(await B.until(`!document.getElementById('pfwFol')?.hidden && /подписчик/.test(document.getElementById('pfwFol').textContent)`, 25000), T + 'гость: в профиле видно число подписчиков (follow_info с сервера)', await B.ev(`document.getElementById('pfwFol')?.textContent || ''`));
      await B.ev(`D37Route.go('/'), 1`); await sleep(500);
      const ROLES = [['user', 'Игрок', ['ureport'], ['vkick', 'purge', 'role', 'modcard', 'nickset']], ['helper', 'Хелпер', ['ureport', 'vkick', 'purge', 'modcard'], ['role', 'nickset']],
        ['moderator', 'Модер', ['ureport', 'vkick', 'purge', 'modcard'], ['role', 'nickset']], ['admin', 'dan4ik37', ['ureport', 'vkick', 'purge', 'role', 'modcard', 'nickset'], []]];
      for (const [role, nick, yes, no] of ROLES) {
        await B.ev(LOGIN(role, nick, { p18: 'real' }));
        await B.ev(`D37Mini.p18()`);
        a = await B.ev(CARD(OTHER, 'Вася'));
        ok(yes.every(k => a.some(x => x.k === k && !x.dis)) && no.every(k => !a.some(x => x.k === k)) && !a.some(x => /часть 18/.test(x.t)), T + `${role}: включено — ${yes.join(', ')}; нет — ${no.join(', ') || '—'}; приглушённых «после обновления базы» не осталось`, a.map(x => x.k + (x.dis ? '(выкл)' : '')));
        if (role === 'user') {
          a = await B.ev(CARD(adminId, 'dan4ik37'));
          ok(!a.some(x => x.k === 'ureport') && a.some(x => /Пожаловаться/.test(x.t) && x.dis && /создателя/.test(x.t)), T + 'игрок: на создателя сайта жалобы нет (приглушено с причиной)', a.filter(x => /Пожал/.test(x.t)));
        }
        if (role === 'helper') {
          await B.ev(`document.querySelector('.d37m [data-mk="vkick"]').click(), 1`);
          await B.until(`!!document.querySelector('.ds4-sh')`, 15000);
          const s = await B.ev(SHEET);
          ok(s && !s.opts.includes('1 день') && s.opts.includes('1 час'), T + 'хелпер: «убрать из голосового» — не дольше часа', s);
          await B.ev(`[...document.querySelectorAll('.ds4-sh')].forEach(x => x.remove()), 1`);
        }
      }
      const sent = await B.ev(`(window.__rpc || []).filter(x => /^(mod_voice_kick|mod_purge_user|mod_role_set|user_report|mod_user_report_set|follow_set|forum_follow)$/.test(x[0]) || /^WRITE:/.test(x[0])).length`);
      ok(sent === 0, T + 'за проверку ни одного вызова записи не отправлено (и подменённого тоже)', sent);
      ok(B.errs.length === 0, T + 'ошибок в консоли — ' + B.errs.length, B.errs.slice(0, 6));
    } catch (e) { ok(false, T + 'проверка упала: ' + (e.message || e)); }
    finally { await B.close(); }
  }
  // ═══ остальное — с подделанным входом ═══
  for (const prof of ['desk', 'phone']) {
    if (!['mod', 'voice', 'prof', 'fol', 'mode'].some(want)) break;
    const B = await chrome(prof === 'phone' ? { w: 390, h: 844, phone: true, theme: 'light' } : { w: 1920, h: 1080, theme: 'dark' });
    const T = prof === 'phone' ? '[390×844, светлая] ' : '[1920×1080, тёмная] ';
    try {
      await B.send('Page.navigate', { url: site.base + '/' });
      ok(await B.until(READY, 90000), T + 'сайт загрузился');
      if (!adminId) adminId = await B.ev(`(async () => { const { data } = await (await sbProfiles()).select('id').eq('role', 'admin').limit(1); return (data && data[0] && data[0].id) || ''; })()`);

      // ── (mod) карточка игрока ──
      if (want('mod')) {
        // без ч. 18 (как сейчас на сервере): пункты приглушены, функций ч. 18 никто не зовёт
        await B.ev(LOGIN('admin', 'dan4ik37', { p18: false }));
        const real = await B.ev(`D37Mini.p18()`);
        let a = await B.ev(CARD(OTHER, 'Вася'));
        const soon = a.find(x => /Из голосового/.test(x.t));
        ok(real === false && soon && soon.dis && /часть 18/.test(soon.t) && !a.some(x => ['vkick', 'purge', 'role', 'ureport'].includes(x.k)), T + 'без ч. 18: «Из голосового · сообщения · роль» — приглушено с причиной, рабочих кнопок нет', a.map(x => x.k + '|' + x.t.slice(0, 30)));
        ok(a.some(x => /Пожаловаться/.test(x.t) && x.dis && /скоро/.test(x.t)), T + 'без ч. 18: «Пожаловаться» на человека — «скоро»');
        const called = await B.ev(`__rpc.filter(x => /^(mod_voice_kick|mod_purge_user|mod_role_set|user_report|mod_user_reports|cv_ping2|follow_info|follow_set|follow_feed|follow_list|part18_info)$/.test(x[0])).length`);
        ok(called === 0, T + 'без ч. 18: функции части 18 не вызываются (в консоли нет «функция не найдена»)', called);
        // с ч. 18: админ
        await B.ev(LOGIN('admin', 'dan4ik37', {}));
        a = await B.ev(CARD(OTHER, 'Вася'));
        ok(['vkick', 'purge', 'role', 'ureport', 'modcard', 'nickset'].every(k => a.some(x => x.k === k && !x.dis)), T + 'админ: из голосового, последние сообщения, роль, жалоба на человека, «ещё», ник — все рабочие', a.map(x => x.k));
        // из голосового
        await B.ev(`document.querySelector('.d37m [data-mk="vkick"]').click(), 1`);
        ok(await B.until(`!!document.querySelector('.ds4-sh')`, 15000), T + '«Убрать из голосового»: окно открылось');
        let s = await B.ev(SHEET);
        ok(s && s.opts.length === 5 && s.opts.includes('1 день') && /Вернуть/.test(s.opts[4]), T + 'сроки: 1 мин / 10 мин / 1 час / 1 день / вернуть', s);
        await B.ev(SHEET_GO({ pick: 60, reason: 'шумит' }));
        let r = await B.ev(LAST('mod_voice_kick'));
        ok(r && r.p_user === OTHER && r.p_minutes === 60 && r.p_reason === 'шумит' && r.p_channel === null, T + 'вызов mod_voice_kick: человек, 60 минут, причина', r);
        // последние сообщения
        await B.ev(CARD(OTHER, 'Вася')); await B.ev(`document.querySelector('.d37m [data-mk="purge"]').click(), 1`);
        await B.until(`!!document.querySelector('.ds4-sh')`, 8000);
        await B.ev(SHEET_GO({ pick: 50, reason: 'спам' }));
        r = await B.ev(LAST('mod_purge_user'));
        ok(r && r.p_user === OTHER && r.p_n === 50 && r.p_cid === null && r.p_reason === 'спам', T + 'вызов mod_purge_user: 50 последних, сервер сайта', r);
        // роль
        await B.ev(CARD(OTHER, 'Вася')); await B.ev(`document.querySelector('.d37m [data-mk="role"]').click(), 1`);
        await B.until(`!!document.querySelector('.ds4-sh')`, 8000);
        s = await B.ev(SHEET);
        ok(s && s.opts.length === 3 && !s.opts.some(x => /админ/i.test(x)), T + 'роли: без роли / хелпер / модератор (админа в списке нет)', s);
        await B.ev(SHEET_GO({ pick: 'helper', reason: 'помогает' }));
        r = await B.ev(LAST('mod_role_set'));
        ok(r && r.p_user === OTHER && r.p_role === 'helper', T + 'вызов mod_role_set: хелпер', r);
        // роль читается с сервера, а не из памяти страницы: у хелпера, которого страница «не знает», снять роль можно
        await B.ev(`(() => { window.__sbp = window.sbProfiles; window.sbProfiles = async () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ role: 'helper' }], error: null }) }) }) }); __rpc.length = 0; D37Mod.roleSet('${OTHER}', 'Вася', undefined); })()`);
        await B.until(`!!document.querySelector('.ds4-sh .ds4-opt.on')`, 8000);
        const pre = await B.ev(`document.querySelector('.ds4-sh .ds4-opt.on')?.dataset.pick`);
        await B.ev(SHEET_GO({ pick: 'user', reason: '' }));
        r = await B.ev(LAST('mod_role_set'));
        await B.ev(`window.sbProfiles = window.__sbp, typeof D37Phone.dropProf`);
        ok(pre === 'helper' && r && r.p_role === 'user' && await B.ev(`typeof D37Phone.dropProf`) === 'function', T + 'роль: текущая взята с сервера (выбран «Хелпер»), «Без роли» уходит на сервер; P.dropProf есть', { pre, r });
        // жалоба на человека
        await B.ev(CARD(OTHER, 'Вася')); await B.ev(`document.querySelector('.d37m [data-mk="ureport"]').click(), 1`);
        await B.until(`!!document.querySelector('.ds4-sh')`, 8000);
        await B.ev(SHEET_GO({ pick: 'nick', reason: 'а' }));
        const short = await B.ev(LAST('user_report'));
        await B.ev(CARD(OTHER, 'Вася')); await B.ev(`document.querySelector('.d37m [data-mk="ureport"]').click(), 1`);
        await B.until(`!!document.querySelector('.ds4-sh')`, 8000);
        await B.ev(SHEET_GO({ pick: 'nick', reason: 'оскорбительный ник' }));
        r = await B.ev(LAST('user_report'));
        ok(!short && r && r.p_user === OTHER && r.p_kind === 'nick' && r.p_reason === 'оскорбительный ник', T + 'жалоба на человека: без текста не уходит; с текстом — user_report (вид «ник»)', { short, r });
        // роли: модератор — без «роль» и ника; хелпер — сроки до часа; игрок — только жалоба
        await B.ev(LOGIN('moderator', 'Модер', {}));
        a = await B.ev(CARD(OTHER, 'Вася'));
        ok(a.some(x => x.k === 'vkick') && a.some(x => x.k === 'purge') && !a.some(x => x.k === 'role' || x.k === 'nickset'), T + 'модератор: из голосового и сообщения — да; роль и ник — нет', a.map(x => x.k));
        await B.ev(LOGIN('helper', 'Хелпер', {}));
        await B.ev(CARD(OTHER, 'Вася')); await B.ev(`document.querySelector('.d37m [data-mk="vkick"]').click(), 1`);
        await B.until(`!!document.querySelector('.ds4-sh')`, 8000);
        s = await B.ev(SHEET);
        ok(s && !s.opts.includes('1 день') && s.opts.includes('1 час'), T + 'хелпер: «убрать из голосового» — не дольше часа', s);
        await B.ev(`[...document.querySelectorAll('.ds4-sh')].forEach(x => x.remove()), 1`);
        await B.ev(LOGIN('user', 'Игрок', {}));
        a = await B.ev(CARD(OTHER, 'Вася'));
        ok(a.some(x => x.k === 'ureport' && !x.dis) && !a.some(x => ['vkick', 'purge', 'role', 'modcard'].includes(x.k)), T + 'игрок: «Пожаловаться» работает, модерации нет', a.map(x => x.k));
        a = await B.ev(CARD(ME, 'Игрок'));
        ok(!a.some(x => ['ureport', 'vkick', 'follow', 'block'].includes(x.k)), T + 'своя карточка: без жалобы, слежки и блокировки', a.map(x => x.k));
        // свой срок тайм-аута (🛡 карточка человека)
        await B.ev(LOGIN('moderator', 'Модер', {}));
        await B.ev(`D37Mini.close(), D37Mod.member('${OTHER}', 'Вася'), 1`);
        ok(await B.until(`!!document.querySelector('.dm-cacts [data-ca="mute"]')`, 15000), T + '🛡 карточка человека открылась');
        const acts = await B.ev(`[...document.querySelectorAll('.dm-cacts [data-ca]')].map(b => b.dataset.ca)`);
        ok(acts.includes('vkick') && acts.includes('purge') && !acts.includes('role'), T + '🛡 карточка: «из голосового» и «последние сообщения» есть (роль — только админу)', acts);
        await B.ev(`document.querySelector('.dm-cacts [data-ca="mute"]').click(), 1`);
        await B.until(`document.querySelectorAll('.ds4-sh').length >= 2`, 8000);
        s = await B.ev(SHEET);
        ok(s && s.own, T + 'тайм-аут: есть поле «свой срок»', s);
        await B.ev(SHEET_GO({ own: ['90', '60'], reason: 'флуд' }));
        r = await B.ev(LAST('chat_mod'));
        ok(r && r.p_action === 'mute' && r.p_minutes === 5400, T + 'свой срок 90 часов → chat_mod на 5400 минут', r);
        const before = await B.ev(`__rpc.filter(x => x[0] === 'chat_mod').length`);
        await B.ev(`document.querySelector('.dm-cacts [data-ca="mute"]').click(), 1`);
        await B.until(`document.querySelectorAll('.ds4-sh').length >= 2`, 8000);
        await B.ev(SHEET_GO({ own: ['9', '1440'], reason: '' }));
        ok(await B.ev(`__rpc.filter(x => x[0] === 'chat_mod').length`) === before, T + 'свой срок 9 дней — отказ на сайте (не дольше 7 дней), вызова нет');
        // непонятный свой срок (0) — отказ с объяснением, а не час молча; очистил поле — готовый срок возвращается
        await B.ev(`document.querySelector('.dm-cacts [data-ca="mute"]').click(), 1`);
        await B.until(`document.querySelectorAll('.ds4-sh').length >= 2`, 8000);
        await B.ev(SHEET_GO({ own: ['0', '60'], reason: '' }));
        ok(await B.ev(`__rpc.filter(x => x[0] === 'chat_mod').length`) === before, T + 'свой срок «0» — отказ, вызова нет (раньше молча ставился час)');
        await B.ev(`document.querySelector('.dm-cacts [data-ca="mute"]').click(), 1`);
        await B.until(`document.querySelectorAll('.ds4-sh').length >= 2`, 8000);
        const back = await B.ev(`(() => { const w = [...document.querySelectorAll('.ds4-sh')].pop(), i = w.querySelector('[data-f="own"]'); const was = w.querySelector('.ds4-opt.on')?.dataset.pick; i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); const off = !w.querySelector('.ds4-opt.on');
          i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return { was, off, now: w.querySelector('.ds4-opt.on')?.dataset.pick }; })()`);
        await B.ev(SHEET_GO({ reason: 'флуд' }));
        r = await B.ev(LAST('chat_mod'));
        ok(back.off && back.now === back.was && r && r.p_minutes === +back.was, T + `вписал и стёр свой срок — готовый срок вернулся (${back.was} мин) и ушёл на сервер`, { back, r });
        await B.ev(`[...document.querySelectorAll('.ds4-sh')].forEach(x => x.remove()), 1`);
        // 🛡 центр: жалобы на людей
        if (prof === 'desk') {
          await B.ev(`D37Route.go('/chat/reports/reports'), 1`);
          ok(await B.until(`!!document.querySelector('.dm-chip[data-kd="user"]')`, 25000), T + '🛡 Жалобы: появилась метка «👤 Люди»');
          await B.ev(`document.querySelector('.dm-chip[data-kd="user"]').click(), 1`);
          ok(await B.until(`!!document.querySelector('[data-uk]')`, 10000), T + 'список жалоб на людей показан', await B.ev(`({ body: (document.querySelector('.dm-body')?.textContent || '').slice(0, 300), calls: __rpc.slice(-6).map(x => x[0]) })`));
          const row = await B.ev(`(() => { const x = document.querySelector('[data-uk]'); return { text: x.textContent, html: x.querySelector('b').innerHTML, xss: !!window.__xss, img: !!x.querySelector('img'), btn: [...x.querySelectorAll('[data-ua]')].map(b => b.dataset.ua) }; })()`);
          ok(/Вася/.test(row.text) && /ник, в голосовом/.test(row.text) && row.html.includes('&lt;b&gt;') && !row.xss && !row.img && row.btn.join() === 'work,done,rejected,card', T + 'строка жалобы: ник и причина — текстом (разметка не выполняется), кнопки статусов', row);
          await B.ev(`document.querySelector('[data-ua="work"]').click(), 1`); await sleep(400);
          r = await B.ev(LAST('mod_user_report_set'));
          ok(r && r.p_user === OTHER && r.p_state === 'work', T + '«В работу» → mod_user_report_set', r);
          await B.ev(`D37Route.go('/'), 1`); await sleep(600);
        }
      }

      // ── (voice) убрали из голосового ──
      if (want('voice') && prof === 'desk') {
        await B.ev(LOGIN('user', 'Игрок', {}));
        const joined = await B.ev(`D37Calls.voiceJoin({ kind: 'official', channel: -2, title: 'Тихий · Денчик37', name: 'Тихий' }).then(r => !!r.ok)`);
        ok(joined && await B.until(`D37Calls._test.state()?.state === 'live' && typeof D37Calls._test.state().ping18 === 'function'`, 20000), T + 'вошёл в голосовой (сервер подменён)');
        await sleep(300);
        // сосед убран: R.banned → его нет в плане комнаты
        const drop = await B.ev(`(async () => { const s = D37Calls._test.state(), R = s.room; window.__ping2 = { ok: true, kicked: false, out: ['${OTHER}'] }; await s.ping18(); return { banned: R.banned ? [...R.banned] : null, live: s.state }; })()`);
        ok(drop.banned && drop.banned[0] === OTHER && drop.live === 'live', T + 'cv_ping2 сказал «соседа убрали» — он в списке отключённых, я остаюсь', drop);
        const out = await B.ev(`(async () => { const s = D37Calls._test.state(); window.__ping2 = { ok: false, kicked: true, until: new Date(Date.now() + 9 * 60e3).toISOString(), reason: 'шумит', out: [] }; await s.ping18(); await new Promise(r => setTimeout(r, 500)); const st = D37Calls._test.state(); return { state: st ? st.state : 'нет', reason: st ? st.reason : '' }; })()`);
        ok(out.state !== 'live' && out.reason === 'kicked', T + 'cv_ping2 сказал «тебя убрали» — сам вышел из канала', out);
        await sleep(3000);
        await B.ev(LOGIN('user', 'Игрок', { kickErr: true }));
        const again = await B.ev(`D37Calls.voiceJoin({ kind: 'official', channel: -2, title: 'Тихий · Денчик37', name: 'Тихий' }).then(r => r.err || 'вошёл')`);
        ok(/убрал тебя из этого канала/.test(again) && /7 мин/.test(again), T + 'вход раньше срока: «Модератор убрал тебя… через 7 мин» (а не ошибка сервера)', again);
        // без ч. 18 — старый cv_ping
        await B.ev(LOGIN('user', 'Игрок', { p18: false }));
        await B.ev(`D37Calls.voiceJoin({ kind: 'official', channel: -1, title: 'Игра · Денчик37', name: 'Игра' })`);
        await B.until(`D37Calls._test.state()?.state === 'live' && typeof D37Calls._test.state().ping18 === 'function'`, 20000);
        await B.ev(`__rpc.length = 0, D37Calls._test.state().ping18()`); await sleep(300);
        const names = await B.ev(`__rpc.map(x => x[0])`);
        ok(names.includes('cv_ping') && !names.includes('cv_ping2'), T + 'без ч. 18: «я ещё тут» — старым cv_ping', names);
        await B.ev(`D37Calls.leave(), 1`); await sleep(3000);
      }

      // ── (prof) профиль на ширину экрана ──
      if (want('prof') && adminId) {
        await B.ev(LOGIN('user', 'Игрок', {}));
        await B.ev(`D37Route.go('/profile/${adminId}'), 1`);
        ok(await B.until(`document.getElementById('profileNick')?.textContent.length > 0 && !!document.querySelector('.pfw-cols')`, 25000), T + 'чужой профиль открылся в широкой раскладке');
        await sleep(3500);
        const m = await B.ev(`(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), w: Math.round(b.width), t: Math.round(b.top) }; };
          const fs = s => { const e = document.querySelector(s); return e ? parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(document.getElementById('profileContent')).zoom) || 1) : 0; };
          return { vw: innerWidth, head: r('.pf-head'), about: r('.pfw-about'), right: r('.pfw-right'), sw: document.documentElement.scrollWidth,
            tabs: [...document.querySelectorAll('.pfw-tab')].filter(t => !t.hidden).map(t => t.dataset.pfw), sel: document.querySelector('.pfw-tab[aria-selected="true"]')?.dataset.pfw,
            panes: [...document.querySelectorAll('.pfw-pane')].filter(p => !p.hidden).map(p => p.dataset.pane), title: getComputedStyle(document.querySelector('#profile-page > .sec-title')).width,
            f: { nick: fs('.pf-nick'), q: fs('.pf2-q span'), kick: fs('.pff-t') || fs('.pf-kicker'), psc: fs('.psc-l'), tab: fs('.pfw-tab') }, fw: document.getElementById('profileAddFriendWrap')?.parentElement?.className || '' }; })()`);
        if (prof === 'desk') {
          ok(m.head.w >= m.vw * 0.85 && m.about && m.right && m.right.l > m.about.l + m.about.w - 4 && m.right.w > m.about.w * 2, T + `профиль занимает ширину экрана: шапка ${m.head.w} из ${m.vw}, слева «о человеке» ${m.about?.w}, справа вкладки ${m.right?.w}`, m);
          ok(Math.min(m.f.q, m.f.kick, m.f.psc) >= 13 && m.f.nick >= 30 && m.f.tab >= 16, T + `текст крупный: подписи ≥ 13 px (${Math.round(m.f.q)} / ${Math.round(m.f.kick)} / ${Math.round(m.f.psc)}), ник ${Math.round(m.f.nick)}, вкладки ${Math.round(m.f.tab)}`, m.f);
        } else {
          ok(m.sw <= m.vw + 2 && m.about.w >= m.vw * 0.85 && m.right.w >= m.vw * 0.85 && m.right.t > m.about.t, T + 'телефон: одна колонка на всю ширину, вбок не едет', m);
          ok(Math.min(m.f.q, m.f.kick, m.f.psc) >= 11.5 && m.f.tab >= 14, T + `телефон: подписи не меньше 11,5 px (${m.f.q.toFixed(1)} / ${m.f.kick.toFixed(1)} / ${m.f.psc.toFixed(1)})`, m.f);
        }
        // ни одной надписи мельче 12 px (с учётом увеличения) — на каждой вкладке, разделы развёрнуты
        const small = await B.ev(`(async () => { const out = []; for (const t of [...document.querySelectorAll('.pfw-tab')].filter(t => !t.hidden).map(t => t.dataset.pfw)) { pfwAuto = false; pfwTab(t); await new Promise(r => setTimeout(r, 250)); out.push(...(${SMALL})); } pfwAuto = true; pfwSync(); return out; })()`);
        ok(small.length === 0, T + 'чужой профиль: надписей мельче 12 px нет', small.slice(0, 8));
        const badge = await B.ev(`(() => { const b = document.querySelector('#profileRoleBadge .role-badge'); if (!b) return null; const z = parseFloat(getComputedStyle(document.getElementById('profileContent')).zoom) || 1; return { fs: parseFloat(getComputedStyle(b).fontSize) * z, color: getComputedStyle(b).color }; })()`);
        ok(badge && badge.fs >= 12 && (prof !== 'phone' || badge.color === 'rgb(176, 0, 40)'), T + `значок роли у ника: ${badge ? badge.fs.toFixed(1) : '?'} px${prof === 'phone' ? ', в светлой теме тёмно-красный' : ''}`, badge);
        ok(m.tabs.length >= 1 && m.tabs.every(t => ['over', 'ach'].includes(t)) && m.sel === m.tabs[0] && m.panes.length === 1 && m.panes[0] === m.sel && m.title === '1px', T + 'чужой профиль: вкладки «Обзор / Ачивки», своих («Друзья», «Моё», «Подписки») нет; выбрана первая; заголовок «Профиль» не занимает экран', m);
        ok(/pf-hrow/.test(m.fw), T + 'кнопки (в друзья / следить / ⋯) — в шапке рядом с ником', m.fw);
        const row = await B.ev(`(() => { const L = [...document.querySelectorAll('#profileAddFriendWrap > *')].filter(x => x.offsetParent); const tops = L.map(x => Math.round(x.getBoundingClientRect().top)); const sb = document.getElementById('profileStatusEditBtn');
          return { n: L.length, spread: Math.max(...tops) - Math.min(...tops), txt: L.map(x => x.textContent.trim()), pencil: !!sb.offsetParent }; })()`);
        ok(row.n >= 3 && row.spread <= 6 && !row.pencil, T + `кнопки шапки в один ряд (${row.txt.join(' | ')}); у чужого профиля карандаша статуса нет`, row);
        if (m.tabs.includes('ach') && m.tabs.length > 1) {
          await B.ev(`document.querySelector('.pfw-tab[data-pfw="ach"]').click(), 1`); await sleep(300);
          const t2 = await B.ev(`({ sel: document.querySelector('.pfw-tab[aria-selected="true"]').dataset.pfw, vis: !document.getElementById('profileAchievementsCard').closest('.pfw-pane').hidden, over: document.querySelector('.pfw-pane[data-pane="over"]').hidden })`);
          ok(t2.sel === 'ach' && t2.vis && t2.over, T + 'вкладка «Ачивки и уровень» переключается', t2);
          await sleep(1500);
          ok(await B.ev(`document.querySelector('.pfw-tab[aria-selected="true"]').dataset.pfw`) === 'ach', T + 'выбранная вкладка не сбрасывается, когда догружаются карточки');
        }
        await B.shot(`prof-${prof}-other`);
        // свой профиль (как будто вошёл владелец страницы; запись подменена): вкладки «Друзья», «Моё», «Подписки»
        await B.ev(LOGIN('user', 'Игрок', { me: adminId }));
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(500);
        await B.ev(`D37Route.go('/profile'), 1`);
        await B.until(`document.getElementById('profileNick')?.textContent.length > 0`, 25000); await sleep(3500);
        const own = await B.ev(`({ tabs: [...document.querySelectorAll('.pfw-tab')].filter(t => !t.hidden).map(t => t.dataset.pfw), feed: !!document.querySelector('#pfwFeed .fol-item'), sw: document.documentElement.scrollWidth, vw: innerWidth })`);
        ok(['feed', 'friends', 'set'].every(t => own.tabs.includes(t)) && own.sw <= own.vw + 2, T + 'свой профиль: есть вкладки «Подписки», «Друзья», «Моё»', own);
        await B.ev(`pfwReveal('profileAccountSettings'), 1`); await sleep(400);
        ok(await B.ev(`document.querySelector('.pfw-tab[aria-selected="true"]').dataset.pfw === 'set' && !document.getElementById('profileAccountSettings').closest('.pfw-pane').hidden && !document.getElementById('profileAccountSettings').closest('.pff').classList.contains('folded')`), T + 'ссылка на карточку из другой вкладки сама открывает нужную вкладку и разворачивает раздел');
        await B.shot(`prof-${prof}-own`);
        // ── второй проход (PROFILE_FOLD): сворачивание разделов, длинные списки, пустые места, статус ──
        await B.ev(`(() => { try { localStorage.removeItem('d37_pf_fold'); } catch (e) {} pffSt = null;
          const box = document.getElementById('profileGameStats'); box.innerHTML = Array.from({ length: 22 }, (_, i) => '<a class="pgs-item" href="/play/chess"><span class="pgs-ic">🎮</span><span class="pgs-txt"><b>Игра ' + (i + 1) + '</b><small>1 игр</small></span></a>').join('');
          document.getElementById('profileGameStatsSum').textContent = '73 партии · 42 побед'; document.getElementById('profileGameStatsCard').hidden = false;
          pfwAuto = false; pfwSync(); pfwTab('over'); pfwSync(); })()`);
        await sleep(500);
        let f = await B.ev(`(() => { const sec = document.querySelector('.pff[data-fold="games"]'), h = sec.querySelector('.pff-h'), items = [...document.querySelectorAll('#profileGameStats > *')];
          return { tag: h.tagName, ti: h.tabIndex, exp: h.getAttribute('aria-expanded'), ctl: h.getAttribute('aria-controls'), chev: !!h.querySelector('.pff-c'), hh: Math.round(h.getBoundingClientRect().height), hw: Math.round(h.getBoundingClientRect().width), sw: Math.round(sec.getBoundingClientRect().width),
            shown: items.filter(x => x.offsetParent).length, more: document.querySelector('#profileGameStats + .pff-more')?.textContent || '', n: document.querySelectorAll('.pff:not([hidden])').length }; })()`);
        ok(f.tag === 'BUTTON' && f.ti === 0 && f.exp === 'true' && f.ctl === 'profileGameStatsCard' && f.chev && f.hh >= 44 && f.hw >= f.sw - 4, T + `заголовок раздела — кнопка на всю ширину (${f.hw}×${f.hh}), со стрелкой, достижима с клавиатуры`, f);
        ok(f.shown === 6 && /Показать все \(22\)/.test(f.more), T + '«Игры на сайте»: из 22 видно 6 и кнопка «Показать все (22)»', f);
        await B.ev(`document.querySelector('#profileGameStats + .pff-more').click(), 1`); await sleep(300);
        ok(await B.ev(`[...document.querySelectorAll('#profileGameStats > *')].filter(x => x.offsetParent).length === 22 && /Свернуть список/.test(document.querySelector('#profileGameStats + .pff-more').textContent)`), T + '«Показать все» раскрывает список, кнопка становится «Свернуть список»');
        await B.ev(`document.querySelector('.pff[data-fold="games"] .pff-h').click(), 1`); await sleep(300);
        f = await B.ev(`(() => { const sec = document.querySelector('.pff[data-fold="games"]'); let st = null; try { st = JSON.parse(localStorage.getItem('d37_pf_fold')); } catch (e) {}
          return { folded: sec.classList.contains('folded'), exp: sec.querySelector('.pff-h').getAttribute('aria-expanded'), sum: sec.querySelector('.pff-s').textContent, sumVis: !!sec.querySelector('.pff-s').offsetParent, body: !!document.getElementById('profileGameStats').offsetParent, h: Math.round(sec.getBoundingClientRect().height), st }; })()`);
        ok(f.folded && f.exp === 'false' && !f.body && f.sumVis && /73 партии · 42 побед · лучшие: Игра 1, Игра 2, Игра 3/.test(f.sum) && f.h < 110, T + 'нажал на заголовок — раздел свёрнут в одну строку: «73 партии · 42 побед · лучшие: …»', f);
        ok(f.st && f.st.v === 1 && f.st.f.games === true && f.st.m.games === true, T + 'выбор запомнен на устройстве (d37_pf_fold)', f.st);
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(400); await B.ev(`pffSt = null, D37Route.go('/profile'), 1`);
        await B.until(`document.getElementById('profileNick')?.textContent.length > 0`, 25000); await sleep(2500);
        ok(await B.ev(`document.querySelector('.pff[data-fold="games"]').classList.contains('folded')`), T + 'вернулся в профиль — раздел остался свёрнутым');
        // «свернуть всё / развернуть всё»
        f = await B.ev(`(async () => { const all = document.querySelector('.pfw-all'), vis = () => [...document.querySelectorAll('.pff')].filter(s => !s.hidden); const t0 = all.textContent; all.click(); await new Promise(r => setTimeout(r, 300));
          const a = vis().every(s => s.classList.contains('folded')), t1 = all.textContent;
          all.click(); await new Promise(r => setTimeout(r, 300)); const b = vis().every(s => !s.classList.contains('folded')); return { t0, t1, t2: all.textContent, a, b, n: vis().length, tag: all.tagName }; })()`);
        ok(/Свернуть всё/.test(f.t0) && f.a && /Развернуть всё/.test(f.t1) && f.b && /Свернуть всё/.test(f.t2) && f.tag === 'BUTTON' && f.n >= 5, T + `одна кнопка «Свернуть всё / Развернуть всё» сворачивает и разворачивает все разделы (${f.n})`, f);
        // хранилище недоступно — сворачивание всё равно работает
        f = await B.ev(`(async () => { const real = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('нет хранилища'); }; let err = '';
          try { document.querySelector('.pff[data-fold="about"] .pff-h').click(); await new Promise(r => setTimeout(r, 250)); } catch (e) { err = String(e); }
          const folded = document.querySelector('.pff[data-fold="about"]').classList.contains('folded'); Storage.prototype.setItem = real; document.querySelector('.pff[data-fold="about"] .pff-h').click(); await new Promise(r => setTimeout(r, 200)); return { err, folded }; })()`);
        ok(!f.err && f.folded, T + 'без хранилища браузера разделы сворачиваются (просто не запоминается)', f);
        // карточка «Планета D37» — по содержимому, в колонке «о человеке»; статус; пустых блоков нет
        ok(await B.until(`!!document.querySelector('.pfw-about .hub-pcard')`, 8000), T + 'карточка «Планета D37» — в левой колонке');
        f = await B.ev(`(() => { const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; }; const pc = r('.pfw-about .hub-pcard'), z = parseFloat(getComputedStyle(document.getElementById('profileContent')).zoom) || 1;
          const btn = document.getElementById('profileStatusEditBtn'), about = document.querySelector('.pfw-about');
          const empty = [...document.querySelectorAll('.pff:not([hidden]):not(.folded) .pff-b > *')].filter(c => c.offsetParent && c.getBoundingClientRect().height > 320 * z && c.textContent.trim().length < 40).map(c => c.id);
          return { pch: Math.round(pc.height / z), st: btn.textContent, stVis: !!btn.offsetParent, view: !!document.getElementById('profileStatusView').offsetParent, pos: getComputedStyle(about).position, empty, sw: document.documentElement.scrollWidth, vw: innerWidth }; })()`);
        ok(f.pch <= 150 && f.empty.length === 0 && f.sw <= f.vw + 2, T + `карточка «Планета D37» по содержимому (высота ${f.pch} px, была 356), больших пустых блоков нет`, f);
        ok(/Добавить статус/.test(f.st) && f.stVis && !f.view, T + 'пустой статус: ссылка «＋ Добавить статус» вместо одинокого карандаша', f);
        if (prof === 'desk') ok(f.pos === 'sticky', T + 'левая колонка едет вместе с прокруткой (под ней нет пустого столба)', f.pos);
        await B.shot(`prof-${prof}-own-fold`);
        await B.ev(`(() => { try { localStorage.removeItem('d37_pf_fold'); } catch (e) {} pffSt = null; })()`);
      }

      // ── (fol) «Следить» ──
      if (want('fol') && adminId) {
        await B.ev(`window.__fol = false, window.__bell = false, 1`);
        await B.ev(LOGIN('user', 'Игрок', {}));
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(400);
        await B.ev(`D37Route.go('/profile/${adminId}'), 1`);
        ok(await B.until(`!!document.querySelector('#profileAddFriendWrap .fol-btn')`, 25000), T + 'в чужом профиле есть кнопка «Следить»');
        let f = await B.ev(`({ t: document.querySelector('button.fol-btn').textContent, cnt: document.getElementById('pfwFol')?.textContent || '', bellHidden: document.querySelector('.fol-bell').hidden })`);
        ok(/Следить/.test(f.t) && /12 подписчиков/.test(f.cnt) && f.bellHidden, T + '«🔔 Следить», «12 подписчиков», колокольчик спрятан, пока не следишь', f);
        await B.ev(`document.querySelector('button.fol-btn').click(), 1`); await sleep(500);
        f = await B.ev(`({ t: document.querySelector('button.fol-btn').textContent, cnt: document.getElementById('pfwFol').textContent, bell: document.querySelector('.fol-bell').hidden ? '' : document.querySelector('.fol-bell').textContent, call: ${LAST('follow_set')} })`);
        ok(/Слежу/.test(f.t) && /13 подписчиков/.test(f.cnt) && f.bell === '🔕' && f.call.p_user === adminId && f.call.p_on === true && f.call.p_notify === null, T + 'нажал: «✓ Слежу», счётчик 13, колокольчик выключен по умолчанию', f);
        await B.ev(`document.querySelector('.fol-bell').click(), 1`); await sleep(500);
        f = await B.ev(`({ bell: document.querySelector('.fol-bell').textContent, call: ${LAST('follow_set')} })`);
        ok(f.bell === '🔔' && f.call.p_notify === true, T + 'колокольчик включается отдельным нажатием', f);
        await B.ev(`document.querySelector('button.fol-btn').click(), 1`); await sleep(500);
        ok(/Следить/.test(await B.ev(`document.querySelector('button.fol-btn').textContent`)) && (await B.ev(LAST('follow_set'))).p_on === false, T + 'второе нажатие — «не следить»');
        // мини-карточка: «Следить» там же
        const a = await B.ev(CARD(OTHER, 'Вася'));
        ok(a.some(x => x.k === 'follow' && /Следить/.test(x.t)), T + 'мини-карточка: есть «🔔 Следить»', a.map(x => x.k + '|' + x.t.slice(0, 20)));
        await B.ev(`D37Mini.close(), 1`);
        // возраст: сервер сказал «нельзя по возрасту» — кнопки нет, причина текстом
        await B.ev(LOGIN('user', 'Игрок', { folInfo: { can: false, why: 'age' } }));
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(400); await B.ev(`D37Route.go('/profile/${adminId}'), 1`);
        await B.until(`document.getElementById('profileNick')?.textContent.length > 0`, 25000); await sleep(2500);
        f = await B.ev(`({ btn: !!document.querySelector('button.fol-btn'), note: document.querySelector('span.fol-btn')?.textContent || '' })`);
        ok(!f.btn && f.note.length > 5, T + 'через возрастную границу кнопки «Следить» нет — только объяснение', f);
        // без ч. 18: работает на forum_follow, счётчика и колокольчика нет
        await B.ev(`window.__fol = false, 1`);
        await B.ev(LOGIN('user', 'Игрок', { p18: false }));
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(400); await B.ev(`D37Route.go('/profile/${adminId}'), 1`);
        ok(await B.until(`!!document.querySelector('button.fol-btn')`, 25000), T + 'без ч. 18: кнопка «Следить» есть');
        await B.ev(`__rpc.length = 0, document.querySelector('button.fol-btn').click(), 1`); await sleep(600);
        f = await B.ev(`({ t: document.querySelector('button.fol-btn').textContent, names: __rpc.map(x => x[0]), cnt: document.getElementById('pfwFol').hidden, bell: document.querySelector('.fol-bell').hidden })`);
        ok(/Слежу/.test(f.t) && f.names.includes('forum_follow') && !f.names.some(x => /^follow_/.test(x)) && f.cnt && f.bell, T + 'без ч. 18: «Следить» идёт через forum_follow (уже на сервере); счётчика и колокольчика нет', f);
        // лента в своём профиле
        await B.ev(`window.__fol = true, 1`);
        await B.ev(LOGIN('user', 'Игрок', { me: adminId }));
        await B.ev(`D37Route.go('/chat'), 1`); await sleep(400); await B.ev(`D37Route.go('/profile'), 1`);
        ok(await B.until(`document.querySelectorAll('#pfwFeed .fol-item').length === 3`, 25000), T + 'свой профиль, «Подписки»: в ленте 3 записи');
        const fd = await B.ev(`(() => { const L = [...document.querySelectorAll('#pfwFeed .fol-item')]; return { href: L.map(a => a.getAttribute('href')), t0: L[0].querySelector('b').textContent, script: !!document.querySelector('#pfwFeed script'), i: !!document.querySelector('#pfwFeed .fol-item i, #pfwFeed .fol-pn i'), who: document.querySelector('#pfwFeed .fol-pn')?.textContent, mine: document.getElementById('pfwFol').textContent }; })()`);
        // две перерисовки подряд (два быстрых «✕») — блок «Слежу за» один; новый профиль начал открываться — кнопка и число прошлого убраны сразу
        const dbl = await B.ev(`(async () => { D37Follow.profile(currentUser.id, true); D37Follow.profile(currentUser.id, true); await new Promise(r => setTimeout(r, 1200)); const n = document.querySelectorAll('#pfwFeed .fol-ppl').length, items = document.querySelectorAll('#pfwFeed .fol-item').length;
          const a = !document.getElementById('pfwFol').hidden; D37Follow.reset(); const b = document.getElementById('pfwFol').hidden && document.getElementById('pfwFeed').hidden; D37Follow.profile(currentUser.id, true); await new Promise(r => setTimeout(r, 1000)); return { n, items, a, b }; })()`);
        ok(dbl.n === 1 && dbl.items === 3 && dbl.a && dbl.b, T + 'лента «Подписки»: при двойной перерисовке блок «Слежу за» один; D37Follow.reset сразу прячет число и ленту', dbl);
        ok(fd.href.join() === '/forum/42,#/games/studio/play/g1,#/games/unity/play/u1' && /<script>/.test(fd.t0) && !fd.script && !fd.i && /Автор<i>/.test(fd.who) && /слежу за 3/.test(fd.mine), T + 'лента: ссылки на статью и игры; чужой текст — как текст; список «за кем слежу»', fd);
        await B.shot(`fol-${prof}-feed`);
      }

      // ── (mode) страница режима ──
      if (want('mode')) {
        await B.ev(LOGIN('user', 'Игрок', {}));
        await B.ev(`D37Route.go('/hub/mode/chess'), 1`);
        ok(await B.until(`!!document.querySelector('.md-play')`, 20000), T + 'страница игры «Шахматы» открылась');
        await sleep(1200);
        let m = await B.ev(`({ h1: document.querySelector('.md-h1').textContent, play: document.querySelector('.md-play').getAttribute('href'), desc: document.querySelector('.md-desc').textContent.length, pic: document.querySelector('.md-pic').classList.contains('has'),
          now: document.querySelector('.md-now .md-h2').textContent, rules: [...document.querySelectorAll('.md-btn')].map(b => b.getAttribute('href') || b.textContent), sw: document.documentElement.scrollWidth, vw: innerWidth, age: document.querySelector('.md-age')?.textContent || '' })`);
        ok(/Шахматы/.test(m.h1) && m.play === '/play/chess' && m.desc > 20 && m.pic && /Сейчас играют/.test(m.now) && m.rules.includes('/games/chess') && m.sw <= m.vw + 2, T + 'название, описание, картинка, «▶ Играть» → /play/chess, «Правила», «Сейчас играют»', m);
        // «кто играет»: человек из общего «кто онлайн» с занятием «играет в шахматы»
        const ppl = await B.ev(`(() => { const real = D37Chat.online; D37Chat.online = () => ({ total: 2, users: [{ id: '${OTHER}', nick: 'Вася<b>', a: 'g:chess' }, { id: '${ME}', nick: 'Другой', a: 'g:durak' }] }); window.dispatchEvent(new CustomEvent('d37:online', { detail: 2 }));
          const r = { h: document.querySelector('.md-now .md-h2').textContent, users: [...document.querySelectorAll('.md-user')].map(u => u.textContent + '|' + u.dataset.miniUid), b: !!document.querySelector('.md-user b') }; D37Chat.online = real; return r; })()`);
        ok(/играют: 1/.test(ppl.h) && ppl.users.length === 1 && ppl.users[0] === 'Вася<b>|' + OTHER && !ppl.b, T + '«Сейчас играют: 1» — только тот, кто в этой игре; ник — текстом, по нажатию — карточка', ppl);
        await B.shot(`mode-${prof}-chess`);
        // «← Все игры» видно в теме страницы; картинка — та же ссылка, что «▶ Играть»
        const hero = await B.ev(`(() => { const b = document.querySelector('.md-back'), p = document.querySelector('.md-pic'), cs = getComputedStyle(b), lum = c => { const m = c.match(/[\\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
          return { tag: p.tagName, href: p.getAttribute('href'), play: document.querySelector('.md-play').getAttribute('href'), h: Math.round(b.getBoundingClientRect().height), lum: lum(cs.color), color: cs.color }; })()`);
        ok(hero.tag === 'A' && hero.href === hero.play && hero.h >= 44 && (prof === 'phone' ? hero.lum < 0.45 : hero.lum > 0.55), T + `картинка игры — ссылка «Играть»; «← Все игры» видно на фоне страницы (высота ${hero.h} px)`, hero);
        // игра игрока с меткой 16+: ребёнку — без названия и описания, взрослому — страница с меткой
        const UGC = kid => `(async () => { const from = sbClient.from; sbClient.from = t => t === 'ugc_games' ? (() => { const r = Promise.resolve({ data: [{ id: 'g16', title: 'Страшилка', icon: '👻', descr: 'Очень страшно', author: '${OTHER}', plays: 3, likes: 1, updated_at: new Date().toISOString(), status: 'public', kind: 'tpl', age_rating: 16 }], error: null }); const c = { select: () => c, eq: () => c, limit: () => c, then: r.then.bind(r) }; return c; })() : from(t);
          const g = D37Age.group; D37Age.group = () => ${kid ? "'kid'" : "'adult'"}; D37Route.go('/hub'); await new Promise(r => setTimeout(r, 300)); D37Route.go('/hub/mode/ugc-g16'); await new Promise(r => setTimeout(r, 1500));
          const out = { text: document.getElementById('hub-page').textContent, age: document.querySelector('.md-age')?.textContent || '', play: !!document.querySelector('.md-info .md-play') }; sbClient.from = from; D37Age.group = g; return out; })()`;
        const kidPg = await B.ev(UGC(true)), adPg = await B.ev(UGC(false));
        ok(/для тех, кто старше/.test(kidPg.text) && !/Страшилка|Очень страшно/.test(kidPg.text) && !kidPg.play, T + 'игра игрока «16+»: ребёнку — «для тех, кто старше», без названия и описания', kidPg.text.slice(0, 120));
        ok(/Страшилка/.test(adPg.text) && adPg.age === '16+' && adPg.play, T + 'игра игрока «16+»: взрослому — страница с меткой «16+»', adPg);
        await B.ev(`D37Route.go('/hub/mode/chess'), 1`); await B.until(`!!document.querySelector('.md-play')`, 15000);
        await B.ev(`D37Route.go('/hub/mode/e-klet'), 1`);
        ok(await B.until(`/Клеточки/.test(document.querySelector('.md-h1')?.textContent || '')`, 20000), T + 'страница режима движка «Клеточки» открылась');
        m = await B.ev(`({ play: document.querySelector('.md-play').getAttribute('href'), rooms: [...document.querySelectorAll('.md-btn, .md-link')].map(b => b.getAttribute('href')).filter(Boolean) })`);
        ok(m.play === '/hub/play/klet' && m.rooms.includes('/hub/lobby/klet2'), T + '«▶ Играть» → /hub/play/klet, «Комнаты» → список лобби T-174', m);
        await B.ev(`D37Route.go('/hub/mode/zzz-net'), 1`);
        ok(await B.until(`/Такой игры нет/.test(document.querySelector('.hub-h1')?.textContent || '')`, 15000), T + 'неизвестная игра — «Такой игры нет», без ошибки');
        // «ⓘ» в каталоге игр и на плитках /hub
        await B.ev(`D37Route.go('/play'), 1`);
        ok(await B.until(`document.querySelectorAll('.gm-card .md-dot').length > 20`, 20000), T + 'каталог игр: на карточках есть «ⓘ»');
        await B.ev(`document.querySelector('.gm-card[href="/play/chess"] .md-dot').click(), 1`);
        ok(await B.until(`location.pathname === '/hub/mode/chess' && !!document.querySelector('.md-play')`, 15000), T + '«ⓘ» открывает страницу игры (сама карточка — по-прежнему сразу игру)');
        await B.ev(`D37Route.go('/hub'), 1`);
        ok(await B.until(`document.querySelectorAll('.hub-grid .md-dot').length >= 4`, 20000), T + 'плитки /hub: «ⓘ» у режимов');
      }
      ok(B.errs.length === 0, T + 'за всю проверку ошибок в консоли — ' + B.errs.length, B.errs.slice(0, 8));
    } catch (e) { ok(false, T + 'проверка упала: ' + (e.message || e)); }
    finally { await B.close(); }
  }
  site.stop();
  console.log(`\n${fails ? 'FAIL' : 'OK'} part18-e2e: ${n - fails}/${n}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

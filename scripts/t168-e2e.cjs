// T-168: «Дискорд» до нормального уровня — проверка в настоящем Chrome (headless, без npm, загрузки запрещены, без входа и без записи
// в базу: «вход» подделан в странице, ответы сервера на запись подменены — в базу не уходит ни одного изменения).
//  Компьютер 1440x900 (тёмная тема) и телефон 390x844 с касаниями (светлая тема):
//  1) «в сети» — одно число: заголовок, сумма групп и 👥 в шапке совпадают (две вкладки одного человека — один человек);
//  2) приветствие при первом заходе: три строки, «Создать свой сервер» / «Найти сервер», ✕ — и больше не показывается;
//  3) у каждой кнопки-значка есть название (title / aria-label); на телефоне долгое нажатие показывает его;
//  4) ❓ в шапке → страница «что здесь есть» (камера — возрастное правило, пароль — не шифрование);
//  5) «Гайд»: «＋» ведёт в гайд, 5 шагов, сервер создаётся теми же функциями (подменены), каналы шаблона, ссылка, роли;
//  6) пустые экраны с действием (друзья, свои серверы, пустой канал);
//  7) раскладка как приложение: без заголовка страницы, окно чата между шапкой и нижним меню, участники прячутся и это запоминается;
//  8) ошибок JS нет.
// Запуск из корня сайта: node scripts/t168-e2e.cjs  (CHROME=…, PYTHON=…, BASE=http://127.0.0.1:5500 — уже запущенный сервер)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t168' : os.tmpdir());
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
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const L = { d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!sessionStorage.getItem('t168')){sessionStorage.setItem('t168','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(150); } return false; };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, close, errs };
}
const FEED = `!!document.querySelector('#dsHost .mv-m, #dsHost .mv-empty')`;
// подделанный «вход» + подмена ответов сервера: читать можно, писать — нет (всё, что не в списке чтения, отвечает «нужно войти»)
const FAKE = `(async () => {
  await D37Phone.need('ds');
  window.__rpc = []; const real = window.__realRpc = window.__realRpc || D37Phone.rpc;
  const FX = { cm_my: [], ds_friends: { ok: true, friends: [], incoming: [], outgoing: [], blocked: [], ignored: [] }, ds_me: { ok: true, status: 'online' }, gdm_list: { ok: true, list: [] },
    cm_create: { ok: true, id: 999001, code: 'abcd1234' }, cm_channel_save: { ok: true }, cm_role_save: { ok: true } };
  const READ = /^(cm_list_public|cm_server_get|cm_layout|cm_events|cm_catalog|ds2_info|dsm_info|cf_server_get|ds_people_meta|cm_notif_get)$/;
  D37Phone.rpc = async (n, a) => { __rpc.push([n, a]); if (n in FX) return { data: FX[n], error: null }; if (READ.test(n)) return real(n, a); return { data: { ok: false, reason: 'auth' }, error: null }; };
  currentUser = { id: '00000000-0000-4000-8000-000000000001' }; currentProfile = { id: currentUser.id, nick: 'Тест' }; try { chatNick = 'Тест'; } catch (e) {}
  window.dispatchEvent(new Event('d37:auth')); return 1;
})()`;
const ICONLESS = `[...document.querySelectorAll('#dsHost .ds button, #dsHost .ds a')].filter(b => b.offsetParent && !/[a-zа-яё]{3}/i.test(b.textContent) && !b.title && !b.getAttribute('aria-label')).map(b => b.outerHTML.slice(0, 80))`;
// «в сети»: подставить состояние присутствия (две вкладки одного человека + гость), нарисовать участников, сверить числа
const COUNTS = `(async () => {
  const o = onlineChannel; const U = '11111111-1111-4111-8111-111111111111';
  onlineChannel = { presenceState: () => ({ a: [{ u: U, nick: 'Аня' }], b: [{ u: U, nick: 'Аня' }], c: [{ nick: 'Гость' }] }) };
  try {
    const on = chatOnline(), srv = await D37DS.server('d37'), box = document.querySelector('#dsHost .ds-mbody');
    await D37DS._test.membersRender(box, srv);
    const title = +(box.querySelector('.ds-mtitle')?.textContent.match(/(\\d+)\\s*$/) || [])[1];
    const groups = [...box.querySelectorAll('.ds-mg')].filter(g => !/Не в сети/.test(g.textContent)).reduce((a, g) => a + +(g.textContent.match(/(\\d+)\\s*$/) || [0, 0])[1], 0);
    const chip = +document.querySelector('.ds-top [data-ds="right"]')?.dataset.n;
    return { total: on.total, users: on.users.length, guests: on.guests, title, groups, chip };
  } finally { onlineChannel = o; }
})()`;

(async () => {
  const site = await startSite();
  // ═══ Компьютер ═══
  const B = await chrome({ phone: false, theme: 'dark' });
  try {
    await B.send('Page.navigate', { url: site.base + '/chat' });
    ok(await B.until(FEED, 60000), '/chat на компьютере: лента показана');
    await sleep(1200);
    // 1) «в сети»
    const c = await B.ev(COUNTS);
    ok(c.total === 2 && c.users === 1 && c.guests === 1, 'две вкладки одного человека + гость = «2» (а не «3»)', c);
    ok(c.title === c.total && c.groups === c.total, 'заголовок «Сейчас на сайте» = сумма групп', c);
    ok(c.chip === c.total, '👥 в шапке = тому же числу', c);
    // 2) приветствие
    const hi = await B.ev(`(() => { const t = document.querySelector('.ds-tip.dsh-hi'); return t && !t.hidden ? { lines: t.querySelectorAll('.dsh-hi-t span').length, hrefs: [...t.querySelectorAll('a')].map(a => a.getAttribute('href')), x: !!t.querySelector('.dsh-x') } : null; })()`);
    ok(hi && hi.lines === 3 && hi.x, 'приветствие при первом заходе: три строки и ✕', hi);
    ok(hi && hi.hrefs.includes('#/chat/guide') && hi.hrefs.includes('#/chat/find'), 'в приветствии — «Создать свой сервер» и «Найти сервер»', hi?.hrefs);
    // 3) названия у значков
    const nol = await B.ev(ICONLESS);
    ok(nol.length === 0, 'у всех кнопок-значков есть название', nol);
    // 7) раскладка
    const lay = await B.ev(`(() => { const h = document.getElementById('dsHost').getBoundingClientRect(), t = document.querySelector('#chat > .sec-title').getBoundingClientRect(), nav = document.getElementById('nav').getBoundingClientRect();
      return { top: Math.round(h.top), bottom: Math.round(h.bottom), w: Math.round(h.width), vh: innerHeight, navB: Math.round(nav.bottom), titleW: Math.round(t.width), me: Math.round(document.querySelector('.ds-mehost').getBoundingClientRect().bottom), perf: !!document.getElementById('perfToggle')?.offsetParent }; })()`);
    ok(lay.titleW <= 1, 'заголовок страницы не занимает место (остался для поиска)', lay);
    ok(lay.top >= lay.navB && lay.top - lay.navB <= 16 && lay.bottom <= lay.vh && lay.vh - lay.bottom <= 16, 'окно чата — от шапки сайта до низа экрана', lay);
    ok(lay.w >= 1380, 'окно чата во всю ширину (было 1136 из 1440)', lay.w);
    ok(lay.me <= lay.vh && !lay.perf, 'низ колонки каналов виден без прокрутки, язычок «Слабое» не лежит поверх', lay);
    await B.ev(`document.querySelector('.ds-top [data-ds="right"]').click(), 1`);
    ok(await B.ev(`document.querySelector('.ds').classList.contains('m-hide')`), '👥 прячет участников');
    await B.send('Page.reload'); await B.until(FEED, 60000); await sleep(800);
    ok(await B.ev(`document.querySelector('.ds').classList.contains('m-hide')`), 'после обновления участники так и спрятаны');
    await B.ev(`document.querySelector('.ds-top [data-ds="right"]').click(), 1`);
    await B.ev(`document.querySelector('.ds-top [data-ds="pins"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('.ds .mv-over:not([hidden])')`, 5000), '📌 открывает панель закреплённых');
    await B.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1`);
    ok(await B.until(`!document.querySelector('.ds .mv-over:not([hidden])')`, 3000), 'Esc закрывает панель (курсор не в поле)');
    // 2) ✕ — больше не показывать
    ok(await B.ev(`!!document.querySelector('.ds-tip.dsh-hi:not([hidden])')`), 'приветствие ещё на месте до ✕');
    await B.ev(`document.querySelector('.dsh-x').click(), 1`);
    ok(await B.ev(`document.querySelector('.ds-tip').hidden`), '✕ — приветствие скрыто');
    await B.send('Page.reload'); await B.until(FEED, 60000); await sleep(800);
    ok(await B.ev(`document.querySelector('.ds-tip').hidden`), 'после обновления приветствия нет (запомнено)');
    // последний канал: открыть #игры, потом просто /chat — снова #игры
    await B.ev(`location.hash = '#/chat/games', 1`);
    await B.until(`/игры/.test(document.querySelector('.ds-ttl')?.textContent || '')`, 10000);
    await B.send('Page.navigate', { url: site.base + '/chat' });
    ok(await B.until(`/игры/.test(document.querySelector('.ds-ttl')?.textContent || '')`, 30000), 'просто /chat — снова последний канал (#игры)');
    await B.send('Page.navigate', { url: site.base + '/chat/memes' });
    ok(await B.until(`/мемы/.test(document.querySelector('.ds-ttl')?.textContent || '')`, 30000), 'ссылка на канал (/chat/memes) при первом заходе открывает этот канал, а не #общий');
    await B.ev(`location.hash = '#/chat/general', 1`); await B.until(`/общий/.test(document.querySelector('.ds-ttl')?.textContent || '')`, 10000);
    // 4) помощь
    ok(await B.ev(`document.querySelector('.ds-top a.ds-help')?.getAttribute('href')`) === '#/chat/help', '❓ в шапке ведёт на помощь');
    await B.ev(`location.hash = '#/chat/help', 1`);
    ok(await B.until(`document.querySelectorAll('.dsh-it').length >= 10`, 15000), 'страница «что здесь есть»: 10+ пунктов');
    const help = await B.ev(`[...document.querySelectorAll('.dsh-it')].map(x => x.textContent)`);
    ok(help.some(t => /Камера/.test(t) && /18/.test(t)) && help.some(t => /Пароль/.test(t) && /не шифрование/.test(t)) && help.some(t => /Голос/.test(t) && /9 лет/.test(t)), 'камера — 18+, голос — с 9 лет, пароль — не шифрование');
    // 5) гайд (подделанный вход)
    await B.ev(FAKE);
    await B.ev(`location.hash = '#/chat/friends', 1`);
    ok(await B.until(`!!document.querySelector('.ppl-empty a[href="#/chat/friends/add"]')`, 15000), 'нет друзей в сети → «＋ Добавить друга»');
    ok(await B.ev(`!!document.querySelector('.ppl-empty a[href="#/chat/guide"]') && !!document.querySelector('.ppl-empty a[href="#/chat/find"]')`), 'нет своих серверов → «Создать» и «Найти»');
    ok(await B.ev(`/Друзья в сети — 0/i.test(document.querySelector('.ppl-list .ds-mg')?.textContent || '')`), 'счётчик друзей подписан «Друзья в сети» (не путается с «Сейчас на сайте»)');
    ok(await B.ev(`document.querySelector('.ds-rail .ds-add')?.getAttribute('href')`) === '#/chat/guide', '«＋» в списке серверов ведёт в гайд');
    await B.ev(`location.hash = '#/chat/guide', 1`);
    ok(await B.until(`document.querySelectorAll('.dsh-steps li').length === 5 && !!document.querySelector('[data-g="name"]')`, 15000), 'гайд: 5 шагов, первый — название');
    const step = () => B.ev(`[...document.querySelectorAll('.dsh-steps li')].findIndex(l => l.classList.contains('on'))`);
    await B.ev(`document.querySelector('[data-gx="next"]').click(), 1`); await sleep(150);
    ok(await step() === 0 && await B.ev(`!document.querySelector('.dsh-guide .ds-err').hidden`), 'пустое название — понятная ошибка, шаг не меняется');
    await B.ev(`(() => { const i = document.querySelector('[data-g="name"]'); i.value = 'Тест-сервер'; i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-gx="next"]').click(); })()`); await sleep(150);
    ok(await step() === 1 && await B.ev(`document.querySelectorAll('.dsh-step [data-ic]').length >= 10`), 'шаг 2: значок');
    await B.ev(`document.querySelector('.dsh-step [data-ic="🐉"]').click(), document.querySelector('[data-gx="next"]').click(), 1`); await sleep(150);
    ok(await step() === 2 && await B.ev(`document.querySelectorAll('.dsh-tpl').length`) === 3, 'шаг 3: три готовых набора каналов');
    await B.ev(`document.querySelector('[data-tpl="game"]').click(), document.querySelector('[data-gx="next"]').click(), 1`);
    ok(await B.until(`!!document.querySelector('[data-g="url"]')`, 10000), 'шаг 4: ссылка-приглашение');
    const calls = await B.ev(`__rpc.filter(c => /^cm_(create|channel_save)$/.test(c[0]))`);
    ok(calls[0]?.[0] === 'cm_create' && calls[0][1].p_name === 'Тест-сервер' && calls[0][1].p_icon === '🐉' && calls[0][1].p_public === true, 'сервер создаётся тем же cm_create (название, значок, открытый)', calls[0]);
    const chs = calls.filter(c => c[0] === 'cm_channel_save').map(c => c[1].p_name + ':' + c[1].p_kind);
    ok(chs.join() === 'поиск-тиммейтов:text,скриншоты:text,Голосовой 2:voice', 'каналы набора «Для игры»', chs);
    ok(/\/c\/abcd1234$/.test(await B.ev(`document.querySelector('[data-g="url"]').value`)), 'ссылка — /c/<код>');
    await B.ev(`document.querySelector('[data-gx="next"]').click(), 1`); await sleep(150);
    ok(await step() === 4 && await B.ev(`document.querySelectorAll('[data-role]').length`) === 2, 'шаг 5: роли на одном экране');
    await B.ev(`document.querySelector('[data-gx="next"]').click(), 1`); await sleep(600);
    const roles = await B.ev(`__rpc.filter(c => c[0] === 'cm_role_save').map(c => [c[1].p_community, c[1].p_name, c[1].p_perms])`);
    ok(roles.length === 1 && roles[0][0] === 999001 && roles[0][1] === 'Модератор' && roles[0][2] === 6, 'создана роль «Модератор» (модерация + закреп)', roles);
    ok(await B.until(`/chat\\/c\\/999001/.test(location.pathname + location.hash)`, 5000), '«Готово» открывает новый сервер');
    // 6) пустой канал
    const empty = await B.ev(`(async () => { const box = document.createElement('div'); box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column'; document.body.appendChild(box);
      const v = MsgView.mount(box, { noFocus: true }); await v.setAdapter({ key: 'test:t168e', title: '#т', maxLen: 500, caps: {}, load: async () => ({ list: [], more: false }), sub(){ return () => {}; }, send: async () => ({ ok: true }), state: () => ({ mode: 'write' }), me: () => ({ uid: 'me', nick: 'Я' }) });
      const t = box.querySelector('.mv-empty')?.textContent || ''; v.destroy(); box.remove(); return t; })()`);
    ok(/Напишите первое сообщение/.test(empty), 'пустой канал: «Напишите первое сообщение»', empty);
    ok(B.errs.length === 0, 'компьютер: ошибок JS нет', B.errs);
  } finally { await B.close(); }

  // ═══ Телефон ═══
  const T = await chrome({ phone: true, theme: 'light' });
  try {
    await T.send('Page.navigate', { url: site.base + '/chat' });
    ok(await T.until(FEED, 60000), '/chat на телефоне (светлая тема): лента показана');
    await sleep(1000);
    const lay = await T.ev(`(() => { const h = document.getElementById('dsHost').getBoundingClientRect(), bar = document.getElementById('bottomTabbar').getBoundingClientRect(), nav = document.getElementById('nav').getBoundingClientRect();
      return { top: Math.round(h.top), bottom: Math.round(h.bottom), barTop: Math.round(bar.top), navB: Math.round(nav.bottom), sw: document.documentElement.scrollWidth, vw: innerWidth, theme: document.documentElement.dataset.theme }; })()`);
    ok(lay.theme === 'light', 'светлая тема включена', lay.theme);
    ok(lay.top >= lay.navB - 1 && lay.bottom <= lay.barTop && lay.barTop - lay.bottom <= 12, 'окно чата между шапкой и нижним меню (меню не закрывает низ)', lay);
    ok(lay.sw <= lay.vw, 'нет прокрутки вбок', lay);
    ok(await T.ev(`!!document.querySelector('.ds-tip.dsh-hi:not([hidden])')`), 'телефон: приветствие при первом заходе');
    const nol = await T.ev(ICONLESS);
    ok(nol.length === 0, 'телефон: у всех кнопок-значков есть название', nol);
    // долгое нажатие на 🔔 → подсказка с названием
    const pt = await T.ev(`(() => { const b = document.querySelector('.ds-top [data-ds4="notif"]'); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const at = document.elementFromPoint(x, y); return { x, y, t: b.title, hit: !!at && b.contains(at), at: at && at.className }; })()`);
    await T.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
    await T.until(`!!document.querySelector('.dsh-tip')`, 2000);
    const tip = await T.ev(`document.querySelector('.dsh-tip')?.textContent || ''`);
    await T.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(tip && tip === pt.t, 'долгое нажатие на значок показывает его название', { tip, pt });
    await T.ev(`location.hash = '#/chat/help', 1`);
    ok(await T.until(`document.querySelectorAll('.dsh-it').length >= 10`, 15000) && await T.ev(`document.documentElement.scrollWidth <= innerWidth`), 'телефон: помощь без прокрутки вбок');
    await T.ev(FAKE);
    await T.ev(`location.hash = '#/chat/guide', 1`);
    ok(await T.until(`document.querySelectorAll('.dsh-steps li').length === 5`, 15000) && await T.ev(`(() => { const s = document.querySelector('.dsh-steps').getBoundingClientRect(); return s.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`), 'телефон: шаги гайда помещаются');
    ok(T.errs.length === 0, 'телефон: ошибок JS нет', T.errs);
  } finally { await T.close(); }
  site.stop();
  console.log(`\nt168-e2e: ${n - fails} из ${n} прошло${fails ? ', упало ' + fails : ''}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// T-174: присоединение к игре «как в Роблоксе» и список комнат — проверка в настоящем Chrome (headless, без npm, загрузки запрещены).
// Две страницы против СВОЕГО сервера игр (d37-server на 127.0.0.1, порт выбирает сам; наружу — ничего), сайт — scripts/serve.py.
//  A (ПК, тёмная) создаёт комнату из интерфейса сайта (название с разметкой — только текстом), B (телефон 390×844, светлая) видит её
//  в списке и заходит; B выходит и заходит по коду; по ссылке-приглашению; перезагрузка — B возвращается на то же место (ключ возврата);
//  код занятия: «d:» по настройке «Кто может ко мне присоединиться»; «▶ Присоединиться» у друга (присутствие подделано в странице);
//  группа «Идём вместе» (канал подделан); «сервер игр недоступен»; без моста движка раздел прячется; телефон без прокрутки вбок.
// В базу ничего не пишется (вход не делаем; друзья и их занятие — подмена в странице).
// Запуск из корня сайта: node scripts/t174-e2e.cjs   (CHROME=…, PYTHON=…, D37_SERVER=<d37-server.exe>, BASE=<уже запущенный сайт>)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/t174' : os.tmpdir());
const SHOTS = process.env.SHOTS || path.join(TMP, 'shots');
const SERVER = process.env.D37_SERVER || 'M:/d37/claude-tmp/t174/tgt/debug/d37-server.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startSite(){
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop(){} };
  const port = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(port)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  return { base: `http://127.0.0.1:${port}`, stop(){ try { py.kill(); } catch (e) {} } };
}
function gameServer(){
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SERVER)) { reject(new Error('нет d37-server: ' + SERVER + ' (D37_SERVER=…)')); return; }
    const p = spawn(SERVER, ['--bind', '127.0.0.1', '--port', '0', '--region', 'local-test'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TMP, TEMP: TMP } });
    let log = '';
    const t = setTimeout(() => reject(new Error('d37-server не запустился: ' + log)), 15000);
    p.stderr.on('data', d => { log += d.toString(); const m = /listening on 127\.0\.0\.1:(\d+)/.exec(log); if (m && !p.port) { p.port = +m[1]; clearTimeout(t); resolve(p); } });
    p.log = () => log;
  });
}
async function chrome({ phone, theme, server }){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  // возраст спрошен (окошко не мешает), тема, графика «простая» (WebGL2 в headless), адрес своего сервера игр (только на localhost)
  const L = { d37_join_on: '1', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme, d37_age: JSON.stringify({ y: new Date().getFullYear() - 15, s: 'g', fa: Date.now() - 40 * 864e5 }), d37_hub_gfx: 'gl', d37_join_server: server };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!localStorage.getItem('t174')){localStorage.setItem('t174','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(200); } return false; };
  const shot = async name => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); console.log('    картинка ' + path.join(SHOTS, name)); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, close, errs };
}
const READY = `typeof sbClient !== 'undefined' && !!window.D37Route && !!window.D37Hub && !!window.D37Join && !!window.D37Phone && document.readyState === 'complete'`;
const GO = p => `(D37Route.go(${JSON.stringify(p)}), true)`;
const ST = `(() => { const s = D37Join.state; return { online: s.online, cur: s.cur, last: s.last, target: s.target }; })()`;
const LOADED = `!!(D37Hub._st.h && D37Hub._st.h.state.loaded)`;
const XSS = '<img src=x onerror="window.__xss=1">';
const NOSCROLL = `document.documentElement.scrollWidth <= innerWidth + 1`;

(async () => {
  const site = await startSite();
  let gs = null; const pages = [];
  try {
    gs = await gameServer();
    const WS = `ws://127.0.0.1:${gs.port}`, HTTP = `http://127.0.0.1:${gs.port}`;
    console.log('сервер игр ' + WS + ', сайт ' + site.base);
    const A = await chrome({ phone: false, theme: 'dark', server: WS }); pages.push(A);
    const B = await chrome({ phone: true, theme: 'light', server: WS }); pages.push(B);

    // ═══ 1. A: меню /hub — раздел «Играть с людьми» (мост движка есть в preview), пусто ═══
    await A.send('Page.navigate', { url: site.base + '/hub' });
    ok(await A.until(READY, 90000), 'A: сайт загрузился');
    ok(await A.until(`!!document.querySelector('#hub-page .jn:not([hidden])') && /никто не играет/.test(document.querySelector('#hub-page .jn-list').textContent)`, 30000), 'A: в меню /hub — «Играть с людьми», пустой список понятным текстом',
      await A.ev(`document.querySelector('#hub-page .jn')?.innerText.slice(0, 200) || 'нет раздела'`));
    ok(await A.ev(`D37Join.state.bridge === true`), 'A: мост лобби у движка канала preview найден');
    await A.ev(`document.querySelector('#hub-page .jn').scrollIntoView({ block: 'center' }), 1`); await sleep(400);
    await A.shot('t174_menu_pc_dark.png');

    // ═══ 2. A создаёт комнату из интерфейса: название (с разметкой), «Все», 8 игроков ═══
    await A.ev(`document.querySelector('#hub-page .jn-create').click(), 1`);
    ok(await A.until(`!!document.querySelector('.jn-bg .jn-name-in')`, 5000), 'A: «＋ Создать комнату» — лист с названием, «кто может войти», числом игроков, возрастом');
    await A.ev(`(() => { const i = document.querySelector('.jn-bg .jn-name-in'); i.value = 'Аня ' + ${JSON.stringify(XSS)}; i.dispatchEvent(new Event('input')); [...document.querySelectorAll('.jn-bg .jn-seg button')].find(b => b.textContent === '8').click(); return 1; })()`);
    await A.shot('t174_create_pc_dark.png');
    await A.ev(`document.querySelector('.jn-bg .jn-mk').click(), 1`);
    ok(await A.until(`/^\\/hub\\/play\\/klet2\\/s-[a-z0-9]{8}$/.test(location.pathname)`, 5000), 'A: «Создать и играть» → /hub/play/klet2/s-<id>', await A.ev('location.pathname'));
    ok(await A.until(LOADED, 150000), 'A: игра загрузилась', await A.ev(`({ err: D37Hub._st.errors, ev: D37Hub._st.events })`));
    ok(await A.until(`D37Join.state.online && !!(D37Join.state.last && D37Join.state.last.code)`, 60000), 'A: в комнате на сервере (online, код)', await A.ev(ST));
    const a1 = await A.ev(ST);
    const CODE = a1.last.code, AID = await A.ev(`D37Join.state.target.id`);
    ok(a1.last.host === a1.last.me, 'A: хозяин своей комнаты', a1.last);
    ok(await A.until(`!!(D37Join.state.cur && D37Join.state.cur.session === ${JSON.stringify(CODE)})`, 15000), 'A: движок прислал presence (игра, код, n / max)', await A.ev(`D37Join.state.cur`));
    const listed = await A.until(`fetch(${JSON.stringify(HTTP + '/sessions?game=klet2')}).then(r => r.json()).then(l => l.some(s => s.id === ${JSON.stringify(AID)} && s.max === 8 && /Аня/.test(s.name)))`, 20000);
    ok(listed, 'сервер: комната в списке с названием хозяина и пределом 8 (lobby meta / limit от хозяина)', await A.ev(`fetch(${JSON.stringify(HTTP + '/sessions')}).then(r => r.json())`));
    ok(await A.until(`!document.querySelector('.jn-gbtn').hidden`, 5000), 'A: в игре кнопка 👥 у ⏸');
    // код занятия по настройке «Кто может ко мне присоединиться»
    const acts = await A.ev(`(() => { const P = D37Phone, o = {}; for (const w of ['all', 'friends', 'invite']) { D37Settings.set('joinWho', w); const a = P.activity(); o[w] = { mine: P.actCode(a), pub: P.actCode(a, 'pub'), text: P.actText(P.actParse(P.actCode(a))) }; } D37Settings.set('joinWho', 'friends'); return o; })()`);
    ok(acts.all.pub.includes('d:klet2.' + CODE + '.o.') && acts.friends.mine.includes('d:klet2.' + CODE + '.f.') && !acts.friends.pub.includes('d:') && !acts.invite.mine.includes('d:'),
      'код занятия: «все» — d:… .o в общем «кто онлайн»; «друзья» — только друзьям (.f), в общем нет; «по приглашению» — нигде', acts);
    ok(/Играет в «Клеточки» \(\d+ \/ 8\)/.test(acts.all.text), 'текст занятия: «Играет в «Клеточки» (n / max)»', acts.all.text);

    // ═══ 3. B (телефон, светлая): /hub/lobby/klet2 — видит комнату A и заходит из списка ═══
    await B.send('Page.navigate', { url: site.base + '/hub/lobby/klet2' });
    ok(await B.until(READY, 90000), 'B: сайт загрузился');
    ok(await B.until(`[...document.querySelectorAll('.jn-row')].some(r => r.dataset.id === ${JSON.stringify(AID)})`, 30000), 'B: комната A в списке /hub/lobby/klet2', await B.ev(`document.querySelector('.jn')?.innerText.slice(0, 300)`));
    const rowB = await B.ev(`(() => { const r = [...document.querySelectorAll('.jn-row')].find(r => r.dataset.id === ${JSON.stringify(AID)}); return { name: r.querySelector('.jn-name').textContent, n: r.querySelector('.jn-n').textContent, sub: r.querySelector('.jn-sub').textContent, img: !!r.querySelector('img'), xss: !!window.__xss }; })()`);
    ok(/Аня/.test(rowB.name) && !rowB.img && !rowB.xss, 'B: название комнаты от игрока — только текстом (сервер срезал знаки разметки, страница ничего не исполнила)', rowB);
    ok(/1 \/ 8/.test(rowB.n) && /local-test/.test(rowB.sub), 'B: строка — игроки 1 / 8, игра, регион', rowB);
    ok(await B.ev(NOSCROLL), 'B: телефон 390 — без прокрутки вбок');
    await B.shot('t174_lobby_phone_light.png');
    await B.ev(`[...document.querySelectorAll('.jn-row')].find(r => r.dataset.id === ${JSON.stringify(AID)}).querySelector('.jn-go').click(), 1`);
    ok(await B.until(`location.pathname === ${JSON.stringify('/hub/play/klet2/s-' + AID)}`, 5000), 'B: «Войти» → игра этой комнаты');
    ok(await B.until(LOADED, 150000), 'B: игра загрузилась');
    const twoP = `D37Join.state.online && D37Join.state.last && D37Join.state.last.people === 2`;
    ok(await B.until(twoP, 60000) && await A.until(twoP, 20000), 'A и B в одной комнате: по 2 человека у обоих', { a: (await A.ev(ST)).last, b: (await B.ev(ST)).last });
    ok((await B.ev(ST)).last.code === CODE, 'B: тот же код комнаты');
    // лист комнаты на телефоне: код и «Пригласить»
    await B.ev(`document.querySelector('.jn-gbtn').click(), 1`);
    ok(await B.until(`document.querySelector('.jn-room .jn-codev')?.textContent === ${JSON.stringify(CODE)}`, 5000), 'B: 👥 — лист комнаты с кодом');
    await sleep(300); await B.shot('t174_room_phone_light.png');
    await B.ev(`[...document.querySelectorAll('.jn-room .hub-btn')].find(b => /Пригласить/.test(b.textContent)).click(), 1`);
    ok(await B.until(`/\\/hub\\/play\\/klet2\\/${CODE}$/.test(document.querySelector('.jn-link')?.textContent || '')`, 5000), 'B: «Пригласить» — ссылка /hub/play/klet2/<КОД>', await B.ev(`document.querySelector('.jn-link')?.textContent`));
    await B.ev(`document.querySelector('.jn-bg .hub-sheet-x')?.click(), 1`);

    // ═══ 4. B выходит и заходит по коду (поле «Код комнаты») ═══
    const peopleA = n => A.until(`D37Join.state.last && D37Join.state.last.people === ${n}`, 30000);
    await B.ev(GO('/hub/lobby/klet2'));
    ok(await peopleA(1), 'B вышел — у A снова 1 человек');
    ok(await B.until(`!!document.querySelector('.jn-codei')`, 15000), 'B: поле кода в списке');
    await B.ev(`(() => { const i = document.querySelector('.jn-codei'); i.value = ${JSON.stringify(CODE.toLowerCase())}; i.dispatchEvent(new Event('input')); document.querySelector('.jn-codef').requestSubmit(); return 1; })()`);
    ok(await B.until(`location.pathname === ${JSON.stringify('/hub/play/klet2/' + CODE)}`, 5000), 'B: код (строчными) → /hub/play/klet2/<КОД>');
    ok(await B.until(LOADED, 150000) && await B.until(twoP, 60000) && await peopleA(2), 'B: вошёл по коду — у обоих 2 человека');

    // ═══ 5. По ссылке-приглашению (как из сообщения) ═══
    const link = await A.ev(`D37Join.inviteLink()`);
    ok(new RegExp('/hub/play/klet2/' + CODE + '$').test(link), 'A: ссылка-приглашение', link);
    await B.ev(GO('/hub'));
    ok(await peopleA(1), 'B вышел снова');
    await B.send('Page.navigate', { url: link.replace(/^https?:\/\/[^/]+/, site.base) });
    ok(await B.until(READY, 90000) && await B.until(LOADED, 150000) && await B.until(twoP, 60000) && await peopleA(2), 'B: открыл ссылку-приглашение — сразу в комнате A');

    // ═══ 6. Перезагрузка страницы — B возвращается на то же место (ключ возврата в sessionStorage) ═══
    await sleep(2500);
    const pre = await B.ev(ST);
    const rj = await B.ev(`JSON.parse(sessionStorage.getItem('d37join_rj') || 'null')`);
    ok(rj && rj.key === (pre.last.key >>> 0) && rj.code === CODE, 'B: ключ возврата сохранён (sessionStorage)', { rj, key: pre.last.key });
    await B.send('Page.reload', { ignoreCache: false });
    ok(await B.until(READY, 90000) && await B.until(LOADED, 150000), 'B: после перезагрузки игра снова загрузилась');
    ok(await B.until(twoP, 60000), 'B: снова в комнате (2 человека)');
    const post = await B.ev(ST);
    ok(post.last.slot === pre.last.slot && post.last.key === pre.last.key && post.last.round === pre.last.round, 'B: то же место (slot), тот же ключ и раунд — место держалось', { pre: [pre.last.slot, pre.last.key, pre.last.round], post: [post.last.slot, post.last.key, post.last.round] });

    // ═══ 7. «Вернуться в игру» в списке после ухода (обрыв: вкладка ушла без «выйти») ═══
    await B.ev(`(() => { D37Join.state.target = null; return 1; })()`);
    await B.ev(`sessionStorage.setItem('d37join_rj', JSON.stringify(Object.assign(JSON.parse(sessionStorage.getItem('d37join_rj')), { t: Date.now() }))), 1`);
    await B.ev(GO('/hub/lobby'));
    ok(await B.until(`!document.querySelector('.jn-back').hidden && !!document.querySelector('.jn-backb')`, 20000) || await B.ev(`(() => { const r = sessionStorage.getItem('d37join_rj'); return !r; })()`),
      '«Вернуться в игру» предлагается, пока комната есть (или ключ стёрт выходом через «← На сайт»)', await B.ev(`({ back: document.querySelector('.jn-back')?.innerText, rj: sessionStorage.getItem('d37join_rj') })`));

    // ═══ 8. «▶ Присоединиться» у друга: присутствие и друзья подменены в странице (вход не делаем, в базу ничего) ═══
    const F = '11111111-2222-4333-8444-555555555555';
    await B.ev(`(() => { const P = D37Phone; window.__realFS = window.__realFS || P.friendStatus; window.__realFr = window.__realFr || P.friends;
      currentUser = { id: '00000000-0000-4000-8000-0000000000b2' }; currentProfile = { id: currentUser.id, nick: 'Боря' };
      P.friends = async () => ({ list: [${JSON.stringify(F)}], incoming: [] });
      const op = window.__realProf = window.__realProf || P.prof; P.prof = id => id === ${JSON.stringify(F)} ? { id, nick: 'Аня' } : op(id);
      P.friendStatus = async ids => new Map(ids.filter(i => i === ${JSON.stringify(F)}).map(i => [i, { online: true, a: P.actParse('g:hub|d:klet2.${CODE}.f.2.8') }]));
      return 1; })()`);
    await B.ev(`(() => { const d = document.createElement('div'); d.id = 't174fr'; d.innerHTML = '<div class="role-result-row"><span class="role-result-nick" data-mini-uid="${F}">Аня</span></div>'; document.body.appendChild(d); D37Join.decorate(d); return 1; })()`);
    ok(await B.until(`!!document.querySelector('#t174fr .jn-jbtn')`, 8000), 'список друзей: у друга в комнате — «▶ Присоединиться»');
    await B.ev(`document.getElementById('t174fr').remove(), 1`);
    ok(await B.ev(`(() => { const t = D37Phone.actJoin(D37Phone.actParse('g:hub|d:klet2.${CODE}.f.2.8')); return t && t.d37 && t.href === '/hub/play/klet2/${CODE}' && t.label === '▶ Присоединиться'; })()`), 'занятие друга → «▶ Присоединиться» в его комнату');
    ok(await B.ev(`!D37Phone.actJoin(D37Phone.actParse('g:hub|d:klet2.${CODE}.f.8.8'))`), 'полная комната — кнопки нет');
    await B.ev(`D37Mini.open(${JSON.stringify(F)}, { nick: 'Аня' }), 1`);
    ok(await B.until(`[...document.querySelectorAll('.d37m-btn')].some(b => /Присоединиться/.test(b.textContent))`, 15000), 'мини-карточка: «▶ Присоединиться»', await B.ev(`[...document.querySelectorAll('.d37m-btn')].map(b => b.textContent)`));
    await sleep(400); await B.shot('t174_minicard_join_phone_light.png');
    await B.ev(`D37Mini.close(), 1`);
    // список комнат: «Друзья внутри»
    await B.ev(`document.querySelector('.jn')?._refresh?.(), 1`);
    await B.ev(`document.querySelector('.jn-chip[data-f="friends"]').click(), 1`);
    ok(await B.until(`[...document.querySelectorAll('.jn-row')].some(r => r.dataset.code === ${JSON.stringify(CODE)} && /Аня/.test(r.querySelector('.jn-fr')?.textContent || ''))`, 15000), 'список: фильтр «Друзья внутри» — комната с «Аня внутри»');

    // ═══ 9. Группа «Идём вместе»: ведущий в комнате — участник идёт туда же (канал подменён) ═══
    await B.ev(`(() => { window.__d37PartyChannel = (id, k) => { const ch = { cbs: [], on(t, f, cb){ ch.cbs.push(cb); return ch; }, subscribe(cb){ setTimeout(() => cb('SUBSCRIBED'), 10); return ch; },
        track(){ return Promise.resolve(); }, untrack(){}, unsubscribe(){}, presenceState(){ return { lead: [{ k: 'lead1', nick: 'Аня', lead: true, s: 'klet2.${CODE}' }], [k]: [{ k, nick: 'Боря', lead: false, s: '' }] }; } };
        window.__pch = ch; return ch; }; D37Join.partyJoin('abcdefgh', false); setTimeout(() => window.__pch.cbs.forEach(f => f()), 50); return 1; })()`);
    ok(await B.until(`location.pathname === ${JSON.stringify('/hub/play/klet2/' + CODE)}`, 8000), 'группа: ведущий в комнате — участник с «Идём вместе» открыл ту же комнату');
    await B.ev(`D37Join.partyLeave(), 1`);
    await B.until(LOADED, 150000);

    // ═══ 10. Тёмная тема на телефоне (список) ═══
    await B.ev(GO('/hub/lobby/klet2'));
    await B.ev(`(document.documentElement.setAttribute('data-theme', 'dark'), D37Settings.set('theme', 'dark'), 1)`);
    ok(await B.until(`document.querySelectorAll('.jn-row').length >= 1`, 20000), 'B: список (тёмная тема)');
    await sleep(500); await B.shot('t174_lobby_phone_dark.png');
    ok(await B.ev(NOSCROLL), 'B: тёмная, телефон — без прокрутки вбок');
    ok(await B.ev(`!window.__xss`), 'нигде не исполнилась чужая разметка');

    // ═══ 11. Сервер игр недоступен / не задан ═══
    const C = await chrome({ phone: true, theme: 'light', server: 'ws://127.0.0.1:1' }); pages.push(C);
    await C.send('Page.navigate', { url: site.base + '/hub/lobby' });
    ok(await C.until(READY, 90000), 'C: сайт загрузился');
    ok(await C.until(`/Сервер игр недоступен/.test(document.querySelector('.jn-list')?.textContent || '')`, 30000), 'сервер не отвечает — «Сервер игр недоступен — попробуй позже.»', await C.ev(`document.querySelector('.jn')?.innerText.slice(0, 200)`));
    ok(await C.ev(`document.querySelector('.jn-quick').disabled && document.querySelector('.jn-create').disabled`), 'кнопки «Быстрая игра» и «Создать» выключены, экран не сломан');
    await C.shot('t174_offline_phone_light.png');
    await C.ev(`(localStorage.setItem('d37_join_server', ''), 1)`);
    await C.ev(GO('/hub')); await sleep(300); await C.ev(GO('/hub/lobby'));
    ok(await C.until(`/Сервер игр недоступен/.test(document.querySelector('.jn-list')?.textContent || '')`, 15000), 'адрес не задан (как в config.js по умолчанию) — тот же понятный экран');
    ok(await C.ev(`!D37Phone.actJoin(D37Phone.actParse('g:hub|d:klet2.${CODE}.o.2.8'))`), 'без сервера кнопки «Присоединиться» нет');
    // ═══ 12. Без моста лобби у движка (старая сборка) — раздел прячется ═══
    await C.ev(`(async () => { const g = await D37Hub.resolveGame('klet2'); localStorage.setItem('d37_join_bridge', JSON.stringify({ id: g.build.id, base: g.base, ok: false })); localStorage.setItem('d37_join_server', ${JSON.stringify(WS)}); return 1; })()`);
    await C.send('Page.reload', {});
    ok(await C.until(READY, 90000), 'C: перезагрузилась');
    await C.ev(GO('/hub'));
    await sleep(3000);
    ok(await C.ev(`!document.querySelector('#hub-page .jn') && document.querySelectorAll('#hub-page .hub-tile').length >= 6`), 'нет моста у движка — раздела комнат нет, меню на месте');
    for (const p of pages) ok(p.errs.length === 0, 'нет ошибок страницы', p.errs.slice(0, 3));
  } catch (e) {
    ok(false, 'прогон дошёл до конца', String(e && e.stack || e).slice(0, 600));
  } finally {
    for (const p of pages) await p.close();
    try { gs && gs.kill(); } catch (e) {}
    site.stop();
    console.log(`\nt174-e2e: ${n - fails} из ${n} прошло${fails ? ', упало ' + fails : ''}`);
    process.exit(fails ? 1 : 0);
  }
})();

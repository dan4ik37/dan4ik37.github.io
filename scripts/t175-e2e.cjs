// T-175: комнаты БЕЗ сервера игр — прямое соединение браузеров (WebRTC) — проверка в настоящем Chrome (headless, без npm, загрузки запрещены).
// Три страницы, НИ ОДНОГО сервера игр: комнату держит браузер хозяина. Сайт — scripts/serve.py за маленьким прокси этого теста, который
// (1) отдаёт /d37-preview/ из пакета движка ветки ep27-p2p (PACK=<папка dist\web>; d37-preview сайта не трогаем) и (2) играет роль канала
// Supabase Realtime (/__rt: присутствие + broadcast через SSE) — в базу ничего, наружу ничего (адрес TURN-сервера и STUN закрыты).
// WebRTC настоящий, между страницами на 127.0.0.1 (ICE без серверов: только свои адреса).
//  A (ПК, тёмная) создаёт комнату (название с разметкой — только текстом); B (телефон 390×844, светлая) видит её в списке и заходит;
//  C — по коду, потом по ссылке; все трое двигаются, метки хэша мира совпадают; A уходит — комната живёт, хозяин B, она всё ещё в списке;
//  C перезагружается и возвращается на своё место; таблица правила адреса; «нужен сервер-посредник» без TURN; без прокрутки вбок.
// Запуск из корня сайта: node scripts/t175-e2e.cjs   (PACK=…, CHROME=…, PYTHON=…)
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http'), { spawn } = require('child_process');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TMP = process.env.D37_TMP || (fs.existsSync('M:/d37/claude-tmp') ? 'M:/d37/claude-tmp/p2p' : os.tmpdir());
const SHOTS = process.env.SHOTS || path.join(TMP, 'shots');
const PACK = path.resolve(process.env.PACK || 'M:/d37/d37-wt/ep27-p2p/dist/web');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, n = 0;
const ok = (c, m, x) => { n++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); if (!c) fails++; };
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.ron': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css' };

// ═══ свой «Realtime»: каналы с присутствием и broadcast, доставка по SSE ═══
function rtHub(){
  const clients = new Map(), chans = new Map();
  const cl = id => { let c = clients.get(id); if (!c) { c = { res: null, q: [], chans: new Set() }; clients.set(id, c); } return c; };
  const push = (id, m) => { const c = cl(id); if (c.res) c.res.write('data: ' + JSON.stringify(m) + '\n\n'); else c.q.push(m); };
  const sync = name => { const ch = chans.get(name); if (!ch) return; const state = {}; for (const x of ch.values()) if (x.meta) (state[x.key] = state[x.key] || []).push(x.meta); for (const id of ch.keys()) push(id, { ch: name, k: 'sync', state }); };
  const drop = id => { const c = clients.get(id); if (!c) return; clients.delete(id); for (const name of c.chans) { const ch = chans.get(name); if (ch) { ch.delete(id); sync(name); } } };
  return {
    stats: () => ({ clients: clients.size, chans: [...chans].map(([k, v]) => [k, v.size]) }),
    handle(req, res, url){
      if (url.pathname === '/__rt/sse') {
        const id = url.searchParams.get('id') || '';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n');
        const c = cl(id); c.res = res; for (const m of c.q.splice(0)) push(id, m);
        req.on('close', () => drop(id));
        return;
      }
      let body = '';
      req.on('data', d => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
        const id = String(b.id || ''), name = String(b.ch || '');
        const ch = chans.get(name) || new Map(); chans.set(name, ch);
        if (url.pathname === '/__rt/join') { ch.set(id, { key: String(b.key || id), meta: null }); cl(id).chans.add(name); sync(name); }
        else if (url.pathname === '/__rt/track') { const x = ch.get(id); if (x) { x.meta = b.meta || null; sync(name); } }
        else if (url.pathname === '/__rt/leave') { ch.delete(id); cl(id).chans.delete(name); sync(name); }
        else if (url.pathname === '/__rt/send') { for (const other of ch.keys()) if (other !== id) push(other, { ch: name, k: 'bc', event: b.event, payload: b.payload }); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}');
      });
    },
  };
}
async function startSite(rt){
  const pyPort = await freePort();
  const py = spawn(process.env.PYTHON || 'python', [path.join(SITE, 'scripts/serve.py'), String(pyPort)], { cwd: SITE, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${pyPort}/`); if (r.ok) break; } catch (e) {} await sleep(150); }
  const port = await freePort();
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/__rt/')) return rt.handle(req, res, url);
    if (url.pathname.startsWith('/d37-preview/')) {
      const rel = decodeURIComponent(url.pathname.slice('/d37-preview/'.length)) || 'index.html';
      const f = path.normalize(path.join(PACK, rel));
      if (!f.startsWith(PACK) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
      return;
    }
    const p = http.request({ host: '127.0.0.1', port: pyPort, path: req.url, method: req.method, headers: Object.assign({}, req.headers, { host: `127.0.0.1:${pyPort}` }) }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on('error', () => { try { res.writeHead(502); res.end(); } catch (e) {} });
    req.pipe(p);
  });
  await new Promise(r => srv.listen(port, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${port}`, stop(){ try { srv.close(); } catch (e) {} try { py.kill(); } catch (e) {} } };
}
// страница: канал Realtime этого теста, ICE без внешних серверов, «есть ли TURN» — window.__t175Turn
const INJECT = `(() => {
  const RT = location.origin + '/__rt', id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let es = null; const chans = new Map();
  const sse = () => { if (es) return; es = new EventSource(RT + '/sse?id=' + id); es.onmessage = e => { const m = JSON.parse(e.data); const c = chans.get(m.ch); if (!c) return;
    if (m.k === 'sync') { c.state = m.state; c.cbs.sync.forEach(f => { try { f(); } catch (er) { console.error(er); } }); }
    else if (m.k === 'bc') (c.cbs.bc[m.event] || []).forEach(f => { try { f({ type: 'broadcast', event: m.event, payload: m.payload }); } catch (er) { console.error(er); } }); }; };
  const post = (p, b) => fetch(RT + p, { method: 'POST', body: JSON.stringify(Object.assign({ id }, b)) }).catch(() => {});
  window.__d37P2PChannel = (name, key) => { sse(); const c = { state: {}, cbs: { sync: [], bc: {} } };
    const ch = { on(t, f, cb){ if (t === 'presence') c.cbs.sync.push(cb); else if (t === 'broadcast') (c.cbs.bc[f.event] = c.cbs.bc[f.event] || []).push(cb); return ch; },
      subscribe(cb){ chans.set(name, c); post('/join', { ch: name, key }).then(() => cb && cb('SUBSCRIBED')); return ch; },
      track(meta){ return post('/track', { ch: name, meta }); }, untrack(){ return post('/track', { ch: name, meta: null }); },
      send(m){ return post('/send', { ch: name, event: m.event, payload: m.payload }); }, presenceState(){ return c.state; },
      unsubscribe(){ chans.delete(name); return post('/leave', { ch: name }); } };
    return ch; };
  window.__d37P2PIce = relay => ({ iceServers: [], iceTransportPolicy: relay ? 'relay' : 'all', relay, ok: !relay || !!window.__t175Turn });
  window.__d37P2PRelayOk = () => !!window.__t175Turn;
})();`;
async function chrome({ phone, theme, adult, uid }){
  fs.mkdirSync(TMP, { recursive: true });
  const port = await freePort(), profile = fs.mkdtempSync(path.join(TMP, 'chr-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns', 'about:blank'], { stdio: 'ignore', env: { ...process.env, TMP, TEMP: TMP } });
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
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.setDownloadBehavior', { behavior: 'deny' });
  // наружу — ничего: сервер владельца (RT / TURN) и STUN закрыты
  await send('Network.setBlockedURLs', { urls: ['*130.61.75.73*', '*stun.l.google.com*', '*stun.cloudflare.com*'] });
  if (phone) {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  } else await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const y = new Date().getFullYear() - (adult ? 30 : 15);
  const L = { d37_join_on: '1', d37_age_ask: String(Date.now() + 864e6), d37_app: JSON.stringify({ x: 1, v: 1 }), d37_theme: theme, d37_age: JSON.stringify({ y, s: 'g', fa: Date.now() - 40 * 864e5 }), d37_hub_gfx: 'gl', d37_join_server: '' };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try{if(!localStorage.getItem('t175')){localStorage.setItem('t175','1');${Object.entries(L).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)});`).join('')}}}catch(e){}` + INJECT + (uid ? `window.__d37P2PUid=()=>${JSON.stringify(uid)};` : '') });
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(250); } return false; };
  const shot = async name => { fs.mkdirSync(SHOTS, { recursive: true }); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64')); console.log('    картинка ' + path.join(SHOTS, name)); };
  const close = async () => { try { ws.close(); } catch (e) {} try { proc.kill(); } catch (e) {} await sleep(400); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, until, shot, close, errs };
}
const READY = `!!window.D37Route && !!window.D37Hub && !!window.D37Join && !!window.D37JoinP2P && !!window.D37Phone && document.readyState === 'complete'`;
const GO = p => `(D37Route.go(${JSON.stringify(p)}), true)`;
const ST = `(() => { const s = D37Join.state, h = D37Hub._st.h, l = h && h.lobby ? h.lobby.state() : null; return { online: s.online, cur: s.cur, last: l, p2p: D37JoinP2P.state() }; })()`;
const LOADED = `!!(D37Hub._st.h && D37Hub._st.h.state.loaded)`;
const XSS = '<img src=x onerror="window.__xss=1">';
const NOSCROLL = `document.documentElement.scrollWidth <= innerWidth + 1`;
// друзья друг другу (вход не делаем: список друзей подменён в странице, «Скрыть мой адрес» выключен — правило даёт «напрямую»)
const UIDS = ['aaaaaaaa-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-00000000000b', 'cccccccc-0000-4000-8000-00000000000c'];
const FRIENDS = me => `(() => { const P = D37Phone; P.friends = async () => ({ list: ${JSON.stringify(UIDS)}.filter(x => x !== ${JSON.stringify(me)}), incoming: [] }); if (P.set) P.set.hide = 'off'; return 1; })()`;
const marksOf = s => new Map(((s && s.last && s.last.marks) || []).map(m => [m[0], m[1]]));
function agree(a, b){ let same = 0, diff = 0; for (const [k, v] of a) if (b.has(k)) { if (b.get(k) === v) same++; else diff++; } return { same, diff }; }

(async () => {
  if (!fs.existsSync(path.join(PACK, 'engine-host.js'))) { console.log('нет пакета движка: ' + PACK + ' (PACK=…)'); process.exit(1); }
  const rt = rtHub();
  const site = await startSite(rt);
  const pages = [];
  try {
    console.log('сайт ' + site.base + ', пакет ' + PACK + ' (сервера игр нет)');
    const host = fs.readFileSync(path.join(PACK, 'engine-host.js'), 'utf8');
    ok(/\bnet\s*:\s*\{/.test(host) && /p2p_start/.test(host), 'пакет движка: мост handle.net (P2P) есть');
    const A = await chrome({ phone: false, theme: 'dark', adult: true, uid: UIDS[0] }); pages.push(A);
    const B = await chrome({ phone: true, theme: 'light', adult: true, uid: UIDS[1] }); pages.push(B);
    const C = await chrome({ phone: false, theme: 'light', adult: true, uid: UIDS[2] }); pages.push(C);

    // ═══ 0. Правило адреса: таблица всех сочетаний (одна чистая функция) ═══
    await A.send('Page.navigate', { url: site.base + '/hub/lobby/klet2' });
    ok(await A.until(READY, 90000), 'A: сайт загрузился');
    const table = await A.ev(`(() => { const f = D37JoinP2P.p2pPolicy, B = [false, true], out = { n: 0, bad: [] };
      for (const ma of B) for (const mh of B) for (const mad of B) for (const hs of ['auto', 'on', 'off']) for (const pa of B) for (const ph of B) for (const fr of B) {
        const me = { adult: ma, hide: mh, admin: mad, hideSet: hs }, peer = { adult: pa, hide: ph, friend: fr };
        const want = fr && ma && pa && !mh && !ph && !(mad && hs !== 'off') ? 'direct' : 'relay';
        out.n++; if (f(me, peer) !== want) out.bad.push([me, peer, f(me, peer)]); }
      out.nulls = [f(null, {}), f({}, null), f({ adult: true }, { adult: true, friend: true })];
      return out; })()`);
    ok(table.n === 192 && table.bad.length === 0, 'правило адреса: 192 сочетания — «напрямую» только взаимные друзья, оба 18+, никто не скрыт, админ скрыт по умолчанию', table);
    ok(table.nulls[0] === 'relay' && table.nulls[1] === 'relay' && table.nulls[2] === 'direct', 'без данных — через посредник; минимальное «да» — напрямую', table.nulls);

    // ═══ 1. A: список пуст, без TURN — честная пометка «нужен сервер-посредник» ═══
    ok(await A.until(`!!document.querySelector('.jn:not([hidden])') && /никто не играет/.test(document.querySelector('.jn-list')?.textContent || '')`, 40000), 'A: раздел комнат без сервера игр, пустой список', await A.ev(`document.querySelector('.jn')?.innerText.slice(0, 300) || 'нет раздела'`));
    ok(await A.ev(`!document.querySelector('.jn-note').hidden && /Нужен сервер-посредник — пока играть можно только с друзьями/.test(document.querySelector('.jn-note').textContent)`), 'A: без TURN — «Нужен сервер-посредник — пока играть можно только с друзьями»');
    ok(await A.ev(`!document.querySelector('.jn-quick').disabled && !document.querySelector('.jn-create').disabled`), 'A: «Быстрая игра» и «Создать» работают без сервера игр');

    // ═══ 2. A создаёт комнату (название с разметкой) ═══
    await A.ev(FRIENDS(UIDS[0]));
    await A.ev(`document.querySelector('.jn-create').click(), 1`);
    ok(await A.until(`!!document.querySelector('.jn-bg .jn-name-in')`, 5000), 'A: лист «Новая комната»');
    await A.ev(`(() => { const i = document.querySelector('.jn-bg .jn-name-in'); i.value = 'Аня ' + ${JSON.stringify(XSS)}; [...document.querySelectorAll('.jn-bg .jn-seg button')].find(b => b.textContent === '8').click(); return 1; })()`);
    await A.ev(`document.querySelector('.jn-bg .jn-mk').click(), 1`);
    ok(await A.until(`/^\\/hub\\/play\\/klet2\\/[A-HJKMNP-Z2-9]{6}$/.test(location.pathname)`, 5000), 'A: «Создать и играть» → /hub/play/klet2/<КОД>', await A.ev('location.pathname'));
    const CODE = (await A.ev('location.pathname')).split('/').pop();
    ok(await A.until(LOADED, 180000), 'A: игра загрузилась', await A.ev(`({ err: D37Hub._st.errors })`));
    ok(await A.until(`(() => { const s = ${ST}; return s.online && s.last && s.last.code === ${JSON.stringify(CODE)} && s.last.p2p && s.last.p2p.role === 'host'; })()`, 60000), 'A: хозяин комнаты в своём браузере (движок: role host, код)', await A.ev(ST));
    ok(await A.until(`(() => { const e = D37JoinP2P.lobby.rows.get(${JSON.stringify(CODE)}); return e && e.max === 8 && /Аня/.test(e.name) && e.host === D37JoinP2P.tag; })()`, 20000), 'A: запись комнаты в списке (присутствие): название, 8 мест, тег хозяина', await A.ev(`[...D37JoinP2P.lobby.rows.values()]`));
    await sleep(1500); await A.shot('t175_host_pc_dark.png');

    // ═══ 3. B (телефон): видит комнату в списке и заходит ═══
    await B.send('Page.navigate', { url: site.base + '/hub/lobby/klet2' });
    ok(await B.until(READY, 90000), 'B: сайт загрузился');
    await B.ev(FRIENDS(UIDS[1]));
    ok(await B.until(`[...document.querySelectorAll('.jn-row')].some(r => r.dataset.code === ${JSON.stringify(CODE)})`, 40000), 'B: комната A в списке', await B.ev(`document.querySelector('.jn')?.innerText.slice(0, 300)`));
    const rowB = await B.ev(`(() => { const r = [...document.querySelectorAll('.jn-row')].find(r => r.dataset.code === ${JSON.stringify(CODE)}); return { name: r.querySelector('.jn-name').textContent, n: r.querySelector('.jn-n').textContent, img: !!r.querySelector('img'), xss: !!window.__xss }; })()`);
    ok(/Аня/.test(rowB.name) && /<img/.test(rowB.name) && !rowB.img && !rowB.xss, 'B: название с разметкой — только текстом, ничего не исполнилось', rowB);
    ok(await B.ev(NOSCROLL), 'B: телефон 390 — без прокрутки вбок');
    await B.shot('t175_lobby_phone_light.png');
    await B.ev(`[...document.querySelectorAll('.jn-row')].find(r => r.dataset.code === ${JSON.stringify(CODE)}).querySelector('.jn-go').click(), 1`);
    ok(await B.until(`location.pathname === ${JSON.stringify('/hub/play/klet2/' + CODE)}`, 5000), 'B: «Войти» → игра этой комнаты');
    ok(await B.until(LOADED, 180000), 'B: игра загрузилась');
    const nP = k => `(() => { const s = ${ST}; return s.online && s.last && s.last.people === ${k} && s.last.phase === 'playing'; })()`;
    ok(await B.until(nP(2), 60000) && await A.until(nP(2), 20000), 'A и B в одной комнате без сервера: по 2 человека', { a: (await A.ev(ST)).last, b: (await B.ev(ST)).last, bp: (await B.ev(ST)).p2p });
    const bs = await B.ev(ST);
    ok(bs.last.p2p && bs.last.p2p.role === 'member' && bs.p2p && bs.p2p.conns.some(c => c.open && !c.relay), 'B: участник, канал данных к хозяину открыт напрямую (друзья 18+)', bs.p2p);

    // ═══ 4. C: по коду ═══
    await C.send('Page.navigate', { url: site.base + '/hub/lobby/klet2' });
    ok(await C.until(READY, 90000), 'C: сайт загрузился');
    await C.ev(FRIENDS(UIDS[2]));
    ok(await C.until(`!!document.querySelector('.jn-codei')`, 30000), 'C: поле кода');
    await C.ev(`(() => { const i = document.querySelector('.jn-codei'); i.value = ${JSON.stringify(CODE.toLowerCase())}; i.dispatchEvent(new Event('input')); document.querySelector('.jn-codef').requestSubmit(); return 1; })()`);
    ok(await C.until(`location.pathname === ${JSON.stringify('/hub/play/klet2/' + CODE)}`, 5000), 'C: код → /hub/play/klet2/<КОД>');
    ok(await C.until(LOADED, 180000) && await C.until(nP(3), 60000) && await A.until(nP(3), 20000) && await B.until(nP(3), 20000), 'A, B, C в одной комнате: по 3 человека', (await C.ev(ST)).last);

    // ═══ 5. Все трое двигаются, метки хэша мира совпадают ═══
    const move = async (P, k) => P.ev(`(() => { const c = document.querySelector('canvas'); const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA']; window.__mv && clearInterval(window.__mv); let i = ${k}; window.__mv = setInterval(() => { const o = keys[i % 4]; i++; window.dispatchEvent(new KeyboardEvent('keyup', { code: keys[(i + 2) % 4], bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { code: o, bubbles: true })); }, 700); return 1; })()`);
    await move(A, 0); await move(B, 1); await move(C, 2);
    await sleep(12000);
    const [sa, sb, sc] = [await A.ev(ST), await B.ev(ST), await C.ev(ST)];
    const ab = agree(marksOf(sa), marksOf(sb)), ac = agree(marksOf(sa), marksOf(sc)), bc = agree(marksOf(sb), marksOf(sc));
    ok(ab.diff + ac.diff + bc.diff === 0 && ab.same >= 3 && ac.same >= 3 && bc.same >= 3, 'метки хэша мира совпадают у всех троих', { ab, ac, bc, steps: [sa.last.step, sb.last.step, sc.last.step] });
    const moved = s => (s.last.ppl || []).length === 3;
    ok(moved(sa) && moved(sb) && moved(sc), 'у всех в мире три человека', sa.last.ppl);
    const link = await C.ev(`D37Join.inviteLink()`);
    ok(new RegExp('/hub/play/klet2/' + CODE + '$').test(link), 'приглашение: ссылка /hub/play/klet2/<КОД>', link);

    // ═══ 6. Хозяин A уходит — комната живёт, хозяин B (первый по порядку входа), запись в списке переехала ═══
    const stepBefore = (await B.ev(ST)).last.step;
    await A.ev(GO('/hub'));
    ok(await B.until(`(() => { const s = ${ST}; return s.last && s.last.p2p && s.last.p2p.role === 'host' && s.last.people === 2; })()`, 40000), 'A ушёл: B — новый хозяин, в комнате 2', (await B.ev(ST)).last);
    ok(await C.until(`(() => { const s = ${ST}; return s.last && s.last.p2p && s.last.p2p.role === 'member' && s.last.p2p.hostTag === ${JSON.stringify(await B.ev('D37JoinP2P.tag'))} && s.last.people === 2 && s.last.p2p.migrations === 1; })()`, 40000), 'C: соединился с новым хозяином B', (await C.ev(ST)).last);
    ok(await C.until(`(() => { const e = D37JoinP2P.lobby.rows.get(${JSON.stringify(CODE)}); return e && e.host !== '' && e.host === ${JSON.stringify(await B.ev('D37JoinP2P.tag'))}; })()`, 30000), 'комната всё ещё в списке — запись теперь у B', await C.ev(`[...D37JoinP2P.lobby.rows.values()]`));
    await sleep(8000);
    const [mb, mc] = [await B.ev(ST), await C.ev(ST)];
    const after = agree(new Map([...marksOf(mb)].filter(([k]) => k > stepBefore)), marksOf(mc));
    ok(mb.last.step > stepBefore + 100 && after.diff === 0 && after.same >= 3, 'комната идёт дальше, метки B и C совпадают после переезда', { after, step: [stepBefore, mb.last.step, mc.last.step] });
    await sleep(500); await B.shot('t175_migrated_phone_light.png');

    // ═══ 7. C перезагружается — возвращается на своё место (ключ возврата) ═══
    await sleep(2000);
    const pre = await C.ev(ST);
    await C.send('Page.reload', {});
    ok(await C.until(READY, 90000), 'C: перезагрузилась');
    await C.ev(FRIENDS(UIDS[2]));
    ok(await C.until(LOADED, 180000), 'C: после перезагрузки игра снова загрузилась');
    ok(await C.until(nP(2), 60000), 'C: снова в комнате (2 человека)', (await C.ev(ST)).last);
    const post = await C.ev(ST);
    ok(post.last.slot === pre.last.slot && post.last.key === pre.last.key && post.last.round === pre.last.round, 'C: то же место, тот же ключ и раунд', { pre: [pre.last.slot, pre.last.key, pre.last.round], post: [post.last.slot, post.last.key, post.last.round] });

    // ═══ 8. Ребёнок (адрес скрыт), TURN нет — понятное сообщение, а не «тишина» ═══
    const D = await chrome({ phone: true, theme: 'dark', adult: false }); pages.push(D);
    await D.send('Page.navigate', { url: site.base + '/hub/play/klet2/' + CODE });
    ok(await D.until(READY, 90000) && await D.until(LOADED, 180000), 'D (ребёнок): игра по ссылке загрузилась');
    ok(await D.until(`[...document.querySelectorAll('.hub-gtoast')].some(t => /Нужен сервер-посредник — пока играть можно только с друзьями/.test(t.textContent)) || D37JoinP2P.state()?.failed === 'relay'`, 30000), 'D: без TURN — «Нужен сервер-посредник — пока играть можно только с друзьями»', await D.ev(`D37JoinP2P.state()`));
    await D.shot('t175_relay_note_phone_dark.png');
    ok(await D.ev(NOSCROLL), 'D: телефон, тёмная — без прокрутки вбок');
    ok(await B.ev(`!window.__xss`) && await C.ev(`!window.__xss`), 'нигде не исполнилась чужая разметка');
    for (const p of pages) ok(p.errs.length === 0, 'нет ошибок страницы', p.errs.slice(0, 3));
  } catch (e) {
    ok(false, 'прогон дошёл до конца', String(e && e.stack || e).slice(0, 600));
  } finally {
    for (const p of pages) await p.close();
    site.stop();
    console.log(`\nt175-e2e: ${n - fails} из ${n} прошло${fails ? ', упало ' + fails : ''}`);
    process.exit(fails ? 1 : 0);
  }
})();

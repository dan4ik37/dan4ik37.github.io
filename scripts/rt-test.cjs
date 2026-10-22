// Проверки T-045: свой сервер реального времени (server/rt) и клиент сайта D37RT (js/core/rt.js), в node, без браузера.
// Настоящий сервер — отдельным процессом (как в контейнере), подменный Supabase Realtime (scripts/rt-phoenix.cjs, протокол Phoenix)
// и НАСТОЯЩИЙ supabase-js 2.117.2 (тот же файл, что грузит сайт), «вкладки» — свои vm-контексты с room.js / table.js / iokit.js.
//  1) протокол: hi + проба, ping/pong, комнаты, presence в форме Supabase (metas + phx_ref), broadcast self:false/true, /health,
//     /metrics, /turn (HMAC как у coturn), CORS, 404;
//  2) пределы: Origin, адреса (X-Forwarded-For от Caddy), соединения, каналы, комната, размер meta, частота track, размер и поток
//     сообщений, мусор, «молчун», обслуживание; адресов в журнале нет;
//  3) мусор (fuzz) — сервер живёт, внутренних ошибок нет;
//  4) переподключение: сеанс продолжается (resumed), пропущенное досылается в обе стороны, повтор (q) не выполняется дважды;
//  5) вход: JWT по JWKS (ES256) → presence с ключом = id аккаунта получает _v: 1; чужой/просроченный/подделанный — нет;
//  6) сторож Supabase: новая комната с людьми в Supabase → «sb»; кто-то появился в Supabase → вся комната и её «-r» → 'mv';
//  7) D37RT: формы presenceState() и событий join/leave/sync — те же, что у supabase-js (сравнение на одном сценарии);
//  8) room.js через D37RT: игра вдвоём; кто-то с ?rt=0 → комната переехала, «соперник ушёл» не было; сервер убит посреди
//     партии → оба в Supabase, комната собралась, сообщения ходят; обрыв связи → тот же сеанс без потерь; «16 КБ» (связь режут
//     после 16 КБ) → проба не прошла, весь сеанс через Supabase; RT_URL пустой — ни одного запроса к серверу (как раньше);
//  9) table.js (личные сообщения шифром) и IoKit (канал «-r») через D37RT; TURN (D37RT.ice(), window.D37_TURN);
// 10) 20 входов/выходов — на сервере 0 комнат и мест, у клиента 0 каналов/ожиданий, таймеры не растут.
// Запуск из корня сайта: DEPS_DIR=<папка с ws@8.21.3 и @supabase/supabase-js@2.117.2> node scripts/rt-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), net = require('net'), http = require('http'), crypto = require('crypto');
const K = require('./rt-kit.cjs');
const PH = require('./rt-phoenix.cjs');
const D = K.deps();
if (!D || !D.umd) { console.log('rt-test: нет пакетов ws@8.21.3 и @supabase/supabase-js@2.117.2 (DEPS_DIR) — пропуск'); process.exit(process.env.CI_STRICT ? 1 : 0); }
const { turnValid } = require(path.join(K.SITE, 'server/rt/src/turn.js'));
const SITE = K.SITE;
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const UMD = fs.readFileSync(D.umd, 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 700)); } };
const { sleep, until } = K;
const ADMIN = 'adm-' + crypto.randomBytes(8).toString('hex');
const TURN_SECRET = 'turn-' + crypto.randomBytes(8).toString('hex');
const cleanup = [];
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL тест не дошёл до конца'); process.exitCode = 1; } });

// ═══ «Вкладка»: свой vm-контекст как в браузере (supabase-js, js/core/rt.js, игры) ═══
const SRC = { rt: read('js/core/rt.js'), room: read('js/games/room.js'), table: read('js/games/table.js'), netplay: read('js/games/netplay.js'), iokit: read('js/games/iokit.js') };
const FAST = { PROBE_MS: 2500, HEALTH_MS: 2000, JOIN_MS: 3000, PING_MS: 400, DEAD_MS: 1500, FAIL_MS: 1500, FAIL_RESTART_MS: 2500, SETTLE_MS: 2500, IDLE_MS: 600, DOWN_MS: 1500, ACK_MS: 3000 };
function storage(){ const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), get length(){ return m.size; } }; }
class TabWS extends D.WS { constructor(url, protocols){ super(url, protocols || undefined, { origin: 'http://localhost:5500', perMessageDeflate: false }); } }
function makeTab(o = {}){
  const timers = new Set(), errs = [], net = { rtFetch: 0, rtWs: 0, other: 0 };
  const ls = storage(), ss = storage();
  if (o.ls) for (const [k, v] of Object.entries(o.ls)) ls.setItem(k, v);
  const listeners = new Map();
  const ctx = {
    console: { log(){}, info(){}, debug(){}, warn: (...a) => { if (!/falling back to REST|heartbeat/i.test(a.join(' '))) errs.push('warn ' + a.map(String).join(' ').slice(0, 200)); }, error: (...a) => errs.push(a.map(x => (x && x.stack) || String(x)).join(' ').slice(0, 300)) },
    setTimeout: (f, ms, ...a) => { const t = setTimeout(() => { timers.delete(t); f(...a); }, ms); timers.add(t); return t; },
    clearTimeout: t => { if (t) { timers.delete(t); clearTimeout(t); } },
    setInterval: (f, ms, ...a) => { const t = setInterval(f, ms, ...a); timers.add(t); return t; },
    clearInterval: t => { if (t) { timers.delete(t); clearInterval(t); } },
    queueMicrotask, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Headers, Request, Response, Blob, btoa, atob,
    crypto: globalThis.crypto, performance,
    fetch: (u, opt) => { if (o.rtUrl && String(u).startsWith(o.rtUrl)) net.rtFetch++; if (!String(u).startsWith(o.sbUrl)) net.other++; return fetch(u, opt); },
    WebSocket: class extends TabWS { constructor(u, p){ super(u, p); if (o.rtUrl && String(u).startsWith(o.rtUrl.replace(/^http/, 'ws'))) net.rtWs++; if (!String(u).startsWith(o.sbUrl.replace(/^http/, 'ws'))) net.other++; } },
    location: { hostname: 'localhost', host: 'localhost:5500', origin: 'http://localhost:5500', protocol: 'http:', pathname: '/', search: o.search || '', hash: '', href: 'http://localhost:5500/' + (o.search || '') },
    navigator: { onLine: true, userAgent: 'node-test' },
    localStorage: ls, sessionStorage: ss,
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => { listeners.get(t)?.delete(f); },
    dispatchEvent: e => { for (const f of [...(listeners.get(e.type) || [])]) { try { f(e); } catch (er) { errs.push(String(er)); } } return true; },
    esc: s => String(s),
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  if (o.rtUrl !== undefined) ctx.RT_URL = o.rtUrl;
  ctx.__D37RT_T = Object.assign({}, FAST, o.timing || {});
  vm.createContext(ctx);
  vm.runInContext(UMD, ctx, { filename: 'supabase.js' });
  ctx.sbClient = ctx.supabase.createClient(o.sbUrl, 'test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, realtime: { vsn: '1.0.0', heartbeatIntervalMs: 5000 } });
  for (const f of ['rt', 'room', 'table', 'netplay', 'iokit']) vm.runInContext(SRC[f], ctx, { filename: f + '.js' });
  const T = { ctx, timers, errs, net, listeners, RT: ctx.D37RT, GR: ctx.GameRoom };
  T.close = async () => { try { for (const f of [...(listeners.get('pagehide') || [])]) f({ type: 'pagehide', persisted: false }); } catch (e) {} try { await ctx.sbClient.removeAllChannels(); } catch (e) {} try { ctx.D37RT._test.reset(); } catch (e) {} for (const t of timers) { clearTimeout(t); clearInterval(t); } timers.clear(); };
  cleanup.push(T.close);
  return T;
}
const viaAll = (T, via) => { const c = T.RT.stats().chans; return c.length > 0 && c.every(x => x.via === via && x.state === 'joined' && !x.held); };

// ═══ Подменный «прокси провайдера»: обрыв связи / «16 КБ и стоп» ═══
function proxy(targetPort, o = {}){
  const pairs = new Set();
  const srv = net.createServer(c => {
    const u = net.connect(targetPort, '127.0.0.1');
    const pair = { c, u, down: 0 };
    pairs.add(pair);
    const end = () => { pairs.delete(pair); try { c.destroy(); } catch (e) {} try { u.destroy(); } catch (e) {} };
    c.on('data', d => { try { u.write(d); } catch (e) {} });
    u.on('data', d => {
      if (P.delay) { const x = d; setTimeout(() => { try { c.write(x); } catch (e) {} }, P.delay); return; }
      if (P.cutAfter) {   // как у провайдеров в России к зарубежным хостингам: первые ~16 КБ проходят, дальше соединение «висит»
        const keep = P.cutAfter - pair.down;
        if (keep <= 0) return;
        if (d.length > keep) d = d.subarray(0, keep);
      }
      pair.down += d.length;
      try { c.write(d); } catch (e) {}
    });
    c.on('error', end); u.on('error', end); c.on('close', end); u.on('close', end);
  });
  const P = { cutAfter: o.cutAfter || 0, delay: o.delay || 0, pairs };
  P.ready = new Promise(r => srv.listen(0, '127.0.0.1', () => { P.port = srv.address().port; P.url = 'http://127.0.0.1:' + P.port; r(); }));
  P.cut = () => { for (const p of [...pairs]) { pairs.delete(p); try { p.c.destroy(); } catch (e) {} try { p.u.destroy(); } catch (e) {} } };
  P.close = () => new Promise(r => { P.cut(); srv.close(() => r()); });
  cleanup.push(P.close);
  return P;
}

// ═══ 1–3. Протокол, пределы, мусор ═══
async function protocol(){
  const S = await K.startServer(D, { ADMIN_TOKEN: ADMIN, ROOM_GC_MS: '0', TURN_SECRET, TURN_HOST: '203.0.113.7', TURN_BURST: '3', MAX_CHANNELS: '5', MAX_ROOM_SUBS: '4', MAX_META: '512', TRACK_BURST: '3', TRACK_PER_SEC: '0.5', MAX_PER_IP: '3', IP_BURST: '100', HELLO_MS: '300', MSG_BURST: '60', MSG_PER_SEC: '30', ABUSE_DROPS: '40', MAX_MSG: '65536' });
  cleanup.push(() => S.kill());
  // HTTP
  let r = await fetch(S.url + '/health', { headers: { origin: 'https://dan4ik37.vercel.app' } });
  let j = await r.json();
  ok(r.status === 200 && j.ok === true && j.rooms === true && j.proto === 1 && j.v && typeof j.conns === 'number' && typeof j.load === 'number', '/health: ok, rooms, proto 1, без секретов', j);
  ok(r.headers.get('access-control-allow-origin') === 'https://dan4ik37.vercel.app' && r.headers.get('cache-control') === 'no-store', '/health: CORS для сайта, no-store');
  r = await fetch(S.url + '/health', { headers: { origin: 'https://evil.example' } });
  ok(!r.headers.get('access-control-allow-origin'), '/health: чужому сайту CORS нет');
  ok(!/TURN|secret|token|adm-/i.test(JSON.stringify(j)), '/health: ни секретов, ни токенов');
  r = await fetch(S.url + '/metrics'); ok(r.status === 401, '/metrics без ключа — 401');
  r = await fetch(S.url + '/metrics', { headers: { Authorization: 'Bearer wrong' } }); ok(r.status === 401, '/metrics с чужим ключом — 401');
  j = await S.metrics(ADMIN); ok(j.counts && j.stats && j.mem && typeof j.cpuPct === 'number' && j.loopMs, '/metrics с ключом — счётчики, память, процессор, задержка цикла', Object.keys(j));
  r = await fetch(S.url + '/nope'); ok(r.status === 404, 'неизвестный адрес — 404');
  r = await fetch(S.url + '/health', { method: 'POST' }); ok(r.status === 405, 'POST /health — 405');
  // TURN
  r = await fetch(S.url + '/turn', { headers: { origin: 'http://localhost:5571' } });
  j = await r.json();
  const ts = j.iceServers?.[1];
  ok(r.status === 200 && j.ttl === 3600 && j.iceServers?.[0]?.urls?.[0] === 'stun:203.0.113.7:3478' && ts?.urls?.join() === 'turn:203.0.113.7:3478?transport=udp,turn:203.0.113.7:3478?transport=tcp', '/turn: STUN + TURN udp/tcp, срок 1 ч', j);
  ok(ts && /^\d{10}:[\w-]{8}$/.test(ts.username) && turnValid(TURN_SECRET, ts.username, ts.credential) && !turnValid('other', ts.username, ts.credential), '/turn: пароль = HMAC-SHA1(секрет, «срок:случайное») — coturn примет, с другим секретом — нет', ts);
  ok(Math.abs(+ts.username.split(':')[0] - (Date.now() / 1000 + 3600)) < 5 && !JSON.stringify(j).includes(TURN_SECRET), '/turn: срок — через час; самого секрета в ответе нет');
  ok(r.headers.get('access-control-allow-origin') === 'http://localhost:5571', '/turn: CORS для localhost');
  await fetch(S.url + '/turn'); await fetch(S.url + '/turn');
  r = await fetch(S.url + '/turn'); ok(r.status === 429, '/turn: чаще предела с одного адреса — 429');
  // hi + проба + ping
  const a = K.rawClient(D, S.ws), b = K.rawClient(D, S.ws);
  const hiA = await a.hi({ pb: 40000 }), hiB = await b.hi({});
  const pr = await a.wait(m => m.t === 'pr');
  ok(hiA && hiA.sid.length >= 20 && hiA.resumed === false && hiA.v === 1 && pr && pr.d.length === 40000, 'hi: свой сеанс (sid), проба 40 000 знаков', [hiA, pr && pr.d.length]);
  ok(!b.msgs.some(m => m.t === 'pr'), 'hi без pb — пробы нет');
  a.send({ t: 'ping', n: 77 });
  const pg = await a.wait(m => m.t === 'pong');
  ok(pg && pg.n === 77 && pg.q === 0, 'ping → pong (с номером последнего полученного q)', pg);
  // комната, presence в форме Supabase
  a.send({ t: 'j', i: 1, c: 'chess-duel-abcd', k: 'user-a', p: 1, q: 1 });
  const ja = await a.wait(m => m.t === 'j' && m.i === 1), psa = await a.wait(m => m.t === 'ps');
  ok(ja && ja.home === 'rt' && ja.r > 0 && ja.k === 'user-a' && psa && JSON.stringify(psa.s) === '{}', 'вход: home rt, номер комнаты, пустое состояние presence', [ja, psa]);
  a.send({ t: 'tr', i: 1, m: { nick: 'A', t: 1, _v: 1, phx_ref: 'x' }, r: 5, q: 2 });
  const pdA = await a.wait(m => m.t === 'pd'), okA = await a.wait(m => m.t === 'ok' && m.r === 5);
  const metaA = pdA?.j?.['user-a']?.metas?.[0];
  ok(okA && !okA.e && metaA && metaA.nick === 'A' && metaA.t === 1 && typeof metaA.phx_ref === 'string' && metaA.phx_ref !== 'x' && metaA._v === undefined && JSON.stringify(pdA.l) === '{}', 'track: подтверждение, diff joins {key: {metas: [{phx_ref, …}]}}; свой _v и phx_ref выбрасываются', pdA);
  b.send({ t: 'j', i: 9, c: 'chess-duel-abcd', k: 'user-b', p: 1 });
  const psb = await b.wait(m => m.t === 'ps');
  ok(psb && psb.s?.['user-a']?.metas?.[0]?.nick === 'A' && psb.s['user-a'].metas[0].phx_ref === metaA.phx_ref, 'второй входит — в состоянии первый (тот же phx_ref)', psb);
  b.send({ t: 'tr', i: 9, m: { nick: 'B', t: 2 }, r: 1 });
  await a.wait(m => m.t === 'pd' && m.j?.['user-b']);
  a.send({ t: 'tr', i: 1, m: { nick: 'A2', t: 1 }, r: 6, q: 3 });
  const upd = await b.wait(m => m.t === 'pd' && m.j?.['user-a']?.metas?.[0]?.nick === 'A2');
  ok(upd && upd.j['user-a'].metas[0].phx_ref_prev === metaA.phx_ref && upd.l['user-a']?.metas?.[0]?.phx_ref === metaA.phx_ref, 'повторный track — как у Supabase: joins (с phx_ref_prev) + leaves старого', upd);
  // broadcast
  b.send({ t: 'b', i: 9, e: 'm', p: { mv: 'e2e4', n: [1, 2, { x: null }] } });
  const bm = await a.wait(m => m.t === 'b');
  ok(bm && bm.r === ja.r && bm.e === 'm' && bm.p.mv === 'e2e4' && bm.p.n[2].x === null, 'broadcast дошёл с тем же содержимым', bm);
  await sleep(80);
  ok(!b.msgs.some(m => m.t === 'b'), 'self:false — себе не приходит');
  const c = K.rawClient(D, S.ws); await c.hi();
  c.send({ t: 'j', i: 1, c: 'chess-duel-abcd', k: 'user-c', p: 0, s: 1 });
  await c.wait(m => m.t === 'j');
  c.send({ t: 'b', i: 1, e: 'echo', p: 5 });
  ok(!!(await c.wait(m => m.t === 'b' && m.e === 'echo')) && !c.msgs.some(m => m.t === 'ps' || m.t === 'pd'), 'self:true — себе приходит; без presence (p:0) — ни состояния, ни diff');
  b.send({ t: 'ut', i: 9, r: 2 });
  const ut = await a.wait(m => m.t === 'pd' && m.l?.['user-b']);
  ok(ut && JSON.stringify(ut.j) === '{}', 'untrack → leaves');
  b.send({ t: 'l', i: 9 });
  c.close(); await c.closed;
  // ошибки входа
  a.send({ t: 'j', i: 2, c: 'bad name!' }); a.send({ t: 'j', i: 3, c: 'x', k: '__proto__' }); a.send({ t: 'j', i: 4, c: 'chess-duel-abcd' });
  const e2 = await a.wait(m => m.t === 'j' && m.i === 2), e3 = await a.wait(m => m.t === 'j' && m.i === 3), e4 = await a.wait(m => m.t === 'j' && m.i === 4);
  ok(e2?.e === 'name' && e3?.e === 'key' && e4?.e === 'dup', 'неверное имя / ключ «__proto__» / та же комната дважды — отказ', [e2, e3, e4]);
  for (let i = 10; i < 16; i++) a.send({ t: 'j', i, c: 'room-' + i });
  const lim = await a.wait(m => m.t === 'j' && m.e === 'limit');
  ok(!!lim, 'каналов на соединение больше предела (5) — limit');
  // размер meta, частота track
  a.send({ t: 'tr', i: 10, m: { big: 'x'.repeat(600) }, r: 40 });
  const big = await a.wait(m => m.t === 'ok' && m.r === 40);
  ok(big?.e === 'big', 'meta больше MAX_META — отказ', big);
  for (let k = 0; k < 4; k++) a.send({ t: 'tr', i: 11, m: { k }, r: 50 + k });
  const rate = await a.wait(m => m.t === 'ok' && m.e === 'rate');
  ok(!!rate, 'track чаще предела — rate (а не обрыв канала, как у Supabase)');
  // предел комнаты
  const subs = [];
  for (let k = 0; k < 3; k++) { const x = K.rawClient(D, S.ws, { xff: '198.51.100.' + (10 + k) }); await x.hi(); x.send({ t: 'j', i: 1, c: 'room-full' }); subs.push(x); }
  for (const x of subs) await x.wait(m => m.t === 'j');
  const y = K.rawClient(D, S.ws, { xff: '198.51.100.30' }); await y.hi();
  y.send({ t: 'j', i: 1, c: 'room-full' });
  const z = K.rawClient(D, S.ws, { xff: '198.51.100.31' }); await z.hi();
  z.send({ t: 'j', i: 1, c: 'room-full' });
  const zf = await z.wait(m => m.t === 'j');
  ok(zf?.e === 'full', 'в комнате больше MAX_ROOM_SUBS — full', zf);
  for (const x of [...subs, y, z]) x.close();
  // адреса: 3 соединения с одного (Caddy передал адрес в X-Forwarded-For), 4-е — 429; с другого — можно
  const same = [];
  for (let k = 0; k < 3; k++) { const x = K.rawClient(D, S.ws, { xff: '203.0.113.50' }); await x.open; same.push(x); }
  const extra = K.rawClient(D, S.ws, { xff: '203.0.113.50' });
  let err = ''; try { await extra.open; } catch (e) { err = e.message; }
  const other = K.rawClient(D, S.ws, { xff: '203.0.113.51' });
  let ok2 = true; try { await other.open; } catch (e) { ok2 = false; }
  ok(err === 'HTTP 429' && ok2, 'больше MAX_PER_IP с одного адреса — 429, с другого — можно', err);
  for (const x of [...same, other]) x.close();
  // Origin
  const evil = K.rawClient(D, S.ws, { origin: 'https://evil.example' });
  err = ''; try { await evil.open; } catch (e) { err = e.message; }
  ok(err === 'HTTP 403', 'чужой Origin — 403', err);
  for (const o of ['https://dan4ik37.vercel.app', 'https://dan4ik37.github.io', 'http://127.0.0.1:8080', 'https://localhost']) {
    const x = K.rawClient(D, S.ws, { origin: o, xff: '192.0.2.' + (1 + o.length) });
    let good = true; try { await x.open; } catch (e) { good = false; }
    ok(good, 'Origin сайта и localhost — можно: ' + o); x.close();
  }
  // «молчун», мусор, поток, размер
  const q1 = K.rawClient(D, S.ws, { xff: '192.0.2.200' }); await q1.open;
  ok((await Promise.race([q1.closed, sleep(1500).then(() => -1)])) === 4001, 'нет hi за HELLO_MS — закрыт (4001)', q1.code);
  const g = K.rawClient(D, S.ws, { xff: '192.0.2.201' }); await g.hi();
  for (let k = 0; k < 60; k++) g.send('{oops' + k);
  ok((await Promise.race([g.closed, sleep(1500).then(() => -1)])) === 4009, 'мусор (> 50 неразборчивых) — закрыт 4009', g.code);
  const f = K.rawClient(D, S.ws, { xff: '192.0.2.202' }); await f.hi();
  f.send({ t: 'j', i: 1, c: 'flood' });
  for (let k = 0; k < 400; k++) f.send({ t: 'b', i: 1, e: 'm', p: k });
  ok((await Promise.race([f.closed, sleep(2000).then(() => -1)])) === 4008, 'поток сообщений сверх предела — закрыт 4008', f.code);
  const h2 = K.rawClient(D, S.ws, { xff: '192.0.2.203' }); await h2.hi();
  h2.send({ t: 'b', i: 1, e: 'm', p: 'x'.repeat(70000) });
  ok((await Promise.race([h2.closed, sleep(1500).then(() => -1)])) === 1009, 'сообщение больше MAX_MSG — закрыт (1009)', h2.code);
  // 3. мусор: тысяча случайных кадров от многих соединений — сервер живёт, внутренних ошибок нет
  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const vals = () => pick([null, true, 0, -1, 1e308, NaN, 'x', '', '__proto__', [], {}, [1, [2, [3]]], { __proto__: { a: 1 } }, 'é'.repeat(5), { t: 'b' }]);
  const fz = [];
  for (let k = 0; k < 12; k++) { const x = K.rawClient(D, S.ws, { xff: '100.64.' + k + '.1', keep: false }); fz.push(x); }
  for (const x of fz) { try { await x.open; } catch (e) {} if (Math.random() < .8) x.send({ t: 'hi', v: 1, sid: pick([undefined, 'short', 'x'.repeat(40), 5]) }); }
  for (let k = 0; k < 1500; k++) {
    const x = pick(fz);
    if (x.ws.readyState !== 1) continue;
    const kind = rnd(6);
    if (kind === 0) x.send(crypto.randomBytes(rnd(64)).toString('latin1'));
    else if (kind === 1) { try { x.ws.send(crypto.randomBytes(rnd(64) + 1)); } catch (e) {} }
    else if (kind === 2) x.send(JSON.stringify(vals()));
    else {
      const o = { t: pick(['hi', 'j', 'l', 'b', 'tr', 'ut', 'ping', 'auth', 'zz', 7]) };
      for (const fkey of ['i', 'c', 'k', 'p', 's', 'e', 'm', 'r', 'q', 'jwt', 'n', 'pb']) if (Math.random() < .5) o[fkey] = fkey === 'c' ? pick(['r1', 'r2', 'r2-r', 'r3', '', 'a'.repeat(200), 5]) : fkey === 'i' ? pick([1, 2, 3, -1, 0, 1.5, 1e10, '1']) : vals();
      x.send(JSON.stringify(o).replace('"__proto__x"', '"__proto__"'));
    }
  }
  await sleep(500);
  for (const x of fz) x.kill();
  j = await S.metrics(ADMIN);
  const h3 = await (await fetch(S.url + '/health')).json();
  ok(!S.exited && h3.ok === true && j.stats.internal === 0 && j.stats.malformed > 100, 'мусор: сервер жив, внутренних ошибок 0, мусор посчитан', { internal: j.stats.internal, malformed: j.stats.malformed, kicked: j.stats.kicked, rss: j.mem.rssMb });
  // журнал: ни адресов, ни токенов
  a.close(); b.close();
  await sleep(150);
  const logs = S.log();
  ok(!/198\.51\.100|203\.0\.113\.5|192\.0\.2\.|100\.64\.|127\.0\.0\.1/.test(logs.replace(/"port":\d+/g, '')) && !logs.includes(ADMIN) && !logs.includes(TURN_SECRET), 'журнал сервера: ни адресов клиентов, ни ключей', logs.slice(-400));
  await S.kill();
  // обслуживание и предел соединений
  const M = await K.startServer(D, { MAINTENANCE: '1' });
  cleanup.push(() => M.kill());
  j = await (await fetch(M.url + '/health')).json();
  const mm = K.rawClient(D, M.ws); err = ''; try { await mm.open; } catch (e) { err = e.message; }
  ok(j.ok === false && err === 'HTTP 503', 'MAINTENANCE=1: /health ok:false, сокеты — 503 (сайт идёт через Supabase)', [j, err]);
  await M.kill();
  const L = await K.startServer(D, { MAX_CONNS: '2', MAX_PER_IP: '10' });
  cleanup.push(() => L.kill());
  const l1 = K.rawClient(D, L.ws), l2 = K.rawClient(D, L.ws); await l1.hi(); await l2.hi();
  const l3 = K.rawClient(D, L.ws); err = ''; try { await l3.open; } catch (e) { err = e.message; }
  ok(err === 'HTTP 503', 'больше MAX_CONNS — 503', err);
  l1.close(); l2.close(); await L.kill();
  const noOrig = await K.startServer(D, { ALLOW_NO_ORIGIN: '0' });
  cleanup.push(() => noOrig.kill());
  const no = K.rawClient(D, noOrig.ws, { origin: '' }); err = ''; try { await no.open; } catch (e) { err = e.message; }
  ok(err === 'HTTP 403', 'без Origin (не браузер) в бою — 403', err);
  await noOrig.kill();
}

// ═══ 4. Переподключение с тем же сеансом ═══
async function resume(){
  const S = await K.startServer(D, { ADMIN_TOKEN: ADMIN, GRACE_MS: '1200', ROOM_GC_MS: '0' });
  cleanup.push(() => S.kill());
  const a = K.rawClient(D, S.ws), b = K.rawClient(D, S.ws);
  const hiA = await a.hi(); await b.hi();
  a.send({ t: 'j', i: 1, c: 'r-res', k: 'ka', p: 1, q: 1 }); b.send({ t: 'j', i: 1, c: 'r-res', k: 'kb', p: 1 });
  await a.wait(m => m.t === 'ps'); await b.wait(m => m.t === 'ps');
  a.send({ t: 'tr', i: 1, m: { n: 'A' }, r: 1, q: 2 });
  await b.wait(m => m.t === 'pd' && m.j?.ka);
  a.kill();   // обрыв без «до свидания» (как у телефона в лифте)
  await sleep(150);
  b.send({ t: 'b', i: 1, e: 'm', p: { gap: 1 } });
  b.send({ t: 'b', i: 1, e: 'm', p: { gap: 2 } });
  await sleep(150);
  ok(!b.msgs.some(m => m.t === 'pd' && m.l?.ka), 'обрыв: другому — ни «ушёл», ни «пришёл» (место держится GRACE_MS)');
  const a2 = K.rawClient(D, S.ws);
  const hi2 = await a2.hi({ sid: hiA.sid, pb: 20000 });
  ok(hi2 && hi2.resumed === true && hi2.sid === hiA.sid && hi2.q === 2, 'тот же sid — сеанс продолжен (resumed), сервер знает номер последнего полученного (q = 2)', hi2);
  const g1 = await a2.wait(m => m.t === 'b' && m.p?.gap === 1), g2 = await a2.wait(m => m.t === 'b' && m.p?.gap === 2);
  ok(!!(g1 && g2) && a2.msgs.findIndex(m => m.t === 'pr') < a2.msgs.findIndex(m => m.t === 'b'), 'пропущенное за обрыв дослано (после пробы)');
  a2.send({ t: 'b', i: 1, e: 'm', p: { re: 1 }, q: 2 });   // повтор старого номера — не выполняется
  a2.send({ t: 'b', i: 1, e: 'm', p: { re: 2 }, q: 3 });
  await b.wait(m => m.t === 'b' && m.p?.re === 2);
  ok(!b.msgs.some(m => m.t === 'b' && m.p?.re === 1), 'повтор уже полученного номера (q) не выполняется дважды');
  let j = await S.metrics(ADMIN);
  ok(j.stats.resumes === 1 && j.stats.dupes === 1 && j.counts.zombies === 0 && j.counts.zombieKb === 0, 'счётчики: 1 продолжение, 1 повтор отброшен', [j.stats.resumes, j.stats.dupes, j.counts]);
  a2.kill();
  await sleep(1500);
  ok(!!b.msgs.find(m => m.t === 'pd' && m.l?.ka), 'не вернулся за GRACE_MS — другим «ушёл»');
  const a3 = K.rawClient(D, S.ws);
  const hi3 = await a3.hi({ sid: hiA.sid });
  ok(hi3 && hi3.resumed === false && hi3.sid !== hiA.sid, 'поздно — новый сеанс (resumed: false)');
  a3.close(); b.close();
  await sleep(100);
  j = await S.metrics(ADMIN);
  ok(j.counts.rooms === 0 && j.counts.members === 0 && j.counts.presence === 0, 'после ухода — 0 комнат, мест, presence', j.counts);
  // чистый уход (1000) — место отпускается сразу
  const c1 = K.rawClient(D, S.ws), c2 = K.rawClient(D, S.ws); await c1.hi(); await c2.hi();
  c1.send({ t: 'j', i: 1, c: 'r-clean', k: 'k1', p: 1 }); c2.send({ t: 'j', i: 1, c: 'r-clean', k: 'k2', p: 1 });
  await c1.wait(m => m.t === 'ps'); await c2.wait(m => m.t === 'ps');
  c1.send({ t: 'tr', i: 1, m: { a: 1 }, r: 1 }); await c2.wait(m => m.t === 'pd' && m.j?.k1);
  c1.close();
  ok(!!(await c2.wait(m => m.t === 'pd' && m.l?.k1, 600)), 'закрыл вкладку (1000/1001) — другим «ушёл» сразу, без ожидания');
  c2.close();
  await S.kill();
}

// ═══ 4б. Медленный читатель (телефон «застрял»): серверу не копит память — сверх SLOW_DROP ему не шлёт, остальным доставка идёт ═══
async function slowReader(){
  const S = await K.startServer(D, { ADMIN_TOKEN: ADMIN, BYTE_BURST: String(64 * 1024 * 1024), BYTE_PER_SEC: String(64 * 1024 * 1024), MSG_BURST: '5000', MSG_PER_SEC: '5000', ROOM_GC_MS: '0' });
  cleanup.push(() => S.kill());
  const a = K.rawClient(D, S.ws, { keep: false }), slow = K.rawClient(D, S.ws, { keep: false }), c = K.rawClient(D, S.ws, { keep: false });
  for (const x of [a, slow, c]) { await x.hi(); x.send({ t: 'j', i: 1, c: 'slow-room' }); }
  await sleep(200);
  slow.ws._socket.pause();   // не читает (как зависшая вкладка)
  const m0 = await S.metrics(ADMIN);
  const big = 'x'.repeat(60000);
  for (let k = 0; k < 150; k++) { a.send({ t: 'b', i: 1, e: 'm', p: { k, big } }); if (k % 10 === 9) await sleep(15); }   // 9 МБ за ~0,3 с
  await until(() => c.n >= 150, 8000);
  const m1 = await S.metrics(ADMIN);
  ok(c.n >= 150, 'медленный читатель: остальным всё доставлено', c.n);
  ok(m1.stats.drop.slow > 0 && m1.mem.rssMb - m0.mem.rssMb < 40, `медленный читатель: ему не шлём сверх предела (${m1.stats.drop.slow} пропущено), память сервера +${m1.mem.rssMb - m0.mem.rssMb} МБ (не 9 МБ × N)`, [m0.mem, m1.mem, m1.stats.drop]);
  slow.ws._socket.resume();
  for (const x of [a, slow, c]) x.kill();
  await S.kill();
}

// ═══ 5. Вход: JWT (ES256, открытые ключи JWKS) ═══
async function jwt(){
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }); jwk.kid = 'test-kid'; jwk.alg = 'ES256'; jwk.use = 'sig';
  const js = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(r => js.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise(r => js.close(() => r())));
  const SB = 'https://proj.supabase.co';
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (p, o = {}) => { const h = b64({ alg: 'ES256', kid: o.kid || 'test-kid', typ: 'JWT' }), pl = b64(p); const sig = crypto.sign('sha256', Buffer.from(h + '.' + pl), { key: o.key || privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'); return h + '.' + pl + '.' + sig; };
  const uid = crypto.randomUUID();
  const good = sign({ sub: uid, aud: 'authenticated', role: 'authenticated', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 });
  const S = await K.startServer(D, { SB_URL: SB, JWKS_URL: 'http://127.0.0.1:' + js.address().port + '/jwks', AUTH_BURST: '20' });
  cleanup.push(() => S.kill());
  const a = K.rawClient(D, S.ws), b = K.rawClient(D, S.ws);
  await a.hi(); await b.hi();
  const auth = async (c, tok) => { c.send({ t: 'auth', jwt: tok }); const m = await c.wait(x => x.t === 'auth' && !x.seen); if (m) m.seen = true; return m; };
  const r1 = await auth(a, good);
  ok(r1 && r1.ok === true, 'JWT, подписанный ключом из JWKS (ES256) — принят', r1);
  const { privateKey: other } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const bad = [
    ['чужая подпись', sign({ sub: uid, aud: 'authenticated', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 }, { key: other })],
    ['просрочен', sign({ sub: uid, aud: 'authenticated', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) - 120 })],
    ['чужой проект (iss)', sign({ sub: uid, aud: 'authenticated', iss: 'https://evil.supabase.co/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 })],
    ['не тот ключ (kid)', sign({ sub: uid, aud: 'authenticated', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 }, { kid: 'nope' })],
    ['anon (aud)', sign({ sub: uid, aud: 'anon', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 })],
    ['подделан payload', good.split('.').map((x, i) => (i === 1 ? b64({ sub: crypto.randomUUID(), aud: 'authenticated', iss: SB + '/auth/v1', exp: Math.floor(Date.now() / 1000) + 600 }) : x)).join('.')],
    ['мусор', 'a.b.c'],
  ];
  for (const [name, tok] of bad) { const r = await auth(b, tok); ok(r && r.ok === false, 'JWT отвергнут: ' + name, r); }
  b.send({ t: 'j', i: 1, c: 'r-jwt', k: 'g-guest', p: 1 }); await b.wait(m => m.t === 'ps');
  a.send({ t: 'j', i: 1, c: 'r-jwt', k: uid, p: 1 }); await a.wait(m => m.t === 'ps');
  a.send({ t: 'tr', i: 1, m: { nick: 'Я', _v: 0 } });
  const d1 = await b.wait(m => m.t === 'pd' && m.j?.[uid]);
  ok(d1 && d1.j[uid].metas[0]._v === 1, 'presence с ключом = id проверенного аккаунта — _v: 1 (подделать нельзя: свой _v выбрасывается)', d1);
  b.send({ t: 'tr', i: 1, m: { nick: 'гость', _v: 1 } });
  const d2 = await a.wait(m => m.t === 'pd' && m.j?.['g-guest']);
  ok(d2 && d2.j['g-guest'].metas[0]._v === undefined, 'гость (или ключ не своего аккаунта) — без _v, даже если прислал свой', d2);
  // вход позже track — метка появляется сама (diff всем)
  const c = K.rawClient(D, S.ws); await c.hi();
  c.send({ t: 'j', i: 1, c: 'r-jwt', k: uid, p: 1 }); await c.wait(m => m.t === 'ps');
  c.send({ t: 'tr', i: 1, m: { nick: 'вторая вкладка' } });
  await b.wait(m => m.t === 'pd' && m.j?.[uid]?.metas?.[0]?.nick === 'вторая вкладка');
  await auth(c, good);
  const d3 = await b.wait(m => m.t === 'pd' && m.j?.[uid]?.metas?.[0]?.nick === 'вторая вкладка' && m.j[uid].metas[0]._v === 1);
  ok(!!d3, 'вошёл после track — presence получает _v: 1 сама (одним обновлением)');
  for (const x of [a, b, c]) x.close();
  await S.kill();
}

// ═══ 6. Сторож Supabase (на подменном Supabase) ═══
async function watcher(P){
  const S = await K.startServer(D, { ADMIN_TOKEN: ADMIN, WATCH: '1', SB_WS: P.ws, PEEK_MS: '800', ROOM_GC_MS: '0' });
  cleanup.push(() => S.kill());
  ok(!!(await until(async () => (await (await fetch(S.url + '/health')).json()).rooms === true, 3000)), 'сторож подключился к Supabase — /health rooms: true');
  // человек «в Supabase» (подменный клиент Phoenix)
  const phx = (topic, key, meta) => new Promise(res => {
    const ws = new D.WS(P.ws + '?apikey=k&vsn=1.0.0');
    ws.on('open', () => {
      ws.send(JSON.stringify({ topic: 'realtime:' + topic, event: 'phx_join', payload: { config: { presence: { key, enabled: true } } }, ref: '1', join_ref: '1' }));
      if (meta) ws.send(JSON.stringify({ topic: 'realtime:' + topic, event: 'presence', payload: { type: 'presence', event: 'track', payload: meta }, ref: '2', join_ref: '1' }));
      setTimeout(() => res(ws), 150);
    });
    ws.on('error', () => {});
  });
  const a = K.rawClient(D, S.ws), b = K.rawClient(D, S.ws);
  await a.hi(); await b.hi();
  a.send({ t: 'j', i: 1, c: 'w-room', k: 'ka', p: 1 });
  const ja = await a.wait(m => m.t === 'j', 3000);
  ok(ja && ja.home === 'rt', 'новая комната, в Supabase пусто — у нас (rt)', ja);
  a.send({ t: 'j', i: 2, c: 'w-room-r', p: 0 });
  b.send({ t: 'j', i: 1, c: 'w-room', k: 'kb', p: 1 });
  await b.wait(m => m.t === 'j'); await a.wait(m => m.t === 'j' && m.i === 2);
  const joinsBefore = P.stats.joins;
  const out = await phx('w-room', 'kx', { nick: 'из Supabase' });
  const mvA = await a.wait(m => m.t === 'mv', 3000), mvB = await b.wait(m => m.t === 'mv', 3000);
  const mvR = await a.wait(m => m.t === 'mv' && m.r !== ja.r, 1500);
  ok(!!(mvA && mvB && mvR), 'кто-то появился в Supabase-канале комнаты — всем у нас «mv» (и соседнему «-r»)', [!!mvA, !!mvB, !!mvR]);
  a.send({ t: 'j', i: 3, c: 'w-room', k: 'ka', p: 1 });
  a.send({ t: 'j', i: 4, c: 'w-room-r', p: 0 });
  const j3 = await a.wait(m => m.t === 'j' && m.i === 3), j4 = await a.wait(m => m.t === 'j' && m.i === 4);
  ok(j3?.home === 'sb' && j4?.home === 'sb', 'после переезда новички (и «-r») сразу получают «sb»', [j3, j4]);
  // комната, где в Supabase уже кто-то есть, — сразу «sb»
  const there = await phx('w-two', 'ky', { nick: 'уже там' });
  a.send({ t: 'j', i: 5, c: 'w-two', k: 'ka', p: 1 });
  const j5 = await a.wait(m => m.t === 'j' && m.i === 5, 3000);
  ok(j5?.home === 'sb', 'в Supabase уже кто-то есть — новая комната остаётся там (sb), раздела нет', j5);
  // сторож переподключается
  P.dropAll();
  await sleep(100);
  a.send({ t: 'j', i: 6, c: 'w-three', k: 'ka', p: 1 });
  const j6 = await a.wait(m => m.t === 'j' && m.i === 6, 4000);
  ok(j6?.home === 'rt', 'сторож потерял Supabase на миг — комната создаётся (rt), проверка — когда вернётся', j6);
  ok(!!(await until(() => P.topics().includes('realtime:w-three'), 6000)), 'сторож переподключился и снова смотрит канал комнаты');
  const late = await phx('w-three', 'kz', { nick: 'поздно' });
  ok(!!(await a.wait(m => m.t === 'mv', 4000)), 'и после переподключения: появился в Supabase — комната переезжает');
  const j = await S.metrics(ADMIN);
  ok(j.watcher && j.watcher.connects >= 2 && j.stats.moves >= 3, 'метрики сторожа: переподключения, переезды', [j.watcher, j.stats.moves]);
  for (const w of [out, there, late]) w.close();
  a.close(); b.close();
  await S.kill();
  return joinsBefore;
}

// ═══ 7а. Алгоритм presence D37RT = Presence из @supabase/phoenix (то, что внутри supabase-js) на случайных последовательностях ═══
function presenceAlgo(){
  let Phx = null;
  try { Phx = require(path.join(D.nm, '@supabase', 'phoenix')).Presence; } catch (e) {}
  if (!Phx) { console.log('  (нет @supabase/phoenix — сравнение алгоритма presence пропущено)'); return; }
  const T = makeTab({ rtUrl: '', sbUrl: 'http://127.0.0.1:9' });
  const { syncState, syncDiff } = T.RT._test;
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let refN = 0, bad = 0, ops = 0;
  for (let run = 0; run < 40; run++) {
    let A = {}, B = {};
    const live = [];   // [key, ref]
    for (let step = 0; step < 60; step++) {
      const evA = [], evB = [];
      const recA = (t, l) => (k, c, p) => l.push([t, k, c ? JSON.parse(JSON.stringify(c)) : null, JSON.parse(JSON.stringify(p))]);
      if (rnd(10) === 0) {   // полное состояние (presence_state): часть живых + новые
        const st = {};
        for (const [k, r] of live) if (rnd(3)) (st[k] || (st[k] = { metas: [] })).metas.push({ phx_ref: r, v: rnd(5) });
        for (let i = rnd(3); i > 0; i--) { const k = 'k' + rnd(5), r = 'R' + (++refN); (st[k] || (st[k] = { metas: [] })).metas.push({ phx_ref: r, v: rnd(5) }); }
        live.length = 0; for (const k of Object.keys(st)) for (const m of st[k].metas) live.push([k, m.phx_ref]);
        A = Phx.syncState(A, JSON.parse(JSON.stringify(st)), recA('j', evA), recA('l', evA));
        B = syncState(B, JSON.parse(JSON.stringify(st)), recA('j', evB), recA('l', evB));
      } else {
        const joins = {}, leaves = {};
        for (let i = rnd(3); i > 0; i--) {
          const k = 'k' + rnd(5), r = 'R' + (++refN);
          const upd = live.find(x => x[0] === k && rnd(2));
          (joins[k] || (joins[k] = { metas: [] })).metas.push(upd ? { phx_ref: r, phx_ref_prev: upd[1], v: rnd(5) } : { phx_ref: r, v: rnd(5) });
          if (upd) { (leaves[k] || (leaves[k] = { metas: [] })).metas.push({ phx_ref: upd[1], v: 0 }); live.splice(live.indexOf(upd), 1); }
          live.push([k, r]);
        }
        for (let i = rnd(2); i > 0 && live.length; i--) { const x = live.splice(rnd(live.length), 1)[0]; (leaves[x[0]] || (leaves[x[0]] = { metas: [] })).metas.push({ phx_ref: x[1], v: 0 }); }
        if (rnd(8) === 0) (leaves['k' + rnd(5)] || (leaves['k' + rnd(5)] = { metas: [] })).metas.push({ phx_ref: 'nope' + refN });   // уход несуществующего
        A = Phx.syncDiff(A, JSON.parse(JSON.stringify({ joins, leaves })), recA('j', evA), recA('l', evA));
        B = syncDiff(B, JSON.parse(JSON.stringify({ joins, leaves })), recA('j', evB), recA('l', evB));
      }
      ops++;
      if (JSON.stringify(A) !== JSON.stringify(B) || JSON.stringify(evA) !== JSON.stringify(evB)) { if (bad++ < 2) console.log('  presence расходится', JSON.stringify({ A, B, evA, evB }).slice(0, 600)); }
    }
  }
  ok(!bad && ops === 2400, `алгоритм presence D37RT = Phoenix Presence (supabase-js): ${ops} случайных шагов (состояния, приходы, обновления, уходы), расхождений ${bad}`);
}

// ═══ 7. Формы presence: D37RT (свой сервер) = supabase-js (Supabase) ═══
async function shapes(P){
  const S = await K.startServer(D, { ROOM_GC_MS: '0' });
  cleanup.push(() => S.kill());
  async function run(useRt){
    const A = makeTab({ rtUrl: useRt ? S.url : '', sbUrl: P.url }), B = makeTab({ rtUrl: useRt ? S.url : '', sbUrl: P.url });
    const cl = T => (useRt ? T.RT : T.ctx.sbClient);
    const room = 'shape-' + (useRt ? 'rt' : 'sb');
    const log = [], snaps = [];
    const norm = x => JSON.parse(JSON.stringify(x, (k, v) => (k === 'presence_ref' ? 'R' : v)));
    const a = cl(A).channel(room, { config: { broadcast: { self: false }, presence: { key: 'ka' } } });
    a.on('presence', { event: '*' }, p => log.push(norm(p)));
    a.on('broadcast', { event: 'm' }, p => log.push(norm(p)));
    const st = [];
    a.subscribe(s => st.push(s));
    await until(() => st.includes('SUBSCRIBED'), 4000);
    await a.track({ nick: 'A', t: 1 });
    await sleep(250); snaps.push(norm(a.presenceState()));
    const b = cl(B).channel(room, { config: { broadcast: { self: false }, presence: { key: 'kb' } } });
    b.on('presence', { event: 'sync' }, () => {});
    let bs = false; b.subscribe(s => { if (s === 'SUBSCRIBED') bs = true; });
    await until(() => bs, 4000);
    await b.track({ nick: 'B', t: 2 });
    await sleep(250); snaps.push(norm(a.presenceState()));
    await a.track({ nick: 'A2', t: 1 });
    await sleep(250); snaps.push(norm(a.presenceState()));
    b.send({ type: 'broadcast', event: 'm', payload: { hello: [1, 'два', { три: 3 }] } });
    await sleep(200);
    await b.untrack();
    await sleep(250); snaps.push(norm(a.presenceState()));
    await b.track({ nick: 'B3', t: 3 });
    await sleep(250); snaps.push(norm(a.presenceState()));
    await cl(B).removeChannel(b);
    await sleep(300); snaps.push(norm(a.presenceState()));
    await cl(A).removeChannel(a);
    await sleep(100);
    const out = { log, snaps, st };
    await A.close(); await B.close();
    return out;
  }
  const sbRun = await run(false), rtRun = await run(true);
  ok(sbRun.log.length >= 10, 'эталон supabase-js: события presence записаны', sbRun.log.length);
  ok(JSON.stringify(rtRun.snaps) === JSON.stringify(sbRun.snaps), 'presenceState() через свой сервер — как у supabase-js на каждом шаге', { rt: rtRun.snaps, sb: sbRun.snaps });
  ok(JSON.stringify(rtRun.log) === JSON.stringify(sbRun.log), 'события presence (join/leave/sync — с currentPresences/newPresences/leftPresences) и broadcast — как у supabase-js', { rt: rtRun.log, sb: sbRun.log });
  ok(rtRun.st[0] === 'SUBSCRIBED' && rtRun.st.at(-1) === 'CLOSED' && sbRun.st.at(-1) === 'CLOSED', 'статусы subscribe: SUBSCRIBED … CLOSED, как у supabase-js', [rtRun.st, sbRun.st]);
  await S.kill();
}

// ═══ 8. room.js через D37RT: переезд, сервер упал, обрыв, «16 КБ», выключено ═══
function duel(T, code, tag){
  const ev = [];
  const room = T.GR.join('chess', code, {
    onPeer: p => ev.push(['peer', p ? p.id : null]),
    onMessage: m => ev.push(['msg', m.x]),
    onError: () => ev.push(['err']),
    onFull: () => ev.push(['full']),
  });
  return { room, ev, tag, msgs: () => ev.filter(e => e[0] === 'msg').map(e => e[1]), peers: () => ev.filter(e => e[0] === 'peer').map(e => e[1]) };
}
async function rooms(P){
  const port = await K.freePort();
  const env = { ADMIN_TOKEN: ADMIN, WATCH: '1', SB_WS: P.ws, PEEK_MS: '800', GRACE_MS: '3000', ROOM_GC_MS: '0', RT_PORT: String(port), TURN_SECRET, TURN_HOST: '203.0.113.7', MAX_PER_IP: '200', IP_BURST: '200' };
  let S = await K.startServer(D, env);
  cleanup.push(() => S.kill());
  // 8a. вдвоём через свой сервер
  const A = makeTab({ rtUrl: S.url, sbUrl: P.url }), B = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const da = duel(A, 'rt1abc', 'A');
  await until(() => da.ev.length > 0, 5000);
  const db = duel(B, 'rt1abc', 'B');
  ok(!!(await until(() => da.room.opp && db.room.opp, 6000)), 'room.js: двое в комнате через свой сервер видят друг друга');
  ok(viaAll(A, 'rt') && viaAll(B, 'rt') && A.RT.stats().st === 'up' && A.RT.stats().probeMs > 0, 'обе вкладки — через свой сервер (проба прошла)', [A.RT.stats(), B.RT.stats().chans]);
  db.room.send({ x: 1 }); da.room.send({ x: 2 });
  ok(!!(await until(() => da.msgs().includes(1) && db.msgs().includes(2), 3000)), 'ходы ходят в обе стороны');
  ok(P.keys('chess-duel-rt1abc').length === 0, 'в Supabase этой комнаты нет (всё через свой сервер)');
  // 8b. обрыв связи (сеть мигнула) — тот же сеанс, ничего не потерялось
  // (через «прокси провайдера»: вкладка C подключена через него)
  const PX = proxy(port); await PX.ready;
  const C = makeTab({ rtUrl: PX.url, sbUrl: P.url });
  const dc = duel(C, 'rt2abc', 'C');
  await until(() => dc.ev.length > 0, 5000);
  const B2 = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const db2 = duel(B2, 'rt2abc', 'B2');
  ok(!!(await until(() => dc.room.opp && db2.room.opp, 6000)), 'обрыв: двое в комнате (один — через «провайдера»)');
  const peersBefore = [dc.peers().length, db2.peers().length];
  PX.cut();
  await sleep(120);
  db2.room.send({ x: 'пока не было связи' });
  dc.room.send({ x: 'я тоже писал' });
  ok(!!(await until(() => dc.msgs().includes('пока не было связи') && db2.msgs().includes('я тоже писал'), 5000)), 'обрыв: после переподключения сообщения дошли в обе стороны');
  ok(C.RT.stats().resumes >= 1 && viaAll(C, 'rt'), 'обрыв: сеанс продолжен (resumed), комната — по-прежнему через свой сервер', C.RT.stats());
  ok(dc.peers().length === peersBefore[0] && db2.peers().length === peersBefore[1] && !dc.ev.some(e => e[0] === 'err'), 'обрыв: игра не заметила (ни «соперник ушёл», ни ошибок)', [dc.ev, db2.ev]);
  // 8c. «16 КБ и стоп» (провайдер режет связь к зарубежному хостингу): проба не проходит — весь сеанс через Supabase
  const TH = proxy(port, { cutAfter: 16384 }); await TH.ready;
  const E = makeTab({ rtUrl: TH.url, sbUrl: P.url });
  const de = duel(E, 'rt3abc', 'E');
  ok(!!(await until(() => E.RT.stats().badWhy === 'stall' && viaAll(E, 'sb'), 6000)), '«16 КБ»: проба 40 КБ не дошла — плохая связь (stall), комната через Supabase', E.RT.stats());
  const F = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const df = duel(F, 'rt3abc', 'F');
  ok(!!(await until(() => de.room.opp && df.room.opp && viaAll(F, 'sb'), 8000)), '«16 КБ»: второй (с хорошей связью) тоже оказался в Supabase — комната не разделилась', F.RT.stats());
  df.room.send({ x: 'f' }); de.room.send({ x: 'e' });
  ok(!!(await until(() => de.msgs().includes('f') && df.msgs().includes('e'), 4000)), '«16 КБ»: играют через Supabase');
  ok(E.ctx.sessionStorage.getItem('d37_rt')?.includes('stall'), '«16 КБ»: вкладка помнит до конца срока (sessionStorage), пробу не повторяет');
  // 8c'. связь режут ПОСЛЕ пробы (поздние ~45 КБ на соединение): сокет «висит» → переподключение → снова висит → весь сеанс
  //      через Supabase (две «смерти» по сердцебиению за 3 мин), комната переезжает целиком
  const TL = proxy(port, { cutAfter: 45000 }); await TL.ready;
  const L1 = makeTab({ rtUrl: TL.url, sbUrl: P.url }), L2 = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const dl1 = duel(L1, 'rt7abc', 'L1');
  await until(() => dl1.ev.length > 0 && viaAll(L1, 'rt'), 5000);
  const dl2 = duel(L2, 'rt7abc', 'L2');
  await until(() => dl1.room.opp && dl2.room.opp, 6000);
  const chat = setInterval(() => { dl2.room.send({ x: 'болтовня ' + 'x'.repeat(300) }); }, 40);
  ok(!!(await until(() => L1.RT.stats().badWhy === 'stall' && viaAll(L1, 'sb') && viaAll(L2, 'sb'), 15000)), 'поздний обрыв «по объёму»: два зависания подряд — плохая связь (stall), комната целиком в Supabase', [L1.RT.stats(), L2.RT.stats().chans]);
  clearInterval(chat);
  const before = dl1.msgs().length;
  dl2.room.send({ x: 'дошло?' });
  ok(!!(await until(() => dl1.msgs().includes('дошло?'), 4000)) && dl1.msgs().length > before, 'поздний обрыв: после переезда сообщения доходят');
  dl1.room.leave(); dl2.room.leave();
  // 8c''. медленная связь: проба дольше WAIT_MS — эта комната сразу через Supabase (игра по ссылке не ждёт), проба идёт дальше;
  //       следующая комната — уже через свой сервер
  const SL = proxy(port, { delay: 3500 }); await SL.ready;
  const W1 = makeTab({ rtUrl: SL.url, sbUrl: P.url, timing: { WAIT_MS: 1500, PROBE_MS: 12000, HEALTH_MS: 9000 } });
  const dw = duel(W1, 'rt8abc', 'W1');
  ok(!!(await until(() => viaAll(W1, 'sb') && W1.RT.stats().slowProbe === 1, 4000)), 'медленная проба: комната не ждёт — через 1,5 с уже в Supabase', W1.RT.stats());
  ok(!!(await until(() => W1.RT.stats().st === 'up', 14000)) && !W1.RT.stats().badWhy, 'медленная проба: проба всё же прошла (связь годная, просто медленная)', W1.RT.stats());
  const dw2 = duel(W1, 'rt9abc', 'W1b');
  ok(!!(await until(() => W1.RT.stats().chans.find(c => c.name === 'chess-duel-rt9abc')?.via === 'rt', 15000)), 'медленная проба: следующая комната — через свой сервер', W1.RT.stats().chans);
  dw.room.leave(); dw2.room.leave();
  // 8d. кто-то с ?rt=0 (или старая вкладка) — вся комната переезжает, «соперник ушёл» не было
  const G = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const dg = duel(G, 'rt4abc', 'G');
  await until(() => dg.ev.length > 0 && viaAll(G, 'rt'), 5000);
  const Hx = makeTab({ rtUrl: S.url, sbUrl: P.url, search: '?rt=0' });
  ok(Hx.RT.client() === null && Hx.RT.enabled() === false, '?rt=0: D37RT выключен в этой вкладке (только Supabase)');
  const dh = duel(Hx, 'rt4abc', 'H');
  ok(!!(await until(() => dg.room.opp && dh.room.opp && viaAll(G, 'sb'), 8000)), '?rt=0 у второго: сервер увидел его в Supabase и перевёл комнату — оба там, видят друг друга', [G.RT.stats(), dg.ev, dh.ev]);
  await until(() => dg.peers().length >= 2, 2500);
  ok(dg.peers().filter(p => p === null).length === 1 && dg.peers().at(-1) === dh.room.myId, 'переезд: у первого «соперник ушёл» не было (только начальное «ждём»)', dg.peers());
  dh.room.send({ x: 'h' }); dg.room.send({ x: 'g' });
  ok(!!(await until(() => dg.msgs().includes('h') && dh.msgs().includes('g'), 4000)), 'после переезда ходы ходят');
  // 8e. сервер упал посреди партии → оба в Supabase, комната собралась сама
  const pa = da.peers().length, pb = db.peers().length;
  await S.kill();
  ok(!!(await until(() => viaAll(A, 'sb') && viaAll(B, 'sb'), 6000)), 'сервер убит: обе вкладки за ~2 с ушли в Supabase', [A.RT.stats(), B.RT.stats()]);
  ok(!!(await until(() => P.keys('chess-duel-rt1abc').length === 2, 3000)), 'сервер убит: комната собралась в Supabase (оба там)', P.keys('chess-duel-rt1abc'));
  await sleep(400);
  ok(da.peers().length === pa && db.peers().length === pb && !da.ev.some(e => e[0] === 'err') && !db.ev.some(e => e[0] === 'err'), 'сервер убит: игра не заметила переезда (ни «соперник ушёл», ни «нет связи»)', [da.ev.slice(-4), db.ev.slice(-4)]);
  db.room.send({ x: 3 }); da.room.send({ x: 4 });
  ok(!!(await until(() => da.msgs().includes(3) && db.msgs().includes(4), 4000)), 'сервер убит: ходы ходят через Supabase');
  // сервер вернулся: старая комната остаётся в Supabase, новые — снова через свой сервер (после DOWN_MS)
  S = await K.startServer(D, env);
  cleanup.push(() => S.kill());
  await sleep(1700);
  const A3 = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const da3 = duel(A3, 'rt1abc', 'A3');   // в ту же комнату (там двое в Supabase) — сервер скажет «sb»
  ok(!!(await until(() => da3.ev.some(e => e[0] === 'full') && A3.RT.stats().sbChannels === 1 && A3.RT.stats().rtChannels === 1, 6000)), 'сервер вернулся: новичок в старую комнату (там двое в Supabase) — сервер ответил «sb», в Supabase он их увидел («комната занята» — она на двоих)', [A3.RT.stats(), da3.ev]);
  da3.room.leave();
  const dn = duel(A, 'rt5abc', 'A-new'), dn2 = duel(B, 'rt5abc', 'B-new');
  ok(!!(await until(() => dn.room.opp && dn2.room.opp && A.RT.stats().chans.find(c => c.name === 'chess-duel-rt5abc')?.via === 'rt', 8000)), 'сервер вернулся: новая комната — снова через свой сервер', A.RT.stats().chans);
  for (const d of [da, db, dc, db2, de, df, dg, dh, dn, dn2]) d.room.leave();
  // 8f. RT_URL пустой — ровно как раньше: ни одного запроса к серверу, каналы — прямо sbClient
  const Z1 = makeTab({ rtUrl: '', sbUrl: P.url }), Z2 = makeTab({ rtUrl: '', sbUrl: P.url });
  const z1 = duel(Z1, 'rt6abc', 'Z1'), z2 = duel(Z2, 'rt6abc', 'Z2');
  ok(!!(await until(() => z1.room.opp && z2.room.opp, 6000)), 'RT_URL пустой: комната через Supabase работает');
  ok(Z1.RT.client() === null && Z1.RT.stats().chans.length === 0 && Z1.net.other === 0 && Z2.net.other === 0 && Z1.RT.ice().length === 0, 'RT_URL пустой: D37RT молчит (каналов 0, запросов 0, TURN нет)', [Z1.RT.stats(), Z1.net]);
  z1.room.leave(); z2.room.leave();
  return S;
}

// ═══ 9. table.js (шифр) и IoKit («-r») через D37RT; TURN ═══
async function tableIo(P, S){
  const A = makeTab({ rtUrl: S.url, sbUrl: P.url }), B = makeTab({ rtUrl: S.url, sbUrl: P.url });
  const got = [], seatsA = [], seatsB = [];
  const ta = A.ctx.TableRoom.join('uno', 'tb1abc', { max: 2, onSeats: s => seatsA.push(s.length), onPrivate: m => got.push(['A', m.card]) });
  await until(() => seatsA.length, 5000);
  const tb = B.ctx.TableRoom.join('uno', 'tb1abc', { max: 2, onSeats: s => seatsB.push(s.length), onPrivate: m => got.push(['B', m.card]) });
  ok(!!(await until(() => ta.seats.length === 2 && tb.seats.length === 2, 6000)), 'table.js через свой сервер: два места');
  ok(!!(await until(() => ta.seats.every(s => s.pk) && tb.seats.every(s => s.pk), 4000)), 'table.js: открытые ключи ECDH — в presence');
  await ta.sendTo(tb.myId, { card: 'R7' });
  ok(!!(await until(() => got.some(g => g[0] === 'B' && g[1] === 'R7'), 4000)), 'table.js: личное сообщение (AES-GCM) дошло и расшифровано');
  ok(viaAll(A, 'rt') && viaAll(B, 'rt'), 'table.js: всё через свой сервер');
  ta.leave(); tb.leave();
  // IoKit: хозяин и гость, снимки — через «-r» (WebRTC в node нет — как строгий NAT)
  const IoA = A.ctx.IoKit, IoB = B.ctx.IoKit;
  const st = { A: null, B: null }, bins = [], ins = [];
  const mk = (Io, key, tag) => Io.party({ game: 'kletochki', code: 'io1abc', max: 10, me: { key, nick: tag }, open: Io.supaTransport, net: null,
    onState: P2 => { st[tag] = { host: P2.isHost, n: P2.players.length }; }, onMsg: (f, d) => ins.push([tag, d]), onFast: (f, d) => ins.push([tag, 'fast', d]),
    onBin: (f, b) => bins.push([tag, b.byteLength]), onError: r => ins.push([tag, 'err', r]) });
  const pa = mk(IoA, 'io-a', 'A');
  await until(() => st.A, 5000);
  const pb = mk(IoB, 'io-b', 'B');
  ok(!!(await until(() => st.A?.n === 2 && st.B?.n === 2 && st.A.host && !st.B.host, 6000)), 'IoKit через свой сервер: хозяин и гость');
  const guest = pa.players.find(p => p.key === 'io-b')?.id;
  const sendBins = setInterval(() => { try { pa.bin(guest, new Uint8Array(300).buffer); } catch (e) {} }, 100);
  ok(!!(await until(() => bins.length >= 3, 4000)), 'IoKit: снимки хозяина доходят гостю через «-r»', bins.length);
  ok(A.RT.stats().chans.some(c => c.name === 'kletochki-io-io1abc-r' && c.via === 'rt'), 'IoKit: канал «-r» — через свой сервер', A.RT.stats().chans);
  // третий — с ?rt=0: вся комната и её «-r» переезжают, снимки продолжают идти
  const C = makeTab({ rtUrl: S.url, sbUrl: P.url, search: '?rt=0' });
  const pc = mk(C.ctx.IoKit, 'io-c', 'C');
  ok(!!(await until(() => viaAll(A, 'sb') && viaAll(B, 'sb') && st.A?.n === 3, 9000)), 'IoKit: третий в Supabase — комната и «-r» переехали, хозяин видит троих', [A.RT.stats().chans, st]);
  const nb = bins.length;
  ok(!!(await until(() => bins.length >= nb + 3, 4000)), 'IoKit: после переезда снимки идут', bins.length - nb);
  clearInterval(sendBins);
  pa.leave(); pb.leave(); pc.leave();
  // TURN: D37RT.ice() и window.D37_TURN (calls.js)
  A.RT.prefetchTurn();
  ok(!!(await until(() => A.RT.ice().length === 2, 3000)), 'TURN: D37RT.ice() — STUN + TURN с /turn');
  const t = A.RT.ice()[1];
  ok(A.ctx.D37_TURN === A.RT.ice() && /^turn:203\.0\.113\.7:3478\?transport=udp$/.test(t.urls[0]) && turnValid(TURN_SECRET, t.username, t.credential), 'TURN: window.D37_TURN для calls.js, пароль годен для coturn', t);
  const own = [{ urls: 'turn:x' }];
  B.ctx.D37_TURN = own; B.RT.prefetchTurn();
  await until(() => B.RT.ice().length === 2, 3000);
  ok(B.ctx.D37_TURN === own, 'TURN: свой window.D37_TURN (задан вручную) D37RT не трогает');
}

// ═══ 10. Утечки: 20 входов/выходов ═══
async function leaks(P, S){
  const A = makeTab({ rtUrl: S.url, sbUrl: P.url }), B = makeTab({ rtUrl: S.url, sbUrl: P.url });
  let t1 = 0, l1 = 0;
  for (let i = 0; i < 20; i++) {
    const code = 'lk' + String(1000 + i);
    const a = duel(A, code, 'A'), b = duel(B, code, 'B');
    await until(() => a.room.opp && b.room.opp, 5000);
    b.room.send({ x: i });
    await until(() => a.msgs().includes(i), 2000);
    a.room.leave(); b.room.leave();
    await sleep(30);
    if (i === 0) { await sleep(300); t1 = A.timers.size; l1 = A.listeners.get('pagehide')?.size || 0; }
  }
  await sleep(400);
  const j = await S.metrics(ADMIN);
  const st = A.RT._test.N;
  ok(j.counts.rooms === 0 && j.counts.members === 0 && j.counts.presence === 0, '20 входов/выходов: на сервере 0 комнат, мест, presence', j.counts);
  ok(A.RT.stats().chans.length === 0 && st.byI.size === 0 && st.byR.size === 0 && st.refs.size === 0 && st.waiters.length === 0, '20 входов/выходов: у клиента 0 каналов, ожиданий, подтверждений', { chans: A.RT.stats().chans.length, byI: st.byI.size, byR: st.byR.size, refs: st.refs.size });
  ok(A.timers.size <= t1, `20 входов/выходов: таймеров не прибавилось (${t1} → ${A.timers.size})`);
  ok((A.listeners.get('pagehide')?.size || 0) <= l1, 'слушателей pagehide не копится', [l1, A.listeners.get('pagehide')?.size]);
  ok(!!(await until(() => A.RT.stats().st === 'idle', 2500)), 'без комнат сокет сам закрылся (IDLE_MS)');
  ok(A.errs.length === 0 && B.errs.length === 0, 'ошибок в консоли вкладок нет', [...A.errs, ...B.errs].slice(0, 5));
}

(async () => {
  const t0 = Date.now();
  const P = await PH.start({ WS: D.WS, diffDelay: 250 });
  cleanup.push(() => P.close());
  try {
    await protocol();
    await resume();
    await slowReader();
    await jwt();
    await watcher(P);
    const P0 = await PH.start({ WS: D.WS, diffDelay: 0 });
    cleanup.push(() => P0.close());
    presenceAlgo();
    await shapes(P0);
    const S = await rooms(P);
    await tableIo(P, S);
    await leaks(P, S);
  } catch (e) { fail++; console.log('FAIL исключение', e && e.stack || e); }
  for (const f of cleanup.reverse()) { try { await f(); } catch (e) {} }
  finished = true;
  console.log(`rt-test: ${pass} ok, ${fail} fail (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
  process.exit(fail ? 1 : 0);
})();

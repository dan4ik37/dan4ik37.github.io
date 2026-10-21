// Тесты T-039: онлайн-комнаты по ссылке-приглашению, когда сайт ещё не подключил Supabase (sbClient появляется через 1–3 с или никогда),
// в node, без браузера и без сети. Подменяются: время (часы — ничего не ждём по-настоящему), клиент Supabase (каналы, presence,
// broadcast; сообщение до подписки — «через REST», это считается) и страницы (у каждой «вкладки» свой контекст, как в браузере).
//  1) GameRoom.whenNet — клиент есть / появился через 1–3 с / не появился (8 с) / без интернета / отмена;
//  2) GameRoom.channel — очередь до подписки (порядок, предел), нет связи → 'TIMED_OUT', close() при ожидании и после;
//  3) GameRoom.join (room.js) вдвоём: хозяин без сети в первые секунды, сообщения до подписки дошли, нет связи → onError, leave при
//     ожидании, 20 входов/выходов без утечек (каналы, слушатели pagehide, таймеры);
//  4) TableRoom.join (table.js): то же + личное сообщение шифром поверх очереди; Versus.start; NetPlay через комнату;
//  5) «Города» (cities.js), «Крокодил» (supaTransport + createRoom), миры (mir.js / world.js — join ждёт GameRoom.whenNet);
//  6) «Клеточки» / «Червячки»: whenNet без интернета, «Нет связи» с «Ещё раз»; «Города» и др. — страж: новые игры не заводят
//     sbClient.channel напрямую; офлайн-список PWA (OFFLINE_GAMES = offline.html) и sw.js.
// Запуск из корня сайта: node scripts/room-net-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), nodeCrypto = require('crypto');
const SITE = process.argv[2] || path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
let finished = false;
process.on('exit', () => { if (!finished) { console.log('FAIL тест не дошёл до конца'); process.exitCode = 1; } });

// ═══ Часы: время идёт, только когда скажем (advance), таймеры и интервалы по порядку ═══
// WebCrypto в node работает в потоках: пока его обещания не выполнились, виртуальное время вперёд не пускаем
let CRYPTO_BUSY = 0;
const sleepReal = ms => new Promise(r => setTimeout(r, ms));
async function settle(){ do { await flush(); while (CRYPTO_BUSY > 0) await sleepReal(1); await flush(); } while (CRYPTO_BUSY > 0); }
function trackedCrypto(){
  const sub = nodeCrypto.webcrypto.subtle, wrap = {};
  for (const k of ['generateKey', 'exportKey', 'importKey', 'deriveKey', 'encrypt', 'decrypt']) {
    wrap[k] = (...a) => { CRYPTO_BUSY++; const p = sub[k](...a), dec = () => { CRYPTO_BUSY--; }; p.then(dec, dec); return p; };
  }
  return { subtle: wrap, getRandomValues: a => nodeCrypto.webcrypto.getRandomValues(a) };
}
const ALL_CLOCKS = [];
function makeClock(){
  const C = { t: 1000000, q: [], id: 0, errors: [] };
  ALL_CLOCKS.push(C);
  C.setT = (f, ms = 0) => { const id = ++C.id; C.q.push({ id, at: C.t + Math.max(0, +ms || 0), f, every: 0 }); return id; };
  C.setI = (f, ms = 0) => { const id = ++C.id; ms = Math.max(1, +ms || 0); C.q.push({ id, at: C.t + ms, f, every: ms }); return id; };
  C.clr = id => { C.q = C.q.filter(x => x.id !== id); };
  C.pending = () => C.q.length;
  C.advance = async ms => {
    const end = C.t + ms;
    for (;;) {
      await settle();
      C.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const x = C.q[0];
      if (!x || x.at > end) break;
      C.t = Math.max(C.t, x.at);
      if (x.every) x.at += x.every; else C.q.shift();
      try { x.f(); } catch (e) { C.errors.push(e); }
    }
    C.t = end;
    await settle();
  };
  return C;
}

// ═══ «Supabase»: общий узел (каналы по имени) и клиент страницы ═══
function makeHub(clock){ return { clock, topics: new Map(), topic(name){ let t = this.topics.get(name); if (!t) this.topics.set(name, t = { members: new Set() }); return t; } }; }
// o.lat — задержка сети (мс); o.subFail — чем отвечает подписка вместо SUBSCRIBED; sb.rest — сколько сообщений ушло «через REST» (канал ещё не подписан)
function fakeClient(hub, o = {}){
  const clock = hub.clock, lat = o.lat ?? 30;
  const sb = { chans: [], created: 0, removed: 0, rest: 0, sent: 0, subFail: o.subFail || null, throwOnChannel: false, log: [] };
  const syncAll = T => { for (const m of T.members) if (m.state === 'joined') clock.setT(() => { if (m.state === 'joined') for (const [t, f, cb] of m.handlers) if (t === 'presence') cb(); }, lat); };
  sb.channel = (name, copt) => {
    if (sb.throwOnChannel) throw new Error('channel failed');
    const topic = 'realtime:' + name;
    const old = sb.chans.find(x => x.topic === topic);
    if (old) return old;   // как supabase-js: канал с тем же именем — тот же объект
    const T = hub.topic(name), key = copt?.config?.presence?.key;
    const c = { topic, name, key, state: 'closed', handlers: [], meta: null };
    c.on = (type, filter, cb) => { if (c.state !== 'closed' && type === 'presence') throw new Error('presence after subscribe'); c.handlers.push([type, filter, cb]); return c; };
    c.subscribe = cb => {
      c.state = 'joining';
      clock.setT(() => {
        if (c.state !== 'joining') return;
        if (sb.subFail) { c.state = 'errored'; cb(sb.subFail); return; }
        c.state = 'joined'; T.members.add(c); cb('SUBSCRIBED');
      }, lat);
      return c;
    };
    c.send = m => {
      const viaRest = c.state !== 'joined';
      if (viaRest) sb.rest++; else sb.sent++;
      sb.log.push([viaRest ? 'rest' : 'ws', m.payload]);
      const payload = JSON.parse(JSON.stringify(m.payload));
      for (const o2 of T.members) if (o2 !== c) clock.setT(() => { if (o2.state === 'joined') for (const [t, f, cb] of o2.handlers) if (t === 'broadcast' && f.event === m.event) cb({ payload }); }, viaRest ? lat * 8 : lat);
      return Promise.resolve('ok');
    };
    c.track = meta => { c.meta = JSON.parse(JSON.stringify(meta)); syncAll(T); return Promise.resolve('ok'); };
    c.untrack = () => { c.meta = null; syncAll(T); return Promise.resolve('ok'); };
    c.presenceState = () => { const st = {}; for (const m of T.members) if (m.meta) (st[m.key] = st[m.key] || []).push(m.meta); return st; };
    sb.chans.push(c); sb.created++;
    return c;
  };
  sb.removeChannel = c => { sb.removed++; c.state = 'closed'; const T = hub.topic(c.name); T.members.delete(c); sb.chans = sb.chans.filter(x => x !== c); syncAll(T); return Promise.resolve('ok'); };
  sb.getChannels = () => sb.chans.slice();
  return sb;
}

// ═══ Страница (вкладка браузера): свой контекст со своими sbClient / currentUser / sessionStorage ═══
function makePage(clock, o = {}){
  const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; };
  const L = {};
  const sb = {
    console, Math, JSON, Promise, TextEncoder, TextDecoder, btoa, atob, Uint8Array, ArrayBuffer, Map, Set, Object, Array, String, Number, Error, RegExp, isNaN, parseInt, parseFloat, Symbol,
    setTimeout: clock.setT, clearTimeout: clock.clr, setInterval: clock.setI, clearInterval: clock.clr,
    Date: class extends Date { static now(){ return clock.t; } },
    crypto: trackedCrypto(), sessionStorage: mem(), localStorage: mem(),
    navigator: { onLine: o.online !== false },
    location: { origin: 'https://dan4ik37.vercel.app', pathname: '/', href: 'https://dan4ik37.vercel.app/', reloads: 0, reload(){ this.reloads++; } },
    document: { querySelector: () => null, addEventListener(){}, removeEventListener(){} },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    addEventListener(t, f){ (L[t] = L[t] || []).push(f); }, removeEventListener(t, f){ L[t] = (L[t] || []).filter(x => x !== f); },
  };
  sb.window = sb; sb.GAME_IMPL = {};
  const ctx = vm.createContext(sb);
  vm.runInContext('let sbClient = null, currentUser = null, currentProfile = null;', ctx);   // как в chat.js: let — снаружи виден только по имени
  const P = { ctx, L };
  P.load = (...files) => { for (const f of files) vm.runInContext(read(f), ctx, { filename: f }); return P; };
  P.setSb = client => { ctx.__v = client; vm.runInContext('sbClient = __v', ctx); };
  P.setUser = u => { ctx.__v = u; vm.runInContext('currentUser = __v', ctx); };
  P.setProfile = u => { ctx.__v = u; vm.runInContext('currentProfile = __v', ctx); };
  P.listeners = t => (L[t] || []).length;
  P.pagehide = () => (L.pagehide || []).slice().forEach(f => f());
  P.GR = () => ctx.GameRoom;
  return P;
}
// Мини-«элемент» страницы для игр, рисующих в innerHTML
function miniEl(){
  const R = { innerHTML: '', stubs: {}, classList: { add(){}, remove(){} }, querySelector(sel){ return R.stubs[sel] || (R.stubs[sel] = { textContent: '', innerHTML: '', onclick: null, value: '', select(){}, style: {}, addEventListener(){} }); }, querySelectorAll: () => [] };
  return R;
}

(async () => {
  // ═══ 1. GameRoom.whenNet ═══
  {
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    // клиент уже есть — сразу и синхронно
    P.setSb(fakeClient(hub));
    let got = [];
    const stop0 = GR.whenNet(v => got.push(v));
    ok(got.length === 1 && got[0] === true && clock.pending() === 0, 'whenNet: клиент есть — ответ сразу, таймеров нет', [got, clock.pending()]);
    ok(typeof stop0 === 'function', 'whenNet: возвращает «отмену»');
    ok(GR.netOk() === true, 'netOk: клиент есть');
  }
  for (const delay of [1000, 2000, 3000]) {
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const t0 = clock.t, got = [];
    GR.whenNet(v => got.push([v, clock.t - t0]));
    ok(got.length === 0 && clock.pending() === 1, `whenNet ${delay / 1000} с: ждём, один опрос`, [got, clock.pending()]);
    await clock.advance(delay - 50);
    ok(got.length === 0, `whenNet ${delay / 1000} с: до появления клиента ответа нет`, got);
    P.setSb(fakeClient(hub));
    await clock.advance(150);
    ok(got.length === 1 && got[0][0] === true && got[0][1] >= delay - 50 && got[0][1] <= delay + 150, `whenNet ${delay / 1000} с: клиент появился — ответ true за ≤ 0,1 с`, got);
    await clock.advance(10000);
    ok(got.length === 1 && clock.pending() === 0, `whenNet ${delay / 1000} с: ответ один, опрос остановлен`, [got.length, clock.pending()]);
  }
  {
    const clock = makeClock(), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const t0 = clock.t, got = [];
    GR.whenNet(v => got.push([v, clock.t - t0]));
    await clock.advance(7900);
    ok(got.length === 0, 'whenNet: 7,9 с — ещё ждём', got);
    await clock.advance(300);
    ok(got.length === 1 && got[0][0] === false && got[0][1] >= 8000 && got[0][1] <= 8200 && clock.pending() === 0, 'whenNet: не появился — на 8-й секунде false, один раз, опрос остановлен', [got, clock.pending()]);
    const got2 = [];
    GR.whenNet(v => got2.push([v, clock.t]), 1500);
    await clock.advance(1700);
    ok(got2.length === 1 && got2[0][0] === false, 'whenNet(fn, 1500): свой срок', got2);
  }
  {
    // без интернета: ждать нечего — false не из самого вызова, опроса нет
    const clock = makeClock(), P = makePage(clock, { online: false }).load('js/games/room.js'), GR = P.GR();
    const got = [];
    GR.whenNet(v => got.push(v));
    ok(got.length === 0 && clock.pending() === 1, 'whenNet без интернета: ответ не синхронный', [got, clock.pending()]);
    await clock.advance(1);
    ok(got.length === 1 && got[0] === false && clock.pending() === 0, 'whenNet без интернета: сразу false, без опроса', [got, clock.pending()]);
    // ...но клиент уже есть — интернет «пропал» после загрузки: работаем как раньше
    P.setSb(fakeClient(makeHub(clock)));
    const got3 = [];
    GR.whenNet(v => got3.push(v));
    ok(got3.length === 1 && got3[0] === true, 'whenNet: клиент есть, а navigator.onLine=false — клиента не блокируем');
  }
  {
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const got = [];
    const cancel = GR.whenNet(v => got.push(v));
    await clock.advance(500);
    cancel();
    ok(clock.pending() === 0, 'whenNet: отмена снимает опрос', clock.pending());
    P.setSb(fakeClient(hub));
    await clock.advance(10000);
    ok(got.length === 0, 'whenNet: после отмены ответа нет', got);
    const c2 = makePage(clock, { online: false }).load('js/games/room.js').GR().whenNet(v => got.push(v));
    c2(); await clock.advance(10);
    ok(got.length === 0, 'whenNet без интернета: отмена до ответа — ответа нет', got);
  }

  // ═══ 2. GameRoom.channel ═══
  const CFG = { config: { broadcast: { self: false }, presence: { key: 'k1' } } };
  {
    // сеть есть сразу: канал создаётся в subscribe(), сообщения до SUBSCRIBED копятся и уходят по порядку без REST
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const sb = fakeClient(hub); P.setSb(sb);
    const peer = fakeClient(hub), pc = peer.channel('t-chan', CFG), seen = [];
    pc.on('broadcast', { event: 'm' }, ({ payload }) => seen.push(payload.n)); pc.subscribe(() => {});
    await clock.advance(100);
    const ch = GR.channel('t-chan', CFG), st = [];
    ch.on('broadcast', { event: 'm' }, () => {});
    ch.send({ type: 'broadcast', event: 'm', payload: { n: 1 } });
    ch.subscribe(s => st.push(s));
    ok(sb.created === 1 && sb.chans[0].state === 'joining', 'channel: клиент есть — настоящий канал создан сразу, в subscribe()', [sb.created]);
    ch.send({ type: 'broadcast', event: 'm', payload: { n: 2 } });
    ok(sb.rest === 0 && sb.sent === 0 && ch.ready() === false, 'channel: до подписки сообщения не ушли (ни по сокету, ни через REST)', [sb.rest, sb.sent]);
    await clock.advance(200);
    ok(JSON.stringify(st) === '["SUBSCRIBED"]' && ch.ready() === true, 'channel: статус SUBSCRIBED дошёл', st);
    ok(sb.rest === 0 && sb.sent === 2 && JSON.stringify(seen) === '[1,2]', 'channel: очередь ушла после подписки по порядку, без REST', [sb.rest, sb.sent, seen]);
    ch.send({ type: 'broadcast', event: 'm', payload: { n: 3 } });
    await clock.advance(100);
    ok(sb.sent === 3 && JSON.stringify(seen) === '[1,2,3]', 'channel: после подписки — сразу по сокету', [sb.sent, seen]);
    ok(ch.presenceState && JSON.stringify(ch.presenceState()) === '{}', 'channel: presenceState работает');
    ch.close();
    await clock.advance(200);
    ok(sb.removed === 1 && sb.chans.length === 0 && clock.pending() === 0, 'channel: close() — канал снят, таймеров нет', [sb.removed, sb.chans.length, clock.pending()]);
    ch.close();
    ok(sb.removed === 1, 'channel: close() второй раз — ничего');
    const r = await ch.send({ type: 'broadcast', event: 'm', payload: { n: 9 } });
    ok(r === 'closed' && sb.sent === 3, 'channel: send() после close() — ничего не уходит');
  }
  for (const delay of [1000, 2000, 3000]) {
    // сети нет, появляется через 1–3 с
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const sb = fakeClient(hub), peer = fakeClient(hub), pc = peer.channel('late', CFG), seen = [];
    pc.on('broadcast', { event: 'm' }, ({ payload }) => seen.push(payload.n)); pc.subscribe(() => {});
    await clock.advance(100);
    const ch = GR.channel('late', CFG), st = [], prs = [];
    ch.on('presence', { event: 'sync' }, () => prs.push(1));
    ch.on('broadcast', { event: 'm' }, () => {});
    ch.subscribe(s => st.push(s));
    for (let i = 1; i <= 3; i++) ch.send({ type: 'broadcast', event: 'm', payload: { n: i } });
    ok(ch.presenceState && JSON.stringify(ch.presenceState()) === '{}', `channel ${delay / 1000} с: presenceState до создания — {}`);
    const tr = await ch.track({ x: 1 });
    ok(tr === 'error', `channel ${delay / 1000} с: track до создания — не падает`, tr);
    await clock.advance(delay - 100);
    ok(st.length === 0 && sb.created === 0, `channel ${delay / 1000} с: пока клиента нет — ничего нет`, [st, sb.created]);
    P.setSb(sb);
    await clock.advance(400);
    ok(sb.created === 1 && JSON.stringify(st) === '["SUBSCRIBED"]', `channel ${delay / 1000} с: клиент появился — канал создан и подписан`, [sb.created, st]);
    ok(sb.rest === 0 && JSON.stringify(seen) === '[1,2,3]', `channel ${delay / 1000} с: три сообщения до подписки дошли по порядку, не через REST`, [sb.rest, seen]);
    await ch.track({ nick: 'a', t: 1 });
    await clock.advance(100);
    ok(prs.length >= 1, `channel ${delay / 1000} с: обработчик presence, повешенный до создания, работает`, prs);
    ch.close();
    await clock.advance(10000);
    ok(clock.pending() === 0 && sb.removed === 1, `channel ${delay / 1000} с: после close() таймеров нет`, [clock.pending(), sb.removed]);
  }
  {
    // не появился: TIMED_OUT один раз; close() потом — без ошибок
    const clock = makeClock(), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const ch = GR.channel('never', CFG), st = [];
    ch.subscribe(s => st.push(s));
    ch.send({ type: 'broadcast', event: 'm', payload: { n: 1 } });
    await clock.advance(7900);
    ok(st.length === 0, 'channel: 7,9 с — статуса ещё нет');
    await clock.advance(400);
    ok(JSON.stringify(st) === '["TIMED_OUT"]' && clock.pending() === 0, 'channel: сети нет 8 с — один статус TIMED_OUT, таймеров нет', [st, clock.pending()]);
    let threw = false; try { ch.close(); await ch.send({}); } catch (e) { threw = true; }
    ok(!threw, 'channel: close()/send() после TIMED_OUT — без ошибок');
    // без интернета — сразу (но не из самого subscribe)
    const P2 = makePage(clock, { online: false }).load('js/games/room.js'), st2 = [];
    const c2 = P2.GR().channel('off', CFG); c2.subscribe(s => st2.push(s));
    ok(st2.length === 0, 'channel без интернета: статус не из самого subscribe()');
    await clock.advance(5);
    ok(JSON.stringify(st2) === '["TIMED_OUT"]' && clock.pending() === 0, 'channel без интернета: сразу TIMED_OUT', [st2, clock.pending()]);
  }
  {
    // close() во время ожидания: канала не будет, даже если клиент появится
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const sb = fakeClient(hub), ch = GR.channel('w', CFG), st = [];
    ch.subscribe(s => st.push(s));
    ch.send({ type: 'broadcast', event: 'm', payload: { n: 1 } });
    await clock.advance(500);
    ch.close();
    ok(clock.pending() === 0, 'channel: close() при ожидании — опрос снят', clock.pending());
    P.setSb(sb);
    await clock.advance(10000);
    ok(sb.created === 0 && st.length === 0 && sb.rest === 0, 'channel: после close() канал не создаётся, статусов и сообщений нет', [sb.created, st, sb.rest]);
    // close() в момент подписки (канал создан, SUBSCRIBED ещё нет)
    const hub2 = makeHub(clock), sb2 = fakeClient(hub2), P2 = makePage(clock).load('js/games/room.js');
    P2.setSb(sb2);
    const c2 = P2.GR().channel('w2', CFG), st2 = [];
    c2.subscribe(s => st2.push(s));
    c2.send({ type: 'broadcast', event: 'm', payload: { n: 1 } });
    c2.close();
    await clock.advance(1000);
    ok(sb2.created === 1 && sb2.removed === 1 && st2.length === 0 && sb2.sent === 0 && sb2.rest === 0, 'channel: close() до SUBSCRIBED — канал снят, ничего не отправлено', [sb2.created, sb2.removed, st2, sb2.sent, sb2.rest]);
  }
  {
    // предел очереди: 50, старое вытесняется
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const sb = fakeClient(hub), peer = fakeClient(hub), pc = peer.channel('cap', CFG), seen = [];
    pc.on('broadcast', { event: 'm' }, ({ payload }) => seen.push(payload.n)); pc.subscribe(() => {});
    await clock.advance(100);
    const ch = GR.channel('cap', CFG); ch.subscribe(() => {});
    for (let i = 1; i <= 80; i++) ch.send({ type: 'broadcast', event: 'm', payload: { n: i } });
    P.setSb(sb);
    await clock.advance(1000);
    ok(seen.length === 50 && seen[0] === 31 && seen[49] === 80, 'channel: очередь до подписки — 50 последних сообщений', [seen.length, seen[0], seen[49]]);
    ch.close();
  }
  {
    // клиент есть, но канал не создаётся / подписка падает: статус ошибки, а не тишина
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), GR = P.GR();
    const sb = fakeClient(hub); sb.throwOnChannel = true; P.setSb(sb);
    const orig = console.error; console.error = () => {};
    const ch = GR.channel('boom', CFG), st = [];
    ch.subscribe(s => st.push(s));
    console.error = orig;
    ok(JSON.stringify(st) === '["CHANNEL_ERROR"]', 'channel: sbClient.channel бросил ошибку — CHANNEL_ERROR', st);
    const sb2 = fakeClient(hub, { subFail: 'TIMED_OUT' }), P2 = makePage(clock).load('js/games/room.js');
    P2.setSb(sb2);
    const c2 = P2.GR().channel('bad', CFG), st2 = [];
    c2.subscribe(s => st2.push(s));
    c2.send({ type: 'broadcast', event: 'm', payload: { n: 1 } });
    await clock.advance(500);
    ok(JSON.stringify(st2) === '["TIMED_OUT"]' && sb2.rest === 0 && sb2.sent === 0, 'channel: сервер не подписал — TIMED_OUT, очередь не уходит', [st2, sb2.rest, sb2.sent]);
    c2.close();
  }

  // ═══ 3. GameRoom.join вдвоём ═══
  for (const delay of [1000, 2000, 3000]) {
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js'), B = makePage(clock).load('js/games/room.js');
    const sbA = fakeClient(hub), sbB = fakeClient(hub);
    A.setUser({ id: 'user-a' }); A.setProfile({ nick: 'Алиса' });
    B.setUser({ id: 'user-b' }); B.setProfile({ nick: 'Боря' });
    B.setSb(sbB);
    const logA = [], logB = [];
    const hA = { onPeer: (o, r) => logA.push(['peer', o && o.nick, r.isHost]), onMessage: m => logA.push(['msg', m.type]), onError: () => logA.push(['err']), onFull: () => logA.push(['full']) };
    const hB = { onPeer: (o, r) => logB.push(['peer', o && o.nick, r.isHost]), onMessage: m => logB.push(['msg', m.type, m.n]), onError: () => logB.push(['err']), onFull: () => logB.push(['full']) };
    // A — хозяин: открыл ссылку первым, но сайт ещё не подключил Supabase
    const rA = A.GR().join('pool', 'abc123', hA);
    ok(rA && !rA.closed, `join ${delay / 1000} с: комната возвращается сразу, даже без sbClient`);
    ok(logA.length === 0, `join ${delay / 1000} с: onError не из самого join()`, logA);
    rA.send({ type: 'start', n: 1 }); rA.send({ type: 'start', n: 2 });
    await clock.advance(delay / 2);
    const rB = B.GR().join('pool', 'abc123', hB);
    await clock.advance(delay / 2 - 50);
    ok(sbA.created === 0 && logA.length === 0, `join ${delay / 1000} с: сети у хозяина ещё нет — канала нет, ошибки нет`, [sbA.created, logA]);
    A.setSb(sbA);
    await clock.advance(3000);
    ok(sbA.created === 1 && rA.synced, `join ${delay / 1000} с: клиент появился — хозяин в комнате`, [sbA.created, rA.synced]);
    ok(rA.isHost === true && rB.isHost === false, `join ${delay / 1000} с: хозяин — кто открыл ссылку первым, а не чья сеть быстрее`, [rA.isHost, rB.isHost]);
    ok(logA.some(e => e[0] === 'peer' && e[1] === 'Боря') && logB.some(e => e[0] === 'peer' && e[1] === 'Алиса'), `join ${delay / 1000} с: оба увидели друг друга`, [logA, logB]);
    ok(logB.filter(e => e[0] === 'msg').map(e => e[2]).join() === '1,2' && sbA.rest === 0 && sbB.rest === 0, `join ${delay / 1000} с: сообщения хозяина до подписки дошли гостю по порядку, без REST`, [logB, sbA.rest, sbB.rest]);
    ok(!logA.some(e => e[0] === 'err') && !logB.some(e => e[0] === 'err'), `join ${delay / 1000} с: ошибок нет`, [logA, logB]);
    rB.send({ type: 'reply' });
    await clock.advance(200);
    ok(logA.some(e => e[0] === 'msg' && e[1] === 'reply'), `join ${delay / 1000} с: гость пишет хозяину`, logA);
    // третий лишний — «занято», канал снят
    const C = makePage(clock).load('js/games/room.js'), sbC = fakeClient(hub); C.setSb(sbC); C.setUser({ id: 'user-c' });
    const logC = []; const rC = C.GR().join('pool', 'abc123', { onFull: () => logC.push('full'), onError: () => logC.push('err'), onPeer(){}, onMessage(){} });
    await clock.advance(3000);
    ok(logC.join() === 'full' && rC.closed && sbC.chans.length === 0, `join ${delay / 1000} с: третий — «Комната занята», канал снят`, [logC, rC.closed, sbC.chans.length]);
    rA.leave();
    await clock.advance(2000);
    ok(logB.some(e => e[0] === 'peer' && e[1] === null), `join ${delay / 1000} с: хозяин ушёл — гость видит`, logB);
    rB.leave();
    await clock.advance(20000);
    ok(sbA.chans.length === 0 && sbB.chans.length === 0 && sbA.created === sbA.removed && sbB.created === sbB.removed, `join ${delay / 1000} с: после выхода каналов не осталось`, [sbA.chans.length, sbB.chans.length]);
    ok(A.listeners('pagehide') === 0 && B.listeners('pagehide') === 0 && C.listeners('pagehide') === 0, `join ${delay / 1000} с: слушателей pagehide не осталось`, [A.listeners('pagehide'), B.listeners('pagehide')]);
    ok(clock.pending() === 0, `join ${delay / 1000} с: таймеров не осталось`, clock.pending());
  }
  {
    // сети нет совсем: понятная ошибка один раз, ничего не висит
    const clock = makeClock(), P = makePage(clock).load('js/games/room.js'), log = [];
    const r = P.GR().join('chess', 'zzz111', { onError: () => log.push(clock.t - t0), onPeer(){}, onMessage(){}, onFull(){} });
    const t0 = clock.t;
    r.send({ type: 'x' });
    await clock.advance(7900);
    ok(log.length === 0, 'join без сети: до 8 с ошибки нет (идёт ожидание)');
    await clock.advance(500);
    ok(log.length === 1, 'join без сети: через 8 с — onError ровно один раз', log);
    r.leave();
    ok(P.listeners('pagehide') === 0 && clock.pending() === 0, 'join без сети: после leave() ни слушателей, ни таймеров', [P.listeners('pagehide'), clock.pending()]);
    ok(P.GR().errorHtml.includes('Нет связи') && P.GR().errorHtml.includes('ещё раз') && P.GR().errorHtml.includes('location.reload()'), 'errorHtml: «Нет связи… попробуй ещё раз» и кнопка', P.GR().errorHtml);
    // без интернета — ошибка сразу
    const P2 = makePage(clock, { online: false }).load('js/games/room.js'), log2 = [];
    P2.GR().join('chess', 'zzz112', { onError: () => log2.push(1), onPeer(){}, onMessage(){}, onFull(){} });
    ok(log2.length === 0, 'join без интернета: onError не из самого join()');
    await clock.advance(5);
    ok(log2.length === 1 && clock.pending() === 0, 'join без интернета: сразу onError, ждать нечего', [log2, clock.pending()]);
  }
  {
    // уходим, пока ждём: клиент появится потом — канал не создаётся, onError не приходит
    const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), sb = fakeClient(hub), log = [];
    const r = P.GR().join('sea', 'qqq222', { onError: () => log.push('err'), onPeer: () => log.push('peer'), onMessage(){}, onFull(){} });
    r.send({ type: 'x' });
    await clock.advance(1500);
    r.leave();
    ok(P.listeners('pagehide') === 0 && clock.pending() === 0, 'join: leave() при ожидании — слушатель и опрос сняты', [P.listeners('pagehide'), clock.pending()]);
    P.setSb(sb);
    await clock.advance(15000);
    ok(sb.created === 0 && log.length === 0 && sb.rest === 0, 'join: после leave() канала нет, ошибок и сообщений нет', [sb.created, log, sb.rest]);
    // pagehide при ожидании — то же, что leave()
    const r2 = P.GR().join('sea', 'qqq223', { onError: () => log.push('err2'), onPeer(){}, onMessage(){}, onFull(){} });
    P.setSb(null);
    P.pagehide();
    ok(r2.closed && P.listeners('pagehide') === 0, 'join: pagehide — комната закрыта, слушатель снят');
  }
  {
    // 20 входов-выходов подряд: сеть есть / появляется через 1 с / нет — каналы, слушатели, таймеры
    for (const mode of ['есть', 'позже', 'выход до сети']) {
      const clock = makeClock(), hub = makeHub(clock), P = makePage(clock).load('js/games/room.js'), sb = fakeClient(hub);
      if (mode === 'есть') P.setSb(sb);
      let errs = 0;
      for (let i = 0; i < 20; i++) {
        const r = P.GR().join('pool', 'code' + i, { onError: () => errs++, onPeer(){}, onMessage(){}, onFull(){} });
        r.send({ type: 'x', i });
        if (mode === 'позже') { await clock.advance(300); if (i === 0) P.setSb(sb); }
        else await clock.advance(mode === 'есть' ? 150 : 100);
        r.leave();
        await clock.advance(50);
      }
      await clock.advance(12000);
      const want = mode === 'выход до сети' ? 0 : mode === 'позже' ? 19 : 20;
      const made = sb.created;
      ok(sb.chans.length === 0 && sb.created === sb.removed && (mode === 'выход до сети' ? made === 0 : made >= 19), `20 входов/выходов (${mode}): каналов создано ${made}, снято ${sb.removed}, осталось ${sb.chans.length}`, [made, sb.removed, sb.chans.length]);
      ok(P.listeners('pagehide') === 0 && clock.pending() === 0 && errs === 0, `20 входов/выходов (${mode}): слушателей pagehide ${P.listeners('pagehide')}, таймеров ${clock.pending()}, ошибок ${errs}`, [P.listeners('pagehide'), clock.pending(), errs]);
      ok(sb.rest === 0, `20 входов/выходов (${mode}): через REST ни одного сообщения`, sb.rest);
    }
  }

  // ═══ 4. TableRoom.join, Versus, NetPlay ═══
  for (const delay of [1000, 2000, 3000]) {
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js', 'js/games/table.js'), B = makePage(clock).load('js/games/room.js', 'js/games/table.js');
    const sbA = fakeClient(hub), sbB = fakeClient(hub);
    A.setUser({ id: 'ua' }); A.setProfile({ nick: 'Алиса' }); B.setUser({ id: 'ub' }); B.setProfile({ nick: 'Боря' });
    B.setSb(sbB);
    const logA = [], logB = [], prv = [];
    const hA = { max: 4, onSeats: (s, r) => logA.push(['seats', s.length, r.isHost]), onMessage: (m, from) => logA.push(['msg', m.type]), onPrivate: (m, from) => prv.push(['A', m]), onError: () => logA.push(['err']), onFull(){} };
    const hB = { max: 4, onSeats: (s, r) => logB.push(['seats', s.length, r.isHost]), onMessage: (m, from) => logB.push(['msg', m.type, m.n]), onPrivate: (m, from) => prv.push(['B', m]), onError: () => logB.push(['err']), onFull(){} };
    const tA = A.ctx.TableRoom.join('chess', 'tbl123', hA);
    ok(tA && !tA.closed && logA.length === 0, `table ${delay / 1000} с: стол возвращается сразу, ошибки нет`);
    tA.send({ type: 'deal', n: 1 }); tA.send({ type: 'deal', n: 2 });
    await clock.advance(delay / 2);
    const tB = B.ctx.TableRoom.join('chess', 'tbl123', hB);
    await clock.advance(delay / 2 - 50);
    A.setSb(sbA);
    await clock.advance(4000);
    ok(tA.isHost && !tB.isHost && tA.seats.length === 2 && tB.seats.length === 2, `table ${delay / 1000} с: два места, хозяин — первый открывший ссылку`, [tA.isHost, tB.isHost, tA.seats.length, tB.seats.length]);
    ok(logB.filter(e => e[0] === 'msg').map(e => e[2]).join() === '1,2' && sbA.rest === 0 && sbB.rest === 0, `table ${delay / 1000} с: сообщения до подписки дошли по порядку, без REST`, [logB, sbA.rest, sbB.rest]);
    const idB = tB.myId;
    await tA.sendTo(idB, { type: 'hand', cards: ['r5', 'g7'] });
    await clock.advance(300);
    ok(prv.some(p => p[0] === 'B' && p[1].type === 'hand' && p[1].cards.join() === 'r5,g7'), `table ${delay / 1000} с: личное сообщение (шифр) дошло`, prv);
    const wire = sbA.log.filter(e => e[1] && e[1].type === '_pm');
    ok(wire.length === 1 && wire[0][1].ct && !JSON.stringify(wire[0][1]).includes('r5'), `table ${delay / 1000} с: в сети — шифр, не открытый текст`, wire);
    ok(!logA.some(e => e[0] === 'err') && !logB.some(e => e[0] === 'err'), `table ${delay / 1000} с: ошибок нет`);
    tA.leave(); tB.leave();
    await clock.advance(20000);
    ok(sbA.chans.length === 0 && sbB.chans.length === 0 && A.listeners('pagehide') + B.listeners('pagehide') === 0 && clock.pending() === 0, `table ${delay / 1000} с: после выхода каналов, слушателей и таймеров нет`, [sbA.chans.length, sbB.chans.length, A.listeners('pagehide'), B.listeners('pagehide'), clock.pending()]);
  }
  {
    const clock = makeClock(), P = makePage(clock).load('js/games/room.js', 'js/games/table.js'), log = [];
    const t = P.ctx.TableRoom.join('uno', 'noo123', { max: 4, onSeats(){}, onMessage(){}, onPrivate(){}, onError: () => log.push(1), onFull(){} });
    await clock.advance(8500);
    ok(log.length === 1 && clock.pending() === 0, 'table без сети: через 8 с onError один раз', [log, clock.pending()]);
    t.leave();
    ok(P.listeners('pagehide') === 0, 'table без сети: leave() снял слушатель');
    // 20 входов-выходов
    const hub = makeHub(clock), P2 = makePage(clock).load('js/games/room.js', 'js/games/table.js'), sb = fakeClient(hub);
    for (let i = 0; i < 20; i++) {
      if (i === 5) P2.setSb(sb);
      const r = P2.ctx.TableRoom.join('durak', 'tb' + i, { max: 4, onSeats(){}, onMessage(){}, onPrivate(){}, onError(){}, onFull(){} });
      await clock.advance(i % 2 ? 60 : 200);
      r.leave();
    }
    await clock.advance(12000);
    ok(sb.chans.length === 0 && sb.created === sb.removed && P2.listeners('pagehide') === 0 && clock.pending() === 0 && sb.rest === 0, `table: 20 входов/выходов — каналов создано ${sb.created}, осталось ${sb.chans.length}; слушателей ${P2.listeners('pagehide')}; таймеров ${clock.pending()}`, [sb.created, sb.removed, sb.chans.length, P2.listeners('pagehide'), clock.pending(), sb.rest]);
  }
  {
    // Versus (дуэль в одиночной игре): оба получили один seed
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js', 'js/games/versus.js'), B = makePage(clock).load('js/games/room.js', 'js/games/versus.js');
    const sbA = fakeClient(hub), sbB = fakeClient(hub);
    A.setProfile({ nick: 'Алиса' }); B.setProfile({ nick: 'Боря' });
    B.setSb(sbB);
    const rA = miniEl(), rB = miniEl(), runs = { A: [], B: [] }, api = { sfx(){}, report(){} };
    const stopA = A.ctx.Versus.start(rA, api, 'catch', 'vs1234', { run: (stage, rng, hooks) => runs.A.push(rng()), stop(){} });
    ok(/Подключаемся к комнате/.test(rA.innerHTML) && !rA.innerHTML.includes('Нет связи'), 'Versus без сети: сначала «Подключаемся к комнате…», не ошибка');
    await clock.advance(500);
    const stopB = B.ctx.Versus.start(rB, api, 'catch', 'vs1234', { run: (stage, rng, hooks) => runs.B.push(rng()), stop(){} });
    await clock.advance(1500);
    A.setSb(sbA);
    await clock.advance(5000);
    ok(runs.A.length === 1 && runs.B.length === 1 && runs.A[0] === runs.B[0], 'Versus: хозяин без сети в первые секунды — партия началась у обоих с одним seed', runs);
    ok(sbA.rest === 0 && sbB.rest === 0, 'Versus: ни одного сообщения через REST', [sbA.rest, sbB.rest]);
    stopA(); stopB();
    await clock.advance(10000);
    ok(sbA.chans.length === 0 && sbB.chans.length === 0 && clock.pending() === 0 && A.listeners('pagehide') === 0, 'Versus: после выхода всё снято', [sbA.chans.length, clock.pending()]);
    // нет связи: страница «Нет связи… ещё раз» вместо ожидания
    const P3 = makePage(clock).load('js/games/room.js', 'js/games/versus.js'), r3 = miniEl();
    const stop3 = P3.ctx.Versus.start(r3, api, 'catch', 'vs9999', { run(){}, stop(){} });
    await clock.advance(8500);
    ok(r3.innerHTML === P3.GR().errorHtml && r3.innerHTML.includes('Нет связи'), 'Versus без сети 8 с: «Нет связи — попробуй ещё раз»', r3.innerHTML.slice(0, 120));
    stop3();
    ok(clock.pending() === 0 && P3.listeners('pagehide') === 0, 'Versus без сети: после выхода всё снято');
  }
  {
    // NetPlay поверх комнаты: сообщения «через сервер» до подписки не теряются
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js', 'js/games/netplay.js'), B = makePage(clock).load('js/games/room.js', 'js/games/netplay.js');
    const sbA = fakeClient(hub), sbB = fakeClient(hub); B.setSb(sbB);
    const got = [], npB = { v: null };
    const rA = A.GR().join('arena', 'np1234', { onPeer(){}, onMessage: m => { if (!npA.handle(m)) got.push(['A-raw', m.type]); }, onError(){}, onFull(){} });
    const npA = A.ctx.NetPlay.start(rA, { onMessage: m => got.push(['A', m.k]) });
    npA.send({ k: 'hello' });   // без прямой связи — через комнату, до подписки хозяина
    const rB = B.GR().join('arena', 'np1234', { onPeer(){}, onMessage: m => { if (!npB.v.handle(m)) got.push(['B-raw', m.type]); }, onError(){}, onFull(){} });
    npB.v = B.ctx.NetPlay.start(rB, { onMessage: m => got.push(['B', m.k]) });
    await clock.advance(1500);
    A.setSb(sbA);
    await clock.advance(3000);
    ok(got.some(e => e[0] === 'B' && e[1] === 'hello') && sbA.rest === 0, 'NetPlay: сообщение до подписки комнаты дошло напарнику (через очередь, не REST)', [got, sbA.rest]);
    npA.close(); npB.v.close(); rA.leave(); rB.leave();
    await clock.advance(15000);
    ok(clock.pending() === 0 && sbA.chans.length === 0 && sbB.chans.length === 0, 'NetPlay: после выхода таймеров и каналов нет', [clock.pending(), sbA.chans.length]);
  }

  // ═══ 5. «Города», «Крокодил», миры ═══
  {
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js', 'js/games/cities.js');
    const sbA = fakeClient(hub);
    const elA = miniEl(), api = { sfx(){}, toast(){}, report(){} };
    A.ctx.GAME_IMPL.cities.mount(elA, { ...api, param: 'cty123' });
    ok(/Подключаемся к комнате/.test(elA.innerHTML) && !/Нет связи/.test(elA.innerHTML), 'Города по ссылке без sbClient: «Подключаемся к комнате…», не ошибка');
    await clock.advance(1900);
    ok(sbA.created === 0, 'Города: пока клиента нет — канала нет');
    A.setSb(sbA);
    await clock.advance(1500);
    ok(sbA.created === 1 && sbA.chans[0].name === 'cities-duel-cty123' && sbA.chans[0].state === 'joined', 'Города: клиент появился — канал cities-duel-<код> создан и подписан', [sbA.created, sbA.chans[0] && sbA.chans[0].name]);
    ok(/Ждём друга/.test(elA.stubs['#ctLobbyText'] ? elA.stubs['#ctLobbyText'].innerHTML : ''), 'Города: вошли в комнату — «Ждём друга…»', elA.stubs['#ctLobbyText']);
    A.ctx.GAME_IMPL.cities.unmount();
    await clock.advance(15000);
    ok(sbA.chans.length === 0 && sbA.created === sbA.removed && clock.pending() === 0 && sbA.rest === 0, 'Города: после выхода каналов и таймеров нет', [sbA.chans.length, clock.pending(), sbA.rest]);
    // нет связи
    const P = makePage(clock).load('js/games/room.js', 'js/games/cities.js'), el = miniEl();
    P.ctx.GAME_IMPL.cities.mount(el, { ...api, param: 'cty999' });
    await clock.advance(7500);
    ok(!/Нет связи/.test(el.innerHTML) && !(el.stubs['#ctLobbyText'] && /Нет связи/.test(el.stubs['#ctLobbyText'].innerHTML)), 'Города без сети: до 8 с ошибки нет');
    await clock.advance(1000);
    const msg = el.stubs['#ctLobbyText'] ? el.stubs['#ctLobbyText'].innerHTML : '';
    ok(/Нет связи/.test(msg) && /location\.reload\(\)/.test(msg) && /ещё раз/.test(msg), 'Города без сети 8 с: «Нет связи… попробуй ещё раз» и кнопка', msg);
    P.ctx.GAME_IMPL.cities.unmount();
    ok(clock.pending() === 0, 'Города без сети: после выхода таймеров нет', clock.pending());
    // 20 входов-выходов
    const hub2 = makeHub(clock), P2 = makePage(clock).load('js/games/room.js', 'js/games/cities.js'), sb2 = fakeClient(hub2); P2.setSb(sb2);
    for (let i = 0; i < 20; i++) { P2.ctx.GAME_IMPL.cities.mount(miniEl(), { ...api, param: 'ct' + String(1000 + i) }); await clock.advance(i % 2 ? 40 : 150); P2.ctx.GAME_IMPL.cities.unmount(); }
    await clock.advance(5000);
    ok(sb2.chans.length === 0 && sb2.created === sb2.removed && sb2.created === 20 && clock.pending() === 0, `Города: 20 входов/выходов — каналов создано ${sb2.created}, осталось ${sb2.chans.length}`, [sb2.created, sb2.removed, sb2.chans.length, clock.pending()]);
    ok(clock.errors.length === 0, 'Города: в таймерах ошибок нет', clock.errors.map(e => String(e && e.stack || e).slice(0, 200)));
  }
  {
    // «Крокодил»: транспорт и комната компании
    const clock = makeClock(), hub = makeHub(clock);
    const A = makePage(clock).load('js/games/room.js', 'js/games/krokodil.js'), B = makePage(clock).load('js/games/room.js', 'js/games/krokodil.js');
    const sbA = fakeClient(hub), sbB = fakeClient(hub); B.setSb(sbB);
    const KA = A.ctx.GAME_IMPL.krokodil._test, KB = B.ctx.GAME_IMPL.krokodil._test;
    const mk = (K, key, nick, log) => K.createRoom({ open: K.supaTransport, game: 'krokodil', code: 'kr1234', max: 10, me: { key, nick }, net: null, subtle: null,
      onState: R => log.push(['state', R.players.length, R.isHost]), onMsg: (from, m, how) => log.push(['msg', m.t, how]), onError: r => log.push(['err', r]), onMode(){} });
    const logA = [], logB = [];
    const RA = mk(KA, 'ka', 'Алиса', logA);
    await clock.advance(400);
    const RB = mk(KB, 'kb', 'Боря', logB);
    await clock.advance(1600);
    ok(logA.length === 0, 'Крокодил: пока у хозяина нет sbClient — ни состояния, ни ошибки', logA);
    A.setSb(sbA);
    await clock.advance(5000);
    ok(RA.joined && RB.joined && RA.isHost && !RB.isHost && RA.players.length === 2, 'Крокодил: клиент появился — оба в комнате, хозяин — раньше открывший', [RA.joined, RB.joined, RA.isHost]);
    RA.send({ t: 'hi', n: 1 });
    await clock.advance(300);
    ok(logB.some(e => e[0] === 'msg' && e[1] === 'hi'), 'Крокодил: сообщение хозяина дошло', logB);
    ok(!logA.some(e => e[0] === 'err') && !logB.some(e => e[0] === 'err') && sbA.rest === 0 && sbB.rest === 0, 'Крокодил: ошибок нет, REST не использовался', [logA, logB, sbA.rest, sbB.rest]);
    RA.leave(); RB.leave();
    await clock.advance(20000);
    ok(sbA.chans.length === 0 && sbB.chans.length === 0 && clock.pending() === 0, 'Крокодил: после выхода каналов и таймеров нет', [sbA.chans.length, sbB.chans.length, clock.pending()]);
    // сети нет: ошибка 'offline' раньше 12-секундного таймера комнаты
    const P = makePage(clock).load('js/games/room.js', 'js/games/krokodil.js'), log = [], t0 = clock.t;
    const R = mk(P.ctx.GAME_IMPL.krokodil._test, 'kz', 'Зина', log);
    log.t = () => clock.t - t0;
    await clock.advance(8500);
    ok(log.length === 1 && log[0][0] === 'err' && log[0][1] === 'offline' && R.closed && clock.pending() === 0, 'Крокодил без сети: через 8 с onError("offline") один раз, таймеров нет', [log, R.closed, clock.pending()]);
    // 20 входов-выходов
    const hub2 = makeHub(clock), P2 = makePage(clock).load('js/games/room.js', 'js/games/krokodil.js'), sb2 = fakeClient(hub2); P2.setSb(sb2);
    const K2 = P2.ctx.GAME_IMPL.krokodil._test;
    for (let i = 0; i < 20; i++) {
      const r = K2.createRoom({ open: K2.supaTransport, game: 'krokodil', code: 'kc' + String(1000 + i), max: 10, me: { key: 'kk', nick: 'Я' }, net: null, subtle: null, onState(){}, onMsg(){}, onError(){}, onMode(){} });
      await clock.advance(i % 2 ? 40 : 200);
      r.leave();
    }
    await clock.advance(15000);
    ok(sb2.chans.length === 0 && sb2.created === sb2.removed && sb2.created === 20 && clock.pending() === 0, `Крокодил: 20 входов/выходов — каналов создано ${sb2.created}, осталось ${sb2.chans.length}, таймеров ${clock.pending()}`, [sb2.created, sb2.removed, sb2.chans.length, clock.pending()]);
  }
  {
    // страж: игры не заводят канал мимо GameRoom.channel; миры и io-игры ждут клиента сами
    const left = [];
    for (const f of fs.readdirSync(path.join(SITE, 'js/games')).filter(f => f.endsWith('.js'))) {
      const s = read('js/games/' + f);
      if (/sbClient\s*\.\s*channel\s*\(/.test(s.replace(/\/\/.*$/gm, ''))) left.push(f);
    }
    ok(JSON.stringify(left.sort()) === JSON.stringify(['mir-war.js', 'mir.js', 'room.js', 'world.js']), 'страж: sbClient.channel( только в room.js (GameRoom.channel) и у миров / зоны — остальные игры идут через GameRoom.channel (io-игры — своя очередь, IoKit.supaTransport)', left);
    for (const f of ['mir.js', 'world.js']) {
      const s = read('js/games/' + f), j = s.slice(s.indexOf('async function join('), s.indexOf('async function join(') + 900);
      ok(/GameRoom\??\.whenNet\(/.test(j) && /Нет связи с сервером — проверь интернет/.test(j), `${f}: join() ждёт GameRoom.whenNet и честно пишет «Нет связи…»`);
    }
    const games = read('js/features/games.js');
    for (const id of ['cities', 'unity']) {
      const m = new RegExp(`\\{ id: '${id}'[^\\n]*?scripts: \\[([^\\]]*)\\]`).exec(games);
      ok(m && /js\/games\/room\.js/.test(m[1]) && m[1].indexOf('room.js') < m[1].indexOf(id === 'cities' ? 'cities.js' : 'unity-host.js'), `games.js: у «${id}» room.js грузится раньше файла игры`, m && m[1]);
    }
    for (const id of ['chess', 'domino', 'durak', 'uno', 'ludo', 'nardy']) {
      const m = new RegExp(`\\{ id: '${id}'[^\\n]*?scripts: \\[([^\\]]*)\\]`).exec(games);
      ok(m && m[1].indexOf('room.js') >= 0 && m[1].indexOf('room.js') < m[1].indexOf('table.js'), `games.js: у «${id}» room.js раньше table.js`, m && m[1]);
    }
  }

  // ═══ 6. «Клеточки» / «Червячки», PWA ═══
  for (const [file, id] of [['kletochki.js', 'kletochki'], ['chervyachki.js', 'chervyachki']]) {
    const clock = makeClock(), P = makePage(clock);
    P.load('js/games/iokit.js');
    const K = P.ctx.IoKit || P.ctx.window.IoKit;
    ok(!!K && typeof K.whenNet === 'function', `${id}: IoKit.whenNet есть`);
    // без интернета — false сразу, не из самого вызова
    const off = makePage(clock, { online: false }); off.load('js/games/iokit.js');
    const got = [];
    off.ctx.IoKit.whenNet(v => got.push(v));
    ok(got.length === 0, `${id}: whenNet без интернета — не синхронно`);
    await clock.advance(5);
    ok(got.length === 1 && got[0] === false && clock.pending() === 0, `${id}: whenNet без интернета — сразу false, опроса нет`, [got, clock.pending()]);
    const src = read('js/games/' + file);
    ok(/else if \(pub\) \{ api\.toast\?\.\('📡 Онлайн сейчас недоступен — играем с ботами'\); startBots\(\); \}\s*\n\s*else showOv\(K\.errHtml\('offline'\)\);/.test(src), `${id}: по ссылке друга без связи — «Нет связи» с «Ещё раз», а не тихие боты`);
    ok(/a === 'retry'/.test(src) && /lastOnline/.test(src), `${id}: кнопка «Ещё раз» обработана`);
    const html = P.ctx.IoKit.errHtml('offline');
    ok(/Нет связи/.test(html) && /data-io="retry"/.test(html) && /data-io="bots"/.test(html) && /data-io="menu"/.test(html), `${id}: errHtml('offline') — «Нет связи», «Ещё раз», боты, меню`, html);
    ok(!/data-io="retry"/.test(P.ctx.IoKit.errHtml('full')) && /Комната заполнена/.test(P.ctx.IoKit.errHtml('full')), `${id}: errHtml('full') — без «Ещё раз»`);
  }
  {
    const app = read('js/features/app.js'), off = read('offline.html'), games = read('js/features/games.js');
    const list = /const OFFLINE_GAMES = \[([^\]]*)\]/.exec(app)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
    ok(list.includes('kletochki') && list.includes('chervyachki'), 'PWA: «Клеточки» и «Червячки» в OFFLINE_GAMES', list);
    const ids = [...off.matchAll(/\['([\w]+)', '[^']*', '[^']*', '([\w.-]+\.js)'\]/g)].map(m => [m[1], m[2]]);
    ok(JSON.stringify(ids.map(x => x[0])) === JSON.stringify(list), 'PWA: офлайн-страница = OFFLINE_GAMES (тот же порядок)', [ids.map(x => x[0]), list]);
    ok(ids.some(x => x[0] === 'kletochki' && x[1] === 'kletochki.js') && ids.some(x => x[0] === 'chervyachki' && x[1] === 'chervyachki.js'), 'PWA: офлайн-страница ведёт на файлы kletochki.js и chervyachki.js');
    for (const id of ['kletochki', 'chervyachki']) {
      const m = new RegExp(`\\{ id: '${id}'[^\\n]*?scripts: \\[([^\\]]*)\\]`).exec(games);
      const files = m[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
      ok(files.every(f => fs.existsSync(path.join(SITE, f))), `PWA: файлы «${id}» (${files.length}) существуют — все уйдут в кэш sw.js`, files);
    }
    const ver = +(/const VERSION = 'v(\d+)'/.exec(read('sw.js')) || [])[1];
    ok(ver >= 6, 'sw.js: VERSION поднят (v6+) — приложение предложит обновиться', ver);
    const gv = +(/const GAMES_VER = '(\d+)'/.exec(games) || [])[1];
    ok(gv >= 113, 'GAMES_VER поднят (113+): новые файлы игр не берутся из старого кэша', gv);
  }

  const bad = ALL_CLOCKS.flatMap(c => c.errors);
  ok(bad.length === 0, `во всех таймерах и обработчиках сети ошибок не было (часов: ${ALL_CLOCKS.length})`, bad.map(e => String(e && e.stack || e).slice(0, 300)));
  finished = true;
  console.log(`room-net-test: ${pass} ok, ${fail} fail`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.log('FAIL необработанная ошибка', e && e.stack || e); process.exitCode = 1; });

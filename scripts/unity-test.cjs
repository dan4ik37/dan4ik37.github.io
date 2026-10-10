// Тесты Unity-игр (js/games/unity-host.js + sdk/unity) в node, без браузера и без Unity:
//  1) ссылки на сборку, схема сообщений игры, частота, мост (источник, origin, поток);
//  2) комнаты на подменном Supabase: хост — первый, смена хоста, переполнение, вторая вкладка, сообщения (всем, одному,
//     через хоста), подделка «от кого», лимит через сервер, ранние сообщения; прямая связь (подменный NetPlay) и настоящий
//     netplay.js (в node нет WebRTC — работает через сервер);
//  3) zip SDK; 4) D37Bridge.jslib в подменной среде Emscripten (функции переносятся текстом, как в настоящей сборке);
//  5) сквозная проверка: две «игры» (сообщения собираются из выражений Post(...) настоящего D37.cs) ↔ jslib ↔ настоящая
//     сессия сайта (session) ↔ комната ↔ смена хоста; поля сообщений сайта сверяются с классами D37Wire в D37.cs;
//  6) тестовая страница sdk/unity/TestPage — синтаксис и тот же протокол.
// Запуск из корня сайта: node scripts/unity-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(SITE, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const clone = v => JSON.parse(JSON.stringify(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Окружение страницы сайта (минимум для модуля) ──
const SITE_ORIGIN = 'https://dan4ik37.vercel.app';
const mem = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; } }; };
globalThis.window = globalThis;
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.location = { origin: SITE_ORIGIN, hostname: 'dan4ik37.vercel.app', pathname: '/', href: SITE_ORIGIN + '/' };
const urls = [];
globalThis.history = { replaceState: (a, b, u) => urls.push(u) };
const winListeners = {};
globalThis.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
globalThis.removeEventListener = (t, fn) => { winListeners[t] = (winListeners[t] || []).filter(f => f !== fn); };
vm.runInThisContext(read('js/games/netplay.js'), { filename: 'netplay.js' });
vm.runInThisContext(read('js/games/unity-host.js'), { filename: 'unity-host.js' });
const U = window.GAME_IMPL.unity._test;
ok(typeof window.GAME_IMPL.unity.mount === 'function' && typeof window.GAME_IMPL.unity.unmount === 'function', 'GAME_IMPL.unity: mount/unmount');

// ═══ 1. Ссылка на сборку ═══
{
  const N = (u, o) => U.normUrl(u, o);
  let r = N('https://User.GitHub.io/My-Game/index.html');
  ok(r.url === 'https://user.github.io/My-Game/index.html' && r.origin === 'https://user.github.io', 'имя сайта маленькими, путь как есть', r);
  ok(N('https://html-classic.itch.zone/html/123456/index.html').url === 'https://html-classic.itch.zone/html/123456/index.html', 'itch.io');
  ok(N('  https://example.com  ').url === 'https://example.com/', 'пробелы по краям, пустой путь → /');
  ok(N('https://example.com?v=2').url === 'https://example.com/?v=2', 'только параметры → /?…');
  ok(/^https:\/\/xn--/.test(N('https://игры.рф/game/').url || ''), 'русский домен → punycode', N('https://игры.рф/game/'));
  ok(N('https://example.com/моя игра/').url === 'https://example.com/%D0%BC%D0%BE%D1%8F%20%D0%B8%D0%B3%D1%80%D0%B0/', 'кириллица и пробел в пути — %-коды');
  for (const [u, why] of [['http://example.com/', 'http'], ['javascript:alert(1)', 'bad'], ['data:text/html,<b>x</b>', 'bad'], ['blob:https://e.com/1', 'bad'],
    ['https://1.2.3.4/game/', 'host'], ['https://example.com:8443/', 'port'], ['https://user:pw@example.com/', 'login'], ['https://dan4ik37.vercel.app/x.html', 'own'],
    ['https://DAN4IK37.github.io/', 'own'], ['https://abc.supabase.co/storage/x.html', 'own'], ['https://localhost/', 'host'], ['https://example.com/#top', 'hash'],
    ['https://example.com./', 'host'], ['https://-bad.com/', 'host'], ['https://exa_mple.com/', 'host'], ['https://example.com/a|b', 'chars'], ['https://example.com/?q={x}', 'chars'],
    ['https://example.com/' + 'a'.repeat(290), 'long'], ['', 'empty'], ['не ссылка', 'bad']])
    ok(N(u).reason === why, `отказ (${why}): ${u.slice(0, 40)}`, N(u));
  ok(N('https://e.com/', { own: 'https://e.com' }).reason === 'own', 'адрес текущего сайта — отказ');
  // проверка у себя: сайт на localhost — можно http://localhost:порт, но не адрес самого сайта
  r = N('http://localhost:5600/index.html', { dev: true, own: 'http://localhost:5500' });
  ok(r.url === 'http://localhost:5600/index.html' && r.origin === 'http://localhost:5600' && r.dev, 'localhost в режиме проверки', r);
  ok(N('http://localhost:5500/sdk/unity/TestPage/index.html', { dev: true, own: 'http://localhost:5500' }).reason === 'own', 'localhost: тот же адрес, что у сайта — отказ');
  ok(N('http://localhost:5600/index.html').reason === 'http', 'localhost без режима проверки — отказ');
  // то, что пропускает сайт, пропустит и unity_url() на сервере (то же правило, переписанное с SQL)
  const SQL = /^https:\/\/([A-Za-z0-9.-]+)([/?][^\s\x00-\x1f\x7f"'<>\\`^{}|#]*)?$/i;
  for (const u of ['https://User.GitHub.io/My-Game/index.html', 'https://example.com?v=2', 'https://игры.рф/game/', 'https://example.com/моя игра/', 'https://example.com/a\\b'])
    { const x = N(u); ok(!x.url || (SQL.test(x.url) && x.url.length <= 300), 'сайт и сервер согласны: ' + u, x); }
}

// ═══ 2. Схема сообщений игры ═══
{
  const C = d => U.cleanIn(d);
  const m = (t, x) => ({ d37u: 1, t, ...x });
  ok(JSON.stringify(C(m('hello', { sdk: '1.0.0', unity: '2022.3.10f1', evil: 'x' }))) === '{"t":"hello","sdk":"1.0.0","unity":"2022.3.10f1"}', 'hello: лишние поля отброшены');
  ok(C(m('score', { n: 3.7 })).n === 4 && C(m('score', { n: -5 })).n === 0 && C(m('score', { n: 1e12 })).n === 1e9, 'score: округление и пределы');
  ok(C(m('score', { n: '5' })) === null && C(m('score', { n: NaN })) === null && C(m('score', { n: Infinity })) === null && C(m('score', {})) === null, 'score: не число — отказ');
  let o = C(m('over', { n: 5, win: true, coins: 99 }));
  ok(o.n === 5 && o.win === true && o.coins === 50, 'over: монеты не больше 50', o);
  o = C(m('over', { n: 5, win: 'yes', coins: -3 }));
  ok(o.win === false && o.coins === 0, 'over: win только true, монеты не меньше 0', o);
  const nl = String.fromCharCode(10), ls = String.fromCharCode(0x2028);
  ok(C(m('toast', { text: '  при' + nl + 'вет' + ls + '<b>  ' })).text === 'привет<b>', 'toast: управляющие символы вырезаны (HTML экранирует тост сам)', C(m('toast', { text: '  при' + nl + 'вет' + ls + '<b>  ' })));
  ok(C(m('toast', { text: 'x'.repeat(200) })).text.length === 140 && C(m('toast', { text: '   ' })) === null && C(m('toast', { text: 'x'.repeat(10000) })) === null, 'toast: до 140 знаков, пустой и огромный — отказ');
  ok(C(m('room.join', { code: 'abc123' })).code === 'abc123' && C(m('room.join', { code: 'ABC123' })) === null && C(m('room.join', { code: 'ab' })) === null && C(m('room.join', { code: 'a b c d' })) === null, 'room.join: код 4–12 [a-z0-9]');
  ok(C(m('room.create', {})) && C(m('room.leave', {})), 'room.create / room.leave');
  let s = C(m('room.send', { to: '', type: 'move.x:1-2_3', data: '{"a":1}', rel: false }));
  ok(s && s.to === '' && s.type === 'move.x:1-2_3' && s.data === '{"a":1}' && s.rel === false, 'room.send: всем, ненадёжно', s);
  ok(C(m('room.send', { to: 'p1abc', type: 'x', data: 'y'.repeat(8192) })).data.length === 8192, 'room.send: 8192 знака — можно');
  ok(C(m('room.send', { to: '', type: 'x', data: 'y'.repeat(8193) })) === null, 'room.send: 8193 знака — отказ');
  ok(C(m('room.send', { type: 'плохой', data: '' })) === null && C(m('room.send', { type: 'x'.repeat(33), data: '' })) === null && C(m('room.send', { data: '' })) === null, 'room.send: тип — латиница до 32');
  ok(C(m('room.send', { to: 'P1', type: 'x', data: '' })) === null && C(m('room.send', { to: { id: 1 }, type: 'x' })) === null && C(m('room.send', { type: 'x', data: { a: 1 } })) === null, 'room.send: кому — номер, данные — строка');
  ok(C(m('room.send', { type: 'x' })).rel === true && C(m('room.send', { type: 'x' })).data === '', 'room.send: по умолчанию надёжно, данные пустые');
  for (const bad of [null, undefined, 5, 'str', [], [m('score', { n: 1 })], { t: 'score', n: 1 }, { d37u: 2, t: 'score', n: 1 }, { d37u: '1', t: 'score', n: 1 },
    m('init', {}), m('result', {}), m('__proto__', {}), m('constructor', {}), m('toString', {}), m('hasOwnProperty', {}), { d37u: 1, t: 5 }])
    ok(C(bad) === null, 'отказ: ' + JSON.stringify(bad));
  ok(U.IN_TYPES.join() === 'hello,score,over,toast,log,room.create,room.join,room.leave,room.send', 'типы игра → сайт', U.IN_TYPES);
}

// ═══ Частота ═══
{
  let t = 0;
  const L = U.limiter({ a: [2, 3] }, () => t);
  ok([1, 2, 3].every(() => L.allow('a')) && !L.allow('a'), 'запас 3, четвёртое — нет');
  t = 500; ok(L.allow('a') && !L.allow('a'), 'через 0,5 с при 2/с — ещё одно');
  t = 60000; ok([1, 2, 3].every(() => L.allow('a')) && !L.allow('a'), 'после паузы — снова только запас, не больше');
  ok(L.allow('нет-такого') && L.allow('нет-такого'), 'без правила — без лимита');
  t = 59000; ok(!L.allow('a'), 'время назад — ничего не прибавилось');
  const F = U.limiter(() => [1, 2], () => t);
  ok(F.allow('x') && F.allow('x') && !F.allow('x') && F.allow('y'), 'одно правило на все ключи (функция)');
  for (let i = 0; i < 70; i++) F.allow('k' + i);
  ok(F.allow('x') && F.allow('x'), 'больше 64 ключей — вёдра заново (память не растёт)');
}

// ═══ Мост с iframe ═══
{
  let t = 1000;
  const W = { got: [], postMessage(msg, target){ this.got.push({ msg: clone(msg), target }); } }, O = {};
  const wrong = [], limited = [];
  const B = U.createBridge({ win: () => W, origin: 'https://game.example', now: () => t, onWrongOrigin: o => wrong.push(o), onLimited: k => limited.push(k) });
  const ev = (data, source = W, origin = 'https://game.example') => B.accept({ source, origin, data });
  ok(ev({ d37u: 1, t: 'hello', sdk: '1' }, O) === null, 'чужое окно — не принимаем');
  ok(ev({ d37u: 1, t: 'hello', sdk: '1' }, W, 'https://evil.example') === null && wrong[0] === 'https://evil.example', 'наш iframe, но другой адрес (увели) — не принимаем');
  ok(ev({ d37u: 1, t: 'hello', sdk: '1' }).t === 'hello', 'наш iframe и адрес сборки — принимаем');
  ok(ev({ d37u: 1, t: 'hello' }) && ev({ d37u: 1, t: 'hello' }) === null && limited.includes('hello'), 'hello: не чаще (запас 2)');
  let n = 0; for (let i = 0; i < 25; i++) if (ev({ d37u: 1, t: 'score', n: i })) n++;
  ok(n === 20 && limited.includes('score'), 'score: запас 20 за раз', n);
  t += 1000;
  n = 0; for (let i = 0; i < 200; i++) if (ev({ d37u: 1, t: 'room.send', type: 'x', data: '' })) n++;
  ok(n === 60, 'room.send: запас 60 за раз', n);
  t += 1000;
  n = 0; for (let i = 0; i < 200; i++) if (ev({ d37u: 1, t: 'nope' }) !== null) n++;
  ok(n === 0 && ev({ d37u: 1, t: 'score', n: 1 }) === null, 'больше 120 сообщений в секунду — дальше не разбираем вовсе');
  t += 1000;
  ok(ev({ d37u: 1, t: 'score', n: 1 }) !== null, 'через секунду — снова принимаем');
  ok(B.send({ t: 'init', v: 1 }) && W.got[0].target === 'https://game.example' && W.got[0].msg.d37u === 1 && W.got[0].msg.t === 'init', 'игре — только на адрес сборки, с меткой d37u');
  const B2 = U.createBridge({ win: () => null, origin: 'https://game.example' });
  ok(B2.send({ t: 'init' }) === false && B2.accept({ source: null, origin: 'https://game.example', data: { d37u: 1, t: 'hello' } }) === null, 'iframe нет — ничего не шлём и не принимаем');
  ok(U.SANDBOX === 'allow-scripts allow-same-origin allow-pointer-lock' && !/top-navigation|popups|forms|modals|downloads/.test(U.SANDBOX), 'песочница: без переходов наверх, окон, форм, alert, скачиваний');
  ok(U.ALLOW === 'fullscreen; autoplay; gamepad', 'allow: весь экран, звук, геймпад');
  const cross = { get contentWindow(){ return { get location(){ throw new Error('SecurityError'); } }; } };
  const same = { contentWindow: { location: { href: SITE_ORIGIN + '/evil' } } }, blank = { contentWindow: { location: { href: 'about:blank' } } };
  ok(!U.sameOriginFrame(cross) && U.sameOriginFrame(same) && !U.sameOriginFrame(blank), 'проверка после загрузки: свой адрес в iframe ловится');
}

// ═══ 3. Комнаты на подменном Supabase ═══
function makeHub(){
  const chans = new Map(), queue = [];
  const H = { sent: 0, queue };
  const state = ch => { const s = {}; for (const c of ch.conns) if (c.meta) (s[c.key] = s[c.key] || []).push({ ...c.meta, presence_ref: 'r' + c.n }); return s; };
  const syncAll = ch => { for (const c of [...ch.conns]) queue.push(() => { if (!c.closed) c.onSync?.(state(ch)); }); };
  let n = 0;
  H.open = (name, key) => {
    const ch = chans.get(name) || { conns: new Set() };
    chans.set(name, ch);
    const T = { name, key, n: ++n, meta: null, closed: false, onStatus: null, onSync: null, onMsg: null };
    ch.conns.add(T);
    T.track = meta => { T.meta = clone(meta); syncAll(ch); return Promise.resolve('ok'); };
    T.send = p => { H.sent++; const data = clone(p); for (const c of ch.conns) if (c !== T && !c.closed) queue.push(() => { if (!c.closed) c.onMsg?.(clone(data)); }); };
    T.close = () => { if (T.closed) return; T.closed = true; ch.conns.delete(T); syncAll(ch); };
    queue.push(() => { if (!T.closed) T.onStatus?.('SUBSCRIBED'); });
    return T;
  };
  H.raw = (name, payload) => { const ch = chans.get(name); for (const c of ch.conns) queue.push(() => c.onMsg?.(clone(payload))); };
  H.flush = () => { let i = 0; while (queue.length && i++ < 100000) queue.shift()(); };
  return H;
}
function makeClock(hub){
  const C = { t: 1000, timers: [], id: 0 };
  C.now = () => C.t;
  C.setT = (fn, ms) => { const id = ++C.id; C.timers.push({ id, at: C.t + (ms || 0), fn }); return id; };
  C.clearT = id => { C.timers = C.timers.filter(x => x.id !== id); };
  C.run = ms => {
    const end = C.t + ms;
    for (let guard = 0; guard < 10000; guard++) {
      hub.flush();
      const due = C.timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      C.t = Math.max(C.t, due.at);
      C.timers = C.timers.filter(x => x !== due);
      due.fn();
    }
    C.t = end;
    hub.flush();
  };
  return C;
}
// Подменная прямая связь: соединяются ссылки хоста и гостя одного канала, данные — сразу в очередь
function makeFakeNet(hub){
  const reg = new Map(), F = { sent: 0 };
  F.start = (vroom, hooks) => {
    const id = `${vroom.channel}|${vroom.self}|${vroom.peer}`, back = `${vroom.channel}|${vroom.peer}|${vroom.self}`;
    const L = { mode: 'connecting', hooks, closed: false };
    reg.set(id, L);
    const link = (m) => { L.mode = m; hooks.onMode?.(m); };
    L.connect = () => { const o = reg.get(back); if (o && !o.closed) { link('p2p'); o.mode = 'p2p'; o.hooks.onMode?.('p2p'); } };
    return {
      mode: () => L.mode,
      offer(){ L.connect(); },
      handle(){ return false; },
      send(msg){ if (L.mode !== 'p2p') return; F.sent++; const o = reg.get(back); const data = clone(msg); hub.queue.push(() => { if (o && !o.closed) o.hooks.onMessage(clone(data)); }); },
      close(){ L.closed = true; reg.delete(id); const o = reg.get(back); if (o) { o.mode = 'relay'; o.hooks.onMode?.('relay'); } },
    };
  };
  F.break = (a, b, ch) => { for (const [k, L] of reg) if (k === `${ch}|${a}|${b}` || k === `${ch}|${b}|${a}`) L.mode = 'relay'; };
  return F;
}
function client(hub, clock, key, nick, opt = {}){
  const c = { key, states: [], msgs: [], errors: [] };
  c.R = U.createRoom({ open: hub.open, game: opt.game || 'g1', code: opt.code || 'room01', max: opt.max || 4, me: { key, nick, guest: key.startsWith('g-') }, net: opt.net || null,
    now: clock.now, setT: clock.setT, clearT: clock.clearT,
    onState: s => c.states.push(s), onMessage: (from, ty, d) => c.msgs.push({ from, ty, d }), onError: r => c.errors.push(r), onMode: () => {} });
  c.last = () => c.states[c.states.length - 1] || null;
  c.got = ty => c.msgs.filter(m => m.ty === ty);
  return c;
}
{
  const hub = makeHub(), clock = makeClock(hub);
  const A = client(hub, clock, 'uuid-a', 'Аня');
  clock.run(50);
  ok(A.R.joined && A.R.isHost && A.last()?.players.length === 1 && A.last().host === A.R.me, 'первый в комнате — хост');
  ok(/^p[a-z0-9]{6,14}$/.test(A.R.me) && A.last().players[0].uid === U.uidOf('uuid-a', 'g1') && A.last().players[0].uid[0] === 'u', 'номер в комнате и постоянный номер — без id аккаунта', A.last());
  clock.run(100);
  const B = client(hub, clock, 'g-guestb', 'Гость Б');
  clock.run(50);
  ok(B.R.joined && !B.R.isHost && B.last()?.host === A.R.me && B.last().players.map(p => p.nick).join() === 'Аня,Гость Б', 'второй — гость, хост — первый');
  ok(B.last().players[1].guest === true && B.last().players[1].uid[0] === 'g', 'гость помечен');
  ok(A.last().players.length === 1, 'хосту новичка объявляем не сразу (сервер первые доли секунды ему не доставляет)');
  clock.run(800);
  ok(A.last().players.length === 2, 'через 0,8 с — новичок в списке у хоста');
  clock.run(100);
  const C = client(hub, clock, 'uuid-c', 'Вова');
  clock.run(900);
  ok([A, B, C].every(x => x.last().host === A.R.me && x.last().players.length === 3), 'все видят троих и одного хоста');
  ok(C.last().players.find(p => p.me).id === C.R.me && C.last().players.filter(p => p.host).length === 1, 'me и host в списке');

  // ── сообщения через сервер ──
  A.R.send('', 'chat', 'всем');
  clock.run(10);
  ok(B.got('chat')[0]?.from === A.R.me && C.got('chat')[0]?.d === 'всем' && A.got('chat').length === 0, 'хост → всем (себе не приходит)');
  B.R.send(A.R.me, 'move', 'x');
  clock.run(10);
  ok(A.got('move')[0]?.from === B.R.me && C.got('move').length === 0, 'гость → хосту: только хосту');
  B.R.send('', 'b', '1');
  clock.run(10);
  ok(A.got('b')[0]?.from === B.R.me && C.got('b')[0]?.from === B.R.me, 'гость → всем');
  C.R.send(B.R.me, 'pm', '2');
  clock.run(10);
  ok(B.got('pm')[0]?.from === C.R.me && A.got('pm').length === 0, 'гость → гостю');
  ok(A.R.send(A.R.me, 'x', '') === 'self' && A.R.send('pnobody', 'x', '') === 'nobody', 'себе и несуществующему — не шлём');
  // подделки
  const ch = 'unity-g1-room01';
  hub.raw(ch, { k: 'u', ty: 'fake', d: '1', _by: B.R.me, from: A.R.me });
  clock.run(10);
  ok(C.got('fake')[0]?.from === B.R.me, '«от кого» за другого может сказать только хост');
  hub.raw(ch, { k: 'u', ty: 'big', d: 'x'.repeat(9000), _by: B.R.me });
  hub.raw(ch, { k: 'u', ty: 'плохой', d: '1', _by: B.R.me });
  hub.raw(ch, { k: 'u', ty: 'obj', d: { a: 1 }, _by: B.R.me });
  hub.raw(ch, { k: 'u', ty: 'noby', d: '1' });
  hub.raw(ch, { k: 'u', ty: 'badby', d: '1', _by: 'P<script>' });
  hub.raw(ch, { k: 'u', ty: 'only', d: '1', _by: B.R.me, only: [A.R.me] });
  hub.raw(ch, { k: 'u', ty: 'onlybad', d: '1', _by: B.R.me, only: 'все' });
  clock.run(10);
  ok(!C.got('big').length && !C.got('плохой').length && !C.got('obj').length && !C.got('noby').length && !C.got('badby').length, 'чужие кривые сообщения отброшены');
  ok(A.got('only').length === 1 && C.got('only').length === 0 && !A.got('onlybad').length && !C.got('onlybad').length, 'список «only» — только им');
  // чужой клиент мимо сайта заваливает канал — игре от одного отправителя не больше запаса INBOX
  clock.run(3000);
  for (let i = 0; i < 300; i++) hub.raw(ch, { k: 'u', ty: 'flood', d: String(i), _by: B.R.me });
  clock.run(10);
  ok(C.got('flood').length === U.INBOX[1], 'поток от одного игрока — игре не больше запаса', C.got('flood').length);
  // лимит через сервер: 5 в секунду, запас 10 (сначала пауза — запас полный)
  clock.run(3000);
  const res = []; for (let i = 0; i < 25; i++) res.push(A.R.send('', 'spam', String(i), false));
  ok(res.filter(r => r === 'ok').length === 10 && res[24] === 'rate', 'через сервер — запас 10, дальше rate', res.join());
  clock.run(1000);
  ok(A.R.send('', 'spam', 'x') === 'ok', 'через секунду — снова можно');
  // ранние сообщения: отправитель ещё не в списке — ждём его до 3 с
  const lateT = clock.t + 5, lateId = U.pid('uuid-late', lateT);
  hub.raw(ch, { k: 'u', ty: 'early', d: '1', _by: lateId });
  hub.raw(ch, { k: 'u', ty: 'ghost', d: '1', _by: U.pid('uuid-ghost', 1) });
  clock.run(5);
  ok(!A.got('early').length, 'от незнакомого — пока не отдаём');
  const L = client(hub, clock, 'uuid-late', 'Поздний');
  clock.run(900);
  ok(A.got('early')[0]?.from === lateId && A.last().players.some(p => p.id === lateId), 'отправитель появился — сообщение отдано после списка');
  clock.run(3000);
  hub.raw(ch, { k: 'u', ty: 'tick', d: '1', _by: B.R.me });
  clock.run(10);
  ok(!A.got('ghost').length, 'от того, кто так и не пришёл, — выброшено через 3 с');
  L.R.leave(); clock.run(50);

  // ── смена хоста ──
  const statesB = B.states.length;
  A.R.leave();
  clock.run(50);
  ok(B.R.isHost && !C.R.isHost && B.last().host === B.R.me && C.last().host === B.R.me, 'хост ушёл — хост следующий по времени входа');
  ok(B.states.length > statesB && B.last().players.length === 2, 'смена хоста объявлена сразу');
  const D = client(hub, clock, 'uuid-d', 'Даша');
  clock.run(900);
  ok([B, C, D].every(x => x.last().host === B.R.me), 'новичок после смены хоста — хост не меняется');
  B.R.send('', 'after', '1');
  clock.run(10);
  ok(C.got('after').length === 1 && D.got('after').length === 1 && A.got('after').length === 0, 'ушедшему больше ничего не приходит');
  [B, C, D].forEach(x => x.R.leave());
  clock.run(10);
}
{
  // переполнение и вторая вкладка той же учётки
  const hub = makeHub(), clock = makeClock(hub);
  const P = [];
  for (const k of ['u1', 'u2', 'u3', 'u4']) { P.push(client(hub, clock, 'uuid-' + k, k, { max: 3, code: 'full01' })); clock.run(900); }
  ok(P[3].errors[0] === 'full' && P[3].R.closed && P.slice(0, 3).every(x => x.last().players.length === 3), 'четвёртый в комнату на троих — «занята», у остальных его нет');
  const E1 = client(hub, clock, 'uuid-same', 'Таб1', { code: 'dup001' });
  clock.run(900);
  const E2 = client(hub, clock, 'uuid-same', 'Таб2', { code: 'dup001' });
  clock.run(900);
  ok(E1.errors[0] === 'dup' && E1.R.closed && E2.R.joined && E2.last().players.length === 1, 'та же учётка из второй вкладки — первая уступает');
  const G = client(hub, clock, 'uuid-sub', 'Нет связи', { code: 'off001', game: 'g2' });
  hub.queue.length = 0;   // сервер не ответил на подписку
  clock.run(13000);
  ok(G.errors[0] === 'offline' && G.R.closed, 'нет ответа сервера за 12 с — offline');
  [...P, E2].forEach(x => x.R.leave());
}
{
  // прямая связь (подменный NetPlay): хост ↔ гости напрямую, гость → всем через хоста, сервер не тратится
  const hub = makeHub(), clock = makeClock(hub), net = makeFakeNet(hub);
  const A = client(hub, clock, 'uuid-a', 'Аня', { net, code: 'p2p001' });
  clock.run(100);
  const B = client(hub, clock, 'uuid-b', 'Боря', { net, code: 'p2p001' });
  clock.run(100);
  const C = client(hub, clock, 'uuid-c', 'Вера', { net, code: 'p2p001' });
  clock.run(2000);
  ok(A.R.modes().length === 2 && A.R.modes().every(m => m === 'p2p') && B.R.modes().join() === 'p2p' && C.R.modes().join() === 'p2p', 'звезда: хост напрямую с каждым гостем', [A.R.modes(), B.R.modes(), C.R.modes()]);
  const s0 = hub.sent;
  A.R.send('', 'x', '1'); clock.run(10);
  ok(B.got('x')[0]?.from === A.R.me && C.got('x')[0]?.from === A.R.me && hub.sent === s0, 'хост → всем напрямую, сервер не тратится');
  B.R.send('', 'y', '2'); clock.run(10);
  ok(A.got('y')[0]?.from === B.R.me && C.got('y')[0]?.from === B.R.me && hub.sent === s0, 'гость → всем: через хоста напрямую, «от кого» сохранено');
  B.R.send(C.R.me, 'z', '3'); clock.run(10);
  ok(C.got('z')[0]?.from === B.R.me && A.got('z').length === 0 && hub.sent === s0, 'гость → гостю через хоста (хосту не показывается)');
  C.R.send(A.R.me, 'w', '4', false); clock.run(10);
  ok(A.got('w')[0]?.from === C.R.me && hub.sent === s0, 'гость → хосту напрямую (ненадёжно)');
  net.break(A.R.me, C.R.me, 'unity-g1-p2p001');
  A.R.send('', 'mix', '5'); clock.run(10);
  ok(B.got('mix').length === 1 && C.got('mix').length === 1 && hub.sent === s0 + 1, 'у одного гостя нет прямой связи — ему одно сообщение через сервер');
  B.R.send('', 'mix2', '6'); clock.run(10);
  ok(A.got('mix2').length === 1 && C.got('mix2')[0]?.from === B.R.me && hub.sent === s0 + 2, 'пересылка хоста гостю без прямой связи — через сервер, «от кого» сохранено');
  A.R.leave();
  clock.run(1000);
  ok(B.R.isHost && B.R.modes().join() === 'p2p' && C.R.modes().join() === 'p2p', 'смена хоста: новый хост заново соединился с гостем', [B.R.modes(), C.R.modes()]);
  const s1 = hub.sent;
  C.R.send('', 'q', '7'); clock.run(10);
  ok(B.got('q')[0]?.from === C.R.me && hub.sent === s1, 'после смены хоста — снова напрямую');
  [B, C].forEach(x => x.R.leave());
}
{
  // настоящий netplay.js: в node нет WebRTC — связь «relay», сообщения идут через сервер
  const hub = makeHub(), clock = makeClock(hub);
  const A = client(hub, clock, 'uuid-a', 'Аня', { net: window.NetPlay, code: 'np0001' });
  clock.run(100);
  const B = client(hub, clock, 'uuid-b', 'Боря', { net: window.NetPlay, code: 'np0001' });
  clock.run(1500);
  ok(A.R._links.size === 1 && B.R._links.size === 1 && A.R.modes()[0] === 'relay', 'netplay.js: ссылки созданы, без WebRTC — relay', A.R.modes());
  A.R.send('', 'hi', '1'); B.R.send(A.R.me, 'yo', '2'); clock.run(10);
  ok(B.got('hi')[0]?.from === A.R.me && A.got('yo')[0]?.from === B.R.me, 'netplay.js в relay: сообщения доходят через сервер');
  A.R.leave(); B.R.leave();
}

// ═══ 4. Zip SDK ═══
{
  const enc = new TextEncoder();
  const files = [{ name: 'D37SDK/README.md', data: enc.encode('# Привет\n') }, { name: 'D37SDK/Runtime/D37.cs', data: Uint8Array.from({ length: 300 }, (_, i) => i & 255) }];
  const z = Buffer.from(U.zip(files));
  const crc = u8 => { let c, x = 0xFFFFFFFF; for (const b of u8) { c = (x ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; x = (x >>> 8) ^ c; } return (x ^ 0xFFFFFFFF) >>> 0; };
  ok(U.crc32(enc.encode('123456789')) === 0xCBF43926, 'crc32 эталон');
  const eocd = z.length - 22;
  ok(z.readUInt32LE(eocd) === 0x06054b50 && z.readUInt16LE(eocd + 10) === 2, 'zip: конец каталога, 2 файла');
  let p = z.readUInt32LE(eocd + 16), okAll = true;
  for (const f of files) {
    if (z.readUInt32LE(p) !== 0x02014b50) okAll = false;
    const nl = z.readUInt16LE(p + 28), off = z.readUInt32LE(p + 42), name = z.slice(p + 46, p + 46 + nl).toString('utf8');
    const lnl = z.readUInt16LE(off + 26), data = z.slice(off + 30 + lnl, off + 30 + lnl + z.readUInt32LE(off + 18));
    if (z.readUInt32LE(off) !== 0x04034b50 || name !== f.name || z.readUInt32LE(off + 14) !== crc(f.data) || !data.equals(Buffer.from(f.data)) || (z.readUInt16LE(off + 6) & 0x800) === 0) okAll = false;
    p += 46 + nl;
  }
  ok(okAll, 'zip: заголовки, имена UTF-8, CRC и данные сходятся');
  try {
    const py = require('child_process').spawnSync('python', ['-c', 'import zipfile,sys,io; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); print(z.testzip() is None, len(z.namelist()))'], { input: z, timeout: 20000 });
    if (py.status === 0) ok(String(py.stdout).trim() === 'True 2', 'zip: python zipfile читает архив без ошибок', String(py.stdout));
  } catch (e) {}
  ok(U.SDK_FILES.every(f => fs.existsSync(path.join(SITE, 'sdk/unity', f))), 'все файлы для «Скачать SDK» лежат в sdk/unity', U.SDK_FILES.filter(f => !fs.existsSync(path.join(SITE, 'sdk/unity', f))));
}

// ═══ 5. D37Bridge.jslib в подменной среде Emscripten ═══
const JSLIB = read('sdk/unity/Plugins/WebGL/D37Bridge.jslib');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
function loadLib(){
  const sb = { LibraryManager: { library: {} } };
  sb.mergeInto = (target, lib) => Object.assign(target, lib);
  sb.autoAddDeps = (lib, dep) => { for (const k of Object.keys(lib)) if (typeof lib[k] === 'function' && k[0] !== '$') { const d = k + '__deps'; lib[d] = (lib[d] || []).concat([dep]); } };
  vm.runInNewContext(JSLIB, sb, { filename: 'D37Bridge.jslib' });
  return sb.LibraryManager.library;
}
// как Emscripten: объекты библиотеки и функции переносятся в сборку текстом (без замыканий файла jslib)
const stringifyWithFunctions = o => typeof o === 'function' ? o.toString() : Array.isArray(o) ? '[' + o.map(stringifyWithFunctions).join(',') + ']'
  : o && typeof o === 'object' ? '{' + Object.keys(o).map(k => JSON.stringify(k) + ':' + stringifyWithFunctions(o[k])).join(',') + '}' : JSON.stringify(o);
function buildModule(lib, env){
  const names = Object.keys(lib).filter(k => k[0] !== '$' && !k.endsWith('__deps') && typeof lib[k] === 'function');
  const code = Object.keys(lib).filter(k => k[0] === '$').map(k => 'var ' + k.slice(1) + ' = ' + stringifyWithFunctions(lib[k]) + ';').join('\n') + '\n'
    + names.map(k => 'var _' + k + ' = ' + lib[k].toString() + ';').join('\n') + '\n({ ' + names.map(k => k + ': _' + k).join(', ') + ' })';
  return vm.runInNewContext(code, env, { filename: 'framework.js' });
}
function heapEnv(){
  const heap = new Map(), E = { mallocs: [], frees: 0 };
  let next = 8;
  E.ptr = s => { const p = next; next += 8; heap.set(p, s); return p; };
  E.str = p => heap.get(p);
  E.env = {
    console: { warn(){}, log(){} }, JSON, URL,
    UTF8ToString: p => { if (!heap.has(p)) throw new Error('bad ptr ' + p); return heap.get(p); },
    lengthBytesUTF8: s => Buffer.byteLength(s, 'utf8'),
    _malloc: n => { const p = next; next += 8; heap.set(p, null); E.mallocs.push(n); return p; },
    stringToUTF8: (s, p, max) => { if (Buffer.byteLength(s, 'utf8') + 1 > max) throw new Error('мало места'); heap.set(p, s); },
    _free: () => { E.frees++; },
  };
  return E;
}
// «окно игры» внутри iframe: parent — страница сайта; post() родителю записывается
function gameWindow(o = {}){
  const parentWin = { posted: [], postMessage(msg, target){ this.posted.push({ msg: clone(msg), target }); } };
  const w = { listeners: [], location: { href: o.href || 'https://me.github.io/game/index.html', ancestorOrigins: o.ancestors || null }, addEventListener(t, fn){ if (t === 'message') this.listeners.push(fn); } };
  w.parent = o.alone ? w : parentWin;
  return { w, parentWin, doc: { referrer: o.referrer ?? SITE_ORIGIN + '/' } };
}
{
  const code = stripComments(JSLIB);
  ok(!/=>|\blet\s|\bconst\s|`|\bclass\s|\.\.\./.test(code), 'jslib: только ES5 (var, function)');
  ok(!/postMessage\([^)]*['"]\*['"]\s*\)/.test(code), 'jslib: никогда не шлёт на «*»');
  const lib = loadLib();
  ok(['D37_Init', 'D37_Post', 'D37_IsEmbedded', 'D37_PageInfo'].every(k => typeof lib[k] === 'function' && lib[k + '__deps']?.includes('$D37B')), 'jslib: функции и зависимость $D37B (autoAddDeps)');
  ok(typeof lib.$D37B === 'object' && !Object.keys(lib.$D37B).some(k => typeof lib.$D37B[k] === 'function' && !/^function\s*\(/.test(lib.$D37B[k].toString())), 'jslib: методы $D37B — function(…) (сокращённая запись сломала бы перенос текстом)');
  const cs = read('sdk/unity/Runtime/D37.cs');
  for (const k of ['D37_Init', 'D37_Post', 'D37_IsEmbedded', 'D37_PageInfo']) ok(new RegExp('DllImport\\("__Internal"\\)\\]\\s*static extern \\w+ ' + k + '\\(').test(cs), 'D37.cs объявляет ' + k);

  // встроена в сайт
  const H = heapEnv(), G = gameWindow(), sent = [];
  const M = buildModule(lib, { ...H.env, window: G.w, document: G.doc, SendMessage: (o, m, s) => sent.push({ o, m, s }) });
  ok(M.D37_IsEmbedded() === 1, 'jslib: на сайте — embedded');
  ok(M.D37_Init(H.ptr('D37Bridge'), H.ptr('{"sdk":"1.0.0","unity":"2022.3.10f1"}')) === 1, 'jslib: hello отправлен');
  const hellos = G.parentWin.posted.slice();
  ok(hellos.length >= 2 && hellos.every(p => p.msg.t === 'hello' && p.msg.d37u === 1 && p.msg.sdk === '1.0.0' && p.target !== '*'), 'hello — только на адреса сайта', hellos.map(h => h.target));
  ok(hellos[0].target === SITE_ORIGIN && hellos.some(h => h.target === 'https://dan4ik37.github.io'), 'hello: сначала адрес из referrer, затем остальные сайты');
  ok(M.D37_Post(H.ptr('{"t":"score","n":5}')) === 1 && G.parentWin.posted.length === hellos.length, 'до init сообщение ждёт в очереди');
  ok(M.D37_Post(H.ptr('не json')) === 0 && M.D37_Post(H.ptr('[1,2]')) === 0 && M.D37_Post(H.ptr('{"n":1}')) === 0, 'jslib: не JSON / без t — 0');
  const fire = (data, origin = SITE_ORIGIN, source = G.parentWin) => G.w.listeners.forEach(fn => fn({ data, origin, source }));
  fire({ d37u: 1, t: 'init' }, SITE_ORIGIN, {});
  fire({ d37u: 1, t: 'init' }, 'https://evil.example');
  fire({ t: 'init' });
  fire({ d37u: 1, t: 'room.msg' });
  ok(sent.length === 0, 'jslib: чужое окно, чужой адрес, без d37u, не init первым — игнор');
  fire({ d37u: 1, t: 'init', v: 1, player: { id: 'u1', nick: 'Аня' } });
  ok(sent.length === 1 && sent[0].o === 'D37Bridge' && sent[0].m === 'D37Receive' && JSON.parse(sent[0].s).player.nick === 'Аня', 'jslib: init → SendMessage(D37Bridge, D37Receive, json)');
  const flushed = G.parentWin.posted.slice(hellos.length);
  ok(flushed.length === 1 && flushed[0].msg.t === 'score' && flushed[0].target === SITE_ORIGIN, 'после init очередь ушла на адрес сайта');
  fire({ d37u: 1, t: 'room.msg', from: 'p1', type: 'x', data: '1' }, 'https://dan4ik37.github.io');
  ok(sent.length === 1, 'после init — только с адреса, приславшего init');
  M.D37_Post(H.ptr('{"t":"toast","text":"hi"}'));
  ok(G.parentWin.posted.at(-1).target === SITE_ORIGIN && G.parentWin.posted.at(-1).msg.d37u === 1, 'дальше — сразу на адрес сайта');
  const info = JSON.parse(H.str(M.D37_PageInfo()));
  ok(info.site === SITE_ORIGIN && info.embedded === true && H.mallocs.length === 1 && H.mallocs[0] === Buffer.byteLength(JSON.stringify(info)) + 1 && H.frees === 0, 'D37_PageInfo: строка через _malloc + stringToUTF8 (освобождает IL2CPP)', info);
  // отдельно (не на сайте)
  const H2 = heapEnv(), G2 = gameWindow({ alone: true });
  const M2 = buildModule(lib, { ...H2.env, window: G2.w, document: G2.doc, SendMessage(){} });
  ok(M2.D37_IsEmbedded() === 0 && M2.D37_Init(H2.ptr('D37Bridge'), H2.ptr('{}')) === 0 && G2.parentWin.posted.length === 0, 'jslib: открыта отдельно — 0, ничего не шлёт');
  // localhost для проверки + Module.SendMessage, если SendMessage нет
  const H3 = heapEnv(), G3 = gameWindow({ referrer: 'http://localhost:5500/', href: 'http://localhost:5600/index.html' }), sent3 = [];
  const M3 = buildModule(lib, { ...H3.env, window: G3.w, document: G3.doc, Module: { SendMessage: (o, m, s) => sent3.push(s) } });
  M3.D37_Init(H3.ptr('D37Bridge'), H3.ptr('{}'));
  ok(G3.parentWin.posted[0].target === 'http://localhost:5500', 'jslib: сайт на localhost — hello туда');
  G3.w.listeners.forEach(fn => fn({ data: { d37u: 1, t: 'init' }, origin: 'http://localhost:5500', source: G3.parentWin }));
  ok(sent3.length === 1, 'jslib: нет SendMessage — Module.SendMessage');
  const H4 = heapEnv(), G4 = gameWindow({ referrer: '', ancestors: ['https://evil.example'] });
  const M4 = buildModule(lib, { ...H4.env, window: G4.w, document: G4.doc, SendMessage(){} });
  M4.D37_Init(H4.ptr('D37Bridge'), H4.ptr('{}'));
  ok(G4.parentWin.posted.every(p => p.target !== 'https://evil.example') && G4.parentWin.posted.length === 2, 'jslib: чужой сайт-родитель — hello только на наши адреса');
}

// ═══ 6. Сквозная проверка: «игры» на C#-сообщениях ↔ jslib ↔ сессия сайта ↔ комната ═══
// Сообщения игры собираем из выражений Post(...) настоящего D37.cs (C# и JS здесь пишутся одинаково)
const CS = read('sdk/unity/Runtime/D37.cs');
const POSTS = [...CS.matchAll(/\bPost\(("\{.*?)\);\s*(?:return;)?\s*(?:\}|$)/gm)].map(m => m[1]);
const HELLO = /D37_Init\(D37Bridge\.ObjectName, (.*?)\);/.exec(CS)[1];
function csJson(s){ return JSON.stringify(String(s)); }
function csEval(expr, vars){
  const names = ['Json', 'Cut', 'score', 'win', 'coins', 'text', 'code', 'playerId', 'type', 'json', 'reliable', 'lastScore', 'Version', 'Application'];
  const fn = new Function(...names, 'return ' + expr + ';');
  return fn(csJson, (s, n) => String(s).slice(0, n), vars.score ?? 0, vars.win ?? false, vars.coins ?? 0, vars.text ?? '', vars.code ?? '', vars.playerId ?? '', vars.type ?? 'x', vars.json ?? '', vars.reliable ?? true, vars.lastScore ?? 0, '1.0.0', { unityVersion: '2022.3.10f1' });
}
const csMsg = (t, vars = {}) => { for (const e of POSTS) { const s = csEval(e, vars); const m = JSON.parse(s); if (m.t === t) return s; } throw new Error('нет Post для ' + t); };
{
  const types = new Set(POSTS.map(e => JSON.parse(csEval(e, {})).t));
  ok([...types].sort().join() === [...U.IN_TYPES].filter(t => t !== 'hello').sort().join(), 'D37.cs шлёт ровно те типы, что принимает сайт', [...types]);
  ok(JSON.parse(csEval(HELLO, {})).sdk === '1.0.0', 'hello из D37.cs');
  for (const e of POSTS) { const m = JSON.parse(csEval(e, { text: 'привет "мир"', code: 'abc123', playerId: 'p1x', type: 'move', json: '{"a":[1,2]}', score: 7, coins: 3, win: true })); ok(U.cleanIn({ d37u: 1, ...m }) !== null, 'сайт принимает сообщение D37.cs: ' + m.t, m); }
  const recv = [...CS.slice(CS.indexOf('internal static void Receive')).matchAll(/case "([a-z.]+)":/g)].map(m => m[1]);
  ok(recv.slice(0, 6).sort().join() === [...U.OUT_TYPES].sort().join(), 'D37.cs разбирает все типы сайта', recv);
}
const wireFields = cls => new Set([...(new RegExp('class ' + cls + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(CS)[1]).matchAll(/public [\w\[\]]+ (\w+);/g)].map(m => m[1]));
const WIRE = wireFields('D37Wire'), WPLAYER = wireFields('D37WirePlayer'), WGAME = wireFields('D37WireGame');
function checkWire(msg){
  const bad = [];
  for (const k of Object.keys(msg)) if (!WIRE.has(k)) bad.push(k);
  for (const p of [msg.player, ...(msg.players || [])].filter(Boolean)) for (const k of Object.keys(p)) if (!WPLAYER.has(k)) bad.push('player.' + k);
  if (msg.game) for (const k of Object.keys(msg.game)) if (!WGAME.has(k)) bad.push('game.' + k);
  return bad;
}

async function e2e(){
  // «Supabase» сайта: тот же подменный канал, доставка — асинхронно, как по сети
  const hub = makeHub();
  let pumping = false;
  const pump = () => { if (pumping) return; pumping = true; setImmediate(() => { pumping = false; hub.flush(); }); };
  const qpush = hub.queue.push.bind(hub.queue);
  hub.queue.push = (...a) => { const r = qpush(...a); pump(); return r; };
  const rpcCalls = [];
  globalThis.sbClient = {
    channel(name, cfg){
      const key = cfg.config.presence.key, h = {};
      let T = null, st = {};
      const ch = {
        on(type, filter, cb){ h[type] = cb; return ch; },
        subscribe(cb){ T = hub.open(name, key); T.onStatus = cb; T.onSync = s => { st = s; h.presence?.(); }; T.onMsg = p => h.broadcast?.({ payload: p }); return ch; },
        presenceState: () => st,
        track: meta => T.track(meta),
        send: m => { T.send(m.payload); return Promise.resolve('ok'); },
        untrack: () => Promise.resolve(),
        _close: () => T?.close(),
      };
      return ch;
    },
    removeChannel(ch){ ch._close(); },
    async rpc(name, args){ rpcCalls.push({ name, args: clone(args) }); return { data: name === 'unity_result' ? { ok: true, xp: 10, coins: args.p_coins, record: true, best: args.p_score } : { ok: true }, error: null }; },
  };
  const toasts = [];
  U.setApi({ toast: t => toasts.push(t), sfx(){}, local: () => ({}), saveLocal(){} });
  // DOM: элемент-заглушка
  const el = () => { const e = { hidden: true, innerHTML: '', textContent: '', className: '', dataset: {}, attrs: {}, L: {},
    style: { setProperty(){} }, classList: { toggle(){}, add(){}, remove(){} },
    addEventListener(t, f){ (e.L[t] = e.L[t] || []).push(f); }, removeEventListener(t, f){ e.L[t] = (e.L[t] || []).filter(x => x !== f); },
    setAttribute(k, v){ e.attrs[k] = v; }, querySelector: () => null, appendChild(c){ e.child = c; }, remove(){ e.removed = true; }, focus(){} }; return e; };
  const frames = [];
  globalThis.document = { createElement: () => { const e = el(); frames.push(e); return e; } };
  const GAME = { id: 'abcd1234', title: 'Тест', url: 'https://me.github.io/game/index.html', origin: 'https://me.github.io', aspect: '16:9', players: 4, status: 'public', srv: true };

  // одна «игра»: jslib в своём окне + C#-приёмник; сайт видит iframe как кросс-доменный (location недоступен)
  function player(nick, userId, code, over = {}){
    globalThis.currentUser = { id: userId };
    globalThis.currentProfile = { nick };
    const H = heapEnv(), G = gameWindow(), inbox = [];
    const M = buildModule(loadLib(), { ...H.env, window: G.w, document: G.doc, SendMessage: (o, m, s) => { const msg = JSON.parse(s); const bad = checkWire(msg); if (bad.length) inbox.bad = (inbox.bad || []).concat(bad); inbox.push(msg); } });
    const view = { postMessage(msg, target){ if (target === 'https://me.github.io') { const data = clone(msg); setImmediate(() => G.w.listeners.forEach(fn => fn({ data, origin: SITE_ORIGIN, source: G.parentWin }))); } },
      get location(){ throw new Error('SecurityError: cross-origin'); } };
    const box = el(), parts = {};
    box.querySelector = s => parts[s] || (parts[s] = el());
    const before = frames.length;
    const S = U.session(box, { ...GAME, ...over }, { preview: false, code: code || '', own: false, onTop(){}, onLoad: () => { P.loaded = true; } });
    const f = frames[before];
    f.contentWindow = view;
    // родитель (сайт) получает сообщения игры, только если адрес совпал (как в браузере)
    G.parentWin.postMessage = (msg, target) => { if (target === SITE_ORIGIN) { const data = clone(msg); setImmediate(() => (winListeners.message || []).forEach(fn => fn({ data, origin: 'https://me.github.io', source: view }))); } };
    const P = { nick, M, H, inbox, S, parts, frame: f, loaded: false,
      start(){ (f.L.load || []).forEach(fn => fn()); M.D37_Init(H.ptr('D37Bridge'), H.ptr(csEval(HELLO, {}))); },
      post(t, vars){ return M.D37_Post(H.ptr(csMsg(t, vars))); },
      raw(data){ setImmediate(() => (winListeners.message || []).forEach(fn => fn({ data, origin: 'https://me.github.io', source: view }))); },
      last: t => inbox.filter(m => m.t === t).at(-1), all: t => inbox.filter(m => m.t === t) };
    return P;
  }

  const A = player('Аня', 'aaaaaaaa-0000-0000-0000-000000000001');
  ok(A.frame.attrs.sandbox === U.SANDBOX && A.frame.attrs.allow === U.ALLOW && A.frame.attrs.referrerpolicy === 'origin' && A.frame.src === GAME.url, 'iframe: песочница, allow, referrer, адрес сборки', A.frame.attrs);
  A.start();
  await sleep(30);
  ok(A.loaded, 'страница сборки загрузилась (кросс-доменная) — onLoad (на странице игры он засчитывает запуск)');
  const init = A.last('init');
  ok(init && init.player.nick === 'Аня' && init.player.guest === false && init.player.id === U.uidOf('aaaaaaaa-0000-0000-0000-000000000001', GAME.id) && init.game.players === 4 && init.online === true, 'init: игрок и игра', init);
  ok(!A.inbox.bad, 'поля сообщений сайта есть в D37Wire (D37.cs)', A.inbox.bad);
  A.post('score', { lastScore: 42 });
  await sleep(10);
  ok(/42/.test(A.parts['.un-score'].textContent), 'счёт виден под игрой', A.parts['.un-score'].textContent);
  A.post('toast', { text: 'Привет <b>' });
  await sleep(10);
  ok(toasts.includes('🕹️ Привет <b>'), 'тост игры (HTML экранирует xpToast)', toasts);
  A.post('room.create');
  await sleep(60);
  const sA = A.last('room.state');
  ok(sA && /^[a-z0-9]{6}$/.test(sA.code) && sA.host === sA.me && sA.players.length === 1 && sA.link.endsWith('#/games/unity/play/' + GAME.id + '/' + sA.code), 'room.create → комната, ты хост, ссылка', sA);
  ok(urls.at(-1) === '#/games/unity/play/' + GAME.id + '/' + sA.code, 'адрес страницы — с кодом комнаты (обновил — вернёшься)', urls.at(-1));

  const B = player('Боря', 'bbbbbbbb-0000-0000-0000-000000000002', sA.code);   // открыл ссылку друга
  B.start();
  await sleep(1300);
  const sB = B.last('room.state');
  ok(sB && sB.code === sA.code && sB.host === sA.me && !sB.players.find(p => p.me).host && sB.players.length === 2, 'по ссылке: в той же комнате, хост — создатель', sB);
  ok(A.last('room.state').players.length === 2 && toasts.some(t => /Боря/.test(t)), 'у хоста — новичок в списке и подсказка на сайте');
  B.post('room.send', { playerId: sB.host, type: 'move', json: '{"x":1}' });
  await sleep(40);
  const m1 = A.last('room.msg');
  ok(m1 && m1.from === sB.me && m1.type === 'move' && m1.data === '{"x":1}', 'гость → хосту дошло', m1);
  A.post('room.send', { playerId: '', type: 'state', json: '{"t":5}', reliable: false });
  await sleep(40);
  ok(B.last('room.msg')?.type === 'state' && B.last('room.msg').from === sA.me, 'хост → всем дошло');
  // игра шлёт ерунду — сайт не пропускает
  B.raw({ d37u: 1, t: 'room.send', to: '', type: 'big', data: 'x'.repeat(9000) });
  B.raw({ d37u: 1, t: 'init', player: { nick: 'взлом' } });
  B.raw({ t: 'room.send', type: 'nomark', data: '' });
  await sleep(40);
  ok(!A.all('room.msg').some(m => m.type === 'big' || m.type === 'nomark'), 'сайт не пропустил кривые сообщения игры');
  for (let i = 0; i < 80; i++) B.raw({ d37u: 1, t: 'room.send', to: '', type: 'flood', data: String(i), rel: false });
  await sleep(60);
  ok(A.all('room.msg').filter(m => m.type === 'flood').length <= 10 && B.all('room.error').some(e => e.reason === 'rate'), 'поток сообщений: через сервер не больше запаса, игре — room.error rate', A.all('room.msg').filter(m => m.type === 'flood').length);
  // итог раунда → сервер (общие лимиты) → ответ игре
  A.post('over', { score: 120, win: true, coins: 30 });
  await sleep(40);
  const call = rpcCalls.find(c => c.name === 'unity_result');
  ok(call && call.args.p_id === GAME.id && call.args.p_score === 120 && call.args.p_win === true && call.args.p_coins === 30 && /^[a-z0-9]{6,24}$/.test(call.args.p_ref), 'over → unity_result(p_id, p_score, p_win, p_coins, p_ref)', call);
  const r1 = A.last('result');
  ok(r1 && r1.ok && r1.xp === 10 && r1.coins === 30 && r1.record && r1.best === 120, 'result → игре', r1);
  A.post('over', { score: 1, win: false, coins: 0 });
  await sleep(40);
  ok(A.last('result').ok === false && A.last('result').reason === 'too_fast' && rpcCalls.filter(c => c.name === 'unity_result').length === 1, 'второй итог чаще раза в 10 с — сервер не дёргаем');
  // хост ушёл (закрыл страницу) — хостом стал Боря
  A.S.stop();
  await sleep(80);
  const sB2 = B.last('room.state');
  ok(sB2.host === sB.me && sB2.players.length === 1 && toasts.some(t => /хост — ты/.test(t)), 'хост ушёл → хост ты (room.state, подсказка)', sB2);
  B.post('room.leave');
  await sleep(30);
  ok(B.last('room.state').code === '' && B.last('room.state').players.length === 0, 'room.leave → пустое состояние');
  ok(!B.inbox.bad && !A.inbox.bad, 'все сообщения сайта укладываются в D37Wire', [A.inbox.bad, B.inbox.bad]);
  // одиночная игра: комнаты нельзя
  const solo = player('Соло', 'cccccccc-0000-0000-0000-000000000003', '', { players: 1 });
  solo.start();
  await sleep(30);
  solo.post('room.create');
  await sleep(30);
  ok(solo.last('room.error')?.reason === 'single' && !solo.last('room.state'), 'одиночная игра: room.create → room.error single');
  solo.S.stop();
  B.S.stop();
  // адрес самого сайта — iframe не создаётся; после загрузки в iframe оказался наш адрес (переадресация) — iframe убран
  const before = frames.length, bx = el(), px = {};
  bx.querySelector = s => px[s] || (px[s] = el());
  U.session(bx, { ...GAME, url: SITE_ORIGIN + '/game/index.html', origin: SITE_ORIGIN }, { preview: true }).stop();
  ok(frames.length === before && /нельзя/.test(px['.un-box'].innerHTML), 'ссылка на сам сайт — iframe не создаётся (allow-same-origin снял бы песочницу)');
  const by = el(), py = {};
  by.querySelector = s => py[s] || (py[s] = el());
  const SY = U.session(by, { ...GAME }, { preview: true });
  const fy = frames.at(-1);
  fy.contentWindow = { location: { href: SITE_ORIGIN + '/evil' } };
  (fy.L.load || []).forEach(fn => fn());
  ok(fy.removed && /сам сайт/.test(py['.un-box'].innerHTML), 'в iframe после загрузки наш адрес — iframe убран');
  SY.stop();
  ok((winListeners.message || []).length === 0, 'все сессии сняли свои обработчики message', (winListeners.message || []).length);
  delete globalThis.sbClient;
}

// ═══ 7. Тестовая страница ═══
{
  const html = read('sdk/unity/TestPage/index.html');
  const js = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  let syntax = true; try { new vm.Script(js); } catch (e) { syntax = false; }
  ok(syntax, 'TestPage: скрипт без синтаксических ошибок');
  ok(/'https:\/\/dan4ik37\.vercel\.app', 'https:\/\/dan4ik37\.github\.io'/.test(js) && /localhost\|127/.test(js), 'TestPage: тот же список адресов сайта, что в jslib');
  for (const t of ['hello', 'score', 'over', 'toast', 'room.create', 'room.join', 'room.leave', 'room.send', 'init', 'player', 'room.state', 'room.msg', 'room.error', 'result']) ok(js.includes("'" + t + "'"), 'TestPage знает тип ' + t);
}

(async () => {
  try { await e2e(); } catch (e) { fail++; console.log('FAIL e2e', e.stack); }
  console.log(`\nUnity-игры: ${pass} проверок прошло, ${fail} не прошло`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);   // таймеры netplay.js и сессий уже сняты, но не ждём лишнего
})();

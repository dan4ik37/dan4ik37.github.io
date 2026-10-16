// Тест телефона 📱, звонков, чата «как Дискорд» и «🌍 Весь мир» в node (без браузера): машина состояний звонка, сетка
// голосового (кто кому предлагает соединение, «канал полон»), проверка сигнальных сообщений, «говорит ли» (без мигания),
// права модерации в сообществах (как comm_can_mod в community.sql), карточки ссылок и защита текста ленты (мат, чужие
// ссылки, разметка), «чем занят» друзей (свой код и чужой — разбор недоверенного), сообщения «Весь мир» (проверка и подписи),
// анти-спам общего чата (ссылки на сайт можно).
// Запуск из корня сайта: node scripts/community-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');

// ── Мини-браузер: только то, что нужно файлам при загрузке ──
const el = () => ({ style: {}, dataset: {}, children: [], hidden: false, innerHTML: '', textContent: '', classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  appendChild(c){ return c; }, prepend(){}, remove(){}, setAttribute(){}, getAttribute(){ return null; }, addEventListener(){}, removeEventListener(){},
  querySelector(){ return null; }, querySelectorAll(){ return []; }, contains(){ return false; }, focus(){}, closest(){ return null; } });
globalThis.window = globalThis;
globalThis.document = { createElement: el, body: el(), documentElement: el(), head: el(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  addEventListener(){}, removeEventListener(){}, hidden: false, fullscreenElement: null, activeElement: null };
window.addEventListener = () => {}; window.removeEventListener = () => {}; window.dispatchEvent = () => true;
globalThis.localStorage = { s: {}, getItem(k){ return this.s[k] ?? null; }, setItem(k, v){ this.s[k] = String(v); }, removeItem(k){ delete this.s[k]; } };
globalThis.sessionStorage = { getItem: () => null, setItem(){} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.CustomEvent = class { constructor(t, o){ this.type = t; this.detail = o?.detail; } };
globalThis.Event = class { constructor(t){ this.type = t; } };
globalThis.requestAnimationFrame = f => setTimeout(f, 0);
globalThis.esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
globalThis.GAMES = [{ id: 'chess', icon: '♟️', title: 'Шахматы', desc: 'Шахматы со всеми правилами', color: '#e5e7eb' }, { id: 'horde', icon: '🧟', title: 'Орда', desc: 'Выживание', color: '#a855f7' },
  { id: 'uno', icon: '🃏', title: 'Одна!', desc: 'Карты', color: '#e5383b' }, { id: 'world', icon: '🌍', title: 'Мир Денчика', desc: 'Мир' }, { id: 'studio3d', icon: '🧱', title: 'Студия 3D', desc: '' }];
globalThis.customEmoji = [{ name: 'dan', image_url: 'https://x.supabase.co/storage/v1/object/public/emoji/dan.png' }];
globalThis.currentRoute = () => 'home';
const timers = []; const _si = setInterval; globalThis.setInterval = (f, ms) => { const t = _si(f, ms); t.unref?.(); timers.push(t); return t; };
// окно «⚙️ Настройки» (js/core/settings.js) — заглушка: телефон добавляет туда свою вкладку
const setTabs = []; let setOpened = null;
window.D37Settings = { addTab(t){ setTabs.push(t); }, open(o){ setOpened = o; }, isOpen: () => false };
for (const f of ['js/features/phone.js', 'js/features/msgview.js', 'js/features/calls.js', 'js/features/community.js', 'js/features/community2.js', 'js/features/worldchat.js', 'js/features/chat.js'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const P = window.D37Phone, MV = window.MsgView, C = window.D37Calls._test, DS = window.D37DS._test, W = window.D37WorldChat, CH = window.D37Chat._test;

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

(async () => {
  // ═══ 1. Звонок: машина состояний ═══
  const run = (evs, s = 'idle') => evs.reduce((st, ev) => C.step(st, ev), s);
  ok(run(['dial', 'joined', 'hangup']) === 'ended', 'звоню → друг ответил → положил');
  ok(run(['dial', 'timeout']) === 'ended' && run(['dial', 'declined']) === 'ended', 'не ответил / отклонил → конец');
  ok(run(['ring', 'accept', 'joined']) === 'live', 'мне звонят → ответил → разговор');
  ok(run(['ring', 'decline']) === 'ended' && run(['ring', 'gone']) === 'ended' && run(['ring', 'timeout']) === 'ended', 'входящий: отклонил / друг положил / не ответил');
  ok(run(['dial', 'joined', 'accept']) === 'live' && run(['ring', 'joined']) === 'in', 'лишние события не ломают состояние');
  ok(run(['dial', 'hangup', 'reset']) === 'idle' && run(['dial', 'hangup', 'ring']) === 'in', 'после конца — новый звонок');
  ok(run(['join', 'empty']) === 'ended' && run(['join', 'joined', 'failed']) === 'ended', 'по ссылке: никого / связь не вышла');
  for (const [s, evs] of Object.entries(C.FSM)) for (const [ev, to] of Object.entries(evs)) ok(!!C.FSM[to], `переход ${s} —${ev}→ ${to} ведёт в известное состояние`);

  // ═══ 2. Сетка голосового: кто кому предлагает соединение ═══
  const M = (key, at, okv = true) => ({ key, at, ok: okv });
  let p = C.plan([M('a', 1), M('b', 2), M('c', 3)], 'b');
  ok(p.joined && p.offer.join() === 'c' && p.wait.join() === 'a', 'средний: предлагает позже вошедшему, ждёт от раньше вошедшего', p);
  ok(C.plan([M('a', 1), M('b', 2, false), M('c', 3)], 'a').offer.join() === 'c', 'непроверенный — без соединения');
  p = C.plan(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => M(k, i)), 'g');
  ok(p.full && !p.joined && p.inside.length === 6, 'седьмой — «канал полон»', p);
  ok(C.plan(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k, i) => M(k, i)), 'a').offer.length === 5, 'первый соединяется только с пятью из шести внутри');
  ok(C.plan([M('b', 5), M('a', 5)], 'a').offer.join() === 'b', 'одно время входа — по ключу');
  ok(!C.plan([M('a', 1)], 'x').joined, 'меня нет в комнате — не соединяюсь');
  // свойство: в каждой паре ровно один предлагает (4–6 человек, случайный порядок, одинаковое время у некоторых)
  let pairsOk = true;
  for (let t = 0; t < 200; t++) {
    const n = 2 + (t % 5), ms = Array.from({ length: n }, (_, i) => M('k' + Math.floor(Math.random() * 1e6) + i, Math.floor(Math.random() * 4)));
    const plans = new Map(ms.map(m => [m.key, C.plan(ms, m.key)]));
    for (const a of ms) for (const b of ms) if (a.key < b.key) {
      const ab = plans.get(a.key).offer.includes(b.key), ba = plans.get(b.key).offer.includes(a.key);
      const aw = plans.get(a.key).wait.includes(b.key), bw = plans.get(b.key).wait.includes(a.key);
      if (ab === ba || ab !== bw || ba !== aw) pairsOk = false;
    }
  }
  ok(pairsOk, 'в каждой паре ровно один предлагает, второй ждёт (200 случайных комнат)');

  // ═══ 3. Сигнальные сообщения: чужому не верим ═══
  const sdp = { type: 'offer', sdp: 'v=0\r\n' };
  ok(C.sigOk({ t: 'offer', to: 'me', sid: 'abc', sdp }, 'me'), 'предложение мне — да');
  ok(!C.sigOk({ t: 'offer', to: 'other', sid: 'abc', sdp }, 'me'), 'предложение другому — не моё');
  ok(!C.sigOk({ t: 'offer', to: 'me', sdp: { type: 'offer', sdp: 'x'.repeat(40000) } }, 'me'), 'огромное SDP — отказ');
  ok(!C.sigOk({ t: 'answer', to: 'me', sdp: { type: 'pranswer', sdp: 'v' } }, 'me'), 'странный тип SDP — отказ');
  ok(C.sigOk({ t: 'ice', to: 'me', sid: 's', c: [{ candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host' }] }, 'me'), 'кандидаты пачкой — да');
  ok(!C.sigOk({ t: 'ice', to: 'me', c: [{ candidate: 5 }] }, 'me') && !C.sigOk({ t: 'ice', to: 'me', c: Array(41).fill({ candidate: 'x' }) }, 'me'), 'кривые / слишком много кандидатов — отказ');
  ok(C.sigOk({ t: 'st', mute: true }, 'me') && C.sigOk({ t: 'bye' }, 'me'), 'состояние и «пока» — всем');
  ok(!C.sigOk({ t: 'eval' }, 'me') && !C.sigOk(null, 'me') && !C.sigOk({ t: 'hi', to: 'me', sid: 'x'.repeat(30) }, 'me'), 'незнакомое / пустое / длинный sid — отказ');

  // ═══ 4. «Говорит» — без мигания ═══
  const v = {}; let on = false;
  on = C.vad(v, .1, .03); ok(!on, 'громко 30 мс — ещё нет');
  on = C.vad(v, .1, .04); ok(on, 'громко 70 мс — говорит');
  on = C.vad(v, .005, .2); ok(on, 'пауза 0,2 с — ещё говорит');
  on = C.vad(v, .005, .25); ok(!on, 'тихо 0,45 с — молчит');

  // ═══ 5. Права модерации (как comm_can_mod) ═══
  const cm = DS.canMod;
  ok(cm('owner', 'mod', false) && cm('owner', 'member', false) && !cm('owner', 'owner', false), 'владелец: модераторов и участников — да, владельца — нет');
  ok(cm('mod', 'member', false) && !cm('mod', 'mod', false) && !cm('mod', 'owner', false), 'модератор: только участников');
  ok(!cm('member', 'member', false) && !cm(null, 'member', false), 'участник и чужой — никого');
  ok(cm(null, 'owner', true) && cm('member', 'mod', true), 'персонал сайта — всех');

  // ═══ 6. Ссылки → карточки, текст ленты ═══
  const card = MV.cardOf;
  ok(card('/v/dQw4w9WgXcQ')?.t === 'video', 'ролик /v/<id>');
  ok(JSON.stringify(card('#/games/chess/abc123')) === JSON.stringify({ t: 'room', g: 'chess', coop: false, code: 'abc123' }), 'комната «позвать в игру»');
  ok(card('#/games/horde/coop/k7m2pq')?.coop === true, 'комната «вместе»');
  ok(card('/games/chess')?.t === 'game' && card('#/games/chess')?.t === 'game', 'игра');
  ok(card('#/games/studio3d/play/abcd1234')?.t !== 'room', 'мир игрока — не «комната»');
  ok(card('/g/abcd1234')?.t === 'ugc' && card('/c/k7m2pq9x')?.t === 'invite' && card('#/phone/call/abcdefgh23')?.t === 'call', 'игра игрока, приглашение, звонок');
  ok(card('/v/../x') === null && card('#/games/chess/A<b>') === null && card('javascript:alert(1)') === null, 'мусор — без карточки');
  let r = MV.rich('го https://dan4ik37.vercel.app/#/games/chess/abc123 сюда', 'Вася');
  ok(r.cards.length === 1 && r.cards[0].t === 'room' && /mv-link/.test(r.html) && !/https/.test(r.html.replace(/href="[^"]*"/, '')), 'ссылка на сайт → кнопка + карточка', r);
  r = MV.rich('заходи на https://evil.ru/x или t.me/joinchat', '');
  ok(/\[ссылка\]/.test(r.html) && !/evil/.test(r.html), 'чужая ссылка → [ссылка]', r.html);
  r = MV.rich('<img src=x onerror=alert(1)> "кав"', '');
  ok(!/<img/.test(r.html) && /&lt;img/.test(r.html) && /&quot;/.test(r.html), 'разметка экранирована', r.html);
  r = MV.rich('ну ты хуйло', '');
  ok(/\*{3,}/.test(r.html) && !/хуйло/.test(r.html), 'мат закрыт звёздочками', r.html);
  r = MV.rich('@Вася привет @петя', 'вася');
  ok(/mv-at me/.test(r.html) && (r.html.match(/mv-at/g) || []).length === 2, '@упоминания, меня — подсвечено', r.html);
  r = MV.rich('смотри :dan: !', '');
  ok(/custom-emoji-img/.test(r.html), 'эмодзи сайта :dan:');
  ok(MV.rich('🔥🔥🔥', '').big && !MV.rich('ок 🔥', '').big, 'только эмодзи — крупно');
  ok(MV.rich('a\n\nb', '').html.includes('<br>'), 'переносы строк');

  // ═══ 7. «Чем занят» — свой код и разбор чужого ═══
  const code = P.actCode({ w: 2, g: 'chess', j: 'games/chess/abc123' });
  ok(code === 'w:2|g:chess|j:games/chess/abc123', 'свой код занятия', code);
  const a = P.actParse(code);
  ok(a.w === 2 && a.g === 'chess' && a.j === 'games/chess/abc123', 'разбор своего кода');
  ok(P.actText(a) === '🌍 В Мире, сервер 2 · ♟️ играет в «Шахматы»', 'текст: в мире и за столом', P.actText(a));
  ok(P.actText(P.actParse('g:uno|j:games/uno/k7m2pq')) === '🃏 Играет в «Одна!»' && P.actText(P.actParse('v')) === '🎬 Смотрит ролики' && P.actText({}) === '🟢 На сайте', 'тексты занятий');
  ok(P.actText(P.actParse('s:abcd1234|t:Обби|j:games/studio3d/play/abcd1234/xyz789')) === '🧱 В мире игрока «Обби»', 'мир игрока с названием');
  ok(P.actJoin(P.actParse('w:3'))?.world === 3 && P.actJoin(P.actParse('j:games/uno/k7m2pq'))?.hash === '#/games/uno/k7m2pq', 'куда «📍 К другу»: сервер мира / комната');
  ok(P.actJoin(P.actParse('v')) === null, 'смотрит ролики — идти некуда');
  const evil = P.actParse('j:javascript:alert(1)|j:games/../../x|w:999|g:<b>|t:<script>xx</script>|s:../|z:1');
  ok(!evil.j && !evil.w && !evil.g && !evil.s && !evil.z, 'чужой код: опасное не принимается', evil);
  ok(P.actParse('t:хуйня').t !== 'хуйня', 'название мира — без мата');
  ok(P.actParse('j:games/studio3d/join/k7m2pq').j === 'games/studio3d/join/k7m2pq' && P.actParse('j:games/unity/play/abc12345/k7m2pq').j, 'комнаты студии и Unity — можно прийти');
  ok(P.actParse('x'.repeat(5000)) && Object.keys(P.actParse('x'.repeat(5000))).length === 0, 'огромная строка — пусто');

  // ═══ 8. «🌍 Весь мир»: проверка сообщения и подписи ═══
  const now = Date.now();
  const good = { m: JSON.stringify({ n: 'Вася', u: null, sh: 2, x: 'привет всем', ts: now }), s: 'sig', p: 'pub' };
  ok(W.valid(good, now)?.x === 'привет всем' && W.valid(good, now).sh === 2, 'нормальное сообщение');
  ok(!W.valid({ ...good, m: JSON.stringify({ n: 'В', x: 'старое', ts: now - 120000 }) }, now), 'старое (повтор) — отказ');
  ok(!W.valid({ ...good, m: 'x'.repeat(800) }, now) && !W.valid({ ...good, p: 5 }, now) && !W.valid(null, now), 'огромное / кривое — отказ');
  ok(!W.valid({ ...good, m: JSON.stringify({ n: 'В', x: '   ', ts: now }) }, now), 'пустое — отказ');
  ok(W.valid({ ...good, m: JSON.stringify({ n: 'В'.repeat(50), x: 'а', sh: 'х', ts: now }) }, now)?.n.length === 24 && W.valid({ ...good, m: JSON.stringify({ n: 'В', x: 'а', sh: 'х', ts: now }) }, now).sh === 0, 'ник обрезан, кривой сервер → 0');
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = W._test.b64(await crypto.subtle.exportKey('raw', kp.publicKey));
  const sig = await W._test.sign(kp.privateKey, good.m), pk = await W._test.importPub(pub);
  ok(await W._test.verify(pk, sig, good.m), 'подпись своя — сходится');
  ok(!(await W._test.verify(pk, sig, good.m.replace('привет', 'пакость'))), 'подменили текст — подпись не сходится');

  // ═══ 9. Анти-спам общего чата ═══
  ok(CH.checkSpam('го https://dan4ik37.vercel.app/#/games/chess/abc123') === null, 'ссылка на сайт — можно');
  ok(/Ссылки/.test(CH.checkSpam('го https://evil.ru') || '') && /Ссылки/.test(CH.checkSpam('discord.gg/xyz') || ''), 'чужие ссылки — нельзя');
  ok(/Флуд/.test(CH.checkSpam('аааааааааааа') || '') && /длинное/.test(CH.checkSpam('x'.repeat(301)) || ''), 'флуд и длина');
  ok(CH.offMsg({ id: 5, user_id: null, nick: 'Гость', text: 'hi', created_at: '2026-10-15T10:00:00Z', channel: 'games', reply_to: 3, pinned_until: '2000-01-01T00:00:00Z' }).ch === 'games'
    && CH.offMsg({ id: 5, nick: 'x', text: 'y' }).ch === 'general' && !CH.offMsg({ id: 1, pinned_until: '2000-01-01T00:00:00Z' }).pinned, 'сообщение общего чата: канал (нет — #общий), просроченный закреп');

  // ═══ 10. Мат в чужих названиях и текстах (телефон) ═══
  ok(P.clean('сука блять') !== 'сука блять' && P.clean('хлебало и сукно') === 'хлебало и сукно', 'фильтр мата: ругань — да, похожие слова — нет');

  // ═══ 11. Настройки телефона — вкладка «📱 Телефон» в окне ⚙️ ═══
  const tab = setTabs.find(t => t.id === 'phone');
  ok(tab && tab.icon === '📱' && ['engine', 'game', 'site'].every(c => tab.ctx.includes(c)), 'вкладка «📱 Телефон» есть в мире, в играх и на сайте', tab && { ctx: tab.ctx });
  const body = document.createElement('div'); let box = null; body.appendChild = c => { box = c; return c; };
  tab?.render(body);
  ok(box && /Кто может звонить/.test(box.innerHTML) && /Мелодия/.test(box.innerHTML) && /Клавиша рации/.test(box.innerHTML) && /Заблокированные/.test(box.innerHTML), 'вкладка: звонки, мелодия, рация, заблокированные');
  ok(box && /data-phs="calls" data-v="friends"/.test(box.innerHTML) && /class="on" data-phs="calls" data-v="friends"/.test(box.innerHTML), 'по умолчанию звонят друзья');
  ok(box && !/data-set=|data-sw=|data-range=/.test(box.innerHTML), 'свои атрибуты — окно настроек их не перехватывает');
  ok(P.keyName('Backquote') === 'Ё' && P.keyName('KeyV') === 'V' && P.keyName('ShiftLeft') === 'Shift' && P.keyName('Digit5') === '5', 'названия клавиш рации');
  ok(P.openSettings() === true && setOpened?.tab === 'phone', '⚙️ в телефоне открывает окно настроек на вкладке «📱 Телефон»');

  // ═══ 12. Телефон в руке персонажа (как в ГТА): что держит — по экрану и звонку ═══
  const H = P.handFor, live = { kind: 'call', state: 'live' };
  ok(H(false, '', null) === '' && H(true, '', null) === 'use' && H(true, 'msgs/x', null) === 'use', 'закрыт — убран, открыт — смотрит в экран');
  ok(H(true, 'camera', null) === 'photo' && H(true, 'game', null) === 'play', 'камера — снимает, «Птичка» — играет боком');
  ok(H(true, 'incall', live) === 'call' && H(false, 'incall', live) === 'call' && H(false, '', { kind: 'call', state: 'out' }) === 'call', 'разговор 1 на 1 — у уха, и с закрытым экраном');
  ok(H(true, 'incall', { kind: 'call', state: 'in' }) === 'use' && H(false, '', { kind: 'call', state: 'ended' }) === '', 'звонят — смотрит, кто; положил — убирает');
  ok(H(false, '', { kind: 'party', state: 'live' }) === '' && H(false, '', { kind: 'voice', state: 'live' }) === '', 'компания и голосовой канал — без телефона у уха (как наушники)');
  ok(H(true, 'calls', live) === 'use', 'во время разговора смотрит другое приложение — в руке перед собой');
  ok(P._test.APPS.some(a => a.id === 'game' && a.mod === 'apps'), 'в телефоне есть мини-игра');

  // ═══ 13. «Денчик-бот» и карточки эфира / событий (community2.sql) ═══
  ok(card('#/chat/twitch')?.t === 'live' && card('#/chat/ev/12')?.t === 'event' && card('#/chat/ev/12').id === 12, 'эфир и событие — карточки');
  ok(card('#/chat/ev/abc') === null && card('#/chat/ev/1234567890123') === null, 'кривой номер события — без карточки');
  r = MV.rich('🔴 Денчик в эфире: Играем! → https://dan4ik37.vercel.app/#/chat/twitch', '');
  ok(r.cards.length === 1 && r.cards[0].t === 'live' && /🔴 эфир/.test(r.html), 'сообщение бота об эфире → карточка «Смотреть»', r);
  ok(/twitch\.tv\/dan4ik37/.test(MV.cardHtml({ t: 'live' })) && /rel="noopener"/.test(MV.cardHtml({ t: 'live' })), 'карточка эфира ведёт на Twitch');
  r = MV.rich('🎬 Новое видео: Обзор → https://dan4ik37.vercel.app/v/dQw4w9WgXcQ', '');
  ok(r.cards.length === 1 && r.cards[0].t === 'video', 'сообщение бота о ролике → карточка ролика');
  window.D37Age = { kid: () => true, kidText: t => t, canOpen: n => n <= 6 };
  r = MV.rich('эфир https://dan4ik37.vercel.app/#/chat/twitch и событие #/chat/ev/5', '', { kid: true });
  ok(/\[ссылка\]/.test(r.html) && r.cards.length === 1 && r.cards[0].t === 'event', 'ребёнку: эфир (Twitch 13+) — [ссылка], событие сайта — карточка', r);
  ok(/Загружаем/.test(MV.cardHtml({ t: 'event', id: 5 })), 'карточка события до загрузки');
  const soon = new Date(Date.now() + 2 * 3600e3).toISOString(), soonEnd = new Date(Date.now() + 4 * 3600e3).toISOString();
  MV.evSet({ id: 5, title: 'Турнир хуйня', starts_at: soon, ends_at: soonEnd, status: 'active', place_kind: 'game', place: 'chess', age: 0, going: 3, mine: false });
  let ec = MV.cardHtml({ t: 'event', id: 5 });
  ok(/data-evgo="5"/.test(ec) && /✅ Пойду/.test(ec) && /Шахматы/.test(ec) && /✅ 3/.test(ec) && !/хуйня/.test(ec), 'карточка события: «Пойду», место, сколько идут, мат закрыт', ec);
  MV.evSet({ id: 6, title: 'Ночной стрим', starts_at: soon, ends_at: soonEnd, status: 'active', place_kind: 'stream', age: 16, going: 0 });
  ok(/Не по возрасту/.test(MV.cardHtml({ t: 'event', id: 6 })), 'событие 16+ ребёнку — «не по возрасту»');
  delete window.D37Age;
  MV.evSet({ id: 7, title: 'Идёт сейчас', starts_at: new Date(Date.now() - 60e3).toISOString(), ends_at: soonEnd, status: 'active', place_kind: 'world', going: 2, mine: true });
  ec = MV.cardHtml({ t: 'event', id: 7 });
  ok(/mv-ev live/.test(ec) && /Сейчас идёт/.test(ec) && /href="#\/games\/world"/.test(ec) && /▶ Зайти/.test(ec), 'идёт сейчас: красная рамка и «▶ Зайти» в место', ec);
  MV.evSet({ id: 8, title: 'Было', starts_at: new Date(Date.now() - 7200e3).toISOString(), ends_at: new Date(Date.now() - 3600e3).toISOString(), status: 'active', place_kind: 'none', going: 1 });
  ok(/закончилось/.test(MV.cardHtml({ t: 'event', id: 8 })) && !/data-evgo/.test(MV.cardHtml({ t: 'event', id: 8 })), 'закончилось — без кнопки');
  ok(MV.evPlace({ place_kind: 'voice', place: '12', place_name: 'Голос', community: 3 }).href === '#/chat/c/3/12' && MV.evPlace({ place_kind: 'text', place: 'games' }).href === '#/chat/games', 'место: канал сообщества / сервера сайта');
  ok(/через \d+ мин/.test(MV.evWhen({ status: 'active', starts_at: new Date(Date.now() + 20 * 60e3).toISOString(), ends_at: soonEnd })), 'скоро: «через N мин»');

  // ═══ 14. «📅 События» (community2.js): строка над каналами, список, форма, без SQL — «скоро» ═══
  const X = window.D37DS.x, rpc0 = P.rpc;
  const fakeEl = () => Object.assign(document.createElement('div'), { isConnected: true, querySelector: () => null, querySelectorAll: () => [] });
  let calls = [];
  P.rpc = async (name, args) => { calls.push(name); return { error: { code: 'PGRST202', message: 'Could not find the function' }, missing: true }; };
  const off = { ok: true, official: true, id: 'd37', name: 'Денчик37', channels: [{ id: 'general', name: 'общий', kind: 'text' }, { id: 'voice', name: 'Голосовой', kind: 'voice' }] };
  let box2 = fakeEl();
  await X.sub.events.render(box2, 'page', off, []);
  ok(/Появится, когда сайт обновится/.test(box2.innerHTML), 'без community2.sql: «Появится, когда сайт обновится»', box2.innerHTML);
  ok(/<span>События<\/span>/.test(X.chanTop('page', off, '')) && /скоро/.test(X.chanTop('page', off, '')), 'строка «📅 События» — «скоро»');
  const later = new Date(Date.now() + 86400e3).toISOString(), later2 = new Date(Date.now() + 90000e3).toISOString();
  P.rpc = async (name, args) => {
    calls.push(name);
    if (name === 'cm_events') return { data: { ok: true, can: true, list: [
      { id: 11, title: 'Стрим Денчика', about: 'Играем', starts_at: new Date(Date.now() - 60e3).toISOString(), ends_at: later, place_kind: 'stream', place: '', age: 12, going: 5, mine: true, status: 'active', can: true },
      { id: 12, title: 'Взрослый турнир', starts_at: later, ends_at: later2, place_kind: 'game', place: 'chess', age: 18, going: 0, status: 'active', can: true }] } };
    return { data: null };
  };
  calls = []; box2 = fakeEl();
  await X.sub.events.render(box2, 'page', off, []);
  ok(calls.includes('cm_events') && /＋ Создать событие/.test(box2.innerHTML) && /✓ Иду · 5/.test(box2.innerHTML) && /▶ Зайти/.test(box2.innerHTML) && /href="#\/chat\/ev\/11"/.test(box2.innerHTML), 'список: «Создать», «✓ Иду · 5», идёт — «▶ Зайти», ссылка на событие', box2.innerHTML.slice(0, 400));
  ok(/ds-evlive/.test(X.chanTop('page', off, 'x:events')) && /ds-evrow on/.test(X.chanTop('page', off, 'x:events')), 'строка над каналами: «идёт», выбрана');
  window.D37Age = { listOk: n => n < 18, canOpen: n => n < 18, kid: () => false, badge: n => `<i>${n}+</i>` };
  box2 = fakeEl(); await X.sub.events.render(box2, 'page', off, []);
  ok(!/Взрослый турнир/.test(box2.innerHTML) && /Стрим Денчика/.test(box2.innerHTML), 'событие 18+ несовершеннолетнему не показываем');
  delete window.D37Age;
  window.currentUser = null;
  box2 = fakeEl(); let logged = '';
  const login0 = P.login; P.login = (el, t) => { logged = t; };
  await X.sub.events.render(box2, 'page', off, ['new']);
  ok(/вошедшие/.test(logged), 'создать событие — сначала войти');
  P.login = login0; P.rpc = rpc0;

  // ═══ 15. «🧭 Обзор сообществ» (community2.js): карточки, возраст, старый поиск без community2.sql ═══
  const cc = X.ccard({ id: 7, name: 'Клан хуйни', about: 'Играем', icon: '🎮', members: 12, category: 'games', age: 12, active_at: new Date().toISOString() }, 'page');
  ok(/data-join="7"/.test(cc) && /🎮 Игры/.test(cc) && /href="#\/chat\/c\/7"/.test(cc) && !/хуйни/.test(cc), 'карточка: «Вступить», категория, ссылка, мат закрыт', cc);
  window.D37Age = { listOk: n => n < 18, canOpen: n => n <= 6, kid: () => true, kidText: t => t, badge: n => `<i>${n}+</i>` };
  ok(/Не по возрасту/.test(X.ccard({ id: 8, name: 'Подростки', icon: '🔥', members: 3, category: 'chat', age: 12 }, 'page')) && !/data-join/.test(X.ccard({ id: 8, name: 'П', icon: '🔥', members: 3, age: 12 }, 'page')), 'ребёнку 12+ — без «Вступить»');
  ok(X.ccard({ id: 9, name: 'Взрослые', icon: '🔞', members: 3, age: 18 }, 'page') === '', '18+ несовершеннолетнему — не показываем');
  delete window.D37Age;
  let catCalls = [];
  P.rpc = async (name, args) => { catCalls.push([name, args]); if (name === 'cm_catalog') return { error: { code: 'PGRST202' }, missing: true }; if (name === 'cm_list_public') return { data: [{ id: 3, name: 'Старое', icon: '💬', members: 2 }] }; return { data: null }; };
  const fq = () => ({ value: '', hidden: false, addEventListener(){}, querySelectorAll: () => [] });
  const fbox = { innerHTML: '', isConnected: true, addEventListener(){}, querySelector: s => (fbox._q[s] = fbox._q[s] || fq()), _q: {} };
  X.find(fbox, 'page');
  await new Promise(res => setTimeout(res, 20));
  ok(catCalls.map(c => c[0]).join() === 'cm_catalog,cm_list_public' && /Старое/.test(fbox._q['[data-f="list"]'].innerHTML) && fbox._q['.ds-oldnote'].hidden === false, 'без community2.sql — старый поиск и подсказка «появятся, когда сайт обновится»');
  P.rpc = rpc0;

  // ═══ 16. «🎭 Свои роли» (community3.sql): права кнопок, цвет ника, группы участников ═══
  const MEMS = [{ id: 'o', nick: 'Владелец', role: 'owner', roles: [] }, { id: 'h', nick: 'Хелпер', role: 'member', roles: [21] }, { id: 'v', nick: 'Ветеран', role: 'member', roles: [22] },
    { id: 'n', nick: 'Новичок', role: 'member', roles: [] }, { id: 'h2', nick: 'Хелпер2', role: 'member', roles: [21, 22] }];
  P.rpc = async (name, args) => {
    if (name === 'cm_roles') return { data: { ok: true, roles: [{ id: 21, name: 'Хелпер', color: '#22c55e', position: 10, perms: 6 }, { id: 22, name: 'Ветеран', color: '#f59e0b', position: 5, perms: 0 }, { id: 23, name: 'Плохой', color: 'red;x', position: 1, perms: 0 }], my: 6, top: 10 } };
    if (name === 'cm_members') return { data: MEMS };
    return { data: null };
  };
  window.currentUser = { id: 'h' };
  const R0 = await X.roleData(77, true);
  ok(R0.roles.length === 2 && R0.my === 6 && R0.top === 10 && X.roleSync(77) === R0, 'роли: кривой цвет отброшен, мои права и место', R0);
  const A = DS.commAdapter({ c: { id: 77, name: 'Клан' }, role: 'member', staff: false, rt: null }, { id: 5, name: 'общий', kind: 'text' });
  await new Promise(res => setTimeout(res, 10));
  ok(A.canPin() === true && A.colorOf('v') === '#f59e0b' && A.colorOf('h2') === '#22c55e' && A.colorOf('n') === null, 'закреп по праву роли; цвет ника — по верхней роли');
  ok(A.modActions({ uid: 'v' }).length > 0 && A.modActions({ uid: 'n' }).length > 0, 'роль с модерацией: участников ниже — можно');
  ok(A.modActions({ uid: 'h2' }).length === 0 && A.modActions({ uid: 'o' }).length === 0 && A.modActions({ uid: 'h' }).length === 0, 'равного по роли, владельца и себя — нельзя');
  ok(A.canDel({ uid: 'n' }) === true && A.canDel({ uid: 'h2' }) === false, 'удалить сообщение — тоже по месту роли');
  const mbox = { innerHTML: '' };
  window.D37Chat.online = () => ({ users: MEMS.map(m => ({ id: m.id, nick: m.nick })), guests: 0, total: 5 });
  await DS.membersRender(mbox, { ok: true, id: 77, role: 'member', c: { members: 5 } });
  const hi = mbox.innerHTML.indexOf('Хелпер</span> — 2'), vi = mbox.innerHTML.indexOf('Ветеран</span> — 1'), ni = mbox.innerHTML.indexOf('🟢 В сети — 1');
  ok(hi > 0 && vi > hi && ni > vi && /color:#22c55e">Хелпер2</.test(mbox.innerHTML), 'участники: группы по верхней роли (выше — раньше), ник цветом роли', mbox.innerHTML.slice(0, 300));
  const rbox = fakeEl();
  await X.sub.roles.render(rbox, 'page', { ok: true, id: 77, name: 'Клан', role: 'member' });
  ok(/настраивает и выдаёт владелец/.test(rbox.innerHTML), 'экран ролей — только владельцу');
  await X.sub.roles.render(rbox, 'page', { ok: true, id: 77, name: 'Клан', role: 'owner' });
  ok(/＋ Добавить роль/.test(rbox.innerHTML) && /data-pb="16"/.test(rbox.innerHTML) && /data-ra="take" data-rid="21"/.test(rbox.innerHTML) && /＋ роль…/.test(rbox.innerHTML), 'владельцу: роли с правами, новая роль, кому какая (снять / выдать)');
  P.rpc = async () => ({ error: { code: 'PGRST202' }, missing: true });
  await X.sub.roles.render(rbox, 'page', { ok: true, id: 78, name: 'Клан', role: 'owner' });
  ok(/Появится, когда сайт обновится/.test(rbox.innerHTML), 'без community3.sql — «Появится, когда сайт обновится»');
  P.rpc = rpc0; delete window.currentUser;

  timers.forEach(t => clearInterval(t));
  console.log(`community-test: ${pass} ок, ${fail} ошибок`);
  process.exitCode = fail ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50);
})();

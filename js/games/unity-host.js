// ═══════════════════════════════════════
//  UNITY-ИГРЫ 🕹️ (#/games/unity) — игры игроков из Unity (WebGL): сборка лежит у автора, сайт встраивает её и даёт мост
// ═══════════════════════════════════════
// Маршруты: unity (каталог, мои игры), unity/new, unity/edit/<id>, unity/play/<id>[/<код комнаты>], unity/mod (персонал),
// unity/help (как сделать: SDK, сборка WebGL, где выложить, zip с SDK).
// Игра — iframe с адресом сборки (чужой сайт: GitHub Pages, itch.io…). Сайт ↔ игра — только postMessage по протоколу PROTO
// (типы IN/OUT ниже; тот же протокол — sdk/unity/Plugins/WebGL/D37Bridge.jslib и sdk/unity/TestPage). Сообщение игры
// принимается, только если оно из нашего iframe и с origin зарегистрированной сборки; поля — по белому списку, длины и
// частота ограничены (LIMITS). Игра получает игрока (ник, гость/вошёл, VIP, картинку персонажа), шлёт очки и итог раунда
// (unity_result: рекорды игры + общие лимиты сайта под одним ключом 'unity'), создаёт комнаты: первый вошедший — хост,
// ушёл хост — хостом становится следующий по времени входа. Комната — канал Supabase unity-<игра>-<код> (присутствие +
// сообщения); быстрые данные — напрямую WebRTC (netplay.js: хост ↔ каждый гость, «звезда»), без прямой связи — через
// Supabase не чаще 5 сообщений в секунду. Сервер — unity.sql; пока он не выполнен, игры хранятся только в браузере.
(() => {
  const PROTO = 1;
  const LS = 'd37_unity_drafts', LS_BEST = 'd37_unity_best';
  const SITE = 'https://dan4ik37.vercel.app';
  const SDK_URL = 'https://github.com/dan4ik37/dan4ik37.github.io/tree/main/sdk/unity';
  const OWN_HOSTS = ['dan4ik37.vercel.app', 'dan4ik37.github.io'];
  // Песочница сборки. allow-same-origin здесь безопасен: сборка всегда на ДРУГОМ сайте (свой адрес не принимаем ни при
  // сохранении, ни при запуске, а после загрузки проверяем ещё раз — sameOriginFrame), поэтому игра остаётся на своём
  // origin и до нашей страницы, cookies и localStorage (сессия Supabase) не дотянется. Опасно allow-scripts +
  // allow-same-origin только для документа с НАШЕГО адреса — он снял бы с себя песочницу. Без allow-same-origin origin
  // игры «null»: загрузчик Unity качает Build/* через CORS (у многих хостингов его нет), IndexedDB (PlayerPrefs, кэш сборки)
  // падает — сборки не запускаются. Не даём: allow-top-navigation (увести наш сайт), allow-popups (новые окна, фишинг),
  // allow-forms, allow-modals (поддельные окна alert/prompt), allow-downloads. Весь экран — атрибутом allow, не песочницей.
  const SANDBOX = 'allow-scripts allow-same-origin allow-pointer-lock';
  const ALLOW = 'fullscreen; autoplay; gamepad';
  // [сообщений в секунду, запас] — от игры к сайту; RELAY — что уходит в Supabase (лимит бесплатного тарифа)
  const LIMITS = { hello: [.5, 2], score: [10, 20], over: [1 / 3, 2], toast: [1, 3], log: [5, 10], 'room.create': [.5, 3], 'room.join': [.5, 3], 'room.leave': [.5, 3], 'room.send': [30, 60] };
  const RELAY = [5, 10], FLOOD = 120, INBOX = [60, 120];   // INBOX — сколько сообщений комнаты отдаём игре от одного игрока
  const MAX_DATA = 8192, MAX_PLAYERS = 8, ROUND_COINS = 50, SCORE_MAX = 1e9, RESULT_GAP = 10500;
  const OUT_TYPES = ['init', 'player', 'room.state', 'room.msg', 'room.error', 'result'];
  const STATUS = { draft: ['📝', 'Черновик'], link: ['🔗', 'По ссылке'], review: ['⏳', 'На проверке'], public: ['🌍', 'В каталоге'], hidden: ['🙈', 'Скрыта'], banned: ['⛔', 'Заблокирована'] };
  const ASPECTS = [['16:9', 'Широкий экран 16:9'], ['4:3', 'Обычный 4:3'], ['1:1', 'Квадрат 1:1'], ['3:4', 'Высокий 3:4'], ['9:16', 'Телефон 9:16 (вертикально)'], ['full', 'Во всё окно']];
  const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');
  const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
  const isStaff = () => { try { return typeof currentProfile !== 'undefined' && ['admin', 'moderator'].includes(currentProfile?.role); } catch (e) { return false; } };
  const devHost = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
  let root = null, api = null, S = null;   // S — состояние текущего экрана

  // ═══ Чистые функции (их проверяет scripts/unity-test.cjs) ═══

  // 53-битный хэш (cyrb53) → base36: номера игроков для игры (не отдаём ей id аккаунта)
  function hash36(str){
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const pid = (key, t) => 'p' + hash36(key + '~' + t);                                   // игрок в комнате (вход = новый номер)
  const uidOf = (key, game) => (/^g-/.test(key) ? 'g' : 'u') + hash36(key + ':' + game);   // человек в этой игре (постоянный)

  // Ссылка на сборку → { url, origin } или { reason }. Как unity_url() в unity.sql: https, имя сайта (не IP, без порта
  // и логина), не наш сайт, до 300 знаков, без # и пробелов/кавычек. dev — сайт открыт на localhost: можно и
  // http://localhost:порт (только черновик в браузере, на сервер такую ссылку не сохранить).
  function normUrl(raw, o = {}){
    const s = String(raw ?? '').trim();
    if (!s) return { reason: 'empty' };
    if (s.length > 300) return { reason: 'long' };
    let u;
    try { u = new URL(s); } catch (e) { return { reason: 'bad' }; }
    const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
    if (o.dev && local && (u.protocol === 'http:' || u.protocol === 'https:')) {
      if (u.username || u.password) return { reason: 'login' };
      if (o.own && u.origin === o.own) return { reason: 'own' };
      u.hash = '';
      return { url: u.href, origin: u.origin, dev: true };
    }
    if (u.protocol !== 'https:') return { reason: u.protocol === 'http:' ? 'http' : 'bad' };
    if (u.username || u.password) return { reason: 'login' };
    if (u.port) return { reason: 'port' };
    const host = u.hostname;
    if (host.length > 253 || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{1,59})$/.test(host)) return { reason: 'host' };
    if (OWN_HOSTS.includes(host) || /(^|\.)supabase\.(co|in)$/.test(host) || (o.own && u.origin === o.own)) return { reason: 'own' };
    if (s.includes('#')) return { reason: 'hash' };
    const rest = u.pathname + u.search;
    for (let i = 0; i < rest.length; i++) { const c = rest.charCodeAt(i); if (c < 33 || c === 127 || '"\'<>\\`^{}|'.includes(rest[i])) return { reason: 'chars' }; }
    const url = 'https://' + host + rest;
    if (url.length > 300) return { reason: 'long' };
    return { url, origin: 'https://' + host };
  }
  const URL_WHY = { empty: 'Вставь ссылку на index.html сборки', long: 'Слишком длинная ссылка (до 300 знаков)', bad: 'Это не похоже на ссылку',
    http: 'Нужна ссылка https:// (http:// браузер в игре не откроет)', login: 'В ссылке не должно быть логина и пароля', port: 'Ссылка без порта (:8080) — нужен обычный https-сайт',
    host: 'Нужен обычный адрес сайта (не IP и не localhost)', own: 'Это адрес самого сайта — сборка должна лежать на другом сайте (GitHub Pages, itch.io…)',
    hash: 'Убери из ссылки часть после #', chars: 'В ссылке пробелы или кавычки — скопируй её из адресной строки ещё раз' };

  // Сообщение игры → чистый объект (только известные поля, проверенные типы и длины) или null
  const isObj = d => !!d && typeof d === 'object' && !Array.isArray(d);
  function text(v, max){
    if (typeof v !== 'string' || v.length > max * 4) return '';
    let s = '';
    for (let i = 0; i < v.length && s.length < max; i++) { const c = v.charCodeAt(i); if (c >= 32 && c !== 127 && c !== 0x2028 && c !== 0x2029) s += v[i]; }
    return s.trim();
  }
  const int = (v, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
  const TYPE_RE = /^[A-Za-z0-9_.:-]{1,32}$/, ID_RE = /^[a-z0-9]{1,40}$/;
  const validCode = c => typeof c === 'string' && /^[a-z0-9]{4,12}$/.test(c);
  const IN = {
    hello: d => ({ sdk: text(d.sdk, 16), unity: text(d.unity, 32) }),
    score: d => { const n = int(d.n, 0, SCORE_MAX); return n == null ? null : { n }; },
    over: d => { const n = int(d.n, 0, SCORE_MAX); return n == null ? null : { n, win: d.win === true, coins: int(d.coins, 0, ROUND_COINS) || 0 }; },
    toast: d => { const s = text(d.text, 140); return s ? { text: s } : null; },
    log: d => { const s = text(d.text, 300); return s ? { text: s } : null; },
    'room.create': () => ({}),
    'room.join': d => (validCode(d.code) ? { code: d.code } : null),
    'room.leave': () => ({}),
    'room.send': d => {
      if (typeof d.type !== 'string' || !TYPE_RE.test(d.type)) return null;
      const data = d.data == null ? '' : typeof d.data === 'string' && d.data.length <= MAX_DATA ? d.data : null;
      const to = d.to == null || d.to === '' ? '' : typeof d.to === 'string' && ID_RE.test(d.to) ? d.to : null;
      if (data === null || to === null) return null;
      return { to, type: d.type, data, rel: d.rel !== false };
    },
  };
  function cleanIn(d){
    if (!isObj(d) || d.d37u !== PROTO || typeof d.t !== 'string' || !Object.prototype.hasOwnProperty.call(IN, d.t)) return null;
    let r = null;
    try { r = IN[d.t](d); } catch (e) { r = null; }
    return r ? { t: d.t, ...r } : null;
  }
  // Сообщение комнаты от другого игрока (через Supabase или напрямую) — та же проверка типа и длины
  function cleanWire(m){
    if (!isObj(m) || typeof m.ty !== 'string' || !TYPE_RE.test(m.ty)) return null;
    const d = m.d == null ? '' : m.d;
    if (typeof d !== 'string' || d.length > MAX_DATA) return null;
    return { ty: m.ty, d };
  }

  // Частота: «ведро» на каждый ключ — [rate в секунду, запас burst]; spec — объект по ключам или функция (одно правило всем).
  // Ключей больше 64 (кто-то перебирает номера отправителей) — вёдра заводятся заново: память не растёт
  function limiter(spec, now){
    let B = Object.create(null), keys = 0;
    return {
      allow(k){
        const s = typeof spec === 'function' ? spec(k) : spec[k];
        if (!s) return true;
        const t = now();
        if (!B[k] && ++keys > 64) { B = Object.create(null); keys = 1; }
        const b = B[k] || (B[k] = { n: s[1], at: t });
        b.n = Math.min(s[1], b.n + Math.max(0, t - b.at) / 1000 * s[0]); b.at = t;
        if (b.n < 1) return false;
        b.n -= 1;
        return true;
      },
    };
  }

  // Мост с одним iframe: принять сообщение (источник = наш iframe, origin = сборка, схема, частота) и отправить игре
  function createBridge(o){
    const now = o.now || Date.now, lim = limiter(LIMITS, now);
    let flood = 0, floodAt = 0;
    return {
      accept(e){
        const w = o.win();
        if (!e || !w || e.source !== w) return null;
        if (e.origin !== o.origin) { o.onWrongOrigin?.(e.origin); return null; }
        const t = now();
        if (t - floodAt >= 1000) { floodAt = t; flood = 0; }
        if (++flood > FLOOD) return null;   // поток сообщений — даже не разбираем
        const m = cleanIn(e.data);
        if (!m) return null;
        if (!lim.allow(m.t)) { o.onLimited?.(m.t); return null; }
        return m;
      },
      send(msg){
        const w = o.win();
        if (!w) return false;
        try { w.postMessage({ d37u: PROTO, ...msg }, o.origin); return true; } catch (e) { return false; }
      },
    };
  }

  // ═══ Комната: Supabase-канал (присутствие + сообщения), хост — первый по времени входа ═══
  // o: { open(name, key) → транспорт, game, code, max, me: { key, nick, guest }, net (NetPlay или null), now, setT, clearT,
  //      onState(state), onMessage(from, type, data), onError(reason), onMode() }
  // Транспорт: { onStatus, onSync(presenceState), onMsg(payload), track(meta), send(payload), close() } — для Supabase
  // это supaTransport, в тестах — подменный. Сообщения: { k: 'u', ty, d, u?, to?, only?, from?, fw?, _by } и
  // { k: 'np', to, np, _by } — служебные netplay.js (знакомство WebRTC).
  function createRoom(o){
    const now = o.now || Date.now, setT = o.setT || setTimeout, clearT = o.clearT || clearTimeout;
    const joinedAt = now();
    const R = { code: o.code, max: Math.max(2, Math.min(MAX_PLAYERS, o.max | 0 || 2)), me: pid(o.me.key, joinedAt), host: '', isHost: false, players: [], joined: false, closed: false };
    const links = new Map(), announced = new Map(), relayLim = limiter({ r: RELAY }, now), inLim = limiter(() => INBOX, now);
    let annT = 0, pend = [];
    const T = o.open(`unity-${o.game}-${o.code}`, o.me.key);
    const subT = setT(() => { if (!R.joined) fail('offline'); }, 12000);
    T.onStatus = st => {
      if (R.closed) return;
      if (st === 'SUBSCRIBED') Promise.resolve(T.track({ nick: o.me.nick, t: joinedAt, g: o.me.guest ? 1 : 0, v: PROTO })).catch(() => {});
      else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') fail('offline');
    };
    T.onSync = sync;
    T.onMsg = fromServer;

    const nick = v => text(v, 24) || 'Игрок';
    function sync(state){
      if (R.closed) return;
      const list = [];
      for (const key of Object.keys(state || {})) {
        const metas = Array.isArray(state[key]) ? state[key] : [];
        const m = metas.reduce((a, b) => (isObj(b) && typeof b.t === 'number' && (!a || b.t > a.t) ? b : a), null);
        if (!m) continue;
        list.push({ key, t: m.t, id: pid(key, m.t), uid: uidOf(key, o.game), nick: nick(m.nick), guest: !!m.g });
      }
      list.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const idx = list.findIndex(p => p.id === R.me);
      if (idx === -1) {
        // та же учётка (или гость этой вкладки) вошла позже из другой вкладки — эта уступает место
        if (R.joined && list.some(p => p.key === o.me.key)) fail('dup');
        return;
      }
      if (idx >= R.max) { fail('full'); return; }
      const first = !R.joined;
      R.joined = true; clearT(subT);
      R.players = list.slice(0, R.max);
      const ids = new Set(R.players.map(p => p.id));
      const host = R.players[0].id, hostChanged = host !== R.host;
      R.host = host; R.isHost = host === R.me;
      for (const [id, L] of links) if (hostChanged || !ids.has(id)) { L.close(); links.delete(id); }   // роли поменялись — связи заново
      const removed = [...announced.keys()].some(id => !ids.has(id));
      const added = R.players.some(p => !announced.has(p.id));
      // ушёл кто-то или сменился хост — сразу; новенького — через 0,8 с: сервер первые доли секунды ему ничего не доставляет
      if (first || removed || hostChanged) announce();
      else if (added) { if (!annT) annT = setT(announce, 800); }
      else if (R.players.some(p => announced.get(p.id)?.nick !== p.nick)) announce();
    }
    function state(){
      return { code: R.code, max: R.max, me: R.me, host: R.host,
        players: R.players.map(p => ({ id: p.id, uid: p.uid, nick: p.nick, guest: p.guest, host: p.id === R.host, me: p.id === R.me })) };
    }
    function announce(){
      clearT(annT); annT = 0;
      if (R.closed || !R.joined) return;
      announced.clear();
      for (const p of R.players) announced.set(p.id, p);
      ensureLinks();
      o.onState(state());
      flushPending();
    }

    // ── Прямая связь (netplay.js): хост ↔ каждый гость; хост предлагает соединение, гость ждёт ──
    function link(peer){
      const vroom = { get isHost(){ return R.isHost; }, send: m => T.send({ k: 'np', _by: R.me, to: peer, np: m }), peer, self: R.me, channel: `unity-${o.game}-${o.code}` };
      let np = null;
      try { np = o.net.start(vroom, { onMessage: m => fromPeer(peer, m), onMode: () => o.onMode?.() }); } catch (e) { np = null; }
      const L = {
        peer, mode: () => (np ? np.mode() : 'relay'),
        send(m, fast){ np?.send(m, fast); },
        handle(m){ return np ? np.handle(m) : false; },
        offer(){ if (np && !R.closed && R.isHost && links.get(peer) === L) np.offer(); },
        close(){ try { np?.close(); } catch (e) {} },
      };
      links.set(peer, L);
      return L;
    }
    function ensureLinks(){
      if (!o.net) return;
      if (R.isHost) { for (const p of R.players) if (p.id !== R.me && !links.has(p.id)) { const L = link(p.id); setT(() => L.offer(), 300); } }
      else if (R.host && !links.has(R.host)) link(R.host);
    }

    // ── Отправка ──
    const p2p = L => !!L && L.mode() === 'p2p';
    function relay(env){
      if (!relayLim.allow('r')) return 'rate';
      T.send({ ...env, _by: R.me });
      return 'ok';
    }
    function sendOne(to, msg){   // хост → гость или гость → хост: напрямую, иначе через сервер
      const L = links.get(to);
      if (p2p(L)) { L.send(msg, !!msg.u); return 'ok'; }
      return relay({ ...msg, to });
    }
    function sendAll(msg, skip){   // хост → все, кроме skip: напрямую кому можно, остальным одним сообщением через сервер
      const via = [];
      for (const p of R.players) {
        if (p.id === R.me || p.id === skip) continue;
        const L = links.get(p.id);
        if (p2p(L)) L.send(msg, !!msg.u); else via.push(p.id);
      }
      if (!via.length) return 'ok';
      return relay(via.length === 1 ? { ...msg, to: via[0] } : { ...msg, only: via });
    }
    // to: '' — всем, иначе номер игрока. Ответ: 'ok' | 'rate' | 'offline' | 'nobody' | 'self'
    R.send = (to, ty, d, rel = true) => {
      if (R.closed || !R.joined) return 'offline';
      const msg = { k: 'u', ty, d };
      if (!rel) msg.u = 1;
      if (!to) {
        if (R.isHost) return sendAll(msg, null);
        const L = links.get(R.host);
        if (p2p(L)) { L.send({ ...msg, fw: '*' }, !rel); return 'ok'; }   // хост сам разошлёт остальным
        return relay(msg);
      }
      if (to === R.me) return 'self';
      if (!R.players.some(p => p.id === to)) return 'nobody';
      if (R.isHost || to === R.host) return sendOne(to, msg);
      const L = links.get(R.host);
      if (p2p(L)) { L.send({ ...msg, fw: to }, !rel); return 'ok'; }
      return relay({ ...msg, to });
    };

    // ── Приём ──
    function fromServer(p){
      if (R.closed || !R.joined || !isObj(p) || typeof p._by !== 'string' || p._by === R.me || !ID_RE.test(p._by)) return;
      if (p.to != null && p.to !== R.me) return;
      if (p.only != null && !(Array.isArray(p.only) && p.only.length <= MAX_PLAYERS && p.only.includes(R.me))) return;
      if (p.k === 'np') {
        if (p.to !== R.me || !isObj(p.np) || typeof p.np.type !== 'string') return;
        let L = links.get(p._by);
        if (!L && o.net && !R.isHost && p._by === R.host) L = link(p._by);
        L?.handle(p.np);
        return;
      }
      if (p.k !== 'u') return;
      const c = cleanWire(p);
      if (!c) return;
      // «от кого» за другого может сказать только хост (он пересылает сообщения гостей)
      const from = p._by === R.host && typeof p.from === 'string' && ID_RE.test(p.from) ? p.from : p._by;
      deliver(from, c.ty, c.d);
    }
    function fromPeer(peer, m){
      if (R.closed || !isObj(m) || m.k !== 'u') return;
      const c = cleanWire(m);
      if (!c) return;
      if (R.isHost) {
        const fwd = { k: 'u', ty: c.ty, d: c.d, from: peer };
        if (m.u) fwd.u = 1;
        if (m.fw === '*') { deliver(peer, c.ty, c.d); sendAll(fwd, peer); return; }
        if (typeof m.fw === 'string' && ID_RE.test(m.fw) && m.fw !== R.me) { if (R.players.some(p => p.id === m.fw)) sendOne(m.fw, fwd); return; }
        deliver(peer, c.ty, c.d);
        return;
      }
      if (peer !== R.host) return;
      deliver(typeof m.from === 'string' && ID_RE.test(m.from) ? m.from : peer, c.ty, c.d);
    }
    // Игре — только от тех, о ком она уже знает: новенького сначала объявляем, неизвестного ждём до 3 с.
    // От одного игрока — не больше INBOX в секунду (наш сайт столько не шлёт; это чужой клиент мимо сайта)
    function deliver(from, ty, d){
      if (!inLim.allow(from)) return;
      if (announced.has(from)) { o.onMessage(from, ty, d); return; }
      if (R.players.some(p => p.id === from)) { announce(); o.onMessage(from, ty, d); return; }
      pend.push({ from, ty, d, at: now() });
      if (pend.length > 50) pend.shift();
    }
    function flushPending(){
      if (!pend.length) return;
      const t = now(), keep = [];
      for (const x of pend) { if (announced.has(x.from)) o.onMessage(x.from, x.ty, x.d); else if (t - x.at < 3000) keep.push(x); }
      pend = keep;
    }

    function fail(reason){ if (R.closed) return; R.leave(); o.onError(reason); }
    R.leave = () => {
      if (R.closed) return;
      R.closed = true;
      clearT(annT); clearT(subT);
      for (const L of links.values()) L.close();
      links.clear();
      try { T.close(); } catch (e) {}
    };
    R.state = state;
    R.modes = () => [...links.values()].map(L => L.mode());
    R._links = links;
    return R;
  }

  // Транспорт комнаты — Supabase Realtime (как room.js / table.js)
  function supaTransport(name, key){
    const ch = sbClient.channel(name, { config: { broadcast: { self: false }, presence: { key } } });
    const T = { onStatus: null, onSync: null, onMsg: null };
    ch.on('broadcast', { event: 'm' }, ({ payload }) => T.onMsg?.(payload));
    ch.on('presence', { event: 'sync' }, () => T.onSync?.(ch.presenceState()));
    ch.subscribe(st => T.onStatus?.(st));
    T.track = meta => ch.track(meta);
    T.send = payload => { ch.send({ type: 'broadcast', event: 'm', payload }).catch(() => {}); };
    T.close = () => { try { ch.untrack(); sbClient.removeChannel(ch); } catch (e) {} };
    return T;
  }

  // ═══ Zip без сжатия — «📦 Скачать SDK» одним файлом (файлы SDK лежат на сайте в /sdk/unity/) ═══
  let CRC = null;
  function crc32(u8){
    if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    let x = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) x = CRC[(x ^ u8[i]) & 255] ^ (x >>> 8);
    return (x ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files){   // files: [{ name, data: Uint8Array }] → Uint8Array (.zip, имена UTF-8)
    const enc = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const size = cen.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    const all = [...parts, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }
  const SDK_FILES = ['README.md', 'package.json', 'Runtime/D37.cs', 'Runtime/D37Bridge.cs', 'Runtime/Dan4ik37.SDK.asmdef', 'Plugins/WebGL/D37Bridge.jslib',
    'Editor/D37Setup.cs', 'Editor/Dan4ik37.SDK.Editor.asmdef', 'Samples/D37Example.cs', 'Samples/Dan4ik37.SDK.Samples.asmdef', 'WebGLTemplates/D37/index.html'];
  async function downloadSdk(btn){
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '⏳ Собираем…';
    try {
      const files = [];
      for (const f of SDK_FILES) {
        const r = await fetch('/sdk/unity/' + f, { cache: 'no-cache' });
        if (!r.ok) throw new Error(f);
        files.push({ name: 'D37SDK/' + f, data: new Uint8Array(await r.arrayBuffer()) });
      }
      const blob = new Blob([zip(files)], { type: 'application/zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'D37SDK.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      btn.textContent = '✅ Скачано';
    } catch (e) {
      btn.textContent = old;
      api?.toast('Не получилось собрать архив — возьми папку SDK на GitHub');
    }
    btn.disabled = false;
  }

  // ═══ Игрок, черновики, сервер ═══
  function guestId(){
    if (window.GameRoom?.guestId) return window.GameRoom.guestId();
    let id = '';
    try { id = sessionStorage.getItem('d37_room_gid') || ''; } catch (e) {}
    if (!id) { id = 'g-' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('d37_room_gid', id); } catch (e) {} }
    return id;
  }
  function nickNow(){
    if (window.GameRoom?.nick) return window.GameRoom.nick();
    if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick;
    let n = '';
    try { n = sessionStorage.getItem('d37_duel_guest') || ''; } catch (e) {}
    if (!n) { n = 'Гость ' + Math.floor(100 + Math.random() * 900); try { sessionStorage.setItem('d37_duel_guest', n); } catch (e) {} }
    return n;
  }
  function perks(){
    try { if (window.D37Coins?.perks) return !!window.D37Coins.perks(); } catch (e) {}
    try { return typeof currentProfile !== 'undefined' && !!currentProfile && typeof hasPerks === 'function' && !!hasPerks(currentProfile.role, currentProfile); } catch (e) { return false; }
  }
  function me(game){
    const key = authed() ? currentUser.id : guestId();
    return { key, id: uidOf(key, game), nick: text(nickNow(), 24) || 'Игрок', guest: !authed(), vip: perks() };
  }
  function avatarPng(){
    try { const s = window.D37Char ? window.D37Char.img(window.D37Char.look(), 64) : ''; return typeof s === 'string' && s.length < 60000 ? s : ''; } catch (e) { return ''; }
  }

  function drafts(){ try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } }
  function putDraft(d){ const all = drafts(); all[d.id] = { ...d, updated: Date.now() }; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} }
  function dropDraft(id){ const all = drafts(); delete all[id]; try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} }
  const bestOf = id => { try { return (JSON.parse(localStorage.getItem(LS_BEST) || '{}') || {})[id] || 0; } catch (e) { return 0; } };
  function saveBest(id, v){ try { const b = JSON.parse(localStorage.getItem(LS_BEST) || '{}') || {}; if (v > (b[id] || 0)) { b[id] = v; localStorage.setItem(LS_BEST, JSON.stringify(b)); return true; } } catch (e) {} return false; }

  let srvMissing = false;
  async function rpc(name, args){
    if (typeof sbClient === 'undefined' || !sbClient || srvMissing) return null;
    try {
      const { data, error } = await sbClient.rpc(name, args || {});
      if (error) { if (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || '')) srvMissing = true; return { ok: false, reason: 'error' }; }
      return data;
    } catch (e) { return null; }
  }
  async function select(q){
    if (typeof sbClient === 'undefined' || !sbClient || srvMissing) return null;
    try {
      const { data, error } = await q(sbClient.from('unity_games'));
      if (error) { if (error.code === '42P01' || /does not exist|Could not find/i.test(error.message || '')) srvMissing = true; return null; }
      return data;
    } catch (e) { return null; }
  }
  const LIGHT = 'id,title,icon,descr,url,origin,aspect,players,status,plays,likes,created_at,updated_at,author,profiles(nick)';
  const go = p => { location.hash = '#/games/unity' + (p ? '/' + p : ''); };
  const playLink = (id, code) => location.origin + location.pathname + '#/games/unity/play/' + id + (code ? '/' + code : '');
  function newCode(){ let c = ''; for (let i = 0; i < 6; i++) c += ABC[Math.floor(Math.random() * ABC.length)]; return c; }
  const roundRef = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 24);
  const arOf = a => { const m = /^(\d+):(\d+)$/.exec(a || ''); return m ? [+m[1], +m[2]] : null; };

  // ═══ Экраны ═══
  function show(param){
    stopScreen();
    const [a, b, c] = String(param || '').split('/');
    if (a === 'new') editor({ isNew: true });
    else if (a === 'edit' && b) editor({ id: b });
    else if (a === 'play' && b) play(b, validCode(c) ? c : '');
    else if (a === 'mod') moderation();
    else if (a === 'help') help();
    else home();
  }
  function stopScreen(){
    if (!S) return;
    S.session?.stop();
    S = null;
  }

  // ── Главная: мои игры и каталог ──
  function home(){
    S = { screen: 'home' };
    const st = S;
    root.innerHTML = `<div class="st un">
      <div class="st-hero"><div><h2>🕹️ Unity-игры</h2><p>Игры, которые игроки сделали в Unity, — прямо на сайте. Зови друзей в комнату по ссылке:
        кто зашёл первым, тот и хост — его игра ведёт партию, остальные подхватывают.</p>
        <div class="un-hero-a"><a class="st-btn gold" href="#/games/unity/new">➕ Добавить свою игру из Unity</a><a class="st-btn ghost" href="#/games/unity/help">📘 Как сделать игру</a></div></div></div>
      <h3 class="st-h">📁 Мои Unity-игры</h3>
      <div class="un-mine"><div class="st-empty">Загружаем…</div></div>
      <h3 class="st-h">🌍 Игры игроков <span class="st-sort"><button type="button" data-sort="plays" class="on">Популярные</button><button type="button" data-sort="new">Новые</button></span></h3>
      <div class="un-cat"><div class="st-empty">Загружаем…</div></div>
      <div class="un-mod-link" hidden></div>
      <div class="st-rules"><b>Правила:</b> никаких оскорблений, взрослого контента, азартных игр и просьб ввести пароль. В каталог игры попадают после
        проверки модератором, до этого — только по ссылке. За популярные игры автор получает монеты 🪙.</div>
    </div>`;
    root.querySelector('.st-sort').addEventListener('click', e => { const b = e.target.closest('[data-sort]'); if (!b) return; root.querySelectorAll('.st-sort button').forEach(x => x.classList.toggle('on', x === b)); catalog(st, b.dataset.sort); });
    mine(st);
    catalog(st, 'plays');
    if (isStaff()) { const box = root.querySelector('.un-mod-link'); box.hidden = false; box.innerHTML = '<a class="st-btn" href="#/games/unity/mod">🛡️ Модерация Unity-игр</a>'; }
  }
  async function mine(st){
    const local = Object.values(drafts());
    let srv = [];
    if (authed()) srv = await select(q => q.select(LIGHT).eq('author', currentUser.id).order('updated_at', { ascending: false }).limit(60)) || [];
    if (S !== st || !root) return;
    const box = root.querySelector('.un-mine');
    const ids = new Set(srv.map(g => g.id));
    const list = [...srv.map(g => ({ ...g, srv: true })), ...local.filter(d => !ids.has(d.id)).map(d => ({ ...d, status: 'draft', local: true }))]
      .sort((a, b) => new Date(b.updated_at || b.updated || 0) - new Date(a.updated_at || a.updated || 0));
    if (!list.length) { box.innerHTML = '<div class="st-empty">Пока пусто. Собери игру в Unity под WebGL, выложи её и добавь сюда — <a href="#/games/unity/help">как это сделать</a>.</div>'; return; }
    box.innerHTML = `<div class="st-list">${list.map(g => {
      const [si, sn] = STATUS[g.status] || STATUS.draft;
      return `<div class="st-row"><span class="st-row-ic">${esc(g.icon || '🕹️')}</span>
        <div class="st-row-b"><b>${esc(g.title || 'Без названия')}</b><small><span class="st-chip st-${esc(g.status)}">${si} ${sn}</span>${g.srv ? ` · 👁 ${num(g.plays)} · ❤️ ${num(g.likes)}` : ' · только в этом браузере'}</small></div>
        <span class="st-row-a"><a class="st-btn" href="#/games/unity/play/${esc(g.id)}">▶</a><a class="st-btn ghost" href="#/games/unity/edit/${esc(g.id)}">✏️</a></span></div>`;
    }).join('')}</div>`;
  }
  const cardHtml = g => `<a class="st-card" href="#/games/unity/play/${esc(g.id)}"><span class="st-card-ic">${esc(g.icon || '🕹️')}</span><b>${esc(g.title)}</b>
    ${g.players > 1 ? `<small class="un-badge">👥 до ${g.players | 0}</small>` : ''}
    <small class="st-card-au">👤 ${esc(g.profiles?.nick || 'Игрок')}${g.author ? `<span class="lv-badge" data-lv-uid="${esc(g.author)}"></span>` : ''}</small>
    <small>👁 ${num(g.plays)} · ❤️ ${num(g.likes)}</small></a>`;
  async function catalog(st, sort){
    const rows = await select(q => q.select(LIGHT).eq('status', 'public').order(sort === 'new' ? 'created_at' : 'plays', { ascending: false }).limit(30));
    if (S !== st || !root) return;
    const box = root.querySelector('.un-cat');
    if (!rows) { box.innerHTML = `<div class="st-empty">${srvMissing ? 'Каталог откроется совсем скоро — сайт обновляется.' : 'Не получилось загрузить — обнови страницу.'}</div>`; return; }
    if (!rows.length) { box.innerHTML = '<div class="st-empty">Здесь будут игры игроков из Unity. Сделай свою — может, она будет первой!</div>'; return; }
    box.innerHTML = `<div class="st-grid">${rows.map(cardHtml).join('')}</div>`;
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
  }

  // ── Добавить / изменить игру ──
  async function editor(o){
    S = { screen: 'edit', game: null, session: null };
    const st = S;
    let g;
    if (o.isNew) g = { id: 'l' + Date.now().toString(36), title: '', icon: '🕹️', descr: '', url: '', aspect: '16:9', players: 1, status: 'draft', local: true };
    else {
      g = drafts()[o.id] ? { ...drafts()[o.id], local: true } : null;
      const row = await select(q => q.select('id,title,icon,descr,url,origin,aspect,players,status,plays,likes,author').eq('id', o.id).maybeSingle());
      if (S !== st) return;
      if (row) { if (!authed() || row.author !== currentUser.id) { go('play/' + o.id); return; } g = { ...row, srv: true }; }
      if (!g) { root.innerHTML = '<div class="st"><div class="st-empty">Игра не найдена. <a href="#/games/unity">К Unity-играм</a></div></div>'; return; }
    }
    st.game = g;
    root.innerHTML = `<div class="st un-ed">
      <div class="st-top"><a class="st-back" href="#/games/unity">← Unity-игры</a><b>🕹️ ${o.isNew ? 'Новая игра из Unity' : 'Игра из Unity'}</b><span class="st-saved"></span></div>
      <div class="st-ed-grid">
        <div class="st-prev">
          <div class="un-box un-prev"><div class="un-load">Вставь ссылку на сборку и нажми «▶ Проверить»</div></div>
          <div class="un-bar"><button type="button" class="st-btn" data-act="test">▶ Проверить</button><span class="un-sdk"></span><span class="st-score un-score"></span></div>
          <div class="un-note" hidden></div>
          <div class="un-room" hidden></div>
          <div class="st-result" hidden></div>
        </div>
        <div class="st-form">
          <label class="st-f"><span>Название игры</span><input data-f="title" maxlength="60" value="${esc(g.title)}" placeholder="Например: Космический бегун"></label>
          <div class="st-f2">
            <label class="st-f"><span>Значок</span><input data-f="icon" maxlength="12" value="${esc(g.icon)}" class="st-emoji-in"></label>
            <label class="st-f st-grow"><span>Описание (для друзей и каталога)</span><input data-f="descr" maxlength="300" value="${esc(g.descr || '')}" placeholder="Во что играть и как"></label>
          </div>
          <label class="st-f"><span>Ссылка на сборку WebGL (index.html) <i>— <a href="#/games/unity/help">где взять</a></i></span>
            <input data-f="url" maxlength="300" value="${esc(g.url)}" placeholder="https://ник.github.io/моя-игра/index.html" spellcheck="false" inputmode="url"></label>
          <div class="un-url-hint"></div>
          <div class="st-f2 un-f2">
            <label class="st-f st-grow"><span>Форма окна игры</span><select data-f="aspect">${ASPECTS.map(([v, n]) => `<option value="${v}"${g.aspect === v ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="st-f st-grow"><span>Игроков</span><select data-f="players"><option value="1"${g.players == 1 ? ' selected' : ''}>Один (без комнат)</option>${[2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}"${g.players == n ? ' selected' : ''}>До ${n} в комнате</option>`).join('')}</select></label>
          </div>
          <div class="st-actions">
            <button type="button" class="st-btn gold" data-act="save">💾 Сохранить</button>
            <button type="button" class="st-btn" data-act="publish">🔗 Ссылка для друзей</button>
            <button type="button" class="st-btn" data-act="review">🌍 В каталог</button>
            ${o.isNew ? '' : '<button type="button" class="st-btn ghost danger" data-act="delete">🗑</button>'}
          </div>
          <div class="st-status"></div>
          <div class="st-rules">Сборка остаётся на твоём сайте (GitHub Pages, itch.io…), здесь — только ссылка. Чтобы работали ник игрока, очки, монеты и
            комнаты, в игре нужен <a href="#/games/unity/help">SDK Денчика</a> — «▶ Проверить» покажет, подключился ли он.</div>
        </div>
      </div>
    </div>`;
    const form = root.querySelector('.st-form');
    form.addEventListener('input', e => onEdit(st, e));
    form.addEventListener('change', e => onEdit(st, e));
    form.addEventListener('click', e => onEditClick(st, e));
    root.querySelector('.un-bar').addEventListener('click', e => { if (e.target.closest('[data-act="test"]')) testRun(st); });
    urlHint(st);
    statusLine(st);   // сборку сами не грузим (десятки МБ) — только по «▶ Проверить»
  }
  function onEdit(st, e){
    if (st !== S) return;
    const el = e.target, f = el.dataset.f;
    if (!f) return;
    st.game[f] = f === 'players' ? +el.value : el.value;
    if (f === 'url') urlHint(st);
    const s = root.querySelector('.st-saved'); if (s) s.textContent = '';
    clearTimeout(st.saveT);
    st.saveT = setTimeout(() => saveLocal(st), 700);
  }
  function urlHint(st){
    const el = root?.querySelector('.un-url-hint');
    if (!el) return;
    const g = st.game;
    if (!g.url) { el.innerHTML = ''; return; }
    const r = normUrl(g.url, { dev: devHost(), own: location.origin });
    el.className = 'un-url-hint ' + (r.url ? 'ok' : 'bad');
    el.textContent = r.url ? (r.dev ? '🧪 Ссылка на этот компьютер — проверить можно, на сайт её не сохранить' : `✅ Игра откроется с сайта ${r.origin.replace('https://', '')}`
      + (/(\/|\.html?)$/i.test(new URL(r.url).pathname) ? '' : ' — проверь, что ссылка ведёт на index.html сборки')) : '⚠️ ' + (URL_WHY[r.reason] || 'Ссылка не подходит');
  }
  function saveLocal(st){
    if (st !== S) return;
    const g = st.game;
    putDraft({ id: g.id, title: g.title, icon: g.icon, descr: g.descr, url: g.url, aspect: g.aspect, players: g.players, srv: !!g.srv });
    const s = root?.querySelector('.st-saved'); if (s) s.textContent = '✓ сохранено в браузере';
  }
  function statusLine(st){
    const el = root?.querySelector('.st-status');
    if (!el) return;
    const g = st.game, [si, sn] = STATUS[g.status] || STATUS.draft;
    const link = g.srv && ['link', 'review', 'public'].includes(g.status);
    el.innerHTML = `<span class="st-chip st-${esc(g.status)}">${si} ${sn}</span>
      ${link ? `<button type="button" class="st-btn ghost" data-act="copy-link">📤 Скопировать ссылку</button><a class="st-btn ghost" href="#/games/unity/play/${esc(g.id)}">▶ Страница игры</a>` : ''}
      <small>${!authed() ? 'Войди в аккаунт — тогда игру можно сохранить на сайте и дать ссылку друзьям.' : srvMissing ? 'Публикация заработает чуть позже — сайт обновляется. Пока игра хранится в этом браузере.'
        : g.status === 'review' ? 'Игру проверит модератор — после этого она появится в каталоге. По ссылке играть уже можно.'
        : g.status === 'public' ? 'Игра в каталоге! Если изменишь её, она снова уйдёт на проверку.'
        : g.status === 'banned' ? 'Игру заблокировал модератор — она нарушает правила.' : ''}</small>`;
  }
  function testRun(st){
    if (st !== S) return;
    const g = st.game, r = normUrl(g.url, { dev: devHost(), own: location.origin });
    if (!r.url) { urlHint(st); api.toast('⚠️ ' + (URL_WHY[r.reason] || 'Ссылка не подходит')); return; }
    st.session?.stop();
    st.session = session(root.querySelector('.st-prev'), { ...g, url: r.url, origin: r.origin }, { preview: true });
  }
  async function onEditClick(st, e){
    const b = e.target.closest('button');
    if (!b || st !== S) return;
    const g = st.game, act = b.dataset.act;
    if (act === 'save') return saveServer(st, null);
    if (act === 'publish') return saveServer(st, 'link');
    if (act === 'review') return saveServer(st, 'review');
    if (act === 'copy-link') return share(g, null);
    if (act === 'delete') {
      if (!confirm('Удалить игру «' + (g.title || '') + '» с сайта? Сама сборка на твоём хостинге останется.')) return;
      if (g.srv) { const r = await rpc('unity_status', { p_id: g.id, p_status: 'deleted' }); if (!r?.ok) { api.toast(r?.reason === 'banned' ? 'Заблокированную игру удалить нельзя' : 'Не получилось удалить'); return; } }
      dropDraft(g.id);
      api.toast('🗑 Игра удалена');
      go('');
    }
  }
  async function saveServer(st, want){
    const g = st.game;
    saveLocal(st);
    if (!authed()) { api.toast('🔑 Войди, чтобы сохранить игру на сайте'); if (typeof openGlobalAuth === 'function') openGlobalAuth(); return; }
    if ((g.title || '').trim().length < 2) { api.toast('Придумай название игры'); return; }
    const r0 = normUrl(g.url, { own: location.origin });
    if (!r0.url) { api.toast('⚠️ ' + (URL_WHY[r0.reason] || 'Ссылка не подходит')); urlHint(st); return; }
    const r = await rpc('unity_save', { p_id: g.srv ? g.id : null, p_title: g.title.trim(), p_descr: (g.descr || '').trim(), p_icon: (g.icon || '🕹️').trim(),
      p_url: r0.url, p_aspect: g.aspect || '16:9', p_players: g.players | 0 || 1 });
    if (st !== S) return;
    if (!r || !r.ok) {
      api.toast(srvMissing || !r ? 'Сохранение на сайте заработает чуть позже — игра сохранена в браузере' : r.reason === 'limit' ? 'Слишком много игр — удали старые'
        : r.reason === 'too_fast' ? 'Подожди пару секунд' : r.reason === 'banned' ? 'Эту игру заблокировал модератор' : r.reason === 'url' ? 'Сервер не принял ссылку — нужна https-ссылка на другой сайт' : 'Не сохранилось — попробуй ещё раз');
      statusLine(st);
      return;
    }
    if (!g.srv) { dropDraft(g.id); g.id = r.id; g.srv = true; g.local = false; history.replaceState(null, '', '#/games/unity/edit/' + r.id); }
    g.url = r.url || r0.url; g.origin = r.origin || r0.origin; g.status = r.status || g.status;
    if (want && want !== g.status) {
      const s2 = await rpc('unity_status', { p_id: g.id, p_status: want });
      if (s2?.ok) g.status = s2.status; else api.toast('Статус не поменялся — попробуй ещё раз');
    }
    putDraft({ id: g.id, title: g.title, icon: g.icon, descr: g.descr, url: g.url, aspect: g.aspect, players: g.players, srv: true });
    const s = root?.querySelector('.st-saved'); if (s) s.textContent = '✓ сохранено на сайте';
    statusLine(st);
    if (want === 'link' || want === 'review') share(g, null); else api.toast('💾 Сохранено');
  }

  // ── Страница игры ──
  async function play(id, code){
    S = { screen: 'play', id, game: null, session: null };
    const st = S;
    root.innerHTML = '<div class="st"><div class="st-empty">Загружаем игру…</div></div>';
    let g = null;
    const row = await select(q => q.select(LIGHT).eq('id', id).maybeSingle());
    if (S !== st) return;
    if (row) g = { ...row, srv: true };
    else if (drafts()[id]) g = { ...drafts()[id], status: 'draft', local: true };
    if (g) {
      const r = normUrl(g.url, { dev: !!g.local && devHost(), own: location.origin });
      if (!r.url || (g.origin && g.srv && r.origin !== g.origin)) g = null;
      else { g.url = r.url; g.origin = r.origin; }
    }
    if (!g) { root.innerHTML = '<div class="st"><div class="st-empty">Игра не найдена или скрыта автором. <a href="#/games/unity">Другие Unity-игры</a></div></div>'; return; }
    st.game = g;
    const mineG = authed() && g.author === currentUser.id;
    root.innerHTML = `<div class="st un-play">
      <div class="st-top"><a class="st-back" href="#/games/unity">← Unity-игры</a></div>
      <div class="st-play-head"><span class="st-play-ic">${esc(g.icon || '🕹️')}</span>
        <div class="st-play-t"><b>${esc(g.title)}</b><small>${g.srv ? `от <a href="#/profile/${esc(g.author)}">${esc(g.profiles?.nick || 'игрока')}</a> · 👁 ${num(g.plays)} · ❤️ <span class="un-likes2">${num(g.likes)}</span>` : 'черновик в этом браузере'}${g.players > 1 ? ` · 👥 до ${g.players | 0}` : ''} ${g.status !== 'public' && g.srv ? `· <span class="st-chip st-${esc(g.status)}">${(STATUS[g.status] || STATUS.draft).join(' ')}</span>` : ''}</small></div>
        <span class="st-play-a">
          ${g.srv ? `<button type="button" class="st-btn ghost" data-act="like">❤️ <span class="un-likes">${num(g.likes)}</span></button><button type="button" class="st-btn ghost" data-act="share">📤</button>` : ''}
          ${mineG || g.local ? `<a class="st-btn ghost" href="#/games/unity/edit/${esc(g.id)}">✏️</a>` : g.srv ? '<button type="button" class="st-btn ghost" data-act="report" title="Пожаловаться">⚠️</button>' : ''}
        </span></div>
      <div class="un-stage"></div>
      ${g.descr ? `<p class="st-descr">${esc(g.descr)}</p>` : ''}
      <div class="un-top" hidden></div>
      <div class="st-cta"><span>Делаешь игры в Unity? Добавь свою — друзья сыграют прямо на сайте.</span><a class="st-btn gold" href="#/games/unity/help">🕹️ Как добавить игру</a></div>
      <div class="st-warn">Это игра игрока, она открыта с другого сайта (${esc(g.origin.replace(/^https?:\/\//, ''))}). Никогда не вводи в играх пароли и личные данные.</div>
    </div>`;
    root.querySelector('.st-play-head').addEventListener('click', e => onPlayClick(st, e));
    const stage = root.querySelector('.un-stage');
    stage.innerHTML = `<div class="un-box"><div class="un-load">🕹️ Загружаем игру…<small>Unity-игры грузятся до минуты</small></div></div>
      <div class="un-bar"><button type="button" class="st-btn ghost" data-act="fs">⛶ На весь экран</button><span class="un-sdk"></span><span class="st-score un-score"></span></div>
      <div class="un-note" hidden></div><div class="un-room" hidden></div><div class="st-result" hidden></div><div class="st-ad" hidden></div>`;
    if (code && g.players < 2) history.replaceState(null, '', '#/games/unity/play/' + g.id);
    st.session = session(stage, g, { preview: false, code: g.players > 1 ? code : '', own: mineG, onTop: () => topList(st, g),
      onLoad: () => { if (g.srv) rpc('unity_play', { p_id: g.id }); } });   // запуск = страница сборки открылась (сервер: раз в 30 мин с человека)
    topList(st, g);
  }
  async function topList(st, g){
    if (!g.srv || typeof sbClient === 'undefined' || !sbClient || srvMissing) return;
    let rows = null;
    try { const { data, error } = await sbClient.rpc('unity_top', { p_id: g.id, lim: 10 }); if (!error) rows = data; } catch (e) {}
    if (S !== st || !root) return;
    const box = root.querySelector('.un-top');
    if (!box || !rows?.length) return;
    box.hidden = false;
    box.innerHTML = `<h3 class="st-h">🏆 Рекорды игры</h3><ol class="un-top-list">${rows.map((r, i) => `<li><span class="un-top-pl">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
      <a href="#/profile/${esc(r.user_id)}">${esc(r.nick || 'Игрок')}</a><span class="lv-badge" data-lv-uid="${esc(r.user_id)}"></span><b>${num(r.best)}</b></li>`).join('')}</ol>`;
    if (typeof xpQueueBadges === 'function') xpQueueBadges();
  }
  async function onPlayClick(st, e){
    const b = e.target.closest('[data-act]');
    if (!b || st !== S) return;
    const g = st.game, act = b.dataset.act;
    if (act === 'share') share(g, null);
    else if (act === 'like') {
      if (!authed()) { api.toast('🔑 Войди, чтобы ставить лайки'); return; }
      const r = await rpc('unity_like', { p_id: g.id });
      if (r?.ok) { b.classList.toggle('on', !!r.liked); root.querySelectorAll('.un-likes,.un-likes2').forEach(s => { s.textContent = num(r.likes); }); api.sfx('ok'); }
    } else if (act === 'report') {
      if (!authed()) { api.toast('🔑 Войди, чтобы пожаловаться'); return; }
      const why = prompt('Что не так с игрой? (оскорбления, взрослое, просит пароль, не работает…)');
      if (!why) return;
      const r = await rpc('unity_report', { p_id: g.id, p_reason: why.slice(0, 200) });
      api.toast(r?.ok ? '⚠️ Спасибо! Модератор посмотрит' : 'Не отправилось — попробуй позже');
    }
  }
  function share(g, code){
    const url = code ? playLink(g.id, code) : SITE + '/#/games/unity/play/' + g.id;
    const text = code ? `Заходи ко мне в «${g.title}» — играем вместе!` : `Сыграй в «${g.title}» — игра из Unity на сайте dan4ik37`;
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ title: g.title, text, url }).catch(() => {}); return; }
    navigator.clipboard?.writeText(url).then(() => api.toast('🔗 Ссылка скопирована'), () => prompt('Ссылка:', url));
  }

  // ═══ Игровая сессия: iframe + мост + комната + полоса под игрой. box — контейнер с .un-box, .un-bar, .un-note, .un-room, .st-result ═══
  function sameOriginFrame(f){ try { const h = f.contentWindow.location.href; return !!h && h !== 'about:blank'; } catch (e) { return false; } }
  function session(box, g, opt){
    const X = { g, frame: null, bridge: null, room: null, connected: false, noSdk: false, dead: false, rounds: 0, lastSrv: 0, hinted: false, roomErr: '', wantCode: '', timers: [] };
    const q = s => box.querySelector(s);
    const later = (fn, ms) => { X.timers.push(setTimeout(() => { if (!X.dead) fn(); }, ms)); };
    const stage = q('.un-box');
    const ar = arOf(g.aspect);   // форма окна
    stage.classList.toggle('un-full', !ar);
    if (ar) { stage.style.setProperty('--ar', ar[0] + ' / ' + ar[1]); stage.style.setProperty('--arn', String(ar[0] / ar[1])); }
    // сборка — только с чужого адреса (иначе allow-same-origin снял бы песочницу) и именно с того, что проверен при сохранении
    let origin = '';
    try { const u = new URL(g.url); origin = u.origin; if (!/^https?:$/.test(u.protocol) || origin === location.origin || origin !== g.origin) throw 0; }
    catch (e) { stage.innerHTML = '<div class="un-load">⚠️ Эту ссылку нельзя открыть на сайте</div>'; return { stop(){}, _x: X }; }
    stage.querySelector('.un-frame')?.remove();
    const f = document.createElement('iframe');
    f.className = 'un-frame';
    f.setAttribute('sandbox', SANDBOX);
    f.setAttribute('allow', ALLOW);
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'origin');   // сборка узнаёт адрес сайта (SDK шлёт сообщения только ему)
    f.title = g.title || 'Игра';
    let loaded = false;
    f.addEventListener('load', () => {
      if (X.dead) return;
      if (sameOriginFrame(f)) { f.remove(); X.frame = null; stage.innerHTML = '<div class="un-load">⚠️ Ссылка привела на сам сайт — так игру открыть нельзя</div>'; return; }
      stage.querySelector('.un-load')?.remove();   // дальше полосу загрузки рисует сама Unity
      if (!loaded) { loaded = true; opt.onLoad?.(); }
    });
    f.src = g.url;
    stage.appendChild(f);
    X.frame = f;
    X.bridge = createBridge({ win: () => (X.frame ? X.frame.contentWindow : null), origin,
      onWrongOrigin: o => { if (!X.warnedOrigin && (opt.preview || opt.own)) { X.warnedOrigin = true; note(`⚠️ Игра открылась с адреса ${esc(o)}, а ссылка — на ${esc(origin)}. Укажи ссылку, по которой игра открывается без переадресации.`); } },
      onLimited: t => { if (t === 'room.send') roomErr('rate'); } });

    // ── Обработчики (снимаются в stop) ──
    const onMsg = e => { if (X.dead) return; const m = X.bridge.accept(e); if (m) onGame(m); };
    const onAuth = () => { if (!X.dead && X.connected) send({ t: 'player', player: playerMsg() }); };
    const onLeave = () => { X.room?.leave(); };
    const onBar = e => {
      const b = e.target.closest('[data-act="fs"]');
      if (!b || X.dead) return;
      (stage.requestFullscreen || stage.webkitRequestFullscreen)?.call(stage);
      setTimeout(() => { try { X.frame?.focus(); } catch (er) {} }, 200);
    };
    const onRoomClick = e => {
      const b = e.target.closest('[data-act]');
      if (!b || X.dead) return;
      const a = b.dataset.act;
      if (a === 'room-new') { X.roomErr = ''; createRoomCmd(); }
      else if (a === 'room-leave') leaveRoom(true);
      else if (a === 'room-copy') share(g, X.room?.code);
      else if (a === 'room-retry') { X.roomErr = ''; if (X.wantCode) joinRoom(X.wantCode); else roomUi(); }
    };
    window.addEventListener('message', onMsg);
    window.addEventListener('d37:auth', onAuth);
    window.addEventListener('pagehide', onLeave);
    q('.un-bar')?.addEventListener('click', onBar);
    q('.un-room')?.addEventListener('click', onRoomClick);
    later(() => {
      if (X.connected) return;
      X.noSdk = true;
      sdk('warn', '⚠️ SDK не ответил');
      if (opt.preview || opt.own) note('⚠️ Игра не подключилась к сайту: ник, очки и комнаты не работают. Добавь в игру SDK Денчика и вызови D37.Init() — <a href="#/games/unity/help">как</a>.');
      roomUi();
    }, 30000);
    sdk('', '');
    roomUi();

    function playerMsg(){ const m = me(g.id); return { id: m.id, nick: m.nick, guest: m.guest, vip: m.vip, avatar: avatarPng() }; }
    function send(msg){ X.bridge.send(msg); }
    function sdk(cls, t){ const el = q('.un-sdk'); if (el) { el.className = 'un-sdk' + (cls ? ' ' + cls : ''); el.textContent = t; } }
    function note(html){ const el = q('.un-note'); if (el) { el.hidden = !html; el.innerHTML = html; } }
    const emptyRoom = () => ({ t: 'room.state', code: '', max: g.players | 0, me: '', host: '', players: [], link: '' });

    // ── Сообщения игры ──
    function onGame(m){
      if (m.t === 'hello') {
        const again = X.connected;
        X.connected = true; X.noSdk = false;
        sdk('ok', '✅ SDK' + (m.sdk ? ' ' + m.sdk : ''));
        if (!X.warnedOrigin) note('');
        send({ t: 'init', v: PROTO, online: true, preview: !!opt.preview, player: playerMsg(), game: { id: g.id, title: String(g.title || '').slice(0, 60), players: g.players | 0 || 1 } });
        if (X.room?.joined) send({ t: 'room.state', ...roomState() });   // игра перезагрузилась — напомнить комнату
        else if (!again && opt.code) joinRoom(opt.code);                  // пришли по ссылке на комнату
        roomUi();
        return;
      }
      if (!X.connected) return;   // до hello — ничего
      if (m.t === 'score') { const el = q('.un-score'); if (el) el.textContent = '⭐ ' + num(m.n); return; }
      if (m.t === 'over') { onOver(m); return; }
      if (m.t === 'toast') { api.toast('🕹️ ' + m.text); return; }
      if (m.t === 'log') { if (opt.preview || opt.own) console.log('[Unity]', m.text); return; }
      if (m.t === 'room.create') { X.roomErr = ''; createRoomCmd(); return; }
      if (m.t === 'room.join') { X.roomErr = ''; joinRoom(m.code); return; }
      if (m.t === 'room.leave') { leaveRoom(true); return; }
      if (m.t === 'room.send') {
        if (!X.room?.joined) { roomErr('no_room'); return; }
        const r = X.room.send(m.to, m.type, m.data, m.rel);
        if (r === 'rate') roomErr('rate'); else if (r === 'nobody') roomErr('nobody');
      }
    }
    let errAt = 0;
    function roomErr(reason){ const t = Date.now(); if (reason === 'rate' && t - errAt < 1000) return; if (reason === 'rate') errAt = t; send({ t: 'room.error', reason }); }

    // ── Итог раунда: рекорд, сервер (общие лимиты), ответ игре, реклама вокруг игр из каталога ──
    async function onOver(m){
      X.rounds++;
      const win = !!m.win, sc = m.n, rec = saveBest(g.id, sc) && sc > 0, best = bestOf(g.id);
      if (!opt.preview && api?.local) { const s0 = api.local(); api.saveLocal({ plays: (s0.plays || 0) + 1, wins: (s0.wins || 0) + (win ? 1 : 0) }); }
      const rb = q('.st-result');
      if (rb) {
        rb.hidden = false;
        rb.innerHTML = `<span>${win ? '🏆 Победа! ' : ''}${rec ? '🏅 Новый рекорд' : '🏁 Счёт'}: <b>${num(sc)}</b> · лучший: ${num(best)} <i class="un-got"></i></span>
          ${g.srv && !opt.preview ? '<button type="button" class="st-btn" data-act="share-res">📣 Вызвать друга</button>' : ''}`;
        rb.onclick = e => { if (e.target.closest('[data-act="share-res"]')) share(g, X.room?.code || null); };
      }
      let res;
      if (opt.preview || !g.srv) res = { ok: false, reason: 'preview' };
      else if (!authed()) {
        res = { ok: false, reason: 'auth' };
        if (!X.hinted) { X.hinted = true; if (typeof xpToast === 'function') xpToast('Войди — и за победы будут XP и монеты, а рекорд попадёт в таблицу', 'guest'); else api.toast('🔑 Войди — и за победы будут XP и монеты'); }
      } else if (Date.now() - X.lastSrv < RESULT_GAP) res = { ok: false, reason: 'too_fast' };
      else {
        X.lastSrv = Date.now();
        res = await rpc('unity_result', { p_id: g.id, p_score: sc, p_win: win, p_coins: m.coins, p_ref: roundRef() }) || { ok: false, reason: 'error' };
      }
      if (X.dead) return;
      send({ t: 'result', ok: !!res.ok, xp: res.xp | 0, coins: res.coins | 0, record: res.ok ? !!res.record : rec, best: res.ok ? res.best | 0 : best, reason: res.ok ? '' : String(res.reason || '') });
      if (res.ok) {
        const parts = [];
        if (res.xp > 0) parts.push(`+${res.xp} XP`);
        if (res.coins > 0) parts.push(`+${res.coins} 🪙`);
        if (res.record) parts.push('🏆 рекорд игры!');
        if (parts.length) { api.toast(parts.join(' · ')); const gEl = rb?.querySelector('.un-got'); if (gEl) gEl.textContent = parts.join(' · '); }
        if (res.xp > 0 && typeof xpLevelCache !== 'undefined') xpLevelCache.delete(currentUser.id);
        if (res.coins > 0 || win) window.D37Coins?.sync?.();
        if (typeof claimAchievements === 'function') setTimeout(claimAchievements, 800);
        if (res.record) opt.onTop?.();
      }
      // реклама — только вокруг игр из каталога (прошли модерацию), после раунда, не во время игры
      if (g.status === 'public' && !opt.preview) {
        const ad = q('.st-ad');
        if (ad && !ad.dataset.done && window.D37Ads?.render(ad, 'game_over')) { ad.hidden = false; ad.dataset.done = '1'; }
        if (X.rounds >= 2 && !X.room) window.D37Ads?.interstitial?.();   // в комнате не перекрываем игру — хоста ждут другие
      }
    }

    // ── Комнаты ──
    function roomState(){ const s = X.room.state(); return { ...s, link: playLink(g.id, s.code) }; }
    function setUrl(code){ if (!opt.preview) history.replaceState(null, '', '#/games/unity/play/' + g.id + (code ? '/' + code : '')); }
    function createRoomCmd(){
      if ((g.players | 0) < 2) { roomErr('single'); return; }
      if (X.room?.joined && X.room.isHost && X.room.players.length === 1) { send({ t: 'room.state', ...roomState() }); return; }   // уже ждём друзей
      joinRoom(newCode());
    }
    function joinRoom(code){
      if ((g.players | 0) < 2) { roomErr('single'); return; }
      if (!validCode(code)) { roomErr('code'); return; }
      if (X.room && X.room.code === code && !X.room.closed) { if (X.room.joined) send({ t: 'room.state', ...roomState() }); return; }
      leaveRoom(false);
      X.wantCode = code; X.roomErr = '';
      if (typeof sbClient === 'undefined' || !sbClient) { X.roomErr = 'offline'; roomErr('offline'); roomUi(); return; }
      const was = { host: '', ids: new Set() };
      X.room = createRoom({
        open: supaTransport, game: g.id, code, max: g.players, me: me(g.id), net: window.NetPlay || null,
        onState: s => {
          setUrl(code);
          // кто пришёл / ушёл / новый хост — подсказки на сайте
          if (was.ids.size) {
            for (const p of s.players) if (!was.ids.has(p.id) && !p.me) api.toast(`👤 ${p.nick} в комнате`);
            if (was.host && was.host !== s.host) api.toast(s.host === s.me ? '👑 Теперь хост — ты' : `👑 Новый хост: ${s.players.find(p => p.host)?.nick || ''}`);
          }
          was.host = s.host; was.ids = new Set(s.players.map(p => p.id));
          send({ t: 'room.state', ...s, link: playLink(g.id, s.code) });
          roomUi();
        },
        onMessage: (from, type, data) => send({ t: 'room.msg', from, type, data }),
        onError: reason => {
          X.roomErr = reason; X.room = null;
          roomErr(reason);
          send(emptyRoom());
          if (reason !== 'offline') setUrl('');
          roomUi();
        },
        onMode: () => roomUi(),
      });
      roomUi();
    }
    function leaveRoom(tell){
      if (!X.room) { if (tell) { X.wantCode = ''; X.roomErr = ''; roomUi(); } return; }
      X.room.leave();
      X.room = null;
      if (tell) { X.wantCode = ''; setUrl(''); send(emptyRoom()); }
      roomUi();
    }
    function roomUi(){
      const el = q('.un-room');
      if (!el || X.dead) return;
      if ((g.players | 0) < 2) { el.hidden = true; return; }
      el.hidden = false;
      const R = X.room;
      if (X.roomErr) {
        const n = g.players | 0;
        const why = { full: `Комната занята: в ней уже ${n} ${plural(n, 'игрок', 'игрока', 'игроков')}.`, dup: 'Ты зашёл в эту комнату из другой вкладки — играй там.',
          offline: 'Нет связи с сервером комнат — проверь интернет.', code: 'Неверный код комнаты.' }[X.roomErr] || 'Не получилось войти в комнату.';
        el.innerHTML = `<div class="un-room-h">⚠️ ${why}</div><div class="un-room-a">${X.roomErr === 'offline' && X.wantCode ? '<button type="button" class="st-btn" data-act="room-retry">↻ Ещё раз</button>' : ''}<button type="button" class="st-btn ghost" data-act="room-new">👥 Новая комната</button></div>`;
        return;
      }
      if (!R) {
        el.innerHTML = X.connected
          ? `<div class="un-room-h">👥 Играть с друзьями <small>до ${g.players | 0} в комнате · кто зашёл первым — хост</small></div><div class="un-room-a"><button type="button" class="st-btn gold" data-act="room-new">👥 Создать комнату и позвать</button></div>`
          : `<div class="un-room-h">👥 Комнаты <small>${X.noSdk ? 'не работают: игра не подключилась к сайту' : 'появятся, когда игра загрузится'}</small></div>`;
        return;
      }
      if (!R.joined) { el.innerHTML = `<div class="un-room-h">📡 Входим в комнату <code>${esc(R.code)}</code>…</div>`; return; }
      const modes = R.modes(), direct = modes.filter(x => x === 'p2p').length;
      const link = playLink(g.id, R.code);
      el.innerHTML = `<div class="un-room-h">👥 Комната <code>${esc(R.code)}</code> <small>${R.players.length} из ${R.max}${modes.length ? ` · ${direct === modes.length ? '⚡ напрямую' : direct ? `⚡ ${direct} напрямую, остальные через сервер` : '📡 через сервер'}` : ''}</small></div>
        <div class="ct-link"><input readonly value="${esc(link)}"><button type="button" data-act="room-copy">📋 Позвать</button></div>
        <ol class="un-seats">${R.players.map(p => `<li class="${p.id === R.me ? 'me' : ''}">${p.id === R.host ? '👑' : '🙂'} <b>${esc(p.nick)}</b>${p.id === R.me ? ' <small>(ты)</small>' : ''}${p.id === R.host ? ' <small>хост</small>' : ''}</li>`).join('')}</ol>
        <div class="un-room-a"><button type="button" class="st-btn ghost" data-act="room-leave">🚪 Выйти из комнаты</button></div>`;
      el.querySelector('.ct-link input')?.addEventListener('focus', e => e.target.select());
    }

    return {
      stop(){
        if (X.dead) return;
        X.dead = true;
        X.timers.forEach(clearTimeout);
        X.room?.leave(); X.room = null;
        window.removeEventListener('message', onMsg);
        window.removeEventListener('d37:auth', onAuth);
        window.removeEventListener('pagehide', onLeave);
        q('.un-bar')?.removeEventListener('click', onBar);
        q('.un-room')?.removeEventListener('click', onRoomClick);
        try { X.frame?.remove(); } catch (e) {}
        X.frame = null;
      },
      _x: X,
    };
  }

  // ── Модерация (персонал) ──
  async function moderation(){
    S = { screen: 'mod' };
    const st = S;
    if (!isStaff()) { root.innerHTML = '<div class="st"><div class="st-empty">Только для модераторов. <a href="#/games/unity">К Unity-играм</a></div></div>'; return; }
    root.innerHTML = '<div class="st"><div class="st-top"><a class="st-back" href="#/games/unity">← Unity-игры</a><b>🛡️ Модерация Unity-игр</b></div><div class="st-modlist"><div class="st-empty">Загружаем…</div></div></div>';
    const rows = await select(q => q.select(LIGHT + ',reports').or('status.eq.review,reports.gt.0').order('updated_at', { ascending: true }).limit(50));
    if (S !== st) return;
    const box = root.querySelector('.st-modlist');
    if (!rows) { box.innerHTML = '<div class="st-empty">Нет доступа или сайт обновляется</div>'; return; }
    if (!rows.length) { box.innerHTML = '<div class="st-empty">Очередь пуста 🎉</div>'; return; }
    box.innerHTML = rows.map(g => `<div class="st-row" data-id="${esc(g.id)}"><span class="st-row-ic">${esc(g.icon || '🕹️')}</span>
      <div class="st-row-b"><b>${esc(g.title)}</b><small>👤 <a href="#/profile/${esc(g.author)}" target="_blank">${esc(g.profiles?.nick || '')}</a> · ${(STATUS[g.status] || STATUS.draft).join(' ')}${g.players > 1 ? ` · 👥 до ${g.players | 0}` : ''}${g.reports ? ` · ⚠️ жалоб: ${g.reports}` : ''}</small>
        <small class="un-mod-url">🌐 ${esc(g.url)}</small><small>${esc(g.descr || '')}</small></div>
      <span class="st-row-a"><a class="st-btn ghost" href="#/games/unity/play/${esc(g.id)}" target="_blank">▶</a>
        <button type="button" class="st-btn" data-mod="public">✅ В каталог</button><button type="button" class="st-btn ghost" data-mod="link">🔗 Только ссылка</button><button type="button" class="st-btn ghost danger" data-mod="banned">⛔</button></span></div>`).join('')
      + '<div class="st-rules">Сборка лежит на сайте автора — он может поменять её и после проверки. Поэтому смотри и на автора, и на жалобы.</div>';
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-mod]');
      if (!b) return;
      const row = b.closest('[data-id]');
      b.disabled = true;
      const r = await rpc('unity_review', { p_id: row.dataset.id, p_status: b.dataset.mod });
      if (r?.ok) { row.remove(); api.toast('Готово'); } else { b.disabled = false; api.toast('Не получилось'); }
    });
  }

  // ── Как сделать игру ──
  function help(){
    S = { screen: 'help' };
    root.innerHTML = `<div class="st un-help">
      <div class="st-top"><a class="st-back" href="#/games/unity">← Unity-игры</a><b>📘 Как добавить игру из Unity</b></div>
      <ol class="un-steps">
        <li><b>Подключи SDK Денчика.</b> <button type="button" class="st-btn gold" data-act="zip">📦 Скачать SDK (zip)</button>
          Распакуй архив в папку <code>Assets</code> своего проекта (или возьми папку <a href="${SDK_URL}" target="_blank" rel="noopener">sdk/unity на GitHub</a>). Нужна Unity 2021.3 или новее.</li>
        <li><b>Добавь в игру пару строк</b> (C#):
<pre class="un-pre">D37.Init(() =&gt; Debug.Log("Привет, " + D37.Player.Nick));
D37.Score(score);          // счёт по ходу игры
D37.Over(score, win);      // конец раунда: рекорд, XP, монеты
D37.AddCoins(5);           // монеты за раунд (до 50)</pre>
          Комнаты: <code>D37.Room.Create()</code>, <code>D37.Room.Send("ход", json)</code>, <code>D37.Room.OnMessage</code>, <code>D37.Room.IsHost</code> — пример в <code>Samples/D37Example.cs</code>.</li>
        <li><b>Собери игру для браузера (WebGL).</b> Unity Hub → установи модуль «WebGL Build Support». В Unity — меню <b>SDK Денчика → Настроить сборку для сайта</b>
          (сжатие Gzip + Decompression Fallback, шаблон страницы D37), потом <b>File → Build Settings → WebGL → Build</b>.</li>
        <li><b>Выложи папку сборки</b> на GitHub Pages, itch.io или свой сайт (только https). Нужна прямая ссылка на <code>index.html</code> сборки —
          та, что открывает игру во весь экран без лишних страниц.</li>
        <li><b>Добавь игру сюда:</b> <a href="#/games/unity/new">➕ Добавить свою игру</a> → вставь ссылку → «▶ Проверить» (должно появиться «✅ SDK») →
          «💾 Сохранить» → «🔗 Ссылка для друзей» или «🌍 В каталог» (после проверки модератором).</li>
      </ol>
      <h3 class="st-h">👥 Комнаты: кто хост</h3>
      <p class="un-p">Игрок жмёт «Создать комнату» (на сайте или в игре — <code>D37.Room.Create()</code>) и отправляет ссылку друзьям. Кто зашёл первым — хост: его игра
        ведёт партию (считает мир, проверяет ходы), остальные шлют ему свои действия и получают состояние. Хост ушёл — хостом становится следующий,
        игра узнаёт об этом из <code>D37.Room.OnHostChanged</code>. Сообщения — строки до 8 КБ. Сайт соединяет игроков напрямую (WebRTC); если не вышло — идёт
        через сервер, но не чаще 5 сообщений в секунду, поэтому не шли позицию каждый кадр.</p>
      <h3 class="st-h">🏆 Очки, XP и монеты</h3>
      <p class="un-p">У каждой игры своя таблица рекордов (больше — лучше). Итог раунда засчитывается не чаще раза в 10 секунд; за победу — XP, за раунд —
        до 50 🪙 (в общих дневных лимитах сайта). За свою игру автор наград не получает. За каждые 10 запусков твоей игры другими игроками — 1 🪙 тебе.</p>
      <h3 class="st-h">🛠 Если не работает</h3>
      <ul class="un-p">
        <li>Игра не грузится, в консоли «Unable to parse Build/…gz» — включи <b>Decompression Fallback</b> (Player Settings → Publishing Settings).</li>
        <li>«⚠️ SDK не ответил» — в игре нет <code>D37.Init()</code> или ссылка ведёт не прямо на сборку (например, на страницу itch.io вместо её index.html).</li>
        <li>Ссылки и новые окна из игры не открываются — так задумано: игра работает в песочнице.</li>
        <li>Не включай «Enable Multithreading» (потоки WebGL) — на сайте они не работают.</li>
      </ul>
      <p class="un-p">Подробно, с картинками настроек: <a href="${SDK_URL}" target="_blank" rel="noopener">README SDK на GitHub</a>.</p>
    </div>`;
    root.querySelector('[data-act="zip"]').addEventListener('click', e => downloadSdk(e.currentTarget));
  }

  window.GAME_IMPL = window.GAME_IMPL || {};
  window.GAME_IMPL.unity = {
    mount(el, gameApi){ root = el; api = gameApi; show(gameApi.param); },
    unmount(){ stopScreen(); root = null; },
    _test: { PROTO, LIMITS, RELAY, INBOX, MAX_DATA, OUT_TYPES, IN_TYPES: Object.keys(IN), SANDBOX, ALLOW, SDK_FILES, hash36, pid, uidOf, normUrl, cleanIn, cleanWire, limiter, createBridge, createRoom, crc32, zip, validCode, newCode, sameOriginFrame,
      session, setApi(a){ api = a; } },
  };
})();

// ═══════════════════════════════════════
//  IoKit — общее для io-игр «Клеточки» (как agar.io) и «Червячки» (как slither.io)
// ═══════════════════════════════════════
// Комната на 2–10 человек + боты, мир считает ХОЗЯИН (кто раньше всех вошёл), гости шлют только управление и рисуют снимки.
//  • party(o) — комната: presence Supabase (кто в комнате, кто хозяин), знакомство WebRTC (netplay.js) «звездой»: хозяин ↔ каждый
//    гость. Данные — напрямую (снимки 15/с). Нет прямой связи — через ОТДЕЛЬНЫЙ канал «-r» (в нём только хозяин и гости без связи):
//    снимки всем таким гостям — одним сообщением не чаще 4/с, управление гостя — не чаще 4/с. Лимит Supabase (2 млн сообщений в
//    месяц на весь сайт): в обычной игре через Supabase идёт только знакомство и присутствие.
//  • session(c) — сеанс: без сети (боты), хозяин или гость; шаг мира фиксированный (sim.DT), управление — СОСТОЯНИЕ с отметкой
//    времени (inputLog): шаг берёт то, что было нажато к его времени, — поэтому при 30, 60 и 144 кадрах в секунду мир одинаковый.
//    Хозяин ушёл — хозяином становится следующий: мир собирается из того, что он видел, остальные присылают себя («claim»,
//    не больше, чем было в таблице лидеров).
//  • Имена — cleanName (мат, ссылки, телефоны, @ники → смешное имя); чата нет — только 8 эмодзи (EMOTES).
//  • Управление: плавающий джойстик (touchStick), клавиши, геймпад (pad), мышь — в самих играх.
// Игра даёт sim: { DT, newWorld, addOwner, dropOwner, setInput, respawn, step, encode, mirror, decode, claim, applyClaim,
//   fromMirror, capOf, packIn, unpackIn, owners, setHumans }. Тесты: scripts/kletochki-test.cjs, scripts/chervyachki-test.cjs.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.IoKit) return;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;

  // ═══ Случайность для мира: состояние — число в объекте (сохраняется вместе с миром, одинаково у всех) ═══
  function rnd(o, k = 'rs'){
    let t = (o[k] = (o[k] + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Хеш трёх целых → [0, 1): место точки еды по (зерно, ячейка, поколение) — одинаково у хозяина и гостей
  function hash3(a, b, c){
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  // Сумма для сверки миров в тестах (порядок важен)
  function hashNums(arr){
    let h = 2166136261;
    for (const x of arr) { const v = Math.round(x * 1000) | 0; h = Math.imul(h ^ (v & 0xffff), 16777619); h = Math.imul(h ^ (v >>> 16), 16777619); }
    return (h >>> 0).toString(16);
  }

  // ═══ Двоичные снимки ═══
  function writer(n = 1024){
    const w = { b: new ArrayBuffer(n), o: 0 };
    w.v = new DataView(w.b);
    w.need = k => {
      if (w.o + k <= w.b.byteLength) return;
      const nb = new ArrayBuffer(Math.max(w.b.byteLength * 2, w.o + k + 64));
      new Uint8Array(nb).set(new Uint8Array(w.b, 0, w.o));
      w.b = nb; w.v = new DataView(nb);
    };
    w.u8 = x => { w.need(1); w.v.setUint8(w.o, clamp(Math.round(x) | 0, 0, 255)); w.o += 1; };
    w.u16 = x => { w.need(2); w.v.setUint16(w.o, clamp(Math.round(x) | 0, 0, 65535), true); w.o += 2; };
    w.i16 = x => { w.need(2); w.v.setInt16(w.o, clamp(Math.round(x) | 0, -32768, 32767), true); w.o += 2; };
    w.i8 = x => { w.need(1); w.v.setInt8(w.o, clamp(Math.round(x) | 0, -128, 127)); w.o += 1; };
    w.u32 = x => { w.need(4); w.v.setUint32(w.o, (Math.round(x) >>> 0), true); w.o += 4; };
    w.at = () => w.o;
    w.put16 = (at, x) => w.v.setUint16(at, clamp(Math.round(x) | 0, 0, 65535), true);
    w.put8 = (at, x) => w.v.setUint8(at, clamp(Math.round(x) | 0, 0, 255));
    w.done = () => w.b.slice(0, w.o);
    w.view = () => new Uint8Array(w.b, 0, w.o);   // без копии: отправить сразу (RTCDataChannel.send копирует сам)
    return w;
  }
  function reader(buf){
    const v = ArrayBuffer.isView(buf) ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf), n = buf.byteLength;
    const r = { o: 0 };
    const need = k => { if (r.o + k > n) throw new Error('snap: short'); };
    r.u8 = () => { need(1); return v.getUint8(r.o++); };
    r.i8 = () => { need(1); return v.getInt8(r.o++); };
    r.u16 = () => { need(2); const x = v.getUint16(r.o, true); r.o += 2; return x; };
    r.i16 = () => { need(2); const x = v.getInt16(r.o, true); r.o += 2; return x; };
    r.u32 = () => { need(4); const x = v.getUint32(r.o, true); r.o += 4; return x; };
    r.left = () => n - r.o;
    return r;
  }
  const toB64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

  // ═══ Имена: без мата, ссылок, телефонов и @ников (как фильтр мира и «Крокодила») ═══
  const LAT = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', h: 'н', b: 'в', '3': 'з', '0': 'о', '@': 'а' };
  const BAD = [
    /(?:^|[^\p{L}])(?:на|по|о|от|за|вы|до|из|раз|рас|недо|пере|при)?ху[йеёяюи]/u, /п[иеё]зд/u, /(?:^|[^\p{L}])бля(?!х)/u, /(?:^|[^\p{L}])(?:за|на|вы|у|от|по|до|про|раз|рас|съ|подъ|из|изъ|при|пере|недо)?[её]б(?:а|ал|ан|ат|ут|ну|ло|ли|л|ы|ош|уч|ен|ис|ыв|ыр|ет|ёт)/u,
    /(?:^|[^\p{L}])[её]б(?!\p{L})/u, /(?:^|[^\p{L}])сук(?:а+|и|е|у|ой|ин|ам)(?!\p{L})/u, /муда[кч]|мудил/u, /пид[ао]р|педик(?!юр)/u, /г[ао]нд[ао]н/u, /шлюх/u, /залуп/u, /дроч/u,
    /(?:^|[^\p{L}])д[ао]лб[ао][её]б/u, /(?:^|[^\p{L}])х[еэ]р(?:[ауоыи]|ня)?(?!\p{L})/u, /сперм/u, /порн/u, /секс/u, /(?:^|[^\p{L}])жоп/u,
  ];
  const fc = String.fromCharCode;
  const CTRL = new RegExp('[' + fc(0) + '-' + fc(31) + fc(127) + fc(0x200b) + '-' + fc(0x200f) + fc(0x2028) + '-' + fc(0x202e) + fc(0x2060) + '-' + fc(0x206f) + fc(0xfeff) + ']', 'g');
  const BAD_LAT = [/f+u+c+k/, /sh[i1]t/, /n[i1]gg/, /b[i1]tch/, /p[o0]rn/, /(?:^|[^a-z])sex/, /d[i1]ck/, /puss/, /wh[o0]re/, /(?:^|[^a-z])cum(?![a-z])/];
  // Латиница — как есть (f u c k), кириллица — с подменой похожих латинских букв (xyй); и с пробелами, и слитно
  function hasBad(s){
    const raw = String(s || '').toLowerCase(), rawJ = raw.replace(/[\s._\-*]+/g, '');
    if (BAD_LAT.some(re => re.test(raw) || re.test(rawJ))) return true;
    const low = [...raw].map(ch => LAT[ch] || ch).join('').replace(/ё/g, 'е'), lowJ = low.replace(/[\s._\-*]+/g, '');
    return BAD.some(re => re.test(low) || re.test(lowJ));
  }
  const FALLBACK = ['Пушистик', 'Бублик', 'Пельмешек', 'Зефирка', 'Капелька', 'Пончик', 'Ириска', 'Кексик', 'Сырник', 'Карамелька', 'Мармеладка', 'Клубничка'];
  // Имя игрока: 2–16 знаков (буквы, цифры, пробел, _ - . ! и эмодзи), без контактов; плохое — смешное имя (по номеру — у всех одно)
  function cleanName(s, n){
    let t = String(s ?? '').replace(CTRL, '').normalize('NFC').replace(/\s+/g, ' ').trim();
    t = t.replace(/(?:https?:\/\/|www\.)\S*/giu, ' ').replace(/\S+\.(?:ru|com|net|org|io|me|gg|tk|su|рф|kz|xyz|app|tv|by|ua|info|site|online|link)\b\S*/giu, ' ')
      .replace(/(?:^|\s)[@#]\S+/gu, ' ').replace(/\d[\d\s\-()+.]{4,}\d/gu, ' ').replace(/(?:t\.me|tg|telegram|discord|vk|insta|whatsapp|телег|вотсап|дискорд|инст)\S*/giu, ' ');
    t = t.replace(/[^\p{L}\p{N} _\-.!?\p{Extended_Pictographic}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
    t = [...t].slice(0, 16).join('').trim();
    if (t.replace(/[\s_\-.!?]/g, '').length < 2 || hasBad(t)) return FALLBACK[Math.abs(n | 0) % FALLBACK.length];
    return t;
  }
  // Ребёнку (D37Age) чужие имена — без «контактов» (kidText прячет то, что похоже на ник/номер)
  const showName = s => { try { return root.D37Age?.kid?.() ? root.D37Age.kidText(s) : s; } catch (e) { return s; } };

  // Эмодзи вместо чата (детская аудитория): 8 штук, по номеру 1…8
  const EMOTES = ['👋', '😂', '😮', '😎', '❤️', '👍', '😭', '🔥'];

  // ═══ Управление — состояние с отметкой времени: шаг мира берёт то, что было нажато к его времени ═══
  // Кольцо на CAP записей по n чисел (без новых объектов: на кадр ничего не создаётся). at(t) — подмассив, читать сразу.
  function inputLog(n){
    const CAP = 128, T = new Float64Array(CAP), V = new Float64Array(CAP * n), views = [];
    for (let i = 0; i < CAP; i++) views.push(V.subarray(i * n, i * n + n));
    let head = 0, len = 0;
    return {
      n,
      set(arr, t){
        if (len) {
          const li = (head + len - 1) % CAP;
          if (t < T[li]) t = T[li];
          if (T[li] === t) { views[li].set(arr); return; }
        }
        if (len === CAP) { head = (head + 1) % CAP; len--; }
        const i = (head + len) % CAP;
        T[i] = t; views[i].set(arr); len++;
      },
      at(t){
        if (!len) return null;
        let best = head;
        for (let k = 1; k < len; k++) { const i = (head + k) % CAP; if (T[i] <= t) best = i; else break; }
        return views[best];
      },
      last: () => (len ? views[(head + len - 1) % CAP] : null),
      prune(t){ while (len > 1) { const i2 = (head + 1) % CAP; if (T[i2] <= t) { head = i2; len--; } else break; } },
      clear(){ head = 0; len = 0; },
      size: () => len,
    };
  }

  // ═══ КОМНАТА: presence + WebRTC «звездой» + канал «-r» для тех, у кого нет прямой связи ═══
  // o: { game, code, max, me: { key, nick }, open(name, key, { presence }) → транспорт, net (NetPlay | null), now, setT, clearT,
  //      onState(P), onMsg(from, d), onFast(from, d), onBin(from, ArrayBuffer), onError(reason: offline|full|dup), onMode(peer) }
  // Транспорт: { onStatus, onSync(state), onMsg(payload), track(meta), send(payload), close() }.
  // P.send(to, d, fast) — JSON (fast — можно потерять); P.bin(to, buf) — снимок; P.fast(to) — есть ли прямая связь.
  const RELAY_MS = 250, ANNOUNCE_MS = 800;
  function party(o){
    const now = o.now || (() => Date.now()), setT = o.setT || ((f, ms) => setTimeout(f, ms)), clearT = o.clearT || (t => clearTimeout(t));
    const t0 = now(), me = o.me.key + '~' + t0;
    const P = { code: o.code, me, players: [], host: '', isHost: false, joined: false, closed: false, max: o.max || 10, sent: 0 };
    const links = new Map(), announced = new Map();
    let RL = null, relayDropT = 0, annT = 0, tracked = false, flushT = 0, lastFlush = -1e9, pend = [];
    let bundle = null, fastStash = null;
    const T = o.open(`${o.game}-io-${o.code}`, o.me.key, { presence: true });
    const subT = setT(() => { if (!P.joined) fail('offline'); }, o.joinMs || 12000);
    T.onStatus = async st => {
      if (P.closed) return;
      if (st === 'SUBSCRIBED') {
        if (tracked) return;
        tracked = true;
        try { await T.track({ nick: String(o.me.nick || '').slice(0, 24), t: t0 }); } catch (e) {}
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') fail('offline');
    };
    T.onSync = sync;
    T.onMsg = recv;

    function sync(state){
      if (P.closed) return;
      const list = [];
      for (const key of Object.keys(state || {})) {
        const metas = Array.isArray(state[key]) ? state[key] : [];
        const m = metas.reduce((a, b) => (b && typeof b.t === 'number' && (!a || b.t > a.t) ? b : a), null);
        if (!m) continue;
        list.push({ id: key + '~' + m.t, key, t: m.t, nick: String(m.nick || '').slice(0, 24) });
      }
      list.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const idx = list.findIndex(p => p.id === me);
      if (idx === -1) { if (P.joined && list.some(p => p.key === o.me.key)) fail('dup'); return; }
      if (idx >= P.max) { fail('full'); return; }
      const first = !P.joined;
      P.joined = true; clearT(subT);
      P.players = list.slice(0, P.max);
      const ids = new Set(P.players.map(p => p.id)), host = P.players[0].id, hostChanged = host !== P.host;
      P.host = host; P.isHost = host === me;
      for (const [id, L] of links) if (hostChanged || !ids.has(id)) { L.close(); links.delete(id); }
      const removed = [...announced.keys()].some(id => !ids.has(id));
      const added = P.players.some(p => !announced.has(p.id));
      if (first || removed || hostChanged) announce();
      else if (added && !annT) annT = setT(announce, ANNOUNCE_MS);   // новичку сервер первые доли секунды ничего не доставляет
    }
    function announce(){
      clearT(annT); annT = 0;
      if (P.closed || !P.joined) return;
      announced.clear();
      for (const p of P.players) announced.set(p.id, p);
      if (P.isHost) ensureRelay(); else if (!fastLink(P.host)) ensureRelay();
      ensureLinks();
      o.onState(P);
      const t = now(), keep = [];
      for (const x of pend) { if (announced.has(x.p._by)) routeRelay(x.p); else if (t - x.at < 3000) keep.push(x); }
      pend = keep;
    }

    // ── Прямая связь ──
    function link(peer){
      const vroom = { get isHost(){ return P.isHost; }, send: m => { P.sent++; T.send({ k: 'np', to: peer, np: m, _by: me }); } };
      let np = null;
      try { np = o.net.start(vroom, { onMessage: m => fromPeer(peer, m), onBinary: b => fromPeerBin(peer, b), onMode: () => modeChanged(peer) }); } catch (e) { np = null; }
      const L = {
        mode: () => (np ? np.mode() : 'relay'),
        send(m, fast){ try { np?.send(m, fast); } catch (e) {} },
        sendBin(b){ try { np?.sendBin(b); } catch (e) {} },
        handle: m => (np ? np.handle(m) : false),
        offer(){ if (np && !P.closed && P.isHost && links.get(peer) === L) np.offer(); },
        close(){ try { np?.close(); } catch (e) {} },
      };
      links.set(peer, L);
      return L;
    }
    function ensureLinks(){
      if (!o.net) return;
      if (P.isHost) { for (const p of P.players) if (p.id !== me && !links.has(p.id)) { const L = link(p.id); setT(() => L.offer(), 300); } }
      else if (P.host && !links.has(P.host)) link(P.host);
    }
    const fastLink = id => { const L = links.get(id); return !!L && L.mode() === 'p2p'; };
    function modeChanged(peer){
      if (P.closed) return;
      if (!P.isHost && peer === P.host) {
        if (fastLink(peer)) { clearT(relayDropT); relayDropT = setT(() => { if (!P.closed && !P.isHost && fastLink(P.host)) dropRelay(); }, 3000); }
        else ensureRelay();
      }
      o.onMode?.(peer);
    }
    function ensureRelay(){
      clearT(relayDropT); relayDropT = 0;
      if (RL || P.closed) return;
      RL = o.open(`${o.game}-io-${o.code}-r`, o.me.key, { presence: false });
      RL.onStatus = () => {};
      RL.onMsg = recvRelay;
    }
    function dropRelay(){ if (RL) { try { RL.close(); } catch (e) {} RL = null; } }

    // ── Отправка ──
    P.fast = id => fastLink(id);
    P.mode = id => { const L = links.get(id); return L ? L.mode() : 'relay'; };
    P.send = (to, d, fast) => {
      if (P.closed || !P.joined || !to || to === me) return;
      const L = links.get(to);
      if (L && L.mode() === 'p2p') { L.send({ f: fast ? 1 : 0, d }, !!fast); return; }
      if (fast) { if (!P.isHost && to === P.host) { fastStash = d; armFlush(); } return; }
      ensureRelay(); P.sent++;
      RL.send({ k: 'M', to, d, _by: me });
    };
    P.bin = (to, buf) => {
      if (P.closed || !P.joined || !to || to === me) return;
      const L = links.get(to);
      if (L && L.mode() === 'p2p') { L.sendBin(buf); return; }
      if (!P.isHost) return;
      (bundle || (bundle = {}))[to] = toB64(buf);
      armFlush();
    };
    function armFlush(){
      if (flushT || P.closed) return;
      flushT = setT(flush, Math.max(0, lastFlush + RELAY_MS - now()));
    }
    function flush(){
      flushT = 0;
      if (P.closed) return;
      lastFlush = now();
      if (bundle && P.isHost) { ensureRelay(); P.sent++; RL.send({ k: 'B', b: bundle, _by: me }); }
      if (fastStash != null && !P.isHost) { ensureRelay(); P.sent++; RL.send({ k: 'I', d: fastStash, _by: me }); }
      bundle = null; fastStash = null;
    }

    // ── Приём ──
    function recv(p){   // главный канал: только знакомство WebRTC
      if (P.closed || !p || typeof p._by !== 'string' || p._by === me || p.k !== 'np' || p.to !== me) return;
      if (!p.np || typeof p.np.type !== 'string') return;
      let L = links.get(p._by);
      if (!L && o.net && !P.isHost && p._by === P.host) L = link(p._by);
      L?.handle(p.np);
    }
    function recvRelay(p){
      if (P.closed || !p || typeof p._by !== 'string' || p._by === me) return;
      if (!P.joined || !announced.has(p._by)) { if (p.k === 'M' && p.to === me) { pend.push({ p, at: now() }); if (pend.length > 40) pend.shift(); } return; }
      routeRelay(p);
    }
    function routeRelay(p){
      if (p.k === 'B') {
        if (P.isHost || p._by !== P.host || !p.b || typeof p.b !== 'object') return;
        const b = p.b[me];
        if (typeof b === 'string') { let buf = null; try { buf = fromB64(b); } catch (e) {} if (buf) o.onBin(p._by, buf); }
      } else if (p.k === 'I') { if (P.isHost) o.onFast(p._by, p.d); }
      else if (p.k === 'M') { if (p.to === me && (P.isHost || p._by === P.host)) o.onMsg(p._by, p.d); }
    }
    function fromPeer(peer, m){
      if (P.closed || !m || typeof m !== 'object') return;
      if (!P.isHost && peer !== P.host) return;
      if (m.f) o.onFast(peer, m.d); else o.onMsg(peer, m.d);
    }
    function fromPeerBin(peer, b){ if (!P.closed && (P.isHost || peer === P.host) && b instanceof ArrayBuffer) o.onBin(peer, b); }

    function fail(reason){ if (P.closed) return; P.leave(); o.onError(reason); }
    P.leave = () => {
      if (P.closed) return;
      P.closed = true;
      clearT(annT); clearT(subT); clearT(flushT); clearT(relayDropT);
      for (const L of links.values()) L.close();
      links.clear();
      dropRelay();
      try { T.close(); } catch (e) {}
    };
    P._links = links;
    P._relay = () => !!RL;
    return P;
  }
  // Транспорт — Supabase Realtime (как в room.js / krokodil.js)
  function supaTransport(name, key, opts){
    const sb = typeof sbClient !== 'undefined' ? sbClient : root.sbClient;
    const cfg = { broadcast: { self: false } };
    if (opts?.presence) cfg.presence = { key };
    const ch = sb.channel(name, { config: cfg });
    const T = { onStatus: null, onSync: null, onMsg: null };
    ch.on('broadcast', { event: 'm' }, ({ payload }) => T.onMsg?.(payload));
    if (opts?.presence) ch.on('presence', { event: 'sync' }, () => T.onSync?.(ch.presenceState()));
    // до подписки сообщения копим (иначе supabase-js шлёт их через REST — медленнее и «устаревший» путь)
    let ready = false, queue = [];
    ch.subscribe(st => {
      if (st === 'SUBSCRIBED' && !ready) { ready = true; const q = queue; queue = []; for (const p of q) ch.send({ type: 'broadcast', event: 'm', payload: p }).catch(() => {}); }
      T.onStatus?.(st);
    });
    T.track = meta => ch.track(meta);
    T.send = payload => {
      if (!ready) { if (queue.length < 30) queue.push(payload); return; }
      ch.send({ type: 'broadcast', event: 'm', payload }).catch(() => {});
    };
    T.close = () => { try { if (opts?.presence) ch.untrack(); sb.removeChannel(ch); } catch (e) {} };
    return T;
  }
  const netOk = () => { try { return !!(typeof sbClient !== 'undefined' ? sbClient : root.sbClient); } catch (e) { return false; } };
  // Сразу по ссылке-приглашению игра открывается раньше, чем сайт подключит Supabase (init.js → initChat): подождать до ms
  function whenNet(fn, ms = 8000){
    if (netOk()) { fn(true); return () => {}; }
    const t0 = Date.now();
    let t = setInterval(() => { if (netOk() || Date.now() - t0 > ms) { clearInterval(t); t = 0; fn(netOk()); } }, 100);
    return () => { if (t) { clearInterval(t); t = 0; } };
  }

  // ═══ СЕАНС: без сети / хозяин / гость ═══
  // c: { game, sim, max, me: { key, nick, skin, aspect }, open, net, now, setT, clearT, raf, caf, autoLoop (по умолчанию true),
  //      onFrame(S, now), onRole(role), onYou(idx), onKo(ev), onRound(ev), onPlayers(), onStatus(kind, info) }
  // Игра: S.offline() / S.online(code, { pub }) / S.setInput(state, t) / S.respawn() / S.leave(); рисует S.W (без сети, хозяин)
  // или S.G (гость) с S.alpha (доля шага между кадрами).
  const MAXSTEPS = 8, PUB_TRIES = 6;
  function session(c){
    const sim = c.sim, now = c.now || (() => (root.performance ? performance.now() : Date.now()));
    const setT = c.setT || ((f, ms) => setTimeout(f, ms)), clearT = c.clearT || (t => clearTimeout(t));
    const DTms = sim.DT * 1000;
    const S = { role: 'none', W: null, G: null, me: -1, P: null, code: '', pub: false, pubN: 1, alpha: 0, rtt: 0, closed: false,
      inLog: inputLog(sim.IN), seq: 0, sentIn: new Float64Array(sim.IN), sentOk: false, inAt: -1e9, hiAt: -1e9, gotYou: false, guests: new Map(), claimWait: new Map(), caps: null,
      L: { t0: 0, n: 0 }, raf: 0, lastFrame: 0, plVer: -1, plAt: 0, err: '', hiddenAt: 0, handT: 0, migrated: 0, nBin: 0, nBinOk: 0, nSent: 0, binErr: '' };
    const cb = (k, ...a) => { try { return c[k]?.(...a); } catch (e) { console.error(e); } };
    const meName = () => cleanName(c.me.nick, 1);

    // ── Цикл ──
    function loopOn(){
      if (c.autoLoop === false || S.raf || S.closed) return;
      const raf = c.raf || root.requestAnimationFrame;
      if (!raf) return;
      const f = t => { S.raf = 0; if (S.closed) return; frame(t); S.raf = raf(f); };
      S.raf = raf(f);
    }
    function loopOff(){ if (S.raf) { (c.caf || root.cancelAnimationFrame)?.(S.raf); S.raf = 0; } }
    const clk = () => (root.performance ? performance.now() : Date.now());
    function frame(t){
      if (S.closed) return;
      const w0 = clk();
      cb('onInput', t);   // игра кладёт управление ДО шагов этого кадра
      if (S.role === 'off' || S.role === 'host') {
        const L = S.L;
        if (!L.t0) { L.t0 = t; L.n = 0; }
        let target = Math.floor((t - L.t0) / DTms);
        if (target - L.n > MAXSTEPS) { L.t0 += (target - L.n - MAXSTEPS) * DTms; target = L.n + MAXSTEPS; }   // долгая пауза — не догоняем
        while (L.n < target && S.W) { L.n++; hostStep(L.t0 + L.n * DTms); }
        S.alpha = clamp((t - L.t0) / DTms - L.n, 0, 1);
        S.inLog.prune(L.t0 + L.n * DTms);
      } else if (S.role === 'guest') guestTick(t);
      S.lastFrame = t;
      cb('onFrame', S, t);
      S.workMs = clk() - w0;   // сколько заняли шаги + рисунок этого кадра (замер «телефона»)
      if (S.onWork) S.onWork(S.workMs, t);
    }
    S.frame = frame;

    // ── Шаг хозяина / одиночной игры ──
    function hostStep(stepT){
      const W = S.W;
      if (S.me >= 0) { const inp = S.inLog.at(stepT); if (inp) sim.setInput(W, S.me, inp); }
      for (const [id, w] of S.claimWait) if (W.step >= w.until) { S.claimWait.delete(id); const g = S.guests.get(id); if (g) sim.respawn(W, g.idx); }
      sim.step(W);
      const ev = W.ev.splice(0);
      for (const e of ev) hostEvent(e);
      if (S.role === 'host') hostNet(W);
      if (S.afterStep) S.afterStep(W);
    }
    function hostEvent(e){
      if (e.k === 'ko') {
        if (e.o === S.me) cb('onKo', e);
        else for (const [id, g] of S.guests) if (g.idx === e.o) S.P?.send(id, { t: 'ko', e });
      } else if (e.k === 'end' || e.k === 'start') {
        cb('onRound', e);
        if (S.role === 'host') for (const id of S.guests.keys()) S.P.send(id, { t: 'rd', e });
      } else cb('onEvent', e);
    }
    function hostNet(W){
      const P = S.P;
      if (!P) return;
      const t = now();
      for (const [id, g] of S.guests) {
        const every = P.fast(id) ? 2 : 8;
        if ((W.step + g.phase) % every) continue;
        g.hold = Math.round(t - g.inAt);
        let buf = null;
        try { buf = sim.encode(W, g.idx, g); } catch (e) { console.error(e); }
        if (buf) { P.bin(id, buf); S.nSent++; }
      }
      const v = sim.ownersVer(W);
      if (v !== S.plVer && t - S.plAt > 300) { S.plVer = v; S.plAt = t; const l = sim.owners(W); for (const id of S.guests.keys()) P.send(id, { t: 'pl', l }); }
    }

    // ── Гость: управление хозяину, снимки — в зеркало ──
    function guestTick(t){
      const P = S.P;
      if (!P || !P.host || P.isHost) return;
      const inp = S.inLog.last();
      if (inp && t - S.inAt >= 45) {
        let same = S.sentOk;
        for (let i = 0; same && i < inp.length; i++) if (inp[i] !== S.sentIn[i]) same = false;
        if (!same || t - S.inAt >= (P.fast(P.host) ? 250 : 1000)) {   // 20/с, пока меняется; иначе раз в 0,25 с (через Supabase — раз в 1 с)
          S.inAt = t; S.sentIn.set(inp); S.sentOk = true;
          const pk = sim.packIn(inp);
          pk.unshift(S.seq++ & 0xffff, Math.round(t) % 2147483647);
          P.send(P.host, pk, true);
        }
      }
      if (!S.gotYou && t - S.hiAt > 2000) sendHi();
      S.inLog.prune(t);
    }
    function sendHi(){
      const P = S.P;
      if (!P || P.isHost || !P.host) return;
      S.hiAt = now();
      const m = { t: 'hi', n: meName(), s: c.me.skin || null, a: clamp(+c.me.aspect || 1.6, .3, 3.5) };
      if (S.claim && !S.gotYou) m.cl = S.claim;   // хозяин сменился: свои клетки/червяк — с каждым «привет», пока он не ответит
      P.send(P.host, m);
    }

    // ── Комната ──
    function onState(P){
      if (S.closed || P !== S.P) return;
      cb('onStatus', 'players', P.players.length);
      if (P.isHost) {
        if (S.role !== 'host') becomeHost(P);
        syncGuests(P);
      } else {
        const fresh = S.role !== 'guest' || S.hostId !== P.host;
        if (S.role === 'host') { loopOff(); }
        if (fresh) {
          S.claim = S.G && S.G.ready ? sim.claim(S.G) : null;
          S.role = 'guest'; S.hostId = P.host; S.W = null; S.gotYou = false; S.me = -1;
          S.G = sim.mirror(S.G);
          sendHi();
          cb('onRole', 'guest');
          loopOn();
        }
      }
    }
    function becomeHost(P){
      const wasGuest = S.role === 'guest' && S.G && S.G.ready;
      if (wasGuest) {
        const r = sim.fromMirror(S.G, { key: P.me, name: meName(), skin: c.me.skin || null });
        S.W = r.W; S.me = r.me; S.caps = sim.capOf(S.G); S.migrated++;
      } else {
        S.W = sim.newWorld(seed());
        S.me = sim.addOwner(S.W, { key: P.me, name: meName(), skin: c.me.skin || null, bot: false, spawn: true });
      }
      S.role = 'host'; S.L = { t0: 0, n: 0 }; S.guests.clear(); S.claimWait.clear(); S.plVer = -1; S.G = null;
      for (const p of P.players) if (p.id !== P.me) addGuest(p, wasGuest);
      sim.setHumans(S.W, P.players.length);
      cb('onRole', 'host'); cb('onYou', S.me);
      loopOn();
    }
    function addGuest(p, waitClaim){
      const W = S.W;
      const idx = sim.addOwner(W, { key: p.id, name: cleanName(p.nick, S.guests.size + 2), skin: null, bot: false, spawn: !waitClaim });
      S.guests.set(p.id, { idx, aspect: 1.6, inTs: -1, inAt: 0, phase: (S.guests.size * 3) % 8, ctx: {} });
      if (waitClaim) S.claimWait.set(p.id, { until: W.step + Math.round(2500 / DTms) });
      return idx;
    }
    function syncGuests(P){
      const W = S.W, ids = new Set(P.players.map(p => p.id));
      for (const [id, g] of S.guests) if (!ids.has(id)) { sim.dropOwner(W, g.idx); S.guests.delete(id); S.claimWait.delete(id); }
      for (const p of P.players) if (p.id !== P.me && !S.guests.has(p.id)) { const idx = addGuest(p, false); P.send(p.id, { t: 'you', i: idx }); P.send(p.id, { t: 'pl', l: sim.owners(W) }); }
      sim.setHumans(W, P.players.length);
    }
    function onMsg(from, d){
      if (S.closed || !d || typeof d !== 'object') return;
      if (S.role === 'host') {
        const g = S.guests.get(from);
        if (!g) return;
        if (d.t === 'hi') {
          g.aspect = clamp(+d.a || 1.6, .3, 3.5);
          const nm = cleanName(d.n, g.idx);
          if (nm !== g.name || JSON.stringify(d.s || null) !== g.skinJ) { g.name = nm; g.skinJ = JSON.stringify(d.s || null); sim.setOwner(S.W, g.idx, { name: nm, skin: d.s }); }
          if (d.cl && S.claimWait.has(from)) { S.claimWait.delete(from); sim.applyClaim(S.W, g.idx, d.cl, S.caps); }
          S.P.send(from, { t: 'you', i: g.idx });
          S.P.send(from, { t: 'pl', l: sim.owners(S.W) });
        } else if (d.t === 'sp') sim.respawn(S.W, g.idx);
        else if (d.t === 'cl' && S.claimWait.has(from)) { S.claimWait.delete(from); sim.applyClaim(S.W, g.idx, d.c, S.caps); }
        else if (d.t === 'kf') { if (Array.isArray(d.o)) for (const x of d.o.slice(0, 32)) if (x >= 0 && x < 31) g.kfReq = (g.kfReq | 0) | (1 << x); }   // гостю нужно тело целиком
        return;
      }
      if (S.role !== 'guest' || from !== S.P?.host) return;
      if (d.t === 'you') { S.gotYou = true; S.claim = null; if (S.me !== (d.i | 0)) { S.me = d.i | 0; if (S.G) S.G.me = S.me; cb('onYou', S.me); } }
      else if (d.t === 'pl' && Array.isArray(d.l)) { sim.setOwners(S.G, d.l); cb('onPlayers'); }
      else if (d.t === 'ko' && d.e) cb('onKo', d.e);
      else if (d.t === 'rd' && d.e) cb('onRound', d.e);
    }
    function onFast(from, d){
      if (S.closed || S.role !== 'host' || !Array.isArray(d)) return;
      const g = S.guests.get(from);
      if (!g) return;
      const inp = sim.unpackIn(d, 2, g.inBuf || (g.inBuf = new Float64Array(sim.IN)));
      if (!inp) return;
      g.inTs = (+d[1] || 0); g.inAt = now();
      sim.setInput(S.W, g.idx, inp);
    }
    function onBin(from, buf){
      S.nBin++;
      if (S.closed || S.role !== 'guest' || !S.G) return;
      let ok = false;
      try { ok = sim.decode(S.G, buf, now()); } catch (e) { ok = false; S.binErr = String(e && e.message || e); }
      if (ok) S.nBinOk++;
      if (!ok) return;
      if (S.G.echoTs >= 0) { const r = now() - S.G.echoTs - S.G.hold; if (r >= 0 && r < 5000) S.rtt = S.rtt ? S.rtt * .8 + r * .2 : r; }
      if (S.G.me >= 0 && S.me !== S.G.me && S.gotYou) { S.me = S.G.me; cb('onYou', S.me); }
    }
    function onError(reason){
      if (S.closed) return;
      S.P = null;
      if (reason === 'full' && S.pub && S.pubN < PUB_TRIES) { S.pubN++; join(pubCode(S.pubN)); return; }
      S.err = reason;
      cb('onStatus', 'error', reason);
    }
    function join(code){
      S.code = code;
      S.P = party({ game: c.game, code, max: c.max || 10, me: { key: c.me.key || guestKey(), nick: meName() }, open: c.open || supaTransport, joinMs: S.pub ? 7000 : 12000,
        net: c.net === undefined ? (root.NetPlay || null) : c.net, now: c.pnow || (() => Date.now()), setT, clearT,
        onState, onMsg, onFast, onBin, onError, onMode: () => cb('onStatus', 'mode') });
      cb('onStatus', 'joining', code);
    }

    // ── Для игры ──
    S.offline = () => {
      stopNet();
      S.role = 'off'; S.code = ''; S.pub = false;
      S.W = sim.newWorld(seed());
      S.me = sim.addOwner(S.W, { key: 'me', name: meName(), skin: c.me.skin || null, bot: false, spawn: true });
      sim.setHumans(S.W, 1);
      S.L = { t0: 0, n: 0 }; S.inLog.clear();
      cb('onRole', 'off'); cb('onYou', S.me);
      loopOn();
    };
    S.online = (code, o = {}) => {
      stopNet();
      S.role = 'none'; S.W = null; S.G = null; S.me = -1; S.err = '';
      S.pub = !!o.pub; S.pubN = 1;
      join(S.pub ? pubCode(1) : code);
      loopOn();
    };
    S.setInput = (state, t) => { S.inLog.set(state, t == null ? now() : t); };
    S.respawn = () => {
      if (S.role === 'off' || S.role === 'host') sim.respawn(S.W, S.me);
      else if (S.role === 'guest' && S.P) S.P.send(S.P.host, { t: 'sp' });
    };
    // Своё имя/раскраска/форма экрана поменялись: хозяину — сразу в мир, гость — «привет» хозяину (форма экрана — для обзора)
    S.setMe = (o2) => {
      const look = o2.nick !== undefined || o2.skin !== undefined;
      Object.assign(c.me, o2);
      if ((S.role === 'off' || S.role === 'host') && look && S.W) sim.setOwner(S.W, S.me, { name: meName(), skin: c.me.skin });
      else if (S.role === 'guest') sendHi();
    };
    S.humans = () => (S.P ? S.P.players.length : 1);
    S.netMode = () => (S.role === 'guest' && S.P ? S.P.mode(S.P.host) : S.role === 'host' ? 'host' : 'off');
    S.view = () => (S.role === 'guest' ? S.G : S.W);
    // Хозяин свернул вкладку — браузер остановит его цикл, и мир встанет у всех: через 1,5 с передаём мир следующему
    S.hidden = h => {
      clearT(S.handT); S.handT = 0;
      if (h && S.role === 'host' && S.P && S.P.players.length > 1) {
        S.handT = setT(() => { if (S.role === 'host' && S.P) { S.rejoin = S.code; stopNet(); S.role = 'none'; S.W = null; cb('onStatus', 'handover'); } }, 1500);
      } else if (!h && S.rejoin) { const code = S.rejoin; S.rejoin = ''; S.online(code, { pub: false }); }
    };
    function stopNet(){ if (S.P) { try { S.P.leave(); } catch (e) {} S.P = null; } S.guests.clear(); S.claimWait.clear(); }
    S.leave = () => { S.closed = true; stopNet(); loopOff(); clearT(S.handT); };
    S._join = join;
    return S;
  }
  const pubCode = n => 'pub' + n;
  function seed(){ return (Math.floor(Math.random() * 2147483646) + 1) | 0; }
  function guestKey(){ try { return root.GameRoom?.guestId?.() || ((typeof currentUser !== 'undefined' && currentUser?.id) || 'g-' + Math.random().toString(36).slice(2, 10)); } catch (e) { return 'g-' + Math.random().toString(36).slice(2, 10); } }
  function myKey(){ try { return (typeof currentUser !== 'undefined' && currentUser?.id) || root.GameRoom?.guestId?.() || guestKey(); } catch (e) { return guestKey(); } }
  function myNick(){ try { if (typeof currentProfile !== 'undefined' && currentProfile?.nick) return currentProfile.nick; } catch (e) {} return root.GameRoom?.nick?.() || 'Игрок'; }

  // ═══ Плавающий джойстик (палец): где коснулся — там центр; вне кнопок ═══
  // touchStick(el, { zone(x, y, rect) → bool, onChange(state, t), max (px) }) → { st: { on, x, y, m, ox, oy, px, py }, off() }
  function touchStick(el, o = {}){
    const st = { on: false, id: -1, x: 0, y: 0, m: 0, ox: 0, oy: 0, px: 0, py: 0 };
    const R = () => (o.max || 56);
    const down = e => {
      if (e.pointerType === 'mouse' || st.on) return;
      if (e.target?.closest?.('button, a, input, .io-noj')) return;
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (o.zone && !o.zone(x, y, r)) return;
      st.on = true; st.id = e.pointerId; st.ox = x; st.oy = y; st.px = x; st.py = y; st.x = st.y = st.m = 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      o.onChange?.(st, e.timeStamp);
    };
    const move = e => {
      if (!st.on || e.pointerId !== st.id) return;
      const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let dx = x - st.ox, dy = y - st.oy;
      const d = Math.hypot(dx, dy), max = R();
      if (d > max * 1.6) { st.ox = x - dx / d * max * 1.6; st.oy = y - dy / d * max * 1.6; dx = x - st.ox; dy = y - st.oy; }   // палец ушёл далеко — центр тянется за ним
      const dd = Math.hypot(dx, dy);
      st.px = x; st.py = y;
      st.m = clamp(dd / max, 0, 1);
      st.x = dd ? dx / dd * st.m : 0; st.y = dd ? dy / dd * st.m : 0;
      o.onChange?.(st, e.timeStamp);
    };
    const up = e => {
      if (!st.on || e.pointerId !== st.id) return;
      st.on = false; st.id = -1; st.x = st.y = st.m = 0;
      o.onChange?.(st, e.timeStamp);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    return { st, off(){ el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('lostpointercapture', up); } };
  }
  function drawStick(ctx, st, dpr, color){
    if (!st.on) return;
    const R = 56 * dpr;
    ctx.save();
    ctx.globalAlpha = .9;
    ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(st.ox * dpr, st.oy * dpr, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color || 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc((st.ox + st.x * 56) * dpr, (st.oy + st.y * 56) * dpr, 24 * dpr, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // Геймпад: левый стик и кнопки (A — 0, B — 1, X — 2, Y — 3, RT — 7, LT — 6)
  function pad(){
    try {
      const list = root.navigator?.getGamepads?.() || [];
      for (const g of list) {
        if (!g || !g.connected) continue;
        let x = g.axes[0] || 0, y = g.axes[1] || 0;
        const m = Math.hypot(x, y);
        if (m < .18) { x = 0; y = 0; } else if (m > 1) { x /= m; y /= m; }
        const b = i => !!(g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > .5));
        return { x, y, a: b(0), b: b(1), x2: b(2), y2: b(3), rt: b(7), lt: b(6), start: b(9) };
      }
    } catch (e) {}
    return null;
  }

  // ═══ Вид: сколько мира видно (одинаково на телефоне и ПК — по площади, не по пикселям) ═══
  function viewBox(area, aspect){ const a = clamp(aspect || 1.6, .3, 3.5); const h = Math.sqrt(area / a); return { w: h * a, h }; }

  // ═══ Экран: общий каркас, таблица лидеров, окна поверх ═══
  const escH = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const num = n => Math.round(+n || 0).toLocaleString('ru');
  const ru = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
  function shell(el, o){
    css();
    el.innerHTML = `<div class="io io-${o.cls || ''}" style="--io-c:${o.color || '#22c55e'}">
      <div class="io-wrap">
        <canvas class="io-cv"></canvas>
        <div class="io-hud" hidden>
          <div class="io-tl"><div class="io-score"><b class="io-sc">0</b><small class="io-scl">${escH(o.scoreLabel || '')}</small></div><div class="io-rank"></div>
            <div class="io-row"><button type="button" class="io-ib io-noj" data-io="emo" title="Эмодзи" aria-label="Эмодзи">😀</button><button type="button" class="io-ib io-noj" data-io="invite" title="Позвать друга" aria-label="Позвать друга">🔗</button><button type="button" class="io-ib io-noj" data-io="menu" title="Меню" aria-label="Меню">☰</button></div>
            <div class="io-emos io-noj" hidden>${EMOTES.map((e, i) => `<button type="button" data-io="e${i + 1}">${e}</button>`).join('')}</div></div>
          <div class="io-tc"><span class="io-time"></span><span class="io-net"></span></div>
          <ol class="io-lb"></ol>
          <div class="io-pad io-noj">${o.padHtml || ''}</div>
        </div>
        <div class="io-ov" hidden></div>
      </div>
      <div class="ct-note io-note">${escH(o.note || '')}</div>
    </div>`;
    const q = s => el.querySelector(s);
    return { el, wrap: q('.io-wrap'), cv: q('.io-cv'), hud: q('.io-hud'), ov: q('.io-ov'), lb: q('.io-lb'), sc: q('.io-sc'), rank: q('.io-rank'), time: q('.io-time'), net: q('.io-net'), emos: q('.io-emos'), pad: q('.io-pad') };
  }
  // Высота поля: во весь экран — всё место; телефон — почти весь экран; ПК — по ширине
  function fitHeight(wrap){
    const full = !!(root.D37Full && root.D37Full.contains(wrap));
    const w = wrap.parentElement?.clientWidth || 360;
    if (full) { const box = wrap.closest('#gamesStageBox') || wrap.parentElement; return Math.max(240, Math.floor(box.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - 2)); }
    const vh = root.innerHeight || 700;
    if (w < 640) return Math.max(360, Math.min(vh - 110, Math.round(w * 1.75)));
    return Math.max(420, Math.min(vh - 200, Math.round(w * .62)));
  }
  // Таблица 10 лучших: list — [{ i, name, score, bot, me }]
  function lbHtml(list, label){
    return list.map((r, k) => `<li class="${r.me ? 'me' : ''}"><i>${k + 1}</i><span>${r.bot ? '<em title="Бот">🤖</em>' : ''}${escH(showName(r.name))}</span><b>${num(r.score)}</b></li>`).join('');
  }
  function linkFor(game, code){ return (root.D37Ref?.wrap || (u => u))((root.location ? location.origin + location.pathname : 'https://dan4ik37.vercel.app/') + `#/games/${game}/${code}`); }
  // Новая комната: ссылку — другу сразу (в том же нажатии), сами — в комнату по адресу #/games/<игра>/<код>
  function inviteNew(game, title, toast){
    const code = root.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8);
    share(game, code, title, toast);
    try { location.hash = `#/games/${game}/${code}`; } catch (e) {}
    return code;
  }
  async function share(game, code, title, toast){
    const url = linkFor(game, code), text = `Залетай ко мне в «${title}»! Комната ${code}`;
    if (root.navigator?.share) { try { await navigator.share({ title, text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast?.('🔗 Ссылка скопирована — отправь другу'); }
    catch (e) { try { prompt('Скопируй ссылку и отправь другу:', url); } catch (er) {} }
  }
  // Свои цвета персонажа (гардероб, js/core/avatar.js): основной — «Цвет», второй — цвет волос / глаз
  function myColors(){
    try {
      const C = root.D37Char, L = C?.look?.();
      if (!C || !L) return null;
      const hex = (slot, id) => { const p = C.part?.(slot, id); return p && /^#[0-9a-f]{6}$/i.test(p.v || '') ? p.v.toLowerCase() : null; };
      const c1 = hex('color', L.color) || '#4f8df7';
      let c2 = (L.hairc && hex('hairc', L.hairc)) || (L.eyec && hex('eyec', L.eyec)) || null;
      if (!c2 || c2 === c1) c2 = shade(c1, .55);
      return { c1, c2, rainbow: L.color === 'rainbow', gold: L.color === 'gold', galaxy: L.color === 'galaxy' };
    } catch (e) { return null; }
  }
  function shade(hex, k){
    const n = parseInt(String(hex).slice(1), 16);
    const f = v => clamp(Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1)), 0, 255);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('');
  }
  const okColor = s => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null);

  // ═══ Общие экраны io-игр (меню, «тебя съели», итоги раунда) — разметка одна, рисунок раскраски — у игры ═══
  // menuHtml({ logo, title, sub, name, presets, patterns, game }) — кнопки data-io: play / bots / friend, раскраски sk<N>, pat, ca, cb, mine
  function menuHtml(o){
    return `<div class="io-card wide">
        <div class="io-logo">${o.logo}</div><div class="io-title">${escH(o.title)}</div>
        <div class="io-sub">${escH(o.sub)}</div>
        <div class="io-name"><input type="text" maxlength="16" placeholder="Имя на арене" value="${escH(o.name || '')}" aria-label="Имя на арене" autocomplete="off" enterkeyhint="go"></div>
        <div class="io-skins">${Array.from({ length: o.presets }, (_, k) => `<button type="button" data-io="sk${k}" aria-label="Раскраска ${k + 1}"><canvas width="64" height="64"></canvas></button>`).join('')}</div>
        <div class="io-cols"><label>Узор <select data-io="pat">${o.patterns.map((p, k) => `<option value="${k}">${escH(p)}</option>`).join('')}</select></label>
          <label>Цвет <input type="color" data-io="ca"></label><label>Второй <input type="color" data-io="cb"></label>
          ${myColors() ? '<button type="button" class="io-b2 io-sm" data-io="mine">🎭 Мои цвета</button>' : ''}</div>
        <div class="io-btns">
          <button type="button" class="ct-start" data-io="play">▶ Играть</button>
          <button type="button" class="io-b2" data-io="bots">🤖 С ботами (без интернета)</button>
          <button type="button" class="io-b2" data-io="friend">🔗 Позвать друга</button>
          <button type="button" class="io-b2" data-gk-rules="${o.game}">📖 Правила</button>
        </div>
        <div class="io-cd">Чата нет — только эмодзи. Боты отмечены 🤖. Раунд — 5 минут.</div>
      </div>`;
  }
  // Карточка «нокаут»: { logo, title, sub, stats: [[число, подпись], …] }
  function koHtml(o){
    return `<div class="io-card"><div class="io-logo">${o.logo}</div><div class="io-title">${escH(o.title)}</div>
      ${o.sub ? `<div class="io-sub">${escH(o.sub)}</div>` : ''}
      <div class="io-stats">${o.stats.map(([v, l]) => `<div><b>${escH(v)}</b><small>${escH(l)}</small></div>`).join('')}</div>
      <div class="io-btns"><button type="button" class="ct-start" data-io="again">▶ Ещё раз</button><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`;
  }
  // Итоги раунда (событие 'end' мира: rank — [[участник, очки, лучшее, секунд], …], names — [[имя, бот], …] тройки)
  function podiumHtml(e, me){
    const mine = e.rank.findIndex(r => r[0] === me);
    const pod = [1, 0, 2].map(k => e.rank[k] ? `<div><b>${['🥇', '🥈', '🥉'][k]}</b><span>${escH(showName(e.names[k]?.[0] || ''))}${e.names[k]?.[1] ? ' 🤖' : ''}</span><small>${num(e.rank[k][1])}</small><i style="height:${[54, 74, 40][k]}px"></i></div>` : '').join('');
    return `<div class="io-card"><div class="io-logo">🏁</div><div class="io-title">Раунд окончен</div><div class="io-pod">${pod}</div>
      ${mine >= 0 ? `<div class="io-me">${mine === 0 ? '🏆 Ты победил!' : `Твоё место: ${mine + 1} из ${e.rank.length}`}</div>` : ''}
      <div class="io-cd">Новый раунд через <b class="io-left">8</b> с</div><div class="io-btns"><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`;
  }
  const connHtml = pub => `<div class="io-card"><div class="io-logo">🌐</div><div class="io-sub">${pub ? 'Ищем арену с живыми игроками…' : 'Подключаемся к комнате…'}</div></div>`;
  function errHtml(v){
    const txt = v === 'full' ? 'Комната заполнена (10 игроков).' : v === 'dup' ? 'Ты уже играешь в этой комнате в другой вкладке.' : 'Не удалось подключиться.';
    return `<div class="io-card"><div class="io-logo">📡</div><div class="io-title" style="font-size:1.2rem">${txt}</div><div class="io-btns"><button type="button" class="ct-start" data-io="bots">🤖 Играть с ботами</button><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`;
  }
  // Подпись сети: «🤖 с ботами» / «🌐 общая · 👥 3 · 80 мс» / «🔗 abc123 · 👥 2 · 🐢» (🐢 — без прямой связи, медленнее)
  function netLabel(S){
    if (!S || S.role === 'off') return '🤖 с ботами';
    const pub = /^pub\d+$/.test(S.code || ''), m = S.netMode();
    return `${pub ? '🌐 общая арена' : '🔗 ' + S.code} · 👥 ${S.humans()}${m === 'relay' || m === 'connecting' ? ' · 🐢' : ''}${S.role === 'guest' && S.rtt ? ` · ${Math.round(S.rtt)} мс` : ''}`;
  }
  // Итог жизни: рекорд и XP (онлайн — от 2 людей в комнате), монеты — очки/100, до 10 (coin_run_cap)
  function reportLife(api, game, S, best, win){
    if (!api) return;
    best = Math.max(0, Math.round(best || 0));
    const online = S && S.role !== 'off' && S.humans() >= 2;
    try { api.report?.(online ? game + '_online' : game, !!win, best, best); } catch (e) {}
    const coins = Math.min(10, Math.floor(best / 100));
    if (coins > 0 && root.D37Coins) { try { root.D37Coins.run(game, coins, game.slice(0, 3) + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36))?.catch?.(() => {}); } catch (e) {} }
  }

  // ═══ CSS (общий для обеих игр; грузится вместе с ними) ═══
  const CSS = `
.io{position:relative;--io-c:#22c55e}
.io-wrap{position:relative;width:100%;border-radius:16px;overflow:hidden;background:#0a0e19;border:1px solid rgba(255,255,255,.08);user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent}
#gamesStage.gs-fs .io-wrap{border-radius:0;border:0}
.io-cv{display:block;width:100%;height:100%;cursor:crosshair}
.io-hud{position:absolute;inset:0;pointer-events:none;font-family:Montserrat,system-ui,sans-serif;color:#fff}
.io-hud[hidden],.io-ov[hidden]{display:none!important}
.io-tl{position:absolute;left:10px;top:8px;display:flex;flex-direction:column;align-items:flex-start;gap:4px;max-width:46%}
.io-score{display:flex;align-items:baseline;gap:.35rem;text-shadow:0 2px 6px rgba(0,0,0,.6)}
.io-sc{font-size:1.25rem;font-weight:900;font-variant-numeric:tabular-nums}
.io-scl{font-size:.68rem;opacity:.75}
.io-rank{font-size:.7rem;opacity:.85;text-shadow:0 1px 4px rgba(0,0,0,.7)}
.io-rank:empty{display:none}
.io-row{display:flex;gap:6px;pointer-events:auto}
.io-ib{width:40px;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(10,12,24,.55);color:#fff;font-size:1.05rem;cursor:pointer;touch-action:manipulation;display:grid;place-items:center;padding:0}
.io-ib:active{transform:scale(.94)}
.io-emos{display:grid;grid-template-columns:repeat(4,40px);gap:5px;pointer-events:auto;padding:6px;border-radius:14px;background:rgba(10,12,24,.75);border:1px solid rgba(255,255,255,.14)}
.io-emos[hidden]{display:none}
.io-emos button{width:40px;height:40px;border-radius:10px;border:0;background:rgba(255,255,255,.08);font-size:1.25rem;cursor:pointer;touch-action:manipulation}
.io-tc{position:absolute;left:50%;top:8px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;text-shadow:0 1px 4px rgba(0,0,0,.7)}
.io-time{font-weight:900;font-size:.95rem;font-variant-numeric:tabular-nums}
.io-net{font-size:.62rem;opacity:.8;white-space:nowrap}
.io-lb{position:absolute;right:8px;top:8px;margin:0;padding:6px 8px;list-style:none;min-width:150px;max-width:44%;border-radius:12px;background:rgba(8,10,20,.5);font-size:.7rem;line-height:1.5}
.io-lb:empty{display:none}
.io-lb li{display:flex;gap:6px;align-items:center;white-space:nowrap}
.io-lb li i{font-style:normal;opacity:.6;width:1.3em;text-align:right}
.io-lb li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.io-lb li em{font-style:normal;font-size:.75em;margin-right:2px;opacity:.85}
.io-lb li b{font-variant-numeric:tabular-nums;opacity:.85}
.io-lb li.me{color:#fde68a;font-weight:800}
.io-pad{position:absolute;right:12px;bottom:14px;display:flex;gap:12px;align-items:flex-end;pointer-events:auto}
.io-pad:empty{display:none}
.io-big{width:68px;height:68px;border-radius:50%;border:2px solid rgba(255,255,255,.35);background:rgba(10,12,24,.55);color:#fff;font:800 .62rem Montserrat,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;touch-action:none;padding:0}
.io-big b{font-size:1.45rem;line-height:1}
.io-big.on,.io-big:active{background:color-mix(in srgb,var(--io-c) 55%,transparent);border-color:#fff}
.io-big.big{width:80px;height:80px}
.io-ov{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;padding:12px;background:rgba(4,5,12,.55);overflow:auto;overscroll-behavior:contain;z-index:2;touch-action:pan-y}
.io-ov>.io-card{margin:auto}
.io-ov.ko{background:rgba(2,2,8,.72)}
body.high .io-ov.ko{animation:ioDark .7s ease-out}
@keyframes ioDark{from{background:rgba(2,2,8,0)}to{background:rgba(2,2,8,.72)}}
.io-card{width:min(420px,100%);display:flex;flex-direction:column;align-items:center;gap:.6rem;text-align:center;padding:1.1rem 1rem 1rem;border-radius:18px;background:rgba(18,16,30,.94);border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 60px rgba(0,0,0,.55);color:var(--text,#f0f0f8)}
.io-card.wide{width:min(520px,100%)}
.io-logo{font-size:3rem;line-height:1}
.io-title{font-family:var(--font-display,inherit);font-size:1.7rem;font-weight:900;letter-spacing:.5px}
.io-sub{font-size:.8rem;color:var(--muted,#9a98b3);line-height:1.45;max-width:400px}
.io-btns{display:flex;flex-direction:column;gap:.5rem;width:min(100%,330px)}
.io-btns .ct-start{align-self:stretch;min-height:46px}
.io-b2{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:var(--text,#f0f0f8);border-radius:12px;padding:.6rem 1rem;font:800 .8rem Montserrat,system-ui,sans-serif;cursor:pointer;min-height:44px;touch-action:manipulation}
.io-b2:hover{border-color:var(--io-c)}
.io-name{width:min(100%,330px);display:flex;gap:.4rem;align-items:center}
.io-name input{flex:1;min-width:0;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.14);border-radius:12px;padding:.6rem .75rem;color:var(--text,#fff);font:700 .9rem Montserrat,system-ui,sans-serif;text-align:center}
.io-skins{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;width:min(100%,330px)}
.io-skins button{aspect-ratio:1;border-radius:12px;border:2px solid transparent;background:rgba(255,255,255,.05);cursor:pointer;padding:3px;display:grid;place-items:center;touch-action:manipulation;color:#fff;font-size:.65rem}
.io-skins button.sel{border-color:#fff;background:rgba(255,255,255,.12)}
.io-skins canvas{width:100%;height:100%}
.io-cols{display:flex;gap:.6rem;align-items:center;justify-content:center;font-size:.72rem;color:var(--muted,#9a98b3);flex-wrap:wrap}
.io-cols label{display:flex;gap:.3rem;align-items:center}
.io-cols input[type=color]{width:38px;height:30px;border:0;background:none;padding:0;cursor:pointer}
.io-cols select{background:rgba(255,255,255,.08);color:var(--text,#fff);border:1px solid rgba(255,255,255,.16);border-radius:8px;padding:.25rem .4rem;font:700 .72rem Montserrat,system-ui,sans-serif}
.io-cols select option{background:#16131f;color:#fff}
.io-sm{min-height:34px!important;padding:.3rem .7rem!important;font-size:.72rem!important}
.io-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;width:100%}
.io-stats div{background:rgba(255,255,255,.05);border-radius:12px;padding:.45rem .3rem;display:flex;flex-direction:column;gap:2px}
.io-stats b{font-size:1.05rem;font-variant-numeric:tabular-nums}
.io-stats small{font-size:.62rem;color:var(--muted,#9a98b3)}
.io-pod{display:flex;align-items:flex-end;justify-content:center;gap:.4rem;width:100%;margin:.3rem 0}
.io-pod div{flex:1;max-width:120px;display:flex;flex-direction:column;align-items:center;gap:3px;font-size:.7rem}
.io-pod div b{font-size:1.4rem}
.io-pod div span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800}
.io-pod div i{display:block;width:100%;border-radius:8px 8px 0 0;background:linear-gradient(180deg,var(--io-c),rgba(255,255,255,.05));font-style:normal}
.io-me{font-size:.8rem;color:#fde68a;font-weight:800}
.io-cd{font-size:.72rem;color:var(--muted,#9a98b3)}
.io-note{text-align:center;margin-top:.45rem}
#gamesStage.gs-fs .io-note{display:none}
.io-link{display:flex;gap:.4rem;width:100%}
.io-link input{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.14);border-radius:10px;padding:.5rem .6rem;color:var(--text,#fff);font-size:.7rem;font-family:monospace}
@media(max-width:520px){.io-lb{min-width:112px;font-size:.62rem;padding:4px 6px}.io-lb li:nth-child(n+6){display:none}.io-lb li.me{display:flex}.io-sc{font-size:1.05rem}.io-title{font-size:1.4rem}.io-skins{grid-template-columns:repeat(6,1fr)}}
@media(hover:hover) and (pointer:fine){.io-pad.touch-only{display:none}}
body.low .io-ov{-webkit-backdrop-filter:none;backdrop-filter:none}
`;
  function css(){ if (!root.document || document.getElementById('ioCss')) return; const s = document.createElement('style'); s.id = 'ioCss'; s.textContent = CSS; document.head.appendChild(s); }

  root.IoKit = { TAU, clamp, lerp, rnd, hash3, hashNums, writer, reader, toB64, fromB64, cleanName, hasBad, showName, EMOTES, inputLog,
    party, supaTransport, netOk, whenNet, session, pubCode, myKey, myNick, touchStick, drawStick, pad, viewBox, shell, fitHeight, lbHtml, linkFor, share,
    myColors, shade, okColor, escH, num, ru, css, RELAY_MS, inviteNew, menuHtml, koHtml, podiumHtml, connHtml, errHtml, netLabel, reportLife };
})();

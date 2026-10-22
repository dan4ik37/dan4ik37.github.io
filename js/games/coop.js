// ═══════════════════════════════════════
//  ИГРА ВМЕСТЕ — комната «хозяин мира + гости» (D37Coop): «Кубомир» сейчас, «Подземье» потом
// ═══════════════════════════════════════
// Хозяин — тот, чей мир (в присутствии — h: 1), а не «кто раньше вошёл»: гость, открывший ссылку без хозяина, ждёт его; хозяин
// ушёл — комната кончилась (смены хозяина в этапе 1 нет). Код комнаты — отпечаток ключа мира (makeKey: ECDSA P-256, 8 знаков SHA-256
// от открытого ключа): присутствие можно подделать, а ответ хозяина — нет (игра проверяет подпись в первом ответе — verify; не та —
// markFake, гость ищет настоящего). Связь «звездой»: хозяин ↔ каждый гость — WebRTC (netplay.js: снимки — без повторов, остальное —
// гарантированно и по порядку); знакомство и присутствие — канал Supabase `<игра>-co-<код>` (GameRoom.channel: ждёт sbClient до 8 с,
// копит до подписки). Нет прямой связи за 3,5 с (строгий NAT) — свой канал на пару `<игра>-co-<код>-r<номер>` (в нём только хозяин и
// этот гость: чужие пакеты не приходят и не считаются в лимит Supabase), все пакеты — одним сообщением раз в 1/3 с (снимок — только
// последний). Связь появилась — очередь канала уходит напрямую. Лимит бесплатного Supabase — 2 млн сообщений в месяц на весь сайт.
// Надёжные пакеты нумеруются (0xFD + номер): пришли не по порядку (разными путями) — выстраиваются; потерялись (прямая связь
// оборвалась с недоставленным) — через 5 с onGap(от кого): игра просит полную сверку. Большие режутся по 16 КБ (0xFE). Первый байт
// пакета игры — её тип (0…0xEF); 0xF0…0xFF — служебные. Без мусора на кадр: буферы — у игры, здесь копируются только в очередь канала.
//   const R = D37Coop.room({ game, code, host, me: { key, nick, meta }, pickHost(list), onMembers(list), onHost(id | null),
//     onMsg(from, u8), onGap(from), onMode(id, mode), onError(reason: offline | dup) })
//   R.send(to, u8, fast) · R.flush() — из шага игры (и сам раз в 1/3 с) · R.mode(id) · R.backlog(id) · R.markFake(id) · R.stats() ·
//   R.members() · R.close()
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.D37Coop) return;
  const RELAY_MS = 333, FRAG = 16000, BUNDLE = 46000, ANNOUNCE_MS = 800, P2P_WAIT = 3500, GAP_MS = 5000, KEEP_RELAY = 10000;
  const T_FRAG = 0xFE, T_SEQ = 0xFD;
  // Присутствие Supabase: больше 5 «вошёл/вышел» (track/untrack) за 30 с от одной страницы — сервер закрывает канал (так мир
  // оставался без связи). Вход в комнату ждёт, пока в окне 31 с не меньше 4 таких отметок (вышел-вошёл быстро — подождёт секунды)
  const presOps = [];
  const presWait = t => { while (presOps.length && t - presOps[0] > 31000) presOps.shift(); return presOps.length >= 4 ? presOps[0] + 31000 - t + 50 : 0; };
  const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const CTRL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028) + '-' + String.fromCharCode(0x202e) + String.fromCharCode(0x2060) + '-' + String.fromCharCode(0x206f) + String.fromCharCode(0xfeff) + ']', 'g');
  const cleanNick = s => String(s ?? '').replace(CTRL, '').trim().slice(0, 24) || 'Игрок';

  // ── ключ мира и код комнаты: код — 8 знаков base32 от SHA-256 открытого ключа (подобрать чужой — ~10¹² попыток) ──
  const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
  const subtle = () => root.crypto?.subtle || null;
  async function codeOf(pubU8){
    const h = new Uint8Array(await subtle().digest('SHA-256', pubU8));
    let bits = 0, v = 0, out = '';
    for (let i = 0; i < 6 && out.length < 8; i++) { v = (v << 8) | h[i]; bits += 8; while (bits >= 5 && out.length < 8) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
    return out;
  }
  async function makeKey(){
    const S = subtle(); if (!S) return null;
    const kp = await S.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await S.exportKey('raw', kp.publicKey));
    return { pub: toB64(pub), jwk: await S.exportKey('jwk', kp.privateKey), code: await codeOf(pub) };
  }
  const priv = new WeakMap();
  async function sign(key, text){
    const S = subtle(); if (!S || !key?.jwk) return '';
    let k = priv.get(key);
    if (!k) { k = await S.importKey('jwk', key.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']); priv.set(key, k); }
    return toB64(new Uint8Array(await S.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, new TextEncoder().encode(text))));
  }
  // подпись хозяина: открытый ключ даёт этот код и подпись текста верна
  async function verify(code, pubB64, text, sigB64){
    try {
      const S = subtle(); if (!S || typeof pubB64 !== 'string' || typeof sigB64 !== 'string' || pubB64.length > 200 || sigB64.length > 200) return false;
      const pub = fromB64(pubB64);
      if ((await codeOf(pub)) !== code) return false;
      const k = await S.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await S.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, fromB64(sigB64), new TextEncoder().encode(String(text)));
    } catch (e) { return false; }
  }

  function room(o){
    const now = o.now || (() => Date.now()), setT = o.setT || ((f, ms) => setTimeout(f, ms)), clearT = o.clearT || (t => clearTimeout(t));
    const open = o.open || ((name, opts) => root.GameRoom.channel(name, opts));
    const NP = o.forceRelay || root.D37Coop?.forceRelay || root.__coopRelay ? null : (o.net !== undefined ? o.net : root.NetPlay);   // __coopRelay — проверка «без WebRTC»
    const t0 = now(), me = o.me.key + '~' + t0;
    const R = { code: o.code, me, isHost: !!o.host, hostId: null, joined: false, closed: false, list: [], fake: new Set() };
    const links = new Map(), relays = new Map(), inSeq = new Map(), frags = new Map(), outSeq = new Map(), sent = new Map();
    const st = { relayMsgsOut: 0, relayMsgsIn: 0, relayBytesOut: 0, relayBytesIn: 0, p2pBytesOut: 0, p2pBytesIn: 0, sigOut: 0, syncs: 0, gaps: 0, dup: 0, reordered: 0, moved: 0, since: t0 };
    let fragId = 1, tracked = false, last = null;
    const peerSt = id => { let s = sent.get(id); if (!s) sent.set(id, s = { out: 0, inn: 0, relayOut: 0, relayIn: 0, fastOut: 0, relayMsgs: 0 }); return s; };

    const main = open(`${o.game}-co-${o.code}`, { config: { broadcast: { self: false }, presence: { key: o.me.key } } });
    main.on('presence', { event: 'sync' }, () => { st.syncs++; last = main.presenceState(); sync(last); });
    main.on('broadcast', { event: 'm' }, ({ payload }) => recvMain(payload));
    const doTrack = async () => { if (R.closed || tracked) return; tracked = true; presOps.push(now()); try { await main.track(Object.assign({}, o.me.meta || {}, { n: cleanNick(o.me.nick), t: t0, h: R.isHost ? 1 : 0 })); } catch (e) {} };
    let joinT = 0;
    main.subscribe(s => {
      if (R.closed) return;
      if (s === 'SUBSCRIBED') { if (!tracked) { const w = presWait(now()); if (w > 0) { clearT(joinT); joinT = setT(() => { if (!R.joined) fail('offline'); }, w + (o.joinMs || 15000)); R.presWait = w; setT(doTrack, w); } else doTrack(); } }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') fail('offline');
    });
    joinT = setT(() => { if (!R.joined) fail('offline'); }, o.joinMs || 15000);
    const tick = setInterval(() => R.flush(), RELAY_MS);
    const onHide = () => R.close();
    if (root.addEventListener) root.addEventListener('pagehide', onHide);

    // ── кто в комнате; хозяина выбирает игра (pickHost): по умолчанию — первый с h: 1, кроме поддельных ──
    function sync(state){
      if (R.closed) return;
      const list = [];
      for (const key of Object.keys(state || {})) {
        const metas = Array.isArray(state[key]) ? state[key] : [];
        const m = metas.reduce((a, b) => (b && typeof b.t === 'number' && (!a || b.t > a.t) ? b : a), null);
        if (!m) continue;
        list.push({ id: key + '~' + m.t, key, t: m.t, nick: cleanNick(m.n), host: m.h === 1, meta: m });
      }
      list.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (!list.some(p => p.id === me)) { if (R.joined && list.some(p => p.key === o.me.key)) fail('dup'); return; }
      let host = null;
      if (R.isHost) {
        host = list.find(p => p.id === me);
        if (list.some(p => p.host && p.id !== me && !R.fake.has(p.id) && (o.sameHost ? o.sameHost(p) : false))) { fail('dup'); return; }   // этот мир уже открыт хозяином в другой вкладке
      } else host = o.pickHost ? o.pickHost(list.filter(p => !R.fake.has(p.id)), R) : list.find(p => p.host && !R.fake.has(p.id)) || null;
      const first = !R.joined;
      R.joined = true; clearT(joinT);
      R.list = list.filter(p => !R.fake.has(p.id) && (p === host || !p.host));
      const ids = new Set(R.list.map(p => p.id)), hid = host ? host.id : null;
      for (const [id, L] of links) if (!ids.has(id) || (!R.isHost && id !== hid)) forget(id);
      if (hid !== R.hostId || first) { R.hostId = hid; o.onHost?.(hid); }
      if (R.isHost) { for (const p of R.list) if (p.id !== me && !links.has(p.id)) { const L = link(p.id); relayFor(p.id); setT(() => { if (links.get(p.id) === L) L.offer(); }, ANNOUNCE_MS); } }
      else if (hid && !links.has(hid)) { link(hid); relayFor(hid); }   // гость ждёт предложения хозяина (время знакомства — с этой минуты)
      o.onMembers?.(R.list.slice());
    }
    function forget(id){ const L = links.get(id); if (L) L.close(); links.delete(id); dropRelay(id, true); const S = inSeq.get(id); if (S?.gapT) clearT(S.gapT); inSeq.delete(id); frags.delete(id); outSeq.delete(id); }
    R.markFake = id => { if (!id || id === me) return; R.fake.add(id); forget(id); if (last) sync(last); };
    // ── прямая связь (WebRTC) с одним: знакомство — через главный канал адресно ──
    function link(peer){
      const vroom = { isHost: R.isHost, send: m => { if (R.closed) return; st.sigOut++; main.send({ type: 'broadcast', event: 'm', payload: { k: 'np', to: peer, _by: me, np: m } }); } };
      let np = null;
      try { np = NP ? NP.start(vroom, { onMessage(){}, onBinary: b => recvBin(peer, new Uint8Array(b), 0), onMode: m => modeChanged(peer, m) }) : null; } catch (e) { np = null; }
      const L = { np, at: now(), p2pAt: 0, offer(){ if (np && !R.closed) np.offer(); }, close(){ try { np?.close(); } catch (e) {} },
        mode: () => (np ? np.mode() : 'relay'), p2p: () => !!np && np.mode() === 'p2p' };
      links.set(peer, L);
      return L;
    }
    function modeChanged(peer, m){
      const L = links.get(peer); if (!L) return;
      if (m === 'p2p') { L.p2pAt = now(); moveToP2P(peer); }
      o.onMode?.(peer, m);
    }
    function recvMain(p){
      if (R.closed || !p || p.k !== 'np' || p.to !== me || typeof p._by !== 'string' || !p.np || typeof p.np.type !== 'string') return;
      let L = links.get(p._by);
      if (!L && !R.isHost && p._by === R.hostId) L = link(p._by);
      L?.np?.handle(p.np);
    }
    // запасной канал: прямой нет совсем или знакомимся дольше 3,5 с (до того надёжное ждёт в очереди)
    const relayOk = to => { const L = links.get(to); return !L || !L.np || L.mode() === 'relay' || now() - L.at > P2P_WAIT; };
    // ── запасной канал на пару ──
    function relayFor(peer){
      let Q = relays.get(peer);
      if (Q) return Q;
      const gid = R.isHost ? peer : me;
      const ch = open(`${o.game}-co-${o.code}-r${hash(gid)}`, { config: { broadcast: { self: false } } });
      // seen — второй уже в канале (пришло хоть что-то от него): до того шлём только «я тут» раз в секунду, данные ждут — иначе
      // первые сообщения теряются (Supabase не хранит рассылку, а подписка второго ещё не готова)
      Q = { ch, q: [], qBytes: 0, fast: new Map(), last: -1e9, used: now(), seen: false, sub: false, pingT: -1e9 };
      ch.on('broadcast', { event: 'm' }, ({ payload: m }) => {
        if (R.closed || !m || m.k !== 'R' || m.to !== me || m._by !== peer || !Array.isArray(m.p)) return;
        st.relayMsgsIn++; Q.used = now();
        if (!Q.seen) { Q.seen = true; if (m.ping && !m.pong) ping(Q, peer, true); }
        for (const b of m.p.slice(0, 400)) { if (typeof b !== 'string' || b.length > 70000) continue; let u; try { u = fromB64(b); } catch (e) { continue; } st.relayBytesIn += u.length; peerSt(peer).relayIn += u.length; recvBin(peer, u, 1); }
      });
      ch.subscribe(s => { if (s === 'SUBSCRIBED' && !Q.sub) { Q.sub = true; if (!Q.seen) ping(Q, peer, false); } });
      relays.set(peer, Q);
      return Q;
    }
    function ping(Q, peer, pong){ if (R.closed) return; Q.pingT = now(); st.relayMsgsOut++; st.relayPings = (st.relayPings || 0) + 1; Q.ch.send({ type: 'broadcast', event: 'm', payload: { k: 'R', to: peer, _by: me, p: [], ping: 1, pong: pong ? 1 : 0 } }); }
    function dropRelay(peer, force){ const Q = relays.get(peer); if (!Q) return; if (!force && (Q.q.length || Q.fast.size)) return; try { Q.ch.close(); } catch (e) {} relays.delete(peer); }
    // связь появилась — всё, что ждало в очереди канала, уходит напрямую (порядок держат номера)
    function moveToP2P(peer){
      const Q = relays.get(peer), L = links.get(peer); if (!Q || !L || !L.p2p()) return;
      while (Q.q.length) { const u = Q.q[0]; if (!L.np.sendRel(u)) return; Q.q.shift(); Q.qBytes -= u.length; st.p2pBytesOut += u.length; st.moved++; }
      Q.fast.clear();
    }
    // ── отправка ──
    function* parts(f){
      if (f.length <= FRAG) { yield f; return; }
      const id = fragId = (fragId % 65535) + 1, n = Math.ceil(f.length / FRAG);
      for (let i = 0; i < n; i++) {
        const a = i * FRAG, b = Math.min(f.length, a + FRAG), u = new Uint8Array(7 + b - a);
        u[0] = T_FRAG; u[1] = id & 255; u[2] = id >> 8; u[3] = i & 255; u[4] = i >> 8; u[5] = n & 255; u[6] = n >> 8; u.set(f.subarray(a, b), 7);
        yield u;
      }
    }
    R.send = (to, u8, fast) => {
      if (R.closed || !R.joined || !to || to === me || !(u8 instanceof Uint8Array) || !u8.length) return false;
      if (!R.list.some(p => p.id === to)) return false;
      const ps = peerSt(to); ps.out += u8.length;
      const L = links.get(to), direct = !!L && L.p2p();
      if (fast) {
        ps.fastOut += u8.length;
        if (direct) { L.np.sendBin(u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer); st.p2pBytesOut += u8.length; return true; }
        if (!relayOk(to)) return false;   // ещё знакомимся — снимок подождёт следующего
        relayFor(to).fast.set(u8[0], u8.slice()); return true;
      }
      const sq = (outSeq.get(to) || 0) + 1; outSeq.set(to, sq);
      const f = new Uint8Array(u8.length + 5); f[0] = T_SEQ; f[1] = sq & 255; f[2] = (sq >>> 8) & 255; f[3] = (sq >>> 16) & 255; f[4] = (sq >>> 24) & 255; f.set(u8, 5);
      let Q = relays.get(to);
      for (const p of parts(f)) {
        if (direct && !(Q && Q.q.length) && L.np.sendRel(p)) { st.p2pBytesOut += p.length; continue; }
        Q = Q || relayFor(to); Q.q.push(p); Q.qBytes += p.length;
      }
      return true;
    };
    R.flush = () => {
      if (R.closed) return;
      const t = now();
      for (const [peer, Q] of relays) {
        const L = links.get(peer);
        if (L && L.p2p()) { moveToP2P(peer); if (!Q.q.length && t - Math.max(Q.used, L.p2pAt) > KEEP_RELAY) dropRelay(peer); continue; }
        if (!Q.seen) { if (Q.sub && t - Q.pingT > 1000 && relayOk(peer)) ping(Q, peer, false); continue; }   // второго в канале ещё не слышно
        if (t - Q.last < RELAY_MS || (!Q.q.length && !Q.fast.size) || !relayOk(peer)) continue;
        const p = []; let n = 0;
        for (const u of Q.fast.values()) { const b = toB64(u); p.push(b); n += b.length; }
        Q.fast.clear();
        while (Q.q.length && (n === 0 || n + Q.q[0].length * 1.34 <= BUNDLE)) { const u = Q.q.shift(); Q.qBytes -= u.length; const b = toB64(u); p.push(b); n += b.length; }
        if (!p.length) continue;
        Q.last = t; Q.used = t; st.relayMsgsOut++; st.relayBytesOut += n; const ps = peerSt(peer); ps.relayOut += n; ps.relayMsgs++;
        Q.ch.send({ type: 'broadcast', event: 'm', payload: { k: 'R', to: peer, _by: me, p } });
      }
      // нет прямой связи — подписаться на запасной (чтобы получать): гость — у хозяина, хозяин — у каждого такого гостя
      if (!R.isHost) { if (R.hostId && relayOk(R.hostId) && !links.get(R.hostId)?.p2p()) relayFor(R.hostId); }
      else for (const p of R.list) if (p.id !== me && relayOk(p.id) && !links.get(p.id)?.p2p()) relayFor(p.id);
      for (const m of frags.values()) for (const [id, f] of m) if (t - f.t > 60000) m.delete(id);   // устаревшие обрывки
    };
    // ── приём ──
    function recvBin(from, u8, via){
      if (R.closed || !u8.length) return;
      if (via === 0) st.p2pBytesIn += u8.length;
      if (via !== 2) peerSt(from).inn += u8.length;
      if (!R.isHost ? from !== R.hostId : !R.list.some(p => p.id === from)) return;   // гость слушает только хозяина, хозяин — только своих
      if (u8[0] === T_FRAG) {
        if (u8.length < 8) return;
        const id = u8[1] | u8[2] << 8, i = u8[3] | u8[4] << 8, n = u8[5] | u8[6] << 8;
        if (!n || i >= n || n > 4096) return;
        let m = frags.get(from); if (!m) frags.set(from, m = new Map());
        let f = m.get(id); if (!f || f.n !== n) m.set(id, f = { n, got: 0, parts: new Array(n), size: 0, t: now() });
        if (f.parts[i]) return;
        f.parts[i] = u8.subarray(7); f.got++; f.size += u8.length - 7;
        if (f.size > 64e6) { m.delete(id); return; }
        if (f.got < n) return;
        m.delete(id);
        const all = new Uint8Array(f.size); let o2 = 0;
        for (const p of f.parts) { all.set(p, o2); o2 += p.length; }
        return recvBin(from, all, 2);
      }
      if (u8[0] === T_SEQ) {
        if (u8.length < 6) return;
        const sq = (u8[1] | u8[2] << 8 | u8[3] << 16 | u8[4] << 24) >>> 0, body = u8.subarray(5);
        let S = inSeq.get(from); if (!S) inSeq.set(from, S = { want: 1, buf: new Map(), gapT: 0 });
        if (sq < S.want) { st.dup++; return; }
        if (sq > S.want) { st.reordered++; if (S.buf.size < 4000) S.buf.set(sq, body); if (!S.gapT) S.gapT = setT(() => gapOut(from), GAP_MS); return; }
        deliver(from, body); S.want++;
        while (S.buf.has(S.want)) { const b = S.buf.get(S.want); S.buf.delete(S.want); deliver(from, b); S.want++; }
        if (!S.buf.size && S.gapT) { clearT(S.gapT); S.gapT = 0; }
        return;
      }
      if (u8[0] >= 0xF0) return;
      deliver(from, u8);
    }
    function gapOut(from){
      const S = inSeq.get(from); if (!S || R.closed) return;
      S.gapT = 0;
      if (!S.buf.size) return;
      st.gaps++;
      const keys = [...S.buf.keys()].sort((a, b) => a - b);
      for (const k of keys) { deliver(from, S.buf.get(k)); S.want = k + 1; }
      S.buf.clear();
      try { o.onGap?.(from); } catch (e) { console.error(e); }
    }
    function deliver(from, u8){ try { o.onMsg?.(from, u8); } catch (e) { console.error(e); } }
    function fail(reason){ if (R.closed) return; R.close(); try { o.onError?.(reason); } catch (e) { console.error(e); } }

    R.mode = id => { const L = links.get(id); return L ? L.mode() : 'relay'; };
    R.backlog = id => { const Q = relays.get(id), L = links.get(id); return (Q ? Q.qBytes : 0) + (L?.np?.relBuf ? L.np.relBuf() : 0); };
    R.members = () => R.list.slice();
    R.stats = () => Object.assign({}, st, { ms: now() - st.since, links: [...links].map(([id, L]) => ({ id, mode: L.mode() })), relays: relays.size, peers: [...sent].map(([id, s]) => Object.assign({ id }, s)) });
    R.close = () => {
      if (R.closed) return;
      R.closed = true;
      clearT(joinT); clearInterval(tick);
      if (root.removeEventListener) root.removeEventListener('pagehide', onHide);
      for (const id of [...links.keys()]) forget(id);
      for (const Q of relays.values()) try { Q.ch.close(); } catch (e) {}
      links.clear(); relays.clear(); inSeq.clear(); frags.clear();
      if (tracked) presOps.push(now());   // закрыть канал = «вышел» (untrack)
      try { main.close(); } catch (e) {}
    };
    return R;
  }
  const validCode = c => /^[a-z0-9]{4,12}$/.test(String(c || ''));
  root.D37Coop = { room, makeKey, codeOf, sign, verify, validCode, hash, cleanNick, toB64, fromB64, forceRelay: false, RELAY_MS, FRAG };
})();

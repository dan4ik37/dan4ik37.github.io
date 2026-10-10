// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — транспорт для сети миров (net.js): комната Supabase + WebRTC напрямую с каждым, кому есть что слать
// ═══════════════════════════════════════
// const tr = D37E.net.room(game, code, { nick, max, onFull, onError, onMode }) → D37E.net.session({ transport: tr, … })
//   Комната — канал `${game}-net-${code}`: presence — кто в ней и когда вошёл (хозяин — самый ранний), broadcast — знакомство
//   WebRTC и пакеты «через комнату». Пара «я — он» заводится, когда кто-то из двоих впервые шлёт другому (у хозяина и гостя;
//   гости между собой не соединяются): старший по входу предлагает соединение (NetPlay — js/games/netplay.js), младший
//   отвечает. Напрямую (DataChannel без повторов) — сразу; пока не соединились или строгий NAT — через комнату: все пакеты
//   за 200 мс одним broadcast (Supabase считает сообщения по получателям — пачка дешевле). tr.mode(id) — 'p2p' | 'relay' |
//   'connecting'; tr.members() — кто в комнате; tr.stats() — сколько ушло через Supabase; tr.close().
// const tr2 = D37E.net.duel(room, np) — то же для игр на двоих поверх готовых GameRoom + NetPlay: в onPeer — tr2.peer(),
//   в onBinary NetPlay — tr2.binary(buf), в onMessage комнаты — сначала np.handle(m).
// Ограничение: отправитель в broadcast (by) не подписан — как и в room.js; подписи — как в mir.js, если понадобится.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  E.net = E.net || {};
  const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const newest = metas => (metas || []).reduce((a, b) => ((b?.t || 0) > (a?.t || 0) ? b : a), (metas || [])[0] || {});
  const RELAY_MS = 200;

  E.net.room = function (game, code, o = {}){
    // sbClient и currentUser на сайте — let в chat.js: их нет в window, видны только по имени
    const sb = o.client || (typeof sbClient !== 'undefined' && sbClient) || root.sbClient, NP = o.NetPlay || root.NetPlay;
    const now = o.now || (() => (root.performance ? root.performance.now() : Date.now()));
    if (!sb) { o.onError?.('no-client'); return null; }
    const user = (typeof currentUser !== 'undefined' && currentUser) || root.currentUser;
    const key = o.key || user?.id || root.GameRoom?.guestId?.() || 'g-' + Math.random().toString(36).slice(2, 10);
    const joinedAt = o.joinedAt || Date.now(), myId = key + '~' + joinedAt, max = o.max || 8;
    // у клиента Supabase один канал на имя: прежняя комната с этим кодом ещё закрывается — sb.channel вернул бы её же
    // (и .on бросил бы ошибку) — тогда сразу «занято»
    if (sb.getChannels?.()?.some(c => c.topic === `realtime:${game}-net-${code}`)) { o.onError?.('busy'); return null; }
    const ch = sb.channel(`${game}-net-${code}`, { config: { broadcast: { self: false }, presence: { key } } });
    const pairs = new Map(), rq = new Map(), st = { relayMsgs: 0, relayBytes: 0, sigMsgs: 0, p2pPkts: 0 };
    let H = {}, members = [], synced = false, closed = false, relayAt = -1e9;
    const bcast = payload => {
      if (closed) return;
      try { const r = ch.send({ type: 'broadcast', event: 'n', payload }); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    };
    const tOf = id => { const m = members.find(x => x.id === id); return m ? m.t : +String(id).split('~').pop() || 0; };
    const deliver = (from, u8) => { if (!closed && members.some(m => m.id === from)) { try { H.message && H.message(from, u8); } catch (e) { console.error(e); } } };
    // Пара с одним игроком: старший (раньше вошёл) предлагает WebRTC, сигналы — через комнату адресно
    function pair(id){
      if (closed || !NP || id === myId) return null;
      let p = pairs.get(id);
      if (p) return p;
      const older = tOf(myId) < tOf(id) || (tOf(myId) === tOf(id) && myId < id);
      const proom = { isHost: older, send: m => { st.sigMsgs++; bcast({ type: 'ns', by: myId, to: id, m }); } };
      p = { id, older, np: null };
      p.np = NP.start(proom, { onMessage(){}, onBinary: buf => deliver(id, new Uint8Array(buf)), onMode: m => { try { o.onMode && o.onMode(id, m); } catch (e) {} } });
      pairs.set(id, p);
      if (older) p.np.offer();
      return p;
    }
    const T = { myId, game, code };
    T.mode = id => { const p = pairs.get(id); return p ? p.np.mode() : 'relay'; };
    T.limits = id => ({ mode: T.mode(id) === 'p2p' ? 'p2p' : 'relay' });
    T.send = (to, u8) => {
      if (closed) return;
      const p = pair(to);
      if (p && p.np.mode() === 'p2p') { st.p2pPkts++; p.np.sendBin(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); return; }
      let q = rq.get(to); if (!q) rq.set(to, q = []);
      if (q.length < 32) q.push(toB64(u8));
    };
    // «Через комнату» — пачкой раз в 200 мс: один broadcast на всех адресатов (больше ~48 КБ — несколькими)
    T.flush = () => {
      if (closed || !rq.size || now() - relayAt < RELAY_MS) return;
      let p = {}, n = 0;
      const out = () => { if (!n) return; st.relayMsgs++; st.relayBytes += n; bcast({ type: 'nr', by: myId, p }); p = {}; n = 0; };
      for (const [id, q] of rq) for (const b of q) { if (n && n + b.length > 48000) out(); (p[id] = p[id] || []).push(b); n += b.length; }
      rq.clear(); relayAt = now();
      out();
    };
    T.listen = h => { H = h || {}; if (synced && H.members) H.members(members.slice()); };
    T.members = () => members.slice();
    T.stats = () => Object.assign({}, st, { pairs: [...pairs.values()].map(p => ({ id: p.id, mode: p.np.mode() })) });
    T.close = () => {
      if (closed) return;
      closed = true;
      if (root.removeEventListener) root.removeEventListener('pagehide', T.close);
      for (const p of pairs.values()) try { p.np.close(); } catch (e) {}
      pairs.clear(); rq.clear();
      try { ch.untrack(); sb.removeChannel(ch); } catch (e) {}
    };
    ch.on('broadcast', { event: 'n' }, ({ payload: m }) => {
      if (closed || !m || typeof m.by !== 'string' || m.by === myId) return;
      if (m.type === 'ns') { if (m.to === myId && members.some(x => x.id === m.by)) { const p = pair(m.by); if (p) p.np.handle(m.m); } return; }
      if (m.type === 'nr' && m.p) {
        const list = m.p[myId];
        if (Array.isArray(list)) for (const b of list.slice(0, 64)) { if (typeof b !== 'string' || b.length > 40000) continue; let u; try { u = fromB64(b); } catch (e) { continue; } deliver(m.by, u); }
      }
    });
    ch.on('presence', { event: 'sync' }, () => {
      if (closed) return;
      const list = Object.entries(ch.presenceState()).map(([k, metas]) => { const mm = newest(metas); return { id: k + '~' + (mm.t || 0), t: +mm.t || 0, nick: String(mm.nick || '').slice(0, 24) }; })
        .sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
      const idx = list.findIndex(x => x.id === myId);
      if (idx === -1) return;   // себя ещё не видно — состав неполный
      if (idx >= max) { T.close(); o.onFull && o.onFull(); return; }
      members = list.slice(0, max);
      for (const [id, p] of pairs) if (!members.some(x => x.id === id)) { try { p.np.close(); } catch (e) {} pairs.delete(id); rq.delete(id); }
      synced = true;
      if (H.members) H.members(members.slice());
    });
    ch.subscribe(async s => {
      if (closed) return;
      if (s === 'SUBSCRIBED') { try { await ch.track({ nick: String(o.nick || '').slice(0, 24), t: joinedAt }); } catch (e) {} }
      else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') o.onError && o.onError(s);
    });
    if (root.addEventListener) root.addEventListener('pagehide', T.close);
    return T;
  };

  // ── Для игр на двоих: GameRoom (room.js) + NetPlay уже есть ──
  E.net.duel = function (room, np){
    let H = {}, members = [];
    const T = { myId: room.myId };
    T.peer = () => {
      members = [{ id: room.myId, t: room.joinedAt }];
      if (room.opp) members.push({ id: room.opp.id, t: +String(room.opp.id).split('~').pop() || 0 });
      if (H.members) H.members(members.slice());
    };
    T.binary = buf => { if (room.opp) try { H.message && H.message(room.opp.id, new Uint8Array(buf)); } catch (e) { console.error(e); } };
    T.send = (to, u8) => { if (room.opp && to === room.opp.id) np.sendBin(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); };
    T.limits = () => ({ mode: np.mode() === 'p2p' ? 'p2p' : 'relay' });
    T.mode = () => np.mode();
    T.listen = h => { H = h || {}; if (members.length && H.members) H.members(members.slice()); };
    T.members = () => members.slice();
    T.flush = () => {};
    T.close = () => {};
    return T;
  };
})();

// Подменная сеть для тестов io-игр («Клеточки», «Червячки»): часы, шина Supabase (presence + broadcast, счёт сообщений по каналам)
// и WebRTC (NetPlay: offer → answer → «напрямую»; можно запретить прямую связь — тогда через канал «-r»).
// Используют scripts/kletochki-test.cjs и scripts/chervyachki-test.cjs.
function makeClock(){
  const C = { t: 100000, q: [], id: 0 };
  C.now = () => C.t;
  C.setT = (f, ms) => { const id = ++C.id; C.q.push({ id, at: C.t + Math.max(0, +ms || 0), f }); return id; };
  C.clearT = id => { if (id) C.q = C.q.filter(x => x.id !== id); };
  // выполнить всё, что пора, до момента end (по порядку)
  C.run = async end => {
    for (;;) {
      await flush();
      C.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const x = C.q[0];
      if (!x || x.at > end) break;
      C.q.shift(); C.t = Math.max(C.t, x.at);
      try { x.f(); } catch (e) { C.errors = (C.errors || 0) + 1; console.log('timer error', e && e.stack); }
    }
    C.t = Math.max(C.t, end);
    await flush();
  };
  return C;
}
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };

function makeBus(clock){
  const B = { ch: new Map(), sent: 0, byName: new Map(), drop: null, lat: 25 };
  B.open = (name, key, opts) => {
    let c = B.ch.get(name);
    if (!c) B.ch.set(name, c = { members: new Set(), pres: new Map() });
    const T = { onStatus: null, onSync: null, onMsg: null, key, closed: false };
    c.members.add(T);
    const syncAll = () => {
      const st = {};
      for (const [k, metas] of c.pres) st[k] = metas.map(m => ({ nick: m.nick, t: m.t }));
      for (const m of c.members) if (opts?.presence || m.presence) clock.setT(() => { if (!m.closed) m.onSync?.(st); }, B.lat);
    };
    T.presence = !!opts?.presence;
    T.track = async meta => { c.pres.set(key, [...(c.pres.get(key) || []).filter(x => x._t !== T), { ...meta, _t: T }]); syncAll(); };
    T.send = payload => {
      if (T.closed) return;
      B.sent++; B.byName.set(name, (B.byName.get(name) || 0) + 1);
      const p = JSON.parse(JSON.stringify(payload));
      for (const m of c.members) if (m !== T) { if (B.drop && B.drop(p, m, name)) continue; clock.setT(() => { if (!m.closed) m.onMsg?.(p); }, B.lat); }
    };
    T.close = () => {
      T.closed = true;
      c.members.delete(T);
      if (opts?.presence) { const l = (c.pres.get(key) || []).filter(x => x._t !== T); if (l.length) c.pres.set(key, l); else c.pres.delete(key); syncAll(); }
    };
    clock.setT(() => { if (!T.closed) T.onStatus?.('SUBSCRIBED'); }, B.lat);
    return T;
  };
  return B;
}

// NetPlay-заглушка: хозяин offer() → гость «отвечает» → обе стороны 'p2p'; net.p2p = false — прямой связи нет (через 10 с 'relay')
function makeNet(clock){
  const N = { p2p: true, offers: new Map(), n: 0, bytes: 0, msgs: 0 };
  N.start = (vroom, hooks) => {
    const E = { mode: 'connecting', peer: null, closed: false, hooks, sid: '' };
    const setMode = m => { if (E.mode !== m && !E.closed) { E.mode = m; hooks.onMode?.(m); } };
    clock.setT(() => { if (E.mode !== 'p2p') setMode('relay'); }, 10000);
    return {
      mode: () => E.mode,
      send(m, fast){ if (E.mode !== 'p2p' || !E.peer) return; const P = E.peer, s = JSON.stringify(m); N.msgs++; N.bytes += s.length; clock.setT(() => { if (!P.closed) P.hooks.onMessage(JSON.parse(s)); }, 15); },
      sendBin(b){ if (E.mode !== 'p2p' || !E.peer) return; const copy = ArrayBuffer.isView(b) ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b.slice(0); N.msgs++; N.bytes += copy.byteLength; const P = E.peer; clock.setT(() => { if (!P.closed) P.hooks.onBinary(copy); }, 15); },
      handle(m){
        if (!m || typeof m.type !== 'string' || m.type.slice(0, 3) !== 'np-') return false;
        if (m.type === 'np-offer' && !vroom.isHost) { const H = N.offers.get(m.sid); if (H && N.p2p && !H.closed) { E.peer = H; H.peer = E; vroom.send({ type: 'np-answer', sid: m.sid }); setMode('p2p'); } }
        else if (m.type === 'np-answer' && vroom.isHost && m.sid === E.sid && E.peer) { clock.setT(() => { if (!E.closed) { E.mode = 'p2p'; hooks.onMode?.('p2p'); } }, 1); }
        return true;
      },
      offer(){ E.sid = 'S' + (++N.n); N.offers.set(E.sid, E); vroom.send({ type: 'np-offer', sid: E.sid }); },
      close(){ E.closed = true; E.mode = 'relay'; },
    };
  };
  return N;
}
module.exports = { makeClock, makeBus, makeNet, flush };

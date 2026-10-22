// Подменный Supabase Realtime для проверок T-045 (scripts/rt-test.cjs, rt-load.cjs): протокол Phoenix vsn 1.0.0 (JSON-объекты) —
// столько, сколько нужно настоящему supabase-js и сторожу сервера (server/rt/src/sbwatch.js): вход в канал, presence (track /
// untrack → presence_state / presence_diff всем, кто в канале), broadcast (self: false), выход, сердцебиение. Как настоящий
// Supabase, «другим» presence_diff приходит с задержкой (opts.diffDelay, у Supabase ~0,8 с). Нужен пакет ws (NODE_PATH).
const http = require('http'), crypto = require('crypto');

function start(opts = {}){
  const WebSocket = opts.WS || require('ws');
  const delay = opts.diffDelay ?? 0;
  const topics = new Map();   // topic → { members: Set<M> }
  const socks = new Set();
  const stats = { joins: 0, leaves: 0, tracks: 0, broadcasts: 0, sockets: 0, frames: 0 };
  let refN = 0;
  const T = name => { let t = topics.get(name); if (!t) topics.set(name, t = { members: new Set() }); return t; };
  const send = (ws, o) => { if (ws.readyState === 1) { stats.frames++; ws.send(JSON.stringify(o)); } };
  const stateOf = t => { const s = {}; for (const m of t.members) if (m.meta) (s[m.key] || (s[m.key] = { metas: [] })).metas.push(Object.assign({ phx_ref: m.ref }, m.meta)); return s; };
  function diff(t, from, joins, leaves){
    for (const m of t.members) {
      if (!m.pres) continue;
      const o = { topic: m.topic, event: 'presence_diff', payload: { joins, leaves }, ref: null };
      if (m === from || !delay) send(m.ws, o); else setTimeout(() => { if (t.members.has(m)) send(m.ws, o); }, delay);
    }
  }
  function leave(m){
    const t = topics.get(m.topic);
    if (!t || !t.members.delete(m)) return;
    stats.leaves++;
    if (m.meta) { const l = {}; l[m.key] = { metas: [Object.assign({ phx_ref: m.ref }, m.meta)] }; m.meta = null; diff(t, null, {}, l); }
    if (!t.members.size) topics.delete(m.topic);
  }
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!String(req.url || '').startsWith('/realtime/v1/websocket')) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      stats.sockets++; socks.add(ws);
      const mine = new Map();   // topic → M
      ws.on('message', data => {
        let m; try { m = JSON.parse(data); } catch (e) { return; }
        const { topic, event, payload, ref } = m || {};
        const reply = (status, response) => send(ws, { topic, event: 'phx_reply', payload: { status, response: response || {} }, ref });
        if (topic === 'phoenix') { reply('ok'); return; }
        if (event === 'phx_join') {
          const old = mine.get(topic); if (old) leave(old);
          const cfg = payload?.config || {};
          const M = { ws, topic, key: cfg.presence?.key || crypto.randomUUID(), pres: !!(cfg.presence?.enabled || cfg.presence?.key), self: !!cfg.broadcast?.self, meta: null, ref: '' };
          mine.set(topic, M); T(topic).members.add(M); stats.joins++;
          reply('ok', { postgres_changes: [] });
          if (M.pres) send(ws, { topic, event: 'presence_state', payload: stateOf(T(topic)), ref: null });
          return;
        }
        const M = mine.get(topic);
        if (event === 'phx_leave') { reply('ok'); if (M) { mine.delete(topic); leave(M); } return; }
        if (!M) { if (ref) reply('error', { reason: 'not joined' }); return; }
        if (event === 'presence') {
          const t = T(topic);
          if (payload?.event === 'track') {
            stats.tracks++;
            const old = M.meta, oldRef = M.ref;
            M.meta = Object.assign({}, payload.payload || {}); M.ref = 'F' + (++refN);
            const j = {}; j[M.key] = { metas: [Object.assign({ phx_ref: M.ref }, oldRef ? { phx_ref_prev: oldRef } : {}, M.meta)] };
            const l = {}; if (old) l[M.key] = { metas: [Object.assign({ phx_ref: oldRef }, old)] };
            reply('ok'); diff(t, M, j, l);
          } else if (payload?.event === 'untrack') {
            const old = M.meta; M.meta = null;
            reply('ok');
            if (old) { const l = {}; l[M.key] = { metas: [Object.assign({ phx_ref: M.ref }, old)] }; diff(t, M, {}, l); }
          } else reply('ok');
          return;
        }
        if (event === 'broadcast') {
          stats.broadcasts++;
          const t = T(topic);
          for (const o of t.members) if (o !== M || o.self) send(o.ws, { topic, event: 'broadcast', payload, ref: null });
          if (ref) reply('ok');
          return;
        }
        if (ref) reply('ok');   // access_token и прочее
      });
      ws.on('close', () => { socks.delete(ws); for (const M of mine.values()) leave(M); mine.clear(); });
      ws.on('error', () => {});
    });
  });
  return new Promise(res => server.listen(opts.port || 0, '127.0.0.1', () => {
    const port = server.address().port;
    res({
      port, url: 'http://127.0.0.1:' + port, ws: 'ws://127.0.0.1:' + port + '/realtime/v1/websocket', stats,
      members: name => { const t = topics.get('realtime:' + name); return t ? [...t.members].map(m => ({ key: m.key, meta: m.meta })) : []; },
      keys: name => { const t = topics.get('realtime:' + name); return t ? [...t.members].filter(m => m.meta).map(m => m.key) : []; },
      topics: () => [...topics.keys()],
      dropAll(){ for (const ws of socks) { try { ws.terminate(); } catch (e) {} } },
      close(){ for (const ws of socks) { try { ws.terminate(); } catch (e) {} } return new Promise(r => server.close(() => r())); },
    });
  }));
}
module.exports = { start };

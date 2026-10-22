'use strict';
// d37 realtime relay — own WebSocket server for the site's game rooms (broadcast + presence like Supabase Realtime), TURN
// credentials for WebRTC, health and metrics. Runs behind Caddy (TLS) on the owner's Oracle VM; see docs/SERVER.md.
//   GET  /health   → { ok, rooms, v, up, conns, load }  (no secrets; ok:false = maintenance / out of memory → the site uses Supabase)
//   GET  /turn     → { iceServers, ttl }                 (time-limited coturn credentials; CORS for the site)
//   GET  /metrics  → counters (Authorization: Bearer ADMIN_TOKEN)
//   WS   /rt       → protocol v1 (docs/SERVER.md «Protocol»)
const http = require('http');
const { WebSocketServer } = require('ws');
const { monitorEventLoopDelay } = require('perf_hooks');
const C = require('./config');
const { Bucket, ipKey, log, setLevel, safeEq } = require('./util');
const { Hub, stats } = require('./hub');
const { Watcher } = require('./sbwatch');
const { Jwt } = require('./jwt');
const { turnCreds } = require('./turn');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
function clientIp(req){
  const peer = req.socket?.remoteAddress || '';
  if (C.TRUST_PROXY && LOOPBACK.has(peer)) {
    const x = req.headers['x-forwarded-for'];
    if (typeof x === 'string' && x) { const last = x.split(',').pop().trim(); if (last) return last; }
  }
  return peer;
}
function reject(socket, code, text){
  try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (e) {}
  try { socket.destroy(); } catch (e) {}
}

function start(){
  setLevel(C.LOG_LEVEL);
  const T0 = Date.now();
  let hub = null;
  const watcher = C.WATCH ? new Watcher({ onForeign: name => hub && hub.onForeign(name) }) : null;
  hub = new Hub({ watcher, jwt: new Jwt() });
  const wss = new WebSocketServer({ noServer: true, maxPayload: C.MAX_MSG, perMessageDeflate: false, clientTracking: false });
  const ips = new Map(), turnB = new Map(), live = new Set();
  Object.assign(stats.drop, { origin: 0, full: 0, ip: 0, ipRate: 0, turnRate: 0 });

  // ── load, memory, rates ──
  const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable();
  let cpu = 0, cpuPrev = process.cpuUsage(), cpuAt = Date.now();
  const rates = { msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0 };
  let ratePrev = { msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0, at: Date.now() };
  const loadT = setInterval(() => {
    const now = Date.now(), u = process.cpuUsage(cpuPrev);
    cpu = Math.round((u.user + u.system) / 10 / Math.max(1, now - cpuAt)) ;   // % of one core
    cpuPrev = process.cpuUsage(); cpuAt = now;
    const dt = Math.max(1, now - ratePrev.at) / 1000;
    for (const k of Object.keys(rates)) rates[k] = Math.round((stats[k] - ratePrev[k]) / dt);
    ratePrev = { msgIn: stats.msgIn, msgOut: stats.msgOut, bytesIn: stats.bytesIn, bytesOut: stats.bytesOut, at: now };
  }, 5000);
  const memT = setInterval(() => {
    const rss = process.memoryUsage().rss / 1048576;
    const soft = rss > C.MEM_SOFT_MB, hard = rss > C.MEM_HARD_MB;
    if (soft !== hub.mem.soft) log(soft ? 'warn' : 'info', soft ? 'memory high: no new sockets and rooms' : 'memory ok', { rssMb: Math.round(rss) });
    hub.mem = { soft, hard, rss: Math.round(rss) };
  }, 2000);
  const pingT = setInterval(() => {
    for (const ws of live) {
      if (!ws.d37alive) { try { ws.terminate(); } catch (e) {} continue; }
      ws.d37alive = false;
      try { ws.ping(); } catch (e) {}
    }
  }, C.PING_MS);
  const sweepT = setInterval(() => {
    const now = Date.now();
    for (const [k, st] of ips) if (!st.n && now - st.at > 120e3) ips.delete(k);
    for (const [k, b] of turnB) if (now - b.t > 3600e3) turnB.delete(k);
  }, 60e3);
  for (const t of [loadT, memT, pingT, sweepT]) t.unref?.();

  const health = () => ({
    ok: !C.MAINTENANCE && !hub.mem.hard && !hub.shuttingDown,
    rooms: watcher ? watcher.ok() : true,
    v: C.VERSION, proto: C.PROTO,
    up: Math.round((Date.now() - T0) / 1000),
    conns: hub.counts().conns,
    load: cpu,
  });
  const metrics = () => {
    const m = process.memoryUsage();
    return {
      v: C.VERSION, up: Math.round((Date.now() - T0) / 1000),
      mem: { rssMb: Math.round(m.rss / 1048576), heapMb: Math.round(m.heapUsed / 1048576), soft: hub.mem.soft, hard: hub.mem.hard },
      cpuPct: cpu,
      loopMs: { p50: +(loop.percentile(50) / 1e6).toFixed(2), p99: +(loop.percentile(99) / 1e6).toFixed(2), max: +(loop.max / 1e6).toFixed(1) },
      counts: hub.counts(), perSec: rates, stats, ipsTracked: ips.size,
      watcher: watcher ? watcher.status() : null,
      maintenance: C.MAINTENANCE,
    };
  };

  function json(res, code, obj, extra){
    const body = JSON.stringify(obj);
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body) }, extra || {}));
    res.end(body);
  }
  function handle(req, res){
    const path = (req.url || '/').split('?')[0];
    const origin = req.headers.origin;
    const cors = origin && C.originOk(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    if (req.method === 'OPTIONS') { res.writeHead(204, Object.assign({ 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '600' }, cors)); res.end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error: 'method' }); return; }
    if (path === '/health') { json(res, 200, health(), cors); return; }
    if (path === '/turn') {
      const ip = ipKey(clientIp(req));
      let b = turnB.get(ip);
      if (!b) { b = new Bucket(C.TURN_BURST, C.TURN_PER_SEC); turnB.set(ip, b); }
      if (!b.take()) { stats.drop.turnRate++; json(res, 429, { error: 'rate' }, cors); return; }
      const t = turnCreds(C);
      if (!t) { json(res, 404, { error: 'off' }, cors); return; }
      stats.turn = (stats.turn || 0) + 1;
      json(res, 200, t, cors);
      return;
    }
    if (path === '/metrics') {
      const a = String(req.headers.authorization || '');
      if (!C.ADMIN_TOKEN || !a.startsWith('Bearer ') || !safeEq(a.slice(7), C.ADMIN_TOKEN)) { json(res, 401, { error: 'auth' }); return; }
      json(res, 200, metrics());
      return;
    }
    if (path === '/') { json(res, 200, { name: 'd37-rt', ok: health().ok }, cors); return; }
    json(res, 404, { error: 'not found' });
  }

  function onUpgrade(req, socket, head){
    socket.on('error', () => {});
    const path = (req.url || '').split('?')[0];
    if (path !== '/rt') return reject(socket, 404, 'Not Found');
    if (C.MAINTENANCE || hub.shuttingDown) return reject(socket, 503, 'Service Unavailable');
    if (!C.originOk(req.headers.origin)) { stats.drop.origin++; return reject(socket, 403, 'Forbidden'); }
    if (hub.conns.size >= C.MAX_CONNS || hub.mem.soft) { stats.drop.full++; return reject(socket, 503, 'Service Unavailable'); }
    const ip = ipKey(clientIp(req));
    let st = ips.get(ip);
    if (!st) { st = { n: 0, b: new Bucket(C.IP_BURST, C.IP_PER_SEC), at: Date.now() }; ips.set(ip, st); }
    st.at = Date.now();
    if (st.n >= C.MAX_PER_IP) { stats.drop.ip++; return reject(socket, 429, 'Too Many Requests'); }
    if (!st.b.take()) { stats.drop.ipRate++; return reject(socket, 429, 'Too Many Requests'); }
    wss.handleUpgrade(req, socket, head, ws => {
      st.n++;
      let counted = true;
      ws.d37alive = true;
      live.add(ws);
      hub.newConn(ws, ip);
      ws.on('message', (d, bin) => hub.message(ws, d, bin));
      ws.on('pong', () => { ws.d37alive = true; });
      ws.on('close', code => { live.delete(ws); if (counted) { counted = false; st.n--; st.at = Date.now(); } hub.closed(ws, code); });
      ws.on('error', () => {});
    });
  }

  const server = http.createServer(handle);
  server.headersTimeout = 10000; server.requestTimeout = 15000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 64;
  server.on('upgrade', onUpgrade);
  server.on('clientError', (e, socket) => { try { socket.destroy(); } catch (er) {} });
  if (watcher) watcher.start();

  let closing = false;
  function close(reason){
    if (closing) return Promise.resolve();
    closing = true;
    hub.shutdown(reason || 'restart');
    for (const t of [loadT, memT, pingT, sweepT]) clearInterval(t);
    loop.disable();
    if (watcher) watcher.close();
    return new Promise(res => {
      server.close(() => res());
      setTimeout(() => { for (const ws of live) { try { ws.terminate(); } catch (e) {} } res(); }, 700).unref?.();
    });
  }
  return new Promise((resolve, rejectP) => {
    server.once('error', rejectP);
    server.listen(C.PORT, C.LISTEN, () => {
      const port = server.address().port;
      log('info', 'd37-rt listening', { port, watch: !!watcher, turn: !!(C.TURN_SECRET && C.TURN_HOST), maintenance: C.MAINTENANCE });
      resolve({ server, hub, watcher, port, close, health, metrics });
    });
  });
}

if (require.main === module) {
  start().then(app => {
    const stop = sig => { log('info', 'stopping', { sig }); app.close('restart').then(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref?.(); };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  }).catch(e => { log('error', 'start failed', { e: String(e && e.message || e) }); process.exit(1); });
  process.on('uncaughtException', e => { log('error', 'uncaught', { e: String(e && e.stack || e).slice(0, 800) }); process.exit(1); });
  process.on('unhandledRejection', e => { log('error', 'unhandled rejection', { e: String(e && e.stack || e).slice(0, 800) }); });
}

module.exports = { start };

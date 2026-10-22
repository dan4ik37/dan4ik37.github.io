'use strict';
// Watcher of Supabase Realtime channels («no split» guarantee). For every room hosted here that uses presence, the server
// joins the room's Supabase channel WITHOUT tracking (invisible, no messages unless somebody is there) and reads its presence:
//  • at room creation (peek): somebody is already on Supabase → the room stays there (the joining tab is told «sb»);
//  • later: somebody appears on Supabase (a tab that can't reach this server, an old tab, ?rt=0) → hub.onForeign → the
//    whole room moves to Supabase. So players of one room never end up split between the two transports.
// Phoenix protocol vsn 1.0.0 (JSON objects), the public publishable key (same as the site), one socket per ≤ 90 channels.
const WebSocket = require('ws');
const C = require('./config');
const { Bucket, log } = require('./util');

const BACKOFF = [1000, 2000, 5000, 10000, 20000, 30000];
const JOIN_CFG = { config: { broadcast: { ack: false, self: false }, presence: { key: '', enabled: true }, postgres_changes: [], private: false } };

class Sock {
  constructor(w, n){ this.w = w; this.n = n; this.ws = null; this.state = 'down'; this.ref = 0; this.topics = new Map(); this.byRef = new Map(); this.hbT = null; this.hbRef = null; this.tries = 0; this.reT = null; this.upAt = 0; this.downAt = Date.now(); }
  url(){
    const base = C.SB_WS || (C.SB_URL.replace(/^http/i, 'ws') + '/realtime/v1/websocket');
    return base + (base.includes('?') ? '&' : '?') + 'apikey=' + encodeURIComponent(C.SB_KEY) + '&vsn=1.0.0';
  }
  connect(){
    if (this.ws || this.w.closed) return;
    this.state = 'connecting';
    let ws;
    try { ws = new WebSocket(this.url(), { perMessageDeflate: false, handshakeTimeout: 10000, maxPayload: 4 * 1024 * 1024 }); }
    catch (e) { this.onDown(); return; }
    this.ws = ws;
    ws.on('open', () => {
      if (this.ws !== ws) return;
      this.state = 'up'; this.upAt = Date.now(); this.tries = 0;
      this.w.stats.connects++;
      this.hbT = setInterval(() => this.heartbeat(), 25000);
      for (const t of this.topics.values()) { t.state = 'new'; this.w.enqueue(t); }
    });
    ws.on('message', data => { if (this.ws === ws) this.onMessage(data); });
    ws.on('close', () => { if (this.ws === ws) this.onDown(); });
    ws.on('error', () => {});
  }
  onDown(){
    const was = this.ws;
    this.ws = null; this.state = 'down'; this.downAt = Date.now();
    clearInterval(this.hbT); this.hbT = null; this.hbRef = null; this.byRef.clear();
    if (was) { try { was.terminate(); } catch (e) {} }
    for (const t of this.topics.values()) { t.state = 'new'; t.joinRef = ''; }
    if (this.w.closed) return;
    this.w.stats.disconnects++;
    clearTimeout(this.reT);
    this.reT = setTimeout(() => { this.reT = null; this.connect(); }, BACKOFF[Math.min(this.tries++, BACKOFF.length - 1)]);
    this.reT.unref?.();
  }
  push(topic, event, payload, joinRef){
    if (this.state !== 'up' || !this.ws) return '';
    const ref = String(++this.ref);
    try { this.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: joinRef || ref })); } catch (e) { return ''; }
    return ref;
  }
  heartbeat(){
    if (this.state !== 'up') return;
    if (this.hbRef) { log('warn', 'supabase watcher: heartbeat timeout', { sock: this.n }); this.onDown(); return; }
    this.hbRef = String(++this.ref);
    try { this.ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.hbRef })); } catch (e) { this.onDown(); }
  }
  join(t){
    const ref = this.push(t.topic, 'phx_join', JOIN_CFG, null);
    if (!ref) return false;
    t.joinRef = ref; t.state = 'joining';
    this.byRef.set(ref, t);
    this.w.stats.joins++;
    return true;
  }
  onMessage(data){
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const { topic, event, payload, ref } = m;
    if (event === 'phx_reply') {
      if (ref && ref === this.hbRef) { this.hbRef = null; return; }
      const t = ref ? this.byRef.get(ref) : null;
      if (!t) return;
      this.byRef.delete(ref);
      if (payload?.status === 'ok') { t.state = 'joined'; return; }
      t.state = 'error'; this.w.stats.joinErrors++;
      t.settle('unknown');
      this.w.retryLater(t);
      return;
    }
    const t = this.topics.get(topic);
    if (!t) return;
    if (event === 'presence_state') {
      t.keys.clear();
      if (payload && typeof payload === 'object') for (const k of Object.keys(payload)) { const metas = payload[k]?.metas; if (Array.isArray(metas) && metas.length) t.keys.set(k, new Set(metas.map(x => x && x.phx_ref))); }
      t.known = true;
      this.w.changed(t);
    } else if (event === 'presence_diff') {
      const j = payload?.joins || {}, l = payload?.leaves || {};
      for (const k of Object.keys(j)) { const metas = j[k]?.metas; if (!Array.isArray(metas)) continue; const s = t.keys.get(k) || new Set(); for (const x of metas) s.add(x && x.phx_ref); t.keys.set(k, s); }
      for (const k of Object.keys(l)) { const metas = l[k]?.metas, s = t.keys.get(k); if (!s || !Array.isArray(metas)) continue; for (const x of metas) s.delete(x && x.phx_ref); if (!s.size) t.keys.delete(k); }
      this.w.changed(t);
    } else if (event === 'phx_close' || event === 'phx_error') {
      t.state = 'error';
      this.w.retryLater(t);
    }
  }
}

class Topic {
  constructor(name, sock){ this.name = name; this.topic = 'realtime:' + name; this.sock = sock; this.state = 'new'; this.joinRef = ''; this.keys = new Map(); this.known = false; this.waiters = []; this.retryT = null; this.gone = false; }
  settle(res){ const w = this.waiters; this.waiters = []; for (const f of w) f(res); }
}

class Watcher {
  constructor({ onForeign } = {}){
    this.onForeign = onForeign || (() => {});
    this.socks = []; this.where = new Map(); this.queue = []; this.qT = null; this.closed = false;
    this.joinB = new Bucket(C.WATCH_JOINS_PER_SEC, C.WATCH_JOINS_PER_SEC);
    this.stats = { connects: 0, disconnects: 0, joins: 0, joinErrors: 0, peeks: 0, foreign: 0, unwatched: 0 };
  }
  start(){ if (!this.socks.length) this.addSock(); }
  addSock(){ const s = new Sock(this, this.socks.length); this.socks.push(s); s.connect(); return s; }
  pick(){
    for (const s of this.socks) if (s.topics.size < C.WATCH_PER_SOCKET) return s;
    if (this.socks.length < C.WATCH_SOCKETS) return this.addSock();
    return null;
  }
  // → Promise<'empty' | 'foreign' | 'unknown'> (not later than PEEK_MS); watching goes on until unwatch()
  watch(name){
    this.stats.peeks++;
    let t = this.where.get(name);
    if (!t) {
      const sock = this.pick();
      if (!sock) { this.stats.unwatched++; return Promise.resolve('unknown'); }
      t = new Topic(name, sock);
      this.where.set(name, t); sock.topics.set(t.topic, t);
      this.enqueue(t);
    } else if (t.known && (t.state === 'joined' || t.state === 'joining')) return Promise.resolve(t.keys.size ? 'foreign' : 'empty');
    return new Promise(res => {
      t.waiters.push(res);
      const tm = setTimeout(() => res('unknown'), C.PEEK_MS); tm.unref?.();
    });
  }
  unwatch(name){
    const t = this.where.get(name);
    if (!t) return;
    t.gone = true; clearTimeout(t.retryT);
    this.where.delete(name); t.sock.topics.delete(t.topic);
    if (t.state === 'joined' || t.state === 'joining') t.sock.push(t.topic, 'phx_leave', {}, t.joinRef);
    if (t.joinRef) t.sock.byRef.delete(t.joinRef);
    t.settle('unknown');
  }
  enqueue(t){ if (!this.queue.includes(t)) this.queue.push(t); this.pump(); }
  pump(){
    if (this.qT) return;
    while (this.queue.length) {
      const t = this.queue[0];
      if (t.gone || t.state === 'joined' || t.state === 'joining') { this.queue.shift(); continue; }
      if (t.sock.state !== 'up') { this.queue.shift(); continue; }   // re-queued on the socket's open
      if (!this.joinB.take()) break;
      this.queue.shift();
      t.known = false;
      t.sock.join(t);
    }
    if (this.queue.length) { this.qT = setTimeout(() => { this.qT = null; this.pump(); }, 60); this.qT.unref?.(); }
  }
  retryLater(t){
    if (t.gone) return;
    clearTimeout(t.retryT);
    t.retryT = setTimeout(() => { t.retryT = null; if (!t.gone && t.state === 'error') { t.state = 'new'; this.enqueue(t); } }, 5000);
    t.retryT.unref?.();
  }
  changed(t){
    if (t.gone) return;
    const foreign = t.keys.size > 0;
    t.settle(foreign ? 'foreign' : 'empty');
    if (foreign) { this.stats.foreign++; try { this.onForeign(t.name); } catch (e) { log('error', 'onForeign', { e: String(e).slice(0, 200) }); } }
  }
  // Healthy = the first socket is connected, or dropped less than 30 s ago (a short blip doesn't stop new rooms)
  ok(){ const s = this.socks[0]; if (!s) return false; return s.state === 'up' || (s.upAt > 0 && Date.now() - s.downAt < 30000); }
  status(){ return { sockets: this.socks.length, up: this.socks.filter(s => s.state === 'up').length, topics: this.where.size, queue: this.queue.length, ...this.stats }; }
  close(){ this.closed = true; clearTimeout(this.qT); for (const s of this.socks) { clearTimeout(s.reT); clearInterval(s.hbT); if (s.ws) { try { s.ws.terminate(); } catch (e) {} } s.ws = null; } }
}

module.exports = { Watcher };

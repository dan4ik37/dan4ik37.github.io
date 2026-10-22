'use strict';
// Rooms, members, presence and broadcast fan-out. One WebSocket per browser tab carries many channels («rooms»).
// Shapes of presence (state / diff with metas + phx_ref) are the ones Supabase Realtime (Phoenix) sends — the browser client
// (js/core/rt.js) feeds them through the same algorithm supabase-js uses, so presenceState() looks exactly the same to games.
// No-split rule: a room that has members on the Supabase side is never hosted here — see sbwatch.js and docs/SERVER.md.
const C = require('./config');
const { Bucket, log, newRef, uuid, rid } = require('./util');

const NAME_RE = /^[A-Za-z0-9_.:~-]{1,160}$/;
const EVENT_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9_.:~@+=-]{1,128}$/;
const TEXT = { binary: false };
const nullObj = () => Object.create(null);
const keyOk = k => KEY_RE.test(k) && !(k in Object.prototype);

const stats = {
  connsTotal: 0, resumes: 0, resumeMiss: 0, joins: 0, joinsSb: 0, leaves: 0, moves: 0, movedMembers: 0,
  msgIn: 0, msgOut: 0, bytesIn: 0, bytesOut: 0, presenceDiffs: 0, tracks: 0, auths: 0, authFail: 0, dupes: 0,
  malformed: 0, internal: 0, kicked: 0, zombieOverflow: 0, probes: 0,
  drop: { rate: 0, egress: 0, track: 0, nochan: 0, slow: 0, slowKill: 0, zombie: 0 },
};

// Probe payload (incompressible text, permessage-deflate is off anyway): one random string per process
const PROBE = require('crypto').randomBytes(Math.ceil(Math.max(1, C.PROBE_MAX) * 3 / 4) + 4).toString('base64url');

class Conn {
  constructor(hub, ws, ipKey){
    this.hub = hub; this.ws = ws; this.ipKey = ipKey; this.id = ++hub.connN;
    this.sid = ''; this.hello = false; this.helloT = null;
    this.uid = ''; this.uidExp = 0;
    this.byI = new Map(); this.byRoom = new Map();
    this.msgB = new Bucket(C.MSG_BURST, C.MSG_PER_SEC);
    this.byteB = new Bucket(C.BYTE_BURST, C.BYTE_PER_SEC);
    this.egressB = new Bucket(C.EGRESS_BURST, C.EGRESS_PER_SEC);
    this.authB = new Bucket(C.AUTH_BURST, C.AUTH_PER_SEC);
    this.drops = 0; this.dropsAt = 0; this.bad = 0; this.noResume = false;
    this.inSeq = 0;   // highest numbered message (q) processed — after a resume the tab re-sends only what we didn't get
    this.zombie = false; this.zq = null; this.zqBytes = 0; this.zTimer = null;
    this.corked = null;
  }
  out(buf){
    const hub = this.hub;
    if (this.zombie) {
      if (this.zq && this.zq.length < C.ZOMBIE_FRAMES && this.zqBytes + buf.length <= C.ZOMBIE_BYTES && hub.zBytes + buf.length <= C.ZOMBIE_TOTAL && !hub.mem.soft) {
        this.zq.push(buf); this.zqBytes += buf.length; hub.zBytes += buf.length; return;
      }
      stats.drop.zombie++;
      if (this.zq) {   // too much missed — the session can't be resumed reliably; the tab rejoins fresh (dropped after this fan-out)
        stats.zombieOverflow++; hub.zBytes -= this.zqBytes; this.zq = null; this.zqBytes = 0; this.noResume = true;
        setImmediate(() => hub.dropConn(this));
      }
      return;
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const b = ws.bufferedAmount;
    // slow reader: stop sending above SLOW_DROP (32 KB when the process is short of memory), disconnect above SLOW_KILL
    // (or above 64 KB at the hard memory mark) — so buffered output stays bounded however many readers stall
    if (b > C.SLOW_KILL || (hub.mem.hard && b > 65536)) { stats.drop.slowKill++; this.noResume = true; try { ws.terminate(); } catch (e) {} return; }
    if (b > (hub.mem.soft ? 32768 : C.SLOW_DROP)) { stats.drop.slow++; return; }
    stats.msgOut++; stats.bytesOut += buf.length;
    // all frames for this socket in this turn of the event loop leave in ONE write (one syscall instead of one per message;
    // the profile showed ~45 % of the time in writev without it). ws corks/uncorks per frame inside — counted, so nested.
    if (!this.corked) { const s = ws._socket; if (s && typeof s.cork === 'function') { s.cork(); this.corked = s; this.hub.cork(this); } }
    ws.send(buf, TEXT);
  }
  send(obj){ this.out(Buffer.from(JSON.stringify(obj))); }
}

class Member {
  constructor(conn, room, i, key, self, pres){
    this.conn = conn; this.room = room; this.i = i; this.key = key; this.self = self; this.pres = pres;
    this.meta = null; this.ref = '';
    this.trackB = new Bucket(C.TRACK_BURST, C.TRACK_PER_SEC);
  }
}

class Room {
  constructor(name, no){
    this.name = name; this.no = no; this.members = new Set(); this.presN = 0;
    this.watch = 'none';   // none → peek (asking Supabase) → on; 'gone' after delete
    this.pending = null;   // joins waiting for the peek
    this.gcT = null; this.at = Date.now();
  }
}

const metaOut = (meta, ref, prev) => { const o = { phx_ref: ref }; if (prev) o.phx_ref_prev = prev; for (const k in meta) o[k] = meta[k]; return o; };

class Hub {
  constructor({ watcher = null, jwt = null, audit = null } = {}){
    this.rooms = new Map(); this.roomN = 0; this.connN = 0;
    this.conns = new Set(); this.sids = new Map(); this.moved = new Map();
    this.watcher = watcher; this.jwt = jwt; this.audit = audit;   // audit — журнал для античита (audit.js; null — выключен)
    this.mem = { soft: false, hard: false, rss: 0 };
    this.shuttingDown = false;
    this.stats = stats;
    this.errLogAt = 0;
    this.corkedList = []; this.flushing = false;
    this.zBytes = 0;   // bytes buffered for all disconnected sessions together (ZOMBIE_TOTAL)
    this.flush = () => {
      this.flushing = false;
      const list = this.corkedList; this.corkedList = [];
      for (const c of list) { const s = c.corked; c.corked = null; try { s.uncork(); } catch (e) {} }
    };
    this.sweepT = setInterval(() => this.sweep(), 60e3); this.sweepT.unref?.();
  }

  cork(conn){
    this.corkedList.push(conn);
    if (!this.flushing) { this.flushing = true; setImmediate(this.flush); }
  }

  // ═══ Connections ═══
  newConn(ws, ipKey){
    const conn = new Conn(this, ws, ipKey);
    ws.d37 = conn;
    this.conns.add(conn);
    stats.connsTotal++;
    conn.helloT = setTimeout(() => { if (!conn.hello && conn.ws === ws) this.kick(conn, 4001, 'hello'); }, C.HELLO_MS);
    return conn;
  }
  // The socket closed. Members stay for GRACE_MS: the tab reconnects with its sid and gets everything it missed.
  // A clean close by the tab (1000 — left on purpose, 1001 — page closed) is final at once.
  closed(ws, code){
    const conn = ws.d37; ws.d37 = null;
    if (!conn || conn.ws !== ws) return;
    conn.ws = null;
    clearTimeout(conn.helloT);
    if (conn.byI.size && conn.sid && !conn.noResume && C.GRACE_MS > 0 && !this.shuttingDown && code !== 1000 && code !== 1001) {
      conn.zombie = true; conn.zq = []; conn.zqBytes = 0;
      conn.zTimer = setTimeout(() => this.dropConn(conn), C.GRACE_MS);
    } else this.dropConn(conn);
  }
  dropConn(conn){
    if (!this.conns.has(conn)) return;
    clearTimeout(conn.zTimer); clearTimeout(conn.helloT);
    if (conn.zq) this.zBytes -= conn.zqBytes;
    conn.zTimer = null; conn.zombie = false; conn.zq = null; conn.zqBytes = 0;
    if (conn.sid && this.sids.get(conn.sid) === conn) this.sids.delete(conn.sid);
    this.conns.delete(conn);
    for (const m of [...conn.byI.values()]) this.removeMember(m, true);
    conn.byI.clear(); conn.byRoom.clear();
    if (conn.ws) { const ws = conn.ws; conn.ws = null; ws.d37 = null; try { ws.terminate(); } catch (e) {} }
  }
  kick(conn, code, reason){
    stats.kicked++;
    if (this.audit) for (const mem of conn.byI.values()) this.audit.rec(mem.room, { ev: 'kick', m: this.audit.hash(mem.key), why: reason });
    conn.noResume = true;
    const ws = conn.ws;
    if (ws) { try { ws.send(JSON.stringify({ t: 'bye', e: reason }), TEXT); ws.close(code, reason); } catch (e) { try { ws.terminate(); } catch (e2) {} } }
    else this.dropConn(conn);
  }

  // ═══ Incoming ═══
  message(ws, data, isBinary){
    const conn = ws.d37;
    if (!conn || conn.ws !== ws) return;
    const len = data.length, now = Date.now();
    stats.msgIn++; stats.bytesIn += len;
    if (isBinary) return this.bad(conn, 'binary');
    if (!conn.msgB.take(1, now) || !conn.byteB.take(len, now)) return this.drop(conn, 'rate', now);
    let m;
    try { m = JSON.parse(data); } catch (e) { return this.bad(conn, 'json'); }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return this.bad(conn, 'shape');
    if (!conn.hello && m.t !== 'hi') return this.bad(conn, 'nohello');
    if (m.q !== undefined) {
      if (!Number.isInteger(m.q) || m.q < 1) return this.bad(conn, 'seq');
      if (m.q <= conn.inSeq) { stats.dupes++; return; }   // re-sent after a resume, already done
      conn.inSeq = m.q;
    }
    try {
      switch (m.t) {
        case 'b': return this.onBroadcast(conn, m);
        case 'tr': return this.onTrack(conn, m);
        case 'ping': return conn.out(Buffer.from('{"t":"pong","n":' + (Number.isFinite(m.n) ? Math.floor(m.n) : 0) + ',"q":' + conn.inSeq + '}'));
        case 'j': return this.onJoin(conn, m);
        case 'l': return this.onLeave(conn, m);
        case 'ut': return this.onUntrack(conn, m);
        case 'hi': return this.onHi(conn, m);
        case 'auth': return this.onAuth(conn, m);
        default: return this.bad(conn, 'type');
      }
    } catch (e) {
      stats.internal++;
      if (now - this.errLogAt > 6000) { this.errLogAt = now; log('error', 'handler', { t: String(m.t).slice(0, 8), n: stats.internal, e: String(e && e.stack || e).slice(0, 400) }); }
    }
  }
  bad(conn, why){
    stats.malformed++;
    if (++conn.bad > 50) this.kick(conn, 4009, 'bad');
  }
  drop(conn, why, now){
    stats.drop[why] = (stats.drop[why] || 0) + 1;
    if (now - conn.dropsAt > 10e3) { conn.dropsAt = now; conn.drops = 0; }
    if (++conn.drops > C.ABUSE_DROPS) this.kick(conn, 4008, 'rate');
  }

  onHi(conn, m){
    if (conn.hello) return this.bad(conn, 'hi2');
    conn.hello = true; clearTimeout(conn.helloT); conn.helloT = null;
    let c = conn, resumed = false;
    const old = typeof m.sid === 'string' && m.sid.length >= 16 && m.sid.length <= 64 ? this.sids.get(m.sid) : null;
    if (old && old !== conn && !old.noResume && this.conns.has(old)) {
      // takeover: the old Conn (with its rooms and presence) gets the new socket; the empty new Conn is dropped
      const ws = conn.ws;
      if (old.ws && old.ws !== ws) { const ow = old.ws; old.ws = null; ow.d37 = null; try { ow.terminate(); } catch (e) {} }
      old.ws = ws; ws.d37 = old; old.ipKey = conn.ipKey;
      old.zombie = false; clearTimeout(old.zTimer); old.zTimer = null;
      this.conns.delete(conn);
      c = old; resumed = true; stats.resumes++;
    } else {
      if (m.sid) stats.resumeMiss++;
      conn.sid = rid(18); this.sids.set(conn.sid, conn);
    }
    c.send({ t: 'hi', sid: c.sid, resumed, q: c.inSeq, v: C.PROTO, grace: C.GRACE_MS });
    const pb = Math.min(C.PROBE_MAX, Math.max(0, Math.floor(+m.pb || 0)));
    if (pb > 0) { stats.probes++; c.out(Buffer.from('{"t":"pr","d":"' + PROBE.slice(0, pb) + '"}')); }
    if (resumed) {
      const q = c.zq || []; c.zq = null; this.zBytes -= c.zqBytes; c.zqBytes = 0;
      for (const b of q) c.out(b);
    }
  }

  async onAuth(conn, m){
    const reply = o => conn.send(Object.assign({ t: 'auth' }, o));
    if (!this.jwt) return reply({ ok: false, e: 'off' });
    if (!conn.authB.take()) return reply({ ok: false, e: 'rate' });
    if (m.jwt == null || m.jwt === '') { conn.uid = ''; conn.uidExp = 0; return reply({ ok: true, guest: true }); }
    if (typeof m.jwt !== 'string' || m.jwt.length > 8192) return reply({ ok: false, e: 'bad' });
    stats.auths++;
    let res = null;
    try { res = await this.jwt.verify(m.jwt); } catch (e) { res = null; }
    if (!this.conns.has(conn)) return;
    if (!res) { stats.authFail++; conn.uid = ''; conn.uidExp = 0; return reply({ ok: false, e: 'invalid' }); }
    conn.uid = res.uid; conn.uidExp = res.exp * 1000;
    reply({ ok: true });
    // presences of this tab with key = its account id become «verified» (_v: 1)
    for (const mem of conn.byI.values()) if (mem.meta && mem.key === conn.uid && !mem.meta._v) this.setMeta(mem, mem.meta);
  }

  onJoin(conn, m){
    const i = m.i;
    if (!Number.isInteger(i) || i < 1 || i > 1e9) return this.bad(conn, 'join');
    const reply = o => conn.send(Object.assign({ t: 'j', i }, o));
    const name = m.c;
    if (typeof name !== 'string' || !NAME_RE.test(name)) return reply({ e: 'name' });
    if (conn.byI.has(i) || conn.byRoom.has(name)) return reply({ e: 'dup' });
    if (conn.byI.size >= C.MAX_CHANNELS) return reply({ e: 'limit' });
    let key = m.k;
    if (key == null || key === '') key = '';
    else if (typeof key !== 'string' || !keyOk(key)) return reply({ e: 'key' });
    const req = { conn, i, key, self: !!m.s, pres: !!m.p, audit: Array.isArray(m.a) ? m.a : null };
    if (this.sbHome(name)) { stats.joinsSb++; return reply({ home: 'sb' }); }
    let room = this.rooms.get(name);
    if (!room) {
      if (this.rooms.size >= C.MAX_ROOMS || this.mem.soft) { stats.joinsSb++; return reply({ home: 'sb', e: 'busy' }); }
      room = new Room(name, ++this.roomN);
      this.rooms.set(name, room);
    }
    if (room.pending) { if (room.pending.length >= 500) return reply({ e: 'busy' }); room.pending.push(req); return; }
    if (req.pres && room.watch === 'none' && this.watcher) { room.pending = [req]; this.startWatch(room); return; }
    this.admit(room, req);
  }
  admit(room, req){
    const { conn, i } = req;
    if (!this.conns.has(conn) || conn.byI.has(i) || conn.byRoom.has(room.name)) return;
    const reply = o => conn.send(Object.assign({ t: 'j', i }, o));
    if (this.rooms.get(room.name) !== room) { stats.joinsSb++; return reply({ home: 'sb' }); }   // moved meanwhile
    if (room.members.size >= C.MAX_ROOM_SUBS) return reply({ e: 'full' });
    const key = req.key || uuid();
    const mem = new Member(conn, room, i, key, req.self, req.pres);
    room.members.add(mem); conn.byI.set(i, mem); conn.byRoom.set(room.name, mem);
    if (room.gcT) { clearTimeout(room.gcT); room.gcT = null; }
    stats.joins++;
    const A = this.audit;
    if (A) { A.declare(room, req.audit); A.rec(room, { ev: 'join', m: A.hash(key), c: A.hash(conn.sid), u: conn.uid ? A.hash(conn.uid) : undefined, pr: req.pres ? 1 : 0 }); }
    reply({ r: room.no, home: 'rt', k: key });
    if (req.pres) conn.send({ t: 'ps', r: room.no, s: this.presenceState(room) });
  }
  // First member with presence: ask Supabase (one channel join on the watcher's socket) whether somebody is already there
  startWatch(room){
    room.watch = 'peek';
    const done = res => {
      if (room.watch !== 'peek') return;
      room.watch = 'on';
      const pend = room.pending || []; room.pending = null;
      if (res === 'foreign') { this.moveRoom(room, pend); return; }
      for (const r of pend) this.admit(room, r);
      if (!room.members.size) this.roomEmpty(room);
    };
    let p;
    try { p = this.watcher.watch(room.name); } catch (e) { p = Promise.resolve('unknown'); }
    Promise.resolve(p).then(done, () => done('unknown'));
  }
  // Supabase side of a watched room has people (a tab that can't reach us, an old tab, ?rt=0): the whole room — and its
  // «-…» siblings (e.g. the io-games relay «<room>-r») — moves to Supabase. Tabs remember it; new joins are told «sb».
  onForeign(name){
    const room = this.rooms.get(name);
    if (!room || room.watch !== 'on') return;
    this.moveRoom(room, null);
  }
  moveRoom(room, pending){
    const now = Date.now();
    this.moved.set(room.name, now + C.MOVED_TTL_MS);
    const list = [room];
    const pre = room.name + '-';
    for (const r of this.rooms.values()) if (r !== room && r.name.startsWith(pre)) list.push(r);
    for (const r of list) {
      stats.moves++;
      const frame = Buffer.from('{"t":"mv","r":' + r.no + '}');
      if (this.audit) this.audit.rec(r, { ev: 'mv', n: r.members.size });
      for (const mem of [...r.members]) { stats.movedMembers++; mem.conn.out(frame); this.removeMember(mem, false, 'move'); }
      const pend = r === room ? pending : r.pending;
      if (pend) for (const q of pend) if (this.conns.has(q.conn)) { stats.joinsSb++; q.conn.send({ t: 'j', i: q.i, home: 'sb' }); }
      r.pending = null;
      this.deleteRoom(r);
    }
    log('info', 'room moved to supabase', { rooms: list.length });
  }
  sbHome(name){
    if (!this.moved.size) return false;
    const now = Date.now();
    let p = name.length;
    for (;;) {
      const until = this.moved.get(p === name.length ? name : name.slice(0, p));
      if (until && until > now) return true;
      p = name.lastIndexOf('-', p - 1);
      if (p <= 0) return false;
    }
  }

  onLeave(conn, m){
    const mem = conn.byI.get(m.i);
    if (mem) { stats.leaves++; this.removeMember(mem, true, 'leave'); }
  }
  removeMember(mem, diff, why){
    const room = mem.room, conn = mem.conn;
    if (!room.members.delete(mem)) return;
    if (this.audit) this.audit.rec(room, { ev: 'leave', m: this.audit.hash(mem.key), why: why || (diff ? 'gone' : 'move'), sent: mem.sent || 0 });
    if (conn.byI.get(mem.i) === mem) conn.byI.delete(mem.i);
    if (conn.byRoom.get(room.name) === mem) conn.byRoom.delete(room.name);
    if (mem.meta) {
      room.presN--;
      if (diff && room.members.size) { const l = nullObj(); l[mem.key] = { metas: [metaOut(mem.meta, mem.ref)] }; this.presDiff(room, null, l); }
      mem.meta = null;
    }
    if (!room.members.size && !room.pending) this.roomEmpty(room);
  }
  roomEmpty(room){
    if (room.gcT || this.rooms.get(room.name) !== room) return;
    if (C.ROOM_GC_MS <= 0) return this.deleteRoom(room);
    room.gcT = setTimeout(() => { room.gcT = null; if (!room.members.size && !room.pending) this.deleteRoom(room); }, C.ROOM_GC_MS);
    room.gcT.unref?.();
  }
  deleteRoom(room){
    if (this.rooms.get(room.name) !== room) return;
    clearTimeout(room.gcT); room.gcT = null;
    this.rooms.delete(room.name);
    if (room.watch !== 'none' && this.watcher) { try { this.watcher.unwatch(room.name); } catch (e) {} }
    room.watch = 'gone';
  }

  onBroadcast(conn, m){
    const mem = conn.byI.get(m.i);
    if (!mem) { stats.drop.nochan++; return; }
    const e = m.e;
    if (typeof e !== 'string' || !EVENT_RE.test(e)) return this.bad(conn, 'event');
    const room = mem.room;
    if (room.members.size < 2 && !mem.self) return;
    let pj;
    try { pj = m.p === undefined ? 'null' : JSON.stringify(m.p); } catch (er) { return this.bad(conn, 'deep'); }   // absurd nesting
    const frame = Buffer.from('{"t":"b","r":' + room.no + ',"e":"' + e + '","p":' + pj + '}');
    const n = room.members.size - (mem.self ? 0 : 1);
    if (!conn.egressB.take(frame.length * n)) return this.drop(conn, 'egress', Date.now());
    mem.sent = (mem.sent || 0) + 1;
    if (this.audit) this.audit.rec(room, { ev: 'b', m: this.audit.hash(mem.key), e, n: frame.length }, pj);
    for (const o of room.members) if (o !== mem || o.self) o.conn.out(frame);
  }

  onTrack(conn, m){
    const ack = e => { if (m.r != null && Number.isFinite(m.r)) conn.send(e ? { t: 'ok', r: m.r, e } : { t: 'ok', r: m.r }); };
    const mem = conn.byI.get(m.i);
    if (!mem) return ack('nochan');
    if (!mem.trackB.take()) { stats.drop.track++; return ack('rate'); }
    const meta = m.m;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ack('meta');
    let size = 0;
    try { size = JSON.stringify(meta).length; } catch (er) { return ack('meta'); }
    if (size > C.MAX_META) return ack('big');
    if (!mem.meta && mem.room.presN >= C.MAX_ROOM_PRESENCE) return ack('full');
    stats.tracks++;
    this.setMeta(mem, meta);
    ack();
  }
  setMeta(mem, meta){
    const room = mem.room, conn = mem.conn;
    const clean = {};
    for (const k of Object.keys(meta)) if (k !== '_v' && k !== 'phx_ref' && k !== 'phx_ref_prev' && k !== 'presence_ref' && k !== '__proto__') clean[k] = meta[k];
    if (conn.uid && conn.uidExp > Date.now() && mem.key === conn.uid) clean._v = 1;
    const old = mem.meta, oldRef = mem.ref;
    mem.meta = clean; mem.ref = newRef();
    if (!old) room.presN++;
    if (this.audit) this.audit.rec(room, { ev: 'tr', m: this.audit.hash(mem.key), n: JSON.stringify(clean).length, v: clean._v ? 1 : undefined });
    const j = nullObj(); j[mem.key] = { metas: [metaOut(clean, mem.ref, old ? oldRef : null)] };
    let l = null;
    if (old) { l = nullObj(); l[mem.key] = { metas: [metaOut(old, oldRef)] }; }
    this.presDiff(room, j, l);
  }
  onUntrack(conn, m){
    const mem = conn.byI.get(m.i);
    if (mem && mem.meta) {
      const room = mem.room;
      room.presN--;
      const l = nullObj(); l[mem.key] = { metas: [metaOut(mem.meta, mem.ref)] };
      if (this.audit) this.audit.rec(room, { ev: 'ut', m: this.audit.hash(mem.key) });
      mem.meta = null; mem.ref = '';
      this.presDiff(room, null, l);
    }
    if (m.r != null && Number.isFinite(m.r)) conn.send({ t: 'ok', r: m.r });
  }
  presDiff(room, j, l){
    stats.presenceDiffs++;
    const frame = Buffer.from(JSON.stringify({ t: 'pd', r: room.no, j: j || {}, l: l || {} }));
    for (const o of room.members) if (o.pres) o.conn.out(frame);
  }
  presenceState(room){
    const s = nullObj();
    for (const o of room.members) if (o.meta) (s[o.key] || (s[o.key] = { metas: [] })).metas.push(metaOut(o.meta, o.ref));
    return s;
  }

  sweep(){
    const now = Date.now();
    for (const [k, until] of this.moved) if (until <= now) this.moved.delete(k);
  }
  shutdown(reason){
    this.shuttingDown = true;
    clearInterval(this.sweepT);
    const frame = JSON.stringify({ t: 'bye', e: reason || 'restart' });
    for (const conn of this.conns) if (conn.ws) { try { conn.ws.send(frame, TEXT); conn.ws.close(1012, 'restart'); } catch (e) {} }
  }
  counts(){
    let members = 0, presence = 0, zombies = 0, watched = 0;
    for (const r of this.rooms.values()) { members += r.members.size; presence += r.presN; if (r.watch === 'on' || r.watch === 'peek') watched++; }
    for (const c of this.conns) if (c.zombie) zombies++;
    return { conns: this.conns.size - zombies, zombies, zombieKb: Math.round(this.zBytes / 1024), rooms: this.rooms.size, members, presence, watchedRooms: watched, movedNames: this.moved.size };
  }
}

module.exports = { Hub, stats, NAME_RE, EVENT_RE, KEY_RE };

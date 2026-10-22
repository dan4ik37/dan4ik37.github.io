'use strict';
// Anti-cheat feed (hook for T-073): an append-only journal of what happens in rooms, for a SEPARATE checker that reads it
// later — the relay never waits for it. OFF by default (AUDIT empty). Records are compact JSON lines:
//   { q, t, ev, ch, r, m?, u?, e?, n?, p?, why?, cut? }   (docs/SERVER.md «Anti-cheat feed»)
// No personal data: member/connection/account ids are salted hashes (AUDIT_SALT — keep it to correlate across restarts),
// no addresses, presence metas are never written (only their size), payloads only for events marked «auditable»:
// by the server (AUDIT_EVENTS="kletochki-io-*:in,chess-duel-*:m") or by a game in its channel config
// (config: { audit: { events: ['in'] } } — union over the room's members, so a cheater who doesn't declare is still recorded).
// Sinks: 'file' — rotating files in AUDIT_DIR (AUDIT_FILE_MB × AUDIT_FILES); 'http' — NDJSON batches POSTed to AUDIT_URL with
// Authorization: Bearer AUDIT_TOKEN (internal consumer, e.g. 127.0.0.1). Caps: AUDIT_PER_SEC overall, AUDIT_ROOM_PER_SEC per
// room, AUDIT_PAYLOAD bytes per payload (bigger → size only, cut: 1), queue AUDIT_QUEUE; what is dropped is counted and
// reported in { ev: 'stat' } records every 10 s, so the checker knows where the journal has gaps.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Bucket, log } = require('./util');

function makeAudit(C){
  const kind = String(C.AUDIT || '').toLowerCase();
  if (kind !== 'file' && kind !== 'http') return null;
  const salt = C.AUDIT_SALT || crypto.randomBytes(16).toString('hex');
  const hashCache = new Map();
  const h = s => {
    if (!s) return '';
    let v = hashCache.get(s);
    if (!v) { v = crypto.createHash('sha256').update(salt).update(String(s)).digest('base64url').slice(0, 12); if (hashCache.size > 50000) hashCache.clear(); hashCache.set(s, v); }
    return v;
  };
  const rules = String(C.AUDIT_EVENTS || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.lastIndexOf(':');
    const pat = i > 0 ? x.slice(0, i) : x, evs = i > 0 ? x.slice(i + 1).split('|') : ['*'];
    return { re: new RegExp('^' + pat.replace(/[.+?^${}()[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), evs: new Set(evs) };
  });
  const all = new Bucket(C.AUDIT_PER_SEC * 2, C.AUDIT_PER_SEC);
  const st = { written: 0, dropRate: 0, dropRoom: 0, dropQueue: 0, cut: 0, sinkErrors: 0, files: 0, posts: 0 };
  let q = [], qT = null, seq = 0, closed = false, lastStat = { ...st };

  // ── sinks ──
  let fileFd = null, fileBytes = 0, fileN = 0;
  function fileOpen(){
    try {
      fs.mkdirSync(C.AUDIT_DIR, { recursive: true });
      // rotate: audit.0.ndjson is the newest; keep AUDIT_FILES files
      for (let i = C.AUDIT_FILES - 1; i >= 1; i--) { const a = path.join(C.AUDIT_DIR, `audit.${i - 1}.ndjson`), b = path.join(C.AUDIT_DIR, `audit.${i}.ndjson`); if (fs.existsSync(a)) fs.renameSync(a, b); }
      fileFd = fs.openSync(path.join(C.AUDIT_DIR, 'audit.0.ndjson'), 'a');
      fileBytes = 0; fileN++; st.files++;
    } catch (e) { fileFd = null; st.sinkErrors++; log('warn', 'audit: file sink unavailable', { e: String(e.message || e).slice(0, 120) }); }
  }
  async function flushFile(lines){
    if (fileFd === null || fileBytes > C.AUDIT_FILE_MB * 1048576) { if (fileFd !== null) { try { fs.closeSync(fileFd); } catch (e) {} } fileOpen(); }
    if (fileFd === null) return;
    const buf = Buffer.from(lines);
    await new Promise(res => fs.write(fileFd, buf, 0, buf.length, null, err => { if (err) st.sinkErrors++; else fileBytes += buf.length; res(); }));
  }
  async function flushHttp(lines){
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 3000);
    try {
      const r = await fetch(C.AUDIT_URL, { method: 'POST', body: lines, signal: ac.signal, headers: { 'Content-Type': 'application/x-ndjson', ...(C.AUDIT_TOKEN ? { Authorization: 'Bearer ' + C.AUDIT_TOKEN } : {}) } });
      if (!r.ok) st.sinkErrors++; else st.posts++;
      try { await r.arrayBuffer(); } catch (e) {}
    } catch (e) { st.sinkErrors++; }
    finally { clearTimeout(tm); }
  }
  let busy = false;
  async function flush(){
    qT = null;
    if (busy || !q.length) return;
    busy = true;
    const batch = q; q = [];
    const lines = batch.map(o => JSON.stringify(o)).join('\n') + '\n';
    try { await (kind === 'file' ? flushFile(lines) : flushHttp(lines)); } catch (e) { st.sinkErrors++; }
    busy = false;
    if (q.length && !closed) arm();
  }
  const arm = () => { if (!qT && !closed) { qT = setTimeout(flush, q.length >= 500 ? 0 : 1000); qT.unref?.(); } };
  const statT = setInterval(() => {
    const d = {}; let any = false;
    for (const k of Object.keys(st)) { d[k] = st[k] - (lastStat[k] || 0); if (d[k]) any = true; }
    lastStat = { ...st };
    if (any) push({ ev: 'stat', ...d }, true);
  }, C.AUDIT_STAT_MS);
  statT.unref?.();

  function push(o, force){
    if (closed) return;
    if (!force && !all.take()) { st.dropRate++; return; }
    if (q.length >= C.AUDIT_QUEUE) { st.dropQueue++; return; }
    o.q = ++seq; o.t = Date.now();
    q.push(o); st.written++;
    arm();
  }

  return {
    hash: h,
    // events of a room whose payload is recorded: server rules + what the room's members declared
    roomInit(room){
      room.audB = new Bucket(C.AUDIT_ROOM_PER_SEC * 2, C.AUDIT_ROOM_PER_SEC);
      room.audEv = new Set();
      for (const r of rules) if (r.re.test(room.name)) for (const e of r.evs) room.audEv.add(e);
    },
    declare(room, events){
      if (!room.audB) this.roomInit(room);
      if (!Array.isArray(events)) return;
      for (const e of events.slice(0, 8)) if (typeof e === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(e) && room.audEv.size < 16) room.audEv.add(e);
    },
    rec(room, o, payload){
      if (!room.audB) this.roomInit(room);
      if (!room.audB.take()) { st.dropRoom++; return; }
      o.ch = room.name; o.r = room.no;
      if (payload !== undefined && o.e && (room.audEv.has(o.e) || room.audEv.has('*'))) {
        if (payload.length <= C.AUDIT_PAYLOAD) o.p = payload; else { o.cut = 1; st.cut++; }
      }
      push(o);
    },
    stats: () => ({ kind, ...st, queue: q.length }),
    close(){ closed = true; clearInterval(statT); clearTimeout(qT); const rest = q; q = []; if (rest.length && kind === 'file' && fileFd !== null) { try { fs.writeSync(fileFd, rest.map(o => JSON.stringify(o)).join('\n') + '\n'); } catch (e) {} } if (fileFd !== null) { try { fs.closeSync(fileFd); } catch (e) {} fileFd = null; } },
  };
}

module.exports = { makeAudit };

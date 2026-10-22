'use strict';
const crypto = require('crypto');

// Token bucket: cap — burst, perSec — refill. take(n) → false when empty (nothing is taken then).
class Bucket {
  constructor(cap, perSec) { this.cap = cap; this.rate = perSec / 1000; this.v = cap; this.t = Date.now(); }
  take(n = 1, now = Date.now()) {
    const v = Math.min(this.cap, this.v + (now - this.t) * this.rate);
    this.t = now;
    if (v < n) { this.v = v; return false; }
    this.v = v - n;
    return true;
  }
}

// Client addresses are never logged and never kept as text: a per-process salted hash is the key of per-address counters
const SALT = crypto.randomBytes(16);
const ipKey = ip => crypto.createHash('sha256').update(SALT).update(String(ip || '')).digest('base64url').slice(0, 16);

// JSON lines to stdout (docker keeps a rotated log); no addresses, tokens or message contents
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel = LEVELS.info;
const setLevel = l => { minLevel = LEVELS[l] || LEVELS.info; };
function log(level, msg, extra){
  if ((LEVELS[level] || 20) < minLevel) return;
  const line = { t: new Date().toISOString(), lvl: level, msg };
  if (extra) for (const k of Object.keys(extra)) line[k] = extra[k];
  try { process.stdout.write(JSON.stringify(line) + '\n'); } catch (e) {}
}

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
// presence refs: short, unique per process (like Phoenix phx_ref)
let refN = 0;
const REF_PREFIX = crypto.randomBytes(4).toString('base64url');
const newRef = () => REF_PREFIX + (++refN).toString(36);
const uuid = () => crypto.randomUUID();

// Safe equality for the admin token (constant time, any lengths)
function safeEq(a, b){
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y) && String(a).length === String(b).length;
}

module.exports = { Bucket, ipKey, log, setLevel, rid, newRef, uuid, safeEq };

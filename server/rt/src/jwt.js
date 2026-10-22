'use strict';
// Optional login check: a tab may send its Supabase access token; it is verified with the project's PUBLIC keys
// (JWKS: <SB_URL>/auth/v1/.well-known/jwks.json — ES256 / RS256; no secret is needed or stored). The verified account id
// marks the tab's presence with _v: 1 when the presence key is that account id. Guests stay guests.
const crypto = require('crypto');
const C = require('./config');
const { log } = require('./util');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

class Jwt {
  constructor(o = {}){
    this.url = o.url || C.JWKS_URL || (C.SB_URL + '/auth/v1/.well-known/jwks.json');
    this.iss = o.iss || (C.SB_URL + '/auth/v1');
    this.keys = new Map(); this.fetchedAt = 0; this.loading = null;
    this.fetch = o.fetch || ((u, opt) => fetch(u, opt));
  }
  async load(force){
    const now = Date.now();
    if (this.loading) return this.loading;
    if (!force && now - this.fetchedAt < 10 * 60e3 && this.keys.size) return;
    if (force && now - this.fetchedAt < 30e3) return;   // unknown kid: not more often than every 30 s
    this.loading = (async () => {
      try {
        const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 5000);
        const r = await this.fetch(this.url, { signal: ac.signal, headers: { accept: 'application/json' } });
        clearTimeout(tm);
        if (!r.ok) throw new Error('jwks ' + r.status);
        const j = await r.json();
        const keys = new Map();
        for (const k of Array.isArray(j?.keys) ? j.keys : []) {
          if (!k || typeof k.kid !== 'string' || (k.use && k.use !== 'sig')) continue;
          try { keys.set(k.kid, { alg: k.alg || (k.kty === 'EC' ? 'ES256' : 'RS256'), key: crypto.createPublicKey({ key: k, format: 'jwk' }) }); } catch (e) {}
        }
        this.keys = keys;
      } catch (e) { log('warn', 'jwks load failed', { e: String(e && e.message || e).slice(0, 120) }); }
      finally { this.fetchedAt = Date.now(); this.loading = null; }
    })();
    return this.loading;
  }
  // → { uid, exp } or null
  async verify(token){
    if (typeof token !== 'string' || token.length > 8192) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let h, p;
    try { h = b64json(parts[0]); p = b64json(parts[1]); } catch (e) { return null; }
    if (!h || (h.alg !== 'ES256' && h.alg !== 'RS256') || typeof h.kid !== 'string') return null;
    const now = Date.now() / 1000;
    if (!p || typeof p.exp !== 'number' || p.exp < now - 30) return null;
    if (typeof p.nbf === 'number' && p.nbf > now + 60) return null;
    if (p.iss !== this.iss) return null;
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes('authenticated') || (p.role && p.role !== 'authenticated')) return null;
    if (typeof p.sub !== 'string' || !UUID.test(p.sub)) return null;
    await this.load(false);
    let k = this.keys.get(h.kid);
    if (!k) { await this.load(true); k = this.keys.get(h.kid); }
    if (!k || k.alg !== h.alg) return null;
    const data = Buffer.from(parts[0] + '.' + parts[1]), sig = Buffer.from(parts[2], 'base64url');
    let ok = false;
    try {
      ok = h.alg === 'ES256'
        ? crypto.verify('sha256', data, { key: k.key, dsaEncoding: 'ieee-p1363' }, sig)
        : crypto.verify('RSA-SHA256', data, k.key, sig);
    } catch (e) { ok = false; }
    return ok ? { uid: p.sub.toLowerCase(), exp: p.exp } : null;
  }
}

module.exports = { Jwt };

'use strict';
// Settings of the realtime relay — from the environment (server/.env via docker-compose). Every limit has a safe default;
// secrets (TURN_SECRET, ADMIN_TOKEN) have none and are generated on the server (server/make-env.sh), never committed.
const env = process.env;
const str = (k, d = '') => (typeof env[k] === 'string' && env[k].trim() !== '' ? env[k].trim() : d);
const num = (k, d, lo = -Infinity, hi = Infinity) => {
  const v = Number(str(k, ''));
  return str(k, '') !== '' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};
const bool = (k, d) => { const v = str(k, ''); return v ? /^(1|true|yes|on)$/i.test(v) : d; };

// Site origins allowed to open a socket / read /health and /turn (browsers send Origin; scripts can fake it — limits still apply)
const ORIGINS = ['https://dan4ik37.vercel.app', 'https://dan4ik37.github.io', ...str('ORIGINS_EXTRA').split(',').map(s => s.trim()).filter(Boolean)];
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

const C = {
  VERSION: '1.0.0',
  PROTO: 1,
  LISTEN: str('RT_LISTEN', '127.0.0.1'),          // behind Caddy on the same host: only loopback
  PORT: num('RT_PORT', 8787, 0, 65535),            // 0 — any free port (tests)
  PUBLIC_HOST: str('RT_HOST', ''),                 // public IP (or later a domain) — for TURN urls
  TRUST_PROXY: bool('TRUST_PROXY', true),          // X-Forwarded-For from a loopback peer (Caddy) is the client address
  MAINTENANCE: bool('MAINTENANCE', false),         // /health → ok:false, sockets refused: the site uses Supabase
  ADMIN_TOKEN: str('ADMIN_TOKEN', ''),             // /metrics (empty → /metrics is off)
  LOG_LEVEL: str('LOG_LEVEL', 'info'),
  ORIGINS, LOCAL_ORIGIN,
  ALLOW_LOCAL_ORIGINS: bool('ALLOW_LOCAL_ORIGINS', true),
  ALLOW_NO_ORIGIN: bool('ALLOW_NO_ORIGIN', false),  // tools/tests without Origin (off in production)

  // Supabase — public project values (the same publishable key is in the site's chat.js); used for the room watcher and JWKS
  SB_URL: str('SB_URL', 'https://zdisuowyjgqirhvcyjfq.supabase.co').replace(/\/+$/, ''),
  SB_KEY: str('SB_KEY', 'sb_publishable_55GhvJbDxDQA1JEawZRQ6g_ozx_cgMV'),
  SB_WS: str('SB_WS', ''),                         // tests: ws://127.0.0.1:N (fake Phoenix)
  JWKS_URL: str('JWKS_URL', ''),                   // tests: override of <SB_URL>/auth/v1/.well-known/jwks.json
  WATCH: bool('WATCH', true),                      // watch Supabase channels of our rooms (no-split guarantee)
  WATCH_SOCKETS: num('WATCH_SOCKETS', 8, 1, 50),   // each Supabase socket = 1 of 200 Free connections
  WATCH_PER_SOCKET: num('WATCH_PER_SOCKET', 90, 1, 100),  // Supabase Free: 100 channels per connection
  WATCH_JOINS_PER_SEC: num('WATCH_JOINS_PER_SEC', 20, 1, 90),
  PEEK_MS: num('PEEK_MS', 1500, 100, 10000),       // how long a new room waits for the Supabase check
  MOVED_TTL_MS: num('MOVED_TTL_MS', 10 * 60e3, 1000, 24 * 3600e3),

  // Limits
  MAX_CONNS: num('MAX_CONNS', 4000, 1, 200000),
  MAX_PER_IP: num('MAX_PER_IP', 64, 1, 100000),          // schools and mobile CGNAT share one address
  IP_BURST: num('IP_BURST', 30, 1, 100000),              // new sockets per address: burst …
  IP_PER_SEC: num('IP_PER_SEC', 1, 0.01, 100000),        // … and refill per second
  MAX_CHANNELS: num('MAX_CHANNELS', 32, 1, 1000),        // channels per connection
  MAX_MSG: num('MAX_MSG', 256 * 1024, 1024, 4 * 1024 * 1024),   // = Supabase Free broadcast payload limit
  MSG_BURST: num('MSG_BURST', 120, 1, 1e6), MSG_PER_SEC: num('MSG_PER_SEC', 60, 1, 1e6),
  BYTE_BURST: num('BYTE_BURST', 1024 * 1024, 1024, 1e9), BYTE_PER_SEC: num('BYTE_PER_SEC', 256 * 1024, 1024, 1e9),
  ABUSE_DROPS: num('ABUSE_DROPS', 400, 10, 1e9),         // dropped by rate limit within 10 s → disconnect
  MAX_ROOMS: num('MAX_ROOMS', 20000, 1, 1e7),
  MAX_ROOM_SUBS: num('MAX_ROOM_SUBS', 300, 2, 1e5),
  MAX_ROOM_PRESENCE: num('MAX_ROOM_PRESENCE', 200, 1, 1e5),
  MAX_META: num('MAX_META', 4096, 64, 65536),            // bytes of one presence meta (JSON)
  TRACK_BURST: num('TRACK_BURST', 10, 1, 1000), TRACK_PER_SEC: num('TRACK_PER_SEC', 1, 0.01, 1000),
  AUTH_BURST: num('AUTH_BURST', 5, 1, 100), AUTH_PER_SEC: num('AUTH_PER_SEC', 0.1, 0.001, 100),
  MEM_SOFT_MB: num('MEM_SOFT_MB', 380, 32, 1e6),          // above: no new sockets / rooms (container limit 512 MB)
  MEM_HARD_MB: num('MEM_HARD_MB', 450, 32, 1e6),          // above: /health ok:false too
  GRACE_MS: num('GRACE_MS', 10000, 0, 120000),            // resume window after a dropped socket
  ZOMBIE_FRAMES: num('ZOMBIE_FRAMES', 512, 0, 1e6), ZOMBIE_BYTES: num('ZOMBIE_BYTES', 1024 * 1024, 0, 1e9),
  ZOMBIE_TOTAL: num('ZOMBIE_TOTAL', 64 * 1024 * 1024, 0, 1e10),   // all disconnected sessions together
  SLOW_DROP: num('SLOW_DROP', 1024 * 1024, 16 * 1024, 1e9),    // outgoing buffer of a slow client: drop broadcasts (32 KB when memory is high) …
  SLOW_KILL: num('SLOW_KILL', 4 * 1024 * 1024, 32 * 1024, 1e9), // … and disconnect (a stalled or throttled link; 64 KB at the hard memory mark)
  HELLO_MS: num('HELLO_MS', 5000, 100, 60000),
  PING_MS: num('PING_MS', 25000, 1000, 600000),           // protocol ping (browsers answer even in background tabs)
  PROBE_MAX: num('PROBE_MAX', 65536, 0, 1e6),
  ROOM_GC_MS: num('ROOM_GC_MS', 30000, 0, 3600e3),        // an empty room is kept (and watched) this long

  // TURN (coturn «use-auth-secret»): credentials are an HMAC of the shared secret — the secret never leaves the server
  TURN_SECRET: str('TURN_SECRET', ''),
  TURN_HOST: str('TURN_HOST', '') || str('RT_HOST', ''),
  TURN_PORT: num('TURN_PORT', 3478, 1, 65535),
  TURN_TTL: num('TURN_TTL', 3600, 300, 86400),
  TURN_BURST: num('TURN_BURST', 10, 1, 1000), TURN_PER_SEC: num('TURN_PER_SEC', 1 / 60, 0.0001, 1000),
};
C.originOk = o => {
  if (!o) return C.ALLOW_NO_ORIGIN;
  if (C.ORIGINS.includes(o)) return true;
  return C.ALLOW_LOCAL_ORIGINS && C.LOCAL_ORIGIN.test(o);
};
module.exports = C;

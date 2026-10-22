'use strict';
// Time-limited TURN credentials («TURN REST API», coturn use-auth-secret): username = "<expiry unix>:<random>",
// password = base64(HMAC-SHA1(TURN_SECRET, username)). coturn checks the same HMAC with the same secret — the secret itself
// never leaves the server, a leaked password works only until <expiry>.
const crypto = require('crypto');

function turnCreds(cfg, now = Date.now()){
  if (!cfg.TURN_SECRET || !cfg.TURN_HOST) return null;
  const ttl = cfg.TURN_TTL;
  const username = Math.floor(now / 1000 + ttl) + ':' + crypto.randomBytes(6).toString('base64url');
  const credential = crypto.createHmac('sha1', cfg.TURN_SECRET).update(username).digest('base64');
  const h = cfg.TURN_HOST, p = cfg.TURN_PORT;
  return {
    iceServers: [
      { urls: [`stun:${h}:${p}`] },
      { urls: [`turn:${h}:${p}?transport=udp`, `turn:${h}:${p}?transport=tcp`], username, credential },
    ],
    ttl,
  };
}

// coturn's own check (for tests): is this username/credential pair valid now?
function turnValid(secret, username, credential, now = Date.now()){
  const exp = Number(String(username).split(':')[0]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const want = crypto.createHmac('sha1', secret).update(String(username)).digest('base64');
  return want === credential;
}

module.exports = { turnCreds, turnValid };

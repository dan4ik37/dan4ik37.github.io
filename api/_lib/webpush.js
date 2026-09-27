// api/_lib/webpush.js — отправка Web Push без npm-зависимостей (только node:crypto).
// Корневой package.json принадлежит Electron-проекту, поэтому пакет web-push не ставим.
//
//  • VAPID (RFC 8292): JWT ES256, подписанный приватным ключом сайта;
//  • шифрование содержимого aes128gcm (RFC 8291 + RFC 8188), одна запись.
//
// Переменные окружения (Vercel → Settings → Environment Variables):
//   VAPID_PUBLIC_KEY   — 65 байт несжатой точки P-256, base64url (его же берёт браузер)
//   VAPID_PRIVATE_KEY  — 32 байта d, base64url (СЕКРЕТ)
//   VAPID_SUBJECT      — mailto:адрес владельца
import crypto from 'node:crypto';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');

export const vapidConfigured = () =>
  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);

let signingKey = null;
function getSigningKey() {
  if (signingKey) return signingKey;
  const pub = unb64u(process.env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY: ожидается 65 байт (0x04|x|y)');
  signingKey = crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)),
      d: process.env.VAPID_PRIVATE_KEY,
    },
  });
  return signingKey;
}

// JWT на 12 часов; кэшируем по push-сервису (aud), чтобы не подписывать на каждую подписку
const jwtCache = new Map();
function vapidAuth(endpoint) {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const now = Math.floor(Date.now() / 1000);
  if (hit && hit.exp - now > 3600) return hit.header;
  const exp = now + 12 * 3600;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp, sub: process.env.VAPID_SUBJECT }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: getSigningKey(), dsaEncoding: 'ieee-p1363' });
  const header = `vapid t=${head}.${body}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
  jwtCache.set(aud, { exp, header });
  return header;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// RFC 8291: шифрует payload для подписки { p256dh, auth }. Возвращает тело запроса.
export function encryptPayload(payload, p256dh, auth) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad_keys');

  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);                       // 32 байта
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  // Одна (последняя) запись: данные + разделитель 0x02, без добивки
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, enc]);
}

// Отправляет одно уведомление. → { ok, status, gone } (gone = подписка мертва, удалить)
export async function sendPush(sub, data, { ttl = 86400, urgency = 'high', timeoutMs = 8000 } = {}) {
  let body;
  try { body = encryptPayload(JSON.stringify(data), sub.p256dh, sub.auth); }
  catch (e) { return { ok: false, status: 0, gone: true }; }   // битые ключи — такую подписку не спасти

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuth(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
      signal: ctl.signal,
    });
    return { ok: r.ok, status: r.status, gone: r.status === 404 || r.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false };
  } finally {
    clearTimeout(timer);
  }
}

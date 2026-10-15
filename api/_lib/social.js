// api/_lib/social.js — вход через VK ID, Яндекс ID и Telegram (свои входы через сервер сайта): общий код.
// Маршруты — api/_lib/routes/oauth.js (/auth/<сервис>/start|callback, /api/oauth?a=…) в api/pages.js. Пошагово владельцу — docs/LOGIN_PROVIDERS.md.
// Google, Discord, Twitch, GitHub — встроенные входы Supabase (здесь их нет: браузер ↔ Supabase, защита — триггеры в auth-links.sql).
//
// Как устроено (владелец 15.10.2026: «вход через другие сервисы, но чтобы не было обходов и вредных действий для сайта и ботов»):
//  1) /auth/<p>/start — случайные state и PKCE (code_verifier) — в подписанной куке (HttpOnly, Secure, только /auth, 10 мин) → сервис;
//     адрес возврата — один, точный (SITE/auth/<p>/callback), «куда вернуть» — только из списка разделов сайта (safeNext);
//  2) /auth/<p>/callback — state сверяется с кукой и отмечается одноразовым (auth_once), код меняется на токен у сервиса
//     (секрет — в Vercel), берём ТОЛЬКО номер человека, имя и аватарку; токены сервиса нигде не храним;
//  3) номер → аккаунт сайта (auth_links); нет — новый аккаунт через admin API: служебная почта <p>-<номер>-<6 hex>@id.invalid
//     (.invalid не существует — письма туда не уходят никогда), лимиты на новые аккаунты по отпечатку адреса (auth_social_begin);
//  4) вход без письма: admin generate_link (magiclink) → hashed_token в ЗАШИФРОВАННОМ пропуске во фрагменте адреса (#d37auth=…:
//     фрагмент не уходит на сервер и в Referer) → страница отдаёт пропуск + секрет вкладки (/api/oauth?a=finish): пропуск живёт
//     3 мин, одноразовый и открывается только в браузере, где начали вход → verifyOtp({ token_hash, type: 'magiclink' }).
// Привязка к существующему аккаунту — только из вошедшей сессии со свежим входом (amr ≤ 15 мин): билет ?a=ticket → start с m=link.
// По почте НЕ привязываем никогда (почту у VK / Яндекса / Telegram даже не спрашиваем).
import crypto from 'node:crypto';
import { storeConfigured, sbRpc, timedFetch } from './store.js';

export const OWN = ['vk', 'yandex', 'tg'];
export const NAMES = { vk: 'VK ID', yandex: 'Яндекс ID', tg: 'Telegram' };
export const SYNTH_DOMAIN = 'id.invalid';
const STATE_TTL = 600, HANDOFF_TTL = 180, TICKET_TTL = 600, FRESH_SEC = 15 * 60, TG_MAX_AGE = 300;

// ═══ Настройки из Vercel (нет переменных — вход выключен, кнопки не видно) ═══
const clean = v => String(v || '').trim();
export function config(env = process.env) {
  const site = (clean(env.SITE_URL) || 'https://dan4ik37.vercel.app').replace(/\/+$/, '');
  const vkId = clean(env.VK_ID_CLIENT_ID);
  const vk = /^\d{1,12}$/.test(vkId) ? { id: vkId, secret: clean(env.VK_ID_SECRET) } : null;
  const yaId = clean(env.YANDEX_CLIENT_ID), yaSec = clean(env.YANDEX_CLIENT_SECRET);
  const yandex = /^[0-9a-f]{32}$/i.test(yaId) && yaSec.length >= 16 ? { id: yaId, secret: yaSec } : null;
  const token = clean(env.TELEGRAM_BOT_TOKEN), bot = clean(env.TELEGRAM_BOT_NAME).replace(/^@/, '');
  const botId = (token.match(/^(\d{4,20}):[A-Za-z0-9_-]{30,}$/) || [])[1] || '';
  const tgCid = clean(env.TELEGRAM_CLIENT_ID) || botId, tgSec = clean(env.TELEGRAM_CLIENT_SECRET);
  let tg = null;
  if (/^\d{4,20}$/.test(tgCid) && tgSec.length >= 16) tg = { mode: 'oidc', id: tgCid, secret: tgSec };           // новый вход Telegram (OpenID)
  else if (botId && /^[A-Za-z0-9_]{5,32}$/.test(bot)) tg = { mode: 'widget', token, bot, id: botId };            // виджет «Войти через Telegram»
  const secret = clean(env.AUTH_SECRET) || clean(env.SUPABASE_SERVICE_ROLE_KEY);
  return { site, vk, yandex, tg, secret, store: storeConfigured() && secret.length >= 16 };
}
export const redirectUri = (c, p) => `${c.site}/auth/${p}/callback`;
export const enabled = (c, p) => !!(c.store && c[p]);

// ═══ Крипто ═══
export const b64u = buf => Buffer.from(buf).toString('base64url');
export const rnd = (n = 32) => b64u(crypto.randomBytes(n));
const sha = s => crypto.createHash('sha256').update(s).digest();
export const shaB64 = s => b64u(sha(String(s)));
export const shaHex = s => sha(String(s)).toString('hex');
export const pkceChallenge = verifier => b64u(sha(verifier));
export function safeEq(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
// Свой ключ на каждую задачу — из AUTH_SECRET (или ключа service_role), с меткой: подпись куки не подходит к билету и т. п.
const keyOf = (c, label) => crypto.createHmac('sha256', c.secret).update('d37-auth:' + label).digest();
export function sign(c, label, obj) {
  const body = b64u(JSON.stringify(obj));
  return body + '.' + b64u(crypto.createHmac('sha256', keyOf(c, label)).update(body).digest());
}
// → объект, если подпись верна и срок (поле e, секунды) не прошёл; иначе null
export function unsign(c, label, str, now = Date.now() / 1000) {
  const s = String(str || '');
  if (s.length > 4096) return null;
  const i = s.lastIndexOf('.');
  if (i < 1) return null;
  const body = s.slice(0, i), mac = b64u(crypto.createHmac('sha256', keyOf(c, label)).update(body).digest());
  if (!safeEq(mac, s.slice(i + 1))) return null;
  try { const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return o && typeof o === 'object' && +o.e > now ? o : null; }
  catch (e) { return null; }
}
// Пропуск входа: AES-256-GCM — токен внутри никто не прочитает и не подменит
const AAD = Buffer.from('d37-auth-handoff-v1');
export function seal(c, obj) {
  const iv = crypto.randomBytes(12), ci = crypto.createCipheriv('aes-256-gcm', keyOf(c, 'seal'), iv);
  ci.setAAD(AAD);
  const ct = Buffer.concat([ci.update(JSON.stringify(obj), 'utf8'), ci.final()]);
  return b64u(Buffer.concat([iv, ct, ci.getAuthTag()]));
}
export function unseal(c, str, now = Date.now() / 1000) {
  try {
    const raw = Buffer.from(String(str || ''), 'base64url');
    if (raw.length < 29 || raw.length > 4096) return null;
    const de = crypto.createDecipheriv('aes-256-gcm', keyOf(c, 'seal'), raw.subarray(0, 12));
    de.setAAD(AAD);
    de.setAuthTag(raw.subarray(raw.length - 16));
    const o = JSON.parse(Buffer.concat([de.update(raw.subarray(12, raw.length - 16)), de.final()]).toString('utf8'));
    return o && typeof o === 'object' && +o.e > now ? o : null;
  } catch (e) { return null; }
}

// ═══ Куда вернуть после входа: только разделы самого сайта (#/раздел/…) — без чужих адресов ═══
export function safeNext(n, def = '#/profile') {
  const s = String(n ?? '');
  return s.length <= 120 && /^#\/[a-z][a-z0-9-]{0,24}(\/[A-Za-z0-9_-]{1,40}){0,4}$/.test(s) ? s : def;
}

// ═══ Адрес человека → отпечаток за день (сам адрес не храним; IPv6 — подсеть /64: один дом) ═══
export function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);
}
export function normIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return '';
  const br = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (br) s = br[1];
  const v4 = s.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4) return v4[1];
  if (!s.includes(':')) return s.slice(0, 64);
  s = s.split('%')[0];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [], t = tail === undefined ? null : (tail ? tail.split(':') : []);
  const all = t === null ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (all.length !== 8 || !all.every(g => /^[0-9a-f]{1,4}$/.test(g))) return s.slice(0, 64);
  return all.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
export const mskDay = (t = Date.now()) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
export const ipHash = (c, ip, day = mskDay()) =>
  crypto.createHmac('sha256', keyOf(c, 'ip')).update(day + '|' + (normIp(ip) || 'noip')).digest('hex').slice(0, 32);

// ═══ Кука состояния входа (одна на сервис: два входа в разных вкладках не путаются) ═══
export const cookieName = p => 'd37_oa_' + p;
export const cookieSet = (name, value, maxAge) => `${name}=${value}; Path=/auth; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export function cookieGet(req, name) {
  const raw = String((req.headers || {}).cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// ═══ Что сохраняем о человеке: имя (имя + первая буква фамилии) и аватарка с адреса самого сервиса ═══
export function cleanName(s) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
const nameOf = (first, last, alt) => {
  const f = cleanName(first), l = cleanName(last);
  return f ? (l ? `${f} ${l[0].toUpperCase()}.` : f) : cleanName(alt);
};
const AVATAR_HOSTS = {
  vk: /(^|\.)(userapi\.com|vk\.com|vk\.ru|vkuser\.net|vk-cdn\.net|mycdn\.me)$/i,
  yandex: /(^|\.)avatars\.yandex\.net$/i,
  tg: /(^|\.)(t\.me|telegram\.org|telesco\.pe)$/i,
};
export function cleanAvatar(p, url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' && AVATAR_HOSTS[p]?.test(u.hostname) && u.href.length <= 400 && !/["'<>\\\s]/.test(u.href) ? u.href : null;
  } catch (e) { return null; }
}
const uidOk = v => /^[0-9]{1,20}$/.test(String(v ?? ''));

// ═══ Сервисы: адрес входа и «код → номер, имя, аватарка» (токены — только в памяти этого запроса) ═══
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
async function postForm(url, body, headers = {}) {
  const r = await timedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }, body: form(body) },
    { timeoutMs: 8000, retries: 0 });   // повтор нельзя: код одноразовый
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok || !j || j.error) throw new Error(`${new URL(url).host}: ${r.status} ${String(j?.error || '').slice(0, 60)}`);
  return j;
}

export const VK_HOST = 'https://id.vk.ru';
export const PROVIDERS = {
  vk: {
    authorize: (c, s) => `${VK_HOST}/authorize?` + form({ response_type: 'code', client_id: c.vk.id, redirect_uri: redirectUri(c, 'vk'),
      state: s.state, code_challenge: s.challenge, code_challenge_method: 'S256', scope: 'vkid.personal_info', lang_id: 0, scheme: 'dark' }),
    async profile(c, q, st) {
      const device = String(q.device_id || '');
      if (!device || device.length > 200) throw new Error('vk: нет device_id');
      const tok = await postForm(`${VK_HOST}/oauth2/auth`, { grant_type: 'authorization_code', code_verifier: st.v, redirect_uri: redirectUri(c, 'vk'),
        code: String(q.code), client_id: c.vk.id, device_id: device, state: st.s, service_token: c.vk.secret || undefined });
      if (!tok.access_token) throw new Error('vk: нет токена');
      const info = await postForm(`${VK_HOST}/oauth2/user_info`, { client_id: c.vk.id, access_token: tok.access_token });
      const u = info.user || {};
      if (!uidOk(u.user_id)) throw new Error('vk: нет номера');
      if (tok.user_id && String(tok.user_id) !== String(u.user_id)) throw new Error('vk: номер не совпал');
      return { uid: String(u.user_id), name: nameOf(u.first_name, u.last_name), avatar: cleanAvatar('vk', u.avatar) };
    },
  },
  yandex: {
    // права (имя, портрет) — те, что отмечены у приложения на oauth.yandex.ru; почту не спрашиваем
    authorize: (c, s) => 'https://oauth.yandex.ru/authorize?' + form({ response_type: 'code', client_id: c.yandex.id, redirect_uri: redirectUri(c, 'yandex'),
      state: s.state, code_challenge: s.challenge, code_challenge_method: 'S256' }),
    async profile(c, q, st) {
      const tok = await postForm('https://oauth.yandex.ru/token', { grant_type: 'authorization_code', code: String(q.code), code_verifier: st.v },
        { Authorization: basic(c.yandex.id, c.yandex.secret) });
      if (!tok.access_token) throw new Error('yandex: нет токена');
      const r = await timedFetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + tok.access_token, Accept: 'application/json' } },
        { timeoutMs: 8000, retries: 1 });
      const u = r.ok ? await r.json().catch(() => null) : null;
      if (!u || !uidOk(u.id)) throw new Error('yandex: нет номера');
      if (u.client_id && String(u.client_id) !== c.yandex.id) throw new Error('yandex: чужое приложение');
      const avatar = !u.is_avatar_empty && /^[\w/-]{3,80}$/.test(String(u.default_avatar_id || ''))
        ? cleanAvatar('yandex', `https://avatars.yandex.net/get-yapic/${u.default_avatar_id}/islands-200`) : null;
      return { uid: String(u.id), name: nameOf(u.first_name, u.last_name, u.display_name || u.login), avatar };
    },
  },
  tg: {
    // новый вход Telegram (OpenID Connect): oauth.telegram.org, PKCE, id_token с подписью Telegram (ключи JWKS)
    authorize: (c, s) => 'https://oauth.telegram.org/auth?' + form({ client_id: c.tg.id, redirect_uri: redirectUri(c, 'tg'), response_type: 'code',
      scope: 'openid profile', state: s.state, code_challenge: s.challenge, code_challenge_method: 'S256' }),
    async profile(c, q, st) {
      const tok = await postForm('https://oauth.telegram.org/token', { grant_type: 'authorization_code', code: String(q.code), redirect_uri: redirectUri(c, 'tg'),
        client_id: c.tg.id, code_verifier: st.v }, { Authorization: basic(c.tg.id, c.tg.secret) });
      const cl = await verifyIdToken(tok.id_token, { iss: 'https://oauth.telegram.org', aud: c.tg.id });
      const uid = cl.id ?? cl.sub;
      if (!uidOk(uid)) throw new Error('tg: нет номера');
      return { uid: String(uid), name: nameOf(cl.given_name || cl.name, cl.family_name, cl.preferred_username), avatar: cleanAvatar('tg', cl.picture) };
    },
  },
};

// ═══ Подпись id_token (OpenID Connect): RS256 / ES256 / EdDSA по ключам сервиса ═══
let JWKS = { keys: null, at: 0 };
async function tgKeys(force) {
  if (!force && JWKS.keys && Date.now() - JWKS.at < 3600e3) return JWKS.keys;
  const r = await timedFetch('https://oauth.telegram.org/.well-known/jwks.json', { headers: { Accept: 'application/json' } }, { timeoutMs: 6000, retries: 1 });
  if (!r.ok) throw new Error('tg: jwks ' + r.status);
  const j = await r.json();
  JWKS = { keys: Array.isArray(j?.keys) ? j.keys : [], at: Date.now() };
  return JWKS.keys;
}
export function resetJwksCache() { JWKS = { keys: null, at: 0 }; }
export async function verifyIdToken(tok, { iss, aud, keys, now = Date.now() / 1000 }) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3 || tok.length > 8192) throw new Error('jwt: формат');
  let head, cl;
  try { head = JSON.parse(Buffer.from(parts[0], 'base64url')); cl = JSON.parse(Buffer.from(parts[1], 'base64url')); }
  catch (e) { throw new Error('jwt: формат'); }
  const alg = head?.alg;
  if (!['RS256', 'ES256', 'EdDSA'].includes(alg)) throw new Error('jwt: алгоритм ' + alg);
  const pick = list => (list || []).find(k => k && k.kid === head.kid && (!k.alg || k.alg === alg));
  let jwk = pick(keys || await tgKeys());
  if (!jwk && !keys) jwk = pick(await tgKeys(true));   // Telegram сменил ключи
  if (!jwk) throw new Error('jwt: нет ключа');
  const pub = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
  const data = Buffer.from(parts[0] + '.' + parts[1]), sig = Buffer.from(parts[2], 'base64url');
  const good = alg === 'RS256' ? crypto.verify('RSA-SHA256', data, pub, sig)
    : alg === 'ES256' ? crypto.verify('sha256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig)
    : crypto.verify(null, data, pub, sig);
  if (!good) throw new Error('jwt: подпись');
  if (cl.iss !== iss) throw new Error('jwt: iss');
  const auds = Array.isArray(cl.aud) ? cl.aud.map(String) : [String(cl.aud)];
  if (!auds.includes(String(aud))) throw new Error('jwt: aud');
  if (!(+cl.exp > now - 30)) throw new Error('jwt: просрочен');
  if (cl.iat && +cl.iat > now + 120) throw new Error('jwt: iat');
  return cl;
}

// ═══ Виджет «Войти через Telegram»: hash = HMAC-SHA256(data-check-string, SHA256(токен бота)), свежесть auth_date ═══
export function tgWidgetCheck(data, botToken, now = Date.now() / 1000, maxAge = TG_MAX_AGE) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'bad' };
  const keys = Object.keys(data);
  if (keys.length > 12 || !keys.includes('hash') || !keys.includes('id') || !keys.includes('auth_date')) return { ok: false, reason: 'bad' };
  for (const k of keys) {
    const v = data[k];
    if (!/^[a-z_]{1,32}$/.test(k) || !['string', 'number', 'boolean'].includes(typeof v) || String(v).length > 512) return { ok: false, reason: 'bad' };
  }
  const hash = String(data.hash).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'bad' };
  const check = keys.filter(k => k !== 'hash').sort().map(k => `${k}=${data[k]}`).join('\n');
  const mine = crypto.createHmac('sha256', sha(String(botToken))).update(check, 'utf8').digest('hex');
  if (!safeEq(mine, hash)) return { ok: false, reason: 'hash' };
  const at = Number(data.auth_date);
  if (!Number.isInteger(at)) return { ok: false, reason: 'bad' };
  if (now - at > maxAge) return { ok: false, reason: 'old' };
  if (at - now > 60) return { ok: false, reason: 'bad' };
  if (!uidOk(data.id)) return { ok: false, reason: 'bad' };
  return { ok: true, uid: String(data.id), hash, name: nameOf(data.first_name, data.last_name, data.username), avatar: cleanAvatar('tg', data.photo_url) };
}

// ═══ Supabase Auth: админ-запросы ключом service_role и проверка токена вошедшего ═══
const sbBase = () => clean(process.env.SUPABASE_URL).replace(/\/+$/, '');
const sbKey = () => clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
async function sbAuth(path, opts = {}) {
  const r = await timedFetch(`${sbBase()}/auth/v1${path}`, { ...opts, headers: { apikey: sbKey(), Authorization: 'Bearer ' + sbKey(), 'Content-Type': 'application/json', ...(opts.headers || {}) } },
    { timeoutMs: 8000, retries: 0 });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error(`auth ${path.split('?')[0]}: ${r.status} ${String(j?.error_code || j?.code || j?.msg || '').slice(0, 60)}`);
  return j;
}
export async function adminCreateUser(p, uid) {
  const email = `${p}-${uid}-${crypto.randomBytes(3).toString('hex')}@${SYNTH_DOMAIN}`;
  const u = await sbAuth('/admin/users', { method: 'POST', body: JSON.stringify({
    email, email_confirm: true, app_metadata: { d37_via: p, d37_synth_email: email }, user_metadata: {} }) });
  if (!u?.id) throw new Error('auth: нет id нового аккаунта');
  return { id: u.id, email };
}
export const adminGetUser = async id => sbAuth('/admin/users/' + encodeURIComponent(id));
export const adminDeleteUser = async id => sbAuth('/admin/users/' + encodeURIComponent(id), { method: 'DELETE' });
export async function adminMagicHash(email) {
  const j = await sbAuth('/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email }) });
  const h = j?.hashed_token || j?.properties?.hashed_token;
  if (!h || !/^[A-Za-z0-9_-]{16,200}$/.test(h)) throw new Error('auth: нет hashed_token');
  return h;
}
// Чей это токен (проверяет сам Supabase) + когда человек ВХОДИЛ (amr), а не продлевал сессию
export function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch (e) { return null; }
}
export function authAt(claims) {
  const t = (Array.isArray(claims?.amr) ? claims.amr : []).map(a => +a?.timestamp).filter(Number.isFinite);
  return t.length ? Math.max(...t) : 0;
}
export const isFresh = (at, now = Date.now() / 1000) => at > now - FRESH_SEC && at < now + 300;
export async function userFromBearer(req) {
  const h = String((req.headers || {}).authorization || '');
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!tok || tok.length > 8192 || tok.split('.').length !== 3) return null;
  try {
    const r = await timedFetch(`${sbBase()}/auth/v1/user`, { headers: { apikey: sbKey(), Authorization: 'Bearer ' + tok } }, { timeoutMs: 6000, retries: 0 });
    if (!r.ok) return null;
    const u = await r.json();
    const cl = jwtClaims(tok);
    if (typeof u?.id !== 'string' || !cl || cl.sub !== u.id) return null;
    return { id: u.id, at: authAt(cl), user: u };
  } catch (e) { return null; }
}

// ═══ База (auth-links.sql) ═══
let ready = { v: false, at: 0 };
export async function sqlReady() {
  if (Date.now() - ready.at < (ready.v ? 300e3 : 60e3)) return ready.v;
  let v = false;
  try { v = (await sbRpc('auth_social_ready', {})) === true; } catch (e) { v = false; }
  ready = { v, at: Date.now() };
  return v;
}
export function resetReadyCache() { ready = { v: false, at: 0 }; }
export const onceUse = async (key, sec) => { try { return (await sbRpc('auth_once_use', { p_key: key, p_sec: sec })) === true; } catch (e) { return false; } };

// Номер в сервисе → аккаунт сайта (создать, если его ещё нет) → hashed_token для входа без письма.
// expect — «подтверди, что это ты» перед привязкой: войти можно только в ЭТОТ аккаунт (нового не создаём, в чужой не пускаем)
export async function loginOrCreate(c, p, prof, req, { expect } = {}) {
  const b = await sbRpc('auth_social_begin', { p_provider: p, p_uid: prof.uid, p_ip: ipHash(c, clientIp(req)), p_name: prof.name || null, p_avatar: prof.avatar || null });
  if (!b?.ok) return { ok: false, reason: b?.reason || 'server' };
  if (expect && (b.create || b.user !== expect)) return { ok: false, reason: 'other' };
  let user = b.user, email = null, isNew = false;
  if (b.create) {
    const made = await adminCreateUser(p, prof.uid);
    let bind;
    try { bind = await sbRpc('auth_social_bind', { p_provider: p, p_uid: prof.uid, p_user: made.id, p_name: prof.name || null, p_avatar: prof.avatar || null }); }
    catch (e) { bind = { ok: false, reason: 'server' }; }
    if (bind?.ok) { user = made.id; email = made.email; isNew = true; }
    else {
      await adminDeleteUser(made.id).catch(() => {});   // лишний аккаунт без входа — убрать
      if (bind?.reason !== 'race' || !bind.user) return { ok: false, reason: bind?.reason || 'server' };
      user = bind.user;   // двойной клик: аккаунт уже создал первый запрос
    }
  }
  if (!email) email = (await adminGetUser(user))?.email;
  if (!email) return { ok: false, reason: 'server' };
  return { ok: true, user, isNew, hashed: await adminMagicHash(email) };
}
export const TTL = { STATE_TTL, HANDOFF_TTL, TICKET_TTL, FRESH_SEC, TG_MAX_AGE };

// T-167 «наш Дискорд»: две маленькие серверные части в одной функции api/pages.js (лимит Vercel Hobby — 12 функций).
//
// 1) GET /api/turn-cred — пароли сервера-посредника (TURN) Cloudflare Realtime для звонков, когда напрямую не соединяется.
//    ВЫКЛЮЧЕНО, пока владелец не задаст в Vercel → Environment Variables: CF_TURN_KEY_ID и CF_TURN_KEY_TOKEN (их создаёт сам
//    владелец в кабинете Cloudflare → Realtime → TURN; агенты аккаунтов и ключей не создают). Без них ответ { off: true } —
//    звонки идут как раньше (STUN, честная подсказка «не соединилось»). Только вошедшим (проверка токена Supabase).
//
// 2) POST /api/ext-check?id=N — проверка картинки сообщества с ЕГО сервера (community.sql ч. 15, cf_ext_*; выключено, пока
//    site_config 'ext_media' <> 'on'). Один раз скачивает адрес из реестра: только https, только разрешённые сообществом узлы,
//    не внутренние адреса, без перенаправлений, 5 с, размер и тип по первым байтам (PNG / GIF / WebP / JPEG; SVG и всё прочее —
//    нет), ширина и высота, заголовок CORS (иначе браузер не сможет проверить хеш), sha-256 → cf_ext_verified (ключ сервиса).
//    Что НА картинке — сервер не понимает (автоматической проверки содержимого без внешнего сервиса нет): после этой проверки
//    картинка ждёт человека из команды сайта (cf_ext_review).
import { storeConfigured, sbRpc, timedFetch } from '../store.js';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const SITE = 'https://dan4ik37.vercel.app';
// лимиты картинок (байты и пиксели) — решение владельца; пока такие:
export const EXT_LIM = { emoji: { bytes: 256 * 1024, px: 256 }, sticker: { bytes: 512 * 1024, px: 512 } };

async function userOf(req) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!base || !key || !token) return null;
  try {
    const r = await timedFetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }, { timeoutMs: 6000, retries: 0 });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id || null;
  } catch (e) { return null; }
}

export async function turnCred(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = process.env.CF_TURN_KEY_ID, tok = process.env.CF_TURN_KEY_TOKEN;
  if (!id || !tok) return res.status(200).json({ off: true });
  const uid = await userOf(req);
  if (!uid) return res.status(401).json({ ok: false, reason: 'auth' });
  try {
    const r = await timedFetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 3600 }),
    }, { timeoutMs: 5000, retries: 0 });
    if (!r.ok) return res.status(200).json({ off: true, reason: 'upstream' });
    const j = await r.json();
    const list = (Array.isArray(j?.iceServers) ? j.iceServers : [j?.iceServers]).filter(s => s && s.urls).slice(0, 4);
    if (!list.length) return res.status(200).json({ off: true, reason: 'upstream' });
    return res.status(200).json({ ok: true, ttl: 3600, iceServers: list });
  } catch (e) { return res.status(200).json({ off: true, reason: 'upstream' }); }
}

// ── картинка: тип и размер по первым байтам (чистая функция — проверка в scripts/t167-test.cjs) ──
export function sniffImage(b) {
  if (!b || b.length < 24) return null;
  const u32be = o => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', w: u32be(16), h: u32be(20) };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { mime: 'image/gif', w: b[6] | (b[7] << 8), h: b[8] | (b[9] << 8) };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const fmt = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (fmt === 'VP8X' && b.length >= 30) return { mime: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (fmt === 'VP8 ' && b.length >= 30) return { mime: 'image/webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (fmt === 'VP8L' && b.length >= 25) { const x = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { mime: 'image/webp', w: 1 + (x & 0x3fff), h: 1 + ((x >>> 14) & 0x3fff) }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1], len = (b[o + 2] << 8) + b[o + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', h: (b[o + 5] << 8) + b[o + 6], w: (b[o + 7] << 8) + b[o + 8] };
      if (len < 2) return null;
      o += 2 + len;
    }
    return null;
  }
  return null;   // SVG, HTML и всё остальное — нет
}
// внутренние / служебные адреса — не ходим (защита от «сходи на свой же сервер»)
export function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:');
}
async function fail(id, why) { try { await sbRpc('cf_ext_verified', { p_id: id, p_ok: false, p_sha: null, p_bytes: null, p_w: null, p_h: null, p_mime: null, p_why: why }); } catch (e) {} return why; }

export async function extCheck(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!storeConfigured()) return res.status(200).json({ ok: false, reason: 'not_configured' });
  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ ok: false, reason: 'id' });
  if (!(await userOf(req))) return res.status(401).json({ ok: false, reason: 'auth' });
  let todo;
  try { todo = await sbRpc('cf_ext_todo', { p_id: id }); } catch (e) { return res.status(200).json({ ok: false, reason: 'no_sql' }); }
  if (!todo || !todo.url) return res.status(200).json({ ok: false, reason: 'not_checking' });
  const lim = EXT_LIM[todo.kind] || EXT_LIM.emoji;
  let u;
  try { u = new URL(todo.url); } catch (e) { return res.status(200).json({ ok: false, reason: await fail(id, 'адрес не разобрать') }); }
  const hosts = Array.isArray(todo.hosts) ? todo.hosts : [];
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !hosts.includes(u.hostname)) return res.status(200).json({ ok: false, reason: await fail(id, 'узел не разрешён сообществом') });
  try {
    const ips = await lookup(u.hostname, { all: true });
    if (!ips.length || ips.some(x => privateIp(x.address))) return res.status(200).json({ ok: false, reason: await fail(id, 'внутренний адрес') });
  } catch (e) { return res.status(200).json({ ok: false, reason: await fail(id, 'узел не найден') }); }
  let r;
  try { r = await timedFetch(u.href, { redirect: 'manual', headers: { Origin: SITE, Accept: 'image/png,image/webp,image/gif,image/jpeg' } }, { timeoutMs: 5000, retries: 0 }); }
  catch (e) { return res.status(200).json({ ok: false, reason: await fail(id, 'сервер не ответил за 5 с') }); }
  if (r.status !== 200) return res.status(200).json({ ok: false, reason: await fail(id, r.status >= 300 && r.status < 400 ? 'перенаправления запрещены' : 'ответ ' + r.status) });
  const acao = r.headers.get('access-control-allow-origin') || '';
  if (acao !== '*' && acao !== SITE) return res.status(200).json({ ok: false, reason: await fail(id, 'нет заголовка Access-Control-Allow-Origin') });
  const len = Number(r.headers.get('content-length') || 0);
  if (len > lim.bytes) return res.status(200).json({ ok: false, reason: await fail(id, 'файл больше ' + Math.round(lim.bytes / 1024) + ' КБ') });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > lim.bytes || buf.length < 24) return res.status(200).json({ ok: false, reason: await fail(id, 'размер файла не подходит') });
  const im = sniffImage(buf);
  if (!im) return res.status(200).json({ ok: false, reason: await fail(id, 'не PNG / GIF / WebP / JPEG') });
  if (!im.w || !im.h || im.w > lim.px || im.h > lim.px) return res.status(200).json({ ok: false, reason: await fail(id, `картинка больше ${lim.px}×${lim.px}`) });
  const sha = createHash('sha256').update(buf).digest('hex');
  try { await sbRpc('cf_ext_verified', { p_id: id, p_ok: true, p_sha: sha, p_bytes: buf.length, p_w: im.w, p_h: im.h, p_mime: im.mime, p_why: '' }); }
  catch (e) { return res.status(200).json({ ok: false, reason: 'db' }); }
  return res.status(200).json({ ok: true, sha256: sha, bytes: buf.length, w: im.w, h: im.h, mime: im.mime });
}

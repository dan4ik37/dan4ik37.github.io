// api/_lib/routes/diag.js — POST /api/diag (rewrite в vercel.json → api/pages.js?page=diag): отчёты браузеров об ошибках сайта
// (мониторинг, T-016, docs/OPS.md). Браузер (js/core/errlog.js, этап 2) шлёт пачку до 10 ошибок: { v, b, o, d, x, e: [{ t, m, f, l, c, r, n, s }] }
// — уже очищенную от личных данных. Сервер всё равно перепроверяет (api/_lib/errlog.js: те же clean/noise), складывает в базу одним
// вызовом ops_err_ingest (ops.sql, только service_role) и отвечает { ok, stop?, rate? }: stop — «молчи столько секунд», rate — доля визитов.
// Защита от шквала без лишней нагрузки: метод/размер → общий счётчик экземпляра → лимит с одного адреса (хеш адреса с солью живёт в
// памяти, в базу не попадает) → только потом разбор и база; база сказала «хватит» (квота дня) или нет ops.sql — до конца срока в базу
// не ходим вовсе. Нет ключей Supabase / нет ops.sql — тихий ответ { ok: 0, stop }, сайт работает как раньше. DIAG_DISABLED=1 — выключатель.
import { createHash, randomBytes } from 'node:crypto';
import { storeConfigured, sbRpc } from '../store.js';
import { cleanItem, cleanMeta } from '../errlog.js';

// ipN — с одного адреса: за мобильным оператором (общий адрес на многих) сидят сотни людей, поэтому не 8, а 30 за 10 минут
const LIM = { body: 16384, items: 10, ipN: 30, ipWin: 600e3, globalN: 240, globalWin: 60e3, buckets: 4000 };
const SALT = randomBytes(8).toString('hex');
const SITE_HOST = 'dan4ik37.vercel.app';
const buckets = new Map();          // хеш адреса → { n, t0 }
let gN = 0, gT0 = 0;                // всего запросов за окно у этого экземпляра
let blockedUntil = 0;               // не ходить в базу до этого момента (квота дня, нет ops.sql, база недоступна)
const warned = new Set();
const missingSql = e => /PGRST202|Could not find the function|HTTP 404|schema cache/i.test(String(e?.message || e));

function send(res, code, body, extra) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (extra) for (const k of Object.keys(extra)) res.setHeader(k, extra[k]);
  res.end(JSON.stringify(body));
}
const warnOnce = (k, ...a) => { if (!warned.has(k)) { warned.add(k); try { console.warn('[diag]', ...a); } catch (e) {} } };
const ipOf = req => String(req.headers?.['x-real-ip'] || String(req.headers?.['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);

async function bodyJson(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  let raw = typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise(resolve => {
      let s = '';
      req.on('data', c => { s += c; if (s.length > LIM.body) resolve(''); });
      req.on('end', () => resolve(s));
      req.on('error', () => resolve(''));
    });
  }
  try { return raw && raw.length <= LIM.body ? JSON.parse(raw) : null; } catch (e) { return null; }
}

// Лимиты экземпляра: общий и по адресу. Вернёт null (можно) или секунды, сколько просить браузер молчать
export function gate(ip, now = Date.now()) {
  if (now - gT0 > LIM.globalWin) { gT0 = now; gN = 0; }
  if (++gN > LIM.globalN) return 600;
  const k = createHash('sha256').update(SALT + ip).digest('base64url').slice(0, 16);
  let b = buckets.get(k);
  if (!b || now - b.t0 > LIM.ipWin) {
    if (buckets.size >= LIM.buckets) { for (const [kk, v] of buckets) if (now - v.t0 > LIM.ipWin) buckets.delete(kk); if (buckets.size >= LIM.buckets) buckets.clear(); }
    b = { n: 0, t0: now }; buckets.set(k, b);
  }
  return ++b.n > LIM.ipN ? 600 : null;
}

// Присланное → { meta, items } или null (форма не та). Всё очищается тем же кодом, что и в браузере
export function parse(body, host = SITE_HOST) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.e)) return null;
  const items = [];
  for (const it of body.e.slice(0, LIM.items)) { const c = cleanItem(it, host); if (c) items.push(c); }
  return { meta: cleanMeta(body), items, dropped: Math.max(0, Math.min(100000, Math.floor(+body.x) || 0)) };
}

export const _test = { LIM, gate, parse, bodyJson, ipOf, reset() { buckets.clear(); gN = 0; gT0 = 0; blockedUntil = 0; warned.clear(); } };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok: 0 }, { Allow: 'POST' });
    if (process.env.DIAG_DISABLED === '1') return send(res, 200, { ok: 0, stop: 86400 });
    const ip = ipOf(req), wait = gate(ip);
    if (wait) return send(res, 429, { ok: 0, stop: wait });
    if (+(req.headers?.['content-length'] || 0) > LIM.body) return send(res, 413, { ok: 0, stop: 3600 });
    const now = Date.now();
    if (now < blockedUntil) return send(res, 200, { ok: 0, stop: Math.max(60, Math.ceil((blockedUntil - now) / 1000)) });
    const P = parse(await bodyJson(req));
    if (!P) return send(res, 400, { ok: 0 });
    if (!P.items.length) return send(res, 200, { ok: 1 });
    if (!storeConfigured()) { warnOnce('env', 'нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — ошибки не записываются'); return send(res, 200, { ok: 0, stop: 21600 }); }
    let out;
    try { out = await sbRpc('ops_err_ingest', { p_items: P.items, p_meta: { ...P.meta, x: P.dropped } }, { timeoutMs: 4000, retries: 0 }); }
    catch (e) {
      // нет ops.sql: экземпляр 5 минут не спрашивает базу, браузерам — молчать час (после запуска файла отчёты пойдут в течение часа)
      if (missingSql(e)) { warnOnce('sql', 'ops.sql не применён (ops_err_ingest не найдена) — ошибки не записываются'); blockedUntil = now + 300e3; return send(res, 200, { ok: 0, stop: 3600 }); }
      warnOnce('db:' + String(e?.message || e).slice(0, 60), 'база не приняла отчёт:', String(e?.message || e).slice(0, 160));
      blockedUntil = now + 120e3;
      return send(res, 200, { ok: 0, stop: 900 });
    }
    if (out && out.stop > 0) { const s = Math.min(3600, Math.ceil(+out.stop) || 3600); blockedUntil = now + s * 1000; return send(res, 200, { ok: 0, stop: Math.min(86400, Math.ceil(+out.stop) || 3600) }); }
    const reply = { ok: out && out.ok ? 1 : 0 };
    if (out && typeof out.rate === 'number' && out.rate >= 0 && out.rate <= 1) reply.rate = out.rate;
    return send(res, 200, reply);
  } catch (e) {
    try { send(res, 200, { ok: 0, stop: 600 }); } catch (x) {}
  }
}

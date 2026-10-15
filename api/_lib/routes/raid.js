// api/_lib/routes/raid.js — POST /api/raid (rewrite в vercel.json → api/pages.js?page=raid): итог набега (docs/RAIDS.md).
// Браузер присылает только ВВОД боя { id, token, inputs } (или sendBeacon при закрытии вкладки). Сервер:
//   1) raid_load (service_role) — снимок базы, армия, зерно, цифры каталога — по жетону набега (HMAC, его выдал raid_start);
//   2) прогоняет ТОТ ЖЕ бой, что был в браузере (api/_lib/raid-sim.js), — ввод проверяется по правилам боя;
//   3) по часам: бой длиной N шагов нельзя сдать раньше, чем через N/20 с после начала (raid_go), минус 5 с на связь;
//   4) raid_settle (только service_role) — добыча, кубки, щит, журнал одной транзакцией; повторный вызов отдаёт тот же итог.
// Итог в браузере — только картинка: засчитывается то, что посчитал сервер. Нет ключей Supabase в Vercel — { reason: 'off' }.
import { storeConfigured, sbRpc } from '../store.js';
import { makeRaidSim } from '../raid-sim.js';

const S = makeRaidSim();
const ID_RE = /^r[0-9a-f]{20}$/, TOKEN_RE = /^[0-9a-f]{64}$/;
const missingSql = e => /PGRST202|Could not find the function|HTTP 404/i.test(String(e?.message || e));

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
async function bodyJson(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  let raw = typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : '';
  if (!raw && typeof req.on === 'function') {
    raw = await new Promise(resolve => { let s = ''; req.on('data', c => { s += c; if (s.length > 65536) resolve(''); }); req.on('end', () => resolve(s)); req.on('error', () => resolve('')); });
  }
  try { return raw && raw.length <= 65536 ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
const ipOf = req => String(req.headers?.['x-real-ip'] || String(req.headers?.['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);

// Форма запроса — до похода в базу
export function check(body) {
  if (!body || typeof body !== 'object') return 'shape';
  if (!ID_RE.test(String(body.id || ''))) return 'id';
  if (!TOKEN_RE.test(String(body.token || ''))) return 'token';
  if (!Array.isArray(body.inputs) || body.inputs.length > 400) return 'shape';
  return null;
}

// Пересчёт и итог. rpc — вызов базы (в тестах — подмена)
export async function settle(body, ip = '', rpc = sbRpc) {
  const bad = check(body);
  if (bad) return { ok: false, reason: bad };
  let L;
  try { L = await rpc('raid_load', { p_id: body.id, p_token: body.token }); }
  catch (e) { return { ok: false, reason: missingSql(e) ? 'nosql' : 'db' }; }
  if (!L?.ok) return { ok: false, reason: L?.reason || 'token' };
  if (L.status === 'done') return { ...(L.result || {}), ok: true, again: true };
  if (L.status !== 'active') return { ok: false, reason: L.status, result: L.result || null };
  const defs = L.defs;
  const layout = L.layout ?? S.bot(L.lvl, defs, L.variant | 0);
  if (!defs?.raid || !Array.isArray(layout)) return { ok: false, reason: 'db' };
  const r = S.run({ defs, layout, army: L.army || {}, hero: L.hero | 0, seed: L.seed | 0 }, body.inputs);
  if (!r.ok) return { ok: false, reason: 'bad_input', why: r.reason, at: r.at ?? null };
  if (r.deployed > 0) {
    if (!L.go_at) return { ok: false, reason: 'nogo' };
    const lag = r.ticks / defs.raid.tps - (L.now - L.go_at) - 5;
    if (lag > 0) return { ok: false, reason: 'early', wait: Math.ceil(lag) };
  }
  const res = { ver: r.ver, stars: r.stars, pct: r.pct, th: r.th, ticks: r.ticks, why: r.why, destroyed: r.destroyed, used: r.used, hero: r.hero };
  let out;
  try { out = await rpc('raid_settle', { p_id: body.id, p_token: body.token, p_res: res, p_inputs: body.inputs, p_ip: ip || '' }); }
  catch (e) { return { ok: false, reason: missingSql(e) ? 'nosql' : 'db' }; }
  return { ...(out || { ok: false, reason: 'db' }), sim: { stars: r.stars, pct: r.pct, ticks: r.ticks } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'method' });
  if (!storeConfigured()) return send(res, 200, { ok: false, reason: 'off' });
  const body = await bodyJson(req);
  return send(res, 200, await settle(body, ipOf(req)));
}

export const _test = { check, settle, bodyJson, ipOf };

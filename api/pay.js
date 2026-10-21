// api/pay.js — оплата 💎 кристаллов картой. ОДНА функция на всё (тариф Vercel Hobby — не больше 12 функций):
//   GET  /api/pay?a=config            — какие способы оплаты включены (без секретов) → магазин #/shop
//   POST /api/pay?a=order             — заказ: {pack, method, consent} + вход (Bearer токен Supabase) → как платить
//   POST /api/pay?a=tiptop&n=<тип>    — уведомления TipTop Pay: check | pay | fail | confirm | refund | cancel
//   POST /api/pay?a=freedom           — результат оплаты Freedom Pay (pg_result_url)
// Начисляет только база (premium.sql: premium_credit / premium_refund под service-ключом) и только после проверки
// подписи; один и тот же платёж второй раз не начисляется, сумма и валюта сверяются с заказом.
// Нет ключей провайдера в Vercel — способ выключен; нет premium.sql — заказы не создаются, магазин пишет «скоро».
// Провайдеры и переменные — api/_lib/pay.js; пошагово для владельца — docs/PAYMENTS_SETUP.md.
import { storeConfigured, sbRpc, timedFetch } from './_lib/store.js';
import {
  payConfig, publicMethods, readRaw, parseFields, pick, tiptopVerify, tiptopWidget, TIPTOP_KEEP, isTestFlag,
  freedomVerify, freedomReply, freedomInit, FREEDOM_KEEP, FREEDOM_SCRIPT,
} from './_lib/pay.js';

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const missingSql = e => /PGRST202|Could not find the function|HTTP 404/i.test(String(e?.message || e));

// Кто делает заказ: токен входа проверяет сам Supabase
async function userFromToken(req) {
  const auth = String(req.headers?.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.length > 4096) return null;
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const r = await timedFetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } }, { timeoutMs: 6000, retries: 0 });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === 'string' ? u.id : null;
  } catch (e) { return null; }
}

async function bodyJson(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = await readRaw(req);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

// ── Заказ ──
async function handleOrder(req, res, cfg) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, reason: 'method' });
  if (!cfg.any || !storeConfigured()) return send(res, 200, { ok: false, reason: 'off' });
  const body = await bodyJson(req);
  const method = String(body.method || ''), pack = String(body.pack || '');
  if (!['tiptop', 'freedom', 'kaspi'].includes(method) || !cfg[method]) return send(res, 200, { ok: false, reason: 'method' });
  if (body.consent !== true) return send(res, 200, { ok: false, reason: 'consent' });
  if (body.pd !== true) return send(res, 200, { ok: false, reason: 'pd' });   // согласие на обработку персональных данных (22.10)
  const uid = await userFromToken(req);
  if (!uid) return send(res, 401, { ok: false, reason: 'auth' });
  let o;
  try {
    // возраст (до 14 — нельзя, год не указан — сначала указать) и лимиты проверяет база: premium_order_create → premium_pay_age
    o = await sbRpc('premium_order_create', { p_user: uid, p_pack: pack, p_provider: method, p_currency: cfg.currency, p_consent: true, p_pd: true });
  } catch (e) {
    return send(res, 200, { ok: false, reason: missingSql(e) ? 'off' : 'db' });
  }
  if (!o?.ok) return send(res, 200, o || { ok: false, reason: 'db' });
  let pay;
  if (method === 'tiptop') pay = tiptopWidget(o);
  else if (method === 'freedom') {
    let r;
    try { r = await freedomInit(o); } catch (e) { r = { ok: false, error: String(e?.message || e).slice(0, 160) }; }
    if (!r.ok) {
      try { await sbRpc('premium_order_fail', { p_order: o.order, p_reason: 'init: ' + r.error }); } catch (e) {}
      console.error('[pay] freedom init', r.error);
      return send(res, 200, { ok: false, reason: 'provider' });
    }
    pay = { type: 'redirect', url: r.url };
  } else {
    pay = { type: 'manual', link: process.env.KASPI_PAY_LINK };
  }
  return send(res, 200, { ok: true, order: o.order, pack: o.pack, gems: o.gems, amount: o.amount, currency: o.currency, pay });
}

// ── TipTop Pay: ответ — {"code":0}; для check: 10 — нет заказа, 11 — не тот плательщик, 12 — не та сумма, 13 — нельзя ──
async function handleTiptop(req, res, cfg, n) {
  const secret = process.env.TIPTOP_API_SECRET || '';
  if (!cfg.tiptop || !storeConfigured()) return send(res, 503, { code: 13 });
  const raw = await readRaw(req);
  const f = parseFields(req, raw);
  if (!tiptopVerify(req.headers, raw, f, secret)) {
    console.error('[pay] tiptop: подпись не сошлась', n);
    return send(res, 401, { code: 13 });
  }
  const order = String(f.InvoiceId || ''), test = isTestFlag(f.TestMode);
  try {
    if (n === 'check') {
      const o = order ? await sbRpc('premium_order_get', { p_order: order }) : null;
      if (!o) return send(res, 200, { code: 10 });
      if (o.status !== 'new' && o.status !== 'failed') return send(res, 200, { code: 13 });
      if (o.provider !== 'tiptop' || Number(f.Amount) !== Number(o.amount) || String(f.Currency || '').toUpperCase() !== o.currency) return send(res, 200, { code: 12 });
      if (f.AccountId && String(f.AccountId) !== String(o.user_id)) return send(res, 200, { code: 11 });
      return send(res, 200, { code: 0 });
    }
    if (n === 'pay' || n === 'confirm') {
      // Двухстадийная оплата (Authorized) зачисляется только после Confirm; у нас одностадийная — Completed
      if (n === 'pay' && String(f.Status || '') === 'Authorized') return send(res, 200, { code: 0 });
      const r = await sbRpc('premium_credit', {
        p_provider: 'tiptop', p_payment_id: String(f.TransactionId || ''), p_order: order,
        p_amount: Number(f.Amount), p_currency: String(f.Currency || ''), p_test: test, p_raw: pick(f, TIPTOP_KEEP),
      });
      if (!['credited', 'extra', 'duplicate'].includes(r?.status)) console.error('[pay] tiptop pay:', JSON.stringify(r));
      return send(res, 200, { code: 0 });
    }
    if (n === 'fail') {
      if (order) await sbRpc('premium_order_fail', { p_order: order, p_reason: String(f.Reason || f.ReasonCode || 'fail') });
      return send(res, 200, { code: 0 });
    }
    if (n === 'refund') {
      const r = await sbRpc('premium_refund', {
        p_provider: 'tiptop', p_payment_id: String(f.PaymentTransactionId || ''), p_refund_id: String(f.TransactionId || ''),
        p_amount: f.Amount != null && f.Amount !== '' ? Number(f.Amount) : null,
      });
      if (!['refunded', 'duplicate', 'already'].includes(r?.status)) console.error('[pay] tiptop refund:', JSON.stringify(r));
      return send(res, 200, { code: 0 });
    }
    return send(res, 200, { code: 0 });   // cancel, recurrent и прочее — принять
  } catch (e) {
    // База недоступна — TipTop повторит уведомление позже (до 100 раз); check — отказ, человек попробует снова
    console.error('[pay] tiptop', n, String(e?.message || e));
    return n === 'check' ? send(res, 200, { code: 13 }) : send(res, 500, { code: 13 });
  }
}

// ── Freedom Pay: результат оплаты, ответ — XML с подписью ──
async function handleFreedom(req, res, cfg) {
  const secret = process.env.FREEDOM_SECRET_KEY || '';
  const xml = (status, text) => send(res, 200, freedomReply(FREEDOM_SCRIPT, status, text, secret), 'application/xml; charset=utf-8');
  if (!cfg.freedom || !storeConfigured()) return send(res, 503, 'off', 'text/plain; charset=utf-8');
  const raw = await readRaw(req);
  let f = parseFields(req, raw);
  if (!f.pg_sig) { f = { ...(req.query || {}) }; delete f.a; }   // пришло GET-запросом — поля в адресе (наш «a» не подписан)
  if (!freedomVerify(FREEDOM_SCRIPT, f, secret)) {
    console.error('[pay] freedom: подпись не сошлась');
    return xml('error', 'Неверная подпись');
  }
  const order = String(f.pg_order_id || ''), test = isTestFlag(f.pg_testing_mode);
  try {
    if (String(f.pg_result) !== '1') {
      if (order) await sbRpc('premium_order_fail', { p_order: order, p_reason: 'pg_result=' + f.pg_result });
      return xml('ok', 'Принято');
    }
    const r = await sbRpc('premium_credit', {
      p_provider: 'freedom', p_payment_id: String(f.pg_payment_id || ''), p_order: order,
      p_amount: Number(f.pg_amount), p_currency: String(f.pg_currency || ''), p_test: test, p_raw: pick(f, FREEDOM_KEEP),
    });
    if (['credited', 'extra', 'duplicate'].includes(r?.status)) return xml('ok', 'Заказ оплачен');
    console.error('[pay] freedom:', JSON.stringify(r));
    // Сумма/заказ не сошлись — если можно, отказываемся (деньги вернутся покупателю), иначе — разберёт админ
    return String(f.pg_can_reject) === '1' ? xml('rejected', 'Заказ не найден или сумма не совпала') : xml('ok', 'Принято, проверим вручную');
  } catch (e) {
    console.error('[pay] freedom', String(e?.message || e));
    return send(res, 500, 'retry', 'text/plain; charset=utf-8');   // Freedom повторит позже
  }
}

export default async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url || '/', 'http://x').searchParams);
  const a = String(q.a || '');
  const cfg = payConfig();
  try {
    if (a === 'config') {
      const on = storeConfigured();
      return send(res, 200, { ok: true, currency: cfg.currency, methods: on ? publicMethods(cfg) : [] });
    }
    if (a === 'order') return await handleOrder(req, res, cfg);
    if (a === 'tiptop') return await handleTiptop(req, res, cfg, String(q.n || ''));
    if (a === 'freedom') return await handleFreedom(req, res, cfg);
    return send(res, 404, { ok: false, reason: 'not_found' });
  } catch (e) {
    console.error('[pay]', String(e?.message || e));
    return send(res, 500, { ok: false, reason: 'server' });
  }
}

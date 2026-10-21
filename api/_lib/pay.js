// api/_lib/pay.js — оплата 💎 картой: провайдеры, подписи, запросы (для api/pay.js). Без npm — только node:crypto.
//
// Провайдеры (включаются переменными окружения Vercel; нет переменных — способа нет, магазин пишет «скоро»):
//   TipTop Pay (Казахстан; до 2023 — CloudPayments Kazakhstan) — виджет на странице магазина, уведомления Check/Pay/
//     Fail/Refund на /api/pay?a=tiptop&n=<тип>. Подпись уведомления: HMAC-SHA256 тела ключом API Secret, base64 —
//     заголовок Content-HMAC (тело как пришло) и X-Content-HMAC (тело с раскодированными значениями).
//     TIPTOP_PUBLIC_ID (Public ID / publicTerminalId), TIPTOP_API_SECRET (API Secret).
//   Freedom Pay (бывший PayBox.money) — init_payment.php → переход на страницу оплаты, результат на /api/pay?a=freedom.
//     Подпись pg_sig: md5(«имя скрипта;значения по алфавиту имён;секретный ключ»); имя скрипта у входящего —
//     последняя часть пути нашего адреса (pay). FREEDOM_MERCHANT_ID, FREEDOM_SECRET_KEY; FREEDOM_TEST=1 — тестовый режим.
//   Kaspi — открытого API для сайтов нет: заказ + ссылка на оплату в Kaspi (KASPI_PAY_LINK), админ подтверждает вручную.
// Общие: PAY_CURRENCY (KZT по умолчанию; RUB — только если провайдер его принимает), PAY_DISABLED=1 — выключить всё,
// PAY_SITE_URL (по умолчанию https://dan4ik37.vercel.app). Плюс SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (уже есть).
// 22.10.2026 (владелец: «пока только для Kaspi»): карты (TipTop Pay, Freedom Pay) выключены, даже если ключи заданы, —
// включаются только переменной PAY_CARDS=1 (код и тесты остаются).
import crypto from 'node:crypto';

export const SITE_URL = (env = process.env) => (env.PAY_SITE_URL || 'https://dan4ik37.vercel.app').replace(/\/+$/, '');
export const TIPTOP_WIDGET = 'https://widget.tiptoppay.kz/bundles/widget.js';

// ── Что включено ──
export function payConfig(env = process.env) {
  const off = env.PAY_DISABLED === '1';
  const cards = env.PAY_CARDS === '1';
  const cfg = {
    tiptop: !off && cards && !!(env.TIPTOP_PUBLIC_ID && env.TIPTOP_API_SECRET),
    freedom: !off && cards && !!(env.FREEDOM_MERCHANT_ID && env.FREEDOM_SECRET_KEY),
    kaspi: !off && /^https:\/\/\S+$/.test(env.KASPI_PAY_LINK || ''),
    currency: String(env.PAY_CURRENCY || 'KZT').toUpperCase() === 'RUB' ? 'RUB' : 'KZT',
  };
  cfg.any = cfg.tiptop || cfg.freedom || cfg.kaspi;
  return cfg;
}

// Для магазина: только включённые способы, без секретов
export function publicMethods(cfg) {
  const m = [];
  if (cfg.tiptop) m.push({ id: 'tiptop', title: 'Банковской картой', note: 'TipTop Pay: Visa, Mastercard, Apple Pay, Google Pay' });
  if (cfg.freedom) m.push({ id: 'freedom', title: cfg.tiptop ? 'Картой через Freedom Pay' : 'Банковской картой', note: 'Freedom Pay: Visa, Mastercard' });
  if (cfg.kaspi) m.push({ id: 'kaspi', title: 'Kaspi', note: 'Оплата в приложении Kaspi.kz, кристаллы — после проверки (обычно в течение дня)' });
  return m;
}

// Сравнение подписей без утечки по времени
export function safeEq(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── Тело запроса ──
// Сырое тело нужно для подписи TipTop. Помощники Vercel могли уже прочитать поток и отдать разобранный req.body —
// тогда остаётся проверка по X-Content-HMAC (раскодированные значения, порядок полей тот же).
export async function readRaw(req, timeoutMs = 4000) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (req.readable && !req.readableEnded && typeof req.on === 'function') {
    const raw = await new Promise(resolve => {
      const chunks = [];
      const t = setTimeout(() => resolve(null), timeoutMs);
      req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on('end', () => { clearTimeout(t); resolve(Buffer.concat(chunks).toString('utf8')); });
      req.on('error', () => { clearTimeout(t); resolve(null); });
    });
    if (raw !== null && raw !== '') return raw;
  }
  const b = req.body;
  if (typeof b === 'string') return b;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  return null;
}

const decodeQ = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); } };

// Поля запроса: из сырого тела (форма или JSON) или из req.body, который уже разобрал Vercel
export function parseFields(req, raw) {
  const type = String(req.headers?.['content-type'] || '').toLowerCase();
  if (raw != null && raw !== '') {
    const t = raw.trim();
    if (type.includes('json') || t.startsWith('{')) { try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
    const o = {};
    for (const part of raw.split('&')) {
      if (!part) continue;
      const i = part.indexOf('=');
      const k = decodeQ(i < 0 ? part : part.slice(0, i)), v = i < 0 ? '' : decodeQ(part.slice(i + 1));
      if (!(k in o)) o[k] = v;
    }
    return o;
  }
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    const o = {};
    for (const [k, v] of Object.entries(b)) o[k] = Array.isArray(v) ? String(v[0]) : (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
    return o;
  }
  return {};
}

// Только нужные поля — номера карт, почту, телефоны и IP в базу не пишем
export function pick(obj, keys) {
  const o = {};
  for (const k of keys) if (obj[k] != null && obj[k] !== '') o[k] = String(obj[k]).slice(0, 120);
  return o;
}

// ═══ TipTop Pay ═══
export function tiptopSign(data, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(data), 'utf8').digest('base64');
}
// Подлинность уведомления: Content-HMAC — по телу как пришло; X-Content-HMAC — по телу с раскодированными значениями
export function tiptopVerify(headers, raw, fields, secret) {
  if (!secret) return false;
  const h1 = headers?.['content-hmac'], h2 = headers?.['x-content-hmac'];
  if (raw != null && raw !== '') {
    if (h1 && safeEq(h1, tiptopSign(raw, secret))) return true;
    if (h2) {
      const decoded = raw.trim().startsWith('{') ? raw : raw.split('&').map(p => p.split('=').map(decodeQ).join('=')).join('&');
      if (safeEq(h2, tiptopSign(decoded, secret))) return true;
    }
    return false;
  }
  if (h2 && fields && typeof fields === 'object') {
    const decoded = Object.entries(fields).map(([k, v]) => k + '=' + v).join('&');
    return safeEq(h2, tiptopSign(decoded, secret));
  }
  return false;
}
export const TIPTOP_KEEP = ['TransactionId', 'PaymentTransactionId', 'Amount', 'Currency', 'PaymentAmount', 'PaymentCurrency', 'DateTime',
  'Status', 'OperationType', 'InvoiceId', 'AccountId', 'TestMode', 'CardType', 'Reason', 'ReasonCode'];
export const isTestFlag = v => /^(1|true)$/i.test(String(v ?? ''));

// Параметры виджета (страница магазина: new tiptop.Widget().start(params))
export function tiptopWidget(order, env = process.env) {
  return {
    type: 'widget', script: TIPTOP_WIDGET,
    params: {
      publicTerminalId: env.TIPTOP_PUBLIC_ID,
      description: `${order.gems} кристаллов на сайте dan4ik37 (заказ ${order.order})`,
      paymentSchema: 'Single',
      currency: order.currency,
      amount: Number(order.amount),
      externalId: order.order,
      culture: 'ru-RU',
      userInfo: { accountId: String(order.user) },
      metadata: { pack: order.pack },
    },
  };
}

// ═══ Freedom Pay ═══
export function freedomSig(script, params, secret) {
  const keys = Object.keys(params).filter(k => k !== 'pg_sig').sort();
  const str = [script, ...keys.map(k => (params[k] == null ? '' : String(params[k]))), String(secret)].join(';');
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}
export function freedomVerify(script, params, secret) {
  return !!secret && !!params?.pg_sig && safeEq(String(params.pg_sig).toLowerCase(), freedomSig(script, params, secret));
}
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Ответ на уведомление: XML с подписью (имя скрипта — наш адрес, pay)
export function freedomReply(script, status, description, secret, salt = crypto.randomBytes(8).toString('hex')) {
  const r = { pg_status: status, pg_description: description, pg_salt: salt };
  r.pg_sig = freedomSig(script, r, secret);
  return `<?xml version="1.0" encoding="utf-8"?>\n<response><pg_status>${xmlEsc(r.pg_status)}</pg_status><pg_description>${xmlEsc(r.pg_description)}</pg_description><pg_salt>${xmlEsc(r.pg_salt)}</pg_salt><pg_sig>${r.pg_sig}</pg_sig></response>`;
}
// Плоский XML ответа init_payment.php → объект
export function parseXmlFlat(xml) {
  const o = {};
  const re = /<(pg_[a-z0-9_]+)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) o[m[1]] = m[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim();
  return o;
}
export const FREEDOM_KEEP = ['pg_payment_id', 'pg_order_id', 'pg_amount', 'pg_currency', 'pg_net_amount', 'pg_ps_amount', 'pg_ps_currency',
  'pg_result', 'pg_payment_date', 'pg_testing_mode', 'pg_payment_method', 'pg_card_brand', 'pg_can_reject'];
export const FREEDOM_SCRIPT = 'pay';   // последняя часть пути адреса уведомлений /api/pay?a=freedom
const FREEDOM_HOST = /^https:\/\/([a-z0-9-]+\.)*(freedompay\.(kz|kg|uz|money)|paybox\.money)(\/|$)/i;

// Создать платёж и получить ссылку на страницу оплаты
export async function freedomInit(order, env = process.env, fetchImpl = fetch) {
  const api = (env.FREEDOM_API_URL || 'https://api.freedompay.kz').replace(/\/+$/, '');
  const site = SITE_URL(env);
  const params = {
    pg_order_id: order.order,
    pg_merchant_id: String(env.FREEDOM_MERCHANT_ID),
    pg_amount: String(Number(order.amount)),
    pg_currency: order.currency,
    pg_description: `${order.gems} кристаллов на сайте dan4ik37`,
    pg_salt: crypto.randomBytes(8).toString('hex'),
    pg_result_url: `${site}/api/pay?a=freedom`,
    pg_request_method: 'POST',
    pg_success_url: `${site}/shop?o=${encodeURIComponent(order.order)}&r=ok`,
    pg_failure_url: `${site}/shop?o=${encodeURIComponent(order.order)}&r=fail`,
    pg_language: 'ru',
    pg_lifetime: '3600',
    pg_user_id: String(order.user),
    pg_testing_mode: env.FREEDOM_TEST === '1' ? '1' : '0',
  };
  params.pg_sig = freedomSig('init_payment.php', params, env.FREEDOM_SECRET_KEY);
  const r = await fetchImpl(api + '/init_payment.php', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
  });
  const res = parseXmlFlat(await r.text());
  if (res.pg_status !== 'ok' || !FREEDOM_HOST.test(res.pg_redirect_url || '')) {
    return { ok: false, error: (res.pg_error_description || res.pg_description || 'HTTP ' + r.status).slice(0, 160) };
  }
  return { ok: true, type: 'redirect', url: res.pg_redirect_url, paymentId: res.pg_payment_id || '' };
}

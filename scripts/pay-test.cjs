// Тест оплаты 💎 (api/pay.js + api/_lib/pay.js): подписи TipTop Pay / Freedom Pay на известных векторах, вебхуки,
// повтор уведомления (без второго начисления), чужая сумма/валюта, выключенный режим (нет ключей / нет premium.sql),
// сверка пакетов api/_lib/premium.js = js/core/premium.js = premium.sql.
// База — в памяти (повторяет логику premium.sql: идемпотентность по платежу, сверка суммы и валюты);
// сам premium.sql проверяется отдельно на PGlite. Запуск: node scripts/pay-test.cjs
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), vm = require('vm');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log(c ? '✓' : '✗', m, !c && x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); };

// api/ — во временную папку с {"type":"module"}, как на Vercel (ESM)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-pay-'));
fs.cpSync(path.join(ROOT, 'api'), path.join(TMP, 'api'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');

const SB = 'https://sb.example.co', SRV = 'service-key-test';
const TT_PUB = 'pk_test_tiptop', TT_SECRET = 'tiptop-api-secret-тест', FP_ID = '549', FP_SECRET = 'freedom-secret';
const U1 = '11111111-1111-1111-1111-111111111111';

// ═══ База в памяти (как premium.sql) ═══
const PACKS = { p100: [100, 100, 590], p300: [300, 300, 1770], p550: [550, 500, 2950], p1200: [1200, 1000, 5900], p2600: [2600, 2000, 11800] };
const DB = { orders: {}, payments: {}, balance: {}, sqlMissing: false, calls: [] };
let seq = 0;
function rpc(fn, a) {
  DB.calls.push(fn);
  if (DB.sqlMissing) return [404, { code: 'PGRST202', message: 'Could not find the function public.' + fn }];
  if (fn === 'premium_order_create') {
    const p = PACKS[a.p_pack];
    if (!p) return [200, { ok: false, reason: 'pack' }];
    if (a.p_consent !== true) return [200, { ok: false, reason: 'consent' }];
    const id = 'D37-251015-' + String(++seq).padStart(8, '0');
    const amount = a.p_currency === 'RUB' ? p[1] : p[2];
    DB.orders[id] = { id, user_id: a.p_user, pack: a.p_pack, gems: p[0], amount, currency: a.p_currency, rub: p[1], provider: a.p_provider, status: 'new' };
    return [200, { ok: true, order: id, pack: a.p_pack, gems: p[0], amount, currency: a.p_currency, user: a.p_user }];
  }
  if (fn === 'premium_order_get') return [200, DB.orders[a.p_order] || null];
  if (fn === 'premium_order_fail') { const o = DB.orders[a.p_order]; if (o && o.status === 'new') o.status = 'failed'; return [200, { status: 'ok' }]; }
  if (fn === 'premium_credit') {
    const k = a.p_provider + ':' + a.p_payment_id;
    if (DB.payments[k]) return [200, { status: 'duplicate', was: DB.payments[k].status }];
    const o = DB.orders[a.p_order];
    if (!o) { DB.payments[k] = { status: 'no_order' }; return [200, { status: 'no_order' }]; }
    if (o.provider !== a.p_provider || Math.round(a.p_amount * 100) !== Math.round(o.amount * 100) || String(a.p_currency).toUpperCase() !== o.currency) {
      DB.payments[k] = { status: 'mismatch' }; return [200, { status: 'mismatch' }];
    }
    const st = o.status === 'paid' ? 'extra' : 'credited';
    DB.payments[k] = { status: st, order: o.id, amount: a.p_amount, test: a.p_test, raw: a.p_raw };
    DB.balance[o.user_id] = (DB.balance[o.user_id] || 0) + o.gems;
    o.status = 'paid';
    return [200, { status: st, gems: o.gems, balance: DB.balance[o.user_id] }];
  }
  if (fn === 'premium_refund') {
    const pay = DB.payments[a.p_provider + ':' + a.p_payment_id];
    if (!pay || !['credited', 'extra'].includes(pay.status)) return [200, { status: 'no_payment' }];
    const rk = a.p_provider + ':refund:' + a.p_refund_id;
    if (DB.payments[rk]) return [200, { status: 'duplicate' }];
    DB.payments[rk] = { status: 'refund' };
    const o = DB.orders[pay.order];
    DB.balance[o.user_id] -= o.gems; o.status = 'refunded';
    return [200, { status: 'refunded', gems: o.gems }];
  }
  return [404, { code: 'PGRST202' }];
}

// ═══ Подмена сети: Supabase, проверка входа, Freedom init_payment ═══
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
let lastInit = null;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const resp = (status, body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': type } });
  if (u.startsWith(SB + '/rest/v1/rpc/')) {
    if (opts.headers?.apikey !== SRV) return resp(401, { message: 'no key' });
    const [st, body] = rpc(u.slice((SB + '/rest/v1/rpc/').length), JSON.parse(opts.body || '{}'));
    return resp(st, body);
  }
  if (u === SB + '/auth/v1/user') {
    return opts.headers?.Authorization === 'Bearer good-token' ? resp(200, { id: U1 }) : resp(401, { message: 'bad jwt' });
  }
  if (u === 'https://api.freedompay.kz/init_payment.php') {
    const p = Object.fromEntries(new URLSearchParams(opts.body));
    lastInit = p;
    const keys = Object.keys(p).filter(k => k !== 'pg_sig').sort();
    const good = md5(['init_payment.php', ...keys.map(k => p[k]), FP_SECRET].join(';')) === p.pg_sig;
    if (!good) return resp(200, '<response><pg_status>error</pg_status><pg_error_code>9998</pg_error_code><pg_error_description>Некорректная подпись</pg_error_description></response>', 'text/xml');
    return resp(200, `<?xml version="1.0" encoding="utf-8"?><response><pg_status>ok</pg_status><pg_payment_id>777001</pg_payment_id>
      <pg_redirect_url>https://customer.freedompay.kz/pay.html?customer=abc&amp;x=1</pg_redirect_url><pg_redirect_url_type>need data</pg_redirect_url_type>
      <pg_salt>s1</pg_salt><pg_sig>x</pg_sig></response>`, 'text/xml');
  }
  throw new Error('неожиданный запрос: ' + u);
};

// Запрос/ответ как у Vercel. parsed — тело уже разобрано помощниками Vercel (поток прочитан)
function mkReq({ method = 'POST', query = {}, headers = {}, body = '', parsed }) {
  const r = Readable.from(body ? [Buffer.from(body, 'utf8')] : []);
  r.method = method; r.query = query; r.url = '/api/pay?' + new URLSearchParams(query);
  r.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  if (parsed !== undefined) { r.body = parsed; r.resume(); r.push(null); }
  return r;
}
function mkRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = b => { res.body = b == null ? '' : String(b); res.done = true; };
  res.json = () => JSON.parse(res.body);
  return res;
}
const form = o => new URLSearchParams(o).toString();
const hmac = (data, key) => crypto.createHmac('sha256', key).update(data, 'utf8').digest('base64');

(async () => {
  const P = await import(pathToFileURL(path.join(TMP, 'api/_lib/pay.js')).href);
  const { default: handler } = await import(pathToFileURL(path.join(TMP, 'api/pay.js')).href);
  const call = async opts => { const res = mkRes(); await handler(mkReq(opts), res); return res; };
  const settle = () => new Promise(r => setTimeout(r, 20));

  // ═══ Известные векторы ═══
  ok(Buffer.from(P.tiptopSign('The quick brown fox jumps over the lazy dog', 'key'), 'base64').toString('hex') ===
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'HMAC-SHA256: вектор из RFC/Википедии');
  const body0 = 'TransactionId=1&Amount=10.00&Currency=KZT&Data=%7B%22a%22%3A%22%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%2B1%22%7D';
  ok(P.tiptopSign(body0, TT_SECRET) === hmac(body0, TT_SECRET), 'TipTop: подпись тела = HMAC-SHA256 ключом API Secret, base64');
  ok(P.tiptopVerify({ 'content-hmac': hmac(body0, TT_SECRET) }, body0, {}, TT_SECRET), 'TipTop: Content-HMAC по сырому телу');
  const dec0 = 'TransactionId=1&Amount=10.00&Currency=KZT&Data={"a":"привет +1"}';
  ok(P.tiptopVerify({ 'x-content-hmac': hmac(dec0, TT_SECRET) }, body0, {}, TT_SECRET), 'TipTop: X-Content-HMAC по раскодированному телу');
  ok(P.tiptopVerify({ 'x-content-hmac': hmac(dec0, TT_SECRET) }, null, { TransactionId: '1', Amount: '10.00', Currency: 'KZT', Data: '{"a":"привет +1"}' }, TT_SECRET),
    'TipTop: X-Content-HMAC по уже разобранным полям (тело прочитал Vercel)');
  ok(!P.tiptopVerify({ 'content-hmac': hmac(body0, 'другой ключ') }, body0, {}, TT_SECRET), 'TipTop: чужой ключ — не проходит');
  ok(!P.tiptopVerify({ 'content-hmac': hmac(body0, TT_SECRET) }, body0.replace('10.00', '1.00'), {}, TT_SECRET), 'TipTop: тело подменили — не проходит');
  ok(!P.tiptopVerify({}, body0, {}, TT_SECRET), 'TipTop: без подписи — не проходит');
  ok(md5('The quick brown fox jumps over the lazy dog') === '9e107d9d372bb6826bd81d3542a419d6', 'MD5: известный вектор');
  // Пример из документации Freedom Pay: init_payment.php;25;test;{merchant_id};23;molbulak;{secret_key}
  ok(P.freedomSig('init_payment.php', { pg_order_id: '23', pg_merchant_id: '549', pg_amount: '25', pg_description: 'test', pg_salt: 'molbulak' }, 'secret')
    === md5('init_payment.php;25;test;549;23;molbulak;secret'), 'Freedom: pg_sig как в документации (поля по алфавиту)');
  const fpRes = { pg_order_id: 'D37-1', pg_payment_id: '5', pg_amount: '2950', pg_currency: 'KZT', pg_result: '1', pg_salt: 'abc' };
  fpRes.pg_sig = P.freedomSig('pay', fpRes, FP_SECRET);
  ok(P.freedomVerify('pay', fpRes, FP_SECRET), 'Freedom: входящий pg_sig проверяется (скрипт pay)');
  ok(!P.freedomVerify('pay', { ...fpRes, pg_amount: '1' }, FP_SECRET), 'Freedom: сумму подменили — не проходит');
  ok(!P.freedomVerify('result', fpRes, FP_SECRET), 'Freedom: другое имя скрипта — не проходит');
  const xr = P.freedomReply('pay', 'ok', 'Заказ оплачен', FP_SECRET, 'salt9');
  const xo = P.parseXmlFlat(xr);
  ok(xo.pg_status === 'ok' && xo.pg_sig === md5(['pay', 'Заказ оплачен', 'salt9', 'ok', FP_SECRET].join(';')), 'Freedom: наш ответ подписан (описание;соль;статус по алфавиту)');
  ok(P.parseXmlFlat('<response><pg_redirect_url>https://a.kz/?x=1&amp;y=2</pg_redirect_url></response>').pg_redirect_url === 'https://a.kz/?x=1&y=2', 'XML ответа разбирается (&amp;)');

  // ═══ Выключено: нет ключей ═══
  for (const k of ['TIPTOP_PUBLIC_ID', 'TIPTOP_API_SECRET', 'FREEDOM_MERCHANT_ID', 'FREEDOM_SECRET_KEY', 'KASPI_PAY_LINK', 'PAY_DISABLED', 'FREEDOM_TEST', 'PAY_CURRENCY']) delete process.env[k];
  process.env.SUPABASE_URL = SB; process.env.SUPABASE_SERVICE_ROLE_KEY = SRV;
  let r = await call({ method: 'GET', query: { a: 'config' } });
  ok(r.statusCode === 200 && r.json().methods.length === 0, 'без ключей: способов оплаты нет («скоро»)', r.body);
  r = await call({ query: { a: 'order' }, headers: { 'content-type': 'application/json', authorization: 'Bearer good-token' }, body: JSON.stringify({ pack: 'p100', method: 'tiptop', consent: true }) });
  ok(r.json().reason === 'off', 'без ключей: заказ не создаётся', r.body);
  r = await call({ query: { a: 'tiptop', n: 'pay' }, body: 'x=1' });
  ok(r.statusCode === 503, 'без ключей: уведомление TipTop — 503 (провайдер повторит позже)');
  r = await call({ query: { a: 'freedom' }, body: 'x=1' });
  ok(r.statusCode === 503, 'без ключей: уведомление Freedom — 503');
  r = await call({ method: 'GET', query: { a: 'zzz' } });
  ok(r.statusCode === 404, 'неизвестное действие — 404');

  // ═══ Включено ═══
  Object.assign(process.env, { TIPTOP_PUBLIC_ID: TT_PUB, TIPTOP_API_SECRET: TT_SECRET, FREEDOM_MERCHANT_ID: FP_ID, FREEDOM_SECRET_KEY: FP_SECRET,
    KASPI_PAY_LINK: 'https://pay.kaspi.kz/pay/test123' });
  r = await call({ method: 'GET', query: { a: 'config' } });
  const cfg = r.json();
  ok(cfg.methods.map(m => m.id).join() === 'tiptop,freedom,kaspi' && cfg.currency === 'KZT', 'способы: TipTop, Freedom, Kaspi; валюта KZT', cfg);
  ok(!r.body.includes(TT_SECRET) && !r.body.includes(FP_SECRET) && !r.body.includes(SRV), 'в ответе магазину нет секретов');
  delete process.env.SUPABASE_URL;
  r = await call({ method: 'GET', query: { a: 'config' } });
  ok(r.json().methods.length === 0, 'нет SUPABASE_* — способов нет (некуда начислять)');
  process.env.SUPABASE_URL = SB;

  const order = (body, token = 'good-token') => call({ query: { a: 'order' }, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  r = await order({ pack: 'p550', method: 'tiptop', consent: true }, '');
  ok(r.statusCode === 401 && r.json().reason === 'auth', 'заказ без входа — 401');
  r = await order({ pack: 'p550', method: 'tiptop', consent: true }, 'forged');
  ok(r.statusCode === 401, 'заказ с поддельным токеном — 401');
  r = await order({ pack: 'p550', method: 'tiptop', consent: false });
  ok(r.json().reason === 'consent', 'без согласия взрослого — нет заказа');
  r = await order({ pack: 'p550', method: 'stripe', consent: true });
  ok(r.json().reason === 'method', 'неизвестный способ — нет заказа');
  r = await order({ pack: 'p550', method: 'tiptop', consent: true });
  let j = r.json();
  ok(j.ok && j.pay.type === 'widget' && j.pay.params.publicTerminalId === TT_PUB && j.pay.params.amount === 2950 && j.pay.params.currency === 'KZT'
    && j.pay.params.externalId === j.order && j.pay.params.paymentSchema === 'Single' && j.pay.script === 'https://widget.tiptoppay.kz/bundles/widget.js',
    'TipTop: заказ → виджет (2950 ₸, номер заказа, одностадийная)', j);
  ok(!JSON.stringify(j).includes(TT_SECRET), 'в параметрах виджета нет API Secret');
  const O1 = j.order;

  // TipTop check / pay
  const tt = (n, fields, { secret = TT_SECRET, header = 'content-hmac', parsed } = {}) => {
    const body = form(fields);
    const sig = header === 'x-content-hmac' ? hmac(Object.entries(fields).map(([k, v]) => k + '=' + v).join('&'), secret) : hmac(body, secret);
    return call({ query: { a: 'tiptop', n }, headers: { 'content-type': 'application/x-www-form-urlencoded', [header]: sig }, body: parsed ? '' : body, parsed });
  };
  const payF = (id, extra = {}) => ({ TransactionId: id, Amount: '2950.00', Currency: 'KZT', DateTime: '2026-10-15 12:00:00', Status: 'Completed',
    OperationType: 'Payment', InvoiceId: O1, AccountId: U1, TestMode: '0', CardFirstSix: '400000', CardLastFour: '1111', Email: 'mama@example.com', ...extra });
  r = await tt('check', payF('100'));
  ok(r.json().code === 0, 'check: всё сходится → 0');
  r = await tt('check', payF('100', { Amount: '29.90' }));
  ok(r.json().code === 12, 'check: не та сумма → 12');
  r = await tt('check', payF('100', { Currency: 'RUB' }));
  ok(r.json().code === 12, 'check: не та валюта → 12');
  r = await tt('check', payF('100', { InvoiceId: 'D37-нет' }));
  ok(r.json().code === 10, 'check: нет заказа → 10');
  r = await tt('check', payF('100', { AccountId: '22222222-2222-2222-2222-222222222222' }));
  ok(r.json().code === 11, 'check: чужой плательщик → 11');
  r = await tt('check', payF('100'), { secret: 'угадал?' });
  ok(r.statusCode === 401 && r.json().code === 13, 'check: подпись не та → отказ');

  r = await tt('pay', payF('T-500'), { secret: 'взлом' });
  ok(r.statusCode === 401 && !DB.balance[U1], 'pay: поддельное уведомление — ничего не начислено');
  r = await tt('pay', payF('T-501', { Amount: '1.00' }));
  ok(r.json().code === 0 && !DB.balance[U1] && DB.payments['tiptop:T-501'].status === 'mismatch', 'pay: сумма не совпала с заказом — не начислено (видно админу)');
  r = await tt('pay', payF('T-502', { Currency: 'USD' }));
  ok(!DB.balance[U1] && DB.payments['tiptop:T-502'].status === 'mismatch', 'pay: валюта не совпала — не начислено');
  r = await tt('pay', payF('T-503', { Status: 'Authorized' }));
  ok(r.json().code === 0 && !DB.balance[U1], 'pay: двухстадийная «Authorized» — ждём Confirm');
  r = await tt('pay', payF('T-1'));
  ok(r.json().code === 0 && DB.balance[U1] === 550, 'pay: +550 💎', DB.balance);
  const raw = DB.payments['tiptop:T-1'].raw;
  ok(raw.TransactionId === 'T-1' && !raw.CardFirstSix && !raw.CardLastFour && !raw.Email, 'в базу не уходят номер карты и почта', raw);
  r = await tt('pay', payF('T-1'));
  ok(r.json().code === 0 && DB.balance[U1] === 550, 'pay: повтор того же уведомления — без второго начисления');
  r = await tt('pay', payF('T-1'), { header: 'x-content-hmac', parsed: Object.fromEntries(new URLSearchParams(form(payF('T-1')))) });
  ok(r.json().code === 0 && DB.balance[U1] === 550, 'pay: повтор (тело уже разобрано Vercel, X-Content-HMAC) — тоже без начисления');
  r = await tt('check', payF('200'));
  ok(r.json().code === 13, 'check: заказ уже оплачен → 13 (не списать дважды)');
  r = await tt('refund', { TransactionId: 'RF-1', PaymentTransactionId: 'T-1', Amount: '2950.00', InvoiceId: O1, OperationType: 'Refund' });
  ok(r.json().code === 0 && DB.balance[U1] === 0, 'refund: возврат → −550 💎');
  r = await tt('refund', { TransactionId: 'RF-1', PaymentTransactionId: 'T-1', Amount: '2950.00', InvoiceId: O1, OperationType: 'Refund' });
  ok(r.json().code === 0 && DB.balance[U1] === 0, 'refund: повтор — без второго списания');

  // X-Content-HMAC при уже разобранном теле, новый заказ
  j = (await order({ pack: 'p100', method: 'tiptop', consent: true })).json();
  const f2 = { TransactionId: 'T-2', Amount: '590', Currency: 'KZT', Status: 'Completed', InvoiceId: j.order, AccountId: U1, TestMode: '1' };
  r = await tt('pay', f2, { header: 'x-content-hmac', parsed: { ...f2 } });
  ok(r.json().code === 0 && DB.balance[U1] === 100 && DB.payments['tiptop:T-2'].test === true, 'pay: тело уже прочитал Vercel — проверка по X-Content-HMAC; тестовый платёж помечен');
  r = await tt('fail', { TransactionId: 'T-3', Amount: '590', Currency: 'KZT', InvoiceId: 'D37-нет', Reason: 'InsufficientFunds' });
  ok(r.json().code === 0, 'fail: принято');

  // База недоступна → TipTop должен повторить
  const realFetch = global.fetch;
  global.fetch = async (u, o) => String(u).includes('/rest/v1/rpc/') ? new Response('{"message":"down"}', { status: 503 }) : realFetch(u, o);
  r = await tt('pay', payF('T-9'));
  ok(r.statusCode === 500, 'pay: база недоступна → 500 (провайдер повторит уведомление)');
  r = await tt('check', payF('T-9'));
  ok(r.statusCode === 200 && r.json().code === 13, 'check: база недоступна → отказ (покупатель попробует снова)');
  global.fetch = realFetch;

  // ═══ Freedom Pay ═══
  r = await order({ pack: 'p300', method: 'freedom', consent: true });
  j = r.json();
  ok(j.ok && j.pay.type === 'redirect' && j.pay.url === 'https://customer.freedompay.kz/pay.html?customer=abc&x=1', 'Freedom: заказ → ссылка на страницу оплаты', j);
  ok(lastInit && lastInit.pg_amount === '1770' && lastInit.pg_currency === 'KZT' && lastInit.pg_order_id === j.order && lastInit.pg_merchant_id === FP_ID
    && lastInit.pg_result_url === 'https://dan4ik37.vercel.app/api/pay?a=freedom' && lastInit.pg_testing_mode === '0' && /\/shop\?o=/.test(lastInit.pg_success_url),
    'Freedom: init_payment с подписью, суммой 1770 ₸ и адресом уведомлений', lastInit);
  const O2 = j.order;
  const fp = (fields, secret = FP_SECRET) => {
    const f = { ...fields, pg_salt: 'r' + Math.random().toString(36).slice(2) };
    f.pg_sig = P.freedomSig('pay', f, secret);
    return call({ query: { a: 'freedom' }, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form(f) });
  };
  const resF = (pid, extra = {}) => ({ pg_order_id: O2, pg_payment_id: pid, pg_amount: '1770', pg_currency: 'KZT', pg_net_amount: '1716.9',
    pg_result: '1', pg_can_reject: '1', pg_testing_mode: '0', pg_card_pan: '5483-18XX-XXXX-0293', pg_user_phone: '77777777777', pg_payment_date: '2026-10-15 12:00:00', ...extra });
  const before = DB.balance[U1];
  r = await fp(resF('900'), 'не тот ключ');
  let x = P.parseXmlFlat(r.body);
  ok(x.pg_status === 'error' && DB.balance[U1] === before, 'Freedom: поддельный результат — error, не начислено');
  r = await fp(resF('901', { pg_amount: '17' }));
  x = P.parseXmlFlat(r.body);
  ok(x.pg_status === 'rejected' && DB.balance[U1] === before, 'Freedom: сумма не совпала → rejected (деньги вернутся)');
  r = await fp(resF('902'));
  x = P.parseXmlFlat(r.body);
  ok(x.pg_status === 'ok' && DB.balance[U1] === before + 300, 'Freedom: оплата → ok, +300 💎');
  ok(P.freedomVerify('pay', x, FP_SECRET), 'Freedom: наш ответ с верной подписью');
  ok(!DB.payments['freedom:902'].raw.pg_card_pan && !DB.payments['freedom:902'].raw.pg_user_phone, 'Freedom: номер карты и телефон не сохраняются');
  r = await fp(resF('902'));
  ok(P.parseXmlFlat(r.body).pg_status === 'ok' && DB.balance[U1] === before + 300, 'Freedom: повтор результата — ok, без второго начисления');
  j = (await order({ pack: 'p100', method: 'freedom', consent: true })).json();
  r = await fp({ ...resF('903'), pg_order_id: j.order, pg_amount: '590', pg_result: '0' });
  ok(P.parseXmlFlat(r.body).pg_status === 'ok' && DB.orders[j.order].status === 'failed', 'Freedom: неуспешная оплата → заказ «не оплачен»');
  r = await fp({ ...resF('904'), pg_order_id: j.order, pg_amount: '590', pg_currency: 'USD', pg_can_reject: '0' });
  ok(P.parseXmlFlat(r.body).pg_status === 'ok' && DB.payments['freedom:904'].status === 'mismatch', 'Freedom: не та валюта, отказаться нельзя → ok, но не начислено');
  process.env.FREEDOM_TEST = '1';
  await order({ pack: 'p100', method: 'freedom', consent: true });
  ok(lastInit.pg_testing_mode === '1', 'FREEDOM_TEST=1 → pg_testing_mode=1');

  // Kaspi
  j = (await order({ pack: 'p1200', method: 'kaspi', consent: true })).json();
  ok(j.ok && j.pay.type === 'manual' && j.pay.link === 'https://pay.kaspi.kz/pay/test123' && j.amount === 5900, 'Kaspi: заказ + ссылка на оплату (подтверждает админ)', j);

  // Валюта RUB, PAY_DISABLED
  process.env.PAY_CURRENCY = 'RUB';
  j = (await order({ pack: 'p100', method: 'tiptop', consent: true })).json();
  ok(j.currency === 'RUB' && j.pay.params.amount === 100, 'PAY_CURRENCY=RUB → цены в рублях', j);
  delete process.env.PAY_CURRENCY;
  process.env.PAY_DISABLED = '1';
  r = await call({ method: 'GET', query: { a: 'config' } });
  ok(r.json().methods.length === 0, 'PAY_DISABLED=1 → всё выключено');
  delete process.env.PAY_DISABLED;

  // premium.sql не выполнен
  DB.sqlMissing = true;
  r = await order({ pack: 'p100', method: 'tiptop', consent: true });
  ok(r.json().reason === 'off', 'нет premium.sql → заказ «скоро», без ошибки', r.body);
  DB.sqlMissing = false;

  // ═══ Пакеты одинаковые везде ═══
  const S = await import(pathToFileURL(path.join(TMP, 'api/_lib/premium.js')).href);
  const ctx = { document: { querySelectorAll: () => [] }, addEventListener() {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/core/premium.js'), 'utf8'), ctx);
  const canon = v => JSON.stringify(v, (k, y) => y && typeof y === 'object' && !Array.isArray(y) ? Object.fromEntries(Object.keys(y).sort().map(q => [q, y[q]])) : y);
  const sql = fs.readFileSync(path.join(ROOT, 'premium.sql'), 'utf8');
  const sqlJson = fn => JSON.parse(sql.slice(sql.indexOf(`function public.${fn}()`)).match(/select '(\[[\s\S]*?\])'::jsonb/)[1]);
  ok(canon(S.PACKS) === canon(ctx.D37Gems.CFG.packs) && canon(S.PACKS) === canon(sqlJson('premium_packs')), 'пакеты: api/_lib/premium.js = js/core/premium.js = premium.sql');
  ok(canon(S.ITEMS) === canon(ctx.D37Gems.CFG.items) && canon(S.ITEMS) === canon(sqlJson('premium_items')), 'товары за 💎: везде одинаковые');
  ok(S.PACKS.every(p => p.gems === p.rub + p.bonus), 'пакеты: 1 ₽ = 1 💎 + бонус');
  ok(S.PACKS.every((p, i) => i === 0 || p.kzt / p.gems < S.PACKS[i - 1].kzt / S.PACKS[i - 1].gems + 1e-9), 'пакеты: чем больше, тем дешевле кристалл (₸)');
  ok(ctx.D37Gems.word(1) === 'кристалл' && ctx.D37Gems.word(3) === 'кристалла' && ctx.D37Gems.word(11) === 'кристаллов' && ctx.D37Gems.word(1200) === 'кристаллов' && ctx.D37Gems.word(22) === 'кристалла',
    'склонение: кристалл / кристалла / кристаллов');

  await settle();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${n - fails}/${n} проверок${fails ? ', ОШИБОК: ' + fails : ' — всё ок'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

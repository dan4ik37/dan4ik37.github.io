// Тест входа через другие сервисы (api/_lib/social.js + api/_lib/routes/oauth.js, js/features/social-login.js) без браузера и сети:
//  • state и PKCE (вектор RFC 7636), подписи кук и билетов, шифрованный пропуск, сроки и одноразовость;
//  • «куда вернуть» — только разделы сайта; адрес возврата сервиса — точный;
//  • подпись виджета Telegram на известном векторе (посчитан отдельно, в Python), свежесть auth_date, повтор;
//  • id_token Telegram (OpenID) — RS256 и ES256 ключами, сгенерированными в тесте;
//  • включение по переменным Vercel и по auth-links.sql;
//  • маршруты целиком с подменённым fetch: VK ID и Яндекс (код → токен → профиль), Supabase (admin API, RPC), привязка со свежим входом;
//  • страница: разбор возврата (#d37auth / #d37auth_err / #d37link), «последний способ входа», какие кнопки показывать.
// База — в памяти (как auth-links.sql); сам SQL проверяется на PGlite (scratchpad pg/test-authlinks.mjs). Запуск: node scripts/auth-test.cjs
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), vm = require('vm');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
let n = 0, fails = 0;
const ok = (c, m, x) => { n++; if (!c) fails++; console.log(c ? '✓' : '✗', m, !c && x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'd37-auth-'));
fs.cpSync(path.join(ROOT, 'api'), path.join(TMP, 'api'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');

const SB = 'https://sb.example.co', SRV = 'service-key-test-0123456789abcdef', SITE = 'https://dan4ik37.vercel.app';
const VK_ID = '51234567', YA_ID = '0123456789abcdef0123456789abcdef', YA_SECRET = 'yandex-secret-0123456789';
const TG_TOKEN = '123456789:AAEhBP0av28yNUvuBYCFSYQ8wh9F2FtCU5w', TG_BOT = 'dan4ik37_bot';
const BASE_ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SRV, SITE_URL: SITE, VK_ID_CLIENT_ID: VK_ID, YANDEX_CLIENT_ID: YA_ID,
  YANDEX_CLIENT_SECRET: YA_SECRET, TELEGRAM_BOT_TOKEN: TG_TOKEN, TELEGRAM_BOT_NAME: '@' + TG_BOT };
const ENV_KEYS = [...Object.keys(BASE_ENV), 'VK_ID_SECRET', 'TELEGRAM_CLIENT_ID', 'TELEGRAM_CLIENT_SECRET', 'AUTH_SECRET'];
const setEnv = o => { for (const k of ENV_KEYS) delete process.env[k]; Object.assign(process.env, o); };
setEnv(BASE_ENV);

// ═══ База в памяти (как auth-links.sql) ═══
const DB = { links: [], bans: new Set(), once: new Set(), ip: {}, users: {}, sqlMissing: false, calls: [], deleted: [] };
const key = (p, u) => p + ':' + u;
const rpc = (fn, a) => {
  DB.calls.push(fn);
  if (DB.sqlMissing) return [404, { code: 'PGRST202', message: 'Could not find the function public.' + fn }];
  if (fn === 'auth_social_ready') return [200, true];
  if (fn === 'auth_once_use') { if (DB.once.has(a.p_key)) return [200, false]; DB.once.add(a.p_key); return [200, true]; }
  if (fn === 'auth_social_begin') {
    if (!['vk', 'yandex', 'tg'].includes(a.p_provider) || !/^[0-9A-Za-z_.:-]{1,64}$/.test(a.p_uid || '')) return [200, { ok: false, reason: 'bad' }];
    const l = DB.links.find(x => x.p === a.p_provider && x.uid === a.p_uid);
    if (l) { l.name = a.p_name; return [200, { ok: true, user: l.user, new: false }]; }
    if (DB.bans.has(key(a.p_provider, a.p_uid))) return [200, { ok: false, reason: 'banned' }];
    DB.ip[a.p_ip] = (DB.ip[a.p_ip] || 0) + 1;
    if (DB.ip[a.p_ip] > 3) return [200, { ok: false, reason: 'rate' }];
    return [200, { ok: true, create: true, new: true }];
  }
  if (fn === 'auth_social_bind') {
    // «двойной клик»: пока второй запрос создавал аккаунт, первый уже привязал этот номер
    if (DB.race && DB.race.uid === a.p_uid) { DB.links.push({ p: a.p_provider, uid: a.p_uid, user: DB.race.user, name: 'первый' }); DB.race = null; }
    const l = DB.links.find(x => x.p === a.p_provider && x.uid === a.p_uid);
    if (l) return [200, { ok: false, reason: 'race', user: l.user }];
    DB.links.push({ p: a.p_provider, uid: a.p_uid, user: a.p_user, name: a.p_name });
    return [200, { ok: true, user: a.p_user }];
  }
  if (fn === 'auth_link_add') {
    if (!(Date.parse(a.p_auth_at) > Date.now() - 30 * 60e3)) return [200, { ok: false, reason: 'reauth' }];
    if (DB.bans.has(key(a.p_provider, a.p_uid))) return [200, { ok: false, reason: 'banned' }];
    const l = DB.links.find(x => x.p === a.p_provider && x.uid === a.p_uid);
    if (l) return [200, l.user === a.p_user ? { ok: true, same: true } : { ok: false, reason: 'taken' }];
    if (DB.links.find(x => x.user === a.p_user && x.p === a.p_provider)) return [200, { ok: false, reason: 'has' }];
    DB.links.push({ p: a.p_provider, uid: a.p_uid, user: a.p_user, name: a.p_name });
    return [200, { ok: true }];
  }
  return [404, { code: 'PGRST202' }];
};

// ═══ Подмена сети: Supabase, VK ID, Яндекс, Telegram ═══
const NET = { vk: [], ya: [], tg: [], auth: [] };
let VK_USER = { user_id: 1234567, first_name: 'Иван', last_name: 'Петров', avatar: 'https://sun1-1.userapi.com/s/v1/ig2/a.jpg' };
let YA_USER = { id: '987654', login: 'ivan', first_name: 'Иван', last_name: 'Сидоров', display_name: 'ivan', default_avatar_id: '12345/abcdef-1', is_avatar_empty: false, client_id: YA_ID };
let TG_KEYS = null, TG_IDTOKEN = null, magicN = 0, uidN = 0;
const USER_TOKENS = {};   // токен вошедшего → id
function userJwt(id, ageSec) {
  const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ sub: id, role: 'authenticated', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - ageSec }], session_id: 's-' + id }) + '.sig';
  USER_TOKENS[t] = id; return t;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url), method = opts.method || 'GET';
  const resp = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const body = () => Object.fromEntries(new URLSearchParams(opts.body || ''));
  if (u.startsWith(SB + '/rest/v1/rpc/')) {
    if (opts.headers?.apikey !== SRV || opts.headers?.Authorization !== 'Bearer ' + SRV) return resp(401, { message: 'no key' });
    const [st, b] = rpc(u.slice((SB + '/rest/v1/rpc/').length), JSON.parse(opts.body || '{}'));
    return resp(st, b);
  }
  if (u.startsWith(SB + '/auth/v1/')) {
    const p = u.slice((SB + '/auth/v1').length);
    NET.auth.push(method + ' ' + p.split('?')[0]);
    if (p === '/user') { const id = USER_TOKENS[String(opts.headers?.Authorization || '').slice(7)]; return id ? resp(200, { id, email: id + '@mail.ru' }) : resp(401, { msg: 'bad jwt' }); }
    if (opts.headers?.Authorization !== 'Bearer ' + SRV) return resp(401, { msg: 'no admin' });
    if (p === '/admin/users' && method === 'POST') {
      const b = JSON.parse(opts.body);
      if (!b.email_confirm || !/@id\.invalid$/.test(b.email) || b.password) return resp(400, { msg: 'unexpected create' });
      const id = `00000000-0000-4000-8000-${String(++uidN).padStart(12, '0')}`;
      DB.users[id] = { id, email: b.email, app_metadata: b.app_metadata };
      return resp(200, DB.users[id]);
    }
    let m = p.match(/^\/admin\/users\/([\w-]+)$/);
    if (m && method === 'GET') return DB.users[m[1]] ? resp(200, DB.users[m[1]]) : resp(404, { msg: 'User not found' });
    if (m && method === 'DELETE') { DB.deleted.push(m[1]); delete DB.users[m[1]]; return resp(200, {}); }
    if (p === '/admin/generate_link') {
      const b = JSON.parse(opts.body);
      if (b.type !== 'magiclink' || !Object.values(DB.users).some(x => x.email === b.email)) return resp(404, { msg: 'User not found' });
      return resp(200, { id: 'x', email: b.email, action_link: 'https://x', email_otp: '123456', hashed_token: 'pkce_' + 'h'.repeat(20) + (++magicN), verification_type: 'magiclink' });
    }
    return resp(404, {});
  }
  if (u === 'https://id.vk.ru/oauth2/auth') {
    const b = body(); NET.vk.push(['token', b]);
    if (b.code !== 'vk-code') return resp(400, { error: 'invalid_grant' });
    const st = NET.vkChallenge;
    if (!st || crypto.createHash('sha256').update(b.code_verifier).digest('base64url') !== st) return resp(400, { error: 'invalid_request', error_description: 'invalid code_challenge' });
    return resp(200, { access_token: 'vk-access-SECRET', refresh_token: 'r', id_token: 'i', token_type: 'Bearer', expires_in: 3600, user_id: VK_USER.user_id, state: b.state });
  }
  if (u === 'https://id.vk.ru/oauth2/user_info') { const b = body(); NET.vk.push(['info', b]); return b.access_token === 'vk-access-SECRET' ? resp(200, { user: VK_USER }) : resp(401, { error: 'invalid_token' }); }
  if (u === 'https://oauth.yandex.ru/token') {
    const b = body(); NET.ya.push(['token', b, opts.headers]);
    if (opts.headers?.Authorization !== 'Basic ' + Buffer.from(YA_ID + ':' + YA_SECRET).toString('base64')) return resp(401, { error: 'invalid_client' });
    if (b.code !== 'ya-code' || crypto.createHash('sha256').update(b.code_verifier || '').digest('base64url') !== NET.yaChallenge) return resp(400, { error: 'invalid_grant' });
    return resp(200, { access_token: 'ya-access-SECRET', token_type: 'bearer', expires_in: 3600 });
  }
  if (u === 'https://login.yandex.ru/info?format=json') { NET.ya.push(['info', opts.headers]); return opts.headers?.Authorization === 'OAuth ya-access-SECRET' ? resp(200, YA_USER) : resp(401, {}); }
  if (u === 'https://oauth.telegram.org/token') {
    const b = body(); NET.tg.push(['token', b, opts.headers]);
    if (b.code !== 'tg-code' || crypto.createHash('sha256').update(b.code_verifier || '').digest('base64url') !== NET.tgChallenge) return resp(400, { error: 'invalid_grant' });
    return resp(200, { access_token: 'tg-a', token_type: 'Bearer', expires_in: 3600, id_token: TG_IDTOKEN });
  }
  if (u === 'https://oauth.telegram.org/.well-known/jwks.json') return resp(200, { keys: TG_KEYS });
  throw new Error('неожиданный запрос: ' + u);
};

function mkReq({ method = 'GET', query = {}, headers = {}, body }) {
  const r = Readable.from(body !== undefined ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8')] : []);
  r.method = method; r.query = query;
  r.headers = Object.fromEntries(Object.entries({ 'x-real-ip': '203.0.113.7', ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return r;
}
function mkRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = b => { res.body = b == null ? '' : String(b); res.done = true; };
  res.json = () => JSON.parse(res.body);
  return res;
}
const qs = u => Object.fromEntries(new URL(u).searchParams);
const frag = loc => Object.fromEntries(new URLSearchParams(String(loc).split('#')[1] || ''));
const cookieOf = res => String(res.headers['set-cookie'] || '').split(';')[0];

(async () => {
  const S = await import(pathToFileURL(path.join(TMP, 'api/_lib/social.js')).href);
  const { default: pages } = await import(pathToFileURL(path.join(TMP, 'api/pages.js')).href);
  const call = async (query, opts = {}) => { const res = mkRes(); await pages(mkReq({ ...opts, query: { page: 'oauth', ...query } }), res); return res; };
  const post = (a, body, headers = {}) => call({ a }, { method: 'POST', body, headers: { 'content-type': 'application/json', origin: SITE, ...headers } });
  const c0 = S.config();

  // ═══ 1. state и PKCE ═══
  ok(S.pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk') === 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'PKCE S256: вектор из RFC 7636 (приложение B)');
  const r1 = S.rnd(32), r2 = S.rnd(32);
  ok(/^[A-Za-z0-9_-]{43}$/.test(r1) && r1 !== r2, 'state / code_verifier: 43 символа a-z A-Z 0-9 _ - (VK требует ≥ 32), каждый раз новый', r1);
  const tok = S.sign(c0, 'state', { a: 1, e: Date.now() / 1000 + 60 });
  ok(S.unsign(c0, 'state', tok)?.a === 1, 'подпись куки: своя проверяется');
  ok(S.unsign(c0, 'ticket', tok) === null, 'подпись одной задачи не подходит к другой (кука ≠ билет)');
  const [bd, mac] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ a: 2, e: Date.now() / 1000 + 60 })).toString('base64url') + '.' + mac;
  ok(S.unsign(c0, 'state', forged) === null, 'подменили содержимое куки — подпись не сходится');
  ok(S.unsign(c0, 'state', bd + '.' + mac.slice(0, -2) + 'AA') === null, 'испорченная подпись — не проходит');
  ok(S.unsign(c0, 'state', S.sign(c0, 'state', { a: 1, e: Date.now() / 1000 - 1 })) === null, 'просроченная кука — не проходит');
  ok(S.unsign({ ...c0, secret: 'другой-секрет-0123456789' }, 'state', tok) === null, 'другой секрет сервера — не проходит');
  const sealed = S.seal(c0, { h: 'tok', e: Date.now() / 1000 + 60 });
  ok(!sealed.includes('tok') && S.unseal(c0, sealed)?.h === 'tok', 'пропуск зашифрован (токена не видно) и открывается своим ключом');
  const sb = Buffer.from(sealed, 'base64url'); sb[20] ^= 1;
  ok(S.unseal(c0, sb.toString('base64url')) === null, 'пропуск испортили на 1 бит — не открывается');
  ok(S.unseal(c0, S.seal(c0, { h: 'x', e: Date.now() / 1000 - 1 })) === null, 'просроченный пропуск — не открывается');
  ok(S.safeEq('abc', 'abc') && !S.safeEq('abc', 'abd') && !S.safeEq('', '') && !S.safeEq('a', 'ab'), 'сравнение за постоянное время');

  // ═══ 2. Куда вернуть — только разделы сайта ═══
  const NX = { '#/profile': '#/profile', '#/profile/logins': '#/profile/logins', '#/games/horde': '#/games/horde',
    '#/games/studio3d/play/abc123/x7k': '#/games/studio3d/play/abc123/x7k', 'https://evil.example/': '#/profile', '//evil.example': '#/profile',
    'javascript:alert(1)': '#/profile', '#/profile/../../x': '#/profile', '#//evil': '#/profile', '#/x?y=1': '#/profile', '': '#/profile',
    '#/chat/general"><img>': '#/profile', ['#/' + 'a'.repeat(30)]: '#/profile', '/#/profile': '#/profile' };
  ok(Object.entries(NX).every(([a, b]) => S.safeNext(a) === b), '«куда вернуть»: только #/раздел/…, чужие адреса и мусор → #/profile',
    Object.entries(NX).filter(([a, b]) => S.safeNext(a) !== b));
  ok(S.redirectUri(c0, 'vk') === SITE + '/auth/vk/callback' && S.redirectUri(c0, 'yandex') === SITE + '/auth/yandex/callback', 'адрес возврата сервиса — точный, от SITE_URL (не от заголовка Host)');

  // ═══ 3. Отпечаток адреса ═══
  ok(S.normIp('203.0.113.7') === '203.0.113.7' && S.normIp('::ffff:203.0.113.7') === '203.0.113.7' && S.normIp('203.0.113.7:443') === '203.0.113.7', 'IPv4 (и IPv4 в IPv6, с портом) — как есть');
  ok(S.normIp('2001:db8:85a3:1:aaaa:bbbb:cccc:dddd') === '2001:db8:85a3:1::/64' && S.normIp('2001:0db8:85a3:0001::1') === '2001:db8:85a3:1::/64'
    && S.normIp('[2001:db8::1]:443') === '2001:db8:0:0::/64', 'IPv6 — подсеть /64 (один дом/телефон не обойдёт лимит сменой адреса)', [S.normIp('2001:0db8:85a3:0001::1'), S.normIp('[2001:db8::1]:443')]);
  const h1 = S.ipHash(c0, '203.0.113.7', '2026-10-15'), h2 = S.ipHash(c0, '203.0.113.7', '2026-10-16');
  ok(/^[0-9a-f]{32}$/.test(h1) && h1 !== h2 && h1 !== S.ipHash(c0, '203.0.113.8', '2026-10-15'), 'отпечаток адреса: 32 hex, другой день — другой отпечаток');
  ok(!h1.includes('203') && S.ipHash({ ...c0, secret: 'другой-секрет-0123456789' }, '203.0.113.7', '2026-10-15') !== h1, 'по отпечатку адрес не узнать (ключ сервера)');
  ok(S.mskDay(Date.UTC(2026, 9, 15, 21, 30)) === '2026-10-16', 'сутки — по Москве, как в базе');

  // ═══ 4. Виджет Telegram: известный вектор (Python: hmac.new(sha256(token), dcs, sha256)) ═══
  const TGD = { id: 987654321, first_name: 'Денчик', last_name: 'Тест', username: 'dan4ik_test', photo_url: 'https://t.me/i/userpic/320/abc.jpg', auth_date: 1760500000,
    hash: '9b0787042bc152b54be735cbe3f4e0a04a9b8668570b5add35e2890ec3046f09' };
  let tv = S.tgWidgetCheck(TGD, TG_TOKEN, 1760500100);
  ok(tv.ok && tv.uid === '987654321' && tv.name === 'Денчик Т.' && tv.avatar === 'https://t.me/i/userpic/320/abc.jpg', 'Telegram: подпись на известном векторе сходится; имя — имя + буква фамилии', tv);
  ok(S.tgWidgetCheck({ ...TGD, hash: TGD.hash.toUpperCase() }, TG_TOKEN, 1760500100).ok, 'hash заглавными — тоже');
  ok(S.tgWidgetCheck({ ...TGD, id: 1 }, TG_TOKEN, 1760500100).reason === 'hash', 'подменили номер — подпись не сходится');
  ok(S.tgWidgetCheck({ ...TGD, first_name: 'Админ' }, TG_TOKEN, 1760500100).reason === 'hash', 'подменили имя — не сходится');
  ok(S.tgWidgetCheck({ ...TGD, extra: 'x' }, TG_TOKEN, 1760500100).reason === 'hash', 'лишнее поле — не сходится');
  ok(S.tgWidgetCheck(TGD, '123456789:другой-токен-бота-0123456789abcdef', 1760500100).reason === 'hash', 'чужой бот — не сходится');
  ok(S.tgWidgetCheck(TGD, TG_TOKEN, 1760500000 + 301).reason === 'old', 'auth_date старше 5 минут — old');
  ok(S.tgWidgetCheck(TGD, TG_TOKEN, 1760500000 - 120).reason === 'bad', 'auth_date из будущего — bad');
  ok(S.tgWidgetCheck(null, TG_TOKEN).reason === 'bad' && S.tgWidgetCheck([], TG_TOKEN).reason === 'bad' && S.tgWidgetCheck({ id: 1, auth_date: 1 }, TG_TOKEN).reason === 'bad'
    && S.tgWidgetCheck({ ...TGD, 'Bad-Key': 1 }, TG_TOKEN, 1760500100).reason === 'bad' && S.tgWidgetCheck({ ...TGD, first_name: { x: 1 } }, TG_TOKEN, 1760500100).reason === 'bad',
  'мусор (не объект, без hash, странные ключи и значения) — bad');
  ok(S.tgWidgetCheck({ ...TGD, photo_url: 'https://evil.example/a.jpg', hash: crypto.createHmac('sha256', crypto.createHash('sha256').update(TG_TOKEN).digest())
    .update(Object.entries({ ...TGD, photo_url: 'https://evil.example/a.jpg' }).filter(([k]) => k !== 'hash').sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => k + '=' + v).join('\n')).digest('hex') },
  TG_TOKEN, 1760500100).avatar === null, 'аватарка не с адреса Telegram — не сохраняется');
  const fresh = () => { const d = { id: 555000111, first_name: 'Тг', auth_date: Math.floor(Date.now() / 1000) - 5 };
    d.hash = crypto.createHmac('sha256', crypto.createHash('sha256').update(TG_TOKEN).digest()).update(Object.keys(d).sort().map(k => k + '=' + d[k]).join('\n')).digest('hex'); return d; };

  // ═══ 5. id_token Telegram (OpenID): RS256 и ES256 ═══
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }), ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwkR = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'oidc-1', alg: 'RS256', use: 'sig' }, jwkE = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'oidc-es256-1', alg: 'ES256' };
  const jwt = (alg, kid, claims, key) => {
    const h = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url'), p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = alg === 'RS256' ? crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key) : crypto.sign('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' });
    return h + '.' + p + '.' + sig.toString('base64url');
  };
  const T0 = Math.floor(Date.now() / 1000), CL = { iss: 'https://oauth.telegram.org', aud: '123456789', sub: '777000', id: 777000, name: 'Вася', exp: T0 + 600, iat: T0 };
  const vopt = { iss: 'https://oauth.telegram.org', aud: '123456789', keys: [jwkR, jwkE] };
  ok((await S.verifyIdToken(jwt('RS256', 'oidc-1', CL, rsa.privateKey), vopt)).id === 777000, 'id_token RS256: подпись и поля верны');
  ok((await S.verifyIdToken(jwt('ES256', 'oidc-es256-1', CL, ec.privateKey), vopt)).sub === '777000', 'id_token ES256 — тоже');
  const bad = async (t, o = vopt) => { try { await S.verifyIdToken(t, o); return false; } catch (e) { return true; } };
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  ok(await bad(jwt('RS256', 'oidc-1', CL, other.privateKey)), 'чужой ключ — отказ');
  ok(await bad(jwt('RS256', 'oidc-1', { ...CL, aud: '999' }, rsa.privateKey)), 'чужой бот (aud) — отказ');
  ok(await bad(jwt('RS256', 'oidc-1', { ...CL, iss: 'https://evil.example' }, rsa.privateKey)), 'чужой выдавший (iss) — отказ');
  ok(await bad(jwt('RS256', 'oidc-1', { ...CL, exp: T0 - 120 }, rsa.privateKey)), 'просроченный — отказ');
  ok(await bad(jwt('RS256', 'oidc-x', CL, rsa.privateKey)), 'неизвестный kid — отказ');
  const none = Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(CL)).toString('base64url') + '.';
  ok(await bad(none) && await bad('мусор') && await bad(jwt('HS256', 'oidc-1', CL, rsa.privateKey).replace(/^[^.]+/, Buffer.from('{"alg":"HS256","kid":"oidc-1"}').toString('base64url'))), 'alg none / HS256 / мусор — отказ');
  const parts = jwt('RS256', 'oidc-1', CL, rsa.privateKey).split('.');
  ok(await bad(parts[0] + '.' + Buffer.from(JSON.stringify({ ...CL, id: 1 })).toString('base64url') + '.' + parts[2]), 'подменили номер в id_token — подпись не сходится');

  // ═══ 6. Включение: переменные Vercel + auth-links.sql ═══
  let pr = (await call({ a: 'providers' })).json();
  ok(pr.ok && pr.vk === true && pr.yandex === true && pr.tg?.mode === 'widget' && pr.tg.bot === TG_BOT && pr.tg.id === 123456789, 'всё задано: VK, Яндекс, Telegram (виджет: имя бота без @ и номер)', pr);
  ok(!JSON.stringify(pr).includes(TG_TOKEN.split(':')[1]) && !JSON.stringify(pr).includes(YA_SECRET), 'в ответе нет секретов');
  setEnv({ ...BASE_ENV, VK_ID_CLIENT_ID: '', YANDEX_CLIENT_SECRET: '', TELEGRAM_BOT_NAME: '' });
  pr = (await call({ a: 'providers' })).json();
  ok(pr.vk === false && pr.yandex === false && pr.tg === false, 'нет переменных — вход выключен (и Яндекс без секрета тоже)', pr);
  setEnv({ ...BASE_ENV, VK_ID_CLIENT_ID: 'abc', YANDEX_CLIENT_ID: 'short' });
  pr = (await call({ a: 'providers' })).json();
  ok(pr.vk === false && pr.yandex === false, 'кривые номера приложений — выключено');
  setEnv({ ...BASE_ENV, TELEGRAM_CLIENT_SECRET: 'tg-oidc-secret-0123456789' });
  pr = (await call({ a: 'providers' })).json();
  ok(pr.tg?.mode === 'oidc' && pr.tg.bot === undefined, 'есть TELEGRAM_CLIENT_SECRET — новый вход Telegram (OpenID), номер приложения — из токена бота', pr);
  setEnv({ ...BASE_ENV, SUPABASE_SERVICE_ROLE_KEY: '' });
  pr = (await call({ a: 'providers' })).json();
  ok(pr.vk === false && pr.yandex === false && pr.tg === false, 'нет ключа Supabase — всё выключено');
  setEnv(BASE_ENV); DB.sqlMissing = true; S.resetReadyCache();
  pr = (await call({ a: 'providers' })).json();
  ok(pr.vk === false && pr.yandex === false && pr.tg === false, 'нет auth-links.sql — кнопок нет (сайт работает как раньше)');
  let st0 = await call({ a: 'start', p: 'vk', b: S.rnd(32) });
  ok(st0.statusCode === 302 && frag(st0.headers.location).d37auth_err === 'off', 'без SQL старт сразу назад: «вход выключен»', st0.headers.location);
  DB.sqlMissing = false; S.resetReadyCache();
  ok((await call({ a: 'providers' })).headers['cache-control'].includes('max-age'), 'список входов кэшируется (CDN), в нём нет ничего личного');

  // ═══ 7. VK ID: старт → сервис → возврат → вход ═══
  const fid = 'секрет-вкладки-' + S.rnd(16), B = S.shaB64(fid);
  let res = await call({ a: 'start', p: 'vk', b: B, n: '#/games/horde' });
  ok(res.statusCode === 302 && res.headers.location.startsWith('https://id.vk.ru/authorize?'), 'старт VK: переход на id.vk.ru/authorize', res.headers.location);
  let q = qs(res.headers.location);
  ok(q.response_type === 'code' && q.client_id === VK_ID && q.redirect_uri === SITE + '/auth/vk/callback' && q.code_challenge_method === 'S256'
    && /^[A-Za-z0-9_-]{43}$/.test(q.code_challenge) && /^[A-Za-z0-9_-]{43}$/.test(q.state) && q.scope === 'vkid.personal_info', 'параметры VK: code, точный redirect_uri, PKCE S256, state ≥ 32', q);
  ok(!res.headers.location.includes(B) && !res.headers.location.includes('horde'), 'в адрес сервиса не уходят ни отпечаток вкладки, ни «куда вернуть»');
  let ck = String(res.headers['set-cookie']);
  ok(/^d37_oa_vk=[^;]+; Path=\/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/.test(ck), 'кука: только /auth, 10 мин, HttpOnly, Secure, SameSite=Lax', ck);
  ok(res.headers['referrer-policy'] === 'no-referrer' && res.headers['cache-control'] === 'no-store', 'переход: без Referer и без кэша');
  NET.vkChallenge = q.code_challenge;
  const cbq = { a: 'callback', p: 'vk', code: 'vk-code', state: q.state, device_id: 'dev-123', type: 'code_v2' };
  // чужой браузер (нет куки) и подменённый state
  res = await call(cbq);
  ok(frag(res.headers.location).d37auth_err === 'state', 'возврат без куки (другой браузер / подделка) — state');
  res = await call({ ...cbq, state: S.rnd(32) }, { headers: { cookie: cookieOf({ headers: { 'set-cookie': ck } }) } });
  ok(frag(res.headers.location).d37auth_err === 'state', 'state не совпал с кукой — отказ (CSRF)');
  ok(String(res.headers['set-cookie']).includes('Max-Age=0'), 'кука после возврата стирается');
  res = await call({ ...cbq, error: 'access_denied', code: undefined }, { headers: { cookie: cookieOf({ headers: { 'set-cookie': ck } }) } });
  ok(frag(res.headers.location).d37auth_err === 'denied', 'человек нажал «Отмена» в VK — denied');
  res = await call({ a: 'start', p: 'vk', b: B, n: '#/games/horde' });
  q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  const before = DB.links.length;
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  let loc = res.headers.location, f = frag(loc);
  ok(res.statusCode === 302 && loc.startsWith(SITE + '/#d37auth=') && f.d37auth && !loc.includes('pkce_') && !loc.includes('?'), 'возврат VK: на сайт с зашифрованным пропуском во ФРАГМЕНТЕ (токена не видно)', loc.slice(0, 80));
  const tokReq = NET.vk.find(x => x[0] === 'token')?.[1] || {};
  ok(tokReq.grant_type === 'authorization_code' && tokReq.device_id === 'dev-123' && tokReq.redirect_uri === SITE + '/auth/vk/callback' && tokReq.client_id === VK_ID
    && tokReq.state === q.state && tokReq.code_verifier && !tokReq.service_token, 'обмен кода VK: PKCE verifier, device_id, тот же redirect_uri и state (без service_token — приложение не конфиденциальное)', tokReq);
  ok(DB.links.length === before + 1 && DB.links.at(-1).uid === '1234567' && DB.links.at(-1).name === 'Иван П.', 'новый аккаунт привязан к номеру VK; имя — «Иван П.»', DB.links.at(-1));
  const created = Object.values(DB.users).at(-1);
  ok(/^vk-1234567-[0-9a-f]{6}@id\.invalid$/.test(created.email) && created.app_metadata?.d37_synth_email === created.email, 'служебная почта vk-<номер>-<6 hex>@id.invalid (письма не уходят), отмечена в app_metadata', created);
  ok(!JSON.stringify(DB).includes('vk-access-SECRET'), 'токен VK нигде не сохранён');
  // повтор того же возврата (кто-то подсмотрел адрес) — одноразово
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'used', 'тот же возврат второй раз — used (state одноразовый)');
  // пропуск → token_hash
  res = await post('finish', { k: f.d37auth, f: 'чужая-вкладка' });
  ok(res.json().reason === 'browser', 'пропуск без секрета ЭТОЙ вкладки — отказ (ссылку с пропуском не подсунуть другому)');
  res = await post('finish', { k: f.d37auth, f: fid }, { origin: 'https://evil.example' });
  ok(res.statusCode === 403, 'пропуск с чужого сайта (Origin) — 403');
  res = await post('finish', { k: f.d37auth, f: fid }, { 'content-type': 'text/plain' });
  ok(res.statusCode === 403, 'не JSON (простая форма с чужого сайта) — 403');
  res = await post('finish', { k: f.d37auth, f: fid });
  let fj = res.json();
  ok(fj.ok && /^pkce_h+\d+$/.test(fj.token_hash) && fj.provider === 'vk' && fj.new === true && fj.next === '#/profile', 'пропуск + секрет вкладки → token_hash; новый аккаунт → в профиль (ник и возраст)', fj);
  res = await post('finish', { k: f.d37auth, f: fid });
  ok(res.json().reason === 'used', 'пропуск второй раз — used');
  // второй вход тем же VK — тот же аккаунт, «куда вернуть» сохраняется
  res = await call({ a: 'start', p: 'vk', b: B, n: '#/games/horde' }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  fj = (await post('finish', { k: frag(res.headers.location).d37auth, f: fid })).json();
  ok(fj.ok && fj.new === false && fj.next === '#/games/horde' && DB.links.length === before + 1, 'второй вход: тот же аккаунт, возврат туда, откуда входил', fj);
  // испорченный / просроченный пропуск
  ok((await post('finish', { k: 'мусор', f: fid })).json().reason === 'expired', 'мусор вместо пропуска — expired');
  ok((await post('finish', { k: S.seal(S.config(), { h: 'x', b: B, e: Date.now() / 1000 - 5 }), f: fid })).json().reason === 'expired', 'просроченный пропуск (3 мин) — expired');
  // ошибки VK
  res = await call({ a: 'start', p: 'vk', b: B }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  res = await call({ ...cbq, state: q.state, code: 'чужой-код' }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'provider', 'VK не принял код — provider');
  res = await call({ a: 'start', p: 'vk', b: B }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = 'другой-challenge';
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'provider', 'verifier не подходит к challenge (подмена кода) — provider');
  res = await call({ a: 'start', p: 'vk', b: 'короткий' });
  ok(frag(res.headers.location).d37auth_err === 'state', 'старт без отпечатка вкладки — state');
  setEnv({ ...BASE_ENV, VK_ID_SECRET: 'vk-service-token' });
  res = await call({ a: 'start', p: 'vk', b: B }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge; NET.vk.length = 0;
  VK_USER = { ...VK_USER, user_id: 7654321, last_name: '' };
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(NET.vk.find(x => x[0] === 'token')?.[1].service_token === 'vk-service-token' && DB.links.at(-1).name === 'Иван', 'есть VK_ID_SECRET — уходит как service_token (конфиденциальное приложение); имя без фамилии', NET.vk[0]);
  setEnv(BASE_ENV);

  // ═══ 8. Лимит новых аккаунтов с одного адреса, бан входа, гонка ═══
  DB.ip = {};
  const vkLogin = async (uid, ip) => {
    VK_USER = { ...VK_USER, user_id: uid };
    const s = await call({ a: 'start', p: 'vk', b: B }); const qq = qs(s.headers.location); NET.vkChallenge = qq.code_challenge;
    return frag((await call({ ...cbq, state: qq.state }, { headers: { cookie: cookieOf(s), 'x-real-ip': ip } })).headers.location);
  };
  const made = [await vkLogin(1001, '198.51.100.1'), await vkLogin(1002, '198.51.100.1'), await vkLogin(1003, '198.51.100.1')];
  ok(made.every(x => x.d37auth), '3 новых аккаунта с одного адреса — можно');
  ok((await vkLogin(1004, '198.51.100.1')).d37auth_err === 'rate', '4-й с того же адреса — rate');
  ok((await vkLogin(1001, '198.51.100.1')).d37auth, 'войти в созданный — можно');
  ok(Object.keys(DB.ip).every(k => /^[0-9a-f]{32}$/.test(k)) && !Object.keys(DB.ip).some(k => k.includes('198')), 'в базу уходит отпечаток адреса, не адрес');
  DB.bans.add('vk:1005');
  ok((await vkLogin(1005, '198.51.100.9')).d37auth_err === 'banned', 'забаненный VK — banned');
  // гонка: двойной клик — второй запрос создал лишний аккаунт → удаляем его, входим в созданный первым
  const users0 = Object.keys(DB.users).length, del0 = DB.deleted.length, first = Object.keys(DB.users)[0];
  DB.race = { uid: '1006', user: first };
  const rc = await vkLogin(1006, '198.51.100.20');
  const rcj = rc.d37auth ? (await post('finish', { k: rc.d37auth, f: fid })).json() : null;
  ok(rcj?.ok && rcj.new === false && DB.deleted.length === del0 + 1 && Object.keys(DB.users).length === users0, 'гонка (двойной клик): лишний аккаунт удалён, вход в созданный первым', { rc, rcj });

  // ═══ 9. Яндекс ═══
  res = await call({ a: 'start', p: 'yandex', b: B, n: '#/chat' });
  q = qs(res.headers.location); ck = cookieOf(res); NET.yaChallenge = q.code_challenge;
  ok(res.headers.location.startsWith('https://oauth.yandex.ru/authorize?') && q.client_id === YA_ID && q.redirect_uri === SITE + '/auth/yandex/callback'
    && q.code_challenge_method === 'S256' && !q.scope, 'старт Яндекса: oauth.yandex.ru, точный redirect_uri, PKCE, права — как у приложения (почту не просим)', q);
  res = await call({ a: 'callback', p: 'yandex', code: 'ya-code', state: q.state, cid: 'x' }, { headers: { cookie: ck } });
  f = frag(res.headers.location);
  const yt = NET.ya.find(x => x[0] === 'token');
  ok(f.d37auth && yt[1].code_verifier && !yt[1].client_secret && yt[2].Authorization.startsWith('Basic '), 'Яндекс: код → токен (секрет — в заголовке Basic, плюс PKCE) → профиль', yt);
  ok(NET.ya.find(x => x[0] === 'info')[1].Authorization === 'OAuth ya-access-SECRET', 'профиль Яндекса — с заголовком «OAuth <токен>», не в адресе');
  ok(DB.links.at(-1).uid === '987654' && DB.links.at(-1).name === 'Иван С.', 'Яндекс: номер и имя «Иван С.»', DB.links.at(-1));
  fj = (await post('finish', { k: f.d37auth, f: fid })).json();
  ok(fj.ok && fj.provider === 'yandex' && fj.new === true, 'Яндекс: вход прошёл', fj);
  YA_USER = { ...YA_USER, client_id: 'чужое' };
  res = await call({ a: 'start', p: 'yandex', b: B }); q = qs(res.headers.location); ck = cookieOf(res); NET.yaChallenge = q.code_challenge;
  res = await call({ a: 'callback', p: 'yandex', code: 'ya-code', state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'provider', 'токен другого приложения Яндекса — provider');
  YA_USER = { ...YA_USER, client_id: YA_ID };

  // ═══ 10. Привязка к своему аккаунту: билет только со свежим входом ═══
  const ME = '11111111-2222-4333-8444-555555555555';
  DB.users[ME] = { id: ME, email: 'me@mail.ru' };
  const freshTok = userJwt(ME, 60), oldTok = userJwt(ME, 3600);
  ok((await post('ticket', { p: 'vk', b: B })).statusCode === 401, 'билет без входа — 401');
  ok((await post('ticket', { p: 'vk', b: B }, { authorization: 'Bearer ' + oldTok })).json().reason === 'reauth', 'вошёл час назад — reauth (войди ещё раз)');
  ok((await post('ticket', { p: 'vk', b: 'x' }, { authorization: 'Bearer ' + freshTok })).json().reason === 'bad', 'билет без отпечатка вкладки — bad');
  ok((await post('ticket', { p: 'google', b: B }, { authorization: 'Bearer ' + freshTok })).json().reason === 'off', 'встроенный (google) — не здесь');
  let tk = (await post('ticket', { p: 'vk', b: B }, { authorization: 'Bearer ' + freshTok })).json();
  ok(tk.ok && tk.t, 'свежий вход → билет на привязку', tk);
  res = await call({ a: 'start', p: 'vk', b: S.shaB64('другая вкладка'), m: 'link', t: tk.t });
  ok(frag(res.headers.location).d37auth_err === 'reauth', 'билет из другой вкладки — не подходит');
  res = await call({ a: 'start', p: 'yandex', b: B, m: 'link', t: tk.t });
  ok(frag(res.headers.location).d37auth_err === 'reauth', 'билет на VK не подходит к Яндексу');
  res = await call({ a: 'start', p: 'vk', b: B, m: 'link', t: tk.t, n: '#/profile/logins' });
  q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  VK_USER = { ...VK_USER, user_id: 2002 };
  const usersBefore = Object.keys(DB.users).length;
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(res.headers.location === SITE + '/#d37link=vk' && DB.links.find(x => x.uid === '2002')?.user === ME && Object.keys(DB.users).length === usersBefore,
    'привязка: VK 2002 → мой аккаунт, нового аккаунта нет', res.headers.location);
  tk = (await post('ticket', { p: 'vk', b: B }, { authorization: 'Bearer ' + freshTok })).json();
  res = await call({ a: 'start', p: 'vk', b: B, m: 'link', t: tk.t }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  VK_USER = { ...VK_USER, user_id: 1001 };
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'taken', 'VK чужого аккаунта к своему — taken (не переносим)');
  const T = S.sign(S.config(), 'ticket', { u: ME, p: 'vk', b: B, at: Math.floor(Date.now() / 1000) - 7200, e: Date.now() / 1000 + 60 });
  res = await call({ a: 'start', p: 'vk', b: B, m: 'link', t: T }); q = qs(res.headers.location); ck = cookieOf(res); NET.vkChallenge = q.code_challenge;
  VK_USER = { ...VK_USER, user_id: 3003 };
  res = await call({ ...cbq, state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'reauth', 'старый вход в билете — база ещё раз говорит reauth');

  // ═══ 11. Виджет Telegram ═══
  let d = fresh();
  res = await post('tg', { user: d, n: '#/games' });
  let tj = res.json();
  ok(tj.ok && tj.token_hash && tj.new === true && tj.next === '#/profile' && DB.links.at(-1).p === 'tg' && DB.links.at(-1).uid === '555000111', 'Telegram (виджет): подпись бота → новый аккаунт → token_hash', tj);
  ok((await post('tg', { user: d })).json().reason === 'used', 'те же данные Telegram второй раз — used');
  ok((await post('tg', { user: { ...fresh(), first_name: 'Подмена' } })).json().reason === 'bad', 'подменённые данные — bad');
  const oldD = fresh(); oldD.auth_date -= 400;
  oldD.hash = crypto.createHmac('sha256', crypto.createHash('sha256').update(TG_TOKEN).digest()).update(Object.keys(oldD).filter(k => k !== 'hash').sort().map(k => k + '=' + oldD[k]).join('\n')).digest('hex');
  ok((await post('tg', { user: oldD })).json().reason === 'expired', 'данные старше 5 минут — expired');
  ok((await post('tg', { user: fresh() }, { origin: 'https://evil.example' })).statusCode === 403, 'с чужого сайта — 403');
  d = fresh(); d.id = 555000222; d.hash = crypto.createHmac('sha256', crypto.createHash('sha256').update(TG_TOKEN).digest()).update(Object.keys(d).filter(k => k !== 'hash').sort().map(k => k + '=' + d[k]).join('\n')).digest('hex');
  ok((await post('tglink', { user: d }, { authorization: 'Bearer ' + oldTok })).json().reason === 'reauth', 'привязка Telegram со старым входом — reauth');
  ok((await post('tglink', { user: d }, { authorization: 'Bearer ' + freshTok })).json().ok === true && DB.links.find(x => x.uid === '555000222')?.user === ME, 'привязка Telegram со свежим входом — к моему аккаунту');
  setEnv({ ...BASE_ENV, TELEGRAM_CLIENT_SECRET: 'tg-oidc-secret-0123456789' });
  ok((await post('tg', { user: fresh() })).json().reason === 'off', 'включён новый вход Telegram — виджет выключен');

  // ═══ 12. Telegram OpenID: старт → oauth.telegram.org → id_token ═══
  TG_KEYS = [jwkR];
  res = await call({ a: 'start', p: 'tg', b: B });
  q = qs(res.headers.location); ck = cookieOf(res); NET.tgChallenge = q.code_challenge;
  ok(res.headers.location.startsWith('https://oauth.telegram.org/auth?') && q.client_id === '123456789' && q.scope === 'openid profile' && q.redirect_uri === SITE + '/auth/tg/callback',
    'старт Telegram (OpenID): oauth.telegram.org/auth, номер бота, openid profile', q);
  TG_IDTOKEN = jwt('RS256', 'oidc-1', { ...CL, id: 888000, sub: 'x', exp: Math.floor(Date.now() / 1000) + 600 }, rsa.privateKey);
  S.resetJwksCache();
  res = await call({ a: 'callback', p: 'tg', code: 'tg-code', state: q.state }, { headers: { cookie: ck } });
  f = frag(res.headers.location);
  const tgt = NET.tg.find(x => x[0] === 'token');
  ok(f.d37auth && tgt[2].Authorization === 'Basic ' + Buffer.from('123456789:tg-oidc-secret-0123456789').toString('base64') && DB.links.at(-1).uid === '888000',
    'Telegram (OpenID): код → id_token с подписью Telegram → номер из поля id', { f, link: DB.links.at(-1) });
  res = await call({ a: 'start', p: 'tg', b: B }); q = qs(res.headers.location); ck = cookieOf(res); NET.tgChallenge = q.code_challenge;
  TG_IDTOKEN = jwt('RS256', 'oidc-1', { ...CL, id: 888001, aud: '42' }, rsa.privateKey);
  res = await call({ a: 'callback', p: 'tg', code: 'tg-code', state: q.state }, { headers: { cookie: ck } });
  ok(frag(res.headers.location).d37auth_err === 'provider', 'id_token для чужого бота — provider');
  setEnv(BASE_ENV);
  res = await call({ a: 'start', p: 'tg', b: B });
  ok(frag(res.headers.location).d37auth_err === 'off', 'виджет Telegram: серверного старта нет — off');

  // ═══ 13. Прочее ═══
  ok((await call({ a: 'nope' })).statusCode === 404 && (await call({ a: 'start', p: 'ok' })).statusCode === 404, 'неизвестное действие / сервис — 404');
  ok((await call({ a: 'finish' })).statusCode === 403, 'finish запросом GET — 403');
  const funcs = fs.readdirSync(path.join(ROOT, 'api')).filter(x => x.endsWith('.js'));
  ok(funcs.length <= 12 && !funcs.includes('oauth.js'), `серверных функций ${funcs.length} из 12 — вход через api/pages.js, новой функции нет`, funcs);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const rw = Object.fromEntries(vj.rewrites.map(x => [x.source, x.destination]));
  ok(rw['/auth/:p/start'] === '/api/pages?page=oauth&a=start&p=:p' && rw['/auth/:p/callback'] === '/api/pages?page=oauth&a=callback&p=:p' && rw['/api/oauth'] === '/api/pages?page=oauth',
    'vercel.json: /auth/<p>/start, /auth/<p>/callback и /api/oauth → api/pages.js');
  const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  ok(/req\.mode === 'navigate'\) return p === '\/' \|\| p === '\/index\.html' \? 'shell' : 'page'/.test(swSrc), 'sw.js: переходы на /auth/… идут в сеть (page), не из кэша');

  // ═══ 14. Страница (js/features/social-login.js): разбор возврата, кнопки, «последний способ» ═══
  await clientTests();

  console.log(`\nauth-test: ${n - fails} ок, ${fails} ошибок`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('✗ СБОЙ ТЕСТА:', e); process.exit(1); });

// ── Клиент в песочнице node: только чистые функции D37Login._test (DOM не нужен) ──
async function clientTests() {
  const file = path.join(ROOT, 'js/features/social-login.js');
  if (!fs.existsSync(file)) { ok(false, 'нет js/features/social-login.js'); return; }
  const store = {};
  const ls = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const ctx = { console, setTimeout, clearTimeout, URLSearchParams, TextEncoder, TextDecoder, URL, crypto: crypto.webcrypto, localStorage: ls, sessionStorage: ls, location: { hash: '', search: '', pathname: '/', origin: 'https://dan4ik37.vercel.app', href: 'https://dan4ik37.vercel.app/' },
    history: { replaceState() {} }, addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } }, Event: class { constructor(t) { this.type = t; } },
    atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'), fetch: async () => ({ ok: false, json: async () => ({}) }) };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'social-login.js' });
  const L = ctx.D37Login, T = L && L._test;
  ok(!!T, 'social-login.js: D37Login._test есть');
  if (!T) return;
  // возврат: что лежит во фрагменте
  const H = T.parseReturn;
  ok(H('#d37auth=abc_DEF-1abc_DEF-1abc_DEF-1').auth === 'abc_DEF-1abc_DEF-1abc_DEF-1' && H('#d37auth=short') === null && H('#d37auth_err=rate&p=vk').err === 'rate' && H('#d37auth_err=rate&p=vk').p === 'vk' && H('#d37link=tg').link === 'tg',
    'фрагмент возврата: пропуск, ошибка с сервисом, привязка');
  ok(H('#/profile') === null && H('#access_token=x&refresh_token=y') === null && H('') === null, 'обычный раздел и токены Supabase — не наши (их не трогаем)');
  ok(H('#d37auth=<script>') === null && H('#d37link=evil').link === undefined && H('#d37auth_err=%3Cb%3E&p=vk').err === 'server', 'мусор во фрагменте — не принимаем');
  ok(H('#error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user').sb?.code === 'unexpected_failure', 'ошибка входа Supabase (Google/Discord…) распознаётся');
  ok(H('#tgAuthResult=' + Buffer.from(JSON.stringify({ id: 1, hash: 'x' })).toString('base64')).tg?.id === 1, 'возврат виджета Telegram (#tgAuthResult) распознаётся');
  // какие кнопки: встроенные — по /auth/v1/settings, свои — по /api/oauth?a=providers
  const list = T.buttons({ google: true, discord: true, twitch: false, github: true, email: true }, { vk: true, yandex: false, tg: { mode: 'widget', bot: 'b', id: 1 } });
  ok(list.join(',') === 'vk,tg,google,discord,github', 'кнопки — только включённые, в порядке для зрителей (VK, Telegram, Яндекс, Google, Discord, Twitch, GitHub)', list);
  ok(T.buttons({}, {}).length === 0 && T.buttons(null, null).length === 0, 'ничего не включено — кнопок нет (блок скрыт)');
  // способы входа и «последний»
  const W = T.ways;
  ok(W({ email: true, links: [], identities: [] }, ['vk']) === 1, 'только почта — 1 способ');
  ok(W({ email: false, links: [{ provider: 'vk' }], identities: [] }, ['vk']) === 1, 'аккаунт из VK — 1 способ (служебная почта не в счёт)');
  ok(W({ email: false, links: [{ provider: 'vk' }], identities: [{ provider: 'discord' }] }, ['vk', 'discord']) === 2, 'VK + Discord — 2');
  ok(W({ email: false, links: [{ provider: 'vk' }], identities: [{ provider: 'discord' }] }, ['discord']) === 1, 'выключенный на сайте вход (VK) не считается способом');
  ok(T.canUnlink({ email: false, links: [{ provider: 'vk' }], identities: [] }, ['vk'], 'vk') === false, 'последний способ — «Отвязать» нельзя');
  ok(T.canUnlink({ email: true, links: [{ provider: 'vk' }], identities: [] }, ['vk'], 'vk') === true, 'есть почта — VK отвязать можно');
  ok(T.isSynthetic({ email: 'vk-1-abcdef@id.invalid' }) && T.isSynthetic({ email: 'x@y.ru', app_metadata: { d37_synth_email: 'x@y.ru' } }) && !T.isSynthetic({ email: 'me@mail.ru' }), 'служебная почта распознаётся');
  // свежесть входа по токену (amr)
  const jwtOf = o => 'x.' + Buffer.from(JSON.stringify(o)).toString('base64url') + '.y';
  const nowS = Math.floor(Date.now() / 1000);
  ok(T.freshAt(jwtOf({ amr: [{ method: 'password', timestamp: nowS - 60 }] })) === nowS - 60 && T.isFresh(jwtOf({ amr: [{ method: 'oauth', timestamp: nowS - 60 }] })), 'свежий вход по amr — да');
  ok(!T.isFresh(jwtOf({ amr: [{ method: 'password', timestamp: nowS - 3600 }] })) && !T.isFresh('мусор'), 'вошёл час назад / нет токена — нужен повторный вход');
  // тексты ошибок — по-русски и без технических кодов
  for (const code of ['denied', 'state', 'used', 'expired', 'browser', 'provider', 'banned', 'rate', 'busy', 'taken', 'has', 'reauth', 'off', 'server', 'last']) {
    const t = T.errText(code, 'vk');
    if (!/[а-яё]/i.test(t) || /undefined|null/.test(t)) { ok(false, 'текст ошибки ' + code, t); return; }
  }
  ok(true, 'тексты всех ошибок — по-русски, с названием сервиса');
  ok(T.errText('banned', 'vk').includes('VK') && T.errText('rate', 'tg').includes('завтра'), 'тексты понятные: «VK заблокирован…», «попробуй завтра»');
  // отметка «начал вход» — только своя, чужие ключи не трогаем
  store.d37_ref = 'друг'; store.d37_after_login = '#/x';
  T.setPending({ p: 'vk', m: 'login', f: 'abc' });
  ok(JSON.parse(store.d37_oauth).p === 'vk' && store.d37_ref === 'друг', 'отметка входа — в своём ключе d37_oauth, код приглашения (d37_ref) не тронут');
  T.clearPending();
  ok(!('d37_oauth' in store) && store.d37_ref === 'друг' && store.d37_after_login === '#/x', 'после входа стирается только своя отметка');
}

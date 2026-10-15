// Вход через VK ID, Яндекс ID и Telegram → api/pages.js?page=oauth (rewrites в vercel.json). Логика и проверки — api/_lib/social.js.
//   GET  /auth/<p>/start?b=<отпечаток секрета вкладки>&n=<#/раздел>[&m=link&t=<билет> | &m=reauth&u=<свой id>] → кука + переход в сервис
//        (m=reauth — «подтверди, что это ты» перед привязкой: войти можно только в этот же аккаунт, новый не создаётся)
//   GET  /auth/<p>/callback?code&state[&device_id]    → вход/привязка → назад на сайт: #d37auth=<пропуск> | #d37link=<p> | #d37auth_err=<код>
//   GET  /api/oauth?a=providers                       → какие свои входы включены (без секретов)
//   POST /api/oauth?a=finish  {k, f}                  → пропуск + секрет вкладки → { token_hash } (одноразово, 3 мин)
//   POST /api/oauth?a=ticket  {p, b} + Bearer         → билет на привязку (только со свежим входом)
//   POST /api/oauth?a=tg      {user}                  → виджет Telegram: вход → { token_hash }
//   POST /api/oauth?a=tglink  {user} + Bearer         → виджет Telegram: привязка к своему аккаунту
// Сервис выключен (нет переменных в Vercel или нет auth-links.sql) — кнопки нет, адреса отвечают «выключено».
import {
  OWN, config, enabled, PROVIDERS, rnd, shaB64, shaHex, pkceChallenge, safeEq, sign, unsign, seal, unseal, safeNext,
  cookieName, cookieSet, cookieGet, tgWidgetCheck, userFromBearer, isFresh, sqlReady, onceUse, loginOrCreate, TTL,
} from '../social.js';
import { sbRpc } from '../store.js';

const now = () => Date.now() / 1000;
const B_RE = /^[A-Za-z0-9_-]{43}$/;   // отпечаток секрета вкладки: base64url(SHA-256)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function send(res, code, obj, extra = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
function go(res, url, cookie) {
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');   // адрес с state / билетом не уходит в сервис в Referer
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end('');
}
// Назад на сайт — только своё начало адреса и фрагмент (#…): ни на сервер, ни в Referer он не уходит
const back = (c, res, frag, cookie) => go(res, `${c.site}/#${frag}`, cookie);
const errFrag = (code, p) => `d37auth_err=${encodeURIComponent(code)}&p=${encodeURIComponent(p || '')}`;

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  if (typeof req.on !== 'function') return {};
  const raw = await new Promise(resolve => {
    let s = '', n = 0;
    req.on('data', d => { n += d.length; if (n <= 16384) s += d; });
    req.on('end', () => resolve(n <= 16384 ? s : ''));
    req.on('error', () => resolve(''));
  });
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
// POST только со своей страницы: JSON и свой Origin (форма с чужого сайта сюда не пройдёт)
function ownPost(c, req) {
  if (req.method !== 'POST') return false;
  const ct = String((req.headers || {})['content-type'] || '');
  if (!/^application\/json\b/i.test(ct)) return false;
  const o = String((req.headers || {}).origin || '');
  return !o || o === c.site;
}

// ── Какие свои входы включены ──
async function providers(c, res) {
  const on = c.store && await sqlReady();
  const tg = on && c.tg ? (c.tg.mode === 'widget' ? { mode: 'widget', bot: c.tg.bot, id: +c.tg.id } : { mode: 'oidc' }) : false;
  return send(res, 200, { ok: true, vk: !!(on && c.vk), yandex: !!(on && c.yandex), tg }, { 'Cache-Control': 'public, max-age=60, s-maxage=120' });
}

// ── Старт: состояние в куку, переход в сервис ──
async function start(c, req, res, p) {
  if (!enabled(c, p) || (p === 'tg' && c.tg.mode !== 'oidc') || !(await sqlReady())) return back(c, res, errFrag('off', p));
  const b = String(req.query.b || '');
  if (!B_RE.test(b)) return back(c, res, errFrag('state', p));
  const m = ['link', 'reauth'].includes(req.query.m) ? req.query.m : 'login';
  let u = null, at = 0, x = null;
  if (m === 'link') {
    const t = unsign(c, 'ticket', req.query.t);
    if (!t || t.p !== p || t.b !== b || typeof t.u !== 'string') return back(c, res, errFrag('reauth', p));
    u = t.u; at = +t.at || 0;
  }
  if (m === 'reauth') {   // «подтверди, что это ты»: войти можно только в этот же аккаунт
    x = String(req.query.u || '');
    if (!UUID_RE.test(x)) return back(c, res, errFrag('state', p));
  }
  const st = { p, s: rnd(32), v: rnd(32), b, m, u, at, x, n: safeNext(req.query.n), e: now() + TTL.STATE_TTL };
  return go(res, PROVIDERS[p].authorize(c, { state: st.s, challenge: pkceChallenge(st.v) }), cookieSet(cookieName(p), sign(c, 'state', st), TTL.STATE_TTL));
}

// ── Возврат из сервиса ──
async function callback(c, req, res, p) {
  const clear = cookieSet(cookieName(p), '', 0);
  if (!enabled(c, p) || (p === 'tg' && c.tg.mode !== 'oidc')) return back(c, res, errFrag('off', p), clear);
  const st = unsign(c, 'state', cookieGet(req, cookieName(p)));
  const q = req.query || {};
  if (!st || st.p !== p) return back(c, res, errFrag('state', p), clear);
  if (q.error) return back(c, res, errFrag('denied', p), clear);   // человек нажал «Отмена»
  if (!safeEq(q.state, st.s) || !q.code || String(q.code).length > 2048) return back(c, res, errFrag('state', p), clear);
  if (!(await onceUse('st:' + shaHex(st.s), 900))) return back(c, res, errFrag('used', p), clear);
  let prof;
  try { prof = await PROVIDERS[p].profile(c, q, st); }
  catch (e) { console.error('[oauth]', p, 'сервис:', String(e?.message || e).slice(0, 160)); return back(c, res, errFrag('provider', p), clear); }
  if (st.m === 'link') {
    let r;
    try { r = await sbRpc('auth_link_add', { p_user: st.u, p_provider: p, p_uid: prof.uid, p_name: prof.name || null, p_avatar: prof.avatar || null,
      p_auth_at: new Date((+st.at || 0) * 1000).toISOString() }); }
    catch (e) { r = { ok: false, reason: 'server' }; }
    return back(c, res, r?.ok ? `d37link=${p}` : errFrag(r?.reason || 'server', p), clear);
  }
  let r;
  try { r = await loginOrCreate(c, p, prof, req, { expect: st.m === 'reauth' ? st.x : null }); }
  catch (e) { console.error('[oauth]', p, 'вход:', String(e?.message || e).slice(0, 160)); r = { ok: false, reason: 'server' }; }
  if (!r.ok) return back(c, res, errFrag(r.reason, p), clear);
  const k = seal(c, { h: r.hashed, b: st.b, p, nw: r.isNew ? 1 : 0, n: r.isNew ? '#/profile' : st.n, e: now() + TTL.HANDOFF_TTL });
  return back(c, res, 'd37auth=' + k, clear);
}

// ── Пропуск → token_hash (только той вкладке, что начала вход) ──
async function finish(c, req, res) {
  if (!ownPost(c, req)) return send(res, 403, { ok: false, reason: 'bad' });
  const body = await readBody(req);
  const k = String(body.k || ''), f = String(body.f || '');
  const o = unseal(c, k);
  if (!o) return send(res, 200, { ok: false, reason: 'expired' });
  if (!f || f.length > 100 || !safeEq(shaB64(f), o.b)) return send(res, 200, { ok: false, reason: 'browser' });
  if (!(await onceUse('ho:' + shaHex(k), 900))) return send(res, 200, { ok: false, reason: 'used' });
  return send(res, 200, { ok: true, token_hash: o.h, provider: o.p, new: !!o.nw, next: safeNext(o.n) });
}

// ── Билет на привязку: только вошедшему и только со свежим входом ──
async function ticket(c, req, res) {
  if (!ownPost(c, req)) return send(res, 403, { ok: false, reason: 'bad' });
  const body = await readBody(req);
  const p = String(body.p || ''), b = String(body.b || '');
  if (!OWN.includes(p) || !enabled(c, p) || !(await sqlReady())) return send(res, 200, { ok: false, reason: 'off' });
  if (!B_RE.test(b)) return send(res, 200, { ok: false, reason: 'bad' });
  const who = await userFromBearer(req);
  if (!who) return send(res, 401, { ok: false, reason: 'auth' });
  if (!isFresh(who.at)) return send(res, 200, { ok: false, reason: 'reauth' });
  return send(res, 200, { ok: true, t: sign(c, 'ticket', { u: who.id, p, b, at: who.at, e: now() + TTL.TICKET_TTL }) });
}

// ── Виджет Telegram: вход или привязка (данные пришли в нашу же страницу — подпись бота, свежесть, один раз) ──
async function tgWidget(c, req, res, link) {
  if (!ownPost(c, req)) return send(res, 403, { ok: false, reason: 'bad' });
  if (!enabled(c, 'tg') || c.tg.mode !== 'widget' || !(await sqlReady())) return send(res, 200, { ok: false, reason: 'off' });
  const body = await readBody(req);
  const v = tgWidgetCheck(body.user, c.tg.token);
  if (!v.ok) return send(res, 200, { ok: false, reason: v.reason === 'old' ? 'expired' : 'bad' });
  let who = null;
  if (link) {
    who = await userFromBearer(req);
    if (!who) return send(res, 401, { ok: false, reason: 'auth' });
    if (!isFresh(who.at)) return send(res, 200, { ok: false, reason: 'reauth' });
  }
  if (!(await onceUse('tg:' + v.hash, 900))) return send(res, 200, { ok: false, reason: 'used' });
  if (link) {
    let r;
    try { r = await sbRpc('auth_link_add', { p_user: who.id, p_provider: 'tg', p_uid: v.uid, p_name: v.name || null, p_avatar: v.avatar || null,
      p_auth_at: new Date(who.at * 1000).toISOString() }); }
    catch (e) { r = { ok: false, reason: 'server' }; }
    return send(res, 200, r?.ok ? { ok: true } : { ok: false, reason: r?.reason || 'server' });
  }
  const x = String(body.x || '');
  if (x && !UUID_RE.test(x)) return send(res, 200, { ok: false, reason: 'bad' });
  let r;
  try { r = await loginOrCreate(c, 'tg', v, req, { expect: x || null }); }
  catch (e) { console.error('[oauth] tg вход:', String(e?.message || e).slice(0, 160)); r = { ok: false, reason: 'server' }; }
  if (!r.ok) return send(res, 200, { ok: false, reason: r.reason });
  return send(res, 200, { ok: true, token_hash: r.hashed, provider: 'tg', new: r.isNew, next: r.isNew ? '#/profile' : safeNext(body.n) });
}

export default async function oauth(req, res) {
  const c = config();
  const q = req.query || {};
  const a = String(q.a || ''), p = String(q.p || '');
  try {
    if (a === 'providers') return await providers(c, res);
    if (a === 'start' && OWN.includes(p)) return await start(c, req, res, p);
    if (a === 'callback' && OWN.includes(p)) return await callback(c, req, res, p);
    if (a === 'finish') return await finish(c, req, res);
    if (a === 'ticket') return await ticket(c, req, res);
    if (a === 'tg') return await tgWidget(c, req, res, false);
    if (a === 'tglink') return await tgWidget(c, req, res, true);
  } catch (e) {
    console.error('[oauth]', a, p, String(e?.message || e).slice(0, 160));
    if (a === 'start' || a === 'callback') return back(c, res, errFrag('server', p));
    return send(res, 500, { ok: false, reason: 'server' });
  }
  return send(res, 404, { ok: false, reason: 'not_found' });
}

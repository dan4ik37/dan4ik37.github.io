// /go/<id>?t=<подпись> → api/pages.js?page=go — переход по прямой рекламе (кабинет рекламодателя #/adv, ads.sql):
// засчитать клик (ad_go: раз в час на зрителя, без своих кликов, роботов и флуда — решает база) и перенаправить (302) на
// сайт рекламодателя. Ссылку берём только из базы и ещё раз проверяем (https, без коротких ссылок и запрещённых тем) —
// подделать адрес перехода нельзя. Закончившаяся кампания — переход есть (старая вкладка), клик не считается;
// отклонённая / заблокированная / нет такой — страница «реклама больше не показывается». ?d=1 — отладка, клик не считаем.
// /api/geo → page=geo — только код страны зрителя (Vercel знает по IP): реклама без erid в России не показывается.
import { storeConfigured, sbRpc } from '../store.js';
import { urlBad } from '../ad-rules.js';
import { page } from '../page.js';

export function clientIp(req) {
  const h = req.headers || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim().slice(0, 64);
}

function gone(res, code) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(code).send(page({
    title: 'Реклама больше не показывается — dan4ik37',
    noindex: true, noAds: true,
    body: `<main class="wrap narrow"><h1>Реклама больше не показывается</h1>
  <p class="muted">Эта реклама закончилась или снята с показа. Ничего страшного — загляни на сайт.</p>
  <p class="cta" style="justify-content:center"><a class="btn btn-acc" href="/">На главную</a><a class="btn btn-ghost" href="/games">Игры</a></p></main>`,
  }));
}

export default async function go(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const id = String(req.query.id || '');
  if (!/^[a-z0-9]{6,16}$/.test(id)) return gone(res, 404);
  const debug = String(req.query.d || '') === '1';
  const token = debug ? '' : String(req.query.t || '').slice(0, 200);
  const ua = String((req.headers || {})['user-agent'] || '').slice(0, 300);
  if (!storeConfigured()) return gone(res, 503);
  let r = null;
  try { r = await sbRpc('ad_go', { p_id: id, p_token: token, p_ip: clientIp(req), p_ua: ua }); } catch (e) { r = null; }
  if (!r || !r.ok || typeof r.url !== 'string' || urlBad(r.url)) return gone(res, r ? 410 : 503);
  res.setHeader('Location', r.url);
  res.status(302).send('');
}

export function geo(req, res) {
  const c = String((req.headers || {})['x-vercel-ip-country'] || '').toUpperCase();
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({ c: /^[A-Z]{2}$/.test(c) ? c : '' }));
}

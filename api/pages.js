// api/pages.js — одна функция на несколько серверных страниц (rewrites в vercel.json → ?page=…).
// Зачем: тариф Vercel Hobby — не больше 12 серверных функций на проект; каждая страница отдельным
// файлом в api/ = отдельная функция, на 13-й выкладка падала. Сами страницы — api/_lib/routes/*.js
// (в _lib — не функции). Новая серверная страница → файл в routes + строка в ROUTES + rewrite.
import videos from './_lib/routes/videos.js';
import topic from './_lib/routes/topic.js';
import history from './_lib/routes/history.js';
import nick from './_lib/routes/nick.js';
import ids from './_lib/routes/ids.js';
import reklama from './_lib/routes/reklama.js';
import vip from './_lib/routes/vip.js';
import fonts from './_lib/routes/fonts.js';
import cps from './_lib/routes/cps.js';
import about from './_lib/routes/about.js';
import feed from './_lib/routes/feed.js';
import top from './_lib/routes/top.js';
import quiz from './_lib/routes/quiz.js';
import wheel from './_lib/routes/wheel.js';
import random from './_lib/routes/random.js';
import typing from './_lib/routes/typing.js';
import ugc from './_lib/routes/ugc.js';
import shop from './_lib/routes/shop.js';
import legal from './_lib/routes/legal.js';
import invite from './_lib/routes/invite.js';
import adgo, { geo } from './_lib/routes/adgo.js';   // реклама за 💎: переход /go/<id> и страна /api/geo
import adsterms from './_lib/routes/adterms.js';     // реклама за 💎: правила для рекламодателей /ads-terms
import ref from './_lib/routes/ref.js';               // 👥 приглашение друга /r/<код>
import oauth from './_lib/routes/oauth.js';          // вход через VK ID, Яндекс ID, Telegram: /auth/<p>/start|callback, /api/oauth

const ROUTES = { videos, topic, history, nick, ids, reklama, vip, fonts, cps, about, feed, top, quiz, wheel, random, typing, ugc,
  shop, terms: legal, refund: legal, contacts: legal, invite, go: adgo, geo, adsterms, oauth, r: ref };

export default function handler(req, res) {
  const route = ROUTES[String(req.query.page || '')];
  if (!route) { res.status(404).send('Not found'); return; }
  return route(req, res);
}

// api/pages.js — одна функция на несколько серверных страниц (rewrites в vercel.json → ?page=…).
// Зачем: тариф Vercel Hobby — не больше 12 серверных функций на проект; каждая страница отдельным
// файлом в api/ = отдельная функция, на 13-й выкладка падала. Сами страницы — api/_lib/routes/*.js
// (в _lib — не функции). Новая серверная страница → файл в routes + строка в ROUTES + rewrite.
import videos from './_lib/routes/videos.js';
import topic from './_lib/routes/topic.js';
import history from './_lib/routes/history.js';
import nick from './_lib/routes/nick.js';
import ids from './_lib/routes/ids.js';

const ROUTES = { videos, topic, history, nick, ids };

export default function handler(req, res) {
  const route = ROUTES[String(req.query.page || '')];
  if (!route) { res.status(404).send('Not found'); return; }
  return route(req, res);
}

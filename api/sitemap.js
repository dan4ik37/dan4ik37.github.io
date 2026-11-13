// api/sitemap.js — карта сайта для поисковиков (rewrites в vercel.json):
//   /sitemap.xml        — индекс: ссылки на две карты ниже (его и отправили в Search Console и Вебмастер);
//   /sitemap-pages.xml  — основные страницы: главная, разделы сайта (/chat, /shorts…), игры, архив, темы, VIP, генератор ников,
//                         форум (/forum, /forum/<id>) и идеи (/ideas, /ideas/<id>) — серверные страницы api/_lib/routes/forum.js;
//   /sitemap-videos.xml — страницы роликов /v/<id> (~6000).
// Зачем две: через неделю Google «обнаружил» 6000+ адресов, но читал в основном тонкие страницы роликов,
// а до главной и игр не дошёл. Раздельно — основные идут своей картой, и в Search Console видно, что из
// каждой попало в поиск.
import { SITE, ALL_UPLOADS, getUploads, esc, isShortVideo } from './_lib/yt.js';
import { videoFromSnapshot } from './_lib/video-snap.js';
import { GAME_PAGES } from './_lib/games-seo.js';
import { TOPICS } from './_lib/topics.js';
import { QUIZZES } from './_lib/quizzes.js';
import { sbSelect, storeConfigured, oldDb } from './_lib/store.js';
import { makeForumBlocks } from './_lib/forum-blocks.js';
const FB = makeForumBlocks();   // адрес статьи форума — FB.slug, как в forum.sql
import { payConfig } from './_lib/pay.js';
import { sellerReady } from './_lib/seller.js';

const url = (loc, freq, prio, lastmod) =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${freq ? `<changefreq>${freq}</changefreq>` : ''}<priority>${prio}</priority></url>`;

export default async function handler(req, res) {
  const part = String(req.query.part || '');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');

  if (part !== 'pages' && part !== 'videos') {
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>${SITE}/sitemap-pages.xml</loc><lastmod>${today}</lastmod></sitemap>
<sitemap><loc>${SITE}/sitemap-videos.xml</loc><lastmod>${today}</lastmod></sitemap>
</sitemapindex>
`);
  }

  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) { /* без роликов — основные страницы всё равно отдаём */ }
  // игры игроков из каталога (прошли модерацию) — ugc.sql
  let ugc = [];
  if (part === 'pages' && storeConfigured()) { try { ugc = await sbSelect('ugc_games', 'status=eq.public&select=id,updated_at&order=plays.desc&limit=500'); } catch (e) { ugc = []; } }
  // темы форума и идеи для видео (без отклонённых) — свежие сверху
  let threads = [], ideas = [];
  if (part === 'pages' && storeConfigured()) {
    // форум 2.0 (T-157): только опубликованные статьи для всех (до 12+), адрес /forum/<id>-<slug>, дата — правка или публикация;
    // старая база (forum.sql 2.0 не запущен) — как раньше
    try { threads = (await sbSelect('forum_threads', 'status=eq.published&age_min=lte.12&realm=eq.kids&select=id,title,created_at,published_at,edited_at,tags&order=published_at.desc&limit=2000'))
      .map(t => ({ ...t, path: '/forum/' + t.id + (FB.slug(t.title) ? '-' + FB.slug(t.title) : ''), created_at: t.edited_at || t.published_at || t.created_at })); }
    catch (e) {   // старая база — только при «нет такой колонки»; любой другой сбой — без статей (не раскрыть скрытые и «на проверке»)
      threads = [];
      if (oldDb(e)) { try { threads = await sbSelect('forum_threads', 'select=id,created_at&order=created_at.desc&limit=2000'); } catch (e2) { threads = []; } }
    }
    try { ideas = await sbSelect('ideas', 'status=neq.rejected&select=id,created_at,status_changed_at&order=created_at.desc&limit=2000'); } catch (e) { ideas = []; }
  }
  const day = d => esc(String(d || '').slice(0, 10));

  // 05.11.2026: шортсы — не в карте (их страницы noindex: короткий клип, часто кусок того же стрима; api/video.js)
  const longVid = v => !isShortVideo(v.title, v.publishedAt, videoFromSnapshot(v.id)?.contentDetails?.duration || '');
  const urls = part === 'videos'
    ? vids.filter(longVid).map(v => url(`${SITE}/v/${esc(v.id)}`, '', '0.4', esc(String(v.publishedAt).slice(0, 10))))
    : [
      url(`${SITE}/`, 'daily', '1.0'),
      url(`${SITE}/about`, 'weekly', '0.9'),
      // разделы сайта с настоящими адресами (js/ui/router.js); личное и служебное (/profile, /phone, /adv, /invite, /play…) — не здесь
      url(`${SITE}/shorts`, 'daily', '0.7'),
      url(`${SITE}/chat`, 'weekly', '0.6'),
      url(`${SITE}/forum`, 'daily', '0.7'),
      ...threads.map(t => url(`${SITE}${esc(t.path || '/forum/' + t.id)}`, 'weekly', '0.6', day(t.created_at))),
      ...[...new Set(threads.flatMap(t => Array.isArray(t.tags) ? t.tags : []).filter(x => /^[a-zа-яё0-9-]{2,24}$/.test(x)))].slice(0, 300)
        .map(x => url(`${SITE}/forum/t/${esc(encodeURIComponent(x))}`, 'weekly', '0.4')),
      url(`${SITE}/ideas`, 'daily', '0.6'),
      ...ideas.map(i => url(`${SITE}/ideas/${esc(i.id)}`, 'monthly', '0.4', day(i.status_changed_at || i.created_at))),
      // 05.11.2026: /donate, /lfg, /soundboard, /poll, /clicker — разделы-приложения: сервер отдаёт по этим адресам ту же главную
      // (index.html), своё у них появляется только после JS — роботу без JS это 5 копий главной. В карте их нет (сами разделы есть).
      url(`${SITE}/games`, 'weekly', '0.9'),
      ...GAME_PAGES.map(g => url(`${SITE}/games/${g.id}`, 'monthly', '0.9')),
      url(`${SITE}/tools/nick`, 'monthly', '0.8'),
      url(`${SITE}/tools/fonts`, 'monthly', '0.8'),
      url(`${SITE}/tools/cps`, 'monthly', '0.8'),
      url(`${SITE}/tools/wheel`, 'monthly', '0.8'),
      url(`${SITE}/studio`, 'weekly', '0.8'),
      ...ugc.map(g => url(`${SITE}/g/${esc(g.id)}`, 'weekly', '0.5', esc(String(g.updated_at).slice(0, 10)))),
      url(`${SITE}/tools/random`, 'monthly', '0.8'),
      url(`${SITE}/tools/typing`, 'monthly', '0.8'),
      url(`${SITE}/tools/photo`, 'monthly', '0.9'),
      url(`${SITE}/quiz`, 'monthly', '0.8'),
      ...QUIZZES.map(q => url(`${SITE}/quiz/${q.slug}`, 'monthly', '0.8')),
      url(`${SITE}/videos`, 'daily', '0.8'),
      url(`${SITE}/top`, 'weekly', '0.8'),
      url(`${SITE}/topics`, 'weekly', '0.8'),
      ...TOPICS.flatMap(t => {
        const n = vids.filter(v => t.re.test(v.title)).length;
        if (n < 30) return [];
        return Array.from({ length: Math.ceil(n / 120) }, (_, i) => url(`${SITE}/topic/${t.slug}${i ? '?p=' + (i + 1) : ''}`, 'weekly', i ? '0.4' : '0.7'));
      }),
      url(`${SITE}/history`, 'monthly', '0.6'),
      url(`${SITE}/vip`, 'monthly', '0.6'),
      ...(payConfig().any ? [url(`${SITE}/shop`, 'monthly', '0.6')] : []),   // оплата не подключена — /shop noindex (routes/shop.js)
      url(`${SITE}/reklama`, 'weekly', '0.5'),
      ...Array.from({ length: Math.max(0, Math.ceil(vids.length / 240) - 1) }, (_, i) => url(`${SITE}/videos?p=${i + 2}`, 'weekly', '0.4')),
      url(`${SITE}/privacy`, 'yearly', '0.2'),
      ...(sellerReady() ? [url(`${SITE}/terms`, 'yearly', '0.2'), url(`${SITE}/refund`, 'yearly', '0.2')] : []),   // без реквизитов — noindex (routes/legal.js)
      url(`${SITE}/contacts`, 'yearly', '0.3'),
    ];

  res.setHeader('Cache-Control', vids.length ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=600');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}

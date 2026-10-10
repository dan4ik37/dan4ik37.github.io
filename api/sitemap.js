// api/sitemap.js — карта сайта для поисковиков (rewrites в vercel.json):
//   /sitemap.xml        — индекс: ссылки на две карты ниже (его и отправили в Search Console и Вебмастер);
//   /sitemap-pages.xml  — основные страницы (~70): главная, игры, архив, темы, VIP, генератор ников…;
//   /sitemap-videos.xml — страницы роликов /v/<id> (~6000).
// Зачем две: через неделю Google «обнаружил» 6000+ адресов, но читал в основном тонкие страницы роликов,
// а до главной и игр не дошёл. Раздельно — основные идут своей картой, и в Search Console видно, что из
// каждой попало в поиск.
import { SITE, ALL_UPLOADS, getUploads, esc } from './_lib/yt.js';
import { GAME_PAGES } from './_lib/games-seo.js';
import { TOPICS } from './_lib/topics.js';
import { QUIZZES } from './_lib/quizzes.js';
import { sbSelect, storeConfigured } from './_lib/store.js';

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

  const urls = part === 'videos'
    ? vids.map(v => url(`${SITE}/v/${esc(v.id)}`, '', '0.4', esc(String(v.publishedAt).slice(0, 10))))
    : [
      url(`${SITE}/`, 'daily', '1.0'),
      url(`${SITE}/about`, 'weekly', '0.9'),
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
      url(`${SITE}/reklama`, 'weekly', '0.5'),
      ...Array.from({ length: Math.max(0, Math.ceil(vids.length / 240) - 1) }, (_, i) => url(`${SITE}/videos?p=${i + 2}`, 'weekly', '0.4')),
      url(`${SITE}/privacy`, 'yearly', '0.2'),
    ];

  res.setHeader('Cache-Control', vids.length ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=600');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}

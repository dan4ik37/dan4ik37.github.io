// api/sitemap.js — /sitemap.xml (rewrite в vercel.json): главная, страницы игр (/games) + /v/<id> для роликов канала.
// Раньше был статический sitemap.xml с одной главной — поисковик не знал ни об одном ролике.
import { SITE, getUploads, esc } from './_lib/yt.js';
import { GAME_PAGES } from './_lib/games-seo.js';

export default async function handler(req, res) {
  let vids = [];
  try { vids = await getUploads(1000); } catch (e) { /* без роликов — хотя бы главная */ }

  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE}/games</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...GAME_PAGES.map(g => `<url><loc>${SITE}/games/${g.id}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`),
    `<url><loc>${SITE}/privacy</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>`,
    ...vids.map(v => `<url><loc>${SITE}/v/${esc(v.id)}</loc><lastmod>${esc(String(v.publishedAt).slice(0, 10))}</lastmod><priority>0.7</priority></url>`)
  ];

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', vids.length ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=600');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}

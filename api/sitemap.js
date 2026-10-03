// api/sitemap.js — /sitemap.xml (rewrite в vercel.json): главная, страницы игр (/games) + /v/<id> для роликов канала.
// Раньше был статический sitemap.xml с одной главной — поисковик не знал ни об одном ролике.
import { SITE, ALL_UPLOADS, getUploads, esc } from './_lib/yt.js';
import { GAME_PAGES } from './_lib/games-seo.js';
import { TOPICS } from './_lib/topics.js';

export default async function handler(req, res) {
  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) { /* без роликов — хотя бы главная */ }

  const urls = [
    `<url><loc>${SITE}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${SITE}/videos</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...Array.from({ length: Math.max(0, Math.ceil(vids.length / 240) - 1) }, (_, i) => `<url><loc>${SITE}/videos?p=${i + 2}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`),
    `<url><loc>${SITE}/history</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>`,
    `<url><loc>${SITE}/tools/nick</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`,
    `<url><loc>${SITE}/topics</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
    ...TOPICS.flatMap(t => {
      const n = vids.filter(v => t.re.test(v.title)).length;
      if (n < 30) return [];
      return Array.from({ length: Math.ceil(n / 120) }, (_, i) => `<url><loc>${SITE}/topic/${t.slug}${i ? '?p=' + (i + 1) : ''}</loc><changefreq>weekly</changefreq><priority>${i ? 0.5 : 0.8}</priority></url>`);
    }),
    `<url><loc>${SITE}/games</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>`,
    ...GAME_PAGES.map(g => `<url><loc>${SITE}/games/${g.id}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`),
    `<url><loc>${SITE}/privacy</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>`,
    ...vids.map(v => `<url><loc>${SITE}/v/${esc(v.id)}</loc><lastmod>${esc(String(v.publishedAt).slice(0, 10))}</lastmod><priority>0.7</priority></url>`)
  ];

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', vids.length ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=600');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}

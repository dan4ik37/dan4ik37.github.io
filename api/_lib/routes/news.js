// «Что нового» — записи о том, что изменилось на сайте и в движке D37: /news (список), /news/<slug> (запись), /news/rss.xml (RSS).
// Данные — api/_lib/news-posts.js (новая запись — scripts/news-add.py). Всё на сервере: роботу без JS видно всё.
// Реклама (правила 05.11, docs/areas/seo-ads.md): на списке — нет (там только анонсы); на записи — одно место под текстом и только
// если своего текста ≥ ADS_MIN_WORDS слов (как у /v/<id>: тонкая страница — без рекламы). Вернуть «без рекламы везде» — NEWS_ADS = false.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { POSTS, TAGS } from '../news-posts.js';

export const NEWS_ADS = true;
export const ADS_MIN_WORDS = 150;
const AD = '<div data-ad="forum_article" hidden></div>';   // блок «статья» (ads-core.js forum_article): такое же место под своим текстом
const RSS = `<link rel="alternate" type="application/rss+xml" title="dan4ik37 — что нового" href="${SITE}/news/rss.xml">`;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const ruDate = d => { const [y, m, dd] = String(d).split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
const iso = d => `${d}T12:00:00+03:00`;   // дата записи — день по МСК
const sorted = () => POSTS.map((p, i) => ({ p, i })).sort((a, b) => (a.p.date < b.p.date ? 1 : a.p.date > b.p.date ? -1 : a.i - b.i)).map(x => x.p);
const textOf = p => [p.lead, ...(p.body || []).flatMap(b => b.p ? [b.p] : b.h ? [b.h] : b.ul ? b.ul : [])].join(' ');
export const wordCount = p => (textOf(p).match(/[\p{L}\p{N}]+/gu) || []).length;
const adsOn = p => NEWS_ADS && wordCount(p) >= ADS_MIN_WORDS;
const abs = src => (/^https?:\/\//.test(src) ? src : SITE + src);
const safeHref = h => (/^\/[\w\-/]*$/.test(h) || /^https:\/\/[\w.-]+\/[\w\-./?=&%#]*$/.test(h) ? h : '/');

function bodyHtml(blocks){
  return (blocks || []).map(b => b.h ? `<h2>${esc(b.h)}</h2>`
    : b.ul ? `<ul>${b.ul.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
    : b.p ? `<p>${esc(b.p)}</p>` : '').join('\n');
}
const shotHtml = (s, first) => `<figure class="nw-shot"><img src="${esc(s.src)}" width="${+s.w || 1280}" height="${+s.h || 720}" alt="${esc(s.alt || '')}"${first ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">${s.cap ? `<figcaption>${esc(s.cap)}</figcaption>` : ''}</figure>`;
const tagHtml = t => TAGS[t] ? `<span class="nw-tag nw-${esc(t)}">${esc(TAGS[t])}</span>` : '';

function listPage(res){
  const url = `${SITE}/news`, list = sorted();
  const ld = { '@context': 'https://schema.org', '@type': 'Blog', name: 'Что нового на dan4ik37', url, inLanguage: 'ru',
    blogPost: list.map(p => ({ '@type': 'BlogPosting', headline: p.title, url: `${url}/${p.slug}`, datePublished: iso(p.date) })) };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/">Главная</a> › <span>Что нового</span></nav>
  <h1>Что нового на сайте и в движке D37</h1>
  <p class="nw-intro">Здесь — записи о том, что изменилось: новые выпуски нашего движка D37 (на нём сделана игра в разделе «Играть»), форум, чат и другие разделы сайта. В каждой записи — что сделано, снимки из игры и что пока работает слабо. Новые записи — сверху. Есть <a href="/news/rss.xml">RSS</a>.</p>
  <ul class="nw-list">${list.map(p => `
    <li><a class="nw-card" href="/news/${esc(p.slug)}">
      ${p.shots?.[0] ? `<img src="${esc(p.shots[0].src)}" width="320" height="180" alt="" loading="lazy" decoding="async">` : '<span class="nw-noimg" aria-hidden="true">📰</span>'}
      <span class="nw-meta"><time datetime="${esc(p.date)}">${esc(ruDate(p.date))}</time>${tagHtml(p.tag)}</span>
      <b>${esc(p.title)}</b><span class="nw-lead">${esc(p.lead)}</span></a></li>`).join('')}
  </ul>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(page({
    title: 'Что нового — выпуски движка D37 и обновления сайта | dan4ik37',
    description: 'Записи об обновлениях сайта dan4ik37: выпуски собственного движка D37 со снимками из игры, форум, чат и другие разделы — что сделано и что пока слабо.',
    url, image: abs(list.find(p => p.shots?.length)?.shots[0].src || '/og-image.jpg'), ld, body, css: CSS, noAds: true, head: RSS,
  }));
}

function postPage(res, p){
  const list = sorted(), k = list.indexOf(p), newer = list[k - 1], older = list[k + 1];
  const url = `${SITE}/news/${p.slug}`, ads = adsOn(p);
  const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.lead, url, mainEntityOfPage: url,
    datePublished: iso(p.date), dateModified: iso(p.date), inLanguage: 'ru',
    ...(p.shots?.length ? { image: p.shots.map(s => abs(s.src)) } : {}),
    author: { '@type': 'Person', name: 'dan4ik37', url: SITE + '/about' }, publisher: { '@type': 'Organization', name: 'dan4ik37', url: SITE + '/', logo: { '@type': 'ImageObject', url: SITE + '/icon-512.png' } } };
  const shots = p.shots || [];
  const body = `
<main class="wrap nw-post">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/news">Что нового</a> › <span>${esc(p.title)}</span></nav>
  <article>
    <p class="nw-meta"><time datetime="${esc(p.date)}">${esc(ruDate(p.date))}</time>${tagHtml(p.tag)}</p>
    <h1>${esc(p.title)}</h1>
    <p class="nw-leadp">${esc(p.lead)}</p>
    ${shots[0] ? shotHtml(shots[0], true) : ''}
    <div class="nw-body">${bodyHtml(p.body)}</div>
    ${shots.slice(1).map(s => shotHtml(s, false)).join('')}
    ${(p.links || []).length ? `<p class="nw-links">${p.links.map(([h, t]) => `<a href="${esc(safeHref(h))}">${esc(t)} →</a>`).join('')}</p>` : ''}
  </article>
  ${ads ? AD : ''}
  <nav class="nw-nav">${older ? `<a href="/news/${esc(older.slug)}"><small>← Раньше</small>${esc(older.title)}</a>` : '<span></span>'}${newer ? `<a class="r" href="/news/${esc(newer.slug)}"><small>Позже →</small>${esc(newer.title)}</a>` : '<span></span>'}</nav>
  <p class="nw-all"><a href="/news">Все записи «Что нового»</a></p>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(page({
    title: `${p.title} | dan4ik37`, description: p.lead, url, image: abs(shots[0]?.src || '/og-image.jpg'),
    ld, body, css: CSS, ogType: 'article', noAds: !ads, head: RSS,
  }));
}

function rss(res){
  const list = sorted().slice(0, 30);
  const x = s => esc(s);
  const items = list.map(p => `<item><title>${x(p.title)}</title><link>${SITE}/news/${x(p.slug)}</link><guid isPermaLink="true">${SITE}/news/${x(p.slug)}</guid>`
    + `<pubDate>${new Date(iso(p.date)).toUTCString()}</pubDate><category>${x(TAGS[p.tag] || '')}</category><description>${x(p.lead)}</description>`
    + (p.shots?.[0] ? `<enclosure url="${x(abs(p.shots[0].src))}" type="image/webp" length="0"/>` : '') + '</item>').join('\n');
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>dan4ik37 — что нового</title><link>${SITE}/news</link><language>ru</language>
<description>Выпуски движка D37 и обновления сайта dan4ik37</description>
<atom:link href="${SITE}/news/rss.xml" rel="self" type="application/rss+xml"/>
${list[0] ? `<lastBuildDate>${new Date(iso(list[0].date)).toUTCString()}</lastBuildDate>` : ''}
${items}
</channel></rss>
`);
}

function notFound(res){
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  res.status(404).send(page({ title: 'Запись не найдена | dan4ik37', url: '', noindex: true, css: CSS,
    body: '<main class="wrap"><h1>Такой записи нет</h1><p class="nw-intro">Возможно, адрес изменился. <a href="/news">Все записи «Что нового» →</a></p></main>' }));
}

// Для карты сайта (api/sitemap.js)
export const newsUrls = () => sorted().map(p => ({ path: '/news/' + p.slug, date: p.date }));

export default function handler(req, res){
  if (req.query.rss) return rss(res);
  const slug = String(req.query.slug || '');
  if (!slug) return listPage(res);
  const p = POSTS.find(x => x.slug === slug);
  return p ? postPage(res, p) : notFound(res);
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.nw-intro{margin-top:.8rem;max-width:820px;color:rgba(var(--text-rgb),.88);font-size:.95rem}
.nw-intro a,.nw-body a,.nw-links a,.nw-all a{color:var(--link)}
.nw-list{list-style:none;padding:0;margin-top:1.4rem;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:.9rem}
.nw-card{display:flex;flex-direction:column;gap:.45rem;height:100%;padding:.8rem;border-radius:16px;background:var(--card);border:1px solid var(--line);color:var(--text);text-decoration:none}
.nw-card img{width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:rgba(var(--fg-rgb),.05)}
.nw-noimg{display:flex;align-items:center;justify-content:center;aspect-ratio:16/9;border-radius:10px;background:rgba(var(--fg-rgb),.05);font-size:2.4rem}
.nw-card b{font-size:1rem;line-height:1.3}
.nw-lead{font-size:.84rem;color:rgba(var(--text-rgb),.78)}
.nw-meta{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;font-size:.75rem;color:var(--muted)}
.nw-tag{padding:.1rem .5rem;border-radius:999px;border:1px solid var(--line);font-weight:700}
.nw-engine{color:#7cc4ff}
.nw-site{color:#ffb86b}
.nw-post article{max-width:820px}
.nw-post h1{margin-top:.4rem}
.nw-leadp{margin-top:.7rem;font-size:1.02rem;color:rgba(var(--text-rgb),.92)}
.nw-shot{margin:1.2rem 0}
.nw-shot img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line)}
.nw-shot figcaption{margin-top:.4rem;font-size:.8rem;color:var(--muted)}
.nw-body h2{margin-top:1.4rem;font-size:1.15rem}
.nw-body p{margin-top:.7rem;font-size:.95rem;line-height:1.6;color:rgba(var(--text-rgb),.9)}
.nw-body ul{margin-top:.6rem;padding-left:1.2rem;display:flex;flex-direction:column;gap:.4rem;font-size:.93rem;line-height:1.5;color:rgba(var(--text-rgb),.9)}
.nw-links{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:1.2rem}
.nw-links a{display:inline-flex;align-items:center;min-height:40px;padding:.45rem .9rem;border-radius:10px;border:1px solid var(--line);background:rgba(var(--fg-rgb),.04);text-decoration:none;font-weight:700;font-size:.85rem}
.nw-nav{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:1.6rem;max-width:820px}
.nw-nav a{display:flex;flex-direction:column;gap:.2rem;padding:.7rem .9rem;border-radius:12px;background:var(--card);border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:.85rem}
.nw-nav a.r{text-align:right}
.nw-nav small{color:var(--muted)}
.nw-all{margin-top:1rem;font-size:.85rem}
@media (max-width:560px){.nw-nav{grid-template-columns:1fr}.nw-nav a.r{text-align:left}}
`;

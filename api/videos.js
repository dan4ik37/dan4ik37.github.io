// api/videos.js — /videos (rewrite в vercel.json): архив всех роликов канала по годам.
//
// Зачем: страницы /v/<id> есть на каждый ролик, но ссылались на них только главная (SPA, поисковик
// её почти не видит) и блок «Похожие». Здесь — одна обычная страница со ссылками на все ролики:
// поисковик находит и связывает их, человек может пролистать архив, старые видео не теряются.
// На канале ~6000 роликов — страницы по PER штук: /videos, /videos?p=2 …; годы ведут на страницу, где год начинается.
import { SITE, ALL_UPLOADS, getUploads, esc } from './_lib/yt.js';
import { page, YT_CHANNEL } from './_lib/page.js';
import { TOPICS } from './_lib/topics.js';

const PER = 240;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) { /* ниже — честная заглушка */ }

  if (!vids.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(503).send(page({
      title: 'Видео временно недоступны — dan4ik37',
      body: `<main class="wrap narrow"><h1>Не удалось загрузить список видео</h1>
        <p class="muted">Попробуй чуть позже или открой канал на YouTube.</p>
        <p><a class="btn btn-yt" href="${YT_CHANNEL}">▶ Канал на YouTube</a></p></main>`,
      noindex: true
    }));
  }

  const year = v => new Date(v.publishedAt).toLocaleDateString('ru-RU', { year: 'numeric', timeZone: 'Europe/Moscow' }).replace(/\D/g, '');
  const day = v => new Date(v.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  const n = vids.length;
  const pages = Math.ceil(n / PER);
  const p = Math.min(Math.max(parseInt(req.query.p, 10) || 1, 1), pages);
  const href = k => k > 1 ? `/videos?p=${k}` : '/videos';
  // Годы: сколько роликов и на какой странице год начинается
  const yearInfo = new Map();
  vids.forEach((v, i) => { const y = year(v); if (!yearInfo.has(y)) yearInfo.set(y, { count: 0, page: Math.floor(i / PER) + 1 }); yearInfo.get(y).count++; });
  const slice = vids.slice((p - 1) * PER, p * PER);
  const byYear = new Map();
  for (const v of slice) { const y = year(v); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(v); }
  const years = [...byYear.keys()];
  const url = SITE + href(p);
  const pager = pages > 1 ? `<nav class="pager">${p > 1 ? `<a href="${href(p - 1)}" rel="prev">← Новее</a>` : '<span></span>'}<b>Страница ${p} из ${pages}</b>${p < pages ? `<a href="${href(p + 1)}" rel="next">Старее →</a>` : '<span></span>'}</nav>` : '';
  const plural = n % 10 === 1 && n % 100 !== 11 ? 'ролик' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'ролика' : 'роликов';

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', name: 'Все видео dan4ik37', url, inLanguage: 'ru', isPartOf: { '@type': 'WebSite', name: 'dan4ik37', url: SITE + '/' } },
      { '@type': 'ItemList', numberOfItems: n, itemListElement: slice.slice(0, 100).map((v, i) => ({ '@type': 'ListItem', position: (p - 1) * PER + i + 1, url: `${SITE}/v/${v.id}`, name: v.title })) },
    ]
  };

  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Все видео</span></nav>
  <h1>Все видео dan4ik37</h1>
  <p class="lead">Архив YouTube-канала dan4ik37 — ${n.toLocaleString('ru')} ${plural}, от новых к старым. Нажми на ролик — откроется его страница с описанием и похожими видео.</p>
  <div class="cta">
    <a class="btn btn-yt" href="${YT_CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">▶ Подписаться на канал</a>
    <button type="button" class="btn btn-ghost" onclick="d37Surprise(this)">🎲 Удиви меня</button>
    <a class="btn btn-ghost" href="/games">🎮 Игры на сайте</a>
  </div>
  <nav class="topics"><b>По играм:</b> ${TOPICS.map(t => [t, vids.filter(v => t.re.test(v.title)).length]).filter(([, c]) => c >= 30).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, c]) => `<a href="/topic/${t.slug}">${esc(t.name)}<small>${c.toLocaleString('ru')}</small></a>`).join('')}<a href="/topics">все игры →</a></nav>
  <nav class="years">${[...yearInfo].map(([y, info]) => `<a href="${href(info.page)}#y${y}"${byYear.has(y) ? ' class="on"' : ''}>${y}<small>${info.count.toLocaleString('ru')}</small></a>`).join('')}</nav>
  ${years.map((y, i) => `
  <section class="more" id="y${y}">
    <h2>${y}</h2>
    <div class="grid">${byYear.get(y).map(v => `<a class="card" href="/v/${esc(v.id)}"><img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy" width="320" height="180"><span>${esc(v.title)}</span><small>${esc(day(v))}</small></a>`).join('')}</div>
  </section>${i === 0 ? '\n  <div data-ad="video_page" hidden></div>' : ''}`).join('')}
  ${pager}
</main>`;

  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: p > 1 ? `Все видео dan4ik37 — страница ${p} из ${pages}` : `Все видео dan4ik37 — архив роликов (${n.toLocaleString('ru')})`,
    description: `Все ${n} ${plural} YouTube-канала dan4ik37 по годам: игры, стримы, шортсы. Смотри прямо на сайте.`,
    url, image: SITE + '/og-image.jpg', ld, body, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:720px}
.years{position:sticky;top:58px;z-index:4;display:flex;gap:.4rem;flex-wrap:wrap;margin-top:1.6rem;padding:.5rem 0;background:rgba(8,8,14,.85);backdrop-filter:blur(8px)}
.years a{padding:.35rem .8rem;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-weight:800;font-size:.8rem}
.years a:hover{border-color:var(--accent)}
.years small{margin-left:.35rem;color:var(--muted);font-weight:600}
.topics{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin-top:1.2rem;font-size:.8rem}
.topics b{margin-right:.3rem;color:var(--muted)}
.topics a{padding:.3rem .75rem;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-weight:700}
.topics a:hover{border-color:var(--accent)}
.topics small{margin-left:.3rem;color:var(--muted);font-weight:600}
.years a.on{border-color:var(--accent);background:rgba(255,45,85,.12)}
.pager{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:2rem;font-size:.85rem}
.pager a{padding:.6rem 1.1rem;border-radius:12px;border:1px solid var(--line);text-decoration:none;font-weight:800}
.pager a:hover{border-color:var(--accent)}
.card small{padding:0 .8rem .8rem;margin-top:-.4rem;font-size:.7rem;color:var(--muted)}
`;

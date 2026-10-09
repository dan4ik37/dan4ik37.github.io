// /top — «Самые популярные видео dan4ik37»: топ по просмотрам из ВСЕХ роликов канала (просмотры — из снимка
// video-details.js на дату снимка, без квоты API). Отдельно ролики и шортсы. Ролики про кейсы/промокоды на депозит
// (isGambling) сюда не попадают — на странице реклама, а AdSense запрещает её рядом с азартными играми.
import { SITE, ALL_UPLOADS, getUploads, isGambling, esc, fmtCount, fmtDuration } from '../yt.js';
import { page } from '../page.js';
import { videoFromSnapshot } from '../video-snap.js';
import { DETAILS_AT } from '../video-details.js';

const secs = iso => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };
const N = 50;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) {}
  const rows = vids.map(v => { const s = videoFromSnapshot(v.id); return s ? { ...v, views: +(s.statistics.viewCount || 0), dur: s.contentDetails.duration } : null; })
    .filter(v => v && v.views && !isGambling(v.title));
  if (!rows.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(503).send(page({ title: 'Популярные видео — dan4ik37', noindex: true,
      body: `<main class="wrap narrow"><h1>Не удалось загрузить данные</h1><p class="muted">Попробуй чуть позже.</p></main>` }));
  }
  // Шортсы: с 15.10.2024 YouTube разрешил до 3 минут, раньше — до минуты
  const isShort = v => /#shorts?\b/i.test(v.title) || secs(v.dur) <= (Date.parse(v.publishedAt) >= Date.parse('2024-10-15') ? 180 : 60);
  const byViews = (a, b) => b.views - a.views;
  const longs = rows.filter(v => !isShort(v)).sort(byViews).slice(0, N);
  const shorts = rows.filter(isShort).sort(byViews).slice(0, N);
  const onDate = new Date(DETAILS_AT).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const year = v => new Date(v.publishedAt).getFullYear();
  const card = (v, i) => `<a class="tp-card" href="/v/${esc(v.id)}"><span class="tp-n">${i + 1}</span>
    <span class="tp-img"><img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy" width="320" height="180">${v.dur ? `<i>${esc(fmtDuration(v.dur))}</i>` : ''}</span>
    <span class="tp-t">${esc(v.title)}</span><small>👁 ${esc(fmtCount(v.views))} · ${year(v)}</small></a>`;
  const url = `${SITE}/top`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Самые популярные видео dan4ik37', url,
    itemListElement: longs.slice(0, 10).map((v, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/v/${v.id}`, name: v.title })) };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/videos">Все видео</a> › <span>Самые популярные</span></nav>
  <h1>Самые популярные видео dan4ik37</h1>
  <p class="lead">Топ по просмотрам из всех ${rows.length.toLocaleString('ru')} роликов канала — отдельно видео и шортсы. Просмотры по данным YouTube на ${esc(onDate)}.</p>
  <nav class="tp-tabs"><a href="#videos">🎬 Видео</a><a href="#shorts">⚡ Шортсы</a><a href="/history">📜 История канала</a></nav>
  <section id="videos"><h2>Видео — топ ${longs.length}</h2><div class="tp-grid">${longs.map(card).join('')}</div></section>
  <div data-ad="video_page" hidden></div>
  <section id="shorts"><h2>Шортсы — топ ${shorts.length}</h2><div class="tp-grid">${shorts.map(card).join('')}</div></section>
  <p class="all"><a href="/videos">Все видео по годам →</a> · <a href="/topics">Игры канала</a> · <button type="button" class="btn btn-ghost" onclick="d37Surprise(this)">🎲 Удиви меня</button></p>
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: 'Самые популярные видео dan4ik37 — топ по просмотрам',
    description: `Топ-${N} видео и шортсов dan4ik37 по просмотрам: ${longs.slice(0, 3).map(v => v.title).join(' · ').slice(0, 200)}`,
    url, image: longs[0] ? `https://i.ytimg.com/vi/${longs[0].id}/hqdefault.jpg` : '', ld, body, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.tp-tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:1.2rem 0 .4rem}
.tp-tabs a{display:inline-flex;align-items:center;min-height:40px;padding:.45rem .9rem;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.04);text-decoration:none;font-weight:700;font-size:.85rem}
section{margin-top:1.6rem}
.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.9rem}
.tp-card{position:relative;display:flex;flex-direction:column;gap:.4rem;text-decoration:none;border-radius:14px;overflow:hidden;background:var(--card);border:1px solid var(--line);padding-bottom:.7rem;transition:transform .25s,border-color .25s}
.tp-card:hover{transform:translateY(-3px);border-color:rgba(255,64,64,.5)}
.tp-n{position:absolute;top:.5rem;left:.5rem;z-index:1;min-width:30px;height:30px;padding:0 .4rem;border-radius:9px;background:rgba(0,0,0,.75);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.85rem}
.tp-card:nth-child(1) .tp-n{background:#d4a017;color:#000}.tp-card:nth-child(2) .tp-n{background:#a8b3c2;color:#000}.tp-card:nth-child(3) .tp-n{background:#b87333;color:#000}
.tp-img{position:relative;display:block}
.tp-img img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.tp-img i{position:absolute;right:.4rem;bottom:.4rem;padding:.1rem .4rem;border-radius:5px;background:rgba(0,0,0,.8);font-style:normal;font-size:.72rem;font-weight:800}
.tp-t{padding:0 .8rem;font-size:.82rem;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tp-card small{padding:0 .8rem;color:var(--muted);font-size:.74rem}
`;

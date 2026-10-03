// api/history.js — /history: «История канала» по годам — только из настоящих данных YouTube:
// сколько роликов вышло за год, во что больше всего играл (темы из api/_lib/topics.js), первое видео
// года. Ничего не выдумываем: текста «от автора» тут нет — только цифры и ссылки на ролики.
import { SITE, ALL_UPLOADS, getUploads, esc } from '../yt.js';
import { page, YT_CHANNEL } from '../page.js';
import { TOPICS } from '../topics.js';

const ru = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let vids = [];
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) {}
  if (!vids.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(503).send(page({ title: 'История канала — dan4ik37', noindex: true,
      body: `<main class="wrap narrow"><h1>Не удалось загрузить данные</h1><p class="muted">Попробуй чуть позже.</p></main>` }));
  }
  const year = v => new Date(v.publishedAt).toLocaleDateString('ru-RU', { year: 'numeric', timeZone: 'Europe/Moscow' }).replace(/\D/g, '');
  const date = v => new Date(v.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  const byYear = new Map();
  for (const v of vids) { const y = year(v); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(v); }
  const years = [...byYear.keys()].sort();            // от старых к новым — это история
  const max = Math.max(...years.map(y => byYear.get(y).length));
  const first = vids[vids.length - 1];
  const topicIndex = new Map();                        // id → номер в общем архиве (для «страницы» /videos)

  const yearsHtml = years.map(y => {
    const list = byYear.get(y);                        // внутри года — от новых к старым
    const n = list.length;
    const topics = TOPICS.filter(t => t.slug !== 'horror').map(t => [t, list.filter(v => t.re.test(v.title)).length])
      .filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const horror = list.filter(v => TOPICS.find(t => t.slug === 'horror').re.test(v.title)).length;
    const firstOfYear = list[list.length - 1];
    const idx = vids.indexOf(firstOfYear);
    return `<section class="hy">
      <div class="hy-year"><b>${y}</b><small>${n.toLocaleString('ru')} ${ru(n, 'ролик', 'ролика', 'роликов')}</small></div>
      <div class="hy-body">
        <div class="hy-bar"><i style="width:${Math.max(2, Math.round(100 * n / max))}%"></i></div>
        ${topics.length ? `<p class="hy-games">Больше всего: ${topics.map(([t, c]) => `<a href="/topic/${t.slug}">${esc(t.name)}</a> <small>${c}</small>`).join(' · ')}${horror >= 3 ? ` · <a href="/topic/horror">хорроры</a> <small>${horror}</small>` : ''}</p>` : ''}
        <a class="hy-first" href="/v/${esc(firstOfYear.id)}"><img src="${esc(firstOfYear.thumb)}" alt="${esc(firstOfYear.title)}" loading="lazy" width="160" height="90"><span><small>Первое видео ${y} года · ${esc(date(firstOfYear))}</small>${esc(firstOfYear.title)}</span></a>
        <a class="hy-more" href="/videos?p=${Math.floor(idx / 240) + 1}#y${y}">Все ролики ${y} года →</a>
      </div>
    </section>`;
  }).join('');

  const url = `${SITE}/history`;
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/videos">Все видео</a> › <span>История канала</span></nav>
  <h1>История канала dan4ik37</h1>
  <p class="lead">Канал на YouTube — с ${year(first)} года: ${vids.length.toLocaleString('ru')} ${ru(vids.length, 'ролик', 'ролика', 'роликов')}. Год за годом — сколько вышло видео и во что больше всего играли. Всё посчитано по самим роликам.</p>
  <a class="hy-origin" href="/v/${esc(first.id)}"><img src="${esc(first.thumb)}" alt="${esc(first.title)}" width="320" height="180"><span><small>С чего всё началось · ${esc(date(first))}</small><b>${esc(first.title)}</b></span></a>
  <div class="hy-list">${yearsHtml}</div>
  <div data-ad="video_page" hidden></div>
  <p class="all"><a href="/videos">Все видео →</a> · <a href="/topics">Игры канала</a> · <button type="button" class="btn btn-ghost" onclick="d37Surprise(this)">🎲 Удиви меня</button></p>
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: `История канала dan4ik37 — ${years[0]}–${years[years.length - 1]}`,
    description: `Как менялся канал dan4ik37 с ${years[0]} года: ${vids.length.toLocaleString('ru')} роликов, по годам — сколько видео и во что играл.`,
    url, image: first.thumb ? first.thumb.replace('mqdefault', 'hqdefault') : SITE + '/og-image.jpg', body, css: CSS,
    ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'История канала dan4ik37', url, inLanguage: 'ru' }
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:760px}
.hy-origin{display:flex;gap:1rem;align-items:center;margin-top:1.4rem;padding:.8rem;border-radius:16px;background:linear-gradient(135deg,rgba(255,209,102,.1),var(--card) 60%);border:1px solid rgba(255,209,102,.35);text-decoration:none;max-width:720px}
.hy-origin img{width:200px;height:auto;border-radius:10px;flex:none}
.hy-origin span{display:flex;flex-direction:column;gap:.3rem}
.hy-origin small{color:#ffd166;font-weight:800;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em}
.hy-list{margin-top:1.6rem;display:flex;flex-direction:column;gap:0;border-left:2px solid var(--line);margin-left:.6rem}
.hy{position:relative;display:grid;grid-template-columns:120px 1fr;gap:1rem;padding:1rem 0 1.2rem 1.4rem}
.hy::before{content:'';position:absolute;left:-7px;top:1.35rem;width:12px;height:12px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px rgba(255,45,85,.2)}
.hy-year b{display:block;font-family:Oswald,sans-serif;font-size:1.8rem;line-height:1}
.hy-year small{color:var(--muted);font-size:.75rem}
.hy-body{display:flex;flex-direction:column;gap:.55rem;min-width:0}
.hy-bar{height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;margin-top:.5rem}
.hy-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.hy-games{font-size:.82rem;color:rgba(240,240,248,.8)}
.hy-games a{font-weight:700}
.hy-games small{color:var(--muted)}
.hy-first{display:flex;gap:.7rem;align-items:center;text-decoration:none;padding:.5rem;border-radius:12px;background:var(--card);border:1px solid var(--line);max-width:560px}
.hy-first:hover{border-color:rgba(255,45,85,.5)}
.hy-first img{width:120px;height:auto;border-radius:8px;flex:none}
.hy-first span{display:flex;flex-direction:column;gap:.2rem;font-size:.8rem;font-weight:700;min-width:0}
.hy-first small{color:var(--muted);font-weight:600;font-size:.68rem}
.hy-more{font-size:.78rem;font-weight:700;color:var(--accent);text-decoration:none}
.all .btn{padding:.4rem .8rem;font-size:.75rem;vertical-align:middle}
@media(max-width:600px){.hy{grid-template-columns:1fr;gap:.4rem}.hy-origin{flex-direction:column;align-items:flex-start}.hy-origin img{width:100%}}
`;

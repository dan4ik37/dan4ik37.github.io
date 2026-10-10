// api/topic.js — страницы тем: /topics (все игры канала) и /topic/<slug> (все ролики по игре).
// rewrites в vercel.json. Темы и правила подбора — api/_lib/topics.js (по названиям роликов).
// Зачем: люди ищут «roblox dead rails», «silksong прохождение», а не имя канала — у каждой игры
// своя страница со всеми роликами, ссылками на /v/<id> и на соседние темы.
import { SITE, ALL_UPLOADS, getUploads, isGambling, esc, fmtCount } from '../yt.js';
import { videoFromSnapshot } from '../video-snap.js';
import { QUIZZES } from '../quizzes.js';
import { page, YT_CHANNEL } from '../page.js';
import { TOPICS, TOPIC_INTRO, topicOf } from '../topics.js';

const PER = 120;
const ru = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
const vids = n => `${n.toLocaleString('ru')} ${ru(n, 'ролик', 'ролика', 'роликов')}`;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const slug = String(req.query.slug || '');
  const t = slug ? topicOf(slug) : null;
  if (slug && !t) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(404).send(page({ title: 'Тема не найдена — dan4ik37', noindex: true, css: CSS,
      body: `<main class="wrap narrow"><h1>Такой темы нет</h1><p><a class="btn btn-acc" href="/topics">Все игры канала →</a></p></main>` }));
  }

  let all = [];
  try { all = await getUploads(ALL_UPLOADS); } catch (e) { /* ниже — заглушка */ }
  if (!all.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(503).send(page({ title: 'Видео временно недоступны — dan4ik37', noindex: true, css: CSS,
      body: `<main class="wrap narrow"><h1>Не удалось загрузить видео</h1><p class="muted">Попробуй чуть позже.</p>
        <p><a class="btn btn-yt" href="${YT_CHANNEL}">▶ Канал на YouTube</a></p></main>` }));
  }
  all = all.filter(v => !isGambling(v.title));   // кейсы/депозит — не на страницах игр (реклама, правила AdSense)
  const counts = new Map(TOPICS.map(x => [x.slug, all.filter(v => x.re.test(v.title)).length]));
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800');
  return res.status(200).send(t ? topicPage(t, all, counts, req) : hubPage(counts));
}

function chips(counts, cur){
  return `<nav class="chips">${TOPICS.filter(x => counts.get(x.slug) >= 30).map(x =>
    `<a href="/topic/${x.slug}"${x.slug === cur ? ' class="on"' : ''}>${esc(x.name)}<small>${counts.get(x.slug).toLocaleString('ru')}</small></a>`).join('')}</nav>`;
}

function card(v, views){
  const d = new Date(v.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' });
  return `<a class="card" href="/v/${esc(v.id)}"><img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy" width="320" height="180"><span>${esc(v.title)}</span><small>${views ? '👁 ' + esc(fmtCount(views)) + ' · ' : ''}${esc(d)}</small></a>`;
}

function hubPage(counts){
  const url = `${SITE}/topics`;
  const list = TOPICS.filter(x => counts.get(x.slug) >= 30);
  const ld = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Игры на канале dan4ik37', url, inLanguage: 'ru',
    hasPart: list.map(x => ({ '@type': 'CollectionPage', name: x.name, url: `${SITE}/topic/${x.slug}` })) };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/videos">Все видео</a> › <span>Игры</span></nav>
  <h1>Во что играет dan4ik37</h1>
  <p class="lead">Все ролики канала, разложенные по играм. Выбери игру — откроются все видео по ней, от новых к старым.</p>
  <div class="tgrid">${list.map(x => `<a class="tcard" href="/topic/${x.slug}"><b>${esc(x.name)}</b><small>${vids(counts.get(x.slug))}</small><span>${esc(x.about)}</span></a>`).join('')}</div>
  <div data-ad="video_page" hidden></div>
  <p class="all"><a href="/videos">Все видео канала →</a> · <a href="/games">🎮 Игры на сайте</a></p>
</main>`;
  return page({ title: 'Во что играет dan4ik37 — все игры канала', description: `Ролики dan4ik37 по играм: ${list.slice(0, 8).map(x => x.name).join(', ')} и другие.`,
    url, image: SITE + '/og-image.jpg', ld, body, css: CSS });
}

// «Самые популярные» по теме — просмотры из снимка (video-details.js), без роликов про кейсы/депозит (на странице реклама)
function popularOf(list, n){
  return list.map(v => ({ v, views: +(videoFromSnapshot(v.id)?.statistics?.viewCount || 0) }))
    .filter(x => x.views && !isGambling(x.v.title)).sort((a, b) => b.views - a.views).slice(0, n);
}

function topicPage(t, all, counts, req){
  const list = all.filter(v => t.re.test(v.title));
  const quiz = QUIZZES.find(q => q.topic === t.slug);
  const n = list.length;
  const pages = Math.max(1, Math.ceil(n / PER));
  const p = Math.min(Math.max(parseInt(req.query.p, 10) || 1, 1), pages);
  const href = k => `/topic/${t.slug}${k > 1 ? '?p=' + k : ''}`;
  const url = SITE + href(p);
  const slice = list.slice((p - 1) * PER, p * PER);
  const first = list.length ? new Date(list[list.length - 1].publishedAt).getFullYear() : '';
  const last = list.length ? new Date(list[0].publishedAt).getFullYear() : '';
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', name: `${t.name} — видео dan4ik37`, url, inLanguage: 'ru', about: { '@type': 'VideoGame', name: t.name } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Игры канала', item: SITE + '/topics' },
      { '@type': 'ListItem', position: 3, name: t.name, item: `${SITE}/topic/${t.slug}` }] },
    { '@type': 'ItemList', itemListElement: slice.slice(0, 50).map((v, i) => ({ '@type': 'ListItem', position: (p - 1) * PER + i + 1, url: `${SITE}/v/${v.id}`, name: v.title })) },
  ] };
  const pager = pages > 1 ? `<nav class="pager">${p > 1 ? `<a href="${href(p - 1)}" rel="prev">← Новее</a>` : '<span></span>'}<b>Страница ${p} из ${pages}</b>${p < pages ? `<a href="${href(p + 1)}" rel="next">Старее →</a>` : '<span></span>'}</nav>` : '';
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/topics">Игры канала</a> › <span>${esc(t.name)}</span></nav>
  <h1>${esc(t.name)} — видео dan4ik37</h1>
  <p class="lead">${esc(t.about)} На канале — ${vids(n)}${first && first !== last ? `, с ${first} по ${last} год` : ''}. От новых к старым.</p>
  ${p === 1 && TOPIC_INTRO[t.slug] ? `<p class="intro">${esc(TOPIC_INTRO[t.slug])}</p>` : ''}
  <div class="cta">
    <a class="btn btn-yt" href="${YT_CHANNEL}?sub_confirmation=1" target="_blank" rel="noopener">▶ Подписаться на канал</a>
    <button type="button" class="btn btn-ghost" onclick="d37Surprise(this)">🎲 Удиви меня</button>
    ${quiz ? `<a class="btn btn-ghost" href="/quiz/${quiz.slug}">🧩 Тест: ${esc(quiz.title)}</a>` : '<a class="btn btn-ghost" href="/games">🎮 Поиграть на сайте</a>'}
  </div>
  ${p === 1 && list.length >= 16 ? (() => { const pop = popularOf(list, 8); return pop.length >= 4 ? `<section class="more"><h2>🔥 Самые популярные</h2><div class="grid">${pop.map(x => card(x.v, x.views)).join('')}</div></section><h2 class="all-h">Все видео — от новых к старым</h2>` : ''; })() : ''}
  <section class="more"><div class="grid">${slice.map(v => card(v)).join('')}</div></section>
  ${pager}
  <div data-ad="video_page" hidden></div>
  <section class="more"><h2>Другие игры канала</h2>${chips(counts, t.slug)}</section>
  ${t.slug === 'horror' ? '<div class="secret-spot"><button type="button" class="d37-secret" data-secret="horror" aria-label="Секретный знак">✦</button></div>' : ''}
</main>`;
  const title = p > 1 ? `${t.name} — видео dan4ik37, страница ${p}` : `${t.name} — все видео dan4ik37 (${n.toLocaleString('ru')})`;
  return page({ title, description: `${t.name}: ${vids(n)} dan4ik37 — ${t.about}`.slice(0, 300), url, image: list[0]?.thumb || SITE + '/og-image.jpg', ld, body, css: CSS });
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:760px}
.chips{display:flex;flex-wrap:wrap;gap:.45rem}
.chips a{padding:.4rem .85rem;border-radius:999px;border:1px solid var(--line);text-decoration:none;font-weight:700;font-size:.8rem}
.chips a:hover,.chips a.on{border-color:var(--accent)}
.chips a.on{background:rgba(255,45,85,.12)}
.chips small{margin-left:.35rem;color:var(--muted);font-weight:600}
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.9rem;margin-top:1.6rem}
.tcard{display:flex;flex-direction:column;gap:.3rem;padding:1rem 1.1rem;border-radius:16px;background:var(--card);border:1px solid var(--line);text-decoration:none;transition:border-color .2s,transform .2s}
.tcard:hover{border-color:rgba(255,45,85,.5);transform:translateY(-2px)}
.tcard b{font-size:1rem}
.tcard small{color:var(--accent);font-weight:800;font-size:.75rem}
.tcard span{font-size:.78rem;color:var(--muted);line-height:1.45}
.card small{padding:0 .8rem .8rem;margin-top:-.4rem;font-size:.7rem;color:var(--muted)}
.all-h{margin-top:2.2rem}
.intro{margin-top:.7rem;max-width:820px;color:rgba(240,240,248,.75);font-size:.92rem;line-height:1.65}
.pager{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:2rem;font-size:.85rem}
.pager a{padding:.6rem 1.1rem;border-radius:12px;border:1px solid var(--line);text-decoration:none;font-weight:800}
.pager a:hover{border-color:var(--accent)}
`;

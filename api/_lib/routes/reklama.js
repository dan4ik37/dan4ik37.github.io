// /reklama → api/pages.js?page=reklama — медиакит для рекламодателей: живые цифры канала из YouTube API
// (подписчики, просмотры, частота роликов, средние просмотры свежих видео, игры), форматы и контакты.
// Цифры — только настоящие, цен нет («по договорённости»). Ссылку владелец отправляет брендам.
import { SITE, ALL_UPLOADS, getUploads, getChannelStats, getVideoStats, esc, fmtCount } from '../yt.js';
import { page, YT_CHANNEL } from '../page.js';
import { TOPICS } from '../topics.js';

const TG = 'https://t.me/+LE25p4pQojkyYjli';
const VK = 'https://vk.com/dan4ik37';
const MAIL = 'dan4ik37k@gmail.com';
const ru = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  let ch = null, recent = [], stats = [], all = [];
  try {
    [ch, all] = await Promise.all([getChannelStats(), getUploads(ALL_UPLOADS)]);
    recent = all.slice(0, 200);
    stats = await getVideoStats(recent.slice(0, 50).map(v => v.id));
  } catch (e) { /* ниже — без цифр */ }

  const now = Date.now();
  // За год, а не за месяц: перерывы между сериями роликов бывают долгими, годовая цифра честнее показывает канал
  const lastYear = all.filter(v => now - Date.parse(v.publishedAt) < 365 * 864e5).length;
  const views = stats.map(s => +s.viewCount || 0).filter(n => n > 0).sort((a, b) => a - b);
  const median = views.length ? views[Math.floor(views.length / 2)] : 0;
  const top = stats.slice().sort((a, b) => (+b.viewCount || 0) - (+a.viewCount || 0)).slice(0, 4)
    .map(s => ({ ...recent.find(v => v.id === s.id), views: +s.viewCount || 0 })).filter(v => v.id);
  const games = TOPICS.filter(t => t.slug !== 'horror').map(t => [t, recent.filter(v => t.re.test(v.title)).length])
    .filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const since = ch?.publishedAt ? new Date(ch.publishedAt).getFullYear() : 2016;

  const card = (big, small) => `<div class="mk-stat"><b>${big}</b><small>${small}</small></div>`;
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Реклама и сотрудничество</span></nav>
  <h1>Реклама у dan4ik37</h1>
  <p class="lead">Игровой стример и ютубер с ${since} года: шортсы и стримы по Roblox, CS2, Minecraft, хоррорам и новинкам. Ниже — живые цифры канала (обновляются автоматически) и форматы сотрудничества.</p>
  ${ch ? `<section class="mk-stats">
    ${card(fmtCount(ch.subscriberCount), 'подписчиков на YouTube')}
    ${card(fmtCount(ch.viewCount), 'просмотров всего')}
    ${card((+ch.videoCount).toLocaleString('ru'), 'видео на канале')}
    ${card(lastYear.toLocaleString('ru'), `${ru(lastYear, 'ролик', 'ролика', 'роликов')} за последний год`)}
    ${median ? card(fmtCount(median), 'просмотров — медиана 50 свежих видео') : ''}
  </section>
  <p class="muted small">Данные YouTube на ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' })}. Статистику Twitch, TikTok и Telegram пришлём по запросу.</p>`
  : '<p class="muted">Цифры канала временно не загрузились — напишите, пришлём статистику.</p>'}

  ${games.length ? `<section class="box"><h2>О чём контент сейчас</h2><p class="mk-games">${games.map(([t, c]) => `<a href="/topic/${t.slug}">${esc(t.name)}</a> <small>${c}</small>`).join(' · ')}</p>
    <p class="muted small">Сколько из 200 последних роликов — по каждой игре.</p></section>` : ''}

  ${top.length ? `<section class="more"><h2>Самые просматриваемые из свежих</h2><div class="grid">${top.map(v => `<a class="card" href="/v/${esc(v.id)}"><img src="${esc(v.thumb)}" alt="${esc(v.title)}" loading="lazy" width="320" height="180"><span>${esc(v.title)}</span><small>👁 ${fmtCount(v.views)}</small></a>`).join('')}</div></section>` : ''}

  <section class="box"><h2>Форматы</h2>
    <div class="mk-formats">
      <div><b>🎬 Интеграция в видео</b><span>Упоминание или обзор в ролике / шортсе, ссылка в описании.</span></div>
      <div><b>🔴 Реклама на стриме</b><span>Упоминание в эфире, баннер или ссылка в чате.</span></div>
      <div><b>✈️ Пост в соцсетях</b><span>Telegram и ВКонтакте.</span></div>
      <div><b>🖥 Баннер на сайте</b><span>Аккуратное место на dan4ik37.vercel.app — без всплывающих окон.</span></div>
      <div><b>🎁 Розыгрыш</b><span>Конкурс для зрителей с вашим призом.</span></div>
    </div>
    <p class="muted small">Стоимость и даты — по договорённости.</p>
  </section>

  <aside class="join"><div><b>Обсудить сотрудничество</b><span>Напишите, что хотите прорекламировать и в каком формате — ответим с условиями.</span></div>
    <div class="mk-cta"><a class="btn btn-acc" href="${TG}" target="_blank" rel="noopener">✈ Telegram</a><a class="btn btn-ghost" href="${VK}" target="_blank" rel="noopener">ВКонтакте</a><a class="btn btn-ghost" href="mailto:${MAIL}?subject=%D0%A0%D0%B5%D0%BA%D0%BB%D0%B0%D0%BC%D0%B0">📧 ${MAIL}</a></div></aside>
  <p class="all"><a href="${YT_CHANNEL}" target="_blank" rel="noopener">Канал на YouTube →</a> · <a href="/history">История канала</a> · <a href="/videos">Все видео</a></p>
</main>`;
  res.setHeader('Cache-Control', ch ? 'public, s-maxage=21600, stale-while-revalidate=604800' : 'public, s-maxage=300');
  res.status(200).send(page({
    title: 'Реклама у dan4ik37 — медиакит игрового стримера',
    description: ch ? `Медиакит dan4ik37: ${fmtCount(ch.subscriberCount)} подписчиков, ${fmtCount(ch.viewCount)} просмотров, ${lastYear.toLocaleString("ru")} ${ru(lastYear, "ролик", "ролика", "роликов")} за год. Интеграции в видео, реклама на стримах, посты, баннер на сайте.` : 'Медиакит игрового стримера dan4ik37: форматы рекламы и контакты.',
    url: `${SITE}/reklama`, image: ch?.thumb || SITE + '/og-image.jpg', body, css: CSS,
    ld: { '@context': 'https://schema.org', '@type': 'ProfilePage', name: 'Реклама у dan4ik37', url: `${SITE}/reklama`, inLanguage: 'ru' }
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:760px}
.small{font-size:.75rem;margin-top:.6rem}
.mk-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.8rem;margin-top:1.4rem}
.mk-stat{padding:1rem 1.1rem;border-radius:16px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;gap:.2rem}
.mk-stat b{font-family:Oswald,sans-serif;font-size:2rem;line-height:1;background:linear-gradient(135deg,#fff,#ffb3c4);-webkit-background-clip:text;background-clip:text;color:transparent}
.mk-stat small{font-size:.74rem;color:var(--muted)}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.mk-games a{font-weight:700}
.mk-games small{color:var(--muted)}
.mk-formats{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.7rem}
.mk-formats div{display:flex;flex-direction:column;gap:.25rem;padding:.8rem .9rem;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
.mk-formats span{font-size:.8rem;color:var(--muted)}
.card small{padding:0 .8rem .8rem;margin-top:-.4rem;font-size:.72rem;color:var(--muted)}
.mk-cta{display:flex;gap:.5rem;flex-wrap:wrap}
`;

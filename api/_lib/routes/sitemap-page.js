// /sitemap — карта сайта для людей (14.11.2026, AdSense «Бесполезный контент»): все разделы на одной странице. Открытые поисковикам
// адреса (/sitemap-pages.xml, api/sitemap.js) — все здесь, включая записи /news; кроме них — входы в видео и сообщество (они сами
// noindex после «диеты индекса», но людям нужны). Списки тем роликов (/topic/*) не повторяем — они на /topics. Без рекламы.
import { SITE, esc } from '../yt.js';
import { page, SITE_LD, DEVLOG_URL } from '../page.js';
import { GAME_PAGES } from '../games-seo.js';
import { QUIZZES } from '../quizzes.js';
import { POSTS } from '../news-posts.js';
import { payConfig } from '../pay.js';
import { sellerReady } from '../seller.js';

// инструменты — те же, что в sitemap-pages.xml
export const TOOLS = [
  ['/tools/nick', 'Генератор ников', 'ники для игр по стилю и теме'],
  ['/tools/fonts', 'Шрифты для ника', 'красивые буквы и символы, которые вставляются в игры и соцсети'],
  ['/tools/cps', 'CPS тест', 'сколько кликов в секунду ты делаешь'],
  ['/tools/typing', 'Тест скорости печати', 'знаки в минуту и ошибки'],
  ['/tools/wheel', 'Колесо фортуны', 'свои варианты, честный случайный выбор'],
  ['/tools/random', 'Генератор случайных чисел', 'числа, монетка и кубики'],
  ['/tools/photo', 'Фоторедактор онлайн', 'слои, обрезка, текст и фильтры в браузере'],
];

export default async function handler(req, res) {
  const url = `${SITE}/sitemap`;
  const li = (href, name, note) => `<li><a href="${esc(href)}">${esc(name)}</a>${note ? ` <span class="muted">— ${esc(note)}</span>` : ''}</li>`;
  const sec = (h, items, more = '') => items.length ? `<section class="sm-box"><h2>${h}</h2><ul class="sm-list">${items.join('')}</ul>${more}</section>` : '';
  const site = [
    li('/', 'Главная', 'новые ролики, стримы и игры'),
    li('/about', 'О сайте и авторе', 'кто ведёт сайт, как делаются игры, модерация и защита детей'),
    ...(DEVLOG_URL ? [li(DEVLOG_URL, 'Дневник разработки', 'что изменилось на сайте и в играх')] : []),
    li('/contacts', 'Контакты', 'почта и реквизиты'),
    li('/privacy', 'Политика конфиденциальности', 'какие данные собираются, реклама и cookie'),
    li('/vip', '«Донатер» и VIP', 'что даёт поддержка сайта'),
    ...(payConfig().any ? [li('/shop', 'Магазин кристаллов 💎')] : []),
    li('/reklama', 'Реклама у dan4ik37', 'медиакит для рекламодателей'),
    ...(sellerReady() ? [li('/terms', 'Пользовательское соглашение'), li('/refund', 'Политика возврата')] : []),
  ];
  const games = GAME_PAGES.map(g => li(`/games/${g.id}`, g.name));
  const quiz = QUIZZES.map(q => li(`/quiz/${q.slug}`, q.title));
  const tools = TOOLS.map(([u, n, d]) => li(u, n, d));
  const video = [
    li('/videos', 'Все видео', 'архив роликов по годам'),
    li('/top', 'Самые популярные', 'топ по просмотрам'),
    li('/topics', 'Игры канала', 'ролики, разложенные по играм'),
    li('/history', 'История канала', 'как менялся канал год за годом'),
    li('/shorts', 'Shorts', 'короткие моменты со стримов'),
  ];
  const news = [...POSTS].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).map(p => li(`/news/${p.slug}`, p.title, p.date.split('-').reverse().join('.')));
  const people = [
    li('/forum', 'Форум', 'статьи, гайды и новости игр от игроков'),
    li('/ideas', 'Идеи для видео', 'предложи тему ролика и голосуй за чужие'),
    li('/chat', 'Чат', 'общий чат сайта и чат Twitch'),
    li('/studio', 'Студия игр', 'конструктор, в котором игроки делают свои игры'),
  ];
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/">Главная</a> › <span>Карта сайта</span></nav>
  <h1>Карта сайта</h1>
  <p class="sm-lead">Все разделы сайта dan4ik37 на одной странице: ${esc(String(GAME_PAGES.length))} онлайн-игр, ${esc(String(QUIZZES.length))} тестов, ${esc(String(TOOLS.length))} инструментов для игроков, видео канала по играм и годам, форум и чат.</p>
  ${sec('О сайте', site)}
  ${sec(`Игры онлайн (${GAME_PAGES.length})`, games, '<p class="muted sm-more"><a href="/games">Все игры с описаниями и рекордами →</a></p>')}
  ${sec('Инструменты для игроков', tools)}
  ${sec(`Тесты (${QUIZZES.length})`, quiz, '<p class="muted sm-more"><a href="/quiz">Все тесты →</a></p>')}
  ${sec('Дневник разработки', news, `<p class="muted sm-more"><a href="${esc(DEVLOG_URL || '/news')}">Все записи →</a></p>`)}
  ${sec('Видео канала', video)}
  ${sec('Сообщество', people)}
</main>`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    ...SITE_LD,
    { '@type': 'WebPage', '@id': url, url, name: 'Карта сайта dan4ik37', inLanguage: 'ru', isPartOf: { '@id': SITE + '/#website' } },
  ] };
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'Карта сайта dan4ik37 — все игры, тесты, инструменты и разделы',
    description: `Все разделы сайта dan4ik37 на одной странице: ${GAME_PAGES.length} онлайн-игр, ${QUIZZES.length} тестов, инструменты для игроков, видео по играм, форум и чат.`,
    url, image: SITE + '/og-image.jpg', ld, body, css: CSS, noAds: true,
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.sm-lead{margin-top:.8rem;max-width:820px;color:rgba(var(--text-rgb),.9)}
.sm-box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.sm-list{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:.35rem 1.2rem;font-size:.9rem}
.sm-list li{padding:.25rem 0;line-height:1.4}
.sm-list a{color:var(--link);font-weight:700}
.sm-list .muted{font-size:.8rem}
.sm-more{margin-top:.7rem;font-size:.85rem}
.sm-more a{color:var(--link)}
`;

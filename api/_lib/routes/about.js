// /about — «Кто такой dan4ik37»: справка об авторе для людей, поисковиков и ИИ-помощников (ChatGPT, Алиса и др.
// отвечают по тому, что нашли в поиске). Только настоящие данные: цифры YouTube (getChannelStats), игры — по названиям
// всех роликов (TOPICS), первое/последнее видео — из списка загрузок. Ничего не выдумывать: личных фактов (имя,
// возраст, город) здесь нет, пока их не даст сам владелец.
import { SITE, ALL_UPLOADS, getUploads, getChannelStats, esc, fmtCount } from '../yt.js';
import { page, YT_CHANNEL } from '../page.js';
import { TOPICS } from '../topics.js';

const SOCIAL = [
  ['YouTube', YT_CHANNEL], ['Twitch', 'https://www.twitch.tv/dan4ik37'], ['TikTok', 'https://www.tiktok.com/@.dan4ik37'],
  ['ВКонтакте', 'https://vk.com/dan4ik37'], ['Telegram', 'https://t.me/+LE25p4pQojkyYjli'],
];
const ruDate = d => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
const num = n => Number(n || 0).toLocaleString('ru-RU');

export default async function handler(req, res) {
  const url = `${SITE}/about`;
  let ch = null, vids = [];
  try { ch = await getChannelStats(); } catch (e) { /* без цифр — страница всё равно нужна */ }
  try { vids = await getUploads(ALL_UPLOADS); } catch (e) { /* без списка роликов */ }
  const since = ch?.publishedAt ? ruDate(ch.publishedAt) : '';
  const today = ruDate(Date.now());
  const games = TOPICS.map(t => ({ t, n: vids.filter(v => t.re.test(v.title)).length })).filter(x => x.n >= 30).sort((a, b) => b.n - a.n);
  const top = games.slice(0, 6).map(x => x.t.name);
  const first = vids[vids.length - 1], last = vids[0];
  const subs = ch ? num(ch.subscriberCount) : '', views = ch ? fmtCount(ch.viewCount) : '', count = ch ? num(ch.videoCount) : num(vids.length);

  const lead = `dan4ik37 (читается «Денчик37») — русскоязычный ютубер и стример, автор игрового YouTube-канала ${ch?.title || 'Dan4ik37'} (${ch?.handle || '@dan4ik37yt'}).`
    + (since ? ` Канал ведётся с ${since}: ${count} видео, ${subs} подписчиков и ${views} просмотров (данные YouTube на ${today}).` : '');
  const faq = [
    ['Кто такой dan4ik37?', lead],
    ['Как читается ник dan4ik37?', '«Денчик37»: цифра 4 заменяет букву «ч», как часто делают в никах.'],
    ...(ch ? [['Сколько подписчиков у dan4ik37?', `На YouTube-канале ${ch.title} — ${subs} подписчиков и ${views} просмотров (на ${today}).`]] : []),
    ...(top.length ? [['Во что играет dan4ik37?', `Больше всего роликов на канале по играм: ${top.join(', ')}. Ещё — хорроры, инди и шортсы с моментами со стримов.`]] : []),
    ['Где стримит dan4ik37?', 'Прямые эфиры — на Twitch (twitch.tv/dan4ik37), ролики и шортсы — на YouTube, клипы — в TikTok. Анонсы — в Telegram и ВКонтакте.'],
    ...(since ? [['Когда dan4ik37 создал канал?', `YouTube-канал создан ${since}.${first ? ` Самое раннее видео в списке загрузок — «${first.title}» (${ruDate(first.publishedAt)}).` : ''}`]] : []),
    ['Как связаться с dan4ik37?', 'По рекламе и сотрудничеству — почта dan4ik37k@gmail.com или раздел «Реклама» на сайте. Пообщаться — в чате на сайте dan4ik37.vercel.app и на стримах.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'ProfilePage', url, name: 'Кто такой dan4ik37', inLanguage: 'ru', dateModified: new Date().toISOString().slice(0, 10), mainEntity: { '@id': SITE + '/#person' } },
    { '@type': 'Person', '@id': SITE + '/#person', name: 'dan4ik37', alternateName: ['Денчик37', 'Dan4ik37', ch?.handle || '@dan4ik37yt'], url: SITE + '/',
      image: ch?.thumb || SITE + '/icon-512.png', description: lead, jobTitle: 'Ютубер и стример', knowsLanguage: 'ru',
      sameAs: SOCIAL.map(s => s[1]),
      ...(ch ? { agentInteractionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: +ch.subscriberCount } } : {}) },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const fact = (k, v) => v ? `<div><dt>${k}</dt><dd>${v}</dd></div>` : '';
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Кто такой dan4ik37</span></nav>
  <h1>Кто такой dan4ik37 (Денчик37)</h1>
  <p class="lead">${esc(lead)}</p>
  <dl class="ab-facts">
    ${fact('YouTube-канал', `<a href="${YT_CHANNEL}" target="_blank" rel="noopener">${esc(ch?.title || 'Dan4ik37')} · ${esc(ch?.handle || '@dan4ik37yt')}</a>`)}
    ${fact('На YouTube с', esc(since))}
    ${fact('Видео', esc(count))}
    ${fact('Подписчики', esc(subs))}
    ${fact('Просмотры', ch ? esc(num(ch.viewCount)) : '')}
    ${fact('Стримы', '<a href="https://www.twitch.tv/dan4ik37" target="_blank" rel="noopener">Twitch — dan4ik37</a>')}
    ${fact('Сайт', '<a href="/#/home">dan4ik37.vercel.app</a> — чат, игры с друзьями, все видео')}
  </dl>
  ${games.length ? `<section class="box"><h2>Во что играет</h2><p>Темы по названиям всех ${esc(num(vids.length))} роликов канала:</p>
    <ul class="ab-games">${games.slice(0, 12).map(x => `<li><a href="/topic/${x.t.slug}">${esc(x.t.name)}</a><span>${esc(num(x.n))} видео</span></li>`).join('')}</ul>
    <p class="muted">Все темы — <a href="/topics">«Игры канала»</a>, по годам — <a href="/history">«История канала»</a>.</p></section>` : ''}
  ${first && last ? `<section class="box"><h2>Первое и последнее видео</h2><ul class="ab-vids">
    <li><small>Самое раннее в списке загрузок · ${esc(ruDate(first.publishedAt))}</small><a href="/v/${esc(first.id)}">${esc(first.title)}</a></li>
    <li><small>Самое новое · ${esc(ruDate(last.publishedAt))}</small><a href="/v/${esc(last.id)}">${esc(last.title)}</a></li>
  </ul><p class="muted"><a href="/top">Самые популярные видео →</a> · <a href="/videos">Все видео по годам →</a></p></section>` : ''}
  <section class="box"><h2>Где найти dan4ik37</h2><div class="ab-soc">${SOCIAL.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${n}</a>`).join('')}</div></section>
  <section class="box"><h2>Сайт dan4ik37</h2><ul>
    <li><a href="/#/chat">Живой чат</a> — общий чат сайта и чат Twitch, уровни и XP за активность.</li>
    <li><a href="/games">Онлайн-игры с друзьями</a> — «5 букв» со словом дня, морской бой, города, шашки и другие, по ссылке без регистрации.</li>
    <li><a href="/quiz">Тесты</a> — какой ты моб из Майнкрафта, кто ты из FNAF и Роблокса, какой ты зритель.</li>
    <li>Полезное для игроков — <a href="/tools/nick">генератор ников</a>, <a href="/tools/fonts">шрифты для ника</a>, <a href="/tools/cps">CPS тест</a>, <a href="/tools/wheel">колесо фортуны</a>.</li>
    <li><a href="/vip">VIP</a> за поддержку — цветной ник, стикеры, своя тема сайта.</li>
  </ul></section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details${q.startsWith('Кто') ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', ch ? 'public, s-maxage=21600, stale-while-revalidate=604800' : 'public, s-maxage=600');
  res.status(200).send(page({
    title: 'Кто такой dan4ik37 (Денчик37) — ютубер и стример | dan4ik37',
    description: lead.slice(0, 300),
    url, image: ch?.thumb || SITE + '/icon-512.png', ld, body, css: CSS, ogType: 'profile'
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.9);max-width:820px;font-size:1rem}
.ab-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.6rem;margin-top:1.4rem}
.ab-facts div{padding:.8rem 1rem;border-radius:14px;background:var(--card);border:1px solid var(--line)}
.ab-facts dt{font-size:.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ab-facts dd{margin-top:.2rem;font-weight:700;font-size:.95rem}
.ab-facts a,.box a{color:#7cc4ff}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.box p{font-size:.9rem;color:rgba(240,240,248,.86)}
.box ul{padding-left:1.2rem;display:flex;flex-direction:column;gap:.45rem;font-size:.9rem;color:rgba(240,240,248,.86)}
.ab-games{list-style:none;padding:0!important;display:grid!important;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.45rem!important;margin:.7rem 0}
.ab-games li{display:flex;justify-content:space-between;gap:.5rem;padding:.55rem .8rem;border-radius:10px;background:rgba(255,255,255,.04)}
.ab-games span{color:var(--muted);white-space:nowrap}
.ab-vids{list-style:none;padding:0!important;margin-top:.6rem}
.ab-vids li{display:flex;flex-direction:column;gap:.15rem;padding:.6rem .8rem;border-radius:10px;background:rgba(255,255,255,.04)}
.ab-vids small{color:var(--muted);font-size:.72rem}
.ab-soc{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}
.ab-soc a{display:inline-flex;align-items:center;min-height:40px;padding:.45rem .9rem;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text)!important;text-decoration:none;font-weight:700;font-size:.85rem}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem}
`;

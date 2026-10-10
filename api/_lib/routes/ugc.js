// /studio — «Студия игр»: страница для поиска («конструктор игр онлайн», «сделать свою игру») + лучшие игры игроков.
// /g/<id> — ссылка на игру игрока для друзей и мессенджеров: название, автор, запуски, «▶ Играть» (SPA #/games/studio/play/<id>).
// Данные — ugc_games (ugc.sql) по service-ключу: только игры по ссылке / на проверке / в каталоге. В поиск (index) — только
// игры «в каталоге» (прошли модерацию); у остальных noindex и без рекламы. Пока ugc.sql не выполнен — студия без списка игр.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { sbSelect, storeConfigured } from '../store.js';

const TEMPLATES = [
  ['🏃', 'Раннер', 'беги, прыгай через препятствия и собирай монеты — как динозаврик в браузере'],
  ['🧺', 'Ловилка', 'лови падающие предметы и уворачивайся от бомб'],
  ['🐤', 'Летун', 'пролетай между столбами, как во Flappy Bird'],
  ['🐹', 'Тапалка', 'жми на тех, кто выглядывает из норок, — игра на время'],
  ['❓', 'Викторина', 'свои вопросы и ответы: про игры, друзей, стрим'],
  ['🚀', 'Космобой', 'корабль стреляет сам — уводи его от врагов'],
];
const num = n => Number(n || 0).toLocaleString('ru-RU');
const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
const ROLE = { admin: 'админ сайта', moderator: 'модератор' };

async function safeSelect(table, q){
  if (!storeConfigured()) return null;
  try { return await sbSelect(table, q); } catch (e) { return null; }
}
const card = g => `<a class="ug-card" href="/g/${esc(g.id)}"><span class="ug-ic">${esc(g.icon || '🎮')}</span><b>${esc(g.title)}</b>
  <small>👤 ${esc(g.profiles?.nick || 'игрок')} · 👁 ${num(g.plays)}</small></a>`;

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  if (id) return gamePage(req, res, id);
  return studioPage(req, res);
}

async function gamePage(req, res, id){
  if (!/^[0-9a-f]{8}$/.test(id)) return notFound(res);
  const rows = await safeSelect('ugc_games', `id=eq.${id}&status=in.(link,review,public)&select=id,title,descr,icon,kind,tpl,status,plays,likes,created_at,author,profiles(nick,role)`);
  const g = rows && rows[0];
  if (!g) return notFound(res);
  const nick = g.profiles?.nick || 'игрок';
  const more = (await safeSelect('ugc_games', `author=eq.${g.author}&status=eq.public&id=neq.${id}&select=id,title,icon,plays,profiles(nick)&order=plays.desc&limit=6`)) || [];
  const authorGames = (await safeSelect('ugc_games', `author=eq.${g.author}&status=eq.public&select=plays`)) || [];
  const totalPlays = authorGames.reduce((a, x) => a + (x.plays || 0), 0);
  const pub = g.status === 'public';
  const url = `${SITE}/g/${id}`, playUrl = `/#/games/studio/play/${id}`;
  const title = `${g.title} — игра от ${nick}`;
  const description = (g.descr ? g.descr + ' ' : '') + `Играй онлайн бесплатно: «${g.title}» — игру сделал ${nick} в Студии игр на сайте dan4ik37. Сделай и свою — без кода!`;
  const since = new Date(g.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const ld = { '@context': 'https://schema.org', '@type': 'VideoGame', name: g.title, url, description, inLanguage: 'ru', genre: 'Казуальная игра',
    gamePlatform: 'Браузер', applicationCategory: 'Game', operatingSystem: 'Any', datePublished: String(g.created_at).slice(0, 10),
    author: { '@type': 'Person', name: nick }, offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/PlayAction', userInteractionCount: g.plays || 0 } };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <a href="/studio">Студия игр</a> › <span>${esc(g.title)}</span></nav>
  <section class="ug-hero">
    <span class="ug-big">${esc(g.icon || '🎮')}</span>
    <div class="ug-hero-b">
      <h1>${esc(g.title)}</h1>
      <p class="ug-meta">👁 ${num(g.plays)} ${plural(g.plays, 'запуск', 'запуска', 'запусков')} · ❤️ ${num(g.likes)} · ${g.kind === 'tpl' ? 'сделана на шаблоне' : 'своим кодом'} · ${esc(since)}</p>
      ${g.descr ? `<p class="lead">${esc(g.descr)}</p>` : ''}
      <a class="btn btn-acc ug-play" href="${playUrl}">▶ Играть</a>
    </div>
  </section>
  <section class="ug-author">
    <span class="ug-au-ava">👤</span>
    <div><span class="ug-au-lbl">Автор игры</span><a class="ug-au-nick" href="/#/profile/${esc(g.author)}">${esc(nick)}</a>${ROLE[g.profiles?.role] ? ` <span class="ug-role">${ROLE[g.profiles.role]}</span>` : ''}
      <small>${authorGames.length ? `${num(authorGames.length)} ${plural(authorGames.length, 'игра', 'игры', 'игр')} в каталоге · ${num(totalPlays)} ${plural(totalPlays, 'запуск', 'запуска', 'запусков')}` : 'первая игра автора'}</small></div>
    <a class="btn btn-ghost" href="/#/profile/${esc(g.author)}">Профиль</a>
  </section>
  ${pub ? '<div data-ad="seo_game" hidden></div>' : ''}
  ${more.length ? `<section class="box"><h2>Ещё игры автора</h2><div class="ug-grid">${more.map(card).join('')}</div></section>` : ''}
  <aside class="join"><div><b>Сделай свою игру — без кода</b><span>Раннер, ловилка, викторина, космобой: выбери шаблон, поставь своего героя и цвета — и зови друзей по ссылке. Или опиши идею, и ИИ напишет код.</span></div><a class="btn btn-acc" href="/studio">🛠️ В студию</a></aside>
  <p class="ug-warn">Игру сделал игрок сайта. Никогда не вводи в играх пароли и личные данные. Нашёл нарушение — нажми ⚠️ на странице игры.</p>
</main>`;
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title, description, url, image: `${SITE}/img/share/studio.png`, ld, body, css: CSS, noindex: !pub, noAds: !pub, ogType: 'website' }));
}

async function studioPage(req, res){
  const top = (await safeSelect('ugc_games', 'status=eq.public&select=id,title,icon,plays,profiles(nick)&order=plays.desc&limit=12')) || [];
  const fresh = (await safeSelect('ugc_games', 'status=eq.public&select=id,title,icon,plays,profiles(nick)&order=created_at.desc&limit=6')) || [];
  const url = `${SITE}/studio`;
  const faq = [
    ['Нужно ли уметь программировать?', 'Нет. Выбери шаблон — раннер, ловилку, летуна, тапалку, викторину или космобой — и поменяй героя, предметы, цвета, скорость и надписи. Игра собирается сама, а изменения видны сразу.'],
    ['Это бесплатно?', 'Да, полностью. Нужен только аккаунт на сайте, чтобы сохранить игру и дать ссылку друзьям. Без входа игра хранится в браузере.'],
    ['Как сделать игру с помощью ИИ?', 'В режиме «Свой код + ИИ» опиши идею игры и нажми «Скопировать задание для ИИ». Вставь его в DeepSeek, GigaChat, Алису или ChatGPT, скопируй ответ с кодом и вставь в студию — игра запустится. Если будет ошибка, студия подскажет, что переслать ИИ.'],
    ['Как позвать друзей поиграть?', 'Нажми «🔗 Ссылка для друзей» — ссылка скопируется. По ней игра открывается сразу, а рекорды и «Вызвать друга» помогут посоревноваться.'],
    ['Как попасть в каталог?', 'Нажми «🌍 В каталог». Модератор проверит игру (без оскорблений, взрослого контента и азартных игр) — и её увидят все игроки сайта.'],
    ['Что получает автор?', 'Монеты сайта 🪙: каждые 10 запусков твоей игры другими игроками приносят монету (до 100 в день). Монеты тратятся на героев, одежду и аксессуары персонажа.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Студия игр — конструктор игр онлайн', url, applicationCategory: 'GameApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>Студия игр</span></nav>
  <h1>Конструктор игр онлайн: сделай свою игру бесплатно</h1>
  <p class="lead">Студия игр на сайте Денчика: выбери шаблон, поставь своего героя, предметы и цвета — и игра готова. Без кода и без скачивания, прямо в браузере, на телефоне и компьютере. А можно и своим кодом: опиши идею — ИИ напишет игру, студия её запустит.</p>
  <a class="btn btn-acc ug-play" href="/#/games/studio">🛠️ Открыть студию</a>
  <section class="box"><h2>Как это работает</h2><ol class="ug-steps">
    <li><b>Выбери шаблон</b> — или режим «Свой код + ИИ».</li>
    <li><b>Настрой игру</b>: герой, враги, бонусы, цвета, скорость, жизни, свои вопросы в викторине.</li>
    <li><b>Позови друзей</b> по ссылке и соревнуйтесь в рекордах. Лучшие игры попадают в каталог.</li>
  </ol></section>
  <section class="box"><h2>Шаблоны игр</h2><div class="ug-tpls">${TEMPLATES.map(([i, n, d]) => `<a class="ug-tpl" href="/#/games/studio"><span>${i}</span><b>${n}</b><small>${d}</small></a>`).join('')}</div></section>
  ${top.length ? `<section class="box"><h2>Популярные игры игроков</h2><div class="ug-grid">${top.map(card).join('')}</div></section>` : ''}
  ${fresh.length ? `<section class="box"><h2>Новые игры</h2><div class="ug-grid">${fresh.map(card).join('')}</div></section>` : ''}
  <div data-ad="seo_game" hidden></div>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Играть в готовые игры</b><span>Орда, Арена, шахматы, Дурак, «5 букв» и ещё 30 игр сайта — с ботами и с друзьями онлайн.</span></div><a class="btn btn-acc" href="/games">🎮 Все игры</a></aside>
</main>`;
  res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title: 'Конструктор игр онлайн — сделай свою игру бесплатно | Студия игр', description: 'Сделай свою игру онлайн без кода: раннер, ловилка, летун, викторина, космобой. Свой герой, цвета и правила — и ссылка для друзей. Или своим кодом с помощью ИИ. Бесплатно.', url, image: `${SITE}/img/share/studio.png`, ld, body, css: CSS }));
}

function notFound(res){
  res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page({ title: 'Игра не найдена — Студия игр', description: 'Игра удалена, скрыта автором или ещё не опубликована.', body: `<main class="wrap"><h1>Игра не найдена</h1><p class="lead">Её удалили, скрыли или ещё не опубликовали по ссылке.</p><a class="btn btn-acc" href="/studio">🛠️ Студия игр</a> <a class="btn btn-ghost" href="/games">🎮 Все игры</a></main>`, noindex: true, css: CSS }));
}

const CSS = `
.ug-hero{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap;margin-top:.6rem}
.ug-big{font-size:5rem;line-height:1;filter:drop-shadow(0 10px 24px rgba(0,0,0,.4))}
.ug-hero-b{flex:1;min-width:240px}
.ug-hero h1{margin:0 0 .35rem}
.ug-meta{color:var(--muted);font-size:.85rem;font-weight:600;margin:0 0 .6rem}
.ug-play{margin-top:.6rem;font-size:1.05rem;padding:.8rem 1.6rem}
.ug-author{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap;margin-top:1.2rem;padding:1rem 1.2rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.ug-author>div{flex:1;min-width:180px;display:flex;flex-direction:column;gap:.15rem}
.ug-au-ava{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:1.6rem;background:rgba(155,109,255,.2)}
.ug-au-lbl{font-size:.68rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.ug-au-nick{font-weight:800;font-size:1.1rem;text-decoration:none}
.ug-role{font-size:.7rem;font-weight:800;padding:.1rem .45rem;border-radius:999px;background:rgba(255,45,85,.18);color:#ff8fa8}
.ug-author small{color:var(--muted);font-size:.8rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.ug-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.7rem;margin-top:.7rem}
.ug-card{display:flex;flex-direction:column;align-items:center;gap:.25rem;padding:1rem .6rem;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line);text-decoration:none;text-align:center}
.ug-card:hover{border-color:var(--accent)}
.ug-ic{font-size:2.3rem;line-height:1.1}
.ug-card b{font-size:.88rem;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ug-card small{color:var(--muted);font-size:.72rem}
.ug-steps{margin:.6rem 0 0;padding-left:1.3rem;display:flex;flex-direction:column;gap:.4rem;font-size:.92rem}
.ug-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.7rem;margin-top:.7rem}
.ug-tpl{display:flex;flex-direction:column;gap:.2rem;padding:.9rem;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line);text-decoration:none}
.ug-tpl span{font-size:1.8rem}
.ug-tpl small{color:var(--muted);font-size:.78rem;line-height:1.4}
.ug-warn{color:var(--muted);font-size:.75rem;text-align:center;margin-top:1.2rem}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
`;

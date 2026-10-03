// api/game.js — страницы игр для поисковиков: /games (все игры) и /games/<id> (rewrite в vercel.json)
//
// Зачем: сами игры живут в SPA на #/games/<id> — поисковик их не видит. Здесь на каждую
// игру готовый HTML с правилами, советами, FAQ и JSON-LD под запросы вида
// «играть в города онлайн», «шашки с другом». Кнопка «Играть» ведёт в SPA (/#/games/<id>).
// Тексты — api/_lib/games-seo.js.
import { SITE, esc } from './_lib/yt.js';
import { page } from './_lib/page.js';
import { GAME_PAGES, HUB, scoreLabel } from './_lib/games-seo.js';

// Картинки-превью — img/games/<id>.png (рисует img/games/_make-cards.py)
const cardImage = id => `${SITE}/img/games/${id}.png`;

export default function handler(req, res) {
  const id = String(req.query.id || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!id) return sendPage(res, hubPage());
  const g = GAME_PAGES.find(x => x.id === id);
  if (!g) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(404).send(page({
      title: 'Игра не найдена — dan4ik37',
      body: `<main class="wrap narrow"><h1>Такой игры нет</h1>
        <p class="muted">Возможно, ссылка неполная.</p>
        <p><a class="btn btn-acc" href="/games">Все игры →</a></p></main>`,
      noindex: true, css: GAME_CSS
    }));
  }
  // Ссылка-вызов: /games/<id>?s=<очки>&n=<ник> — в превью мессенджера «Ник набрал N — побьёшь?»
  const s = Number(req.query.s);
  const ch = Number.isInteger(s) && s > 0 && s <= 1000000
    ? { score: s, nick: String(req.query.n || '').replace(/[<>"'\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Друг' }
    : null;
  return sendPage(res, gamePage(g, ch));
}

function sendPage(res, html) {
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(html);
}

function card(g) {
  return `<a class="gcard" href="/games/${g.id}">
    <span class="gic">${g.icon}</span>
    <b>${esc(g.name)}</b>
    <span>${esc(g.description)}</span>
  </a>`;
}

function hubPage() {
  const url = `${SITE}/games`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', name: HUB.h1, description: HUB.description, url, inLanguage: 'ru',
        isPartOf: { '@type': 'WebSite', name: 'dan4ik37', url: SITE + '/' }
      },
      {
        '@type': 'ItemList',
        itemListElement: GAME_PAGES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/games/${g.id}`, name: g.name }))
      }
    ]
  };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Игры</span></nav>
  <h1>${esc(HUB.h1)}</h1>
  <p class="lead">${esc(HUB.lead)}</p>
  <div class="cta"><a class="btn btn-acc big" href="/#/games">▶ Открыть игры</a></div>
  <section class="more"><h2>Во что поиграть</h2><div class="ggrid">${GAME_PAGES.map(card).join('')}</div></section>
  <div data-ad="seo_game" hidden></div>
  <section class="box">
    <h2>Как играть с другом</h2>
    <ol>
      <li>Открой игру и нажми «Играть с другом онлайн» (или «⚔️ Соревнование» — в одиночных играх).</li>
      <li>Скопируй ссылку и отправь другу в Telegram, ВКонтакте или любой мессенджер.</li>
      <li>Друг открывает ссылку — и партия начинается. Регистрация не нужна ни тебе, ни ему.</li>
    </ol>
  </section>
  ${joinBlock()}
</main>`;
  return page({ title: HUB.title, description: HUB.description, url, image: cardImage('games'), ld, body, css: GAME_CSS });
}

function gamePage(g, ch) {
  const url = `${SITE}/games/${g.id}`;
  const play = `/#/games/${g.id}`;
  const others = GAME_PAGES.filter(x => x.id !== g.id);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame', name: g.name, description: g.description, url, image: cardImage(g.id), inLanguage: 'ru',
        genre: 'Browser game', gamePlatform: 'Web browser', applicationCategory: 'Game', operatingSystem: 'Any',
        playMode: ['SinglePlayer', 'MultiPlayer'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' },
        author: { '@type': 'Person', name: 'dan4ik37', url: SITE + '/' }
      },
      {
        '@type': 'FAQPage',
        mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: 'Игры', item: SITE + '/games' },
          { '@type': 'ListItem', position: 3, name: g.name, item: url }
        ]
      }
    ]
  };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>${esc(g.name)}</span></nav>
  ${ch ? `<div class="challenge">⚔️ <b>${esc(ch.nick)}</b> ${g.id === 'words' ? 'угадал слово' : 'набрал'} ${esc(scoreLabel(g.id, ch.score))} в «${esc(g.name)}». <span>Сможешь лучше?</span></div>` : ''}
  <div class="ghero">
    <span class="gbig">${g.icon}</span>
    <div>
      <h1>${esc(g.h1)}</h1>
      <p class="lead">${esc(g.lead)}</p>
      <div class="cta">
        <a class="btn btn-acc big" href="${play}">▶ Играть бесплатно</a>
        <button type="button" class="btn btn-ghost" id="share">🔗 Поделиться</button>
      </div>
      <p class="muted small">Без регистрации и скачивания · телефон и компьютер</p>
    </div>
  </div>

  <section class="box"><h2>Что есть в игре</h2><ul class="feat">${g.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul></section>
  <section class="box"><h2>Правила</h2><ol>${g.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol></section>
  <section class="box"><h2>Советы</h2><ul>${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
  <div data-ad="seo_game" hidden></div>
  <section class="box faq"><h2>Частые вопросы</h2>
    ${g.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
  </section>
  <div class="cta center"><a class="btn btn-acc big" href="${play}">▶ Играть в «${esc(g.name)}»</a></div>

  <section class="more"><h2>Другие игры</h2><div class="ggrid">${others.map(card).join('')}</div>
    <p class="all"><a href="/games">Все игры →</a></p></section>
  ${joinBlock()}
</main>`;
  // canonical — всегда чистый /games/<id>, чтобы вызовы не плодили дубли в поиске
  const verb = g.id === 'words' ? 'угадал слово' : 'набрал';
  const title = ch ? `${ch.nick} ${verb} ${scoreLabel(g.id, ch.score)} в «${g.name}» — побьёшь?` : `${g.title} | dan4ik37`;
  const description = ch ? `Сыграй в «${g.name}» бесплатно и без регистрации и побей результат. ${g.description}` : g.description;
  return page({ title, description, url, image: cardImage(g.id), ld, body, css: GAME_CSS, script: SHARE_JS });
}

function joinBlock() {
  return `<aside class="join">
    <div>
      <b>Играешь с аккаунтом — получаешь больше</b>
      <span>Опыт за победы, задание дня на +50 XP, таблица рекордов и ачивки. А ещё — видео, стримы и живой чат dan4ik37.</span>
    </div>
    <a class="btn btn-acc" href="/#/home">На сайт →</a>
  </aside>`;
}

const SHARE_JS = `
(function(){
  var s=document.getElementById('share');if(!s)return;
  s.addEventListener('click',function(){
    var u=location.origin+location.pathname,t=document.title;
    if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});return;}
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){s.textContent='✓ Ссылка скопирована';setTimeout(function(){s.textContent='🔗 Поделиться'},1800)},function(){prompt('Скопируй ссылку:',u)});
  });
})();`;

const GAME_CSS = `
.challenge{margin-bottom:1.2rem;padding:.9rem 1.1rem;border-radius:14px;background:linear-gradient(90deg,rgba(255,45,85,.22),rgba(255,107,53,.12));border:1px solid rgba(255,45,85,.45);font-size:.95rem}
.challenge span{color:#ffd166;font-weight:800}
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.crumbs a:hover{color:#fff}
.ghero{display:flex;gap:1.4rem;align-items:flex-start}
.gbig{font-size:4.5rem;line-height:1;flex:none;filter:drop-shadow(0 10px 30px rgba(255,45,85,.35))}
.ghero h1{margin-top:0}
.lead{margin-top:.8rem;font-size:1rem;color:rgba(240,240,248,.85);max-width:720px}
.btn.big{padding:.95rem 1.6rem;font-size:.95rem}
.cta.center{justify-content:center;margin:2rem 0 0}
.small{font-size:.75rem;margin-top:.7rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.box ol,.box ul{padding-left:1.3rem;display:flex;flex-direction:column;gap:.45rem;font-size:.92rem;color:rgba(240,240,248,.86)}
.box ul.feat{list-style:none;padding-left:0}
.box ul.feat li::before{content:'✓ ';color:#22c55e;font-weight:800}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
.ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:1rem}
.gcard{display:flex;flex-direction:column;gap:.4rem;padding:1.1rem;border-radius:16px;background:var(--card);border:1px solid var(--line);text-decoration:none;transition:transform .25s,border-color .25s}
.gcard:hover{transform:translateY(-3px);border-color:rgba(255,45,85,.5)}
.gcard .gic{font-size:2rem}
.gcard b{font-size:1rem}
.gcard span:last-child{font-size:.78rem;color:var(--muted)}
@media(max-width:600px){.ghero{flex-direction:column;gap:.6rem}.gbig{font-size:3.2rem}}
`;

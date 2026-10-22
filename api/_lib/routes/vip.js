// /vip → api/pages.js?page=vip — публичная страница «💛 Донатер и ✨ VIP»: что даёт и как получить. Все цифры — из кода сайта:
//   «Донатер» — статус за поддержку стрима (premium.sql, 22.10.2026): уровень — сумма донатов за последние DONOR_RULES.days дней,
//     пороги — DONOR_LEVELS (api/_lib/premium.js = js/core/premium.js = premium.sql donor_levels; ПРЕДЛОЖЕНИЕ — решает владелец);
//     донат — поддержка, а не покупка: VIP и 💎 за него не начисляются (выключатель site_config 'donate_rewards' = off).
//   VIP — отдельная ветка: пробный за уровень (level_ladder в economy.sql — FREE ниже) или за 💎 (ITEMS), Silver/Gold — по сумме
//     покупок 💎 (total_donated). Бонусы — VIP_TIERS (js/features/profile.js): закреп 10/20/40 мин, гости 10/30/100, стикеры
//     base/+silver/+gold, невидимка — с Silver (can_be_invisible), без рекламы — js/core/ad-places.js. У кого обе ветки — лучшее.
//   Бонусы не меняют итоги игр: подсказка «5 букв», отмены «2048» сверх двух, 4-й вариант «Орды» — игра без рекорда.
// Поменялись условия в коде → поправить и здесь.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { ITEMS, DONOR_LEVELS, DONOR_RULES } from '../premium.js';

const VIP_GEMS = ITEMS.filter(i => i.kind === 'vip');
// VIP за уровень — как level_ladder() в economy.sql и LEVEL_REWARDS в js/features/xp.js (scripts/economy-test.cjs сверяет)
const FREE = [[30, '3 дня'], [50, 'неделю'], [100, 'месяц']];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const PERK = { bronze: '🔸 как VIP', silver: '⭐ как Silver', gold: '✨ как Gold' };
const byPerk = k => DONOR_LEVELS.filter(l => l.perk === k).map(l => ROMAN[l.lv]).join('–');

const ROWS = [
  ['💛 Донатер (донаты за ' + DONOR_RULES.days + ' дней)', byPerk('bronze') || '—', byPerk('silver') || '—', byPerk('gold') || '—'],
  ['✨ VIP: сумма покупок 💎 за всё время', 'любая', 'от 500 ₽', 'от 1500 ₽'],
  ['🚫 Сайт без рекламы (за награду — только по своей кнопке)', '✓', '✓', '✓'],
  ['Цветной ник и значок в чате и на форуме', '✓', '✓', '✓'],
  ['Анимированные аватарка и фон (GIF)', '✓', '✓', '✓'],
  ['Своя тема (цвет) сайта', '✓', '✓', '✓'],
  ['Форматирование постов на форуме', '✓', '✓', '✓'],
  ['💡 Подсказка-буква в «5 букв» (слово — без рекорда)', '✓', '✓', '✓'],
  ['Закреп своего сообщения в чате', '10 мин', '20 мин', '40 мин'],
  ['Наборы стикеров в чате', 'базовый', '+ серебряный', '+ золотой'],
  ['«Кто заходил» в профиль', 'до 10', 'до 30', 'до 100'],
  ['👻 Невидимка (не светиться в гостях)', '—', '✓', '✓'],
];

export default function handler(req, res) {
  const url = `${SITE}/vip`;
  const days = DONOR_RULES.days;
  const faq = [
    ['Что такое «Донатер»?', `Статус за поддержку стрима: донат на DonationAlerts с твоим логином для доната — и на ${days} дней у тебя «💛 Донатер» с бонусами как у VIP. Уровень — по сумме донатов за последние ${days} дней: ` + DONOR_LEVELS.map(l => `${ROMAN[l.lv]} — от ${l.min} ₽`).join(', ') + '. Статус временный: каждый донат считается ' + days + ' дней.'],
    ['Можно купить VIP или кристаллы донатом?', 'Нет. Донат — это поддержка стрима, а не покупка: взамен — спасибо и статус «💛 Донатер». VIP — отдельно: пробный за уровень на сайте или за кристаллы 💎 (когда откроется оплата через Kaspi).'],
    ['Чем «Донатер» отличается от VIP?', 'Бонусы почти те же. Донатер — за донаты последних ' + days + ' дней, VIP — за уровень или 💎 на срок. У кого есть и то, и другое, действует лучшее, а у ника — его значок.'],
    ['Бонусы помогают в играх?', 'Нет — на итоги игр и рейтинги бонусы не влияют: слово с подсказкой в «5 букв», игра «2048» с отменами сверх двух и забег «Орды» с 4-м вариантом улучшения идут без рекорда.'],
    ['Через сколько статус появится после доната?', 'Обычно за пару минут, сам. Главное — в поле «Ваше имя» на DonationAlerts вписать свой логин для доната из профиля. Засчитываются донаты, сделанные после того, как логин задан.'],
    ['Почему мой донат не засчитался?', 'Анонимные донаты («Аноним», без имени) ни к кому не привязываются. Опечатка в имени — в профиле есть «Задонатил — не засчиталось?»: небольшой донат с похожим на логин именем привяжется сам, остальное проверит админ.'],
    ['Можно получить VIP бесплатно?', 'Попробовать — да: за уровень на сайте дают VIP на время — ' + FREE.map(([lv, t]) => `${lv}-й уровень — на ${t}`).join(', ') + '. Опыт дают визиты, чат, игры, задания дня и ачивки.'],
  ];
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/">Главная</a> › <span>Донатер и VIP</span></nav>
  <div class="vp-hero">
    <span class="vp-gem">💛</span>
    <div>
      <h1>«Донатер» и VIP на сайте dan4ik37</h1>
      <p class="lead"><b>💛 Донатер</b> — статус за поддержку стрима, с бонусами: сайт без рекламы, цветной ник, GIF-аватарка, стикеры, закреп в чате и не только. Донат — это поддержка, а не покупка: взамен — спасибо и статус на ${days} дней. <b>✨ VIP</b> — отдельно: пробный за уровень или за кристаллы 💎.</p>
      <div class="cta"><a class="btn btn-gold" href="/profile/vip">💛 Как стать донатером</a><a class="btn btn-ghost" href="#free">🎮 Пробный VIP за уровень</a><a class="btn btn-ghost" href="/shop">💎 VIP за кристаллы</a></div>
    </div>
  </div>

  <section class="box vp-table-wrap">
    <table class="vp-table">
      <thead><tr><th></th><th class="b">🔸 VIP · 💛 ${esc(byPerk('bronze'))}</th><th class="s">⭐ Silver · 💛 ${esc(byPerk('silver'))}</th><th class="g">✨ Gold · 💛 ${esc(byPerk('gold'))}</th></tr></thead>
      <tbody>${ROWS.map(([name, ...v]) => `<tr><td>${esc(name)}</td>${v.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </section>

  <section class="box"><h2>💛 Уровни «Донатер» — по донатам за ${days} дней</h2>
    <div class="vp-free">${DONOR_LEVELS.map(l => `<div><b>${ROMAN[l.lv]}</b><span>от ${l.min} ₽</span><i>${esc(PERK[l.perk] || '')}</i></div>`).join('')}</div>
    <p class="muted small">Статус временный: каждый донат считается ${days} дней, потом уровень пересчитывается сам. Донат — поддержка стрима, а не покупка; кристаллы и VIP за него не начисляются.</p>
  </section>

  <section class="box"><h2>Как стать донатером</h2><ol class="vp-steps">
    <li><a href="/profile/vip">Войди на сайт</a> и в профиле придумай <b>логин для доната</b> — один раз.</li>
    <li>Нажми «Как стать донатером» в профиле — откроется DonationAlerts, логин уже будет скопирован.</li>
    <li>В поле «Ваше имя» вставь логин (не ник!), сумма — любая.</li>
    <li>Через пару минут статус «💛 Донатер» включится сам — обнови профиль.</li>
  </ol>
  <p class="muted small">Засчитываются донаты, сделанные после регистрации и после того, как задан логин. Анонимные донаты ни к кому не привязываются — так никто не выдаст себя за чужого донатера.</p></section>

  <section class="box" id="free"><h2>✨ VIP — за уровень или за кристаллы</h2>
    <div class="vp-free">${FREE.map(([lv, t]) => `<div><b>${lv}</b><span>уровень</span><i>🔸 VIP на ${esc(t)}</i></div>`).join('')}</div>
    <p class="muted small">Пробный VIP за уровень — долгая цель: месяцы игры каждый день. За кристаллы 💎 в <a href="/shop">магазине</a>: ${VIP_GEMS.map(i => `${esc(i.title.replace('VIP на ', ''))} — ${i.price} 💎`).join(' · ')}; там же — VIP в подарок другу. Silver и Gold — по сумме покупок кристаллов. <a href="/games">Сыграть →</a></p>
  </section>

  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: '«Донатер» и VIP на сайте dan4ik37 — что даёт и как получить',
    description: '«💛 Донатер» — статус за поддержку стрима dan4ik37 с бонусами: сайт без рекламы, цветной ник, GIF-аватарка, стикеры, закреп в чате. VIP — пробный за уровень или за кристаллы.',
    url, image: SITE + '/og-image.jpg', body, css: CSS,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.vp-hero{display:flex;gap:1.4rem;align-items:flex-start}
.vp-gem{font-size:4rem;line-height:1;filter:drop-shadow(0 10px 30px rgba(255,195,40,.45))}
.vp-hero h1{margin-top:0;background:linear-gradient(135deg,#ffe58a,#ffb020);-webkit-background-clip:text;background-clip:text;color:transparent}
.lead{margin-top:.8rem;color:rgba(var(--text-rgb),.85);max-width:720px}
.btn-gold{background:linear-gradient(135deg,#ffd700,#ff9500);color:#1a1020}
.small{font-size:.78rem;margin-top:.6rem}
.small a{color:var(--accent)}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.vp-table-wrap{overflow-x:auto;padding:.6rem}
.vp-table{width:100%;border-collapse:collapse;font-size:.86rem;min-width:520px}
.vp-table th,.vp-table td{padding:.7rem .8rem;text-align:center;border-bottom:1px solid var(--line)}
.vp-table td:first-child{text-align:left;color:rgba(var(--text-rgb),.86)}
.vp-table tr:last-child td{border-bottom:0}
.vp-table th{font-family:Oswald,sans-serif;font-size:1rem;letter-spacing:.04em}
.vp-table th.b{color:#cd8c3c}.vp-table th.s{color:#c8d2e1}.vp-table th.g{color:#ffc328}
.vp-table td:last-child{background:rgba(255,195,40,.05)}
.vp-steps{padding-left:1.2rem;display:flex;flex-direction:column;gap:.45rem;font-size:.9rem}
.vp-steps a{color:var(--accent)}
.vp-free{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.7rem}
.vp-free div{display:flex;flex-direction:column;align-items:center;padding:.9rem .5rem;border-radius:14px;background:rgba(var(--fg-rgb),.03);border:1px solid var(--line);text-align:center}
.vp-free b{font-family:Oswald,sans-serif;font-size:2rem;line-height:1}
.vp-free span{font-size:.7rem;color:var(--muted)}
.vp-free i{font-style:normal;font-size:.78rem;font-weight:700;margin-top:.4rem}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(var(--text-rgb),.8)}
@media(max-width:600px){.vp-table{min-width:0;font-size:.7rem}.vp-table th,.vp-table td{padding:.5rem .25rem}.vp-table th{font-size:.78rem}.vp-table td:first-child{width:42%}.vp-table-wrap{padding:.3rem}.vp-hero{flex-direction:column;gap:.4rem}.vp-gem{font-size:3rem}.vp-free{grid-template-columns:repeat(2,1fr)}}
`;

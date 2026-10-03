// /vip → api/pages.js?page=vip — публичная страница «Что даёт VIP» (раньше это было видно только внутри
// своего профиля, и только тем, кто вошёл без VIP). Все цифры — из кода сайта, не выдумывать:
//   уровни и пороги — VIP_TIERS (js/features/profile.js): Bronze — любой VIP, Silver — 500₽ донатов, Gold — 1500₽;
//   закреп 10/20/40 мин, гости 10/30/100, стикеры base/+silver/+gold; невидимка — с Silver (can_be_invisible);
//   GIF-аватар/фон, форматирование на форуме, тема — VIP (hasPerks/isVipActive); подсказка в «5 букв» — words.js;
//   VIP за уровень 30/50/100 — progression.sql. Цена — 100₽/мес (vip-auto.sql).
// Поменялись условия VIP в коде → поправить и здесь.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

const ROWS = [
  ['Сумма донатов за всё время', 'любая', 'от 500 ₽', 'от 1500 ₽'],
  ['Цветной ник и значок в чате и на форуме', '✓', '✓', '✓'],
  ['Анимированные аватарка и фон (GIF)', '✓', '✓', '✓'],
  ['Своя тема (цвет) сайта', '✓', '✓', '✓'],
  ['Форматирование постов на форуме', '✓', '✓', '✓'],
  ['💡 Подсказка-буква в «5 букв»', '✓', '✓', '✓'],
  ['Закреп своего сообщения в чате', '10 мин', '20 мин', '40 мин'],
  ['Наборы стикеров в чате', 'базовый', '+ серебряный', '+ золотой'],
  ['«Кто заходил» в профиль', 'до 10', 'до 30', 'до 100'],
  ['👻 Невидимка (не светиться в гостях)', '—', '✓', '✓'],
];

export default function handler(req, res) {
  const url = `${SITE}/vip`;
  const faq = [
    ['Сколько стоит VIP?', '100 ₽ в месяц. Донат больше — больше месяцев, остаток не сгорает, а копится к следующему месяцу.'],
    ['Как VIP становится Silver или Gold?', 'Уровень зависит от суммы всех донатов за всё время: от 500 ₽ — Silver, от 1500 ₽ — Gold.'],
    ['Можно получить VIP бесплатно?', 'Да, за уровень на сайте: 30-й уровень — Bronze VIP на месяц, 50-й — Silver на 3 месяца, 100-й — Gold на год. Опыт дают визиты, чат, игры, задания дня и ачивки.'],
    ['Через сколько VIP появится после доната?', 'Обычно за пару минут, автоматически. Главное — в поле «Ваше имя» на DonationAlerts вписать свой логин для доната из профиля.'],
    ['Что если ошибся в логине?', 'VIP не потеряется: напиши в чат сайта или админу — выдадут вручную по этому донату.'],
  ];
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>VIP</span></nav>
  <div class="vp-hero">
    <span class="vp-gem">✨</span>
    <div>
      <h1>VIP на сайте dan4ik37</h1>
      <p class="lead">Поддержи стрим — и получи плюшки на сайте: цветной ник, GIF-аватарку, стикеры, закреп в чате и не только. <b>100 ₽ в месяц</b>, а чем больше донатов за всё время — тем выше уровень.</p>
      <div class="cta"><a class="btn btn-gold" href="/#/profile">✨ Получить VIP</a><a class="btn btn-ghost" href="#free">🎮 Или бесплатно за уровень</a></div>
    </div>
  </div>

  <section class="box vp-table-wrap">
    <table class="vp-table">
      <thead><tr><th></th><th class="b">🔸 VIP</th><th class="s">⭐ Silver</th><th class="g">✨ Gold</th></tr></thead>
      <tbody>${ROWS.map(([name, ...v]) => `<tr><td>${esc(name)}</td>${v.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
  </section>

  <section class="box"><h2>Как получить</h2><ol class="vp-steps">
    <li><a href="/#/profile">Войди на сайт</a> и в профиле придумай <b>логин для доната</b> — один раз.</li>
    <li>Нажми «Хочу купить VIP» в профиле — откроется DonationAlerts, логин уже будет скопирован.</li>
    <li>В поле «Ваше имя» вставь логин, сумма — от 100 ₽ (100 ₽ = месяц).</li>
    <li>Через пару минут VIP включится сам — обнови профиль.</li>
  </ol></section>

  <section class="box" id="free"><h2>🎮 VIP бесплатно — за уровень</h2>
    <div class="vp-free"><div><b>30</b><span>уровень</span><i>🔸 VIP на месяц</i></div><div><b>50</b><span>уровень</span><i>⭐ Silver на 3 месяца</i></div><div><b>100</b><span>уровень</span><i>✨ Gold на год</i></div></div>
    <p class="muted small">Опыт дают визиты каждый день, чат, игры на сайте, «Задание дня» и ачивки. <a href="/games">Сыграть →</a></p>
  </section>

  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'VIP на сайте dan4ik37 — что даёт и как получить',
    description: 'VIP за поддержку стрима dan4ik37: цветной ник, GIF-аватарка, стикеры, закреп в чате, невидимка. 100 ₽ в месяц или бесплатно за 30-й уровень.',
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
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:720px}
.btn-gold{background:linear-gradient(135deg,#ffd700,#ff9500);color:#1a1020}
.small{font-size:.78rem;margin-top:.6rem}
.small a{color:var(--accent)}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.vp-table-wrap{overflow-x:auto;padding:.6rem}
.vp-table{width:100%;border-collapse:collapse;font-size:.86rem;min-width:520px}
.vp-table th,.vp-table td{padding:.7rem .8rem;text-align:center;border-bottom:1px solid var(--line)}
.vp-table td:first-child{text-align:left;color:rgba(240,240,248,.86)}
.vp-table tr:last-child td{border-bottom:0}
.vp-table th{font-family:Oswald,sans-serif;font-size:1rem;letter-spacing:.04em}
.vp-table th.b{color:#cd8c3c}.vp-table th.s{color:#c8d2e1}.vp-table th.g{color:#ffc328}
.vp-table td:last-child{background:rgba(255,195,40,.05)}
.vp-steps{padding-left:1.2rem;display:flex;flex-direction:column;gap:.45rem;font-size:.9rem}
.vp-steps a{color:var(--accent)}
.vp-free{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem}
.vp-free div{display:flex;flex-direction:column;align-items:center;padding:.9rem .5rem;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid var(--line);text-align:center}
.vp-free b{font-family:Oswald,sans-serif;font-size:2rem;line-height:1}
.vp-free span{font-size:.7rem;color:var(--muted)}
.vp-free i{font-style:normal;font-size:.78rem;font-weight:700;margin-top:.4rem}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:600px){.vp-table{min-width:0;font-size:.7rem}.vp-table th,.vp-table td{padding:.5rem .25rem}.vp-table th{font-size:.78rem}.vp-table td:first-child{width:42%}.vp-table-wrap{padding:.3rem}.vp-hero{flex-direction:column;gap:.4rem}.vp-gem{font-size:3rem}.vp-free{grid-template-columns:1fr}}
`;

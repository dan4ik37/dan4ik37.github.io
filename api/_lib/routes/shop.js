// /shop → api/pages.js?page=shop — «Магазин кристаллов 💎»: что это, цены пакетов, на что тратить, как оплатить,
// вопросы (FAQ + JSON-LD). Её смотрят и поисковики, и платёжные системы при подключении сайта (цены, способ
// получения, возврат, реквизиты). Покупка — в SPA: /#/shop (js/features/shop.js).
// /shop?o=<заказ>&r=ok|fail — сюда возвращает страница оплаты Freedom Pay: переводим в магазин, он ждёт зачисления.
// Цифры — api/_lib/premium.js (как js/core/premium.js и premium.sql).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { GEMS, PACKS, ITEMS, LIMITS, gemWord, money } from '../premium.js';
import { SELLER, sv } from '../seller.js';

export default function handler(req, res) {
  const url = `${SITE}/shop`;
  const order = String(req.query.o || '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  // Возврат со страницы оплаты
  if (/^D37-[\w-]{4,40}$/.test(order)) {
    const fail = req.query.r === 'fail';
    const to = `/#/shop/${fail ? 'fail' : 'o'}/${encodeURIComponent(order)}`;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(page({
      title: fail ? 'Оплата не прошла — dan4ik37' : 'Проверяем оплату — dan4ik37', noindex: true, noAds: true,
      body: `<main class="wrap narrow"><h1>${fail ? 'Оплата не прошла' : '⏳ Проверяем оплату…'}</h1>
        <p class="muted">${fail ? 'Деньги не списаны. Можно попробовать ещё раз или выбрать другой способ.' : `Заказ <b>${esc(order)}</b>. Кристаллы придут на аккаунт через несколько секунд.`}</p>
        <div class="cta" style="justify-content:center"><a class="btn btn-acc" href="${esc(to)}">${GEMS.icon} Вернуться в магазин</a></div></main>`,
      script: `setTimeout(function(){location.replace(${JSON.stringify(to)})},${fail ? 2500 : 900});`,
    }));
  }

  const vip = ITEMS.filter(i => i.kind === 'vip');
  const coins = ITEMS.filter(i => i.kind === 'coins');
  const faq = [
    ['Что такое кристаллы?', `Кристаллы ${GEMS.icon} — валюта сайта dan4ik37. На них покупают VIP (себе или в подарок другу), игровые монеты и вещи для персонажа. Кристаллы бывают только за реальные деньги и поддерживают стримы Денчика37.`],
    ['Как купить из Казахстана?', 'Картой банка Казахстана (Visa, Mastercard), Apple Pay, Google Pay или через Kaspi — в магазине на сайте. Кристаллы приходят сразу после оплаты.'],
    ['Как купить из России?', 'Российские карты казахстанские платёжные системы не принимают, поэтому из России — донатом на DonationAlerts (карта, СБП). В магазине выбери «донат → кристаллы», задай логин для доната и впиши его в поле «Ваше имя». 1 ₽ = 1 кристалл, за донат от 500 ₽ — бонус.'],
    ['Сколько стоит VIP за кристаллы?', vip.map(i => `${i.title} — ${i.price} ${GEMS.icon}`).join(', ') + '. Это те же месяцы VIP, что за донат 100 ₽.'],
    ['Можно вернуть деньги?', 'Неистраченные кристаллы — да, в течение 14 дней. Если ребёнок купил без разрешения — родители могут написать нам. Подробно — на странице «Политика возврата».'],
    ['Есть ли сундуки или случайные награды?', 'Нет. За кристаллы всегда понятно, что получаешь и сколько это стоит — никаких лутбоксов.'],
  ];
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Магазин</span></nav>
  <div class="sp-hero">
    <span class="sp-gem">${GEMS.icon}</span>
    <div>
      <h1>Магазин кристаллов dan4ik37</h1>
      <p class="lead">${GEMS.name} — валюта сайта Денчика37. На них — VIP, подарки друзьям, монеты для игр и вещи для персонажа. Без лутбоксов: всегда видно, что получаешь.</p>
      <div class="cta"><a class="btn btn-acc" href="/#/shop">${GEMS.icon} Открыть магазин</a><a class="btn btn-ghost" href="/vip">✨ Что даёт VIP</a></div>
    </div>
  </div>

  <section class="box"><h2>Пакеты кристаллов</h2>
    <div class="sp-packs">${PACKS.map(p => `<div class="sp-pack">${p.bonus ? `<i>+${Math.round(p.bonus / (p.gems - p.bonus) * 100)}%</i>` : ''}<b>${GEMS.icon} ${p.gems.toLocaleString('ru-RU')}</b><span>${gemWord(p.gems)}</span><em>${money(p.kzt, 'KZT')}</em><small>донатом — ${money(p.rub, 'RUB')}</small></div>`).join('')}</div>
    <p class="muted small">Оплата картой — в тенге. Из России — донатом DonationAlerts в рублях: 1 ₽ = 1 ${GEMS.icon}, от 500 ₽ — бонус как у пакетов.</p>
  </section>

  <section class="box"><h2>На что потратить</h2>
    <ul class="sp-list">
      ${vip.map(i => `<li>✨ ${esc(i.title)} — <b>${i.price} ${GEMS.icon}</b></li>`).join('')}
      <li>🎁 VIP на месяц в подарок другу — <b>${ITEMS.find(i => i.id === 'gift:1')?.price} ${GEMS.icon}</b></li>
      ${coins.map(i => `<li>🪙 ${esc(i.title)} — <b>${i.price} ${GEMS.icon}</b></li>`).join('')}
      <li>🎭 Эксклюзивные вещи для персонажа — скоро в гардеробе</li>
    </ul>
  </section>

  <section class="box"><h2>Как оплатить и получить</h2><ol class="sp-list">
    <li><b>Казахстан:</b> картой Visa или Mastercard, Apple Pay, Google Pay или Kaspi — прямо в <a href="/#/shop">магазине</a>. Данные карты вводятся на стороне платёжной системы.</li>
    <li><b>Россия и другие страны:</b> донатом на DonationAlerts с логином для доната — кристаллы или VIP придут сами.</li>
    <li>Кристаллы зачисляются на аккаунт сайта сразу после оплаты (Kaspi — после проверки, обычно в течение дня).</li>
  </ol></section>

  <section class="box"><h2>Для родителей</h2><ul class="sp-list">
    <li>Покупка картой — только с отметкой «плачу я (мне есть 18) или взрослый, который разрешил».</li>
    <li>Лимиты: до ${LIMITS.dayRub.toLocaleString('ru-RU')} ₽ в сутки и ${LIMITS.monthRub.toLocaleString('ru-RU')} ₽ за 30 дней на аккаунт.</li>
    <li>Кристаллы нельзя вывести или продать; неистраченные можно вернуть деньгами — <a href="/refund">политика возврата</a>.</li>
    <li>Вопросы — ${esc(SELLER.email)}.</li>
  </ul></section>

  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <p class="muted small sp-legal">Продавец: ${esc(sv(SELLER.name, 'уточняется'))} · <a href="/terms">Пользовательское соглашение</a> · <a href="/refund">Возврат</a> · <a href="/contacts">Реквизиты и контакты</a></p>
</main>`;
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(page({
    title: 'Магазин кристаллов 💎 — dan4ik37',
    description: 'Кристаллы — валюта сайта dan4ik37: VIP, подарки друзьям, монеты и вещи для персонажа. Цены пакетов, оплата картой Казахстана, Kaspi или донатом из России.',
    url, image: SITE + '/og-image.jpg', body, css: CSS, noAds: true,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.sp-hero{display:flex;gap:1.4rem;align-items:flex-start}
.sp-gem{font-size:4rem;line-height:1;filter:drop-shadow(0 10px 30px rgba(120,200,255,.5))}
.sp-hero h1{margin-top:0}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:720px}
.small{font-size:.8rem;margin-top:.7rem}
.small a,.sp-list a,.sp-legal a{color:#7cc4ff}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.sp-packs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.7rem}
.sp-pack{position:relative;display:flex;flex-direction:column;align-items:center;gap:.1rem;padding:1rem .6rem;border-radius:14px;background:rgba(120,190,255,.06);border:1px solid rgba(145,200,255,.25);text-align:center}
.sp-pack b{font-family:Oswald,sans-serif;font-size:1.4rem;color:#cfeaff}
.sp-pack span{font-size:.72rem;color:var(--muted)}
.sp-pack em{font-style:normal;font-weight:800;margin-top:.35rem}
.sp-pack small{font-size:.7rem;color:var(--muted)}
.sp-pack i{position:absolute;top:-9px;right:8px;padding:.1rem .45rem;border-radius:999px;background:#16a34a;color:#fff;font-style:normal;font-size:.68rem;font-weight:800}
.sp-list{padding-left:1.2rem;display:flex;flex-direction:column;gap:.45rem;font-size:.9rem}
.sp-legal{margin-top:1.4rem;text-align:center}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:600px){.sp-hero{flex-direction:column;gap:.4rem}.sp-gem{font-size:3rem}.sp-packs{grid-template-columns:1fr 1fr}}
`;

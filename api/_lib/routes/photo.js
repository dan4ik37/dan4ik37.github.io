// /tools/photo — «Фоторедактор онлайн»: страница для поиска (что умеет, как сделать превью и картинку для шортса, вопросы).
// Сам редактор — раздел сайта /photo (js/apps/apps.js → js/apps/photo/*, основа — fabric.js MIT): кнопка «Открыть редактор».
// Зачем: «фоторедактор онлайн», «обрезать фото», «надпись на фото», «сделать превью для ютуба» ищут все — страница для всех (0+).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

const FEATURES = [
  ['🗂️', 'Слои', 'Фото, надписи и рисунки — отдельными слоями: прозрачность, режимы наложения, порядок, объединить и свести.'],
  ['✂️', 'Обрезка', 'Свободно или в пропорции: 9:16 для шортсов и сторис, 16:9 для превью YouTube, 1:1 и 4:5 для постов.'],
  ['🎛️', 'Коррекция', 'Экспозиция, яркость, контраст, насыщенность, сочность, оттенок, теплее/холоднее, резкость — и «✨ Авто».'],
  ['✨', 'Фильтры', 'Ч/Б, сепия, винтаж, кодахром, техниколор, полароид и другие — в одно нажатие, без потери качества.'],
  ['🔤', 'Надписи', 'Шрифты с кириллицей (Montserrat, Rubik, Russo One, Lobster…), обводка, тень, выравнивание.'],
  ['🖌️', 'Кисть и ластик', 'Рисуй прямо по фото пальцем или мышью: размер, жёсткость, прозрачность, любой цвет.'],
  ['🖼️', 'Размер и поворот', 'Поменять размер, повернуть на 90°, отразить, новый холст под шортс, пост или превью.'],
  ['🤖', 'ИИ-помощник', 'Опиши словами, что сделать, — задание для любого ИИ-чата, ответ выполняется командами редактора.'],
  ['📤', 'Сохранение', 'PNG, JPG, WebP в полном размере; «Мои материалы» и «Студия 3D» — картинка сразу в другой инструмент сайта.'],
];
const STEPS = [
  ['Открой фото', 'Нажми «📂 Открыть фото» или перетащи файл в окно. Большие фото с телефона редактор сам уменьшит, если устройству тяжело.'],
  ['Обрежь', '«✂️ Обрезать» → выбери пропорцию (9:16 — шортс, 16:9 — превью) → «✓ Обрезать».'],
  ['Поправь цвет', '«🎛️ Коррекция» → «✨ Авто» или ползунки. Это можно поменять в любой момент.'],
  ['Добавь надпись', '«🔤 Текст» → нажми на фото → впиши текст, выбери шрифт, цвет и обводку.'],
  ['Сохрани', '«📤 Сохранить» → PNG или JPG. Готово — можно выкладывать.'],
];
const FAQ = [
  ['Это бесплатно?', 'Да, полностью бесплатно и без водяных знаков.'],
  ['Нужна регистрация?', 'Нет. Редактор работает сразу, войти на сайт не нужно.'],
  ['Куда уходят мои фото?', 'Никуда: фото обрабатываются в твоём браузере и не загружаются на сервер. «Мои материалы» тоже хранятся только в этом браузере.'],
  ['Работает на телефоне?', 'Да: на Android и iPhone. Два пальца — приблизить и сдвинуть, кнопки крупные. Очень большие фото уменьшаются, чтобы телефон не тормозил.'],
  ['Как сделать превью для YouTube?', 'Нажми «🖼️ Размер» → «Превью YouTube 1280×720», добавь фото слоем («🗂️ Слои» → «🖼 Фото»), надпись крупным шрифтом с обводкой и сохрани в JPG.'],
  ['Как сделать картинку для шортса или сторис?', 'Открой фото → «✂️ Обрезать» → «9:16» → «✓ Обрезать», добавь надпись и сохрани.'],
  ['Это Фотошоп?', 'Нет. Это свой редактор сайта на открытой основе fabric.js (лицензия MIT). Photoshop — программа и товарный знак Adobe; мы с ней не связаны.'],
  ['Какие форматы можно открыть и сохранить?', 'Открыть — JPG, PNG, WebP, GIF, BMP и другие, которые понимает браузер. Сохранить — PNG, JPG или WebP.'],
];

export default function handler(req, res) {
  const url = `${SITE}/tools/photo`;
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Фоторедактор онлайн', url, applicationCategory: 'MultimediaApplication', operatingSystem: 'Any', inLanguage: 'ru',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' }, featureList: FEATURES.map(f => f[1]).join(', ') },
    { '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Фоторедактор', item: url }] },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/">Главная</a> › <a href="/games">Игры и инструменты</a> › <span>Фоторедактор</span></nav>
  <h1>Фоторедактор онлайн</h1>
  <p class="lead">Бесплатный редактор фото прямо в браузере: слои, обрезка под шортс и превью, коррекция цвета, фильтры, надписи, кисть и ластик. Работает на телефоне и компьютере, без регистрации — фото не уходят на сервер.</p>
  <div class="ph-cta"><a class="btn btn-acc ph-open" href="/photo">🖼 Открыть редактор</a><span>0+ · бесплатно · без входа</span></div>
  <section class="box"><h2>Что умеет</h2><ul class="ph-feat">${FEATURES.map(([i, t, d]) => `<li><b>${i} ${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul></section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Как обработать фото за минуту</h2><ol class="ph-steps">${STEPS.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol></section>
  <section class="box faq"><h2>Частые вопросы</h2>${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Сделал картинку?</b><span>Шрифт для ника — в «Шрифтах для ника», ник для игры — в генераторе ников.</span></div><a class="btn btn-acc" href="/photo">🖼 Открыть редактор</a></aside>
</main>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'Фоторедактор онлайн бесплатно — слои, обрезка, текст, фильтры | dan4ik37',
    description: 'Бесплатный фоторедактор онлайн: обрезать фото под шортс и превью YouTube, поправить цвет, наложить фильтр и надпись, рисовать кистью, слои. Работает на телефоне, без регистрации.',
    url, image: SITE + '/img/share/photo.png', ld, body, css: CSS,
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.ph-cta{display:flex;align-items:center;flex-wrap:wrap;gap:.8rem 1rem;margin-top:1.2rem}
.ph-open{font-size:1rem;padding:1rem 1.6rem}
.ph-cta span{font-size:.8rem;color:var(--muted)}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.ph-feat{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.6rem}
.ph-feat li{display:flex;flex-direction:column;gap:.25rem;padding:.75rem .9rem;border-radius:12px;background:rgba(255,255,255,.04)}
.ph-feat b{font-size:.95rem}
.ph-feat span,.ph-steps span{font-size:.85rem;color:rgba(240,240,248,.78)}
.ph-steps{padding-left:1.2rem;display:flex;flex-direction:column;gap:.6rem}
.ph-steps li b{display:block}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
`;

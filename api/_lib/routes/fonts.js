// /tools/fonts — «Шрифты для ника»: впиши ник → 24 стиля букв + украшения + символы, нажал — скопировано.
// Зачем: «шрифты для ника», «красивые буквы для ника», «символы для ника» ищут постоянно — страница приводит
// людей из поиска независимо от канала (как /tools/nick). Стили — api/_lib/fonts.js (тот же код уходит в браузер).
// ?t=<ник> — открыть сразу со своим ником (ссылка из генератора ников).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { makeFonts } from '../fonts.js';

export default function handler(req, res) {
  const url = `${SITE}/tools/fonts`;
  const F = makeFonts();
  const sample = 'Nickname';
  const rows = F.convert(sample);
  const show = id => rows.find(r => r.id === id).out;
  const faq = [
    ['Как сделать ник красивым шрифтом?', 'Впиши ник в поле вверху, выбери стиль и нажми на него — ник скопируется. Потом вставь его в настройках игры или профиля (долгое нажатие → «Вставить»).'],
    ['Почему русские буквы не меняются?', 'Красивые «шрифты» — это специальные символы Юникода, и почти все они есть только для латиницы и цифр. Для русского ника подойдут зачёркнутый, подчёркнутый, «с пробелами» и украшения вроде ꧁…꧂ или ★彡…彡★.'],
    ['Почему вместо букв квадратики?', 'Значит, в этом приложении или игре нет нужных символов в шрифте. Попробуй другой стиль: «Жирный», «Маленькие заглавные» и «В кружках» работают почти везде.'],
    ['Сработает ли ник в игре?', 'Зависит от игры: у каждой свой набор разрешённых символов и длина ника. Если ник не сохранился или превратился в «?» — выбери стиль попроще или убери украшения.'],
    ['Это бесплатно?', 'Да, без регистрации и ограничений. Всё работает прямо в браузере — ник никуда не отправляется.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Шрифты для ника', url, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Генератор ников', item: SITE + '/tools/nick' },
      { '@type': 'ListItem', position: 3, name: 'Шрифты для ника', item: url },
    ] },
  ] };
  const rowHtml = r => `<button type="button" class="ft-row" data-id="${r.id}"><small>${esc(r.name)}${r.latinOnly ? '' : ' · и для русских букв'}</small><span>${esc(r.out)}</span></button>`;
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/tools/nick">Генератор ников</a> › <span>Шрифты для ника</span></nav>
  <h1>Шрифты для ника — красивые буквы и символы</h1>
  <p class="lead">Впиши ник — и получи его 24 красивыми шрифтами: ${esc(show('boldScript'))}, ${esc(show('boldFraktur'))}, ${esc(show('circled'))}, ${esc(show('smallCaps'))} и другими.
    Нажми на вариант — он скопируется. Подходит для Telegram, Discord, TikTok, ВКонтакте и многих игр.</p>
  <section class="ft">
    <input id="ftIn" class="ft-in" type="text" maxlength="40" value="${sample}" placeholder="Впиши ник" autocomplete="off" spellcheck="false" aria-label="Твой ник">
    <div class="ft-decor" id="ftDecor" aria-label="Украшение">${F.DECOR.map((d, i) => `<button type="button" class="ft-d${i ? '' : ' on'}" data-d="${i}">${i ? esc(d[0] + 'ник' + d[1]) : 'Без украшений'}</button>`).join('')}</div>
    <p class="ft-note muted" id="ftNote" hidden>Русские буквы меняются только в стилях «и для русских букв» — остальные стили меняют латиницу и цифры.</p>
    <div class="ft-list" id="ftList">${rows.map(rowHtml).join('')}</div>
    <div class="ft-copied" id="ftCopied" role="status"></div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Символы для ника</h2>
    <p class="muted">Нажми на символ — он добавится к нику в поле выше.</p>
    <div class="ft-sym" id="ftSym">${F.SYMBOLS.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div>
  </section>
  <section class="box"><h2>Как поставить красивый ник</h2><ol>
    <li>Впиши ник в поле вверху — варианты появятся сразу.</li>
    <li>Выбери украшение, если хочешь: ꧁ник꧂, 『ник』, ★彡ник彡★.</li>
    <li>Нажми на понравившийся вариант — он скопируется.</li>
    <li>Открой настройки игры или профиля и вставь ник (долгое нажатие → «Вставить»).</li>
  </ol></section>
  <section class="box"><h2>Это не шрифт, а символы</h2>
    <p>Игры и соцсети не дают выбрать шрифт для ника, но разрешают любые символы Юникода. Среди них есть тысячи «копий» латинских букв — жирные, рукописные, готические, в кружках. Сайт подставляет их вместо обычных букв, и ник выглядит как будто другим шрифтом — у всех, кто его видит.</p>
  </section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Нет идеи для ника?</b><span>Генератор подберёт крутой, милый, аниме или русский ник — а здесь сделаешь его красивым.</span></div><a class="btn btn-acc" href="/tools/nick">🎲 Генератор ников</a></aside>
</main>`;
  const script = `
(function(){
  var F=(${makeFonts.toString()})();
  var inp=document.getElementById('ftIn'), list=document.getElementById('ftList'), note=document.getElementById('ftNote'), info=document.getElementById('ftCopied'), decor=0;
  var q=new URLSearchParams(location.search).get('t'); if(q) inp.value=q.slice(0,40);
  function e(s){return s.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function draw(){ var t=inp.value||'Nickname'; note.hidden=!/[а-яё]/i.test(t);
    list.innerHTML=F.convert(t,decor).map(function(r){return '<button type="button" class="ft-row" data-id="'+r.id+'"><small>'+e(r.name)+(r.latinOnly?'':' · и для русских букв')+'</small><span>'+e(r.out)+'</span></button>'}).join(''); }
  inp.addEventListener('input',draw);
  document.getElementById('ftDecor').addEventListener('click',function(ev){ var b=ev.target.closest('.ft-d'); if(!b) return; decor=+b.dataset.d;
    document.querySelectorAll('.ft-d').forEach(function(x){x.classList.toggle('on',x===b)}); draw(); });
  document.getElementById('ftSym').addEventListener('click',function(ev){ var b=ev.target.closest('button'); if(!b) return; inp.value=(inp.value+b.textContent).slice(0,40); draw(); inp.focus(); });
  list.addEventListener('click',function(ev){ var b=ev.target.closest('.ft-row'); if(!b) return; var t=b.querySelector('span').textContent;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){ info.textContent='✓ Скопировано: '+t; b.classList.add('ok'); setTimeout(function(){b.classList.remove('ok')},900); },function(){ prompt('Скопируй ник:',t); });
    if(window.va) window.va('event',{name:'font_copy',data:{style:b.dataset.id}}); });
  if(q) draw();
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'Шрифты для ника — красивые буквы и символы для ника онлайн | dan4ik37',
    description: 'Красивый шрифт для ника онлайн: 24 стиля — каллиграфия, готика, буквы в кружках, маленькие заглавные — и 70+ символов ★ 亗 ꧁꧂ для ника в играх, Telegram и Discord. Нажми — и скопировано.',
    url, image: SITE + '/img/games/games.png', ld, body, script, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.ft{margin-top:1.4rem;padding:1.2rem;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.ft-in{width:100%;padding:.9rem 1rem;border-radius:14px;border:1.5px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);font:700 1.1rem Montserrat,sans-serif;outline:none}
.ft-in:focus{border-color:var(--accent)}
.ft-decor{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.8rem}
.ft-d{border:1.5px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);border-radius:10px;padding:.4rem .7rem;font:700 .76rem Montserrat,sans-serif;cursor:pointer}
.ft-d.on{color:#fff;border-color:var(--accent);background:rgba(255,45,85,.14)}
.ft-note{margin-top:.7rem;font-size:.8rem}
.ft-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.5rem;margin-top:1rem}
.ft-row{display:flex;flex-direction:column;align-items:flex-start;gap:.2rem;text-align:left;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);border-radius:12px;padding:.65rem .8rem;cursor:pointer;transition:border-color .15s,background .15s;min-width:0}
.ft-row small{font:700 .66rem Montserrat,sans-serif;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.ft-row span{font-size:1.15rem;line-height:1.35;word-break:break-all;font-family:system-ui,'Segoe UI Symbol','Noto Sans Symbols 2','Noto Sans Math',sans-serif}
.ft-row:hover{border-color:var(--accent)}
.ft-row.ok{border-color:#22c55e;background:rgba(34,197,94,.12)}
.ft-copied{margin-top:.8rem;font-size:.82rem;color:#4ade80;min-height:1.2rem;word-break:break-all}
.ft-sym{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.7rem}
.ft-sym button{min-width:44px;min-height:44px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);border-radius:10px;font-size:1.1rem;cursor:pointer}
.ft-sym button:hover{border-color:var(--accent)}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.box p{font-size:.9rem;color:rgba(240,240,248,.86)}
.box ol{padding-left:1.3rem;display:flex;flex-direction:column;gap:.4rem;font-size:.9rem;color:rgba(240,240,248,.86)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem}
@media(max-width:600px){.ft-list{grid-template-columns:1fr}.ft{padding:1rem}}
`;

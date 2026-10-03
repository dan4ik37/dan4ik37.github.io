// api/tool-nick.js — /tools/nick: «Генератор ников для игр» (rewrite в vercel.json).
// Зачем: «генератор ников», «ник для роблокс/стандофф/майнкрафт» ищут постоянно — страница приводит
// людей из поиска независимо от канала. Примеры в HTML (их видит поисковик) + живой генератор в браузере.
// Словари и генерация — api/_lib/nicks.js (тот же код уходит в страницу через toString()).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { STYLES, DECOR, generate, seeded } from '../nicks.js';

export default function handler(req, res) {
  const url = `${SITE}/tools/nick`;
  const rnd = seeded(37);
  const examples = Object.keys(STYLES).map(s => ({ s, list: Array.from({ length: 6 }, (_, i) => generate(s, i % 3 === 2 ? 'num' : 'none', rnd, STYLES, DECOR)) }));
  const faq = [
    ['Как придумать крутой ник для игры?', 'Возьми два коротких слова — характер и образ: «Тихий» + «Волк», Shadow + Fox. Ник должен легко читаться и запоминаться, а цифры лучше добавлять, только если имя занято.'],
    ['Подойдут ли эти ники для Roblox, Standoff 2, Minecraft, CS2?', 'Да. Но в Roblox и некоторых других играх нельзя пробелы и спецсимволы вроде 『』 и ★ — для них выбирай «Без украшений», «Цифры» или «Через _».'],
    ['Ник уже занят — что делать?', 'Нажми «Ещё варианты» или включи «Цифры»: к нику добавится число. Можно и поменять стиль — сочетаний тысячи.'],
    ['Это бесплатно?', 'Да, без регистрации. Нажми на ник — он скопируется.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Генератор ников для игр', url, applicationCategory: 'GameApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const opt = (name, map, def) => Object.entries(map).map(([k, v]) => `<button type="button" class="nk-opt${k === def ? ' on' : ''}" data-${name}="${k}">${esc(v.label)}</button>`).join('');
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Генератор ников</span></nav>
  <h1>Генератор ников для игр</h1>
  <p class="lead">Придумай ник для Roblox, Standoff 2, Minecraft, CS2 или Discord за секунду: выбери стиль — крутой, милый, страшный, аниме или по-русски. Нажми на ник, чтобы скопировать.</p>
  <section class="nk">
    <div class="nk-row"><span>Стиль</span><div>${opt('style', STYLES, 'cool')}</div></div>
    <div class="nk-row"><span>Украшение</span><div>${opt('decor', DECOR, 'none')}</div></div>
    <div class="nk-list" id="nkList">${examples[0].list.concat(examples[1].list).map(n => `<button type="button" class="nk-nick">${esc(n)}</button>`).join('')}</div>
    <div class="nk-act"><button type="button" class="btn btn-acc" id="nkMore">🎲 Ещё варианты</button><span class="muted" id="nkCopied"></span></div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Примеры ников по стилям</h2>
    ${examples.map(e => `<h3>${esc(STYLES[e.s].label)}</h3><p class="nk-ex">${e.list.map(esc).join(' · ')}</p>`).join('')}
  </section>
  <section class="box"><h2>Как выбрать хороший ник</h2><ul>
    <li>Короткий ник проще запомнить и написать в чате — лучше 6–14 символов.</li>
    <li>Без личных данных: не используй настоящее имя, фамилию и год рождения.</li>
    <li>Проверь, что ник читается без украшений — в некоторых играх символы ★ и 『』 запрещены.</li>
    <li>Один ник во всех играх и соцсетях — так тебя легче найти друзьям.</li>
  </ul></section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Придумал ник? Проверь его в деле</b><span>На сайте dan4ik37 — 12 бесплатных игр с друзьями: морской бой, «5 букв», города, шашки.</span></div><a class="btn btn-acc" href="/games">🎮 Играть</a></aside>
</main>`;
  const script = `
(function(){
  var S=${JSON.stringify(STYLES)}, D=${JSON.stringify(DECOR)}, gen=${generate.toString()};
  var style='cool', decor='none', list=document.getElementById('nkList'), info=document.getElementById('nkCopied');
  function draw(){ var h=''; var seen={}; for(var i=0;i<12;i++){ var n=gen(style,decor,Math.random,S,D); if(seen[n]){i--;continue;} seen[n]=1; h+='<button type="button" class="nk-nick">'+n.replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})+'</button>'; } list.innerHTML=h; }
  document.querySelectorAll('[data-style]').forEach(function(b){ b.onclick=function(){ style=b.dataset.style; document.querySelectorAll('[data-style]').forEach(function(x){x.classList.toggle('on',x===b)}); draw(); }; });
  document.querySelectorAll('[data-decor]').forEach(function(b){ b.onclick=function(){ decor=b.dataset.decor; document.querySelectorAll('[data-decor]').forEach(function(x){x.classList.toggle('on',x===b)}); draw(); }; });
  document.getElementById('nkMore').onclick=draw;
  list.addEventListener('click',function(e){ var b=e.target.closest('.nk-nick'); if(!b) return; var t=b.textContent;
    (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){ info.textContent='✓ «'+t+'» скопирован'; b.classList.add('ok'); setTimeout(function(){b.classList.remove('ok')},900); },function(){ prompt('Скопируй ник:',t); });
    if(window.va) window.va('event',{name:'nick_copy',data:{style:style}}); });
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'Генератор ников для игр — крутые, милые, аниме и русские ники | dan4ik37',
    description: 'Бесплатный генератор ников для Roblox, Standoff 2, Minecraft, CS2 и Discord: крутые, милые, страшные, аниме и русские ники. Нажми — и ник скопирован.',
    url, image: SITE + '/img/games/games.png', ld, body, script, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:760px}
.nk{margin-top:1.4rem;padding:1.2rem;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.nk-row{display:flex;gap:.8rem;align-items:flex-start;flex-wrap:wrap;margin-bottom:.7rem}
.nk-row>span{flex:none;width:96px;font-size:.75rem;font-weight:800;color:var(--muted);padding-top:.4rem;text-transform:uppercase;letter-spacing:.06em}
.nk-row>div{display:flex;flex-wrap:wrap;gap:.35rem;flex:1;min-width:0}
.nk-opt{border:1.5px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);border-radius:10px;padding:.4rem .75rem;font:700 .76rem Montserrat,sans-serif;cursor:pointer}
.nk-opt.on{color:#fff;border-color:var(--accent);background:rgba(255,45,85,.14)}
.nk-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.5rem;margin-top:1rem}
.nk-nick{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);border-radius:12px;padding:.75rem .6rem;font:700 .92rem Montserrat,sans-serif;cursor:pointer;transition:border-color .15s,background .15s;word-break:break-all}
.nk-nick:hover{border-color:var(--accent)}
.nk-nick.ok{border-color:#22c55e;background:rgba(34,197,94,.12)}
.nk-act{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin-top:1rem;font-size:.8rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.box h3{font-size:.85rem;margin:.8rem 0 .3rem}
.box ul{padding-left:1.2rem;display:flex;flex-direction:column;gap:.4rem;font-size:.9rem;color:rgba(240,240,248,.86)}
.nk-ex{font-size:.88rem;color:rgba(240,240,248,.82)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:600px){.nk-row>span{width:100%;padding:0}.nk-list{grid-template-columns:1fr 1fr}}
`;

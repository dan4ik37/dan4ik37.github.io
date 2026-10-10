// /tools/cps — «Тест скорости кликов (CPS)»: сколько кликов в секунду — 1, 5 или 10 секунд, звание, рекорд.
// Зачем: «cps тест», «кликер тест», «тест на скорость клика» постоянно ищут игроки (Minecraft PvP и др.) —
// страница приводит людей из поиска и уводит в игры сайта. Всё считается в браузере, сервер только рисует страницу.
// ?s=<cps>&n=<ник> — вызов от друга: «Ник набрал N — побьёшь?» (как «📣 Вызов» в играх).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

// Звания по CPS — те же пороги, что в скрипте страницы (RANKS ниже уходит в браузер JSON-ом)
const RANKS = [
  [0, '🐢 Черепаха', 'Не торопишься — бывает. Попробуй кликать двумя пальцами по очереди.'],
  [4, '🙂 Новичок', 'Обычный темп. Расслабь руку — напряжение тормозит.'],
  [6, '⚡ Быстрый', 'Быстрее большинства игроков!'],
  [8, '🔥 Кликер', 'Отличный темп — в PvP это уже заметно.'],
  [10, '🚀 Машина', 'Очень быстро — так кликают опытные PvP-игроки.'],
  [13, '👑 Бог кликов', 'Невероятно! Такой CPS — уровень профи (или баттерфляй-клик 😉).'],
];

export default function handler(req, res) {
  const url = `${SITE}/tools/cps`;
  const s = Math.min(50, Math.max(0, parseFloat(req.query.s) || 0));
  const n = String(req.query.n || '').replace(/[<>"]/g, '').slice(0, 24);
  const challenge = s > 0 ? `${n || 'Друг'} набрал ${s.toFixed(1).replace('.', ',')} CPS — побьёшь?` : '';
  const faq = [
    ['Что такое CPS?', 'CPS (clicks per second) — сколько раз ты кликаешь мышкой за одну секунду. Тест считает все клики за выбранное время и делит на число секунд.'],
    ['Какой CPS считается хорошим?', 'У большинства людей обычным кликом выходит 5–7 CPS. 8–10 — быстро, больше 10 — уровень опытных PvP-игроков, больше 13 обычно получается только особыми техниками.'],
    ['Как кликать быстрее?', 'Расслабь кисть, кликай подушечкой пальца, а не всей рукой. Популярные техники: джиттер-клик (мелкое дрожание напряжённой руки), баттерфляй-клик (два пальца по очереди по одной кнопке) и драг-клик (палец скользит по кнопке).'],
    ['Работает ли тест на телефоне?', 'Да: тапай по полю пальцами — считаются касания, можно двумя пальцами по очереди.'],
    ['Это бесплатно?', 'Да, без регистрации. Рекорд сохраняется в твоём браузере.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Тест скорости кликов (CPS)', url, applicationCategory: 'GameApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>CPS тест</span></nav>
  <h1>CPS тест — сколько кликов в секунду</h1>
  ${challenge ? `<p class="cp-chal">📣 ${esc(challenge)}</p>` : ''}
  <p class="lead">Кликай по полю как можно быстрее — тест покажет твой CPS (кликов в секунду), звание и рекорд. Выбери время: 1, 5 или 10 секунд. Работает с мышкой и на телефоне.</p>
  <section class="cp">
    <div class="cp-modes" id="cpModes"><button type="button" data-t="1">1 сек</button><button type="button" class="on" data-t="5">5 сек</button><button type="button" data-t="10">10 сек</button></div>
    <div class="cp-stats"><div><b id="cpTime">5,0</b><small>секунд</small></div><div><b id="cpClicks">0</b><small>кликов</small></div><div><b id="cpCps">0,0</b><small>CPS</small></div><div><b id="cpBest">—</b><small>рекорд</small></div></div>
    <button type="button" class="cp-pad" id="cpPad" aria-label="Поле для кликов">Кликни, чтобы начать</button>
    <div class="cp-res" id="cpRes" hidden></div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Звания по CPS</h2><ul class="cp-ranks">${RANKS.map((r, i) => `<li><b>${esc(r[1])}</b><span>${i < RANKS.length - 1 ? `${r[0]}–${RANKS[i + 1][0]}` : `${r[0]}+`} CPS</span></li>`).join('')}</ul></section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Быстрые пальцы? А печатаешь как?</b><span>Тест скорости печати: сколько знаков в минуту — с рекордом и вызовом другу. А на реакцию — игры на сайте.</span></div><a class="btn btn-acc" href="/tools/typing">⌨️ Тест печати</a></aside>
</main>`;
  const script = `
(function(){
  var RANKS=${JSON.stringify(RANKS)};
  var dur=5, clicks=0, t0=0, timer=0, state='idle';   // idle → run → done
  var pad=document.getElementById('cpPad'), res=document.getElementById('cpRes');
  var el=function(id){return document.getElementById(id)}, f1=function(x){return x.toFixed(1).replace('.',',')};
  function best(){ try{ return parseFloat(localStorage.getItem('d37_cps_'+dur))||0 }catch(e){ return 0 } }
  function showBest(){ var b=best(); el('cpBest').textContent=b?f1(b):'—'; }
  function reset(){ clearInterval(timer); state='idle'; clicks=0; el('cpTime').textContent=f1(dur); el('cpClicks').textContent='0'; el('cpCps').textContent='0,0';
    pad.textContent='Кликни, чтобы начать'; pad.classList.remove('run','done'); res.hidden=true; showBest(); }
  function tick(){ var left=Math.max(0,dur-(performance.now()-t0)/1000); el('cpTime').textContent=f1(left);
    var spent=Math.max(.2,(performance.now()-t0)/1000); el('cpCps').textContent=f1(clicks/spent); if(left<=0) finish(); }
  function finish(){ clearInterval(timer); state='done'; var cps=clicks/dur; el('cpCps').textContent=f1(cps); el('cpTime').textContent='0,0';
    pad.classList.remove('run'); pad.classList.add('done'); pad.textContent='Готово!';
    var r=RANKS[0]; RANKS.forEach(function(x){ if(cps>=x[0]) r=x; });
    var old=best(), rec=cps>old; if(rec){ try{ localStorage.setItem('d37_cps_'+dur,String(cps)) }catch(e){} } showBest();
    res.hidden=false;
    res.innerHTML='<b>'+r[1]+'</b><span>'+f1(cps)+' CPS за '+dur+' сек ('+clicks+' кликов)'+(rec&&old?' — новый рекорд! 🎉':'')+'</span><p>'+r[2]+'</p>'+
      '<div class="cp-act"><button type="button" class="btn btn-acc" id="cpAgain">↻ Ещё раз</button><button type="button" class="btn btn-ghost" id="cpShare">📣 Вызвать друга</button></div>';
    el('cpAgain').onclick=reset;
    el('cpShare').onclick=function(){ var u=location.origin+'/tools/cps?s='+cps.toFixed(1), txt='Мой CPS: '+f1(cps)+' ('+r[1]+'). Побьёшь?';
      if(navigator.share) navigator.share({title:'CPS тест',text:txt,url:u}).catch(function(){}); else (navigator.clipboard?navigator.clipboard.writeText(txt+' '+u):Promise.reject()).then(function(){ el('cpShare').textContent='✓ Ссылка скопирована'; },function(){ prompt('Скопируй ссылку:',u); }); };
    if(window.va) window.va('event',{name:'cps_done',data:{dur:dur,cps:Math.round(cps)}});
    pad.disabled=true; setTimeout(function(){ pad.disabled=false; },700);   // случайные клики после конца не начинают новый заход
  }
  pad.addEventListener('pointerdown',function(e){ e.preventDefault();
    if(state==='done'){ reset(); return; }
    if(state==='idle'){ state='run'; t0=performance.now(); timer=setInterval(tick,50); pad.classList.add('run'); }
    clicks++; el('cpClicks').textContent=clicks; pad.textContent=clicks; });
  pad.addEventListener('contextmenu',function(e){ e.preventDefault(); });
  el('cpModes').addEventListener('click',function(e){ var b=e.target.closest('button'); if(!b) return; dur=+b.dataset.t;
    document.querySelectorAll('#cpModes button').forEach(function(x){ x.classList.toggle('on',x===b) }); reset(); });
  reset();
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: challenge ? `${challenge} | CPS тест` : 'CPS тест — проверить скорость кликов в секунду онлайн | dan4ik37',
    description: 'Бесплатный CPS тест: сколько кликов в секунду ты делаешь за 1, 5 или 10 секунд. Звание, рекорд и вызов другу. Работает с мышкой и на телефоне.',
    url, image: SITE + '/img/share/cps.png', ld, body, script, css: CSS, noindex: !!challenge
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:760px}
.cp-chal{margin-top:.8rem;padding:.7rem 1rem;border-radius:12px;background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.35);color:#ffd166;font-weight:800}
.cp{margin-top:1.4rem;padding:1.2rem;border-radius:18px;background:var(--card);border:1px solid var(--line)}
.cp-modes{display:flex;gap:.4rem;justify-content:center}
.cp-modes button{border:1.5px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);border-radius:10px;padding:.5rem 1rem;font:800 .8rem Montserrat,sans-serif;cursor:pointer;min-height:40px}
.cp-modes button.on{color:#fff;border-color:var(--accent);background:rgba(255,45,85,.14)}
.cp-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin:1rem 0;text-align:center}
.cp-stats div{padding:.6rem .3rem;border-radius:12px;background:rgba(255,255,255,.04)}
.cp-stats b{display:block;font:800 1.5rem Montserrat,sans-serif}
.cp-stats small{font-size:.66rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.cp-pad{display:flex;align-items:center;justify-content:center;width:100%;height:clamp(200px,42vh,340px);border-radius:18px;border:2px dashed rgba(255,255,255,.18);
  background:radial-gradient(circle at 50% 40%,rgba(255,45,85,.16),rgba(255,255,255,.02));color:var(--text);font:800 clamp(1.2rem,5vw,2.4rem) Montserrat,sans-serif;
  cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.cp-pad.run{border-style:solid;border-color:var(--accent);background:radial-gradient(circle at 50% 40%,rgba(255,45,85,.3),rgba(255,107,53,.08))}
.cp-pad.done{border-color:#22c55e}
.cp-pad:active{transform:scale(.995)}
.cp-res{margin-top:1rem;text-align:center;display:flex;flex-direction:column;gap:.3rem;align-items:center}
.cp-res[hidden]{display:none}
.cp-res b{font-size:1.5rem}
.cp-res span{font-weight:700}
.cp-res p{color:var(--muted);font-size:.9rem}
.cp-act{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;margin-top:.5rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.cp-ranks{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.5rem}
.cp-ranks li{display:flex;justify-content:space-between;gap:.5rem;padding:.6rem .8rem;border-radius:10px;background:rgba(255,255,255,.04);font-size:.88rem}
.cp-ranks span{color:var(--muted)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:600px){.cp-stats b{font-size:1.2rem}.cp{padding:1rem}}
`;

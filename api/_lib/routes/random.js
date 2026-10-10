// /tools/random — «Генератор случайных чисел»: числа (от–до, сколько, без повторов), монетка (орёл/решка), кубики.
// Зачем: «рандомайзер», «генератор случайных чисел», «орёл или решка», «кинуть кубик» ищут постоянно — розыгрыши,
// жеребьёвки, выбор очереди. Честный рандом — crypto.getRandomValues в браузере, сервер только рисует страницу.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

export default function handler(req, res) {
  const url = `${SITE}/tools/random`;
  const faq = [
    ['Это честный рандом?', 'Да. Числа берутся из криптографически стойкого генератора браузера (crypto.getRandomValues) без перекосов: у каждого числа из диапазона одинаковый шанс.'],
    ['Как провести розыгрыш по номерам?', 'Пронумеруй участников, впиши диапазон от 1 до количества участников и нужное число победителей, включи «без повторов» — один номер не выпадет дважды.'],
    ['Можно ли подкинуть монетку онлайн?', 'Да, вкладка «Монетка»: орёл или решка с равным шансом 50/50, рядом — счёт, сколько раз что выпало.'],
    ['Сколько кубиков можно кинуть?', 'От одного до шести обычных кубиков d6 сразу — сумма считается сама.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Генератор случайных чисел', url, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>Генератор случайных чисел</span></nav>
  <h1>Генератор случайных чисел</h1>
  <p class="lead">Рандомайзер онлайн: случайное число в любом диапазоне, несколько чисел без повторов для розыгрыша, монетка «орёл или решка» и кубики. Честно и бесплатно.</p>
  <section class="rn">
    <nav class="rn-tabs" role="tablist"><button type="button" class="on" data-tab="num">🔢 Числа</button><button type="button" data-tab="coin">🪙 Монетка</button><button type="button" data-tab="dice">🎲 Кубики</button></nav>
    <div class="rn-pane" data-pane="num">
      <div class="rn-row"><label>От<input type="number" id="rnFrom" value="1" inputmode="numeric"></label><label>До<input type="number" id="rnTo" value="100" inputmode="numeric"></label><label>Сколько<input type="number" id="rnCount" value="1" min="1" max="100" inputmode="numeric"></label></div>
      <label class="rn-chk"><input type="checkbox" id="rnUnique" checked> Без повторов</label>
      <button type="button" class="btn btn-acc rn-go" id="rnGo">🎲 Сгенерировать</button>
      <div class="rn-out" id="rnOut" aria-live="polite"></div>
    </div>
    <div class="rn-pane" data-pane="coin" hidden>
      <div class="rn-coin" id="rnCoin" aria-live="polite">🪙</div>
      <button type="button" class="btn btn-acc rn-go" id="rnFlip">Подбросить монетку</button>
      <div class="rn-score" id="rnCoinScore">Орёл: 0 · Решка: 0</div>
    </div>
    <div class="rn-pane" data-pane="dice" hidden>
      <div class="rn-row"><label>Кубиков<input type="number" id="rnDiceN" value="2" min="1" max="6" inputmode="numeric"></label></div>
      <div class="rn-dice" id="rnDice" aria-live="polite"></div>
      <button type="button" class="btn btn-acc rn-go" id="rnRoll">Кинуть кубики</button>
    </div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Нужно выбрать из вариантов, а не из чисел?</b><span>Колесо фортуны: впиши варианты — «кто моет посуду», «во что поиграть» — и крути.</span></div><a class="btn btn-acc" href="/tools/wheel">🎡 Колесо фортуны</a></aside>
</main>`;
  const script = `
(function(){
  function rnd(n){ if(window.crypto&&crypto.getRandomValues){ var u=new Uint32Array(1), lim=Math.floor(4294967296/n)*n; do{ crypto.getRandomValues(u); }while(u[0]>=lim); return u[0]%n; } return Math.floor(Math.random()*n); }
  var el=function(id){return document.getElementById(id)};
  document.querySelector('.rn-tabs').addEventListener('click',function(e){ var b=e.target.closest('[data-tab]'); if(!b) return;
    document.querySelectorAll('.rn-tabs button').forEach(function(x){x.classList.toggle('on',x===b)});
    document.querySelectorAll('.rn-pane').forEach(function(p){p.hidden=p.dataset.pane!==b.dataset.tab}); });
  el('rnGo').onclick=function(){ var a=Math.round(+el('rnFrom').value), b=Math.round(+el('rnTo').value), n=Math.max(1,Math.min(100,Math.round(+el('rnCount').value)||1)), uniq=el('rnUnique').checked, out=el('rnOut');
    if(!isFinite(a)||!isFinite(b)){ out.textContent='Впиши числа'; return; } if(a>b){ var t=a; a=b; b=t; }
    var span=b-a+1; if(span>1e9){ out.textContent='Слишком большой диапазон (до миллиарда чисел)'; return; }
    if(uniq&&n>span){ out.textContent='Без повторов в этом диапазоне можно не больше '+span; return; }
    var res=[], used={}; while(res.length<n){ var x=a+rnd(span); if(uniq){ if(used[x]) continue; used[x]=1; } res.push(x); }
    out.innerHTML=res.map(function(x){return '<b>'+x+'</b>'}).join('');
    if(window.va) window.va('event',{name:'random_num',data:{n:n}}); };
  var heads=0, tails=0;
  el('rnFlip').onclick=function(){ var c=el('rnCoin'), h=rnd(2)===0; c.classList.remove('spin'); void c.offsetWidth; c.classList.add('spin');
    setTimeout(function(){ c.textContent=h?'🦅 Орёл':'🪙 Решка'; if(h) heads++; else tails++; el('rnCoinScore').textContent='Орёл: '+heads+' · Решка: '+tails; },350); };
  var F=['⚀','⚁','⚂','⚃','⚄','⚅'];
  el('rnRoll').onclick=function(){ var n=Math.max(1,Math.min(6,Math.round(+el('rnDiceN').value)||1)), s=0, h='';
    for(var i=0;i<n;i++){ var v=rnd(6)+1; s+=v; h+='<span title="'+v+'">'+F[v-1]+'</span>'; }
    el('rnDice').innerHTML=h+(n>1?'<small>Сумма: <b>'+s+'</b></small>':'<small>Выпало: <b>'+s+'</b></small>'); };
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: 'Генератор случайных чисел — рандомайзер онлайн, монетка и кубики | dan4ik37',
    description: 'Бесплатный генератор случайных чисел: любой диапазон, несколько чисел без повторов для розыгрыша, монетка «орёл или решка» и кубики. Честный рандом.',
    url, image: SITE + '/img/share/random.png', ld, body, script, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.rn{margin-top:1.4rem;padding:1.2rem;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.rn-tabs{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:1rem}
.rn-tabs button{border:1.5px solid var(--line);background:rgba(255,255,255,.03);color:var(--muted);border-radius:10px;padding:.5rem .9rem;font:800 .85rem Montserrat,sans-serif;cursor:pointer;min-height:42px}
.rn-tabs button.on{color:#fff;border-color:var(--accent);background:rgba(255,45,85,.14)}
.rn-pane[hidden]{display:none}
.rn-row{display:flex;gap:.6rem;flex-wrap:wrap}
.rn-row label{display:flex;flex-direction:column;gap:.25rem;font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;flex:1;min-width:90px}
.rn-row input{padding:.7rem .8rem;border-radius:12px;border:1.5px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);font:700 1.05rem Montserrat,sans-serif;width:100%}
.rn-row input:focus{outline:none;border-color:var(--accent)}
.rn-chk{display:flex;gap:.5rem;align-items:center;margin:.8rem 0;font-size:.88rem;cursor:pointer}
.rn-chk input{width:18px;height:18px;accent-color:var(--accent)}
.rn-go{margin-top:.4rem;font-size:.95rem;padding:.8rem 1.4rem}
.rn-out{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem;min-height:3rem;align-items:center;color:var(--muted)}
.rn-out b{display:inline-flex;align-items:center;justify-content:center;min-width:64px;padding:.6rem .9rem;border-radius:14px;background:rgba(255,209,102,.12);border:1px solid rgba(255,209,102,.35);color:#ffd166;font-size:1.6rem}
.rn-coin{display:flex;align-items:center;justify-content:center;min-height:120px;font-size:2.4rem;font-weight:800}
.rn-coin.spin{animation:rnSpin .35s ease-in}
@keyframes rnSpin{0%{transform:rotateY(0) scale(1)}50%{transform:rotateY(540deg) scale(1.15)}100%{transform:rotateY(1080deg) scale(1)}}
.rn-score{margin-top:.6rem;color:var(--muted);font-size:.85rem}
.rn-dice{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;min-height:110px;margin:.6rem 0;font-size:4.2rem;line-height:1}
.rn-dice small{font-size:.95rem;color:var(--muted);margin-left:.6rem}
.rn-dice small b{color:#ffd166;font-size:1.3rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(prefers-reduced-motion:reduce){.rn-coin.spin{animation:none}}
`;

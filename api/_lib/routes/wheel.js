// /tools/wheel — «Колесо фортуны»: свои варианты, честный случайный выбор, «убрать выпавшее» для розыгрышей,
// история и ссылка на колесо с этими же вариантами (?o=вариант|вариант…, такие ссылки noindex).
// Зачем: «колесо фортуны онлайн», «рандомайзер» ищут все — от «кто моет посуду» до розыгрышей на стримах.
// Всё крутится в браузере (canvas), сервер только рисует страницу с вариантами.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

const DEFAULT = ['Майнкрафт', 'Роблокс', 'CS2', 'Терария', 'FNAF', 'Fortnite'];
const MAX = 40;

export default function handler(req, res) {
  const url = `${SITE}/tools/wheel`;
  const custom = String(req.query.o || '').split('|').map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, MAX);
  const opts = custom.length >= 2 ? custom : DEFAULT;
  const faq = [
    ['Колесо выбирает честно?', 'Да. Победитель выбирается случайно ещё до вращения (криптографически стойкий генератор браузера), у каждого варианта одинаковый шанс. Анимация лишь показывает результат.'],
    ['Можно ли провести розыгрыш?', 'Да: впиши участников по одному на строку и крути. Включи «Убирать выпавшее», чтобы победитель не выпал второй раз, — так удобно разыгрывать несколько призов.'],
    ['Сколько вариантов можно добавить?', `До ${MAX}. Одинаковые варианты тоже можно — тогда у них больше шансов.`],
    ['Как поделиться колесом?', 'Нажми «🔗 Ссылка на колесо» — в ссылке будут твои варианты. Друг откроет то же колесо.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Колесо фортуны онлайн', url, applicationCategory: 'UtilitiesApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>Колесо фортуны</span></nav>
  <h1>Колесо фортуны онлайн</h1>
  <p class="lead">Впиши варианты — по одному на строку — и крути колесо. Решай, во что поиграть, кто моет посуду или кто выиграл приз. Бесплатно и честно: у каждого варианта равный шанс.</p>
  <section class="wh">
    <div class="wh-wheel">
      <div class="wh-ptr" aria-hidden="true"></div>
      <canvas id="whCanvas" width="640" height="640" aria-label="Колесо фортуны"></canvas>
      <button type="button" class="wh-spin" id="whSpin">КРУТИТЬ</button>
    </div>
    <div class="wh-side">
      <div class="wh-res" id="whRes" role="status" aria-live="polite">Нажми «Крутить» 🎡</div>
      <label class="wh-lbl" for="whOpts">Варианты (по одному на строку, до ${MAX})</label>
      <textarea id="whOpts" rows="8" spellcheck="false">${esc(opts.join('\n'))}</textarea>
      <label class="wh-chk"><input type="checkbox" id="whRemove"> Убирать выпавшее (для розыгрышей)</label>
      <div class="wh-act"><button type="button" class="btn btn-ghost" id="whShuffle">🔀 Перемешать</button><button type="button" class="btn btn-ghost" id="whLink">🔗 Ссылка на колесо</button></div>
      <ol class="wh-hist" id="whHist"></ol>
    </div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Идеи для колеса</h2><div class="wh-ideas">
    <a href="/tools/wheel?o=${encodeURIComponent('Да|Нет|Может быть|Спроси позже|Точно да|Ни за что')}">🎱 Да или нет</a>
    <a href="/tools/wheel?o=${encodeURIComponent('Пицца|Суши|Бургер|Шаурма|Паста|Пельмени')}">🍕 Что заказать</a>
    <a href="/tools/wheel?o=${encodeURIComponent('Майнкрафт|Роблокс|CS2|Терария|FNAF|Fortnite')}">🎮 Во что поиграть</a>
    <a href="/tools/wheel?o=${encodeURIComponent('Комедия|Ужасы|Боевик|Мультфильм|Фантастика|Аниме')}">🎬 Что посмотреть</a>
    <a href="/tools/wheel?o=${encodeURIComponent('1|2|3|4|5|6')}">🎲 Кубик</a>
  </div></section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>Выпало «играть»? Играй с друзьями</b><span>На сайте dan4ik37 — «5 букв», морской бой, города, шашки и тесты «Кто ты из игр».</span></div><a class="btn btn-acc" href="/games">🎮 Играть</a></aside>
</main>`;
  const script = `
(function(){
  var MAX=${MAX}, cv=document.getElementById('whCanvas'), cx=cv.getContext('2d'), ta=document.getElementById('whOpts'), res=document.getElementById('whRes'),
      spinBtn=document.getElementById('whSpin'), hist=document.getElementById('whHist'), rm=document.getElementById('whRemove');
  var COLORS=['#ff2d55','#ff6b35','#ffd166','#22c55e','#29b6f6','#9147ff','#ec4899','#14b8a6'], angle=0, spinning=false;
  function opts(){ return ta.value.split('\\n').map(function(s){return s.trim()}).filter(Boolean).slice(0,MAX); }
  function draw(){ var o=opts(), n=Math.max(o.length,1), R=cv.width/2, step=2*Math.PI/n; cx.clearRect(0,0,cv.width,cv.height);
    for(var k=0;k<n;k++){ var a0=angle+k*step-Math.PI/2; cx.beginPath(); cx.moveTo(R,R); cx.arc(R,R,R-4,a0,a0+step); cx.closePath();
      cx.fillStyle=o.length?COLORS[k%COLORS.length]:'#333'; if(n%COLORS.length===1&&k===n-1&&n>1) cx.fillStyle=COLORS[2]; cx.fill();
      cx.strokeStyle='rgba(8,8,14,.6)'; cx.lineWidth=3; cx.stroke();
      if(!o.length) continue; cx.save(); cx.translate(R,R); cx.rotate(a0+step/2); cx.textAlign='right'; cx.textBaseline='middle';
      cx.fillStyle='#0b0b12'; var fs=Math.max(14,Math.min(30,Math.floor(380/Math.max(6,n)))); cx.font='800 '+fs+'px Montserrat, system-ui, sans-serif';
      var t=o[k].length>18?o[k].slice(0,17)+'…':o[k]; cx.fillText(t,R-22,0); cx.restore(); }
    cx.beginPath(); cx.arc(R,R,46,0,2*Math.PI); cx.fillStyle='#111119'; cx.fill(); }
  function rnd(n){ if(window.crypto&&crypto.getRandomValues){ var u=new Uint32Array(1), lim=Math.floor(4294967296/n)*n; do{ crypto.getRandomValues(u); }while(u[0]>=lim); return u[0]%n; } return Math.floor(Math.random()*n); }
  function spin(){ var o=opts(); if(spinning) return; if(o.length<2){ res.textContent='Добавь хотя бы 2 варианта'; return; }
    spinning=true; spinBtn.disabled=true; var n=o.length, step=2*Math.PI/n, win=rnd(n);
    // Победитель выбран заранее; колесо доворачивается так, чтобы его сектор встал под стрелку (сверху), со случайным сдвигом внутри сектора
    var inSector=(0.15+0.7*Math.random())*step, target=-(win*step+inSector), cur=((angle%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    var delta=((target-cur)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)+2*Math.PI*(5+rnd(3)), start=angle, t0=performance.now(), dur=4200;
    res.textContent='Крутится…';
    (function frame(now){ var p=Math.min(1,(now-t0)/dur), e=1-Math.pow(1-p,3); angle=start+delta*e; draw();
      if(p<1){ requestAnimationFrame(frame); return; }
      spinning=false; spinBtn.disabled=false; var w=o[win]; res.innerHTML='Выпало: <b></b>'; res.querySelector('b').textContent=w;
      var li=document.createElement('li'); li.textContent=w; hist.prepend(li); while(hist.children.length>10) hist.lastChild.remove();
      if(rm.checked){ var lines=ta.value.split('\\n'), idx=-1, seen=-1; for(var k=0;k<lines.length;k++){ if(lines[k].trim()){ seen++; if(seen===win){ idx=k; break; } } } if(idx>=0){ lines.splice(idx,1); ta.value=lines.join('\\n'); draw(); } }
      if(window.va) window.va('event',{name:'wheel_spin',data:{n:n}});
    })(t0); }
  spinBtn.onclick=spin; cv.onclick=spin; ta.addEventListener('input',draw);
  document.getElementById('whShuffle').onclick=function(){ var o=opts(); for(var k=o.length-1;k>0;k--){ var j=rnd(k+1), t=o[k]; o[k]=o[j]; o[j]=t; } ta.value=o.join('\\n'); draw(); };
  document.getElementById('whLink').onclick=function(){ var u=location.origin+'/tools/wheel?o='+encodeURIComponent(opts().join('|')), b=this;
    (navigator.clipboard?navigator.clipboard.writeText(u):Promise.reject()).then(function(){ b.textContent='✓ Ссылка скопирована'; setTimeout(function(){ b.textContent='🔗 Ссылка на колесо'; },1800); },function(){ prompt('Скопируй ссылку:',u); }); };
  draw();
  if(document.fonts&&document.fonts.ready) document.fonts.ready.then(draw);
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: custom.length >= 2 ? `Колесо фортуны: ${custom.slice(0, 4).join(', ')}${custom.length > 4 ? '…' : ''}` : 'Колесо фортуны онлайн — крутить рандом с вариантами | dan4ik37',
    description: 'Бесплатное колесо фортуны онлайн: впиши свои варианты и крути. Честный рандом, розыгрыши без повторов, ссылка на колесо для друзей.',
    url, image: SITE + '/img/share/wheel.png', ld, body, script, css: CSS, noindex: custom.length >= 2
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.wh{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:1.4rem;margin-top:1.4rem;padding:1.2rem;border-radius:20px;background:var(--card);border:1px solid var(--line);align-items:start}
.wh-wheel{position:relative;width:100%;max-width:460px;margin:0 auto;aspect-ratio:1}
.wh-wheel canvas{width:100%;height:100%;display:block;border-radius:50%;box-shadow:0 0 0 6px rgba(255,255,255,.06),0 20px 60px -20px rgba(0,0,0,.8);cursor:pointer}
.wh-ptr{position:absolute;left:50%;top:-6px;transform:translateX(-50%);width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-top:30px solid #fff;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6));z-index:2}
.wh-spin{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:84px;height:84px;border-radius:50%;border:3px solid rgba(255,255,255,.15);
  background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font:800 .78rem Montserrat,sans-serif;letter-spacing:.04em;cursor:pointer;z-index:2;box-shadow:0 10px 30px -8px rgba(255,45,85,.8)}
.wh-spin:disabled{opacity:.75;cursor:default}
.wh-side{display:flex;flex-direction:column;gap:.6rem;min-width:0}
.wh-res{min-height:3.2rem;display:flex;align-items:center;justify-content:center;text-align:center;padding:.6rem;border-radius:14px;background:rgba(255,255,255,.04);font-size:1.05rem;font-weight:700}
.wh-res b{color:#ffd166;font-size:1.35rem;margin-left:.3rem;word-break:break-word}
.wh-lbl{font-size:.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
#whOpts{width:100%;resize:vertical;min-height:170px;padding:.7rem .8rem;border-radius:12px;border:1.5px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);font:600 .95rem Montserrat,sans-serif;line-height:1.5}
#whOpts:focus{outline:none;border-color:var(--accent)}
.wh-chk{display:flex;gap:.5rem;align-items:center;font-size:.85rem;cursor:pointer}
.wh-chk input{width:18px;height:18px;accent-color:var(--accent)}
.wh-act{display:flex;gap:.5rem;flex-wrap:wrap}
.wh-hist{padding-left:1.3rem;font-size:.85rem;color:rgba(240,240,248,.75);display:flex;flex-direction:column;gap:.15rem}
.wh-hist:empty{display:none}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.wh-ideas{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.6rem}
.wh-ideas a{display:inline-flex;align-items:center;min-height:42px;padding:.45rem .9rem;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.04);text-decoration:none;font-weight:700;font-size:.85rem}
.wh-ideas a:hover{border-color:var(--accent)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:760px){.wh{grid-template-columns:1fr}.wh-wheel{max-width:360px}}
`;

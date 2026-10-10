// /tools/typing — «Тест скорости печати»: знаков в минуту, слов в минуту, точность; тексты — короткие и про игры.
// Зачем: «тест скорости печати», «клавиатурный тренажёр онлайн» ищут школьники, студенты и игроки — страница для всех.
// Всё в браузере: таймер с первой буквы, подсветка верных/ошибок, вставка из буфера запрещена. ?s=<зн/мин> — вызов (noindex).
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';

const TEXTS = [
  'Крипер тихо подошёл к дому и замер. Игрок обернулся, но было уже поздно: от стены осталась только яма, а в чате кто-то написал «ну классика».',
  'В пиццерии погас свет. Батарея садится, камеры показывают пустой коридор, а потом в дверях появляется знакомый силуэт. До шести утра ещё целый час.',
  'Команда решила пойти на точку все вместе. Смок, флешка, вход — и вдруг тишина. Последний живой игрок медленно перезаряжается и готовится к клатчу.',
  'Поезд мчится через пустыню, топливо почти закончилось. Кто-то бежит за углём, кто-то отстреливается от зомби, а кто-то опять ушёл грабить банк.',
  'Каждый день новое слово из пяти букв. Шесть попыток, жёлтые и зелёные клетки, и главное правило: не подглядывать в ответы у друга.',
  'Чтобы печатать быстро, не нужно смотреть на клавиатуру. Пальцы сами помнят, где какие буквы, а глаза следят только за текстом на экране.',
  'Морской бой придумали задолго до компьютеров. Раньше в него играли на листке в клетку, а теперь можно позвать друга по ссылке и сыграть онлайн.',
  'Стрим начался ровно в восемь. Чат здоровается, донаты летят один за другим, а стример в третий раз пытается пройти уровень, который никак не даётся.',
  'В хорроре главное — не бежать сломя голову. Сначала послушай звуки, найди записку, посмотри на карту. Монстр не любит, когда ты думаешь.',
  'Лучший ник для игры короткий и запоминающийся. Его легко написать в чате, его узнают друзья, и он хорошо смотрится в таблице рекордов.',
  'Ночь в лесу длится долго. Костёр почти погас, дров осталось на пару минут, а из темноты кто-то снова смотрит на лагерь большими глазами.',
  'Чтобы победить в игре на реакцию, нужно не угадывать, а ждать. Экран стал зелёным — нажимай. Нажал раньше — начинай сначала.',
  'Кубик упал на шестёрку, и все за столом закричали. Иногда случай решает больше, чем любая стратегия, и поэтому настольные игры никогда не надоедают.',
  'Самые смешные моменты случаются, когда что-то идёт не по плану. Упал с крыши, перепутал кнопку, сказал не то в микрофон — и вот уже готов шортс.',
  'Строить в песочнице можно бесконечно. Сначала маленький домик, потом ферма, потом замок с мостом, а потом ты понимаешь, что уже четыре часа ночи.',
  'Хороший тиммейт не тот, кто лучше всех стреляет, а тот, кто вовремя скажет, где враг, поделится патронами и не будет ругаться после проигрыша.',
];
// Без «ё», длинных тире и «ёлочек» — их нет на обычной клавиатуре, иначе текст не набрать
const plain = t => t.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[—–]/g, '-').replace(/[«»]/g, '"').replace(/ /g, ' ');
const RANKS = [[0, '🐢 Начинающий'], [120, '🙂 Уверенный новичок'], [200, '⚡ Хороший темп'], [280, '🔥 Быстрые пальцы'], [360, '🚀 Профи'], [450, '👑 Машина печати']];

export default function handler(req, res) {
  const url = `${SITE}/tools/typing`;
  const s = Math.min(1500, Math.max(0, parseInt(req.query.s, 10) || 0));
  const challenge = s > 0 ? `Друг печатает ${s} знаков в минуту — а ты быстрее?` : '';
  const faq = [
    ['Сколько знаков в минуту — это хорошо?', 'В среднем люди печатают 120–200 знаков в минуту. 250–300 — быстро, больше 350 — уровень тех, кто печатает вслепую всеми десятью пальцами.'],
    ['Как считается скорость?', 'Берутся правильно набранные знаки (с пробелами) и делятся на время с первой нажатой клавиши до последней. Точность — доля нажатий без ошибок.'],
    ['Как научиться печатать быстрее?', 'Печатай вслепую: держи пальцы на основном ряду (ФЫВА — ОЛДЖ), не смотри на клавиатуру и сначала добивайся точности, а скорость придёт сама.'],
    ['Работает ли тест на телефоне?', 'Да, печатай на экранной клавиатуре — счёт тот же. Но на телефоне скорость обычно ниже, чем на компьютере.'],
  ];
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebApplication', name: 'Тест скорости печати', url, applicationCategory: 'EducationalApplication', operatingSystem: 'Any', inLanguage: 'ru', offers: { '@type': 'Offer', price: '0', priceCurrency: 'RUB' } },
    { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/games">Игры</a> › <span>Тест скорости печати</span></nav>
  <h1>Тест скорости печати</h1>
  ${challenge ? `<p class="tp-chal">📣 ${esc(challenge)}</p>` : ''}
  <p class="lead">Сколько знаков в минуту ты печатаешь? Набери текст ниже как можно быстрее и без ошибок — тест посчитает скорость и точность. Тексты короткие и про игры.</p>
  <section class="ty">
    <div class="ty-stats"><div><b id="tyCpm">0</b><small>знаков/мин</small></div><div><b id="tyWpm">0</b><small>слов/мин</small></div><div><b id="tyAcc">100%</b><small>точность</small></div><div><b id="tyBest">—</b><small>рекорд</small></div></div>
    <div class="ty-text" id="tyText" aria-label="Текст для набора"></div>
    <textarea id="tyIn" class="ty-in" rows="3" placeholder="Начни печатать здесь — таймер запустится с первой буквы" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Поле для набора"></textarea>
    <div class="ty-res" id="tyRes" hidden></div>
    <div class="ty-act"><button type="button" class="btn btn-ghost" id="tyNew">↻ Другой текст</button></div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Уровни скорости</h2><ul class="ty-ranks">${RANKS.map((r, i) => `<li><b>${esc(r[1])}</b><span>${i < RANKS.length - 1 ? `${r[0]}–${RANKS[i + 1][0]}` : `${r[0]}+`} зн/мин</span></li>`).join('')}</ul></section>
  <section class="box faq"><h2>Частые вопросы</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
  <aside class="join"><div><b>А кликаешь быстро?</b><span>Проверь скорость кликов в CPS тесте или сыграй со словами в «5 букв».</span></div><a class="btn btn-acc" href="/tools/cps">🖱 CPS тест</a></aside>
</main>`;
  const script = `
(function(){
  var TEXTS=${JSON.stringify(TEXTS.map(plain))}, RANKS=${JSON.stringify(RANKS)};
  var box=document.getElementById('tyText'), inp=document.getElementById('tyIn'), res=document.getElementById('tyRes'), el=function(id){return document.getElementById(id)};
  var text='', t0=0, keys=0, errs=0, done=false, last=-1, timer=0;
  function best(){ try{ return +localStorage.getItem('d37_typing_best')||0 }catch(e){ return 0 } }
  function pick(){ var k; do{ k=Math.floor(Math.random()*TEXTS.length); }while(k===last&&TEXTS.length>1); last=k; return TEXTS[k]; }
  function esc(c){ return c==='<'?'&lt;':c==='>'?'&gt;':c==='&'?'&amp;':c; }
  function reset(){ text=pick(); t0=0; keys=0; errs=0; done=false; clearInterval(timer); inp.value=''; inp.disabled=false; res.hidden=true;
    box.innerHTML=Array.from(text).map(function(c,i){return '<span'+(i===0?' class="cur"':'')+'>'+esc(c)+'</span>'}).join('');
    el('tyCpm').textContent='0'; el('tyWpm').textContent='0'; el('tyAcc').textContent='100%'; var b=best(); el('tyBest').textContent=b?b:'—'; }
  function stats(){ var v=inp.value, ok=0; for(var i=0;i<v.length&&i<text.length;i++) if(v[i]===text[i]) ok++;
    var min=Math.max(1/60,(performance.now()-t0)/60000), cpm=t0?Math.round(ok/min):0, wpm=t0?Math.round(ok/5/min):0, acc=keys?Math.max(0,Math.round(100*(keys-errs)/keys)):100;
    el('tyCpm').textContent=cpm; el('tyWpm').textContent=wpm; el('tyAcc').textContent=acc+'%'; return {cpm:cpm,wpm:wpm,acc:acc}; }
  function paint(){ var v=inp.value, spans=box.children;
    for(var i=0;i<spans.length;i++){ var c=''; if(i<v.length) c=v[i]===text[i]?'ok':'bad'; else if(i===v.length) c='cur'; spans[i].className=c; } }
  inp.addEventListener('paste',function(e){ e.preventDefault(); });
  inp.addEventListener('input',function(e){ if(done) return; if(!t0){ t0=performance.now(); timer=setInterval(stats,500); }
    var v=inp.value.replace(/ё/g,'е').replace(/Ё/g,'Е'); if(v!==inp.value) inp.value=v; if(v.length>text.length){ inp.value=v=v.slice(0,text.length); }
    if(e.inputType&&e.inputType.indexOf('delete')!==0){ keys++; var i=v.length-1; if(i>=0&&v[i]!==text[i]) errs++; }
    paint(); stats(); if(v===text) finish(); });
  function finish(){ done=true; clearInterval(timer); inp.disabled=true; var s=stats(), r=RANKS[0]; RANKS.forEach(function(x){ if(s.cpm>=x[0]) r=x; });
    var old=best(), rec=s.cpm>old; if(rec){ try{ localStorage.setItem('d37_typing_best',String(s.cpm)) }catch(e){} el('tyBest').textContent=s.cpm; }
    res.hidden=false; res.innerHTML='<b>'+r[1]+'</b><span>'+s.cpm+' знаков в минуту · '+s.wpm+' слов в минуту · точность '+s.acc+'%'+(rec&&old?' — новый рекорд! 🎉':'')+'</span>'+
      '<div class="ty-act"><button type="button" class="btn btn-acc" id="tyAgain">↻ Ещё раз</button><button type="button" class="btn btn-ghost" id="tyShare">📣 Вызвать друга</button></div>';
    el('tyAgain').onclick=function(){ reset(); inp.focus(); };
    el('tyShare').onclick=function(){ var u=location.origin+'/tools/typing?s='+s.cpm, t='Я печатаю '+s.cpm+' знаков в минуту ('+r[1]+'). А ты?';
      if(navigator.share) navigator.share({title:'Тест скорости печати',text:t,url:u}).catch(function(){}); else (navigator.clipboard?navigator.clipboard.writeText(t+' '+u):Promise.reject()).then(function(){ el('tyShare').textContent='✓ Ссылка скопирована'; },function(){ prompt('Скопируй ссылку:',u); }); };
    if(window.va) window.va('event',{name:'typing_done',data:{cpm:Math.round(s.cpm/10)*10}}); }
  el('tyNew').onclick=function(){ reset(); inp.focus(); };
  box.onclick=function(){ inp.focus(); };
  reset();
})();`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(page({
    title: challenge ? `${challenge} | Тест скорости печати` : 'Тест скорости печати онлайн — сколько знаков в минуту | dan4ik37',
    description: 'Бесплатный тест скорости печати: набери короткий текст и узнай, сколько знаков и слов в минуту ты печатаешь и с какой точностью. Рекорд и вызов другу.',
    url, image: SITE + '/img/share/typing.png', ld, body, script, css: CSS, noindex: !!challenge
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.tp-chal{margin-top:.8rem;padding:.7rem 1rem;border-radius:12px;background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.35);color:#ffd166;font-weight:800}
.ty{margin-top:1.4rem;padding:1.2rem;border-radius:20px;background:var(--card);border:1px solid var(--line)}
.ty-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;text-align:center;margin-bottom:1rem}
.ty-stats div{padding:.6rem .3rem;border-radius:12px;background:rgba(255,255,255,.04)}
.ty-stats b{display:block;font:800 1.4rem Montserrat,sans-serif}
.ty-stats small{font-size:.64rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.ty-text{padding:1rem 1.1rem;border-radius:14px;background:rgba(0,0,0,.25);border:1px solid var(--line);font-size:1.15rem;line-height:1.75;letter-spacing:.01em;cursor:text;user-select:none}
.ty-text span.ok{color:#4ade80}
.ty-text span.bad{color:#fff;background:rgba(255,45,85,.55);border-radius:3px}
.ty-text span.cur{border-bottom:2px solid #ffd166}
.ty-in{width:100%;margin-top:.8rem;padding:.8rem 1rem;border-radius:12px;border:1.5px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);font:600 1rem Montserrat,sans-serif;resize:none}
.ty-in:focus{outline:none;border-color:var(--accent)}
.ty-res{margin-top:1rem;text-align:center;display:flex;flex-direction:column;gap:.35rem;align-items:center}
.ty-res[hidden]{display:none}
.ty-res b{font-size:1.5rem}
.ty-act{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;margin-top:.7rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.ty-ranks{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:.5rem}
.ty-ranks li{display:flex;justify-content:space-between;gap:.5rem;padding:.6rem .8rem;border-radius:10px;background:rgba(255,255,255,.04);font-size:.88rem}
.ty-ranks span{color:var(--muted)}
.faq details{border-top:1px solid var(--line);padding:.75rem 0}
.faq details:first-of-type{border-top:0;padding-top:0}
.faq summary{cursor:pointer;font-weight:700;font-size:.92rem}
.faq p{margin-top:.5rem;font-size:.9rem;color:rgba(240,240,248,.8)}
@media(max-width:600px){.ty-stats b{font-size:1.1rem}.ty-text{font-size:1rem}}
`;

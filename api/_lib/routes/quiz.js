// /quiz — «Тесты»: список; /quiz/<slug> — тест «Кто ты из…» (данные — api/_lib/quizzes.js).
// Зачем: такие тесты ищут и пересылают друзьям — результат уходит ссылкой /quiz/<slug>?r=<id>, друг видит
// «Твой друг получил: … — а кто ты?» и проходит сам. Под тестом — ролики канала по этой игре и игры сайта.
// Ссылки с ?r= — noindex (canonical — чистый адрес теста), в заголовке и превью — результат друга.
import { SITE, esc } from '../yt.js';
import { page } from '../page.js';
import { QUIZZES, quizOf } from '../quizzes.js';
import { topicOf } from '../topics.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const slug = String(req.query.slug || '');
  if (!slug) return hub(res);
  const Q = quizOf(slug);
  if (!Q) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600');
    return res.status(404).send(page({ title: 'Тест не найден — dan4ik37', noindex: true,
      body: `<main class="wrap narrow"><h1>Такого теста нет</h1><p><a class="btn btn-acc" href="/quiz">Все тесты →</a></p></main>` }));
  }
  const url = `${SITE}/quiz/${Q.slug}`;
  const friend = Q.results.find(r => r.id === String(req.query.r || ''));
  const topic = Q.topic ? topicOf(Q.topic) : null;
  const others = QUIZZES.filter(x => x.slug !== Q.slug);
  const ld = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', name: Q.title + ' — тест', url, inLanguage: 'ru', description: Q.lead },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Тесты', item: SITE + '/quiz' },
      { '@type': 'ListItem', position: 3, name: Q.title, item: url },
    ] },
  ] };
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <a href="/quiz">Тесты</a> › <span>${esc(Q.title)}</span></nav>
  ${friend ? `<p class="qz-friend">📣 Твой друг получил: <b>${friend.emoji} ${esc(friend.name)}</b> — а кто ты?</p>` : ''}
  <h1>${esc(Q.icon)} ${esc(Q.title)}</h1>
  <p class="lead">${esc(Q.lead)}</p>
  <section class="qz" id="qzBox">
    <div class="qz-start"><p>${Q.questions.length} вопросов · около минуты · без регистрации</p>
      <button type="button" class="btn btn-acc qz-go" id="qzGo">▶ Начать тест</button></div>
  </section>
  <div data-ad="seo_game" hidden></div>
  <section class="box"><h2>Кто бывает в этом тесте</h2><div class="qz-all">${Q.results.map(r => `<div><b>${r.emoji} ${esc(r.name)}</b><p>${esc(r.text)}</p></div>`).join('')}</div></section>
  ${topic ? `<aside class="join"><div><b>Ролики по ${esc(topic.name)} на канале</b><span>${esc(topic.about)}</span></div><a class="btn btn-acc" href="/topic/${topic.slug}">▶ Смотреть</a></aside>` : `<aside class="join"><div><b>Канал dan4ik37</b><span>Тысячи игровых роликов, стримы и живой чат.</span></div><a class="btn btn-acc" href="/about">Кто такой dan4ik37</a></aside>`}
  <section class="box"><h2>Другие тесты</h2><div class="qz-cards">${others.map(card).join('')}</div>
    <p class="muted" style="margin-top:.8rem">А ещё — <a href="/games">игры с друзьями онлайн</a>: «5 букв», морской бой, города.</p></section>
</main>`;
  const data = { slug: Q.slug, title: Q.title, results: Q.results, questions: Q.questions };
  const script = `
(function(){
  var Q=${JSON.stringify(data).replace(/</g, '\\u003c')}, N=Q.questions.length, box=document.getElementById('qzBox'), i=0, score={}, order=[];
  function e(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  function shuffle(a){ a=a.slice(); for(var k=a.length-1;k>0;k--){ var j=Math.floor(Math.random()*(k+1)), t=a[k]; a[k]=a[j]; a[j]=t; } return a; }
  function start(){ i=0; score={}; Q.results.forEach(function(r){score[r.id]=0}); show(); if(window.va) window.va('event',{name:'quiz_start',data:{quiz:Q.slug}}); }
  function show(){ var q=Q.questions[i]; order=shuffle(q.a.map(function(_,k){return k}));
    box.innerHTML='<div class="qz-prog"><i style="width:'+Math.round(100*i/N)+'%"></i></div><div class="qz-n">Вопрос '+(i+1)+' из '+N+'</div>'+
      '<h2 class="qz-q">'+e(q.q)+'</h2><div class="qz-a">'+order.map(function(k){return '<button type="button" data-k="'+k+'">'+e(q.a[k].t)+'</button>'}).join('')+'</div>';
    box.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  function finish(){ var best=Q.results[0]; Q.results.forEach(function(r){ if(score[r.id]>score[best.id]) best=r; });
    var link=location.origin+'/quiz/'+Q.slug+'?r='+best.id;
    box.innerHTML='<div class="qz-res"><div class="qz-emoji">'+best.emoji+'</div><small>Ты —</small><h2>'+e(best.name)+'</h2><p>'+e(best.text)+'</p>'+
      '<div class="qz-act"><button type="button" class="btn btn-acc" id="qzShare">📤 Поделиться результатом</button><button type="button" class="btn btn-ghost" id="qzAgain">↻ Пройти ещё раз</button></div><div class="qz-copied" id="qzCopied"></div></div>';
    document.getElementById('qzAgain').onclick=start;
    document.getElementById('qzShare').onclick=function(){ var t='Я — '+best.emoji+' '+best.name+'! «'+Q.title+'» — а кто ты?';
      if(navigator.share) navigator.share({title:Q.title,text:t,url:link}).catch(function(){});
      else (navigator.clipboard?navigator.clipboard.writeText(t+' '+link):Promise.reject()).then(function(){ document.getElementById('qzCopied').textContent='✓ Ссылка скопирована — отправь друзьям'; },function(){ prompt('Скопируй ссылку:',link); });
      if(window.va) window.va('event',{name:'quiz_share',data:{quiz:Q.slug}}); };
    if(window.va) window.va('event',{name:'quiz_done',data:{quiz:Q.slug,result:best.id}});
    box.scrollIntoView({block:'nearest',behavior:'smooth'}); }
  box.addEventListener('click',function(ev){ if(ev.target.closest('#qzGo')){ start(); return; } var b=ev.target.closest('[data-k]'); if(!b) return;
    var a=Q.questions[i].a[+b.dataset.k]; for(var id in a.r) score[id]+=a.r[id]; i++; if(i<N) show(); else finish(); });
})();`;
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: friend ? `Я — ${friend.name}! ${Q.title} Пройди тест` : `${Q.title} Тест — пройди и узнай | dan4ik37`,
    description: friend ? friend.text : `${Q.lead} Бесплатно, без регистрации — поделись результатом с друзьями.`,
    url, image: `${SITE}/img/share/quiz-${Q.slug}.png`, ld, body, script, css: CSS, noindex: !!friend
  }));
}

const card = x => `<a class="qz-card" href="/quiz/${x.slug}"><span>${esc(x.icon)}</span><b>${esc(x.title)}</b><small>${esc(x.lead)}</small></a>`;

function hub(res) {
  const url = `${SITE}/quiz`;
  const body = `
<main class="wrap">
  <nav class="crumbs"><a href="/#/home">Главная</a> › <span>Тесты</span></nav>
  <h1>Тесты: кто ты из игр?</h1>
  <p class="lead">Короткие тесты по играм с канала dan4ik37 — Майнкрафт, FNAF, Роблокс, CS2, Poppy Playtime и хорроры, «Какая ты игра?» для всех и тест для зрителей. 8 вопросов, минута времени, результатом можно поделиться с друзьями.</p>
  <div class="qz-cards">${QUIZZES.map(card).join('')}</div>
  <div data-ad="seo_game" hidden></div>
  <aside class="join"><div><b>Хочешь поиграть с друзьями?</b><span>«5 букв» со словом дня, морской бой, города, шашки — бесплатно, по ссылке.</span></div><a class="btn btn-acc" href="/games">🎮 Игры</a></aside>
</main>`;
  const ld = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Тесты dan4ik37', url,
    itemListElement: QUIZZES.map((q, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/quiz/${q.slug}`, name: q.title })) };
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
  return res.status(200).send(page({
    title: 'Тесты: какой ты моб из Майнкрафта, кто ты из FNAF, Роблокса и Poppy Playtime | dan4ik37',
    description: 'Бесплатные тесты по играм: какой ты моб из Майнкрафта, кто ты из FNAF и Poppy Playtime, кто ты в Роблоксе, какая ты игра. 8 вопросов — и результат, которым можно поделиться.',
    url, image: SITE + '/img/share/quiz.png', ld, body, css: CSS
  }));
}

const CSS = `
.crumbs{font-size:.78rem;color:var(--muted);margin-bottom:1rem}
.crumbs a{text-decoration:none}
.lead{margin-top:.8rem;color:rgba(240,240,248,.85);max-width:780px}
.qz-friend{margin-bottom:.4rem;padding:.7rem 1rem;border-radius:12px;background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.35);color:#ffd166;font-weight:700}
.qz{margin-top:1.4rem;padding:1.4rem;border-radius:20px;background:var(--card);border:1px solid var(--line);min-height:260px;scroll-margin-top:80px}
.qz-start{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;min-height:220px;text-align:center;color:var(--muted)}
.qz-go{font-size:1rem;padding:.9rem 1.8rem}
.qz-prog{height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.qz-prog i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .3s}
.qz-n{margin-top:.8rem;font-size:.75rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.qz-q{margin:.4rem 0 1rem;text-transform:none;letter-spacing:0;font-size:1.35rem}
.qz-a{display:grid;gap:.55rem}
.qz-a button{min-height:52px;padding:.75rem 1rem;border-radius:14px;border:1.5px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);
  font:700 .95rem Montserrat,sans-serif;text-align:left;cursor:pointer;transition:border-color .15s,background .15s}
.qz-a button:hover{border-color:var(--accent);background:rgba(255,45,85,.08)}
.qz-res{text-align:center;display:flex;flex-direction:column;align-items:center;gap:.3rem;padding:.6rem 0}
.qz-emoji{font-size:4rem;line-height:1.1}
.qz-res small{color:var(--muted);font-weight:700}
.qz-res h2{font-size:2rem;text-transform:none;letter-spacing:0;margin:0}
.qz-res p{max-width:560px;color:rgba(240,240,248,.88)}
.qz-act{display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center;margin-top:.8rem}
.qz-copied{color:#4ade80;font-size:.85rem;min-height:1.2rem}
.box{margin-top:1.4rem;padding:1.2rem 1.4rem;border-radius:16px;background:var(--card);border:1px solid var(--line)}
.box a{color:#7cc4ff}
.qz-all{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.7rem;margin-top:.5rem}
.qz-all div{padding:.8rem 1rem;border-radius:12px;background:rgba(255,255,255,.04)}
.qz-all p{font-size:.86rem;color:rgba(240,240,248,.8);margin-top:.3rem}
.qz-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:.8rem;margin-top:1.2rem}
.qz-card{display:flex;flex-direction:column;gap:.35rem;padding:1.1rem 1.2rem;border-radius:16px;background:var(--card);border:1px solid var(--line);text-decoration:none;color:var(--text)!important;transition:border-color .2s,transform .2s}
.qz-card:hover{border-color:var(--accent);transform:translateY(-2px)}
.qz-card span{font-size:2rem}
.qz-card small{color:var(--muted);font-size:.8rem;line-height:1.45}
`;

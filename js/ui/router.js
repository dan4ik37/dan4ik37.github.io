// ═══════════════════════════════════════
//  РОУТЕР — переключение "страниц" БЕЗ перезагрузки
// ═══════════════════════════════════════
// Вся страница как была одним HTML-документом, так и остаётся — просто
// показываем один блок секций и прячем остальные через display:none.
// Ничего не перезагружается => чат на Supabase, вход, perf-режим и все
// JS-переменные не сбрасываются при переходах, а в адресной строке при
// этом появляется свой #/route на каждый раздел (можно скинуть ссылкой).
const PAGES = {
  home:       ['hero','ad-top','stats','ad-mid','content'],
  about:      ['about','schedule','socials'],
  donate:     ['donate','goalbar','leaderboard'],
  poll:       ['poll'],
  soundboard: ['soundboard'],
  clicker:    ['clicker'],
  chat:       ['chat'],
  profile:    ['profile-page'],
  forum:      ['forum-page'],
  lfg:        ['lfg-page'],
  ads:        ['ad-bottom','ads']
};
const ALL_PAGE_IDS = Object.values(PAGES).flat();

function showPage(route){
  if(!PAGES[route]) route='home';
  const activeIds = PAGES[route];
  const isLowPerf = document.body.classList.contains('low');
  const currentlyVisible = ALL_PAGE_IDS.filter(id=>{
    const el=document.getElementById(id);
    return el && el.style.display !== 'none';
  });
  const doSwap = () => {
    ALL_PAGE_IDS.forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.style.display = activeIds.includes(id) ? '' : 'none';
    });
    activeIds.forEach(id=>document.getElementById(id)?.classList.remove('route-fading'));
    finishShowPage(route, activeIds);
  };
  if (isLowPerf || currentlyVisible.length === 0) {
    // Первая загрузка или слабый режим — без анимации, сразу
    doSwap();
  } else {
    currentlyVisible.forEach(id=>document.getElementById(id)?.classList.add('route-fading'));
    setTimeout(doSwap, 150);
  }
}

function finishShowPage(route, activeIds){
  // Твич-плеер и loadYT() — только когда реально открыта #/home (см. initHomeMedia)
  if (route==='home') initHomeMedia();
  if (route==='profile' && typeof renderProfilePage==='function') renderProfilePage(currentRouteParam());
  if (route==='forum' && typeof renderForumPage==='function') renderForumPage(currentRouteParam());
  if (route==='lfg' && typeof renderLfgPage==='function') renderLfgPage();
  // Подстраховка: если IntersectionObserver ещё не успел отреагировать
  // на то, что блок только что стал видимым — не оставляем его прозрачным
  activeIds.forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    if(el.classList.contains('reveal')) el.classList.add('visible');
    el.querySelectorAll('.reveal').forEach(r=>r.classList.add('visible'));
  });
  document.querySelectorAll('.nav-links a[data-route]').forEach(a=>{
    a.classList.toggle('active-route', a.dataset.route===route);
  });
  // Нижний таб-бар (мобиле): подсвечиваем Видео/Чат/Донат, либо "Ещё" для остальных страниц
  const tabRoutes = ['home','chat','donate'];
  document.querySelectorAll('.bt-item[data-route]').forEach(a=>{
    a.classList.toggle('active-route', a.dataset.route===route);
  });
  document.getElementById('btMore')?.classList.toggle('active-route', !tabRoutes.includes(route));
  document.getElementById('navLinks')?.classList.remove('open');
  document.getElementById('burger')?.classList.remove('open');
  // Если перешли в чат — прячем тост о новом сообщении, он тут больше не нужен
  if(route==='chat'){ document.getElementById('chatToast')?.classList.remove('show'); hideChatBadge(); }
  window.scrollTo(0,0);
}

function currentRoute(){
  return ((location.hash||'').replace(/^#\/?/,'').split('/')[0]) || 'home';
}
// Всё, что после первого "/" в хэше — например для "#/forum/42" это "42".
// Понадобится форуму (тема по id) и, возможно, боту (deep-link на сообщение).
// Сам роутер эти данные никак не использует — просто отдаёт их странице,
// которая знает, что с ними делать (см. ИНСТРУКЦИЯ, раздел "Заготовка: форум").
function currentRouteParam(){
  const raw = (location.hash||'').replace(/^#\/?/,'');
  const slash = raw.indexOf('/');
  return slash === -1 ? null : raw.slice(slash + 1) || null;
}
window.addEventListener('hashchange', ()=>showPage(currentRoute()));
showPage(currentRoute());


// ═══════════════════════════════════════
//  РОУТЕР — переключение "страниц" БЕЗ перезагрузки
// ═══════════════════════════════════════
// Вся страница как была одним HTML-документом, так и остаётся — просто
// показываем один блок секций и прячем остальные через display:none.
// Ничего не перезагружается => чат на Supabase, вход, perf-режим и все
// JS-переменные не сбрасываются при переходах, а в адресной строке при
// этом появляется свой #/route на каждый раздел (можно скинуть ссылкой).
const PAGES = {
  home:       ['hero','today','content','ad-mid','community','ad-top'],
  about:      ['about','schedule','socials'],
  donate:     ['donate','goalbar','leaderboard'],
  poll:       ['poll'],
  soundboard: ['soundboard'],
  clicker:    ['clicker'],
  chat:       ['chat'],
  profile:    ['profile-page'],
  shorts:     ['shorts-page'],
  ideas:      ['ideas-page'],
  forum:      ['forum-page'],
  lfg:        ['lfg-page'],
  games:      ['games-page'],
  shop:       ['shop-page'],
  invite:     ['invite-page'],   // 👥 пригласи друзей (js/features/invite.js; #/invite/admin — проверка)
  ads:        ['ad-bottom','ads'],
  adv:        ['adv-page'],      // 📣 кабинет рекламодателя (js/features/adcab.js грузится при входе)
  phone:      ['phone-page']     // телефон 📱 на странице (js/features/phone.js)
};
const ALL_PAGE_IDS = Object.values(PAGES).flat();

function showPage(route){
  // Приглашение в сообщество /c/<код> → экран вступления в чате «как Дискорд» (community.js)
  if(route==='c'){ location.replace('#/chat/join/' + String(currentRouteParam()||'').replace(/[^a-z0-9]/gi,'').toLowerCase()); return; }
  if(!PAGES[route]) route='home';
  const activeIds = PAGES[route];
  const isLowPerf = document.body.classList.contains('low');
  // Тот же раздел (другой канал чата, другая игра) — без затухания: иначе каждый переход мигал
  const sameRoute = document.body.dataset.route === route;
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
  if (isLowPerf || currentlyVisible.length === 0 || sameRoute) {
    // Первая загрузка или слабый режим — без анимации, сразу
    doSwap();
  } else {
    currentlyVisible.forEach(id=>document.getElementById(id)?.classList.add('route-fading'));
    setTimeout(doSwap, 150);
  }
}

function finishShowPage(route, activeIds){
  // Твич-плеер и loadYT() — только когда реально открыта #/home (см. initHomeMedia)
  document.body.dataset.route = route;
  // Возраст (js/core/age.js): раздел не по возрасту (чат и сообщества, форум, тиммейты — 12+) — «обложка» вместо него, сам
  // раздел не рисуем; зовём на каждом переходе — уходя, обложка убирается
  const gated = !!window.D37Age?.gateRoute?.(route, activeIds);
  if (route==='home') { initHomeMedia(); if (typeof renderToday==='function') renderToday(); }
  if (typeof onShortsRoute==='function') onShortsRoute(route==='shorts');
  if (typeof fillVisibleAds==='function') fillVisibleAds();
  if (route==='profile' && typeof renderProfilePage==='function') renderProfilePage(currentRouteParam());
  if (route==='forum' && !gated && typeof renderForumPage==='function') renderForumPage(currentRouteParam());
  if (route==='lfg' && !gated && typeof renderLfgPage==='function') renderLfgPage();
  if (route==='games' && typeof renderGamesPage==='function') renderGamesPage(currentRouteParam());
  if (route==='ideas' && typeof renderIdeasPage==='function') renderIdeasPage();
  if (route==='poll' && typeof openPollPage==='function') openPollPage();
  if (route==='donate' && typeof renderDonateVipHint==='function') renderDonateVipHint();
  if (route==='shop' && typeof renderShopPage==='function') renderShopPage(currentRouteParam());
  if (route==='invite' && typeof renderInvitePage==='function') renderInvitePage(currentRouteParam());   // 👥 приглашения
  if (route==='adv') window.D37AdDirect?.cabinet?.(currentRouteParam());                            // 📣 реклама за 💎
  if (route==='chat' && !gated && typeof renderChatPage==='function') renderChatPage(currentRouteParam());     // чат «как Дискорд»
  if (route==='phone' && typeof phoneRoute==='function') phoneRoute(route, currentRouteParam());      // телефон 📱 на странице
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
  const tabRoutes = ['home','chat','shorts','games'];
  document.querySelectorAll('.bt-item[data-route]').forEach(a=>{
    a.classList.toggle('active-route', a.dataset.route===route);
  });
  document.getElementById('btMore')?.classList.toggle('active-route', !tabRoutes.includes(route));
  document.getElementById('navLinks')?.classList.remove('open');
  document.getElementById('burger')?.classList.remove('open');
  // Если перешли в чат — прячем тост о новом сообщении, он тут больше не нужен
  if(route==='chat'){ document.getElementById('chatToast')?.classList.remove('show'); hideChatBadge(); }
  window.scrollTo(0,0);
  trackRouteView(route);
}

// Vercel Web Analytics сама видит только первую загрузку и pushState, а разделы
// переключаются через #/хэш — без этого все просмотры записались бы как «/».
// Первую загрузку скрипт аналитики считает сам, поэтому её пропускаем.
let analyticsFirstView = true;
function trackRouteView(route){
  if (analyticsFirstView) { analyticsFirstView = false; return; }
  const param = currentRouteParam();
  try { window.va && window.va('pageview', { route: '/' + route, path: '/' + route + (param ? '/' + param : '') }); } catch(e) {}
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
// «Игра поверх мира»: пока партия из «Мира Денчика» открыта окном поверх мира, её переходы (онлайн, «выйти») ведёт
// js/games/mir-play.js — мир не выгружаем и страницу не меняем
window.addEventListener('hashchange', e=>{ if (window.MirPlay?.onHash?.(e)) return; showPage(currentRoute()); });
showPage(currentRoute());


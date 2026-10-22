// ═══════════════════════════════════════
//  РОУТЕР — переключение "страниц" БЕЗ перезагрузки
// ═══════════════════════════════════════
// Вся страница как была одним HTML-документом, так и остаётся — просто показываем один блок секций и прячем остальные через
// display:none. Ничего не перезагружается => чат на Supabase, вход, звонок, мир и все JS-переменные не сбрасываются.
//
// АДРЕСА (фаза 1 мастер-инструкции, 22.10.2026; карта — docs/progress.md «Фаза 1 — адреса»): у каждого раздела НАСТОЯЩИЙ адрес —
// /chat, /forum/42, /profile/vip, /play/chess/abcd (игры — /play: /games и /games/<id> — серверные страницы для поиска).
// Режим — ROUTING в js/core/config.js: 'path' (настоящие адреса) или 'hash' (по-старому #/chat) — откат одной строкой.
//  • Старые ссылки #/… принимаются ВСЕГДА (код, сообщения, уведомления из базы, push, DonationAlerts, ярлыки приложения):
//    на загрузке и при location.hash = '#/…' роутер сам меняет адрес на настоящий (replaceState) — писать в коде
//    location.hash = '#/…' по-прежнему можно. Настоящие адреса работают и в режиме 'hash' (vercel.json → index.html).
//  • Узнать раздел — D37Route.hash() ('#/games/chess/abcd' в обоих режимах), currentRoute(), currentRouteParam();
//    НЕ location.hash (в режиме адресов он пустой). Переход раздела — событие 'd37:route' (не hashchange).
//  • Ссылки: <a href="/chat"> и <a href="#/chat"> — без перезагрузки (клик ловит роутер); серверные страницы (/videos,
//    /games/<id>) — обычным переходом; data-server — открыть перезагрузкой даже свой адрес.
//  • Адрес без перехода (как history.replaceState) — D37Route.setUrl('#/…'); ссылка «поделиться» — D37Route.abs('#/…').
//  • Заголовок, описание, canonical, Open Graph и noindex — на каждом переходе (ROUTE_META); уточнить — D37Route.meta({ … }).
// Скрипт грузится сразу после config.js (до остальных: они уже зовут D37Route); старт — routerStart() на прежнем месте в index.html.
// Тест: node scripts/routes-test.cjs; в браузере — node scripts/routes-e2e.cjs.
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
  invite:     ['invite-page'],   // 👥 пригласи друзей (js/features/invite.js; /invite/admin — проверка)
  ads:        ['ad-bottom','ads'],
  adv:        ['adv-page'],      // 📣 кабинет рекламодателя (js/features/adcab.js грузится при входе)
  phone:      ['phone-page'],    // телефон 📱 на странице (js/features/phone.js)
  photo:      ['photo-page']     // 🖼 фоторедактор (js/apps/apps.js грузит редактор при входе); страница для поиска — /tools/photo
};
const ALL_PAGE_IDS = Object.values(PAGES).flat();

// ═══ Карта адресов и переходы (D37Route) ═══
// Разделы, у которых адрес = имя раздела (/chat, /profile/…): все PAGES, кроме главной («/») и игр («/play»), + /app
// (инструкция «Установить приложение», js/features/app.js). Особые: #/home → /, #/games… → /play…, #/c/<код> → /chat/join/<код>.
// /about, /shop, /forum…, /ideas… — ОДИН адрес у серверной страницы (для поиска и превью ссылок) и раздела SPA: открыли адрес
// заново — серверная страница, перешли внутри сайта — раздел. Новый раздел PAGES → rewrite в vercel.json (тест проверит).
const D37Route = (() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const MODE = typeof ROUTING !== 'undefined' && ROUTING === 'hash' ? 'hash' : 'path';
  const SITE = 'https://dan4ik37.vercel.app';
  const YM_ID = 113596397;   // Яндекс Метрика (index.html, api/_lib/page.js)
  const ROOTS = new Set(Object.keys(PAGES).filter(k => k !== 'home' && k !== 'games').concat('app'));
  const segs = s => String(s || '').split(/[?#]/)[0].split('/').filter(Boolean);

  // '#/games/chess/abcd' → '/play/chess/abcd'; '', '#/home' → '/'; '#/c/<код>' → '/chat/join/<код>'; неизвестный раздел — '/'
  function toPath(h){
    const p = segs(String(h || '').replace(/^#\/?/, '')), r = p[0], rest = p.slice(1);
    if (!r || r === 'home') return '/';
    if (r === 'games' || r === 'play') return '/play' + (rest.length ? '/' + rest.join('/') : '');
    if (r === 'c') { const c = String(rest[0] || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); return c ? '/chat/join/' + c : '/chat'; }
    return ROOTS.has(r) ? '/' + p.join('/') : '/';
  }
  // '/play/chess/abcd' → '#/games/chess/abcd'; '/', '/index.html', '/home' → '#/home'; не раздел (серверная страница) — null
  function toHash(path){
    const p = segs(path), r = p[0];
    if (!r || (p.length === 1 && (r === 'index.html' || r === 'home'))) return '#/home';
    if (r === 'play') return '#/games' + (p.length > 1 ? '/' + p.slice(1).join('/') : '');
    return ROOTS.has(r) ? '#/' + p.join('/') : null;
  }
  const loc = () => root.location;
  const origin = () => { try { const o = loc().origin; if (/^https?:\/\//.test(o)) return o; } catch (e) {} return SITE; };
  // Раздел сейчас — всегда в старом виде ('#/chat/c/5'): так его разбирает весь код сайта
  function hash(){
    const L = loc(); if (!L) return '';
    const h = L.hash || '';
    if (MODE === 'hash' || h.startsWith('#/')) return h;
    return toHash(L.pathname) || '';
  }
  // Ссылка для <a href> и истории в текущем режиме: '#/chat' → '/chat' (или '#/chat' в режиме 'hash')
  function href(x){
    const s = String(x == null ? '' : x);
    if (MODE === 'hash') { if (s[0] === '#') return s === '#' ? '#/home' : s; return toHash(s) || s; }
    return s === '' || s === '#' || s.startsWith('#/') ? toPath(s) : s;
  }
  // Полная ссылка «поделиться»: '#/games/chess/abcd' → 'https://…/play/chess/abcd'; base — свой адрес сайта (иначе — текущий)
  const abs = (x, base) => { const h = href(x); return (base || origin()) + (h[0] === '#' ? '/' + h : h); };
  const key = () => { const L = loc(); return MODE === 'hash' ? (L.hash || '') : L.pathname + L.search; };
  let last = null, lastHash = '', pend = 0, prevHref = '';

  // Переход раздела → событие 'd37:route' (в обоих режимах). oldURL/newURL — как у hashchange (их читает mir-play.js)
  function emit(from, to, e){
    lastHash = to;
    let ev;
    try { ev = new root.CustomEvent('d37:route', { detail: { from, to } }); } catch (er) { return; }
    ev.oldURL = e?.oldURL || origin() + '/' + (from || '');
    ev.newURL = e?.newURL || origin() + '/' + (to || '');
    root.dispatchEvent(ev);
  }
  // Как hashchange в старом режиме: раздел меняется следующей задачей — после всех слушателей текущего события и popstate
  function later(){ if (!pend) pend = setTimeout(() => { pend = 0; check(); }, 0); }
  function check(){ const k = key(); if (k === last) return; last = k; emit(lastHash, hash()); }

  // Перейти: '#/chat', '/chat' или серверная страница ('/videos' — обычным переходом). o: { replace, state }
  function go(x, o = {}){
    const s = String(x == null ? '' : x);
    const h = s[0] === '#' ? (s.startsWith('#/') ? s : '#/home') : toHash(s);
    if (!h) { if (o.replace) loc().replace(s); else loc().assign(s); return false; }
    if (MODE === 'hash') {
      if (o.replace) { try { loc().replace(h); } catch (e) { loc().hash = h; } }
      else loc().hash = h;
      return true;
    }
    const q = s[0] === '#' ? '' : (s.split('#')[0].match(/\?.*$/) || [''])[0];
    const url = toPath(h) + q, L = loc();
    if (L.pathname + L.search === url && !(L.hash || '').startsWith('#/')) return false;   // уже здесь
    try { root.history[o.replace ? 'replaceState' : 'pushState'](o.state === undefined ? null : o.state, '', url); }
    catch (e) { loc().assign(url); return false; }
    later();
    return true;
  }
  // Поменять адрес без перехода (бывший history.replaceState(null, '', '#/…')): раздел не перерисовывается
  function setUrl(x, o = {}){
    const H = root.history; if (!H?.replaceState) return;
    try { H.replaceState('state' in o ? o.state : null, '', href(x)); } catch (e) { return; }
    last = key(); lastHash = hash();
  }

  // ── Слушатели (ставятся при загрузке: раньше всех) ──
  // location.hash = '#/…' (старый код, ссылки): в режиме адресов — сразу настоящий адрес, остальным — 'd37:route'
  function onHash(e){
    const h = loc().hash || '';
    if (h && h !== '#' && !h.startsWith('#/')) return;   // токены входа (#access_token…), якоря — не разделы, не наше
    if (MODE === 'hash') { last = key(); emit(lastHash, h, e); return; }
    e.stopImmediatePropagation();   // Метрика (trackHash) и прочие не увидят: просмотр засчитает trackView
    if (!h.startsWith('#/')) return;
    const was = last;
    try { root.history.replaceState(root.history.state, '', toPath(h)); } catch (er) { return; }
    clearTimeout(pend); pend = 0;
    last = key();
    if (last === was) return;   // тот же раздел (как location.hash = тот же хэш в старом режиме) — не перерисовываем
    emit(lastHash, hash());
  }
  // «Назад»/«Вперёд» в режиме адресов (решётки нет — hashchange не придёт); тот же адрес (свои записи полного экрана,
  // телефона, «игры поверх мира») — не переход
  function onPop(){ if (MODE === 'path') later(); }
  // Клик по ссылке на раздел — без перезагрузки. Слушаем окно (после всех обработчиков: их preventDefault — главнее)
  function onClick(e){
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target?.closest ? e.target.closest('a[href]') : null;
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-server')) return;
    const raw = a.getAttribute('href') || '';
    if (raw === '#') { e.preventDefault(); return; }   // ссылка-кнопка без своего preventDefault: с <base href="/"> ушла бы на главную
    if (raw[0] === '#' && raw[1] !== '/') {   // якорь на странице
      e.preventDefault();
      let t = null; try { t = root.document.getElementById(decodeURIComponent(raw.slice(1))); } catch (er) {}
      t?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (raw.startsWith('#/')) { if (MODE === 'path') { e.preventDefault(); go(raw); } return; }
    let u; try { u = new URL(a.href); } catch (er) { return; }
    if (u.origin !== loc().origin) return;
    if ((u.pathname === '/' || u.pathname === '/index.html') && (u.hash || '').startsWith('#/')) { e.preventDefault(); go(u.hash); return; }
    const h = toHash(u.pathname);
    if (!h) return;   // серверная страница — обычный переход
    e.preventDefault();
    go(h === '#/home' ? '/' + u.search : u.pathname + u.search);
  }
  if (root.addEventListener) {
    root.addEventListener('hashchange', onHash, true);
    root.addEventListener('popstate', onPop, true);
    root.addEventListener('click', onClick);
  }

  // ── Заголовок, описание, canonical, Open Graph, noindex ──
  // [заголовок, описание]. Разделы с noindex — личное и служебное (профиль, телефон, кабинет, приглашения, экраны игр)
  const ROUTE_META = {
    home: ['dan4ik37 — игровые видео, стримы и онлайн-игры с друзьями',
      'Сайт стримера dan4ik37: почти 6000 игровых видео (Roblox, CS2, Minecraft, Silksong), стримы, живой чат и бесплатные онлайн-игры — «5 букв», морской бой, города, шашки с другом по ссылке.'],
    about: ['Обо мне — dan4ik37 (Денчик37): стримы, расписание и соцсети',
      'dan4ik37 (Денчик37) — игровой ютубер и стример: когда стримы, где смотреть и все соцсети в одном месте.'],
    donate: ['Поддержать dan4ik37 — донат, цель стрима и топ донатеров',
      'Поддержи стримера dan4ik37 донатом: цель стрима, зал славы и топ донатеров сайта.'],
    poll: ['Опрос зрителей — голосуй, что будет дальше | dan4ik37',
      'Опросы на сайте dan4ik37: выбирай, во что играть на стриме и какие видео снимать дальше.'],
    soundboard: ['Саундборд dan4ik37 — звуки и мемы со стримов',
      'Звуки и мемы со стримов dan4ik37 — нажимай и слушай прямо на сайте, бесплатно.'],
    clicker: ['Кликер dan4ik37 — мини-игра на скорость',
      'Кликай на скорость и собирай комбо — простая мини-игра на сайте dan4ik37.'],
    chat: ['Чат dan4ik37 — общение, каналы и сообщества',
      'Живой чат сайта dan4ik37: каналы по интересам, свои сообщества, голосовые и чат эфира Twitch.'],
    profile: ['Профиль — dan4ik37', 'Профиль игрока на сайте dan4ik37: уровень, ачивки, друзья и персонаж.'],
    shorts: ['Shorts dan4ik37 — короткие видео подряд',
      'Все Shorts канала dan4ik37 подряд: листай короткие игровые видео прямо на сайте.'],
    ideas: ['Идеи для видео dan4ik37 — предложи и проголосуй',
      'Предложи идею для ролика или стрима dan4ik37 и голосуй за чужие — лучшие идеи становятся видео.'],
    forum: ['Форум dan4ik37 — обсуждения игр, стримов и сайта',
      'Форум сайта dan4ik37: темы про игры, стримы, видео и сам сайт. Читать могут все, писать — после входа.'],
    lfg: ['Тиммейты — найди, с кем поиграть | dan4ik37',
      'Поиск тиммейтов на сайте dan4ik37: создай заявку или откликнись на чужую — Roblox, CS2, Minecraft и другие игры.'],
    games: ['Игры онлайн с друзьями — dan4ik37', 'Бесплатные онлайн-игры на сайте dan4ik37 — с ботом или с другом по ссылке.'],
    shop: ['Магазин кристаллов 💎 — dan4ik37', 'Кристаллы — валюта сайта dan4ik37: VIP, подарки друзьям, монеты и вещи для персонажа.'],
    invite: ['Позвать друзей — dan4ik37', 'Твоя ссылка-приглашение на сайт dan4ik37 и награды за друзей.'],
    ads: ['Реклама на сайте и канале dan4ik37', 'Реклама у стримера dan4ik37: медиакит канала и своя реклама на сайте.'],
    adv: ['Кабинет рекламодателя — dan4ik37', 'Кабинет рекламодателя сайта dan4ik37: кампании, показы и статистика.'],
    phone: ['Телефон — dan4ik37', 'Телефон сайта dan4ik37: сообщения, звонки, друзья и приложения.'],
    photo: ['Фоторедактор онлайн — слои, обрезка, текст, фильтры | dan4ik37',
      'Бесплатный фоторедактор в браузере: слои, обрезка под шортс и превью, коррекция, фильтры, надписи, кисть и ластик. Работает на телефоне, без регистрации.'],
  };
  const NOINDEX = new Set(['profile', 'invite', 'adv', 'phone', 'games']);
  // Что разделу показать поисковику: { title, description, canonical, noindex }
  function routeMeta(route, param){
    const m = ROUTE_META[route] || ROUTE_META.home;
    let title = m[0], canon = route === 'home' ? '/' : toPath('#/' + route + (param ? '/' + param : '')), noindex = NOINDEX.has(route);
    if (param) {
      if (route === 'chat' || route === 'shop' || route === 'about' || route === 'donate' || route === 'lfg') noindex = true;   // каналы, ЛС, заказы
      if (route === 'games') {
        const id = String(param).split('/')[0], list = typeof GAMES !== 'undefined' && Array.isArray(GAMES) ? GAMES : [];
        const g = list.find(x => x.id === id);
        if (g) title = `${g.title} — играть онлайн | dan4ik37`;
      }
      if (route === 'shorts' && /^[A-Za-z0-9_-]{11}$/.test(param)) canon = '/v/' + param;   // тот же ролик — страница ролика
      if (route === 'forum') title = 'Тема форума — dan4ik37';
      if (route === 'ideas') title = 'Идея для видео — dan4ik37';
    }
    if (route === 'ads') canon = '/reklama';
    if (route === 'photo') { canon = '/tools/photo'; if (param) noindex = true; }   // для поиска — серверная страница /tools/photo
    return { title, description: m[1], canonical: SITE + canon, noindex };
  }
  let curMeta = {};
  function meta(o){
    const d = root.document, hd = d?.head; if (!hd || !o) return;
    curMeta = Object.assign({}, curMeta, o);
    const tag = (attr, k) => {
      let el = hd.querySelector(`meta[${attr}="${k}"]`);
      if (!el) { el = d.createElement('meta'); el.setAttribute(attr, k); hd.appendChild(el); }
      return el;
    };
    if (o.title) { d.title = o.title; tag('property', 'og:title').setAttribute('content', o.title); tag('name', 'twitter:title').setAttribute('content', o.title); }
    if (o.description) {
      const t = String(o.description).replace(/\s+/g, ' ').trim().slice(0, 300);
      tag('name', 'description').setAttribute('content', t); tag('property', 'og:description').setAttribute('content', t); tag('name', 'twitter:description').setAttribute('content', t);
    }
    if (o.canonical) {
      let c = hd.querySelector('link[rel="canonical"]');
      if (!c) { c = d.createElement('link'); c.setAttribute('rel', 'canonical'); hd.appendChild(c); }
      c.setAttribute('href', o.canonical);
      tag('property', 'og:url').setAttribute('content', o.canonical);
    }
    if ('noindex' in o) {
      const r = hd.querySelector('meta[name="robots"]');
      if (o.noindex) (r || tag('name', 'robots')).setAttribute('content', 'noindex');
      else r?.remove();
    }
  }
  // Просмотр раздела для статистики. Первый — сами счётчики при загрузке. Режим адресов: Vercel Analytics видит pushState сам,
  // Метрике — hit (trackHash ловит только решётку). Режим 'hash': Метрика — trackHash, Vercel — pageview с путём
  function trackView(route, param){
    const L = loc(), now = L ? L.href : '';
    if (!prevHref) { prevHref = now; return; }
    if (MODE === 'path') { try { root.ym && root.ym(YM_ID, 'hit', now, { title: root.document?.title, referer: prevHref }); } catch (e) {} }
    else { try { root.va && root.va('pageview', { route: '/' + route, path: '/' + route + (param ? '/' + param : '') }); } catch (e) {} }
    prevHref = now;
  }

  // ── Старт (index.html, на месте прежнего router.js): адрес загрузки → свой вид, первый раздел ──
  function start(){
    const L = loc(), H = root.history, h = L.hash || '';
    try {
      if (MODE === 'path') {
        if (h.startsWith('#/')) H.replaceState(H.state, '', toPath(h) + L.search);
        else if (/^\/(index\.html|home)\/?$/.test(L.pathname)) H.replaceState(H.state, '', '/' + L.search + h);
      } else if (!h.startsWith('#/') && L.pathname !== '/') {
        const t = toHash(L.pathname);
        if (t) H.replaceState(H.state, '', '/' + L.search + (t === '#/home' ? '' : t));
      }
    } catch (e) {}
    last = key(); lastHash = hash();
    // вкладка с сайтом-приложением: серверные страницы того же адреса (/forum/42) сразу открывают раздел (api/_lib/page.js)
    try { root.sessionStorage.setItem('d37_spa', '1'); } catch (e) {}
  }

  return { mode: MODE, SITE, ROOTS, toPath, toHash, hash, href, abs, go, setUrl, meta, routeMeta, trackView, start,
    get metaNow(){ return curMeta; } };
})();
if (typeof window !== 'undefined') window.D37Route = D37Route;

let routerStarted = false;   // роутер грузится раньше разделов: до routerStart() показывать нечего (age.js и др. зовут showPage сами)
function showPage(route){
  if (!routerStarted) return;
  // Приглашение в сообщество /c/<код> → экран вступления в чате «как Дискорд» (community.js); в режиме адресов сюда не доходит
  if(route==='c'){ D37Route.go('#/chat/join/' + String(currentRouteParam()||'').replace(/[^a-z0-9]/gi,'').toLowerCase(), { replace: true }); return; }
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
  // Твич-плеер и loadYT() — только когда реально открыта главная (см. initHomeMedia)
  document.body.dataset.route = route;
  // Заголовок, описание, canonical, noindex — до отрисовки раздела: раздел может уточнить (форум — название темы)
  const param = currentRouteParam();
  D37Route.meta(D37Route.routeMeta(route, param));
  // Возраст (js/core/age.js): раздел не по возрасту (чат и сообщества, форум, тиммейты — 12+) — «обложка» вместо него, сам
  // раздел не рисуем; зовём на каждом переходе — уходя, обложка убирается
  const gated = !!window.D37Age?.gateRoute?.(route, activeIds);
  if (route==='home') { initHomeMedia(); if (typeof renderToday==='function') renderToday(); }
  if (typeof onShortsRoute==='function') onShortsRoute(route==='shorts');
  if (typeof fillVisibleAds==='function') fillVisibleAds();
  if (route==='profile' && typeof renderProfilePage==='function') renderProfilePage(param);
  if (route==='forum' && !gated && typeof renderForumPage==='function') renderForumPage(param);
  if (route==='lfg' && !gated && typeof renderLfgPage==='function') renderLfgPage();
  if (route==='games' && typeof renderGamesPage==='function') renderGamesPage(param);
  if (route==='ideas' && typeof renderIdeasPage==='function') renderIdeasPage(param);
  if (route==='poll' && typeof openPollPage==='function') openPollPage();
  if (route==='donate' && typeof renderDonateVipHint==='function') renderDonateVipHint();
  if (route==='shop' && typeof renderShopPage==='function') renderShopPage(param);
  if (route==='invite' && typeof renderInvitePage==='function') renderInvitePage(param);   // 👥 приглашения
  if (route==='adv') window.D37AdDirect?.cabinet?.(param);                            // 📣 реклама за 💎
  if (route==='chat' && !gated && typeof renderChatPage==='function') renderChatPage(param);     // чат «как Дискорд»
  if (route==='phone' && typeof phoneRoute==='function') phoneRoute(route, param);      // телефон 📱 на странице
  if (route==='photo') window.D37Apps?.open('photo', param);                           // 🖼 фоторедактор (js/apps/apps.js)
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

// Статистика просмотров разделов (Vercel Web Analytics, Яндекс Метрика) — D37Route.trackView
function trackRouteView(route){ D37Route.trackView(route, currentRouteParam()); }

function currentRoute(){
  return ((D37Route.hash()||'').replace(/^#\/?/,'').split('/')[0]) || 'home';
}
// Всё, что после первого "/" в разделе — например для /forum/42 (#/forum/42) это "42". Роутер эти данные никак не использует —
// просто отдаёт их странице, которая знает, что с ними делать.
function currentRouteParam(){
  const raw = (D37Route.hash()||'').replace(/^#\/?/,'');
  const slash = raw.indexOf('/');
  return slash === -1 ? null : raw.slice(slash + 1) || null;
}
// Старт — из index.html на прежнем месте router.js (после init.js): все разделы уже загружены.
// «Игра поверх мира»: пока партия из «Мира Денчика» открыта окном поверх мира, её переходы (онлайн, «выйти») ведёт
// js/games/mir-play.js — мир не выгружаем и страницу не меняем
function routerStart(){
  if (routerStarted) return;
  routerStarted = true;
  D37Route.start();
  window.addEventListener('d37:route', e=>{ if (window.MirPlay?.onHash?.(e)) return; showPage(currentRoute()); });
  showPage(currentRoute());
}

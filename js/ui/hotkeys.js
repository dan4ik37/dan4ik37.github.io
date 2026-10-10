
// ═══════════════════════════════════════
//  ГОРЯЧИЕ КЛАВИШИ (десктоп) — переключение страниц без перезагрузки
//  Цифры 1–8 = прямой переход, стрелки ← → = соседняя страница по порядку PAGES
// ═══════════════════════════════════════
function isTypingContext(){
  const el = document.activeElement;
  if(!el) return false;
  if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT'||el.isContentEditable) return true;
  return false;
}
function isModalOpen(){
  return ['modal','perfPopup','pollAdminModal','globalAuthModal','privacyModal','confirmModal','settingsAdminModal'].some(id=>{
    const el=document.getElementById(id);
    return el && getComputedStyle(el).display!=='none';
  });
}
document.addEventListener('keydown', e=>{
  // Ctrl/Cmd+K — командная палитра. Перехватываем раньше общей проверки
  // "ctrlKey||metaKey → return", т.к. Ctrl/Cmd сейчас вообще ничего не
  // перехватывают — конфликтов с остальными хоткеями нет.
  if((e.ctrlKey||e.metaKey) && !e.altKey && e.key.toLowerCase()==='k'){
    if(isModalOpen() && !document.getElementById('cmdPalette')?.classList.contains('open')) return;
    e.preventDefault();
    toggleCmdPalette();
    return;
  }
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  if(isTypingContext()||isModalOpen()) return;
  // Открыта мини-игра (#/games/<id>) — стрелки и цифры её, не переключаем страницы
  if(typeof gamesActive!=='undefined' && gamesActive) return;
  // «/» — поиск по сайту (как на YouTube/GitHub)
  if(e.key==='/'){ e.preventDefault(); openCmdPalette(); return; }
  const routes = Object.keys(PAGES);
  if(e.key>='1' && e.key<='8'){
    const route = routes[+e.key-1];
    if(route){ e.preventDefault(); location.hash='#/'+route; }
    return;
  }
  if(e.key==='ArrowRight' || e.key==='ArrowLeft'){
    const cur = routes.indexOf(currentRoute());
    if(cur===-1) return;
    e.preventDefault();
    const dir = e.key==='ArrowRight' ? 1 : -1;
    location.hash = '#/'+routes[(cur+dir+routes.length)%routes.length];
  }
});

// ═══════════════════════════════════════
//  ПОИСК ПО САЙТУ — Ctrl/Cmd+K, «/» или кнопка 🔍 в шапке
//  Ищет разделы (ссылки [data-route] в DOM — одна точка правды с меню), игры (GAMES
//  из games.js) и видео (allVids из youtube.js; не загружены — подгружаем ensureYT()).
//  Видео ведут на /v/<id> — отдельную страницу ролика.
// ═══════════════════════════════════════
const norm = t => String(t||'').toLowerCase().replace(/ё/g,'е');
function collectRoutes(){
  const seen = new Set(), items = [];
  document.querySelectorAll('a[data-route]').forEach(a=>{
    const route = a.dataset.route;
    if(seen.has(route)) return;
    seen.add(route);
    // Без счётчиков-значков внутри ссылки (новые видео, непрочитанные) — иначе «Видео9+»
    const c = a.cloneNode(true);
    c.querySelectorAll('.chat-badge,.new-count').forEach(b=>b.remove());
    const label = c.textContent.trim().replace(/\s+/g,' ');
    if(label) items.push({ kind:'page', label, href:'#/'+route });
  });
  return items;
}
// Отдельные страницы сайта (серверные, не #/разделы) — раньше поиск их не знал: «VIP», «ник», «архив» не находились
const SITE_PAGES = [
  { kind:'page', label:'👤 Кто такой dan4ik37', sub:'о авторе денчик ютубер стример канал подписчики', href:'/about' },
  { kind:'page', label:'✨ VIP — что даёт и как получить', sub:'вип донат подписка цветной ник стикеры', href:'/vip' },
  { kind:'page', label:'🏆 Самые популярные видео', sub:'топ лучшие популярные просмотры шортсы', href:'/top' },
  { kind:'page', label:'🎬 Все видео канала — архив', sub:'архив все ролики по годам старые видео', href:'/videos' },
  { kind:'page', label:'🗂 Игры канала — ролики по играм', sub:'темы майнкрафт роблокс хоррор гта', href:'/topics' },
  { kind:'page', label:'📜 История канала по годам', sub:'история первое видео годы', href:'/history' },
  { kind:'page', label:'🏷 Генератор ников для игр', sub:'ник никнейм придумать роблокс стандофф', href:'/tools/nick' },
  { kind:'page', label:'✒️ Шрифты для ника — красивые буквы и символы', sub:'шрифт ник символы красивые буквы стиль', href:'/tools/fonts' },
  { kind:'page', label:'🧩 Тесты: кто ты из Майнкрафта, FNAF, Роблокса', sub:'тест квиз какой ты моб персонаж кто ты зритель', href:'/quiz' },
  { kind:'page', label:'⌨️ Тест скорости печати', sub:'печать скорость знаков в минуту клавиатура тренажёр', href:'/tools/typing' },
  { kind:'page', label:'🔢 Генератор случайных чисел, монетка, кубики', sub:'рандомайзер случайное число орёл решка кубик жребий', href:'/tools/random' },
  { kind:'page', label:'🛠️ Студия игр — сделай свою игру', sub:'конструктор игр создать игру своя игра без кода ии', href:'#/games/studio' },
  { kind:'page', label:'🎡 Колесо фортуны — крутить рандом', sub:'колесо рандом случайный выбор розыгрыш жребий', href:'/tools/wheel' },
  { kind:'page', label:'🖱 CPS тест — сколько кликов в секунду', sub:'cps клики кликер скорость тест мышь', href:'/tools/cps' },
  { kind:'page', label:'📣 Реклама на канале — медиакит', sub:'реклама сотрудничество интеграция медиакит', href:'/reklama' },
];
// Поиск по всему архиву (~6000 роликов, /api/ids?t=1): allVids — только последние ~150, старые ролики не находились.
// Грузим один раз, когда человек начал что-то искать (ответ кэширует CDN).
let archiveVids = null, archiveLoading = null;
function loadArchive(){
  if (archiveVids || archiveLoading) return archiveLoading;
  archiveLoading = fetch('/api/ids?t=1').then(r => r.ok ? r.json() : null).then(d => {
    archiveVids = (d && Array.isArray(d.v) ? d.v : []).map(([id, title, date]) => ({ kind:'video', label:title,
      sub: date ? date.split('-').reverse().join('.') : '', href:'/v/'+id, thumb:'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg' }));
  }).catch(() => { archiveVids = []; });
  return archiveLoading;
}
function collectGames(){
  if(typeof GAMES==='undefined') return [];
  return GAMES.map(g=>({ kind:'game', label:g.icon+' '+g.title, sub:g.desc, href:g.href || '#/games/'+g.id }));
}
function collectVideos(){
  const list = typeof allVids!=='undefined' && Array.isArray(allVids) ? allVids : [];
  return list.slice().sort((a,b)=>(b.ts||0)-(a.ts||0)).map(v=>({ kind:'video', label:v.title, sub:[v.date, v.views && v.views+' просм.'].filter(Boolean).join(' · '), href:'/v/'+v.id, thumb:v.thumb }));
}
function scoreItem(it, words){
  const t = norm(it.label), sub = norm(it.sub);
  let score = 0;
  for(const w of words){
    if(t.startsWith(w)) score += 3;
    else if(t.includes(' '+w)) score += 2;
    else if(t.includes(w)) score += 1;
    else if(sub.includes(w)) score += .5;
    else return 0;          // каждое слово должно найтись
  }
  return score;
}
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

function ensureCmdPaletteEl(){
  let el = document.getElementById('cmdPalette');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'cmdPalette';
  el.innerHTML = `
    <div class="cmdp-backdrop"></div>
    <div class="cmdp-box" role="dialog" aria-modal="true" aria-label="Поиск по сайту">
      <div class="cmdp-field"><span aria-hidden="true">🔍</span>
        <input id="cmdPaletteInput" type="search" placeholder="Видео, игры, разделы…" autocomplete="off" enterkeyhint="go">
        <kbd>Esc</kbd></div>
      <div id="cmdPaletteList" class="cmdp-list" role="listbox"></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.cmdp-backdrop').addEventListener('click', closeCmdPalette);
  el.querySelector('kbd').addEventListener('click', closeCmdPalette);
  const input = el.querySelector('#cmdPaletteInput');
  input.addEventListener('input', ()=>renderCmdPaletteList(input.value));
  input.addEventListener('keydown', e=>{
    const list = el.querySelector('#cmdPaletteList');
    const active = list.querySelector('.cmdp-item.active');
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();
      const opts = [...list.querySelectorAll('.cmdp-item')];
      if(!opts.length) return;
      let idx = opts.indexOf(active);
      idx = e.key==='ArrowDown' ? Math.min(idx+1, opts.length-1) : Math.max(idx-1, 0);
      opts.forEach(o=>o.classList.remove('active'));
      opts[idx].classList.add('active');
      opts[idx].scrollIntoView({block:'nearest'});
    } else if(e.key==='Enter'){
      e.preventDefault();
      (active || list.querySelector('.cmdp-item'))?.click();
    } else if(e.key==='Escape'){
      e.preventDefault();
      closeCmdPalette();
    }
  });
  return el;
}

function itemHtml(it, active){
  const ic = it.kind==='video' ? (it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy">` : '▶') : it.kind==='page' ? '↪' : it.kind==='random' ? '🎲' : '';
  return `<a class="cmdp-item${active?' active':''}" href="${esc(it.href)}" data-kind="${it.kind}">
      ${ic ? `<span class="cmdp-ic">${ic}</span>` : ''}
      <span class="cmdp-txt"><span class="cmdp-item-label">${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
      <span class="cmdp-item-go">↵</span></a>`;
}

function renderCmdPaletteList(query){
  const list = document.getElementById('cmdPaletteList');
  const q = norm(query).trim();
  const pages = [...collectRoutes(), ...SITE_PAGES], games = collectGames(), vids = collectVideos();
  let groups;
  if(!q){
    const rnd = [];
    if(vids.length) rnd.push({ kind:'random', label:'Случайное видео', sub:'Любое из почти 6000 роликов канала', href:'#surprise' });
    const playable = games.filter(g=>g.href.startsWith('#/games/'));
    if(playable.length) rnd.push({ kind:'random', label:'Случайная игра', sub:'Не знаешь, во что сыграть?', href:pick(playable).href });
    groups = [['Новые видео', vids.slice(0,4)], ['Игры', games.slice(0,6)], ['Наугад', rnd], ['Разделы', pages]];
  } else {
    const words = q.split(/\s+/).filter(Boolean);
    const find = (arr, lim) => arr.map(it=>({it, s:scoreItem(it, words)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,lim).map(x=>x.it);
    // Видео: сначала свежие (с просмотрами), потом весь архив
    let vidsFound = find(vids, 10);
    if (archiveVids && vidsFound.length < 10) {
      const have = new Set(vidsFound.map(v => v.href));
      vidsFound = vidsFound.concat(find(archiveVids.filter(v => !have.has(v.href)), 10 - vidsFound.length));
    } else if (!archiveVids) {
      loadArchive()?.then(() => { const inp = document.getElementById('cmdPaletteInput'); if (inp && document.getElementById('cmdPalette')?.classList.contains('open') && norm(inp.value).trim() === q) renderCmdPaletteList(inp.value); });
    }
    groups = [['Разделы', find(pages,5)], ['Игры', find(games,5)], ['Видео', vidsFound]];
  }
  groups = groups.filter(([,arr])=>arr.length);
  if(!groups.length){
    const waiting = !vids.length || (!archiveVids && archiveLoading);
    list.innerHTML = `<div class="cmdp-empty">Ничего не нашлось по «${esc(query.trim())}»${waiting ? '<br><small>Ищем во всём архиве…</small>' : ''}
      <div class="cmdp-empty-act"><a href="/videos">🎬 Все видео по годам</a><a href="/topics">🗂 Ролики по играм</a></div></div>`;
    return;
  }
  let first = true;
  list.innerHTML = groups.map(([title, arr])=>`<div class="cmdp-group">${title}</div>` + arr.map(it=>{ const h = itemHtml(it, first); first = false; return h; }).join('')).join('');
  list.querySelectorAll('.cmdp-item').forEach(a=>a.addEventListener('click', e=>{
    if(a.getAttribute('href')==='#surprise' && typeof d37Surprise==='function'){ e.preventDefault(); d37Surprise(); }
    if(typeof window.va==='function') window.va('event', { name:'site_search_go', data:{ kind:a.dataset.kind } });
    closeCmdPalette();
  }));
}

function openCmdPalette(){
  const el = ensureCmdPaletteEl();
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  const input = document.getElementById('cmdPaletteInput');
  input.value = '';
  renderCmdPaletteList('');
  setTimeout(()=>input.focus(), 30);
  // Видео ещё не грузились (открыли сразу игры/чат) — подгружаем и перерисовываем
  if((typeof allVids==='undefined' || !allVids?.length) && typeof ensureYT==='function'){
    ensureYT().then(()=>{ if(el.classList.contains('open')) renderCmdPaletteList(input.value); }).catch(()=>{});
  }
}
function closeCmdPalette(){
  const el = document.getElementById('cmdPalette');
  if(!el) return;
  el.classList.remove('open');
  document.body.style.overflow = '';
}
function toggleCmdPalette(){
  const el = document.getElementById('cmdPalette');
  if(el && el.classList.contains('open')) closeCmdPalette();
  else openCmdPalette();
}

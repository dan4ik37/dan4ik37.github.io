
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
//  КОМАНДНАЯ ПАЛИТРА Ctrl/Cmd+K
//  Пункты берём напрямую из [data-route] в DOM (те же маршруты, что бегущая
//  строка героя и меню «Ещё») — одна точка правды, не дублируем список.
// ═══════════════════════════════════════
let cmdPaletteItems = null;
function collectCmdPaletteItems(){
  const seen = new Set();
  const items = [];
  document.querySelectorAll('a[data-route]').forEach(a=>{
    const route = a.dataset.route;
    if(seen.has(route)) return;
    seen.add(route);
    const label = a.textContent.trim().replace(/\s+/g,' ');
    if(label) items.push({route, label});
  });
  return items;
}
function ensureCmdPaletteEl(){
  let el = document.getElementById('cmdPalette');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'cmdPalette';
  el.innerHTML = `
    <div class="cmdp-backdrop"></div>
    <div class="cmdp-box" role="dialog" aria-modal="true" aria-label="Командная палитра">
      <input id="cmdPaletteInput" type="text" placeholder="Куда перейти? (Ctrl+K)" autocomplete="off">
      <div id="cmdPaletteList" class="cmdp-list"></div>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('.cmdp-backdrop').addEventListener('click', closeCmdPalette);
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
function renderCmdPaletteList(query){
  const list = document.getElementById('cmdPaletteList');
  if(!cmdPaletteItems) cmdPaletteItems = collectCmdPaletteItems();
  const q = (query||'').trim().toLowerCase();
  const filtered = q ? cmdPaletteItems.filter(i=>i.label.toLowerCase().includes(q)) : cmdPaletteItems;
  if(!filtered.length){
    list.innerHTML = `<div class="cmdp-empty">Ничего не нашлось</div>`;
    return;
  }
  list.innerHTML = filtered.map((i,idx)=>`
    <div class="cmdp-item${idx===0?' active':''}" data-route="${i.route}">
      <span class="cmdp-item-label">${i.label}</span>
      <span class="cmdp-item-go">↵</span>
    </div>`).join('');
  list.querySelectorAll('.cmdp-item').forEach(el=>{
    el.addEventListener('click', ()=>{
      location.hash = '#/'+el.dataset.route;
      closeCmdPalette();
    });
  });
}
function openCmdPalette(){
  const el = ensureCmdPaletteEl();
  cmdPaletteItems = collectCmdPaletteItems();
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
  const input = document.getElementById('cmdPaletteInput');
  input.value = '';
  renderCmdPaletteList('');
  requestAnimationFrame(()=>input.focus());
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

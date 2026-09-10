
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

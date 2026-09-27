// ═══════════════════════════════════════
//  GOOGLE ADSENSE — ленивая загрузка блоков
// ═══════════════════════════════════════
// Раньше каждый <ins> сразу делал adsbygoogle.push({}) прямо в разметке — в
// том числе блоки, которые роутер тут же прячет (display:none). Google
// получал ширину 0 → «No slot size for availableWidth=0», блок оставался
// пустым навсегда. Плюс у блоков не было data-ad-slot, без которого
// медийный блок вообще не показывает рекламу.
//
// Теперь: ID блока берётся из AD_SLOTS (config.js). Нет ID — блок скрыт.
// Есть — push() делается только когда блок реально виден (router.js вызывает
// fillVisibleAds() после каждой смены раздела).
function fillVisibleAds(){
  document.querySelectorAll('ins.adsbygoogle[data-slot-key]').forEach(ins => {
    if (ins.dataset.adFilled) return;
    const slotId = (typeof AD_SLOTS === 'object' && AD_SLOTS[ins.dataset.slotKey]) || '';
    // Обёртка на главной/в «Рекламе» — .wrap-sm; в карточке прячем только сам <ins>
    const box = ins.parentElement?.classList.contains('wrap-sm') ? ins.parentElement : ins;
    if (!slotId) { box.classList.add('ad-empty'); return; }
    box.classList.remove('ad-empty');
    if (!ins.offsetWidth) return; // скрыт роутером — заполним, когда откроют этот раздел
    ins.setAttribute('data-ad-slot', slotId);
    ins.dataset.adFilled = '1';
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  });
}

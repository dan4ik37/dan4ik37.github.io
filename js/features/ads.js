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
  const M = window.D37AdPlaces;
  document.querySelectorAll('ins.adsbygoogle[data-slot-key]').forEach(ins => {
    if (ins.dataset.adFilled) return;
    const slotId = (typeof AD_SLOTS === 'object' && AD_SLOTS[ins.dataset.slotKey]) || '';
    // Обёртка на главной/в «Рекламе» — .wrap-sm; в карточке прячем только сам <ins>
    const box = ins.parentElement?.classList.contains('wrap-sm') ? ins.parentElement : ins;
    // VIP / персонал / «рядом нельзя» (ad-places.js) — места нет совсем
    if (M && M.why(ins.dataset.slotKey, { ignoreId: true })) { box.classList.add('ad-empty'); return; }
    // Отладка (?adsdebug=1): рамка вместо рекламы, когда раздел открыт
    if (M && M.frames() && box !== ins) {
      box.classList.remove('ad-empty');
      if (!box.offsetWidth) return;
      const holder = document.createElement('div');
      ins.replaceWith(holder);
      M.placeholder(holder, ins.dataset.slotKey);
      M.mark(ins.dataset.slotKey);
      return;
    }
    // Для этого места задан блок Яндекса — показываем его вместо AdSense (js/core/ads-core.js)
    if (window.ADS_IDS?.yandex?.[ins.dataset.slotKey] && box !== ins) {
      box.classList.remove('ad-empty');
      if (!box.offsetWidth) return;
      const holder = document.createElement('div');
      ins.replaceWith(holder);
      window.D37Ads.render(holder, ins.dataset.slotKey);
      return;
    }
    if (!slotId) { box.classList.add('ad-empty'); return; }
    box.classList.remove('ad-empty');
    if (!ins.offsetWidth) return; // скрыт роутером — заполним, когда откроют этот раздел
    ins.setAttribute('data-ad-slot', slotId);
    if (window.ADS_IDS?.kids) ins.setAttribute('data-tag-for-age-treatment', String(window.ADS_IDS.kids));
    ins.dataset.adFilled = '1';
    M?.mark(ins.dataset.slotKey);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  });
}

// Полоска рекламы внизу экрана на телефоне (Floor Ad РСЯ) — через 25 с на сайте, не поверх игры
setTimeout(function tryFloor(){
  if (/^#\/games\//.test(location.hash)) { setTimeout(tryFloor, 30000); return; }
  window.D37Ads?.floor();
}, 25000);

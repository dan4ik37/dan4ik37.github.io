// ═══════════════════════════════════════
//  ИНСТРУМЕНТЫ-ПРИЛОЖЕНИЯ (D37Apps) — фоторедактор /photo (потом видеоредактор): грузятся только когда их открыли
// ═══════════════════════════════════════
// Роутер (js/ui/router.js) на разделе photo зовёт D37Apps.open('photo', param); ушли с раздела (событие 'd37:route') —
// редактор закрывается и отпускает память. Общее для инструментов — D37Apps.need([...]) (команды «d37 v1» js/core/tools.js,
// «Мои материалы» js/core/assets.js, ИИ js/core/ai-bridge.js) — можно звать и из других разделов (Студия 3D и т. п.).
// Основа фоторедактора — fabric.js 7.4.0 (MIT) с jsDelivr, точная версия. Поменял файлы фоторедактора — подними VER.
// /photo/<номер материала> — сразу открыть картинку из «Моих материалов» (так другой инструмент «отправляет в фоторедактор»).
(function () {
  'use strict';
  const VER = '2';   // 2 — «Убрать фон», память телефона, без кэша fabric у картинок
  const FABRIC = 'https://cdn.jsdelivr.net/npm/fabric@7.4.0/dist/index.min.js';
  // ИИ «🪄 Убрать фон» — только по кнопке: ONNX Runtime Web 1.30.0 (MIT) с jsDelivr + модель U²-Netp (Apache-2.0, ~4,6 МБ)
  // с Hugging Face, закреплённая на коммите (лицензии проверены — docs/PHOTO.md)
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
  const AI = { ortUrl: ORT_BASE + 'ort.wasm.min.js', ortBase: ORT_BASE,
    modelUrl: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8/onnx/model.onnx' };
  const CORE = { tools: 'js/core/tools.js', assets: 'js/core/assets.js', ai: 'js/core/ai-bridge.js' };
  const PHOTO = [FABRIC, CORE.tools, CORE.assets, CORE.ai, 'js/apps/photo/photo-cmds.js', 'js/apps/photo/photo-core.js', 'js/apps/photo/photo-ui.js'];
  const loaded = new Map();
  const url = src => /^https?:/.test(src) ? src : src + '?v=' + VER;
  // Скрипты грузятся параллельно, а выполняются по порядку (async = false)
  function script(src){
    if (loaded.has(src)) return loaded.get(src);
    const p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = url(src); s.async = false;
      if (/^https?:/.test(src)) s.crossOrigin = 'anonymous';
      s.onload = res; s.onerror = () => rej(new Error('Не загрузилось: ' + src.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, '')));
      document.head.appendChild(s);
    });
    p.catch(() => { if (loaded.get(src) === p) loaded.delete(src); });   // в другой раз — ещё попытка
    loaded.set(src, p);
    return p;
  }
  function css(href){
    if (loaded.has(href)) return loaded.get(href);
    const p = new Promise(res => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url(href); l.onload = res; l.onerror = res; document.head.appendChild(l); });
    loaded.set(href, p);
    return p;
  }
  const need = names => Promise.all(names.map(n => script(CORE[n] || n)));

  let cur = null, opening = 0;
  const onRoute = () => (typeof currentRoute === 'function' ? currentRoute() : '') === 'photo';
  async function open(app, param){
    if (app !== 'photo') return;
    const host = document.getElementById('photoRoot');
    if (!host) return;
    if (cur && cur.active) return;   // уже открыт (тот же раздел)
    const my = ++opening;
    host.innerHTML = '<div class="pe-loading" role="status"><i></i><b>🖼 Фоторедактор</b><span>Загружаю…</span></div>';
    const navB = document.getElementById('nav'); if (navB) host.firstChild.style.top = Math.round(navB.getBoundingClientRect().bottom) + 'px';
    const ad = window.D37AdPlaces && window.D37AdPlaces.loading ? window.D37AdPlaces.loading({ anchor: host.firstChild, tip: 'photo' }) : null;
    try {
      await Promise.all([css('css/photo.css'), Promise.all(PHOTO.map(script))]);
    } catch (e) {
      ad && ad.done();
      if (my === opening) host.innerHTML = `<div class="pe-loading"><b>⚠️ Фоторедактор не загрузился</b><span>${String(e.message || e).replace(/[<>&]/g, '')}. Проверь интернет и обнови страницу.</span></div>`;
      return;
    }
    ad && ad.done();
    if (my !== opening || !onRoute()) return;   // пока грузилось — ушли с раздела
    cur = window.D37PhotoUI.mount(host, { param, fabricUrl: FABRIC, ai: AI, workerUrl: 'js/apps/photo/photo-worker.js?v=' + VER });
  }
  function close(){
    opening++;
    if (cur) { try { cur.unmount && cur.unmount(); } catch (e) { console.warn(e); } cur = null; }
    const host = document.getElementById('photoRoot'); if (host) host.innerHTML = '';
  }
  window.addEventListener('d37:route', () => { if (!onRoute()) close(); });

  window.D37Apps = { VER, FABRIC, open, close, need, script, get photo(){ return cur; } };
})();

// ═══════════════════════════════════════
//  ИНСТРУМЕНТЫ-ПРИЛОЖЕНИЯ (D37Apps) — фоторедактор /photo, 3D-мастерская AI3D /tools/3d (потом видеоредактор): грузятся только когда их открыли
// ═══════════════════════════════════════
// Роутер (js/ui/router.js) на разделе photo зовёт D37Apps.open('photo', param); ушли с раздела (событие 'd37:route') —
// редактор закрывается и отпускает память. Общее для инструментов — D37Apps.need([...]) (команды «d37 v1» js/core/tools.js,
// «Мои материалы» js/core/assets.js, ИИ js/core/ai-bridge.js) — можно звать и из других разделов (Студия 3D и т. п.).
// Основа фоторедактора — fabric.js 7.4.0 (MIT) с jsDelivr, точная версия. Поменял файлы фоторедактора — подними VER.
// /photo/<номер материала> — сразу открыть картинку из «Моих материалов» (так другой инструмент «отправляет в фоторедактор»).
// AI3D (T-112): the owner's 3D editor, hidden page /tools/3d (route "ai3d": noindex, not in search, menus, footer or sitemap) —
// three r149 (the same build as the games, only if not loaded yet), js/apps/ai3d/*, css/ai3d.css; leaving the route → unmount().
(function () {
  'use strict';
  const VER = '6';   // 6 — AI3D: общий скелет и действия (T-131, A2); 5 — 3D-мастерская AI3D /tools/3d; 4 — проект .d37photo и черновик при уходе из редактора
  const FABRIC = 'https://cdn.jsdelivr.net/npm/fabric@7.4.0/dist/index.min.js';
  // ИИ «🪄 Убрать фон» — только по кнопке: ONNX Runtime Web 1.30.0 (MIT) с jsDelivr + модель U²-Netp (Apache-2.0, ~4,6 МБ)
  // с Hugging Face, закреплённая на коммите (лицензии проверены — docs/PHOTO.md)
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
  const AI = { ortUrl: ORT_BASE + 'ort.wasm.min.js', ortBase: ORT_BASE,
    modelUrl: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8/onnx/model.onnx' };
  const CORE = { tools: 'js/core/tools.js', assets: 'js/core/assets.js', ai: 'js/core/ai-bridge.js' };
  const PHOTO = [FABRIC, CORE.tools, CORE.assets, CORE.ai, 'js/apps/photo/photo-cmds.js', 'js/apps/photo/photo-core.js', 'js/apps/photo/photo-ui.js'];
  // AI3D: three r149 — the same file js/games/world3d.js loads (one copy of THREE on the page)
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';
  const AI3D = ['js/engine/skel.js', 'js/apps/ai3d/ai3d-rig.js', 'js/apps/ai3d/ai3d-gltf.js', 'js/apps/ai3d/ai3d-core.js', 'js/apps/ai3d/ai3d-ui.js'];
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

  // away — редактор, из которого ушли: сохраняет черновик несохранённой работы (или остался скрытым — черновик не сохранился)
  let cur = null, opening = 0, away = null;
  const route = () => (typeof currentRoute === 'function' ? currentRoute() : '');
  const onRoute = () => route() === 'photo';
  async function open(app, param){
    if (app === 'ai3d') return open3d(param);
    if (app !== 'photo') return;
    const host = document.getElementById('photoRoot');
    if (!host) return;
    if (cur && cur.active) return;   // уже открыт (тот же раздел)
    if (away && away.c.active && away.c.resume) {   // вернулись, пока он ещё здесь, — тот же редактор, как был
      const a = away; away = null; a.back = true; cur = a.c; cur.resume(param); return;
    }
    const my = ++opening;
    host.innerHTML = '<div class="pe-loading" role="status"><i></i><b>🖼 Фоторедактор</b><span>Загружаю…</span></div>';
    const navB = document.getElementById('nav'); if (navB) host.firstChild.style.top = Math.round(navB.getBoundingClientRect().bottom) + 'px';
    const ad = window.D37AdPlaces && window.D37AdPlaces.loading ? window.D37AdPlaces.loading({ anchor: host.firstChild, tip: 'photo' }) : null;
    try {
      await Promise.all([css('css/photo.css'), Promise.all(PHOTO.map(script))]);
    } catch (e) {
      ad && ad.done();
      if (my === opening) {
        host.innerHTML = '<div class="pe-loading"><b>⚠️ Фоторедактор не загрузился</b><span></span></div>';
        host.querySelector('span').textContent = String(e.message || e) + '. Проверь интернет и обнови страницу.';   // текст — не разметка
      }
      return;
    }
    ad && ad.done();
    if (my !== opening || !onRoute()) return;   // пока грузилось — ушли с раздела
    cur = window.D37PhotoUI.mount(host, { param, fabricUrl: FABRIC, ai: AI, workerUrl: 'js/apps/photo/photo-worker.js?v=' + VER });
  }
  function close(){
    opening++;
    const c = cur, host = document.getElementById('photoRoot'); cur = null;
    if (c && c.active && c.leave) {   // несохранённое — черновиком, потом закроется сам (photo-ui.js leave)
      const a = { c, back: false }; away = a;
      Promise.resolve(c.leave(() => a.back)).catch(e => console.warn(e)).finally(() => { if (away === a && !c.active) away = null; });
      return;
    }
    if (c) { try { c.unmount && c.unmount(); } catch (e) { console.warn(e); } }
    if (host && !(away && away.c.active)) host.innerHTML = '';
  }
  // ═══ 🧊 AI3D /tools/3d ═══
  let a3 = null, a3open = 0;
  // three: already on the page (a game loaded it) → that copy; a game is loading it right now → wait for that script
  async function three(){
    if (window.THREE) return;
    if (document.querySelector('script[src="' + THREE_URL + '"]') && !loaded.has(THREE_URL)) {
      for (let i = 0; i < 150 && !window.THREE; i++) await new Promise(r => setTimeout(r, 100));
      if (window.THREE) return;
    }
    await script(THREE_URL);
  }
  async function open3d(param){
    const host = document.getElementById('ai3dRoot');
    if (!host || a3) return;
    const my = ++a3open;
    host.innerHTML = '<div class="a3-loading" role="status"><i></i><b>🧊 3D-мастерская</b><span>Загружаю…</span></div>';
    const navB = document.getElementById('nav'); if (navB) host.firstChild.style.top = Math.round(navB.getBoundingClientRect().bottom) + 'px';
    try {
      await Promise.all([css('css/ai3d.css'), three(), Promise.all(AI3D.map(script))]);
    } catch (e) {
      if (my === a3open) {
        host.innerHTML = '<div class="a3-loading"><b>⚠️ 3D-мастерская не загрузилась</b><span></span></div>';
        host.querySelector('span').textContent = String(e.message || e) + '. Проверь интернет и обнови страницу.';   // текст — не разметка
      }
      return;
    }
    if (my !== a3open || route() !== 'ai3d' || a3) return;   // пока грузилось — ушли с раздела
    a3 = window.D37AI3DUI.mount(host, { param });
  }
  function close3d(){
    a3open++;
    const c = a3; a3 = null;
    if (c) { try { c.unmount(); } catch (e) { console.warn(e); } }
    const host = document.getElementById('ai3dRoot'); if (host) host.innerHTML = '';
  }

  window.addEventListener('d37:route', () => { const r = route(); if (r !== 'photo') close(); if (r !== 'ai3d') close3d(); });

  window.D37Apps = { VER, FABRIC, THREE_URL, open, close, close3d, need, script, get photo(){ return cur; }, get ai3d(){ return a3; } };
})();

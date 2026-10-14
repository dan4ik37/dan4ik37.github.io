// ═══════════════════════════════════════
//  ПОЛНЫЙ ЭКРАН ДЛЯ ИГР (D37Full) — один помощник на весь сайт: игры (#gamesStage), «Мир Денчика», «Студия 3D», Unity-игры
// ═══════════════════════════════════════
// D37Full.enter(el, o) / exit() / toggle(el, o). el закрепляется во весь экран CSS-ом (el.gs-fs; html.gs-full прячет шапку,
// нижнее меню, плашки и кнопки сайта), а панели браузера убирает Fullscreen API — на ВСЕЙ странице (documentElement), а не
// на el: так окна сайта поверх игры (вход, ⚙️ настройки, редактор персонажа, всплывашки) остаются видны. Предки el на время
// теряют transform/z-index (.gs-anc) — иначе position: fixed считался бы от них, а не от окна.
// Нет API (iPhone) или браузер отказал — «как полный экран» (режим 'pseudo', только CSS): 100% окна, вырез экрана обходим
// через env(safe-area-*) — на время полного экрана в meta viewport дописываем viewport-fit=cover.
// o: { api: false — только CSS; esc: false — Esc не выходит (в «Мире» Esc — меню); exitBtn: true — своя кнопка выхода поверх
// el (у el нет своей); history: false — без записи для «Назад» }. В 'pseudo' Esc и «Назад» выходят, как у настоящего API.
// Внутри el есть .gs-noesc — Esc тоже не выходит (так «Мир» оставляет Esc своему меню при любом входе в полный экран).
// Кнопки — без своего кода: <button data-gs-full="#gamesStage"> переключает (значок меняется сам), data-gs-rot="…" — 🔄.
// D37Full.rotate(el) — полный экран + screen.orientation.lock('landscape') (Android). Нет блокировки (iPhone) — подсказка
// «Поверни телефон». D37Full.auto(el) — открыта игра el: телефон положили горизонтально — она сама во весь экран (настройка
// autoLand), поставили обратно — выходит; вышел сам кнопкой — до следующего поворота не возвращаем.
// Пока полный экран — экран не гаснет (Wake Lock). html.gs-compact — полный экран на низком экране (телефон лёжа).
// Событие window 'd37:fullscreen' { on, el, mode: 'api' | 'pseudo', auto }; D37Full.on(fn) → отписка; D37Full.state().
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const doc = root.document;
  if (!doc || root.D37Full) return;
  const F = { el: null, mode: null, auto: false, o: {}, hist: 0, ignorePop: 0, autoEl: null, autoOff: false, locked: false, wake: null, vp: null, subs: new Set(), seq: 0 };
  const de = () => doc.documentElement;
  const apiEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const apiOk = () => !!((doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (de().requestFullscreen || de().webkitRequestFullscreen));
  const mm = q => { try { return !!root.matchMedia && root.matchMedia(q).matches; } catch (e) { return false; } };
  const W = () => root.innerWidth || 0, H = () => root.innerHeight || 0;
  const landscape = () => W() > H();
  const touch = () => mm('(pointer: coarse)') || 'ontouchstart' in root;
  const phone = () => touch() && Math.min(W(), H()) < 600;
  const ios = () => /iPad|iPhone|iPod/.test(root.navigator?.userAgent || '') || (root.navigator?.platform === 'MacIntel' && root.navigator?.maxTouchPoints > 1);
  const setting = (k, d) => { try { const S = root.D37Settings; const v = S ? S.get(k) : undefined; return v === undefined ? d : v; } catch (e) { return d; } };
  const typing = t => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

  // ── Fullscreen API (с приставкой webkit — старый Safari на iPad) ──
  function requestApi(){
    const e = de(), f = e.requestFullscreen || e.webkitRequestFullscreen;
    if (!f) return Promise.resolve(false);
    try {
      const r = f.call(e, { navigationUI: 'hide' });
      return r && typeof r.then === 'function' ? r.then(() => true, () => false) : Promise.resolve(true);   // старый webkit — без обещания
    } catch (er) { return Promise.resolve(false); }
  }
  function exitApi(){
    const f = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (!f || !apiEl()) return;
    try { const r = f.call(doc); if (r && r.catch) r.catch(() => {}); } catch (e) {}
  }
  const refresh = () => { if (F.el) F.mode = apiEl() ? 'api' : 'pseudo'; };

  // ── Предки: transform / z-index / filter на время снимаем (иначе fixed — от них, а не от окна) ──
  function mark(el, on){ for (let p = el.parentElement; p && p !== doc.body && p !== de(); p = p.parentElement) p.classList.toggle('gs-anc', on); }
  // ── Вырез экрана: viewport-fit=cover только на время полного экрана (сайт в обычном виде не трогаем) ──
  function fit(on){
    const m = doc.querySelector?.('meta[name="viewport"]'); if (!m) return;
    if (on) { if (F.vp === null) { F.vp = m.getAttribute('content') || ''; if (!/viewport-fit/.test(F.vp)) m.setAttribute('content', F.vp + ', viewport-fit=cover'); } }
    else if (F.vp !== null) { m.setAttribute('content', F.vp); F.vp = null; }
  }
  const compact = () => de().classList.toggle('gs-compact', !!F.el && landscape() && H() <= 500);

  // ── Экран не гаснет, пока полный экран (как ⛶ в чате) ──
  async function wakeOn(){
    const n = root.navigator;
    if (F.wake || !n || !('wakeLock' in n) || doc.visibilityState === 'hidden') return;
    try {
      const w = await n.wakeLock.request('screen');
      if (!F.el) { w.release?.(); return; }
      F.wake = w; w.addEventListener?.('release', () => { if (F.wake === w) F.wake = null; });
    } catch (e) {}
  }
  function wakeOff(){ const w = F.wake; F.wake = null; try { w?.release?.(); } catch (e) {} }

  // ── «Назад» на телефоне выходит из полного экрана, а не из игры: своя запись в истории (тот же адрес) ──
  function pushHist(){
    const h = root.history; if (!h?.pushState || F.hist) return;
    F.hist = ++F.seq;
    try { h.pushState(Object.assign({}, h.state && typeof h.state === 'object' ? h.state : null, { gsFull: F.hist }), '', root.location.href); } catch (e) { F.hist = 0; }
  }

  // ── Значки кнопок ⛶: SVG (у шрифтов Windows нет «выйти из полного экрана») ──
  const svg = d => `<svg class="gs-ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON_IN = svg('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'), ICON_OUT = svg('M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4');
  // «включён» для кнопки: на телефоне в авто-режиме, где браузер умеет настоящий полный экран, кнопка ещё зовёт его включить
  const btnOn = () => !!F.el && !(F.auto && F.mode !== 'api' && apiOk());
  function setBtn(b, on){
    const lbl = b.dataset.gsLabel;
    b.innerHTML = (on ? ICON_OUT : ICON_IN) + (lbl ? `<span> ${on ? 'Обычный экран' : lbl}</span>` : '');
    b.title = on ? 'Выйти из полноэкранного режима' : 'Во весь экран';
    b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on);
  }
  function syncBtns(){ const on = btnOn(); doc.querySelectorAll?.('[data-gs-full]').forEach(b => setBtn(b, on)); }

  function emit(el){
    const d = { on: !!F.el, el: F.el || el || null, mode: F.mode, auto: F.auto };
    syncBtns();
    for (const f of [...F.subs]) { try { f(d); } catch (e) { console.error(e); } }
    try { root.dispatchEvent(new root.CustomEvent('d37:fullscreen', { detail: d })); } catch (e) {}
    kick();
  }
  // размеры поменялись: у кого ResizeObserver — и так пересчитают, у кого window 'resize' — для них (и после поворота)
  let kickT = 0;
  function kick(){
    const go = () => { try { root.dispatchEvent(new root.Event('resize')); } catch (e) {} };
    (root.requestAnimationFrame || (f => setTimeout(f, 16)))(go);
    clearTimeout(kickT); kickT = setTimeout(go, 350);
  }

  // Кнопка выхода поверх el (у Unity-окна своей нет): та же data-gs-full — переключатель
  function exitBtn(el, on){
    const old = [...(el.children || [])].find(c => c.classList?.contains('gs-exit'));
    if (!on) { old?.remove(); return; }
    if (old) return;
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'gs-exit'; b.dataset.gsFull = '.gs-fs';
    el.appendChild(b); setBtn(b, true);
  }

  // ═══ Войти / выйти ═══
  function enter(el, o = {}){
    if (!el) return Promise.resolve(false);
    if (F.el && F.el !== el) exit({ keepApi: true });   // другой элемент: CSS переносим, полный экран браузера оставляем
    const fresh = F.el !== el;
    F.el = el; F.o = o; F.auto = !!o.auto;
    if (fresh) { mark(el, true); el.classList.add('gs-fs'); de().classList.add('gs-full'); fit(true); }
    exitBtn(el, !!o.exitBtn);
    refresh();
    let p = Promise.resolve(F.mode === 'api');
    // API — только по нажатию человека (в авто-режиме при повороте нельзя: браузер откажет)
    if (!F.auto && o.api !== false && F.mode !== 'api' && apiOk()) p = requestApi().then(ok => { refresh(); emit(); return ok; });
    // «Назад» — выйти из полного экрана (запись сразу: ответ браузера на запрос API может и не прийти)
    if (!F.auto && o.history !== false) pushHist();
    if (!F.auto) F.autoOff = false;
    wakeOn(); compact(); emit();
    return p;
  }
  function exit(o = {}){
    const el = F.el; if (!el) return;
    const wasAuto = F.auto;
    F.el = null; F.mode = null; F.auto = false;
    mark(el, false); el.classList.remove('gs-fs'); exitBtn(el, false);
    de().classList.remove('gs-full', 'gs-compact'); fit(false);
    rotHint(false);
    if (!o.keepApi) { if (apiEl()) exitApi(); unlockOrient(); wakeOff(); }
    // своя запись истории: вышли сами (кнопка, Esc) — убрать её «назад»; игру закрывают переходом (release) — не трогать,
    // иначе «назад» отменит этот переход
    if (F.hist && !o.fromPop && !o.noHist && root.history?.state?.gsFull === F.hist) { F.ignorePop++; try { root.history.back(); } catch (e) { F.ignorePop--; } }
    F.hist = 0;
    if (o.user && wasAuto && landscape()) F.autoOff = true;   // сам вышел из «повернул — на весь экран»: не возвращать до поворота
    emit(el);
  }
  function toggle(el, o = {}){
    if (F.el && (!el || F.el === el || el.contains?.(F.el) || F.el.contains?.(el))) {
      // авто-режим (телефон лёжа), а браузер умеет настоящий полный экран — первое нажатие убирает и его панели
      if (F.auto && F.mode !== 'api' && apiOk()) {
        F.auto = false; F.o = Object.assign({}, F.o, o);
        if (F.o.history !== false) pushHist();
        return requestApi().then(ok => { refresh(); emit(); return ok; });
      }
      exit({ user: true });
      return Promise.resolve(false);
    }
    return enter(el, o);
  }

  // ── 🔄 Повернуть: полный экран (без него поворот не закрепить) + альбомная ориентация; нет — подсказка ──
  async function rotate(el, o = {}){
    if (!el) return false;
    if (F.el !== el || F.auto || F.mode !== 'api') { F.auto = false; await enter(el, Object.assign({}, F.el === el ? F.o : {}, o, { api: true })); }
    let ok = false;
    const so = root.screen?.orientation;
    if (so?.lock) { try { await so.lock('landscape'); ok = true; F.locked = true; } catch (e) {} }
    if (!ok && !landscape()) rotHint(true);
    return ok;
  }
  function unlockOrient(){ if (!F.locked) return; F.locked = false; try { root.screen?.orientation?.unlock?.(); } catch (e) {} }
  function rotHint(on){
    let h = doc.getElementById?.('gsRotHint');
    if (!on) { h?.remove(); return; }
    if (h) return;
    h = doc.createElement('div'); h.id = 'gsRotHint'; h.className = 'gs-rothint';
    h.innerHTML = `<div class="gs-rothint-box"><span class="gs-rothint-ph" aria-hidden="true">📱</span><b>Поверни телефон горизонтально</b><small>${ios()
      ? 'Если экран не поворачивается — в Пункте управления выключи «Блокировку ориентации» (замок со стрелкой). Совсем без панелей Safari игра откроется с экрана «Домой»: «Поделиться» → «На экран «Домой»».'
      : 'Если экран не поворачивается — включи автоповорот в шторке телефона.'}</small><button type="button" class="gs-rothint-x">Понятно</button></div>`;
    const x = h.querySelector?.('button'); if (x) x.onclick = () => rotHint(false);
    (F.el || doc.body).appendChild(h);
  }

  // ── Авто: телефон лёжа + открыта игра → во весь экран (без API: поворот — не нажатие, браузер не разрешит) ──
  const autoWanted = () => !!F.autoEl && F.autoEl.isConnected !== false && phone() && landscape() && setting('autoLand', true) !== false && !F.autoOff;
  function check(){
    if (!landscape()) F.autoOff = false; else rotHint(false);
    const want = autoWanted();
    if (want && !F.el) enter(F.autoEl, { auto: true, api: false });
    else if (!want && F.el && F.auto) exit();
    compact();
  }

  // ═══ События ═══
  function onApiChange(){
    if (!F.el) return;   // полный экран без нас (видео и т. п.)
    if (apiEl()) { F.mode = 'api'; emit(); return; }
    if (F.mode !== 'api') return;
    // браузер вышел сам (Esc, «Назад», жест): телефон лёжа и игра открыта — остаёмся «как полный экран»
    unlockOrient();
    if (autoWanted()) { F.mode = 'pseudo'; F.auto = true; emit(); }
    else exit({ user: true });
  }
  function onPop(){
    if (F.ignorePop > 0) { F.ignorePop--; return; }
    if (F.hist && root.history?.state?.gsFull !== F.hist) { F.hist = 0; exit({ fromPop: true, user: true }); }
  }
  root.addEventListener?.('resize', check);
  root.addEventListener?.('orientationchange', () => setTimeout(check, 120));
  doc.addEventListener?.('fullscreenchange', onApiChange);
  doc.addEventListener?.('webkitfullscreenchange', onApiChange);
  root.addEventListener?.('popstate', onPop);
  doc.addEventListener?.('visibilitychange', () => { if (doc.visibilityState === 'visible' && F.el) wakeOn(); });
  // Esc в режиме «как полный экран» — выйти (настоящий полный экран Esc закрывает сам браузер)
  root.addEventListener?.('keydown', e => {
    if (e.key !== 'Escape' || !F.el || F.mode !== 'pseudo' || F.auto || F.o.esc === false || e.defaultPrevented || typing(e.target)) return;
    if (F.el.querySelector?.('.gs-noesc') || F.el.classList?.contains('gs-noesc')) return;
    exit({ user: true });
  });
  // значки кнопок ⛶ в разметке (шапка игры) — сразу SVG
  if (doc.readyState === 'loading') doc.addEventListener?.('DOMContentLoaded', syncBtns); else syncBtns();
  // Кнопки: data-gs-full / data-gs-rot = селектор того, что во весь экран (сначала среди предков кнопки)
  doc.addEventListener?.('click', e => {
    const b = e.target?.closest?.('[data-gs-full], [data-gs-rot]'); if (!b) return;
    const rot = b.hasAttribute('data-gs-rot'), sel = (rot ? b.dataset.gsRot : b.dataset.gsFull) || '.gs-fs';
    let el = null; try { el = b.closest(sel) || doc.querySelector(sel); } catch (er) {}
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const o = { esc: b.dataset.gsEsc !== '0', exitBtn: b.dataset.gsExitbtn === '1' };
    if (rot) rotate(el, o); else toggle(el, o);
  });

  root.D37Full = {
    enter, exit: () => exit({ user: true }), toggle, rotate,
    // Открыта игра el (или null — закрыта): включает «повернул телефон — во весь экран»
    auto(el){ F.autoEl = el || null; F.autoOff = false; if (!el && F.auto) exit({ noHist: true }); check(); },
    // Игру закрывают (обычно переходом на другой адрес): если она (или что-то в ней) во весь экран — выйти, историю не трогая
    release(el){ if (F.autoEl && el && (F.autoEl === el || el.contains?.(F.autoEl))) F.autoEl = null; if (F.el && el && (F.el === el || el.contains?.(F.el))) exit({ noHist: true }); },
    active: () => F.el,
    contains: el => !!(F.el && el && (F.el === el || F.el.contains?.(el))),
    state: () => ({ el: F.el, mode: F.mode, auto: F.auto, hist: F.hist, locked: F.locked, autoOff: F.autoOff, autoEl: F.autoEl, compact: de().classList.contains('gs-compact') }),
    supported: apiOk, isPhone: phone, isTouch: touch, isLandscape: landscape, ios,
    on(f){ F.subs.add(f); return () => F.subs.delete(f); },
    // HTML кнопки ⛶ с верным значком сразу (sel — что во весь экран; o: { cls, label, esc: false })
    btn(sel, o = {}){
      const on = btnOn(), lbl = o.label ? ` data-gs-label="${o.label}"` : '';
      return `<button type="button" class="${o.cls || ''}${on ? ' on' : ''}" data-gs-full="${sel}"${o.esc === false ? ' data-gs-esc="0"' : ''}${lbl} title="${on ? 'Выйти из полноэкранного режима' : 'Во весь экран'}" aria-pressed="${on}">${on ? ICON_OUT : ICON_IN}${o.label ? `<span> ${on ? 'Обычный экран' : o.label}</span>` : ''}</button>`;
    },
    rotBtn: (sel, o = {}) => `<button type="button" class="gs-rotbtn ${o.cls || ''}" data-gs-rot="${sel}" title="Повернуть экран: игра горизонтально и во весь экран" aria-label="Повернуть экран">🔄</button>`,
    icon: on => on ? ICON_OUT : ICON_IN,
    sync: syncBtns,
  };
})();

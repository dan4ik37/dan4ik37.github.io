// ═══════════════════════════════════════
//  НАСТРОЙКИ (D37Settings) — одно окно «⚙️ Настройки» для «Мира Денчика», «Студии 3D», всех игр и сайта
// ═══════════════════════════════════════
// Хранилище — localStorage d37_settings (один JSON). Старые ключи (d37_gfx, d37_fsr, d37_keys, d37_games_mute, d37_cam_sens,
// d37_cam_motion, d37_world_2d) при первой загрузке переносятся сюда и дальше остаются ЗЕРКАЛОМ: их читает движок (render.js,
// controls.js, synth.js, camera.js) и старый код — set() пишет оба места, get() верит старому ключу, если он есть.
// D37Settings.get(k) / set(k, v) / reset() / on(fn) → отписка; событие window 'd37:settings' { key, value, old }.
// Сразу «на живую»: window.D37Opt — числа для движка (чувствительность, инверсия, FOV, громкости, FSR, тени, левша…; rev
// растёт при каждой правке — движок сверяет rev и подхватывает сам, без подписок), CSS-переменные --gs-ui / --gs-touch /
// --gs-touch-a и классы html.gs-lefty / gs-notags / gs-nobub. Клавиши меняет controls.js (C.set) — живые управления
// перечитывают их по D37Opt.keysRev.
// Окно: D37Settings.open({ tab, ctx: 'engine' | 'game' | 'site', onClose }) / close() / isOpen(). Игра со своими действиями
// регистрирует контекст: off = D37Settings.context({ engine: true, gfx(), world2d(v), view(v), onClose() }) — «качество»
// пересобирает мир, «вид» переключает камеру, onClose — сбросить нажатия (Esc закрыл окно — меню игры не открывать).
// Свои вкладки (телефон и т. п.): D37Settings.addTab({ id, icon, title, order, ctx: ['engine','game','site'], when(cx) — показывать ли сейчас,
// render(el, S), keys: [значения для «↺ Сбросить» этой вкладки], reset() — своё «как было» }) и свои значения: D37Settings.define(key, { def, list | bool | min/max | obj }).
// T-043 (владелец 22.10: «Сделай понятнее и лучше настройки»): первая вкладка «⭐ Главное» — самое нужное из других вкладок (строки —
// D37Settings.addMain({ id, order, ctx, when(cx), html(cx) }), те же data-set / data-sw / data-range, что во вкладках); у каждой строки —
// простое название и подсказка в одну строку; «🔍 Найти настройку» в шапке — рисует все вкладки места сразу и оставляет строки, где есть
// все слова (название, подсказка, варианты, data-words; окончания слов не важны); «↺ Сбросить» внизу — текущую вкладку (её keys / reset),
// на «Главном» — всё. Стрелки и геймпад: ↑↓ (крестовина, стик) — по строкам, ←→ — ползунок / соседняя кнопка, Ⓐ — нажать (при
// отпускании — игра под окном не «прыгнет»), Ⓑ — назад, LB/RB — вкладки; на телефоне — крупные кнопки и прокрутка без размытия под окном.
// Меню паузы для игр: D37Settings.menu(parent, { title, sub, items: [{ id, icon, text, primary, warn }], onPick(id), onClose }) — одно меню
// на игру («Мир Денчика», «Кубомир», «Подземье»: ☰ на экране и Esc / Start открывают его же); пункты про экран одинаковые везде:
// ...D37Settings.fsItems(el) («⛶ Во весь экран» / «Обычный экран» и на телефоне стоя «🔄 Повернуть экран») + в onPick
// D37Settings.fsPick(id, el, меню) → true, если это был он (уже сделано).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const doc = root.document;
  if (root.D37Settings) return;
  const STORE = 'd37_settings';
  const lsGet = k => { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (!root.localStorage) return; if (v === null || v === undefined) root.localStorage.removeItem(k); else root.localStorage.setItem(k, String(v)); } catch (e) {} };
  const num = v => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : undefined; };
  const clone = v => v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Тема сайта (T-086): по умолчанию — та, что знает скрипт темы в <head> (data-theme-def); светлую выключает THEME_LIGHT (config.js)
  const THEMES = ['auto', 'dark', 'light'];
  const themeDef = () => { const v = doc?.documentElement?.getAttribute?.('data-theme-def'); return THEMES.includes(v) ? v : 'dark'; };
  const themeOn = () => { try { return typeof THEME_LIGHT === 'undefined' || !!THEME_LIGHT; } catch (e) { return true; } };

  // ═══ Что есть (по умолчанию — как было до окна настроек) ═══
  const SCHEMA = {
    // Сайт
    theme: { def: themeDef(), list: THEMES },
    // Графика
    gfx: { def: 'auto', list: ['auto', 'low', 'mid', 'high'] },
    fsr: { def: 'auto', list: ['auto', 'native', 'quality', 'balanced', 'performance'] },
    shadows: { def: true, bool: 1 },
    fps: { def: false, bool: 1 },
    world2d: { def: false, bool: 1 },
    // Звук
    mute: { def: false, bool: 1 },
    vol: { def: 100, min: 0, max: 100 },
    volFx: { def: 100, min: 0, max: 100 },
    volAmb: { def: 100, min: 0, max: 100 },
    volVoice: { def: 100, min: 0, max: 100 },
    // Управление
    keys: { def: {}, obj: 1 },
    sens: { def: 1, min: .2, max: 3 },
    invertY: { def: false, bool: 1 },
    touchSize: { def: 100, min: 70, max: 150 },
    touchAlpha: { def: 100, min: 30, max: 100 },
    lefty: { def: false, bool: 1 },
    // Камера
    view: { def: 'third', list: ['third', 'first'] },
    zoomFirst: { def: true, bool: 1 },   // приблизил до упора — от 1-го лица (camera.js rig.autoFirst)
    fov: { def: 50, min: 40, max: 80 },
    motion: { def: 1, min: 0, max: 1 },
    shake: { def: true, bool: 1 },
    // Интерфейс
    uiScale: { def: 100, min: 80, max: 130 },
    tags: { def: true, bool: 1 },
    bubbles: { def: true, bool: 1 },
    autoFull: { def: false, bool: 1 },
    autoLand: { def: true, bool: 1 },
  };
  // Старые ключи: как читать и как писать (null — удалить ключ: «как по умолчанию»)
  const b01 = { read: v => v === '1' ? true : v === '0' ? false : undefined, write: v => v ? '1' : null };
  const LEG = {
    gfx: { k: 'd37_gfx', read: v => ['low', 'mid', 'high'].includes(v) ? v : undefined, write: v => v === 'auto' ? null : v },
    fsr: { k: 'd37_fsr', read: v => ['native', 'quality', 'balanced', 'performance'].includes(v) ? v : undefined, write: v => v === 'auto' ? null : v },
    world2d: { k: 'd37_world_2d', ...b01 },
    mute: { k: 'd37_games_mute', ...b01 },
    keys: { k: 'd37_keys', read: v => { try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : undefined; } catch (e) { return undefined; } }, write: v => v && Object.keys(v).length ? JSON.stringify(v) : null },
    sens: { k: 'd37_cam_sens', read: num, write: v => v === 1 ? null : String(v) },
    motion: { k: 'd37_cam_motion', read: num, write: v => v === 1 ? null : String(v) },
    // тему читает скрипт в <head> (index.html, серверные страницы) — до первого кадра, без вспышки
    theme: { k: 'd37_theme', read: v => THEMES.includes(v) ? v : undefined, write: v => v === themeDef() ? null : v },
  };
  // «↺ Сбросить всё» — про игры (графика, звук, клавиши…): тему сайта не трогает
  const KEEP_ON_RESET = ['theme'];
  function clean(k, v){
    const s = SCHEMA[k];
    if (s.list) return s.list.includes(v) ? v : s.def;
    if (s.bool) return typeof v === 'boolean' ? v : v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : s.def;
    if (s.obj) {
      const out = {};
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [a, b] of Object.entries(v).slice(0, 80)) if (/^[a-z0-9_]{1,24}$/i.test(a) && Array.isArray(b)) out[a] = [String(b[0] || '').slice(0, 24), String(b[1] || '').slice(0, 24)];
      return out;
    }
    const n = num(v); if (n === undefined) return clone(s.def);
    return Math.round(Math.min(s.max, Math.max(s.min, n)) * 1000) / 1000;
  }

  // ═══ Хранилище + перенос старых ключей ═══
  let data = {};
  try { const o = JSON.parse(lsGet(STORE) || '{}'); if (o && typeof o === 'object' && !Array.isArray(o)) data = o; } catch (e) {}
  const save = () => lsSet(STORE, JSON.stringify(data));
  function migrate(){
    let ch = false;
    for (const [k, L] of Object.entries(LEG)) {
      const raw = lsGet(L.k);
      if (raw != null) {
        const v = L.read(raw);
        if (v !== undefined) { const c = clean(k, v); if (!same(data[k], c)) { data[k] = c; ch = true; } }
        continue;
      }
      // старого ключа нет, а здесь своё значение — вернуть зеркало (его читает движок)
      if (k in data) { const c = clean(k, data[k]); if (!same(c, SCHEMA[k].def)) lsSet(L.k, L.write(c)); }
    }
    if (data._v !== 1) { data._v = 1; ch = true; }
    if (ch) save();
  }
  function get(k){
    const s = SCHEMA[k]; if (!s) return undefined;
    const L = LEG[k];
    if (L) { const raw = lsGet(L.k); if (raw != null) { const v = L.read(raw); if (v !== undefined) return clean(k, v); } }
    return k in data ? clean(k, data[k]) : clone(s.def);
  }
  let keysRev = 1;
  function set(k, v, o = {}){
    const s = SCHEMA[k]; if (!s) return false;
    const c = clean(k, v), old = get(k);
    data[k] = c; save();
    if (LEG[k]) lsSet(LEG[k].k, LEG[k].write(c));
    if (k === 'keys') keysRev++;
    apply();
    if (k === 'fps') { const P = root.D37E?.perf; if (P && !!P.on !== c) P.toggle(c); }
    if (!same(old, c)) emit({ key: k, value: c, old, ui: !!o.ui });
    return true;
  }
  function reset(){
    for (const [k, L] of Object.entries(LEG)) if (!KEEP_ON_RESET.includes(k)) lsSet(L.k, null);
    const keep = {}; for (const k of KEEP_ON_RESET) if (k in data) keep[k] = data[k];
    data = { _v: 1, ...keep }; save(); keysRev++;
    apply();
    const P = root.D37E?.perf; if (P?.on) P.toggle(false);
    emit({ key: '*' });
  }
  // «↺ Сбросить» одной вкладки: только её значения — как reset(), но выборочно (событие тоже «*», в keys — что сбросили)
  function resetKeys(keys, o = {}){
    const list = (keys || []).filter(k => SCHEMA[k]);
    if (!list.length) return [];
    for (const k of list) { delete data[k]; if (LEG[k]) lsSet(LEG[k].k, null); }
    if (list.includes('keys')) keysRev++;
    save(); apply();
    if (list.includes('fps')) { const P = root.D37E?.perf; if (P?.on) P.toggle(false); }
    emit({ key: '*', keys: list.slice(), ui: !!o.ui });
    return list;
  }
  // Ключи сменил controls.js (C.set пишет d37_keys) — переложить в хранилище и сказать живым управлениям
  function keysChanged(){ data.keys = clean('keys', LEG.keys.read(lsGet(LEG.keys.k) || '{}') || {}); save(); keysRev++; apply(); emit({ key: 'keys', value: data.keys }); }

  // ═══ «На живую»: числа для движка, CSS-переменные и классы ═══
  function apply(){
    const O = root.D37Opt || (root.D37Opt = { rev: 0 });
    Object.assign(O, {
      sens: get('sens'), invertY: get('invertY'), motion: get('motion'), shake: get('shake'), fovAdd: get('fov') - 50, view: get('view'), zoomFirst: get('zoomFirst'),
      fsr: get('fsr'), shadows: get('shadows'), fps: get('fps'),
      mute: get('mute'), vol: get('vol') / 100, volFx: get('volFx') / 100, volAmb: get('volAmb') / 100, volVoice: get('volVoice') / 100,
      lefty: get('lefty'), keysRev,
    });
    O.rev++;
    const h = doc?.documentElement; if (!h) return;
    h.style.setProperty('--gs-ui', String(get('uiScale') / 100));
    h.style.setProperty('--gs-touch', String(get('touchSize') / 100));
    h.style.setProperty('--gs-touch-a', String(get('touchAlpha') / 100));
    h.classList.toggle('gs-lefty', get('lefty'));
    h.classList.toggle('gs-notags', !get('tags'));
    h.classList.toggle('gs-nobub', !get('bubbles'));
    applyTheme();
  }
  // Тема: «Авто» — как в системе (и меняется вместе с ней); выключена светлая (THEME_LIGHT) — только тёмная
  let sysLight = null, themeNow = null;
  function themeEff(){
    if (!themeOn()) return 'dark';
    const t = get('theme');
    return t === 'auto' ? (sysLight?.matches ? 'light' : 'dark') : t;
  }
  function applyTheme(){
    const h = doc?.documentElement; if (!h) return;
    if (!sysLight && root.matchMedia) { try { sysLight = root.matchMedia('(prefers-color-scheme: light)'); sysLight.addEventListener?.('change', () => { if (get('theme') === 'auto') applyTheme(); }); } catch (e) {} }
    if (!themeOn()) lsSet(LEG.theme.k, null);
    const eff = themeEff();
    if (eff === 'light') h.setAttribute?.('data-theme', 'light'); else h.removeAttribute?.('data-theme');
    if (themeNow !== null && themeNow !== eff) { try { root.dispatchEvent(new root.CustomEvent('d37:theme', { detail: eff })); } catch (e) {} }
    themeNow = eff;
  }
  const subs = new Set();
  function emit(d){
    for (const f of [...subs]) { try { f(d); } catch (e) { console.error(e); } }
    try { root.dispatchEvent(new root.CustomEvent('d37:settings', { detail: d })); } catch (e) {}
    if (win && !d.ui) renderBody();
  }
  migrate(); apply();

  // ═══ Контекст открытой игры (её действия для окна) ═══
  let ctx = null;
  function context(c){
    ctx = c || null; const mine = ctx;
    if (win) renderAll();
    return () => { if (ctx === mine) { ctx = null; if (win) renderAll(); } };
  }

  // ═══ Окно ═══
  const TABS = [
    { id: 'main', icon: '⭐', title: 'Главное', order: 0, ctx: ['engine', 'game', 'site'], render: tabMain },
    { id: 'gfx', icon: '🎨', title: 'Графика', order: 10, ctx: ['engine', 'site'], render: tabGfx, keys: ['gfx', 'fsr', 'shadows', 'fps', 'world2d'] },
    { id: 'sound', icon: '🔊', title: 'Звук', order: 20, ctx: ['engine', 'game', 'site'], render: tabSound, keys: ['mute', 'vol', 'volFx', 'volAmb', 'volVoice'] },
    { id: 'controls', icon: '🎮', title: 'Управление', order: 30, ctx: ['engine', 'site'], render: tabControls, keys: ['sens', 'invertY', 'touchSize', 'touchAlpha', 'lefty', 'keys'] },
    { id: 'camera', icon: '🎥', title: 'Камера', order: 40, ctx: ['engine', 'site'], render: tabCamera, keys: ['view', 'zoomFirst', 'fov', 'motion', 'shake'] },
    { id: 'ui', icon: '🧩', title: 'Интерфейс', order: 50, ctx: ['engine', 'game', 'site'], render: tabUi, keys: ['uiScale', 'tags', 'bubbles', 'autoFull', 'autoLand'] },
    { id: 'site', icon: '🌐', title: 'Сайт', order: 90, ctx: ['engine', 'game', 'site'], render: tabSite },
  ];
  let win = null, cur = 'main', cx = 'site', opened = {}, capture = null, keyNote = '', padT = 0, sfxAt = 0, query = '', qWords = [];
  const tabsFor = () => TABS.filter(t => (!t.ctx || t.ctx.includes(cx)) && (!t.when || t.when(cx))).sort((a, b) => a.order - b.order);   // when(cx) — своё условие вкладки
  const tabKeys = t => (t?.keys || []).filter(k => SCHEMA[k]);
  const gameOpen = () => { try { return typeof gamesActive !== 'undefined' && !!gamesActive; } catch (e) { return false; } };   // gamesActive — games.js
  const mm = q => { try { return !!root.matchMedia?.(q)?.matches; } catch (e) { return false; } };

  function open(o = {}){
    if (!doc?.body) return;
    opened = o;
    cx = o.ctx || (ctx?.engine ? 'engine' : gameOpen() ? 'game' : 'site');
    const list = tabsFor();
    cur = list.some(t => t.id === o.tab) ? o.tab : 'main';   // по умолчанию — «⭐ Главное»
    if (!list.some(t => t.id === cur)) cur = list[0]?.id;
    keyNote = ''; ctlFail = false; query = ''; qWords = [];   // клавиши не загрузились — при новом открытии попробовать снова
    if (!win) {
      win = doc.createElement('div'); win.className = 'gs-set'; win.id = 'gsSettings';
      win.setAttribute('role', 'dialog'); win.setAttribute('aria-modal', 'true'); win.setAttribute('aria-label', 'Настройки');
      win.innerHTML = `<div class="gs-set-box">
          <div class="gs-set-head"><b class="gs-set-title">⚙️ Настройки</b><small>сохраняются сами</small>
            <label class="gs-set-search"><span aria-hidden="true">🔍</span><input type="search" class="gs-set-find" placeholder="Найти настройку…" aria-label="Найти настройку" autocomplete="off" spellcheck="false" enterkeyhint="search"></label>
            <button type="button" class="gs-set-x" data-gs="close" aria-label="Закрыть">✕</button></div>
          <div class="gs-set-main"><div class="gs-set-tabs" role="tablist" aria-orientation="vertical"></div><div class="gs-set-body" role="tabpanel"></div></div>
          <div class="gs-set-foot"><button type="button" class="gs-btn ghost" data-gs="reset">↺ Сбросить всё</button><span class="gs-grow"></span><button type="button" class="gs-btn primary" data-gs="close">Готово</button></div>
        </div>`;
      win.addEventListener('click', onClick);
      win.addEventListener('input', onInput);
      win.addEventListener('change', onChange);
      win.addEventListener('keydown', onWinKey);
      win.addEventListener('pointerdown', e => { win?.querySelector('.gs-set-box')?.classList.remove('gs-pad'); if (e.target === win) close(); });
      doc.body.appendChild(win);
      root.addEventListener('keydown', onKey, true);
      doc.documentElement.classList.add('gs-set-open');
    } else { const f = win.querySelector('.gs-set-find'); if (f) f.value = ''; }
    renderAll();
    // компьютер — сразу в поиск (печатай и найдёшь); палец — без клавиатуры на пол-экрана
    const touch = mm('(pointer: coarse)') || 'ontouchstart' in root;
    (touch ? win.querySelector('.gs-set-x') : win.querySelector('.gs-set-find'))?.focus({ preventScroll: true });
    padWake();
  }
  function close(){
    if (!win) return;
    stopCapture();
    root.removeEventListener('keydown', onKey, true);
    win.remove(); win = null; query = ''; qWords = [];
    doc.documentElement.classList.remove('gs-set-open');
    const f1 = opened.onClose, f2 = ctx?.onClose; opened = {};
    try { f1?.(); } catch (e) { console.error(e); }
    try { if (f2 !== f1) f2?.(); } catch (e) { console.error(e); }
    // под окном — меню игры: фокус в него (клавиатура и геймпад продолжают там)
    const m = topMenu(); if (m) (m.el.querySelector('[data-mi="settings"]') || m.el.querySelector('.gs-menu-it'))?.focus({ preventScroll: true });
  }
  function renderAll(){
    if (!win) return;
    const list = tabsFor();
    if (!list.some(t => t.id === cur)) cur = list[0]?.id;
    const tabs = win.querySelector('.gs-set-tabs'), on = t => !query && t.id === cur;
    tabs.innerHTML = list.map(t => `<button type="button" role="tab" aria-selected="${on(t)}" class="${on(t) ? 'on' : ''}" data-tab="${t.id}"><span aria-hidden="true">${t.icon}</span>${esc(t.title)}</button>`).join('');
    // вкладки строкой (телефон) — выбранную в середину полосы
    const b = tabs.querySelector('.on');
    if (b && tabs.scrollWidth > tabs.clientWidth + 2) tabs.scrollLeft = Math.max(0, b.offsetLeft - (tabs.clientWidth - b.offsetWidth) / 2);
    renderBody();
  }
  function renderBody(){
    if (!win) return;
    const body = win.querySelector('.gs-set-body'), keep = focusSig(body);
    const top = body.scrollTop;
    body.innerHTML = '';
    body.onclick = body.onchange = body.oninput = null;   // свои обработчики вкладки (Кубомир, Подземье) — только её
    if (query) renderSearch(body);
    else {
      const t = TABS.find(x => x.id === cur);
      if (t) {
        try {
          const html = t.render(body, API);
          if (typeof html === 'string') body.innerHTML = html;
        } catch (e) { console.error(e); body.innerHTML = '<p class="gs-note">Не получилось показать эту вкладку.</p>'; }
      }
    }
    body.scrollTop = top;
    syncFoot();
    focusBack(body, keep);
  }
  // «↺ Сбросить» внизу: на «Главном» — всё; во вкладке с keys / reset — только её; поиск и вкладки без своих значений — без кнопки
  function syncFoot(){
    const b = win?.querySelector('[data-gs="reset"]'); if (!b) return;
    const t = TABS.find(x => x.id === cur);
    if (query) { b.hidden = true; return; }
    b.hidden = false;
    if (cur === 'main') { b.textContent = '↺ Сбросить всё'; b.dataset.scope = 'all'; b.title = 'Все настройки — как было'; }
    else if (t && (tabKeys(t).length || t.reset)) { b.textContent = '↺ Сбросить вкладку'; b.dataset.scope = 'tab'; b.title = `Настройки вкладки «${t.title}» — как было`; }
    else b.hidden = true;
  }
  // фокус после перерисовки — на том же (клавиатура, геймпад и экранные читалки не теряют место)
  const SIG = ['data-set', 'data-sw', 'data-range', 'data-key', 'data-keyreset', 'data-keysall', 'data-site', 'data-tab'];
  const qa = v => String(v).replace(/["\\]/g, '\\$&');
  function focusSig(box){
    const a = doc.activeElement; if (!a || !box.contains(a)) return null;
    for (const k of SIG) if (a.hasAttribute?.(k)) return `[${k}="${qa(a.getAttribute(k))}"]` + (a.dataset?.v != null ? `[data-v="${qa(a.dataset.v)}"]` : '');
    return null;
  }
  function focusBack(box, sel){ if (!sel) return; let e = null; try { e = box.querySelector(sel); } catch (er) {} if (e && doc.activeElement !== e) try { e.focus({ preventScroll: true }); } catch (er) {} }

  // ── Поиск: все вкладки места сразу (по секциям), видны строки, где есть все слова ──
  const norm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.,:;!?()…—–\-/]+/g, ' ');
  // Слово запроса найдено: само (от 4 букв — в любом месте, короче — с начала слова) или его основа без окончания — с начала
  // слова («теней» → «тен…» → «Тени», «звука» → «Звук», «кнопок» → «Кнопки»); основа не короче 3 букв (иначе «гро» нашло бы «игроков»)
  const ENDS = ['ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ов', 'ев', 'ок', 'ек', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем', 'ть', 'ь', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю'];
  function hasWord(text, w){
    const t = ' ' + text;
    if (w.length >= 4 ? t.includes(w) : t.includes(' ' + w)) return true;
    // основа и (если длинная) без ещё одной буквы — беглые гласные: «кнопки» → «кнопк» → «кноп…» = «кнопок»
    for (const e of ENDS) if (w.length - e.length >= 3 && w.endsWith(e)) { const st = w.slice(0, -e.length); return t.includes(' ' + st) || (st.length >= 5 && t.includes(' ' + st.slice(0, -1))); }
    return false;
  }
  const matchText = (text, words) => words.every(w => hasWord(text, w));
  function setQuery(v){
    const q = norm(v).trim().replace(/\s+/g, ' ');
    if (q === query) return;
    const was = !!query;
    query = q; qWords = q ? q.split(' ') : [];
    stopCapture(); keyNote = '';
    if (!q) { renderAll(); return; }
    if (!was) { renderAll(); return; }   // начали искать — нарисовать все вкладки
    filterSearch(win.querySelector('.gs-set-body'));
  }
  function renderSearch(body){
    for (const t of tabsFor()) {
      if (t.id === 'main') continue;   // «Главное» — то же, что во вкладках
      const sec = doc.createElement('section'); sec.className = 'gs-sres'; sec.dataset.tab = t.id;
      sec.innerHTML = `<button type="button" class="gs-sres-h" data-tab="${t.id}" title="Открыть вкладку «${esc(t.title)}»"><span aria-hidden="true">${t.icon}</span>${esc(t.title)}<i aria-hidden="true">→</i></button>`;
      const box = doc.createElement('div'); box.className = 'gs-sres-b'; sec.appendChild(box);
      body.appendChild(sec);   // уже в документе: вкладки, которые догружают своё (телефон), дорисуют сами
      try { const html = t.render(box, API); if (typeof html === 'string') box.innerHTML = html; } catch (e) { console.error(e); sec.remove(); }
    }
    filterSearch(body);
  }
  const rowText = new WeakMap();
  function filterSearch(body){
    if (!body) return;
    let total = 0;
    for (const sec of body.querySelectorAll('.gs-sres')) {
      const title = norm(sec.firstElementChild?.textContent || '');
      let n = 0;
      for (const r of sec.querySelectorAll('.gs-row, .gs-krow')) {
        let tx = rowText.get(r);
        if (tx === undefined) { tx = norm(r.textContent + ' ' + (r.dataset.words || '') + ' ' + title); rowText.set(r, tx); }
        const hit = matchText(tx, qWords);
        r.hidden = !hit; if (hit) n++;
      }
      for (const g of sec.querySelectorAll('.gs-keyg')) g.hidden = !g.querySelector('.gs-krow:not([hidden])');
      sec.hidden = !n; total += n;
    }
    let empty = body.querySelector('.gs-sempty');
    if (!total) {
      if (!empty) { empty = doc.createElement('p'); empty.className = 'gs-note gs-sempty'; body.appendChild(empty); }
      empty.textContent = `Ничего не нашлось по «${query}». Попробуй другое слово: «громкость», «тени», «кнопки», «клавиши».`;
    } else empty?.remove();
  }

  // ── Строки ──
  const FMT = { vol: v => v + '%', volFx: v => v + '%', volAmb: v => v + '%', volVoice: v => v + '%', sens: v => Math.round(v * 100) + '%', motion: v => Math.round(v * 100) + '%',
    fov: v => `${v}° <small>(от 1-го лица ${v + 22}°)</small>`, uiScale: v => v + '%', touchSize: v => v + '%', touchAlpha: v => v + '%' };
  // row(название, управление, подсказка, { dis, cls, words — ещё слова для поиска })
  const row = (label, ctl, hint, o = {}) => `<div class="gs-row${o.cls ? ' ' + o.cls : ''}${o.dis ? ' dis' : ''}"${o.words ? ` data-words="${esc(o.words)}"` : ''}><div class="gs-lbl">${label ? `<b>${label}</b>` : ''}${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
  const seg = (k, opts, o = {}) => `<div class="gs-seg" role="radiogroup"${o.label ? ` aria-label="${esc(o.label)}"` : ''}>${opts.map(([v, t]) => { const on = (o.cur ?? get(k)) === v; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-set="${k}" data-v="${esc(v)}"${o.dis ? ' disabled' : ''}>${t}</button>`; }).join('')}</div>`;
  const sw = (k, o = {}) => { const on = o.inv ? !get(k) : !!get(k); return `<label class="gs-sw"><input type="checkbox" data-sw="${k}"${o.inv ? ' data-inv="1"' : ''}${on ? ' checked' : ''}${o.dis ? ' disabled' : ''}${o.label ? ` aria-label="${esc(o.label)}"` : ''}><i aria-hidden="true"></i></label>`; };
  const range = (k, min, max, step, mul = 1, o = {}) => `<div class="gs-range${o.dis ? ' dis' : ''}"><input type="range" min="${min}" max="${max}" step="${step}" value="${Math.round(get(k) * mul)}" data-range="${k}" data-mul="${mul}" aria-label="${esc(o.label || k)}"><output data-out="${k}">${FMT[k] ? FMT[k](get(k)) : get(k)}</output></div>`;
  const head = t => `<div class="gs-sec">${t}</div>`;
  const note = t => `<p class="gs-note">${t}</p>`;
  const VIEWS = [['third', 'От 3-го лица'], ['first', 'От 1-го лица']];

  // ── «⭐ Главное»: самое нужное из других вкладок (строки — addMain) ──
  const MAIN = [];
  function addMain(m){
    if (!m?.id || typeof m.html !== 'function') return root.D37Settings;
    const it = { order: 50, ...m }, i = MAIN.findIndex(x => x.id === m.id);
    if (i >= 0) MAIN[i] = it; else MAIN.push(it);
    if (win && cur === 'main' && !query) renderBody();
    return root.D37Settings;   // при загрузке файла API ещё нет — вызовы цепочкой только снаружи
  }
  function tabMain(){
    const list = MAIN.filter(m => (!m.ctx || m.ctx.includes(cx)) && (!m.when || m.when(cx))).sort((a, b) => a.order - b.order);
    let h = '';
    for (const m of list) { try { h += m.html(cx, API) || ''; } catch (e) { console.error(e); } }
    return (h || note('Здесь пока нечего настраивать.')) + note('Остальное — в других вкладках. Не можешь найти — 🔍 поиск вверху окна.');
  }
  const volRow = () => {
    const m = get('mute');
    return row('Громкость', `<div class="gs-vol">${sw('mute', { inv: true, label: 'Звук в играх' })}${range('vol', 0, 100, 5, 1, { dis: m, label: 'Громкость' })}</div>`,
      m ? 'Звук игр выключен — включи переключателем.' : 'Всех звуков игр (по отдельности — «🔊 Звук»).', { words: 'звук громко тихо выключить тишина' });
  };
  function perfRow(){
    const perf = typeof currentPerf !== 'undefined' ? currentPerf : null;   // performance-mode.js
    return row('Режим сайта', `<div class="gs-seg" role="radiogroup" aria-label="Режим сайта">${[['low', '🐢 Слабое'], ['high', '🚀 Мощное']].map(([v, t]) => `<button type="button" role="radio" class="${perf === v ? 'on' : ''}" aria-checked="${perf === v}" data-site="perf:${v}">${t}</button>`).join('')}</div>`,
      'Анимации сайта: «Слабое» — быстрее на старых телефонах.', { words: 'анимации эффекты медленно тормозит производительность' });
  }
  // Тема сайта (T-086): «Авто» — как в системе; игры, телефон и студии остаются тёмными
  const themeRow = () => themeOn() ? row('Тема сайта', seg('theme', [['auto', '🌓 Авто'], ['dark', '🌙 Тёмная'], ['light', '☀️ Светлая']], { label: 'Тема сайта' }),
    get('theme') === 'auto' ? `Как в системе — сейчас ${themeEff() === 'light' ? 'светлая' : 'тёмная'}. Игры остаются тёмными.` : 'Цвет страниц сайта. Игры, телефон и студии остаются тёмными.',
    { words: 'светлая темная ночная дневная оформление цвет белая черная фон' }) : '';
  addMain({ id: 'theme', order: 55, ctx: ['site'], html: themeRow });
  addMain({ id: 'sens', order: 30, ctx: ['engine', 'site'], html: () => row('Чувствительность мыши и пальца', range('sens', 20, 300, 5, 100, { label: 'Чувствительность' }), 'Как быстро поворачивается камера.', { words: 'мышь мышка палец сенсор поворот обзор' }) });
  addMain({ id: 'vol', order: 40, html: volRow });
  addMain({ id: 'ui', order: 45, ctx: ['game'], html: () => row('Размер кнопок и надписей', range('uiScale', 80, 130, 5, 1, { label: 'Размер кнопок и надписей' }), 'Панели и подсказки игр крупнее или мельче.', { words: 'масштаб крупнее мельче шрифт' }) });
  addMain({ id: 'view', order: 50, ctx: ['engine', 'site'], html: () => row('Вид камеры', seg('view', VIEWS, { label: 'Вид камеры' }), 'Каким начинать в 3D. В игре — клавиша V.', { words: 'первое третье лицо от первого глазами' }) });
  addMain({ id: 'perf', order: 60, ctx: ['site'], html: perfRow });

  // ── Вкладки ──
  function liveR(){ try { return ctx?.R?.() || null; } catch (e) { return null; } }
  // запасная «Графика» (если js/core/gfx-settings.js не загрузился — обычно её заменяет он)
  function tabGfx(){
    const R = liveR(), E = root.D37E, autoQ = E?.quality ? E.quality() : null, qn = { low: 'низкое', mid: 'среднее', high: 'высокое' };
    const q = R ? R.q : get('gfx') === 'auto' ? autoQ : get('gfx'), low = q === 'low';
    const now = R ? `Сейчас: ${qn[R.q] || R.q}. ` : autoQ && get('gfx') === 'auto' ? `Для этого устройства: ${qn[autoQ]}. ` : '';
    return head('3D-миры: «Мир Денчика», «Студия 3D»')
      + row('Качество графики', seg('gfx', [['auto', 'Авто'], ['low', 'Низкое'], ['mid', 'Среднее'], ['high', 'Высокое']]),
        now + 'Низкое — для слабых телефонов, высокое — мягкие тени.' + (ctx?.gfx ? ' Мир перезагрузится.' : ''), { words: 'качество графика лагает тормозит производительность' })
      + row('Размер кадра', seg('fsr', [['auto', 'Авто'], ['native', '100%'], ['quality', 'Качество'], ['balanced', 'Баланс'], ['performance', 'Скорость']], { dis: low }),
        low ? 'На низком качестве — всегда 100%.' : 'Кадр меньше экрана — игра быстрее (FSR 1).', { dis: low, words: 'разрешение fsr апскейл' })
      + row('Тени', sw('shadows', { dis: low, label: 'Тени' }), low ? 'На низком качестве теней нет.' : 'Выключи, если 3D тормозит.', { dis: low })
      + row('Счётчик кадров (FPS)', sw('fps', { label: 'Счётчик кадров' }), 'Кадры в секунду поверх 3D (клавиша F3).', { words: 'fps лаги' })
      + row('Плоский «Мир Денчика»', sw('world2d', { label: 'Плоский мир' }), 'Мир без 3D — для очень слабых телефонов.', { words: '2d плоский' });
  }
  function tabSound(){
    const m = get('mute'), dis = { dis: m };
    return row('Звук в играх', sw('mute', { inv: true, label: 'Звук в играх' }), m ? 'Сейчас выключен.' : 'Выключить все звуки игр сразу (кнопка 🔊 — тоже).', { words: 'выключить тишина mute' })
      + row('Общая громкость', range('vol', 0, 100, 5, 1, { label: 'Общая громкость' }), 'Громкость всех звуков игр.', dis)
      + row('Эффекты', range('volFx', 0, 100, 5, 1, { label: 'Громкость эффектов' }), 'Шаги, прыжки, кнопки, звуки мини-игр.', { dis: m, words: 'громкость' })
      + row('Окружение', range('volAmb', 0, 100, 5, 1, { label: 'Громкость окружения' }), 'Вода, огонь, ветер в 3D-мирах.', { dis: m, words: 'громкость фон' })
      + row('Голос', range('volVoice', 0, 100, 5, 1, { label: 'Громкость голоса' }), 'Звонки и голосовой чат (слышно и без звука игр).', { words: 'громкость звонок микрофон собеседник' });
  }
  function tabControls(body){
    const touchDev = !!root.D37Full?.isTouch?.();
    let html = row('Чувствительность мыши и пальца', range('sens', 20, 300, 5, 100, { label: 'Чувствительность' }), 'Как быстро поворачивается камера.', { words: 'мышь мышка палец сенсор поворот обзор' })
      + row('Инверсия по вертикали', sw('invertY', { label: 'Инверсия по вертикали' }), 'Мышь вверх — камера вниз.', { words: 'инвертировать перевернуть' })
      + head('Кнопки на экране телефона')
      + row('Размер кнопок', range('touchSize', 70, 150, 5, 1, { label: 'Размер кнопок' }), 'Крупнее — легче попасть пальцем.', { words: 'телефон сенсор' })
      + row('Непрозрачность кнопок', range('touchAlpha', 30, 100, 5, 1, { label: 'Непрозрачность кнопок' }), 'Меньше — кнопки прозрачнее, мир виднее.', { words: 'прозрачность телефон' })
      + row('Для левши', sw('lefty', { label: 'Для левши' }), 'Джойстик — справа, кнопки — слева.', { words: 'левая рука левша' })
      + (root.D37TouchLayout?.settingsRow ? root.D37TouchLayout.settingsRow() : '')   // «🎮 Настроить кнопки» (js/core/touch-layout.js, кнопку ловит он же)
      + head('Клавиши' + (touchDev ? ' <small>(клавиатура и геймпад)</small>' : ''));
    const C = ctl();
    if (!C && ctlFail) return html + note('Список клавиш не загрузился — проверь интернет и открой окно ещё раз.');
    if (!C) { html += note('⏳ Загружаем список клавиш…'); loadControls().then(ok => { if (!ok) ctlFail = true; if (win && (cur === 'controls' || query)) renderBody(); }); return html; }
    html += keysHtml(C);
    return html;
  }
  function tabCamera(){
    return row('Вид камеры', seg('view', VIEWS, { label: 'Вид камеры' }), 'Каким начинать в 3D. В игре — клавиша V.', { words: 'первое третье лицо от первого глазами' })
      + row('Приблизил до упора — от 1-го лица', sw('zoomFirst', { label: 'Приблизил до упора — от 1-го лица' }), 'Колесо, щипок или ↑ до конца — вид глазами персонажа.', { words: 'зум приближение колесо' })
      + row('Угол обзора', range('fov', 40, 80, 1, 1, { label: 'Угол обзора' }), 'Шире — видно больше, но всё мельче.', { words: 'fov обзор' })
      + row('Покачивание при ходьбе', range('motion', 0, 100, 5, 100, { label: 'Покачивание при ходьбе' }), 'Камера качается в такт шагам, на бегу шире обзор.', { words: 'тошнит укачивает' })
      + row('Тряска камеры', sw('shake', { label: 'Тряска камеры' }), 'От ударов, взрывов и жёсткого приземления.', { words: 'тошнит укачивает' });
  }
  function tabUi(){
    return row('Размер кнопок и надписей', range('uiScale', 80, 130, 5, 1, { label: 'Размер кнопок и надписей' }), 'Панели и подсказки игр крупнее или мельче.', { words: 'масштаб крупнее мельче шрифт' })
      + row('Ники над головами', sw('tags', { label: 'Ники над головами' }), 'Имена игроков над персонажами.', { words: 'имена подписи' })
      + row('Облачка сообщений', sw('bubbles', { label: 'Облачка сообщений' }), 'Сообщения чата и жителей над головами.', { words: 'чат пузыри' })
      + head('Полный экран')
      + row('Сразу во весь экран', sw('autoFull', { label: 'Сразу во весь экран' }), 'Игры открываются во весь экран. Выйти — ☰ Меню или Esc.', { words: 'полный экран fullscreen' })
      + row('Повернул телефон — во весь экран', sw('autoLand', { label: 'Повернул телефон — во весь экран' }), 'Телефон горизонтально — игра на весь экран, обратно — сайт.', { words: 'поворот горизонтально альбомная' })
      + (cx === 'game' ? note('Графика, управление и камера 3D — в «Мире Денчика» (☰ Меню → ⚙️ Настройки) или в меню сайта «Ещё → ⚙️ Настройки».') : '');
  }
  function tabSite(){
    const hasPush = typeof togglePush === 'function', pushOn = typeof pushSubscribed !== 'undefined' && !!pushSubscribed;
    const authed = typeof currentUser !== 'undefined' && !!currentUser;
    return themeRow() + perfRow()
      + (hasPush ? row('Уведомления', `<button type="button" class="gs-btn${pushOn ? '' : ' primary'}" data-site="push">${pushOn ? '✅ Включены — выключить' : '🔔 Включить'}</button>`, 'О новом видео и начале стрима — даже когда сайт закрыт.', { words: 'push пуш оповещения' }) : '')
      + row('Профиль и приватность', authed ? '<button type="button" class="gs-btn" data-site="profile">👤 Открыть</button>' : '<button type="button" class="gs-btn primary" data-site="login">🔑 Войти</button>',
        authed ? 'Кто видит профиль, заявки в друзья, невидимка.' : 'Войди — и появятся настройки профиля.', { words: 'аккаунт друзья невидимка донат' })
      // «🎂 Возраст»: год рождения (видит только сам) — Изменить / Удалить (js/core/age.js; кнопки ловит он же)
      + (root.D37Age?.settingsRow ? root.D37Age.settingsRow() : '')
      // «📲 Приложение»: установить / счётчик на значке (js/features/app.js; кнопки ловит он же)
      + (root.D37App?.settingsRow ? root.D37App.settingsRow() : '');
  }

  // ── Клавиши (controls.js: 2 клавиши на действие; «Пауза» не меняется) ──
  function ctl(){ const E = root.D37E; try { return E?.controls ? E.controls({ listen: false }) : null; } catch (e) { return null; } }
  let loading = null, ctlFail = false;
  function loadControls(){
    if (root.D37E?.controls) return Promise.resolve(true);
    if (loading) return loading;
    if (typeof gamesLoadScript === 'function') loading = gamesLoadScript('js/engine/controls.js').then(() => true, () => false);   // games.js — с кэшем, без второй загрузки
    else loading = new Promise(res => { const s = doc.createElement('script'); s.src = 'js/engine/controls.js'; s.onload = () => res(true); s.onerror = () => res(false); doc.head.appendChild(s); });
    loading = loading.then(ok => { loading = null; return ok; });
    return loading;
  }
  function keysHtml(C){
    const list = C.list(), conf = C.conflicts(), bad = new Set();
    for (const c of conf) for (const a of c.actions) bad.add(a + '|' + c.code);
    const groups = new Map();
    for (const a of list) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
    let html = keyNote ? `<div class="gs-keynote">${keyNote}</div>` : '';
    if (conf.length) html += `<div class="gs-keynote warn">⚠️ Одна клавиша у двух действий: ${conf.map(c => `<b>${esc(c.name)}</b> — ${c.actions.map(a => '«' + esc(C.title(a)) + '»').join(' и ')}`).join('; ')}. Назначь другую или нажми ↺.</div>`;
    for (const [g, acts] of groups) {
      html += `<div class="gs-keyg"><div class="gs-keyh">${esc(g)}</div>`;
      for (const a of acts) {
        const cap = s => capture && capture.id === a.id && capture.slot === s;
        const k = s => { const code = a.keys[s]; return `<button type="button" class="gs-key${cap(s) ? ' cap' : ''}${code && bad.has(a.id + '|' + code) ? ' bad' : ''}" data-key="${a.id}:${s}"${a.locked ? ' disabled' : ''} title="${a.locked ? 'Эту клавишу поменять нельзя' : 'Нажми и затем нужную клавишу'}" aria-label="${esc(a.title)}: ${s ? 'вторая' : 'первая'} клавиша">${cap(s) ? 'Нажми клавишу…' : esc(C.keyName(code))}</button>`; };
        const def = a.keys[0] === (a.def[0] || '') && a.keys[1] === (a.def[1] || '');
        html += `<div class="gs-krow" data-words="клавиша ${esc(g)}"><span>${esc(a.title)}</span>${k(0)}${k(1)}<button type="button" class="gs-kreset" data-keyreset="${a.id}" title="Как было" aria-label="${esc(a.title)}: как было"${a.locked || def ? ' disabled' : ''}>↺</button></div>`;
      }
      html += '</div>';
    }
    return html + row('', '<button type="button" class="gs-btn" data-keysall="1">↺ Все клавиши как были</button>', 'Нажми клавишу, потом новую: Esc — отмена, Backspace — убрать.', { words: 'клавиши сбросить по умолчанию' });
  }
  function startCapture(id, slot){
    stopCapture();
    const C = ctl(); if (!C) return;
    capture = { id, slot: +slot, C, pads: padState() };
    keyNote = '';
    renderBody();
    padT = setInterval(pollPad, 60);   // кнопка геймпада — тоже
  }
  function stopCapture(){ clearInterval(padT); padT = 0; capture = null; }
  function padState(){ try { const gp = [...(root.navigator?.getGamepads?.() || [])].find(p => p && p.connected); return gp ? gp.buttons.map(b => (b.value ?? (b.pressed ? 1 : 0)) > .5) : []; } catch (e) { return []; } }
  function pollPad(){
    if (!capture) return;
    const now = padState();
    for (let i = 0; i < now.length; i++) if (now[i] && !capture.pads[i]) { finishCapture('Pad' + i); return; }
    capture.pads = now;
  }
  function finishCapture(code){
    const c = capture; stopCapture();
    if (!c) return;
    if (code !== null) {
      c.C.set(c.id, c.slot, code);
      const other = code ? c.C.list().find(a => a.id !== c.id && a.keys.includes(code)) : null;   // совпадение покажет общий список ⚠️
      keyNote = other ? '' : code ? `✅ «${esc(c.C.title(c.id))}» — <b>${esc(c.C.keyName(code))}</b>` : `«${esc(c.C.title(c.id))}»: клавиша убрана`;
      keysChanged();
    }
    renderBody();
  }

  // ── Ввод в окне ──
  function onKey(e){
    if (!win) return;
    if (capture) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation?.();
      if (e.repeat) return;
      finishCapture(e.code === 'Escape' ? null : e.code === 'Backspace' || e.code === 'Delete' ? '' : e.code);
      return;
    }
    // Esc закрывает окно — и только его (дальше по окну клавишу не пускаем: ни меню игры, ни выход из полного экрана);
    // идёт поиск — сначала очищает поиск
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation?.();
      const f = win.querySelector('.gs-set-find');
      if (f && (f.value || query)) { f.value = ''; setQuery(''); f.focus({ preventScroll: true }); return; }
      close();
    }
  }
  // Enter / Пробел на кнопке меню или окна: игра под ними (controls.js, kubomir-input.js) отменяет у своих клавиш действие «по умолчанию»
  // (Enter — чат, Пробел — прыжок), и кнопка не нажималась бы — тогда нажимаем сами (поле и флажок игра не трогает)
  function keyActivate(e){
    if (!e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space')) return false;
    const b = e.target?.closest?.('button');
    if (!b || b.disabled || !(win?.contains(b) || b.closest('.gs-menu'))) return false;
    b.click();
    return true;
  }
  // стрелки по вкладкам (как у обычных вкладок): ↑↓ — столбиком (компьютер), ←→ — строкой (телефон); Enter в поиске — к первой найденной
  function onWinKey(e){
    if (keyActivate(e)) return;
    const t = e.target;
    if (t?.classList?.contains('gs-set-find')) {
      if (e.key === 'Enter' || e.key === 'ArrowDown') { const f = focusables(win.querySelector('.gs-set-body'))[0]; if (f) { e.preventDefault(); f.focus({ preventScroll: true }); f.scrollIntoView?.({ block: 'nearest' }); } }
      return;
    }
    if (!t?.closest?.('.gs-set-tabs') || !t.dataset?.tab) return;
    const horiz = getComputedStyle(t.parentElement).flexDirection.startsWith('row');
    const d = { ArrowDown: horiz ? 0 : 1, ArrowUp: horiz ? 0 : -1, ArrowRight: horiz ? 1 : 0, ArrowLeft: horiz ? -1 : 0 }[e.key];
    if (!d) return;
    e.preventDefault();
    stepTab(d, true);
  }
  function stepTab(d, focus){
    if (!win) return;
    const list = tabsFor(); if (!list.length) return;
    if (query) { const f = win.querySelector('.gs-set-find'); if (f) f.value = ''; query = ''; qWords = []; }
    const i = Math.max(0, list.findIndex(t => t.id === cur)), j = (i + d + list.length) % list.length;
    stopCapture(); keyNote = ''; cur = list[j].id;
    win.querySelector('.gs-set-body').scrollTop = 0;
    renderAll();
    if (focus) win.querySelector(`.gs-set-tabs [data-tab="${cur}"]`)?.focus({ preventScroll: true });
  }
  function hook(k, v){
    try {
      if (k === 'gfx') ctx?.gfx?.(v);
      else if (k === 'world2d') ctx?.world2d?.(v);
      else if (k === 'view') ctx?.view?.(v);
    } catch (e) { console.error(e); }
  }
  function onClick(e){
    const t = e.target.closest('button, [data-tab]'); if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.gs === 'close') { close(); return; }
    if (d.gs === 'reset') {
      const tab = TABS.find(x => x.id === cur);
      // «↺ Сбросить «Вкладку»» — только её значения (и её reset)
      if (d.scope === 'tab' && tab) {
        if (root.confirm && !root.confirm(`Вернуть настройки вкладки «${tab.title}» как было?`)) return;
        const was = { gfx: get('gfx'), world2d: get('world2d'), view: get('view') }, keys = tabKeys(tab);
        stopCapture();
        if (keys.length) resetKeys(keys, { ui: true });
        try { tab.reset?.(API); } catch (er) { console.error(er); }
        keyNote = keys.includes('keys') ? '✅ Клавиши как было' : '';
        for (const k of Object.keys(was)) if (was[k] !== get(k)) hook(k, get(k));
        renderBody();
        return;
      }
      if (!root.confirm || root.confirm('Вернуть все настройки как было? (графика, звук, клавиши, камера, интерфейс)')) {
        const was = { gfx: get('gfx'), world2d: get('world2d'), view: get('view') };
        reset(); keyNote = '';
        for (const k of Object.keys(was)) if (was[k] !== get(k)) hook(k, get(k));
        renderBody();
      }
      return;
    }
    if (d.tab) {
      if (query || d.tab !== cur) {
        const fromSearch = !!query;
        if (query) { const f = win.querySelector('.gs-set-find'); if (f) f.value = ''; query = ''; qWords = []; }
        stopCapture(); keyNote = ''; cur = d.tab;
        if (fromSearch) win.querySelector('.gs-set-body').scrollTop = 0;
        renderAll();
        if (fromSearch) win.querySelector(`.gs-set-tabs [data-tab="${cur}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (d.set) { const k = d.set, v = d.v; if (get(k) === v) { if (k === 'view') hook(k, v); return; } set(k, v, { ui: true }); hook(k, v); renderBody(); return; }   // вид — и при том же значении (в игре могли нажать V)
    if (d.key) { const [id, s] = d.key.split(':'); if (capture && capture.id === id && capture.slot === +s) { stopCapture(); renderBody(); } else startCapture(id, s); return; }
    if (d.keyreset) { const C = ctl(); if (C) { C.reset(d.keyreset); keyNote = ''; keysChanged(); } return; }
    if (d.keysall) { const C = ctl(); if (C && (!root.confirm || root.confirm('Вернуть все клавиши как было?'))) { C.resetAll(); keyNote = '✅ Клавиши как было'; keysChanged(); } return; }
    if (d.site) {
      const a = d.site;
      if (a.startsWith('perf:')) { if (typeof setPerf === 'function') setPerf(a.slice(5)); renderBody(); }
      else if (a === 'push') { if (typeof togglePush === 'function') Promise.resolve(togglePush()).finally(() => renderBody()); }
      else if (a === 'profile') { close(); location.hash = '#/profile'; setTimeout(() => doc.getElementById('profileAccountSettings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 900); }
      else if (a === 'login') { close(); if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
    }
  }
  function onInput(e){
    const t = e.target;
    if (t?.classList?.contains('gs-set-find')) { setQuery(t.value); return; }
    if (!t.dataset?.range) return;
    const k = t.dataset.range, v = +t.value / (+t.dataset.mul || 1);
    set(k, v, { ui: true });
    for (const out of win.querySelectorAll(`[data-out="${k}"]`)) out.innerHTML = FMT[k] ? FMT[k](get(k)) : String(get(k));
    // громкость — сразу слышно
    if (/^vol/.test(k) && k !== 'volVoice' && Date.now() - sfxAt > 160) { sfxAt = Date.now(); if (typeof gameSfx === 'function') gameSfx('tick'); }
  }
  function onChange(e){
    const t = e.target; if (!t.dataset?.sw) return;
    const k = t.dataset.sw, v = t.dataset.inv ? !t.checked : t.checked;
    set(k, v, { ui: true }); hook(k, v);
    renderBody();
  }

  // ═══ Меню паузы для игр (одно на игру: ☰ на экране, Esc, Start геймпада) ═══
  const MENUS = [];   // открытые меню (последнее — сверху)
  const topMenu = () => { for (let i = MENUS.length - 1; i >= 0; i--) { if (MENUS[i].el.isConnected) return MENUS[i]; MENUS.splice(i, 1); } return null; };
  function menu(parent, o = {}){
    const el = doc.createElement('div'); el.className = 'gs-menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'Меню');
    const items = () => typeof o.items === 'function' ? o.items() : o.items || [];
    const draw = () => {
      const f = doc.activeElement && el.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-mi') : null;   // фокус — на тот же пункт
      el.innerHTML = `<div class="gs-menu-box"><div class="gs-menu-head"><b>${o.title || 'Меню'}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>${items().map(it =>
        `<button type="button" class="gs-menu-it${it.primary ? ' primary' : ''}${it.warn ? ' warn' : ''}" data-mi="${esc(it.id)}"><span class="gs-mi-ic" aria-hidden="true">${it.icon || ''}</span>${it.text}</button>`).join('')}</div>`;
      if (f) el.querySelector(`[data-mi="${qa(f)}"]`)?.focus({ preventScroll: true });
    };
    draw();
    // мир под меню не крутится и не захватывает мышь
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu']) el.addEventListener(ev, e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    // ↑↓ / Home / End — по пунктам; Enter и Пробел — нажать (и когда игра под меню их «съела»)
    el.addEventListener('keydown', e => {
      if (keyActivate(e)) return;
      const k = e.key; if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'Home' && k !== 'End') return;
      const all = [...el.querySelectorAll('.gs-menu-it')]; if (!all.length) return;
      const i = all.indexOf(doc.activeElement);
      const j = k === 'Home' ? 0 : k === 'End' ? all.length - 1 : i < 0 ? 0 : (i + (k === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
      e.preventDefault(); all[j].focus({ preventScroll: true });
    });
    let offFs = null;
    const rec = { el, h: null };
    const h = {
      el,
      close(){ if (!el.isConnected) return; el.remove(); offFs?.(); offFs = null; const i = MENUS.indexOf(rec); if (i >= 0) MENUS.splice(i, 1); try { o.onClose?.(); } catch (e) { console.error(e); } },
      redraw: draw,
    };
    rec.h = h;
    el.addEventListener('click', e => { el.querySelector('.gs-menu-box')?.classList.remove('gs-pad'); const b = e.target.closest('[data-mi]'); if (b) o.onPick?.(b.dataset.mi, b); else if (e.target === el) h.close(); });
    parent.appendChild(el);
    el.querySelector('.gs-menu-it')?.focus({ preventScroll: true });
    // полный экран включили/выключили (Esc браузера, кнопка, поворот) — пункт «⛶» показывает правду
    offFs = root.D37Full?.on?.(() => { if (el.isConnected) draw(); else { offFs?.(); offFs = null; } }) || null;
    MENUS.push(rec);
    padWake();
    return h;
  }
  // Пункты про экран — одинаковые во всех играх: «⛶ Во весь экран» / «Обычный экран» и на телефоне стоя «🔄 Повернуть экран»
  function fsItems(el){
    const F = root.D37Full; if (!F || !el) return [];
    const on = !!F.contains?.(el);
    const out = [{ id: 'full', icon: F.icon?.(on) || '⛶', text: on ? 'Обычный экран' : 'Во весь экран' }];
    if (F.isTouch?.() && !F.isLandscape?.()) out.push({ id: 'rot', icon: '🔄', text: 'Повернуть экран' });
    return out;
  }
  // → true, если это был пункт экрана (сделано): ⛶ — меню остаётся (подпись меняется сама), 🔄 — меню закрывается (играть лёжа)
  function fsPick(id, el, m, o = {}){
    const F = root.D37Full; if (!F || !el || (id !== 'full' && id !== 'rot')) return false;
    const opt = Object.assign({ esc: false }, o);
    if (id === 'full') { F.toggle(el, opt); setTimeout(() => { if (m?.el?.isConnected) m.redraw(); }, 80); }
    else { F.rotate(el, opt); m?.close?.(); }
    return true;
  }

  // ═══ Геймпад в меню и окне: ↑↓ (крестовина, левый стик) — по строкам, ←→ — ползунок / соседняя кнопка, Ⓐ — нажать
  //     (при отпускании), Ⓑ — назад (как Esc), LB/RB — вкладки окна. Опрос — только пока открыто меню или окно и есть геймпад ═══
  const NAV = { raf: 0, prev: null, dir: '', next: 0 };
  const FOC = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  const shown = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects?.().length) && !e.closest('[hidden]');
  const focusables = box => box ? [...box.querySelectorAll(FOC)].filter(shown) : [];
  function layer(){
    if (win) return { box: win.querySelector('.gs-set-box'), back: () => { const f = win.querySelector('.gs-set-find'); if (f && (f.value || query)) { f.value = ''; setQuery(''); } else close(); }, tabs: true };
    const m = topMenu();
    return m ? { box: m.el.querySelector('.gs-menu-box'), back: () => m.h.close() } : null;
  }
  function padRead(){ try { const ps = root.navigator?.getGamepads?.(); if (ps) for (const p of ps) if (p && p.connected) return p; } catch (e) {} return null; }
  function padWake(){
    if (NAV.raf || !root.requestAnimationFrame || !layer() || !padRead()) return;
    NAV.prev = null;   // первый опрос — только запомнить (Start, которым открыли меню, — не нажатие)
    NAV.raf = root.requestAnimationFrame(padTick);
  }
  root.addEventListener?.('gamepadconnected', () => padWake());
  function focusEl(el){
    if (!el) return;
    // в группе вариантов — сразу на выбранный (а не на крайний)
    const g = el.closest('.gs-seg'), on = g && g.querySelector('button.on:not([disabled])');
    const t = on && shown(on) ? on : el;
    try { t.focus({ preventScroll: true }); } catch (e) {}
    t.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  // d = ±1; skip — группа, которую перескакиваем целиком (варианты, клавиши); within — двигаться только внутри
  function moveFocus(box, d, o = {}){
    const all = focusables(o.within || box); if (!all.length) return;
    const a = doc.activeElement; const i = all.indexOf(a);
    if (i < 0) { focusEl(all[d > 0 ? 0 : all.length - 1]); return; }
    const grp = o.skip ? a.closest(o.skip) : null;
    let j = i;
    do j += d; while (grp && j >= 0 && j < all.length && grp.contains(all[j]));
    if (j < 0 || j >= all.length) { if (o.within) return; j = d > 0 ? 0 : all.length - 1; }
    if (o.within) { try { all[j].focus({ preventScroll: true }); } catch (e) {} all[j].scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    else focusEl(all[j]);
  }
  function stepRange(el, d){
    const st = +el.step || 1, v = Math.min(+el.max, Math.max(+el.min, +el.value + d * st));
    if (v === +el.value) return;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function padDir(L, dir){
    L.box.classList.add('gs-pad');
    const a = doc.activeElement, inBox = !!(a && L.box.contains(a));
    const rowTabs = a?.closest?.('.gs-set-tabs') && getComputedStyle(a.parentElement).flexDirection.startsWith('row');
    if (dir === 'left' || dir === 'right') {
      if (!inBox) return;
      const d = dir === 'right' ? 1 : -1;
      if (a.matches('input[type="range"]')) { stepRange(a, d); return; }
      const grp = a.closest('.gs-seg, .gs-krow, .gs-vol') || (rowTabs ? a.closest('.gs-set-tabs') : null);
      if (grp) { moveFocus(L.box, d, { within: grp }); return; }
      if (a.closest('.gs-set-tabs') && d > 0) { const f = focusables(L.box.querySelector('.gs-set-body'))[0]; if (f) focusEl(f); }
      return;
    }
    moveFocus(L.box, dir === 'down' ? 1 : -1, { skip: rowTabs ? '.gs-set-tabs' : '.gs-seg, .gs-krow' });
  }
  function padPress(L){
    const a = doc.activeElement;
    L.box.classList.add('gs-pad');
    if (!a || !L.box.contains(a)) { moveFocus(L.box, 1); return; }
    if (a.matches('input[type="range"], input[type="search"]')) return;
    a.click();
  }
  function padTick(t){
    NAV.raf = 0;
    const L = layer(), gp = L && padRead();
    if (!L || !gp) { NAV.prev = null; NAV.dir = ''; return; }
    const B = i => { const x = gp.buttons[i]; return !!x && (x.pressed || x.value > .5); };
    const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0;
    const c = { up: B(12) || ay < -.6, down: B(13) || ay > .6, left: B(14) || ax < -.6, right: B(15) || ax > .6, a: B(0), b: B(1), lb: B(4), rb: B(5) };
    const P = NAV.prev; NAV.prev = c;
    if (P) {
      // направление — сразу; держишь — через 0,4 с повтор каждые 0,11 с
      const dir = c.up ? 'up' : c.down ? 'down' : c.left ? 'left' : c.right ? 'right' : '';
      if (dir && (dir !== NAV.dir || t >= NAV.next)) { NAV.next = t + (dir !== NAV.dir ? 400 : 110); padDir(L, dir); }
      NAV.dir = dir;
      // Ⓐ и Ⓑ — при отпускании: «Продолжить» закрыл меню, а игра под ним кнопку уже не видит нажатой (без прыжка)
      if (P.a && !c.a) padPress(L);
      else if (P.b && !c.b) L.back();
      else if (L.tabs && ((c.lb && !P.lb) || (c.rb && !P.rb))) { stepTab(c.rb && !P.rb ? 1 : -1, true); win?.querySelector('.gs-set-box')?.classList.add('gs-pad'); }
    }
    if (layer()) NAV.raf = root.requestAnimationFrame(padTick); else { NAV.prev = null; NAV.dir = ''; }
  }

  // ═══ «⚙️ Настройки» в меню сайта (Ещё ▾ / ☰) ═══
  function siteEntry(){
    const panel = doc.getElementById('navMorePanel') || doc.getElementById('navLinks');
    if (!panel || panel.querySelector('.gs-navset')) return;
    const a = doc.createElement('a'); a.href = '#'; a.className = 'gs-navset'; a.setAttribute('role', 'button'); a.textContent = '⚙️ Настройки';
    a.addEventListener('click', e => {
      e.preventDefault();
      // меню ☰ закрыть (как при переходе — router.js), окно — поверх страницы
      doc.getElementById('navLinks')?.classList.remove('open'); doc.getElementById('burger')?.classList.remove('open');
      open({ ctx: 'site' });
    });
    panel.appendChild(a);
  }
  if (doc?.addEventListener) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', () => setTimeout(siteEntry, 0)); else setTimeout(siteEntry, 0);
    // F3 (perf.js) — запомнить, показан ли счётчик
    root.addEventListener('keydown', e => {
      if (e.code !== 'F3' || e.repeat) return;
      setTimeout(() => { const P = root.D37E?.perf; if (P && !!P.on !== get('fps')) { data.fps = !!P.on; save(); apply(); emit({ key: 'fps', value: !!P.on }); } }, 0);
    }, true);
    // ⚙️ без своего кода: <button data-gs-set> (шапка игры)
    doc.addEventListener('click', e => { const b = e.target?.closest?.('[data-gs-set]'); if (!b) return; e.preventDefault(); open({ tab: b.dataset.gsSet || undefined }); });
  }

  const API = root.D37Settings = {
    get, set, reset, resetKeys, open, close, isOpen: () => !!win, context, menu, fsItems, fsPick, addMain,
    on(f){ subs.add(f); return () => subs.delete(f); },
    define(k, spec){ if (!SCHEMA[k] && spec && 'def' in spec) SCHEMA[k] = spec; return API; },
    addTab(t){
      if (!t?.id || typeof t.render !== 'function') return;
      const i = TABS.findIndex(x => x.id === t.id);
      const tab = { order: 80, icon: '⚙️', title: t.id, ...t };
      if (i >= 0) TABS[i] = tab; else TABS.push(tab);
      if (win) renderAll();
    },
    refresh(){ if (win) renderBody(); },
    // громкость звуков игр (games.js gameSfx): 0 — тишина
    sfxGain(){ const O = root.D37Opt; return !O ? 1 : O.mute ? 0 : O.vol * O.volFx; },
    keysChanged,
    get schema(){ return SCHEMA; },
    _test: { LEG, clean, migrate, data: () => data, apply, tabsFor: c => { const o = cx; cx = c; const r = tabsFor().map(t => t.id); cx = o; return r; },
      tabKeys: id => tabKeys(TABS.find(t => t.id === id)), norm, matchText, mainFor: c => { const o = cx; cx = c; const r = MAIN.filter(m => (!m.ctx || m.ctx.includes(c)) && (!m.when || m.when(c))).sort((a, b) => a.order - b.order).map(m => m.id); cx = o; return r; },
      menus: () => MENUS.length, nav: () => ({ raf: !!NAV.raf }) },
  };
})();

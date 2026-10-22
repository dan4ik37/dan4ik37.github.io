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
// Свои вкладки (телефон и т. п.): D37Settings.addTab({ id, icon, title, order, ctx: ['engine','game','site'], when(cx) — показывать ли сейчас, render(el, S) })
// и свои значения: D37Settings.define(key, { def, list | bool | min/max | obj }).
// Меню паузы для игр: D37Settings.menu(parent, { title, sub, items: [{ id, icon, text, primary, warn }], onPick(id), onClose }).
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

  // ═══ Что есть (по умолчанию — как было до окна настроек) ═══
  const SCHEMA = {
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
  };
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
    for (const L of Object.values(LEG)) lsSet(L.k, null);
    data = { _v: 1 }; save(); keysRev++;
    apply();
    const P = root.D37E?.perf; if (P?.on) P.toggle(false);
    emit({ key: '*' });
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
    { id: 'gfx', icon: '🎨', title: 'Графика', order: 10, ctx: ['engine', 'site'], render: tabGfx },
    { id: 'sound', icon: '🔊', title: 'Звук', order: 20, ctx: ['engine', 'game', 'site'], render: tabSound },
    { id: 'controls', icon: '🎮', title: 'Управление', order: 30, ctx: ['engine', 'site'], render: tabControls },
    { id: 'camera', icon: '🎥', title: 'Камера', order: 40, ctx: ['engine', 'site'], render: tabCamera },
    { id: 'ui', icon: '🧩', title: 'Интерфейс', order: 50, ctx: ['engine', 'game', 'site'], render: tabUi },
    { id: 'site', icon: '🌐', title: 'Сайт', order: 90, ctx: ['engine', 'game', 'site'], render: tabSite },
  ];
  let win = null, cur = 'gfx', cx = 'site', opened = {}, capture = null, keyNote = '', padT = 0, sfxAt = 0;
  const tabsFor = () => TABS.filter(t => (!t.ctx || t.ctx.includes(cx)) && (!t.when || t.when(cx))).sort((a, b) => a.order - b.order);   // when(cx) — своё условие вкладки
  const gameOpen = () => { try { return typeof gamesActive !== 'undefined' && !!gamesActive; } catch (e) { return false; } };   // gamesActive — games.js

  function open(o = {}){
    if (!doc?.body) return;
    opened = o;
    cx = o.ctx || (ctx?.engine ? 'engine' : gameOpen() ? 'game' : 'site');
    const list = tabsFor();
    cur = list.some(t => t.id === o.tab) ? o.tab : cx === 'site' ? 'site' : cx === 'game' ? 'sound' : 'gfx';
    if (!list.some(t => t.id === cur)) cur = list[0]?.id;
    keyNote = ''; ctlFail = false;   // клавиши не загрузились — при новом открытии попробовать снова
    if (!win) {
      win = doc.createElement('div'); win.className = 'gs-set'; win.id = 'gsSettings';
      win.setAttribute('role', 'dialog'); win.setAttribute('aria-modal', 'true'); win.setAttribute('aria-label', 'Настройки');
      win.innerHTML = `<div class="gs-set-box">
          <div class="gs-set-head"><b>⚙️ Настройки</b><small>сохраняются сами</small><button type="button" class="gs-set-x" data-gs="close" aria-label="Закрыть">✕</button></div>
          <div class="gs-set-main"><div class="gs-set-tabs" role="tablist"></div><div class="gs-set-body" role="tabpanel"></div></div>
          <div class="gs-set-foot"><button type="button" class="gs-btn ghost" data-gs="reset">↺ Сбросить всё</button><span class="gs-grow"></span><button type="button" class="gs-btn primary" data-gs="close">Готово</button></div>
        </div>`;
      win.addEventListener('click', onClick);
      win.addEventListener('input', onInput);
      win.addEventListener('change', onChange);
      win.addEventListener('pointerdown', e => { if (e.target === win) close(); });
      doc.body.appendChild(win);
      root.addEventListener('keydown', onKey, true);
      doc.documentElement.classList.add('gs-set-open');
    }
    renderAll();
    win.querySelector('.gs-set-x')?.focus({ preventScroll: true });
  }
  function close(){
    if (!win) return;
    stopCapture();
    root.removeEventListener('keydown', onKey, true);
    win.remove(); win = null;
    doc.documentElement.classList.remove('gs-set-open');
    const f1 = opened.onClose, f2 = ctx?.onClose; opened = {};
    try { f1?.(); } catch (e) { console.error(e); }
    try { if (f2 !== f1) f2?.(); } catch (e) { console.error(e); }
  }
  function renderAll(){
    if (!win) return;
    const list = tabsFor();
    if (!list.some(t => t.id === cur)) cur = list[0]?.id;
    win.querySelector('.gs-set-tabs').innerHTML = list.map(t => `<button type="button" role="tab" aria-selected="${t.id === cur}" class="${t.id === cur ? 'on' : ''}" data-tab="${t.id}"><span>${t.icon}</span>${esc(t.title)}</button>`).join('');
    renderBody();
  }
  function renderBody(){
    if (!win) return;
    const body = win.querySelector('.gs-set-body'), t = TABS.find(x => x.id === cur);
    const top = body.scrollTop;
    body.innerHTML = '';
    if (!t) return;
    try {
      const html = t.render(body, API);
      if (typeof html === 'string') body.innerHTML = html;
    } catch (e) { console.error(e); body.innerHTML = '<p class="gs-note">Не получилось показать эту вкладку.</p>'; }
    body.scrollTop = top;
  }

  // ── Строки ──
  const FMT = { vol: v => v + '%', volFx: v => v + '%', volAmb: v => v + '%', volVoice: v => v + '%', sens: v => Math.round(v * 100) + '%', motion: v => Math.round(v * 100) + '%',
    fov: v => `${v}° <small>(от 1-го лица ${v + 22}°)</small>`, uiScale: v => v + '%', touchSize: v => v + '%', touchAlpha: v => v + '%' };
  const row = (label, ctl, hint, o = {}) => `<div class="gs-row${o.cls ? ' ' + o.cls : ''}${o.dis ? ' dis' : ''}"><div class="gs-lbl"><b>${label}</b>${hint ? `<small>${hint}</small>` : ''}</div><div class="gs-ctl">${ctl}</div></div>`;
  const seg = (k, opts, o = {}) => `<div class="gs-seg" role="radiogroup">${opts.map(([v, t]) => { const on = (o.cur ?? get(k)) === v; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-set="${k}" data-v="${esc(v)}"${o.dis ? ' disabled' : ''}>${t}</button>`; }).join('')}</div>`;
  const sw = (k, o = {}) => { const on = o.inv ? !get(k) : !!get(k); return `<label class="gs-sw"><input type="checkbox" data-sw="${k}"${o.inv ? ' data-inv="1"' : ''}${on ? ' checked' : ''}${o.dis ? ' disabled' : ''}><i aria-hidden="true"></i></label>`; };
  const range = (k, min, max, step, mul = 1) => `<div class="gs-range"><input type="range" min="${min}" max="${max}" step="${step}" value="${Math.round(get(k) * mul)}" data-range="${k}" data-mul="${mul}" aria-label="${k}"><output data-out="${k}">${FMT[k] ? FMT[k](get(k)) : get(k)}</output></div>`;
  const head = t => `<div class="gs-sec">${t}</div>`;
  const note = t => `<p class="gs-note">${t}</p>`;

  // ── Вкладки ──
  function liveR(){ try { return ctx?.R?.() || null; } catch (e) { return null; } }
  function tabGfx(){
    const R = liveR(), E = root.D37E, autoQ = E?.quality ? E.quality() : null, qn = { low: 'низкое', mid: 'среднее', high: 'высокое' };
    const q = R ? R.q : get('gfx') === 'auto' ? autoQ : get('gfx'), low = q === 'low';
    const now = R ? `Сейчас: ${qn[R.q] || R.q}. ` : autoQ && get('gfx') === 'auto' ? `Для этого устройства: ${qn[autoQ]}. ` : '';
    return head('3D-миры: «Мир Денчика», «Студия 3D»')
      + row('Качество', seg('gfx', [['auto', 'Авто'], ['low', 'Низкое'], ['mid', 'Среднее'], ['high', 'Высокое']]),
        now + 'Низкое — без теней и текстур, для слабых телефонов. Высокое — мягкие тени и рельеф текстур.' + (ctx?.gfx ? ' Мир перезагрузится.' : R ? ' Сработает при следующем запуске.' : ''))
      + row('Разрешение (FSR)', seg('fsr', [['auto', 'Авто'], ['native', '100%'], ['quality', 'Качество'], ['balanced', 'Баланс'], ['performance', 'Скорость']], { dis: low }),
        low ? 'FSR работает на среднем и высоком качестве.' : 'AMD FSR 1, как DLSS: кадр рисуется меньше (77 / 67 / 59%) и чётко растягивается — игра быстрее. «Авто» снижает разрешение само, только когда тормозит.', { dis: low })
      + row('Тени', sw('shadows', { dis: low }), low ? 'На низком качестве теней нет.' : 'Выключи, если 3D тормозит.', { dis: low })
      + row('Счётчик FPS', sw('fps'), 'Кадры в секунду и нагрузка — поверх 3D (клавиша F3).')
      + row('Плоский «Мир Денчика»', sw('world2d'), 'Мир без 3D — для очень слабых телефонов.')
      + note('Анимации и эффекты самого сайта — во вкладке «🌐 Сайт».');
  }
  function tabSound(){
    const m = get('mute');
    return row('Звук в играх', sw('mute', { inv: true }), m ? 'Сейчас выключен.' : 'Кнопка 🔊 в игре — тоже.')
      + row('Общая громкость', range('vol', 0, 100, 5), '', { dis: m })
      + row('Эффекты', range('volFx', 0, 100, 5), 'Шаги, прыжки, кнопки, звуки мини-игр.', { dis: m })
      + row('Окружение', range('volAmb', 0, 100, 5), 'Вода, огонь, ветер в 3D-мирах.', { dis: m })
      + row('Голос', range('volVoice', 0, 100, 5), 'Звонки и голосовой чат — их слышно, даже когда звук игр выключен.');
  }
  function tabControls(body){
    const touchDev = !!root.D37Full?.isTouch?.();
    let html = row('Чувствительность мыши', range('sens', 20, 300, 5, 100), 'И поворот камеры пальцем.')
      + row('Инверсия по вертикали', sw('invertY'), 'Мышь вверх — камера вниз.')
      + head('Телефон: кнопки на экране')
      + row('Размер кнопок', range('touchSize', 70, 150, 5))
      + row('Непрозрачность кнопок', range('touchAlpha', 30, 100, 5))
      + row('Для левши', sw('lefty'), 'Джойстик — справа, кнопки — слева.')
      + (root.D37TouchLayout?.settingsRow ? root.D37TouchLayout.settingsRow() : '')   // «🕹 Настроить кнопки» (js/core/touch-layout.js, кнопку ловит он же)
      + head('Клавиши' + (touchDev ? ' <small>(клавиатура и геймпад)</small>' : ''));
    const C = ctl();
    if (!C && ctlFail) return html + note('Список клавиш не загрузился — проверь интернет и открой окно ещё раз.');
    if (!C) { html += note('⏳ Загружаем список клавиш…'); loadControls().then(ok => { if (!ok) ctlFail = true; if (win && cur === 'controls') renderBody(); }); return html; }
    html += keysHtml(C);
    return html;
  }
  function tabCamera(){
    return row('Вид', seg('view', [['third', 'От 3-го лица'], ['first', 'От 1-го лица']]), 'Каким начинать в 3D-мире. В игре — клавиша V.')
      + row('Приблизил до упора — от 1-го лица', sw('zoomFirst'), 'Как в Роблоксе: колесо мыши, щипок или крестовина ↑ до конца — вид глазами персонажа, обратно — отдали.')
      + row('Угол обзора', range('fov', 40, 80, 1), 'Шире — видно больше, но всё мельче.')
      + row('Покачивание при ходьбе', range('motion', 0, 100, 5, 100), 'Камера качается в такт шагам, на бегу шире обзор.')
      + row('Тряска камеры', sw('shake'), 'Удары, взрывы, жёсткое приземление.');
  }
  function tabUi(){
    return row('Размер кнопок и надписей в играх', range('uiScale', 80, 130, 5))
      + row('Ники над головами', sw('tags'))
      + row('Облачка сообщений', sw('bubbles'), 'Сообщения чата и жителей над головами.')
      + head('Полный экран')
      + row('Открывать игры во весь экран', sw('autoFull'), 'Сразу при запуске игры. Выйти — кнопка ⛶ или Esc.')
      + row('Повернул телефон — игра на весь экран', sw('autoLand'), 'Положи телефон горизонтально — игра займёт весь экран, верни — снова сайт.')
      + (cx === 'game' ? note('Графика, управление и камера 3D — в «Мире Денчика» (кнопка ⚙️) или в меню сайта «Ещё → ⚙️ Настройки».') : '');
  }
  function tabSite(){
    const perf = typeof currentPerf !== 'undefined' ? currentPerf : null;   // performance-mode.js
    const hasPush = typeof togglePush === 'function', pushOn = typeof pushSubscribed !== 'undefined' && !!pushSubscribed;
    const authed = typeof currentUser !== 'undefined' && !!currentUser;
    return row('Режим сайта', `<div class="gs-seg">${[['low', '🐢 Слабое'], ['high', '🚀 Мощное']].map(([v, t]) => `<button type="button" class="${perf === v ? 'on' : ''}" aria-pressed="${perf === v}" data-site="perf:${v}">${t}</button>`).join('')}</div>`,
        'Анимации, частицы и эффекты сайта. «Слабое» — быстрее на старых телефонах. Графика 3D — во вкладке «🎨 Графика».')
      + (hasPush ? row('Уведомления', `<button type="button" class="gs-btn${pushOn ? '' : ' primary'}" data-site="push">${pushOn ? '✅ Включены — выключить' : '🔔 Включить'}</button>`, 'О новом видео и начале стрима — даже когда сайт закрыт.') : '')
      + row('Профиль и приватность', authed ? '<button type="button" class="gs-btn" data-site="profile">👤 Открыть</button>' : '<button type="button" class="gs-btn primary" data-site="login">🔑 Войти</button>',
        authed ? 'Кто видит профиль, заявки в друзья, невидимка, логин для доната.' : 'Войди — и появятся настройки профиля.')
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
        const k = s => { const code = a.keys[s]; return `<button type="button" class="gs-key${cap(s) ? ' cap' : ''}${code && bad.has(a.id + '|' + code) ? ' bad' : ''}" data-key="${a.id}:${s}"${a.locked ? ' disabled' : ''} title="${a.locked ? 'Эту клавишу поменять нельзя' : 'Нажми и затем нужную клавишу'}">${cap(s) ? 'Нажми клавишу…' : esc(C.keyName(code))}</button>`; };
        const def = a.keys[0] === (a.def[0] || '') && a.keys[1] === (a.def[1] || '');
        html += `<div class="gs-krow"><span>${esc(a.title)}</span>${k(0)}${k(1)}<button type="button" class="gs-kreset" data-keyreset="${a.id}" title="Как было" aria-label="Как было"${a.locked || def ? ' disabled' : ''}>↺</button></div>`;
      }
      html += '</div>';
    }
    return html + `<div class="gs-row"><div class="gs-lbl"><small>Нажми на клавишу и потом новую. Esc — отмена, Backspace — убрать. Работает в «Мире Денчика» и «Студии 3D».</small></div><div class="gs-ctl"><button type="button" class="gs-btn" data-keysall="1">↺ Все клавиши как были</button></div></div>`;
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
    // Esc закрывает окно — и только его (дальше по окну клавишу не пускаем: ни меню игры, ни выход из полного экрана)
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation?.(); close(); }
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
      if (!root.confirm || root.confirm('Вернуть все настройки как было? (графика, звук, клавиши, камера, интерфейс)')) {
        const was = { gfx: get('gfx'), world2d: get('world2d'), view: get('view') };
        reset(); keyNote = '';
        for (const k of Object.keys(was)) if (was[k] !== get(k)) hook(k, get(k));
        renderBody();
      }
      return;
    }
    if (d.tab) { if (d.tab !== cur) { stopCapture(); keyNote = ''; cur = d.tab; renderAll(); } return; }
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
    const t = e.target; if (!t.dataset?.range) return;
    const k = t.dataset.range, v = +t.value / (+t.dataset.mul || 1);
    set(k, v, { ui: true });
    const out = win.querySelector(`[data-out="${k}"]`); if (out) out.innerHTML = FMT[k] ? FMT[k](get(k)) : String(get(k));
    // громкость — сразу слышно
    if (/^vol/.test(k) && k !== 'volVoice' && Date.now() - sfxAt > 160) { sfxAt = Date.now(); if (typeof gameSfx === 'function') gameSfx('tick'); }
  }
  function onChange(e){
    const t = e.target; if (!t.dataset?.sw) return;
    const k = t.dataset.sw, v = t.dataset.inv ? !t.checked : t.checked;
    set(k, v, { ui: true }); hook(k, v);
    renderBody();
  }

  // ═══ Меню паузы для игр (у «Мира Денчика» — Esc) ═══
  function menu(parent, o = {}){
    const el = doc.createElement('div'); el.className = 'gs-menu'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', o.title || 'Меню');
    const items = () => typeof o.items === 'function' ? o.items() : o.items || [];
    const draw = () => {
      el.innerHTML = `<div class="gs-menu-box"><div class="gs-menu-head"><b>${o.title || 'Меню'}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</div>${items().map(it =>
        `<button type="button" class="gs-menu-it${it.primary ? ' primary' : ''}${it.warn ? ' warn' : ''}" data-mi="${esc(it.id)}"><span class="gs-mi-ic" aria-hidden="true">${it.icon || ''}</span>${it.text}</button>`).join('')}</div>`;
    };
    draw();
    // мир под меню не крутится и не захватывает мышь
    for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'contextmenu']) el.addEventListener(ev, e => e.stopPropagation());
    el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    const h = {
      el,
      close(){ if (!el.isConnected) return; el.remove(); try { o.onClose?.(); } catch (e) { console.error(e); } },
      redraw: draw,
    };
    el.addEventListener('click', e => { const b = e.target.closest('[data-mi]'); if (b) o.onPick?.(b.dataset.mi, b); else if (e.target === el) h.close(); });
    parent.appendChild(el);
    el.querySelector('.gs-menu-it')?.focus({ preventScroll: true });
    return h;
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
    get, set, reset, open, close, isOpen: () => !!win, context, menu,
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
    _test: { LEG, clean, migrate, data: () => data, apply, tabsFor: c => { const o = cx; cx = c; const r = tabsFor().map(t => t.id); cx = o; return r; } },
  };
})();

// ═══════════════════════════════════════
//  «КУБОМИР» — управление как в Майнкрафте (Java): свои клавиши поверх общего управления движка, геймпад,
//  палец «как в Bedrock» (нажал — поставить, держишь — ломать), кнопки телефона
// ═══════════════════════════════════════
// K = KubomirInput.create({ el, C, isOpen, onKey }) — читать в шаге логики после C.step: K.step(dt), K.down(id), K.held(id),
// K.up(id), K.ctrl (зажат Ctrl), K.pad (подключён геймпад). Свои действия «Кубомира» (ACTS): красться — Shift, бег — Ctrl
// (или два раза «вперёд» — это общее C.doubleTap('forward')), вещи — E, выбросить — Q (с Ctrl — всю стопку), вид — F5
// (1-е лицо → сзади → спереди), F1 — спрятать экран, F3 — сведения, T — чат, / — сразу команда. Ходьба, прыжок, ячейки 1–9,
// ЛКМ/ПКМ/СКМ — общее управление движка (controls.js; меняются в ⚙️ → «Управление»), свои — d37_kb_keys (⚙️ → «🧊 Кубомир»:
// K.keysHtml / K.keysClick). Ctrl: controls.js не видит клавиши с зажатым Ctrl — K сам передаёт их (C.key), Ctrl+W браузер
// закрыл бы вкладку — пока Ctrl зажат, сайт спросит «Уйти?» (beforeunload), во весь экран клавиатура «закрыта» (Keyboard Lock).
// Геймпад: RT — ломать, LT — ставить (общее «поставить»), LB/RB — ячейки, Y — вещи, B — красться, X — взять блок, L3 — бег,
// R3 — вид, крестовина ↓ — выбросить (держать — стопку), ↑ — поменять руки, Back — чат, Start — пауза, Ⓐ — прыжок (два раза —
// полёт). Две руки (docs/COMBAT.md): F — поменять руки (как в Майнкрафте), «держать щит / тянуть лук» — ПКМ / LT (на телефоне —
// своя кнопка: K.press('offuse')).
// Палец: K.finger — палец, который сейчас держит мир ({ x, y, t, moved }), K.taps — короткие нажатия ({ x, y });
// K.touchBar(wrap, list, { game }) — кнопки телефона (прыжок, красться, полёт вверх/вниз, вещи, руки, щит, ⛏/🧱 в режиме «прицел»):
// только значки, подпись — до первого нажатия и пока держишь; расставляет их kubomir.js через D37TouchLayout (js/core/touch-layout.js).
(() => {
  const LS = 'd37_kb_keys';
  // id, название, клавиши по умолчанию [клавиатура, геймпад]
  const ACTS = [
    ['sneak', 'Красться (с края не упадёшь)', ['ShiftLeft', 'Pad1']],
    // ползком (T-096a): держать; два раза «красться» (Shift / Ⓑ) — лечь и ползти, пока не нажмёшь «красться» или «прыжок»
    ['crawl', 'Ползти — лечь (держать; или два раза «красться»)', ['KeyZ', '']],
    ['sprint', 'Бег (или два раза «вперёд»)', ['ControlLeft', 'Pad10']],
    ['inventory', 'Вещи (открыть / закрыть)', ['KeyE', 'Pad3']],
    ['drop', 'Выбросить вещь (с Ctrl — всю стопку)', ['KeyQ', 'Pad13']],
    ['camera', 'Вид: 1-е лицо → сзади → спереди', ['F5', 'Pad11']],
    ['hud', 'Спрятать интерфейс (для снимков)', ['F1', '']],
    ['debug', 'Сведения о мире и скорости', ['F3', '']],
    ['chat', 'Чат', ['KeyT', 'Pad8']],
    ['command', 'Команда (чат сразу с «/»)', ['Slash', '']],
    ['mine', 'Ломать (геймпад; мышь — ЛКМ)', ['', 'Pad7']],
    ['pick', 'Взять блок под прицелом (геймпад; мышь — СКМ)', ['', 'Pad2']],
    ['prev', 'Ячейка влево', ['', 'Pad4']],
    ['next', 'Ячейка вправо', ['', 'Pad5']],
    ['swap', 'Поменять руки: правая ↔ левая (щит, факел, еда)', ['KeyF', 'Pad12']],
    ['offuse', 'Щит, лук — держать (мышь — ПКМ, геймпад — LT)', ['', '']],
    // помощники (T-049): книга рецептов (после «Книги мастера»), дорожная книга, атлас (когда надет); на телефоне — ☰ меню
    ['recipes', 'Книга рецептов (когда прочитана «Книга мастера»)', ['KeyR', '']],
    ['quests', 'Дорожная книга: задания', ['KeyJ', 'Pad14']],
    ['map', 'Атлас: карта и точки (когда надет)', ['KeyM', 'Pad15']],
    ['waypoint', 'Поставить точку на карте (атлас)', ['KeyN', '']],
  ];
  const DEF = new Map(ACTS.map(a => [a[0], a[2]]));
  const MOVE_CODES = ['forward', 'back', 'left', 'right', 'jump'];
  window.KubomirInput = { create, ACTS };

  function load(){
    let s = {};
    try { s = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) {}
    const b = new Map();
    for (const [id, , d] of ACTS) b.set(id, Array.isArray(s[id]) ? [String(s[id][0] || ''), String(s[id][1] || '')] : [d[0], d[1]]);
    return b;
  }
  function save(b){
    const out = {};
    for (const [id, , d] of ACTS) { const k = b.get(id); if (k[0] !== d[0] || k[1] !== d[1]) out[id] = k; }
    try { localStorage.setItem(LS, JSON.stringify(out)); } catch (e) {}
  }
  const typing = t => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

  function create(o){
    const C = o.C, el = o.el;
    // padLast — последним трогали геймпад (а не мышь/клавиатуру): тогда прицел виден и без захвата мыши, подсказки «нажми на мир» нет
    const K = { ctrl: false, pad: false, padLast: false, finger: null, taps: [], binds: load(), capturing: null, sneakToggle: false };
    const down = new Set(), edge = new Set(), upEdge = new Set(), st = new Map(), virt = new Set(), vEdge = new Set();
    for (const [id] of ACTS) st.set(id, { held: false, down: false, up: false, t0: 0 });
    let now = 0, padDown = new Set(), guard = false;
    const offs = [];
    const on = (t, ev, f, opt) => { t.addEventListener(ev, f, opt); offs.push(() => t.removeEventListener(ev, f, opt)); };
    const isBound = code => { for (const b of K.binds.values()) if (b[0] === code || b[1] === code) return true; return false; };
    const blockedWin = () => !!window.D37Settings?.isOpen?.() || !!o.isOpen?.();

    // ── клавиатура ──
    on(window, 'keydown', e => {
      if (K.capturing) {   // назначение клавиши во вкладке «🧊 Кубомир»
        if (e.repeat) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const cb = K.capturing; K.capturing = null;
        cb(e.code === 'Escape' ? null : e.code === 'Backspace' || e.code === 'Delete' ? '' : e.code);
        return;
      }
      if (typing(e.target) || e.metaKey || C.capturing) return;
      K.padLast = false;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') setCtrl(true);
      const win = blockedWin();   // открыто окно (вещи, меню, ⚙️): клавиши всё равно считаем — E закрывает вещи
      // Ctrl + клавиша: controls.js такие нажатия пропускает — передать самим (бег: Ctrl + W, прыжок с Ctrl)
      if (e.ctrlKey && !e.altKey && !win) {
        const mv = MOVE_CODES.some(a => C.get(a, 0) === e.code || C.get(a, 1) === e.code);
        if (mv && !e.repeat) C.key(e.code, true);
        if (mv || isBound(e.code) || e.code === 'KeyK' || e.code === 'KeyS' || e.code === 'KeyD' || e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); }   // Ctrl+K — поиск сайта, Ctrl+S/D/F — браузер
      }
      // F1, F3, F5 — браузеру не отдаём (справка, поиск, перезагрузка) — пока открыт мир
      if (isBound(e.code) || /^F(1|3|5)$/.test(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (!down.has(e.code)) { down.add(e.code); edge.add(e.code); }
      o.onKey?.(e);
    }, true);
    on(window, 'keyup', e => {
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') setCtrl(false);
      if (down.delete(e.code)) upEdge.add(e.code);
    }, true);
    on(window, 'blur', () => { down.clear(); setCtrl(false); K.finger = null; });
    on(window, 'mousedown', () => { K.padLast = false; }, true);
    on(window, 'mousemove', e => { if (K.padLast && Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) > 4) K.padLast = false; }, true);
    // Ctrl зажат — закрыть вкладку (Ctrl+W) случайно нельзя: браузер спросит
    const beforeUnload = e => { e.preventDefault(); e.returnValue = ''; return ''; };
    function setCtrl(v){
      K.ctrl = v;
      if (v && !guard) { guard = true; window.addEventListener('beforeunload', beforeUnload); }
      else if (!v && guard) { setTimeout(() => { if (!K.ctrl && guard) { guard = false; window.removeEventListener('beforeunload', beforeUnload); } }, 400); }
    }
    // во весь экран — «закрыть» клавиатуру (Chrome): Ctrl+W, Ctrl+T и Esc достаются игре, а не браузеру
    function fsLock(){
      const kb = navigator.keyboard;
      if (!kb?.lock) return;
      if (document.fullscreenElement) kb.lock(['KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyD', 'KeyS', 'KeyF', 'Tab']).catch(() => {});
      else try { kb.unlock(); } catch (e) {}
    }
    on(document, 'fullscreenchange', fsLock);

    // ── геймпад ──
    function pollPad(){
      const pads = navigator.getGamepads ? navigator.getGamepads() : null, gp = pads && [...pads].find(p => p && p.connected);
      if (!gp) { if (K.pad) { for (const c of padDown) down.delete(c); padDown.clear(); K.pad = false; K.padLast = false; } return; }
      K.pad = true;
      // стики (только «стандартная» раскладка: у других курки бывают осями, которые в покое = −1)
      if (!K.padLast && gp.mapping === 'standard') for (let i = 0; i < 4 && i < gp.axes.length; i++) if (Math.abs(gp.axes[i]) > .5) { K.padLast = true; break; }
      gp.buttons.forEach((b, i) => {
        const code = 'Pad' + i, p = (b.value ?? (b.pressed ? 1 : 0)) > .5;
        if (p && !padDown.has(code)) {
          padDown.add(code); K.padLast = true;
          if (K.capturing) { const cb = K.capturing; K.capturing = null; cb(code); return; }
          down.add(code); edge.add(code);
        } else if (!p && padDown.has(code)) { padDown.delete(code); down.delete(code); }
      });
    }

    // ── шаг: нажатия → действия ──
    K.step = (dt = 1 / 60) => {
      now += dt;
      pollPad();
      const blocked = blockedWin();
      for (const [id, s] of st) {
        const b = K.binds.get(id);
        const held = !!((b[0] && down.has(b[0])) || (b[1] && down.has(b[1]))) || virt.has(id);
        const e = !!((b[0] && edge.has(b[0])) || (b[1] && edge.has(b[1]))) || vEdge.has(id);
        const rel = !!((b[0] && upEdge.has(b[0])) || (b[1] && upEdge.has(b[1])));   // отпустили и нажали снова между шагами
        const prev = s.held;
        s.down = e && (!prev || rel); s.held = held || (e && !prev); s.up = (prev && !held) || (rel && !held);
        if (s.down) s.t0 = now;
        s.blocked = blocked;
      }
      edge.clear(); vEdge.clear(); upEdge.clear();
    };
    K.down = id => { const s = st.get(id); return !!s && !s.blocked && s.down; };
    K.downRaw = id => !!st.get(id)?.down;   // мимо окон (вещи закрываются той же клавишей)
    K.held = id => { const s = st.get(id); return !!s && !s.blocked && s.held; };
    K.up = id => !!st.get(id)?.up;
    K.heldTime = id => { const s = st.get(id); return s && s.held ? now - s.t0 : 0; };
    K.reset = () => { down.clear(); edge.clear(); virt.clear(); vEdge.clear(); for (const s of st.values()) Object.assign(s, { held: false, down: false, up: false }); };
    K.label = id => { const b = K.binds.get(id) || ['', '']; const pad = K.pad && b[1]; return C.keyName ? C.keyName(pad ? b[1] : b[0] || b[1]) : (b[0] || b[1]); };

    // ── палец по миру: короткое нажатие — K.taps, удержание — K.finger (кольцо и ломание — в игре) ──
    const joyZone = (e, b) => { const lefty = !!window.D37Opt?.lefty, lx = lefty ? b.right - e.clientX : e.clientX - b.left; return lx < b.width * .42 && (e.clientY - b.top) > b.height * .2; };
    let joyId = null;
    const fingers = new Map();
    if (el) {
      on(el, 'pointerdown', e => {
        if (e.pointerType !== 'touch' || !e.target?.classList?.contains('kb-gl')) return;
        const b = el.getBoundingClientRect();
        if (joyId == null && joyZone(e, b)) { joyId = e.pointerId; return; }   // этот палец — джойстик (input.js)
        fingers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false });
        if (!K.finger) K.finger = fingers.get(e.pointerId);
      });
      on(el, 'pointermove', e => {
        const f = fingers.get(e.pointerId); if (!f) return;
        f.x = e.clientX; f.y = e.clientY;
        if (Math.hypot(f.x - f.sx, f.y - f.sy) > 12) f.moved = true;
      });
      const up = e => {
        if (e.pointerId === joyId) { joyId = null; return; }
        const f = fingers.get(e.pointerId); if (!f) return;
        fingers.delete(e.pointerId);
        if (e.type === 'pointerup' && !f.moved && performance.now() - f.t < K.HOLD * 1000) K.taps.push({ x: f.x, y: f.y });
        if (K.finger === f) K.finger = null;
        if (fingers.size > 1) K.finger = null;
      };
      on(el, 'pointerup', up); on(el, 'pointercancel', up);
    }
    K.HOLD = .26;   // дольше — уже «держит»: ломать
    // держит мир: палец лежит дольше K.HOLD и до этого не двигался (протянул сразу — это «осмотреться», не ломать);
    // начал ломать — можно и вести пальцем (ломает то, что под ним)
    K.fingerHolding = () => {
      const f = K.finger; if (!f || fingers.size !== 1) return false;
      if (!f.mining && !f.moved && (performance.now() - f.t) / 1000 >= K.HOLD) f.mining = true;
      return !!f.mining;
    };
    K.frameEnd = () => {};

    // ── кнопки телефона: { id, icon, label, big, hold: 'jump' | 'sneak' | …, onTap, toggle, cls } ──
    // T-074: значки без постоянных подписей; подпись видна до первого нажатия этой кнопки (D37TouchLayout.seen, o.game) и пока
    // кнопку держат (.held); где стоит кнопка — решает D37TouchLayout (kubomir.js touchUI), здесь только position: absolute
    K.touchBar = (wrap, list, o = {}) => {
      let bar = wrap.querySelector('.kb-tbar');
      if (!bar) { bar = document.createElement('div'); bar.className = 'kb-tbar'; wrap.appendChild(bar); }
      bar.innerHTML = '';
      const byId = new Map(), TL = window.D37TouchLayout, game = o.game || '';
      for (const b of list) {
        const d = document.createElement('button');
        const fresh = !!(game && b.label && TL?.seen && !TL.seen(game, b.id));
        d.type = 'button'; d.className = 'kb-tbtn' + (b.big ? ' big' : '') + (b.cls ? ' ' + b.cls : '') + (fresh ? ' new' : ''); d.innerHTML = `${b.icon}${b.label ? `<b>${b.label}</b>` : ''}`;
        d.dataset.id = b.id;
        if (b.label) d.setAttribute('aria-label', b.label);
        const set = v => {
          d.classList.toggle('on', v);
          if (b.c) C.press(b.c, v);
          if (b.k) K.press(b.k, v);
        };
        d.addEventListener('pointerdown', e => {
          e.preventDefault(); e.stopPropagation(); try { d.setPointerCapture(e.pointerId); } catch (er) {}
          d.classList.add('held');
          if (d.classList.contains('new')) { d.classList.remove('new'); TL?.markSeen?.(game, b.id); }
          if (b.toggle) { d.classList.toggle('on', b.toggle()); return; } if (b.onTap) { b.onTap(); return; } set(true);
        });
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) d.addEventListener(ev, () => { d.classList.remove('held'); if (!b.toggle && !b.onTap) set(false); });
        bar.appendChild(d); byId.set(b.id, d);
      }
      return { el: bar, btn: id => byId.get(id), show: (id, v) => { const d = byId.get(id); if (d && d.hidden !== !v) d.hidden = !v; }, on: (id, v) => { const d = byId.get(id); if (d && d.classList.contains('on') !== !!v) d.classList.toggle('on', !!v); } };
    };
    // экранная кнопка своего действия (вниз в полёте и т. п.): как клавиша
    K.press = (id, v) => { if (v) { if (!virt.has(id)) vEdge.add(id); virt.add(id); } else virt.delete(id); };

    // ── настройки: список клавиш «Кубомира» (во вкладке ⚙️ → «🧊 Кубомир») ──
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const name = code => !code ? '—' : code.startsWith('Virt:') ? '—' : C.keyName ? C.keyName(code) : code;
    K.keysHtml = capId => {
      let h = '<div class="gs-keyg"><div class="gs-keyh">Клавиши «Кубомира» (как в Майнкрафте)</div>';
      for (const [id, title, d] of ACTS) {
        const b = K.binds.get(id), def = b[0] === d[0] && b[1] === d[1];
        const k = s => `<button type="button" class="gs-key${capId === id + ':' + s ? ' cap' : ''}" data-kbkey="${id}:${s}">${capId === id + ':' + s ? 'Нажми клавишу…' : esc(name(b[s]))}</button>`;
        h += `<div class="gs-krow"><span>${esc(title)}</span>${k(0)}${k(1)}<button type="button" class="gs-kreset" data-kbkeyreset="${id}" title="Как было" aria-label="Как было"${def ? ' disabled' : ''}>↺</button></div>`;
      }
      return h + '</div><p class="gs-note">Ходьба (WASD), прыжок (Пробел), ячейки 1–9, ломать (ЛКМ), поставить (ПКМ) и взять блок (СКМ) — во вкладке «Управление»: они общие для всех игр сайта.</p>';
    };
    // нажатие во вкладке → true, если надо перерисовать
    K.keysClick = (e, redraw) => {
      const r = e.target.closest('[data-kbkeyreset]');
      if (r) { const id = r.dataset.kbkeyreset, d = DEF.get(id); K.binds.set(id, [d[0], d[1]]); save(K.binds); redraw(); return true; }
      const b = e.target.closest('[data-kbkey]'); if (!b) return false;
      const [id, s] = b.dataset.kbkey.split(':');
      K.capId = id + ':' + s; redraw();
      K.capturing = code => { K.capId = null; if (code !== null) { const k = K.binds.get(id); k[+s] = code; save(K.binds); } redraw(); };
      return true;
    };
    K.dispose = () => { offs.forEach(f => f()); offs.length = 0; if (guard) { guard = false; window.removeEventListener('beforeunload', beforeUnload); } try { navigator.keyboard?.unlock?.(); } catch (e) {} };
    return K;
  }
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — управление по ДЕЙСТВИЯМ (перенос Core/Controls.cs из Unity-проекта Backrooms)
// ═══════════════════════════════════════
// Игра спрашивает не клавишу, а действие: C.down('jump'), C.held('run'). Какая клавиша за действием — решает игрок:
// 2 клавиши на действие (основная/запасная), свои — в localStorage d37_keys. Ещё геймпад (стандартная раскладка)
// и экранные кнопки телефона: C.press('jump', true/false) — тем же путём, что и клавиши (как SimPress в Unity).
// Чтение — в шаге логики: C.step(dt) в начале каждого шага 1/60 с (нажатие между шагами не теряется):
//   down(a) — нажали в этом шаге (вторая клавиша, пока держат первую, — не считается); held(a) — держат; up(a) — отпустили;
//   heldTime(a) — сколько секунд держат; heldFor(a, s) — держат не меньше s; hold(a, s) — ОДИН раз, когда удержание
//   перевалило за s; tap(a, maxS) — короткое нажатие (если та же клавиша у действия «с удержанием» — при отпускании
//   раньше порога, иначе = down); doubleTap(a) — второе нажатие за 0,28 с (третье — уже нет);
//   chordDown(a, b) — нажали вместе (≤ 0,12 с между нажатиями); move {x, z} — ходьба (клавиши −1/0/1, стик — плавно);
//   look {dx, dy, zoom} — поворот камеры правым стиком (в пикселях, как мышь) и приближение (крестовина ↑/↓ — zoomIn/zoomOut,
//   множитель как у колеса), забирает камера; сброс — C.frameEnd() после кадра.
// blocked = true (открыто окно) — игровые чтения молчат, кроме «запертых» (pause); downRaw/heldRaw — мимо замка.
// walk = true (вместе с blocked: открыт телефон 📱, как в ГТА) — ходить можно (move), всё остальное молчит (без бега и прыжка).
// off = true — клавиатура совсем мимо (не запоминаем и не гасим preventDefault): поверх мира открыта игра (js/games/mir-play.js).
// «Бежит сам» (22.10.2026, владелец: «касаешься мышкой за экраном — он бежит»): отпускание могло не дойти (меню правой кнопки
// мимо игры съедает keyup, вкладку спрятали, фокус ушёл в поле ввода, кнопку мыши отпустили за окном). Тогда всё отпускается
// само (C.releaseAll, счётчик C.released): blur окна, pagehide, скрытие вкладки, меню правой кнопки не над игрой (canvas его
// гасит), фокус в поле ввода; кнопки мыши сверяются с e.buttons на любом движении мыши по окну, Shift/Alt — с e.shiftKey/altKey.
// Шаг без мусора: состояния — массив, геймпад без копий списка (без геймпада браузер спрашивается раз в 0,5 с).
// Подсказки: label(a) «Пробел», hint(a) «[E]», fmt('Открыть {interact}') → «Открыть E», title(a) — название.
// Переназначение: get(a, slot), set(a, slot, code), reset(a), resetAll(), capture(cb) — ждёт клавишу (Esc — отмена),
// conflicts() — клавиша у двух действий. Новое действие — строка в ACTIONS; id не переименовывать (сбросит клавишу игрока).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const CHORD = .12, DOUBLE = .28, STORE = 'd37_keys';

  // id, название, группа, клавиши по умолчанию, порог удержания (с), запертое (не переназначается)
  const ACTIONS = [
    ['forward', 'Вперёд', 'Движение', ['KeyW', 'ArrowUp']],
    ['back', 'Назад', 'Движение', ['KeyS', 'ArrowDown']],
    ['left', 'Влево', 'Движение', ['KeyA', 'ArrowLeft']],
    ['right', 'Вправо', 'Движение', ['KeyD', 'ArrowRight']],
    ['run', 'Бег', 'Движение', ['ShiftLeft', 'Pad10']],
    ['jump', 'Прыжок / залезть на уступ', 'Движение', ['Space', 'Pad0']],
    ['crouch', 'Присесть (держать); на бегу — кувырок', 'Движение', ['KeyC', 'Pad1']],
    ['roll', 'Кувырок (+ направление)', 'Движение', ['KeyQ', '']],
    ['interact', 'Действие: открыть, сесть, взять', 'Действия', ['KeyE', 'Pad2']],
    ['build', 'Стройка (вкл/выкл)', 'Действия', ['KeyB', 'Pad3']],
    ['rotate', 'Стройка: повернуть деталь', 'Действия', ['KeyR', 'Pad5']],
    ['demolish', 'Стройка: улучшить / снести (держать)', 'Действия', ['KeyX', 'Pad4'], .8],
    ['inventory', 'Вещи', 'Действия', ['Tab', 'KeyI']],
    ['emote', 'Эмоции', 'Действия', ['KeyT', '']],
    ['attack', 'Удар (режимы игры с боем: «Каждый сам», «Команды», «Выживание»)', 'Действия', ['KeyF', 'Pad7']],
    // «Кубомир» (js/games/kubomir.js): ломать / ставить / взять блок под прицелом — мышью; на геймпаде ставит LT, ломает RT (удар)
    ['mine', 'Кубомир: ломать блок, ударить', 'Действия', ['Mouse0', '']],
    ['place', 'Кубомир: поставить блок, открыть, съесть', 'Действия', ['Mouse2', 'Pad6']],
    ['pick', 'Кубомир: взять блок под прицелом в руку', 'Действия', ['Mouse1', '']],
    ['horn', 'Сигнал (за рулём)', 'Транспорт', ['KeyH', '']],
    ['lights', 'Фары (за рулём)', 'Транспорт', ['KeyL', '']],
    ['chat', 'Написать в чат', 'Система', ['Enter', '']],
    ['view', 'Вид: от 1-го / 3-го лица', 'Система', ['KeyV', 'Pad11']],
    // приближение камеры (как колесо): до упора — вид от 1-го лица, обратно — от 3-го (camera.js rig.autoFirst)
    ['zoomIn', 'Камера ближе (до упора — от 1-го лица)', 'Система', ['', 'Pad12']],
    ['zoomOut', 'Камера дальше', 'Система', ['', 'Pad13']],
    ['map', 'Карта', 'Система', ['KeyM', 'Pad8']],
    ['pause', 'Пауза / назад', 'Система', ['Escape', 'Pad9'], 0, true],
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ['slot' + n, 'Ячейка ' + n, 'Ячейки', ['Digit' + n, '']]),
  ];
  const INFO = new Map(ACTIONS.map(([id, title, group, def, hold, locked]) => [id, { id, title, group, def, hold: hold || 0, locked: !!locked }]));

  // Русские имена клавиш
  const NAMES = { Space: 'Пробел', ShiftLeft: 'Shift', ShiftRight: 'Правый Shift', ControlLeft: 'Ctrl', ControlRight: 'Правый Ctrl',
    AltLeft: 'Alt', AltRight: 'Правый Alt', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: '⌫', CapsLock: 'Caps Lock',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: 'Ё', Minus: '−', Equal: '=', Comma: 'Б', Period: 'Ю',
    Slash: '.', Semicolon: 'Ж', Quote: 'Э', BracketLeft: 'Х', BracketRight: 'Ъ', Backslash: '\\',
    Mouse0: 'ЛКМ', Mouse1: 'СКМ', Mouse2: 'ПКМ', Mouse3: 'Мышь 4', Mouse4: 'Мышь 5', WheelUp: 'Колесо ↑', WheelDown: 'Колесо ↓',
    Pad0: 'Ⓐ', Pad1: 'Ⓑ', Pad2: 'Ⓧ', Pad3: 'Ⓨ', Pad4: 'LB', Pad5: 'RB', Pad6: 'LT', Pad7: 'RT', Pad8: 'Back', Pad9: 'Start',
    Pad10: 'L3', Pad11: 'R3', Pad12: 'Крестовина ↑', Pad13: 'Крестовина ↓', Pad14: 'Крестовина ←', Pad15: 'Крестовина →' };
  const keyName = code => !code ? '—' : NAMES[code] || (/^Key([A-Z])$/.exec(code)?.[1]) || (/^Digit(\d)$/.exec(code)?.[1]) ||
    (/^Numpad(\d)$/.exec(code) ? 'Num ' + code.slice(6) : /^F\d+$/.test(code) ? code : code);
  const typing = t => !!t?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');

  // кнопка мыши → бит e.buttons (0 — левая 1, 1 — средняя 4, 2 — правая 2, 3 — «назад» 8, 4 — «вперёд» 16)
  const MBIT = [1, 4, 2, 8, 16], MCODE = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];
  const PADC = Array.from({ length: 32 }, (_, i) => 'Pad' + i);   // имена кнопок геймпада — без склейки строк на каждом шаге
  const ZOOM_RATE = 1.7;   // крестовина ↑/↓: приближение за секунду (как ~1,5 щелчка колеса)

  // Выходы шага (ходьба, стики) — свои «классы», а не литералы { x, z }: у литералов одной формы скрытый класс V8 общий на всю
  // страницу, и одно нечисловое x где-нибудь в игре делало поле «любым» — каждая запись дробного заводила новый HeapNumber
  // (48 байт на шаг). Своя форма с дробным при создании — поле дробное навсегда, запись — на месте
  function XZ(){ this.x = .5; this.z = .5; this.x = 0; this.z = 0; }
  function Look(){ this.dx = .5; this.dy = .5; this.zoom = .5; this.dx = 0; this.dy = 0; this.zoom = 1; }

  E.controls = function (o = {}){
    const C = { blocked: false, walk: false, off: false, now: .5, move: new XZ(), look: new Look(), capturing: false, pad: false, actions: ACTIONS.map(a => a[0]), released: 0 };
    C.now = 0;
    const binds = new Map();                 // action → [code0, code1]
    const down = new Set();                  // клавиши, нажатые сейчас
    const edgeDown = new Set(), edgeUp = new Set();   // нажали/отпустили с прошлого шага
    const virt = new Map();                  // экранные кнопки: action → нажата
    const vEdge = new Set();                 // экранные: нажали с прошлого шага
    const st = new Map();                    // состояние действия (по id)
    const SL = [];                           // те же состояния массивом — шаг без перебора Map (без мусора)
    const stick = new XZ(), padMove = new XZ(), padDown = new Set();
    let captureCb = null, padSeen = false, padAsk = 0, bindsRev = 0;
    const offs = [];
    const on = (t, ev, f, opt) => { t.addEventListener(ev, f, opt); offs.push(() => t.removeEventListener(ev, f, opt)); };

    // ── Клавиши: свои поверх заводских ──
    function loadBinds(){
      let saved = {};
      try { saved = JSON.parse(root.localStorage?.getItem(STORE) || '{}') || {}; } catch (e) {}
      for (const [id, a] of INFO) {
        const s = !a.locked && Array.isArray(saved[id]) ? saved[id] : null;
        binds.set(id, [s ? String(s[0] || '') : a.def[0] || '', s ? String(s[1] || '') : a.def[1] || '']);
      }
      bindsRev++;
    }
    function saveBinds(){
      const out = {};
      for (const [id, a] of INFO) {
        const b = binds.get(id);
        if (b[0] !== (a.def[0] || '') || b[1] !== (a.def[1] || '')) out[id] = b;
      }
      try { root.localStorage?.setItem(STORE, JSON.stringify(out)); } catch (e) {}
    }
    loadBinds();
    let keysRev = root.D37Opt?.keysRev;
    for (const id of INFO.keys()) { const s = { id, held: false, down: false, up: false, t0: 0, ht: 0, upHt: 0, lastDown: -9, dbl: false, dblUsed: false, holdFired: false, tapUp: false }; st.set(id, s); SL.push(s); }
    const sF = st.get('forward'), sB = st.get('back'), sLf = st.get('left'), sRt = st.get('right'), sZI = st.get('zoomIn'), sZO = st.get('zoomOut');

    // Клавиши, общие с действием «с удержанием» (у тапа тогда — срабатывание при отпускании); ответ — до смены клавиш
    const shareMemo = new Map(); let shareRev = 0;
    const holdShare = id => {
      if (shareRev !== bindsRev) { shareMemo.clear(); shareRev = bindsRev; }
      let v = shareMemo.get(id);
      if (v === undefined) {
        v = 0;
        const mine = binds.get(id).filter(Boolean);
        for (const [other, a] of INFO) if (other !== id && a.hold > 0 && binds.get(other).some(c => c && mine.includes(c))) { v = a.hold; break; }
        shareMemo.set(id, v);
      }
      return v;
    };

    // ── Источники ──
    C.key = (code, isDown) => {           // и для тестов
      if (!code) return;
      if (isDown) { if (!down.has(code)) { down.add(code); edgeDown.add(code); } }
      else if (down.delete(code)) edgeUp.add(code);
    };
    C.press = (action, isDown) => {        // экранная кнопка
      const was = !!virt.get(action);
      virt.set(action, !!isDown);
      if (isDown && !was) vEdge.add(action);
    };
    C.stick = (x, z) => { stick.x = x; stick.z = z; };   // джойстик на экране (input.js)
    C.mouse = (button, isDown) => C.key(MCODE[button] || 'Mouse' + button, isDown);
    // Отпустить всё сразу (клавиши, кнопки мыши и геймпада, экранные кнопки, джойстик): «отпустили» придёт в следующем шаге.
    // Кнопку геймпада, которую всё ещё держат, нужно отпустить и нажать снова (без «лишних» нажатий); стики геймпада читаются
    // каждый шаг заново. why — для проверок (C.lastRelease)
    C.releaseAll = why => {
      for (const c of down) edgeUp.add(c);
      down.clear(); virt.clear(); vEdge.clear(); stick.x = stick.z = 0;
      C.released++; C.lastRelease = why || '';
    };
    // Кнопки мыши — по e.buttons любого события мыши (отпустили за окном или над чужим элементом — событие «отпустил» могло
    // не прийти), Shift и Alt — по флагам события (их keyup съедает меню правой кнопки, Alt+Tab)
    C.syncMouse = buttons => {
      for (let i = 0; i < MCODE.length; i++) if (!(buttons & MBIT[i]) && down.has(MCODE[i])) C.key(MCODE[i], false);
    };
    const syncMods = e => {
      if (!e.shiftKey) { if (down.has('ShiftLeft')) C.key('ShiftLeft', false); if (down.has('ShiftRight')) C.key('ShiftRight', false); }
      if (!e.altKey) { if (down.has('AltLeft')) C.key('AltLeft', false); if (down.has('AltRight')) C.key('AltRight', false); }
    };
    C.syncMods = syncMods;

    const isBound = code => { for (const b of binds.values()) if (b[0] === code || b[1] === code) return true; return false; };
    if (typeof window !== 'undefined' && o.listen !== false) {
      on(window, 'keydown', e => {
        if (captureCb) {
          e.preventDefault(); e.stopPropagation();
          const cb = captureCb; captureCb = null; C.capturing = false;
          cb(e.code === 'Escape' ? null : e.code);
          return;
        }
        if (typeof e.shiftKey === 'boolean') syncMods(e);
        if (C.off || typing(e.target) || e.ctrlKey || e.metaKey) return;   // off — игра поверх мира
        if (e.repeat) { if (isBound(e.code)) e.preventDefault(); return; }
        C.key(e.code, true);
        if (isBound(e.code) && !(e.code === 'Escape')) e.preventDefault();
        o.onKey?.(e);
      }, true);
      on(window, 'keyup', e => { C.key(e.code, false); if (typeof e.shiftKey === 'boolean') syncMods(e); }, true);
      on(window, 'blur', () => C.releaseAll('blur'));
      on(window, 'pagehide', () => C.releaseAll('pagehide'));
      // меню правой кнопки НЕ над игрой (холст игры его гасит — там правая кнопка своя): пока меню открыто, keyup до страницы
      // не доходит — W «держится» и персонаж бежит сам
      on(window, 'contextmenu', e => { if (!e.defaultPrevented) C.releaseAll('contextmenu'); });
      // фокус в поле ввода (чат, поиск, форма поверх игры) — клавиши теперь для текста
      on(window, 'focusin', e => { if (typing(e.target)) C.releaseAll('focus'); }, true);
      // кнопки мыши и Shift/Alt — по любому движению или нажатию мыши по окну (не только над игрой)
      const mouseSync = e => { if (e.pointerType === 'mouse' || e.pointerType === undefined) { if (typeof e.buttons === 'number') C.syncMouse(e.buttons); if (typeof e.shiftKey === 'boolean') syncMods(e); } };
      on(window, 'pointermove', mouseSync, true);
      on(window, 'pointerdown', mouseSync, true);
      on(window, 'pointerup', e => { if (e.pointerType === 'mouse') { C.mouse(e.button, false); mouseSync(e); } }, true);
      // свернули вкладку или ушли в другое приложение (на телефоне «blur» бывает не всегда) — отпустить всё, иначе бежит сам
      if (typeof document !== 'undefined') on(document, 'visibilitychange', () => { if (document.hidden) C.releaseAll('hidden'); });
      // геймпад: подключили — спрашивать каждый шаг (без него браузер спрашивается раз в 0,5 с — каждый ответ новый список)
      on(window, 'gamepadconnected', () => { padSeen = true; padAsk = 0; });
    }

    // ── Геймпад: кнопки → Pad0…Pad15, левый стик — ходьба, правый — камера ──
    const dz = v => Math.abs(v) < .18 ? 0 : (v - Math.sign(v) * .18) / .82;
    function padOff(){
      if (!C.pad) return;
      for (const c of padDown) C.key(c, false);
      padDown.clear(); padMove.x = padMove.z = 0; C.pad = false;
    }
    function pollPad(dt){
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (!nav || !nav.getGamepads) { padOff(); return; }
      if (!padSeen) { padAsk -= dt; if (padAsk > 0) return; padAsk = .5; }
      const pads = nav.getGamepads();
      let gp = null;
      if (pads) for (let i = 0; i < pads.length; i++) { const p = pads[i]; if (p && p.connected) { gp = p; break; } }
      if (!gp) { padSeen = false; padOff(); return; }
      padSeen = true; C.pad = true;
      const bs = gp.buttons, n = Math.min(bs.length, PADC.length);
      for (let i = 0; i < n; i++) {
        const b = bs[i], code = PADC[i], p = (b.value ?? (b.pressed ? 1 : 0)) > .5;
        if (p && !padDown.has(code)) { padDown.add(code); if (captureCb) { const cb = captureCb; captureCb = null; C.capturing = false; cb(code); } else C.key(code, true); }
        else if (!p && padDown.has(code)) { padDown.delete(code); C.key(code, false); }
      }
      const ax = gp.axes;
      padMove.x = dz(ax[0] || 0); padMove.z = -dz(ax[1] || 0);
      const lx = dz(ax[2] || 0), ly = dz(ax[3] || 0);
      C.look.dx += lx * Math.abs(lx) * 900 * dt; C.look.dy += ly * Math.abs(ly) * 700 * dt;
    }

    // ── Шаг: превратить накопленные нажатия в состояние действий (без мусора: перебор массива, без новых объектов) ──
    C.step = (dt = 1 / 60) => {
      C.now += dt;
      const O = root.D37Opt; if (O && O.keysRev !== keysRev) { keysRev = O.keysRev; loadBinds(); }   // клавиши сменили в окне ⚙️ (settings.js)
      pollPad(dt);
      const now = C.now;
      for (let i = 0; i < SL.length; i++) {
        const s = SL[i], id = s.id, b = binds.get(id), b0 = b[0], b1 = b[1];
        const heldKeys = (b0 !== '' && down.has(b0)) || (b1 !== '' && down.has(b1)) || virt.get(id) === true;
        const edge = (b0 !== '' && edgeDown.has(b0)) || (b1 !== '' && edgeDown.has(b1)) || vEdge.has(id);
        const prev = s.held;
        s.down = edge && !prev;
        s.held = heldKeys;
        // быстрое нажатие между шагами: нажали и отпустили — down и up в одном шаге
        s.up = (prev || s.down) && !heldKeys;
        s.dbl = false; s.tapUp = false;
        if (s.down) {
          s.t0 = now - dt;   // нажали где-то за этот шаг
          if (now - s.lastDown <= DOUBLE && !s.dblUsed) { s.dbl = true; s.dblUsed = true; } else s.dblUsed = false;
          s.lastDown = now; s.holdFired = false;
        }
        if (s.up) s.tapUp = true;
        s.ht = s.held ? now - s.t0 : 0;
        if (s.up) s.upHt = now - s.t0;
      }
      // Set.clear() в V8 заводит новую таблицу (~0,1 КБ) — чистим только непустые
      if (edgeDown.size) edgeDown.clear();
      if (edgeUp.size) edgeUp.clear();
      if (vEdge.size) vEdge.clear();
      // ходьба: клавиши (−1/0/1), стик на экране, геймпад — что сильнее. Math.sqrt, не Math.hypot: hypot с дробными в V8 —
      // вызов встроенной функции с «коробками» чисел (3 новых HeapNumber на вызов)
      let x = (sRt.held ? 1 : 0) - (sLf.held ? 1 : 0), z = (sF.held ? 1 : 0) - (sB.held ? 1 : 0);
      const d = Math.sqrt(x * x + z * z); if (d > 1) { x /= d; z /= d; }
      let ml = Math.sqrt(x * x + z * z);
      const sx = stick.x, sz = stick.z, ls = Math.sqrt(sx * sx + sz * sz); if (ls > ml) { x = sx; z = sz; ml = ls; }
      const px = padMove.x, pz = padMove.z, lp = Math.sqrt(px * px + pz * pz); if (lp > ml) { x = px; z = pz; ml = lp; }
      if (ml > 1) { x /= ml; z /= ml; }
      if ((C.blocked && !C.walk) || C.capturing) { x = 0; z = 0; }
      C.move.x = x; C.move.z = z;
      // приближение камеры с кнопок (крестовина ↑/↓): плавно, как колесо; камера заберёт в кадре (C.look.zoom)
      if (!C.blocked && !C.capturing) {
        if (sZI.held && !sZO.held) C.look.zoom *= Math.exp(-ZOOM_RATE * dt);
        else if (sZO.held && !sZI.held) C.look.zoom *= Math.exp(ZOOM_RATE * dt);
      }
    };
    C.frameEnd = () => { C.look.dx = 0; C.look.dy = 0; C.look.zoom = 1; };

    // ── Чтение ──
    const open = id => { const a = INFO.get(id); return !!a && !C.capturing && (!C.blocked || a.locked); };
    const NONE = Object.freeze({});
    const S = id => st.get(id) || NONE;
    C.down = id => open(id) && !!S(id).down;
    C.held = id => open(id) && !!S(id).held;
    C.up = id => open(id) && !!S(id).up;
    C.heldTime = id => open(id) ? S(id).ht || 0 : 0;
    C.heldFor = (id, s) => C.heldTime(id) >= s;
    C.hold = (id, s) => {
      const a = S(id), need = s ?? INFO.get(id)?.hold ?? .5;
      if (!open(id) || !a.held || a.holdFired || a.ht < need) return false;
      a.holdFired = true; return true;
    };
    C.tap = (id, maxS) => {
      if (!open(id)) return false;
      const a = S(id), share = holdShare(id), lim = maxS ?? share;
      if (!lim) return !!a.down;
      return !!a.tapUp && (a.upHt ?? 0) < lim;
    };
    C.doubleTap = id => open(id) && !!S(id).dbl;
    C.chordDown = (a, b) => {
      if (!open(a) || !open(b)) return false;
      const A = S(a), B = S(b);
      if (!A.held || !B.held || !(A.down || B.down)) return false;
      return Math.abs(A.t0 - B.t0) <= CHORD + 1e-6;
    };
    C.downRaw = id => !C.capturing && !!S(id).down;
    C.heldRaw = id => !C.capturing && !!S(id).held;
    C.any = () => { for (let i = 0; i < SL.length; i++) if (SL[i].down) return true; return false; };

    // ── Подсказки ──
    C.title = id => INFO.get(id)?.title || id;
    C.label = (id, slot) => {
      const b = binds.get(id); if (!b) return '—';
      if (slot != null) return keyName(b[slot]);
      // на геймпаде — кнопка геймпада, иначе клавиатура
      const pad = b.find(c => c && c.startsWith('Pad')), kb = b.find(c => c && !c.startsWith('Pad'));
      return keyName(C.pad && pad ? pad : kb || pad || '');
    };
    C.labelBoth = id => binds.get(id).filter(Boolean).map(keyName).join(' / ') || '—';
    C.hint = id => '[' + C.label(id) + ']';
    C.fmt = s => String(s).replace(/\{(\w+)\}/g, (m, id) => INFO.has(id) ? C.label(id) : m);
    C.keyName = keyName;

    // ── Переназначение ──
    C.list = () => ACTIONS.map(([id]) => ({ ...INFO.get(id), keys: [...binds.get(id)] }));
    C.get = (id, slot = 0) => binds.get(id)?.[slot] || '';
    C.set = (id, slot, code) => {
      const a = INFO.get(id); if (!a || a.locked) return false;
      binds.get(id)[slot ? 1 : 0] = code || ''; bindsRev++;
      saveBinds(); o.onChange?.(); return true;
    };
    C.reset = id => { const a = INFO.get(id); if (!a) return; binds.set(id, [a.def[0] || '', a.def[1] || '']); bindsRev++; saveBinds(); o.onChange?.(); };
    C.resetAll = () => { for (const [id, a] of INFO) binds.set(id, [a.def[0] || '', a.def[1] || '']); bindsRev++; saveBinds(); o.onChange?.(); };
    C.capture = cb => { captureCb = cb; C.capturing = true; };
    C.cancelCapture = () => { captureCb = null; C.capturing = false; };
    // Конфликты: одна клавиша у двух действий (кроме нарочно общих: присесть и кувырок на бегу — разные клавиши и так)
    C.conflicts = () => {
      const by = new Map(), out = [];
      for (const [id, b] of binds) for (const c of b) if (c) { if (!by.has(c)) by.set(c, []); by.get(c).push(id); }
      for (const [c, ids] of by) if (ids.length > 1) out.push({ code: c, name: keyName(c), actions: ids });
      return out;
    };
    C.reset_state = () => { down.clear(); edgeDown.clear(); edgeUp.clear(); virt.clear(); vEdge.clear(); stick.x = stick.z = 0; C.look.zoom = 1; for (const s of SL) { s.held = false; s.down = false; s.up = false; s.ht = 0; s.dbl = false; s.tapUp = false; } };
    C.dispose = () => { offs.forEach(f => f()); offs.length = 0; };
    return C;
  };
  E.controls.ACTIONS = ACTIONS;
  E.controls.keyName = keyName;
})();

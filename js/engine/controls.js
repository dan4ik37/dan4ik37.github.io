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
//   look {dx, dy} — поворот камеры правым стиком (в пикселях, как мышь), забирает камера.
// blocked = true (открыто окно) — игровые чтения молчат, кроме «запертых» (pause); downRaw/heldRaw — мимо замка.
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
    ['chat', 'Написать в чат', 'Система', ['Enter', '']],
    ['view', 'Вид: от 1-го / 3-го лица', 'Система', ['KeyV', 'Pad11']],
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

  E.controls = function (o = {}){
    const C = { blocked: false, now: 0, move: { x: 0, z: 0 }, look: { dx: 0, dy: 0 }, capturing: false, pad: false, actions: ACTIONS.map(a => a[0]) };
    const binds = new Map();                 // action → [code0, code1]
    const down = new Set();                  // клавиши, нажатые сейчас
    const edgeDown = new Set(), edgeUp = new Set();   // нажали/отпустили с прошлого шага
    const virt = new Map();                  // экранные кнопки: action → нажата
    const vEdge = new Set();                 // экранные: нажали с прошлого шага
    const st = new Map();                    // состояние действия
    let stick = { x: 0, z: 0 }, padMove = { x: 0, z: 0 }, padDown = new Set(), captureCb = null;
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
    for (const id of INFO.keys()) st.set(id, { held: false, down: false, up: false, t0: 0, ht: 0, lastDown: -9, dbl: false, dblUsed: false, holdFired: false, tapUp: false });

    // Клавиши, общие с действием «с удержанием» (у тапа тогда — срабатывание при отпускании)
    const holdShare = id => {
      const mine = binds.get(id).filter(Boolean);
      for (const [other, a] of INFO) if (other !== id && a.hold > 0 && binds.get(other).some(c => c && mine.includes(c))) return a.hold;
      return 0;
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
    C.mouse = (button, isDown) => C.key('Mouse' + button, isDown);

    const isBound = code => { for (const b of binds.values()) if (b[0] === code || b[1] === code) return true; return false; };
    if (typeof window !== 'undefined' && o.listen !== false) {
      on(window, 'keydown', e => {
        if (captureCb) {
          e.preventDefault(); e.stopPropagation();
          const cb = captureCb; captureCb = null; C.capturing = false;
          cb(e.code === 'Escape' ? null : e.code);
          return;
        }
        if (typing(e.target) || e.ctrlKey || e.metaKey) return;
        if (e.repeat) { if (isBound(e.code)) e.preventDefault(); return; }
        C.key(e.code, true);
        if (isBound(e.code) && !(e.code === 'Escape')) e.preventDefault();
        o.onKey?.(e);
      }, true);
      on(window, 'keyup', e => C.key(e.code, false), true);
      on(window, 'blur', () => { for (const c of [...down]) C.key(c, false); virt.clear(); stick.x = stick.z = 0; });
    }

    // ── Геймпад: кнопки → Pad0…Pad15, левый стик — ходьба, правый — камера ──
    function pollPad(dt){
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
      const gp = pads && [...pads].find(p => p && p.connected);
      if (!gp) { if (C.pad) { for (const c of padDown) C.key(c, false); padDown.clear(); padMove = { x: 0, z: 0 }; C.pad = false; } return; }
      C.pad = true;
      gp.buttons.forEach((b, i) => {
        const code = 'Pad' + i, p = (b.value ?? (b.pressed ? 1 : 0)) > .5;
        if (p && !padDown.has(code)) { padDown.add(code); if (captureCb) { const cb = captureCb; captureCb = null; C.capturing = false; cb(code); } else C.key(code, true); }
        else if (!p && padDown.has(code)) { padDown.delete(code); C.key(code, false); }
      });
      const dz = v => Math.abs(v) < .18 ? 0 : (v - Math.sign(v) * .18) / .82;
      padMove = { x: dz(gp.axes[0] || 0), z: -dz(gp.axes[1] || 0) };
      const lx = dz(gp.axes[2] || 0), ly = dz(gp.axes[3] || 0);
      C.look.dx += lx * Math.abs(lx) * 900 * dt; C.look.dy += ly * Math.abs(ly) * 700 * dt;
    }

    // ── Шаг: превратить накопленные нажатия в состояние действий ──
    C.step = (dt = 1 / 60) => {
      C.now += dt;
      pollPad(dt);
      const now = C.now;
      for (const [id, s] of st) {
        const b = binds.get(id);
        const heldKeys = (b[0] && down.has(b[0])) || (b[1] && down.has(b[1])) || !!virt.get(id);
        const edge = (b[0] && edgeDown.has(b[0])) || (b[1] && edgeDown.has(b[1])) || vEdge.has(id);
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
      edgeDown.clear(); edgeUp.clear(); vEdge.clear();
      // ходьба: клавиши (−1/0/1), стик на экране, геймпад — что сильнее
      const k = (id) => st.get(id).held ? 1 : 0;
      let x = k('right') - k('left'), z = k('forward') - k('back');
      const d = Math.hypot(x, z); if (d > 1) { x /= d; z /= d; }
      let m = { x, z };
      for (const s of [stick, padMove]) if (Math.hypot(s.x, s.z) > Math.hypot(m.x, m.z)) m = { x: s.x, z: s.z };
      const ml = Math.hypot(m.x, m.z); if (ml > 1) { m.x /= ml; m.z /= ml; }
      if (C.blocked || C.capturing) m = { x: 0, z: 0 };
      C.move.x = m.x; C.move.z = m.z;
    };
    C.frameEnd = () => { C.look.dx = 0; C.look.dy = 0; };

    // ── Чтение ──
    const open = id => { const a = INFO.get(id); return !!a && !C.capturing && (!C.blocked || a.locked); };
    const S = id => st.get(id) || { };
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
    C.any = () => { for (const s of st.values()) if (s.down) return true; return false; };

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
      binds.get(id)[slot ? 1 : 0] = code || '';
      saveBinds(); o.onChange?.(); return true;
    };
    C.reset = id => { const a = INFO.get(id); if (!a) return; binds.set(id, [a.def[0] || '', a.def[1] || '']); saveBinds(); o.onChange?.(); };
    C.resetAll = () => { for (const [id, a] of INFO) binds.set(id, [a.def[0] || '', a.def[1] || '']); saveBinds(); o.onChange?.(); };
    C.capture = cb => { captureCb = cb; C.capturing = true; };
    C.cancelCapture = () => { captureCb = null; C.capturing = false; };
    // Конфликты: одна клавиша у двух действий (кроме нарочно общих: присесть и кувырок на бегу — разные клавиши и так)
    C.conflicts = () => {
      const by = new Map(), out = [];
      for (const [id, b] of binds) for (const c of b) if (c) { if (!by.has(c)) by.set(c, []); by.get(c).push(id); }
      for (const [c, ids] of by) if (ids.length > 1) out.push({ code: c, name: keyName(c), actions: ids });
      return out;
    };
    C.reset_state = () => { down.clear(); edgeDown.clear(); edgeUp.clear(); virt.clear(); vEdge.clear(); stick = { x: 0, z: 0 }; for (const s of st.values()) Object.assign(s, { held: false, down: false, up: false, ht: 0, dbl: false, tapUp: false }); };
    C.dispose = () => { offs.forEach(f => f()); offs.length = 0; };
    return C;
  };
  E.controls.ACTIONS = ACTIONS;
  E.controls.keyName = keyName;
})();

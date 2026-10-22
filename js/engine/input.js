// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — мышь и палец: джойстик слева (ходьба → controls), камера — перетаскиванием, щипок/колесо —
//  приближение, короткие нажатия по миру (taps), от 1-го лица на компьютере — захват мыши (pointer lock)
// ═══════════════════════════════════════
// I = D37E.input(el, { controls: C, ignore: 'button, .e-btn' }) → I.look {dx, dy} (пиксели), I.zoom (множитель),
// I.taps [{x, y}] — короткие нажатия; кнопки мыши уходят в controls как Mouse0/1/2 (их можно назначить действию).
// Джойстик: палец в левой части экрана → C.stick(x, z), до упора — бег (C.press('run')). Клавиатура и геймпад — controls.js.
// I.wantLock = true (вид от 1-го лица на компьютере) — клик по миру захватывает мышь, Esc отпускает. Кадр — I.frameEnd().
// «Бежит сам» (22.10.2026): палец джойстика и мышь отпускаются, где бы их ни отпустили — «отпустил» ловит и окно (не только
// el: захват указателя мог не сработать или потеряться, el убрали из страницы), мышь без нажатых кнопок (e.buttons) на любом
// движении — отпущена; вкладку спрятали, страницу закрыли, окно потеряло фокус — джойстик и пальцы сброшены (I.reset).
// Без мусора на движение: число пальцев «камеры» считается, а не собирается массивом.
(() => {
  const E = window.D37E = window.D37E || {};
  const MBIT = [1, 4, 2, 8, 16];   // кнопка мыши → бит e.buttons

  E.input = function (el, opts = {}){
    const C = opts.controls;
    const I = { look: { dx: 0, dy: 0 }, zoom: 1, taps: [], enabled: true, touch: E.isTouch(), wantLock: false, locked: false, resets: 0 };
    const offs = [];
    const on = (t, ev, f, o) => { t.addEventListener(ev, f, o); offs.push(() => t.removeEventListener(ev, f, o)); };
    let joy = null;   // { id, ox, oy, x, y } — палец джойстика
    const joyR = () => Math.max(46, Math.min(70, el.clientWidth * .09));
    const updJoy = () => {
      if (!C) return;
      if (!joy) { C.stick(0, 0); C.press('run', false); return; }
      const R = joyR(), dx = (joy.x - joy.ox) / R, dy = (joy.y - joy.oy) / R, d = Math.hypot(dx, dy), k = d > 1 ? 1 / d : 1;
      if (d < .18) { C.stick(0, 0); C.press('run', false); return; }
      C.stick(dx * k, -dy * k);
      C.press('run', d > .92);
    };

    // ── Мышь и пальцы ──
    const ptrs = new Map();   // id → { x, y, sx, sy, t, moved, kind: 'look' | 'joy', btn, mouse }
    let pinch = 0, nLook = 0;   // nLook — сколько пальцев/кнопок сейчас крутят камеру
    I.pointers = () => ptrs.size;   // для проверок
    on(el, 'contextmenu', e => e.preventDefault());
    on(el, 'pointerdown', e => {
      if (!I.enabled || (opts.ignore && e.target.closest?.(opts.ignore))) return;
      const mouse = e.pointerType === 'mouse';
      // нажатие, которым возвращают мышь в мир, — только захват (блок не ломается, выстрела нет — как в Майнкрафте);
      // браузер в захвате отказал (I.lockFail) — нажатие идёт в игру как обычно
      const grab = mouse && I.wantLock && !I.locked && !!el.requestPointerLock;
      if (grab) I.lock();
      if (mouse && !(grab && !I.lockFail)) C?.mouse(e.button, true);
      if (I.locked) return;
      if (ptrs.has(e.pointerId)) drop(e.pointerId);   // тот же указатель без «отпустил» (потерялось) — старое забыть
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
      const b = el.getBoundingClientRect(), lefty = !!window.D37Opt?.lefty, lx = lefty ? b.right - e.clientX : e.clientX - b.left;   // левша (настройки) — джойстик справа
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, btn: e.button, kind: 'look', mouse };
      if (e.pointerType === 'touch' && !joy && lx < b.width * .42 && (e.clientY - b.top) > b.height * .2) {
        p.kind = 'joy'; joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }; showJoy(); updJoy();
      }
      ptrs.set(e.pointerId, p);
      if (p.kind === 'look' && ++nLook === 2) pinch = lookDist();
      e.preventDefault();
    });
    on(el, 'pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      // мышь: кнопку уже отпустили, а «отпустил» не пришёл (за окном, над чужим) — это и есть «отпустил»
      if (p.mouse && typeof e.buttons === 'number' && !(e.buttons & (MBIT[p.btn] || 1))) { up(e); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > (e.pointerType === 'touch' ? 10 : 5)) p.moved = true;
      if (p.kind === 'joy') { joy.x = e.clientX; joy.y = e.clientY; drawJoy(); updJoy(); return; }
      if (nLook >= 2) {
        const d = lookDist();
        if (pinch && d) I.zoom *= pinch / d;
        pinch = d;
        return;
      }
      if (p.moved) { I.look.dx += dx; I.look.dy += dy; }
    });
    // забыть указатель (без нажатия и без жеста)
    function drop(id){
      const p = ptrs.get(id); if (!p) return null;
      ptrs.delete(id);
      if (p.kind === 'joy') { if (joy && joy.id === id) { joy = null; hideJoy(); updJoy(); } }
      else if (--nLook < 2) pinch = 0;
      if (nLook < 0) nLook = 0;
      return p;
    }
    const up = e => {
      if (e.pointerType === 'mouse' && e.type === 'pointerup') C?.mouse(e.button, false);
      const p = drop(e.pointerId);
      if (!p || p.kind === 'joy') return;
      if (!p.moved && performance.now() - p.t < 450 && e.type === 'pointerup' && (p.btn === 0 || e.pointerType === 'touch')) I.taps.push({ x: e.clientX, y: e.clientY });
    };
    on(el, 'pointerup', up);
    on(el, 'pointercancel', up);
    on(el, 'lostpointercapture', up);   // захват потерян без «отпустил» (окно поверх, элемент спрятали) — иначе джойстик залипал и персонаж бежал сам
    // «отпустил» — где угодно: над шапкой сайта, мимо холста, за окном (окно ловит раньше el — фаза перехвата); захват
    // потерян, когда el уже убрали со страницы, — событие приходит документу
    const upAny = e => {
      if (e.pointerType === 'mouse' && I.locked && e.type === 'pointerup') C?.mouse(e.button, false);
      if (ptrs.has(e.pointerId)) up(e);
    };
    on(window, 'pointerup', upAny, true);
    on(window, 'pointercancel', upAny, true);
    on(document, 'lostpointercapture', upAny, true);
    // мышь двигают по окну без кнопки, а камера ещё «держит» её — отпустить (отпустили там, где события не было)
    on(window, 'pointermove', e => {
      if (e.pointerType !== 'mouse' || typeof e.buttons !== 'number') return;
      const p = ptrs.get(e.pointerId);
      if (p && p.mouse && !(e.buttons & (MBIT[p.btn] || 1))) up(e);
    }, true);
    on(el, 'wheel', e => { if (!I.enabled) return; e.preventDefault(); I.zoom *= e.deltaY > 0 ? 1.12 : 1 / 1.12; }, { passive: false });
    function lookDist(){
      let a = null, b = null;
      for (const q of ptrs.values()) if (q.kind === 'look') { if (!a) a = q; else { b = q; break; } }
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }
    // Захват мыши (вид от 1-го лица): движение мыши — поворот без нажатия
    // захвачено на el ИЛИ на чём-то внутри него (холст игры): раньше игра захватывала мышь холстом, а здесь ждали el —
    // мышь пропадала, камера не крутилась («Кубомир» после «Продолжить» и после окна вещей)
    const mine = () => { const p = document.pointerLockElement; return !!p && (p === el || !!el.contains?.(p)); };
    on(document, 'pointerlockchange', () => { I.locked = mine(); if (I.locked) I.lockFail = false; });
    on(document, 'pointerlockerror', () => { I.lockFail = true; });
    on(document, 'mousemove', e => { if (I.locked && I.enabled) { I.look.dx += e.movementX || 0; I.look.dy += e.movementY || 0; } });
    // захватить мышь (кнопка «Продолжить», закрыли окно) — всегда этим, а не requestPointerLock у своего элемента.
    // Браузер может отказать (сразу после Esc или без нажатия) — тогда I.lockFail, игра показывает «нажми на мир»
    I.lock = () => {
      if (I.locked || !el.requestPointerLock) return;
      try { const r = el.requestPointerLock(); r?.catch?.(() => { I.lockFail = true; }); } catch (er) { I.lockFail = true; }
    };
    I.unlock = () => { if (mine()) document.exitPointerLock?.(); };
    // окно без фокуса (Alt+Tab, клик в другую программу), вкладку спрятали, страницу закрывают — пальцы и джойстик сброшены
    const lost = () => { if (joy || ptrs.size) I.resets++; joy = null; hideJoy(); updJoy(); ptrs.clear(); nLook = 0; pinch = 0; };
    on(window, 'blur', lost);
    on(window, 'pagehide', lost);
    on(document, 'visibilitychange', () => { if (document.hidden) lost(); });

    // ── Джойстик на экране (появляется там, где коснулся палец) ──
    const jb = document.createElement('div'), jk = document.createElement('div');
    jb.className = 'e-joy'; jk.className = 'e-joy-k'; jb.appendChild(jk); jb.hidden = true;
    el.appendChild(jb);
    function showJoy(){ jb.hidden = false; drawJoy(); }
    function hideJoy(){ jb.hidden = true; }
    function drawJoy(){
      if (!joy) return;
      const b = el.getBoundingClientRect(), R = joyR();
      jb.style.cssText = `left:${joy.ox - b.left - R}px;top:${joy.oy - b.top - R}px;width:${R * 2}px;height:${R * 2}px`;
      const dx = joy.x - joy.ox, dy = joy.y - joy.oy, d = Math.hypot(dx, dy), k = d > R ? R / d : 1;
      jk.style.transform = `translate(${dx * k}px,${dy * k}px)`;
    }

    I.frameEnd = () => { I.look.dx = 0; I.look.dy = 0; I.zoom = 1; I.taps.length = 0; };
    I.reset = () => { joy = null; hideJoy(); ptrs.clear(); nLook = 0; pinch = 0; updJoy(); I.frameEnd(); };
    I.dispose = () => { I.unlock(); offs.forEach(f => f()); jb.remove(); };
    return I;
  };
})();

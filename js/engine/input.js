// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — мышь и палец: джойстик слева (ходьба → controls), камера — перетаскиванием, щипок/колесо —
//  приближение, короткие нажатия по миру (taps), от 1-го лица на компьютере — захват мыши (pointer lock)
// ═══════════════════════════════════════
// I = D37E.input(el, { controls: C, ignore: 'button, .e-btn' }) → I.look {dx, dy} (пиксели), I.zoom (множитель),
// I.taps [{x, y}] — короткие нажатия; кнопки мыши уходят в controls как Mouse0/1/2 (их можно назначить действию).
// Джойстик: палец в левой части экрана → C.stick(x, z), до упора — бег (C.press('run')). Клавиатура и геймпад — controls.js.
// I.wantLock = true (вид от 1-го лица на компьютере) — клик по миру захватывает мышь, Esc отпускает. Кадр — I.frameEnd().
(() => {
  const E = window.D37E = window.D37E || {};

  E.input = function (el, opts = {}){
    const C = opts.controls;
    const I = { look: { dx: 0, dy: 0 }, zoom: 1, taps: [], enabled: true, touch: E.isTouch(), wantLock: false, locked: false };
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
    let pinch = 0;
    on(el, 'contextmenu', e => e.preventDefault());
    on(el, 'pointerdown', e => {
      if (!I.enabled || (opts.ignore && e.target.closest?.(opts.ignore))) return;
      const mouse = e.pointerType === 'mouse';
      if (mouse && I.wantLock && !I.locked && el.requestPointerLock) { try { el.requestPointerLock(); } catch (er) {} }
      if (mouse) C?.mouse(e.button, true);
      if (I.locked) return;
      try { el.setPointerCapture(e.pointerId); } catch (er) {}
      const b = el.getBoundingClientRect(), lx = e.clientX - b.left;
      const p = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, btn: e.button, kind: 'look', mouse };
      if (e.pointerType === 'touch' && !joy && lx < b.width * .42 && (e.clientY - b.top) > b.height * .2) {
        p.kind = 'joy'; joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY }; showJoy(); updJoy();
      }
      ptrs.set(e.pointerId, p);
      if ([...ptrs.values()].filter(q => q.kind === 'look').length === 2) pinch = lookDist();
      e.preventDefault();
    });
    on(el, 'pointermove', e => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > (e.pointerType === 'touch' ? 10 : 5)) p.moved = true;
      if (p.kind === 'joy') { joy.x = e.clientX; joy.y = e.clientY; drawJoy(); updJoy(); return; }
      const looks = [...ptrs.values()].filter(q => q.kind === 'look');
      if (looks.length >= 2) {
        const d = lookDist();
        if (pinch && d) I.zoom *= pinch / d;
        pinch = d;
        return;
      }
      if (p.moved) { I.look.dx += dx; I.look.dy += dy; }
    });
    const up = e => {
      if (e.pointerType === 'mouse' && e.type === 'pointerup') C?.mouse(e.button, false);
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (p.kind === 'joy') { joy = null; hideJoy(); updJoy(); return; }
      if (!p.moved && performance.now() - p.t < 450 && e.type === 'pointerup' && (p.btn === 0 || e.pointerType === 'touch')) I.taps.push({ x: e.clientX, y: e.clientY });
      if ([...ptrs.values()].filter(q => q.kind === 'look').length < 2) pinch = 0;
    };
    on(el, 'pointerup', up);
    on(el, 'pointercancel', up);
    on(window, 'pointerup', e => { if (I.locked && e.pointerType === 'mouse') C?.mouse(e.button, false); });
    on(el, 'wheel', e => { if (!I.enabled) return; e.preventDefault(); I.zoom *= e.deltaY > 0 ? 1.12 : 1 / 1.12; }, { passive: false });
    function lookDist(){
      const l = [...ptrs.values()].filter(q => q.kind === 'look');
      return l.length >= 2 ? Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) : 0;
    }
    // Захват мыши (вид от 1-го лица): движение мыши — поворот без нажатия
    on(document, 'pointerlockchange', () => { I.locked = document.pointerLockElement === el; });
    on(document, 'mousemove', e => { if (I.locked && I.enabled) { I.look.dx += e.movementX || 0; I.look.dy += e.movementY || 0; } });
    I.unlock = () => { if (document.pointerLockElement === el) document.exitPointerLock?.(); };
    on(window, 'blur', () => { joy = null; hideJoy(); updJoy(); ptrs.clear(); });

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
    I.reset = () => { joy = null; hideJoy(); ptrs.clear(); updJoy(); I.frameEnd(); };
    I.dispose = () => { I.unlock(); offs.forEach(f => f()); jb.remove(); };
    return I;
  };
})();

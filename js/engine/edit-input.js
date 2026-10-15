// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — ввод в редакторе («Студия 3D») без привязки к странице: жесты пальцами, геймпад, чем человек
//  управляет сейчас (клавиатура и мышь / палец / геймпад). Чистая логика — проверяется в node (scripts/studio-modes-test.cjs)
// ═══════════════════════════════════════
// Жесты: g = D37E.gestures({ slop, longMs, tapMs, dblMs }) → g.down(id, x, y, t) / g.move(…) / g.up(id, x, y, t, cancel) /
//   g.tick(t) — каждое возвращает список событий: tap {x, y, double}, long {x, y}, dragstart {x, y, sx, sy}, drag {x, y, dx, dy},
//   dragend {x, y}, twostart {cx, cy}, two {cx, cy, dx, dy, scale, rot} (сдвиг центра, во сколько раз ближе пальцы, поворот в
//   радианах — за это событие), twoend. Третий палец не считается; после двух пальцев один оставшийся ничего не делает.
// Геймпад: p = D37E.padEdit({ deadzone }) → p.update(gp, dt, ctx) → { active, fly: {x, y, z}, look: {x, y}, fast, lift, radial,
//   actions: [] }. gp — navigator.getGamepads()[i] или { buttons: [{ pressed, value }], axes: [] } (стандартная раскладка);
//   ctx — { sel, grab, radial } (выбрано ли что-то, несём ли деталь, открыто ли круговое меню). Действия: select / place / back /
//   cancel / deselect / tool- / tool+ / rot- / rot+ / grid- / grid+ / angle- / angle+ / radial / radialPick / radialBack /
//   radialClose / play / focus / undo.
// Чем управляют: D37E.inputKind.kind — 'kb' | 'touch' | 'pad'; .set(k), .on(fn) → отписка, .listen() — слушать страницу.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};

  // ═══ Жесты пальцами ═══
  E.gestures = function (o = {}){
    const slop = o.slop ?? 10, longMs = o.longMs ?? 520, tapMs = o.tapMs ?? 450, dblMs = o.dblMs ?? 330, dblR = o.dblR ?? 28;
    const pts = new Map();   // id → { x, y, sx, sy, t0 }
    let mode = null;         // null — нет пальцев; one — один, ещё не ясно; drag; two; done — ждём, пока поднимут все
    let first = null, two = null, last = null;   // last — последний тап (для двойного)
    const ang = a => { while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; };
    const pair = () => { const [a, b] = [...pts.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) }; };
    const G = {
      get count(){ return pts.size; }, get mode(){ return mode; },
      down(id, x, y, t){
        const out = [];
        if (pts.size >= 2) return out;   // третий палец — мимо
        pts.set(id, { x, y, sx: x, sy: y, t0: t });
        if (pts.size === 1) { mode = 'one'; first = id; }
        else {
          if (mode === 'drag') { const p = pts.get(first); out.push({ type: 'dragend', x: p.x, y: p.y }); }
          if (mode === 'one' || mode === 'drag') { mode = 'two'; const q = pair(); two = { ...q }; out.push({ type: 'twostart', cx: q.cx, cy: q.cy }); }
        }
        return out;
      },
      move(id, x, y, t){
        const out = [], p = pts.get(id); if (!p) return out;
        const px = p.x, py = p.y; p.x = x; p.y = y;
        if (mode === 'one' && id === first && Math.hypot(x - p.sx, y - p.sy) > slop) { mode = 'drag'; out.push({ type: 'dragstart', x, y, sx: p.sx, sy: p.sy }); out.push({ type: 'drag', x, y, dx: x - p.sx, dy: y - p.sy }); }
        else if (mode === 'drag' && id === first) out.push({ type: 'drag', x, y, dx: x - px, dy: y - py });
        else if (mode === 'two' && pts.size === 2) {
          const q = pair();
          out.push({ type: 'two', cx: q.cx, cy: q.cy, dx: q.cx - two.cx, dy: q.cy - two.cy, scale: two.d > 1 && q.d > 1 ? q.d / two.d : 1, rot: ang(q.a - two.a) });
          two = q;
        }
        return out;
      },
      up(id, x, y, t, cancel){
        const out = [], p = pts.get(id); if (!p) return out;
        pts.delete(id);
        if (x !== undefined) { p.x = x; p.y = y; }
        if (mode === 'one' && id === first) {
          if (!cancel && t - p.t0 <= tapMs) {
            const dbl = !!last && t - last.t <= dblMs && Math.hypot(p.x - last.x, p.y - last.y) <= dblR;
            out.push({ type: 'tap', x: p.x, y: p.y, double: dbl });
            last = dbl ? null : { x: p.x, y: p.y, t };
          }
          mode = null;
        } else if (mode === 'drag' && id === first) { out.push({ type: 'dragend', x: p.x, y: p.y }); mode = null; }
        else if (mode === 'two') { out.push({ type: 'twoend' }); two = null; mode = pts.size ? 'done' : null; }
        else if (mode === 'done' && !pts.size) mode = null;
        if (!pts.size) { mode = null; first = null; }
        return out;
      },
      // долгое нажатие: один палец лежит на месте дольше longMs
      tick(t){
        if (mode !== 'one') return [];
        const p = pts.get(first); if (!p || t - p.t0 < longMs) return [];
        mode = 'done';
        return [{ type: 'long', x: p.x, y: p.y }];
      },
      reset(){ pts.clear(); mode = null; first = null; two = null; },
    };
    return G;
  };

  // ═══ Геймпад в редакторе ═══
  // A — выбрать / взять (если уже выбрано) / поставить; B — назад; X / Y — инструмент; LB / RB — повернуть (размер — меньше /
  // больше); LT / RT — вниз / вверх (несём деталь — её); крестовина ← → — шаг сетки, ↑ ↓ — шаг угла; Back (☰) — круговое
  // меню; Start — играть; R3 — к выбранному; L3 — быстрее; стики — лететь и смотреть. Держишь LB / RB / крестовину — повтор.
  const BT = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  E.padEdit = function (o = {}){
    const dz = o.deadzone ?? .18, rep0 = o.repeatDelay ?? .42, repT = o.repeatEvery ?? .12;
    let prev = [], held = new Map();   // кнопка → сколько держат (для повтора)
    const axis = v => Math.abs(v || 0) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz);
    const val = b => !b ? 0 : typeof b === 'number' ? b : b.value ?? (b.pressed ? 1 : 0);
    const P = {
      BT,
      update(gp, dt = 1 / 60, ctx = {}){
        const out = { active: false, fly: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0 }, fast: false, lift: 0, radial: null, actions: [] };
        if (!gp || !gp.buttons) { prev = []; held.clear(); return out; }
        const now = gp.buttons.map(b => val(b) > .5);
        const edge = i => now[i] && !prev[i];
        const rep = i => {   // нажали — сразу; держат — через rep0, дальше каждые repT
          if (!now[i]) { held.delete(i); return false; }
          if (!prev[i]) { held.set(i, 0); return true; }
          const h = (held.get(i) || 0) + dt; held.set(i, h);
          if (h < rep0) return false;
          const k = Math.floor((h - rep0) / repT), kp = Math.floor((h - dt - rep0) / repT);
          return h - dt < rep0 || k > kp;
        };
        const ax = gp.axes || [], lx = axis(ax[0]), ly = axis(ax[1]), rx = axis(ax[2]), ry = axis(ax[3]);
        const lt = val(gp.buttons[BT.LT]), rt = val(gp.buttons[BT.RT]);
        out.active = now.some(Boolean) || !!(lx || ly || rx || ry) || lt > .1 || rt > .1;
        const act = a => out.actions.push(a);
        if (ctx.radial) {
          const sx = lx || rx, sy = lx ? ly : ry;
          out.radial = { x: sx, y: sy };
          if (edge(BT.A)) act('radialPick');
          if (edge(BT.B)) act('radialBack');
          if (edge(BT.BACK) || edge(BT.START)) act('radialClose');
          prev = now; return out;
        }
        if (edge(BT.A)) act(ctx.grab ? 'place' : 'select');
        if (edge(BT.B)) act(ctx.grab ? 'cancel' : ctx.sel ? 'deselect' : 'back');
        if (edge(BT.X)) act('tool-');
        if (edge(BT.Y)) act('tool+');
        if (rep(BT.LB)) act('rot-');
        if (rep(BT.RB)) act('rot+');
        if (rep(BT.LEFT)) act('grid-');
        if (rep(BT.RIGHT)) act('grid+');
        if (rep(BT.UP)) act('angle+');
        if (rep(BT.DOWN)) act('angle-');
        if (edge(BT.BACK)) act('radial');
        if (edge(BT.START)) act('play');
        if (edge(BT.R3)) act('focus');
        out.fast = !!now[BT.L3];
        out.fly.x = lx; out.fly.z = -ly;
        if (ctx.grab) out.lift = rt - lt; else out.fly.y = rt - lt;
        out.look.x = rx; out.look.y = ry;
        prev = now;
        return out;
      },
      reset(){ prev = []; held.clear(); },
    };
    return P;
  };

  // ═══ Чем управляют сейчас: подсказки на экране меняются сами ═══
  E.inputKind = E.inputKind || (() => {
    const subs = new Set();
    let listening = false;
    const K = {
      kind: (() => { try { return root.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'kb'; } catch (e) { return 'kb'; } })(),
      set(k){ if (k === K.kind || !['kb', 'touch', 'pad'].includes(k)) return; K.kind = k; for (const f of [...subs]) { try { f(k); } catch (e) {} } },
      on(f){ subs.add(f); return () => subs.delete(f); },
      listen(){
        if (listening || !root.addEventListener) return; listening = true;
        root.addEventListener('keydown', e => { if (!e.repeat) K.set('kb'); }, true);
        root.addEventListener('pointerdown', e => K.set(e.pointerType === 'touch' ? 'touch' : 'kb'), true);
        root.addEventListener('wheel', () => K.set('kb'), { capture: true, passive: true });
      },
    };
    return K;
  })();
})();

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — взаимодействие: подсказка «[E] открыть» у того, на что смотришь, нажатие и удержание
//  (перенос Player/PlayerInteractor.cs + Core/IInteractable.cs из Unity-проекта Backrooms)
// ═══════════════════════════════════════
// X = D37E.interact(phys, { range }); X.add({ x, y, z, r, prompt(who) → текст | null (сейчас нельзя), act(who),
// hold: секунды удержания, key: действие (по умолчанию 'interact'), col: своё тело в физике (луч его не считает стеной) })
// → вещь (x/y/z можно менять). X.remove(вещь). Каждый шаг: X.update(dt, P, C, view) — view = куда смотрит камера {x, z},
// first — вид от 1-го лица (тогда целиться точнее). Цель — раз в 0,08 с: в досягаемости (3 м × U), впереди, ближе
// к центру взгляда, не за стеной. X.text — подсказка для экрана («[E] Сесть»), X.progress — кольцо удержания 0…1.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const U = E.UNIT || 2.1 / 1.8;

  E.interact = function (ph, o = {}){
    const X = { list: new Set(), cur: null, text: null, progress: 0, range: o.range ?? 3 * U, who: o.who ?? null, nextAt: 0, t: 0, holdT: 0, holdDone: false };
    X.add = it => { it.r ??= .6; it.key ??= 'interact'; X.list.add(it); return it; };
    X.remove = it => { X.list.delete(it); if (X.cur === it) { X.cur = null; X.text = null; X.progress = 0; } };
    X.clear = () => { X.list.clear(); X.cur = null; X.text = null; };

    function pick(P, view, first){
      const ch = P.ch, cx = ch.x, cy = ch.y + ch.h * .6, cz = ch.z;
      const vl = Math.hypot(view.x, view.z) || 1, vx = view.x / vl, vz = view.z / vl;
      const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
      let best = null, bestS = Infinity, bestText = null;
      for (const it of X.list) {
        if (it.enabled === false) continue;
        const dx = it.x - cx, dz = it.z - cz, dy = (it.y ?? ch.y + 1) - cy, flat = Math.hypot(dx, dz);
        const dist = Math.max(0, Math.hypot(flat, dy * .6) - it.r);
        if (dist > X.range || Math.abs(dy) > 2.6 * U) continue;
        const dot = flat < 1e-3 ? 1 : (dx * vx + dz * vz) / flat, dotB = flat < 1e-3 ? 1 : (dx * fx + dz * fz) / flat;
        // от 1-го лица — точно по взгляду; от 3-го — впереди тела или по взгляду камеры
        const aim = first ? dot : Math.max(dot, dotB);
        if (aim < (first ? .55 : -.1) && dist > .35) continue;
        const text = it.prompt ? it.prompt(X.who) : it.label;
        if (!text) continue;
        // не через стену
        const len = Math.hypot(flat, dy);
        if (ph && len > .2) {
          const h = ph.raycast(cx, cy, cz, dx / len, dy / len, dz / len, len, c => c !== it.col && !c.data?.noBlock);
          if (h && h.t < len - it.r - .1) continue;
        }
        const s = dist + (1 - aim) * 1.5;
        if (s < bestS) { bestS = s; best = it; bestText = text; }
      }
      return [best, bestText];
    }

    X.update = (dt, P, C, view, first = false) => {
      X.t += dt;
      if (P?.mode === 'sit') { X.cur = null; X.text = (C ? C.hint('interact') + ' ' : '') + 'Встать'; X.progress = 0; return; }
      if (!P || P.mode !== 'move' || P.now < (P.busyUntil || 0)) { X.cur = null; X.text = null; X.progress = 0; return; }
      if (X.t >= X.nextAt || (C && C.down('interact'))) {
        X.nextAt = X.t + .08;
        const [it, text] = pick(P, view || { x: Math.sin(P.yaw), z: Math.cos(P.yaw) }, first);
        if (it !== X.cur) { X.cur = it; X.holdT = 0; X.holdDone = false; }
        X.raw = text;
        X.text = it && text ? (C ? C.hint(it.key) + ' ' : '') + (it.hold ? 'держать — ' : '') + text : null;
      }
      const it = X.cur;
      if (!it || !C) { X.progress = 0; return; }
      if (!it.hold) {
        if (C.down(it.key)) { X.progress = 0; it.act?.(X.who, P); X.nextAt = 0; }
        return;
      }
      // удержание: кольцо заполняется, отпустил раньше — сброс; сработало — до следующего нажатия
      if (C.held(it.key) && !X.holdDone) {
        X.holdT += dt; X.progress = Math.min(1, X.holdT / it.hold);
        if (X.holdT >= it.hold) { X.holdDone = true; X.progress = 0; it.act?.(X.who, P); X.nextAt = 0; }
      } else if (!C.held(it.key)) { X.holdT = 0; X.progress = 0; X.holdDone = false; }
    };
    return X;
  };
})();

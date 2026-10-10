// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — NPC (персонажи без игрока, как Humanoid-модели в Roblox): стоит и смотрит на игрока, бродит рядом,
//  идёт следом, убегает; урон при касании (зомби), фраза при подходе (торговец). Ходят тем же player.js, что и игрок:
//  ступеньки, стены, склоны, вода — как у всех.
// ═══════════════════════════════════════
// N = D37E.npcs(R, phys) → свои человечки (actors). Объекты сцены класса NPC сами зовут N.add/N.remove/N.sync (SC.npc = N).
// Игра: N.start({ onHit(npc, урон), onSay(npc, текст) }) → каждый шаг N.step(dt, игроки [{ x, y, z }]) → кадр N.frame(dt, t, cam)
// → N.stop(). Поведение (obj.act): idle — стоит, wander — бродит в радиусе obj.radius, follow — идёт к ближайшему игроку,
// flee — убегает. obj.speed — множитель скорости, obj.damage — урон в секунду при касании, obj.text — фраза при подходе.
// Внешность (obj.look): random — своя по obj.seed, me — как у игрока, zombie / robot / alien / fairy — кожа такого цвета.
(() => {
  const E = window.D37E = window.D37E || {};
  const U = E.UNIT || 2.1 / 1.8;
  const LOOKS = { random: ['🎲', 'Случайная'], me: ['🪞', 'Как у меня'], zombie: ['🧟', 'Зомби'], robot: ['🤖', 'Робот'], alien: ['👽', 'Пришелец'], fairy: ['🧚', 'Фея'] };
  const ACTS = { idle: ['🧍', 'Стоит, смотрит на игрока'], wander: ['🚶', 'Бродит рядом'], follow: ['🏃', 'Идёт за игроком'], flee: ['🐔', 'Убегает от игрока'] };
  const lookOf = o => o.look === 'me' ? (window.D37Char?.look?.() || {}) : LOOKS[o.look] && o.look !== 'random' ? { tone: o.look } : {};
  const keyOf = o => 'npc:' + (o.seed || o.id);

  E.npcs = function (R, ph){
    const A = E.actors(R), list = new Map();
    const N = { A, list, LOOKS, ACTS, playing: false };
    // поддельное управление: «вперёд» = направление в мире (камера для player.js — сзади по оси z)
    const pad = () => ({ move: { x: 0, z: 0 }, run: false, held(k){ return k === 'run' ? this.run : false; }, down: () => false, up: () => false, hint: () => '', chordDown: () => false, look: { dx: 0, dy: 0 } });
    const CAM = { yaw: Math.PI };
    N.add = o => {
      N.remove(o);
      const e = { o, key: keyOf(o), home: o.pos.slice(), P: null, C: null, tgt: null, waitT: 0, stuckT: 0, hitT: 0, sayT: 0, near: false };
      A.add(e.key, lookOf(o), { x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: (o.rot?.[1] || 0) * Math.PI / 180 });
      list.set(o.id, e);
    };
    N.remove = o => { const e = list.get(o.id); if (!e) return; A.remove(e.key); list.delete(o.id); };
    // в редакторе: подвинули, повернули, сменили внешность
    N.sync = o => {
      const e = list.get(o.id); if (!e) return N.add(o);
      if (e.key !== keyOf(o)) { N.add(o); return; }
      A.setLook(A.get(e.key), lookOf(o));
      if (!N.playing) { e.home = o.pos.slice(); A.pose(e.key, { x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: (o.rot?.[1] || 0) * Math.PI / 180, moving: false }); }
    };
    N.start = (cb = {}) => {
      N.playing = true; N.cb = cb;
      for (const e of list.values()) {
        e.home = e.o.pos.slice();
        e.C = pad();
        e.P = E.player(ph, { x: e.home[0], z: e.home[2], yaw: (e.o.rot?.[1] || 0) * Math.PI / 180 });
        e.P.place(e.home[0], null, e.home[2], e.P.yaw);
        if (e.home[1] > e.P.ch.y + .3) e.P.place(e.home[0], e.home[1], e.home[2], e.P.yaw);   // стоит на чём-то — не на земле
        e.P.canRun = true; e.waitT = Math.random() * 2;
      }
    };
    N.stop = () => {
      N.playing = false; N.cb = null;
      for (const e of list.values()) { e.P = e.C = e.tgt = null; A.pose(e.key, { x: e.home[0], y: e.home[1], z: e.home[2], moving: false, speed: 0, air: false, swim: false }); }
    };
    // ── мозги: раз в шаг ──
    N.step = (dt, players = []) => {
      if (!N.playing) return;
      for (const e of list.values()) {
        const P = e.P, C = e.C, ch = P?.ch, o = e.o; if (!P) continue;
        let best = null, bd = Infinity;
        for (const p of players) { const d = Math.hypot(p.x - ch.x, p.z - ch.z); if (d < bd && Math.abs(p.y - ch.y) < 6 * U) { bd = d; best = p; } }
        const sp = Math.max(.2, Math.min(3, o.speed ?? 1));
        let dx = 0, dz = 0, run = false;
        if (o.act === 'follow' && best && bd < 30 * U && bd > ((o.damage || 0) > 0 ? .9 : 1.6) * U) { dx = best.x - ch.x; dz = best.z - ch.z; run = bd > 8 * U; }   // кусачий подходит вплотную
        else if (o.act === 'flee' && best && bd < 9 * U) { dx = ch.x - best.x; dz = ch.z - best.z; run = true; }
        else if (o.act === 'wander' || (o.act === 'flee' && !(best && bd < 9 * U))) {
          // бродит: точка в радиусе от дома, дошёл или застрял — постоял и новая
          const r = Math.max(1, o.radius ?? 8) * U;
          if (!e.tgt) { if ((e.waitT -= dt) <= 0) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r; e.tgt = [e.home[0] + Math.cos(a) * d, e.home[2] + Math.sin(a) * d]; e.stuckT = 0; } }
          if (e.tgt) {
            dx = e.tgt[0] - ch.x; dz = e.tgt[1] - ch.z;
            if (Math.hypot(dx, dz) < .5 * U) { e.tgt = null; e.waitT = 1.5 + Math.random() * 3; dx = dz = 0; }
            else if (P.speed < .2 * U && (e.stuckT += dt) > 1.2) { e.tgt = null; e.waitT = .5; dx = dz = 0; }
            else e.stuckT = 0;
          }
        }
        const l = Math.hypot(dx, dz);
        C.move.x = l > 1e-3 ? -dx / l : 0; C.move.z = l > 1e-3 ? dz / l : 0; C.run = run;
        P.speedMul = sp;
        P.update(dt, C, CAM);
        // стоит — поворачивается к игроку рядом
        if (l < 1e-3 && best && bd < 6 * U) P.yaw = E.dampAngle(P.yaw, Math.atan2(best.x - ch.x, best.z - ch.z), 6, dt);
        // урон при касании (зомби): раз в секунду
        if ((o.damage || 0) > 0 && best && bd < 1.5 * U && Math.abs(best.y - ch.y) < 2 * U) { if ((e.hitT -= dt) <= 0) { e.hitT = 1; N.cb?.onHit?.(e, o.damage, best); } }
        else e.hitT = Math.min(e.hitT, .3);
        // фраза при подходе (не чаще раза в 8 с)
        const near = !!best && bd < 5 * U;
        if (near && !e.near && o.text && e.sayT <= 0) { N.cb?.onSay?.(e, String(o.text).slice(0, 80)); e.sayT = 8; }
        e.sayT = Math.max(0, e.sayT - dt); e.near = near;
        // упал за край мира — домой
        if (ch.y < -60) P.place(e.home[0], null, e.home[2]);
      }
    };
    N.frame = (dt, t, cam) => {
      if (N.playing) for (const e of list.values()) if (e.P) A.pose(e.key, e.P.pose());
      A.update(dt, t, cam);
    };
    // где голова (для облачка с фразой): [x, y, z]
    N.head = e => { const a = A.get(e.key); return a ? [a.x, a.y + A.top(e.key) + .3, a.z] : null; };
    N.dispose = () => { A.dispose(); list.clear(); };
    return N;
  };
  E.npcs.LOOKS = LOOKS; E.npcs.ACTS = ACTS;
})();

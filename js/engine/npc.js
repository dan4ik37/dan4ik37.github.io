// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — NPC (персонажи без игрока, как Humanoid-модели в Roblox): стоит и смотрит на игрока, бродит рядом,
//  идёт следом, убегает; урон при касании (зомби), фраза при подходе (торговец). Ходят тем же player.js, что и игрок:
//  ступеньки, стены, склоны, вода — как у всех.
// ═══════════════════════════════════════
// N = D37E.npcs(R, phys) → свои человечки (actors). Объекты сцены класса NPC сами зовут N.add/N.remove/N.sync (SC.npc = N).
// Игра: N.start({ onHit(npc, урон), onSay(npc, текст) }) → каждый шаг N.step(dt, игроки [{ x, y, z }]) → кадр N.frame(dt, t, cam)
// → N.stop(). Поведение (obj.act): idle — стоит, wander — бродит в радиусе obj.radius, follow — идёт к ближайшему игроку,
// flee — убегает. obj.speed — множитель скорости, obj.damage — урон в секунду при касании, obj.text — фраза при подходе.
// Внешность (obj.look): random — своя по obj.seed, me — как у игрока, zombie / alien / fairy — кожа такого цвета,
// robot / knight — весь из частей тела робота / рыцаря. obj.phone — иногда достаёт телефон 📱 (смотрит, говорит, играет) по своему
// расписанию от seed (у всех игроков одинаково, без сети); подошёл игрок — убирает (N.phoneAt(seed, t) → '' | use | call | play).
// AI LOD P1 (T-127, E:\d37-core\spec\AI_LOD.md §10.2): состояние мозгов — в типизированных массивах (SoA, без мусора на шаге);
// «подумать» (кто ближе, куда бродить) — раз в THINK шагов в наименее занятой фазе (у всех поровну, без комков); шаги тела,
// поворот, укус — каждый шаг; случайность — своя у каждого по seed (одинаково на телефоне и ПК, при 30 / 60 / 144 кадрах);
// тела player.js — из пула (wake не создаёт новое тело каждый раз); стоит на земле 0,5 с и никуда не хочет — тело спит (B3: шаг
// тела не считается), просыпается, когда захотел идти, его толкнули или опору рядом изменили. N.stats() → { n, awake, asleep, pool }.
// Откат одной строкой: LOD = false — как было до T-127.
(() => {
  const E = window.D37E = window.D37E || {};
  const U = E.UNIT || 2.1 / 1.8;
  const LOOKS = { random: ['🎲', 'Случайная'], me: ['🪞', 'Как у меня'], zombie: ['🧟', 'Зомби'], robot: ['🤖', 'Робот'], alien: ['👽', 'Пришелец'], fairy: ['🧚', 'Фея'] };
  const ACTS = { idle: ['🧍', 'Стоит, смотрит на игрока'], wander: ['🚶', 'Бродит рядом'], follow: ['🏃', 'Идёт за игроком'], flee: ['🐔', 'Убегает от игрока'] };
  LOOKS.knight = ['🛡️', 'Рыцарь'];
  // робот и рыцарь — целиком из частей тела своего пакета (голова, туловище, руки, ноги)
  const pack = p => ({ psh: p, pst: p, psal: p, psar: p, psll: p, pslr: p });
  const lookOf = o => o.look === 'me' ? (window.D37Char?.look?.() || {}) : o.look === 'robot' ? { tone: 'robot', ...pack('robot') } : o.look === 'knight' ? pack('knight')
    : LOOKS[o.look] && o.look !== 'random' ? { tone: o.look } : {};
  const keyOf = o => 'npc:' + (o.seed || o.id);
  // Телефон жителя: расписание (с) — то смотрит в экран, то говорит, то играет; свой темп и сдвиг по seed — толпа не синхронна
  const PH_PLAN = [['use', 7], ['', 15], ['call', 9], ['', 19], ['use', 5], ['', 13], ['play', 6], ['', 17]];
  const PH_LEN = PH_PLAN.reduce((s, p) => s + p[1], 0);
  const phHash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const phoneAt = (seed, t) => phoneAtH(phHash(seed), t);
  const phoneAtH = (h, t) => {
    const k = .85 + (h % 31) / 100;
    let x = ((t / k + (h >>> 5) % PH_LEN) % PH_LEN + PH_LEN) % PH_LEN;
    for (const [s, d] of PH_PLAN) { if (x < d) return s; x -= d; }
    return '';
  };
  const LOD = true;          // T-127: false — откат одной строкой (думает каждый шаг, Math.random, новое тело при каждом wake, без сна)
  const THINK = 8;           // «подумать» раз в 8 шагов (7,5 раза в секунду при 60 Гц); фазы 0…7 — наименее занятая
  const SLEEP_STEPS = 30;    // 0,5 с неподвижно на земле → тело спит
  const POOL_MAX = 64;       // сколько тел держать про запас (b0_max site_room — каждый живой)
  const h32 = phHash;        // FNV-1a: зерно случайности из seed / id
  const hyp = (x, y) => Math.sqrt(x * x + y * y);   // не Math.hypot: точность у sqrt одна во всех браузерах (у hypot — своя у движка), и без лишних чисел в куче

  E.npcs = function (R, ph){
    const A = E.actors(R), list = new Map();
    const N = { A, list, LOOKS, ACTS, playing: false, tick: 0, lod: LOD };
    // поддельное управление: «вперёд» = направление в мире (камера для player.js — сзади по оси z)
    const pad = () => ({ move: { x: 0, z: 0 }, run: false, held(k){ return k === 'run' ? this.run : false; }, down: () => false, up: () => false, hint: () => '', chordDown: () => false, look: { dx: 0, dy: 0 } });
    const CAM = { yaw: Math.PI };
    // ── мозги (SoA): индекс e.i у каждого; массивы растут удвоением (единственное выделение памяти) ──
    let cap = 0, ph8, rs, waitT, stuckT, hitT, sayT, tx, tz, hasT, nearF, still, sleep, bi, wakeQ;
    const free = [], arr = [], pool = [], phc = new Int32Array(THINK);
    function grow(c){
      const o = { ph8, rs, waitT, stuckT, hitT, sayT, tx, tz, hasT, nearF, still, sleep, bi, wakeQ };
      ph8 = new Uint8Array(c); rs = new Uint32Array(c); waitT = new Float64Array(c); stuckT = new Float64Array(c); hitT = new Float64Array(c); sayT = new Float64Array(c);
      tx = new Float64Array(c); tz = new Float64Array(c); hasT = new Uint8Array(c); nearF = new Uint8Array(c); still = new Uint16Array(c); sleep = new Uint8Array(c);
      bi = new Int16Array(c); wakeQ = new Uint8Array(c);
      if (o.ph8) { ph8.set(o.ph8); rs.set(o.rs); waitT.set(o.waitT); stuckT.set(o.stuckT); hitT.set(o.hitT); sayT.set(o.sayT); tx.set(o.tx); tz.set(o.tz); hasT.set(o.hasT); nearF.set(o.nearF); still.set(o.still); sleep.set(o.sleep); bi.set(o.bi); wakeQ.set(o.wakeQ); }
      for (let i = c - 1; i >= cap; i--) free.push(i);
      cap = c;
    }
    grow(16);
    // своя случайность у каждого (mulberry32 от seed / id): одинаково на любом устройстве и частоте кадров
    const rnd = i => { let a = rs[i] = (rs[i] + 0x6D2B79F5) >>> 0; a = Math.imul(a ^ (a >>> 15), a | 1); a ^= a + Math.imul(a ^ (a >>> 7), a | 61); return ((a ^ (a >>> 14)) >>> 0) / 4294967296; };
    N.add = o => {
      N.remove(o);
      const e = { o, key: keyOf(o), home: o.pos.slice(), P: null, C: null, tgt: null, waitT: 0, stuckT: 0, hitT: 0, sayT: 0, near: false, phH: null, i: -1, homeYaw: 0 };
      A.add(e.key, lookOf(o), { x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: (o.rot?.[1] || 0) * Math.PI / 180 }, { npc: true });
      list.set(o.id, e);
      if (LOD) { if (!free.length) grow(cap * 2); e.i = free.pop(); arr.push(e); }
      if (N.playing) wake(e);   // появился во время игры (волна зомби «Выживания», скрипт) — сразу с мозгами
    };
    // «мозги» и тело (player.js) — при старте игры и для появившихся по ходу
    function wake(e){
      if (!LOD) return wakeV1(e);
      e.home = e.o.pos.slice();
      const yaw = (e.o.rot?.[1] || 0) * Math.PI / 180, b = pool.pop();
      if (b) {   // тело из пула: как новое (поза, скорость, выносливость, режим)
        e.P = b.P; e.C = b.C; const P = e.P;
        P.stamina = P.maxStamina; P.exhausted = false; P.speedMul = 1; P.running = P.moving = false; P.speed = 0; P._buf = 0; P._jumped = false; P._sprint = false; P.enabled = true;
        P.ch.airT = 0; e.C.move.x = e.C.move.z = 0; e.C.run = false;
        P.place(e.home[0], e.home[1], e.home[2], yaw);
      } else { e.C = pad(); e.P = E.player(ph, { x: e.home[0], z: e.home[2], yaw }); }
      e.P.place(e.home[0], homeY(e), e.home[2], e.P.yaw);   // опора под точкой дома — не крыша над ней (житель в доме)
      if (e.home[1] > e.P.ch.y + .3) e.P.place(e.home[0], e.home[1], e.home[2], e.P.yaw);   // стоит на чём-то — не на земле
      e.P.canRun = true; e.homeYaw = e.P.yaw;
      const i = e.i;
      // фаза «подумать»: наименее занятая (при равенстве — меньшая)
      let best = 0; for (let k = 1; k < THINK; k++) if (phc[k] < phc[best]) best = k;
      ph8[i] = best; phc[best]++;
      rs[i] = h32(e.o.seed || e.o.id) || 1;
      waitT[i] = rnd(i) * 2; stuckT[i] = 0; hitT[i] = 0; sayT[i] = 0; hasT[i] = 0; nearF[i] = 0; still[i] = 0; sleep[i] = 0; bi[i] = -1; wakeQ[i] = 1;
      e.near = false;
    }
    function wakeV1(e){
      e.home = e.o.pos.slice();
      e.C = pad();
      e.P = E.player(ph, { x: e.home[0], z: e.home[2], yaw: (e.o.rot?.[1] || 0) * Math.PI / 180 });
      e.P.place(e.home[0], homeY(e), e.home[2], e.P.yaw);   // опора под точкой дома — не крыша над ней (житель в доме)
      if (e.home[1] > e.P.ch.y + .3) e.P.place(e.home[0], e.home[1], e.home[2], e.P.yaw);   // стоит на чём-то — не на земле
      e.P.canRun = true; e.waitT = Math.random() * 2; e.homeYaw = e.P.yaw;
    }
    // высота опоры под домом жителя: самое высокое не выше его точки (+ ступенька) — P.place(…, null) поставил бы на крышу
    const homeY = e => ph.supportAt(e.home[0], e.home[2], (e.P?.ch.r || .42) * .5, (e.home[1] || 0) + .7).y;
    // тело — в пул (не больше POOL_MAX), фаза освободилась
    function freeBody(e){
      if (!e.P) return;
      if (LOD) { phc[ph8[e.i]]--; if (pool.length < POOL_MAX) pool.push({ P: e.P, C: e.C }); }
      e.P = e.C = e.tgt = null;
    }
    N.remove = o => {
      const e = list.get(o.id); if (!e) return;
      A.remove(e.key); list.delete(o.id);
      if (LOD) { freeBody(e); const k = arr.indexOf(e); if (k >= 0) arr.splice(k, 1); free.push(e.i); e.i = -1; }
    };
    // в редакторе: подвинули, повернули, сменили внешность
    N.sync = o => {
      const e = list.get(o.id); if (!e) return N.add(o);
      if (e.key !== keyOf(o)) { N.add(o); return; }
      A.setLook(A.get(e.key), lookOf(o));
      if (!N.playing) { e.home = o.pos.slice(); A.pose(e.key, { x: o.pos[0], y: o.pos[1], z: o.pos[2], yaw: (o.rot?.[1] || 0) * Math.PI / 180, moving: false }); }
    };
    // опору изменили (деталь убрали, сдвинули, поставили) — спящие рядом проснутся (физика: ph.watch); без ph.watch — не спят
    let unwatch = null;
    const onCol = (type, c) => {
      for (let k = 0; k < arr.length; k++) {
        const e = arr[k]; if (!e.P || !sleep[e.i]) continue;
        const ch = e.P.ch;
        if (ch.x > c.minx - 1.5 && ch.x < c.maxx + 1.5 && ch.z > c.minz - 1.5 && ch.z < c.maxz + 1.5) wakeQ[e.i] = 1;
      }
    };
    N.start = (cb = {}) => {
      N.playing = true; N.cb = cb; N.tick = 0;
      if (LOD && ph.watch && !unwatch) unwatch = ph.watch(onCol);
      for (const e of list.values()) wake(e);
    };
    N.stop = () => {
      N.playing = false; N.cb = null;
      if (unwatch) { unwatch(); unwatch = null; }
      for (const e of list.values()) { freeBody(e); A.pose(e.key, { x: e.home[0], y: e.home[1], z: e.home[2], moving: false, speed: 0, air: false, swim: false }); }
    };
    N.stats = () => { let awake = 0, asleep = 0; for (const e of arr) if (e.P) { if (sleep[e.i]) asleep++; else awake++; } return { n: list.size, awake, asleep, pool: pool.length, lod: LOD, phases: Array.from(phc) }; };   // для проверок и отладки (не на каждом шаге)
    // ── мозги: раз в шаг ──
    N.step = (dt, players = []) => {
      if (!N.playing) return;
      if (!LOD) return stepV1(dt, players);
      const tick = N.tick++, np = players.length, cb = N.cb, canSleep = !!unwatch;
      for (let k = 0; k < arr.length; k++) {
        const e = arr[k], P = e.P; if (!P) continue;
        const i = e.i, ch = P.ch, o = e.o;
        // «подумать» (в своей фазе; сразу после пробуждения — тут же): кто из игроков ближе
        const think = wakeQ[i] === 1 || (tick + ph8[i]) % THINK === 0;
        if (think) {
          let b = -1, d0 = Infinity;
          for (let j = 0; j < np; j++) { const p = players[j], d = hyp(p.x - ch.x, p.z - ch.z); if (d < d0 && Math.abs(p.y - ch.y) < 6 * U) { d0 = d; b = j; } }
          bi[i] = b;
        }
        // выбранный — каждый шаг: расстояние до него (погоня, укус, поворот к нему)
        const best = bi[i] >= 0 && bi[i] < np ? players[bi[i]] : null;
        const bd = best ? hyp(best.x - ch.x, best.z - ch.z) : Infinity;
        const sp = Math.max(.2, Math.min(3, o.speed ?? 1));
        let dx = 0, dz = 0, run = false;
        if (o.act === 'follow' && best && bd < 30 * U && bd > ((o.damage || 0) > 0 ? .9 : 1.6) * U) { dx = best.x - ch.x; dz = best.z - ch.z; run = bd > 8 * U; }   // кусачий подходит вплотную
        else if (o.act === 'flee' && best && bd < 9 * U) { dx = ch.x - best.x; dz = ch.z - best.z; run = true; }
        else if (o.act === 'wander' || (o.act === 'flee' && !(best && bd < 9 * U))) {
          // бродит: точка в радиусе от дома, дошёл или застрял — постоял и новая (новую выбирает, когда думает)
          const r = Math.max(1, o.radius ?? 8) * U;
          if (!hasT[i]) { if ((waitT[i] -= dt) <= 0 && think) { const a = rnd(i) * Math.PI * 2, d = Math.sqrt(rnd(i)) * r; tx[i] = e.home[0] + Math.cos(a) * d; tz[i] = e.home[2] + Math.sin(a) * d; hasT[i] = 1; stuckT[i] = 0; } }
          if (hasT[i]) {
            dx = tx[i] - ch.x; dz = tz[i] - ch.z;
            if (hyp(dx, dz) < .5 * U) { hasT[i] = 0; waitT[i] = 1.5 + rnd(i) * 3; dx = dz = 0; }
            else if (P.speed < .2 * U && (stuckT[i] += dt) > 1.2) { hasT[i] = 0; waitT[i] = .5; dx = dz = 0; }
            else stuckT[i] = 0;
          }
        }
        const l = hyp(dx, dz);
        // спит: проснётся, если захотел идти, толкнули (скорость), не на земле или опору рядом изменили
        if (sleep[i] && (l > 1e-3 || wakeQ[i] || !ch.grounded || ch.vx !== 0 || ch.vz !== 0 || P.mode !== 'move')) { sleep[i] = 0; still[i] = 0; }
        wakeQ[i] = 0;
        if (!sleep[i]) {
          const C = e.C;
          C.move.x = l > 1e-3 ? -dx / l : 0; C.move.z = l > 1e-3 ? dz / l : 0; C.run = run;
          P.speedMul = sp;
          P.update(dt, C, CAM);
        }
        // стоит — поворачивается к игроку рядом; никого — снова как стоял (уже смотрит туда — не трогаем: число в поле объекта — мусор)
        if (l < 1e-3) {   // ty — число без null (число | null V8 держит в куче: у каждого стоящего рядом с игроком — мусор, T-127 ревью)
          const look = !!best && bd < 6 * U, home = !look && o.act === 'idle';
          const ty = look ? Math.atan2(best.x - ch.x, best.z - ch.z) : home ? e.homeYaw : 0;
          if ((look || home) && Math.abs(E.wrap(ty - P.yaw)) > 1e-4) P.yaw = E.dampAngle(P.yaw, ty, home ? 2.5 : 6, dt);
        }
        // урон при касании (зомби): раз в секунду
        if ((o.damage || 0) > 0 && best && bd < 1.5 * U && Math.abs(best.y - ch.y) < 2 * U) { if ((hitT[i] -= dt) <= 0) { hitT[i] = 1; cb?.onHit?.(e, o.damage, best); } }
        else hitT[i] = Math.min(hitT[i], .3);
        // фраза при подходе (не чаще раза в 8 с)
        const near = !!best && bd < 5 * U;
        if (near && !nearF[i] && o.text && sayT[i] <= 0) { cb?.onSay?.(e, String(o.text).slice(0, 80)); sayT[i] = 8; }
        sayT[i] = Math.max(0, sayT[i] - dt); nearF[i] = near ? 1 : 0; e.near = near;
        if (!e.P || arr[k] !== e) continue;   // убрали в onHit / onSay
        // упал за край мира — домой
        if (ch.y < -60) { P.place(e.home[0], homeY(e), e.home[2]); still[i] = 0; continue; }
        // никуда не хочет, стоит на земле (не на движущемся теле), не плывёт — через 0,5 с тело спит
        if (!sleep[i] && canSleep) {
          if (l < 1e-3 && P.mode === 'move' && ch.grounded && !P.swim && !(ch.onCol && ch.onCol.rb) && P.speed < .02) { if (++still[i] >= SLEEP_STEPS) sleep[i] = 1; }
          else still[i] = 0;
        }
      }
    };
    function stepV1(dt, players){
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
        else if (l < 1e-3 && o.act === 'idle') P.yaw = E.dampAngle(P.yaw, e.homeYaw, 2.5, dt);   // никого — снова как стоял
        // урон при касании (зомби): раз в секунду
        if ((o.damage || 0) > 0 && best && bd < 1.5 * U && Math.abs(best.y - ch.y) < 2 * U) { if ((e.hitT -= dt) <= 0) { e.hitT = 1; N.cb?.onHit?.(e, o.damage, best); } }
        else e.hitT = Math.min(e.hitT, .3);
        // фраза при подходе (не чаще раза в 8 с)
        const near = !!best && bd < 5 * U;
        if (near && !e.near && o.text && e.sayT <= 0) { N.cb?.onSay?.(e, String(o.text).slice(0, 80)); e.sayT = 8; }
        e.sayT = Math.max(0, e.sayT - dt); e.near = near;
        // упал за край мира — домой
        if (ch.y < -60) P.place(e.home[0], homeY(e), e.home[2]);
      }
    }
    N.frame = (dt, t, cam) => {
      if (N.playing) for (const e of list.values()) if (e.P) {
        const a = A.pose(e.key, e.P.pose());
        if (a && e.o.phone) { if (e.phH == null) e.phH = phHash(e.o.seed || e.o.id); a.phone = e.near ? '' : phoneAtH(e.phH, t); }   // телефон 📱 по расписанию; рядом игрок — убрал
      }
      A.update(dt, t, cam);
    };
    N.phoneAt = phoneAt;
    // где голова (для облачка с фразой): [x, y, z]
    N.head = e => { const a = A.get(e.key); return a ? [a.x, a.y + A.top(e.key) + .3, a.z] : null; };
    N.dispose = () => { if (unwatch) { unwatch(); unwatch = null; } A.dispose(); list.clear(); arr.length = 0; pool.length = 0; };
    return N;
  };
  E.npcs.LOOKS = LOOKS; E.npcs.ACTS = ACTS; E.npcs.phoneAt = phoneAt;
})();

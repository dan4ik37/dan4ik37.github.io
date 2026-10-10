// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — игрок: ходьба, бег, присед, выносливость, прыжок, кувырок, паркур (перелезть, подтянуться,
//  повиснуть и пройти по краю), лестницы, сесть — перенос PlayerController / PlayerStamina / Parkour / GripFinder
//  из Unity-проекта Backrooms
// ═══════════════════════════════════════
// Цифры — как в Unity, метры × E.UNIT: шаг 4, бег 7, присед 2 м/с; тяжесть 20, прыжок на 1,2 м. Выносливость 100:
// +15/с через 1 с после траты, бег −14/с, выдохся (< 1) — бег снова с 30 %. Кувырок: на бегу «присесть», с шага —
// «бег» и «присесть» вместе (≤ 0,12 с) или своя клавиша; 0,8 с по кривой клипа, −14 (нужно ≥ 7). Паркур (ParkourRules):
// перелезть 0,4–1,2 м (глубина ≤ 1,2), подтянуться 0,5–1,6, повиснуть ≤ 2,35 и идти по краю 0,55 м/с; цена 8 / 12 / 16,
// висеть −5/с, по краю ещё −3/с; нет сил или руки заняты — не выйдет (подсказка). Лестница — 2,4 м/с.
// Сверх Unity (для браузера): прыжок ещё 0,1 с после края (coyote) и нажатие прыжка за 0,12 с до земли засчитывается.
// P = D37E.player(phys, { x, y, z, yaw }); каждый шаг: P.update(dt, C, cam) — C = D37E.controls(), cam = { yaw } камеры
// (ходьба относительно камеры; P.first = true — вид от 1-го лица, тело смотрит, куда камера). P.pose() — для человечка.
// События P.on(…): 'jump', 'land' {v, k, hard}, 'roll' {dir, back}, 'parkour' {move}, 'blocked' {text},
// 'step' {floor, run, x, y, z}, 'exhausted', 'sit', 'stand'. Для других систем: P.spend(n) / P.spendPartial(n) —
// выносливость, P.speedMul / P.staminaMul / P.armsFull — груз (inventory), P.sitOn(seat), P.place(x, y, z, yaw), P.push(…).
// Лестница в мире — D37E.ladder(phys, { x, z, yaw, top, w }) (зона-триггер перед ней + выход наверху).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const U = E.UNIT || 2.1 / 1.8;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const angTo = (a, b, k, dt) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * (1 - Math.exp(-k * dt)); };

  // ── Правила паркура (Parkour/ParkourRules.cs), метры Unity ──
  const PK = {
    VaultMinH: .4, VaultMaxH: 1.2, VaultMaxDepth: 1.2, MantleMinH: .5, MantleMaxH: 1.6, HangMaxH: 2.35, HangDrop: 2.0, ShimmySpeed: .55,
    VaultCost: 8, MantleCost: 12, ClimbFromHangCost: 16, HangPerSecond: 5, ShimmyPerSecond: 3,
    VaultTime: .5, MantleTime: .62, HangEnterTime: .28, ClimbFromHangTime: .85,
  };
  PK.cost = m => m === 'vault' ? PK.VaultCost : m === 'mantle' ? PK.MantleCost : m === 'climb' ? PK.ClimbFromHangCost : m === 'hang' ? PK.HangPerSecond * .5 : 0;
  PK.block = (m, armsFull, stamina) => {
    if (!m || m === 'letgo') return null;
    if (armsFull) return 'Руки заняты — не ухватиться.';
    if (stamina < Math.max(1, PK.cost(m))) return 'Нет сил.';
    return null;
  };
  // Сила приземления (жёсткое приземление PlayerController): быстрее 7 м/с — жёстко, к 15 м/с — 1
  PK.landK = v => v <= 7 * U ? 0 : clamp01((v - 7 * U) / (8 * U));
  PK.landKFrom = (h, g = 20) => { const v = Math.sqrt(2 * g * Math.max(0, h)); return v <= 7 ? 0 : clamp01((v - 7) / 8); };   // высота (м) → сила
  // Кувырок: путь к моменту t — кривая клипа Roll_Fwd (evade.py roll_travel): 7 → 3,2 м/с за 0,55 с, дальше ровно 3,2
  const ROLL_T = .8;
  PK.rollTravel = t => { t = Math.max(0, t); const a = 3.8 / 1.1; return (t <= .55 ? 7 * t - a * t * t : 7 * .55 - a * .55 * .55 + 3.2 * (t - .55)) * U; };
  // назад (только от 1-го лица): 4,2 → 1,4 м/с равномерно за 0,8 с (≈ 2,24 м)
  PK.rollBack = t => { t = Math.max(0, Math.min(ROLL_T, t)); return (4.2 * t - 1.75 * t * t) * U; };
  PK.ROLL_T = ROLL_T;

  // ═══ За что взяться руками (Grip/GripFinder.cs) — лучами по физике мира ═══
  const ray = (ph, ox, oy, oz, dx, dy, dz, len) => ph.raycast(ox, oy, oz, dx, dy, dz, len);
  // Обе руки на краю (ширина плеч) около точки lip: шаг по краю перепроверяет здесь же. n — нормаль стенки к нам
  function ledgeAt(ph, lip, n, s = 1){
    // настоящая стенка в этом месте (край мог повернуть)
    const w = ray(ph, lip.x + n.x * .5, lip.y - .03, lip.z + n.z * .5, -n.x, 0, -n.z, .8);
    if (!w || Math.abs(w.ny) > .3 || !w.col) return null;
    let nx = w.nx, nz = w.nz; const nl = Math.hypot(nx, nz); if (nl < 1e-6) return null; nx /= nl; nz /= nl;
    const along = { x: -nz, z: nx }, half = .2 * U * s;
    const probe = (px, pz) => {
      const h = ray(ph, px - nx * .06, lip.y + .3, pz - nz * .06, 0, -1, 0, .45);
      return h && h.col && h.ny > .8 && Math.abs(h.y - lip.y) <= .08 ? h : null;
    };
    const c = probe(w.x, w.z); if (!c) return null;
    const l = probe(w.x - along.x * half, w.z - along.z * half), r = probe(w.x + along.x * half, w.z + along.z * half);
    if (!l || !r || Math.abs(l.y - c.y) > .08 || Math.abs(r.y - c.y) > .08) return null;   // ступенчатый край
    return { lip: { x: w.x + nx * .03, y: c.y, z: w.z + nz * .03 }, face: { x: nx, z: nz }, along, left: l, right: r, col: c.col, height: 0 };
  }
  // Край впереди (fwd) в окне [minH, maxH] м над ногами: плоская крыша и стенка к нам (через стену не хватаемся)
  function findLedge(ph, feet, fwd, minH, maxH, s = 1){
    const fl = Math.hypot(fwd.x, fwd.z); if (fl < 1e-6) return null;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    const lo = feet.y + minH * U * s, hi = feet.y + maxH * U * s;
    let startY = hi + .3 * U;
    const y0 = feet.y + Math.min(1.5 * U * s, maxH * U * s);
    const ceil = ray(ph, feet.x, y0, feet.z, 0, 1, 0, Math.max(.01, startY - y0));   // низкий потолок — не уступ
    if (ceil) startY = ceil.y - .02;
    if (startY <= lo) return null;
    for (let d = .25 * U; d <= .96 * U + 1e-6; d += .1 * U) {
      const top = ray(ph, feet.x + fx * d, startY, feet.z + fz * d, 0, -1, 0, startY - lo + .01);
      if (!top || !top.col || top.ny < .8 || top.y > hi) continue;
      // стенка: луч ОТ ТЕЛА на 3 см ниже крыши — стена между нами попадётся раньше
      const wall = ray(ph, feet.x, top.y - .03, feet.z, fx, 0, fz, d + .06);
      if (!wall || !wall.col || Math.abs(wall.ny) > .3) continue;
      let nx = wall.nx, nz = wall.nz; const nl = Math.hypot(nx, nz); if (nl < 1e-6) continue; nx /= nl; nz /= nl;
      if (-nx * fx - nz * fz < .5) continue;   // вскользь — не перед нами
      const L = ledgeAt(ph, { x: wall.x, y: top.y, z: wall.z }, { x: nx, z: nz }, s);
      if (!L) continue;
      L.height = L.lip.y - feet.y;
      return L;
    }
    return null;
  }
  // Перелезть (стол, перила, стойка): невысоко и неглубоко, за ним — пол не ниже 1 м, сверху и на приземлении есть место
  function findVault(ph, feet, fwd, s = 1){
    const fl = Math.hypot(fwd.x, fwd.z); if (fl < 1e-6) return null;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    const L = findLedge(ph, feet, { x: fx, z: fz }, PK.VaultMinH, PK.VaultMaxH, s);
    if (!L) return null;
    let depth = -1;
    for (let d = .12 * U; d <= 1.25 * U + 1e-6; d += .08 * U) {
      const h = ray(ph, L.lip.x + fx * d, L.lip.y + .25, L.lip.z + fz * d, 0, -1, 0, .35);
      if (!h || Math.abs(h.y - L.lip.y) > .06) { depth = d; break; }
    }
    if (depth < 0) return null;   // глубже — это площадка (подтянуться)
    const lx = L.lip.x + fx * (depth + .45 * U * s), lz = L.lip.z + fz * (depth + .45 * U * s);
    const fl2 = ray(ph, lx, L.lip.y + .3, lz, 0, -1, 0, 2.4 * U + .3);
    if (!fl2 || fl2.ny < .7) return null;
    if (fl2.y > L.lip.y - .3 || fl2.y < feet.y - 1.0 * U) return null;   // за ним не пол / там яма
    const r = .22 * U * s;
    for (let k = 0; k <= 1.01; k += .5) {
      const qx = L.lip.x + fx * depth * k, qz = L.lip.z + fz * depth * k;
      if (ph.blocked(qx, qz, L.lip.y + .1, L.lip.y + .75 * U * s, r)) return null;
    }
    if (ph.blocked(lx, lz, fl2.y + .05, fl2.y + 1.1 * U * s, r)) return null;
    return { L, lip: L.lip, face: L.face, depth, land: { x: lx, y: fl2.y, z: lz },
      over: { x: L.lip.x + fx * depth * .5, y: L.lip.y + .3 * U * s, z: L.lip.z + fz * depth * .5 } };
  }
  // Наверху есть, куда встать (хотя бы присев)
  function roomOnTop(ph, L, r, crouchH){
    const tx = L.lip.x - L.face.x * (r + .12), tz = L.lip.z - L.face.z * (r + .12);
    const h = ray(ph, tx, L.lip.y + .4, tz, 0, -1, 0, .6);
    if (!h || h.ny < .7) return null;
    if (ph.blocked(tx, tz, h.y + .05, h.y + crouchH, r * .9)) return null;
    return { x: tx, y: h.y, z: tz };
  }
  E.grip = { findLedge, findVault, ledgeAt, roomOnTop };
  E.parkour = PK;

  // ═══ Лестница: тонкая стенка (рисует игра) + зона перед ней; наверху — выход ═══
  // { x, z } — середина лестницы у стены, yaw — куда смотрит лицевая сторона (откуда лезут), top — высота верха,
  // exit — куда встать наверху (по умолчанию — за верхом лестницы, на 0,5 м вглубь)
  E.ladder = function (ph, o){
    const fx = Math.sin(o.yaw || 0), fz = Math.cos(o.yaw || 0), w = o.w || 1, bottom = o.bottom || 0, top = o.top;
    const exit = o.exit || { x: o.x - fx * .55 * U, y: top, z: o.z - fz * .55 * U };
    const data = { ladder: { x: o.x, z: o.z, fx, fz, bottom, top, exit } };
    const zone = ph.addBox({ x: o.x + fx * .45, z: o.z + fz * .45, y: (bottom + top) / 2 + .3, hx: w / 2 + .1, hy: (top - bottom) / 2 + .5, hz: .55, yaw: o.yaw || 0, trigger: true, tag: 'ladder', data });
    return { zone, data };
  };

  // ═══ Игрок ═══
  E.player = function (ph, o = {}){
    const ev = E.emitter ? E.emitter() : null;
    const P = {
      ph, PK,
      on: (e, f) => ev ? ev.on(e, f) : () => {},
      // настройки (Unity × U), можно менять после создания (затем P.sync())
      walk: 4 * U, runSpeed: 7 * U, crouchSpeed: 2 * U, gravity: 20 * U, jumpH: 1.2 * U,
      standH: o.h || 2.1, crouchH: 1.15 * U, r: o.r || .42,
      maxStamina: 100, regen: 15, regenDelay: 1, sprintCost: 14, rollCost: 14,
      coyote: .1, jumpBuffer: .12, ladderSpeed: 2.4 * U, turn: 12,
      speedMul: 1, staminaMul: 1, armsFull: false, canRun: true, scale: 1, first: false, enabled: true,
      floorAt: null, groundFloor: o.floor || 'grass',
      // состояние
      ch: ph.character({ x: o.x || 0, y: o.y, z: o.z || 0, r: o.r || .42, h: o.h || 2.1, step: o.step ?? .62 }),
      yaw: o.yaw || 0, mode: 'move', stamina: 100, exhausted: false, crouch: false, crouchW: 0,
      running: false, moving: false, speed: 0, climbing: false, now: 0,
      roll: null, pk: null, hang: null, ladder: null, seat: null, stepOff: 0, _lastY: 0, _wasG: true, swim: false, dive: false, _swimCD: 0, _strokeT: 0,
      _lastGround: 0, _buf: 0, _jumped: false, _regenAt: 0, _stepT: 0, _drainAt: 0, _sway: 0, _toastAt: 0, _sprint: false, _climbPh: 0,
    };
    const ch = P.ch;
    const emit = (e, d) => ev?.emit(e, d);
    P.sync = () => { ch.g = P.gravity; ch.jumpV = Math.sqrt(2 * P.gravity * P.jumpH); ch.r = P.r; };
    P.sync(); ch.accG = 60; ch.accA = 30;
    Object.defineProperty(P, 'timeMul', { get: () => Math.max(1, Math.min(1.3, 1 + (P.staminaMul - 1) * .5)) });

    // ── Выносливость (PlayerStamina) ──
    P.spend = n => { if (P.stamina < n) return false; P.stamina -= n; P._regenAt = P.now + P.regenDelay; return true; };
    P.spendPartial = n => { const s = Math.min(P.stamina, Math.max(0, n)); P.stamina -= s; if (s > 0) P._regenAt = P.now + P.regenDelay; return s; };
    function stamTick(dt){
      if (P._sprint && P.stamina > 0) { P.stamina = Math.max(0, P.stamina - P.sprintCost * P.staminaMul * dt); P._regenAt = P.now + P.regenDelay; }
      else if (P.now >= P._regenAt && P.stamina < P.maxStamina) P.stamina = Math.min(P.maxStamina, P.stamina + P.regen * dt);
      if (P.stamina < 1) { if (!P.exhausted) { P.exhausted = true; emit('exhausted'); } }
      else if (P.exhausted && P.stamina > P.maxStamina * .3) P.exhausted = false;
    }

    const roomToStand = () => !ph.blocked(ch.x, ch.z, ch.y + P.crouchH - .05, ch.y + P.standH, ch.r * .9);
    const floorOf = () => ch.onCol?.data?.floor || (ch.onCol ? 'concrete' : P.floorAt?.(ch.x, ch.z) || P.groundFloor);
    const ladderHere = () => { for (const c of ch.inside) if (c.data?.ladder) return c.data.ladder; return null; };
    function wishOf(C, cam){
      const m = C ? C.move : { x: 0, z: 0 };
      const cy = cam ? cam.yaw : P.yaw + Math.PI;
      const fx = -Math.sin(cy), fz = -Math.cos(cy), rx = Math.cos(cy), rz = -Math.sin(cy);
      return { x: rx * m.x + fx * m.z, z: rz * m.x + fz * m.z };
    }

    // ── Шаг ──
    P.update = (dt, C, cam) => {
      P.now += dt;
      if (!P.enabled) C = null;
      const w = wishOf(C, cam);
      P._sprint = false; P.climbing = false;
      switch (P.mode) {
        case 'roll': tickRoll(dt); break;
        case 'pk': tickScript(dt); break;
        case 'hang': tickHang(dt, C, w); break;
        case 'ladder': tickLadder(dt, C, w); break;
        case 'sit': tickSit(dt, C, w); break;
        default: tickMove(dt, C, w, cam);
      }
      stamTick(dt);
      // плавно по ступенькам (как в Unity/Source): тело встаёт на ступеньку сразу, а картинка и камера догоняют за ~0,1 с —
      // на лестницах и скатах крыш из коробок нет тряски. P.stepOff — сколько картинка ещё отстаёт (pose().y, камера)
      const dy = ch.y - P._lastY;
      if (P.mode === 'move' && ch.grounded && P._wasG && dy && Math.abs(dy) <= ch.step + .02) P.stepOff = Math.max(-1.2 * ch.step, Math.min(1.2 * ch.step, P.stepOff - dy));
      P.stepOff *= Math.exp(-dt / .09); if (Math.abs(P.stepOff) < 1e-4) P.stepOff = 0;
      P._lastY = ch.y; P._wasG = ch.grounded;
    };

    function tickMove(dt, C, w, cam){
      const wl = Math.hypot(w.x, w.z), fwd = { x: Math.sin(P.yaw), z: Math.cos(P.yaw) };
      const dir = wl > .2 ? { x: w.x / wl, z: w.z / wl } : fwd;
      // лестница: в её зоне и идём к ней — лезем
      const lad = ladderHere();
      if (lad && wl > .3 && (w.x * -lad.fx + w.z * -lad.fz) / wl > .5) { startLadder(lad); return; }
      // паркур: прыжок перед уступом (или в воздухе, держа прыжок и двигаясь к краю) — перелезть, подтянуться, повиснуть
      const jumpDown = !!C?.down('jump');
      if (jumpDown || (!ch.grounded && wl > .3 && C?.held('jump'))) if (tryParkour(dir, wl > .3)) return;
      // кувырок: на бегу — «присесть»; с шага — «бег» и «присесть» вместе; или своя клавиша
      if (ch.grounded && C) {
        const runningNow = C.held('run') && Math.hypot(ch.vx, ch.vz) > P.walk * .9;
        if (C.down('roll') || (runningNow && C.down('crouch') && !P.crouch) || (wl > .2 && C.chordDown('run', 'crouch')))
          if (startRoll(wl > .2 ? dir : null, cam)) return;
      }
      // присед (держать); встать — только если над головой есть место
      if (C?.held('crouch')) P.crouch = true;
      else if (P.crouch && roomToStand()) P.crouch = false;
      const targetH = P.crouch ? P.crouchH : P.standH;
      ch.h = Math.abs(ch.h - targetH) < .005 ? targetH : E.damp ? E.damp(ch.h, targetH, 8, dt) : targetH;
      if (!P.crouch && ch.h > targetH) ch.h = targetH;
      P.crouchW = clamp01((P.standH - ch.h) / (P.standH - P.crouchH));
      // бег: держать «бег», не присев, есть силы, руки свободны
      P.running = !!C?.held('run') && !P.crouch && P.canRun && !P.exhausted && !P.armsFull && wl > .1;
      const speed = (P.crouch ? P.crouchSpeed : P.running ? P.runSpeed : P.walk) * P.speedMul;
      // плавание: вода глубже ~1,1 м — держимся у поверхности (уровень даёт игра: ph.waterLevel(x, z) → высота или −∞)
      const lvl = ph.waterLevel ? ph.waterLevel(ch.x, ch.z) : -Infinity;
      if (lvl > -Infinity && P.now >= P._swimCD) {
        const bottom = ph.supportAt(ch.x, ch.z, ch.r * .5, lvl).y;
        if (lvl - bottom > 1.1 * U && (P.swim || ch.y < lvl - .25 * U)) {
          if (!P.swim) { P.swim = true; emit('splash', { v: Math.max(0, -ch.vy), x: ch.x, y: lvl, z: ch.z }); }
          swimMove(dt, C, w, wl, lvl, bottom, jumpDown, cam); return;
        }
        if (P.swim) { P.swim = P.dive = false; if (bottom > ch.y) ch.y = bottom; }   // вышли на мель — встаём на дно
      } else if (P.swim && P.now >= P._swimCD) P.swim = P.dive = false;
      // прыжок: с «запасом» после края и «заранее» до земли; присев — не прыгает
      if (ch.grounded) { P._lastGround = P.now; P._jumped = false; }
      if (jumpDown) P._buf = P.jumpBuffer; else P._buf = Math.max(0, P._buf - dt);
      if (P._buf > 0 && !P._jumped && !P.crouch && (ch.grounded || P.now - P._lastGround <= P.coyote)) {
        ch.vy = ch.jumpV + ch.g * dt * .5;   // + полшага тяжести: пошаговый счёт иначе недобирает ~5 см высоты
        ch.grounded = false; ch.airT = 0; P._jumped = true; P._buf = 0;
        emit('jump', { x: ch.x, y: ch.y, z: ch.z });
      }
      ph.move(ch, dt, wl > 1e-3 ? w : { x: 0, z: 0 }, speed, false);
      if (ch.impact > 0) { const k = PK.landK(ch.impact); emit('land', { v: ch.impact, k, hard: k > 0, floor: floorOf(), x: ch.x, y: ch.y, z: ch.z }); }
      P.speed = Math.hypot(ch.vx, ch.vz);
      P.moving = P.speed > .35;
      P._sprint = P.running && P.speed > .5;
      // куда смотрит тело: от 1-го лица — куда камера, от 3-го — куда идёт
      if (P.first && cam) P.yaw = cam.yaw + Math.PI;
      else if (wl > .1 && P.speed > .3) P.yaw = angTo(P.yaw, Math.atan2(w.x, w.z), P.turn, dt);
      // шаги (вприсядку не слышно): 0,4 с, на бегу в 1,5 раза чаще
      if (ch.grounded && P.speed > .5 && !P.crouch) {
        P._stepT -= dt;
        if (P._stepT <= 0) { emit('step', { floor: floorOf(), run: P.running, x: ch.x, y: ch.y, z: ch.z }); P._stepT = .4 / (P.running ? 1.5 : 1); }
      } else P._stepT = 0;
    }

    // ── Плавание: у поверхности; бег — быстрее (тратит силы); «присесть» — нырнуть (до дна или 3 м); Пробел у берега — вылезти ──
    function swimMove(dt, C, w, wl, lvl, bottom, jumpDown, cam){
      P.crouch = false; ch.h = P.standH; P.crouchW = 0;
      P.dive = !!C?.held('crouch');
      P.running = !!C?.held('run') && P.canRun && !P.exhausted && wl > .1;
      const speed = (P.running ? P.runSpeed * .6 : P.walk * .7) * P.speedMul;
      if (jumpDown) {
        const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), shore = ph.supportAt(ch.x + fx * .9 * U, ch.z + fz * .9 * U, ch.r * .5, lvl + 1.3 * U).y;
        if (shore >= lvl - .35 * U) {   // берег рядом — выпрыгнуть на него
          ch.vy = Math.sqrt(2 * ch.g * Math.max(.6 * U, shore - ch.y + .45 * U)); ch.grounded = false; ch.airT = 0;
          P.swim = P.dive = false; P._swimCD = P.now + .5;
          emit('jump', { x: ch.x, y: ch.y, z: ch.z });
          ph.move(ch, dt, wl > 1e-3 ? w : { x: 0, z: 0 }, P.walk, false); ch.impact = 0;
          return;
        }
      }
      const target = P.dive ? Math.max(bottom + .05, lvl - 3 * U) : lvl - .55 * U, maxV = 2.6 * U;
      ch.vy = Math.max(-maxV, Math.min(maxV, (target - ch.y) * 3.5)) + ch.g * dt;   // + тяжесть шага: её снимет fall()
      ch.grounded = false; ch.airT = 0;
      ph.move(ch, dt, wl > 1e-3 ? w : { x: 0, z: 0 }, speed, false);
      ch.impact = 0;
      P.speed = Math.hypot(ch.vx, ch.vz); P.moving = P.speed > .3; P._sprint = P.running && P.speed > .5;
      if (P.first && cam) P.yaw = cam.yaw + Math.PI;
      else if (wl > .1 && P.speed > .3) P.yaw = angTo(P.yaw, Math.atan2(w.x, w.z), P.turn * .7, dt);
      if (P.moving) { P._strokeT -= dt; if (P._strokeT <= 0) { emit('swim', { x: ch.x, y: lvl, z: ch.z, run: P.running }); P._strokeT = P.running ? .5 : .75; } } else P._strokeT = 0;
    }

    // ── Кувырок (RollRoutine) ──
    function startRoll(dir, cam){
      if (P.mode !== 'move' || !ch.grounded || P.armsFull) return false;
      if (P.stamina < P.rollCost * .5) return false;   // совсем без сил — не катится
      if (!dir) { const v = Math.hypot(ch.vx, ch.vz); dir = v > .3 ? { x: ch.vx / v, z: ch.vz / v } : { x: Math.sin(P.yaw), z: Math.cos(P.yaw) }; }
      let back = false;
      if (P.first && cam) { const vx = -Math.sin(cam.yaw), vz = -Math.cos(cam.yaw); back = dir.x * vx + dir.z * vz < -.5; }   // > 120° от взгляда
      P.spendPartial(P.rollCost * P.staminaMul);
      P.roll = { t: 0, prev: 0, dir, back, h0: ch.h };
      if (!P.first) P.yaw = Math.atan2(dir.x, dir.z);
      P.mode = 'roll';
      emit('roll', { dir, back, x: ch.x, y: ch.y, z: ch.z });
      return true;
    }
    function tickRoll(dt){
      const R = P.roll;
      R.t = Math.min(ROLL_T, R.t + dt);
      // капсула ниже, пока тело свёрнуто, потом встаёт
      const low = Math.sin(clamp01(R.t / .66) * Math.PI);
      ch.h = R.h0 + (P.crouchH * .7 - R.h0) * low;
      P.crouchW = clamp01((P.standH - ch.h) / (P.standH - P.crouchH));
      const x = R.back ? PK.rollBack(R.t) : PK.rollTravel(R.t), d = x - R.prev;
      R.prev = x;
      ch.vx = R.dir.x * d / dt; ch.vz = R.dir.z * d / dt;
      ph.slide(ch, R.dir.x * d, R.dir.z * d);
      ph.fall(ch, dt); ph.triggers(ch);
      if (R.t >= ROLL_T) {
        P.mode = 'move'; P.roll = null;
        if (roomToStand()) { ch.h = P.standH; P.crouch = false; } else { ch.h = P.crouchH; P.crouch = true; }
        const end = (R.back ? 1.4 : 3.2) * U;   // скорость в конце клипа — дальше обычный шаг
        ch.vx = R.dir.x * end; ch.vz = R.dir.z * end;
        if (ch.grounded) P._lastGround = P.now;
      }
    }

    // ── Сценарий движения (PkLerp: SmoothStep + дуга sin) — паркур, подтянуться с лестницы ──
    // segs: [{ a, b, dur, arc, on }]; on — в начале отрезка; done — в конце
    function script(move, segs, done){
      P.pk = { move, segs, i: 0, t: 0, done, k: 0 };
      P.mode = 'pk'; ch.vx = ch.vy = ch.vz = 0; ch.grounded = false;
      segs[0]?.on?.();
    }
    function tickScript(dt){
      const K = P.pk;
      K.t += dt;
      while (K.i < K.segs.length && K.t >= K.segs[K.i].dur) {
        const s = K.segs[K.i];
        K.t -= s.dur; K.i++;
        ch.x = s.b.x; ch.y = s.b.y; ch.z = s.b.z;
        K.segs[K.i]?.on?.();
      }
      if (K.i >= K.segs.length) { P.pk = null; K.done(); return; }
      const s = K.segs[K.i], k = smooth(K.t / s.dur), arc = Math.sin(k * Math.PI);
      ch.x = s.a.x + (s.b.x - s.a.x) * k + (s.arc?.x || 0) * arc;
      ch.y = s.a.y + (s.b.y - s.a.y) * k + (s.arc?.y || 0) * arc;
      ch.z = s.a.z + (s.b.z - s.a.z) * k + (s.arc?.z || 0) * arc;
      K.k = (K.i + K.t / s.dur) / K.segs.length;
      P.crouchW = clamp01((P.standH - ch.h) / (P.standH - P.crouchH));
    }
    function finishPk(){
      P.mode = 'move';
      ch.vx = ch.vy = ch.vz = 0; ch.grounded = true;
      ph.fall(ch, 1 / 60); ph.triggers(ch);
      P._lastGround = P.now; P._jumped = true; P._buf = 0;   // не подпрыгнуть от того же нажатия
    }

    // ── Паркур (PlayerController.Parkour.cs) ──
    function refuse(text){ if (P.now >= P._toastAt) { P._toastAt = P.now + 2; emit('blocked', { text }); } return false; }
    function tryParkour(dir, forward){
      if (P.mode !== 'move') return false;
      const feet = { x: ch.x, y: ch.y, z: ch.z }, s = P.scale;
      if (ch.grounded && forward) {
        const v = findVault(ph, feet, dir, s);
        if (v) { const b = PK.block('vault', P.armsFull, P.stamina); if (b) return refuse(b); pkVault(v); return true; }
      }
      const L = findLedge(ph, feet, dir, PK.MantleMinH, PK.HangMaxH, s);
      if (!L) return false;
      const high = L.height > PK.MantleMaxH * U * s, move = high ? 'hang' : 'mantle';
      const b = PK.block(move, P.armsFull, P.stamina); if (b) return refuse(b);
      if (high) { pkHang(L); return true; }
      const top = roomOnTop(ph, L, ch.r, P.crouchH);
      if (!top) return false;
      pkMantle(L, top, 'mantle');
      return true;
    }
    function pkMantle(L, top, move){
      const s = P.scale, dur = (move === 'climb' ? PK.ClimbFromHangTime : PK.MantleTime) * P.timeMul, f = L.face;
      const st = { x: ch.x, y: ch.y, z: ch.z };
      // 1) руки на край, тело чуть вниз (вес перед рывком); 2) грудь к краю; 3) таз к краю; 4) колено на край — наверх (присев)
      const dip = { x: st.x + f.x * .02, y: st.y - .05 * U * s, z: st.z + f.z * .02 };
      const chest = { x: st.x, y: Math.max(st.y, L.lip.y - 1.05 * U * s), z: st.z };
      const hip = { x: st.x, y: L.lip.y - .35 * U * s, z: st.z };
      P.yaw = Math.atan2(-f.x, -f.z);
      P.spendPartial(PK.cost(move) * P.staminaMul);
      script(move, [
        { a: st, b: dip, dur: dur * .15 },
        { a: dip, b: chest, dur: dur * .25 },
        { a: chest, b: hip, dur: dur * .25, arc: { x: -f.x * .04, y: 0, z: -f.z * .04 } },
        { a: hip, b: top, dur: dur * .35, arc: { x: 0, y: .08 * U * s, z: 0 }, on: () => { P.crouch = true; ch.h = P.crouchH; } },
      ], finishPk);
      emit('parkour', { move, x: L.lip.x, y: L.lip.y, z: L.lip.z });
    }
    function pkVault(v){
      const s = P.scale, dur = PK.VaultTime * P.timeMul, f = v.face, st = { x: ch.x, y: ch.y, z: ch.z };
      // ладонь на ближний край, таз вверх; ноги над столом; приземление
      const up = { x: st.x - f.x * .15, y: v.lip.y + .05 * U * s, z: st.z - f.z * .15 };
      P.yaw = Math.atan2(-f.x, -f.z);
      P.spendPartial(PK.cost('vault') * P.staminaMul);
      script('vault', [
        { a: st, b: up, dur: dur * .35, on: () => { P.crouch = true; ch.h = P.crouchH; } },
        { a: up, b: v.over, dur: dur * .3, arc: { x: 0, y: .05 * U * s, z: 0 } },
        { a: v.over, b: v.land, dur: dur * .35 },
      ], finishPk);
      emit('parkour', { move: 'vault', x: v.lip.x, y: v.lip.y, z: v.lip.z });
    }
    // Вис: руки на краю, ноги ниже на 2 м (не ниже пола под нами)
    const hangPos = L => {
      const x = L.lip.x + L.face.x * (ch.r + .06), z = L.lip.z + L.face.z * (ch.r + .06);
      const floor = ph.supportAt(x, z, ch.r * .5, L.lip.y - .2).y;
      return { x, y: Math.max(L.lip.y - PK.HangDrop * U * P.scale, floor + .02), z };
    };
    function pkHang(L){
      const st = { x: ch.x, y: ch.y, z: ch.z }, hp = hangPos(L);
      P.yaw = Math.atan2(-L.face.x, -L.face.z);
      P.spendPartial(PK.cost('hang') * P.staminaMul);
      script('hang', [{ a: st, b: hp, dur: PK.HangEnterTime, arc: { x: -L.face.x * .03, y: 0, z: -L.face.z * .03 } }], () => {
        P.mode = 'hang'; P.hang = L; P._drainAt = P.now + .5; P._sway = 0;
      });
      emit('parkour', { move: 'hang', x: L.lip.x, y: L.lip.y, z: L.lip.z });
    }
    function tickHang(dt, C, w){
      const L = P.hang, s = P.scale;
      const toward = w.x * -L.face.x + w.z * -L.face.z, side = w.x * L.along.x + w.z * L.along.z;
      const shimmy = Math.abs(side) > .3;
      if (P.now >= P._drainAt) { P._drainAt = P.now + .5; P.spendPartial(((shimmy ? PK.ShimmyPerSecond : 0) * .5 + PK.HangPerSecond * .5) * P.staminaMul); }
      if (P.stamina < 1) { letGo(); return; }                              // руки соскользнули
      if (C?.down('crouch') || toward < -.5) { letGo(); return; }          // отпустить
      if (C?.down('jump') || toward > .5) {                                 // залезть наверх
        if (!PK.block('climb', P.armsFull, P.stamina)) {
          const top = roomOnTop(ph, L, ch.r, P.crouchH);
          if (top) { P.hang = null; P.mode = 'move'; pkMantle(L, top, 'climb'); return; }
        }
      }
      if (shimmy) {   // по краю: обе руки должны держаться и в новом месте, тело — влезать
        const dx = Math.sign(side) * PK.ShimmySpeed * U * dt;
        const nL = ledgeAt(ph, { x: L.lip.x + L.along.x * dx, y: L.lip.y, z: L.lip.z + L.along.z * dx }, L.face, s);
        if (nL && Math.abs(nL.lip.y - L.lip.y) < .1) {
          const np = hangPos(nL);
          if (!ph.blocked(np.x, np.z, np.y + ch.r + .05, np.y + P.standH - ch.r, ch.r * .9)) { P.hang = nL; P._sway += dt * 9; P.climbing = true; }
        }
      }
      const H = P.hang, hp = hangPos(H), sw = .015 * Math.sin(P.now * 2.1 + P._sway);   // живое покачивание
      ch.x = hp.x + H.face.x * sw; ch.y = hp.y; ch.z = hp.z + H.face.z * sw;
      ch.vx = ch.vy = ch.vz = 0;
      P.yaw = Math.atan2(-H.face.x, -H.face.z);
    }
    function letGo(){
      const L = P.hang; P.hang = null; P.mode = 'move';
      ch.x += L.face.x * .08; ch.z += L.face.z * .08;
      ch.vx = ch.vz = ch.vy = 0; ch.grounded = false; ch.airT = 0;
      P._lastGround = -9; P._jumped = true;
      emit('parkour', { move: 'letgo', x: ch.x, y: ch.y, z: ch.z });
    }

    // ── Лестница ──
    function startLadder(L){
      P.mode = 'ladder'; P.ladder = L; P.crouch = false;
      ch.vx = ch.vy = ch.vz = 0; ch.grounded = false;
      emit('parkour', { move: 'ladder', x: ch.x, y: ch.y, z: ch.z });
    }
    function exitLadder(){ P.mode = 'move'; P.ladder = null; ch.grounded = false; ph.fall(ch, 1 / 60); }
    function tickLadder(dt, C, w){
      const L = P.ladder, wl = Math.hypot(w.x, w.z);
      const toward = wl > .1 ? (w.x * -L.fx + w.z * -L.fz) : 0;
      if (C?.down('jump')) {   // спрыгнуть назад
        P.mode = 'move'; P.ladder = null;
        ch.vx = L.fx * 3 * U; ch.vz = L.fz * 3 * U; ch.vy = 4 * U; ch.grounded = false; ch.airT = 0; P._jumped = true;
        emit('jump', { x: ch.x, y: ch.y, z: ch.z });
        return;
      }
      const vy = toward > .3 ? P.ladderSpeed : toward < -.3 || C?.held('crouch') ? -P.ladderSpeed : 0;
      const sup = ph.supportAt(ch.x, ch.z, ch.r * .5, ch.y + .05).y;
      const ny = ch.y + vy * dt;
      if (vy < 0 && ny <= sup + 1e-3) { ch.y = sup; ch.grounded = true; exitLadder(); return; }
      ch.y = Math.max(sup, ny);
      const px = L.x + L.fx * (ch.r + .08), pz = L.z + L.fz * (ch.r + .08);
      ch.x = E.damp ? E.damp(ch.x, px, 14, dt) : px; ch.z = E.damp ? E.damp(ch.z, pz, 14, dt) : pz;
      ch.vx = ch.vz = 0; ch.vy = vy; ch.grounded = false;
      P.yaw = Math.atan2(-L.fx, -L.fz);
      if (vy) { P.climbing = true; P._climbPh += vy * dt * 2.4; }
      if (ch.y + ch.h - .2 * U > L.top + .6 * U) { pullUp(L.exit); return; }   // глаза выше верха — подтянуться и выйти
      ph.triggers(ch);
      if (!ladderHere()) exitLadder();
    }
    // Подтягивание (PullUp): руки на край, тело вверх (0,3 с), потом вперёд на уступ (0,25 с); тесно — присев
    function pullUp(t){
      const st = { x: ch.x, y: ch.y, z: ch.z }, mid = { x: st.x, y: t.y + .1, z: st.z };
      P.ladder = null;
      script('pullup', [{ a: st, b: mid, dur: .3 }, { a: mid, b: t, dur: .25, on: () => { if (ph.blocked(t.x, t.z, t.y + P.crouchH - .05, t.y + P.standH, ch.r * .9)) { P.crouch = true; ch.h = P.crouchH; } } }], finishPk);
    }

    // ── Сесть ──
    P.sitOn = seat => {
      if (P.mode !== 'move' || !ch.grounded) return false;
      P.seat = { ...seat, fromY: ch.y, fromX: ch.x, fromZ: ch.z };
      P.mode = 'sit'; P.crouch = false; ch.h = P.standH;
      ch.x = seat.x; ch.z = seat.z; ch.vx = ch.vy = ch.vz = 0;
      P.yaw = seat.yaw || 0;
      emit('sit', seat);
      return true;
    };
    function tickSit(dt, C, w){ if (Math.hypot(w.x, w.z) > .3 || C?.down('jump') || C?.down('crouch') || C?.down('interact')) P.standUp(); }
    P.standUp = () => {
      const s = P.seat; if (!s) return;
      P.seat = null; P.mode = 'move';
      // встать перед сиденьем (куда смотрел), если там свободно, иначе — откуда пришёл
      const fx = s.x + Math.sin(s.yaw || 0) * .8 * U, fz = s.z + Math.cos(s.yaw || 0) * .8 * U;
      const free = !ph.blocked(fx, fz, s.fromY + ch.step, s.fromY + P.standH, ch.r * .9);
      ch.x = free ? fx : s.fromX; ch.z = free ? fz : s.fromZ; ch.y = s.fromY;
      ch.grounded = true; ph.fall(ch, 1 / 60); ph.triggers(ch);
      P.busyUntil = P.now + .25;   // то же нажатие «действие» не сажает обратно
      emit('stand', {});
    };

    // ── Прочее ──
    P.place = (x, y, z, yaw) => {
      ch.x = x; ch.z = z; ch.y = y ?? ph.supportAt(x, z, ch.r, 1e6).y;
      ch.vx = ch.vy = ch.vz = 0; ch.grounded = true; ch.h = P.standH;
      if (yaw != null) P.yaw = yaw;
      P.mode = 'move'; P.pk = P.hang = P.roll = P.seat = P.ladder = null; P.crouch = false; P.crouchW = 0;
      P.stepOff = 0; P._lastY = ch.y; P._wasG = true; P.swim = P.dive = false;
      ph.triggers(ch);
    };
    P.push = (vx = 0, vy = 0, vz = 0) => {
      if (P.mode !== 'move') return;
      ch.vx += vx; ch.vz += vz;
      if (vy) { ch.vy = vy; ch.grounded = false; ch.airT = 0; }
    };
    // Для человечка (actors) и сети: поза одним объектом
    P.pose = () => ({
      x: ch.x, y: ch.y + P.stepOff, z: ch.z, yaw: P.yaw,
      moving: P.mode === 'move' ? P.moving : P.climbing,
      speed: P.mode === 'move' ? P.speed : 0,
      air: P.mode === 'move' && !P.swim && !ch.grounded && ch.airT > .12, swim: P.swim, dive: P.dive,
      crouch: P.mode === 'move' || P.mode === 'roll' ? P.crouchW : 0,
      sit: P.mode === 'sit' && !P.seat?.stand, seatY: P.seat && !P.seat.stand ? P.seat.y : null,
      roll: P.mode === 'roll' ? P.roll.t / ROLL_T : -1, rollBack: P.mode === 'roll' && P.roll.back,
      hang: P.mode === 'hang', ladder: P.mode === 'ladder', climbPh: P._climbPh,
      pk: P.mode === 'pk' ? P.pk.move : '', pkK: P.mode === 'pk' ? P.pk.k : 0,
    });
    // Отладка/тесты
    P._test = { findLedge: (dir, a, b) => findLedge(ph, { x: ch.x, y: ch.y, z: ch.z }, dir, a, b, P.scale), tryParkour: (dir, f = true) => tryParkour(dir, f), startRoll };
    return P;
  };
})();

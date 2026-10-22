// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — бой (D37E.combat): две руки и хват у каждого предмета, удары с замахом, перезарядка (как в Майнкрафте 1.9:
//  бить вслепую быстро — слабо), серия ударов, дуга клинка по простым коробкам, блок и отбив щитом, неуязвимость после удара,
//  стойкость и оглушение, отброс, лук с натяжкой, нокаут вместо смерти (без тел и крови — правило сайта)
// ═══════════════════════════════════════
// Без Three.js и DOM (окно, поток, node — scripts/combat-test.cjs). Шаг — фиксированный (игра зовёт CB.step(f, 1/60) из своего
// шага логики), случайностей нет: один и тот же ввод по шагам — один и тот же бой при 30, 60 и 144 кадрах. За шаг — ни одного
// нового объекта: состояние бойца создаётся один раз (CB.fighter / CB.init), результаты — в объект игры (out).
// Данные (docs/COMBAT.md §3): KINDS — оружие по виду (хват, поза, перезарядка, дальность, урон, отброс, серия, щит, лук),
// MOVES — удары (как идёт клинок, замах / удар / возврат, множители). Своё оружие (моды, «Студия 3D») — CB.weapon({ kind, … }).
// Боец f = CB.fighter({ hp, invT, poise, stagT, kbRes, stam }) или CB.init(свой объект, …) — поля прямо в объекте (мобы).
//   Каждый шаг: CB.equip(f, правая, левая) → CB.guard(f, держит блок) → CB.bow(f, натягивает) → CB.step(f, dt); удар по нажатию —
//   CB.attack(f, o) (o: { falling, sprint }); попадания — пока идёт удар: CB.sweepBegin(f, глаз, взгляд) → для каждой цели
//   CB.sweepHit(f, x, y, z, hw, h, id) → CB.hit(f, цель, out, …) (урон, отброс, оглушение, блок/отбив) → CB.applyHp(цель, out).
//   Удар без бойца (зверь, стрела, ловушка): out.dmg / kb / poise → CB.receive(цель, out, откуда, куда, ударивший-боец|null).
// Сеть и позы человечка: CB.pose(f, alpha, dt, out) → { r, l, m, mh, v, g, d, p } (что в руках, движение и его фаза 0…3,
//   щит, лук, наклон взгляда); CB.pack(out) → одно 32-битное число, CB.unpack(n, out) — обратно (world3d.js: o.hold).
// Единицы — игры (у «Кубомира» — блоки и секунды); углы — радианы; f.fx / f.fz — куда смотрит боец (для щита) — ставит игра.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const CB = E.combat = E.combat || {};
  CB.VERSION = 1;
  const PI = Math.PI;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const wrap = a => { while (a > PI) a -= 2 * PI; while (a < -PI) a += 2 * PI; return a; };

  // ── Хват и позы. Номера — для сети и поз человечка (world3d.js — те же списки): только дописывать в конец ──
  CB.GRIP = { none: 0, one: 1, two: 2, off: 3 };   // одноручный, двуручный (обе руки), только левая (щит, фонарь)
  const HOLDS = CB.HOLDS = ['', 'fist', 'tool', 'sword', 'axe', 'pick', 'shovel', 'block', 'item', 'torch', 'food', 'shield', 'bow'];
  const MOTIONS = CB.MOTIONS = ['', 'jab', 'slash', 'back', 'thrust', 'chop', 'dig', 'scoop', 'swing', 'push', 'eat', 'shoot', 'bash'];
  const HO = CB.HO = {}, MO = CB.MO = {};
  HOLDS.forEach((n, i) => { HO[n] = i; }); MOTIONS.forEach((n, i) => { MO[n] = i; });

  // ── Удары. axis — как идёт клинок: 'h' — вбок (угол по горизонтали от a0 к a1; «+» — вправо), 'v' — сверху вниз (угол по
  //    вертикали от взгляда; «+» — вверх), 't' — укол вперёд (дальность растёт за удар). w — полуширина клинка поперёк (рад).
  //    wind / act / rec — замах, удар (попадания — только в нём), возврат (с). reach, dmg, kb, poise — множители оружия;
  //    sweep — может задеть нескольких (только при полной перезарядке); guard — выбивает щит (топор) ──
  const MOVES = CB.MOVES = {
    jab:    { axis: 't', w: .34, wind: .03, act: .07, rec: .12, reach: 1, dmg: 1, kb: 1, poise: .6 },
    slash:  { axis: 'h', a0: 1.05, a1: -1.05, w: .5, wind: .07, act: .1, rec: .18, reach: 1, dmg: 1, kb: 1, poise: 1, sweep: 1 },
    back:   { axis: 'h', a0: -1.05, a1: 1.05, w: .5, wind: .05, act: .1, rec: .18, reach: 1, dmg: 1, kb: 1, poise: 1, sweep: 1 },
    thrust: { axis: 't', w: .26, wind: .1, act: .08, rec: .22, reach: 1.25, dmg: 1.3, kb: 1.6, poise: 1.6 },
    chop:   { axis: 'v', a0: 1.25, a1: -.75, w: .34, wind: .17, act: .1, rec: .28, reach: 1, dmg: 1, kb: 1.2, poise: 1.8, guard: 1 },
    dig:    { axis: 'v', a0: .95, a1: -.6, w: .38, wind: .1, act: .1, rec: .22, reach: 1, dmg: 1, kb: .9, poise: 1 },
    scoop:  { axis: 'v', a0: -.55, a1: .6, w: .42, wind: .08, act: .1, rec: .22, reach: 1, dmg: 1, kb: 1, poise: .9 },
  };
  for (const [id, M] of Object.entries(MOVES)) { M.id = id; M.mo = MO[id]; M.dur = M.wind + M.act + M.rec; }

  // ── Оружие по виду. cool — полная перезарядка (с), reach — дальность (блоков), dmg — урон при полной перезарядке, kb — отброс
  //    (блоков/с), moves — серия, chain — сколько ждёт следующий удар серии после конца удара (с), sweepMul — урон остальным
  //    при размахе; block — щит: arc (сектор спереди, рад), cut (доля урона, которую держит), raise (поднять, с), parry (окно
  //    отбива после начала подъёма, с), parryCD (до нового окна), kb (доля отброса по себе), stagger (оглушить ударившего, с),
  //    push (отбросить его, блоков/с), disable (топор выбил — щит не поднять, с); bow — лук: full (полная натяжка, с), min
  //    (меньше — не выстрелит), speed (скорость стрелы при полной, блоков/с), dmg (урон при полной) ──
  const FIST = { grip: 'one', hold: 'fist', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'] };
  const KINDS = CB.KINDS = {
    fist: FIST,
    sword: { grip: 'one', hold: 'sword', cool: .625, reach: 3, dmg: 4, kb: 6, moves: ['slash', 'back', 'thrust'], chain: .9, sweepMul: .5 },
    axe: { grip: 'one', hold: 'axe', cool: 1, reach: 3, dmg: 5, kb: 7, moves: ['chop'], guardBreak: 2.5 },
    pick: { grip: 'one', hold: 'pick', cool: .83, reach: 3, dmg: 2, kb: 5, moves: ['dig'] },
    shovel: { grip: 'one', hold: 'shovel', cool: 1, reach: 3, dmg: 2, kb: 5, moves: ['scoop'] },
    shield: { grip: 'off', hold: 'shield', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'],
      block: { arc: 2.3, cut: 1, raise: .12, parry: .2, parryCD: .7, kb: .3, stagger: 1, push: 6, disable: 2.5 } },
    bow: { grip: 'two', hold: 'bow', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'], bow: { full: 1, min: .2, speed: 34, dmg: 6 } },
    torch: { grip: 'one', hold: 'torch', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'] },
    food: { grip: 'one', hold: 'food', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'] },
    block: { grip: 'one', hold: 'block', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'] },
    item: { grip: 'one', hold: 'item', cool: .25, reach: 2.6, dmg: 1, kb: 4, moves: ['jab'] },
  };
  // оружие (данные → готовый объект: удары — ссылки, номера поз и хвата). o — поверх вида: { kind, dmg, kb, cool, reach, grip, … }
  CB.weapon = (o) => {
    const k = typeof o === 'string' ? o : o && o.kind, base = KINDS[k] || FIST, src = typeof o === 'object' && o ? o : {};
    const w = Object.assign({}, base, src);
    w.kind = KINDS[k] ? k : 'fist';
    w.grip = CB.GRIP[w.grip] ? w.grip : 'one'; w.g = CB.GRIP[w.grip];
    w.ho = HO[w.hold] || HO.fist;
    w.mv = (Array.isArray(w.moves) && w.moves.length ? w.moves : FIST.moves).map(n => MOVES[n] || MOVES.jab);
    w.cool = Math.max(.05, +w.cool || .25); w.reach = Math.max(.5, +w.reach || 2.6); w.dmg = Math.max(0, +w.dmg || 0); w.kb = Math.max(0, +w.kb || 0);
    w.chain = +w.chain || 0; w.sweepMul = w.sweepMul == null ? .5 : +w.sweepMul;
    if (w.block) w.block = Object.assign({}, KINDS.shield.block, w.block);
    if (w.bow) w.bow = Object.assign({}, KINDS.bow.bow, w.bow);
    return w;
  };
  CB.FIST = CB.weapon('fist');

  // ── Боец ──
  // invT — неуязвимость после удара (с), poise — стойкость (сколько «силы ударов» держит до оглушения), poiseRegen — в секунду
  // (через 1,5 с без ударов), stagT — оглушение (с), kbRes — стойкость к отбросу 0…1, stam — выносливость (−1 — нет), hp — здоровье
  // (null — здоровье ведёт игра)
  CB.init = (f, o = {}) => {
    f.cf = 1;
    f.hp = o.hp == null ? (f.hp == null ? null : f.hp) : +o.hp; f.ko = false;
    f.invT = o.invT ?? .5; f.inv = 0;
    f.poiseMax = o.poise ?? 1; f.poise = f.poiseMax; f.poiseRegen = o.poiseRegen ?? .6; f.poiseT = 9;
    f.stagT = o.stagT ?? .45; f.stag = 0; f.kbRes = clamp(o.kbRes ?? 0, 0, 1);
    f.stamMax = o.stam ?? -1; f.stam = f.stamMax; f.stamRegen = o.stamRegen ?? 20;
    f.main = null; f.off = null; f.cdT = 99;
    // удар: mv — движение (MOVES), mi — номер в серии, tA — с начала, u0/u1 — доля удара (клинка) в начале и в конце шага
    f.mv = null; f.mi = 0; f.tA = 0; f.u0 = 0; f.u1 = 0; f.live = false; f.charge = 1; f.crit = 0; f.sprint = 0; f.lastW = null;
    f.comboT = 0; f.buf = 0; f.bufO = 0; f.hits = new Float64Array(8); f.nHits = 0;
    // клинок этого шага (CB.sweepBegin): глаз, базис взгляда, отрезок угла и дальность
    f.spx = 0; f.spy = 0; f.spz = 0; f.sfx = 0; f.sfz = 1; f.srx = 1; f.srz = 0; f.sp = 0; f.slo = 0; f.shi = 0; f.sreach = 0;
    // щит: guardOn — держит кнопку, guard — поднят 0…1, pw — окно отбива (с), pcd — до нового окна, dis — выбит (с), rip — ответный
    // удар после отбива (с: следующий удар — крит), flash — вспышка отбива (для картинки, с)
    f.guardOn = false; f.guard = 0; f.pw = 0; f.pcd = 0; f.dis = 0; f.rip = 0; f.flash = 0;
    // лук: drawOn — тянет, draw — сколько тянет (с), shotT — с выстрела (отдача на картинке)
    f.drawOn = false; f.draw = 0; f.shotT = 9;
    f.fx = 0; f.fz = 1;
    return f;
  };
  CB.fighter = o => CB.init({}, o);
  const shieldOf = f => (f.off && f.off.block) || (f.main && f.main.grip === 'off' && f.main.block) || null;
  const bowOf = f => (f.main && f.main.bow) || null;
  CB.shield = shieldOf; CB.bowOf = bowOf;
  // что в руках: правая (главная) и левая. Сменил оружие в правой — перезарядка заново (как в Майнкрафте), удар — прерван
  CB.equip = (f, main, off) => {
    const m = main || null, l = off || null;
    if (f.main !== m) {
      if (f.main || f.cdT < 99) f.cdT = 0;
      if (f.mv) { f.mv = null; f.live = false; }
      f.comboT = 0; f.buf = 0; f.mi = 0;
      if (!(m && m.bow)) { f.drawOn = false; f.draw = 0; }
      f.main = m;
    }
    if (f.off !== l) f.off = l;
    if (!shieldOf(f)) { f.guardOn = false; f.guard = 0; f.pw = 0; }
  };
  CB.guard = (f, on) => { f.guardOn = !!on && !!shieldOf(f); };
  // лук: тянуть (on) / отпустить → сила выстрела 0…1 (0 — не выстрелил: мало натянул или лука нет), как в Майнкрафте (k² + 2k) / 3
  CB.bow = (f, on) => {
    const B = bowOf(f);
    if (!B || f.stag > 0 || f.ko) { f.drawOn = false; f.draw = 0; return 0; }
    if (on) { f.drawOn = true; return 0; }
    if (!f.drawOn) return 0;
    f.drawOn = false;
    const d = f.draw; f.draw = 0;
    if (d < B.min) return 0;
    const k = Math.min(1, d / B.full);
    f.shotT = 0;
    return (k * k + 2 * k) / 3;
  };
  CB.charge = f => clamp(f.cdT / ((f.main || CB.FIST).cool), 0, 1);
  CB.drawK = f => { const B = bowOf(f); return B ? Math.min(1, f.draw / B.full) : 0; };

  // ── Удар по нажатию: идёт замах или сам удар — нажатие запомнится (0,2 с); перезарядка — урон и отброс ──
  CB.attack = (f, o) => {
    if (f.ko || f.stag > 0) return 0;
    const W = f.main || CB.FIST;
    if (f.mv && f.tA < f.mv.wind + f.mv.act) { f.buf = .2; f.bufO = o && o.falling ? 1 : 0; return 0; }
    const st = W.stam || 1;
    if (f.stamMax >= 0 && f.stam < st) return 0;
    if (f.stamMax >= 0) f.stam -= st;
    const charge = clamp(f.cdT / W.cool, 0, 1);
    // серия: следующий удар — если прошлый недавно кончился (или ещё возвращается) тем же оружием и заряд почти полный;
    // слабый (бьёт часто) — серия с начала
    let mi = 0;
    if ((f.mv || f.comboT > 0) && f.lastW === W && charge >= .8 && W.mv.length > 1) mi = (f.mi + 1) % W.mv.length;
    f.mi = mi; f.mv = W.mv[mi]; f.tA = 0; f.u0 = f.u1 = 0; f.live = false;
    f.charge = charge; f.cdT = 0; f.nHits = 0; f.comboT = 0; f.buf = 0; f.lastW = W;
    f.crit = ((o && o.falling) || f.rip > 0) && charge >= .9 ? 1 : 0;
    if (f.rip > 0 && charge >= .9) f.rip = 0;
    f.sprint = o && o.sprint && charge >= .9 ? 1 : 0;
    return f.mv.mo;
  };

  // ── Шаг бойца: таймеры, щит, лук, фазы удара ──
  CB.step = (f, dt) => {
    // запомненное нажатие: прошлый удар уже отбил (его последняя часть клинка проверена в прошлом шаге) — следующий удар
    if (f.buf > 0) {
      if (!f.mv || f.tA >= f.mv.wind + f.mv.act) { const fo = f.bufO; f.buf = 0; BUFO.falling = !!fo; BUFO.sprint = false; CB.attack(f, BUFO); }
      else f.buf = Math.max(0, f.buf - dt);
    }
    f.cdT = Math.min(99, f.cdT + dt);
    if (f.inv > 0) f.inv = Math.max(0, f.inv - dt);
    if (f.flash > 0) f.flash = Math.max(0, f.flash - dt);
    if (f.rip > 0) f.rip = Math.max(0, f.rip - dt);
    if (f.dis > 0) f.dis = Math.max(0, f.dis - dt);
    if (f.pcd > 0) f.pcd = Math.max(0, f.pcd - dt);
    if (f.pw > 0) f.pw = Math.max(0, f.pw - dt);
    if (f.shotT < 9) f.shotT += dt;
    f.poiseT = Math.min(9, f.poiseT + dt);
    if (f.poiseT > 1.5 && f.poise < f.poiseMax) f.poise = Math.min(f.poiseMax, f.poise + f.poiseRegen * dt);
    if (f.stamMax >= 0 && f.stam < f.stamMax && !f.mv) f.stam = Math.min(f.stamMax, f.stam + f.stamRegen * dt);
    if (f.stag > 0) { f.stag = Math.max(0, f.stag - dt); f.mv = null; f.live = false; f.buf = 0; f.drawOn = false; f.draw = 0; }
    // щит: поднимается, пока держит кнопку (не во время своего удара, не оглушён, не выбит); окно отбива — с начала подъёма
    const B = shieldOf(f), swinging = !!f.mv && f.tA < f.mv.wind + f.mv.act;
    if (B && f.guardOn && !swinging && f.stag <= 0 && f.dis <= 0 && !f.ko) {
      if (f.guard <= 0 && f.pcd <= 0) { f.pw = B.parry; f.pcd = B.parryCD; }
      f.guard = Math.min(1, f.guard + dt / B.raise);
    } else if (f.guard > 0) { f.guard = Math.max(0, f.guard - dt / ((B ? B.raise : .12) * 1.4)); if (f.guard <= 0) f.pw = 0; }
    // лук: тянет — копит натяжку (до полной + запас: «держит»)
    const BW = bowOf(f);
    if (BW && f.drawOn && f.stag <= 0) f.draw = Math.min(BW.full * 3, f.draw + dt);
    // удар: доля клинка в начале и в конце шага; закончился — ждёт следующего удара серии
    const M = f.mv;
    if (M) {
      const t0 = f.tA, t1 = t0 + dt;
      f.tA = t1;
      f.u0 = clamp((t0 - M.wind) / M.act, 0, 1); f.u1 = clamp((t1 - M.wind) / M.act, 0, 1);
      f.live = f.u1 > f.u0;
      if (t1 >= M.dur) { f.mv = null; f.live = false; f.comboT = (f.lastW && f.lastW.chain) || 0; }
    } else { f.live = false; if (f.comboT > 0) f.comboT = Math.max(0, f.comboT - dt); }
  };
  const BUFO = { falling: false, sprint: false };

  // ── Клинок этого шага: глаз (px, py, pz) и куда смотрит (dx, dy, dz — единичный). false — сейчас не бьёт ──
  CB.sweepBegin = (f, px, py, pz, dx, dy, dz) => {
    if (!f.mv || !f.live) return false;
    const M = f.mv, W = f.lastW || CB.FIST, hl = Math.hypot(dx, dz);
    if (hl > 1e-6) { f.sfx = dx / hl; f.sfz = dz / hl; }
    f.srx = -f.sfz; f.srz = f.sfx;
    f.spx = px; f.spy = py; f.spz = pz;
    f.sp = Math.atan2(dy, hl);
    const R = W.reach * M.reach;
    if (M.axis === 't') { f.slo = -M.w; f.shi = M.w; f.sreach = R * (.55 + .45 * f.u1); }
    else {
      const A0 = M.a0 + (M.a1 - M.a0) * f.u0, A1 = M.a0 + (M.a1 - M.a0) * f.u1;
      f.slo = Math.min(A0, A1); f.shi = Math.max(A0, A1); f.sreach = R;
      if (M.axis === 'v') { f.slo += f.sp; f.shi += f.sp; }
    }
    return true;
  };
  // Цель-коробка: середина основания (x, z), низ y, полуширина hw, высота h; id — чтобы не задеть дважды за удар
  CB.sweepHit = (f, x, y, z, hw, h, id) => {
    const M = f.mv; if (!M || !f.live) return false;
    for (let i = 0; i < f.nHits; i++) if (f.hits[i] === id) return false;
    const multi = M.sweep && f.charge >= .9 ? f.hits.length : 1;
    if (f.nHits >= multi) return false;
    const px = f.spx, py = f.spy, pz = f.spz;
    // дальность: ближняя точка коробки
    const qx = clamp(px, x - hw, x + hw), qy = clamp(py, y, y + h), qz = clamp(pz, z - hw, z + hw);
    const ddx = qx - px, ddy = qy - py, ddz = qz - pz;
    if (ddx * ddx + ddy * ddy + ddz * ddz > f.sreach * f.sreach) return false;
    // по горизонтали: углы углов коробки от взгляда (внутри — во все стороны)
    let ylo = -PI, yhi = PI;
    const inside = Math.abs(x - px) <= hw && Math.abs(z - pz) <= hw;
    if (!inside) {
      const cr = (x - px) * f.srx + (z - pz) * f.srz, cf = (x - px) * f.sfx + (z - pz) * f.sfz, ac = Math.atan2(cr, cf);
      ylo = ac; yhi = ac;
      for (let k = 0; k < 4; k++) {
        const ox = x + (k & 1 ? hw : -hw) - px, oz = z + (k & 2 ? hw : -hw) - pz;
        const a = ac + wrap(Math.atan2(ox * f.srx + oz * f.srz, ox * f.sfx + oz * f.sfz) - ac);
        if (a < ylo) ylo = a; if (a > yhi) yhi = a;
      }
    }
    // по вертикали: от низа до верха коробки на ближнем расстоянии по горизонтали
    const hd = Math.max(.3, Math.hypot(ddx, ddz)), plo = Math.atan2(y - py, hd), phi = Math.atan2(y + h - py, hd);
    let okY, okP;
    if (M.axis === 'h') { okY = f.shi >= ylo && f.slo <= yhi; okP = f.sp + M.w >= plo && f.sp - M.w <= phi; }
    else if (M.axis === 'v') { okP = f.shi >= plo && f.slo <= phi; okY = M.w >= ylo && -M.w <= yhi; }
    else { okY = f.shi >= ylo && f.slo <= yhi; okP = f.sp + M.w >= plo && f.sp - M.w <= phi; }
    if (!okY || !okP) return false;
    f.hits[f.nHits++] = id;
    return true;
  };

  // ── Попадание удара бойца att по цели def: урон по перезарядке (0,2 + 0,8·заряд²), крит ×1,5 (в падении или ответ после отбива),
  //    размах — остальным sweepMul; отброс (0,3 + 0,7·заряд, на бегу ×1,5), сила по стойкости — заряд; топор выбивает щит ──
  CB.hit = (att, def, out, ax, az, bx, bz) => {
    const W = att.lastW || CB.FIST, M = att.mv || W.mv[0], c = att.charge;
    let dmg = W.dmg * M.dmg * (.2 + .8 * c * c);
    if (att.crit) dmg *= 1.5;
    if (att.nHits > 1) dmg *= W.sweepMul;
    out.dmg = dmg;
    out.kb = W.kb * M.kb * (.3 + .7 * c) * (att.sprint ? 1.5 : 1) * (att.nHits > 1 ? .6 : 1);
    out.poise = M.poise * c * c * (att.crit ? 1.5 : 1);
    out.guardBreak = M.guard && W.guardBreak && c >= .9 ? W.guardBreak : 0;
    out.crit = att.crit; out.charge = c;
    return CB.receive(def, out, ax, az, bx, bz, att);
  };
  // Удар по цели def (out.dmg, kb, poise, guardBreak — уже есть) из точки (ax, az) в (bx, bz); att — ударивший боец (оглушить при
  // отбиве) или null. Итог — в out: dmg (сколько снять), kx/ky/kz (отброс цели, блоков/с), akx/akz (отброс ударившего — при
  // отбиве), ignored (неуязвим), blocked, parried, disabled (щит выбит), stagger (оглушён), wear (износ щита)
  CB.receive = (def, out, ax, az, bx, bz, att) => {
    out.ignored = 0; out.blocked = 0; out.parried = 0; out.disabled = 0; out.stagger = 0; out.ko = 0; out.wear = 0; out.akx = 0; out.akz = 0;
    if (out.guardBreak == null) out.guardBreak = 0;
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz);
    if (l > 1e-6) { dx /= l; dz /= l; } else { dx = -def.fx; dz = -def.fz; }
    const kb = out.kb || 0;
    out.kx = dx * kb; out.kz = dz * kb; out.ky = kb > 0 ? Math.min(5, 2.2 + kb * .3) : 0;
    if (def.ko || def.inv > 0) { out.ignored = 1; out.dmg = 0; out.kx = out.kz = out.ky = 0; return out; }
    // щит спереди: окно отбива — идеальный блок; поднят — блок
    const B = shieldOf(def);
    if (B && def.dis <= 0 && (def.guard >= 1 || def.pw > 0) && -(dx * def.fx + dz * def.fz) >= Math.cos(B.arc / 2)) {
      if (def.pw > 0) {
        out.parried = 1; out.dmg = 0; out.kx = out.kz = out.ky = 0;
        def.pw = 0; def.pcd = 0; def.rip = 1; def.flash = .3; def.guard = 1;
        if (att && att.cf) { att.stag = Math.max(att.stag, B.stagger); att.mv = null; att.live = false; att.buf = 0; att.guard = 0; att.pw = 0; att.drawOn = false; att.draw = 0; }
        out.akx = -dx * B.push; out.akz = -dz * B.push;
        return out;
      }
      out.blocked = 1; out.wear = Math.max(1, Math.ceil(out.dmg || 0));
      out.dmg = (out.dmg || 0) * (1 - B.cut);
      out.kx *= B.kb; out.kz *= B.kb; out.ky = 0;
      if (out.guardBreak > 0) { def.dis = out.guardBreak; def.guard = 0; def.pw = 0; out.disabled = 1; }
      return out;
    }
    def.inv = def.invT;
    def.poiseT = 0; def.poise -= out.poise || 0;
    if (def.poise <= 0) {
      out.stagger = 1; def.poise = def.poiseMax; def.stag = Math.max(def.stag, def.stagT);
      def.mv = null; def.live = false; def.buf = 0; def.guard = 0; def.pw = 0; def.drawOn = false; def.draw = 0;
    }
    const kr = 1 - def.kbRes; out.kx *= kr; out.kz *= kr; out.ky *= kr;
    return out;
  };
  // Здоровье цели (если его ведёт бой): снять урон, 0 — нокаут (out.ko)
  CB.applyHp = (def, out) => {
    if (!(out.dmg > 0) || def.hp == null || def.ko) return out;
    def.hp = Math.max(0, def.hp - out.dmg);
    if (def.hp <= 0) { def.ko = true; out.ko = 1; def.mv = null; def.live = false; def.guard = 0; }
    return out;
  };

  // ── Поза для человечка и сети: что в руках (r — правая, l — левая: номера HOLDS), движение (m, MOTIONS) правой (mh 0) или левой
  //    (mh 1), фаза v 0…3 (0…1 — замах, 1…2 — удар, 2…3 — возврат), g — щит 0…1, d — лук 0…1, p — наклон взгляда (рад).
  //    alpha — доля шага до следующего (плавно между шагами), step — шаг (с) ──
  CB.pose = (f, alpha, step, out) => {
    const M = f.mv;
    out.r = f.main ? (f.main.grip === 'off' ? 0 : f.main.ho) : 0;
    out.l = f.main && f.main.grip === 'two' ? f.main.ho : f.main && f.main.grip === 'off' ? f.main.ho : f.off ? f.off.ho : 0;
    out.m = 0; out.mh = 0; out.v = 0;
    if (M) {
      const t = Math.min(M.dur, f.tA + (alpha || 0) * (step || 0));
      out.m = M.mo;
      out.v = t < M.wind ? t / M.wind : t < M.wind + M.act ? 1 + (t - M.wind) / M.act : 2 + Math.min(1, (t - M.wind - M.act) / M.rec);
    }
    out.g = f.guard;
    out.d = CB.drawK(f);
    return out;
  };
  // одно число (32 бита): r 4, l 4, m 5, mh 1, v 6 (3/63), g 3 (1/7), d 4 (1/15), p 5 (±1,4 рад)
  CB.pack = o => {
    const v = Math.round(clamp(o.v || 0, 0, 3) / 3 * 63), g = Math.round(clamp(o.g || 0, 0, 1) * 7), d = Math.round(clamp(o.d || 0, 0, 1) * 15);
    const p = Math.round((clamp(o.p || 0, -1.4, 1.4) + 1.4) / 2.8 * 31);
    return ((o.r & 15) | ((o.l & 15) << 4) | ((o.m & 31) << 8) | ((o.mh & 1) << 13) | (v << 14) | (g << 20) | (d << 23) | (p << 27)) >>> 0;
  };
  CB.unpack = (n, out) => {
    out.r = n & 15; out.l = (n >>> 4) & 15; out.m = (n >>> 8) & 31; out.mh = (n >>> 13) & 1;
    out.v = ((n >>> 14) & 63) / 63 * 3; out.g = ((n >>> 20) & 7) / 7; out.d = ((n >>> 23) & 15) / 15; out.p = ((n >>> 27) & 31) / 31 * 2.8 - 1.4;
    return out;
  };
})();

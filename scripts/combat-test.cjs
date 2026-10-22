// Ядро боя движка (js/engine/combat.js, D37E.combat) без браузера: node scripts/combat-test.cjs
// Данные оружия и ударов, перезарядка (бить часто — слабо), серия ударов, дуга клинка по коробкам (без «пролёта» между шагами),
// размах по нескольким, неуязвимость, стойкость и оглушение, блок и отбив щитом (окно, перезарядка окна, ответный крит), топор
// выбивает щит, лук (натяжка и сила), нокаут, упаковка позы для сети; бой одинаковый при 30 / 60 / 144 кадрах (настоящий цикл
// движка E.loop) и одинаковый при повторе; шаг без мусора (отдельный процесс, --expose-gc).
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/combat.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = window.D37E, CB = E.combat;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const DT = 1 / 60;

// ── шаг без мусора: отдельный процесс (молодое поколение большое — сборок нет, считаем прирост кучи) ──
if (process.argv.includes('--alloc')) {
  const A = CB.fighter({ poise: 3, invT: .5 }), B = CB.fighter({ poise: 1, invT: .45, hp: 1e12 }), Wsw = CB.weapon({ kind: 'sword', dmg: 6 }), Wsh = CB.weapon('shield'), Wax = CB.weapon('axe');
  const out = { dmg: 0, kb: 0, poise: 0 }, pose = { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 }, o = { falling: false, sprint: false };
  const run = n => {
    for (let i = 0; i < n; i++) {
      CB.equip(A, (i >> 9) & 1 ? Wax : Wsw, Wsh); CB.equip(B, null, null);
      CB.guard(A, (i % 90) > 60); CB.step(A, DT); CB.step(B, DT);
      if (i % 37 === 0) CB.attack(A, o);
      if (i % 53 === 0) CB.attack(B, o);
      if (CB.sweepBegin(A, 0, 1.6, 0, 0, 0, 1)) for (let k = 0; k < 4; k++) if (CB.sweepHit(A, k * .3 - .45, 0, 1.6, .3, 1.8, 10 + k)) { CB.hit(A, B, out, 0, 0, k * .3 - .45, 1.6); CB.applyHp(B, out); }
      if (CB.sweepBegin(B, 0, 1.6, 1.6, 0, 0, -1) && CB.sweepHit(B, 0, 0, 0, .3, 1.8, 1)) { CB.hit(B, A, out, 0, 1.6, 0, 0); }
      CB.pose(A, .5, DT, pose); CB.unpack(CB.pack(pose), pose);
    }
  };
  run(200000);
  let best = Infinity;
  for (let k = 0; k < 4; k++) { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed; run(300000); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 300000); }
  console.log(JSON.stringify({ perStep: best }));
  return;
}

const mk = (o = {}) => CB.fighter(Object.assign({ invT: .45, poise: 1 }, o));
const OUT = () => ({ dmg: 0, kb: 0, poise: 0 });
// шагать бойца n шагов; f(i) — до шага
const run = (F, n, f) => { for (let i = 0; i < n; i++) { f?.(i); CB.step(F, DT); } };

// ═══ 1. Данные ═══
sec('данные: оружие, удары, хват, номера поз и движений');
{
  ok(CB.HOLDS.length <= 16 && CB.MOTIONS.length <= 32, 'номера поз — в 4 бита, движений — в 5 (сеть)', [CB.HOLDS.length, CB.MOTIONS.length]);
  for (const [k, K] of Object.entries(CB.KINDS)) {
    const w = CB.weapon(k);
    ok(w.kind === k && w.g >= 1 && w.ho > 0 && w.mv.length >= 1 && w.mv.every(m => m && m.dur > 0) && w.cool > 0 && w.reach > 0, 'оружие «' + k + '» — готово (хват, поза, удары)', w);
  }
  for (const [id, M] of Object.entries(CB.MOVES)) ok(M.wind > 0 && M.act > 0 && M.rec > 0 && ['h', 'v', 't'].includes(M.axis) && CB.MOTIONS[M.mo] === id, 'удар «' + id + '»: замах, удар, возврат, ось');
  ok(CB.weapon('shield').grip === 'off' && CB.weapon('bow').grip === 'two' && CB.weapon('sword').grip === 'one', 'хват: щит — только левая, лук — двумя, меч — одной');
  const mod = CB.weapon({ kind: 'sword', dmg: 9, grip: 'two', moves: ['thrust'] });
  ok(mod.dmg === 9 && mod.grip === 'two' && mod.mv.length === 1 && mod.mv[0].id === 'thrust' && CB.weapon('sword').dmg === 4, 'своё оружие (мод): поверх вида, вид не испорчен');
  ok(CB.weapon('nope').kind === 'fist' && CB.weapon(null).kind === 'fist', 'неизвестный вид — кулак');
  ok(CB.weapon('sword').mv.map(m => m.id).join() === 'slash,back,thrust' && CB.weapon('axe').mv[0].id === 'chop' && CB.weapon('pick').mv[0].id === 'dig', 'серии: меч — рубка, обратная, укол; топор — сверху; кирка — дуга');
}

// ═══ 2. Перезарядка ═══
sec('перезарядка: часто — слабо, вовремя — полный удар');
{
  const sw = CB.weapon('sword');
  const dmgAt = gap => {   // ударить, подождать gap с, ударить ещё раз: урон второго (цель — далеко не отходит)
    const A = mk(), B = mk({ invT: 0, poise: 99 }); CB.equip(A, sw, null);
    const o = OUT(); let got = 0;
    CB.attack(A, null);
    run(A, Math.round(gap / DT));
    CB.attack(A, null);
    run(A, 30, () => { if (CB.sweepBegin(A, 0, 1.6, 0, 0, 0, 1) && CB.sweepHit(A, 0, 0, 2, .3, 1.8, 1)) { CB.hit(A, B, o, 0, 0, 0, 2); got = o.dmg; } });
    return got;
  };
  const d0 = dmgAt(.1), d1 = dmgAt(.3), d2 = dmgAt(.7);
  ok(near(d2, 4) && d0 < d1 && d1 < d2 && d0 <= 4 * .3, 'меч: через 0,1 с — меньше трети, через 0,7 с — полный (4)', [d0, d1, d2]);
  const A = mk(); CB.equip(A, sw, null);
  ok(near(CB.charge(A), 1), 'при входе — заряжен');
  CB.attack(A, null); run(A, 15);
  ok(CB.charge(A) > .35 && CB.charge(A) < .45, 'заряд растёт от начала удара (0,25 с из 0,625)', CB.charge(A));
  CB.equip(A, CB.weapon('axe'), null);
  ok(CB.charge(A) === 0, 'сменил оружие — перезарядка заново (нельзя «подменить» топор на полный удар)');
}

// ═══ 3. Серия ═══
sec('серия: вовремя — рубка → обратная → укол; часто — только рубка');
{
  const sw = CB.weapon('sword');
  const seq = gap => { const A = mk(); CB.equip(A, sw, null); const ids = []; for (let k = 0; k < 5; k++) { CB.attack(A, null); ids.push(A.mv?.id || '-'); run(A, Math.round(gap / DT)); } return ids.join(','); };
  ok(seq(.7) === 'slash,back,thrust,slash,back', 'удары раз в 0,7 с — серия по кругу', seq(.7));
  ok(seq(2.5) === 'slash,slash,slash,slash,slash', 'долго ждал — серия с начала', seq(2.5));
  const fast = seq(.12);
  ok(!fast.includes('thrust') && !fast.includes('back'), 'бьёт часто (0,12 с) — без серии (запомненное нажатие — рубка заново)', fast);
}

// ═══ 4. Дуга клинка ═══
sec('дуга клинка по коробкам: сектор, дальность, высота, укол, сверху; без пролёта между шагами');
{
  const sw = CB.weapon('sword');
  // цель на угле a (рад, «+» — вправо) на расстоянии r, высота y0; смотрит вдоль +z (вправо — это −x)
  const hitBy = (W, a, r, y0 = 0, pitch = 0, h = 1.8, hw = .3) => {
    const A = mk(); CB.equip(A, W, null); CB.attack(A, null);
    const tx = -Math.sin(a) * r, tz = Math.cos(a) * r, dy = Math.sin(pitch), c = Math.cos(pitch);
    let hit = false;
    run(A, 40, () => { if (CB.sweepBegin(A, 0, 1.6, 0, 0, dy, c) && CB.sweepHit(A, tx, y0, tz, hw, h, 7)) hit = true; });
    return hit;
  };
  ok(hitBy(sw, 0, 2), 'рубка: прямо перед собой — попал');
  ok(hitBy(sw, .9, 2) && hitBy(sw, -.9, 2), 'рубка: справа и слева в секторе — попал');
  ok(!hitBy(sw, 1.6, 2) && !hitBy(sw, -1.6, 2) && !hitBy(sw, Math.PI, 2), 'рубка: сбоку и сзади — мимо');
  ok(!hitBy(sw, 0, 3.6), 'дальше дальности (3 + полкоробки) — мимо');
  ok(!hitBy(sw, 0, 2, 3.2) && hitBy(sw, 0, 2, 3.2, .9), 'цель высоко над взглядом — мимо, посмотрел вверх — попал');
  // без пролёта: тонкая цель на любом угле сектора — попадает (за шаг клинок проходит ~0,35 рад)
  let miss = 0; for (let k = 0; k <= 40; k++) { const a = -1 + k * .05; if (!hitBy(sw, a, 2.4, 0, 0, 1.8, .05)) miss++; }
  ok(miss === 0, 'тонкая цель (0,1) на любом угле сектора — попал (клинок не «пролетает» между шагами)', miss);
  // укол — узко, но дальше
  const th = CB.weapon({ kind: 'sword', moves: ['thrust'] });
  ok(hitBy(th, 0, 3.4) && !hitBy(sw, 0, 3.55) && !hitBy(th, .6, 2), 'укол: дальше рубки, но узко (0,6 рад в сторону — мимо)');
  // топор сверху: цель внизу перед собой — попал, сбоку — мимо
  const ax = CB.weapon('axe');
  ok(hitBy(ax, 0, 1.5, -.6, -.4, .8) && !hitBy(ax, .9, 2), 'топор сверху вниз: низкая цель перед собой — попал, сбоку — мимо');
  // внутри коробки цели (вплотную) — попадает
  ok(hitBy(sw, 0, .1), 'цель вплотную (в ней) — попал');
}

// ═══ 5. Размах: несколько целей только при полной перезарядке; цель — один раз за удар ═══
sec('размах: несколько — при полной перезарядке, остальным меньше; одна цель — один раз');
{
  const sw = CB.weapon('sword');
  const swing = (wait) => {
    const A = mk(); CB.equip(A, sw, null);
    if (wait != null) { CB.attack(A, null); run(A, Math.round(wait / DT)); }
    CB.attack(A, null); const got = [];
    const T = [[-.8, 2], [0, 2.2], [.8, 2]].map(([a, r]) => [-Math.sin(a) * r, Math.cos(a) * r]);
    run(A, 30, () => { if (CB.sweepBegin(A, 0, 1.6, 0, 0, 0, 1)) for (let k = 0; k < 3; k++) if (CB.sweepHit(A, T[k][0], 0, T[k][1], .3, 1.8, k)) { const o = OUT(), B = mk({ invT: 0 }); CB.hit(A, B, o, 0, 0, T[k][0], T[k][1]); got.push([k, +o.dmg.toFixed(3)]); } });
    return got;
  };
  const full = swing(null), weak = swing(.4);   // через 0,4 с после прошлого (он уже кончился) — заряд 0,64
  ok(full.length === 3 && near(full[0][1], 4) && full.slice(1).every(g => g[1] < 4), 'полный удар рубкой — задел троих, первому — полный урон, остальным — половина', full);
  ok(weak.length === 1, 'слабый (часто бьёт) — только одного', weak);
}

// ═══ 6. Неуязвимость, стойкость, оглушение ═══
sec('неуязвимость после удара, стойкость, оглушение; отброс по оружию и силе');
{
  const B = mk({ invT: .45, poise: 1, stagT: .5 }), o = OUT();
  Object.assign(o, { dmg: 3, kb: 6, poise: .3 }); CB.receive(B, o, 0, 0, 0, 2, null);
  ok(near(o.dmg, 3) && !o.stagger && near(o.kz, 6) && o.ky > 0, 'удар: урон, отброс от ударившего, чуть вверх', o);
  Object.assign(o, { dmg: 3, kb: 6, poise: .3 }); CB.receive(B, o, 0, 0, 0, 2, null);
  ok(o.ignored && o.dmg === 0 && o.kz === 0, 'сразу ещё — неуязвим (0,45 с)');
  run(B, 30);
  Object.assign(o, { dmg: 1, kb: 2, poise: .8 }); CB.receive(B, o, 0, 0, 0, 2, null);
  ok(o.stagger && B.stag > .4, 'стойкость кончилась (0,3 + 0,8 > 1) — оглушён', { stag: B.stag, poise: B.poise });
  const A = mk(); CB.equip(A, CB.weapon('sword'), null); CB.attack(A, null);
  Object.assign(o, { dmg: 1, kb: 1, poise: 5 }); CB.receive(A, o, 0, 0, 0, 1, null); CB.step(A, DT);
  ok(!A.mv && CB.attack(A, null) === 0, 'оглушённый не бьёт: удар прерван, новый не начать');
  run(A, 40); ok(CB.attack(A, null) > 0, 'отошёл от оглушения — бьёт');
  // стойкость восстанавливается через 1,5 с без ударов
  const C = mk({ poise: 2, invT: 0 }); Object.assign(o, { dmg: 1, kb: 0, poise: 1.5 }); CB.receive(C, o, 0, 0, 0, 1, null);
  const p1 = C.poise; run(C, 60); const p2 = C.poise; run(C, 120);
  ok(near(p1, .5) && near(p2, .5) && C.poise > 1.3 && C.poise <= 2, 'стойкость: 1,5 с ждёт, потом набирается (0,6 в секунду)', [p1, p2, C.poise]);
  // отброс: тяжёлый моб (kbRes) — меньше
  const H = mk({ kbRes: .5 }); Object.assign(o, { dmg: 1, kb: 6, poise: 0 }); CB.receive(H, o, 0, 0, 2, 0, null);
  ok(near(o.kx, 3) && near(o.kz, 0), 'стойкость к отбросу 0,5 — отброс вдвое меньше', o);
  // атака бойца: сила отброса и стойкости — от заряда
  const sw = CB.weapon('sword');
  const kbOf = wait => { const P = mk(); CB.equip(P, sw, null); if (wait != null) { CB.attack(P, null); run(P, Math.round(wait / DT)); } CB.attack(P, null); let r = null; run(P, 30, () => { if (CB.sweepBegin(P, 0, 1.6, 0, 0, 0, 1) && CB.sweepHit(P, 0, 0, 2, .3, 1.8, 1)) { const q = OUT(); CB.hit(P, mk({ invT: 0, poise: 99 }), q, 0, 0, 0, 2); r = q; } }); return r; };
  const kF = kbOf(null), kW = kbOf(.1);
  ok(kF.kb > kW.kb * 1.7 && kF.poise >= 1 && kW.poise < .1, 'полный удар — сильный отброс и сбивает с ног, частый — слабый', [kF.kb, kW.kb, kF.poise, kW.poise]);
}

// ═══ 7. Щит: блок, отбив, топор ═══
sec('щит: поднять — блок спереди, окно отбива — оглушает ударившего, ответный крит; сзади — не спасает; топор выбивает');
{
  const sh = CB.weapon('shield'), sw = CB.weapon('sword');
  const D = mk({ poise: 3 }); CB.equip(D, sw, sh); D.fx = 0; D.fz = 1;   // смотрит на +z
  const Z = CB.init({ type: 'zombie' }, { poise: 1 });   // свой объект (как моб) — поля боя прямо в нём
  // окно отбива: поднял — 0,2 с
  CB.guard(D, true); CB.step(D, DT);
  ok(D.pw > .15 && D.guard > 0 && D.guard < 1, 'поднимает щит: окно отбива открыто', { pw: D.pw, g: D.guard });
  const o = OUT(); Object.assign(o, { dmg: 3, kb: 5, poise: 1 });
  CB.receive(D, o, 0, 2, 0, 0, Z);   // удар спереди (от +z)
  ok(o.parried && o.dmg === 0 && Z.stag >= 1 && o.akz > 0 && D.rip > 0 && D.flash > 0, 'удар в окно — отбив: урона нет, ударивший оглушён и отброшен, вспышка', { o, stag: Z.stag });
  run(D, 20, () => CB.guard(D, true));
  ok(near(D.guard, 1) && D.pw === 0, 'поднят полностью, окно кончилось');
  Object.assign(o, { dmg: 3, kb: 5, poise: 1 }); CB.receive(D, o, 0, 2, 0, 0, null);
  ok(o.blocked && o.dmg === 0 && o.wear === 3 && Math.abs(o.kz) < 2, 'щит поднят — блок спереди: урона нет, щит изнашивается, отброс мал', o);
  Object.assign(o, { dmg: 3, kb: 5, poise: .2 }); CB.receive(D, o, 0, -2, 0, 0, null);
  ok(!o.blocked && o.dmg === 3, 'удар сзади — щит не спасает', o);
  // ответный удар после отбива — крит
  const D2 = mk(); CB.equip(D2, sw, sh); D2.fx = 0; D2.fz = 1; CB.guard(D2, true); CB.step(D2, DT);
  Object.assign(o, { dmg: 3, kb: 5, poise: 1 }); CB.receive(D2, o, 0, 2, 0, 0, null);
  CB.guard(D2, false); run(D2, 40);
  CB.attack(D2, null);
  let cr = null; run(D2, 30, () => { if (CB.sweepBegin(D2, 0, 1.6, 0, 0, 0, 1) && CB.sweepHit(D2, 0, 0, 2, .3, 1.8, 1)) { const q = OUT(); CB.hit(D2, mk({ invT: 0, poise: 9 }), q, 0, 0, 0, 2); cr = q; } });
  ok(cr && cr.crit && near(cr.dmg, 6), 'ответ после отбива — крит ×1,5 (меч 4 → 6)', cr);
  // окно отбива — не чаще раза в 0,7 с (спам кнопкой не даёт вечного отбива)
  const D3 = mk(); CB.equip(D3, null, sh);
  let windows = 0, prev = 0;
  run(D3, 120, i => { CB.guard(D3, (i % 12) < 4); if (D3.pw > 0 && prev === 0) windows++; prev = D3.pw; });
  ok(windows <= 3 && windows >= 2, 'жмёт щит 5 раз в секунду — окон отбива за 2 с не больше 3', windows);
  // свой удар опускает щит
  const D4 = mk(); CB.equip(D4, sw, sh); run(D4, 20, () => CB.guard(D4, true));
  CB.attack(D4, null); run(D4, 6, () => CB.guard(D4, true));
  ok(D4.guard < 1, 'ударил — щит опускается (нельзя бить и держать блок)', D4.guard);
  // топор выбивает щит
  const D5 = mk(); CB.equip(D5, sw, sh); D5.fx = 0; D5.fz = 1; run(D5, 20, () => CB.guard(D5, true));
  const Ax = mk(); CB.equip(Ax, CB.weapon('axe'), null); CB.attack(Ax, null);
  let dis = null; run(Ax, 40, () => { CB.guard(D5, true); CB.step(D5, DT); if (CB.sweepBegin(Ax, 0, 1.6, 2, 0, -.3, -.95) && CB.sweepHit(Ax, 0, 0, 0, .3, 1.8, 5)) { const q = OUT(); CB.hit(Ax, D5, q, 0, 2, 0, 0); dis = q; } });
  ok(dis && dis.blocked && dis.disabled && D5.dis > 2 && D5.guard === 0, 'топор по щиту — блок, но щит выбит на 2,5 с', dis);
  run(D5, 60, () => CB.guard(D5, true)); ok(D5.guard === 0, 'выбитый щит не поднять');
  run(D5, 120, () => CB.guard(D5, true)); ok(D5.guard === 1, 'через 2,5 с — снова поднимается');
}

// ═══ 8. Лук ═══
sec('лук: тянуть и отпустить — сила по натяжке; мало натянул — не стреляет');
{
  const bw = CB.weapon('bow'), A = mk(); CB.equip(A, bw, null);
  const shot = sec2 => { CB.bow(A, true); run(A, Math.round(sec2 / DT), () => CB.bow(A, true)); return CB.bow(A, false); };
  const s0 = shot(.1), s1 = shot(.5), s2 = shot(1), s3 = shot(2);
  ok(s0 === 0 && near(s1, (.25 + 1) / 3, .03) && near(s2, 1) && near(s3, 1), 'натяжка 0,1 с — нет; 0,5 с — 0,42; 1 с и дольше — 1', [s0, s1, s2, s3]);
  CB.equip(A, CB.weapon('sword'), null); ok(CB.bow(A, true) === 0 && A.draw === 0, 'без лука — не тянет');
  CB.equip(A, bw, null); CB.bow(A, true); run(A, 30, () => CB.bow(A, true)); A.stag = .3; CB.step(A, DT);
  ok(A.draw === 0 && CB.bow(A, false) === 0, 'оглушили — натяжка сбита');
}

// ═══ 9. Нокаут ═══
sec('нокаут: здоровье 0 — «без сил», больше не бьют');
{
  const B = mk({ hp: 5, invT: 0 }), o = OUT();
  Object.assign(o, { dmg: 3, kb: 0, poise: 0 }); CB.receive(B, o, 0, 0, 0, 1, null); CB.applyHp(B, o);
  ok(B.hp === 2 && !B.ko && !o.ko, 'урон снят');
  Object.assign(o, { dmg: 3, kb: 0, poise: 0 }); CB.receive(B, o, 0, 0, 0, 1, null); CB.applyHp(B, o);
  ok(B.hp === 0 && B.ko && o.ko, 'здоровье 0 — нокаут');
  Object.assign(o, { dmg: 3, kb: 4, poise: 0 }); CB.receive(B, o, 0, 0, 0, 1, null);
  ok(o.ignored && o.dmg === 0, 'нокаутированного больше не бьют');
  CB.equip(B, CB.weapon('sword'), null); ok(CB.attack(B, null) === 0, 'нокаутированный не бьёт');
}

// ═══ 10. Поза и сеть ═══
sec('поза человечка и одно число для сети');
{
  const A = mk(); CB.equip(A, CB.weapon('sword'), CB.weapon('shield'));
  const P = { r: 0, l: 0, m: 0, mh: 0, v: 0, g: 0, d: 0, p: 0 };
  CB.pose(A, 0, DT, P);
  ok(P.r === CB.HO.sword && P.l === CB.HO.shield && P.m === 0, 'в руках: меч и щит, движения нет', P);
  CB.attack(A, null); run(A, 3); CB.pose(A, .5, DT, P);
  ok(P.m === CB.MO.slash && P.v > 0 && P.v < 1, 'замах рубки: фаза 0…1', P);
  run(A, 6); CB.pose(A, 0, DT, P); ok(P.v >= 1 && P.v < 2, 'удар: фаза 1…2', P);
  run(A, 8); CB.pose(A, 0, DT, P); ok(P.v >= 2 && P.v <= 3, 'возврат: фаза 2…3', P);
  CB.equip(A, CB.weapon('bow'), CB.weapon('shield')); CB.pose(A, 0, DT, P);
  ok(P.r === CB.HO.bow && P.l === CB.HO.bow, 'лук — обеими руками (щит убран)', P);
  CB.equip(A, CB.weapon('shield'), null); CB.pose(A, 0, DT, P);
  ok(P.r === 0 && P.l === CB.HO.shield, 'щит выбран в панели — в левой руке, правая свободна', P);
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const q = { r: i % 13, l: (i * 7) % 13, m: i % 13, mh: i & 1, v: (i % 97) / 96 * 3, g: (i % 11) / 10, d: (i % 17) / 16, p: ((i % 29) / 28 - .5) * 2.6 }, u = CB.unpack(CB.pack(q), {});
    worst = Math.max(worst, Math.abs(u.v - q.v) / 3 * 63 > .51 ? 9 : 0, u.r !== q.r || u.l !== q.l || u.m !== q.m || u.mh !== q.mh ? 9 : 0, Math.abs(u.g - q.g), Math.abs(u.d - q.d), Math.abs(u.p - q.p));
  }
  ok(worst < .1, 'упаковка: номера — точно, фаза — до 1/63, щит и лук — до 1/14, наклон — до 0,05 рад', worst);
  ok(CB.pack({ r: 12, l: 12, m: 31, mh: 1, v: 3, g: 1, d: 1, p: 1.4 }) <= 0xffffffff, 'влезает в 32 бита');
}

// ═══ 11. Одинаково при 30 / 60 / 144 кадрах и при повторе ═══
sec('бой одинаковый при 30, 60 и 144 кадрах (цикл движка E.loop) и при повторе');
{
  const loopRun = (frameMs, sec2, update) => {
    let now = 0; const q = [];
    const raf0 = globalThis.requestAnimationFrame, perf0 = globalThis.performance, doc0 = globalThis.document;
    globalThis.requestAnimationFrame = cb => { q.push(cb); return q.length; }; globalThis.cancelAnimationFrame = () => {};
    globalThis.performance = { now: () => now }; globalThis.document = { hidden: false };
    try { const L = E.loop(update, () => {}); while (now < sec2 * 1000) { now += frameMs; for (const cb of q.splice(0)) cb(now); } L.stop(); }
    finally { globalThis.requestAnimationFrame = raf0; globalThis.performance = perf0; globalThis.document = doc0; }
  };
  // дуэль: игрок (меч + щит) против зомби-бойца (рука); зомби думает 20 раз в секунду (каждый 3-й шаг), замах — по шагам
  const duel = (frameMs, byFrame) => {
    const P = CB.fighter({ hp: 20, invT: .5, poise: 3 }), Z = CB.fighter({ hp: 20, invT: .45, poise: 1, kbRes: .2 });
    CB.equip(P, CB.weapon({ kind: 'sword', dmg: 6 }), CB.weapon('shield')); CB.equip(Z, CB.weapon({ kind: 'fist', dmg: 3, cool: 1 }), null);
    const S = { px: 0, pz: 0, zx: 0, zz: 3, zvx: 0, zvz: 0, n: 0, t: 0, log: [] }, o = OUT(), ao = { falling: false, sprint: false };
    let tFrame = 0, attackIn = false, guardIn = false;
    const plan = t => { attackIn = (t % 1.1) < DT * .99 + 1e-12 && t > .3; guardIn = (t % 2.4) > 1.5 && (t % 2.4) < 2.1; };
    const step = dt => {
      if (!byFrame) plan(S.t);
      CB.guard(P, guardIn); P.fx = 0; P.fz = 1; Z.fx = 0; Z.fz = -1;
      if (attackIn) { CB.attack(P, ao); attackIn = false; }
      if (S.n % 3 === 0) { const d = S.zz - S.pz; if (d > 1.6) S.zvz = -2.4; else { S.zvz = 0; if (!Z.mv) CB.attack(Z, null); } }
      CB.step(P, dt); CB.step(Z, dt);
      S.zz += S.zvz * dt; S.zx += S.zvx * dt; S.zvx *= Math.exp(-10 * dt); S.zvz += (0 - S.zvz) * (1 - Math.exp(-10 * dt));
      if (CB.sweepBegin(P, S.px, 1.6, S.pz, 0, -.1, 1) && CB.sweepHit(P, S.zx, 0, S.zz, .3, 1.85, 2)) { CB.hit(P, Z, o, S.px, S.pz, S.zx, S.zz); CB.applyHp(Z, o); S.zvz += o.kz; S.log.push(['P', S.n, +o.dmg.toFixed(6), o.stagger, o.ko]); }
      if (CB.sweepBegin(Z, S.zx, 1.6, S.zz, 0, -.1, -1) && CB.sweepHit(Z, S.px, 0, S.pz, .3, 1.8, 1)) { CB.hit(Z, P, o, S.zx, S.zz, S.px, S.pz); CB.applyHp(P, o); S.zvz += o.akz; S.log.push(['Z', S.n, +o.dmg.toFixed(6), o.parried, o.blocked]); }
      S.n++; S.t += dt;
    };
    if (!byFrame) loopRun(frameMs, 12, step);
    else {
      let now = 0; const q = []; const raf0 = globalThis.requestAnimationFrame, perf0 = globalThis.performance, doc0 = globalThis.document;
      globalThis.requestAnimationFrame = cb => { q.push(cb); return q.length; }; globalThis.performance = { now: () => now }; globalThis.document = { hidden: false };
      try { const L = E.loop(step, () => {}); let lastA = -1; while (now < 12000) { now += frameMs; tFrame = now / 1000; const a = Math.floor((tFrame - .3) / 1.1); if (tFrame > .3 && a !== lastA) { lastA = a; attackIn = true; } guardIn = (tFrame % 2.4) > 1.5 && (tFrame % 2.4) < 2.1; for (const cb of q.splice(0)) cb(now); } L.stop(); }
      finally { globalThis.requestAnimationFrame = raf0; globalThis.performance = perf0; globalThis.document = doc0; }
    }
    return { n: S.n, php: P.hp, zhp: Z.hp, zko: Z.ko, zz: S.zz, log: JSON.stringify(S.log), hits: S.log.length, parried: S.log.filter(l => l[0] === 'Z' && l[3]).length };
  };
  const A = duel(1000 / 60), B = duel(1000 / 144), C3 = duel(1000 / 30), A2 = duel(1000 / 60);
  ok(A.n === B.n && A.n === C3.n && A.log === B.log && A.log === C3.log && near(A.zz, B.zz, 1e-9) && near(A.zz, C3.zz, 1e-9), 'дуэль (ввод по шагам): 60, 144 и 30 кадров — те же удары, урон и места', { A: A.log.slice(0, 200), B: B.log.slice(0, 200) });
  ok(A.log === A2.log && A.php === A2.php, 'повтор — то же самое (случайностей нет)');
  ok(A.hits >= 6 && A.zko && A.parried >= 1, '…и бой честный: удары с обеих сторон, отбив щитом, зомби — нокаут', { hits: A.hits, zko: A.zko, parried: A.parried, php: A.php });
  const D1 = duel(1000 / 60, true), D2 = duel(1000 / 144, true), D3 = duel(1000 / 30, true);
  ok(D1.zko && D2.zko && D3.zko && Math.abs(D1.hits - D3.hits) <= 3 && Math.abs(D1.hits - D2.hits) <= 3, 'ввод между кадрами (как события страницы): у всех зомби — нокаут, ударов почти столько же', [D1.hits, D2.hits, D3.hits]);
}

// ═══ 12. Шаг без мусора ═══
sec('шаг боя без мусора (отдельный процесс)');
{
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=256', __filename, '--alloc'], { encoding: 'utf8', timeout: 180000 });
  let res = null; try { res = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  // объект за шаг дал бы ≥ 16 байт; меньше 4 — служебный шум V8 (замер без боя — те же ~0,5)
  ok(res && res.perStep < 4, 'шаг двух бойцов (удары, щит, дуга, попадания, поза, упаковка) — без новых объектов (байт на шаг)', res ? res.perStep.toFixed(2) : (r.stderr || r.stdout || '').slice(0, 300));
  if (res) console.log(`  мусор: ${res.perStep.toFixed(2)} байт на шаг`);
}

console.log(`\ncombat-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

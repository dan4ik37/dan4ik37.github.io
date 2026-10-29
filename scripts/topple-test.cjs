// T-138 (ci-run: topple-test): крен и опрокидывание (D37E.topple) и рубка дерева (D37E.fell) — ядро без браузера.
//   node --expose-gc scripts/topple-test.cjs [--fast]
// Проверяет: таблицы (хеш — «золотой»), решение стоит / крен / опрокидывание (подрубленная башня, центр на тонкой опоре, гриб,
// столб 1×1×25 стоит — как в спеке), этажи, ход по тактам (сначала крен, потом падение, перекат через свес, лёг на бок),
// зависание на соседе, одинаково при 30 / 60 / 144 кадрах, бюджет чтений за такт, мусор за шаг; рубка: подруб решает сторону,
// великану нужно больше ударов, недопил держит, тяжёлая крона кренится сама.
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis; globalThis.self = globalThis;
for (const f of ['js/engine/topple.js', 'js/engine/fell.js']) require(path.join(SITE, f));
const TP = D37E.topple, FL = D37E.fell;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const NUM = {};   // цифры для отчёта

// мир: множество твёрдых клеток (числовой ключ — без мусора в проверке)
const K = (x, y, z) => ((x + 2048) * 4096 + (z + 2048)) * 256 + (y + 64);
function world(){ const S = new Set(); S.add2 = (x, y, z) => S.add(K(x, y, z)); S.solid = (x, y, z) => S.has(K(x, y, z)); return S; }
function ground(S, r = 40, y = -1){ for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) S.add2(x, y, z); }
// тело из списка клеток [x, y, z]; опора — клетка под ней твёрдая в мире или своя (связанная: bend)
function bodyOf(cells, S, mass = 2400, bend = 3200, loose = false){
  const B = TP.body(4096), own = new Set(cells.map(c => K(c[0], c[1], c[2])));
  for (const [x, y, z, m] of cells) {
    const i = B.push(x, y, z, m ?? mass);
    const below = own.has(K(x, y - 1, z)) || S.solid(x, y - 1, z);
    if (below && (!loose || !own.has(K(x, y - 1, z)))) B.contact(i, loose ? 0 : bend, 8 * x, 8 * x + 8, 8 * z, 8 * z + 8);
  }
  return B;
}
const box = (x0, x1, y0, y1, z0, z1, skip) => { const a = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (!skip || !skip(x, y, z)) a.push([x, y, z]); return a; };
const deg = th => Math.round(th / TP.FINE_DEG * 10) / 10;

sec('таблицы: sin / cos / atan2 / isqrt — целые, одинаковые везде');
{
  ok(TP.sin(0) === 0 && TP.sin(16384) === 16384 && TP.sin(32768) === 0 && TP.sin(49152) === -16384 && TP.cos(0) === 16384, 'sin/cos в четвертях');
  ok(TP.atan2(1, 1) === 8192 && TP.atan2(1, 0) === 16384 && TP.atan2(0, -1) === -32768 && TP.atan2(-1, 0) === -16384, 'atan2: 45°, 90°, 180°, −90°', [TP.atan2(1, 1), TP.atan2(1, 0), TP.atan2(0, -1), TP.atan2(-1, 0)]);
  ok(TP.isqrt(2 ** 50) === 2 ** 25 && TP.isqrt(2 ** 50 - 1) === 2 ** 25 - 1, 'isqrt точный у 2^50');
  NUM.tableHash = TP.tableHash();
  ok(NUM.tableHash === 17280408, 'хеш таблиц — «золотой» (Rust / C# — то же число)', NUM.tableHash);
  let maxErr = 0; for (let a = 0; a < 65536; a += 7) { const e = Math.abs(TP.sin(a) / 16384 - Math.sin(a / 65536 * 2 * Math.PI)); if (e > maxErr) maxErr = e; }
  ok(maxErr < 2e-4, 'sin по таблице — ошибка < 2e-4', maxErr);
}

sec('решение: стоит / крен / опрокидывание (центр масс против следа опоры, «тонкая опора»)');
const S0 = world(); ground(S0);
{
  const R = TP.result();
  TP.storeys(bodyOf(box(-1, 1, 0, 7, -1, 1), S0), { sway: 50 }, R);
  ok(R.kind === 0, 'целая каменная башня 3×3×8 — стоит', R);
  TP.storeys(bodyOf(box(0, 0, 0, 24, 0, 0), S0, 650, 3600), { sway: 50 }, R);
  ok(R.kind === 0, 'деревянный столб 1×1×25 — стоит (как в спеке: «a 1×1 wood tower 25 high stands»)', R);
  // подрубили низ с +x: снят столбик x = 1 и половина x = 0 (срез 4/8 с +x у трёх клеток)
  const und = bodyOf(box(-1, 1, 0, 7, -1, 1, (x, y) => y === 0 && x === 1), S0);
  for (let i = 0; i < und.n; i++) if (und.y[i] === 0 && und.x[i] === 0) und.x1[i] = 8 * 0 + 4;
  TP.storeys(und, { sway: 50 }, R);
  ok(R.kind >= 2 && R.dir === 0 && R.layer === 0, 'подрубленная с +x башня — крен / опрокидывание к подрубу (+x)', { kind: R.kind, dir: R.dir, layer: R.layer, over: R.over });
  NUM.undercut = { kind: R.kind === 2 ? 'tip' : 'lean', ratio: R.ratio, amp: R.amp };
  // тяжёлый блок 3×3×6 на тонкой ножке 1×1×3 по центру — кренится; чуть тяжелее с −z — туда
  const mush = box(0, 0, 0, 2, 0, 0).concat(box(-1, 1, 3, 8, -1, 1));
  TP.storeys(bodyOf(mush, S0), { sway: 50 }, R);
  ok(R.kind === 3 && R.dir === 0, 'тяжёлое по центру на тонкой ножке — кренится (ровно по центру — к +x, первое направление)', { kind: R.kind, dir: R.dir, ratio: R.ratio, amp: R.amp, layer: R.layer });
  NUM.pillar = { kind: R.kind, ratio: R.ratio, amp: R.amp };
  TP.storeys(bodyOf(mush.concat([[0, 9, -1], [1, 9, -1]]), S0), { sway: 50 }, R);
  ok(R.kind >= 2 && R.dir === 3, 'на ножке и тяжелее с −z — кренится к −z (к тяжёлой стороне)', { kind: R.kind, dir: R.dir });
  // гриб-стол 3×3 на ножке 1×1×3 из дерева: «реализм» — кренится, «мягкое» (раскачка 25 ‰, × 2 прочность) — стоит
  const table = box(0, 0, 0, 2, 0, 0).concat(box(-1, 1, 3, 3, -1, 1));
  TP.storeys(bodyOf(table, S0, 650, 3600), { sway: 50 }, R); const real = R.kind;
  TP.storeys(bodyOf(table, S0, 650, 7200), { sway: 25 }, R); const soft = R.kind;
  ok(real === 3 && soft === 0, 'стол 3×3 на ножке: «реализм» — кренится, «мягкое» — стоит', { real, soft });
  // плита 5×5 на четырёх угловых столбах — стоит (след широкий)
  const roof = box(-2, -2, 0, 2, -2, -2).concat(box(2, 2, 0, 2, -2, -2), box(-2, -2, 0, 2, 2, 2), box(2, 2, 0, 2, 2, 2), box(-2, 2, 3, 3, -2, 2));
  TP.storeys(bodyOf(roof, S0, 650, 3600), { sway: 50 }, R);
  ok(R.kind === 0, 'крыша 5×5 на четырёх угловых столбах — стоит', R.kind);
  // тонкая шея на 3-м этаже: падает часть выше неё
  const neck = box(-1, 1, 0, 2, -1, 1).concat(box(0, 0, 3, 3, 0, 0), box(-2, 2, 4, 7, -2, 2));
  const BN = bodyOf(neck, S0); TP.storeys(BN, { sway: 50 }, R);
  let upOk = true; for (let i = 0; i < BN.n; i++) if ((BN.up[i] === 1) !== (BN.y[i] >= R.layer)) upOk = false;
  ok(R.kind >= 2 && R.layer === 3 && upOk, 'шея 1×1 на 3-м этаже под грибом 5×5×4 — ломается этаж 3, падает часть выше', { kind: R.kind, layer: R.layer });
  // свободный кусок (обрушение) стоит краем: центр масс за краем — опрокидывается, над следом — нет (вниз как раньше)
  const L1 = bodyOf(box(0, 4, 0, 0, 0, 0).map(c => c.concat(c[0] === 0 ? [] : [])), world(), 2400, 0, true);
  const Sx = world(); Sx.add2(0, -1, 0);
  const LB = bodyOf(box(0, 4, 0, 0, 0, 0), Sx, 2400, 0, true); TP.analyze(LB, { sway: 50 }, R);
  ok(R.kind === 2 && R.dir === 0, 'балка 5 лежит краем на одной клетке — опрокидывается с края (+x)', { kind: R.kind, dir: R.dir });
  const Sy = world(); Sy.add2(2, -1, 0);
  TP.analyze(bodyOf(box(0, 4, 0, 0, 0, 0), Sy, 2400, 0, true), { sway: 50 }, R);
  ok(R.kind === 0, 'та же балка серединой на опоре — стоит (как раньше)', R.kind);
  void L1;
}

// ── ход по тактам: такт мира 20 Гц; кадры fps → шаги 60 Гц → каждый 3-й — такт (как «Кубомир») ──
function simulate(S, B, R, fps, o = {}, maxT = 400, onEv){
  const Wd = TP.world({}), s = Wd.add(B, R, Object.assign({ ox: 0, oy: 0, oz: 0 }, o));
  const tr = [], evs = []; let acc = 0, steps = 0, ticks = 0, done = false;
  const solid = (x, y, z) => S.solid(x, y, z);
  for (let f = 0; f < maxT * 3 * fps / 60 + 10 && !done; f++) {
    acc += 1 / fps;
    while (acc >= 1 / 60 - 1e-12 && !done) {
      acc -= 1 / 60; steps++;
      if (steps % 3) continue;
      ticks++;
      const n = Wd.tick(solid);
      tr.push(Wd.th[s]);
      for (let k = 0; k < n; k++) {
        const t = Wd.ev[k * 5 + 1]; evs.push([ticks, t, Wd.ev[k * 5 + 2], Wd.ev[k * 5 + 3], Wd.ev[k * 5 + 4]]);
        if (t === 2) Wd.drop(s, 0);
        if (t === 3) done = true;
        if (onEv) onEv(Wd, s, t, ticks);
      }
      if (ticks >= maxT) done = true;
    }
  }
  return { Wd, s, tr, evs, ticks };
}
const hashTr = tr => { let h = 2166136261; for (const v of tr) h = Math.imul(h ^ v, 16777619); return h >>> 0; };

sec('ход: сначала крен, потом падение целым к подрубу; перекат через свес; лёг на бок');
{
  const und = bodyOf(box(-1, 1, 0, 7, -1, 1, (x, y) => y === 0 && x >= 0), S0);
  const R = TP.storeys(und, { sway: 50 });
  const A = simulate(S0, und, R, 60, { rate: Math.round(2 * TP.FINE_DEG / 80) });
  const land = A.evs.find(e => e[1] === 2), rest = A.evs.find(e => e[1] === 3);
  const lean5 = A.tr.findIndex(t => t >= 5 * TP.FINE_DEG), t45 = A.tr.findIndex(t => t >= 45 * TP.FINE_DEG);
  ok(land && rest && R.dir === 0, 'подрубленная башня легла (LAND, потом REST)', { land, rest, dir: R.dir });
  ok(lean5 > 4 && t45 - lean5 < lean5 * 3, 'начало медленное (крен: до 5° — ' + lean5 + ' тактов), потом быстрее (5° → 45° — ' + (t45 - lean5) + ')', { lean5, t45 });
  NUM.towerTicks = { lean5, t45, land: land && land[0] };
  // клетки легли на бок к +x: верх башни — дальше всех по +x
  const out = [0, 0, 0]; let allPlus = true, maxX = -99;
  for (let i = 0; i < und.n; i++) { A.Wd.land(A.s, und.x[i], und.y[i], und.z[i], out); if (out[0] < 0) allPlus = false; if (und.y[i] === 7 && out[0] > maxX) maxX = out[0]; }
  ok(allPlus && maxX >= 6 && A.Wd.stats.repivots >= 1, 'лёг на бок к +x (верх — дальше всех, перекат через свес)', { maxX, repivots: A.Wd.stats.repivots });
  // все клетки на разных местах (нет наложений), на земле (y ≥ 0)
  const seen = new Set(); let clash = 0, under = 0; for (let i = 0; i < und.n; i++) { A.Wd.land(A.s, und.x[i], und.y[i], und.z[i], out); const k = out.join(','); if (seen.has(k)) clash++; seen.add(k); if (out[1] < 0) under++; }
  ok(clash === 0 && under === 0, 'места клеток после поворота не совпадают и не под землёй', { clash, under });
}

sec('тяжёлое на ножке по центру: крен (медленно, со скрипом), потом падение к тяжёлой стороне');
{
  const mush = box(0, 0, 0, 2, 0, 0).concat(box(-1, 1, 3, 8, -1, 1), [[0, 9, -1], [1, 9, -1]]);
  const B = bodyOf(mush, S0), R = TP.storeys(B, { sway: 50 });
  const A = simulate(S0, B, R, 60, { rate: Math.round(2 * TP.FINE_DEG / 80) });
  const creak = A.evs.filter(e => e[1] === 4).length, land = A.evs.find(e => e[1] === 2);
  const lean5 = A.tr.findIndex(t => t >= 5 * TP.FINE_DEG);
  ok(R.kind === 3 && R.dir === 3 && land && creak >= 1, 'крен к −z (тяжёлая сторона), скрип, лёг', { kind: R.kind, dir: R.dir, creak, land });
  ok(lean5 >= 10, 'крен медленный: до 5° — ' + lean5 + ' тактов (≥ 0,5 с)', lean5);
  NUM.pillarTicks = { lean5, land: land && land[0], creak };
}

sec('зависание: упёрлось в соседнюю стену — висит наклонённым; стену убрали — падает дальше');
{
  const S = world(); ground(S); for (let y = 0; y < 12; y++) for (let z = -2; z <= 2; z++) S.add2(4, y, z);   // стена в 2 клетках по +x
  const und = bodyOf(box(-1, 1, 0, 9, -1, 1, (x, y) => y === 0 && x >= 0), S);
  const R = TP.storeys(und, { sway: 50 });
  let hungAt = -1, after = -1;
  const A = simulate(S, und, R, 60, {}, 200, (Wd, s, t, tk) => { if (t === 1 && hungAt < 0) hungAt = tk; });
  const th = A.Wd.th[A.s], ph = A.Wd.phase(A.s);
  ok(hungAt > 0 && ph === TP.PH.HUNG && th > 5 * TP.FINE_DEG && th < 60 * TP.FINE_DEG, 'повис на стене (' + deg(th) + '°) и висит', { hungAt, ph, deg: deg(th) });
  // 100 тактов — угол не меняется
  for (let k = 0; k < 100; k++) A.Wd.tick((x, y, z) => S.solid(x, y, z));
  ok(A.Wd.th[A.s] === th && A.Wd.phase(A.s) === TP.PH.HUNG, 'через 100 тактов — висит так же (наклонённый, опасный)');
  // стену убрали — падает дальше
  for (let y = 0; y < 12; y++) for (let z = -2; z <= 2; z++) S.delete(K(4, y, z));
  A.Wd.resume(A.s, 300);
  for (let k = 0; k < 200 && A.Wd.phase(A.s) !== TP.PH.LANDED; k++) { A.Wd.tick((x, y, z) => S.solid(x, y, z)); after = k; }
  ok(A.Wd.phase(A.s) === TP.PH.LANDED, 'стену убрали — упал дальше и лёг', { after });
  NUM.hang = { deg: deg(th), at: hungAt };
}

sec('одинаково при 30 / 60 / 144 кадрах (такт мира, целые числа)');
{
  const mk = () => { const und = bodyOf(box(-1, 1, 0, 7, -1, 1, (x, y) => y === 0 && x >= 0), S0); return [und, TP.storeys(und, { sway: 50 })]; };
  const H = [30, 60, 144].map(fps => { const [B, R] = mk(); const A = simulate(S0, B, R, fps, { rate: 700 }); return [hashTr(A.tr), A.evs.map(e => e.join(':')).join('|'), A.tr.length]; });
  ok(H[0][0] === H[1][0] && H[1][0] === H[2][0] && H[0][1] === H[2][1], 'след углов и событий — один и тот же', H.map(h => [h[0], h[2]]));
  const mk2 = () => { const m = box(0, 0, 0, 2, 0, 0).concat(box(-1, 1, 3, 8, -1, 1), [[0, 9, -1]]); const B = bodyOf(m, S0); return [B, TP.storeys(B, { sway: 50 })]; };
  const H2 = [30, 144].map(fps => { const [B, R] = mk2(); return hashTr(simulate(S0, B, R, fps, { rate: 700 }).tr); });
  ok(H2[0] === H2[1], 'крен на ножке — тоже', H2);
  NUM.traceHash = H[0][0];
}

sec('бюджет: 16 тел сразу — чтений за такт ≤ 2048 (лишние ждут такт, все ложатся)');
{
  const Wd = TP.world({ slots: 16, smp: 64, reads: 2048 }), S = world(); ground(S, 120);
  const slots = [];
  for (let k = 0; k < 16; k++) {
    const ox = (k % 4) * 24 - 36, oz = Math.floor(k / 4) * 24 - 36;
    const B = bodyOf(box(-1, 1, 0, 11, -1, 1, (x, y) => y === 0 && x >= 0), S), R = TP.storeys(B, { sway: 50 });
    slots.push(Wd.add(B, R, { ox, oy: 0, oz, rate: 900 }));
  }
  let maxR = 0, landed = 0, t = 0;
  for (; t < 800 && landed < 16; t++) { const n = Wd.tick((x, y, z) => S.solid(x, y, z)); if (Wd.used > maxR) maxR = Wd.used; for (let e = 0; e < n; e++) { const s = Wd.ev[e * 5], ty = Wd.ev[e * 5 + 1]; if (ty === 2) Wd.drop(s, 0); if (ty === 3) { landed++; Wd.free(s); } } }
  ok(slots.every(s => s >= 0) && landed === 16 && maxR <= 2048 && Wd.stats.deferred > 0, '16 тел: все легли, чтений за такт ≤ 2048, лишние ждали', { landed, maxR, deferred: Wd.stats.deferred, ticks: t });
  NUM.budget16 = { maxReads: maxR, deferred: Wd.stats.deferred, ticks: t };
  ok(Wd.add(bodyOf(box(0, 0, 0, 3, 0, 0), S), TP.result(), {}) >= 0, 'слот освободился — новое тело принимается');
}

sec('мусор за шаг (тела в полёте, ровный режим) и время такта');
{
  const Wd = TP.world({}), S = world(); ground(S, 200);
  const B = bodyOf(box(-1, 1, 0, 15, -1, 1, (x, y) => y === 0 && x >= 0), S), R = TP.storeys(B, { sway: 50 });
  const solid = (x, y, z) => S.has(((x + 2048) * 4096 + (z + 2048)) * 256 + (y + 64));
  const refill = () => { for (let k = 0; k < 8; k++) if (Wd.ph[k] === 0) Wd.add(B, R, { ox: (k - 4) * 30, oy: 0, oz: 0, rate: 400 }); };
  refill();
  const step = () => { const n = Wd.tick(solid); for (let e = 0; e < n; e++) { const s = Wd.ev[e * 5], ty = Wd.ev[e * 5 + 1]; if (ty === 2) Wd.drop(s, 0); if (ty === 3) Wd.free(s); } };
  for (let k = 0; k < 300; k++) { step(); if (k % 50 === 0) refill(); }
  const gc = globalThis.gc;
  let bytes = null;
  if (gc) {
    // только шаги (без add): полёт 8 тел
    const MB = bodyOf(box(0, 0, 0, 2, 0, 0).concat(box(-1, 1, 3, 8, -1, 1)), S), MR = TP.storeys(MB, { sway: 50 });   // гриб на ножке: долгий медленный крен
    const W2 = TP.world({}); for (let k = 0; k < 8; k++) W2.add(MB, MR, { ox: (k - 4) * 30, oy: 0, oz: 0, rate: 100 });
    const st2 = () => { W2.tick(solid); };
    for (let k = 0; k < 300; k++) st2();   // прогрев JIT (медленный крен: 8 тел всё время в работе)
    gc(); const h0 = process.memoryUsage().heapUsed;
    for (let k = 0; k < 200; k++) st2();
    gc(); const h1 = process.memoryUsage().heapUsed;
    bytes = Math.max(0, (h1 - h0) / 200);
    let busy = 0; for (let k = 0; k < 16; k++) if (W2.ph[k] === 1 || W2.ph[k] === 2) busy++;
    ok(busy === 8, '8 тел всё ещё кренятся во время замера', busy);
    ok(bytes < 64, 'мусор за такт ~0 Б (8 тел в полёте)', bytes);
  } else console.log('  (без --expose-gc мусор не меряется)');
  const t0 = process.hrtime.bigint(); let n = 0;
  for (let k = 0; k < 2000; k++) { step(); if (k % 40 === 0) refill(); n++; }
  const us = Number(process.hrtime.bigint() - t0) / 1000 / n;
  NUM.tick = { usPerTick8: +us.toFixed(1), garbageBperTick: bytes };
  ok(us < 500, 'такт с 8 телами < 0,5 мс в node (' + us.toFixed(1) + ' мкс)', us);
}

sec('рубка (D37E.fell): подруб решает сторону, недопил держит, великану — больше ударов');
{
  const swings = (D, plan) => { const s = FL.state(D), o = {}; let n = 0; for (const [side, k] of plan) for (let i = 0; i < k; i++) { FL.hit(s, side, 1); n++; FL.decide(s, null, o); if (o.go) return { n, dir: o.dir, kind: o.kind, hinge: o.hinge, s: Array.from(s) }; } return { n, go: 0, s: Array.from(s) }; };
  // тонкое: подруб с +z (3/8), запил с −z — падает на +z (к подрубу), где бы ни стоял игрок
  const a = swings(1, [[2, 3], [3, 8]]);
  ok(a.dir === 2 && a.kind === 1 && a.hinge <= 1, 'подруб с +z, запил с −z — падает к подрубу (+z), недопил ≤ 1/8', a);
  // без подруба: рубит только с −x — дерево уходит от него (+x), когда почти насквозь
  const b = swings(1, [[1, 8]]);
  ok(b.dir === 0 && b.kind === 2 && b.n === 7, 'рубит только с −x — падает от рубящего (+x), за 7 ударов', b);
  // недопил держит: подруб + запил не до конца — стоит
  const c = swings(1, [[0, 3], [1, 3]]);
  ok(!c.go, 'подруб и короткий запил (недопил 2/8) — ещё стоит', c);
  // великаны: удары × ширина (время удара ∝ ширине ствола)
  const cost = D => { const r = swings(D, [[0, Math.ceil(8 * D / 3)], [1, 8 * D]]); return { swings: r.n, time: r.n * D, dir: r.dir }; };
  const c1 = cost(1), c2 = cost(2), c3 = cost(3);
  ok(c1.dir === 0 && c2.dir === 0 && c3.dir === 0 && c2.time >= 3 * c1.time && c3.time >= 8 * c1.time, 'ствол 2×2 — ≥ 3× дольше, 3×3 — ≥ 8× (подруб ⅓ + запил)', { c1, c2, c3 });
  NUM.fellCost = { D1: c1, D2: c2, D3: c3 };
  // тяжёлая крона над глубоким срезом — кренится сама
  const s = FL.state(1); for (let i = 0; i < 5; i++) FL.hit(s, 0, 1); FL.hit(s, 1, 1);
  const o1 = FL.decide(s, null, {}), o2 = FL.decide(s, [16, 0], {});
  ok(!o1.go && o2.go && o2.kind === 3 && o2.dir === 0, 'срез 5/8 с +x: прямая крона — стоит, крона клонится на +x (2 клетки) — пошло само (медленно)', { o1, o2 });
  // клетки сечения 2×2: подруб 10/8 с +x — столбик +x срублен насквозь, у второго снято 2/8
  const s2 = FL.state(2); for (let i = 0; i < 10; i++) FL.hit(s2, 0, 1);
  const cc = [0, 0, 0, 0], g1 = FL.cell(s2, 1, 0, cc), c1v = cc.slice(), g0 = FL.cell(s2, 0, 0, cc);
  ok(g1 && !g0 && cc[0] === 2 && c1v[0] === 8, 'сечение 2×2: ближний к +x столбик срублен, у дальнего снято 2/8', { g1, g0, cc, c1v });
  ok(FL.through(FL.pack(4, 4, 0, 0, 0, 0)) && !FL.through(FL.pack(4, 3, 0, 0, 0, 0)) && FL.left(FL.pack(2, 0, 0, 0, 0, 0)) === 384, 'срез клетки: 4+4 с двух сторон — насквозь, остаток объёма');
}

sec('падение дерева на недопиле; зависло на соседнем стволе');
{
  // дерево: ствол 1×1 от y 1 до 8 над срезом (слой 0 — пень), крона 5×5×3; ось — недопил у +x (подруб 3/8)
  const tree = box(0, 0, 1, 8, 0, 0).map(c => c.concat([650])).concat(box(-2, 2, 7, 9, -2, 2, (x, y, z) => x === 0 && z === 0 && y <= 8).map(c => c.concat([40])));
  const S = world(); ground(S); S.add2(0, 0, 0);   // пень
  const B = TP.body(4096); for (const [x, y, z, m] of tree) B.push(x, y, z, m);
  const R = TP.result(); R.dir = 0; R.pn = 8 - 3; R.py = 8;
  const A = simulate(S, B, R, 60, { rate: Math.round(5 * TP.FINE_DEG / 80), kind: 'lean' });
  const land = A.evs.find(e => e[1] === 2);
  ok(land && A.Wd.dir[A.s] === 0, 'дерево пошло на недопиле к подрубу (+x) и легло', land);
  const out = [0, 0, 0]; let trunkY = new Set(), trunkX = [];
  for (let i = 0; i < 8; i++) { A.Wd.land(A.s, 0, 1 + i, 0, out); trunkY.add(out[1]); trunkX.push(out[0]); }
  ok(trunkY.size === 1 && trunkX[7] - trunkX[0] === 7, 'ствол лёг вдоль падения одной линией (дорубить)', { trunkY: [...trunkY], trunkX });
  NUM.treeTicks = land && land[0];
  // соседний ствол в 3 клетках по +x — повисло на нём
  const S2 = world(); ground(S2); S2.add2(0, 0, 0); for (let y = 0; y < 14; y++) S2.add2(4, y, 0);
  const A2 = simulate(S2, B, R, 60, { rate: Math.round(5 * TP.FINE_DEG / 80), kind: 'lean' }, 200);
  ok(A2.Wd.phase(A2.s) === TP.PH.HUNG && A2.Wd.th[A2.s] < 60 * TP.FINE_DEG, 'упало на соседнее дерево — повисло (' + deg(A2.Wd.th[A2.s]) + '°)', deg(A2.Wd.th[A2.s]));
}

console.log('цифры:', JSON.stringify(NUM));
console.log(`topple-test: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);

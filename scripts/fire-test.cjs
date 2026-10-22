// Огонь движка (js/engine/fire.js, D37E.fire) без браузера: node --expose-gc scripts/fire-test.cjs [--fast]
// Материалы и сроки, горит и догорает, перекидывается на соседей (дом из досок, лес), ветер гонит огонь, дождь гасит, «мокрое»
// не загорается, вода гасит (douse), не загружено — замирает, чернеет до того, как догореть, сохранить посреди пожара и
// продолжить — то же самое, что без перерыва; 2D (y вниз): вверх быстрее, чем вниз; детали (лес деревьев-точек, ветер, сгоревшее
// не горит снова), набор клеток без мусора; одинаково при 30 / 60 / 144 кадрах (шаг игры E.loop) и при любом порядке событий;
// бюджет за такт (3000 горящих — не больше budget обходов, время такта), без мусора (отдельный процесс), 10 минут случайной игры.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/engine/fire.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const FI = window.D37E.fire;
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const MAT = FI.MAT;

// ═══ Мир для проверок: N×H×N клеток, y вверх (3D) — клетка: материал огня (0 — не горит); «мокрые» клетки — бит 64 ═══
function world(N = 64, H = 32){
  const c = new Uint8Array(N * H * N), I = (x, y, z) => (x * H + y) * N + z;
  const inside = (x, y, z) => x >= 0 && z >= 0 && x < N && z < N && y >= 0 && y < H;
  return { N, H, c, get: (x, y, z) => inside(x, y, z) ? c[I(x, y, z)] : 0, set: (x, y, z, m) => { if (inside(x, y, z)) c[I(x, y, z)] = m; }, read: (x, y, z) => inside(x, y, z) ? c[I(x, y, z)] : 0 };
}
// огонь на мире: догорело — клетка пустеет (как у игры)
function fireOn(W, o = {}){
  const log = [];
  const F = FI.grid(Object.assign({ dims: 3, down: -1, hz: 20, cap: 8192, budget: 200, seed: 7, read: W.read,
    onBurnt: (x, y, z, m) => { W.set(x, y, z, 0); log.push('b', x, y, z, F.T); },
    onOut: (x, y, z) => { log.push('o', x, y, z, F.T); },
    onIgnite: (x, y, z) => { log.push('i', x, y, z, F.T); } }, o));
  F.log = log;
  return F;
}
const runTicks = (F, n) => { for (let i = 0; i < n; i++) F.tick(); };
const hashLog = a => { let h = 2166136261; for (const v of a) { const s = String(v); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); h = Math.imul(h ^ 44, 16777619); } return h >>> 0; };
// лес: стволы 1×5 и шапки листвы 5×3×5, в шахматном порядке через 5 клеток (кроны касаются)
function forest(W, n = 6, x0 = 4, z0 = 4){
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const tx = x0 + i * 5, tz = z0 + j * 5;
    for (let y = 1; y <= 5; y++) W.set(tx, y, tz, MAT.wood);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let y = 5; y <= 7; y++) if (!(dx === 0 && dz === 0 && y === 5) && W.get(tx + dx, y, tz + dz) === 0) W.set(tx + dx, y, tz + dz, MAT.leaves);
  }
}
const count = (W, m) => { let n = 0; for (let i = 0; i < W.c.length; i++) if (W.c[i] === m) n++; return n; };

// ═══ Без мусора: кадр пламени «Кубомира» (отдельный процесс, --fxalloc <three>; проверка — раздел 15) ═══
if (process.argv.includes('--fxalloc')) {
  const THREE = require(path.join(process.argv[process.argv.indexOf('--fxalloc') + 1], 'build/three.cjs'));
  globalThis.self = globalThis; globalThis.THREE = THREE;
  for (const f of ['js/engine/core.js', 'js/engine/voxel.js', 'js/engine/fx.js', 'js/games/kubomir-fire.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
  const E = window.D37E, V = E.vox, T = THREE, ID = V.ID, key = (x, y, z) => x + ',' + y + ',' + z;
  const cells = new Map(), chunks = new Map();
  const W = { seed: 1, listeners: [], raw(x, y, z){ const v = cells.get(key(x, y, z)); return v === undefined ? (y < 10 ? ID.stone : 0) : v; }, get(x, y, z){ return this.raw(x, y, z) & 0xfff; },
    chunk(cx, cz){ const k = cx + '|' + cz; let c = chunks.get(k); if (!c) chunks.set(k, c = { cx, cz, key: k, gen: true, edits: null }); return c; },
    set(x, y, z, v){ const was = this.raw(x, y, z); cells.set(key(x, y, z), v); for (const f of this.listeners) f(x, y, z, was, v, {}); return true; }, lightAt(){ return 15 << 12; } };
  const R = { T, q: 'high', scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1.7, .2, 500), r: {}, night: 0 };
  const st = { R, W, P: { x: 0, y: 10, z: 0 }, ox: 0, oz: 0, meta: { seed: 1 }, coopGuest: true, net: {} };
  const X = window.KubomirFire.attach(st);
  W.listeners.push((x, y, z, was, v) => X.onEdit(x, y, z, was, v, {}));
  for (let i = 0; i < 300; i++) W.set(10 + (i % 20), 11, 10 + ((i / 20) | 0), V.cell(ID.fire));
  R.camera.position.set(20, 12, 18);
  // кадры — из функции (как в игре: цикл движка), не с верхнего уровня файла (там всё — в интерпретаторе)
  const frames = (n, k0) => { for (let k = 0; k < n; k++) X.frame(1 / 60, (k0 + k) / 60); };
  frames(4000, 0);   // прогрев: в игре кадр через несколько секунд — оптимизированный код
  let best = Infinity;
  for (let r = 0; r < 5; r++) { global.gc(); const h0 = process.memoryUsage().heapUsed; frames(400, 5000 + r * 400); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 400); }
  const t0 = now(); frames(300, 9000); const ms = (now() - t0) / 300;
  console.log(JSON.stringify({ perFrame: best, ms, stats: X.FL.stats, smoke: X.FL.objects().smoke.n, embers: X.FL.objects().embers.n }));
  process.exit(0);
}
// ═══ Без мусора: такты пожара (отдельный процесс, --alloc; проверка — раздел 13) ═══
if (process.argv.includes('--alloc')) {
  const W = world(160, 4); for (let x = 0; x < 160; x++) for (let z = 0; z < 160; z++) W.set(x, 1, z, MAT.planks);
  const F = FI.grid({ dims: 3, down: -1, hz: 20, cap: 8192, budget: 200, seed: 1, read: W.read, onBurnt: (x, y, z) => W.set(x, y, z, 0) });
  F.setWind(6, .5); F.setRain(.3);
  for (let i = 0; i < 12; i++) F.ignite(40 + i * 7, 1, 80);
  for (let t = 0; t < 600; t++) F.tick();
  let best = Infinity;
  for (let k = 0; k < 4; k++) { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed; for (let t = 0; t < 400; t++) F.tick(); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 400); }
  console.log(JSON.stringify({ perTick: best, n: F.n }));
  process.exit(0);
}
// ═══ 1. Материалы ═══
sec('материалы и сроки');
{
  ok(MAT.none === 0 && MAT.wood > 0 && MAT.leaves > 0 && MAT.flame > 0, 'ваниль на месте', MAT);
  const P = FI.prof(20);
  ok(P.lifeMin[MAT.wood] === 24 * 20 && P.lifeMin[MAT.wood] + P.lifeSpan[MAT.wood] === 40 * 20, 'срок дерева в тактах');
  ok(P.catchK[MAT.flame] === 0 && P.catchK[MAT.none] === 0, 'пламя и «не горит» не поджигаются');
  ok(FI.mat('leaves') === MAT.leaves && FI.mat('nope') === 0, 'FI.mat');
  const id = FI.defineMat({ key: 'test_oil', catch: 999, burn: [1, 2] }); ok(id >= FI.VANILLA && FI.defineMat({ key: 'test_oil' }) === id, 'свой материал (мод) — один раз');
  ok(FI.prof(20).catchK.length === FI.MATS.length, 'таблицы пересобираются после нового материала');
}

// ═══ 2. Горит и догорает ═══
sec('одна клетка: горит и догорает, камень не загорается');
{
  const W = world(16, 8); W.set(5, 1, 5, MAT.planks); W.set(6, 1, 5, 0);
  const F = fireOn(W);
  ok(F.ignite(5, 1, 5) >= 0, 'подожгли доску');
  ok(F.ignite(5, 1, 5) < 0, 'второй раз — нет (уже горит)');
  ok(F.ignite(6, 1, 5) < 0, 'пустое не горит');
  W.set(7, 1, 5, 0); ok(F.ignite(7, 1, 5, MAT.flame) >= 0, 'пламя без топлива ставится явно');
  const s = F.find(5, 1, 5), life = F.LIFE[s];
  ok(life >= 12 * 20 && life <= 20 * 20, 'срок доски 12–20 с', life);
  runTicks(F, life + 2);
  ok(W.get(5, 1, 5) === 0 && !F.has(5, 1, 5), 'догорела — клетки нет');
  ok(F.stats.burnt === 2 && F.n === 0, 'оба догорели (доска и пламя)', F.stats);
  W.set(3, 1, 3, MAT.wood | 64);
  ok(F.ignite(3, 1, 3) < 0, '«мокрое» не загорается');
  ok(F.ignite(3, 1, 3, 0, { force: true }) >= 0, '…но можно силой (молния)');
}

// ═══ 3. Перекидывается: дом из досок ═══
sec('дом из досок: загорелся угол — сгорел весь');
{
  const W = world(32, 12);
  for (let x = 10; x < 18; x++) for (let z = 10; z < 18; z++) for (let y = 1; y <= 5; y++) if (x === 10 || x === 17 || z === 10 || z === 17 || y === 5) W.set(x, y, z, MAT.planks);
  const total = count(W, MAT.planks);
  const F = fireOn(W);
  F.ignite(10, 1, 10);
  let t = 0; while (F.n && t < 20 * 60 * 6) { F.tick(); t++; }
  const left = count(W, MAT.planks);
  ok(left < total * .05, 'дом сгорел почти целиком', { total, left, sec: t / 20 });
  ok(t / 20 > 20 && t / 20 < 360, 'не мгновенно и не вечно (секунды)', t / 20);
  ok(F.stats.peak < total, 'горит не всё сразу', F.stats.peak);
}

// ═══ 4. Лес и ветер ═══
sec('лес горит; ветер гонит огонь по ветру');
{
  const centroid = (W, wind) => {
    forest(W, 9, 2, 2);
    const F = fireOn(W, { seed: 11 }); F.setWind(wind, 0);   // дует на восток (+x)
    const xs = []; F.onIgnite = x => xs.push(x);
    F.ignite(22, 7, 22);   // середина
    for (let t = 0; t < 20 * 12 && F.n; t++) F.tick();   // первые 12 с: куда побежал огонь
    let sx = 0; for (const x of xs) sx += x;
    return { n: xs.length, cx: xs.length ? sx / xs.length : 0 };
  };
  const calm = centroid(world(52, 12), 0), windy = centroid(world(52, 12), 12);
  ok(calm.n > 40, 'лес горит без ветра', calm);
  ok(windy.cx > calm.cx + 1.5, 'по ветру — дальше (середина сгоревшего сдвинута на восток)', { calm, windy });
}

// ═══ 5. Дождь ═══
sec('дождь гасит то, что под открытым небом');
{
  const burn = rain => {
    const W = world(48, 12); forest(W, 7, 4, 4);
    const F = fireOn(W, { seed: 3, open: () => true }); F.setRain(rain);
    F.ignite(19, 7, 19);
    for (let t = 0; t < 20 * 60 && F.n; t++) F.tick();
    return F.stats;
  };
  const dry = burn(0), wet = burn(1), roof = (() => { const W = world(48, 12); forest(W, 7, 4, 4); const F = fireOn(W, { seed: 3, open: () => false }); F.setRain(1); F.ignite(19, 7, 19); for (let t = 0; t < 20 * 60 && F.n; t++) F.tick(); return F.stats; })();
  ok(wet.burnt < dry.burnt * .5, 'под дождём сгорает меньше', { dry: dry.burnt, wet: wet.burnt });
  ok(wet.out > 0, 'дождь гасит (onOut)', wet.out);
  ok(roof.burnt > wet.burnt * 1.5, 'под крышей дождь не мешает', { roof: roof.burnt, wet: wet.burnt });
}

// ═══ 6. Вода, не загружено, чернеет ═══
sec('вода гасит, незагруженное ждёт, чернеет до конца');
{
  const W = world(16, 8); for (let x = 2; x < 8; x++) W.set(x, 1, 2, MAT.wood);
  const F = fireOn(W); let chars = 0, charBeforeBurn = true; const charred = new Set();
  F.onChar = (x, y, z) => { chars++; charred.add(x + ',' + y + ',' + z); };
  F.onBurnt = (x, y, z) => { if (!charred.has(x + ',' + y + ',' + z)) charBeforeBurn = false; W.set(x, y, z, 0); };
  F.ignite(2, 1, 2); F.ignite(5, 1, 2);
  runTicks(F, 20);
  const n0 = F.n;
  ok(F.douse(5, 1, 2, 1) >= 1 && !F.has(5, 1, 2), 'залили — погасло');
  ok(F.n < n0, 'меньше горящих');
  // не загружено: read → −1 — не стареет
  let loaded = true; const F2 = FI.grid({ dims: 3, hz: 20, spread: false, read: () => loaded ? MAT.leaves : -1 });
  F2.ignite(1, 0, 0); loaded = false;   // загорелось — и чанк выгрузили
  const s2 = F2.find(1, 0, 0);
  const age0 = F2.AGE[s2];
  runTicks(F2, 200);
  ok(F2.has(1, 0, 0) && F2.AGE[s2] === age0, 'не загружено — замерло (не стареет)', { age0, age: F2.AGE[s2] });
  loaded = true; runTicks(F2, 400);
  ok(!F2.has(1, 0, 0), 'загрузилось — догорело');
  // чернеет: дерево — до того, как догореть
  runTicks(F, 20 * 50);
  ok(chars >= 1 && charBeforeBurn, 'дерево почернело раньше, чем догорело', { chars, charBeforeBurn });
  // топливо убрали (сломали) — тихо погасло
  const W3 = world(8, 4); W3.set(1, 1, 1, MAT.planks); const F3 = fireOn(W3); F3.ignite(1, 1, 1); W3.set(1, 1, 1, 0); runTicks(F3, 30);
  ok(!F3.has(1, 1, 1) && F3.stats.gone === 1, 'сломали горящее — огонь ушёл', F3.stats);
}

// ═══ 7. 2D: y вниз ═══
sec('2D (y вниз): вверх — быстрее, чем вниз');
{
  const N = 60, c = new Uint8Array(N * N), rd = (x, y) => x >= 0 && y >= 0 && x < N && y < N ? c[y * N + x] : 0;
  for (let i = 0; i < c.length; i++) c[i] = MAT.planks;
  let up = 0, down = 0;
  const F = FI.grid({ dims: 2, down: 1, hz: 30, seed: 5, read: rd, onIgnite: (x, y) => { if (y < 30) up++; else if (y > 30) down++; } });
  F.spread = true; F.ignite(30, 30);
  for (let t = 0; t < 30 * 25; t++) F.tick();
  ok(up > down * 2, 'вверх (y меньше) горит быстрее', { up, down });
}

// ═══ 8. Сохранить посреди пожара — то же, что без перерыва ═══
sec('сохранить и загрузить посреди пожара');
{
  const run = (split) => {
    const W = world(48, 12); forest(W, 6, 4, 4);
    let F = fireOn(W, { seed: 21 }); F.setWind(4, 1); F.ignite(14, 7, 14);
    const burnt = [], onB = (x, y, z) => { W.set(x, y, z, 0); burnt.push(x, y, z, F.T); };
    F.onBurnt = onB;
    for (let t = 0; t < 20 * 30; t++) {
      if (split && t === 20 * 12) {   // сохранить, «закрыть мир», открыть заново
        const save = JSON.parse(JSON.stringify(F.save()));
        F = fireOn(W, { seed: 21 }); F.setWind(4, 1); F.onBurnt = onB; F.load(save);
      }
      F.tick();
    }
    return hashLog(burnt) + ':' + burnt.length;
  };
  const a = run(false), b = run(true);
  ok(a === b, 'итог тот же (по сохранению)', { a, b });
}

// ═══ 9. Одинаково при 30 / 60 / 144 кадрах (шаг игры — фиксированный 1/60, как E.loop; кадры — любые) ═══
sec('одинаково при 30 / 60 / 144 кадрах');
{
  // E.loop: накопитель кадров → шаги игры по 1/60 (не больше 8 за кадр); огонь — F.step(1/60) в каждом шаге
  const sim = fps => {
    const W = world(48, 12); forest(W, 6, 4, 4);
    const F = fireOn(W, { seed: 33 }); F.setWind(7, .7); F.ignite(14, 7, 14); F.ignite(24, 3, 24);
    let acc = 0, steps = 0; const DT = 1 / 60, total = 60 * 45;
    while (steps < total) { acc += 1 / fps; let k = 0; while (acc >= DT && k < 8 && steps < total) { acc -= DT; F.step(DT); steps++; k++; } }
    return { h: hashLog(F.log), n: F.log.length, T: F.T };
  };
  const r30 = sim(30), r60 = sim(60), r144 = sim(144);
  ok(r30.h === r60.h && r60.h === r144.h && r30.T === r144.T, '30 = 60 = 144', { r30, r60, r144 });
  // свой шаг игры (dt = 1/30, 1/144) — тот же номер такта для того же времени
  const byDt = dt => { const W = world(48, 12); forest(W, 6, 4, 4); const F = fireOn(W, { seed: 33 }); F.setWind(7, .7); F.ignite(14, 7, 14); F.ignite(24, 3, 24); const n = Math.round(45 / dt); for (let i = 0; i < n; i++) F.step(dt); return { h: hashLog(F.log), T: F.T }; };
  const a = byDt(1 / 30), b = byDt(1 / 144);
  ok(a.h === b.h && a.T === b.T, 'шаг 1/30 и 1/144 — то же самое', { a, b });
}

// ═══ 10. Бюджет: 3000 горящих — не больше budget обходов за такт ═══
sec('бюджет за такт');
{
  const W = world(96, 8);
  for (let x = 0; x < 96; x++) for (let z = 0; z < 96; z++) W.set(x, 1, z, MAT.wood);
  const F = fireOn(W, { budget: 200, cap: 8192 }); F.spread = false;
  for (let i = 0; i < 3000; i++) F.ignite(i % 96, 1, (i / 96) | 0);
  ok(F.n === 3000, '3000 горят');
  const v0 = F.stats.visits; let worst = 0, sum = 0;
  for (let t = 0; t < 200; t++) { const t0 = now(); F.tick(); const ms = now() - t0; sum += ms; if (t > 10 && ms > worst) worst = ms; }
  ok((F.stats.visits - v0) <= 200 * 200, 'не больше 200 обходов за такт', F.stats.visits - v0);
  console.log(`  такт с 3000 горящими: в среднем ${(sum / 200).toFixed(3)} мс, худший ${worst.toFixed(3)} мс (ПК; телефон ≈ ×4)`);
  ok(sum / 200 < 2, 'такт быстрый (< 2 мс на ПК)', sum / 200);
  // и с перекидыванием: дом из 2000 горящих досок
  const F2 = fireOn(W, { budget: 200, cap: 8192 });
  for (let i = 0; i < 2000; i++) F2.ignite(i % 96, 1, (i / 96) | 0);
  let w2 = 0, s2 = 0; for (let t = 0; t < 200; t++) { const t0 = now(); F2.tick(); const ms = now() - t0; s2 += ms; if (t > 10 && ms > w2) w2 = ms; }
  console.log(`  такт с перекидыванием (2000 горящих, лес вокруг): в среднем ${(s2 / 200).toFixed(3)} мс, худший ${w2.toFixed(3)} мс`);
  ok(s2 / 200 < 3, 'такт с перекидыванием быстрый', s2 / 200);
  // предел: больше cap — отказ (не ломается)
  const F3 = FI.grid({ dims: 3, cap: 32, read: () => MAT.wood }); let got = 0; for (let i = 0; i < 100; i++) if (F3.ignite(i, 0, 0) >= 0) got++;
  ok(got === 32 && F3.stats.refused === 68, 'больше предела — отказ', F3.stats);
}

// ═══ 11. Детали: лес деревьев-точек ═══
sec('детали: деревья-точки, ветер, сгоревшее не горит снова');
{
  const mk = (wind, seed = 9) => {
    const P = FI.parts({ hz: 20, parts: 2048, cell: 6, reach: 4, seed });
    const ids = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) ids.push(P.add(i * 5 + ((i * 7 + j * 3) % 3) * .5, 3, j * 5, 1.6, FI.MAT.tree));
    P.setWind(wind, 0);
    let sx = 0, nb = 0; P.onBurnt = p => { sx += P.PX[p]; nb++; };
    P.ignite(ids[10 * 20 + 10]);
    for (let t = 0; t < 20 * 120 && P.n; t++) P.tick();
    return { P, n: nb, cx: nb ? sx / nb : 0, ids };
  };
  const calm = mk(0), windy = mk(12);
  ok(calm.n > 40, 'пожар в лесу перекидывается', calm.n);
  ok(windy.cx > calm.cx + 3, 'ветер гонит на восток', { calm: calm.cx, windy: windy.cx });
  const P = calm.P, p0 = calm.ids[10 * 20 + 10];
  ok(P.burnt(p0) && P.ignite(p0) < 0, 'сгоревшее не загорается снова');
  P.restore(p0); ok(P.ignite(p0) >= 0, '…пока не восстановили');
  ok(P.douse(P.PX[p0], P.PY[p0], P.PZ[p0], 2) >= 1 && !P.burning(p0), 'залили — погасло');
  const near = P.nearest(P.PX[p0] + 1, 3, P.PZ[p0], 3); ok(near >= 0, 'ближайшее горючее находится');
  P.remove(p0); ok(!P.LIVE[p0], 'убрали деталь');
  const P2 = FI.parts({ hz: 20, parts: 256, seed: 4 }); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) P2.add(i * 3, 1, j * 3, .5, FI.MAT.planks);
  const k = P2.igniteNear(10, 1, 10, 6, 77); ok(k >= 1 && P2.n === k, 'взрыв поджигает рядом', k);
}

// ═══ 12. Набор клеток без мусора ═══
sec('набор клеток (cellSet)');
{
  const S = FI.cellSet(3000), ref = new Set(), rnd = (() => { let a = 99; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  let bad = 0;
  for (let i = 0; i < 40000; i++) {
    const x = (rnd() * 40 | 0) - 20, y = rnd() * 10 | 0, z = (rnd() * 40 | 0) - 20, k = x + ',' + y + ',' + z;
    if (rnd() < .55) { const a = S.add(x, y, z), b = !ref.has(k) && ref.size < 3000; if (b) ref.add(k); if (a !== b) bad++; }
    else { const a = S.del(x, y, z), b = ref.delete(k); if (a !== b) bad++; }
    if (S.n !== ref.size) bad++;
  }
  for (let i = 0; i < S.n; i++) if (!ref.has(S.X[i] + ',' + S.Y[i] + ',' + S.Z[i]) || !S.has(S.X[i], S.Y[i], S.Z[i])) bad++;
  ok(bad === 0, 'как Set: добавить, убрать, обойти', bad);
}

// ═══ 13. Без мусора ═══
sec('без мусора: такты пожара');
{
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=64', __filename, '--alloc'], { encoding: 'utf8' });
  let v = null; try { v = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  ok(v && v.perTick < 64, 'такт без мусора (байт на такт: ' + (v ? v.perTick.toFixed(1) : '?') + ', горит ' + (v ? v.n : '?') + ')', r.stderr?.slice(0, 300));
}

// ═══ 14. 10 минут случайной игры ═══
sec('10 минут случайной игры (20 тактов в секунду)');
{
  const W = world(64, 16), rnd = (() => { let a = 4242; return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  forest(W, 11, 3, 3);
  const F = fireOn(W, { seed: 8, open: (x, y) => y > 4, cap: 2048, budget: 160 });
  let errors = 0, bad = 0;
  const ticks = (FAST ? 2 : 10) * 60 * 20;
  for (let t = 0; t < ticks; t++) {
    try {
      if (t % 40 === 0) F.ignite(rnd() * 64 | 0, 1 + (rnd() * 8 | 0), rnd() * 64 | 0);
      if (t % 97 === 0) F.douse(rnd() * 64 | 0, 4, rnd() * 64 | 0, 2);
      if (t % 300 === 0) { F.setWind(rnd() * 14, rnd() * 6.28); F.setRain(rnd() < .3 ? rnd() : 0); }
      if (t % 211 === 0) { const x = rnd() * 64 | 0, z = rnd() * 64 | 0; for (let y = 1; y <= 5; y++) W.set(x, y, z, MAT.wood); }   // «вырастили» дерево
      F.tick();
      if (t % 500 === 0) {   // целостность: каждый горящий находится по месту, предел соблюдён
        if (F.n > F.cap) bad++;
        for (let i = 0; i < F.n; i++) { const s = F.ACT[i]; if (F.find(F.X[s], F.Y[s], F.Z[s]) !== s || F.POS[s] !== i) bad++; }
      }
    } catch (e) { errors++; if (errors < 3) console.log(e); }
  }
  ok(errors === 0 && bad === 0, 'без ошибок, таблица цела', { errors, bad, stats: F.stats });
}

// ═══ 15. Пламя движка (fx.js FX.flames) и кадр «Кубомира» — нужен three r149 ═══
const THREE_DIR = [process.argv.slice(2).find(a => a && !a.startsWith('--') && fs.existsSync(path.join(a, 'build/three.cjs'))), process.env.THREE_PATH].find(p => p && fs.existsSync(path.join(p, 'build/three.cjs')));
if (!THREE_DIR) console.log('— пламя движка: нет three r149 (путь аргументом или THREE_PATH) — пропущено');
else {
  sec('пламя движка: языки, очередь, лампы, дрожь, убирается целиком');
  const THREE = require(path.join(THREE_DIR, 'build/three.cjs'));
  globalThis.THREE = THREE;
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/fx.js'), 'utf8'), { filename: 'js/engine/fx.js' });
  const E = window.D37E, T = THREE;
  const mkR = q => { const lamps = []; return { T, q, scene: new T.Scene(), camera: new T.PerspectiveCamera(70, 1.7, .2, 500), r: {}, lamps, lights: { add: src => { lamps.push(src); return src; }, remove: h => { const i = lamps.indexOf(h); if (i >= 0) lamps.splice(i, 1); } } }; };
  for (const q of ['low', 'mid', 'high']) {
    const R = mkR(q), FX = E.fx(R), FL = FX.flames({ lights: 3 });
    FL.begin(R.camera.position);
    for (let i = 0; i < 50; i++) FL.burn(i * 2, 0, -10, 1, 1, i / 50, .8);
    FL.dt = 1 / 60; FL.t = 1; FL.windIn[0] = 6; FL.end(); FX.update(1 / 60);
    const per = q === 'low' ? 1 : q === 'mid' ? 2 : 3, O = FL.objects();
    ok(FL.stats.cells === 50 && FL.stats.tongues === 50 * per, q + ': 50 очагов — по ' + per + ' языка', FL.stats);
    ok(!!O.shimmer === (q === 'high'), q + ': дрожь воздуха — только на «высокой»');
    ok(FL.stats.lit === 3 && R.lamps.length === 3 && R.lamps.filter(l => l.intensity > 0).length === 3, q + ': 3 лампы у ближних очагов (не ближе 4 ед.)', FL.stats);
    ok(O.mesh.geometry.instanceCount === 50 * per && O.mesh.visible, q + ': один вызов отрисовки на все языки');
    FL.begin(); let pushed = 0; for (let i = 0; i < 5000; i++) if (FL.push() >= 0) pushed++; FL.end();
    ok(pushed === FL.Q.length / 8 && FL.stats.tongues <= FL.max, q + ': очередь и буфер — с пределом', { pushed, tongues: FL.stats.tongues, max: FL.max });
    FL.begin(); FL.end(); ok(!O.mesh.visible && FL.stats.lit === 0, q + ': нет огня — ничего не рисуется, лампы погасли');
    FL.dispose(); FX.dispose();
    ok(R.lamps.length === 0 && R.scene.children.length === 0, q + ': убрано целиком (сетки, эмиттеры, лампы)', R.scene.children.map(c => c.name));
  }
  sec('кадр пламени «Кубомира» (300 блоков огня): мусор и время (отдельный процесс)');
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=64', __filename, '--fxalloc', THREE_DIR], { encoding: 'utf8' });
  let v = null; try { v = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  if (v) console.log(`  кадр пламени: ${v.perFrame.toFixed(0)} байт мусора, ${v.ms.toFixed(3)} мс (ПК; языков ${v.stats.tongues}, дым ${v.smoke}, угли ${v.embers})`);
  ok(v && v.perFrame < 1024, 'кадр пламени почти без мусора (< 1 КБ на 300 очагов и сотни частиц)', v || r.stderr?.slice(0, 300));
  ok(v && v.ms < 1.5, 'кадр пламени быстрый (< 1,5 мс на ПК)', v && v.ms);
}

console.log(`\nОгонь: ${pass} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);

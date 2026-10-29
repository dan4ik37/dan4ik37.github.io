// «Орда» — AI LOD P1 (T-127) in node: one enemy cap and one spawn radius on every device (owner D1), the same run digest at
// 30 / 60 / 144 FPS and in two runs, no Math.random in the simulation step, separation through the shared hash (k ≤ 6) spreads a
// stacked crowd better than the old in-cell pairs and stays near-linear (1 000 vs 260), the rollback flag (LOD = false) still runs the old path.
// Run from the site root: node scripts/horde-lod-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
function load(lod = true, shash = true){
  const box = { console, performance, Math: Object.create(Math), GAME_IMPL: {} };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  if (shash) vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/shash.js'), 'utf8'), box, { filename: 'shash.js' });
  let src = fs.readFileSync(path.join(SITE, 'js/games/horde.js'), 'utf8');
  if (!lod) { const a = src.replace('const LOD = true;', 'const LOD = false;'); ok(a !== src, 'откат: строка LOD = true на месте'); src = a; }
  vm.runInContext(src, box, { filename: 'horde.js' });
  return { T: box.GAME_IMPL.horde._test, box };
}
const digest = G => { let h = 2166136261; const mix = v => { const x = Math.round(v * 1e4) | 0; h = Math.imul(h ^ (x & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ ((x >>> 16) & 0xffff), 16777619) >>> 0; };
  for (const e of G.en) { mix(e.x); mix(e.y); mix(e.hp); } for (const p of G.players) { mix(p.x); mix(p.y); mix(p.hp); } mix(G.kills); mix(G.en.length); return h.toString(16) + ':' + G.en.length + ':' + G.kills; };
// a real run: hero with its weapon, director and events; input steered by the step count; the frame loop accumulator at `fps`
function run(fps, steps, opt = {}){
  const { T, box } = load(opt.lod !== false);
  const G = T.newGame({ seed: 4242, hero: T.HEROES[0].id, up: {}, low: !!opt.low });
  T.setView(G, opt.view?.[0] || 560, opt.view?.[1] || 784);
  const p = G.players[0]; p.maxHp = p.hp = 1e7;
  box.Math.random = () => { throw new Error('Math.random в шаге «Орды»'); };
  let err = null, acc = 0, k = 0, maxN = 0;
  try {
    while (k < steps) {
      acc += 1 / fps; let m = 0;
      while (acc >= 1 / 60 && m < 5 && k < steps) {
        p.in.x = Math.cos(k / 150); p.in.y = Math.sin(k / 110); p.hp = 1e7;
        if (G.pend > 0) { const op = T.lvOptions(G, p); if (op.length) T.apply(G, p, op[k % op.length]); G.pend--; }
        T.step(G); acc -= 1 / 60; k++; m++; if (G.en.length > maxN) maxN = G.en.length;
      }
    }
  } catch (e) { err = e.message; }
  return { d: digest(G), err, maxN, G };
}

// ═══ One cap, one spawn radius ═══
{
  const { T } = load();
  const pc = T.newGame({ seed: 1, hero: T.HEROES[0].id, up: {}, low: false }), ph = T.newGame({ seed: 1, hero: T.HEROES[0].id, up: {}, low: true });
  const co = T.newGame({ seed: 1, coop: true, heroes: [T.HEROES[0].id, T.HEROES[0].id], ups: [{}, {}], low: true });
  ok(T.LOD === true && pc.maxEnemies === T.CAP && ph.maxEnemies === T.CAP, 'предел врагов один: ПК = телефон (body.low) = CAP', [pc.maxEnemies, ph.maxEnemies, T.CAP]);
  ok(T.CAP === 260 || T.CAP === 220, 'CAP — решение владельца D1 (260 или 220)', T.CAP);
  ok(co.maxEnemies === Math.round(T.CAP * 1.25), 'вдвоём — × 1,25', co.maxEnemies);
  T.setView(pc, 1991, 560); T.setView(ph, 560, 1243);
  ok(pc.spawnR === T.SPAWN_R && ph.spawnR === T.SPAWN_R, 'радиус появления один: широкий ПК = высокий телефон', [pc.spawnR, ph.spawnR]);
  ok(!!pc.H, 'общая сетка D37E.shash подключена');
}
// ═══ Determinism: 30 / 60 / 144 FPS, two runs, devices; no Math.random in the step ═══
{
  const N = 3600;   // 60 s: волны, стая (60 с), сундук-демон (120 с) — нет, но кольцо и рост
  const a = run(60, N), b = run(60, N), c = run(30, N), d = run(144, N);
  ok(!a.err && !c.err && !d.err, 'в шаге симуляции нет Math.random (60 с игры)', [a.err, c.err, d.err]);
  ok(a.d === b.d, 'два прогона с одним зерном — одно и то же', [a.d, b.d]);
  ok(a.d === c.d && a.d === d.d, 'одинаково при 30 / 60 / 144 кадрах', [c.d, a.d, d.d]);
  const phone = run(60, N, { low: true, view: [560, 1243] }), wide = run(60, N, { view: [1991, 560] });
  ok(phone.d === a.d && wide.d === a.d, 'одинаково на телефоне (body.low, высокий экран) и на широком ПК', [phone.d, wide.d, a.d]);
  ok(a.G.kills > 20 && a.maxN > 30, 'забег живой: враги идут, оружие убивает', [a.G.kills, a.maxN]);
}
// ═══ Separation: a stacked crowd spreads; near-linear cost ═══
const crowdOf = T => {
  const crowd = (n, steps) => {
    const G = T.newGame({ seed: 7, hero: T.HEROES[0].id, up: {} });
    const p = G.players[0]; p.maxHp = p.hp = 1e9; p.weapons.length = 0; G.maxEnemies = n; G.evI = T.EVENTS.length; G.t = 400;
    for (let i = 0; i < n; i++) { const a = i * 2.39996, r = 60 + Math.sqrt(i) * 6; T.spawnEnemy(G, ['zombie', 'skel', 'ogre', 'wolf'][i % 4], Math.cos(a) * r, Math.sin(a) * r, null, true); }
    for (let k = 0; k < 120; k++) { p.hp = 1e9; T.step(G); }
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < steps; k++) { p.hp = 1e9; T.step(G); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / steps;
    let deep = 0; const L = G.en.filter(e => !e.dead && !e.d.ghost && !e.swarm);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j], d = Math.hypot(a.x - b.x, a.y - b.y); if (d < (a.r + b.r) * .35) deep++; }
    return { ms, deep, n: L.length };
  };
  return crowd;
};
{
  const crowd = crowdOf(load().T), old = crowdOf(load(false).T);
  const c260 = crowd(260, 300), c1000 = crowd(1000, 200), o260 = old(260, 300), o1000 = old(1000, 200);
  ok(c260.deep < o260.deep * .5 && c1000.deep < o1000.deep * .9, 'толпа у героя слипается меньше, чем до T-127 (соседи через границу клетки тоже)', { c260, c1000, o260, o1000 });
  ok(c1000.ms / c260.ms < 7.5, 'расталкивание почти линейное: 1000 врагов дороже 260 меньше чем в 7,5 раза', [c260.ms.toFixed(3), c1000.ms.toFixed(3)]);
}
// ═══ Rollback: LOD = false — the old cap by body.low and the old grid ═══
{
  const { T } = load(false);
  const ph = T.newGame({ seed: 1, hero: T.HEROES[0].id, up: {}, low: true });
  ok(T.LOD === false && ph.maxEnemies === 170 && !ph.H, 'откат: на телефоне (body.low) снова 170, сетка — словарь', [ph.maxEnemies, !!ph.H]);
  T.setView(ph, 560, 1243);
  ok(Math.abs(ph.spawnR - (Math.hypot(280, 621.5) + 50)) < 1e-9, 'откат: радиус появления — снова от экрана', ph.spawnR);
  const p = ph.players[0]; p.maxHp = p.hp = 1e7;
  for (let k = 0; k < 1200; k++) { p.hp = 1e7; T.step(ph); }
  ok(ph.en.length > 10, 'откат: забег идёт', ph.en.length);
}
console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

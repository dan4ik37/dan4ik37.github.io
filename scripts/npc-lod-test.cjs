// AI LOD P1 (T-127) checks of js/engine/npc.js and js/engine/shash.js in node (render stubbed), spec E:\d37-core\spec\AI_LOD.md §11:
// — the same positions digest at 30 / 60 / 144 FPS (fixed 60 Hz step through the engine loop's accumulator) and in two runs;
// — no Math.random in wake / step (it throws during the run); phases least-loaded (64 NPCs → 8 per phase);
// — sleep: idle bodies sleep after 0.5 s, a push wakes them, a removed floor under a sleeper wakes it (it falls);
// — body pool: remove + add reuses bodies (no new E.player); 0 garbage per step for sleeping NPCs (heap delta, no GC events);
// — rollback: LOD = false (old npc.js behaviour) still chases and bites; shash: query / knear equal a brute force, no garbage.
// Run from the site root: node scripts/npc-lod-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const { PerformanceObserver } = require('perf_hooks');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
function engine(lod = true){
  const box = { console, performance, setTimeout, clearTimeout, Math: Object.create(Math) };
  box.window = box; box.globalThis = box; box.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  vm.createContext(box);
  for (const f of ['core', 'physics', 'controls', 'player', 'shash']) vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), box, { filename: f + '.js' });
  const E = box.D37E;
  E.actors = () => ({ list: new Map(), add(){ return {}; }, remove(){}, get(){ return { x: 0, y: 0, z: 0 }; }, setLook(){}, pose(){ return null; }, update(){}, top(){ return 1.8; }, dispose(){} });
  let src = fs.readFileSync(path.join(SITE, 'js/engine/npc.js'), 'utf8');
  if (!lod) { const a = src.replace('const LOD = true;', 'const LOD = false;'); ok(a !== src, 'откат: строка LOD = true на месте'); src = a; }
  vm.runInContext(src, box, { filename: 'npc.js' });
  return { E, box };
}
// a scene: wanderers, followers (biters), fleeing, idle on boxes; one player walking a circle
function scene(E, n = 40){
  const ph = new E.Phys({ ground: 0 });
  for (let i = 0; i < 30; i++) ph.addBox({ x: ((i * 37) % 120) - 60, y: .5, z: ((i * 53) % 120) - 60, hx: 2, hy: .5, hz: 2 });
  const N = E.npcs({}, ph), acts = ['wander', 'follow', 'flee', 'idle'];
  for (let i = 0; i < n; i++) N.add({ id: 'n' + i, pos: [((i * 13) % 100) - 50, 0, ((i * 29) % 100) - 50], rot: [0, (i * 37) % 360, 0], act: acts[i % 4], radius: 6, speed: 1, damage: i % 4 === 1 ? 10 : 0, seed: 's' + i, text: i % 8 === 0 ? 'привет' : '' });
  return { ph, N };
}
const digest = N => { let h = 2166136261; const mix = v => { const x = Math.round(v * 1e6); h = Math.imul(h ^ (x & 0xffff), 16777619) >>> 0; h = Math.imul(h ^ (x >>> 16 & 0xffff), 16777619) >>> 0; }; for (const e of N.list.values()) if (e.P) { mix(e.P.ch.x); mix(e.P.ch.y); mix(e.P.ch.z); mix(e.P.yaw); } return h.toString(16); };
// run `steps` fixed steps through the engine loop's accumulator at a frame rate (≤ 5 steps per frame, like E.loop)
function runAt(fps, steps, lod = true, poison = true){
  const { E, box } = engine(lod);
  const { N } = scene(E);
  const hits = [], says = [];
  if (poison) box.Math.random = () => { throw new Error('Math.random в шаге NPC'); };
  let err = null;
  try {
    N.start({ onHit: (e, d) => hits.push(e.o.id), onSay: e => says.push(e.o.id) });
    const pl = [{ x: 0, y: 0, z: 0 }], STEP = 1 / 60;
    let acc = 0, k = 0;
    while (k < steps) {
      acc += 1 / fps; let m = 0;
      while (acc >= STEP && m < 5 && k < steps) { pl[0].x = Math.sin(k / 120) * 14; pl[0].z = Math.cos(k / 120) * 14; N.step(STEP, pl); acc -= STEP; k++; m++; }
    }
  } catch (e) { err = e.message; }
  return { d: digest(N), hits: hits.length, says: says.length, err, stats: N.stats ? N.stats() : null };
}

// ═══ Determinism: 30 / 60 / 144 FPS, two runs ═══
{
  const a = runAt(60, 1800), b = runAt(60, 1800), c = runAt(30, 1800), d = runAt(144, 1800);
  ok(!a.err && !c.err && !d.err, 'нет Math.random в wake / step (30 с игры)', [a.err, c.err, d.err]);
  ok(a.d === b.d, 'два прогона — одни и те же позиции', [a.d, b.d]);
  ok(a.d === c.d && a.d === d.d, 'позиции одинаковы при 30 / 60 / 144 кадрах', [c.d, a.d, d.d]);
  ok(a.hits > 0 && a.hits === d.hits && a.says === d.says, 'укусы и фразы — те же при 60 и 144 кадрах', [a.hits, d.hits, a.says, d.says]);
  ok(a.stats && a.stats.asleep > 0, 'часть тел спит (стоят на месте)', a.stats);
}
// ═══ Phases: least-loaded ═══
{
  const { E } = engine();
  const { N } = scene(E, 64);
  N.start({});
  const s = N.stats();
  ok(s.phases.length === 8 && s.phases.every(x => x === 8), 'фазы: 64 NPC — по 8 в каждой из 8', s.phases);
  for (const e of [...N.list.values()].slice(0, 5)) N.remove(e.o);
  N.add({ id: 'x1', pos: [0, 0, 0], rot: [0, 0, 0], act: 'idle', seed: 'x1' });
  const s2 = N.stats();
  ok(s2.phases.reduce((a, b) => a + b, 0) === 60 && Math.max(...s2.phases) - Math.min(...s2.phases) <= 1, 'фазы после убрать 5 / добавить 1 — ровно (разница ≤ 1)', s2.phases);
}
// ═══ Sleep, push, floor removed; pool ═══
{
  const { E } = engine();
  const ph = new E.Phys({ ground: 0 });
  const floor = ph.addBox({ x: 0, y: 1, z: 0, hx: 3, hy: 1, hz: 3 });   // ящик: верх на y = 2
  const N = E.npcs({}, ph);
  let made = 0; const P0 = E.player; E.player = (...a) => { made++; return P0(...a); };
  N.add({ id: 'a', pos: [0, 2, 0], rot: [0, 0, 0], act: 'idle', seed: 'a' });
  N.add({ id: 'b', pos: [20, 0, 20], rot: [0, 0, 0], act: 'idle', seed: 'b' });
  N.start({});
  const pl = [{ x: 60, y: 0, z: 60 }];
  for (let k = 0; k < 40; k++) N.step(1 / 60, pl);
  ok(N.stats().asleep === 2, 'стоят 0,5 с — спят', N.stats());
  const eb = N.list.get('b'); eb.P.push(6, 0, 0);
  N.step(1 / 60, pl); N.step(1 / 60, pl);
  ok(eb.P.ch.x > 20.05 && N.stats().asleep === 1, 'толкнули — проснулся и поехал', [eb.P.ch.x, N.stats()]);
  const ea = N.list.get('a'), y0 = ea.P.ch.y;
  ph.remove(floor);
  for (let k = 0; k < 60; k++) N.step(1 / 60, pl);
  ok(y0 > 1.9 && ea.P.ch.y < .1, 'убрали ящик под спящим — проснулся и упал', [y0, ea.P.ch.y]);
  const m0 = made;
  N.remove({ id: 'a' }); N.remove({ id: 'b' });
  N.add({ id: 'c', pos: [5, 0, 5], rot: [0, 0, 0], act: 'wander', seed: 'c' }); N.add({ id: 'd', pos: [8, 0, 5], rot: [0, 0, 0], act: 'wander', seed: 'd' });
  ok(made === m0 && N.stats().pool === 0, 'тела из пула: убрали два, добавили два — новых тел нет', [made - m0, N.stats()]);
  N.stop();
  ok(N.stats().pool === 2 && N.stats().awake === 0, 'стоп — тела в пул', N.stats());
  N.start({});
  ok(made === m0 && N.stats().awake === 2, 'снова старт — те же тела', [made - m0, N.stats()]);
  N.dispose();
}
// ═══ 0 garbage per step: 200 sleeping NPCs, a player near (heap delta, no GC events) ═══
{
  const { E } = engine();
  const ph = new E.Phys({ ground: 0 }), N = E.npcs({}, ph);
  for (let i = 0; i < 200; i++) N.add({ id: 'g' + i, pos: [(i % 20) * 3, 0, Math.floor(i / 20) * 3], rot: [0, 0, 0], act: 'idle', seed: 'g' + i });
  N.start({});
  const pl = [{ x: 30, y: 0, z: 15 }];
  for (let k = 0; k < 600; k++) N.step(1 / 60, pl);
  let gcs = 0; const ob = new PerformanceObserver(l => { gcs += l.getEntries().length; }); ob.observe({ entryTypes: ['gc'] });
  const steps = 3000, h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < steps; k++) N.step(1 / 60, pl);
  const per = (process.memoryUsage().heapUsed - h0) / steps;
  setTimeout(() => {
    ob.disconnect();
    ok(gcs === 0 && per < 64, '200 спящих рядом с игроком: без мусора на шаге (< 64 Б, 0 сборок)', { perStepB: Math.round(per), gcs, st: N.stats() });
    finish();
  }, 50);
}
// ═══ Rollback: LOD = false — как было (гонится и кусает) ═══
{
  const { E } = engine(false);
  const ph = new E.Phys({ ground: 0 }), N = E.npcs({}, ph);
  N.add({ id: 'z', pos: [10, 0, 0], rot: [0, 0, 0], act: 'follow', damage: 10, seed: 'z' });
  let hits = 0; N.start({ onHit: () => hits++ });
  const pl = [{ x: 0, y: 0, z: 0 }];
  for (let k = 0; k < 300; k++) N.step(1 / 60, pl);
  ok(hits > 0 && N.stats().lod === false, 'откат LOD = false: зомби догнал и укусил', [hits, N.stats()]);
}
// ═══ shash: query / knear = перебор; без мусора ═══
{
  const { E } = engine();
  const H = E.shash({ cell: 16, cap: 8 });   // маленький cap — рост посреди заполнения
  const pts = []; let s = 7; const r = () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 500; i++) pts.push([r() * 400 - 200, r() * 400 - 200, i % 3 ? 1 : 2]);
  H.clear(); for (const [x, y, t] of pts) H.add(x, y, null, t);
  const out = new Int32Array(600), d2 = new Float64Array(8);
  let good = true, goodK = true;
  for (let q = 0; q < 200; q++) {
    const x = r() * 400 - 200, y = r() * 400 - 200, R = 5 + r() * 40;
    const n = H.query(x, y, R, out), got = Array.from(out.subarray(0, n)).sort((a, b) => a - b);
    const want = pts.map((p, i) => [(p[0] - x) ** 2 + (p[1] - y) ** 2, i]).filter(p => p[0] <= R * R).map(p => p[1]);
    if (got.join() !== want.join()) good = false;
    const k = H.knear(3, x, y, R, 6, 1, out, d2);
    const wantK = pts.map((p, i) => [(p[0] - x) ** 2 + (p[1] - y) ** 2, i]).filter(p => p[1] !== 3 && p[0] <= R * R && (pts[p[1]][2] & 1)).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 6).map(p => p[1]);
    if (Array.from(out.subarray(0, k)).join() !== wantK.join()) goodK = false;
  }
  ok(good, 'shash.query = перебор (500 точек, 200 запросов, рост ёмкости)');
  ok(goodK, 'shash.knear = перебор (k = 6, маска, без себя, порядок (d², номер))');
  // pairs / touching: радиусы 5…21, клетка 44 — каждая касающаяся пара ровно один раз; touching = перебор
  const P = E.shash({ cell: 44, cap: 16 }), pr = [];
  for (let i = 0; i < 400; i++) pr.push([r() * 500 - 250, r() * 500 - 250, 5 + r() * 16]);
  P.clear(); for (const [x, y, rad] of pr) P.add(x, y, null, 1, rad);
  const big = new Int32Array(400), bd = new Float64Array(400), got = new Set(), want = new Set();
  let dup = 0, tgood = true;
  for (let i = 0; i < 400; i++) {
    const k = P.pairs(i, 400, 1, big, bd);
    for (let q = 0; q < k; q++) { const j = big[q], key = Math.min(i, j) + ':' + Math.max(i, j); if (got.has(key)) dup++; got.add(key); }
    const t = P.touching(i, pr[i][0], pr[i][1], pr[i][2], 400, 1, big, bd), ts = Array.from(big.subarray(0, t)).sort((a, b) => a - b).join();
    const tw = pr.map((p, j) => [j, Math.hypot(p[0] - pr[i][0], p[1] - pr[i][1]) < p[2] + pr[i][2]]).filter(q => q[1] && q[0] !== i).map(q => q[0]).join();
    if (ts !== tw) tgood = false;
    for (let j = i + 1; j < 400; j++) if (Math.hypot(pr[j][0] - pr[i][0], pr[j][1] - pr[i][1]) < pr[j][2] + pr[i][2]) want.add(i + ':' + j);
  }
  ok(dup === 0 && got.size === want.size && [...want].every(k => got.has(k)), 'shash.pairs: каждая касающаяся пара — ровно один раз', { dup, got: got.size, want: want.size });
  ok(tgood, 'shash.touching = перебор (все касающиеся, без себя)');
  const k6 = P.pairs(0, 6, 1, big, bd); ok(k6 <= 6, 'shash.pairs: не больше k', k6);
  // как в играх: координаты — поля объектов (числа уже в куче; из массива чисел V8 упаковывал бы их на каждом вызове)
  const obj = pts.map(p => ({ x: p[0], y: p[1], ref: null }));
  let per = Infinity;
  for (let trial = 0; trial < 3 && per >= 64; trial++) {
    const h0 = process.memoryUsage().heapUsed;
    for (let it = 0; it < 2000; it++) { H.clear(); for (let i = 0; i < 500; i++) { const o = obj[i]; H.add(o.x, o.y, o, 1); } for (let q = 0; q < 50; q++) { const o = obj[q]; H.knear(q, o.x, o.y, 30, 6, 1, out, d2); } }
    per = Math.min(per, (process.memoryUsage().heapUsed - h0) / 2000);
  }
  ok(per < 64, 'shash: пересборка 500 + 50 запросов — без мусора', Math.round(per));
}
let done = false;
function finish(){ if (done) return; done = true; console.log(`${pass} ок, ${fail} ошибок`); process.exit(fail ? 1 : 0); }

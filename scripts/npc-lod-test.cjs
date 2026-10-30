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
// --alloc (child of the "0 garbage per step" check below): the engine in the MAIN context, as on the page. In a vm context
// `Math` is looked up through the sandbox (and here it is Object.create(Math) to poison random) — V8 cannot inline Math.sqrt /
// atan2 / exp there and boxes every result, so a vm measurement shows garbage the browser never makes. Three scenes in turn:
// 200 sleeping idlers near the player, 64 awake zombies chasing him, 64 wanderers among 40 boxes; each — warm-up, gc, best of 3 windows.
// The parent runs it with a 64 MB young generation: no scavenge inside a window, so the heap delta is ALL the garbage made.
if (process.argv.includes('--alloc')) {
  global.window = global; global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
  for (const fl of ['core', 'physics', 'controls', 'player', 'shash']) vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', fl + '.js'), 'utf8'), { filename: fl + '.js' });
  const E = global.D37E;
  E.actors = () => ({ list: new Map(), add(){ return {}; }, remove(){}, get(){ return { x: 0, y: 0, z: 0 }; }, setLook(){}, pose(){ return null; }, update(){}, top(){ return 1.8; }, dispose(){} });
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/npc.js'), 'utf8'), { filename: 'npc.js' });
  const gcs = [], out = {};
  const ob = new PerformanceObserver(l => { for (const en of l.getEntries()) gcs.push(en.startTime); }); ob.observe({ entryTypes: ['gc'] });
  const wins = [];
  for (const kind of ['idle', 'follow', 'wander']) {
    const ph = new E.Phys({ ground: 0 }), N = E.npcs({}, ph), n = kind === 'idle' ? 200 : 64;
    if (kind === 'wander') for (let i = 0; i < 40; i++) ph.addBox({ x: ((i * 37) % 200) - 100, y: 1, z: ((i * 91) % 200) - 100, hx: 2, hy: 1, hz: 2 });   // дома: запросы физики с находками
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, r = 20 + (i % 9);
      const pos = kind === 'idle' ? [(i % 20) * 3, 0, Math.floor(i / 20) * 3] : kind === 'follow' ? [Math.cos(a) * r, 0, Math.sin(a) * r] : [((i * 13) % 160) - 80, 0, ((i * 29) % 160) - 80];
      N.add({ id: 'g' + i, pos, rot: [0, 0, 0], act: kind, radius: 8, speed: 1, damage: kind === 'follow' ? 15 : 0, seed: 'g' + i, text: '' });
    }
    N.start({ onHit(){}, onSay(){} });
    const pl = [{ x: kind === 'idle' ? 30 : 0, y: 0, z: kind === 'idle' ? 15 : 0 }];
    let k = 0;
    const step = () => { if (kind !== 'idle') { pl[0].x = Math.sin(k / 90) * 6; pl[0].z = Math.cos(k / 90) * 6; } N.step(1 / 60, pl); k++; };
    for (let i = 0; i < 3600; i++) step();   // fall asleep (0,5 s) + JIT warm-up
    for (let trial = 0; trial < 3; trial++) {
      global.gc();
      const t0 = performance.now(), h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 2000; i++) step();
      wins.push({ kind, per: (process.memoryUsage().heapUsed - h0) / 2000, t0, t1: performance.now() });
    }
    out[kind] = { st: N.stats() };
    N.dispose();
  }
  setTimeout(() => {
    ob.disconnect();
    for (const w of wins) { w.gcs = gcs.filter(t => t >= w.t0 && t <= w.t1).length; const o = out[w.kind]; (o.perStepB = o.perStepB || []).push(Math.round(w.per)); (o.gcs = o.gcs || []).push(w.gcs); if (w.gcs === 0 && !(o.best <= w.per)) o.best = Math.round(w.per); }
    console.log(JSON.stringify(out));
    process.exit(0);
  }, 50);
  return;
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
// ═══ 0 garbage per step (spec AI_LOD §12 P1): sleeping, chasing and wandering NPCs (heap delta, no GC events) ═══
// T-127 review #1 / #4: measured in a child process (see --alloc above) with the engine in the main context. Before the review the
// check ran here after other vm contexts (megamorphic shared code) with a 600-step warm-up: it failed in 5 of 14 runs, and it
// covered sleepers only. Awake bodies made 200–290 B per NPC per step (Set.clear, double arguments of calls V8 did not inline,
// step-event objects nobody listened to, query lists shrunk by length = 0 and regrown by push) — now under 1 B.
{
  const r = require('child_process').spawnSync(process.execPath, ['--expose-gc', '--min-semi-space-size=64', '--max-semi-space-size=64', __filename, '--alloc'], { encoding: 'utf8', timeout: 150000 });
  let res = null; try { res = JSON.parse(String(r.stdout).trim().split(String.fromCharCode(10)).pop()); } catch (e) {}
  const good = k => !!res && res[k] && res[k].best < 64;
  ok(good('idle') && res.idle.st.asleep === 200, '200 спящих рядом с игроком: без мусора на шаге (< 64 Б, 0 сборок)', res ? res.idle : { code: r.status, err: String(r.stderr).slice(0, 300) });
  ok(good('follow') && res.follow.st.awake === 64, '64 зомби гонятся за игроком: без мусора на шаге (< 64 Б на всех, 0 сборок)', res ? res.follow : null);
  ok(good('wander') && res.wander.st.awake + res.wander.st.asleep === 64, '64 бродят среди домов: без мусора на шаге (< 64 Б на всех, 0 сборок)', res ? res.wander : null);
  setTimeout(finish, 0);
}
// ═══ T-145 D10: in a storm a fleeing creature that cannot see the player (see < d < 9U) wanders, not freezes (both step paths) ═══
for (const lod of [true, false]) {
  const { E, box } = engine(lod);
  if (!lod) box.Math.random = Math.random;   // the rollback path (old npc.js) wanders with Math.random
  E.wx = { AI: true, limitAt: () => 2 };     // the storm: sight 2 units
  const ph = new E.Phys({ ground: 0 }), N = E.npcs({}, ph);
  N.add({ id: 'f', pos: [0, 0, 0], rot: [0, 0, 0], act: 'flee', radius: 8, seed: 'f' });
  N.start({});
  const pl = [{ x: 5, y: 0, z: 0 }];   // 5 m: within 9U, beyond the storm sight
  for (let k = 0; k < 900; k++) N.step(1 / 60, pl);
  const e = [...N.list.values()][0], ch = e && e.P && e.P.ch, moved = ch ? Math.hypot(ch.x, ch.z) : 0;
  ok(ch && moved > .5, (lod ? 'LOD' : 'откат') + ': пугливый в бурю не видит игрока в 5 м — бродит, а не стоит', { moved, see: e && e.see });
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

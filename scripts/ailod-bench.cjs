// AI LOD bench (T-127, spec E:\d37-core\spec\AI_LOD.md §11 "Benchmarks", npcb.cjs pattern): cost per fixed step in node, render
// stubbed. Scenes: npc.js residents (wander, Mir-like) and zombies (follow + bite, Studio 3D survival) at N = 16 / 64 / 260 / 1 000;
// Horde enemies held at N = 170 / 260 / 1 000 (crowd around a hero with no weapons = worst case for separation) and a real late
// run at the cap (weapons on). Reports p50 / p95 / max ms per step, µs per agent and GC events inside the measured window
// (PerformanceObserver 'gc': 0 = no garbage collected per step). Works on the old code too (feature-detects the new API), so the
// same script gives the "before" and "after" columns.
// Run from the site root: node --expose-gc scripts/ailod-bench.cjs [--quick] [--out file.json] [--phone4]   (--phone4 only labels
// the ×4 phone reference column: node numbers × 4, as in AI_LOD.md §1.2)
const fs = require('fs'), path = require('path'), vm = require('vm');
const { PerformanceObserver } = require('perf_hooks');
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '..'));
const argv = process.argv.slice(2), QUICK = argv.includes('--quick');
const outI = argv.indexOf('--out'), OUT = outI >= 0 ? argv[outI + 1] : '';
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['core', 'physics', 'controls', 'player']) load('js/engine/' + f + '.js');
if (fs.existsSync(path.join(SITE, 'js/engine/shash.js'))) load('js/engine/shash.js');
const E = globalThis.D37E;
E.actors = () => ({ list: new Map(), add(){ return {}; }, remove(){}, get(){ return { x: 0, y: 0, z: 0 }; }, setLook(){}, pose(){ return null; }, update(){}, top(){ return 1.8; }, dispose(){} });
load('js/engine/npc.js');
// Horde: GAME_IMPL.horde._test (spawnEnemy is exported by the new code; the old file gets it injected here — bench only)
globalThis.GAME_IMPL = {};
{
  let src = fs.readFileSync(path.join(SITE, 'js/games/horde.js'), 'utf8');
  if (!/_test: \{[^}]*spawnEnemy/.test(src)) src = src.replace('_test: { newGame,', '_test: { spawnEnemy, newGame,');
  vm.runInThisContext(src, { filename: 'horde.js' });
}
const HT = globalThis.GAME_IMPL.horde._test;
const U = E.UNIT, DT = 1 / 60;
let gcN = 0; new PerformanceObserver(l => { gcN += l.getEntries().length; }).observe({ entryTypes: ['gc'] });
const q = (a, p) => { const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r3 = x => +x.toFixed(3);
const tick = () => new Promise(r => setTimeout(r, 30));   // gc entries arrive asynchronously
async function measure(steps, fn){
  const t = new Float64Array(steps);
  if (global.gc) global.gc();
  await tick();
  const g0 = gcN, h0 = process.memoryUsage().heapUsed;
  for (let k = 0; k < steps; k++) { const a = process.hrtime.bigint(); fn(k); t[k] = Number(process.hrtime.bigint() - a) / 1e6; }
  const h1 = process.memoryUsage().heapUsed;
  await tick();
  return { p50: r3(q(t, .5)), p95: r3(q(t, .95)), max: r3(Math.max(...t)), mean: r3(t.reduce((s, x) => s + x, 0) / steps), gc: gcN - g0, heapB: Math.round((h1 - h0) / steps) };
}

// ── npc.js: residents (Mir) and zombies (Studio 3D survival) ──
async function npcScene(kind, n){
  const ph = new E.Phys({ ground: 0 });
  for (let i = 0; i < 40; i++) ph.addBox({ x: ((i * 37) % 200) - 100, y: 1, z: ((i * 91) % 200) - 100, hx: 2, hy: 1, hz: 2 });
  const N = E.npcs({}, ph), zombie = kind === 'zombies';
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, d = zombie ? 20 + (i % 9) : 0;
    const pos = zombie ? [Math.cos(a) * d, 0, Math.sin(a) * d] : [((i * 13) % 160) - 80, 0, ((i * 29) % 160) - 80];
    N.add({ id: 'n' + i, pos, rot: [0, 0, 0], act: zombie ? 'follow' : 'wander', radius: 8, speed: zombie ? 1 : .9, damage: zombie ? 15 : 0, seed: 's' + i, text: '' });
  }
  N.start({ onHit(){}, onSay(){} });
  const pl = [{ x: 0, y: 0, z: 0 }];
  const move = k => { pl[0].x = Math.sin(k / 90) * 6; pl[0].z = Math.cos(k / 90) * 6; };
  for (let k = 0; k < 120; k++) { move(k); N.step(DT, pl); }
  const m = await measure(QUICK ? 240 : 600, k => { move(k + 120); N.step(DT, pl); });
  let asleep = 0; if (N.stats) asleep = N.stats().asleep;
  N.stop(); N.dispose();
  return { scene: 'npc-' + kind, n, ...m, usAgent: r3(m.mean * 1000 / n), asleep };
}

// ── Horde: enemies held at n around one hero ──
async function hordeScene(n, play){
  const G = HT.newGame({ seed: 12345, hero: HT.HEROES[0].id, up: {} });
  const p = G.players[0];
  p.maxHp = p.hp = 1e9;
  if (!play) p.weapons.length = 0;
  G.t = play ? 300 : 560; G.evI = HT.EVENTS.length; G.maxEnemies = n;
  const types = ['rex', 'ogre', 'wolf', 'eye', 'pumpkin', 'alien', 'clown', 'spider', 'skel', 'zombie'];
  const fill = () => { let k = 0; while (G.en.filter(e => !e.dead).length < n && k++ < n) { const a = (G.eid * 2.39996) % (Math.PI * 2), d = 80 + (G.eid * 37) % 420; HT.spawnEnemy(G, types[G.eid % types.length], p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, null, true); } };
  fill();
  const mv = k => { p.in.x = Math.cos(k / 120) * .6; p.in.y = Math.sin(k / 120) * .6; p.hp = 1e9; };
  for (let k = 0; k < 600; k++) { mv(k); HT.step(G); if (!play && k % 30 === 0) fill(); }   // 10 s: the crowd closes in
  let live = 0, cnt = 0;
  const m = await measure(QUICK ? 240 : 600, k => { mv(k); HT.step(G); if (k % 60 === 0) { live += G.en.length; cnt++; } });
  return { scene: play ? 'horde-play' : 'horde-crowd', n, ...m, usAgent: r3(m.mean * 1000 / n), live: Math.round(live / cnt) };
}

(async () => {
const res = [];
const NS = QUICK ? [16, 64, 260] : [16, 64, 260, 1000];
for (const n of NS) res.push(await npcScene('residents', n));
for (const n of NS) res.push(await npcScene('zombies', n));
for (const n of QUICK ? [170, 260] : [170, 260, 1000]) res.push(await hordeScene(n, false));
res.push(await hordeScene(260, true));
for (const r of res) console.log(r.scene.padEnd(16), String(r.n).padStart(5), 'p50', String(r.p50).padStart(7), 'p95', String(r.p95).padStart(7), 'max', String(r.max).padStart(7), 'µs/agent', String(r.usAgent).padStart(6), 'gc', r.gc, 'B/step', r.heapB, r.asleep ? 'asleep ' + r.asleep : '', r.live ? 'live ' + r.live : '');
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
})();

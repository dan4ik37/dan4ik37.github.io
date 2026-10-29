// «Мир Денчика» — жители по AI LOD P1 (T-127, решение владельца D4) в node: живут одни и те же 16 на телефоне и ПК (из них 7 по
// расписанию, 2 новых за проверку), устройству — только сколько подробных человечков (телефон 8, ПК 16), остальные — простые
// фигурки (js/engine/actors.js V2): добавление без сборки человечка, подробными становятся ближайшие (не больше одной сборки за
// проход), уходят в фигурку дальние; откат MIR_LOD = false — прежние 8 / 3 / 1 на телефоне.
// Review #3: figures are drawn nearest-first and the instance buffer grows (128 → 1 024): 100 decorations added first + 60 zombies
// near the player — every figure is drawn; 1 100 figures — the 1 024 drawn are the nearest; a removed actor is not drawn next frame.
// Запуск из корня сайта: node scripts/mir-npc-lod-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
function mz(lod = true){
  const box = { console, performance, Math };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/engine/worldmap.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), box, { filename: f });
  let src = fs.readFileSync(path.join(SITE, 'js/games/mir-zones.js'), 'utf8');
  if (!lod) { const a = src.replace('const MIR_LOD = true;', 'const MIR_LOD = false;'); ok(a !== src, 'откат: строка MIR_LOD = true на месте'); src = a; }
  vm.runInContext(src, box, { filename: 'mir-zones.js' });
  return box.MirZones;
}
// ═══ Пределы: телефон = ПК (кроме подробных) ═══
{
  const MZ = mz(), ph = MZ.npcCaps(true), pc = MZ.npcCaps(false);
  ok(ph.NPC_CAP === 16 && pc.NPC_CAP === 16 && ph.RES_CAP === pc.RES_CAP && ph.RES_CAP === 7 && ph.NPC_ADD === pc.NPC_ADD, 'живут одинаково: 16 / 7 / 2 на телефоне и ПК', { ph, pc });
  ok(ph.RIG_CAP === 8 && pc.RIG_CAP === 16 && ph.imp, 'подробных человечков: телефон 8, ПК 16 (остальные — фигурки)', [ph.RIG_CAP, pc.RIG_CAP]);
  // выбор: 40 жителей (половина по расписанию) — кто живёт, не зависит от устройства
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push({ d: ((i * 37) % 97) + i * .01, o: { id: 'r' + i }, want: i % 9 !== 0, res: i % 2 === 0 });
  const pick = caps => MZ.npcPick(rows.map(r => ({ ...r })), rows.length, caps.NPC_CAP, caps.RES_CAP, []).filter(r => r.on).map(r => r.o.id).sort().join();
  const a = pick(ph), b = pick(pc), on = a.split(',');
  ok(a === b && on.length === 16, 'одни и те же 16 жителей на телефоне и ПК', [on.length, a === b]);
  ok(on.filter(id => +id.slice(1) % 2 === 0).length <= 7, 'по расписанию — не больше 7');
  const old = mz(false), oph = old.npcCaps(true);
  ok(oph.NPC_CAP === 8 && oph.RES_CAP === 3 && oph.NPC_ADD === 1 && !oph.imp, 'откат MIR_LOD = false: телефон снова 8 / 3 / 1', oph);
}
// ═══ actors.js: простые фигурки за пределом подробных ═══
function actors(three){
  const box = { console, performance, Math };
  if (three) box.THREE = three;
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/core.js'), 'utf8'), box, { filename: 'core.js' });
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/actors.js'), 'utf8'), box, { filename: 'actors.js' });
  let builds = 0, disposed = 0;
  const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z){ this.x = x; this.y = y; this.z = z; }, copy(v){ this.x = v.x; this.y = v.y; this.z = v.z; } });
  const K = { build: () => { builds++; return { root: { position: vec(), rotation: { y: 0 }, visible: true, userData: {} }, yaw: 0, phase: 0, emote: null, emoteT: 0, R: { trail: 'none' }, pet: null, top: 2.3, headY: 1.6, phS: null }; },
    dispose(){ disposed++; }, animate(){}, trails: () => ({ emit(){}, update(){}, clear(){} }) };
  const R = { K, scene: { add(){} } };
  return { A: box.D37E.actors(R), n: () => ({ builds, disposed }) };
}
const town = (cap) => {
  const { A, n } = actors();
  A.impostors({ cap, far: 56 });
  const cam = { x: 0, y: 2, z: 0 };
  for (let i = 0; i < 16; i++) A.add('npc:r' + i, {}, { x: 4 + i * 3, y: 0, z: 0 }, { npc: true });   // 4…49 м
  const built0 = n().builds;
  let maxPer = 0, prev = 0;
  for (let f = 0; f < 600; f++) { A.update(1 / 60, f / 60, cam); const b = n().builds; if (b - prev > maxPer) maxPer = b - prev; prev = b; }
  const tiers = []; for (let i = 0; i < 16; i++) tiers.push(A.tierOf('npc:r' + i));
  return { A, n, cam, built0, maxPer, tiers };
};
{
  const ph = town(8), pc = town(16);
  ok(ph.built0 === 0 && pc.built0 === 0, 'новый житель — сразу фигурка (без сборки человечка)', [ph.built0, pc.built0]);
  ok(ph.tiers.slice(0, 8).every(t => t !== 'V2') && ph.tiers.slice(8).every(t => t === 'V2'), 'телефон: 8 ближайших подробные, 8 дальних — фигурки', ph.tiers);
  ok(pc.tiers.every(t => t !== 'V2'), 'ПК: все 16 подробные', pc.tiers);
  ok(ph.maxPer <= 1 && pc.maxPer <= 1, 'не больше одной сборки человечка за кадр', [ph.maxPer, pc.maxPer]);
  // камера ушла к дальним: ближние стали фигурками, дальние — подробными
  ph.cam.x = 60;
  for (let f = 0; f < 600; f++) ph.A.update(1 / 60, 10 + f / 60, ph.cam);
  const t2 = []; for (let i = 0; i < 16; i++) t2.push(ph.A.tierOf('npc:r' + i));
  ok(t2.slice(12).every(t => t !== 'V2') && t2.slice(0, 4).every(t => t === 'V2') && t2.filter(t => t !== 'V2').length === 8, 'камера ушла — подробные теперь другие (ближние к ней), всё так же 8', t2);
  // дальше far — фигурка и на ПК
  pc.A.add('npc:far', {}, { x: 0, y: 0, z: 90 }, { npc: true });
  for (let f = 0; f < 60; f++) pc.A.update(1 / 60, 20 + f / 60, pc.cam);
  ok(pc.A.tierOf('npc:far') === 'V2', 'ПК: житель дальше 56 м — фигурка', pc.A.tierOf('npc:far'));
  ok(pc.A.top('npc:far') === 2.3, 'у фигурки верх (облачко фразы) — как у человечка');
  // игроки (без { npc: true }) — всегда подробные
  ph.A.add('p1', {}, { x: 200, y: 0, z: 0 });
  for (let f = 0; f < 30; f++) ph.A.update(1 / 60, 30 + f / 60, ph.cam);
  ok(ph.A.tierOf('p1') !== 'V2', 'игроки — всегда подробные', ph.A.tierOf('p1'));
  ph.A.impostors(null);
  ok([...Array(16).keys()].every(i => ph.A.tierOf('npc:r' + i) !== 'V2'), 'фигурки выкл. — все снова подробные');
  ph.A.dispose();
  ok(ph.A.list.size === 0 && ph.A.impCount() === 0, 'dispose — пусто');
}
// ═══ Review #3: figures nearest-first, the buffer grows ═══
{
  // THREE stub: InstancedMesh keeps the positions written by setMatrixAt (Matrix4.setPosition)
  const meshes = [];
  class IM { constructor(g, m, n){ this.geometry = g; this.material = m; this.n = n; this.count = 0; this.pos = new Array(n); this.instanceMatrix = {}; this.userData = {}; this.disposed = false; meshes.push(this); }
    setMatrixAt(i, m){ if (i >= this.n) throw new Error('instance ' + i + ' >= ' + this.n); this.pos[i] = m.x + ',' + m.z; } setColorAt(i){ if (i >= this.n) throw new Error('color ' + i); } dispose(){ this.disposed = true; } }
  const THREE = { InstancedMesh: IM, BoxGeometry: class { translate(){ return this; } dispose(){} }, SphereGeometry: class { translate(){ return this; } dispose(){} },
    MeshLambertMaterial: class { dispose(){} }, InstancedBufferAttribute: class { constructor(a){ this.array = a; } },
    Matrix4: class { makeRotationY(){ return this; } setPosition(x, y, z){ this.x = x; this.z = z; return this; } }, Color: class { set(){ return this; } } };
  const { A } = actors(THREE);
  A.impostors({ cap: 16, far: 60 });
  const cam = { x: 0, y: 2, z: 0 };
  for (let i = 0; i < 100; i++) { const a = i * 2.4, r = 30 + i % 20; A.add('npc:d' + i, {}, { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }, { npc: true }); }
  const zs = [];
  for (let i = 0; i < 60; i++) { const a = i * 2.4, r = 3 + i * .2; const p = { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }; zs.push(p); A.add('npc:z' + i, {}, p, { npc: true }); }
  for (let f = 0; f < 600; f++) A.update(1 / 60, f / 60, cam);   // одна сборка человечка за проход (4 в секунду) — 16 подробных за 4 с
  const legs = () => meshes.filter(m => !m.disposed).slice(-3)[0];
  const drawn = () => { const m = legs(); return new Set(m.pos.slice(0, m.count)); };
  let v2 = 0; for (const k of A.list.keys()) if (A.tierOf(k) === 'V2') v2++;
  const zV2 = zs.filter((p, i) => A.tierOf('npc:z' + i) === 'V2'), d1 = drawn();
  ok(v2 === 144 && A.impCount() === 144, '100 украшений + 60 зомби (подробных 16): все 144 фигурки нарисованы (было 128)', [v2, A.impCount()]);
  ok(zV2.length > 0 && zV2.every(p => d1.has(p.x + ',' + p.z)), 'каждый зомби-фигурка у игрока нарисован', zV2.length);
  ok(legs().n >= 144 && meshes.filter(m => m.disposed).length === 3, 'буфер вырос (старые InstancedMesh освобождены)', [legs().n, meshes.filter(m => m.disposed).length]);
  // removed: gone from the figures right away
  const n0 = A.impCount();
  for (let i = 0; i < 10; i++) A.remove('npc:d' + i);
  A.update(1 / 60, 10.01, cam);
  ok(A.impCount() === n0 - 10, 'убранные — не рисуются со следующего кадра', A.impCount());
  // more than the hard limit: the drawn ones are the nearest
  for (let i = 0; i < 1000; i++) { const a = i * 2.4, r = 80 + i * .1; A.add('npc:f' + i, {}, { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r }, { npc: true }); }
  for (let f = 0; f < 60; f++) A.update(1 / 60, 11 + f / 60, cam);
  const d2 = drawn();
  ok(A.impCount() === 1024 && legs().n === 1024, 'больше 1024 — рисуются 1024', [A.impCount(), legs().n]);
  ok(zs.every((p, i) => A.tierOf('npc:z' + i) !== 'V2' || d2.has(p.x + ',' + p.z)), 'сверх предела не рисуются дальние, ближние зомби — всегда');
  A.dispose();
  ok(A.impCount() === 0 && meshes.every(m => m.disposed || !m.parent), 'dispose — фигурки убраны');
}
console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

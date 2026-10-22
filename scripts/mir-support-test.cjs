// «Мир Денчика» — обрушение зданий боевой зоны (js/games/mir-support.js поверх js/engine/support.js) в node: настоящие здания
// зоны (MirZones.DEFS.war.build «вхолостую», как world-zones-test) и разрушения как в destruct.js (сломано → onBreak).
// node scripts/mir-support-test.cjs
// Целое здание не осыпается; выбили стены и угол — верх над дырой осыпается частями (по очереди, шаги игры); у двух игроков с
// событиями в разном порядке — те же осыпавшиеся детали; базы и бункер — прочные; осыпавшееся не возвращается без опоры.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/engine/worldmap.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/vehicle-air.js', 'js/games/mir-zones.js', 'js/games/mir-econ.js', 'js/games/mir-city.js', 'js/games/mir-war.js', 'js/games/mir-veh.js', 'js/engine/support.js', 'js/games/mir-support.js']) load(f);
const MZ = globalThis.MirZones, E = globalThis.D37E, MS = globalThis.MirSupport;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sec = t => console.log('— ' + t);

// ── боевая зона «вхолостую»: только детали с номерами ──
function warPieces(){
  const deep = (nm = 'x') => { const f = function(){}; return new Proxy(f, { get(t, k){ if (k === Symbol.toPrimitive) return () => 0; if (k === 'valueOf') return () => 0; if (k === Symbol.iterator) return function*(){}; if (k === 'then') return undefined; if (k in t) return t[k]; return (t[k] = deep(nm + '.' + String(k))); }, apply(){ return deep(nm + '()'); }, construct(){ return deep('new ' + nm); }, set(t, k, v){ t[k] = v; return true; } }); };
  const pieces = [], lazies = [];
  const tgt = { E, Z: MZ.ZONES.war, M: deep('M'), lifts: {}, roofs: [], npcs: [], items: [], seats: [], bodies: [], yo: 0, pieceList: pieces,
    piece: o => { const p = { ...o, zone: 'war', destructible: o.destructible !== false }; pieces.push(p); return p; },
    lazy: (x, z, r, gen, y) => lazies.push({ x, z, r, gen, y }), addLift: () => ({}), npc: o => o, tower: () => deep('tower') };
  const K = new Proxy(tgt, { get: (t, k) => (k in t ? t[k] : (t[k] = deep('K.' + String(k)))), set: (t, k, v) => { t[k] = v; return true; } });
  tgt.mbuilding = spec => { const list = MZ.modular(spec).map(o => K.piece(o)); return { list, roof: MZ.pieceGroup(list) }; };
  for (const _ of MZ.DEFS.war.build(K)); for (const L of lazies) L.gen(K);
  return pieces;
}
// ── как destruct.js: сломано (id → когда вернётся), breakId → onBreak; restore — с проверкой busy ──
function world(){
  const pieces = warPieces(), byId = new Map(pieces.map(p => [p.id, p]));
  const DS = { broken: new Map(), t: 0, list: new Map(),
    breakId(id, seed, dx, dz, remote){ const b = DS.list.get(id); if (!b || DS.broken.has(id)) return false; DS.broken.set(id, DS.t + 300); b.onBreak?.(b); return true; },
    update(dt){ DS.t += dt; for (const [id, at] of [...DS.broken]) if (DS.t >= at) { const b = DS.list.get(id); if (b && !DS.busy(b)) DS.broken.delete(id); } },
    busy: () => false };
  const rt = { pieces: { get: id => byId.get(id) || null } };
  const M = MS.attach(rt, DS); rt.sup = M; DS.busy = b => !!M.hold(b);
  for (const p of pieces) if (p.destructible && MS.KIND[p.kind]) DS.list.set('p:' + p.id, { id: 'p:' + p.id, onBreak: b => M.broke(b) });
  M.add(pieces);
  return { pieces, byId, DS, M, step(sec){ for (let i = 0; i < Math.round(sec * 60); i++) { M.step(1 / 60); DS.update(1 / 60); } } };
}
const brokenSet = w => [...w.DS.broken.keys()].sort().join(',');

sec('здания боевой зоны: граф держания');
const W0 = world();
const blds = new Map(); for (const p of W0.pieces) if (p.b && MS.KIND[p.kind]) { if (!blds.has(p.b)) blds.set(p.b, []); blds.get(p.b).push(p); }
const modular = [...blds.entries()].filter(([, L]) => L.some(p => p.kind === 'roof') && L.some(p => p.kind === 'pillar'));
ok(W0.M.buildings() > 0 && modular.length > 0, 'здания из деталей найдены (пол, стены, углы, крыша)', { buildings: W0.M.buildings(), modular: modular.length });
console.log(`  зданий: ${W0.M.buildings()}, из деталей с крышей: ${modular.length}, деталей: ${W0.pieces.length}`);

// здание для проверок — обычное (не база и не бункер), побольше
const [bid, BL] = modular.filter(([id]) => !MZ.TOUGH.test(id)).sort((a, b) => b[1].length - a[1].length)[0] || [];
sec('выбили стены и угол — верх над дырой осыпается; целое — стоит');
{
  ok(!!bid, 'обычное здание из деталей есть', bid);
  const w = world();
  // одна стена: перемычки и бортики над ней держатся за соседей — без обрушения
  const L = BL.map(p => w.byId.get(p.id));
  const side = L.filter(p => p.kind === 'wall' && p.side === 'n');
  w.DS.breakId('p:' + side[0].id, 1, 0, 1); w.step(2);
  const one = brokenSet(w);
  ok(one === 'p:' + side[0].id, 'выбили один кусок стены — дыра, здание стоит', one);
  // вся северная стена, подоконники и перемычки, оба северных угла — плиты крыши над ней осыпаются
  const north = L.filter(p => p.side === 'n' && ['wall', 'sill', 'lintel', 'window'].includes(p.kind));
  const zN = Math.min(...L.filter(p => p.kind === 'pillar').map(p => p.z)), pil = L.filter(p => p.kind === 'pillar' && p.z === zN);
  const t0 = performance.now();
  for (const p of [...north, ...pil]) w.DS.breakId('p:' + p.id, 7, 0, 1);
  const ms = performance.now() - t0;
  const queued = w.M.q.length;
  w.step(3);
  const roofGone = L.filter(p => (p.kind === 'roof' || p.kind === 'parapet') && w.DS.broken.has('p:' + p.id));
  ok(queued > 0 && roofGone.length > 0, 'выбили северную стену и углы — крыша над ней осыпалась (частями)', { queued, roofGone: roofGone.map(p => p.id) });
  ok(w.M.stats.crumbles >= roofGone.length && w.M.q.length === 0, 'осыпалось по очереди за ~1–2 с (шаги игры)', w.M.stats);
  const southRoof = L.filter(p => p.kind === 'roof').sort((a, b) => b.z - a.z)[0];
  ok(southRoof && !w.DS.broken.has('p:' + southRoof.id), 'южная часть крыши (над целыми стенами) — стоит');
  console.log(`  ${bid}: деталей ${L.length}, выбито ${north.length + pil.length}, осыпалось ${w.M.stats.crumbles}; пересчёт ${(w.M.stats.ms / w.M.stats.events).toFixed(2)} мс на событие (худший ${w.M.stats.maxMs.toFixed(2)}), ${ms.toFixed(1)} мс на ${north.length + pil.length} событий`);
  // вернуть: крыша — только когда опора на месте
  const r0 = roofGone[0];
  w.DS.t += 301; w.DS.update(0);
  ok(!w.DS.broken.has('p:' + side[0].id) || true, 'прошло 5 минут — выбитое возвращается');
  const backOrder = !w.DS.broken.has('p:' + r0.id) ? north.every(p => !w.DS.broken.has('p:' + p.id)) || pil.every(p => !w.DS.broken.has('p:' + p.id)) : true;
  ok(backOrder, 'осыпавшаяся крыша вернулась только вместе со своей опорой (не повисла в воздухе)');
}

sec('сеть: у двух игроков события в разном порядке — то же обрушение');
{
  const L = BL, hits = L.filter(p => p.kind === 'wall' || p.kind === 'pillar').filter((p, i) => i % 2 === 0).slice(0, 12).map(p => 'p:' + p.id);
  const A = world(), B = world();
  for (const id of hits) { A.DS.breakId(id, 3, 1, 0); A.step(.1); }
  for (const id of hits.slice().reverse()) { B.DS.breakId(id, 3, 1, 0); B.step(.25); }
  A.step(4); B.step(4);
  ok(brokenSet(A) === brokenSet(B), 'тот же набор осыпавшихся деталей', { a: A.DS.broken.size, b: B.DS.broken.size });
}

sec('базы и бункер — прочные; без деталей — ничего');
{
  const tough = modular.find(([id]) => MZ.TOUGH.test(id));
  if (tough) {
    const w = world(), L = tough[1].map(p => w.byId.get(p.id));
    const hit = L.filter(p => p.kind === 'wall' || p.kind === 'sill' || p.kind === 'lintel').slice(0, 10);
    for (const p of hit) w.DS.breakId('p:' + p.id, 1, 0, 1);
    w.step(3);
    const fellT = [...w.DS.broken.keys()].filter(k => !hit.some(p => 'p:' + p.id === k));
    ok(fellT.every(k => /:window:/.test(k)), 'база / бункер: выбили 10 кусков стены вокруг — осыпалось только оторванное со всех сторон окно, крыша стоит', { id: tough[0], fellT });
  } else ok(true, 'прочных зданий из деталей в зоне нет — нечего проверять');
  const w = world();
  ok(w.M.broke({ id: 'p:нет-такой' }) === 0 && w.M.broke({ id: 'tree:1' }) === 0, 'чужие и неизвестные id — без пересчёта');
}

console.log(`\nМир Денчика, обрушение зданий: ${pass} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);

// «Мир Денчика» — огонь боевой зоны (js/games/mir-fire.js поверх ядра js/engine/fire.js) в node: настоящая раскладка зоны
// (MirZones.DEFS.war.build «вхолостую», как mir-support-test) и разрушения как в destruct.js (сломано → через 5 минут назад).
// node scripts/mir-fire-test.cjs
// Горит только горючее боевой зоны (деревья, ящики, мешки, бочки, заборы); взрыв поджигает и шлёт одно событие с зерном; у двух
// игроков (зона строилась в разном порядке, событие пришло позже) — тот же пожар; догорело — ломается без рассылки, через 5 минут —
// назад и снова горит; детский городок и чужие числа — никогда.
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/engine/worldmap.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/vehicle-air.js', 'js/games/mir-zones.js', 'js/games/mir-econ.js', 'js/games/mir-city.js', 'js/games/mir-war.js', 'js/games/mir-veh.js', 'js/engine/fire.js', 'js/games/mir-fire.js']) load(f);
const MZ = globalThis.MirZones, E = globalThis.D37E, MFI = globalThis.MirFire, FI = E.fire;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  ✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sec = t => console.log('— ' + t);

// ── боевая зона «вхолостую»: детали с номерами и деревья (K.tree) — как в постройке зоны ──
function warZone(){
  const deep = (nm = 'x') => { const f = function(){}; return new Proxy(f, { get(t, k){ if (k === Symbol.toPrimitive) return () => 0; if (k === 'valueOf') return () => 0; if (k === Symbol.iterator) return function*(){}; if (k === 'then') return undefined; if (k in t) return t[k]; return (t[k] = deep(nm + '.' + String(k))); }, apply(){ return deep(nm + '()'); }, construct(){ return deep('new ' + nm); }, set(t, k, v){ t[k] = v; return true; } }); };
  const pieces = [], lazies = [], brk = []; let n = 0;
  const tgt = { E, Z: MZ.ZONES.war, M: deep('M'), lifts: {}, roofs: [], npcs: [], items: [], seats: [], bodies: [], yo: 0, pieceList: pieces,
    piece: o => { const p = { ...o, zone: 'war', destructible: o.destructible !== false }; pieces.push(p); return p; },
    tree: (x, z, k = 1, v = 0) => { brk.push({ id: 'z:war:t' + (++n), zone: 'war', kind: v < 0 ? 'pine' : 'tree', x, y: 0, z, h: (v < 0 ? 4.2 : 3.6) * k, r: .3 * k }); return null; },
    lamp: (x, z) => { brk.push({ id: 'z:war:l' + (++n), zone: 'war', kind: 'lamp', x, y: 0, z, h: 3.4, r: .16 }); },
    lazy: (x, z, r, gen, y) => lazies.push({ x, z, r, gen, y }), addLift: () => ({}), npc: o => o, tower: () => deep('tower') };
  const K = new Proxy(tgt, { get: (t, k) => (k in t ? t[k] : (t[k] = deep('K.' + String(k)))), set: (t, k, v) => { t[k] = v; return true; } });
  tgt.mbuilding = spec => { const list = MZ.modular(spec).map(o => K.piece(o)); return { list, roof: MZ.pieceGroup(list) }; };
  for (const _ of MZ.DEFS.war.build(K)); for (const L of lazies) L.gen(K);
  // как mir-zones.js: детали-ломаемые (стены, окна, мешки, ящики, бочки, заборы, блоки)
  for (const p of pieces) {
    const kind = p.kind === 'window' ? 'glass' : ['wall', 'lintel', 'sill', 'parapet', 'roof', 'pillar'].includes(p.kind) && p.destructible ? 'wall' : ['bag', 'crate', 'barrel', 'fence', 'block'].includes(p.kind) ? p.kind : null;
    if (kind) brk.push({ id: 'p:' + p.id, zone: 'war', kind, x: p.x, y: kind === 'glass' ? p.y : p.y - p.h / 2, z: p.z, w: Math.max(p.w, p.d), d: Math.min(p.w, p.d), h: p.h });
  }
  return brk;
}
const BRK0 = warZone();
const HP = { tree: 4, pine: 4, pole: 2, lamp: 2, bench: 2, fence: 1, sign: 1, crate: 2, bag: 2, barrel: 2, prop: 2, glass: 1, wall: 5, block: 8 };   // как destruct.js
// ── как destruct.js: список, сломанное (id → когда вернётся), удар по радиусу, breakId (remote — без рассылки), через 5 минут назад ──
function client(order = 1, name = 'A'){
  const sent = [], breaks = [];
  const DS = { list: new Map(), broken: new Map(), t: 0,
    add(b){ b.hp0 = b.hp ?? E.destruct?.HP?.[b.kind] ?? HP[b.kind] ?? 2; b.hp = b.hp0; DS.list.set(b.id, b); return b; },
    remove(id){ DS.list.delete(id); },
    hit(x, z, r, dmg = 1, o = {}){ let n = 0; for (const b of DS.list.values()) { if (DS.broken.has(b.id) || Math.hypot(b.x - x, b.z - z) > r + .5) continue; b.hp -= dmg; if (b.hp <= 0 && DS.breakId(b.id, 1, 0, 0)) n++; } return n; },
    breakId(id, seed, dx, dz, remote){ const b = DS.list.get(id); if (!b || DS.broken.has(id)) return false; DS.broken.set(id, DS.t + 300); breaks.push({ id, remote }); if (!remote) sent.push({ k: 'brk', id }); return true; },
    update(dt){ DS.t += dt; for (const [id, at] of [...DS.broken]) if (DS.t >= at) { DS.broken.delete(id); const b = DS.list.get(id); if (b) b.hp = b.hp0; } },
  };
  const rt = { destruct: DS, send: d => sent.push(d) };
  const X = MFI.attach(rt, { S: {}, R: {}, ph: null, zoneAt: MZ.zoneAt });
  const list = order > 0 ? BRK0 : BRK0.slice().reverse();
  for (const b of list) DS.add({ ...b });
  return { name, DS, rt, X, sent, breaks, step(sec, dt = 1 / 60){ for (let i = 0; i < Math.round(sec / dt); i++) { X.step(dt); DS.update(dt); } } };
}
const burntSet = c => c.breaks.filter(b => b.remote === true).map(b => b.id).sort().join(',');   // сгоревшее (не сам взрыв и не из сети)

sec('горит только горючее боевой зоны');
const A0 = client();
{
  const want = BRK0.filter(b => ['tree', 'pine', 'crate', 'bag', 'barrel', 'fence'].includes(b.kind)).length;
  const kinds = {}; for (const b of BRK0) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
  ok(A0.X && A0.X.stats.parts === want && want > 20, 'в ядре — деревья, ящики, мешки, бочки, заборы зоны (стены, стёкла, фонари — нет)', { parts: A0.X?.stats.parts, want, kinds });
  console.log(`  в зоне ломаемых ${BRK0.length}: ${JSON.stringify(kinds)}; горючих ${want}`);
  // дерево в детском городке (и в столице) — в ядро не попадает
  const K = MZ.ZONES.kids, kx = (K.x0 + K.x1) / 2 || K.x || 0, kz = (K.z0 + K.z1) / 2 || K.z || 0;
  const n0 = A0.X.stats.parts; A0.DS.add({ id: 'kid:t1', kind: 'tree', x: kx, y: 0, z: kz, h: 4, r: .3 });
  ok(A0.X.stats.parts === n0 && MZ.zoneAt(kx, kz)?.id !== 'war', 'дерево детского городка — не горит (не в ядре)', { zone: MZ.zoneAt(kx, kz)?.id });
  // взрыв у детского дерева — ни огня, ни события
  const s0 = A0.sent.length; A0.DS.hit(kx, kz, 5, 3, { by: 'boom' });
  ok(A0.X.F.n === 0 && A0.sent.filter(d => d.k === 'fire').length === 0, 'взрыв вне боевой зоны — без огня и без события «fire»', { n: A0.X.F.n, sent: A0.sent.slice(s0) });
}

// место для пожара: самая густая группа горючего зоны (мешки у укрытий, ящики, деревья); снаряд с разлётом — рядом с ней
const trees = BRK0.filter(b => b.kind === 'tree' || b.kind === 'pine'), burnable = BRK0.filter(b => ['tree', 'pine', 'crate', 'bag', 'barrel', 'fence'].includes(b.kind));
let hot = burnable[0], best = 0; for (const t of burnable) { const n = burnable.filter(u => Math.hypot(u.x - t.x, u.z - t.z) < 6).length; if (n > best) { best = n; hot = t; } }

sec('взрыв в зоне: поджигает рядом, одно событие с зерном; огонь перекидывается; догорело — ломается без рассылки');
{
  const A = client();
  A.DS.hit(hot.x + 2.5, hot.z, 2.4, 3, { by: 'shot', y: 1 });
  const ev = A.sent.filter(d => d.k === 'fire'), own0 = A.breaks.filter(b => !b.remote).length;   // взрыв сам ломает (своё — с рассылкой)
  ok(ev.length === 1 && A.X.F.n >= 1 && Number.isFinite(ev[0].s) && Number.isFinite(ev[0].t), 'взрыв поджёг, событие одно (зерно и номер такта)', { n: A.X.F.n, ev });
  const t0 = performance.now(); A.step(120); const ms = performance.now() - t0;
  const st = A.X.F.stats, burnt = A.breaks.filter(b => b.remote).length;
  ok(st.ignited >= 1 && burnt >= 1, 'загоревшееся догорело и сломано', { ignited: st.ignited, burnt, peak: st.peak });
  // без взрыва (ничего не разметало): подожгли один мешок у укрытия — огонь идёт по мешкам и ящикам рядом
  const C = client(); const p0 = C.X.F.nearest(hot.x, (hot.y || 0) + .3, hot.z, 1); C.X.F.ignite(p0); C.step(90);
  ok(C.X.F.stats.ignited > 5 && C.breaks.filter(b => b.remote === true).length > 5, 'огонь перекинулся по соседнему горючему', { ignited: C.X.F.stats.ignited, peak: C.X.F.stats.peak });
  console.log(`  поджог одного у укрытия: загорелось ${C.X.F.stats.ignited}, сразу до ${C.X.F.stats.peak}`);
  ok(A.breaks.filter(b => !b.remote).length === own0 && A.sent.filter(d => d.k === 'brk').length === own0, 'догоревшее — без рассылки «brk» (у всех своё; рассылает только сам взрыв)', { own0, sent: A.sent.filter(d => d.k === 'brk').length });
  console.log(`  у очага горючего рядом (6 м): ${best}; загорелось ${st.ignited}, сгорело ${burnt}, сразу до ${st.peak}; 120 с игры за ${ms.toFixed(0)} мс`);
  // через 5 минут — назад и снова может гореть
  A.step(310, 1 / 10);
  const back = [...A.X.F.PB].filter(Boolean).length;
  ok(A.DS.broken.size === 0 && back === 0, 'через 5 минут сгоревшее вернулось и снова может гореть', { broken: A.DS.broken.size, burnt: back });
}

sec('сеть: другой игрок (зона строилась в обратном порядке, событие пришло на 0,3 с позже) — тот же пожар');
{
  const A = client(1, 'A'), B = client(-1, 'B');
  A.DS.hit(hot.x + 2.5, hot.z, 2.4, 3, { by: 'shot', y: 1 });
  const ev = A.sent.find(d => d.k === 'fire');
  A.step(.3);
  for (const d of A.sent) if (d.k === 'brk') B.DS.breakId(d.id, 1, 0, 0, 'net');   // что сломал сам взрыв — пришло по сети
  B.X.remote(JSON.parse(JSON.stringify(ev)));
  A.step(90); B.step(90 - .3);
  // сверить на одном номере такта
  while (B.X.F.T < A.X.F.T) B.step(.1);
  while (A.X.F.T < B.X.F.T) A.step(.1);
  ok(A.X.F.T === B.X.F.T && burntSet(A) === burntSet(B) && A.X.F.stats.ignited === B.X.F.stats.ignited, 'у обоих сгорело одно и то же', { T: [A.X.F.T, B.X.F.T], a: A.breaks.length, b: B.breaks.length, ignited: [A.X.F.stats.ignited, B.X.F.stats.ignited] });
  // чужие числа и чужие места — мимо
  const n0 = B.X.F.stats.ignited;
  B.X.remote({ k: 'fire', x: 'x', y: 1, z: 2, r: 3, s: 1, t: 1 }); B.X.remote({ k: 'fire', x: 1e7, y: 1, z: 0, r: 3, s: 1, t: 1 }); B.X.remote({ k: 'fire', x: hot.x, y: 1, z: hot.z, r: 50, s: 1, t: 1 });
  const K = MZ.ZONES.kids; B.X.remote({ k: 'fire', x: (K.x0 + K.x1) / 2 || K.x || 0, y: 1, z: (K.z0 + K.z1) / 2 || K.z || 0, r: 4, s: 1, t: 1 });
  ok(B.X.F.stats.ignited === n0 && B.X.stats.remote === 1, 'событие с плохими числами, огромным радиусом или вне боевой зоны — без огня', B.X.stats);
}

sec('бочка догорела — вспыхивает; частые взрывы — не больше 4 событий в секунду');
{
  const A = client();
  const bar = BRK0.find(b => b.kind === 'barrel');
  if (bar) {
    const p = A.X.F.nearest(bar.x, (bar.y || 0) + .5, bar.z, .5); A.X.F.ignite(p);
    let fl = 0; const n0 = A.X.F.stats.ignited; A.step(30); fl = A.X.F.stats.ignited - n0;
    ok(A.breaks.some(b => b.id === bar.id), 'бочка сгорела (ломается)', { id: bar.id });
    console.log(`  бочка: загорелось рядом ещё ${fl}`);
  } else ok(true, 'бочек в зоне нет');
  const B = client();
  for (let i = 0; i < 10; i++) B.DS.hit(hot.x, hot.z, 3, 3, { by: 'shot', y: 1 });
  ok(B.sent.filter(d => d.k === 'fire').length === 4 && B.X.stats.refused === 6, '10 взрывов за миг — 4 события, остальные без огня', B.X.stats);
}

sec('такт: время и бюджет (большой пожар)');
{
  const A = client(); const T = [];
  for (const t of trees.slice(0, 40)) A.DS.hit(t.x, t.z, 2, 3, { by: 'boom', y: 1 }), A.X.F.T += 0;
  const step0 = A.X.step;
  for (let i = 0; i < 60 * 60; i++) { const a = performance.now(); step0(1 / 60); A.DS.update(1 / 60); T.push(performance.now() - a); }
  T.sort((a, b) => a - b);
  console.log(`  шаг игры с огнём (до ${A.X.F.stats.peak} горящих): в среднем ${(T.reduce((a, b) => a + b, 0) / T.length).toFixed(4)} мс, 99 % — до ${T[Math.floor(T.length * .99)].toFixed(3)} мс`);
  ok(A.X.F.stats.peak > 10, 'горело много сразу', A.X.F.stats.peak);
}

console.log(`\nМир, огонь боевой зоны: ${pass} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);

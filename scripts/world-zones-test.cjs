// Тесты зон «Мира Денчика» (js/games/mir-zones.js, mir-city.js, mir-war.js, js/engine/vehicle.js) в node:
// геометрия карты (зоны не пересекаются, всё связано дорогами и телепортами, место под рост района участков свободно),
// возрастные ворота, правила боя (урон только в зоне, заявки проверяет пострадавший, захват точек, награды), задания ролей
// и лимиты монет (клиент = coins.sql / games-more.sql), состояние игрока по сети (zx), карта, транспорт (если есть vehicle.js).
// Запуск из корня сайта: node scripts/world-zones-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/vehicle-air.js', 'js/games/mir-zones.js', 'js/games/mir-city.js', 'js/games/mir-war.js', 'js/games/mir-veh.js']) load(f);
const MZ = globalThis.MirZones, MC = globalThis.MirCity, MW = globalThis.MirWar, E = globalThis.D37E;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const { ZONES, ZLIST, RESERVE, SEA, BUNKER, ROADS, PADS, inRect, rectsOverlap } = MZ;
const OLD = { x0: -84, x1: 84, z0: -72, z1: 92 };   // старый мир (mir.js buildWorld)

// ═══ 1. Карта: зоны, место района, граница мира ═══
{
  for (let i = 0; i < ZLIST.length; i++) for (let j = i + 1; j < ZLIST.length; j++) ok(!rectsOverlap(ZLIST[i], ZLIST[j], 20), `зоны ${ZLIST[i].id} и ${ZLIST[j].id} не пересекаются (запас 20)`);
  for (const Z of ZLIST) {
    ok(!rectsOverlap(Z, OLD, 5), `${Z.id}: не залезает на старый мир`);
    ok(!rectsOverlap(Z, RESERVE, 40), `${Z.id}: далеко от места под рост района участков (40)`);
    ok(Z.x1 - Z.x0 >= 120 && Z.z1 - Z.z0 >= 110, `${Z.id}: большая зона`, [Z.x1 - Z.x0, Z.z1 - Z.z0]);
    ok(inRect(Z, Z.entry.x, Z.entry.z, -2), `${Z.id}: точка входа внутри`);
    ok(near(Z.gate.x, Z.x0) || near(Z.gate.x, Z.x1) || near(Z.gate.z, Z.z0) || near(Z.gate.z, Z.z1), `${Z.id}: ворота на краю зоны`);
    ok(Z.name && Z.icon && typeof Z.age === 'number', `${Z.id}: название, значок, возраст`);
  }
  ok(ZONES.kids.age === 0 && ZONES.war.age === 12 && ZONES.metro.age === MZ.ADULT_AGE && [16, 18].includes(MZ.ADULT_AGE), 'возраст: детский 0+, боевая 12+, взрослый — одна цифра ADULT_AGE (16 или 18)');
  // район участков: координатор просил прямоугольник x −133…−12, z −137…−12 — ни зон, ни дорог, ни телепортов, ни деревьев
  ok(RESERVE.x0 <= -133 && RESERVE.x1 >= -12 && RESERVE.z0 <= -137 && RESERVE.z1 >= -12, 'место района участков — как просили (x −133…−12, z −137…−12)');
  const segPts = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) for (const [x, z] of segPts(r.pts[i - 1], r.pts[i], 40)) ok(!inRect(RESERVE, x, z, r.w / 2 + 2), `дорога ${r.id} — не в районе участков`, [x, z]);
  for (const p of PADS) { ok(!inRect(RESERVE, p.x, p.z, 1), `телепорт ${p.to} — не в районе`); ok(Math.hypot(p.x, p.z) < 17.6 - 1.1, `телепорт ${p.to} — на площади`); }
  for (const p of MZ.places()) ok(!inRect(RESERVE, p.x, p.z), `место ${p.id} — не в районе участков`, [p.x, p.z]);
  ok(MZ.blocked(-60, -60) && MZ.blocked(-20, -130), 'деревья мира не растут в районе участков');
  // граница мира и земля
  const B = MZ.bounds(), G = MZ.groundRect();
  for (const R of [...ZLIST, RESERVE, OLD]) ok(B[0] <= R.x0 && B[2] >= R.x1 && B[1] <= R.z0 && B[3] >= R.z1, 'граница мира вмещает ' + (R.id || 'район/старый мир'));
  ok(G[0] < B[0] - 100 && G[2] > B[2] + 100 && G[1] < B[1] - 100 && G[3] > B[3] + 100, 'земля шире границы мира (до тумана — не пустота)');
  ok(!MZ.hillOk(170, 170, 40) && MZ.hillOk(B[2] + 80, 0, 40) && !MZ.hillOk(B[2] + 20, 0, 40), 'холмы горизонта — только целиком за краем мира');
  // море и бункер — в боевой зоне; рельеф и вода
  const W = ZONES.war;
  ok(SEA.x1 > W.x0 && SEA.x1 < W.x1 && SEA.z0 >= W.z0 && SEA.z1 <= W.z1, 'море — в западной части боевой зоны');
  ok(inRect(W, BUNKER.x0, BUNKER.z0, -5) && inRect(W, BUNKER.x1, BUNKER.z1, -5), 'бункер — внутри боевой зоны');
  ok(MZ.terrain((SEA.x0 + SEA.x1) / 2, (SEA.z0 + SEA.z1) / 2) === SEA.floor && MZ.water(SEA.x1 - 10, 250) === SEA.wl && MZ.water(-200, 250) === -Infinity, 'море: дно и вода');
  const bcx = (BUNKER.x0 + BUNKER.x1) / 2, bcz = (BUNKER.z0 + BUNKER.z1) / 2;
  ok(MZ.terrain(bcx, bcz) === BUNKER.floor && MZ.terrain(BUNKER.x1 + 20, bcz) === 0 && MZ.terrain(0, 0) === 0, 'бункер: пол ниже земли, вокруг — ровно');
  ok(SEA.wl > SEA.floor + 5, 'море глубокое — можно плавать');
}

// ═══ 2. Связность: дороги от площади до каждой зоны, телепорты во все зоны ═══
{
  // граф: узлы — концы дорог; площадь (r ≤ 18) и улица с домиками (0, 17…75) — старые дороги
  const nodes = [], key = p => p[0] + ',' + p[1];
  const adj = new Map(), link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!adj.has(key(p))) adj.set(key(p), new Set()); adj.get(key(p)).add(key(q)); } };
  for (const r of ROADS) for (let i = 1; i < r.pts.length; i++) { link(r.pts[i - 1], r.pts[i]); nodes.push(r.pts[i - 1], r.pts[i]); }
  // узлы на одной дороге с другими (развилка, конец улицы) — по совпадению точек; площадь и улица — особые
  const HUB = 'hub';
  for (const p of nodes) {
    if (Math.hypot(p[0], p[1]) <= 20) link(p, [HUB, 0]);
    if (Math.abs(p[0]) < 4 && p[1] >= 17 && p[1] <= 76) link(p, [HUB, 0]);   // улица с домиками начинается у площади
  }
  const seen = new Set([key([HUB, 0])]), q = [key([HUB, 0])];
  while (q.length) { const k = q.shift(); for (const n of adj.get(k) || []) if (!seen.has(n)) { seen.add(n); q.push(n); } }
  for (const Z of ZLIST) ok([...seen].some(k => { const [x, z] = k.split(',').map(Number); return Math.hypot(x - Z.gate.x, z - Z.gate.z) < 1; }), `дорога от лобби до ворот: ${Z.name}`);
  ok(ROADS.find(r => r.id === 'link') && inRect(ZONES.kids, 180, 40) && inRect(ZONES.metro, 180, 100), 'дорога между детским и взрослым городом');
  // телепорты: на площади — в каждую зону; в каждой зоне — место телепорта внутри
  for (const Z of ZLIST) {
    ok(PADS.some(p => p.to === Z.id), `телепорт с площади: ${Z.name}`);
    ok(MZ.places().some(p => p.zone === Z.id && inRect(Z, p.x, p.z)), `места зоны на карте: ${Z.name}`);
  }
  const ids = new Set(MZ.places().map(p => p.id));
  for (const p of PADS) ok(p.to === 'studio' || ids.has(p.to), `телепорт ${p.to} ведёт в место карты`);
  for (const t of ['cafe', 'club', 'stage', 'park', 'district', 'wardrobe']) ok(PADS.some(p => p.to === t), 'телепорт с площади: ' + t);
  // телепорты не налезают друг на друга и на скамейки/табличку/гида у фонтана
  const obst = [[-3.6, 13.5, 'табличка'], [-5.6, 12.4, 'гид'], [6.6, 15.8, 'щит-карта'], ...[30, 150, 210, 270, 330].map(a => [Math.cos(a * Math.PI / 180) * 9, Math.sin(a * Math.PI / 180) * 9, 'скамейка ' + a])];
  for (const p of PADS) {
    for (const [x, z, n] of obst) ok(Math.hypot(p.x - x, p.z - z) > 2.3, `телепорт ${p.to} — не на месте «${n}»`, Math.hypot(p.x - x, p.z - z).toFixed(2));
    for (const o of PADS) if (o !== p) ok(Math.hypot(p.x - o.x, p.z - o.z) > 3, `телепорты ${p.to} и ${o.to} не слиплись`);
    ok(Math.hypot(p.x, p.z) > 3.3 + 1.1, `телепорт ${p.to} — не в фонтане`);
  }
}

// ═══ 3. Здания зон: внутри своей зоны, не друг на друге, не на улицах ═══
{
  const rectOf = f => ({ x0: f[0] - f[2] / 2, x1: f[0] + f[2] / 2, z0: f[1] - f[3] / 2, z1: f[1] + f[3] / 2 });
  for (const [id, D] of Object.entries(MZ.DEFS)) {
    const Z = ZONES[id], F = (D.footprints || []).filter(f => f[5] !== 0);
    ok(F.length >= 5, `${id}: есть здания`, F.length);
    for (const f of D.footprints || []) ok(inRect(Z, f[0] - f[2] / 2, f[1] - f[3] / 2, .01) && inRect(Z, f[0] + f[2] / 2, f[1] + f[3] / 2, .01), `${id}: здание ${f} — внутри зоны`);
    for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) ok(!rectsOverlap(rectOf(F[i]), rectOf(F[j]), -.01), `${id}: здания не друг на друге`, [F[i].slice(0, 4), F[j].slice(0, 4)]);
    for (const st of D.streets || []) for (let i = 1; i < st.pts.length; i++) {
      const [a, b] = [st.pts[i - 1], st.pts[i]], r = { x0: Math.min(a[0], b[0]) - st.w / 2, x1: Math.max(a[0], b[0]) + st.w / 2, z0: Math.min(a[1], b[1]) - st.w / 2, z1: Math.max(a[1], b[1]) + st.w / 2 };
      for (const f of F) ok(!rectsOverlap(rectOf(f), r, -.01), `${id}: здание не на улице`, [f.slice(0, 4), st.pts]);
    }
    for (const p of D.places || []) ok(inRect(Z, p.x, p.z) && inRect(Z, p.lx, p.lz), `${id}: место ${p.id} — внутри зоны`);
  }
  // точки заданий — в своём городе
  for (const [id, p] of Object.entries(MC.SPOTS)) ok(inRect(id[0] === 'k' ? ZONES.kids : ZONES.metro, p[0], p[2]), 'точка задания в городе: ' + id);
}

// ═══ 4. Возрастные ворота (D37Age — подменный) ═══
{
  const fake = (known, age, soft = 0) => ({ known: () => known, canOpen: n => (known && age >= n) || (n < 18 && soft >= n) });
  ok(MZ.gateOf(ZONES.kids, fake(false, null)).ok, 'детский город — всем, даже без возраста');
  ok(MZ.gateOf(ZONES.war, fake(false, null)).why === 'unknown' && MZ.gateOf(ZONES.metro, fake(false, null)).why === 'unknown', 'возраст не указан — спросить год (и в боевую, и во взрослый город)');
  ok(MZ.gateOf(ZONES.war, fake(true, 10)).why === 'young', 'ребёнку до 12 — вежливый отказ в боевую зону');
  ok(MZ.gateOf(ZONES.war, fake(true, 10, 12)).ok, '«Взрослый разрешил» (canOpen 12) — пускает в боевую');
  ok(MZ.gateOf(ZONES.war, fake(true, 13)).ok && MZ.gateOf(ZONES.metro, fake(true, 13)).why === 'young', '13 лет: боевая — да, взрослый город — нет');
  ok(!MZ.gateOf(ZONES.metro, fake(true, 15, 18)).ok, '18+ «взрослый разрешил» не открывает (canOpen так устроен)');
  ok(MZ.gateOf(ZONES.metro, fake(true, MZ.ADULT_AGE)).ok, `с ${MZ.ADULT_AGE} — во взрослый город`);
  ok(MZ.gateOf(ZONES.war, null).ok, 'нет D37Age (старая страница) — без ворот');
}

// ═══ 5. Бой: урон только в зоне, заявки проверяет пострадавший ═══
{
  const W = MW.WEAPONS, now = 100000;
  const me = (o = {}) => ({ x: 0, z: 0, zone: true, team: 0, prot: 0, shield: 0, now, ...o });
  const att = (o = {}) => ({ x: 10, z: 0, zone: true, team: 0, merc: 0, ...o });
  const c = (o = {}) => ({ w: 'foam', dmg: W.foam.dmg, ax: 10, az: 0, ...o });
  ok(MW.claimOk(c(), me(), att()) === null, 'обычное попадание принимается');
  ok(MW.claimOk(c(), me({ zone: false }), att()) === 'zone', 'вне зоны урона нет (пострадавший снаружи)');
  ok(MW.claimOk(c(), me(), att({ zone: false })) === 'zone', 'вне зоны урона нет (стрелок снаружи)');
  ok(MW.claimOk(c(), me({ prot: now + 1000 }), att()) === 'protected', 'защита после появления');
  ok(MW.claimOk(c(), me({ shield: now + 500 }), att()) === 'protected', 'щит-пузырь');
  ok(MW.claimOk(c(), me({ team: 1 }), att({ team: 1 })) === 'team', 'по своим урона нет');
  ok(MW.claimOk(c(), me({ team: 1 }), att({ team: 2 })) === null, 'по чужой команде — есть');
  ok(MW.claimOk(c({ dmg: W.foam.dmg + 5 }), me(), att()) === 'dmg', 'урон больше оружия — отказ');
  ok(MW.claimOk(c({ dmg: 0 }), me(), att()) === 'dmg' && MW.claimOk(c({ dmg: -5 }), me(), att()) === 'dmg', 'нулевой и отрицательный урон — отказ');
  ok(MW.claimOk(c({ ax: 40 }), me(), att()) === 'origin', 'стрелял не оттуда, где его видно — отказ');
  ok(MW.claimOk(c({ ax: 80 }), me(), att({ x: 80 })) === 'range', 'дальше дальности оружия — отказ');
  ok(MW.claimOk(c({ w: 'sword', dmg: W.sword.dmg, ax: 3 }), me(), att({ x: 3 })) === null && MW.claimOk(c({ w: 'sword', dmg: W.sword.dmg, ax: 12 }), me(), att({ x: 12 })) === 'range', 'меч — только вплотную');
  ok(MW.claimOk(c({ w: 'nuke' }), me(), att()) === 'weapon' && MW.claimOk(c({ w: 'shield', dmg: 1 }), me(), att()) === 'weapon', 'неизвестное оружие и щит — не бьют');
  ok(MW.claimOk(c({ w: 'merc', dmg: W.merc.dmg }), me(), att()) === 'merc' && MW.claimOk(c({ w: 'merc', dmg: W.merc.dmg }), me(), att({ merc: 1 })) === null, 'наёмник — только у того, у кого он есть');
  const lim = Math.ceil(1 / W.foam.cd) + 1, hist = Array.from({ length: lim }, (_, i) => now - 900 + i * 10);
  ok(MW.claimOk(c(), me(), att(), hist) === 'rate' && MW.claimOk(c(), me(), att(), hist.slice(1)) === null && MW.claimOk(c(), me(), att(), hist.map(t => t - 2000)) === null, 'частота выстрелов: больше оружия — отказ; старые не считаются');
  ok(MW.splashDmg(W.water, 0) === W.water.dmg && MW.splashDmg(W.water, W.water.splash) === 0 && MW.splashDmg(W.water, W.water.splash / 2) < W.water.dmg, 'водяная бомба: сильнее в центре, на краю — 0');
  for (const [k, w] of Object.entries(W)) if (w.dmg > 0) ok(w.cd > 0 && w.range > 0 && w.dmg <= 40, `оружие ${k}: мультяшное (урон ≤ 40, перезарядка, дальность)`);
  ok(MW.HP === 100 && MW.RESPAWN >= 3 && MW.PROTECT >= 2, 'жизни 100, появление через ' + MW.RESPAWN + ' с, защита ' + MW.PROTECT + ' с');
  // появление — в зоне, на суше, не в бункере
  for (const [k, L] of Object.entries(MW.SPAWNS)) for (const [x, z] of L) ok(inRect(ZONES.war, x, z, -3) && !inRect(SEA, x, z, 2) && !inRect(BUNKER, x, z, 2), `появление ${k} (${x}, ${z}) — в зоне на суше`);
  for (const P of MW.POINTS) ok(inRect(ZONES.war, P.x, P.z, -8) && !inRect(SEA, P.x, P.z, 8) && !inRect(BUNKER, P.x, P.z, 8), 'точка захвата ' + P.id + ' — в зоне');
  ok(MW.MERC.max <= 3 && MW.MERC.price >= 20, 'наёмники: немного и не бесплатно');
}

// ═══ 5б. Участки военных баз (владелец: боевая зона — дом военных баз, как Military Tycoon; систему баз делает агент набегов) ═══
{
  const W = ZONES.war, L = MW.PLOTS;
  ok(L.length >= 8 && L.length <= 16, 'участков баз — от 8 до 16', L.length);
  ok(new Set(L.map(p => p.id)).size === L.length && L.every((p, i) => p.id === 'wb' + String(i + 1).padStart(2, '0') && p.n === i + 1), 'номера участков — постоянные, разные, по порядку (wb01…)');
  for (const P of L) {
    ok(near(P.x1 - P.x0, 51.2) && near(P.z1 - P.z0, 51.2) && P.cells === 32 && P.cell === 1.6, `${P.id}: 32 × 32 клетки по 1,6`);
    ok(inRect(W, P.x0, P.z0, -1) && inRect(W, P.x1, P.z1, -1), `${P.id}: в боевой зоне`);
    ok(!rectsOverlap(P, SEA, -.01) && !rectsOverlap(P, BUNKER, 4), `${P.id}: на суше, не над бункером`);
    for (const Q of L) if (Q !== P) ok(!rectsOverlap(P, Q, 4), `${P.id} и ${Q.id}: между участками — дорога`);
    for (const k of ['spawn', 'garage', 'heli', 'hangar', 'cp']) ok(inRect(P, P[k].x, P[k].z, -2), `${P.id}: ${k} — внутри участка`, P[k]);
    ok(near(Math.min(Math.abs(P.gate.x - P.x0), Math.abs(P.gate.x - P.x1), Math.abs(P.gate.z - P.z0), Math.abs(P.gate.z - P.z1)), 0), `${P.id}: въезд — на ограде`);
    ok(inRect(SEA, P.dock.x, P.dock.z, -1), `${P.id}: доки / причал — в воде`, P.dock);
    if (P.coast) ok(near(P.x0, SEA.x1) && P.dock.own, `${P.id}: свой берег`);
    else ok(!P.dock.own && P.dock.z > MW.PORT.z0 && P.dock.z < MW.PORT.z1, `${P.id}: место у причала порта`, P.dock);
    ok(P.airSlot && inRect(MW.AIR.apron, P.airSlot.x, P.airSlot.z, -5) && !rectsOverlap({ x0: P.airSlot.x - 5.5, x1: P.airSlot.x + 5.5, z0: P.airSlot.z - 5.5, z1: P.airSlot.z + 5.5 }, MW.AIR.runway), `${P.id}: стоянка на перроне, не на полосе`);
    ok(P.under.x0 > P.x0 && P.under.x1 < P.x1 && P.under.z0 > P.z0 && P.under.z1 < P.z1 && P.under.floor < P.under.top && P.under.top <= 0 && MZ.terrain((P.under.x0 + P.under.x1) / 2, (P.under.z0 + P.under.z1) / 2) === 0, `${P.id}: место под подвал — под участком, сейчас там пусто`);
  }
  ok(L.filter(p => p.coast).length >= 3, 'у части участков свой берег (доки)', L.filter(p => p.coast).length);
  ok(new Set(L.map(p => p.dock.x + ',' + p.dock.z)).size === L.length && new Set(L.map(p => p.airSlot.x)).size === L.length, 'у каждой базы свои доки / причал и своя стоянка');
  // нейтральные места — не на участках
  for (const [nm, r] of [['центр', MW.CENTER], ['порт', MW.PORT], ['перрон', MW.AIR.apron], ['полоса', MW.AIR.runway], ['бункер', BUNKER]]) for (const P of L) ok(!rectsOverlap(P, r, 2), `${nm} — не на участке ${P.id}`);
  for (const P of MW.POINTS) ok(!MW.inPlot(P.x, P.z, 8), `точка ${P.id} — на нейтральной земле`);
  for (const [k, S] of Object.entries(MW.SPAWNS)) for (const [x, z] of S) ok(!MW.inPlot(x, z, 1), `появление ${k} (${x}, ${z}) — не на участке базы`);
  for (const [k, S] of Object.entries(MW.VEH)) for (const [x, z] of S) ok(!MW.inPlot(x, z, 1), `транспорт ${k} — не на участке базы`);
  ok(MZ.buildings('war').filter(b => b.sub === 'cp').length === L.length && L.every(P => MZ.building(P.id + '_cp')?.plot === P.id), 'на каждом участке — командный пункт (одна постройка)');
  ok(MZ.buildings('war').filter(b => b.sub !== 'cp').every(b => !MW.inPlot(b.x, b.z, 1)), 'другие здания зоны — не на участках');
  // небо над полосой свободно: высоких зданий рядом нет, полоса длинная
  const RW = MW.AIR.runway, air = { x0: RW.x0 - 40, x1: RW.x1 + 40, z0: RW.z0 - 30, z1: RW.z1 + 30 };
  ok(MZ.buildings('war').filter(b => b.h > 8 && b.id !== 'w_control').every(b => !inRect(air, b.x, b.z)), 'у полосы нет высоких зданий (кроме диспетчерской)');
  ok(RW.x1 - RW.x0 >= 150, 'полоса не короче 150 м');
  // дороги зоны: каждый въезд участка — у дороги
  const roadNear = (x, z) => MW.W_ROADS.some(r => { const [[ax, az], [bx, bz]] = r.pts; return x >= Math.min(ax, bx) - 9 && x <= Math.max(ax, bx) + 9 && z >= Math.min(az, bz) - 9 && z <= Math.max(az, bz) + 9; });
  for (const P of L) ok(roadNear(P.gate.x, P.gate.z), `${P.id}: у въезда — дорога`);
  ok(MZ.DEFS.war.plots === L, 'участки — в описании зоны (карта рисует их пунктиром)');
}

// ═══ 6. Захват точек и команды ═══
{
  const pts = () => MW.POINTS.map(p => ({ id: p.id, own: 0, prog: 0 }));
  let P = pts();
  for (let i = 0; i < 60 * (MW.CAP_T + .2); i++) MW.capStep(P, { A: [1, 0] }, 1 / 60);
  ok(P[0].own === 1 && P[0].prog <= -1 && P[1].own === 0, `красный один захватил A за ~${MW.CAP_T} с, B ничья`);
  const before = P[0].prog;
  for (let i = 0; i < 300; i++) MW.capStep(P, { A: [2, 2] }, 1 / 60);
  ok(P[0].prog === before && P[0].own === 1, 'спорят — точка стоит');
  for (let i = 0; i < 60 * (2 * MW.CAP_T + .5); i++) MW.capStep(P, { A: [0, 1] }, 1 / 60);
  ok(P[0].own === 2, 'синий перекрасил A (через ничью)');
  P = pts(); for (let i = 0; i < 60 * 3; i++) MW.capStep(P, { B: [3, 0] }, 1 / 60);
  ok(P[1].own === 1, 'втроём — быстрее (3 с вместо ' + MW.CAP_T + ')');
  // очки команды за удержание: 2 точки — победа к CAP_WIN/2 с
  P = pts(); const teams = { 1: 0, 2: 0 }; let t = 0;
  for (; t < 600 && teams[1] < MW.CAP_WIN; t += 1 / 10) { MW.capStep(P, { A: [1, 0], B: [1, 0] }, 1 / 10); for (const p of P) if (p.own) teams[p.own] += 1 / 10; }
  ok(teams[1] >= MW.CAP_WIN && t < MW.CAP_WIN / 2 + MW.CAP_T + 5 && teams[2] === 0, `две точки — победа красных за ~${Math.round(t)} с`);
  ok(MW.teamFor({ 1: 3, 2: 1 }) === 2 && MW.teamFor({ 1: 1, 2: 2 }) === 1 && MW.teamFor({ 1: 0, 2: 0 }) === 1, 'новичок — в меньшую команду');
  // награды за раунд
  const r0 = MW.reward('ffa', 0, false), r1 = MW.reward('ffa', 4, true), rBig = MW.reward('team', 999, true);
  ok(r0.coins === 0 && !r0.win && r1.coins === 14 && r1.win && r1.score === 4, 'награда: 2 🪙 за выбитого + 6 за победу');
  ok(rBig.coins === 20 && rBig.score === 200, 'награда режется: ≤ 20 🪙 (coin_run_cap) и ≤ 200 очков (game_score_cap)');
}

// ═══ 7. Работы, задания, монеты за работу ═══
{
  const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
  const all = { kids: MC.ROLES_K, metro: MC.ROLES_M };
  const CARRY = ['bun', 'brick', 'pet', 'med', 'box', 'money', 'food', 'icecream', 'coffee'];
  for (const [city, roles] of Object.entries(all)) {
    const spots = MC.spotsOf(city), Z = ZONES[city];
    for (const [role, R] of Object.entries(roles)) {
      ok(R.icon && R.name && R.desc && R.hat && R.vest, `${city}/${role}: значок, название, описание, форма`);
      ok(MZ.ROLES[role] && MZ.ROLES[role].zone === city, `${city}/${role}: роль известна сети (zx.r)`);
      if (R.car) { ok(MC.taskList(role, city, spots, rnd) === null, `${role}: без машин — без заданий (vehicle.js)`); continue; }
      for (let k = 0; k < 12; k++) {
        const L = MC.taskList(role, city, spots, rnd, ['coffee']);
        ok(Array.isArray(L) && L.length >= 1 && L.length <= 8, `${city}/${role}: задание из 1–8 шагов`);
        for (const st of L || []) {
          ok(st.at && Number.isFinite(st.at.x) && Number.isFinite(st.at.z) && inRect(Z, st.at.x, st.at.z), `${city}/${role}: шаг «${st.text}» — в своём городе`, st.at);
          ok(typeof st.text === 'string' && st.text.length > 3 && st.icon, `${city}/${role}: текст и значок шага`);
          ok(!st.hold || (st.hold > 0 && st.hold <= 6), `${city}/${role}: держать E не дольше 6 с`);
          ok(!st.carry || CARRY.includes(st.carry), `${city}/${role}: что несёт — известно (${st.carry})`);
          ok(!st.act || MZ.ACTS.has(st.act), `${city}/${role}: поза ${st.act} — известна сети`);
        }
      }
    }
  }
  ok(MC.taskList('biz', 'metro', MC.spotsOf('metro'), rnd, []).some(s => s.nobiz), 'бизнесмен без бизнеса — сначала купить');
  // детский город — без преступлений и оружия
  ok(!Object.keys(MC.ROLES_K).some(r => /rob|police|gun|war/.test(r)), 'в детском городе нет «преступных» ролей');
  ok(MC.ROLES_M.robber && MC.ROLES_M.police && MC.ROLES_M.judge && MC.ROLES_M.cashier, 'во взрослом — полиция, грабители, суд, банк');
  // монеты за работу: пачкой и с дневным лимитом
  const s = { day: 'x', got: 0, pend: 0, n: 0 };
  let total = 0; for (let i = 0; i < 100; i++) total += MZ.payAdd(s);
  ok(total === MZ.PAY.day && s.pend === MZ.PAY.day, `монет за работу в день — не больше ${MZ.PAY.day}`);
  ok(MZ.PAY.cap <= 10 && MZ.PAY.task <= 3, 'за задание — 2 🪙, выплата пачкой ≤ 10');
  // клиент = сервер: coins.sql coin_run_cap ('rp', 'mirwar') = coins.js RUN_CAP; games-more.sql — ключ mirwar
  const coinsSql = fs.readFileSync(path.join(SITE, 'coins.sql'), 'utf8'), more = fs.readFileSync(path.join(SITE, 'games-more.sql'), 'utf8'), coinsJs = fs.readFileSync(path.join(SITE, 'js/core/coins.js'), 'utf8');
  ok(/when 'rp' then 10\b/.test(coinsSql) && /\brp: 10\b/.test(coinsJs) && MZ.PAY.cap === 10, "coin_run_cap('rp') = 10 = RUN_CAP.rp = PAY.cap");
  ok(/when 'mirwar' then 20\b/.test(coinsSql) && /\bmirwar: 20\b/.test(coinsJs) && MW.reward('ffa', 99, true).coins === 20, "coin_run_cap('mirwar') = 20 = RUN_CAP.mirwar = награда за раунд");
  ok(/p_game = 'mirwar' then 200/.test(more) && /when 'mirwar' then 3\b/.test(more), "games-more.sql: game_score_cap('mirwar') = 200, game_win_xp = 3");
  ok(MW.MERC.price === 30, 'наёмник — 30 🪙 = coin_price(revive) (coins_revive)');
}

// ═══ 8. Состояние игрока по сети (zx) ═══
{
  const z = MZ.cleanZX({ r: 'baker', a: 'eat', w: 'icecream', t: 2, h: 7, m: 2, pt: 'dog', wn: 1, pr: 1, hs: 'k_h1', sl: [1, 2, 3, 4], f: 'mom', v: ['boat', 1, 2, 3], evil: '<script>' });
  ok(z && z.r === 'baker' && z.a === 'eat' && z.t === 2 && z.h === 7 && z.m === 2 && z.pt === 'dog' && z.wn === 1 && z.pr === 1 && z.hs === 'k_h1' && z.f === 'mom' && !('evil' in z), 'zx: нужное — да, лишнее — нет');
  const bad = MZ.cleanZX({ r: 'hacker', a: 'fly', t: 3, h: 99, m: 50, sl: [1, NaN, 3, 4], w: 'Robert"); DROP', hs: '../x', v: [1, 2] });
  ok(bad === null, 'zx: мусор и выход за границы — отброшено', bad);
  ok(MZ.cleanZX(null) === null && MZ.cleanZX([1]) === null && MZ.cleanZX('x') === null, 'zx: не объект — пусто');
  const big = MZ.cleanZX({ v: Array.from({ length: 30 }, (_, i) => i) });
  ok(!big, 'zx: слишком длинный транспорт — отброшен');
}

// ═══ 9. Карта (общая для окна M и телефона 📱) ═══
{
  const calls = { fillRect: 0, fillText: 0, arc: 0 };
  const g = new Proxy({}, { get: (t, k) => (k in calls ? (...a) => { calls[k]++; } : typeof k === 'string' && /^(set|get|begin|move|line|stroke|fill|save|restore|translate|rotate|close|measure|arc|rect)/.test(k) ? (k === 'measureText' ? () => ({ width: 40 }) : () => {}) : t[k]), set: (t, k, v) => { t[k] = v; return true; } });
  const view = MZ.drawMap(g, 640, 520, null, { players: [{ x: 0, z: 0, friend: true }], me: { x: 1, z: 1, yaw: 0 }, marks: [{ icon: '🚩', x: -112, z: 214 }] });
  ok(calls.fillRect > 10 && calls.fillText > 15, 'карта рисуется (зоны, места, подписи)', calls);
  const [x, z] = view.inv(view.sx(120), view.sz(-30));
  ok(near(x, 120, 1e-6) && near(z, -30, 1e-6), 'нажатие на карте → точка мира');
  ok(globalThis.MirMap && globalThis.MirMap.draw === MZ.drawMap && typeof globalThis.MirMap.points === 'function', 'MirMap — для телефона');
  const P = MZ.places();
  ok(P.length >= 30 && P.every(p => Number.isFinite(p.yaw) && p.icon && p.name), 'места: много, у каждого — значок, название, куда смотреть');
  ok(P.filter(p => p.zone === 'war').every(p => p.age === 12) && P.filter(p => p.zone === 'metro').every(p => p.age === MZ.ADULT_AGE), 'места зон помечены возрастом (12+ / ' + MZ.ADULT_AGE + '+)');
}

// ═══ 10. Здания — одна таблица (для будущей «симуляции города»): id, тип, помещения, мэрии, цвет крыш по типу ═══
{
  const all = MZ.buildings(), ids = new Set();
  ok(all.length >= 50, 'зданий в таблице много', all.length);
  for (const b of all) {
    ok(/^[a-z][a-z0-9_]*$/.test(b.id) && !ids.has(b.id), 'id здания стабильный и единственный: ' + b.id); ids.add(b.id);
    ok(MZ.BTYPES[b.type], `${b.id}: тип известен (${b.type})`);
    ok(b.zone && MZ.ZONES[b.zone] && inRect(MZ.ZONES[b.zone], b.x, b.z), `${b.id}: в своей зоне`);
    ok(b.roof === MZ.roofColor(b) && /^#[0-9a-f]{6}$/i.test(b.roof), `${b.id}: крыша — цвет типа`);
    ok(Array.isArray(b.lots) && b.lots.every(l => l.id.startsWith(b.id + ':') && l.kind && l.name), `${b.id}: помещения с номерами`);
    ok(new Set(b.lots.map(l => l.id)).size === b.lots.length, `${b.id}: номера помещений не повторяются`);
    if (b.type === 'public') ok(b.sub === 'hall' ? b.lots.length === 1 && b.lots[0].kind === 'mayor' : b.lots.every(l => l.kind !== 'flat' && l.kind !== 'office'), `${b.id}: городское здание — не продаётся (у мэрии — кабинет мэра, внутри — только отдельные места вроде ветклиники)`);
    if (b.type === 'apartment') ok(b.lots.filter(l => l.kind === 'flat').length >= 2, `${b.id}: квартиры`);
    if (b.type === 'office' && b.h > 20) ok(b.lots.length >= Math.round(b.h / MZ.FLOOR_H) - 1, `${b.id}: этажи офиса — помещения`);
    if (b.type === 'lot') ok(b.h === 0 && b.lots[0]?.kind === 'land', `${b.id}: свободный участок — земля под застройку`);
    if (b.style) ok(MZ.FACADES[b.style], `${b.id}: фасад ${b.style} есть`);
    if (b.style && b.h > 9) ok(Math.abs(b.h / MZ.FLOOR_H - Math.round(b.h / MZ.FLOOR_H)) < 1e-6, `${b.id}: высота кратна этажу (окна = этажи)`);
  }
  for (const z of ['kids', 'metro']) {
    const L = MZ.buildings(z);
    ok(L.some(b => b.type === 'public' && b.sub === 'hall'), `${z}: мэрия/ратуша (кабинет будущего мэра)`);
    ok(L.filter(b => b.type === 'lot').length >= 2, `${z}: свободные участки под застройку`);
    for (const t of ['public', 'shop', 'cafe']) ok(L.some(b => b.type === t), `${z}: есть ${t}`);
  }
  ok(MZ.buildings('metro').some(b => b.h >= 100), 'Большой город — высокий: башня выше 100');
  ok(MZ.buildings('metro').filter(b => b.h >= 40).length >= 6, 'Большой город — много высоток');
  ok(MZ.buildings('kids').every(b => b.h <= 12), 'детский городок — невысокий');
  ok(MZ.buildings('war').every(b => b.type === 'military' && b.lots.length === 0), 'боевая зона — военные объекты, без помещений');
  const res = new Set(['house', 'apartment']), com = new Set(['shop', 'cafe', 'office', 'hotel']);
  const rc = t => MZ.roofColor({ type: t });
  ok([...res].every(t => ![...com].some(c => rc(c) === rc(t))) && rc('public') !== rc('shop') && rc('factory') !== rc('house'), 'сверху: жильё, торговля, город и производство — разного цвета');
  // места роста городов
  for (const e of MZ.EXPAND) {
    const Z = ZONES[e.zone];
    ok(!ZLIST.some(z => rectsOverlap(z, e, -.01)) && !rectsOverlap(e, RESERVE, 0), `рост ${e.id}: не на зонах и не на районе участков`);
    ok(e.x0 === Z.x1 || e.x1 === Z.x0 || e.z0 === Z.z1 || e.z1 === Z.z0, `рост ${e.id}: вплотную к своему городу`);
    ok(MZ.blocked((e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2) && !MZ.hillOk((e.x0 + e.x1) / 2, (e.z0 + e.z1) / 2, 10), `рост ${e.id}: без деревьев и холмов`);
  }
  // канал: в городе, ниже улиц (под мостами проходят лодки), мосты — на проспектах
  const C = MZ.CANAL, M = ZONES.metro;
  ok(C.x0 >= M.x0 && C.x1 <= M.x1 && C.z0 > M.z0 && C.z1 < M.z1, 'канал — в Большом городе');
  ok(MZ.terrain(200, 258) === C.floor && MZ.water(200, 258) === C.wl && MZ.water(200, 240) === -Infinity && C.wl < -1.5 && C.wl - C.floor > 2, 'канал: вода ниже улиц на 1,5+, глубина — плыть');
  const ns = MZ.DEFS.metro.streets.filter(s => s.pts[0][0] === s.pts[1][0]);
  ok(ns.length >= 3 && ns.every(s => Math.min(s.pts[0][1], s.pts[1][1]) < C.z0 && Math.max(s.pts[0][1], s.pts[1][1]) > C.z1), 'проспекты пересекают канал (мосты, эстакада)');
  for (const b of MZ.buildings('metro')) if (b.h > 0) ok(!rectsOverlap({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2 }, C, 1), `${b.id}: не в канале`);
}

// ═══ 11. Детали с постоянными номерами (боевая зона, будущие разрушения) ═══
{
  const spec = { id: 'w_test', x: 10, z: 20, w: 12, d: 8, h: 4, wall: '#abc', doors: [{ side: 'n', at: 0, w: 2.4 }], windows: [{ side: 's', at: -3, w: 2 }, { side: 'e', at: 0, w: 2 }] };
  const A = MZ.modular(spec), B = MZ.modular(spec);
  ok(A.length > 30 && JSON.stringify(A.map(p => p.id)) === JSON.stringify(B.map(p => p.id)), 'детали здания: номера одинаковые при каждой постройке', A.length);
  ok(new Set(A.map(p => p.id)).size === A.length, 'номера деталей не повторяются');
  ok(A.every(p => /^w_test:(floor|wall|window|lintel|sill|pillar|roof|parapet):\d+$/.test(p.id) && p.b === 'w_test' && p.destructible === true), 'номер = здание:вид:n, можно ломать');
  ok(A.every(p => p.x >= 10 - 6.5 && p.x <= 10 + 6.5 && p.z >= 20 - 4.5 && p.z <= 20 + 4.5 && p.w > 0 && p.h > 0 && p.d > 0), 'детали — в границах здания');
  ok(A.filter(p => p.kind === 'window').length === 2 && A.filter(p => p.kind === 'window').every(p => p.glass), 'окна — стеклом (2)');
  const wallN = A.filter(p => p.side === 'n' && p.kind === 'wall'), doorGap = wallN.some(p => Math.abs(p.x - 10) < 1.2);
  ok(wallN.length >= 2 && !doorGap, 'на месте двери стены нет');
  ok(MZ.modular({ ...spec, destructible: false }).every(p => !p.destructible), 'неразрушаемое — помечено');
  // группа деталей (крыша изнутри): прячет и возвращает, как Object3D.visible
  const calls = [], mesh = { setMatrixAt: (i, m) => calls.push([i, m]), instanceMatrix: {} };
  const P2 = [{ inst: { mesh, i: 0, zero: 'Z' }, m4: 'M0' }, { inst: { mesh, i: 1, zero: 'Z' }, m4: 'M1', broken: true }];
  const G = MZ.pieceGroup(P2);
  G.visible = false; ok(calls.length === 2 && calls.every(c => c[1] === 'Z') && G.visible === false, 'группа деталей прячется');
  calls.length = 0; G.visible = true; ok(calls[0][1] === 'M0' && calls[1][1] === 'Z', 'возвращается — сломанные остаются спрятанными');
}

// ═══ 12. Постройка зон «вхолостую» (подменный набор K): без ошибок; детали — только в боевой зоне ═══
{
  const deep = (nm = 'x') => {
    const f = function(){};
    return new Proxy(f, {
      get(t, k){ if (k === Symbol.toPrimitive) return () => 0; if (k === 'valueOf') return () => 0; if (k === Symbol.iterator) return function*(){}; if (k === 'then') return undefined; if (k in t) return t[k]; return (t[k] = deep(nm + '.' + String(k))); },
      apply(){ return deep(nm + '()'); }, construct(){ return deep('new ' + nm); }, set(t, k, v){ t[k] = v; return true; },
    });
  };
  const runZone = zone => {
    const pieces = [], lazies = [], npcs = [], lifts = {}, towers = [];
    const tgt = { E, Z: ZONES[zone], M: deep('M'), lifts, roofs: [], npcs, items: [], seats: [], bodies: [], yo: 0, pieceList: pieces,
      piece: o => { const p = { ...o, zone, destructible: o.destructible !== false }; pieces.push(p); return p; },
      lazy: (x, z, r, gen, y) => lazies.push({ x, z, r, gen, y }),
      addLift: (id, name, stops) => (lifts[id] = { name, stops }),
      npc: o => { npcs.push(o); return o; },
      tower: spec => { if (spec.door) towers.push(spec); return deep('tower'); } };
    const K = new Proxy(tgt, { get: (t, k) => (k in t ? t[k] : (t[k] = deep('K.' + String(k)))), set: (t, k, v) => { t[k] = v; return true; } });
    tgt.mbuilding = spec => { const list = MZ.modular(spec).map(o => K.piece(o)); return { list, roof: MZ.pieceGroup(list) }; };
    let err = null;
    try { for (const _ of MZ.DEFS[zone].build(K)); for (const L of lazies) L.gen(K); } catch (e) { err = e; }
    return { err, pieces, lazies, npcs, lifts, towers };
  };
  const res = {};
  for (const z of ['kids', 'metro', 'war']) {
    res[z] = runZone(z);
    ok(!res[z].err, `${z}: постройка без ошибок`, res[z].err && String(res[z].err.stack || res[z].err).split('\n').slice(0, 3).join(' | '));
  }
  ok(res.kids.pieces.length === 0 && res.metro.pieces.length === 0, 'детский и взрослый город — без разрушаемых деталей');
  const W = res.war.pieces, wid = W.map(p => p.id);
  ok(W.length > 300 && new Set(wid).size === W.length, 'боевая зона — сотни деталей с разными номерами', W.length);
  ok(W.every(p => inRect(ZONES.war, p.x, p.z, 1)), 'детали — внутри боевой зоны');
  ok(W.filter(p => !p.destructible).every(p => p.b === 'w_bunker') && W.some(p => p.b === 'w_bunker'), 'неразрушаемый — только бункер');
  for (const k of ['wall', 'window', 'roof', 'floor', 'bag', 'crate', 'container']) ok(W.some(p => p.kind === k), 'в боевой зоне есть детали: ' + k);
  const W2 = runZone('war').pieces.map(p => p.id);
  ok(JSON.stringify(W2) === JSON.stringify(wid), 'номера деталей боевой зоны одинаковые при каждой постройке (у всех игроков)');
  for (const id of ['m_mall', 'm_tv']) ok(res.metro.lifts[id]?.stops?.length >= 2, `лифт ${id}: остановки`);
  ok(res.metro.lazies.length >= 3, 'интерьеры Большого города — ленивые (ТЦ, смотровая; этажи башен — в K.towerIn)', res.metro.lazies.length);
  ok(res.metro.npcs.length >= 15, 'жители Большого города', res.metro.npcs.length);
  globalThis.__INT_TOWERS = [...res.metro.towers, ...res.kids.towers];
}

// ═══ 13. Интерьеры (js/engine/interior.js): в каждое здание можно зайти — этажи по зерну, у всех одинаковые ═══
{
  const I = E.interior, T = globalThis.__INT_TOWERS || [];
  ok(I && typeof I.plan === 'function' && typeof I.mount === 'function', 'генератор интерьеров подключён');
  const want = ['m_city1', 'm_city2', 'm_city3', 'm_pharm', 'm_books', 'm_gym', 'm_flat1', 'm_flat2', 'm_flat3', 'm_hotel', 'm_tower', 'm_office5', 'm_h1', 'm_h2', 'k_flats'];
  for (const id of want) ok(T.some(b => b.id === id), 'здание с интерьером: ' + id);
  // все здания городов теперь входимые: свои интерьеры (K.building) или генератор
  const hand = new Set(['m_police', 'm_court', 'm_hall', 'm_bank', 'm_hosp', 'm_cars', 'm_taxi', 'm_shop', 'm_rest', 'm_coffee', 'm_flowers', 'm_wash', 'm_fire', 'm_mall', 'm_tv', 'm_park', 'k_school', 'k_hosp', 'k_fire', 'k_bake', 'k_ice', 'k_pets', 'k_h1', 'k_h2', 'k_h3', 'k_h4', 'k_hall']);
  for (const b of [...MZ.buildings('metro'), ...MZ.buildings('kids')]) if (b.h > 0 && b.type !== 'service' || b.sub === 'gym') if (b.h > 0 && !['m_gas'].includes(b.id)) ok(hand.has(b.id) || T.some(q => q.id === b.id), `${b.id}: можно зайти`);
  const rnd = (s => () => (s = (s * 48271) % 2147483647) / 2147483647)(11);
  const ph = new E.Phys({ ground: 0 });
  for (const b of T) {
    const P = I.plan(b), F = I.frame(b);
    ok(P.n >= 2 && P.n <= 50, `${b.id}: этажей ${P.n}`);
    if (b.style) ok(Math.abs((P.top - P.base0) / P.fh - Math.round((P.top - P.base0) / P.fh)) < .02, `${b.id}: этажи совпадают с рядами окон фасада`);
    for (const k of [0, 1, Math.floor(P.n / 2), P.n - 1]) {
      if (k === 0 && b.skip0) continue;
      const fp = I.floorPlan(b, k), fp2 = I.floorPlan(b, k);
      ok(JSON.stringify(fp, (key, v) => key === 'F' ? undefined : v) === JSON.stringify(fp2, (key, v) => key === 'F' ? undefined : v), `${b.id}/${k}: план одинаковый у всех (по зерну)`);
      const t = fp.tier, inside = (x, z, m = 0) => Math.abs(x - b.x) <= t.w / 2 + m && Math.abs(z - b.z) <= t.d / 2 + m;
      ok(fp.rooms.length >= 1 && fp.rooms.every(q => inside(q.x0, q.z0, .01) && inside(q.x1, q.z1, .01)), `${b.id}/${k}: комнаты внутри этажа`);
      ok(fp.furniture.every(f => inside(f.x, f.z, -.05)), `${b.id}/${k}: мебель — внутри`, fp.furniture.filter(f => !inside(f.x, f.z, -.05)).map(f => f.t));
      ok(fp.doors.every(d => inside(d.x, d.z) && Number.isFinite(d.yaw) && Math.hypot(d.ix, d.iz) > .99), `${b.id}/${k}: двери в стенах, открываются в комнату`);
      if (P.n > 1) ok(fp.landing && inside(fp.landing.x, fp.landing.z, -.3), `${b.id}/${k}: площадка лифта внутри`);
      ok(I.where(b, b.x, fp.y + .1, b.z) === k, `${b.id}/${k}: «где я» — этот этаж`);
      if (k === 0) ok(fp.windows.some(w => w.door), `${b.id}: вход на первом этаже — дверь в стене`);
      ok(fp.furniture.length > 0 || fp.custom, `${b.id}/${k}: есть мебель (${fp.kind})`);
    }
    // оболочка: у двери — проход, у стен — нет
    const L = I.shell(b).map(sb => ph.addBox({ ...sb, tag: 'shell' }));
    if (!b.shellFrom) {
      const D = b.door, hw = b.w / 2, hd = b.d / 2, [dx, dz] = D.side === 'n' ? [b.x + (D.at || 0), b.z - hd] : D.side === 's' ? [b.x + (D.at || 0), b.z + hd] : D.side === 'e' ? [b.x + hw, b.z + (D.at || 0)] : [b.x - hw, b.z + (D.at || 0)];
      ok(!ph.blocked(dx, dz, .2, 2, .35), `${b.id}: в дверь можно войти`);
      ok(!!ph.blocked(b.x + (D.side === 'e' || D.side === 'w' ? 0 : hw - .15), b.z + (D.side === 'e' || D.side === 'w' ? hd - .15 : 0), .2, 2, .2), `${b.id}: стены сплошные`);
    }
    for (const c of L) ph.remove(c);
  }
  // разные здания — разные этажи; свой интерьер — без мебели генератора; запертые двери — в полиции и банке
  const a1 = I.floorPlan(T.find(b => b.id === 'm_flat1'), 3), a2 = I.floorPlan(T.find(b => b.id === 'm_flat2'), 3);
  ok(JSON.stringify(a1.rooms.map(q => q.x1 - q.x0)) !== JSON.stringify(a2.rooms.map(q => q.x1 - q.x0)), 'у разных домов — разная планировка');
  const own = { ...T.find(b => b.id === 'm_flat1'), custom: true };
  ok(I.floorPlan(own, 2).furniture.length === 0, 'свой интерьер (купленное место): мебели генератора нет');
  const pol = { id: 'gen_police', type: 'public', sub: 'police', x: 0, z: 0, w: 20, d: 14, h: 6.4, door: { side: 's', at: 0 } };
  const bank = { id: 'gen_bank', type: 'public', sub: 'bank', x: 0, z: 0, w: 18, d: 14, h: 6.4, door: { side: 's', at: 0 } };
  ok(I.floorPlan(pol, 0).doors.some(d => d.kind === 'bars' && d.locked), 'полиция: камеры с решёткой — заперты');
  ok(I.floorPlan(bank, 1).doors.some(d => d.kind === 'vault' && d.locked) || I.floorPlan(bank, 0).kind === 'bank', 'банк: хранилище заперто');
  for (const t of ['office', 'apartment', 'shop', 'cafe', 'hotel', 'factory', 'parking', 'house']) {
    const b = { id: 'gen_' + t, type: t, x: 0, z: 0, w: 18, d: 14, h: 9.6, door: { side: 'e', at: 1 } };
    const fp = I.floorPlan(b, 0); ok(fp.rooms.length && (fp.furniture.length || t === 'house'), `тип ${t}: первый этаж — ${fp.kind}`);
  }
}

// ═══ 14. Транспорт в мире (js/games/mir-veh.js + js/engine/vehicle*.js; физика — scripts/vehicle-test.cjs) ═══
{
  const VE = E.vehicle, L = globalThis.MirVeh.spots(), ID_RE = /^[a-z][a-z0-9_]{0,15}$/;
  ok(L.length >= 15, 'машин в мире — не меньше 15 (боевая зона, город, детский городок)', L.length);
  ok(new Set(L.map(s => s.id)).size === L.length, 'номера машин — разные');
  for (const sp of L) {
    const d = VE.get(sp.def), Zn = ZONES[sp.zone];
    ok(!!d, `${sp.id}: есть описание ${sp.def}`);
    if (!d) continue;
    ok(ID_RE.test(sp.id), `${sp.id}: номер годится для zx.v (сеть)`);
    ok(Zn && inRect(Zn, sp.x, sp.z, -2), `${sp.id}: стоит в своей зоне`, [sp.x, sp.z]);
    if (sp.area) ok(sp.area === sp.zone, `${sp.id}: «только в зоне» — своя зона`);
    ok(d.age <= (Zn?.age ?? 0) || sp.zone === 'war', `${sp.id}: возраст машины (${d.age}+) не выше зоны`);
    const wl = MZ.water(sp.x, sp.z), floor = MZ.terrain(sp.x, sp.z);
    if (d.kind === 'boat') ok(wl > -Infinity && wl - floor > d.water.draft + .3, `${sp.id}: лодка — на воде, глубоко`, [wl, floor]);
    else ok(wl === -Infinity, `${sp.id}: ${d.kind} — на суше`);
    if (sp.zone === 'war') ok(!MW.inPlot(sp.x, sp.z, 2) && !MW.inPlot(sp.x + 4, sp.z, 0) && !MW.inPlot(sp.x - 4, sp.z, 0), `${sp.id}: не на участке базы`);
    if (d.kind === 'car') {
      const blds = MZ.buildings(sp.zone).filter(b => b.h > 0 && b.type !== 'park' && b.type !== 'lot' && b.type !== 'parking');
      ok(!blds.some(b => Math.abs(sp.x - b.x) < b.w / 2 && Math.abs(sp.z - b.z) < b.d / 2), `${sp.id}: не в стене здания`);
    }
  }
  ok(L.some(s => s.def === 'plane') && L.some(s => s.def === 'heli') && L.some(s => VE.get(s.def)?.kind === 'boat') && L.some(s => VE.get(s.def)?.kind === 'car'), 'все 4 вида: машины, лодки, вертолёты, самолёт');
  const pl = L.find(s => s.def === 'plane'), RW = MW.AIR.runway;
  ok(pl && inRect(RW, pl.x, pl.z, 1) && Math.abs(Math.sin(pl.yaw)) > .99, 'самолёт — на полосе, нос вдоль полосы');
  // сеть: место в машине проходит белый список zx
  ok(JSON.stringify(MZ.cleanZX({ v: ['w_jeep1', 0] })) === '{"v":["w_jeep1",0]}' && MZ.cleanZX({ v: ['Плохо', 0] }) === null, 'zx.v [машина, место] — проходит, чужое — нет');
  // снимок машины мира туда-обратно и проверка скорости
  const v = VE.create('jeep', { id: 'w_jeep1', x: -80, z: 300 }), a = VE.unpack(VE.pack(v));
  ok(a && VE.snapOk(v.def, a, { ...a, x: a.x + 3 }, .2) === null && VE.snapOk(v.def, a, { ...a, x: a.x + 300 }, .2) === 'speed', 'снимок джипа и проверка скорости');
}

// ═══ 15. Город-симулятор: жители по расписанию (дом → работа → магазин → дом по часам мира) ═══
{
  for (const zid of ['metro', 'kids']) {
    const L = MZ.residents(zid), L2 = MZ.residents(zid), B = id => MZ.building(id);
    ok(L.length >= 10 && L === L2, `${zid}: жители есть и одни и те же (по зерну)`, L.length);
    ok(new Set(L.map(r => r.id)).size === L.length, `${zid}: номера жителей — разные`);
    ok(L.every(r => ['apartment', 'house'].includes(B(r.home)?.type) && B(r.work) && B(r.shop)), `${zid}: дом — жильё, работа и магазин — из таблицы зданий`);
    ok(L.every(r => [r.hs, r.ws, r.ss].every(([x, z]) => inRect(ZONES[zid], x, z, 6))), `${zid}: места жителей — в зоне`);
    ok(L.every(r => [[r.home, r.hs], [r.work, r.ws], [r.shop, r.ss]].every(([id, [x, z]]) => { const b = B(id); return Math.abs(x - b.x) > b.w / 2 || Math.abs(z - b.z) > b.d / 2; })), `${zid}: место у входа — снаружи здания`);
    const R = L[0], ph = h => MZ.residentAt(R, h + R.shift).phase;
    ok(ph(3) === 'home' && ph(7.7) === 'go' && ph(12) === 'work' && ph(18) === 'shop' && ph(21) === 'walk' && ph(23) === 'home', `${zid}: день жителя — дом, дорога, работа, магазин, прогулка, дом`);
    const at = MZ.residentAt(R, 12 + R.shift);
    ok(Math.hypot(at.x - R.ws[0], at.z - R.ws[1]) < 5, `${zid}: днём — у работы`);
    const busy = h => L.filter(r => MZ.residentAt(r, h).phase !== 'home').length;
    ok(busy(12) > L.length * .7 && busy(3) < L.length * .2, `${zid}: днём город живой, ночью улицы пустые`, [busy(12), busy(3)]);
  }
  ok(MZ.residents('war').length === 0, 'в боевой зоне жителей нет');
}

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

// Тесты зон «Мира Денчика» (js/games/mir-zones.js, mir-city.js, mir-war.js, js/engine/vehicle.js) в node:
// геометрия карты (зоны не пересекаются, всё связано дорогами и телепортами, место под рост района участков свободно),
// возрастные ворота, правила боя (урон только в зоне, заявки проверяет пострадавший, захват точек, награды), задания ролей
// и лимиты монет (клиент = coins.sql / games-more.sql), состояние игрока по сети (zx), карта, транспорт (если есть vehicle.js).
// Запуск из корня сайта: node scripts/world-zones-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/games/mir-zones.js', 'js/games/mir-city.js', 'js/games/mir-war.js']) load(f);
const hasVeh = fs.existsSync(path.join(SITE, 'js/engine/vehicle.js'));
if (hasVeh) load('js/engine/vehicle.js');
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
  ok(MZ.terrain(-300, 250) === SEA.floor && MZ.water(-300, 250) === SEA.wl && MZ.water(-200, 250) === -Infinity, 'море: дно и вода');
  ok(MZ.terrain(-173, 187) === BUNKER.floor && MZ.terrain(-140, 187) === 0 && MZ.terrain(0, 0) === 0, 'бункер: пол ниже земли, вокруг — ровно');
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

// ═══ 10. Транспорт (js/engine/vehicle.js) ═══
if (hasVeh && E.vehicles) require(path.join(__dirname, 'vehicle-test-part.cjs'))({ E, MZ, MW, ok, near });
else console.log('  (vehicle.js ещё нет — проверки транспорта пропущены)');

console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

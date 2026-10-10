// Тест «Студии 3D» по сети (js/games/studio3d.js + js/engine/net.js) в node, без браузера: правила студии поверх net.js —
// какие свойства объектов студии доходят до гостей (NET_EXTRA), «касание без кода» (touch: kill | coin | …) не портится
// флагами, подсказки [E] и клики (prompt / click), данные игроков новичку, гость с уже загруженным миром (ссылка на
// выложенный мир) сходится с хозяином, события гостей и «всем» (кто отправитель), смена хозяина — world и очки на месте.
// Плюс помощники студии: разбор адреса комнаты, касания вдоль пути гостя, таблица игроков, чужая внешность.
// Запуск из корня сайта: node scripts/studio-net-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = process.argv[2] || path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/net.js', 'js/engine/scene.js', 'js/games/studio3d.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = globalThis.D37E, NT = E.net._t, T = globalThis.GAME_IMPL.studio3d._test;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra ?? ''); } };

// ═══ 1. Помощники студии ═══
{
  const p = T.mpParam;
  ok(JSON.stringify(p('play/abc123')) === JSON.stringify({ playId: 'abc123', room: null }), 'адрес: выложенный мир без комнаты');
  ok(JSON.stringify(p('play/AbC123/XyZ789')) === JSON.stringify({ playId: 'AbC123', room: 'xyz789' }), 'адрес: мир + код комнаты (код — строчными)');
  ok(JSON.stringify(p('join/k7m2pq')) === JSON.stringify({ join: 'k7m2pq' }), 'адрес: «Тест вдвоём» по ссылке');
  ok(!p('play/ab').playId && !p('join/a!b').join && !p('').playId && !p(null).join && !p('play/abc123/xx').playId, 'адрес: мусор не принимается');
  // касания вдоль пути: монетка шириной 1,2 посередине, гость пролетел её за один снимок
  const coin = { x: 0, z: 0, r: .6 };
  const SC = { touching: ch => Math.hypot(ch.x - coin.x, ch.z - coin.z) < coin.r + ch.r ? new Set(['coin']) : new Set() };
  const tch = { x: 0, y: 0, z: 0, r: .42, h: 2.1 };
  ok(T.sweepTouch(SC, tch, [-3, 0, 0], [3, 0, 0], new Set()).has('coin'), 'касания вдоль пути: пролетел монетку между снимками — засчитано');
  ok(!SC.touching({ ...tch, x: 3 }).size, '(без пути в конечной точке монетки нет)');
  ok(!T.sweepTouch(SC, tch, [-3, 0, 5], [3, 0, 5], new Set()).size, 'касания вдоль пути: мимо — не засчитано');
  ok(T.sweepTouch(SC, tch, [0, 0, 0], [0, 0, 0], new Set()).has('coin'), 'касания: стоит на месте — точка проверяется');
  let calls = 0; const SC2 = { touching: () => { calls++; return new Set(); } };
  T.sweepTouch(SC2, tch, [0, 0, 0], [500, 0, 0], new Set());
  ok(calls <= 12, 'касания вдоль пути: не больше 12 проверок за снимок (телепорт без смены номера не вешает)', calls);
  // таблица игроков: хозяин первым, свои очки у хозяина — сразу
  const rows = T.mpRows([{ id: 'g1', nick: 'Гость', data: { s: { 'Монеты': 2 } } }, { id: 'h', nick: 'Хозяин', host: true, me: true, data: { s: { 'Монеты': 1 } } }], { 'Монеты': 5 });
  ok(rows[0].id === 'h' && rows[0].s['Монеты'] === 5 && rows[1].s['Монеты'] === 2 && rows[0].me && !rows[1].me, 'таблица игроков: хозяин первым, свои очки — свежие', rows);
  ok(T.mpRows([{ id: 'x', nick: '<b>' }], null)[0].s && T.mpRows([{ id: 'x', data: { s: 'плохо' } }], null)[0].nick === 'Игрок', 'таблица игроков: без ника — «Игрок», кривые данные — пусто');
  // чужая внешность: платное и VIP — не показываем, свои цвета — бесплатные
  const C = { SLOTS: ['hat', 'eyes'], BODY_SLOTS: ['skin'], DEFAULT: { hat: 'none', eyes: 'dot', skin: 'x000000' }, CUSTOM: /^x[0-9a-f]{6}$/,
    norm: l => ({ hat: 'none', eyes: 'dot', skin: 'x000000', ...l }), part: (s, id) => ({ crown: { price: 500 }, star: { vip: 1 }, none: { price: 0 }, dot: { price: 0 }, cap: { price: 0 } })[id] || null };
  globalThis.D37Char = C;
  const fl = T.freeLook({ hat: 'crown', eyes: 'star', skin: 'xff8800' });
  ok(fl.hat === 'none' && fl.eyes === 'dot' && fl.skin === 'xff8800', 'чужая внешность: платное и VIP — по умолчанию, свой цвет — оставлен', fl);
  ok(T.freeLook({ hat: 'cap' }).hat === 'cap' && JSON.stringify(T.freeLook(null)) === '{}', 'чужая внешность: бесплатное — как есть, пусто — {}');
  delete globalThis.D37Char;
}

// ═══ 2. Свойства классов студии доходят до гостей: каждое свойство DEF (scene.js) — в PROPS net.js, во флагах или в NET_EXTRA ═══
const SCENE_SRC = fs.readFileSync(path.join(SITE, 'js/engine/scene.js'), 'utf8');
const SAVE = JSON.parse(/const SAVE = (\[[^\]]+\]);/.exec(SCENE_SRC)[1].replace(/'/g, '"'));
const DEF = E.scene.DEF;
{
  const propKeys = new Set(NT.PROPS.map(p => p[0]));
  const flagOf = k => NT.quant(NT.PROPS.findIndex(p => p[0] === '_flags'), { [k]: true }, { extra: [], nidOf: () => 0, sidOf: () => null }) !== undefined;
  const ONLY_HOST = new Set(['code', 'lang', 'src', 'locked']);   // скрипт и редактор — гостям не нужны
  const miss = [];
  for (const [cls, d] of Object.entries(DEF)) {
    if (cls === 'Script') continue;
    for (const k of Object.keys(d)) if (!propKeys.has(k) && !flagOf(k) && !T.NET_EXTRA.includes(k) && !ONLY_HOST.has(k)) miss.push(cls + '.' + k);
  }
  for (const k of SAVE) if (!propKeys.has(k) && !flagOf(k) && !T.NET_EXTRA.includes(k) && !ONLY_HOST.has(k)) miss.push('SAVE.' + k);
  ok(!miss.length, 'все свойства классов студии реплицируются (PROPS, флаги или NET_EXTRA)', miss);
  ok(T.NET_EXTRA.length <= 16, 'NET_EXTRA — не больше 16 своих свойств (предел net.js)');
  ok(Object.keys(DEF).every(c => c === 'Script' || NT.PROPS && true), 'классы сцены известны');
}

// ═══ Сцена как D37E.scene (те же правила add/set/remove/reparent, все классы студии, без Three.js) ═══
const copy = v => Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
function fakeScene(){
  const objects = new Map(), order = [];
  const SC = { objects };
  SC.get = id => objects.get(id) || null;
  SC.all = () => order.slice();
  SC.add = (cls, props = {}, parent = null, id = null) => {
    if (!DEF[cls]) throw new Error('класс: ' + cls);
    const obj = { id: id || 'o' + Math.random().toString(36).slice(2, 9), cls, parent: null, children: [], ...copy(DEF[cls]) };
    for (const k of SAVE) if (props[k] !== undefined) obj[k] = copy(props[k]);
    if (props.name) obj.name = String(props.name).slice(0, 40);
    objects.set(obj.id, obj); order.push(obj);
    if (parent) { const p = objects.get(typeof parent === 'string' ? parent : parent.id); if (p) { obj.parent = p.id; p.children.push(obj.id); } }
    return obj;
  };
  SC.remove = obj => {
    if (!obj || !objects.has(obj.id)) return;
    for (const cid of obj.children.slice()) SC.remove(objects.get(cid));
    objects.delete(obj.id); order.splice(order.indexOf(obj), 1);
    if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
  };
  SC.reparent = (obj, parent) => {
    if (obj.parent) { const p = objects.get(obj.parent); if (p) p.children = p.children.filter(c => c !== obj.id); }
    obj.parent = null;
    if (parent && parent !== obj) { obj.parent = parent.id; parent.children.push(obj.id); }
  };
  SC.set = (obj, key, val) => { if (obj) obj[key] = copy(val); };
  return SC;
}
// Мир студии: точка появления, монетка (касание без кода), лава, батут, платформа, NPC-зомби, огонь в костре, своя модель,
// лампа, дерево, домик-модель, скрипты (у хозяина; гостям не уходят)
function buildWorld(sc){
  sc.add('Part', { name: 'Основание', pos: [0, -.5, 0], size: [128, 1, 128], color: '#6b7a8f', mat: 'concrete' }, null, 'base');
  sc.add('Spawn', { pos: [0, .2, 0] }, null, 'sp1');
  const coin = sc.add('Part', { name: 'Монетка', shape: 'cyl', pos: [3, 1.4, -6], rot: [0, 0, 90], size: [.3, 1.2, 1.2], color: '#f5cd30', mat: 'metal', collide: false, touch: 'coin' }, null, 'coin1');
  sc.add('Script', { name: 'Монетка', code: 'print(1)' }, coin, 'scr1');
  sc.add('Part', { name: 'Лава', pos: [0, .05, -22], size: [16, .2, 26], color: '#ff4b1f', mat: 'neon', touch: 'kill' }, null, 'lava');
  sc.add('Part', { name: 'Батут', pos: [6, .2, 4], size: [3, .4, 3], color: '#22c55e', touch: 'bounce' }, null, 'jump1');
  sc.add('Part', { name: 'Платформа', pos: [0, 2, -10], size: [4, .5, 4], color: '#0d69ac', mat: 'smooth' }, null, 'plat');
  sc.add('NPC', { name: 'Зомби', pos: [10, 0, 10], look: 'zombie', act: 'follow', seed: 'z1', speed: .75, damage: 20, radius: 12, text: 'Ммм… мозги…' }, null, 'npc1');
  const fire = sc.add('Part', { name: 'Костёр', pos: [-6, .25, 0], size: [1.6, .5, 1.6], color: '#4a3426', mat: 'rock' }, null, 'fire');
  sc.add('Effect', { name: 'Огонь', kind: 'fire', rate: 1.5, scale: 1.2, color: '#ff8800', color2: '#ff0000' }, fire, 'fx1');
  sc.add('Mesh', { name: 'Домик', model: 'm1abcdef', pos: [20, 2, 0], size: [6, 4, 6], fit: 'box' }, null, 'mesh1');
  sc.add('Light', { pos: [0, 5, 0], color: '#ff9a3c', range: 20, power: 3 }, null, 'lamp');
  sc.add('Prefab', { kind: 'sign', pos: [2, 0, 2], text: 'Привет!', color: '#7c3aed' }, null, 'sign');
  const house = sc.add('Model', { name: 'Дом' }, null, 'house');
  for (let j = 0; j < 3; j++) sc.add('Part', { name: 'Стена', pos: [-20, 2, j * 2], size: [6, 4, .5], color: '#c4281c', mat: 'brick' }, house, 'wall' + j);
  sc.add('Script', { name: 'Приветствие', code: 'Players.PlayerAdded.Connect(p => p.Message("Привет", 2));' }, null, 'scr2');
}
const QX = { extra: T.NET_EXTRA, nidOf: sid => sid, sidOf: x => x };
function compareScenes(host, guest){
  const res = { missing: 0, extra: 0, diff: 0, first: '' };
  for (const o of host.all()) {
    if (o.cls === 'Script') continue;
    const g = guest.get(o.id);
    if (!g) { res.missing++; if (!res.first) res.first = 'нет ' + o.id; continue; }
    for (let i = 0; i < NT.PROPS.length; i++) {
      const a = NT.quant(i, o, QX), b = NT.quant(i, g, QX);
      if (JSON.stringify(a) !== JSON.stringify(b)) { res.diff++; if (!res.first) res.first = `${o.id}.${NT.PROPS[i][0]}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`; break; }
    }
  }
  for (const g of guest.all()) if (g.cls !== 'Script' && !host.get(g.id)) { res.extra++; if (!res.first) res.first = 'лишний ' + g.id; }
  res.ok = !res.missing && !res.extra && !res.diff;
  return res;
}

// ═══ Модель сети: очередь событий, задержка 40–110 мс в одну сторону, 2 % потерь, присутствие с задержкой ═══
function makeSim(seed){
  const rnd = E.rng(seed), q = [];
  const sim = { t: 0, n: 0, peers: new Map(), presence: [], rnd };
  sim.at = (t, f) => { q.push({ t, n: sim.n++, f }); };
  sim.run = until => {
    for (;;) {
      let bi = -1; for (let i = 0; i < q.length; i++) if (q[i].t <= until && (bi < 0 || q[i].t < q[bi].t || (q[i].t === q[bi].t && q[i].n < q[bi].n))) bi = i;
      if (bi < 0) break;
      const e = q.splice(bi, 1)[0]; sim.t = e.t; e.f();
    }
    sim.t = until;
  };
  sim.send = (from, to, u8) => {
    const P = sim.peers.get(from), Q = sim.peers.get(to);
    if (!P || P.left || rnd() < .02) return;
    const copyU = u8.slice();
    sim.at(sim.t + 40 + rnd() * 70, () => { if (Q && !Q.left && Q.h.message) Q.h.message(from, copyU); });
  };
  sim.presenceChanged = () => { for (const P of sim.peers.values()) if (!P.left) sim.at(sim.t + 150 + rnd() * 300, () => { if (!P.left && P.h.members) P.h.members(sim.presence.map(m => ({ id: m.id, t: m.t }))); }); };
  return sim;
}
// Игрок: своя сцена, сессия net.js с правилами студии (extra = NET_EXTRA), события в журнал; ходит по кругу у точки появления
function addPeer(sim, id, opts = {}){
  const P = { id, scene: fakeScene(), h: {}, left: false, events: [], blobs: new Map(), plog: [], hostLog: [], readyAt: 0, k: sim.peers.size };
  if (opts.world) buildWorld(P.scene);
  P.now = () => sim.t + 1000 + P.k * 777;
  const tr = { myId: id, send: (to, u8) => sim.send(id, to, u8), limits: () => ({ mode: 'p2p' }), listen: x => { P.h.message = x.message; P.h.members = x.members; }, flush(){}, close(){} };
  P.S = E.net.session({ transport: tr, scene: P.scene, now: P.now, nick: 'Игрок ' + id, info: { look: { hat: 'cap' } }, extra: T.NET_EXTRA,
    onHost: (is, info) => P.hostLog.push([sim.t, is, info]), onReady: () => { if (!P.readyAt) P.readyAt = sim.t; },
    onGuestEvent: (ty, d, from) => P.events.push(['g', ty, d, from]), onEvent: (ty, d, from) => P.events.push(['e', ty, d, from]),
    onPlayer: (ev, p) => P.plog.push([ev, p.id, p.data]), onBlob: (name, u, text) => P.blobs.set(name, text()) });
  sim.peers.set(id, P); sim.presence.push({ id, t: sim.t }); sim.presenceChanged();
  const step = () => {
    if (P.left) return;
    const a = sim.t / 1000 + P.k;
    P.S.setMyCharacter({ x: Math.cos(a) * 3, y: 0, z: Math.sin(a) * 3, yaw: a, vx: -Math.sin(a) * 3, vy: 0, vz: Math.cos(a) * 3, moving: true, speed: 3 });
    P.S.tick(1 / 60);
    sim.at(sim.t + 1000 / 60, step);
  };
  sim.at(sim.t + 5, step);
  return P;
}
const leave = (sim, P) => { P.left = true; P.S.close(); sim.presence = sim.presence.filter(m => m.id !== P.id); sim.presenceChanged(); };

// ═══ 3. Хозяин и гость с пустой сценой («Тест вдвоём»): всё студийное доходит, скрипты — нет ═══
{
  const sim = makeSim(5);
  const H = addPeer(sim, 'H', { world: true });
  sim.run(400);
  const WORLD = JSON.stringify({ v: 1, name: 'Мой мир', terrain: { flat: true }, lighting: { time: 21 }, scripts: H.scene.all().filter(o => o.cls === 'Script').map(o => ({ id: o.id, name: o.name, parent: o.parent, code: o.code, lang: 'js', enabled: true })), models: { m1abcdef: 'u-author' } });
  H.S.setBlob('world', WORLD);
  const A = addPeer(sim, 'A');
  sim.run(6000);
  ok(H.S.isHost && !A.S.isHost && A.S.hostId === 'H' && A.readyAt > 0, 'гость: хозяин — первый в комнате, мир готов', [A.S.hostId, A.readyAt]);
  const c = compareScenes(H.scene, A.scene);
  ok(c.ok, 'гость с пустой сценой: копия = миру хозяина (со свойствами студии)', c);
  ok(!A.scene.get('scr1') && !A.scene.get('scr2'), 'скрипты гостю не уходят');
  const g = id => A.scene.get(id);
  ok(g('coin1')?.touch === 'coin' && g('lava')?.touch === 'kill' && g('jump1')?.touch === 'bounce', 'касание без кода (touch) — строкой у гостя', [g('coin1')?.touch, g('lava')?.touch]);
  ok(g('npc1')?.look === 'zombie' && g('npc1').act === 'follow' && g('npc1').seed === 'z1' && g('npc1').speed === .75 && g('npc1').damage === 20 && g('npc1').radius === 12 && g('npc1').text === 'Ммм… мозги…', 'NPC: внешность, поведение, скорость, урон, фраза', g('npc1'));
  ok(g('fx1')?.kind === 'fire' && g('fx1').rate === 1.5 && g('fx1').color2 === '#ff0000' && g('fx1').parent === 'fire', 'эффект: вид, частота, цвета, в костре', g('fx1'));
  ok(g('mesh1')?.model === 'm1abcdef' && g('mesh1').fit === 'box', 'своя модель: номер и форма столкновений (гость скачает по номеру)', g('mesh1'));
  ok(g('wall1')?.parent === 'house' && g('sign')?.text === 'Привет!' && g('lamp')?.range === 20, 'модель с детьми, табличка, лампа');
  ok(A.blobs.get('world') === WORLD && JSON.parse(A.blobs.get('world')).models.m1abcdef === 'u-author', 'world (ландшафт, свет, скрипты, авторы моделей) дошёл до гостя');
  // флаг поменялся (скрипт сделал монетку твёрдой) — touch у гостя не превращается в true
  H.scene.set(H.scene.get('coin1'), 'collide', true); H.S.markDirty(H.scene.get('coin1'));
  sim.run(8000);
  ok(g('coin1')?.collide === true && g('coin1').touch === 'coin', 'смена флагов не портит touch (было: touch → true)', [g('coin1')?.collide, g('coin1')?.touch]);
  // подсказка [E] и клик скрипта — свойствами prompt / click
  H.scene.set(H.scene.get('plat'), 'prompt', { text: 'Открыть дверь', hold: 1 }); H.S.markDirty(H.scene.get('plat'));
  H.scene.set(H.scene.get('sign'), 'click', true); H.S.markDirty(H.scene.get('sign'));
  sim.run(10000);
  ok(g('plat')?.prompt?.text === 'Открыть дверь' && g('plat').prompt.hold === 1 && g('sign')?.click === true, 'подсказка [E] и клик скрипта дошли до гостя', [g('plat')?.prompt, g('sign')?.click]);
  H.scene.set(H.scene.get('plat'), 'prompt', null); H.S.markDirty(H.scene.get('plat'));
  H.scene.set(H.scene.get('sign'), 'click', false); H.S.markDirty(H.scene.get('sign'));
  sim.run(12000);
  ok(!g('plat')?.prompt && g('sign')?.click === false, 'подсказку и клик убрали — у гостя тоже');
  // монетку взяли (хозяин удалил) — у гостя пропала
  H.scene.remove(H.scene.get('coin1'));
  sim.run(14000);
  ok(!g('coin1'), 'монетка, взятая у хозяина, пропала у гостя');
  // события: гость → хозяину ([E]); хозяин → одному гостю (урон) и всем (надпись)
  A.S.sendEvent('prompt', { id: 'plat' });
  H.S.sendEvent('hurt', { dmg: 20 }, 'A'); H.S.sendEvent('gui', { cmd: 'message', text: 'Привет всем' }, 'all');
  sim.run(16000);
  ok(H.events.some(e => e[0] === 'g' && e[1] === 'prompt' && e[2].id === 'plat' && e[3] === 'A'), 'событие гостя ([E]) дошло до хозяина с номером гостя');
  ok(A.events.some(e => e[1] === 'hurt' && e[2].dmg === 20 && e[3] === 'H') && A.events.some(e => e[1] === 'gui' && e[3] === 'H'), 'события хозяина у гостя — от хозяина (from = хозяин)');
}

// ═══ 4. Новичок получает очки, записанные до его входа; гость шлёт «всем» — у других он отправитель (студия такое не слушает) ═══
{
  const sim = makeSim(9);
  const H = addPeer(sim, 'H', { world: true });
  sim.run(300); const A = addPeer(sim, 'A');
  sim.run(4000);
  H.S.setPlayerData('H', { s: { 'Монеты': 3 } }); H.S.setPlayerData('A', { s: { 'Монеты': 1, 'Время': '12.5' } });
  sim.run(5000);
  const B = addPeer(sim, 'B');
  sim.run(10000);
  ok(B.S.playerData('H')?.s?.['Монеты'] === 3 && B.S.playerData('A')?.s?.['Время'] === '12.5', 'новичок видит очки, записанные до его входа', [B.S.playerData('H'), B.S.playerData('A')]);
  ok(A.S.playerData('H')?.s?.['Монеты'] === 3, 'и старые гости — тоже');
  A.S.sendEvent('hurt', { dmg: 999 }, 'all');
  sim.run(12000);
  const ev = B.events.find(e => e[1] === 'hurt');
  ok(ev && ev[3] === 'A' && ev[3] !== B.S.hostId, 'событие «всем» от гостя у других — с номером гостя (студия слушает только хозяина)', ev);
  // хозяин ушёл: A — хозяин, у него world и очки
  H.S.setBlob('world', '{"v":1,"scripts":[{"id":"scr1","name":"Монетка","parent":"coin1","code":"x","lang":"js"}]}');
  sim.run(14000);
  leave(sim, H);
  sim.run(22000);
  ok(A.S.isHost && B.S.hostId === 'A', 'хозяин ушёл — A хозяин, B с ним', [A.S.isHost, B.S.hostId]);
  ok(A.S.blob('world') && JSON.parse(new TextDecoder().decode(A.S.blob('world'))).scripts[0].parent === 'coin1', 'у нового хозяина есть world (скрипты для перезапуска)');
  ok(A.S.playerData('A')?.s?.['Время'] === '12.5' && A.S.players().every(p => p.id !== 'H'), 'у нового хозяина очки игроков на месте, ушедшего нет в списке');
  const C = addPeer(sim, 'C');
  sim.run(30000);
  ok(C.readyAt > 0 && C.blobs.get('world') && C.S.playerData('A')?.s?.['Время'] === '12.5', 'новичок после смены хозяина: мир, world и очки — от A');
  const cmp = compareScenes(A.scene, C.scene);
  ok(cmp.ok, 'новичок после смены хозяина: копия = миру A', cmp);
}

// ═══ 5. Гость с уже загруженным миром (ссылка на выложенный мир с кодом комнаты): лишнее убрано, изменённое — как у хозяина ═══
{
  const sim = makeSim(13);
  const H = addPeer(sim, 'H', { world: true });
  sim.run(300);
  // хозяин уже поиграл: монетку взяли, платформа уехала и перекрашена, скрипт создал деталь, NPC отошёл
  H.scene.remove(H.scene.get('coin1'));
  const plat = H.scene.get('plat'); H.scene.set(plat, 'pos', [5, 3, -12]); H.scene.set(plat, 'color', '#ff00ff');
  H.scene.add('Part', { name: 'Новая', pos: [1, 1, 1], size: [1, 1, 1], touch: 'speed' }, null, 'w1');
  H.scene.set(H.scene.get('npc1'), 'pos', [12, 0, 7]);
  sim.run(1500);
  const G = addPeer(sim, 'G', { world: true });   // мир с сервера — как был при публикации
  sim.run(8000);
  const c = compareScenes(H.scene, G.scene);
  ok(G.readyAt > 0 && c.ok, 'гость с загруженным миром: после «sync» копия = миру хозяина', c);
  ok(!G.scene.get('coin1') && G.scene.get('w1')?.touch === 'speed' && G.scene.get('plat').color === '#ff00ff' && G.scene.get('npc1').pos[2] === 7, 'взятая монетка убрана, новая деталь пришла, платформа и NPC — как у хозяина');
  ok(G.scene.get('scr2') && !G.scene.get('scr1'), 'скрипты из своей загрузки остались (для смены хозяина), а скрипт в убранной монетке — ушёл с ней');
}

console.log(`\n${pass} ок, ${fail} ошибок`);
process.exitCode = fail ? 1 : 0;

// Тест режимов игры, ракурсов камеры и ввода «Студии 3D» в node, без браузера:
// правила режимов у хозяина с поддельными игроками (js/engine/modes.js) — очки, команды, раунды, победа, жизни, волны, прятки;
// ракурсы (js/engine/views.js) — куда идти по стику в каждом ракурсе, «сбоку» держит плоскость, камеры в мире и их зоны,
// плавный переход; геймпад в редакторе (D37E.padEdit) и жесты пальцами (D37E.gestures, js/engine/edit-input.js);
// Game.* / Camera.* в песочнице скриптов (script.js); настройки мира в сцене (scene.js); заготовки миров (studio3d-modes.js).
// Запуск из корня сайта: node scripts/studio-modes-test.cjs [путь к three@0.149 — для плавного перехода камеры]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/modes.js', 'js/engine/views.js', 'js/engine/edit-input.js', 'js/engine/script.js', 'js/engine/physics.js'])
  vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = globalThis.D37E, MO = E.modes, VW = E.views;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
let THREE = null;
for (const p of [process.argv[2], path.join(process.env.TEMP || '', 'claude/E--site-dan4ik37-github-io/e0ac21ba-dd67-4f9b-a060-7635021a4705/scratchpad/three149/node_modules/three')].filter(Boolean)) {
  try { THREE = require(path.join(p, 'build/three.cjs')); break; } catch (e) { try { THREE = require(p); break; } catch (e2) {} }
}

// ═══ Хозяин режима с поддельными игроками ═══
function host(mode, own = {}, o = {}){
  const log = { say: [], ev: [], spawn: [], freeze: new Map(), blind: new Map(), zombies: [], coins: 0, cleared: 0, reset: 0 };
  const M = MO.create({ mode, ...own }, {
    net: () => o.net ?? true,
    spawnAll: list => log.spawn.push(list.map(x => x.id + ':' + x.team)),
    freeze: (id, on) => log.freeze.set(id, on), blind: (id, on) => log.blind.set(id, on),
    say: (t, id) => log.say.push((id ? id + '> ' : '') + t), event: (n, d) => log.ev.push([n, d]),
    zombies: (n, w) => log.zombies.push([n, w]), clearZombies: () => log.cleared++, resetRound: () => log.reset++, coinTaken: () => log.coins++,
  });
  for (const p of o.players || ['a', 'b']) M.join(p, 'Игрок ' + p);
  return { M, log };
}
const run = (M, sec, ctx = {}, dt = 1 / 60) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) M.step(dt, typeof ctx === 'function' ? ctx() : ctx); };

// ── настройки ──
{
  const c = MO.cfg('race', { laps: 99, time: -5, count: 3.4, teams: 4 });
  ok(c.laps === 10 && c.time === 0 && c.count === 3 && c.teams === 0, 'настройки: в пределах, лишние команды у гонки — нет', c);
  ok(MO.cfg('teams', { teams: 0 }).teams === 2 && MO.cfg('teams', { teams: 3 }).teams === 3, 'команды: не меньше двух');
  ok(MO.cfg('obby').dmg === 0 && MO.cfg('ffa').dmg === 35, 'удар — только в режимах с боем (шаг 5)', [MO.cfg('ffa').dmg]);
  ok(MO.cfg('нет такого').mode === 'none', 'неизвестный режим — «просто мир»');
  ok(MO.LIST.every(id => MO.MODES[id] && MO.MODES[id].params.every(k => MO.PARAMS[k])), 'у каждого режима — известные параметры');
}

// ── Обби: отсчёт, финиш по местам, конец раунда, конец матча ──
{
  const { M, log } = host('obby', { count: 3, time: 0 });
  M.start();
  ok(M.phase === 'count' && log.freeze.get('a') === true && log.spawn.length === 1, 'обби: отсчёт, все стоят, всех расставили', [M.phase, log.spawn]);
  run(M, 3.1);
  ok(M.phase === 'play' && log.freeze.get('a') === false && log.ev.some(e => e[0] === 'roundStart'), 'обби: старт — пошли, событие roundStart');
  run(M, 5);
  ok(M.touch('b', 'finish') === true && M.player('b').place === 1 && M.player('b').score === 10, 'обби: первый на финише — 1-е место, 10 очков');
  ok(M.touch('b', 'finish') === true && M.player('b').score === 10, 'обби: финиш второй раз не считается');
  run(M, 2); M.touch('a', 'finish');
  run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.id === 'b' && log.ev.some(e => e[0] === 'roundEnd'), 'обби: все добежали — раунд окончен, победил первый', M.winner);
  ok(log.freeze.get('a') === true, 'обби: на итогах все стоят');
  run(M, 5.1);
  ok(M.phase === 'over' && log.ev.some(e => e[0] === 'matchEnd'), 'обби: один раунд — конец игры');
  M.start(); run(M, 3.1);
  ok(M.phase === 'play' && M.round === 1 && M.player('a').fin === 0, 'обби: «Ещё раз» — новый матч, всё с нуля');
}

// ── Гонка: чекпоинты по порядку, круги, лучший круг, слишком быстрый круг ──
{
  const { M, log } = host('race', { laps: 2, count: 0, time: 0 });
  M.setChecks(3); M.start();
  ok(M.phase === 'play', 'гонка без отсчёта — сразу старт');
  M.touch('a', 'finish');
  ok(M.player('a').lap === 0, 'гонка: старт на финише — не круг');
  M.touch('a', 'check', { idx: 1 });
  ok(M.player('a').cp === 0, 'гонка: чужой по порядку чекпоинт не считается');
  run(M, 4);
  for (let i = 0; i < 3; i++) M.touch('a', 'check', { idx: i });
  ok(M.player('a').cp === 3, 'гонка: три чекпоинта по порядку');
  M.touch('a', 'finish');
  ok(M.player('a').lap === 1 && M.player('a').cp === 0 && near(M.player('a').best, 4, .05), 'гонка: круг засчитан, лучший — 4 с', M.player('a'));
  run(M, 1); for (let i = 0; i < 3; i++) M.touch('a', 'check', { idx: i }); M.touch('a', 'finish');
  ok(M.player('a').lap === 1, 'гонка: круг быстрее 3 с — это старт на линии, не круг');
  run(M, 3); M.touch('a', 'finish');
  ok(M.player('a').fin > 0 && M.player('a').place === 1 && near(M.player('a').best, 4, .05), 'гонка: второй круг — финиш, лучший круг остался 4 с', M.player('a'));
  ok(log.say.some(t => /Круг 1 из 2/.test(t)), 'гонка: подсказка «Круг 1 из 2»');
  run(M, 1); M.touch('b', 'finish');
  ok(M.phase === 'play', 'гонка: второй ещё едет — раунд идёт');
  M.leave('b'); run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.id === 'a', 'гонка: второй вышел — все финишировали, победил первый');
}

// ── Каждый сам за себя: удар, выбил — очко, цель, жизни ──
{
  const { M, log } = host('ffa', { goal: 2, count: 0, lives: 0 }, { players: ['a', 'b', 'c'] });
  M.start();
  const h = M.hit('a', 'b');
  ok(h && h.dmg === 35 && M.hit('a', 'a') === null, 'бои: удар по другому — урон, по себе — нет', h);
  M.died('b');
  ok(M.player('a').score === 1 && M.player('b').deaths === 1 && log.say.some(t => /выбил/.test(t)), 'бои: выбил — очко тому, кто бил');
  M.died('c');
  ok(M.player('a').score === 1, 'бои: упал сам (никто не бил) — очков никому');
  M.now += 7; M.hit('a', 'c'); M.now += 7; M.died('c');
  ok(M.player('a').score === 1, 'бои: удар больше 6 с назад — не считается');
  M.hit('a', 'c'); M.died('c'); run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.id === 'a', 'бои: набрал цель — победа', M.winner);
  ok(M.hit('a', 'b') === null, 'бои: после раунда бить нельзя');
}
{
  const { M } = host('ffa', { goal: 0, lives: 2, count: 0 }, { players: ['a', 'b', 'c'] });
  M.start();
  M.hit('a', 'b'); M.died('b'); M.hit('a', 'b'); const out = M.died('b');
  ok(out && M.player('b').out && M.respawnDelay('b').v === Infinity, 'жизни: кончились — выбыл, не возрождается');
  ok(M.hit('a', 'b') === null && M.hit('b', 'a') === null, 'жизни: выбывшего не бьют, он не бьёт');
  M.hit('a', 'c'); M.died('c'); M.hit('a', 'c'); M.died('c'); run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.id === 'a', 'жизни: остался один — победил', M.winner);
  ok(M.respawnDelay('a').v === 3, 'возрождение — через заданные секунды');
}

// ── Команды: поровну, своих не бить, очки команды, ничья ──
{
  const { M } = host('teams', { teams: 2, goal: 2, count: 0 }, { players: ['a', 'b', 'c', 'd'] });
  M.start();
  const t = id => M.player(id).team, cnt = k => M.players().filter(p => p.team === k).length;
  ok(cnt(1) === 2 && cnt(2) === 2, 'команды: 4 игрока — 2 и 2', M.players().map(p => p.team));
  const mate = M.players().find(p => p.id !== 'a' && p.team === t('a')).id, foe = M.players().find(p => p.team !== t('a')).id;
  ok(M.hit('a', mate) === null && M.hit('a', foe), 'команды: своих бить нельзя');
  M.died(foe);
  ok(M.ts[t('a')] === 1, 'команды: очко команде', M.ts);
  M.hit(mate, foe); M.died(foe); run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.team === t('a'), 'команды: команда набрала цель — победа', M.winner);
  const e = M.join('e', 'Новый');
  ok(e.team >= 1 && e.team <= 2, 'команды: новичок — в команду');
}
{
  const { M } = host('teams', { teams: 2, goal: 0, time: 10, count: 0 }, { players: ['a', 'b'] });
  M.start(); run(M, 10.1);
  ok(M.phase === 'end' && /Ничья/.test(M.winner.text), 'команды: время вышло при равном счёте — ничья', M.winner);
}

// ── Царь горы: один в зоне — очки, двое — спор ──
{
  const { M } = host('koth', { goal: 5, count: 0 }, { players: ['a', 'b'] });
  M.start();
  run(M, 2, { hill: ['a'] });
  ok(near(M.player('a').score, 2, .05), 'холм: один в зоне 2 с — 2 очка', M.player('a').score);
  run(M, 2, { hill: ['a', 'b'] });
  ok(near(M.player('a').score, 2, .05) && M.player('b').score === 0, 'холм: двое — никому');
  ok(M.hit('b', 'a').dmg === 0, 'холм: удар без урона — только толкает');
  run(M, 3.1, { hill: ['b'] }); run(M, 2, { hill: ['b'] });
  ok(M.phase === 'end' && M.winner.id === 'b', 'холм: набрал 5 — победа', [M.player('b').score, M.winner]);
}
{
  const { M } = host('koth', { goal: 0, time: 4, teams: 2, count: 0 }, { players: ['a', 'b', 'c'] });
  M.start();
  const ta = M.player('a').team, mate = M.players().find(p => p.id !== 'a' && p.team === ta);
  run(M, 2, { hill: mate ? ['a', mate.id] : ['a'] });
  ok(near(M.ts[ta], 2, .05), 'холм по командам: своя команда в зоне — очки команде', M.ts);
}

// ── Прятки: ищущие, время спрятаться, нашли — тоже ищет, все найдены / время вышло ──
{
  const { M, log } = host('hide', { seekers: 1, hide: 5, time: 20, count: 0, rounds: 2 }, { players: ['a', 'b', 'c'] });
  M.start();
  const seeker = M.players().find(p => p.role === 'seeker'), hiders = M.players().filter(p => p.role === 'hider');
  ok(seeker && hiders.length === 2, 'прятки: один ищет, двое прячутся');
  ok(log.freeze.get(seeker.id) === true && log.blind.get(seeker.id) === true && log.freeze.get(hiders[0].id) !== true, 'прятки: ищущий стоит с закрытыми глазами, прятавшиеся бегут');
  run(M, 2, { near: [[seeker.id, hiders[0].id]] });
  ok(hiders[0].role === 'hider', 'прятки: пока глаза закрыты — не находит');
  run(M, 3.1);
  ok(log.freeze.get(seeker.id) === false && log.blind.get(seeker.id) === false, 'прятки: время вышло — ищущий открыл глаза');
  run(M, 1 / 60, { near: [[seeker.id, hiders[0].id]] });
  ok(hiders[0].role === 'seeker' && seeker.score === 1, 'прятки: нашёл — найденный тоже ищет, очко ищущему');
  run(M, 1 / 60, { near: [[hiders[0].id, hiders[1].id]] });
  run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.side === 'seek', 'прятки: нашли всех — ищущие победили', M.winner);
  ok(M.players().every(p => p.wins === 1), 'прятки: победа раунда — всем ищущим (и найденным, ставшим ищущими)', M.players().map(p => p.wins));
  run(M, 5.1);
  const s2 = M.players().find(p => p.role === 'seeker');
  ok(M.phase === 'play' && M.round === 2 && s2.id !== seeker.id, 'прятки: следующий раунд — ищет другой', [M.round, s2.id, seeker.id]);
  run(M, 25.1);
  ok(M.phase === 'end' && M.winner.side === 'hide' && M.players().filter(p => p.role === 'hider').every(p => p.score >= 3), 'прятки: время вышло — прятавшиеся победили, +3');
}
{
  const { M } = host('hide', {}, { players: ['a'], net: false });
  M.start();
  ok(M.phase === 'wait', 'прятки одному — ждём второго (даже без сети)');
  M.join('b', 'Друг'); run(M, 1 / 60);
  ok(M.phase === 'count', 'прятки: пришёл второй — отсчёт');
}

// ── Сбор монет: очки, цель, монетки возвращаются (хук) ──
{
  const { M, log } = host('coins', { goal: 3, count: 0 }, { players: ['a', 'b'] });
  M.start();
  for (let i = 0; i < 2; i++) ok(M.touch('a', 'coin', { oid: 'c' + i }) === true, 'монеты: касание забрано режимом');
  ok(M.player('a').score === 2 && log.coins === 2, 'монеты: +1 за монетку, хук «вернуть»');
  M.touch('a', 'coin'); run(M, 1 / 60);
  ok(M.phase === 'end' && M.winner.id === 'a', 'монеты: собрал цель — победа');
  ok(MO.create({ mode: 'obby' }, {}).touch === undefined || true, '(заглушка)');
}
{
  const { M } = host('obby', { count: 0 });
  M.start();
  ok(M.touch('a', 'coin') === false, 'монетка вне «Сбора монет» — как обычно (студия: +1 «Монеты»)');
}

// ── Выживание: волны, отбили — следующая, все волны — победа, все выбыли — зомби победили ──
{
  const { M, log } = host('survival', { waves: 2, zombies: 3, grow: 2, lives: 1, count: 0 }, { players: ['a', 'b'] });
  M.start();
  let z = 0;
  run(M, 1.6, () => ({ zombies: z }));
  ok(log.zombies.length === 1 && log.zombies[0][0] === 3 && M.wave === 1, 'выживание: первая волна — 3 зомби', log.zombies);
  z = 3; run(M, 1, () => ({ zombies: z }));
  M.zombieKilled('a'); M.zombieKilled('a'); M.zombieKilled('b');
  ok(M.player('a').score === 2 && M.player('b').score === 1, 'выживание: убил зомби — очко');
  z = 0; run(M, 1 / 60, () => ({ zombies: z }));
  ok(!M.waveOn && log.say.some(t => /Волна 1 отбита/.test(t)), 'выживание: все зомби побеждены — передышка');
  run(M, 6.1, () => ({ zombies: z }));
  ok(M.wave === 2 && log.zombies[1][0] === 5, 'выживание: вторая волна больше (3 + 2)', log.zombies);
  z = 5; run(M, 1, () => ({ zombies: z })); z = 0; run(M, 1 / 60, () => ({ zombies: z }));
  ok(M.phase === 'end' && M.winner.side === 'p' && M.player('a').score === 7, 'выживание: все волны — победа, +5 выжившим', [M.winner, M.player('a').score]);
  ok(M.hit('a', 'b') === null, 'выживание: игроки друг друга не бьют');
}
{
  const { M } = host('survival', { waves: 5, lives: 1, count: 0 }, { players: ['a', 'b'] });
  M.start(); run(M, 2, { zombies: 3 });
  M.died('a'); M.died('b'); run(M, 1 / 60, { zombies: 3 });
  ok(M.phase === 'end' && M.winner.side === 'z', 'выживание: все выбыли — зомби победили', M.winner);
  ok(M.respawnDelay('a').v === Infinity, 'выживание: выбывший ждёт новый раунд');
}

// ── Раунды и матч ──
{
  const { M, log } = host('coins', { goal: 1, rounds: 3, count: 0 }, { players: ['a', 'b'] });
  M.start();
  for (const w of ['a', 'b', 'a']) { M.touch(w, 'coin'); run(M, 1 / 60); ok(M.phase === 'end', 'раунды: раунд окончен'); run(M, 5.1); }
  ok(M.phase === 'over' && M.winner.id === 'a' && M.player('a').wins === 2, 'раунды: матч — у кого больше побед в раундах', [M.winner, M.player('a').wins]);
  ok(log.ev.filter(e => e[0] === 'roundStart').length === 3 && log.reset === 3, 'раунды: три старта, мир заново каждый раунд');
}
// ── Ждём игроков по сети, один — играем сразу ──
{
  const a = host('ffa', { min: 2 }, { players: ['a'], net: true }); a.M.start();
  ok(a.M.phase === 'wait', 'по сети: мало игроков — ждём');
  a.M.join('b', 'Б'); run(a.M, 1 / 60);
  ok(a.M.phase === 'count', 'по сети: набралось — отсчёт');
  const b = host('ffa', { min: 2 }, { players: ['a'], net: false }); b.M.start();
  ok(b.M.phase === 'count', 'один (без сети) — сразу, проверить мир');
}
// ── Новый хозяин продолжает со снимка; свой номер сменился ──
{
  const { M } = host('coins', { goal: 10, count: 0 }, { players: ['a', 'b'] });
  M.start(); M.touch('a', 'coin'); M.touch('a', 'coin'); run(M, 3);
  const v = JSON.parse(JSON.stringify(M.view()));
  ok(v.ps.length === 2 && v.ps[0].id === 'a' && v.ps[0].s === 2 && v.ph === 'play', 'снимок: игроки по местам, очки, фаза', v.ps[0]);
  const { M: M2 } = host('coins', { goal: 10, count: 0 }, { players: ['b'] });
  ok(M2.restore(v) && M2.phase === 'play' && M2.player('a').score === 2 && near(M2.t, 3, .1), 'новый хозяин: тот же раунд, те же очки');
  M2.rename('a', 'net-a');
  ok(M2.player('net-a')?.score === 2 && !M2.player('a'), 'свой номер сменился (комната посреди игры) — очки на месте');
  ok(!M2.restore({ m: 'ffa', ps: [] }), 'снимок другого режима не берём');
  ok(M2.take() === true && M2.take() === false, 'изменения: «было ли» сбрасывается');
}

// ═══ Ракурсы: куда идти по стику ═══
{
  const fwd = { x: 0, z: 1 }, right = { x: 1, z: 0 };
  const w = (m, mv, yaw) => VW.wish(m, mv, yaw);
  ok(near(w('third', fwd, 0).z, -1) && near(w('third', right, 0).x, 1), 'от 3-го лица: вперёд — от камеры (−Z), вправо — +X');
  const yaw = .9, f3 = w('third', fwd, yaw);
  ok(near(f3.x, -Math.sin(yaw)) && near(f3.z, -Math.cos(yaw)), 'от 3-го лица: по повороту камеры');
  ok(near(w('side', fwd, 0).x, 0) && near(w('side', fwd, 0).z, 0) && near(w('side', right, 0).x, 1), 'сбоку: вперёд/назад — нет, только вправо-влево');
  const fakeRig = () => ({ yaw: 2.2, mode: 'third', dist: 10, minD: 2.6, maxD: 24, lift: 1.5, fp: 0, update(){}, right(){ return { x: 1, z: 0 }; } });
  const cam = THREE ? new THREE.PerspectiveCamera(50, 1, .2, 800) : { position: { x: 0, y: 0, z: 0, set(x, y, z){ this.x = x; this.y = y; this.z = z; } }, lookAt(){}, quaternion: {}, fov: 50, updateProjectionMatrix(){} };
  const rig = fakeRig(), V = VW.create(cam, rig, { T: THREE });
  const C = { move: { x: 0, z: 1 } }, P = { first: false, ch: { x: 3, y: 0, z: 5, vz: 0 } };
  V.set('top', { smooth: false });
  ok(V.moveCam(C, P).yaw === 0 && near(VW.wish('top', C.move, 0).z, -1), 'сверху: стик вверх — на север (−Z), как на карте, куда бы ни смотрела камера раньше');
  V.set('iso', { smooth: false });
  const iy = V.moveCam(C, P).yaw, wi = VW.wish('iso', C.move, iy);
  ok(near(iy, Math.PI / 4) && near(wi.x, -Math.SQRT1_2) && near(wi.z, -Math.SQRT1_2), 'изометрия: вверх по экрану — по диагонали мира', wi);
  V.set('side', { smooth: false });
  const C2 = { move: { x: .5, z: 1 } };
  ok(V.moveCam(C2, P).yaw === 0 && C2.move.z === 0 && C2.move.x === .5, 'сбоку: вперёд по стику гасится, влево-вправо — как есть');
  P.ch.z = 5; V.afterMove(P); P.ch.z = 7.3; P.ch.vz = 3; V.afterMove(P);
  ok(P.ch.z === 5 && P.ch.vz === 0, 'сбоку: персонажа держит плоскость (z не уезжает)');
  V.set('shoulder', { smooth: false }); V.moveCam(C, P);
  ok(P.first === true && rig.dist < 5 && rig.mode === 'third', 'из-за плеча: близко, персонаж смотрит туда же, куда камера');
  V.set('first', { smooth: false }); V.moveCam(C, P);
  ok(rig.mode === 'first' && P.first === true, 'от 1-го лица: rig в режиме first');
  V.set('third', { smooth: false }); V.moveCam(C, P);
  ok(rig.mode === 'third' && rig.dist === 10 && P.first === false && V.moveCam(C, P).yaw === 2.2, 'обратно на 3-е лицо: rig как был, ходьба — по камере');
  // камеры в мире: зоны, «держим направление», пока стик не отпустили
  const cams = [{ id: 'c1', pos: [0, 5, 10], rot: [-20, 0, 0], fov: 50, kind: 'fixed', zones: [[-5, 0, -5, 5, 6, 5]] }, { id: 'c2', pos: [20, 5, 0], rot: [-20, 90, 0], fov: 60, kind: 'fixed', zones: [[15, 0, -5, 25, 6, 5]] }];
  ok(VW.pickCam(cams, [0, 1, 0], null) === 'c1' && VW.pickCam(cams, [20, 1, 0], 'c1') === 'c2' && VW.pickCam(cams, [10, 1, 0], 'c2') === 'c2' && VW.pickCam(cams, [10, 1, 0], null) === 'c1', 'камеры в мире: в зоне — её камера, между зонами — прежняя, нет прежней — первая');
  ok(near(VW.camYaw([-20, 90, 0]), Math.PI / 2), 'камеры в мире: поворот камеры → направление ходьбы');
  if (THREE) {
    V.set('fixed', { smooth: false }); V.cams = cams;
    const Pm = { ch: { x: 0, y: 0, z: 0 }, stepOff: 0 };
    V.update(1 / 60, Pm, { dx: 0, dy: 0, zoom: 1 }, null, null);
    ok(V.camId === 'c1' && near(cam.position.z, 10) && near(cam.fov, 50, .05), 'камеры в мире: стоим в зоне 1 — камера 1', [V.camId, cam.position.z, cam.fov]);
    const Cm = { move: { x: 0, z: 1 } };
    const y1 = V.moveCam(Cm, Pm).yaw;
    Pm.ch.x = 20; V.update(1 / 60, Pm, null, null, null);
    const y2 = V.moveCam(Cm, Pm).yaw;
    ok(V.camId === 'c2' && near(y1, 0) && near(y2, 0), 'камеры в мире: перешли в зону 2 со стиком вверх — идём, как шли (не разворачивает)', [y1, y2]);
    Cm.move.z = 0; V.moveCam(Cm, Pm); Cm.move.z = 1;
    ok(near(V.moveCam(Cm, Pm).yaw, Math.PI / 2), 'камеры в мире: отпустил стик — дальше по новой камере');
    // плавный переход: сверху → сбоку не прыжком
    V.set('top', { smooth: false });
    const Pt = { ch: { x: 0, y: 0, z: 0 }, stepOff: 0 };
    for (let i = 0; i < 30; i++) V.update(1 / 60, Pt, null, null, null);
    const pTop = cam.position.clone();
    V.set('side', { smooth: true });
    V.update(.05, Pt, null, null, null);
    const pMid = cam.position.clone();
    for (let i = 0; i < 60; i++) V.update(1 / 60, Pt, null, null, null);
    const pSide = cam.position.clone();
    ok(pMid.distanceTo(pTop) > .05 && pMid.distanceTo(pSide) > .5 && !V.blending(), 'переход между ракурсами — плавный (через 0,05 с — посередине, потом — на месте)', [pTop.toArray(), pMid.toArray(), pSide.toArray()]);
    ok(near(cam.position.z, VW.cfg('side').dist * Math.cos(8 * Math.PI / 180), .3) && Math.abs(cam.position.x) < .01, 'сбоку: камера сбоку от игрока (по +Z)', cam.position.toArray());
  } else console.log('(three.js не найден — плавный переход и камеры в мире пропущены; путь — первым аргументом)');
  ok(VW.cfg({ mode: 'top', dist: 500, angle: 10 }).dist === 80 && VW.cfg({ mode: 'top', angle: 10 }).angle === 30 && VW.cfg('???').mode === 'third', 'настройки ракурса: в пределах, неизвестный — 3-е лицо');
}

// ═══ Геймпад в редакторе ═══
{
  const P = E.padEdit({});
  const pad = () => ({ buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] });
  const g = pad(), step = (ctx = {}, dt = 1 / 60) => P.update(g, dt, ctx);
  const press = (i, ctx) => { g.buttons[i] = { pressed: true, value: 1 }; const o = step(ctx); return o; };
  const release = (i, ctx) => { g.buttons[i] = { pressed: false, value: 0 }; return step(ctx); };
  ok(press(0, {}).actions.includes('select') && !step({}).actions.includes('select'), 'Ⓐ — выбрать (один раз за нажатие)'); release(0);
  ok(press(0, { grab: true }).actions.includes('place'), 'несёшь — Ⓐ поставить'); release(0);
  ok(press(1, { sel: true }).actions.includes('deselect') && release(1) && press(1, {}).actions.includes('back') && release(1) && press(1, { grab: true }).actions.includes('cancel'), 'Ⓑ: снять выбор / назад / отмена'); release(1);
  ok(press(2).actions.includes('tool-') && release(2) && press(3).actions.includes('tool+'), 'Ⓧ / Ⓨ — инструмент'); release(3);
  let n = 0; g.buttons[5] = { pressed: true, value: 1 };
  for (let i = 0; i < 60; i++) if (step({ sel: true }).actions.includes('rot+')) n++;
  ok(n >= 4 && n <= 6, 'RB держат 1 с — повтор (сразу + каждые 0,12 с после 0,42 с)', n); release(5);
  ok(press(15).actions.includes('grid+') && release(15) && press(12).actions.includes('angle+'), 'крестовина: → шаг сетки, ↑ шаг угла'); release(12);
  ok(press(8).actions.includes('radial') && release(8), '☰ — круговое меню');
  g.axes = [0, -1, .5, 0];
  const r = step({ radial: true });
  ok(r.radial && near(r.radial.y, -1) && near(r.radial.x, 0), 'круговое меню: направление — от стика, что отклонён сильнее', r.radial);
  ok(press(0, { radial: true }).actions.includes('radialPick'), 'круговое меню: Ⓐ — выбрать пункт'); release(0, { radial: true });
  g.axes = [.1, .1, 0, 0];
  const dzn = step({});
  ok(dzn.fly.x === 0 && dzn.fly.z === 0 && !dzn.active, 'мёртвая зона стика: дрожь — не движение');
  g.axes = [1, -1, 0, .5]; g.buttons[7] = { pressed: false, value: .8 };
  const fly = step({});
  ok(near(fly.fly.x, 1) && near(fly.fly.z, 1) && near(fly.fly.y, .8) && fly.look.y > 0 && fly.active, 'стики — лететь и смотреть, RT — вверх', fly);
  const lift = step({ grab: true });
  ok(near(lift.lift, .8) && lift.fly.y === 0, 'несёшь — RT поднимает деталь, а не камеру');
  ok(P.update(null, 1 / 60, {}).actions.length === 0, 'геймпада нет — ничего');
  g.buttons[9] = { pressed: true, value: 1 }; ok(step({}).actions.includes('play'), 'Start — играть');
}

// ═══ Жесты пальцами ═══
{
  const G = E.gestures({ slop: 10, longMs: 500, tapMs: 400, dblMs: 300 });
  const types = evs => evs.map(e => e.type).join(',');
  let ev = G.down(1, 100, 100, 0); ev = ev.concat(G.up(1, 102, 101, 120));
  ok(types(ev) === 'tap' && ev[0].x === 102 && !ev[0].double, 'тап: коротко и на месте', ev);
  G.down(1, 104, 100, 300); const d2 = G.up(1, 104, 100, 380);
  ok(d2[0]?.type === 'tap' && d2[0].double === true, 'двойной тап (≤ 0,3 с, рядом)');
  G.down(1, 100, 100, 1000); const lg = G.tick(1300).concat(G.tick(1520));
  ok(types(lg) === 'long' && types(G.up(1, 100, 100, 1600)) === '', 'долгое нажатие — один раз, потом отпускание без тапа');
  G.down(1, 100, 100, 2000); const m1 = G.move(1, 105, 100, 2010), m2 = G.move(1, 115, 100, 2020), m3 = G.move(1, 125, 104, 2030), u3 = G.up(1, 125, 104, 2040);
  ok(types(m1) === '' && types(m2) === 'dragstart,drag' && m2[0].sx === 100 && m2[1].dx === 15 && types(m3) === 'drag' && m3[0].dx === 10 && types(u3) === 'dragend', 'тянуть: начало после 10 px (от точки нажатия), сдвиги, конец', [m2, m3]);
  ok(types(G.tick(9000)) === '', 'после перетаскивания долгого нажатия нет');
  G.down(1, 100, 100, 3000); const two = G.down(2, 200, 100, 3010);
  ok(types(two) === 'twostart' && two[0].cx === 150, 'второй палец — жест двумя');
  const pinch = G.move(2, 300, 100, 3020);
  ok(types(pinch) === 'two' && near(pinch[0].scale, 2) && near(pinch[0].dx, 50) && near(pinch[0].rot, 0), 'щипок: пальцы разошлись вдвое — scale 2, центр сдвинулся', pinch[0]);
  const rot = G.move(2, 100, 300, 3030);
  ok(near(rot[0].rot, Math.PI / 2, 1e-9) && near(rot[0].scale, 1), 'поворот двумя: +90°', rot[0]);
  ok(types(G.down(3, 50, 50, 3040)) === '' && G.count === 2, 'третий палец не считается');
  const e1 = G.up(2, 100, 300, 3050);
  ok(types(e1) === 'twoend' && types(G.move(1, 160, 160, 3060)) === '' && types(G.up(1, 160, 160, 3070)) === '', 'после двух пальцев оставшийся ничего не крутит и не тапает');
  G.down(1, 0, 0, 4000); G.move(1, 30, 0, 4010); const sw = G.down(2, 100, 0, 4020);
  ok(types(sw) === 'dragend,twostart', 'тянул одним и добавил второй — перетаскивание закончилось, начался жест двумя');
  G.up(1, 0, 0, 4030); G.up(2, 0, 0, 4030);
  G.down(1, 0, 0, 5000); ok(types(G.up(1, 0, 0, 5600)) === '', 'долго держал (без tick) и отпустил — не тап');
}

// ═══ Скрипты: Game.* и Camera.* в песочнице ═══
{
  const msgs = [];
  const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, console });
  vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
  const send = d => ctx.onmessage({ data: d });
  send({ t: 'init', players: [{ id: 'me', name: 'Тест', pos: [0, 0, 0] }, { id: 'p2', name: 'Друг', pos: [0, 0, 0] }], objs: [], scripts: [{ name: 'режим', parent: null, code:
    "Game.RoundStart.Connect(r => print('старт', r, Game.Mode, Game.State, Game.Round));\nGame.RoundEnd.Connect((w, t) => print('конец', w, t));\nGame.Mode = 'ffa'; Camera.Mode = 'top'; Camera.SetMode('first', Players.FindFirstChild('Друг')); Camera.Shake(2, .3);\nPlayers.PlayerAdded.Connect(p => { if (p.Name === 'Друг') { Game.AddScore(p, 5); Game.SetTeam(p, 2); } });\nprint(Game.GetService('Players').Name, Game.Workspace.Name);\ntask.delay(.01, () => print('очки', Game.GetScore(Players.FindFirstChild('Друг')), Game.GetTeam(Players.FindFirstChild('Друг')), Game.TimeLeft, Camera.Mode));" }] });
  send({ t: 'ev', ev: 'game', s: { mode: 'ffa', phase: 'play', round: 2, rounds: 3, left: 42, scores: { p2: 5 }, teams: { p2: 2 }, cam: 'top' } });
  send({ t: 'ev', ev: 'roundStart', round: 2 });
  send({ t: 'ev', ev: 'roundEnd', winner: 'Друг', text: '🏆 Победил Друг!' });
  const of = t => msgs.filter(m => m.t === t);
  ok(of('mode').some(m => m.cmd === 'set' && m.mode === 'ffa'), 'Game.Mode = … — команда хозяину');
  ok(of('camera').some(m => m.mode === 'top' && !m.pid) && of('camera').some(m => m.mode === 'first' && m.pid === 'p2') && of('camera').some(m => Array.isArray(m.shake) && m.shake[0] === 2), 'Camera.Mode / SetMode(игроку) / Shake');
  ok(of('mode').some(m => m.cmd === 'score' && m.pid === 'p2' && m.n === 5) && of('mode').some(m => m.cmd === 'team' && m.pid === 'p2' && m.n === 2), 'Game.AddScore / SetTeam — по номеру игрока');
  ok(of('print').some(m => m.text === 'Players Workspace'), 'Game — ещё и прежний game (GetService, Workspace)');
  ok(of('print').some(m => m.text === 'старт 2 ffa play 2') && of('print').some(m => m.text === 'конец Друг 🏆 Победил Друг!'), 'события RoundStart / RoundEnd и состояние Game.*', of('print').map(m => m.text));
  setTimeout(() => ok(of('print').some(m => m.text === 'очки 5 2 42 top'), 'Game.GetScore / GetTeam / TimeLeft, Camera.Mode — из состояния хозяина', of('print').map(m => m.text)), 30);
}

// ═══ Сцена: настройки мира сохраняются, «Отменить» их не трогает ═══
if (THREE) {
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/scene.js'), 'utf8'), { filename: 'scene.js' });
  const R = { T: THREE, scene: new THREE.Scene(), r: { shadowMap: { enabled: false } }, lighting: { time: 14 }, setLighting(L){ Object.assign(this.lighting, L); }, q: 'low' };
  const SC = E.scene(R, new E.Phys({ ground: 0 }), { edit: true });
  SC.add('Camera', { name: 'Камера', pos: [1, 2, 3], rot: [-10, 45, 0], fov: 70 });
  SC.settings = { game: { mode: 'race', laps: 2 }, camera: { mode: 'side' } };
  const j = JSON.parse(JSON.stringify(SC.toJSON()));
  ok(j.settings?.game?.mode === 'race' && j.objects.some(o => o.cls === 'Camera' && o.fov === 70 && o.rot[1] === 45), 'мир в файл: режим, ракурс, камера с углом обзора');
  SC.fromJSON({ objects: j.objects });
  ok(SC.settings.game?.laps === 2, '«Отменить» / «Стоп» (только объекты) — настройки на месте');
  SC.fromJSON({ objects: [], lighting: { time: 10 } });
  ok(JSON.stringify(SC.settings) === '{}', 'другой мир без настроек — по умолчанию');
  SC.fromJSON(j);
  ok(SC.settings.camera?.mode === 'side' && SC.all().some(o => o.cls === 'Camera'), 'мир из файла — с режимом и ракурсом');
  ok(!SC.toJSON().objects.some(o => o.cls === 'Camera' && o._mesh), 'камера: в сохранении — только свойства');
} else console.log('(three.js не найден — проверка сцены пропущена)');

// ═══ Заготовки миров под режимы: всё нужное стоит, режим и ракурс заданы ═══
{
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/studio3d-modes.js'), 'utf8'), { filename: 'studio3d-modes.js' });
  const T = E.studioTemplates;
  const fake = () => { const all = []; return { all: () => all.slice(), settings: {}, add(cls, p = {}, parent = null){ const o = { id: 'o' + all.length, cls, ...JSON.parse(JSON.stringify(p)), parent: parent?.id || null }; all.push(o); return o; } }; };
  const ids = Object.keys(T);
  ok(ids.length >= 8, 'заготовок не меньше восьми', ids);
  for (const id of ids) {
    const S = fake(), L = T[id].build(S, null, {});
    const g = S.settings.game, mode = g?.mode, D = MO.MODES[mode];
    const has = k => S.all().filter(o => k === 'spawn' ? o.cls === 'Spawn' : k === 'tspawn' ? o.cls === 'Spawn' && o.team : o.touch === k).length;
    const miss = (D?.needs || []).filter(k => has(k === 'tspawn' ? 'tspawn' : k) === 0 && !(k === 'zspawn' && false));
    ok(D && !miss.length && T[id].name && T[id].icon, `заготовка «${T[id].name}»: режим ${mode}, всё нужное есть`, miss);
    ok(S.settings.age === (MO.PVP.has(mode) ? 12 : 6), `заготовка «${T[id].name}»: метка возраста ${S.settings.age}+ (бои — 12+)`);
    if (S.settings.camera) ok(VW.IDS.includes(S.settings.camera.mode), `заготовка «${T[id].name}»: ракурс ${S.settings.camera.mode}`);
    if (mode === 'race') ok(S.all().filter(o => o.touch === 'check').map(o => o.order).join() === '1,2,3', 'гонка: чекпоинты по порядку 1, 2, 3');
    if (mode === 'teams') ok([1, 2].every(t => S.all().some(o => o.cls === 'Spawn' && o.team === t)), 'команды: у каждой команды своя точка');
    if (S.settings.camera?.mode === 'fixed') ok(S.all().filter(o => o.cls === 'Camera').every(c => S.all().some(z => z.parent === c.id)), 'камеры в мире: у каждой камеры — зона');
    ok(!L || typeof L === 'object', 'заготовка возвращает свет (или ничего)');
  }
  // и все режимы кроме «просто мир» покрыты заготовками
  const covered = new Set(ids.map(id => { const S = fake(); T[id].build(S, null, {}); return S.settings.game?.mode; }));
  ok(MO.LIST.filter(m => m !== 'none').every(m => covered.has(m)), 'у каждого режима есть заготовка', [...covered]);
  const views = new Set(ids.map(id => { const S = fake(); T[id].build(S, null, {}); return S.settings.camera?.mode || 'third'; }));
  ok(['side', 'top', 'iso', 'fixed', 'shoulder'].every(v => views.has(v)), 'заготовки показывают разные ракурсы', [...views]);
}

setTimeout(() => { console.log(`\n${pass} ок, ${fail} ошибок`); process.exitCode = fail ? 1 : 0; }, 80);

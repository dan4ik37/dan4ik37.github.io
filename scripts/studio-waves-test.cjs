// «Студия 3D» «Выживание» — AI LOD P1 (T-127, решение владельца D5) в node, с поддельным миром студии (js/games/studio3d-play.js +
// js/engine/modes.js): живых зомби не больше 64 за раз; волна больше — остальные выходят, когда падают первые, и волна не кончается,
// пока очередь не пуста; места и внешность — по зерну (два прогона одинаковы, без Math.random); откат Z_LOD = false — как было (30).
// Запуск из корня сайта: node scripts/studio-waves-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
function world(lod = true){
  const box = { console, performance, setTimeout: () => 0, clearTimeout(){}, Math: Object.create(Math) };
  box.window = box; box.globalThis = box;
  vm.createContext(box);
  for (const f of ['js/engine/core.js', 'js/engine/modes.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), box, { filename: f });
  let src = fs.readFileSync(path.join(SITE, 'js/games/studio3d-play.js'), 'utf8');
  if (!lod) { const a = src.replace('const Z_LOD = true,', 'const Z_LOD = false,'); ok(a !== src, 'откат: строка Z_LOD = true на месте'); src = a; }
  vm.runInContext(src, box, { filename: 'studio3d-play.js' });
  const E = box.D37E, mod = E.studioPlay.find(m => m.id === 'play');
  // поддельная сцена и PLAY_API студии — ровно то, что зовёт режим «Выживание»
  const objs = new Map(); let nid = 0;
  const SC = { settings: { game: { mode: 'survival', waves: 20, zombies: 20, grow: 10, lives: 0, zdmg: 5, count: 0, min: 1 } },
    all: () => [...objs.values()], get: id => objs.get(id), children: () => [], descendants: () => [], serialize: () => [],
    add(cls, p){ const o = { id: 'o' + (++nid), cls, ...p }; objs.set(o.id, o); return o; }, remove(o){ objs.delete(o.id); },
    box: o => ({ min: { x: o.pos[0] - o.size[0] / 2, y: o.pos[1] - o.size[1] / 2, z: o.pos[2] - o.size[2] / 2 }, max: { x: o.pos[0] + o.size[0] / 2, y: o.pos[1] + o.size[1] / 2, z: o.pos[2] + o.size[2] / 2 } }) };
  SC.add('Spawn', { pos: [0, .1, 0], size: [4, .2, 4] });
  for (const [x, z] of [[-22, -22], [22, 22]]) SC.add('Part', { name: 'Зона зомби', pos: [x, .05, z], size: [6, .2, 6], touch: 'zspawn' });
  const P = { I: { touch: false, unlock(){} }, H: { crosshair(){}, buttons(){} }, rig: {}, hud: { querySelectorAll: () => [], classList: { remove(){} } },
    P: { yaw: 0, enabled: true, ch: { x: 0, y: 0, z: 0 } }, C: { down: () => false }, dead: 0, role: 'solo' };
  const papi = { SC, pl: P, R: { camera: {}, T: null }, ed: { ph: { supportAt: () => ({ y: 0 }) }, NPC: { list: new Map() }, box: null, q: () => null }, mp: null,
    players: () => [{ id: 'me', me: true, name: 'Я', pos: [0, 0, 0] }], myId: () => 'me', spawnPoint: () => [0, 0, 0], live: () => true,
    sendAll(){}, sendTo(){}, sendHost(){}, toast(){}, msg(){}, sound(){}, respawn(){}, scriptEvent(){} };
  mod.start(papi); mod.world(false);
  const zombies = () => SC.all().filter(o => o.cls === 'NPC' && o.name === 'Зомби');
  return { box, mod, SC, zombies, T: E.s3play._test };
}
// прогон: шаги хозяина по 1/60; kill(n) — убрать n зомби (как удар игрока); пишет, сколько живых было на каждом шаге
function play(lod = true, poison = true){
  const W = world(lod), log = [];
  if (poison) W.box.Math.random = () => { throw new Error('Math.random в волне зомби'); };
  let maxAlive = 0, err = null, sig = '';
  const step = n => { for (let i = 0; i < n; i++) { W.mod.step(1 / 60, true); const z = W.zombies().length; if (z > maxAlive) maxAlive = z; } };
  const kill = n => { for (const o of W.zombies().slice(0, n)) W.SC.remove(o); };
  try {
    for (let wave = 1; wave <= 7; wave++) {
      for (let i = 0; i < 20 * 60 && W.T.state().M.wave < wave; i++) step(1);   // ждём волну (отсчёт, «следующая через 6 с»)
      step(60);   // волна вышла (по 2 за шаг — ≤ 32 шагов на 64)
      const st = W.T.state(), alive = W.zombies().length, q = st.st.zq;
      log.push([st.M.wave, alive, q]);
      sig += W.zombies().map(o => o.seed + '@' + o.pos.join(',')).join(';') + '|';
      // добить волну: убиваем по 10, очередь выпускает новых, пока не пусто
      for (let g = 0; g < 40 && (W.zombies().length || W.T.state().st.zq); g++) { kill(10); step(3); }
    }
  } catch (e) { err = e.message; }
  return { log, maxAlive, err, sig };
}
{
  const a = play(), b = play();
  ok(!a.err, 'без Math.random в волнах (7 волн)', a.err);
  ok(a.maxAlive === 64, 'живых зомби — не больше 64 за раз (и до 64 доходит)', a.maxAlive);
  const w = Object.fromEntries(a.log.map(([wv, alive, q]) => [wv, [alive, q]]));
  ok(w[1]?.[0] === 20 && w[2]?.[0] === 30 && w[5]?.[0] === 60, 'волны 20 / 30 / … / 60 — все сразу', a.log);
  ok(w[6]?.[0] === 64 && w[6]?.[1] === 6 && w[7]?.[0] === 64 && w[7]?.[1] === 16, 'волна 70 / 80: 64 живых + 6 / 16 в очереди', a.log);
  ok(a.log.length === 7 && a.log.every((x, i) => x[0] === i + 1), 'волна кончается только с пустой очередью (7 волн подряд)', a.log);
  ok(a.sig === b.sig && a.sig.length > 100, 'два прогона: те же места и внешность зомби (зерно волны)');
}
{
  const o = play(false, false);
  ok(o.maxAlive === 30, 'откат Z_LOD = false: как было — не больше 30 за волну', o.maxAlive);
}
console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

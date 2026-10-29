// «Студия 3D» «Выживание» — AI LOD P1 (T-127, решение владельца D5) в node, с поддельным миром студии (js/games/studio3d-play.js +
// js/engine/modes.js): живых зомби не больше 64 за раз; волна больше — остальные выходят, когда падают первые, и волна не кончается,
// пока очередь не пуста; места и внешность — по зерну (два прогона одинаковы, без Math.random); откат Z_LOD = false — как было (30).
// Review #7: the queue is in the host snapshot — a new host mid-wave (from a stale snapshot) brings out exactly the zombies the old
// host would have (same seeds and places, none lost, none twice).
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
  return { box, mod, SC, zombies, papi, T: E.s3play._test };
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
// ═══ Review #7: the wave queue survives a host change ═══
// wave 7 = 80 zombies (64 alive + 16 queued); kill 10, 3 steps, the last snapshot the guests got is up to 1.5 s old; then a new host
function wave7(change){
  const W = world(); let last = null;
  W.papi.sendAll = (t, d) => { if (t === 'mode' && d && 'v' in d) last = d.v; };
  const out = [], add = W.SC.add;
  W.SC.add = (cls, p) => { const o = add.call(W.SC, cls, p); if (cls === 'NPC' && o.name === 'Зомби' && /^z[0-9]+-7-/.test(String(o.seed))) out.push(o.seed + '@' + o.pos.join(',')); return o; };
  const step = n => { for (let i = 0; i < n; i++) W.mod.step(1 / 60, true); };
  const kill = n => { for (const o of W.zombies().slice(0, n)) W.SC.remove(o); };
  for (let wave = 1; wave < 7; wave++) { for (let i = 0; i < 20 * 60 && W.T.state().M.wave < wave; i++) step(1); step(60); for (let g = 0; g < 40 && (W.zombies().length || W.T.state().st.zq); g++) { kill(10); step(3); } }
  for (let i = 0; i < 20 * 60 && W.T.state().M.wave < 7; i++) step(1);
  step(60); kill(10); step(3);
  const before = W.T.state().st.zq;
  let after = null; const snapQ = last?.zq || null;
  if (change) {   // хозяин ушёл: новый — с пустым состоянием режима и последним полученным снимком
    W.mod.stop(); W.mod.start(W.papi); W.mod.guestEvent('mode', { v: last }); W.mod.world(true);
    after = W.T.state().st.zq;
  }
  for (let g = 0; g < 40 && (W.zombies().length || W.T.state().st.zq); g++) { kill(10); step(3); }
  return { out, before, after, snapQ, wave: W.T.state().M.wave };
}
{
  const a = wave7(false), b = wave7(true);
  ok(a.out.length === 80 && new Set(a.out).size === 80, 'волна 7 без смены хозяина: вышли все 80', a.out.length);
  ok(Array.isArray(b.snapQ) && b.snapQ[1] === 7, 'очередь волны — в снимке для гостей ([очередь, волна, вышло])', b.snapQ);
  ok(b.after === b.before && b.before === 10, 'новый хозяин продолжил очередь (10), снимок отставал — вышедших после него не повторил', [b.before, b.after, b.snapQ]);
  ok(b.out.length === 80 && b.out.join(';') === a.out.join(';'), 'со сменой хозяина — те же 80 зомби (места и внешность), никто не потерян и не вышел дважды', [b.out.length, new Set(b.out).size]);
}
// ═══ Review #6: Studio's simple figures have their own one-line rollback S3_IMP ═══
{
  const src = fs.readFileSync(path.join(SITE, 'js/games/studio3d.js'), 'utf8'), NL = String.fromCharCode(10);
  const lines = src.split(NL), line = lines.find(l => l.includes('ed.NPC.A.impostors'));
  ok(lines.some(l => l.trim().startsWith('const S3_IMP = true;')), 'откат фигурок «Студии 3D» — строка S3_IMP = true на месте');
  ok(!!line && line.includes('if (S3_IMP && ('), 'фигурки включаются только при S3_IMP (S3_IMP = false — все подробные на любом устройстве)', line && line.trim().slice(0, 90));
}
console.log(`${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

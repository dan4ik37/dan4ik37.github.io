// Разрушения (js/engine/destruct.js) в node с настоящим three r149: правила по зонам, сила машины (деревья — только танк),
// падение дерева → брёвна, обломки засыпают и тают, предел пулов, одинаково по зерну, событие по сети, восстановление.
// Запуск: node scripts/destruct-test.cjs <путь к three@0.149 (папка пакета)>
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const THREE_DIR = process.argv[2];
if (!THREE_DIR) { console.log('укажи путь к three@0.149: node scripts/destruct-test.cjs <…/node_modules/three>'); process.exit(1); }
const THREE = require(path.join(THREE_DIR, 'build/three.cjs'));
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/destruct.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = globalThis.D37E;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const mk = (o = {}) => {
  const R = { T: THREE, q: 'mid', scene: new THREE.Scene() }, ph = new E.Phys();
  const DS = E.destruct(R, ph, { rule: b => (b.zone === 'kids' ? 'none' : b.zone === 'metro' ? 'small' : 'all'), restore: .05, ...o });
  return { R, ph, DS };
};
const run = (DS, sec, dt = 1 / 30) => { for (let t = 0; t < sec; t += dt) DS.update(dt); };
{
  const { ph, DS } = mk();
  const hidden = new Map(), hide = id => on => hidden.set(id, on);
  const tb = ph.addCyl({ x: 0, z: 0, y: 1.2, r: .38, hy: 1.2, tag: 'tree' });
  DS.add({ id: 'tw', zone: 'war', kind: 'tree', x: 0, y: 0, z: 0, h: 4, r: .3, bodies: [tb], hide: hide('tw') });
  DS.add({ id: 'lm', zone: 'metro', kind: 'lamp', x: 20, y: 0, z: 0, h: 3.4, r: .16, bodies: [], hide: hide('lm') });
  DS.add({ id: 'lk', zone: 'kids', kind: 'lamp', x: 40, y: 0, z: 0, h: 3.4, r: .16, bodies: [], hide: hide('lk') });
  DS.add({ id: 'gm', zone: 'metro', kind: 'glass', x: 60, y: 1.8, z: 0, w: 2, h: 1.4, bodies: [], hide: hide('gm') });
  DS.add({ id: 'gw', zone: 'war', kind: 'glass', x: 80, y: 1.8, z: 0, w: 2, h: 1.4, bodies: [], hide: hide('gw') });
  const sent = []; DS.onBreak = (id, s, dx, dz) => sent.push({ id, s, dx, dz });
  // сила машины: обычная машина (1) дерево не валит, танк (2) — валит
  ok(DS.ahead(0, -1, 1.2, 1, 0, 1).n === 0 && !DS.broken.has('tw'), 'машина дерево не валит (только танк/грузовик)');
  ok(DS.ahead(0, -1, 1.2, 2, 0, 1).n === 1 && DS.broken.has('tw') && hidden.get('tw') === true, 'танк валит дерево: целое спрятано');
  ok(!ph.cols.has(tb), 'тело ствола убрано (танк проезжает)');
  ok(sent.length === 1 && sent[0].id === 'tw' && Number.isInteger(sent[0].s), 'по сети — событие «сломан id» с зерном');
  ok(DS.stats().fallers === 1, 'дерево падает (поворот вокруг основания)');
  run(DS, 3);
  ok(DS.stats().fallers === 0 && DS.stats().cyl >= 3, 'упало — брёвна на земле', DS.stats());
  // правила зон: детский городок — никогда, взрослый — только мелочь, боевая — всё
  ok(DS.hit(40, 0, 1, 9) === 0 && !DS.broken.has('lk'), 'детский городок: ничего не ломается');
  ok(DS.hit(20, 0, 1, 9) === 1 && DS.broken.has('lm'), 'взрослый город: столб ломается');
  ok(DS.hit(60, 1.8, 1.5, 9) === 0 && !DS.broken.has('gm'), 'взрослый город: стекло зданий — нет (только мелочь)');
  ok(DS.hit(80, 0, 1.5, 9, { y: 1.8 }) === 1 && DS.stats().shard > 0, 'боевая зона: стекло — осколками');
  // из сети: сломать без повторной рассылки
  const n0 = sent.length; DS.list.get('lk'); ok(!DS.breakId('lk', 5, 1, 0, true), 'из сети в детском городке — тоже нельзя');
  // обломки засыпают и тают; сломанное восстанавливается через N минут (тут — 3 с), тело возвращается
  run(DS, 28);   // брёвна лежат 25 с, остальное — 6–12 с
  const st = DS.stats();
  ok(st.box + st.cyl + st.ico + st.shard === 0, 'обломки растаяли', st);
  ok(!DS.broken.has('tw') && hidden.get('tw') === false && ph.cols.has(tb), 'через N минут дерево снова стоит (и тело на месте)');
  ok(sent.length === n0, 'из сети — без повторной рассылки');
}
{
  // предел: сколько ни бей — обломков в пулах не больше их размера
  const { DS } = mk({ cap: 40 });
  for (let i = 0; i < 400; i++) DS.debris({ shape: 'box', x: 0, y: 5, z: 0, vy: 2 });
  ok(DS.stats().box <= 40, 'предел обломков соблюдён', DS.stats().box);
  run(DS, 4);
  const P = DS.stats().box;
  ok(P > 0 && P <= 40, 'лёгшие — спят (не считаются), но видны', P);
}
{
  // одинаково по зерну: два игрока ломают одно и то же — первые кадры обломков совпадают
  const a = mk(), b = mk();
  for (const X of [a, b]) X.DS.add({ id: 'bn', zone: 'war', kind: 'bench', x: 0, y: 0, z: 0, w: 2.2, d: .6, h: 1, bodies: [], hide: () => {} });
  a.DS.breakId('bn', 12345, 1, 0, true); b.DS.breakId('bn', 12345, 1, 0, true);
  const pos = X => X.R.scene.children.find(g => g.name === 'destruct').children[0];
  const ma = pos(a).instanceMatrix.array.slice(0, 48), mb = pos(b).instanceMatrix.array.slice(0, 48);
  ok(ma.every((v, i) => Math.abs(v - mb[i]) < 1e-9), 'одинаковое зерно — одинаковые обломки у всех');
  a.DS.dispose(); ok(!a.R.scene.children.some(g => g.name === 'destruct'), 'после выхода — ни сетки обломков');
}
{
  // этап 2: стены зданий из деталей (боевая зона) — выбитый кусок = дыра (спрятан, тела нет), здание стоит; машина упирается,
  // танк пробивает обычную стену; прочные (бункер, базы) — только взрывами; Большой город — стены не ломаются; всё назад
  const { ph, DS } = mk();
  const hidden = new Map(), hide = id => on => hidden.set(id, on);
  const box = x => ph.addBox({ x, y: 1.9, z: 0, hx: 1.2, hy: 1.9, hz: .15, tag: 'piece' });
  const wb = box(0), tb = box(10), w2 = box(30);
  DS.add({ id: 'p:w1', zone: 'war', kind: 'wall', x: 0, y: 0, z: 0, w: 2.4, d: .3, h: 3.8, c: '#a8a29e', bodies: [wb], hide: hide('w1') });
  DS.add({ id: 'p:t1', zone: 'war', kind: 'wall', x: 10, y: 0, z: 0, w: 2.4, d: .3, h: 3.8, hp: 20, power: 3, bodies: [tb], hide: hide('t1') });
  DS.add({ id: 'p:w2', zone: 'war', kind: 'wall', x: 30, y: 0, z: 0, w: 2.4, d: .3, h: 3.8, bodies: [w2], hide: hide('w2') });
  DS.add({ id: 'p:m1', zone: 'metro', kind: 'wall', x: 20, y: 0, z: 0, w: 2.4, d: .3, h: 3.8, bodies: [], hide: hide('m1') });
  ok(DS.ahead(0, -1.5, 1.2, 1, 0, 1).n === 0 && DS.blocking(0, -1.5, 1.2, 1)?.id === 'p:w1', 'машина стену не пробивает (упирается)');
  let n = 0; for (let k = 0; k < 4; k++) n += DS.hit(0, -.2, .9, 1, { y: 1.5 });
  ok(n === 0 && !DS.broken.has('p:w1'), 'пули: стена держит несколько попаданий');
  ok(DS.hit(0, -.2, .9, 1, { y: 1.5 }) === 1 && hidden.get('w1') === true && !ph.cols.has(wb), 'выбита: кусок спрятан, тело убрано — дыра');
  ok(DS.stats().box >= 4, 'обломки стены', DS.stats());
  ok(DS.ahead(30, -1.5, 1.2, 2, 0, 1).n === 1 && DS.broken.has('p:w2'), 'танк пробивает обычную стену');
  ok(DS.ahead(10, -1.5, 1.2, 2, 0, 1).n === 0 && DS.blocking(10, -1.5, 1.2, 2)?.id === 'p:t1', 'прочная стена базы: танк не пробивает');
  let k2 = 0; while (!DS.broken.has('p:t1') && k2++ < 20) DS.hit(10, -.2, 2.4, 3, { y: 1.5 });
  ok(DS.broken.has('p:t1') && k2 === 7, 'прочная — только взрывами (7)', k2);
  ok(DS.hit(20, -.2, .9, 9, { y: 1.5 }) === 0 && !DS.broken.has('p:m1'), 'Большой город: стены не ломаются');
  run(DS, 13);
  ok(!DS.broken.has('p:w1') && hidden.get('w1') === false && ph.cols.has(wb) && ph.cols.has(tb), 'восстановились: куски и тела на месте');
}
ok(E.destruct.POWER.wall === 2 && E.destruct.POWER.block === 3, 'стены: сила танка, блоки — только взрывы');
ok(E.destruct.POWER.tree === 2 && E.destruct.POWER.lamp === 1 && E.destruct.SMALL.has('bench') && !E.destruct.SMALL.has('glass'), 'таблица силы и «мелочи»');
console.log(`destruct-test: ${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

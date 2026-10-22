// Рисование карты-рельефа (js/engine/worldmap.js, WM.view) в node с настоящим three r149: подгрузка по кусочку без дыр и
// наложений (вместо неготового узла — готовый «родитель»), кэш не растёт, деревья и тела деревьев рядом, вода и дороги.
// Запуск: node scripts/worldmap-test.cjs <путь к three@0.149 (папка пакета)>
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const THREE_DIR = process.argv[2];
if (!THREE_DIR) { console.log('укажи путь к three@0.149: node scripts/worldmap-test.cjs <…/node_modules/three>'); process.exit(1); }
const THREE = require(path.join(THREE_DIR, 'build/three.cjs'));
globalThis.window = globalThis;
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/worldmap.js', 'js/games/mir-zones.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const MZ = globalThis.MirZones, E = globalThis.D37E;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const R = { T: THREE, q: 'mid', scene: new THREE.Scene(), mat: c => new THREE.MeshStandardMaterial({ color: c }), K: { geo: (k, f) => f() } };
const WM = MZ.worldMap(), ph = new E.Phys();
const V = WM.view(R, { far: 900 });
const nodesOf = () => V.grp.children.filter(m => m.isMesh && m.geometry.attributes.color).map(m => { m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox; return { x0: Math.round(b.min.x), z0: Math.round(b.min.z), x1: Math.round(b.max.x), z1: Math.round(b.max.z) }; });
const overlaps = L => { for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const a = L[i], b = L[j]; if (a.x0 < b.x1 - 1 && a.x1 > b.x0 + 1 && a.z0 < b.z1 - 1 && a.z1 > b.z0 + 1) return [a, b]; } return null; };
// первый кадр — всё сразу; дальше — по 3 узла за кадр (ПК) — летим по карте
V.update(0, -200, { force: true, ph, px: 0, pz: -200 });
let L = nodesOf();
ok(L.length > 10, 'первый кадр: рельеф вокруг', L.length);
ok(!overlaps(L), 'первый кадр: узлы не накладываются', overlaps(L));
let worstOv = null, maxCache = 0, frames = 0, holesAt = null;
const path_ = [[0, -200], [0, -1200], [-900, -1700], [-1400, -600], [-600, 300], [600, 500], [900, -300], [0, -200]];
for (let i = 1; i < path_.length; i++) {
  const [x0, z0] = path_[i - 1], [x1, z1] = path_[i], n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3);
  for (let k = 1; k <= n; k++) {
    const x = x0 + (x1 - x0) * k / n, z = z0 + (z1 - z0) * k / n;
    V.update(x, z, { ph, px: x, pz: z }); frames++;
    maxCache = Math.max(maxCache, V.cache());
    if (frames % 40 === 0) {
      L = nodesOf(); const ov = overlaps(L); if (ov && !worstOv) worstOv = ov;
      // под камерой — всегда земля (не дыра), кроме площадки мира (там своя земля)
      const covered = L.some(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) || WM.PADS.some(p => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1);
      if (!covered && !holesAt) holesAt = [Math.round(x), Math.round(z)];
    }
  }
}
ok(!worstOv, 'полёт: видимые узлы не накладываются (родитель прячет детей)', worstOv);
ok(!holesAt, 'полёт: под камерой нет дыр', holesAt);
ok(maxCache <= 160, 'кэш узлов не растёт (≤ 160)', maxCache);
ok(V.built < frames * 3 + 200, 'узлы строятся понемногу (не больше 3 за кадр)', [V.built, frames]);
// деревья и тела деревьев: рядом с игроком — есть, далеко — убраны
const inst = V.grp.children.filter(m => m.isInstancedMesh);
ok(inst.length === 3 && inst[0].count > 50, 'деревья рядом — экземплярами', inst.map(m => m.count));
const trees = [...ph.query(-2000, -2000, 2000, 2000, [])].filter(c => c.tag === 'tree');
ok(trees.length > 0 && trees.every(c => Math.hypot(c.x - 0, c.z + 200) < 70), 'тела деревьев — только рядом с игроком', trees.length);
ok(!!V.water && V.water.geometry.attributes.position.count > 1000, 'вода — одной сеткой (море, реки, озёра)');
V.dispose(ph);
ok(V.grp.parent === null && [...ph.query(-2000, -2000, 2000, 2000, [])].filter(c => c.tag === 'tree').length === 0, 'после выхода — ни сетки, ни тел деревьев');
// деревья пород (T-022b, js/engine/trees.js + trees3d.js): вблизи — 5 видов экземплярами, вдали — 2 простых; те же места;
// разрушениям — сетка дерева по id; после выхода источник снят
for (const f of ['js/engine/trees.js', 'js/engine/trees3d.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
{
  const V2 = WM.view(R, { far: 900 });
  V2.update(-760, -560, { force: true, ph, px: -760, pz: -560 });
  const im = V2.grp.children.filter(m => m.isInstancedMesh), S = V2.treeStats();
  ok(im.length === 7, 'деревья пород: 7 экземпляров (5 видов вблизи + 2 вдали)', im.length);
  ok(S.near.reduce((a, b) => a + b, 0) > 20 && S.farB + S.farC > 100, 'в лесу: подробные вблизи и простые вдали', S);
  ok(S.verts.every(v => v > 100 && v < 6000) && S.far.every(v => v < 260), 'вершин: вид вблизи < 6000, вдали < 260', { v: S.verts, f: S.far });
  // те же места, что у прежних деревьев: число деревьев в круге — как у WM.trees
  let n0 = 0; WM.trees(-760 - 320, -560 - 320, -760 + 320, -560 + 320, (x, y, z) => { if ((x + 760) ** 2 + (z + 560) ** 2 <= 320 * 320) n0++; });
  const n1 = S.near.reduce((a, b) => a + b, 0) + S.farB + S.farC;
  ok(n1 === Math.min(n0, n1) && n1 >= n0 * .97, 'деревьев столько же, что и мест у карты (кэш клеток не теряет)', [n0, n1]);
  let id = null; WM.trees(-770, -570, -750, -550, (x, y, z) => { id = id || 'wt:' + Math.round(x * 4) + ':' + Math.round(z * 4); });
  const info = E.trees.lookup(id);
  ok(!!info && info.geo?.isBufferGeometry && info.h > 3 && info.s > 0, 'разрушениям: дерево карты по id — сетка и место', info && { h: info.h, s: info.s, sp: info.sp });
  V2.cutTree(id, true); V2.update(-760, -560, { ph, px: -760, pz: -560 });
  ok(V2.treeStats().near.reduce((a, b) => a + b, 0) + V2.treeStats().farB + V2.treeStats().farC === n1 - 1, 'сломанное дерево спрятано (−1)');
  V2.dispose(ph);
  ok(V2.grp.parent === null && E.trees.lookup(id) === null, 'после выхода — сетки прочь, источник для разрушений снят');
}
console.log(`worldmap-test: ${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

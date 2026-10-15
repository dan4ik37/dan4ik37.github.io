// Проверка движка кубиков «Кубомира» (js/engine/voxel*.js) без браузера: node scripts/voxel-test.cjs
// Генерация по зерну (одинаково и разное), стыки чанков (деревья через границу), «жадная» сетка (грани на известных
// фигурах, AO, порядок вершин), свет (факел, крыша, листва, вода, через границу чанков), луч и столкновения, рецепты,
// сохранение (правки ↔ числа, файл мира), подгрузка (поток в кадре), моды (проверка mod.json, песочница: ошибки и
// зависания не роняют игру), скорость (генерация + свет + сетка на чанк).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sec = t => console.log('— ' + t);

function load(files, extra = {}){
  const ctx = { console, Math, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array, Float32Array, Float64Array, Map, Set, WeakMap, Object, Array, JSON, Number, String, Boolean, Error, TypeError, RangeError, Promise, Date, RegExp, Symbol, setTimeout, clearTimeout, setInterval, clearInterval, performance, ArrayBuffer, DataView, TextEncoder, TextDecoder, Blob: global.Blob, DecompressionStream: global.DecompressionStream, CompressionStream: global.CompressionStream, Response: global.Response, ...extra };
  ctx.globalThis = ctx; ctx.self = ctx;
  ctx.btoa = s => Buffer.from(s, 'binary').toString('base64');
  ctx.atob = s => Buffer.from(s, 'base64').toString('binary');
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const CORE = ['js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-stream.js', 'js/engine/voxel-store.js'];
const ctx = load(CORE);
const V = ctx.D37E.vox, ID = V.ID, H = V.H;
const hashArr = a => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); } return h >>> 0; };

(async () => {
  // ═══ 1. Реестр ═══
  sec('реестр блоков и вещей');
  ok(V.blocks[0].name === 'air' && V.blocks[1].name === 'stone' && ID.water === 8 && ID.lava === 9, 'ваниль: постоянные номера (air 0, stone 1, water 8, lava 9)');
  ok(V.blocks.every((b, i) => b.id === i) && new Set(V.blocks.map(b => b.name)).size === V.blocks.length, 'номера по порядку, имена уникальны');
  ok(V.items.every(it => !it.place || V.block(it.place)), 'у каждой «ставящейся» вещи есть блок');
  ok(V.items.every(it => !it.tex || V.texIdx.has(it.tex)), 'у вещей с картинкой есть слой текстуры');
  ok(V.blocks.filter(b => b.texf).every(b => [b.texf.top, b.texf.bottom, b.texf.side].every(l => l >= 0 && l < V.tex.length)), 'грани блоков указывают на существующие слои');
  const painted = V.paintAll();
  ok(painted.length === V.tex.length && painted.every(d => d.length === 1024), 'все текстуры рисуются 16×16 RGBA', painted.length);
  ok(painted.every((d, i) => { let s = 0; for (let k = 3; k < d.length; k += 4) s += d[k]; return s > 0 || /^destroy_0$/.test(V.tex[i].name); }), 'текстуры не пустые');
  const missingLike = V.tex.filter((t, i) => !V.TEX_SPECS[t.name]).map(t => t.name);
  ok(missingLike.length === 0, 'у каждой текстуры ванили есть рисунок', missingLike);

  // ═══ 2. Генерация ═══
  sec('генерация по зерну');
  const G1 = V.genInit('Кубомир'), G2 = V.genInit('Кубомир'), G3 = V.genInit('другое зерно');
  const a = V.genChunk(G1, 3, -7), b = V.genChunk(G2, 3, -7), c = V.genChunk(G3, 3, -7);
  ok(hashArr(a.ids) === hashArr(b.ids) && hashArr(a.tint) === hashArr(b.tint) && hashArr(a.biome) === hashArr(b.biome), 'то же зерно — тот же чанк (блоки, цвета, биомы)');
  ok(hashArr(a.ids) !== hashArr(c.ids), 'другое зерно — другой чанк');
  ok(V.seedOf('123') === 123 && V.seedOf('Кубомир') === V.seedOf('Кубомир') && V.seedOf('a') !== V.seedOf('b'), 'зерно из числа и из слова');
  // повтор в другом порядке (кэш «происхождений» не влияет)
  const G4 = V.genInit('Кубомир'); V.genChunk(G4, 4, -7); V.genChunk(G4, 2, -8);
  ok(hashArr(V.genChunk(G4, 3, -7).ids) === hashArr(a.ids), 'порядок генерации соседей не меняет чанк');
  // нижний слой — коренная порода, нет «висящих» стволов, руды на своих высотах
  const area = new Map(), R0 = 4;
  for (let cx = -R0; cx <= R0; cx++) for (let cz = -R0; cz <= R0; cz++) area.set(cx + ',' + cz, V.genChunk(G1, cx, cz));
  let bedrockOk = true, floating = 0, logs = 0, oreBad = 0, oreCount = 0;
  const ORE_MAX = { ore_coal: 100, ore_iron: 64, ore_gold: 32, ore_diamond: 16 };
  for (const [k, ch] of area) for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const base = (x << 11) | (z << 7);
    if (ch.ids[base] !== ID.bedrock) bedrockOk = false;
    for (let y = 1; y < H; y++) {
      const t = ch.ids[base | y] & 0xfff, n = V.blocks[t].name;
      if (/^log_/.test(n)) { logs++; const below = ch.ids[base | (y - 1)] & 0xfff; if (below === 0 || V.T.liquid[below]) floating++; }
      if (ORE_MAX[n] !== undefined) { oreCount++; if (y > ORE_MAX[n] + 8) oreBad++; }
    }
  }
  ok(bedrockOk, 'на высоте 0 везде коренная порода');
  ok(logs > 50 && floating === 0, 'деревья стоят на земле (нет висящих стволов)', { logs, floating });
  ok(oreCount > 100 && oreBad === 0, 'руды есть и на своих глубинах', { oreCount, oreBad });
  // биомы: на большой площади встречаются разные
  const seen = new Set(), col = {};
  for (let x = -3000; x <= 3000; x += 97) for (let z = -3000; z <= 3000; z += 97) seen.add(V.genColumn(G1, x, z, col).b);
  ok(['ocean', 'plains', 'forest', 'birch', 'desert', 'snow', 'mountains', 'swamp', 'beach', 'river'].every(n => seen.has(V.BIOME_IDS.indexOf(n))), 'все биомы встречаются', [...seen].map(i => V.BIOME_IDS[i]));
  // пещеры: пустоты под землёй есть, точка = чанк (одинаковая арифметика)
  let mism = 0, checks = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 37) % 48) - 24, z = ((i * 53) % 48) - 24, y = 6 + (i * 11) % 40;
    const ch = area.get((x >> 4) + ',' + (z >> 4)); if (!ch) continue;
    const c0 = V.genColumn(G1, x, z, {}); if (y >= c0.h - 1 || c0.h <= V.SEA + 2) continue;
    const v = ch.ids[((x & 15) << 11) | ((z & 15) << 7) | y] & 0xfff, carved = v === 0 || v === ID.lava;
    const pt = V.caveAt(G1, x, y, z, c0.h);
    checks++;
    if (pt && !carved) mism++;
  }
  ok(checks > 50 && mism === 0, 'пещера в точке = пещера в чанке', { checks, mism });
  const spawn = V.findSpawn(G1, 0, 0);
  ok(spawn.y > V.SEA && Number.isFinite(spawn.x), 'точка появления — на суше', spawn);

  // ═══ 3. Стыки чанков: кроны деревьев у границы целые с обеих сторон ═══
  sec('стыки чанков');
  const get = (x, y, z) => { const ch = area.get((x >> 4) + ',' + (z >> 4)); if (!ch || y < 0 || y >= H) return -1; return ch.ids[((x & 15) << 11) | ((z & 15) << 7) | y] & 0xfff; };
  let crowns = 0, holes = 0;
  for (let x = -R0 * 16 + 3; x < R0 * 16 + 13; x++) for (let z = -R0 * 16 + 3; z < R0 * 16 + 13; z++) {
    if ((x & 15) > 1 && (x & 15) < 14 && (z & 15) > 1 && (z & 15) < 14) continue;   // ствол у края чанка (крона — через границу)
    for (let y = 40; y < H - 3; y++) {
      const t = get(x, y, z); if (!/^log_(oak|birch)$/.test(V.blocks[t]?.name || '')) continue;
      if (get(x, y + 1, z) === t) continue;   // не верх ствола
      crowns++;
      const leaf = ID['leaves_' + V.blocks[t].name.slice(4)];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = get(x + dx, y, z + dz); if (n === 0) holes++; }
      void leaf;
    }
  }
  ok(crowns > 5 && holes === 0, 'кроны у границы чанков без дыр', { crowns, holes });

  // ═══ 4. «Жадная» сетка: известные фигуры ═══
  sec('жадная сетка');
  const RW = V.REGION, RC = RW * RW * H;
  const mk = () => new Uint16Array(RC);
  const at = (reg, x, y, z, v) => { reg[((x + 16) * RW + (z + 16)) * H + y] = v; };
  const mesh = reg => { const L = V.lightRegion(reg, V.T); return V.meshChunk(reg, L, V.T, null); };
  const q = (m, k) => m[k] ? m[k].n : 0;
  let r1 = mk(); at(r1, 5, 40, 5, ID.stone);
  let m1 = mesh(r1);
  ok(q(m1, 'solid') === 6 && !m1.cutout && !m1.water, 'один блок — 6 граней', [q(m1, 'solid')]);
  // сколько квадратов по направлениям (низ висящего блока освещён неровно — там склейки меньше, это верно)
  const byDir = m => { const c = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < m.solid.n; i++) c[m.solid.vd[i * 16 + 2] >> 12]++; return c; };
  let r2 = mk(); for (let x = 3; x < 5; x++) for (let y = 40; y < 42; y++) for (let z = 3; z < 5; z++) at(r2, x, y, z, ID.stone);
  const d2 = byDir(mesh(r2));
  ok(d2[0] === 1 && d2[1] === 1 && d2[2] === 1 && d2[4] === 1 && d2[5] === 1 && d2[3] >= 1, 'куб 2×2×2 — верх и бока склеены в 1 квадрат каждый', d2);
  let r3 = mk(); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) at(r3, x, 30, z, ID.stone);
  const m3 = mesh(r3), d3 = byDir(m3);
  ok(d3[0] === 1 && d3[1] === 1 && d3[2] === 1 && d3[4] === 1 && d3[5] === 1, 'плита 16×1×16 — верх 1 квадрат, бока по 1', d3);
  let r4 = mk(); at(r4, 2, 40, 2, ID.stone); at(r4, 8, 40, 8, ID.dirt);
  ok(q(mesh(r4), 'solid') === 12, 'два отдельных блока — 12 граней');
  let r5 = mk(); at(r5, 2, 40, 2, ID.glass); at(r5, 3, 40, 2, ID.glass);
  ok(q(mesh(r5), 'cutout') === 6, 'стекло к стеклу — общая грань не рисуется (2 блока → 6 граней)', q(mesh(r5), 'cutout'));
  let r6 = mk(); at(r6, 2, 40, 2, ID.stone); at(r6, 3, 40, 2, ID.glass);
  const m6 = mesh(r6);
  ok(q(m6, 'solid') === 6 && q(m6, 'cutout') === 5, 'камень рядом со стеклом: камень — 6, стекло — 5', [q(m6, 'solid'), q(m6, 'cutout')]);
  let r7 = mk(); at(r7, 4, 30, 4, ID.stone); at(r7, 4, 31, 4, ID.tall_grass);
  ok(q(mesh(r7), 'cutout') === 4, 'трава — крест: 4 квадрата (с двух сторон)');
  let r8 = mk(); for (let x = 0; x < 2; x++) for (let z = 0; z < 2; z++) { at(r8, x + 4, 30, z + 4, ID.stone); at(r8, x + 4, 31, z + 4, ID.water); }
  const m8 = mesh(r8);
  ok(q(m8, 'water') === 4 * 1 + 8, 'вода 2×2: верх 4 + бока 8 (внутри — нет)', q(m8, 'water'));
  // склейка: две разных текстуры не склеиваются
  let r9 = mk(); at(r9, 2, 40, 2, ID.stone); at(r9, 3, 40, 2, ID.dirt);
  ok(q(mesh(r9), 'solid') === 10, 'камень + земля рядом: 10 граней (разные — не склеиваются)', q(mesh(r9), 'solid'));
  // порядок вершин: нормаль по векторному произведению = направление грани
  const checkWinding = m => {
    const P = m.solid.pos, VD = m.solid.vd; let bad = 0;
    const DIRV = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let qi = 0; qi < m.solid.n; qi++) {
      const v = k => [P[(qi * 4 + k) * 3], P[(qi * 4 + k) * 3 + 1], P[(qi * 4 + k) * 3 + 2]];
      const a0 = v(0), a1 = v(1), a2 = v(2), u = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], w = [a2[0] - a0[0], a2[1] - a0[1], a2[2] - a0[2]];
      const nn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const d = DIRV[VD[qi * 16 + 2] >> 12]; if (nn[0] * d[0] + nn[1] * d[1] + nn[2] * d[2] <= 0) bad++;
    }
    return bad;
  };
  ok(checkWinding(m3) === 0 && checkWinding(mesh(r2)) === 0, 'вершины — против часовой снаружи (грани не вывернуты)');
  // AO: блок на полу — нижние углы боковой грани затенены
  let ra = mk(); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) at(ra, x, 30, z, ID.stone); at(ra, 8, 31, 8, ID.dirt);
  const ma = mesh(ra);
  let aoSide = [];
  for (let qi = 0; qi < ma.solid.n; qi++) { const d = ma.solid.vd[qi * 16 + 2] >> 12; if (d !== 0) continue; for (let k = 0; k < 4; k++) { const y = ma.solid.pos[(qi * 4 + k) * 3 + 1] / 16; if (Math.abs(ma.solid.pos[(qi * 4 + k) * 3] / 16 - 9) < 1e-6) aoSide.push([y, ma.solid.vd[(qi * 4 + k) * 4 + 3] & 3]); } }
  ok(aoSide.length === 4 && aoSide.filter(([y, ao]) => y === 31 && ao < 3).length === 2 && aoSide.filter(([y, ao]) => y === 32 && ao === 3).length === 2, 'AO: у пола углы темнее, сверху — нет', aoSide);
  ok(ma.solid.pos.every(v => v >= 0 && v <= 16 * 16 * 8 + 1) && ma.solid.vd.every(v => v < 65536), 'числа вершин в пределах Uint16');

  // ═══ 5. Свет ═══
  sec('свет');
  let rl = mk(); rl.fill(ID.stone);
  for (let x = 4; x < 11; x++) for (let z = 4; z < 11; z++) for (let y = 30; y < 33; y++) at(rl, x, y, z, 0);
  at(rl, 7, 30, 7, ID.torch);
  let L = V.lightRegion(rl, V.T);
  const li = (x, y, z) => ((x + 16) * RW + (z + 16)) * H + y;
  ok(L.blk[li(7, 30, 7)] === 14 && L.blk[li(8, 30, 7)] === 13 && L.blk[li(10, 30, 7)] === 11 && L.blk[li(10, 32, 10)] === 6, 'факел: 14 и на шаг меньше (по шагам «манхэттен»)', [L.blk[li(7, 30, 7)], L.blk[li(8, 30, 7)], L.blk[li(10, 30, 7)], L.blk[li(10, 32, 10)]]);
  ok(L.blk[li(3, 30, 7)] === 0 && L.sky[li(7, 31, 7)] === 0, 'сквозь камень свет не идёт, неба в закрытой комнате нет');
  let rs = mk();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) at(rs, x, 50, z, ID.stone);   // пол
  for (let x = 5; x < 10; x++) for (let z = 5; z < 10; z++) at(rs, x, 54, z, ID.stone);   // крыша 5×5
  L = V.lightRegion(rs, V.T);
  ok(L.sky[li(0, 51, 0)] === 15 && L.sky[li(7, 51, 7)] === 12 && L.sky[li(5, 53, 7)] === 14, 'небо: открыто — 15, под крышей — меньше к середине', [L.sky[li(0, 51, 0)], L.sky[li(7, 51, 7)], L.sky[li(5, 53, 7)]]);
  let rf = mk(); for (let x = 0; x < 13; x++) for (let z = 0; z < 13; z++) for (let y = 40; y < 44; y++) at(rf, x, y, z, ID.leaves_oak);
  L = V.lightRegion(rf, V.T);
  ok(L.sky[li(6, 44, 6)] === 15 && L.sky[li(6, 43, 6)] === 14 && L.sky[li(6, 40, 6)] === 11 && L.sky[li(6, 39, 6)] === 11, 'листва: под каждым слоем на 1 темнее', [L.sky[li(6, 43, 6)], L.sky[li(6, 40, 6)], L.sky[li(6, 39, 6)]]);
  ok(L.sky[li(0, 40, 6)] === 14, 'с края кроны свет натекает сбоку', L.sky[li(0, 40, 6)]);
  // через границу чанков: факел у края — свет в соседнем чанке тот же из обеих областей
  const ws = new V.World({ seed: 5 });
  for (let cx = -2; cx <= 3; cx++) for (let cz = -2; cz <= 2; cz++) { const ch = new V.Chunk(cx, cz); ch.ids.fill(ID.stone); ws.add(ch); }
  for (let x = 10; x < 22; x++) for (let z = 4; z < 10; z++) for (let y = 30; y < 33; y++) ws.set(x, y, z, 0, { silent: true });
  ws.set(15, 30, 6, ID.torch, { silent: true });
  const regA = V.buildRegion((x, z) => ws.chunk(x, z)?.ids, 0, 0), regB = V.buildRegion((x, z) => ws.chunk(x, z)?.ids, 1, 0);
  const LA = V.lightRegion(regA, V.T), blkA = new Uint8Array(LA.blk), LB = V.lightRegion(regB, V.T);
  let diff = 0;
  for (let x = 10; x < 22; x++) for (let z = 4; z < 10; z++) for (let y = 30; y < 33; y++) { const a1 = blkA[((x + 16) * RW + (z + 16)) * H + y], b1 = LB.blk[((x - 16 + 16) * RW + (z + 16)) * H + y]; if (a1 !== b1) diff++; }
  ok(diff === 0 && blkA[((16 + 16) * RW + (6 + 16)) * H + 30] === 13, 'свет через границу: обе области считают одинаково', diff);

  // ═══ 6. Луч и столкновения ═══
  sec('луч и столкновения');
  const W = new V.World({ seed: 1 });
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const ch = new V.Chunk(cx, cz); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 60; y++) ch.ids[(x << 11) | (z << 7) | y] = ID.stone; W.add(ch); }
  let hit = V.raycast(W, 2.5, 65, 2.5, 0, -1, 0, 10);
  ok(hit && hit.x === 2 && hit.y === 59 && hit.z === 2 && hit.ny === 1, 'луч вниз — верх блока, нормаль вверх', hit);
  W.set(5, 61, 2, ID.stone);
  hit = V.raycast(W, 2.5, 61.5, 2.5, 1, 0, 0, 10);
  ok(hit && hit.x === 5 && hit.nx === -1 && Math.abs(hit.t - 2.5) < 1e-6, 'луч вбок — грань −x на расстоянии 2,5', hit);
  W.set(5, 60, 5, V.cell(ID.torch, 0));
  hit = V.raycast(W, 5.5, 62, 5.1, 0, -1, 0, 5);
  ok(hit && hit.x === 5 && hit.y === 59, 'мимо тонкого факела — дальше (рамка факела узкая)', hit);
  ok(!V.raycast(W, 2.5, 65, 2.5, 0, 1, 0, 10), 'луч в небо — ничего');
  const box = { x: 2.5, y: 60, z: 2.5, w: .6, h: 1.8 };
  V.moveBox(W, box, 0, -1, 0);
  ok(box.y === 60 && box.hitY, 'стоит на полу (не проваливается)');
  V.moveBox(W, box, 5, 0, 0);
  ok(Math.abs(box.x - (5 - .3)) < 1e-6 && box.hitX, 'упёрся в стену', box.x);
  ok(V.boxHits(W, 5.5, 61, 2.5, .6, 1.8) && !V.boxHits(W, 2.5, 60, 2.5, .6, 1.8), 'проверка «влезет ли»');
  const T0 = V.touching(W, 2.5, 60, 2.5, .6, 1.8, {});
  ok(T0.water === 0 && !T0.climb, 'вокруг — ни воды, ни лестниц');
  W.set(3, 60, 2, ID.water); W.set(3, 61, 2, ID.water);
  ok(V.touching(W, 3.5, 60, 2.5, .6, 1.8, {}).water > 1.5, 'в воде — глубина');

  // ═══ 7. Рецепты ═══
  sec('рецепты');
  const G3x3 = a2 => a2.flat().map(v => v || null);
  ok(V.craft(G3x3([['log_oak', null], [null, null]]), 2, 2)?.out === 'planks_oak', 'бревно → доски (в любом месте сетки)');
  ok(V.craft(G3x3([[null, null, null], [null, 'planks_birch', null], [null, 'planks_oak', null]]), 3, 3)?.out === 'stick', 'палки из любых досок');
  ok(V.craft(G3x3([['planks_oak', 'planks_oak'], ['planks_spruce', 'planks_oak']]), 2, 2)?.out === 'crafting_table', 'верстак 2×2');
  const pick = [['cobble', 'cobble', 'cobble'], [null, 'stick', null], [null, 'stick', null]];
  ok(V.craft(G3x3(pick), 3, 3)?.out === 'pick_stone', 'каменная кирка');
  const axeL = [['iron_ingot', 'iron_ingot', null], ['iron_ingot', 'stick', null], [null, 'stick', null]], axeR = [[null, 'iron_ingot', 'iron_ingot'], [null, 'stick', 'iron_ingot'], [null, 'stick', null]];
  ok(V.craft(G3x3(axeL), 3, 3)?.out === 'axe_iron' && V.craft(G3x3(axeR), 3, 3)?.out === 'axe_iron', 'топор — и зеркально');
  ok(!V.craft(G3x3([['stick', 'stick'], ['stick', null]]), 2, 2), 'неверный узор — ничего');
  ok(V.smelting.get('ore_iron')?.out === 'iron_ingot' && V.item('coal').fuel > 0, 'печь: руда → слиток, уголь — топливо');

  // ═══ 8. Сохранение ═══
  sec('сохранение');
  const S = V.store;
  const em = new Map([[0, ID.stone], [32767, V.cell(ID.torch, 3)], [12345, 0]]);
  const back = S.unpackEdits(S.packEdits(em));
  ok(back.size === 3 && back.get(0) === ID.stone && back.get(32767) === V.cell(ID.torch, 3) && back.get(12345) === 0, 'правки → числа → правки');
  await S.putWorld({ id: 'wt', name: 'Тест', seed: '42', mode: 'survival', palette: V.blocks.map(b => b.name) });
  await S.putChunks('wt', [{ cx: 1, cz: -2, e: S.packEdits(em), t: [[5, { items: [{ id: 'stone', n: 3 }] }]] }, { cx: 40, cz: 40, e: new Uint32Array(0), t: [] }]);
  const keys = await S.chunkKeys('wt');
  ok(keys.has('1|-2') && !keys.has('40|40'), 'в базе — только чанки с правками (пустой не пишется)', [...keys]);
  const rec = await S.chunk('wt', 1, -2);
  ok(rec && rec.e.length === 3 && rec.t[0][1].items[0].id === 'stone', 'чанк читается с плитками');
  const file = await S.exportWorld('wt');
  const w2 = await S.importWorld(JSON.parse(JSON.stringify(file)), 'wt2');
  const rec2 = await S.chunk('wt2', 1, -2);
  ok(w2.name === 'Тест' && rec2 && hashArr(rec2.e) === hashArr(rec.e), 'файл мира: выгрузить → загрузить (правки те же)');
  let bad = null; try { await S.importWorld({ format: 'другое' }, 'x'); } catch (e) { bad = e.message; }
  ok(bad && /файл/.test(bad), 'чужой файл — понятная ошибка', bad);
  const evil = JSON.parse(JSON.stringify(file)); evil.chunks[0].e = Buffer.from(new Uint32Array([0xffff0001]).buffer).toString('base64');
  await S.importWorld(evil, 'wt3');
  ok(!(await S.chunkKeys('wt3')).has('1|-2'), 'испорченный чанк (номер ячейки за пределами) — не загружается');
  // палитра: сохранили с одной нумерацией — читаем с другой
  const pal = ['air', 'stone', 'mod:ruby', 'dirt'], remap = pal.map(n => V.block(n)?.id ?? ID.missing);
  ok(remap[2] === ID.missing && remap[3] === ID.dirt, 'блок выключенного мода → «Неизвестный блок», остальное — по имени');
  await S.delWorld('wt');
  ok(!(await S.world('wt')) && (await S.chunkKeys('wt')).size === 0, 'удаление мира стирает его чанки');

  // ═══ 9. Подгрузка (в кадре, без потоков) ═══
  sec('подгрузка мира');
  const WW = new V.World({ seed: 'поток' });
  let meshed = 0, dropped = 0;
  const ST = V.streamer({ world: WW, rd: 2, onMesh: () => meshed++, onDrop: () => dropped++, budgetMs: 1e9, budgetQuads: 1e9 });
  for (let i = 0; i < 200 && meshed < 25; i++) ST.update(8, 8, 0, 1);
  ok(ST.inline && meshed >= 21, 'без потоков всё строится в кадре: сетки ближних чанков', meshed);
  ok(WW.chunk(0, 0).ready && WW.chunk(0, 0).light && WW.chunk(0, 0).meshRev >= 0, 'у чанка есть блоки, свет и сетка');
  const before = meshed;
  WW.set(8, 70, 8, ID.stone); ST.touch(8, 8, 3);
  for (let i = 0; i < 10; i++) ST.update(8, 8, 0, 1);
  ok(meshed > before, 'правка — сетка пересобрана');
  for (let i = 0; i < 60; i++) ST.update(8 + 16 * 12, 8, 1, 0);
  for (let i = 0; i < 4; i++) { ST.update(8 + 16 * 12, 8, 1, 0); }
  await new Promise(r => setTimeout(r, 600)); ST.update(8 + 16 * 12, 8, 1, 0);
  ok(dropped > 0 && !WW.chunk(0, 0), 'далёкие чанки выгружаются', dropped);
  ST.close();

  // ═══ 10. Скорость: генерация + свет + сетка на чанк ═══
  sec('скорость (node)');
  const GB = V.genInit(777), map = new Map(), N = 7;
  for (let cx = -1; cx <= N; cx++) for (let cz = -1; cz <= 1; cz++) map.set(cx + ',' + cz, V.genChunk(GB, cx, cz));   // прогрев
  let tg = 0, tl = 0, tm = 0, quads = 0, n = 0;
  const reg = new Uint16Array(RC);
  for (let cx = 20; cx < 20 + N; cx++) for (let cz = 0; cz < 3; cz++) { const t0 = performance.now(); map.set(cx + ',' + cz, V.genChunk(GB, cx, cz)); tg += performance.now() - t0; n++; }
  for (let cx = 20; cx < 20 + N; cx++) map.set(cx + ',-1', V.genChunk(GB, cx, -1)), map.set(cx + ',3', V.genChunk(GB, cx, 3));
  map.set('19,0', V.genChunk(GB, 19, 0)); map.set('19,1', V.genChunk(GB, 19, 1)); map.set('19,2', V.genChunk(GB, 19, 2)); map.set('19,-1', V.genChunk(GB, 19, -1)); map.set('19,3', V.genChunk(GB, 19, 3));
  map.set((20 + N) + ',0', V.genChunk(GB, 20 + N, 0)); map.set((20 + N) + ',1', V.genChunk(GB, 20 + N, 1)); map.set((20 + N) + ',2', V.genChunk(GB, 20 + N, 2)); map.set((20 + N) + ',-1', V.genChunk(GB, 20 + N, -1)); map.set((20 + N) + ',3', V.genChunk(GB, 20 + N, 3));
  let nm = 0;
  for (let cx = 20; cx < 20 + N; cx++) for (let cz = 0; cz < 3; cz++) {
    V.buildRegion((x, z) => map.get(x + ',' + z)?.ids, cx, cz, reg);
    const t0 = performance.now(); const LL = V.lightRegion(reg, V.T); const t1 = performance.now(); const mm = V.meshChunk(reg, LL, V.T, map.get(cx + ',' + cz).tint); const t2 = performance.now();
    tl += t1 - t0; tm += t2 - t1; nm++;
    quads += (mm.solid?.n || 0) + (mm.cutout?.n || 0) + (mm.water?.n || 0);
  }
  const perf = { gen: +(tg / n).toFixed(2), light: +(tl / nm).toFixed(2), mesh: +(tm / nm).toFixed(2), quads: Math.round(quads / nm) };
  console.log('  на чанк, мс:', JSON.stringify(perf));
  ok(perf.gen < 40 && perf.light < 40 && perf.mesh < 40, 'чанк собирается быстро (генерация, свет, сетка — каждое < 40 мс)', perf);
  ok(perf.quads > 300 && perf.quads < 12000, 'квадратов на чанк — разумно', perf.quads);

  // ═══ 11. Моды ═══
  if (fs.existsSync(path.join(SITE, 'scripts/voxel-test-mods.cjs'))) await require('./voxel-test-mods.cjs')({ ok, sec, load, SITE, CORE });

  console.log(`\nvoxel-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

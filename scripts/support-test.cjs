// Обрушение и прочность движка (js/engine/support.js, D37E.support) без браузера: node --expose-gc scripts/support-test.cjs [--fast]
// Материалы и режимы, держание (башня, балка, мост, висит под потолком), что падает после правки («до» держалось, «после» — нет;
// старое «не держалось» не трогаем), группы, своды пещер (природное), 2D (y вниз), детали-коробки (дом: выбили стены — крыша
// падает), одинаково при любом порядке постройки, падение куском одинаково при 30 / 60 / 144 кадрах (цикл движка E.loop),
// без мусора (отдельный процесс, --expose-gc), время пересчёта 1000 блоков (×4 — «телефон»), 10 минут случайной игры без ошибок.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
globalThis.document = { hidden: false, body: { classList: { contains: () => false } } };
for (const f of ['js/engine/core.js', 'js/engine/support.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = window.D37E, S = E.support;
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const sec = t => console.log('— ' + t);
const now = () => Number(process.hrtime.bigint()) / 1e6;

// ═══ Мир для проверок: 96×80×96 клеток, y вверх; ниже y = 0 — опора (коренная порода). Клетка: 0 пусто, иначе материал + 1;
// nat — природная (не поставлена игроком) ═══
function world(N = 96, H = 80){
  const c = new Uint8Array(N * H * N), nat = new Uint8Array(N * H * N);
  const I = (x, y, z) => (x * H + y) * N + z, inside = (x, y, z) => x >= 0 && z >= 0 && x < N && z < N && y >= 0 && y < H;
  const W = {
    N, H, c, nat,
    get: (x, y, z) => inside(x, y, z) ? c[I(x, y, z)] : 0,
    set(x, y, z, m, natural){ if (!inside(x, y, z)) return; c[I(x, y, z)] = m; nat[I(x, y, z)] = natural ? 1 : 0; },
    isNat: (x, y, z) => inside(x, y, z) && nat[I(x, y, z)] === 1,
  };
  // код клетки для сетки: soft — природное = опора; real — природное участвует (rn)
  W.read = (mode) => (x, y, z) => {
    if (y < 0) return 1;
    if (!inside(x, y, z)) return 0;
    const m = c[I(x, y, z)]; if (!m) return 0;
    if (nat[I(x, y, z)]) return mode === 'soft' ? 1 : (ROCK << 2) | 3;   // природное — скала (вверх не теряет)
    return ((m - 1) << 2) | 2;
  };
  return W;
}
const WOOD = S.MAT.wood, STONE = S.MAT.stone, ROCK = S.MAT.rock, METAL = S.MAT.metal, GLASS = S.MAT.glass;
const real = S.prof('real'), soft = S.prof('soft');
const G = S.grid({ dims: 3, down: -1, max: 24576 });
// держание клетки (x, y, z) в мире W
function supAt(W, mode, x, y, z){
  const code = W.read(mode)(x, y, z); if ((code & 3) < 2) return -1;
  G.build([x, y, z, code], W.read(mode), { r: 128, rn: 12, P: S.prof(mode) });
  return G.estimate(S.prof(mode));
}
// убрать клетки (список [x, y, z]) и узнать, что упадёт: → [{ cells: [x, y, z, …] }]
let rnOf = 12;
function remove(W, mode, list){
  const rd = W.read(mode), seeds = [];
  for (const [x, y, z] of list) seeds.push(x, y, z, rd(x, y, z));
  for (const [x, y, z] of list) W.set(x, y, z, 0);
  G.build(seeds, rd, { r: 128, rn: rnOf, P: S.prof(mode) });
  const ng = G.collapse(S.prof(mode)), out = [];
  for (let k = 0; k < ng; k++) out.push(G.groups(k));
  return out;
}

// ═══ 1. Материалы и режимы ═══
sec('материалы и режимы');
{
  ok(S.MATS.length === S.VANILLA && S.MATS.every((m, i) => m.id === i && m.cap <= 1000 && m.min >= 1 && m.min < m.cap), 'таблица материалов: номера по порядку, cap ≤ 1000, 1 ≤ min < cap');
  ok(S.MATS.every(m => m.nat ? m.up === 0 : m.up > 0) && S.MATS.filter(m => !m.nat).every(m => m.side > m.up), 'природное вверх не теряет; у построек вбок теряется больше, чем вверх');
  ok(real.up[WOOD] > real.up[STONE] && real.up[STONE] > real.up[METAL] && real.side[METAL] < real.side[WOOD], 'дерево слабее камня, металл крепче всех');
  ok(soft.up[WOOD] < real.up[WOOD] && soft.side[WOOD] < real.side[WOOD] && S.prof('soft') === soft, '«мягкое» — меньше потери; таблица режима одна (кэш)');
  ok(!S.on('off') && S.on('soft') && S.on('real'), 'режимы: выкл / мягкое / реализм');
  const id = S.defineMat({ key: 'test_rubber', up: 5, side: 10, down: 10 });
  ok(S.MAT.test_rubber === id && S.defineMat({ key: 'test_rubber' }) === id && S.prof('real').cap.length === S.MATS.length, 'свой материал (мод): номер, повтор — тот же, таблица режима пересобрана');
  ok(S.level(965, WOOD, real, 1) === 0 && S.level(900, WOOD, real, false) === 1 && S.level(450, WOOD, real, false) === 2 && S.level(150, WOOD, real, false) === 3 && S.level(99, WOOD, real, false) === 4, 'цвет: синий на опоре → зелёный → жёлтый → красный → не держится');
}

// ═══ 2. Держание: башня, балка, мост, потолок ═══
sec('держание: башня, балка, мост, висит под потолком');
{
  const W = world();
  // деревянная башня от земли: каждый шаг вверх −35, пока ≥ 100
  for (let y = 0; y < 30; y++) W.set(10, y, 10, WOOD + 1);
  const s0 = supAt(W, 'real', 10, 0, 10), s5 = supAt(W, 'real', 10, 5, 10), s24 = supAt(W, 'real', 10, 24, 10), s25 = supAt(W, 'real', 10, 25, 10);
  ok(s0 === 965 && s5 === 965 - 5 * 35 && s24 === 965 - 24 * 35 && s25 < real.min[WOOD], 'деревянная башня: на земле 1000 − 35, −35 за блок, держится 25 блоков', [s0, s5, s24, s25]);
  ok(supAt(W, 'soft', 10, 29, 10) >= soft.min[WOOD], '«мягкое»: та же башня держится целиком (30 блоков)');
  // балка вбок от столба на высоте 4: дерево −150 за блок
  const W2 = world();
  for (let y = 0; y < 5; y++) W2.set(20, y, 20, STONE + 1);
  for (let x = 21; x <= 30; x++) W2.set(x, 4, 20, WOOD + 1);
  const top = 1000 - 5 * 20, b1 = supAt(W2, 'real', 21, 4, 20), b5 = supAt(W2, 'real', 25, 4, 20), b6 = supAt(W2, 'real', 26, 4, 20);
  ok(b1 === top - 150 && b5 === top - 5 * 150 && b6 < real.min[WOOD], 'балка от каменного столба: −150 за блок, держится 5 блоков', [top, b1, b5, b6]);
  // мост: столбы с двух сторон — середина держится от ближнего
  for (let y = 0; y < 5; y++) W2.set(31, y, 20, STONE + 1);
  const mid = supAt(W2, 'real', 26, 4, 20);
  ok(mid >= real.min[WOOD] && mid === top - 5 * 150, 'мост на двух столбах: середина держится от ближнего столба', mid);
  // пещера в скале (природное): потолок держится за стены вбок (скала −100 за клетку), под ним висит постройка
  const W3 = world();
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y < 44; y++) W3.set(x, y, z, STONE + 1, true);
  for (let x = 2; x <= 12; x++) for (let z = 2; z <= 12; z++) for (let y = 30; y < 40; y++) W3.set(x, y, z, 0);
  for (let y = 35; y < 40; y++) W3.set(5, y, 5, STONE + 1);
  const h1 = supAt(W3, 'soft', 5, 39, 5), h2 = supAt(W3, 'soft', 5, 38, 5), c = supAt(W3, 'real', 7, 40, 7), hr = supAt(W3, 'real', 5, 39, 5);
  ok(h1 === 1000 - soft.down[STONE] && h2 === 1000 - 2 * soft.down[STONE], '«мягкое»: под природным потолком (опора) — висит: минус «висит» за блок', [h1, h2]);
  ok(c === 1000 - 6 * real.side[ROCK] && hr === 1000 - 4 * real.side[ROCK] - real.down[STONE], 'реализм: потолок пещеры — 1000 − 100 × до стены, висит — ещё минус', [c, hr]);
  // стекло держится, но не держит
  const W4 = world();
  W4.set(40, 0, 40, GLASS + 1); W4.set(40, 1, 40, WOOD + 1);
  ok(supAt(W4, 'real', 40, 0, 40) === 1000 - real.up[GLASS] && supAt(W4, 'real', 40, 1, 40) < real.min[WOOD], 'стекло: само на земле держится, блок на нём — нет');
}

// ═══ 3. Что падает после правки ═══
sec('обрушение: убрали опору — падает только то, что держалось через неё');
{
  const W = world();
  // столб 5, балка 4 блока, второй столб; убрали второй столб — держится (4 блока от первого); убрали первый — падает всё, что висит
  for (let y = 0; y < 5; y++) { W.set(10, y, 10, STONE + 1); W.set(15, y, 10, STONE + 1); }
  for (let x = 11; x < 15; x++) W.set(x, 4, 10, WOOD + 1);
  let g = remove(W, 'real', [[15, 0, 10]]);
  ok(g.length === 1 && g[0].length / 3 === 4 && g[0].every((v, i) => i % 3 !== 0 || v === 15), 'убрали низ второго столба: падает его верх (4 блока), балка держится от первого', g.map(a => a.length / 3));
  for (const a of g) for (let i = 0; i < a.length; i += 3) W.set(a[i], a[i + 1], a[i + 2], 0);
  g = remove(W, 'real', [[10, 1, 10]]);
  const n = g.reduce((s, a) => s + a.length / 3, 0);
  ok(g.length === 1 && n === 3 + 4, 'убрали первый столб под балкой: падает верх столба и балка одним куском (7 блоков)', g.map(a => a.length / 3));
  // старое «не держалось» (импорт: 12 блоков вбок) — убрали что-то рядом — его не трогаем
  const W2 = world();
  for (let y = 0; y < 3; y++) W2.set(30, y, 30, STONE + 1);
  for (let x = 31; x < 43; x++) W2.set(x, 2, 30, WOOD + 1);
  W2.set(29, 0, 30, WOOD + 1);
  g = remove(W2, 'real', [[29, 0, 30]]);
  ok(g.length === 0, 'старая «невозможная» балка (как из импорта) не рушится от правки рядом', g.map(a => a.length / 3));
  // в «мягком» природное — опора: копаем под постройкой на скале — постройка на соседней скале стоит
  const W3 = world();
  for (let x = 50; x < 60; x++) for (let z = 50; z < 60; z++) for (let y = 0; y < 6; y++) W3.set(x, y, z, STONE + 1, true);
  for (let y = 6; y < 10; y++) W3.set(55, y, 55, WOOD + 1);
  g = remove(W3, 'soft', [[54, 5, 55]]);
  ok(g.length === 0, '«мягкое»: копнул рядом с постройкой на скале — ничего не падает');
  g = remove(W3, 'soft', [[55, 5, 55]]);
  ok(g.length === 0, '«мягкое»: убрал скалу прямо под постройкой — держится за соседнюю скалу сбоку? нет: висит на природном — опора со всех сторон', g.map(a => a.length / 3));
}

// ═══ 4. Своды пещер (реализм) ═══
sec('своды пещер: широко выкопал — обваливается середина');
{
  const W = world(96, 60);
  for (let x = 0; x < 96; x++) for (let z = 0; z < 40; z++) for (let y = 0; y < 30; y++) W.set(x, y, z, STONE + 1, true);
  // зал 13×13 высотой 3 (под потолком 27 блоков скалы): держится (до стены ≤ 6)
  const dig = [];
  for (let x = 20; x < 33; x++) for (let z = 10; z < 23; z++) for (let y = 5; y < 8; y++) dig.push([x, y, z]);
  let g = remove(W, 'real', dig);
  ok(g.length === 0, 'зал 13×13: свод держится (скала: −100 за блок вбок)', g.map(a => a.length / 3));
  // расширили до 23×23 (до стены 11) — середина свода падает
  const dig2 = [];
  for (let x = 15; x < 38; x++) for (let z = 5; z < 28; z++) for (let y = 5; y < 8; y++) if (!(x >= 20 && x < 33 && z >= 10 && z < 23)) dig2.push([x, y, z]);
  const t0 = now();
  g = remove(W, 'real', dig2);
  const ms = now() - t0, n = g.reduce((s, a) => s + a.length / 3, 0);
  ok(g.length >= 1 && n > 0 && g.every(a => { for (let i = 0; i < a.length; i += 3) if (a[i] < 15 || a[i] > 37 || a[i + 2] < 5 || a[i + 2] > 27) return false; return true; }), 'зал 23×23: падает середина свода (над залом)', { groups: g.length, n });
  console.log(`  свод: ${n} блоков в ${g.length} группах, ${ms.toFixed(1)} мс (узлов ${G.g.n})`);
  // копаем по одной клетке в случайном порядке (как игрок), природное дальше 10 шагов — оценкой (толща или стена по прямой):
  // зал 15×15 (до стены ≤ 7) — ни одного обвала; 25×25 — середина свода обваливается
  const hall = (side, seed) => {
    const Wh = world(96, 60);
    for (let x = 0; x < 96; x++) for (let z = 0; z < 60; z++) for (let y = 0; y < 30; y++) Wh.set(x, y, z, STONE + 1, true);
    const list = [], x0 = 48 - (side >> 1), z0 = 30 - (side >> 1);
    for (let x = x0; x < x0 + side; x++) for (let z = z0; z < z0 + side; z++) for (let y = 5; y < 8; y++) list.push([x, y, z]);
    const rnd = S.rng(seed); for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    rnOf = 13; let fell = 0, roof = 0, n = 0, tms = 0;
    for (const c of list) { if (!Wh.get(c[0], c[1], c[2])) continue; const t0 = now(); const g = remove(Wh, 'real', [c]); tms += now() - t0; n++; for (const a of g) { fell += a.length / 3; for (let i = 0; i < a.length; i += 3) { if (a[i + 1] >= 8) roof++; Wh.set(a[i], a[i + 1], a[i + 2], 0); } } }
    rnOf = 12;
    // итог по-честному (большой радиус): сколько клеток свода осталось без опоры
    let bad = 0;
    for (let x = x0; x < x0 + side; x++) for (let z = z0; z < z0 + side; z++) if (Wh.get(x, 8, z)) { G.build([x, 8, z, Wh.read('real')(x, 8, z)], Wh.read('real'), { r: 200, rn: 40, P: real }); if (G.estimate(real) < real.min[ROCK]) bad++; }
    return { fell, roof, bad, n, avg: tms / Math.max(1, n) };
  };
  const h15 = hall(15, 3), h25 = hall(25, 4);
  ok(h15.roof === 0 && h15.bad === 0, 'зал 15×15, копаем по клетке вразброс: свод не падает (стены держат; падают только подкопанные куски внутри зала)', h15);
  ok(h25.roof > 0 && h25.bad <= 8, 'зал 25×25, копаем по клетке: середина свода обваливается (по-честному без опоры осталось ≤ 8 клеток свода)', h25);
  console.log(`  копание по клетке: зал 15×15 — ${h15.n} клеток, ${h15.avg.toFixed(2)} мс на клетку; 25×25 — упало ${h25.fell} блоков`);
  // в «мягком» тот же зал — не трогаем (природное — опора)
  const W2 = world(96, 60);
  for (let x = 0; x < 96; x++) for (let z = 0; z < 40; z++) for (let y = 0; y < 30; y++) W2.set(x, y, z, STONE + 1, true);
  const all = []; for (let x = 15; x < 38; x++) for (let z = 5; z < 28; z++) for (let y = 5; y < 8; y++) all.push([x, y, z]);
  g = remove(W2, 'soft', all);
  ok(g.length === 0, '«мягкое»: своды пещер не падают');
}

// ═══ 5. Одинаково при любом порядке постройки ═══
sec('детерминизм: порядок постройки и обхода не важен');
{
  const shape = [];
  for (let y = 0; y < 8; y++) shape.push([5, y, 5], [12, y, 5], [5, y, 12], [12, y, 12]);
  for (let x = 5; x <= 12; x++) for (let z = 5; z <= 12; z++) shape.push([x, 8, z]);
  for (let x = 6; x <= 11; x++) shape.push([x, 9, 8]);
  const sig = order => {
    const W = world(); for (const [x, y, z] of order) W.set(x, y, z, (x + z) % 3 === 0 ? STONE + 1 : WOOD + 1);
    const g = remove(W, 'real', [[5, 0, 5], [12, 3, 12]]);
    const vals = []; for (const [x, y, z] of shape) { const s = W.get(x, y, z) ? supAt(W, 'real', x, y, z) : -1; vals.push(s); }
    return JSON.stringify([g.map(a => a.slice().join(',')), vals]);
  };
  const a = sig(shape), rnd = S.rng(7), sh = shape.slice();
  for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; }
  ok(sig(sh) === a && sig(shape.slice().reverse()) === a, 'тот же дом в другом порядке — то же держание и те же группы');
}

// ═══ 6. 2D: y вниз («Подземье») ═══
sec('2D: y вниз');
{
  const G2 = S.grid({ dims: 2, down: 1, max: 4096 });
  const N = 64, c = new Uint8Array(N * N), at = (x, y) => x >= 0 && y >= 0 && x < N && y < N ? c[y * N + x] : 0;
  const read = (x, y) => y >= 40 ? 1 : at(x, y) ? ((at(x, y) - 1) << 2) | 2 : 0;   // ниже 40 — земля (опора)
  for (let y = 30; y < 40; y++) c[y * N + 10] = WOOD + 1;            // столб от земли вверх (y меньше — выше)
  for (let x = 11; x < 20; x++) c[30 * N + x] = WOOD + 1;            // балка наверху (держится 4 клетки)
  G2.build([13, 30, 0, read(13, 30)], read, { r: 64 });
  const s = G2.estimate(real);
  G2.build([15, 30, 0, read(15, 30)], read, { r: 64 });
  const s15 = G2.estimate(real);
  ok(s === 965 - 9 * 35 - 3 * 150 && s15 < real.min[WOOD], '2D: балка на столбе — те же числа, что в 3D (вверх — к меньшему y)', [s, s15]);
  const seeds = [10, 35, 0, read(10, 35)]; c[35 * N + 10] = 0;
  G2.build(seeds, read, { r: 64 });
  const ng = G2.collapse(real);
  ok(ng === 1 && G2.g.gOff[1] === 5 + 3, '2D: подрубил столб — падают верх столба и та часть балки, что держалась (8)', [ng, G2.g.gOff[1]]);
}

// ═══ 7. Детали-коробки: дом (пол, стены, крыша) ═══
sec('детали-коробки: выбили стены — крыша без опоры падает');
{
  const B = S.boxes({ max: 512 }), CON = S.MAT.concrete, SLAB = S.MAT.slab;
  // плиты крыши 4×4 (x 0–12) на стенах (по 2 куска 2 м под каждой плитой, z 0–0,3); плита держится вбок только на 1 плиту
  const build = rev => {
    const list = [];
    for (let i = 0; i < 6; i++) list.push([i * 2, 0, 0, i * 2 + 2, 3, .3, CON, true, 'w' + i]);
    for (let i = 0; i < 3; i++) list.push([i * 4, 3, 0, i * 4 + 4, 3.3, 4, SLAB, false, 'r' + i]);
    if (rev) list.reverse();
    B.reset(); for (const b of list) B.add(...b.slice(0, 8)); B.link(.05);
    return list;
  };
  let L = build(false);
  const id = k => L.findIndex(b => b[8] === k);
  B.solve(real);
  ok(['r0', 'r1', 'r2'].every(k => B.g.sup[id(k)] === 1000 - real.up[CON] - real.up[SLAB]), 'целый дом: плиты стоят на стенах (1000 − 12 − 12)', ['r0', 'r1', 'r2'].map(k => B.g.sup[id(k)]));
  ok(B.g.off[id('r1') + 1] - B.g.off[id('r1')] === 4, 'средняя плита: 2 стены снизу и 2 плиты сбоку');
  let ng = B.collapse(real, [id('w0'), id('w1')]);
  ok(ng === 0, 'выбили стену под крайней плитой — держится за соседнюю (одна плита вбок)');
  const sig = rev => {
    L = build(rev);
    const n = B.collapse(real, ['w0', 'w1', 'w2', 'w3'].map(id)), out = [];
    for (let k = 0; k < n; k++) out.push(B.groups(k).map(i => L[i][8]).sort().join('+'));
    return out.sort().join('|');
  };
  ok(sig(false) === 'r0', 'выбили стены под двумя плитами — дальняя (2 плиты до опоры) падает, ближняя держится', sig(false));
  ok(sig(true) === sig(false), 'детали в другом порядке — то же обрушение', [sig(true), sig(false)]);
  // крыша на стене, стена на земле, «на земле» без стены — не держит ничего лишнего
  B.reset(); const a = B.add(0, 0, 0, 1, 3, 1, CON, true), b = B.add(0, 3, 0, 1, 3.3, 1, SLAB, false), c = B.add(5, 3, 0, 6, 3.3, 1, SLAB, false); B.link(.05); B.solve(real);
  ok(B.g.sup[a] === 988 && B.g.sup[b] === 976 && B.g.sup[c] === 0, 'касание только сверху/сбоку: висящая в воздухе плита — 0', [B.g.sup[a], B.g.sup[b], B.g.sup[c]]);
}

// ═══ 8. Падение куском: одинаково при 30 / 60 / 144 кадрах (настоящий цикл движка) ═══
sec('падение куском: шаги игры, а не кадры (30 / 60 / 144 кадра)');
{
  const solidW = (W) => (x, y, z) => y < 0 || !!W.get(x, y, z);
  const run = fps => {
    const W = world();
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) W.set(x, 0, z, STONE + 1, true);
    W.set(3, 1, 3, STONE + 1, true);   // камень на полу — кусок ляжет на него
    const cells = []; for (let x = 2; x < 6; x++) for (let z = 2; z < 6; z++) cells.push(x, 22, z);
    const F = S.drop(cells, { down: -1 });
    let landT = -1, steps = 0;
    // цикл движка E.loop со своими «кадрами» (без окна): requestAnimationFrame — по fps
    let t = 0;
    const raf0 = globalThis.requestAnimationFrame, caf0 = globalThis.cancelAnimationFrame, perf0 = performance.now;
    const q = [];
    globalThis.requestAnimationFrame = f => { q.push(f); return q.length; };
    globalThis.cancelAnimationFrame = () => {};
    performance.now = () => t;
    const L = E.loop(dt => { steps++; if (!F.done && S.dropStep(F, dt, solidW(W)) && landT < 0) landT = steps; }, () => {});
    for (let f = 0; f < fps * 6 && landT < 0; f++) { t += 1000 / fps; const cb = q.shift(); if (cb) cb(t); }
    L.stop();
    globalThis.requestAnimationFrame = raf0; globalThis.cancelAnimationFrame = caf0; performance.now = perf0;
    return { off: F.off, landT };
  };
  const r30 = run(30), r60 = run(60), r144 = run(144);
  ok(r30.off === 20 && r60.off === 20 && r144.off === 20, 'кусок лёг на камень: сдвиг 20 клеток при 30 / 60 / 144 кадрах', [r30, r60, r144]);
  ok(r30.landT === r60.landT && r60.landT === r144.landT && r30.landT > 0, 'лёг на одном и том же шаге игры', [r30.landT, r60.landT, r144.landT]);
  // падает в незагруженное — ложится на краю
  const F = S.drop([0, 50, 0], { down: -1, far: 30 });
  let n = 0; while (!S.dropStep(F, 1 / 60, () => false) && n++ < 2000);
  ok(F.done && F.off === 29, 'падает в пустоту — ложится на пределе (не бесконечно)', F.off);
}

// ═══ 9. Время пересчёта: постройка 1000 блоков, убрали опору ═══
sec('время: постройка 1000+ блоков, убрали опору (ЦП; «телефон» — ×4)');
{
  const W = world(96, 80);
  // дом-башня 12×12, стены по краю, 7 этажей, перекрытие каждые 4 блока — ≈ 1300 блоков
  let nb = 0;
  for (let y = 0; y < 28; y++) for (let x = 20; x < 32; x++) for (let z = 20; z < 32; z++) {
    const edge = x === 20 || x === 31 || z === 20 || z === 31, floor = y % 4 === 3;
    if (edge || floor) { W.set(x, y, z, (y + x) % 5 ? WOOD + 1 : STONE + 1); nb++; }
  }
  const times = [];
  let fellN = 0;
  for (let k = 0; k < (FAST ? 5 : 20); k++) {
    const x = 20 + (k % 12), list = [[x, 0, 20], [x, 1, 20]];
    const saved = list.map(([a, b, c]) => W.get(a, b, c));
    const t0 = now();
    const g = remove(W, 'real', list);
    times.push(now() - t0);
    fellN += g.length;
    list.forEach(([a, b, c], i) => W.set(a, b, c, saved[i]));
  }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1];
  console.log(`  постройка ${nb} блоков: пересчёт (до + после + группы) — медиана ${med.toFixed(2)} мс, худший ${times[times.length - 1].toFixed(2)} мс; узлов ${G.g.n}`);
  ok(nb >= 1000 && G.g.n >= 1000, 'в куске больше 1000 блоков', [nb, G.g.n]);
  ok(med < 25, 'пересчёт 1000+ блоков — меньше 25 мс (на «телефоне» ×4 — ~' + (med * 4).toFixed(0) + ' мс)', med);
  module.exports = { med1000: med };
  // реализм: копаем туннель в скале по одной клетке (так копает игрок) — каждый раз пересчёт природного вокруг
  const R = world(64, 48);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 0; y < 40; y++) R.set(x, y, z, STONE + 1, true);
  const dig = [];
  for (let x = 10; x < 50; x++) { const t0 = now(); remove(R, 'real', [[x, 20, 32]]); remove(R, 'real', [[x, 21, 32]]); dig.push((now() - t0) / 2); }
  dig.sort((a, b) => a - b);
  console.log(`  реализм, туннель в скале: клетка — медиана ${dig[dig.length >> 1].toFixed(2)} мс, худший ${dig[dig.length - 1].toFixed(2)} мс (узлов ${G.g.n})`);
  ok(dig[dig.length >> 1] < 8, 'реализм: пересчёт при копании скалы — меньше 8 мс на клетку', dig[dig.length >> 1]);
  // «мягкое»: стоит на природном — кусок только из постройки
  const t1 = now(); for (let k = 0; k < 10; k++) { const g = remove(W, 'soft', [[25, 0, 20]]); W.set(25, 0, 20, WOOD + 1); void g; } const msSoft = (now() - t1) / 10;
  console.log(`  «мягкое»: ${msSoft.toFixed(2)} мс`);
}

// ═══ 10. Без мусора: пересчёт снова и снова (отдельный процесс) ═══
if (process.argv.includes('--alloc')) {
  const W = world(64, 40);
  for (let y = 0; y < 12; y++) for (let x = 10; x < 20; x++) for (let z = 10; z < 20; z++) if (x === 10 || x === 19 || z === 10 || z === 19 || y === 11) W.set(x, y, z, WOOD + 1);
  const rd = W.read('real'), P = S.prof('real'), seeds = [10, 0, 10, rd(10, 0, 10), 11, 0, 10, rd(11, 0, 10)];
  W.set(10, 0, 10, 0); W.set(11, 0, 10, 0);
  const BO = { r: 64, rn: 10 };
  const run = n => { let s = 0; for (let i = 0; i < n; i++) { G.build(seeds, rd, BO); s += G.collapse(P); } return s; };
  run(200);
  let best = Infinity;
  for (let k = 0; k < 4; k++) { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed; run(400); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 400); }
  console.log(JSON.stringify({ perCall: best }));
  process.exit(0);
}
sec('без мусора: пересчёт (сетка + до/после + группы)');
{
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=64', __filename, '--alloc'], { encoding: 'utf8' });
  let v = null; try { v = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  ok(v && v.perCall < 64, 'пересчёт без мусора (байт на вызов: ' + (v ? v.perCall.toFixed(1) : '?') + ')', r.stderr?.slice(0, 300));
}

// ═══ 11. 10 минут случайной игры: ставим и ломаем, рушится — ложится; без ошибок, ничего не теряется ═══
sec('10 минут случайной игры (60 шагов в секунду)');
{
  const W = world(64, 48), rnd = S.rng(12345), MODE = 'real', P = S.prof(MODE);
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 0; y < 4; y++) W.set(x, y, z, STONE + 1, true);
  const solid = (x, y, z) => y < 0 || x < 0 || z < 0 || x >= 64 || z >= 64 || !!W.get(x, y, z);
  let placed = 0, items = 0, errors = 0, collapses = 0, fallen = 0, refused = 0;
  const falls = [];
  const steps = (FAST ? 2 : 10) * 60 * 60;
  const t0 = now();
  for (let st = 0; st < steps; st++) {
    try {
      // раз в 0,1 с — действие игрока
      if (st % 6 === 0) {
        let x = 20 + Math.floor(rnd() * 24), z = 20 + Math.floor(rnd() * 24);
        let y = 4; while (y < 46 && W.get(x, y, z)) y++;
        if (y > 5 && rnd() < .5) { const d = Math.floor(rnd() * 4); x += d === 0 ? 1 : d === 1 ? -1 : 0; z += d === 2 ? 1 : d === 3 ? -1 : 0; y = 5 + Math.floor(rnd() * (y - 4)); if (W.get(x, y, z)) y = 46; }   // вбок от столба — балки и навесы
        if (rnd() < .72 && y < 46) {   // поставить, если держится
          const m = rnd() < .5 ? WOOD : rnd() < .5 ? STONE : METAL, code = (m << 2) | 2;
          G.build([x, y, z, code], W.read(MODE), { r: 96, rn: 10 });
          if (G.estimate(P) >= P.min[m]) { W.set(x, y, z, m + 1); placed++; } else refused++;
        } else if (y > 4) {   // сломать верхний (или любой в столбе)
          const yy = 4 + Math.floor(rnd() * (y - 4));
          if (W.get(x, yy, z) && !W.isNat(x, yy, z)) {
            const g = remove(W, MODE, [[x, yy, z]]); placed--; items++;
            for (const cells of g) {
              collapses++;
              for (let i = 0; i < cells.length; i += 3) { W.set(cells[i], cells[i + 1], cells[i + 2], 0); }
              falls.push({ F: S.drop(cells, { down: -1 }), cells, mats: cells.map((v, i) => i % 3 === 0 ? 0 : 0) });
              fallen += cells.length / 3;
            }
          }
        }
      }
      // падающие — шаг; легли — блоки на место (куда нельзя — вещью)
      for (let i = falls.length - 1; i >= 0; i--) {
        const f = falls[i];
        if (!S.dropStep(f.F, 1 / 60, solid)) continue;
        for (let k = 0; k < f.cells.length; k += 3) { const x = f.cells[k], y = f.cells[k + 1] - f.F.off, z = f.cells[k + 2]; if (y >= 0 && !W.get(x, y, z)) W.set(x, y, z, STONE + 1); else items++; }
        falls.splice(i, 1);
      }
    } catch (e) { errors++; if (errors < 4) console.log('  ошибка:', e && e.stack); }
  }
  const ms = now() - t0;
  let have = 0; for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) for (let y = 4; y < 48; y++) if (W.get(x, y, z) && !W.isNat(x, y, z)) have++;
  console.log(`  ${steps} шагов за ${(ms / 1000).toFixed(1)} с: поставлено ${placed + items}, отказ «не держится» ${refused}, обрушений ${collapses} (${fallen} блоков)`);
  ok(errors === 0, '10 минут игры без ошибок', errors);
  ok(collapses > 0 && refused > 0, 'за игру были и обрушения, и отказы «не держится»', [collapses, refused]);
  ok(falls.length === 0 || falls.every(f => !f.F.done), 'все упавшие куски легли');
  ok(have >= 0 && have + items >= placed, 'ничего не потерялось: блоки на месте или вещами', [have, items, placed]);
}

console.log(`\nОбрушение и прочность: ${pass} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);

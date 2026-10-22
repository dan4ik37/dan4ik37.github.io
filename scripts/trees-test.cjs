// Деревья «как в модах» (T-022b, js/engine/trees.js) в node, без браузера: одинаково по зерну (числа без Math.sin — до бита),
// породы похожи на себя (дуб — ствол 2×2 у корня, великан — 3×3, ель — конус, сосна — голый ствол, акация — плоская крона,
// ива — пряди, сухое — без листвы), всё дерево связно по граням (падает целиком), не дальше 15 блоков (соседи чанка «Кубомира»),
// сетка (3D) без дыр в индексах и «не чисел», дальние — дешевле ближних, 2D — клетки сбоку; генератор «Кубомира»: v1 и v2 —
// блоки ровно как раньше, v3 — свои деревья, одинаково при любом порядке чанков; скорость (рост, кубики, чанк v2 и v3).
// Запуск: node scripts/trees-test.cjs [--fast]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
function load(files){
  const ctx = { console, Math, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, Map, Set, Object, Array, JSON, Number, String, Error, performance };
  ctx.globalThis = ctx; ctx.self = ctx; vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = load(['js/engine/voxel.js', 'js/engine/trees.js', 'js/engine/voxel-gen.js']);
const TR = ctx.D37E.trees, V = ctx.D37E.vox;
const hashArr = (...arrs) => { let h = 2166136261; for (const a of arrs) for (let i = 0; i < a.length; i++) { h ^= (a[i] * 1000) | 0; h = Math.imul(h, 16777619); } return h >>> 0; };
const SEEDS = FAST ? 6 : 16;
const CHECK = -2103058338;   // контрольная сумма формы деревьев TR.VERSION 1 (см. «рост»): кубики «Кубомира» v3
const CHECK2D = 528860790;   // и клетки сбоку «Подземья» (trees 3) — форма в сохранённых мирах: менять только новой версией мира

sec('числа: синус многочленом, одинаково везде');
{
  let worst = 0; for (let a = -40; a <= 40; a += .0137) worst = Math.max(worst, Math.abs(TR.sin(a) - Math.sin(a)), Math.abs(TR.cos(a) - Math.cos(a)));
  ok(worst < 1e-8, 'sin/cos многочленом ≈ Math.sin/cos (ошибка < 1e-8)', worst);
  ok(Math.abs(TR.pw(.5, 1.5) - Math.pow(.5, 1.5)) < 1e-12 && Math.abs(TR.pw(.81, .75) - Math.pow(.81, .75)) < 1e-12 && TR.pw(0, 2) === 0, 'степень без Math.pow (целая часть и четверти)');
}

sec('рост: одно зерно — одно дерево; разные зёрна — разные');
{
  let same = true, diff = 0;
  for (const sp of TR.LIST) for (let s = 1; s <= SEEDS; s++) {
    const a = TR.grow(sp, s * 7919), b = TR.grow(sp, s * 7919), c = TR.grow(sp, s * 7919 + 1);
    if (hashArr(a.segs, a.blobs, a.hang) !== hashArr(b.segs, b.blobs, b.hang)) same = false;
    if (hashArr(a.segs) !== hashArr(c.segs)) diff++;
    const va = TR.voxels(a), vb = TR.voxels(b);
    if (hashArr(va.x, va.y, va.z, va.t, va.a) !== hashArr(vb.x, vb.y, vb.z, vb.t, vb.a)) same = false;
  }
  ok(same, 'скелет и кубики — одинаковые при повторе (все породы × ' + SEEDS + ' зёрен)');
  ok(diff >= TR.LIST.length * SEEDS * .95, 'соседние зёрна дают разные деревья', diff);
  // контрольная сумма формы: деревья — часть миров v3 (несохранённые чанки строятся заново); поменять — только новой версией мира
  let h = 0; for (const sp of TR.LIST) for (const s of [3, 77]) { const v = TR.voxels(TR.grow(sp, s)); h = (Math.imul(h, 31) + hashArr(v.x, v.y, v.z, v.t, v.a)) | 0; }
  ok(TR.VERSION === 1 && h === CHECK, 'форма деревьев версии ' + TR.VERSION + ' — контрольная сумма кубиков (менял — только новой версией мира)', h);
  let h2 = 0; for (const sp of ['oak', 'birch', 'giant_oak', 'dead', 'spruce', 'pine', 'giant_spruce', 'tropical']) for (const s of [3, 77]) { const c = TR.cells2d(TR.grow(sp, s), { style: 'side' }); h2 = (Math.imul(h2, 31) + hashArr(c.x, c.y, c.t)) | 0; }
  ok(h2 === CHECK2D, 'деревья сбоку («Подземье») — контрольная сумма клеток', h2);
}

sec('породы похожи на себя (кубики)');
const cells = (sp, seed, g) => { const v = TR.voxels(TR.grow(sp, seed, { g })); const L = []; for (let i = 0; i < v.n; i++) L.push([v.x[i], v.y[i], v.z[i], v.t[i], v.a[i]]); return { v, L }; };
{
  const at = (L, y, t) => L.filter(c => c[1] === y && (t === undefined || c[3] === t));
  let oak2 = 0, oak1top = 0, giant3 = 0, spruceCone = 0, pineBare = 0, acaciaFlat = 0, willowHang = 0, deadBare = 0, birchThin = 0, tropTall = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const o = cells('oak', s * 31).L, base = at(o, 0, 2).length, top = o.filter(c => c[3] === 2 && c[1] >= 4 && c[0] === o[0][0]);
    if (base === 4) oak2++;
    { const tr = o.filter(c => c[3] === 2 && c[4] === 0); const ys = [...new Set(tr.map(c => c[1]))]; const up = ys.filter(y => y >= 4 && tr.filter(c => c[1] === y).length <= 2); if (up.length) oak1top++; }
    const G = cells('giant_oak', s * 31).L; if (at(G, 0, 2).length >= 9) giant3++;
    const sp = cells('spruce', s * 31).L, lw = y => { const L = sp.filter(c => c[3] === 0 && c[1] === y); return L.length ? Math.max(...L.map(c => Math.max(Math.abs(c[0]), Math.abs(c[2])))) : -1; };
    { const ys = sp.filter(c => c[3] === 0).map(c => c[1]), y0 = Math.min(...ys), y1 = Math.max(...ys), lo = lw(Math.round(y0 + (y1 - y0) * .2)), hi = lw(Math.round(y0 + (y1 - y0) * .85)); if (lo > hi) spruceCone++; }
    const pn = cells('pine', s * 31), pH = pn.v.box[4]; if (!pn.L.some(c => c[3] === 0 && c[1] < pH * .45)) pineBare++;
    const ac = cells('acacia', s * 31).L, aL = ac.filter(c => c[3] === 0), ay = aL.map(c => c[1]), aw = Math.max(...aL.map(c => Math.abs(c[0]))) + Math.max(...aL.map(c => Math.abs(c[2])));
    if (Math.max(...ay) - Math.min(...ay) <= 3 || aw > (Math.max(...ay) - Math.min(...ay)) * 2) acaciaFlat++;
    const wl = TR.grow('willow', s * 31); if (wl.hang.length >= 5 * 3) willowHang++;
    const dd = cells('dead', s * 31).L; if (!dd.some(c => c[3] === 0)) deadBare++;
    const br = cells('birch', s * 31).L; if (at(br, 0, 2).length === 1) birchThin++;
    const tp = TR.grow('tropical', s * 31); if (tp.H >= 12) tropTall++;
  }
  ok(oak2 === SEEDS, 'дуб: ствол 2×2 у корня', oak2);
  ok(oak1top >= SEEDS * .9, 'дуб: к верху ствол — 1×1 (толще у корня)', oak1top);
  ok(giant3 === SEEDS, 'дуб-великан: у корня 3×3 и шире', giant3);
  ok(spruceCone >= SEEDS * .8, 'ель: крона конусом (внизу шире, чем вверху)', spruceCone);
  ok(pineBare === SEEDS, 'сосна: голый ствол снизу (крона — выше половины)', pineBare);
  ok(acaciaFlat >= SEEDS * .9, 'акация: плоская широкая крона', acaciaFlat);
  ok(willowHang === SEEDS, 'ива: свисающие пряди', willowHang);
  ok(deadBare === SEEDS, 'сухое дерево — без листвы', deadBare);
  ok(birchThin === SEEDS, 'берёза — тонкий ствол (1 блок)', birchThin);
  ok(tropTall === SEEDS, 'тропическое — высокое (12+)', tropTall);
}

sec('пределы и связность: дерево целое по граням (падает целиком), не дальше 15 блоков от ствола');
{
  let far = 0, broken = 0, loose = 0, total = 0, maxN = 0, maxH = 0;
  const key = (x, y, z) => ((x + 64) * 128 + (y + 64)) * 128 + (z + 64);
  for (const sp of TR.LIST) for (let s = 1; s <= SEEDS; s++) for (const g of [1, .45]) {
    const { v, L } = cells(sp, s * 131 + 7, g); total++;
    maxN = Math.max(maxN, v.n); maxH = Math.max(maxH, v.box[4]);
    if (L.some(c => Math.abs(c[0]) > 15 || Math.abs(c[2]) > 15 || c[1] < -6 || c[1] > 50)) far++;
    // брёвна (кроме корней) от основания по граням
    const wood = new Set(L.filter(c => c[3] === 1 || c[3] === 2).map(c => key(c[0], c[1], c[2])));
    const start = L.find(c => c[3] === 2 && c[1] === 0) || L.find(c => c[3] === 2);
    const seen = new Set(), q = start ? [start] : [];
    if (start) seen.add(key(start[0], start[1], start[2]));
    while (q.length) { const [x, y, z] = q.pop(); for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const k = key(x + dx, y + dy, z + dz); if (wood.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, y + dy, z + dz]); } } }
    if (seen.size < wood.size) broken++;
    // листва — не дальше 8 шагов (по листве) от дерева: падающее дерево берёт её всю (kubomir-ents.js ownLeaves, 8 шагов)
    const leaf = L.filter(c => c[3] === 0), all = new Set(L.map(c => key(c[0], c[1], c[2]))), dist = new Map(); const qq = [];
    for (const c of L) if (c[3] >= 1) { const k = key(c[0], c[1], c[2]); dist.set(k, 0); qq.push(c); }
    for (let h = 0; h < qq.length; h++) { const [x, y, z] = qq[h], d = dist.get(key(x, y, z)); if (d >= 9) continue; for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const k = key(x + dx, y + dy, z + dz); if (all.has(k) && !dist.has(k)) { dist.set(k, d + 1); qq.push([x + dx, y + dy, z + dz]); } } }
    const lost = leaf.filter(c => !(dist.get(key(c[0], c[1], c[2])) <= 8)).length;
    if (leaf.length && lost / leaf.length > .03) loose++;
  }
  ok(!far, 'все клетки — в пределах ±15 по x/z (соседи чанка) и по высоте', far);
  ok(!broken, 'брёвна и ветки связаны по граням (дерево целое)', broken);
  ok(!loose, 'листва — не дальше 8 шагов от веток (падает вместе с деревом: kubomir-ents.js ownLeaves)', loose);
  ok(maxN < 2600 && maxH < 40, 'самое большое дерево: клеток < 2600, высота < 40', { maxN, maxH });
  console.log('  всего деревьев', total, '· больше всего клеток', maxN, '· выше всех', maxH);
}

sec('сетка (3D): индексы, числа, нормали; дальняя — дешевле ближней');
{
  let bad = 0, order = 0, vmax = 0, v2max = 0;
  for (const sp of TR.LIST) for (let s = 1; s <= Math.min(SEEDS, 8); s++) {
    const S = TR.grow(sp, s * 977), M0 = TR.mesh(S, { lod: 0 }), M1 = TR.mesh(S, { lod: 1 }), M2 = TR.mesh(S, { lod: 2 });
    for (const M of [M0, M1, M2]) for (const p of M.parts) {
      const nv = p.pos.length / 3;
      for (let i = 0; i < p.idx.length; i++) if (p.idx[i] >= nv) { bad++; break; }
      for (let i = 0; i < p.pos.length; i++) if (!Number.isFinite(p.pos[i]) || !Number.isFinite(p.nrm[i])) { bad++; break; }
      for (let i = 0; i < nv; i++) { const l = Math.hypot(p.nrm[i * 3], p.nrm[i * 3 + 1], p.nrm[i * 3 + 2]); if (l < .9 || l > 1.1) { bad++; break; } }
      if (p.tone.length !== nv || p.idx.length % 3) bad++;
    }
    const a = TR.meshStats(M0).v, b = TR.meshStats(M1).v, c = TR.meshStats(M2).v;
    if (!(a >= b && b > c)) order++;
    vmax = Math.max(vmax, a); v2max = Math.max(v2max, c);
  }
  ok(!bad, 'индексы в пределах, без «не чисел», нормали единичные', bad);
  ok(!order, 'вершин: подробная ≥ средняя > дальняя', order);
  ok(vmax < 6000 && v2max < 260, 'вершин у самого сложного: подробная < 6000, дальняя < 260', { vmax, v2max });
  const C = TR.cut(TR.mesh(TR.grow('oak', 5), { lod: 1 }).parts[0], 1.2);
  ok(C.pos.length > 0 && [...C.pos].every((v, i) => i % 3 !== 1 || v >= 1.2 - 1e-6), 'срез сетки (падающий верх): всё выше среза');
}

sec('сбоку (2D): ствол, ветви, крона');
{
  const c2 = TR.cells2d(TR.grow('oak', 9)), t = [0, 0, 0, 0];
  for (let i = 0; i < c2.n; i++) t[c2.t[i]]++;
  const c2b = TR.cells2d(TR.grow('oak', 9));
  ok(c2.n > 30 && t[2] >= 6 && t[0] > 20 && hashArr(c2.x, c2.y, c2.t) === hashArr(c2b.x, c2b.y, c2b.t), 'дуб сбоку: ствол и крона, одинаково по зерну', t);
  const s2 = TR.cells2d(TR.grow('spruce', 9)), w = y => { let m = -1; for (let i = 0; i < s2.n; i++) if (s2.y[i] === y && s2.t[i] === 0) m = Math.max(m, Math.abs(s2.x[i])); return m; };
  ok(w(3) > w(10), 'ель сбоку — конусом', [w(3), w(10)]);
  // как в «Подземье» (style 'side'): ствол — один столбец x = 0, сухое — только ствол, всё дерево связано со стволом (8 соседей)
  let offcol = 0, deadx = 0, lost = 0;
  for (const sp of ['oak', 'birch', 'giant_oak', 'dead', 'spruce', 'pine', 'giant_spruce', 'tropical']) for (let sd = 1; sd <= 40; sd++) {
    const c = TR.cells2d(TR.grow(sp, sd * 7919), { style: 'side' }), have = new Set();
    for (let i = 0; i < c.n; i++) { have.add(c.x[i] * 1000 + c.y[i]); if (c.t[i] === 2 && c.x[i] !== 0) offcol++; if (sp === 'dead' && c.x[i] !== 0) deadx++; }
    const seen = new Set([0]), q = [0, 0];
    while (q.length) { const y = q.pop(), x = q.pop(); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const k = (x + dx) * 1000 + y + dy; if (have.has(k) && !seen.has(k)) { seen.add(k); q.push(x + dx, y + dy); } } }
    lost += c.n - seen.size;
  }
  ok(!offcol && !deadx && !lost, 'сбоку как в «Подземье»: ствол — один столбец, сухое — без сучьев, всё связано со стволом', { offcol, deadx, lost });
}

sec('кто рисует дерево (разрушениям): источник по префиксу id');
{
  const off = TR.source('tt', id => ({ id, h: 7 }));
  ok(TR.lookup('tt:12:34').h === 7 && TR.lookup('zz:1') === null && TR.lookup(5) === null, 'TR.lookup — по префиксу; чужой — null');
  off(); ok(TR.lookup('tt:1') === null, 'снял источник — нет');
}

sec('генератор «Кубомира»: v1, v2 — как было; v3 — деревья пород, одинаково при любом порядке чанков');
{
  const sumIds = ver => { let h = 0; for (const seed of ['test-v1', 12345]) { const G = V.genInit(seed, { ver }); for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const r = V.genChunk(G, cx * 7, cz * 5); for (let i = 0; i < r.ids.length; i++) h = (Math.imul(h, 31) + r.ids[i]) | 0; } } return h; };
  ok(sumIds(1) === 1214627954, 'v1: блоки ровно как до 16.10');
  ok(sumIds(2) === -1645966598, 'v2: блоки ровно как до деревьев пород (миры 16.10–22.10)');
  // v3: один и тот же участок — чанки в прямом и обратном порядке (разные кэши) — одинаково
  const A = V.genInit('лес37', { ver: 3 }), B = V.genInit('лес37', { ver: 3 }), keys = [];
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) keys.push([cx, cz]);
  const ra = new Map(), rb = new Map();
  for (const [cx, cz] of keys) ra.set(cx + ',' + cz, hashArr(V.genChunk(A, cx, cz).ids));
  for (const [cx, cz] of keys.slice().reverse()) rb.set(cx + ',' + cz, hashArr(V.genChunk(B, cx, cz).ids));
  ok(keys.every(([cx, cz]) => ra.get(cx + ',' + cz) === rb.get(cx + ',' + cz)), 'v3: чанк одинаков при любом порядке (дерево через границу чанка — целое)');
  // породы в мире v3
  const cnt = {}, ID = V.ID;
  const want = ['log_acacia', 'leaves_acacia', 'log_jungle', 'leaves_jungle', 'leaves_willow', 'log_oak_thin', 'log_spruce', 'leaves_birch'];
  const G = V.genInit('озеро37', { ver: 3 });
  for (const [cx, cz] of [[1, 1], [1, 2], [0, 1], [2, 1], [-9, -4], [-8, -4], [-5, -1], [1, 5], [3, 5], [-4, 5], [-3, -21], [-8, 7], [1, 8]]) {
    const r = V.genChunk(G, cx, cz); for (let i = 0; i < r.ids.length; i++) { const t = r.ids[i] & 0xfff; if (t) cnt[t] = (cnt[t] || 0) + 1; }
  }
  const miss = want.filter(n => !cnt[ID[n]]);
  ok(!miss.length, 'v3 «озеро37»: в мире есть акации, тропические, ивы, тонкие ветки, ели, берёзы', miss);
  // v3 на месте деревьев v2 тоже деревья (лес остаётся лесом)
  const G2 = V.genInit('озеро37', { ver: 2 }); let t2 = 0, t3 = 0;
  for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) { const a = V.genChunk(G2, cx, cz).ids, b = V.genChunk(G, cx, cz).ids; for (let i = 0; i < a.length; i++) { if (V.T.tree[a[i] & 0xfff] === 1) t2++; if (V.T.tree[b[i] & 0xfff] === 1 || V.T.tree[b[i] & 0xfff] === 2) t3++; } }
  ok(t3 > t2 * .8 && t3 < t2 * 14, 'v3: лес остаётся лесом — брёвен больше (стволы толще, сучья): v2 ' + t2 + ', v3 ' + t3, [t2, t3]);
}

sec('«Подземье» (2D): новые миры — деревья пород сбоку, старые — как были; поток получает модуль деревьев текстом');
{
  // ядро «Подземья» и движок деревьев в одном контексте (как в окне)
  const pctx = load(['js/engine/trees.js']);
  pctx.module = undefined; vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/podzem-core.js'), 'utf8'), pctx, { filename: 'podzem-core.js' });
  const PZ = pctx.PZ_CORE(), T = PZ.T, CA = 4096;
  const mk = () => ({ fg: new Uint8Array(CA), wall: new Uint8Array(CA), st: new Uint8Array(CA), lq: new Uint8Array(CA), lt: new Uint8Array(CA) });
  const run = (o) => { const G = PZ.makeGen(4242, o), h = []; for (let cx = -8; cx <= 8; cx++) for (let cy = 2; cy <= 4; cy++) { const c = G.genChunk(cx, cy, mk()); h.push(hashArr(c.fg, c.wall)); } return { G, h: hashArr(h) }; };
  const old0 = run(), old1 = run({ trees: false }), n1 = run({ trees: true }), n2 = run({ trees: true });
  ok(old0.h === old1.h, '«Подземье»: без флага мира — генерация как была');
  ok(n1.h === n2.h && n1.h !== old0.h, 'новые миры (trees): свои деревья, по зерну одинаково');
  // деревья пород: стволы 2 в ширину у толстых, листва своих видов; рубка — дерево по клетке ствола
  const G = n1.G; let wide = 0, kinds = new Set(), found = null;
  for (let k = -40; k <= 40; k++) { const tr = G.treeOf(k); if (!tr || !tr.cells) continue; kinds.add(tr.kind); const c = tr.cells; let base = 0; for (let i = 0; i < c.n; i++) if (c.y[i] === 0 && c.t[i] === 2) base++; if (base >= 2) wide++; if (!found) { for (let i = 0; i < c.n; i++) if (c.t[i] === 2 && c.y[i] === 2) { found = [tr, tr.xc + c.x[i], tr.y0 - c.y[i]]; break; } } }
  ok(kinds.size >= 3 && wide === 0, 'деревья пород сбоку (как в Террарии): несколько пород, ствол — один столбец, сучья — листвой', { kinds: [...kinds], wide });
  ok(found && G.treeAt(found[1], found[2]) === found[0], 'рубка: клетка ствола → её дерево (падает всё выше среза)');
  // поток из строки: модуль деревьев идёт текстом перед ядром
  pctx.window = pctx;   // как в окне
  const src = PZ.workerSource();
  ok(src.indexOf('d37Trees') >= 0 && src.indexOf('d37Trees') < src.indexOf('PZ_CORE'), 'поток «Подземья» получает движок деревьев текстом (перед ядром)');
  delete pctx.window;
  // скорость: чанки у поверхности (деревья) — старые миры и новые (новый генератор на каждый замер: и сборка клеток деревьев)
  const pzT = o => { let best = 1e9; for (let k = 0; k < 3; k++) { const G = PZ.makeGen(777 + k, o); G.genChunk(50, 3, mk()); const t = performance.now(); let n = 0; for (let cx = -12; cx < 12; cx++) for (let cy = 2; cy <= 3; cy++) { G.genChunk(cx, cy, mk()); n++; } best = Math.min(best, (performance.now() - t) / n); } return best; };
  pzT({ trees: true }); const p0 = pzT(), p1 = pzT({ trees: true });
  console.log('  «Подземье», чанк у поверхности, мс: старые миры', p0.toFixed(2), '· новые', p1.toFixed(2));
  ok(p1 < p0 * 1.8 + 1, '«Подземье»: чанк с деревьями пород не дороже старого больше чем в 1,8 раза (+1 мс)', [p0, p1]);
}

sec('скорость (node, ЦП компьютера; телефон ≈ ×4)');
{
  const per = {};
  for (const sp of TR.LIST) { let tg = 0, tv = 0; const N = FAST ? 10 : 30; for (let i = 0; i < N; i++) { const a = performance.now(), S = TR.grow(sp, i * 37 + 5), b = performance.now(); TR.voxels(S); tg += b - a; tv += performance.now() - b; } per[sp] = +((tg + tv) / N).toFixed(3); }
  console.log('  рост + кубики, мс на дерево:', JSON.stringify(per));
  ok(Object.values(per).every(v => v < 5), 'дерево (рост + кубики) — меньше 5 мс', per);
  const genT = ver => { const G = V.genInit('лес-скорость', { ver }); V.genChunk(G, 90, 90); const t = performance.now(); let n = 0; for (let cx = 0; cx < (FAST ? 6 : 10); cx++) for (let cz = 0; cz < (FAST ? 6 : 10); cz++) { V.genChunk(G, cx, cz); n++; } return (performance.now() - t) / n; };
  genT(2); genT(3);
  const g2 = genT(2), g3 = genT(3);
  console.log('  чанк, мс: v2', g2.toFixed(2), '· v3', g3.toFixed(2));
  ok(g3 < g2 * 1.6 + 2, 'чанк v3 не дороже v2 больше чем в 1,6 раза (+2 мс)', [g2, g3]);
}

console.log(`\ntrees-test: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

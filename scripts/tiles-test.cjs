// «Подземье» ⛏ — проверки без браузера: генерация по зерну и стыки чанков, свет, жидкости и песок, столкновения
// (углы, потолки, ступеньки, полублоки, склоны, платформы), упаковка/сохранение, моды (проверка mod.json и песочница
// JS/Lua с ошибками), замер скорости генерации и света.
//   node scripts/tiles-test.cjs            — всё
//   node scripts/tiles-test.cjs gen,light  — только эти разделы (gen, border, light, liquid, physics, save, mods, sandbox, shade2d, perf)
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const want = k => !ONLY.length || ONLY.includes(k);
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const PZ_CORE = require(path.join(SITE, 'js/games/podzem-core.js'));
const PZ = PZ_CORE();
const { CS, CA, T } = PZ;
const mk = () => ({ fg: new Uint8Array(CA), wall: new Uint8Array(CA), st: new Uint8Array(CA), lq: new Uint8Array(CA), lt: new Uint8Array(CA) });
const same = (a, b) => { for (const k of ['fg', 'wall', 'st', 'lq', 'lt']) { const x = a[k], y = b[k]; for (let i = 0; i < CA; i++) if (x[i] !== y[i]) return k + '@' + i; } return ''; };
const t00 = Date.now();

// ═══ 1. Генерация: одно зерно — один мир; другое зерно — другой ═══
if (want('gen')) {
  const A = PZ.makeGen(12345), B = PZ.makeGen(12345), C = PZ.makeGen(777);
  let diff = '', other = 0;
  for (const [cx, cy] of [[0, 2], [0, 3], [-5, 4], [17, 6], [-200, 12], [3, 20], [1e5, 30], [-7, 40]]) {
    const a = A.genChunk(cx, cy, mk()), b = B.genChunk(cx, cy, mk()), c = C.genChunk(cx, cy, mk());
    diff = diff || same(a, b);
    if (same(a, c)) other++;
  }
  ok(!diff, 'генерация: одно зерно — одинаковые чанки', diff);
  ok(other >= 6, 'генерация: другое зерно — другой мир', other);
  // порядок генерации не важен (кэш колонок не влияет)
  const D = PZ.makeGen(12345), E2 = PZ.makeGen(12345);
  const order1 = [], order2 = [];
  for (let cx = -2; cx <= 2; cx++) for (let cy = 2; cy <= 5; cy++) order1.push([cx, cy, D.genChunk(cx, cy, mk())]);
  for (let cy = 5; cy >= 2; cy--) for (let cx = 2; cx >= -2; cx--) order2.push([cx, cy, E2.genChunk(cx, cy, mk())]);
  let od = '';
  for (const [cx, cy, a] of order1) { const b = order2.find(q => q[0] === cx && q[1] === cy)[2]; od = od || same(a, b); }
  ok(!od, 'генерация: порядок чанков не влияет', od);
  // мир похож на мир: у поверхности трава, ниже камень, есть пещеры, руды, деревья, вода/лава глубоко
  const G = PZ.makeGen(12345), cnt = {};
  for (let cx = -6; cx <= 6; cx++) for (let cy = 2; cy <= 22; cy++) { const c = G.genChunk(cx, cy, mk()); for (let i = 0; i < CA; i++) { cnt[c.fg[i]] = (cnt[c.fg[i]] || 0) + 1; if (c.lq[i]) cnt['lq' + c.lt[i]] = (cnt['lq' + c.lt[i]] || 0) + 1; } }
  for (const [k, name] of [[T.GRASS, 'трава'], [T.STONE, 'камень'], [T.DIRT, 'земля'], [T.COPPER, 'медь'], [T.IRON, 'железо'], [T.SILVER, 'серебро'], [T.GOLD, 'золото'], [T.TRUNK, 'стволы'], [T.LEAVES, 'листва'], [T.DEEPSTONE, 'глубинный камень'], [T.DEEPORE, 'глубинит']])
    ok((cnt[k] || 0) > 0, 'генерация: есть ' + name, cnt[k]);
  ok((cnt[0] || 0) > CA * 30, 'генерация: есть пещеры и небо', cnt[0]);
  ok((cnt.lq1 || 0) > 0 && (cnt.lq2 || 0) > 0, 'генерация: подземная вода и лава', [cnt.lq1, cnt.lq2]);
  // лавовый слой и бесконечная глубина
  const deep = G.genChunk(0, 40, mk()), deeper = G.genChunk(0, 400, mk());
  ok(deep.fg.some(f => f === T.ASH || f === T.DEEPSTONE) && deeper.fg.some(f => f === T.ASH || f === T.DEEPSTONE), 'генерация: глубже 2,5 км и 25 км — мир есть (бесконечно вниз)');
  ok(deeper.lt.some(v => v === 2), 'генерация: внизу — лава');
  // далеко в стороны — тоже мир (бесконечно вбок)
  const far = G.genChunk(1e6, 3, mk()), farL = G.genChunk(-1e6, 3, mk());
  ok(far.fg.some(Boolean) && farL.fg.some(Boolean), 'генерация: на миллион клеток вправо и влево — мир есть');
  // биомы — все 4 в пределах 6000 клеток
  const seen = new Set(); for (let x = -6000; x <= 6000; x += 20) seen.add(G.colInfo(x).b);
  ok(seen.size === 4, 'генерация: все 4 биома недалеко от старта', [...seen]);
  // старт — лес, на суше, не в воде
  const sp = G.spawnPoint();
  ok(G.colInfo(sp.x).b === 0 && Math.abs(sp.x) < 60, 'генерация: старт — в лесу у x = 0', sp);
  // только + − × ÷: в функциях генерации нет sin/cos/exp/pow/random
  const src = fs.readFileSync(path.join(SITE, 'js/games/podzem-core.js'), 'utf8');
  const genSrc = src.slice(src.indexOf('function hash2'), src.indexOf('// ═══ Свет:'));
  ok(!/Math\.(sin|cos|tan|exp|pow|log|random|atan)/.test(genSrc) && !/\*\*/.test(genSrc), 'генерация: без sin/cos/exp/random/** — одинаково во всех браузерах');
}

// ═══ 2. Стыки чанков: деревья и предметы 2×2 на границе — целиком с обеих сторон ═══
if (want('border')) {
  const G = PZ.makeGen(4242), W = new Map();
  for (let cx = -8; cx <= 8; cx++) for (let cy = 2; cy <= 4; cy++) W.set(cx + ',' + cy, G.genChunk(cx, cy, mk()));
  const fgAt = (x, y) => { const c = W.get(Math.floor(x / CS) + ',' + Math.floor(y / CS)); return c ? c.fg[((y & 63) << 6) | (x & 63)] : -1; };
  let trees = 0, cross = 0, missing = 0;
  for (let k = Math.floor(-8 * CS / 7); k <= Math.floor(9 * CS / 7); k++) {
    const tr = G.treeOf(k); if (!tr) continue;
    trees++;
    const cells = [];
    G.treeCells(tr, (x, y, f) => cells.push([x, y, f]));
    const xs = new Set(cells.map(c => Math.floor(c[0] / CS)));
    if (xs.size > 1) cross++;
    for (const [x, y, f] of cells) {
      const v = fgAt(x, y); if (v < 0) continue;
      const b = G.base(x, y);
      if ((b & 255) || (b >> 16)) continue;   // место занято землёй/водой — дерево туда не ставится
      if (v !== f && !(v === T.TRUNK || v === T.LEAVES || v === T.JLEAVES || v === T.PLEAVES || v === T.CACTUS || v === T.VINE || v === T.LIFECRYSTAL || v === T.LOOT)) missing++;
    }
  }
  ok(trees > 10 && cross > 0, 'стыки: есть деревья, и часть — на границе чанков', { trees, cross });
  ok(missing === 0, 'стыки: части деревьев у границы на месте с обеих сторон', missing);
  // предметы 2×2 (кристаллы жизни, сундуки): у каждого якоря все 4 кадра, даже через границу
  const G2 = PZ.makeGen(99), W2 = new Map();
  for (let cx = -12; cx <= 12; cx++) for (let cy = 3; cy <= 14; cy++) W2.set(cx + ',' + cy, G2.genChunk(cx, cy, mk()));
  const at2 = (x, y) => { const c = W2.get(Math.floor(x / CS) + ',' + Math.floor(y / CS)); return c ? [c.fg[((y & 63) << 6) | (x & 63)], c.st[((y & 63) << 6) | (x & 63)] >> 4] : [-1, 0]; };
  let objs = 0, broken = 0, onBorder = 0;
  for (const [key, c] of W2) {
    const [cx, cy] = key.split(',').map(Number);
    for (let i = 0; i < CA; i++) {
      const f = c.fg[i]; if ((f !== T.LIFECRYSTAL && f !== T.LOOT) || (c.st[i] >> 4) !== 0) continue;   // якорь — кадр 0
      objs++;
      const x = cx * CS + (i & 63), y = cy * CS + (i >> 6);
      if (((x + 1) & 63) === 0 || ((y + 1) & 63) === 0) onBorder++;
      for (let fr = 0; fr < 4; fr++) { const [ff, ss] = at2(x + (fr & 1), y + (fr >> 1)); if (ff >= 0 && (ff !== f || ss !== fr)) broken++; }
    }
  }
  ok(objs > 3, 'стыки: в пещерах есть кристаллы жизни и сундуки', objs);
  ok(broken === 0, 'стыки: предметы 2×2 целые (все 4 части), в том числе на границе', { broken, onBorder });
  // соседние чанки по отдельности = те же клетки, что при генерации «всем куском» (ещё раз другим порядком)
  const G3 = PZ.makeGen(4242);
  let d3 = '';
  for (const key of [...W.keys()].reverse()) { const [cx, cy] = key.split(',').map(Number); d3 = d3 || same(W.get(key), G3.genChunk(cx, cy, mk())); }
  ok(!d3, 'стыки: перегенерация задом наперёд — то же самое', d3);
}

// ═══ 3. Свет: небо, факел, затухание, граница чанков, снятие источника ═══
function worldWorker(seed, chunks){
  const msgs = [], self = { postMessage(m){ msgs.push(m); } };
  const core = PZ_CORE();
  core.worldWorker(self);
  self.onmessage({ data: { t: 'init', seed } });
  for (const [cx, cy] of chunks) self.onmessage({ data: { t: 'load', cx, cy } });
  const W = new Map();
  for (const m of msgs) if (m.t === 'chunk') W.set(m.cx + ',' + m.cy, m);
  const apply = () => { for (const m of msgs.splice(0)) if (m.t === 'light') { const c = W.get(m.cx + ',' + m.cy); if (c) c.light = m.light; } else if (m.t === 'chunk') W.set(m.cx + ',' + m.cy, m); };
  apply();
  const cell = (x, y) => { const c = W.get(Math.floor(x / CS) + ',' + Math.floor(y / CS)); return c ? { c, i: ((y & 63) << 6) | (x & 63) } : null; };
  return {
    W, msgs, self, apply, core,
    L(x, y){ const r = cell(x, y); return r ? Array.from(r.c.light.slice(r.i * 4, r.i * 4 + 4)) : null; },
    fg(x, y){ const r = cell(x, y); return r ? r.c.fg[r.i] : -1; },
    edit(list){ const a = []; for (const [x, y, fg, wall, lq = 0, lt = 0] of list) { const r = cell(x, y); a.push(x, y, fg, wall ?? r.c.wall[r.i], 0, lq, lt); if (r) { r.c.fg[r.i] = fg; if (wall !== undefined) r.c.wall[r.i] = wall; } } self.onmessage({ data: { t: 'edit', a } }); apply(); },
  };
}
if (want('light')) {
  const G = PZ.makeGen(12345), sp = G.spawnPoint();
  const scx = Math.floor(sp.x / CS), list = [];
  for (let cy = 0; cy <= 7; cy++) for (let cx = scx - 2; cx <= scx + 2; cx++) list.push([cx, cy]);
  const w = worldWorker(12345, list);
  ok(w.L(sp.x, sp.y - 6)[3] === 255, 'свет: над землёй — полное небо', w.L(sp.x, sp.y - 6));
  ok(w.L(sp.x, 30)[3] === 255, 'свет: высоко в небе — 255');
  ok(w.L(sp.x, sp.y + 30)[3] === 0, 'свет: на глубине 30 клеток в толще — неба нет', w.L(sp.x, sp.y + 30));
  // выкопать закрытую комнату под землёй 31×9 (со стенами — неба нет) и поставить факел в середину
  const cx0 = sp.x, cy0 = sp.y + 60;
  const room = [];
  for (let y = cy0 - 4; y <= cy0 + 4; y++) for (let x = cx0 - 15; x <= cx0 + 15; x++) room.push([x, y, 0, 2]);
  for (let y = cy0 - 5; y <= cy0 + 5; y++) for (let x = cx0 + 16; x <= cx0 + 19; x++) room.push([x, y, T.STONE, 2]);   // справа — сплошной камень
  w.edit(room);
  ok(w.L(cx0, cy0).slice(0, 3).every(v => v === 0), 'свет: пустая комната под землёй — темно', w.L(cx0, cy0));
  w.edit([[cx0, cy0, T.TORCH, 2]]);
  const at = d => w.L(cx0 + d, cy0)[0];
  // ожидаемое: каждая клетка воздуха пропускает долю LMUL[0] (как в Террарии, режим «Цвет»), меньше LCUT — ноль
  const chain = (v, n, m = PZ.LMUL[0][0]) => { for (let k = 0; k < n; k++) { v = (v * m) >> 8; if (v < PZ.LCUT) v = 0; } return v; };
  ok(at(0) === 255, 'свет: у факела — 255', at(0));
  ok(at(1) === chain(255, 1) && at(4) === chain(255, 4) && at(10) === chain(255, 10), 'свет: в воздухе — доля за клетку (0,86)', [at(1), at(4), at(10), chain(255, 10)]);
  ok(at(1) > 210 && at(4) > 140 && at(10) > 60 && at(10) < 100, 'свет: яркое ядро и мягкий хвост', [at(1), at(4), at(10)]);
  ok(Math.max(...PZ.LMUL.map(a => Math.max(...a))) === PZ.LMUL[0][0] && chain(255, PZ.LR) === 0 && PZ.LMUL.every((a, i) => a.every((m, j) => PZ.LMULD[i][j] <= m)), 'свет: дальше LR не достаёт (коробка пересчёта правки — честная)', PZ.LR);
  ok(at(-7) === at(7) && w.L(cx0, cy0 - 3)[0] === at(3), 'свет: одинаково во все стороны', [at(-7), at(7), w.L(cx0, cy0 - 3)[0], at(3)]);
  ok(w.L(cx0 + 4, cy0 + 3)[0] >= at(7) && w.L(cx0 + 4, cy0 + 3)[0] <= at(4), 'свет: по диагонали — не больше, чем по прямой', [w.L(cx0 + 4, cy0 + 3)[0], at(4), at(7)]);
  ok(at(14) > 0 && at(14) <= 60 && w.L(cx0 + 16, cy0)[0] < at(15) * .6 && w.L(cx0 + 17, cy0)[0] < at(15) * .4, 'свет: в камень заходит на 2–3 клетки и гаснет', [at(14), at(15), w.L(cx0 + 16, cy0)[0], w.L(cx0 + 17, cy0)[0]]);
  ok(w.L(cx0, cy0)[1] === PZ.P.LG[T.TORCH] && w.L(cx0, cy0)[2] === PZ.P.LB[T.TORCH] && PZ.P.LR[T.TORCH] > PZ.P.LG[T.TORCH] && PZ.P.LG[T.TORCH] > PZ.P.LB[T.TORCH], 'свет: цвет факела тёплый (R > G > B)', w.L(cx0, cy0));
  ok(w.L(cx0 + 7, cy0)[1] / w.L(cx0 + 7, cy0)[0] > .6, 'свет: вдали от факела цвет тот же (каналы гаснут одинаково)', w.L(cx0 + 7, cy0));
  // факел у границы чанка: соседний чанк освещён так же
  const bx = (Math.floor((cx0 + 40) / CS) + 1) * CS, by = cy0;
  const tun = []; for (let x = bx - 12; x <= bx + 12; x++) for (let y = by - 1; y <= by + 1; y++) tun.push([x, y, 0, 2]);
  w.edit(tun);
  w.edit([[bx - 1, by, T.TORCH, 2]]);
  ok(w.L(bx - 1 - 5, by)[0] === w.L(bx - 1 + 5, by)[0] && w.L(bx - 1 + 5, by)[0] === chain(255, 5), 'свет: через границу чанков — без шва', [w.L(bx - 6, by)[0], w.L(bx + 4, by)[0]]);
  // снять факел — снова темно (и в соседнем чанке)
  w.edit([[bx - 1, by, 0, 2]]);
  ok(w.L(bx + 3, by)[0] === 0 && w.L(bx - 5, by)[0] === 0, 'свет: факел убрали — темно по обе стороны границы', [w.L(bx + 3, by), w.L(bx - 5, by)]);
  // лава светится
  w.edit([[cx0 - 10, cy0 + 4, 0, 2, 255, 2]]);
  ok(w.L(cx0 - 10, cy0 + 4)[0] > 150 && w.L(cx0 - 10, cy0 + 4)[2] < 60, 'свет: лава светит оранжевым', w.L(cx0 - 10, cy0 + 4));
  // вода: красный гаснет быстрее синего — свет сквозь воду синеет
  const pool = []; for (let x = cx0 + 6; x <= cx0 + 14; x++) for (let y = cy0 - 4; y <= cy0 + 4; y++) pool.push([x, y, 0, 2, 255, 1]);
  w.edit(pool);
  const Lw = w.L(cx0 + 12, cy0), La = w.L(cx0 - 12, cy0 - 4);
  const tr = PZ.P.LB[T.TORCH] / PZ.P.LR[T.TORCH];   // синий к красному у самого факела
  ok(Lw[2] / Math.max(1, Lw[0]) > tr * 2 && La[2] / Math.max(1, La[0]) < tr * 1.3, 'свет: сквозь воду синеет, в воздухе — тёплый', { Lw, La, tr });
  // шахта с поверхности: небо идёт вниз по шахте без стен; крыша над головой — небо гаснет
  const sx = sp.x + 30, top = G.colInfo(sx).h;
  const shaft = []; for (let y = top; y < top + 20; y++) for (let x = sx; x <= sx + 1; x++) shaft.push([x, y, 0, 0]);
  w.edit(shaft);
  ok(w.L(sx, top + 15)[3] === 255, 'свет: в шахте без стен до неба — солнце до дна', w.L(sx, top + 15));
  w.edit([[sx, top, T.STONE, 0], [sx + 1, top, T.STONE, 0]]);
  ok(w.L(sx, top + 15)[3] < 120, 'свет: накрыли шахту — солнца на дне нет (только рассеянный)', w.L(sx, top + 15));
}

// ═══ 4. Жидкости и песок: оседают и успокаиваются ═══
function liqWorld(){
  const W = new Map();
  const get = (cx, cy) => W.get(cx + ',' + cy);
  const ensure = (cx, cy) => { let c = get(cx, cy); if (!c) { c = Object.assign(mk(), { cx, cy, awake: 0 }); W.set(cx + ',' + cy, c); } return c; };
  const cell = (x, y) => { const c = ensure(Math.floor(x / CS), Math.floor(y / CS)); return { c, i: ((y & 63) << 6) | (x & 63) }; };
  const changes = { n: 0 };
  const LW = { chunk: (cx, cy) => get(cx, cy), changed(){ changes.n++; } };
  return {
    W, LW, changes, cell,
    set(x, y, fg, lq = 0, lt = 0){ const r = cell(x, y); r.c.fg[r.i] = fg; r.c.lq[r.i] = lq; r.c.lt[r.i] = lq ? lt : 0; r.c.awake = 40; },
    run(n){ const list = [...W.values()]; let t = 0; for (let k = 0; k < n; k++) { changes.n = 0; PZ.liquidStep(LW, list, t++, 1e9); if (!list.some(c => c.awake)) return k; } return n; },
    sum(t){ let s = 0; for (const c of W.values()) for (let i = 0; i < CA; i++) if (c.lt[i] === t) s += c.lq[i]; return s; },
  };
}
if (want('liquid')) {
  // корыто: дно y=40, стенки x=10 и x=50, внутри 39 клеток; на границе чанков по x (x=32)
  const w = liqWorld();
  for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) w.set(x, y, 0);
  for (let x = 10; x <= 50; x++) w.set(x, 40, T.STONE);
  for (let y = 20; y <= 40; y++) { w.set(10, y, T.STONE); w.set(50, y, T.STONE); }
  // перенести часть корыта в соседний чанк по x: ничего не меняет, но граница CS=64 — сделаем ещё одно корыто через границу
  for (let y = 20; y < 30; y++) for (let x = 25; x < 35; x++) w.set(x, y, 0, 255, 1);   // куб воды 10×10 высоко
  const before = w.sum(1);
  const steps = w.run(6000);
  const after = w.sum(1);
  ok(steps < 6000, 'жидкость: вода в корыте успокоилась (все уснули)', steps);
  ok(after === before, 'жидкость: воды не прибавилось и не пропало', [before, after]);
  // уровень ровный: в каждом столбце корыта одинаково (±1 клетка высоты по сумме)
  const col = x => { let s = 0; for (let y = 20; y < 40; y++) s += w.cell(x, y).c.lq[w.cell(x, y).i]; return s; };
  const cols = []; for (let x = 11; x < 50; x++) cols.push(col(x));
  // ровно: соседние столбцы — не больше 1/255 клетки разницы, весь пруд — не больше 1/6 клетки (2–3 пикселя на 40 клеток)
  const adj = cols.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - cols[i])), 0);
  ok(adj <= 2 && Math.max(...cols) - Math.min(...cols) <= 42, 'жидкость: уровень ровный по всему корыту', { adj, min: Math.min(...cols), max: Math.max(...cols) });
  ok(cols.every(v => v > 255 * 2), 'жидкость: дно залито целиком', cols.slice(0, 5));
  const again = w.run(300);
  ok(again === 0 || w.changes.n === 0, 'жидкость: потом — ни одного движения', w.changes.n);
  // корыто через границу чанков
  const w2 = liqWorld();
  for (let x = 40; x <= 90; x++) w2.set(x, 30, T.STONE);
  for (let y = 10; y <= 30; y++) { w2.set(40, y, T.STONE); w2.set(90, y, T.STONE); }
  for (let y = 12; y < 22; y++) for (let x = 45; x < 52; x++) w2.set(x, y, 0, 255, 1);
  const b2 = w2.sum(1);
  ok(w2.run(8000) < 8000 && w2.sum(1) === b2, 'жидкость: через границу чанков — успокоилась, без потерь', [b2, w2.sum(1)]);
  const lv2 = []; for (let x = 41; x < 90; x++) { let s = 0; for (let y = 10; y < 30; y++) s += w2.cell(x, y).c.lq[w2.cell(x, y).i]; lv2.push(s); }
  const adj2 = lv2.slice(1).reduce((m, v, i) => Math.max(m, Math.abs(v - lv2[i])), 0);
  ok(adj2 <= 2 && Math.max(...lv2) - Math.min(...lv2) <= 52 && Math.abs(lv2[63 - 41] - lv2[64 - 41]) <= 2, 'жидкость: по обе стороны границы уровень одинаковый', { adj2, min: Math.min(...lv2), max: Math.max(...lv2) });
  // вода + лава → обсидиан
  const w3 = liqWorld();
  for (let x = 0; x <= 20; x++) w3.set(x, 20, T.STONE);
  w3.set(5, 19, 0, 255, 2); w3.set(6, 19, 0, 255, 1);
  w3.run(50);
  const ob = w3.cell(5, 19).c.fg[w3.cell(5, 19).i] === T.OBSIDIAN || w3.cell(6, 19).c.fg[w3.cell(6, 19).i] === T.OBSIDIAN;
  ok(ob, 'жидкость: вода и лава — обсидиан');
  // песок падает и ложится стопкой
  const w4 = liqWorld();
  for (let x = 0; x <= 10; x++) w4.set(x, 30, T.STONE);
  for (let y = 5; y < 10; y++) w4.set(5, y, T.SAND);
  w4.run(400);
  const stack = []; for (let y = 25; y < 30; y++) stack.push(w4.cell(5, y).c.fg[w4.cell(5, y).i]);
  ok(stack.every(f => f === T.SAND), 'песок: упал и лёг стопкой на дно', stack);
  // песок в воду: вода вытесняется наверх, ничего не теряется
  const w5 = liqWorld();
  for (let x = 0; x <= 10; x++) w5.set(x, 30, T.STONE);
  for (let y = 26; y < 30; y++) { w5.set(4, y, T.STONE); w5.set(6, y, T.STONE); w5.set(5, y, 0, 255, 1); }
  w5.set(5, 10, T.SAND);
  const b5 = w5.sum(1); w5.run(600);
  ok(w5.cell(5, 29).c.fg[w5.cell(5, 29).i] === T.SAND && w5.sum(1) === b5, 'песок: тонет в воде, вода не пропадает', [w5.sum(1), b5]);
}

// ═══ 5. Столкновения ═══
if (want('physics')) {
  // мир из строк: '#' целый, 'h' полублок, '/' склон «/», '\\' склон «\», '=' платформа
  const map = (rows, ox = 0, oy = 0) => (tx, ty) => { const r = rows[ty - oy]; if (!r) return 0; const ch = r[tx - ox]; return ch === '#' ? 1 : ch === 'h' ? 2 : ch === '/' ? 3 : ch === '\\' ? 4 : ch === '=' ? 5 : 0; };
  const body = (x, y, o = {}) => Object.assign({ x, y, w: 1.15, h: 2.62, vx: 0, vy: 0, ground: false, stepUp: 1.05, drop: false }, o);
  const run = (b, sh, n, f) => { for (let k = 0; k < n; k++) { if (f) f(b, k); b.vy = Math.min(b.vy + 58 / 60, 30); PZ.moveBody(b, 1 / 60, sh); } return b; };
  const floor = map(['', '', '', '', '', '', '', '', '', '', '##########################################']);
  // падение на пол
  let b = run(body(5, 0), floor, 120);
  ok(b.ground && near(b.y + b.h, 10), 'физика: упал и стоит на полу ровно', [b.y + b.h, b.ground]);
  // идёт по полу из отдельных клеток — швы не цепляют
  b = body(2, 10 - 2.62); let catches = 0;
  run(b, floor, 200, q => { q.vx = 8; if (q.wallR) catches++; });
  ok(catches === 0 && b.x > 20 && b.ground, 'физика: по полу из клеток — без зацепов на швах', { x: b.x, catches });
  // стена: упирается вплотную
  const wall = map(['', '', '', '', '', '', '', '          #', '          #', '          #', '##########################']);
  b = body(2, 10 - 2.62); run(b, wall, 120, q => { q.vx = 9; });
  ok(near(b.x + b.w, 10, 1e-3) && b.wallR, 'физика: стена — встал вплотную', b.x + b.w);
  // ступенька в 1 клетку — шагает сам, в 2 — нет
  const step1 = map(['', '', '', '', '', '', '', '', '', '          #################', '##########################']);
  b = body(2, 9 - 2.62); run(b, step1, 120, q => { q.vx = 8; });
  ok(b.x > 11 && near(b.y + b.h, 9, 1e-3), 'физика: ступенька в 1 клетку — зашёл сам', [b.x, b.y + b.h]);
  const step2 = map(['', '', '', '', '', '', '', '', '          ##', '          ##', '##########################']);
  b = body(2, 10 - 2.62); run(b, step2, 120, q => { q.vx = 8; });
  ok(b.x + b.w <= 10 + 1e-3 && near(b.y + b.h, 10, 1e-3), 'физика: стенка в 2 клетки — без прыжка не залезть', [b.x + b.w, b.y + b.h]);
  // потолок: прыжок в потолок — останавливается
  const ceil = map(['', '', '', '', '', '##########', '', '', '', '', '##########']);
  b = body(4, 10 - 2.62); b.ground = true; b.vy = -20;
  let hit = false; run(b, ceil, 30, q => { if (q.hitHead) hit = true; });
  ok(hit && b.y >= 6 - 1e-6, 'физика: прыжок в потолок — голова не проходит', b.y);
  // прыжок у края стены не цепляется за угол
  const ledge = map(['', '', '', '', '', '', '#####', '#####', '#####', '#####', '##########']);
  b = body(5, 10 - 2.62); b.vy = -18;
  let stuck = false; run(b, ledge, 40, (q, k) => { if (k < 20) q.vx = 0; });
  ok(b.x >= 5 - 1e-6 && !b.hitHead, 'физика: прыжок вплотную к стене — не цепляется за угол', [b.x, b.hitHead]);
  // по диагонали в угол: не проваливается сквозь
  const corner = map(['        #', '        #', '        #', '        #', '        #', '        #', '        #', '        #', '        #', '        #', '##########']);
  b = body(4, 3); b.vy = 20; run(b, corner, 120, q => { q.vx = 12; });
  ok(near(b.x + b.w, 8, 1e-3) && near(b.y + b.h, 10, 1e-3), 'физика: в угол по диагонали — встал в угол, не прошёл сквозь', [b.x + b.w, b.y + b.h]);
  // быстрое падение (30 клеток/с) не пробивает пол в 1 клетку
  const thin = map(['', '', '', '', '', '', '', '', '', '', '#########']);
  b = body(3, -40); b.vy = 30; run(b, thin, 200, q => { q.vy = 30; });
  ok(near(b.y + b.h, 10, 1e-3), 'физика: падение 30 клеток/с — пол не пробит', b.y + b.h);
  // полублок: заходит на половину высоты
  const half = map(['', '', '', '', '', '', '', '', '', '          hhhhh', '##########################']);
  b = body(2, 10 - 2.62); run(b, half, 120, q => { q.vx = 6; });
  ok(b.x > 11 && near(b.y + b.h, 9.5, 1e-3), 'физика: полублок — поднялся на полклетки', b.y + b.h);
  // склоны: вверх по «/» плавно и на земле каждый шаг, вниз по «\» — без подскоков
  const slope = map(['', '', '', '', '', '', '        /##\\', '       /####\\', '      /######\\', '     /########\\', '##############################']);
  b = body(1, 10 - 2.62); let air = 0, ys = [];
  run(b, slope, 240, (q, k) => { q.vx = 5; if (k > 3 && !q.ground) air++; ys.push(q.y + q.h); });
  const risen = Math.min(...ys);
  ok(risen <= 6.2, 'физика: по склону «/» поднялся наверх', risen);
  ok(air <= 6, 'физика: склон вверх и вниз — почти всё время на земле (без подскоков)', air);
  ok(b.x > 15 && near(b.y + b.h, 10, 1e-3), 'физика: спустился по «\\» обратно на пол', [b.x, b.y + b.h]);
  // платформа: держит сверху, «вниз» — сквозь, снизу — прыжок сквозь
  const plat = map(['', '', '', '', '', '', '=====', '', '', '', '##########']);
  b = body(1, 0); run(b, plat, 90);
  ok(near(b.y + b.h, 6, 1e-3) && b.ground, 'физика: платформа держит сверху', b.y + b.h);
  b.drop = true; run(b, plat, 60);
  ok(near(b.y + b.h, 10, 1e-3), 'физика: «вниз» — сквозь платформу на пол', b.y + b.h);
  b.drop = false; b.vy = -26; b.ground = false;
  let peak = 99; run(b, plat, 80, q => { peak = Math.min(peak, q.y + q.h); });
  ok(peak < 6, 'физика: прыжок снизу — сквозь платформу', peak);
  ok(near(b.y + b.h, 6, 1e-3), 'физика: …и встал на неё сверху', b.y + b.h);
  // незагруженный мир — стена (shapeAt игры отдаёт 1): ниже y = 10 «не загружено» — не провалиться, пока чанк грузится
  b = body(3, 0); run(b, (tx, ty) => ty >= 10 ? 1 : 0, 90);
  ok(near(b.y + b.h, 10, 1e-3) && b.ground, 'физика: незагруженное — как камень', b.y + b.h);
}

// ═══ 6. Сохранение: упаковка чанка, base64, «файл мира» туда-обратно ═══
if (want('save')) {
  const G = PZ.makeGen(31337);
  let total = 0, max = 0, bad = '';
  for (const [cx, cy] of [[0, 3], [5, 6], [-9, 12], [2, 30], [-1, 1]]) {
    const c = G.genChunk(cx, cy, mk());
    c.st[100] = 0x23; c.lq[200] = 77; c.lt[200] = 1;   // кадр предмета и жидкость
    const p = PZ.packChunk(c), u = PZ.unpackChunk(p);
    bad = bad || same(c, u);
    total += p.length; max = Math.max(max, p.length);
    const b64 = PZ.toB64(p), back = PZ.fromB64(b64);
    if (back.length !== p.length || back.some((v, i) => v !== p[i])) bad = bad || 'b64';
  }
  ok(!bad, 'сохранение: чанк → упаковка → назад — то же самое', bad);
  ok(max < 8000, 'сохранение: чанк в упаковке — меньше 8 КБ', max);
  // все байты 0…255 и все длины base64
  for (let n = 0; n < 7; n++) { const u = new Uint8Array(n * 37 + n).map((_, i) => (i * 97 + n) & 255); const v = PZ.fromB64(PZ.toB64(u)); ok(v.length === u.length && v.every((x, i) => x === u[i]), 'сохранение: base64 длины ' + u.length); }
  // битые данные — исключение, а не мусор в мире
  let threw = 0;
  for (const junk of [new Uint8Array([1, 2, 3]), new Uint8Array([0x50, 0x5a, 1, 0, 255, 1]), PZ.packChunk(G.genChunk(0, 3, mk())).slice(0, 50)]) { try { PZ.unpackChunk(junk); } catch (e) { threw++; } }
  ok(threw === 3, 'сохранение: битый или обрезанный чанк — ошибка', threw);
  // «файл мира» (как exportWorld/importWorld в podzem.js): JSON с base64 — туда-обратно
  const world = { fmt: 'd37-podzem-world', v: 1, world: { id: 'w1', name: 'Тест', seed: 31337, spawn: { x: 0, y: 200 }, flags: { boss1: 1 }, palette: { 'ruby-glow:ruby_ore': 160 } }, chunks: {} };
  const orig = {};
  for (const [cx, cy] of [[0, 3], [1, 3], [-1, 4]]) { const c = G.genChunk(cx, cy, mk()); c.fg[5] = T.TORCH; orig[cx + '|' + cy] = c; world.chunks[cx + '|' + cy] = { d: PZ.toB64(PZ.packChunk(c)), ch: [[cx * 64 + 3, cy * 64 + 4, [{ id: 'torch', n: 5 }, null]]] }; }
  const parsed = JSON.parse(JSON.stringify(world));
  let wbad = '';
  for (const [k, v] of Object.entries(parsed.chunks)) wbad = wbad || same(orig[k], PZ.unpackChunk(PZ.fromB64(v.d)));
  ok(!wbad && parsed.world.seed === 31337 && parsed.chunks['0|3'].ch[0][2][0].n === 5 && parsed.world.palette['ruby-glow:ruby_ore'] === 160, 'сохранение: файл мира — чанки, сундуки, зерно и номера блоков модов на месте', wbad);
  // мир = зерно + изменённые чанки: неизменённый чанк заново сгенерирован — тот же
  ok(!same(G.genChunk(7, 7, mk()), PZ.makeGen(31337).genChunk(7, 7, mk())), 'сохранение: неизменённое не храним — оно из зерна точно такое же');
  // сохранение не пишет в журнал дважды одно и то же — проверено в браузере (podzem.js journal)
}

// ═══ 7. Моды: проверка mod.json ═══
function loadMods(){
  const ctx = { window: {}, console, TextDecoder, TextEncoder, URL, Blob: class {}, setTimeout, clearTimeout };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/podzem-mods.js'), 'utf8'), ctx, { filename: 'podzem-mods.js' });
  return ctx.PZMods;
}
function modsTests(){
  const M = loadMods();
  for (const id of ['ruby-glow', 'starfall']) {
    const dir = path.join(SITE, 'mods/podzem', id), files = new Map();
    for (const f of fs.readdirSync(dir)) files.set(f, fs.readFileSync(path.join(dir, f), 'utf8'));
    const v = M.validate(JSON.parse(files.get('mod.json')), files, 'tiles');
    ok(v.ok && v.mod.scripts.length === 1 && v.mod.blocks.length === 2, 'моды: пример «' + id + '» проходит проверку', v.errors);
    ok(v.mod.scripts[0].code.length > 100, 'моды: скрипт «' + id + '» подхвачен из файла');
  }
  const base = { id: 'test-mod', name: 'Тест', version: '1.0.0', game: 'tiles', blocks: [{ id: 'gem', name: 'Самоцвет', texture: 'gem' }], textures: { gem: { draw: { pattern: 'ore', base: '#123456' } } } };
  const v0 = M.validate(base, new Map(), 'tiles');
  ok(v0.ok && v0.mod.blocks[0].key === 'test-mod:gem', 'моды: минимальный мод — ок, блок с пространством имён', v0.errors);
  const bad = (patch, name, forGame = 'tiles') => { const j = JSON.parse(JSON.stringify(base)); Object.assign(j, patch); const v = M.validate(j, new Map(), forGame); ok(!v.ok && v.errors.length > 0, 'моды: отклонён — ' + name, v.errors); return v; };
  bad({ id: 'Bad Id!' }, 'id с пробелом и заглавными');
  bad({ id: 'a' }, 'id из 1 буквы');
  bad({ name: '' }, 'нет названия');
  bad({ version: 'один' }, 'версия словами');
  bad({ game: 'voxel' }, 'мод для кубического мира');
  bad({ game: 'minecraft' }, 'неизвестная игра');
  ok(M.validate(Object.assign({}, base, { game: 'both' }), new Map(), 'tiles').ok, 'моды: game "both" подходит обеим играм');
  ok(M.validate(Object.assign({}, base, { game: 'both' }), new Map(), 'voxel').ok && !M.validate(base, new Map(), 'voxel').ok, 'моды: та же спецификация у воксельной игры (tiles туда нельзя)');
  bad({ api: 99 }, 'API новее игры');
  bad({ blocks: Array.from({ length: 70 }, (_, i) => ({ id: 'b' + i })) }, 'больше 64 блоков');
  bad({ blocks: [{ id: 'gem' }, { id: 'gem' }] }, 'два блока с одним id');
  bad({ textures: { gem: 'http://evil.example/x.png' } }, 'картинка по сети');
  bad({ textures: { gem: '../../etc/passwd.png' } }, 'путь из архива наружу');
  bad({ recipes: [{ result: 'gem' }] }, 'рецепт без ингредиентов');
  bad({ recipes: [{ result: 'gem', ingredients: [['stone', 1]], station: 'кухня' }] }, 'неизвестный станок');
  bad({ worldgen: [{ type: 'ore', block: 'нет-такого' }] }, 'руда из чужого блока');
  bad({ worldgen: [{ type: 'volcano', block: 'gem' }] }, 'неизвестный тип генерации');
  bad({ scripts: [{ lang: 'python', code: 'x' }] }, 'скрипт на Python');
  bad({ scripts: [{ lang: 'js', file: 'nope.js' }] }, 'скрипт без файла');
  bad({ scripts: [{ lang: 'js', code: 'x'.repeat(300000) }] }, 'скрипт больше 200 КБ');
  bad({ items: [{ id: 'lamp', places: 'чужой' }] }, 'предмет ставит чужой блок');
  const proto = JSON.parse('{"id":"proto-mod","name":"x","version":"1.0.0","game":"tiles","__proto__":{"polluted":1}}');
  ok(!M.validate(proto, new Map(), 'tiles').ok && ({}).polluted === undefined, 'моды: __proto__ в mod.json — отклонён, прототипы целы');
  ok(M.validate(Object.assign({}, base, { light: 1 }), new Map()).ok, 'моды: лишние поля просто игнорируются');
  const v1 = M.validate(Object.assign({}, base, { recipes: [{ result: 'gem', ingredients: [['stone', 3]], station: 'furnace' }], items: [{ id: 'gem_item', name: 'Самоцвет', places: 'gem' }] }), new Map());
  ok(v1.ok && v1.mod.recipes[0].o === 'test-mod:gem' && v1.mod.recipes[0].i[0][0] === 'stone' && v1.mod.items[0].places === 'test-mod:gem', 'моды: ссылки — свои с пространством имён, встроенные как есть', v1.mod && v1.mod.recipes);
  // ZIP: читаем stored-архив, собранный тут же
  const zipStored = files => {
    const parts = [], cd = []; let off = 0; const enc = new TextEncoder();
    for (const [name, text] of files) {
      const n = enc.encode(name), d = enc.encode(text), h = Buffer.alloc(30);
      h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(0, 8); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
      parts.push(h, n, d);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0, 10); c.writeUInt32LE(d.length, 20); c.writeUInt32LE(d.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
      cd.push(c, n); off += 30 + n.length + d.length;
    }
    const cds = Buffer.concat(cd), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cds.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cds, e]);
  };
  const z = zipStored([['ruby-glow/mod.json', fs.readFileSync(path.join(SITE, 'mods/podzem/ruby-glow/mod.json'), 'utf8')], ['ruby-glow/main.js', fs.readFileSync(path.join(SITE, 'mods/podzem/ruby-glow/main.js'), 'utf8')]]);
  return M.unzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.length)).then(map => {
    ok(map.has('mod.json') && map.has('main.js'), 'моды: .d37mod/.zip — файлы прочитаны, общая папка убрана', [...map.keys()]);
  }).then(() => M.unzip(new ArrayBuffer(10)).then(() => ok(false, 'моды: мусор вместо zip — ошибка'), () => ok(true)));
}

// ═══ 8. Песочница мода: API, лимиты, ошибки не роняют игру; Lua ═══
function sandbox(M, scripts, luaSrc){
  const out = [];
  const ctx = { console, setTimeout, clearTimeout, Math, JSON, Date };
  ctx.globalThis = ctx;
  ctx.postMessage = m => out.push(m);
  vm.createContext(ctx);
  vm.runInContext('(' + M.runtime.toString() + ')()', ctx, { filename: 'runtime.js' });
  const names = PZ.TILES.map(t => t ? t.key : ''); names[160] = 'ruby-glow:ruby_ore';
  ctx.onmessage({ data: { t: 'init', id: 'test', names, wnames: PZ.WALLS.map(w => w ? w.key : ''), limit: 400, luaSrc: luaSrc || '', scripts } });
  return { out, send: d => ctx.onmessage({ data: d }), ctx };
}
const view = (x0, y0, w, h, fill = 0) => ({ x0, y0, w, h, fg: new Uint8Array(w * h).fill(fill), wall: new Uint8Array(w * h), lq: new Uint8Array(w * h), lt: new Uint8Array(w * h) });
async function sandboxTests(){
  const M = loadMods();
  // JS: события, world.get по «окну», world.set, fx, npc, команды
  const js = `
    let n = 0;
    mod.on('tileBreak', e => { n++; fx.particles(e.x, e.y, 'spark', 5); if (world.get(e.x + 1, e.y) === 'stone') world.set(e.x + 1, e.y, 'air'); });
    mod.on('onTick', e => { if (world.isNight()) player.message('ночь ' + n); });
    npc.addLine('Совет из мода');
    commands.add('счёт', 'сколько', () => player.message('счёт ' + n));
    mod.on('use', () => { throw new Error('бах'); });
    mod.on('use', () => fx.sound('coin'));`;
  const s = sandbox(M, [{ lang: 'js', name: 'main.js', code: js }]);
  ok(s.out.some(m => m.t === 'ready'), 'песочница: мод запустился');
  ok(s.out.some(m => m.t === 'cmd' && m.c.c === 'line' && m.c.text === 'Совет из мода'), 'песочница: npc.addLine — Проводнику');
  ok(s.out.some(m => m.t === 'cmdAdd' && m.name === 'счёт'), 'песочница: commands.add — команда «/счёт»');
  ok(['tileBreak', 'tick', 'use'].every(ev => s.out.some(m => m.t === 'want' && m.ev === ev)), 'песочница: события (и onTick → tick) подписаны');
  const v = view(0, 0, 33, 33, PZ.T.STONE);
  s.out.length = 0;
  s.send({ t: 'ev', ev: 'tileBreak', data: { x: 10, y: 10, tile: 'stone' }, view: v, st: { night: false } });
  ok(s.out.some(m => m.t === 'cmd' && m.c.c === 'parts') && s.out.some(m => m.t === 'cmd' && m.c.c === 'set' && m.c.x === 11 && m.c.tile === 'air'), 'песочница: world.get по окну мира и world.set → команды игре', s.out);
  s.out.length = 0;
  s.send({ t: 'ev', ev: 'tileBreak', data: { x: 10, y: 10 }, view: v, st: {} });
  ok(!s.out.some(m => m.t === 'cmd' && m.c.c === 'set'), 'песочница: после world.set окно знает, что там уже пусто');
  s.out.length = 0;
  s.send({ t: 'ev', ev: 'tick', data: { dt: .5 }, view: v, st: { night: true } });
  ok(s.out.some(m => m.t === 'cmd' && m.c.c === 'msg' && m.c.text === 'ночь 2'), 'песочница: tick и состояние мира (ночь) доходят', s.out);
  s.out.length = 0;
  s.send({ t: 'ev', ev: 'use', data: { item: 'x' }, st: {} });
  ok(s.out.some(m => m.t === 'error' && /бах/.test(m.msg)) && s.out.some(m => m.t === 'cmd' && m.c.c === 'sound'), 'песочница: ошибка в одном обработчике — другие работают, ошибка — в журнал', s.out);
  s.out.length = 0;
  s.send({ t: 'ev', ev: 'command', name: 'счёт', args: [], st: {} });
  ok(s.out.some(m => m.t === 'cmd' && m.c.text === 'счёт 2'), 'песочница: команда выполняется');
  // лимит действий за событие
  const flood = sandbox(M, [{ lang: 'js', name: 'flood.js', code: `mod.on('tick', () => { for (let i = 0; i < 5000; i++) fx.sound('coin'); });` }]);
  flood.out.length = 0;
  flood.send({ t: 'ev', ev: 'tick', data: {}, st: {} });
  const sent = flood.out.filter(m => m.t === 'cmd').length;
  ok(sent === 400 && flood.out.some(m => m.t === 'error' && /слишком много/.test(m.msg)), 'песочница: больше 400 действий за событие — обрезано, ошибка', sent);
  // синтаксическая ошибка — ошибка, а не падение
  const syn = sandbox(M, [{ lang: 'js', name: 'bad.js', code: 'mod.on("tick", => {' }]);
  ok(syn.out.some(m => m.t === 'error') && syn.out.some(m => m.t === 'ready'), 'песочница: синтаксическая ошибка — в журнал, песочница жива');
  // нет сети и страницы
  const net = sandbox(M, [{ lang: 'js', name: 'net.js', code: `mod.log(typeof fetch, typeof document, typeof window, typeof localStorage, typeof XMLHttpRequest);` }]);
  const lg = net.out.find(m => m.t === 'log');
  ok(lg && lg.text === 'undefined undefined undefined undefined undefined', 'песочница: fetch, document, window, localStorage недоступны', lg);
  // неизвестное событие — понятная ошибка
  const unk = sandbox(M, [{ lang: 'js', name: 'u.js', code: `mod.on('взрыв', () => {});` }]);
  ok(unk.out.some(m => m.t === 'error' && /нет события/.test(m.msg)), 'песочница: неизвестное событие — понятная ошибка');
  // ── Lua: тот же API (пример «Звездопад») ──
  const lctx = { window: {}, console, setTimeout, clearTimeout };
  lctx.window = lctx;
  vm.createContext(lctx);
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-lua.js'), 'utf8'), lctx, { filename: 'lang-lua.js' });
  const luaWorker = lctx.D37E.langs.lua.worker.toString();
  const code = fs.readFileSync(path.join(SITE, 'mods/podzem/starfall/main.lua'), 'utf8');
  const L = sandbox(M, [{ lang: 'lua', name: 'main.lua', code }], '(' + luaWorker + ')();');
  ok(L.out.some(m => m.t === 'ready') && !L.out.some(m => m.t === 'error'), 'песочница Lua: пример «Звездопад» запустился без ошибок', L.out.filter(m => m.t === 'error'));
  ok(L.out.some(m => m.t === 'cmdAdd' && m.name === 'звезда') && L.out.some(m => m.t === 'cmd' && m.c.c === 'line'), 'песочница Lua: команда /звезда и совет Проводнику');
  ok(L.out.some(m => m.t === 'want' && m.ev === 'tick') && L.out.some(m => m.t === 'want' && m.ev === 'use'), 'песочница Lua: подписки на tick и use');
  // /звезда: земля в окне — кратер и звёздный камень
  const lv = view(-10, 0, 41, 40, 0);
  for (let y = 20; y < 40; y++) for (let x = 0; x < 41; x++) lv.fg[y * 41 + x] = PZ.T.DIRT;
  L.out.length = 0;
  L.send({ t: 'ev', ev: 'command', name: 'звезда', args: [], view: lv, st: { x: 0, y: 19, night: true } });
  await new Promise(r => setTimeout(r, 20));
  const sets = L.out.filter(m => m.t === 'cmd' && m.c.c === 'set');
  ok(sets.length >= 6 && sets.some(m => m.c.tile === 'starfall:starstone' && m.c.y === 21), 'песочница Lua: /звезда — world.set кратера и звёздного камня', L.out.slice(0, 6));
  ok(L.out.some(m => m.t === 'cmd' && m.c.c === 'parts') && L.out.some(m => m.t === 'cmd' && m.c.c === 'shake'), 'песочница Lua: частицы и тряска');
  // ошибка Lua — с номером строки, песочница жива
  const LE = sandbox(M, [{ lang: 'lua', name: 'bad.lua', code: 'mod.on("tick", function(e)\n  local x = nil\n  x.y = 1\nend)' }], '(' + luaWorker + ')();');
  LE.out.length = 0;
  LE.send({ t: 'ev', ev: 'tick', data: { dt: .5 }, st: {} });
  await new Promise(r => setTimeout(r, 20));
  const le = LE.out.find(m => m.t === 'error');
  ok(le && le.line === 3, 'песочница Lua: ошибка — с номером строки', le);
}

// ═══ 10. Шейдеры 2D (js/engine/shade2d.js): наборы, «Авто», признаки; GLSL — безопасно для телефонов ═══
if (want('shade2d')) {
  const saved = globalThis.D37E, savedOpt = globalThis.D37Opt;
  let dev = 'high';
  globalThis.D37E = { quality: () => dev };
  globalThis.D37Opt = undefined;
  vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine/shade2d.js'), 'utf8'), { filename: 'shade2d.js' });
  const S2 = globalThis.D37E.shade2d;
  ok(!!S2 && ['normal', 'pretty', 'ultra', 'retro'].every(k => S2.PACKS[k]) && S2.LIST.join() === 'auto,normal,pretty,ultra,retro', 'шейдеры 2D: четыре набора и «Авто»');
  ok(S2.pack() === 'pretty', 'шейдеры 2D: «Авто» на мощном устройстве — «Красивые»', S2.pack());
  dev = 'mid'; ok(S2.pack() === 'normal', 'шейдеры 2D: «Авто» на телефоне — «Обычные»', S2.pack());
  dev = 'low'; ok(S2.flags().q === 0 && S2.flags().post === false, 'шейдеры 2D: слабое устройство — «Обычные» без мелочей', S2.flags());
  dev = 'high';
  globalThis.D37Opt = { rev: 1, gfx: { preset: 'ultra', shaders: 'auto' } }; ok(S2.pack() === 'ultra', 'шейдеры 2D: «Авто» по пресету «Ультра»');
  globalThis.D37Opt.gfx.preset = 'low'; ok(S2.pack() === 'normal', 'шейдеры 2D: «Авто» по пресету «Низкая» — «Обычные»');
  globalThis.D37Opt.gfx = { preset: 'auto', shaders: 'retro', crt: true };
  const fr = S2.flags();
  ok(S2.pack() === 'retro' && fr.crt === true && fr.smooth === false && fr.pixel === 2 && fr.posterize > 0 && fr.post, 'шейдеры 2D: «Ретро» — крупные пиксели, свет клетками, полоски CRT', fr);
  globalThis.D37Opt.gfx = { shaders: 'pretty' }; const fp = S2.flags();
  ok(fp.post && fp.bloom > 0 && fp.distort && fp.vignette > 0 && fp.grade && fp.q === 2, 'шейдеры 2D: «Красивые» — свечение, рябь/жар, цвет, виньетка', fp);
  globalThis.D37Opt.gfx = { shaders: 'ultra' }; const fu = S2.flags();
  ok(fu.q === 3 && fu.bloomBlur > fp.bloomBlur && fu.particles > fp.particles, 'шейдеры 2D: «Ультра» — больше выборок и частиц', fu);
  globalThis.D37Opt.gfx = { shaders: 'чужое' }; ok(S2.pack() === 'pretty', 'шейдеры 2D: неизвестное значение — как «Авто»');
  const off = S2.use(); ok(S2.users === 1, 'шейдеры 2D: игра отметилась (вкладка «Графика» в её ⚙️)'); off(); off(); ok(S2.users === 0, 'шейдеры 2D: закрыли — счётчик назад (дважды — не уходит в минус)');
  // GLSL для телефонов: highp у сэмплеров, smoothstep(a, b, x) с числами — только a < b
  const glsl = Object.values(S2.GLSL).join('\n'), gl2 = fs.readFileSync(path.join(SITE, 'js/games/podzem-gl.js'), 'utf8'), s2src = fs.readFileSync(path.join(SITE, 'js/engine/shade2d.js'), 'utf8');
  const bad = [];
  for (const src of [glsl, gl2, s2src]) for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) if (+m[1] >= +m[2]) bad.push(m[0]);
  ok(!bad.length, 'шейдеры 2D: smoothstep только с edge0 < edge1 (иначе на части телефонов не определено)', bad);
  const shaders = [...s2src.matchAll(/`#version 300 es[\s\S]*?`/g), ...gl2.matchAll(/`#version 300 es[\s\S]*?`/g)].map(m => m[0]);
  const noHp = shaders.filter(s => /uniform\s+(u?)sampler2D/.test(s) && !/precision highp sampler2D/.test(s));
  ok(shaders.length >= 8 && !noHp.length, 'шейдеры 2D: у всех сэмплеров highp (телефоны)', noHp.map(s => s.slice(0, 80)));
  ok(Object.values(S2.GLSL).every(s => (s.match(/\{/g) || []).length === (s.match(/\}/g) || []).length), 'шейдеры 2D: куски GLSL — скобки сходятся');
  globalThis.D37E = saved; globalThis.D37Opt = savedOpt;
}

// ═══ 9. Скорость: генерация и свет на чанк ═══
function perf(){
  const G = PZ.makeGen(2024);
  let t0 = process.hrtime.bigint(), n = 0;
  for (let cx = -10; cx < 10; cx++) for (let cy = 2; cy < 8; cy++) { G.genChunk(cx, cy, mk()); n++; }
  const genMs = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  const list = []; for (let cy = 2; cy < 7; cy++) for (let cx = -3; cx <= 3; cx++) list.push([cx, cy]);
  t0 = process.hrtime.bigint();
  const w = worldWorker(2024, list);
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6 / list.length;
  const sp = G.spawnPoint();
  t0 = process.hrtime.bigint();
  for (let k = 0; k < 40; k++) w.edit([[sp.x + (k % 10), sp.y + 10 + (k >> 3), k % 2 ? T.TORCH : 0, 2]]);
  const editMs = Number(process.hrtime.bigint() - t0) / 1e6 / 40;
  const c = mk(); G.genChunk(0, 3, c);
  t0 = process.hrtime.bigint();
  for (let k = 0; k < 200; k++) PZ.unpackChunk(PZ.packChunk(c));
  const packMs = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  console.log(`  скорость: генерация ${genMs.toFixed(2)} мс/чанк · генерация+свет в потоке ${loadMs.toFixed(2)} мс/чанк · правка+пересчёт света ${editMs.toFixed(2)} мс · упаковка туда-обратно ${packMs.toFixed(3)} мс`);
  ok(genMs < 20, 'скорость: генерация чанка < 20 мс', genMs);
  ok(loadMs < 40, 'скорость: генерация + свет чанка < 40 мс', loadMs);
  ok(editMs < 15, 'скорость: правка клетки со светом < 15 мс', editMs);
}

(async () => {
  try {
    if (want('mods')) await modsTests();
    if (want('sandbox')) await sandboxTests();
    if (want('perf')) perf();
  } catch (e) { fail++; console.log('FAIL исключение', e && e.stack || e); }
  console.log(`tiles-test: ${pass} ok, ${fail} fail (${((Date.now() - t00) / 1000).toFixed(1)} с)`);
  process.exit(fail ? 1 : 0);
})();

// Support v2 — load paths with mass and moments (T-124, STRUCTURE_HAZARDS.md §2.1 S1.L, step SH1) in node:
// node --expose-gc scripts/support-load-test.cjs [--fast]
// G7 targets ("not on a stick") and the §3 targets as integer verdicts (equal to the T-120 float prototype), failure by the
// "held before" rule (an overloaded import never falls on an unrelated edit), the placement rule (a heavy block on a slab is
// refused), the same verdict from 5 seeds, boundary anchors (unloaded = code 5) never fail, landing re-check, boxes (Studio),
// the job: op budget per world tick, equal finishing tick at 30 / 60 / 144 fps, per-tick time (PC and "phone" ×4), no garbage.
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
globalThis.document = { hidden: false, body: { classList: { contains: () => false } } };
for (const f of ['js/engine/core.js', 'js/engine/support.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
const E = window.D37E, S = E.support, M = S.MAT;
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const sec = t => console.log('— ' + t);
const now = () => Number(process.hrtime.bigint()) / 1e6;
const key = (x, y, z) => x + ',' + y + ',' + z;

// ── a world of cells: [x, y, z, material key, natural?]; below y 0 — ground (code 1); `hole` — unloaded (code 5) ──
function world(cells, mode = 'real'){
  const map = new Map(); for (const c of cells) map.set(key(c[0], c[1], c[2]), c);
  const W = { map, mode, hole: null };
  W.read = (x, y, z) => {
    if (W.hole && W.hole(x, y, z)) return 5;
    if (y < 0) return 1;
    const c = map.get(key(x, y, z)); if (!c) return 0;
    if (c[4]) return mode === 'soft' ? 1 : (M.rock << 2) | 3;
    return (M[c[3]] << 2) | 2;
  };
  W.del = (x, y, z) => { const code = W.read(x, y, z); map.delete(key(x, y, z)); return [x, y, z, code]; };
  W.put = (x, y, z, mat) => map.set(key(x, y, z), [x, y, z, mat]);
  W.has = (x, y, z) => map.has(key(x, y, z));
  return W;
}
const post = (h, mat = 'wood', x = 0, z = 0, y0 = 0) => Array.from({ length: h }, (_, i) => [x, y0 + i, z, mat]);
const slab = (y, x0, x1, z0, z1, mat = 'wood') => { const r = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) r.push([x, y, z, mat]); return r; };
const line = (y, x0, x1, z, mat = 'wood') => slab(y, x0, x1, z, z, mat);
const wall = (h, z0, z1, mat = 'wood', x = 0) => { const r = []; for (let z = z0; z <= z1; z++) r.push(...post(h, mat, x, z)); return r; };
const cliff = () => { const r = []; for (let x = -6; x <= 0; x++) for (let z = -4; z <= 4; z++) for (let y = 0; y < 12; y++) r.push([x, y, z, 'stone', 1]); return r; };
const G = S.grid({ dims: 3, down: -1, max: 24576 }), GE = S.grid({ dims: 3, down: -1, max: 4096 });
const BO = mode => ({ r: 96, rn: 13, P: S.prof(mode) });
// static: ratios of the structure as it is (job 'now', ratios only) → { worst ‰, kind, at, map position → ‰ }
const KIND = ['-', 'joint', 'hang', 'crush', 'storey'];
function stat(W, seed){
  const s = seed || [...W.map.values()].find(c => !c[4]);
  const J = G.loadJob(); J.start('now', [s[0], s[1], s[2], W.read(s[0], s[1], s[2])], W.read, BO(W.mode), { ratiosOnly: true }); J.run();
  const L = J.L(), g = G.g, byPos = new Map(); let w = 0, wi = -1;
  for (let i = 0; i < g.n; i++) { byPos.set(key(G.px[i], G.py[i], G.pz[i]), L.ra[i]); if (!L.unk[i] && L.ra[i] > w) { w = L.ra[i]; wi = i; } }
  return { worst: w, kind: wi < 0 ? '-' : L.ra[wi] > L.raj[wi] ? 'storey' : KIND[L.fk[wi]], at: wi >= 0 ? [G.px[wi], G.py[wi], G.pz[wi]] : null, n: g.n, byPos, unk: J.res.unk, ops: J.res.ops };
}
// collapse: remove cells (job 'rm'), → { fell: Set of positions, groups, crushed, res }
function removeJob(W, list, budget){
  const seeds = []; for (const [x, y, z] of list) seeds.push(...W.del(x, y, z));
  const J = G.loadJob(); J.start('rm', seeds, W.read, BO(W.mode));
  let ticks = 0; if (budget) { while (!J.step(budget)) ticks++; ticks++; } else J.run();
  const fell = new Set(); for (let k = 0; k < G.g.ng; k++) { const a = G.groups(k); for (let i = 0; i < a.length; i += 3) fell.add(key(a[i], a[i + 1], a[i + 2])); }
  return { fell, groups: G.g.ng, res: J.res, ticks };
}
const drop = (W, R) => { for (const k of R.fell) W.map.delete(k); };

// ═══ 1. G7 and §3 targets: integer verdicts = the T-120 float prototype (joint / storey ‰) ═══
sec('G7 «не на палке» и цели §3: те же вердикты и числа, что у прототипа T-120');
const TARGET = [
  // name, cells, mode, expected worst ‰ (prototype ratio × 1000, floor), fails?
  ['3×3 wood slab on 1 post', () => [...post(5), ...slab(5, -1, 1, -1, 1)], 'real', 180, false],
  ['5×5 wood slab on 1 post', () => [...post(5), ...slab(5, -2, 2, -2, 2)], 'real', 1174, true],
  ['13×13 metal slab on 1 post', () => [...post(5, 'metal'), ...slab(5, -6, 6, -6, 6, 'metal')], 'real', 7396, true],
  ['one-sided 3×5 balcony on 1 post', () => [...post(5), ...slab(5, 0, 2, -2, 2)], 'real', 1760, true],
  ['centred 5×3 slab on 1 post', () => [...post(5), ...slab(5, -2, 2, -1, 1)], 'real', 857, false],
  ['wood cantilever 3 off a 5-wide wall', () => [...wall(5, -2, 2), ...line(4, 1, 3, 0)], 'real', 812, false],
  ['wood cantilever 4 off a 5-wide wall', () => [...wall(5, -2, 2), ...line(4, 1, 4, 0)], 'real', 1444, true],
  ['metal cantilever 6', () => [...wall(5, -2, 2, 'metal'), ...line(4, 1, 6, 0, 'metal')], 'real', 877, false],
  ['metal cantilever 7', () => [...wall(5, -2, 2, 'metal'), ...line(4, 1, 7, 0, 'metal')], 'real', 1194, true],
  ['5×5 roof on 4 corner posts', () => [...post(4, 'wood', 0, 0), ...post(4, 'wood', 4, 0), ...post(4, 'wood', 0, 4), ...post(4, 'wood', 4, 4), ...slab(4, 0, 4, 0, 4)], 'real', 440, false],
  ['9×9 roof on 9 posts', () => [...[0, 4, 8].flatMap(x => [0, 4, 8].flatMap(z => post(4, 'wood', x, z))), ...slab(4, 0, 8, 0, 8)], 'real', 660, false],
  ['stone lintel of 3 over a door', () => [...post(3, 'stone', 0, 0), ...post(3, 'stone', 4, 0), ...line(2, 1, 3, 0, 'stone')], 'real', 937, false],
  ['stone overhang 1', () => [...post(3, 'stone'), ...line(2, 1, 1, 0, 'stone')], 'real', 375, false],
  ['stone overhang 2', () => [...post(3, 'stone'), ...line(2, 1, 2, 0, 'stone')], 'real', 1500, true],
  ['1×1 wood tower 25 high', () => post(25), 'real', 564, false],
  ['cliff cantilever 3 (real)', () => [...cliff(), ...line(8, 1, 3, 0)], 'real', 812, false],
  ['cliff cantilever 5 (real)', () => [...cliff(), ...line(8, 1, 5, 0)], 'real', 2256, true],
  ['cliff cantilever 4 (soft)', () => [...cliff(), ...line(8, 1, 4, 0)], 'soft', 722, false],
  ['cliff cantilever 5 (soft)', () => [...cliff(), ...line(8, 1, 5, 0)], 'soft', 1128, true],
];
{
  const rows = [];
  for (const [name, mk, mode, exp, fails] of TARGET) {
    const r = stat(world(mk(), mode));
    rows.push(`  ${name.padEnd(34)} ${mode.padEnd(4)} ${String(r.worst).padStart(5)} ‰ ${r.worst > 1000 ? 'FAILS' : 'holds'} (${r.kind}${r.at ? ' at ' + r.at.join(',') : ''})`);
    ok(r.worst === exp && (r.worst > 1000) === fails, name + ': ' + (fails ? 'не держится' : 'держится') + ' (' + exp + ' ‰)', { got: r.worst, kind: r.kind, at: r.at });
  }
  console.log(rows.join('\n'));
  const b = stat(world([...post(5), ...slab(5, 0, 2, -2, 2)]));
  ok(b.kind === 'storey' && b.at[1] === 0, 'одностороний балкон опрокидывается: худшая проверка — ярус у основания столба', b);
}

// ═══ 2. Collapse: a prop removed — what was overloaded by the edit falls ═══
sec('обрушение: убрали подпорку — падает перегруженное (держалось ДО правки)');
{
  // 5×5 slab on one post + props under the 4 corners: holds; the props knocked out at once — the slab breaks off around the post
  const corners = [[2, 2], [-2, 2], [2, -2], [-2, -2]];
  const W = world([...post(5), ...slab(5, -2, 2, -2, 2), ...corners.flatMap(([x, z]) => post(5, 'wood', x, z))]);
  ok(stat(W).worst <= 1000, '5×5 на столбе и 4 подпорках по углам — держится', stat(W).worst);
  const R = removeJob(W, corners.map(([x, z]) => [x, 0, z]));
  const slabFell = [...slab(5, -2, 2, -2, 2)].filter(c => R.fell.has(key(c[0], c[1], c[2]))).length;
  ok(R.groups >= 1 && slabFell === 24 && !R.fell.has(key(0, 5, 0)) && !R.fell.has(key(0, 4, 0)), 'убрали подпорку — плита отломилась вокруг столба (24 клетки), столб и середина стоят', { groups: R.groups, slabFell, res: R.res });
  // wood cantilever 4 out of a wall with a prop under the tip
  const W2 = world([...wall(5, -2, 2), ...line(4, 1, 4, 0), ...post(4, 'wood', 4, 0)]);
  const R2 = removeJob(W2, [[4, 0, 0]]);
  ok(R2.fell.has(key(1, 4, 0)) && R2.fell.has(key(4, 4, 0)) && !R2.fell.has(key(0, 4, 0)), 'консоль 4 из стены — подпорку убрали: ломается у корня', [...R2.fell]);
  // cliff cantilever 5 built on scaffolding (props under cells 2…5); the props knocked out one by one from the tip — at some
  // step the root joint goes over and the whole cantilever falls from the cliff face (soft and real)
  for (const mode of ['real', 'soft']) {
    const W3 = world([...cliff(), ...line(8, 1, 5, 0), ...[2, 3, 4, 5].flatMap(x => post(8, 'wood', x, 0))], mode);
    ok(stat(W3).worst <= 1000, 'консоль 5 из скалы на лесах (' + mode + ') — держится', stat(W3).worst);
    let rootStep = -1;
    for (const x of [5, 4, 3, 2]) { const R3 = removeJob(W3, [[x, 0, 0]]); if (R3.fell.has(key(1, 8, 0)) && rootStep < 0) rootStep = x; drop(W3, R3); }
    const left = [1, 2, 3, 4, 5].filter(x => W3.has(x, 8, 0));
    ok(rootStep > 0 && left.length === 0, 'убираем леса с конца (' + mode + '): консоль ломается у скалы и падает целиком', { rootStep, left });
  }
  // one-sided balcony on a post with a second post: remove it — it overturns (storey at the post base): reported with the tip
  // direction (+x) for S1.T (SH3: tipping); a straight drop cannot move what rests on its support, so nothing else moves now
  const W4 = world([...post(5), ...slab(5, 0, 2, -2, 2), ...post(5, 'wood', 2, 0)]);
  const R4 = removeJob(W4, [[2, 0, 0]]);
  ok(R4.res.tips >= 1 && R4.res.tipD === 0 && !R4.fell.has(key(0, 0, 0)) && [...R4.fell].every(k => k.startsWith('2,')), 'односторонний балкон без второго столба — опрокидывание (к +x) передано наклону (SH3), прямо вниз не падает', { fell: [...R4.fell], tips: R4.res.tips, tipD: R4.res.tipD });
  // centred 5×3 slab: removing the prop is fine
  const W5 = world([...post(5), ...slab(5, -2, 2, -1, 1), ...post(5, 'wood', 2, 1)]);
  const R5 = removeJob(W5, [[2, 0, 1]]);
  ok([...R5.fell].every(k => k.startsWith('2,') && k.endsWith(',1') && +k.split(',')[1] < 5), 'плита 5×3 по центру — убрали подпорку: падает только верх подпорки', [...R5.fell]);
}

// ═══ 3. "Held before": an already-overloaded import never falls on an unrelated edit ═══
sec('«держалось до»: перегруженное (импорт, старый мир) от посторонней правки не падает');
{
  const W = world([...post(5), ...slab(5, -2, 2, -2, 2), ...post(3, 'stone', 8, 0)]);
  ok(stat(W).worst > 1000, 'импорт: 5×5 на одном столбе (перегружено)', stat(W).worst);
  let R = removeJob(W, [[-2, 5, -2]]); ok(R.fell.size === 0, 'убрал угол плиты — ничего не упало', [...R.fell]);
  R = removeJob(W, [[8, 2, 0]]); ok(R.fell.size === 0, 'правка рядом (верх соседнего столба) — ничего не упало', [...R.fell]);
  W.put(0, 6, 0, 'wood');
  const J = G.loadJob(); J.start('add', [0, 6, 0, W.read(0, 6, 0)], W.read, BO('real')); J.run();
  ok(G.g.ng === 0, 'поставил блок на перегруженную плиту (как в старом мире) — она не падает', J.res);
  const W2 = world([...post(5, 'metal'), ...slab(5, -6, 6, -6, 6, 'metal')]);
  R = removeJob(W2, [[6, 5, 6], [-6, 5, -6]]); ok(R.fell.size === 0, '13×13 из металла на столбе — убрал два угла: стоит, как стояло', R.res);
}

// ═══ 4. Placement: a block that would overload — refused; G.full and unk — allowed ═══
sec('поставить: тяжёлый блок на консоль — нельзя; лёгкий — можно; «край куска» — можно');
{
  const W = world([...wall(5, -2, 2), ...line(4, 1, 3, 0)]);
  const P = S.prof('real');
  const heavy = S.placeCheck(GE, 3, 5, 0, (M.metal << 2) | 2, W.read, BO('real')), hv = { ...heavy };
  const light = S.placeCheck(GE, 1, 5, 0, (M.wood << 2) | 2, W.read, BO('real')), lt = { ...light };
  ok(!hv.ok && hv.sup >= P.min[M.metal] && hv.load === 4, 'металл на конец деревянной консоли: держание есть, но перегрузит — нельзя (рамка тёмно-красная)', hv);
  ok(lt.ok && lt.load >= 1 && lt.load <= 3, 'дерево у корня консоли — можно (рамка — по нагрузке)', lt);
  const tip = S.placeCheck(GE, 4, 4, 0, (M.wood << 2) | 2, W.read, BO('real'));
  ok(!tip.ok, 'четвёртая доска консоли — нельзя (сломается у корня)', { ...tip });
  // building a 5×5 slab on one post cell by cell: the outer ring is refused
  const Ws = world(post(5)); let placed = 0, refused = 0;
  for (let r = 0; r <= 2; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
    if (Math.max(Math.abs(x), Math.abs(z)) !== r || Ws.has(x, 5, z)) continue;
    const c = S.placeCheck(GE, x, 5, z, (M.wood << 2) | 2, Ws.read, BO('real'));
    if (c.ok) { Ws.put(x, 5, z, 'wood'); placed++; } else refused++;
  }
  ok(placed >= 9 && placed < 25 && refused > 0 && stat(Ws).worst <= 1000, 'плиту 5×5 на одном столбе не построить: ' + placed + ' из 25, что поставлено — держится', { placed, refused, worst: stat(Ws).worst });
  // a small estimate grid that cannot hold the piece (G.full) — allowed (better "stands" than a false refusal)
  const Gt = S.grid({ dims: 3, down: -1, max: 64 });
  const big = world([...post(5, 'metal'), ...slab(5, -6, 6, -6, 6, 'metal')]);
  const f = S.placeCheck(Gt, 6, 6, 6, (M.metal << 2) | 2, big.read, { r: 96, rn: 13, P, max: 64 });
  ok(f.ok && Gt.full, 'кусок не влез в оценку (G.full) — можно', { ...f, full: Gt.full });
  // T-124 review: when the estimate piece is cut off (G.full) the load verdict is "allowed" anyway — the load passes are skipped
  // (only the after-side pass 1: the new block's support for the tint), the click costs about a v1 estimate
  { const J = Gt.loadJob(); ok(J.skipped && J.res.full && J.res.ops < 64 * 30 && f.load === 0, 'G.full: нагрузку не считаем (вердикт и так «можно») — ' + J.res.ops + ' шагов на ' + Gt.g.n + ' узлов', { ops: J.res.ops, n: Gt.g.n, skipped: J.skipped }); }
}

// ═══ 5. Boundary anchors: unloaded (code 5) and the piece edge absorb load unchecked, unk never fails; v1 treats 5 as 1 ═══
sec('опора «край куска» (не загружено, код 5): нагрузка уходит туда без проверки, такие узлы не падают; v1 — как опора');
{
  const cells = [...line(4, 1, 8, 0)];
  const W = world(cells); W.hole = (x, y, z) => x <= 0;   // the beam's root is in an unloaded chunk
  const s = stat(W);
  ok(s.unk > 0 && s.worst <= 1000, 'балка уходит в незагруженное: узлы unk, по нагрузке не падает', s);
  const W1 = world(cells); W1.hole = (x, y, z) => x <= 0 && false; const v5 = [], v1 = [];
  for (const code of [5, 1]) { const rd = (x, y, z) => x <= 0 ? code : W1.read(x, y, z); G.build([4, 4, 0, W1.read(4, 4, 0)], rd, BO('real')); G.solve(S.prof('real'), false); (code === 5 ? v5 : v1).push(...G.g.sup.slice(0, G.g.n)); }
  ok(v5.join() === v1.join() && v5.length === 8, 'v1: код 5 — то же держание, что опора (1)', [v5, v1]);
}

// ═══ 6. Same verdict from 5 seeds (the order does not depend on where the edit was) ═══
sec('тот же итог от 5 разных семян симметричного пролёта');
{
  const cells = [...post(4, 'wood', 0, 0), ...post(4, 'wood', 8, 0), ...line(4, 0, 8, 0), ...line(5, 3, 5, 0, 'stone')];
  const seeds = [[0, 0, 0], [8, 0, 0], [4, 4, 0], [1, 4, 0], [4, 5, 0]], sig = [];
  for (const s of seeds) { const r = stat(world(cells), [...s, 'wood']); sig.push([...r.byPos].sort().map(([k, v]) => k + '=' + v).join(';')); }
  ok(sig.every(v => v === sig[0]) && sig[0].length > 20, 'нагрузка в каждой клетке — та же, с какой клетки ни начни', sig.map(v => v.length));
  const fallSig = [];
  for (const order of [[[4, 0, 0], [4, 1, 0], [4, 2, 0], [4, 3, 0]], [[4, 3, 0], [4, 1, 0], [4, 2, 0], [4, 0, 0]], [[4, 2, 0], [4, 0, 0], [4, 3, 0], [4, 1, 0]], [[4, 1, 0], [4, 3, 0], [4, 0, 0], [4, 2, 0]], [[4, 0, 0], [4, 3, 0], [4, 2, 0], [4, 1, 0]]]) {
    const W = world([...cells, ...post(4, 'wood', 4, 0)]);
    const R = removeJob(W, order); fallSig.push([...R.fell].sort().join(';'));
  }
  ok(fallSig.every(v => v === fallSig[0]), 'убрали среднюю опору (семена в 5 разных порядках) — падает одно и то же', fallSig);
  // T-124 review: equal-support neighbours are not side supporters (ties by key sent load along the ring: one corner of a
  // symmetric roof read 1309 ‰ while the mirror corners read 351 / 351 / 22) — mirror cells now read the same (± remainders)
  for (const [n, mode] of [[9, 'real'], [9, 'soft'], [12, 'real']]) {
    const c = []; for (let y = 0; y < 4; y++) for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) if (x === 0 || z === 0 || x === n - 1 || z === n - 1) c.push([x, y, z, 'wood']);
    c.push(...slab(4, 0, n - 1, 0, n - 1));
    const r = stat(world(c, mode), [0, 0, 0, 'wood']), at = (x, z) => r.byPos.get(key(x, 4, z)) | 0;
    let asym = 0, corner = 0;
    for (let x = 1; x < n - 1; x++) for (let z = 1; z < n - 1; z++) { const v = at(x, z), m = [at(n - 1 - x, z), at(x, n - 1 - z), at(n - 1 - x, n - 1 - z), at(z, x)]; for (const w of m) asym = Math.max(asym, Math.abs(v - w)); }
    corner = Math.max(at(1, 1), at(n - 2, 1), at(1, n - 2), at(n - 2, n - 2));
    ok(asym <= 4 && corner < at(1, n >> 1), 'крыша ' + n + '×' + n + ' (' + mode + ') на 4 стенах: зеркальные клетки нагружены одинаково (±' + asym + ' ‰), угол на двух стенах — легче середины стены', { asym, corner, mid: at(1, n >> 1), worst: r.worst, at: r.at });
  }
  { const c = []; for (let y = 0; y < 4; y++) for (let x = 0; x < 9; x++) for (let z = 0; z < 9; z++) if (x === 0 || z === 0 || x === 8 || z === 8) c.push([x, y, z, 'wood']);
    c.push(...slab(4, 0, 8, 0, 8)); const r = stat(world(c), [0, 0, 0, 'wood']);
    ok(r.worst <= 1000, 'дом 9×9 из досок с плоской крышей (реализм) — держится (было 1309 ‰ в одном углу)', { worst: r.worst, at: r.at, kind: r.kind }); }
}

// ═══ 7. Landing re-check: what landed adds load below ("before" = before the landing) ═══
sec('лёг кусок — проверка с нагрузкой: перегрузил консоль — она ломается');
{
  const W = world([...wall(5, -2, 2), ...line(4, 1, 3, 0)]);
  for (const [x, y, z] of [[3, 5, 0], [3, 6, 0], [2, 5, 0]]) W.put(x, y, z, 'stone');   // landed on the tip
  const seeds = []; for (const [x, y, z] of [[3, 5, 0], [3, 6, 0], [2, 5, 0]]) seeds.push(x, y, z, W.read(x, y, z));
  const J = G.loadJob(); J.start('add', seeds, W.read, BO('real')); J.run();
  const fell = new Set(); for (let k = 0; k < G.g.ng; k++) { const a = G.groups(k); for (let i = 0; i < a.length; i += 3) fell.add(key(a[i], a[i + 1], a[i + 2])); }
  ok(fell.has(key(1, 4, 0)) && fell.has(key(3, 6, 0)) && !fell.has(key(0, 4, 0)), 'камни легли на конец консоли — консоль сломалась у корня вместе с ними', [...fell]);
}

// ═══ 8. Boxes (Studio parts, Mir buildings): the same passes; capacities by contact area ═══
sec('детали-коробки: та же нагрузка (площадь касания), тяжёлое на тонкой доске');
{
  const B = S.boxes({ max: 256 }), real = S.prof('real');
  // two concrete walls 3 m high, a wood beam 4 m × 0.5 m between them, a block on the beam
  const mk = heavy => { B.reset(); const a = B.add(0, 0, 0, .3, 3, 1, M.concrete, true), b = B.add(4.3, 0, 0, 4.6, 3, 1, M.concrete, true), p = B.add(.3, 2.5, 0, 4.3, 3, 1, M.wood, false); B.add(2, 3, 0, 2.6, 3.6, 1, heavy ? M.concrete : M.wood, false); B.link(.05); return { a, b, p }; };
  let ids = mk(false); let L = B.loads(real); const light = Math.max(...Array.from(L.ra.subarray(0, B.n)));
  ids = mk(true); L = B.loads(real); const heavy = Math.max(...Array.from(L.ra.subarray(0, B.n)));
  ok(light < heavy && heavy > 0 && heavy <= 1000, 'тяжёлый бетон на балке между стенами нагружает её больше лёгкого, но держится', { light, heavy });
  ids = mk(true); const ng = B.collapse2(real, [ids.b]);
  const fell = []; for (let k = 0; k < ng; k++) fell.push(...B.groups(k));
  ok(fell.includes(ids.p) && fell.includes(3), 'убрали одну стену — балка с бетоном падает (v1 держит её вбок от одной стены; v2 — консоль ломается)', { ng, fell });
  // a house: roof slabs on walls on both sides hold their weight; slabs on one wall line only (support-test §7) overturn
  const house2 = both => { B.reset(); for (let i = 0; i < 6; i++) { B.add(i * 2, 0, 0, i * 2 + 2, 3, .3, M.concrete, true); if (both) B.add(i * 2, 0, 3.7, i * 2 + 2, 3, 4, M.concrete, true); } for (let i = 0; i < 3; i++) B.add(i * 4, 3, 0, i * 4 + 4, 3.3, 4, M.slab, false); B.link(.05); return Math.max(...Array.from(B.loads(real).ra.subarray(0, B.n))); };
  const hw2 = house2(true), hw1 = house2(false);
  ok(hw2 <= 1000 && hw1 > 1000, 'дом: крыша на стенах с двух сторон держится; плиты 4 м на одной стене — перевешивают', { hw2, hw1 });
}

// ═══ 9. The job: op budget per world tick, same finishing tick at 30 / 60 / 144 fps (engine loop) ═══
sec('задание: бюджет шагов на такт мира, тот же такт окончания при 30 / 60 / 144 кадрах');
// a house in a real world with natural ground (like Kubomir): 12×12 walls, a floor every 4, 28 high
function house(){
  const cells = [];
  for (let x = -6; x < 30; x++) for (let z = -6; z < 30; z++) for (let y = -4; y < 0; y++) cells.push([x, y + 4, z, 'stone', 1]);
  for (let y = 4; y < 32; y++) for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) { const e = x === 0 || x === 11 || z === 0 || z === 11, f = (y - 4) % 4 === 3; if (e || f) cells.push([x, y, z, (y + x) % 5 ? 'wood' : 'stone']); }
  return world(cells);
}
let pieceN = 0;
// the same house in a typed-array world (no string keys in read: the timing is the kernel's; the alloc test needs it too)
function houseTA(){
  const N = 48, H = 40, cell = new Uint8Array(N * H * N), I = (x, y, z) => ((x + 8) * H + y) * N + (z + 8);
  for (const c of house().map.values()) cell[I(c[0], c[1], c[2])] = c[4] ? 255 : M[c[3]] + 1;
  const read = (x, y, z) => { if (y < 0) return 1; if (x < -8 || z < -8 || x >= 40 || z >= 40 || y >= H) return 0; const c = cell[I(x, y, z)]; return !c ? 0 : c === 255 ? (M.rock << 2) | 3 : ((c - 1) << 2) | 2; };
  const seeds = [5, 4, 0, read(5, 4, 0), 5, 5, 0, read(5, 5, 0)]; cell[I(5, 4, 0)] = 0; cell[I(5, 5, 0)] = 0;
  return { read, seeds };
}
{
  const run = fps => {
    const W = house(), seeds = [...W.del(5, 4, 0), ...W.del(5, 5, 0)];
    const J = G.loadJob(); J.start('rm', seeds, W.read, BO('real'));
    let t = 0, steps = 0, ticks = 0, doneTick = -1;
    const raf0 = globalThis.requestAnimationFrame, caf0 = globalThis.cancelAnimationFrame, perf0 = performance.now, q = [];
    globalThis.requestAnimationFrame = f => { q.push(f); return q.length; }; globalThis.cancelAnimationFrame = () => {}; performance.now = () => t;
    const Lp = E.loop(() => { steps++; if (steps % 3 === 0 && doneTick < 0) { ticks++; if (J.step(S.SOLVE_BUDGET)) doneTick = ticks; } }, () => {});
    for (let f = 0; f < fps * 20 && doneTick < 0; f++) { t += 1000 / fps; const cb = q.shift(); if (cb) cb(t); }
    Lp.stop(); globalThis.requestAnimationFrame = raf0; globalThis.cancelAnimationFrame = caf0; performance.now = perf0;
    pieceN = G.g.n;
    return { doneTick, ops: J.res.ops, ng: J.res.ng, nf: J.res.nf, n: G.g.n };
  };
  const a = run(30), b = run(60), c = run(144);
  ok(a.doneTick > 1 && a.doneTick === b.doneTick && b.doneTick === c.doneTick && a.ops === c.ops, 'кусок ' + a.n + ' узлов: закончил на ' + a.doneTick + '-м такте при 30 / 60 / 144 кадрах', [a, b, c]);
}
// T-124 review: early release — the v1 groups (held before, not after by pass 1) are published as soon as both pass-1 solves are
// done (o.early); the load failures come later and exclude them. Union of early + final = the groups of a job without early.
sec('ранний сброс: v1-куски падают сразу после двух проходов 1 (не ждут нагрузку); вместе с остальным — то же, что без него');
{
  const rng = S.rng(77), MATS = ['wood', 'stone', 'metal', 'brick', 'glass', 'concrete'];
  const GA = S.grid({ dims: 3, down: -1, max: 4096 }), GB = S.grid({ dims: 3, down: -1, max: 4096 });
  const cellsOf = (Gx, k0, k1, set) => { for (let k = k0; k < k1; k++) { const a = Gx.groups(k); for (let i = 0; i < a.length; i += 3) set.add(key(a[i], a[i + 1], a[i + 2])); } };
  let runs = 0, bad = 0, withEarly = 0, withLate = 0;
  for (let sc = 0; sc < (FAST ? 120 : 300); sc++) {
    const map = new Map(), N = 6 + Math.floor(rng() * 8), K = key;
    for (let p = 0; p < 2 + Math.floor(rng() * 4); p++) { const x = Math.floor(rng() * N), z = Math.floor(rng() * N), h = 2 + Math.floor(rng() * 6), m = MATS[Math.floor(rng() * 6)]; for (let y = 0; y < h; y++) map.set(K(x, y, z), M[m]); }
    for (let s = 0; s < 1 + Math.floor(rng() * 3); s++) { const y = 2 + Math.floor(rng() * 5), x0 = Math.floor(rng() * N), z0 = Math.floor(rng() * N), w = 1 + Math.floor(rng() * 6), d = 1 + Math.floor(rng() * 6), m = MATS[Math.floor(rng() * 6)]; for (let x = x0; x < x0 + w; x++) for (let z = z0; z < z0 + d; z++) map.set(K(x, y, z), M[m]); }
    const read = (x, y, z) => { if (y < 0) return 1; const m = map.get(K(x, y, z)); return m === undefined ? 0 : (m << 2) | 2; };
    const cells = [...map.keys()], seeds = [];
    for (let k = 0; k < 1 + Math.floor(rng() * 3); k++) { const c = cells[Math.floor(rng() * cells.length)].split(',').map(Number); if (map.has(K(c[0], c[1], c[2]))) { seeds.push(c[0], c[1], c[2], read(c[0], c[1], c[2])); map.delete(K(c[0], c[1], c[2])); } }
    const mode = rng() < .5 ? 'soft' : 'real', b = { r: 64, rn: 10, P: S.prof(mode) };
    const JA = GA.loadJob(); JA.start('rm', seeds, read, b); JA.run();
    const ref = new Set(); cellsOf(GA, 0, GA.g.ng, ref); const refSig = [...ref].sort().join(';') + '|' + JA.res.crushed + '|' + JA.res.over + '|' + JA.res.worst;
    for (const bud of [1 << 30, 4096, 97, 1]) {
      const JB = GB.loadJob(); JB.start('rm', seeds, read, b, { early: true });
      const got = new Set(); let e = 0, guard = 0;
      while (!JB.step(bud)) { if (JB.early) { cellsOf(GB, 0, JB.early, got); e += JB.early; JB.early = 0; } if (++guard > 5e6) throw new Error('stuck'); }
      const late = GB.g.ng; cellsOf(GB, 0, late, got); runs++;
      if (e) withEarly++; if (late) withLate++;
      const sig = [...got].sort().join(';') + '|' + JB.res.crushed + '|' + JB.res.over + '|' + JB.res.worst;
      if (sig !== refSig || JB.res.ng0 !== e) { bad++; if (bad < 4) console.log('    early mismatch', sc, bud, refSig.slice(0, 160), '/', sig.slice(0, 160)); }
    }
  }
  ok(bad === 0 && withEarly > 20, 'ранний сброс: ' + runs + ' прогонов (бюджеты 2^30 / 4096 / 97 / 1) — упало то же, что без него (v1-куски раньше: ' + withEarly + ', по нагрузке потом: ' + withLate + ')', { bad, withEarly, withLate });
  // latency: a cut house (Kubomir build weight 16 per node) — the v1 part falls after build + 2 solves, not after the whole job
  const n = 24, h = 16, set = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) if (x === 0 || z === 0 || x === n - 1 || z === n - 1 || y % 4 === 3) set.add(key(x, y, z));
  const rd = (x, y, z) => { if (y < -8) return 1; if (set.has(key(x, y, z))) return (M.stone << 2) | 2; if (y < 0) return (M.rock << 2) | 3; return 0; };
  set.delete(key(0, 0, 5));   // a stone keep 24 × 24 × 16 with floors: one base cell out — the cells it held fall (v1)
  const J = G.loadJob(); J.start('rm', [0, 0, 5, (M.stone << 2) | 2], rd, { r: 96, rn: 13, P: S.prof('real'), opb: 16 }, { early: true });
  let t = 0, te = -1, ne = 0; for (;;) { t++; const fin = J.step(S.SOLVE_BUDGET); if (J.early && te < 0) { te = t; ne = J.early; J.early = 0; } if (fin) break; }
  const bound = Math.ceil(G.g.n * 24 / S.SOLVE_BUDGET) + 1;
  ok(te > 0 && ne > 0 && te <= bound && te * 3 <= t, 'дом ' + G.g.n + ' узлов, проём пробит: v1-куски падают на ' + te + '-м такте (' + (te / 20).toFixed(2) + ' с), задание целиком — ' + t + ' тактов (' + (t / 20).toFixed(2) + ' с)', { te, t, ne, bound, n: G.g.n });
}

// ═══ 10. Per-tick time: v1 synchronous vs v2 slices of SOLVE_BUDGET (PC; "phone" ×4) ═══
sec('время: v1 сразу против v2 по кусочкам (ПК; «телефон» ×4)');
const perf = {};
{
  const reps = FAST ? 5 : 15, v1 = [], v2max = [], v2all = [], ticksN = [];
  const HT = houseTA(), W = { read: HT.read }, seeds = HT.seeds;
  for (let r = 0; r < reps + 4; r++) {
    let t0 = now(); G.build(seeds, W.read, BO('real')); G.collapse(S.prof('real')); const ms1 = now() - t0;
    const J = G.loadJob(); J.start('rm', seeds, W.read, BO('real'));
    let mx = 0, nt = 0; const sl = [];
    for (;;) { t0 = now(); const fin = J.step(S.SOLVE_BUDGET); const d = now() - t0; sl.push(d); if (d > mx) mx = d; nt++; if (fin) break; }
    if (r >= 4) { v1.push(ms1); v2max.push(mx); v2all.push(...sl); ticksN.push(nt); }
  }
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  perf.v1 = +med(v1).toFixed(2); perf.v2tickMed = +med(v2all).toFixed(3); perf.v2tickMax = +med(v2max).toFixed(3); perf.ticks = ticksN[0]; perf.n = pieceN;
  console.log(`  кусок ${pieceN} узлов: v1 (сразу, до + после + группы) ${perf.v1} мс (телефон ×4 ≈ ${(perf.v1 * 4).toFixed(1)}); v2 по ${S.SOLVE_BUDGET} шагов: такт — медиана ${perf.v2tickMed} мс, худший ${perf.v2tickMax} мс (телефон ×4 ≈ ${(perf.v2tickMax * 4).toFixed(2)} мс), тактов ${perf.ticks}`);
  ok(perf.v2tickMax * 4 <= 2.5, 'такт задания v2 на «телефоне» (×4) — не больше ~2 мс (худший ' + (perf.v2tickMax * 4).toFixed(2) + ' мс)', perf);
  // per-phase cost (ns per op) — the OPW weights keep a 4,096-op slice about the same time in every phase
  const J = G.loadJob(); J.start('rm', seeds, W.read, BO('real'));
  const ph = {}; for (;;) { const p = J.phase, o0 = J.ops, t0 = now(); const fin = J.step(512); const d = now() - t0, k = ['build', 'prep', 'solve', 'order', 'load', 'storey', 'select', 'groups'][p] || 'x'; (ph[k] = ph[k] || [0, 0])[0] += d; ph[k][1] += J.ops - o0; if (fin) break; }
  console.log('  нс на шаг по фазам: ' + Object.entries(ph).map(([k, [ms, o]]) => `${k} ${(ms * 1e6 / Math.max(1, o)).toFixed(0)}`).join(', '));
  module.exports = perf;
}

// ═══ 11. No garbage: jobs again and again (separate process) ═══
if (process.argv.includes('--alloc')) {
  const HT = houseTA(), W = { read: HT.read }, seeds = HT.seeds, b = BO('real');
  const run = n => { let s = 0; for (let i = 0; i < n; i++) { const J = G.loadJob(); J.start('rm', seeds, W.read, b); while (!J.step(S.SOLVE_BUDGET)); s += J.res.ng; S.placeCheck(GE, 3, 33, 3, (M.wood << 2) | 2, W.read, b); } return s; };
  run(20);
  let best = Infinity;
  for (let k = 0; k < 4; k++) { global.gc(); global.gc(); const h0 = process.memoryUsage().heapUsed; run(40); best = Math.min(best, (process.memoryUsage().heapUsed - h0) / 40); }
  console.log(JSON.stringify({ perCall: best }));
  process.exit(0);
}
sec('без мусора: задание целиком и проверка «поставить»');
{
  const r = cp.spawnSync(process.execPath, ['--expose-gc', '--max-semi-space-size=64', __filename, '--alloc'], { encoding: 'utf8' });
  let v = null; try { v = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  ok(v && v.perCall < 512, 'задание и проверка почти без мусора: на событие, не на кадр (байт на круг: ' + (v ? v.perCall.toFixed(1) : '?') + ')', r.stderr?.slice(0, 300));
}

// ═══ 12. Rollback flag and bounds ═══
sec('флаг отката и пределы');
{
  ok(S.LOAD === true && S.VERSION === 2 && typeof S.loadJob === 'function', 'S.LOAD — флаг v2 (false — у всех миров v1), S.VERSION 2');
  const id = S.defineMat({ key: 'test_lead', mass: 2 ** 31, up: 5, side: 40, down: 40 }), m = S.MATS[id];
  ok(m.mass === 2 ** 30 && m.comp === 2 ** 30 && m.bend > 0, 'мод: огромная масса — обрезана до 2^30, нагрузка по умолчанию', { mass: m.mass, comp: m.comp });
  const W = world([...post(30, 'test_lead'), ...line(29, 1, 3, 0, 'test_lead')]);
  const s = stat(W); ok(s.n === 33 && Number.isFinite(s.worst), 'огромные числа — без ошибок (насыщение → unk)', { worst: s.worst, unk: s.unk });
}

console.log(`\nНагрузка (v2): ${pass} прошло, ${fail} не прошло`);
process.exit(fail ? 1 : 0);

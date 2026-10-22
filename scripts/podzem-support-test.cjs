// «Подземье» — обрушение и прочность (js/games/podzem-support.js поверх ядра js/engine/support.js) в node: игра целиком
// (scripts/podzem-sim.cjs). node scripts/podzem-support-test.cjs
// Старый мир — без обрушения; «реализм»: столб и балка из досок — подрубил столб, кусок падает и ложится плитками (сколько было —
// столько и есть: плитками или вещами); одинаково при 30 / 60 / 144 кадрах; своды пещер — широкий зал обваливается, узкий —
// нет; «мягкое» — шире держит; поставить то, что не удержится, — нельзя; что поставил игрок — сохраняется с чанком (pl).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);

(async () => {
  const sim = await require('./podzem-sim.cjs')(SITE);
  for (const f of ['js/engine/support.js', 'js/games/podzem-support.js']) vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
  const { A, T } = sim, PZ = globalThis.PZ, ID = k => PZ.TILE[k].id;
  const PLANKS = ID('planks'), STONE = ID('stone');
  async function world(support, seed = 'обрушение'){
    if (T.G.state !== 'menu') await A.stopWorld(false);
    const w = A.newWorldRecord('Проверка', seed, [], support), c = A.newCharRecord('Герой');
    await A.put('worlds', w); await A.put('chars', c);
    await A.play(w.id, c.id);
    for (let i = 0; i < 400 && T.G.state !== 'play'; i++) await sim.frames(.05);
    T.god(true);
    return T.G;
  }
  // площадка для проверок: глубоко под землёй (камень), вырезать пустоту и подождать чанки
  async function site(G, x0, y0){
    T.tp(x0, y0 - 4); await sim.frames(1.5);
    for (let i = 0; i < 40 && !(T.G.chunks.size > 8); i++) await sim.frames(.25);
  }
  const fill = (x0, y0, x1, y1, f) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) T.setCell(x, y, f, 0, null, 0); };
  const placeAt = (G, x, y, f) => { T.setCell(x, y, f, 0, null, 0); G.sup?.placed(x, y); };
  const count = (G, x0, y0, x1, y1, f) => { let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (T.fgAt(x, y) === f) n++; return n; };
  const itemsOf = (G, id) => G.items.filter(i => i.id === id).reduce((a, i) => a + i.n, 0);

  sec('мир без обрушения — как раньше');
  {
    const G = await world(undefined);
    ok(T.G.state === 'play' && G.sup === null, 'старый мир / «выкл» — без обрушения (G.sup = null)', { state: T.G.state, sup: !!G.sup });
  }

  // ── столб и балка ──
  const X0 = 40, Y0 = 520;   // глубоко: вокруг камень
  async function pillar(support, hz){
    const G = await world(support);
    await site(G, X0, Y0);
    fill(X0 - 6, Y0 - 16, X0 + 14, Y0, 0);   // зал 21×17 (природная скала вокруг)
    fill(X0 - 6, Y0 + 1, X0 + 14, Y0 + 1, STONE);   // пол — скала
    for (let y = Y0 - 6; y <= Y0; y++) placeAt(G, X0, y, PLANKS);   // столб 7 (y вниз: верх — Y0 − 6)
    for (let x = X0 + 1; x <= X0 + 4; x++) placeAt(G, x, Y0 - 6, PLANKS);   // балка 4
    T.tp(X0 + 10, Y0 - 2);
    const before = count(G, X0 - 6, Y0 - 16, X0 + 14, Y0, PLANKS);
    const t0 = performance.now();
    T.breakTile(X0, Y0 - 1);   // подрубил столб у пола
    const ms = performance.now() - t0;
    const falling = G.sup.groups.length;
    await sim.frames(3, hz);
    const after = count(G, X0 - 6, Y0 - 16, X0 + 14, Y0, PLANKS), items = itemsOf(G, 'planks') + itemsOf(G, 'wood');
    const tops = []; for (let x = X0; x <= X0 + 4; x++) { let y = Y0 - 16; while (y <= Y0 && T.fgAt(x, y) !== PLANKS) y++; tops.push(y); }
    return { falling, before, after, items, tops, ms, stats: { ...G.sup.stats }, left: G.sup.groups.length };
  }
  sec('«реализм»: подрубил столб — кусок падает и ложится плитками; 30 / 60 / 144 кадра — одинаково');
  {
    const a = await pillar('real', 60), b = await pillar('real', 30), c = await pillar('real', 144);
    ok(a.falling === 1 && a.left === 0, 'подрубил столб — одна падающая группа (верх столба и балка), за 3 с легла', a);
    ok(a.after + a.items >= a.before - 1 && a.after <= a.before - 1, 'ничего не потерялось: плитки на месте или вещами (минус подрубленная)', a);
    ok(JSON.stringify(a.tops) === JSON.stringify(b.tops) && JSON.stringify(a.tops) === JSON.stringify(c.tops), 'легло одинаково при 30 / 60 / 144 кадрах', [a.tops, b.tops, c.tops]);
    console.log(`  пересчёт при ломании: ${a.ms.toFixed(2)} мс (вместе с самим ломанием), групп ${a.stats.groups}, плиток ${a.stats.cells}`);
  }

  sec('поставить то, что не удержится, — нельзя; цвет рамки');
  {
    const G = await world('real');
    await site(G, X0, Y0);
    fill(X0 - 6, Y0 - 16, X0 + 14, Y0, 0); fill(X0 - 6, Y0 + 1, X0 + 14, Y0 + 1, STONE);
    for (let y = Y0 - 3; y <= Y0; y++) placeAt(G, X0, y, PLANKS);
    for (let x = X0 + 1; x <= X0 + 4; x++) placeAt(G, x, Y0 - 3, PLANKS);
    const lv1 = G.sup.level(PLANKS, X0 + 1, Y0 - 4), lv5 = G.sup.level(PLANKS, X0 + 5, Y0 - 3), lv6 = G.sup.level(PLANKS, X0 + 6, Y0 - 3);
    ok(G.sup.canPlace(PLANKS, X0 + 5, Y0 - 3) === (lv5 < 4) && lv1 <= 2 && lv6 === 4 && !G.sup.canPlace(PLANKS, X0 + 6, Y0 - 3), 'балка: у столба — крепко, 6-я от столба — «не держится» и не ставится', { lv1, lv5, lv6 });
    // сохранение: бит «поставил игрок» уходит в запись чанка
    const c = T.chunk(Math.floor(X0 / 64), Math.floor(Y0 / 64));
    ok(!!c?.pl && c.pl.some(v => v), 'что поставил игрок — бит в чанке (c.pl, сохраняется в записи чанка)');
  }

  sec('своды пещер: «реализм» — широкий зал обваливается, узкий — нет; «мягкое» — шире держит');
  async function hall(support, w){
    const G = await world(support);
    const xc = 300, yc = 640;
    await site(G, xc, yc);
    for (let i = 0; i < 20 && !T.G.chunks.has(PZ.key(Math.floor((xc + w) / 64), Math.floor(yc / 64))); i++) await sim.frames(.25);
    // сплошная скала вокруг (природное), зал копаем по плитке слева направо (как игрок)
    fill(xc - 40, yc - 30, xc + w + 40, yc + 6, STONE);
    for (const c of T.G.chunks.values()) c.pl = null;
    let fell = 0;
    for (let x = xc; x < xc + w; x++) for (let y = yc - 2; y <= yc; y++) { T.breakTile(x, y, true); fell += G.sup.groups.length; await sim.frames(.02); }
    await sim.frames(3);
    let roofGone = 0; for (let x = xc; x < xc + w; x++) if (T.fgAt(x, yc - 3) !== STONE) roofGone++;
    return { fell: G.sup.stats.groups, roofGone, avg: G.sup.stats.solves ? +(G.sup.stats.ms / G.sup.stats.solves).toFixed(3) : 0, max: +G.sup.stats.maxMs.toFixed(2) };
  }
  {
    const n12 = await hall('real', 12), n40 = await hall('real', 40), s40 = await hall('soft', 40);
    ok(n12.fell === 0, 'реализм: зал 12 клеток — свод держится', n12);
    ok(n40.fell > 0 && n40.roofGone > 0, 'реализм: зал 40 клеток — свод в середине обвалился', n40);
    ok(s40.fell === 0 || s40.roofGone < n40.roofGone, '«мягкое»: тот же зал — держится (или обвал меньше)', s40);
    console.log(`  копание по плитке: в среднем ${n40.avg} мс, худший ${n40.max} мс (реализм, 40); зал 12: ${JSON.stringify(n12)}, 40: ${JSON.stringify(n40)}, мягкое 40: ${JSON.stringify(s40)}`);
  }

  console.log(`\nПодземье, обрушение: ${pass} прошло, ${fail} не прошло`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

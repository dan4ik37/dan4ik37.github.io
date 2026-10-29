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
  async function world(support, seed = 'обрушение', load){
    if (T.G.state !== 'menu') await A.stopWorld(false);
    const w = A.newWorldRecord('Проверка', seed, [], support), c = A.newCharRecord('Герой');
    if (load) w.load = 1;   // T-124: нагрузка (v2)
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

  // T-124 SH0.2: сундук на рухнувшей балке — не висит в воздухе: содержимое высыпается вещами «keep» (не пропадают через 5 мин и
  // не вытесняются, когда вещей больше 400)
  sec('сундук на рухнувшей постройке: содержимое — вещами «keep», ничего не пропадает');
  {
    const G = await world('real');
    await site(G, X0, Y0);
    fill(X0 - 6, Y0 - 16, X0 + 14, Y0, 0); fill(X0 - 6, Y0 + 1, X0 + 14, Y0 + 1, STONE);
    for (let y = Y0 - 6; y <= Y0; y++) placeAt(G, X0, y, PLANKS);
    for (let x = X0 + 1; x <= X0 + 4; x++) placeAt(G, x, Y0 - 6, PLANKS);
    const CH = ID('chest'), ax = X0 + 2, ay = Y0 - 8;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) T.setCell(ax + dx, ay + dy, CH, (dx + dy * 2) << 4, null, 0);
    const box = Array(20).fill(null); box[0] = { id: 'torch', n: 30 }; box[3] = { id: 'bar_iron', n: 7 }; box[19] = { id: 'wood', n: 50 };
    G.chests.set(ax + ',' + ay, box);
    T.tp(X0 + 10, Y0 - 2);
    T.breakTile(X0, Y0 - 1);
    await sim.frames(3);
    const keep = G.items.filter(i => i.keep), sum = id => keep.filter(i => i.id === id).reduce((a, i) => a + i.n, 0);
    const r = { chestGone: !G.chests.has(ax + ',' + ay) && T.fgAt(ax, ay) !== CH, torch: sum('torch'), iron: sum('bar_iron'), wood: sum('wood'), keep: keep.length };
    ok(r.chestGone && r.torch === 30 && r.iron === 7 && r.wood >= 50, 'балка под сундуком рухнула — сундук не висит, всё содержимое вещами «keep»', r);
    for (let i = 0; i < 450; i++) G.items.push({ id: 'dirt', n: 1, x: X0 - 4 + (i % 9), y: Y0 - 2, w: .6, h: .6, vx: 0, vy: 0, ground: true, stepUp: 0, t: 0, pick: 9, keep: false });
    for (const it of G.items) it.t = 400;
    await sim.frames(.1);
    const left = G.items.filter(i => i.keep).length;
    ok(left === r.keep && G.items.every(i => i.keep), 'прошло 5 минут — обычные вещи пропали, «keep» лежат', { left, was: r.keep, all: G.items.length });
  }

  // ═══ T-124 SH1: нагрузка (W.load = 1) ═══
  sec('нагрузка: консоль на лесах — убираем леса, ломается у столба; «импорт» от посторонней правки не падает; поставить — по нагрузке; 30 / 60 / 144');
  async function scaffold(hz){
    const G = await world('real', 'нагрузка', true);
    await site(G, X0, Y0);
    fill(X0 - 6, Y0 - 16, X0 + 14, Y0, 0); fill(X0 - 6, Y0 + 1, X0 + 14, Y0 + 1, STONE);
    for (let y = Y0 - 6; y <= Y0; y++) placeAt(G, X0, y, PLANKS);
    for (let x = X0 + 1; x <= X0 + 5; x++) placeAt(G, x, Y0 - 6, PLANKS);
    for (let x = X0 + 2; x <= X0 + 5; x++) for (let y = Y0 - 5; y <= Y0; y++) placeAt(G, x, y, PLANKS);   // леса под консолью
    T.tp(X0 + 11, Y0 - 2);
    const before = count(G, X0 - 6, Y0 - 16, X0 + 14, Y0, PLANKS); let rootStep = -1;
    for (const x of [X0 + 5, X0 + 4, X0 + 3, X0 + 2]) { T.breakTile(x, Y0); await sim.frames(1.5, hz); if (rootStep < 0 && T.fgAt(X0 + 1, Y0 - 6) !== PLANKS) rootStep = x - X0; }
    await sim.frames(2, hz);
    const after = count(G, X0 - 6, Y0 - 16, X0 + 14, Y0, PLANKS), items = itemsOf(G, 'planks') + itemsOf(G, 'wood');
    const tops = []; for (let x = X0; x <= X0 + 6; x++) { let y = Y0 - 16; while (y <= Y0 && T.fgAt(x, y) !== PLANKS) y++; tops.push(y); }
    return { load: G.sup.load, rootStep, beam: [1, 2, 3, 4, 5].filter(k => T.fgAt(X0 + k, Y0 - 6) === PLANKS).length, before, after, items, tops, st: { ...G.sup.stats }, jobs: G.sup.jobs() };
  }
  {
    const a = await scaffold(60), b = await scaffold(30), c = await scaffold(144);
    ok(a.load && a.rootStep > 0 && a.beam === 0 && !a.jobs.busy && a.st.jobs >= 4, 'убираем леса с конца — консоль 5 ломается у столба и падает (задание в такте мира)', a);
    ok(a.after + a.items >= a.before - 4, 'ничего не пропало: плитки на месте или вещами (минус 4 выбитых)', a);
    ok(JSON.stringify(a.tops) === JSON.stringify(b.tops) && JSON.stringify(a.tops) === JSON.stringify(c.tops) && a.st.jobs === c.st.jobs, 'легло одинаково при 30 / 60 / 144 кадрах', [a.tops, b.tops, c.tops]);
    console.log(`  нагрузка: заданий ${a.st.jobs}, тактов ${a.st.ticks}, последнее — ${a.st.lastTicks} такт., худший такт ${a.st.maxTickMs.toFixed(2)} мс`);
    // «импорт»: консоль 4 (перегружена) — сломал соседний столб — ничего не падает
    const G = await world('real', 'нагрузка2', true);
    await site(G, X0, Y0);
    fill(X0 - 6, Y0 - 16, X0 + 14, Y0, 0); fill(X0 - 6, Y0 + 1, X0 + 14, Y0 + 1, STONE);
    for (let y = Y0 - 6; y <= Y0; y++) placeAt(G, X0, y, PLANKS);
    for (let x = X0 + 1; x <= X0 + 4; x++) placeAt(G, x, Y0 - 6, PLANKS);
    for (let y = Y0 - 2; y <= Y0; y++) placeAt(G, X0 - 2, y, PLANKS);
    T.tp(X0 + 11, Y0 - 2);
    const lv5 = (() => { G.sup.level(PLANKS, X0 + 5, Y0 - 6); for (let i = 0; i < 9; i++) G.sup.step(1 / 60); return G.sup.level(PLANKS, X0 + 5, Y0 - 6); })();
    ok(!G.sup.canPlace(PLANKS, X0 + 5, Y0 - 6) && !G.sup.canPlace(PLANKS, X0 + 1, Y0 - 7) && G.sup.canPlace(PLANKS, X0 - 1, Y0) && lv5 === 4, 'поставить: 5-я доска консоли — нельзя; на перегруженную консоль сверху — нельзя (нагрузка вырастет); на пол у столба — можно; рамка в такте — тёмно-красная', { lv5 });
    T.breakTile(X0 - 2, Y0 - 2); await sim.frames(2);
    ok([1, 2, 3, 4].every(k => T.fgAt(X0 + k, Y0 - 6) === PLANKS) && G.sup.stats.groups === 0, 'перегруженная консоль (как из импорта): сломал соседний столбик — ничего не упало', G.sup.stats);
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

  // ── 10 минут игры (в node — быстрее настоящего времени): ставим и ломаем вокруг героя, обрушения, своды; без ошибок ──
  sec((process.argv.includes('--fast') ? 2 : 10) + ' минут случайной игры в мире «реализм» — без ошибок');
  {
    const MIN = process.argv.includes('--fast') ? 2 : 10, G = await world('real', 'обвалы');
    await site(G, X0, Y0);
    fill(X0 - 30, Y0 - 24, X0 + 30, Y0, 0); fill(X0 - 30, Y0 + 1, X0 + 30, Y0 + 12, STONE);
    let errs = 0, act = 0, refused = 0; const rnd = globalThis.D37E.support.rng(77), BRICK = ID('brick');
    const errs0 = globalThis.__pzErr = [];
    const onErr = e => { errs++; if (errs < 4) console.log('  ошибка:', e && e.stack); };
    const built = [];   // что поставили (рядом с ним — строим дальше: столбы, балки, навесы)
    for (let s = 0; s < MIN * 60 * 4; s++) {   // 4 действия в секунду
      try {
        if (rnd() < .62) {   // поставить рядом с постройкой (или на пол), если удержится
          let x, y;
          if (built.length && rnd() < .8) { const b = built[Math.floor(rnd() * built.length)], d = Math.floor(rnd() * 4); x = b[0] + (d === 0 ? 1 : d === 1 ? -1 : 0); y = b[1] + (d === 2 ? 1 : d === 3 ? -1 : 0); }
          else { x = X0 - 28 + Math.floor(rnd() * 56); y = Y0; }
          const f = rnd() < .7 ? PLANKS : BRICK;
          if (y > Y0 - 23 && y <= Y0 && !T.fgAt(x, y)) { if (G.sup.canPlace(f, x, y)) { placeAt(G, x, y, f); built.push([x, y]); } else refused++; }
        } else if (built.length) {   // сломать свою (иногда — подпорку) или кусок стены зала
          const i = Math.floor(rnd() * built.length), b = built[i];
          if (T.fgAt(b[0], b[1])) T.breakTile(b[0], b[1], true);
          built.splice(i, 1);
          if (rnd() < .1) T.breakTile(X0 - 31 + Math.floor(rnd() * 3), Y0 - Math.floor(rnd() * 24), true);
        }
        act++;
        if ((s & 3) === 3) await sim.frames(1);
        if (built.length > 900) built.splice(0, 300);
      } catch (e) { onErr(e); }
    }
    await sim.frames(5);
    const st = G.sup.stats;
    console.log(`  ${MIN} мин: действий ${act}, отказ «не удержится» ${refused}, пересчётов ${st.solves} (в среднем ${(st.ms / Math.max(1, st.solves)).toFixed(3)} мс, худший ${st.maxMs.toFixed(2)}), обрушений ${st.groups} (${st.cells} плиток)`);
    ok(errs === 0 && errs0.length === 0, MIN + ' мин игры — без ошибок', errs);
    ok(st.groups > 0 && refused > 0 && G.sup.groups.length === 0, 'были обрушения и отказы, всё упавшее легло', { groups: st.groups, refused, left: G.sup.groups.length });
  }

  console.log(`\nПодземье, обрушение: ${pass} прошло, ${fail} не прошло`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// «Кубомир» удобнее (T-049) без браузера: node --expose-gc scripts/kubomir-qol-test.cjs [путь к three@0.149]
// Шов помощников (D37E.host), ячейки аксессуаров (D37E.accessories), новые вещи и рецепты, что выпадает (кремень, волокно),
// рисунки вещей, переходник «Кубомира» (kubomir-x.js): надеть / снять, ячейки открываются развитием, сохранение и «вместе»
// (данные гостя), стоимость крючков без помощников; дальше — свои разделы у каждого помощника (подсказки, рецепты, лежанка и
// ведро, карта, свиток, задания).
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
let THREE;
for (const p of [process.argv[2], process.env.THREE_PATH, 'three'].filter(Boolean)) {
  try { THREE = require(fs.existsSync(path.join(p, 'build/three.cjs')) ? path.join(p, 'build/three.cjs') : p); break; } catch (e) {}
}
if (!THREE) { console.log('Нет three.js r149: npm i three@0.149.0 во временной папке и node scripts/kubomir-qol-test.cjs <путь>/node_modules/three'); process.exit(1); }
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

globalThis.window = globalThis; globalThis.self = globalThis; globalThis.THREE = THREE;
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
const run = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/gfx.js', 'js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-render.js',
  'js/engine/physics.js', 'js/engine/controls.js', 'js/engine/player.js', 'js/engine/host.js', 'js/engine/accessories.js', 'js/engine/sheet.js', 'js/engine/info.js', 'js/engine/recipes.js', 'js/engine/sleep.js', 'js/engine/mapkit.js', 'js/engine/quests.js',
  'js/games/kubomir-ents.js', 'js/games/kubomir-weather.js', 'js/games/kubomir-x.js', 'js/games/kubomir-info.js', 'js/games/kubomir-recipes.js', 'js/games/kubomir-world.js', 'js/games/kubomir-map.js', 'js/games/kubomir-quests.js', 'js/games/kubomir.js']) run(f);
const E = window.D37E, V = E.vox, ID = V.ID, KB = window.GAME_IMPL.kubomir._test, KX = window.KubomirX;

// игрок и мир-заглушка для переходника помощников
function mkPlayer(){ return { x: .5, y: 60, z: .5, vx: 0, vy: 0, vz: 0, hp: 20, food: 20, sat: 5, sel: 0, fly: false, inv: new Array(36).fill(null), off: null, acc: new Array(KX.ACC_MAX).fill(null), ext: {}, dead: false }; }
function mkSt(o = {}){
  const toasts = [], sounds = [];
  const st = { P: o.P || mkPlayer(), meta: Object.assign({ ach: {}, day: 1, spawn: { x: 0, y: 60, z: 0 } }, o.meta || {}), creative: !!o.creative, coopGuest: !!o.guest, WX: { biome: 'plains' },
    I: { unlock(){}, touch: false }, C: { reset_state(){} }, rig: { yaw: 0, fp: 0 }, R: { lighting: { time: 12 } }, ents: { save: () => [] }, toasts, sounds };
  const g = Object.assign({
    give: s => { for (let pass = 0; pass < 2; pass++) for (let i = 0; i < 36; i++) { const q = st.P.inv[i]; if (pass === 0 && q && q.id === s.id && q.n < (V.item(s.id).stack)) { q.n += s.n; return 0; } if (pass === 1 && !q) { st.P.inv[i] = { id: s.id, n: s.n, d: s.d | 0 }; return 0; } } return s.n; },
    take: () => { const s = st.P.inv[st.P.sel]; if (s && --s.n <= 0) st.P.inv[st.P.sel] = null; },
    toast: t => toasts.push(t), sound: n => sounds.push(n), wrap: () => null, unlock(){},
  }, o.g || {});
  return { st, g };
}

(async () => {
  // ═══ 1. Шов помощников ═══
  sec('D37E.host: события по порядку, без мусора, упавший помощник выключен, свой раздел данных');
  {
    let ext = {}; const fails = [];
    const H = E.host({ ext: () => ext, onFail: f => fails.push(f.id) });
    const log = [];
    H.register({ id: 'b', order: 2, on: { break: (x, y, z, b) => log.push('b' + x + y + z + b) } });
    H.register({ id: 'a', order: 1, on: { break: (x) => log.push('a' + x), place: () => { throw new Error('бум'); } }, update: dt => log.push('u' + dt) });
    ok(H.register({ id: 'a' }) === null, 'повторный id не регистрируется');
    H.init();
    H.emit('break', 1, 2, 3, 4);
    ok(log.join() === 'a1,b1234', 'порядок — по order, аргументы как есть', log);
    const cw = console.warn; console.warn = () => {}; H.emit('place', 0, 0, 0, 0); console.warn = cw;
    ok(fails.join() === 'a' && !H.alive('a') && H.alive('b'), 'упал — выключен до конца игры (и только он)', fails);
    log.length = 0; H.emit('break', 9, 9, 9, 9); H.update(1);
    ok(log.join() === 'b9999', 'выключенный больше не зовётся (ни события, ни шаг)', log);
    ok(H.ext('map') === ext.map && typeof ext.map === 'object', 'H.ext(id) — раздел в данных игрока');
    ext.map = 5; ok(typeof H.ext('map') === 'object', 'испорченный раздел заменяется объектом');
    ok(H.events.includes('ach') && H.events.includes('knockout') && H.events.includes('equip'), 'имена событий — общие для игр', H.events);
    // стоимость: 1 000 000 событий без слушателей и со слушателем
    const H2 = E.host({ ext: () => ({}) }); H2.init();
    let t0 = process.hrtime.bigint(); for (let i = 0; i < 1e6; i++) H2.emit('break', i, 1, 2, 3); const empty = Number(process.hrtime.bigint() - t0) / 1e6;
    let acc = 0; H2.register({ id: 'c', on: { break: x => { acc += x; } } });
    t0 = process.hrtime.bigint(); for (let i = 0; i < 1e6; i++) H2.emit('break', i, 1, 2, 3); const one = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`  события: 10⁶ без слушателей ${empty.toFixed(1)} мс, со слушателем ${one.toFixed(1)} мс`);
    ok(empty / 1e6 < .0005 && one / 1e6 < .001, 'одно событие — меньше микросекунды', { empty, one });
    if (global.gc) {
      global.gc(); const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 2e5; i++) { H2.emit('break', i, 1, 2, 3); H2.update(1 / 60); H2.hud(1 / 60); }
      global.gc(); const dh = process.memoryUsage().heapUsed - h0;
      ok(dh < 64 * 1024, 'событие, шаг и кадр — без мусора (200 000 раз)', dh);
    }
    // чистка данных игрока (сохранение, данные гостя «вместе»)
    const dirty = JSON.parse('{"a":{"__proto__":{"x":1},"b":[1,"s",null,{"c":2}]},"constructor":5,"n":1e999,"s":"' + 'я'.repeat(600) + '","deep":{"1":{"2":{"3":{"4":{"5":{"6":{"7":{"8":1}}}}}}}}}');
    const c = E.host.cleanExt(dirty);
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    ok(!own(c, 'constructor') && c.a && !own(c.a, '__proto__') && c.a.b.length === 4 && Object.getPrototypeOf(c.a) === Object.prototype, 'cleanExt: без __proto__ и constructor, массивы на месте', c);
    ok(c.s.length === 400 && !('n' in c), 'cleanExt: строки ≤ 400, «не числа» отброшены');
    ok(JSON.stringify(c.deep).length < 60, 'cleanExt: глубина ≤ 6', c.deep);
    const big = { a: 'x'.repeat(390), list: Array.from({ length: 400 }, () => 'y'.repeat(390)) };
    ok(JSON.stringify(E.host.cleanExt(big, 4096)).length <= 4096, 'cleanExt: больше предела — крупное выкинуто');
    ok(JSON.stringify(E.host.cleanExt(null)) === '{}' && JSON.stringify(E.host.cleanExt([1, 2])) === '{}', 'cleanExt: не объект — пусто');
  }

  // ═══ 2. Ячейки аксессуаров ═══
  sec('D37E.accessories: правила открытия, надеть / снять, два одинаковых нельзя, действия');
  {
    const have = new Set(), slots = new Array(5).fill(null);
    const FX = { w: ['time'], c: ['dir'], n: ['time', 'dir', 'depth'] };
    let all = false;
    const A = E.accessories.create({ max: 5, slots, rules: [{ n: 2 }, { n: 3, req: 'ach:a', why: 'А' }, { n: 5, req: 'ach:b', why: 'Б' }], fxOf: id => FX[id] || null, has: r => have.has(r), all: () => all });
    ok(A.open === 2 && A.why(2) === 'А' && A.why(4) === 'Б' && A.why(0) === '', 'сначала 2, остальные — с подсказкой «как открыть»', [A.open, A.why(2), A.why(4)]);
    ok(A.canPut(0, { id: 'w' }) === '' && A.canPut(2, { id: 'w' }) === 'lock' && A.canPut(0, { id: 'stone' }) === 'not', 'закрытая — lock, не аксессуар — not');
    slots[0] = { id: 'w', n: 1 }; A.changed();
    ok(A.on('time') && !A.on('dir'), 'надел часы — время есть, сторон света нет');
    ok(A.canPut(1, { id: 'w' }) === 'dup' && A.canPut(0, { id: 'w' }) === '', 'вторые такие же — нельзя (а на своё место — можно)');
    const r0 = A.rev; slots[1] = { id: 'n', n: 1 }; A.changed();
    ok(A.rev > r0 && A.on('depth') && A.on('dir'), 'навигатор — три действия сразу, версия выросла');
    ok(A.firstFree({ id: 'c' }) === -1, 'свободных нет → −1');
    have.add('ach:a'); ok(A.refresh() === 1 && A.open === 3 && A.firstFree({ id: 'c' }) === 2, 'условие выполнено — открылась одна ячейка');
    have.add('ach:b'); ok(A.refresh() === 2 && A.open === 5, 'ещё условие — сразу до 5');
    have.clear(); ok(A.refresh() === 0 && A.open === 5, 'открытое не закрывается (условие «пропало»)');
    slots[4] = { id: 'c', n: 1 }; A.changed(); ok(A.on('dir'), 'действует в любой открытой ячейке');
    const B = E.accessories.create({ max: 5, slots: [null, null, null, { id: 'c', n: 1 }, null], rules: [{ n: 2 }], fxOf: id => FX[id] || null });
    ok(!B.on('dir'), 'вещь в закрытой ячейке не действует');
    ok(B.save().o === 2, 'сохраняется число открытых');
    B.load({ o: 4 }); ok(B.open === 4 && B.on('dir'), 'загрузка: открыто как было — и вещь заработала');
    all = true; ok(A.on('map') && A.on('ore'), '«всё действует» (творчество) — любое действие');
    ok(E.accessories.describe(['time', 'dir']).includes('время') && E.accessories.FX.target.icon, 'описание действий для подсказки');
  }

  // ═══ 3. Вещи, рецепты, что выпадает, рисунки ═══
  sec('реестр: помощники, бумага и карты, книга, свиток, вёдра, лежанка — рецепты и рисунки');
  {
    const NEW = ['watch', 'compass', 'depth_meter', 'lens', 'ore_finder', 'navigator', 'atlas', 'parchment', 'map_blank', 'map_filled', 'master_book', 'recall', 'bucket', 'bucket_water', 'bucket_lava', 'bed'];
    ok(NEW.every(n => V.item(n)), 'все новые вещи есть', NEW.filter(n => !V.item(n)));
    ok(V.items.indexOf(V.item('bucket_lava')) < V.VANILLA_ITEMS && V.blocks.indexOf(V.block('bed')) < V.VANILLA_BLOCKS, 'новое — в «ванили» (моды не стирают при смене мира)');
    // лежанка — сразу за прежними блоками («missing» — последний до неё); новые блоки других задач (деревья пород T-022b…) — только после неё
    ok(V.block('bed').id === V.block('missing').id + 1 && V.block('bed').id < V.VANILLA_BLOCKS && V.blocks.slice(V.block('bed').id + 1).every(b => b.id > V.block('bed').id), 'номера блоков не сдвинулись: лежанка — сразу за прежними, новые — после неё');
    const accs = V.items.filter(i => i.acc); ok(accs.length === 7 && accs.every(i => i.stack === 1 && i.acc.every(f => E.accessories.FX[f])), 'аксессуары — по одному, действия известны', accs.map(i => i.name));
    // каждый новый рецепт собирается своей сеткой
    const grid = r => { const w = r.list ? (r.list.length > 4 || r.table ? 3 : 2) : 3, g = new Array(w * w).fill(null); if (r.list) r.list.forEach((k, i) => { g[i] = k[0] === '#' ? V.TAGS[k.slice(1)][0] : k; }); else r.pattern.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') { const k = r.key[ch]; g[y * w + x] = k[0] === '#' ? V.TAGS[k.slice(1)][0] : k; } })); return { g, w }; };
    for (const out of ['parchment', 'map_blank', 'atlas', 'watch', 'compass', 'depth_meter', 'lens', 'ore_finder', 'navigator', 'master_book', 'recall', 'bucket', 'bed']) {
      const r = V.recipes.find(q => q.out === out), { g, w } = grid(r), res = V.craft(g, w, w);
      ok(res && res.out === out, 'рецепт «' + V.item(out).title + '» собирается', { out, got: res && res.out });
    }
    ok(!V.craft(['watch', 'compass', 'depth_meter', null], 2, 2), 'навигатор — только на верстаке (в руках 2×2 — нет)');
    ok(V.craft(['watch', 'compass', 'depth_meter', null, null, null, null, null, null], 3, 3)?.out === 'navigator', 'навигатор на верстаке — из часов, компаса и глубиномера');
    // что выпадает: таблица V.DROPS (кремень — вместо гравия, 10 %), свой генератор — повторяемо
    let s = 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let flint = 0, gravel = 0, fiber = 0;
    for (let i = 0; i < 20000; i++) { for (const [id] of V.dropsOf(V.block('gravel'), rnd)) id === 'flint' ? flint++ : gravel++; for (const [id] of V.dropsOf(V.block('tall_grass'), rnd)) if (id === 'fiber') fiber++; }
    ok(near(flint / 20000, .1, .01) && flint + gravel === 20000, 'гравий: кремень ~10 % (вместо гравия), всегда что-то одно', { flint, gravel });
    ok(near(fiber / 20000, .15, .012), 'трава: волокно ~15 %', fiber);
    ok(JSON.stringify(V.dropsOf(V.block('clay'))) === '[["clay_ball",4]]' && JSON.stringify(V.dropsOf(V.block('door_oak'))) === '[["door",1]]' && JSON.stringify(V.dropsOf(V.block('stone'))) === '[["cobble",1]]', 'глина ×4, дверь, камень → булыжник — как было');
    ok(JSON.stringify(KB.dropsOf(null, V.block('furnace_lit'))) === '[["furnace",1]]', 'игра берёт ту же таблицу (горящая печь → печь)');
    // рисунки: не пустые, прозрачный фон у вещей, блок лежанки — без дыр
    for (const t of ['item_watch', 'item_compass', 'item_depth_meter', 'item_lens', 'item_ore_finder', 'item_navigator', 'item_atlas', 'item_master_book', 'item_parchment', 'item_map_blank', 'item_map_filled', 'item_recall', 'item_bucket', 'item_bucket_water', 'item_bucket_lava']) {
      const d = V.paint(t, V.TEX_SPECS[t]); let solid = 0, clear = 0; for (let i = 3; i < d.length; i += 4) d[i] ? solid++ : clear++;
      ok(d.length === V.TEX * V.TEX * 4 && solid > 120 && clear > 120, 'рисунок ' + t + ': есть и вещь, и прозрачный фон', { solid, clear });
    }
    for (const t of ['bed_top', 'bed_side']) { const d = V.paint(t, V.TEX_SPECS[t]); let hole = 0; for (let i = 3; i < d.length; i += 4) if (d[i] < 255) hole++; ok(hole === 0, 'блок ' + t + ' — без прозрачных дыр', hole); }
  }

  // ═══ 4. Переходник «Кубомира»: аксессуары игрока ═══
  sec('kubomir-x.js: надеть из руки, снять, ячейки открываются достижениями, творчество, сохранение');
  {
    const { st, g } = mkSt();
    st.P.inv[0] = { id: 'watch', n: 1 }; st.P.inv[1] = { id: 'watch', n: 1 }; st.P.inv[2] = { id: 'compass', n: 1 }; st.P.inv[3] = { id: 'lens', n: 1 };
    const X = KX.attach(st, g);
    ok(X && X.acc.open === 2 && !X.on('time'), 'новый игрок: 2 ячейки, ничего не надето');
    ok(X.useItem(st.P.inv[0], V.item('watch'), 'main', null) && st.P.acc[0]?.id === 'watch' && !st.P.inv[0] && X.on('time'), 'ПКМ с часами — надеты, из руки ушли, время действует');
    st.P.sel = 1; X.useItem(st.P.inv[1], V.item('watch'), 'main', null);
    ok(st.P.inv[1]?.id === 'watch' && st.toasts.some(t => t.includes('уже надет')), 'вторые часы — «уже надеты», остались в руке');
    st.P.sel = 2; X.useItem(st.P.inv[2], V.item('compass'), 'main', null); st.P.sel = 3; X.useItem(st.P.inv[3], V.item('lens'), 'main', null);
    ok(X.on('dir') && st.P.inv[3]?.id === 'lens' && st.toasts.some(t => t.includes('заняты')), 'ячейки кончились — лупа не надета, подсказка «сними что-нибудь»');
    st.toasts.length = 0;
    X.emit('ach', 'night');
    ok(X.acc.open === 3 && st.P.ext.prog.ach.night && st.toasts.some(t => t.includes('новая ячейка')), 'пережил ночь — третья ячейка и поздравление', st.toasts);
    X.useItem(st.P.inv[3], V.item('lens'), 'main', null);
    ok(X.on('target') && !st.P.inv[3], 'теперь лупа надета');
    ok(X.unequip(0) && !st.P.acc[0] && st.P.inv.some(s => s && s.id === 'watch' && s.n === 1) && !X.on('time'), 'снять — в сумку, действие пропало');
    // сохранение: что пишется в мир и что получает хозяин от гостя
    st.ents = { save: () => [] }; st.R = { lighting: { time: 9 } };
    const m = KB.metaSnap(st), saved = JSON.parse(JSON.stringify(m.player));
    ok(Array.isArray(saved.acc) && saved.acc.filter(Boolean).length === 2 && saved.ext.acc.o === 3 && saved.ext.prog.ach.night === 1, 'в сохранении: аксессуары и открытые ячейки', saved.acc);
    const gd = KB.guestData(st);
    ok(gd.acc.length === KX.ACC_MAX && gd.ext === st.P.ext, 'гостю «вместе»: аксессуары и данные помощников уходят хозяину');
    // загрузка того же игрока: как было (ячейки не закрылись, вещи на местах)
    const P2 = mkPlayer(); P2.ext = E.host.cleanExt(saved.ext); for (let i = 0; i < KX.ACC_MAX; i++) P2.acc[i] = saved.acc[i];
    const { st: st2, g: g2 } = mkSt({ P: P2 }); const X2 = KX.attach(st2, g2);
    ok(X2.acc.open === 3 && X2.on('dir') && X2.on('target') && !X2.on('time'), 'после загрузки — 3 ячейки, компас и лупа действуют');
    // творчество — всё открыто и действует; старый мир с достижениями — ячейки по ним
    const { st: st3, g: g3 } = mkSt({ creative: true }); const X3 = KX.attach(st3, g3);
    ok(X3.acc.open === KX.ACC_MAX && X3.on('map') && X3.on('ore'), 'творчество: все ячейки, все помощники действуют');
    const { st: st4, g: g4 } = mkSt({ meta: { ach: { night: 1, iron: 1, deep: 1 } } }); const X4 = KX.attach(st4, g4);
    ok(X4.acc.open === 5, 'старый мир с достижениями «ночь, железо, глубина» — сразу 5 ячеек', X4.acc.open);
    const { st: st5, g: g5 } = mkSt({ guest: true, meta: { ach: { night: 1, iron: 1 } } }); const X5 = KX.attach(st5, g5);
    ok(X5.acc.open === 2, 'гость «вместе»: достижения мира хозяина — не его (ячейки — по своим)', X5.acc.open);
    // лист «Помощники» в node не открывается (нет окна) — без ошибок
    ok(X.openAcc() === null && !X.isOpen() && X.escape() === false, 'без окна лист не открывается, Esc — не наш');
    // меню ☰: пункт «💍 Помощники»
    ok(KB.xMenu({ X }).some(i => i.id === 'x:acc'), 'в меню ☰ — «💍 Помощники»');
    // без мусора: шаг и кадр помощников
    if (global.gc) {
      for (let i = 0; i < 1000; i++) { X.update(1 / 60); X.hud(1 / 60); }
      global.gc(); const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 60000; i++) { X.update(1 / 60); X.hud(1 / 60); }
      global.gc(); const dh = process.memoryUsage().heapUsed - h0;
      ok(dh < 96 * 1024, 'шаг и кадр помощников — без мусора (60 000 раз)', dh);
    }
  }

  // ═══ 5. Подсказки на экране (лупа, часы, компас, глубиномер, рудоискатель, сытость) ═══
  sec('kubomir-info.js: карточка лупы = правила копания (все блоки × все инструменты), строки, руда, сытость, без мусора');
  {
    // слой экрана — подмена (в node нет окна): запоминает, что и сколько раз писали бы в DOM
    const mkHud = () => { const H = { chips: new Map(), writes: 0, cardRec: null, comp: null, shown: true }; return Object.assign(H, {
      chip(id, ic, t){ const c = H.chips.get(id); if (!c || !c.on || c.ic !== ic || c.t !== t) { H.writes++; H.chips.set(id, { ic, t, on: true }); } },
      hide(id){ const c = H.chips.get(id); if (c && c.on) { c.on = false; H.writes++; } },
      card(r){ H.cardRec = r ? { key: r.key, name: r.name, lines: r.lines.map(l => l.slice()), live: r.live } : null; },
      compass(b, l){ H.comp = b == null ? null : { b, n: l ? l.length : 0 }; }, show(v){ H.shown = v; }, dispose(){} }); };
    // мир: один чанк, блок под прицелом — (5, 10, 5); значки вещей в node — строкой (в браузере — картинка canvas)
    V.iconURL = id => 'icon:' + id; V.icon = id => 'icon:' + id;
    const W = new V.World({ seed: 1 }); const ch = new V.Chunk(0, 0); W.add(ch);
    const hud = mkHud();
    const { st, g } = mkSt({ g: { infoHud: () => hud, canHarvestTool: (b, t) => KB.xHooks({}).canHarvestTool(b, t), breakTime: b => KB.breakTime(st, b), lookDir: () => ({ x: 0, y: 0, z: -1 }) } });
    Object.assign(st, { W, ready: true, hudHidden: false, ox: 0, oz: 0, sup: null, net: null, modRun: null, H: { toast(){} }, AU: { play(){} }, mine: {}, steps: 0 });
    Object.assign(st.P, { x: 5.5, y: 11, z: 5.5, exh: 0, onGround: true, eyeWater: false, fly: false, climb: false, sneak: false });
    st.rig = { yaw: 0, fp: 0 };
    const X = KX.attach(st, g), FI = X.feats.find(f => f.id === 'info');
    ok(FI && FI.state().hud, 'помощник «подсказки» подключился (слой экрана — подмена)');
    X.emit('ach', 'night'); X.emit('ach', 'iron'); X.emit('ach', 'deep');
    for (const id of ['lens', 'watch', 'compass', 'depth_meter', 'ore_finder']) { st.P.inv[0] = { id, n: 1 }; st.P.sel = 0; X.useItem(st.P.inv[0], V.item(id), 'main', null); }
    ok(['target', 'time', 'dir', 'depth', 'ore'].every(k => X.on(k)), 'надеты лупа, часы, компас, глубиномер, рудоискатель', X.acc.active());
    // карточка = настоящее копание: для каждого блока с «drop» и каждого инструмента (и руки) — «ничего не выпадет» тогда и только тогда,
    // когда при поломке ничего не выпало
    const tools = ['', ...V.items.filter(i => i.tool && ['pick', 'axe', 'shovel', 'sword'].includes(i.tool.kind)).map(i => i.name)];
    let checked = 0, bad = [];
    KB.opts({ fell: false });
    for (const b of V.blocks) {
      if (b.hard < 0 || !b.drop || !V.item(b.drop) || b.liquid || b.shape === V.SHAPE.door) continue;
      for (const tool of tools) {
        ch.ids[(5 << 11) | (5 << 7) | 10] = V.cell(b.id);
        st.P.inv[0] = tool ? { id: tool, n: 1, d: 0 } : null; st.P.sel = 0;
        const hit = { x: 5, y: 10, z: 5, v: V.cell(b.id), nx: 0, ny: 1, nz: 0 };
        const rec = FI._card(hit, null), cls = rec.lines[0][1], noDrop = /ничего не выпадет/.test(rec.lines[0][0]);
        let drops = 0; st.ents = { addItem: () => { drops++; }, breakFx(){}, debris(){}, onBlockChanged(){}, save: () => [] };
        KB.breakBlock(st, hit);
        checked++;
        if (noDrop !== (drops === 0) || (cls === 'bad') !== noDrop) bad.push([b.name, tool, cls, drops]);
      }
    }
    ok(checked > 400 && !bad.length, 'лупа и копание согласны: «ничего не выпадет» ⇔ при поломке ничего не выпало (' + checked + ' пар блок × инструмент)', bad.slice(0, 6));
    // текст карточки на нескольких целях
    st.P.inv[0] = { id: 'pick_wood', n: 1, d: 0 };
    let r = FI._card({ x: 5, y: 10, z: 5, v: V.cell(ID.ore_iron), nx: 0, ny: 1, nz: 0 });
    ok(r.name === 'Железная руда' && /каменная кирка или лучше/.test(r.lines[0][0]) && r.lines[0][1] === 'bad', 'железная руда деревянной киркой: «каменная кирка или лучше», красная строка', r.lines);
    st.P.inv[0] = { id: 'pick_stone', n: 1, d: 0 };
    r = FI._card({ x: 5, y: 10, z: 5, v: V.cell(ID.ore_iron), nx: 0, ny: 1, nz: 0 });
    ok(r.lines[0][1] === 'ok' && /\d+(,\d)? с/.test(r.lines[0][0]), 'каменной — зелёная, со временем копания (запятая)', r.lines);
    st.P.inv[0] = null;
    r = FI._card({ x: 5, y: 10, z: 5, v: V.cell(ID.log_oak), nx: 0, ny: 1, nz: 0 });
    ok(r.lines[0][1] === 'warn' && /медленно/.test(r.lines[0][0]), 'бревно рукой — «медленно» (жёлтая)', r.lines);
    r = FI._card({ x: 5, y: 10, z: 5, v: V.cell(ID.bedrock), nx: 0, ny: 1, nz: 0 });
    ok(r.lines[0][0] === 'Не сломать' && r.lines[0][1] === 'bad', 'коренная порода — «Не сломать»');
    ch.ids[(5 << 11) | (5 << 7) | 10] = V.cell(ID.chest); W.tile(5, 10, 5, () => ({ items: [{ id: 'stone', n: 3 }, null, { id: 'coal', n: 1 }, ...new Array(24).fill(null)] }));
    r = FI._card({ x: 5, y: 10, z: 5, v: V.cell(ID.chest), nx: 0, ny: 1, nz: 0 });
    ok(r.live === '📦 занято 2 из 27', 'сундук — сколько занято', r.live);
    const mob = { id: 7, type: 'zombie', hp: 6 };
    r = FI._card(null, mob);
    ok(r.name === 'Зомби' && r.lines[0][1] === 'bad' && r.live === '❤ 6 / 20', 'зомби: «опасно», сердечки 6 из 20', r);
    // строки: время (10 игровых минут), сторона и X/Z, глубина и слой
    Object.assign(st.P, { x: 12.7, y: 8.2, z: -40.1 }); st.R = { lighting: { time: 7.75 } }; st.meta.day = 3; st.rig.yaw = -Math.PI / 2;   // смотрит на восток
    st.mobHit = null; st.hit = null;
    FI.hud(.2);
    ok(hud.chips.get('time')?.t === '07:40 · день 3', 'часы: 07:40 · день 3', hud.chips.get('time'));
    ok(hud.chips.get('xz')?.t === 'В · X 12 · Z -41', 'компас: сторона и X / Z', hud.chips.get('xz'));
    ok(hud.chips.get('y')?.t === 'Y 8 · глубины — тут алмазы', 'глубиномер: Y и слой', hud.chips.get('y'));
    ok(hud.comp && near(hud.comp.b, Math.PI / 2, 1e-6), 'полоса компаса: курс 90° (восток)', hud.comp);
    // стоишь — в DOM ничего не пишется (строки и карточка — только при смене)
    const w0 = hud.writes; for (let i = 0; i < 600; i++) FI.hud(1 / 60);
    ok(hud.writes - w0 <= 1, 'стоишь на месте 10 с — строки в DOM не переписываются', hud.writes - w0);
    // рудоискатель: куб 33³ по кусочку — то же, что полный перебор
    for (let i = 0; i < V.CELLS; i++) ch.ids[i] = 0;
    const put = (x, y, z, n) => { ch.ids[(x << 11) | (z << 7) | y] = V.cell(ID[n]); };
    Object.assign(st.P, { x: 4.5, y: 41, z: 4.5 }); st.rig.yaw = 0;
    put(6, 40, 6, 'ore_coal'); put(1, 44, 9, 'ore_iron'); put(12, 30, 2, 'ore_diamond'); put(13, 31, 2, 'ore_diamond'); put(3, 60, 3, 'ore_diamond');   // последний — выше 16
    for (let i = 0; i < 40; i++) FI.hud(.11);
    const best = FI.state().ore;
    // полный перебор того же куба — ответ должен совпасть
    let bf = null;
    for (let x = 4 - 16; x <= 4 + 16; x++) for (let z = 4 - 16; z <= 4 + 16; z++) for (let y = 41 - 16; y <= 41 + 16; y++) { if (x < 0 || z < 0 || x > 15 || z > 15) continue; const t = ch.ids[(x << 11) | (z << 7) | y] & 0xfff, v = { [ID.ore_diamond]: 5, [ID.ore_gold]: 4, [ID.ore_iron]: 3, [ID.ore_coal]: 1 }[t] || 0; if (!v) continue; const d2 = (x - 4) ** 2 + (y - 41) ** 2 + (z - 4) ** 2; if (!bf || v > bf.v || (v === bf.v && d2 < bf.d2)) bf = { v, d2, x, y, z }; }
    ok(best && bf && best.id === ID.ore_diamond && best.x === bf.x && best.y === bf.y && best.z === bf.z, 'рудоискатель: самая ценная в 16 блоках, из двух алмазов — ближайший (как полный перебор), алмаз выше 16 не считается', { best, bf });
    ok(/^Алмазная руда · \d+ бл\. ➡ ниже 10$/.test(hud.chips.get('ore')?.t || ''), 'строка: «Алмазная руда · N бл. ➡ ниже 10» (смотрит на север, руда на востоке — справа)', hud.chips.get('ore'));
    ok(E.info.arrow(1, 0, 0, -1) === '➡' && E.info.arrow(-1, 0, 0, -1) === '⬅' && E.info.arrow(0, -1, 0, -1) === '⬆' && E.info.arrow(0, 1, 0, -1) === '⬇', 'стрелки: на север смотришь — восток справа, запад слева (как rig.right())');
    // сытость еды в руке: яблоко (+4) при 18 — 4 половинки, 2 — лишние; полный — ничего; творчество — ничего
    st.P.food = 18; st.P.inv[0] = { id: 'apple', n: 1 }; st.P.sel = 0; FI.hud(1 / 60);
    ok(st.foodGhost === 4, 'держишь яблоко при 18 — вернёт 4 (2 лишних)', st.foodGhost);
    st.P.food = 20; FI.hud(1 / 60); ok(st.foodGhost === 0, 'сыт — призраков нет');
    st.P.food = 10; st.P.inv[0] = { id: 'stone', n: 1 }; st.P.off = { id: 'meat_cooked', n: 1 }; FI.hud(1 / 60);
    ok(st.foodGhost === 8, 'еда в левой руке (камень в правой) — тоже показывается', st.foodGhost);
    st.P.off = null;
    // без мусора: стоишь с лупой на блоке, всё надето — 60 000 кадров
    st.P.inv[0] = { id: 'pick_stone', n: 1, d: 0 }; st.hit = { x: 5, y: 10, z: 5, v: V.cell(ID.stone), nx: 0, ny: 1, nz: 0 };
    for (let i = 0; i < 300; i++) FI.hud(1 / 60);
    if (global.gc) {
      global.gc(); const h0 = process.memoryUsage().heapUsed;
      for (let i = 0; i < 60000; i++) FI.hud(1 / 60);
      global.gc(); const dh = process.memoryUsage().heapUsed - h0;
      ok(dh < 128 * 1024, 'подсказки на экране — без мусора (60 000 кадров, всё надето)', dh);
    }
    // время кадра: среднее на кадр
    let t0 = process.hrtime.bigint(); for (let i = 0; i < 60000; i++) FI.hud(1 / 60); const per = Number(process.hrtime.bigint() - t0) / 1e6 / 60000;
    console.log(`  подсказки на экране: ${(per * 1000).toFixed(2)} мкс на кадр (ПК, node)`);
    ok(per < .05, 'кадр подсказок ≤ 0,05 мс (ПК)', per);
    // частота кадров не важна: 30 / 60 / 144 — одинаковые строки
    const txt = [];
    for (const fps of [30, 60, 144]) { hud.chips.clear(); for (let i = 0; i < fps; i++) FI.hud(1 / fps); txt.push(JSON.stringify([...hud.chips.entries()].map(([k, c]) => [k, c.t]).sort())); }
    ok(txt[0] === txt[1] && txt[1] === txt[2], 'строки одинаковые при 30 / 60 / 144 кадрах');
  }

  // ═══ 6. Книга рецептов ═══
  sec('книга рецептов: ускоритель V.craft = старый перебор, указатель (как сделать / для чего / где взять), поиск, «Книга мастера»');
  {
    // ускоритель рецептов: на каждом рецепте (обе зеркальные) и 5000 случайных сетках — ответ как у старого перебора
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const names = ['planks_oak', 'planks_birch', 'stick', 'cobble', 'iron_ingot', 'gold_ingot', 'coal', 'glass', 'fiber', 'parchment', 'flint', 'feather', 'diamond', 'compass', 'map_filled', 'sand', 'stone', 'slime_ball', 'log_oak', null, null, null, null];
    let diff = 0, n = 0;
    const same = (a, b) => (!a && !b) || (a && b && a.out === b.out && a.n === b.n && a.recipe === b.recipe);
    for (const r of V.recipes) {
      if (!r.pattern) continue;
      const rh = r.pattern.length, rw = Math.max(...r.pattern.map(q => q.length));
      for (const mir of [false, true]) for (const [w, ox, oy] of [[3, 0, 0], [3, 3 - rw, 3 - rh]]) {
        if (rw > w || rh > w) continue;
        const g = new Array(w * w).fill(null);
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const ch = r.pattern[y][mir ? rw - 1 - x : x] || ' '; if (ch !== ' ') { const k = r.key[ch]; g[(y + oy) * w + x + ox] = k[0] === '#' ? V.TAGS[k.slice(1)][0] : k; } }
        n++; if (!same(V.craft(g, w, w), V.craftLinear(g, w, w))) diff++;
      }
    }
    for (let i = 0; i < 5000; i++) { const w = rnd() < .3 ? 2 : 3, g = []; for (let k = 0; k < w * w; k++) g.push(names[Math.floor(rnd() * names.length)]); n++; if (!same(V.craft(g, w, w), V.craftLinear(g, w, w))) diff++; }
    ok(diff === 0 && n > 5000, 'ускоритель рецептов = старый перебор (все рецепты, зеркально, в углу сетки + 5000 случайных)', { n, diff });
    let t0 = process.hrtime.bigint(); for (let i = 0; i < 20000; i++) V.craft(['planks_oak', 'planks_oak', null, 'planks_oak', 'planks_oak', null, null, null, null], 3, 3); const fast = Number(process.hrtime.bigint() - t0) / 1e6;
    t0 = process.hrtime.bigint(); for (let i = 0; i < 20000; i++) V.craftLinear(['planks_oak', 'planks_oak', null, 'planks_oak', 'planks_oak', null, null, null, null], 3, 3); const slow = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`  V.craft 20 000 раз (доски 2×2 — первые в списке): с ускорителем ${fast.toFixed(1)} мс, перебором ${slow.toFixed(1)} мс`);
    {
      // модпак: +1000 рецептов (формы 1…3 × 1…3) — сетка, которая ни к чему не подходит (её проверяет каждое движение в сетке верстака)
      const base = V.recipes.length, ks = { a: 'cobble', b: 'iron_ingot', c: 'gold_ingot', d: 'coal', e: 'glass', f: 'flint' };
      for (let i = 0; i < 1000; i++) { const rh = 1 + Math.floor(rnd() * 3), rw = 1 + Math.floor(rnd() * 3), p = []; for (let y = 0; y < rh; y++) { let q = ''; for (let x = 0; x < rw; x++) q += 'abcdef'[Math.floor(rnd() * 6)]; p.push(q); } V.addRecipe({ pattern: p, key: ks, out: 'stone', n: 1 }); }
      const none = ['diamond', 'stick', null, 'slime_ball', 'feather', null, null, null, null];
      let d2 = 0; for (let i = 0; i < 3000; i++) { const w = 3, gg = []; for (let k = 0; k < 9; k++) gg.push(rnd() < .5 ? ks['abcdef'[Math.floor(rnd() * 6)]] : null); if (!same(V.craft(gg, w, w), V.craftLinear(gg, w, w))) d2++; }
      ok(d2 === 0, 'модпак +1000 рецептов: ускоритель = перебор (3000 сеток)', d2);
      t0 = process.hrtime.bigint(); for (let i = 0; i < 20000; i++) V.craft(none, 3, 3); const f2 = Number(process.hrtime.bigint() - t0) / 1e6;
      t0 = process.hrtime.bigint(); for (let i = 0; i < 2000; i++) V.craftLinear(none, 3, 3); const s2 = Number(process.hrtime.bigint() - t0) / 1e6 * 10;
      console.log(`  модпак +1000 рецептов, сетка без рецепта, 20 000 раз: с ускорителем ${f2.toFixed(1)} мс, перебором ≈ ${s2.toFixed(0)} мс`);
      ok(f2 * 5 < s2, 'с модпаком ускоритель быстрее перебора хотя бы в 5 раз', { f2, s2 });
      V.recipes.length = base;
    }
    // моды: рецепт добавили — указатель перестроился сам
    const r0 = V.addRecipe({ pattern: ['ff', 'ff'], key: { f: 'flint' }, out: 'gravel', n: 1 });
    ok(V.craft(['flint', 'flint', 'flint', 'flint'], 2, 2)?.out === 'gravel', 'новый рецепт (мод) — виден сразу (указатель перестроился)');
    V.recipes.pop(); ok(!V.craft(['flint', 'flint', 'flint', 'flint'], 2, 2), 'рецепт убрали — пропал'); void r0;
    // указатель книги
    const { st, g } = mkSt(); st.G = V.genInit(1, {});
    const X = KX.attach(st, g), FR = X.feats.find(f => f.id === 'recipes');
    t0 = process.hrtime.bigint(); const IX = FR._index(); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`  указатель рецептов: ${IX.stats.recipes} рецептов, ${IX.stats.items} вещей, ${ms.toFixed(2)} мс`);
    ok(ms < 20, 'указатель строится быстро (< 20 мс в node)', ms);
    const outs = new Set(V.recipes.map(r => r.out));
    ok([...outs].every(o => IX.byOut(o).length > 0), 'каждый рецепт — под своей вещью («как сделать»)');
    ok(IX.byOut('iron_ingot').some(r => r.st === 'furnace' && r.grid[0] === 'ore_iron') && IX.byOut('iron_ingot').some(r => r.grid.includes('iron_block')), 'железный слиток: печь (руда) и из блока');
    ok(IX.byIn('planks_birch').some(r => r.out === 'crafting_table') && IX.byIn('planks_spruce').some(r => r.out === 'stick'), 'группы раскрыты: берёзовые доски — для верстака, еловые — для палок («для чего»)');
    ok(IX.byIn('compass').some(r => r.out === 'atlas') && IX.byIn('compass').some(r => r.out === 'navigator') && IX.byIn('compass').some(r => r.out === 'ore_finder'), 'компас — для атласа, навигатора и рудоискателя');
    const fl = IX.from('flint'), fb = IX.from('fiber'), ir = IX.from('ore_iron'), ft = IX.from('feather'), cl = IX.from('coal');
    ok(fl.some(q => q.kind === 'block' && q.from === 'gravel' && q.p === .1) && fb.some(q => q.from === 'tall_grass'), 'где взять: кремень — гравий 10 %, волокно — трава');
    ok(ir.some(q => q.kind === 'ore' && q.minY === 5 && q.maxY === 64), 'железная руда — на высоте 5…64');
    ok(ft.some(q => q.kind === 'mob' && q.from === 'chicken') && cl.some(q => q.kind === 'block' && q.from === 'ore_coal') && cl.some(q => q.kind === 'smelt'), 'перо — курица; уголь — из руды и из печи');
    ok(!IX.from('bricks').some(q => q.kind === 'world'), 'кирпичи «в мире» не встречаются (только рецепт)');
    // что можно сделать: 4 доски → верстак (на руках), палки…; кирка — только с верстаком
    const hv = IX.have([{ id: 'planks_oak', n: 4 }, { id: 'stick', n: 2 }, { id: 'pick_wood', n: 1 }], id => !!V.item(id)?.tool);
    const can = IX.craftable(hv, {}).map(r => r.out);
    ok(can.includes('crafting_table') && can.includes('stick') && can.includes('pick_wood') && !can.includes('furnace'), 'хватает: верстак, палки, деревянная кирка (на верстаке); печи — нет', can);
    ok(IX.can(IX.byOut('crafting_table')[0], hv) === 1 && IX.can(IX.byOut('stick')[0], hv) === 2, 'сколько раз хватит: верстак ×1, палки ×2');
    ok(!hv.has('pick_wood'), 'инструменты — не ингредиенты');
    // поиск: по-русски, латиницей игры, синонимы, ё = е
    const top = q => IX.search(q)[0];
    ok(top('кирк') && /^pick_/.test(top('кирк')), 'поиск «кирк» → кирки', IX.search('кирк').slice(0, 3));
    ok(IX.search('pick').every(id => /^pick_/.test(id)) && IX.search('pick').length === 5, '«pick» → все 5 кирок');
    ok(top('факел') === 'torch' && top('torch') === 'torch', '«факел» и «torch» → факел');
    ok(IX.search('железн').slice(0, 6).every(id => /iron/.test(id)), '«железн» — железные вещи сначала', IX.search('железн').slice(0, 6));
    ok(IX.search('ёлка ель').length === 0 && IX.search('елов').length >= 3, 'ё = е; все слова запроса должны найтись', IX.search('елов'));
    ok(top('кровать') === 'bed', 'синоним «кровать» → лежанка');
    t0 = process.hrtime.bigint(); for (let i = 0; i < 200; i++) IX.search('жел' + (i % 3 ? 'е' : ''), null); const sMs = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    ok(sMs < 1, 'поиск по ' + IX.items.length + ' вещам — меньше 1 мс', sMs);
    // «Книга мастера»: до неё — книга закрыта; прочитал — открыта навсегда, книга ушла; второй раз — не тратится
    ok(!FR.known(), 'сначала полная книга закрыта');
    ok(KB.xMenu({ X }).some(i => i.id === 'x:recipes' && /🔒/.test(i.text)), 'в меню — «Книга рецептов 🔒»');
    st.P.inv[0] = { id: 'master_book', n: 1 }; st.P.sel = 0;
    ok(X.useItem(st.P.inv[0], V.item('master_book'), 'main', null) && FR.known() && !st.P.inv[0] && st.P.ext.flags.recipes === 1, 'прочитал — открыта, книга ушла, помнит в данных игрока');
    st.P.inv[0] = { id: 'master_book', n: 1 };
    ok(X.useItem(st.P.inv[0], V.item('master_book'), 'main', null) && st.P.inv[0]?.n === 1 && st.toasts.some(t => /уже знаешь/.test(t)), 'второй раз — «уже знаешь», книга не тратится');
    ok(KB.xMenu({ X }).some(i => i.id === 'x:recipes' && !/🔒/.test(i.text)), 'в меню — «Книга рецептов» без замка');
    const { st: st2, g: g2 } = mkSt({ creative: true }); const X2 = KX.attach(st2, g2);
    ok(X2.recipesKnown(), 'в «Творчестве» книга открыта сразу');
    // сохранение: прочитанная книга — в данных игрока
    const P3 = mkPlayer(); P3.ext = E.host.cleanExt(JSON.parse(JSON.stringify(st.P.ext))); const { st: st3, g: g3 } = mkSt({ P: P3 }); const X3 = KX.attach(st3, g3);
    ok(X3.recipesKnown(), 'после загрузки книга по-прежнему открыта');
  }

  // ═══ 7. Лежанка и сон, вёдра, свиток возврата ═══
  sec('лежанка: дом и сон (день/ночь × монстры × сложность × творчество × вместе), погода после сна, вёдра (сохранение воды), свиток');
  {
    // мир: чанки 0…1, пол из камня на y 40, бассейн воды 4×4 (источники) у x 20…23
    const W = new V.World({ seed: 5 });
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const c = new V.Chunk(cx, cz); for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y <= 40; y++) c.ids[(x << 11) | (z << 7) | y] = V.cell(ID.stone); W.add(c); }
    const set = (x, y, z, n, s = 0) => W.set(x, y, z, n ? V.cell(ID[n], s) : 0, { silent: true });
    for (let x = 20; x < 24; x++) for (let z = 4; z < 8; z++) set(x, 40, z, 'water');
    set(5, 41, 5, 'bed');
    const mkWorldSt = o => {
      const { st, g } = mkSt(o); const calls = { tp: [], night: [] };
      Object.assign(st, { W, ox: 0, oz: 0, steps: 6000, ready: true, R: { lighting: { time: 22 } } });
      Object.assign(st.P, { x: 5.5, y: 42, z: 5.5, hp: 9 });
      st.ents = { mobs: [], isNight: () => { const t = st.R.lighting.time; return t < 5.6 || t > 18.8; }, splash(){}, glow(){}, particles(){}, save: () => [] };
      st.meta.day = 4;
      Object.assign(g, { night: () => st.ents.isNight(), hurtAgo: () => 60, unlockNight: () => calls.night.push(1), teleport: (x, y, z) => { calls.tp.push([x, y, z]); Object.assign(st.P, { x, y, z }); }, eye: () => [st.P.x, st.P.y + 1.62, st.P.z], lookDir: () => ({ x: 0, y: -1, z: 0 }), spawnItem(){} });
      const X = st.X = KX.attach(st, g); return { st, g, X, calls, FW: X.feats.find(f => f.id === 'world') };
    };
    const bedHit = { x: 5, y: 41, z: 5, v: V.cell(ID.bed), nx: 0, ny: 1, nz: 0 };
    const steps = (X, n = 90) => { for (let i = 0; i < n; i++) X.update(1 / 60); };
    // день: дом, без сна
    let T = mkWorldSt(); T.st.R.lighting.time = 12;
    ok(T.X.useBlock(bedHit, V.block('bed')) && T.FW.state().home?.y === 42 && !T.FW.state().sleep && T.st.toasts.some(t => /Дом здесь/.test(t)), 'днём лежанка — дом (появишься тут), спать нельзя');
    ok(KB.homeOf(T.st).x === 5.5 && KB.homeOf(T.st).y === 42, 'дом после нокаута — у лежанки (homeOf)');
    // ночь, монстров нет: уснул, через 1,2 с — утро следующего дня, здоровье ≥ 14, «Пережил ночь» (ночь при тебе), события
    T = mkWorldSt(); const ev = []; T.X.H.register({ id: 't', on: { sleep: d => ev.push('sleep' + d), wake: () => ev.push('wake') } });
    T.X.useBlock(bedHit, V.block('bed'));
    ok(T.FW.state().sleep, 'ночью без монстров — уснул');
    steps(T.X, 60); ok(T.st.R.lighting.time === 22, 'первую секунду — темнеет, время не тронуто');
    steps(T.X, 40);
    ok(T.st.R.lighting.time === 5.6 && T.st.meta.day === 5 && T.st.P.hp === 14 && !T.FW.state().sleep, 'утро следующего дня (5,6 ч, день 5), здоровье 9 → 14', { t: T.st.R.lighting.time, d: T.st.meta.day, hp: T.st.P.hp });
    ok(ev.join() === 'sleep5,wake' && T.calls.night.length === 1, 'события sleep / wake и «Пережил ночь» (если ночь началась при тебе)', ev);
    // уснул после полуночи — утро того же дня
    T = mkWorldSt(); T.st.R.lighting.time = 2; T.X.useBlock(bedHit, V.block('bed')); steps(T.X, 100);
    ok(T.st.meta.day === 4 && T.st.R.lighting.time === 5.6, 'после полуночи — утро того же дня');
    // погода после сна — та же функция дня и часа (одинаково у всех, без сети)
    if (window.KubomirWeather?.at) { const a = JSON.stringify(window.KubomirWeather.at(77, 5, 5.6)), b = JSON.stringify(window.KubomirWeather.at(77, 5, 5.6)); ok(a === b, 'погода утром — по дню и часу (KubomirWeather.at), повторяемо'); }
    // монстры: зомби в 7 блоках — нельзя; в 9 — можно; на 5 ниже — можно; «мирно» — можно; творчество — можно; курица рядом — можно
    for (const [mob, dx, dy, diff, creative, can, msg] of [['zombie', 7, 0, 'normal', false, false, 'зомби в 7 блоках — не уснуть'], ['zombie', 9, 0, 'normal', false, true, 'зомби в 9 — можно'], ['zombie', 2, 5, 'normal', false, true, 'зомби на 5 ниже (в пещере) — можно'],
      ['zombie', 2, 0, 'peaceful', false, true, '«Мирно» — монстры не мешают'], ['zombie', 2, 0, 'normal', true, true, '«Творчество» — не мешают'], ['chicken', 1, 0, 'hard', false, true, 'курица рядом — можно'], ['slime', 3, -2, 'hard', false, false, 'слизень рядом — нельзя']]) {
      T = mkWorldSt({ creative, meta: { diff } }); T.st.ents.mobs.push({ type: mob, x: 5.5 + dx, y: 42 + dy, z: 5.5, hp: 10 });
      T.X.useBlock(bedHit, V.block('bed'));
      ok(!!T.FW.state().sleep === can, msg, { toasts: T.st.toasts });
    }
    // сдвинулся — проснулся, ночь не прошла; ударили — проснулся
    T = mkWorldSt(); T.X.useBlock(bedHit, V.block('bed')); steps(T.X, 30); T.st.P.x += 1; steps(T.X, 5);
    ok(!T.FW.state().sleep && T.st.R.lighting.time === 22 && T.st.toasts.some(t => /Встал/.test(t)), 'сдвинулся — встал, ночь не прошла');
    T = mkWorldSt(); T.X.useBlock(bedHit, V.block('bed')); steps(T.X, 30); T.st.P.hp -= 2; steps(T.X, 5);
    ok(!T.FW.state().sleep && T.st.R.lighting.time === 22, 'ударили — разбудили');
    // лежанку сломали — дом пропал (одна подсказка), появишься в начале мира
    T = mkWorldSt(); T.st.R.lighting.time = 12; T.X.useBlock(bedHit, V.block('bed')); set(5, 41, 5, null);
    const h1 = KB.homeOf(T.st);
    ok(h1 === T.st.meta.spawn && !T.FW.state().home && T.st.toasts.some(t => /пропала/.test(t)), 'лежанку сломали — «пропала», дом — начало мира'); set(5, 41, 5, 'bed');
    // над лежанкой камень — нельзя
    set(5, 42, 5, 'stone'); T = mkWorldSt(); T.X.useBlock(bedHit, V.block('bed')); ok(!T.FW.state().home && T.st.toasts.some(t => /2 свободные/.test(t)), 'над лежанкой нет места — нельзя'); set(5, 42, 5, null);
    // вместе: хозяин спит, гостей 2, спит ни одного → 1 из 3 (нужно 2) — ждём; лёг один гость — утро
    T = mkWorldSt(); let gs = 0; T.st.net = { players: () => [{}, {}, {}], sleepers: () => gs };
    T.X.useBlock(bedHit, V.block('bed')); steps(T.X, 120);
    ok(T.FW.state().sleep && T.st.R.lighting.time === 22, 'вместе: спит 1 из 3 — ночь не проходит (нужна половина — 2)');
    gs = 1; T.X.sleepVote(); steps(T.X, 2);
    ok(!T.FW.state().sleep && T.st.R.lighting.time === 5.6, 'лёг гость — 2 из 3: утро');
    // хозяин не спит, а спят 2 гостя из 3 — утро и так
    T = mkWorldSt(); T.st.net = { players: () => [{}, {}, {}], sleepers: () => 2 }; T.X.hud(1.1);
    ok(T.st.R.lighting.time === 5.6, 'хозяин не спит, спят 2 гостя из 3 — ночь прошла');
    // гость: лёг — хозяину «zz», утро от хозяина — проснулся и сказал «встал»
    T = mkWorldSt({ guest: true }); const zz = []; T.st.net = { sleep: on => zz.push(on) };
    T.X.useBlock(bedHit, V.block('bed')); steps(T.X, 120);
    ok(zz.join() === 'true' && T.FW.state().sleep?.wait && T.st.R.lighting.time === 22, 'гость лёг — хозяину «сплю», ждёт других (время не трогает)');
    T.st.R.lighting.time = 5.61; steps(T.X, 2);
    ok(!T.FW.state().sleep && zz.join() === 'true,false', 'у хозяина утро — гость проснулся, «встал» хозяину');
    // вёдра: черпнуть источник, вылить на камень; 300 случайных действий — вода не появляется и не пропадает
    T = mkWorldSt(); Object.assign(T.st.P, { x: 21.5, y: 41, z: 5.5 });
    const water = () => { let n = 0; for (let x = 16; x < 32; x++) for (let z = 0; z < 16; z++) for (let y = 39; y < 46; y++) { const v = W.raw(x, y, z); if (v > 0 && (v & 0xfff) === ID.water && (v >>> 12) === 0) n++; } return n; };
    const buckets = () => T.st.P.inv.reduce((a, s) => a + (s && s.id === 'bucket_water' ? s.n : 0), 0);
    T.st.P.inv[0] = { id: 'bucket', n: 3 }; T.st.P.sel = 0;
    const w0 = water();
    T.st.steps += 60; T.X.useItem(T.st.P.inv[0], V.item('bucket'), 'main', null);
    ok(water() === w0 - 1 && buckets() === 1 && T.st.P.inv[0].n === 2, 'ведро: черпнул источник — воды в мире −1, полное ведро в сумке, пустых 2');
    // вылить: смотрим на камень сбоку бассейна (верх камня — клетка над ним)
    const stoneHit = { x: 18, y: 40, z: 5, v: V.cell(ID.stone), nx: 0, ny: 1, nz: 0 };
    const jw = T.st.P.inv.findIndex(s => s && s.id === 'bucket_water'); T.st.P.sel = jw;
    T.st.steps += 60; T.X.useItem(T.st.P.inv[jw], V.item('bucket_water'), 'main', stoneHit);
    ok((W.raw(18, 41, 18 - 13) & 0xfff) === ID.water && water() === w0 && buckets() === 0, 'вылил на камень — источник над ним, воды столько же, ведро пустое');
    let s2 = 3; const r2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    let bad2 = 0;
    for (let i = 0; i < 300; i++) {
      T.st.steps += 60;
      const full = T.st.P.inv.findIndex(s => s && s.id === 'bucket_water'), empty = T.st.P.inv.findIndex(s => s && s.id === 'bucket');
      if (r2() < .5 && empty >= 0) { T.st.P.sel = empty; Object.assign(T.st.P, { x: 20.5 + Math.floor(r2() * 4), z: 4.5 + Math.floor(r2() * 4), y: 41 }); T.X.useItem(T.st.P.inv[empty], V.item('bucket'), 'main', null); }
      else if (full >= 0) { T.st.P.sel = full; const x = 16 + Math.floor(r2() * 3), z = Math.floor(r2() * 12); T.X.useItem(T.st.P.inv[full], V.item('bucket_water'), 'main', { x, y: 40, z, v: W.raw(x, 40, z), nx: 0, ny: 1, nz: 0 }); }
      if (water() + buckets() !== w0) bad2++;
    }
    ok(bad2 === 0, 'вёдра: 300 случайных «черпнуть / вылить» — воды в мире + полных вёдер всегда столько же', bad2);
    ok(T.st.P.inv.reduce((a, s) => a + (s && /bucket/.test(s.id) ? s.n : 0), 0) === 3, 'вёдер всего — 3 (не размножились и не пропали)');
    // течение не черпается
    set(26, 41, 2, 'water', 3); Object.assign(T.st.P, { x: 26.5, y: 42.5, z: 2.5 }); const je = T.st.P.inv.findIndex(s => s && s.id === 'bucket'); T.st.P.sel = je; T.st.steps += 60;
    const n0 = T.st.P.inv[je].n; T.X.useItem(T.st.P.inv[je], V.item('bucket'), 'main', null);
    ok(T.st.P.inv[je]?.n === n0 && W.raw(26, 41, 2) > 0, 'течение (не источник) ведром не черпается');
    // гость — вёдра пока нет (честно сказано)
    const G = mkWorldSt({ guest: true }); G.st.P.inv[0] = { id: 'bucket', n: 1 }; G.st.steps += 60; G.X.useItem(G.st.P.inv[0], V.item('bucket'), 'main', null);
    ok(G.st.toasts.some(t => /мире друга/.test(t)) && G.st.P.inv[0].id === 'bucket', 'в мире друга ведро: «пока не работает», вещь цела');
    // свиток возврата: после удара — нельзя (не тратится); потом — домой, свиток ушёл; без лежанки — в начало мира
    T = mkWorldSt(); T.st.R.lighting.time = 12; T.X.useBlock(bedHit, V.block('bed')); Object.assign(T.st.P, { x: 100, y: 60, z: 100 });
    T.st.P.inv[0] = { id: 'recall', n: 2 }; T.st.P.sel = 0; T.g.hurtAgo = () => 2;
    T.st.steps += 60; T.X.useItem(T.st.P.inv[0], V.item('recall'), 'main', null);
    ok(T.st.P.inv[0].n === 2 && !T.calls.tp.length, 'свиток: только что ударили — нельзя, не тратится');
    T.g.hurtAgo = () => 30; T.st.steps += 60; T.X.useItem(T.st.P.inv[0], V.item('recall'), 'main', null);
    ok(T.st.P.inv[0].n === 1 && JSON.stringify(T.calls.tp[0]) === '[5.5,42,5.5]', 'свиток: домой к лежанке, один ушёл', T.calls.tp);
    T.X.useItem(T.st.P.inv[0], V.item('recall'), 'main', null);
    ok(T.st.P.inv[0].n === 1, 'держишь ПКМ — второй свиток сразу не тратится (0,45 с)');
    const T2 = mkWorldSt(); T2.st.P.inv[0] = { id: 'recall', n: 1 }; T2.st.steps += 60; T2.X.useItem(T2.st.P.inv[0], V.item('recall'), 'main', null);
    ok(!T2.st.P.inv[0] && JSON.stringify(T2.calls.tp[0]) === JSON.stringify([T2.st.meta.spawn.x, T2.st.meta.spawn.y, T2.st.meta.spawn.z]), 'без лежанки — в начало мира');
    ok(E.sleep.need(1, 'half') === 1 && E.sleep.need(3, 'half') === 2 && E.sleep.need(4, 'all') === 4 && E.sleep.need(8, 'one') === 1, 'правило «сколько спит»: один / половина / все');
  }

  // ═══ 8. Атлас: листы карты, мини-карта (участки), точки, место нокаута, имена ═══
  sec('атлас: лист карты — только новое место, участок карты = перебор столбцов, точки (до 64, имена без мусора), место нокаута');
  {
    const W = new V.World({ seed: 9 });
    const c0 = new V.Chunk(0, 0); W.add(c0);
    // рельеф: столбцы разной высоты, озеро, трава и цветы сверху (насквозь)
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { const h = 50 + ((x * 7 + z * 3) % 9); for (let y = 0; y <= h; y++) c0.ids[(x << 11) | (z << 7) | y] = V.cell(y === h ? ID.grass : ID.stone); if ((x + z) % 5 === 0) c0.ids[(x << 11) | (z << 7) | (h + 1)] = V.cell(ID.tall_grass); }
    for (let x = 10; x < 14; x++) for (let z = 10; z < 14; z++) for (let y = 55; y <= 58; y++) c0.ids[(x << 11) | (z << 7) | y] = V.cell(ID.water);
    c0.maxY = 70;
    const { st, g } = mkSt(); Object.assign(st, { W, ready: true, hudHidden: false, steps: 100 }); st.rig = { yaw: 0 };
    Object.assign(st.P, { x: 3.5, y: 60, z: 3.5 });
    const X = st.X = KX.attach(st, g), FM = X.feats.find(f => f.id === 'map');
    // участок карты: верхний блок — как полный перебор столбца (трава насквозь, вода — синим)
    const out = new Uint32Array(256);
    ok(FM._tiles.rev(0, 0) >= 0 && FM._tiles.rev(5, 5) === -1 && FM._tiles.fill(0, 0, out), 'участок: есть — номер правки, нет — −1; цвета посчитаны');
    let badTop = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      let y = 70, t = 0; for (; y > 0; y--) { t = c0.ids[(x << 11) | (z << 7) | y] & 0xfff; if (t && t !== ID.tall_grass) break; }
      const water = (out[z * 16 + x] >>> 16 & 255) > (out[z * 16 + x] & 255) + 40;
      if ((t === ID.water) !== water) badTop++;
    }
    ok(badTop === 0, 'вода на карте — синяя ровно там, где сверху вода (перебор 256 столбцов)', badTop);
    const g1 = out[3 * 16 + 3], g2 = out[3 * 16 + 4];
    ok((g1 >>> 8 & 255) > (g1 & 255) && g1 !== g2, 'трава — зелёная, рельеф виден (соседние столбцы разной высоты — разный оттенок)', [g1.toString(16), g2.toString(16)]);
    let t0 = process.hrtime.bigint(); for (let i = 0; i < 200; i++) FM._tiles.fill(0, 0, out); const tms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
    console.log(`  участок карты: ${(tms * 1000).toFixed(0)} мкс на участок 16×16 (node)`);
    ok(tms < .5, 'участок карты считается быстро (< 0,5 мс)', tms);
    // листы карты: новое место — да, то же — нет
    st.P.inv[0] = { id: 'map_blank', n: 3 }; st.P.sel = 0;
    X.useItem(st.P.inv[0], V.item('map_blank'), 'main', null);
    ok(st.P.inv[0].n === 2 && st.P.inv.some(s => s && s.id === 'map_filled'), 'лист зарисован: чистых −1, «Лист карты» в сумке');
    X.useItem(st.P.inv[0], V.item('map_blank'), 'main', null);
    ok(st.P.inv[0].n === 2 && st.toasts.some(t => /уже зарисовано/.test(t)), 'то же место второй раз — «отойди дальше», лист не тратится');
    st.P.x += 130; X.useItem(st.P.inv[0], V.item('map_blank'), 'main', null);
    ok(st.P.inv[0].n === 1 && st.P.ext.map.regions.length === 2, 'в 130 блоках — новое место, второй лист', st.P.ext.map.regions);
    st.P.x -= 130;
    // атлас не надет — карты нет, точку не поставить
    ok(!X.on('map') && FM._add() === null && st.toasts.some(t => /надень/.test(t)), 'без атласа точку не поставить (подсказка «надень»)');
    st.P.inv[1] = { id: 'atlas', n: 1 }; st.P.sel = 1; X.useItem(st.P.inv[1], V.item('atlas'), 'main', null);
    ok(X.on('map') && X.on('dir'), 'атлас надет — карта и стороны света');
    // точки: до 64, имена — через cleanName
    for (let i = 0; i < 70; i++) FM._add();
    ok(st.P.ext.map.wp.length === 64 && st.toasts.some(t => /уже 64/.test(t)), 'точек — не больше 64');
    const CN = E.mapkit.cleanName;
    ok(CN('  Моя   шахта  ') === 'Моя шахта' && CN('a'.repeat(40)).length === 24 && CN('зайди на site.ru') === 'зайди на' && CN('звони +7 777 123 45 67') === 'звони' && CN('@hacker база') === 'база', 'имя точки: пробелы, до 24 знаков, без ссылок, телефонов, @ников');
    ok(CN('ху' + 'йня') === '' && CN('s' + 'hit') === '', 'имя точки: мат — пусто (останется старое имя)');
    ok(CN('Тай' + String.fromCharCode(0x202e) + 'ник') === 'Тайник', 'невидимые знаки направления текста — убраны');
    ok(X.markers().length === 64 && X.markers()[0].ic === '📍', 'точки видны на полосе компаса (X.markers)');
    // место нокаута: появилось, ушло, когда подошёл на 3 блока
    X.emit('knockout', 40.2, 61, 40.7, 1);
    ok(st.P.ext.map.death && st.P.ext.map.death.x === 40.2, 'нокаут — место на карте 💀');
    X.update(1.1); ok(st.P.ext.map.death, 'далеко — место держится');
    Object.assign(st.P, { x: 41, z: 41 }); X.update(1.1);
    ok(!st.P.ext.map.death, 'подошёл (меньше 3 блоков) — место убрано');
    // сохранение: точки и листы — в данных игрока (round-trip через cleanExt)
    const P2 = mkPlayer(); P2.ext = E.host.cleanExt(JSON.parse(JSON.stringify(st.P.ext))); const S2 = mkSt({ P: P2 }); const X2 = KX.attach(S2.st, S2.g);
    ok(S2.st.P.ext.map.wp.length === 64 && S2.st.P.ext.map.regions.length === 2, 'после загрузки — 64 точки и 2 места', S2.st.P.ext.map.regions);
    ok(JSON.stringify(S2.st.P.ext).length < 32768, 'данные помощников ≤ 32 КБ (64 точки)', JSON.stringify(S2.st.P.ext).length); void X2;
  }

  // ═══ 9. Дорожная книга ═══
  sec('Дорожная книга: проверка данных (монеты и XP — нельзя, круги), события, «есть в вещах», закрытые и скрытые, награды, глава → ячейка 💍');
  {
    const QE = E.quests;
    // валидатор
    const bad = QE.validate({ chapters: [{ id: 'c', quests: [
      { id: 'a', tasks: [{ t: 'craft', item: 'stick', n: 1 }], rewards: [{ t: 'coins', n: 100 }, { t: 'item', id: 'xp', n: 5 }, { t: 'item', id: 'apple', n: 2 }] },
      { id: 'b', needs: ['c2'], tasks: [{ t: 'craft', n: 1 }] }, { id: 'c2', needs: ['b'], tasks: [{ t: 'craft', n: 1 }] },
      { id: 'd', tasks: [{ t: 'teleport' }] }, { id: 'a', tasks: [{ t: 'check' }] }, { id: 'e', needs: ['nope'], tasks: [{ t: 'check' }] } ] }] });
    const qa = bad.data.chapters[0].quests;
    ok(!bad.ok && qa.find(q => q.id === 'a').rewards.length === 1 && qa.find(q => q.id === 'a').rewards[0].id === 'apple', 'валидатор: монеты и «XP» выкинуты, вещь осталась', bad.errors);
    ok(bad.errors.some(e => /по кругу/.test(e)) && !(qa.find(q => q.id === 'b').needs.length && qa.find(q => q.id === 'c2').needs.length), 'валидатор: зависимость по кругу разорвана');
    ok(!qa.some(q => q.id === 'd') && qa.filter(q => q.id === 'a').length === 1 && qa.find(q => q.id === 'e').needs.length === 0, 'валидатор: неизвестная задача, повтор id, несуществующая зависимость — убраны');
    ok(QE.validate(window.KubomirQuests.DATA).ok, 'задания «Кубомира» — без ошибок', QE.validate(window.KubomirQuests.DATA).errors);
    // движок на потоке событий
    const st0 = {}; let have = 0; const done = [];
    const Q = QE.create({ state: st0, have: () => have, onDone: q => done.push(q.id), data: { chapters: [{ id: 'c', quests: [
      { id: 'one', tasks: [{ t: 'break', block: '#log', n: 3 }] }, { id: 'two', needs: ['one'], tasks: [{ t: 'craft', item: 'stick', n: 8 }, { t: 'have', item: 'stick', n: 4 }], rewards: [{ t: 'item', id: 'apple', n: 2 }] },
      { id: 'secret', hidden: true, needs: ['two'], tasks: [{ t: 'kill', mob: 'zombie', n: 1 }] } ] }] }, match: (k, id) => V.tagHas(k, id) });
    ok(Q.status('one') === 'open' && Q.status('two') === 'locked' && Q.status('secret') === 'hidden', 'сначала: первое открыто, второе закрыто, тайное спрятано');
    Q.event('craft', 'stick', 8); ok(Q.progress('two')[0][0] === 0, 'закрытое задание события не считает');
    Q.event('break', 'log_oak'); Q.event('break', 'stone'); Q.event('break', 'log_birch'); Q.event('break', 'log_spruce');
    ok(Q.status('one') === 'done' && done.join() === 'one' && Q.status('two') === 'open', '3 бревна (любые: группа #log), камень не в счёт — сделано, следующее открылось');
    Q.event('craft', 'stick', 4); Q.event('craft', 'stick', 4); have = 3; Q.refresh();
    ok(Q.status('two') === 'open' && Q.progress('two')[1][0] === 3, 'сделал 8 палок, в вещах 3 из 4 — ещё не готово');
    have = 4; Q.refresh(); ok(Q.status('two') === 'done' && Q.status('secret') === 'open', 'в вещах 4 — готово, тайное открылось');
    have = 0; Q.refresh(); ok(Q.status('two') === 'done', '«есть в вещах» не отнимается, когда потратил');
    ok(JSON.stringify(Q.claim('two')) === '[{"t":"item","id":"apple","n":2}]' && Q.status('two') === 'claimed' && Q.claim('two') === null, 'награда — один раз');
    // сохранение: тот же state — тот же прогресс
    const Q2 = QE.create({ state: JSON.parse(JSON.stringify(st0)), data: Q.data });
    ok(Q2.status('one') === 'done' && Q2.status('two') === 'claimed' && Q2.status('secret') === 'open', 'загрузка: всё как было');
    // 1000 событий — быстро
    let t0 = process.hrtime.bigint(); for (let i = 0; i < 1000; i++) Q.event('break', 'stone'); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    ok(ms < 2, '1000 событий — меньше 2 мс', ms);
    // «Кубомир»: глава «Достижения» = те же id, события из игры, награды вещами, глава «Помощники» → 7-я ячейка
    const { st, g } = mkSt({ g: { ach: () => KB.ACH } }); Object.assign(st, { ready: true, steps: 100 }); st.meta.spawn = { x: 0, y: 60, z: 0 };
    const X = st.X = KX.attach(st, g), FQ = X.feats.find(f => f.id === 'quests'), QK = X.quests;
    const achCh = QK.data.chapters.find(c => c.id === 'ach');
    ok(achCh && achCh.quests.length === KB.ACH.length && achCh.quests.every((q, i) => q.id === 'ach:' + KB.ACH[i][0]), 'глава «Достижения» — все ' + KB.ACH.length + ' достижений (те же id)');
    ok(KB.xMenu({ X }).some(i => i.id === 'x:quests'), 'в меню ☰ — «Дорожная книга»');
    st.P.inv[0] = { id: 'log_oak', n: 1 }; X.emit('pickup', 'log_oak', 1); X.update(.6);
    ok(QK.status('log') === 'done', 'бревно в вещах — «Первое бревно» выполнено');
    X.emit('craft', 'planks_birch', 4); ok(QK.status('planks') === 'done', 'сделал берёзовые доски — «Доски» (группа #planks)');
    X.emit('ach', 'night'); ok(QK.status('ach:night') === 'done', 'достижение «ночь» — и задание главы «Достижения»');
    // награда вещами: в сумку
    const before = st.P.inv.filter(Boolean).length;
    ok(FQ._claim('log') && st.P.inv.some(s => s && s.id === 'apple' && s.n === 2) && st.P.inv.filter(Boolean).length === before + 1, '«Забрать» — 2 яблока в сумку');
    // глава «Помощники» целиком → 7-я ячейка аксессуаров (правило quest:chapter:helpers)
    X.emit('ach', 'iron'); X.emit('ach', 'deep'); X.emit('ach', 'diamond');
    ok(X.acc.open === 6, 'достижения — 6 ячеек', X.acc.open);
    for (const q of QK.data.chapters.find(c => c.id === 'helpers').quests) { st.P.ext.quests.s[q.id] = { p: q.tasks.map(t => t.n), d: 1 }; for (const n of q.needs) st.P.ext.quests.s[n] = st.P.ext.quests.s[n] || { p: [], d: 1 }; }
    X.refreshSlots();
    ok(QK.chapterDone('helpers') && X.acc.open === 7 && X.acc.why(7).includes('босса'), 'глава «Помощники» пройдена — 7-я ячейка; 8-я — за босса', X.acc.open);
    // закреплённое — строка на экране
    const chips = []; X.hudChip = (id, ic, t) => chips.push([id, ic, t]); X.hudHide = id => chips.push([id, 'hide']);
    QK.pin('table'); X.update(.6);
    ok(chips.some(c => c[0] === 'quest' && /Верстак · 0\/1/.test(c[2])), '📌 следить — «📜 Верстак · 0/1» на экране', chips.slice(-2));
    ok(JSON.stringify(st.P.ext.quests).length < 16384, 'данные заданий в сохранении — небольшие', JSON.stringify(st.P.ext.quests).length);
    // далеко от начала мира / глубоко — по значению
    Object.assign(st.P, { x: 520, z: 0, y: 25 }); st.P.ext.quests.s.log = { p: [1], d: 1, c: 1 }; st.P.ext.quests.s.stone_pick = { p: [1], d: 1 }; X.update(1.1); X.update(1.1);
    ok(QK.status('far500') === 'done' && QK.status('caves') === 'done', 'ушёл на 520 блоков и ниже Y 30 — «Далеко от дома» и «В пещеры»');
  }

  console.log(`\nkubomir-qol-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

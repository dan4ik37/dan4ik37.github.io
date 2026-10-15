// Моды «Кубомира» без браузера — часть node scripts/voxel-test.cjs (зовётся оттуда, отдельно не запускается).
// Общий формат модов сайта (docs/MODS.md): mod.json проходит / ошибки — как у «Подземья», мод «both» из mods/podzem работает и
// здесь, перевод общих единиц (прочность, свет, глубина, урон) в кубический мир; zip (.d37mod) туда-обратно и с deflate,
// «бомбы» и пути «..»; реестр (ваниль возвращается, рецепты и печь, «только на верстаке»); генерация (руды по глубине, россыпь в
// пещерах, ваниль без мода не меняется); песочница скриптов (API 1 как у «Подземья»: события, fx, commands, npc, player, game;
// JS и Lua; лимиты действий, world.set рядом и не по станкам, give — только своё и простое, ошибки и зависания выключают
// мод, подделанные сообщения режутся); «пинг» с номером в рамке.
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

module.exports = async function ({ ok, sec, load, SITE, CORE }){
  const ctx = load([...CORE, 'js/engine/voxel-mods.js']);
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-lua.js'), 'utf8'), ctx, { filename: 'lang-lua.js' });
  // Java (язык сайта js/engine/lang-java.js; крючок «Кубомира» — LANGS в voxel-mods.js): если файл есть — проверим и его
  const JAVA = fs.existsSync(path.join(SITE, 'js/engine/lang-java.js'));
  if (JAVA) vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-java.js'), 'utf8'), ctx, { filename: 'lang-java.js' });
  const V = ctx.D37E.vox, M = V.mods;
  const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
  const files = x => Object.assign({}, x.files);
  const EX = Object.fromEntries(M.EXAMPLES.map(x => [x.manifest.id, x]));
  const readMod = dir => { const d = path.join(SITE, dir), out = {}; for (const f of fs.readdirSync(d)) out[f] = fs.readFileSync(path.join(d, f), 'utf8'); return { manifest: JSON.parse(out['mod.json']), files: out }; };

  // ═══ 1. Проверка mod.json (общий формат) ═══
  sec('моды: проверка mod.json (общий формат с «Подземьем»)');
  for (const x of M.EXAMPLES) { const r = M.validate(x.manifest, files(x)); ok(r.ok && r.m.id === x.manifest.id, `пример «${x.manifest.name}» проходит проверку`, r.errors); }
  const rr = M.validate(EX.rubies.manifest, files(EX.rubies)).m;
  const ore = rr.blocks.find(b => b.name === 'rubies:ruby_ore');
  ok(ore && ore.hard === 3 && ore.tier === 3 && ore.drop === 'rubies:ruby' && ore.tool === 'pick', 'прочность 200 → 3 с рукой, tier 3, drop — свой рубин, кирка по умолчанию', ore);
  ok(rr.blocks[1].emit === 4, 'свет «#401020» → яркость 4', rr.blocks[1].emit);
  const pick = rr.items.find(i => i.name === 'rubies:ruby_pick'), sword = rr.items.find(i => i.name === 'rubies:ruby_sword');
  ok(pick.tool.kind === 'pick' && pick.tool.tier === 4 && pick.tool.speed === 10 && pick.tool.dur === 900 && pick.stack === 1, 'pickaxe power 100 → кирка скорость 10, прочность 900', pick.tool);
  ok(sword.tool.kind === 'sword' && sword.tool.dmg === 8, 'weapon damage 18 («Подземье», зомби 45) → урон 8 (зомби 20)', sword.tool);
  ok(rr.recipes.some(r => r.pattern && r.out === 'rubies:ruby_pick' && r.key['|'] === 'stick' && r.key.R === 'rubies:ruby' && r.table), 'рецепт с pattern — по форме, на верстаке');
  ok(rr.recipes.some(r => r.list && r.list.length === 9 && r.out === 'rubies:ruby_block' && r.table), 'ingredients [["ruby", 9]] + workbench → 9 рубинов на верстаке');
  ok(rr.recipes.some(r => r.list && r.list.length === 1 && r.n === 9 && !r.table), 'блок → 9 рубинов (руками, 2×2)');
  ok(rr.recipes.some(r => r.smelt && r.input === 'rubies:ruby_ore' && r.out === 'rubies:ruby'), 'station furnace → печь');
  const f0 = rr.features[0];
  ok(f0.type === 'ore' && f0.minY === 6 && f0.maxY === 30 && Math.abs(f0.perChunk - 1.6) < 1e-9 && f0.replace.join() === 'stone', 'worldgen: глубина 22…60 м → y 6…30, rarity .2 → 1,6 жилы на чанк', f0);
  ok(M.yOfDepth(0) === 52 && M.yOfDepth(40) === 12 && M.yOfDepth(44) === 8 && M.yOfDepth(75) === 6 && M.yOfDepth(1e6) === 2 && M.yOfDepth(-20) === 72, 'глубина → y: море 52, до 44 м — метр в метр, глубже — сжато ко дну (8 → 2)');
  const tr = M.validate(EX.trampoline.manifest, files(EX.trampoline)).m;
  ok(tr.blocks[0].tex.top === 'trampoline:spring' && tr.blocks[0].tex.side === 'planks_oak' && tr.blocks[0].hard === .6 && tr.blocks[0].tool === 'axe', 'faces — грани блока (кубический мир), текстура игры planks_oak', tr.blocks[0]);
  const cr = M.validate(EX.crystals.manifest, files(EX.crystals)).m;
  ok(cr.blocks[1].shape === V.SHAPE.cross && !cr.blocks[1].solid && cr.blocks[1].tool === '' && cr.blocks[1].emit === 11, 'кристалл: крестом, проходимый, tool any, свет 11', cr.blocks[1]);
  ok(cr.features.some(f => f.type === 'scatter' && f.under && f.minY === 8 && f.maxY === 42), 'worldgen scatter глубже поверхности → россыпь в пещерах (y 8…42)', cr.features[0]);
  const bad = (j, f, re, msg) => { const r = M.validate(j, f || {}); ok(!r.ok && r.errors.some(e => re.test(e)), msg, r.errors); };
  const base = o => Object.assign({ id: 'mm', name: 'Мод', version: '1.0.0', game: 'voxel' }, o);
  bad('{ не json', null, /не JSON/, 'не JSON — понятная ошибка');
  bad(base({ id: 'Abc' }), null, /^id:/, 'id с большой буквы — ошибка (как у «Подземья»)');
  bad(base({ name: '' }), null, /^name:/, 'без name — ошибка');
  bad(base({ version: 'один' }), null, /^version:/, 'неверная version');
  bad(base({ game: 'tiles' }), null, /для другой игры/, 'мод «tiles» — не для кубического мира');
  bad(base({ game: undefined }), null, /^game:/, 'без game — ошибка');
  bad(base({ api: 2 }), null, /api: 2/, 'api новее игры — ошибка');
  bad(JSON.parse('{"id":"mm","name":"М","version":"1","game":"voxel","__proto__":{"x":1}}'), null, /запрещённое поле __proto__/, '__proto__ в mod.json — ошибка');
  bad(base({ blocks: [{ id: 'Плохой' }] }), null, /blocks\[0\]: нужен id/, 'неверный id блока');
  bad(base({ blocks: [{ id: 'a' }, { id: 'a' }] }), null, /дважды/, 'id блока дважды');
  bad(base({ worldgen: [{ type: 'ore', block: 'stone' }] }), null, /блок этого мода/, 'worldgen — только свои блоки');
  bad(base({ blocks: [{ id: 'b' }], worldgen: [{ type: 'cave', block: 'b' }] }), null, /type — "ore" или "scatter"/, 'worldgen: неизвестный тип');
  bad(base({ recipes: [{ result: 'stick', ingredients: [['dirt', 1]], station: 'altar' }] }), null, /station/, 'неизвестная станция');
  bad(base({ recipes: [{ result: 'stick' }] }), null, /ingredients/, 'рецепт без ингредиентов');
  bad(base({ scripts: [{ file: 'main.js' }] }), {}, /нет файла main\.js/, 'скрипта нет в моде');
  bad(base({ scripts: [1, 2, 3, 4, 5].map(i => ({ code: 'x' })) }), null, /скриптов больше 4/, 'скриптов больше 4');
  bad(base({ scripts: [{ code: 'x'.repeat(200001) }] }), null, /больше 200 КБ/, 'скрипт больше 200 КБ');
  bad(base({ textures: { t: 'big.png' } }), {}, /нет файла big\.png/, 'PNG-файла нет в моде');
  bad(base({ textures: { t: 'x.png' } }), { 'x.png': new Uint8Array(2.6e6) }, /картинки больше 2\.5 МБ/, 'картинки больше 2,5 МБ');
  bad(base({ items: [{ id: 'x', places: 'stone' }] }), null, /places — блок этого мода/, 'places — только свой блок');
  { const r = M.validate(base({ blocks: [{ id: 'g' }] })); ok(r.ok && r.warnings.some(w => /будет серым/.test(w)) && r.m.blocks[0].tex === 'mm:__gray' && !!r.m.textures.__gray, 'нет текстуры — предупреждение и серый блок (как у «Подземья»)'); }
  { const r = M.validate(base({ blocks: [{ id: 'g', light: [255, 0, 0] }, { id: 'h', light: 7 }, { id: 'k', solid: false }] })); ok(r.m.blocks[0].emit === 15 && r.m.blocks[1].emit === 7 && r.m.blocks[2].tool === '', 'свет [r,g,b] / число; несплошной блок — рукой', r.m.blocks.map(b => [b.emit, b.tool])); }
  { const r = M.validate(base({ recipes: [{ result: 'stick', ingredients: [['bar_silver', 4]] }] })); ok(r.ok && !r.m.recipes.length && r.warnings.some(w => /bar_silver/.test(w)), 'предмет «Подземья», которого тут нет, — рецепт пропущен с предупреждением'); }
  { const r = M.validate(base({ recipes: [{ result: 'torch', count: 4, ingredients: [['wood', 1], ['gel', 1]] }] })); ok(r.ok && r.m.recipes[0].list.join() === '#planks,slime_ball', 'ключи «Подземья» → похожее: wood → #planks, gel → slime_ball', r.m.recipes[0]); }
  { const r = M.validate(base({ strange: 1, homepage: 'x' })); ok(r.ok && r.warnings.some(w => /пустой/.test(w)), 'лишние поля пропускаются, пустой мод — предупреждение'); }
  // мод «both» из «Подземья» работает и в кубическом мире
  const rg = readMod('mods/podzem/ruby-glow');
  { const r = M.validate(rg.manifest, rg.files);
    ok(r.ok, 'мод «both» из mods/podzem (Светящиеся рубины) проходит проверку кубического мира', r.errors);
    const m = r.m || { blocks: [], items: [], recipes: [], features: [] };
    ok(m.blocks.find(b => b.name === 'ruby-glow:ruby_ore')?.emit === 8 && m.blocks.find(b => b.name === 'ruby-glow:ruby_ore')?.hard === 2.7, 'его руда: свет #901028 → 8, прочность 180 → 2,7 с', m.blocks[0]);
    ok(m.features[0]?.minY === 2 && m.features[0]?.maxY === 6 && m.features[0]?.replace.join() === 'stone', 'руда «глубже 75 м» → на самом дне (y 2…6), deepstone → stone', m.features[0]);
    ok(m.recipes.some(x => x.out === 'ruby-glow:ruby_lamp' && x.n === 2 && x.table) && !m.recipes.some(x => x.out === 'ruby-glow:ruby_sword') && r.warnings.some(w => /bar_silver/.test(w)), 'лампа — на верстаке; меч из серебра «Подземья» — пропущен', m.recipes); }
  { const sf = readMod('mods/podzem/starfall'), r = M.validate(sf.manifest, sf.files); ok(!r.ok && r.errors.some(e => /другой игры/.test(e)), 'мод «tiles» (Звездопад) — сюда не ставится'); }

  // ═══ 2. Zip (.d37mod) ═══
  sec('моды: zip (.d37mod)');
  const pack = Object.assign({ 'mod.json': JSON.stringify(EX.rubies.manifest) }, EX.rubies.files, { 'tex/пусто.png': new Uint8Array([1, 2, 3]) });
  const z = M.zip(pack);
  ok(z[0] === 0x50 && z[1] === 0x4b, 'zip начинается с «PK»');
  const un = await M.unzip(z);
  ok(Object.keys(un).length === 3 && new TextDecoder().decode(un['rubies.js']) === EX.rubies.files['rubies.js'] && un['tex/пусто.png'].join() === '1,2,3', 'zip → файлы обратно (и русские имена)');
  ok(M.validate(new TextDecoder().decode(un['mod.json']), un).ok, 'мод из zip проходит проверку');
  const mkZip = (entries, o = {}) => {
    const parts = [], cen = []; let off = 0;
    for (const [name, data, meth] of entries) {
      const nm = Buffer.from(name), body = meth === 8 ? zlib.deflateRawSync(data) : Buffer.from(data), crc = M.crc32(new Uint8Array(data));
      const usz = o.lie ? 10 : data.length;
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(meth, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(usz, 22); h.writeUInt16LE(nm.length, 26);
      parts.push(h, nm, body);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(meth, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(usz, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      cen.push(c, nm); off += 30 + nm.length + body.length;
    }
    const cs = cen.reduce((a, b) => a + b.length, 0), e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cs, 12); e.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...parts, ...cen, e]));
  };
  const big = Buffer.from(EX.rubies.files['rubies.js'].repeat(20));
  const dz = await M.unzip(mkZip([['мод/mod.json', Buffer.from(JSON.stringify(EX.rubies.manifest)), 8], ['мод/rubies.js', big, 8], ['__MACOSX/мод/._mod.json', Buffer.from('x'), 0]]));
  ok(Object.keys(dz).sort().join() === 'mod.json,rubies.js' && dz['rubies.js'].length === big.length, 'deflate распакован, общая папка убрана, __MACOSX пропущен', Object.keys(dz));
  let threw = '';
  try { await M.unzip(mkZip([['мод/mod.json', Buffer.from('{}'), 0], ['мод/../../evil.js', Buffer.from('x'), 0]])); } catch (e) { threw = e.message; }
  ok(/странный путь/.test(threw), 'путь «..» в архиве — отказ (как у «Подземья»)', threw);
  threw = ''; try { await M.unzip(mkZip([['a.txt', Buffer.alloc(200000, 65), 8]], { lie: true })); } catch (e) { threw = e.message; }
  ok(/больше, чем заявлено|битый/.test(threw), '«бомба» (размер больше заявленного) — отказ', threw);
  threw = ''; try { await M.unzip(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = e.message; }
  ok(/не zip/.test(threw), 'не zip — понятная ошибка');

  // ═══ 3. Реестр ═══
  sec('моды: реестр (включить и вернуть ваниль)');
  const van = { b: V.blocks.length, i: V.items.length, r: V.recipes.length, t: V.tex.length, s: V.smelting.size, sand: V.smelting.get('sand').out };
  const all = [...M.EXAMPLES, rg].map(x => M.validate(x.manifest, files(x)).m);
  for (const m of all) M.register(m, {}, { recipes: false });
  const skipped = all.flatMap(m => M.recipes(m));
  ok(skipped.length === 0, 'все рецепты подключились', skipped);
  ok(!!V.block('rubies:ruby_ore') && !!V.block('crystals:crystal') && !!V.block('trampoline:spring') && !!V.block('ruby-glow:ruby_lamp'), 'блоки модов в реестре');
  ok(V.item('rubies:ruby_ore')?.place === 'rubies:ruby_ore' && V.item('ruby-glow:ruby_lamp')?.place === 'ruby-glow:ruby_lamp', 'у блоков модов есть предметы (ставятся)');
  const g3 = (rows, w) => { const out = []; for (const r of rows) for (let k = 0; k < w; k++) out.push(r[k] || null); return out; };
  ok(V.craft(g3([['rubies:ruby', 'rubies:ruby', 'rubies:ruby'], [null, 'stick', null], [null, 'stick', null]], 3), 3, 3)?.out === 'rubies:ruby_pick', 'верстак: 3 рубина + 2 палки = рубиновая кирка');
  ok(V.craft(['rubies:ruby_block', null, null, null], 2, 2)?.n === 9, 'блок рубина → 9 рубинов (руками)');
  ok(!V.craft(['ruby-glow:ruby', 'torch', 'torch', null], 2, 2) && V.craft(g3([['ruby-glow:ruby', 'torch', 'torch']], 3), 3, 1)?.n === 2, 'station workbench — только на верстаке (руками нельзя)');
  ok(V.craft(g3([['slime_ball', 'slime_ball', 'slime_ball'], ['planks_birch', 'planks_oak', 'planks_spruce']], 3), 3, 2)?.out === 'trampoline:spring', 'группа #planks в рецепте мода');
  ok(V.smelting.get('rubies:ruby_ore')?.out === 'rubies:ruby' && V.smelting.get('rubies:ruby_ore')?.n === 1, 'печь: рубиновая руда → рубин');
  ok(V.texIdx.has('rubies:ruby_ore') && V.paint('rubies:ruby_ore', V.tex[V.texIdx.get('rubies:ruby_ore')].spec).some((v, i) => i % 4 === 0 && v > 200), 'рисунок общего формата (ore: base + color2) рисуется', V.tex[V.texIdx.get('rubies:ruby_ore')].spec);
  V.addSmelt('sand', 'rubies:ruby');   // мод перебил ваниль в печи — после сброса ваниль на месте
  M.reset();
  ok(V.blocks.length === van.b && V.items.length === van.i && V.recipes.length === van.r && V.tex.length === van.t && V.smelting.size === van.s && V.smelting.get('sand').out === van.sand, 'сброс: ваниль как была (блоки, предметы, рецепты, текстуры, печь)');
  ok(!V.block('rubies:ruby_ore') && !V.item('rubies:ruby') && V.ID.missing > 0, 'после сброса блоков мода нет');
  { const m = M.validate({ id: 'pngmod', name: 'P', version: '1', game: 'voxel', textures: { p: 'p.png' }, blocks: [{ id: 'pb', texture: 'p' }] }, { 'p.png': new Uint8Array(100) }).m;
    const px = new Uint8Array(1024).fill(200); M.register(m, { p: px });
    const d = V.paint('pngmod:p', V.tex[V.texIdx.get('pngmod:p')].spec); ok(d[0] === 200 && d[1023] === 200, 'PNG мода: пиксели как в картинке');
    M.reset(); }

  // ═══ 4. Генерация ═══
  sec('моды: генерация мира');
  const regAll = list => { M.reset(); const ms = list.map(x => M.validate(x.manifest, files(x)).m); for (const m of ms) M.register(m, {}, { recipes: false }); for (const m of ms) M.recipes(m); return M.features(ms.flatMap(m => m.features)); };
  const feats = regAll(M.EXAMPLES);
  ok(feats.length === 5 && feats.every(f => f.block > 0), 'генерация примеров: руда, россыпь в пещерах, столбы, россыпь, валуны — номерами блоков', feats.map(f => f.type));
  const Gm = V.genInit(1234, { features: feats }), G0 = V.genInit(1234, {});
  const oreId = V.block('rubies:ruby_ore').id, cb = V.block('crystals:crystal_block').id, crId = V.block('crystals:crystal').id, modIds = new Set([oreId, cb, crId]);
  let nOre = 0, nCr = 0, nCave = 0, other = 0, oreY = [99, 0], same = true;
  for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) {
    const a = V.genChunk(Gm, cx, cz), b = V.genChunk(G0, cx, cz), a2 = V.genChunk(Gm, cx, cz);
    for (let i = 0; i < a.ids.length; i++) {
      if (a.ids[i] !== a2.ids[i]) same = false;
      const t = a.ids[i], y = i & 127;
      if (t === oreId) { nOre++; oreY[0] = Math.min(oreY[0], y); oreY[1] = Math.max(oreY[1], y); }
      else if (t === crId) { nCr++; if (y < 43 && a.ids[i - 1] === V.ID.stone) nCave++; }
      if (t !== b.ids[i] && !modIds.has(t)) other++;
    }
  }
  ok(same, 'с модами: одно зерно — один и тот же мир');
  ok(nOre > 10 && oreY[0] >= 6 && oreY[1] <= 30, 'рубиновая руда есть и только на глубине 22…60 м (y 6…30)', { nOre, oreY });
  ok(nCave > 0, 'кристаллы в пещерах (worldgen scatter глубже поверхности)', { nCr, nCave });
  ok(other === 0, 'без мода мир тот же: отличаются только клетки с блоками мода', other);
  M.reset();

  // ═══ 5. Песочница скриптов (поток — контекст vm, как Worker) ═══
  sec('моды: песочница скриптов (API 1)');
  const boxes = [];
  const vmBox = onMsg => {
    const timers = new Set();
    const wctx = vm.createContext({ console });   // свои встроенные объекты контекста, снаружи — только таймеры и postMessage
    vm.runInContext('self = globalThis; onmessage = null;', wctx);
    wctx.setTimeout = (f, ms) => { const h = setTimeout(() => { timers.delete(h); if (!B.dead) f(); }, ms); timers.add(h); return h; };
    wctx.clearTimeout = h => { clearTimeout(h); timers.delete(h); };
    wctx.setInterval = (f, ms) => { const h = setInterval(() => { if (!B.dead) f(); }, ms); timers.add(h); return h; };
    wctx.clearInterval = h => { clearInterval(h); timers.delete(h); };
    wctx.postMessage = m => { const c = structuredClone(m); setImmediate(() => { if (!B.dead) onMsg(c); }); };
    const B = {
      dead: false,
      post(m){
        if (B.dead) return;
        const c = structuredClone(m);
        setImmediate(() => {
          if (B.dead) return;
          try {
            if (c.t === 'boot') { vm.runInContext('(' + c.code + ')()', wctx, { timeout: 2000, filename: 'blob:null/mod-runtime' }); return; }
            wctx.__m = { data: c };
            // запуск мода с языком (Java — ~0,5 МБ переводчика) под нагрузкой бывает дольше 0,4 с — запуску даём 3 с
            vm.runInContext('onmessage(__m)', wctx, { timeout: c.t === 'init' && c.langs && Object.keys(c.langs).length ? 3000 : 400, filename: 'blob:null/frame' });
          } catch (e) { if (/timed out/i.test(e.message)) { B.dead = true; onMsg({ t: 'hang' }); } else onMsg({ t: 'error', where: '', line: 0, msg: e.message }); }
        });
      },
      close(){ B.dead = true; for (const h of timers) { clearTimeout(h); clearInterval(h); } timers.clear(); },
    };
    boxes.push(B);
    setImmediate(() => onMsg({ t: 'frame' }));
    return B;
  };
  const mkWorld = () => {
    const W = new V.World({ seed: 7 }), G = V.genInit(7, {});
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const g = V.genChunk(G, cx, cz); W.add(new V.Chunk(cx, cz, g.ids)); }
    return W;
  };
  const mkGame = (mods, o = {}) => {
    M.reset();
    const ms = mods.map(x => { const r = M.validate(x.manifest, x.files || {}); if (!r.ok) throw new Error(r.errors.join('; ')); return r.m; });
    for (const m of ms) M.register(m, {}, { recipes: false }); for (const m of ms) M.recipes(m);
    const W = mkWorld(), P = { x: 8.5, y: 100, z: 8.5, hp: 20, food: 20, sel: 0, inv: [{ id: 'stick', n: 1 }], sneak: false };
    const log = { toast: [], log: [], give: [], launch: [], fx: [], snd: [], heal: [], hurt: [], tp: [], spawn: [], text: [], shake: [] };
    const st = { W, meta: { modData: o.modData || {}, day: 3 }, creative: false, R: { lighting: { time: o.time ?? 13 } } };
    let now = 0;
    const hooks = {
      player: () => P, toast: t => log.toast.push(t), log: t => log.log.push(t), give: s => log.give.push(s), heal: n => log.heal.push(n), hurt: n => log.hurt.push(n),
      launch: (a, b, c) => log.launch.push([a, b, c]), teleport: (x, y, z) => log.tp.push([x, y, z]), particles: (k, x, y, z, n, c) => log.fx.push([k, x, y, z, n, c]), sound: n => log.snd.push(n),
      spawn: k => log.spawn.push(k), text: (x, y, z, t) => log.text.push(t), shake: p => log.shake.push(p),
    };
    const R = M.runner(st, ms.map(m => ({ m })), hooks, { box: vmBox, now: () => now });
    return { R, W, P, log, st, ms, adv: ms2 => { now += ms2; } };
  };
  const waitReady = async R => { for (let i = 0; i < 100 && R.mods.some(Mx => Mx.m.scripts.length && !Mx.ready && !Mx.off); i++) await tick(10); await tick(15); };
  const mk = (id, code, extra = {}) => ({ manifest: Object.assign({ id, name: id, version: '1.0', game: 'voxel', textures: { t: { draw: { pattern: 'stone', base: '#888888' } } }, blocks: [{ id: 'b', texture: 't' }], scripts: [{ file: 'main.js' }] }, extra), files: { 'main.js': code } });

  // рубины (JS): tileBreak, fx, mod.storage, commands
  { const g = mkGame([EX.rubies]); await waitReady(g.R);
    ok(g.R.mods[0].ready && !g.R.mods[0].off, 'JS-мод запустился');
    g.R.event('blockBreak', { x: 8, y: 20, z: 8, block: 'stone' }); await tick();
    ok(g.log.fx.length === 0, 'событие не про его блок — обработчик молчит');
    g.R.event('blockBreak', { x: 8, y: 20, z: 8, block: 'rubies:ruby_ore' }); await tick(40);
    ok(g.log.fx.length === 1 && g.log.fx[0][0] === 'magic' && g.log.fx[0][5] === '#ff4080' && g.log.snd[0] === 'coin', 'tileBreak (из blockBreak игры): частицы с цветом, звук', g.log);
    ok(g.log.log.some(t => /Первый рубин/.test(t)), 'player.message — в чат игры');
    ok(JSON.parse(g.R.data().rubies).found === 1, 'mod.storage сохраняется в мире (modData)');
    ok(g.R.commandInfo().some(c => c.name === 'rubies' && /сколько/.test(c.desc)) && g.R.command('rubies', []), 'commands.add — команда с описанием для /help');
    await tick(40);
    ok(g.log.log.some(t => /Найдено рубинов: 1/.test(t)), 'команда ответила');
    g.R.stop(); }
  { const g = mkGame([EX.rubies], { modData: { rubies: JSON.stringify({ found: 41 }) } }); await waitReady(g.R);
    g.R.command('RUBIES', []); await tick(40);
    ok(g.log.log.some(t => /Найдено рубинов: 41/.test(t)), 'mod.storage — из сохранения мира; команда без учёта регистра');
    g.R.stop(); }
  // батут (Lua, вызовы через точку как у «Подземья»)
  { const g = mkGame([EX.trampoline]); await waitReady(g.R);
    ok(g.R.mods[0].ready && !g.R.mods[0].off, 'Lua-мод запустился', g.R.logs);
    const spring = V.block('trampoline:spring').id;
    g.R.stepOn([spring], g.P); await tick(40);
    ok(g.log.launch.length === 1 && g.log.launch[0][1] === 17 && g.log.fx[0]?.[0] === 'spark' && g.log.snd[0] === 'jump', 'Lua: stepOn → подброс, искры, звук', g.log);
    g.R.stepOn([spring], g.P); await tick(20);
    ok(g.log.launch.length === 1, 'stepOn не чаще раза в 0,3 с');
    g.adv(400); g.P.sneak = true; g.R.stepOn([spring], g.P); await tick(40);
    ok(g.log.launch.length === 1, 'Lua: присел — не подбрасывает (player.sneaking)');
    g.R.stop(); }
  // мод «both» из «Подземья»: вызовы в стиле 2D (без z), npc, commands по-русски
  { const g = mkGame([rg], { time: 22 }); await waitReady(g.R);
    ok(g.R.mods[0].ready && !g.R.mods[0].off, 'мод из mods/podzem (JS) запустился здесь', g.R.logs);
    g.R.event('tileBreak', { x: 4, y: 5, z: 6, tile: 'ruby-glow:ruby_ore' }); await tick(40);
    ok(g.log.fx[0]?.[0] === 'spark' && g.log.fx[0]?.[3] === g.P.z && g.log.fx[0]?.[5] === '#ff4060', 'fx.particles(x, y, вид, …) как в 2D — на глубине игрока', g.log.fx[0]);
    ok(g.R.lines.length === 1 && /рубины/.test(g.R.lines[0]), 'npc.addLine — принят (Проводника здесь нет)');
    ok(g.R.commands().includes('рубины') && g.R.command('рубины', []), 'команда по-русски: /рубины');
    await tick(40);
    ok(g.log.log.some(t => /Добыто рубинов: 1/.test(t)), 'команда ответила', g.log.log);
    g.R.tick(.5); await tick(40);
    ok(!g.R.mods[0].off && g.R.mods[0].errors === 0, 'tick ночью: world.view() и world.get(x, y) без z — без ошибок', g.R.logs.slice(-3));
    g.R.stop(); }
  // события: start, pickup, mobKill, use (предмет с use: true), chat; время, день, ночь, окно
  { const g = mkGame([mk('evs', `
const got = [];
mod.on('start', () => got.push('start'));
mod.on('pickup', e => got.push('pickup ' + e.item + ' ' + e.n));
mod.on('mobKill', e => got.push('kill ' + e.mob));
mod.on('use', e => got.push('use ' + e.item + ' ' + e.tile));
mod.on('onChat', e => { got.push('chat ' + e.text); const v = world.view(); player.message(got.join('|')); player.message('t=' + world.time().toFixed(2) + ' h=' + world.hours() + ' d=' + world.day() + ' n=' + world.isNight() + ' gn=' + game.night + ' v=' + (v.w + 'x' + v.h + 'x' + v.d) + ' hp=' + player.hp + '/' + player.maxHp + ' liq=' + world.liquid(e.x, 0, e.z)); });
`, { items: [{ id: 'wand', name: 'Палочка', texture: 't', use: true }] })], { time: 21 }); await waitReady(g.R);
    ok(g.R.hasUse('evs:wand') && !g.R.hasUse('stick'), 'предмет с use: true — событие use (обычные — нет)');
    g.R.event('pickup', { item: 'stick', n: 3 }); g.R.event('mobKill', { mob: 'zombie', x: 1, y: 70, z: 1 });
    g.R.event('use', { x: 2, y: 70, z: 2, block: 'stone', item: 'evs:wand' }); await tick(30);
    g.R.event('chat', { text: 'привет', x: 8, y: 2, z: 8 }); await tick(60);
    const line = g.log.log.find(t => /chat привет/.test(t)) || '', line2 = g.log.log.find(t => /t=/.test(t)) || '';
    ok(/^🧩 start\|pickup stick 3\|kill zombie\|use evs:wand stone\|chat привет/.test(line), 'события start, pickup, mobKill, use, chat (и onChat)', line);
    ok(/t=0\.88 h=21 d=3 n=true gn=true v=17x17x17 hp=20\/20 liq=null/.test(line2), 'world.time() 0…1, hours(), day(), isNight(), game.night, окно 17³, player.hp/maxHp, liquid', line2);
    g.R.stop(); }
  // лимиты и проверка действий
  { const g = mkGame([mk('lim', `
mod.on('tilePlace', e => { for (let i = 0; i < 450; i++) world.set(e.x + (i % 16), 60 + Math.floor(i / 16), e.z, 'b'); });
mod.on('chat', e => {
  world.set(20, 60, 8, 'b'); world.set(9, 60, 9, 'no_such_block');
  player.give('diamond', 5); player.give('nothing', 1); player.give('b', 3); player.give('torch', 2); player.give('gel', 1);
  for (let i = 0; i < 5; i++) player.message('сообщение ' + i);
  player.heal(999); player.heal(1);
});
mod.on('use', 'b', e => { player.launch(0, 999, 0); player.teleport(e.x, 300, e.z); game.spawn('zombie', e.x, e.y, e.z); game.spawn('blueslime', e.x, e.y, e.z); fx.shake(2); fx.text(e.x, e.y, e.z, 'привет'); });
mod.on('tick', () => { world.set(0, 64, 0, 'stone'); world.set(1, 64, 0, 'furnace'); });
`)]); await waitReady(g.R);
    const W = g.W, bid = V.block('lim:b').id;
    g.R.event('blockPlace', { x: -8, y: 60, z: -8, block: 'stone' }); await tick(60);
    let n = 0; for (let x = -8; x < 8; x++) for (let y = 60; y < 89; y++) if (W.get(x, y, -8) === bid) n++;
    ok(n === 400, 'не больше 400 действий за событие (как у «Подземья»)', n);
    ok(g.R.mods[0].errors === 1 && g.log.toast.length === 1 && !g.R.mods[0].off, 'превышение — ошибка в журнал, мод работает дальше', g.R.logs.slice(-2));
    g.P.x = -60; g.R.event('chat', { text: 'x' }); await tick(60); g.P.x = 8.5;
    ok(W.loaded(20, 8) && W.get(20, 60, 8) !== bid, 'world.set дальше 64 блоков от игрока — не применяется');
    ok(g.log.give.map(s => s.id + ':' + s.n).join() === 'lim:b:3,torch:2,slime_ball:1', 'player.give: только свои и простые (алмаз — нельзя), gel → слизь', g.log.give);
    ok(g.log.log.filter(t => /сообщение/.test(t)).length === 2, 'player.message — не больше 2 в секунду');
    ok(g.log.heal.length === 1 && g.log.heal[0] === 10, 'player.heal — до 10 и не чаще раза в 0,5 с', g.log.heal);
    ok(g.R.logs.some(l => /нет блока «no_such_block»/.test(l.t)) && g.R.logs.some(l => /можно давать только/.test(l.t)), 'несуществующий блок, чужая вещь — в журнал мода');
    g.R.event('use', { x: 3, y: 64, z: 3, block: 'lim:b', item: '' }); await tick(40);
    ok(g.log.launch[0]?.[1] === 30 && g.log.tp[0]?.[1] <= V.H + 10 && g.log.spawn.join() === 'zombie,slime' && g.log.shake[0] === 1 && g.log.text[0] === 'привет', 'подброс и высота телепорта зажаты, blueslime → slime, тряска, надпись', g.log);
    W.set(0, 64, 0, V.ID.chest); W.set(1, 64, 0, 0); g.R.tick(.5); await tick(40);
    ok(W.get(0, 64, 0) === V.ID.chest && W.get(1, 64, 0) === 0, 'сундуки, печи, верстаки, двери скрипт не трогает и не ставит');
    g.R.stop(); }
  // 600 действий в секунду
  { const g = mkGame([mk('sec', `mod.on('tilePlace', e => { for (let i = 0; i < 256; i++) world.set(e.x + (i % 16), e.y + Math.floor(i / 16), e.z, 'b'); });`)]); await waitReady(g.R);
    const bid = V.block('sec:b').id;
    for (let k = 0; k < 4; k++) g.R.event('tilePlace', { x: -16 + (k % 2) * 16, y: 40 + Math.floor(k / 2) * 16, z: -16 + k * 3, tile: 'stone' });
    await tick(80);
    let n = 0; for (const c of g.W.chunks.values()) for (let i = 0; i < c.ids.length; i++) if (c.ids[i] === bid) n++;
    ok(n === 600, 'не больше 600 действий в секунду от мода', n);
    g.R.stop(); }
  // подделанные сообщения потока
  { const g = mkGame([mk('forge', `mod.on('chat', () => { const list = []; for (let i = 0; i < 3000; i++) list.push({ c: 'set', x: (i % 16), y: 70 + Math.floor(i / 256), z: Math.floor(i / 16) % 16, b: 'forge:b' }); postMessage({ t: 'cmds', list }); postMessage({ t: 'cmds', list: [{ c: 'store', s: 'y'.repeat(70000) }, { c: 'give', i: 'diamond', n: 64 }] }); });`)]); await waitReady(g.R);
    g.R.event('chat', { text: 'x' }); await tick(60);
    const bid = V.block('forge:b').id; let n = 0; for (const c of g.W.chunks.values()) for (let i = 0; i < c.ids.length; i++) if (c.ids[i] === bid) n++;
    ok(n === 600 && g.R.data().forge === undefined && !g.log.give.length, 'поддельные пачки: не больше 600/с, огромное хранилище и алмазы — не приняты', n);
    g.R.stop(); }
  // ошибка при запуске — выключен сразу; 5 ошибок — выключен; завис — выключен; остальные живут
  { const g = mkGame([mk('syn', 'mod.on(\'chat\', e => {\n  let = ;\n});'), mk('err', `mod.on('chat', e => { null.x; });`), mk('hang', `mod.on('chat', e => { while (true) {} });`), mk('good', `mod.on('chat', e => print('я жив'));`)]);
    await waitReady(g.R); await tick(30);
    const by = id => g.R.mods.find(x => x.m.id === id);
    ok(by('syn').off && /ошибка при запуске/.test(by('syn').off), 'синтаксическая ошибка — мод выключен сразу', by('syn').off);
    ok(g.log.toast.some(t => /«syn» выключен/.test(t)), 'игрок видит, что мод выключен и почему');
    for (let k = 0; k < 6; k++) { g.R.event('chat', { text: String(k) }); await tick(15); }
    await tick(500);
    ok(by('err').off === '5 ошибок в скриптах' && by('err').errors >= 5, '5 ошибок — мод выключен (как у «Подземья»)', by('err'));
    ok(by('hang').off && /завис/.test(by('hang').off), 'вечный цикл — поток убит, мод выключен', by('hang').off);
    ok(!by('good').off && g.R.logs.filter(l => l.mod === 'good' && /я жив/.test(l.t)).length >= 5, 'остальные моды работают дальше (print → журнал)');
    ok(g.R.logs.some(l => l.mod === 'err' && /main\.js, строка 1/.test(l.t)), 'ошибка — с файлом и номером строки', g.R.logs.filter(l => l.mod === 'err').slice(0, 2));
    g.R.stop(); }
  { const g = mkGame([{ manifest: { id: 'luabad', name: 'luabad', version: '1', game: 'voxel', scripts: [{ file: 'a.lua' }] }, files: { 'a.lua': 'local x = 1\nif x then\n  print("ok"\nend' } }]); await waitReady(g.R); await tick(30);
    ok(g.R.mods[0].off && /a\.lua, строка \d/.test(g.R.mods[0].off), 'Lua: синтаксическая ошибка — с файлом и строкой', g.R.mods[0].off);
    g.R.stop(); }
  // tick — дважды в секунду; после остановки — тишина
  { const g = mkGame([mk('quiet', `mod.on('tick', e => print('тик ' + e.dt));`)]); await waitReady(g.R);
    g.R.tick(.3); await tick(20); ok(!g.R.logs.some(l => /тик/.test(l.t)), 'tick копится до 0,5 с');
    g.R.tick(.3); await tick(30); ok(g.R.logs.some(l => /тик 0\.5/.test(l.t)), 'tick — дважды в секунду, dt = 0,5 (как у «Подземья»)');
    g.R.stop(); g.R.tick(1); g.R.event('chat', {}); await tick(30);
    ok(boxes.every(b => b.dead), 'после остановки мира песочницы закрыты'); }
  // world.get видит окно, world.read — дальше; Lua — те же объекты через точку и двоеточие, task.wait
  { const g = mkGame([mk('reader', `mod.on('chat', async e => { const near = world.get(e.x, e.y - 1, e.z); const far = await world.read(e.x + 20, 0, e.z); player.message(near + '|' + far + '|' + world.get(e.x + 20, 0, e.z)); });`)]); await waitReady(g.R);
    const y = g.W.heightAt(8, 8);
    g.R.event('chat', { x: 8, y, z: 8, text: '' }); await tick(250);
    ok(g.log.log.some(t => t.includes(V.blocks[g.W.get(8, y - 1, 8)].name + '|bedrock|null')), 'world.get — окно сразу, world.read — дальше через ожидание', g.log.log);
    g.R.stop(); }
  { const g = mkGame([{ manifest: { id: 'luard', name: 'luard', version: '1', game: 'voxel', scripts: [{ lang: 'lua', file: 'a.lua' }] }, files: { 'a.lua': `
mod.on("chat", function(e)
  local far = world.read(e.x + 20, 0, e.z)
  task.wait(0.05)
  mod.storage:set("n", (mod.storage:get("n") or 0) + 1)
  player:message("lua " .. tostring(far) .. " " .. tostring(world.get(e.x, 0, e.z)) .. " n=" .. mod.storage:get("n"))
end)
commands.add("hi", "привет", function(args) player.message("привет, " .. player.name .. " " .. #args) end)` } }]); await waitReady(g.R);
    g.R.event('chat', { x: 8, y: 2, z: 8, text: '' }); await tick(300);
    ok(g.log.log.some(t => /lua bedrock bedrock n=1/.test(t)), 'Lua: world.read ждёт ответ, task.wait, mod.storage', g.log.log);
    g.R.command('hi', ['a', 'b']); await tick(150);
    ok(g.log.log.some(t => /привет, Игрок 2/.test(t)), 'Lua: commands.add с аргументами', g.log.log);
    g.R.stop(); }
  // скрипт мода на Java: тот же API (mod, world, player…) — по расширению .java, язык подгружается сам
  if (JAVA) { const g = mkGame([{ manifest: { id: 'javamod', name: 'javamod', version: '1', game: 'voxel', scripts: [{ file: 'Main.java' }] }, files: { 'Main.java': `System.out.println("java " + (6 * 7));
mod.on("chat", e -> player.message("java чат " + e.text));` } }]); await waitReady(g.R); await tick(30);
    ok(g.ms[0].scripts[0].lang === 'java', 'Java: язык — по расширению .java');
    ok(g.R.mods[0].ready && !g.R.mods[0].off && g.R.logs.some(l => /java 42/.test(l.t)), 'Java-мод запустился (println → журнал)', { off: g.R.mods[0].off, logs: g.R.logs.slice(0, 4) });
    g.R.event('chat', { x: 8, y: 2, z: 8, text: 'ку' }); await tick(150);
    ok(g.log.log.some(t => /java чат ку/.test(t)), 'Java: mod.on с лямбдой, player.message', g.log.log);
    g.R.stop(); }

  // ═══ 6. Рамка песочницы: «пинг» с номером ═══
  sec('моды: рамка песочницы (зависание)');
  {
    const html = M.frameHtml(), js = /<script>([\s\S]*)<\/script>/.exec(html)[1];
    ok(/connect-src 'none'/.test(html) && /img-src 'none'/.test(html) && /default-src 'none'/.test(html), 'CSP рамки: без сети и картинок');
    const run = answer => {
      let now = 0, iv = null, handler = null;
      const ups = [], workers = [];
      const parent = { postMessage: m => ups.push(m) };
      class Worker { constructor(){ this.got = []; this.dead = false; workers.push(this); } postMessage(m){ this.got.push(m); } terminate(){ this.dead = true; } }
      const fctx = vm.createContext({ parent, Worker, Blob: class {}, URL: { createObjectURL: () => 'blob:x' }, Date: { now: () => now }, Math, setInterval: f => { iv = f; }, addEventListener: (t, f) => { handler = f; } });
      vm.runInContext(js, fctx);
      handler({ source: parent, data: { t: 'boot', code: 'function(){}' } });
      const w = workers[0];
      for (let k = 0; k < 20; k++) {
        now += 500; iv();
        const ping = w.got.filter(m => m.t === 'ping').pop();
        if (ping && answer && !ping.done) { ping.done = true; const n = answer === 'good' ? ping.n : answer === 'wrong' ? ping.n + 1 : undefined; w.onmessage({ data: { t: 'pong', n } }); }
      }
      return { hang: ups.some(m => m.t === 'hang'), dead: w.dead, frame: ups[0]?.t === 'frame' };
    };
    const good = run('good'), none = run(null), wrong = run('wrong'), forged = run('forged');
    ok(good.frame && !good.hang && !good.dead, 'поток отвечает на «пинг» — живёт');
    ok(none.hang && none.dead, 'не отвечает 3 с — убит, сообщение «завис»');
    ok(wrong.hang && forged.hang, 'ответ с чужим номером или без номера (подделка из цикла) — не спасает');
  }
  for (const b of boxes) b.close();
};

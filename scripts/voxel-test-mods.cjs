// Моды «Кубомира» без браузера — часть node scripts/voxel-test.cjs (зовётся оттуда, отдельно не запускается).
// Проверка mod.json (примеры проходят, ошибки — понятные), zip (.d37mod) туда-обратно и с deflate, защита от «бомб» и путей «..»,
// реестр (ваниль возвращается, рецепты и печь мода работают, моды ссылаются друг на друга), фичи генерации (свои руды и
// столбы, ваниль без мода не меняется, одинаково при одном зерне), песочница скриптов (JS и Lua: события, команды, хранилище,
// лимиты блоков и вещей, ошибки и зависания выключают мод, подделанные сообщения режутся), «пинг» с номером в рамке.
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

module.exports = async function ({ ok, sec, load, SITE, CORE }){
  const ctx = load([...CORE, 'js/engine/voxel-mods.js']);
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/engine/lang-lua.js'), 'utf8'), ctx, { filename: 'lang-lua.js' });
  const V = ctx.D37E.vox, M = V.mods;
  const tick = (ms = 25) => new Promise(r => setTimeout(r, ms));
  const files = x => Object.assign({}, x.files);
  const EX = Object.fromEntries(M.EXAMPLES.map(x => [x.manifest.id, x]));

  // ═══ 1. Проверка mod.json ═══
  sec('моды: проверка mod.json');
  for (const x of M.EXAMPLES) { const r = M.validate(x.manifest, files(x)); ok(r.ok && r.m.id === x.manifest.id, `пример «${x.manifest.name}» проходит проверку`, r.errors); }
  const rr = M.validate(EX.rubies.manifest, files(EX.rubies)).m;
  ok(rr.blocks.length === 2 && rr.items.length === 3 && rr.recipes.length === 5 && rr.features.length === 1 && rr.scripts.length === 1, 'рубины: 2 блока, 3 вещи, 5 рецептов, 1 руда, 1 скрипт');
  ok(rr.blocks[0].name === 'rubies:ruby_ore' && rr.blocks[0].drop === 'rubies:ruby' && rr.blocks[0].tier === 3, 'имена с приставкой мода, drops — своя вещь');
  ok(rr.recipes[0].key['|'] === 'stick' && rr.recipes[0].key.R === 'rubies:ruby', 'в рецепте ваниль — без приставки, своё — с приставкой');
  ok(M.validate(EX.trampoline.manifest, files(EX.trampoline)).m.blocks[0].tex.side === 'planks_oak', 'текстура игры (planks_oak) годится для мода');
  const bad = (j, f, re, msg) => { const r = M.validate(j, f || {}); ok(!r.ok && r.errors.some(e => re.test(e)), msg, r.errors); };
  bad('{ не json', null, /не JSON/, 'не JSON — понятная ошибка');
  bad({ id: 'A b' }, null, /^id — латиница/, 'неверный id');
  bad({ id: 'mm', blocks: [{ id: 'x' }] }, null, /нет текстуры «x»/, 'блок без текстуры');
  bad({ id: 'mm', textures: { t: { draw: { k: 'noise', c: '#fff' } } }, blocks: [{ id: 'x', texture: 't', drops: 'nothing_here' }] }, null, /нет вещи или блока «nothing_here»/, 'drops — несуществующая вещь');
  bad({ id: 'mm', recipes: [{ pattern: ['ab'], key: { a: 'stick' }, result: 'stick' }] }, null, /в key нет «b»/, 'рецепт: в key нет знака');
  bad({ id: 'mm', recipes: [{ pattern: ['a'], key: { a: '#nope' }, result: 'stick' }] }, null, /группу «#nope»/, 'рецепт: неизвестная группа');
  bad({ id: 'mm', api: 99 }, null, /API 99/, 'мод для новой версии API');
  bad({ id: 'mm', textures: { t: { draw: { k: 'alien' } } } }, null, /draw\.k/, 'неизвестный рисунок текстуры');
  bad({ id: 'mm', textures: { t: 'tex/t.png' } }, {}, /нет файла tex\/t\.png/, 'PNG-файла нет в моде');
  bad({ id: 'mm', textures: { t: 'big.png' } }, { 'big.png': new Uint8Array(70000) }, /больше 64 КБ/, 'PNG больше 64 КБ');
  bad({ id: 'mm', scripts: ['main.js'] }, {}, /скрипт main\.js: нет файла/, 'скрипта нет в моде');
  bad({ id: 'mm', scripts: [{ code: 'x'.repeat(200001) }] }, null, /больше 200 КБ/, 'скрипт больше 200 КБ');
  bad({ id: 'mm', features: [{ type: 'ore', block: 'stick' }] }, null, /не блок/, 'фича из вещи (не блока)');
  bad({ id: 'mm', blocks: [{ id: 'a', texture: 'stone' }], items: [{ id: 'a', texture: 'stone' }] }, null, /занято дважды/, 'одно имя у блока и вещи');
  { const r = M.validate({ id: 'mm', game: 'tiles' }); ok(r.ok && r.warnings.some(w => /2D-песочницы/.test(w)), 'game: tiles — предупреждение «для 2D»'); }
  { const r = M.validate({ id: 'mm', features: [{ type: 'scatter', block: 'stone', biomes: ['mars', 'desert'] }] }); ok(r.ok && r.m.features[0].biomes.join() === 'desert' && r.warnings.some(w => /биомы/.test(w)), 'неизвестный биом — пропущен с предупреждением'); }
  { const r = M.validate({ id: 'mm', recipes: [{ type: 'shapeless', ingredients: ['other:gem'], result: 'stick' }] }); ok(r.ok && r.m.needs.includes('other') && r.warnings.some(w => /нужен мод «other»/.test(w)), 'ссылка на другой мод — предупреждение «нужен мод»'); }
  { const r = M.validate({ id: 'mm', strange: 1 }); ok(r.ok && r.warnings.some(w => /strange/.test(w)), 'лишнее поле — предупреждение'); }
  { const r = M.validate({ id: 'mm', blocks: [{ id: 'g', texture: 'glass', hardness: 999, light: 99, bounce: 1e9 }] }); const b = r.m.blocks[0]; ok(b.hard === 50 && b.emit === 15 && b.bounce === 30, 'числа зажаты в пределы (твёрдость, свет, подброс)', b); }

  // ═══ 2. Zip (.d37mod) ═══
  sec('моды: zip (.d37mod)');
  const pack = Object.assign({ 'mod.json': JSON.stringify(EX.rubies.manifest) }, EX.rubies.files, { 'tex/пусто.png': new Uint8Array([1, 2, 3]) });
  const z = M.zip(pack);
  ok(z[0] === 0x50 && z[1] === 0x4b, 'zip начинается с «PK»');
  const un = await M.unzip(z);
  ok(Object.keys(un).length === 3 && new TextDecoder().decode(un['rubies.js']) === EX.rubies.files['rubies.js'] && un['tex/пусто.png'].join() === '1,2,3', 'zip → файлы обратно (и русские имена)');
  ok(M.validate(new TextDecoder().decode(un['mod.json']), un).ok, 'мод из zip проходит проверку');
  // свой zip с deflate и общей папкой (как делает архиватор Windows)
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
  const dz = await M.unzip(mkZip([['мод/mod.json', Buffer.from(JSON.stringify(EX.rubies.manifest)), 8], ['мод/rubies.js', big, 8], ['мод/../../evil.js', Buffer.from('x'), 0], ['__MACOSX/мод/._mod.json', Buffer.from('x'), 0]]));
  ok(Object.keys(dz).sort().join() === 'mod.json,rubies.js' && dz['rubies.js'].length === big.length, 'deflate распакован, общая папка убрана, «..» и __MACOSX пропущены', Object.keys(dz));
  let threw = '';
  try { await M.unzip(mkZip([['a.txt', Buffer.alloc(200000, 65), 8]], { lie: true })); } catch (e) { threw = e.message; }
  ok(/больше, чем заявлено|повреждён/.test(threw), '«бомба» (размер больше заявленного) — отказ', threw);
  threw = ''; try { await M.unzip(new Uint8Array([1, 2, 3, 4])); } catch (e) { threw = e.message; }
  ok(/не zip/.test(threw), 'не zip — понятная ошибка');

  // ═══ 3. Реестр ═══
  sec('моды: реестр (включить и вернуть ваниль)');
  const van = { b: V.blocks.length, i: V.items.length, r: V.recipes.length, t: V.tex.length, s: V.smelting.size, sand: V.smelting.get('sand').out };
  for (const x of M.EXAMPLES) M.register(M.validate(x.manifest, files(x)).m, {}, { recipes: false });
  const skipped = M.EXAMPLES.flatMap(x => M.recipes(M.validate(x.manifest, files(x)).m));
  ok(skipped.length === 0, 'все рецепты примеров подключились', skipped);
  ok(!!V.block('rubies:ruby_ore') && !!V.block('crystals:crystal') && !!V.block('trampoline:spring'), 'блоки модов в реестре');
  ok(V.item('rubies:ruby_pick')?.tool?.tier === 4 && V.item('rubies:ruby_pick').stack === 1, 'кирка мода: уровень 4, не складывается');
  ok(V.item('rubies:ruby_ore')?.place === 'rubies:ruby_ore' && V.item('crystals:crystal_block')?.block === V.block('crystals:crystal_block').id, 'у блоков мода есть вещи (ставятся)');
  ok(V.T.emit[V.block('crystals:crystal').id] === 11 && V.T.shape[V.block('crystals:crystal').id] === V.SHAPE.cross && !V.T.solid[V.block('crystals:crystal').id], 'кристалл: светит 11, крестом, проходимый');
  const g3 = (rows, w) => { const out = []; for (const r of rows) for (let k = 0; k < w; k++) out.push(r[k] || null); return out; };
  ok(V.craft(g3([['rubies:ruby', 'rubies:ruby', 'rubies:ruby'], [null, 'stick', null], [null, 'stick', null]], 3), 3, 3)?.out === 'rubies:ruby_pick', 'верстак: 3 рубина + 2 палки = рубиновая кирка');
  ok(V.craft(['rubies:ruby_block', null, null, null], 2, 2)?.n === 9, 'блок рубина → 9 рубинов (без формы)');
  ok(V.craft(g3([['slime_ball', 'slime_ball', 'slime_ball'], ['planks_birch', 'planks_oak', 'planks_spruce']], 3), 3, 2)?.out === 'trampoline:spring', 'группа #planks в рецепте мода');
  ok(V.smelting.get('rubies:ruby_ore')?.out === 'rubies:ruby', 'печь: рубиновая руда → рубин');
  ok(V.texIdx.has('rubies:ruby') && V.paint('rubies:ruby', V.tex[V.texIdx.get('rubies:ruby')].spec).some((v, i) => i % 4 === 3 && v > 0), 'текстура мода рисуется (рисунок кодом)');
  // мод, перебивающий ваниль в печи, — после сброса ваниль на месте
  V.addSmelt('sand', 'rubies:ruby');
  // мод на чужой вещи: без того мода рецепт пропущен, с ним — работает
  const dep = M.validate({ id: 'dep', recipes: [{ type: 'shapeless', ingredients: ['rubies:ruby', 'stick'], result: 'rubies:ruby_sword' }] }).m;
  ok(M.recipes(dep).length === 0, 'рецепт на вещах другого мода — подключился, когда тот мод есть');
  M.reset();
  ok(V.blocks.length === van.b && V.items.length === van.i && V.recipes.length === van.r && V.tex.length === van.t && V.smelting.size === van.s && V.smelting.get('sand').out === van.sand, 'сброс: ваниль как была (блоки, вещи, рецепты, текстуры, печь)');
  ok(!V.block('rubies:ruby_ore') && !V.item('rubies:ruby') && V.ID.missing > 0, 'после сброса блоков мода нет');
  ok(M.recipes(dep).length === 1, 'без нужного мода рецепт пропущен с причиной');
  M.reset();
  // PNG-текстура: готовые пиксели
  { const m = M.validate({ id: 'pngmod', textures: { p: 'p.png' }, blocks: [{ id: 'pb', texture: 'p' }] }, { 'p.png': new Uint8Array(100) }).m;
    const px = new Uint8Array(1024).fill(200); M.register(m, { p: px });
    const d = V.paint('pngmod:p', V.tex[V.texIdx.get('pngmod:p')].spec); ok(d[0] === 200 && d[1023] === 200, 'PNG мода: пиксели как в картинке');
    M.reset(); }

  // ═══ 4. Фичи генерации ═══
  sec('моды: фичи генерации');
  const regAll = () => { M.reset(); const ms = M.EXAMPLES.map(x => M.validate(x.manifest, files(x)).m); for (const m of ms) M.register(m, {}, { recipes: false }); for (const m of ms) M.recipes(m); return M.features(ms.flatMap(m => m.features)); };
  const feats = regAll();
  ok(feats.length === 4 && feats.every(f => f.block > 0) && feats.find(f => f.type === 'column').top === V.block('crystals:crystal').id, 'фичи: имена → номера блоков (руда, столб с верхушкой, россыпь, валун)');
  const Gm = V.genInit(1234, { features: feats }), G0 = V.genInit(1234, {});
  const ore = V.block('rubies:ruby_ore').id, cb = V.block('crystals:crystal_block').id, cr = V.block('crystals:crystal').id, modIds = new Set([ore, cb, cr]);
  let nOre = 0, nCol = 0, nCr = 0, other = 0, oreY = [99, 0], same = true;
  const biomesSeen = new Set();
  for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) {
    const a = V.genChunk(Gm, cx, cz), b = V.genChunk(G0, cx, cz), a2 = V.genChunk(Gm, cx, cz);
    for (let i = 0; i < a.ids.length; i++) {
      if (a.ids[i] !== a2.ids[i]) same = false;
      const t = a.ids[i];
      if (t === ore) { nOre++; const y = i & 127; oreY[0] = Math.min(oreY[0], y); oreY[1] = Math.max(oreY[1], y); }
      else if (t === cb) nCol++; else if (t === cr) nCr++;
      if (t !== b.ids[i] && !modIds.has(t)) other++;
    }
    for (const bi of a.biome) biomesSeen.add(V.BIOME_IDS[bi]);
  }
  ok(same, 'с модами: одно зерно — один и тот же мир');
  ok(nOre > 20 && oreY[0] >= 4 && oreY[1] <= 30, 'рубиновая руда есть и только на глубине 4…30', { nOre, oreY });
  ok(other === 0, 'без мода мир тот же: отличаются только клетки с блоками мода', other);
  // столбы и россыпь — в горах и снегах, валуны — в пустыне: ищем такие чанки
  let foundCol = nCol + nCr > 0;
  for (let cx = -40; cx < 40 && !foundCol; cx += 2) for (let cz = -40; cz < 40 && !foundCol; cz += 2) {
    const a = V.genChunk(Gm, cx, cz);
    const bset = new Set(); for (const bi of a.biome) bset.add(V.BIOME_IDS[bi]);
    if (!bset.has('snow') && !bset.has('mountains') && !bset.has('desert')) continue;
    for (let i = 0; i < a.ids.length; i++) if (a.ids[i] === cb || a.ids[i] === cr) { foundCol = true; break; }
  }
  ok(foundCol, 'кристаллы (столбы / россыпь / валуны) появляются в своих биомах', { nCol, nCr, biomes: [...biomesSeen] });
  M.reset();

  // ═══ 5. Песочница скриптов (поток — контекст vm, как Worker) ═══
  sec('моды: песочница скриптов');
  // «рамка» для node: свой контекст на мод, сообщения — по очереди, обработчик дольше 400 мс — «завис»
  const boxes = [];
  const vmBox = onMsg => {
    const timers = new Set();
    // свои встроенные объекты контекста (как у настоящего потока), снаружи — только таймеры и postMessage
    const wctx = vm.createContext({ console });
    vm.runInContext('self = globalThis; onmessage = null;', wctx);
    wctx.setTimeout = (f, ms) => { const h = setTimeout(() => { timers.delete(h); if (!B.dead) f(); }, ms); timers.add(h); return h; };
    wctx.clearTimeout = h => { clearTimeout(h); timers.delete(h); };
    wctx.setInterval = (f, ms) => { const h = setInterval(() => { if (!B.dead) f(); }, ms); timers.add(h); return h; };
    wctx.clearInterval = h => { clearInterval(h); timers.delete(h); };
    wctx.postMessage = m => { const c = structuredClone(m); setImmediate(() => { if (!B.dead) onMsg(c); }); };
    const B = {
      dead: false, ctx: wctx,
      post(m){
        if (B.dead) return;
        const c = structuredClone(m);
        setImmediate(() => {
          if (B.dead) return;
          try {
            if (c.t === 'boot') { vm.runInContext('(' + c.code + ')()', wctx, { timeout: 2000, filename: 'blob:null/mod-runtime' }); return; }
            wctx.__m = { data: c };
            vm.runInContext('onmessage(__m)', wctx, { timeout: 400, filename: 'blob:null/frame' });
          } catch (e) { if (/timed out/i.test(e.message)) { B.dead = true; onMsg({ t: 'hang' }); } else onMsg({ t: 'error', where: '', line: 0, msg: e.message }); }
        });
      },
      close(){ B.dead = true; for (const h of timers) { clearTimeout(h); clearInterval(h); } timers.clear(); },
    };
    boxes.push(B);
    setImmediate(() => onMsg({ t: 'frame' }));
    return B;
  };
  // мир: 3×3 чанка вокруг (8, 8)
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
    const log = { toast: [], log: [], give: [], launch: [], fx: [], snd: [], heal: [], hurt: [], tp: [], spawn: [] };
    const st = { W, meta: { modData: o.modData || {} }, creative: false, R: { lighting: { time: 13 } } };
    let now = 0;
    const hooks = {
      player: () => P, toast: t => log.toast.push(t), log: t => log.log.push(t), give: s => log.give.push(s), heal: n => log.heal.push(n), hurt: n => log.hurt.push(n),
      launch: (a, b, c) => log.launch.push([a, b, c]), teleport: (x, y, z) => log.tp.push([x, y, z]), particles: (k, x, y, z, n) => log.fx.push([k, x, y, z, n]), sound: n => log.snd.push(n), spawn: (k) => log.spawn.push(k),
    };
    const R = M.runner(st, ms.map(m => ({ m })), hooks, { box: vmBox, now: () => now });
    return { R, W, P, log, st, ms, adv: ms2 => { now += ms2; } };
  };
  const waitReady = async R => { for (let i = 0; i < 100 && R.mods.some(Mx => Mx.m.scripts.length && !Mx.ready && !Mx.off); i++) await tick(10); };

  // рубины (JS): событие, искры, хранилище, команда
  { const g = mkGame([EX.rubies]); await waitReady(g.R);
    ok(g.R.mods[0].ready && !g.R.mods[0].off, 'JS-мод запустился');
    g.R.event('blockBreak', { x: 8, y: 20, z: 8, block: 'stone' }); await tick();
    ok(g.log.fx.length === 0, 'событие не про его блок — обработчик молчит');
    g.R.event('blockBreak', { x: 8, y: 20, z: 8, block: 'rubies:ruby_ore' }); await tick(40);
    ok(g.log.fx.length === 1 && g.log.fx[0][0] === 'magic' && g.log.snd[0] === 'coin', 'blockBreak руды: искры и звон', g.log);
    ok(g.log.log.some(t => /Первый рубин/.test(t)), 'сообщение игроку при первой находке');
    ok(JSON.parse(g.R.data().rubies).found === 1, 'mod.storage сохраняется в мире (modData)');
    ok(g.R.commands().includes('rubies') && g.R.command('rubies', []), 'команда /rubies от мода');
    await tick(40);
    ok(g.log.log.some(t => /Найдено рубинов: 1/.test(t)), 'команда ответила');
    g.R.stop(); }
  // хранилище переживает перезапуск мира
  { const g = mkGame([EX.rubies], { modData: { rubies: JSON.stringify({ found: 41 }) } }); await waitReady(g.R);
    g.R.command('rubies', []); await tick(40);
    ok(g.log.log.some(t => /Найдено рубинов: 41/.test(t)), 'mod.storage — из сохранения мира');
    g.R.stop(); }
  // батут (Lua): встал — подбросило; присел — нет
  { const g = mkGame([EX.trampoline]); await waitReady(g.R);
    ok(g.R.mods[0].ready && !g.R.mods[0].off, 'Lua-мод запустился', g.R.logs);
    const spring = V.block('trampoline:spring').id;
    g.R.stepOn([spring], g.P); await tick(40);
    ok(g.log.launch.length === 1 && g.log.launch[0][1] === 17 && g.log.fx[0]?.[0] === 'spark' && g.log.snd[0] === 'kb_bounce', 'Lua: stepOn → подброс, искры, звук', g.log);
    g.R.stepOn([spring], g.P); await tick(20);
    ok(g.log.launch.length === 1, 'stepOn не чаще раза в 0,3 с');
    g.adv(400); g.P.sneak = true; g.R.stepOn([spring], g.P); await tick(40);
    ok(g.log.launch.length === 1, 'Lua: присел — не подбрасывает (player.sneaking)');
    g.R.stop(); }
  // лимиты и проверка команд
  const mk = (id, code, extra = {}) => ({ manifest: Object.assign({ id, name: id, textures: { t: { draw: { k: 'noise', c: '#888888' } } }, blocks: [{ id: 'b', texture: 't' }], scripts: [{ file: 'main.js' }] }, extra), files: { 'main.js': code } });
  { const g = mkGame([mk('lim', `
mod.on('blockPlace', e => { for (let i = 0; i < 300; i++) world.set(e.x + (i % 16), 60 + Math.floor(i / 16), e.z, 'b'); });
mod.on('chat', e => { world.set(500, 60, 500, 'stone'); world.set(9, 60, 9, 'no_such_block'); player.give('diamond', 5); player.give('nothing', 1); for (let i = 0; i < 20; i++) player.give('stick', 1); });
mod.on('use', 'b', e => { player.launch(0, 999, 0); player.teleport(e.x, 300, e.z); player.heal(1e9); world.spawn('zombie', e.x, e.y, e.z); });
`)]); await waitReady(g.R);
    const W = g.W, bid = V.block('lim:b').id;
    g.R.event('blockPlace', { x: -8, y: 60, z: -8, block: 'stone' }); await tick(40);
    let n = 0; for (let x = -8; x < 8; x++) for (let y = 60; y < 80; y++) if (W.get(x, y, -8) === bid) n++;
    ok(n === 256, 'world.set: не больше 256 блоков за событие', n);
    ok(g.R.mods[0].errors === 1 && g.log.toast.length === 1 && !g.R.mods[0].off, 'превышение — ошибка в «Вывод», мод работает дальше', g.R.logs.slice(-3));
    g.R.event('chat', { text: 'привет' }); await tick(40);
    ok(W.get(500, 60, 500) === -1, 'world.set далеко от игрока / вне загруженного — не применяется');
    ok(g.log.give.length === 10 && g.log.give[0].id === 'diamond' && g.log.give[0].n === 5, 'player.give: настоящие вещи, не больше 10 раз в секунду', g.log.give.length);
    ok(g.R.logs.some(l => /нет вещи «nothing»/.test(l.t)) && g.R.logs.some(l => /нет блока «no_such_block»/.test(l.t)), 'несуществующие вещи и блоки — в журнал мода');
    ok(g.R.hasUse('lim:b') && !g.R.hasUse('stone'), 'use — только на то, что мод попросил');
    g.R.event('use', { x: 3, y: 64, z: 3, block: 'lim:b', item: '' }); await tick(40);
    ok(g.log.launch[0]?.[1] === 30 && g.log.tp.length === 1 && g.log.tp[0][1] <= V.H + 10 && g.log.heal[0] === 20 && g.log.spawn.length === 1, 'подброс, высота телепорта, лечение — зажаты в пределы', g.log);
    g.R.stop(); }
  // секундный лимит: 10 событий × 256 = 2560 → 2048
  { const g = mkGame([mk('sec', `mod.on('blockPlace', e => { for (let i = 0; i < 256; i++) world.set(e.x + (i % 16), e.y + Math.floor(i / 16), e.z, 'b'); });`)]); await waitReady(g.R);
    const bid = V.block('sec:b').id;
    for (let k = 0; k < 10; k++) g.R.event('blockPlace', { x: -16 + (k % 2) * 16, y: 40 + Math.floor(k / 2) * 16, z: -16 + k * 3, block: 'stone' });
    await tick(80);
    let n = 0; for (const c of g.W.chunks.values()) for (let i = 0; i < c.ids.length; i++) if (c.ids[i] === bid) n++;
    ok(n === 2048, 'не больше 2048 блоков в секунду от мода', n);
    g.R.stop(); }
  // подделанные сообщения потока: больше 600 команд за раз — лишнее отброшено
  { const g = mkGame([mk('forge', `mod.on('chat', () => { const list = []; for (let i = 0; i < 3000; i++) list.push({ c: 'set', x: (i % 16), y: 70 + Math.floor(i / 256), z: Math.floor(i / 16) % 16, b: 'forge:b' }); postMessage({ t: 'cmds', list }); postMessage({ t: 'store', s: 'x' }); postMessage({ t: 'cmds', list: [{ c: 'store', s: 'y'.repeat(70000) }] }); });`)]); await waitReady(g.R);
    g.R.event('chat', { text: 'x' }); await tick(60);
    const bid = V.block('forge:b').id; let n = 0; for (const c of g.W.chunks.values()) for (let i = 0; i < c.ids.length; i++) if (c.ids[i] === bid) n++;
    ok(n === 600 && g.R.data().forge === undefined, 'поддельная пачка команд: не больше 600, огромное хранилище не принято', n);
    g.R.stop(); }
  // ошибка при запуске — мод выключен сразу; ошибки в обработчиках — 10 и выключен; завис — выключен
  { const g = mkGame([mk('syn', 'mod.on(\'chat\', e => {\n  let = ;\n});'), mk('err', `mod.on('chat', e => { null.x; });`), mk('hang', `mod.on('chat', e => { while (true) {} });`), mk('good', `mod.on('chat', e => player.message('я жив'));`)]);
    await waitReady(g.R); await tick(30);
    const by = id => g.R.mods.find(x => x.m.id === id);
    ok(by('syn').off && /ошибка при запуске/.test(by('syn').off), 'синтаксическая ошибка — мод выключен сразу', by('syn').off);
    ok(g.log.toast.some(t => /«syn» выключен/.test(t)), 'игрок видит, что мод выключен и почему');
    for (let k = 0; k < 10; k++) { g.R.event('chat', { text: String(k) }); await tick(15); }
    await tick(500);
    ok(by('err').off === '10 ошибок в скриптах' && by('err').errors >= 10, '10 ошибок — мод выключен', by('err'));
    ok(by('hang').off && /завис/.test(by('hang').off), 'вечный цикл — поток убит, мод выключен', by('hang').off);
    ok(!by('good').off && g.log.log.filter(t => /я жив/.test(t)).length >= 5, 'остальные моды работают дальше');
    ok(g.R.logs.some(l => l.mod === 'err' && /строка 1/.test(l.t)), 'ошибка — с номером строки скрипта', g.R.logs.filter(l => l.mod === 'err').slice(0, 2));
    g.R.stop(); }
  // Lua: ошибка в коде — с номером строки, мод выключен
  { const g = mkGame([{ manifest: { id: 'luabad', name: 'luabad', scripts: [{ file: 'a.lua' }] }, files: { 'a.lua': 'local x = 1\nif x then\n  print("ok"\nend' } }]); await waitReady(g.R); await tick(30);
    ok(g.R.mods[0].off && /a\.lua, строка \d/.test(g.R.mods[0].off), 'Lua: синтаксическая ошибка — с файлом и строкой', g.R.mods[0].off);
    g.R.stop(); }
  // события только тем, кто подписан; после stop() — тишина
  { const g = mkGame([mk('quiet', `mod.on('tick', dt => player.message('тик ' + dt.toFixed(2)));`)]); await waitReady(g.R);
    g.R.tick(.1); await tick(20); ok(g.log.log.length === 0, 'tick копится до 0,25 с');
    g.R.tick(.2); await tick(30); ok(g.log.log.some(t => /тик 0\.30/.test(t)), 'tick — раз в 0,25 с со своим dt', g.log.log);
    g.R.stop(); g.R.tick(1); g.R.event('chat', {}); await tick(30);
    ok(g.log.log.length === 1 && boxes.every(b => b.dead), 'после остановки мира песочницы закрыты');
  }
  // world.get видит окрестность события, world.read — дальше (с ожиданием)
  { const g = mkGame([mk('reader', `mod.on('chat', async e => { const near = world.get(e.x, e.y - 1, e.z); const far = await world.read(e.x + 20, 0, e.z); player.message(near + '|' + far + '|' + world.get(e.x + 20, 0, e.z)); });`)]); await waitReady(g.R);
    const y = g.W.heightAt(8, 8);
    g.R.event('chat', { x: 8, y, z: 8, text: '' }); await tick(250);
    ok(g.log.log.some(t => t.includes(V.blocks[g.W.get(8, y - 1, 8)].name + '|bedrock|null')), 'world.get — рядом сразу, world.read — дальше через ожидание', g.log.log);
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

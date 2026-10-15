// Проверка переноса из Minecraft (js/engine/mc-*.js) без браузера и без файлов Mojang: node scripts/mc-import-test.cjs
// Сам собирает образцы: NBT (Java и Bedrock), .schem v2/v3, .schematic, .litematic, .mcstructure, .nbt, регион .mca (1.18 и до 1.13),
// LevelDB (журнал и таблица) с подчанком Bedrock, zip (без сжатия и deflate), пакет данных, мод .jar (данные), дополнение Bedrock,
// пакет текстур — и проверяет чтение, таблицу блоков, .mcfunction → JS (выполняя его), моды → V.mods.validate.
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const ctx = { console, Math, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, Map, Set, WeakMap, Object, Array, JSON, Number, String, Boolean, Error, TypeError, RangeError, Promise, Date, RegExp, Symbol, Proxy, Reflect, BigInt,
  setTimeout, clearTimeout, setInterval, clearInterval, performance, ArrayBuffer, DataView, TextEncoder, TextDecoder, Blob: global.Blob, DecompressionStream: global.DecompressionStream, Response: global.Response, require, atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64') };
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
for (const f of ['js/engine/voxel.js', 'js/engine/voxel-tex.js', 'js/engine/voxel-gen.js', 'js/engine/voxel-mesh.js', 'js/engine/voxel-mods.js', 'js/engine/mc-nbt.js', 'js/engine/mc-map.js', 'js/engine/mc-formats.js', 'js/engine/mc-packs.js'])
  vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
const V = ctx.D37E.vox, MC = ctx.D37E.mc;

// ═══ запись NBT (для образцов) ═══
function nbtW(le){
  const parts = [];
  const u8 = n => parts.push(Buffer.from([n & 255]));
  const i16 = n => { const b = Buffer.alloc(2); le ? b.writeInt16LE(n) : b.writeInt16BE(n); parts.push(b); };
  const i32 = n => { const b = Buffer.alloc(4); le ? b.writeInt32LE(n) : b.writeInt32BE(n); parts.push(b); };
  const i64 = n => { const b = Buffer.alloc(8); le ? b.writeBigInt64LE(BigInt(n)) : b.writeBigInt64BE(BigInt(n)); parts.push(b); };
  const str = s => { const b = Buffer.from(s, 'utf8'); i16(b.length); parts.push(b); };
  const tagOf = v => v && v.$t ? v.$t : typeof v === 'string' ? 8 : Array.isArray(v) ? 9 : typeof v === 'object' ? 10 : 3;
  function val(t, v){
    switch (t) {
      case 1: u8(v.v ?? v); return; case 2: i16(v.v ?? v); return; case 3: i32(v.v ?? v); return; case 4: i64(v.v ?? v); return;
      case 7: i32(v.v.length); parts.push(Buffer.from(v.v)); return;
      case 8: str(v); return;
      case 9: { const a = v.v || v, et = a.length ? tagOf(a[0]) : 1; u8(et); i32(a.length); for (const x of a) val(et, x); return; }
      case 10: { const o = v.v || v; for (const [k, x] of Object.entries(o)) { const tt = tagOf(x); u8(tt); str(k); val(tt, x); } u8(0); return; }
      case 11: i32(v.v.length); for (const x of v.v) i32(x); return;
      case 12: i32(v.v.length); for (const x of v.v) i64(x); return;
    }
  }
  return (name, obj) => { u8(10); str(name); val(10, obj); return Buffer.concat(parts); };
}
const B = v => ({ $t: 1, v }), S16 = v => ({ $t: 2, v }), I = v => ({ $t: 3, v }), BA = v => ({ $t: 7, v }), IA = v => ({ $t: 11, v }), LA = v => ({ $t: 12, v }), L = v => ({ $t: 9, v });
const nbt = (name, obj, le) => nbtW(le)(name, obj);
// упаковать индексы в long (как Minecraft): spanning — через границу long (до 1.16, litematic)
function pack(vals, bits, spanning){
  const per = Math.floor(64 / bits), n = spanning ? Math.ceil(vals.length * bits / 64) : Math.ceil(vals.length / per), out = new Array(n).fill(0n);
  vals.forEach((v, i) => {
    if (!spanning) { const li = Math.floor(i / per), sh = BigInt((i % per) * bits); out[li] |= BigInt(v) << sh; }
    else { const b0 = i * bits, li = Math.floor(b0 / 64), sh = b0 % 64; out[li] |= (BigInt(v) << BigInt(sh)) & 0xffffffffffffffffn; if (sh + bits > 64) out[li + 1] |= BigInt(v) >> BigInt(64 - sh); }
  });
  return out.map(x => BigInt.asIntN(64, x));
}
const varints = a => { const out = []; for (let v of a) { do { let b = v & 127; v >>>= 7; if (v) b |= 128; out.push(b); } while (v); } return out; };

(async () => {
  // ═══ 1. NBT и упаковка ═══
  sec('NBT, long-массивы, varint');
  const n1 = nbt('Test', { a: B(-5), b: S16(300), c: I(-70000), d: { $t: 4, v: 1234567890123 }, s: 'привет', l: L([I(1), I(2), I(3)]), ba: BA([1, 2, 255]), ia: IA([7, -8]), la: LA([1n, -1n]), o: { x: 'y' } });
  const r1 = MC.nbt(new Uint8Array(n1)).value;
  ok(r1.a === -5 && r1.b === 300 && r1.c === -70000 && r1.d === 1234567890123 && r1.s === 'привет' && r1.l.join() === '1,2,3' && r1.ba[2] === -1 && r1.ia[1] === -8 && r1.o.x === 'y', 'NBT Java: все теги', r1);
  const n1le = nbt('', { a: S16(-2), d: { $t: 4, v: -5 }, la: LA([3n]) }, true);
  const r1le = MC.nbtLE(new Uint8Array(n1le)).value;
  ok(r1le.a === -2 && r1le.d === -5 && r1le.la.longs[1] === 3 && r1le.la.longs[0] === 0, 'NBT Bedrock (little-endian)', [r1le.a, r1le.d, [...r1le.la.longs]]);
  const vals = Array.from({ length: 4096 }, (_, i) => (i * 7) % 37);
  for (const [bits, sp] of [[6, false], [6, true], [5, true], [4, false], [9, false], [9, true]]) {
    const longs = pack(vals.map(v => v % (1 << bits)), bits, sp), L32 = new Uint32Array(longs.length * 2);
    longs.forEach((x, i) => { const u = BigInt.asUintN(64, x); L32[i * 2] = Number(u >> 32n); L32[i * 2 + 1] = Number(u & 0xffffffffn); });
    const got = MC.bits(L32, bits, 4096, sp);
    ok(vals.every((v, i) => got[i] === v % (1 << bits)), `упаковка ${bits} бит, ${sp ? 'через границу' : 'без'}`);
  }
  const vi = MC.varints(new Uint8Array(varints([0, 1, 127, 128, 300, 70000])), 6);
  ok([...vi].join() === '0,1,127,128,300,70000', 'varint .schem', [...vi]);
  ok(MC.parseState('minecraft:oak_log[axis=x,foo=bar]').props.axis === 'x' && MC.stateStr('oak_log', { b: '1', a: '2' }) === 'minecraft:oak_log[a=2,b=1]', 'строка состояния');

  // ═══ 2. Постройки ═══
  sec('постройки');
  // .schem v2: 3×2×2, палитра
  const pal2 = { 'minecraft:air': I(0), 'minecraft:stone': I(1), 'minecraft:oak_log[axis=x]': I(2), 'minecraft:red_wool': I(3) };
  const data2 = []; for (let i = 0; i < 12; i++) data2.push(i % 4);
  const schem2 = zlib.gzipSync(nbt('Schematic', { Version: I(2), Width: S16(3), Height: S16(2), Length: S16(2), Palette: pal2, PaletteMax: I(4), BlockData: BA(varints(data2)) }));
  const b2 = await MC.readBuild('house.schem', new Uint8Array(schem2));
  ok(b2.w === 3 && b2.h === 2 && b2.l === 2 && b2.palette[2] === 'minecraft:oak_log[axis=x]' && b2.idx[5] === 1 && b2.idx[11] === 3, '.schem v2 (gzip)', { w: b2.w, p: b2.palette, i: [...b2.idx] });
  const schem3 = zlib.gzipSync(nbt('', { Schematic: { Version: I(3), Width: S16(2), Height: S16(1), Length: S16(1), Blocks: { Palette: { 'minecraft:glass': I(0), 'minecraft:bricks': I(1) }, Data: BA([1, 0]) } } }));
  const b3 = await MC.readBuild('a.schem', new Uint8Array(schem3));
  ok(b3.w === 2 && b3.palette[1] === 'minecraft:bricks' && b3.idx[0] === 1 && b3.idx[1] === 0, '.schem v3 (Blocks.Palette)', [...b3.idx]);
  // .schematic (MCEdit): камень, шерсть (35:14 красная), факел на стене (50:3 юг)
  const sch = zlib.gzipSync(nbt('Schematic', { Width: S16(3), Height: S16(1), Length: S16(1), Materials: 'Alpha', Blocks: BA([1, 35, 50]), Data: BA([0, 14, 3]) }));
  const bs = await MC.readBuild('old.schematic', new Uint8Array(sch));
  ok(bs.palette[bs.idx[0]] === 'minecraft:stone' && bs.palette[bs.idx[1]] === 'minecraft:red_wool' && bs.palette[bs.idx[2]] === 'minecraft:wall_torch[facing=south]', '.schematic (старые числа)', bs.palette);
  // .litematic: регион 2×2×2 с отрицательным размером по x
  const lp = [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }, { Name: 'minecraft:spruce_log', Properties: { axis: 'z' } }];
  const lvals = [1, 0, 2, 1, 0, 0, 2, 2];
  const lit = zlib.gzipSync(nbt('', { MinecraftDataVersion: I(3465), Version: I(6), Metadata: { Name: 'Башня' }, Regions: { main: { Position: { x: I(5), y: I(0), z: I(0) }, Size: { x: I(-2), y: I(2), z: I(2) }, BlockStatePalette: L(lp), BlockStates: LA(pack(lvals, 2, true)) } } }));
  const bl = await MC.readBuild('t.litematic', new Uint8Array(lit));
  ok(bl.w === 2 && bl.h === 2 && bl.l === 2 && bl.name === 'Башня' && bl.palette[bl.idx[0]] === 'minecraft:stone' && bl.palette[bl.idx[7]] === 'minecraft:spruce_log[axis=z]', '.litematic (регион, через границу long)', { p: bl.palette, i: [...bl.idx] });
  // .mcstructure (Bedrock, LE): 1×2×1, второй слой — вода
  const mcs = nbt('', { format_version: I(1), size: L([I(1), I(2), I(1)]), structure: { block_indices: L([L([I(0), I(-1)]), L([I(-1), I(1)])]), entities: L([]), palette: { default: { block_palette: L([{ name: 'minecraft:wool', states: { color: 'red' }, version: I(1) }, { name: 'minecraft:water', states: { liquid_depth: I(0) }, version: I(1) }]) } } }, structure_world_origin: L([I(0), I(0), I(0)]) }, true);
  const bm = await MC.readBuild('s.mcstructure', new Uint8Array(mcs));
  ok(bm.bedrock && bm.palette[bm.idx[0]].startsWith('minecraft:wool[color=red') && bm.palette[bm.idx[1]].startsWith('minecraft:water'), '.mcstructure (Bedrock, вода вторым слоем)', { p: bm.palette, i: [...bm.idx] });
  // .nbt (структура)
  const sn = zlib.gzipSync(nbt('', { size: L([I(2), I(1), I(1)]), palette: L([{ Name: 'minecraft:gold_block' }]), blocks: L([{ pos: L([I(1), I(0), I(0)]), state: I(0) }]), DataVersion: I(3465) }));
  const bn = await MC.readBuild('s.nbt', new Uint8Array(sn));
  ok(bn.idx[0] === bn.hole && bn.palette[bn.idx[1]] === 'minecraft:gold_block', '.nbt (структурный блок)', [...bn.idx]);

  // ═══ 3. Таблица блоков ═══
  sec('таблица блоков Minecraft → Кубомир');
  const R = s => MC.resolve(s), Rb = s => MC.resolve(s, { bedrock: true });
  ok(R('minecraft:stone').name === 'stone' && R('minecraft:grass_block[snowy=false]').name === 'grass' && R('minecraft:oak_planks').name === 'planks_oak', 'простые: камень, трава, доски');
  ok(R('minecraft:oak_log[axis=x]').st === 1 && R('minecraft:birch_log[axis=z]').st === 2 && R('minecraft:spruce_log[axis=y]').st === 0, 'ось бревна');
  ok(R('minecraft:wall_torch[facing=south]').st === 1 && R('minecraft:wall_torch[facing=east]').st === 4 && R('minecraft:torch').st === 0, 'факел на стене: сторона');
  ok(R('minecraft:ladder[facing=north]').st === 2 && R('minecraft:chest[facing=west]').st === 1 && R('minecraft:furnace[facing=east,lit=true]').name === 'furnace_lit', 'лестница, сундук, горящая печь');
  const dl = R('minecraft:oak_door[facing=north,half=lower,open=true]'), du = R('minecraft:oak_door[facing=north,half=upper,open=false]');
  ok(dl.name === 'door_oak' && dl.st === (0 | 4) && du.st === 8, 'дверь: сторона, открыта, верх', [dl, du]);
  ok(R('minecraft:oak_stairs[facing=east]').name === 'planks_oak' && R('minecraft:stone_brick_slab').name === 'stone_bricks' && R('minecraft:cobblestone_wall').name === 'cobble' && R('minecraft:oak_stairs').approx, 'ступени, плиты, стены — материалом');
  const rw = R('minecraft:red_wool');
  ok(rw.name === 'mc:red_wool' && rw.color === '#a12722', 'шерсть — свой цветной блок', rw);
  ok(R('minecraft:white_carpet').thin && R('minecraft:rail').name === 'air' && R('minecraft:oak_sign').thin, 'тонкое — пропуск');
  ok(R('minecraft:water[level=0]').name === 'water' && R('minecraft:water[level=3]').name === 'air' && R('minecraft:water[level=3]').flow, 'вода: источник — да, течение — нет');
  const unk = R('minecraft:totally_unknown_block');
  ok(unk.name === 'missing' && unk.unknown && unk.mc === 'totally_unknown_block', 'неизвестный — «missing» и в отчёт');
  ok(R('examplemod:ruby').name === 'missing', 'блок чужого мода без таблицы — «missing»');
  MC.extend({ 'examplemod:ruby': 'ruby-mod:ruby_block' });
  ok(R('examplemod:ruby').name === 'ruby-mod:ruby_block', 'таблица от мода (minecraft.blocks)');
  ok(Rb('minecraft:wool[color=red]').name === 'mc:red_wool' && Rb('minecraft:planks[wood_type=spruce]').name === 'planks_spruce' && Rb('minecraft:log[old_log_type=birch,pillar_axis=x]').st === 1, 'Bedrock: wool+color, planks+wood_type, log+pillar_axis');
  ok(Rb('minecraft:wall_torch[torch_facing_direction=north]').st === 3 || Rb('minecraft:torch[torch_facing_direction=north]').name === 'torch', 'Bedrock: факел');
  ok(Rb('minecraft:grass').name === 'grass' && Rb('minecraft:tallgrass').name === 'tall_grass' && Rb('minecraft:stained_hardened_clay[color=blue]').name === 'mc:blue_terracotta', 'Bedrock: grass, tallgrass, terracotta');
  ok(R('minecraft:glowstone').name === 'lamp' && R('minecraft:redstone_lamp[lit=true]').name === 'lamp' && R('minecraft:redstone_lamp[lit=false]').name === 'mc:redstone_lamp', 'светящиеся: светокамень, лампа');
  const L1 = MC.legacy(17, 4 | 2), L2 = MC.legacy(35, 11), L3 = MC.legacy(64, 8), L4 = MC.legacy(251, 4);
  ok(L1.name === 'birch_log' && L1.props.axis === 'x' && L2.name === 'blue_wool' && L3.props.half === 'upper' && L4.name === 'yellow_concrete', 'старые числовые id', [L1, L2, L3, L4]);
  const bd = MC.blockDef('mc:sea_lantern'), bd2 = MC.blockDef('mc:jungle_leaves'), bd3 = MC.blockDef('mc:lime_stained_glass');
  ok(bd.emit === 15 && bd.lcol && bd2.leaves && bd2.cut && bd3.glass && bd3.cut, 'цветные блоки: свет, листва, стекло', [bd, bd2, bd3]);
  const tab = MC._tables;
  ok(Object.keys(tab.COL).length > 250 && Object.values(tab.COL).every(c => /^#[0-9a-f]{6}$/.test(c)), 'цветов блоков ' + Object.keys(tab.COL).length, Object.keys(tab.COL).length);
  ok(Object.values(tab.B).every(v => { const n = typeof v === 'string' ? v : v.b; return n === 'air' || !!V.block(n); }), 'таблица ссылается только на настоящие блоки Кубомира');
  ok(MC.item('minecraft:iron_ingot') === 'iron_ingot' && MC.item('minecraft:cooked_beef') === 'meat_cooked' && MC.item('minecraft:diamond_pickaxe') === 'pick_diamond' && MC.item('minecraft:oak_planks') === 'planks_oak' && MC.item('minecraft:elytra') === null, 'предметы');
  ok(MC.tag('#minecraft:planks') === '#planks' && MC.tag('#c:ingots/iron') === 'iron_ingot' && MC.tag('#forge:rods/wooden') === 'stick', 'теги');

  // ═══ 4. Регион .mca ═══
  sec('регион Java (.mca)');
  // чанк 1.18+: раздел Y=0 (блоки 0…15) — камень снизу, воздух сверху, бревно в углу; раздел Y=4 — весь «лава»
  const st0 = Array.from({ length: 4096 }, (_, i) => { const y = i >> 8; return y < 3 ? 1 : 0; }); st0[(5 * 16 + 2) * 16 + 3] = 2;
  const chunk118 = nbt('', { DataVersion: I(3465), xPos: I(1), zPos: I(2), Status: 'minecraft:full', sections: L([
    { Y: B(0), block_states: { palette: L([{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }, { Name: 'minecraft:oak_log', Properties: { axis: 'x' } }]), data: LA(pack(st0, 4, false)) } },
    { Y: B(4), block_states: { palette: L([{ Name: 'minecraft:lava', Properties: { level: '0' } }]) } }]) });
  // чанк до 1.13: Blocks/Data
  const blk = new Array(4096).fill(0), dat = new Array(2048).fill(0); blk[0] = 35; dat[0] = 14; blk[1] = 1;
  const chunkOld = nbt('', { Level: { xPos: I(3), zPos: I(2), Sections: L([{ Y: B(0), Blocks: BA(blk), Data: BA(dat) }]) } });
  const region = Buffer.alloc(4096 * 8);
  const putChunk = (slot, sector, payload, type) => {
    const comp = type === 1 ? zlib.gzipSync(payload) : zlib.deflateSync(payload);
    region.writeUInt32BE((sector << 8) | 2, slot * 4);
    region.writeUInt32BE(comp.length + 1, sector * 4096); region[sector * 4096 + 4] = type; comp.copy(region, sector * 4096 + 5);
  };
  putChunk(1 + 2 * 32, 2, chunk118, 2);
  putChunk(3 + 2 * 32, 4, chunkOld, 1);
  const list = new Map();
  await MC.readRegion(new Uint8Array(region), 'r.0.0.mca', { listOnly: true, out: list });
  ok(list.size === 2 && list.has('1|2') && list.has('3|2'), 'список чанков региона', [...list.keys()]);
  const W1 = await MC.readRegion(new Uint8Array(region), 'r.0.0.mca', { yMin: 0, h: 128 });
  const c118 = W1.chunks.get('1|2'), cOld = W1.chunks.get('3|2');
  const at = (c, x, y, z) => c.palette[c.idx[(y * 16 + z) * 16 + x]];
  ok(c118 && at(c118, 0, 0, 0) === 'minecraft:stone' && at(c118, 0, 3, 0) === 'minecraft:air' && at(c118, 3, 5, 2) === 'minecraft:oak_log[axis=x]' && at(c118, 7, 70, 7).startsWith('minecraft:lava'), 'чанк 1.18: палитры разделов, длинные массивы', c118 && [at(c118, 0, 0, 0), at(c118, 3, 5, 2), at(c118, 7, 70, 7)]);
  ok(cOld && at(cOld, 0, 0, 0) === 'minecraft:red_wool' && at(cOld, 1, 0, 0) === 'minecraft:stone', 'чанк до 1.13 (числовые id)', cOld && [at(cOld, 0, 0, 0), at(cOld, 1, 0, 0)]);
  const W2 = await MC.readRegion(new Uint8Array(region), 'r.0.0.mca', { yMin: 2, h: 4, area: { x0: 16, z0: 32, x1: 31, z1: 47 } });
  ok(W2.chunks.size === 1 && at(W2.chunks.get('1|2'), 0, 0, 0) === 'minecraft:stone' && at(W2.chunks.get('1|2'), 0, 1, 0) === 'minecraft:air', 'область и окно по высоте');

  // ═══ 5. Bedrock LevelDB ═══
  sec('Bedrock (.mcworld: LevelDB)');
  // подчанк v9: один слой, 1 бит на блок (палитра: воздух, камень), камень в (x=1, z=0, y=0)
  const sub = (() => {
    const head = Buffer.from([9, 1, 0, (1 << 1) | 0]);
    const words = Buffer.alloc(128 * 4); const iStone = (1 << 8) | (0 << 4) | 0; words.writeUInt32LE(1 << (iStone % 32), Math.floor(iStone / 32) * 4);
    const pn = Buffer.alloc(4); pn.writeInt32LE(2);
    const p1 = nbt('', { name: 'minecraft:air', states: {}, version: I(1) }, true), p2 = nbt('', { name: 'minecraft:stone', states: { stone_type: 'stone' }, version: I(1) }, true);
    return Buffer.concat([head, words, pn, p1, p2]);
  })();
  const keyOf = (cx, cz, tag, y) => { const b = Buffer.alloc(10); b.writeInt32LE(cx); b.writeInt32LE(cz, 4); b[8] = tag; b[9] = y & 255; return b; };
  const vint = n => Buffer.from(varints([n]));
  // журнал: одна пачка (seq 5): ключ подчанка (2, -1, y 0) → sub
  const logBatch = (seq, recs) => { const hdr = Buffer.alloc(12); hdr.writeUInt32LE(seq, 0); hdr.writeUInt32LE(recs.length, 8); return Buffer.concat([hdr, ...recs.map(([k, v]) => Buffer.concat([Buffer.from([1]), vint(k.length), k, vint(v.length), v]))]); };
  const logFile = b => { const h = Buffer.alloc(7); h.writeUInt16LE(b.length, 4); h[6] = 1; return Buffer.concat([h, b]); };
  const log = logFile(logBatch(5, [[keyOf(2, -1, 0x2f, 0), sub]]));
  // таблица .ldb: блок данных (ключ + 8 байт номера/типа), индекс, футер; блоки сжаты raw deflate (тип 4)
  function sstable(entries){
    const blk = Buffer.concat([...entries.map(([k, v]) => Buffer.concat([vint(0), vint(k.length), vint(v.length), k, v])), Buffer.from([0, 0, 0, 0, 1, 0, 0, 0])]);
    const comp = zlib.deflateRawSync(blk), dataBlock = Buffer.concat([comp, Buffer.from([4, 0, 0, 0, 0])]);
    const handle = Buffer.concat([vint(0), vint(comp.length)]);
    const idx = Buffer.concat([vint(0), vint(entries[entries.length - 1][0].length), vint(handle.length), entries[entries.length - 1][0], handle, Buffer.from([0, 0, 0, 0, 1, 0, 0, 0])]);
    const idxBlock = Buffer.concat([idx, Buffer.from([0, 0, 0, 0, 0])]);
    const metaOff = dataBlock.length + idxBlock.length, metaBlock = Buffer.concat([Buffer.from([0, 0, 0, 0, 1, 0, 0, 0]), Buffer.from([0, 0, 0, 0, 0])]);
    const foot = Buffer.alloc(48); const fh = Buffer.concat([vint(metaOff), vint(8), vint(dataBlock.length), vint(idx.length)]); fh.copy(foot); foot.writeUInt32LE(0x8b80fb57, 40); foot.writeUInt32LE(0xdb477524, 44);
    return Buffer.concat([dataBlock, idxBlock, metaBlock, foot]);
  }
  const ik = (k, seq) => { const t = Buffer.alloc(8); t.writeBigUInt64LE((BigInt(seq) << 8n) | 1n); return Buffer.concat([k, t]); };
  const ldb = sstable([[ik(keyOf(0, 0, 0x2f, 4), 3), sub]]);   // чанк (0, 0), подчанк y 4, номер записи 3
  const levelDat = Buffer.concat([Buffer.alloc(8), nbt('', { SpawnX: I(5), SpawnY: I(70), SpawnZ: I(-3) }, true)]);
  const mw = await MC.readMcworld({ 'db/000005.ldb': new Uint8Array(ldb), 'db/000006.log': new Uint8Array(log), 'level.dat': new Uint8Array(levelDat) }, { yMin: 0, h: 128 });
  const bc = mw.chunks.get('2|-1'), bc2 = mw.chunks.get('0|0');
  ok(bc && at(bc, 1, 0, 0) === 'minecraft:stone[stone_type=stone]' && at(bc, 0, 0, 0) === 'minecraft:air', 'журнал LevelDB: подчанк v9', bc && [at(bc, 1, 0, 0)]);
  ok(bc2 && at(bc2, 1, 64, 0) === 'minecraft:stone[stone_type=stone]', 'таблица .ldb (raw deflate): подчанк на высоте 64', bc2 && at(bc2, 1, 64, 0));
  ok(mw.spawn && mw.spawn.x === 5 && mw.spawn.z === -3, 'точка появления из level.dat', mw.spawn);
  ok(MC.resolve(at(bc, 1, 0, 0), { bedrock: true }).name === 'stone', 'Bedrock stone[stone_type] → камень');

  // ═══ 6. Zip ═══
  sec('zip');
  const zStore = V.mods.zip({ 'a/b.txt': 'hello', 'c.json': '{"x":1}' });
  const uz = await MC.unzip(zStore);
  ok(new TextDecoder().decode(uz['a/b.txt']) === 'hello' && JSON.parse(new TextDecoder().decode(uz['c.json'])).x === 1, 'zip без сжатия');
  // zip со сжатием deflate (собран тут)
  const mkZip = files => {
    const parts = [], cen = []; let off = 0;
    for (const [n, d] of Object.entries(files)) {
      const nm = Buffer.from(n), raw = Buffer.from(d), comp = zlib.deflateRawSync(raw), crc = zlib.crc32 ? zlib.crc32(raw) : 0;
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
      parts.push(h, nm, comp);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      cen.push(c, nm); off += 30 + nm.length + comp.length;
    }
    const cs = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cs.length, 12); e.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...parts, cs, e]));
  };
  const zDef = mkZip({ 'x/y.json': '{"ok":true}', 'big.txt': 'a'.repeat(5000) });
  const uz2 = await MC.unzip(zDef, p => p !== 'big.txt');
  ok(JSON.parse(new TextDecoder().decode(uz2['x/y.json'])).ok === true && !uz2['big.txt'], 'zip deflate + отбор файлов');

  // ═══ 7. .mcfunction → JS (выполняем на поддельном API) ═══
  sec('.mcfunction → JS');
  const funcs = new Map([
    ['demo:build', 'say Привет из функции\n# комментарий\nsetblock ~1 ~ ~ minecraft:stone\nfill ~ ~1 ~ ~1 ~1 ~1 minecraft:oak_planks\ngive @p minecraft:diamond 3\ntp @s 10 64 -5\nscoreboard objectives add pts dummy\nscoreboard players add @p pts 5\nexecute if score @p pts matches 5.. run say пять очков\nexecute positioned 100 60 100 run setblock ~ ~ ~ minecraft:gold_block\nfunction demo:inner\nweather clear\nsummon minecraft:zombie ~ ~ ~5'],
    ['demo:inner', 'execute if block ~1 ~ ~ minecraft:stone run say камень на месте\nsetblock 0 0 0 minecraft:red_wool keep'],
    ['demo:tick', 'scoreboard players add @p ticks 1'],
  ]);
  const fj = MC.fnToJs(funcs, { tick: ['demo:tick'], load: ['demo:build'] });
  ok(fj.report.unsupported.weather === 1 && fj.report.ok >= 12, '.mcfunction: команды переведены, weather — в отчёт', fj.report);
  const W0 = new Map(), msgs = [], gives = [], tps = [], spawns = [], cmds = {}, evs = {}, store = {};
  const api = {
    mod: { on: (e, f) => { evs[e] = f; }, storage: { get: k => store[k], set: (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); } }, log: m => msgs.push('log:' + m) },
    world: { get: (x, y, z) => W0.get(x + ',' + y + ',' + z) || 'air', set: (x, y, z, n) => { W0.set(x + ',' + y + ',' + z, n); return true; } },
    player: { x: 0.5, y: 64, z: 0.5, message: m => msgs.push(m), give: (i, n) => gives.push([i, n]), teleport: (x, y, z) => tps.push([x, y, z]) },
    fx: { particles(){}, sound(){} }, game: { spawn: (m, x, y, z) => spawns.push([m, x, y, z]) }, npc: {}, commands: { add: (n, d, f) => { cmds[n] = f; } },
  };
  new Function('mod', 'world', 'fx', 'npc', 'commands', 'player', 'game', '"use strict";\n' + fj.code)(api.mod, api.world, api.fx, api.npc, api.commands, api.player, api.game);
  evs.start();
  ok(msgs.includes('Привет из функции') && W0.get('1,64,0') === 'stone' && W0.get('0,65,0') === 'planks_oak' && W0.get('1,65,1') === 'planks_oak', 'say, setblock ~, fill', [...W0]);
  ok(gives.length === 1 && gives[0][0] === 'diamond' && gives[0][1] === 3 && tps[0].join() === '10,64,-5', 'give, tp', [gives, tps]);
  ok(msgs.includes('пять очков') && W0.get('100,60,100') === 'gold_block' && msgs.includes('камень на месте') && W0.get('0,0,0') === 'mc:red_wool', 'scoreboard + execute if score / positioned / if block, function, setblock keep', msgs);
  ok(spawns.length === 1 && spawns[0][0] === 'zombie' && spawns[0][3] === 5, 'summon зомби');
  evs.tick(); evs.tick();
  ok(store.sb && store.sb.ticks === 2 && store.sb.pts === 5, 'tick-функции и счёт в хранилище мира', store);
  ok(typeof cmds.function === 'function' && typeof cmds.build === 'function', 'команды /function и /build');

  // ═══ 8. Пакет данных ═══
  sec('пакет данных Java');
  const te = s => new TextEncoder().encode(s);
  const dp = {
    'pack.mcmeta': te(JSON.stringify({ pack: { pack_format: 48, description: 'Тестовый пакет' } })),
    'data/test/recipe/diamond.json': te(JSON.stringify({ type: 'minecraft:crafting_shaped', pattern: ['DD', 'DD'], key: { D: { item: 'minecraft:dirt' } }, result: { id: 'minecraft:diamond', count: 2 } })),
    'data/test/recipe/sticks.json': te(JSON.stringify({ type: 'minecraft:crafting_shapeless', ingredients: [{ tag: 'minecraft:planks' }, 'minecraft:cobblestone'], result: { item: 'minecraft:stick', count: 8 } })),
    'data/test/recipe/glass.json': te(JSON.stringify({ type: 'minecraft:smelting', ingredient: { item: 'minecraft:gravel' }, result: 'minecraft:glass', cookingtime: 100 })),
    'data/test/recipe/elytra.json': te(JSON.stringify({ type: 'minecraft:crafting_shaped', pattern: ['X'], key: { X: { item: 'minecraft:phantom_membrane' } }, result: { item: 'minecraft:elytra' } })),
    'data/test/function/hello.mcfunction': te('say hi\nsetblock ~ ~-1 ~ minecraft:stone'),
    'data/minecraft/tags/function/load.json': te(JSON.stringify({ values: ['test:hello'] })),
  };
  const dpo = MC.datapack(dp, 'test-pack.zip');
  const dm = dpo.mods[0], dv = V.mods.validate(dm.files['mod.json'], dm.files);
  ok(dv.ok, 'пакет данных → мод проходит проверку', dv.errors);
  ok(dpo.report.recipes === 3 && dpo.report.skipped.some(s => /elytra|phantom/.test(s)) && dpo.report.functions === 1, 'рецепты (3 из 4), функции', dpo.report);
  ok(dv.ok && dv.m.recipes.some(r => r.out === 'diamond' && r.pattern) && dv.m.recipes.some(r => r.out === 'stick' && r.list?.includes('#planks')) && dv.m.recipes.some(r => r.smelt && r.input === 'gravel' && r.out === 'glass'), 'рецепты в формате Кубомира (по форме, без формы, печь)', dv.m?.recipes);

  // ═══ 9. Мод Java (.jar, только данные) ═══
  sec('мод Java (.jar)');
  const PNG = new Uint8Array(zlib.deflateSync(Buffer.alloc(10)));   // для проверки содержимое не важно
  const jar = {
    'fabric.mod.json': te(JSON.stringify({ id: 'rubymod', name: 'Ruby Mod', version: '1.2.3', authors: ['Alex'], description: 'Rubies' })),
    'assets/rubymod/lang/en_us.json': te(JSON.stringify({ 'block.rubymod.ruby_block': 'Block of Ruby', 'item.rubymod.ruby': 'Ruby', 'block.rubymod.ruby_lamp': 'Ruby Lamp' })),
    'assets/rubymod/lang/ru_ru.json': te(JSON.stringify({ 'block.rubymod.ruby_block': 'Рубиновый блок' })),
    'assets/rubymod/blockstates/ruby_block.json': te(JSON.stringify({ variants: { '': { model: 'rubymod:block/ruby_block' } } })),
    'assets/rubymod/models/block/ruby_block.json': te(JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'rubymod:block/ruby_block' } })),
    'assets/rubymod/textures/block/ruby_block.png': PNG,
    'assets/rubymod/blockstates/ruby_log.json': te(JSON.stringify({ variants: { 'axis=x': { model: 'rubymod:block/ruby_log_h' }, 'axis=y': { model: 'rubymod:block/ruby_log' } } })),
    'assets/rubymod/models/block/ruby_log.json': te(JSON.stringify({ parent: 'block/cube_column', textures: { end: 'rubymod:block/ruby_log_top', side: 'rubymod:block/ruby_log' } })),
    'assets/rubymod/textures/block/ruby_log.png': PNG, 'assets/rubymod/textures/block/ruby_log_top.png': PNG,
    'assets/rubymod/blockstates/ruby_lamp.json': te(JSON.stringify({ variants: { 'lit=false': { model: 'rubymod:block/ruby_lamp' } } })),
    'assets/rubymod/models/block/ruby_lamp.json': te(JSON.stringify({ parent: 'block/cube_all', textures: { all: 'rubymod:block/ruby_lamp' } })),
    'assets/rubymod/textures/block/ruby_lamp.png': PNG,
    'assets/rubymod/blockstates/ruby_flower.json': te(JSON.stringify({ variants: { '': { model: 'rubymod:block/ruby_flower' } } })),
    'assets/rubymod/models/block/ruby_flower.json': te(JSON.stringify({ parent: 'block/cross', textures: { cross: 'rubymod:block/ruby_flower' } })),
    'assets/rubymod/textures/block/ruby_flower.png': PNG,
    'assets/rubymod/blockstates/stone_thing.json': te(JSON.stringify({ variants: { '': { model: 'rubymod:block/stone_thing' } } })),
    'assets/rubymod/models/block/stone_thing.json': te(JSON.stringify({ parent: 'block/cube_all', textures: { all: 'minecraft:block/stone' } })),
    'assets/rubymod/models/item/ruby.json': te(JSON.stringify({ parent: 'item/generated', textures: { layer0: 'rubymod:item/ruby' } })),
    'assets/rubymod/textures/item/ruby.png': PNG,
    'assets/rubymod/models/item/ruby_pickaxe.json': te(JSON.stringify({ parent: 'item/handheld', textures: { layer0: 'rubymod:item/ruby_pickaxe' } })),
    'assets/rubymod/textures/item/ruby_pickaxe.png': PNG,
    'assets/rubymod/models/item/ruby_block.json': te(JSON.stringify({ parent: 'rubymod:block/ruby_block' })),
    'data/rubymod/recipe/ruby_block.json': te(JSON.stringify({ type: 'minecraft:crafting_shaped', pattern: ['RRR', 'RRR', 'RRR'], key: { R: { item: 'rubymod:ruby' } }, result: { id: 'rubymod:ruby_block', count: 1 } })),
    'data/rubymod/recipe/ruby_pickaxe.json': te(JSON.stringify({ type: 'minecraft:crafting_shaped', pattern: ['RRR', ' S ', ' S '], key: { R: 'rubymod:ruby', S: { tag: 'c:rods/wooden' } }, result: { id: 'rubymod:ruby_pickaxe' } })),
    'data/rubymod/loot_table/blocks/ruby_block.json': te(JSON.stringify({ pools: [{ entries: [{ type: 'minecraft:alternatives', children: [{ type: 'minecraft:item', name: 'rubymod:ruby_block', conditions: [{}] }, { type: 'minecraft:item', name: 'rubymod:ruby' }] }] }] })),
    'data/minecraft/tags/block/mineable/pickaxe.json': te(JSON.stringify({ values: ['rubymod:ruby_block'] })),
    'data/minecraft/tags/block/needs_iron_tool.json': te(JSON.stringify({ values: ['rubymod:ruby_block'] })),
  };
  const jo = MC.jar(jar, 'rubymod-1.2.3.jar', { classes: 42 });
  ok(jo.mods.length === 1 && jo.report.blocks === 5 && jo.report.items === 2 && jo.report.recipes === 2, 'блоки, предметы, рецепты', jo.report);
  const jm = jo.mods[0], jv = V.mods.validate(jm.files['mod.json'], jm.files);
  ok(jv.ok, 'мод .jar → проходит проверку общего формата', jv.errors);
  if (jv.ok) {
    const b = n => jv.m.blocks.find(x => x.name === 'rubymod:' + n);
    ok(b('ruby_block').title === 'Рубиновый блок' && b('ruby_block').tool === 'pick' && b('ruby_block').tier === 3 && b('ruby_block').drop === 'rubymod:ruby', 'перевод ru_ru, тег mineable/needs_iron_tool, добыча (без шёлка — рубин)', b('ruby_block'));
    ok(b('ruby_log').axis && b('ruby_log').tex.top === 'rubymod:ruby_log_top', 'бревно: торцы и ось', b('ruby_log'));
    ok(b('ruby_lamp').emit === 15 && b('ruby_flower').shape === 2, 'лампа светится (по имени), цветок — крест');
    ok(b('stone_thing').tex === 'stone', 'ванильная картинка — своя текстура «Кубомира»', b('stone_thing').tex);
    const pk = jv.m.items.find(x => x.name === 'rubymod:ruby_pickaxe');
    ok(pk && pk.tool && pk.tool.kind === 'pick', 'кирка — инструмент по имени', pk);
    ok(jv.m.recipes.some(r => r.out === 'rubymod:ruby_block') && jv.m.recipes.some(r => r.out === 'rubymod:ruby_pickaxe' && Object.values(r.key).includes('stick')), 'рецепты со своими предметами и тегом c:rods/wooden');
  }
  ok(jo.report.notes.some(n => /42 файлов \.class/.test(n)), 'отчёт: код мода не запускается', jo.report.notes);
  // большой мод — на части
  const big = { 'fabric.mod.json': te(JSON.stringify({ id: 'bigmod', name: 'Big', version: '1.0' })) };
  for (let i = 0; i < 150; i++) {
    big[`assets/bigmod/blockstates/b${i}.json`] = te(JSON.stringify({ variants: { '': { model: `bigmod:block/b${i}` } } }));
    big[`assets/bigmod/models/block/b${i}.json`] = te(JSON.stringify({ parent: 'block/cube_all', textures: { all: `bigmod:block/b${i}` } }));
    big[`assets/bigmod/textures/block/b${i}.png`] = PNG;
  }
  big['data/bigmod/recipe/x.json'] = te(JSON.stringify({ type: 'minecraft:crafting_shapeless', ingredients: ['bigmod:b0', 'bigmod:b149'], result: { id: 'bigmod:b75' } }));
  const bo = MC.jar(big, 'big.jar');
  const bvs = bo.mods.map(m => V.mods.validate(m.files['mod.json'], m.files));
  ok(bo.mods.length === 3 && bvs.every(v => v.ok) && bo.mods.map(m => m.manifest.id).join() === 'bigmod,bigmod-2,bigmod-3', '150 блоков → 3 части по ≤ 64, все проходят проверку', bvs.map(v => v.errors.slice(0, 2)));
  // рецепт лежит в части с результатом; каждая ссылка «часть:имя» — на ту часть, где этот блок на самом деле
  const partOf = n => bo.mods.find(m => m.manifest.blocks.some(b => b.id === n))?.manifest.id;
  const rp0 = bvs.map(v => v.ok && v.m.recipes[0]).find(Boolean);
  ok(rp0 && rp0.out === partOf('b75') + ':b75' && rp0.list.includes(partOf('b0') + ':b0') && rp0.list.includes(partOf('b149') + ':b149'), 'ссылки между частями — полными именами нужной части', rp0);

  // ═══ 10. Дополнение Bedrock ═══
  sec('дополнение Bedrock (.mcaddon)');
  const addon = {
    'BP/manifest.json': te(JSON.stringify({ format_version: 2, header: { name: 'Ruby Addon', description: 'test', uuid: 'a', version: [1, 0, 2] }, modules: [{ type: 'data', uuid: 'b', version: [1, 0, 0] }, { type: 'script', language: 'javascript', entry: 'scripts/main.js', uuid: 'c', version: [1, 0, 0] }] })),
    'BP/blocks/ruby.json': te(JSON.stringify({ format_version: '1.20.80', 'minecraft:block': { description: { identifier: 'ra:ruby_ore' }, components: { 'minecraft:destructible_by_mining': { seconds_to_destroy: 3 }, 'minecraft:light_emission': 7, 'minecraft:material_instances': { '*': { texture: 'ruby_ore', render_method: 'opaque' } }, 'minecraft:loot': 'loot_tables/blocks/ruby_ore.json' } } })),
    'BP/loot_tables/blocks/ruby_ore.json': te(JSON.stringify({ pools: [{ rolls: 1, entries: [{ type: 'item', name: 'ra:ruby' }] }] })),
    'BP/items/ruby.json': te('// комментарий\n' + JSON.stringify({ format_version: '1.20.80', 'minecraft:item': { description: { identifier: 'ra:ruby' }, components: { 'minecraft:icon': 'ruby', 'minecraft:max_stack_size': 32 } } })),
    'BP/items/apple_pie.json': te(JSON.stringify({ 'minecraft:item': { description: { identifier: 'ra:apple_pie' }, components: { 'minecraft:icon': { texture: 'apple_pie' }, 'minecraft:food': { nutrition: 6, saturation_modifier: 0.5 } } } })),
    'BP/recipes/pie.json': te(JSON.stringify({ format_version: '1.12', 'minecraft:recipe_shapeless': { description: { identifier: 'ra:pie' }, tags: ['crafting_table'], ingredients: [{ item: 'minecraft:apple' }, { item: 'ra:ruby', count: 2 }], result: { item: 'ra:apple_pie' } } })),
    'BP/recipes/smelt.json': te(JSON.stringify({ 'minecraft:recipe_furnace': { description: { identifier: 'ra:smelt' }, tags: ['furnace'], input: 'ra:ruby_ore', output: 'ra:ruby' } })),
    'BP/functions/hello.mcfunction': te('say Привет, Bedrock!\nsetblock ~ ~ ~ ra:ruby_ore'),
    'BP/functions/tick.json': te(JSON.stringify({ values: ['hello'] })),
    'BP/entities/x.json': te('{}'),
    'BP/scripts/main.js': te("import { world, system } from '@minecraft/server';\nimport { greet } from './util.js';\nworld.afterEvents.playerBreakBlock.subscribe(ev => {\n  ev.player.sendMessage(greet(ev.brokenBlockPermutation.type.id));\n  const b = ev.dimension.getBlock({ x: ev.block.x, y: ev.block.y + 1, z: ev.block.z });\n  if (b && b.isAir) b.setType('minecraft:glowstone');\n  const o = world.scoreboard.getObjective('mined') || world.scoreboard.addObjective('mined', 'Mined');\n  o.addScore(ev.player, 1);\n});\nsystem.runTimeout(() => world.sendMessage('ready'), 1);\n"),
    'BP/scripts/util.js': te("export function greet(id){ return 'сломан ' + id; }\nexport const N = 5;\n"),
    'RP/manifest.json': te(JSON.stringify({ format_version: 2, header: { name: 'Ruby RP', uuid: 'd', version: [1, 0, 0] }, modules: [{ type: 'resources', uuid: 'e', version: [1, 0, 0] }] })),
    'RP/textures/terrain_texture.json': te(JSON.stringify({ resource_pack_name: 'r', texture_data: { ruby_ore: { textures: 'textures/blocks/ruby_ore' } } })),
    'RP/textures/item_texture.json': te(JSON.stringify({ texture_data: { ruby: { textures: 'textures/items/ruby' }, apple_pie: { textures: ['textures/items/apple_pie'] } } })),
    'RP/textures/blocks/ruby_ore.png': PNG, 'RP/textures/items/ruby.png': PNG, 'RP/textures/items/apple_pie.png': PNG, 'RP/textures/blocks/stone.png': PNG,
    'RP/texts/en_US.lang': te('tile.ra:ruby_ore.name=Ruby Ore\nitem.ra:ruby=Ruby\npack.name=Рубины\n'),
  };
  const ao = MC.addon(addon, 'ruby.mcaddon');
  const am = ao.mods[0], av = V.mods.validate(am.files['mod.json'], am.files);
  ok(av.ok, 'дополнение → мод проходит проверку', av.errors);
  ok(ao.report.blocks === 1 && ao.report.items === 2 && ao.report.recipes === 2 && ao.report.functions === 1 && ao.report.scripts === 1, 'блок, 2 предмета, 2 рецепта, функция, скрипт', ao.report);
  if (av.ok) {
    const ore = av.m.blocks[0];
    ok(ore.title === 'Ruby Ore' && ore.emit === 7 && ore.drop === 'ruby-addon:ruby' && Math.abs(ore.hard - 2 * 1.5 * .015 * 66.7 / 1.5) < .3, 'блок: имя из .lang, свет, добыча, прочность', ore);
    const pie = av.m.items.find(x => x.name.endsWith(':apple_pie'));
    ok(pie && pie.food && pie.food.h === 6, 'еда: nutrition', pie);
    ok(av.m.recipes.some(r => r.smelt && r.out.endsWith(':ruby')), 'рецепт печи');
  }
  ok(ao.respack && ao.respack.tex.stone, 'пакет ресурсов дополнения — картинки ванили (stone)', ao.respack && Object.keys(ao.respack.tex));
  ok(ao.report.notes.some(n => /существа/.test(n)), 'отчёт: существа не переносятся');
  // скрипт @minecraft/server: выполнить на поддельном API
  const scr = am.files[am.manifest.scripts.find(s => /mcserver/.test(s.file)).file];
  const W3 = new Map([['3,10,4', 'air']]), m3 = [], ev3 = {}, st3 = {};
  const api3 = {
    mod: { on: (e, f) => { (ev3[e] = ev3[e] || []).push(f); }, storage: { get: k => st3[k], set: (k, v) => { st3[k] = JSON.parse(JSON.stringify(v)); } }, log: x => m3.push('log:' + x) },
    world: { get: (x, y, z) => W3.get(x + ',' + y + ',' + z) || 'stone', set: (x, y, z, n) => { W3.set(x + ',' + y + ',' + z, n); return true; } },
    player: { name: 'Денчик', x: 1, y: 2, z: 3, health: 20, message: t => m3.push(t), give(){}, teleport(){}, hurt(){}, heal(){}, sneaking: false },
    fx: { particles(){}, sound(){} }, game: { time: .5, day: 1, spawn(){} }, npc: {}, commands: { add(){} },
  };
  let threw = null;
  try { new Function('mod', 'world', 'fx', 'npc', 'commands', 'player', 'game', '"use strict";\n' + scr)(api3.mod, api3.world, api3.fx, api3.npc, api3.commands, api3.player, api3.game); } catch (e) { threw = e; }
  ok(!threw, 'скрипт собран и запускается', threw && threw.message);
  if (!threw) {
    ev3.blockBreak[0]({ x: 3, y: 9, z: 4, block: 'ruby-addon:ruby_ore' });
    ok(m3.includes('сломан ra:ruby_ore') && W3.get('3,10,4') === 'lamp' && st3['mc:scores'].mined['Денчик'] === 1, 'playerBreakBlock: сообщение (import из ./util.js), getBlock/setType, scoreboard', [m3, [...W3], st3]);
    await new Promise(r => setTimeout(r, 120));
    ok(m3.includes('ready'), 'system.runTimeout → world.sendMessage', m3);
  }
  // ═══ 11. Пакет текстур ═══
  sec('пакет текстур');
  const rpj = MC.respack({ 'pack.mcmeta': te(JSON.stringify({ pack: { description: 'Мой пакет' } })), 'assets/minecraft/textures/block/stone.png': PNG, 'assets/minecraft/textures/block/oak_planks.png': PNG, 'assets/minecraft/textures/block/red_wool.png': PNG, 'assets/minecraft/textures/item/diamond_pickaxe.png': PNG, 'assets/minecraft/textures/block/water_still.png': PNG }, 'p.zip');
  ok(rpj.tex.stone && rpj.tex.planks_oak && rpj.tex.item_pick_diamond && rpj.tex.water && rpj.mc.red_wool && rpj.count === 5 && rpj.name === 'Мой пакет', 'Java: блоки, предметы, вода, цветные «mc:» блоки', Object.keys(rpj.tex));
  const rpb = MC.respack({ 'manifest.json': te(JSON.stringify({ header: { name: 'BR' }, modules: [{ type: 'resources' }] })), 'textures/blocks/planks_oak.png': PNG, 'textures/blocks/cobblestone.png': PNG }, 'b.mcpack');
  ok(rpb.bedrock && rpb.tex.planks_oak && rpb.tex.cobble, 'Bedrock: textures/blocks', Object.keys(rpb.tex));
  ok(MC.kindOfZip(jar, 'x.jar') === 'jar' && MC.kindOfZip(dp, 'x.zip') === 'datapack' && MC.kindOfZip(addon, 'a.mcaddon') === 'addon' && MC.kindOfZip({ 'region/r.0.0.mca': PNG, 'level.dat': PNG }, 'w.zip') === 'javaworld' && MC.kindOfZip({ 'assets/minecraft/textures/block/stone.png': PNG }, 'p.zip') === 'respack', 'что в архиве: мод, пакет данных, дополнение, мир, текстуры');

  // ═══ 12. Языки модов: крючок «java» ═══
  sec('языки скриптов модов');
  const mj = V.mods.validate({ id: 'jtest', name: 'J', version: '1.0.0', game: 'voxel', scripts: [{ file: 'Main.java' }, { file: 'a.lua' }, { code: 'mod.log(1)' }] }, { 'Main.java': 'class Main {}', 'a.lua': 'print(1)' });
  ok(mj.ok && mj.m.scripts.map(s => s.lang).join() === 'java,lua,js' && V.MOD_LANGS.java === 'js/engine/lang-java.js', 'скрипты .java принимаются (язык java — крючок V.MOD_LANGS)', mj.errors);
  const mbad = V.mods.validate({ id: 'jtest', name: 'J', version: '1.0.0', game: 'voxel', scripts: [{ code: 'x', lang: 'cobol' }] }, {});
  ok(!mbad.ok && /lang/.test(mbad.errors[0]), 'неизвестный язык — ошибка', mbad.errors);
  const mmap = V.mods.validate({ id: 'mtest', name: 'M', version: '1.0.0', game: 'voxel', blocks: [{ id: 'gem' }], minecraft: { blocks: { 'gemmod:gem_block': 'gem', 'bad key': 'x' } } }, {});
  ok(mmap.ok && mmap.m.mcMap['gemmod:gem_block'] === 'mtest:gem' && Object.keys(mmap.m.mcMap).length === 1, 'поле «minecraft» в mod.json → таблица блоков', mmap.m && mmap.m.mcMap);

  console.log(`\nmc-import-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

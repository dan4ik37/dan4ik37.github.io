// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — мир из кубиков («Кубомир»): блоки и вещи, чанки, мир, луч, столкновения, рецепты
// ═══════════════════════════════════════
// Без Three.js и DOM: работает в окне, в потоке (Worker — генерация, свет, сетки) и в node (scripts/voxel-test.cjs).
// Единицы: 1 блок = 1 единица. Чанк — столбик 16×16 высотой V.H = 128; ячейка — Uint16: младшие 12 бит — вид блока,
// старшие 4 — состояние (уровень воды, сторона двери/лестницы/печи, ось бревна, открыто/закрыто…).
// Номер ячейки в чанке: (x << 11) | (z << 7) | y — столбик y подряд (так быстро копировать области для потоков).
// Ключ чанка — число: (cx + 32768) * 65536 + (cz + 32768) (мир ±524 288 блоков по x и z — «бесконечный»).
// Реестр: V.block(имя) / V.item(имя) — свои блоки модов дописываются V.defineBlock / V.defineItem (voxel-mods.js),
// потом V.compile() — таблицы для сетки и света (их же получают потоки). Ваниль — номера 0…N постоянны (сохранения);
// у каждого мира своя «палитра» номер → имя (сохранения модовых блоков не съезжают при смене модов).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  V.VERSION = 1;
  const H = V.H = 128, SH = 7;                 // высота мира, log2(H)
  V.CS = 16; V.SEA = 52;
  V.CELLS = 16 * 16 * H;
  V.idx = (x, y, z) => (x << 11) | (z << 7) | y;
  V.key = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
  V.keyX = k => Math.floor(k / 65536) - 32768;
  V.keyZ = k => (k % 65536) - 32768;
  V.LIMIT = 500000;                             // дальше — край мира (за ним не генерируем)
  const TYPE = 0xfff;
  V.type = v => v & TYPE;
  V.state = v => v >>> 12;
  V.cell = (type, state = 0) => (type & TYPE) | ((state & 15) << 12);

  // ── Случайности без Math.random (одинаково в любом браузере): хэш и генератор ──
  const imul = Math.imul;
  V.hash = (a, b = 0, c = 0, d = 0) => {
    let h = (a | 0) ^ imul(b | 0, 0x27d4eb2d) ^ imul(c | 0, 0x165667b1) ^ imul(d | 0, 0x9e3779b1);
    h = imul(h ^ (h >>> 15), 0x85ebca6b); h = imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  };
  V.rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = imul(t ^ (t >>> 15), t | 1); t ^= t + imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  // строка → 32 бита (зерно мира из текста)
  V.seedOf = s => { if (typeof s === 'number' && Number.isFinite(s)) return s >>> 0; const t = String(s ?? ''); if (/^-?\d{1,10}$/.test(t)) return (+t) >>> 0; let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = imul(h, 16777619); } return h >>> 0; };

  // ═══ Формы (как рисовать) и слои (каким материалом) ═══
  const SHAPE = V.SHAPE = { none: 0, cube: 1, cross: 2, liquid: 3, torch: 4, ladder: 5, door: 6, cactus: 7, chest: 8 };
  const LAYER = V.LAYER = { none: 0, solid: 1, cutout: 2, water: 3 };
  const TINT = V.TINT = { none: 0, grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5 };

  // ═══ Текстуры: имя → слой. Рисует voxel-tex.js (кодом, без картинок); моды — PNG или «рисунок» ═══
  V.tex = [];          // [{ name, spec }]
  V.texIdx = new Map();
  V.texture = (name, spec) => { if (V.texIdx.has(name)) { if (spec) V.tex[V.texIdx.get(name)].spec = spec; return V.texIdx.get(name); } V.texIdx.set(name, V.tex.length); V.tex.push({ name, spec: spec || null }); return V.tex.length - 1; };

  // ═══ Блоки ═══
  // Поля: name, title, shape, layer, solid (сталкиваемся), opaque (закрывает соседние грани и свет), op (сколько света
  // съедает 0…15), emit (светит 0…15), tex (имя или { top, bottom, side, front }), tint, hard (секунды «рукой»; -1 — нельзя),
  // tool ('pick' | 'axe' | 'shovel'), tier (какая кирка нужна, чтобы выпал: 1 дерево … 4 алмаз), drop (имя вещи,
  // null — ничего), sound, replace (можно поставить поверх), fall (падает), liquid, climb, ui ('craft'|'chest'|'furnace'),
  // bounce (подбрасывает: скорость), hurt (урон в секунду при касании), mod (чей); свет: emit — яркость 0…15, lcol [r, g, b] — цвет
  // 0…1 (нет — тёплый белый), glowTex — какие текстуры светятся сами (нет — все грани светящегося блока), glow: false — сам не светится
  V.blocks = []; V.byName = new Map();
  const DEF = { shape: SHAPE.cube, layer: LAYER.solid, solid: true, opaque: true, op: 15, emit: 0, tint: TINT.none, hard: 1, tool: '', tier: 0, drop: undefined, sound: 'stone', replace: false, fall: false, liquid: '', climb: false, ui: '', bounce: 0, hurt: 0, slip: 0, cullSelf: true, axis: false, mod: '', title: '' };
  V.defineBlock = d => {
    if (!d || !d.name) throw new Error('блок без имени');
    if (V.byName.has(d.name)) return V.byName.get(d.name);
    const b = Object.assign({}, DEF, d, { id: V.blocks.length });
    if (b.id > TYPE) throw new Error('слишком много видов блоков');
    b.texf = texFaces('tex' in d ? d.tex : b.name);
    if (b.drop === undefined) b.drop = b.name;
    V.blocks.push(b); V.byName.set(b.name, b);
    V.compiled = false;
    return b;
  };
  // { top, bottom, side, front } → номера слоёв граней: +x, −x, +y, −y, +z, −z (и «перед» для повёрнутых)
  function texFaces(t){
    if (t == null) return null;
    const o = typeof t === 'string' ? { all: t } : t;
    const side = o.side || o.all, top = o.top || o.all || side, bottom = o.bottom || o.all || top;
    const n = s => V.texture(s);
    return { top: n(top), bottom: n(bottom), side: n(side), front: n(o.front || side), back: n(o.back || side), extra: o.extra ? n(o.extra) : -1 };
  }
  const B = d => V.defineBlock(d);
  // ── Ваниль (номера постоянны — не переставлять, новые — только в конец) ──
  B({ name: 'air', title: 'Воздух', shape: SHAPE.none, layer: LAYER.none, solid: false, opaque: false, op: 0, hard: 0, drop: null, replace: true, tex: null });
  B({ name: 'stone', title: 'Камень', tex: 'stone', hard: 1.5, tool: 'pick', tier: 1, drop: 'cobble' });
  B({ name: 'cobble', title: 'Булыжник', tex: 'cobble', hard: 2, tool: 'pick', tier: 1 });
  B({ name: 'dirt', title: 'Земля', tex: 'dirt', hard: .5, tool: 'shovel', sound: 'dirt' });
  B({ name: 'grass', title: 'Дёрн', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, tint: TINT.grass, hard: .6, tool: 'shovel', drop: 'dirt', sound: 'grass' });
  B({ name: 'sand', title: 'Песок', tex: 'sand', hard: .5, tool: 'shovel', fall: true, sound: 'sand' });
  B({ name: 'gravel', title: 'Гравий', tex: 'gravel', hard: .6, tool: 'shovel', fall: true, sound: 'gravel' });
  B({ name: 'bedrock', title: 'Коренная порода', tex: 'bedrock', hard: -1, drop: null });
  B({ name: 'water', title: 'Вода', shape: SHAPE.liquid, layer: LAYER.water, solid: false, opaque: false, op: 2, tex: 'water', tint: TINT.water, hard: -1, drop: null, replace: true, liquid: 'water', sound: 'water' });
  B({ name: 'lava', title: 'Лава', shape: SHAPE.liquid, layer: LAYER.solid, solid: false, opaque: false, op: 15, emit: 15, lcol: [1, .55, .2], tex: 'lava', hard: -1, drop: null, replace: true, liquid: 'lava', hurt: 4, sound: 'lava' });
  B({ name: 'log_oak', axis: true, title: 'Дубовое бревно', tex: { top: 'log_oak_top', side: 'log_oak' }, hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'leaves_oak', title: 'Дубовая листва', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_oak', tint: TINT.foliage, hard: .2, drop: null, sound: 'grass' });
  B({ name: 'planks_oak', title: 'Дубовые доски', tex: 'planks_oak', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'log_birch', axis: true, title: 'Берёзовое бревно', tex: { top: 'log_birch_top', side: 'log_birch' }, hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'leaves_birch', title: 'Берёзовая листва', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_birch', tint: TINT.birch, hard: .2, drop: null, sound: 'grass' });
  B({ name: 'log_spruce', axis: true, title: 'Еловое бревно', tex: { top: 'log_spruce_top', side: 'log_spruce' }, hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'leaves_spruce', title: 'Еловая хвоя', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_spruce', tint: TINT.spruce, hard: .2, drop: null, sound: 'grass' });
  B({ name: 'sandstone', title: 'Песчаник', tex: { top: 'sandstone_top', side: 'sandstone', bottom: 'sandstone_top' }, hard: .8, tool: 'pick', tier: 1 });
  B({ name: 'snow', title: 'Снег', tex: 'snow', hard: .3, tool: 'shovel', sound: 'snow' });
  B({ name: 'ice', title: 'Лёд', tex: 'ice', hard: .5, tool: 'pick', slip: .9, op: 2, opaque: true, sound: 'glass', drop: null });
  B({ name: 'clay', title: 'Глина', tex: 'clay', hard: .6, tool: 'shovel', drop: 'clay_ball', sound: 'dirt' });
  B({ name: 'ore_coal', title: 'Угольная руда', tex: 'ore_coal', hard: 3, tool: 'pick', tier: 1, drop: 'coal' });
  B({ name: 'ore_iron', title: 'Железная руда', tex: 'ore_iron', hard: 3, tool: 'pick', tier: 2 });
  B({ name: 'ore_gold', title: 'Золотая руда', tex: 'ore_gold', hard: 3, tool: 'pick', tier: 3 });
  B({ name: 'ore_diamond', title: 'Алмазная руда', tex: 'ore_diamond', hard: 3, tool: 'pick', tier: 3, drop: 'diamond' });
  B({ name: 'glass', title: 'Стекло', layer: LAYER.cutout, opaque: false, op: 0, tex: 'glass', hard: .3, sound: 'glass', glass: true });
  B({ name: 'cactus', title: 'Кактус', shape: SHAPE.cactus, layer: LAYER.cutout, opaque: false, op: 0, tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hard: .4, hurt: 1, sound: 'wool', cullSelf: false });
  B({ name: 'tall_grass', title: 'Трава', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'tall_grass', tint: TINT.grass, hard: 0, drop: null, replace: true, sound: 'grass' });
  B({ name: 'flower_yellow', title: 'Одуванчик', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'flower_yellow', hard: 0, sound: 'grass' });
  B({ name: 'flower_red', title: 'Мак', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'flower_red', hard: 0, sound: 'grass' });
  B({ name: 'dead_bush', title: 'Сухой куст', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'dead_bush', hard: 0, drop: 'stick', replace: true, sound: 'grass' });
  B({ name: 'torch', title: 'Факел', shape: SHAPE.torch, layer: LAYER.cutout, solid: false, opaque: false, op: 0, emit: 14, lcol: [1, .78, .5], tex: 'torch', hard: 0, sound: 'wood' });
  B({ name: 'crafting_table', title: 'Верстак', tex: { top: 'table_top', side: 'table_side', front: 'table_front', bottom: 'planks_oak' }, hard: 2.5, tool: 'axe', ui: 'craft', sound: 'wood' });
  B({ name: 'furnace', title: 'Печь', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top', extra: 'furnace_front_lit' }, hard: 3.5, tool: 'pick', tier: 1, ui: 'furnace' });
  B({ name: 'chest', title: 'Сундук', shape: SHAPE.chest, layer: LAYER.cutout, opaque: false, op: 0, tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front', bottom: 'chest_top' }, hard: 2.5, tool: 'axe', ui: 'chest', sound: 'wood', cullSelf: false });
  B({ name: 'ladder', title: 'Лестница', shape: SHAPE.ladder, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'ladder', hard: .4, tool: 'axe', climb: true, sound: 'wood' });
  B({ name: 'door_oak', title: 'Дверь', shape: SHAPE.door, layer: LAYER.cutout, solid: true, opaque: false, op: 0, tex: { side: 'door_bottom', top: 'door_top' }, hard: 3, tool: 'axe', drop: 'door', sound: 'wood', cullSelf: false });
  B({ name: 'bricks', title: 'Кирпичи', tex: 'bricks', hard: 2, tool: 'pick', tier: 1 });
  B({ name: 'stone_bricks', title: 'Каменные кирпичи', tex: 'stone_bricks', hard: 1.5, tool: 'pick', tier: 1 });
  B({ name: 'lamp', title: 'Лампа', tex: 'lamp', emit: 15, lcol: [1, .93, .72], hard: .3, sound: 'glass' });
  B({ name: 'obsidian', title: 'Обсидиан', tex: 'obsidian', hard: 25, tool: 'pick', tier: 4 });
  B({ name: 'iron_block', title: 'Железный блок', tex: 'iron_block', hard: 5, tool: 'pick', tier: 2, sound: 'metal' });
  B({ name: 'gold_block', title: 'Золотой блок', tex: 'gold_block', hard: 3, tool: 'pick', tier: 3, sound: 'metal' });
  B({ name: 'diamond_block', title: 'Алмазный блок', tex: 'diamond_block', hard: 5, tool: 'pick', tier: 3, sound: 'metal' });
  B({ name: 'snow_grass', title: 'Снежный дёрн', tex: { top: 'snow', side: 'snow_grass_side', bottom: 'dirt' }, hard: .6, tool: 'shovel', drop: 'dirt', sound: 'snow' });
  B({ name: 'planks_birch', title: 'Берёзовые доски', tex: 'planks_birch', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'planks_spruce', title: 'Еловые доски', tex: 'planks_spruce', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'sapling_oak', title: 'Росток дуба', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_oak', hard: 0, sound: 'grass' });
  B({ name: 'sapling_birch', title: 'Росток берёзы', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_birch', hard: 0, sound: 'grass' });
  B({ name: 'sapling_spruce', title: 'Росток ели', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_spruce', hard: 0, sound: 'grass' });
  B({ name: 'mossy_cobble', title: 'Замшелый булыжник', tex: 'mossy_cobble', hard: 2, tool: 'pick', tier: 1 });
  B({ name: 'furnace_lit', title: 'Печь', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit', bottom: 'furnace_top' }, emit: 13, lcol: [1, .72, .45], glowTex: ['furnace_front_lit'], hard: 3.5, tool: 'pick', tier: 1, ui: 'furnace', drop: 'furnace', noItem: true });
  B({ name: 'bouncer', title: 'Батут', tex: 'bouncer', bounce: 15, hard: .3, sound: 'wool' });
  B({ name: 'missing', title: 'Неизвестный блок', tex: 'missing', hard: .5, drop: null, noItem: true });   // блок отключённого мода
  V.VANILLA_BLOCKS = V.blocks.length;
  // доп. текстуры (ломание блока, частицы)
  for (let i = 0; i < 8; i++) V.texture('destroy_' + i);

  // ═══ Вещи (у каждого блока — вещь с тем же именем) ═══
  // Поля: name, title, tex (спрайт), stack (64), place (блок), tool { kind, tier, speed, dur, dmg }, food { h, sat },
  // fuel (секунд горения), smelt (что выйдет в печи), dmg (урон без инструмента), mod
  V.items = []; V.itemBy = new Map();
  V.defineItem = d => {
    if (!d || !d.name) throw new Error('вещь без имени');
    if (V.itemBy.has(d.name)) return V.itemBy.get(d.name);
    const it = Object.assign({ stack: 64, title: d.name, place: '', tool: null, food: null, fuel: 0, smelt: '', mod: '', icon: '' }, d, { id: V.items.length });
    if (it.tex) it.texL = V.texture(it.tex);
    V.items.push(it); V.itemBy.set(it.name, it);
    return it;
  };
  V.block = n => V.byName.get(n) || null;
  V.item = n => V.itemBy.get(n) || null;
  const I = d => V.defineItem(d);
  // блоки как вещи (не все: воздух, вода, лава, неизвестный — нет)
  function blockItems(from){
    for (let i = from; i < V.blocks.length; i++) {
      const b = V.blocks[i];
      if (['air', 'water', 'lava', 'bedrock'].includes(b.name) || b.noItem) continue;
      if (b.name === 'door_oak') continue;
      I({ name: b.name, title: b.title, place: b.name, block: b.id, fuel: b.fuel || (/^(log|planks)_/.test(b.name) ? 15 : /^sapling_/.test(b.name) ? 5 : 0), mod: b.mod, stack: b.stack || 64 });
    }
  }
  blockItems(1);
  V.blockItems = blockItems;
  I({ name: 'door', title: 'Дверь', tex: 'item_door', place: 'door_oak', stack: 16, fuel: 10 });
  I({ name: 'stick', title: 'Палка', tex: 'item_stick', fuel: 5 });
  I({ name: 'coal', title: 'Уголь', tex: 'item_coal', fuel: 80 });
  I({ name: 'iron_ingot', title: 'Железный слиток', tex: 'item_iron_ingot' });
  I({ name: 'gold_ingot', title: 'Золотой слиток', tex: 'item_gold_ingot' });
  I({ name: 'diamond', title: 'Алмаз', tex: 'item_diamond' });
  I({ name: 'clay_ball', title: 'Комок глины', tex: 'item_clay_ball' });
  I({ name: 'brick', title: 'Кирпич', tex: 'item_brick' });
  I({ name: 'apple', title: 'Яблоко', tex: 'item_apple', food: { h: 4, sat: 2.4 } });
  I({ name: 'meat_raw', title: 'Сырое мясо', tex: 'item_meat_raw', food: { h: 3, sat: 1.8 }, smelt: 'meat_cooked' });
  I({ name: 'meat_cooked', title: 'Жареное мясо', tex: 'item_meat_cooked', food: { h: 8, sat: 12.8 } });
  I({ name: 'chicken_raw', title: 'Сырая курица', tex: 'item_chicken_raw', food: { h: 2, sat: 1.2 }, smelt: 'chicken_cooked' });
  I({ name: 'chicken_cooked', title: 'Жареная курица', tex: 'item_chicken_cooked', food: { h: 6, sat: 7.2 } });
  I({ name: 'feather', title: 'Перо', tex: 'item_feather' });
  I({ name: 'slime_ball', title: 'Слизь', tex: 'item_slime_ball' });
  // инструменты: материал → { tier, speed, dur, dmg }
  V.TOOL_MATS = {
    wood: { title: ['Деревянная', 'Деревянный'], tier: 1, speed: 2, dur: 59, dmg: 0, color: '#9c7a4a', from: 'planks' },
    stone: { title: ['Каменная', 'Каменный'], tier: 2, speed: 4, dur: 131, dmg: 1, color: '#8a8a8a', from: 'cobble' },
    iron: { title: ['Железная', 'Железный'], tier: 3, speed: 6, dur: 250, dmg: 2, color: '#d8d8d8', from: 'iron_ingot' },
    gold: { title: ['Золотая', 'Золотой'], tier: 1, speed: 12, dur: 32, dmg: 0, color: '#f2c94c', from: 'gold_ingot' },
    diamond: { title: ['Алмазная', 'Алмазный'], tier: 4, speed: 8, dur: 1561, dmg: 3, color: '#4fe3d6', from: 'diamond' },
  };
  V.TOOL_KINDS = { pick: ['кирка', 0, 2], axe: ['топор', 1, 3], shovel: ['лопата', 0, 1], sword: ['меч', 1, 4] };   // [название, род (0 — ж, 1 — м), урон]
  for (const [m, M] of Object.entries(V.TOOL_MATS)) for (const [k, K] of Object.entries(V.TOOL_KINDS)) {
    I({ name: `${k}_${m}`, title: `${M.title[K[1]]} ${K[0]}`, tex: `item_${k}_${m}`, stack: 1, fuel: m === 'wood' ? 10 : 0,
      tool: { kind: k, tier: M.tier, speed: k === 'sword' ? 1.5 : M.speed, dur: M.dur, dmg: K[2] + M.dmg } });
  }
  V.VANILLA_ITEMS = V.items.length;

  // ═══ Рецепты (верстак 3×3, в руках 2×2) и печь ═══
  // shaped: { pattern: ['##', '##'], key: { '#': 'planks' }, out: 'crafting_table', n: 1 }; shapeless: { list: [...], out, n }.
  // Группы вещей: 'planks' — любые доски, 'log' — любое бревно (#tag)
  V.TAGS = { planks: ['planks_oak', 'planks_birch', 'planks_spruce'], log: ['log_oak', 'log_birch', 'log_spruce'], coal: ['coal'] };
  V.recipes = []; V.smelting = new Map();
  V.addRecipe = r => { V.recipes.push(r); return r; };
  V.addSmelt = (input, out, time = 6, n = 1) => { V.smelting.set(input, { out, time, n: Math.max(1, n | 0) }); };   // n — сколько выходит (рецепт мода)
  const R = r => V.addRecipe(r);
  R({ list: ['log_oak'], out: 'planks_oak', n: 4 }); R({ list: ['log_birch'], out: 'planks_birch', n: 4 }); R({ list: ['log_spruce'], out: 'planks_spruce', n: 4 });
  R({ pattern: ['#', '#'], key: { '#': '#planks' }, out: 'stick', n: 4 });
  R({ pattern: ['##', '##'], key: { '#': '#planks' }, out: 'crafting_table', n: 1 });
  R({ pattern: ['###', '# #', '###'], key: { '#': 'cobble' }, out: 'furnace', n: 1 });
  R({ pattern: ['###', '# #', '###'], key: { '#': '#planks' }, out: 'chest', n: 1 });
  R({ pattern: ['c', '|'], key: { c: 'coal', '|': 'stick' }, out: 'torch', n: 4 });
  R({ pattern: ['| |', '|||', '| |'], key: { '|': 'stick' }, out: 'ladder', n: 3 });
  R({ pattern: ['##', '##', '##'], key: { '#': '#planks' }, out: 'door', n: 3 });
  R({ pattern: ['##', '##'], key: { '#': 'sand' }, out: 'sandstone', n: 1 });
  R({ pattern: ['##', '##'], key: { '#': 'stone' }, out: 'stone_bricks', n: 4 });
  R({ pattern: ['##', '##'], key: { '#': 'brick' }, out: 'bricks', n: 1 });
  R({ pattern: ['#'], key: { '#': 'clay' }, out: 'clay_ball', n: 4 });
  R({ pattern: ['ggg', 'gtg', 'ggg'], key: { g: 'glass', t: 'torch' }, out: 'lamp', n: 1 });
  R({ list: ['cobble', 'tall_grass'], out: 'mossy_cobble', n: 1 });
  R({ pattern: ['ss', 'ss'], key: { s: 'slime_ball' }, out: 'bouncer', n: 1 });
  for (const [b, i] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond']]) {
    R({ pattern: ['###', '###', '###'], key: { '#': i }, out: b, n: 1 });
    R({ list: [b], out: i, n: 9 });
  }
  for (const [m, M] of Object.entries(V.TOOL_MATS)) {
    const k = M.from === 'planks' ? '#planks' : M.from;
    R({ pattern: ['MMM', ' | ', ' | '], key: { M: k, '|': 'stick' }, out: 'pick_' + m, n: 1 });
    R({ pattern: ['MM', 'M|', ' |'], key: { M: k, '|': 'stick' }, out: 'axe_' + m, n: 1, mirror: true });
    R({ pattern: ['M', '|', '|'], key: { M: k, '|': 'stick' }, out: 'shovel_' + m, n: 1 });
    R({ pattern: ['M', 'M', '|'], key: { M: k, '|': 'stick' }, out: 'sword_' + m, n: 1 });
  }
  V.addSmelt('ore_iron', 'iron_ingot'); V.addSmelt('ore_gold', 'gold_ingot'); V.addSmelt('sand', 'glass'); V.addSmelt('cobble', 'stone');
  V.addSmelt('clay_ball', 'brick'); V.addSmelt('meat_raw', 'meat_cooked'); V.addSmelt('chicken_raw', 'chicken_cooked');
  V.addSmelt('log_oak', 'coal'); V.addSmelt('log_birch', 'coal'); V.addSmelt('log_spruce', 'coal');
  V.VANILLA_RECIPES = V.recipes.length;

  const tagHas = (k, name) => k[0] === '#' ? (V.TAGS[k.slice(1)] || []).includes(name) : k === name;
  V.tagHas = tagHas;
  // Сетка верстака (массив имён или null, w×h) → { out, n, recipe } или null
  V.craft = (grid, w, h) => {
    // обрезать пустые края
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, chh = y1 - y0 + 1, cells = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(grid[y * w + x] || null);
    const filled = cells.filter(Boolean);
    for (const r of V.recipes) {
      if (r.table && w < 3) continue;   // только на верстаке (рецепт мода: station workbench / больше 4 предметов)
      if (r.list) {
        if (r.list.length !== filled.length) continue;
        const left = filled.slice();
        let okAll = true;
        for (const k of r.list) { const j = left.findIndex(n => tagHas(k, n)); if (j < 0) { okAll = false; break; } left.splice(j, 1); }
        if (okAll) return { out: r.out, n: r.n || 1, recipe: r };
        continue;
      }
      const P = r.pattern, rh = P.length, rw = Math.max(...P.map(s => s.length));
      if (rw !== cw || rh !== chh) continue;
      for (const mir of r.mirror === false ? [false] : [false, true]) {
        let okAll = true;
        for (let y = 0; y < rh && okAll; y++) for (let x = 0; x < rw; x++) {
          const ch = (P[y][mir ? rw - 1 - x : x] || ' '), need = ch === ' ' ? null : r.key[ch], have = cells[y * cw + x];
          if (!need ? have : !have || !tagHas(need, have)) { okAll = false; break; }
        }
        if (okAll) return { out: r.out, n: r.n || 1, recipe: r };
      }
    }
    return null;
  };

  // ═══ Таблицы для сетки и света (V.compile — после модов; их же получают потоки) ═══
  const LCOL0 = [1, .95, .84];   // свет без своего цвета — тёплый белый
  V.compile = () => {
    const n = V.blocks.length, T = {
      n, shape: new Uint8Array(n), layer: new Uint8Array(n), solid: new Uint8Array(n), opaque: new Uint8Array(n), op: new Uint8Array(n), emit: new Uint8Array(n),
      tint: new Uint8Array(n), cullSelf: new Uint8Array(n), liquid: new Uint8Array(n), climb: new Uint8Array(n), axis: new Uint8Array(n),
      tex: new Int16Array(n * 7),   // top, bottom, side, front, back, extra, (запас)
      ecol: new Uint8Array(n * 3),  // цветной свет блока: R, G, B (0…255 = уровень × 17; самый яркий канал = emit × 17)
      stream: new Uint8Array(n),    // сетка (V.LAYERS): 0 solid, 1 cutout, 2 water, 3 foliage (листва, трава, цветы), 4 glass
      glowL: new Uint8Array(V.tex.length + 1),   // текстура светится сама (0…15): факел, лава, лампа, «перед» горящей печи
    };
    for (const b of V.blocks) {
      const i = b.id;
      T.shape[i] = b.shape; T.layer[i] = b.layer; T.solid[i] = b.solid ? 1 : 0; T.opaque[i] = b.opaque ? 1 : 0;
      T.op[i] = Math.max(0, Math.min(15, b.opaque ? 15 : b.op | 0)); T.emit[i] = Math.max(0, Math.min(15, b.emit | 0));
      T.tint[i] = b.tint; T.cullSelf[i] = b.cullSelf ? 1 : 0; T.liquid[i] = b.liquid === 'water' ? 1 : b.liquid === 'lava' ? 2 : 0; T.climb[i] = b.climb ? 1 : 0; T.axis[i] = b.axis ? 1 : 0;
      const f = b.texf;
      if (f) { T.tex[i * 7] = f.top; T.tex[i * 7 + 1] = f.bottom; T.tex[i * 7 + 2] = f.side; T.tex[i * 7 + 3] = f.front; T.tex[i * 7 + 4] = f.back; T.tex[i * 7 + 5] = f.extra; }
      // сетка: стекло и листва — отдельно (движок может их «улучшать»: отражения, качание), прочее вырезное — cutout
      T.stream[i] = b.liquid === 'water' ? 2 : b.liquid || b.layer !== LAYER.cutout ? 0
        : (b.glass || /(^|_)glass($|_)/.test(b.name)) && b.shape === SHAPE.cube ? 4
        : b.foliage || b.shape === SHAPE.cross || b.tint === TINT.foliage || b.tint === TINT.birch || b.tint === TINT.spruce ? 3 : 1;
      const e = T.emit[i];
      if (e) {
        const c = Array.isArray(b.lcol) && b.lcol.length === 3 ? b.lcol : LCOL0, mx = Math.max(c[0], c[1], c[2], 1e-3);
        for (let k = 0; k < 3; k++) T.ecol[i * 3 + k] = Math.max(0, Math.min(255, Math.round(e * 17 * Math.max(0, c[k]) / mx)));
        if (b.glow !== false) {
          const lst = Array.isArray(b.glowTex) ? b.glowTex.map(nm => V.texIdx.get(nm)).filter(l => l >= 0) : f ? [f.top, f.bottom, f.side, f.front, f.back] : [];
          for (const l of lst) if (l >= 0 && l < T.glowL.length && e > T.glowL[l]) T.glowL[l] = e;
        }
      }
    }
    V.T = T; V.compiled = true;
    V.AIR = 0; V.ID = {}; for (const b of V.blocks) V.ID[b.name] = b.id;
    return T;
  };
  V.compile();

  // ═══ Чанк ═══
  class Chunk {
    constructor(cx, cz, ids){
      this.cx = cx; this.cz = cz; this.key = V.key(cx, cz);
      this.ids = ids === undefined ? new Uint16Array(V.CELLS) : ids;   // null — заготовка (ждёт генерацию)
      this.light = null;            // Uint8Array: свет неба << 4 | свет блоков (из потока, после пересчёта)
      this.hmap = null;             // высота верхнего непрозрачного (+1) по столбцам 16×16
      this.gen = ids !== null;      // сгенерирован (заготовка для потока — ids = null)
      this.edits = null;            // Map(номер ячейки → значение) — изменения игрока (сохраняются)
      this.tiles = null;            // Map(номер ячейки → данные) — сундуки, печи…
      this.dirty = 0;               // нужно пересобрать сетку (номер правки)
      this.saved = 0;               // номер сохранённой правки
      this.rev = 0;                 // номер правки
      this.meshRev = -1;            // для какой правки собрана сетка
      this.lightRev = -1;
      this.minY = 0; this.maxY = H - 1;
    }
    get(x, y, z){ return this.ids[(x << 11) | (z << 7) | y]; }
    calcHmap(){
      const op = V.T.opaque, h = this.hmap || (this.hmap = new Uint8Array(256));
      let lo = H, hi = 0;
      for (let c = 0; c < 256; c++) {
        const base = c << 7;
        let y = H - 1;
        while (y >= 0 && this.ids[base | y] === 0) y--;
        const top = y + 1;
        while (y >= 0 && !op[this.ids[base | y] & TYPE]) y--;
        h[(c >> 4) | ((c & 15) << 4)] = y + 1;   // [x | z<<4] — x = c >> 4, z = c & 15
        if (top > hi) hi = top;
        if (y + 1 < lo) lo = y + 1;
      }
      this.maxY = Math.min(H - 1, hi); this.minY = Math.max(0, lo - 1);
      return h;
    }
  }
  V.Chunk = Chunk;

  // ═══ Мир (данные): чанки, чтение/запись по мировым координатам ═══
  class World {
    constructor(o = {}){
      this.seed = V.seedOf(o.seed ?? 1);
      this.chunks = new Map();
      this.last = null;
      this.rev = 0;
      this.listeners = [];       // f(x, y, z, было, стало) — каждая правка
    }
    chunk(cx, cz){ const l = this.last; if (l && l.cx === cx && l.cz === cz) return l; const c = this.chunks.get(V.key(cx, cz)); if (c) this.last = c; return c || null; }
    chunkAt(x, z){ return this.chunk(Math.floor(x) >> 4, Math.floor(z) >> 4); }
    add(c){ this.chunks.set(c.key, c); return c; }
    remove(c){ this.chunks.delete(c.key); if (this.last === c) this.last = null; }
    // значение ячейки (вид | состояние << 12); вне загруженного — null-значение: ниже 0 — коренная порода, выше — воздух
    raw(x, y, z){
      if (y < 0) return 7; if (y >= H) return 0;
      x = Math.floor(x); z = Math.floor(z);
      const c = this.chunk(x >> 4, z >> 4);
      if (!c || !c.gen) return -1;
      return c.ids[((x & 15) << 11) | ((z & 15) << 7) | Math.floor(y)];
    }
    get(x, y, z){ const v = this.raw(x, y, z); return v < 0 ? -1 : v & TYPE; }
    loaded(x, z){ const c = this.chunkAt(x, z); return !!(c && c.gen); }
    // Поставить ячейку; возвращает true, если поменялось. o.silent — без слушателей (генерация, загрузка)
    set(x, y, z, v, o = {}){
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0 || y >= H) return false;
      const c = this.chunk(x >> 4, z >> 4); if (!c || !c.gen) return false;
      const i = ((x & 15) << 11) | ((z & 15) << 7) | y, was = c.ids[i];
      if (was === v) return false;
      c.ids[i] = v;
      if (!o.noEdit) { (c.edits || (c.edits = new Map())).set(i, v); }
      c.rev = ++this.rev; c.dirty = c.rev;
      if (c.hmap) { const hi = (x & 15) | ((z & 15) << 4), op = V.T.opaque; if (op[v & TYPE] && y + 1 > c.hmap[hi]) c.hmap[hi] = y + 1; else if (!op[v & TYPE] && y + 1 === c.hmap[hi]) { let yy = y; while (yy >= 0 && !op[c.ids[i - (y - yy)] & TYPE]) yy--; c.hmap[hi] = yy + 1; } }
      if (y > c.maxY) c.maxY = Math.min(H - 1, y + 1);
      if (y < c.minY + 1) c.minY = Math.max(0, y - 1);
      if (!o.silent) for (const f of this.listeners) { try { f(x, y, z, was, v, o); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }
      return true;
    }
    // свет в точке: небо << 12 | R << 8 | G << 4 | B (по 0…15; до пересчёта — небо 15) — V.lSky / V.lBlk / V.lR …
    lightAt(x, y, z){
      if (y >= H) return 15 << 12;
      if (y < 0) return 0;
      const c = this.chunkAt(x, z); if (!c || !c.light) return 15 << 12;
      return c.light[((Math.floor(x) & 15) << 11) | ((Math.floor(z) & 15) << 7) | Math.floor(y)];
    }
    // высота поверхности (верх непрозрачного) в столбце
    heightAt(x, z){ const c = this.chunkAt(x, z); if (!c || !c.gen) return -1; if (!c.hmap) c.calcHmap(); return c.hmap[(Math.floor(x) & 15) | ((Math.floor(z) & 15) << 4)]; }
    tile(x, y, z, make){
      const c = this.chunkAt(x, z); if (!c) return null;
      const i = ((Math.floor(x) & 15) << 11) | ((Math.floor(z) & 15) << 7) | Math.floor(y);
      if (!c.tiles) { if (!make) return null; c.tiles = new Map(); }
      let t = c.tiles.get(i);
      if (!t && make) { t = make(); c.tiles.set(i, t); c.rev = ++this.rev; }
      return t || null;
    }
    dropTile(x, y, z){ const c = this.chunkAt(x, z); if (!c?.tiles) return null; const i = ((Math.floor(x) & 15) << 11) | ((Math.floor(z) & 15) << 7) | Math.floor(y), t = c.tiles.get(i); if (t) { c.tiles.delete(i); c.rev = ++this.rev; } return t || null; }
    markTile(x, z){ const c = this.chunkAt(x, z); if (c) c.rev = ++this.rev; }
  }
  V.World = World;

  // ═══ Рамки блоков (выделение, столкновения): в долях блока [x0, y0, z0, x1, y1, z1] ═══
  const FULL = [0, 0, 0, 1, 1, 1];
  // сторона по состоянию: 0 — к +z (юг), 1 — к −x (запад), 2 — к −z (север), 3 — к +x (восток)
  V.FACING = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0]];
  V.boxOf = (v, forCollide) => {
    const t = v & TYPE, s = v >>> 12, sh = V.T.shape[t];
    switch (sh) {
      case SHAPE.none: return null;
      case SHAPE.cube: return FULL;
      case SHAPE.cross: return forCollide ? null : [.2, 0, .2, .8, .8, .8];
      case SHAPE.liquid: return null;
      case SHAPE.torch: { if (forCollide) return null; const f = s & 7; if (f >= 1 && f <= 4) { const d = V.FACING[f - 1]; return [.5 - .12 - d[0] * .32, .2, .5 - .12 - d[2] * .32, .5 + .12 - d[0] * .32, .85, .5 + .12 - d[2] * .32]; } return [.38, 0, .38, .62, .65, .62]; }
      case SHAPE.ladder: { const d = V.FACING[s & 3], t0 = .125; if (forCollide) return null; return d[0] > 0 ? [0, 0, 0, t0, 1, 1] : d[0] < 0 ? [1 - t0, 0, 0, 1, 1, 1] : d[2] > 0 ? [0, 0, 0, 1, 1, t0] : [0, 0, 1 - t0, 1, 1, 1]; }
      case SHAPE.door: { const f = s & 3, open = (s >> 2) & 1, t0 = .1875; const g = open ? (f + 1) & 3 : f, d = V.FACING[g];
        return d[0] > 0 ? [0, 0, 0, t0, 1, 1] : d[0] < 0 ? [1 - t0, 0, 0, 1, 1, 1] : d[2] > 0 ? [0, 0, 0, 1, 1, t0] : [0, 0, 1 - t0, 1, 1, 1]; }
      case SHAPE.cactus: return [.0625, 0, .0625, .9375, 1, .9375];
      case SHAPE.chest: return [.0625, 0, .0625, .9375, .875, .9375];
      default: return FULL;
    }
  };

  // ═══ Луч по блокам (DDA): первый блок, у которого есть рамка (и pick(тип) не против) ═══
  // → { x, y, z, nx, ny, nz, t, v } или null. Вода и воздух пропускаются (pick может разрешить воду).
  V.raycast = (W, ox, oy, oz, dx, dy, dz, maxT, pick) => {
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tx = dx ? ((dx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity, ty = dy ? ((dy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity, tz = dz ? ((dz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let n = 0; n < 512 && t <= maxT; n++) {
      const v = W.raw(x, y, z);
      if (v > 0) {
        const tp = v & TYPE;
        if (!pick || pick(tp, v)) {
          const bx = V.boxOf(v, false) || (pick && V.T.liquid[tp] ? [0, 0, 0, 1, .875, 1] : null);
          if (bx) {
            if (bx === FULL) return { x, y, z, nx, ny, nz, t, v };
            const h = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, bx);
            if (h && h.t <= maxT) return { x, y, z, nx: h.nx, ny: h.ny, nz: h.nz, t: h.t, v };
          }
        }
      } else if (v < 0) return null;   // не загружено
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (y < -1 || y > H) return null;
    }
    return null;
  };
  function rayBox(ox, oy, oz, dx, dy, dz, b){
    let t0 = -Infinity, t1 = Infinity, ax = 0;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      const lo = b[k], hi = b[k + 3];
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo || o[k] > hi) return null; continue; }
      let a = (lo - o[k]) / d[k], c = (hi - o[k]) / d[k], s = -1;
      if (a > c) { const q = a; a = c; c = q; s = 1; }
      if (a > t0) { t0 = a; ax = (k + 1) * (d[k] > 0 ? -1 : 1); }
      if (c < t1) t1 = c;
      if (t0 > t1) return null;
    }
    if (t1 < 0) return null;
    const t = Math.max(0, t0), k = Math.abs(ax) - 1;
    return { t, nx: k === 0 ? Math.sign(ax) : 0, ny: k === 1 ? Math.sign(ax) : 0, nz: k === 2 ? Math.sign(ax) : 0 };
  }
  V.rayBox = rayBox;

  // ═══ Столкновения: коробка (x, y, z — центр низа; w — ширина, h — высота) против блоков ═══
  // V.moveBox(W, b, dx, dy, dz) двигает b по осям (сначала y, потом x и z), упёрся — скорость по оси в 0; b.ground — стоит,
  // b.hitX / hitZ / hitY — упёрся. Незагруженное — стена (не падаем в непрогруженный чанк).
  const solidBox = (W, x, y, z, out) => {
    const v = W.raw(x, y, z);
    if (v < 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = 1; out[5] = 1; return true; }
    const t = v & TYPE;
    if (!V.T.solid[t]) {
      // лёд (погода, kubomir-weather.js): верхний блок воды — твёрдый до глади, блок мира не меняется
      if (V.iceTest && V.T.liquid[t] === 1 && V.iceTest(W, x, y, z, v)) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = V.liquidHeight(v); out[5] = 1; return true; }
      return false;
    }
    const bx = V.boxOf(v, true); if (!bx) return false;
    for (let i = 0; i < 6; i++) out[i] = bx[i];
    return true;
  };
  const BX = [0, 0, 0, 0, 0, 0];
  V.moveBox = (W, b, dx, dy, dz) => {
    const hw = b.w / 2, EPS = 1e-4;
    b.hitX = b.hitY = b.hitZ = false;
    // по y
    if (dy) {
      const x0 = Math.floor(b.x - hw + EPS), x1 = Math.floor(b.x + hw - EPS), z0 = Math.floor(b.z - hw + EPS), z1 = Math.floor(b.z + hw - EPS);
      let ny = b.y + dy;
      const ya = Math.floor(Math.min(b.y, ny) - 1), yb = Math.floor(Math.max(b.y + b.h, ny + b.h) + 1);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = ya; y <= yb; y++) {
        if (!solidBox(W, x, y, z, BX)) continue;
        if (b.x + hw <= x + BX[0] + EPS || b.x - hw >= x + BX[3] - EPS || b.z + hw <= z + BX[2] + EPS || b.z - hw >= z + BX[5] - EPS) continue;
        const top = y + BX[4], bot = y + BX[1];
        if (dy < 0 && b.y >= top - EPS && ny < top) { ny = top; b.hitY = true; }
        else if (dy > 0 && b.y + b.h <= bot + EPS && ny + b.h > bot) { ny = bot - b.h; b.hitY = true; }
      }
      b.y = ny;
    }
    // по x и z — по очереди
    for (const ax of [0, 2]) {
      const d = ax === 0 ? dx : dz; if (!d) continue;
      const y0 = Math.floor(b.y + EPS), y1 = Math.floor(b.y + b.h - EPS);
      const p = ax === 0 ? b.x : b.z, q = ax === 0 ? b.z : b.x;
      let np = p + d;
      const pa = Math.floor(Math.min(p, np) - hw - 1), pb = Math.floor(Math.max(p, np) + hw + 1), q0 = Math.floor(q - hw + EPS), q1 = Math.floor(q + hw - EPS);
      for (let a = pa; a <= pb; a++) for (let c = q0; c <= q1; c++) for (let y = y0; y <= y1; y++) {
        const x = ax === 0 ? a : c, z = ax === 0 ? c : a;
        if (!solidBox(W, x, y, z, BX)) continue;
        if (b.y + b.h <= y + BX[1] + EPS || b.y >= y + BX[4] - EPS) continue;
        const qlo = (ax === 0 ? z + BX[2] : x + BX[0]), qhi = (ax === 0 ? z + BX[5] : x + BX[3]);
        if (q + hw <= qlo + EPS || q - hw >= qhi - EPS) continue;
        const lo = (ax === 0 ? x + BX[0] : z + BX[2]), hi = (ax === 0 ? x + BX[3] : z + BX[5]);
        if (d > 0 && p + hw <= lo + EPS && np + hw > lo) { np = lo - hw; if (ax === 0) b.hitX = true; else b.hitZ = true; }
        else if (d < 0 && p - hw >= hi - EPS && np - hw < hi) { np = hi + hw; if (ax === 0) b.hitX = true; else b.hitZ = true; }
      }
      if (ax === 0) b.x = np; else b.z = np;
    }
    return b;
  };
  // Пересекается ли коробка с твёрдым (нельзя поставить блок туда, где стоит игрок; встать после приседа)
  V.boxHits = (W, x, y, z, w, h) => {
    const hw = w / 2, EPS = 1e-3;
    for (let bx = Math.floor(x - hw + EPS); bx <= Math.floor(x + hw - EPS); bx++) for (let bz = Math.floor(z - hw + EPS); bz <= Math.floor(z + hw - EPS); bz++)
      for (let by = Math.floor(y + EPS); by <= Math.floor(y + h - EPS); by++) {
        if (!solidBox(W, bx, by, bz, BX)) continue;
        if (x + hw > bx + BX[0] + EPS && x - hw < bx + BX[3] - EPS && z + hw > bz + BX[2] + EPS && z - hw < bz + BX[5] - EPS && y + h > by + BX[1] + EPS && y < by + BX[4] - EPS) return true;
      }
    return false;
  };
  // Что вокруг коробки: вода/лава (глубина), лестница, урон, подброс
  V.touching = (W, x, y, z, w, h, out = {}) => {
    const hw = w / 2;
    out.water = 0; out.lava = 0; out.climb = false; out.hurt = 0; out.eyeWater = false; out.bounce = 0; out.blocks = out.blocks || []; out.blocks.length = 0;
    const T = V.T;
    for (let bx = Math.floor(x - hw); bx <= Math.floor(x + hw); bx++) for (let bz = Math.floor(z - hw); bz <= Math.floor(z + hw); bz++)
      for (let by = Math.floor(y); by <= Math.floor(y + h); by++) {
        const v = W.raw(bx, by, bz); if (v <= 0) continue;
        const t = v & TYPE, b = V.blocks[t];
        if (T.liquid[t]) { const top = by + V.liquidHeight(v); if (top > y) { const d = Math.min(top, y + h) - y; if (T.liquid[t] === 1) out.water = Math.max(out.water, d); else out.lava = Math.max(out.lava, d); } }   // глубина: от ног до поверхности
        if (T.climb[t]) out.climb = true;
        if (b.hurt) out.hurt = Math.max(out.hurt, b.hurt);
        if (b.mod) out.blocks.push(t);
      }
    // под ногами: подброс / скользко / свой блок мода
    const fv = W.raw(Math.floor(x), Math.floor(y - .05), Math.floor(z));
    if (fv > 0) { const b = V.blocks[fv & TYPE]; out.under = fv & TYPE; if (b.bounce) out.bounce = b.bounce; out.slip = b.slip || 0; if (b.mod && !out.blocks.includes(out.under)) out.blocks.push(out.under); } else { out.under = 0; out.slip = 0; }
    return out;
  };
  // Высота жидкости в блоке (0…1): источник и падающая — 0,875, течение — меньше с расстоянием
  // разбор света клетки (W.lightAt): небо, цвет блоков и самая яркая составляющая
  V.lSky = L => (L >>> 12) & 15; V.lR = L => (L >>> 8) & 15; V.lG = L => (L >>> 4) & 15; V.lB = L => L & 15;
  V.lBlk = L => Math.max((L >>> 8) & 15, (L >>> 4) & 15, L & 15);
  V.liquidHeight = v => { const s = v >>> 12; if (s === 0 || s >= 8) return .875; return Math.max(.1, .875 * (8 - s) / 8); };
})();

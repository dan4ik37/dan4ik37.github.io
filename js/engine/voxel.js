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
  const SHAPE = V.SHAPE = { none: 0, cube: 1, cross: 2, liquid: 3, torch: 4, ladder: 5, door: 6, cactus: 7, chest: 8, branch: 9 };   // branch — тонкая ветка (T-022b)
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
  // 0…1 (нет — тёплый белый), glowTex — какие текстуры светятся сами (нет — все грани светящегося блока), glow: false — сам не светится;
  // деревья (T-022b): tree — чем блок служит дереву: 'log' (ствол, сук, корень), 'thin' (тонкая ветка), 'leaves', 'sapling' — по нему
  // узнают дерево падение (kubomir-ents.js fellTree), рост ростков и сетка тонких веток; decid — листва опадает зимой (лиственная)
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
  B({ name: 'log_oak', axis: true, title: 'Дубовое бревно', tex: { top: 'log_oak_top', side: 'log_oak' }, hard: 2, tool: 'axe', sound: 'wood', tree: 'log' });
  B({ name: 'leaves_oak', title: 'Дубовая листва', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_oak', tint: TINT.foliage, hard: .2, drop: null, sound: 'grass', tree: 'leaves', decid: true });
  B({ name: 'planks_oak', title: 'Дубовые доски', tex: 'planks_oak', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'log_birch', axis: true, title: 'Берёзовое бревно', tex: { top: 'log_birch_top', side: 'log_birch' }, hard: 2, tool: 'axe', sound: 'wood', tree: 'log' });
  B({ name: 'leaves_birch', title: 'Берёзовая листва', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_birch', tint: TINT.birch, hard: .2, drop: null, sound: 'grass', tree: 'leaves', decid: true });
  B({ name: 'log_spruce', axis: true, title: 'Еловое бревно', tex: { top: 'log_spruce_top', side: 'log_spruce' }, hard: 2, tool: 'axe', sound: 'wood', tree: 'log' });
  B({ name: 'leaves_spruce', title: 'Еловая хвоя', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_spruce', tint: TINT.spruce, hard: .2, drop: null, sound: 'grass', tree: 'leaves' });
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
  B({ name: 'sapling_oak', title: 'Росток дуба', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_oak', hard: 0, sound: 'grass', tree: 'sapling' });
  B({ name: 'sapling_birch', title: 'Росток берёзы', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_birch', hard: 0, sound: 'grass', tree: 'sapling' });
  B({ name: 'sapling_spruce', title: 'Росток ели', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_spruce', hard: 0, sound: 'grass', tree: 'sapling' });
  B({ name: 'mossy_cobble', title: 'Замшелый булыжник', tex: 'mossy_cobble', hard: 2, tool: 'pick', tier: 1 });
  B({ name: 'furnace_lit', title: 'Печь', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit', bottom: 'furnace_top' }, emit: 13, lcol: [1, .72, .45], glowTex: ['furnace_front_lit'], hard: 3.5, tool: 'pick', tier: 1, ui: 'furnace', drop: 'furnace', noItem: true });
  B({ name: 'bouncer', title: 'Батут', tex: 'bouncer', bounce: 15, hard: .3, sound: 'wool' });
  B({ name: 'missing', title: 'Неизвестный блок', tex: 'missing', hard: .5, drop: null, noItem: true });   // блок отключённого мода
  // «Кубомир» удобнее (T-049): лежанка — дом (появляться тут) и сон ночью (kubomir-x.js; use — что делает ПКМ). Пока простой кубик
  B({ name: 'bed', title: 'Лежанка', tex: { top: 'bed_top', side: 'bed_side', bottom: 'planks_oak' }, hard: .6, tool: 'axe', sound: 'wool', stack: 8, use: 'bed' });
  // Огонь (T-022d; ядро — js/engine/fire.js, переходник — js/games/kubomir-fire.js): «огонь» — клетка пламени рядом с горящим блоком
  // (светит, жжётся, поверх можно ставить блок, вода гасит; сеткой чанка не рисуется — пламя рисует движок, fx.js);
  // «обугленные доски» — доски, которые горели и почернели (погасли — остались чёрными; ломаются — иногда уголь)
  B({ name: 'fire', title: 'Огонь', shape: SHAPE.none, layer: LAYER.none, solid: false, opaque: false, op: 0, emit: 15, lcol: [1, .55, .2], tex: null, hard: 0, drop: null, replace: true, hurt: 2, noItem: true, sound: 'wood', burn: 'flame' });
  B({ name: 'charred_planks', title: 'Обугленные доски', tex: 'charred_planks', hard: 1, tool: 'axe', sound: 'wood', drop: null, burn: 'char', noItem: true });
  // Деревья «как в модах» (T-022b, генератор v3 — js/engine/trees.js): акация и тропическое дерево (свои брёвна, листва, доски,
  // ростки), ива (листва и росток; ствол — дубовый), тонкие ветки (форма branch: середина и «руки» к соседним брёвнам; поля — как у
  // брёвен: топор, звук дерева, горит как дерево). Только в конец списка — номера блоков постоянны
  B({ name: 'log_acacia', axis: true, title: 'Бревно акации', tex: { top: 'log_acacia_top', side: 'log_acacia' }, hard: 2, tool: 'axe', sound: 'wood', tree: 'log' });
  B({ name: 'leaves_acacia', title: 'Листва акации', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_acacia', tint: TINT.foliage, hard: .2, drop: null, sound: 'grass', tree: 'leaves', decid: true });
  B({ name: 'planks_acacia', title: 'Доски акации', tex: 'planks_acacia', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'sapling_acacia', title: 'Росток акации', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_acacia', hard: 0, sound: 'grass', tree: 'sapling' });
  B({ name: 'log_jungle', axis: true, title: 'Тропическое бревно', tex: { top: 'log_jungle_top', side: 'log_jungle' }, hard: 2, tool: 'axe', sound: 'wood', tree: 'log' });
  B({ name: 'leaves_jungle', title: 'Тропическая листва', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_jungle', tint: TINT.foliage, hard: .2, drop: null, sound: 'grass', tree: 'leaves' });
  B({ name: 'planks_jungle', title: 'Тропические доски', tex: 'planks_jungle', hard: 2, tool: 'axe', sound: 'wood' });
  B({ name: 'sapling_jungle', title: 'Тропический росток', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_jungle', hard: 0, sound: 'grass', tree: 'sapling' });
  B({ name: 'leaves_willow', title: 'Листва ивы', layer: LAYER.cutout, opaque: false, op: 1, tex: 'leaves_willow', tint: TINT.foliage, hard: .2, drop: null, sound: 'grass', tree: 'leaves', decid: true });
  B({ name: 'sapling_willow', title: 'Росток ивы', shape: SHAPE.cross, layer: LAYER.cutout, solid: false, opaque: false, op: 0, tex: 'sapling_willow', hard: 0, sound: 'grass', tree: 'sapling' });
  for (const [w, t] of [['oak', 'Тонкая дубовая ветка'], ['birch', 'Тонкая берёзовая ветка'], ['spruce', 'Тонкая еловая ветка'], ['acacia', 'Тонкая ветка акации'], ['jungle', 'Тонкая тропическая ветка']])
    B({ name: 'log_' + w + '_thin', axis: true, title: t, shape: SHAPE.branch, opaque: false, op: 0, cullSelf: false, tex: { top: 'log_' + w + '_top', side: 'log_' + w }, hard: 1, tool: 'axe', sound: 'wood', tree: 'thin' });
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
  // бой (22.10.2026, docs/COMBAT.md): щит — только в левой руке (блок и отбив), лук — двумя руками (стрелы), кремень и волокно —
  // из гравия и травы. grip — хват (D37E.combat: 'one' | 'two' | 'off'); у щита и лука «инструмент» — ради износа (dur)
  I({ name: 'flint', title: 'Кремень', tex: 'item_flint' });
  I({ name: 'fiber', title: 'Волокно', tex: 'item_fiber' });
  I({ name: 'arrow', title: 'Стрела', tex: 'item_arrow' });
  I({ name: 'bow', title: 'Лук', tex: 'item_bow', stack: 1, fuel: 10, grip: 'two', tool: { kind: 'bow', tier: 0, speed: 1, dur: 384, dmg: 1 } });
  I({ name: 'shield', title: 'Щит', tex: 'item_shield', stack: 1, grip: 'off', tool: { kind: 'shield', tier: 0, speed: 1, dur: 336, dmg: 1 } });
  // ── Помощники (T-049; владелец 22.10: «чтобы место не занимало и надо было потрудиться»): аксессуары надевают в отдельные ячейки
  //    (не в сумку и не на панель) — действуют, пока надеты; acc — действия (D37E.accessories.FX). Сочетаются на верстаке: часы +
  //    компас + глубиномер → навигатор (одна ячейка вместо трёх); атлас — компас и 8 листов карты из разных мест ──
  I({ name: 'watch', title: 'Часы', tex: 'item_watch', stack: 1, acc: ['time'] });
  I({ name: 'compass', title: 'Компас', tex: 'item_compass', stack: 1, acc: ['dir'] });
  I({ name: 'depth_meter', title: 'Глубиномер', tex: 'item_depth_meter', stack: 1, acc: ['depth'] });
  I({ name: 'lens', title: 'Лупа', tex: 'item_lens', stack: 1, acc: ['target'] });
  I({ name: 'ore_finder', title: 'Рудоискатель', tex: 'item_ore_finder', stack: 1, acc: ['ore'] });
  I({ name: 'navigator', title: 'Навигатор', tex: 'item_navigator', stack: 1, acc: ['time', 'dir', 'depth'] });
  I({ name: 'atlas', title: 'Атлас', tex: 'item_atlas', stack: 1, acc: ['map', 'dir'] });
  // бумага и карты: «Чистый лист карты» зарисовывают (ПКМ) — только в месте, где ещё не рисовал (так атлас — правда из разных мест)
  I({ name: 'parchment', title: 'Пергамент', tex: 'item_parchment', fuel: 3 });
  I({ name: 'map_blank', title: 'Чистый лист карты', tex: 'item_map_blank', stack: 16, use: 'map' });
  I({ name: 'map_filled', title: 'Лист карты', tex: 'item_map_filled', stack: 16 });
  // книга мастера — прочитать (ПКМ): навсегда открывает полную книгу рецептов; свиток возврата — расходный телепорт домой (делать каждый раз)
  I({ name: 'master_book', title: 'Книга мастера', tex: 'item_master_book', stack: 1, use: 'learn' });
  I({ name: 'recall', title: 'Свиток возврата', tex: 'item_recall', stack: 16, use: 'recall' });
  // вёдра: черпнуть источник воды или лавы, вылить в другом месте
  I({ name: 'bucket', title: 'Ведро', tex: 'item_bucket', stack: 16, use: 'bucket' });
  I({ name: 'bucket_water', title: 'Ведро воды', tex: 'item_bucket_water', stack: 1, use: 'pour', liquid: 'water' });
  I({ name: 'bucket_lava', title: 'Ведро лавы', tex: 'item_bucket_lava', stack: 1, use: 'pour', liquid: 'lava' });
  // огниво (T-022d): ПКМ — поджечь блок (горючий — загорится сам, негорючий — огонь на нём); 64 раза
  I({ name: 'flint_steel', title: 'Огниво', tex: 'item_flint_steel', stack: 1, use: 'ignite', dur: 64 });
  V.VANILLA_ITEMS = V.items.length;

  // ═══ Рецепты (верстак 3×3, в руках 2×2) и печь ═══
  // shaped: { pattern: ['##', '##'], key: { '#': 'planks' }, out: 'crafting_table', n: 1 }; shapeless: { list: [...], out, n }.
  // Группы вещей: 'planks' — любые доски, 'log' — любое бревно (#tag)
  V.TAGS = { planks: ['planks_oak', 'planks_birch', 'planks_spruce', 'planks_acacia', 'planks_jungle'], log: ['log_oak', 'log_birch', 'log_spruce', 'log_acacia', 'log_jungle', 'log_oak_thin', 'log_birch_thin', 'log_spruce_thin', 'log_acacia_thin', 'log_jungle_thin'], coal: ['coal'] };
  V.recipes = []; V.smelting = new Map();
  V.addRecipe = r => { V.recipes.push(r); return r; };
  V.addSmelt = (input, out, time = 6, n = 1) => { V.smelting.set(input, { out, time, n: Math.max(1, n | 0) }); };   // n — сколько выходит (рецепт мода)
  const R = r => V.addRecipe(r);
  R({ list: ['log_oak'], out: 'planks_oak', n: 4 }); R({ list: ['log_birch'], out: 'planks_birch', n: 4 }); R({ list: ['log_spruce'], out: 'planks_spruce', n: 4 });
  R({ list: ['log_acacia'], out: 'planks_acacia', n: 4 }); R({ list: ['log_jungle'], out: 'planks_jungle', n: 4 });   // T-022b: новые породы; тонкая ветка — 2 доски своей породы
  for (const w of ['oak', 'birch', 'spruce', 'acacia', 'jungle']) R({ list: ['log_' + w + '_thin'], out: 'planks_' + w, n: 2 });
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
  R({ pattern: ['#i#', '###', ' # '], key: { '#': '#planks', i: 'iron_ingot' }, out: 'shield', n: 1 });
  R({ pattern: [' |f', '| f', ' |f'], key: { '|': 'stick', f: 'fiber' }, out: 'bow', n: 1, mirror: true });
  R({ pattern: ['k', '|', 'p'], key: { k: 'flint', '|': 'stick', p: 'feather' }, out: 'arrow', n: 4 });
  R({ pattern: ['k', '|', 'p'], key: { k: 'cobble', '|': 'stick', p: 'feather' }, out: 'arrow', n: 2 });   // без кремня — из булыжника, меньше
  V.addSmelt('ore_iron', 'iron_ingot'); V.addSmelt('ore_gold', 'gold_ingot'); V.addSmelt('sand', 'glass'); V.addSmelt('cobble', 'stone');
  V.addSmelt('clay_ball', 'brick'); V.addSmelt('meat_raw', 'meat_cooked'); V.addSmelt('chicken_raw', 'chicken_cooked');
  V.addSmelt('log_oak', 'coal'); V.addSmelt('log_birch', 'coal'); V.addSmelt('log_spruce', 'coal'); V.addSmelt('log_acacia', 'coal'); V.addSmelt('log_jungle', 'coal');
  // помощники и удобства (T-049; рецепты свои): пергамент — из волокна (трава), карты, аксессуары, книга мастера, свиток, ведро, лежанка
  R({ list: ['fiber', 'fiber', 'fiber'], out: 'parchment', n: 1 });
  R({ list: ['parchment', 'coal'], out: 'map_blank', n: 1 });
  R({ pattern: ['mmm', 'mcm', 'mmm'], key: { m: 'map_filled', c: 'compass' }, out: 'atlas', n: 1 });
  R({ pattern: [' i ', 'igi', ' i '], key: { i: 'iron_ingot', g: 'glass' }, out: 'watch', n: 1 });
  R({ pattern: [' i ', 'iki', ' i '], key: { i: 'iron_ingot', k: 'flint' }, out: 'compass', n: 1 });
  R({ pattern: [' g ', 'gig', ' g '], key: { i: 'iron_ingot', g: 'glass' }, out: 'depth_meter', n: 1 });
  R({ pattern: [' G ', 'GgG', ' | '], key: { G: 'gold_ingot', g: 'glass', '|': 'stick' }, out: 'lens', n: 1 });
  R({ pattern: [' G ', 'GcG', 'i i'], key: { G: 'gold_ingot', c: 'compass', i: 'iron_ingot' }, out: 'ore_finder', n: 1 });
  R({ list: ['watch', 'compass', 'depth_meter'], out: 'navigator', n: 1, table: true });
  R({ list: ['parchment', 'parchment', 'parchment', 'iron_ingot', 'coal'], out: 'master_book', n: 1 });
  R({ list: ['parchment', 'flint', 'feather'], out: 'recall', n: 1 });
  R({ pattern: ['i i', ' i '], key: { i: 'iron_ingot' }, out: 'bucket', n: 1 });
  R({ pattern: ['fff', 'ppp'], key: { f: 'fiber', p: '#planks' }, out: 'bed', n: 1 });
  R({ list: ['iron_ingot', 'flint'], out: 'flint_steel', n: 1 });   // огниво (T-022d)
  V.VANILLA_RECIPES = V.recipes.length;
  // Что выпадает сверх обычного «drop» блока (данные — их же читает книга рецептов «Где взять»): [вещь, шанс, сколько, вместо обычного]
  // — каждая строка бросается отдельно. Кремень — из гравия (10 %, вместо гравия), волокно — из травы, ростки и яблоки — из листвы
  V.DROPS = {
    gravel: [['flint', .1, 1, true]], tall_grass: [['fiber', .15, 1]], clay: [['clay_ball', 1, 4, true]],
    leaves_oak: [['sapling_oak', .05, 1], ['apple', .02, 1]], leaves_birch: [['sapling_birch', .05, 1]], leaves_spruce: [['sapling_spruce', .05, 1]],
    charred_planks: [['coal', .35, 1]],   // обугленные доски — иногда уголь (T-022d)
    leaves_acacia: [['sapling_acacia', .05, 1]], leaves_jungle: [['sapling_jungle', .03, 1]], leaves_willow: [['sapling_willow', .05, 1]],
  };
  // Горючесть блока для огня (T-022d, D37E.fire): ключ материала огня или '' — не горит. Только по полям блока, без списков имён —
  // новые блоки (моды, новые деревья) горят сами: b.burn (своё: 'wood' | 'planks' | 'leaves' | 'grass' | 'turf' | 'cloth' | 'fuel' |
  // 'char' | 'flame'; '' или 'none' — не горит) главнее; иначе: жидкость, светящийся, стекло — не горит; растение-крест — трава;
  // листва (вырезное с оттенком листвы или foliage) — листва; звук «дерево»: с осью (бревно, ствол) — дерево, без оси — доски
  // (верстак, сундук, лестница, дверь); шерсть (куб, не прыгучий) — ткань; дёрн (куб с оттенком травы и звуком травы) — горит
  // трава сверху. Читает поля: burn, liquid, emit, glass, shape, foliage, layer, tint, sound, axis, bounce
  V.burnOf = b => {
    if (!b) return '';
    if (b.burn !== undefined) return b.burn && b.burn !== 'none' ? String(b.burn) : '';
    if (b.liquid || b.emit > 0 || b.glass) return '';
    if (b.shape === SHAPE.cross) return 'grass';
    if (b.foliage || (b.layer === LAYER.cutout && (b.tint === TINT.foliage || b.tint === TINT.birch || b.tint === TINT.spruce))) return 'leaves';
    if (b.sound === 'wood') return b.axis ? 'wood' : 'planks';
    if (b.sound === 'wool' && b.shape === SHAPE.cube && !b.bounce) return 'cloth';
    if (b.shape === SHAPE.cube && b.tint === TINT.grass && b.sound === 'grass') return 'turf';
    return '';
  };
  // Что выпадает из блока b: [[имя, сколько]] (rnd — свой генератор, по умолчанию Math.random). Инструмент проверяет вызывающий
  V.dropsOf = (b, rnd = Math.random) => {
    const out = [], extra = b && V.DROPS[b.name];
    let replaced = false;
    if (extra) for (const [id, p, n, rep] of extra) if (V.item(id) && rnd() < p) { out.push([id, n || 1]); if (rep) replaced = true; }
    if (!replaced && b && b.drop && V.item(b.drop)) out.push([b.drop, 1]);
    return out;
  };

  const tagHas = (k, name) => k[0] === '#' ? (V.TAGS[k.slice(1)] || []).includes(name) : k === name;
  V.tagHas = tagHas;
  // Ускоритель (T-049, план §4.2 H1): рецепты разложены по «форме» — размер и какие клетки заняты (и зеркально) — и по вещи в первой
  // занятой клетке (метка вроде #доски — общая корзина формы: её члены смотрим при проверке, моды могут их дописать); списки — по
  // числу вещей. V.craft проверяет только подходящие — в том же порядке, что и раньше (первый подошедший — как был). Указатель
  // строится заново, когда список рецептов поменялся (моды: другая длина или другой последний рецепт)
  let CI = null;
  const craftIndex = () => {
    const L = V.recipes, last = L[L.length - 1];
    if (CI && CI.n === L.length && CI.last === last) return CI;
    const shape = new Map(), list = new Map(), add = (m, k, i) => { let a = m.get(k); if (!a) m.set(k, a = []); if (a[a.length - 1] !== i) a.push(i); };
    L.forEach((r, i) => {
      if (r.list) { add(list, r.list.length, i); return; }
      const P = r.pattern, rh = P.length, rw = Math.max(...P.map(s => s.length));
      for (const mir of r.mirror === false ? [false] : [false, true]) {
        let m = 0, first = null;
        for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const ch = P[y][mir ? rw - 1 - x : x] || ' '; if (ch !== ' ') { m |= 1 << (y * rw + x); if (first === null) first = (r.key && r.key[ch]) || ''; } }
        add(shape, rw + 'x' + rh + ':' + m + (first && first[0] !== '#' ? '|' + first : '|#'), i);
      }
    });
    return (CI = { n: L.length, last, shape, list });
  };
  // Сетка верстака (массив имён или null, w×h) → { out, n, recipe } или null
  V.craft = (grid, w, h) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
    let mask = 0, nf = 0, first = null;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = grid[y * w + x]; if (v) { mask |= 1 << ((y - y0) * cw + (x - x0)); nf++; if (first === null) first = v; } }
    const I = craftIndex(), k = cw + 'x' + chh + ':' + mask, a = I.shape.get(k + '|' + first), t = I.shape.get(k + '|#'), b = I.list.get(nf);
    if (!a && !t && !b) return null;
    // кандидаты — по порядку рецептов (слить упорядоченные списки, без повторов)
    let cand = a || t || b;
    if ((a ? 1 : 0) + (t ? 1 : 0) + (b ? 1 : 0) > 1) { cand = []; for (const q of [a, t, b]) if (q) for (const i of q) cand.push(i); cand.sort((p, q) => p - q); let n = 0; for (let i = 0; i < cand.length; i++) if (!i || cand[i] !== cand[i - 1]) cand[n++] = cand[i]; cand.length = n; }
    return craftScan(grid, w, h, cand);
  };
  // Старый перебор всех рецептов (для проверки ускорителя: scripts/kubomir-qol-test.cjs сравнивает оба на всех рецептах и 5000 сетках)
  V.craftLinear = (grid, w, h) => craftScan(grid, w, h, null);
  function craftScan(grid, w, h, only){
    // обрезать пустые края
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const cw = x1 - x0 + 1, chh = y1 - y0 + 1, cells = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(grid[y * w + x] || null);
    const filled = cells.filter(Boolean);
    const L = V.recipes, N = only ? only.length : L.length;
    for (let ri = 0; ri < N; ri++) {
      const r = only ? L[only[ri]] : L[ri];
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
  }

  // ═══ Таблицы для сетки и света (V.compile — после модов; их же получают потоки) ═══
  const LCOL0 = [1, .95, .84];   // свет без своего цвета — тёплый белый
  V.compile = () => {
    const n = V.blocks.length, T = {
      n, shape: new Uint8Array(n), layer: new Uint8Array(n), solid: new Uint8Array(n), opaque: new Uint8Array(n), op: new Uint8Array(n), emit: new Uint8Array(n),
      tint: new Uint8Array(n), cullSelf: new Uint8Array(n), liquid: new Uint8Array(n), climb: new Uint8Array(n), axis: new Uint8Array(n),
      tex: new Int16Array(n * 7),   // top, bottom, side, front, back, extra, (запас)
      ecol: new Uint8Array(n * 3),  // цветной свет блока: R, G, B (0…255 = уровень × 17; самый яркий канал = emit × 17)
      stream: new Uint8Array(n),    // сетка (V.LAYERS): 0 solid, 1 cutout, 2 water, 3 foliage (листва, трава, цветы), 4 glass
      tree: new Uint8Array(n),      // деревья (T-022b): 1 бревно, 2 тонкая ветка, 3 листва, 4 росток
      decid: new Uint8Array(n),     // листва опадает зимой (сетка чанка: «голые» лиственные — V.meshChunk, bare)
      glowL: new Uint8Array(V.tex.length + 1),   // текстура светится сама (0…15): факел, лава, лампа, «перед» горящей печи
    };
    for (const b of V.blocks) {
      const i = b.id;
      T.shape[i] = b.shape; T.layer[i] = b.layer; T.solid[i] = b.solid ? 1 : 0; T.opaque[i] = b.opaque ? 1 : 0;
      T.op[i] = Math.max(0, Math.min(15, b.opaque ? 15 : b.op | 0)); T.emit[i] = Math.max(0, Math.min(15, b.emit | 0));
      T.tree[i] = b.tree === 'log' ? 1 : b.tree === 'thin' ? 2 : b.tree === 'leaves' ? 3 : b.tree === 'sapling' ? 4 : 0; T.decid[i] = b.decid ? 1 : 0;
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
  const BRANCH_BOX = [[.3125, 0, .3125, .6875, 1, .6875], [0, .3125, .3125, 1, .6875, .6875], [.3125, .3125, 0, .6875, .6875, 1]];
  V.BRANCH_W = [.3125, .6875];   // толщина тонкой ветки (доли блока): сетка и вещь
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
      case SHAPE.branch: return BRANCH_BOX[s & 3] || BRANCH_BOX[0];   // тонкая ветка: брусок 6/16 вдоль оси (по нему можно пройти)
      default: return FULL;
    }
  };

  // ═══ Лёд времён года (21.10.2026: владелец застрял подо льдом и не мог его сломать). V.iceTest(W, x, y, z, v) ставит игра
  // («Кубомир»: kubomir-weather.js — мороз, проруби, климат места): верхняя клетка воды под открытым небом — лёд, но блок мира
  // не меняется (вода). Лёд держит СВЕРХУ: на него можно встать (до глади, 0,875), сбоку он стенка (у края — залезть, E.grip),
  // а СНИЗУ — нет: всплываешь — проламываешь (прорубь — игра), подо льдом не запереть. Луч прицела его видит — можно разбить ═══
  const iceAt = (W, x, y, z, v) => !!V.iceTest && V.T.liquid[v & TYPE] === 1 && !!V.iceTest(W, x, y, z, v);
  V.isIce = (W, x, y, z, v) => { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); if (v === undefined) v = W.raw(x, y, z); return v > 0 && iceAt(W, x, y, z, v); };
  const ICE_BOX = [];   // рамки льда по высоте глади — общие (только читать)
  V.iceBox = v => { const h = V.liquidHeight(v), k = Math.round(h * 64); return ICE_BOX[k] || (ICE_BOX[k] = [0, 0, 0, 1, h, 1]); };

  // ═══ Луч по блокам (DDA): первый блок, у которого есть рамка (и pick(тип) не против) ═══
  // → { x, y, z, nx, ny, nz, t, v } или null. Вода и воздух пропускаются (pick может разрешить воду). Без pick лёд времён
  // года — цель (прицел: разбить, поставить блок на лёд): тогда ещё ice: true и box — его рамка.
  // T-138 (ревью D1, D7): W.bodyAt(x, y, z) — тело в полёте / в крене / повисшее (kubomir-topple.js): клетка воздуха мира, которую
  // занимает тело (по его позе), → значение блока тела (0 — нет); луч прицела видит тело (hit.body), moveBox упирается в него.
  // V.cutsOn — надрубы (плитка .cut — восьмые клетки с 6 сторон): луч и столкновения — по коробке без снятого (как рисует сетка).
  // Нет тел / надрубов — как было (W.bodyAt не задан, V.cutsOn = false)
  V.cutsOn = false;
  const CUTB = [0, 0, 0, 1, 1, 1];
  // коробка надрубленного кубика: c — срез (6 × 4 бита: +x, −x, +y, −y, +z, −z) → out (доли блока)
  const cutBox = (c, out) => { out[0] = ((c >>> 4) & 15) / 8; out[3] = 1 - (c & 15) / 8; out[1] = ((c >>> 12) & 15) / 8; out[4] = 1 - ((c >>> 8) & 15) / 8; out[2] = ((c >>> 20) & 15) / 8; out[5] = 1 - ((c >>> 16) & 15) / 8; return out; };
  V.cutBox = cutBox;
  const cutOf = (W, x, y, z) => { if (!W.tile) return 0; const t = W.tile(x, y, z); return t && t.cut ? t.cut | 0 : 0; };
  V.raycast = (W, ox, oy, oz, dx, dy, dz, maxT, pick) => {
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tx = dx ? ((dx > 0 ? x + 1 - ox : ox - x) * tdx) : Infinity, ty = dy ? ((dy > 0 ? y + 1 - oy : oy - y) * tdy) : Infinity, tz = dz ? ((dz > 0 ? z + 1 - oz : oz - z) * tdz) : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    const BA = W.bodyAt || null;
    for (let n = 0; n < 512 && t <= maxT; n++) {
      const v = W.raw(x, y, z);
      if (v > 0) {
        const tp = v & TYPE;
        if (!pick || pick(tp, v)) {
          let bx = V.boxOf(v, false) || (pick && V.T.liquid[tp] ? [0, 0, 0, 1, .875, 1] : null), ice = false;
          if (!bx && !pick && V.iceTest && iceAt(W, x, y, z, v)) { bx = V.iceBox(v); ice = true; }
          if (bx === FULL && V.cutsOn) { const c = cutOf(W, x, y, z); if (c) bx = cutBox(c, CUTB); }   // надрубленный — по коробке без снятого
          if (bx) {
            if (bx === FULL) return { x, y, z, nx, ny, nz, t, v };
            const h = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, bx);
            if (h && h.t <= maxT) { const r = { x, y, z, nx: h.nx, ny: h.ny, nz: h.nz, t: h.t, v }; if (bx === CUTB) r.box = CUTB.slice(); if (ice) { r.ice = true; r.box = bx; if (!(h.nx || h.ny || h.nz)) r.ny = oy >= y + bx[4] ? 1 : -1; } return r; }
          }
        }
      } else if (v < 0) return null;   // не загружено
      else if (BA !== null) { const bv = BA(x, y, z); if (bv > 0 && (!pick || pick(bv & TYPE, bv))) return { x, y, z, nx, ny, nz, t, v: bv, body: true }; }   // тело в крене / полёте / повисшее
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
  // ice — лёд времён года (V.iceTest) считается твёрдым: при падении на него сверху (стоять) и сбоку (стенка у края);
  // снизу (всплыл) — нет: подо льдом не запереть (прорубь делает игра), V.boxHits его тоже не считает (не «застрял в блоке»)
  // v — уже прочитанная клетка (W.raw): moveBox читает столбец сам, без поиска чанка на каждую клетку
  const solidV = (W, v, x, y, z, out, ice) => {
    if (v < 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = 1; out[5] = 1; return true; }
    const t = v & TYPE;
    if (!V.T.solid[t]) {
      if (ice && iceAt(W, x, y, z, v)) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = V.liquidHeight(v); out[5] = 1; return true; }
      return false;
    }
    const bx = V.boxOf(v, true); if (!bx) return false;
    for (let i = 0; i < 6; i++) out[i] = bx[i];
    return true;
  };
  const solidBox = (W, x, y, z, out, ice) => solidV(W, W.raw(x, y, z), x, y, z, out, ice);
  V.solidBox = solidBox;
  const BX = [0, 0, 0, 0, 0, 0];
  // столбец (x, z) для moveBox: у настоящего мира (V.World со своим raw) чанк ищется один раз на столбец, клетка — как W.raw
  // (ниже 0 — коренная порода, выше — воздух, нет чанка — −1, «стена»); любой другой мир (свой raw: проверки, моды) — его raw
  const RAW = World.prototype.raw;
  let colC = null, colI = 0, colW = null, colX = 0, colZ = 0, colOX = 0, colOZ = 0, OVF = null, CUTW = null;
  const colAt = (W, x, z) => {
    colOX = x; colOZ = z;
    if (W.raw === RAW) { const c = W.chunk(x >> 4, z >> 4); colC = c && c.gen ? c : null; colI = ((x & 15) << 11) | ((z & 15) << 7); colW = null; }
    else { colW = W; colX = x; colZ = z; }
  };
  // воздух мира — может быть занят телом (W.bodyAt, T-138): столкновение с ним — как с блоком
  const cellV = y => { const v = colW !== null ? colW.raw(colX, y, colZ) : y < 0 ? 7 : y >= H ? 0 : colC !== null ? colC.ids[colI | y] : -1; return v === 0 && OVF !== null ? OVF(colOX, y, colOZ) : v; };
  // надрубленный кубик (V.cutsOn): коробка столкновений — без снятого (плитка клетки столбца)
  const cutAdj = (y, out) => {
    let t;
    if (colC !== null) { const m = colC.tiles; if (!m || m.size === 0) return; t = m.get(colI | y); }
    else if (CUTW !== null && CUTW.tile) t = CUTW.tile(colOX, y, colOZ);
    else return;
    if (!t || !t.cut || out[0] !== 0 || out[1] !== 0 || out[2] !== 0 || out[3] !== 1 || out[4] !== 1 || out[5] !== 1) return;
    cutBox(t.cut | 0, out);
  };
  // Сдвиг — через типизированный массив: V.moveBox маленькая (встраивается у вызывающего), большая часть — moveCore(W, b) без
  // дробных аргументов (дробное в аргументе невстроенной функции V8 заворачивает в новый HeapNumber — по 16 байт на сдвиг)
  const MD = new Float64Array(3);
  V.moveBox = (W, b, dx, dy, dz) => { MD[0] = dx; MD[1] = dy; MD[2] = dz; return moveCore(W, b); };
  function moveCore(W, b){
    const dx = MD[0], dy = MD[1], dz = MD[2];
    const hw = b.w / 2, EPS = 1e-4, ice = !!V.iceTest, cuts = V.cutsOn;
    OVF = W.bodyAt || null; CUTW = W;
    b.hitX = b.hitY = b.hitZ = false;
    // по y
    if (dy) {
      const x0 = Math.floor(b.x - hw + EPS) | 0, x1 = Math.floor(b.x + hw - EPS) | 0, z0 = Math.floor(b.z - hw + EPS) | 0, z1 = Math.floor(b.z + hw - EPS) | 0;
      let ny = b.y + dy;
      const ya = Math.floor((b.y < ny ? b.y : ny) - 1) | 0, yb = Math.floor((dy > 0 ? ny : b.y) + b.h + 1) | 0, icy = ice && dy < 0;   // min/max — сравнением (Math.min/max в V8 без TurboFan — с «коробками»)
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        colAt(W, x, z);
        for (let y = ya; y <= yb; y++) {
          if (!solidV(W, cellV(y), x, y, z, BX, icy)) continue;
          if (cuts) cutAdj(y, BX);
          if (b.x + hw <= x + BX[0] + EPS || b.x - hw >= x + BX[3] - EPS || b.z + hw <= z + BX[2] + EPS || b.z - hw >= z + BX[5] - EPS) continue;
          const top = y + BX[4], bot = y + BX[1];
          if (dy < 0 && b.y >= top - EPS && ny < top) { ny = top; b.hitY = true; }
          else if (dy > 0 && b.y + b.h <= bot + EPS && ny + b.h > bot) { ny = bot - b.h; b.hitY = true; }
        }
      }
      b.y = ny;
    }
    // по x, потом по z — два прохода без общего цикла «по оси» (22.10.2026: тот цикл с выбором оси на каждом шаге и поиск
    // чанка на каждую клетку — мусор и лишняя работа: ~0,25 КБ на вызов без TurboFan). Целые клетки — Math.floor(…) | 0
    if (dx) {
      const y0 = Math.floor(b.y + EPS) | 0, y1 = Math.floor(b.y + b.h - EPS) | 0, p = b.x, q = b.z;
      let np = p + dx;
      const pa = Math.floor((dx < 0 ? np : p) - hw - 1) | 0, pb = Math.floor((dx > 0 ? np : p) + hw + 1) | 0, q0 = Math.floor(q - hw + EPS) | 0, q1 = Math.floor(q + hw - EPS) | 0;
      for (let x = pa; x <= pb; x++) for (let z = q0; z <= q1; z++) {
        colAt(W, x, z);
        for (let y = y0; y <= y1; y++) {
          if (!solidV(W, cellV(y), x, y, z, BX, ice)) continue;
          if (cuts) cutAdj(y, BX);
          if (b.y + b.h <= y + BX[1] + EPS || b.y >= y + BX[4] - EPS) continue;
          if (q + hw <= z + BX[2] + EPS || q - hw >= z + BX[5] - EPS) continue;
          const lo = x + BX[0], hi = x + BX[3];
          if (dx > 0 && p + hw <= lo + EPS && np + hw > lo) { np = lo - hw; b.hitX = true; }
          else if (dx < 0 && p - hw >= hi - EPS && np - hw < hi) { np = hi + hw; b.hitX = true; }
        }
      }
      b.x = np;
    }
    if (dz) {
      const y0 = Math.floor(b.y + EPS) | 0, y1 = Math.floor(b.y + b.h - EPS) | 0, p = b.z, q = b.x;
      let np = p + dz;
      const pa = Math.floor((dz < 0 ? np : p) - hw - 1) | 0, pb = Math.floor((dz > 0 ? np : p) + hw + 1) | 0, q0 = Math.floor(q - hw + EPS) | 0, q1 = Math.floor(q + hw - EPS) | 0;
      for (let z = pa; z <= pb; z++) for (let x = q0; x <= q1; x++) {
        colAt(W, x, z);
        for (let y = y0; y <= y1; y++) {
          if (!solidV(W, cellV(y), x, y, z, BX, ice)) continue;
          if (cuts) cutAdj(y, BX);
          if (b.y + b.h <= y + BX[1] + EPS || b.y >= y + BX[4] - EPS) continue;
          if (q + hw <= x + BX[0] + EPS || q - hw >= x + BX[3] - EPS) continue;
          const lo = z + BX[2], hi = z + BX[5];
          if (dz > 0 && p + hw <= lo + EPS && np + hw > lo) { np = lo - hw; b.hitZ = true; }
          else if (dz < 0 && p - hw >= hi - EPS && np - hw < hi) { np = hi + hw; b.hitZ = true; }
        }
      }
      b.z = np;
    }
    colC = null; colW = null; OVF = null; CUTW = null;   // чанк и мир не держим (их могли выгрузить)
    return b;
  }
  // Пересекается ли коробка с твёрдым (нельзя поставить блок туда, где стоит игрок; встать после приседа); ice — и лёд времён
  // года (есть ли опора под ногами — красться у края проруби); без него лёд не «застрял в блоке»
  V.boxHits = (W, x, y, z, w, h, ice) => {
    const hw = w / 2, EPS = 1e-3, ic = !!ice && !!V.iceTest;
    for (let bx = Math.floor(x - hw + EPS); bx <= Math.floor(x + hw - EPS); bx++) for (let bz = Math.floor(z - hw + EPS); bz <= Math.floor(z + hw - EPS); bz++)
      for (let by = Math.floor(y + EPS); by <= Math.floor(y + h - EPS); by++) {
        if (!solidBox(W, bx, by, bz, BX, ic)) continue;
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
    // под ногами: подброс / скользко / свой блок мода; стоит на льду времён года — как на блоке льда (скользко, звук стекла)
    const fx = Math.floor(x), fy = Math.floor(y - .05), fz = Math.floor(z), fv = W.raw(fx, fy, fz);
    out.onIce = false;
    if (fv > 0 && T.liquid[fv & TYPE] === 1 && V.iceTest && y >= fy + V.liquidHeight(fv) - .06 && iceAt(W, fx, fy, fz, fv)) { const ib = V.byName.get('ice'); out.under = ib ? ib.id : 0; out.slip = ib ? ib.slip || 0 : 0; out.onIce = true; }
    else if (fv > 0) { const b = V.blocks[fv & TYPE]; out.under = fv & TYPE; if (b.bounce) out.bounce = b.bounce; out.slip = b.slip || 0; if (b.mod && !out.blocks.includes(out.under)) out.blocks.push(out.under); } else { out.under = 0; out.slip = 0; }
    return out;
  };
  // Высота жидкости в блоке (0…1): источник и падающая — 0,875, течение — меньше с расстоянием
  // разбор света клетки (W.lightAt): небо, цвет блоков и самая яркая составляющая
  V.lSky = L => (L >>> 12) & 15; V.lR = L => (L >>> 8) & 15; V.lG = L => (L >>> 4) & 15; V.lB = L => L & 15;
  V.lBlk = L => Math.max((L >>> 8) & 15, (L >>> 4) & 15, L & 15);
  V.liquidHeight = v => { const s = v >>> 12; if (s === 0 || s >= 8) return .875; return Math.max(.1, .875 * (8 - s) / 8); };

  // ═══ Паркур движка на кубиках (21.10.2026, «один движок»): E.grip из player.js (findLedge, ledgeAt, roomOnTop, findVault)
  // спрашивает у мира три вещи — луч, «влезет ли тело», опору. G = V.gripPhys(W) → { raycast, blocked, supportAt } отвечает
  // по рамкам столкновений блоков, как V.moveBox: незагруженное — стена; лёд времён года — опора сверху и стенка сбоку (за край
  // проруби можно зацепиться и вылезти), снизу и как потолок его нет. Ответы — как у physics.js: raycast → { t, x, y, z, nx, ny,
  // nz, col } (рамку, внутри которой луч начался, не видит — как в Unity), blocked(x, z, y0, y1, r) — есть ли твёрдое в
  // вертикальном цилиндре, supportAt(x, z, r, yMax) → { y, col } — самый высокий верх рамки не выше yMax под кругом (r × 0,7) ═══
  V.gripPhys = W => {
    const B = [0, 0, 0, 0, 0, 0], COL = { voxel: 1 }, SH = { t: 0, nx: 0, ny: 0, nz: 0 }, SUP = { y: 0, col: null };   // ответ опоры — общий (читать сразу)
    // луч против рамки клетки (в её координатах): вход t ≥ 0 — попал; начался внутри (t < 0) — не видит
    function slab(ox, oy, oz, dx, dy, dz, b){
      let t0 = -Infinity, t1 = Infinity, ax = 0, sg = 0;
      for (let k = 0; k < 3; k++) {
        const o = k === 0 ? ox : k === 1 ? oy : oz, d = k === 0 ? dx : k === 1 ? dy : dz, lo = b[k], hi = b[k + 3];
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
        let a = (lo - o) / d, c = (hi - o) / d, s = -1;
        if (a > c) { const q = a; a = c; c = q; s = 1; }
        if (a > t0) { t0 = a; ax = k; sg = d > 0 ? -1 : 1; }
        if (c < t1) t1 = c;
        if (t0 > t1) return null;
        void s;
      }
      if (t0 < 0 || t1 < 0) return null;
      SH.t = t0; SH.nx = ax === 0 ? sg : 0; SH.ny = ax === 1 ? sg : 0; SH.nz = ax === 2 ? sg : 0;
      return SH;
    }
    const raycast = (ox, oy, oz, dx, dy, dz, maxT = 64) => {
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
      let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity, ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity, tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
      const ice = !!V.iceTest && dy < .5;   // лёд — не потолок: снизу его нет
      // начался внутри твёрдого — вся сплошная толща по лучу (стена из блоков = одно тело движка) не видна, пока луч не выйдет
      // в пустоту: иначе в стене нашлись бы ложные «верхи» (верх блока под соседним блоком)
      let skip = solidBox(W, x, y, z, B, ice) && inBox(ox - x, oy - y, oz - z, B), t = 0;
      for (let n = 0; n < 400; n++) {
        const sol = n === 0 ? skip || solidBox(W, x, y, z, B, ice) : solidBox(W, x, y, z, B, ice);
        if (skip && n > 0) skip = sol && inBox(ox + dx * t - x, oy + dy * t - y, oz + dz * t - z, B);
        if (sol && !skip) {
          const h = slab(ox - x, oy - y, oz - z, dx, dy, dz, B);
          if (h && h.t <= maxT) return { t: h.t, x: ox + dx * h.t, y: oy + dy * h.t, z: oz + dz * h.t, nx: h.nx, ny: h.ny, nz: h.nz, col: COL };
        }
        if (Math.min(tx, ty, tz) > maxT) return null;
        if (tx <= ty && tx <= tz) { x += sx; t = tx; tx += tdx; } else if (ty <= tz) { y += sy; t = ty; ty += tdy; } else { z += sz; t = tz; tz += tdz; }
        if (y < -2 || y > H + 1) return null;
      }
      return null;
    };
    // точка (в долях клетки) внутри рамки — с запасом на грань (вход в соседнюю клетку — ровно на грани)
    function inBox(px, py, pz, b){ const e = 1e-6; return px >= b[0] - e && px <= b[3] + e && py >= b[1] - e && py <= b[4] + e && pz >= b[2] - e && pz <= b[5] + e; }
    const circle = (x, z, r, bx, bz) => { const cx = Math.max(bx + B[0], Math.min(bx + B[3], x)), cz = Math.max(bz + B[2], Math.min(bz + B[5], z)); return (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r - 1e-9; };
    const blocked = (x, z, y0, y1, r) => {
      const ice = !!V.iceTest;
      for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++)
        for (let by = Math.floor(y0); by <= Math.floor(y1 - 1e-3); by++) {
          if (!solidBox(W, bx, by, bz, B, ice)) continue;
          if (by + B[4] <= y0 + 1e-3 || by + B[1] >= y1 - 1e-3) continue;
          if (circle(x, z, r, bx, bz)) return true;
        }
      return false;
    };
    const supportAt = (x, z, r, yMax) => {
      const rr = r * .7, ice = !!V.iceTest, y1 = Math.floor(yMax);
      let best = -Infinity;
      for (let y = y1; y >= y1 - 48 && y >= -1; y--) {
        for (let bx = Math.floor(x - rr); bx <= Math.floor(x + rr); bx++) for (let bz = Math.floor(z - rr); bz <= Math.floor(z + rr); bz++) {
          if (!solidBox(W, bx, y, bz, B, ice)) continue;
          const top = y + B[4];
          if (top <= yMax + 1e-4 && top > best && (rr <= 0 ? x >= bx + B[0] && x <= bx + B[3] && z >= bz + B[2] && z <= bz + B[5] : circle(x, z, Math.max(rr, 1e-3), bx, bz))) best = top;
        }
        if (best > -Infinity) break;   // нижние слои выше этого не бывают
      }
      SUP.y = best; SUP.col = best > -Infinity ? COL : null;
      return SUP;
    };
    return { W, raycast, blocked, supportAt, voxel: true };
  };

  // ═══ Опора и обрушение (16.10.2026): общее для движков; первое применение — падающие деревья «Кубомира» ═══
  // V.component(W, seeds, o) — связный кусок: обход в ширину по 6 соседям от клеток seeds ([[x, y, z], …]).
  //   o.take(v, x, y, z) — входит ли клетка в кусок; o.edge(v, x, y, z, dy) — сосед не из куска: 0 — ничего (воздух, листва…),
  //   1 — опора (кусок держится: grounded), 2 — чужое (постройка игрока: touch); o.max — клеток больше — null («слишком большое —
  //   не трогаем»); o.depth — не дальше стольких шагов от seeds (листва вокруг ствола). seeds в кусок не входят, если o.take их
  //   не берёт. → { cells: [x, y, z, v, …], n, grounded, touch, box: [x0, y0, z0, x1, y1, z1] }
  const SK = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 256 + y;
  V.supportKey = SK;
  V.component = (W, seeds, o = {}) => {
    const max = o.max || 256, depth = o.depth ?? 1e9, seen = new Set(), cells = [], q = [];
    let n = 0, grounded = false, touch = false, x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (const s of seeds) { const k = SK(s[0], s[1], s[2]); if (!seen.has(k)) { seen.add(k); q.push(s[0], s[1], s[2], 0); } }
    for (let h = 0; h < q.length; h += 4) {
      const x = q[h], y = q[h + 1], z = q[h + 2], d = q[h + 3], v = W.raw(x, y, z);
      if (!(v > 0) || !o.take(v, x, y, z)) continue;
      if (++n > max) return null;
      cells.push(x, y, z, v);
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      for (let i = 0; i < 6; i++) {
        const nx = x + (i === 0 ? 1 : i === 1 ? -1 : 0), ny = y + (i === 2 ? 1 : i === 3 ? -1 : 0), nz = z + (i === 4 ? 1 : i === 5 ? -1 : 0), k = SK(nx, ny, nz);
        if (seen.has(k)) continue;
        const nv = W.raw(nx, ny, nz);
        if (nv > 0 && o.take(nv, nx, ny, nz)) { if (d < depth) { seen.add(k); q.push(nx, ny, nz, d + 1); } continue; }
        const e = o.edge ? o.edge(nv, nx, ny, nz, ny - y) : 0;
        if (e === 1) grounded = true; else if (e === 2) touch = true;
      }
    }
    return { cells, n, grounded, touch, box: [x0, y0, z0, x1, y1, z1] };
  };
  // Запас прочности (на будущее, как в Valheim — обрушение построек; пока только данные, ничего не обрушается): у блока на опоре
  // (земля, коренная порода) — base; каждый шаг вверх теряет up, вбок (над пустотой) — side; стало ≤ 0 — не держится.
  // Материал — по звуку блока (b.sound). Пока падают только деревья (kubomir-ents.js fellTree).
  V.STABILITY = {
    stone: { base: 100, up: 6, side: 18 }, metal: { base: 100, up: 4, side: 12 }, wood: { base: 100, up: 10, side: 20 },
    glass: { base: 60, up: 15, side: 30 }, dirt: { base: 60, up: 20, side: 40 }, grass: { base: 60, up: 20, side: 40 },
    sand: { base: 40, up: 40, side: 100 }, gravel: { base: 40, up: 40, side: 100 }, snow: { base: 40, up: 25, side: 50 }, wool: { base: 50, up: 15, side: 30 },
  };
  V.stabilityOf = b => V.STABILITY[b && b.sound] || V.STABILITY.stone;
})();

// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ — ЯДРО (без DOM): блоки, стены, предметы, рецепты; генерация мира по зерну (свой шум, биомы, пещеры,
//  руды, озёра, лава, деревья, трава, стены фона); свет (небо + источники, заливка, по частям); жидкости и песок;
//  столкновения (углы, потолки, склоны, полублоки, платформы, ступенька); упаковка чанков для сохранения.
// ═══════════════════════════════════════
// Всё внутри одной функции PZ_CORE(): она же уходит в поток (Worker) текстом — генерация и свет считаются там
// (PZ.workerSource()), и в node для тестов (scripts/tiles-test.cjs). Снаружи — window.PZ (готовый экземпляр).
// Мир: x — любое целое (бесконечно в обе стороны), y ≥ 0 вниз (0 — верх неба, вглубь — бесконечно). Чанк — 64×64 клетки.
// Клетка: fg (блок 0…255), wall (стена фона), st (биты 0–3 — форма: 0 целый, 1 полублок, 2 склон «/», 3 склон «\»;
// биты 4–7 — кадр предмета из нескольких клеток), lq (жидкость 0…255), lt (1 вода, 2 лава).
// Свет — 4 байта на клетку: R G B от источников (факелы, лава, кристаллы) + S — «небо» (0…255, цвет неба — по времени суток).
// Детерминизм: генерация — только + − × ÷, floor, imul (без sin/cos/exp): один и тот же мир в любом браузере.
// Номера блоков, стен и порядок полей НЕ МЕНЯТЬ: на них стоят сохранения. Новое — только в конец; блоки модов — с 160.
(function (root) {
'use strict';
function PZ_CORE(){
  'use strict';
  const CS = 64, CB = 6, CM = 63, CA = 4096;
  const SURF = 200;            // средний уровень поверхности (клетки)
  const SKY_LIMIT = 700;       // ниже солнце не достаёт никогда
  const MOD_ID0 = 160;         // первые номера блоков/стен модов
  const key = (cx, cy) => cx * 1048576 + cy;

  // ═══ Хеш и шум (только целая арифметика и полиномы) ═══
  function hash2(x, y, s){
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  const rnd2 = (x, y, s) => hash2(x, y, s) / 4294967296;
  const rnd1 = (x, s) => hash2(x, 0x5bd1e995, s) / 4294967296;
  function noise1(x, s){
    const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    const a = ((hash2(i, 7, s) & 0xffff) / 32767.5 - 1) * f, b = ((hash2(i + 1, 7, s) & 0xffff) / 32767.5 - 1) * (f - 1);
    return (a + (b - a) * u) * 2;
  }
  function grad(ix, iy, s, fx, fy){
    switch (hash2(ix, iy, s) & 7) {
      case 0: return fx + fy; case 1: return fy - fx; case 2: return fx - fy; case 3: return -fx - fy;
      case 4: return fx * 1.4; case 5: return -fx * 1.4; case 6: return fy * 1.4; default: return -fy * 1.4;
    }
  }
  function noise2(x, y, s){
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = grad(ix, iy, s, fx, fy), b = grad(ix + 1, iy, s, fx - 1, fy);
    const c = grad(ix, iy + 1, s, fx, fy - 1), d = grad(ix + 1, iy + 1, s, fx - 1, fy - 1);
    const ab = a + (b - a) * u, cd = c + (d - c) * u;
    return (ab + (cd - ab) * v) * .72;
  }
  function fbm1(x, s, oct){ let sum = 0, amp = 1, norm = 0; for (let i = 0; i < oct; i++) { sum += noise1(x, s + i * 31) * amp; norm += amp; amp *= .5; x *= 2.03; } return sum / norm; }
  const smooth = (a, b, t) => { let k = (t - a) / (b - a); k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k); };

  // ═══ Блоки: [номер, ключ, название, свойства] ═══
  // s: 0 не твёрдый, 1 твёрдый, 2 стоять сверху (платформа, верстак), 3 дверь (закрытая — твёрдая)
  // op: свет — 0 пропускает, 1 гасит (твёрдое), 2 частично (стекло, лёд, листва); l: свечение [r, g, b]
  // h: прочность (сколько «силы кирки» нужно), t: нужный уровень кирки, tool: pick | axe | any (руками, сразу) | hammer
  // d: что выпадает (ключ предмета; '' — ничего; по умолчанию — свой ключ), k: вид — block (края, трава, формы) |
  // obj (несколько клеток, sz [w, h]) | plant (украшение, стоит на опоре) | torch | plat
  // g: группа «одного материала» (шов между разными), grass: цвет травы по открытым сторонам, fall: сыплется,
  // climb: лезть, emis: само светится (0…255), sup: опора — floor | ceil | wall | any, slip: скользко
  const TILE_LIST = [
    [0, 'air', 'Воздух', {}],
    [1, 'dirt', 'Земля', { s: 1, h: 40, pat: 'dirt', c: ['#8b5a34', '#6c4224', '#a3714a'], g: 1 }],
    [2, 'grass', 'Трава', { s: 1, h: 40, d: 'dirt', pat: 'dirt', c: ['#8b5a34', '#6c4224', '#a3714a'], g: 1, grass: '#4fae3c' }],
    [3, 'stone', 'Камень', { s: 1, h: 100, t: 1, pat: 'stone', c: ['#7d7d86', '#62626c', '#9a9aa4'], g: 2 }],
    [4, 'sand', 'Песок', { s: 1, h: 35, pat: 'sand', c: ['#e3c784', '#c9ab68', '#f2dca4'], g: 3, fall: 1 }],
    [5, 'sandstone', 'Песчаник', { s: 1, h: 90, t: 1, pat: 'strata', c: ['#c99a5b', '#a97c45', '#ddb47a'], g: 3 }],
    [6, 'snow', 'Снег', { s: 1, h: 30, pat: 'snow', c: ['#eef4fb', '#cfdcec', '#ffffff'], g: 4 }],
    [7, 'ice', 'Лёд', { s: 1, op: 2, h: 60, t: 1, pat: 'ice', c: ['#9fd3f2', '#79b8e0', '#d9f1ff'], g: 4, slip: 1 }],
    [8, 'mud', 'Ил', { s: 1, h: 40, pat: 'dirt', c: ['#5b4a3c', '#46382c', '#6e5b4a'], g: 5 }],
    [9, 'jgrass', 'Мох джунглей', { s: 1, h: 40, d: 'mud', pat: 'dirt', c: ['#5b4a3c', '#46382c', '#6e5b4a'], g: 5, grass: '#3ccf55' }],
    [10, 'clay', 'Глина', { s: 1, h: 50, pat: 'dirt', c: ['#b4654a', '#94513b', '#c97e62'], g: 6 }],
    [11, 'copper', 'Медная руда', { s: 1, h: 120, t: 1, pat: 'ore', c: ['#7d7d86', '#d9783a', '#ffb07a'], g: 2 }],
    [12, 'iron', 'Железная руда', { s: 1, h: 140, t: 1, pat: 'ore', c: ['#7d7d86', '#b8a59a', '#e8dcd2'], g: 2 }],
    [13, 'silver', 'Серебряная руда', { s: 1, h: 170, t: 2, pat: 'ore', c: ['#7d7d86', '#c9d4de', '#ffffff'], g: 2 }],
    [14, 'gold', 'Золотая руда', { s: 1, h: 190, t: 2, pat: 'ore', c: ['#7d7d86', '#f2c230', '#fff1a0'], g: 2 }],
    [15, 'deepore', 'Глубинит', { s: 1, h: 240, t: 3, pat: 'ore', c: ['#3e4256', '#4f7cff', '#a8c4ff'], g: 7, l: [22, 52, 125], emis: 90 }],
    [16, 'fireore', 'Жарит', { s: 1, h: 300, t: 4, pat: 'ore', c: ['#3a2a2e', '#ff5a1a', '#ffd070'], g: 8, l: [160, 66, 14], emis: 150 }],
    [17, 'obsidian', 'Обсидиан', { s: 1, h: 260, t: 3, pat: 'obsid', c: ['#2a1f3d', '#1a1328', '#6b4fa0'], g: 9 }],
    [18, 'deepstone', 'Глубинный камень', { s: 1, h: 150, t: 2, pat: 'stone', c: ['#4a4c5e', '#383a4a', '#62657a'], g: 7 }],
    [19, 'ash', 'Пепел', { s: 1, h: 60, t: 2, pat: 'sand', c: ['#5a5452', '#47413f', '#6e6866'], g: 8 }],
    [20, 'planks', 'Доски', { s: 1, h: 60, d: 'wood', pat: 'planks', c: ['#a8743e', '#86592c', '#c48e54'], g: 10 }],
    [21, 'stonebrick', 'Каменный кирпич', { s: 1, h: 120, t: 1, pat: 'brick', c: ['#8d8d98', '#5d5d66', '#a9a9b4'], g: 11 }],
    [22, 'brick', 'Кирпич', { s: 1, h: 120, t: 1, pat: 'brick', c: ['#b4523a', '#d8c8b8', '#cc6a50'], g: 12 }],
    [23, 'glass', 'Стекло', { s: 1, op: 2, h: 30, pat: 'glass', c: ['#bfe6ff', '#ffffff', '#7fb8dd'], g: 13 }],
    [24, 'platform', 'Платформа', { s: 2, op: 0, h: 20, d: 'platform', pat: 'platform', c: ['#a8743e', '#86592c', '#c48e54'], k: 'plat' }],
    [25, 'torch', 'Факел', { h: 1, tool: 'any', pat: 'torch', c: ['#7a4b26', '#ffb347', '#fff2a8'], k: 'torch', l: [255, 168, 76], emis: 255, sup: 'any' }],
    [26, 'door', 'Дверь', { s: 3, h: 40, tool: 'any', pat: 'door', c: ['#9b6a38', '#6e4824', '#d4b070'], k: 'obj', sz: [1, 3] }],
    [27, 'dooropen', 'Дверь (открыта)', { h: 40, tool: 'any', d: 'door', pat: 'dooropen', c: ['#9b6a38', '#6e4824', '#d4b070'], k: 'obj', sz: [1, 3] }],
    [28, 'chest', 'Сундук', { h: 40, tool: 'any', pat: 'chest', c: ['#9b6a38', '#5e3c1c', '#e0b840'], k: 'obj', sz: [2, 2], sup: 'floor' }],
    [29, 'workbench', 'Верстак', { s: 2, h: 30, tool: 'any', pat: 'workbench', c: ['#a8743e', '#6e4824', '#c48e54'], k: 'obj', sz: [2, 1], sup: 'floor' }],
    [30, 'furnace', 'Печь', { h: 60, tool: 'any', pat: 'furnace', c: ['#7d7d86', '#4c4c55', '#ff8a2a'], k: 'obj', sz: [3, 2], sup: 'floor', l: [225, 125, 45], emis: 70 }],
    [31, 'anvil', 'Наковальня', { s: 2, h: 60, tool: 'any', pat: 'anvil', c: ['#6b6f7d', '#41444f', '#a8adbd'], k: 'obj', sz: [2, 1], sup: 'floor' }],
    [32, 'trunk', 'Ствол', { h: 70, tool: 'axe', d: 'wood', pat: 'trunk', c: ['#7a5232', '#5a3a20', '#9a6a42'], k: 'plant' }],
    [33, 'leaves', 'Листва', { op: 2, h: 1, tool: 'any', d: '', pat: 'leaves', c: ['#3a9a42', '#236e2c', '#6ccc5e'], k: 'plant', leafy: 1 }],
    [34, 'pleaves', 'Хвоя', { op: 2, h: 1, tool: 'any', d: '', pat: 'pleaves', c: ['#2a6e44', '#174a2e', '#e8f2fb'], k: 'plant', leafy: 1 }],
    [35, 'jleaves', 'Листва джунглей', { op: 2, h: 1, tool: 'any', d: '', pat: 'leaves', c: ['#3cc04e', '#22883a', '#86e870'], k: 'plant', leafy: 1 }],
    [36, 'cactus', 'Кактус', { h: 40, tool: 'axe', pat: 'cactus', c: ['#3f9a46', '#2a7432', '#9ad07a'], k: 'plant', sup: 'floor' }],
    [37, 'tallgrass', 'Трава', { h: 0, tool: 'any', d: 'fiber?', pat: 'tallgrass', c: ['#4fae3c', '#3a8a2c', '#7ccf5c'], k: 'plant', sup: 'floor' }],
    [38, 'flower', 'Цветок', { h: 0, tool: 'any', d: '', pat: 'flower', c: ['#3a8a2c', '#ff5d8f', '#ffd84a'], k: 'plant', sup: 'floor' }],
    [39, 'vine', 'Лиана', { h: 0, tool: 'any', d: 'vine?', pat: 'vine', c: ['#2f9a3e', '#1f7a2e', '#5cd05a'], k: 'plant', sup: 'ceil', climb: 1 }],
    [40, 'rope', 'Верёвка', { h: 1, tool: 'any', pat: 'rope', c: ['#c9a26a', '#9a7840', '#e8c890'], k: 'plant', climb: 1 }],
    [41, 'ladder', 'Лестница', { h: 20, tool: 'any', pat: 'ladder', c: ['#a8743e', '#7a5028', '#c48e54'], k: 'plant', climb: 1 }],
    [42, 'mushroom', 'Гриб', { h: 0, tool: 'any', pat: 'mushroom', c: ['#e8e0d0', '#d8382a', '#ffffff'], k: 'plant', sup: 'floor' }],
    [43, 'glowshroom', 'Светогриб', { h: 0, tool: 'any', pat: 'glowshroom', c: ['#9ab8e0', '#3a8cff', '#c8f0ff'], k: 'plant', sup: 'floor', l: [40, 112, 245], emis: 230 }],
    [44, 'crystal', 'Кристалл', { h: 60, tool: 'any', pat: 'crystal', c: ['#c040c8', '#ff8af0', '#ffe0ff'], k: 'plant', sup: 'any', l: [190, 70, 235], emis: 220 }],
    [45, 'lifecrystal', 'Кристалл жизни', { h: 80, tool: 'any', pat: 'lifecrystal', c: ['#d8203c', '#ff6a80', '#ffd0d8'], k: 'obj', sz: [2, 2], sup: 'floor', l: [235, 52, 92], emis: 200 }],
    [46, 'pot', 'Горшок', { h: 1, tool: 'any', d: '', pat: 'pot', c: ['#a8603a', '#7a4024', '#d8905a'], k: 'plant', sup: 'floor' }],
    [47, 'bed', 'Кровать', { h: 30, tool: 'any', pat: 'bed', c: ['#9b6a38', '#d8383a', '#f0f0f0'], k: 'obj', sz: [3, 1], sup: 'floor' }],
    [48, 'loot', 'Сундук с сокровищами', { h: 40, tool: 'any', d: 'chest', pat: 'chest', c: ['#7a5a30', '#3e2a14', '#f0c840'], k: 'obj', sz: [2, 2], sup: 'floor' }],
  ];
  // Стены фона: [номер, ключ, название, свойства] (sky: пропускает солнце)
  const WALL_LIST = [
    [0, 'none', 'Нет', {}],
    [1, 'dirtwall', 'Земляная стена', { pat: 'dirt', c: ['#4e3420', '#3c2716', '#5c3e28'] }],
    [2, 'stonewall', 'Каменная стена', { pat: 'stone', c: ['#46464e', '#36363e', '#55555e'] }],
    [3, 'woodwall', 'Деревянная стена', { pat: 'planks', c: ['#6b4826', '#523618', '#7a5430'] }],
    [4, 'sbrickwall', 'Стена из камня', { pat: 'brick', c: ['#55555e', '#3a3a42', '#62626b'] }],
    [5, 'brickwall', 'Кирпичная стена', { pat: 'brick', c: ['#73362a', '#8a7a6e', '#7e4032'] }],
    [6, 'glasswall', 'Стеклянная стена', { pat: 'glass', c: ['#6a8aa0', '#a0c0d8', '#4a6a80'], sky: 1 }],
    [7, 'sandwall', 'Стена песчаника', { pat: 'strata', c: ['#7a5a36', '#62482a', '#86663e'] }],
    [8, 'icewall', 'Ледяная стена', { pat: 'ice', c: ['#5a7a96', '#4a6a86', '#7a9ab6'] }],
    [9, 'mudwall', 'Стена из ила', { pat: 'dirt', c: ['#3a3026', '#2c241c', '#463a2e'] }],
    [10, 'deepwall', 'Глубинная стена', { pat: 'stone', c: ['#2e3040', '#232532', '#383a4c'] }],
    [11, 'ashwall', 'Пепельная стена', { pat: 'sand', c: ['#3a3434', '#2c2626', '#463e3e'] }],
  ];

  // ═══ Таблицы свойств (номер → число): быстро и в потоке ═══
  const P = {
    SOLID: new Uint8Array(256), OPC: new Uint8Array(256), LR: new Uint8Array(256), LG: new Uint8Array(256), LB: new Uint8Array(256),
    HARD: new Uint16Array(256), TIER: new Uint8Array(256), TOOL: new Uint8Array(256), KIND: new Uint8Array(256), CLIMB: new Uint8Array(256),
    FALL: new Uint8Array(256), EMIS: new Uint8Array(256), SUP: new Uint8Array(256), GROUP: new Uint8Array(256), W: new Uint8Array(256),
    H: new Uint8Array(256), SLIP: new Uint8Array(256), GRASSY: new Uint8Array(256), WSKY: new Uint8Array(256), USED: new Uint8Array(256), WUSED: new Uint8Array(256),
    LEAFY: new Uint8Array(256),   // листва: края скругляются по соседней листве (как у земли)
  };
  const KINDS = { block: 0, obj: 1, plant: 2, torch: 3, plat: 4 };
  const TOOLS = { pick: 0, axe: 1, any: 2, hammer: 3 };
  const SUPS = { none: 0, floor: 1, ceil: 2, wall: 3, any: 4 };
  const TILES = [], TILE = {}, WALLS = [], WALL = {};
  function defTile(id, k, name, o){
    const t = Object.assign({ id, key: k, name, s: 0, h: 0, t: 0, tool: 'pick', k: 'block' }, o);
    if (t.op === undefined) t.op = t.s === 1 || t.s === 3 ? 1 : 0;
    if (t.d === undefined) t.d = k;
    if (t.tool === 'pick' && !t.s && t.k !== 'block') t.tool = 'any';
    TILES[id] = t; TILE[k] = t;
    P.SOLID[id] = t.s; P.OPC[id] = t.op; P.HARD[id] = t.h; P.TIER[id] = t.t; P.TOOL[id] = TOOLS[t.tool] ?? 0; P.KIND[id] = KINDS[t.k] ?? 0;
    P.CLIMB[id] = t.climb ? 1 : 0; P.FALL[id] = t.fall ? 1 : 0; P.EMIS[id] = t.emis || 0; P.SUP[id] = SUPS[t.sup || 'none'] ?? 0;
    P.GROUP[id] = t.g || 0; P.W[id] = t.sz ? t.sz[0] : 1; P.H[id] = t.sz ? t.sz[1] : 1; P.SLIP[id] = t.slip ? 1 : 0; P.GRASSY[id] = t.grass ? 1 : 0; P.LEAFY[id] = t.leafy ? 1 : 0;
    const l = t.l || [0, 0, 0]; P.LR[id] = l[0]; P.LG[id] = l[1]; P.LB[id] = l[2]; P.USED[id] = 1;
    return t;
  }
  function defWall(id, k, name, o){
    const w = Object.assign({ id, key: k, name }, o);
    WALLS[id] = w; WALL[k] = w; P.WSKY[id] = w.sky ? 1 : 0; P.WUSED[id] = 1;
    return w;
  }
  for (const [id, k, n, o] of TILE_LIST) defTile(id, k, n, o);
  for (const [id, k, n, o] of WALL_LIST) defWall(id, k, n, o);
  const T = {}; for (const t of TILES) if (t) T[t.key.toUpperCase()] = t.id;   // T.DIRT, T.STONE…
  const WL = {}; for (const w of WALLS) if (w) WL[w.key.toUpperCase()] = w.id;

  // ═══ Предметы ═══
  // kind: tile (ставит блок), wall (ставит стену), tool (pick/axe/hammer: power, tier), melee (dmg), bow, wand (mana),
  // ammo, use (расходник: heal, life, mana, boss, recall), acc (действует, пока лежит в вещах: jump, glide), mat (материал)
  const ITEMS = {}, ITEM_LIST = [];
  function defItem(k, name, o){ const it = Object.assign({ key: k, name, kind: 'mat', stack: 999 }, o); ITEMS[k] = it; ITEM_LIST.push(it); return it; }
  // предметы-блоки
  for (const [k, n] of [['dirt', 'Земля'], ['stone', 'Камень'], ['sand', 'Песок'], ['sandstone', 'Песчаник'], ['snow', 'Снег'], ['ice', 'Лёд'], ['mud', 'Ил'],
    ['clay', 'Глина'], ['copper', 'Медная руда'], ['iron', 'Железная руда'], ['silver', 'Серебряная руда'], ['gold', 'Золотая руда'], ['deepore', 'Глубинит'],
    ['fireore', 'Жарит'], ['obsidian', 'Обсидиан'], ['deepstone', 'Глубинный камень'], ['ash', 'Пепел'], ['stonebrick', 'Каменный кирпич'], ['brick', 'Кирпич'],
    ['glass', 'Стекло'], ['platform', 'Платформа'], ['torch', 'Факел'], ['door', 'Дверь'], ['chest', 'Сундук'], ['workbench', 'Верстак'], ['furnace', 'Печь'],
    ['anvil', 'Наковальня'], ['rope', 'Верёвка'], ['ladder', 'Лестница'], ['bed', 'Кровать'], ['cactus', 'Кактус'], ['crystal', 'Кристалл'], ['glowshroom', 'Светогриб']])
    defItem(k, n, { kind: 'tile', tile: k });
  defItem('wood', 'Дерево', { kind: 'tile', tile: 'planks' });
  ITEMS.door.stack = 99; ITEMS.chest.stack = 99; ITEMS.bed.stack = 99; ITEMS.workbench.stack = 99; ITEMS.furnace.stack = 99; ITEMS.anvil.stack = 99;
  ITEMS.torch.icon = ['torch', '#ffb347'];   // значок с пламенем (в мире пламя живое, на клетке — только ручка)
  for (const w of WALLS) if (w && w.id) defItem(w.key, w.name, { kind: 'wall', wall: w.key });
  // инструменты и оружие (power — сила за удар, tier — какие блоки берёт, speed — секунд на удар)
  defItem('pick_copper', 'Медная кирка', { kind: 'tool', tool: 'pick', power: 35, tier: 1, speed: .26, dmg: 4, reach: 2.2, stack: 1, icon: ['pick', '#d9783a'] });
  defItem('pick_iron', 'Железная кирка', { kind: 'tool', tool: 'pick', power: 48, tier: 2, speed: .24, dmg: 6, reach: 2.3, stack: 1, icon: ['pick', '#c8c0b8'] });
  defItem('pick_gold', 'Золотая кирка', { kind: 'tool', tool: 'pick', power: 62, tier: 3, speed: .22, dmg: 8, reach: 2.3, stack: 1, icon: ['pick', '#f2c230'] });
  defItem('pick_deep', 'Глубинная кирка', { kind: 'tool', tool: 'pick', power: 80, tier: 4, speed: .2, dmg: 11, reach: 2.4, stack: 1, icon: ['pick', '#4f7cff'] });
  defItem('pick_fire', 'Огненная кирка', { kind: 'tool', tool: 'pick', power: 110, tier: 5, speed: .17, dmg: 15, reach: 2.5, stack: 1, icon: ['pick', '#ff5a1a'] });
  defItem('axe_copper', 'Медный топор', { kind: 'tool', tool: 'axe', power: 40, speed: .3, dmg: 5, reach: 2.2, stack: 1, icon: ['axe', '#d9783a'] });
  defItem('axe_iron', 'Железный топор', { kind: 'tool', tool: 'axe', power: 60, speed: .26, dmg: 8, reach: 2.3, stack: 1, icon: ['axe', '#c8c0b8'] });
  defItem('hammer', 'Молоток', { kind: 'tool', tool: 'hammer', power: 40, speed: .3, dmg: 6, reach: 2.2, stack: 1, icon: ['hammer', '#d9783a'] });
  defItem('sword_copper', 'Медный меч', { kind: 'melee', dmg: 9, speed: .32, reach: 2.4, kb: 3.5, stack: 1, icon: ['sword', '#d9783a'] });
  defItem('sword_iron', 'Железный меч', { kind: 'melee', dmg: 13, speed: .3, reach: 2.6, kb: 4.5, stack: 1, icon: ['sword', '#c8c0b8'] });
  defItem('sword_silver', 'Серебряный меч', { kind: 'melee', dmg: 16, speed: .29, reach: 2.7, kb: 5, stack: 1, icon: ['sword', '#dfe6ee'] });
  defItem('sword_gold', 'Золотой меч', { kind: 'melee', dmg: 20, speed: .28, reach: 2.8, kb: 5.5, stack: 1, icon: ['sword', '#f2c230'] });
  defItem('sword_deep', 'Глубинный меч', { kind: 'melee', dmg: 28, speed: .26, reach: 3, kb: 6, stack: 1, icon: ['sword', '#4f7cff'] });
  defItem('sword_fire', 'Огненный меч', { kind: 'melee', dmg: 38, speed: .25, reach: 3.2, kb: 6.5, stack: 1, icon: ['sword', '#ff5a1a'] });
  defItem('bow', 'Деревянный лук', { kind: 'bow', dmg: 7, speed: .45, stack: 1, icon: ['bow', '#a8743e'] });
  defItem('arrow', 'Стрела', { kind: 'ammo', dmg: 5, icon: ['arrow', '#c8c0b8'] });
  defItem('wand', 'Искровой жезл', { kind: 'wand', dmg: 16, mana: 5, speed: .35, stack: 1, icon: ['wand', '#ff8af0'] });
  // материалы
  defItem('bar_copper', 'Медный слиток', { icon: ['bar', '#d9783a'] });
  defItem('bar_iron', 'Железный слиток', { icon: ['bar', '#c8c0b8'] });
  defItem('bar_silver', 'Серебряный слиток', { icon: ['bar', '#e6eef6'] });
  defItem('bar_gold', 'Золотой слиток', { icon: ['bar', '#f2c230'] });
  defItem('bar_deep', 'Глубинный слиток', { icon: ['bar', '#4f7cff'] });
  defItem('bar_fire', 'Огненный слиток', { icon: ['bar', '#ff5a1a'] });
  defItem('gel', 'Гель', { icon: ['gel', '#3ac0ff'] });
  defItem('fiber', 'Волокно', { icon: ['fiber', '#7ccf5c'] });
  defItem('vine', 'Лиана', { icon: ['fiber', '#2f9a3e'] });
  defItem('membrane', 'Перепонка', { icon: ['membrane', '#6a4a7a'] });
  defItem('feather', 'Перо филина', { icon: ['feather', '#d8c8a8'] });
  defItem('bottle', 'Бутылка', { icon: ['bottle', '#bfe6ff'] });
  defItem('mushroom', 'Гриб', { kind: 'use', use: 'heal', heal: 15, icon: ['mushroom', '#d8382a'] });
  // расходники и особое
  defItem('potion', 'Зелье лечения', { kind: 'use', use: 'heal', heal: 70, stack: 30, icon: ['potion', '#ff3a5a'] });
  defItem('lifecrystal', 'Кристалл жизни', { kind: 'use', use: 'life', stack: 99, icon: ['heart', '#ff3a5a'] });
  defItem('manastar', 'Звезда маны', { kind: 'use', use: 'mana', stack: 99, icon: ['star', '#4fa0ff'] });
  defItem('slimebait', 'Желейная приманка', { kind: 'use', use: 'boss', boss: 'slimeking', stack: 20, icon: ['bait', '#3ac0ff'] });
  defItem('owllure', 'Совиный манок', { kind: 'use', use: 'boss', boss: 'owl', night: 1, stack: 20, icon: ['lure', '#d8c8a8'] });
  defItem('recall', 'Возвратный амулет', { kind: 'use', use: 'recall', keep: 1, stack: 1, icon: ['amulet', '#ff8af0'] });
  defItem('boots', 'Сапоги-прыгуны', { kind: 'acc', acc: 'jump', stack: 1, icon: ['boots', '#3ac0ff'] });
  defItem('wings', 'Крылья филина', { kind: 'acc', acc: 'glide', stack: 1, icon: ['wings', '#d8c8a8'] });
  // крюк — как в Террарии: E (геймпад Ⓑ, на телефоне 🪝) — бросить к прицелу, цепляется за блок и тянет; работает из вещей
  defItem('hook', 'Крюк-кошка', { kind: 'hook', range: 12, speed: 38, stack: 1, icon: ['hook', '#c8c0b8'] });
  // усиления (B — выпить все, что не действуют): шахтёр — копать быстрее, сияние — свет вокруг героя
  defItem('potion_miner', 'Зелье шахтёра', { kind: 'use', use: 'buff', buff: 'mine', dur: 180, stack: 30, icon: ['potion', '#f2c230'] });
  defItem('potion_shine', 'Зелье сияния', { kind: 'use', use: 'buff', buff: 'shine', dur: 180, stack: 30, icon: ['potion', '#8fe8ff'] });

  // ═══ Рецепты: [что, сколько, [[из чего, сколько]…], станок] (станок — ключ блока рядом: workbench | furnace | anvil) ═══
  const RECIPES = [
    ['workbench', 1, [['wood', 10]], null],
    ['torch', 3, [['wood', 1], ['gel', 1]], null],
    ['platform', 2, [['wood', 1]], null],
    ['woodwall', 4, [['wood', 1]], 'workbench'],
    ['door', 1, [['wood', 6]], 'workbench'],
    ['chest', 1, [['wood', 8], ['bar_iron', 2]], 'workbench'],
    ['ladder', 3, [['wood', 2]], 'workbench'],
    ['rope', 4, [['fiber', 3]], null],
    ['rope', 6, [['vine', 1]], null],
    ['bed', 1, [['wood', 15], ['fiber', 5]], 'workbench'],
    ['bow', 1, [['wood', 10], ['fiber', 3]], 'workbench'],
    ['arrow', 10, [['wood', 1], ['stone', 1]], 'workbench'],
    ['furnace', 1, [['stone', 20], ['wood', 4], ['torch', 3]], 'workbench'],
    ['stonebrick', 1, [['stone', 2]], 'workbench'],
    ['stonewall', 4, [['stone', 1]], 'workbench'],
    ['sbrickwall', 4, [['stonebrick', 1]], 'workbench'],
    ['brickwall', 4, [['brick', 1]], 'workbench'],
    ['glasswall', 4, [['glass', 1]], 'workbench'],
    ['potion', 1, [['bottle', 1], ['mushroom', 2], ['gel', 1]], 'workbench'],
    ['potion_miner', 1, [['bottle', 1], ['copper', 3], ['mushroom', 1]], 'workbench'],
    ['potion_shine', 1, [['bottle', 1], ['glowshroom', 2], ['gel', 1]], 'workbench'],
    ['slimebait', 1, [['gel', 25], ['mushroom', 1]], 'workbench'],
    ['anvil', 1, [['bar_iron', 5]], 'workbench'],
    ['hammer', 1, [['wood', 8]], 'workbench'],
    ['pick_copper', 1, [['bar_copper', 8], ['wood', 3]], 'workbench'],
    ['axe_copper', 1, [['bar_copper', 6], ['wood', 3]], 'workbench'],
    ['sword_copper', 1, [['bar_copper', 6]], 'workbench'],
    ['bar_copper', 1, [['copper', 3]], 'furnace'],
    ['bar_iron', 1, [['iron', 3]], 'furnace'],
    ['bar_silver', 1, [['silver', 4]], 'furnace'],
    ['bar_gold', 1, [['gold', 4]], 'furnace'],
    ['bar_deep', 1, [['deepore', 4]], 'furnace'],
    ['bar_fire', 1, [['fireore', 4], ['obsidian', 1]], 'furnace'],
    ['glass', 1, [['sand', 2]], 'furnace'],
    ['brick', 1, [['clay', 2]], 'furnace'],
    ['bottle', 2, [['glass', 1]], 'furnace'],
    ['pick_iron', 1, [['bar_iron', 12], ['wood', 3]], 'anvil'],
    ['pick_gold', 1, [['bar_gold', 12], ['wood', 4]], 'anvil'],
    ['pick_deep', 1, [['bar_deep', 15]], 'anvil'],
    ['pick_fire', 1, [['bar_fire', 15], ['obsidian', 5]], 'anvil'],
    ['axe_iron', 1, [['bar_iron', 9], ['wood', 3]], 'anvil'],
    ['hook', 1, [['bar_iron', 3], ['rope', 10]], 'anvil'],
    ['sword_iron', 1, [['bar_iron', 8]], 'anvil'],
    ['sword_silver', 1, [['bar_silver', 9]], 'anvil'],
    ['sword_gold', 1, [['bar_gold', 10]], 'anvil'],
    ['sword_deep', 1, [['bar_deep', 12]], 'anvil'],
    ['sword_fire', 1, [['bar_fire', 14]], 'anvil'],
    ['wand', 1, [['bar_gold', 10], ['crystal', 3]], 'anvil'],
    ['recall', 1, [['bar_silver', 8], ['crystal', 2]], 'anvil'],
    ['manastar', 1, [['crystal', 3]], 'anvil'],
    ['owllure', 1, [['membrane', 6], ['bar_silver', 8]], 'anvil'],
    ['wings', 1, [['feather', 10], ['bar_gold', 5]], 'anvil'],
  ].map(([o, n, i, st]) => ({ o, n, i, st }));

  // ═══ Колонка мира: высота поверхности, биом, глубина земли, «вход в пещеры» ═══
  // Биомы: 0 лес, 1 пустыня, 2 снег, 3 джунгли. Рядом со стартом (|x| < 220) — всегда лес.
  const B = { FOREST: 0, DESERT: 1, SNOW: 2, JUNGLE: 3 };
  const BIOME_NAMES = ['Лес', 'Пустыня', 'Снега', 'Джунгли'];
  // o.trees (T-022b, новые миры) — деревья пород движка деревьев (js/engine/trees.js: ствол 2×2 у корня, сучья, крона облаками,
  // ели — ярусами), сбоку (TR.cells2d); нет — как раньше. В поток модуль деревьев приходит текстом перед ядром (workerSource)
  function makeGen(seed, o = {}){
    const S = (seed >>> 0) || 1;
    const TRS = (typeof self !== 'undefined' ? self : globalThis).D37E?.trees, T3 = !!o.trees && !!TRS?.cells2d;
    const cols = new Map();
    function colInfo(x){
      let c = cols.get(x);
      if (c) return c;
      if (cols.size > 30000) cols.clear();
      let n = fbm1(x * .0016, S + 20, 2) + (rnd1(x, S + 21) - .5) * .035;
      const spawn = smooth(320, 220, x < 0 ? -x : x);   // 1 у старта, 0 дальше 320
      n = n * (1 - spawn) + -.05 * spawn;
      const b = n < -.3 ? B.SNOW : n < .12 ? B.FOREST : n < .36 ? B.DESERT : B.JUNGLE;
      const mtn = smooth(-.3, -.62, n), flat = smooth(.1, .2, n) * (1 - smooth(.33, .4, n)), jung = smooth(.34, .45, n);
      let h = SURF + fbm1(x * .0034, S + 22, 3) * 40 * (1 + mtn * 1.9) * (1 - flat * .55)
        + fbm1(x * .013, S + 23, 2) * 9 * (1 - flat * .6) + noise1(x * .06, S + 24) * (2 + jung * 2.5) - mtn * 26;
      // у старта — ровнее
      const sp = smooth(60, 18, x < 0 ? -x : x);
      h = h * (1 - sp) + (SURF - 6 + noise1(x * .08, S + 27) * 1.5) * sp;
      h = Math.floor(h + .5);
      const dd = 8 + Math.floor(noise1(x * .04, S + 25) * 3.5 + .5) + (b === B.DESERT ? 8 : 0);
      const ent = (x > 80 || x < -80) && noise1(x * .021, S + 26) > .55;
      const deep = 720 + Math.floor(noise1(x * .009, S + 28) * 28);
      const lava = 1180 + Math.floor(noise1(x * .007, S + 29) * 36);
      c = { h, b, dd, ent, deep, lava, n };
      cols.set(x, c);
      return c;
    }
    // Пещера в клетке? (d — глубина от поверхности)
    function caveAt(x, y, d, C){
      if (d < 0) return false;
      if (d <= 5 && !C.ent) return false;
      const t1 = noise2(x * .026, y * .039, S + 1), w1 = .068 + (d > 300 ? .02 : d * .000066);
      if (t1 < w1 && t1 > -w1) return d > 1 || C.ent;
      if (d > 12) { const t2 = noise2(x * .0155, y * .024, S + 2); if (t2 < .052 && t2 > -.052) return true; }
      if (d > 24) {
        const c = noise2(x * .0118, y * .0185, S + 3) + noise2(x * .047, y * .052, S + 4) * .28;
        if (c > .5 - (d > 1500 ? .17 : d * .000113)) return true;
      }
      return false;
    }
    // Основа клетки без деревьев и украшений: fg | wall << 8 | жидкость << 16 (1 вода, 2 лава)
    function base(x, y){
      const C = colInfo(x);
      if (y < C.h) return 0;
      const d = y - C.h, b = C.b;
      const cave = caveAt(x, y, d, C);
      let fg = 0, wall = 0, liq = 0;
      // материал
      if (!cave) {
        if (d === 0) fg = b === B.DESERT ? T.SAND : b === B.SNOW ? T.SNOW : b === B.JUNGLE ? T.JGRASS : T.GRASS;
        else if (d < C.dd) fg = b === B.DESERT ? T.SAND : b === B.SNOW ? T.SNOW : b === B.JUNGLE ? T.MUD : T.DIRT;
        else if (y >= C.lava) fg = noise2(x * .06, y * .06, S + 30) > -.1 ? T.ASH : T.DEEPSTONE;
        else if (y >= C.deep) fg = T.DEEPSTONE;
        else if (b === B.DESERT && d < C.dd + 48) fg = T.SANDSTONE;
        else if (b === B.JUNGLE && d < 520) fg = noise2(x * .05, y * .05, S + 31) > .3 ? T.STONE : T.MUD;
        else fg = T.STONE;
        // вкрапления (шум ≈ −0,7…0,7: 0,29 — 10 % клеток, 0,37 — 5 %, 0,47 — 1 %)
        if (fg === T.STONE || fg === T.DEEPSTONE) {
          const p = noise2(x * .083, y * .083, S + 32);
          if (p > .42 && y < 600) fg = b === B.SNOW ? T.ICE : T.DIRT;
          else if (p < -.4 && d < 160) fg = T.CLAY;
          else if (b === B.SNOW && p < -.32 && d < 300) fg = T.SNOW;
        }
        // руды: жилы по шуму, чем глубже — тем ценнее (≈3 % камня — медь, ≈1,5 % — золото)
        if (fg === T.STONE || fg === T.DEEPSTONE || fg === T.SANDSTONE || fg === T.ICE || fg === T.ASH) {
          if (y >= C.lava + 20 && noise2(x * .15, y * .15, S + 46) > .4) fg = T.FIREORE;
          else if (y >= C.deep + 30 && fg === T.DEEPSTONE && noise2(x * .17, y * .17, S + 45) > .43) fg = T.DEEPORE;
          else if (y >= 470 && noise2(x * .18, y * .18, S + 44) > .45) fg = T.GOLD;
          else if (y >= 320 && noise2(x * .18, y * .18, S + 43) > .43) fg = T.SILVER;
          else if (d >= 18 && noise2(x * .17, y * .17, S + 42) > .41) fg = T.IRON;
          else if (d >= 5 && y < 950 && noise2(x * .16, y * .16, S + 41) > .39) fg = T.COPPER;
        }
      }
      // стена фона (у пещер местами нет — видно подземный фон)
      if (d > 3 + (hash2(x, 3, S) & 1)) {
        if (y >= C.lava) wall = WL.ASHWALL;
        else if (y >= C.deep) wall = WL.DEEPWALL;
        else if (d < C.dd + 14) wall = b === B.DESERT ? WL.SANDWALL : b === B.SNOW ? WL.ICEWALL : b === B.JUNGLE ? WL.MUDWALL : WL.DIRTWALL;
        else wall = b === B.JUNGLE ? WL.MUDWALL : b === B.DESERT && d < C.dd + 48 ? WL.SANDWALL : WL.STONEWALL;
        if (cave && noise2(x * .031, y * .034, S + 9) < -.22) wall = 0;
      }
      // озёра и лава — в настоящих чашах (basin): гладь ровная, вода не утекает, когда к ней подходишь
      if (cave) {
        const rx = Math.floor(x / RW), ry = Math.floor(y / RH), bs = basin(rx, ry);
        if (bs && bs.fill[(y - bs.Y0) * RW + (x - bs.X0)]) liq = bs.lt;
      }
      return fg | wall << 8 | liq << 16;
    }
    // ── Чаши озёр: участок 96×64; есть ли озеро и какое — по зерну. От дна (пещера, под ней — камень) жидкость «наливается»
    // ряд за рядом: каждый уровень — все пещерные клетки не выше уровня, до которых дотечёт; дотекла до края участка —
    // значит, перелилась бы дальше: берём прошлый уровень. Так у чаши твёрдые дно и бока, а сверху — воздух ──
    const RW = 96, RH = 64, basins = new Map();
    function basin(rx, ry){
      const k = rx + ',' + ry;
      if (basins.has(k)) return basins.get(k);
      if (basins.size > 600) basins.clear();
      let res = null;
      const X0 = rx * RW, Y0 = ry * RH, mid = colInfo(X0 + 48);
      const lava = Y0 + RH / 2 >= mid.lava - 20, water = !lava && Y0 >= mid.h + 30;
      if ((lava && rnd2(rx, ry, S + 52) < .55) || (water && rnd2(rx, ry, S + 54) < .5)) {
        // клетка пещеры (без деревьев и прочего — они на поверхности); 3 — пещера у самой поверхности (туда не наливаем)
        const grid = new Uint8Array(RW * RH);
        const kind = (x, y) => { const C = colInfo(x), d = y - C.h; return d > 0 && caveAt(x, y, d, C) ? (d > 8 ? 2 : 3) : 1; };
        const at = (x, y) => { const i = (y - Y0) * RW + (x - X0); return grid[i] || (grid[i] = kind(x, y)); };
        for (let t = 0, tries = lava ? 12 : 8; t < tries && !res; t++) {   // у лавы — больше попыток: там пещеры огромные, чаши мельче
          const sx = X0 + 6 + hash2(rx * 7 + t, ry, S + 51) % (RW - 12);
          let fy = -1;
          for (let y = Y0 + 4; y < Y0 + RH - 2; y++) if (at(sx, y) === 2 && at(sx, y + 1) === 1) { fy = y; break; }   // дно: пещера, под ней камень
          if (fy < 0) continue;
          const fill = new Uint8Array(RW * RH), Q = [];
          fill[(fy - Y0) * RW + (sx - X0)] = 1;
          let level = fy, cells = 1, surf = 1;
          // налить ещё ряд: новые клетки ряда L = level − 1 над залитыми и всё, куда дотечёт не выше L
          while (level > Y0 + 1 && fy - level < 18) {
            const L = level - 1, added = [];
            for (let x = X0; x < X0 + RW; x++) if (fill[(level - Y0) * RW + (x - X0)] && at(x, L) === 2 && !fill[(L - Y0) * RW + (x - X0)]) { fill[(L - Y0) * RW + (x - X0)] = 1; added.push(x, L); Q.push(x, L); }
            if (!added.length) break;   // сверху камень — чаша полна
            let leak = false;
            while (Q.length && !leak) {
              const y = Q.pop(), x = Q.pop();
              for (let n = 0; n < 4 && !leak; n++) {
                const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0), ny = y + (n === 2 ? 1 : n === 3 ? -1 : 0);
                if (ny < L) continue;
                if (nx < X0 || nx >= X0 + RW || ny >= Y0 + RH) { if (kind(nx, ny) !== 1) leak = true; continue; }   // за краем участка пещера — утекло бы
                const i = (ny - Y0) * RW + (nx - X0), v = at(nx, ny);
                if (fill[i] || v === 1) continue;
                if (v === 3) { leak = true; continue; }   // дотекло до пещеры у поверхности
                fill[i] = 1; added.push(nx, ny); Q.push(nx, ny);
              }
            }
            if (leak) { for (let j = 0; j < added.length; j += 2) fill[(added[j + 1] - Y0) * RW + (added[j] - X0)] = 0; Q.length = 0; break; }
            level = L; cells += added.length / 2;
            surf = 0; for (let x = X0; x < X0 + RW; x++) if (fill[(level - Y0) * RW + (x - X0)]) surf++;
          }
          if (cells >= (lava ? 6 : 10) && surf >= (lava ? 3 : 4)) res = { fill, X0, Y0, lt: lava ? 2 : 1, level, cells };
        }
      }
      basins.set(k, res);
      return res;
    }
    const solidBase = (x, y) => { const f = base(x, y) & 255; return f !== 0 && P.SOLID[f] === 1; };

    // ── Деревья: в ячейке из 7 колонок не больше одного; лес, джунгли, ели, кактусы ──
    function treeOf(k){ return T3 ? treeOf3(k) : treeOf0(k); }
    function treeOf0(k){
      const r = hash2(k, 11, S + 60), xc = k * 7 + 1 + (r & 3);
      if (xc > -5 && xc < 5) return null;
      const C = colInfo(xc), b = C.b;
      const dens = b === B.JUNGLE ? .9 : b === B.FOREST ? .62 : b === B.SNOW ? .55 : .32;
      if ((r >>> 8 & 1023) / 1024 >= dens) return null;
      const surf = base(xc, C.h) & 255;
      if (b === B.DESERT ? surf !== T.SAND : surf !== T.GRASS && surf !== T.JGRASS && surf !== T.SNOW) return null;
      if ((base(xc, C.h + 1) & 255) === 0) return null;   // под корнем пещера
      const kind = b === B.DESERT ? 'cactus' : b === B.SNOW ? 'pine' : b === B.JUNGLE ? 'jungle' : 'oak';
      const H = kind === 'cactus' ? 3 + (r >>> 18 & 3) : kind === 'jungle' ? 11 + (r >>> 18 & 7) : kind === 'pine' ? 8 + (r >>> 18 & 5) : 6 + (r >>> 18 & 5);
      return { xc, y0: C.h - 1, H, kind, r };
    }
    // деревья пород (T-022b): то же место и та же «жеребьёвка», что у прежних (treeOf0), порода — по биому, форма — по зерну места;
    // клетки сбоку — один раз на дерево (кэш до 2000)
    const tcache = new Map();
    function treeOf3(k){
      if (tcache.has(k)) return tcache.get(k);
      const tr = treeOf0(k);
      let out = tr;
      if (tr && tr.kind !== 'cactus') {
        const b = colInfo(tr.xc).b, u = (tr.r >>> 12) & 63;
        const sp = b === B.JUNGLE ? (u < 6 ? 'oak' : 'tropical') : b === B.SNOW ? (u < 2 ? 'giant_spruce' : u < 5 ? 'dead' : u < 26 ? 'pine' : 'spruce') : (u < 2 ? 'giant_oak' : u < 5 ? 'dead' : u < 22 ? 'birch' : 'oak');
        const c = TRS.cells2d(TRS.grow(sp, hash2(tr.xc, 61, S + 62), {}), { style: 'side' });
        let top = 0; for (let i = 0; i < c.n; i++) if (c.y[i] > top) top = c.y[i];
        out = { xc: tr.xc, y0: tr.y0, H: top + 2, kind: sp, r: tr.r, cells: c, leaf: /spruce|pine/.test(sp) ? T.PLEAVES : sp === 'tropical' ? T.JLEAVES : T.LEAVES };
      }
      if (tcache.size >= 2000) tcache.delete(tcache.keys().next().value);
      tcache.set(k, out);
      return out;
    }
    // дерево, которому принадлежит клетка (x, y) ствола или ветки (рубка: падает всё выше среза), или null
    function treeAt(x, y){
      if (!T3) return null;
      for (let k = Math.floor((x - 16) / 7); k <= Math.floor((x + 16) / 7); k++) {
        const tr = treeOf(k); if (!tr || !tr.cells) continue;
        const c = tr.cells;
        for (let i = 0; i < c.n; i++) if (c.t[i] !== 0 && tr.xc + c.x[i] === x && tr.y0 - c.y[i] === y) return tr;
      }
      return null;
    }
    // клетки дерева: cb(x, y, fg)
    function treeCells(tr, cb){
      if (tr.cells) { const c = tr.cells; for (let i = 0; i < c.n; i++) cb(tr.xc + c.x[i], tr.y0 - c.y[i], c.t[i] === 0 ? tr.leaf : T.TRUNK); return; }   // деревья пород
      const { xc, y0, H, kind, r } = tr, top = y0 - H + 1;
      if (kind === 'cactus') {
        for (let y = y0; y >= top; y--) cb(xc, y, T.CACTUS);
        const side = r >>> 23 & 1 ? 1 : -1, ay = y0 - 1 - (r >>> 24 & 1);
        if (H >= 4) { cb(xc + side, ay, T.CACTUS); cb(xc + side, ay - 1, T.CACTUS); }
        if (H >= 5 && r >>> 25 & 1) { cb(xc - side, ay - 1, T.CACTUS); cb(xc - side, ay - 2, T.CACTUS); }
        return;
      }
      for (let y = y0; y >= top; y--) cb(xc, y, T.TRUNK);
      if (kind === 'pine') {
        for (let i = 1; i < H - 1; i++) {
          const y = top + i - 2, w = Math.min(3, Math.floor(i / 2.2));
          for (let dx = -w; dx <= w; dx++) if (dx) cb(xc + dx, y, T.PLEAVES);
        }
        cb(xc, top - 1, T.PLEAVES); cb(xc, top - 2, T.PLEAVES);
        return;
      }
      const R = kind === 'jungle' ? 3 : 2 + (r >>> 26 & 1), lf = kind === 'jungle' ? T.JLEAVES : T.LEAVES, cy = top - 1;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        if (dx * dx * .8 + dy * dy * 1.25 > R * R + .9) continue;
        if (dx === 0 && dy >= 1) continue;
        cb(xc + dx, cy + dy, lf);
        // лианы под листвой джунглей
        if (kind === 'jungle' && dy >= 1 && dx * dx * .8 + (dy + 1) * (dy + 1) * 1.25 > R * R + .9) {
          const len = hash2(xc + dx, cy + dy, S + 61) % 6;
          for (let v = 1; v <= len; v++) cb(xc + dx, cy + dy + v, T.VINE);
        }
      }
      // веточки на стволе
      for (let y = y0 - 2; y > top + 1; y--) {
        const q = hash2(xc, y, S + 62) & 15;
        if (q < 2) cb(xc + (q ? 1 : -1), y, lf);
      }
    }

    // ── Генерация чанка: out = { fg, wall, st, lq, lt } (Uint8Array по 4096) ──
    function genChunk(cx, cy, out){
      const x0 = cx * CS, y0 = cy * CS;
      const fg = out.fg, wall = out.wall, st = out.st, lq = out.lq, lt = out.lt;
      st.fill(0);
      // 1. основа
      for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx, C = colInfo(x);
        if (y0 + CM < C.h) { for (let ly = 0; ly < CS; ly++) { const i = ly << CB | lx; fg[i] = 0; wall[i] = 0; lq[i] = 0; lt[i] = 0; } continue; }
        for (let ly = 0; ly < CS; ly++) {
          const i = ly << CB | lx, v = base(x, y0 + ly);
          fg[i] = v & 255; wall[i] = v >> 8 & 255; const q = v >> 16;
          lt[i] = q; lq[i] = q ? 255 : 0;
        }
      }
      const fgAt = (x, y) => { const lx = x - x0, ly = y - y0; return lx >= 0 && lx < CS && ly >= 0 && ly < CS ? fg[ly << CB | lx] : base(x, y) & 255; };
      const put = (x, y, f, s) => { const lx = x - x0, ly = y - y0; if (lx < 0 || lx >= CS || ly < 0 || ly >= CS) return; const i = ly << CB | lx; if (fg[i] || lq[i]) return; fg[i] = f; st[i] = s || 0; };
      // 2. деревья (из соседних колонок — тоже: крона заходит в чанк)
      const TW = T3 ? 16 : 6, k0 = Math.floor((x0 - TW) / 7), k1 = Math.floor((x0 + CS + TW) / 7);   // деревья пород шире (до 15 клеток от ствола)
      const treeCol = new Set();
      for (let k = k0; k <= k1; k++) {
        const tr = treeOf(k); if (!tr) continue;
        if (tr.y0 + 4 < y0 || tr.y0 - tr.H - 8 > y0 + CM) continue;
        treeCol.add(tr.xc); if (tr.cells) treeCol.add(tr.xc - 1);
        treeCells(tr, (x, y, f) => put(x, y, f));
      }
      // 3. украшения: трава и цветы на поверхности, грибы, светогрибы, кристаллы, горшки
      for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx, C = colInfo(x);
        for (let ly = 0; ly < CS; ly++) {
          const i = ly << CB | lx; if (fg[i] || lq[i]) continue;
          const y = y0 + ly, below = fgAt(x, y + 1);
          const r = rnd2(x, y, S + 70);
          if (y === C.h - 1) {
            if (treeCol.has(x)) continue;
            if (below === T.GRASS) { if (r < .5) fg[i] = T.TALLGRASS; else if (r < .58) fg[i] = T.FLOWER; else if (r < .59) fg[i] = T.MUSHROOM; }
            else if (below === T.JGRASS) { if (r < .75) fg[i] = T.TALLGRASS; else if (r < .8) fg[i] = T.FLOWER; }
            else if (below === T.SNOW && r < .08) fg[i] = T.TALLGRASS;
            continue;
          }
          const d = y - C.h;
          if (d < 6) continue;
          const solidBelow = below && P.SOLID[below] === 1;
          if (solidBelow) {
            if (d > 380 && (below === T.MUD || below === T.DEEPSTONE || below === T.STONE) && r < .045) { fg[i] = T.GLOWSHROOM; continue; }
            if (below === T.JGRASS || below === T.MUD) { if (r < .2) { fg[i] = T.TALLGRASS; continue; } }
            if (d > 20 && r > .985) { fg[i] = T.POT; continue; }
            if (d > 40 && d < 380 && r > .975 && r <= .985 && below !== T.SAND) { fg[i] = T.MUSHROOM; continue; }
          }
          if (d > 300 && r < .006) {
            const a = fgAt(x, y - 1), l = fgAt(x - 1, y), rr = fgAt(x + 1, y);
            if ((a && P.SOLID[a] === 1) || (l && P.SOLID[l] === 1) || (rr && P.SOLID[rr] === 1) || solidBelow) fg[i] = T.CRYSTAL;
          }
        }
      }
      // 4. предметы 2×2 на полу пещер: кристаллы жизни и сундуки с сокровищами (якорь — левый верх на чётной сетке)
      for (let ay = (y0 >> 1 << 1) - 2; ay <= y0 + CM; ay += 2) for (let ax = (x0 >> 1 << 1) - 2; ax <= x0 + CM; ax += 2) {
        const r = rnd2(ax, ay, S + 80);
        if (r > .0035) continue;
        const C = colInfo(ax), d = ay - C.h;
        if (d < 60) continue;
        const life = r < .0016;
        if (!life && d < 40) continue;
        let okk = true;
        for (let dy = 0; dy < 2 && okk; dy++) for (let dx = 0; dx < 2; dx++) if (base(ax + dx, ay + dy) & 0x300ff) { okk = false; break; }   // пусто, без жидкости
        if (!okk) continue;
        if (!solidBase(ax, ay + 2) || !solidBase(ax + 1, ay + 2)) continue;
        const id = life ? T.LIFECRYSTAL : T.LOOT;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const lx = ax + dx - x0, ly = ay + dy - y0;
          if (lx < 0 || lx >= CS || ly < 0 || ly >= CS) continue;
          const i = ly << CB | lx; fg[i] = id; st[i] = (dx + dy * 2) << 4;
        }
      }
      return out;
    }
    // Точка появления: над землёй у x = 0 (ищем сушу без воды)
    function spawnPoint(){
      for (let k = 0; k < 400; k++) {
        const x = k % 2 ? -((k + 1) >> 1) : k >> 1, C = colInfo(x);
        if (C.ent) continue;
        const s = base(x, C.h);
        if ((s & 255) && P.SOLID[s & 255] === 1 && !(s >> 16)) return { x, y: C.h - 1 };
      }
      return { x: 0, y: colInfo(0).h - 1 };
    }
    return { seed: S, trees: T3, colInfo, base, caveAt, treeOf, treeCells, treeAt, genChunk, spawnPoint, basin, biomeName: x => BIOME_NAMES[colInfo(x).b] };
  }

  // ═══ Свет: заливка «по максимуму» (8 соседей), RGB от источников + S от неба — как режим «Цвет» у Террарии ═══
  // Клетка пропускает ДОЛЮ света (умножение), а не «минус N»: яркое ядро и долгий мягкий хвост. Доля — по той клетке,
  // КУДА идёт свет: воздух 0,89, полупрозрачное 0,76, вода — по цветам 0,78 / 0,84 / 0,89 (красный гаснет быстрее синего —
  // под водой свет синеет), лава 0,7. Диагональ — в степени √2. Меньше LCUT — темно.
  // Камень и всё непрозрачное (с 22.10.2026, владелец: «огонь выходит за пещеру» — свет факела было видно в толще камня на
  // 5–6 клеток и сквозь тонкие стены): свет освещает только ГРАНЬ — в первую клетку камня заходит доля LFACE (0,62), дальше по
  // камню гаснет быстро (LDEEP: 0,22 — через клетку уже почти темно; небо мягче — 0,56, как было: днём земля видна на 5–6 клеток),
  // а ИЗ камня в воздух выходит только его собственное свечение (руды, жарит) — сквозь стену в 1 блок свет не проходит.
  // Дальше LR клеток свет не достаёт ни через что (самая большая доля — воздух: 255 → 0 за 31 клетку) — поэтому пересчёт —
  // коробкой ±LR вокруг правки (tiles-test это проверяет).
  const LR = 32, LCUT = 4;
  // класс клетки для света: 0 воздух, 1 твёрдое (вход в грань — LFACE), 2 полупрозрачное, 3 вода, 4 лава; [r, g, b, небо] × 256
  const LMUL = [[228, 228, 228, 228], [159, 159, 159, 169], [195, 195, 195, 195], [200, 215, 228, 215], [179, 179, 179, 179]];
  const LDEEP = [56, 56, 56, 143];   // камень → камень (небо — как раньше: днём земля у поверхности видна на 5–6 клеток)
  const pow2 = m => Math.round(256 * Math.pow(m / 256, Math.SQRT2));
  const LMULD = LMUL.map(a => a.map(pow2)), LDEEPD = LDEEP.map(pow2);
  const LMAX = 300 * 300;
  const L = { r: new Uint8Array(LMAX), g: new Uint8Array(LMAX), b: new Uint8Array(LMAX), s: new Uint8Array(LMAX), cls: new Uint8Array(LMAX), fix: new Uint8Array(LMAX), op: new Uint8Array(LMAX),
    er: new Uint8Array(LMAX), eg: new Uint8Array(LMAX), eb: new Uint8Array(LMAX), Q: new Int32Array(LMAX * 4) };
  const lightCls = (f, lq, lt) => lq > 127 ? (lt === 2 ? 4 : 3) : P.OPC[f] === 1 ? 1 : P.OPC[f] === 2 ? 2 : 0;
  // W — источник клеток: { chunk(cx, cy) → { fg, wall, st, lq, lt, light } | undefined, colTop(x) → y первой непрозрачной сверху }
  // Пересчитать [x0…x1] × [y0…y1] (включительно); вернёт множество ключей тронутых чанков
  function relight(W, x0, y0, x1, y1, touched){
    if (y0 < 0) y0 = 0;
    if (y1 < y0 || x1 < x0) return touched;
    // большая коробка — по частям (каждая часть берёт свет соседних частей из кольца)
    const maxW = 296, maxH = 296;
    if (x1 - x0 + 3 > maxW) { const m = x0 + maxW - 4; relight(W, x0, y0, m, y1, touched); return relight(W, m + 1, y0, x1, y1, touched); }
    if (y1 - y0 + 3 > maxH) { const m = y0 + maxH - 4; relight(W, x0, y0, x1, m, touched); return relight(W, x0, m + 1, x1, y1, touched); }
    const X0 = x0 - 1, Y0 = y0 - 1, w = x1 - x0 + 3, h = y1 - y0 + 3;
    const R = L.r, G = L.g, Bc = L.b, Sk = L.s, cls = L.cls, fix = L.fix, op = L.op, ER = L.er, EG = L.eg, EB = L.eb, Q = L.Q;
    let qn = 0;
    // сбор
    for (let j = 0; j < h; j++) {
      const wy = Y0 + j, ring = j === 0 || j === h - 1;
      if (wy < 0) { for (let i = 0; i < w; i++) { const k = j * w + i; R[k] = G[k] = Bc[k] = 0; ER[k] = EG[k] = EB[k] = 0; Sk[k] = 255; fix[k] = 1; cls[k] = 0; op[k] = 0; Q[qn++] = k; } continue; }
      const cy = wy >> CB, ly = wy & CM;
      let lastCx = 1e9, ch = null;
      for (let i = 0; i < w; i++) {
        const wx = X0 + i, cx = wx >> CB, k = j * w + i;
        if (cx !== lastCx) { lastCx = cx; ch = W.chunk(cx, cy); }
        const isRing = ring || i === 0 || i === w - 1;
        if (!ch) { R[k] = G[k] = Bc[k] = Sk[k] = 0; ER[k] = EG[k] = EB[k] = 0; fix[k] = 1; cls[k] = 1; op[k] = 1; continue; }
        const ci = ly << CB | (wx & CM), f = ch.fg[ci], lq = ch.lq[ci], lt = ch.lt[ci];
        op[k] = P.OPC[f]; cls[k] = lightCls(f, lq, lt);
        // своё свечение клетки (из камня в воздух выходит только оно)
        let r = P.LR[f], g = P.LG[f], b = P.LB[f];
        if (lq && lt === 2) { const a = 110 + (lq * 145 >> 8); if (a > r) r = a; const ag = a * .46 | 0; if (ag > g) g = ag; const ab = a * .13 | 0; if (ab > b) b = ab; }
        ER[k] = r; EG[k] = g; EB[k] = b;
        if (isRing) {
          const li = ci << 2, lgt = ch.light;
          R[k] = lgt[li]; G[k] = lgt[li + 1]; Bc[k] = lgt[li + 2]; Sk[k] = lgt[li + 3]; fix[k] = 1;
          if (R[k] | G[k] | Bc[k] | Sk[k]) Q[qn++] = k;
          continue;
        }
        fix[k] = 0;
        R[k] = r; G[k] = g; Bc[k] = b;
        const wl = ch.wall[ci];
        Sk[k] = wy < SKY_LIMIT && wy < W.colTop(wx) && (wl === 0 || P.WSKY[wl]) ? 255 : 0;
        if (r | g | b | Sk[k]) Q[qn++] = k;
      }
    }
    // заливка (кольцо — неизменно, это свет снаружи коробки)
    let qh = 0;
    const QL = Q.length;
    let qt = qn;
    while (qh !== qt) {
      const k = Q[qh]; qh = qh + 1 === QL ? 0 : qh + 1;
      const r = R[k], g = G[k], b = Bc[k], s = Sk[k];
      if (!(r | g | b | s)) continue;
      const i = k % w, j = (k - i) / w, solid = cls[k] === 1;
      for (let n = 0; n < 8; n++) {
        let di, dj;
        switch (n) { case 0: di = 1; dj = 0; break; case 1: di = -1; dj = 0; break; case 2: di = 0; dj = 1; break; case 3: di = 0; dj = -1; break;
          case 4: di = 1; dj = 1; break; case 5: di = -1; dj = 1; break; case 6: di = 1; dj = -1; break; default: di = -1; dj = -1; }
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (fix[nk]) continue;
        const diag = n >= 4;
        if (diag && op[j * w + ni] === 1 && op[nj * w + i] === 1) continue;   // по диагонали сквозь угол стен — нет
        const cn = cls[nk];
        let up = false, nr, ng, nb, ns;
        if (solid && cn === 1) { const m = diag ? LDEEPD : LDEEP; nr = (r * m[0]) >> 8; ng = (g * m[1]) >> 8; nb = (b * m[2]) >> 8; ns = (s * m[3]) >> 8; }   // в толще камня — быстро гаснет
        else if (solid) {   // из камня наружу — только своё свечение (руда), неба нет
          const er = ER[k], eg = EG[k], eb = EB[k];
          if (!(er | eg | eb)) continue;
          const m = diag ? LMULD[cn] : LMUL[cn]; nr = (er * m[0]) >> 8; ng = (eg * m[1]) >> 8; nb = (eb * m[2]) >> 8; ns = 0;
        } else { const m = diag ? LMULD[cn] : LMUL[cn]; nr = (r * m[0]) >> 8; ng = (g * m[1]) >> 8; nb = (b * m[2]) >> 8; ns = (s * m[3]) >> 8; }
        if (nr < LCUT) nr = 0; if (ng < LCUT) ng = 0; if (nb < LCUT) nb = 0; if (ns < LCUT) ns = 0;
        if (nr > R[nk]) { R[nk] = nr; up = true; }
        if (ng > G[nk]) { G[nk] = ng; up = true; }
        if (nb > Bc[nk]) { Bc[nk] = nb; up = true; }
        if (ns > Sk[nk]) { Sk[nk] = ns; up = true; }
        if (up) { Q[qt] = nk; qt = qt + 1 === QL ? 0 : qt + 1; if (qt === qh) return touched; }
      }
    }
    // запись внутренности
    for (let j = 1; j < h - 1; j++) {
      const wy = Y0 + j; if (wy < 0) continue;
      const cy = wy >> CB, ly = wy & CM;
      let lastCx = 1e9, ch = null;
      for (let i = 1; i < w - 1; i++) {
        const wx = X0 + i, cx = wx >> CB;
        if (cx !== lastCx) { lastCx = cx; ch = W.chunk(cx, cy); if (ch && touched) touched.add(key(cx, cy)); }
        if (!ch) continue;
        const k = j * w + i, li = (ly << CB | (wx & CM)) << 2, lt = ch.light;
        lt[li] = R[k]; lt[li + 1] = G[k]; lt[li + 2] = Bc[k]; lt[li + 3] = Sk[k];
      }
    }
    return touched;
  }

  // ═══ Поток: генерация + своя копия мира для света. Сообщения — в шапке файла podzem.js (PZ.worker) ═══
  function worldWorker(self){
    const chunks = new Map(), tops = new Map();
    let G = null;
    const W = {
      chunk: (cx, cy) => chunks.get(key(cx, cy)),
      colTop(x){ let v = tops.get(x); if (v === undefined) { v = scanTop(x); tops.set(x, v); } return v; },
    };
    function scanTop(x){
      const cx = x >> CB, lx = x & CM;
      for (let y = 0; y < SKY_LIMIT;) {
        const cy = y >> CB, c = chunks.get(key(cx, cy));
        if (!c) {   // не загружен: природная поверхность
          const h = G ? G.colInfo(x).h : SURF;
          if (h < (cy + 1) * CS) return Math.max(y, h);
          y = (cy + 1) * CS; continue;
        }
        for (let ly = y & CM; ly < CS; ly++) if (P.OPC[c.fg[ly << CB | lx]] === 1) return cy * CS + ly;
        y = (cy + 1) * CS;
      }
      return SKY_LIMIT;
    }
    const post = (m, tr) => { try { self.postMessage(m, tr || []); } catch (e) { self.postMessage({ t: 'err', msg: String(e && e.message || e) }); } };
    function sendLight(touched, except){
      for (const k of touched) {
        if (k === except) continue;
        const c = chunks.get(k); if (!c) continue;
        const l = c.light.slice();
        post({ t: 'light', cx: c.cx, cy: c.cy, light: l }, [l.buffer]);
      }
    }
    function load(d){
      const k = key(d.cx, d.cy);
      let c = chunks.get(k);
      if (!c) {
        c = { cx: d.cx, cy: d.cy, fg: new Uint8Array(CA), wall: new Uint8Array(CA), st: new Uint8Array(CA), lq: new Uint8Array(CA), lt: new Uint8Array(CA), light: new Uint8Array(CA * 4) };
        if (d.save) { c.fg.set(d.save.fg); c.wall.set(d.save.wall); c.st.set(d.save.st); c.lq.set(d.save.lq); c.lt.set(d.save.lt); }
        else { G.genChunk(d.cx, d.cy, c); featsChunk(G, d.cx, d.cy, c); }
        chunks.set(k, c);
        for (let i = 0; i < CS; i++) tops.delete(d.cx * CS + i);
      }
      const touched = new Set();
      const x0 = d.cx * CS, y0 = d.cy * CS;
      relight(W, x0 - LR, y0 - LR, x0 + CM + LR, y0 + CM + LR, touched);
      const out = { t: 'chunk', cx: c.cx, cy: c.cy, fg: c.fg.slice(), wall: c.wall.slice(), st: c.st.slice(), lq: c.lq.slice(), lt: c.lt.slice(), light: c.light.slice(), gen: !d.save };
      post(out, [out.fg.buffer, out.wall.buffer, out.st.buffer, out.lq.buffer, out.lt.buffer, out.light.buffer]);
      sendLight(touched, k);
    }
    // Правки из игры: [x, y, fg, wall, st, lq, lt] × n — свет пересчитывается коробками вокруг
    function edits(a){
      const boxes = [];
      for (let n = 0; n + 6 < a.length; n += 7) {
        const x = a[n], y = a[n + 1], c = chunks.get(key(x >> CB, y >> CB));
        if (!c) continue;
        const i = (y & CM) << CB | (x & CM);
        const f0 = c.fg[i];
        c.fg[i] = a[n + 2]; c.wall[i] = a[n + 3]; c.st[i] = a[n + 4]; c.lq[i] = a[n + 5]; c.lt[i] = a[n + 6];
        let yA = y - LR, yB = y + LR;
        const op0 = P.OPC[f0] === 1, op1 = P.OPC[c.fg[i]] === 1;
        if (op0 !== op1 && y < SKY_LIMIT) {
          const was = tops.has(x) ? tops.get(x) : null;
          tops.delete(x);
          const now = W.colTop(x);
          if (was !== null && was !== now) { yA = Math.min(yA, Math.min(was, now) - LR); yB = Math.max(yB, Math.max(was, now) + LR); }
          else if (was === null) yB = Math.max(yB, Math.min(SKY_LIMIT, now) + LR);
        }
        boxes.push([x - LR, yA, x + LR, yB]);
      }
      // слить пересекающиеся коробки
      boxes.sort((p, q) => p[0] - q[0]);
      const merged = [];
      for (const b of boxes) {
        const m = merged.find(q => !(b[0] > q[2] + 1 || b[2] < q[0] - 1 || b[1] > q[3] + 1 || b[3] < q[1] - 1) && (Math.max(q[2], b[2]) - Math.min(q[0], b[0])) < 200 && (Math.max(q[3], b[3]) - Math.min(q[1], b[1])) < 400);
        if (m) { m[0] = Math.min(m[0], b[0]); m[1] = Math.min(m[1], b[1]); m[2] = Math.max(m[2], b[2]); m[3] = Math.max(m[3], b[3]); } else merged.push(b.slice());
      }
      const touched = new Set();
      for (const b of merged) relight(W, b[0], b[1], b[2], b[3], touched);
      sendLight(touched);
    }
    self.onmessage = e => {
      const d = e.data || {};
      try {
        if (d.t === 'init') { G = makeGen(d.seed, { trees: d.trees }); chunks.clear(); tops.clear(); if (d.props) applyProps(d.props); if (d.feats) setFeats(d.feats); post({ t: 'ready' }); }
        else if (d.t === 'props') { applyProps(d.props); if (d.feats) setFeats(d.feats); }
        else if (d.t === 'load') load(d);
        else if (d.t === 'drop') { chunks.delete(key(d.cx, d.cy)); for (let i = 0; i < CS; i++) tops.delete(d.cx * CS + i); }
        else if (d.t === 'edit') edits(d.a);
        else if (d.t === 'ping') post({ t: 'pong', n: d.n, chunks: chunks.size });
      } catch (er) { post({ t: 'err', msg: String(er && er.stack || er).slice(0, 400) }); }
    };
  }

  // ═══ Свойства блоков модов (и в поток): { id: { s, op, l, emis, fall, climb, … } } ═══
  function applyProps(props){
    for (const id of Object.keys(props || {})) {
      const n = +id, p = props[id];
      if (!(n >= MOD_ID0 && n < 256) || !p) continue;
      P.SOLID[n] = p.s | 0; P.OPC[n] = p.op | 0; P.LR[n] = p.l ? p.l[0] | 0 : 0; P.LG[n] = p.l ? p.l[1] | 0 : 0; P.LB[n] = p.l ? p.l[2] | 0 : 0;
      P.HARD[n] = p.h | 0; P.TIER[n] = p.t | 0; P.TOOL[n] = p.tool | 0; P.KIND[n] = p.k | 0; P.CLIMB[n] = p.climb ? 1 : 0; P.FALL[n] = p.fall ? 1 : 0;
      P.EMIS[n] = p.emis | 0; P.SUP[n] = p.sup | 0; P.GROUP[n] = p.g | 0; P.W[n] = 1; P.H[n] = 1; P.SLIP[n] = 0; P.GRASSY[n] = 0; P.LEAFY[n] = 0; P.USED[n] = 1;
    }
  }
  // Особенности генерации от модов (поток применяет после основы, если чанк не из сохранения):
  // { type: 'ore', id, minY, maxY, scale, thr, seed, host: [номера] } — жилы по шуму в камне;
  // { type: 'scatter', id, minY, maxY, chance, seed, on: [номера] } — по одному на полу (сверху на блоке из on)
  let FEATS = [];
  function setFeats(f){ FEATS = Array.isArray(f) ? f.slice(0, 32) : []; }
  function featsChunk(G, cx, cy, out){
    if (!FEATS.length) return out;
    const x0 = cx * CS, y0 = cy * CS, S = G.seed;
    for (const F of FEATS) {
      if (!F || !(F.id > 0 && F.id < 256) || y0 + CM < F.minY || y0 > F.maxY) continue;
      const host = new Set(F.host || F.on || []);
      for (let ly = 0; ly < CS; ly++) {
        const y = y0 + ly; if (y < F.minY || y > F.maxY) continue;
        for (let lx = 0; lx < CS; lx++) {
          const i = ly << CB | lx, x = x0 + lx;
          if (F.type === 'ore') {
            if (host.has(out.fg[i]) && noise2(x * F.scale, y * F.scale, S + F.seed) > F.thr) { out.fg[i] = F.id; out.st[i] = 0; }
          } else if (F.type === 'scatter') {
            if (out.fg[i] || out.lq[i] || ly === CM) continue;
            if (host.has(out.fg[i + CS]) && rnd2(x, y, S + F.seed) < F.chance) out.fg[i] = F.id;
          }
        }
      }
    }
    return out;
  }

  // ═══ Жидкости и песок: шаг по «проснувшимся» чанкам ═══
  // W: { chunk(cx, cy), changed(x, y, fgChanged) } ; c.awake — счётчик «спокойных» шагов (0 — спит)
  // Правила: вниз, сколько влезет; иначе в стороны — только к соседу ниже уровнем на 2+ (без «качелей»);
  // лава течёт в 4 раза реже; вода + лава → обсидиан (единственная потеря жидкости). Песок падает вниз.
  const blocksLiquid = f => f !== 0 && (P.SOLID[f] === 1 || P.SOLID[f] === 3);
  function liquidStep(W, list, tick, budget){
    let work = 0;
    const dirR = (tick & 1) === 0;
    for (let n = 0; n < list.length; n++) {
      const c = list[n];
      if (!c.awake) continue;
      let changed = false;
      const x0 = c.cx * CS, y0 = c.cy * CS;
      for (let ly = CM; ly >= 0; ly--) {
        for (let q = 0; q < CS; q++) {
          const lx = dirR ? q : CM - q, i = ly << CB | lx;
          const f = c.fg[i];
          if (P.FALL[f]) { if (sandFall(W, c, x0 + lx, y0 + ly, i)) { changed = true; work++; } continue; }
          const a = c.lq[i];
          if (!a) continue;
          const t = c.lt[i];
          if (t === 2 && (tick & 3) !== 0) continue;
          work++;
          if (flow(W, c, x0 + lx, y0 + ly, i, a, t, dirR)) changed = true;
        }
        if (work > budget) { c.awake = Math.max(c.awake, 2); return work; }
      }
      if (changed) c.awake = 40; else c.awake--;
    }
    return work;
  }
  // клетка (cx, cy, i) по мировым координатам; null — не загружено
  const cellRef = { c: null, i: 0 };
  function at(W, c, x, y){
    if (y < 0) return null;
    const cx = x >> CB, cy = y >> CB;
    const ch = cx === c.cx && cy === c.cy ? c : W.chunk(cx, cy);
    if (!ch) return null;
    cellRef.c = ch; cellRef.i = (y & CM) << CB | (x & CM);
    return cellRef;
  }
  function wakeAt(W, x, y){ const ch = W.chunk(x >> CB, y >> CB); if (ch) ch.awake = 40; }
  function sandFall(W, c, x, y, i){
    const r = at(W, c, x, y + 1);
    if (!r) return false;
    const bc = r.c, bi = r.i, bf = bc.fg[bi];
    if (bf !== 0) return false;
    // песок вниз, жидкость снизу — наверх
    const f = c.fg[i];
    bc.fg[bi] = f; bc.st[bi] = 0; c.fg[i] = 0; c.st[i] = 0;
    const lq = bc.lq[bi], lt = bc.lt[bi]; bc.lq[bi] = 0; bc.lt[bi] = 0;
    if (lq) { c.lq[i] = lq; c.lt[i] = lt; }
    W.changed(x, y, true); W.changed(x, y + 1, true);
    if (bc !== c) bc.awake = 40;
    wakeAt(W, x, y - 1);
    return true;
  }
  function flow(W, c, x, y, i, a, t, dirR){
    let moved = false;
    // вниз
    const d = at(W, c, x, y + 1);
    if (d && !blocksLiquid(d.c.fg[d.i])) {
      const dc = d.c, di = d.i, bt = dc.lt[di], bl = dc.lq[di];
      if (bl && bt && bt !== t) { mix(W, c, i, x, y, dc, di, x, y + 1, t); return true; }
      const room = 255 - bl;
      if (room > 0) {
        const m = a < room ? a : room;
        dc.lq[di] = bl + m; dc.lt[di] = t; a -= m; c.lq[i] = a; if (!a) c.lt[i] = 0;
        W.changed(x, y, false); W.changed(x, y + 1, false);
        if (dc !== c) dc.awake = 40;
        moved = true;
        if (!a) return true;
      }
    }
    // в стороны
    // (at() отдаёт общий объект — сначала забираем поля)
    const below = d ? d.c : null, bi = d ? d.i : 0;
    const l = at(W, c, x - 1, y), lc = l && l.c, li = l && l.i;
    const lOk = !!l && !blocksLiquid(lc.fg[li]);
    const r = at(W, c, x + 1, y), rc = r && r.c, ri = r && r.i;
    const rOk = !!r && !blocksLiquid(rc.fg[ri]);
    if (lOk && lc.lq[li] && lc.lt[li] !== t) { mix(W, c, i, x, y, lc, li, x - 1, y, t); return true; }
    if (rOk && rc.lq[ri] && rc.lt[ri] !== t) { mix(W, c, i, x, y, rc, ri, x + 1, y, t); return true; }
    const la = lOk ? lc.lq[li] : 256, ra = rOk ? rc.lq[ri] : 256;
    const goL = la < a - 1, goR = ra < a - 1;
    if (goL && goR) {
      const tot = a + la + ra, each = (tot / 3) | 0;
      if (each !== la || each !== ra) {
        lc.lq[li] = each; lc.lt[li] = t; rc.lq[ri] = each; rc.lt[ri] = t; c.lq[i] = tot - 2 * each;
        W.changed(x - 1, y, false); W.changed(x + 1, y, false); W.changed(x, y, false);
        if (lc !== c) lc.awake = 40; if (rc !== c) rc.awake = 40;
        return true;
      }
    }
    if (goL || goR) {
      const toL = goL && (!goR || la < ra || (la === ra && dirR));
      const oc = toL ? lc : rc, oi = toL ? li : ri, oa = toL ? la : ra, ox = toL ? x - 1 : x + 1;
      const tot = a + oa, o2 = (tot / 2) | 0;
      oc.lq[oi] = o2; oc.lt[oi] = t; c.lq[i] = tot - o2;
      W.changed(ox, y, false); W.changed(x, y, false);
      if (oc !== c) oc.awake = 40;
      return true;
    }
    // (без «высыхания»: растекание само останавливается на разнице уровней в 1 — плёнка в 1/255 клетки не видна,
    //  зато воды ровно столько, сколько было)
    return moved;
  }
  // вода + лава → обсидиан на месте лавы
  function mix(W, c, i, x, y, oc, oi, ox, oy, t){
    const lavaHere = t === 2;
    const lc = lavaHere ? c : oc, li = lavaHere ? i : oi, lxw = lavaHere ? x : ox, lyw = lavaHere ? y : oy;
    const wc = lavaHere ? oc : c, wi = lavaHere ? oi : i, wx = lavaHere ? ox : x, wy = lavaHere ? oy : y;
    if (lc.lq[li] >= 24) { lc.fg[li] = T.OBSIDIAN; lc.st[li] = 0; }
    lc.lq[li] = 0; lc.lt[li] = 0;
    const wl = wc.lq[wi]; wc.lq[wi] = wl > 40 ? wl - 40 : 0; if (!wc.lq[wi]) wc.lt[wi] = 0;
    W.changed(lxw, lyw, true); W.changed(wx, wy, false);
    lc.awake = 40; wc.awake = 40;
  }

  // ═══ Столкновения тела с клетками ═══
  // Тело: { x, y (левый верх), w, h, vx, vy, ground, hitHead, wallL, wallR, stepUp (выше какой ступеньки шагает), drop (сквозь
  // платформы), stepOff (картинке — сгладить подъём) }. shapeAt(tx, ty) → 0 пусто, 1 целый, 2 полублок (низ), 3 склон «/»
  // (выше справа), 4 склон «\» (выше слева), 5 платформа (держит только сверху).
  const EPS = 1e-4;
  // верх твёрдого в клетке на отрезке [xa, xb] (самая высокая точка) — для склонов зависит от того, какой кусок клетки занят
  function surfTop(sh, tx, ty, xa, xb){
    switch (sh) {
      case 1: case 5: return ty;
      case 2: return ty + .5;
      case 3: { let u = xb - tx; if (u > 1) u = 1; return ty + 1 - u; }
      case 4: { let u = xa - tx; if (u < 0) u = 0; return ty + u; }
    }
    return Infinity;
  }
  function overlapSolid(b, x, y, shapeAt){   // есть ли твёрдое в коробке (платформы — нет)
    const tx0 = Math.floor(x + EPS), tx1 = Math.floor(x + b.w - EPS), ty0 = Math.floor(y + EPS), ty1 = Math.floor(y + b.h - EPS);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = shapeAt(tx, ty); if (!s || s === 5) continue;
      const top = surfTop(s, tx, ty, Math.max(x, tx), Math.min(x + b.w, tx + 1));
      if (top < y + b.h - EPS && ty + 1 > y + EPS) return true;
    }
    return false;
  }
  function moveX(b, dx, shapeAt){
    if (!dx) return;
    const nx = b.x + dx, y = b.y;
    const tx0 = Math.floor(nx + EPS), tx1 = Math.floor(nx + b.w - EPS), ty0 = Math.floor(y + EPS), ty1 = Math.floor(y + b.h - EPS);
    let rise = 0, block = false, wallAt = dx > 0 ? Infinity : -Infinity;
    const canStep = b.ground || b.wasGround;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = shapeAt(tx, ty); if (!s || s === 5) continue;
      const xa = Math.max(nx, tx), xb = Math.min(nx + b.w, tx + 1);
      const top = surfTop(s, tx, ty, xa, xb);
      if (!(top < y + b.h - EPS && ty + 1 > y + EPS)) continue;
      // уже были в этой клетке до шага (склон под ногами) — не стена
      const r = y + b.h - top;
      if (canStep && r <= b.stepUp + EPS) { if (r > rise) rise = r; continue; }
      // стена: склон высокой стороной или целый блок
      block = true;
      if (dx > 0) { if (tx < wallAt) wallAt = tx; }
      else if (tx + 1 > wallAt) wallAt = tx + 1;
    }
    if (block) {
      if (dx > 0) { b.x = Math.max(b.x, Math.min(nx, wallAt - b.w)); b.wallR = true; }
      else { b.x = Math.min(b.x, Math.max(nx, wallAt)); b.wallL = true; }
      b.vx = 0;
      return;
    }
    if (rise > EPS) {
      if (overlapSolid(b, nx, y - rise, shapeAt)) { b.vx = 0; if (dx > 0) b.wallR = true; else b.wallL = true; return; }
      b.y -= rise; b.stepOff = (b.stepOff || 0) + rise; b.ground = true;
    }
    b.x = nx;
  }
  function moveY(b, dy, shapeAt){
    if (dy > 0) {
      const oldBot = b.y + b.h, newBot = oldBot + dy;
      const tx0 = Math.floor(b.x + EPS), tx1 = Math.floor(b.x + b.w - EPS);
      const ty0 = Math.floor(oldBot - .55), ty1 = Math.floor(newBot - EPS);
      let land = Infinity;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const s = shapeAt(tx, ty); if (!s) continue;
        if (s === 5 && (b.drop || oldBot > ty + EPS)) continue;
        const top = surfTop(s, tx, ty, Math.max(b.x, tx), Math.min(b.x + b.w, tx + 1));
        if (top >= oldBot - .5 && top <= newBot + EPS && top < land) land = top;
      }
      if (land < Infinity) { b.y = land - b.h; b.vy = 0; b.ground = true; }
      else b.y += dy;
    } else if (dy < 0) {
      const oldTop = b.y, newTop = b.y + dy;
      const tx0 = Math.floor(b.x + EPS), tx1 = Math.floor(b.x + b.w - EPS);
      const ty0 = Math.floor(oldTop + EPS) - 1, ty1 = Math.floor(newTop);
      let ceil = -Infinity;
      for (let ty = ty0; ty >= ty1; ty--) for (let tx = tx0; tx <= tx1; tx++) {
        const s = shapeAt(tx, ty); if (!s || s === 5) continue;
        const bot = ty + 1;
        if (bot <= oldTop + EPS && bot > newTop && bot > ceil) ceil = bot;
      }
      if (ceil > -Infinity) { b.y = ceil; b.vy = 0; b.hitHead = true; }
      else b.y = newTop;
    }
  }
  // земля под ногами в пределах dist (для «прилипания» на спуске) → расстояние или −1
  function groundBelow(b, dist, shapeAt){
    const bot = b.y + b.h;
    const tx0 = Math.floor(b.x + EPS), tx1 = Math.floor(b.x + b.w - EPS), ty0 = Math.floor(bot - EPS), ty1 = Math.floor(bot + dist);
    let best = Infinity;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const s = shapeAt(tx, ty); if (!s) continue;
      if (s === 5 && (b.drop || bot > ty + EPS)) continue;
      const top = surfTop(s, tx, ty, Math.max(b.x, tx), Math.min(b.x + b.w, tx + 1));
      if (top >= bot - EPS && top - bot <= dist && top < best) best = top;
    }
    return best === Infinity ? -1 : best - bot;
  }
  // Шаг тела: dt — секунды. Скорости уже посчитаны игрой (гравитация, ввод)
  function moveBody(b, dt, shapeAt){
    b.wasGround = b.ground; b.ground = false; b.hitHead = false; b.wallL = false; b.wallR = false;
    const dx = b.vx * dt, dy = b.vy * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / .4));
    for (let k = 0; k < n; k++) {
      moveX(b, dx / n, shapeAt);
      if (b.vy) moveY(b, dy / n, shapeAt);   // приземлились или стукнулись — дальше только по x
    }
    // прилипание к земле на спуске (не в прыжке)
    if (!b.ground && b.wasGround && b.vy >= 0 && !b.noSnap) {
      const g = groundBelow(b, .6, shapeAt);
      if (g >= 0) { b.y += g; b.ground = true; b.vy = 0; }
    }
    return b;
  }

  // ═══ Упаковка чанка (сохранение): 5 массивов подряд → RLE пары [длина−1, значение] ═══
  function packChunk(c){
    const src = [c.fg, c.wall, c.st, c.lq, c.lt];
    const out = new Uint8Array(CA * 5 * 2 + 8);
    let o = 0;
    out[o++] = 0x50; out[o++] = 0x5a; out[o++] = 1; out[o++] = 0;   // «PZ», версия 1
    for (const a of src) {
      let i = 0;
      while (i < CA) {
        const v = a[i]; let n = 1;
        while (i + n < CA && n < 256 && a[i + n] === v) n++;
        out[o++] = n - 1; out[o++] = v; i += n;
      }
    }
    return out.slice(0, o);
  }
  function unpackChunk(u){
    if (!u || u.length < 4 || u[0] !== 0x50 || u[1] !== 0x5a) throw new Error('не чанк');
    const arrs = [new Uint8Array(CA), new Uint8Array(CA), new Uint8Array(CA), new Uint8Array(CA), new Uint8Array(CA)];
    let o = 4;
    for (const a of arrs) {
      let i = 0;
      while (i < CA) {
        if (o + 1 >= u.length) throw new Error('обрезано');
        const n = u[o++] + 1, v = u[o++];
        if (i + n > CA) throw new Error('битые данные');
        a.fill(v, i, i + n); i += n;
      }
    }
    return { fg: arrs[0], wall: arrs[1], st: arrs[2], lq: arrs[3], lt: arrs[4] };
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toB64(u){
    let s = '', i = 0;
    for (; i + 2 < u.length; i += 3) { const n = u[i] << 16 | u[i + 1] << 8 | u[i + 2]; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + B64[n >> 6 & 63] + B64[n & 63]; }
    if (i < u.length) { const n = u[i] << 16 | (i + 1 < u.length ? u[i + 1] << 8 : 0); s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u.length ? B64[n >> 6 & 63] : '=') + '='; }
    return s;
  }
  function fromB64(s){
    s = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0, n = s.length / 4 * 3 - pad;
    if (s.length % 4 || n < 0) throw new Error('base64');
    const u = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const v = B64.indexOf(s[i]) << 18 | B64.indexOf(s[i + 1]) << 12 | (s[i + 2] === '=' ? 0 : B64.indexOf(s[i + 2]) << 6) | (s[i + 3] === '=' ? 0 : B64.indexOf(s[i + 3]));
      if (o < n) u[o++] = v >> 16 & 255; if (o < n) u[o++] = v >> 8 & 255; if (o < n) u[o++] = v & 255;
    }
    return u;
  }

  // Исходник для потока: эта функция целиком + запуск worldWorker
  // + движок деревьев (T-022b) текстом впереди — деревья пород считаются в потоке так же, как в окне
  function workerSource(){ const tr = typeof window !== 'undefined' && window.D37E && window.D37E.trees && window.D37E.trees.src || ''; return tr + '\n(' + PZ_CORE.toString() + ')().worldWorker(self);'; }

  return {
    CS, CB, CM, CA, SURF, SKY_LIMIT, MOD_ID0, LR, LCUT, LMUL, LMULD, LDEEP, LDEEPD, key,
    hash2, rnd2, rnd1, noise1, noise2, fbm1, smooth,
    P, TILES, TILE, WALLS, WALL, T, WL, B, BIOME_NAMES, ITEMS, ITEM_LIST, RECIPES, KINDS, TOOLS, SUPS,
    defTile, defWall, defItem, applyProps, setFeats, featsChunk,
    makeGen, relight, worldWorker, workerSource, liquidStep, blocksLiquid,
    surfTop, moveX, moveY, moveBody, groundBelow, overlapSolid,
    packChunk, unpackChunk, toB64, fromB64,
  };
}
root.PZ_CORE = PZ_CORE;
if (typeof window !== 'undefined') window.PZ = PZ_CORE();
if (typeof module !== 'undefined' && module.exports) module.exports = PZ_CORE;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);

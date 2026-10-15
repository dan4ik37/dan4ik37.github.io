// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — моды «Кубомира» (кубический мир): общий формат модов сайта (docs/MODS.md, game: voxel | tiles | both;
//  тот же mod.json и API скриптов версии 1, что у «Подземья» — js/games/podzem-mods.js), чтение .d37mod (zip) / папки / mod.json
// ═══════════════════════════════════════
// Данные: блоки, предметы, рецепты, текстуры, генерация (worldgen) — из общей части; своё для кубического мира — новыми
// полями, которые 2D-игра пропускает (faces, shape, sound, bounce, food, fuel, features, pattern в рецептах…, docs/MODS.md §7).
// V.mods.validate(json, files) → { ok, errors, warnings, m } — без браузера (её зовут тест и окно модов); m — уже в единицах
// кубического мира (секунды ломания, уровень света 0…15, высоты y). reset() — вернуть ваниль; register(m, rgba) — в реестр;
// recipes(m) — рецепты (когда все моды мира в реестре); features(list) — генерация для потоков (номера блоков).
// Скрипты: у каждого мода своя песочница — iframe sandbox (ни куки, ни базы сайта) + CSP без сети → поток (Worker); поток
// отвечает на «пинг» с номером, молчит 3 с — убит. API версии 1 — как у «Подземья»: mod, world, fx, npc, commands, player,
// game, print; координаты — x, y, z. Каждое действие проверяет игра (runner): 400 действий за событие, 600 в секунду,
// world.set — до 64 блоков от игрока и не трогает станки/сундуки/двери, give — свои и простые предметы. 5 ошибок, ошибка
// при запуске, зависание или 5 медленных обработчиков — мод выключен до перезапуска мира (игра живёт), игроку — сообщение.
// Каталог модов с модерацией — крючок V.mods.catalog (пока пустой; план — как «Студия игр»: ugc + проверка модератором).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  if (!V.blocks) return;   // поток генерации (voxel-worker.js) модов не знает — ему приходят готовые таблицы
  const API = 1;
  const LIM = { blocks: 64, items: 128, recipes: 256, worldgen: 16, features: 16, scripts: 4, code: 200000, textureBytes: 2.5e6, files: 200, zipBytes: 8e6, perEvent: 400, perSec: 600 };
  const ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/, NAME_RE = /^[a-z0-9_-]{1,32}$/, TEX_RE = /^[a-z0-9_-]{1,32}$/i, VER_RE = /^\d+(\.\d+){0,3}([-+][\w.]+)?$/;
  const SHAPES = { cube: 1, cross: 2, torch: 4, ladder: 5, cactus: 7, chest: 8 };
  const SOUNDS = ['stone', 'wood', 'dirt', 'grass', 'sand', 'gravel', 'snow', 'glass', 'metal', 'wool'];
  const TINTS = { grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5 };
  const EVENTS = ['tileBreak', 'tilePlace', 'use', 'tick', 'mobKill', 'pickup', 'talk', 'start', 'stepOn', 'chat'];
  const SEA = V.SEA || 52;
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const num = (v, d, a, b) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? +v : NaN; return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : d; };
  const bytes = f => f == null ? 0 : typeof f === 'string' ? f.length : f.length || f.byteLength || 0;
  const text = f => typeof f === 'string' ? f : new TextDecoder().decode(f);
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const colorOf = v => typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : null;
  // свет: «#ff4060» / [r, g, b] (общий формат, свет цветной в 2D) → яркость 0…15 (в кубическом мире свет белый); число — сразу уровень
  const lightOf = v => {
    if (typeof v === 'number') return Math.max(0, Math.min(15, Math.round(v)));
    let rgb = null;
    if (Array.isArray(v) && v.length === 3) rgb = v.map(x => num(x, 0, 0, 255));
    else { const c = colorOf(v); if (c) { const n = parseInt(c.slice(1), 16); rgb = [n >> 16 & 255, n >> 8 & 255, n & 255]; } }
    return rgb ? Math.round(Math.max(...rgb) / 255 * 15) : 0;
  };
  // глубина в метрах (общий формат, от уровня поверхности) → высота y: уровень — море (y = 52), до 44 м — метр в метр; глубже мир
  // кончается — сжимается в самый низ (y 8 → 2), чтобы «очень глубокие» руды «Подземья» были на самом дне кубического мира
  const yOfDepth = d => d <= 44 ? Math.max(1, Math.min(V.H - 2, Math.round(SEA - d))) : Math.max(2, Math.round(8 - 6 * (1 - 44 / d)));
  // ключи 2D-игры («Подземье») → кубический мир (для модов game: both): что похоже
  const ALIAS = { wood: 'planks_oak', planks: 'planks_oak', workbench: 'crafting_table', gel: 'slime_ball', bar_iron: 'iron_ingot', bar_gold: 'gold_ingot',
    iron: 'ore_iron', gold: 'ore_gold', deepore: 'ore_diamond', deepstone: 'stone', stonebrick: 'stone_bricks', mud: 'dirt', jgrass: 'grass', ash: 'gravel', platform: 'planks_oak', rope: 'ladder' };
  const ING_ALIAS = { wood: '#planks', planks: '#planks' };
  // простые предметы, которые скрипт может дать игроку (кроме своих), — как GIVE_OK у «Подземья»
  const GIVE_OK = new Set(['dirt', 'stone', 'cobble', 'sand', 'glass', 'torch', 'ladder', 'stick', 'slime_ball', 'planks_oak', 'planks_birch', 'planks_spruce', 'log_oak', 'log_birch', 'log_spruce']);
  // рисунок общего формата { pattern, base, color2, color3 } → рисунок движка (voxel-tex.js)
  const DRAW = {
    dirt: d => ({ k: 'noise', c: d.base, a: .18 }), stone: d => ({ k: 'noise', c: d.base, a: .14 }), sand: d => ({ k: 'noise', c: d.base, a: .08 }),
    snow: d => ({ k: 'noise', c: d.base, a: .04 }), ice: d => ({ k: 'noise', c: d.base, a: .06 }), obsid: d => ({ k: 'noise', c: d.base, a: .35 }),
    strata: d => ({ k: 'stripes', c: d.base, c2: d.color2 }), ore: d => ({ k: 'ore', base: d.base, c: d.color2, n: 5 }), planks: d => ({ k: 'planks', c: d.base }),
    brick: d => ({ k: 'bricks', c: d.base, m: d.color2 }), glass: d => ({ k: 'glass', c: d.base }), leaves: d => ({ k: 'leaves', c: d.base }),
    crystal: d => ({ k: 'dots', c: d.base, c2: d.color2, n: 14 }), glowshroom: d => ({ k: 'plant', flower: d.color2, center: d.color3, stem: d.base }),
    mushroom: d => ({ k: 'plant', flower: d.color2, center: d.color3, stem: '#d8cfc0' }), torch: () => ({ k: 'torch' }), lamp: () => ({ k: 'lamp' }),
    pick: d => ({ k: 'tool', tool: 'pick', c: d.base }), axe: d => ({ k: 'tool', tool: 'axe', c: d.base }), hammer: d => ({ k: 'tool', tool: 'shovel', c: d.base }),
    sword: d => ({ k: 'tool', tool: 'sword', c: d.base }), bow: d => ({ k: 'stick', c: d.base }), arrow: d => ({ k: 'stick', c: d.base }), wand: d => ({ k: 'stick', c: d.base }),
    fiber: d => ({ k: 'stick', c: d.base }), bar: d => ({ k: 'ingot', c: d.base }), gem: d => ({ k: 'gem', c: d.base }), star: d => ({ k: 'gem', c: d.base }),
    heart: d => ({ k: 'gem', c: d.base }), amulet: d => ({ k: 'gem', c: d.base }), feather: () => ({ k: 'feather' }),
    gel: d => ({ k: 'lump', c: d.base }), membrane: d => ({ k: 'lump', c: d.base }), bottle: d => ({ k: 'lump', c: d.base }), potion: d => ({ k: 'lump', c: d.base }),
    bait: d => ({ k: 'lump', c: d.base }), lure: d => ({ k: 'lump', c: d.base }), boots: d => ({ k: 'lump', c: d.base }), wings: d => ({ k: 'lump', c: d.base }),
  };
  const GRAY = { k: 'noise', c: '#8a8a96', a: .12 };

  // ваниль — чтобы вернуть реестр, когда открывают другой мир (с другими модами или без них)
  const VAN = { blocks: V.VANILLA_BLOCKS, items: V.VANILLA_ITEMS, recipes: V.VANILLA_RECIPES, tex: V.tex.length, smelt: new Map(V.smelting), tags: JSON.stringify(V.TAGS) };
  const vanilla = n => !n.includes(':') && !!(V.item(n) || V.block(n));
  const vanTex = n => V.texIdx.has(n) && V.texIdx.get(n) < VAN.tex;

  // ═══ Проверка mod.json ═══
  // files — { 'путь/в/моде': Uint8Array | строка } или Map (картинки и скрипты из архива или папки)
  function validate(json, files0 = {}){
    const files = files0 instanceof Map ? Object.fromEntries(files0) : files0 || {};
    const errors = [], warnings = [], err = t => { if (errors.length < 60) errors.push(t); }, warn = t => { if (warnings.length < 60) warnings.push(t); };
    let j = json;
    if (j instanceof Uint8Array) j = text(j);
    if (typeof j === 'string') { if (j.charCodeAt(0) === 0xFEFF) j = j.slice(1); try { j = JSON.parse(j); } catch (e) { return { ok: false, errors: ['mod.json — не JSON: ' + e.message], warnings, m: null }; } }
    if (!isObj(j)) return { ok: false, errors: ['mod.json — не объект { … }'], warnings, m: null };
    for (const k of Object.keys(j)) if (k === '__proto__' || k === 'constructor' || k === 'prototype') err('запрещённое поле ' + k);
    const id = str(j.id, 40);
    if (!ID_RE.test(id)) err('id: латиница в нижнем регистре, цифры, «-» и «_», 2–32 знака (например, "ruby-glow")');
    const name = str(j.name, 40); if (!name) err('name: название мода (до 40 знаков)');
    const version = str(j.version, 16); if (!VER_RE.test(version)) err('version: например "1.0.0"');
    const game = ['voxel', 'tiles', 'both'].includes(j.game) ? j.game : null;
    if (!game) err('game: "voxel" (кубический мир), "tiles" (Подземье) или "both"');
    else if (game === 'tiles') err('мод для другой игры (game: "tiles" — «Подземье»)');
    const api = j.api === undefined ? API : j.api;
    if (api !== API) (api > API ? err : warn)(`api: ${api} (игра знает версию ${API})`);
    const m = { id, name: name || id, version, game, api: API, author: str(j.author, 40), description: str(j.description, 400), textures: {}, blocks: [], items: [], recipes: [], features: [], scripts: [], useItems: [], size: 0, needs: [] };
    const blocks = Array.isArray(j.blocks) ? j.blocks.slice(0, LIM.blocks) : [], items = Array.isArray(j.items) ? j.items.slice(0, LIM.items) : [];
    if (j.blocks !== undefined && !Array.isArray(j.blocks)) err('blocks — список');
    if (j.items !== undefined && !Array.isArray(j.items)) err('items — список');
    if (Array.isArray(j.blocks) && j.blocks.length > LIM.blocks) err(`блоков больше ${LIM.blocks}`);
    if (Array.isArray(j.items) && j.items.length > LIM.items) err(`предметов больше ${LIM.items}`);
    // свои имена: блоки и предметы (у блока есть и предмет с тем же именем)
    const ownB = new Set(), ownI = new Set();
    for (const b of blocks) if (isObj(b) && NAME_RE.test(b.id)) ownB.add(b.id);
    for (const it of items) if (isObj(it) && NAME_RE.test(it.id)) ownI.add(it.id);
    const ownAny = n => ownB.has(n) || ownI.has(n);
    // имя из mod.json → имя в игре: своё — «мод:имя», игры — как есть, 2D-ключ — похожее, чужой мод — полностью
    const ref = (n0, where, o = {}) => {
      const n = String(n0 ?? '').trim();
      if (!n) return '';
      if (n[0] === '#') { if (o.tag === false || !V.TAGS[n.slice(1)]) { warn(`${where}: группа «${n}» здесь не подходит`); return ''; } return n; }
      if (n.includes(':')) {
        const [p, q] = n.split(':');
        if (p === id) { if (o.block ? !ownB.has(q) : !ownAny(q)) { err(`${where}: у мода нет «${q}»`); return ''; } return n; }
        if (!m.needs.includes(p)) { m.needs.push(p); warn(`нужен мод «${p}» (без него то, что на нём, не заработает)`); }
        return n;
      }
      if (o.block ? ownB.has(n) : ownAny(n)) return id + ':' + n;
      if (o.ing && ING_ALIAS[n]) return ING_ALIAS[n];
      if (vanilla(n) && (!o.block || V.block(n))) return n;
      if (ALIAS[n] && (!o.block || V.block(ALIAS[n]))) return ALIAS[n];
      warn(`${where}: «${n}» в кубическом мире нет — пропущено`); return '';
    };
    // ── текстуры ──
    let texBytes = 0;
    if (j.textures !== undefined && !isObj(j.textures)) err('textures — объект { имя: картинка }');
    for (const [tn, v0] of Object.entries(isObj(j.textures) ? j.textures : {}).slice(0, 256)) {
      if (!TEX_RE.test(tn)) { err(`textures: имя «${tn}» — латиница/цифры/«_»`); continue; }
      let v = v0;
      if (isObj(v) && typeof v.png === 'string') v = v.png;           // { png: путь } — как строка
      else if (isObj(v) && typeof v.data === 'string') v = v.data;     // { data: data:… } — как строка
      if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) {
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)) { err(`textures.${tn}: испорченный data:image/png`); continue; }
        texBytes += v.length * .75; m.textures[tn] = { data: v };
      } else if (typeof v === 'string' && /^[\w./-]{1,120}\.png$/i.test(v) && !v.includes('..') && !v.startsWith('/')) {
        const p = v.replace(/^\.\//, ''), f = files[p];
        if (f == null) { err(`textures.${tn}: нет файла ${v}`); continue; }
        texBytes += bytes(f); m.textures[tn] = { png: p };
      } else if (isObj(v) && isObj(v.draw)) {
        const d = v.draw;
        if (typeof d.k === 'string') {   // рисунок движка напрямую (только кубический мир)
          if (!V.PAINTERS.includes(d.k) || d.k === 'destroy') { err(`textures.${tn}: draw.k — один из: ${V.PAINTERS.filter(k => k !== 'destroy').join(', ')}`); continue; }
          const spec = {};
          for (const [k, x] of Object.entries(d)) if (/^[a-z][a-z0-9]{0,11}$/i.test(k) && ((typeof x === 'number' && Number.isFinite(x)) || typeof x === 'boolean' || (typeof x === 'string' && x.length < 40))) spec[k] = x;
          m.textures[tn] = { draw: spec };
        } else {
          const base = colorOf(d.base) || '#888888', g = { pattern: DRAW[d.pattern] ? d.pattern : 'stone', base, color2: colorOf(d.color2) || base, color3: colorOf(d.color3) || '#ffffff' };
          if (d.pattern && !DRAW[d.pattern]) warn(`textures.${tn}: узора «${d.pattern}» нет — будет «stone»`);
          m.textures[tn] = { draw: DRAW[g.pattern](g) };
        }
      } else err(`textures.${tn}: PNG (data:image/png;base64,…), путь к .png в архиве или { "draw": {…} }`);
    }
    if (texBytes > LIM.textureBytes) err(`картинки больше ${LIM.textureBytes / 1e6} МБ`);
    const texOne = (s, where, gray) => {
      s = String(s ?? '');
      if (m.textures[s]) return id + ':' + s;
      if (vanTex(s)) return s;
      if (gray) { warn(`${where}: нет текстуры «${s}» — будет серым`); return id + ':__gray'; }
      err(`${where}: нет текстуры «${s}»`); return null;
    };
    let needGray = false;
    // ── блоки ──
    const seen = new Set();
    blocks.forEach((b, i) => {
      if (!isObj(b) || !NAME_RE.test(b.id)) { err(`blocks[${i}]: нужен id (латиница, цифры, «-», «_»)`); return; }
      const w = `блок «${b.id}»`;
      if (seen.has('b:' + b.id)) { err(`blocks: id «${b.id}» дважды`); return; } seen.add('b:' + b.id);
      const shape = SHAPES[b.shape || 'cube'];
      if (!shape) { err(`${w}: shape — ${Object.keys(SHAPES).join(', ')}`); return; }
      // текстура: общий формат — одна (texture); по граням — faces { top, side, bottom, front } (кубический мир)
      let tex = texOne(str(b.texture, 32) || b.id, w, true);
      const fc = isObj(b.faces) ? b.faces : isObj(b.texture) ? b.texture : null;
      if (fc) {
        const o = {}; let bad = false;
        for (const k of ['all', 'top', 'bottom', 'side', 'front']) if (fc[k]) { o[k] = texOne(fc[k], w); if (!o[k]) bad = true; }
        if (bad) return;
        if (!o.all && !o.side) o.side = tex;
        tex = o;
      }
      if (typeof tex === 'string' && tex.endsWith(':__gray')) needGray = true;
      const solid = shape === 2 || shape === 4 ? false : b.solid !== undefined ? b.solid !== false : shape !== 5;
      const transparent = !!b.transparent || shape !== 1, opaque = shape === 1 && !transparent;
      const hard = b.hardness === -1 || b.unbreakable === true ? -1 : num(b.hardness, 60, 0, 2000) * .015;   // общая прочность (камень 100) → секунды рукой
      const tool = b.tool === 'any' ? '' : b.tool === 'hammer' ? 'pick' : ['pick', 'axe', 'shovel', 'sword'].includes(b.tool) ? b.tool : solid ? 'pick' : '';
      const nb = { name: id + ':' + b.id, title: str(b.name, 40) || b.id, tex, shape, layer: opaque ? 1 : 2, solid, opaque, op: opaque ? 15 : num(b.lightBlock, 0, 0, 15) | 0,
        emit: lightOf(b.light), hard: hard < 0 ? -1 : Math.round(hard * 100) / 100, tool, tier: Math.min(4, num(b.tier, 0, 0, 5) | 0),
        sound: SOUNDS.includes(b.sound) ? b.sound : 'stone', bounce: num(b.bounce, 0, 0, 30), hurt: num(b.hurt, 0, 0, 10), slip: num(b.slip, 0, 0, .98),
        climb: !!(b.climbable || b.climb) || shape === 5, replace: !!b.replaceable, fall: !!b.falls, cullSelf: b.cullSelf !== false && shape !== 7 && shape !== 8,
        axis: !!b.axis && shape === 1, tint: TINTS[b.tint] || 0, ui: b.ui === 'craft' || b.ui === 'chest' ? b.ui : '', fuel: num(b.fuel, 0, 0, 600), stack: Math.min(64, num(b.stack, 64, 1, 999) | 0), mod: id };
      if (b.sound && !SOUNDS.includes(b.sound)) warn(`${w}: звука «${b.sound}» нет — будет stone`);
      const dr = b.drop !== undefined ? b.drop : b.drops;
      if (dr === '' || dr === null || dr === false) nb.drop = null;
      else if (dr !== undefined) { nb.drop = ref(dr, w + ', drop', { tag: false }); if (!nb.drop) nb.drop = nb.name; }
      else nb.drop = nb.name;
      m.blocks.push(nb);
    });
    // ── предметы ──
    items.forEach((it, i) => {
      if (!isObj(it) || !NAME_RE.test(it.id)) { err(`items[${i}]: нужен id (латиница, цифры, «-», «_»)`); return; }
      const w = `предмет «${it.id}»`;
      if (seen.has('i:' + it.id)) { err(`items: id «${it.id}» дважды`); return; } seen.add('i:' + it.id);
      if (ownB.has(it.id) && it.places === undefined) { err(`${w}: такое имя уже у блока (у блока предмет появляется сам)`); return; }
      const tx = texOne(str(it.texture, 32) || it.id, w, true); if (tx.endsWith(':__gray')) needGray = true;
      const ni = { name: id + ':' + it.id, title: str(it.name, 40) || it.id, tex: tx, stack: Math.min(64, num(it.stack, 99, 1, 999) | 0), fuel: num(it.fuel, 0, 0, 600), mod: id };
      if (it.places !== undefined) { const p = str(it.places, 32); if (!ownB.has(p)) { err(`${w}: places — блок этого мода`); return; } ni.place = id + ':' + p; }
      if (isObj(it.tool)) {
        const t = it.tool, kind = t.type === 'axe' ? 'axe' : t.type === 'shovel' ? 'shovel' : t.type === 'sword' ? 'sword' : 'pick';   // pickaxe, hammer → кирка
        const tier = Math.max(1, Math.min(4, num(t.tier, 1, 0, 6) | 0));
        ni.tool = { kind, tier, speed: Math.round(Math.max(1, Math.min(16, num(t.power, 40, 1, 300) / 10)) * 10) / 10, dur: num(t.durability, [0, 60, 130, 250, 1000, 1600][tier], 1, 100000) | 0, dmg: num(t.damage, 1 + tier, 0, 20) };
        ni.stack = 1;
      } else if (isObj(it.weapon)) {
        // урон «Подземья» (зомби — 45) → кубический мир (зомби — 20)
        ni.tool = { kind: 'sword', tier: 1, speed: 1.5, dur: num(it.weapon.durability, 250, 1, 100000) | 0, dmg: Math.max(1, Math.min(20, Math.round(num(it.weapon.damage, 10, 1, 300) * 20 / 45))) };
        ni.stack = 1;
      }
      if (it.heal !== undefined) ni.heal = Math.max(1, Math.min(20, Math.round(num(it.heal, 20, 1, 200) / 5)));   // здоровье 100 → 20
      if (isObj(it.food)) ni.food = { h: num(it.food.hunger, 2, 1, 20) | 0, sat: num(it.food.saturation, 1, 0, 20) };
      if (it.use) { ni.use = true; m.useItems.push(ni.name); }
      m.items.push(ni);
    });
    if (needGray) m.textures.__gray = { draw: GRAY };
    // ── рецепты: общий формат { result, count, ingredients: [[имя, n]…], station } + по форме pattern/key (кубический мир) ──
    const recipes = Array.isArray(j.recipes) ? j.recipes : [];
    if (j.recipes !== undefined && !Array.isArray(j.recipes)) err('recipes — список');
    if (recipes.length > LIM.recipes) err(`рецептов больше ${LIM.recipes}`);
    recipes.slice(0, LIM.recipes).forEach((r, i) => {
      const w = `рецепт №${i + 1}`;
      if (!isObj(r)) { err(`recipes[${i}] — объект`); return; }
      if (!r.result) { err(`recipes[${i}]: нет result`); return; }
      const out = ref(r.result, w + ', result', { tag: false }); if (!out) return;
      const n = Math.min(64, num(r.count, 1, 1, 999) | 0);
      const station = r.station == null || r.station === '' ? '' : ['workbench', 'furnace', 'anvil'].includes(r.station) ? r.station : (err(`recipes[${i}]: station — workbench, furnace, anvil или пусто`), null);
      if (station === null) return;
      // по форме
      if (Array.isArray(r.pattern)) {
        const P = r.pattern.slice(0, 3).map(s => String(s).slice(0, 3));
        if (!P.some(s => s.trim())) { err(`${w}: pattern — до 3 строк по 3 знака, пробел — пусто`); return; }
        const key = {}; let bad = false;
        for (const ch of new Set(P.join('').replace(/ /g, ''))) { const v = r.key && r.key[ch]; if (!v) { err(`${w}: в key нет «${ch}»`); bad = true; continue; } key[ch] = ref(v, w, { ing: true }); if (!key[ch]) bad = true; }
        if (!bad) m.recipes.push({ pattern: P, key, out, n, mirror: r.mirror !== false, table: P.length > 2 || P.some(s => s.length > 2) || station === 'workbench' || station === 'anvil' });
        return;
      }
      // ингредиенты: [["ruby", 1], ["torch", 2]] (общий формат) или ["ruby", "torch"]
      const src = Array.isArray(r.ingredients) ? r.ingredients : r.input ? [[r.input, 1]] : [];
      const ing = src.slice(0, 8).map(x => Array.isArray(x) ? [x[0], num(x[1], 1, 1, 999) | 0] : [x, 1]).filter(x => typeof x[0] === 'string');
      if (!ing.length) { err(`recipes[${i}]: ingredients — [["дерево", 2], …]`); return; }
      const names = ing.map(([k]) => ref(k, w, { ing: true }));
      if (names.some(x => !x)) return;
      if (station === 'furnace' || r.type === 'smelt') {
        if (ing.length > 1 || ing[0][1] > 1) warn(`${w}: в печи кубического мира — один предмет на входе (взят «${ing[0][0]}» × 1)`);
        if (names[0][0] === '#') { warn(`${w}: в печь — конкретный предмет, не группа`); return; }
        m.recipes.push({ smelt: true, input: names[0], out, n, time: num(r.time, 6, .5, 120) });
        return;
      }
      const list = []; ing.forEach(([, c], k) => { for (let q = 0; q < c; q++) list.push(names[k]); });
      if (list.length > 9) { warn(`${w}: больше 9 предметов — в сетку 3×3 не поместится, пропущен`); return; }
      m.recipes.push({ list, out, n, table: station === 'workbench' || station === 'anvil' || list.length > 4 });
    });
    // ── генерация: общий worldgen (ore / scatter, глубина в метрах) ──
    const wg = Array.isArray(j.worldgen) ? j.worldgen : [];
    if (j.worldgen !== undefined && !Array.isArray(j.worldgen)) err('worldgen — список');
    if (wg.length > LIM.worldgen) err(`worldgen больше ${LIM.worldgen}`);
    const biomesOf = (f, w) => { const b = Array.isArray(f.biomes) ? f.biomes.filter(x => V.BIOME_IDS.includes(x)) : []; if (Array.isArray(f.biomes) && b.length !== f.biomes.length) warn(`${w}: неизвестные биомы пропущены (есть: ${V.BIOME_IDS.join(', ')})`); return b; };
    const blockList = (list, def, w) => (Array.isArray(list) ? list : def).slice(0, 8).map(x => ref(x, w, { block: true, tag: false })).filter(Boolean);
    wg.slice(0, LIM.worldgen).forEach((f, i) => {
      if (!isObj(f)) return;
      const w = `worldgen[${i}]`, b = str(f.block, 32);
      if (!ownB.has(b)) { err(`${w}: block — блок этого мода`); return; }
      const minD = num(f.minDepth, 0, -300, 1e6), maxD = num(f.maxDepth, 1e6, minD, 1e7);
      const yTop = yOfDepth(minD), yBot = Math.min(yTop, yOfDepth(maxD)), biomes = biomesOf(f, w);
      if (f.type === 'ore') {
        let host = blockList(f.in, ['stone', 'deepstone'], w + ', in'); host = [...new Set(host)]; if (!host.length) host = ['stone'];
        m.features.push({ type: 'ore', block: id + ':' + b, minY: yBot, maxY: Math.max(yBot + 1, yTop), size: num(f.size, 6, 2, 24) | 0, perChunk: num(f.rarity, .5, .01, 1) * 8, replace: host, biomes });
      } else if (f.type === 'scatter') {
        const on = blockList(f.on, ['grass'], w + ', on'), chance = num(f.chance, .01, .0001, .5);
        if (minD <= 2) m.features.push({ type: 'scatter', block: id + ':' + b, on, chance, biomes });   // поверхность
        else m.features.push({ type: 'scatter', under: true, block: id + ':' + b, on, chance, minY: yBot, maxY: Math.max(yBot + 1, yTop), biomes });   // в пещерах
      } else err(`${w}: type — "ore" или "scatter"`);
    });
    // ── своё для кубического мира: features (руды по высоте y, россыпи, валуны, столбы, деревья — по биомам) ──
    const feats = Array.isArray(j.features) ? j.features : [];
    if (feats.length > LIM.features) err(`features больше ${LIM.features}`);
    feats.slice(0, LIM.features).forEach((f, i) => {
      const w = `features[${i}]`;
      if (!isObj(f) || !['ore', 'scatter', 'boulder', 'column', 'tree'].includes(f.type)) { err(`${w}: type — ore, scatter, boulder, column, tree`); return; }
      const bl = x => ref(x, w, { block: true, tag: false });
      const nf = { type: f.type, biomes: biomesOf(f, w), perChunk: num(f.perChunk, f.type === 'ore' ? 2 : 1, 0, f.type === 'ore' ? 32 : 8) };
      if (f.type === 'tree') {
        nf.log = bl(f.log); if (!nf.log) { err(`${w}: нет log`); return; }
        nf.leaves = f.leaves ? bl(f.leaves) : ''; nf.min = num(f.min, 4, 2, 12) | 0; nf.max = Math.max(nf.min, num(f.max, 6, 2, 16) | 0); nf.radius = num(f.radius, 2, 1, 3) | 0;
      } else { nf.block = bl(f.block); if (!nf.block) { err(`${w}: нет block`); return; } }
      if (f.type === 'ore') { nf.minY = num(f.minY, 5, 1, V.H - 2) | 0; nf.maxY = Math.max(nf.minY + 1, num(f.maxY, 64, 2, V.H - 1) | 0); nf.size = num(f.size, 6, 1, 32) | 0; nf.replace = blockList(f.replace || f.in, ['stone'], w); }
      if (f.type === 'scatter') { nf.on = blockList(f.on, ['grass'], w); nf.chance = num(f.chance, .01, 0, 1); }
      if (f.type === 'boulder') { nf.radius = num(f.radius, 2, 1, 4) | 0; nf.radiusVar = num(f.radiusVar, 1, 0, 3) | 0; }
      if (f.type === 'column') { nf.min = num(f.min, 2, 1, 16) | 0; nf.max = Math.max(nf.min, num(f.max, 5, 1, 24) | 0); if (f.top) nf.top = bl(f.top); }
      m.features.push(nf);
    });
    // ── скрипты ──
    const scripts = Array.isArray(j.scripts) ? j.scripts : [];
    if (j.scripts !== undefined && !Array.isArray(j.scripts)) err('scripts — список');
    if (scripts.length > LIM.scripts) err(`скриптов больше ${LIM.scripts}`);
    scripts.slice(0, LIM.scripts).forEach((s0, i) => {
      const s = typeof s0 === 'string' ? { file: s0 } : s0;
      if (!isObj(s)) return;
      let code = typeof s.code === 'string' ? s.code : null, nm = str(s.name, 60);
      if (code === null && typeof s.file === 'string') { const p = s.file.replace(/^\.\//, ''), f = files[p]; if (f == null) { err(`scripts[${i}]: нет файла ${s.file}`); return; } code = text(f); nm = nm || p; }
      if (code === null) { err(`scripts[${i}]: code или file`); return; }
      const lang = s.lang === 'lua' || (s.lang === undefined && /\.lua$/i.test(nm)) ? 'lua' : s.lang === 'js' || s.lang === undefined ? 'js' : null;
      if (!lang) { err(`scripts[${i}]: lang — "js" или "lua"`); return; }
      if (code.length > LIM.code) { err(`scripts[${i}]: больше ${LIM.code / 1000} КБ`); return; }
      m.scripts.push({ name: nm || `script${i + 1}.${lang}`, lang, code });
    });
    m.size = JSON.stringify(j).length + Object.values(files).reduce((a, f) => a + bytes(f), 0);
    if (m.size > LIM.zipBytes) err(`мод больше ${LIM.zipBytes / 1e6} МБ`);
    if (!m.blocks.length && !m.items.length && !m.recipes.length && !m.scripts.length && !m.features.length) warn('мод пустой: нет блоков, предметов, рецептов, генерации и скриптов');
    return { ok: !errors.length, errors, warnings, m: errors.length ? null : m };
  }

  // ═══ Zip (.d37mod): чтение (без сжатия и deflate) и запись (без сжатия) ═══
  async function inflate(src, max){
    if (typeof DecompressionStream === 'undefined') throw new Error('браузер не распаковывает .zip со сжатием — распакуй архив и выбери папку');
    const rd = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
    let len = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      len += value.length; if (len > max) { try { await rd.cancel(); } catch (e) {} throw new Error('файл в архиве больше, чем заявлено'); }
      parts.push(value);
    }
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  async function unzip(buf){
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('это не zip-архив');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true), total = 0;
    if (n > LIM.files) throw new Error(`в архиве больше ${LIM.files} файлов`);
    const td = new TextDecoder(), raw = {};
    for (let k = 0; k < n; k++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('битый архив');
      const flags = dv.getUint16(p + 8, true), meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/'); p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /^__MACOSX\//.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name)) continue;
      if (name.startsWith('/') || name.split('/').includes('..')) throw new Error('в архиве странный путь: ' + name);
      if (flags & 1) throw new Error('архив с паролем — сохрани без пароля');
      total += usz; if (usz > LIM.zipBytes || total > LIM.zipBytes) throw new Error(`архив больше ${LIM.zipBytes / 1e6} МБ`);
      if (lo + 30 > u8.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error('битый архив');
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), src = u8.subarray(ds, ds + csz);
      let data;
      if (meth === 0) data = src.slice();
      else if (meth === 8) data = await inflate(src, usz);
      else throw new Error('неизвестное сжатие в архиве: ' + name);
      if (data.length !== usz) throw new Error('битый архив: ' + name);
      raw[name] = data;
    }
    // общая папка верхнего уровня (mod/mod.json) — убрать
    const names = Object.keys(raw), first = names.length ? names[0].split('/')[0] : '';
    const top = names.length && names.every(k => k.includes('/') && k.split('/')[0] === first) ? first + '/' : '';
    const out = {};
    for (const k of names) out[top ? k.slice(top.length) : k] = raw[k];
    return out;
  }
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcT[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files){
    const te = new TextEncoder(), parts = [], cen = [], list = Object.entries(files), DATE = ((2026 - 1980) << 9) | (10 << 5) | 15;
    let off = 0;
    for (const [name, d0] of list) {
      const nm = te.encode(name), data = typeof d0 === 'string' ? te.encode(d0) : d0, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, DATE, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, DATE, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const cs = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, list.length, true); e.setUint16(10, list.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    const all = [...parts, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0));
    let o = 0; for (const x of all) { out.set(x, o); o += x.length; }
    return out;
  }

  // ═══ Реестр: вернуть ваниль и добавить моды мира ═══
  function reset(){
    V.blocks.length = VAN.blocks; V.byName.clear(); for (const b of V.blocks) V.byName.set(b.name, b);
    V.items.length = VAN.items; V.itemBy.clear(); for (const it of V.items) V.itemBy.set(it.name, it);
    V.recipes.length = VAN.recipes;
    V.smelting.clear(); for (const [k, v] of VAN.smelt) V.smelting.set(k, v);
    V.tex.length = VAN.tex; V.texIdx.clear(); V.tex.forEach((t, i) => V.texIdx.set(t.name, i));
    const tg = JSON.parse(VAN.tags); for (const k of Object.keys(V.TAGS)) delete V.TAGS[k]; Object.assign(V.TAGS, tg);
    V.compile(); V.iconsReset?.();
  }
  // m — проверенный мод (validate().m); rgba — { имя текстуры: Uint8Array 16×16×4 } (PNG уже разобраны браузером);
  // o.recipes === false — рецепты потом (recipes(m)), когда все моды мира добавили свои предметы → { skipped: [что не подключилось] }
  function register(m, rgba = {}, o = {}){
    const skipped = [];
    for (const [tn, t] of Object.entries(m.textures)) {
      let spec;
      if (t.draw) { spec = Object.assign({}, t.draw); if (typeof spec.base === 'string' && m.textures[spec.base]) spec.base = m.id + ':' + spec.base; }
      else spec = rgba[tn] ? { rgba: rgba[tn] } : Object.assign({}, GRAY);
      V.texture(m.id + ':' + tn, spec);
    }
    const from = V.blocks.length;
    for (const b of m.blocks) { if (V.blocks.length >= 4000) { skipped.push(b.name + ': слишком много блоков'); break; } V.defineBlock(Object.assign({}, b)); }
    V.blockItems(from);
    for (const it of m.items) V.defineItem(Object.assign({}, it));
    if (o.recipes !== false) skipped.push(...recipes(m));
    V.compile(); V.iconsReset?.();
    return { skipped };
  }
  // рецепты и печь мода; чего-то нет (мод, на котором он держится, не включён) — рецепт пропущен → [почему]
  function recipes(m){
    const skipped = [], has = n => !n || n[0] === '#' || !!V.item(n);
    for (const r of m.recipes) {
      const need = r.smelt ? [r.input, r.out] : [r.out, ...(r.list || Object.values(r.key || {}))];
      const miss = need.filter(n => !has(n));
      if (miss.length) { skipped.push(`рецепт «${r.out}»: нет ${miss.join(', ')}`); continue; }
      if (r.smelt) V.addSmelt(r.input, r.out, r.time, r.n); else V.addRecipe(Object.assign({ mod: m.id }, r));
    }
    return skipped;
  }
  // генерация: имена → номера блоков (в поток уходят только числа)
  function features(list){
    const id = n => { const b = n && V.block(n); return b ? b.id : 0; };
    return list.map(f => { const o = Object.assign({}, f); for (const k of ['block', 'log', 'leaves', 'top']) if (k in o) o[k] = id(o[k]); if (o.replace) o.replace = o.replace.map(id).filter(Boolean); if (o.on) o.on = o.on.map(id).filter(Boolean); return o; })
      .filter(f => f.block > 0 || f.log > 0);
  }

  // ═══ Песочница одного мода: iframe sandbox="allow-scripts" (своё «пустое» происхождение: ни куки, ни базы сайта) + CSP без
  // сети (fetch, картинки, WebSocket — запрещены) → поток. Поток должен ответить на «пинг» с номером за 3 с, иначе убит:
  // зависший цикл не может прочитать новый номер, а таймеры фоновой вкладки (раз в минуту) ложной «зависки» не дают. ═══
  function frameHtml(){
    const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
let w = null, dead = false, nonce = 0, sent = 0;
const up = m => parent.postMessage(m, '*');
addEventListener('message', e => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.t === 'boot') {
    if (w) return;
    try { w = new Worker(URL.createObjectURL(new Blob(['(' + d.code + ')()'], { type: 'text/javascript' }))); }
    catch (er) { up({ t: 'error', where: '', line: 0, msg: 'Не удалось запустить скрипты: ' + er.message, init: true }); return; }
    w.onmessage = ev => { const m = ev.data; if (m && m.t === 'pong') { if (m.n === nonce) sent = 0; return; } up(m); };
    w.onerror = ev => { up({ t: 'error', where: '', line: ev.lineno || 0, msg: ev.message || 'ошибка' }); ev.preventDefault(); };
    setInterval(() => {
      if (dead) return;
      const t = Date.now();
      if (sent && t - sent > 3000) { dead = true; w.terminate(); up({ t: 'hang' }); return; }
      if (!sent) { sent = t; nonce = Math.random(); w.postMessage({ t: 'ping', n: nonce }); }
    }, 500);
    return;
  }
  if (w && !dead) w.postMessage(d);
});
up({ t: 'frame' });
<\/script>`;
  }
  function iframeBox(onMsg){
    const fr = document.createElement('iframe');
    fr.setAttribute('sandbox', 'allow-scripts'); fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1; fr.title = 'мод';
    fr.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    const h = e => { if (e.source === fr.contentWindow) onMsg(e.data || {}); };
    window.addEventListener('message', h);
    fr.srcdoc = frameHtml();
    document.body.appendChild(fr);
    return { post: m => { try { fr.contentWindow?.postMessage(m, '*'); } catch (e) {} }, close: () => { window.removeEventListener('message', h); fr.remove(); } };
  }

  // ═══ То, что работает в потоке песочницы (уходит текстом, снаружи ничего не видит). API 1 — как у «Подземья», в 3D ═══
  function modRuntime(){
    'use strict';
    const EVS = ['tileBreak', 'tilePlace', 'use', 'tick', 'mobKill', 'pickup', 'talk', 'start', 'stepOn', 'chat'];
    const ALIAS = { blockBreak: 'tileBreak', blockPlace: 'tilePlace', playerJoin: 'start' };
    for (const e of EVS) ALIAS['on' + e[0].toUpperCase() + e.slice(1)] = e;
    const send = m => postMessage(m);
    const H = Object.create(null), CMDS = Object.create(null), pend = new Map();
    let MOD = '', NAMES = new Set(), CUR = '', INIT = false, VIEW = null, ST = { time: .5, hours: 12, night: false, day: 1, p: null }, queue = [], budget = 0, LIMIT = 400, reqN = 0, LINE0 = 0, store = {};
    const lineOf = st => { st = String(st || ''); const m = /<anonymous>:(\d+):\d+/.exec(st) || /> Function:(\d+):\d+/.exec(st); return m ? Math.max(0, +m[1] - LINE0) : 0; };
    const fail = (where, e) => send({ t: 'error', where: String(where || CUR || ''), line: lineOf(e && e.stack), msg: String((e && e.message) || e).slice(0, 300), init: INIT });
    // «ruby» → «мод:ruby», если у мода такое есть; игры и полные имена — как есть
    const full = n => { n = String(n == null ? '' : n).trim(); if (!n || n.includes(':') || n[0] === '#') return n; return NAMES.has(MOD + ':' + n) ? MOD + ':' + n : n; };
    const fin = v => typeof v === 'number' && isFinite(v);
    const flr = Math.floor, P = () => ST.p || {};
    // действие → очередь игре (не больше LIMIT за событие)
    function act(c){
      if (++budget > LIMIT) { if (budget === LIMIT + 1) fail(CUR, new Error('слишком много действий за одно событие (больше ' + LIMIT + ')')); return false; }
      if (queue.length < 800) queue.push(c);
      return true;
    }
    function flush(){ if (queue.length) { send({ t: 'cmds', list: queue }); queue = []; } }
    setInterval(flush, 100);   // действия из таймеров и после await
    const inView = (x, y, z) => VIEW && x >= VIEW.x0 && y >= VIEW.y0 && z >= VIEW.z0 && x < VIEW.x0 + VIEW.w && y < VIEW.y0 + VIEW.h && z < VIEW.z0 + VIEW.d;
    const vi = (x, y, z) => ((x - VIEW.x0) * VIEW.h + (y - VIEW.y0)) * VIEW.d + (z - VIEW.z0);
    const vidx = new Map();
    const at = (x, y, z) => { if (!fin(x) || !fin(y) || !fin(z)) return null; x = flr(x); y = flr(y); z = flr(z); if (!inView(x, y, z)) return null; const v = VIEW.names[VIEW.ids[vi(x, y, z)]]; return v == null ? null : v; };
    const mod = Object.freeze({
      api: 1,
      get id(){ return MOD; },
      // mod.on(событие, функция) — как у всех; mod.on(событие, «на что», функция) — фильтр по блоку/предмету (кубический мир)
      on(ev, a, b){
        ev = ALIAS[ev] || ev;
        const fn = typeof a === 'function' ? a : b, filter = typeof a === 'function' ? null : a;
        if (!EVS.includes(ev)) throw new Error('нет события «' + ev + '» (есть: ' + EVS.join(', ') + ')');
        if (typeof fn !== 'function') throw new Error('mod.on: нужна функция');
        const list = filter == null ? null : [].concat(filter).map(full).filter(Boolean).slice(0, 64);
        if (ev === 'stepOn' && !(list && list.length)) throw new Error('mod.on("stepOn", …): укажи блок — mod.on("stepOn", "мой_блок", функция)');
        (H[ev] || (H[ev] = [])).push({ fn, filter: list, src: CUR });
        send({ t: 'want', ev, filter: list });
      },
      log(...a){ send({ t: 'log', text: a.map(x => { if (typeof x === 'string') return x; try { return typeof x === 'object' ? JSON.stringify(x) : String(x); } catch (e) { return String(x); } }).join(' ').slice(0, 300) }); },
      // своё для кубического мира: команда, хранилище в мире, ожидание
      command(name, fn){ commands.add(name, '', fn); },
      wait(s){ return new Promise(r => setTimeout(r, Math.max(0, +s || 0) * 1000)); },
      storage: Object.freeze({
        get(k){ return store[String(k)]; },
        set(k, v){
          k = String(k); const old = store[k]; store[k] = v; let s;
          try { s = JSON.stringify(store); } catch (e) { store[k] = old; throw new Error('mod.storage: такое не сохранить (только числа, строки, списки и объекты)'); }
          if (s.length > 65536) { store[k] = old; throw new Error('mod.storage: больше 64 КБ'); }
          if (queue.length < 800) queue.push({ c: 'store', s });
        },
        remove(k){ delete store[String(k)]; if (queue.length < 800) queue.push({ c: 'store', s: JSON.stringify(store) }); },
      }),
    });
    const world = Object.freeze({
      get(x, y, z){ return at(x, y, z); },
      wall(){ return null; },   // стен (фона) в кубическом мире нет
      liquid(x, y, z){ const n = at(x, y, z); return n === 'water' || n === 'lava' ? n : null; },
      set(x, y, z, name){
        if (!fin(x) || !fin(y) || !fin(z)) throw new Error('world.set(x, y, z, "блок"): координаты — числа');
        if (typeof name !== 'string' || !name) throw new Error('world.set: имя блока — строка, например "stone"');
        x = flr(x); y = flr(y); z = flr(z); name = full(name);
        if (inView(x, y, z)) { let k = vidx.get(name); if (k === undefined) { k = VIEW.names.length; VIEW.names.push(name); vidx.set(name, k); } VIEW.ids[vi(x, y, z)] = k; }
        return act({ c: 'set', x, y, z, b: name });
      },
      setWall(){ return false; },
      isNight(){ return !!ST.night; },
      time(){ return ST.time; },
      day(){ return ST.day; },
      view(){ return VIEW ? { x0: VIEW.x0, y0: VIEW.y0, z0: VIEW.z0, w: VIEW.w, h: VIEW.h, d: VIEW.d } : null; },
      // своё для кубического мира
      hours(){ return ST.hours; },
      read(x, y, z){
        if (!fin(x) || !fin(y) || !fin(z) || pend.size > 200) return Promise.resolve(null);
        const id = ++reqN; send({ t: 'read', id, x: flr(x), y: flr(y), z: flr(z) });
        return new Promise(res => { pend.set(id, res); setTimeout(() => { if (pend.has(id)) { pend.delete(id); res(null); } }, 2000); });
      },
    });
    // fx.particles(x, y, z, вид, сколько, "#цвет"); вызов как в 2D — (x, y, вид, …) — на глубине игрока
    const fx = Object.freeze({
      particles(x, y, z, kind, n, color){ if (typeof z === 'string') { color = n; n = kind; kind = z; z = P().z; } return act({ c: 'fx', x: +x, y: +y, z: +z, k: String(kind || 'spark').slice(0, 16), n: Math.max(1, Math.min(60, (n | 0) || 10)), color: typeof color === 'string' ? color.slice(0, 7) : '' }); },
      sound(name, vol){ return act({ c: 'snd', n: String(name).slice(0, 24), vol: +vol || 1 }); },
      text(x, y, z, t, color){ if (typeof z === 'string') { color = t; t = z; z = P().z; } return act({ c: 'text', x: +x, y: +y, z: +z, t: String(t).slice(0, 60), color: typeof color === 'string' ? color.slice(0, 7) : '' }); },
      shake(power){ return act({ c: 'shake', s: Math.max(0, Math.min(1, +power || .3)) }); },
    });
    const npc = Object.freeze({
      say(t){ return act({ c: 'say', t: String(t).slice(0, 200) }); },
      addLine(t){ return act({ c: 'line', t: String(t).slice(0, 200) }); },
    });
    const commands = Object.freeze({
      add(name, desc, fn){
        if (typeof desc === 'function') { fn = desc; desc = ''; }
        name = String(name).toLowerCase().replace(/^\//, '');
        if (!/^[a-zа-яё0-9_-]{1,20}$/.test(name)) throw new Error('commands.add: имя команды — буквы и цифры, до 20');
        if (typeof fn !== 'function') throw new Error('commands.add: третьим нужна функция');
        CMDS[name] = { fn, src: CUR }; send({ t: 'cmdAdd', name, desc: String(desc || '').slice(0, 80) });
      },
    });
    const player = Object.freeze({
      get x(){ return P().x || 0; }, get y(){ return P().y || 0; }, get z(){ return P().z || 0; },
      get hp(){ return P().hp == null ? 20 : P().hp; }, get maxHp(){ return 20; },
      give(item, n){ return act({ c: 'give', i: full(item).slice(0, 70), n: Math.max(1, Math.min(999, (n | 0) || 1)) }); },
      heal(n){ return act({ c: 'heal', n: Math.max(1, Math.min(10, (+n) || 1)) }); },
      message(t){ return act({ c: 'msg', t: String(t).slice(0, 120) }); },
      // своё для кубического мира
      get health(){ return P().hp == null ? 20 : P().hp; }, get food(){ return P().food == null ? 20 : P().food; },
      get name(){ return P().name || 'Игрок'; }, get mode(){ return P().mode || 'survival'; }, get item(){ return P().item || ''; }, get sneaking(){ return !!P().sneak; },
      hurt(n){ return act({ c: 'hurt', n: +n || 0 }); },
      launch(vx, vy, vz){ return act({ c: 'launch', v: [+vx || 0, +vy || 0, +vz || 0] }); },
      teleport(x, y, z){ return act({ c: 'tp', v: [+x, +y, +z] }); },
    });
    const game = Object.freeze({
      get time(){ return ST.time; }, get night(){ return !!ST.night; }, get day(){ return ST.day; },
      spawn(mob, x, y, z){ if (z === undefined) z = P().z; return act({ c: 'spawn', k: String(mob).slice(0, 20), x: +x, y: +y, z: +z }); },
    });
    const print = (...a) => mod.log(...a);
    const API = Object.freeze({ mod, world, fx, npc, commands, player, game });
    function begin(d){
      budget = 0;
      if (d.view) { VIEW = d.view; vidx.clear(); VIEW.names.forEach((n, i) => { if (n != null && !vidx.has(n)) vidx.set(n, i); }); }
      if (d.st) ST = d.st;
    }
    function call(h, args){
      const t0 = Date.now(); CUR = h.src;
      try { const r = h.fn(...args); if (r && typeof r.then === 'function') r.then(null, e => fail(h.src, e)); } catch (e) { fail(h.src, e); }
      const ms = Date.now() - t0;
      if (ms > 250) send({ t: 'slow', where: h.src, ms });
    }
    onmessage = e => {
      const d = e.data || {};
      if (d.t === 'ping') { postMessage({ t: 'pong', n: d.n }); return; }
      if (d.t === 'init') {
        if (MOD) return;
        MOD = String(d.mod || ''); NAMES = new Set(d.names || []); LIMIT = d.limit || 400;
        store = d.store && typeof d.store === 'object' ? d.store : {};
        // номер строки: new Function добавляет строки заголовка (и "use strict") — узнаём, сколько
        try { new Function('throw new Error("x")')(); } catch (e2) { const m = /<anonymous>:(\d+):\d+/.exec(e2.stack || '') || /> Function:(\d+):\d+/.exec(e2.stack || ''); LINE0 = m ? +m[1] : 0; }
        INIT = true;
        if (d.lua) { try { (0, eval)(String(d.lua)); } catch (e5) { fail('Lua', e5); } }
        for (const s of d.scripts || []) {
          CUR = s.name; budget = 0;
          if (s.lang === 'lua') {
            const L = self.D37Lang && self.D37Lang.lua;
            if (!L) { fail(s.name, new Error('Lua не загрузился — обнови страницу')); continue; }
            // те же объекты, что у JS; строка 1 — объявления (номера строк не сдвигаются) — как у «Подземья»
            const pre = 'local mod, world, fx, npc, commands, player, game = script.mod, script.world, script.fx, script.npc, script.commands, script.player, script.game; ';
            try { L.run(pre + String(s.code), { script: API, print, warn: (...a) => mod.log('⚠', ...a) }, { name: s.name, error: (msg, line) => send({ t: 'error', where: s.name, line: line | 0, msg: String(msg).slice(0, 300), init: INIT }), err: e4 => fail(s.name, e4), setCurrent(){} }); } catch (e4) { fail(s.name, e4); }
            continue;
          }
          try { new Function('mod', 'world', 'fx', 'npc', 'commands', 'player', 'game', 'print', 'log', '"use strict";\n' + String(s.code))(mod, world, fx, npc, commands, player, game, print, print); } catch (e4) { fail(s.name, e4); }
        }
        INIT = false; CUR = '';
        flush(); send({ t: 'ready' });
        return;
      }
      if (d.t === 'ev') {
        begin(d);
        const data = Object.freeze(Object.assign({ type: d.ev }, d.data || {}, { player }));
        for (const h of H[d.ev] || []) { if (h.filter && !h.filter.includes(data.tile) && !h.filter.includes(data.item)) continue; call(h, [data]); }
        flush(); return;
      }
      if (d.t === 'cmd') { const h = CMDS[d.name]; if (h) { begin(d); call(h, [Array.isArray(d.args) ? d.args : [], player]); flush(); } return; }
      if (d.t === 'read') { const r = pend.get(d.id); if (r) { pend.delete(d.id); r(d.v == null ? null : d.v); } return; }
    };
  }

  // ═══ Хозяин песочниц в игре: события → потоки, действия потоков → проверка → мир ═══
  // st — сессия игры (kubomir.js): W, R.lighting, meta, creative; loaded — [{ m }]; hooks — действия игры (player, give, launch…);
  // o.box(onMsg) → { post, close } — своя песочница (тест в node), по умолчанию — iframe; o.now — часы (тест)
  const PART = { spark: 'spark', magic: 'magic', fire: 'fire', smoke: 'smoke', dust: 'smoke', heart: 'heart', water: 'water', star: 'spark' };
  // звуки общего списка (как у «Подземья») → звуки кубического мира
  const SND = { coin: 'coin', pickup: 'kb_pop', hit: 'hit', break: 'break', click: 'click', jump: 'jump', land: 'land', buzz: 'buzz', door_wood_open: 'door_wood_open', door_wood_close: 'door_wood_close',
    build_wood: 'build_wood', build_metal: 'build_metal', dig: 'kb_dig_dirt', digstone: 'kb_dig_stone', place: 'kb_place', swing: 'hit', magic: 'coin', roar: 'kb_groan', shoot: 'click', splash: 'kb_squish',
    squish: 'kb_squish', craft: 'build_wood', levelup: 'coin', drink: 'kb_eat' };
  const MOB_ALIAS = { blueslime: 'slime', purpleslime: 'slime' };
  function runner(st, loaded, hooks = {}, o = {}){
    const box = o.box || iframeBox, clock = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const R = { mods: [], cmds: new Map(), cmdDesc: new Map(), uses: new Set(), useItems: new Map(), steps: new Set(), dead: false, logs: [], lines: [] };
    const NAMES = [...new Set([...V.blocks.map(b => b.name), ...V.items.map(i => i.name)])];
    const log = (M, t, bad) => { R.logs.push({ mod: M.m.id, t: String(t).slice(0, 300), bad: !!bad, at: Date.now() }); if (R.logs.length > 300) R.logs.shift(); };
    const off = (M, why) => {
      if (M.off) return;
      M.off = why; try { M.box?.close(); } catch (e) {} M.box = null;
      log(M, '⛔ выключен: ' + why, true);
      hooks.toast?.(`🧩 Мод «${M.m.name}» выключен: ${why}`, false);
      for (const [k, v] of [...R.cmds]) if (v === M) R.cmds.delete(k);
    };
    const near = (x, y, z, Pp, r = 64) => !!Pp && Math.abs(x - Pp.x) <= r && Math.abs(z - Pp.z) <= r && Math.abs(y - Pp.y) <= r + 32 && y >= 0 && y < V.H;
    const nick = () => { try { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.nick) || 'Игрок'; } catch (e) { return 'Игрок'; } };
    // «окно» мира: имена блоков вокруг (x, y, z) — скрипт читает world.get без ожидания
    function view(x, y, z, rw, rh){
      const w = rw * 2 + 1, h = rh * 2 + 1, d = w, x0 = Math.floor(x) - rw, y0 = Math.max(0, Math.floor(y) - rh), z0 = Math.floor(z) - rw;
      const ids = new Uint16Array(w * h * d), names = [], idx = new Map();
      let i = 0;
      for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) for (let c = 0; c < d; c++) {
        const t = st.W.get(x0 + a, y0 + b, z0 + c), nm = t < 0 ? null : V.blocks[t]?.name ?? null;
        let k = idx.get(nm); if (k === undefined) { k = names.length; names.push(nm); idx.set(nm, k); }
        ids[i++] = k;
      }
      return { x0, y0, z0, w, h, d, ids, names };
    }
    function state(){
      const Pp = hooks.player?.(), sel = Pp?.inv?.[Pp.sel], hrs = +(st.R?.lighting?.time ?? 12);
      return { time: +(hrs / 24).toFixed(4), hours: +hrs.toFixed(3), night: hrs < 5.6 || hrs > 18.8, day: st.meta?.day || 1,
        p: Pp ? { x: +Pp.x.toFixed(2), y: +Pp.y.toFixed(2), z: +Pp.z.toFixed(2), hp: Pp.hp, food: Pp.food, name: nick(), mode: st.creative ? 'creative' : 'survival', item: sel?.id || '', sneak: !!Pp.sneak } : null };
    }
    const tileItems = t => !t ? [] : Array.isArray(t.items) ? t.items : [t.in, t.fuel, t.out];
    const fixed = t => { const b = V.blocks[t]; return !!b && (!!b.ui || b.shape === V.SHAPE.door); };   // станки, сундуки, двери — не трогать
    // действие из песочницы — проверка и применение
    function apply(M, c){
      if (!c || typeof c !== 'object' || M.off || R.dead) return;
      const Pp = hooks.player?.(), now = clock(), Q = M.rate;
      if (now - Q.t >= 1000) { Q.t = now; Q.n = 0; Q.msg = 0; Q.give *= .9; Q.spawn *= .9; Q.fx = 0; }
      if (c.c !== 'store' && ++Q.n > LIM.perSec) { if (Q.n === LIM.perSec + 1) log(M, `больше ${LIM.perSec} действий в секунду — лишние пропущены`, true); return; }
      try {
        switch (c.c) {
          case 'set': {
            const b = c.b === 'air' ? V.blocks[0] : V.block(String(c.b)); if (!b) { log(M, `world.set: нет блока «${c.b}»`, true); return; }
            if (![c.x, c.y, c.z].every(Number.isInteger) || !near(c.x, c.y, c.z, Pp) || !st.W.loaded(c.x, c.z)) return;
            const was = st.W.get(c.x, c.y, c.z);
            if (was === b.id || was < 0) return;
            if (fixed(was) || fixed(b.id)) return;
            st.W.set(c.x, c.y, c.z, b.id, { urgent: 2, mod: M.m.id });
            return;
          }
          case 'give': {
            const name = String(c.i), alias = ALIAS[name];
            const key = V.item(name) && (name.startsWith(M.m.id + ':') || GIVE_OK.has(name)) ? name : alias && GIVE_OK.has(alias) ? alias : null;
            if (!key) { log(M, `player.give: можно давать только предметы своего мода и простые (${[...GIVE_OK].slice(0, 8).join(', ')}…)`, true); return; }
            const n = Math.max(1, Math.min(999, c.n | 0)); if ((Q.give += n) > 2000) return;
            hooks.give?.({ id: key, n });
            return;
          }
          case 'heal': if (Number.isFinite(c.n) && (Q.healAt ?? -1e9) + 500 < now) { Q.healAt = now; hooks.heal?.(Math.max(0, Math.min(10, c.n))); } return;
          case 'msg': if (Q.msg++ < 2) hooks.log?.(`🧩 ${String(c.t).slice(0, 120)}`); return;
          case 'fx': { if (++Q.fx > 40 || ![c.x, c.y, c.z].every(Number.isFinite) || !near(c.x, c.y, c.z, Pp, 80)) return; hooks.particles?.(PART[c.k] || 'spark', c.x, c.y, c.z, Math.max(1, Math.min(60, c.n | 0)), COLOR_RE.test(c.color || '') ? c.color : ''); return; }
          case 'snd': { const s = SND[c.n] || (/^kb_[a-z_]+$/.test(String(c.n)) ? c.n : null); if (s && Pp) hooks.sound?.(s, Pp.x, Pp.y + 1, Pp.z, Math.max(0, Math.min(1, +c.vol || 1))); return; }
          case 'text': if ([c.x, c.y, c.z].every(Number.isFinite) && near(c.x, c.y, c.z, Pp, 80)) hooks.text?.(c.x, c.y, c.z, String(c.t).slice(0, 60), COLOR_RE.test(c.color || '') ? c.color : ''); return;
          case 'shake': hooks.shake?.(Math.max(0, Math.min(1, +c.s || 0))); return;
          case 'say': if (now - (Q.sayAt ?? -1e9) > 1500) { Q.sayAt = now; hooks.log?.(`🗣 ${String(c.t).slice(0, 200)}`); } return;
          case 'line': if ((M.lines = (M.lines || 0) + 1) <= 20) R.lines.push(String(c.t).slice(0, 200)); return;
          case 'hurt': if (Number.isFinite(c.n) && c.n > 0) hooks.hurt?.(Math.min(20, c.n)); return;
          case 'launch': { const v = Array.isArray(c.v) ? c.v : []; if (v.length === 3 && v.every(Number.isFinite)) hooks.launch?.(Math.max(-30, Math.min(30, v[0])), Math.max(-30, Math.min(30, v[1])), Math.max(-30, Math.min(30, v[2]))); return; }
          case 'tp': { const v = Array.isArray(c.v) ? c.v : []; if (v.length === 3 && v.every(Number.isFinite) && Pp && Math.hypot(v[0] - Pp.x, v[2] - Pp.z) <= 128 && st.W.loaded(v[0], v[2])) hooks.teleport?.(v[0], Math.max(1, Math.min(V.H + 10, v[1])), v[2]); return; }
          case 'spawn': {
            const k = MOB_ALIAS[c.k] || String(c.k);
            if (Q.spawn > 6 || ![c.x, c.y, c.z].every(Number.isFinite) || !near(c.x, c.y, c.z, Pp, 50)) return;
            Q.spawn++; hooks.spawn?.(k, c.x, c.y, c.z); return;
          }
          case 'store': if (typeof c.s === 'string' && c.s.length <= 65536) M.store = c.s; return;
        }
      } catch (e) { log(M, 'действие: ' + (e.message || e), true); }
    }
    function onMsg(M, d){
      if (M.off || R.dead || !d || typeof d !== 'object') return;
      const t = d.t;
      if (t === 'frame') {
        if (M.booted) return;
        M.booted = true;
        const L = M.m.scripts.some(s => s.lang === 'lua') && root.D37E?.langs?.lua?.worker;
        let store = {}; try { store = JSON.parse(st.meta?.modData?.[M.m.id] || '{}') || {}; } catch (e) {}
        M.box.post({ t: 'boot', code: modRuntime.toString() });
        M.box.post({ t: 'init', mod: M.m.id, scripts: M.m.scripts, lua: L ? '(' + L.toString() + ')();' : '', store, names: NAMES, limit: LIM.perEvent });
        return;
      }
      if (t === 'ready') { M.ready = true; post(M, { t: 'ev', ev: 'start', data: {}, st: state() }); return; }
      if (t === 'want') {
        const ev = String(d.ev || ''); if (!EVENTS.includes(ev)) return;
        const f = Array.isArray(d.filter) ? d.filter.slice(0, 64).map(String) : null;
        M.want[ev] = true;
        if (ev === 'use') { if (f) for (const n of f) { if (R.uses.size < 512) R.uses.add(n); } for (const n of M.m.useItems) R.useItems.set(n, M); }
        if (ev === 'stepOn' && f) for (const n of f) if (R.steps.size < 512) R.steps.add(n);
        return;
      }
      if (t === 'cmdAdd') { const n = String(d.name || '').toLowerCase(); if (/^[a-zа-яё0-9_-]{1,20}$/.test(n) && !R.cmds.has(n) && R.cmds.size < 40) { R.cmds.set(n, M); R.cmdDesc.set(n, String(d.desc || '').slice(0, 80)); } return; }
      if (t === 'cmds') { for (const c of Array.isArray(d.list) ? d.list.slice(0, 800) : []) apply(M, c); return; }
      if (t === 'log') { const s = String(d.text || '').slice(0, 300); log(M, s); const now = clock(); if (now - M.logT >= 1000) { M.logT = now; M.logN = 0; } if (++M.logN <= 3) hooks.log?.(`🧩 ${M.m.name}: ${s}`); return; }
      if (t === 'read') {
        const now = clock(); if (now - M.readT >= 1000) { M.readT = now; M.readN = 0; } if (++M.readN > 200) return;
        const ok = [d.x, d.y, d.z].every(Number.isInteger), v = ok ? st.W.get(d.x, d.y, d.z) : -1;
        M.box?.post({ t: 'read', id: d.id, v: v < 0 ? null : V.blocks[v]?.name ?? null });
        return;
      }
      if (t === 'error') {
        M.errors++;
        const where = `${String(d.where || 'скрипт').slice(0, 60)}${d.line ? ', строка ' + (d.line | 0) : ''}`, msg = String(d.msg || 'ошибка').slice(0, 300);
        log(M, `❌ ${where}: ${msg}`, true);
        if (d.init) { off(M, `ошибка при запуске (${where}): ${msg.slice(0, 120)}`); return; }
        if (M.errors === 1) hooks.toast?.(`🧩 ${M.m.name}: ошибка (${where}) — ${msg.slice(0, 90)}`, false);
        if (M.errors >= 5) off(M, '5 ошибок в скриптах');
        return;
      }
      if (t === 'slow') { M.slow++; log(M, `${String(d.where || '')}: обработчик работал ${d.ms | 0} мс — это тормозит игру`, true); if (M.slow >= 5) off(M, 'обработчики тормозят игру'); return; }
      if (t === 'hang') { off(M, 'завис (не отвечал 3 с — бесконечный цикл?)'); return; }
    }
    const post = (M, m) => { if (!M.off && M.ready && M.box) M.box.post(m); };
    for (const L of loaded) {
      const M = { m: L.m, box: null, booted: false, ready: false, want: {}, errors: 0, slow: 0, off: null, store: null, rate: { t: -1e9, n: 0, msg: 0, give: 0, spawn: 0, fx: 0 }, logT: -1e9, logN: 0, readT: -1e9, readN: 0 };
      R.mods.push(M);
      if (!L.m.scripts.length) continue;
      try { M.box = box(d => onMsg(M, d)); } catch (e) { off(M, 'песочница не запустилась: ' + (e.message || e)); }
    }
    const wants = (M, ev) => !M.off && M.ready && M.want[ev];
    const EV_ALIAS = { blockBreak: 'tileBreak', blockPlace: 'tilePlace', playerJoin: 'start' };
    // событие игры → моды; tileBreak / tilePlace / use / stepOn — с окном мира 17×17×17 вокруг
    R.event = (ev0, data = {}) => {
      const ev = EV_ALIAS[ev0] || ev0;
      if (R.dead || !R.mods.some(M => wants(M, ev))) return;
      const dd = Object.assign({}, data);
      if (dd.block !== undefined && dd.tile === undefined) dd.tile = dd.block;
      if (dd.tile !== undefined && dd.block === undefined) dd.block = dd.tile;
      const v = Number.isFinite(dd.x) && Number.isFinite(dd.z) ? view(dd.x, dd.y, dd.z, 8, 8) : null, s = state();
      if (ev === 'use') {   // предмет мода с use: true — только своему моду; блок/предмет из фильтра mod.on — всем, кто просил
        const own = R.useItems.get(dd.item);
        for (const M of R.mods) if (wants(M, 'use') && (M === own || R.uses.has(dd.tile) || R.uses.has(dd.item))) post(M, { t: 'ev', ev, data: dd, view: v, st: s });
        return;
      }
      for (const M of R.mods) if (wants(M, ev)) post(M, { t: 'ev', ev, data: dd, view: v, st: s });
    };
    R.hasUse = name => !!name && (R.uses.has(name) || R.useItems.has(name));
    const stepT = new Map();
    R.stepOn = (types, Pp) => {
      if (R.dead || !R.steps.size) return;
      const now = clock();
      for (const t of types) {
        const nm = V.blocks[t]?.name; if (!nm || !R.steps.has(nm) || now - (stepT.get(nm) ?? -1e9) < 300) continue;
        stepT.set(nm, now);
        R.event('stepOn', { x: Math.floor(Pp.x), y: Math.floor(Pp.y - .05), z: Math.floor(Pp.z), tile: nm });
      }
    };
    // tick — дважды в секунду (как у «Подземья»), окно 25×17×25 вокруг игрока
    let tickAcc = 0;
    R.tick = dt => {
      if (R.dead) return;
      tickAcc += dt; if (tickAcc < .5) return;
      tickAcc = 0;
      if (!R.mods.some(M => wants(M, 'tick'))) return;
      const Pp = hooks.player?.(), v = Pp ? view(Pp.x, Pp.y, Pp.z, 12, 8) : null, s = state();
      for (const M of R.mods) if (wants(M, 'tick')) post(M, { t: 'ev', ev: 'tick', data: { dt: .5 }, view: v, st: s });
    };
    R.second = () => {};
    R.commands = () => [...R.cmds.keys()];
    R.commandInfo = () => [...R.cmds.keys()].map(n => ({ name: n, desc: R.cmdDesc.get(n) || '', mod: R.cmds.get(n).m.name }));
    R.command = (name, args = []) => {
      const n = String(name).toLowerCase(), M = R.cmds.get(n); if (!M || M.off) return false;
      const Pp = hooks.player?.();
      post(M, { t: 'cmd', name: n, args: args.slice(0, 16).map(a => String(a).slice(0, 64)), view: Pp ? view(Pp.x, Pp.y, Pp.z, 12, 8) : null, st: state() });
      return true;
    };
    R.data = () => { const out = Object.assign({}, st.meta?.modData || {}); for (const M of R.mods) if (M.store != null) out[M.m.id] = M.store; return out; };
    R.status = () => R.mods.map(M => ({ id: M.m.id, name: M.m.name, version: M.m.version, scripts: M.m.scripts.length, errors: M.errors, off: M.off, ready: M.ready || !M.m.scripts.length }));
    R.stop = () => { R.dead = true; for (const M of R.mods) { try { M.box?.close(); } catch (e) {} M.box = null; } };
    return R;
  }

  // ═══ Примеры (они же — в docs/MODS.md §7 и в окне «🧩 Моды» → «📦 Примеры») ═══
  const EXAMPLES = [
    { manifest: {
      id: 'rubies', name: 'Рубины', version: '1.0.0', game: 'voxel', api: 1, author: 'Денчик37',
      description: 'Рубиновая руда глубоко под землёй, рубиновая кирка и меч, блок из рубинов. Найденные рубины считает команда /rubies.',
      textures: {
        ruby_ore: { draw: { pattern: 'ore', base: '#7d7d80', color2: '#e0115f', color3: '#ff8fb5' } }, ruby: { draw: { pattern: 'gem', base: '#e0115f' } },
        ruby_block: { draw: { pattern: 'crystal', base: '#c8104f', color2: '#ff5c95' } }, ruby_pick: { draw: { pattern: 'pick', base: '#e0115f' } }, ruby_sword: { draw: { pattern: 'sword', base: '#e0115f' } },
      },
      blocks: [
        { id: 'ruby_ore', name: 'Рубиновая руда', texture: 'ruby_ore', hardness: 200, tier: 3, drop: 'ruby' },
        { id: 'ruby_block', name: 'Рубиновый блок', texture: 'ruby_block', hardness: 330, tier: 2, light: '#401020', sound: 'metal' },
      ],
      items: [
        { id: 'ruby', name: 'Рубин', texture: 'ruby' },
        { id: 'ruby_pick', name: 'Рубиновая кирка', texture: 'ruby_pick', tool: { type: 'pickaxe', power: 100, tier: 4, speed: .2, durability: 900 } },
        { id: 'ruby_sword', name: 'Рубиновый меч', texture: 'ruby_sword', weapon: { damage: 18, speed: .25, reach: 2.8 } },
      ],
      recipes: [
        { result: 'ruby_pick', ingredients: [['ruby', 3], ['stick', 2]], station: 'workbench', pattern: ['RRR', ' | ', ' | '], key: { R: 'ruby', '|': 'stick' } },
        { result: 'ruby_sword', ingredients: [['ruby', 2], ['stick', 1]], station: 'workbench', pattern: ['R', 'R', '|'], key: { R: 'ruby', '|': 'stick' } },
        { result: 'ruby_block', ingredients: [['ruby', 9]], station: 'workbench' },
        { result: 'ruby', count: 9, ingredients: [['ruby_block', 1]] },
        { result: 'ruby', ingredients: [['ruby_ore', 1]], station: 'furnace' },
      ],
      worldgen: [{ type: 'ore', block: 'ruby_ore', minDepth: 22, maxDepth: 60, size: 4, rarity: .2, in: ['stone'] }],
      scripts: [{ lang: 'js', file: 'rubies.js' }],
    }, files: { 'rubies.js': `// Нашёл рубин — искры, звон и счётчик находок (он хранится в мире)
mod.on('tileBreak', e => {
  if (e.tile !== 'rubies:ruby_ore') return;
  fx.particles(e.x + 0.5, e.y + 0.5, e.z + 0.5, 'magic', 16, '#ff4080');
  fx.sound('coin');
  const n = (mod.storage.get('found') || 0) + 1;
  mod.storage.set('found', n);
  if (n === 1) player.message('💎 Первый рубин! Три рубина и две палки — кирка, которая копает быстрее алмазной.');
});

// Команда /rubies — сколько рубинов найдено в этом мире
commands.add('rubies', 'сколько рубинов найдено', args => {
  player.message('Найдено рубинов: ' + (mod.storage.get('found') || 0));
});
` } },
    { manifest: {
      id: 'trampoline', name: 'Батут', version: '1.0.0', game: 'voxel', api: 1, author: 'Денчик37',
      description: 'Пружинный блок: встань на него — подбросит высоко вверх. Присядь (C), чтобы не прыгать. Скрипт на Lua.',
      textures: { spring: { draw: { pattern: 'strata', base: '#ff7a1f', color2: '#ffd84a' } } },
      blocks: [{ id: 'spring', name: 'Пружинный блок', texture: 'spring', faces: { top: 'spring', side: 'planks_oak', bottom: 'planks_oak' }, hardness: 40, tool: 'axe', sound: 'wool' }],
      recipes: [{ result: 'spring', count: 2, ingredients: [['slime_ball', 3], ['wood', 3]], station: 'workbench', pattern: ['SSS', 'PPP'], key: { S: 'slime_ball', P: '#planks' } }],
      scripts: [{ lang: 'lua', file: 'spring.lua' }],
    }, files: { 'spring.lua': `-- Встал на пружину — подбросить вверх (присел — не подбрасывает)
mod.on("stepOn", "spring", function(e)
  if player.sneaking then return end
  player.launch(0, 17, 0)
  fx.particles(e.x + 0.5, e.y + 1, e.z + 0.5, "spark", 10)
  fx.sound("jump")
end)
` } },
    { manifest: {
      id: 'crystals', name: 'Кристальные шипы', version: '1.0.0', game: 'voxel', api: 1, author: 'Денчик37',
      description: 'В горах и снегах растут светящиеся кристаллы и кристальные столбы, в пустыне лежат кристальные валуны, в пещерах — кристаллы. Только данные — без скриптов.',
      textures: { crystal: { draw: { pattern: 'gem', base: '#7fd8ff' } }, crystal_block: { draw: { pattern: 'crystal', base: '#4fa8d8', color2: '#e8fbff' } } },
      blocks: [
        { id: 'crystal_block', name: 'Кристальный блок', texture: 'crystal_block', hardness: 80, tier: 1, light: '#4f7f8f', sound: 'glass' },
        { id: 'crystal', name: 'Кристалл', shape: 'cross', texture: 'crystal', hardness: 20, tool: 'any', solid: false, light: '#80b0c0', sound: 'glass' },
      ],
      recipes: [{ result: 'crystal_block', ingredients: [['crystal', 4]], pattern: ['CC', 'CC'], key: { C: 'crystal' } }],
      worldgen: [{ type: 'scatter', block: 'crystal', minDepth: 10, maxDepth: 45, chance: .02, on: ['stone'] }],
      features: [
        { type: 'column', block: 'crystal_block', top: 'crystal', biomes: ['snow', 'mountains'], perChunk: 0.6, min: 2, max: 5 },
        { type: 'scatter', block: 'crystal', on: ['stone', 'snow', 'snow_grass', 'grass'], biomes: ['snow', 'mountains'], chance: 0.006 },
        { type: 'boulder', block: 'crystal_block', biomes: ['desert'], perChunk: 0.15, radius: 1, radiusVar: 1 },
      ],
    }, files: {} },
  ];

  V.mods = { API, LIM, EVENTS, validate, unzip, zip, crc32, reset, register, recipes, features, runner, runtime: modRuntime, frameHtml, EXAMPLES, yOfDepth, DRAW: Object.keys(DRAW),
    // Каталог модов с модерацией — следующий шаг (как «Студия игр»: таблица, статус review → public, жалобы). Крючок для окна модов:
    catalog: { ready: false, list: async () => [], get: async () => null, submit: async () => { throw new Error('Каталог модов появится позже — пока делись файлом .d37mod'); } } };
})();

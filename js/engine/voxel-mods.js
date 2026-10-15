// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — моды «Кубомира»: mod.json (общий формат с 2D-песочницей), .d37mod (zip) / папка / mod.json,
//  блоки, вещи, рецепты, текстуры и фичи генерации — данными; поведение — скриптами в песочнице (JS и Lua)
// ═══════════════════════════════════════
// Формат (подробно — docs/MODS.md): { id, name, version, api: 1, game: 'voxel' | 'tiles' | 'both', author, description,
// textures, blocks[], items[], recipes[], features[], scripts[] }. Внутри мода имена — свои («ruby») или полные
// («rubies:ruby»), ваниль — без приставки («stone», «stick»). В игре у блоков и вещей мода всегда приставка «<мод>:».
// V.mods.validate(json, files) → { ok, errors, warnings, m } — проверка без браузера (её зовут тест и окно модов).
// V.mods.reset() — вернуть ваниль; V.mods.register(m, rgba) — добавить мод в реестр; V.mods.features(list) — для генератора.
// Скрипты: у каждого мода своя песочница — iframe sandbox (нет доступа к сайту, куки, базе) + CSP без сети → поток (Worker).
// Поток не отвечает на «пинг» 3 с — убит. Мир скрипты меняют только командами, которые проверяет игра (runner): блоки — до 256
// за событие и 2048 в секунду, только в загруженных чанках и не дальше 96 блоков от игрока; вещи — до 10 раз в секунду; подброс,
// телепорт, лечение — с пределами. Ошибка при запуске или 10 ошибок / зависание / 5 медленных обработчиков — мод выключен
// до перезапуска мира, игроку — сообщение (игра не падает). API скриптов — версия V.mods.API (1): mod.on(событие, [что], f),
// mod.command, mod.storage, mod.wait, world.get/set/read/time/day/particles/sound/spawn, player.* — docs/MODS.md.
// Каталог модов с модерацией — крючок V.mods.catalog (пока пустой; план — как «Студия игр»: ugc + проверка модератором).
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const V = E.vox = E.vox || {};
  if (!V.blocks) return;   // поток генерации (voxel-worker.js) модов не знает — ему приходят готовые таблицы
  const API = 1;
  const LIM = { blocks: 64, items: 128, recipes: 256, features: 16, scripts: 8, code: 200000, textures: 128, png: 65536, total: 4 << 20, files: 600 };
  const ID_RE = /^[a-z][a-z0-9_]{1,31}$/, NAME_RE = /^[a-z0-9_]{1,40}$/;
  const SHAPES = { cube: 1, cross: 2, torch: 4, ladder: 5, cactus: 7, chest: 8 };
  const TOOLS = ['pick', 'axe', 'shovel', 'sword'];
  const SOUNDS = ['stone', 'wood', 'dirt', 'grass', 'sand', 'gravel', 'snow', 'glass', 'metal', 'wool'];
  const TINTS = { grass: 1, foliage: 2, water: 3, birch: 4, spruce: 5 };
  const FEATURES = ['ore', 'scatter', 'boulder', 'column', 'tree'];
  const EVENTS = ['blockPlace', 'blockBreak', 'use', 'stepOn', 'tick', 'chat', 'playerJoin'];
  const KEYS = ['id', 'name', 'version', 'api', 'game', 'author', 'description', 'textures', 'blocks', 'items', 'recipes', 'features', 'scripts', 'tiles', 'homepage', 'license', 'icon'];
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const num = (v, d, a, b) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? +v : NaN; return Number.isFinite(x) ? Math.max(a, Math.min(b, x)) : d; };
  const bytes = f => f == null ? 0 : typeof f === 'string' ? f.length : f.length || f.byteLength || 0;
  const text = f => typeof f === 'string' ? f : new TextDecoder().decode(f);

  // ваниль — чтобы вернуть реестр, когда открывают другой мир (с другими модами или без них)
  const VAN = { blocks: V.VANILLA_BLOCKS, items: V.VANILLA_ITEMS, recipes: V.VANILLA_RECIPES, tex: V.tex.length, smelt: new Map(V.smelting), tags: JSON.stringify(V.TAGS) };
  const vanilla = n => !n.includes(':') && !!(V.item(n) || V.block(n));
  const vanTex = n => V.texIdx.has(n) && V.texIdx.get(n) < VAN.tex;

  // ═══ Проверка mod.json ═══
  // files — { 'путь/в/моде': Uint8Array | строка } (картинки и скрипты из архива или папки)
  function validate(json, files = {}){
    const errors = [], warnings = [], err = t => { if (errors.length < 60) errors.push(t); }, warn = t => { if (warnings.length < 60) warnings.push(t); };
    let j = json;
    if (j instanceof Uint8Array) j = text(j);
    if (typeof j === 'string') { if (j.charCodeAt(0) === 0xFEFF) j = j.slice(1); try { j = JSON.parse(j); } catch (e) { return { ok: false, errors: ['mod.json — не JSON: ' + e.message], warnings, m: null }; } }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, errors: ['mod.json должен быть объектом { … }'], warnings, m: null };
    const id = str(j.id, 40).toLowerCase();
    if (!ID_RE.test(id)) err('id — латиница, цифры и «_», 2–32 знака, с буквы (например «rubies»)');
    const m = { id, name: str(j.name, 60) || id, version: str(j.version, 20) || '1.0.0', api: num(j.api, API, 0, 1000) | 0, game: ['voxel', 'tiles', 'both'].includes(j.game) ? j.game : 'voxel',
      author: str(j.author, 60), description: str(j.description, 500), textures: {}, blocks: [], items: [], recipes: [], features: [], scripts: [], size: 0, needs: [] };
    if (!j.name) warn('нет name — показываем id');
    if (m.api > API) err(`мод для API ${m.api}, а игра умеет ${API} — обнови страницу или возьми версию мода постарше`);
    if (j.game != null && !['voxel', 'tiles', 'both'].includes(j.game)) warn('game — voxel, tiles или both; считаем voxel');
    if (m.game === 'tiles') warn('мод для 2D-песочницы (game: tiles) — в «Кубомире» он не загрузится');
    const blocks = Array.isArray(j.blocks) ? j.blocks : [], items = Array.isArray(j.items) ? j.items : [];
    if (j.blocks != null && !Array.isArray(j.blocks)) err('blocks — список [ … ]');
    if (j.items != null && !Array.isArray(j.items)) err('items — список [ … ]');
    // свои имена (блоки и вещи)
    const own = new Set(), ownBlocks = new Set();
    for (const b of [...blocks, ...items]) { const n = String(b?.id || ''); if (NAME_RE.test(n)) { if (own.has(n)) err(`имя «${n}» занято дважды (у блоков и вещей имена общие)`); own.add(n); } }
    for (const b of blocks) { const n = String(b?.id || ''); if (NAME_RE.test(n)) ownBlocks.add(n); }
    // имя вещи/блока из mod.json → полное имя в игре
    const ref = (n0, where, opt = {}) => {
      const n = String(n0 ?? '').trim();
      if (!n) { err(`${where}: пустое имя`); return ''; }
      if (n[0] === '#') { if (opt.tag === false || !V.TAGS[n.slice(1)]) { err(`${where}: здесь нельзя группу «${n}»` + (opt.tag === false ? '' : ` (есть: ${Object.keys(V.TAGS).map(k => '#' + k).join(', ')})`)); return ''; } return n; }
      if (n.includes(':')) {
        const [p, q] = n.split(':');
        if (p === id) { if (!own.has(q)) { err(`${where}: у мода нет «${q}»`); return ''; } return n; }
        if (!ID_RE.test(p) || !NAME_RE.test(q || '')) { err(`${where}: неверное имя «${n}»`); return ''; }
        if (!m.needs.includes(p)) { m.needs.push(p); warn(`нужен мод «${p}» (без него то, что на нём, не заработает)`); }
        return n;
      }
      if (own.has(n)) return id + ':' + n;
      if (vanilla(n)) return n;
      err(`${where}: нет вещи или блока «${n}»`); return '';
    };
    // только блок (для генерации мира)
    const blk = (n0, where) => {
      const r = ref(n0, where, { tag: false }); if (!r) return '';
      const [p, q] = r.includes(':') ? r.split(':') : ['', r];
      if (p === id ? !ownBlocks.has(q) : !p && !V.block(r)) { err(`${where}: «${n0}» — не блок`); return ''; }
      return r;
    };
    // текстуры: имя → { png (путь в моде), data (data:image/png), draw (рисунок кодом) }
    const tex = j.textures && typeof j.textures === 'object' && !Array.isArray(j.textures) ? j.textures : {};
    const tnames = Object.keys(tex);
    if (tnames.length > LIM.textures) err(`текстур больше ${LIM.textures}`);
    for (const tn of tnames.slice(0, LIM.textures)) {
      if (!NAME_RE.test(tn)) { err(`текстура «${tn}»: имя — латиница, цифры и «_»`); continue; }
      let t = tex[tn]; if (typeof t === 'string') t = t.startsWith('data:') ? { data: t } : { png: t };
      if (!t || typeof t !== 'object') { err(`текстура «${tn}»: нужен png, data или draw`); continue; }
      if (t.draw) {
        const d = t.draw;
        if (!d || typeof d !== 'object' || !V.PAINTERS.includes(d.k) || d.k === 'destroy') { err(`текстура «${tn}»: draw.k — один из: ${V.PAINTERS.filter(k => k !== 'destroy').join(', ')}`); continue; }
        const spec = {};
        for (const [k, v] of Object.entries(d)) if (/^[a-z][a-z0-9]{0,11}$/i.test(k) && ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || (typeof v === 'string' && v.length < 40))) spec[k] = v;
        m.textures[tn] = { draw: spec };
      } else if (t.data) {
        if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(t.data))) { err(`текстура «${tn}»: data — только data:image/png;base64,…`); continue; }
        if (t.data.length > LIM.png * 1.4) { err(`текстура «${tn}»: картинка больше 64 КБ`); continue; }
        m.textures[tn] = { data: t.data };
      } else if (t.png) {
        const p = String(t.png).replace(/^\.?\//, '');
        if (files[p] == null) { err(`текстура «${tn}»: нет файла ${p}`); continue; }
        if (bytes(files[p]) > LIM.png) { err(`текстура «${tn}»: ${p} больше 64 КБ`); continue; }
        m.textures[tn] = { png: p };
      } else err(`текстура «${tn}»: нужен png, data или draw`);
    }
    const texOne = (s, where) => { s = String(s); if (m.textures[s]) return id + ':' + s; if (vanTex(s)) return s; err(`${where}: нет текстуры «${s}» (своя — в textures, или имя текстуры игры)`); return null; };
    const texRef = (t, where) => {
      if (typeof t === 'string') return texOne(t, where);
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        const o = {}; let any = false;
        for (const k of ['all', 'top', 'bottom', 'side', 'front']) if (t[k]) { o[k] = texOne(t[k], where); if (!o[k]) return null; any = true; }
        if (!any) { err(`${where}: texture — { top, side, bottom, front }`); return null; }
        if (!o.all && !o.side) o.side = o.top || o.front || o.bottom;
        return o;
      }
      err(`${where}: texture — имя или { top, side, bottom, front }`); return null;
    };
    // блоки
    if (blocks.length > LIM.blocks) err(`блоков больше ${LIM.blocks}`);
    for (const b of blocks.slice(0, LIM.blocks)) {
      const bid = String(b?.id || ''), w = `блок «${bid}»`;
      if (!NAME_RE.test(bid)) { err(`блок без id или с неверным id «${bid}» (латиница, цифры, «_»)`); continue; }
      const shape = SHAPES[b.shape || 'cube'];
      if (!shape) { err(`${w}: shape — ${Object.keys(SHAPES).join(', ')}`); continue; }
      const t = texRef(b.texture ?? bid, w); if (!t) continue;
      const transparent = !!b.transparent || shape !== 1, opaque = shape === 1 && !transparent;
      const nb = { name: id + ':' + bid, title: str(b.name, 40) || bid, tex: t, shape, layer: opaque ? 1 : 2,
        solid: shape === 2 || shape === 4 ? false : b.solid != null ? !!b.solid : shape !== 5, opaque, op: opaque ? 15 : num(b.lightBlock, 0, 0, 15) | 0,
        emit: num(b.light, 0, 0, 15) | 0, hard: b.hardness === -1 ? -1 : num(b.hardness, 1, 0, 50), tool: TOOLS.includes(b.tool) ? b.tool : '', tier: num(b.tier, 0, 0, 5) | 0,
        sound: SOUNDS.includes(b.sound) ? b.sound : 'stone', bounce: num(b.bounce, 0, 0, 30), hurt: num(b.hurt, 0, 0, 10), slip: num(b.slip, 0, 0, .98),
        climb: !!b.climb || shape === 5, replace: !!b.replaceable, fall: !!b.falls, cullSelf: b.cullSelf !== false && shape !== 7 && shape !== 8,
        axis: !!b.axis && shape === 1, tint: TINTS[b.tint] || 0, ui: b.ui === 'craft' || b.ui === 'chest' ? b.ui : '', fuel: num(b.fuel, 0, 0, 600), stack: num(b.stack, 64, 1, 64) | 0, mod: id };
      if (b.tool && !nb.tool) warn(`${w}: tool — ${TOOLS.join(', ')}`);
      if (b.sound && !SOUNDS.includes(b.sound)) warn(`${w}: звука «${b.sound}» нет — будет stone`);
      if (b.drops === null || b.drops === false) nb.drop = null;
      else if (b.drops !== undefined) { nb.drop = ref(b.drops, w + ', drops', { tag: false }); if (!nb.drop) continue; }
      else nb.drop = nb.name;
      m.blocks.push(nb);
    }
    // вещи
    if (items.length > LIM.items) err(`вещей больше ${LIM.items}`);
    for (const it of items.slice(0, LIM.items)) {
      const iid = String(it?.id || ''), w = `вещь «${iid}»`;
      if (!NAME_RE.test(iid)) { err(`вещь без id или с неверным id «${iid}» (латиница, цифры, «_»)`); continue; }
      if (it.texture != null && typeof it.texture !== 'string') { err(`${w}: у вещи одна текстура — строка`); continue; }
      const tx = texOne(it.texture ?? iid, w); if (!tx) continue;
      const ni = { name: id + ':' + iid, title: str(it.name, 40) || iid, tex: tx, stack: num(it.stack, 64, 1, 64) | 0, fuel: num(it.fuel, 0, 0, 600), mod: id };
      if (it.tool) {
        const t = it.tool; if (!t || !TOOLS.includes(t.type)) { err(`${w}: tool.type — ${TOOLS.join(', ')}`); continue; }
        ni.tool = { kind: t.type, tier: num(t.tier, 1, 0, 5) | 0, speed: num(t.speed, t.type === 'sword' ? 1.5 : 2, .5, 20), dur: num(t.durability, 100, 1, 100000) | 0, dmg: num(t.damage, 2, 0, 20) };
        ni.stack = 1;
      }
      if (it.food) ni.food = { h: num(it.food.hunger, 2, 1, 20) | 0, sat: num(it.food.saturation, 1, 0, 20) };
      m.items.push(ni);
    }
    // рецепты: по форме (pattern + key), без формы (shapeless), печь (smelt)
    const recipes = Array.isArray(j.recipes) ? j.recipes : [];
    if (recipes.length > LIM.recipes) err(`рецептов больше ${LIM.recipes}`);
    for (const [k, r] of recipes.slice(0, LIM.recipes).entries()) {
      const w = `рецепт №${k + 1}`;
      if (!r || typeof r !== 'object') { err(`${w}: не объект`); continue; }
      const out = ref(r.result, w + ', result', { tag: false }); if (!out) continue;
      const n = num(r.count, 1, 1, 64) | 0, type = r.type || (r.pattern ? 'shaped' : r.ingredients ? 'shapeless' : r.input ? 'smelt' : '');
      if (type === 'smelt' || type === 'smelting' || type === 'furnace') {
        const inp = ref(r.input, w + ', input', { tag: false }); if (!inp) continue;
        m.recipes.push({ smelt: true, input: inp, out, time: num(r.time, 6, .5, 120) }); continue;
      }
      if (type === 'shapeless') {
        const src = Array.isArray(r.ingredients) ? r.ingredients.slice(0, 9) : [];
        if (!src.length) { err(`${w}: нет ingredients`); continue; }
        const list = src.map(x => ref(x, w)); if (list.some(x => !x)) continue;
        m.recipes.push({ list, out, n }); continue;
      }
      if (type !== 'shaped') { err(`${w}: type — shaped (pattern + key), shapeless (ingredients) или smelt (input)`); continue; }
      const P = Array.isArray(r.pattern) ? r.pattern.slice(0, 3).map(s => String(s).slice(0, 3)) : null;
      if (!P || !P.some(s => s.trim())) { err(`${w}: pattern — до 3 строк по 3 знака, пробел — пусто`); continue; }
      const key = {}; let bad = false;
      for (const ch of new Set(P.join('').replace(/ /g, ''))) { const v = r.key && r.key[ch]; if (!v) { err(`${w}: в key нет «${ch}»`); bad = true; continue; } key[ch] = ref(v, w); if (!key[ch]) bad = true; }
      if (!bad) m.recipes.push({ pattern: P, key, out, n, mirror: r.mirror !== false });
    }
    // фичи генерации (руды, россыпи, валуны, столбы, свои деревья) — по биомам
    const feats = Array.isArray(j.features) ? j.features : [];
    if (feats.length > LIM.features) err(`фич больше ${LIM.features}`);
    for (const [k, f] of feats.slice(0, LIM.features).entries()) {
      const w = `фича №${k + 1}`;
      if (!f || !FEATURES.includes(f.type)) { err(`${w}: type — ${FEATURES.join(', ')}`); continue; }
      const biomes = Array.isArray(f.biomes) ? f.biomes.filter(b => V.BIOME_IDS.includes(b)) : [];
      if (Array.isArray(f.biomes) && biomes.length !== f.biomes.length) warn(`${w}: неизвестные биомы пропущены (есть: ${V.BIOME_IDS.join(', ')})`);
      const nf = { type: f.type, biomes, perChunk: num(f.perChunk, f.type === 'ore' ? 2 : 1, 0, f.type === 'ore' ? 32 : 8) };
      if (f.type === 'tree') {
        nf.log = blk(f.log, w + ', log'); if (!nf.log) continue;
        nf.leaves = f.leaves ? blk(f.leaves, w + ', leaves') : ''; nf.min = num(f.min, 4, 2, 12) | 0; nf.max = Math.max(nf.min, num(f.max, 6, 2, 16) | 0); nf.radius = num(f.radius, 2, 1, 3) | 0;
      } else { nf.block = blk(f.block, w + ', block'); if (!nf.block) continue; }
      if (f.type === 'ore') { nf.minY = num(f.minY, 5, 1, V.H - 2) | 0; nf.maxY = Math.max(nf.minY + 1, num(f.maxY, 64, 2, V.H - 1) | 0); nf.size = num(f.size, 6, 1, 32) | 0; nf.replace = (Array.isArray(f.replace) ? f.replace : ['stone']).map(x => blk(x, w + ', replace')).filter(Boolean); }
      if (f.type === 'scatter') { nf.on = (Array.isArray(f.on) ? f.on : ['grass']).map(x => blk(x, w + ', on')).filter(Boolean); nf.chance = num(f.chance, .01, 0, 1); }
      if (f.type === 'boulder') { nf.radius = num(f.radius, 2, 1, 4) | 0; nf.radiusVar = num(f.radiusVar, 1, 0, 3) | 0; }
      if (f.type === 'column') { nf.min = num(f.min, 2, 1, 16) | 0; nf.max = Math.max(nf.min, num(f.max, 5, 1, 24) | 0); if (f.top) nf.top = blk(f.top, w + ', top'); }
      m.features.push(nf);
    }
    // скрипты
    const scripts = Array.isArray(j.scripts) ? j.scripts : [];
    if (scripts.length > LIM.scripts) err(`скриптов больше ${LIM.scripts}`);
    for (const s0 of scripts.slice(0, LIM.scripts)) {
      const s = typeof s0 === 'string' ? { file: s0 } : s0 || {};
      let code = '', name = '';
      if (typeof s.code === 'string') { code = s.code; name = str(s.name, 40) || 'скрипт'; }
      else if (s.file) { const p = String(s.file).replace(/^\.?\//, ''); if (files[p] == null) { err(`скрипт ${p}: нет файла`); continue; } code = text(files[p]); name = p; }
      else { err('скрипт: нужен file (путь в моде) или code (текст)'); continue; }
      const lang = s.lang || (/\.lua$/i.test(name) ? 'lua' : 'js');
      if (!['js', 'lua'].includes(lang)) { err(`скрипт ${name}: язык — js или lua`); continue; }
      if (code.length > LIM.code) { err(`скрипт ${name}: больше 200 КБ`); continue; }
      m.scripts.push({ name, lang, code });
    }
    m.size = JSON.stringify(j).length + Object.values(files).reduce((a, f) => a + bytes(f), 0);
    if (m.size > LIM.total) err('мод больше 4 МБ');
    for (const k of Object.keys(j)) if (!KEYS.includes(k)) warn(`поле «${k}» игре неизвестно — пропущено`);
    return { ok: !errors.length, errors, warnings, m };
  }

  // ═══ Zip (.d37mod): чтение (без сжатия и deflate) и запись (без сжатия) ═══
  async function inflate(src, max){
    if (typeof DecompressionStream === 'undefined') throw new Error('браузер не умеет распаковывать zip — обнови его или сохрани архив без сжатия');
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
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('архив повреждён');
      const flags = dv.getUint16(p + 8, true), meth = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl)).replace(/\\/g, '/'); p += 46 + nl + xl + cl;
      if (name.endsWith('/') || name.startsWith('/') || name.split('/').includes('..') || /^__MACOSX\//.test(name) || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name)) continue;
      if (flags & 1) throw new Error('архив с паролем — сохрани без пароля');
      total += usz; if (usz > LIM.total || total > LIM.total * 2) throw new Error('архив слишком большой (мод — до 4 МБ)');
      if (lo + 30 > u8.length || dv.getUint32(lo, true) !== 0x04034b50) throw new Error('архив повреждён');
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), src = u8.subarray(ds, ds + csz);
      let data;
      if (meth === 0) data = src.slice();
      else if (meth === 8) data = await inflate(src, usz);
      else throw new Error('неизвестное сжатие в архиве: ' + name);
      if (data.length !== usz) throw new Error('архив повреждён: ' + name);
      raw[name] = data;
    }
    // всё лежит в одной папке — убрать её из путей
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
  // m — проверенный мод (validate().m); rgba — { имя текстуры: Uint8Array 16×16×4 } (PNG уже разобраны браузером)
  // → { skipped: [что не подключилось и почему] }
  function register(m, rgba = {}){
    const skipped = [];
    for (const [tn, t] of Object.entries(m.textures)) {
      let spec;
      if (t.draw) { spec = Object.assign({}, t.draw); if (typeof spec.base === 'string' && m.textures[spec.base]) spec.base = m.id + ':' + spec.base; }
      else spec = rgba[tn] ? { rgba: rgba[tn] } : { k: 'missing' };
      V.texture(m.id + ':' + tn, spec);
    }
    const from = V.blocks.length;
    for (const b of m.blocks) { if (V.blocks.length >= 4000) { skipped.push(b.name + ': слишком много блоков'); break; } V.defineBlock(Object.assign({}, b)); }
    V.blockItems(from);
    for (const it of m.items) V.defineItem(Object.assign({}, it));
    const has = n => !n || n[0] === '#' || !!V.item(n);
    for (const r of m.recipes) {
      const need = r.smelt ? [r.input, r.out] : [r.out, ...(r.list || Object.values(r.key || {}))];
      const miss = need.filter(n => !has(n));
      if (miss.length) { skipped.push(`рецепт «${r.out}»: нет ${miss.join(', ')}`); continue; }
      if (r.smelt) V.addSmelt(r.input, r.out, r.time); else V.addRecipe(Object.assign({ mod: m.id }, r));
    }
    V.compile(); V.iconsReset?.();
    return { skipped };
  }
  // фичи генерации: имена → номера блоков (в поток уходят только числа)
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

  // ═══ То, что работает в потоке песочницы (уходит текстом, снаружи ничего не видит) ═══
  function modRuntime(){
    'use strict';
    const EVS = ['blockPlace', 'blockBreak', 'use', 'stepOn', 'tick', 'chat', 'playerJoin'];
    const send = m => postMessage(m);
    const H = {}, CMDS = new Map(), pend = new Map(), local = new Map();
    let MOD = '', NAMES = new Set(), CUR = '', INIT = false, snap = null, info = { time: 12, player: null }, queue = [], sets = 0, reqN = 0, LINE0 = 0, store = {};
    const lineOf = st => { st = String(st || ''); const m = /<anonymous>:(\d+):\d+/.exec(st) || /> Function:(\d+):\d+/.exec(st); return m ? Math.max(0, +m[1] - LINE0) : 0; };
    const err = (where, e) => send({ t: 'error', where: String(where || CUR || ''), line: lineOf(e && e.stack), msg: String((e && e.message) || e).slice(0, 300), init: INIT });
    // «ruby» → «мод:ruby», если у мода такое есть; ваниль и полные имена — как есть
    const full = n => { n = String(n == null ? '' : n).trim(); if (!n || n.includes(':') || n[0] === '#') return n; return NAMES.has(MOD + ':' + n) ? MOD + ':' + n : n; };
    const q = c => { if (queue.length < 600) queue.push(c); };
    const fin = v => typeof v === 'number' && isFinite(v);
    const flr = Math.floor;
    const P = () => info.player || {};
    function flush(){ if (queue.length) { send({ t: 'cmds', list: queue }); queue = []; } }
    setInterval(flush, 100);   // команды из таймеров и после await
    const world = {
      get(x, y, z){
        if (!fin(x) || !fin(y) || !fin(z)) return null;
        x = flr(x); y = flr(y); z = flr(z);
        const k = x + ',' + y + ',' + z;
        if (local.has(k)) return local.get(k);
        if (!snap) return null;
        const n = snap.n, dx = x - snap.x, dy = y - snap.y, dz = z - snap.z;
        if (dx < 0 || dy < 0 || dz < 0 || dx >= n || dy >= n || dz >= n) return null;
        const v = snap.names[snap.ids[(dx * n + dy) * n + dz]];
        return v == null ? null : v;
      },
      set(x, y, z, block){
        if (!fin(x) || !fin(y) || !fin(z)) throw new Error('world.set: координаты — числа');
        if (typeof block !== 'string' || !block) throw new Error('world.set: блок — строка, например "stone"');
        if (++sets > 256) throw new Error('world.set: не больше 256 блоков за одно событие');
        x = flr(x); y = flr(y); z = flr(z); block = full(block);
        local.set(x + ',' + y + ',' + z, block); q({ c: 'set', x, y, z, b: block });
      },
      read(x, y, z){
        if (!fin(x) || !fin(y) || !fin(z) || pend.size > 200) return Promise.resolve(null);
        const id = ++reqN; send({ t: 'read', id, x: flr(x), y: flr(y), z: flr(z) });
        return new Promise(res => { pend.set(id, res); setTimeout(() => { if (pend.has(id)) { pend.delete(id); res(null); } }, 2000); });
      },
      time(){ return info.time; },
      day(){ return info.time >= 6 && info.time < 19; },
      particles(kind, x, y, z, n){ q({ c: 'fx', k: String(kind), x: +x, y: +y, z: +z, n: Math.min(40, (n | 0) || 8) }); },
      sound(name, x, y, z){ q({ c: 'snd', n: String(name), x: +x, y: +y, z: +z }); },
      spawn(type, x, y, z){ q({ c: 'spawn', k: String(type), x: +x, y: +y, z: +z }); },
    };
    const player = {
      get x(){ return P().x || 0; }, get y(){ return P().y || 0; }, get z(){ return P().z || 0; },
      get health(){ return P().hp == null ? 20 : P().hp; }, get food(){ return P().food == null ? 20 : P().food; },
      get name(){ return P().name || 'Игрок'; }, get mode(){ return P().mode || 'survival'; }, get item(){ return P().item || ''; }, get sneaking(){ return !!P().sneak; },
      message(t){ q({ c: 'msg', t: String(t).slice(0, 200) }); },
      give(item, n){ q({ c: 'give', i: full(item), n: (n | 0) || 1 }); },
      heal(n){ q({ c: 'heal', n: +n || 0 }); },
      hurt(n){ q({ c: 'hurt', n: +n || 0 }); },
      launch(vx, vy, vz){ q({ c: 'launch', v: [+vx || 0, +vy || 0, +vz || 0] }); },
      teleport(x, y, z){ q({ c: 'tp', v: [+x, +y, +z] }); },
    };
    const mod = {
      api: 1,
      get id(){ return MOD; },
      on(ev, a, b){
        const f = typeof a === 'function' ? a : b, filter = typeof a === 'function' ? null : a;
        if (!EVS.includes(ev)) throw new Error('mod.on: нет события «' + ev + '». Есть: ' + EVS.join(', '));
        if (typeof f !== 'function') throw new Error('mod.on: нужна функция-обработчик');
        const list = filter == null ? null : [].concat(filter).map(full).filter(Boolean).slice(0, 64);
        if ((ev === 'use' || ev === 'stepOn') && !(list && list.length)) throw new Error('mod.on("' + ev + '", …): укажи, на что — имя блока или вещи мода');
        (H[ev] || (H[ev] = [])).push({ f, filter: list, src: CUR });
        send({ t: 'want', ev, filter: list });
      },
      command(name, f){
        name = String(name).toLowerCase();
        if (!/^[a-z0-9_]{1,16}$/.test(name)) throw new Error('mod.command: имя — латиница и цифры, до 16 знаков');
        if (typeof f !== 'function') throw new Error('mod.command: нужна функция');
        if (CMDS.size >= 32) throw new Error('mod.command: не больше 32 команд');
        CMDS.set(name, { f, src: CUR }); send({ t: 'cmd', name });
      },
      log(...a){ send({ t: 'log', text: a.map(x => { if (typeof x === 'string') return x; try { return JSON.stringify(x); } catch (e) { return String(x); } }).join(' ').slice(0, 300) }); },
      wait(s){ return new Promise(r => setTimeout(r, Math.max(0, +s || 0) * 1000)); },
      storage: {
        get(k){ return store[String(k)]; },
        set(k, v){
          k = String(k); const old = store[k]; store[k] = v; let s;
          try { s = JSON.stringify(store); } catch (e) { store[k] = old; throw new Error('mod.storage: такое не сохранить (только числа, строки, списки и объекты)'); }
          if (s.length > 65536) { store[k] = old; throw new Error('mod.storage: больше 64 КБ'); }
          q({ c: 'store', s });
        },
        remove(k){ delete store[String(k)]; q({ c: 'store', s: JSON.stringify(store) }); },
      },
    };
    function begin(d){ sets = 0; local.clear(); snap = d.snap || null; if (d.info) info = d.info; }
    function call(h, args){
      const t0 = Date.now(); CUR = h.src;
      try { const r = h.f(...args); if (r && typeof r.then === 'function') r.then(null, e => err(h.src, e)); } catch (e) { err(h.src, e); }
      const ms = Date.now() - t0;
      if (ms > 250) send({ t: 'slow', where: h.src, ms });
    }
    onmessage = e => {
      const d = e.data || {};
      if (d.t === 'ping') { postMessage({ t: 'pong', n: d.n }); return; }
      if (d.t === 'init') {
        if (MOD) return;
        MOD = String(d.mod || ''); NAMES = new Set(d.names || []);
        store = d.store && typeof d.store === 'object' ? d.store : {};
        // номер строки: new Function добавляет строки заголовка — узнаём, сколько
        try { new Function('throw new Error("x")')(); } catch (e2) { const m = /<anonymous>:(\d+):\d+/.exec(e2.stack || '') || /> Function:(\d+):\d+/.exec(e2.stack || ''); LINE0 = m ? +m[1] - 1 : 0; }
        INIT = true;
        for (const id of Object.keys(d.libs || {})) { try { (0, eval)(String(d.libs[id])); } catch (e5) { err('язык ' + id, e5); } }
        for (const s of d.scripts || []) {
          CUR = s.name;
          if (s.lang === 'lua') {
            const L = self.D37Lang && self.D37Lang.lua;
            if (!L) { err(s.name, new Error('Lua не загрузился — обнови страницу')); continue; }
            const env = { mod, world, player, log: mod.log, print: mod.log, warn: mod.log, __globals: ['mod', 'world', 'player'] };
            const ctx = { name: s.name, error: (msg, line) => send({ t: 'error', where: s.name, line: line | 0, msg: String(msg).slice(0, 300), init: INIT }), setCurrent(){} };
            try { L.run(String(s.code), env, ctx); } catch (e4) { err(s.name, e4); }
            continue;
          }
          try { new Function('mod', 'world', 'player', 'log', String(s.code))(mod, world, player, mod.log); } catch (e4) { err(s.name, e4); }
        }
        INIT = false; CUR = '';
        flush(); send({ t: 'ready' });
        return;
      }
      if (d.t === 'ev') {
        begin(d);
        const data = Object.assign({}, d.data || {}, { player });
        for (const h of H[d.ev] || []) { if (h.filter && !h.filter.includes(data.block) && !h.filter.includes(data.item)) continue; call(h, [data]); }
        flush(); return;
      }
      if (d.t === 'tick') { begin(d); for (const h of H.tick || []) call(h, [d.dt]); flush(); return; }
      if (d.t === 'cmd') { const h = CMDS.get(d.name); if (h) { begin(d); call(h, [Array.isArray(d.args) ? d.args : [], player]); flush(); } return; }
      if (d.t === 'read') { const r = pend.get(d.id); if (r) { pend.delete(d.id); r(d.v == null ? null : d.v); } return; }
    };
  }

  // ═══ Хозяин песочниц в игре: события → потоки, команды потоков → проверка → мир ═══
  // st — сессия игры (kubomir.js): W, R.lighting, meta, creative; loaded — [{ m }]; hooks — действия игры (player, give, launch…);
  // o.box(onMsg) → { post, close } — своя песочница (тест в node), по умолчанию — iframe; o.now — часы (тест)
  function runner(st, loaded, hooks = {}, o = {}){
    const box = o.box || iframeBox, clock = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const R = { mods: [], cmds: new Map(), uses: new Set(), steps: new Set(), dead: false, logs: [] };
    const NAMES = [...new Set([...V.blocks.map(b => b.name), ...V.items.map(i => i.name)])];
    const log = (M, t, bad) => { R.logs.push({ mod: M.m.id, t: String(t).slice(0, 300), bad: !!bad, at: Date.now() }); if (R.logs.length > 300) R.logs.shift(); };
    const off = (M, why) => {
      if (M.off) return;
      M.off = why; try { M.box?.close(); } catch (e) {} M.box = null;
      log(M, '⛔ выключен: ' + why, true);
      hooks.toast?.(`🧩 Мод «${M.m.name}» выключен: ${why}`, false);
      for (const [k, v] of [...R.cmds]) if (v === M) R.cmds.delete(k);
    };
    const near = (x, y, z, P) => !!P && Math.abs(x - P.x) <= 96 && Math.abs(z - P.z) <= 96 && y >= 0 && y < V.H;
    const nick = () => { try { return (typeof currentProfile !== 'undefined' && currentProfile && currentProfile.nick) || 'Игрок'; } catch (e) { return 'Игрок'; } };
    // окрестность 9×9×9 — имена блоков: скрипт читает world.get без ожидания
    function snap(x, y, z){
      const n = 9, x0 = Math.floor(x) - 4, y0 = Math.floor(y) - 4, z0 = Math.floor(z) - 4, ids = new Array(n * n * n), names = [], idx = new Map();
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = 0; c < n; c++) {
        const t = st.W.get(x0 + a, y0 + b, z0 + c), nm = t < 0 ? null : V.blocks[t]?.name ?? null;
        let k = idx.get(nm); if (k === undefined) { k = names.length; names.push(nm); idx.set(nm, k); }
        ids[(a * n + b) * n + c] = k;
      }
      return { x: x0, y: y0, z: z0, n, ids, names };
    }
    function info(){
      const P = hooks.player?.(), sel = P?.inv?.[P.sel];
      return { time: +(st.R?.lighting?.time ?? 12), player: P ? { x: P.x, y: P.y, z: P.z, hp: P.hp, food: P.food, name: nick(), mode: st.creative ? 'creative' : 'survival', item: sel?.id || '', sneak: !!P.sneak } : null };
    }
    const tileItems = t => !t ? [] : Array.isArray(t.items) ? t.items : [t.in, t.fuel, t.out];
    // команды из песочницы — проверка и применение
    function apply(M, list){
      const P = hooks.player?.(), now = clock();
      if (now - M.secT >= 1000) { M.secT = now; M.secSets = 0; M.secGives = 0; M.secSpawn = 0; M.secFx = 0; M.secMsg = 0; }
      for (const c of list) {
        if (M.off || R.dead) return;
        if (!c || typeof c !== 'object') continue;
        try {
          if (c.c === 'set') {
            if (++M.secSets > 2048) { if (M.secSets === 2049) log(M, 'больше 2048 блоков в секунду — лишние пропущены', true); continue; }
            const b = V.block(String(c.b)); if (!b) { log(M, `world.set: нет блока «${c.b}»`, true); continue; }
            if (![c.x, c.y, c.z].every(Number.isInteger) || !near(c.x, c.y, c.z, P) || !st.W.loaded(c.x, c.z)) continue;
            const was = st.W.get(c.x, c.y, c.z);
            if (was === b.id) continue;
            if (was > 0 && V.blocks[was]?.ui) { const t = st.W.dropTile?.(c.x, c.y, c.z); for (const s of tileItems(t)) if (s) st.ents?.addItem?.(c.x + .5, c.y + .5, c.z + .5, s, true); }
            st.W.set(c.x, c.y, c.z, b.id, { urgent: 2, mod: M.m.id });
          } else if (c.c === 'give') {
            if (++M.secGives > 10) continue;
            const it = V.item(String(c.i)); if (!it) { log(M, `player.give: нет вещи «${c.i}»`, true); continue; }
            hooks.give?.({ id: it.name, n: Math.max(1, Math.min(it.stack || 64, c.n | 0)) });
          } else if (c.c === 'msg') { if (++M.secMsg <= 5) hooks.log?.(`🧩 ${M.m.name}: ${String(c.t).slice(0, 200)}`); }
          else if (c.c === 'heal') { if (Number.isFinite(c.n)) hooks.heal?.(Math.max(-20, Math.min(20, c.n))); }
          else if (c.c === 'hurt') { if (Number.isFinite(c.n) && c.n > 0) hooks.hurt?.(Math.min(20, c.n)); }
          else if (c.c === 'launch') { const v = Array.isArray(c.v) ? c.v : []; if (v.length === 3 && v.every(Number.isFinite)) hooks.launch?.(Math.max(-30, Math.min(30, v[0])), Math.max(-30, Math.min(30, v[1])), Math.max(-30, Math.min(30, v[2]))); }
          else if (c.c === 'tp') { const v = Array.isArray(c.v) ? c.v : []; if (v.length === 3 && v.every(Number.isFinite) && P && Math.hypot(v[0] - P.x, v[2] - P.z) <= 128 && st.W.loaded(v[0], v[2])) hooks.teleport?.(v[0], Math.max(1, Math.min(V.H + 10, v[1])), v[2]); }
          else if (c.c === 'fx') { if (++M.secFx <= 30 && ['spark', 'smoke', 'fire', 'magic', 'heart'].includes(c.k) && [c.x, c.y, c.z].every(Number.isFinite) && near(c.x, c.y, c.z, P)) hooks.particles?.(c.k, c.x, c.y, c.z, Math.max(1, Math.min(40, c.n | 0))); }
          else if (c.c === 'snd') { if (++M.secFx <= 30 && /^(kb_[a-z_]+|coin|click|hit|break|pickup|jump|land|door_wood_open|door_wood_close|build_wood)$/.test(String(c.n)) && [c.x, c.y, c.z].every(Number.isFinite)) hooks.sound?.(c.n, c.x, c.y, c.z); }
          else if (c.c === 'spawn') { if (++M.secSpawn <= 3 && [c.x, c.y, c.z].every(Number.isFinite) && near(c.x, c.y, c.z, P)) hooks.spawn?.(String(c.k), c.x, c.y, c.z); }
          else if (c.c === 'store') { if (typeof c.s === 'string' && c.s.length <= 65536) M.store = c.s; }
        } catch (e) { log(M, 'команда: ' + (e.message || e), true); }
      }
    }
    function onMsg(M, d){
      if (M.off || R.dead || !d || typeof d !== 'object') return;
      const t = d.t;
      if (t === 'frame') {
        if (M.booted) return;
        M.booted = true;
        const libs = {};
        if (M.m.scripts.some(s => s.lang === 'lua') && root.D37E?.langs?.lua?.worker) libs.lua = '(' + root.D37E.langs.lua.worker.toString() + ')();';
        let store = {}; try { store = JSON.parse(st.meta?.modData?.[M.m.id] || '{}') || {}; } catch (e) {}
        M.box.post({ t: 'boot', code: modRuntime.toString() });
        M.box.post({ t: 'init', mod: M.m.id, scripts: M.m.scripts, libs, store, names: NAMES });
        return;
      }
      if (t === 'ready') { M.ready = true; return; }
      if (t === 'want') {
        const ev = String(d.ev || ''); if (!EVENTS.includes(ev)) return;
        const f = Array.isArray(d.filter) ? d.filter.slice(0, 64).map(String) : null;
        M.want[ev] = true;
        if (ev === 'use' && f) for (const n of f) if (R.uses.size < 512) R.uses.add(n);
        if (ev === 'stepOn' && f) for (const n of f) if (R.steps.size < 512) R.steps.add(n);
        return;
      }
      if (t === 'cmd') { const n = String(d.name || ''); if (/^[a-z0-9_]{1,16}$/.test(n) && !R.cmds.has(n) && [...R.cmds.values()].filter(x => x === M).length < 32) R.cmds.set(n, M); return; }
      if (t === 'cmds') { apply(M, Array.isArray(d.list) ? d.list.slice(0, 600) : []); return; }
      if (t === 'log') { const s = String(d.text || '').slice(0, 300); log(M, s); const now = clock(); if (now - M.logT >= 1000) { M.logT = now; M.logN = 0; } if (++M.logN <= 5) hooks.log?.(`🧩 ${M.m.name}: ${s}`); return; }
      if (t === 'read') {
        const now = clock(); if (now - M.readT >= 1000) { M.readT = now; M.readN = 0; } if (++M.readN > 200) return;
        const ok = [d.x, d.y, d.z].every(Number.isInteger), v = ok ? st.W.get(d.x, d.y, d.z) : -1;
        M.box?.post({ t: 'read', id: d.id, v: v < 0 ? null : V.blocks[v]?.name ?? null });
        return;
      }
      if (t === 'error') {
        M.errors++;
        const where = `${String(d.where || 'скрипт').slice(0, 60)}${d.line ? ', строка ' + (d.line | 0) : ''}`, msg = String(d.msg || 'ошибка').slice(0, 300);
        log(M, `${where}: ${msg}`, true);
        if (d.init) { off(M, `ошибка при запуске (${where}): ${msg.slice(0, 120)}`); return; }
        if (M.errors === 1) hooks.toast?.(`🧩 Ошибка в моде «${M.m.name}» (${where}): ${msg.slice(0, 90)}`, false);
        if (M.errors >= 10) off(M, '10 ошибок в скриптах');
        return;
      }
      if (t === 'slow') { M.slow++; log(M, `${String(d.where || '')}: обработчик работал ${d.ms | 0} мс — это тормозит игру`, true); if (M.slow >= 5) off(M, 'обработчики тормозят игру'); return; }
      if (t === 'hang') { off(M, 'скрипт завис (не отвечал 3 с)'); return; }
    }
    const post = (M, m) => { if (!M.off && M.ready && M.box) M.box.post(m); };
    for (const L of loaded) {
      const M = { m: L.m, box: null, booted: false, ready: false, want: {}, errors: 0, slow: 0, off: null, store: null, secT: -1e9, logT: -1e9, logN: 0, readT: -1e9, readN: 0 };
      R.mods.push(M);
      if (!L.m.scripts.length) continue;
      try { M.box = box(d => onMsg(M, d)); } catch (e) { off(M, 'песочница не запустилась: ' + (e.message || e)); }
    }
    const wants = (M, ev) => !M.off && M.ready && M.want[ev];
    R.event = (ev, data = {}) => {
      if (R.dead || !R.mods.some(M => wants(M, ev))) return;
      const sn = Number.isFinite(data.x) ? snap(data.x, data.y, data.z) : null, inf = info();
      for (const M of R.mods) if (wants(M, ev)) post(M, { t: 'ev', ev, data, snap: sn, info: inf });
    };
    R.hasUse = name => !!name && R.uses.has(name);
    const stepT = new Map();
    R.stepOn = (types, P) => {
      if (R.dead || !R.steps.size) return;
      const now = clock();
      for (const t of types) {
        const nm = V.blocks[t]?.name; if (!nm || !R.steps.has(nm) || now - (stepT.get(nm) ?? -1e9) < 300) continue;
        stepT.set(nm, now);
        R.event('stepOn', { x: Math.floor(P.x), y: Math.floor(P.y - .05), z: Math.floor(P.z), block: nm });
      }
    };
    let tickAcc = 0;
    R.tick = dt => {
      if (R.dead) return;
      tickAcc += dt; if (tickAcc < .25) return;
      const d = Math.min(1, tickAcc); tickAcc = 0;
      if (!R.mods.some(M => wants(M, 'tick'))) return;
      const P = hooks.player?.(), sn = P ? snap(P.x, P.y, P.z) : null, inf = info();
      for (const M of R.mods) if (wants(M, 'tick')) post(M, { t: 'tick', dt: d, snap: sn, info: inf });
    };
    R.second = () => {};
    R.commands = () => [...R.cmds.keys()];
    R.command = (name, args = []) => {
      const M = R.cmds.get(String(name).toLowerCase()); if (!M || M.off) return false;
      const P = hooks.player?.();
      post(M, { t: 'cmd', name: String(name).toLowerCase(), args: args.slice(0, 16).map(a => String(a).slice(0, 64)), snap: P ? snap(P.x, P.y, P.z) : null, info: info() });
      return true;
    };
    R.data = () => { const out = Object.assign({}, st.meta?.modData || {}); for (const M of R.mods) if (M.store != null) out[M.m.id] = M.store; return out; };
    R.status = () => R.mods.map(M => ({ id: M.m.id, name: M.m.name, version: M.m.version, scripts: M.m.scripts.length, errors: M.errors, off: M.off, ready: M.ready || !M.m.scripts.length }));
    R.stop = () => { R.dead = true; for (const M of R.mods) { try { M.box?.close(); } catch (e) {} M.box = null; } };
    // «вошёл в мир» — когда песочницы готовы (или через 6 с)
    let joinN = 0;
    const joinWait = () => { if (R.dead) return; if (R.mods.some(M => M.m.scripts.length && !M.off && !M.ready) && joinN++ < 40) { setTimeout(joinWait, 150); return; } R.event('playerJoin', {}); };
    if (R.mods.some(M => M.m.scripts.length)) setTimeout(joinWait, 150);
    return R;
  }

  // ═══ Примеры (они же — в docs/MODS.md и в окне «🧩 Моды» → «📦 Примеры») ═══
  const EXAMPLES = [
    { manifest: {
      id: 'rubies', name: 'Рубины', version: '1.0.0', api: 1, game: 'voxel', author: 'Денчик37',
      description: 'Рубиновая руда глубоко под землёй, рубиновая кирка и меч, блок из рубинов. Найденные рубины считает команда /rubies.',
      textures: {
        ruby_ore: { draw: { k: 'ore', c: '#e0115f', n: 5 } }, ruby: { draw: { k: 'gem', c: '#e0115f' } }, ruby_block: { draw: { k: 'checker', c: '#e0115f', c2: '#b50d4d' } },
        ruby_pick: { draw: { k: 'tool', tool: 'pick', c: '#e0115f' } }, ruby_sword: { draw: { k: 'tool', tool: 'sword', c: '#e0115f' } },
      },
      blocks: [
        { id: 'ruby_ore', name: 'Рубиновая руда', texture: 'ruby_ore', hardness: 3, tool: 'pick', tier: 3, drops: 'ruby' },
        { id: 'ruby_block', name: 'Рубиновый блок', texture: 'ruby_block', hardness: 5, tool: 'pick', tier: 2, sound: 'metal', light: 4 },
      ],
      items: [
        { id: 'ruby', name: 'Рубин', texture: 'ruby' },
        { id: 'ruby_pick', name: 'Рубиновая кирка', texture: 'ruby_pick', tool: { type: 'pick', tier: 4, speed: 10, durability: 900, damage: 4 } },
        { id: 'ruby_sword', name: 'Рубиновый меч', texture: 'ruby_sword', tool: { type: 'sword', tier: 4, durability: 900, damage: 8 } },
      ],
      recipes: [
        { pattern: ['RRR', ' | ', ' | '], key: { R: 'ruby', '|': 'stick' }, result: 'ruby_pick' },
        { pattern: ['R', 'R', '|'], key: { R: 'ruby', '|': 'stick' }, result: 'ruby_sword' },
        { pattern: ['RRR', 'RRR', 'RRR'], key: { R: 'ruby' }, result: 'ruby_block' },
        { type: 'shapeless', ingredients: ['ruby_block'], result: 'ruby', count: 9 },
        { type: 'smelt', input: 'ruby_ore', result: 'ruby' },
      ],
      features: [{ type: 'ore', block: 'ruby_ore', minY: 4, maxY: 30, size: 4, perChunk: 1.5 }],
      scripts: [{ file: 'rubies.js' }],
    }, files: { 'rubies.js': `// Нашёл рубин — искры, звон и счётчик находок (он хранится в мире)
mod.on('blockBreak', 'ruby_ore', e => {
  world.particles('magic', e.x, e.y, e.z, 16);
  world.sound('coin', e.x, e.y, e.z);
  const n = (mod.storage.get('found') || 0) + 1;
  mod.storage.set('found', n);
  if (n === 1) e.player.message('💎 Первый рубин! Три рубина и две палки — кирка, которая копает быстрее алмазной.');
});

// Команда /rubies — сколько рубинов нашёл в этом мире
mod.command('rubies', (args, player) => {
  player.message('Найдено рубинов: ' + (mod.storage.get('found') || 0));
});
` } },
    { manifest: {
      id: 'trampoline', name: 'Батут', version: '1.0.0', api: 1, game: 'voxel', author: 'Денчик37',
      description: 'Пружинный блок: встань на него — подбросит высоко вверх. Присядь (C), чтобы не прыгать. Скрипт на Lua.',
      textures: { spring: { draw: { k: 'stripes', c: '#ff7a1f', c2: '#ffd84a' } } },
      blocks: [{ id: 'spring', name: 'Пружинный блок', texture: { top: 'spring', side: 'planks_oak', bottom: 'planks_oak' }, hardness: 0.6, tool: 'axe', sound: 'wool' }],
      recipes: [{ pattern: ['SSS', 'PPP'], key: { S: 'slime_ball', P: '#planks' }, result: 'spring', count: 2 }],
      scripts: [{ file: 'spring.lua' }],
    }, files: { 'spring.lua': `-- Встал на пружину — подбросить вверх (присел — не подбрасывает)
mod:on("stepOn", "spring", function(e)
  if player.sneaking then return end
  player:launch(0, 17, 0)
  world:particles("spark", e.x, e.y + 1, e.z, 10)
  world:sound("kb_bounce", e.x, e.y, e.z)
end)
` } },
    { manifest: {
      id: 'crystals', name: 'Кристальные шипы', version: '1.0.0', api: 1, game: 'voxel', author: 'Денчик37',
      description: 'В горах и снегах растут светящиеся кристаллы и кристальные столбы, в пустыне лежат кристальные валуны. Только данные — без скриптов.',
      textures: { crystal: { draw: { k: 'gem', c: '#7fd8ff' } }, crystal_block: { draw: { k: 'dots', c: '#4fa8d8', c2: '#e8fbff', n: 16 } } },
      blocks: [
        { id: 'crystal_block', name: 'Кристальный блок', texture: 'crystal_block', hardness: 1.2, tool: 'pick', tier: 1, sound: 'glass', light: 9 },
        { id: 'crystal', name: 'Кристалл', shape: 'cross', texture: 'crystal', hardness: 0.3, sound: 'glass', light: 11 },
      ],
      recipes: [{ pattern: ['CC', 'CC'], key: { C: 'crystal' }, result: 'crystal_block' }],
      features: [
        { type: 'column', block: 'crystal_block', top: 'crystal', biomes: ['snow', 'mountains'], perChunk: 0.6, min: 2, max: 5 },
        { type: 'scatter', block: 'crystal', on: ['stone', 'snow', 'snow_grass', 'grass'], biomes: ['snow', 'mountains'], chance: 0.006 },
        { type: 'boulder', block: 'crystal_block', biomes: ['desert'], perChunk: 0.15, radius: 1, radiusVar: 1 },
      ],
    }, files: {} },
  ];

  V.mods = { API, LIM, EVENTS, validate, unzip, zip, crc32, reset, register, features, runner, runtime: modRuntime, frameHtml, EXAMPLES,
    // Каталог модов с модерацией — следующий шаг (как «Студия игр»: таблица, статус review → public, жалобы). Крючок для окна модов:
    catalog: { ready: false, list: async () => [], get: async () => null, submit: async () => { throw new Error('Каталог модов появится позже — пока делись файлом .d37mod'); } } };
})();

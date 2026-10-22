// ═══════════════════════════════════════
//  «ПОДЗЕМЬЕ» ⛏ — МОДЫ: проверка mod.json (общая спецификация с воксельной песочницей — docs/MODS.md), чтение .d37mod/.zip,
//  папки или .json, блоки/предметы/рецепты/генерация — данными, поведение — скриптами JS и Lua в песочнице
// ═══════════════════════════════════════
// Песочница — как у скриптов «Студии 3D» (js/engine/script.js): iframe sandbox="allow-scripts" + CSP без сети → внутри Worker
// с modRuntime(). Сайта, аккаунта, сети, DOM мод не видит. С игрой — только сообщениями: события (tileBreak, tilePlace, use,
// tick, mobKill, pickup, talk, command) приходят с «окном» мира вокруг (world.get читает его), а действия (world.set, fx.*,
// npc.*, player.*) уходят игре — она проверяет каждое (дальность, лимиты в секунду, известные имена). Ошибка — в журнал мода;
// 5 ошибок или зависание (нет ответа 3 с) — мод выключается, игра живёт. API — версия 1 (PZMods.API_VERSION): только
// добавлять, не менять. У каждого мира — свой список модов (W.mods); номера блоков модов — в W.palette (сохранения не ломаются).
(() => {
  const API_VERSION = 1;
  const LIM = { blocks: 64, items: 128, recipes: 256, worldgen: 16, scripts: 4, scriptBytes: 200000, textureBytes: 2.5e6, files: 200, zipBytes: 8e6, perMod: 400 };
  const ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
  const num = (v, a, b, d) => { const x = typeof v === 'number' && isFinite(v) ? v : d; return x < a ? a : x > b ? b : x; };
  const PATTERNS = ['dirt', 'stone', 'sand', 'snow', 'ice', 'strata', 'ore', 'obsid', 'planks', 'brick', 'glass', 'leaves', 'crystal', 'glowshroom', 'torch', 'mushroom', 'lamp'];
  const ICONS = ['pick', 'axe', 'hammer', 'sword', 'bow', 'arrow', 'wand', 'bar', 'gem', 'gel', 'fiber', 'membrane', 'feather', 'bottle', 'potion', 'mushroom', 'heart', 'star', 'bait', 'lure', 'amulet', 'boots', 'wings'];
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const colorOf = v => typeof v === 'string' && COLOR_RE.test(v) ? v.toLowerCase() : null;
  const lightOf = v => {
    if (Array.isArray(v) && v.length === 3) return v.map(x => num(x, 0, 255, 0) | 0);
    const c = colorOf(v); if (!c) return null;
    const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };

  // ═══ Проверка манифеста → { ok, errors: [], warnings: [], mod } (mod — очищенный, только известные поля) ═══
  // files: Map путь → строка (скрипты) | Uint8Array (картинки) — для мода из архива или папки
  function validate(json, files, forGame = 'tiles'){
    const errors = [], warnings = [];
    const err = m => errors.push(m), warn = m => warnings.push(m);
    if (!isObj(json)) return { ok: false, errors: ['mod.json — не объект'], warnings, mod: null };
    for (const k of Object.keys(json)) if (k === '__proto__' || k === 'constructor' || k === 'prototype') err('запрещённое поле ' + k);
    const id = str(json.id, 40);
    if (!ID_RE.test(id)) err('id: латиница в нижнем регистре, цифры, «-» и «_», 2–32 знака (например, "ruby-glow")');
    const name = str(json.name, 40); if (!name) err('name: название мода (до 40 знаков)');
    const version = str(json.version, 16); if (!/^\d+(\.\d+){0,3}([-+][\w.]+)?$/.test(version)) err('version: например "1.0.0"');
    const game = json.game === 'voxel' || json.game === 'tiles' || json.game === 'both' ? json.game : null;
    if (!game) err('game: "tiles" (Подземье), "voxel" (кубический мир) или "both"');
    else if (game !== 'both' && game !== forGame) err(`мод для другой игры (game: "${game}")`);
    const api = json.api === undefined ? 1 : json.api;
    if (api !== API_VERSION) (api > API_VERSION ? err : warn)(`api: ${api} (игра знает версию ${API_VERSION})`);
    const mod = { id, name, version, game, api: API_VERSION, author: str(json.author, 40), description: str(json.description, 400), blocks: [], items: [], recipes: [], worldgen: [], textures: {}, scripts: [] };
    const localIds = new Set();
    const ref = k => { k = str(k, 70); if (!k) return ''; if (k.includes(':')) return k; return localIds.has(k) ? id + ':' + k : k; };
    // текстуры
    let texBytes = 0;
    if (json.textures !== undefined && !isObj(json.textures)) err('textures — объект { имя: картинка }');
    for (const [k, v] of Object.entries(isObj(json.textures) ? json.textures : {}).slice(0, 256)) {
      if (!/^[a-z0-9_-]{1,32}$/i.test(k)) { err(`textures: имя «${k}» — латиница/цифры/«_»`); continue; }
      if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) { texBytes += v.length * .75; mod.textures[k] = { png: v }; }
      else if (typeof v === 'string' && /^[\w./-]{1,120}\.png$/i.test(v) && !v.includes('..')) {
        const f = files?.get(v.replace(/^\.\//, ''));
        if (!f) { err(`textures.${k}: нет файла ${v}`); continue; }
        texBytes += f.length || f.byteLength || 0; mod.textures[k] = { file: v };
      } else if (isObj(v) && isObj(v.draw)) {
        const d = v.draw, base = colorOf(d.base) || '#888888';
        mod.textures[k] = { draw: { pattern: PATTERNS.includes(d.pattern) ? d.pattern : ICONS.includes(d.pattern) ? d.pattern : 'stone', base, color2: colorOf(d.color2) || base, color3: colorOf(d.color3) || '#ffffff' } };
      } else err(`textures.${k}: PNG (data:image/png;base64,…), путь к .png в архиве или { "draw": {…} }`);
    }
    if (texBytes > LIM.textureBytes) err(`картинки больше ${LIM.textureBytes / 1e6} МБ`);
    // блоки
    const blocks = Array.isArray(json.blocks) ? json.blocks : []; if (json.blocks !== undefined && !Array.isArray(json.blocks)) err('blocks — список');
    if (blocks.length > LIM.blocks) err(`блоков больше ${LIM.blocks}`);
    for (const b of blocks.slice(0, LIM.blocks)) if (isObj(b) && /^[a-z0-9_-]{1,32}$/.test(b.id)) localIds.add(b.id);
    const items = Array.isArray(json.items) ? json.items : []; if (json.items !== undefined && !Array.isArray(json.items)) err('items — список');
    if (items.length > LIM.items) err(`предметов больше ${LIM.items}`);
    for (const it of items.slice(0, LIM.items)) if (isObj(it) && /^[a-z0-9_-]{1,32}$/.test(it.id)) localIds.add(it.id);
    const seen = new Set();
    blocks.slice(0, LIM.blocks).forEach((b, i) => {
      if (!isObj(b) || !/^[a-z0-9_-]{1,32}$/.test(b.id)) { err(`blocks[${i}]: нужен id (латиница)`); return; }
      if (seen.has('b:' + b.id)) { err(`blocks: id «${b.id}» дважды`); return; } seen.add('b:' + b.id);
      const tex = str(b.texture, 32) || b.id;
      if (!mod.textures[tex]) warn(`блок «${b.id}»: нет текстуры «${tex}» — будет серым`);
      mod.blocks.push({ id: b.id, key: id + ':' + b.id, name: str(b.name, 40) || b.id, texture: tex, hardness: num(b.hardness, 0, 2000, 60) | 0, tier: num(b.tier, 0, 5, 0) | 0,
        solid: b.solid !== false, transparent: !!b.transparent, light: lightOf(b.light), drop: b.drop === '' ? '' : str(b.drop, 70), falls: !!b.falls, climbable: !!b.climbable,
        burn: ['none', 'wood', 'planks', 'leaves', 'grass', 'turf', 'cloth', 'fuel', 'char'].includes(b.burn) ? b.burn : undefined,   // огонь (T-022d): как горит; нет — по полям (PZFire.burnOf)
        tool: ['pick', 'axe', 'any', 'hammer'].includes(b.tool) ? b.tool : b.solid === false ? 'any' : 'pick' });
    });
    items.slice(0, LIM.items).forEach((it, i) => {
      if (!isObj(it) || !/^[a-z0-9_-]{1,32}$/.test(it.id)) { err(`items[${i}]: нужен id (латиница)`); return; }
      if (seen.has('i:' + it.id)) { err(`items: id «${it.id}» дважды`); return; } seen.add('i:' + it.id);
      const o = { id: it.id, key: id + ':' + it.id, name: str(it.name, 40) || it.id, texture: str(it.texture, 32) || it.id, stack: num(it.stack, 1, 999, 99) | 0, use: !!it.use };
      if (it.places !== undefined) { const p = str(it.places, 32); if (!blocks.some(b => b && b.id === p)) err(`предмет «${it.id}»: places — блок этого мода`); else o.places = id + ':' + p; }
      if (isObj(it.tool)) o.tool = { type: ['pickaxe', 'axe', 'hammer'].includes(it.tool.type) ? it.tool.type : 'pickaxe', power: num(it.tool.power, 1, 300, 40) | 0, tier: num(it.tool.tier, 0, 6, 1) | 0, speed: num(it.tool.speed, .1, 2, .25) };
      if (isObj(it.weapon)) o.weapon = { damage: num(it.weapon.damage, 1, 300, 10) | 0, speed: num(it.weapon.speed, .1, 2, .3), reach: num(it.weapon.reach, 1, 5, 2.6) };
      if (it.heal !== undefined) o.heal = num(it.heal, 1, 200, 20) | 0;
      mod.items.push(o);
    });
    // рецепты
    const recipes = Array.isArray(json.recipes) ? json.recipes : []; if (json.recipes !== undefined && !Array.isArray(json.recipes)) err('recipes — список');
    if (recipes.length > LIM.recipes) err(`рецептов больше ${LIM.recipes}`);
    recipes.slice(0, LIM.recipes).forEach((r, i) => {
      if (!isObj(r)) { err(`recipes[${i}] — объект`); return; }
      const out = ref(r.result);
      if (!out) { err(`recipes[${i}]: нет result`); return; }
      const ing = Array.isArray(r.ingredients) ? r.ingredients.filter(x => Array.isArray(x) && typeof x[0] === 'string').slice(0, 8).map(([k, n]) => [ref(k), num(n, 1, 999, 1) | 0]) : [];
      if (!ing.length) { err(`recipes[${i}]: ingredients — [["дерево", 2], …]`); return; }
      const st = r.station === undefined || r.station === null || r.station === '' ? null : ['workbench', 'furnace', 'anvil'].includes(r.station) ? r.station : (err(`recipes[${i}]: station — workbench, furnace, anvil или пусто`), null);
      mod.recipes.push({ o: out, n: num(r.count, 1, 999, 1) | 0, i: ing, st });
    });
    // генерация
    const wg = Array.isArray(json.worldgen) ? json.worldgen : []; if (json.worldgen !== undefined && !Array.isArray(json.worldgen)) err('worldgen — список');
    if (wg.length > LIM.worldgen) err(`worldgen больше ${LIM.worldgen}`);
    wg.slice(0, LIM.worldgen).forEach((f, i) => {
      if (!isObj(f)) return;
      const b = str(f.block, 32);
      if (!blocks.some(x => x && x.id === b)) { err(`worldgen[${i}]: block — блок этого мода`); return; }
      const minD = num(f.minDepth, -300, 1e6, 0), maxD = num(f.maxDepth, minD, 1e7, 1e6);
      if (f.type === 'ore') mod.worldgen.push({ type: 'ore', block: id + ':' + b, minDepth: minD, maxDepth: maxD, size: num(f.size, 2, 24, 6), rarity: num(f.rarity, .01, 1, .5), in: (Array.isArray(f.in) ? f.in : ['stone', 'deepstone']).slice(0, 8).map(String) });
      else if (f.type === 'scatter') mod.worldgen.push({ type: 'scatter', block: id + ':' + b, minDepth: minD, maxDepth: maxD, chance: num(f.chance, .0001, .5, .01), on: (Array.isArray(f.on) ? f.on : ['grass']).slice(0, 8).map(String) });
      else err(`worldgen[${i}]: type — "ore" или "scatter"`);
    });
    // скрипты
    const scripts = Array.isArray(json.scripts) ? json.scripts : []; if (json.scripts !== undefined && !Array.isArray(json.scripts)) err('scripts — список');
    if (scripts.length > LIM.scripts) err(`скриптов больше ${LIM.scripts}`);
    scripts.slice(0, LIM.scripts).forEach((s, i) => {
      if (!isObj(s)) return;
      const lang = s.lang === 'lua' ? 'lua' : s.lang === 'js' || s.lang === undefined ? 'js' : null;
      if (!lang) { err(`scripts[${i}]: lang — "js" или "lua"`); return; }
      let code = typeof s.code === 'string' ? s.code : null;
      if (code === null && typeof s.file === 'string') { const f = files?.get(s.file.replace(/^\.\//, '')); if (typeof f === 'string') code = f; else if (f) code = new TextDecoder().decode(f); else { err(`scripts[${i}]: нет файла ${s.file}`); return; } }
      if (code === null) { err(`scripts[${i}]: code или file`); return; }
      if (code.length > LIM.scriptBytes) { err(`scripts[${i}]: больше ${LIM.scriptBytes / 1000} КБ`); return; }
      mod.scripts.push({ lang, name: str(s.file, 60) || `script${i + 1}.${lang}`, code });
    });
    if (!mod.blocks.length && !mod.items.length && !mod.recipes.length && !mod.scripts.length) warn('мод пустой: нет блоков, предметов, рецептов и скриптов');
    return { ok: !errors.length, errors, warnings, mod: errors.length ? null : mod };
  }

  // ═══ Чтение: .d37mod / .zip, .json или папка ═══
  async function inflate(u){
    if (typeof DecompressionStream === 'undefined') throw new Error('браузер не распаковывает .zip со сжатием — распакуй архив и выбери папку');
    const s = new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function unzip(buf){
    const u = new Uint8Array(buf), dv = new DataView(buf);
    let e = -1;
    for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('это не zip-архив');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    if (n > LIM.files) throw new Error(`в архиве больше ${LIM.files} файлов`);
    const out = new Map(); let total = 0;
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('битый архив');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith('/')) continue;
      if (name.includes('..') || name.startsWith('/')) throw new Error('в архиве странный путь: ' + name);
      total += usize; if (total > LIM.zipBytes) throw new Error(`архив больше ${LIM.zipBytes / 1e6} МБ`);
      const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), data = u.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      const bytes = method === 0 ? data.slice() : method === 8 ? await inflate(data) : null;
      if (!bytes) throw new Error('неизвестное сжатие в архиве: ' + name);
      out.set(name, bytes);
    }
    // общая папка верхнего уровня (mod/mod.json) — убрать
    const names = [...out.keys()], top = names.every(x => x.includes('/')) ? names[0].split('/')[0] + '/' : '';
    if (top && names.every(x => x.startsWith(top))) { const m2 = new Map(); for (const [k, v] of out) m2.set(k.slice(top.length), v); return m2; }
    return out;
  }
  const TEXT = /\.(json|js|lua|txt|md)$/i;
  function asFiles(map){ const out = new Map(); for (const [k, v] of map) out.set(k, TEXT.test(k) ? new TextDecoder().decode(v) : v); return out; }
  // file: File (.d37mod/.zip/.json) или FileList (папка) → { json, files }
  async function read(input){
    if (input && typeof input.length === 'number' && !(input instanceof Blob)) {   // папка
      const raw = new Map();
      for (const f of [...input].slice(0, LIM.files)) {
        const p = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
        if (f.size > LIM.zipBytes) throw new Error('файл слишком большой: ' + p);
        raw.set(p, new Uint8Array(await f.arrayBuffer()));
      }
      const files = asFiles(raw), j = files.get('mod.json');
      if (!j) throw new Error('в папке нет mod.json');
      return { json: JSON.parse(j), files };
    }
    const f = input;
    if (!f) throw new Error('нет файла');
    if (f.size > LIM.zipBytes) throw new Error(`файл больше ${LIM.zipBytes / 1e6} МБ`);
    const buf = await f.arrayBuffer(), u = new Uint8Array(buf);
    if (u[0] === 0x50 && u[1] === 0x4b) { const files = asFiles(await unzip(buf)), j = files.get('mod.json'); if (!j) throw new Error('в архиве нет mod.json'); return { json: JSON.parse(j), files }; }
    return { json: JSON.parse(new TextDecoder().decode(u)), files: new Map() };
  }

  // ═══ Песочница: то, что работает ВНУТРИ потока (ничего снаружи не видит) ═══
  function modRuntime(){
    'use strict';
    const send = (t, d) => postMessage(Object.assign({ t }, d || {}));
    const EVENTS = ['tileBreak', 'tilePlace', 'use', 'tick', 'mobKill', 'pickup', 'talk', 'command', 'start'];
    const ALIAS = { onTileBreak: 'tileBreak', onTilePlace: 'tilePlace', onUse: 'use', onTick: 'tick', onMobKill: 'mobKill', onPickup: 'pickup', onTalk: 'talk', onCommand: 'command', onStart: 'start' };
    const H = Object.create(null), CMDS = Object.create(null);
    let NAMES = [], WNAMES = [], VIEW = null, ST = { time: 0, night: false, day: 1, x: 0, y: 0, hp: 0, maxHp: 0 }, budget = 0, LIMIT = 400, LINE0 = 0;
    const lineOf = e => { const m = /<anonymous>:(\d+):\d+/.exec(String(e && e.stack || '')) || /Function:(\d+):\d+/.exec(String(e && e.stack || '')); return m ? Math.max(0, +m[1] - LINE0) : 0; };
    const fail = (e, where) => send('error', { msg: String(e && e.message || e).slice(0, 300), line: lineOf(e), where: where || '' });
    function act(c){
      if (++budget > LIMIT) { if (budget === LIMIT + 1) send('error', { msg: 'слишком много действий за одно событие (больше ' + LIMIT + ')' }); return false; }
      send('cmd', { c });
      return true;
    }
    const inView = (x, y) => VIEW && x >= VIEW.x0 && y >= VIEW.y0 && x < VIEW.x0 + VIEW.w && y < VIEW.y0 + VIEW.h;
    const vi = (x, y) => (y - VIEW.y0) * VIEW.w + (x - VIEW.x0);
    const nameIdx = new Map();
    const mod = Object.freeze({
      api: 1,
      get id(){ return ST.mod; },
      on(ev, fn){ ev = ALIAS[ev] || ev; if (!EVENTS.includes(ev)) throw new Error('нет события «' + ev + '» (есть: ' + EVENTS.join(', ') + ')'); if (typeof fn !== 'function') throw new Error('mod.on: вторым нужна функция'); (H[ev] || (H[ev] = [])).push(fn); send('want', { ev }); },
      log(...a){ send('log', { text: a.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ').slice(0, 300) }); },
    });
    const world = Object.freeze({
      get(x, y){ x = Math.floor(x); y = Math.floor(y); if (!inView(x, y)) return null; return NAMES[VIEW.fg[vi(x, y)]] || 'air'; },
      wall(x, y){ x = Math.floor(x); y = Math.floor(y); if (!inView(x, y)) return null; return WNAMES[VIEW.wall[vi(x, y)]] || 'none'; },
      liquid(x, y){ x = Math.floor(x); y = Math.floor(y); if (!inView(x, y) || !VIEW.lq[vi(x, y)]) return null; return VIEW.lt[vi(x, y)] === 2 ? 'lava' : 'water'; },
      set(x, y, name){
        x = Math.floor(x); y = Math.floor(y); name = String(name);
        if (inView(x, y)) { const n = nameIdx.get(name); if (n !== undefined) VIEW.fg[vi(x, y)] = n; else if (name === 'air') VIEW.fg[vi(x, y)] = 0; }
        return act({ c: 'set', x, y, tile: name.slice(0, 70) });
      },
      setWall(x, y, name){ return act({ c: 'wall', x: Math.floor(x), y: Math.floor(y), wall: String(name).slice(0, 70) }); },
      isNight(){ return !!ST.night; },
      time(){ return ST.time; },
      day(){ return ST.day; },
      view(){ return VIEW ? { x0: VIEW.x0, y0: VIEW.y0, w: VIEW.w, h: VIEW.h } : null; },
    });
    const fx = Object.freeze({
      particles(x, y, kind, n, color){ return act({ c: 'parts', x: +x, y: +y, kind: String(kind || 'spark').slice(0, 16), n: Math.max(1, Math.min(60, n | 0 || 10)), color: typeof color === 'string' ? color.slice(0, 7) : '' }); },
      sound(name, vol){ return act({ c: 'sound', name: String(name).slice(0, 24), vol: +vol || 1 }); },
      text(x, y, text, color){ return act({ c: 'text', x: +x, y: +y, text: String(text).slice(0, 60), color: typeof color === 'string' ? color.slice(0, 7) : '' }); },
      shake(power){ return act({ c: 'shake', s: Math.max(0, Math.min(1, +power || .3)) }); },
    });
    const npc = Object.freeze({
      say(text){ return act({ c: 'say', text: String(text).slice(0, 200) }); },
      addLine(text){ return act({ c: 'line', text: String(text).slice(0, 200) }); },
    });
    const commands = Object.freeze({
      add(name, desc, fn){ name = String(name).toLowerCase().replace(/^\//, ''); if (!/^[a-zа-яё0-9_-]{1,20}$/.test(name)) throw new Error('commands.add: имя команды — буквы и цифры, до 20'); if (typeof fn !== 'function') throw new Error('commands.add: третьим нужна функция'); CMDS[name] = fn; send('cmdAdd', { name, desc: String(desc || '').slice(0, 80) }); },
    });
    const player = Object.freeze({
      get x(){ return ST.x; }, get y(){ return ST.y; }, get hp(){ return ST.hp; }, get maxHp(){ return ST.maxHp; },
      give(item, n){ return act({ c: 'give', item: String(item).slice(0, 70), n: Math.max(1, Math.min(999, n | 0 || 1)) }); },
      heal(n){ return act({ c: 'heal', n: Math.max(1, Math.min(50, n | 0 || 1)) }); },
      message(text){ return act({ c: 'msg', text: String(text).slice(0, 120) }); },
    });
    const game = Object.freeze({
      get time(){ return ST.time; }, get night(){ return !!ST.night; }, get day(){ return ST.day; },
      spawn(mob, x, y){ return act({ c: 'spawn', mob: String(mob).slice(0, 20), x: +x, y: +y }); },
    });
    const API = Object.freeze({ mod, world, fx, npc, commands, player, game });
    function fire(ev, data){
      const list = H[ev]; if (!list) return;
      budget = 0;
      const e = Object.freeze(Object.assign({ type: ev }, data));
      for (const fn of list) { try { const r = fn(e); if (r && typeof r.catch === 'function') r.catch(er => fail(er, ev)); } catch (er) { fail(er, ev); } }
    }
    onmessage = ev => {
      const d = ev.data || {};
      if (d.t === 'ping') { postMessage({ t: 'pong' }); return; }
      if (d.t === 'init') {
        NAMES = d.names || []; WNAMES = d.wnames || []; ST.mod = d.id; LIMIT = d.limit || 400;
        NAMES.forEach((n, i) => { if (n) nameIdx.set(n, i); });
        try { new Function('throw new Error("x")')(); } catch (e2) { const m = /<anonymous>:(\d+):\d+/.exec(String(e2.stack)) || /Function:(\d+):\d+/.exec(String(e2.stack)); LINE0 = m ? +m[1] : 0; }
        for (const s of d.scripts || []) {
          budget = 0;
          if (s.lang === 'lua') {
            try {
              if (!globalThis.D37Lang || !globalThis.D37Lang.lua) (0, eval)(d.luaSrc);
              const L = globalThis.D37Lang.lua;
              // окружение: те же объекты, что у JS; строка 1 — объявления (номера строк не сдвигаются)
              const pre = 'local mod, world, fx, npc, commands, player, game = script.mod, script.world, script.fx, script.npc, script.commands, script.player, script.game; ';
              L.run(pre + s.code, { script: API, print: (...a) => mod.log(...a), warn: (...a) => mod.log('⚠', ...a) }, { name: s.name, error: (msg, line) => send('error', { msg: String(msg).slice(0, 300), line: line | 0, where: s.name }), err: e => fail(e, s.name), setCurrent(){} });
            } catch (e) { fail(e, s.name); }
            continue;
          }
          try { new Function('mod', 'world', 'fx', 'npc', 'commands', 'player', 'game', 'print', '"use strict";\n' + s.code)(mod, world, fx, npc, commands, player, game, (...a) => mod.log(...a)); }
          catch (e) { fail(e, s.name); }
        }
        send('ready');
        return;
      }
      if (d.t === 'ev') {
        if (d.view) VIEW = d.view;
        if (d.st) Object.assign(ST, d.st);
        if (d.ev === 'command') {
          const fn = CMDS[d.name]; if (!fn) return;
          budget = 0;
          try { const r = fn(d.args || []); if (r && r.catch) r.catch(er => fail(er, '/' + d.name)); } catch (er) { fail(er, '/' + d.name); }
          return;
        }
        fire(d.ev, d.data || {});
      }
    };
  }
  // iframe: CSP без сети; внутри — поток с runtime; iframe пересылает сообщения и следит, не завис ли поток (3 с)
  function frameHtml(){
    const csp = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
let w = null, last = Date.now(), dead = false;
const up = m => parent.postMessage(m, '*');
addEventListener('message', e => {
  if (e.source !== parent) return;
  const d = e.data || {};
  if (d.t === 'boot') {
    try { w = new Worker(URL.createObjectURL(new Blob(['(' + d.code + ')()'], { type: 'text/javascript' }))); }
    catch (er) { up({ t: 'error', msg: 'не запустился: ' + er.message, line: 0 }); return; }
    w.onmessage = ev => { last = Date.now(); if (ev.data && ev.data.t !== 'pong') up(ev.data); };
    w.onerror = ev => { up({ t: 'error', msg: ev.message || 'ошибка', line: ev.lineno || 0 }); ev.preventDefault(); };
    last = Date.now();
    setInterval(() => { if (dead || !w) return; w.postMessage({ t: 'ping' }); if (Date.now() - last > 3000) { dead = true; w.terminate(); up({ t: 'hang' }); } }, 700);
    return;
  }
  if (w && !dead) w.postMessage(d);
});
up({ t: 'frame' });
<\/script>`;
  }

  // ═══ Хост: моды мира — регистрация данных, песочницы, события и проверка действий ═══
  const ALLOWED_SOUNDS = ['coin', 'pickup', 'hit', 'break', 'click', 'jump', 'land', 'buzz', 'door_wood_open', 'door_wood_close', 'build_wood', 'build_metal', 'dig', 'digstone', 'place', 'swing', 'magic', 'roar', 'shoot', 'splash', 'squish', 'craft', 'levelup', 'drink'];
  const PART_KINDS = { spark: [0xffd84a, 1, -.2], magic: [0xff8af0, 1, -.5], fire: [0xff7a20, 1, -.6], smoke: [0x888888, 0, -.3], dust: [0xb09070, 0, 1], heart: [0xff3a5a, 1, -.4], water: [0x6aa8ff, 0, 1], star: [0xfff2a0, 1, 0] };
  const GIVE_OK = new Set(['dirt', 'stone', 'wood', 'torch', 'gel', 'sand', 'glass', 'platform', 'rope', 'mushroom']);
  function attach(G, API){
    const PZ = API.PZ, boxes = new Map();   // id мода → { frame, onMsg, errors, off, want, lines, cmds, rate }
    let active = [];                          // моды мира (очищенные манифесты)
    const store = { list: () => API.dbAll('mods').catch(() => []) };
    // ── регистрация данных модов в ядре; старые моды — убрать ──
    function resetCore(){
      for (let id = PZ.MOD_ID0; id < 256; id++) {
        const t = PZ.TILES[id]; if (t) { delete PZ.TILE[t.key]; PZ.TILES[id] = undefined; }
        for (const k of Object.keys(PZ.P)) PZ.P[k][id] = 0;
      }
      G.modItems = null; G.modRecipes = null; G.modTiles = null; G.modProps = null; G.modFeats = null; G.modAtlas = null; G.modLines = []; G.modCmds = [];
      PZ.setFeats([]);
    }
    async function loadImg(src){ const im = new Image(); im.src = src; await im.decode(); return im; }
    async function start(W){
      stop(); resetCore();
      const ids = (W.mods || []).slice(0, 16);
      if (!ids.length) return;
      const all = await store.list(), byId = new Map(all.map(m => [m.id, m]));
      active = [];
      for (const id of ids) {
        const rec = byId.get(id);
        if (!rec) { API.toast(`🧩 Мод «${id}» не установлен — мир без него`, 'bad'); continue; }
        const v = validate(rec.json, new Map(Object.entries(rec.files || {})), 'tiles');
        if (!v.ok) { API.toast(`🧩 Мод «${id}»: ${v.errors[0]}`, 'bad'); continue; }
        v.mod.files = rec.files || {};
        active.push(v.mod);
      }
      const pal = W.palette = W.palette || {};
      const used = new Set(Object.values(pal));
      const nextId = () => { for (let i = PZ.MOD_ID0; i < 255; i++) if (!used.has(i)) { used.add(i); return i; } return 0; };
      const props = {}, feats = [], atlasTiles = [], atlasItems = [], items = {}, recipes = [], tiles = {};
      for (const M of active) {
        const tex = async name => {
          const t = M.textures[name]; if (!t) return null;
          try {
            if (t.png) return { img: await loadImg(t.png) };
            if (t.file) { const b = M.files[t.file]; const u = URL.createObjectURL(new Blob([b instanceof Uint8Array ? b : new Uint8Array(Object.values(b))], { type: 'image/png' })); const im = await loadImg(u); URL.revokeObjectURL(u); return { img: im }; }
            if (t.draw) return { draw: t.draw };
          } catch (e) { API.toast(`🧩 ${M.name}: картинка «${name}» не открылась`, 'bad'); }
          return null;
        };
        for (const b of M.blocks) {
          let id = pal[b.key];
          if (!id) { id = nextId(); if (!id) { API.toast('🧩 Слишком много блоков модов (больше 95)', 'bad'); break; } pal[b.key] = id; }
          const tx = await tex(b.texture);
          const s = b.solid ? 1 : 0, op = b.transparent ? (s ? 2 : 0) : s ? 1 : 0;
          const tile = PZ.defTile(id, b.key, b.name, { s, op, h: b.hardness, t: b.tier, tool: b.tool, d: b.drop === '' ? '' : b.drop ? (b.drop.includes(':') ? b.drop : M.items.some(i => i.id === b.drop) ? M.id + ':' + b.drop : b.drop) : b.key, k: s ? 'block' : 'plant', l: b.light || undefined, emis: b.light ? 180 : 0, fall: b.falls, climb: b.climbable, burn: b.burn, g: 40 + (id % 200), c: tx?.draw ? [tx.draw.base, tx.draw.color2, tx.draw.color3] : ['#8a8a96', '#6a6a76', '#aaaab6'], pat: tx?.draw?.pattern && PATTERNS.includes(tx.draw.pattern) ? tx.draw.pattern : 'stone', mod: M.id });
          tiles[id] = tile;
          props[id] = { s, op, l: b.light || null, h: b.hardness, t: b.tier, tool: PZ.TOOLS[b.tool] ?? 0, k: s ? 0 : 2, emis: b.light ? 180 : 0, fall: b.falls, climb: b.climbable, g: tile.g };
          atlasTiles.push({ id, key: b.key, pat: tile.pat, c: tile.c, img: tx?.img || null, k: 'block' });
          // предмет-блок, если мод его не описал
          if (!M.items.some(i => i.places === b.key) && !M.items.some(i => i.id === b.id)) items[b.key] = { key: b.key, name: b.name, kind: 'tile', tileId: id, stack: 999, mod: M.name };
        }
        for (const it of M.items) {
          const tx = await tex(it.texture);
          const o = { key: it.key, name: it.name, kind: 'mat', stack: it.stack, mod: M.name, modId: M.id, use: it.use ? 'script' : undefined };
          if (it.places) { o.kind = 'tile'; o.tileId = pal[it.places]; }
          else if (it.tool) Object.assign(o, { kind: 'tool', tool: it.tool.type === 'pickaxe' ? 'pick' : it.tool.type, power: it.tool.power, tier: it.tool.tier, speed: it.tool.speed, stack: 1 });
          else if (it.weapon) Object.assign(o, { kind: 'melee', dmg: it.weapon.damage, speed: it.weapon.speed, reach: it.weapon.reach, stack: 1 });
          else if (it.heal) Object.assign(o, { kind: 'use', use: 'heal', heal: it.heal });
          else if (it.use) Object.assign(o, { kind: 'use', use: 'script' });
          if (tx?.draw && ICONS.includes(tx.draw.pattern)) o.icon = [tx.draw.pattern, tx.draw.base];
          else if (tx?.draw) o.icon = ['bar', tx.draw.base];
          if (tx?.img) o.img = tx.img;
          items[it.key] = o;
          atlasItems.push(o);
        }
        for (const b of M.blocks) if (items[b.key]) atlasItems.push(items[b.key]);
        recipes.push(...M.recipes);
        for (const f of M.worldgen) {
          const id = pal[f.block]; if (!id) continue;
          const toIds = list => list.map(k => (PZ.TILE[k] || PZ.TILE[k.includes(':') ? k : M.id + ':' + k])?.id).filter(Boolean);
          const minY = Math.round(PZ.SURF + f.minDepth * 2), maxY = Math.round(PZ.SURF + f.maxDepth * 2);   // глубина в метрах → клетки (1 клетка = 0,5 м)
          if (f.type === 'ore') feats.push({ type: 'ore', id, minY, maxY, scale: 1 / f.size * .9, thr: .52 - f.rarity * .14, seed: 1000 + id, host: toIds(f.in) });   // как руды игры: 0,38 (часто) … 0,52 (редко)
          else feats.push({ type: 'scatter', id, minY, maxY, chance: f.chance, seed: 2000 + id, on: toIds(f.on) });
        }
      }
      G.modTiles = tiles; G.modProps = props; G.modFeats = feats; G.modItems = items; G.modRecipes = recipes.filter(r => API.itemDef(r.o) || items[r.o]);
      G.modAtlas = { tiles: atlasTiles, items: atlasItems };
      PZ.setFeats(feats);
      // скрипты — песочницы
      let lua = null;
      for (const M of active) {
        if (!M.scripts.length) continue;
        if (M.scripts.some(s => s.lang === 'lua') && !lua) {
          if (!window.D37E?.langs?.lua?.worker && typeof gamesLoadScript === 'function') { try { await gamesLoadScript('js/engine/lang-lua.js'); } catch (e) {} }
          const L = window.D37E?.langs?.lua;
          lua = L?.worker ? '(' + L.worker.toString() + ')();' : '';
          if (!lua) API.toast('🧩 Lua не загрузился — Lua-скрипты модов выключены', 'bad');
        }
        boot(M, lua);
      }
    }
    // имена блоков по номерам (для world.get внутри мода)
    const names = () => { const a = []; for (let i = 0; i < 256; i++) a[i] = PZ.TILES[i]?.key || (i ? '' : 'air'); return a; };
    const wnames = () => PZ.WALLS.map(w => w ? w.key : '');
    function boot(M, lua){
      const box = { M, frame: null, onMsg: null, errors: 0, want: new Set(), ready: false, queue: [], rate: { t: 0, n: 0, give: 0, msg: 0, say: 0, spawn: 0 }, log: [] };
      const fr = document.createElement('iframe');
      fr.setAttribute('sandbox', 'allow-scripts'); fr.style.display = 'none'; fr.title = 'мод ' + M.id;
      fr.srcdoc = frameHtml();
      box.frame = fr;
      box.onMsg = e => {
        if (e.source !== fr.contentWindow) return;
        const d = e.data || {};
        if (d.t === 'frame') {
          fr.contentWindow.postMessage({ t: 'boot', code: modRuntime.toString() }, '*');
          fr.contentWindow.postMessage({ t: 'init', id: M.id, names: names(), wnames: wnames(), limit: LIM.perMod, luaSrc: lua || '', scripts: M.scripts.filter(s => s.lang === 'js' || lua).map(s => ({ lang: s.lang, name: s.name, code: s.code })) }, '*');
          box.ready = true; for (const m of box.queue) fr.contentWindow.postMessage(m, '*'); box.queue = [];
          return;
        }
        if (d.t === 'want') { box.want.add(d.ev); return; }
        if (d.t === 'ready') { post(box, { t: 'ev', ev: 'start', data: {}, st: state() }); return; }
        if (d.t === 'log') { pushLog(box, d.text); return; }
        if (d.t === 'cmdAdd') { if ((G.modCmds || []).length < 40 && !G.modCmds.includes(d.name)) { G.modCmds.push(d.name); box.cmds = (box.cmds || new Set()).add(d.name); } return; }
        if (d.t === 'error') { box.errors++; pushLog(box, `❌ ${d.where ? d.where + ': ' : ''}${d.line ? 'строка ' + d.line + ': ' : ''}${d.msg}`); if (box.errors >= 5) disable(box, d.msg); else if (box.errors === 1) API.toast(`🧩 ${M.name}: ошибка — ${String(d.msg).slice(0, 80)}`, 'bad'); return; }
        if (d.t === 'hang') { disable(box, 'завис (бесконечный цикл?)'); return; }
        if (d.t === 'cmd') { try { apply(box, d.c); } catch (er) { pushLog(box, '❌ ' + er.message); } return; }
      };
      window.addEventListener('message', box.onMsg);
      document.body.appendChild(fr);
      boxes.set(M.id, box);
    }
    function pushLog(box, t){ box.log.push(String(t).slice(0, 300)); if (box.log.length > 50) box.log.shift(); if (G.opt?.fps) console.log('[мод ' + box.M.id + ']', t); }
    function disable(box, why){
      if (box.off) return;
      box.off = true;
      API.toast(`🧩 Мод «${box.M.name}» выключен: ${String(why).slice(0, 90)}`, 'bad');
      pushLog(box, '⛔ выключен: ' + why);
      kill(box);
    }
    function kill(box){ window.removeEventListener('message', box.onMsg); box.frame?.remove(); box.frame = null; box.ready = false; }
    function post(box, m){ if (box.off || !box.frame) return; if (box.ready && box.frame.contentWindow) box.frame.contentWindow.postMessage(m, '*'); else if (box.queue.length < 200) box.queue.push(m); }
    function stop(){ for (const b of boxes.values()) kill(b); boxes.clear(); active = []; }
    const state = () => { const p = G.pl, W = G.W; return p ? { time: +W.time.toFixed(4), night: API.isNight(), day: W.day || 1, x: +(p.x + p.w / 2).toFixed(2), y: +(p.y + p.h).toFixed(2), hp: G.CH.hp | 0, maxHp: G.CH.maxHp } : {}; };
    // «окно» мира вокруг (cx, cy): блоки, стены, жидкости
    function view(cx, cy, rw, rh){
      const x0 = Math.floor(cx) - rw, y0 = Math.max(0, Math.floor(cy) - rh), w = rw * 2 + 1, h = rh * 2 + 1;
      const fg = new Uint8Array(w * h), wall = new Uint8Array(w * h), lq = new Uint8Array(w * h), lt = new Uint8Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = x0 + i, y = y0 + j, k = j * w + i, f = API.fgAt(x, y); fg[k] = f === 255 && !G.chunks.get(PZ.key(x >> 6, y >> 6)) ? 0 : f; wall[k] = API.wallAt(x, y); lq[k] = API.lqAt(x, y); lt[k] = API.ltAt(x, y); }
      return { x0, y0, w, h, fg, wall, lq, lt };
    }
    function emit(ev, data){
      if (!boxes.size) return;
      let v = null;
      for (const box of boxes.values()) {
        if (box.off || !box.want.has(ev)) continue;
        if (!v && data && data.x !== undefined) v = view(data.x, data.y, 16, 16);
        post(box, { t: 'ev', ev, data, view: v || undefined, st: state() });
      }
    }
    function tick(){
      if (!boxes.size || !G.pl) return;
      let v = null;
      for (const box of boxes.values()) {
        if (box.off || !box.want.has('tick')) continue;
        if (!v) v = view(G.pl.x + G.pl.w / 2, G.pl.y + G.pl.h / 2, 32, 24);
        post(box, { t: 'ev', ev: 'tick', data: { dt: .5 }, view: v, st: state() });
      }
      // раз в секунду — счётчики лимитов
      const now = Date.now();
      for (const box of boxes.values()) if (now - box.rate.t > 1000) box.rate = { t: now, n: 0, give: box.rate.give * .9, msg: 0, say: box.rate.say, spawn: box.rate.spawn * .9 };
    }
    function command(name, args){
      for (const box of boxes.values()) if (!box.off && box.cmds?.has(name)) { const p = G.pl; post(box, { t: 'ev', ev: 'command', name, args, view: view(p.x + p.w / 2, p.y + p.h / 2, 32, 24), st: state() }); return true; }
      return false;
    }
    // ── действие мода → игра (всё проверяется) ──
    function apply(box, c){
      if (!c || typeof c !== 'object' || box.off) return;
      const R = box.rate;
      if (++R.n > 600) { if (R.n === 601) pushLog(box, '⚠ больше 600 действий в секунду — лишние пропущены'); return; }
      const p = G.pl, near = (x, y, r = 64) => p && Math.abs(x - (p.x + p.w / 2)) <= r && Math.abs(y - (p.y + p.h / 2)) <= r;
      const tileId = name => { if (name === 'air') return 0; const t = PZ.TILE[name] || PZ.TILE[box.M.id + ':' + name]; return t ? t.id : -1; };
      switch (c.c) {
        case 'set': {
          const x = c.x | 0, y = c.y | 0, id = tileId(c.tile);
          if (id < 0) { pushLog(box, `⚠ world.set: нет блока «${c.tile}»`); return; }
          if (!near(x, y) || y < 0) return;
          const cur = API.fgAt(x, y); if (cur === 255) return;
          if (cur && PZ.P.KIND[cur] === 1) return;            // предметы из нескольких клеток (сундуки, двери) моды не трогают
          if (id && PZ.P.KIND[id] === 1) return;
          API.setCell(x, y, id, 0, null, id && PZ.P.SOLID[id] === 1 ? 0 : null);
          return;
        }
        case 'wall': {
          const x = c.x | 0, y = c.y | 0, w = c.wall === 'none' ? 0 : (PZ.WALL[c.wall] || PZ.WALL[box.M.id + ':' + c.wall])?.id;
          if (w === undefined || !near(x, y)) return;
          API.setCell(x, y, null, null, w);
          return;
        }
        case 'parts': { if (!near(c.x, c.y, 80)) return; const k = PART_KINDS[c.kind] || PART_KINDS.spark, col = /^#[0-9a-f]{6}$/i.test(c.color) ? parseInt(c.color.slice(1), 16) : k[0]; API.burst(c.x, c.y, Math.min(60, c.n | 0), col, 5, .7, .16, k[2], k[1]); return; }
        case 'sound': if (ALLOWED_SOUNDS.includes(c.name)) API.snd(c.name, { vol: Math.max(0, Math.min(1, +c.vol || 1)) }); return;
        case 'text': if (near(c.x, c.y, 80)) API.floatText(c.x, c.y, c.text, /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#fff'); return;
        case 'shake': G.cam.shake = Math.max(G.cam.shake, Math.min(1, +c.s || 0)); return;
        case 'say': if (Date.now() - (R.sayAt || 0) > 1500) { R.sayAt = Date.now(); G.U?.talk('Проводник', String(c.text)); } return;
        case 'line': if ((box.lines = (box.lines || 0) + 1) <= 20) G.modLines.push(String(c.text).slice(0, 200)); return;
        case 'give': {
          const own = API.itemDef(c.item) && (String(c.item).startsWith(box.M.id + ':') || GIVE_OK.has(c.item));
          const key = own ? c.item : API.itemDef(box.M.id + ':' + c.item) ? box.M.id + ':' + c.item : null;
          if (!key) { pushLog(box, `⚠ player.give: можно давать только предметы своего мода и простые (${[...GIVE_OK].join(', ')})`); return; }
          if ((R.give += c.n) > 2000) return;
          API.give(key, Math.min(999, c.n | 0), p.x, p.y);
          return;
        }
        case 'heal': if (G.CH && (R.healAt || 0) + 500 < Date.now()) { R.healAt = Date.now(); G.CH.hp = Math.min(G.CH.maxHp, G.CH.hp + Math.min(50, c.n | 0)); G.U?.hud(); } return;
        case 'msg': if (R.msg++ < 2) API.toast(`🧩 ${String(c.text).slice(0, 120)}`, 'info'); return;
        case 'spawn': {
          const D = API.MOBS[c.mob];
          if (!D || D.boss || !near(c.x, c.y, 50) || R.spawn > 6) return;
          R.spawn++; API.spawnMob(c.mob, +c.x, +c.y); return;
        }
      }
    }
    // предмет мода «use: true» — событие use
    G.modsUse = (key, x, y) => { for (const box of boxes.values()) if (!box.off && key.startsWith(box.M.id + ':') && box.want.has('use')) { post(box, { t: 'ev', ev: 'use', data: { item: key, x, y }, view: view(x, y, 16, 16), st: state() }); return true; } return false; };
    G.modsStart = start; G.modsStop = stop; G.modsEmit = emit; G.modsTick = tick; G.modsCommand = command; G.modLines = []; G.modCmds = [];
    G.modsInfo = () => [...boxes.values()].map(b => ({ id: b.M.id, name: b.M.name, off: !!b.off, errors: b.errors, log: b.log.slice() }));
    return { start, stop, emit, tick, command, boxes, active: () => active };
  }

  // ═══ Меню модов ═══
  const EXAMPLES = [
    { id: 'ruby-glow', path: 'mods/podzem/ruby-glow/', files: ['mod.json', 'main.js'], name: 'Светящиеся рубины', lang: 'JS' },
    { id: 'starfall', path: 'mods/podzem/starfall/', files: ['mod.json', 'main.lua'], name: 'Звездопад', lang: 'Lua' },
  ];
  async function installed(API){ try { return (await API.dbAll('mods')).map(r => ({ id: r.id, name: r.json.name, version: r.json.version, author: r.json.author, game: r.json.game, description: r.json.description })); } catch (e) { return []; } }
  async function install(API, json, files){
    const v = validate(json, files, 'tiles');
    if (!v.ok) return v;
    const fobj = {};
    for (const [k, val] of files || []) fobj[k] = val;
    await API.put('mods', { id: v.mod.id, json, files: fobj, at: Date.now() });
    return v;
  }
  async function installExample(API, ex){
    const files = new Map();
    for (const f of ex.files) { const r = await fetch(ex.path + f, { cache: 'no-cache' }); if (!r.ok) throw new Error('не скачался ' + f); files.set(f, await r.text()); }
    return install(API, JSON.parse(files.get('mod.json')), files);
  }
  async function renderMenu(card, API, worldMode, back){
    const G = API.G;
    const list = await installed(API);
    if (worldMode) {
      const usable = list.filter(m => m.game === 'tiles' || m.game === 'both'), cur = new Set(G.W?.mods || []);
      const info = G.modsInfo ? G.modsInfo() : [];
      card.innerHTML = `<h2>🧩 Моды этого мира</h2><p class="pz-note">Отмеченные моды работают в мире «${esc(G.W?.name || '')}». После «Применить» мир сохранится и откроется заново.</p>
        ${usable.map(m => { const i = info.find(x => x.id === m.id); return `<label class="pz-chk"><input type="checkbox" data-wm="${esc(m.id)}" ${cur.has(m.id) ? 'checked' : ''}> <b>${esc(m.name)}</b> <span class="pz-note">${esc(m.version || '')}${i ? (i.off ? ' · ⛔ выключен' : i.errors ? ` · ошибок: ${i.errors}` : ' · ✅ работает') : ''}</span></label>${i && i.log.length ? `<div class="pz-err">${i.log.slice(-3).map(esc).join('<br>')}</div>` : ''}`; }).join('') || '<p>Модов нет. Установи их в главном меню → «🧩 Моды».</p>'}
        <div class="pz-row"><button type="button" class="pz-b pri" data-mm="apply">Применить</button><button type="button" class="pz-b ghost" data-mm="back">← Назад</button></div>`;
    } else {
      card.innerHTML = `<h2>🧩 Моды</h2>
        <p>Мод добавляет блоки, предметы, рецепты, руды и поведение (скрипты на JavaScript или Lua). Моды включаются для каждого мира отдельно — при создании мира или в паузе → «🧩 Моды мира». Как сделать свой — <a href="https://github.com/dan4ik37/dan4ik37.github.io/blob/main/docs/MODS.md" target="_blank" rel="noopener">docs/MODS.md</a>.</p>
        <p class="pz-note">Скрипты модов работают в закрытой песочнице: без сети, без доступа к сайту и аккаунту. Ошибка или зависание — мод выключается, игра продолжается.</p>
        <div class="pz-list">${list.map(m => `<div class="pz-it"><span>🧩</span><span class="tx"><b>${esc(m.name)} <small>${esc(m.version || '')}</small></b><small>${esc(m.author || '')} · ${m.game === 'both' ? 'обе игры' : m.game === 'voxel' ? 'кубический мир' : 'Подземье'} — ${esc(m.description || '')}</small></span><button type="button" class="ib" data-mm="del" data-id="${esc(m.id)}" title="Удалить">🗑</button></div>`).join('') || '<div class="pz-note">Пока ни одного.</div>'}</div>
        <div class="pz-row"><button type="button" class="pz-b" data-mm="file">📦 Из файла (.d37mod, .zip, .json)</button><button type="button" class="pz-b" data-mm="dir">📁 Из папки</button></div>
        <h3>📚 Примеры</h3><div class="pz-row">${EXAMPLES.map(e => `<button type="button" class="pz-b ghost" data-mm="ex" data-id="${e.id}">${esc(e.name)} (${e.lang})</button>`).join('')}</div>
        <div class="pz-mm-out"></div>
        <div class="pz-row"><button type="button" class="pz-b pri" data-mm="back">← Назад</button></div>`;
    }
    const out = msg => { const o = card.querySelector('.pz-mm-out'); if (o) o.innerHTML = msg; };
    const report = v => v.ok ? `<p>✅ Мод «${esc(v.mod.name)}» установлен.${v.warnings.length ? `<br><span class="pz-note">${v.warnings.map(esc).join('<br>')}</span>` : ''} Включи его в мире.</p>` : `<p class="pz-err">Мод не установлен:<br>${v.errors.map(esc).join('<br>')}</p>`;
    card.onclick = async e => {
      const b = e.target.closest('[data-mm]'); if (!b) return;
      const a = b.dataset.mm;
      try {
        if (a === 'back') { back(); return; }
        if (a === 'apply') {
          const ids = [...card.querySelectorAll('[data-wm]:checked')].map(x => x.dataset.wm);
          const W = G.W, C = G.CH; if (!W || !C) { back(); return; }
          W.mods = ids; await API.saveAll(); const wid = W.id, cid = C.id;
          await API.stopWorld(false); API.G.U?.menu(null); API.play(wid, cid);
          return;
        }
        if (a === 'del') { if (await (window.GameKit?.ask ? window.GameKit.ask({ icon: '🗑', title: 'Удалить мод?', text: 'Миры с ним откроются без него (его блоки станут пустотой).', yes: 'Удалить', no: 'Отмена', danger: true }) : confirm('Удалить мод?'))) { await API.dbDel('mods', b.dataset.id); renderMenu(card, API, worldMode, back); } return; }
        if (a === 'file' || a === 'dir') {
          const inp = document.createElement('input'); inp.type = 'file';
          if (a === 'dir') { inp.webkitdirectory = true; inp.multiple = true; } else inp.accept = '.d37mod,.zip,.json,application/zip,application/json';
          inp.onchange = async () => {
            try { const { json, files } = await read(a === 'dir' ? inp.files : inp.files[0]); const v = await install(API, json, files); await renderMenu(card, API, worldMode, back); card.querySelector('.pz-mm-out').innerHTML = report(v); }
            catch (er) { out(`<p class="pz-err">Не прочитался: ${esc(er.message || er)}</p>`); }
          };
          inp.click(); return;
        }
        if (a === 'ex') { const ex = EXAMPLES.find(x => x.id === b.dataset.id); out('<p>Скачиваю…</p>'); const v = await installExample(API, ex); await renderMenu(card, API, worldMode, back); card.querySelector('.pz-mm-out').innerHTML = report(v); return; }
      } catch (er) { out(`<p class="pz-err">${esc(er.message || er)}</p>`); }
    };
  }

  window.PZMods = { API_VERSION, LIM, validate, read, unzip, attach, renderMenu, installed, install, EXAMPLES, runtime: modRuntime, frameHtml };
})();

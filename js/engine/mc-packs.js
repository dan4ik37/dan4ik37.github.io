// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — содержимое Minecraft → моды «Кубомира» (один раз, при переносе): пакеты данных Java (рецепты, теги,
//  функции .mcfunction), дополнения Bedrock (.mcaddon/.mcpack: блоки, предметы, рецепты, добыча, функции, скрипты
//  @minecraft/server), моды Java (.jar — только данные: картинки, модели, переводы, рецепты, добыча, теги), пакеты текстур
// ═══════════════════════════════════════
// Выход — обычные моды общего формата (docs/MODS.md: mod.json + картинки + скрипт JS) → KubomirMods.install. Код модов Java
// (.class) не запускается и не переводится: только данные (поведение можно переписать скриптом — «Перенос из Minecraft»).
// Ничего Mojang сюда не попадает: картинки берутся из файла игрока и остаются в его браузере (IndexedDB).
// MC.datapack(files, name) / MC.addon(files, name) / MC.jar(files, name) → { mods: [{ manifest, files }], report };
// MC.respack(files, name) → { name, tex: { наша_текстура: png }, mc: { блок_minecraft: png }, report };
// MC.fnToJs(функции, { tick, load }) → { code, report } — .mcfunction → скрипт JS (API модов 1); MC.MCSERVER — слой
// «@minecraft/server» (свой, поверх API модов) для скриптов дополнений Bedrock; MC.bundle(файлы, вход) — сборка модулей в один.
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const MC = E.mc = E.mc || {};
  const LIM = { blocks: 64, items: 128, recipes: 256, textures: 250, texBytes: 2.3e6, code: 190000 };
  const TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  const text = u8 => typeof u8 === 'string' ? u8 : TD ? TD.decode(u8) : String.fromCharCode(...u8);
  // JSON с комментариями (Bedrock): убрать // и /* */ вне строк, висячие запятые
  function jsonc(src){
    let s = text(src).replace(/^\uFEFF/, ''), out = '', i = 0, q = false;
    while (i < s.length) {
      const c = s[i];
      if (q) { out += c; if (c === '\\') { out += s[i + 1] || ''; i += 2; continue; } if (c === '"') q = false; i++; continue; }
      if (c === '"') { q = true; out += c; i++; continue; }
      if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
      out += c; i++;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  }
  MC.jsonc = jsonc;
  const tryJson = u8 => { try { return jsonc(u8); } catch (e) { return null; } };
  const NAME_OK = /^[a-z0-9_-]{1,32}$/;
  let hseq = 0;
  // имя Minecraft → имя для mod.json (латиница, ≤ 32)
  const local = (s, used) => {
    let n = String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
    if (n.length > 32) n = n.slice(0, 26) + '_' + (++hseq).toString(36).slice(-5);
    if (used) { let k = n, j = 2; while (used.has(k)) k = n.slice(0, 29) + '_' + j++; used.add(k); n = k; }
    return n;
  };
  const modId = s => { let n = String(s || 'mc').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, ''); if (n.length < 2) n = 'mc-' + n; return n.slice(0, 32); };
  const ver = v => { const s = Array.isArray(v) ? v.join('.') : String(v || '1.0.0'); const m = /^\d+(\.\d+){0,3}/.exec(s); return m ? m[0] : '1.0.0'; };
  const hard = mc => Math.round(Math.max(0, Math.min(2000, (+mc || 1.5) * 66.7)));   // твёрдость Minecraft (камень 1,5) → общий формат (камень 100)
  const lightLevel = (lv, col) => {   // уровень + цвет → [r, g, b] (общий формат: яркость — по самому яркому каналу)
    const k = Math.max(0, Math.min(15, lv | 0)) / 15; if (!k) return 0;
    const c = col && /^#[0-9a-f]{6}$/i.test(col) ? parseInt(col.slice(1), 16) : 0xfff0d6;
    return [Math.round((c >> 16 & 255) * k), Math.round((c >> 8 & 255) * k), Math.round((c & 255) * k)];
  };
  const notePush = (r, t) => { if (r.notes.length < 40) r.notes.push(t); };
  const newReport = () => ({ blocks: 0, items: 0, recipes: 0, textures: 0, functions: 0, scripts: 0, skipped: [], notes: [], unsupported: {} });
  const skip = (r, t) => { if (r.skipped.length < 60) r.skipped.push(t); };

  // ═══ .mcfunction → JS (API модов 1): say, tellraw, give, setblock, fill, tp, scoreboard, execute (as/at/positioned/if/unless … run), function, summon, particle, playsound ═══
  const MOBS = { zombie: 'zombie', husk: 'zombie', drowned: 'zombie', skeleton: 'skeleton', creeper: 'creeper', spider: 'spider', slime: 'slime', pig: 'pig', cow: 'cow', chicken: 'chicken', sheep: 'sheep', mooshroom: 'cow' };
  MC.fnToJs = (funcs, o = {}) => {
    const rep = { lines: 0, ok: 0, unsupported: {} }, mods = o.mods || null, mapB = o.mapBlock || (n => { const r = MC.resolve(n, { mods, bedrock: o.bedrock }); return r.name === 'missing' ? null : r.name; }), mapI = o.mapItem || (n => MC.item(n, { mods }));
    const un = c => { rep.unsupported[c] = (rep.unsupported[c] || 0) + 1; };
    const J = JSON.stringify;
    // координата: ~ (от точки), ^ (как ~), число
    const crd = (t, axis) => { if (t == null) return null; if (t[0] === '~' || t[0] === '^') { const d = t.length > 1 ? +t.slice(1) : 0; return Number.isFinite(d) ? `(o.${axis}${d ? (d > 0 ? '+' : '') + d : ''})` : null; } const n = +t; return Number.isFinite(n) ? String(n) : null; };
    const sel = t => !t || /^@[pasr]/.test(t) || /^[A-Za-z0-9_]{1,16}$/.test(t);   // игрок (один)
    const blockArg = t => { const m = /^([^\[{]+)(\[[^\]]*\])?/.exec(t || ''); if (!m) return null; const nm = m[1].includes(':') ? m[1] : 'minecraft:' + m[1]; return mapB(nm + (m[2] || '')); };
    const msgOf = rest => {   // tellraw: {"text": …} / [""…] / "строка"
      try { const j = JSON.parse(rest); const flat = x => typeof x === 'string' ? x : Array.isArray(x) ? x.map(flat).join('') : x && typeof x === 'object' ? (x.text || x.translate || '') + (x.extra ? flat(x.extra) : '') : ''; return flat(j); } catch (e) { return rest.replace(/^"|"$/g, ''); }
    };
    function cmd(line, depth){
      const w = line.trim().split(/\s+/), c = (w[0] || '').replace(/^\//, '').toLowerCase();
      if (depth > 8) return null;
      switch (c) {
        case 'say': return `player.message(${J(line.trim().slice(3).trim().slice(0, 120))});`;
        case 'tellraw': case 'title': { const i = c === 'title' ? 3 : 2; return sel(w[1]) ? `player.message(${J(msgOf(w.slice(i).join(' ')).slice(0, 120))});` : null; }
        case 'give': { if (!sel(w[1])) return null; const it = mapI((w[2] || '').replace(/[\[{].*$/, '')); if (!it) return null; const n = Math.max(1, Math.min(999, +(w[3] || 1) | 0)); return `player.give(${J(it)}, ${n});`; }
        case 'setblock': { const x = crd(w[1], 'x'), y = crd(w[2], 'y'), z = crd(w[3], 'z'), b = blockArg(w[4]); if (!x || !y || !z || !b) return null; return w[5] === 'keep' ? `if (world.get(${x}, ${y}, ${z}) === 'air') world.set(${x}, ${y}, ${z}, ${J(b)});` : `world.set(${x}, ${y}, ${z}, ${J(b)});`; }
        case 'fill': {
          const a = [1, 2, 3, 4, 5, 6].map((k, i) => crd(w[k], 'xyz'[i % 3])); const b = blockArg(w[7]);
          if (a.some(v => !v) || !b) return null;
          const mode = w[8] || 'replace', only = mode === 'replace' && w[9] ? blockArg(w[9]) : null;
          return `{ const x0 = Math.min(${a[0]}, ${a[3]}), x1 = Math.max(${a[0]}, ${a[3]}), y0 = Math.min(${a[1]}, ${a[4]}), y1 = Math.max(${a[1]}, ${a[4]}), z0 = Math.min(${a[2]}, ${a[5]}), z1 = Math.max(${a[2]}, ${a[5]});
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      ${mode === 'hollow' || mode === 'outline' ? `const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1; if (!edge) { ${mode === 'hollow' ? "world.set(x, y, z, 'air');" : ''} continue; }` : ''}
      ${mode === 'keep' ? "if (world.get(x, y, z) !== 'air') continue;" : ''}${only ? `if (world.get(x, y, z) !== ${J(only)}) continue;` : ''}
      if (world.set(x, y, z, ${J(b)}) === false) return;
    } }`;
        }
        case 'tp': case 'teleport': {
          const args = sel(w[1]) && w.length >= 5 ? w.slice(2) : w.slice(1);
          const x = crd(args[0], 'x'), y = crd(args[1], 'y'), z = crd(args[2], 'z'); if (!x || !y || !z) return null;
          return `player.teleport(${x}, ${y}, ${z});`;
        }
        case 'scoreboard': {
          if (w[1] === 'objectives' && w[2] === 'add') return `SB.obj(${J(w[3])});`;
          if (w[1] === 'objectives') return '';
          if (w[1] === 'players' && ['set', 'add', 'remove', 'reset'].includes(w[2]) && sel(w[3])) { const n = +(w[5] || 0) | 0; return w[2] === 'reset' ? `SB.set(${J(w[4] || '*')}, 0);` : `SB.${w[2] === 'set' ? 'set' : 'add'}(${J(w[4])}, ${w[2] === 'remove' ? -n : n});`; }
          return null;
        }
        case 'function': { const n = (w[1] || '').replace(/^#/, ''); return n ? `F.call(${J(n.includes(':') ? n : 'minecraft:' + n)}, o);` : null; }
        case 'summon': { const m = MOBS[(w[1] || '').replace(/^minecraft:/, '')]; if (!m) return null; const x = crd(w[2] || '~', 'x'), y = crd(w[3] || '~', 'y'), z = crd(w[4] || '~', 'z'); return x && y && z ? `game.spawn(${J(m)}, ${x}, ${y}, ${z});` : null; }
        case 'particle': { const x = crd(w[2] || '~', 'x'), y = crd(w[3] || '~', 'y'), z = crd(w[4] || '~', 'z'); return x && y && z ? `fx.particles(${x}, ${y}, ${z}, 'spark', 10);` : null; }
        case 'playsound': return `fx.sound('click');`;
        case 'execute': {
          // as/at — один игрок (без изменений), positioned x y z — новая точка, if/unless block|score|entity — условие, run — команда
          let i = 1, pre = '', conds = [];
          while (i < w.length && w[i] !== 'run') {
            const k = w[i];
            if (k === 'as' || k === 'at') { if (!sel(w[i + 1]) && !/^@e/.test(w[i + 1])) return null; if (/^@e/.test(w[i + 1])) return null; i += 2; continue; }
            if (k === 'positioned') { if (w[i + 1] === 'as') { i += 3; continue; } const x = crd(w[i + 1], 'x'), y = crd(w[i + 2], 'y'), z = crd(w[i + 3], 'z'); if (!x || !y || !z) return null; pre += `o = { x: ${x}, y: ${y}, z: ${z} }; `; i += 4; continue; }
            if (k === 'if' || k === 'unless') {
              const neg = k === 'unless', t = w[i + 1];
              if (t === 'block') { const x = crd(w[i + 2], 'x'), y = crd(w[i + 3], 'y'), z = crd(w[i + 4], 'z'), b = blockArg(w[i + 5]); if (!x || !y || !z || !b) return null; conds.push(`${neg ? '!' : ''}(world.get(${x}, ${y}, ${z}) === ${J(b)})`); i += 6; continue; }
              if (t === 'score') {
                if (w[i + 4] !== 'matches') return null;
                const [lo, hi] = String(w[i + 5]).split('..'), L = lo === '' ? '-Infinity' : +lo, Hh = hi === undefined ? L : hi === '' ? 'Infinity' : +hi;
                conds.push(`${neg ? '!' : ''}(SB.get(${J(w[i + 3])}) >= ${L} && SB.get(${J(w[i + 3])}) <= ${Hh})`); i += 6; continue;
              }
              if (t === 'entity') { conds.push(neg ? 'false' : 'true'); i += 3; continue; }
              return null;
            }
            if (k === 'in' || k === 'anchored' || k === 'facing' || k === 'rotated' || k === 'align') { i += k === 'facing' ? 4 : 2; continue; }
            return null;
          }
          const inner = i < w.length ? cmd(w.slice(i + 1).join(' '), depth + 1) : '';
          if (inner == null) return null;
          return `{ let o0 = o; { let o = o0; ${pre}${conds.length ? `if (${conds.join(' && ')}) ` : ''}{ ${inner} } } }`;
        }
        case 'time': case 'weather': case 'gamemode': case 'difficulty': case 'gamerule': case 'effect': case 'clear': case 'kill': case 'tag': case 'data': case 'bossbar': case 'schedule': case 'advancement': case 'recipe': case 'xp': case 'experience': case 'enchant': case 'item': case 'loot': case 'spreadplayers': case 'spawnpoint': case 'setworldspawn': case 'worldborder': case 'attribute': case 'damage': case 'ride': case 'return': case 'forceload': case 'clone':
        default: return null;
      }
    }
    let body = '';
    const names = [...funcs.keys()];
    for (const [name, src] of funcs) {
      const out = [];
      for (const raw of text(src).split(/\r?\n/)) {
        const line = raw.trim(); if (!line || line[0] === '#') continue;
        rep.lines++;
        if (line[0] === '$') { un('макрос $'); out.push(`// ${line.slice(0, 120).replace(/\*\//g, '* /')} — не поддерживается`); continue; }
        const js = cmd(line, 0);
        if (js == null) { un(line.split(/\s+/)[0].replace(/^\//, '')); out.push(`// ${line.slice(0, 120).replace(/\*\//g, '* /')} — не поддерживается`); }
        else { rep.ok++; if (js) out.push(js); }
      }
      body += `F[${J(name)}] = function (o) {\n  ${out.join('\n  ')}\n};\n`;
    }
    const short = new Map();
    for (const n of names) { const s = n.split(/[:/]/).pop().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 20); if (s && !short.has(s) && !['help', 'time', 'gamemode', 'tp', 'give', 'seed', 'spawn', 'where'].includes(s)) short.set(s, n); }
    const code = `// Перенесено из Minecraft (.mcfunction) при импорте: команды → API модов «Кубомира»
const F = {};
const here = () => ({ x: Math.floor(player.x), y: Math.floor(player.y), z: Math.floor(player.z) });
// счёт (scoreboard): у одного игрока — просто числа, сохраняются в мире
const SB = { all: mod.storage.get('sb') || {}, obj(n){ if (!(n in this.all)) { this.all[n] = 0; this.save(); } }, get(n){ return this.all[n] || 0; }, set(n, v){ this.all[n] = v | 0; this.save(); }, add(n, v){ this.all[n] = (this.all[n] || 0) + (v | 0); this.save(); }, save(){ mod.storage.set('sb', this.all); } };
let depth = 0;
F.call = (n, o) => { const f = F[n]; if (!f) { player.message('нет функции ' + n); return; } if (++depth > 16) { depth--; return; } try { f(o || here()); } finally { depth--; } };
${body}
commands.add('function', 'запустить функцию пакета: /function пакет:имя', args => { const n = String(args[0] || ''); F.call(n.includes(':') ? n : ${J((names[0] || 'minecraft:x').split(':')[0])} + ':' + n, here()); });
${[...short].map(([s, n]) => `commands.add(${J(s)}, ${J('функция ' + n)}, () => F.call(${J(n)}, here()));`).join('\n')}
${(o.load || []).length ? `mod.on('start', () => { for (const n of ${J(o.load)}) F.call(n, here()); });` : ''}
${(o.tick || []).length ? `mod.on('tick', () => { for (const n of ${J(o.tick)}) F.call(n, here()); });` : ''}
`;
    return { code, report: rep };
  };

  // ═══ Рецепты Java (пакеты данных, моды .jar) → общий формат ═══
  // ctx: { own: Map('ns:имя' → 'наше_имя'), tags: Map('ns:тег' → [значения]), mods }
  function ingJava(x, ctx, depth = 0){
    if (x == null || depth > 6) return null;
    if (typeof x === 'string') return x[0] === '#' ? tagJava(x.slice(1), ctx, depth) : itemJava(x, ctx);
    if (Array.isArray(x)) { for (const y of x) { const r = ingJava(y, ctx, depth + 1); if (r) return r; } return null; }
    if (typeof x === 'object') { if (x.item) return itemJava(x.item, ctx); if (x.tag) return tagJava(x.tag, ctx, depth); if (x.items) return ingJava(x.items, ctx, depth + 1); if (x.id) return itemJava(x.id, ctx); }
    return null;
  }
  function itemJava(n, ctx){ const full = String(n).includes(':') ? String(n) : 'minecraft:' + n; if (ctx.own?.has(full)) return ctx.own.get(full); return MC.item(full, { mods: ctx.mods }); }
  function tagJava(t, ctx, depth){
    const full = String(t).includes(':') ? String(t) : 'minecraft:' + t;
    const own = ctx.tags?.get(full);
    if (own) for (const v of own) { const r = ingJava(typeof v === 'object' ? v.id : v, ctx, depth + 1); if (r) return r; }
    return MC.tag('#' + full);
  }
  const resJava = r => { if (!r) return null; if (typeof r === 'string') return { id: r, n: 1 }; return { id: r.item || r.id, n: Math.max(1, Math.min(64, r.count | 0 || 1)) }; };
  MC.recipeJava = (j, ctx) => {
    const type = String(j.type || '').replace(/^minecraft:/, '');
    const R = resJava(j.result);
    if (!R || !R.id) return { skip: 'нет результата' };
    const out = itemJava(R.id, ctx); if (!out) return { skip: `нет «${R.id}»` };
    if (type === 'crafting_shaped') {
      const P = (j.pattern || []).map(s => String(s)), key = {};
      if (!P.length || P.length > 3 || P.some(s => s.length > 3)) return { skip: 'форма больше 3×3' };
      for (const ch of new Set(P.join('').replace(/ /g, ''))) { const v = ingJava(j.key?.[ch], ctx); if (!v) return { skip: `нет «${JSON.stringify(j.key?.[ch]).slice(0, 60)}»` }; key[ch] = v; }
      return { recipe: { result: out, count: R.n, pattern: P, key } };
    }
    if (type === 'crafting_shapeless') {
      const ing = []; for (const x of j.ingredients || []) { const v = ingJava(x, ctx); if (!v) return { skip: `нет «${JSON.stringify(x).slice(0, 60)}»` }; ing.push([v, 1]); }
      if (!ing.length || ing.length > 9) return { skip: 'ингредиентов не 1…9' };
      return { recipe: { result: out, count: R.n, ingredients: ing } };
    }
    if (type === 'smelting' || type === 'blasting' || type === 'smoking' || type === 'campfire_cooking') {
      const v = ingJava(j.ingredient, ctx); if (!v || v[0] === '#') return { skip: 'в печь — конкретный предмет' };
      return { recipe: { result: out, count: R.n, station: 'furnace', ingredients: [[v, 1]], time: Math.max(.5, Math.min(120, (j.cookingtime || 200) / 20 / 2)) } };
    }
    return { skip: 'тип «' + type + '» не переносится' };
  };
  // рецепт Bedrock → общий формат
  const itemB = (x, ctx) => { const n = typeof x === 'string' ? x : x?.item || x?.name; if (!n) return null; const full = n.includes(':') ? n : 'minecraft:' + n; if (ctx.own?.has(full)) return ctx.own.get(full); if (n[0] === '#') return MC.tag(n); return MC.item(full, { mods: ctx.mods, bedrock: true }) || (MC.resolve(full, { bedrock: true }).name.match(/^[a-z_]+$/) ? MC.resolve(full, { bedrock: true }).name : null); };
  MC.recipeBedrock = (j, ctx) => {
    const k = Object.keys(j).find(x => x.startsWith('minecraft:recipe_')); if (!k) return { skip: 'не рецепт' };
    const r = j[k], kind = k.slice(17);
    const res0 = Array.isArray(r.result) ? r.result[0] : r.result || r.output;
    const out = itemB(res0, ctx); if (!out) return { skip: 'нет результата' };
    const n = Math.max(1, Math.min(64, (typeof res0 === 'object' ? res0.count : 1) | 0 || 1));
    if (kind === 'shaped') {
      const P = (r.pattern || []).map(String), key = {};
      if (!P.length || P.length > 3 || P.some(s => s.length > 3)) return { skip: 'форма больше 3×3' };
      for (const ch of new Set(P.join('').replace(/ /g, ''))) { const v = itemB(r.key?.[ch], ctx); if (!v) return { skip: `нет «${JSON.stringify(r.key?.[ch]).slice(0, 60)}»` }; key[ch] = v; }
      return { recipe: { result: out, count: n, pattern: P, key } };
    }
    if (kind === 'shapeless') {
      const ing = []; for (const x of r.ingredients || []) { const v = itemB(x, ctx); if (!v) return { skip: 'нет ингредиента' }; for (let q = 0; q < Math.max(1, Math.min(9, x?.count | 0 || 1)); q++) ing.push([v, 1]); }
      if (!ing.length || ing.length > 9) return { skip: 'ингредиентов не 1…9' };
      return { recipe: { result: out, count: n, ingredients: ing } };
    }
    if (kind === 'furnace') { const v = itemB(r.input, ctx); if (!v || v[0] === '#') return { skip: 'нет входа печи' }; return { recipe: { result: out, count: n, station: 'furnace', ingredients: [[v, 1]] } }; }
    return { skip: 'тип «' + kind + '» не переносится' };
  };
  // добыча блока (loot table): что выпадает — первое простое «item» (у «алмазной кирки с шёлком» — обычный вариант)
  MC.lootDrop = j => {
    const walk = e => {
      if (!e || typeof e !== 'object') return null;
      const t = String(e.type || '').replace(/^minecraft:/, '');
      if (t === 'item' && e.name) return String(e.name);
      if (Array.isArray(e.children)) { for (let i = e.children.length - 1; i >= 0; i--) { const r = walk(e.children[i]); if (r) return r; } }
      return null;
    };
    for (const p of j?.pools || []) for (const e of p.entries || []) { const r = walk(e); if (r) return r; }
    return null;
  };

  // ═══ Пакет данных Java (data/…, pack.mcmeta) → мод ═══
  MC.datapack = (files, name) => {
    const rep = newReport(), mods = null;
    const meta = tryJson(files['pack.mcmeta'] || '') || {};
    const desc = typeof meta.pack?.description === 'string' ? meta.pack.description : Array.isArray(meta.pack?.description) ? meta.pack.description.map(x => x.text || x).join('') : '';
    const id = modId('dp-' + String(name || 'datapack').replace(/\.(zip|jar)$/i, ''));
    const ctx = { own: new Map(), tags: tagMap(files), mods };
    const recipes = [];
    for (const [p, f] of Object.entries(files)) {
      const m = /^data\/([^/]+)\/recipes?\/(.+)\.json$/.exec(p); if (!m) continue;
      const j = tryJson(f); if (!j) continue;
      const r = MC.recipeJava(j, ctx);
      if (r.recipe) { if (recipes.length < LIM.recipes) recipes.push(r.recipe); } else skip(rep, `рецепт ${m[1]}:${m[2]} — ${r.skip}`);
    }
    // функции и их теги (tick/load)
    const funcs = new Map();
    for (const [p, f] of Object.entries(files)) { const m = /^data\/([^/]+)\/functions?\/(.+)\.mcfunction$/.exec(p); if (m) funcs.set(m[1] + ':' + m[2], f); }
    const tagFn = n => { for (const dir of ['functions', 'function']) { const j = tryJson(files[`data/minecraft/tags/${dir}/${n}.json`] || ''); if (j?.values) return j.values.map(v => typeof v === 'object' ? v.id : v).filter(v => typeof v === 'string' && !v.startsWith('#')).map(v => v.includes(':') ? v : 'minecraft:' + v); } return []; };
    const manifest = { id, name: (desc || name || 'Пакет данных').slice(0, 40), version: '1.0.0', game: 'voxel', api: 1, author: 'Minecraft (перенос)', description: ('Перенесено из пакета данных Minecraft. ' + desc).slice(0, 380), recipes };
    const out = { 'mod.json': '' };
    if (funcs.size) {
      const fj = MC.fnToJs(funcs, { tick: tagFn('tick'), load: tagFn('load'), mods });
      rep.functions = funcs.size; rep.unsupported = fj.report.unsupported;
      if (fj.code.length <= LIM.code) { manifest.scripts = [{ file: 'functions.js', lang: 'js' }]; out['functions.js'] = fj.code; }
      else notePush(rep, 'функций слишком много — скрипт больше 190 КБ, не перенесён');
    }
    rep.recipes = recipes.length;
    const nLoot = Object.keys(files).filter(p => /^data\/[^/]+\/loot_tables?\//.test(p)).length;
    if (nLoot) notePush(rep, `таблицы добычи (${nLoot}) — в «Кубомире» добыча ванильных блоков своя, не переносятся`);
    if (!recipes.length && !funcs.size) notePush(rep, 'в пакете нет рецептов и функций, которые можно перенести');
    out['mod.json'] = JSON.stringify(manifest, null, 1);
    return { mods: [{ manifest, files: out }], report: rep };
  };
  function tagMap(files){
    const tags = new Map();
    for (const [p, f] of Object.entries(files)) {
      const m = /^data\/([^/]+)\/tags\/(items?|blocks?)\/(.+)\.json$/.exec(p); if (!m) continue;
      const j = tryJson(f); if (!j?.values) continue;
      const k = m[1] + ':' + m[3], cur = tags.get(k) || [];
      tags.set(k, cur.concat(j.values.map(v => typeof v === 'object' ? v.id : v).filter(v => typeof v === 'string')));
    }
    return tags;
  }

  // ═══ Мод Java (.jar): только данные — блоки (blockstates → модели → текстуры), предметы, переводы, рецепты, добыча, теги ═══
  const PARENTS = {   // модели Minecraft → как рисовать у нас
    'block/cube_all': 'all', 'block/leaves': 'leaves', 'block/cube_column': 'column', 'block/cube_column_horizontal': 'column', 'block/cube_bottom_top': 'bottom_top',
    'block/orientable': 'orientable', 'block/orientable_with_bottom': 'orientable', 'block/cube': 'cube', 'block/cube_directional': 'cube', 'block/cube_mirrored_all': 'all',
    'block/cross': 'cross', 'block/tinted_cross': 'cross', 'block/flower_pot_cross': 'cross', 'block/torch': 'torch', 'block/template_torch': 'torch', 'block/wall_torch': 'torch',
    'block/slab': 'bottom_top', 'block/slab_top': 'bottom_top', 'block/stairs': 'bottom_top', 'block/inner_stairs': 'bottom_top', 'block/outer_stairs': 'bottom_top',
    'block/fence_post': 'texture', 'block/template_wall_post': 'wall', 'block/fence_side': 'texture', 'block/template_fence_gate': 'texture', 'block/button': 'texture',
    'block/pressure_plate_up': 'texture', 'block/carpet': 'wool', 'block/template_glazed_terracotta': 'pattern', 'block/door_bottom_left': 'door', 'block/door_bottom': 'door',
    'block/template_trapdoor_bottom': 'texture', 'block/pane_post': 'pane', 'block/template_glass_pane_post': 'pane', 'block/crop': 'cross', 'block/stem_growth0': 'cross',
  };
  MC.jar = (files, name, o = {}) => {
    const rep = newReport();
    // сведения о моде: fabric.mod.json / quilt.mod.json / META-INF/mods.toml / neoforge.mods.toml / mcmod.info
    let info = { id: '', name: '', version: '', authors: '', description: '' };
    const fab = tryJson(files['fabric.mod.json'] || '') || tryJson(files['quilt.mod.json'] || '')?.quilt_loader;
    if (fab) info = { id: fab.id, name: fab.name || fab.metadata?.name, version: fab.version, authors: [].concat(fab.authors || fab.metadata?.contributors || []).map(a => typeof a === 'string' ? a : a?.name || '').filter(Boolean).join(', '), description: fab.description || fab.metadata?.description || '' };
    const toml = text(files['META-INF/neoforge.mods.toml'] || files['META-INF/mods.toml'] || '');
    if (toml && !info.id) {
      const g = k => { const m = new RegExp('^\\s*' + k + '\\s*=\\s*(?:"([^"]*)"|\'\'\'([\\s\\S]*?)\'\'\'|\'([^\']*)\')', 'm').exec(toml); return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : ''; };
      info = { id: g('modId'), name: g('displayName'), version: g('version'), authors: g('authors'), description: g('description') };
      if (/\$\{/.test(info.version)) info.version = '';
    }
    const mi = tryJson(files['mcmod.info'] || ''); if (!info.id && Array.isArray(mi) && mi[0]) info = { id: mi[0].modid, name: mi[0].name, version: mi[0].version, authors: [].concat(mi[0].authorList || []).join(', '), description: mi[0].description };
    const nss = [...new Set(Object.keys(files).map(p => (/^assets\/([^/]+)\//.exec(p) || [])[1]).filter(n => n && n !== 'minecraft' && n !== 'realms'))];
    const ns = info.id && nss.includes(info.id) ? info.id : nss[0] || info.id || 'mod';
    if (!nss.length) notePush(rep, 'в .jar нет папки assets — картинок и моделей нет (мод только из кода?)');
    rep.classes = o.classes ?? Object.keys(files).filter(p => p.endsWith('.class')).length;
    // переводы: ru_ru → en_us
    const lang = Object.assign({}, tryJson(files[`assets/${ns}/lang/en_us.json`] || '') || {}, tryJson(files[`assets/${ns}/lang/ru_ru.json`] || '') || {});
    const title = (kind, n) => String(lang[`${kind}.${ns}.${n}`] || lang[`block.${ns}.${n}`] || lang[`item.${ns}.${n}`] || n.replace(/_/g, ' ')).slice(0, 40);
    // модели
    const model = (ref, kind = 'block', depth = 0) => {
      const s = String(ref || ''), c = s.indexOf(':'), mns = c >= 0 ? s.slice(0, c) : 'minecraft', path = (c >= 0 ? s.slice(c + 1) : s);
      const full = mns + ':' + (path.includes('/') ? path : kind + '/' + path);
      if (depth > 8) return { parent: '', textures: {}, full };
      const f = files[`assets/${mns}/models/${full.split(':')[1]}.json`];
      const j = f ? tryJson(f) : null;
      if (!j) return { parent: full.replace(/^minecraft:/, ''), textures: {}, full, vanilla: mns === 'minecraft' };
      const up = j.parent ? model(j.parent, kind, depth + 1) : { parent: '', textures: {} };
      const tex = Object.assign({}, up.textures, j.textures || {});
      return { parent: PARENTS[String(j.parent || '').replace(/^minecraft:/, '')] ? String(j.parent).replace(/^minecraft:/, '') : up.parent || String(j.parent || '').replace(/^minecraft:/, ''), textures: tex, full, render: j.render_type || up.render, elements: j.elements || up.elements };
    };
    const texRef = (tex, k, d = 0) => { let v = tex[k]; while (typeof v === 'string' && v[0] === '#' && d++ < 8) v = tex[v.slice(1)]; return typeof v === 'string' ? v : null; };
    // картинки: 'ns:block/x' → файл
    const usedTex = new Set(), texOut = new Map();   // 'ns:block/x' → { name, path, bytes }
    const texOf = ref => {
      if (!ref) return null;
      const c = ref.indexOf(':'), tns = c >= 0 ? ref.slice(0, c) : 'minecraft', path = c >= 0 ? ref.slice(c + 1) : ref, key = tns + ':' + path;
      if (texOut.has(key)) return texOut.get(key).name;
      if (tns === 'minecraft') { const our = OUR_TEX_BY_MC.get(path.replace(/^(block|blocks|item|items)\//, '')); return our ? '@' + our : null; }
      const f = files[`assets/${tns}/textures/${path}.png`]; if (!f) return null;
      if (texOut.size >= LIM.textures) return null;
      const nm = local(path.split('/').pop(), usedTex);
      texOut.set(key, { name: nm, path: 'textures/' + nm + '.png', bytes: f });
      return nm;
    };
    // какие блоки чем добываются (теги mineable, needs_*_tool — в data/minecraft/tags/blocks)
    const tagList = n => { const out = new Set(); for (const dir of ['blocks', 'block']) { const j = tryJson(files[`data/minecraft/tags/${dir}/${n}.json`] || ''); for (const v of j?.values || []) out.add(typeof v === 'object' ? v.id : v); } return out; };
    const MINE = { pick: tagList('mineable/pickaxe'), axe: tagList('mineable/axe'), shovel: tagList('mineable/shovel'), hoe: tagList('mineable/hoe') };
    const NEED = { 2: tagList('needs_stone_tool'), 3: tagList('needs_iron_tool'), 4: tagList('needs_diamond_tool') };
    const loot = n => { for (const dir of ['loot_tables', 'loot_table']) { const j = tryJson(files[`data/${ns}/${dir}/blocks/${n}.json`] || ''); if (j) return MC.lootDrop(j); } return undefined; };
    // ── блоки ──
    const blocks = [], items = [], own = new Map(), usedB = new Set();
    const bsFiles = Object.keys(files).filter(p => p.startsWith(`assets/${ns}/blockstates/`) && p.endsWith('.json')).sort();
    for (const p of bsFiles) {
      const bn = p.slice(`assets/${ns}/blockstates/`.length, -5);
      const bs = tryJson(files[p]); if (!bs) continue;
      let ref = null, axis = false;
      if (bs.variants) {
        const keys = Object.keys(bs.variants);
        axis = keys.some(k => /axis=/.test(k));
        const k0 = keys.find(k => k === '' || k === 'normal') || keys.find(k => /axis=y/.test(k)) || keys.find(k => /facing=north/.test(k) && !/half=top|type=top/.test(k)) || keys[0];
        const v = bs.variants[k0]; ref = (Array.isArray(v) ? v[0] : v)?.model;
      } else if (Array.isArray(bs.multipart)) { const a = bs.multipart[0]?.apply; ref = (Array.isArray(a) ? a[0] : a)?.model; }
      if (!ref) { skip(rep, `блок ${bn}: нет модели`); continue; }
      const M = model(ref, 'block'), kind = PARENTS[M.parent] || (M.parent.includes('cross') ? 'cross' : M.textures.all ? 'all' : M.textures.particle ? 'texture' : '');
      if (kind === 'door') { skip(rep, `блок ${bn}: дверь (двойные блоки — не переносятся)`); continue; }
      const T = M.textures, t = k => texOf(texRef(T, k));
      const nm = local(bn, usedB), full = ns + ':' + bn;
      const b = { id: nm, name: title('block', bn) };
      let faces = null;
      if (kind === 'column') faces = { top: t('end'), bottom: t('end'), side: t('side') };
      else if (kind === 'bottom_top') faces = { top: t('top') || t('end'), bottom: t('bottom') || t('top'), side: t('side') };
      else if (kind === 'orientable') faces = { top: t('top'), bottom: t('bottom') || t('top'), side: t('side'), front: t('front') };
      else if (kind === 'cube') faces = { top: t('up'), bottom: t('down'), side: t('north') || t('east'), front: t('north') };
      else if (kind === 'wall' || kind === 'pane') faces = { all: t('wall') || t('pane') || t('edge') || t('texture') || t('particle') };
      else faces = { all: t('all') || t('texture') || t('cross') || t('torch') || t('wool') || t('pattern') || t('particle') };
      const tex0 = faces.all || faces.side || faces.top || faces.front;
      if (!tex0) { skip(rep, `блок ${bn}: нет картинки`); continue; }
      const fx = {}; for (const [k, v] of Object.entries(faces)) if (v) fx[k] = v;
      if (Object.keys(fx).length === 1 && fx.all) b.texture = fx.all; else b.faces = fx;
      if (kind === 'cross') b.shape = 'cross';
      else if (kind === 'torch') b.shape = 'torch';
      if (kind === 'leaves') { b.transparent = true; b.tint = 'foliage'; b.sound = 'grass'; }
      if (/cutout|translucent/.test(String(M.render || '')) || /glass|ice|pane|leaves|lattice|window/.test(bn)) b.transparent = true;
      if (kind === 'cross' && String(M.parent).includes('tinted')) b.tint = 'grass';
      if (axis && b.faces) b.axis = true;
      // свет — по имени (данные света в коде мода, не в файлах)
      if (/lamp|lantern|glow|light|torch|beacon|shroomlight|neon|lumin|brazier|candle/.test(bn) && !/light_gray|lightning|light_blue|daylight|highlight|_slab|_stairs/.test(bn)) b.light = kind === 'torch' ? 14 : 15;
      // добыча: тег mineable → инструмент; needs_*_tool → уровень; иначе — по имени
      b.tool = MINE.pick.has(full) ? 'pick' : MINE.axe.has(full) ? 'axe' : MINE.shovel.has(full) ? 'shovel' : MINE.hoe.has(full) ? 'any' : /ore|stone|brick|metal|steel|iron|copper|tin|silver|block_of|deepslate|obsidian/.test(bn) ? 'pick' : /log|plank|wood|stem/.test(bn) ? 'axe' : /dirt|sand|gravel|soil|mud|clay|snow/.test(bn) ? 'shovel' : 'any';
      b.tier = NEED[4].has(full) ? 4 : NEED[3].has(full) ? 3 : NEED[2].has(full) ? 2 : b.tool === 'pick' ? 1 : 0;
      b.hardness = hard(/ore/.test(bn) ? 3 : /obsidian/.test(bn) ? 50 : /log|plank|wood/.test(bn) ? 2 : /dirt|sand|gravel|soil/.test(bn) ? .6 : /leaves/.test(bn) ? .2 : /glass|pane/.test(bn) ? .3 : kind === 'cross' || kind === 'torch' ? 0 : 1.5);
      b.sound = b.sound || (/glass|pane|ice|crystal/.test(bn) ? 'glass' : /log|plank|wood/.test(bn) ? 'wood' : /dirt|soil|mud/.test(bn) ? 'dirt' : /sand/.test(bn) ? 'sand' : /gravel/.test(bn) ? 'gravel' : /wool|carpet/.test(bn) ? 'wool' : kind === 'cross' ? 'grass' : /iron|steel|metal|copper|block/.test(bn) && !/stone|brick/.test(bn) ? 'metal' : 'stone');
      const dr = loot(bn);
      if (dr === null) b.drop = '';
      else if (dr && dr !== full) b._drop = dr;
      if (kind === 'wall' || kind === 'pane' || /_slab|_stairs|_fence|_wall/.test(bn)) notePush(rep, `блок ${bn}: форма упрощена до кубика`);
      b._mc = full;   // постройки и миры с этим модом → этот блок (таблица «minecraft» в mod.json)
      blocks.push(b); own.set(full, nm);
    }
    // ── предметы (не блоки): models/item/*.json с item/generated, item/handheld; новые — assets/<ns>/items/*.json ──
    const usedI = new Set(usedB);
    const itemFiles = Object.keys(files).filter(p => p.startsWith(`assets/${ns}/models/item/`) && p.endsWith('.json')).sort();
    for (const p of itemFiles) {
      const n = p.slice(`assets/${ns}/models/item/`.length, -5);
      if (own.has(ns + ':' + n) || n.includes('/')) continue;
      const j = tryJson(files[p]); if (!j) continue;
      const par = String(j.parent || '');
      if (par && !/item\/(generated|handheld|handheld_rod)/.test(par) && !(j.textures && j.textures.layer0)) continue;   // предмет-блок или особая модель
      const tx = texOf(j.textures?.layer0); if (!tx) { skip(rep, `предмет ${n}: нет картинки`); continue; }
      const nm = local(n, usedI), it = { id: nm, name: title('item', n), texture: tx };
      const tm = /_(pickaxe|axe|shovel|spade|sword|hoe|paxel)$/.exec(n);
      if (tm) {
        const mat = n.slice(0, -tm[0].length), tier = /wood/.test(mat) ? 1 : /stone/.test(mat) ? 2 : /gold/.test(mat) ? 2 : /diamond|netherite|obsidian/.test(mat) ? 4 : 3;
        const type = { pickaxe: 'pickaxe', paxel: 'pickaxe', axe: 'axe', shovel: 'shovel', spade: 'shovel', sword: 'sword', hoe: 'shovel' }[tm[1]];
        it.tool = { type, tier, power: [0, 20, 40, 60, 80][tier], durability: [0, 60, 130, 250, 1561][tier], damage: type === 'sword' ? 3 + tier : 1 + tier };
      } else if (/(^|_)(cooked|raw|apple|bread|berry|berries|stew|soup|pie|cookie|cake|carrot|potato|fish|steak|sandwich|candy|juice|jerky)($|_)/.test(n)) it.food = { hunger: /cooked|steak|stew|soup|pie|sandwich/.test(n) ? 6 : 3, saturation: /cooked|steak|stew/.test(n) ? 7 : 2 };
      items.push(it); own.set(ns + ':' + n, nm);
    }
    // ── рецепты (data/<ns>/recipe(s)) ──
    const ctx = { own, tags: tagMap(files), mods: null };
    const recipes = [];
    for (const [p, f] of Object.entries(files)) {
      const m = /^data\/([^/]+)\/recipes?\/(.+)\.json$/.exec(p); if (!m) continue;
      const j = tryJson(f); if (!j) continue;
      const r = MC.recipeJava(j, ctx);
      if (r.recipe) recipes.push(r.recipe); else skip(rep, `рецепт ${m[2]} — ${r.skip}`);
    }
    // добыча (drop) — после предметов
    for (const b of blocks) if (b._drop) { const d = ctx.own.get(b._drop.includes(':') ? b._drop : 'minecraft:' + b._drop) || MC.item(b._drop); if (d) b.drop = d; delete b._drop; }
    const base = { name: (info.name || ns).slice(0, 34), version: ver(info.version), author: String(info.authors || '').slice(0, 40), description: (`Перенесено из мода Java «${info.name || ns}»: блоки, предметы, рецепты и картинки. Код мода (.class) не запускается — поведение можно написать скриптом.` + (info.description ? ' ' + String(info.description) : '')).slice(0, 390) };
    const res = split(modId(ns), base, blocks, items, recipes, texOut, rep);
    // таблица переноса: блоки этого мода в постройках и мирах Minecraft → блоки «Кубомира»
    rep.blocks = blocks.length; rep.items = items.length; rep.recipes = recipes.length;
    if (rep.classes) notePush(rep, `код мода (${rep.classes} файлов .class) не запускается в браузере — его поведение можно переписать на Java (как в Майнкрафте) по инструкции «Перенос из Minecraft»`);
    return { mods: res, report: rep, ns, info };
  };
  // наши текстуры ← имена текстур Minecraft (для ссылок модов на ванильные картинки и для пакетов текстур)
  const OUR_TEX = {
    stone: 'stone', cobble: 'cobblestone', dirt: 'dirt', grass_top: 'grass_block_top|grass_top', grass_side: 'grass_block_side|grass_side_carried|grass_side', sand: 'sand', gravel: 'gravel',
    bedrock: 'bedrock', water: 'water_still|water_placeholder', lava: 'lava_still|lava_placeholder', log_oak_top: 'oak_log_top|log_oak_top', log_oak: 'oak_log|log_oak', leaves_oak: 'oak_leaves|leaves_oak',
    planks_oak: 'oak_planks|planks_oak', log_birch_top: 'birch_log_top|log_birch_top', log_birch: 'birch_log|log_birch', leaves_birch: 'birch_leaves|leaves_birch', log_spruce_top: 'spruce_log_top|log_spruce_top',
    log_spruce: 'spruce_log|log_spruce', leaves_spruce: 'spruce_leaves|leaves_spruce', sandstone_top: 'sandstone_top', sandstone: 'sandstone|sandstone_normal', snow: 'snow', ice: 'ice', clay: 'clay',
    ore_coal: 'coal_ore', ore_iron: 'iron_ore', ore_gold: 'gold_ore', ore_diamond: 'diamond_ore', glass: 'glass', cactus_top: 'cactus_top', cactus_side: 'cactus_side',
    tall_grass: 'short_grass|grass|tallgrass', flower_yellow: 'dandelion|flower_dandelion', flower_red: 'poppy|flower_rose', dead_bush: 'dead_bush|deadbush', torch: 'torch|torch_on',
    table_top: 'crafting_table_top', table_side: 'crafting_table_side', table_front: 'crafting_table_front', furnace_top: 'furnace_top', furnace_side: 'furnace_side',
    furnace_front: 'furnace_front|furnace_front_off', furnace_front_lit: 'furnace_front_on', ladder: 'ladder', door_top: 'oak_door_top|door_wood_upper', door_bottom: 'oak_door_bottom|door_wood_lower',
    bricks: 'bricks|brick', stone_bricks: 'stone_bricks|stonebrick', lamp: 'glowstone', obsidian: 'obsidian', iron_block: 'iron_block', gold_block: 'gold_block', diamond_block: 'diamond_block',
    snow_grass_side: 'grass_block_snow|grass_side_snowed', planks_birch: 'birch_planks|planks_birch', planks_spruce: 'spruce_planks|planks_spruce', sapling_oak: 'oak_sapling|sapling_oak',
    sapling_birch: 'birch_sapling|sapling_birch', sapling_spruce: 'spruce_sapling|sapling_spruce', mossy_cobble: 'mossy_cobblestone|cobblestone_mossy', bouncer: 'slime_block|slime',
    item_stick: 'stick', item_coal: 'coal', item_iron_ingot: 'iron_ingot', item_gold_ingot: 'gold_ingot', item_diamond: 'diamond', item_clay_ball: 'clay_ball', item_brick: 'brick',
    item_apple: 'apple', item_meat_raw: 'beef|beef_raw', item_meat_cooked: 'cooked_beef|beef_cooked', item_chicken_raw: 'chicken|chicken_raw', item_chicken_cooked: 'cooked_chicken|chicken_cooked',
    item_feather: 'feather', item_slime_ball: 'slime_ball|slimeball', item_door: 'oak_door|door_wood',
  };
  for (const [m, mc] of [['wood', 'wooden|wood'], ['stone', 'stone'], ['iron', 'iron'], ['gold', 'golden|gold'], ['diamond', 'diamond']])
    for (const [k, t] of [['pick', 'pickaxe'], ['axe', 'axe'], ['shovel', 'shovel'], ['sword', 'sword']]) OUR_TEX[`item_${k}_${m}`] = mc.split('|').map(x => x + '_' + t).join('|');
  const OUR_TEX_BY_MC = new Map();
  for (const [our, mcs] of Object.entries(OUR_TEX)) for (const n of mcs.split('|')) if (!OUR_TEX_BY_MC.has(n)) OUR_TEX_BY_MC.set(n, our);
  MC.OUR_TEX = OUR_TEX;

  // большой мод — на части по ограничениям общего формата (блоков 64, предметов 128, рецептов 256, картинок 250); ссылки между
  // частями — полными именами «часть:имя»
  function split(baseId, base, blocks, items, recipes, texOut, rep){
    const parts = [];
    const newPart = () => { const i = parts.length; const p = { id: i ? (baseId.slice(0, 28) + '-' + (i + 1)) : baseId, blocks: [], items: [], recipes: [], tex: new Map(), bytes: 0 }; parts.push(p); return p; };
    let cur = newPart();
    const owner = new Map();   // наше имя → часть
    const texByName = new Map([...texOut.values()].map(t => [t.name, t]));
    const texNeed = obj => [obj.texture, ...Object.values(obj.faces || {})].filter(x => typeof x === 'string' && x[0] !== '@');
    const fits = (p, obj, isB) => {
      const need = texNeed(obj).filter(t => !p.tex.has(t)), add = need.reduce((a, t) => a + (texByName.get(t)?.bytes.length || 0), 0);
      return (isB ? p.blocks.length < LIM.blocks : p.items.length < LIM.items) && p.tex.size + need.length <= LIM.textures && p.bytes + add <= LIM.texBytes;
    };
    const place = (obj, isB) => {
      if (!fits(cur, obj, isB)) cur = newPart();
      (isB ? cur.blocks : cur.items).push(obj); owner.set(obj.id, cur);
      for (const t of texNeed(obj)) if (!cur.tex.has(t)) { const T = texByName.get(t); if (T) { cur.tex.set(t, T); cur.bytes += T.bytes.length; } }
    };
    for (const b of blocks) place(b, true);
    for (const it of items) place(it, false);
    // ссылка из части p на имя n: своё — как есть; другой части — «часть:имя»; ванильное или «#тег» — как есть
    const refIn = (p, n) => { const o = owner.get(n); return !o || o === p ? n : o.id + ':' + n; };
    for (const r of recipes) {
      const p = owner.get(r.result) || parts[0];
      if (p.recipes.length >= LIM.recipes) { skip(rep, 'рецептов больше ' + LIM.recipes + ' в части — лишние пропущены'); continue; }
      const c = JSON.parse(JSON.stringify(r));
      c.result = refIn(p, c.result);
      if (c.key) for (const k of Object.keys(c.key)) c.key[k] = refIn(p, c.key[k]);
      if (c.ingredients) c.ingredients = c.ingredients.map(([n, q]) => [refIn(p, n), q]);
      p.recipes.push(c);
    }
    for (const p of parts) for (const b of p.blocks) if (typeof b.drop === 'string' && b.drop) b.drop = refIn(p, b.drop);
    // ванильные картинки «@имя» → имя текстуры «Кубомира» (её знает игра)
    const fix = v => typeof v === 'string' && v[0] === '@' ? v.slice(1) : v;
    const out = [];
    parts.forEach((p, i) => {
      for (const o of [...p.blocks, ...p.items]) { if (o.texture) o.texture = fix(o.texture); if (o.faces) for (const k of Object.keys(o.faces)) o.faces[k] = fix(o.faces[k]); }
      const textures = {}, files = {};
      for (const [nm, T] of p.tex) { textures[nm] = T.path; files[T.path] = T.bytes; }
      const mcMap = {};
      for (const b of p.blocks) if (b._mc) { mcMap[b._mc] = p.id + ':' + b.id; delete b._mc; }
      const manifest = Object.assign({ id: p.id, game: 'voxel', api: 1 }, base, { name: (base.name + (parts.length > 1 ? ` (${i + 1}/${parts.length})` : '')).slice(0, 40), textures, blocks: p.blocks, items: p.items, recipes: p.recipes });
      if (Object.keys(mcMap).length) manifest.minecraft = { blocks: mcMap };
      files['mod.json'] = JSON.stringify(manifest, null, 1);
      out.push({ manifest, files });
    });
    rep.textures = texOut.size;
    if (parts.length > 1) notePush(rep, `мод большой — разделён на ${parts.length} части (так требует общий формат модов); включай их вместе`);
    return out;
  }

  // ═══ Дополнение Bedrock (.mcaddon / .mcpack): пакеты поведения и ресурсов ═══
  MC.addon = (files, name) => {
    const rep = newReport();
    // пакеты: каждая папка с manifest.json (в .mcaddon — бывает вложенный .mcpack, его распаковали раньше)
    const packs = [];
    for (const p of Object.keys(files)) if (/(^|\/)manifest\.json$/.test(p)) {
      const dir = p.slice(0, -'manifest.json'.length), m = tryJson(files[p]); if (!m?.header) continue;
      const mods = (m.modules || []).map(x => x.type);
      packs.push({ dir, m, kind: mods.includes('data') || mods.includes('script') ? 'bp' : mods.includes('resources') ? 'rp' : 'other', script: (m.modules || []).find(x => x.type === 'script') });
    }
    if (!packs.length) throw new Error('в дополнении нет manifest.json');
    const RP = packs.filter(p => p.kind === 'rp'), BP = packs.filter(p => p.kind === 'bp');
    const fileIn = (P, path) => files[P.dir + path];
    // ресурсы: короткое имя картинки → путь (terrain_texture.json, item_texture.json), имена из .lang
    const terrain = new Map(), itemTex = new Map(), lang = {};
    for (const P of RP) {
      const tt = tryJson(fileIn(P, 'textures/terrain_texture.json') || '');
      for (const [k, v] of Object.entries(tt?.texture_data || {})) { const t = v?.textures, path = typeof t === 'string' ? t : Array.isArray(t) ? (typeof t[0] === 'string' ? t[0] : t[0]?.path) : t?.path; if (path) terrain.set(k, { P, path }); }
      const it = tryJson(fileIn(P, 'textures/item_texture.json') || '');
      for (const [k, v] of Object.entries(it?.texture_data || {})) { const t = v?.textures, path = typeof t === 'string' ? t : Array.isArray(t) ? (typeof t[0] === 'string' ? t[0] : t[0]?.path) : t?.path; if (path) itemTex.set(k, { P, path }); }
      for (const lf of ['texts/ru_RU.lang', 'texts/en_US.lang']) {
        const L = fileIn(P, lf); if (!L) continue;
        for (const line of text(L).split(/\r?\n/)) { const m = /^([^#=][^=]*)=(.*)$/.exec(line); if (m && !(m[1].trim() in lang)) lang[m[1].trim()] = m[2].replace(/\t*#.*$/, '').trim(); }
      }
    }
    const blocksJson = Object.assign({}, ...RP.map(P => tryJson(fileIn(P, 'blocks.json') || '') || {}));
    const usedTex = new Set(), texOut = new Map();
    const texFrom = (map, short) => {
      if (!short) return null;
      const key = 'b:' + short; if (texOut.has(key)) return texOut.get(key).name;
      const e = map.get(short); if (!e) return null;
      const f = fileIn(e.P, e.path + '.png') || fileIn(e.P, e.path + '.tga'); if (!f || !/\.png$/.test(e.path + '.png') || !files[e.P.dir + e.path + '.png']) return null;
      const nm = local(short, usedTex); texOut.set(key, { name: nm, path: 'textures/' + nm + '.png', bytes: files[e.P.dir + e.path + '.png'] }); return nm;
    };
    // ── блоки ──
    const blocks = [], items = [], own = new Map(), usedB = new Set(), drops = [];
    const nsOf = id => String(id).split(':')[0];
    for (const P of BP) for (const p of Object.keys(files).filter(k => k.startsWith(P.dir + 'blocks/') && k.endsWith('.json'))) {
      const j = tryJson(files[p]); const B = j?.['minecraft:block']; if (!B) continue;
      const id = B.description?.identifier; if (!id) continue;
      const C = B.components || {}, short = id.split(':')[1], nm = local(short, usedB);
      const b = { id: nm, name: (lang[`tile.${id}.name`] || short.replace(/_/g, ' ')).slice(0, 40) };
      // картинки: material_instances (новые), иначе blocks.json (старые)
      const MI = C['minecraft:material_instances'] || {};
      const mt = k => MI[k]?.texture || (typeof MI[k] === 'string' ? MI[MI[k]]?.texture : null);
      let faces = {};
      if (MI['*'] || MI.up || MI.north) {
        const all = mt('*'), up = mt('up') || all, down = mt('down') || all, side = mt('north') || mt('side') || all;
        faces = { top: texFrom(terrain, up), bottom: texFrom(terrain, down), side: texFrom(terrain, side) };
        const rm = MI['*']?.render_method || MI.up?.render_method;
        if (rm && rm !== 'opaque') b.transparent = true;
      } else {
        const bj = blocksJson[id] || blocksJson[short], tx = bj?.textures;
        if (typeof tx === 'string') faces = { all: texFrom(terrain, tx) };
        else if (tx && typeof tx === 'object') faces = { top: texFrom(terrain, tx.up), bottom: texFrom(terrain, tx.down), side: texFrom(terrain, tx.side || tx.north) };
        if (bj?.sound) b.sound = ({ glass: 'glass', wood: 'wood', gravel: 'gravel', sand: 'sand', grass: 'grass', snow: 'snow', metal: 'metal', cloth: 'wool' })[bj.sound] || undefined;
      }
      const fx = {}; for (const [k, v] of Object.entries(faces)) if (v) fx[k] = v;
      if (!Object.keys(fx).length) { skip(rep, `блок ${id}: нет картинки (нужен пакет ресурсов в том же .mcaddon)`); continue; }
      if (fx.top && fx.top === fx.bottom && fx.top === fx.side) b.texture = fx.top; else if (fx.all) b.texture = fx.all; else b.faces = fx;
      const geo = C['minecraft:geometry']; const gid = typeof geo === 'string' ? geo : geo?.identifier;
      if (gid && gid !== 'minecraft:geometry.full_block') { if (/cross|plant|flower/.test(gid)) b.shape = 'cross'; else notePush(rep, `блок ${id}: своя форма (${gid}) — будет кубиком`); }
      const le = C['minecraft:light_emission'] ?? (C['minecraft:block_light_emission'] != null ? Math.round(C['minecraft:block_light_emission'] * 15) : null);
      if (le) b.light = Math.max(0, Math.min(15, le | 0));
      const dt = C['minecraft:destructible_by_mining']?.seconds_to_destroy ?? C['minecraft:destroy_time'] ?? (C['minecraft:destructible_by_mining'] === false ? -1 : null);
      if (dt === -1) b.hardness = -1; else if (dt != null) b.hardness = hard(+dt / 1.5);
      const fr = C['minecraft:friction']; if (typeof fr === 'number' && fr < .4) b.slip = Math.min(.98, .6 + (.4 - fr));
      const lt = C['minecraft:loot']; if (typeof lt === 'string') drops.push([b, lt]);
      if (C['minecraft:collision_box'] === false) b.solid = false;
      b._mc = id;
      blocks.push(b); own.set(id, nm);
    }
    // добыча
    for (const [b, lt] of drops) {
      let j = null; for (const P of BP) { j = tryJson(fileIn(P, lt) || ''); if (j) break; }
      const d = j ? MC.lootDrop(j) : null;
      if (d === null && j) b.drop = '';
      else if (d) b._drop = d;
    }
    // ── предметы ──
    const usedI = new Set(usedB);
    for (const P of BP) for (const p of Object.keys(files).filter(k => k.startsWith(P.dir + 'items/') && k.endsWith('.json'))) {
      const j = tryJson(files[p]); const I = j?.['minecraft:item']; if (!I) continue;
      const id = I.description?.identifier; if (!id || own.has(id)) continue;
      const C = I.components || {}, short = id.split(':')[1];
      const ic = C['minecraft:icon'], iname = typeof ic === 'string' ? ic : ic?.texture || ic?.textures?.default;
      const tx = texFrom(itemTex, iname || short);
      if (!tx) { skip(rep, `предмет ${id}: нет картинки`); continue; }
      const nm = local(short, usedI), it = { id: nm, name: (lang[`item.${id}.name`] || lang[`item.${id}`] || short.replace(/_/g, ' ')).slice(0, 40), texture: tx };
      const ms = C['minecraft:max_stack_size']; if (ms) it.stack = typeof ms === 'object' ? ms.value | 0 : ms | 0;
      const food = C['minecraft:food']; if (food) it.food = { hunger: Math.max(1, food.nutrition | 0 || 2), saturation: Math.round((food.nutrition || 2) * (food.saturation_modifier || .6) * 2 * 10) / 10 };
      const dur = C['minecraft:durability']?.max_durability, dmg = C['minecraft:damage'];
      const tags = [].concat(C['minecraft:tags']?.tags || []);
      const type = tags.includes('minecraft:is_pickaxe') || /pickaxe/.test(short) ? 'pickaxe' : tags.includes('minecraft:is_axe') || /_axe$/.test(short) ? 'axe' : tags.includes('minecraft:is_shovel') || /shovel/.test(short) ? 'shovel' : tags.includes('minecraft:is_sword') || /sword/.test(short) ? 'sword' : C['minecraft:digger'] ? 'pickaxe' : '';
      if (type) it.tool = { type, tier: 3, power: 60, durability: dur || 250, damage: typeof dmg === 'number' ? dmg : typeof dmg === 'object' ? dmg.value || 4 : 4 };
      else if (dmg) it.weapon = { damage: Math.round((typeof dmg === 'number' ? dmg : dmg.value || 4) * 45 / 20), durability: dur || 250 };
      const fuel = C['minecraft:fuel']?.duration; if (fuel) it.fuel = Math.max(1, Math.min(600, fuel | 0));
      const bp = C['minecraft:block_placer']?.block; if (bp && own.has(bp)) { notePush(rep, `предмет ${id} ставит блок — в «Кубомире» у блока предмет и так есть`); continue; }
      items.push(it); own.set(id, nm);
    }
    // ── рецепты ──
    const ctx = { own, mods: null };
    const recipes = [];
    for (const P of BP) for (const p of Object.keys(files).filter(k => k.startsWith(P.dir + 'recipes/') && k.endsWith('.json'))) {
      const j = tryJson(files[p]); if (!j) continue;
      const r = MC.recipeBedrock(j, ctx);
      if (r.recipe) recipes.push(r.recipe); else skip(rep, `рецепт ${p.split('/').pop()} — ${r.skip}`);
    }
    for (const b of blocks) if (b._drop) { const d = own.get(b._drop) || MC.item(b._drop, { bedrock: true }); if (d) b.drop = d; delete b._drop; }
    // ── функции и скрипты ──
    const funcs = new Map(), tick = [];
    for (const P of BP) {
      for (const p of Object.keys(files).filter(k => k.startsWith(P.dir + 'functions/') && k.endsWith('.mcfunction'))) funcs.set('bp:' + p.slice(P.dir.length + 'functions/'.length, -'.mcfunction'.length), files[p]);
      const tj = tryJson(fileIn(P, 'functions/tick.json') || ''); for (const v of tj?.values || []) tick.push('bp:' + String(v).replace(/^\//, ''));
    }
    const nEnt = BP.reduce((a, P) => a + Object.keys(files).filter(k => k.startsWith(P.dir + 'entities/') && k.endsWith('.json')).length, 0);
    if (nEnt) notePush(rep, `существа (${nEnt}) — не переносятся (в «Кубомире» свои мобы)`);
    const H = (BP[0] || RP[0]).m.header;
    const lname = lang['pack.name'] || H.name || name || 'Дополнение';
    const base = { name: String(lname).replace(/§./g, '').slice(0, 34), version: ver(H.version), author: 'Bedrock (перенос)', description: ('Перенесено из дополнения Bedrock. ' + String(lang['pack.description'] || H.description || '').replace(/§./g, '')).slice(0, 390) };
    const res = split(modId(String(H.name || name || 'addon').replace(/§./g, '')), base, blocks, items, recipes, texOut, rep);
    // имена в игре («часть:имя») — для функций и скриптов (после деления на части)
    const fullOf = new Map(); for (const m of res) for (const o of [...m.manifest.blocks, ...m.manifest.items]) fullOf.set(o.id, m.manifest.id + ':' + o.id);
    const ownFull = {}; for (const [k, v] of own) if (fullOf.has(v)) ownFull[k] = fullOf.get(v);
    const mapBlock = n => { const s = String(n).replace(/\[.*$/, ''); if (ownFull[s]) return ownFull[s]; const r = MC.resolve(n, { bedrock: true }); return r.name === 'missing' ? null : r.name; };
    const mapItem = n => ownFull[String(n)] || MC.item(n, { bedrock: true });
    const scripts = {}, sdefs = [];
    if (funcs.size) {
      const fj = MC.fnToJs(funcs, { tick, bedrock: true, mapBlock, mapItem });
      rep.functions = funcs.size; Object.assign(rep.unsupported, fj.report.unsupported);
      if (fj.code.length <= LIM.code) { scripts['functions.js'] = fj.code; sdefs.push({ file: 'functions.js', lang: 'js' }); }
    }
    for (const P of BP) {
      if (!P.script) continue;
      const entry = String(P.script.entry || 'scripts/main.js').replace(/^\.?\//, '');
      try {
        const code = MC.bundle(files, P.dir, entry, ownFull);
        if (code.length > LIM.code) { notePush(rep, 'скрипт больше 190 КБ — не перенесён'); continue; }
        const fn = 'mcserver' + (sdefs.length + 1) + '.js'; scripts[fn] = code; sdefs.push({ file: fn, lang: 'js' }); rep.scripts++;
      } catch (e) { notePush(rep, 'скрипт: ' + (e.message || e)); }
    }
    // скрипты — в первую часть
    if (sdefs.length) { const m0 = res[0]; m0.manifest.scripts = sdefs; Object.assign(m0.files, scripts); m0.files['mod.json'] = JSON.stringify(m0.manifest, null, 1); }
    rep.blocks = blocks.length; rep.items = items.length; rep.recipes = recipes.length;
    // пакет ресурсов в дополнении — ещё и пакет текстур (ваниль)
    const rp = RP.length ? MC.respack(Object.fromEntries(Object.entries(files).filter(([k]) => k.startsWith(RP[0].dir)).map(([k, v]) => [k.slice(RP[0].dir.length), v])), lname) : null;
    return { mods: res, report: rep, respack: rp && rp.count ? rp : null };
  };

  // ═══ Сборка модулей скрипта Bedrock (ESM) в один скрипт для песочницы: import/export → свои функции; @minecraft/server → MC.MCSERVER ═══
  MC.bundle = (files, dir, entry, own) => {
    const mods = new Map(), order = [];
    const norm = (from, spec) => { const base = from.split('/').slice(0, -1); for (const s of spec.split('/')) { if (s === '..') base.pop(); else if (s !== '.' && s) base.push(s); } let p = base.join('/'); if (!/\.js$/.test(p)) p += '.js'; return p; };
    const load = p => {
      if (mods.has(p)) return;
      const f = files[dir + p]; if (!f) throw new Error('нет файла ' + p);
      mods.set(p, ''); order.push(p);
      let src = text(f);
      const exps = [];
      src = src.replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (m, what, spec) => {
        const lib = spec.startsWith('@minecraft/') ? spec : null;
        const src2 = lib ? (lib === '@minecraft/server' ? '__mc' : lib === '@minecraft/server-ui' ? '__mcui' : '{}') : (load(norm(p, spec)), `__req(${JSON.stringify(norm(p, spec))})`);
        what = what.trim();
        if (/^\*\s+as\s+(\w+)$/.test(what)) return `const ${what.split(/\s+/).pop()} = ${src2};`;
        const parts = []; let def = null, named = '';
        const mm = /^(\w+)\s*,?\s*(\{[\s\S]*\})?$/.exec(what);
        if (mm && !what.startsWith('{')) { def = mm[1]; named = mm[2] || ''; } else named = what;
        if (def) parts.push(`const ${def} = (${src2}).default;`);
        if (named) parts.push(`const ${named.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')} = ${src2};`);
        return parts.join(' ');
      });
      src = src.replace(/^\s*import\s+['"]([^'"]+)['"];?/gm, (m, spec) => { if (spec.startsWith('@minecraft/')) return ''; load(norm(p, spec)); return `__req(${JSON.stringify(norm(p, spec))});`; });
      src = src.replace(/^(\s*)export\s+default\s+/gm, '$1__exp.default = ');
      src = src.replace(/^(\s*)export\s+(async\s+function\*?|function\*?|class)\s+(\w+)/gm, (m, sp, kw, nm) => { exps.push(nm); return `${sp}${kw} ${nm}`; });
      src = src.replace(/^(\s*)export\s+(const|let|var)\s+(\w+)/gm, (m, sp, kw, nm) => { exps.push(nm); return `${sp}${kw} ${nm}`; });
      src = src.replace(/^(\s*)export\s*\{([^}]*)\}\s*(from\s+['"]([^'"]+)['"])?;?/gm, (m, sp, list, fr, spec) => {
        const items2 = list.split(',').map(s => s.trim()).filter(Boolean).map(s => { const q = s.split(/\s+as\s+/); return [q[0], q[1] || q[0]]; });
        if (spec) { load(norm(p, spec)); return items2.map(([a, b]) => `__exp.${b} = __req(${JSON.stringify(norm(p, spec))}).${a};`).join(' '); }
        return items2.map(([a, b]) => `__exp.${b} = ${a};`).join(' ');
      });
      if (/^\s*import\s*\(/m.test(src) || /\bawait\s+import\(/.test(src)) throw new Error(p + ': import() — не поддерживается');
      mods.set(p, `__mods[${JSON.stringify(p)}] = function (__exp) {\n${src}\n${exps.map(n => `__exp.${n} = ${n};`).join(' ')}\n};\n`);
    };
    load(entry);
    const MAPS = mapsFor(own);
    return `// Перенесено из дополнения Bedrock: скрипт @minecraft/server (модули собраны в один). Слой @minecraft/server — свой, поверх API модов «Кубомира»
const __MAPS = ${JSON.stringify(MAPS)};
const __mc = (${MCSERVER})(mod, world, fx, npc, commands, player, game, __MAPS);
const __mcui = __mc.__ui;
const __mods = {}, __cache = {};
const __req = p => { if (__cache[p]) return __cache[p]; const e = __cache[p] = {}; __mods[p](e); return e; };
${order.map(p => mods.get(p)).join('')}
__req(${JSON.stringify(entry)});
`;
  };
  // имена блоков и предметов: Minecraft → «Кубомир» и обратно (для скриптов)
  function mapsFor(own){
    const b = {}, r = {};
    for (const [k, v] of Object.entries(MC._tables.B)) { const n = typeof v === 'string' ? v : v.b; if (n && n !== 'air') { b['minecraft:' + k] = n; if (!r[n]) r[n] = 'minecraft:' + k; } }
    for (const [k, v] of Object.entries(own || {})) { b[k] = v; r[v] = k; }
    b['minecraft:air'] = 'air'; r.air = 'minecraft:air';
    return { b, r };
  }
  // слой «@minecraft/server» (подмножество): world (события после действий, сообщения, игроки, измерение, счёт, свойства), system
  // (run, runTimeout, runInterval, clearRun), блоки (getBlock / setType / typeId), игрок (sendMessage, teleport, location, имя),
  // ItemStack, BlockPermutation; формы @minecraft/server-ui — заглушки (show() — «отменено»)
  const MCSERVER = function (mod, world, fx, npc, commands, player, game, MAPS){
    const D = { world, player, fx, game, commands };
    const toMc = n => MAPS.r[n] || (String(n).includes(':') ? n : 'minecraft:' + n);
    const fromMc = n => { n = String(n && n.id || n && n.typeId || n || ''); return MAPS.b[n] || MAPS.b['minecraft:' + n] || n.replace(/^minecraft:/, ''); };
    const txt = t => typeof t === 'string' ? t : t && typeof t === 'object' ? (t.rawtext ? t.rawtext.map(x => x.text || x.translate || '').join('') : t.text || t.translate || '') : String(t);
    const sig = ev => ({ _l: [], subscribe(fn){ mod.on(ev, d => { try { fn(this._w ? this._w(d) : d); } catch (e) { mod.log('ошибка: ' + (e && e.message || e)); } }); return fn; }, unsubscribe(){} });
    const loc = (x, y, z) => ({ x, y, z });
    let dim;
    const block = (x, y, z) => {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      const n = D.world.get(x, y, z);
      if (n == null) return undefined;
      const id = toMc(n);
      return { typeId: id, type: { id }, location: loc(x, y, z), x, y, z, dimension: dim, isAir: n === 'air', isLiquid: n === 'water' || n === 'lava',
        permutation: { type: { id }, matches: m => toMc(fromMc(m)) === id, getState: () => undefined },
        setType(t){ D.world.set(x, y, z, fromMc(t)); }, setPermutation(p){ D.world.set(x, y, z, fromMc(p && p.type ? p.type.id : p)); },
        above(k = 1){ return block(x, y + k, z); }, below(k = 1){ return block(x, y - k, z); } };
    };
    dim = { id: 'minecraft:overworld',
      getBlock(l){ return l ? block(l.x, l.y, l.z) : undefined; },
      setBlockType(l, t){ D.world.set(Math.floor(l.x), Math.floor(l.y), Math.floor(l.z), fromMc(t)); },
      runCommand(c){ mod.log('команда «' + String(c).slice(0, 40) + '» — не поддерживается'); return { successCount: 0 }; },
      runCommandAsync(c){ return Promise.resolve(this.runCommand(c)); },
      spawnEntity(id, l){ D.game.spawn(String(id).replace(/^minecraft:/, ''), l.x, l.y, l.z); return { typeId: id }; },
      spawnParticle(id, l){ D.fx.particles(l.x, l.y, l.z, 'spark', 8); },
      playSound(id){ D.fx.sound('click'); }, getPlayers(){ return [P]; }, getEntities(){ return [P]; } };
    const P = {
      typeId: 'minecraft:player', id: 'player', get name(){ return D.player.name; }, get nameTag(){ return D.player.name; },
      get location(){ return loc(D.player.x, D.player.y, D.player.z); }, dimension: dim, isSneaking: false,
      sendMessage(t){ D.player.message(txt(t).slice(0, 120)); }, teleport(l){ D.player.teleport(l.x, l.y, l.z); },
      runCommand(c){ return dim.runCommand(c); }, runCommandAsync(c){ return dim.runCommandAsync(c); },
      getComponent(n){
        n = String(n).replace(/^minecraft:/, '');
        if (n === 'health') return { currentValue: D.player.health, effectiveMax: 20, setCurrentValue(v){ if (v < D.player.health) D.player.hurt(D.player.health - v); else D.player.heal(v - D.player.health); } };
        if (n === 'inventory') return { container: { addItem(s){ D.player.give(fromMc(s.typeId), s.amount || 1); }, size: 36 } };
        return undefined;
      },
      addTag(){}, hasTag(){ return false }, getTags(){ return []; }, playSound(){ D.fx.sound('click'); }, onScreenDisplay: { setActionBar(t){ D.player.message(txt(t).slice(0, 120)); }, setTitle(t){ D.player.message(txt(t).slice(0, 120)); } },
    };
    Object.defineProperty(P, 'isSneaking', { get(){ return D.player.sneaking; } });
    // счёт — mod.storage
    const SBK = 'mc:scores', sb = () => mod.storage.get(SBK) || {};
    const obj = id => ({ id, displayName: id,
      getScore(t){ return (sb()[id] || {})[(t && t.name) || t || 'player'] ?? undefined; },
      setScore(t, v){ const s = sb(); (s[id] = s[id] || {})[(t && t.name) || t || 'player'] = v | 0; mod.storage.set(SBK, s); return true; },
      addScore(t, v){ const s = sb(); const k = (t && t.name) || t || 'player'; (s[id] = s[id] || {})[k] = ((s[id][k] || 0) + (v | 0)); mod.storage.set(SBK, s); return s[id][k]; },
      getParticipants(){ return Object.keys(sb()[id] || {}).map(n => ({ displayName: n })); }, hasParticipant(t){ return ((t && t.name) || t) in (sb()[id] || {}); } });
    const scoreboard = { getObjective(id){ return id in sb() ? obj(id) : undefined; }, addObjective(id){ const s = sb(); if (!s[id]) { s[id] = {}; mod.storage.set(SBK, s); } return obj(id); },
      removeObjective(id){ const s = sb(); delete s[String(id && id.id || id)]; mod.storage.set(SBK, s); return true; }, getObjectives(){ return Object.keys(sb()).map(obj); }, setObjectiveAtDisplaySlot(){} };
    const wrap = (ev, f) => { const s = sig(ev); s._w = f; return s; };
    const after = {
      playerBreakBlock: wrap('blockBreak', d => ({ player: P, block: block(d.x, d.y, d.z), brokenBlockPermutation: { type: { id: toMc(d.block || d.tile) } }, dimension: dim })),
      playerPlaceBlock: wrap('blockPlace', d => ({ player: P, block: block(d.x, d.y, d.z), dimension: dim })),
      chatSend: wrap('chat', d => ({ sender: P, message: d.text })),
      itemUse: wrap('use', d => ({ source: P, itemStack: { typeId: toMc(d.item), amount: 1 } })),
      itemUseOn: wrap('use', d => ({ source: P, block: block(d.x, d.y, d.z), itemStack: { typeId: toMc(d.item), amount: 1 } })),
      playerInteractWithBlock: wrap('use', d => ({ player: P, block: block(d.x, d.y, d.z), itemStack: d.item ? { typeId: toMc(d.item), amount: 1 } : undefined })),
      playerSpawn: wrap('start', () => ({ player: P, initialSpawn: true })),
      worldInitialize: wrap('start', () => ({})), worldLoad: wrap('start', () => ({})),
      entityDie: wrap('mobKill', d => ({ deadEntity: { typeId: 'minecraft:' + d.mob, location: loc(d.x, d.y, d.z) } })),
    };
    const before = { chatSend: after.chatSend, playerBreakBlock: after.playerBreakBlock, itemUse: after.itemUse, playerInteractWithBlock: after.playerInteractWithBlock };
    let tick = 0; setInterval(() => { tick++; }, 50);
    const W = {
      afterEvents: after, beforeEvents: before, events: after,
      sendMessage(t){ D.player.message(txt(t).slice(0, 120)); }, say(t){ D.player.message(txt(t).slice(0, 120)); },
      getPlayers(){ return [P]; }, getAllPlayers(){ return [P]; }, getDimension(){ return dim; }, scoreboard,
      getDynamicProperty(k){ return (mod.storage.get('mc:dp') || {})[k]; }, setDynamicProperty(k, v){ const s = mod.storage.get('mc:dp') || {}; s[k] = v; mod.storage.set('mc:dp', s); },
      getTimeOfDay(){ return Math.round((game.time * 24000 + 18000) % 24000); }, getAbsoluteTime(){ return tick; }, getDay(){ return game.day; },
      playSound(){ D.fx.sound('click'); }, playMusic(){},
    };
    const system = {
      run(fn){ return setTimeout(fn, 0); }, runTimeout(fn, t){ return setTimeout(fn, Math.max(0, t | 0) * 50); },
      runInterval(fn, t){ return setInterval(fn, Math.max(1, t | 0) * 50); }, runJob(gen){ const it = gen; const step = () => { const r = it.next(); if (!r.done) setTimeout(step, 50); }; setTimeout(step, 0); return 0; },
      clearRun(id){ clearTimeout(id); clearInterval(id); }, clearJob(){}, get currentTick(){ return tick; },
      afterEvents: { scriptEventReceive: sig('chat') }, beforeEvents: { watchdogTerminate: sig('chat') },
    };
    class ItemStack { constructor(t, n = 1){ this.typeId = typeof t === 'string' ? t : t && t.id; this.amount = n; } }
    const BlockPermutation = { resolve(id){ return { type: { id }, matches: m => m === id }; } };
    const cancel = () => Promise.resolve({ canceled: true, cancelationReason: 'UserClosed' });
    class Form { constructor(){ return new Proxy(this, { get(t, k){ return k === 'show' ? cancel : () => t; } }); } }
    return { world: W, system, ItemStack, BlockPermutation, Player: Object, Block: Object, GameMode: { survival: 'survival', creative: 'creative', adventure: 'adventure', spectator: 'spectator' },
      EquipmentSlot: { Mainhand: 'Mainhand' }, Direction: { Up: 'Up', Down: 'Down', North: 'North', South: 'South', East: 'East', West: 'West' }, EntityComponentTypes: { Health: 'minecraft:health', Inventory: 'minecraft:inventory' },
      __ui: { ActionFormData: Form, MessageFormData: Form, ModalFormData: Form, FormCancelationReason: { UserClosed: 'UserClosed', UserBusy: 'UserBusy' } } };
  }.toString();
  MC.MCSERVER = MCSERVER;

  // ═══ Пакет текстур (Java: assets/minecraft/textures/block|blocks|item|items; Bedrock: textures/blocks|items) ═══
  MC.respack = (files, name) => {
    const rep = newReport(), tex = {}, mc = {};
    const keys = Object.keys(files);
    let bed = false;
    const pick = (dirs, n) => { for (const d of dirs) { const k = d + n + '.png'; if (files[k]) return k; } return null; };
    const javaB = ['assets/minecraft/textures/block/', 'assets/minecraft/textures/blocks/'], javaI = ['assets/minecraft/textures/item/', 'assets/minecraft/textures/items/'];
    const bedB = ['textures/blocks/'], bedI = ['textures/items/'];
    if (!keys.some(k => k.startsWith('assets/minecraft/textures/')) && keys.some(k => k.startsWith('textures/blocks/') || k.startsWith('textures/items/'))) bed = true;
    const B0 = bed ? bedB : javaB, I0 = bed ? bedI : javaI;
    for (const [our, mcs] of Object.entries(OUR_TEX)) {
      const dirs = our.startsWith('item_') ? I0 : B0;
      for (const n of mcs.split('|')) { const k = pick(dirs, n); if (k) { tex[our] = files[k]; break; } }
    }
    // блоки, которых нет в «Кубомире» (цветные кубики «mc:имя») — их картинки, если есть
    for (const n of Object.keys(MC._tables.COL)) { const k = pick(B0, n); if (k) mc[n] = files[k]; }
    rep.textures = Object.keys(tex).length + Object.keys(mc).length;
    const meta = tryJson(files['pack.mcmeta'] || '') || {}, man = tryJson(files['manifest.json'] || '') || {};
    const title = String(man.header?.name || (typeof meta.pack?.description === 'string' ? meta.pack.description : '') || name || 'Пакет текстур').replace(/§./g, '').slice(0, 40);
    if (!rep.textures) notePush(rep, 'в пакете нет знакомых картинок блоков (нужны assets/minecraft/textures/block или textures/blocks)');
    return { name: title, tex, mc, count: rep.textures, bedrock: bed, report: rep };
  };

  // ═══ Что за содержимое в архиве: пакет данных, мод .jar, дополнение Bedrock, пакет текстур, мир, постройки ═══
  MC.kindOfZip = (files, name) => {
    const keys = Object.keys(files), n = String(name || '').toLowerCase();
    if (/\.jar$/.test(n) || files['fabric.mod.json'] || files['META-INF/mods.toml'] || files['META-INF/neoforge.mods.toml'] || files['quilt.mod.json'] || files['mcmod.info']) return 'jar';
    if (/\.(mcaddon|mcpack)$/.test(n) || keys.some(k => /(^|\/)manifest\.json$/.test(k) && /"modules"/.test(text(files[k]).slice(0, 4000)))) {
      if (keys.some(k => /(^|\/)db\/[^/]+\.(ldb|log)$/.test(k)) && keys.some(k => /level\.dat$/.test(k))) return 'mcworld';
      return 'addon';
    }
    if (/\.mcworld$/.test(n) || keys.some(k => /(^|\/)db\/CURRENT$/.test(k))) return 'mcworld';
    if (keys.some(k => /(^|\/)region\/r\.-?\d+\.-?\d+\.mca$/.test(k))) return 'javaworld';
    if (keys.some(k => /^data\/[^/]+\/(recipes?|functions?|loot_tables?|tags)\//.test(k))) return 'datapack';
    if (keys.some(k => k.startsWith('assets/minecraft/textures/'))) return 'respack';
    if (keys.some(k => /\.(schem|schematic|litematic|mcstructure|nbt)$/i.test(k))) return 'builds';
    return 'unknown';
  };
})();

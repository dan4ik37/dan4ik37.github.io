// ═══════════════════════════════════════
//  D37E.recipes + D37E.search — книга рецептов для любой игры (T-049, docs/plans/kubomir-modpacks.md §4.2; общий модуль §3.3)
// ═══════════════════════════════════════
// Без DOM и Three.js (окно, поток, node). Игра даёт свои списки — переходник (у «Кубомира» — kubomir-recipes.js), потом «Подземье»,
// «Живой город», «Студия 3D», страницы рецептов для поиска (K1.14) — из того же указателя.
//   IX = D37E.recipes.build({ recipes, smelting, tags, items, sources })
//     recipes  — [{ out, n, list: [ид | '#группа'] } | { out, n, pattern: ['##', …], key: { '#': ид }, table, mirror }]
//     smelting — Map(что → { out, time, n }) (печь); tags — { группа: [ид, …] }
//     items    — [{ id, title, cat }] (все вещи: для поиска и списков); sources — [{ item, kind, from, p, n, min, max, minY, maxY, text }]
//   IX.recs — все рецепты (общий вид: { key, out, n, st: 'hand' | 'bench' | 'furnace', w, h, grid: [ид | '#группа' | null], ins: {…}, src })
//   IX.byOut(ид) — как сделать; IX.byIn(ид) — для чего нужно (группы раскрыты); IX.from(ид) — где взять (источники)
//   IX.have(список стопок) → Map(ид → сколько); IX.can(rec, have) → сколько раз хватит (0 — не хватает); IX.need(rec, have) → [[ид, надо, есть]]
//   IX.craftable(have, { bench }) → рецепты, на которые хватает (верстак — если есть), по одному на вещь
//   IX.search(запрос, ids?) → ид по убыванию совпадения (D37E.search: начало слова, внутри, синонимы, ё = е, латиница игры)
//   IX.stats — сколько рецептов и время построения (мс)
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const now = () => (root.performance && root.performance.now) ? root.performance.now() : Date.now();

  // ═══ Поиск: одна функция на все списки (рецепты, вещи, каталог, клавиши) ═══
  // синонимы: что могут набрать (по-русски и латиницей) → слова, которые есть в названиях
  const SYN = {
    кирк: ['pick'], pick: ['кирка'], топор: ['axe'], axe: ['топор'], лопат: ['shovel'], shovel: ['лопата'], меч: ['sword'], sword: ['меч'],
    дерев: ['бревно', 'доски', 'log', 'planks'], wood: ['бревно', 'доски'], log: ['бревно'], plank: ['доски'], доск: ['planks'],
    камен: ['камень', 'булыжник', 'stone', 'cobble'], stone: ['камень'], желез: ['iron'], iron: ['железн'], золот: ['gold'], gold: ['золот'],
    алмаз: ['diamond'], diamond: ['алмаз'], уголь: ['coal'], coal: ['уголь'], факел: ['torch'], torch: ['факел'], еда: ['мясо', 'яблоко', 'курица'],
    свет: ['факел', 'лампа'], дом: ['дверь', 'лежанка', 'кровать'], кроват: ['лежанка'], bed: ['лежанка'], карт: ['атлас', 'лист карты'], map: ['карт'],
    ведр: ['ведро'], bucket: ['ведро'], часы: ['watch'], компас: ['compass'], лупа: ['lens'], книг: ['книга'], стекл: ['glass'], glass: ['стекло'],
  };
  const norm = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
  // совпадение запроса q (уже norm) с текстом: 3 — с начала, 2 — с начала слова, 1 — внутри, 0 — нет
  function hit(q, text){
    const t = norm(text); if (!q || !t) return 0;
    const i = t.indexOf(q); if (i < 0) return 0;
    if (i === 0) return 3;
    const ch = t[i - 1]; return ch === ' ' || ch === '_' || ch === '-' || ch === ':' || ch === '(' ? 2 : 1;
  }
  // оценка: все слова запроса должны найтись (в названии, имени или через синоним); больше — лучше
  function score(q0, title, name){
    const words = norm(q0).split(/\s+/).filter(Boolean); if (!words.length) return 0;
    let s = 0;
    for (const w of words) {
      let best = Math.max(hit(w, title) * 2, hit(w, name));
      if (!best) for (const k in SYN) if (w.startsWith(k) || (k.startsWith(w) && w.length >= 3)) for (const alt of SYN[k]) best = Math.max(best, hit(norm(alt), title), hit(norm(alt), name));
      if (!best) return 0;
      s += best;
    }
    return s;
  }
  E.search = { norm, hit, score, SYN };

  // ═══ Указатель рецептов ═══
  function build(o = {}){
    const t0 = now(), tags = o.tags || {}, recs = [], byOut = new Map(), byIn = new Map(), from = new Map();
    const push = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, a = []); if (!a.includes(v)) a.push(v); };
    const members = k => k[0] === '#' ? (tags[k.slice(1)] || []) : [k];
    let n = 0;
    for (const r of o.recipes || []) {
      if (!r || !r.out) continue;
      let grid, w, h; const ins = {};
      if (r.list) { w = r.list.length > 4 ? 3 : 2; h = Math.ceil(r.list.length / w); grid = r.list.slice(); while (grid.length < w * h) grid.push(null); for (const k of r.list) ins[k] = (ins[k] || 0) + 1; }
      else { h = r.pattern.length; w = Math.max(...r.pattern.map(s => s.length)); grid = []; for (const row of r.pattern) for (let x = 0; x < w; x++) { const ch = row[x] || ' ', k = ch === ' ' ? null : r.key[ch] || null; grid.push(k); if (k) ins[k] = (ins[k] || 0) + 1; } }
      const st = r.table || w > 2 || h > 2 ? 'bench' : 'hand';
      const rec = { key: r.out + '#' + (n++), out: r.out, n: r.n || 1, st, w, h, grid, ins, src: r.mod || r.src || 'vanilla', r };
      recs.push(rec); push(byOut, r.out, rec);
      for (const k in ins) for (const id of members(k)) push(byIn, id, rec);
    }
    for (const [inp, s] of o.smelting || []) {
      const rec = { key: s.out + '#f' + (n++), out: s.out, n: s.n || 1, st: 'furnace', w: 1, h: 1, grid: [inp], ins: { [inp]: 1 }, time: s.time, src: 'vanilla' };
      recs.push(rec); push(byOut, s.out, rec); push(byIn, inp, rec);
      push(from, s.out, { item: s.out, kind: 'smelt', from: inp });
    }
    for (const s of o.sources || []) if (s && s.item) push(from, s.item, s);
    const items = Array.isArray(o.items) ? o.items : [];
    const IX = { recs, items, tags, stats: { recipes: recs.length, items: items.length, ms: 0 } };
    IX.byOut = id => byOut.get(id) || [];
    IX.byIn = id => byIn.get(id) || [];
    IX.from = id => from.get(id) || [];
    IX.members = members;
    // что есть: стопки → Map(ид → сколько) (инструменты — не ингредиенты)
    IX.have = (stacks, isTool) => { const m = new Map(); for (const s of stacks || []) if (s && s.n > 0 && !(isTool && isTool(s.id))) m.set(s.id, (m.get(s.id) || 0) + s.n); return m; };
    // сколько раз хватит на рецепт: под каждый ключ — любые из группы (одна вещь не идёт в два ключа сразу: жадно по убыванию)
    IX.can = (rec, have) => {
      let times = Infinity;
      const left = new Map(have);
      // точные вещи сначала, группы — потом (из того, что осталось)
      const keys = Object.keys(rec.ins).sort((a, b) => (a[0] === '#') - (b[0] === '#'));
      for (const k of keys) {
        const need = rec.ins[k]; let got = 0;
        for (const id of members(k)) got += left.get(id) || 0;
        const t = Math.floor(got / need); times = Math.min(times, t);
        if (!t) return 0;
        // снять, сколько ушло бы на t раз (для следующих ключей)
        let take = need * t; for (const id of members(k)) { const q = Math.min(take, left.get(id) || 0); if (q) { left.set(id, left.get(id) - q); take -= q; } }
      }
      return times === Infinity ? 0 : times;
    };
    IX.need = (rec, have) => Object.keys(rec.ins).map(k => { let got = 0; for (const id of members(k)) got += have.get(id) || 0; return [k, rec.ins[k], got]; });
    IX.craftable = (have, o2 = {}) => {
      const out = [], seen = new Set();
      for (const rec of recs) {
        if (rec.st === 'furnace' || seen.has(rec.out)) continue;
        if (rec.st === 'bench' && o2.bench === false) continue;
        if (!IX.can(rec, have)) continue;
        seen.add(rec.out); out.push(rec);
      }
      return out;
    };
    IX.search = (q, ids) => {
      const list = ids || items.map(i => i.id), res = [];
      if (!norm(q)) return list.slice();
      const byId = IX.itemBy || (IX.itemBy = new Map(items.map(i => [i.id, i])));
      for (const id of list) { const it = byId.get(id), s = score(q, it ? it.title : id, id); if (s) res.push([s, id]); }
      res.sort((a, b) => b[0] - a[0]);
      return res.map(a => a[1]);
    };
    IX.stats.ms = +(now() - t0).toFixed(3);
    return IX;
  }
  E.recipes = { build };
})();

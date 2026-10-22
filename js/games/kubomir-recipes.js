// ═══════════════════════════════════════
//  «КУБОМИР» — 📖 книга рецептов (T-049, docs/plans/kubomir-modpacks.md §4.2 + решение владельца §7½: полная книга открывается
//  предметом — «Книгой мастера»; простое «📖 Можно сделать» в окне вещей остаётся у всех)
// ═══════════════════════════════════════
// Прочитал «Книгу мастера» (ПКМ, книга уходит) — навсегда в этом мире у этого игрока (P.ext.flags.recipes): R, ☰ → 📖, кнопка 📖 в
// окне вещей. Лист (D37E.sheet): «✅ Можно» (хватает вещей; 🛠 — на верстаке), «📚 Все», «★» (избранное, до 100); поиск (кирка, pick,
// факел, железо…); карточка вещи: как сделать (сетка, станок, чего сколько есть), «Положить в сетку» (если открыт верстак / вещи),
// для чего нужно, где взять (из какого блока и с каким шансом, руда — на какой высоте, существа, печь, «зарисуй место»).
// Указатель — D37E.recipes (js/engine/recipes.js, общий для игр): строится один раз на мир (моды мира — свои рецепты).
(() => {
  const VX = () => window.D37E.vox, E = () => window.D37E;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // что встречается в мире само (для «где взять»: «в мире: …»); остальное своё — только из рецептов
  const NATURAL = new Set(['grass', 'dirt', 'stone', 'cobble', 'sand', 'gravel', 'clay', 'snow', 'ice', 'sandstone', 'snow_grass', 'cactus', 'flower_yellow', 'flower_red', 'tall_grass', 'dead_bush',
    'log_oak', 'log_birch', 'log_spruce', 'leaves_oak', 'leaves_birch', 'leaves_spruce', 'ore_coal', 'ore_iron', 'ore_gold', 'ore_diamond', 'mossy_cobble', 'obsidian']);
  const MOB_IC = { cow: '🐄', pig: '🐖', chicken: '🐔', zombie: '🧟', slime: '🟩' };
  const ST = { hand: ['✋', 'в руках (2×2)'], bench: ['🛠', 'на верстаке'], furnace: ['🔥', 'в печи'] };
  window.KubomirX?.feature((st, X) => {
    const g = X.g, P = st.P, flags = X.ext('flags');
    let IX = null, view = { item: null, stack: [] }, vl = null;
    const fav = () => { const o = X.ext('fav'); if (!Array.isArray(o.ids)) o.ids = []; return o.ids; };
    const f = { id: 'recipes', title: 'Книга рецептов', order: 20 };
    f.known = () => !!flags.recipes || !!st.creative;
    X.recipesKnown = f.known;
    X.openRecipes = id => open(id);
    // ── «Книга мастера»: прочитать (ПКМ) — книга уходит, открывается полная книга рецептов ──
    f.useItem = (s, it, which) => {
      if (it.use !== 'learn') return false;
      if (f.known()) { g.toast?.('📖 Ты уже знаешь все рецепты: ' + (g.label?.('recipes') || 'R') + ' или ☰ → 📖'); return true; }
      flags.recipes = 1; g.take?.(which);
      g.sound?.('coin', { vol: .5, rate: .9 });
      g.toast?.('📖 Книга мастера прочитана: теперь видно ВСЕ рецепты — ' + (g.label?.('recipes') || 'R') + ', ☰ → 📖 или 📖 в окне вещей', true);
      X.emit('quest', 'learn', 'recipes');
      open();
      return true;
    };
    f.menu = () => [{ id: 'x:recipes', icon: '📖', text: f.known() ? 'Книга рецептов' : 'Книга рецептов 🔒' }];
    f.pick = id => { if (id !== 'x:recipes') return false; open(); return true; };
    // R — открыть / закрыть (и поверх окна вещей)
    f.update = () => { const K = st.K; if (K?.downRaw?.('recipes') && !st.chatEl && !st.menu && !st.P.dead) { if (X.isOpen() && X.sheet.id === 'recipes') X.closeSheet(); else open(); } };
    f.dispose = () => { vl?.dispose(); vl = null; };

    // ── указатель: рецепты, печь, группы, вещи, где взять ──
    function ensure(){
      if (IX) return IX;
      const V = VX(), items = V.items.map(i => ({ id: i.name, title: i.title || i.name })), src = [];
      for (const b of V.blocks) {
        if (!b || b.id === 0 || b.liquid) continue;
        if (b.drop && V.item(b.drop) && (b.drop !== b.name || NATURAL.has(b.name) || b.mod)) src.push({ item: b.drop, kind: b.drop === b.name ? 'world' : 'block', from: b.name, p: 1, n: 1 });
      }
      for (const name in V.DROPS || {}) for (const [id, p, n] of V.DROPS[name]) src.push({ item: id, kind: 'block', from: name, p, n });
      for (const o of st.G?.ores || []) { const b = V.blocks[o.b]; if (b) src.push({ item: b.name, kind: 'ore', minY: o.minY, maxY: o.maxY }); }
      for (const [type, M] of Object.entries(window.KubomirEnts?.MOBS || {})) for (const [id, mn, mx] of M.drops || []) src.push({ item: id, kind: 'mob', from: type, min: mn, max: mx });
      src.push({ item: 'map_filled', kind: 'use', from: 'map_blank', text: 'Зарисуй новое место: ПКМ с «Чистым листом карты» (в одном месте — один лист)' });
      src.push({ item: 'bucket_water', kind: 'use', from: 'bucket', text: 'Черпни ведром воду (ПКМ по воде)' }, { item: 'bucket_lava', kind: 'use', from: 'bucket', text: 'Черпни ведром лаву — осторожно!' });
      for (const s of ['sapling_oak', 'sapling_birch', 'sapling_spruce', 'apple', 'log_oak', 'log_birch', 'log_spruce']) src.push({ item: s, kind: 'tree', text: 'Подрубленное дерево падает — брёвна, ростки и яблоки выпадают сами' });
      IX = E().recipes.build({ recipes: V.recipes, smelting: V.smelting, tags: V.TAGS, items, sources: src });
      return IX;
    }
    const have = () => { const C = st.ui?.isOpen?.() ? st.ui.craft : null; return ensure().have([...P.inv, P.off, ...(C || [])], id => !!VX().item(id)?.tool); };

    // ── лист ──
    function open(id){
      const V = VX();
      if (X.isOpen() && X.sheet.id === 'recipes') { if (id) { go(id); } else X.closeSheet(); return; }
      if (!f.known()) { lockedSheet(); return; }
      ensure();
      view = { item: id && V.item(id) ? id : null, stack: [] };
      X.open({ id: 'recipes', title: '📖 Книга рецептов', tabs: [{ id: 'can', label: '✅ Можно' }, { id: 'all', label: '📚 Все' }, { id: 'fav', label: '★ Избранное' }], tab: 'can',
        search: { ph: 'Найти: кирка, факел, железо…' }, render, onBack: back, onTab: () => { view.item = null; view.stack.length = 0; },
        onSearch: () => { view.item = null; view.stack.length = 0; }, onClose: () => { vl?.dispose(); vl = null; } });
    }
    function go(id){ if (!X.isOpen()) return; if (view.item && view.item !== id) view.stack.push(view.item); view.item = id; X.sheet.body.scrollTop = 0; X.sheet.redraw(); }
    function back(){ if (!view.item) return false; view.item = view.stack.pop() || null; X.sheet.redraw(); return true; }
    function render(body, ctx){
      const sh = ctx.sh;
      sh.showBack(!!view.item);
      vl?.dispose(); vl = null;
      if (view.item) { detail(body, view.item); return; }
      const ix = ensure(), V = VX(), hv = have();
      let ids;
      if (ctx.tab === 'can') { const recs = ix.craftable(hv, {}); ids = recs.map(r => r.out); NEED_BENCH.clear(); for (const r of recs) if (r.st === 'bench') NEED_BENCH.add(r.out); }
      else if (ctx.tab === 'fav') ids = fav().filter(id => V.item(id));
      else ids = V.items.filter(i => !i.hidden).map(i => i.name);
      if (ctx.q) ids = ix.search(ctx.q, ids);
      body.innerHTML = '';
      const note = document.createElement('p'); note.className = 'd37sh-note';
      note.textContent = !ids.length ? (ctx.q ? 'Ничего не нашлось — попробуй другое слово (кирка, pick, факел…)' : ctx.tab === 'fav' ? 'Пусто. Открой вещь и нажми ☆ — она появится тут.' : ctx.tab === 'can' ? 'Пока не из чего: добудь брёвна, камень, уголь…' : '')
        : ctx.tab === 'can' ? 'Хватает вещей: ' + ids.length + (NEED_BENCH.size ? ' · 🛠 — только на верстаке' : '') + '. Нажми — как сделать.' : 'Нажми на вещь — как сделать, для чего, где взять.';
      body.appendChild(note);
      if (!ids.length) return;
      // сетка значков: длинный список — строками (в DOM — только видимые)
      const box = document.createElement('div'); body.appendChild(box);
      const cols = Math.max(4, Math.floor(((body.clientWidth || 360) - 20) / 54));
      vl = E().sheet.vlist(box, { rowH: 54, row: (r, el) => {
        el.className = 'd37sh-vr kx-rrow'; el.textContent = '';
        for (let c = 0; c < cols; c++) {
          const id = ids[r * cols + c]; if (!id) break;
          const it = V.item(id), b = document.createElement('button'); b.type = 'button'; b.className = 'kx-ri' + (NEED_BENCH.has(id) && ctx.tab === 'can' ? ' bench' : ''); b.dataset.ri = id; b.title = it?.title || id; b.setAttribute('aria-label', it?.title || id);
          b.style.backgroundImage = 'url(' + V.iconURL(id, 40) + ')';
          el.appendChild(b);
        }
      } });
      vl.set(Math.ceil(ids.length / cols));
      body.onclick = e => { const b = e.target.closest('[data-ri]'); if (b) go(b.dataset.ri); };
    }
    const NEED_BENCH = new Set();
    // ── карточка вещи: как сделать, для чего, где взять ──
    function detail(body, id){
      const V = VX(), ix = ensure(), it = V.item(id), hv = have(), U = st.ui;
      body.innerHTML = '';
      const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; body.appendChild(e); return e; };
      const head = add('div', 'kx-rhead'), ic = document.createElement('span'); ic.className = 'kx-rbig'; ic.style.backgroundImage = 'url(' + V.iconURL(id, 40) + ')'; head.appendChild(ic);
      const hb = document.createElement('div'), t = document.createElement('b'); t.textContent = it?.title || id; hb.appendChild(t);
      const d = document.createElement('small'); d.textContent = describe(it); hb.appendChild(d); head.appendChild(hb);
      const star = document.createElement('button'); star.type = 'button'; star.className = 'kx-btn kx-star'; star.dataset.fav = id; const on = fav().includes(id); star.textContent = on ? '★' : '☆'; star.title = on ? 'Убрать из избранного' : 'В избранное'; head.appendChild(star);
      // как сделать
      const recs = ix.byOut(id);
      add('h4', 'kx-rh', recs.length ? '🛠 Как сделать' : '🛠 Сделать нельзя');
      recs.forEach((rec, ri) => {
        const card = add('div', 'kx-rcard'), [sic, stext] = ST[rec.st] || ST.bench;
        const top = document.createElement('div'); top.className = 'kx-rst'; top.textContent = sic + ' ' + stext + (rec.n > 1 ? ' · выходит ×' + rec.n : '') + (rec.time ? ' · ' + rec.time + ' с' : ''); card.appendChild(top);
        const row = document.createElement('div'); row.className = 'kx-rrowc'; card.appendChild(row);
        const grid = document.createElement('div'); grid.className = 'kx-rgrid'; grid.style.gridTemplateColumns = 'repeat(' + rec.w + ',34px)'; row.appendChild(grid);
        for (const k of rec.grid) { const c = document.createElement('button'); c.type = 'button'; c.className = 'kx-rc'; if (k) { const id2 = k[0] === '#' ? ix.members(k)[0] : k; c.style.backgroundImage = 'url(' + V.iconURL(id2, 40) + ')'; c.dataset.ri = id2; c.title = k[0] === '#' ? 'любые: ' + ix.members(k).map(m => V.item(m)?.title || m).join(', ') : V.item(k)?.title || k; if (k[0] === '#') c.classList.add('tag'); } else c.disabled = true; grid.appendChild(c); }
        const arr = document.createElement('span'); arr.className = 'kx-rarr'; arr.textContent = '➜'; row.appendChild(arr);
        const outc = document.createElement('span'); outc.className = 'kx-rc out'; outc.style.backgroundImage = 'url(' + V.iconURL(rec.out, 40) + ')'; if (rec.n > 1) { const n = document.createElement('b'); n.textContent = rec.n; outc.appendChild(n); } row.appendChild(outc);
        const need = document.createElement('div'); need.className = 'kx-rneed';
        for (const [k, n, got] of ix.need(rec, hv)) { const s = document.createElement('span'); s.className = got >= n ? 'ok' : 'no'; s.textContent = (k[0] === '#' ? 'любые ' + (k === '#planks' ? 'доски' : k === '#log' ? 'брёвна' : k.slice(1)) : V.item(k)?.title || k) + ' ' + Math.min(got, 999) + '/' + n; need.appendChild(s); }
        card.appendChild(need);
        if (rec.st !== 'furnace') {
          const can = ix.can(rec, hv), open3 = U?.isOpen?.() && U.kind === 'craft', open2 = U?.isOpen?.() && (U.kind === 'inv' || U.kind === 'craft');
          const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'kx-btn pri'; btn.dataset.fill = String(ri);
          if (!can) { btn.disabled = true; btn.textContent = 'Не хватает вещей'; }
          else if (rec.st === 'bench' && !open3) { btn.disabled = true; btn.textContent = '🛠 Открой верстак'; }
          else if (!open2) { btn.disabled = true; btn.textContent = '🎒 Открой вещи (E) — и сюда'; }
          else btn.textContent = '⬇ Положить в сетку';
          card.appendChild(btn);
        }
      });
      // для чего нужно
      const uses = []; for (const r of ix.byIn(id)) if (!uses.includes(r.out)) uses.push(r.out);
      if (uses.length) { add('h4', 'kx-rh', '🔧 Для чего нужно'); const box = add('div', 'kx-ruses'); for (const u of uses.slice(0, 40)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'kx-ri sm'; b.dataset.ri = u; b.title = V.item(u)?.title || u; b.style.backgroundImage = 'url(' + V.iconURL(u, 40) + ')'; box.appendChild(b); } }
      // где взять
      const srcs = ix.from(id);
      if (srcs.length) { add('h4', 'kx-rh', '🧭 Где взять'); const ul = add('ul', 'kx-rsrc'); const seen = new Set(); for (const s of srcs) { const line = srcLine(s); if (!line || seen.has(line)) continue; seen.add(line); const li = document.createElement('li'); li.textContent = line; ul.appendChild(li); } }
      body.onclick = e => {
        const fb = e.target.closest('[data-fav]'); if (fb) { const L = fav(), i = L.indexOf(id); if (i >= 0) L.splice(i, 1); else if (L.length < 100) L.push(id); X.sheet.redraw(); return; }
        const fl = e.target.closest('[data-fill]'); if (fl) { const rec = recs[+fl.dataset.fill]; if (rec && U?.fill?.(rec.r, false)) { g.sound?.('click', { vol: .4, rate: 1.5 }); if (g.touch?.()) X.closeSheet(); else X.sheet.redraw(); } return; }
        const b = e.target.closest('[data-ri]'); if (b && b.dataset.ri !== id) go(b.dataset.ri);
      };
    }
    function describe(it){
      if (!it) return '';
      const A = E().accessories;
      if (it.acc && A) return '💍 Помощник: ' + A.describe(it.acc) + ' (надень в ячейку аксессуаров)';
      if (it.food) return '🍗 Еда: +' + it.food.h / 2 + ' ножки сытости';
      if (it.tool) return it.tool.kind === 'shield' ? '🛡 Щит: держи в левой руке' : it.tool.kind === 'bow' ? '🏹 Лук: стреляет стрелами' : '⛏ Прочность ' + it.tool.dur + (it.tool.dmg ? ' · урон ' + it.tool.dmg : '');
      if (it.use === 'learn') return '📖 Прочитай (ПКМ) — откроет полную книгу рецептов';
      if (it.use === 'recall') return '✨ Прочитай (ПКМ) — перенесёт домой (к лежанке), свиток исчезнет';
      if (it.use === 'map') return '🗺 Зарисуй (ПКМ) место, где стоишь, — получится «Лист карты»';
      if (it.use === 'bucket' || it.use === 'pour') return '🪣 ПКМ по воде или лаве — черпнуть, ещё раз — вылить';
      if (it.place) return '🧱 Ставится как блок' + (it.fuel ? ' · горит в печи ' + it.fuel + ' с' : '');
      return it.fuel ? '🔥 Топливо: ' + it.fuel + ' с в печи' : 'Материал';
    }
    function srcLine(s){
      const V = VX(), B = n => V.block(n)?.title || V.item(n)?.title || n, pct = p => p >= 1 ? '' : ' (' + Math.round(p * 100) + ' %)';
      if (s.kind === 'world') return '🌍 В мире: ' + B(s.from) + ' — копай, выпадет сам';
      if (s.kind === 'block') return '⛏ Из блока «' + B(s.from) + '»' + (s.n > 1 ? ' ×' + s.n : '') + pct(s.p);
      if (s.kind === 'ore') return '🪨 Руда в камне: высота Y ' + s.minY + '…' + s.maxY + (s.maxY <= 20 ? ' (глубоко!)' : '');
      if (s.kind === 'mob') { const M = window.KubomirEnts?.MOBS?.[s.from]; return (MOB_IC[s.from] || '🐾') + ' ' + (M?.title || s.from) + ': ' + (s.min === s.max ? s.max : s.min + '…' + s.max) + ' шт.'; }
      if (s.kind === 'smelt') return '🔥 Печь: переплавь «' + B(s.from) + '»';
      if (s.kind === 'use' || s.kind === 'tree') return (s.kind === 'tree' ? '🌳 ' : '✋ ') + s.text;
      return '';
    }
    // ── книга ещё не прочитана: как её сделать ──
    function lockedSheet(){
      X.open({ id: 'recipes', title: '📖 Книга рецептов 🔒', sub: 'откроется «Книгой мастера»', render(body){
        const V = VX(), r = V.recipes.find(q => q.out === 'master_book');
        body.innerHTML = '';
        const p = document.createElement('p'); p.className = 'd37sh-note'; p.textContent = 'Полная книга рецептов (все вещи, для чего нужны, где взять, поиск) откроется, когда прочитаешь «Книгу мастера» (ПКМ с ней в руке). Пока что — «📖 Можно сделать» в окне вещей.'; body.appendChild(p);
        if (r) {
          const card = document.createElement('div'); card.className = 'kx-rcard';
          const t = document.createElement('div'); t.className = 'kx-rst'; t.textContent = '🛠 «Книга мастера» — на верстаке:'; card.appendChild(t);
          const need = document.createElement('div'); need.className = 'kx-rneed';
          const cnt = {}; for (const k of r.list || []) cnt[k] = (cnt[k] || 0) + 1;
          for (const k in cnt) { const s = document.createElement('span'); s.textContent = (V.item(k)?.title || k) + ' ×' + cnt[k]; need.appendChild(s); }
          card.appendChild(need); body.appendChild(card);
          const h = document.createElement('p'); h.className = 'd37sh-note'; h.textContent = 'Пергамент — из 3 волокон (волокно выпадает из травы), уголь — из угольной руды или пережги бревно в печи, железо — выплавь руду.'; body.appendChild(h);
        }
      } });
    }
    f.state = () => ({ known: f.known(), view: { ...view, stack: view.stack.slice() }, fav: fav().slice(), ix: IX ? IX.stats : null });
    f._index = () => ensure();
    return f;
  });
})();

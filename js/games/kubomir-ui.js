// ═══════════════════════════════════════
//  «КУБОМИР» — окна вещей: инвентарь (крафт 2×2), верстак (3×3), печь, сундук, каталог «Творчества»
// ═══════════════════════════════════════
// window.KubomirUI.create(S, hooks) → U: open('inv' | 'craft' | 'furnace' | 'chest', { x, y, z }), close(), isOpen(), give(вещь)
// → сколько не влезло, dispose(). Как в Майнкрафте: клик — взять/положить/поменять; ПКМ (на телефоне — долгое нажатие) —
// половину или одну; Shift+клик — перекинуть; ПКМ с протяжкой — по одной в каждую ячейку; ЛКМ с протяжкой — поровну;
// двойной клик — собрать такие же в руку; цифра 1–9 над ячейкой — поменять с ячейкой панели; Q над ячейкой — выбросить одну
// (Ctrl+Q — стопку). Вещь «в руке» мимо окна — выбросить. Закрыл — крафт вернулся в вещи.
(() => {
  const V = () => window.D37E.vox;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = [['blocks', '🧱', 'Блоки'], ['nature', '🌿', 'Природа'], ['tools', '⛏️', 'Инструменты'], ['food', '🍗', 'Еда и разное'], ['mods', '🧩', 'Моды']];
  window.KubomirUI = { create };

  function create(S, hooks = {}){
    const U = { kind: '', pos: null, craft: new Array(9).fill(null), el: null, cat: 'blocks', q: '', timer: 0 };
    const P = () => S.P;
    const it = id => V().item(id);
    const max = s => it(s.id)?.stack || 64;
    const same = (a, b) => a && b && a.id === b.id && !it(a.id)?.tool && (a.d | 0) === (b.d | 0);

    // ── в инвентарь: сначала к таким же (панель, потом рюкзак), потом в пустые ──
    U.give = stack => {
      const inv = P().inv, item = it(stack.id); if (!item) return stack.n;
      let n = stack.n;
      for (let pass = 0; pass < 2 && n > 0; pass++) for (let i = 0; i < 36 && n > 0; i++) {
        const s = inv[i];
        if (pass === 0 && s && same(s, stack) && s.n < item.stack) { const k = Math.min(n, item.stack - s.n); s.n += k; n -= k; }
        else if (pass === 1 && !s) { const k = Math.min(n, item.stack); inv[i] = { id: stack.id, n: k, d: stack.d | 0 }; n -= k; }
      }
      if (n !== stack.n && U.el) render();
      return n;
    };
    // ── контейнеры: что лежит в ячейке и как туда положить ──
    function cont(k){
      if (k === 'inv') return P().inv;
      if (k === 'craft') return U.craft;
      if (k === 'chest') return chestTile()?.items || null;
      if (k === 'furnace') { const f = furnaceTile(); return f ? [f.in, f.fuel, f.out] : null; }
      return null;
    }
    function setSlot(k, i, v){
      if (k === 'inv') P().inv[i] = v;
      else if (k === 'craft') U.craft[i] = v;
      else if (k === 'chest') { const t = chestTile(); if (t) { t.items[i] = v; S.W.markTile(U.pos.x, U.pos.z); } }
      else if (k === 'furnace') { const f = furnaceTile(); if (f) { if (i === 0) f.in = v; else if (i === 1) f.fuel = v; else f.out = v; S.W.markTile(U.pos.x, U.pos.z); S.ents?.furnaces.add(U.pos.x + ',' + U.pos.y + ',' + U.pos.z); } }
    }
    const chestTile = () => U.pos ? S.W.tile(U.pos.x, U.pos.y, U.pos.z, () => ({ items: new Array(27).fill(null) })) : null;
    const furnaceTile = () => U.pos ? S.W.tile(U.pos.x, U.pos.y, U.pos.z, () => ({ in: null, fuel: null, out: null, burn: 0, burnMax: 0, cook: 0 })) : null;
    // можно ли положить в ячейку печи
    const fits = (k, i, s) => { if (k !== 'furnace' || !s) return true; if (i === 2) return false; if (i === 1) return !!it(s.id)?.fuel; return true; };

    // ── крафт ──
    function craftSize(){ return U.kind === 'craft' ? 3 : 2; }
    function result(){
      const w = craftSize(), g = [];
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) g.push(U.craft[y * 3 + x]?.id || null);
      return V().craft(g, w, w);
    }
    function takeResult(all){
      let made = 0;
      for (let k = 0; k < (all ? 64 : 1); k++) {
        const r = result(); if (!r) break;
        const out = { id: r.out, n: r.n };
        const cur = P().cursor;
        if (!all) {
          if (cur && !(same(cur, out) && cur.n + out.n <= max(out))) break;
          if (cur) cur.n += out.n; else P().cursor = out;
        } else if (U.give(out) > 0) break;
        const w = craftSize();
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { const i = y * 3 + x, s = U.craft[i]; if (s) { s.n--; if (s.n <= 0) U.craft[i] = null; } }
        made++;
        if (r.out === 'crafting_table') hooks.unlock?.('table');
        if (/^pick_/.test(r.out)) hooks.unlock?.('pick');
        if (r.out === 'pick_stone') hooks.unlock?.('stone_pick');
        if (r.out === 'furnace') hooks.unlock?.('furnace');
      }
      if (made) hooks.sound?.('click', { vol: .4 });
      return made;
    }

    // ── «📖 Можно сделать» (книга рецептов): рецепты, на которые хватает вещей; нажал — ингредиенты легли в сетку (Shift — на
    //    сколько хватит), рецепты «только на верстаке» в окне вещей — серые с подсказкой ──
    const needs = r => r.list ? r.list.slice() : r.pattern.flatMap(row => [...row].filter(ch => ch !== ' ').map(ch => r.key[ch]));
    const fitsGrid = (r, w) => r.list ? r.list.length <= w * w : r.pattern.length <= w && Math.max(...r.pattern.map(s => s.length)) <= w;
    function haveMap(){ const m = new Map(); for (const s of [...P().inv, ...U.craft]) if (s && !it(s.id)?.tool) m.set(s.id, (m.get(s.id) || 0) + s.n); return m; }
    // под каждый ключ (имя или группа #planks) — вещь, которой больше всего; null — не хватает
    function assign(r, have){
      const left = new Map(have), out = [];
      for (const k of needs(r)) {
        let pick = null; for (const [id, n] of left) if (n > 0 && V().tagHas(k, id) && (!pick || n > left.get(pick))) pick = id;
        if (!pick) return null;
        left.set(pick, left.get(pick) - 1); out.push(pick);
      }
      return out;
    }
    U.book = () => {
      const w = craftSize(), have = haveMap(), seen = new Set(), list = [];
      for (const r of V().recipes) {
        if (seen.has(r.out) || !fitsGrid(r, 3)) continue;
        const table = !!r.table || !fitsGrid(r, w);
        if (table && U.kind === 'craft') continue;
        if (!assign(r, have)) continue;
        seen.add(r.out); list.push({ r, table });
      }
      list.sort((a, b) => a.table - b.table);
      return list;
    };
    function fill(r, many){
      const w = craftSize();
      for (let i = 0; i < 9; i++) if (U.craft[i]) { const left = U.give(U.craft[i]); if (left > 0) hooks.drop?.({ ...U.craft[i], n: left }); U.craft[i] = null; }
      const ids = assign(r, haveMap()); if (!ids) return false;
      const cells = r.list ? r.list.map((k, j) => Math.floor(j / w) * 3 + (j % w)) : r.pattern.flatMap((row, y) => [...row].map((ch, x) => ch !== ' ' ? y * 3 + x : -1)).filter(i => i >= 0);
      const uses = new Map(); for (const id of ids) uses.set(id, (uses.get(id) || 0) + 1);
      const have = haveMap();
      let sets = 1;
      if (many) { sets = 64; for (const [id, u] of uses) sets = Math.min(sets, Math.floor((have.get(id) || 0) / u), it(id)?.stack || 64); sets = Math.max(1, sets); }
      const take = (id, n) => { let got = 0; const inv = P().inv; for (let i = 35; i >= 0 && got < n; i--) { const s = inv[i]; if (!s || s.id !== id || it(id)?.tool) continue; const q = Math.min(s.n, n - got); s.n -= q; got += q; if (s.n <= 0) inv[i] = null; } return got; };
      cells.forEach((ci, j) => { const id = ids[j], got = take(id, sets); if (got > 0) U.craft[ci] = { id, n: got }; });
      return true;
    }
    // ── сортировка: стопки одинаковых — вместе, порядок — инструменты, блоки, природа, еда и прочее; панель (1–9) не трогаем ──
    const CAT_ORDER = { tools: 0, blocks: 1, nature: 2, food: 3, mods: 4 };
    U.sort = (k = 'inv') => {
      const C = cont(k); if (!C) return;
      const from = k === 'inv' ? 9 : 0, to = k === 'inv' ? 36 : C.length, items = [];
      for (let i = from; i < to; i++) if (C[i]) { items.push(C[i]); setSlot(k, i, null); }
      const merged = [];
      for (const s of items) {
        const m = !it(s.id)?.tool && merged.find(x => same(x, s) && x.n < max(x));
        if (m) { const q = Math.min(s.n, max(m) - m.n); m.n += q; s.n -= q; if (s.n > 0) merged.push(s); } else merged.push(s);
      }
      const ord = s => { const item = it(s.id); return [item ? CAT_ORDER[catOf(item)] ?? 5 : 6, item?.title || s.id, -s.n]; };
      merged.sort((a, b) => { const A = ord(a), B = ord(b); return A[0] - B[0] || String(A[1]).localeCompare(String(B[1]), 'ru') || A[2] - B[2]; });
      merged.forEach((s, j) => setSlot(k, from + j, s));
      hooks.sound?.('click', { vol: .3, rate: 1.3 });
      render();
    };

    // ── нажатия по ячейкам ──
    let lastPick = null;   // { k, i, t } — взял стопку: второй клик быстро по той же ячейке — собрать такие же
    function click(k, i, right, shift){
      const p = P();
      if (k === 'result') { takeResult(shift); render(); return; }
      if (k === 'book') {
        const b = U.bookList?.[i]; if (!b) return;
        if (b.table) { hooks.toast?.('🛠️ «' + (it(b.r.out)?.title || b.r.out) + '» делают на верстаке: поставь его (ПКМ) и открой'); return; }
        if (fill(b.r, shift)) { hooks.sound?.('click', { vol: .3, rate: 1.6 }); if (shift) takeResult(true); }
        render(); return;
      }
      if (!right && !shift && p.cursor && lastPick && lastPick.k === k && lastPick.i === i && performance.now() - lastPick.t < 350) { lastPick = null; collect(); render(); return; }
      if (k === 'cat') { const id = catList()[i]; if (!id) return; const s = { id, n: right ? 1 : it(id).stack }; if (p.cursor && same(p.cursor, s)) p.cursor.n = Math.min(max(s), p.cursor.n + s.n); else p.cursor = s; render(); return; }
      if (k === 'trash') { p.cursor = null; render(); return; }
      const C = cont(k); if (!C) return;
      const s = C[i];
      if (shift && s) { quickMove(k, i, s); render(); return; }
      const cur = p.cursor;
      if (!right) {
        if (!cur) { if (s) { p.cursor = s; setSlot(k, i, null); lastPick = { k, i, t: performance.now() }; } }
        else if (!fits(k, i, cur)) { if (!s && k === 'furnace' && i === 2) {} }
        else if (!s) { setSlot(k, i, cur); p.cursor = null; }
        else if (same(s, cur)) { const m = max(s), q = Math.min(cur.n, m - s.n); s.n += q; cur.n -= q; if (cur.n <= 0) p.cursor = null; setSlot(k, i, s); }
        else { setSlot(k, i, cur); p.cursor = s; }
      } else {
        if (!cur) { if (s) { const h = Math.ceil(s.n / 2); p.cursor = { id: s.id, n: h, d: s.d | 0 }; s.n -= h; setSlot(k, i, s.n > 0 ? s : null); } }
        else if (fits(k, i, cur) && (!s || (same(s, cur) && s.n < max(s)))) { if (s) s.n++; else setSlot(k, i, { id: cur.id, n: 1, d: cur.d | 0 }); if (s) setSlot(k, i, s); cur.n--; if (cur.n <= 0) p.cursor = null; }
      }
      render();
    }
    // двойной клик: в руку — такие же из всех ячеек окна (сначала неполные стопки), пока не наберётся стопка
    function collect(){
      const cur = P().cursor; if (!cur || it(cur.id)?.tool) return;
      const lists = [['inv', 36]]; if (U.kind === 'chest') lists.unshift(['chest', 27]); if (U.kind === 'craft' || U.kind === 'inv') lists.push(['craft', 9]);
      for (let pass = 0; pass < 2; pass++) for (const [k, n] of lists) {
        const Cn = cont(k); if (!Cn) continue;
        for (let j = 0; j < n && cur.n < max(cur); j++) {
          const s = Cn[j]; if (!same(s, cur) || (pass === 0 && s.n >= max(s))) continue;
          const q = Math.min(s.n, max(cur) - cur.n); cur.n += q; s.n -= q; setSlot(k, j, s.n > 0 ? s : null);
        }
      }
    }
    // протяжка с вещью в руке: ПКМ — по одной в каждую новую ячейку сразу; ЛКМ — поровну при отпускании
    const canTake = (k, i, cur) => { const Cn = cont(k); if (!Cn || !fits(k, i, cur)) return false; const s = Cn[i]; return !s || (same(s, cur) && s.n < max(s)); };
    function spreadEven(slots){
      const cur = P().cursor; if (!cur || !slots.length) return;
      const per = Math.max(1, Math.floor(cur.n / slots.length));
      for (const [k, i] of slots) {
        if (cur.n <= 0) break;
        const Cn = cont(k), s = Cn?.[i]; if (!Cn || !canTake(k, i, cur)) continue;
        const q = Math.min(per, cur.n, max(cur) - (s ? s.n : 0));
        if (s) { s.n += q; setSlot(k, i, s); } else setSlot(k, i, { id: cur.id, n: q, d: cur.d | 0 });
        cur.n -= q;
      }
      if (cur.n <= 0) P().cursor = null;
    }
    // цифра над ячейкой — поменять с ячейкой панели N; Q — выбросить одну, Ctrl+Q — стопку
    function hoverKey(e){
      if (!U.el || !U.hover || e.target?.closest?.('input, textarea')) return;
      const [k, i] = U.hover, Cn = cont(k); if (!Cn) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) {
        e.preventDefault(); e.stopPropagation();
        const h = +m[1] - 1; if (k === 'inv' && i === h) return;
        const a = Cn[i], b = P().inv[h];
        if (b && !fits(k, i, b)) return;
        setSlot(k, i, b || null); P().inv[h] = a || null; render();
      } else if (e.code === 'KeyQ' && Cn[i]) {
        e.preventDefault(); e.stopPropagation();
        const s = Cn[i], n = e.ctrlKey ? s.n : 1;
        hooks.drop?.({ id: s.id, n, d: s.d | 0 });
        s.n -= n; setSlot(k, i, s.n > 0 ? s : null); render();
      }
    }
    function quickMove(k, i, s){
      const inv = P().inv;
      const put = (C, from, to, kk) => { for (let pass = 0; pass < 2 && s.n > 0; pass++) for (let j = from; j < to && s.n > 0; j++) { const d = C[j]; if (pass === 0 && d && same(d, s) && d.n < max(d)) { const q = Math.min(s.n, max(d) - d.n); d.n += q; s.n -= q; setSlot(kk, j, d); } else if (pass === 1 && !d && fits(kk, j, s)) { setSlot(kk, j, { ...s }); s.n = 0; } } };
      if (k === 'inv') {
        if (U.kind === 'chest') put(cont('chest'), 0, 27, 'chest');
        else if (U.kind === 'furnace') { if (V().smelting.has(s.id)) put(cont('furnace'), 0, 1, 'furnace'); else if (it(s.id)?.fuel) put(cont('furnace'), 1, 2, 'furnace'); }
        else if (i < 9) put(inv, 9, 36, 'inv'); else put(inv, 0, 9, 'inv');
      } else put(inv, 0, 36, 'inv');
      if (s.n <= 0) setSlot(k, i, null); else setSlot(k, i, s);
    }

    // ── каталог «Творчества» ──
    function catOf(item){
      if (item.mod) return 'mods';
      if (item.tool) return 'tools';
      const b = item.place && V().block(item.place);
      if (b) return /^(log|leaves|sapling|tall_grass|flower|dead_bush|cactus|grass|dirt|sand|gravel|snow|ice|clay)/.test(b.name) ? 'nature' : 'blocks';
      return 'food';
    }
    let catCache = null;
    function catList(){
      const key = U.cat + '|' + U.q;
      if (catCache && catCache.key === key) return catCache.list;
      const q = U.q.trim().toLowerCase();
      const list = V().items.filter(x => (q ? x.title.toLowerCase().includes(q) || x.name.includes(q) : catOf(x) === U.cat)).map(x => x.name);
      catCache = { key, list };
      return list;
    }

    // ── окно ──
    U.isOpen = () => !!U.el;
    U.open = (kind, pos) => {
      if (U.el) U.close();
      U.kind = kind; U.pos = pos || null;
      S.I?.unlock(); S.C?.reset_state();
      const el = U.el = document.createElement('div');
      el.className = 'kb-ui kb-inv';
      el.innerHTML = '<div class="kb-panel"></div><div class="kb-cursor" hidden></div>';
      S.R.r.domElement.parentElement.appendChild(el);
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('input', e => { if (e.target.matches('.kb-search')) { U.q = e.target.value; catCache = null; renderCat(); } });
      U.hover = null; drag = null;
      window.addEventListener('keydown', hoverKey, true);
      render();
      if (kind === 'furnace') U.timer = setInterval(() => { if (U.el) renderFurnace(); }, 150);
      if (kind === 'chest') hooks.sound?.('door_wood_open', { vol: .4, rate: 1.4 });
    };
    U.close = () => {
      if (!U.el) return;
      const p = P();
      for (let i = 0; i < 9; i++) if (U.craft[i]) { const left = U.give(U.craft[i]); if (left > 0) hooks.drop?.({ ...U.craft[i], n: left }); U.craft[i] = null; }
      if (p.cursor) { const left = U.give(p.cursor); if (left > 0) hooks.drop?.({ ...p.cursor, n: left }); p.cursor = null; }
      clearInterval(U.timer);
      window.removeEventListener('keydown', hoverKey, true); U.hover = null; drag = null;
      if (U.kind === 'chest') hooks.sound?.('door_wood_close', { vol: .4, rate: 1.4 });
      U.el.remove(); U.el = null; U.kind = ''; U.pos = null;
      S.C?.reset_state();
      if (!S.I?.touch) S.I?.lock?.();   // тот же элемент, что у движка (input.js), — иначе мышь захвачена, а камера не крутится
    };
    U.dispose = () => { window.removeEventListener('keydown', hoverKey, true); if (U.el) { clearInterval(U.timer); U.el.remove(); U.el = null; } };

    const slot = (k, i, s, cls = '') => {
      const item = s && it(s.id), dur = item?.tool && s.d ? 1 - s.d / item.tool.dur : -1;
      return `<div class="kb-slot ${cls}" data-k="${k}" data-i="${i}" title="${item ? esc(item.title) : ''}">${s ? `<i style="background-image:url(${V().iconURL(s.id, 40)})"></i>${s.n > 1 ? `<b>${s.n}</b>` : ''}${dur >= 0 ? `<u style="width:${Math.round(dur * 80)}%;background:${dur > .5 ? '#4ade80' : dur > .2 ? '#facc15' : '#ef4444'}"></u>` : ''}` : ''}</div>`;
    };
    function render(){
      if (!U.el) return;
      const p = P(), panel = U.el.querySelector('.kb-panel'), creative = S.creative;
      const title = U.kind === 'craft' ? '🛠️ Верстак' : U.kind === 'furnace' ? '🔥 Печь' : U.kind === 'chest' ? '📦 Сундук' : '🎒 Вещи';
      let top = '';
      if (U.kind === 'inv' && creative) {
        top = `<div class="kb-tabs">${CATS.map(([k, ic, t]) => `<button type="button" data-cat="${k}" class="${U.cat === k ? 'on' : ''}">${ic}<span> ${t}</span></button>`).join('')}<input class="kb-search" type="search" placeholder="Найти…" value="${esc(U.q)}"></div><div class="kb-cat"></div>`;
      }
      if (U.kind === 'inv' || U.kind === 'craft') {
        const w = craftSize(), r = result();
        let g = ''; for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) g += slot('craft', y * 3 + x, U.craft[y * 3 + x]);
        top += `<div class="kb-craft"><div class="kb-cgrid" style="grid-template-columns:repeat(${w},auto)">${g}</div><span class="kb-arrow">➜</span>${slot('result', 0, r ? { id: r.out, n: r.n } : null, 'res')}${creative ? '<div class="kb-slot trash" data-k="trash" data-i="0" title="Выбросить совсем">🗑</div>' : ''}</div>`;
        if (!creative) {
          const list = U.bookList = U.book();
          top += `<div class="kb-book"><span title="${S.I?.touch ? 'Нажми — ингредиенты лягут в сетку' : 'Клик — ингредиенты лягут в сетку, Shift+клик — сделать сколько хватит'}">📖 Можно сделать</span><div class="kb-booklist">${list.length ? list.map((b, j) => slot('book', j, { id: b.r.out, n: b.r.n || 1 }, b.table ? 'need' : '')).join('') : `<small>Пока ничего. ${U.kind === 'inv' ? 'Добудь брёвна: держи ЛКМ по дереву (на телефоне — держи палец).' : 'Положи в вещи доски, палки, булыжник…'}</small>`}</div></div>`;
        }
      } else if (U.kind === 'furnace') {
        const f = furnaceTile();
        top += `<div class="kb-furn"><div class="kb-fcol">${slot('furnace', 0, f?.in)}<span class="kb-flame">🔥</span>${slot('furnace', 1, f?.fuel)}</div><span class="kb-arrow kb-prog">➜</span>${slot('furnace', 2, f?.out, 'res')}</div><p class="kb-hint">Сверху — что плавить (руда, песок, сырое мясо), снизу — топливо (уголь, доски, брёвна).</p>`;
      } else if (U.kind === 'chest') {
        const t = chestTile(); let g = ''; for (let i = 0; i < 27; i++) g += slot('chest', i, t?.items[i]);
        top += `<div class="kb-grid">${g}</div>`;
      }
      let main = '', hot = '';
      for (let i = 9; i < 36; i++) main += slot('inv', i, p.inv[i]);
      for (let i = 0; i < 9; i++) hot += slot('inv', i, p.inv[i], i === p.sel ? 'on' : '');
      const sortBtn = U.kind === 'chest' ? '<button type="button" class="kb-x" data-sort="chest" title="Разложить сундук по порядку">⇅</button>' : '<button type="button" class="kb-x" data-sort="inv" title="Разложить вещи по порядку (панель 1–9 не трогаем)">⇅</button>';
      panel.innerHTML = `<div class="kb-ptitle"><b>${title}</b><span class="kb-pbtns">${sortBtn}<button type="button" class="kb-x" data-close="1" aria-label="Закрыть">✕</button></span></div>${top}<div class="kb-grid">${main}</div><div class="kb-grid kb-hotrow">${hot}</div>
        <p class="kb-hint">${S.I?.touch ? 'Нажми — взять/положить, подержи — половину или одну.' : 'Клик — взять/положить, ПКМ — половину или одну, Shift+клик — перекинуть, протянуть с вещью: ПКМ — по одной, ЛКМ — поровну; двойной клик — собрать; 1–9 над ячейкой — на панель, Q — выбросить. E или Esc — закрыть.'}</p>`;
      if (U.kind === 'inv' && creative) renderCat();
      if (U.kind === 'furnace') renderFurnace();
      renderCursor();
    }
    function renderCat(){
      const box = U.el?.querySelector('.kb-cat'); if (!box) return;
      const list = catList();
      box.innerHTML = list.length ? list.map((id, i) => slot('cat', i, { id, n: 1 })).join('') : '<p class="kb-hint">Пусто</p>';
    }
    function renderFurnace(){
      const f = furnaceTile(), el = U.el; if (!f || !el) return;
      const fl = el.querySelector('.kb-flame'), pr = el.querySelector('.kb-prog'), rec = f.in && V().smelting.get(f.in.id);
      if (fl) fl.style.opacity = f.burn > 0 ? .35 + .65 * Math.min(1, f.burn / Math.max(1, f.burnMax)) : .15;
      if (pr) pr.style.setProperty('--p', (rec ? Math.min(1, f.cook / rec.time) : 0) * 100 + '%');
      const key = [f.in, f.fuel, f.out].map(s => s ? s.id + s.n : '-').join('|');
      if (U.fkey !== key) { U.fkey = key; const C = [f.in, f.fuel, f.out]; el.querySelectorAll('[data-k="furnace"]').forEach(d => { d.outerHTML = slot('furnace', +d.dataset.i, C[+d.dataset.i], +d.dataset.i === 2 ? 'res' : ''); }); }
    }
    function renderCursor(x, y){
      const c = U.el?.querySelector('.kb-cursor'), s = P().cursor; if (!c) return;
      c.hidden = !s;
      if (s) { c.innerHTML = `<i style="background-image:url(${V().iconURL(s.id, 40)})"></i>${s.n > 1 ? `<b>${s.n}</b>` : ''}`; }
      if (x != null) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
    }
    // ── ввод: мышь и палец (долгое нажатие = правая кнопка) ──
    let press = null, drag = null;
    const SLOT_K = { inv: 1, craft: 1, chest: 1, furnace: 1 };   // ячейки, куда можно «протянуть»
    function onDown(e){
      const t = e.target;
      if (t.closest('[data-close]')) { U.close(); return; }
      const so = t.closest('[data-sort]'); if (so) { U.sort(so.dataset.sort); return; }
      const cat = t.closest('[data-cat]'); if (cat) { U.cat = cat.dataset.cat; U.q = ''; catCache = null; render(); return; }
      if (t.closest('.kb-search')) return;
      const s = t.closest('[data-k]');
      const r = U.el.getBoundingClientRect(); renderCursor(e.clientX - r.left, e.clientY - r.top);
      if (!s) {
        // мимо окна с вещью в руке — выбросить
        if (!t.closest('.kb-panel') && P().cursor) { hooks.drop?.(P().cursor); P().cursor = null; render(); }
        else if (!t.closest('.kb-panel')) U.close();
        return;
      }
      e.preventDefault();
      if (e.pointerType === 'touch') { press = { s, t0: performance.now(), timer: setTimeout(() => { if (press?.s === s) { press.long = true; click(s.dataset.k, +s.dataset.i, true, false); } }, 420) }; return; }
      const k = s.dataset.k, i = +s.dataset.i, cur = P().cursor;
      // с вещью в руке по обычной ячейке: ПКМ — сразу одну и дальше «протяжка»; ЛКМ — ждём: отпустил тут же — обычный клик
      if (cur && SLOT_K[k] && !e.shiftKey && (e.button === 0 || e.button === 2)) {
        drag = { btn: e.button, start: [k, i], list: [[k, i]], key: new Set([k + i]) };
        if (e.button === 2) click(k, i, true, false);
        else mark();
        return;
      }
      click(k, i, e.button === 2, e.shiftKey);
    }
    function onUp(e){
      if (drag) {
        const d = drag; drag = null;
        if (d.btn === 0) { if (d.list.length > 1) spreadEven(d.list); else click(d.start[0], d.start[1], false, false); }
        render();
        return;
      }
      if (!press) return;
      clearTimeout(press.timer);
      if (!press.long) click(press.s.dataset.k, +press.s.dataset.i, false, false);
      press = null;
    }
    function onMove(e){
      if (!U.el) return;
      const r = U.el.getBoundingClientRect(); renderCursor(e.clientX - r.left, e.clientY - r.top);
      const s = e.target.closest?.('[data-k]');
      U.hover = s && SLOT_K[s.dataset.k] ? [s.dataset.k, +s.dataset.i] : null;
      if (!drag || !s || !SLOT_K[s.dataset.k]) return;
      const k = s.dataset.k, i = +s.dataset.i, cur = P().cursor;
      if (!cur || drag.key.has(k + i) || !canTake(k, i, cur)) return;
      drag.key.add(k + i); drag.list.push([k, i]);
      if (drag.btn === 2) click(k, i, true, false); else mark();
    }
    // подсветка ячеек протяжки ЛКМ
    function mark(){ if (!U.el || !drag) return; U.el.querySelectorAll('.kb-slot.drag').forEach(d => d.classList.remove('drag')); for (const [k, i] of drag.list) U.el.querySelector(`[data-k="${k}"][data-i="${i}"]`)?.classList.add('drag'); }
    U._key = hoverKey;
    return U;
  }
})();

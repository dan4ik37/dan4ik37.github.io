// ═══════════════════════════════════════
//  «КУБОМИР» — 📜 Дорожная книга (T-049, docs/plans/kubomir-modpacks.md §4.10): главы заданий — первая ночь, мастерская, под землёй,
//  помощники, путешественник; глава «Достижения» — те же 18 достижений (награда монетами — как была, один раз за аккаунт)
// ═══════════════════════════════════════
// Движок — D37E.quests (js/engine/quests.js, общий для игр); тут — только задания (свои слова) и связь с игрой: события помощников
// (сломал, поставил, сделал, выплавил, съел, победил, лёг спать, новый край, достижение) и «что в вещах» (раз в 0,5 с, если вещи
// менялись). Награды — только вещи в мире (монет и XP задания не дают: валидатор выкидывает). Глава «Помощники» целиком — седьмая
// ячейка аксессуаров (правило quest:chapter:helpers в kubomir-x.js). J, ☰ → 📜; 📌 — следить (до 3, строка на экране).
(() => {
  const VX = () => window.D37E.vox, E = () => window.D37E;
  const it = (id, n = 1) => ({ t: 'item', id, n });
  const Q1 = (id, title, text, tasks, rewards = [], needs = [], icon = '') => ({ id, title, text, tasks, rewards, needs, icon });
  const DATA = { chapters: [
    { id: 'first-night', title: 'Первая ночь', icon: '🌙', order: 1, quests: [
      Q1('log', 'Первое бревно', 'Подойди к дереву и ломай ствол. Брёвна — начало всего: доски, палки, верстак.', [{ t: 'have', item: '#log', n: 1 }], [it('apple', 2)], [], 'log_oak'),
      Q1('planks', 'Доски', 'Открой вещи и сделай из бревна доски — прямо в руках (сетка 2×2).', [{ t: 'craft', item: '#planks', n: 4 }], [it('stick', 4)], ['log'], 'planks_oak'),
      Q1('table', 'Верстак', 'Четыре доски квадратом — верстак. Поставь его и открой: там сетка 3×3 для больших вещей.', [{ t: 'craft', item: 'crafting_table', n: 1 }], [it('planks_oak', 4)], ['planks'], 'crafting_table'),
      Q1('pick', 'Первая кирка', 'На верстаке: три доски сверху и две палки — деревянная кирка. Ей копают камень.', [{ t: 'craft', item: 'pick_wood', n: 1 }], [it('apple', 2)], ['table'], 'pick_wood'),
      Q1('stone', 'Камень', 'Накопай булыжника: серые блоки под землёй и в горах.', [{ t: 'have', item: 'cobble', n: 8 }], [it('torch', 4)], ['pick'], 'cobble'),
      Q1('stone_pick', 'Каменная кирка', 'Каменная кирка копает быстрее и берёт железную руду.', [{ t: 'craft', item: 'pick_stone', n: 1 }], [it('meat_cooked', 2)], ['stone'], 'pick_stone'),
      Q1('coal', 'Уголь', 'Чёрные пятна в камне — уголь. Из угля и палки — факелы.', [{ t: 'have', item: 'coal', n: 2 }], [it('torch', 2)], ['pick'], 'coal'),
      Q1('torch', 'Да будет свет', 'Сделай факелы: рядом со светом монстры не появляются.', [{ t: 'craft', item: 'torch', n: 4 }], [it('ladder', 3)], ['coal'], 'torch'),
      Q1('fiber', 'Волокно', 'Ломай траву — иногда выпадает волокно. Из него — пергамент и лежанка.', [{ t: 'have', item: 'fiber', n: 3 }], [it('fiber', 2)], ['log'], 'fiber'),
      Q1('bed', 'Лежанка', 'Три волокна над тремя досками (на верстаке). Нажми на лежанку — это твой дом.', [{ t: 'craft', item: 'bed', n: 1 }], [it('recall', 1)], ['fiber', 'table'], 'bed'),
      Q1('night', 'Переживи ночь', 'Встреть утро: в укрытии, с факелами или поспав на лежанке.', [{ t: 'ach', id: 'night', n: 1 }], [it('meat_cooked', 4)], ['bed'], '🌙'),
    ] },
    { id: 'workshop', title: 'Мастерская', icon: '🛠', order: 2, quests: [
      Q1('furnace', 'Печь', 'Восемь булыжников кольцом — печь. В ней плавят руду и жарят мясо.', [{ t: 'craft', item: 'furnace', n: 1 }], [it('coal', 4)], ['stone'], 'furnace'),
      Q1('iron', 'Железо', 'Железная руда (рыжие пятна) + топливо в печи → слитки.', [{ t: 'smelt', item: 'iron_ingot', n: 3 }], [it('coal', 4)], ['furnace'], 'iron_ingot'),
      Q1('iron_pick', 'Железная кирка', 'Берёт золото и алмазы.', [{ t: 'craft', item: 'pick_iron', n: 1 }], [it('torch', 8)], ['iron'], 'pick_iron'),
      Q1('chest', 'Сундук', 'Восемь досок кольцом — сундук: хранить вещи.', [{ t: 'craft', item: 'chest', n: 1 }], [it('planks_oak', 8)], ['table'], 'chest'),
      Q1('door', 'Свой дом', 'Поставь дверь — и у тебя настоящий дом.', [{ t: 'ach', id: 'door', n: 1 }], [it('torch', 4)], ['table'], 'door'),
      Q1('glass', 'Стекло', 'Переплавь песок в стекло — для окон и помощников.', [{ t: 'smelt', item: 'glass', n: 4 }], [it('sand', 8)], ['furnace'], 'glass'),
      Q1('shield', 'Щит', 'Доски и железный слиток — щит для левой руки.', [{ t: 'craft', item: 'shield', n: 1 }], [it('arrow', 8)], ['iron'], 'shield'),
      Q1('bucket', 'Ведро', 'Три слитка «уголком» — ведро: черпать воду.', [{ t: 'craft', item: 'bucket', n: 1 }], [it('glass', 4)], ['iron'], 'bucket'),
    ] },
    { id: 'underground', title: 'Под землёй', icon: '⛏', order: 3, quests: [
      Q1('caves', 'В пещеры', 'Спустись ниже 30-го уровня. Возьми факелы!', [{ t: 'depth', n: 30 }], [it('torch', 8)], ['stone_pick'], '🕳'),
      Q1('ore_iron', 'Железная жила', 'Добудь 5 железной руды.', [{ t: 'break', block: 'ore_iron', n: 5 }], [it('meat_cooked', 3)], ['caves'], 'ore_iron'),
      Q1('gold', 'Золото', 'Золото копают железной киркой и плавят в печи.', [{ t: 'smelt', item: 'gold_ingot', n: 1 }], [it('torch', 6)], ['iron_pick'], 'gold_ingot'),
      Q1('deep', 'Глубины', 'Спустись ниже 12-го уровня: там алмазы и лава.', [{ t: 'ach', id: 'deep', n: 1 }], [it('torch', 8)], ['caves'], '🕳'),
      Q1('diamond', 'Алмаз!', 'Голубые пятна на большой глубине. Нужна железная кирка.', [{ t: 'ach', id: 'diamond', n: 1 }], [it('iron_ingot', 4)], ['deep'], 'diamond'),
      Q1('lava', 'Осторожно, лава', 'Черпни ведром лаву (не подходи близко!) — горит в печи.', [{ t: 'have', item: 'bucket_lava', n: 1 }], [it('obsidian', 2)], ['bucket', 'deep'], 'bucket_lava'),
    ] },
    { id: 'helpers', title: 'Помощники', icon: '💍', order: 4, quests: [
      Q1('watch', 'Часы', 'Четыре слитка и стекло. Надень часы в ячейку 💍 — видно время.', [{ t: 'craft', item: 'watch', n: 1 }], [it('recall', 1)], ['iron', 'glass'], 'watch'),
      Q1('compass', 'Компас', 'Четыре слитка и кремень (кремень — из гравия).', [{ t: 'craft', item: 'compass', n: 1 }], [it('map_blank', 2)], ['iron'], 'compass'),
      Q1('depth_meter', 'Глубиномер', 'Четыре стекла и слиток.', [{ t: 'craft', item: 'depth_meter', n: 1 }], [it('torch', 4)], ['iron', 'glass'], 'depth_meter'),
      Q1('lens', 'Лупа', 'Золото, стекло и палка — лупа: что под прицелом и чем копать.', [{ t: 'craft', item: 'lens', n: 1 }], [it('meat_cooked', 3)], ['gold'], 'lens'),
      Q1('book', 'Книга мастера', 'Пергамент, слиток и уголь. Прочитай (ПКМ) — откроется книга всех рецептов.', [{ t: 'use', item: 'master_book', n: 1 }], [it('parchment', 2)], ['iron'], 'master_book'),
      Q1('maps', 'Три листа карты', 'Зарисуй три разных места чистыми листами карты (ПКМ с листом).', [{ t: 'use', item: 'map_blank', n: 3 }], [it('map_blank', 2)], ['compass'], 'map_filled'),
      Q1('atlas', 'Атлас', 'Компас и восемь листов карты из разных мест — атлас: мини-карта и точки.', [{ t: 'craft', item: 'atlas', n: 1 }], [it('recall', 2)], ['maps'], 'atlas'),
      Q1('navigator', 'Навигатор', 'Часы, компас и глубиномер на верстаке — одна ячейка вместо трёх.', [{ t: 'craft', item: 'navigator', n: 1 }], [it('recall', 1)], ['watch', 'compass', 'depth_meter'], 'navigator'),
    ] },
    { id: 'travel', title: 'Путешественник', icon: '🧭', order: 5, quests: [
      Q1('lands', 'Три края', 'Побывай в лесу, в пустыне и в снегах.', [{ t: 'visit', biome: 'forest', n: 1 }, { t: 'visit', biome: 'desert', n: 1 }, { t: 'visit', biome: 'snow', n: 1 }], [it('recall', 2)], ['log'], '🗺'),
      Q1('far500', 'Далеко от дома', 'Уйди на 500 блоков от начала мира.', [{ t: 'reach', n: 500 }], [it('meat_cooked', 4)], ['log'], '🧭'),
      Q1('far1000', 'Путешественник', 'Уйди на 1000 блоков.', [{ t: 'ach', id: 'far', n: 1 }], [it('recall', 3)], ['far500'], '🧭'),
      Q1('recall', 'Домой!', 'Прочитай свиток возврата — и ты у своей лежанки.', [{ t: 'use', item: 'recall', n: 1 }], [it('recall', 1)], ['bed'], 'recall'),
      Q1('days', 'Неделя в мире', 'Проживи в этом мире 7 дней.', [{ t: 'days', n: 7 }], [it('meat_cooked', 6)], ['night'], '📅'),
    ] },
  ] };
  const BIOME_RU = { forest: 'лес', desert: 'пустыня', snow: 'снега' };
  window.KubomirX?.feature((st, X) => {
    const g = X.g, P = st.P, V = VX();
    const state = X.ext('quests');
    // глава «Достижения» — те же достижения игры (их награды — как были)
    const ach = g.ach?.() || [];
    const data = { chapters: DATA.chapters.concat(ach.length ? [{ id: 'ach', title: 'Достижения', icon: '🏆', order: 9, quests: ach.map(a => Q1('ach:' + a[0], a[2], a[3], [{ t: 'ach', id: a[0], n: 1 }], [], [], a[1])) }] : []) };
    const count = key => {
      let n = 0; const list = key[0] === '#' ? V.TAGS[key.slice(1)] || [] : [key];
      for (const s of P.inv) if (s && list.includes(s.id)) n += s.n;
      if (P.off && list.includes(P.off.id)) n += P.off.n;
      return n;
    };
    const Q = E().quests.create({ data, state, have: count,
      val: t => t.t === 'reach' ? (st.meta?.spawn ? Math.floor(Math.hypot(P.x - st.meta.spawn.x, P.z - st.meta.spawn.z)) : 0) : t.t === 'depth' ? (P.y > 0 && P.y <= t.n ? t.n : 0) : t.t === 'days' ? (st.meta?.day | 0 || 1) : 0,
      match: (k, id) => !k || V.tagHas(k, id),
      onDone: q => { if (st.creative) return; g.toast?.('📜 Задание «' + q.title + '» выполнено' + (q.rewards.length ? ' — забери награду: ' + (g.label?.('quests') || 'J') : '!'), true); g.sound?.('coin', { vol: .45, rate: 1.1 }); X.emit('quest', q.id); X.refreshSlots?.(); },
    });
    X.quests = Q;
    X.questDone = id => id.startsWith('chapter:') ? Q.chapterDone(id.slice(8)) : ['done', 'claimed'].includes(Q.status(id));
    const f = { id: 'quests', title: 'Дорожная книга', order: 50 };
    let dirty = true, slow = 0, trackRev = -1, view = { q: null };
    const bname = id => V.blocks[id]?.name || '';
    f.on = {
      break: (x, y, z, b) => Q.event('break', bname(b)), place: (x, y, z, b) => Q.event('place', bname(b)),
      craft: (id, n) => { Q.event('craft', id, n); dirty = true; }, smelt: (id, n) => { Q.event('smelt', id, n); dirty = true; },
      pickup: () => { dirty = true; }, eat: id => { Q.event('eat', id); dirty = true; }, kill: type => Q.event('kill', type),
      use: id => { Q.event('use', id); dirty = true; }, sleep: () => Q.event('sleep'), biome: b => Q.event('visit', b), ach: id => Q.event('ach', id),
      equip: () => { dirty = true; }, inv: () => { dirty = true; },
    };
    f.update = dt => {
      const K = st.K;
      if (K?.downRaw?.('quests') && !st.chatEl && !st.menu && !P.dead) { if (X.isOpen() && X.sheet.id === 'quests') X.closeSheet(); else open(); }
      if ((slow -= dt) > 0) return;
      slow = .5;
      if (dirty || st.ui?.isOpen?.()) { dirty = false; Q.refresh(); }   // вещи меняются и в окне вещей (перекладывание) — пока оно открыто
      else if ((f.t2 = (f.t2 || 0) + 1) % 2 === 0) Q.refresh();   // далеко, глубоко, дни — раз в секунду
      if (Q.rev !== trackRev) { trackRev = Q.rev; track(); if (X.isOpen() && X.sheet.id === 'quests') X.sheet.redraw(); }
    };
    // строка «что делаю» на экране — только закреплённые (📌)
    function track(){
      const id = Q.state.pins.find(p => Q.status(p) === 'open' || Q.status(p) === 'done');
      if (!id) { X.hudHide?.('quest'); return; }
      const q = Q.all.get(id), pr = Q.progress(id), done = Q.status(id) === 'done';
      const t0 = pr.find(p => p[0] < p[1]) || pr[0];
      X.hudChip?.('quest', done ? '🎁' : '📜', q.title + (done ? ' — забери награду' : ' · ' + t0[0] + '/' + t0[1]), 0);
    }
    f.menu = () => [{ id: 'x:quests', icon: '📜', text: 'Дорожная книга' + (readyN() ? ' (🎁 ' + readyN() + ')' : '') }];
    f.pick = id => { if (id !== 'x:quests') return false; open(); return true; };
    const readyN = () => { let n = 0; for (const id of Q.all.keys()) if (Q.status(id) === 'done' && Q.all.get(id).rewards.length) n++; return n; };
    function open(qid){
      view = { q: qid || null };
      const first = Q.data.chapters.find(c => c.quests.some(q => ['open', 'done'].includes(Q.status(q.id)))) || Q.data.chapters[0];
      X.open({ id: 'quests', title: '📜 Дорожная книга', tabs: Q.data.chapters.map(c => ({ id: c.id, label: c.icon + ' ' + c.title })), tab: first?.id,
        render, onBack: () => { if (!view.q) return false; view.q = null; X.sheet.redraw(); return true; }, onTab: () => { view.q = null; } });
    }
    const ICON = { claimed: '✅', done: '🎁', open: '⬜', locked: '🔒', hidden: '❔' };
    function icon(el, q){ if (q.icon && V.item(q.icon)) { el.style.backgroundImage = 'url(' + V.iconURL(q.icon, 40) + ')'; el.textContent = ''; } else el.textContent = q.icon || '📜'; }
    function render(body, ctx){
      ctx.sh.showBack(!!view.q);
      body.innerHTML = '';
      const add = (tag, cls, text, parent = body) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; parent.appendChild(e); return e; };
      if (view.q) { detail(body, Q.all.get(view.q), add); return; }
      const ch = Q.data.chapters.find(c => c.id === ctx.tab) || Q.data.chapters[0]; if (!ch) return;
      const [n, m] = Q.chapterCount(ch.id);
      add('p', 'd37sh-note', ch.icon + ' ' + ch.title + ': ' + n + ' из ' + m + (ch.id === 'helpers' ? ' · вся глава — седьмая ячейка 💍' : ch.id === 'ach' ? ' · награды — как раньше (монеты за аккаунт)' : ''));
      const list = add('div', 'kx-acc');
      for (const q of ch.quests) {
        const s = Q.status(q.id), r = add('button', 'kx-arow kx-qrow ' + s, null, list); r.type = 'button'; r.dataset.q = q.id;
        const i = add('span', 'kx-ai', null, r); if (s === 'hidden') i.textContent = '❔'; else icon(i, q);
        const t = add('div', '', null, r);
        add('b', '', s === 'hidden' ? '???' : q.title, t);
        const pr = Q.progress(q.id), left = pr.find(p => p[0] < p[1]);
        add('small', '', s === 'hidden' ? 'Откроется позже' : s === 'locked' ? 'Сначала: ' + q.needs.map(n2 => Q.all.get(n2)?.title || n2).join(', ') : s === 'claimed' ? 'Готово' : s === 'done' ? 'Готово — забери награду' : left ? taskText(left[2]) + ' · ' + left[0] + '/' + left[1] : '', t);
        add('span', 'kx-qst', ICON[s] + (Q.state.pins.includes(q.id) ? '📌' : ''), r);
      }
      body.onclick = e => { const b = e.target.closest('[data-q]'); if (b && Q.status(b.dataset.q) !== 'hidden') { view.q = b.dataset.q; ctx.sh.redraw(); } };
    }
    function taskText(t){
      const T = id => id && id[0] === '#' ? (id === '#log' ? 'брёвна' : id === '#planks' ? 'доски' : id.slice(1)) : V.item(id)?.title || V.block(id)?.title || id;
      switch (t.t) {
        case 'have': return 'Собрать: ' + T(t.item);
        case 'craft': return 'Сделать: ' + T(t.item);
        case 'smelt': return 'Выплавить: ' + T(t.item);
        case 'break': return 'Добыть: ' + T(t.block);
        case 'place': return 'Поставить: ' + T(t.block);
        case 'use': return 'Использовать: ' + T(t.item);
        case 'eat': return 'Съесть: ' + T(t.item);
        case 'kill': return 'Победить: ' + (window.KubomirEnts?.MOBS?.[t.mob]?.title || t.mob || 'монстров');
        case 'visit': return 'Побывать: ' + (BIOME_RU[t.biome] || t.biome);
        case 'reach': return 'Уйти от начала мира на ' + t.n + ' блоков';
        case 'depth': return 'Спуститься ниже Y ' + t.n;
        case 'days': return 'Прожить дней: ' + t.n;
        case 'sleep': return 'Поспать на лежанке';
        case 'ach': return 'Достижение';
        default: return 'Отметить';
      }
    }
    function detail(body, q, add){
      if (!q) return;
      const s = Q.status(q.id);
      const head = add('div', 'kx-rhead'), ic = add('span', 'kx-rbig', null, head); icon(ic, q); ic.classList.add('kx-qbig');
      const hb = add('div', '', null, head); add('b', '', q.title, hb); add('small', '', ICON[s] + ' ' + { claimed: 'выполнено', done: 'выполнено — забери награду', open: 'в пути', locked: 'закрыто', hidden: '???' }[s], hb);
      if (q.text) add('p', 'd37sh-note', q.text);
      for (const [n, m, t] of Q.progress(q.id)) {
        const row = add('div', 'kx-qtask'); add('span', '', taskText(t) + ' — ' + Math.min(n, m) + ' / ' + m, row);
        const bar = add('div', 'kx-qbar', null, row), fill = add('i', '', null, bar); fill.style.width = Math.round(Math.min(1, n / m) * 100) + '%';
      }
      if (q.rewards.length) {
        add('h4', 'kx-rh', '🎁 Награда');
        const rw = add('div', 'kx-ruses');
        for (const r of q.rewards) if (r.t === 'item' && V.item(r.id)) { const b = add('span', 'kx-ri sm', null, rw); b.style.backgroundImage = 'url(' + V.iconURL(r.id, 40) + ')'; b.title = V.item(r.id).title + ' ×' + r.n; if (r.n > 1) add('b', 'kx-qn', String(r.n), b); }
      }
      const btns = add('div', 'kx-wptop');
      if (s === 'done' && q.rewards.length) { const b = add('button', 'kx-btn pri', '🎁 Забрать', btns); b.type = 'button'; b.dataset.claim = q.id; }
      if (s === 'open' || s === 'done') { const pinned = Q.state.pins.includes(q.id), b = add('button', 'kx-btn', pinned ? '📌 Не следить' : '📌 Следить (строка на экране)', btns); b.type = 'button'; b.dataset.pin = q.id; }
      body.onclick = e => {
        const c = e.target.closest('[data-claim]'), p = e.target.closest('[data-pin]');
        if (c) { claim(c.dataset.claim); X.sheet.redraw(); }
        else if (p) { if (Q.state.pins.includes(p.dataset.pin)) Q.unpin(p.dataset.pin); else Q.pin(p.dataset.pin); track(); X.sheet.redraw(); }
      };
    }
    // забрать награду: вещи — в сумку (не влезло — выпало рядом); «открыть» — флаг игрока
    function claim(id){
      const R = Q.claim(id); if (!R) return false;
      for (const r of R) {
        if (r.t === 'item' && V.item(r.id)) { const left = g.give?.({ id: r.id, n: r.n }) ?? r.n; if (left > 0) g.spawnItem?.(P.x, P.y + 1, P.z, { id: r.id, n: left }); }
        else if (r.t === 'unlock') X.ext('flags')[r.id] = 1;
      }
      g.sound?.('coin', { vol: .5, rate: 1.3 });
      g.toast?.('🎁 Награда — в сумке', true);
      track();
      return true;
    }
    f.state = () => ({ stats: Q.stats(), pins: Q.state.pins.slice(), errors: Q.errors.slice() });
    f._claim = claim; f._open = open;
    return f;
  });
  window.KubomirQuests = { DATA };
})();

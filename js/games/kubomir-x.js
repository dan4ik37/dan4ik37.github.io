// ═══════════════════════════════════════
//  «КУБОМИР» × помощники (T-049, docs/plans/kubomir-modpacks.md §4.0 и §7½) — переходник к общим модулям движка:
//  D37E.host (шов: события, данные игрока), D37E.accessories (ячейки аксессуаров), D37E.sheet (листы окон)
// ═══════════════════════════════════════
// kubomir.js зовёт: X = KubomirX.attach(st, g) после окон (st.ui) — g: что умеет игра (give, toast, unlock, breakTime, …);
// X.update(dt) — шаг логики, X.hud(dt) — кадр (после hudUpdate), X.emit(тип, a, b, c, d) — события (break, place, craft, smelt,
// pickup, kill, eat, knockout, respawn, ach, day, biome); X.useBlock(hit, b) / X.useItem(s, it, which, hit) — ПКМ по своим
// блокам и вещам (лежанка, карта, книга, свиток, ведро, аксессуар — надеть); X.escape() — Esc закрыл свой лист; X.isOpen();
// X.home() — дом (лежанка) этого игрока; X.dispose(). Помощники — отдельные файлы: KubomirX.feature((st, X) => помощник)
// (kubomir-info.js, kubomir-recipes.js, kubomir-world.js, kubomir-map.js, kubomir-quests.js); упавший выключается, игра живёт.
// Данные игрока помощников — st.P.ext (сохраняется с игроком: meta.player.ext; «вместе» — у хозяина в meta.coopPlayers),
// аксессуары — st.P.acc (как сумка: meta.player.acc). Аксессуары остаются при нокауте (как в Террарии) — это развитие игрока.
(() => {
  const E = () => window.D37E, VX = () => window.D37E.vox;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FEATS = [];
  // Ячейки аксессуаров: 2 сразу, дальше — развитием (достижения этого игрока; босс — когда появятся боссы). Данные — правим тут
  const ACC_MAX = 8;
  const ACC_RULES = [
    { n: 2, why: 'С начала' },
    { n: 3, req: 'ach:night', why: 'Переживи первую ночь (достижение «Пережил ночь»)' },
    { n: 4, req: 'ach:iron', why: 'Выплавь железо (достижение «Железный век»)' },
    { n: 5, req: 'ach:deep', why: 'Спустись ниже 12-го уровня (достижение «Глубоко копаешь»)' },
    { n: 6, req: 'ach:diamond', why: 'Добудь алмаз (достижение «Алмазы!»)' },
    { n: 7, req: 'quest:chapter:helpers', why: 'Пройди главу «Помощники» Дорожной книги (📜)' },
    { n: 8, req: 'boss:1', why: 'Победи первого босса (боссы скоро появятся)' },
  ];
  window.KubomirX = { feature: f => { FEATS.push(f); }, attach, ACC_MAX, ACC_RULES, FEATS };

  function attach(st, g = {}){
    const Ex = E();
    if (!Ex?.host || !Ex.accessories) return null;
    const P = st.P;
    if (!P.ext || typeof P.ext !== 'object') P.ext = {};
    if (!Array.isArray(P.acc)) P.acc = new Array(ACC_MAX).fill(null);
    while (P.acc.length < ACC_MAX) P.acc.push(null);
    const H = Ex.host({ id: 'kubomir', ext: () => st.P.ext, onFail: f => g.toast?.('⚠️ Помощник «' + (f.title || f.id) + '» выключен до перезахода (ошибка)') });
    const X = { st, g, H, emit: H.emit, ext: H.ext, feats: [], sheet: null };
    try { Ex.sheet?.css?.(); } catch (e) {}   // стили листов — сразу (вставка <style> пересчитывает страницу: пусть при входе, не при первом окне)
    // ── прогресс игрока (для ячеек и заданий): свои достижения (у гостя «вместе» мир чужой — считаем по игроку) ──
    const prog = H.ext('prog'); if (!prog.ach || typeof prog.ach !== 'object') prog.ach = {};
    for (const k in st.meta?.ach || {}) if (!st.coopGuest) prog.ach[k] = 1;   // старые миры: уже полученные достижения этого мира
    X.has = req => {
      const s = String(req || ''), i = s.indexOf(':'), kind = s.slice(0, i), id = s.slice(i + 1);
      if (kind === 'ach') return !!prog.ach[id];
      if (kind === 'quest') return !!X.questDone?.(id);
      if (kind === 'flag') return !!H.ext('flags')[id];
      return false;   // boss:… — боссов пока нет
    };
    // ── аксессуары ──
    const accSave = H.ext('acc');
    const A = X.acc = Ex.accessories.create({ max: ACC_MAX, rules: ACC_RULES, slots: P.acc, all: () => !!st.creative, has: X.has,
      fxOf: id => { const it = VX().item(id); return it && Array.isArray(it.acc) && it.acc.length ? it.acc : null; } });
    A.load(accSave);
    accSave.o = A.open;
    X.on = fx => A.on(fx);
    X.accChanged = () => { A.changed(); accSave.o = A.open; H.emit('equip'); };
    // открылась ячейка — сказать (один раз на ячейку)
    X.refreshSlots = () => { const n = A.refresh(); accSave.o = A.open; if (n > 0 && !st.creative) { g.toast?.('💍 Открыта новая ячейка аксессуаров (' + A.open + ' из ' + ACC_MAX + ')', true); g.sound?.('coin', { vol: .45, rate: 1.2 }); } return n; };
    // надеть из руки (ПКМ с аксессуаром) — в первую свободную ячейку
    X.equip = (s, from) => {
      const it = s && VX().item(s.id); if (!it || !A.isAcc(s.id)) return false;
      const i = A.firstFree(s);
      if (i < 0) { const dup = P.acc.some((q, k) => k < A.open && q && q.id === s.id); g.toast?.(dup ? '💍 ' + it.title + ' уже надет(а)' : A.open ? '💍 Все ячейки аксессуаров заняты — сними что-нибудь (☰ → 💍 Помощники)' : '💍 Ячеек аксессуаров пока нет'); return true; }
      P.acc[i] = { id: s.id, n: 1, d: s.d | 0 };
      from?.();   // вызывающий убирает вещь из руки
      X.accChanged();
      g.sound?.('click', { vol: .5, rate: 1.3 });
      g.toast?.('💍 ' + it.title + ': ' + Ex.accessories.describe(it.acc), true);
      return true;
    };
    X.unequip = i => {
      const s = P.acc[i]; if (!s) return false;
      const left = g.give?.({ id: s.id, n: 1, d: s.d | 0 }) ?? 1;
      if (left > 0) { g.toast?.('🎒 Сумка полна — сначала освободи место'); return false; }
      P.acc[i] = null; X.accChanged(); g.sound?.('click', { vol: .4, rate: .9 });
      return true;
    };
    // ── встроенный помощник: аксессуары (ячейки открываются развитием; список — листом, понятно и геймпадом) ──
    H.register({ id: 'acc', title: 'Аксессуары', order: -100,
      on: { ach: id => { if (prog.ach[id]) return; prog.ach[id] = 1; X.refreshSlots(); } },
    });
    // ── помощники из других файлов ──
    for (const make of FEATS) {
      try { const f = make(st, X); if (f) { X.feats.push(f); H.register(f); } }
      catch (e) { console.warn('Помощник не подключился:', e); try { window.d37Err?.('kx:make', e); } catch (er) {} }
    }
    H.init();
    // ── события мира, которые игра сама не шлёт: смена биома (погода знает его раз в 2 с), новый день ──
    let biome = '', day = st.meta?.day | 0, slow = 0;
    X.update = dt => {
      if ((slow -= dt) <= 0) {
        slow = .25;
        const b = st.WX?.biome || ''; if (b && b !== biome) { const was = biome; biome = b; if (was) H.emit('biome', b, was); }
        const d = st.meta?.day | 0; if (d !== day) { day = d; H.emit('day', d); }
      }
      H.update(dt);
    };
    X.hud = dt => H.hud(dt);
    // ПКМ по своему блоку / своей вещью: первый помощник, который взял, — сделал
    // (событие 'use' шлёт сам помощник — только когда действие удалось: «уже зарисовано» и т. п. — не считается)
    X.useBlock = (hit, b) => { for (const f of X.feats) { if (f.dead || !f.useBlock) continue; try { if (f.useBlock(hit, b)) return true; } catch (e) { H.fail(f, e); } } return false; };
    X.useItem = (s, it, which, hit) => {
      if (A.isAcc(s.id) && !it.place) return X.equip(s, () => g.take?.(which));   // аксессуар в руке — надеть
      for (const f of X.feats) { if (f.dead || !f.useItem) continue; try { if (f.useItem(s, it, which, hit)) return true; } catch (e) { H.fail(f, e); } }
      return false;
    };
    X.home = () => { for (const f of X.feats) if (!f.dead && f.home) { try { const h = f.home(); if (h) return h; } catch (e) {} } return null; };
    // листы (D37E.sheet): одно окно поверх мира; игра блокирует управление, пока открыт (как окно модов)
    X.open = o => {
      const wr = g.wrap?.(); if (!wr || !Ex.sheet) return null;
      st.I?.unlock?.(); st.C?.reset_state?.();
      const sh = Ex.sheet.open(wr, Object.assign({}, o, { onClose: () => { if (X.sheet === sh) X.sheet = null; st.C?.reset_state?.(); try { o.onClose?.(); } catch (e) {} } }));
      X.sheet = sh;
      return sh;
    };
    X.isOpen = () => !!(X.sheet && !X.sheet.dead);
    X.escape = () => { if (!X.isOpen()) return false; X.sheet.goBack(); return true; };
    X.closeSheet = () => { if (X.isOpen()) X.sheet.close(); };
    // значки вещей — заранее, в простое браузера (по несколько за раз): первое открытие сумки, книги рецептов, заданий не рисует
    // каждый значок заново (V.icon + перевод в картинку — на телефоне ×4 до 2 мс на значок, 100+ вещей)
    let warmI = 0, warmId = 0, warmOff = false;
    const hasDoc = typeof document !== 'undefined' && typeof window !== 'undefined';
    const ric = hasDoc && window.requestIdleCallback ? f => window.requestIdleCallback(f, { timeout: 2500 }) : f => setTimeout(() => f({ timeRemaining: () => 4, didTimeout: false }), 250);
    const cic = id => { try { (hasDoc && window.cancelIdleCallback && window.requestIdleCallback ? window.cancelIdleCallback : clearTimeout)(id); } catch (e) {} };
    function warm(dl){
      warmId = 0; if (warmOff) return;
      const V = VX(), L = V.items || [];
      // простоя нет (слабый телефон: кадр занят целиком) — по 2 значка раз в 2,5 с (~1 мс), иначе — пока есть простой, до 6
      for (let n = 0; warmI < L.length && n < (dl.didTimeout ? 2 : 6); n++) {
        if (n && !dl.didTimeout && !(dl.timeRemaining() > 3)) break;
        const it = L[warmI++]; if (it && it.name) { try { V.iconURL(it.name, 40); } catch (e) { warmOff = true; return; } }
      }
      if (warmI < L.length) warmId = ric(warm);
    }
    if (hasDoc && VX()?.iconURL) warmId = ric(warm);
    X.dispose = () => { warmOff = true; if (warmId) cic(warmId); warmId = 0; X.closeSheet(); H.dispose(); };
    // ── лист «💍 Помощники»: что надето, что в сумке, как открыть ещё ячейки (телефон, геймпад — кнопками) ──
    X.openAcc = () => X.open({ id: 'acc', title: '💍 Помощники', sub: 'аксессуары — действуют, пока надеты', render: body => accSheet(body) });
    function accSheet(body){
      const V = VX(), D = Ex.accessories.describe;
      let h = '<div class="kx-acc">';
      for (let i = 0; i < ACC_MAX; i++) {
        const s = P.acc[i], it = s && V.item(s.id);
        if (i >= A.open) { const r = A.ruleFor(i); h += `<div class="kx-arow lock"><span class="kx-ai">🔒</span><div><b>Ячейка ${i + 1}</b><small>${esc(r ? r.why : 'Откроется позже')}</small></div></div>`; continue; }
        h += it ? `<div class="kx-arow"><span class="kx-ai" data-icon="${esc(s.id)}"></span><div><b>${esc(it.title)}</b><small>${esc(D(it.acc))}</small></div><button type="button" class="kx-btn" data-acc-off="${i}">Снять</button></div>`
          : `<div class="kx-arow empty"><span class="kx-ai">◌</span><div><b>Ячейка ${i + 1} свободна</b><small>Надень помощника из сумки (кнопка ниже) или ПКМ с ним в руке</small></div></div>`;
      }
      const bag = []; P.inv.forEach((s, j) => { if (s && A.isAcc(s.id) && !bag.some(b => b.s.id === s.id)) bag.push({ s, j }); });
      h += `</div><p class="d37sh-note">${bag.length ? 'В сумке:' : st.creative ? 'В «Творчестве» все помощники действуют сами.' : 'Помощников в сумке нет. Их делают на верстаке: часы, компас, глубиномер, лупа, рудоискатель, атлас; часы + компас + глубиномер → навигатор.'}</p>`;
      if (bag.length) { h += '<div class="kx-acc">'; for (const b of bag) { const it = V.item(b.s.id); h += `<div class="kx-arow"><span class="kx-ai" data-icon="${esc(b.s.id)}"></span><div><b>${esc(it.title)}</b><small>${esc(D(it.acc))}</small></div><button type="button" class="kx-btn pri" data-acc-on="${b.j}">Надеть</button></div>`; } h += '</div>'; }
      body.innerHTML = h;
      for (const e of body.querySelectorAll('[data-icon]')) e.style.backgroundImage = 'url(' + V.iconURL(e.dataset.icon, 40) + ')';
      body.onclick = e => {
        const off = e.target.closest('[data-acc-off]'), on = e.target.closest('[data-acc-on]');
        if (off) { X.unequip(+off.dataset.accOff); X.sheet?.redraw(); }
        else if (on) { const j = +on.dataset.accOn, s = P.inv[j]; if (s) X.equip(s, () => { if (--s.n <= 0) P.inv[j] = null; }); X.sheet?.redraw(); }
      };
    }
    X.refreshSlots();
    return X;
  }
})();

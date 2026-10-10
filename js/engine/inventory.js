// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — вещи: стопки, ячейки, вес и перегруз, ящик с кодовым замком, тайник
//  (перенос Inventory/InventoryApi.InventoryStore + Core/Crafting (вес, стопки, ячейки, груз) + Building/StorageBox из Unity)
// ═══════════════════════════════════════
// D37E.items.def(id, { name, kg, stack, slot }) — описание вещи; уже есть стройматериалы из Unity: scrap (металлолом),
// fasteners (крепёж), cloth (ткань), wire (провод), metal (металл), wood (доски), codelock (кодовый замок).
// inv = D37E.inventory({ slots: 14, kg: 30 }) → give(id, n) → сколько влезло (ячейки и вес: тяжелее 45 кг уже не поднять),
// take(id, n) → сколько взяли, count(id), has(cost), pay(cost) (cost = { id: n }), roomFor(id), slotsUsed(), kg(),
// load() (0 — налегке, 1 — предел 30 кг, > 1 — перегруз), speedMul() (налегке 1, на пределе 0,8, перегруз до 0,55),
// noiseMul(), staminaMul(), canRun() (бег — пока не перегружен), on('change', f), toJSON() / fromJSON(obj).
// box = D37E.storage({ owner, code, inv }) → tryOpen(who, code, now) → { ok, why } (свои — сразу; чужой — только верный код,
// после — допущен; 3 ошибки — замок на 5 с), trusted(who), setCode(who, code); hidden: тайник — revealed(dist, присел, знает).
// mates(a, b) — «свои» (по умолчанию — тот же человек; игра может подставить друзей/клан).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};

  // ── Описания вещей (Crafting.Weight / StackSize / Name) ──
  const DEF = new Map();
  const items = E.items = {
    def(id, o){ DEF.set(id, { id, name: o.name || id, kg: o.kg ?? .5, stack: Math.max(1, o.stack ?? 1), slot: Math.max(1, o.slot ?? 1), icon: o.icon || '📦', desc: o.desc || '' }); return DEF.get(id); },
    get: id => DEF.get(id) || { id, name: id, kg: .5, stack: 1, slot: 1, icon: '📦', desc: '' },
    name: id => (DEF.get(id) || { name: id }).name,
    all: () => [...DEF.values()],
  };
  items.def('scrap', { name: 'металлолом', kg: 1, stack: 10, icon: '🔩', desc: 'сырьё: постройки, торг, плата' });
  items.def('fasteners', { name: 'крепёж', kg: .3, stack: 10, icon: '🪛', desc: 'гвозди и болты для построек' });
  items.def('cloth', { name: 'ткань', kg: .4, stack: 10, icon: '🧵' });
  items.def('wire', { name: 'провод', kg: .2, stack: 10, icon: '➰', desc: 'для брони и приборов' });
  items.def('metal', { name: 'металл', kg: .8, stack: 10, icon: '⛓️' });
  items.def('wood', { name: 'доски', kg: .8, stack: 1, icon: '🪵' });
  items.def('codelock', { name: 'кодовый замок', kg: .6, stack: 3, icon: '🔐', desc: 'на дверь, люк или ящик' });

  const SLOTS = 14, MAX_KG = 30;
  E.inventory = function (o = {}){
    const ev = E.emitter ? E.emitter() : null;
    const inv = { stock: new Map(), slots: o.slots ?? SLOTS, maxKg: o.kg ?? MAX_KG };
    inv.hardKg = () => inv.maxKg * 1.5;
    inv.on = (e, f) => ev ? ev.on(e, f) : () => {};
    const changed = () => ev?.emit('change', inv);
    inv.count = id => inv.stock.get(id) || 0;
    const slotsOf = (id, n) => { const d = items.get(id); return n <= 0 ? 0 : Math.ceil(n / d.stack) * d.slot; };
    inv.slotsUsed = () => { let s = 0; for (const [id, n] of inv.stock) s += slotsOf(id, n); return s; };
    inv.kg = () => { let w = 0; for (const [id, n] of inv.stock) w += items.get(id).kg * n; return w; };
    // Сколько ещё влезет: по ячейкам (стопки) и по весу (жёсткий предел)
    inv.roomFor = (id, slotsOnly = false) => {
      const d = items.get(id), have = inv.count(id);
      const other = inv.slotsUsed() - slotsOf(id, have);
      const bySlots = Math.floor((inv.slots - other) / d.slot) * d.stack - have;
      const byWeight = d.kg <= 0 || slotsOnly ? Infinity : Math.floor((inv.hardKg() - inv.kg()) / d.kg + 1e-4);
      return Math.max(0, Math.min(bySlots, byWeight));
    };
    inv.give = (id, n = 1) => {
      if (n < 0) return -inv.take(id, -n);
      const t = Math.min(inv.roomFor(id), n | 0);
      if (t > 0) { inv.stock.set(id, inv.count(id) + t); changed(); }
      return t;
    };
    inv.take = (id, n = 1) => {
      const t = Math.min(inv.count(id), n | 0);
      if (t <= 0) return 0;
      const left = inv.count(id) - t;
      if (left > 0) inv.stock.set(id, left); else inv.stock.delete(id);
      changed();
      return t;
    };
    inv.has = cost => Object.entries(cost || {}).every(([id, n]) => inv.count(id) >= n);
    inv.pay = cost => { if (!inv.has(cost)) return false; for (const [id, n] of Object.entries(cost)) inv.take(id, n); return true; };
    // Груз (Crafting.Load / SpeedMul / NoiseMul, InventoryModel.Encumbrance)
    inv.load = () => { const w = inv.kg(), m = inv.maxKg; return w <= m * .4 ? 0 : (w - m * .4) / (m * .6); };
    inv.speedMul = () => { const l = inv.load(); return l <= 1 ? 1 - .2 * l : Math.max(.55, .8 - .25 * (l - 1)); };
    inv.noiseMul = () => 1 + .6 * Math.min(inv.load(), 1.5);
    inv.staminaMul = () => 1 + .8 * Math.min(inv.load(), 1.5);
    inv.canRun = () => inv.load() <= 1;
    // Передать в другой инвентарь (ящик): сколько влезло там
    inv.moveTo = (other, id, n) => { const t = Math.min(n, inv.count(id), other.roomFor(id)); if (t <= 0) return 0; inv.take(id, t); other.give(id, t); return t; };
    inv.list = () => [...inv.stock].map(([id, n]) => ({ id, n, ...items.get(id) }));
    inv.toJSON = () => Object.fromEntries(inv.stock);
    inv.fromJSON = obj => { inv.stock.clear(); for (const [id, n] of Object.entries(obj || {})) if ((n | 0) > 0) inv.stock.set(id, n | 0); changed(); return inv; };
    inv.clear = () => { inv.stock.clear(); changed(); };
    return inv;
  };

  // ── Ящик базы как в Rust: кодовый замок для чужих, тайник под полом (Building/StorageBox.cs) ──
  E.storage = function (o = {}){
    const box = { inv: o.inv || E.inventory({ slots: o.slots ?? 24, kg: o.kg ?? 200 }), owner: o.owner || '', code: o.code ?? null, authed: [...(o.authed || [])],
      hidden: !!o.hidden, mates: o.mates || ((a, b) => !!a && a === b), wrong: 0, lockoutUntil: -1, lockouts: 0 };
    box.trusted = who => box.mates(who, box.owner) || box.authed.some(a => box.mates(who, a));
    // Открыть: свой — сразу; чужой — только верный код (после — допущен). why — по-русски
    box.tryOpen = (who, entered, now) => {
      if (!who) return { ok: false, why: 'Кто ты?' };
      if (box.code == null) return { ok: true };
      if (box.trusted(who)) return { ok: true };
      if (now < box.lockoutUntil) return { ok: false, why: 'Замок заблокирован — подожди' };
      if (entered != null && String(entered) === String(box.code)) { box.authed.push(who); box.wrong = 0; return { ok: true }; }
      if (entered == null) return { ok: false, why: 'Заперто кодовым замком', needCode: true };
      if (++box.wrong >= 3) { box.wrong = 0; box.lockoutUntil = now + 5; box.lockouts++; }
      return { ok: false, why: 'Неверный код', needCode: true };
    };
    // Поставить/сменить код — только свой; новый код сбрасывает допуски
    box.setCode = (who, code) => {
      if (box.code != null && !box.trusted(who)) return false;
      if (code != null && !/^\d{4}$/.test(String(code))) return false;
      box.code = code == null ? null : String(code); box.authed = []; box.wrong = 0;
      return true;
    };
    box.REVEAL = 1.5 * (E.UNIT || 1);
    box.revealed = (dist, crouchedSearching, knowsWhere) => !box.hidden || knowsWhere || (crouchedSearching && dist <= box.REVEAL);
    box.toJSON = () => ({ owner: box.owner, code: box.code, authed: box.authed, hidden: box.hidden, inv: box.inv.toJSON() });
    return box;
  };
})();

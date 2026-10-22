// ═══════════════════════════════════════
//  D37E.accessories — ячейки аксессуаров (T-049; решение владельца 22.10, docs/plans/kubomir-modpacks.md §7½)
// ═══════════════════════════════════════
// Владелец: «с развитием и добавлением в аксессуары, чтобы место не занимало и надо было потрудиться; как доп. слоты помимо
// аксессуаров — в модах Майна есть мод на кольца, в Террарии тоже есть такое». Помощники (часы, компас, глубиномер, лупа, атлас…)
// — это вещи-аксессуары: их делают, надевают в ОТДЕЛЬНЫЕ ячейки (не занимают сумку и панель) и они действуют, пока надеты.
// Ячеек сначала мало, новые открываются развитием (правила — данными: достижение, глубина, задание, босс). Модуль общий для игр
// (без DOM и Three.js): у «Кубомира» переходник — js/games/kubomir-x.js, у «Подземья» будет свой (его сапоги и крылья — аксессуары).
//   A = D37E.accessories.create({ max, rules: [{ n, req, why }], slots, fxOf(id) → ['time', …] | null, has(req) → bool, all() → bool })
//     slots — массив ячеек игрока (длина max; храни и сохраняй его вместе с вещами, как сумку), ячейка — { id, n, d } | null
//     rules — сколько ячеек открыто: правило без req — сразу; с req — когда has(req) (открытое не закрывается: A.open хранится)
//   A.on(fx) — надета ли вещь с этим действием (O(1), без мусора; all() — «всё действует», например «Творчество»)
//   A.canPut(i, s) → '' | 'lock' | 'not' | 'dup';  A.firstFree(s) → i | −1;  A.why(i) — почему ячейка закрыта
//   A.changed() — ячейки поменяли (пересчитать действия); A.refresh() → сколько ячеек открылось сейчас (для «🎉 новая ячейка»)
//   A.rev — растёт при каждом изменении (HUD сравнивает и перерисовывает только тогда); A.save() / A.load(o) — сколько открыто
//   D37E.accessories.FX — общие действия (значок, название, что делает) — для подсказок в любой игре
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};

  // общие действия аксессуаров (игра может добавить свои — FX[id] = { … }); названия — свои
  const FX = {
    time: { icon: '🕐', title: 'Время', text: 'показывает время суток и день' },
    dir: { icon: '🧭', title: 'Стороны света', text: 'показывает, куда смотришь, и координаты X / Z' },
    depth: { icon: '⛏', title: 'Глубина', text: 'показывает высоту Y и слой: поверхность, пещеры, глубины' },
    target: { icon: '🔎', title: 'Что под прицелом', text: 'название блока или существа, чем копать и что выпадет' },
    ore: { icon: '💠', title: 'Руда рядом', text: 'самую ценную руду в 16 блоках и куда идти' },
    map: { icon: '🗺', title: 'Мини-карта', text: 'карта вокруг, точки, где лежат вещи после нокаута' },
    life: { icon: '🐾', title: 'Существа рядом', text: 'сколько зверей и монстров вокруг' },
  };

  function create(o = {}){
    const max = Math.max(1, o.max | 0 || 6), rules = Array.isArray(o.rules) ? o.rules.slice().sort((a, b) => (a.n | 0) - (b.n | 0)) : [{ n: max }];
    const slots = Array.isArray(o.slots) ? o.slots : new Array(max).fill(null);
    while (slots.length < max) slots.push(null);
    const fxOf = typeof o.fxOf === 'function' ? o.fxOf : () => null;
    const has = typeof o.has === 'function' ? o.has : () => false;
    const all = typeof o.all === 'function' ? o.all : () => false;
    const cnt = Object.create(null);
    const A = { slots, max, rules, open: 0, rev: 1, fx: cnt };
    // сколько открыто по правилам прямо сейчас (не меньше уже открытого)
    const byRules = () => { let n = 0; for (const r of rules) if (!r.req || has(r.req)) n = Math.max(n, Math.min(max, r.n | 0)); return n; };
    A.refresh = () => {
      const was = A.open, now = all() ? max : Math.max(was, byRules());
      if (now !== was) { A.open = now; A.changed(); }
      return Math.max(0, now - was);
    };
    A.changed = () => {
      for (const k in cnt) cnt[k] = 0;
      for (let i = 0; i < A.open && i < slots.length; i++) {
        const s = slots[i]; if (!s) continue;
        const f = fxOf(s.id); if (!f) continue;
        for (let j = 0; j < f.length; j++) cnt[f[j]] = (cnt[f[j]] | 0) + 1;
      }
      A.rev++;
    };
    A.on = fx => all() || cnt[fx] > 0;
    A.isAcc = id => !!fxOf(id);
    A.canPut = (i, s) => {
      if (i < 0 || i >= max) return 'lock';
      if (i >= A.open) return 'lock';
      if (!s) return '';
      if (!fxOf(s.id)) return 'not';
      for (let j = 0; j < slots.length; j++) if (j !== i && slots[j] && slots[j].id === s.id) return 'dup';   // два одинаковых — не надеть (как в Террарии)
      return '';
    };
    A.firstFree = s => { for (let i = 0; i < A.open; i++) if (!slots[i] && A.canPut(i, s) === '') return i; return -1; };
    // правило, которое откроет ячейку i (или null — ячейка уже открыта / открыть нельзя)
    A.ruleFor = i => { if (i < A.open) return null; for (const r of rules) if ((r.n | 0) > i && (!r.req || !has(r.req))) return r; return null; };
    A.why = i => { const r = A.ruleFor(i); return r ? r.why || 'Откроется позже' : ''; };
    A.save = () => ({ o: A.open });
    A.load = s => { A.open = Math.max(0, Math.min(max, (s && s.o) | 0)); A.refresh(); A.changed(); };
    // что действует сейчас (список id действий; для подсказок и проверок)
    A.active = () => { const out = []; for (const k in cnt) if (cnt[k] > 0) out.push(k); return out; };
    A.refresh(); A.changed();
    return A;
  }

  // описание вещи-аксессуара для подсказки: «🕐 время суток · 🧭 стороны света»
  function describe(fx){ return (fx || []).map(k => FX[k] ? FX[k].icon + ' ' + FX[k].text : k).join(' · '); }

  E.accessories = { create, FX, describe };
})();

// ═══════════════════════════════════════
//  «МИР ДЕНЧИКА»: РАЙОН УЧАСТКОВ — своя база, как в Clash of Clans, и свой дом, как в Аватарии. mir.js подключает
//  этот файл маленькими «крючками» (помечены «район участков»): зона на карте, шаг, кадр, сеть, выход.
// ═══════════════════════════════════════
// Участок — 12×12 клеток по 1,6 ед., на «улице» 6 участков (северо-запад от площади, за кафе); улиц сколько нужно
// (номер участка 1…600, улица = (номер − 1) / 6). Вошедший занимает ОДИН участок (bases.sql: base_claim) и строит:
// ратуша (её уровень — потолок для остальных), дом (заходишь внутрь, ставишь мебель; доступ: все / друзья / никто),
// шахты (кирпичи 🧱 копятся сами, даже без тебя — заходи собирать), склады (вместимость), мастерская (второй
// строитель), вышка (лестница наверх), заборы (соседние соединяются) и украшения. Улучшение — кирпичи + реальное
// время (20 с … 8 ч), строителей 1–2; ускорить — монетами 🪙 сайта. Подарок дня в ратуше, 👍 соседям (+10 🧱 хозяину).
// Считает СЕРВЕР по отметкам времени (base_act); клиент — те же правила (Rules: мгновенный отклик и режим без
// сервера). Цифры — DEFS/FURN ниже и base_defs() в bases.sql (тест PGlite сверяет их и прогоняет одни и те же ходы).
// Без входа или пока bases.sql не выполнен — «пробный участок» в этом браузере (localStorage d37_base); после входа
// он переносится в аккаунт (base_claim с p_import: уровни до 2, кирпичи до 500).
// Чужие участки — base_street (раз в 90 с рядом с районом и по сигналу 'base' в канале мира), дом — base_room
// (сервер пускает по настройке доступа). Постройки участка склеиваются в 2–4 сетки (цвет — в вершинах), дальние
// участки прячутся. Проверка: node scripts/base-test.cjs (правила, геометрия района).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const PI = Math.PI;

  // ═══ Каталог (то, что знает сервер, — base_defs() в bases.sql; n/e/info — только для экрана) ═══
  // w×d — клетки; lv — уровней; cost[L−1] — 🧱 за уровень L (L = 1 — поставить); time[L−1] — секунд; max[ратуша−1] — штук;
  // rate — 🧱 в час, hold — сколько вмещает сама шахта (8 ч), keep — вместимость склада; g: 'deco' — общий лимит украшений;
  // th — с какого уровня ратуши; coins — цена в монетах 🪙 (вместо кирпичей); fixed — не ставится и не убирается.
  const DEFS = {
    th: { n: 'Ратуша', e: '🏛️', w: 3, d: 3, lv: 5, fixed: 1, cost: [0, 500, 2000, 6000, 15000], time: [0, 300, 1800, 7200, 28800], max: [1, 1, 1, 1, 1], keep: [1000, 1500, 2500, 4000, 6000],
      info: 'Сердце участка: её уровень открывает новые постройки и уровни. Здесь же — подарок дня.' },
    house: { n: 'Дом', e: '🏠', w: 5, d: 5, lv: 5, fixed: 1, cost: [0, 300, 1200, 4000, 10000], time: [0, 120, 1200, 5400, 21600], max: [1, 1, 1, 1, 1], furn: [8, 14, 20, 28, 36],
      info: 'Заходи внутрь и расставляй мебель. Чем выше уровень, тем больше мебели.' },
    mine: { n: 'Шахта', e: '⛏️', w: 2, d: 2, lv: 5, cost: [100, 250, 800, 2500, 7000], time: [20, 120, 1200, 5400, 18000], max: [1, 2, 3, 3, 4], rate: [150, 250, 400, 600, 900], hold: [1200, 2000, 3200, 4800, 7200],
      info: 'Добывает кирпичи, даже когда тебя нет. Вмещает 8 часов добычи — заходи собирать!' },
    store: { n: 'Склад', e: '📦', w: 2, d: 2, lv: 5, cost: [150, 400, 1200, 3500, 9000], time: [20, 180, 1500, 5400, 18000], max: [1, 1, 2, 2, 3], keep: [1000, 2500, 5000, 8000, 12000],
      info: 'Больше места для кирпичей: дорогие улучшения без склада не накопить.' },
    shop: { n: 'Мастерская', e: '🛠️', w: 2, d: 2, lv: 1, cost: [1000], time: [600], max: [0, 1, 1, 1, 1], info: 'Второй строитель: две стройки сразу.' },
    tower: { n: 'Вышка', e: '🗼', w: 2, d: 2, lv: 3, cost: [600, 2000, 6000], time: [300, 3600, 14400], max: [0, 0, 1, 1, 2], info: 'Залезь по лестнице и смотри на район сверху. Уровень — выше.' },
    wall: { n: 'Забор', e: '🧱', w: 1, d: 1, lv: 5, cost: [10, 30, 80, 200, 500], time: [0, 0, 0, 0, 0], max: [20, 30, 40, 50, 60], info: 'Соседние куски соединяются сами. Улучшается сразу, без строителя.' },
    tree: { n: 'Дерево', e: '🌳', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
    pine: { n: 'Ёлка', e: '🌲', w: 1, d: 1, lv: 1, cost: [30], time: [0], g: 'deco' },
    bush: { n: 'Куст', e: '🌿', w: 1, d: 1, lv: 1, cost: [15], time: [0], g: 'deco' },
    flowers: { n: 'Клумба', e: '🌷', w: 1, d: 1, lv: 1, cost: [15], time: [0], g: 'deco' },
    rock: { n: 'Камень', e: '⛰️', w: 1, d: 1, lv: 1, cost: [10], time: [0], g: 'deco' },
    lamp: { n: 'Фонарь', e: '💡', w: 1, d: 1, lv: 1, cost: [40], time: [0], g: 'deco' },
    flag: { n: 'Флаг', e: '🚩', w: 1, d: 1, lv: 1, cost: [50], time: [0], g: 'deco' },
    bench: { n: 'Скамейка', e: '🪑', w: 2, d: 1, lv: 1, cost: [60], time: [0], g: 'deco', info: 'На неё можно сесть.' },
    fountain: { n: 'Фонтан', e: '⛲', w: 2, d: 2, lv: 1, cost: [300], time: [0], g: 'deco', th: 2 },
    statue: { n: 'Статуя Денчика', e: '🗿', w: 1, d: 1, lv: 1, cost: [0], time: [0], g: 'deco', th: 3, coins: 200, info: 'Золотая статуя — видно издалека.' },
  };
  // Мебель дома: клетки 0,8 ед. (комната 9×9); floor — ковёр (лежит под мебелью)
  const FURN = {
    bed: { n: 'Кровать', e: '🛏️', w: 2, d: 3, cost: 80, coins: 0 },
    sofa: { n: 'Диван', e: '🛋️', w: 3, d: 1, cost: 100, coins: 0, info: 'Можно сесть вдвоём.' },
    chair: { n: 'Стул', e: '🪑', w: 1, d: 1, cost: 20, coins: 0 },
    table: { n: 'Стол', e: '🍽️', w: 2, d: 2, cost: 50, coins: 0 },
    rug: { n: 'Ковёр', e: '🟪', w: 3, d: 3, cost: 40, coins: 0, floor: 1, info: 'Лежит на полу — мебель можно ставить сверху.' },
    lamp: { n: 'Торшер', e: '💡', w: 1, d: 1, cost: 30, coins: 0 },
    plant: { n: 'Цветок в горшке', e: '🌱', w: 1, d: 1, cost: 20, coins: 0 },
    shelf: { n: 'Книжная полка', e: '📚', w: 2, d: 1, cost: 60, coins: 0 },
    wardrobe: { n: 'Шкаф с зеркалом', e: '🪞', w: 2, d: 1, cost: 80, coins: 0, info: 'Подойди — и смени образ персонажа.' },
    tv: { n: 'Телевизор', e: '📺', w: 2, d: 1, cost: 0, coins: 60, info: 'Показывает, в эфире ли Денчик, и ведёт к роликам.' },
    fire: { n: 'Камин', e: '🔥', w: 2, d: 1, cost: 0, coins: 80 },
    aqua: { n: 'Аквариум', e: '🐠', w: 2, d: 1, cost: 0, coins: 100 },
    chess: { n: 'Шахматный столик', e: '♟️', w: 2, d: 3, cost: 0, coins: 120, info: 'Позови друга в гости: сядете — начнётся партия.' },
    arcade: { n: 'Игровой автомат', e: '🕹️', w: 1, d: 1, cost: 0, coins: 150, info: 'Все игры сайта — не выходя из дома.' },
  };
  const N = 12, IN = 9, PER = 6, PLOTS = 600, START = 600, DECO_MAX = [6, 10, 15, 20, 25], DOOR = [3, 6, 7, 9];   // DOOR: x0, x1, z0, z1 — проход от двери (клетки комнаты)
  const pickKeys = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(keys.filter(f => v[f] != null).map(f => [f, v[f]]))]));
  const SERVER = { n: N, in: IN, per: PER, plots: PLOTS, start: START, deco: DECO_MAX, door: DOOR,
    k: pickKeys(DEFS, ['w', 'd', 'lv', 'fixed', 'cost', 'time', 'max', 'keep', 'furn', 'rate', 'hold', 'g', 'th', 'coins']),
    f: pickKeys(FURN, ['w', 'd', 'cost', 'coins', 'floor']) };

  // ═══ Правила (без Three.js и DOM; один в один с base_act в bases.sql) ═══
  const Rules = (() => {
    const fp = (k, r) => { const d = DEFS[k]; return !d ? [1, 1] : r & 1 ? [d.d, d.w] : [d.w, d.d]; };
    const ffp = (k, r) => { const d = FURN[k]; return !d ? [1, 1] : r & 1 ? [d.d, d.w] : [d.w, d.d]; };
    const th = s => { const t = s.layout.find(it => it.k === 'th'); return t ? Math.max(1, t.l) : 1; };
    const houseLv = s => { const h = s.layout.find(it => it.k === 'house'); return h ? Math.max(1, h.l) : 1; };
    const cap = s => s.layout.reduce((c, it) => c + (it.k === 'store' && it.l >= 1 ? DEFS.store.keep[it.l - 1] : 0), DEFS.th.keep[th(s) - 1]);
    const builders = s => 1 + (s.layout.some(it => it.k === 'shop' && it.l >= 1) ? 1 : 0);
    const busy = (s, now) => s.layout.filter(it => it.ue != null && (now == null || it.ue > now)).length;
    const day = now => new Date((now + 10800) * 1000).toISOString().slice(0, 10);   // день по Москве
    const isDeco = k => DEFS[k]?.g === 'deco';
    const limit = (k, t) => isDeco(k) ? DECO_MAX[t - 1] : DEFS[k].max[t - 1];
    const count = (L, k) => L.filter(it => (k === 'deco' ? isDeco(it.k) : it.k === k)).length;
    // Достроилось — новый уровень (шахта копит с момента окончания)
    function norm(s, now){
      for (const it of s.layout) if (it.ue != null && it.ue <= now) { it.l = it.ul; if (it.k === 'mine') it.t0 = it.ue; delete it.ul; delete it.ue; }
      return s;
    }
    // Сколько кирпичей в шахте сейчас (на стройке и при улучшении — не копит)
    function prod(it, now){
      if (it.k !== 'mine' || !(it.l >= 1) || it.ue != null) return 0;
      const D = DEFS.mine;
      return Math.min(D.hold[it.l - 1], Math.floor(D.rate[it.l - 1] * Math.max(0, now - (it.t0 ?? now)) / 3600));
    }
    // Помещается ли прямоугольник (клетки) на участок, не задевая других (skip — сама передвигаемая)
    function fits(L, x, z, w, d, skip = 0){
      if (x < 0 || z < 0 || x + w > N || z + d > N) return false;
      for (const it of L) {
        if (it.i === skip) continue;
        const [iw, id] = fp(it.k, it.r);
        if (x < it.x + iw && it.x < x + w && z < it.z + id && it.z < z + d) return false;
      }
      return true;
    }
    // Мебель: в комнате, не на проходе от двери (кроме ковра), ковры — только с коврами, остальное — с остальным
    function ffits(room, k, x, z, w, d, skip = 0){
      if (x < 0 || z < 0 || x + w > IN || z + d > IN) return false;
      const fl = !!FURN[k]?.floor;
      if (!fl && x < DOOR[1] && DOOR[0] < x + w && z < DOOR[3] && DOOR[2] < z + d) return false;
      for (const it of room) {
        if (it.i === skip || !!FURN[it.k]?.floor !== fl) continue;
        const [iw, id] = ffp(it.k, it.r);
        if (x < it.x + iw && it.x < x + w && z < it.z + id && it.z < z + d) return false;
      }
      return true;
    }
    // Собрать из шахт (id — одна, null — все) на склад, сколько влезет; остаток остаётся в шахте
    function collect(s, id, now){
      let space = Math.max(0, cap(s) - s.bricks), got = 0;
      for (const it of s.layout) {
        if (it.k !== 'mine' || (id != null && it.i !== id)) continue;
        const amt = prod(it, now);
        if (amt <= 0) continue;
        const take = Math.min(amt, space), rate = DEFS.mine.rate[it.l - 1], rem = amt - take;
        space -= take; got += take;
        it.t0 = now - Math.floor((rem * 3600 + rate - 1) / rate);
      }
      s.bricks += got;
      return got;
    }
    const prodSum = (s, id, now) => s.layout.reduce((a, it) => a + (it.k === 'mine' && (id == null || it.i === id) ? prod(it, now) : 0), 0);
    const speedCost = (it, now) => Math.max(1, Math.ceil(Math.max(0, it.ue - now) / 120));
    const fresh = (plot, now) => ({
      plot, bricks: START, seq: 5, access: 'all', likes: 0, gift: '', own: { 'f:bed': 1, 'f:rug': 1 },
      layout: [{ i: 1, k: 'th', x: 5, z: 2, r: 0, l: 1 }, { i: 2, k: 'house', x: 0, z: 6, r: 0, l: 1 }, { i: 3, k: 'mine', x: 9, z: 7, r: 0, l: 1, t0: now }],
      room: [{ i: 4, k: 'bed', x: 0, z: 0, r: 0 }, { i: 5, k: 'rug', x: 3, z: 3, r: 0 }],
    });
    // Ход игрока: мутирует s; { ok, got? , coins? } или { ok: false, reason } (тогда s не тронут, кроме norm).
    // wallet — монеты (как coin_wallet на сервере); без него всё за монеты — 'coins'
    function act(s, a, g, now, wallet){
      g = g || {};
      norm(s, now);
      const fail = reason => ({ ok: false, reason });
      const int = (v, mx) => (Number.isInteger(v) && v >= 0 && v <= mx ? v : null);
      const str = v => (v == null ? null : String(v));
      const t = th(s);
      const payCoins = n => { if (!wallet || wallet.coins < n) return false; return true; };
      switch (a) {
        case 'place': {
          const k = str(g.k), x = int(g.x, N - 1), z = int(g.z, N - 1), r = int(g.r, 3);
          if (k == null || x == null || z == null || r == null) return fail('args');
          const D = DEFS[k];
          if (!D || D.fixed) return fail('kind');
          if ((D.th || 1) > t) return fail('th');
          const lim = limit(k, t);
          if (lim <= 0) return fail('th');
          if (count(s.layout, D.g === 'deco' ? 'deco' : k) >= lim) return fail('max');
          const [w, d] = fp(k, r);
          if (!fits(s.layout, x, z, w, d)) return fail('place');
          const tm = D.time[0], coins = D.coins || 0, cost = D.cost[0];
          const inv = D.g === 'deco' && (s.own[k] || 0) > count(s.layout, k);
          if (!inv) { if (coins > 0) { if (!payCoins(coins)) return fail('coins'); } else if (s.bricks < cost) return fail('bricks'); }
          if (tm > 0 && busy(s) >= builders(s)) return fail('builder');
          let spent = 0;
          if (!inv) {
            if (coins > 0) { wallet.coins -= coins; spent = coins; } else s.bricks -= cost;
            if (D.g === 'deco') s.own[k] = (s.own[k] || 0) + 1;
          }
          const it = { i: ++s.seq, k, x, z, r, l: tm > 0 ? 0 : 1 };
          if (tm > 0) { it.ul = 1; it.ue = now + tm; } else if (k === 'mine') it.t0 = now;
          s.layout.push(it);
          return { ok: true, id: it.i, coins: spent };
        }
        case 'move': {
          const id = int(g.id, 1e6), x = int(g.x, N - 1), z = int(g.z, N - 1), r = int(g.r, 3);
          if (id == null || x == null || z == null || r == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          const [w, d] = fp(it.k, r);
          if (!fits(s.layout, x, z, w, d, id)) return fail('place');
          it.x = x; it.z = z; it.r = r;
          return { ok: true };
        }
        case 'remove': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const i = s.layout.findIndex(e => e.i === id);
          if (i < 0) return fail('id');
          if (!isDeco(s.layout[i].k)) return fail('fixed');
          s.layout.splice(i, 1);
          return { ok: true };
        }
        case 'upgrade': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          const D = DEFS[it.k];
          if (it.ue != null) return fail('busy');
          const nl = it.l + 1;
          if (nl > D.lv) return fail('maxlv');
          if (it.k !== 'th' && nl > t) return fail('lvcap');
          const cost = D.cost[nl - 1], tm = D.time[nl - 1];
          if (s.bricks < cost) return fail('bricks');
          if (tm > 0 && busy(s) >= builders(s)) return fail('builder');
          if (it.k === 'mine' && tm > 0) collect(s, it.i, now);
          s.bricks -= cost;
          if (tm > 0) { it.ul = nl; it.ue = now + tm; } else it.l = nl;
          return { ok: true };
        }
        case 'collect': {
          const id = g.id == null ? null : int(g.id, 1e6);
          if (g.id != null && id == null) return fail('args');
          if (prodSum(s, id, now) <= 0) return fail('empty');
          if (cap(s) - s.bricks <= 0) return fail('full');
          return { ok: true, got: collect(s, id, now) };
        }
        case 'finish': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const it = s.layout.find(e => e.i === id);
          if (!it) return fail('id');
          if (it.ue == null) return fail('idle');
          const n = speedCost(it, now);
          if (!payCoins(n)) return fail('coins');
          wallet.coins -= n;
          it.l = it.ul; delete it.ul; delete it.ue;
          if (it.k === 'mine') it.t0 = now;
          return { ok: true, coins: n };
        }
        case 'gift': {
          if (s.gift === day(now)) return fail('done');
          const add = Math.min(50 + 50 * t, Math.max(0, cap(s) - s.bricks));
          if (add <= 0) return fail('full');
          s.bricks += add; s.gift = day(now);
          return { ok: true, got: add };
        }
        case 'access': {
          if (!['all', 'friends', 'nobody'].includes(g.a)) return fail('args');
          s.access = g.a;
          return { ok: true };
        }
        case 'fplace': {
          const k = str(g.k), x = int(g.x, IN - 1), z = int(g.z, IN - 1), r = int(g.r, 3);
          if (k == null || x == null || z == null || r == null) return fail('args');
          const F = FURN[k];
          if (!F) return fail('kind');
          if (s.room.length >= DEFS.house.furn[houseLv(s) - 1]) return fail('house');
          const [w, d] = ffp(k, r);
          if (!ffits(s.room, k, x, z, w, d)) return fail('place');
          const key = 'f:' + k, inv = (s.own[key] || 0) > s.room.filter(e => e.k === k).length;
          let spent = 0;
          if (!inv) {
            if (F.coins > 0) { if (!payCoins(F.coins)) return fail('coins'); } else if (s.bricks < F.cost) return fail('bricks');
            if (F.coins > 0) { wallet.coins -= F.coins; spent = F.coins; } else s.bricks -= F.cost;
            s.own[key] = (s.own[key] || 0) + 1;
          }
          const it = { i: ++s.seq, k, x, z, r };
          s.room.push(it);
          return { ok: true, id: it.i, coins: spent };
        }
        case 'fmove': {
          const id = int(g.id, 1e6), x = int(g.x, IN - 1), z = int(g.z, IN - 1), r = int(g.r, 3);
          if (id == null || x == null || z == null || r == null) return fail('args');
          const it = s.room.find(e => e.i === id);
          if (!it) return fail('id');
          const [w, d] = ffp(it.k, r);
          if (!ffits(s.room, it.k, x, z, w, d, id)) return fail('place');
          it.x = x; it.z = z; it.r = r;
          return { ok: true };
        }
        case 'fremove': {
          const id = int(g.id, 1e6);
          if (id == null) return fail('args');
          const i = s.room.findIndex(e => e.i === id);
          if (i < 0) return fail('id');
          s.room.splice(i, 1);
          return { ok: true };
        }
      }
      return fail('args');
    }
    // Можно ли поставить (для «призрака» и карточек каталога) — те же проверки без изменения
    function canPlace(s, k, x, z, r, now, wallet){
      const c = clone(s);
      return act(c, 'place', { k, x, z, r }, now, wallet ? { coins: wallet.coins } : undefined);
    }
    // Состояние из localStorage / сервера → проверенное (мусор отбрасывается)
    function sanitize(o){
      if (!o || typeof o !== 'object' || !Array.isArray(o.layout)) return null;
      const L = o.layout.filter(it => it && DEFS[it.k] && Number.isInteger(it.i) && Number.isInteger(it.x) && Number.isInteger(it.z) && Number.isInteger(it.l)).map(it => {
        const e = { i: it.i, k: it.k, x: it.x, z: it.z, r: (it.r | 0) & 3, l: Math.max(0, Math.min(DEFS[it.k].lv, it.l)) };
        if (Number.isFinite(it.ue) && Number.isInteger(it.ul)) { e.ul = it.ul; e.ue = it.ue; }
        if (Number.isFinite(it.t0)) e.t0 = it.t0;
        return e;
      });
      if (!L.some(it => it.k === 'th') || !L.some(it => it.k === 'house')) return null;
      const room = sanitizeRoom(o.room);
      const own = {};
      if (o.own && typeof o.own === 'object') for (const [k, v] of Object.entries(o.own)) if ((DEFS[k] || FURN[k.slice(2)]) && Number.isInteger(v) && v > 0) own[k] = v;
      const seq = Math.max(Number.isInteger(o.seq) ? o.seq : 0, ...L.map(it => it.i), ...room.map(it => it.i), 0);
      return { plot: Number.isInteger(o.plot) ? o.plot : 0, bricks: Math.max(0, o.bricks | 0), seq, access: ['all', 'friends', 'nobody'].includes(o.access) ? o.access : 'all',
        likes: o.likes | 0, gift: typeof o.gift === 'string' ? o.gift : '', own, layout: L, room, rev: o.rev | 0 };
    }
    const sanitizeRoom = items => (Array.isArray(items) ? items : []).filter(it => it && FURN[it.k] && Number.isInteger(it.i) && Number.isInteger(it.x) && Number.isInteger(it.z)).map(it => ({ i: it.i, k: it.k, x: it.x, z: it.z, r: (it.r | 0) & 3 }));
    const clone = s => JSON.parse(JSON.stringify(s));
    return { fp, ffp, th, houseLv, cap, builders, busy, day, isDeco, limit, count, norm, prod, prodSum, fits, ffits, collect, speedCost, fresh, act, canPlace, sanitize, sanitizeRoom, clone };
  })();

  // ═══ Район на карте мира (единицы движка): северо-запад от площади, за кафе ═══
  const CELL = 1.6, LOT = CELL * N, HALF = LOT / 2, ICELL = .8, IHALF = IN * ICELL / 2;
  // Участки: центр и поворот (перед участка — к улице). 0–2 — южный ряд (от входа на запад), 3–5 — северный
  const LOTS = [
    { x: -24.6, z: -28.4, yaw: PI }, { x: -46.8, z: -28.4, yaw: PI }, { x: -69, z: -28.4, yaw: PI },
    { x: -24.6, z: -53.6, yaw: 0 }, { x: -46.8, z: -53.6, yaw: 0 }, { x: -69, z: -53.6, yaw: 0 },
  ];
  const LANE = { x0: -80, x1: -11, z: -41, w: 6 };
  const ZONE = { x0: -81, x1: -10, z0: -66, z1: -12 };   // деревья и трава сюда не растут
  const zone = (x, z) => x > ZONE.x0 && x < ZONE.x1 && z > ZONE.z0 && z < ZONE.z1;
  const inDistrict = (x, z) => x > -80 && x < -14.5 && z > -64 && z < -18;
  const streetOf = plot => Math.floor((plot - 1) / PER);
  const lotOf = plot => (plot - 1) % PER;
  // система участка ↔ мир; система постройки (поворот r по 90°) → участок
  const lotToWorld = (lot, lx, lz) => { const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw); return [lot.x + lx * c + lz * s, lot.z - lx * s + lz * c]; };
  const worldToLot = (lot, wx, wz) => { const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw), dx = wx - lot.x, dz = wz - lot.z; return [dx * c - dz * s, dx * s + dz * c]; };
  const rotXZ = (r, bx, bz) => { const a = r * PI / 2, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); return [bx * c + bz * s, -bx * s + bz * c]; };
  const itemCenter = it => { const [w, d] = Rules.fp(it.k, it.r); return [-HALF + (it.x + w / 2) * CELL, -HALF + (it.z + d / 2) * CELL]; };
  const furnCenter = it => { const [w, d] = Rules.ffp(it.k, it.r); return [-IHALF + (it.x + w / 2) * ICELL, -IHALF + (it.z + d / 2) * ICELL]; };
  // Клетка под точкой участка: верхний левый угол постройки w×d, если точка — её середина
  const cellAt = (lx, lz, w = 1, d = 1) => [Math.round((lx + HALF) / CELL - w / 2), Math.round((lz + HALF) / CELL - d / 2)];
  const icellAt = (hx, hz, w = 1, d = 1) => [Math.round((hx + IHALF) / ICELL - w / 2), Math.round((hz + IHALF) / ICELL - d / 2)];
  const Geo = { CELL, LOT, HALF, ICELL, IHALF, LOTS, LANE, ZONE, zone, inDistrict, streetOf, lotOf, lotToWorld, worldToLot, rotXZ, itemCenter, furnCenter, cellAt, icellAt };

  const WHY = {
    auth: 'Войди, чтобы строить на своём участке', none: 'Сначала займи участок', kind: 'Это здесь не построить', th: 'Нужна ратуша выше уровнем',
    max: 'Больше нельзя — улучши ратушу', place: 'Сюда не встанет: место занято или край', bricks: 'Не хватает кирпичей 🧱', builder: 'Все строители заняты 👷',
    busy: 'Уже строится', maxlv: 'Это самый высокий уровень', lvcap: 'Сначала улучши ратушу', id: 'Постройка не найдена', fixed: 'Это нельзя убрать — только переместить',
    coins: 'Не хватает монет 🪙', access: 'Хозяин закрыл дом', too_fast: 'Не так быстро 🙂', done: 'Сегодня уже забрал — приходи завтра', self: 'Это твой участок 🙂',
    plot: 'Такого участка нет', has: 'У тебя уже есть участок', taken: 'Этот участок уже заняли', house: 'Дом полон — улучши его, чтобы поставить больше',
    empty: 'Пока нечего собирать', full: 'Склад полон — построй или улучши склад 📦', idle: 'Сейчас здесь ничего не строится', args: 'Не получилось',
    net: 'Нет связи с сервером — попробуй ещё раз', layout: 'Не получилось перенести участок', local: 'За монеты — после входа на сайт', max_likes: 'На сегодня хватит лайков 🙂',
  };
  const fmtT = sec => {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return sec + ' с';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + ' мин' + (m < 10 && sec % 60 ? ' ' + (sec % 60) + ' с' : '');
    const h = Math.floor(m / 60), mm = m % 60;
    return h + ' ч' + (mm ? ' ' + mm + ' мин' : '');
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('ru');

  // ═══ Статичная часть района: улица, земля участков, фонари, арка, щиты (в buildWorld — до склейки мира) ═══
  function build(ctx){
    const { R, ph, X, S, P, M } = ctx, T = R.T;
    const dyn = [];
    // дорожка от площади, улица района, бордюры
    ctx.path(-11.5, -13.5, -12.5, -38, 3);
    P(null, { s: 'box', x: (LANE.x0 + LANE.x1) / 2, y: .02, z: LANE.z, w: LANE.x1 - LANE.x0, h: .02, d: LANE.w, m: M.walk });
    for (const s of [-1, 1]) P(null, { s: 'box', x: (LANE.x0 + LANE.x1) / 2, y: .05, z: LANE.z + s * (LANE.w / 2 + .1), w: LANE.x1 - LANE.x0, h: .1, d: .2, c: '#b9b2a4' });
    // участки: земля чуть светлее травы, низкий бордюр с проходом спереди
    for (const lot of LOTS) {
      const g = R.group(null, lot.x, 0, lot.z, lot.yaw);
      R.part(g, { s: 'box', y: .03, w: LOT, h: .04, d: LOT, c: '#93cf7c' });
      const curb = (x, z, w, d) => R.part(g, { s: 'box', x, y: .09, z, w, h: .14, d, c: '#d6cfc0' });
      curb(0, -HALF - .1, LOT + .4, .2); curb(-HALF - .1, 0, .2, LOT); curb(HALF + .1, 0, .2, LOT);
      curb(-HALF / 2 - 1.1, HALF + .1, HALF - 2.2 + .2, .2); curb(HALF / 2 + 1.1, HALF + .1, HALF - 2.2 + .2, .2);
    }
    // фонари и скамейки вдоль улицы
    for (let x = -17.5; x > LANE.x0 + 1; x -= 11) { R.prefab('lamp', { x, z: LANE.z + 2.75 }, ph); R.prefab('lamp', { x: x - 5.5, z: LANE.z - 2.75 }, ph); }
    for (const x of [-35.7, -57.9]) for (const [z, yaw] of [[LANE.z + 2.2, PI], [LANE.z - 2.2, 0]]) {
      R.prefab('bench', { x, z, yaw, m: M.planks }, ph);
      for (const sd of [-1, 1]) ctx.seatSpot({ id: `bd${Math.round(x * 10)}_${Math.round(z * 10)}_${sd}`, x: x + Math.cos(yaw) * .55 * sd, z: z - Math.sin(yaw) * .55 * sd, y: .62, yaw, bench: 'Скамейка' });
    }
    // арка над дорожкой у площади
    const ax = -11.65, az = -17.2;
    for (const s of [-1, 1]) ctx.box(ax + s * 2.1, 0, az, .5, 3.6, .5, '#7c2d12', { solid: true });
    ctx.box(ax, 3.6, az, 4.9, .45, .6, '#9a3412');
    ctx.plaque(ax, 3.82, az + .31, 4.4, .55, ctx.label('🏘️ Район участков', '#15803d', '#fff', 640, 80), 0);
    ctx.plaque(ax, 3.82, az - .31, 4.4, .55, ctx.label('🏘️ Район участков', '#15803d', '#fff', 640, 80), PI);
    // щит улицы (номер улицы — канвасом, меняется) и подсказка «как получить участок»
    const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4; return { c, t, mat: new T.MeshBasicMaterial({ map: t, toneMapped: false }) }; };
    const bx = -13, bz = -46.6;
    for (const s of [-1, 1]) ctx.box(bx + s * 1.5, 0, bz, .2, 2.6, .2, '#6b4426', { solid: true });
    ctx.box(bx, 1.35, bz - .07, 3.4, 1.5, .1, '#3b2a1c');
    const board = mkCanvas(512, 224);
    const bm = ctx.plaque(bx, 2.1, bz, 3.2, 1.4, board.mat, 0); bm.userData.dyn = true;
    dyn.push(board);
    X.add({ x: bx, y: 1.4, z: bz + .6, r: 1.3, prompt: () => S.base ? S.base.boardPrompt() : 'Район участков', act: () => S.base?.streetPanel() });
    // таблички участков (номер, хозяин) — канвасом
    const signs = LOTS.map((lot, j) => {
      const [sx, sz] = lotToWorld(lot, -HALF + .9, HALF + .45), yaw = lot.yaw;
      const g = R.group(null, sx, 0, sz, yaw);
      R.part(g, { s: 'box', y: .9, w: .14, h: 1.8, d: .14, c: '#6b4426' });
      R.part(g, { s: 'box', y: 1.75, w: 1.95, h: .9, d: .08, c: '#3b2a1c' });
      const cv = mkCanvas(512, 224);
      const pl = new T.Mesh(R.K.geo('mbsign', () => new T.PlaneGeometry(1.85, .8)), cv.mat);
      pl.position.set(0, 1.75, .05); pl.userData.dyn = true;   // меняется — не склеивать
      g.add(pl);
      ph.addBox({ x: sx, z: sz, y: .9, hx: .1, hy: .9, hz: .1, tag: 'sign' });
      dyn.push(cv);
      X.add({ x: sx + Math.sin(yaw) * .5, y: 1.4, z: sz + Math.cos(yaw) * .5, r: .9, prompt: () => S.base ? S.base.signPrompt(j) : `Участок`, act: () => S.base?.signAct(j) });
      return { cv, x: sx, z: sz };
    });
    // указатель на площади (лицом к фонтану)
    R.prefab('sign', { x: -14.8, z: -12.6, yaw: Math.atan2(14.8, 12.6), text: 'Район участков', c: '#15803d' }, ph);
    return { board, signs, dyn, seatSpot: ctx.seatSpot };
  }
  function drawBoard(cv, street, streets, free){
    const g = cv.c.getContext('2d'), w = cv.c.width, h = cv.c.height;
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#166534'); gr.addColorStop(1, '#14532d');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 46px Montserrat, Arial, sans-serif'; g.fillText('🏘️ Район участков', w / 2, 62);
    g.fillStyle = '#fde68a'; g.font = '800 38px Montserrat, Arial, sans-serif'; g.fillText(`Улица ${street + 1}${streets > 1 ? ' из ' + streets : ''}`, w / 2, 122);
    g.fillStyle = '#bbf7d0'; g.font = '700 28px Montserrat, Arial, sans-serif'; g.fillText(free > 0 ? `Свободных участков: ${free}` : 'Все участки заняты — есть другие улицы', w / 2, 178);
    cv.t.needsUpdate = true;
  }
  function drawSign(cv, plot, info){
    const g = cv.c.getContext('2d'), w = cv.c.width, h = cv.c.height;
    g.fillStyle = !info ? '#15803d' : info.mine ? '#a16207' : '#5b21b6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 54px Montserrat, Arial, sans-serif'; g.fillText('Участок № ' + plot, w / 2, 60);
    let sub = !info ? 'Свободен — займи!' : info.mine ? (info.local ? 'Пробный участок' : 'Мой участок') : info.nick || 'Игрок', fs = 44;
    g.font = `800 ${fs}px Montserrat, Arial, sans-serif`;
    while (g.measureText(sub).width > w * .88 && fs > 18) { fs -= 3; g.font = `800 ${fs}px Montserrat, Arial, sans-serif`; }
    g.fillStyle = !info ? '#bbf7d0' : '#fde68a'; g.fillText(sub, w / 2, 126);
    if (info) { g.fillStyle = '#e9d5ff'; g.font = '700 30px Montserrat, Arial, sans-serif'; g.fillText(`🏛️ ${info.th} ур.   👍 ${info.likes || 0}`, w / 2, 182); }
    cv.t.needsUpdate = true;
  }

  // ═══ Постройки: рисуются деталями движка (R.part) в системе постройки (центр, перед — +z), тела — списком ═══
  const WOOD = '#a0673a', WOOD_D = '#6b4426', STONE = '#d6cfc0', STONE_D = '#9ca3af', DARK = '#1f2937', GOLD = '#facc15', BRICK = '#c2553d';
  const PAL = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316'];
  const TOWER_H = [3.6, 4.8, 6];
  // строительные леса вокруг (стройка и улучшение)
  function scaffold(P, g, w, h, full){
    const hw = w / 2 - .1;
    for (const [x, z] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) P(g, { s: 'box', x, y: h / 2, z, w: .1, h, d: .1, c: '#d4a373' });
    for (const y of [h * .5, h - .05]) for (const [x, z, ww, dd] of [[0, -hw, w - .2, .08], [0, hw, w - .2, .08], [-hw, 0, .08, w - .2], [hw, 0, .08, w - .2]]) P(g, { s: 'box', x, y, z, w: ww, h: .08, d: dd, c: '#c08552' });
    if (full) {
      P(g, { s: 'box', y: .05, w: w - .3, h: .1, d: w - .3, c: '#8d6e4c' });
      P(g, { s: 'box', y: h * .3, w: w * .55, h: h * .55, d: w * .55, c: '#e7d3b0' });
      P(g, { s: 'box', y: h * .62, w: w * .58, h: .08, d: w * .58, c: '#f59e0b' });
    }
  }
  const DRAW = {
    th(P, g, it, bd){
      const L = Math.max(1, it.l), H = 2.6 + .35 * L, FZ = 1.6;   // FZ — передняя стена
      const wall = ['#f3e2c0', '#e5e7eb', '#fde2d2', '#dbeafe', '#fef3c7'][L - 1], roof = ['#b45309', '#64748b', '#b91c1c', '#1d4ed8', '#ca8a04'][L - 1];
      const top = .35 + H, apex = top + .14 + 2.1;
      P(g, { s: 'box', y: .175, w: 4.7, h: .35, d: 4.7, c: STONE });
      P(g, { s: 'box', y: .35 + H / 2, z: -.1, w: 4.1, h: H, d: 3.4, c: wall });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * 2.05, y: .35 + H / 2, z: FZ - .02, w: .3, h: H + .05, d: .3, c: STONE_D });   // углы
      P(g, { s: 'box', y: top + .07, z: -.1, w: 4.45, h: .14, d: 3.75, c: WOOD_D });
      P(g, { s: 'cone', y: top + .14 + 1.05, z: -.1, r: 3.15, h: 2.1, seg: 4, yaw: PI / 4, c: roof, flat: true });
      P(g, { s: 'box', y: .35 + .85, z: FZ + .01, w: 1.1, h: 1.7, d: .08, c: WOOD_D });
      P(g, { s: 'box', y: .35 + 1.78, z: FZ + .02, w: 1.45, h: .16, d: .1, c: STONE_D });
      for (const sx of [-1, 1]) { P(g, { s: 'box', x: sx * 1.3, y: .35 + H * .58, z: FZ + .01, w: .6, h: .7, d: .06, c: '#ffe9a8', m: 'glow' }); P(g, { s: 'box', x: sx * 2.06, y: .35 + H * .58, z: -.3, w: .06, h: .7, d: .8, c: '#ffe9a8', m: 'glow' }); }
      P(g, { s: 'box', y: .1, z: 2.12, w: 1.7, h: .2, d: .5, c: STONE });
      // флаг: на ратуше всегда, со 2 уровня — выше и с башенкой
      const fh = L >= 2 ? 1.5 : 1;
      if (L >= 2) P(g, { s: 'box', y: apex - .25, w: .5, h: .5, d: .5, c: wall });
      P(g, { s: 'cyl', y: apex + fh / 2, r: .05, h: fh, c: '#374151' }); P(g, { s: 'box', x: .34, y: apex + fh - .25, w: .66, h: .4, d: .04, c: '#ef4444' });
      if (L >= 3) {
        for (const sx of [-1, 1]) { P(g, { s: 'cyl', x: sx * 1.25, y: .35 + H / 2, z: 2.05, r: .14, h: H, c: '#f8fafc' }); bd.push({ t: 'cyl', x: sx * 1.25, z: 2.05, y0: .35, r: .17, h: H }); }
        P(g, { s: 'box', y: top - .09, z: 1.9, w: 3.2, h: .18, d: .7, c: wall });
      }
      if (L >= 4) { P(g, { s: 'cyl', y: .35 + H * .88, z: FZ + .02, r: .34, h: .05, rx: PI / 2, c: '#fff7ed' }); P(g, { s: 'box', y: .35 + H * .88, z: FZ + .06, w: .04, h: .26, d: .02, c: DARK }); }
      if (L >= 5) P(g, { s: 'ball', y: apex + fh + .15, r: .24, c: GOLD, m: 'glow' });
      bd.push({ t: 'box', y0: 0, h: .35, w: 4.7, d: 4.7, floor: 'stone' }, { t: 'box', z: -.1, y0: .35, h: H, w: 4.1, d: 3.4, cam: true });
      return apex + fh;
    },
    house(P, g, it, bd, x){
      const L = Math.max(1, it.l), S = 5 * CELL - .2, hw = S / 2, H = 3, t = .3, DG = 1.8, DH = 2.5;
      const wallC = ['#ffe8a8', '#bde0fe', '#ffc8dd', '#caffbf', '#e0c3fc'][L - 1], roofC = ['#b91c1c', '#1d4ed8', '#be185d', '#15803d', '#7e22ce'][L - 1], trim = L >= 5 ? GOLD : '#7c2d12';
      P(g, { s: 'box', y: .06, w: S, h: .12, d: S, c: '#d6a77a' });
      bd.push({ t: 'box', y0: 0, h: .12, w: S, d: S, floor: 'wood' });
      const wall = (bx, bz, w, d, y0 = 0, h = H) => { P(g, { s: 'box', x: bx, y: y0 + h / 2, z: bz, w, h, d, c: wallC }); bd.push({ t: 'box', x: bx, z: bz, y0, w, h, d, cam: true }); };
      wall(0, -hw + t / 2, S, t);
      wall(-hw + t / 2, 0, t, S - 2 * t); wall(hw - t / 2, 0, t, S - 2 * t);
      const sw = (S - DG) / 2;
      wall(-(DG / 2 + sw / 2), hw - t / 2, sw, t); wall(DG / 2 + sw / 2, hw - t / 2, sw, t);
      wall(0, hw - t / 2, DG, t, DH, H - DH);
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * (DG / 2 + .06), y: DH / 2, z: hw - t / 2, w: .12, h: DH, d: t + .1, c: trim });
      P(g, { s: 'box', y: DH + .06, z: hw - t / 2, w: DG + .24, h: .12, d: t + .1, c: trim });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P(g, { s: 'box', x: sx * (hw - .15), y: H / 2 + .02, z: sz * (hw - .15), w: .42, h: H + .04, d: .42, c: trim });
      // окна (снаружи и изнутри): по бокам и сзади
      const win = (wx, wz, side) => { for (const k of [1, -1]) { const o = (t / 2 + .02) * k; P(g, side ? { s: 'box', x: wx + o, y: 1.6, z: wz, w: .03, h: 1, d: 1.3, c: '#9bd2f2' } : { s: 'box', x: wx, y: 1.6, z: wz + o, w: 1.3, h: 1, d: .03, c: '#9bd2f2' }); } };
      win(-hw + t / 2, 0, true); win(hw - t / 2, 0, true); win(0, -hw + t / 2, false);
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * (hw + .06), y: 1.08, z: 0, w: .14, h: .08, d: 1.5, c: trim });
      // крыльцо и фонарь у двери
      P(g, { s: 'box', y: .05, z: hw + .45, w: DG + .8, h: .1, d: .8, c: STONE });
      if (L >= 3) P(g, { s: 'ball', x: DG / 2 + .35, y: 2.2, z: hw + .12, r: .12, c: '#fff3b0', m: 'glow' });
      if (L >= 4) for (const sx of [-1, 1]) { P(g, { s: 'box', x: sx * (hw + .2), y: .95, z: 0, w: .3, h: .2, d: 1.3, c: WOOD }); for (let i = 0; i < 4; i++) P(g, { s: 'ball', x: sx * (hw + .2), y: 1.12, z: -.45 + i * .3, r: .09, c: PAL[(i + L) % PAL.length], seg: 6 }); }
      // крыша — отдельно (прячется, когда ты внутри)
      const roof = new x.T.Group(); roof.userData.dyn = true; g.add(roof);
      const base = S + .8, len = S + .7, r = base / 1.732, rise = 1.7, sz = rise / (1.5 * r);
      const m = P(roof, { s: 'cyl', r, h: len, seg: 3, rx: -PI / 2, c: roofC, flat: true });
      m.scale.set(1, 1, sz); m.position.y = H + .5 * r * sz;
      P(roof, { s: 'box', y: H + .06, w: S + .3, h: .12, d: S + .3, c: trim });
      if (L >= 2) P(roof, { s: 'box', x: 1.5, y: H + 1.4, z: -1.2, w: .5, h: 1.5, d: .5, c: BRICK });
      x.roof = roof;
      x.room = { hw: hw - t, h: H };
      x.door = { x: 0, z: hw - t / 2, w: DG, h: DH, d: t + .2 };
      return H + rise + .5;
    },
    mine(P, g, it, bd){
      const L = Math.max(1, it.l);
      P(g, { s: 'ico', x: -.2, y: .35, z: -.3, r: 1.25, sy: .72, c: '#8b8f99', det: 1 });
      P(g, { s: 'ico', x: .75, y: .3, z: -.75, r: .62, sy: .8, c: '#7c818b', det: 0 });
      P(g, { s: 'box', y: .55, z: .55, w: .9, h: 1.1, d: .5, c: DARK });
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .52, y: .65, z: .82, w: .14, h: 1.3, d: .14, c: WOOD });
      P(g, { s: 'box', y: 1.33, z: .82, w: 1.25, h: .16, d: .18, c: WOOD });
      P(g, { s: 'box', x: .85, y: .4, z: 1.05, w: .62, h: .3, d: .45, c: '#6b7280' });
      for (const [wx, wz] of [[.62, .87], [1.08, .87], [.62, 1.23], [1.08, 1.23]]) P(g, { s: 'cyl', x: wx, y: .12, z: wz, r: .1, h: .06, rz: PI / 2, c: DARK });
      for (let i = 0; i < 3; i++) P(g, { s: 'box', x: .72 + i * .13, y: .6, z: 1.05, w: .12, h: .08, d: .22, c: BRICK });
      if (L >= 2) for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .22, y: .03, z: 1.15, w: .06, h: .06, d: .9, c: '#57534e' });
      if (L >= 3) P(g, { s: 'ball', x: -.62, y: 1.2, z: .9, r: .1, c: '#fff3b0', m: 'glow' });
      if (L >= 4) P(g, { s: 'box', x: -1.05, y: .6, z: .9, w: .5, h: 1.2, d: .5, c: WOOD_D });
      if (L >= 5) for (let i = 0; i < 3; i++) P(g, { s: 'ico', x: -.6 + i * .45, y: .95 - i * .1, z: -.1 - i * .2, r: .13, c: GOLD, m: 'glow', det: 0 });
      bd.push({ t: 'cyl', x: -.2, z: -.3, y0: 0, r: 1.1, h: 1.1 }, { t: 'box', x: .85, z: 1.05, y0: 0, w: .66, h: .55, d: .5 });
      return 2;
    },
    store(P, g, it, bd){
      const L = Math.max(1, it.l), wc = [WOOD, '#94a3b8', '#b45309', '#2563eb', '#ca8a04'][L - 1];
      P(g, { s: 'box', y: .85, z: -.25, w: 2.6, h: 1.7, d: 2.1, c: wc });
      P(g, { s: 'box', y: 1.8, z: -.25, w: 2.9, h: .16, d: 2.5, rx: .1, c: '#7c2d12' });
      P(g, { s: 'box', y: .65, z: .82, w: 1.3, h: 1.3, d: .06, c: '#4b2e1a' });
      P(g, { s: 'box', y: .65, z: .86, w: .06, h: 1.3, d: .04, c: '#c8956a' });
      P(g, { s: 'box', x: 1.1, y: .25, z: 1.05, w: .5, h: .5, d: .5, c: '#c8956a' }); P(g, { s: 'box', x: 1.1, y: .7, z: 1.05, w: .4, h: .4, d: .4, c: '#b07d4f' });
      for (let i = 0; i < Math.min(5, L + 1); i++) P(g, { s: 'box', x: -1.05, y: .1 + i * .17, z: 1.05, w: .45, h: .15, d: .45, c: i % 2 ? BRICK : '#a3412c' });
      bd.push({ t: 'box', y0: 0, z: -.25, w: 2.6, h: 1.7, d: 2.1 }, { t: 'box', x: 1.1, z: 1.05, y0: 0, w: .5, h: .9, d: .5 });
      return 2.6;
    },
    shop(P, g, it, bd){
      P(g, { s: 'box', y: .8, z: -.5, w: 2.3, h: 1.6, d: 1.8, c: '#e7c9a0' });
      P(g, { s: 'box', y: 1.75, z: -.45, w: 2.6, h: .16, d: 2.2, rx: -.15, c: '#9a3412' });
      P(g, { s: 'box', x: .9, y: 1.95, z: -1, w: .35, h: .9, d: .35, c: BRICK });
      P(g, { s: 'box', y: .6, z: .42, w: .8, h: 1.2, d: .05, c: WOOD_D });
      P(g, { s: 'box', x: .7, y: .25, z: .95, w: .35, h: .5, d: .3, c: '#44403c' }); P(g, { s: 'box', x: .7, y: .55, z: .95, w: .7, h: .14, d: .26, c: '#57534e' });
      P(g, { s: 'cyl', x: -.85, y: .35, z: .95, r: .28, h: .7, c: WOOD });
      P(g, { s: 'box', x: -.2, y: 1.45, z: .44, w: .7, h: .1, d: .06, c: '#d6d3d1' }); P(g, { s: 'box', x: -.2, y: 1.2, z: .44, w: .1, h: .5, d: .06, c: WOOD_D });
      bd.push({ t: 'box', y0: 0, z: -.5, w: 2.3, h: 1.6, d: 1.8 }, { t: 'cyl', x: -.85, z: .95, y0: 0, r: .3, h: .7 });
      return 2.6;
    },
    tower(P, g, it, bd, x){
      const L = Math.max(1, it.l), Ht = TOWER_H[L - 1], top = Ht + 1.9, pc = ['#8b5a2b', '#78716c', '#1e3a8a'][L - 1];
      for (const [px, pz] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) { P(g, { s: 'cyl', x: px, y: top / 2, z: pz, r: .12, h: top, c: pc }); bd.push({ t: 'cyl', x: px, z: pz, y0: 0, r: .15, h: top }); }
      P(g, { s: 'box', y: Ht, w: 3, h: .2, d: 3, c: WOOD_D });
      bd.push({ t: 'box', y0: Ht - .1, h: .2, w: 3, d: 3, floor: 'wood' });
      for (const [rx, rz, w, d] of [[0, -1.42, 2.9, .08], [-1.42, 0, .08, 2.9], [1.42, 0, .08, 2.9], [-.95, 1.42, 1, .08], [.95, 1.42, 1, .08]]) { P(g, { s: 'box', x: rx, y: Ht + .55, z: rz, w, h: .08, d, c: WOOD }); bd.push({ t: 'box', x: rx, z: rz, y0: Ht + .1, w: Math.max(w, .12), h: .8, d: Math.max(d, .12) }); }
      P(g, { s: 'cone', y: top + .55, r: 2.25, h: 1.1, seg: 4, yaw: PI / 4, c: ['#b91c1c', '#7c3aed', '#ca8a04'][L - 1], flat: true });
      P(g, { s: 'cyl', y: top + 1.5, r: .04, h: .9, c: '#374151' }); P(g, { s: 'box', x: .26, y: top + 1.75, w: .5, h: .3, d: .04, c: PAL[it.i % PAL.length] });
      // лестница спереди
      for (const sx of [-1, 1]) P(g, { s: 'box', x: sx * .36, y: Ht / 2, z: 1.45, w: .07, h: Ht, d: .07, c: WOOD });
      for (let y = .3; y < Ht; y += .38) P(g, { s: 'box', y, z: 1.45, w: .72, h: .05, d: .06, c: WOOD });
      x.ladder = { x: 0, z: 1.45, top: Ht + .1, ex: 0, ez: .75 };
      return top + 2;
    },
    tree(P, g, it, bd, x){ x.R.prefab('tree', { parent: g, x: 0, z: 0, k: .75, v: it.i % 4, yaw: it.i }); bd.push({ t: 'cyl', y0: 0, r: .28, h: 2 }); return 3; },
    pine(P, g, it, bd, x){ x.R.prefab('pine', { parent: g, x: 0, z: 0, k: .7 }); bd.push({ t: 'cyl', y0: 0, r: .25, h: 2 }); return 3; },
    bush(P, g, it, bd, x){ x.R.prefab('bush', { parent: g, x: 0, z: 0, k: .9, c: ['#3f9a4c', '#4ea544', '#2f7d4a'][it.i % 3] }); return 1.2; },
    flowers(P, g, it, bd, x){ P(g, { s: 'box', y: .06, w: 1.3, h: .12, d: 1.3, c: '#7a5a3c' }); x.R.prefab('flowers', { parent: g, x: 0, z: 0, n: 9, seed: it.i, c: PAL[it.i % PAL.length] }); return 1; },
    rock(P, g, it, bd, x){ x.R.prefab('rock', { parent: g, x: 0, z: 0, k: .75, yaw: it.i }); bd.push({ t: 'cyl', y0: 0, r: .5, h: .55 }); return 1.2; },
    lamp(P, g, it, bd, x){ x.R.prefab('lamp', { parent: g, x: 0, z: 0 }); bd.push({ t: 'cyl', y0: 0, r: .16, h: 3 }); return 3.6; },
    flag(P, g, it, bd){
      P(g, { s: 'cyl', y: .1, r: .3, h: .2, c: STONE_D }); P(g, { s: 'cyl', y: 1.7, r: .05, h: 3.2, c: '#e5e7eb' });
      P(g, { s: 'box', x: .45, y: 2.9, w: .9, h: .56, d: .05, c: PAL[it.i % PAL.length] }); P(g, { s: 'ball', y: 3.35, r: .09, c: GOLD });
      bd.push({ t: 'cyl', y0: 0, r: .12, h: 3.2 });
      return 3.8;
    },
    bench(P, g, it, bd, x){ x.R.prefab('bench', { parent: g, x: 0, z: 0, yaw: 0, c: WOOD }); bd.push({ t: 'box', y0: 0, w: 2.2, h: 1, d: .66 }); x.seats = [[-.55, 0, .62], [.55, 0, .62]]; return 1.6; },
    fountain(P, g, it, bd, x){
      P(g, { s: 'cyl', y: .25, r: 1.45, h: .5, seg: 24, c: STONE }); P(g, { s: 'cyl', y: .27, r: 1.25, h: .48, seg: 24, m: x.R.water('#5ec8f2') });
      P(g, { s: 'cyl', y: .85, r: .18, h: 1.1, c: '#cfc6b4' }); P(g, { s: 'cyl', y: 1.42, r: .55, h: .14, seg: 16, c: STONE });
      P(g, { s: 'ball', y: 1.72, r: .22, c: '#bdeeff', m: 'glow', seg: 10 });
      bd.push({ t: 'cyl', y0: 0, r: 1.45, h: .5 }, { t: 'cyl', y0: 0, r: .3, h: 1.5 });
      return 2.3;
    },
    statue(P, g, it, bd, x){
      const gold = x.R.mat(GOLD, { metal: .85, rough: .28 });
      P(g, { s: 'box', y: .35, w: 1.1, h: .7, d: 1.1, c: '#e5e7eb' });
      for (const sx of [-1, 1]) P(g, { s: 'cyl', x: sx * .13, y: 1.05, r: .08, h: .7, m: gold });
      P(g, { s: 'cyl', y: 1.62, r: .22, r2: .18, h: .6, m: gold }); P(g, { s: 'ball', y: 2.12, r: .2, m: gold });
      P(g, { s: 'box', x: -.3, y: 1.62, w: .12, h: .5, d: .12, rz: -.3, m: gold }); P(g, { s: 'box', x: .32, y: 2.05, w: .12, h: .55, d: .12, rz: .5, m: gold });
      P(g, { s: 'cone', y: 2.43, r: .2, h: .3, seg: 8, c: '#ef4444' });
      bd.push({ t: 'box', y0: 0, w: 1.1, h: 2.3, d: 1.1 });
      return 2.9;
    },
  };
  // Забор: столбик в клетке + перемычки к соседям (справа и спереди — каждая один раз)
  const WALL_ST = [
    { post: [.22, 1.05, '#8b5a2b'], rail: '#c9965f', rails: [.35, .78], th: .07 },
    { post: [.52, 1.15, '#a8a29e'], seg: [.38, .95, '#9ca3af'] },
    { post: [.52, 1.25, '#9a3412'], seg: [.4, 1.05, BRICK], cap: '#e5e7eb' },
    { post: [.3, 1.35, '#334155'], bars: '#475569' },
    { post: [.5, 1.45, '#ca8a04'], seg: [.36, 1.1, '#fde68a'], tip: GOLD },
  ];
  function drawWall(P, g, it, bd, nb){
    const st = WALL_ST[Math.max(1, it.l) - 1], [pw, ph, pc] = st.post;
    P(g, { s: 'box', y: ph / 2, w: pw, h: ph, d: pw, c: pc });
    if (st.cap) P(g, { s: 'box', y: ph + .05, w: pw + .1, h: .1, d: pw + .1, c: st.cap });
    if (st.tip) P(g, { s: 'ico', y: ph + .14, r: .14, c: st.tip, m: 'glow', det: 0 });
    bd.push({ t: 'box', y0: 0, w: Math.max(.5, pw), h: ph, d: Math.max(.5, pw) });
    for (const [dx, dz] of nb) {   // к соседу (в системе участка — без поворота)
      const mx = dx * CELL / 2, mz = dz * CELL / 2, along = dx ? 'x' : 'z';
      if (st.rails) for (const y of st.rails) P(g, { s: 'box', x: mx, y, z: mz, w: along === 'x' ? CELL : st.th, h: .08, d: along === 'z' ? CELL : st.th, c: st.rail });
      if (st.seg) P(g, { s: 'box', x: mx, y: st.seg[1] / 2, z: mz, w: along === 'x' ? CELL : st.seg[0], h: st.seg[1], d: along === 'z' ? CELL : st.seg[0], c: st.seg[2] });
      if (st.bars) for (let k = -2; k <= 2; k++) P(g, { s: 'box', x: mx + (along === 'x' ? k * .3 : 0), y: .65, z: mz + (along === 'z' ? k * .3 : 0), w: .06, h: 1.3, d: .06, c: st.bars });
      if (st.bars) P(g, { s: 'box', x: mx, y: 1.22, z: mz, w: along === 'x' ? CELL : .08, h: .08, d: along === 'z' ? CELL : .08, c: st.bars });
      bd.push({ t: 'box', x: mx, z: mz, y0: 0, w: along === 'x' ? CELL : .4, h: Math.max(.9, (st.seg?.[1]) || 1), d: along === 'z' ? CELL : .4 });
    }
    return ph + .4;
  }
  // Мебель (клетка 0,8): система предмета — центр, перед (куда садятся/смотрят) — +z
  const FDRAW = {
    bed(P, g, it, bd){ P(g, { s: 'box', y: .2, w: 1.5, h: .3, d: 2.3, c: WOOD_D }); P(g, { s: 'box', y: .42, w: 1.4, h: .16, d: 2.15, c: '#f8fafc' }); P(g, { s: 'box', y: .52, z: .35, w: 1.42, h: .1, d: 1.4, c: PAL[it.i % PAL.length] }); P(g, { s: 'box', y: .56, z: -.82, w: 1.1, h: .14, d: .38, c: '#fff' }); P(g, { s: 'box', y: .6, z: -1.12, w: 1.5, h: 1, d: .1, c: WOOD_D }); bd.push({ t: 'box', y0: 0, w: 1.5, h: .55, d: 2.3 }); },
    sofa(P, g, it, bd, x){ const c = PAL[(it.i + 1) % PAL.length]; P(g, { s: 'box', y: .25, z: .05, w: 2.3, h: .4, d: .7, c }); P(g, { s: 'box', y: .62, z: -.28, w: 2.3, h: .5, d: .16, c }); for (const s of [-1, 1]) P(g, { s: 'box', x: s * 1.08, y: .45, z: .02, w: .16, h: .4, d: .72, c }); bd.push({ t: 'box', y0: 0, w: 2.3, h: .45, d: .7 }); x.seats = [[-.5, .08, .5], [.5, .08, .5]]; },
    chair(P, g, it, bd, x){ P(g, { s: 'box', y: .45, w: .55, h: .08, d: .55, c: WOOD }); P(g, { s: 'box', y: .8, z: -.24, w: .55, h: .6, d: .07, c: WOOD }); for (const [lx, lz] of [[-.22, -.22], [.22, -.22], [-.22, .22], [.22, .22]]) P(g, { s: 'box', x: lx, y: .21, z: lz, w: .06, h: .42, d: .06, c: WOOD_D }); bd.push({ t: 'box', y0: 0, w: .5, h: .9, d: .5 }); x.seats = [[0, 0, .5]]; },
    table(P, g, it, bd){ P(g, { s: 'box', y: .74, w: 1.4, h: .07, d: 1.4, c: WOOD }); for (const [lx, lz] of [[-.6, -.6], [.6, -.6], [-.6, .6], [.6, .6]]) P(g, { s: 'box', x: lx, y: .36, z: lz, w: .08, h: .72, d: .08, c: WOOD_D }); P(g, { s: 'cyl', y: .82, r: .14, h: .1, c: '#fde68a' }); bd.push({ t: 'box', y0: 0, w: 1.4, h: .78, d: 1.4 }); },
    rug(P, g, it){ P(g, { s: 'box', y: .01, w: 2.3, h: .02, d: 2.3, c: PAL[(it.i + 3) % PAL.length] }); P(g, { s: 'box', y: .015, w: 1.7, h: .02, d: 1.7, c: '#fef3c7' }); P(g, { s: 'box', y: .02, w: 1.2, h: .02, d: 1.2, c: PAL[(it.i + 5) % PAL.length] }); },
    lamp(P, g, it, bd){ P(g, { s: 'cyl', y: .04, r: .18, h: .08, c: DARK }); P(g, { s: 'cyl', y: .8, r: .03, h: 1.5, c: DARK }); P(g, { s: 'cone', y: 1.62, r: .26, h: .32, seg: 12, c: '#fde68a' }); P(g, { s: 'ball', y: 1.5, r: .1, c: '#fff6c8', m: 'glow', seg: 8 }); bd.push({ t: 'cyl', y0: 0, r: .14, h: 1.6 }); },
    plant(P, g, it, bd){ P(g, { s: 'cyl', y: .22, r: .2, r2: .26, h: .44, c: '#b45309' }); P(g, { s: 'ico', y: .72, r: .34, c: '#3f9a4c', det: 1 }); bd.push({ t: 'cyl', y0: 0, r: .25, h: .9 }); },
    shelf(P, g, it, bd){ P(g, { s: 'box', y: .9, z: -.08, w: 1.5, h: 1.8, d: .4, c: WOOD_D }); for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) P(g, { s: 'box', x: -.6 + i * .24, y: .35 + row * .55, z: .02, w: .16, h: .38 - (i % 3) * .05, d: .26, c: PAL[(i + row * 2 + it.i) % PAL.length] }); bd.push({ t: 'box', y0: 0, z: -.08, w: 1.5, h: 1.8, d: .4 }); },
    wardrobe(P, g, it, bd){ P(g, { s: 'box', y: 1.05, z: -.05, w: 1.5, h: 2.1, d: .55, c: '#f5e6d3' }); P(g, { s: 'box', y: 1.1, z: .24, w: .62, h: 1.6, d: .02, c: '#dbeafe', m: 'glow' }); for (const s of [-1, 1]) P(g, { s: 'box', x: s * .5, y: 1.1, z: .24, w: .05, h: .25, d: .05, c: GOLD }); bd.push({ t: 'box', y0: 0, z: -.05, w: 1.5, h: 2.1, d: .55 }); },
    tv(P, g, it, bd, x){ P(g, { s: 'box', y: .3, z: -.05, w: 1.5, h: .6, d: .5, c: DARK }); P(g, { s: 'box', y: 1.15, z: -.15, w: 1.45, h: .85, d: .08, c: '#111827' }); const m = new x.T.Mesh(x.R.K.geo('mbtv', () => new x.T.PlaneGeometry(1.33, .75)), x.tvMat()); m.position.set(0, 1.15, -.1); m.userData.dyn = true; g.add(m); bd.push({ t: 'box', y0: 0, z: -.05, w: 1.5, h: 1.6, d: .5 }); },
    fire(P, g, it, bd){ P(g, { s: 'box', y: .6, z: -.1, w: 1.5, h: 1.2, d: .5, c: '#a8a29e' }); P(g, { s: 'box', y: 1.25, z: -.05, w: 1.7, h: .1, d: .62, c: WOOD_D }); P(g, { s: 'box', y: .42, z: .1, w: .8, h: .6, d: .2, c: '#1c1917' }); for (const [fx, fh] of [[-.15, .32], [.05, .42], [.2, .28]]) P(g, { s: 'cone', x: fx, y: .3 + fh / 2, z: .1, r: .1, h: fh, seg: 6, c: '#fb923c', m: 'glow' }); bd.push({ t: 'box', y0: 0, z: -.1, w: 1.5, h: 1.25, d: .5 }); },
    aqua(P, g, it, bd, x){ P(g, { s: 'box', y: .35, w: 1.5, h: .7, d: .6, c: WOOD_D }); P(g, { s: 'box', y: 1.05, w: 1.4, h: .7, d: .5, m: x.glass() }); for (let i = 0; i < 4; i++) P(g, { s: 'box', x: -.45 + i * .3, y: .9 + (i % 2) * .2, z: (i % 2) * .1 - .05, w: .14, h: .08, d: .04, c: ['#fb923c', '#facc15', '#f472b6', '#38bdf8'][i], m: 'glow' }); P(g, { s: 'box', y: .74, w: 1.38, h: .06, d: .48, c: '#fde68a' }); bd.push({ t: 'box', y0: 0, w: 1.5, h: 1.4, d: .6 }); },
    chess(P, g, it, bd, x){
      P(g, { s: 'cyl', y: .36, r: .07, h: .72, c: WOOD_D }); P(g, { s: 'box', y: .74, w: .9, h: .06, d: .9, c: WOOD_D });
      const top = new x.T.Mesh(x.R.K.geo('mbchess', () => new x.T.PlaneGeometry(.78, .78)), x.boardMat()); top.rotation.x = -PI / 2; top.position.y = .775; top.userData.dyn = true; g.add(top);
      for (const s of [-1, 1]) { const cz = s * .95, gg = x.R.group(g, 0, 0, cz, s > 0 ? PI : 0); FDRAW.chair(P, gg, it, [], {}); }
      bd.push({ t: 'cyl', y0: 0, r: .5, h: .8 }, { t: 'box', z: -.95, y0: 0, w: .5, h: .9, d: .5 }, { t: 'box', z: .95, y0: 0, w: .5, h: .9, d: .5 });
      x.seats = [[0, -.95, .5, 0], [0, .95, .5, PI]];
      x.table = 'chess';
    },
    arcade(P, g, it, bd, x){ P(g, { s: 'box', y: .9, z: -.05, w: .7, h: 1.8, d: .6, c: '#7c3aed' }); P(g, { s: 'box', y: 1.25, z: .26, w: .55, h: .45, d: .02, c: '#22d3ee', m: 'glow' }); P(g, { s: 'box', y: .85, z: .32, w: .6, h: .08, d: .3, c: DARK }); P(g, { s: 'cyl', x: -.12, y: .95, z: .35, r: .03, h: .14, c: '#ef4444' }); P(g, { s: 'ball', x: .14, y: .91, z: .36, r: .04, c: '#facc15' }); P(g, { s: 'box', y: 1.72, z: .2, w: .7, h: .16, d: .2, c: '#facc15', m: 'glow' }); bd.push({ t: 'box', y0: 0, z: -.05, w: .7, h: 1.8, d: .6 }); },
  };

  // ═══ Менеджер участков в мире (браузер) ═══
  function start(S, HK){
    const dist = S.world?.district, E = root.D37E, R = S.R;
    if (!dist || !R || !E) return null;
    const T = R.T, ph = S.ph, X = S.X, U = E.UNIT;
    const B = { street: 0, cam: null, me: null, data: new Map(), maxPlot: 0, views: [], sql: null, off: 0, bm: null, pend: 0, dirty: false, last: null, stopped: false };
    const authed = () => typeof currentUser !== 'undefined' && !!currentUser;
    const myUid = () => (authed() ? currentUser.id : null);
    const nowS = () => Math.floor(Date.now() / 1000 + B.off);
    const toast = (t, ok) => S.H?.toast(t, ok);
    const sfx = n => { try { S.AU?.play(n); } catch (e) {} };
    // ── Материалы склейки (цвет — в вершинах) ──
    const low = R.q === 'low';
    const stdMat = low ? new T.MeshLambertMaterial({ vertexColors: true }) : new T.MeshStandardMaterial({ vertexColors: true, roughness: .82, metalness: 0, envMapIntensity: .65 });
    const glowMat = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const ghostOk = new T.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: .45, depthWrite: false });
    const ghostBad = new T.MeshBasicMaterial({ color: '#f87171', transparent: true, opacity: .45, depthWrite: false });
    const selMat = new T.MeshBasicMaterial({ color: '#fde047', transparent: true, opacity: .35, depthWrite: false });
    let glassM = null, tvC = null, boardM = null;
    const extra = {
      T, R,
      glass: () => glassM || (glassM = new T.MeshStandardMaterial({ color: '#7dd3fc', transparent: true, opacity: .35, roughness: .1, depthWrite: false })),
      tvMat: () => { if (!tvC) { const c = document.createElement('canvas'); c.width = 256; c.height = 144; const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; tvC = { c, t, mat: new T.MeshBasicMaterial({ map: t, toneMapped: false }), live: null }; drawTv(); } return tvC.mat; },
      boardMat: () => boardM || (boardM = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) % 2 ? '#7c4a26' : '#f2dcb3'; g.fillRect(i * 16, j * 16, 16, 16); } const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return new T.MeshBasicMaterial({ map: t, toneMapped: false }); })()),
    };
    function drawTv(){
      if (!tvC) return;
      const live = !!S.live; if (tvC.live === live) return; tvC.live = live;
      const g = tvC.c.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 144);
      gr.addColorStop(0, live ? '#7f1d1d' : '#312e81'); gr.addColorStop(1, '#0f172a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 144);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.font = '900 30px Montserrat, Arial';
      g.fillText(live ? '🔴 В ЭФИРЕ' : 'DAN4IK37', 128, 58);
      g.fillStyle = '#fde68a'; g.font = '700 16px Montserrat, Arial'; g.fillText(live ? 'Денчик стримит — смотри!' : 'Ролики Денчика — нажми', 128, 104);
      tvC.t.needsUpdate = true;
    }

    // ── Склейка: все детали группы → по одной сетке на «цветной», «светящийся» и особые материалы ──
    const m4 = new T.Matrix4(), inv = new T.Matrix4();
    function merge(root, src){
      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      const buckets = new Map(), drop = [];
      src.traverse(o => {
        if (!o.isMesh || o.userData.dyn) return;
        for (let p = o.parent; p && p !== src; p = p.parent) if (p.userData.dyn) return;
        const mat = o.material;
        if (Array.isArray(mat)) return;
        const plain = !mat.map && !mat.transparent && !(mat.metalness > .01) && !(mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0);
        const key = plain ? (mat.isMeshBasicMaterial ? 'glow' : 'std') : mat;
        let b = buckets.get(key);
        if (!b) buckets.set(key, b = { key, mat, plain, list: [], n: 0 });
        m4.multiplyMatrices(inv, o.matrixWorld);
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(m4);
        if (mat.flatShading) g.computeVertexNormals();
        b.list.push({ g, c: mat.color }); b.n += g.attributes.position.count;
        drop.push(o);
      });
      const out = [];
      for (const b of buckets.values()) {
        const pos = new Float32Array(b.n * 3), nor = new Float32Array(b.n * 3), col = b.plain ? new Float32Array(b.n * 3) : null, uv = b.plain ? null : new Float32Array(b.n * 2);
        let k = 0;
        for (const { g, c } of b.list) {
          const gp = g.attributes.position, gn = g.attributes.normal, gu = g.attributes.uv;
          pos.set(gp.array, k * 3); if (gn) nor.set(gn.array, k * 3);
          for (let i = 0; i < gp.count; i++) {
            if (col) { const a = gn && Math.abs(gn.getY(i)) < .6 ? .62 + .38 * Math.min(1, Math.max(0, gp.getY(i) / 1.4)) : 1; col[(k + i) * 3] = c.r * a; col[(k + i) * 3 + 1] = c.g * a; col[(k + i) * 3 + 2] = c.b * a; }
            else if (gu) { uv[(k + i) * 2] = gu.getX(i); uv[(k + i) * 2 + 1] = gu.getY(i); }
          }
          k += gp.count; g.dispose();
        }
        const mg = new T.BufferGeometry();
        mg.setAttribute('position', new T.BufferAttribute(pos, 3)); mg.setAttribute('normal', new T.BufferAttribute(nor, 3));
        if (col) mg.setAttribute('color', new T.BufferAttribute(col, 3)); else mg.setAttribute('uv', new T.BufferAttribute(uv, 2));
        mg.computeBoundingSphere();
        const mesh = new T.Mesh(mg, b.plain ? (b.key === 'glow' ? glowMat : stdMat) : b.mat);
        mesh.userData.mbOwn = true;
        if (!low) { mesh.castShadow = b.key !== 'glow' && !b.mat?.userData?.noCast && !b.mat?.transparent; mesh.receiveShadow = b.key !== 'glow'; }
        root.add(mesh); out.push(mesh);
      }
      drop.forEach(o => o.parent?.remove(o));
      return out;
    }
    const disposeTree = g => { g.traverse(o => { if (o.isMesh && o.userData.mbOwn) o.geometry.dispose(); }); g.parent?.remove(g); };

    // ── Вид участка: постройки, тела, подсказки, места, крыша и комната дома ──
    const lotInfo = j => {
      const plot = B.street * PER + j + 1;
      if (B.me && B.me.plot === plot && !(B.me.local && B.data.has(plot))) return { mine: true, local: !!B.me.local, uid: myUid(), nick: 'Я', layout: B.me.layout, access: B.me.access, rev: B.me.rev || 0, likes: B.me.likes || 0, plot };
      const d = B.data.get(plot);
      return d ? { mine: d.uid === myUid(), uid: d.uid, nick: d.nick, layout: d.layout, access: d.access, rev: d.rev, likes: d.likes, plot } : null;
    };
    function clearView(v){
      if (!v) return;
      for (const b of v.bodies) ph.remove(b);
      for (const it of v.items) X.remove(it);
      for (const id of v.seats) { const sp = S.world.seats.get(id); if (sp?.item) X.remove(sp.item); S.world.seats.delete(id); if (S.mySeat?.id === id) S.P.standUp(); }
      clearRoom(v);
      if (v.root) disposeTree(v.root);
      v.bodies = []; v.items = []; v.seats = []; v.root = null; v.house = null;
    }
    function clearRoom(v){
      const r = v?.roomV; if (!r) return;
      for (const b of r.bodies) ph.remove(b);
      for (const it of r.items) X.remove(it);
      for (const id of r.seats) { const sp = S.world.seats.get(id); if (sp?.item) X.remove(sp.item); S.world.seats.delete(id); if (S.mySeat?.id === id) S.P.standUp(); }
      if (r.root) disposeTree(r.root);
      v.roomV = null;
    }
    // тело из описания постройки: b — в системе постройки (центр cx, cz, поворот r), всё → мир
    function addBody(v, lot, cx, cz, r, b, list){
      const [lx, lz] = rotXZ(r, b.x || 0, b.z || 0), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz);
      const data = { cam: !!b.cam, floor: b.floor };
      const c = b.t === 'cyl' ? ph.addCyl({ x: wx, z: wz, y: b.y0 + b.h / 2, r: b.r, hy: b.h / 2, tag: 'mb', data })
        : ph.addBox({ x: wx, z: wz, y: b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw: lot.yaw + r * PI / 2 + (b.yaw || 0), tag: 'mb', data });
      (list || v.bodies).push(c);
      return c;
    }
    const P = (g, o) => R.part(g, o);
    // подпись для «перестроить ли»: только то, что видно (не время шахт)
    const sigOf = i => !i ? 'free' : [i.plot, i.uid || '', i.access, ...i.layout.map(it => `${it.i}${it.k}${it.x},${it.z},${it.r},${it.l}${it.ul ? '^' + it.ul : ''}`)].join(';');
    function buildView(j){
      const old = B.views[j], info = lotInfo(j), sig = sigOf(info);
      drawSign(dist.signs[j].cv, B.street * PER + j + 1, info && { mine: info.mine, local: info.local, nick: info.nick, th: info.layout.find(it => it.k === 'th')?.l || 1, likes: info.likes });
      if (old && old.sig === sig) { old.info = info; return old; }
      clearView(old);
      const lot = LOTS[j];
      const same = !!(old && info && old.info?.uid === info.uid), sameAcc = same && old.info.access === info.access;
      const v = { j, lot, sig, info, bodies: [], items: [], seats: [], root: null, house: null, roomV: null, roomKey: '', hts: new Map(),
        roomCache: same ? old.roomCache : null, roomAt: sameAcc ? old.roomAt : 0, roomDenied: sameAcc && !!old.roomDenied };
      B.views[j] = v;
      if (!info) return v;
      const g = R.group(R.scene, lot.x, 0, lot.z, lot.yaw), src = new T.Group();
      g.add(src);
      v.root = g;
      const walls = new Set(info.layout.filter(it => it.k === 'wall').map(it => it.x + ',' + it.z));
      for (const it of info.layout) {
        const r = it.k === 'wall' ? 0 : it.r, [cx, cz] = itemCenter(it), bg = R.group(src, cx, 0, cz, r * PI / 2), bd = [];
        const x = { T, R, glass: extra.glass, tvMat: extra.tvMat, boardMat: extra.boardMat };
        const [fw, fd] = Rules.fp(it.k, 0);
        let h = 2;
        if (it.l === 0) { scaffold(P, bg, fw * CELL, 1.8, true); bd.push({ t: 'box', y0: 0, w: fw * CELL * .55, h: 1.2, d: fd * CELL * .55 }); }
        else if (it.k === 'wall') h = drawWall(P, bg, it, bd, [[1, 0], [0, 1]].filter(([dx, dz]) => walls.has((it.x + dx) + ',' + (it.z + dz))));
        else h = DRAW[it.k]?.(P, bg, it, bd, x) || 2;
        if (it.ul && it.l > 0) scaffold(P, bg, fw * CELL + .2, Math.min(h, 4), false);
        for (const b of bd) addBody(v, lot, cx, cz, r, b);
        v.hts.set(it.i, h);
        // дом: крыша прячется, когда ты внутри (зона «комната» — как у домиков мира), дверь — по доступу
        if (it.k === 'house' && it.l > 0 && x.roof) {
          v.house = { it, cx, cz, r, roof: x.roof, door: x.door, hw: x.room.hw };
          const [wx, wz] = lotToWorld(lot, cx, cz);
          v.bodies.push(ph.addBox({ x: wx, z: wz, y: 1.6, hx: x.room.hw - .1, hy: 1.9, hz: x.room.hw - .1, yaw: lot.yaw + r * PI / 2, trigger: true, tag: 'room', data: { room: 'mb' + info.plot, roof: x.roof } }));
        }
        if (x.ladder && it.l > 0) {
          const L = x.ladder, [lx, lz] = rotXZ(r, L.x, L.z), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), [ex, ez] = rotXZ(r, L.ex, L.ez), [wex, wez] = lotToWorld(lot, cx + ex, cz + ez);
          const ld = E.ladder?.(ph, { x: wx, z: wz, yaw: lot.yaw + r * PI / 2, top: L.top, w: .9, bottom: 0, exit: { x: wex, y: L.top, z: wez } });
          if (ld) v.bodies.push(ld.zone);
        }
        if (x.seats && it.l > 0) x.seats.forEach(([sx, sz, sy], n) => {
          const [lx, lz] = rotXZ(r, sx, sz), [wx, wz] = lotToWorld(lot, cx + lx, cz + lz), id = `mb${info.plot}_${it.i}_${n}`;
          dist.seatSpot({ id, x: wx, z: wz, y: sy, yaw: lot.yaw + r * PI / 2, bench: 'Скамейка' });
          v.seats.push(id);
        });
        addItemPrompts(v, it, lot, cx, cz);
      }
      merge(g, src);                                // всё, кроме крыши дома, — в 2–4 сетки
      if (v.house) {
        merge(v.house.roof, v.house.roof);          // крыша — своя сетка (прячется целиком)
        syncDoor(v);
        if (info.mine && B.me) buildRoom(v, B.me.room, B.me.rev || 0);
        else if (v.roomCache) buildRoom(v, v.roomCache.items, v.roomCache.rev);
      }
      g.updateMatrixWorld(true);
      return v;
    }
    // Дверь: закрыто для меня — невидимая преграда в проёме
    function canEnter(v){
      const i = v.info; if (!i) return false;
      if (i.mine) return true;
      if (v.roomDenied) return false;
      return i.access === 'all' || (i.access === 'friends' && !!i.uid && S.friends?.has(i.uid));
    }
    function syncDoor(v){
      const h = v.house; if (!h) return;
      const open = canEnter(v);
      if (open && h.block) { ph.remove(h.block); v.bodies.splice(v.bodies.indexOf(h.block), 1); h.block = null; }
      if (!open && !h.block) h.block = addBody(v, v.lot, h.cx, h.cz, h.r, { t: 'box', x: h.door.x, z: h.door.z, y0: 0, w: h.door.w, h: h.door.h, d: h.door.d });
      if (!h.doorItem) {
        const [lx, lz] = rotXZ(h.r, 0, h.door.z + .6), [wx, wz] = lotToWorld(v.lot, h.cx + lx, h.cz + lz);
        h.doorItem = X.add({ x: wx, y: 1.3, z: wz, r: .9, prompt: () => (canEnter(v) ? null : `🔒 Дом закрыт${v.info?.access === 'friends' ? ': только для друзей хозяина' : ''}`), act: () => toast(v.info?.access === 'friends' ? '🔒 Сюда пускают только друзей хозяина' : '🔒 Хозяин никого не пускает в дом', false) });
        v.items.push(h.doorItem);
      }
    }
    // Подсказки «[E]» у своих построек: собрать кирпичи, меню ратуши
    function addItemPrompts(v, it, lot, cx, cz){
      if (!v.info.mine || it.l === 0) return;
      const at = (bx, bz) => { const [lx, lz] = rotXZ(it.r, bx, bz); return lotToWorld(lot, cx + lx, cz + lz); };
      if (it.k === 'mine') {
        const [wx, wz] = at(0, 1.6);
        v.items.push(X.add({ x: wx, y: 1, z: wz, r: 1.2, prompt: () => { const m = B.me?.layout.find(e => e.i === it.i), n = m ? Rules.prod(m, nowS()) : 0; return n >= 1 ? `Собрать 🧱 ${n}` : null; }, act: () => doAct('collect', { id: it.i }) }));
      } else if (it.k === 'th') {
        const [wx, wz] = at(0, 2.5);
        v.items.push(X.add({ x: wx, y: 1, z: wz, r: 1.3, prompt: () => giftReady() ? `🎁 Подарок дня: +${giftSize()} 🧱` : '🏛️ Ратуша: меню участка', act: () => (giftReady() ? doAct('gift') : openMenu()) }));
      }
    }
    // ── Комната дома: мебель (склейка отдельно — меняется чаще участка) ──
    function buildRoom(v, items, rev){
      const h = v.house; if (!h) return;
      const key = JSON.stringify(items || []);
      if (v.roomV && v.roomKey === key) return;
      clearRoom(v);
      v.roomKey = key;
      const lot = v.lot, g = R.group(v.root, h.cx, .12, h.cz, h.r * PI / 2), src = new T.Group(); g.add(src);
      const rv = v.roomV = { root: g, bodies: [], items: [], seats: [] };
      for (const it of items || []) {
        const F = FURN[it.k]; if (!F) continue;
        const [fx, fz] = furnCenter(it), fg = R.group(src, fx, 0, fz, it.r * PI / 2), bd = [], x = { T, R, glass: extra.glass, tvMat: extra.tvMat, boardMat: extra.boardMat };
        FDRAW[it.k]?.(P, fg, it, bd, x);
        // предмет → дом → участок → мир
        const toLot = (bx, bz) => { const [ax, az] = rotXZ(it.r, bx, bz), [hx, hz] = rotXZ(h.r, fx + ax, fz + az); return [h.cx + hx, h.cz + hz]; };
        const yaw = lot.yaw + (h.r + it.r) * PI / 2;
        for (const b of bd) {
          const [lx, lz] = toLot(b.x || 0, b.z || 0), [wx, wz] = lotToWorld(lot, lx, lz);
          rv.bodies.push(b.t === 'cyl' ? ph.addCyl({ x: wx, z: wz, y: .12 + b.y0 + b.h / 2, r: b.r, hy: b.h / 2, tag: 'mb' }) : ph.addBox({ x: wx, z: wz, y: .12 + b.y0 + b.h / 2, hx: b.w / 2, hy: b.h / 2, hz: b.d / 2, yaw, tag: 'mb' }));
        }
        const pt = (bx, bz) => lotToWorld(lot, ...toLot(bx, bz));
        if (x.seats) x.seats.forEach(([sx, sz, sy, sa], n) => {
          const [wx, wz] = pt(sx, sz), id = `mbf${v.info.plot}_${it.i}_${n}`, sp = { id, x: wx, z: wz, y: .12 + sy, yaw: yaw + (sa || 0), bench: F.n };
          if (x.table) sp.tb = { id: `mbt${v.info.plot}_${it.i}`, game: x.table, n: 2, kind: x.table }, sp.s = n;
          dist.seatSpot(sp);
          rv.seats.push(id);
        });
        if (it.k === 'wardrobe') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .8, prompt: () => '🪞 Зеркало: сменить образ', act: () => S.openEditor?.() })); }
        if (it.k === 'tv') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .8, prompt: () => (S.live ? '📺 Денчик в эфире — смотреть' : '📺 Смотреть ролики Денчика'), act: () => S.openStage?.() })); }
        if (it.k === 'arcade') { const [wx, wz] = pt(0, .7); rv.items.push(X.add({ x: wx, y: 1.2, z: wz, r: .7, prompt: () => '🕹️ Игровой автомат: играть', act: () => arcadePanel() })); }
      }
      merge(g, src);
      g.updateMatrixWorld(true);
    }

    // ── Данные: улица, свой участок, комнаты ──
    async function rpc(name, args){
      if (typeof sbClient === 'undefined' || !sbClient) return { ok: false, reason: 'net' };
      try {
        const { data, error } = await sbClient.rpc(name, args || {});
        if (error) { if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '')) { B.sql = false; return { ok: false, reason: 'nosql' }; } return { ok: false, reason: 'net', error }; }
        if (data && typeof data.now === 'number') B.off = data.now - Date.now() / 1000;
        return data || { ok: false, reason: 'net' };
      } catch (e) { return { ok: false, reason: 'net' }; }
    }
    const LS = 'd37_base';
    function readLocal(){ try { const o = Rules.sanitize(JSON.parse(localStorage.getItem(LS) || 'null')); return o && o.plot >= 1 && o.plot <= PLOTS ? o : null; } catch (e) { return null; } }
    function saveLocal(){ if (!B.me?.local) return; try { localStorage.setItem(LS, JSON.stringify({ ...B.me, local: undefined })); } catch (e) {} }
    function fromServer(d){
      const s = Rules.sanitize(d); if (!s) return null;
      s.gift = d.gift ? '' : Rules.day(nowS());   // сервер говорит «можно ли» — храним как день последнего подарка
      s.coins = d.coins; s.rev = d.rev | 0;
      return s;
    }
    async function init(){
      const st = B;
      const loc = readLocal();
      B.trial = null;
      if (authed()) {
        const r = await rpc('base_state');
        if (st.stopped) return;
        if (r.reason === 'nosql') { B.sql = false; B.me = loc ? { ...loc, local: true } : null; }
        else if (r.ok) { B.sql = true; B.me = fromServer(r); }
        else if (r.reason === 'none') { B.sql = true; B.me = null; B.trial = loc; }
        else { B.me = loc ? { ...loc, local: true } : null; }   // нет связи — пробный
      } else {
        B.me = loc ? { ...loc, local: true } : null;
      }
      if (B.me) B.street = streetOf(B.me.plot);
      else if (B.trial) B.street = streetOf(B.trial.plot);
      await loadStreet(true);
      if (B.sql === false && authed()) note('📝 Участок пока хранится в этом браузере — сохранится в аккаунте, когда сайт обновится.');
      renderHud();
      HK.retrack?.();
    }
    async function loadStreet(first){
      const st = B, street = B.street;
      const r = await rpc('base_street', { p_street: street });
      if (st.stopped || street !== B.street) return;
      if (r.ok) {
        if (B.sql == null) B.sql = true;
        B.data.clear();
        for (const p of r.plots || []) { if (p && Number.isInteger(p.p)) { const s = Rules.sanitize({ layout: p.layout, room: [], plot: p.p }); B.data.set(p.p, { uid: p.uid, nick: p.nick, layout: s ? s.layout : [], access: p.access, rev: p.rev | 0, likes: p.likes | 0 }); } }
        B.maxPlot = r.max | 0;
        B.lastLoad = Date.now();
      } else if (r.reason === 'nosql') B.data.clear();
      rebuildAll();
    }
    function rebuildAll(){
      for (let j = 0; j < PER; j++) buildView(j);
      const free = LOTS.filter((_, j) => !lotInfo(j)).length;
      drawBoard(dist.board, B.street, Math.max(1, Math.ceil(B.maxPlot / PER), B.me ? streetOf(B.me.plot) + 1 : 1, B.street + 1), free);
    }
    async function loadRoom(v){
      const i = v.info; if (!i || i.mine || !i.uid || !v.house) return;
      v.roomAt = Date.now();
      const r = await rpc('base_room', { p_owner: i.uid });
      if (B.views[v.j] !== v || B.stopped) return;
      if (r.ok) { v.roomDenied = false; v.roomCache = { uid: i.uid, items: Rules.sanitizeRoom(r.items), rev: i.rev }; buildRoom(v, v.roomCache.items, i.rev); }
      else if (r.reason === 'access') { v.roomDenied = true; clearRoom(v); }
      syncDoor(v);
    }

    // ── Ходы: свой участок (сервер или браузер) ──
    let chain = Promise.resolve();
    const reasonText = r => WHY[r] || WHY.args;
    const wallet = () => ({ coins: window.D37Coins?.coins?.() ?? B.me?.coins ?? 0 });
    async function doAct(a, args = {}, o = {}){
      if (!B.me) { toast(WHY.none, false); return { ok: false }; }
      S.idleAt = Date.now();
      const now = nowS();
      if (B.me.local) {
        const r = Rules.act(B.me, a, args, now);
        if (!r.ok) { toast(r.reason === 'coins' ? WHY.local : reasonText(r.reason), false); sfx('buzz'); return r; }
        B.me.rev = (B.me.rev || 0) + 1;
        saveLocal(); afterChange(a, r, o);
        return r;
      }
      // сервер: сразу показываем по тем же правилам, сервер подтверждает (за монеты — ждём сервер)
      const coinAct = a === 'finish' || (a === 'place' && DEFS[args.k]?.coins) || (a === 'fplace' && FURN[args.k]?.coins > 0 && !(B.me.own['f:' + args.k] > B.me.room.filter(e => e.k === args.k).length));
      let pre = null;
      if (!coinAct) {
        pre = Rules.act(B.me, a, args, now);
        if (!pre.ok) { toast(reasonText(pre.reason), false); sfx('buzz'); return pre; }
        afterChange(a, pre, o);
      }
      B.pend++;
      const res = await (chain = chain.then(() => rpc('base_act', { p_act: a, p_a: args })));
      B.pend--;
      if (B.stopped) return res;
      if (res?.ok) {
        B.last = res;
        if (coinAct) { window.D37Coins?.sync?.(); }
        if (!B.pend) { if (B.dirty) { B.dirty = false; await refreshOwn(); } else { B.me = fromServer(res); afterChange(a, res, { quiet: true }); } }
        signal();
        if (coinAct) afterChange(a, res, o);
      } else {
        toast(res?.reason === 'nosql' ? '📝 Сайт обновляется — попробуй позже' : reasonText(res?.reason), false);
        if (B.pend) B.dirty = true; else await refreshOwn();
      }
      return res;
    }
    async function refreshOwn(){
      const r = await rpc('base_state');
      if (r.ok) { B.me = fromServer(r); afterChange('sync', r, { quiet: true }); }
    }
    function afterChange(a, r, o = {}){
      const j = B.me ? lotOf(B.me.plot) : -1;
      if (B.me && streetOf(B.me.plot) === B.street && j >= 0) { buildView(j); const v = B.views[j]; if (v?.house) buildRoom(v, B.me.room, B.me.rev || 0); }
      if (!o.quiet) {
        if (a === 'collect' && r.got) { toast(`🧱 +${r.got}`, true); sfx('coin'); }
        else if (a === 'gift' && r.got) { toast(`🎁 Подарок дня: +${r.got} 🧱`, true); sfx('coin'); }
        else if (a === 'place' || a === 'fplace') sfx(DEFS[o.k]?.lv > 1 || a === 'fplace' ? 'build_wood' : 'pickup');
        else if (a === 'upgrade') { sfx('build_wood'); toast('🔨 Строитель взялся за работу', true); }
        else if (a === 'finish') { sfx('coin'); toast('⚡ Готово!', true); }
        else if (a === 'move' || a === 'fmove') sfx('click');
        else if (a === 'remove' || a === 'fremove') sfx('pickup');
      }
      renderHud(); if (B.bm) { renderCat(); renderSel(); }
      if (B.menuOpen) openMenu(true);
    }
    let sigT = 0;
    function signal(){ clearTimeout(sigT); sigT = setTimeout(() => { if (B.me && !B.me.local) HK.send?.({ t: 'base', p: B.me.plot, r: B.me.rev || 0 }); }, 1500); }
    const giftReady = () => !!B.me && B.me.gift !== Rules.day(nowS());
    const giftSize = () => (B.me ? Math.min(50 + 50 * Rules.th(B.me), Math.max(0, Rules.cap(B.me) - B.me.bricks)) : 0);

    // ── Занять участок / пробный участок ──
    async function claim(plot){
      if (!authed()) { toast('Войди, чтобы занять участок навсегда', false); return; }
      const trial = B.trial || (B.me?.local ? B.me : null);
      const r = await rpc('base_claim', { p_plot: plot, p_import: trial ? { layout: trial.layout, room: trial.room, bricks: trial.bricks } : null });
      if (r.ok) {
        B.me = fromServer(r); B.trial = null;
        try { localStorage.removeItem(LS); } catch (e) {}
        toast(`🏘️ Участок №${plot} — твой!${trial ? ' Пробная стройка перенесена.' : ''}`, true); sfx('coin');
        B.street = streetOf(plot);
        await loadStreet(); renderHud(); HK.retrack?.(); signal();
        S.H?.toast && setTimeout(() => toast('🔨 Нажми «Строить» — и ставь шахты, заборы, украшения'), 2600);
      } else toast(r.reason === 'nosql' ? '📝 Сайт обновляется — пока можно строить пробный участок' : reasonText(r.reason), false);
    }
    function trialHere(plot){
      const now = nowS();
      if (B.me?.local) { B.me.plot = plot; toast(`🏘️ Пробный участок перенесён на №${plot}`, true); }
      else { B.me = { ...Rules.fresh(plot, now), local: true, rev: 1 }; toast('🏘️ Пробный участок! Строй — он хранится в этом браузере', true); }
      saveLocal(); B.street = streetOf(plot); rebuildAll(); renderHud(); HK.retrack?.();
    }

    // ── Подсказки и действия табличек ──
    B.signPrompt = j => {
      const plot = B.street * PER + j + 1, i = lotInfo(j);
      if (!i) {
        if (B.me && !B.me.local) return `Участок №${plot} — свободен`;
        if (authed() && B.sql !== false) return `Занять участок №${plot}`;
        return B.me?.local ? `Перенести пробный участок сюда (№${plot})` : `Строить здесь (пробный участок №${plot})`;
      }
      if (i.mine) return `Мой участок №${plot}: меню`;
      return `Участок ${i.nick}: 👍 и профиль`;
    };
    B.signAct = j => {
      const plot = B.street * PER + j + 1, i = lotInfo(j);
      if (!i) {
        if (B.me && !B.me.local) { toast(`У тебя уже есть участок №${B.me.plot}`); return; }
        if (authed() && B.sql !== false) { HK.panel?.(`<span class="wld-pe">🏘️</span><b>Участок №${plot}</b>`, `<p>Занять этот участок? Он будет твоим навсегда: ратуша, дом и шахта уже стоят, 🧱 ${START} на старт.${B.trial || B.me?.local ? ' Пробная стройка перенесётся (уровни — до 2).' : ''}</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="claim:${plot}">🏘️ Занять</button></div>`); return; }
        trialHere(plot);
        return;
      }
      if (i.mine) { openMenu(); return; }
      ownerPanel(j);
    };
    B.boardPrompt = () => `Улица ${B.street + 1} — сменить улицу`;
    B.streetPanel = () => {
      const n = Math.max(1, Math.ceil(B.maxPlot / PER) + 1, B.street + 1, B.me ? streetOf(B.me.plot) + 1 : 1);
      const btn = s => `<button type="button" data-mb="street:${s}"${s === B.street ? ' class="ct-start"' : ''}>Улица ${s + 1}${B.me && streetOf(B.me.plot) === s ? ' 🏠' : ''}</button>`;
      HK.panel?.('<span class="wld-pe">🏘️</span><b>Район участков</b>', `<p>На каждой улице 6 участков. Кто на другой улице, тот виден здесь только вне участков.</p><div class="wld-acts mb-streets">${Array.from({ length: Math.min(n, 100) }, (_, s) => btn(s)).join('')}</div>`);
    };
    function ownerPanel(j){
      const i = lotInfo(j); if (!i) return;
      const acc = { all: '🔓 Дом открыт для всех', friends: '💚 В дом пускают только друзей', nobody: '🔒 Дом закрыт' }[i.access] || '';
      HK.panel?.(`<span class="wld-pe">🏡</span><b>${esc(i.nick)}</b>`, `<p>Участок №${i.plot} · 🏛️ ратуша ${i.layout.find(e => e.k === 'th')?.l || 1} ур. · 👍 ${i.likes || 0}<br>${acc}</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="like:${i.uid}">👍 Нравится</button><button type="button" data-mb="profile:${i.uid}">👤 Профиль</button></div>`);
    }
    function arcadePanel(){
      const list = (typeof GAMES !== 'undefined' ? GAMES : []).filter(g => !['world', 'studio', 'studio3d', 'wardrobe'].includes(g.id) && !g.href).slice(0, 18);
      HK.panel?.('<span class="wld-pe">🕹️</span><b>Игровой автомат</b>', `<div class="wld-chips">${list.map(g => `<button type="button" data-mb="go:#/games/${esc(g.id)}">${g.icon} ${esc(g.title)}</button>`).join('')}</div>`);
    }

    // ── Меню участка (кнопка 🏘️) ──
    function openMenu(refresh){
      const pn = S.q('.wld-panel');
      if (refresh && (!pn || pn.hidden || !pn.querySelector('.mb-menu'))) { B.menuOpen = false; return; }
      B.menuOpen = true;
      const me = B.me, now = nowS();
      let body;
      if (!me) {
        body = authed() && B.sql !== false
          ? `<p>У тебя пока нет участка. Займи свободный в <b>Районе участков</b> — за кафе, на северо-западе: подойди к табличке участка и нажми «Занять».</p><div class="wld-acts"><button type="button" class="ct-start" data-mb="district">🏘️ В район участков</button></div>`
          : `<p>Свой участок — как база в Clash of Clans: ратуша, дом с мебелью, шахты кирпичей, заборы. ${authed() ? 'Сайт скоро обновится — пока участок хранится в этом браузере.' : '<b>Войди</b> — и участок будет твоим навсегда, его увидят все. Без входа можно построить пробный.'}</p><div class="wld-acts">${authed() ? '' : '<button type="button" class="ct-start" data-mb="login">🔑 Войти</button>'}<button type="button" data-mb="district">🏘️ В район участков</button></div>`;
      } else {
        Rules.norm(me, now);
        const t = Rules.th(me), cap = Rules.cap(me), busy = Rules.busy(me, now), bl = Rules.builders(me), p = Rules.prodSum(me, null, now);
        const acc = me.access;
        body = `<p>Участок №${me.plot} (улица ${streetOf(me.plot) + 1})${me.local ? ' · <b>пробный</b>' : ''}<br>🏛️ Ратуша ${t} ур. · 🧱 ${num(me.bricks)} / ${num(cap)} · 👷 ${busy}/${bl}${me.local ? '' : ' · 👍 ' + (me.likes || 0)}${p > 0 ? `<br>⛏️ В шахтах: 🧱 ${num(p)}` : ''}</p>
          <div class="wld-acts"><button type="button" class="ct-start" data-mb="home">🏠 К участку</button><button type="button" data-mb="build">🔨 Строить</button>${p > 0 ? `<button type="button" data-mb="collect">⛏️ Собрать 🧱 ${num(p)}</button>` : ''}${giftReady() ? `<button type="button" data-mb="gift">🎁 Подарок дня</button>` : ''}</div>
          <div class="wld-sublbl">Кого пускать в дом</div><div class="wld-chips">${[['all', '🔓 Всех'], ['friends', '💚 Друзей'], ['nobody', '🔒 Никого']].map(([a, l]) => `<button type="button" data-mb="access:${a}"${acc === a ? ' class="ct-start"' : ''}>${l}</button>`).join('')}</div>
          ${me.local ? `<p class="mb-small">${authed() ? '📝 Хранится в этом браузере — сохранится в аккаунте, когда сайт обновится.' : '📝 Пробный участок хранится только в этом браузере. <b>Войди</b> — займи участок, и стройка перенесётся.'}</p>${authed() ? '' : '<div class="wld-acts"><button type="button" class="ct-start" data-mb="login">🔑 Войти</button></div>'}` : ''}`;
      }
      HK.panel?.('<span class="wld-pe">🏘️</span><b>Мой участок</b>', `<div class="mb-menu">${body}</div>`);
    }
    function teleport(x, z, yaw){
      const P = S.P; if (!P) return;
      if (S.mySeat) P.standUp();
      P.place(x, null, z, yaw);
      S.rig?.snap(P.ch.x, P.ch.y, P.ch.z);
      if (S.rig) S.rig.yaw = yaw - PI;
      HK.closePops?.();
      S.forceSend = true;
    }
    function goHome(){
      if (!B.me) return;
      if (streetOf(B.me.plot) !== B.street) { B.street = streetOf(B.me.plot); loadStreet(); HK.retrack?.(); }
      const lot = LOTS[lotOf(B.me.plot)], [x, z] = lotToWorld(lot, 2, HALF + 1.6);
      teleport(x, z, lot.yaw + PI);
    }

    // ── Клики по нашим кнопкам (data-mb) ──
    const onClick = e => {
      const b = e.target.closest('[data-mb]'); if (!b || !S.el.contains(b)) return;
      const a = b.dataset.mb;
      S.idleAt = Date.now();
      if (a === 'menu') { if (S.q('.wld-panel .mb-menu') && !S.q('.wld-panel').hidden) { HK.closePops?.(); B.menuOpen = false; } else openMenu(); }
      else if (a === 'login') { if (typeof openGlobalAuth === 'function') openGlobalAuth(); }
      else if (a === 'district') teleport(-12.5, -36, PI);
      else if (a === 'home') goHome();
      else if (a === 'build') { if (!onMyLot() && !inMyHouse()) goHome(); setTimeout(() => enterBuild(), 60); }
      else if (a === 'gift') doAct('gift');
      else if (a === 'collect') doAct('collect', {});
      else if (a.startsWith('access:')) doAct('access', { a: a.slice(7) });
      else if (a.startsWith('claim:')) { HK.closePops?.(); claim(+a.slice(6)); }
      else if (a.startsWith('street:')) { const s = +a.slice(7); if (s !== B.street && s >= 0 && s < PLOTS / PER) { if (B.bm) exitBuild(); B.street = s; B.data.clear(); rebuildAll(); loadStreet(); HK.retrack?.(); } HK.closePops?.(); }
      else if (a.startsWith('like:')) like(a.slice(5));
      else if (a.startsWith('profile:')) HK.go?.('#/profile/' + a.slice(8));
      else if (a.startsWith('go:')) HK.go?.(a.slice(3));
      else if (a === 'exit') exitBuild();
      else if (a.startsWith('bub:')) doAct('collect', { id: +a.slice(4) });
      else if (!B.bm) return;
      else if (a.startsWith('tab:')) { B.bm.tab = a.slice(4); renderCat(); }
      else if (a.startsWith('pick:')) pickTool(a.slice(5));
      else if (a === 'rot') rotate();
      else if (a === 'ok') confirmTool();
      else if (a === 'cancel') { if (B.bm?.tool) { B.bm.tool = null; ghostOff(); renderSel(); } else if (B.bm?.sel) { B.bm.sel = null; renderSel(); } }
      else if (a === 'upg') doAct('upgrade', { id: B.bm?.sel });
      else if (a === 'fin') finish(B.bm?.sel);
      else if (a === 'mv') startMove();
      else if (a === 'del') remove();
      else if (a === 'col') doAct('collect', { id: B.bm?.sel });
    };
    async function like(uid){
      if (!authed()) { toast('Войди, чтобы ставить 👍', false); return; }
      if (B.sql === false) { toast('📝 Сайт обновляется — попробуй позже', false); return; }
      const r = await rpc('base_act', { p_act: 'like', p_a: { uid } });
      if (r.ok) { toast('👍 Хозяину +10 🧱 — спасибо!', true); sfx('coin'); const d = [...B.data.values()].find(e => e.uid === uid); if (d) { d.likes = r.likes ?? d.likes + 1; rebuildAll(); } HK.send?.({ t: 'base', p: r.plot || 0, r: r.rev || 0 }); }
      else toast(r.reason === 'max' ? WHY.max_likes : reasonText(r.reason), false);
      HK.closePops?.();
    }
    async function finish(id){
      const it = B.me?.layout.find(e => e.i === id); if (!it?.ue) return;
      if (B.me.local) { toast(WHY.local, false); return; }
      const n = Rules.speedCost(it, nowS());
      if (!confirm(`Достроить сразу за ${n} 🪙?`)) return;
      doAct('finish', { id });
    }

    // ── Режим стройки ──
    const myView = () => (B.me && streetOf(B.me.plot) === B.street ? B.views[lotOf(B.me.plot)] : null);
    function onMyLot(){
      const v = myView(); if (!v || !S.P) return false;
      const [lx, lz] = worldToLot(v.lot, S.P.ch.x, S.P.ch.z);
      return Math.abs(lx) < HALF + 2.5 && Math.abs(lz) < HALF + 2.5;
    }
    const inMyHouse = () => !!(B.me && S.inside && S.inside.room === 'mb' + B.me.plot);
    function enterBuild(){
      if (!B.me) { openMenu(); return; }
      const v = myView();
      if (!v) { toast('Подойди к своему участку'); return; }
      const room = inMyHouse() && !!v.house;
      if (!room && !onMyLot()) { toast('Подойди к своему участку'); return; }
      if (S.mySeat) S.P.standUp();
      const rig = S.rig;
      if (rig.mode === 'first') { rig.toggle(); S.H.crosshair(false); }
      B.bm = { room, tab: room ? 'f' : 'b', tool: null, sel: null, save: { pitch: rig.pitch, dist: rig.dist, maxD: rig.maxD, minP: rig.minP } };
      let cx, cz;
      if (room) { const h = v.house; [cx, cz] = lotToWorld(v.lot, h.cx, h.cz); rig.maxD = 15; rig.dist = 11; rig.pitch = 1.08; h.roof.visible = false; }
      else { [cx, cz] = lotToWorld(v.lot, 0, 1); rig.maxD = 40; rig.dist = 25; rig.pitch = .98; }
      rig.minP = .5;
      B.cam = { x: cx, y: room ? .6 : 2, z: cz };
      S.P.enabled = false;
      grid(true);
      renderHud(); renderCat(); renderSel();
      sfx('click');
    }
    function exitBuild(){
      if (!B.bm) return;
      const rig = S.rig, s = B.bm.save;
      rig.pitch = s.pitch; rig.dist = s.dist; rig.maxD = S.inside ? 9 : s.maxD; rig.minP = S.inside ? .55 : s.minP;
      if (B.bm.room && !S.inside) { const v = myView(); if (v?.house) v.house.roof.visible = true; }
      B.bm = null; B.cam = null; S.P.enabled = true;
      ghostOff(); grid(false); selBox(null);
      renderHud();
    }
    function pickTool(k){
      const bm = B.bm; if (!bm) return;
      const D = bm.room ? FURN[k] : DEFS[k]; if (!D) return;
      bm.sel = null;
      const p = bm.lastCell || [Math.floor((bm.room ? IN : N) / 2), Math.floor((bm.room ? IN : N) / 2)];
      bm.tool = { k, r: 0, x: p[0], z: p[1], move: 0 };
      fitTool();
      renderSel(); updGhost();
    }
    function startMove(){
      const bm = B.bm, list = bm?.room ? B.me.room : B.me?.layout, it = list?.find(e => e.i === bm.sel); if (!it) return;
      bm.tool = { k: it.k, r: it.r, x: it.x, z: it.z, move: it.i };
      renderSel(); updGhost();
    }
    function rotate(){
      const bm = B.bm; if (!bm) return;
      if (bm.tool) { bm.tool.r = (bm.tool.r + 1) & 3; fitTool(); updGhost(); sfx('click'); return; }
      const list = bm.room ? B.me.room : B.me.layout, it = list.find(e => e.i === bm.sel); if (!it) return;
      const [w, d] = bm.room ? Rules.ffp(it.k, (it.r + 1) & 3) : Rules.fp(it.k, (it.r + 1) & 3);
      // поворот на месте; не помещается — сдвигаем внутрь
      const M = bm.room ? IN : N, x = Math.max(0, Math.min(M - w, it.x)), z = Math.max(0, Math.min(M - d, it.z));
      doAct(bm.room ? 'fmove' : 'move', { id: it.i, x, z, r: (it.r + 1) & 3 });
    }
    function remove(){
      const bm = B.bm; if (!bm?.sel) return;
      if (bm.room) { doAct('fremove', { id: bm.sel }); bm.sel = null; renderSel(); return; }
      const it = B.me.layout.find(e => e.i === bm.sel); if (!it) return;
      if (!Rules.isDeco(it.k)) { toast(WHY.fixed, false); return; }
      doAct('remove', { id: bm.sel }); bm.sel = null; renderSel();
    }
    function fitTool(){
      const bm = B.bm, t = bm?.tool; if (!t) return;
      const [w, d] = bm.room ? Rules.ffp(t.k, t.r) : Rules.fp(t.k, t.r), M = bm.room ? IN : N;
      t.x = Math.max(0, Math.min(M - w, t.x)); t.z = Math.max(0, Math.min(M - d, t.z));
    }
    function toolCheck(){
      const bm = B.bm, t = bm.tool, now = nowS();
      if (t.move) {
        const c = Rules.clone(B.me);
        return Rules.act(c, bm.room ? 'fmove' : 'move', { id: t.move, x: t.x, z: t.z, r: t.r }, now);
      }
      if (bm.room) return Rules.act(Rules.clone(B.me), 'fplace', { k: t.k, x: t.x, z: t.z, r: t.r }, now, B.me.local ? undefined : wallet());
      return Rules.canPlace(B.me, t.k, t.x, t.z, t.r, now, B.me.local ? undefined : wallet());
    }
    async function confirmTool(){
      const bm = B.bm, t = bm?.tool; if (!t) return;
      const room = bm.room;
      if (t.move) { const r = await doAct(room ? 'fmove' : 'move', { id: t.move, x: t.x, z: t.z, r: t.r }); if (r?.ok !== false) { bm.tool = null; ghostOff(); bm.sel = t.move; renderSel(); } return; }
      const D = room ? FURN[t.k] : DEFS[t.k];
      const coin = room ? D.coins > 0 && !(B.me.own['f:' + t.k] > B.me.room.filter(e => e.k === t.k).length) : D.coins > 0 && !(B.me.own[t.k] > Rules.count(B.me.layout, t.k));
      if (coin && B.me.local) { toast(WHY.local, false); return; }
      if (coin && !confirm(`Купить «${D.n}» за ${D.coins} 🪙?`)) return;
      const r = await doAct(room ? 'fplace' : 'place', { k: t.k, x: t.x, z: t.z, r: t.r }, { k: t.k });
      if (r?.ok === false) return;
      // заборы и украшения — ставим дальше тем же; постройки — по одной
      const again = !room && (t.k === 'wall' || Rules.isDeco(t.k)) && !D.coins;
      if (!again) { bm.tool = null; ghostOff(); }
      else updGhost();
      renderSel();
    }

    // ── Призрак, сетка, рамка выбора ──
    let ghost = null, ghostSig = '', gridW = null, selM = null;
    function ghostOff(){ if (ghost) { ghost.parent?.remove(ghost); ghost = null; ghostSig = ''; } }
    function frameOf(room){
      const v = myView(); if (!v) return null;
      if (!room) return { lot: v.lot, base: (lx, lz) => [lx, lz], v };
      const h = v.house; if (!h) return null;
      return { lot: v.lot, base: (hx, hz) => { const [a, b] = rotXZ(h.r, hx, hz); return [h.cx + a, h.cz + b]; }, v, h };
    }
    function updGhost(){
      const bm = B.bm, t = bm?.tool, F = frameOf(bm?.room); if (!t || !F) { ghostOff(); return; }
      const res = toolCheck(), ok = res.ok;
      const sig = t.k + '|' + t.r + '|' + ok;
      if (sig !== ghostSig) {
        ghostOff(); ghostSig = sig;
        ghost = new T.Group(); ghost.renderOrder = 5;
        const inner = R.group(ghost, 0, bm.room ? .12 : 0, 0, t.r * PI / 2), x = { T, R, glass: extra.glass, tvMat: extra.tvMat, boardMat: extra.boardMat };
        const it = { i: 0, k: t.k, x: 0, z: 0, r: t.r, l: 1 };
        if (bm.room) FDRAW[t.k]?.(P, inner, it, [], x);
        else if (t.k === 'wall') drawWall(P, inner, it, [], []);
        else DRAW[t.k]?.(P, inner, it, [], x);
        const [w, d] = bm.room ? Rules.ffp(t.k, t.r) : Rules.fp(t.k, t.r), cs = bm.room ? ICELL : CELL;
        R.part(ghost, { s: 'box', y: bm.room ? .14 : .06, w: w * cs - .06, h: .04, d: d * cs - .06, m: ok ? ghostOk : ghostBad });
        ghost.traverse(o => { if (o.isMesh) { o.material = ok ? ghostOk : ghostBad; o.castShadow = false; o.renderOrder = 5; } if (o.isSprite) o.visible = false; });
        ghost.rotation.y = F.lot.yaw;
        R.scene.add(ghost);
        // крыша призрака-дома не нужна сверху
      }
      const [cx, cz] = bm.room ? furnCenter(t) : itemCenter(t), [lx, lz] = F.base(cx, cz), [wx, wz] = lotToWorld(F.lot, lx, lz);
      ghost.position.set(wx, 0, wz);
      ghost.rotation.y = F.lot.yaw + (bm.room ? F.h.r * PI / 2 : 0);
      bm.why = ok ? '' : reasonText(res.reason);
      const gb = S.q('.mb-ghost .mb-why'); if (gb && gb.textContent !== bm.why) gb.textContent = bm.why;
    }
    function grid(on){
      if (gridW) { R.scene.remove(gridW); gridW.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); } }); gridW = null; }
      if (!on || !B.bm) return;
      const room = B.bm.room, F = frameOf(room); if (!F) return;
      const n = room ? IN : N, cs = room ? ICELL : CELL, px = 32, c = document.createElement('canvas'); c.width = c.height = n * px;
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, n * px); g.stroke(); g.beginPath(); g.moveTo(0, i * px); g.lineTo(n * px, i * px); g.stroke(); }
      if (room) { g.fillStyle = 'rgba(239,68,68,.28)'; g.fillRect(DOOR[0] * px, DOOR[2] * px, (DOOR[1] - DOOR[0]) * px, (DOOR[3] - DOOR[2]) * px); }
      const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding;
      const mesh = new T.Mesh(new T.PlaneGeometry(n * cs, n * cs), new T.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
      mesh.rotation.x = -PI / 2; mesh.renderOrder = 4;
      const [lx, lz] = F.base(0, 0), [wx, wz] = lotToWorld(F.lot, lx, lz);
      gridW = new T.Group();
      gridW.position.set(wx, room ? .135 : .07, wz); gridW.rotation.y = F.lot.yaw + (room ? F.h.r * PI / 2 : 0); gridW.add(mesh);
      R.scene.add(gridW);
    }
    function selBox(it){
      if (selM) { R.scene.remove(selM); selM = null; }
      const bm = B.bm, F = bm && frameOf(bm.room); if (!it || !F) return;
      const [w, d] = bm.room ? Rules.ffp(it.k, it.r) : Rules.fp(it.k, it.r), cs = bm.room ? ICELL : CELL, [cx, cz] = bm.room ? furnCenter(it) : itemCenter(it);
      const [lx, lz] = F.base(cx, cz), [wx, wz] = lotToWorld(F.lot, lx, lz);
      selM = new T.Mesh(R.K.geo(`mbsel${w}_${d}_${cs}`, () => new T.BoxGeometry(w * cs + .1, .08, d * cs + .1)), selMat);
      selM.position.set(wx, bm.room ? .17 : .08, wz); selM.rotation.y = F.lot.yaw + (bm.room ? F.h.r * PI / 2 : 0); selM.renderOrder = 5;
      R.scene.add(selM);
    }
    // Точка экрана → клетка (участка или комнаты)
    function pickCell(cx, cy){
      const bm = B.bm, F = frameOf(bm?.room); if (!F) return null;
      const r = R.screenRay(cx, cy), y0 = bm.room ? .12 : 0;
      if (r.dy > -1e-4) return null;
      const t = (y0 - r.oy) / r.dy, wx = r.ox + r.dx * t, wz = r.oz + r.dz * t;
      let [lx, lz] = worldToLot(F.lot, wx, wz);
      if (bm.room) { const h = F.h; [lx, lz] = rotXZ((4 - h.r) & 3, lx - h.cx, lz - h.cz); }
      return { lx, lz };
    }
    function itemAt(p){
      const bm = B.bm, room = bm.room, list = room ? B.me.room : B.me.layout, cs = room ? ICELL : CELL, half = room ? IHALF : HALF;
      const gx = Math.floor((p.lx + half) / cs), gz = Math.floor((p.lz + half) / cs);
      let hit = null;
      for (const it of list) {
        const [w, d] = room ? Rules.ffp(it.k, it.r) : Rules.fp(it.k, it.r);
        if (gx >= it.x && gx < it.x + w && gz >= it.z && gz < it.z + d && (!hit || (room && FURN[hit.k]?.floor))) hit = it;
      }
      return hit;
    }
    function tapAt(tp){
      const bm = B.bm, p = pickCell(tp.x, tp.y); if (!p) return;
      const t = bm.tool;
      if (t) {
        const [w, d] = bm.room ? Rules.ffp(t.k, t.r) : Rules.fp(t.k, t.r), [x, z] = bm.room ? icellAt(p.lx, p.lz, w, d) : cellAt(p.lx, p.lz, w, d), M = bm.room ? IN : N;
        const nx = Math.max(0, Math.min(M - w, x)), nz = Math.max(0, Math.min(M - d, z));
        const same = nx === t.x && nz === t.z;
        t.x = nx; t.z = nz; bm.lastCell = [nx, nz];
        updGhost();
        if (!S.I.touch || same) confirmTool();
        return;
      }
      const it = itemAt(p);
      bm.sel = it ? it.i : null;
      renderSel();
    }

    // ── Экран: кнопка в шапке, «Строить», ресурсы, каталог, выбранное, пузырьки над шахтами, заметки ──
    const hud = document.createElement('div'); hud.className = 'mb-hud';
    hud.innerHTML = `<div class="mb-tags"></div>
      <button type="button" class="mb-fab" data-mb="build" hidden>🔨<span> Строить</span></button>
      <div class="mb-top" hidden><span class="mb-res mbBr"></span><span class="mb-res mbBl"></span><span class="mb-res mbCo"></span><button type="button" class="mb-gift" data-mb="gift" hidden>🎁</button><button type="button" class="mb-done" data-mb="exit">✓ Готово</button></div>
      <div class="mb-sel" hidden></div>
      <div class="mb-ghost" hidden><span class="mb-why"></span><button type="button" data-mb="rot" title="Повернуть (R)">⟳</button><button type="button" class="ct-start" data-mb="ok">✓ Поставить</button><button type="button" data-mb="cancel" title="Отмена (Esc)">✕</button></div>
      <div class="mb-cat" hidden><div class="mb-tabs"></div><div class="mb-cards"></div></div>
      <div class="mb-note" hidden></div>`;
    S.wrap.appendChild(hud);
    const q = s => hud.querySelector(s);
    for (const el of [q('.mb-top'), q('.mb-sel'), q('.mb-ghost'), q('.mb-cat'), q('.mb-fab')]) {
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    }
    const topBtn = document.createElement('button');
    topBtn.type = 'button'; topBtn.dataset.mb = 'menu'; topBtn.title = 'Мой участок'; topBtn.innerHTML = '🏘️<span> Участок</span>';
    S.q('.wld-topbtns')?.prepend(topBtn);
    S.el.addEventListener('click', onClick);
    let noteT = 0;
    function note(t){ const n = q('.mb-note'); n.textContent = t; n.hidden = false; clearTimeout(noteT); noteT = setTimeout(() => { n.hidden = true; }, 9000); }
    function renderHud(){
      const bm = B.bm, me = B.me, now = nowS();
      q('.mb-top').hidden = !bm; q('.mb-cat').hidden = !bm;
      S.wrap.classList.toggle('mb-building', !!bm);
      if (!bm) { q('.mb-sel').hidden = true; q('.mb-ghost').hidden = true; }
      if (me && bm) {
        q('.mbBr').innerHTML = `🧱 <b>${num(me.bricks)}</b>/${num(Rules.cap(me))}`;
        q('.mbBl').innerHTML = `👷 <b>${Rules.busy(me, now)}/${Rules.builders(me)}</b>`;
        q('.mbCo').innerHTML = me.local ? '' : `🪙 <b>${num(window.D37Coins?.coins?.() ?? me.coins ?? 0)}</b>`;
        q('.mbCo').hidden = !!me.local;
        q('.mb-gift').hidden = !giftReady() || bm.room;
      }
    }
    const TABS = { b: ['🏛️ Постройки', ['mine', 'store', 'shop', 'tower']], w: ['🧱 Заборы', ['wall']], d: ['🌳 Украшения', ['tree', 'pine', 'bush', 'flowers', 'rock', 'lamp', 'flag', 'bench', 'fountain', 'statue']], f: ['🛋️ Мебель', Object.keys(FURN)] };
    function renderCat(){
      const bm = B.bm, me = B.me; if (!bm || !me) return;
      const tabs = bm.room ? ['f'] : ['b', 'w', 'd'];
      q('.mb-tabs').innerHTML = tabs.map(t => `<button type="button" data-mb="tab:${t}"${bm.tab === t ? ' class="on"' : ''}>${TABS[t][0]}</button>`).join('') + (bm.room ? `<span class="mb-lim">${me.room.length}/${DEFS.house.furn[Rules.houseLv(me) - 1]} предметов</span>` : `<span class="mb-lim">🌳 ${Rules.count(me.layout, 'deco')}/${DECO_MAX[Rules.th(me) - 1]}</span>`);
      const t = Rules.th(me);
      q('.mb-cards').innerHTML = TABS[bm.tab][1].map(k => {
        const D = bm.room ? FURN[k] : DEFS[k];
        let lock = '', cnt = '', price;
        if (bm.room) {
          const inv = (me.own['f:' + k] || 0) - me.room.filter(e => e.k === k).length;
          price = inv > 0 ? `в запасе: ${inv}` : D.coins ? `${D.coins} 🪙` : `${D.cost} 🧱`;
          if (D.coins && me.local && inv <= 0) lock = 'после входа';
        } else {
          const lim = Rules.limit(k, t), n = Rules.count(me.layout, Rules.isDeco(k) ? 'deco' : k), inv = Rules.isDeco(k) ? (me.own[k] || 0) - Rules.count(me.layout, k) : 0;
          price = inv > 0 ? `в запасе: ${inv}` : D.coins ? `${D.coins} 🪙` : `${num(D.cost[0])} 🧱`;
          if ((D.th || 1) > t || lim <= 0) lock = `ратуша ${Math.max(D.th || 1, (D.max || []).findIndex(m => m > 0) + 1)}`;
          else if (n >= lim) lock = 'макс.';
          if (!Rules.isDeco(k)) cnt = `${Rules.count(me.layout, k)}/${lim}`;
          if (D.coins && me.local && inv <= 0 && !lock) lock = 'после входа';
        }
        const poor = !lock && !price.startsWith('в запасе') && (D.coins ? false : (bm.room ? D.cost : D.cost[0]) > me.bricks);
        return `<button type="button" class="mb-card${bm.tool?.k === k && !bm.tool.move ? ' on' : ''}${poor ? ' poor' : ''}" data-mb="pick:${k}"${lock ? ' disabled' : ''} title="${esc(D.info || D.n)}"><span class="mb-ce">${D.e}</span><b>${esc(D.n)}</b><span class="mb-cc">${lock ? '🔒 ' + lock : price}</span>${cnt ? `<span class="mb-cn">${cnt}</span>` : ''}</button>`;
      }).join('');
    }
    function renderSel(){
      const bm = B.bm, box = q('.mb-sel'), gb = q('.mb-ghost');
      gb.hidden = !bm?.tool;
      // полоски над каталогом: высота каталога зависит от экрана
      const catH = q('.mb-cat').offsetHeight || 140;
      gb.style.bottom = (catH + 16) + 'px';
      if (S.wrap.clientWidth <= 640) { box.style.bottom = (catH + 16) + 'px'; box.style.top = 'auto'; } else { box.style.bottom = ''; box.style.top = ''; }
      if (bm?.tool) { const D = bm.room ? FURN[bm.tool.k] : DEFS[bm.tool.k]; gb.querySelector('[data-mb="ok"]').textContent = bm.tool.move ? '✓ Сюда' : `✓ Поставить ${D?.e || ''}`; }
      if (!bm || bm.tool || !bm.sel) { box.hidden = true; selBox(null); return; }
      const list = bm.room ? B.me.room : B.me.layout, it = list.find(e => e.i === bm.sel);
      if (!it) { bm.sel = null; box.hidden = true; selBox(null); return; }
      selBox(it);
      const now = nowS(), acts = [];
      let head, body = '';
      if (bm.room) {
        const F = FURN[it.k];
        head = `${F.e} ${esc(F.n)}`; body = F.info ? `<p>${esc(F.info)}</p>` : '';
        acts.push('<button type="button" data-mb="rot">⟳ Повернуть</button>', '<button type="button" data-mb="mv">✥ Переместить</button>', '<button type="button" data-mb="del">📦 Убрать в запас</button>');
      } else {
        const D = DEFS[it.k], t = Rules.th(B.me);
        head = `${D.e} ${esc(D.n)}${D.lv > 1 ? ` · ${it.l || 0} ур.` : ''}`;
        const lines = [];
        if (D.info) lines.push(esc(D.info));
        if (it.k === 'mine' && it.l >= 1) lines.push(`Добыча: ${D.rate[it.l - 1]} 🧱/час · в шахте ${Rules.prod(it, now)}/${D.hold[it.l - 1]}`);
        if ((it.k === 'store' || it.k === 'th') && it.l >= 1) lines.push(`Вмещает: ${num(D.keep[it.l - 1])} 🧱`);
        if (it.k === 'house' && it.l >= 1) lines.push(`Мебели: до ${D.furn[it.l - 1]} предметов`);
        if (it.ue) {
          lines.push(`⏳ ${it.l === 0 ? 'Строится' : 'Улучшается до ' + it.ul + ' ур.'} — осталось ${fmtT(it.ue - now)}`);
          if (!B.me.local) acts.push(`<button type="button" class="ct-start" data-mb="fin">⚡ Достроить за ${Rules.speedCost(it, now)} 🪙</button>`);
        } else if (D.lv > it.l) {
          const nl = it.l + 1, cost = D.cost[nl - 1], tm = D.time[nl - 1];
          const cap = it.k !== 'th' && nl > t ? `нужна ратуша ${nl}` : cost > Rules.cap(B.me) ? 'построй склад побольше' : '';
          acts.push(`<button type="button" class="ct-start" data-mb="upg"${cap ? ' disabled' : ''}>⬆ До ${nl} ур.: ${num(cost)} 🧱${tm ? ' · ' + fmtT(tm) : ''}${cap ? ' (' + cap + ')' : ''}</button>`);
        } else if (D.lv > 1) lines.push('Самый высокий уровень ⭐');
        if (it.k === 'mine' && Rules.prod(it, now) > 0) acts.push(`<button type="button" data-mb="col">⛏️ Собрать ${Rules.prod(it, now)}</button>`);
        body = `<p>${lines.join('<br>')}</p>`;
        if (it.k !== 'wall') acts.push('<button type="button" data-mb="rot">⟳ Повернуть</button>');
        acts.push('<button type="button" data-mb="mv">✥ Переместить</button>');
        if (Rules.isDeco(it.k)) acts.push('<button type="button" data-mb="del">📦 Убрать в запас</button>');
      }
      box.innerHTML = `<div class="mb-sh"><b>${head}</b><button type="button" class="wld-x" data-mb="cancel" aria-label="Закрыть">✕</button></div>${body}<div class="wld-acts">${acts.join('')}</div>`;
      box.hidden = false;
      box.dataset.t = String(now);
    }
    // пузырьки «🧱 N» над своими шахтами и полоски стройки (свой участок и соседи рядом)
    const tagEls = new Map();
    function drawTags(){
      const wrap = q('.mb-tags'), seen = new Set(), cam = R.camera.position, now = nowS();
      const list = [];
      for (const v of B.views) {
        if (!v?.info || !v.root?.visible) continue;
        const mine = v.info.mine, L = mine && B.me ? B.me.layout : v.info.layout;
        if (!mine && Math.hypot(cam.x - v.lot.x, cam.z - v.lot.z) > 40) continue;
        for (const it of L) {
          const busy = it.ue != null && it.ue > now, amt = mine ? Rules.prod(it, now) : 0;
          if (!busy && amt < 1) continue;
          list.push({ v, it, busy, amt, mine });
        }
      }
      for (const e of list.slice(0, 24)) {
        const key = e.v.info.plot + ':' + e.it.i;
        let el = tagEls.get(key);
        if (!el) { el = document.createElement(e.mine && !e.busy ? 'button' : 'div'); el.className = e.mine && !e.busy ? 'mb-bub' : 'mb-tag'; if (el.tagName === 'BUTTON') { el.type = 'button'; el.addEventListener('pointerdown', ev => ev.stopPropagation()); } wrap.appendChild(el); tagEls.set(key, el); }
        if ((el.tagName === 'BUTTON') !== (e.mine && !e.busy)) { el.remove(); tagEls.delete(key); continue; }
        seen.add(key);
        const [cx, cz] = itemCenter(e.it), [wx, wz] = lotToWorld(e.v.lot, cx, cz), h = (e.v.hts.get(e.it.i) || 2.4) + .3;
        const [sx, sy, vis] = R.project(wx, h, wz);
        if (!vis || Math.hypot(cam.x - wx, cam.z - wz) > 55) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`;
        if (e.busy) {
          const D = DEFS[e.it.k], tot = D.time[(e.it.ul || 1) - 1] || 1, k = Math.max(0, Math.min(1, 1 - (e.it.ue - now) / tot));
          const html = `<b>${D.e} ${fmtT(e.it.ue - now)}</b><i><u style="width:${Math.round(k * 100)}%"></u></i>`;
          if (el.innerHTML !== html) el.innerHTML = html;
        } else {
          const txt = `🧱 ${e.amt}`;
          if (el.textContent !== txt) { el.textContent = txt; el.dataset.mb = 'bub:' + e.it.i; }
        }
      }
      for (const [k, el] of tagEls) if (!seen.has(k)) { el.remove(); tagEls.delete(k); }
    }

    // ── Шаг и кадр (из mir.js) ──
    let tick = 0, presT = 0, roomT = 0;
    B.update = dt => {
      const C = S.C, bm = B.bm;
      tick += dt; presT += dt; roomT += dt;
      if (C.down('build') && !S.editing) { if (bm) exitBuild(); else enterBuild(); }
      if (bm) {
        S.P.busyUntil = S.P.now + .5;   // подсказки «[E]» молчат
        if (C.down('rotate')) rotate();
        if (C.down('pause')) { if (bm.tool) { bm.tool = null; ghostOff(); renderSel(); } else if (bm.sel) { bm.sel = null; renderSel(); } else exitBuild(); }
        // камера: WASD / джойстик двигают точку обзора по участку
        const m = C.move, rig = S.rig, sp = (bm.room ? 6 : 13) * dt, fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw), rx = Math.cos(rig.yaw), rz = -Math.sin(rig.yaw);
        if (B.cam && (m.x || m.z)) {
          const v = myView(); B.cam.x += (rx * m.x + fx * m.z) * sp; B.cam.z += (rz * m.x + fz * m.z) * sp;
          if (v) { let [lx, lz] = worldToLot(v.lot, B.cam.x, B.cam.z); const lim = bm.room ? 3 : HALF + 3, ox = bm.room ? v.house.cx : 0, oz = bm.room ? v.house.cz : 0; lx = Math.max(ox - lim, Math.min(ox + lim, lx)); lz = Math.max(oz - lim, Math.min(oz + lim, lz)); [B.cam.x, B.cam.z] = lotToWorld(v.lot, lx, lz); }
        }
      }
      if (presT > .5) { presT = 0; hideOthers(); }
      if (roomT > 1) { roomT = 0; nearRooms(); }
      if (tick > 90 && (B.near || bm)) { tick = 0; loadStreet(); }
      // ушёл с участка — выйти из стройки
      if (bm && !bm.room && !B.me) exitBuild();
    };
    B.frame = (dt, t) => {
      R.camera.updateMatrixWorld();   // камеру уже подвинули в этом кадре — подписи и луч по свежей
      const cam = R.camera.position;
      // дальние участки — прячем
      for (const v of B.views) if (v?.root) { const d = Math.hypot(cam.x - v.lot.x, cam.z - v.lot.z); v.root.visible = d < 125; }
      B.near = Math.hypot(S.P.ch.x + 45, S.P.ch.z + 41) < 75;
      // кнопка «Строить» — на своём участке
      const fab = q('.mb-fab'), canB = !!B.me && !B.bm && (onMyLot() || inMyHouse());
      if (fab.hidden === canB) fab.hidden = !canB;
      if (canB) { const inH = inMyHouse(); const lbl = inH ? '🛋️<span> Обставить</span>' : '🔨<span> Строить</span>'; if (fab.dataset.l !== lbl) { fab.dataset.l = lbl; fab.innerHTML = lbl; } }
      if (B.bm) {
        // призрак за мышью (на телефоне — по нажатию)
        if (B.bm.tool && B.ptr && !S.I.touch && B.ptr.t > (B.ptr.used || 0)) {
          B.ptr.used = B.ptr.t;
          const p = pickCell(B.ptr.x, B.ptr.y), tl = B.bm.tool;
          if (p) { const [w, d] = B.bm.room ? Rules.ffp(tl.k, tl.r) : Rules.fp(tl.k, tl.r), [x, z] = B.bm.room ? icellAt(p.lx, p.lz, w, d) : cellAt(p.lx, p.lz, w, d), M = B.bm.room ? IN : N; tl.x = Math.max(0, Math.min(M - w, x)); tl.z = Math.max(0, Math.min(M - d, z)); B.bm.lastCell = [tl.x, tl.z]; }
        }
        if (B.bm.tool) updGhost();
        for (const tp of S.I.taps) tapAt(tp);
        S.I.taps.length = 0;
        if (t - (B.selT || 0) > 1) { B.selT = t; if (B.bm.sel) renderSel(); renderHud(); }
      }
      if (t - (B.tvT || 0) > 3) { B.tvT = t; drawTv(); }
      drawTags();
    };
    // Чужие на другой улице (и на участках) — не видны
    function hideOthers(){
      const st = S.ch?.presenceState?.() || {};
      for (const p of S.players.values()) {
        const metas = st[p.key]; let bs = null;
        if (Array.isArray(metas) && metas.length) { const m = metas.reduce((a, b) => ((b.at || 0) >= (a.at || 0) ? b : a), metas[0]); if (Number.isInteger(m.bs)) bs = m.bs; }
        p.mbHide = bs != null && bs !== B.street && inDistrict(p.ch.x, p.ch.z);
        const a = S.A?.get(p.key); if (a) a.hidden = !!p.mbHide;
      }
    }
    // Рядом с чужим домом — подгрузить мебель (если пускают)
    function nearRooms(){
      const pc = S.P.ch;
      for (const v of B.views) {
        if (!v?.house || !v.info || v.info.mine) continue;
        const [hx, hz] = lotToWorld(v.lot, v.house.cx, v.house.cz);
        if (Math.hypot(pc.x - hx, pc.z - hz) > 16) continue;
        if (v.roomCache?.rev === v.info.rev && v.roomCache.uid === v.info.uid) { if (!v.roomV) buildRoom(v, v.roomCache.items, v.info.rev); continue; }
        if (Date.now() - (v.roomAt || 0) < 15000 || B.sql === false) continue;
        loadRoom(v);
      }
      // друзья подгрузились — двери могли открыться
      for (const v of B.views) if (v?.house) syncDoor(v);
    }
    // Сеть: кто-то перестроил участок на нашей улице — перечитать
    let reloadT = 0;
    B.onMsg = (p, d) => {
      if (!Number.isInteger(d.p) || streetOf(d.p) !== B.street || (B.me && d.p === B.me.plot && !B.me.local)) return;
      const cur = B.data.get(d.p);
      if (cur && cur.rev >= (d.r | 0)) return;
      clearTimeout(reloadT); reloadT = setTimeout(() => loadStreet(), 900);
    };
    const onPtr = e => { if (e.pointerType === 'mouse') B.ptr = { x: e.clientX, y: e.clientY, t: performance.now() }; };
    S.wrap.addEventListener('pointermove', onPtr);
    const onAuth = () => { if (!B.stopped) { if (B.bm) exitBuild(); init(); } };
    window.addEventListener('d37:auth', onAuth);
    B.dispose = () => {
      B.stopped = true;
      exitBuild();
      for (const v of B.views) clearView(v);
      S.el.removeEventListener('click', onClick);
      S.wrap.removeEventListener('pointermove', onPtr);
      window.removeEventListener('d37:auth', onAuth);
      clearTimeout(sigT); clearTimeout(reloadT); clearTimeout(noteT);
      hud.remove(); topBtn.remove(); ghostOff(); grid(false); selBox(null);
      for (const m of [stdMat, glowMat, ghostOk, ghostBad, selMat, glassM, boardM]) { m?.map?.dispose(); m?.dispose(); }
      if (tvC) { tvC.t.dispose(); tvC.mat.dispose(); }
      for (const d of dist.dyn) { d.t.dispose(); d.mat.dispose(); }
    };
    B._test = { rebuildAll, lotInfo, merge, init, claim };   // для проверки во встроенном браузере
    rebuildAll();   // таблички «свободен» — сразу, данные подтянутся
    init();
    return B;
  }

  root.MirBase = { DEFS, FURN, SERVER, Rules, Geo, WHY, zone, build, start, fmtT, _draw: { DRAW, FDRAW, WALL_ST } };
})();

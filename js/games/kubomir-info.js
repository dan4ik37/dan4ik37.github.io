// ═══════════════════════════════════════
//  «КУБОМИР» — помощники на экране (T-049, docs/plans/kubomir-modpacks.md §4.1 + решение владельца §7½: всё — аксессуары)
// ═══════════════════════════════════════
// Действует то, что НАДЕТО в ячейки 💍 (kubomir-x.js; в «Творчестве» — всё): ⌚ часы — время и день; 🧭 компас — полоса сторон
// света сверху и X / Z; глубиномер — высота Y и слой; 🔎 лупа — карточка «что под прицелом» (название, чем копать — по тем же
// правилам, что и само копание, сколько секунд, что выпадет; сундук — сколько занято, печь — что плавит; существо — сердечки);
// рудоискатель — самая ценная руда в 16 блоках и куда идти (поиск по кусочку, не больше ~0,2 мс за раз). Сытость еды — всегда:
// держишь еду — на полоске еды светятся куриные ножки, которые она вернёт (как AppleSkin), лишнее — «+N лишних».
// Общий слой экрана — D37E.info (js/engine/info.js). Обновление — 10 раз в секунду (карточка, строки), полоса компаса — каждый
// кадр, но DOM — только когда курс сдвинулся на 1°; на телефоне карточка — после 0,4 с на том же блоке (палец не мигает ею).
(() => {
  const VX = () => window.D37E.vox, E = () => window.D37E;
  const TOOL = { pick: 'кирка', axe: 'топор', shovel: 'лопата', sword: 'меч' };
  const TIER = ['', '', 'каменная', 'железная', 'алмазная'];
  // ценность руды для рудоискателя (моды: «…ore…» в имени — средняя)
  const ORE = { ore_diamond: [5, '💎'], ore_gold: [4, '🟡'], ore_iron: [3, '🟠'], ore_coal: [1, '⚫'] };
  const layerOf = (y, sea) => y >= sea + 30 ? 'высоко в горах' : y >= sea - 3 ? 'поверхность' : y >= 30 ? 'под землёй' : y >= 12 ? 'пещеры' : 'глубины — тут алмазы';
  window.KubomirX?.feature((st, X) => {
    const g = X.g, P = st.P;
    let hud = null, tick = 0, cardWant = null, cardKeyAt = 0, cardLostAt = 0, cardShown = null;
    // общие (без мусора за кадр): карточка и результат поиска руды
    const REC = { key: '', icon: '', emo: '', name: '', sub: '', lines: [], drops: [], live: '', liveCls: '' };
    // прошлые значения строк — числами (строка собирается только когда поменялось)
    const keyOf = { time: -1, x: NaN, z: NaN, side: -1, y: -999, oreId: -1, oreD: -1, oreA: -1, oreDy: 0, oreSt: -1 };
    const T = { x: NaN, y: NaN, z: NaN, v: -1, ice: false, tool: '', mob: null };   // прошлая цель лупы
    let oreV = null, scan = null, oreBest = null;
    const FOUND = { v: 0, d2: 0, x: 0, y: 0, z: 0, id: 0 };   // что нашёл рудоискатель (один объект)
    const f = { id: 'info', title: 'Подсказки на экране', order: 10 };
    f.init = () => {
      const parent = g.hudEl?.() || g.wrap?.();
      hud = g.infoHud ? g.infoHud() : parent && E().info ? E().info.hud(parent, { cls: 'kx-info' }) : null;   // g.infoHud — подмена для проверок в node
      if (!hud) return;
      const V = VX(); oreV = new Uint8Array(V.blocks.length);
      for (const b of V.blocks) { const o = ORE[b.name]; if (o) oreV[b.id] = o[0]; else if (/(^|[:_])ore(_|$)/.test(b.name)) oreV[b.id] = 2; }
    };
    f.dispose = () => { hud?.dispose(); hud = null; st.foodGhost = 0; };
    // строка на экране для других помощников (Дорожная книга: «📜 Верстак · 0/1»)
    X.hudChip = (id, ic, t, order) => hud?.chip(id, ic, t, order);
    X.hudHide = id => hud?.hide(id);
    // ── каждый кадр: еда (дёшево), видимость, полоса компаса; 10 раз в секунду — строки и карточка ──
    f.hud = dt => {
      if (!hud) return;
      foodGhost();
      const live = st.ready && !P.dead && !st.hudHidden;
      hud.show(live);
      if (!live) return;
      const dir = X.on('dir');
      // углы меток — когда отошёл на 0,3 блока или раз в 0,5 с (новая точка, дом); курс полосы — каждый кадр (сдвиг на 1° — сразу)
      if (dir) { if ((mkT -= dt) <= 0 || Math.abs(P.x - mkX) + Math.abs(P.z - mkZ) > .3) { mkT = .5; mkX = P.x; mkZ = P.z; marks(); mkRev++; } hud.compass(bearing(), mkOut, mkRev); }
      else hud.compass(null);
      if ((tick -= dt) > 0) return;
      tick = .1;
      chips(dir);
      card(dt);
      oreStep();
    };
    // курс: 0 — север (−Z), по часовой (В — +X)
    const bearing = () => { const y = st.rig?.yaw || 0; return ((-y) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); };
    const MK = [];   // метки полосы компаса (дом, вещи после нокаута, точки атласа) — объекты переиспользуются
    const mk = (i, x, z, ic) => { const m = MK[i] || (MK[i] = { a: 0, ic: '', far: false }); const dx = x - P.x, dz = z - P.z; m.a = Math.atan2(dx, -dz); m.ic = ic; m.far = dx * dx + dz * dz > 400 * 400; return m; };
    let mkOut = [], mkT = 0, mkX = NaN, mkZ = NaN, mkRev = 0;
    function marks(){
      let n = 0;
      const h = X.home?.(); if (h) mk(n++, h.x, h.z, '🏠');
      const D = st.lastDeath; if (D && D.drop && performance.now() - D.t < 300000) mk(n++, D.x, D.z, '💀');
      const extra = X.markers?.(); if (extra) for (let i = 0; i < extra.length && n < 12; i++) mk(n++, extra[i].x, extra[i].z, extra[i].ic);
      if (mkOut.length !== n) mkOut = MK.slice(0, n);
      return mkOut;
    }
    // ── строки: время, координаты, глубина, руда ──
    function chips(dir){
      const R = st.R, V = VX(), I = E().info;
      if (X.on('time')) { const tm = R?.lighting?.time ?? 12, k = Math.floor(tm * 6) * 1000 + (st.meta?.day | 0); if (k !== keyOf.time) { keyOf.time = k; hud.chip('time', tm >= 5.6 && tm < 18.8 ? '☀️' : '🌙', I.clock(tm) + ' · день ' + (st.meta?.day | 0 || 1), 1); } } else { hud.hide('time'); keyOf.time = -1; }
      if (dir) {
        const x = Math.floor(P.x), z = Math.floor(P.z), si = ((Math.round(bearing() / (Math.PI / 4)) % 8) + 8) % 8;
        if (x !== keyOf.x || z !== keyOf.z || si !== keyOf.side) { keyOf.x = x; keyOf.z = z; keyOf.side = si; hud.chip('xz', '🧭', I.SIDES[si] + ' · X ' + x + ' · Z ' + z, 2); }
      } else { hud.hide('xz'); keyOf.x = NaN; }
      if (X.on('depth')) { const y = Math.floor(P.y); if (y !== keyOf.y) { keyOf.y = y; hud.chip('y', '⛏', 'Y ' + y + ' · ' + layerOf(y, V.SEA), 3); } } else { hud.hide('y'); keyOf.y = -999; }
      if (X.on('ore')) {
        const b = oreBest;
        if (b && b.v) {
          const L = g.lookDir?.() || { x: 0, z: -1 }, dx = b.x + .5 - P.x, dz = b.z + .5 - P.z, dy = b.y - Math.floor(P.y), d = Math.round(Math.hypot(dx, b.y + .5 - P.y - 1, dz));
          const a = I.turn(dx, dz, L.x, L.z), dyq = dy > 1 ? dy : dy < -1 ? dy : 0;
          if (b.id !== keyOf.oreId || d !== keyOf.oreD || a !== keyOf.oreA || dyq !== keyOf.oreDy) {
            keyOf.oreId = b.id; keyOf.oreD = d; keyOf.oreA = a; keyOf.oreDy = dyq; keyOf.oreSt = 2;
            hud.chip('ore', ORE[V.blocks[b.id]?.name]?.[1] || '💠', (V.blocks[b.id]?.title || 'руда') + ' · ' + d + ' бл. ' + I.ARROWS[a] + (dyq > 0 ? ' выше ' + dyq : dyq < 0 ? ' ниже ' + (-dyq) : ''), 4);
          }
        } else { const s = scan && (scan.done || scan.n > 0) ? 1 : 0; if (keyOf.oreSt !== s) { keyOf.oreSt = s; keyOf.oreId = -1; hud.chip('ore', '💠', s ? 'руды рядом нет' : 'ищу руду…', 4); } }
      } else { hud.hide('ore'); keyOf.oreSt = -1; keyOf.oreId = -1; scan = null; oreBest = null; }
    }
    // ── рудоискатель: куб 33³ вокруг игрока, по ~110 столбцов за раз (прямо из массива чанка), самая ценная — ближайшая ──
    function oreStep(){
      if (!X.on('ore') || !oreV) return;
      const W = st.W, R = 16;
      // новый обход: прошлый закончился 1,5 с назад (по тактам игры, не по часам) или ушёл от его середины дальше 4 блоков
      if (!scan) { scan = { ox: 0, oy: 0, oz: 0, i: 0, n: 0, age: 0, done: true, fresh: true, b: { v: 0, d2: 0, x: 0, y: 0, z: 0, id: 0 } }; FOUND.v = 0; }
      const moved = scan.fresh ? 99 : Math.abs(P.x - scan.ox) + Math.abs(P.z - scan.oz) + Math.abs(P.y - scan.oy);
      scan.age += .1;
      if (moved > (scan.done ? 4 : 10) || (scan.done && scan.age > 1.5)) {
        if (moved >= 10) FOUND.v = 0;   // ушёл далеко — старое не показывать
        scan.ox = Math.floor(P.x); scan.oy = Math.floor(P.y); scan.oz = Math.floor(P.z); scan.i = 0; scan.age = 0; scan.done = false; scan.fresh = false; scan.b.v = 0;
      }
      if (scan.done) return;
      const N = (2 * R + 1) * (2 * R + 1), y0 = Math.max(1, scan.oy - R), y1 = Math.min(VX().H - 1, scan.oy + R), B = scan.b;
      for (let k = 0; k < 110 && scan.i < N; k++, scan.i++) {
        const x = scan.ox - R + (scan.i % (2 * R + 1)), z = scan.oz - R + Math.floor(scan.i / (2 * R + 1));
        const c = W.chunk(x >> 4, z >> 4); if (!c || !c.gen || !c.ids) continue;
        const base = ((x & 15) << 11) | ((z & 15) << 7), ids = c.ids, top = Math.min(y1, c.maxY);
        for (let y = y0; y <= top; y++) {
          const t = ids[base | y] & 0xfff, v = t < oreV.length ? oreV[t] : 0; if (!v) continue;
          const d2 = (x - scan.ox) * (x - scan.ox) + (y - scan.oy) * (y - scan.oy) + (z - scan.oz) * (z - scan.oz);
          if (v > B.v || (v === B.v && d2 < B.d2)) { B.v = v; B.d2 = d2; B.x = x; B.y = y; B.z = z; B.id = t; }
        }
      }
      // нашёл — сразу (первое найденное уточнится к концу обхода); обход кончился — итог
      if (scan.i >= N) { scan.done = true; scan.age = 0; scan.n++; Object.assign(FOUND, B); }
      else if (!FOUND.v && B.v) Object.assign(FOUND, B);
      oreBest = FOUND.v ? FOUND : null;
    }
    // ── лупа: карточка «что под прицелом» ──
    let tgtN = 0, has = false;   // номер цели (растёт при смене) и есть ли цель
    function card(dt){
      if (!X.on('target')) { if (cardShown !== null) { hud.card(null); cardShown = null; } return; }
      const touch = !!g.touch?.(), now = performance.now();
      if (targetChanged()) { tgtN++; cardKeyAt = now; }
      if (!has) { if (cardShown !== null && now - cardLostAt > 500) { hud.card(null); cardShown = null; } return; }   // ушёл с цели — карточка ещё полсекунды (не мигает)
      cardLostAt = now;
      if (touch && now - cardKeyAt < 400 && cardShown !== tgtN) return;   // телефон: палец задержался на том же — тогда показать
      if (cardShown !== tgtN) { cardWant = tgtN; build(); cardShown = tgtN; }
      else liveLine();
      hud.card(REC);
    }
    // цель поменялась? блок (место, значение, лёд, что в руке) или существо — сравнение полей, без строк
    function targetChanged(){
      const m = st.mobHit, h = m ? null : st.hit, s = P.inv[P.sel], tool = s ? s.id : '';
      has = !!(m || h);
      if (m) { if (T.mob === m) return false; T.mob = m; T.v = -1; return true; }
      if (!h) { if (T.mob === null && T.v === -2) return false; T.mob = null; T.v = -2; return true; }
      if (T.mob === null && h.x === T.x && h.y === T.y && h.z === T.z && h.v === T.v && !!h.ice === T.ice && tool === T.tool) return false;
      T.mob = null; T.x = h.x; T.y = h.y; T.z = h.z; T.v = h.v; T.ice = !!h.ice; T.tool = tool;
      return true;
    }
    function build(){
      const V = VX(), m = st.mobHit;
      REC.key = cardWant; REC.lines.length = 0; REC.drops.length = 0; REC.live = ''; REC.liveCls = ''; REC.sub = ''; REC.icon = ''; REC.emo = '';
      if (m) {
        const M = window.KubomirEnts?.MOBS?.[m.type] || {};
        REC.emo = { cow: '🐄', pig: '🐖', chicken: '🐔', zombie: '🧟', slime: '🟩' }[m.type] || '🐾';
        REC.name = M.title || m.type;
        REC.lines.push([M.passive ? 'Мирное существо' : 'Опасно: бьёт, если подойти', M.passive ? 'ok' : 'bad']);
        for (const d of M.drops || []) if (V.item(d[0]) && REC.drops.length < 4) REC.drops.push(V.icon(d[0], 40));
        liveLine();
        return;
      }
      const h = st.hit, b = h.ice ? V.blocks[V.ID.ice] : V.blocks[h.v & 0xfff], s = P.inv[P.sel], toolId = s ? s.id : '';
      const iname = b.name === 'door_oak' ? 'door' : b.name === 'furnace_lit' ? 'furnace' : b.name;
      if (V.item(iname)) REC.icon = V.icon(iname, 40); else REC.emo = '🧱';
      REC.name = h.ice ? 'Лёд на воде' : b.title || b.name;
      if (st.creative) REC.lines.push(['🎨 Творчество: ломается сразу', 'ok']);
      else if (b.hard < 0 && !h.ice) REC.lines.push(['Не сломать', 'bad']);
      else {
        const need = b.tool ? (b.tier > 1 ? TIER[b.tier] + ' ' : '') + (TOOL[b.tool] || b.tool) + (b.tier > 1 ? ' или лучше' : '') : 'рукой',
          drop = g.canHarvestTool?.(b, toolId) ?? true, it = toolId ? V.item(toolId) : null, right = !b.tool || (it?.tool && it.tool.kind === b.tool),
          t = g.breakTime ? g.breakTime(b) : b.hard;
        const secs = t < 10 ? (Math.round(t * 10) / 10).toFixed(1).replace('.', ',') : String(Math.round(t));   // по-русски — запятая
        REC.lines.push([(b.tool ? '⛏ ' : '✋ ') + need + ' · ' + secs + ' с' + (h.ice ? '' : !drop ? ' · ничего не выпадет' : !right ? ' · медленно' : ''), h.ice || (drop && right) ? 'ok' : !drop ? 'bad' : 'warn']);
        if (!h.ice) {
          const ex = V.DROPS?.[b.name] || [];
          let rep = false; for (const e of ex) { if (V.item(e[0]) && REC.drops.length < 4) REC.drops.push(V.icon(e[0], 40)); if (e[3] && e[1] >= 1) rep = true; }
          if (!rep && b.drop && V.item(b.drop) && REC.drops.length < 4) REC.drops.unshift(V.icon(b.drop, 40));
        }
      }
      if (Array.isArray(b.info)) for (const t of b.info.slice(0, 2)) REC.lines.push([String(t).slice(0, 80), '']);   // строки мода (info)
      liveLine();
    }
    // живая строка: сердечки существа, что в сундуке, что плавит печь
    function liveLine(){
      const V = VX(), m = st.mobHit;
      if (m) { const M = window.KubomirEnts?.MOBS?.[m.type] || {}, mx = M.hp || 10, n = Math.max(0, Math.ceil(m.hp || 0)); REC.live = '❤ ' + n + ' / ' + mx; REC.liveCls = n <= mx / 3 ? 'bad' : ''; return; }
      const h = st.hit; if (!h || h.ice) { REC.live = ''; return; }
      const b = V.blocks[h.v & 0xfff];
      if (b.ui === 'chest') { const t = st.W.tile(h.x, h.y, h.z); let n = 0; if (t?.items) for (const s of t.items) if (s) n++; REC.live = '📦 занято ' + n + ' из 27'; REC.liveCls = ''; }
      else if (b.ui === 'furnace') { const t = st.W.tile(h.x, h.y, h.z); REC.live = t && t.in ? '🔥 плавит: ' + (V.item(t.in.id)?.title || t.in.id) + (t.burn > 0 ? '' : ' (нет огня)') : t && t.out ? '✅ готово: ' + (V.item(t.out.id)?.title || t.out.id) + ' ×' + t.out.n : 'пустая'; REC.liveCls = t && t.in && !(t.burn > 0) ? 'warn' : ''; }
      else REC.live = '';
    }
    // ── сытость: сколько вернёт еда в руке (в половинках куриной ножки); hudUpdate игры рисует призрачные ножки ──
    function foodGhost(){
      let gh = 0;
      if (!st.creative && !P.dead && P.food < 20) {
        const V = VX(), s = P.inv[P.sel], it = s && V.item(s.id), o = !it?.food && P.off ? V.item(P.off.id) : null, fd = it?.food || o?.food;
        if (fd) gh = Math.max(0, fd.h | 0);
      }
      st.foodGhost = gh;
    }
    f.state = () => ({ ore: oreBest ? { ...oreBest } : null, scan: scan ? { i: scan.i, done: scan.done } : null, card: cardShown, rec: { ...REC, lines: REC.lines.slice(), drops: REC.drops.length }, hud: !!hud });
    // для проверок: карточка лупы для этой цели (тем же кодом, что и на экране)
    f._card = (hit, mob) => { st.hit = hit; st.mobHit = mob || null; targetChanged(); tgtN++; cardWant = tgtN; build(); return REC; };
    return f;
  });
})();

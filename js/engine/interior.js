// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — интерьеры зданий по зерну: этажи, комнаты, коридор, лифт, двери, окна, мебель по типу здания
// ═══════════════════════════════════════
// Владелец 15.10.2026: «в городе в каждое здание можно заходить?» — да. Здание = стабильный id (+ seed) и тип → ПЛАН (чистые
// функции: у всех игроков одинаковый, без сети) → ПОСТРОЙКА ОДНОГО ЭТАЖА по требованию (подошёл к двери — первый этаж,
// приехал лифтом — этот этаж), снос, когда далеко. Никогда не весь небоскрёб сразу. Мебель этажа склеивается (ctx.merge),
// двери — одна InstancedMesh на этаж (открыть/закрыть = матрица). Узоры — из генератора уровней Backrooms (только чтение):
// Furnish — мебель по назначению комнаты и «острова» столов, резерв мест (вещи не налезают друг на друга); Doors — виды дверей
// и состояния (закрыта / заперта / открыта) с правилами доступа; Lift — кнопка на каждом этаже; Building — номер вещи = здание +
// этаж + комната (стабильный).
//
// Здание b (таблица зданий зоны): { id, seed?, type (office | apartment | shop | cafe | hotel | service | public | factory |
//   parking | house), sub (school | hospital | police | fire | bank | hall | court | gym…), x, z, w, d, h (верх основного яруса),
//   tiers: [{ w, d, h }] (ярусы выше — по центру), base0 (высота 1-го этажа; по умолчанию 3,2), door: { side n|s|e|w, at, w },
//   special: { [этаж]: вид комнаты }, roofKind: '' | 'pool' | 'view', custom (свой интерьер везде) | customFloors: { [этаж]: true } }
// План:  E.interior.plan(b) → { n, fh, base0, front, core, tiers, roof } · floorY(P, k) · floorPlan(b, k) → { rooms, walls, furniture, doors,
//   landing, ceiling } (координаты — мировые). Постройка: E.interior.mount(ctx, b, k) → { dispose, doors, toggle(door) };
//   E.interior.roofMount(ctx, b) — крыша (перила, будка лифта, бассейн). Оболочка (тела стен со входом) — E.interior.shell(b).
// ctx: { R, ph, merge(R, group)?, item(it) → h, unitem(h), seat(sp) → h, unseat(h), access(door) → true | 'причина', glass?, toast?, custom?(b, k, floorPlan, ctx) }.
// Двери: { id, kind (wood | glass | metal | bars | vault | shutter), open, locked, room, x, y, z, yaw, w } — правила доступа (РП: полиция
// открывает камеры, кассир — хранилище) — ctx.access; по умолчанию запертое не открывается.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const FH = 3.2, TW = .3, PI = Math.PI;

  // ── Зерно: FNV + mulberry32 (одинаково в браузере и в node) ──
  const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  function rngOf(b, k, salt){
    let a = hashStr(`${b.seed || b.id}|${k}|${salt}`);
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── Канон: вход — у +v («перед»), u — вправо. Перевод в мир по стороне входа ──
  const ROT = { s: 0, n: PI, e: PI / 2, w: -PI / 2 };
  function frame(b){
    const side = b.door?.side || 's', cx = b.x, cz = b.z;
    const W = side === 'e' || side === 'w' ? b.d : b.w, D = side === 'e' || side === 'w' ? b.w : b.d;
    const toW = (u, v) => side === 's' ? [cx + u, cz + v] : side === 'n' ? [cx - u, cz - v] : side === 'e' ? [cx + v, cz - u] : [cx - v, cz + u];
    const at = b.door?.at || 0, doorU = side === 's' || side === 'w' ? at : -at;   // где вход — в каноне (u)
    return { side, W, D, toW, rot: ROT[side], cx, cz, doorU, uIsX: side === 's' || side === 'n' };
  }

  // ── План здания ──
  function plan(b){
    const fh = b.fh || FH, base0 = b.base0 || fh;
    const tiers = [{ w: b.w, d: b.d, top: b.h }, ...(b.tiers || []).map(t => ({ w: t.w, d: t.d, top: t.h }))];
    const top = tiers[tiers.length - 1].top;
    const n = top <= base0 + .5 ? 1 : 1 + Math.max(0, Math.floor((top - base0 + .05) / fh));
    const F = frame(b);
    // лифт — у задней стены самого узкого яруса, по центру (внутри всех ярусов)
    let minW = Infinity, minD = Infinity;
    for (const t of tiers) { const tw = F.side === 'e' || F.side === 'w' ? t.d : t.w, td = F.side === 'e' || F.side === 'w' ? t.w : t.d; minW = Math.min(minW, tw); minD = Math.min(minD, td); }
    const core = n > 1 ? { u: 0, v: -minD / 2 + TW + 1.3, w: 2.4, d: 2.2 } : null;
    return { id: b.id, n, fh, base0, front: F.side, core, tiers, top, roof: n > 1 && b.roofKind !== 'none' };
  }
  const floorY = (P, k) => (k ? P.base0 + (k - 1) * P.fh : 0);
  const floorH = (P, k) => (k ? P.fh : P.base0);
  // ярус этажа: первый, чей верх выше середины этажа
  function tierOf(P, k){ const y = floorY(P, k) + floorH(P, k) / 2; return P.tiers.find(t => t.top > y) || P.tiers[P.tiers.length - 1]; }

  // ── Вид этажа по типу здания (k — номер этажа, 0 — первый) ──
  function floorKind(b, k, r){
    if (b.special && b.special[k]) return b.special[k];
    const t = b.type, s = b.sub || '';
    if (k === 0) {
      if (t === 'office') return 'lobby';
      if (t === 'hotel') return 'hotel_lobby';
      if (t === 'apartment') return b.shops ? 'shop' : 'entry';
      if (t === 'shop') return s === 'pharmacy' ? 'pharmacy' : s === 'books' ? 'books' : 'shop';
      if (t === 'cafe') return 'cafe';
      if (t === 'service') return s === 'gym' ? 'gym' : 'garage';
      if (t === 'factory') return 'factory';
      if (t === 'parking') return 'parking';
      if (t === 'house') return 'flat_open';
      if (t === 'public') return { school: 'classes', hospital: 'wards', police: 'police', fire: 'firehall', bank: 'bank', hall: 'cityhall', court: 'court' }[s] || 'offices';
      return 'hall';
    }
    if (t === 'office' || (t === 'service' && s === 'gym')) return r() < .55 ? 'office_open' : 'offices';
    if (t === 'hotel') return 'hotel_rooms';
    if (t === 'apartment' || t === 'shop' || t === 'cafe' || t === 'house') return 'flats';
    if (t === 'public') return { school: 'classes', hospital: 'wards', police: 'offices', hall: 'offices' }[s] || 'offices';
    if (t === 'factory') return 'factory';
    return 'offices';
  }
  const OPEN = new Set(['lobby', 'hotel_lobby', 'entry', 'shop', 'pharmacy', 'books', 'cafe', 'gym', 'garage', 'factory', 'parking', 'office_open', 'flat_open', 'skycafe', 'hall', 'firehall', 'bank', 'cityhall', 'court']);

  // ── План этажа: комнаты, перегородки с проёмами, двери, мебель (в каноне, потом — в мир) ──
  // Коридор — вдоль длинной стороны: узкий и глубокий этаж — коридор от входа к лифту (комнаты слева L и справа R), широкий —
  // коридор поперёк, прямо перед лифтом (комнаты к улице F и по бокам лифта B). У каждой комнаты — своя система (a — вдоль стены
  // с дверью, b — вглубь от двери): мебель ставится одинаково в любой комнате любого здания.
  function floorPlan(b, k){
    const P = plan(b), F = frame(b), r = rngOf(b, k, 'floor'), y = floorY(P, k), fh = floorH(P, k);
    const tier = tierOf(P, k), tw = F.uIsX ? tier.w : tier.d, td = F.uIsX ? tier.d : tier.w;
    const U0 = -tw / 2 + TW, U1 = tw / 2 - TW, V0 = -td / 2 + TW, V1 = td / 2 - TW;
    let kind = floorKind(b, k, r);
    if (!OPEN.has(kind) && (U1 - U0 < 8.4 || V1 - V0 < 7.6)) kind = { flats: 'flat_open', hotel_rooms: 'flat_open' }[kind] || 'office_open';   // тесно — один зал
    const custom = !!(b.custom || b.customFloors?.[k]);
    const out = { id: `${b.id}:${k}`, b: b.id, k, y, fh, kind, custom, tier: { w: tier.w, d: tier.d }, rect: { U0, U1, V0, V1 }, rooms: [], walls: [], doors: [], furniture: [], windows: [], core: P.core, landing: null, F };
    const core = P.core;
    if (core) out.landing = { u: core.u, v: core.v + core.d / 2 + 1.1, yaw: 0 };
    if (OPEN.has(kind)) out.rooms.push({ id: 'r1', kind, u0: U0, u1: U1, v0: V0, v1: V1 });
    else {
      const cw = 2.2, wide = U1 - U0 > V1 - V0 + 2;
      const roomKind = { offices: 'office_room', hotel_rooms: 'hotel_room', flats: 'flat', classes: 'classroom', wards: 'ward', police: 'police_room' }[kind] || 'office_room';
      let n = 0;
      const mkRoom = (side, u0, u1, v0, v1, idx = 1) => {
        n++;
        let rk = roomKind;
        if (kind === 'offices' && n === 2) rk = 'meeting';
        if (kind === 'police' && n <= 2) rk = 'cell';
        if (b.sub === 'hall' && n === 1) rk = 'mayor';
        if (b.sub === 'bank' && n === 1) rk = 'vault';
        if (side === 'B' && (v1 - v0 < 3 || u1 - u0 < 3)) rk = kind === 'flats' || kind === 'hotel_rooms' ? 'bath' : 'storage';
        const q = { id: 'r' + n, kind: rk, side, u0, u1, v0, v1, first: idx === 0 };
        // дверь — в стене к коридору, место — по зерну
        if (side === 'L' || side === 'R') q.door = { axis: 'v', u: side === 'L' ? u1 : u0, v: Math.max(v0 + .9, Math.min(v1 - .9, v0 + .9 + r() * (v1 - v0 - 1.8))), w: 1.1 };
        else q.door = { axis: 'u', v: side === 'F' ? v0 : v1, u: Math.max(u0 + .9, Math.min(u1 - .9, u0 + .9 + r() * (u1 - u0 - 1.8))), w: 1.1 };
        out.rooms.push(q);
      };
      const split = (a0, a1, f) => { let a = a0, i = 0; while (a < a1 - 2.6) { const len = 3.6 + Math.floor(r() * 4) * .8, e = a1 - (a + len) < 2.6 ? a1 : a + len; f(a, e, i++); a = e; } };
      const cu0 = core ? core.u - core.w / 2 - .1 : -cw / 2, cu1 = core ? core.u + core.w / 2 + .1 : cw / 2;
      if (!wide) {
        // глубокий и узкий: коридор от входа к лифту, комнаты слева и справа
        out.rooms.push({ id: 'cor', kind: 'corridor', u0: -cw / 2, u1: cw / 2, v0: V0, v1: V1, axis: 'v' });
        split(V0, V1, (a, e) => mkRoom('L', U0, -cw / 2, a, e));
        split(V0, V1, (a, e) => mkRoom('R', cw / 2, U1, a, e));
      } else if (V1 - V0 < 13) {
        // широкий, неглубокий: коридор поперёк прямо перед лифтом; комнаты — к улице и по бокам лифта
        const cv0 = core ? core.v + core.d / 2 : V0 + 3.2, cv1 = cv0 + cw;
        out.rooms.push({ id: 'cor', kind: 'corridor', u0: U0, u1: U1, v0: cv0, v1: cv1, axis: 'u' });
        split(U0, U1, (a, e, i) => mkRoom('F', a, e, cv1, V1, i));
        if (cv0 - V0 > 2.4) { split(U0, cu0, (a, e, i) => mkRoom('B', a, e, V0, cv0, i)); split(cu1, U1, (a, e, i) => mkRoom('B', a, e, V0, cv0, i)); }
      } else {
        // широкий и глубокий (отель, офисная башня): коридор поперёк посередине, к лифту — короткий проход; комнаты с двух сторон
        const mid = (V0 + V1) / 2 + .6, c0 = mid - cw / 2, c1 = mid + cw / 2, sv0 = core ? core.v + core.d / 2 : V0;
        out.rooms.push({ id: 'cor', kind: 'corridor', u0: U0, u1: U1, v0: c0, v1: c1, axis: 'u' });
        if (core && c0 - sv0 > .1) out.rooms.push({ id: 'cor2', kind: 'corridor', u0: -cw / 2, u1: cw / 2, v0: sv0, v1: c0, axis: 'v' });
        split(U0, U1, (a, e, i) => mkRoom('F', a, e, c1, V1, i));
        split(U0, core ? cu0 : U1, (a, e, i) => mkRoom('B', a, e, V0, c0, i));
        if (core) split(cu1, U1, (a, e, i) => mkRoom('B', a, e, V0, c0, i));
      }
      // перегородки: стена с дверью (проём + перемычка), между соседними комнатами
      const KD = { cell: 'bars', vault: 'vault', flat: 'wood', hotel_room: 'wood', mayor: 'wood', meeting: 'glass', office_room: 'glass', classroom: 'wood', police_room: 'glass', storage: 'metal', bath: 'wood' };
      for (const q of out.rooms) {
        if (q.kind === 'corridor') continue;
        const d = q.door, lo = (d.axis === 'v' ? d.v : d.u) - d.w / 2, hi = lo + d.w;
        if (d.axis === 'v') out.walls.push({ u0: d.u, v0: q.v0, u1: d.u, v1: lo }, { u0: d.u, v0: hi, u1: d.u, v1: q.v1 }, { u0: d.u, v0: lo, u1: d.u, v1: hi, y0: 2.25 });
        else out.walls.push({ u0: q.u0, v0: d.v, u1: lo, v1: d.v }, { u0: hi, v0: d.v, u1: q.u1, v1: d.v }, { u0: lo, v0: d.v, u1: hi, v1: d.v, y0: 2.25 });
        if ((q.side === 'L' || q.side === 'R') && q.v1 < V1 - .05) out.walls.push({ u0: q.u0, v0: q.v1, u1: q.u1, v1: q.v1 });
        if ((q.side === 'F' || q.side === 'B') && q.u1 < U1 - .05) out.walls.push({ u0: q.u1, v0: q.v0, u1: q.u1, v1: q.v1 });
        if ((q.side === 'F' || q.side === 'B') && q.first && q.u0 > U0 + .05) out.walls.push({ u0: q.u0, v0: q.v0, u1: q.u0, v1: q.v1 });   // начало ряда — у прохода к лифту
        const dk = KD[q.kind];
        if (dk) out.doors.push({ id: `${b.id}:${k}:${q.id}`, kind: dk, room: q.id, roomKind: q.kind, u: d.axis === 'v' ? d.u : (lo + hi) / 2, v: d.axis === 'v' ? (lo + hi) / 2 : d.v, w: d.w, axis: d.axis, side: q.side, open: false, locked: dk === 'bars' || dk === 'vault' });
      }
    }
    if (!custom) furnish(out, b, r);
    return finish(out, F, b, P);
  }
  // система комнаты: начало — середина стены с дверью, b — вглубь, a — вдоль (a = поворот b на 90°)
  const BV = { L: [-1, 0], R: [1, 0], F: [0, 1], B: [0, -1] };
  function roomFrame(q){
    const bv = BV[q.side] || [0, -1], av = [bv[1], -bv[0]];
    const ou = q.side === 'L' ? q.u1 : q.side === 'R' ? q.u0 : (q.u0 + q.u1) / 2, ov = q.side === 'F' ? q.v0 : q.side === 'B' ? q.v1 : q.side ? (q.v0 + q.v1) / 2 : q.v1;
    const A = q.side === 'L' || q.side === 'R' ? q.v1 - q.v0 : q.u1 - q.u0, Bd = q.side === 'L' || q.side === 'R' ? q.u1 - q.u0 : q.v1 - q.v0;
    return { A, B: Bd, to: (a, b2) => [ou + a * av[0] + b2 * bv[0], ov + a * av[1] + b2 * bv[1]], yaw: phi => { const du = Math.cos(phi) * bv[0] + Math.sin(phi) * av[0], dv = Math.cos(phi) * bv[1] + Math.sin(phi) * av[1]; return Math.atan2(du, dv); } };
  }

  // ── Мебель по назначению: простые детали (коробки, цилиндры, шары); места — сесть / лечь ──
  // Резерв (как ReserveDeskPods в Backrooms): занятые круги — новое не ставится поверх; проход к лифту и к дверям — свободен
  function furnish(fp, b, r){
    const L = fp.furniture, res = [], core = fp.core;
    const free = (u, v, rad) => !res.some(q => Math.hypot(q.u - u, q.v - v) < q.r + rad) && !(core && Math.abs(u - core.u) < core.w / 2 + rad + .2 && v > core.v - core.d / 2 - rad && v < core.v + core.d / 2 + 2.2 + rad);
    const take = (u, v, rad) => res.push({ u, v, r: rad });
    const add = (o, rad = 0) => { if (rad && !free(o.u, o.v, rad)) return false; L.push(o); if (rad) take(o.u, o.v, rad); return true; };
    const pick = a => a[Math.floor(r() * a.length)];
    if (fp.k === 0) take(fp.F.doorU, fp.rect.V1 - .6, 2.2);
    for (const q of fp.rooms) if (q.door) { const fr = roomFrame(q), [u, v] = fr.to(q.door.axis === 'v' ? q.door.v - (q.v0 + q.v1) / 2 : 0, .7); take(q.door.axis === 'v' ? q.door.u + (q.side === 'L' ? -.8 : .8) : q.door.u, q.door.axis === 'u' ? q.door.v + (q.side === 'F' ? .8 : -.8) : q.door.v, .9); void u; void v; }
    for (const q of fp.rooms) {
      const { u0, u1, v0, v1 } = q, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, W = u1 - u0, D = v1 - v0;
      if (q.side) {   // комната у коридора: в своей системе (a, b)
        const fr = roomFrame(q), A = fr.A, Bd = fr.B;
        const put = (o, a, b2, phi = 0, rad = 0) => { const [u, v] = fr.to(a, b2); return add({ ...o, u, v, yaw: fr.yaw(phi) }, rad); };
        switch (q.kind) {
          case 'flat': case 'hotel_room': {
            const hotel = q.kind === 'hotel_room';
            put({ t: 'bed', c: pick(['#93c5fd', '#fca5a5', '#fde68a', '#a7f3d0', '#c4b5fd']) }, hotel ? 0 : -A / 2 + 1.1, Bd - 1.4, PI, 1.1);
            put({ t: 'nightstand' }, hotel ? 1.2 : -A / 2 + 2.25, Bd - .4, PI);
            if (hotel) { put({ t: 'nightstand' }, -1.2, Bd - .4, PI); put({ t: 'tv' }, 0, .25, 0); put({ t: 'wardrobe' }, -A / 2 + .4, 1.5, PI / 2); }
            else {
              if (A > 3.8) put({ t: 'kitchen', len: Math.min(2.4, A - 2.6) }, A / 2 - 1.5, Bd - .45, PI);
              put({ t: 'table2', c: '#a16207', chairC: '#78350f' }, A > 4.4 ? 1 : 0, Bd * .45, 0, 1.2);
              if (A > 4.2) put({ t: 'sofa', c: pick(['#7c3aed', '#ea580c', '#0891b2', '#475569']) }, A / 2 - .55, 1.6, -PI / 2, 1);
            }
            put({ t: 'rug', w: Math.min(2.4, A - 1), d: Math.min(1.8, Bd - 1.6), c: pick(['#fde68a', '#fecaca', '#bfdbfe', '#ddd6fe']) }, 0, Bd * .5);
            break; }
          case 'office_room': case 'police_room': {
            const two = A > 4.6;   // широкий кабинет — два стола
            put({ t: 'desk' }, two ? -1.1 : 0, Bd - 1.3, PI, 1); if (two) put({ t: 'desk' }, 1.1, Bd - 1.3, PI, 1);
            put({ t: 'cabinet' }, A / 2 - .35, 1.3, -PI / 2, .5); put({ t: 'plant' }, -A / 2 + .45, .6);
            if (Bd > 4.6) put({ t: 'sofa', c: pick(['#475569', '#334155', '#7c2d12']) }, -A / 2 + .55, Bd / 2, PI / 2, 1.1);
            put({ t: 'rug', w: Math.min(2.6, A - 1.4), d: Math.min(2, Bd - 2.6), c: pick(['#cbd5e1', '#d6d3d1', '#bfdbfe', '#e7e5e4']) }, 0, Bd / 2 - .2);
            break; }
          case 'meeting': put({ t: 'meeting', len: Math.max(2, A - 2.4) }, 0, Bd / 2, PI / 2); put({ t: 'tv' }, 0, Bd - .1, PI); put({ t: 'plant' }, A / 2 - .5, .6); put({ t: 'cooler' }, -A / 2 + .5, Bd - .5); break;
          case 'classroom': {
            put({ t: 'board', len: Math.min(3, A - 1.2) }, 0, Bd - .08, PI); put({ t: 'desk' }, 0, Bd - 1.3, 0);
            for (let b2 = Bd - 2.8; b2 > .9; b2 -= 1.5) for (let a = -A / 2 + 1; a < A / 2 - .6; a += 1.4) put({ t: 'schooldesk' }, a, b2, PI);
            break; }
          case 'ward': for (let a = -A / 2 + 1.2; a < A / 2 - .8; a += 2.4) put({ t: 'bed', c: '#bfdbfe' }, a, Bd - 1.3, PI); put({ t: 'cabinet' }, -A / 2 + .3, .8, PI / 2); break;
          case 'cell': put({ t: 'bunk' }, 0, Bd - .6, PI / 2); break;
          case 'vault': put({ t: 'gold' }, 0, Bd - .6, PI); put({ t: 'safe' }, A / 2 - .6, Bd / 2, -PI / 2); break;
          case 'mayor': put({ t: 'desk', c: '#78350f' }, 0, Bd - 1.3, PI); put({ t: 'flag' }, -A / 2 + .5, Bd - .5, PI); put({ t: 'sofa', c: '#7f1d1d' }, 0, 1, 0); put({ t: 'npcspot', who: 'mayor' }, 0, Bd - .4, 0); break;
          case 'storage': for (let a = -A / 2 + .7; a < A / 2 - .4; a += 1.3) put({ t: 'crate' }, a, Bd - .7); break;
          case 'bath': put({ t: 'bath' }, 0, Bd - .55, PI); break;
          default: put({ t: 'desk' }, 0, Bd - 1.3, PI, 1);
        }
        continue;
      }
      switch (q.kind) {
        case 'corridor': {
          // дорожка по коридору (видно, куда идти) и цветы
          const runC = b.type === 'hotel' ? '#7f1d1d' : b.type === 'apartment' ? '#a16207' : b.type === 'public' ? '#1e3a8a' : '#64748b';
          add({ t: 'rug', u: cu, v: cv, w: q.axis === 'v' ? Math.min(1.3, W - .6) : Math.max(.5, W - 1), d: q.axis === 'v' ? Math.max(.5, D - 1) : Math.min(1.3, D - .6), c: runC }, 0);
          if (q.axis === 'v') for (let v = v0 + 2.5; v < v1 - 1; v += 6) add({ t: 'plant', u: u0 + .45, v }, .4); else for (let u = u0 + 2.5; u < u1 - 1; u += 6) add({ t: 'plant', u, v: v1 - .45 }, .4);
          break; }
        case 'lobby': case 'hotel_lobby': {
          add({ t: 'counter', u: cu - Math.min(4, W / 4), v: cv + D * .1, len: 4, yaw: 0, c: b.type === 'hotel' ? '#7c2d12' : '#1e3a8a' }, 2.4);
          add({ t: 'sofa', u: cu + Math.min(5, W / 4), v: cv - D * .1, yaw: PI / 2, c: pick(['#334155', '#7f1d1d', '#1e3a8a']) }, 1.4);
          add({ t: 'sofa', u: cu + Math.min(5, W / 4), v: cv + D * .22, yaw: PI / 2, c: pick(['#334155', '#475569']) }, 1.4);
          for (const s of [-1, 1]) add({ t: 'plant', u: s > 0 ? u1 - .8 : u0 + .8, v: v1 - 1.2 }, .6);
          if (b.type === 'office') for (let i = -1; i <= 1; i++) add({ t: 'turnstile', u: cu + i * 1.4, v: cv + D * .32 }, 0);
          add({ t: 'npcspot', u: cu - Math.min(4, W / 4), v: cv + D * .1 - 1.1, yaw: PI, who: b.type === 'hotel' ? 'porte' : 'admin' });
          break; }
        case 'entry': add({ t: 'mailboxes', u: u0 + .45, v: cv, yaw: PI / 2 }, 1); add({ t: 'plant', u: u1 - .8, v: v1 - 1.2 }, .6); add({ t: 'bench', u: u1 - .9, v: cv, yaw: -PI / 2 }, 1.2); break;
        case 'shop': case 'pharmacy': case 'books': {
          add({ t: 'counter', u: u0 + 1.6, v: v1 - 2.6, len: 3, yaw: PI / 2, c: q.kind === 'pharmacy' ? '#15803d' : q.kind === 'books' ? '#a16207' : '#1d4ed8' }, 1.8);
          const items = q.kind === 'pharmacy' ? ['#f8fafc', '#22c55e', '#f43f5e', '#38bdf8'] : q.kind === 'books' ? ['#b91c1c', '#1d4ed8', '#15803d', '#ca8a04', '#7c3aed'] : ['#ef4444', '#facc15', '#22c55e', '#3b82f6'];
          for (let u = u0 + 4; u < u1 - 1.2; u += 2.6) for (let v = v0 + 1.4; v < v1 - 3; v += 2.6) add({ t: 'shelf', u, v, len: 2, yaw: 0, items }, 1.1);
          add({ t: 'npcspot', u: u0 + .6, v: v1 - 2.6, yaw: PI / 2, who: 'seller' });
          break; }
        case 'cafe': case 'skycafe': {
          add({ t: 'counter', u: u0 + 1.4, v: cv, len: Math.min(6, D - 3), yaw: PI / 2, c: '#7c2d12' }, 1.6);
          for (let u = u0 + 4.4; u < u1 - 1.2; u += 3.4) for (let v = v0 + 2; v < v1 - 1.6; v += 3.2) add({ t: 'table2', u, v, c: '#f8fafc', chairC: '#b45309' }, 1.4);
          for (const s of [-1, 1]) add({ t: 'plant', u: u1 - .8, v: s > 0 ? v1 - .8 : v0 + .8 }, .6);
          add({ t: 'npcspot', u: u0 + .5, v: cv, yaw: PI / 2, who: 'barista' });
          break; }
        case 'gym': {
          for (let u = u0 + 2; u < u1 - 1.5; u += 2.4) add({ t: 'treadmill', u, v: v0 + 1.6, yaw: 0 }, 1);
          for (let u = u0 + 2.5; u < u1 - 2; u += 4) add({ t: 'bench', u, v: cv + .5, yaw: 0 }, 1.4);
          add({ t: 'mat', u: cu, v: v1 - 2.4, w: Math.min(8, W - 2), d: 2.6 }, 0);
          break; }
        case 'garage': case 'firehall': {
          for (let u = u0 + 3; u < u1 - 2; u += 5) add({ t: q.kind === 'firehall' ? 'truck' : 'car', u, v: cv, yaw: 0 }, 2.4);
          add({ t: 'shelf', u: u0 + .6, v: cv, len: Math.min(5, D - 2), yaw: PI / 2, items: ['#64748b', '#f59e0b', '#ef4444'] }, 0);
          break; }
        case 'factory': {
          for (let v = v0 + 2.5; v < v1 - 2; v += 4) add({ t: 'conveyor', u: cu, v, len: Math.max(4, W - 4), yaw: PI / 2 }, 0);
          for (let u = u0 + 1.6; u < u1 - 1; u += 3.2) add({ t: 'machine', u, v: v1 - 1.4, yaw: PI }, 1.2);
          for (let i = 0; i < 4; i++) add({ t: 'crate', u: u1 - 1.2, v: v0 + 1.2 + i * 1.3 }, .7);
          break; }
        case 'parking': for (let u = u0 + 2.2; u < u1 - 2; u += 3.2) add({ t: 'car', u, v: v0 + 3, yaw: 0, c: pick(['#ef4444', '#e5e7eb', '#2563eb', '#16a34a', '#111827']) }, 1.6); break;
        case 'office_open': {
          // «острова» по 4 стола (Backrooms TryBuildDeskPod) — сеткой, мимо лифта
          for (let u = u0 + 2.2; u < u1 - 2; u += 4.4) for (let v = v0 + 2.2; v < v1 - 1.8; v += 4) add({ t: 'deskpod', u, v }, 2.1);
          for (let i = 0; i < 3; i++) add({ t: 'cabinet', u: u0 + .45, v: v1 - 1 - i * 1.2, yaw: PI / 2 }, 0);
          add({ t: 'plant', u: u1 - .8, v: v1 - .8 }, .6); add({ t: 'cooler', u: u1 - .6, v: v0 + .8 }, .5);
          break; }
        case 'flat_open': {
          add({ t: 'bed', u: u0 + 1.1, v: v0 + 1.4, yaw: 0, c: pick(['#93c5fd', '#fca5a5', '#fde68a']) }, 1.2);
          add({ t: 'nightstand', u: u0 + 2.2, v: v0 + .45 }, 0);
          add({ t: 'kitchen', u: u1 - 2, v: v0 + .45, len: Math.min(2.4, W / 3) }, 0);
          add({ t: 'sofa', u: u1 - .6, v: cv + 1, yaw: -PI / 2, c: pick(['#7c3aed', '#ea580c', '#0891b2']) }, 1.2);
          add({ t: 'table2', u: cu, v: cv, c: '#a16207', chairC: '#78350f' }, 1.3);
          add({ t: 'tv', u: u1 - .15, v: cv + 1, yaw: -PI / 2 }, 0);
          add({ t: 'rug', u: cu, v: cv + 1, w: Math.min(3, W - 2), d: 2, c: pick(['#fde68a', '#fecaca', '#bfdbfe']) }, 0);
          break; }
        case 'hall': case 'cityhall': case 'court': case 'bank': case 'firehall2': {
          add({ t: 'counter', u: cu, v: v0 + 2, len: Math.min(8, W - 4), yaw: 0, c: '#78350f' }, 2.4);
          for (let u = u0 + 2; u < u1 - 1.5; u += 2.6) add({ t: 'bench', u, v: cv + 1.5, yaw: 0 }, 1.2);
          break; }
        default: for (let u = u0 + 2.2; u < u1 - 2; u += 4.4) add({ t: 'desk', u, v: cv, yaw: 0 }, 1.2);
      }
    }
  }

  // ── В мировые координаты; окна; дверь входа ──
  function finish(fp, F, b, P){
    const wp = (u, v) => F.toW(u, v), vw = (du, dv) => { const [x, z] = F.toW(du, dv); return [x - F.cx, z - F.cz]; };
    for (const q of fp.rooms) { const [ax, az] = wp(q.u0, q.v0), [bx, bz] = wp(q.u1, q.v1); q.x0 = Math.min(ax, bx); q.x1 = Math.max(ax, bx); q.z0 = Math.min(az, bz); q.z1 = Math.max(az, bz); }
    for (const w of fp.walls) { const [ax, az] = wp(w.u0, w.v0), [bx, bz] = wp(w.u1, w.v1); Object.assign(w, { x0: ax, z0: az, x1: bx, z1: bz }); }
    for (const d of fp.doors) {
      const [x, z] = wp(d.u, d.v), [axx, axz] = vw(d.axis === 'v' ? 0 : 1, d.axis === 'v' ? 1 : 0), iv = BV[d.side] || [0, 1], [ix, iz] = vw(iv[0], iv[1]);
      Object.assign(d, { x, z, y: fp.y, yaw: Math.atan2(axx, axz), ix, iz });   // yaw — вдоль стены; ix, iz — в комнату
    }
    for (const f of fp.furniture) { const [x, z] = wp(f.u, f.v); f.x = x; f.z = z; f.wyaw = (f.yaw || 0) + F.rot; }
    if (fp.landing) { const [x, z] = wp(fp.landing.u, fp.landing.v); fp.landing.x = x; fp.landing.z = z; fp.landing.wyaw = F.rot; }
    if (fp.core) { const [x, z] = wp(fp.core.u, fp.core.v); fp.coreW = { x, z, rot: F.rot }; }
    // окна по наружным стенам: середины пролётов 3,2 (как на фасаде); у входа 1 этажа — дверь
    const { U0, U1, V0, V1 } = fp.rect, bays = (a, c) => { const L = []; for (let s = Math.ceil((a + 1.2) / 3.2) * 3.2; s < c - 1.2; s += 3.2) L.push(s); return L; };
    for (const [side, fixed, a, c] of [['front', V1, U0, U1], ['back', V0, U0, U1], ['left', U0, V0, V1], ['right', U1, V0, V1]]) {
      for (const m of bays(a, c)) {
        const isDoor = fp.k === 0 && side === 'front' && Math.abs(m - F.doorU) < 1.7;
        if (fp.core && side === 'back' && Math.abs(m - fp.core.u) < 2) continue;
        const [x, z] = side === 'front' || side === 'back' ? wp(m, fixed) : wp(fixed, m);
        const alongU = side === 'front' || side === 'back';
        fp.windows.push({ x, z, side, door: isDoor, alongX: alongU === F.uIsX });
      }
    }
    fp.front = F.side; fp.n = P.n;
    return fp;
  }

  // ── Оболочка: тела наружных стен с проёмом входа (1 этаж) и плиты верхов ярусов; держат камеру снаружи ──
  function shell(b){
    const P = plan(b), out = [], hw = b.w / 2, hd = b.d / 2, t = TW, side = b.door?.side || 's', at = b.door?.at || 0, dw = b.door?.w || 2.4, dh = Math.min(2.9, P.base0 - .2), y00 = b.shellFrom || 0;   // shellFrom — первый этаж свой (стены — у него)
    const wall = (x, z, w, d, y0, y1) => { if (w > .05 && d > .05 && y1 - y0 > .05) out.push({ x, z, y: (y0 + y1) / 2, hx: w / 2, hy: (y1 - y0) / 2, hz: d / 2, cam: true }); };
    const H1 = P.tiers[0].top;
    for (const s of ['n', 's', 'e', 'w']) {
      const horiz = s === 'n' || s === 's', L = horiz ? b.w : b.d, cx = horiz ? b.x : b.x + (s === 'e' ? hw - t / 2 : -hw + t / 2), cz = horiz ? b.z + (s === 's' ? hd - t / 2 : -hd + t / 2) : b.z;
      const put = (a, c, y0, y1) => wall(horiz ? b.x + (a + c) / 2 : cx, horiz ? cz : b.z + (a + c) / 2, horiz ? c - a : t, horiz ? t : c - a, y0, y1);
      if (s === side && !y00) { put(-L / 2, at - dw / 2, 0, H1); put(at + dw / 2, L / 2, 0, H1); put(at - dw / 2, at + dw / 2, dh, H1); }
      else put(-L / 2, L / 2, y00, H1);
    }
    out.push({ x: b.x, z: b.z, y: H1 + .15, hx: hw + .15, hy: .15, hz: hd + .15, cam: false, roof: true });
    for (let i = 1; i < P.tiers.length; i++) {   // ярусы выше — тоже пустые внутри (этажи там — по лифту)
      const T = P.tiers[i], y0 = P.tiers[i - 1].top, y1 = T.top;
      for (const [x, z, w, d] of [[b.x, b.z - T.d / 2 + t / 2, T.w, t], [b.x, b.z + T.d / 2 - t / 2, T.w, t], [b.x - T.w / 2 + t / 2, b.z, t, T.d], [b.x + T.w / 2 - t / 2, b.z, t, T.d]]) wall(x, z, w, d, y0, y1);
      out.push({ x: b.x, z: b.z, y: y1 + .15, hx: T.w / 2 + .15, hy: .15, hz: T.d / 2 + .15, cam: false, roof: true });
    }
    return out;
  }

  // ═══ Постройка этажа ═══
  const WALL_C = { office: '#e5e7eb', apartment: '#f5efe6', hotel: '#fdf2e9', shop: '#f8fafc', cafe: '#fff7ed', service: '#eef2ff', public: '#f1f5f9', factory: '#d6d3d1', parking: '#d6d3d1', house: '#fef9ee' };
  const FLOOR_C = { lobby: '#e7e5e4', hotel_lobby: '#f5e6c8', entry: '#d6d3d1', shop: '#e5e7eb', pharmacy: '#ecfdf5', books: '#f5f0e6', cafe: '#c8956a', skycafe: '#c8956a', gym: '#475569', garage: '#9ca3af', firehall: '#9ca3af', factory: '#a8a29e', parking: '#6b7280', office_open: '#b6b0a6', offices: '#d6cfc2', hotel_rooms: '#b45309', flats: '#c8956a', flat_open: '#c8956a', classes: '#d6a77a', wards: '#e2e8f0', police: '#cbd5e1' };
  function mount(ctx, b, k){
    const { R, ph } = ctx, T = R.T, fp = floorPlan(b, k), y = fp.y, fh = fp.fh, F = fp.F;
    const g = new T.Group(); g.name = 'interior ' + fp.id; g.userData.interior = fp.id;
    const bodies = [], items = [], seats = [];
    const P = p => R.part(g, p);
    const body = (o, data) => { const c = ph.addBox({ tag: 'interior', ...o, data: { cam: false, floor: data?.floor || 'tile', ...(data || {}) } }); bodies.push(c); return c; };
    const wallC = b.interiorWall || WALL_C[b.type] || '#f1f5f9', floorC = FLOOR_C[fp.kind] || '#d6d3d1';
    const tier = fp.tier, hw = tier.w / 2, hd = tier.d / 2, cx = b.x, cz = b.z;
    // пол (на 1 этаже — чуть выше земли) и потолок (видно только снизу); светильники
    P({ s: 'box', x: cx, y: y + .04, z: cz, w: tier.w - .3, h: .08, d: tier.d - .3, c: floorC });
    if (k > 0) body({ x: cx, z: cz, y: y - .08, hx: hw, hy: .16, hz: hd }, { floor: fp.kind.startsWith('flat') || fp.kind === 'hotel_rooms' ? 'wood' : 'tile' });
    else body({ x: cx, z: cz, y: .04, hx: hw - .2, hy: .04, hz: hd - .2 }, { floor: 'tile' });
    const ceil = new T.Mesh(R.K.geo(`intCeil${tier.w}_${tier.d}`, () => new T.PlaneGeometry(tier.w - .3, tier.d - .3)), R.mat('#f8fafc'));
    ceil.rotation.x = PI / 2; ceil.position.set(cx, y + fh - .02, cz); g.add(ceil);   // лицом вниз: сверху (камера над этажом) не мешает
    body({ x: cx, z: cz, y: y + fh - .06, hx: hw, hy: .06, hz: hd });
    for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) P({ s: 'box', x: cx + i * tier.w / 4, y: y + fh - .06, z: cz + j * tier.d / 4, w: 1.2, h: .04, d: .5, m: R.glow('#fff8e1') });
    // наружные стены изнутри: простенки и окна (стекло), дверь входа
    const outer = (x, z, ax, isDoor) => {   // ax — стена идёт вдоль x
      const len = 3.2, wd = 1.8, sill = .9, wh = 1.5, dw = 2.2, dh = 2.6;
      const cw = (off, ww, hh, yy) => { P({ s: 'box', x: x + (ax ? off : 0), y: y + yy + hh / 2, z: z + (ax ? 0 : off), w: ax ? ww : .12, h: hh, d: ax ? .12 : ww, c: wallC }); };
      if (ax) z += z > cz ? -.2 : .2; else x += x > cx ? -.2 : .2;   // внутрь от наружной стены
      if (isDoor) { const a = (len - dw) / 2; for (const s of [-1, 1]) cw(s * (dw / 2 + a / 2), a, fh, 0); cw(0, dw, fh - dh, dh); return; }
      const a = (len - wd) / 2;
      for (const s of [-1, 1]) cw(s * (wd / 2 + a / 2), a, fh, 0);
      cw(0, wd, sill, 0); cw(0, wd, fh - sill - wh, sill + wh);
      P({ s: 'box', x, y: y + sill + wh / 2, z, w: ax ? wd : .05, h: wh, d: ax ? .05 : wd, m: ctx.glass || R.mat('#bfe8ff') });
    };
    for (const w of fp.windows) outer(w.x, w.z, w.alongX, w.door);
    // углы и простенки между пролётами — сплошной стеной (если пролёты не закрыли всё)
    for (const [x, z, w, d] of [[cx, cz - hd + .26, tier.w - .6, .12], [cx, cz + hd - .26, tier.w - .6, .12], [cx - hw + .26, cz, .12, tier.d - .6], [cx + hw - .26, cz, .12, tier.d - .6]]) P({ s: 'box', x, y: y + .3, z, w, h: .6, d, c: '#94a3b8' });   // плинтус-цоколь
    // перегородки (с проёмами дверей)
    for (const w of fp.walls) {
      const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0); if (len < .05) continue;
      const y0 = y + (w.y0 || 0), hh = (w.h || fh) - (w.y0 || 0) - .02, mx = (w.x0 + w.x1) / 2, mz = (w.z0 + w.z1) / 2, alongX = Math.abs(w.x1 - w.x0) > Math.abs(w.z1 - w.z0);
      P({ s: 'box', x: mx, y: y0 + hh / 2, z: mz, w: alongX ? len : .15, h: hh, d: alongX ? .15 : len, c: wallC });
      body({ x: mx, z: mz, y: y0 + hh / 2, hx: alongX ? len / 2 : .1, hy: hh / 2, hz: alongX ? .1 : len / 2 }, { cam: true });
    }
    // лифт: шахта, двери, кнопка; кнопка — окно этажей (ctx.lift)
    if (fp.core && fp.coreW) {
      const c = fp.core, [x, z] = F.toW(c.u, c.v), rotd = F.side === 'e' || F.side === 'w';
      P({ s: 'box', x, y: y + fh / 2, z, w: rotd ? c.d : c.w, h: fh - .05, d: rotd ? c.w : c.d, c: '#9ca3af' });
      // камера проходит сквозь шахту (выходишь из лифта — камера сзади, над шахтой; изнутри коробку не видно)
      body({ x, z, y: y + fh / 2, hx: (rotd ? c.d : c.w) / 2, hy: fh / 2, hz: (rotd ? c.w : c.d) / 2 }, { cam: false });
      const [fx, fz] = F.toW(c.u, c.v + c.d / 2 + .02), [bx, bz] = F.toW(c.u + .9, c.v + c.d / 2 + .05);
      P({ s: 'box', x: fx, y: y + 1.25, z: fz, w: rotd ? .04 : 1.4, h: 2.4, d: rotd ? 1.4 : .04, c: '#cbd5e1' });
      P({ s: 'box', x: bx, y: y + 1.25, z: bz, w: rotd ? .04 : .16, h: .22, d: rotd ? .16 : .04, m: R.glow('#38bdf8') });
      items.push(ctx.item({ x: fp.landing.x, y: y + 1.2, z: fp.landing.z, r: 1.6, prompt: () => `🛗 Лифт · ${k + 1} этаж`, act: () => ctx.lift?.(b, k) }));
    }
    // этаж — «комната»: пока ты здесь, камера ближе и круче сверху (потолок — лицом вниз, сверху не мешает; шахта лифта и стены
    // ниже луча камеры); крыши нет — пустой объект
    bodies.push(ph.addBox({ x: cx, z: cz, y: y + fh / 2, hx: hw - .35, hy: fh / 2 - .05, hz: hd - .35, trigger: true, tag: 'room', data: { room: fp.id, roof: { visible: true }, pitch: 1.1, minP: .9 } }));
    // мебель
    const yf = y + .08;   // верх пола (тело пола — тоже до y + 0,08): мебель и ковры стоят на нём, а не в нём
    const S = (o, f) => { const sp = ctx.seat?.({ x: o.x, y: yf + f.y, z: o.z, yaw: o.wyaw + (f.yaw || 0), bed: !!f.bed, name: f.name }); if (sp) seats.push(sp); };
    for (const f of fp.furniture) prop(P, body, S, R, f, yf, fp, ctx, items, b);
    // двери: одна InstancedMesh на этаж (створки), открыть/закрыть = матрица, тело — пока закрыта
    const doorsH = doorsOf(ctx, fp, g, body, bodies);
    if (fp.custom) ctx.custom?.(b, k, fp, { group: g, body, seat: S });
    ctx.merge?.(R, g);
    R.scene.add(g);
    if (R.shadowsOn) R.shadowsOn(g);
    return {
      fp, group: g, doors: doorsH.list, toggle: d => doorsH.toggle(d),
      dispose(){
        g.parent?.remove(g);
        g.traverse(o => { if (o.isMesh && (o.userData.mzOwn || o.userData.intOwn)) o.geometry.dispose(); });
        for (const c of bodies) ph.remove(c);
        for (const h of items) ctx.unitem?.(h);
        for (const s of seats) ctx.unseat?.(s);
      },
    };
  }

  // ── Мебель: простые детали (как PropKit в Backrooms) ──
  function prop(P, body, S, R, f, y, fp, ctx, items, b){
    const { x, z } = f, a = f.wyaw || 0, ca = Math.cos(a), sa = Math.sin(a);
    const at = (lx, lz) => [x + lx * ca + lz * sa, z - lx * sa + lz * ca];   // местные (вправо, вперёд) → мир
    const bx = (lx, ly, lz, w, h, d, c, solid, m) => { const [px, pz] = at(lx, lz); P({ s: 'box', x: px, y: y + ly + h / 2, z: pz, w, h, d, yaw: a, c, m }); if (solid) body({ x: px, z: pz, y: y + ly + h / 2, hx: w / 2, hy: h / 2, hz: d / 2, yaw: a }); };
    const glow = c => R.glow(c);
    switch (f.t) {
      case 'plant': { bx(0, 0, 0, .5, .5, .5, '#b45309', true); const [px, pz] = at(0, 0); P({ s: 'ico', x: px, y: y + 1.05, z: pz, r: .5, c: '#3f9a4c', det: 1 }); break; }
      case 'counter': { const L = f.len || 3; bx(0, 0, 0, L, 1.05, .8, f.c || '#1e3a8a', true); bx(0, 1.05, 0, L + .1, .08, .9, '#f8fafc'); break; }
      case 'sofa': { const c = f.c || '#475569'; bx(0, 0, 0, 2.2, .5, .9, c, true); bx(0, .5, -.35, 2.2, .6, .2, c); for (const s of [-1, 1]) bx(s, .5, 0, .2, .3, .9, c); S(f, { y: .56, name: 'Сесть на диван' }); break; }
      case 'turnstile': { bx(0, 0, 0, .25, 1, .8, '#64748b', false); bx(0, 1, 0, .3, .05, .3, '#22c55e', false, glow('#22c55e')); break; }
      case 'mailboxes': { bx(0, 0, 0, 2.4, 1.8, .4, '#64748b', true); for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) bx(-.9 + i * .6, .3 + j * .5, .21, .5, .4, .02, '#94a3b8'); break; }
      case 'bench': { bx(0, .4, 0, 1.8, .1, .5, '#a16207', true); bx(0, 0, 0, 1.6, .4, .1, '#57534e'); S(f, { y: .52, name: 'Сесть' }); break; }
      case 'shelf': { const L = f.len || 2, it = f.items || ['#ef4444', '#facc15']; bx(0, 0, 0, L, 2, .5, '#a16207', true); for (let r = 0; r < 3; r++) for (let i = 0; i < Math.floor(L / .35); i++) bx(-L / 2 + .25 + i * .35, .45 + r * .6, .26, .24, .3, .14, it[(i + r) % it.length]); break; }
      case 'table2': { bx(0, .72, 0, 1, .06, 1, f.c || '#f8fafc', true); bx(0, 0, 0, .12, .72, .12, '#57534e'); for (const s of [-1, 1]) { bx(s * .95, .45, 0, .5, .08, .5, f.chairC || '#78350f'); bx(s * 1.17, .45, 0, .06, .6, .5, f.chairC || '#78350f'); S({ x: at(s * .95, 0)[0], z: at(s * .95, 0)[1], wyaw: a }, { y: .5, yaw: s > 0 ? -PI / 2 : PI / 2, name: 'Сесть' }); } break; }
      case 'treadmill': { bx(0, 0, 0, .8, .25, 1.8, '#1f2937', true); bx(0, .25, .8, .8, 1.1, .1, '#334155'); bx(0, 1.2, .78, .5, .3, .04, '#38bdf8', false, glow('#38bdf8')); break; }
      case 'mat': { bx(0, 0, 0, f.w || 6, .04, f.d || 3, '#2563eb'); break; }
      case 'car': case 'truck': { const c = f.t === 'truck' ? '#dc2626' : f.c || '#ef4444', L = f.t === 'truck' ? 6 : 4.2, W = f.t === 'truck' ? 2.4 : 2; bx(0, .4, 0, W, .8, L, c, true); bx(0, 1.2, f.t === 'truck' ? L / 2 - .9 : -.2, W - .2, .6, f.t === 'truck' ? 1.6 : 2.2, f.t === 'truck' ? c : '#dbeafe'); for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) { const [px, pz] = at(sx * W / 2, sz * (L / 2 - .9)); P({ s: 'cyl', x: px, y: y + .4, z: pz, r: .4, h: .3, rz: PI / 2, yaw: a, c: '#111827', seg: 10 }); } break; }
      case 'conveyor': { const L = f.len || 6; bx(0, 0, 0, L, .9, 1, '#475569', true); bx(0, .9, 0, L, .06, .9, '#1f2937'); for (let i = 0; i < 4; i++) bx(-L / 2 + (i + .5) * L / 4, .96, 0, .5, .4, .5, '#a16207'); break; }
      case 'machine': { bx(0, 0, 0, 1.8, 2, 1.4, '#64748b', true); bx(0, 1.3, .71, .8, .5, .02, '#22c55e', false, glow('#22c55e')); break; }
      case 'crate': bx(0, 0, 0, 1, 1, 1, '#a16207', true); break;
      case 'deskpod': {
        // 2×2 стола лицом друг к другу, экран-перегородка по оси (Backrooms: TryBuildDeskPod)
        bx(0, 0, 0, 2.9, 1.24, .05, '#475569', true);
        for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
          bx(sx * .72, .7, sz * .385, 1.4, .05, .7, '#d6d3d1', true); bx(sx * .72, 0, sz * .385, .05, .7, .6, '#64748b');
          bx(sx * .72, .75, sz * .2, .6, .4, .04, '#0f172a'); bx(sx * .72, .77, sz * .17, .55, .34, .02, '#60a5fa', false, glow('#60a5fa'));
          bx(sx * .72, .45, sz * 1.05, .5, .08, .5, '#1f2937');
          const [px, pz] = at(sx * .72, sz * 1.05); S({ x: px, z: pz, wyaw: a }, { y: .5, yaw: sz > 0 ? PI : 0, name: 'Сесть за стол' });
        }
        break; }
      case 'desk': { bx(0, .72, 0, 1.6, .06, .8, f.c || '#d6d3d1', true); bx(-.7, 0, 0, .06, .72, .7, '#64748b'); bx(.7, 0, 0, .06, .72, .7, '#64748b'); bx(0, .78, -.2, .6, .4, .04, '#0f172a'); bx(0, .8, -.17, .55, .34, .02, '#60a5fa', false, glow('#60a5fa')); bx(0, .45, .75, .5, .08, .5, '#1f2937'); S({ x: at(0, .75)[0], z: at(0, .75)[1], wyaw: a }, { y: .5, yaw: PI, name: 'Сесть за стол' }); break; }
      case 'cabinet': bx(0, 0, 0, .5, 1.3, .7, '#94a3b8', true); break;
      case 'cooler': { bx(0, 0, 0, .5, 1.1, .5, '#e2e8f0', true); const [px, pz] = at(0, 0); P({ s: 'cyl', x: px, y: y + 1.35, z: pz, r: .2, h: .5, c: '#7dd3fc', seg: 8 }); break; }
      case 'bed': { const c = f.c || '#93c5fd'; bx(0, 0, 0, 1.5, .36, 2.3, '#8b5a2b', true); bx(0, .36, 0, 1.42, .16, 2.2, '#f8fafc'); bx(0, .4, .35, 1.44, .2, 1.5, c); bx(0, .5, -.8, .9, .14, .45, '#ffffff'); bx(0, 0, -1.15, 1.5, 1, .12, '#7c4a26'); S(f, { y: .62, bed: true, name: 'Лечь' }); break; }
      case 'nightstand': { bx(0, 0, 0, .5, .55, .5, '#78350f', true); const [px, pz] = at(0, 0); P({ s: 'ball', x: px, y: y + .7, z: pz, r: .13, m: glow('#fff6c8'), seg: 8 }); break; }
      case 'kitchen': { const L = f.len || 2.4; bx(0, 0, 0, L, .9, .6, '#e5e7eb', true); bx(0, .9, 0, L + .05, .05, .65, '#334155'); bx(L / 2 + .45, 0, 0, .7, 1.8, .65, '#f8fafc', true); bx(-L / 4, .96, 0, .5, .02, .4, '#111827'); break; }
      case 'wardrobe': bx(0, 0, 0, 1.4, 2, .6, '#a16207', true); break;
      case 'tv': { bx(0, .5, 0, 1.4, .8, .06, '#0f172a'); bx(0, .52, .04, 1.3, .7, .02, '#38bdf8', false, glow('#38bdf8')); break; }
      case 'rug': bx(0, 0, 0, f.w || 2.4, .02, f.d || 1.8, f.c || '#fde68a'); break;
      case 'meeting': { const L = f.len || 3; bx(0, .72, 0, 1.4, .06, L, '#78350f', true); for (let i = 0; i < Math.floor(L / 1.1); i++) for (const s of [-1, 1]) { const lz = -L / 2 + .55 + i * 1.1; bx(s * 1.05, .45, lz, .5, .08, .5, '#475569'); S({ x: at(s * 1.05, lz)[0], z: at(s * 1.05, lz)[1], wyaw: a }, { y: .5, yaw: s > 0 ? -PI / 2 : PI / 2, name: 'Сесть' }); } break; }
      case 'board': bx(0, .9, 0, f.len || 3, 1.3, .06, '#14532d', true); break;
      case 'schooldesk': { bx(0, .62, 0, .9, .05, .5, '#d97706', true); bx(0, .4, .5, .4, .06, .4, '#2563eb'); S({ x: at(0, .5)[0], z: at(0, .5)[1], wyaw: a }, { y: .45, yaw: PI, name: 'Сесть за парту' }); break; }
      case 'bunk': { bx(0, 0, 0, .9, .45, 2, '#64748b', true); bx(0, .45, 0, .85, .12, 1.9, '#e5e7eb'); S(f, { y: .55, bed: true, name: 'Лечь на нары' }); break; }
      case 'gold': for (let i = 0; i < 6; i++) bx(-.7 + (i % 3) * .7, (i > 2 ? .25 : 0), 0, .6, .22, .3, '#facc15', i < 3); break;
      case 'safe': bx(0, 0, 0, .9, 1.2, .9, '#334155', true); break;
      case 'flag': { const [px, pz] = at(0, 0); P({ s: 'cyl', x: px, y: y + 1.2, z: pz, r: .04, h: 2.4, c: '#d6d3d1', seg: 6 }); bx(.45, 1.8, 0, .9, .55, .03, '#2563eb'); break; }
      case 'bath': { bx(0, 0, 0, 1.7, .55, .8, '#f8fafc', true); bx(.6, .55, 0, .14, .5, .14, '#94a3b8'); bx(-1.25, .7, .2, .5, .1, .4, '#f8fafc', true); break; }
      case 'npcspot': if (ctx.npc) items.push(ctx.npc({ x, y, z, yaw: a, who: f.who, b })); break;
    }
  }

  // ── Двери этажа: створки — InstancedMesh (дерево/металл/решётка — цвет, стекло — своя), тело — пока закрыта ──
  const DOOR_C = { wood: '#92400e', metal: '#64748b', bars: '#475569', vault: '#94a3b8', shutter: '#9ca3af' };
  function doorsOf(ctx, fp, g, body, bodies){
    const { R, ph } = ctx, T = R.T, list = fp.doors.map(d => ({ ...d }));
    if (!list.length) return { list, toggle: () => false };
    const solidL = list.filter(d => d.kind !== 'glass'), glassL = list.filter(d => d.kind === 'glass');
    const mk = (L, mat) => { if (!L.length) return null; const m = new T.InstancedMesh(R.K.geo('intDoorBox', () => new T.BoxGeometry(1, 1, 1)), mat, L.length); m.userData.intOwn = false; m.frustumCulled = false; g.add(m); return m; };
    const ms = mk(solidL, R.mat('#ffffff', { rough: .7 })), mg = mk(glassL, ctx.glass || R.mat('#bfe8ff'));
    const m4 = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), s = new T.Vector3(), col = new T.Color();
    const place = d => {
      const mesh = d.kind === 'glass' ? mg : ms, i = (d.kind === 'glass' ? glassL : solidL).indexOf(d);
      const open = d.open, vx = Math.sin(d.yaw), vz = Math.cos(d.yaw);
      // закрыта — в проёме (вдоль стены); открыта — на петле в комнату (решётка, хранилище, ворота — уезжают вбок)
      let px = d.x, pz = d.z, ry = d.yaw - PI / 2;
      if (open) {
        if (d.kind === 'bars' || d.kind === 'vault' || d.kind === 'shutter') { px += vx * d.w * .95; pz += vz * d.w * .95; }
        else { px = d.x - vx * d.w / 2 + d.ix * d.w / 2; pz = d.z - vz * d.w / 2 + d.iz * d.w / 2; ry = Math.atan2(d.ix, d.iz) - PI / 2; }
      }
      m4.compose(v.set(px, d.y + 1.1, pz), q.setFromAxisAngle(up, ry), s.set(d.w - .06, 2.2, d.kind === 'vault' ? .3 : .06));
      mesh.setMatrixAt(i, m4); mesh.instanceMatrix.needsUpdate = true;
      if (mesh === ms) { mesh.setColorAt(i, col.set(DOOR_C[d.kind] || '#92400e')); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
      // тело: закрыта — стоит в проёме
      if (!open && !d.body) { d.body = body({ x: d.x, z: d.z, y: d.y + 1.1, hx: d.w / 2, hy: 1.1, hz: .08, yaw: d.yaw - PI / 2 }, { cam: false, door: d.id }); }
      else if (open && d.body) { ph.remove(d.body); const i2 = bodies.indexOf(d.body); if (i2 >= 0) bodies.splice(i2, 1); d.body = null; }
    };
    for (const d of list) place(d);
    // взаимодействие [E]: открыть / закрыть; запертое — по правилам доступа (ctx.access)
    for (const d of list) {
      const nm = { wood: 'дверь', glass: 'стеклянную дверь', metal: 'служебную дверь', bars: 'решётку камеры', vault: 'дверь хранилища', shutter: 'ворота' }[d.kind] || 'дверь';
      d.item = ctx.item({ x: d.x, y: d.y + 1.2, z: d.z, r: 1.4, prompt: () => `${d.open ? 'Закрыть' : 'Открыть'} ${nm}${d.locked && !d.open ? ' 🔒' : ''}`, act: () => toggle(d) });
      ctx.onDoor?.(d);
    }
    function toggle(d){
      if (!d.open && d.locked) { const ok = ctx.access ? ctx.access(d) : false; if (ok !== true) { ctx.toast?.(typeof ok === 'string' ? ok : '🔒 Заперто'); return false; } }
      d.open = !d.open; place(d); ctx.sound?.(d); return true;
    }
    return { list, toggle };
  }

  // ── Крыша (по лифту): перила, будка лифта; у отеля — бассейн и шезлонги ──
  function roofMount(ctx, b){
    const { R, ph } = ctx, T = R.T, P0 = plan(b), t = P0.tiers[P0.tiers.length - 1], top = t.top + .3, g = new T.Group(), bodies = [], items = [], seats = [];
    const P = p => R.part(g, p), body = o => { const c = ph.addBox({ tag: 'roof', ...o, data: { cam: false, floor: 'concrete' } }); bodies.push(c); return c; };
    for (const [w, d, dx, dz] of [[t.w, .25, 0, -t.d / 2], [t.w, .25, 0, t.d / 2], [.25, t.d, -t.w / 2, 0], [.25, t.d, t.w / 2, 0]]) { P({ s: 'box', x: b.x + dx, y: top + .55, z: b.z + dz, w, h: 1.1, d, c: '#cbd5e1' }); body({ x: b.x + dx, z: b.z + dz, y: top + .55, hx: Math.max(w, .3) / 2, hy: .55, hz: Math.max(d, .3) / 2 }); }
    const F = frame(b), core = P0.core;
    const [bx, bz] = F.toW(core ? core.u : 0, core ? core.v : 0);
    P({ s: 'box', x: bx, y: top + 1.3, z: bz, w: 2.8, h: 2.6, d: 2.8, c: '#e5e7eb' }); body({ x: bx, z: bz, y: top + 1.3, hx: 1.4, hy: 1.3, hz: 1.4 });
    const [lx, lz] = F.toW(core ? core.u : 0, (core ? core.v : 0) + 2.6);
    const landing = { x: lx, z: lz, y: top, yaw: F.rot };
    items.push(ctx.item({ x: lx, y: top + 1.2, z: lz, r: 1.6, prompt: () => '🛗 Лифт · крыша', act: () => ctx.lift?.(b, -1) }));
    if (b.roofKind !== 'pool' && b.crown !== 'helipad') {   // кондиционеры и бак — по углам (с телами: сквозь них не пройти)
      const TW2 = F.uIsX ? t.w : t.d, TD2 = F.uIsX ? t.d : t.w;
      for (const [du, dv, w, h, d, c] of [[-TW2 / 2 + 2.2, TD2 / 2 - 2.4, 2.4, 1.2, 1.6, '#9ca3af'], [TW2 / 2 - 2.2, TD2 / 2 - 2.4, 2.4, 1.2, 1.6, '#9ca3af'], [TW2 / 2 - 2.4, (core ? core.v : 0), 2, 2.2, 2, '#a8a29e']]) {
        if (TW2 < 10 && du > 0 && dv > 0) continue;
        const [x, z] = F.toW(du, dv), sw = !F.uIsX;
        P({ s: 'box', x, y: top + h / 2, z, w: sw ? d : w, h, d: sw ? w : d, c });
        body({ x, z, y: top + h / 2, hx: (sw ? d : w) / 2, hy: h / 2, hz: (sw ? w : d) / 2 });
      }
    }
    if (b.roofKind === 'pool') {
      // бассейн: бортик рамкой, дно — плитка, вода ниже края бортика (не в одной плоскости — без ряби z-fighting)
      const PW = Math.min(12, (F.uIsX ? t.w : t.d) - 4), PD = 5, rim = .4, sw = !F.uIsX;
      const bxw = (du, dv, w, d, y0, h, o) => { const [x, z] = F.toW(du, (core ? core.v : 0) + 7 + dv); P({ s: 'box', x, y: top + y0 + h / 2, z, w: sw ? d : w, h, d: sw ? w : d, ...o }); return [x, z]; };
      for (const [du, dv, w, d] of [[0, -PD / 2 + rim / 2, PW, rim], [0, PD / 2 - rim / 2, PW, rim], [-PW / 2 + rim / 2, 0, rim, PD - 2 * rim], [PW / 2 - rim / 2, 0, rim, PD - 2 * rim]]) {
        const [x, z] = bxw(du, dv, w, d, 0, .55, { c: '#e2e8f0' });
        body({ x, z, y: top + .275, hx: (sw ? d : w) / 2, hy: .275, hz: (sw ? w : d) / 2 });
      }
      bxw(0, 0, PW - 2 * rim, PD - 2 * rim, 0, .06, { c: '#7dd3fc' });
      bxw(0, 0, PW - 2 * rim, PD - 2 * rim, .4, .02, { m: R.water ? R.water('#38bdf8', { key: 'intpool', fixedColor: true }) : R.mat('#38bdf8') });
      for (const k of [-4, -1.5, 1, 3.5]) { const [sx, sz] = F.toW(k, (core ? core.v : 0) + 11); P({ s: 'box', x: sx, y: top + .25, z: sz, w: .9, h: .2, d: 2, yaw: F.rot, c: '#fef3c7' }); const sp = ctx.seat?.({ x: sx, y: top + .35, z: sz, yaw: F.rot + PI, bed: true, name: 'Позагорать' }); if (sp) seats.push(sp); }
    }
    ctx.merge?.(R, g); R.scene.add(g);
    return { landing, group: g, dispose(){ g.parent?.remove(g); g.traverse(o => { if (o.isMesh && o.userData.mzOwn) o.geometry.dispose(); }); for (const c of bodies) ph.remove(c); for (const h of items) ctx.unitem?.(h); for (const s of seats) ctx.unseat?.(s); } };
  }

  // ── Где игрок: внутри здания b на этаже k (−1 — снаружи); по росту, не по триггерам ──
  function where(b, x, y, z){
    const P = plan(b);
    for (let k = P.n - 1; k >= 0; k--) {
      const fy = floorY(P, k);
      if (y < fy - .4) continue;
      const t = tierOf(P, k), hw = t.w / 2 - .25, hd = t.d / 2 - .25;
      if (Math.abs(x - b.x) < hw && Math.abs(z - b.z) < hd && y < fy + floorH(P, k) - .2) return k;
    }
    return -1;
  }

  E.interior = { FH, plan, floorY, floorH, floorPlan, floorKind, frame, shell, mount, roofMount, where, rngOf, hashStr, OPEN };
})();

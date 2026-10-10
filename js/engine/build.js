// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — стройка как в Rust: фундамент, стены, проёмы, двери, окна, бойницы, решётки, заслонки, перекрытия,
//  люки, лестницы, шкаф прав; уровни прочности (каркас → доски → металл → броня), опора, сетка, права на землю,
//  кодовые замки, содержание и гниение (перенос Building/BuildDefs.cs, BuildGrid.cs, BuildPieceBody.cs, BuildPiece.cs и
//  PlayerCrafting.Build.cs из Unity-проекта Backrooms)
// ═══════════════════════════════════════
// Всё в метрах Unity внутри (как в оригинале), в мир — × E.UNIT. Плитка 2,67 м (клетка 8 м / 3), этаж 2,8 м, до 3 этажей.
// D37E.build.defs — таблицы (цены, прочность, содержание, гниение, множители рейда). D37E.build.boxes(вид, уровень, …) —
// из каких коробок деталь (и тела физики, и картинка).
// G = D37E.build.grid(phys, { ox, oz, oy, w, h, actors, mates, decay }) — участок w × h плиток от угла (ox, oz):
//   G.snap(вид, aim, eye, view, flip) → место (плитка, ребро, этаж, поворот) по точке прицела и взгляду;
//   G.validate(вид, место, кто) → { ok, why } — опора, занятость, права шкафа, расстояние между шкафами, никто не стоит;
//   G.place(вид, место, кто, { inv }) — поставить (заплатить из inv); G.act(деталь, действие, кто, arg, inv) — 'upgrade',
//   'rotate', 'repair', 'demolish', 'toggle', 'addlock', 'setcode', 'trycode', 'lock', 'unlock', 'removelock',
//   'authorize', 'clearauth', 'deposit' → { ok, msg }; G.damage(деталь, урон, тип, от кого); G.tick(dt) — содержание
//   и гниение (если decay); G.prompt(деталь, кто, присел) — подсказка; G.save() / G.load(data); G.on('add'|'remove'|'change').
// V = D37E.build.view(R, G) — рисует детали (общие сетки на вид/уровень, текстуры уровней кодом) и «призрак» V.ghost(…).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const E = root.D37E = root.D37E || {};
  const U = E.UNIT || 2.1 / 1.8, DEG = Math.PI / 180;

  // ═══ Таблицы (BuildDefs.cs) ═══
  const KINDS = ['foundation', 'floor', 'wall', 'halfwall', 'doorway', 'window', 'embrasure', 'door', 'bars', 'shutter', 'hatch', 'stairs', 'cupboard'];
  const TIERS = ['twig', 'wood', 'metal', 'armored'];
  const NAME = { foundation: 'фундамент', floor: 'перекрытие', wall: 'стена', halfwall: 'полустена', doorway: 'дверной проём', window: 'оконный проём',
    embrasure: 'бойница', door: 'дверь', bars: 'решётка', shutter: 'заслонка', hatch: 'люк', stairs: 'лестница', cupboard: 'шкаф прав' };
  const ICON = { foundation: '⬛', floor: '🟫', wall: '🧱', halfwall: '▬', doorway: '🚪', window: '🪟', embrasure: '🎯', door: '🚪', bars: '⛓️', shutter: '🪟', hatch: '🕳️', stairs: '🪜', cupboard: '🗄️' };
  const TIER_NAME = { twig: 'каркас', wood: 'доски', metal: 'металл', armored: 'броня' };
  const ti = t => TIERS.indexOf(t);
  const bround = x => { const f = Math.floor(x), d = x - f; return d > .5 ? f + 1 : d < .5 ? f : (f % 2 === 0 ? f : f + 1); };   // Math.Round в C#
  const D = {
    KINDS, TIERS, NAME, ICON, TIER_NAME,
    MENU: ['wall', 'doorway', 'door', 'window', 'bars', 'shutter', 'halfwall', 'embrasure', 'foundation', 'floor', 'hatch', 'stairs', 'cupboard'],
    LEVEL_H: 2.8, PRIV_R: 14, CUP_SPACING: 28, MAX_PER_PLAYER: 60, MAX_ON_SERVER: 400, ROTATE_WINDOW: 60, DEMOLISH_WINDOW: 600, TILE: 8 / 3,
    name: k => NAME[k] || k,
    tierName: t => TIER_NAME[t] || t,
    // куда встаёт: плитка земли, плитка этажа, ребро (стены), вставка в проём, предмет на плитке
    slot: k => k === 'foundation' ? 'ground' : k === 'floor' || k === 'hatch' ? 'floor' : k === 'door' || k === 'bars' || k === 'shutter' ? 'insert'
      : k === 'stairs' || k === 'cupboard' ? 'object' : 'edge',
    hostOf: k => k === 'door' ? 'doorway' : 'window',
    openable: k => k === 'door' || k === 'shutter' || k === 'hatch',
    lockable: k => k === 'door' || k === 'shutter' || k === 'hatch',
    // перекрывает проход (двери и пустые проёмы — нет: у базы всегда есть дверь)
    blocksPath: k => k === 'wall' || k === 'halfwall' || k === 'window' || k === 'embrasure' || k === 'bars',
    placeTier: k => k === 'door' || k === 'shutter' || k === 'hatch' || k === 'cupboard' ? 'wood' : k === 'bars' ? 'metal' : 'twig',
    maxTier: k => k === 'door' || k === 'shutter' || k === 'hatch' ? 'metal' : k === 'bars' || k === 'cupboard' ? D.placeTier(k) : 'armored',
    size: k => k === 'halfwall' || k === 'bars' || k === 'hatch' || k === 'shutter' ? .5 : k === 'foundation' ? 1.5 : 1,
    // цена детали этого уровня (поставить — placeTier, улучшить — следующий уровень целиком)
    cost(k, t){
      if (k === 'cupboard') return { scrap: 6, fasteners: 2, cloth: 2 };
      if (k === 'door' && t === 'wood') return { scrap: 5, fasteners: 2 };
      if (k === 'door') return { scrap: 10, fasteners: 4, wire: 1 };
      const s = D.size(k), N = v => Math.max(1, bround(v * s));
      return t === 'twig' ? { scrap: N(1) } : t === 'wood' ? { scrap: N(4), fasteners: N(1) } : t === 'metal' ? { scrap: N(6), fasteners: N(3) } : { scrap: N(10), fasteners: N(4), wire: N(2) };
    },
    maxHp(k, t){
      if (k === 'cupboard') return 200;
      if (k === 'bars') return 500;
      return [30, 250, 700, 1500][ti(t)] * (k === 'halfwall' || k === 'hatch' || k === 'shutter' ? .7 : k === 'foundation' ? 1.5 : 1);
    },
    upkeepPerHour: (k, t) => k === 'cupboard' ? 0 : [0, 1, 2, 4][ti(t)],          // металлолом в час (платит шкаф)
    decayPerMin: t => [.10, .01, .005, .003][ti(t)],                              // доля прочности в минуту без оплаты
    // множитель урона: окружение, твари (главный «таран»), пули, режущее/колющее, тупое
    raidMul(type, from, t){
      const i = ti(t);
      if (type === 'env') return [2, 1.5, 1, .8][i];
      if (from === 'monster') return [3, 1, .6, .35][i];
      if (type === 'bullet') return [.5, .05, .01, .005][i];
      if (type === 'cut' || type === 'pierce') return [1, .25, .03, .01][i];
      return [1, .35, .08, .03][i];
    },
    costText: c => Object.entries(c).map(([id, n]) => (E.items ? E.items.name(id) : id) + ' ×' + n).join(', '),
    validCode: c => /^\d{4}$/.test(String(c ?? '')),
  };

  // ═══ Из каких коробок деталь (BuildPieceBody.Boxes + Extras), метры, система детали: +Z — лицо (наружу от строителя) ═══
  // { x, y, z — центр, w, h, d — размер, yaw / rx — поворот (рад), sub: 0 основа | 1 фурнитура | 2 огонёк замка, solid, hidden }
  function boxes(k, t, open, lock, W = D.TILE, detail = true){
    const l = [], H = D.LEVEL_H, th = [.1, .16, .18, .26][ti(t)], hw = W / 2;
    const add = (x, y, z, w, h, d, o = {}) => l.push({ x, y, z, w, h, d, yaw: o.yaw || 0, rx: o.rx || 0, sub: o.sub || 0, solid: o.solid !== false, hidden: !!o.hidden });
    const V = (x, y, z, w, h, d, sub = 1, o = {}) => detail && add(x, y, z, w, h, d, { ...o, sub, solid: false });
    // створка на петле (hinge — петля, yaw — поворот вокруг неё, side — в какую сторону от петли)
    const leaf = (hx, hy, hz, w, h, d, yaw, side, sub = 0) => { const lx = side * w / 2; add(hx + Math.cos(yaw) * lx, hy + h / 2, hz - Math.sin(yaw) * lx, w, h, d, { yaw, sub }); };
    // точка на створке (поворот вокруг петли)
    const onLeaf = (hx, hy, hz, yaw, x, y, z) => [hx + Math.cos(yaw) * x + Math.sin(yaw) * z, hy + y, hz - Math.sin(yaw) * x + Math.cos(yaw) * z];
    const frame = (ow, y0, y1) => {
      const f = .06, d = th + .04;
      V(-ow / 2 - f / 2, (y0 + y1) / 2, 0, f, y1 - y0 + f, d); V(ow / 2 + f / 2, (y0 + y1) / 2, 0, f, y1 - y0 + f, d);
      V(0, y1 + f / 2, 0, ow + 2 * f, f, d);
      if (y0 > .01) V(0, y0 - f / 2, 0, ow + 2 * f, f, d + .03);
    };
    // кодовый замок: корпус, 3×4 клавиши, огонёк — с обеих сторон
    const keypad = (at, hinge = [0, 0, 0], yaw = 0) => {
      if (!detail) return;
      for (const side of [1, -1]) {
        const P = (x, y, z) => onLeaf(hinge[0], hinge[1], hinge[2], yaw, x, y, z);
        const px = at[0], py = at[1], pz = at[2] * side;
        V(...P(px, py, pz), .11, .17, .03, 1, { yaw });
        V(...P(px, py + .06, pz + side * .017), .07, .025, .006, 2, { yaw });
        for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) V(...P(px + (col - 1) * .027, py + .025 - row * .026, pz + side * .018), .018, .018, .006, 1, { yaw });
      }
    };
    switch (k) {
      case 'wall': add(0, H / 2, 0, W, H, th); break;
      case 'halfwall': add(0, .6, 0, W, 1.2, th); break;
      case 'doorway': {
        const ow = 1.1, oh = 2.2, sw = (W - ow) / 2;
        add(-(ow / 2 + sw / 2), H / 2, 0, sw, H, th); add(ow / 2 + sw / 2, H / 2, 0, sw, H, th); add(0, (oh + H) / 2, 0, ow, H - oh, th);
        frame(ow, 0, oh); break;
      }
      case 'window': case 'embrasure': {
        const emb = k === 'embrasure', ow = emb ? .9 : 1, y0 = emb ? 1.35 : 1, y1 = emb ? 1.55 : 1.9, sw = (W - ow) / 2;
        add(-(ow / 2 + sw / 2), H / 2, 0, sw, H, th); add(ow / 2 + sw / 2, H / 2, 0, sw, H, th);
        add(0, y0 / 2, 0, ow, y0, th); add(0, (y1 + H) / 2, 0, ow, H - y1, th);
        frame(ow, y0, y1); break;
      }
      case 'door': {
        const a = open ? -95 * DEG : 0, hg = [-.54, .01, 0];
        leaf(hg[0], hg[1], hg[2], 1.08, 2.18, .07, a, 1);
        if (detail) {
          for (const y of [.35, 1.8]) V(...onLeaf(...hg, a, .02, y, 0), .05, .16, .1, 1, { yaw: a });   // петли
          for (const z of [.06, -.06]) {
            V(...onLeaf(...hg, a, .95, 1.05, z), .03, .03, .05, 1, { yaw: a });          // шейка ручки
            V(...onLeaf(...hg, a, .9, 1.05, z * 1.5), .12, .025, .025, 1, { yaw: a });   // ручка-рычаг
            V(...onLeaf(...hg, a, .95, 1, z * .6), .05, .16, .01, 1, { yaw: a });         // накладка
          }
          if (lock) keypad([.93, 1.3, .05], hg, a);
        }
        break;
      }
      case 'bars':
        for (let x = -.45; x <= .451; x += .15) add(x, 1.45, 0, .035, .9, .035, { sub: 1, solid: false });
        add(0, 1.45, 0, 1, .9, .05, { sub: 1, hidden: true });   // тело целиком, не рисуется
        V(0, 1.02, 0, 1, .04, .05); V(0, 1.88, 0, 1, .04, .05); V(0, 1.45, 0, 1, .03, .04);
        break;
      case 'shutter': {
        leaf(-.5, 1, .02, .5, .9, .05, open ? -100 * DEG : 0, 1);
        leaf(.5, 1, .02, .5, .9, .05, open ? 100 * DEG : 0, -1);
        for (const x of [-.5, .5]) for (const y of [1.12, 1.78]) V(x, y, .03, .06, .08, .05);   // петли
        V(0, 1.45, open ? .08 : .06, .18, .04, .02);   // засов
        if (lock) keypad([.12, 1.3, .07]);
        break;
      }
      case 'foundation': add(0, .1, 0, W, .2, W); break;
      case 'floor': add(0, -.075, 0, W, .15, W); break;
      case 'hatch': {
        const o = 1, sw = (W - o) / 2;
        add(-(o / 2 + sw / 2), -.075, 0, sw, .15, W); add(o / 2 + sw / 2, -.075, 0, sw, .15, W);
        add(0, -.075, -(o / 2 + sw / 2), o, .15, sw); add(0, -.075, o / 2 + sw / 2, o, .15, sw);
        // крышка: закрыта — в проёме; открыта — стоит у петли (физика умеет только поворот вокруг Y — поэтому стоймя)
        if (open) add(0, o / 2, -o / 2 - .05, o, o, .08); else add(0, -.04, 0, o, .08, o);
        for (let i = 1; i <= 8; i++) add(0, -i * H / 9, -.35, .6, .04, .04, { sub: 1, solid: false });   // перекладины вниз
        if (detail) {
          for (const x of [-.3, .3]) V(x, 0, -.5, .12, .04, .05);              // петли
          for (const x of [-.3, .3]) V(x, -H / 2, -.35, .04, H, .05);          // тетивы лестницы
          V(0, open ? .85 : .01, open ? -.5 : .35, .2, .03, .04);              // ручка
        }
        break;
      }
      case 'stairs': {
        const n = 10, d = W / n;
        for (let i = 0; i < n; i++) {
          add(0, (i + .5) * H / n, -hw + (i + .5) * d, 1.3, H / n, d, { solid: false });                     // ступени (видно)
          add(0, (i + 1) * H / n / 2, -hw + (i + .5) * d, 1.3, (i + 1) * H / n, d, { hidden: true });       // тело ступенями до пола
        }
        const len = Math.hypot(W, H), ang = -Math.atan2(H, W);
        for (const x of [-.68, .68]) V(x, H / 2 - .1, 0, .06, .25, len, 0, { rx: ang });   // косоуры
        break;
      }
      case 'cupboard':
        add(0, .9, 0, .9, 1.8, .5);
        V(0, .9, .255, .02, 1.7, .01);
        for (const x of [-.06, .06]) V(x, 1, .27, .03, .14, .03);
        for (const y of [.45, 1.35]) V(0, y, .258, .86, .02, .01);
        V(0, 1.82, 0, .96, .05, .56); V(0, .03, 0, .94, .06, .54);
        V(.32, 1.25, .26, .12, .16, .03); V(.32, 1.3, .277, .025, .02, .008, 2);
        break;
    }
    return l;
  }

  // ═══ Сетка и правила (BuildGrid.cs + BuildPiece.cs + PlayerCrafting.Build.cs) ═══
  function grid(ph, o = {}){
    const ev = E.emitter ? E.emitter() : null;
    const G = { ph, defs: D, tileM: o.tile || D.TILE, ox: o.ox || 0, oz: o.oz || 0, oy: o.oy || 0, w: o.w ?? 64, h: o.h ?? 64, maxLevel: o.maxLevel ?? 2,
      pieces: new Map(), list: [], decay: !!o.decay, mates: o.mates || ((a, b) => !!a && !!b && a === b), actors: o.actors || null, now: 0, seq: 0, _acc: 0 };
    const T = G.tileM * U, HU = D.LEVEL_H * U;
    G.T = T; G.HU = HU;
    G.on = (e, f) => ev ? ev.on(e, f) : () => {};
    const emit = (e, d) => ev?.emit(e, d);
    G.key = (cls, tx, tz, level, dir) => `${cls}:${tx}:${tz}:${level}:${dir & 1}`;
    G.tileOf = (x, z) => [Math.floor((x - G.ox) / T), Math.floor((z - G.oz) / T)];
    G.levelOf = y => Math.max(0, Math.floor((y - G.oy + .35 * U) / HU));
    G.tileCenter = (tx, tz, level) => ({ x: G.ox + (tx + .5) * T, y: G.oy + level * HU, z: G.oz + (tz + .5) * T });
    G.edgeCenter = (tx, tz, dir, level) => { const c = G.tileCenter(tx, tz, level); if (dir === 0) c.z += T / 2; else c.x += T / 2; return c; };
    G.inBounds = (tx, tz) => tx >= 0 && tz >= 0 && tx < G.w && tz < G.h;
    G.get = (cls, tx, tz, level, dir = 0) => G.pieces.get(G.key(cls, tx, tz, level, dir)) || null;
    G.has = (cls, tx, tz, level, dir, kind) => { const p = G.get(cls, tx, tz, level, dir); return !!p && (!kind || p.kind === kind); };
    G.count = who => G.list.reduce((n, p) => n + (p.owner === who ? 1 : 0), 0);
    G.hp01 = p => Math.max(0, Math.min(1, p.hp / D.maxHp(p.kind, p.tier)));

    // ── Привязать деталь к сетке по точке прицела и взгляду (flip — повернуть на 180°) ──
    const axisYaw = (x, z, flip) => { let ax = 0, az = 0; if (Math.abs(x) > Math.abs(z)) ax = Math.sign(x) || 1; else az = Math.sign(z) || 1; if (flip) { ax = -ax; az = -az; } return Math.atan2(ax, az); };
    G.snap = (k, aim, eye, view, flip = false) => {
      const s = { cls: D.slot(k), tx: 0, tz: 0, level: 0, dir: 0, x: 0, y: 0, z: 0, yaw: 0 };
      let vx = view.x, vz = view.z; if (vx * vx + vz * vz < 1e-4) { vx = 0; vz = 1; }
      [s.tx, s.tz] = G.tileOf(aim.x, aim.z);
      if (s.cls === 'edge' || s.cls === 'insert') {
        const lx = (aim.x - G.ox) / T - s.tx, lz = (aim.z - G.oz) / T - s.tz;
        const dS = lz, dN = 1 - lz, dW = lx, dE = 1 - lx, m = Math.min(dS, dN, dW, dE);
        if (m === dN) s.dir = 0; else if (m === dS) { s.dir = 0; s.tz -= 1; } else if (m === dE) s.dir = 1; else { s.dir = 1; s.tx -= 1; }
        s.level = G.levelOf(Math.min(aim.y, eye.y) - .2 * U);
        Object.assign(s, G.edgeCenter(s.tx, s.tz, s.dir, s.level));
        let nx = s.dir ? 1 : 0, nz = s.dir ? 0 : 1;
        if (nx * (s.x - eye.x) + nz * (s.z - eye.z) < 0) { nx = -nx; nz = -nz; }   // лицо — от строителя: дверь открывается наружу
        if (flip) { nx = -nx; nz = -nz; }
        s.yaw = Math.atan2(nx, nz);
      } else if (s.cls === 'ground') {
        s.level = 0; Object.assign(s, G.tileCenter(s.tx, s.tz, 0)); s.yaw = axisYaw(vx, vz, flip);
      } else if (s.cls === 'floor') {   // перекрытие — над головой (смотрит вверх) или на этаж выше того, на что целится
        s.level = (view.y ?? 0) > .25 ? G.levelOf(eye.y) + 1 : Math.max(1, G.levelOf(aim.y + .3 * U));
        Object.assign(s, G.tileCenter(s.tx, s.tz, s.level)); s.yaw = axisYaw(vx, vz, flip);
      } else {
        s.level = G.levelOf(aim.y + .3 * U); Object.assign(s, G.tileCenter(s.tx, s.tz, s.level)); s.yaw = axisYaw(vx, vz, flip);
      }
      return s;
    };

    // «Геометрия уровня» — всё, кроме построек игроков и зон
    const geoRay = (x, y, z, dx, dy, dz, len) => ph.raycast(x, y, z, dx, dy, dz, len, c => !c.data?.piece);
    const edgeHasGeometry = (tx, tz, dir, level) => {
      const c = G.edgeCenter(tx, tz, dir, level), nx = dir ? 1 : 0, nz = dir ? 0 : 1;
      return !!geoRay(c.x - nx * .45 * U, c.y + 1.2 * U, c.z - nz * .45 * U, nx, 0, nz, .9 * U);
    };
    const anyEdgeAround = (tx, tz, level) => G.has('edge', tx, tz, level, 0) || G.has('edge', tx, tz, level, 1) || G.has('edge', tx, tz - 1, level, 0) || G.has('edge', tx - 1, tz, level, 1);
    // Кто стоит в объёме детали (игроки, звери — список даёт игра: [{ x, y, z, r, h, name }])
    function occupied(k, s){
      const half = T / 2 - .15 * U;
      let hx, hy, hz, cy;
      if (s.cls === 'edge' || s.cls === 'insert') { hx = half; hy = 1.2 * U; hz = .3 * U; cy = s.y + 1.3 * U; }
      else if (s.cls === 'object') { hx = .6 * U; hy = .9 * U; hz = .6 * U; cy = s.y + U; }
      else { hx = half; hy = .2 * U; hz = half; cy = s.y + .15 * U; }
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      for (const a of (typeof G.actors === 'function' ? G.actors() : G.actors) || []) {
        if (a.y > cy + hy || a.y + (a.h || 2.1) < cy - hy) continue;
        const px = a.x - s.x, pz = a.z - s.z, lx = c * px - sn * pz, lz = sn * px + c * pz, r = a.r || .42;
        if (Math.abs(lx) <= hx + r && Math.abs(lz) <= hz + r) return a.name || 'игрок';
      }
      return null;
    }
    // ── Права: шкаф прав (14 м) — строить рядом может только его команда и допущенные ──
    G.authorized = (who, p) => !!p && !!who && (G.mates(who, p.owner) || (p.auth || []).some(n => G.mates(who, n)));
    G.canBuildAt = (who, pos) => {
      for (const p of G.list) {
        if (p.kind !== 'cupboard' || p.hp <= 0) continue;
        if (Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z) > D.PRIV_R * U || G.authorized(who, p)) continue;
        return { ok: false, why: 'чужая территория: шкаф прав (' + (p.ownerName || p.owner) + ')' };
      }
      return { ok: true };
    };
    G.cupboardAt = pos => {
      let best = null, bd = Infinity;
      for (const p of G.list) if (p.kind === 'cupboard' && p.hp > 0) { const d = Math.hypot(p.x - pos.x, p.y - pos.y, p.z - pos.z); if (d <= D.PRIV_R * U && d < bd) { bd = d; best = p; } }
      return best;
    };

    // ── Общие правила места (сервер и призрак) ──
    G.validate = (k, s, builder) => {
      const no = why => ({ ok: false, why });
      if (!G.inBounds(s.tx, s.tz) || ((s.cls === 'edge' || s.cls === 'insert') && !G.inBounds(s.dir === 0 ? s.tx : s.tx + 1, s.dir === 0 ? s.tz + 1 : s.tz))) return no('вне участка');
      if (s.level > G.maxLevel) return no('слишком высоко');
      const occ = G.get(s.cls, s.tx, s.tz, s.level, s.dir);
      if (occ) return no('место занято: ' + D.name(occ.kind));
      if (G.list.length >= D.MAX_ON_SERVER) return no('здесь уже слишком много построек');
      if (builder && G.count(builder) >= D.MAX_PER_PLAYER) return no('у тебя уже ' + D.MAX_PER_PLAYER + ' деталей');
      switch (s.cls) {
        case 'edge':
          if (edgeHasGeometry(s.tx, s.tz, s.dir, s.level)) return no('здесь уже стена');
          if (s.level === 0 && !geoRay(s.x, s.y + .5 * U, s.z, 0, -1, 0, 1.1 * U)) return no('нужна опора: пол');
          if (s.level > 0) {
            const bx = s.dir === 0 ? s.tx : s.tx + 1, bz = s.dir === 0 ? s.tz + 1 : s.tz;
            if (!G.has('floor', s.tx, s.tz, s.level, 0) && !G.has('floor', bx, bz, s.level, 0) && !G.has('edge', s.tx, s.tz, s.level - 1, s.dir))
              return no('нужна опора: перекрытие или стена снизу');
          }
          break;
        case 'insert': {
          const host = D.hostOf(k), hp = G.get('edge', s.tx, s.tz, s.level, s.dir);
          if (!hp || hp.kind !== host) return no('нужен ' + D.name(host));
          if (k !== 'door') s.yaw = hp.yaw;   // вставка смотрит туда же, куда проём
          break;
        }
        case 'ground': {
          const fl = geoRay(s.x, s.y + .6 * U, s.z, 0, -1, 0, 1.2 * U);
          if (!fl || Math.abs(fl.y - s.y) > .4 * U) return no('нужен ровный пол');
          break;
        }
        case 'floor': {
          if (s.level < 1) return no('перекрытие — над головой (на полу — фундамент)');
          const c0 = G.tileCenter(s.tx, s.tz, 0);
          if (geoRay(c0.x, c0.y + .2 * U, c0.z, 0, 1, 0, s.level * HU + 2 * U)) return no('мало высоты: потолок');
          if (!anyEdgeAround(s.tx, s.tz, s.level - 1) && !G.has('object', s.tx, s.tz, s.level - 1, 0, 'stairs')) return no('нужна опора: стена или лестница снизу');
          break;
        }
        case 'object':
          if (s.level === 0 ? !geoRay(s.x, s.y + .6 * U, s.z, 0, -1, 0, 1.2 * U) : !G.has('floor', s.tx, s.tz, s.level, 0)) return no('нужна опора: пол');
          if (k === 'stairs' && geoRay(s.x, s.y + .2 * U, s.z, 0, 1, 0, HU + .4 * U)) return no('лестнице некуда вести: низкий потолок');
          break;
      }
      const pr = G.canBuildAt(builder, s); if (!pr.ok) return pr;
      if (k === 'cupboard') for (const p of G.list) if (p.kind === 'cupboard') {
        const d = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
        if (d < D.CUP_SPACING * U) return no('рядом уже есть шкаф прав (' + Math.round(d / U) + ' м)');
      }
      const who = occupied(k, s); if (who) return no('мешает: ' + who + ' стоит на месте');
      return { ok: true };
    };

    // ── Тела детали в физике (+ лестница под люком) ──
    function body(p){
      for (const c of p.cols) ph.remove(c);
      p.cols = [];
      const c = Math.cos(p.yaw), s = Math.sin(p.yaw), floor = p.tier === 'twig' || p.tier === 'wood' ? 'wood' : 'metal';
      for (const b of boxes(p.kind, p.tier, p.open, !!p.lock, G.tileM, false)) {
        if (!b.solid) continue;
        const lx = b.x * U, lz = b.z * U;
        p.cols.push(ph.addBox({ x: p.x + c * lx + s * lz, y: p.y + b.y * U, z: p.z - s * lx + c * lz, hx: b.w * U / 2, hy: b.h * U / 2, hz: b.d * U / 2,
          yaw: p.yaw + b.yaw, tag: 'build', data: { piece: p, cam: true, floor } }));
      }
      if (p.kind === 'hatch' && p.level > 0 && E.ladder) {
        const at = (x, z) => ({ x: p.x + c * x * U + s * z * U, z: p.z - s * x * U + c * z * U });
        const r = at(0, -.35), ex = at(-.95, 0);
        p.cols.push(E.ladder(ph, { x: r.x, z: r.z, yaw: p.yaw, bottom: p.y - HU, top: p.y, exit: { x: ex.x, y: p.y, z: ex.z } }).zone);
      }
    }
    const clampTier = (k, t) => TIERS[Math.max(ti(D.placeTier(k)), Math.min(ti(D.maxTier(k)), Math.max(0, ti(t))))];

    // ── Поставить ──
    G.place = (k, s, builder, o = {}) => {
      if (!o.force) {
        const v = G.validate(k, s, builder);
        if (!v.ok) return v;
      }
      const tier = clampTier(k, o.tier || D.placeTier(k)), cost = D.cost(k, tier);
      if (o.inv && !o.force && !o.inv.pay(cost)) return { ok: false, why: 'не хватает: ' + D.costText(cost) };
      const p = { id: o.id || ++G.seq, kind: k, tier, cls: s.cls, tx: s.tx, tz: s.tz, level: s.level, dir: s.dir, x: s.x, y: s.y, z: s.z, yaw: s.yaw,
        owner: builder, ownerName: o.ownerName || builder, hp: o.hp ?? D.maxHp(k, tier), open: !!o.open, lock: o.lock || null,
        auth: o.auth ? [...o.auth] : k === 'cupboard' && builder ? [builder] : [], upkeep: o.upkeep || 0, placedAt: o.placedAt ?? G.now, cols: [] };
      p.key = G.key(p.cls, p.tx, p.tz, p.level, p.dir);
      G.pieces.set(p.key, p); G.list.push(p);
      body(p);
      emit('add', p);
      return { ok: true, piece: p, cost };
    };
    G.remove = (p, why = 'remove') => {
      if (!G.pieces.has(p.key)) return;
      for (const c of p.cols) ph.remove(c);
      p.cols = [];
      G.pieces.delete(p.key); G.list.splice(G.list.indexOf(p), 1);
      emit('remove', { piece: p, why });
      // проём снесли — вставка в нём падает
      if (p.cls === 'edge') { const ins = G.get('insert', p.tx, p.tz, p.level, p.dir); if (ins) G.remove(ins, why); }
    };
    const changed = p => { body(p); emit('change', p); };
    G.setTier = (p, t) => { const frac = G.hp01(p); p.tier = t; p.hp = Math.max(frac, .25) * D.maxHp(p.kind, t); changed(p); };

    // ── Открыть/закрыть (ServerToggle) ──
    G.toggle = (p, who) => {
      if (!D.openable(p.kind)) return { ok: false };
      if (p.lock?.locked && !G.authorized(who, p)) return { ok: false, msg: 'Заперто — нужен код', needCode: true };
      p.open = !p.open; changed(p); emit('toggle', p);
      return { ok: true, open: p.open };
    };

    // ── Действия над деталью (PlayerCrafting.ServerPieceAction) ──
    G.act = (p, a, who, arg, inv) => {
      const mine = G.authorized(who, p), age = G.now - p.placedAt, res = (ok, msg, x) => ({ ok, msg, ...x });
      switch (a) {
        case 'toggle': { const r = G.toggle(p, who); return res(r.ok, r.msg, r); }
        case 'upgrade': {
          const pr = G.canBuildAt(who, p); if (!pr.ok) return res(false, pr.why);
          if (ti(p.tier) >= ti(D.maxTier(p.kind))) return res(false, 'выше уровня нет');
          const next = TIERS[ti(p.tier) + 1], cost = D.cost(p.kind, next);
          if (inv && !inv.pay(cost)) return res(false, 'не хватает: ' + D.costText(cost));
          G.setTier(p, next);
          return res(true, 'Улучшено: ' + D.name(p.kind) + ' → ' + D.tierName(next));
        }
        case 'rotate': {
          if (!mine) return res(false, 'не твоё');
          if (age > D.ROTATE_WINDOW) return res(false, 'повернуть можно только первую минуту');
          if (p.cls === 'insert' || (p.cls === 'edge' && G.get('insert', p.tx, p.tz, p.level, p.dir))) return res(false, 'сначала сними дверь/решётку');
          p.yaw += p.cls === 'edge' ? Math.PI : Math.PI / 2;
          changed(p); return res(true, 'Повёрнуто');
        }
        case 'repair': {
          const pr = G.canBuildAt(who, p); if (!pr.ok) return res(false, pr.why);
          const miss = 1 - G.hp01(p);
          if (miss < .01) return res(false, 'цело');
          const cost = {}; for (const [id, n] of Object.entries(D.cost(p.kind, p.tier))) cost[id] = Math.max(1, Math.ceil(n * miss * .5));
          if (inv && !inv.pay(cost)) return res(false, 'на ремонт не хватает: ' + D.costText(cost));
          p.hp = D.maxHp(p.kind, p.tier); changed(p); return res(true, 'Починено');
        }
        case 'demolish': {
          if (!mine) return res(false, 'чужое — только сломать');
          if (age > D.DEMOLISH_WINDOW && p.kind !== 'cupboard') return res(false, 'разобрать можно 10 минут после постройки');
          const back = {}; for (const [id, n] of Object.entries(D.cost(p.kind, p.tier))) back[id] = Math.max(1, Math.floor(n / 2));
          if (p.lock) back.codelock = (back.codelock || 0) + 1;
          if (inv) for (const [id, n] of Object.entries(back)) inv.give(id, n);
          const nm = D.name(p.kind);
          G.remove(p, 'demolish');
          return res(true, 'Разобрано: ' + nm + ' (половина вернулась)', { back });
        }
        case 'addlock':
          if (!D.lockable(p.kind)) return res(false, 'замок — на дверь, люк или заслонку');
          if (!mine) return res(false, 'не твоё');
          if (p.lock) return res(false, 'замок уже стоит');
          if (!D.validCode(arg)) return res(false, 'код — 4 цифры');
          if (inv && !inv.take('codelock', 1)) return res(false, 'нужен кодовый замок');
          p.lock = { code: String(arg), locked: true, wrong: 0, until: 0, start: -99 }; p.auth = [who];
          changed(p); return res(true, 'Замок поставлен, код задан');
        case 'setcode':
          if (!p.lock || !mine) return res(false, 'замок не твой');
          if (!D.validCode(arg)) return res(false, 'код — 4 цифры');
          p.lock.code = String(arg); p.auth = [who];   // как в Rust: новый код — старые допуски сброшены
          return res(true, 'Код сменён — допуски сброшены');
        case 'trycode': {   // верно — допуск; 3 ошибки за 15 с — замок на 5 с
          if (!p.lock) return res(false, 'замка нет');
          const L = p.lock;
          if (G.now < L.until) return res(false, 'замок заблокирован (' + Math.ceil(L.until - G.now) + ' с)', { buzz: true });
          if (D.validCode(arg) && String(arg) === L.code) { if (!p.auth.includes(who)) p.auth.push(who); L.wrong = 0; return res(true, 'Код верный — доступ открыт'); }
          if (G.now - L.start > 15) { L.start = G.now; L.wrong = 0; }
          if (++L.wrong >= 3) { L.until = G.now + 5; L.wrong = 0; emit('lockout', p); }
          return res(false, 'Неверный код', { buzz: true });
        }
        case 'lock': case 'unlock':
          if (!p.lock || !mine) return res(false, 'замок не твой');
          p.lock.locked = a === 'lock'; changed(p);
          return res(true, a === 'lock' ? 'Заперто' : 'Отперто');
        case 'removelock':
          if (!p.lock || !mine) return res(false, 'замок не твой');
          p.lock = null; p.auth = []; if (inv) inv.give('codelock', 1);
          changed(p); return res(true, 'Замок снят');
        case 'authorize': {
          if (p.kind !== 'cupboard') return res(false, '');
          if (p.auth.includes(who)) return res(false, 'ты уже допущен');
          if (p.auth.length && !G.authorized(who, p)) return res(false, 'чужой шкаф — допуск только для его команды');
          p.auth.push(who); return res(true, 'Допущен к стройке рядом');
        }
        case 'clearauth':
          if (p.kind !== 'cupboard' || !mine) return res(false, 'чужой шкаф');
          p.auth = [who]; return res(true, 'Список допуска очищен (остался ты)');
        case 'deposit': {
          if (p.kind !== 'cupboard') return res(false, '');
          const n = inv ? Math.min(5, inv.count('scrap')) : 5;
          if (n <= 0) return res(false, 'нет металлолома');
          if (inv) inv.take('scrap', n);
          p.upkeep += n; return res(true, 'В шкаф: металлолом ×' + n + ' (содержание базы)');
        }
      }
      return res(false, 'неизвестное действие');
    };

    // ── Урон (множитель рейда), содержание и гниение ──
    G.damage = (p, amount, type = 'blunt', from = 'player') => {
      if (!G.pieces.has(p.key)) return 0;
      const was = G.hp01(p), d = amount * D.raidMul(type, from, p.tier);
      p.hp -= d;
      if (p.hp <= 0) { p.hp = 0; G.remove(p, 'broken'); emit('broken', p); return d; }
      if ((was >= .5) !== (G.hp01(p) >= .5)) emit('change', p);
      return d;
    };
    G.decayTick = minutes => {
      for (const p of [...G.list]) {
        const cup = G.cupboardAt(p), need = D.upkeepPerHour(p.kind, p.tier) / 60 * minutes;
        if (cup && cup.upkeep >= need) { cup.upkeep -= need; continue; }
        const loss = D.maxHp(p.kind, p.tier) * D.decayPerMin(p.tier) * minutes;
        if (loss <= 0) continue;
        if (p.hp - loss <= 1) { G.remove(p, 'decay'); emit('broken', p); }
        else { const was = G.hp01(p); p.hp -= loss; if ((was >= .5) !== (G.hp01(p) >= .5)) emit('change', p); }
      }
    };
    G.tick = dt => {
      G.now += dt;
      if (!G.decay) return;
      G._acc += dt;
      while (G._acc >= 60) { G._acc -= 60; G.decayTick(1); }
    };

    // ── Подсказка (BuildPiece.InteractPrompt) ──
    G.prompt = (p, who, crouching) => {
      const cap = s => s[0].toUpperCase() + s.slice(1);
      const title = `${cap(D.name(p.kind))} (${D.tierName(p.tier)}) ${Math.round(G.hp01(p) * 100)}%`;
      if (crouching) return 'Меню: ' + title;
      if (p.kind === 'cupboard') return 'Шкаф прав · металлолом на содержание: ' + (Math.round(p.upkeep * 10) / 10);
      if (D.openable(p.kind)) {
        if (p.lock?.locked && !G.authorized(who, p)) return 'Заперто — ввести код (' + D.name(p.kind) + ')';
        return (p.open ? 'закрыть ' : 'открыть ') + D.name(p.kind) + (p.lock ? ' · кодовый замок' : '');
      }
      return title + ' — ' + (p.ownerName || p.owner || '?') + ' · присядь + действие: меню';
    };

    // ── Сохранить / загрузить ──
    G.save = () => ({ v: 1, tile: G.tileM, pieces: G.list.map(p => [KINDS.indexOf(p.kind), ti(p.tier), p.tx, p.tz, p.level, p.dir,
      Math.round(p.yaw / (Math.PI / 2)) & 3, p.open ? 1 : 0, Math.round(p.hp), p.owner || '', p.ownerName || '',
      p.lock ? [p.lock.code, p.lock.locked ? 1 : 0] : 0, p.auth, Math.round(p.upkeep * 10) / 10, Math.round(G.now - p.placedAt)]) });
    G.load = data => {
      for (const p of [...G.list]) G.remove(p, 'load');
      for (const a of data?.pieces || []) {
        const k = KINDS[a[0]], cls = D.slot(k); if (!k) continue;
        const s = { cls, tx: a[2], tz: a[3], level: a[4], dir: a[5], yaw: (a[6] & 3) * Math.PI / 2 };
        Object.assign(s, cls === 'edge' || cls === 'insert' ? G.edgeCenter(s.tx, s.tz, s.dir, s.level) : G.tileCenter(s.tx, s.tz, s.level));
        G.place(k, s, a[9], { force: true, tier: TIERS[a[1]], open: !!a[7], hp: a[8], ownerName: a[10], lock: a[11] ? { code: a[11][0], locked: !!a[11][1], wrong: 0, until: 0, start: -99 } : null,
          auth: a[12] || [], upkeep: a[13] || 0, placedAt: G.now - (a[14] || 0) });
      }
    };
    return G;
  }

  // ═══ Рисование (Three.js): одна сетка на (вид, уровень, открыто, замок) — общая для всех таких деталей ═══
  function view(R, G){
    const T = R.T, K = R.K, geos = new Map(), meshes = new Map(), tex = new Map();
    // Текстуры уровней кодом (плитка = 1 м): каркас — жерди, доски — с гвоздями, металл — листы с заклёпками, броня — плиты
    function tierTex(tier){
      if (tex.has(tier)) return tex.get(tier);
      const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
      const g = c.getContext('2d'), rnd = E.rng(17 + ti(tier) * 31), fill = col => { g.fillStyle = col; g.fillRect(0, 0, N, N); };
      if (tier === 'twig') {
        fill('#b89e6b');
        for (let x = 0; x < N; x += 16) {
          g.fillStyle = `hsl(36,${30 + rnd() * 15 | 0}%,${50 + rnd() * 12 | 0}%)`; g.fillRect(x + 2, 0, 13, N);
          g.fillStyle = 'rgba(60,40,20,.6)'; g.fillRect(x, 0, 2, N);
          for (let i = 0; i < 24; i++) { g.fillStyle = `rgba(80,58,30,${.15 + rnd() * .25})`; g.fillRect(x + 3 + rnd() * 11, rnd() * N, 1, 3 + rnd() * 9); }
        }
        g.fillStyle = 'rgba(70,50,25,.7)'; g.fillRect(0, 30, N, 3); g.fillRect(0, 94, N, 3);   // обвязка
      } else if (tier === 'wood') {
        fill('#3a2616');
        for (let y = 0; y < N; y += 32) {
          g.fillStyle = `hsl(${24 + rnd() * 8 | 0},${38 + rnd() * 10 | 0}%,${30 + rnd() * 9 | 0}%)`; g.fillRect(0, y + 1, N, 30);
          g.strokeStyle = 'rgba(30,16,6,.35)'; g.lineWidth = 1;
          for (let i = 0; i < 9; i++) { const yy = y + 3 + rnd() * 26; g.beginPath(); g.moveTo(0, yy); g.bezierCurveTo(N * .3, yy + rnd() * 4 - 2, N * .6, yy + rnd() * 4 - 2, N, yy); g.stroke(); }
          for (const x of [5, N - 8]) { g.fillStyle = '#1d1d1d'; g.fillRect(x, y + 7, 3, 3); g.fillRect(x, y + 22, 3, 3); }
        }
      } else if (tier === 'metal') {
        fill('#6c7177');
        for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${rnd() * .07})`; g.fillRect(0, rnd() * N, N, 1); }
        for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(140,70,25,${.08 + rnd() * .12})`; g.beginPath(); g.arc(rnd() * N, rnd() * N, 4 + rnd() * 10, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(20,22,25,.75)'; g.fillRect(0, 63, N, 2); g.fillRect(63, 0, 2, N);
        for (let x = 6; x < N; x += 14) for (const y of [4, 59, 68, 123]) { g.fillStyle = '#44484e'; g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(x - 1, y - 1, 1, 1); }
      } else {
        fill('#34373b');
        for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(0,0,0,${rnd() * .12})`; g.fillRect(rnd() * N, rnd() * N, 3, 3); }
        g.fillStyle = 'rgba(0,0,0,.65)'; for (const p of [0, 64]) { g.fillRect(0, p, N, 3); g.fillRect(p, 0, 3, N); }
        g.strokeStyle = 'rgba(170,170,170,.35)'; for (let i = 0; i < 14; i++) { const x = rnd() * N, y = rnd() * N; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd() * 20 - 10, y + rnd() * 8 - 4); g.stroke(); }
        for (let x = 8; x < N; x += 20) for (const y of [8, 56, 72, 120]) { g.fillStyle = '#5a5f65'; g.fillRect(x, y, 3, 3); }
      }
      const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.encoding = T.sRGBEncoding; t.anisotropy = 4;
      tex.set(tier, t); return t;
    }
    const matCache = new Map();
    const mat = (key, make) => matCache.get(key) || (matCache.set(key, make()), matCache.get(key));
    const mainMat = (tier, damaged) => mat(tier + (damaged ? '!' : ''), () => new T.MeshToonMaterial({ map: tierTex(tier), color: damaged ? '#9a9187' : '#ffffff', gradientMap: K.grad }));
    const trimMat = () => mat('trim', () => new T.MeshToonMaterial({ color: '#3d4148', gradientMap: K.grad }));
    const lightMat = on => mat(on ? 'red' : 'green', () => new T.MeshBasicMaterial({ color: on ? '#e5281a' : '#2fd04a' }));
    const ghostMat = ok => mat(ok ? 'gok' : 'gbad', () => new T.MeshBasicMaterial({ color: ok ? '#4ade80' : '#f87171', transparent: true, opacity: .42, depthWrite: false }));

    // Грани коробки: (нормаль, ось u, ось v), u × v = нормаль — лицом наружу; UV в метрах (как в Unity)
    const FACES = [[[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    function geoOf(kind, tier, open, lock){
      const key = kind + '|' + tier + '|' + (open ? 1 : 0) + '|' + (lock ? 1 : 0);
      if (geos.has(key)) return geos.get(key);
      const subs = [[], [], []];   // по материалам: позиции, нормали, uv
      for (const b of boxes(kind, tier, open, lock, G.tileM, true)) {
        if (b.hidden) continue;
        const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw), cx = Math.cos(b.rx), sx = Math.sin(b.rx);
        const rot = v => { const y1 = v[1] * cx - v[2] * sx, z1 = v[1] * sx + v[2] * cx; return [v[0] * cy + z1 * sy, y1, -v[0] * sy + z1 * cy]; };
        const out = subs[Math.min(2, b.sub)];
        for (const [n, a, c] of FACES) {
          const wn = rot(n), wa = rot(a), wc = rot(c);
          const quad = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([sa, sc]) => {
            const lp = [(n[0] * .5 + a[0] * sa + c[0] * sc) * b.w, (n[1] * .5 + a[1] * sa + c[1] * sc) * b.h, (n[2] * .5 + a[2] * sa + c[2] * sc) * b.d];
            const r = rot(lp), p = [b.x + r[0], b.y + r[1], b.z + r[2]];
            return { p, u: p[0] * wa[0] + p[1] * wa[1] + p[2] * wa[2], v: p[0] * wc[0] + p[1] * wc[1] + p[2] * wc[2] };
          });
          for (const i of [0, 1, 2, 0, 2, 3]) { const q = quad[i]; out.push(q.p[0] * U, q.p[1] * U, q.p[2] * U, wn[0], wn[1], wn[2], q.u, q.v); }
        }
      }
      const count = subs.reduce((s, a) => s + a.length / 8, 0), pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
      const g = new T.BufferGeometry();
      let k = 0;
      subs.forEach((a, si) => {
        const start = k;
        for (let i = 0; i < a.length; i += 8) { pos.set(a.slice(i, i + 3), k * 3); nor.set(a.slice(i + 3, i + 6), k * 3); uv.set(a.slice(i + 6, i + 8), k * 2); k++; }
        if (k > start) g.addGroup(start, k - start, si);
      });
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.computeBoundingSphere();
      geos.set(key, g);
      return g;
    }
    const matsOf = p => [mainMat(p.tier, G.hp01(p) < .5), trimMat(), lightMat(!!p.lock?.locked)];
    function add(p){
      const m = new T.Mesh(geoOf(p.kind, p.tier, p.open, !!p.lock), matsOf(p));
      m.position.set(p.x, p.y, p.z); m.rotation.y = p.yaw; m.userData.piece = p;
      R.scene.add(m); meshes.set(p, m);
    }
    function upd(p){ const m = meshes.get(p); if (!m) return add(p); m.geometry = geoOf(p.kind, p.tier, p.open, !!p.lock); m.material = matsOf(p); m.position.set(p.x, p.y, p.z); m.rotation.y = p.yaw; }
    function del({ piece }){ const m = meshes.get(piece); if (m) { R.scene.remove(m); meshes.delete(piece); } }
    const offs = [G.on('add', add), G.on('change', upd), G.on('remove', del)];
    for (const p of G.list) add(p);

    // «Призрак» — где встанет деталь: зелёный — можно, красный — нельзя
    let ghost = null;
    const V = {
      meshes,
      ghost(kind, slot, ok, tier){
        if (!kind || !slot) { if (ghost) ghost.visible = false; return; }
        const g = geoOf(kind, tier || D.placeTier(kind), false, false);
        if (!ghost) { ghost = new T.Mesh(g, ghostMat(ok)); ghost.renderOrder = 5; R.scene.add(ghost); }
        ghost.geometry = g; ghost.material = ghostMat(ok); ghost.visible = true;
        ghost.position.set(slot.x, slot.y, slot.z); ghost.rotation.y = slot.yaw;
      },
      pick(o){ const m = meshes; for (const [p, mesh] of m) if (mesh === o) return p; return null; },
      dispose(){
        offs.forEach(f => f());
        for (const m of meshes.values()) R.scene.remove(m);
        meshes.clear();
        if (ghost) R.scene.remove(ghost);
        for (const g of geos.values()) g.dispose();
        for (const t of tex.values()) t.dispose();
        for (const m of matCache.values()) m.dispose();
      },
    };
    return V;
  }

  E.build = { defs: D, boxes, grid, view };
})();

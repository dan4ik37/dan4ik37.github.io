// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — обрушение и прочность («держание», как в Valheim) — D37E.support: одно ядро для 2D и 3D игр
// ═══════════════════════════════════════
// Без Three.js и DOM: окно, поток (Worker) и node (scripts/support-test.cjs). Только целые числа и постоянный порядок обхода —
// у всех игроков один и тот же итог (по сети достаточно события «сломана опора» с зерном). Без мусора: все массивы —
// заранее (рабочий набор на игру), расчёт — только по событию (сломали, поставили), не каждый кадр.
// Держание s — 0…1000 (‰, на земле = cap материала). Материал (S.MATS): cap — держание на опоре, min — меньше — не держится,
// up / side / down — сколько теряется за шаг: стоит на соседе / держится за соседа сбоку / висит под соседом; bear: 0 — сам
// держится, но других не держит (стекло, окно). Опора («якорь») — земля, скала, фундамент: сосед-якорь даёт cap сразу.
// Режимы (S.MODES): soft — «мягкое» (потери вверх ×¼, вбок и вниз ×½), real — «реализм» (как в таблице); off — выключено.
// Пересчёт — только рядом: связный кусок от места правки (обход в ширину, предел узлов; дальше — как опора: лучше «держится»,
// чем внезапно рухнуть; опора за краем куска держит только снизу и сбоку, не сверху). Что падает: держался ДО правки (s ≥ min) и не держится ПОСЛЕ — то, что и раньше «не держалось» по
// расчёту (старые постройки, природные пещеры, импорт), не трогаем. Падает группами (связные куски) — игра роняет их одним
// целым (fallGroup) или бьёт на обломки (destruct.js).
//   G = S.grid({ dims: 3 | 2, down: −1 | +1, max }) — клетки (кубики «Кубомира», плитки «Подземья»):
//     G.build(seeds, read, { r, rn, max }) — seeds: [x, y, z, код, …] (код — как у read: удалённые клетки — их прежний код);
//     read(x, y, z) → код: 0 пусто, 1 опора, (материал << 2) | 2 — постройка, (материал << 2) | 3 — природное (дальше rn шагов
//     от правки — опора); дальше r шагов — опора. → число узлов (−1 — нет места)
//     G.collapse(P) — «до» (семена на месте) и «после» (семян нет) → число групп; G.groups(k) / G.gOff, G.gList — узлы групп
//     G.estimate(P) — держание первого семени (поставить блок: хватит ли опоры); G.solve(P, без семян) — держание всех (G.g.sup)
//   B = S.boxes({ max }) — детали-коробки («Студия 3D», здания «Мира Денчика»): B.add(x0, y0, z0, x1, y1, z1, материал, на земле)
//     → номер; B.link(eps) — касания (сверху / сбоку); дальше — как у сетки: B.collapse(P, сломанные), B.solve(P)
//   S.drop — падение целым куском по фиксированным шагам (одинаково при 30 / 60 / 144 кадрах): S.dropStep(F, dt, cells, solid)
//   S.level(s, m, P, на земле) → 0 синий (на земле) · 1 зелёный · 2 жёлтый · 3 красный · 4 не держится; S.color(...) → 0xRRGGBB
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  const S = E.support = E.support || {};
  S.VERSION = 2;   // 1 — держание (v1); 2 — + нагрузка (v2, только миры с load: 1, см. ниже «v2»)
  S.LOAD = true;   // v2 (T-124): false — откат одной строкой: у всех миров v1 как было (не «обрушение выкл»)
  const MAXV = S.MAXV = 1000;

  // ═══ Материалы: ‰ за шаг (дерево слабее, камень и бетон крепче, металл — лучше всех вбок; вбок теряется больше, чем вверх) ═══
  // Шагов до «не держится» (реализм): дерево — 25 вверх / 6 вбок, камень — 45 / 4, кирпич — 50 / 5, бетон — 75 / 7, металл —
  // 110 / 13, стекло — 15 / 3; природное (скала, грунт) вверх не теряет — своды пещер держатся вбок на 9 / 3 клетки от стены.
  const MATS = S.MATS = [];
  const MAT = S.MAT = {};
  // v2 load columns (STRUCTURE_HAZARDS.md §3, start values signed at SH0): [mass_cell kg, load_comp kg, load_bend kg·m, load_hang kg,
  // load_none]; an empty column gets a derived default (comp = mass × 50, bend = mass × 5, hang = mass × 4); natural rows never fail by load
  const LOADV = { wood: [650, 60000, 3600, 3000], stone: [2400, 400000, 3200, 1500], brick: [1920, 300000, 2500, 1200], concrete: [2400, 600000, 8000, 4000],
    metal: [7800, 1500000, 160000, 120000], glass: [2500, 125000, 3000, 0], dirt: [900, 80000, 1000, 500], sand: [1600, 60000, 500, 0], snow: [900, 6000, 300, 0],
    rock: [2690, 0, 0, 0, 1], soil: [1500, 0, 0, 0, 1], slab: [2400, 600000, 60000, 30000], steel: [2500, 3000000, 400000, 300000] };
  const lnum = (v, def) => { if (v === undefined || v === null || v === '') return def; v = Math.round(+v); return isFinite(v) && v >= 0 ? Math.min(v, 2 ** 30) : def; };
  S.defineMat = d => {
    if (!d || !d.key) throw new Error('материал без имени');
    if (MAT[d.key] !== undefined) return MAT[d.key];
    if (MATS.length >= 250) throw new Error('слишком много материалов прочности');
    const m = Object.assign({ title: d.key, icon: '🧱', cap: MAXV, min: 100, up: 30, side: 150, down: 220, bear: 1, nat: 0 }, d);
    for (const k of ['cap', 'min', 'up', 'side', 'down']) m[k] = Math.max(0, Math.min(MAXV, Math.round(+m[k] || 0)));
    m.min = Math.max(1, m.min); m.bear = m.bear ? 1 : 0;
    const LV = LOADV[d.key] || [];
    m.mass = Math.max(1, lnum(d.mass ?? d.mass_cell, LV[0] ?? 1000));
    m.lnone = (d.lnone ?? d.load_none ?? LV[4] ?? (m.nat ? 1 : 0)) ? 1 : 0;
    const LC = 2 ** 30;
    m.comp = lnum(d.comp ?? d.load_comp, LV[1] ?? Math.min(LC, m.mass * 50)); m.bend = lnum(d.bend ?? d.load_bend, LV[2] ?? Math.min(LC, m.mass * 5)); m.hang = lnum(d.hang ?? d.load_hang, LV[3] ?? Math.min(LC, m.mass * 4));
    m.id = MATS.length; MATS.push(m); MAT[m.key] = m.id;
    profs.clear();
    return m.id;
  };
  const profs = new Map();
  const M = S.defineMat;
  M({ key: 'wood', title: 'Дерево', icon: '🪵', up: 35, side: 150, down: 220 });
  M({ key: 'stone', title: 'Камень', icon: '🪨', up: 20, side: 220, down: 320 });
  M({ key: 'brick', title: 'Кирпич', icon: '🧱', up: 18, side: 180, down: 260 });
  M({ key: 'concrete', title: 'Бетон', icon: '⬜', up: 12, side: 120, down: 180 });
  M({ key: 'metal', title: 'Металл', icon: '⚙️', up: 8, side: 70, down: 90 });
  M({ key: 'glass', title: 'Стекло', icon: '🪟', up: 60, side: 300, down: 450, bear: 0 });
  M({ key: 'dirt', title: 'Земля', icon: '🟤', up: 50, side: 450, down: 900 });
  M({ key: 'sand', title: 'Песок', icon: '🏖️', up: 50, side: 900, down: 900 });
  M({ key: 'snow', title: 'Снег', icon: '❄️', up: 80, side: 450, down: 900 });
  // природное: вверх без потерь (толща держится столбом), вбок — свод пещеры; висит плохо (подкопанная скала под крепким сводом — 1–2 клетки)
  M({ key: 'rock', title: 'Скала (природная)', icon: '⛰️', up: 0, side: 100, down: 450, nat: 1 });
  M({ key: 'soil', title: 'Грунт (природный)', icon: '🌱', up: 0, side: 300, down: 900, nat: 1 });
  M({ key: 'slab', title: 'Плита перекрытия', icon: '▭', min: 300, up: 12, side: 450, down: 500 });
  M({ key: 'steel', title: 'Сталь и железобетон', icon: '🛡', up: 3, side: 25, down: 30 });
  S.VANILLA = MATS.length;
  S.mat = key => MAT[key] ?? MAT.stone;

  // ═══ Режимы и таблицы для расчёта (по режиму — один раз) ═══
  S.MODES = { off: null, soft: { up: .25, side: .5, down: .5 }, real: { up: 1, side: 1, down: 1 } };
  S.MODE_NAMES = { off: 'Выкл (как было)', soft: 'Мягкое', real: 'Реализм' };
  S.on = mode => !!S.MODES[mode];
  S.prof = mode => {
    const k = typeof mode === 'string' ? mode : JSON.stringify(mode);
    let P = profs.get(k);
    if (P) return P;
    const mul = typeof mode === 'string' ? S.MODES[mode] || S.MODES.real : mode, n = MATS.length;
    P = { mode: k, cap: new Uint16Array(n), min: new Uint16Array(n), up: new Uint16Array(n), side: new Uint16Array(n), down: new Uint16Array(n), bear: new Uint8Array(n) };
    // v2: capacities (soft × 2 — SH1 calibration: with the × 3 start value a 5-long wood cantilever out of a cliff stood in soft;
    // G7 wants it to fall in soft and real), sway ‰ per cell of load height (real 50, soft 25)
    const lk = mode === 'soft' ? 2 : typeof mode === 'string' ? 1 : (mul.load ?? 1);
    P.sway = mode === 'soft' ? 25 : typeof mode === 'string' ? 50 : (mul.sway ?? 50);
    P.mass = new Float64Array(n); P.comp = new Float64Array(n); P.bend = new Float64Array(n); P.hang = new Float64Array(n); P.lnone = new Uint8Array(n);
    for (const m of MATS) {
      const i = m.id;
      P.cap[i] = m.cap; P.min[i] = m.min; P.bear[i] = m.bear;
      P.up[i] = Math.round(m.up * (mul.up ?? 1)); P.side[i] = Math.max(1, Math.round(m.side * (mul.side ?? 1))); P.down[i] = Math.max(1, Math.round(m.down * (mul.down ?? 1)));
      P.mass[i] = m.mass; P.lnone[i] = m.lnone; P.comp[i] = Math.round(m.comp * lk); P.bend[i] = Math.round(m.bend * lk); P.hang[i] = Math.round(m.hang * lk);
    }
    profs.set(k, P);
    return P;
  };

  // ═══ Цвет устойчивости (как в Valheim): синий — на опоре, зелёный → жёлтый → красный, тёмно-красный — не держится ═══
  S.COLORS = [0x3b82f6, 0x22c55e, 0xeab308, 0xef4444, 0x7f1d1d];
  S.LEVEL_NAMES = ['на опоре', 'крепко', 'держится', 'еле держится', 'не держится'];
  S.level = (s, m, P, gnd) => {
    if (!P) return 0;
    const cap = P.cap[m] || MAXV, mn = P.min[m] || 1;
    if (s < mn) return 4;
    if ((gnd === true || (gnd & 1)) && s >= Math.min(cap, MAXV - P.up[m])) return 0;   // стоит прямо на опоре
    const t = (s - mn) / Math.max(1, cap - mn);
    return t >= .66 ? 1 : t >= .33 ? 2 : 3;
  };
  S.color = (s, m, P, gnd) => S.COLORS[S.level(s, m, P, gnd)];
  S.pct = (s, m, P) => P ? Math.max(0, Math.min(100, Math.round(s * 100 / (P.cap[m] || MAXV)))) : 100;

  // ═══ Граф: узлы (материал, «на опоре»), рёбра по источнику (CSR), расчёт держания (очередь по корзинам, целые) ═══
  // ребро u → w хранит rel — кем w приходится u: 0 — снизу (u стоит на w), 1 — сбоку, 2 — сверху (u висит под w); держание от u
  // к w теряет w-шное: w сверху — up (стоит на u), сбоку — side, снизу — down (висит под u)
  function graph(max, deg){
    const g = {
      max, n: 0, ne: 0,
      mat: new Uint8Array(max), gnd: new Uint8Array(max), init: new Uint16Array(max), seed: new Uint8Array(max), off: new Int32Array(max + 1), adj: new Int32Array(max * deg),
      sup: new Uint16Array(max), sup0: new Uint16Array(max), dis: new Uint8Array(max), done: new Uint8Array(max), fall: new Uint8Array(max),
      nxt: new Int32Array(max), prv: new Int32Array(max), head: new Int32Array(MAXV + 1), gid: new Int32Array(max), gList: new Int32Array(max), gOff: new Int32Array(max + 1), ng: 0,
      q: new Int32Array(max),
      anc: new Uint8Array(max), bnd: new Uint8Array(max), estb: new Uint8Array(max), estv: null,   // v2: опора по направлениям (настоящая / край куска / оценка природного)
    };
    g.reset = () => { g.n = 0; g.ne = 0; g.off[0] = 0; g.ng = 0; };
    // ── держание всех узлов: dis[i] = 1 — узла нет (сломан) ──
    // корзины по держанию: двусвязные списки (без мусора: функции — одни на граф)
    const head = g.head, nxt = g.nxt, prv = g.prv;
    function ins(i, v){ const h = head[v]; nxt[i] = h; prv[i] = -1; if (h >= 0) prv[h] = i; head[v] = i; }
    function del(i, v){ const a = prv[i], b = nxt[i]; if (a >= 0) nxt[a] = b; else head[v] = b; if (b >= 0) prv[b] = a; }
    g.solve = (P, useDis) => {
      const n = g.n, sup = g.sup, mat = g.mat, done = g.done, dis = g.dis, off = g.off, adj = g.adj;
      const cap = P.cap, up = P.up, side = P.side, down = P.down, bear = P.bear;
      head.fill(-1);
      // опора — как сосед с держанием 1000: gnd — биты, где она: 1 — снизу (стоит), 2 — сбоку, 4 — сверху (висит); init — держание
      // от природного за краем куска (оценка: толща под ним или стена пещеры по прямой)
      const init = g.init;
      for (let i = 0; i < n; i++) {
        sup[i] = 0; done[i] = 0;
        if (useDis && dis[i]) { done[i] = 1; continue; }
        const gd = g.gnd[i], m = mat[i];
        let c = 0;
        if (gd & 1) c = MAXV - up[m];
        if (gd & 2 && MAXV - side[m] > c) c = MAXV - side[m];
        if (gd & 4 && MAXV - down[m] > c) c = MAXV - down[m];
        if (init[i] > c) c = init[i];
        if (c > cap[m]) c = cap[m];
        if (c > 0) { sup[i] = c; ins(i, c); }
      }
      for (let v = MAXV; v >= 1; v--) {
        let u = head[v];
        while (u >= 0) {
          del(u, v); done[u] = 1;
          if (bear[mat[u]]) {
            for (let k = off[u], e = off[u + 1]; k < e; k++) {
              const a = adj[k], w = a >> 2;
              if (done[w]) continue;
              const r = a & 3, m = mat[w];   // r — кто w для u: 2 — сверху (w стоит на u), 0 — снизу (w висит под u)
              let c = v - (r === 2 ? up[m] : r === 1 ? side[m] : down[m]);
              if (c > cap[m]) c = cap[m];
              if (c > sup[w]) { if (sup[w] > 0) del(w, sup[w]); sup[w] = c; ins(w, c); }
            }
          }
          u = head[v];
        }
      }
      return n;
    };
    // ── что падает: держалось «до» (семена на месте) и не держится «после» (семян нет) → группы (связные куски) ──
    g.collapse = P => {
      const n = g.n, mat = g.mat, min = P.min, fall = g.fall, sup = g.sup, sup0 = g.sup0, gid = g.gid, gList = g.gList, gOff = g.gOff, q = g.q;
      for (let i = 0; i < n; i++) g.dis[i] = g.seed[i];
      g.solve(P, false); for (let i = 0; i < n; i++) sup0[i] = sup[i];
      g.solve(P, true);
      let nf = 0;
      for (let i = 0; i < n; i++) { const m = mat[i]; fall[i] = !g.seed[i] && sup0[i] >= min[m] && sup[i] < min[m] ? 1 : 0; gid[i] = -1; nf += fall[i]; }
      let ng = 0, at = 0;
      if (nf) for (let i = 0; i < n; i++) {
        if (!fall[i] || gid[i] >= 0) continue;
        gOff[ng] = at; let qh = 0, qt = 0; q[qt++] = i; gid[i] = ng;
        while (qh < qt) {
          const u = q[qh++]; gList[at++] = u;
          for (let k = g.off[u], e = g.off[u + 1]; k < e; k++) { const w = g.adj[k] >> 2; if (fall[w] && gid[w] < 0) { gid[w] = ng; q[qt++] = w; } }
        }
        ng++;
      }
      gOff[ng] = at; g.ng = ng; g.nf = nf;
      return ng;
    };
    g.groupSize = k => g.gOff[k + 1] - g.gOff[k];
    return g;
  }
  S.graph = (max = 4096, deg = 8) => graph(max, deg);

  // ═══ Сетка клеток (3D — кубики, 2D — плитки): связный кусок от места правки, хеш-таблица без мусора ═══
  const NOT = -1, EMPTY = -2, ANCH = -3, ANCHB = -4, EST = -16;   // EST − e — природная клетка за краем куска с оценкой держания e; ANCHB — опора «край куска» (v1 — как ANCH)
  S.grid = (o = {}) => {
    const dims = o.dims === 2 ? 2 : 3, DOWN = o.down === 1 ? 1 : -1, max = Math.max(64, o.max | 0 || 24576), deg = dims === 2 ? 4 : 6;
    const g = graph(max, deg);
    const HB = o.hashBits || (max > 16384 ? 17 : max > 4096 ? 16 : 14), HS = 1 << HB, HM = HS - 1, HLIM = (HS * .7) | 0;
    const keys = new Int32Array(HS), vals = new Int32Array(HS), stamp = new Uint16Array(HS);
    const px = new Int32Array(max), py = new Int32Array(max), pz = new Int32Array(max), dist = new Uint16Array(max);
    let gen = 0, used = 0, ox = 0, oy = 0, oz = 0, slot = 0;
    const G = { dims, down: DOWN, g, px, py, pz, dist, full: false };
    // направления: +x, −x, вверх, вниз, +z, −z (2D — без z); rel по «вниз»
    const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, -DOWN, DOWN, 0, 0], DZ = [0, 0, 0, 0, 1, -1], REL = [1, 1, 2, 0, 1, 1];
    const keyOf = (x, y, z) => { const a = x - ox + 512, b = y - oy + 512, c = dims === 2 ? 0 : z - oz + 512; return (a | b | c) & ~1023 ? -1 : a | (b << 10) | (c << 20); };
    function look(k){ let h = Math.imul(k, 0x9E3779B1) >>> (32 - HB); while (stamp[h] === gen) { if (keys[h] === k) return vals[h]; h = (h + 1) & HM; } slot = h; return NOT; }
    const put = (k, v) => { stamp[slot] = gen; keys[slot] = k; vals[slot] = v; used++; };
    G.at = (x, y, z = 0) => { const k = keyOf(x, y, z); if (k < 0) return -1; const v = look(k); return v >= 0 ? v : -1; };
    function add(x, y, z, code, d, isSeed){
      const i = g.n++;
      px[i] = x; py[i] = y; pz[i] = z; dist[i] = d; g.mat[i] = code >> 2; g.gnd[i] = 0; g.init[i] = 0; g.seed[i] = isSeed ? 1 : 0; g.anc[i] = 0; g.bnd[i] = 0; g.estb[i] = 0;
      return i;
    }
    // Природная клетка за краем куска (дальше rn шагов): держание не считаем целиком, а оцениваем — под ней толща (2 твёрдые
    // клетки) — как опора; иначе это свод или навес: держится за ближайшую стену по прямой в своём слое (стена — твёрдое с
    // твёрдым под ним), cap − side × до стены; стены нет ближе предела — 0 (ничего не держит). Так пересчёт по одной клетке
    // (игрок копает зал понемногу) видит и обвал середины широкого свода, и не роняет то, что держит дальняя стена.
    const solidC = c => c === 1 || c === 5 || (c & 3) >= 2;   // 5 — опора «не загружено» (v1 — как 1)
    const HD = [1, 0, -1, 0, 0, 1, 0, -1];
    // «толща» / «стена»: под клеткой 3 природные подряд (не подкопанный кусок под сводом, а столб до пола)
    const natC = c => c === 1 || c === 5 || (c & 3) === 3;   // природное или опора (поставленное под сводом — висит, не держит толщу)
    const col = (x, y, z, read) => natC(read(x, y + DOWN, z) | 0) && natC(read(x, y + 2 * DOWN, z) | 0) && natC(read(x, y + 3 * DOWN, z) | 0);
    function estimate(x, y, z, m, read, P){
      if (col(x, y, z, read)) return MAXV;
      const cap = P.cap[m], side = P.side[m], dmax = Math.min(40, ((cap - P.min[m]) / Math.max(1, side)) | 0);
      let best = 0;
      for (let h = 0; h < (dims === 2 ? 2 : 4); h++) {
        const dx = HD[h * 2], dz = HD[h * 2 + 1];
        for (let s = 1; s <= dmax; s++) {
          const ax = x + dx * s, az = z + dz * s, c = read(ax, y, az) | 0;
          if (!solidC(c)) break;
          if (col(ax, y, az, read)) { const e = cap - side * s; if (e > best) best = e; break; }
        }
      }
      return best;
    }
    const NOB = {};
    // построить кусок: семена (их код — какой был), обход в ширину; b — свои пределы (лучше один объект на игру — без мусора).
    // По частям (v2, задание с бюджетом): G.begin(семена, read, b), потом G.more(узлов) → true, когда кусок готов
    let bR = 64, bRn = 10, bLim = max, bP = null, bRead = null, bI = 0;
    G.begin = (seeds, read, b = NOB) => {
      bR = b.r ?? 64; bRn = b.rn ?? 10; bLim = Math.min(max, b.max || max); bP = b.P || null; bRead = read; bI = 0;
      if (++gen > 65535) { stamp.fill(0); gen = 1; }
      used = 0; g.reset(); G.full = false;
      const ns = seeds.length >> 2;
      if (!ns) return 0;
      ox = seeds[0]; oy = seeds[1]; oz = dims === 2 ? 0 : seeds[2];
      const lim = bLim;
      for (let s = 0; s < ns; s++) {
        const x = seeds[s * 4], y = seeds[s * 4 + 1], z = dims === 2 ? 0 : seeds[s * 4 + 2], code = seeds[s * 4 + 3];
        const k = keyOf(x, y, z); if (k < 0 || look(k) !== NOT) continue;
        if ((code & 3) < 2 || g.n >= lim) { put(k, code === 1 ? ANCH : code === 5 ? ANCHB : EMPTY); continue; }
        put(k, add(x, y, z, code, 0, true));
      }
      return g.n;
    };
    G.cursor = () => bI;
    G.more = (budget = 1 << 30) => {   // бюджет — целое (Smi): без чисел-объектов в цикле
      const read = bRead, r = bR, rn = bRn, lim = bLim, P = bP;
      let i = bI;
      for (; i < g.n && budget > 0; i++, budget--) {
        g.off[i] = g.ne;
        const x = px[i], y = py[i], z = pz[i], d = dist[i];
        for (let k6 = 0; k6 < deg; k6++) {
          const nx = x + DX[k6], ny = y + DY[k6], nz = z + DZ[k6];
          const k = keyOf(nx, ny, nz);
          if (k < 0) { if (REL[k6] !== 2) { g.gnd[i] |= REL[k6] === 0 ? 1 : 2; g.bnd[i] |= 1 << k6; } continue; }   // дальше 512 клеток — опора (снизу и сбоку)
          let v = look(k);
          if (v === NOT) {
            const c = read(nx, ny, nz) | 0, t = c & 3;
            if (t < 2) v = c === 1 ? ANCH : c === 5 ? ANCHB : EMPTY;
            else if (t === 3 && col(nx, ny, nz, read)) v = ANCH;   // природная толща (3 твёрдые под ней) — опора: обход идёт только по «коже» у пустот
            else if (t === 3 && d + 1 > rn && P) v = EST - estimate(nx, ny, nz, c >> 2, read, P);   // природное за краем — оценка
            else if (d + 1 > r || (t === 3 && d + 1 > rn) || g.n >= lim || used >= HLIM) { v = ANCHB; if (g.n >= lim || used >= HLIM) G.full = true; }
            else v = add(nx, ny, nz, c, d + 1, false);
            put(k, v);
          }
          if (v === ANCH || v === ANCHB) { g.gnd[i] |= REL[k6] === 0 ? 1 : REL[k6] === 1 ? 2 : 4; if (v === ANCH) g.anc[i] |= 1 << k6; else g.bnd[i] |= 1 << k6; }   // опора снизу / сбоку / сверху (висит)
          else if (v >= 0) g.adj[g.ne++] = (v << 2) | REL[k6];
          else if (v <= EST) {   // природное за краем: его оценка минус потеря этой клетки (стоит на нём / рядом / висит под ним)
            const e = EST - v, m = g.mat[i], rl = REL[k6], c = e - (rl === 0 ? P.up[m] : rl === 1 ? P.side[m] : P.down[m]);
            if (c > g.init[i]) g.init[i] = c;
            if (g.estv) { g.estb[i] |= 1 << k6; g.estv[i * 6 + k6] = e; }
          }
        }
      }
      bI = i;
      if (i < g.n) return false;
      g.off[g.n] = g.ne;
      return true;
    };
    G.build = (seeds, read, b = NOB) => { G.begin(seeds, read, b); if (!g.n) { g.off[0] = g.ne; return 0; } G.more(1 << 30); return g.n; };
    // ── v2 (нагрузка): геометрия куска для задания (S.loadJob) ──
    G.isGrid = true; G.HU = 2; G.dims2 = dims === 2;
    G.dirOf = (u, w) => { const dx = px[w] - px[u]; if (dx === 1) return 0; if (dx === -1) return 1; const dy = py[w] - py[u]; if (dy === -DOWN) return 2; if (dy === DOWN) return 3; return pz[w] - pz[u] === 1 ? 4 : 5; };
    G.lprep = (L, P, i0, i1, kg) => {
      const sg = -DOWN, d2 = dims === 2;
      for (let i = i0; i < i1; i++) {
        const x = px[i] - ox, h = (py[i] - oy) * sg, z = d2 ? 0 : pz[i] - oz;
        L.hx[i] = 2 * x; L.hy[i] = 2 * h; L.hz[i] = 2 * z; L.ex[i] = 1; L.ey[i] = 1; L.ez[i] = d2 ? 0 : 1;
        L.key[i] = (((h + 512) & 1023) << 20) | (((x + 512) & 1023) << 10) | ((z + 512) & 1023);
        L.w0[i] = Math.round(P.mass[g.mat[i]] * kg / 1000);
      }
    };
    G.topArea = () => 1;
    G.cutBend = (c, L, P) => { const m = g.mat[c]; if (L.stand[c] === 1 && L.standE[c] >= 0) { const w = g.adj[L.standE[c]] >> 2, mw = g.mat[w]; if (!P.lnone[mw]) return P.bend[mw]; } return P.bend[m]; };
    G.inPiece = (x, y, z = 0) => { const k = keyOf(x, y, z); return k >= 0 && look(k) !== NOT; };   // клетку уже читали (узел, пусто или опора)
    G.loadJob = () => G.J || (G.J = S.loadJob(G));
    G.solve = (P, noSeeds) => { for (let i = 0; i < g.n; i++) g.dis[i] = noSeeds ? g.seed[i] : 0; return g.solve(P, !!noSeeds); };
    G.collapse = P => g.collapse(P);
    G.estimate = P => { if (!g.n) return 0; G.solve(P, false); return g.sup[0]; };
    G.groups = k => { const a = g.gOff[k], b = g.gOff[k + 1], out = []; for (let j = a; j < b; j++) { const i = g.gList[j]; out.push(px[i], py[i], pz[i]); } return out; };
    return G;
  };

  // ═══ Детали-коробки: касания сверху и сбоку (развёртка по x), дальше — тот же граф ═══
  S.boxes = (o = {}) => {
    const max = Math.max(16, o.max | 0 || 4096), deg = o.deg || 24;
    const g = graph(max, deg);
    const bx = new Float64Array(max * 6), ord = new Int32Array(max), act = new Int32Array(max), ea = [], eb = [], er = [];
    const B = { g, n: 0, bx, over: false };
    B.reset = () => { B.n = 0; g.reset(); B.over = false; };
    B.add = (x0, y0, z0, x1, y1, z1, mat, gnd) => {
      if (B.n >= max) { B.over = true; return -1; }
      const i = B.n++, o6 = i * 6;
      bx[o6] = Math.min(x0, x1); bx[o6 + 1] = Math.min(y0, y1); bx[o6 + 2] = Math.min(z0, z1); bx[o6 + 3] = Math.max(x0, x1); bx[o6 + 4] = Math.max(y0, y1); bx[o6 + 5] = Math.max(z0, z1);
      g.mat[i] = mat | 0; g.gnd[i] = gnd ? 1 : 0; g.init[i] = 0; g.seed[i] = 0; g.anc[i] = gnd ? 8 : 0; g.bnd[i] = 0; g.estb[i] = 0; if (B.kg) B.kg[i] = 0;
      return i;
    };
    // касание a и b (eps — зазор): −1 — нет; 0 — a стоит на b; 2 — a под b (b стоит на a); 1 — сбоку
    function rel(a, b, eps){
      const A = a * 6, C = b * 6;
      if (bx[A] > bx[C + 3] + eps || bx[C] > bx[A + 3] + eps || bx[A + 1] > bx[C + 4] + eps || bx[C + 1] > bx[A + 4] + eps || bx[A + 2] > bx[C + 5] + eps || bx[C + 2] > bx[A + 5] + eps) return -1;
      const ox = Math.min(bx[A + 3], bx[C + 3]) - Math.max(bx[A], bx[C]), oy = Math.min(bx[A + 4], bx[C + 4]) - Math.max(bx[A + 1], bx[C + 1]), oz = Math.min(bx[A + 5], bx[C + 5]) - Math.max(bx[A + 2], bx[C + 2]);
      if (oy <= eps) {   // одна на другой: нужна площадь касания
        if (ox <= eps || oz <= eps) return -1;
        return bx[A + 1] >= bx[C + 4] - eps ? 0 : 2;
      }
      if (ox <= eps && oz <= eps) return -1;   // только ребром
      if (ox > eps && oz > eps && oy > eps) {   // входят друг в друга: кто выше серединой
        const ca = bx[A + 1] + bx[A + 4], cb = bx[C + 1] + bx[C + 4], ha = bx[A + 4] - bx[A + 1], hb = bx[C + 4] - bx[C + 1];
        if (Math.abs(ca - cb) > (Math.min(ha, hb) || 0)) return ca > cb ? 0 : 2;
      }
      return 1;
    }
    B.link = (eps = .06) => {
      const n = B.n; ea.length = 0; eb.length = 0; er.length = 0;
      for (let i = 0; i < n; i++) ord[i] = i;
      const o2 = Array.prototype.slice.call(ord.subarray(0, n)).sort((a, b) => bx[a * 6] - bx[b * 6] || a - b);
      let na = 0;
      for (const i of o2) {
        const x0 = bx[i * 6];
        let w = 0;
        for (let k = 0; k < na; k++) { const j = act[k]; if (bx[j * 6 + 3] + eps >= x0) act[w++] = j; }
        na = w;
        for (let k = 0; k < na; k++) { const j = act[k], r = rel(i, j, eps); if (r >= 0) { ea.push(i, j); er.push(r, r === 1 ? 1 : 2 - r); } }
        act[na++] = i;
      }
      // рёбра по источнику (CSR); порядок — по номерам (одинаково у всех)
      const cnt = g.off; cnt.fill(0, 0, n + 1);
      const ne = ea.length;
      for (let k = 0; k < ne; k += 2) { cnt[ea[k] + 1]++; cnt[ea[k + 1] + 1]++; }
      for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
      if (cnt[n] > g.adj.length) { B.over = true; g.adj = new Int32Array(cnt[n] + 64); }
      const pos = g.q; for (let i = 0; i < n; i++) pos[i] = cnt[i];
      for (let k = 0, e = 0; k < ne; k += 2, e += 2) {
        const a = ea[k], b = ea[k + 1];
        g.adj[pos[a]++] = (b << 2) | er[e]; g.adj[pos[b]++] = (a << 2) | er[e + 1];
      }
      // соседи каждого узла — по возрастанию номеров (порядок вставки зависел бы от сортировки)
      for (let i = 0; i < n; i++) { const a = cnt[i], b = cnt[i + 1]; if (b - a > 1) sortRange(g.adj, a, b); }
      g.n = n; g.ne = cnt[n];
      return g.ne;
    };
    // broken — Uint8Array / массив номеров сломанных: «до» — на месте, «после» — нет
    B.collapse = (P, broken) => {
      for (let i = 0; i < B.n; i++) g.seed[i] = 0;
      if (broken) for (const i of broken) if (i >= 0 && i < B.n) g.seed[i] = 1;
      return g.collapse(P);
    };
    B.solve = (P, off) => { for (let i = 0; i < B.n; i++) g.dis[i] = off ? (off[i] ? 1 : 0) : 0; return g.solve(P, !!off); };
    B.groups = k => { const a = g.gOff[k], b = g.gOff[k + 1], out = []; for (let j = a; j < b; j++) out.push(g.gList[j]); return out; };
    // ── v2 (нагрузка): коробки в полудециметрах от начала куска (первая коробка), масса — B.kg[i] (кг от игры) или mass × объём ──
    B.kg = new Float64Array(max);
    B.isGrid = false; B.HU = 20; B.dims2 = false; B.nStand = 0;
    let bo0 = 0, bo1 = 0, bo2 = 0;
    const q20 = v => Math.round(v * 20);
    B.lprep = (L, P, i0, i1) => {
      if (i0 === 0) { bo0 = q20(bx[0]) >> 1 << 1; bo1 = q20(bx[1]) >> 1 << 1; bo2 = q20(bx[2]) >> 1 << 1; }
      for (let i = i0; i < i1; i++) {
        const o = i * 6, x0 = bx[o], y0 = bx[o + 1], z0 = bx[o + 2], x1 = bx[o + 3], y1 = bx[o + 4], z1 = bx[o + 5];
        L.hx[i] = Math.round((x0 + x1) * 10) - bo0; L.hy[i] = Math.round((y0 + y1) * 10) - bo1; L.hz[i] = Math.round((z0 + z1) * 10) - bo2;
        L.ex[i] = Math.max(1, Math.round((x1 - x0) * 10)); L.ey[i] = Math.max(1, Math.round((y1 - y0) * 10)); L.ez[i] = Math.max(1, Math.round((z1 - z0) * 10));
        const ky = Math.max(0, Math.min(1023, ((L.hy[i] - L.ey[i]) >> 1) + 512)), kx = Math.max(0, Math.min(1023, (L.hx[i] >> 1) + 512)), kz = Math.max(0, Math.min(1023, (L.hz[i] >> 1) + 512));
        L.key[i] = (ky << 20) | (kx << 10) | kz;
        L.w0[i] = B.kg[i] > 0 ? Math.round(B.kg[i]) : Math.max(1, Math.round(P.mass[g.mat[i]] * (x1 - x0) * (y1 - y0) * (z1 - z0)));
      }
    };
    const ovl = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    B.topArea = u => { const o = u * 6; return Math.max(.01, (bx[o + 3] - bx[o]) * (bx[o + 5] - bx[o + 2])); };
    B.cutBend = (c, L, P) => { const m = g.mat[c]; return Math.floor(P.bend[m] * B.topArea(c)); };
    // опоры коробки u (задание v2): сначала «стоит на» (земля, коробки снизу), потом бок и «висит под»; площадь касания — к 1 м²
    B.supporters = (u, L, P, hold) => {
      const SK = L.SK, SW = L.SW, SD = L.SD, SE = L.SE, SA = L.SA, SF = L.SF, rank = L.rank, mat = g.mat, sup = g.sup, m = mat[u], mn = P.min[m], cp = P.cap[m];
      const o = u * 6; let ns = 0;
      if ((g.anc[u] & 8) && !(L.adis[u] & 8) && Math.min(cp, MAXV - P.up[m]) >= mn) { SK[0] = 2; SW[0] = -1; SD[0] = 3; SE[0] = -4; SA[0] = Math.round(1024 * B.topArea(u)); SF[0] = 0; L.SCX[0] = L.hx[u]; L.SCZ[0] = L.hz[u]; ns = 1; }
      // pass 0 — stand, 1 — side (strictly higher support) and hang, 2 — side with equal support (only when nothing else holds it)
      for (let pass = 0; pass < 3; pass++) {
        if (pass === 2 && ns) break;
        for (let k = g.off[u], e = g.off[u + 1]; k < e && ns < 32; k++) {
          const a = g.adj[k], w = a >> 2, r = a & 3;
          if ((pass === 0) !== (r === 0) || (pass === 2 && r !== 1) || L.edis[k]) continue;
          const loss = r === 0 ? P.up[m] : r === 1 ? P.side[m] : P.down[m];
          if (!(rank[w] < rank[u] && (pass === 2 || r !== 1 || sup[w] > sup[u]) && hold(w) && P.bear[mat[w]] && Math.min(cp, sup[w] - loss) >= mn)) continue;
          const p = w * 6;
          let area, d, f = 0;
          if (r === 0 || r === 2) { area = ovl(bx[o], bx[o + 3], bx[p], bx[p + 3]) * ovl(bx[o + 2], bx[o + 5], bx[p + 2], bx[p + 5]); d = r === 0 ? 3 : 2; }
          else {
            const dx = L.hx[w] - L.hx[u], dz = L.hz[w] - L.hz[u], gx = Math.abs(dx) - L.ex[u] - L.ex[w], gz = Math.abs(dz) - L.ez[u] - L.ez[w], ax = gx >= gz;
            area = ovl(bx[o + 1], bx[o + 4], bx[p + 1], bx[p + 4]) * (ax ? ovl(bx[o + 2], bx[o + 5], bx[p + 2], bx[p + 5]) : ovl(bx[o], bx[o + 3], bx[p], bx[p + 3]));
            d = ax ? (dx > 0 ? 0 : 1) : (dz > 0 ? 4 : 5); f = ax ? (dx > 0 ? -L.ex[u] : L.ex[u]) : (dz > 0 ? -L.ez[u] : L.ez[u]);
          }
          L.SCX[ns] = r === 1 ? L.hx[u] : Math.round((Math.max(bx[o], bx[p]) + Math.min(bx[o + 3], bx[p + 3])) * 10) - bo0;   // contact centre (stand / hang)
          L.SCZ[ns] = r === 1 ? L.hz[u] : Math.round((Math.max(bx[o + 2], bx[p + 2]) + Math.min(bx[o + 5], bx[p + 5])) * 10) - bo2;
          SK[ns] = 1; SW[ns] = w; SD[ns] = d; SE[ns] = k; SA[ns] = Math.max(1, Math.round(1024 * area)); SF[ns] = f; ns++;
        }
        if (pass === 0) B.nStand = ns;
      }
      return ns;
    };
    B.full = false;
    B.loadJob = () => B.J || (B.J = S.loadJob(B));
    // v2: что падает, если убрать broken (как B.collapse, плюс нагрузка) — сразу, без бюджета (деталей ≤ 4096)
    B.collapse2 = (P, broken) => {
      for (let i = 0; i < B.n; i++) g.seed[i] = 0;
      if (broken) for (const i of broken) if (i >= 0 && i < B.n) g.seed[i] = 1;
      B.full = B.over;
      const J = B.loadJob(); J.start('rm', null, null, { P }); J.run();
      return g.ng;
    };
    // v2: нагрузка всех деталей как есть (подсветка): B.g.L.ra — ‰ (больше 1000 — перегружено, но стоит: «держалось раньше»)
    B.loads = P => {
      for (let i = 0; i < B.n; i++) g.seed[i] = 0;
      const J = B.loadJob(); J.start('rm', null, null, { P }, { ratiosOnly: true }); J.run();
      return g.L;
    };
    return B;
  };
  // ═══ v2 — load paths with mass and moments (T-124, STRUCTURE_HAZARDS.md §2.1 S1.L) ═══
  // Only for worlds with load: 1 while S.LOAD is on; everything above (v1) stays bit-identical (scripts/support-hash.js pins it).
  // Pass 1 = the v1 solve (same values; after a failure some links / anchor contacts are disabled). Strict order: w is "before" u
  // when sup[w] > sup[u], or equal and key(w) < key(u), key = (height, x, z) from the piece origin (lower cells first). A side
  // supporter must have strictly higher sup (equal ones only when nothing else holds the node): the key orders the passes, it
  // never moves load sideways along a row of equal cells (T-124 review: a symmetric roof had one overloaded corner).
  // Pass 2, after-most first: a holding node adds its own mass and sends its load W, first moments Mx, Mz (about its centre) and
  // the height moment My to its supporters — "stand wins": standing on a supporter / true anchor below sends everything down;
  // otherwise equal shares to all side and hang supporters (floor; remainders to the first in the fixed order −y, +x, −x, +z, −z,
  // +y); a side link adds q·r. Positions are in half-units (grid: 2 per cell; boxes: 20 per metre), moments in kg·half-unit.
  // Checks (integer compares): crush (load standing on a cell ≤ comp), side joint (|m + q·r_face| ≤ bend·HU, the weaker material),
  // hang (q ≤ hang), storey overturning of each cut (8 directions, diagonals × 181/128, sway ‰ per height). Natural rows never
  // fail; boundary anchors (piece edge, G.full, unloaded = code 5) absorb load unchecked and flag unk — unk never fails.
  // Failure ("held before"): after > 1000 ‰, before ≤ 1000 ‰ and raised; cut in strict order unless a supporter is already cut
  // or downstream of a cut; ≤ 3 rounds. Everything runs as a resumable job with a fixed op budget per world tick (same finishing
  // tick at 30 / 60 / 144 fps, phone and PC). No allocation per call: arrays per graph, allocated once on first use.
  S.SOLVE_BUDGET = 4096;   // node ops per world tick (start value, equal on every device; ≤ 2 ms per tick on phone ×4 — see support-load-test)
  // op weights per node and phase (calibrated in support-load-test: a 4,096-op slice ≈ the same time in every phase)
  const OPW = S.OPW = { build: 4, prep: 1, init: 1, pop: 1, order: 1, load: 6, storey: 4, select: 1, groups: 1 };   // ≈ equal time per op (node 24 and Chrome; load and storey were the worst slices in the Kubomir page)
  const ORD6 = [3, 0, 1, 4, 5, 2];   // fixed neighbour order (grid direction k6: 0 +x, 1 −x, 2 up, 3 down, 4 +z, 5 −z)
  const REL6 = [1, 1, 2, 0, 1, 1];   // k6 → rel (0 stands on it, 1 side, 2 hangs under it)
  const DXH = [2, -2, 0, 0, 0, 0], DZH = [0, 0, 0, 0, 2, -2];   // k6 → offset of the neighbour centre (half-units)
  const SAT = 2 ** 50, RMAX = 1e9;
  const D8X = [1, -1, 0, 0, 1, 1, -1, -1], D8Z = [0, 0, 1, -1, 1, -1, 1, -1];
  const ratio = (dem, cap) => dem <= 0 ? 0 : cap > 0 ? Math.min(RMAX, Math.floor(dem * 1000 / cap)) : RMAX;
  function loadState(g){
    if (g.L) return g.L;
    const max = g.max, ne = g.adj.length;
    const L = g.L = {
      W: new Float64Array(max), Mx: new Float64Array(max), Mz: new Float64Array(max), My: new Float64Array(max), C: new Float64Array(max), w0: new Float64Array(max),
      hx: new Int32Array(max), hy: new Int32Array(max), hz: new Int32Array(max), ex: new Int32Array(max), ey: new Int32Array(max), ez: new Int32Array(max), key: new Int32Array(max),
      unk: new Uint8Array(max), stand: new Uint8Array(max), standE: new Int32Array(max), ra: new Float64Array(max), rb: new Float64Array(max), rw: new Float64Array(max),
      rj: new Float64Array(max), raj: new Float64Array(max), rbj: new Float64Array(max),   // the same without the storey check (what a cut acts on until S1.T)
      fk: new Uint8Array(max), fr: new Int32Array(max), ord: new Int32Array(max), rank: new Int32Array(max), tmp: new Int32Array(max), cnt: new Int32Array(1024),
      edis: new Uint8Array(ne), adis: new Uint8Array(max), crushed: new Uint8Array(max), cutv: new Uint8Array(max), dn: new Uint8Array(max),
      spt: new Int32Array(max * 6), spn: new Uint8Array(max), vis: new Uint8Array(max), cq: new Int32Array(max), cutOf: new Int32Array(max), cutR: new Float64Array(max), cutD: new Int8Array(max), cutS: new Int32Array(max + 1), cutM: new Int32Array(max), nCut: 0,
      E6: new Int32Array(6), SK: new Uint8Array(32), SW: new Int32Array(32), SD: new Int8Array(32), SE: new Int32Array(32), SA: new Float64Array(32), SF: new Int32Array(32), SCX: new Int32Array(32), SCZ: new Int32Array(32), unkA: new Uint8Array(max),
    };
    if (!g.estv) g.estv = new Uint16Array(max * 6);
    return L;
  }
  // one load job per graph (grid or boxes); geo — the grid / boxes object (lprep, isGrid, HU)
  const NOO = Object.freeze({});
  function job(geo){
    const g = geo.g, J = { busy: false, done: false, phase: 0, ops: 0, round: 0, kind: 'rm', res: null, P: null };
    const RES = { ng: 0, nf: 0, n: 0, over: 0, unk: 0, crushed: 0, worst: 0, rounds: 0, ops: 0, ticks: 0, full: false, tips: 0, tipD: -1 };   // one result object per job (read it before the next start)
    let wb = 4, L = null, P = null, kind = 'rm', ci = 0, cj = 0, side = 0, oPass = 0, oSub = 0, sv = 0, sPh = 0, qh = 0, qt = 0, cutStart = -1, gat = 0, kg = 1000, stopAt = 0;
    const PH_BUILD = 0, PH_PREP = 1, PH_SOLVE = 2, PH_ORDER = 3, PH_LOAD = 4, PH_STOREY = 5, PH_SELECT = 6, PH_GROUPS = 7, PH_DONE = 8;
    // ── start: kind 'rm' (seeds were removed: before = with them) | 'add' (seeds were added: before = without them) ──
    J.start = (k, seeds, read, b, o = NOO) => {
      kind = J.kind = k === 'add' || k === 'now' ? k : 'rm'; P = J.P = b.P; L = loadState(g); kg = o.kg ?? 1000; stopAt = o.ratiosOnly ? 1 : 0;   // 'now' — как есть (до = после)
      wb = Math.max(1, b.opb | 0 || OPW.build);   // build weight per node: the game's world read is part of it (a constant per adapter — the same on every device)
      J.busy = true; J.done = false; J.ops = 0; J.round = 0; J.res = null; J.ticks = 0;
      if (geo.isGrid) { geo.begin(seeds, read, b); J.phase = PH_BUILD; } else { J.phase = PH_PREP; }
      ci = 0; side = 0;
      return J;
    };
    // ── a slice of work: budget in node ops → true when finished ──
    J.step = (budget = S.SOLVE_BUDGET) => {
      if (!J.busy) return true;
      J.ticks++;
      while (budget > 0 && J.busy) {
        const used = run(budget);
        budget -= used; J.ops += used;
      }
      return !J.busy;
    };
    J.run = () => { while (J.busy) J.step(1 << 30); return J; };
    const hold = u => !g.dis[u] && g.sup[u] >= P.min[g.mat[u]];
    function run(budget){
      switch (J.phase) {
        case PH_BUILD: {
          const nb = Math.max(1, Math.floor(budget / wb)), i0 = geo.cursor();
          const fin = geo.more(nb);
          const used = (geo.cursor() - i0) * wb;
          if (fin) { J.phase = PH_PREP; ci = 0; }
          return Math.max(used, 1);
        }
        case PH_PREP: {
          const n = g.n, nb = Math.max(1, Math.floor(budget / OPW.prep)), e = Math.min(n, ci + nb);
          geo.lprep(L, P, ci, e, kg);
          const off = g.off, edis = L.edis;
          for (let i = ci; i < e; i++) { L.adis[i] = 0; L.crushed[i] = 0; for (let k = off[i], k1 = off[i + 1]; k < k1; k++) edis[k] = 0; }
          const used = (e - ci) * OPW.prep; ci = e;
          if (ci >= n) {
            for (let i = 0; i < n; i++) g.seed[i] = g.seed[i] ? 1 : 0;
            side = 0; beginSolve(); J.phase = PH_SOLVE;
          }
          return Math.max(used, 1);
        }
        case PH_SOLVE: { const u = solveMore(budget); if (sPh === 2) { beginOrder(); J.phase = PH_ORDER; } return u; }
        case PH_ORDER: { const u = orderMore(budget); if (oPass > 4) { ci = g.n - 1; beginLoad(); J.phase = PH_LOAD; } return u; }
        case PH_LOAD: { const u = loadMore(budget); if (ci < 0) { unkUp(); ci = 0; cutStart = -1; L.nCut = 0; L.cutS[0] = 0; L.vis.fill(0, 0, g.n); J.phase = PH_STOREY; } return u; }
        case PH_STOREY: {
          const u = storeyMore(budget);
          if (ci >= g.n && cutStart < 0) endSide();
          return u;
        }
        case PH_SELECT: { const u = selectMore(budget); return u; }
        case PH_GROUPS: { const u = groupsMore(budget); return u; }
        default: J.busy = false; return 1;
      }
    }
    // side 0 = "before", side 1 = "after" (dis: rm → seeds absent after; add → seeds absent before)
    function beginSolve(){
      const n = g.n, dis = g.dis, seed = g.seed, cr = L.crushed;
      for (let i = 0; i < n; i++) dis[i] = (side === 0 ? (kind === 'add' ? seed[i] : 0) : (kind === 'rm' ? seed[i] : 0)) | cr[i];
      g.head.fill(-1); sPh = 0; ci = 0; sv = MAXV;
    }
    // ── pass 1 (v1 values; disabled links / anchors respected), resumable ──
    // bucket lists of the graph (one pair of functions per job: no closures per call)
    const ins = (i, v) => { const head = g.head, nxt = g.nxt, prv = g.prv, h = head[v]; nxt[i] = h; prv[i] = -1; if (h >= 0) prv[h] = i; head[v] = i; };
    const del = (i, v) => { const head = g.head, nxt = g.nxt, prv = g.prv, a = prv[i], b = nxt[i]; if (a >= 0) nxt[a] = b; else head[v] = b; if (b >= 0) prv[b] = a; };
    const dig = i => oPass === 0 ? L.key[i] & 1023 : oPass === 1 ? (L.key[i] >> 10) & 1023 : oPass === 2 ? (L.key[i] >> 20) & 1023 : MAXV - g.sup[i];
    function solveMore(budget){
      const n = g.n, sup = g.sup, mat = g.mat, done = g.done, dis = g.dis, off = g.off, adj = g.adj, head = g.head, nxt = g.nxt, prv = g.prv;
      const cap = P.cap, up = P.up, sd = P.side, down = P.down, bear = P.bear, edis = L.edis, adis = L.adis, anc = g.anc, bnd = g.bnd, estb = g.estb, estv = g.estv;
      let used = 0;
      if (sPh === 0) {
        const nb = Math.max(1, Math.floor(budget / OPW.init)), e = Math.min(n, ci + nb);
        for (let i = ci; i < e; i++) {
          sup[i] = 0; done[i] = 0;
          if (dis[i]) { done[i] = 1; continue; }
          const m = mat[i], ab = (anc[i] | bnd[i]) & ~adis[i], eb = estb[i] & ~adis[i];
          let c = 0;
          if (ab) for (let d = 0; d < 6; d++) if (ab & (1 << d)) { const r = REL6[d], cc = MAXV - (r === 0 ? up[m] : r === 1 ? sd[m] : down[m]); if (cc > c) c = cc; }
          if (eb) for (let d = 0; d < 6; d++) if (eb & (1 << d)) { const r = REL6[d], cc = estv[i * 6 + d] - (r === 0 ? up[m] : r === 1 ? sd[m] : down[m]); if (cc > c) c = cc; }
          if (c > cap[m]) c = cap[m];
          if (c > 0) { sup[i] = c; ins(i, c); }
        }
        used += (e - ci) * OPW.init; ci = e;
        if (ci < n) return Math.max(1, used);
        sPh = 1; sv = MAXV;
      }
      let left = Math.max(1, Math.floor((budget - used) / OPW.pop));
      for (let v = sv; v >= 1; v--) {
        let u = head[v];
        while (u >= 0) {
          if (left <= 0) { sv = v; return used; }
          del(u, v); done[u] = 1; left--; used += OPW.pop;
          if (bear[mat[u]]) {
            for (let k = off[u], e = off[u + 1]; k < e; k++) {
              if (edis[k]) continue;
              const a = adj[k], w = a >> 2;
              if (done[w]) continue;
              const r = a & 3, m = mat[w];
              let c = v - (r === 2 ? up[m] : r === 1 ? sd[m] : down[m]);
              if (c > cap[m]) c = cap[m];
              if (c > sup[w]) { if (sup[w] > 0) del(w, sup[w]); sup[w] = c; ins(w, c); }
            }
          }
          u = head[v];
        }
      }
      sPh = 2;
      return Math.max(1, used);
    }
    // ── strict order: (1000 − sup, key) ascending; ≤ 48 nodes — insertion sort, else LSD radix 4 × 10 bits (stable) ──
    function beginOrder(){ oPass = 0; oSub = 0; ci = 0; const n = g.n, ord = L.ord; for (let i = 0; i < n; i++) ord[i] = i; if (n <= 48) oPass = 5 - 1; }
    function orderMore(budget){
      const n = g.n, sup = g.sup, key = L.key;
      if (oPass === 4) {   // small piece: insertion sort (same order as the radix: total order by (prim, key, index))
        const ord = L.ord;
        for (let i = 1; i < n; i++) { const v = ord[i], pv = MAXV - sup[v], kv = key[v]; let j = i - 1; while (j >= 0) { const w = ord[j], pw = MAXV - sup[w]; if (pw < pv || (pw === pv && (key[w] < kv || (key[w] === kv && w < v)))) break; ord[j + 1] = w; j--; } ord[j + 1] = v; }
        finishOrder(); return Math.max(1, n * OPW.order);
      }
      // radix pass oPass (0: z, 1: x, 2: height, 3: 1000 − sup): sub 0 count, 1 prefix, 2 scatter
      const cnt = L.cnt, src = oPass & 1 ? L.tmp : L.ord, dst = oPass & 1 ? L.ord : L.tmp;
      const nb = Math.max(1, Math.floor(budget / OPW.order) * 4);   // cheap steps: 4 per op
      let used = 0;
      if (oSub === 0) {
        if (ci === 0) cnt.fill(0);
        const e = Math.min(n, ci + nb);
        for (let k = ci; k < e; k++) cnt[dig(src[k])]++;
        used += Math.ceil((e - ci) / 4) * OPW.order; ci = e;
        if (ci < n) return Math.max(1, used);
        let s = 0; for (let d = 0; d < 1024; d++) { const c = cnt[d]; cnt[d] = s; s += c; }
        oSub = 2; ci = 0; used += 1;
      }
      const e = Math.min(n, ci + nb);
      for (let k = ci; k < e; k++) { const i = src[k]; dst[cnt[dig(i)]++] = i; }
      used += Math.ceil((e - ci) / 4) * OPW.order; ci = e;
      if (ci >= n) { oPass++; oSub = 0; ci = 0; if (oPass === 4) finishOrder(); }   // 4 passes: ord → tmp → ord → tmp → ord
      return Math.max(1, used);
    }
    function finishOrder(){ const n = g.n, ord = L.ord, rank = L.rank; for (let k = 0; k < n; k++) rank[ord[k]] = k; oPass = 5; }
    // ── pass 2: load, after-most first (resumable over the order) ──
    function beginLoad(){
      const n = g.n, W = L.W, Mx = L.Mx, Mz = L.Mz, My = L.My, C = L.C, unk = L.unk, st = L.stand, rw = L.rw, fk = L.fk, spn = L.spn;
      for (let i = 0; i < n; i++) { W[i] = 0; Mx[i] = 0; Mz[i] = 0; My[i] = 0; C[i] = 0; unk[i] = 0; L.unkA[i] = 0; st[i] = 0; rw[i] = 0; fk[i] = 0; spn[i] = 0; L.cutOf[i] = -1; }
    }
    const lossOf = (d, m) => { const r = REL6[d]; return r === 0 ? P.up[m] : r === 1 ? P.side[m] : P.down[m]; };
    // unk (spec §2.1): every node adjacent to a boundary anchor, plus every node whose load passes through such a node (forward
    // pass in the strict order: a supporter is before its node); the load pass already marked nodes that received unk load
    function unkUp(){
      const n = g.n, ord = L.ord, unkA = L.unkA, unk = L.unk, spt = L.spt, spn = L.spn;
      for (let k = 0; k < n; k++) { const u = ord[k]; if (!unkA[u]) for (let j = 0; j < spn[u]; j++) if (unkA[spt[u * 6 + j]]) { unkA[u] = 1; break; } if (unkA[u]) unk[u] = 1; }
    }
    function loadMore(budget){
      const ord = L.ord, rank = L.rank, mat = g.mat, sup = g.sup, off = g.off, adj = g.adj, edis = L.edis, adis = L.adis;
      const W = L.W, Mx = L.Mx, Mz = L.Mz, My = L.My, C = L.C, unk = L.unk, hx = L.hx, hy = L.hy, hz = L.hz, ex = L.ex, ez = L.ez, w0 = L.w0;
      const E6 = L.E6, SK = L.SK, SW = L.SW, SD = L.SD, SE = L.SE, SA = L.SA, SF = L.SF, min = P.min, cap = P.cap, bear = P.bear, lnone = P.lnone, bend = P.bend, hang = P.hang, comp = P.comp;
      const HU = geo.HU, isGrid = geo.isGrid;
      let left = Math.max(1, Math.floor(budget / OPW.load)), used = 0;
      for (; ci >= 0 && left > 0; ci--, left--) {
        used += OPW.load;
        const u = ord[ci];
        if (!hold(u)) continue;
        const m = mat[u], mn = min[m], nat = lnone[m];
        W[u] += w0[u]; My[u] += w0[u] * hy[u];
        if (W[u] > SAT || Math.abs(Mx[u]) > SAT || Math.abs(Mz[u]) > SAT || Math.abs(My[u]) > SAT) { unk[u] = 1; W[u] = Math.min(W[u], SAT); }
        if (g.bnd[u]) L.unkA[u] = 1;
        // supporters: SK kind (1 node, 2 true anchor, 3 boundary), SW node, SD direction, SE edge (or −1 − direction), SA contact
        // area × 1024 (grid: 1024), SF joint face offset (u centre − face, half-units); stand supporters are [s0, s1)
        let ns = 0, s0 = 0, s1 = 0;
        if (isGrid) {
          E6[0] = E6[1] = E6[2] = E6[3] = E6[4] = E6[5] = -1;
          for (let k = off[u], e = off[u + 1]; k < e; k++) E6[geo.dirOf(u, adj[k] >> 2)] = k;
          const ab = g.anc[u] & ~adis[u], bb = g.bnd[u] & ~adis[u], eb = g.estb[u] & ~adis[u];
          // a side neighbour with the same support is a supporter only when nothing better holds u (ties by key alone would send
          // load sideways along a row of equal cells and overload one corner of a symmetric roof — T-124 review)
          for (let lax = 0; lax < 2 && !ns; lax++) for (let j = 0; j < 6; j++) {
            const d = ORD6[j], bit = 1 << d, loss = lossOf(d, m), k = E6[d];
            let kd = 0, w = -1;
            if (k >= 0) { w = adj[k] >> 2; if (!edis[k] && rank[w] < rank[u] && (lax || REL6[d] !== 1 || sup[w] > sup[u]) && hold(w) && bear[mat[w]] && Math.min(cap[m], sup[w] - loss) >= mn) kd = 1; }
            else if ((ab & bit) && Math.min(cap[m], MAXV - loss) >= mn) kd = 2;
            else if ((eb & bit) && Math.min(cap[m], g.estv[u * 6 + d] - loss) >= mn) kd = 2;
            else if ((bb & bit) && Math.min(cap[m], MAXV - loss) >= mn) kd = 3;
            if (!kd) continue;
            if (d === 3) { s0 = ns; s1 = ns + 1; }
            SK[ns] = kd; SW[ns] = w; SD[ns] = d; SE[ns] = kd === 1 ? k : -1 - d; SA[ns] = 1024; SF[ns] = d === 0 ? -ex[u] : d === 1 ? ex[u] : d === 4 ? -ez[u] : d === 5 ? ez[u] : 0; L.SCX[ns] = hx[u]; L.SCZ[ns] = hz[u]; ns++;
          }
        } else { ns = geo.supporters(u, L, P, hold); s0 = 0; s1 = geo.nStand; }
        L.spn[u] = 0;
        if (!ns) { L.unkA[u] = 1; unk[u] = 1; continue; }
        let rmax = 0, rk = 0, rf = 0;
        if (s1 > s0) {
          // stand wins: everything down (grid: the cell below; boxes: equal shares among everything it stands on)
          const k = s1 - s0, q0 = Math.floor(W[u] / k), qr = W[u] - q0 * k, my0 = Math.floor(My[u] / k), myr = My[u] - my0 * k, SCX = L.SCX, SCZ = L.SCZ;
          let Rx = Mx[u] + W[u] * hx[u], Rz = Mz[u] + W[u] * hz[u];   // each share acts at its contact centre; the rest — an equal couple
          for (let j = s0; j < s1; j++) { const q = q0 + (j === s0 ? qr : 0); Rx -= q * SCX[j]; Rz -= q * SCZ[j]; }
          const mx0 = Math.floor(Rx / k), mxr = Rx - mx0 * k, mz0 = Math.floor(Rz / k), mzr = Rz - mz0 * k;
          L.stand[u] = SK[s0] === 1 ? 1 : SK[s0] === 2 ? 2 : 3; L.standE[u] = SE[s0];
          for (let j = s0; j < s1; j++) {
            const f = j === s0, q = q0 + (f ? qr : 0), mx = mx0 + (f ? mxr : 0), mz = mz0 + (f ? mzr : 0), my = my0 + (f ? myr : 0);
            if (SK[j] === 3) { L.unkA[u] = 1; continue; }
            if (SK[j] !== 1) continue;
            const w = SW[j];
            C[w] += q; W[w] += q; Mx[w] += mx + q * (SCX[j] - hx[w]); Mz[w] += mz + q * (SCZ[j] - hz[w]); My[w] += my; if (unk[u]) unk[w] = 1;
            if (L.spn[u] < 6) L.spt[u * 6 + L.spn[u]++] = w;
          }
        } else {
          // side / hang: equal shares to all of them; each joint is checked about its face
          const k = ns, q0 = Math.floor(W[u] / k), qr = W[u] - q0 * k, mx0 = Math.floor(Mx[u] / k), mxr = Mx[u] - mx0 * k, mz0 = Math.floor(Mz[u] / k), mzr = Mz[u] - mz0 * k, my0 = Math.floor(My[u] / k), myr = My[u] - my0 * k;
          // boxes: a part held on both sides of an axis carries its own mass to each side as a half-span (arm / 2: W·L/8, as the grid)
          let both = 0;
          if (!isGrid) { let mk = 0; for (let j = 0; j < ns; j++) mk |= 1 << SD[j]; both = ((mk & 3) === 3 ? 1 : 0) | ((mk & 48) === 48 ? 2 : 0); }
          const own = Math.floor(w0[u] / k);
          for (let j = 0; j < ns; j++) {
            const f = j === 0, q = q0 + (f ? qr : 0), mx = mx0 + (f ? mxr : 0), mz = mz0 + (f ? mzr : 0), my = my0 + (f ? myr : 0), d = SD[j], kd = SK[j], w = SW[j];
            if (kd === 3) { L.unkA[u] = 1; continue; }
            if (!nat) {   // natural nodes never fail: no check
              const wn = kd !== 1 || lnone[mat[w]];
              let dem, cp;
              if (d === 2) { dem = q; cp = Math.floor((wn ? hang[m] : Math.min(hang[m], hang[mat[w]])) * SA[j] / 1024); }
              else { const xa = d === 0 || d === 1, half = both & (xa ? 1 : 2) ? Math.floor(own * SF[j] / 2) : 0; dem = Math.abs((xa ? mx : mz) + q * SF[j] - half); cp = Math.floor((wn ? bend[m] : Math.min(bend[m], bend[mat[w]])) * SA[j] / 1024) * HU; }
              const r = ratio(dem, cp);
              if (r > rmax) { rmax = r; rk = d === 2 ? 2 : 1; rf = SE[j]; }
            }
            if (kd !== 1) continue;   // true anchor: absorbed after the check
            W[w] += q; Mx[w] += mx + q * (hx[u] - hx[w]); Mz[w] += mz + q * (hz[u] - hz[w]); My[w] += my; if (unk[u]) unk[w] = 1;
            if (L.spn[u] < 6) L.spt[u * 6 + L.spn[u]++] = w;
          }
        }
        // crush: the load standing on u
        if (!nat && C[u] > 0) { const r = ratio(C[u], Math.floor(comp[m] * geo.topArea(u))); if (r > rmax) { rmax = r; rk = 3; rf = -1; } }
        L.rw[u] = rmax; L.rj[u] = rmax; L.fk[u] = rk; L.fr[u] = rf;
      }
      return Math.max(1, used);
    }
    // ── storey overturning: cuts = stand links of one layer whose upper cells are side-connected inside the layer ──
    function storeyMore(budget){
      const n = g.n, vis = L.vis, cq = L.cq, off = g.off, adj = g.adj, edis = L.edis, hy = L.hy, ey = L.ey, st = L.stand;
      let left = Math.max(1, Math.floor(budget / OPW.storey)), used = 0;
      while (left > 0) {
        if (cutStart < 0) {   // next start: a holding standing node not yet visited
          while (ci < n && (vis[ci] || !st[ci] || !hold(ci))) ci++;
          if (ci >= n) return Math.max(1, used);
          qh = 0; qt = 0; cq[qt++] = ci; vis[ci] = 1; cutStart = ci;
        }
        while (qh < qt && left > 0) {
          const u = cq[qh++]; left--; used += OPW.storey;
          const hb = hy[u] - ey[u];
          for (let k = off[u], e = off[u + 1]; k < e; k++) {
            if (edis[k] || (adj[k] & 3) !== 1) continue;
            const w = adj[k] >> 2;
            if (vis[w] || !hold(w) || hy[w] - ey[w] !== hb) continue;
            vis[w] = 1; cq[qt++] = w;
          }
        }
        if (qh < qt) return Math.max(1, used);
        evalCut(qt); cutStart = -1; ci++;
      }
      return Math.max(1, used);
    }
    function evalCut(qn){
      const cq = L.cq, st = L.stand, W = L.W, Mx = L.Mx, Mz = L.Mz, My = L.My, hx = L.hx, hy = L.hy, hz = L.hz, ex = L.ex, ey = L.ey, ez = L.ez, unk = L.unk, mat = g.mat, lnone = P.lnone;
      let Wt = 0, Mxo = 0, Mzo = 0, Myt = 0, R = 0, nm = 0, yc = 0, bad = false, live = false;
      const ci0 = L.nCut, s0 = L.cutS[ci0];
      for (let j = 0; j < qn; j++) {
        const c = cq[j]; if (!st[c]) continue;
        if (unk[c] || st[c] === 3) bad = true;
        if (!lnone[mat[c]]) live = true;
        Wt += W[c]; Mxo += Mx[c] + W[c] * hx[c]; Mzo += Mz[c] + W[c] * hz[c]; Myt += My[c]; yc = hy[c] - ey[c];
        R += geo.cutBend(c, L, P);
        L.cutM[s0 + nm++] = c;
      }
      if (!nm || bad || !live || !(Wt > 0)) return;
      const sw = Math.floor((Myt - Wt * yc) * P.sway / 1000), HU = geo.HU, Rh = R * HU, nd = geo.dims2 ? 2 : 8;
      let worst = 0, wd = -1;
      for (let d = 0; d < nd; d++) {
        const dx = D8X[d], dz = D8Z[d];
        let ext = -Infinity;
        for (let j = 0; j < nm; j++) { const c = L.cutM[s0 + j], e = dx * hx[c] + dz * hz[c] + (dx ? ex[c] : 0) + (dz ? ez[c] : 0); if (e > ext) ext = e; }
        const over = dx * Mxo + dz * Mzo - Wt * ext;
        const diag = dx && dz, dem = diag ? 128 * over + 181 * sw : over + sw, cp = diag ? 181 * Rh : Rh;
        const r = ratio(dem, cp);
        if (r > worst) { worst = r; wd = d; }
      }
      L.cutR[ci0] = worst; L.cutD[ci0] = wd; L.cutS[ci0 + 1] = s0 + nm; L.nCut = ci0 + 1;
      for (let j = 0; j < nm; j++) { const c = L.cutM[s0 + j]; L.cutOf[c] = ci0; if (!lnone[mat[c]] && worst > L.rw[c]) L.rw[c] = worst; }
    }
    function endSide(){
      const n = g.n;
      if (side === 0) {   // keep "before": ratios and support
        for (let i = 0; i < n; i++) { L.rb[i] = L.rw[i]; L.rbj[i] = L.rj[i]; g.sup0[i] = g.sup[i]; }
        side = 1; beginSolve(); J.phase = PH_SOLVE; return;
      }
      for (let i = 0; i < n; i++) { L.ra[i] = L.rw[i]; L.raj[i] = L.rj[i]; }
      if (stopAt) { finish(); return; }
      ci = 0; J.phase = PH_SELECT; L.anyCut = 0; L.tips = 0; L.tipD = -1; L.tipCut = -1;
      for (let i = 0; i < n; i++) { L.dn[i] = 0; L.cutv[i] = 0; }
    }
    // a cut acts on joint / hang / crush failures (SH1). A storey failure (overturning) needs S1.T to tip the part above (SH3): a
    // straight drop cannot move what rests on its support, so until then it is reported (res.tips, tipD) and refuses placement
    J.failing = u => !L.unk[u] && !P.lnone[g.mat[u]] && L.raj[u] > 1000 && L.rbj[u] <= 1000 && L.raj[u] > L.rbj[u];
    J.tipping = u => !L.unk[u] && !P.lnone[g.mat[u]] && L.ra[u] > 1000 && L.rb[u] <= 1000 && L.ra[u] > L.rb[u] && L.cutOf[u] >= 0 && L.cutR[L.cutOf[u]] > 1000;
    // ── failure selection: one forward pass in the strict (after) order ──
    function selectMore(budget){
      const n = g.n, ord = L.ord, spt = L.spt, spn = L.spn, dn = L.dn, cutv = L.cutv;
      let left = Math.max(1, Math.floor(budget / OPW.select)), used = 0;
      for (; ci < n && left > 0; ci++, left--) {
        used += OPW.select;
        const u = ord[ci];
        if (!hold(u)) continue;
        let d = 0; for (let j = 0; j < spn[u]; j++) { const s = spt[u * 6 + j]; if (cutv[s] || dn[s]) { d = 1; break; } }
        dn[u] = d;
        if (d || cutv[u]) continue;
        if (J.failing(u)) { cutNode(u); L.anyCut = 1; }
        else if (J.tipping(u)) { const c = L.cutOf[u]; if (L.tipCut !== c) { L.tipCut = c; L.tips = (L.tips | 0) + 1; L.tipD = L.cutD[c]; } }
      }
      if (ci >= n) {
        J.round++;
        if (L.anyCut && J.round < 3) { side = 1; beginSolve(); J.phase = PH_SOLVE; }
        else { ci = 0; beginGroups(); J.phase = PH_GROUPS; }
      }
      return Math.max(1, used);
    }
    const offEdge = k => { const edis = L.edis, a = g.adj[k], w = a >> 2, u = edgeFrom(k); edis[k] = 1; for (let j = g.off[w], e = g.off[w + 1]; j < e; j++) if ((g.adj[j] >> 2) === u) edis[j] = 1; };
    const edgeFrom = k => { let lo = 0, hi = g.n - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.off[mid] <= k) lo = mid; else hi = mid - 1; } return lo; };
    function cutNode(u){
      const fk = L.fk[u], fr = L.fr[u];
      L.cutv[u] = 1;
      if (fk === 1 || fk === 2) { if (fr >= 0) offEdge(fr); else L.adis[u] |= 1 << (-1 - fr); }
      else if (fk === 3) L.crushed[u] = 1;
      else if (fk === 4) {   // storey: every stand link of the cut; tip edge = the failing direction (S1.T, SH3)
        for (let j = L.cutS[fr], e = L.cutS[fr + 1]; j < e; j++) {
          const c = L.cutM[j]; L.cutv[c] = 1;
          if (L.stand[c] === 1 && L.standE[c] >= 0) offEdge(L.standE[c]);
          else if (L.stand[c] === 2) L.adis[c] |= 8;   // the anchor below (direction 3)
        }
        L.tips = (L.tips | 0) + 1; L.tipD = L.cutD[fr];
      }
    }
    // ── groups: v1 rule (held before, not after) + crushed cells; links cut by a failure split groups ──
    function beginGroups(){
      const n = g.n, fall = g.fall, gid = g.gid, sup = g.sup, sup0 = g.sup0, seed = g.seed, mat = g.mat, min = P.min, cr = L.crushed;
      let nf = 0, nc = 0;
      for (let i = 0; i < n; i++) {
        const m = mat[i], was = kind === 'rm' ? !seed[i] && sup0[i] >= min[m] : (seed[i] || sup0[i] >= min[m]);
        fall[i] = !cr[i] && was && (g.dis[i] ? 0 : sup[i] < min[m]) ? 1 : 0; gid[i] = -1; nf += fall[i]; nc += cr[i];
      }
      g.ng = 0; g.nf = nf; gat = 0; ci = 0; qh = qt = 0; L.nCrushed = nc;
    }
    function groupsMore(budget){
      const n = g.n, fall = g.fall, gid = g.gid, gList = g.gList, gOff = g.gOff, q = g.q, off = g.off, adj = g.adj, edis = L.edis;
      let left = Math.max(1, Math.floor(budget / OPW.groups)), used = 0;
      while (left > 0) {
        if (qh >= qt) {
          if (qt) { g.ng++; qh = qt = 0; }
          while (ci < n && (!fall[ci] || gid[ci] >= 0)) ci++;
          if (ci >= n) { gOff[g.ng] = gat; finish(); return Math.max(1, used); }
          gOff[g.ng] = gat; q[qt++] = ci; gid[ci] = g.ng;
        }
        while (qh < qt && left > 0) {
          const u = q[qh++]; gList[gat++] = u; left--; used += OPW.groups;
          for (let k = off[u], e = off[u + 1]; k < e; k++) { if (edis[k]) continue; const w = adj[k] >> 2; if (fall[w] && gid[w] < 0) { gid[w] = g.ng; q[qt++] = w; } }
        }
      }
      return Math.max(1, used);
    }
    function finish(){
      const n = g.n;
      let over = 0, unkN = 0, worst = 0, crushed = 0;
      for (let i = 0; i < n; i++) { if (L.unk[i]) unkN++; if (L.crushed[i]) crushed++; if (!L.cutv[i] && J.failing(i)) over++; if (L.ra[i] > worst && !L.unk[i]) worst = L.ra[i]; }
      const R = J.res = RES; R.ng = stopAt ? 0 : g.ng; R.nf = stopAt ? 0 : g.nf; R.n = n; R.over = over; R.unk = unkN; R.crushed = crushed; R.worst = worst; R.rounds = J.round; R.ops = J.ops; R.ticks = J.ticks; R.full = !!geo.full; R.tips = L.tips | 0; R.tipD = L.tipD ?? -1;
      L.tips = 0; L.tipD = -1;
      J.busy = false; J.done = true; J.phase = PH_DONE;
    }
    // placement verdict after a ratiosOnly 'add' run: refuse when any node goes ≤ 1000 → > 1000 ‰, or an overloaded node gets more
    J.refuses = () => {
      if (geo.full) return false;
      const n = g.n, mat = g.mat;
      for (let i = 0; i < n; i++) { if (L.unk[i] || P.lnone[mat[i]]) continue; const a = L.ra[i], b = L.rb[i]; if ((b <= 1000 && a > 1000) || (b > 1000 && a > b)) return true; }
      return false;
    };
    // load level for the build tint: worst after-ratio among nodes the edit raised (0 / ≤ 50 / ≤ 80 / ≤ 100 / > 100 %)
    J.loadLevel = () => {
      const n = g.n; let w = 0;
      for (let i = 0; i < n; i++) if (!L.unk[i] && !P.lnone[g.mat[i]] && L.ra[i] > L.rb[i] && L.ra[i] > w) w = L.ra[i];
      return w <= 0 ? 0 : w <= 500 ? 1 : w <= 800 ? 2 : w <= 1000 ? 3 : 4;
    };
    J.L = () => L;
    J.crushedList = out => { out.length = 0; const n = g.n; for (let i = 0; i < n; i++) if (L.crushed[i]) out.push(i); return out; };
    J.reset = () => { if (L) { L.edis.fill(0); L.adis.fill(0); L.crushed.fill(0); } };
    return J;
  }
  S.loadJob = geo => job(geo);
  // placement rule (v2): may block code go to (x, y, z)? v1 refuses — no; any node of the piece ≤ 1000 → > 1000 ‰, or an overloaded
  // node gets more — no; G.full or unk on the path — yes. Synchronous on a small grid (≤ 4,096 nodes: the estimate grid of the game).
  // → OUT { sup (v1 support of the new block), ok, lv (build tint = max(support level, load level)), load (load level), worst ‰ }
  const OUT = { sup: 0, ok: true, lv: 0, load: 0, worst: 0, n: 0 }, SEED4 = [0, 0, 0, 0], PCO = { ratiosOnly: true, kg: 1000 };
  // by parts (the game's tint at the world tick): S.placeStart(…) → G.loadJob().step(budget) until true → S.placeResult(G, code)
  S.placeStart = (G, x, y, z, code, read, b, o) => {
    SEED4[0] = x; SEED4[1] = y; SEED4[2] = z; SEED4[3] = code;
    PCO.kg = o && o.kg ? o.kg : 1000;
    return G.loadJob().start('add', SEED4, read, b, PCO);
  };
  S.placeResult = (G, code) => {
    const J = G.loadJob(), P = J.P, m = code >> 2, g = G.g, s = g.n ? g.sup[0] : 0, ld = J.loadLevel(), sl = S.level(s, m, P, g.gnd[0]);
    OUT.sup = s; OUT.n = g.n; OUT.load = ld; OUT.worst = J.res ? J.res.worst : 0; OUT.ok = g.n > 0 && s >= P.min[m] && !J.refuses(); OUT.lv = Math.max(sl, ld);
    return OUT;
  };
  S.placeCheck = (G, x, y, z, code, read, b, o) => { S.placeStart(G, x, y, z, code, read, b, o).run(); return S.placeResult(G, code); };

  function sortRange(a, lo, hi){ for (let i = lo + 1; i < hi; i++) { const v = a[i]; let j = i - 1; while (j >= lo && (a[j] >> 2) > (v >> 2)) { a[j + 1] = a[j]; j--; } a[j + 1] = v; } }

  // ═══ Падение целым куском (сетка): шагами игры, а не кадрами — одинаково при любой частоте кадров ═══
  // F = S.drop(cells, { down, g, vmax }) — cells: [x, y, z, …] (уже убраны из мира); снизу каждого столбика — «дно» (куда смотреть)
  // S.dropStep(F, dt, solid) — solid(x, y, z) → true, если клетка мира твёрдая; → true, когда лёг (F.off — целый сдвиг вниз)
  S.drop = (cells, o = {}) => {
    const dims = o.dims === 2 ? 2 : 3, down = o.down === 1 ? 1 : -1, n = (cells.length / 3) | 0;
    const key = (x, z) => x * 65536 + z;   // столбики
    const low = new Map();
    for (let i = 0; i < n; i++) {
      const x = cells[i * 3], y = cells[i * 3 + 1], z = dims === 2 ? 0 : cells[i * 3 + 2], k = key(x, z), b = low.get(k);
      if (b === undefined || (down < 0 ? y < b[1] : y > b[1])) low.set(k, [x, y, z]);
    }
    const bot = new Int32Array(low.size * 3); let j = 0;
    for (const v of [...low.keys()].sort((a, b) => a - b)) { const c = low.get(v); bot[j++] = c[0]; bot[j++] = c[1]; bot[j++] = c[2]; }
    return { n, bot, down, off: 0, fy: 0, vy: 0, t: 0, done: false, g: o.g ?? 24, vmax: o.vmax ?? 40, far: o.far ?? 96 };
  };
  S.dropStep = (F, dt, solid) => {
    if (F.done) return true;
    F.t += dt;
    F.vy = Math.min(F.vmax, F.vy + F.g * dt);
    let nf = F.fy + F.vy * dt;   // сдвиг вниз (клетки, дробно)
    const b = F.bot, nb = b.length / 3;
    // каждое «дно»: клетки мира между прежним и новым положением — твёрдая → лёг на неё (целый сдвиг)
    const from = Math.floor(F.fy) + 1, to = Math.floor(nf);
    let land = -1;
    for (let s = from; s <= to + 1 && land < 0; s++) {
      for (let k = 0; k < nb; k++) { const x = b[k * 3], y = b[k * 3 + 1] + F.down * s, z = b[k * 3 + 2]; if (solid(x, y, z)) { land = s - 1; break; } }
      if (s > to) break;
    }
    if (land < 0 && to + 1 >= F.far) land = Math.max(0, Math.min(to, F.far - 1));   // провалился в незагруженное — лёг на краю
    if (land >= 0) { F.off = land; F.fy = land; F.done = true; F.vy = 0; return true; }
    F.fy = nf; F.off = Math.floor(nf);
    return false;
  };

  // ═══ Зерно события «сломана опора» → случайные числа (одинаковые у всех) ═══
  S.rng = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  S.hash = (a, b = 0, c = 0, d = 0) => { let h = (a | 0) ^ Math.imul(b | 0, 0x27d4eb2d) ^ Math.imul(c | 0, 0x165667b1) ^ Math.imul(d | 0, 0x9e3779b1); h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; };
  S.hashStr = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
})();

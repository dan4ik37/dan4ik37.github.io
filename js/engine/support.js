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
  S.VERSION = 1;
  const MAXV = S.MAXV = 1000;

  // ═══ Материалы: ‰ за шаг (дерево слабее, камень и бетон крепче, металл — лучше всех вбок; вбок теряется больше, чем вверх) ═══
  // Шагов до «не держится» (реализм): дерево — 25 вверх / 6 вбок, камень — 45 / 4, кирпич — 50 / 5, бетон — 75 / 7, металл —
  // 110 / 13, стекло — 15 / 3; природное (скала, грунт) вверх не теряет — своды пещер держатся вбок на 9 / 3 клетки от стены.
  const MATS = S.MATS = [];
  const MAT = S.MAT = {};
  S.defineMat = d => {
    if (!d || !d.key) throw new Error('материал без имени');
    if (MAT[d.key] !== undefined) return MAT[d.key];
    if (MATS.length >= 250) throw new Error('слишком много материалов прочности');
    const m = Object.assign({ title: d.key, icon: '🧱', cap: MAXV, min: 100, up: 30, side: 150, down: 220, bear: 1, nat: 0 }, d);
    for (const k of ['cap', 'min', 'up', 'side', 'down']) m[k] = Math.max(0, Math.min(MAXV, Math.round(+m[k] || 0)));
    m.min = Math.max(1, m.min); m.bear = m.bear ? 1 : 0;
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
  // природное: вверх без потерь (толща держится столбом), вбок — свод пещеры, висеть не умеет (держится только снизу и сбоку)
  M({ key: 'rock', title: 'Скала (природная)', icon: '⛰️', up: 0, side: 100, down: MAXV, nat: 1 });
  M({ key: 'soil', title: 'Грунт (природный)', icon: '🌱', up: 0, side: 300, down: MAXV, nat: 1 });
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
    for (const m of MATS) {
      const i = m.id;
      P.cap[i] = m.cap; P.min[i] = m.min; P.bear[i] = m.bear;
      P.up[i] = Math.round(m.up * (mul.up ?? 1)); P.side[i] = Math.max(1, Math.round(m.side * (mul.side ?? 1))); P.down[i] = Math.max(1, Math.round(m.down * (mul.down ?? 1)));
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
    if (gnd === 1 || gnd === true ? s >= cap : false) return 0;
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
      mat: new Uint8Array(max), gnd: new Uint8Array(max), seed: new Uint8Array(max), off: new Int32Array(max + 1), adj: new Int32Array(max * deg),
      sup: new Uint16Array(max), sup0: new Uint16Array(max), dis: new Uint8Array(max), done: new Uint8Array(max), fall: new Uint8Array(max),
      nxt: new Int32Array(max), prv: new Int32Array(max), head: new Int32Array(MAXV + 1), gid: new Int32Array(max), gList: new Int32Array(max), gOff: new Int32Array(max + 1), ng: 0,
      q: new Int32Array(max),
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
      // gnd: 1 — опора снизу или сбоку (держание = cap), 2 — только висит под опорой (cap − «висит»)
      for (let i = 0; i < n; i++) {
        sup[i] = 0; done[i] = 0;
        if (useDis && dis[i]) { done[i] = 1; continue; }
        const gd = g.gnd[i];
        if (gd) { const m = mat[i], c = gd === 1 ? cap[m] : cap[m] - down[m]; if (c > 0) { sup[i] = c; ins(i, c); } }
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
  const NOT = -1, EMPTY = -2, ANCH = -3;
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
      px[i] = x; py[i] = y; pz[i] = z; dist[i] = d; g.mat[i] = code >> 2; g.gnd[i] = 0; g.seed[i] = isSeed ? 1 : 0;
      return i;
    }
    const NOB = {};
    // построить кусок: семена (их код — какой был), обход в ширину; b — свои пределы (лучше один объект на игру — без мусора)
    G.build = (seeds, read, b = NOB) => {
      const r = b.r ?? 64, rn = b.rn ?? 10, lim = Math.min(max, b.max || max);
      if (++gen > 65535) { stamp.fill(0); gen = 1; }
      used = 0; g.reset(); G.full = false;
      const ns = seeds.length >> 2;
      if (!ns) return 0;
      ox = seeds[0]; oy = seeds[1]; oz = dims === 2 ? 0 : seeds[2];
      for (let s = 0; s < ns; s++) {
        const x = seeds[s * 4], y = seeds[s * 4 + 1], z = dims === 2 ? 0 : seeds[s * 4 + 2], code = seeds[s * 4 + 3];
        const k = keyOf(x, y, z); if (k < 0 || look(k) !== NOT) continue;
        if ((code & 3) < 2 || g.n >= lim) { put(k, code === 1 ? ANCH : EMPTY); continue; }
        put(k, add(x, y, z, code, 0, true));
      }
      for (let i = 0; i < g.n; i++) {
        g.off[i] = g.ne;
        const x = px[i], y = py[i], z = pz[i], d = dist[i];
        for (let k6 = 0; k6 < deg; k6++) {
          const nx = x + DX[k6], ny = y + DY[k6], nz = z + DZ[k6];
          const k = keyOf(nx, ny, nz);
          if (k < 0) { if (REL[k6] !== 2) g.gnd[i] = 1; continue; }   // дальше 512 клеток — опора (снизу и сбоку)
          let v = look(k);
          if (v === NOT) {
            const c = read(nx, ny, nz) | 0, t = c & 3;
            if (t < 2) v = c === 1 ? ANCH : EMPTY;
            else if (d + 1 > r || (t === 3 && d + 1 > rn) || g.n >= lim || used >= HLIM) { v = ANCH; if (g.n >= lim || used >= HLIM) G.full = true; }
            else v = add(nx, ny, nz, c, d + 1, false);
            put(k, v);
          }
          if (v === ANCH) g.gnd[i] = REL[k6] === 2 ? (g.gnd[i] || 2) : 1;   // опора сверху — только «висит»
          else if (v >= 0) g.adj[g.ne++] = (v << 2) | REL[k6];
        }
      }
      g.off[g.n] = g.ne;
      return g.n;
    };
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
      g.mat[i] = mat | 0; g.gnd[i] = gnd ? 1 : 0; g.seed[i] = 0;
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
    return B;
  };
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

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — огонь (D37E.fire): одно ядро для 2D и 3D игр — горят клетки сетки («Кубомир», «Подземье») или детали
//  («Мир Денчика», «Студия 3D»). Как D37E.support: без Three.js и DOM (окно, поток, node), без мусора за шаг
// ═══════════════════════════════════════
// Горит не «огонь», а то, что горит: клетка (бревно, листва, доски, трава…) или деталь (дерево, ящик, мешок). У горящего —
// материал огня (FI.MATS: catch — как легко загорается от соседа, ‰ в секунду; burn — сколько горит, с; heat — как сильно
// поджигает соседей; rain — как гасит дождь, ‰ в секунду; char — с какой доли горения чернеет), возраст и срок. Каждый такт
// (свой у игры: «Кубомир» — 20 в секунду, «Подземье» — 30) ядро обходит не больше budget горящих по кругу (работа за такт
// ограничена: 2000 горящих — не дольше, чем 200), у каждого: догорел — onBurnt (игра убирает блок / ломает деталь, обрушение —
// её путём: D37E.support), погас под дождём — onOut, перекинулся на соседей — onIgnite. Всё — от номера такта и зерна (хеш,
// без Math.random): одинаково при 30 / 60 / 144 кадрах, на телефоне и ПК (бюджет не зависит от устройства), по сети достаточно
// события «загорелось здесь» с зерном. Чего не видно (чанк не загружен: read → −1) — замирает и ждёт.
//   FI = D37E.fire; FI.MATS / FI.MAT / FI.mat(key) / FI.defineMat({ key, catch, burn: [от, до], heat, rain, char }) — материалы
//   F = FI.grid({ dims: 3 | 2, down: −1 | +1, hz, cap, budget, seed, read(x, y, z) → материал (0 — не горит, −1 — не загружено;
//       бит 64 — «мокрое», не загорится), open(x, y, z) → true под открытым небом (дождь), onIgnite / onBurnt / onOut / onChar
//       (x, y, z, материал, слот) }) — клетки
//   F = FI.parts({ hz, cap, parts, budget, seed, cell, reach, onIgnite / onBurnt / onOut / onChar (id, материал, слот) }) —
//       детали: F.add(x, y, z, r, материал) → id, F.remove(id), F.move(id, x, y, z), F.restore(id) (сгоревшее — снова может гореть)
//   Общее: F.tick() — один такт (1 / hz с); F.step(dt) — накопить время игры и сделать такты; F.ignite(…) → слот или −1;
//   F.douse(x, y, z, r) — погасить вокруг (вода, ведро, водяная бомба) → сколько; F.setWind(м/с, куда дует — радианы по миру);
//   F.setRain(0…1); F.spread — перекидывается ли на соседей (выкл — горит только подожжённое); F.n, F.ACT — горящие (слоты),
//   F.X / F.Y / F.Z / F.M / F.AGE / F.LIFE / F.AUX / F.FL — их данные (AUX — для игры: куда поставлен блок огня и т. п.);
//   F.heat(слот) — 0…1 (разгорается, горит, догорает); F.save() / F.load(o); F.clear(); F.stats
(() => {
  const root = typeof self !== 'undefined' ? self : globalThis;
  const E = root.D37E = root.D37E || {};
  if (E.fire && E.fire.VERSION) return;
  const FI = E.fire = { VERSION: 1 };

  // ═══ Материалы огня (номер 0 — «не горит»). Числа — ‰ и секунды; одинаковые у всех (данные, не устройство) ═══
  // catch — шанс загореться за секунду рядом с соседом, горящим в полную силу (сбоку, без ветра); burn — сколько горит (с);
  // heat — сила, с которой поджигает соседей (‰); rain — шанс погаснуть за секунду под сильным дождём (‰); char — когда чернеет
  // (‰ срока; 1000 — не чернеет); smoke — сколько дыма (для картинки, 0…1)
  const MATS = FI.MATS = [], MAT = FI.MAT = {};
  FI.defineMat = d => {
    if (!d || !d.key) throw new Error('материал огня без имени');
    if (MAT[d.key] !== undefined) return MAT[d.key];
    if (MATS.length >= 63) throw new Error('слишком много материалов огня');
    const m = Object.assign({ title: d.key, icon: '🔥', catch: 200, burn: [8, 14], heat: 800, rain: 200, char: 1000, smoke: .5 }, d);
    for (const k of ['catch', 'heat', 'rain', 'char']) m[k] = Math.max(0, Math.min(1000, Math.round(+m[k] || 0)));
    const b = Array.isArray(m.burn) ? m.burn : [m.burn, m.burn];
    m.burn = [Math.max(.1, +b[0] || 1), Math.max(.1, +b[1] || +b[0] || 1)]; if (m.burn[1] < m.burn[0]) m.burn[1] = m.burn[0];
    m.id = MATS.length; MATS.push(m); MAT[m.key] = m.id;
    profs.clear();
    return m.id;
  };
  const profs = new Map();
  const M = FI.defineMat;
  M({ key: 'none', title: 'Не горит', icon: '🪨', catch: 0, burn: [0, 0], heat: 0, rain: 1000, smoke: 0 });
  M({ key: 'wood', title: 'Дерево (ствол, бревно)', icon: '🪵', catch: 140, burn: [24, 40], heat: 1000, rain: 100, char: 520, smoke: .8 });
  M({ key: 'planks', title: 'Доски, мебель, лестницы', icon: '🟫', catch: 260, burn: [12, 20], heat: 1000, rain: 140, char: 600, smoke: .7 });
  M({ key: 'leaves', title: 'Листва, хвоя', icon: '🍃', catch: 650, burn: [2.5, 5], heat: 850, rain: 320, smoke: 1 });
  M({ key: 'grass', title: 'Трава, кусты, цветы', icon: '🌾', catch: 900, burn: [1.2, 2.6], heat: 700, rain: 700, smoke: .6 });
  M({ key: 'turf', title: 'Дёрн (горит трава сверху)', icon: '🟩', catch: 140, burn: [1.5, 3], heat: 450, rain: 800, smoke: .4 });
  M({ key: 'cloth', title: 'Ткань, шерсть, верёвка', icon: '🧶', catch: 450, burn: [5, 9], heat: 750, rain: 300, smoke: .6 });
  M({ key: 'fuel', title: 'Горючее (масло, уголь)', icon: '🛢️', catch: 950, burn: [10, 18], heat: 1000, rain: 40, smoke: 1 });
  M({ key: 'char', title: 'Обугленное', icon: '⬛', catch: 60, burn: [5, 9], heat: 600, rain: 250, smoke: .5 });
  M({ key: 'flame', title: 'Пламя без топлива', icon: '🔥', catch: 0, burn: [3, 7], heat: 700, rain: 900, smoke: .3 });
  M({ key: 'tree', title: 'Дерево целиком (деталь)', icon: '🌳', catch: 420, burn: [18, 30], heat: 1000, rain: 150, char: 600, smoke: 1 });
  FI.VANILLA = MATS.length;
  const MAT_FLAME = MAT.flame;
  FI.mat = key => (key && MAT[key] !== undefined ? MAT[key] : 0);

  // ═══ Таблицы по частоте тактов: сроки — в тактах (целые), шансы — доли за такт (double: только + − × ÷ — одинаково везде) ═══
  FI.prof = hz => {
    hz = Math.max(1, Math.round(hz) || 20);
    let P = profs.get(hz); if (P) return P;
    const n = MATS.length;
    P = { hz, lifeMin: new Uint16Array(n), lifeSpan: new Uint16Array(n), catchK: new Float64Array(n), heatK: new Float64Array(n), rainK: new Float64Array(n), charK: new Uint16Array(n) };
    for (const m of MATS) {
      const i = m.id, a = Math.max(1, Math.round(m.burn[0] * hz)), b = Math.max(a, Math.round(m.burn[1] * hz));
      P.lifeMin[i] = Math.min(65000, a); P.lifeSpan[i] = Math.min(65000 - P.lifeMin[i], b - a);
      P.catchK[i] = m.catch / 1000 / hz; P.heatK[i] = m.heat / 1000; P.rainK[i] = m.rain / 1000 / hz; P.charK[i] = m.char;
    }
    profs.set(hz, P);
    return P;
  };

  // ═══ Хеш (как у движка: support.js, voxel.js) — случайность без Math.random: от места и номера такта ═══
  const imul = Math.imul;
  const hash = (a, b, c, d, e) => {
    let h = (a | 0) ^ imul(b | 0, 0x27d4eb2d) ^ imul(c | 0, 0x165667b1) ^ imul(d | 0, 0x9e3779b1) ^ imul(e | 0, 0x85ebca77);
    h = imul(h ^ (h >>> 15), 0x85ebca6b); h = imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 2;   // 30 бит — малое целое (V8 не «упаковывает»)
  };
  FI.hash = hash;
  const U32 = 1073741824;   // 2^30 — шкала хеша
  FI.seedOf = s => { if (typeof s === 'number' && Number.isFinite(s)) return s >>> 0; let h = 2166136261; s = String(s ?? ''); for (let i = 0; i < s.length; i++) h = imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

  // ═══ Ветер и дождь — с округлением (у всех одно и то же, даже если cos/sin в браузерах отличаются в последнем бите) ═══
  function windState(F, speed, dir){
    const s = Math.max(0, Math.min(40, Math.round((+speed || 0) * 2) / 2));
    const d = +dir || 0;
    F.ws = s; F.wx = Math.round(Math.cos(d) * 16); F.wz = Math.round(Math.sin(d) * 16);
    F.wk = Math.min(2, s / 6);   // насколько ветер гонит огонь (×1 … ×3 по ветру, ×0,2 против)
    // куда летят угли (2 клетки по ветру, если ветер ≥ 5 м/с)
    const l = Math.hypot(F.wx, F.wz) || 1;
    F.sx = Math.round(F.wx / l * 2); F.sz = Math.round(F.wz / l * 2);
  }

  // ═══ Общее: таблица горящих (слоты), обход по кругу с бюджетом ═══
  function core(o, kind){
    const cap = Math.max(16, Math.min(1 << 16, o.cap | 0 || 4096));
    const F = {
      kind, cap, n: 0, T: 0, acc: 0, hz: Math.max(1, Math.round(o.hz) || 20), seed: FI.seedOf(o.seed ?? 1), budget: Math.max(8, o.budget | 0 || 160),
      spread: o.spread !== false, rain: 0, rainQ: 0, dry: 1, ws: 0, wx: 0, wz: 0, wk: 0, sx: 0, sz: 0, cur: 0,
      X: new Int32Array(cap), Y: new Int32Array(cap), Z: new Int32Array(cap), M: new Uint8Array(cap), AGE: new Uint16Array(cap), LIFE: new Uint16Array(cap),
      LAST: new Uint32Array(cap), AUX: new Int32Array(cap), FL: new Uint8Array(cap), ACT: new Int32Array(cap), POS: new Int32Array(cap), FREE: new Int32Array(cap), nfree: cap,
      stats: { ignited: 0, burnt: 0, out: 0, refused: 0, visits: 0, ticks: 0, peak: 0, gone: 0 },
    };
    for (let i = 0; i < cap; i++) F.FREE[i] = cap - 1 - i;
    F.P = FI.prof(F.hz);
    F.onIgnite = o.onIgnite || null; F.onBurnt = o.onBurnt || null; F.onOut = o.onOut || null; F.onChar = o.onChar || null;
    F.setWind = (speed, dir) => windState(F, speed, dir);
    F.setRain = k => { const q = Math.max(0, Math.min(16, Math.round((+k || 0) * 16))); F.rainQ = q; F.rain = q / 16; };
    F.setDry = k => { F.dry = Math.max(.25, Math.min(2, Math.round((+k || 1) * 16) / 16)); };   // засуха / сырость (×)
    F.setWind(o.wind || 0, o.windDir || 0); F.setRain(o.rain || 0);
    // фаза горения → сила: разгорается (первые 10 %), горит, догорает (последние 15 %)
    F.heat = s => { const L = F.LIFE[s] || 1, ph = F.AGE[s] / L; return ph < .1 ? .3 + 7 * ph : ph > .85 ? Math.max(.35, 1 - (ph - .85) / .15 * .65) : 1; };
    F.phase = s => F.AGE[s] / (F.LIFE[s] || 1);
    return F;
  }
  function alloc(F){
    if (!F.nfree) return -1;
    const s = F.FREE[--F.nfree];
    F.POS[s] = F.n; F.ACT[F.n++] = s;
    if (F.n > F.stats.peak) F.stats.peak = F.n;
    return s;
  }
  function release(F, s){
    const i = F.POS[s], last = F.ACT[--F.n];
    F.ACT[i] = last; F.POS[last] = i;
    F.FREE[F.nfree++] = s;
    F.M[s] = 0; F.FL[s] = 0; F.AUX[s] = 0;
  }
  // срок горения — от места и номера такта (у всех одинаково)
  function lifeOf(F, m, a, b, c){
    if (F.P.lifeMin.length !== MATS.length) F.P = FI.prof(F.hz);
    const P = F.P, span = P.lifeSpan[m];
    return P.lifeMin[m] + (span ? hash(F.seed, a, b, c, F.T ^ 0x51ed) % (span + 1) : 0);
  }
  // обход по кругу: не больше budget за такт; убранный — на его место встаёт последний (смотрим его же номер ещё раз)
  function run(F, visit){
    if (F.P.lifeMin.length !== MATS.length) F.P = FI.prof(F.hz);   // моды дописали материалы
    const n0 = F.n; if (!n0) return;
    let left = Math.min(n0, F.budget);
    if (F.cur >= F.n) F.cur = 0;
    while (left-- > 0 && F.n) {
      if (F.cur >= F.n) F.cur = 0;
      const s = F.ACT[F.cur];
      F.stats.visits++;
      if (visit(s)) continue;   // убран — на этом месте уже другой
      F.cur++;
    }
  }
  // общий конец шага горящего: возраст, «чернеет», дождь → true, если убран
  function age(F, s, el, open){
    const P = F.P, m = F.M[s];
    let a = F.AGE[s] + el;
    if (a >= F.LIFE[s]) { F.AGE[s] = F.LIFE[s]; F.stats.burnt++; return 2; }   // догорел
    F.AGE[s] = a;
    if (!(F.FL[s] & 1) && P.charK[m] < 1000 && a * 1000 >= F.LIFE[s] * P.charK[m]) { F.FL[s] |= 1; return 3; }   // почернел
    if (F.rainQ && open) {
      const p = P.rainK[m] * F.rain * el;
      if (p > 0 && hash(F.seed, F.X[s], F.Y[s], F.Z[s], F.T ^ 0x7a1) < p * U32) { F.stats.out++; return 1; }   // погас
    }
    return 0;
  }
  function stepper(F){
    F.step = dt => {
      F.acc += +dt || 0;
      const T1 = 1 / F.hz; let k = 0;
      while (F.acc >= T1 - 1e-9 && k < 8) { F.acc -= T1; F.tick(); k++; }
      if (F.acc > T1 * 8) F.acc = 0;   // долго не было (вкладка спала) — не догоняем
      return k;
    };
  }

  // ═══ Клетки: 2D (x, y; y вниз — down: 1) или 3D (x, y, z; y вверх — down: −1) ═══
  FI.grid = (o = {}) => {
    const F = core(o, 'grid');
    const dims = o.dims === 2 ? 2 : 3, DOWN = o.down === 1 ? 1 : -1, U = -DOWN;
    const read = o.read || (() => 0), open = o.open || null;
    F.dims = dims; F.down = DOWN;
    // хеш-таблица клеток (открытая адресация, удаление сдвигом назад — без «надгробий»)
    let HS = 1; while (HS < F.cap * 2) HS <<= 1;
    const HM = HS - 1, HK = new Int32Array(HS).fill(-1);
    const hpos = (x, y, z) => hash(x, y, z, 0x2545f491, 0) & HM;
    const X = F.X, Y = F.Y, Z = F.Z;
    function find(x, y, z){
      let h = hpos(x, y, z);
      for (;;) { const s = HK[h]; if (s < 0) return -1; if (X[s] === x && Y[s] === y && Z[s] === z) return s; h = (h + 1) & HM; }
    }
    function hdel(s){
      let p = hpos(X[s], Y[s], Z[s]);
      while (HK[p] !== s) p = (p + 1) & HM;
      HK[p] = -1;
      let q = (p + 1) & HM;
      while (HK[q] >= 0) {
        const t = HK[q], h = hpos(X[t], Y[t], Z[t]);
        const keep = p <= q ? h > p && h <= q : h > p || h <= q;
        if (!keep) { HK[p] = t; HK[q] = -1; p = q; }
        q = (q + 1) & HM;
      }
    }
    F.find = (x, y, z = 0) => find(x | 0, y | 0, dims === 2 ? 0 : z | 0);
    F.has = (x, y, z = 0) => F.find(x, y, z) >= 0;
    function drop(s, why){
      const x = X[s], y = Y[s], z = Z[s], m = F.M[s];
      hdel(s); release(F, s);
      const cb = why === 2 ? F.onBurnt : why === 1 ? F.onOut : null;
      if (cb) cb(x, y, z, m, s);
    }
    // поджечь: m — материал (нет — какой есть в клетке); o.force — даже если «мокрое»; o.aux — данные игры
    F.ignite = (x, y, z = 0, m, io) => {
      x |= 0; y |= 0; z = dims === 2 ? 0 : z | 0;
      if (find(x, y, z) >= 0) return -1;
      if (!m) { const c = read(x, y, z); if (c <= 0 || (c & 64 && !(io && io.force))) return -1; m = c & 63; }
      if (!(m > 0 && m < MATS.length)) return -1;
      const s = alloc(F); if (s < 0) { F.stats.refused++; return -1; }
      X[s] = x; Y[s] = y; Z[s] = z; F.M[s] = m; F.AGE[s] = 0; F.LIFE[s] = Math.max(1, lifeOf(F, m, x, y, z)); F.LAST[s] = F.T; F.AUX[s] = io && io.aux | 0 || 0; F.FL[s] = 0;
      let h = hpos(x, y, z); while (HK[h] >= 0) h = (h + 1) & HM; HK[h] = s;
      F.stats.ignited++;
      if (F.onIgnite) F.onIgnite(x, y, z, m, s);
      return s;
    };
    F.out = (x, y, z = 0) => { const s = F.find(x, y, z); if (s < 0) return false; F.stats.out++; drop(s, 1); return true; };
    // погасить вокруг (куб радиуса r ≤ 4; 2D — квадрат)
    F.douse = (x, y, z = 0, r = 1) => {
      r = Math.max(0, Math.min(4, Math.round(r))); let n = 0;
      if (!F.n) return 0;
      x |= 0; y |= 0; z |= 0;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = dims === 2 ? 0 : -r; dz <= (dims === 2 ? 0 : r); dz++) {
        const s = find(x + dx, y + dy, dims === 2 ? 0 : z + dz); if (s < 0) continue;
        F.stats.out++; drop(s, 1); n++;
      }
      return n;
    };
    // соседи: [dx, dy, dz, вид] — 0 вверх (×3), 1 вбок (×1), 2 вниз (×0,3), 3 вверх-вбок (×1,3)
    const NB = dims === 2
      ? [1, 0, 0, 1, -1, 0, 0, 1, 0, U, 0, 0, 0, -U, 0, 2, 1, U, 0, 3, -1, U, 0, 3]
      : [1, 0, 0, 1, -1, 0, 0, 1, 0, 0, 1, 1, 0, 0, -1, 1, 0, U, 0, 0, 0, -U, 0, 2, 1, U, 0, 3, -1, U, 0, 3, 0, U, 1, 3, 0, U, -1, 3];
    const NBN = NB.length / 4, DIRK = new Float64Array([3, 1, .3, 1.3]);
    // дробные числа шага — в постоянном массиве (не аргументами: V8 «упаковывает» дробное в аргументе невстроенной функции)
    const KS = new Float64Array(2);   // 0 — сила горящего (тепло × фаза × сухость × дождь), 1 — угли по ветру (×)
    // сосед (dx, dy, dz): загорится ли? k — номер стороны в DIRK (−1 — угли по ветру), salt — своя случайность
    function tryCatch(sx, sy, sz, el, dx, dy, dz, k, salt){
      const nx = sx + dx, ny = sy + dy, nz = sz + dz;
      const c = read(nx, ny, nz); if (c <= 0 || c & 64) return;
      const m2 = c & 63, ck = F.P.catchK[m2]; if (!(ck > 0)) return;
      if (find(nx, ny, nz) >= 0) return;
      let wind = 1;
      if (F.wk > 0 && (dx || dz)) {   // по ветру — быстрее, против — медленнее (вверх и вниз — без ветра)
        const a = dims === 2 ? (dx > 0 ? F.wx : -F.wx) / 16 : (dx * F.wx + dz * F.wz) / (16 * Math.sqrt(dx * dx + dz * dz));
        wind = 1 + F.wk * a; if (wind < .2) wind = .2;
      }
      const p = ck * KS[0] * (k >= 0 ? DIRK[k] : KS[1]) * wind * el;
      if (p > 0 && hash(F.seed, nx, ny, nz, F.T ^ salt) < p * U32) F.ignite(nx, ny, nz, m2);
    }
    const visit = s => {
      const x = X[s], y = Y[s], z = Z[s], m = F.M[s];
      const el = F.T - F.LAST[s]; if (el <= 0) return false;
      // топливо на месте? (сломали, залили, упало) — тихо убрать; не загружено — замереть
      if (m !== MAT_FLAME) {
        const c = read(x, y, z);
        if (c < 0) { F.LAST[s] = F.T; return false; }
        if (c === 0 || c & 64) { F.stats.gone++; hdel(s); release(F, s); if (F.onOut) F.onOut(x, y, z, m, s); return true; }   // убрали или залили
      }
      F.LAST[s] = F.T;
      const op = F.rainQ ? (open ? !!open(x, y, z) : true) : false;
      const r = age(F, s, el, op);
      if (r === 1 || r === 2) { drop(s, r); return true; }
      if (r === 3 && F.onChar) F.onChar(x, y, z, m, s);
      if (!F.spread) return false;
      // перекинуться на соседей: шанс за секунду × сила горящего × фаза × сторона × ветер × сухость (под дождём — меньше)
      const L = F.LIFE[s] || 1, ph = F.AGE[s] / L;
      const hk = ph < .1 ? .3 + 7 * ph : ph > .85 ? Math.max(.35, 1 - (ph - .85) / .15 * .65) : 1;   // = F.heat(s)
      KS[0] = F.P.heatK[m] * hk * F.dry * (op ? 1 - .75 * F.rain : 1);
      if (!(KS[0] > 0)) return false;
      for (let i = 0; i < NBN; i++) tryCatch(x, y, z, el, NB[i * 4], NB[i * 4 + 1], NB[i * 4 + 2], NB[i * 4 + 3], 0x3c6e + i);
      // угли по ветру (≥ 5 м/с): на 2 клетки (и выше на 1)
      if (F.ws >= 5 && (F.sx || F.sz)) {
        KS[1] = .35 * Math.min(1, (F.ws - 4) / 8);
        tryCatch(x, y, z, el, F.sx, 0, dims === 2 ? 0 : F.sz, -1, 0x5f11);
        tryCatch(x, y, z, el, F.sx, U, dims === 2 ? 0 : F.sz, -1, 0x5f12);
      }
      return false;
    };
    F.tick = () => { F.T++; F.stats.ticks++; run(F, visit); };
    stepper(F);
    F.clear = () => { HK.fill(-1); F.n = 0; F.nfree = F.cap; for (let i = 0; i < F.cap; i++) F.FREE[i] = F.cap - 1 - i; F.cur = 0; };
    // сохранить / загрузить (числа — для JSON): [x, y, z, материал, возраст, срок, aux, флаги, тактов с прошлого обхода, …] + номер
    // такта и место обхода — продолжится ровно так, как без перерыва
    F.save = () => { const c = []; for (let i = 0; i < F.n; i++) { const s = F.ACT[i]; c.push(X[s], Y[s], Z[s], F.M[s], F.AGE[s], F.LIFE[s], F.AUX[s], F.FL[s], F.T - F.LAST[s]); } return { v: 2, t: F.T, cur: F.cur, c }; };
    F.load = d => {
      F.clear();
      if (!d || !Array.isArray(d.c)) return 0;
      if (Number.isFinite(d.t)) F.T = d.t >>> 0;
      const c = d.c, W = d.v === 2 ? 9 : 8;
      for (let i = 0; i + W - 1 < c.length; i += W) {
        const x = c[i] | 0, y = c[i + 1] | 0, z = dims === 2 ? 0 : c[i + 2] | 0, m = c[i + 3] | 0;
        if (!(m > 0 && m < MATS.length) || find(x, y, z) >= 0) continue;
        const s = alloc(F); if (s < 0) break;
        X[s] = x; Y[s] = y; Z[s] = z; F.M[s] = m; F.LIFE[s] = Math.max(1, Math.min(65000, c[i + 5] | 0)); F.AGE[s] = Math.min(F.LIFE[s] - 1, Math.max(0, c[i + 4] | 0)); F.AUX[s] = c[i + 6] | 0; F.FL[s] = c[i + 7] & 255;
        F.LAST[s] = (F.T - (W === 9 ? Math.max(0, Math.min(F.T, c[i + 8] | 0)) : 0)) >>> 0;
        let h = hpos(x, y, z); while (HK[h] >= 0) h = (h + 1) & HM; HK[h] = s;
      }
      F.cur = Number.isFinite(d.cur) ? Math.max(0, d.cur | 0) : 0;
      return F.n;
    };
    return F;
  };

  // ═══ Детали: точки с радиусом (дерево, ящик, деталь студии); соседи — в радиусе reach (по сетке столбцов cell × cell) ═══
  FI.parts = (o = {}) => {
    const F = core(o, 'parts');
    const NP = Math.max(16, Math.min(1 << 16, o.parts | 0 || 4096)), CELL = Math.max(1, +o.cell || 6), REACH = Math.max(.5, +o.reach || 5);
    F.reach = REACH; F.cellSize = CELL;
    const PX = new Float32Array(NP), PY = new Float32Array(NP), PZ = new Float32Array(NP), PR = new Float32Array(NP), PM = new Uint8Array(NP), PB = new Uint8Array(NP), LIVE = new Uint8Array(NP);
    const NEXT = new Int32Array(NP).fill(-1), CK = new Int32Array(NP), SLOT = new Int32Array(NP).fill(-1), PFREE = new Int32Array(NP);
    let npf = NP; for (let i = 0; i < NP; i++) PFREE[i] = NP - 1 - i;
    F.PX = PX; F.PY = PY; F.PZ = PZ; F.PR = PR; F.PM = PM; F.PB = PB; F.LIVE = LIVE; F.SLOT = SLOT; F.np = 0;
    // столбцы сетки: ключ (ix, iz) → первая деталь
    let HS = 1; while (HS < NP * 2) HS <<= 1;
    const HM = HS - 1, HKEY = new Int32Array(HS), HHEAD = new Int32Array(HS).fill(-1), HUSE = new Uint8Array(HS);
    const ckey = (ix, iz) => ((ix & 0xffff) | ((iz & 0xffff) << 16)) | 0;
    function cslot(key, make){
      let h = hash(key, 0x71d3, 0, 0, 0) & HM;
      for (;;) { if (!HUSE[h]) { if (!make) return -1; HUSE[h] = 1; HKEY[h] = key; HHEAD[h] = -1; return h; } if (HKEY[h] === key) return h; h = (h + 1) & HM; }
    }
    function link(p){ const ix = Math.floor(PX[p] / CELL), iz = Math.floor(PZ[p] / CELL), k = ckey(ix, iz), h = cslot(k, true); CK[p] = h; NEXT[p] = HHEAD[h]; HHEAD[h] = p; }
    function unlink(p){ const h = CK[p]; let q = HHEAD[h], prev = -1; while (q >= 0 && q !== p) { prev = q; q = NEXT[q]; } if (q < 0) return; if (prev < 0) HHEAD[h] = NEXT[p]; else NEXT[prev] = NEXT[p]; NEXT[p] = -1; }
    // деталь: центр, радиус (полразмера), материал огня → номер (−1 — места нет)
    F.add = (x, y, z, r, m) => {
      if (!npf) return -1;
      const p = PFREE[--npf];
      PX[p] = +x || 0; PY[p] = +y || 0; PZ[p] = +z || 0; PR[p] = Math.max(0, +r || 0); PM[p] = m > 0 && m < MATS.length ? m : 0; PB[p] = 0; LIVE[p] = 1; SLOT[p] = -1;
      link(p); if (p + 1 > F.np) F.np = p + 1;
      return p;
    };
    F.remove = p => { if (!(p >= 0 && p < NP) || !LIVE[p]) return; if (SLOT[p] >= 0) { const s = SLOT[p]; SLOT[p] = -1; release(F, s); } unlink(p); LIVE[p] = 0; PFREE[npf++] = p; };
    F.move = (p, x, y, z) => { if (!(p >= 0 && p < NP) || !LIVE[p]) return; unlink(p); PX[p] = x; PY[p] = y; PZ[p] = z; link(p); };
    F.setMat = (p, m) => { if (p >= 0 && p < NP && LIVE[p]) PM[p] = m > 0 && m < MATS.length ? m : 0; };
    F.restore = p => { if (p >= 0 && p < NP) PB[p] = 0; };
    F.burning = p => p >= 0 && p < NP && SLOT[p] >= 0;
    F.burnt = p => p >= 0 && p < NP && !!PB[p];
    function drop(s, why){
      const p = F.X[s], m = F.M[s];
      SLOT[p] = -1; release(F, s);
      if (why === 2) PB[p] = 1;
      const cb = why === 2 ? F.onBurnt : why === 1 ? F.onOut : null;
      if (cb) cb(p, m, s);
    }
    F.ignite = (p, m, io) => {
      if (!(p >= 0 && p < NP) || !LIVE[p] || SLOT[p] >= 0 || (PB[p] && !(io && io.force))) return -1;
      m = m || PM[p]; if (!(m > 0 && m < MATS.length)) return -1;
      const s = alloc(F); if (s < 0) { F.stats.refused++; return -1; }
      F.X[s] = p; F.Y[s] = 0; F.Z[s] = 0; F.M[s] = m; F.AGE[s] = 0; F.LIFE[s] = Math.max(1, lifeOf(F, m, p, 0x51, 0)); F.LAST[s] = F.T; F.AUX[s] = io && io.aux | 0 || 0; F.FL[s] = 0;
      SLOT[p] = s; PB[p] = 0;
      F.stats.ignited++;
      if (F.onIgnite) F.onIgnite(p, m, s);
      return s;
    };
    F.out = p => { if (!(p >= 0 && p < NP) || SLOT[p] < 0) return false; F.stats.out++; drop(SLOT[p], 1); return true; };
    // ближайшая к точке деталь, которая может гореть (поджечь взрывом, костром, молнией) → номер или −1
    F.nearest = (x, y, z, r) => {
      let best = -1, bd = Infinity;
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const h = cslot(ckey(i, j), false); if (h < 0) continue;
        for (let q = HHEAD[h]; q >= 0; q = NEXT[q]) {
          if (!PM[q] || !LIVE[q]) continue;
          const d = Math.hypot(PX[q] - x, PY[q] - y, PZ[q] - z) - PR[q];
          if (d <= r && d < bd) { bd = d; best = q; }
        }
      }
      return best;
    };
    // поджечь всё горючее в радиусе (взрыв): шанс — по расстоянию, от зерна → сколько
    F.igniteNear = (x, y, z, r, seed = 0) => {
      let n = 0;
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const h = cslot(ckey(i, j), false); if (h < 0) continue;
        for (let q = HHEAD[h]; q >= 0; q = NEXT[q]) {
          if (!PM[q] || !LIVE[q] || SLOT[q] >= 0 || PB[q]) continue;
          const d = Math.max(0, Math.hypot(PX[q] - x, PY[q] - y, PZ[q] - z) - PR[q]);
          if (d > r) continue;
          const p = (1 - d / r) * (.4 + .6 * F.P.catchK[PM[q]] * F.hz);   // ближе и горючее — вернее
          if (hash(F.seed, q, seed | 0, 0x1a, 0) < p * U32 && F.ignite(q) >= 0) n++;
        }
      }
      return n;
    };
    F.douse = (x, y, z, r) => {
      let n = 0;
      for (let i = F.n - 1; i >= 0; i--) {
        const s = F.ACT[i], p = F.X[s];
        if (Math.hypot(PX[p] - x, PY[p] - y, PZ[p] - z) - PR[p] <= r) { F.stats.out++; drop(s, 1); n++; }
      }
      return n;
    };
    const visit = s => {
      const p = F.X[s], m = F.M[s];
      const el = F.T - F.LAST[s]; if (el <= 0) return false;
      F.LAST[s] = F.T;
      if (!LIVE[p]) { SLOT[p] = -1; release(F, s); F.stats.gone++; return true; }
      const op = F.rainQ && o.open ? !!o.open(p) : !!F.rainQ;
      const r = age(F, s, el, op);
      if (r === 1 || r === 2) { drop(s, r); return true; }
      if (r === 3 && F.onChar) F.onChar(p, m, s);
      if (!F.spread) return false;
      const L = F.LIFE[s] || 1, ph = F.AGE[s] / L, hk = ph < .1 ? .3 + 7 * ph : ph > .85 ? Math.max(.35, 1 - (ph - .85) / .15 * .65) : 1;
      const base = F.P.heatK[m] * hk * F.dry * (op ? 1 - .75 * F.rain : 1);
      if (!(base > 0)) return false;
      // соседи в радиусе: чем ближе (зазор между краями) — тем вернее; выше — легче (огонь идёт вверх); по ветру — дальше
      const x = PX[p], y = PY[p], z = PZ[p], rr = PR[p], reach = REACH * (1 + .5 * F.wk);
      const i0 = Math.floor((x - rr - reach) / CELL), i1 = Math.floor((x + rr + reach) / CELL), j0 = Math.floor((z - rr - reach) / CELL), j1 = Math.floor((z + rr + reach) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const h = cslot(ckey(i, j), false); if (h < 0) continue;
        for (let q = HHEAD[h]; q >= 0; q = NEXT[q]) {
          if (q === p || !PM[q] || SLOT[q] >= 0 || PB[q] || !LIVE[q]) continue;
          const ck = F.P.catchK[PM[q]]; if (!(ck > 0)) continue;
          const dx = PX[q] - x, dy = PY[q] - y, dz = PZ[q] - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz), gap = d - rr - PR[q];
          let w = 1;
          if (F.wk > 0 && d > 1e-6) { w = 1 + F.wk * (dx * F.wx + dz * F.wz) / (16 * d); if (w < .2) w = .2; }
          const lim = REACH * (w > 1 ? w * .75 + .25 : 1);
          if (gap > lim) continue;
          const g = gap <= 0 ? 1 : 1 - gap / lim, up = dy > rr * .5 ? 1.6 : dy < -rr ? .6 : 1;
          const pr = ck * base * g * g * up * w * el;
          if (pr > 0 && hash(F.seed, p, q, F.T, 0x6a09) < pr * U32) F.ignite(q);
        }
      }
      return false;
    };
    F.tick = () => { F.T++; F.stats.ticks++; run(F, visit); };
    stepper(F);
    F.clear = () => { for (let i = F.n - 1; i >= 0; i--) { const s = F.ACT[i]; SLOT[F.X[s]] = -1; } F.n = 0; F.nfree = F.cap; for (let i = 0; i < F.cap; i++) F.FREE[i] = F.cap - 1 - i; F.cur = 0; };
    F.reset = () => { F.clear(); HUSE.fill(0); HHEAD.fill(-1); NEXT.fill(-1); LIVE.fill(0); PB.fill(0); PM.fill(0); SLOT.fill(-1); npf = NP; for (let i = 0; i < NP; i++) PFREE[i] = NP - 1 - i; F.np = 0; };
    return F;
  };

  // ═══ Набор клеток без мусора (для картинки: где стоят блоки огня — у хозяина и у гостя одинаково, по правкам мира) ═══
  // S = FI.cellSet(cap, dims) → S.add(x, y, z) / S.del(x, y, z) / S.has(x, y, z), S.n, S.X / S.Y / S.Z (плотно: 0…n − 1), S.clear()
  FI.cellSet = (cap = 4096, dims = 3) => {
    cap = Math.max(16, cap | 0);
    let HS = 1; while (HS < cap * 2) HS <<= 1;
    const HM = HS - 1, HK = new Int32Array(HS).fill(-1), X = new Int32Array(cap), Y = new Int32Array(cap), Z = new Int32Array(cap);
    const S = { n: 0, cap, X, Y, Z, full: 0 };
    const hp = (x, y, z) => hash(x, y, z, 0x1b873593, 0) & HM;
    function find(x, y, z){ let h = hp(x, y, z); for (;;) { const i = HK[h]; if (i < 0) return -1; if (X[i] === x && Y[i] === y && Z[i] === z) return h; h = (h + 1) & HM; } }
    function hdel(p){
      HK[p] = -1;
      let q = (p + 1) & HM;
      while (HK[q] >= 0) {
        const t = HK[q], h = hp(X[t], Y[t], Z[t]);
        const keep = p <= q ? h > p && h <= q : h > p || h <= q;
        if (!keep) { HK[p] = t; HK[q] = -1; p = q; }
        q = (q + 1) & HM;
      }
    }
    S.has = (x, y, z = 0) => find(x | 0, y | 0, dims === 2 ? 0 : z | 0) >= 0;
    S.add = (x, y, z = 0) => {
      x |= 0; y |= 0; z = dims === 2 ? 0 : z | 0;
      if (find(x, y, z) >= 0) return false;
      if (S.n >= cap) { S.full++; return false; }
      const i = S.n++; X[i] = x; Y[i] = y; Z[i] = z;
      let h = hp(x, y, z); while (HK[h] >= 0) h = (h + 1) & HM; HK[h] = i;
      return true;
    };
    S.del = (x, y, z = 0) => {
      x |= 0; y |= 0; z = dims === 2 ? 0 : z | 0;
      const p = find(x, y, z); if (p < 0) return false;
      const i = HK[p]; hdel(p);
      const last = --S.n;
      if (i !== last) {   // последний — на место удалённого (номер в таблице — поправить)
        const lp = find(X[last], Y[last], Z[last]);
        X[i] = X[last]; Y[i] = Y[last]; Z[i] = Z[last]; HK[lp] = i;
      }
      return true;
    };
    S.clear = () => { HK.fill(-1); S.n = 0; };
    return S;
  };
})();

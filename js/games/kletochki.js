// ═══════════════════════════════════════
//  «КЛЕТОЧКИ» — как agar.io: ты клетка — ешь точки и тех, кто меньше, расти; делись и выбрасывай массу; колючки рвут больших
// ═══════════════════════════════════════
// Раунд 5 минут, потом 8 с итогов (пьедестал) и новый раунд. Съели — затемнение и «Ещё раз» (без жестокости: просто «тебя
// съели»). Боты добивают комнату до 12 участников (не меньше 2 ботов). Онлайн — js/games/iokit.js: мир считает хозяин, гости
// шлют управление, снимки — двоичные, только то, что видно. Без сети — те же правила с ботами.
// Мир — типизированные массивы (клетки, колючки, выбросы, еда), без новых объектов на шаге и кадре; столкновения — по сетке
// 36×36. Шаг 1/30 с, управление — состояние с отметкой времени (одинаково при 30/60/144 кадрах — scripts/kletochki-test.cjs).
// Части клетки — данные (PARTS): заготовка стадии «клетка» во «Вселенной» (docs/superpowers/specs/2026-10-16-universe-design.md,
// 5.1). Здесь у всех тело base — одинаковые правила, отличаются только раскраски (бесплатно).
// Ключи сервера: kletochki (с ботами), kletochki_online (2+ человека); очки — лучшая масса за жизнь, победа — 1-е место в
// конце раунда (от 3 участников, прожил ≥ 60 с). Монеты — масса/100, до 10 (coin_run_cap).
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const K = root.IoKit;
  const { clamp, rnd, hash3, TAU } = K;

  const DT = 1 / 30, SPS = 30, IN = 6;          // вход: [x, y, деление (счётчик), выброс (счётчик), эмодзи (счётчик), номер эмодзи]
  const H = 2000;                                // половина стороны арены (4000×4000)
  const ZONE = 200, ZN = 20, KS = 4, NP = ZN * ZN * KS;   // еда: 1600 точек, по 4 в квадрате 200×200
  const GC = 125, GN = 32;                       // сетка столкновений 32×32
  const MAXO = 16, MAXC = 16, CCAP = MAXO * MAXC, VCAP = 24, BCAP = 192;
  const START_M = 10, SPLIT_MIN = 24, EJECT_MIN = 32, EJECT_COST = 14, BLOB_M = 11, PELLET_M = 1, MAX_CM = 12000;
  const VIRUS_M = 100, VIRUS_POP = 133, VIRUS_FEEDS = 7, VIR_MIN = 8;
  const PROT = 3 * SPS, ROUND = 300 * SPS, END = 8 * SPS, MERCY = 20 * SPS;
  const TOTAL = 12, MINB = 2;
  const A0 = 600000;                             // площадь видимого мира у новой клетки — одинаковая на телефоне и ПК

  const radius = m => 4.5 * Math.sqrt(m) + 4;
  const speedOf = r => 600 * Math.pow(r, -0.4);
  const mergeSteps = m => Math.round(clamp(10 + .012 * m, 10, 35) * SPS);
  const viewScale = rt => clamp(Math.pow(rt / 18, .42), 1, 3.6);
  const viewArea = rt => { const s = viewScale(rt); return A0 * s * s; };
  const reach = o => 280 + o.rt * 1.6;

  // ═══ Части клетки (данные; для «Вселенной») ═══
  // speed — множитель скорости, eat — во сколько раз надо быть больше, чтобы съесть, view — обзор, split — можно делиться,
  // diet — что ест (1 — точки, 2 — клетки, 3 — всё), spikes — колючки не разрывают. Свойства частей умножаются / складываются.
  const PARTS = {
    base: { name: 'Мембрана', speed: 1, eat: 1.25, view: 1, split: 1, diet: 3, spikes: 0 },
    flagellum: { name: 'Жгутик', speed: 1.12, view: 1 },
    spikes: { name: 'Шипы', speed: .94, spikes: 1 },
    eye: { name: 'Глазок', view: 1.2 },
    jaw: { name: 'Хищный рот', eat: 1.18 / 1.25, diet: 2 },
    leaf: { name: 'Хлоропласт', speed: .9, diet: 1 },
  };
  function bodyStats(parts){
    const st = { speed: 1, eat: 1.25, view: 1, split: 1, diet: 3, spikes: 0 };
    for (const id of parts || []) {
      const p = PARTS[id];
      if (!p || id === 'base') continue;
      if (p.speed) st.speed *= p.speed;
      if (p.view) st.view *= p.view;
      if (p.eat) st.eat *= p.eat;
      if (p.diet) st.diet = p.diet;
      if (p.spikes) st.spikes = 1;
      if (p.split === 0) st.split = 0;
    }
    return st;
  }

  // ═══ Раскраски (бесплатно): узор + 2 цвета ═══
  const PATTERNS = ['Однотонная', 'Ядро', 'Горошек', 'Половинки', 'Звезда', 'Глазки', 'Радуга', 'Мишень'];
  const PRESETS = [[5, '#4ade80', '#166534'], [1, '#60a5fa', '#1e3a8a'], [2, '#f472b6', '#ffffff'], [3, '#facc15', '#f97316'], [4, '#a78bfa', '#fde68a'],
    [7, '#f87171', '#ffffff'], [0, '#22d3ee', '#0e7490'], [6, '#ffffff', '#ffffff'], [5, '#fb923c', '#7c2d12'], [2, '#34d399', '#064e3b'], [1, '#e879f9', '#581c87'], [3, '#38bdf8', '#f472b6']];
  function skinOk(s){
    if (!s || typeof s !== 'object') return null;
    const p = clamp(s.p | 0, 0, PATTERNS.length - 1), a = K.okColor(s.a), b = K.okColor(s.b);
    return a && b ? { p, a, b } : null;
  }
  const presetSkin = i => { const q = PRESETS[((i % PRESETS.length) + PRESETS.length) % PRESETS.length]; return { p: q[0], a: q[1], b: q[2] }; };
  const BOT_NAMES = ['Пушистик', 'Колобок', 'Пельмень', 'Зефирка', 'Бублик', 'Капелька', 'Пузырь', 'Ватрушка', 'Мармелад', 'Кексик', 'Ириска', 'Сырник',
    'Пончик', 'Карамелька', 'Клубничка', 'Лимончик', 'Шарик', 'Желешка', 'Пирожок', 'Облачко', 'Горошек', 'Чупик', 'Арбузик', 'Медузка'];

  // ═══════════════════ МИР ═══════════════════
  function newWorld(seed){
    seed = (seed | 0) || 1;
    const W = { v: 1, seed, rs: seed, step: 0, round: 1, phase: 0, left: ROUND, humans: 1, botWant: TOTAL - 1, ev: [], ver: 0, nextId: 1,
      owners: new Array(MAXO).fill(null), oc: new Int16Array(MAXO), maxR: 0,
      // клетки
      cN: 0, cL: new Int16Array(CCAP), cF: new Int16Array(CCAP), cFN: 0,
      cId: new Uint16Array(CCAP), cO: new Int8Array(CCAP), cX: new Float64Array(CCAP), cY: new Float64Array(CCAP), cPX: new Float64Array(CCAP), cPY: new Float64Array(CCAP),
      cVX: new Float64Array(CCAP), cVY: new Float64Array(CCAP), cBX: new Float64Array(CCAP), cBY: new Float64Array(CCAP), cM: new Float64Array(CCAP),
      cMg: new Int32Array(CCAP), cProt: new Int32Array(CCAP), cDead: new Uint8Array(CCAP),
      // колючки
      vN: 0, vL: new Int16Array(VCAP), vF: new Int16Array(VCAP), vFN: 0,
      vId: new Uint16Array(VCAP), vX: new Float64Array(VCAP), vY: new Float64Array(VCAP), vPX: new Float64Array(VCAP), vPY: new Float64Array(VCAP),
      vVX: new Float64Array(VCAP), vVY: new Float64Array(VCAP), vM: new Float64Array(VCAP), vFeed: new Int8Array(VCAP), vDX: new Float64Array(VCAP), vDY: new Float64Array(VCAP), vDead: new Uint8Array(VCAP),
      // выбросы
      bN: 0, bL: new Int16Array(BCAP), bF: new Int16Array(BCAP), bFN: 0,
      bId: new Uint16Array(BCAP), bO: new Int8Array(BCAP), bX: new Float64Array(BCAP), bY: new Float64Array(BCAP), bPX: new Float64Array(BCAP), bPY: new Float64Array(BCAP),
      bVX: new Float64Array(BCAP), bVY: new Float64Array(BCAP), bBorn: new Int32Array(BCAP), bDead: new Uint8Array(BCAP),
      // еда: жива, поколение (место = хеш зерна, номера и поколения), когда вернуть
      pSeed: 0, pAl: new Uint8Array(NP), pGen: new Uint8Array(NP), pAt: new Int32Array(NP), pX: new Float32Array(NP), pY: new Float32Array(NP), zv: new Uint16Array(ZN * ZN),
      // сетка и лидеры
      gH: new Int16Array(GN * GN), gN: new Int16Array(CCAP), lbO: new Int8Array(10), lbS: new Float64Array(10), lbN: 0, lbMark: new Uint8Array(MAXO) };
    for (let i = 0; i < CCAP; i++) W.cF[W.cFN++] = CCAP - 1 - i;
    for (let i = 0; i < VCAP; i++) W.vF[W.vFN++] = VCAP - 1 - i;
    for (let i = 0; i < BCAP; i++) W.bF[W.bFN++] = BCAP - 1 - i;
    W.pSeed = (rnd(W) * 2147483647) | 0;
    for (let p = 0; p < NP; p++) { W.pAl[p] = 1; W.pGen[p] = 0; pelletXY(W.pSeed, p, 0, W.pX, W.pY, p); }
    for (let i = 0; i < VIR_MIN; i++) placeVirus(W);
    return W;
  }
  // Место точки еды: квадрат зоны + хеш (одинаково у хозяина и гостя)
  function pelletXY(pseed, p, gen, ax, ay, at){
    const z = (p / KS) | 0, zx = z % ZN, zy = (z / ZN) | 0;
    ax[at] = zx * ZONE - H + (.08 + .84 * hash3(pseed, p, gen * 2)) * ZONE;
    ay[at] = zy * ZONE - H + (.08 + .84 * hash3(pseed, p, gen * 2 + 1)) * ZONE;
  }
  function nextId(W){ const id = W.nextId; W.nextId = id >= 65535 ? 1 : id + 1; return id; }
  function cNew(W, o, x, y, m){
    if (!W.cFN) return -1;
    const s = W.cF[--W.cFN];
    W.cL[W.cN++] = s;
    W.cId[s] = nextId(W); W.cO[s] = o; W.cX[s] = W.cPX[s] = x; W.cY[s] = W.cPY[s] = y;
    W.cVX[s] = W.cVY[s] = W.cBX[s] = W.cBY[s] = 0; W.cM[s] = m; W.cMg[s] = 0; W.cProt[s] = 0; W.cDead[s] = 0;
    W.oc[o]++;
    return s;
  }
  function cKill(W, s){ if (!W.cDead[s]) { W.cDead[s] = 1; W.oc[W.cO[s]]--; } }
  function vNew(W, x, y, m){
    if (!W.vFN) return -1;
    const s = W.vF[--W.vFN];
    W.vL[W.vN++] = s;
    W.vId[s] = nextId(W); W.vX[s] = W.vPX[s] = x; W.vY[s] = W.vPY[s] = y; W.vVX[s] = W.vVY[s] = 0; W.vM[s] = m; W.vFeed[s] = 0; W.vDX[s] = 1; W.vDY[s] = 0; W.vDead[s] = 0;
    return s;
  }
  function bNew(W, o, x, y, vx, vy){
    if (!W.bFN) return -1;
    const s = W.bF[--W.bFN];
    W.bL[W.bN++] = s;
    W.bId[s] = nextId(W); W.bO[s] = o; W.bX[s] = W.bPX[s] = x; W.bY[s] = W.bPY[s] = y; W.bVX[s] = vx; W.bVY[s] = vy; W.bBorn[s] = W.step; W.bDead[s] = 0;
    return s;
  }
  function compact(W){
    for (let k = 0; k < W.cN;) { const s = W.cL[k]; if (W.cDead[s]) { W.cF[W.cFN++] = s; W.cL[k] = W.cL[--W.cN]; } else k++; }
    for (let k = 0; k < W.vN;) { const s = W.vL[k]; if (W.vDead[s]) { W.vF[W.vFN++] = s; W.vL[k] = W.vL[--W.vN]; } else k++; }
    for (let k = 0; k < W.bN;) { const s = W.bL[k]; if (W.bDead[s]) { W.bF[W.bFN++] = s; W.bL[k] = W.bL[--W.bN]; } else k++; }
  }
  // Колючка — подальше от клеток (не прямо под игроком)
  function placeVirus(W){
    for (let t = 0; t < 8; t++) {
      const x = (rnd(W) * 2 - 1) * (H - 250), y = (rnd(W) * 2 - 1) * (H - 250);
      let ok = true;
      for (let k = 0; k < W.cN && ok; k++) { const s = W.cL[k], dx = W.cX[s] - x, dy = W.cY[s] - y, r = radius(W.cM[s]) + 120; if (dx * dx + dy * dy < r * r) ok = false; }
      for (let k = 0; k < W.vN && ok; k++) { const s = W.vL[k], dx = W.vX[s] - x, dy = W.vY[s] - y; if (dx * dx + dy * dy < 260 * 260) ok = false; }
      if (ok || t === 7) return vNew(W, x, y, VIRUS_M);
    }
    return -1;
  }

  // ── Участники ──
  function newOwner(W, i, o){
    const bot = !!o.bot;
    return { i, key: String(o.key || '').slice(0, 80), name: String(o.name || 'Игрок').slice(0, 24), skin: skinOk(o.skin) || presetSkin(((rnd(W) * 1000) | 0)), bot,
      parts: ['base'], st: bodyStats(['base']),
      alive: false, wantSpawn: !!o.spawn, spawnAt: 0, retire: 0, born: W.step,
      inX: 0, inY: 0, inS: 0, inE: 0, inEm: 0, inEmId: 0, ls: -1, le: -1, lem: -1, gotIn: bot,
      emote: 0, emoteUntil: 0, emoteAt: -1e6,
      mass: 0, cx: 0, cy: 0, rt: 0, nC: 0, maxM: 0, minM: 0, maxR: 0,
      best: 0, eaten: 0, life: 0, lastBy: -1, deadX: 0, deadY: 0,
      brain: bot ? { aggr: .15 + rnd(W) * .7, caut: .7 + rnd(W) * .6, every: 3 + ((rnd(W) * 3) | 0), wx: 1, wy: 0, wt: 0, splitCd: 0 } : null };
  }
  function addOwner(W, o){
    let i = -1;
    for (let k = 0; k < MAXO; k++) if (!W.owners[k]) { i = k; break; }
    if (i < 0 && !o.bot) {   // мест нет — человеку уступает бот (сначала уходящий, потом самый маленький)
      let v = -1, vm = 1e18;
      for (let k = 0; k < MAXO; k++) { const q = W.owners[k]; if (!q || !q.bot) continue; const m = q.retire ? -1 : q.alive ? q.mass : 0; if (m < vm) { vm = m; v = k; } }
      if (v >= 0) { dropOwner(W, v); i = v; }
    }
    if (i < 0) return -1;
    W.owners[i] = newOwner(W, i, o);
    W.oc[i] = 0;
    W.ver++;
    return i;
  }
  function dropOwner(W, i){
    const o = W.owners[i];
    if (!o) return;
    for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; if (W.cO[s] === i) cKill(W, s); }
    for (let k = 0; k < W.bN; k++) { const s = W.bL[k]; if (W.bO[s] === i) W.bDead[s] = 1; }
    compact(W);
    W.owners[i] = null; W.oc[i] = 0;
    W.ver++;
  }
  function setOwner(W, i, o){
    const ow = W.owners[i];
    if (!ow) return;
    if (o.name) ow.name = String(o.name).slice(0, 24);
    const sk = skinOk(o.skin);
    if (sk) ow.skin = sk;
    W.ver++;
  }
  function setInput(W, i, a){
    const o = W.owners[i];
    if (!o || !a) return;
    let x = +a[0] || 0, y = +a[1] || 0;
    const m = Math.sqrt(x * x + y * y);
    if (m > 1) { x /= m; y /= m; }
    o.inX = x; o.inY = y; o.inS = +a[2] || 0; o.inE = +a[3] || 0; o.inEm = +a[4] || 0; o.inEmId = a[5] | 0; o.gotIn = true;
  }
  function respawn(W, i){ const o = W.owners[i]; if (o && !o.alive && W.phase === 0) { o.wantSpawn = true; o.spawnAt = W.step; } }
  function setHumans(W, n){
    W.humans = clamp(n | 0, 0, MAXO);
    W.botWant = clamp(TOTAL - W.humans, MINB, MAXO - W.humans);
    let bots = 0;
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.bot && !o.retire) bots++; }
    // в начале игры — сразу все боты (появляются в первую секунду по очереди)
    while (bots < W.botWant) {
      const k = addOwner(W, { key: 'bot', name: botName(W), skin: null, bot: true, spawn: true });
      if (k < 0) break;
      W.owners[k].spawnAt = W.step + bots * 3;
      bots++;
    }
  }
  function botName(W){
    for (let t = 0; t < 12; t++) {
      const n = BOT_NAMES[(rnd(W) * BOT_NAMES.length) | 0];
      let used = false;
      for (let i = 0; i < MAXO; i++) if (W.owners[i] && W.owners[i].name === n) used = true;
      if (!used) return n;
    }
    return BOT_NAMES[(rnd(W) * BOT_NAMES.length) | 0] + ' ' + (2 + ((rnd(W) * 8) | 0));
  }
  // Боты под число людей: лишний уходит, когда его съедят (или через 20 с); понадобился снова — уходящий остаётся
  function manageBots(W){
    let bots = 0, small = -1, sm = 1e18, back = -1;
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.bot) continue;
      if (o.retire) {
        if (!o.alive || W.step - o.retire > 20 * SPS) dropOwner(W, i);
        else if (back < 0) back = i;
        continue;
      }
      bots++;
      const m = o.alive ? o.mass : 0;
      if (m < sm) { sm = m; small = i; }
    }
    if (bots < W.botWant) { if (back >= 0) W.owners[back].retire = 0; else addOwner(W, { key: 'bot', name: botName(W), skin: null, bot: true, spawn: true }); }
    else if (bots > W.botWant && small >= 0) W.owners[small].retire = W.step;
  }

  // ── Появиться: лучшее из 10 мест — подальше от больших клеток и колючек ──
  function spawnOwner(W, o){
    let bx = 0, by = 0, best = -1e9;
    for (let t = 0; t < 10; t++) {
      const x = (rnd(W) * 2 - 1) * (H - 220), y = (rnd(W) * 2 - 1) * (H - 220);
      let dmin = 1e9;
      for (let k = 0; k < W.cN; k++) {
        const s = W.cL[k];
        if (W.cDead[s] || W.cM[s] < START_M * 1.6) continue;
        const dx = W.cX[s] - x, dy = W.cY[s] - y, d = Math.sqrt(dx * dx + dy * dy) - radius(W.cM[s]) * 1.5;
        if (d < dmin) dmin = d;
      }
      for (let k = 0; k < W.vN; k++) { const s = W.vL[k], dx = W.vX[s] - x, dy = W.vY[s] - y, d = Math.sqrt(dx * dx + dy * dy) - 90; if (d < dmin) dmin = d; }
      if (dmin > best) { best = dmin; bx = x; by = y; }
    }
    const s = cNew(W, o.i, bx, by, START_M);
    if (s < 0) return false;
    W.cProt[s] = W.step + PROT;
    o.alive = true; o.wantSpawn = false; o.best = START_M; o.eaten = 0; o.life = W.step; o.lastBy = -1;
    o.cx = bx; o.cy = by; o.mass = START_M; o.rt = radius(START_M); o.nC = 1; o.maxM = o.minM = START_M; o.maxR = o.rt;
    return true;
  }

  // ═══ ШАГ МИРА ═══
  function step(W){
    W.step++;
    if (W.phase === 1) { if (--W.left <= 0) startRound(W); return; }
    for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; W.cPX[s] = W.cX[s]; W.cPY[s] = W.cY[s]; }
    for (let k = 0; k < W.vN; k++) { const s = W.vL[k]; W.vPX[s] = W.vX[s]; W.vPY[s] = W.vY[s]; }
    for (let k = 0; k < W.bN; k++) { const s = W.bL[k]; W.bPX[s] = W.bX[s]; W.bPY[s] = W.bY[s]; }
    if (W.step % SPS === 0) manageBots(W);
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (o && !o.alive && o.wantSpawn && !o.retire && W.step >= o.spawnAt) spawnOwner(W, o);
    }
    centers(W);
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.bot && o.alive && (W.step + i) % o.brain.every === 0) think(W, o); }
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o) actions(W, o); }
    moveCells(W);
    moveVirBlobs(W);
    buildGrid(W);
    separate(W);
    eatPellets(W);
    blobs(W);
    viruses(W);
    eatCells(W);
    compact(W);
    if (W.step % 15 === 0) decay(W);
    for (let p = 0; p < NP; p++) if (!W.pAl[p] && W.pAt[p] <= W.step) { W.pAl[p] = 1; pelletXY(W.pSeed, p, W.pGen[p], W.pX, W.pY, p); W.zv[(p / KS) | 0]++; }
    if (W.vN < VIR_MIN && W.step % 90 === 0) placeVirus(W);
    centers(W);
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.alive || W.oc[i] > 0) continue;
      o.alive = false; o.deadX = o.cx; o.deadY = o.cy;
      W.ev.push({ k: 'ko', o: i, by: o.lastBy, best: Math.round(o.best), eaten: o.eaten, life: Math.round((W.step - o.life) / SPS), round: W.round });
      if (o.bot) { o.wantSpawn = true; o.spawnAt = W.step + 45 + ((rnd(W) * 90) | 0); } else o.wantSpawn = false;
    }
    if (W.step % 15 === 0) leaderboard(W);
    if (--W.left <= 0) endRound(W);
  }
  // Центр, масса и размеры каждого участника
  function centers(W){
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o) { o.mass = 0; o.cx = 0; o.cy = 0; o.nC = 0; o.maxM = 0; o.minM = 1e18; o.maxR = 0; } }
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k];
      if (W.cDead[s]) continue;
      const o = W.owners[W.cO[s]];
      if (!o) continue;
      const m = W.cM[s];
      o.mass += m; o.cx += W.cX[s] * m; o.cy += W.cY[s] * m; o.nC++;
      if (m > o.maxM) o.maxM = m;
      if (m < o.minM) o.minM = m;
    }
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o) continue;
      if (o.nC) { o.cx /= o.mass; o.cy /= o.mass; o.rt = radius(o.mass); o.maxR = radius(o.maxM); if (o.alive && o.mass > o.best) o.best = o.mass; }
      else { o.cx = o.deadX; o.cy = o.deadY; o.minM = 0; o.rt = 0; }
    }
  }
  function actions(W, o){
    if (!o.gotIn) return;
    if (o.ls < 0 || o.le < 0 || o.lem < 0) { o.ls = o.inS; o.le = o.inE; o.lem = o.inEm; return; }   // первое управление — точка отсчёта
    let ds = o.inS - o.ls, de = o.inE - o.le;
    o.ls = o.inS; o.le = o.inE;
    if (!(ds > 0 && ds < 1000)) ds = 0; else if (ds > 3) ds = 3;
    if (!(de > 0 && de < 1000)) de = 0; else if (de > 3) de = 3;
    if (o.inEm !== o.lem) {
      o.lem = o.inEm;
      if (o.inEmId >= 1 && o.inEmId <= K.EMOTES.length && W.step - o.emoteAt >= 45) { o.emote = o.inEmId; o.emoteUntil = W.step + 75; o.emoteAt = W.step; }
    }
    if (!o.alive) return;
    for (let k = 0; k < ds; k++) split(W, o);
    for (let k = 0; k < de; k++) eject(W, o);
  }
  function aimOf(W, o, s, out){
    const R = reach(o), tx = o.cx + o.inX * R, ty = o.cy + o.inY * R;
    let dx = tx - W.cX[s], dy = ty - W.cY[s], d = Math.sqrt(dx * dx + dy * dy);
    if (d < 2) { dx = o.inX; dy = o.inY; d = Math.sqrt(dx * dx + dy * dy); if (d < .01) { dx = 1; dy = 0; d = 1; } }
    out[0] = dx / d; out[1] = dy / d;
  }
  const AIM = new Float64Array(2);
  function split(W, o){
    if (!o.st.split) return;
    const n0 = W.cN;
    for (let k = 0; k < n0; k++) {
      const s = W.cL[k];
      if (W.cO[s] !== o.i || W.cDead[s] || W.cM[s] < SPLIT_MIN) continue;
      if (W.oc[o.i] >= MAXC) break;
      aimOf(W, o, s, AIM);
      const m0 = W.cM[s], m = m0 / 2, r = radius(m);
      const t = cNew(W, o.i, W.cX[s] + AIM[0] * r * .6, W.cY[s] + AIM[1] * r * .6, m);
      if (t < 0) break;
      W.cM[s] = m;
      const v0 = 520 + 7 * r;
      W.cBX[t] = AIM[0] * v0; W.cBY[t] = AIM[1] * v0; W.cVX[t] = W.cVX[s]; W.cVY[t] = W.cVY[s];
      const mg = W.step + mergeSteps(m0);
      if (W.cMg[s] < mg) W.cMg[s] = mg;
      W.cMg[t] = mg; W.cProt[t] = W.cProt[s];
    }
  }
  function eject(W, o){
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k];
      if (W.cO[s] !== o.i || W.cDead[s] || W.cM[s] < EJECT_MIN) continue;
      aimOf(W, o, s, AIM);
      const r = radius(W.cM[s]);
      if (bNew(W, o.i, W.cX[s] + AIM[0] * (r + 14), W.cY[s] + AIM[1] * (r + 14), AIM[0] * 680, AIM[1] * 680) >= 0) W.cM[s] -= EJECT_COST;
    }
  }
  function moveCells(W){
    const ACC = .3, BK = Math.exp(-4.5 * DT);
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k], o = W.owners[W.cO[s]];
      const r = radius(W.cM[s]);
      let wx = 0, wy = 0;
      if (o) {
        const im = Math.sqrt(o.inX * o.inX + o.inY * o.inY);
        if (im > .02) {
          const R = reach(o), dx = o.cx + o.inX * R - W.cX[s], dy = o.cy + o.inY * R - W.cY[s], d = Math.sqrt(dx * dx + dy * dy);
          if (d > .5) {
            const sp = speedOf(r) * o.st.speed * Math.min(1, im * 1.4) * Math.min(1, d / (r * .5 + 25));
            wx = dx / d * sp; wy = dy / d * sp;
          }
        }
      }
      W.cVX[s] += (wx - W.cVX[s]) * ACC; W.cVY[s] += (wy - W.cVY[s]) * ACC;
      W.cX[s] += (W.cVX[s] + W.cBX[s]) * DT; W.cY[s] += (W.cVY[s] + W.cBY[s]) * DT;
      W.cBX[s] *= BK; W.cBY[s] *= BK;
      if (W.cBX[s] * W.cBX[s] + W.cBY[s] * W.cBY[s] < 4) { W.cBX[s] = 0; W.cBY[s] = 0; }
      edge(W.cX, W.cVX, W.cBX, s, H - r * .35);
      edge(W.cY, W.cVY, W.cBY, s, H - r * .35);
    }
  }
  // Мягкий край: центр можно увести к краю, пока клетка видна наполовину, дальше — пружина назад
  function edge(X, V, B, s, lim){
    if (X[s] > lim) { X[s] -= (X[s] - lim) * .5; if (V[s] > 0) V[s] *= .5; if (B[s] > 0) B[s] *= -.3; }
    else if (X[s] < -lim) { X[s] -= (X[s] + lim) * .5; if (V[s] < 0) V[s] *= .5; if (B[s] < 0) B[s] *= -.3; }
  }
  function moveVirBlobs(W){
    const VK = Math.exp(-3 * DT), BK = Math.exp(-6 * DT);
    for (let k = 0; k < W.vN; k++) {
      const s = W.vL[k];
      if (!W.vVX[s] && !W.vVY[s]) continue;
      W.vX[s] += W.vVX[s] * DT; W.vY[s] += W.vVY[s] * DT; W.vVX[s] *= VK; W.vVY[s] *= VK;
      if (W.vVX[s] * W.vVX[s] + W.vVY[s] * W.vVY[s] < 9) { W.vVX[s] = 0; W.vVY[s] = 0; }
      const lim = H - 60;
      if (W.vX[s] > lim || W.vX[s] < -lim) { W.vX[s] = clamp(W.vX[s], -lim, lim); W.vVX[s] = -W.vVX[s] * .5; }
      if (W.vY[s] > lim || W.vY[s] < -lim) { W.vY[s] = clamp(W.vY[s], -lim, lim); W.vVY[s] = -W.vVY[s] * .5; }
    }
    for (let k = 0; k < W.bN; k++) {
      const s = W.bL[k];
      W.bX[s] += W.bVX[s] * DT; W.bY[s] += W.bVY[s] * DT; W.bVX[s] *= BK; W.bVY[s] *= BK;
      if (W.bVX[s] * W.bVX[s] + W.bVY[s] * W.bVY[s] < 4) { W.bVX[s] = 0; W.bVY[s] = 0; }
      const lim = H - 12;
      if (W.bX[s] > lim || W.bX[s] < -lim) { W.bX[s] = clamp(W.bX[s], -lim, lim); W.bVX[s] = -W.bVX[s] * .4; }
      if (W.bY[s] > lim || W.bY[s] < -lim) { W.bY[s] = clamp(W.bY[s], -lim, lim); W.bVY[s] = -W.bVY[s] * .4; }
    }
  }
  function buildGrid(W){
    W.gH.fill(-1);
    let maxR = 0;
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k];
      let gx = Math.floor((W.cX[s] + H) / GC), gy = Math.floor((W.cY[s] + H) / GC);
      if (gx < 0) gx = 0; else if (gx >= GN) gx = GN - 1;
      if (gy < 0) gy = 0; else if (gy >= GN) gy = GN - 1;
      const b = gy * GN + gx;
      W.gN[s] = W.gH[b]; W.gH[b] = s;
      const r = radius(W.cM[s]);
      if (r > maxR) maxR = r;
    }
    W.maxR = maxR;
  }
  // Диапазон клеток сетки вокруг (x, y) радиусом R → GR[0..3]
  const GR = new Int32Array(4);
  function gRange(x, y, R){
    let x0 = Math.floor((x - R + H) / GC), x1 = Math.floor((x + R + H) / GC), y0 = Math.floor((y - R + H) / GC), y1 = Math.floor((y + R + H) / GC);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= GN) x1 = GN - 1; if (y1 >= GN) y1 = GN - 1;
    GR[0] = x0; GR[1] = x1; GR[2] = y0; GR[3] = y1;
  }
  // Свои клетки, пока не пришло время слиться, расталкиваются
  function separate(W){
    for (let k = 0; k < W.cN; k++) {
      const a = W.cL[k], oa = W.cO[a], ra = radius(W.cM[a]);
      if (W.oc[oa] < 2) continue;
      gRange(W.cX[a], W.cY[a], ra + W.maxR);
      const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) for (let b = W.gH[gy * GN + gx]; b !== -1; b = W.gN[b]) {
        if (b <= a || W.cO[b] !== oa) continue;
        if (W.step >= W.cMg[a] && W.step >= W.cMg[b]) continue;
        const rb = radius(W.cM[b]);
        let dx = W.cX[b] - W.cX[a], dy = W.cY[b] - W.cY[a], d = Math.sqrt(dx * dx + dy * dy);
        const ov = ra + rb - d;
        if (ov <= 0) continue;
        if (d < .01) { dx = 1; dy = 0; d = 1; }
        const ma = W.cM[a], mb = W.cM[b], nx = dx / d, ny = dy / d, ka = ov * mb / (ma + mb) * .5, kb = ov * ma / (ma + mb) * .5;
        W.cX[a] -= nx * ka; W.cY[a] -= ny * ka; W.cX[b] += nx * kb; W.cY[b] += ny * kb;
      }
    }
  }
  function eatPellets(W){
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k], o = W.owners[W.cO[s]];
      if (o && !(o.st.diet & 1)) continue;
      const x = W.cX[s], y = W.cY[s];
      let r = radius(W.cM[s]);
      let zx0 = Math.floor((x - r + H) / ZONE), zx1 = Math.floor((x + r + H) / ZONE), zy0 = Math.floor((y - r + H) / ZONE), zy1 = Math.floor((y + r + H) / ZONE);
      if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
      for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
        const base = (zy * ZN + zx) * KS;
        for (let j = 0; j < KS; j++) {
          const p = base + j;
          if (!W.pAl[p]) continue;
          const dx = W.pX[p] - x, dy = W.pY[p] - y;
          if (dx * dx + dy * dy >= (r + 2) * (r + 2)) continue;
          W.pAl[p] = 0; W.pGen[p] = (W.pGen[p] + 1) & 7; W.pAt[p] = W.step + 90 + ((rnd(W) * 150) | 0); W.zv[(p / KS) | 0]++;
          W.cM[s] += PELLET_M; r = radius(W.cM[s]);
        }
      }
    }
  }
  // Выбросы: кормят колючки (7 раз — колючка «стреляет» новой), их едят клетки побольше (свои — через 0,5 с)
  function blobs(W){
    const br = radius(BLOB_M) * .7;
    for (let k = 0; k < W.bN; k++) {
      const b = W.bL[k];
      if (W.bDead[b]) continue;
      const x = W.bX[b], y = W.bY[b];
      for (let j = 0; j < W.vN; j++) {
        const v = W.vL[j];
        if (W.vDead[v]) continue;
        const dx = W.vX[v] - x, dy = W.vY[v] - y, rr = radius(W.vM[v]) + br * .5;
        if (dx * dx + dy * dy >= rr * rr) continue;
        W.bDead[b] = 1;
        W.vM[v] += BLOB_M;
        const vl = Math.sqrt(W.bVX[b] * W.bVX[b] + W.bVY[b] * W.bVY[b]);
        if (vl > 1) { W.vDX[v] = W.bVX[b] / vl; W.vDY[v] = W.bVY[b] / vl; }
        if (++W.vFeed[v] >= VIRUS_FEEDS) {
          W.vFeed[v] = 0; W.vM[v] = VIRUS_M;
          if (W.vN < VCAP) { const r = radius(VIRUS_M); const t = vNew(W, W.vX[v] + W.vDX[v] * r * 2, W.vY[v] + W.vDY[v] * r * 2, VIRUS_M); if (t >= 0) { W.vVX[t] = W.vDX[v] * 700; W.vVY[t] = W.vDY[v] * 700; } }
        }
        break;
      }
      if (W.bDead[b]) continue;
      gRange(x, y, W.maxR + br);
      const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
      for (let gy = y0; gy <= y1 && !W.bDead[b]; gy++) for (let gx = x0; gx <= x1 && !W.bDead[b]; gx++) for (let s = W.gH[gy * GN + gx]; s !== -1; s = W.gN[s]) {
        if (W.cDead[s] || W.cM[s] < BLOB_M * 1.15) continue;
        if (W.cO[s] === W.bO[b] && W.step - W.bBorn[b] < 15) continue;
        const r = radius(W.cM[s]) - 4, dx = W.cX[s] - x, dy = W.cY[s] - y;
        if (r <= 0 || dx * dx + dy * dy >= r * r) continue;
        W.cM[s] += BLOB_M; W.bDead[b] = 1;
        break;
      }
    }
  }
  // Колючки: клетка с массой ≥ 133, накрывшая колючку, лопается на куски (сама — половина массы, остальное — кусками в стороны)
  function viruses(W){
    for (let j = 0; j < W.vN; j++) {
      const v = W.vL[j];
      if (W.vDead[v]) continue;
      const vx = W.vX[v], vy = W.vY[v], vr = radius(W.vM[v]);
      gRange(vx, vy, W.maxR);
      const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
      let hit = -1;
      for (let gy = y0; gy <= y1 && hit < 0; gy++) for (let gx = x0; gx <= x1 && hit < 0; gx++) for (let s = W.gH[gy * GN + gx]; s !== -1; s = W.gN[s]) {
        if (W.cDead[s] || W.cM[s] < VIRUS_POP) continue;
        const o = W.owners[W.cO[s]];
        if (o && o.st.spikes) continue;
        const rc = radius(W.cM[s]), lim = rc - vr * .35, dx = W.cX[s] - vx, dy = W.cY[s] - vy;
        if (lim > 0 && dx * dx + dy * dy < lim * lim) { hit = s; break; }
      }
      if (hit >= 0) pop(W, hit, v);
    }
  }
  function pop(W, s, v){
    const oi = W.cO[s];
    W.cM[s] += W.vM[v] * .5;
    W.vDead[v] = 1;
    const free = MAXC - W.oc[oi];
    const m = W.cM[s];
    W.cMg[s] = W.step + mergeSteps(m);
    if (free <= 0) return;
    let n = Math.min(free, 12, Math.floor(m / 40));
    if (n < 1) return;
    const pm = Math.max(12, m * .5 / n);
    n = Math.min(n, Math.floor(m * .5 / pm));
    if (n < 1) return;
    W.cM[s] = m - pm * n;
    const r0 = radius(W.cM[s]), a0 = rnd(W) * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * TAU, c = Math.cos(a), sn = Math.sin(a);
      const t = cNew(W, oi, W.cX[s] + c * r0 * .4, W.cY[s] + sn * r0 * .4, pm);
      if (t < 0) { W.cM[s] += pm; continue; }
      const v0 = 420 + 4 * radius(pm);
      W.cBX[t] = c * v0; W.cBY[t] = sn * v0; W.cMg[t] = W.cMg[s]; W.cProt[t] = W.cProt[s];
    }
  }
  // Клетка ест клетку: больше в st.eat раз (1,25) и почти накрыла (центр ближе r − 0,35 r маленькой). Свои — сливаются, когда пора
  function eatCells(W){
    for (let k = 0; k < W.cN; k++) {
      const a = W.cL[k];
      if (W.cDead[a]) continue;
      const oa = W.cO[a], owA = W.owners[oa], er = owA ? owA.st.eat : 1.25, carn = owA ? !!(owA.st.diet & 2) : true;
      let ma = W.cM[a], ra = radius(ma);
      gRange(W.cX[a], W.cY[a], ra);
      const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) for (let b = W.gH[gy * GN + gx]; b !== -1; b = W.gN[b]) {
        if (b === a || W.cDead[b]) continue;
        const mb = W.cM[b];
        if (mb > ma) continue;
        const rb = radius(mb), lim = ra - rb * .35;
        if (lim <= 0) continue;
        const dx = W.cX[b] - W.cX[a], dy = W.cY[b] - W.cY[a];
        if (dx * dx + dy * dy >= lim * lim) continue;
        const ob = W.cO[b];
        if (ob === oa) { if (W.step < W.cMg[a] || W.step < W.cMg[b]) continue; }
        else {
          if (!carn || ma < mb * er || W.cProt[b] > W.step) continue;
          const owB = W.owners[ob];
          if (owA && owA.bot && owB && !owB.bot && W.step - owB.life < MERCY) continue;   // бот новичка не ест (первые 20 с)
          if (owB) { owB.lastBy = oa; if (W.oc[ob] === 1 && owA) owA.eaten++; }
        }
        W.cM[a] = ma = ma + mb; ra = radius(ma);
        cKill(W, b);
      }
    }
  }
  // Большие медленно худеют (иначе один вырастет на всю арену); боты — сильнее после 1500
  function decay(W){
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k];
      const m = W.cM[s];
      if (m <= 300) continue;
      const o = W.owners[W.cO[s]];
      let rate = .0018;
      if (o && o.bot && o.mass > 1000) rate += .005;
      W.cM[s] = Math.min(MAX_CM, m * (1 - rate * .5));
    }
  }
  function leaderboard(W){
    W.lbN = 0; W.lbMark.fill(0);
    for (let k = 0; k < 10; k++) {
      let bi = -1, bm = 0;
      for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (!o || !o.alive || W.lbMark[i]) continue; if (o.mass > bm) { bm = o.mass; bi = i; } }
      if (bi < 0) break;
      W.lbMark[bi] = 1; W.lbO[k] = bi; W.lbS[k] = bm; W.lbN++;
    }
  }
  function endRound(W){
    leaderboard(W);
    W.phase = 1; W.left = END;
    const rank = [];
    for (let k = 0; k < W.lbN; k++) rank.push([W.lbO[k], Math.round(W.lbS[k])]);
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.alive && !rank.some(r => r[0] === i)) rank.push([i, Math.round(o.mass)]); }
    rank.sort((a, b) => b[1] - a[1]);
    let n = 0; for (let i = 0; i < MAXO; i++) if (W.owners[i]) n++;
    const best = rank.map(r => { const o = W.owners[r[0]]; return [r[0], r[1], o ? Math.round(o.best) : r[1], o ? Math.round((W.step - o.life) / SPS) : 0]; });
    W.ev.push({ k: 'end', n: W.round, rank: best, total: n, names: best.slice(0, 3).map(r => [W.owners[r[0]]?.name || '', W.owners[r[0]]?.bot ? 1 : 0, W.owners[r[0]]?.skin || null]) });
  }
  function startRound(W){
    for (let k = 0; k < W.cN; k++) cKill(W, W.cL[k]);
    for (let k = 0; k < W.bN; k++) W.bDead[W.bL[k]] = 1;
    for (let k = 0; k < W.vN; k++) W.vDead[W.vL[k]] = 1;
    compact(W);
    W.round++; W.phase = 0; W.left = ROUND;
    W.pSeed = (rnd(W) * 2147483647) | 0;
    for (let p = 0; p < NP; p++) { W.pAl[p] = 1; W.pGen[p] = 0; pelletXY(W.pSeed, p, 0, W.pX, W.pY, p); }
    for (let z = 0; z < ZN * ZN; z++) W.zv[z]++;
    for (let i = 0; i < VIR_MIN; i++) placeVirus(W);
    let n = 0;
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o) continue;
      o.alive = false; o.wantSpawn = !o.retire; o.spawnAt = W.step + (o.bot ? 2 + n * 2 : 1); o.best = 0; o.eaten = 0; o.mass = 0;
      n++;
    }
    W.ev.push({ k: 'start', n: W.round });
  }

  // ═══ Бот: думает раз в 3–5 шагов; видит столько же, сколько игрок; новичков (первые 20 с) не гоняет ═══
  function think(W, o){
    const B = o.brain, cx = o.cx, cy = o.cy, vr = (650 + o.rt * 2.2) * o.st.view;
    let fx = 0, fy = 0, threat = 0, prey = -1, preyD = 1e9;
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k];
      if (W.cDead[s] || W.cO[s] === o.i) continue;
      const dx = W.cX[s] - cx, dy = W.cY[s] - cy;
      if (dx > vr || dx < -vr || dy > vr || dy < -vr) continue;
      const m = W.cM[s], r = radius(m), dd = Math.sqrt(dx * dx + dy * dy) || 1, gap = Math.max(25, dd - r - o.maxR);
      if (m >= o.minM * 1.25) {
        const w = (m / o.minM) * 1200 * B.caut / (gap * gap) * (m * .5 >= o.minM * 1.25 && gap < r * 3 ? 2 : 1);
        fx -= dx / dd * w; fy -= dy / dd * w;
        if (w > threat) threat = w;
      } else if (o.maxM >= m * 1.3 && W.cProt[s] <= W.step) {
        const ow = W.owners[W.cO[s]];
        if (ow && !ow.bot && W.step - ow.life < MERCY) { if (gap < 60) { const w = 2 / gap; fx -= dx / dd * w; fy -= dy / dd * w; } continue; }
        const w = Math.pow(m, .7) * 9 * B.aggr / gap * (ow && !ow.bot ? .7 : 1);
        fx += dx / dd * w; fy += dy / dd * w;
        if (o.maxM >= m * 2.7 && gap < preyD) { preyD = gap; prey = s; }
      }
    }
    // еда рядом (точки и выбросы)
    const R = 420;
    let zx0 = Math.floor((cx - R + H) / ZONE), zx1 = Math.floor((cx + R + H) / ZONE), zy0 = Math.floor((cy - R + H) / ZONE), zy1 = Math.floor((cy + R + H) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
    for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
      const base = (zy * ZN + zx) * KS;
      for (let j = 0; j < KS; j++) {
        const p = base + j;
        if (!W.pAl[p]) continue;
        const dx = W.pX[p] - cx, dy = W.pY[p] - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const w = 1.2 / Math.max(d, 40);
        fx += dx / d * w; fy += dy / d * w;
      }
    }
    for (let k = 0; k < W.bN; k++) {
      const b = W.bL[k];
      if (o.maxM < BLOB_M * 1.2) break;
      const dx = W.bX[b] - cx, dy = W.bY[b] - cy;
      if (dx > R || dx < -R || dy > R || dy < -R) continue;
      const d = Math.sqrt(dx * dx + dy * dy) || 1, w = 8 / Math.max(d, 40);
      fx += dx / d * w; fy += dy / d * w;
    }
    // колючки: большому — держаться подальше, маленькому под угрозой — прятаться за ними
    for (let k = 0; k < W.vN; k++) {
      const v = W.vL[k], dx = W.vX[v] - cx, dy = W.vY[v] - cy;
      if (dx > vr || dx < -vr || dy > vr || dy < -vr) continue;
      const d = Math.sqrt(dx * dx + dy * dy) || 1, gap = Math.max(20, d - radius(W.vM[v]) - o.maxR);
      if (o.maxM >= VIRUS_POP && !o.st.spikes) { if (gap < 220) { const w = 900 / (gap * gap); fx -= dx / d * w; fy -= dy / d * w; } }
      else if (threat > .05 && d < 600) { const w = .02 * threat; fx += dx / d * w; fy += dy / d * w; }
    }
    // край арены
    const E = H - 320;
    if (cx > E) fx -= (cx - E) / 320 * 2; else if (cx < -E) fx += (-E - cx) / 320 * 2;
    if (cy > E) fy -= (cy - E) / 320 * 2; else if (cy < -E) fy += (-E - cy) / 320 * 2;
    let fm = Math.sqrt(fx * fx + fy * fy);
    if (fm < .004) {
      if (W.step >= B.wt) { const a = rnd(W) * TAU; B.wx = Math.cos(a); B.wy = Math.sin(a); B.wt = W.step + 60 + ((rnd(W) * 90) | 0); }
      fx = B.wx; fy = B.wy; fm = 1;
    }
    o.inX = fx / fm; o.inY = fy / fm;
    if (B.splitCd > 0) B.splitCd -= B.every;
    if (prey >= 0 && B.splitCd <= 0 && threat < .02 && o.nC <= 2 && o.st.split && preyD < 3.2 * radius(o.maxM / 2) + 60 && rnd(W) < B.aggr * .5) {
      const dx = W.cX[prey] - cx, dy = W.cY[prey] - cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      o.inX = dx / d; o.inY = dy / d; o.inS++;
      B.splitCd = 150;
    }
  }

  // ═══════════════════ СЕТЬ: снимок для гостя ═══════════════════
  // u8 1 · u8 флаги (1 — лидеры, 2 — итоги раунда, 4 — эхо) · u32 шаг · u16 раунд · u16 осталось (0,1 с) · u8 я (255 — нет) · u32 моя масса
  // · u32 зерно еды · [u32 эхо, u16 задержка] · u16 клеток × 10 Б (id, хозяин, x·4, y·4, масса·2, флаги) · u8 колючек × 7 Б (id, x·4, y·4,
  // масса−100) · u8 выбросов × 7 Б (id, x·4, y·4, хозяин) · u16 зон еды × 3 Б (номер, 2 × (жива | поколение << 1)) · u8 эмодзи × 2 Б
  // · [u8 лидеров × 5 Б (хозяин, масса u32), u8 моё место, u8 всего]. Только то, что видит гость (+25 % и 160 по краям).
  function encode(W, i, g){
    const echo = g.inTs >= 0;
    const w = g.w || (g.w = K.writer(2048));
    w.o = 0;
    const o = W.owners[i];
    const cx = o ? (o.nC ? o.cx : o.deadX) : 0, cy = o ? (o.nC ? o.cy : o.deadY) : 0;
    const asp = clamp(g.aspect || 1.6, .3, 3.5), vh = Math.sqrt(viewArea(o && o.nC ? o.rt : 18) / asp);
    const hw = vh * asp * .625 + 160, hh = vh * .625 + 160;
    const lb = W.step % 15 === 0 || !g.lbAt || W.step - g.lbAt >= 15;
    if (lb) g.lbAt = W.step;
    w.u8(1);
    w.u8((lb ? 1 : 0) | (W.phase ? 2 : 0) | (echo ? 4 : 0));
    w.u32(W.step); w.u16(W.round); w.u16(Math.ceil(W.left / 3)); w.u8(o ? i : 255); w.u32(o && o.nC ? o.mass : 0); w.u32(W.pSeed >>> 0);
    if (echo) { w.u32(g.inTs); w.u16(Math.min(65535, Math.max(0, g.hold | 0))); }
    let at = w.at(), n = 0;
    w.u16(0);
    for (let k = 0; k < W.cN; k++) {
      const s = W.cL[k], r = radius(W.cM[s]);
      if (Math.abs(W.cX[s] - cx) > hw + r || Math.abs(W.cY[s] - cy) > hh + r) continue;
      w.u16(W.cId[s]); w.u8(W.cO[s]); w.i16(W.cX[s] * 4); w.i16(W.cY[s] * 4); w.u16(W.cM[s] * 2);
      w.u8((W.cProt[s] > W.step ? 1 : 0) | (W.cMg[s] <= W.step ? 2 : 0));
      n++;
    }
    w.put16(at, n);
    at = w.at(); n = 0; w.u8(0);
    for (let k = 0; k < W.vN && n < 255; k++) {
      const s = W.vL[k];
      if (Math.abs(W.vX[s] - cx) > hw + 80 || Math.abs(W.vY[s] - cy) > hh + 80) continue;
      w.u16(W.vId[s]); w.i16(W.vX[s] * 4); w.i16(W.vY[s] * 4); w.u8(W.vM[s] - VIRUS_M);
      n++;
    }
    w.put8(at, n);
    at = w.at(); n = 0; w.u8(0);
    for (let k = 0; k < W.bN && n < 255; k++) {
      const s = W.bL[k];
      if (Math.abs(W.bX[s] - cx) > hw + 30 || Math.abs(W.bY[s] - cy) > hh + 30) continue;
      w.u16(W.bId[s]); w.i16(W.bX[s] * 4); w.i16(W.bY[s] * 4); w.u8(W.bO[s]);
      n++;
    }
    w.put8(at, n);
    let zx0 = Math.floor((cx - hw + H) / ZONE), zx1 = Math.floor((cx + hw + H) / ZONE), zy0 = Math.floor((cy - hh + H) / ZONE), zy1 = Math.floor((cy + hh + H) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
    if (!g.zv) { g.zv = new Uint16Array(ZN * ZN); g.zv.fill(65535); g.sn = 0; }
    const sn = g.sn = (g.sn + 1) % 30;
    at = w.at(); n = 0; w.u16(0);
    for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
      const z = zy * ZN + zx;
      if (g.zv[z] === W.zv[z] && z % 30 !== sn) continue;
      g.zv[z] = W.zv[z];
      const p = z * KS;
      w.u16(z);
      w.u16((W.pAl[p] ? 1 : 0) | (W.pGen[p] << 1) | (W.pAl[p + 1] ? 16 : 0) | (W.pGen[p + 1] << 5) | (W.pAl[p + 2] ? 256 : 0) | (W.pGen[p + 2] << 9) | (W.pAl[p + 3] ? 4096 : 0) | (W.pGen[p + 3] << 13));
      n++;
    }
    w.put16(at, n);
    at = w.at(); n = 0; w.u8(0);
    for (let k = 0; k < MAXO; k++) { const q = W.owners[k]; if (q && q.emote && q.emoteUntil > W.step) { w.u8(k); w.u8(q.emote); n++; } }
    w.put8(at, n);
    if (lb) {
      w.u8(W.lbN);
      for (let k = 0; k < W.lbN; k++) { w.u8(W.lbO[k]); w.u32(W.lbS[k]); }
      let rank = 0, tot = 0;
      for (let k = 0; k < MAXO; k++) { const q = W.owners[k]; if (!q || !q.alive) continue; tot++; if (o && o.alive && q.mass > o.mass) rank++; }
      w.u8(o && o.alive ? rank + 1 : 0); w.u8(tot);
    }
    return w.view();
  }

  // ── Зеркало гостя: то же, что у хозяина, но из снимков (без новых объектов на каждый снимок) ──
  const MC = 512, MV = 48, MB = 256;
  function mirror(old){
    const G = old && old.cMap ? old : {
      cMap: new Int16Array(65536).fill(-1), cL: new Int16Array(MC), cF: new Int16Array(MC), cFN: 0, cN: 0,
      cId: new Uint16Array(MC), cO: new Int8Array(MC), cFX: new Float64Array(MC), cFY: new Float64Array(MC), cTX: new Float64Array(MC), cTY: new Float64Array(MC),
      cRX: new Float64Array(MC), cRY: new Float64Array(MC), cFM: new Float64Array(MC), cTM: new Float64Array(MC), cRM: new Float64Array(MC), cFl: new Uint8Array(MC), cSeen: new Int32Array(MC), cBorn: new Float64Array(MC),
      vMap: new Int16Array(65536).fill(-1), vL: new Int16Array(MV), vF: new Int16Array(MV), vFN: 0, vN: 0, vId: new Uint16Array(MV),
      vFX: new Float64Array(MV), vFY: new Float64Array(MV), vTX: new Float64Array(MV), vTY: new Float64Array(MV), vRX: new Float64Array(MV), vRY: new Float64Array(MV), vM: new Float64Array(MV), vSeen: new Int32Array(MV),
      bMap: new Int16Array(65536).fill(-1), bL: new Int16Array(MB), bF: new Int16Array(MB), bFN: 0, bN: 0, bId: new Uint16Array(MB), bO: new Int8Array(MB),
      bFX: new Float64Array(MB), bFY: new Float64Array(MB), bTX: new Float64Array(MB), bTY: new Float64Array(MB), bRX: new Float64Array(MB), bRY: new Float64Array(MB), bSeen: new Int32Array(MB),
      pAl: new Uint8Array(NP), pGen: new Uint8Array(NP), pX: new Float32Array(NP), pY: new Float32Array(NP),
      lbO: new Int8Array(10), lbS: new Float64Array(10), emo: new Uint8Array(MAXO), owners: new Array(MAXO).fill(null) };
    for (let k = 0; k < G.cN; k++) G.cMap[G.cId[G.cL[k]]] = -1;
    for (let k = 0; k < G.vN; k++) G.vMap[G.vId[G.vL[k]]] = -1;
    for (let k = 0; k < G.bN; k++) G.bMap[G.bId[G.bL[k]]] = -1;
    G.cN = G.vN = G.bN = 0; G.cFN = G.vFN = G.bFN = 0;
    for (let i = 0; i < MC; i++) G.cF[G.cFN++] = MC - 1 - i;
    for (let i = 0; i < MV; i++) G.vF[G.vFN++] = MV - 1 - i;
    for (let i = 0; i < MB; i++) G.bF[G.bFN++] = MB - 1 - i;
    G.ready = false; G.step = -1; G.snap = 0; G.me = -1; G.round = 1; G.phase = 0; G.left = ROUND; G.mass = 0; G.pSeed = -1; G.lbN = 0; G.rank = 0; G.total = 0;
    G.t1 = 0; G.span = 66; G.echoTs = -1; G.hold = 0; G.emo.fill(0);
    if (!old) G.owners.fill(null);
    return G;
  }
  function decode(G, buf, now){
    const r = K.reader(buf);
    if (r.u8() !== 1) return false;
    const fl = r.u8(), st = r.u32();
    if (G.ready && st <= G.step) return false;   // опоздавший снимок (быстрый канал без порядка)
    G.step = st; G.round = r.u16(); G.left = r.u16() * 3; G.phase = fl & 2 ? 1 : 0;
    const me = r.u8(); G.me = me === 255 ? -1 : me;
    G.mass = r.u32();
    const ps = r.u32() | 0;
    if (ps !== G.pSeed) { G.pSeed = ps; for (let p = 0; p < NP; p++) { G.pAl[p] = 0; G.pGen[p] = 0; pelletXY(ps, p, 0, G.pX, G.pY, p); } }
    if (fl & 4) { G.echoTs = r.u32(); G.hold = r.u16(); } else G.echoTs = -1;
    const sn = ++G.snap;
    let n = r.u16();
    for (let i = 0; i < n; i++) {
      const id = r.u16(), o = r.u8(), x = r.i16() / 4, y = r.i16() / 4, m = r.u16() / 2, f = r.u8();
      let s = G.cMap[id];
      if (s < 0) {
        if (!G.cFN) continue;
        s = G.cF[--G.cFN]; G.cMap[id] = s; G.cL[G.cN++] = s; G.cId[s] = id;
        G.cFX[s] = G.cRX[s] = x; G.cFY[s] = G.cRY[s] = y; G.cFM[s] = G.cRM[s] = m; G.cBorn[s] = now;
      } else { G.cFX[s] = G.cRX[s]; G.cFY[s] = G.cRY[s]; G.cFM[s] = G.cRM[s]; }
      G.cO[s] = o; G.cTX[s] = x; G.cTY[s] = y; G.cTM[s] = m; G.cFl[s] = f; G.cSeen[s] = sn;
    }
    for (let k = 0; k < G.cN;) { const s = G.cL[k]; if (G.cSeen[s] !== sn) { G.cMap[G.cId[s]] = -1; G.cF[G.cFN++] = s; G.cL[k] = G.cL[--G.cN]; } else k++; }
    n = r.u8();
    for (let i = 0; i < n; i++) {
      const id = r.u16(), x = r.i16() / 4, y = r.i16() / 4, m = r.u8() + VIRUS_M;
      let s = G.vMap[id];
      if (s < 0) { if (!G.vFN) continue; s = G.vF[--G.vFN]; G.vMap[id] = s; G.vL[G.vN++] = s; G.vId[s] = id; G.vFX[s] = G.vRX[s] = x; G.vFY[s] = G.vRY[s] = y; }
      else { G.vFX[s] = G.vRX[s]; G.vFY[s] = G.vRY[s]; }
      G.vTX[s] = x; G.vTY[s] = y; G.vM[s] = m; G.vSeen[s] = sn;
    }
    for (let k = 0; k < G.vN;) { const s = G.vL[k]; if (G.vSeen[s] !== sn) { G.vMap[G.vId[s]] = -1; G.vF[G.vFN++] = s; G.vL[k] = G.vL[--G.vN]; } else k++; }
    n = r.u8();
    for (let i = 0; i < n; i++) {
      const id = r.u16(), x = r.i16() / 4, y = r.i16() / 4, o = r.u8();
      let s = G.bMap[id];
      if (s < 0) { if (!G.bFN) continue; s = G.bF[--G.bFN]; G.bMap[id] = s; G.bL[G.bN++] = s; G.bId[s] = id; G.bFX[s] = G.bRX[s] = x; G.bFY[s] = G.bRY[s] = y; }
      else { G.bFX[s] = G.bRX[s]; G.bFY[s] = G.bRY[s]; }
      G.bTX[s] = x; G.bTY[s] = y; G.bO[s] = o; G.bSeen[s] = sn;
    }
    for (let k = 0; k < G.bN;) { const s = G.bL[k]; if (G.bSeen[s] !== sn) { G.bMap[G.bId[s]] = -1; G.bF[G.bFN++] = s; G.bL[k] = G.bL[--G.bN]; } else k++; }
    n = r.u16();
    for (let i = 0; i < n; i++) {
      const z = r.u16(), b = r.u16();
      if (z >= ZN * ZN) continue;
      const p = z * KS;
      for (let j = 0; j < KS; j++) setPellet(G, p + j, (b >> (j * 4)) & 1, (b >> (j * 4 + 1)) & 7);
    }
    G.emo.fill(0);
    n = r.u8();
    for (let i = 0; i < n; i++) { const o = r.u8(), e = r.u8(); if (o < MAXO) G.emo[o] = e; }
    if (fl & 1) {
      G.lbN = Math.min(10, r.u8());
      for (let k = 0; k < G.lbN; k++) { G.lbO[k] = r.u8(); G.lbS[k] = r.u32(); }
      G.rank = r.u8(); G.total = r.u8();
    }
    if (G.t1) G.span = clamp(G.span * .8 + (now - G.t1) * .2, 30, 400);
    G.t1 = now;
    G.ready = true;
    return true;
  }
  function setPellet(G, p, alive, gen){
    if (G.pGen[p] !== gen) { G.pGen[p] = gen; pelletXY(G.pSeed, p, gen, G.pX, G.pY, p); }
    G.pAl[p] = alive;
  }
  // Список участников для гостей: [номер, имя, узор, цвет 1, цвет 2, бот, ключ игрока]
  function ownersList(W){
    const l = [];
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o) l.push([i, o.name, o.skin.p, o.skin.a, o.skin.b, o.bot ? 1 : 0, o.bot ? '' : o.key]); }
    return l;
  }
  function setOwners(G, l){
    G.owners.fill(null);
    G.ver = (G.ver || 0) + 1;
    for (const e of l) {
      if (!Array.isArray(e)) continue;
      const i = e[0] | 0;
      if (i < 0 || i >= MAXO) continue;
      G.owners[i] = { name: K.cleanName(e[1], i), skin: skinOk({ p: e[2], a: e[3], b: e[4] }) || presetSkin(i), bot: !!e[5], key: String(e[6] || '').slice(0, 80) };
    }
  }
  // Управление по сети: [x·1000, y·1000, деление, выброс, эмодзи, номер эмодзи]
  function packIn(a){ return [Math.round(a[0] * 1000), Math.round(a[1] * 1000), a[2] | 0, a[3] | 0, a[4] | 0, a[5] | 0]; }
  function unpackIn(d, off, out){
    if (!Array.isArray(d) || d.length < off + 6) return null;
    for (let k = 0; k < 6; k++) if (typeof d[off + k] !== 'number' || !isFinite(d[off + k])) return null;
    out[0] = clamp(d[off] / 1000, -1, 1); out[1] = clamp(d[off + 1] / 1000, -1, 1); out[2] = d[off + 2] | 0; out[3] = d[off + 3] | 0; out[4] = d[off + 4] | 0; out[5] = clamp(d[off + 5] | 0, 0, 8);
    return out;
  }
  // ── Смена хозяина: свои клетки — новому хозяину (не больше, чем было в таблице лидеров) ──
  function claim(G){
    if (G.me < 0) return null;
    const c = [];
    for (let k = 0; k < G.cN && c.length < MAXC; k++) { const s = G.cL[k]; if (G.cO[s] === G.me) c.push([Math.round(G.cTX[s]), Math.round(G.cTY[s]), Math.round(G.cTM[s])]); }
    return c.length ? { c } : null;
  }
  function capOf(G){
    const m = new Map();
    let low = 300;
    for (let k = 0; k < G.lbN; k++) { const o = G.owners[G.lbO[k]]; if (o && o.key) m.set(o.key, G.lbS[k] * 1.15 + 30); low = G.lbS[k]; }
    if (G.lbN >= 10) m.def = low * 1.15 + 30; else m.def = Math.max(300, low * 1.15 + 30);
    return m;
  }
  function applyClaim(W, i, c, caps){
    const o = W.owners[i];
    if (!o) return;
    const list = c && Array.isArray(c.c) ? c.c.slice(0, MAXC).filter(e => Array.isArray(e) && e.length >= 3 && e.every(x => typeof x === 'number' && isFinite(x))) : [];
    let tot = 0;
    for (const e of list) tot += clamp(e[2], START_M, MAX_CM);
    if (!list.length || tot <= 0) { respawn(W, i); return; }
    const cap = caps ? (caps.get(o.key) ?? caps.def ?? 300) : 300, k = Math.min(1, cap / tot);
    for (const e of list) {
      const s = cNew(W, i, clamp(e[0], -H + 20, H - 20), clamp(e[1], -H + 20, H - 20), Math.max(START_M, clamp(e[2], START_M, MAX_CM) * k));
      if (s >= 0) { W.cProt[s] = W.step + PROT; W.cMg[s] = W.step + 6 * SPS; }
    }
    o.alive = W.oc[i] > 0; o.wantSpawn = false; o.life = W.step; o.best = tot * k;
    centers(W);
  }
  function fromMirror(G, me){
    const W = newWorld((Math.random() * 2147483646 + 1) | 0);
    if (G.pSeed >= 0 || G.pSeed < 0) {
      W.pSeed = G.pSeed;
      for (let p = 0; p < NP; p++) { W.pGen[p] = G.pGen[p]; W.pAl[p] = 1; pelletXY(W.pSeed, p, W.pGen[p], W.pX, W.pY, p); }
    }
    W.round = G.round; W.phase = G.phase; W.left = Math.max(1, G.left);
    for (let k = 0; k < W.vN; k++) W.vDead[W.vL[k]] = 1;
    compact(W);
    for (let k = 0; k < G.vN; k++) { const s = G.vL[k]; vNew(W, G.vTX[s], G.vTY[s], G.vM[s]); }
    while (W.vN < VIR_MIN) placeVirus(W);
    const i = addOwner(W, { key: me.key, name: me.name, skin: me.skin, bot: false, spawn: false });
    let tot = 0;
    for (let k = 0; k < G.cN; k++) { const s = G.cL[k]; if (G.cO[s] === G.me) { const t = cNew(W, i, G.cTX[s], G.cTY[s], Math.max(START_M, G.cTM[s])); if (t >= 0) { W.cMg[t] = W.step + 6 * SPS; tot += G.cTM[s]; } } }
    const o = W.owners[i];
    o.alive = W.oc[i] > 0; o.wantSpawn = !o.alive && W.phase === 0; o.best = tot; o.life = 0;
    centers(W);
    return { W, me: i };
  }

  const SIM = { DT, IN, newWorld, addOwner, dropOwner, setOwner, setInput, respawn, setHumans, step, encode, mirror, decode, claim, capOf, applyClaim, fromMirror,
    packIn, unpackIn, owners: ownersList, ownersVer: W => W.ver, setOwners };

  // ═══════════════════ ЭКРАН ═══════════════════
  const GAME = 'kletochki', TITLE = 'Клеточки', COLOR = '#22c55e';
  const LS = 'd37_io_kletochki';
  let host = null, api = null, ui = null, cv = null, ctx = null, S = null, mode = 'menu', dpr = 1, cssW = 0, cssH = 0, ro = null;
  let lastT = 0, hudAt = 0, koAt = 0, myIdx = -1, cfg = null, lifeRun = '', lbKey = '', reported = new Set(), soundMass = 0, soundAt = 0;
  const cam = { x: 0, y: 0, z: 1, ok: false };
  const INP = new Float64Array(IN);
  const mouse = { on: false, x: 0, y: 0, t: 0 }, keys = { u: 0, d: 0, l: 0, r: 0 };
  let stick = null, padPrev = { a: false, b: false, y: false }, padEjAt = 0, ejAt = 0;
  const listeners = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); };
  // Рисование: общие массивы (хозяин — из мира, гость — из зеркала)
  const RC = 512;
  const R = { n: 0, x: new Float64Array(RC), y: new Float64Array(RC), r: new Float64Array(RC), o: new Int8Array(RC), f: new Uint8Array(RC), id: new Uint16Array(RC), ord: new Int16Array(RC),
    vn: 0, vx: new Float64Array(64), vy: new Float64Array(64), vr: new Float64Array(64), bn: 0, bx: new Float64Array(256), by: new Float64Array(256), bo: new Int8Array(256) };
  const PCOL = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#a78bfa', '#f472b6'];
  const FONTS = [];
  for (let s = 0; s <= 96; s++) FONTS.push(`800 ${s}px Montserrat,system-ui,sans-serif`);
  const fontPx = px => FONTS[px < 0 ? 0 : px > 96 ? 96 : px | 0];
  const EFONTS = [];
  for (let s = 0; s <= 96; s++) EFONTS.push(`${s}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`);
  const names = new Array(MAXO).fill('');
  const skins = new Array(MAXO).fill(null);
  const bots = new Uint8Array(MAXO);

  function loadCfg(){
    let c = null;
    try { c = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
    c = c && typeof c === 'object' ? c : {};
    const mine = K.myColors();
    return { name: typeof c.name === 'string' ? c.name : '', skin: skinOk(c.skin) || (mine ? { p: 5, a: mine.c1, b: mine.c2 } : presetSkin(0)), mine: !!c.mine };
  }
  function saveCfg(){ try { localStorage.setItem(LS, JSON.stringify({ name: cfg.name, skin: cfg.skin, mine: cfg.mine })); } catch (e) {} }
  const myName = () => K.cleanName(cfg.name || K.myNick(), 3);

  // ── Меню ──
  function menu(){
    mode = 'menu';
    stopSession();
    ui.hud.hidden = true;
    showOv(`<div class="io-card wide">
        <div class="io-logo">🦠</div><div class="io-title">${TITLE}</div>
        <div class="io-sub">Ты — клетка. Ешь точки и тех, кто меньше, и расти! Делись (пробел / ✂️), чтобы догнать, выбрасывай массу (W / 💧). Колючки разрывают больших — маленьким за ними можно прятаться. Раунд — 5 минут.</div>
        <div class="io-name"><input type="text" maxlength="16" placeholder="Имя на арене" value="${K.escH(cfg.name || '')}" aria-label="Имя на арене" autocomplete="off"></div>
        <div class="io-skins">${PRESETS.map((q, k) => `<button type="button" data-io="sk${k}" aria-label="Раскраска ${k + 1}"><canvas width="64" height="64"></canvas></button>`).join('')}</div>
        <div class="io-cols"><label>Узор <select data-io="pat">${PATTERNS.map((p, k) => `<option value="${k}">${p}</option>`).join('')}</select></label>
          <label>Цвет <input type="color" data-io="ca"></label><label>Второй <input type="color" data-io="cb"></label>
          ${K.myColors() ? '<button type="button" class="io-b2" data-io="mine" style="min-height:36px;padding:.3rem .7rem">🎭 Мои цвета</button>' : ''}</div>
        <div class="io-btns">
          <button type="button" class="ct-start" data-io="play">▶ Играть</button>
          <button type="button" class="io-b2" data-io="bots">🤖 С ботами (без интернета)</button>
          <button type="button" class="io-b2" data-io="friend">🔗 Позвать друга</button>
          <button type="button" class="io-b2" data-gk-rules="${GAME}">📖 Правила</button>
        </div>
        <div class="io-cd">Чата нет — только эмодзи. Боты отмечены 🤖.</div>
      </div>`);
    const inp = ui.ov.querySelector('.io-name input');
    inp.addEventListener('input', () => { cfg.name = inp.value.slice(0, 16); saveCfg(); });
    paintSkins();
  }
  function paintSkins(){
    if (!ui) return;
    ui.ov.querySelectorAll('[data-io^="sk"]').forEach((b, k) => {
      const c = b.querySelector('canvas').getContext('2d'), q = presetSkin(k);
      c.clearRect(0, 0, 64, 64);
      drawCell(c, 32, 32, 26, q, k, 0, 1, 0, 1);
      b.classList.toggle('sel', cfg.skin.p === q.p && cfg.skin.a === q.a && cfg.skin.b === q.b);
    });
    const pat = ui.ov.querySelector('[data-io="pat"]'), ca = ui.ov.querySelector('[data-io="ca"]'), cb = ui.ov.querySelector('[data-io="cb"]');
    if (pat) pat.value = String(cfg.skin.p);
    if (ca) ca.value = cfg.skin.a;
    if (cb) cb.value = cfg.skin.b;
  }

  // ── Сеанс ──
  function stopSession(){ if (S) { S.leave(); S = null; } myIdx = -1; }
  function newSession(){
    stopSession();
    cfg.name = cfg.name || '';
    S = K.session({ game: GAME, sim: SIM, max: 10, me: { key: K.myKey(), nick: myName(), skin: cfg.skin, aspect: (cssW || 400) / (cssH || 600) },
      onFrame: (s, t) => frame(t), onInput: t => readInput(t), onRole: role => onRole(role), onYou: i => { myIdx = i; }, onKo: e => onKo(e), onRound: e => onRound(e),
      onPlayers: () => syncNames(), onStatus: (k, v) => onStatus(k, v) });
    return S;
  }
  function startBots(){ newSession(); S.offline(); enterGame(); }
  function startOnline(code, pub){
    if (!K.netOk()) { api.toast?.('📡 Онлайн сейчас недоступен — играем с ботами'); startBots(); return; }
    newSession(); S.online(code, { pub });
    enterGame();
    showOv(`<div class="io-card"><div class="io-logo">🌐</div><div class="io-sub">${pub ? 'Ищем арену…' : 'Подключаемся к комнате…'}</div></div>`);
  }
  function enterGame(){
    mode = 'play'; koAt = 0; cam.ok = false; reported.clear(); lifeRun = ''; soundMass = 0;
    ui.hud.hidden = false; resize();
    syncNames();
  }
  function onRole(role){
    if (role === 'host' || role === 'off' || role === 'guest') { if (ui.ov.querySelector('.io-logo')?.textContent === '🌐') hideOv(); }
    syncNames();
  }
  function onStatus(kind, v){
    if (kind === 'error') {
      const txt = v === 'full' ? 'Комната заполнена (10 игроков).' : v === 'dup' ? 'Ты уже играешь в этой комнате в другой вкладке.' : 'Не удалось подключиться.';
      showOv(`<div class="io-card"><div class="io-logo">📡</div><div class="io-title" style="font-size:1.2rem">${txt}</div><div class="io-btns"><button type="button" class="ct-start" data-io="bots">🤖 Играть с ботами</button><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`);
    } else if (kind === 'handover') api.toast?.('Ты свернул вкладку — арену ведёт другой игрок');
  }
  function syncNames(){
    for (let i = 0; i < MAXO; i++) {
      const o = S ? (S.role === 'guest' ? S.G?.owners[i] : S.W?.owners[i]) : null;
      names[i] = o ? K.showName(o.name) : ''; skins[i] = o ? o.skin : null; bots[i] = o && o.bot ? 1 : 0;
    }
  }

  // ── События: съели, раунд ──
  function onKo(e){
    if (!S || e.o !== S.me) return;
    koAt = performance.now();
    api.sfx?.('bad');
    reportLife(e.best, false, e.life);
    const by = e.by >= 0 ? names[e.by] : '';
    setTimeout(() => {
      if (!S || mode !== 'play' || !koAt) return;
      showOv(`<div class="io-card"><div class="io-logo">😵</div><div class="io-title">Тебя съели!</div>
        ${by ? `<div class="io-sub">Тебя съел${bots[e.by] ? ' бот' : ''} «${K.escH(by)}»</div>` : ''}
        <div class="io-stats"><div><b>${K.num(e.best)}</b><small>лучшая масса</small></div><div><b>${e.eaten}</b><small>${K.ru(e.eaten, 'съедена клетка', 'съедено клетки', 'съедено клеток')}</small></div><div><b>${fmtT(e.life)}</b><small>в игре</small></div></div>
        <div class="io-btns"><button type="button" class="ct-start" data-io="again">▶ Ещё раз</button><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`, 'ko');
    }, 650);
  }
  function onRound(e){
    if (!S) return;
    if (e.k === 'start') { hideOv(); koAt = 0; reported.clear(); return; }
    const mine = e.rank.findIndex(r => r[0] === S.me), alive = mine >= 0;
    if (alive && !koAt) reportLife(e.rank[mine][2], mine === 0 && e.total >= 3 && e.rank[mine][3] >= 60, e.rank[mine][3]);
    const pod = [1, 0, 2].map(k => e.rank[k] ? `<div><b>${['🥇', '🥈', '🥉'][k]}</b><span>${K.escH(K.showName(e.names[k]?.[0] || ''))}${e.names[k]?.[1] ? ' 🤖' : ''}</span><small>${K.num(e.rank[k][1])}</small><i style="height:${[54, 74, 40][k]}px"></i></div>` : '').join('');
    showOv(`<div class="io-card"><div class="io-logo">🏁</div><div class="io-title">Раунд окончен</div><div class="io-pod">${pod}</div>
      ${alive ? `<div class="io-me">${mine === 0 ? '🏆 Ты победил!' : `Твоё место: ${mine + 1} из ${e.rank.length}`}</div>` : ''}
      <div class="io-cd">Новый раунд через <b class="io-left">8</b> с</div><div class="io-btns"><button type="button" class="io-b2" data-io="menu">🏠 Меню</button></div></div>`);
    if (mine === 0) api.sfx?.('win');
    try { window.D37Ads?.interstitial?.(GAME); } catch (er) {}
  }
  function reportLife(best, win, life){
    const runKey = (S?.role || 'x') + ':' + (S?.view()?.round || 0) + ':' + Math.round(life);
    if (reported.has(runKey) || !api) return;
    reported.add(runKey);
    best = Math.round(best || 0);
    const online = S && S.role !== 'off' && S.humans() >= 2;
    api.report?.(online ? GAME + '_online' : GAME, !!win, best, best);
    const coins = Math.min(10, Math.floor(best / 100));
    if (coins > 0 && root.D37Coins) root.D37Coins.run(GAME, coins, 'kl' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)).catch?.(() => {});
  }

  // ── Управление ──
  function readInput(t){
    if (!S || mode !== 'play') return;
    let x = 0, y = 0;
    const p = K.pad();
    if (stick && stick.st.on) { x = stick.st.x; y = stick.st.y; }
    else if (keys.u || keys.d || keys.l || keys.r) { x = keys.r - keys.l; y = keys.d - keys.u; const m = Math.hypot(x, y); if (m) { x /= m; y /= m; } }
    else if (p && (p.x || p.y)) { x = p.x; y = p.y; }
    else if (mouse.on && cam.ok) {
      const wx = cam.x + (mouse.x - cssW / 2) / cam.z, wy = cam.y + (mouse.y - cssH / 2) / cam.z;
      const R2 = 280 + myRt * 1.6;
      x = (wx - myCx) / R2; y = (wy - myCy) / R2;
      const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    }
    if (p) {
      if (p.a && !padPrev.a) INP[2]++;
      if (p.b && (!padPrev.b || t - padEjAt > 110)) { INP[3]++; padEjAt = t; }
      padPrev.a = p.a; padPrev.b = p.b;
    }
    if (Math.abs(x - INP[0]) > .002 || Math.abs(y - INP[1]) > .002 || p?.a || p?.b) { INP[0] = x; INP[1] = y; S.setInput(INP, t); }
  }
  let myCx = 0, myCy = 0, myRt = 18, myMass = 0;
  function act(kind, t){
    if (!S || mode !== 'play') return;
    if (kind === 'split') INP[2]++;
    else if (kind === 'eject') { if (t - ejAt < 90) return; ejAt = t; INP[3]++; }
    S.setInput(INP, t);
    if (kind === 'split') api.sfx?.('move');
  }
  function emote(k, t){ if (!S) return; INP[4]++; INP[5] = k; S.setInput(INP, t); ui.emos.hidden = true; }
  const KEYD = { arrowup: 'u', arrowdown: 'd', arrowleft: 'l', arrowright: 'r' };
  function onKey(e){
    if (mode !== 'play' || e.target?.closest?.('input,textarea,select') || window.GameKit?.isOpen?.()) return;
    const k = (e.key || '').toLowerCase(), down = e.type === 'keydown';
    if (KEYD[k]) { keys[KEYD[k]] = down ? 1 : 0; e.preventDefault(); return; }
    if (!down) return;
    if (k === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) act('split', e.timeStamp || performance.now()); }
    else if (k === 'w' || k === 'ц' || e.code === 'KeyW') { e.preventDefault(); act('eject', e.timeStamp || performance.now()); }
    else if (/^[1-8]$/.test(k)) emote(+k, e.timeStamp || performance.now());
  }
  function onClick(e){
    const b = e.target.closest('[data-io]');
    if (!b || !host?.contains(b)) return;
    const a = b.dataset.io, t = e.timeStamp || performance.now();
    if (a === 'play') { cfg.name = ui.ov.querySelector('.io-name input')?.value.slice(0, 16) || cfg.name; saveCfg(); startOnline('', true); }
    else if (a === 'bots') startBots();
    else if (a === 'friend') { const code = root.GameRoom?.newCode?.() || Math.random().toString(36).slice(2, 8); location.hash = `#/games/${GAME}/${code}`; }
    else if (a === 'menu') menu();
    else if (a === 'again') { hideOv(); koAt = 0; S?.respawn(); }
    else if (a === 'emo') ui.emos.hidden = !ui.emos.hidden;
    else if (/^e\d$/.test(a)) emote(+a.slice(1), t);
    else if (a === 'invite') { if (S && S.code && S.role !== 'off') K.share(GAME, S.code, TITLE, api.toast); else { const code = root.GameRoom?.newCode?.() || 'r' + Math.random().toString(36).slice(2, 7); location.hash = `#/games/${GAME}/${code}`; } }
    else if (a.startsWith('sk')) { cfg.skin = presetSkin(+a.slice(2)); cfg.mine = false; saveCfg(); paintSkins(); S?.setMe({ skin: cfg.skin }); }
    else if (a === 'mine') { const m = K.myColors(); if (m) { cfg.skin = { p: m.rainbow ? 6 : 5, a: m.c1, b: m.c2 }; cfg.mine = true; saveCfg(); paintSkins(); } }
  }
  function onChange(e){
    const b = e.target.closest('[data-io]');
    if (!b) return;
    const a = b.dataset.io;
    if (a === 'pat') cfg.skin = { ...cfg.skin, p: clamp(+b.value | 0, 0, PATTERNS.length - 1) };
    else if (a === 'ca' && K.okColor(b.value)) cfg.skin = { ...cfg.skin, a: b.value.toLowerCase() };
    else if (a === 'cb' && K.okColor(b.value)) cfg.skin = { ...cfg.skin, b: b.value.toLowerCase() };
    else return;
    saveCfg(); paintSkins();
  }
  function padDown(e){
    const b = e.target.closest('[data-pad]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 140);
    act(b.dataset.pad, e.timeStamp || performance.now());
  }
  function showOv(html, cls){ ui.ov.className = 'io-ov' + (cls ? ' ' + cls : ''); ui.ov.innerHTML = html; ui.ov.hidden = false; }
  function hideOv(){ ui.ov.hidden = true; ui.ov.innerHTML = ''; ui.ov.className = 'io-ov'; }
  function resize(){
    if (!ui) return;
    dpr = Math.min(document.body.classList.contains('low') ? 1.25 : 2, window.devicePixelRatio || 1);
    cssW = ui.wrap.clientWidth || 360;
    cssH = K.fitHeight(ui.wrap);
    ui.wrap.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    if (S) S.setMe({ aspect: cssW / cssH });
    if (mode !== 'play') drawIdle();
  }

  // ═══ Кадр: положения для рисования, камера, рисунок ═══
  function frame(t){
    const dtf = lastT ? clamp((t - lastT) / 1000, 0, .1) : .016;
    lastT = t;
    if (!S || !ctx) return;
    const guest = S.role === 'guest', V = S.view();
    R.n = R.vn = R.bn = 0;
    if (V && (guest ? V.ready : true)) { if (guest) prepGuest(V, t, dtf); else prepHost(V, S.alpha); }
    camera(dtf);
    draw(t, V, guest);
    if (t - hudAt > 250) { hudAt = t; hud(V, guest); }
    sounds(t);
  }
  function prepHost(W, a){
    myMass = 0; let sx = 0, sy = 0;
    for (let k = 0; k < W.cN && R.n < RC; k++) {
      const s = W.cL[k], j = R.n++;
      R.x[j] = W.cPX[s] + (W.cX[s] - W.cPX[s]) * a; R.y[j] = W.cPY[s] + (W.cY[s] - W.cPY[s]) * a; R.r[j] = radius(W.cM[s]);
      R.o[j] = W.cO[s]; R.id[j] = W.cId[s]; R.f[j] = W.cProt[s] > W.step ? 1 : 0;
      if (W.cO[s] === S.me) { const m = W.cM[s]; myMass += m; sx += R.x[j] * m; sy += R.y[j] * m; }
    }
    for (let k = 0; k < W.vN && R.vn < 64; k++) { const s = W.vL[k], j = R.vn++; R.vx[j] = W.vPX[s] + (W.vX[s] - W.vPX[s]) * a; R.vy[j] = W.vPY[s] + (W.vY[s] - W.vPY[s]) * a; R.vr[j] = radius(W.vM[s]); }
    for (let k = 0; k < W.bN && R.bn < 256; k++) { const s = W.bL[k], j = R.bn++; R.bx[j] = W.bPX[s] + (W.bX[s] - W.bPX[s]) * a; R.by[j] = W.bPY[s] + (W.bY[s] - W.bPY[s]) * a; R.bo[j] = W.bO[s]; }
    meCenter(sx, sy, W.owners[S.me]);
  }
  // Гость: чужое — между двумя снимками; своё — сразу по своему управлению (прогноз), потом мягко к тому, что прислал хозяин
  function prepGuest(G, t, dtf){
    const span = G.span || 66, al = clamp((t - G.t1) / span, 0, 1);
    const ahead = clamp((t - G.t1) / 1000 + S.rtt / 2000, 0, .35);
    myMass = 0; let sx = 0, sy = 0;
    for (let k = 0; k < G.cN; k++) { const s = G.cL[k]; if (G.cO[s] === G.me) { sx += G.cTX[s] * G.cTM[s]; sy += G.cTY[s] * G.cTM[s]; myMass += G.cTM[s]; } }
    const cx0 = myMass ? sx / myMass : cam.x, cy0 = myMass ? sy / myMass : cam.y, rt = radius(myMass || 10), Rr = 280 + rt * 1.6;
    const ease = 1 - Math.exp(-dtf * 12);
    myMass = 0; sx = 0; sy = 0;
    for (let k = 0; k < G.cN && R.n < RC; k++) {
      const s = G.cL[k], j = R.n++;
      let x = G.cFX[s] + (G.cTX[s] - G.cFX[s]) * al, y = G.cFY[s] + (G.cTY[s] - G.cFY[s]) * al;
      const m = G.cFM[s] + (G.cTM[s] - G.cFM[s]) * al;
      if (G.cO[s] === G.me && G.phase === 0) {
        const r = radius(G.cTM[s]), dx = cx0 + INP[0] * Rr - G.cTX[s], dy = cy0 + INP[1] * Rr - G.cTY[s], d = Math.hypot(dx, dy), im = Math.hypot(INP[0], INP[1]);
        let px = G.cTX[s], py = G.cTY[s];
        if (d > .5 && im > .02) { const sp = speedOf(r) * Math.min(1, im * 1.4) * Math.min(1, d / (r * .5 + 25)) * ahead; px += dx / d * sp; py += dy / d * sp; }
        x = G.cRX[s] + (px - G.cRX[s]) * ease; y = G.cRY[s] + (py - G.cRY[s]) * ease;
      }
      G.cRX[s] = x; G.cRY[s] = y; G.cRM[s] = m;
      R.x[j] = x; R.y[j] = y; R.r[j] = radius(m); R.o[j] = G.cO[s]; R.id[j] = G.cId[s]; R.f[j] = G.cFl[s] & 1;
      if (G.cO[s] === G.me) { myMass += m; sx += x * m; sy += y * m; }
    }
    for (let k = 0; k < G.vN && R.vn < 64; k++) { const s = G.vL[k], j = R.vn++; G.vRX[s] = G.vFX[s] + (G.vTX[s] - G.vFX[s]) * al; G.vRY[s] = G.vFY[s] + (G.vTY[s] - G.vFY[s]) * al; R.vx[j] = G.vRX[s]; R.vy[j] = G.vRY[s]; R.vr[j] = radius(G.vM[s]); }
    for (let k = 0; k < G.bN && R.bn < 256; k++) { const s = G.bL[k], j = R.bn++; G.bRX[s] = G.bFX[s] + (G.bTX[s] - G.bFX[s]) * al; G.bRY[s] = G.bFY[s] + (G.bTY[s] - G.bFY[s]) * al; R.bx[j] = G.bRX[s]; R.by[j] = G.bRY[s]; R.bo[j] = G.bO[s]; }
    meCenter(sx, sy, null);
  }
  function meCenter(sx, sy, o){
    if (myMass > 0) { myCx = sx / myMass; myCy = sy / myMass; myRt = radius(myMass); }
    else if (o) { myCx = o.deadX; myCy = o.deadY; }
  }
  function camera(dtf){
    const area = viewArea(myMass > 0 ? myRt : 18), zt = Math.sqrt((cssW * cssH) / area);
    if (!cam.ok) { cam.x = myCx; cam.y = myCy; cam.z = zt; cam.ok = myMass > 0; return; }
    const k = 1 - Math.exp(-dtf * 9), kz = 1 - Math.exp(-dtf * 2.5);
    cam.x += (myCx - cam.x) * k; cam.y += (myCy - cam.y) * k; cam.z += (zt - cam.z) * kz;
  }

  // ── Рисунок клетки: узор + имя ──
  function drawCell(c, x, y, r, sk, id, t, scale, eyeA, alpha){
    c.globalAlpha = alpha;
    c.fillStyle = sk.p === 6 ? '#f472b6' : sk.a;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    const sr = r * scale;
    if (sr > 4) {
      c.fillStyle = sk.b; c.strokeStyle = sk.b;
      const p = sk.p, rot = (id % 97) * .37 + t * .0004;
      if (p === 1) { c.beginPath(); c.arc(x, y, r * .42, 0, TAU); c.fill(); }
      else if (p === 2) { c.beginPath(); for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6, px = x + Math.cos(a) * r * .56, py = y + Math.sin(a) * r * .56; c.moveTo(px + r * .13, py); c.arc(px, py, r * .13, 0, TAU); } c.fill(); }
      else if (p === 3) { c.beginPath(); c.arc(x, y, r, rot, rot + Math.PI); c.closePath(); c.fill(); }
      else if (p === 4) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, q = i % 2 ? r * .25 : r * .6; if (i) c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else c.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q); } c.closePath(); c.fill(); }
      else if (p === 5) {
        const ex = Math.cos(eyeA) * r * .12, ey = Math.sin(eyeA) * r * .12;
        c.fillStyle = '#fff'; c.beginPath(); c.arc(x - r * .3, y - r * .18, r * .22, 0, TAU); c.moveTo(x + r * .52, y - r * .18); c.arc(x + r * .3, y - r * .18, r * .22, 0, TAU); c.fill();
        c.fillStyle = '#111'; c.beginPath(); c.arc(x - r * .3 + ex, y - r * .18 + ey, r * .1, 0, TAU); c.moveTo(x + r * .4 + ex, y - r * .18 + ey); c.arc(x + r * .3 + ex, y - r * .18 + ey, r * .1, 0, TAU); c.fill();
        c.lineWidth = Math.max(1, r * .07); c.strokeStyle = sk.b; c.beginPath(); c.arc(x, y + r * .12, r * .3, .25, Math.PI - .25); c.stroke();
      } else if (p === 6) {
        c.lineWidth = r * .16;
        for (let i = 0; i < 6; i++) { c.strokeStyle = PCOL[i + 1 & 7]; c.beginPath(); c.arc(x, y, r * .72, rot + i * TAU / 6, rot + (i + 1) * TAU / 6); c.stroke(); }
      } else if (p === 7) { c.lineWidth = r * .14; c.beginPath(); c.arc(x, y, r * .62, 0, TAU); c.stroke(); c.beginPath(); c.arc(x, y, r * .22, 0, TAU); c.fill(); }
      c.lineWidth = Math.max(1, r * .07); c.strokeStyle = 'rgba(0,0,0,.28)';
      c.beginPath(); c.arc(x, y, r - c.lineWidth * .5, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
  }
  const PELLET_R = 6;
  function draw(t, V, guest){
    const c = ctx, W2 = cv.width, H2 = cv.height, z = cam.z * dpr;
    const ox = W2 / 2 - cam.x * z, oy = H2 / 2 - cam.y * z;
    const vx0 = cam.x - W2 / 2 / z, vx1 = cam.x + W2 / 2 / z, vy0 = cam.y - H2 / 2 / z, vy1 = cam.y + H2 / 2 / z;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#05070f'; c.fillRect(0, 0, W2, H2);
    // поле арены и сетка
    const ax0 = Math.max(-H, vx0), ax1 = Math.min(H, vx1), ay0 = Math.max(-H, vy0), ay1 = Math.min(H, vy1);
    if (ax1 > ax0 && ay1 > ay0) {
      c.fillStyle = '#0b1120'; c.fillRect(ox + ax0 * z, oy + ay0 * z, (ax1 - ax0) * z, (ay1 - ay0) * z);
      const gs = z > .5 ? 60 : z > .25 ? 120 : 240;
      c.strokeStyle = 'rgba(148,163,184,.08)'; c.lineWidth = 1;
      c.beginPath();
      for (let x = Math.ceil(ax0 / gs) * gs; x <= ax1; x += gs) { const px = Math.round(ox + x * z) + .5; c.moveTo(px, oy + ay0 * z); c.lineTo(px, oy + ay1 * z); }
      for (let y = Math.ceil(ay0 / gs) * gs; y <= ay1; y += gs) { const py = Math.round(oy + y * z) + .5; c.moveTo(ox + ax0 * z, py); c.lineTo(ox + ax1 * z, py); }
      c.stroke();
    }
    c.strokeStyle = 'rgba(248,113,113,.55)'; c.lineWidth = Math.max(2, 6 * z);
    c.strokeRect(ox - H * z, oy - H * z, 2 * H * z, 2 * H * z);
    if (!V || (guest && !V.ready)) return;
    // еда: по цвету — один путь на цвет
    let zx0 = Math.floor((vx0 + H) / ZONE), zx1 = Math.floor((vx1 + H) / ZONE), zy0 = Math.floor((vy0 + H) / ZONE), zy1 = Math.floor((vy1 + H) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
    const pr = Math.max(1.2, PELLET_R * z);
    for (let col = 0; col < 8; col++) {
      c.fillStyle = PCOL[col]; c.beginPath();
      for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
        const base = (zy * ZN + zx) * KS;
        for (let j = 0; j < KS; j++) {
          const p = base + j;
          if (!V.pAl[p] || ((p * 7 + V.pGen[p]) & 7) !== col) continue;
          const px = ox + V.pX[p] * z, py = oy + V.pY[p] * z;
          c.moveTo(px + pr, py); c.arc(px, py, pr, 0, TAU);
        }
      }
      c.fill();
    }
    // выбросы
    for (let j = 0; j < R.bn; j++) {
      const sk = skins[R.bo[j]];
      c.fillStyle = sk ? sk.a : '#fff';
      c.beginPath(); c.arc(ox + R.bx[j] * z, oy + R.by[j] * z, radius(BLOB_M) * .75 * z, 0, TAU); c.fill();
    }
    // клетки: от маленьких к большим; колючки — поверх маленьких (за ними прячутся), под большими
    const n = R.n;
    for (let k = 0; k < n; k++) R.ord[k] = k;
    for (let k = 1; k < n; k++) { const v = R.ord[k], rv = R.r[v]; let j = k - 1; while (j >= 0 && R.r[R.ord[j]] > rv) { R.ord[j + 1] = R.ord[j]; j--; } R.ord[j + 1] = v; }
    let vDone = false;
    for (let k = 0; k < n; k++) {
      const j = R.ord[k], r = R.r[j];
      if (!vDone && r >= 56) { drawViruses(c, ox, oy, z); vDone = true; }
      const x = R.x[j], y = R.y[j];
      if (x + r < vx0 || x - r > vx1 || y + r < vy0 || y - r > vy1) continue;
      const sk = skins[R.o[j]] || PRESET0;
      const mine = R.o[j] === S.me;
      const eyeA = mine ? Math.atan2(INP[1], INP[0]) : (R.id[j] * 1.7) % TAU;
      drawCell(c, ox + x * z, oy + y * z, r * z, sk, R.id[j], t, 1, eyeA, R.f[j] ? .55 + .25 * Math.sin(t * .012) : 1);
      const sr = r * z;
      if (sr > 13 * dpr) {
        const nm = names[R.o[j]];
        if (nm) {
          const fs = Math.min(96, Math.max(10 * dpr, sr * .34)) | 0;
          c.font = fontPx(fs); c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = Math.max(2, fs * .16); c.strokeStyle = 'rgba(0,0,0,.6)'; c.fillStyle = '#fff';
          const ty = oy + y * z + (sk.p === 5 ? sr * .55 : 0);
          c.strokeText(nm, ox + x * z, ty); c.fillText(nm, ox + x * z, ty);
        }
      }
    }
    if (!vDone) drawViruses(c, ox, oy, z);
    // эмодзи над клетками
    for (let i = 0; i < MAXO; i++) {
      const e = guest ? V.emo[i] : (V.owners[i] && V.owners[i].emoteUntil > V.step ? V.owners[i].emote : 0);
      if (!e) continue;
      let bx = 0, by = 0, br = 0;
      for (let k = 0; k < n; k++) if (R.o[k] === i && R.r[k] > br) { br = R.r[k]; bx = R.x[k]; by = R.y[k]; }
      if (!br) continue;
      const fs = Math.max(18 * dpr, Math.min(96, br * z * .6)) | 0;
      c.font = EFONTS[fs > 96 ? 96 : fs];
      c.textAlign = 'center'; c.textBaseline = 'bottom';
      c.fillText(K.EMOTES[e - 1], ox + bx * z, oy + (by - br) * z - 4 * dpr);
    }
    // мини-карта
    const ms = Math.min(96, cssW * .2) * dpr, mx = 10 * dpr, my = H2 - ms - 10 * dpr;
    c.fillStyle = 'rgba(8,10,20,.55)'; c.fillRect(mx, my, ms, ms);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.strokeRect(mx + .5, my + .5, ms - 1, ms - 1);
    if (myMass > 0) { c.fillStyle = '#fde68a'; c.beginPath(); c.arc(mx + (myCx + H) / (2 * H) * ms, my + (myCy + H) / (2 * H) * ms, 3 * dpr, 0, TAU); c.fill(); }
    if (stick) K.drawStick(c, stick.st, dpr, 'rgba(74,222,128,.6)');
    if (koAt) { c.globalAlpha = clamp((performance.now() - koAt) / 700, 0, 1) * .55; c.fillStyle = '#020208'; c.fillRect(0, 0, W2, H2); c.globalAlpha = 1; }
  }
  const PRESET0 = presetSkin(0);
  function drawViruses(c, ox, oy, z){
    for (let j = 0; j < R.vn; j++) {
      const x = ox + R.vx[j] * z, y = oy + R.vy[j] * z, r = R.vr[j] * z;
      if (x + r * 1.2 < 0 || x - r * 1.2 > cv.width || y + r * 1.2 < 0 || y - r * 1.2 > cv.height) continue;
      c.fillStyle = '#22c55e'; c.strokeStyle = '#14532d'; c.lineWidth = Math.max(2, r * .08);
      c.beginPath();
      const N = 22;
      for (let i = 0; i <= N * 2; i++) { const a = i * Math.PI / N, q = i % 2 ? r : r * 1.12; if (i) c.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else c.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
      c.closePath(); c.fill(); c.stroke();
    }
  }
  function drawIdle(){
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1120'; ctx.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = PCOL[i & 7]; ctx.beginPath(); ctx.arc(((i * 977) % 1000) / 1000 * cv.width, ((i * 571) % 1000) / 1000 * cv.height, 5 * dpr, 0, TAU); ctx.fill(); }
  }
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let lbStr = '';
  function hud(V, guest){
    if (!V || !ui) return;
    const mass = guest ? V.mass : (V.owners[S.me]?.alive ? V.owners[S.me].mass : 0);
    const sc = K.num(mass);
    if (ui.sc.textContent !== sc) ui.sc.textContent = sc;
    const left = Math.max(0, Math.ceil(V.left / SPS));
    const tt = V.phase ? `🏁 ${left}` : `⏱ ${fmtT(left)}`;
    if (ui.time.textContent !== tt) ui.time.textContent = tt;
    const lt = ui.ov.querySelector('.io-left'); if (lt) lt.textContent = String(left);
    const humans = S.humans(), mode2 = S.netMode();
    const net = S.role === 'off' ? '🤖 с ботами' : `${S.code === 'pub1' || /^pub\d$/.test(S.code) ? '🌐 общая' : '🔗 ' + S.code} · 👥 ${humans}${mode2 === 'relay' ? ' · 🐢' : ''}${S.rtt && guest ? ` · ${Math.round(S.rtt)} мс` : ''}`;
    if (ui.net.textContent !== net) ui.net.textContent = net;
    // лидеры
    const n = V.lbN, list = [];
    let key = String(S.me);
    for (let k = 0; k < n; k++) key += ',' + V.lbO[k] + ':' + Math.round(V.lbS[k]);
    if (key !== lbStr) {
      lbStr = key;
      for (let k = 0; k < n; k++) list.push({ i: V.lbO[k], name: names[V.lbO[k]] || '…', score: V.lbS[k], bot: bots[V.lbO[k]], me: V.lbO[k] === S.me });
      ui.lb.innerHTML = K.lbHtml(list);
    }
    let rank = '', tot = 0, r0 = 0;
    if (guest) { r0 = V.rank; tot = V.total; } else { for (let i = 0; i < MAXO; i++) { const o = V.owners[i]; if (o && o.alive) { tot++; if (mass > 0 && o.mass > mass) r0++; } } if (mass > 0) r0++; else r0 = 0; }
    if (r0 > 0) rank = `Место ${r0} из ${tot}`;
    if (ui.rank.textContent !== rank) ui.rank.textContent = rank;
    const ver = guest ? V.ver : V.ver;
    if (ver !== namesVer) { namesVer = ver; syncNames(); }
  }
  let namesVer = -1;
  function sounds(t){
    if (!api?.sfx || !S) return;
    if (myMass > soundMass + 8 && t - soundAt > 160 && soundMass > 0) { api.sfx('tick'); soundAt = t; }
    soundMass = myMass;
  }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.kletochki = {
    mount(el, gameApi){
      host = el; api = gameApi; cfg = loadCfg();
      ui = K.shell(el, { cls: 'kl', color: COLOR, scoreLabel: 'масса', note: 'ПК: мышь — куда плыть, пробел — делиться, W — выброс, 1–8 — эмодзи. Телефон: веди пальцем где угодно, кнопки ✂️ и 💧.',
        padHtml: '<button type="button" class="io-big" data-pad="eject" aria-label="Выброс"><b>💧</b>выброс</button><button type="button" class="io-big big" data-pad="split" aria-label="Делиться"><b>✂️</b>делиться</button>' });
      if (!matchMedia('(pointer: coarse)').matches) ui.pad.classList.add('touch-only');
      cv = ui.cv; ctx = cv.getContext('2d', { alpha: false });
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
      ui.pad.addEventListener('pointerdown', padDown);
      stick = K.touchStick(ui.wrap, { zone: () => mode === 'play' && ui.ov.hidden });
      on(cv, 'pointermove', e => { if (e.pointerType === 'mouse') { const r = cv.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * (cssW / (r.width || 1)); mouse.y = (e.clientY - r.top) * (cssH / (r.height || 1)); mouse.on = true; mouse.t = e.timeStamp; } });
      on(cv, 'pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 2) act('eject', e.timeStamp); });
      on(cv, 'contextmenu', e => e.preventDefault());
      on(window, 'keydown', onKey); on(window, 'keyup', onKey);
      on(window, 'resize', resize);
      on(document, 'visibilitychange', () => S?.hidden(document.hidden));
      on(window, 'd37:fullscreen', () => setTimeout(resize, 60));
      if (window.ResizeObserver) { ro = new ResizeObserver(() => resize()); ro.observe(ui.wrap); }
      resize();
      const p = gameApi.param;
      if (p === 'bots') startBots();
      else if (root.GameRoom?.validCode(p)) startOnline(p, false);
      else menu();
    },
    unmount(){
      stopSession();
      for (const [t, ev, fn, o] of listeners.splice(0)) t.removeEventListener(ev, fn, o);
      ro?.disconnect(); ro = null;
      stick?.off(); stick = null;
      host?.removeEventListener('click', onClick); host?.removeEventListener('change', onChange);
      host = null; ui = null; cv = null; ctx = null; mode = 'menu'; api = null;
    },
    _test: { SIM, PARTS, bodyStats, radius, speedOf, viewArea, mergeSteps, pelletXY, skinOk, presetSkin, PRESETS, PATTERNS,
      C: { DT, H, ZONE, ZN, KS, NP, MAXO, MAXC, START_M, SPLIT_MIN, EJECT_MIN, EJECT_COST, BLOB_M, VIRUS_M, VIRUS_POP, VIRUS_FEEDS, VIR_MIN, PROT, ROUND, END, TOTAL, MINB, A0, MERCY },
      cNew, vNew, bNew, compact, centers, think, leaderboard, R, frame: t => frame(t), get S(){ return S; }, get cam(){ return cam; } },
  };
})();

// ═══════════════════════════════════════
//  «ЧЕРВЯЧКИ» — как slither.io: ползай, ешь огоньки и расти; ускорение тратит длину; врезался головой в чужого червячка —
//  «рассыпаешься на огоньки» (их съедят другие). Без жестокости: затемнение и «Ещё раз».
// ═══════════════════════════════════════
// Раунд 5 минут, потом 8 с итогов и новый раунд. Арена — круг, край не убивает (червячок скользит вдоль). Боты добивают комнату
// до 14 участников (не меньше 2 ботов); новичка первые 20 с не подрезают. Онлайн — js/games/iokit.js (хозяин считает, гости шлют
// управление; снимки двоичные: голова каждый раз, тело — «ключевым кадром» раз в 1,5 с и когда червячок появился в виду; еда —
// только новая и исчезнувшая). Мир — типизированные массивы: путь червячка — кольцо точек через 6 единиц, столкновения — по
// сетке точек тела 74×74, еда — пул; на шаге и кадре новых объектов нет. Шаг 1/30 с, управление — состояние с отметкой времени.
// Ключи сервера: chervyachki (с ботами), chervyachki_online (2+ человека); очки — лучшая длина за жизнь, победа — 1-е место в
// конце раунда (от 3 участников, прожил ≥ 60 с). Монеты — длина/100, до 10 (coin_run_cap). Тесты: scripts/chervyachki-test.cjs.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const K = root.IoKit;
  const { clamp, rnd, hash3, TAU } = K;

  const DT = 1 / 30, SPS = 30, IN = 4;          // вход: [угол, ускорение 0/1, эмодзи (счётчик), номер эмодзи]
  const R = 2200;                                // радиус арены
  const SP = 6, MAXO = 16, MAXP = 1200;          // точки пути — через 6 единиц, до 1200 на червячка
  const ZONE = 200, ZN = 22, KS = 4, NP = ZN * ZN * KS;   // огоньки по зонам 200×200 (внутри круга ~1500)
  const GC = 60, GN = Math.ceil(2 * R / GC);     // сетка точек тела
  const FGC = 100, FGN = Math.ceil(2 * R / FGC); // сетка рассыпанной еды
  const FCAP = 1600, PCAP = MAXO * (MAXP >> 1);
  const L0 = 10, BOOST_MIN = 16, SPEED = 165, BOOSTV = 330, MAX_L = 30000;
  const PROT = 2 * SPS, ROUND = 300 * SPS, END = 8 * SPS, MERCY = 20 * SPS, FOOD_LIFE = 30 * SPS;
  const TOTAL = 14, MINB = 2;
  const A0 = 650000;                             // площадь обзора у новичка — одинаковая на телефоне и ПК

  const rwOf = L => 6 + .55 * Math.sqrt(L);
  const bodyLen = L => Math.min((MAXP - 4) * SP, 40 + 9.5 * Math.pow(L, .72));
  const turnOf = L => 4.6 / (1 + L / 2500);
  const boostCost = L => 1.5 + L * .0055;
  const viewScale = L => clamp(1 + (rwOf(L) - rwOf(L0)) / 26, 1, 2.6);
  const viewArea = L => { const s = viewScale(L); return A0 * s * s; };
  const wrapA = a => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };

  // ═══ Раскраски (бесплатно): узор + 2 цвета ═══
  const PATTERNS = ['Однотонный', 'Полоски', 'Горошек', 'Пунктир', 'Радуга', 'Неон', 'Глазастик', 'Тигр'];
  const PRESETS = [[1, '#a855f7', '#fde68a'], [0, '#22c55e', '#14532d'], [2, '#f97316', '#ffffff'], [4, '#f472b6', '#ffffff'], [5, '#0f172a', '#22d3ee'], [7, '#facc15', '#1f2937'],
    [1, '#38bdf8', '#1e3a8a'], [6, '#f87171', '#7f1d1d'], [3, '#4ade80', '#fef08a'], [2, '#a78bfa', '#312e81'], [1, '#fb7185', '#fde047'], [5, '#111827', '#f472b6']];
  function skinOk(s){
    if (!s || typeof s !== 'object') return null;
    const p = clamp(s.p | 0, 0, PATTERNS.length - 1), a = K.okColor(s.a), b = K.okColor(s.b);
    return a && b ? { p, a, b } : null;
  }
  const presetSkin = i => { const q = PRESETS[((i % PRESETS.length) + PRESETS.length) % PRESETS.length]; return { p: q[0], a: q[1], b: q[2] }; };
  // Цвета огоньков: 16 штук; рассыпанный червячок — ближайший к своему цвету
  const FCOL = ['#f87171', '#fb923c', '#facc15', '#a3e635', '#4ade80', '#2dd4bf', '#22d3ee', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#f472b6', '#fda4af', '#fde68a', '#ffffff', '#94a3b8'];
  const FRGB = FCOL.map(h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
  function colIdx(hex){
    const n = parseInt(String(hex || '#ffffff').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    let bi = 0, bd = 1e9;
    for (let i = 0; i < FRGB.length; i++) { const q = FRGB[i], d = (q[0] - r) ** 2 + (q[1] - g) ** 2 + (q[2] - b) ** 2; if (d < bd) { bd = d; bi = i; } }
    return bi;
  }
  const BOT_NAMES = ['Шнурок', 'Лапша', 'Макаронина', 'Спагетти', 'Мармеладка', 'Зигзаг', 'Молния', 'Неон', 'Радуга', 'Червячок Гоша', 'Удав Боря', 'Пружинка',
    'Ниточка', 'Карамелька', 'Змейка', 'Шустрик', 'Батончик', 'Фонарик', 'Огонёк', 'Колбаска', 'Жвачка', 'Канат', 'Сосиска', 'Леденец'];

  // ═══════════════════ МИР ═══════════════════
  function newWorld(seed){
    seed = (seed | 0) || 1;
    const W = { v: 1, seed, rs: seed, step: 0, round: 1, phase: 0, left: ROUND, humans: 1, botWant: TOTAL - 1, ev: [], ver: 0, nextId: 1,
      owners: new Array(MAXO).fill(null), maxRw: 0,
      // путь каждого червячка — кольцо: wh — последняя (самая свежая) точка, wn — сколько точек
      wx: new Float64Array(MAXO * MAXP), wy: new Float64Array(MAXO * MAXP), wh: new Int32Array(MAXO), wn: new Int32Array(MAXO),
      // огоньки по зонам (место — по зерну, номеру и поколению; ценность — по номеру)
      pSeed: 0, pOn: new Uint8Array(NP), pAl: new Uint8Array(NP), pGen: new Uint8Array(NP), pAt: new Int32Array(NP), pX: new Float32Array(NP), pY: new Float32Array(NP), pV: new Uint8Array(NP), zv: new Uint16Array(ZN * ZN),
      // рассыпанная еда (от червячков и ускорения)
      fN: 0, fL: new Int16Array(FCAP), fF: new Int16Array(FCAP), fFN: 0, fId: new Uint16Array(FCAP), fX: new Float64Array(FCAP), fY: new Float64Array(FCAP),
      fV: new Float32Array(FCAP), fC: new Uint8Array(FCAP), fDie: new Int32Array(FCAP), fDead: new Uint8Array(FCAP),
      // сетки
      gH: new Int32Array(GN * GN), gNext: new Int32Array(PCAP), gO: new Int8Array(PCAP), gX: new Float32Array(PCAP), gY: new Float32Array(PCAP), gCnt: 0,
      fgH: new Int16Array(FGN * FGN), fgN: new Int16Array(FCAP),
      lbO: new Int8Array(10), lbS: new Float64Array(10), lbN: 0, lbMark: new Uint8Array(MAXO),
      eq: new Float32Array(256 * 4), eqN: 0 };
    for (let i = 0; i < FCAP; i++) W.fF[W.fFN++] = FCAP - 1 - i;
    W.gH.fill(-1); W.fgH.fill(-1);
    W.pSeed = (rnd(W) * 2147483647) | 0;
    for (let p = 0; p < NP; p++) {
      const z = (p / KS) | 0, cx = (z % ZN) * ZONE - R + ZONE / 2, cy = ((z / ZN) | 0) * ZONE - R + ZONE / 2;
      W.pOn[p] = cx * cx + cy * cy < (R - 140) * (R - 140) ? 1 : 0;
      const h = hash3(911, p, 7);
      W.pV[p] = h < .72 ? 1 : h < .95 ? 2 : 3;
    }
    resetPellets(W);
    return W;
  }
  function resetPellets(W){
    for (let p = 0; p < NP; p++) { W.pGen[p] = 0; W.pAl[p] = W.pOn[p]; pelletXY(W.pSeed, p, 0, W.pX, W.pY, p); }
    for (let z = 0; z < ZN * ZN; z++) W.zv[z]++;
  }
  function pelletXY(pseed, p, gen, ax, ay, at){
    const z = (p / KS) | 0, zx = z % ZN, zy = (z / ZN) | 0;
    ax[at] = zx * ZONE - R + (.08 + .84 * hash3(pseed, p, gen * 2)) * ZONE;
    ay[at] = zy * ZONE - R + (.08 + .84 * hash3(pseed, p, gen * 2 + 1)) * ZONE;
  }
  function nextId(W){ const id = W.nextId; W.nextId = id >= 65535 ? 1 : id + 1; return id; }
  function fNew(W, x, y, v, c, life){
    if (!W.fFN) {   // пул полон — самая старая еда уступает
      let old = -1, od = 1e9;
      for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; if (!W.fDead[s] && W.fDie[s] < od) { od = W.fDie[s]; old = s; } }
      if (old < 0) return -1;
      W.fDead[old] = 1; compactFood(W);
      if (!W.fFN) return -1;
    }
    const s = W.fF[--W.fFN];
    W.fL[W.fN++] = s;
    const lim = R - 30, d = Math.sqrt(x * x + y * y);
    if (d > lim) { x = x / d * lim; y = y / d * lim; }
    W.fId[s] = nextId(W); W.fX[s] = x; W.fY[s] = y; W.fV[s] = v; W.fC[s] = c; W.fDie[s] = W.step + life; W.fDead[s] = 0;
    return s;
  }
  function compactFood(W){ for (let k = 0; k < W.fN;) { const s = W.fL[k]; if (W.fDead[s]) { W.fF[W.fFN++] = s; W.fL[k] = W.fL[--W.fN]; } else k++; } }

  // ── Участники ──
  function newOwner(W, i, o){
    const bot = !!o.bot, skin = skinOk(o.skin) || presetSkin((rnd(W) * 1000) | 0);
    return { i, key: String(o.key || '').slice(0, 80), name: String(o.name || 'Игрок').slice(0, 24), skin, ci: colIdx(skin.a), bot,
      alive: false, wantSpawn: !!o.spawn, spawnAt: 0, retire: 0, gotIn: bot,
      inA: 0, inB: 0, inEm: 0, inEmId: 0, lem: -1, emote: 0, emoteUntil: 0, emoteAt: -1e6,
      x: 0, y: 0, hx0: 0, hy0: 0, a: 0, L: 0, prot: 0, boost: false, spent: 0, spawnStep: 0,
      best: 0, kills: 0, life: 0, lastBy: -1, deadX: 0, deadY: 0, bx0: 0, by0: 0, bx1: 0, by1: 0, rw: rwOf(L0),
      brain: bot ? { aggr: .1 + rnd(W) * .8, greed: .8 + rnd(W) * .6, every: 3 + ((rnd(W) * 3) | 0), huntT: 0, prey: -1, wa: 0, wt: 0 } : null };
  }
  function addOwner(W, o){
    let i = -1;
    for (let k = 0; k < MAXO; k++) if (!W.owners[k]) { i = k; break; }
    if (i < 0 && !o.bot) {   // мест нет — человеку уступает бот
      let v = -1, vm = 1e18;
      for (let k = 0; k < MAXO; k++) { const q = W.owners[k]; if (!q || !q.bot) continue; const m = q.retire ? -1 : q.alive ? q.L : 0; if (m < vm) { vm = m; v = k; } }
      if (v >= 0) { dropOwner(W, v); i = v; }
    }
    if (i < 0) return -1;
    W.owners[i] = newOwner(W, i, o);
    W.wn[i] = 0;
    W.ver++;
    return i;
  }
  function dropOwner(W, i){ if (!W.owners[i]) return; W.owners[i] = null; W.wn[i] = 0; W.ver++; }
  function setOwner(W, i, o){
    const ow = W.owners[i];
    if (!ow) return;
    if (o.name) ow.name = String(o.name).slice(0, 24);
    const sk = skinOk(o.skin);
    if (sk) { ow.skin = sk; ow.ci = colIdx(sk.a); }
    W.ver++;
  }
  function setInput(W, i, a){
    const o = W.owners[i];
    if (!o || !a) return;
    const ang = +a[0];
    o.inA = isFinite(ang) ? wrapA(ang) : o.inA; o.inB = a[1] ? 1 : 0; o.inEm = +a[2] || 0; o.inEmId = a[3] | 0; o.gotIn = true;
  }
  function respawn(W, i){ const o = W.owners[i]; if (o && !o.alive && W.phase === 0) { o.wantSpawn = true; o.spawnAt = W.step; } }
  function setHumans(W, n){
    W.humans = clamp(n | 0, 0, MAXO);
    W.botWant = clamp(TOTAL - W.humans, MINB, MAXO - W.humans);
    let bots = 0;
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.bot && !o.retire) bots++; }
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
  function manageBots(W){
    let bots = 0, small = -1, sm = 1e18, back = -1;
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.bot) continue;
      if (o.retire) { if (!o.alive || W.step - o.retire > 20 * SPS) dropOwner(W, i); else if (back < 0) back = i; continue; }
      bots++;
      const m = o.alive ? o.L : 0;
      if (m < sm) { sm = m; small = i; }
    }
    if (bots < W.botWant) { if (back >= 0) W.owners[back].retire = 0; else addOwner(W, { key: 'bot', name: botName(W), skin: null, bot: true, spawn: true }); }
    else if (bots > W.botWant && small >= 0) W.owners[small].retire = W.step;
  }

  // ── Появиться: лучшее из 12 мест — подальше от голов и тел; тело — прямо назад ──
  function spawnOwner(W, o){
    let bx = 0, by = 0, best = -1e9;
    for (let t = 0; t < 12; t++) {
      const a = rnd(W) * TAU, d = Math.sqrt(rnd(W)) * (R * .82);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      let dmin = 1e9;
      for (let j = 0; j < MAXO; j++) {
        const q = W.owners[j];
        if (!q || !q.alive) continue;
        const base = j * MAXP, n = W.wn[j];
        for (let k = 0; k < n; k += 6) { const s = base + ((W.wh[j] - k + MAXP) % MAXP), dx = W.wx[s] - x, dy = W.wy[s] - y, dd = dx * dx + dy * dy; if (dd < dmin) dmin = dd; }
        const dx = q.x - x, dy = q.y - y, dd = (dx * dx + dy * dy) * .5;   // голову — ещё дальше
        if (dd < dmin) dmin = dd;
      }
      if (dmin > best) { best = dmin; bx = x; by = y; }
    }
    const a = Math.atan2(-by, -bx) + (rnd(W) - .5) * 2.2;   // носом примерно к центру
    o.x = o.hx0 = bx; o.y = o.hy0 = by; o.a = a; o.L = L0; o.boost = false; o.spent = 0;
    o.alive = true; o.wantSpawn = false; o.prot = W.step + PROT; o.spawnStep = W.step;
    o.best = L0; o.kills = 0; o.life = W.step; o.lastBy = -1; o.rw = rwOf(L0); o.inA = a;
    const base = o.i * MAXP, n = Math.ceil(bodyLen(L0) / SP) + 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 0; k < n; k++) { const s = base + (n - 1 - k); W.wx[s] = bx - ca * k * SP; W.wy[s] = by - sa * k * SP; }
    W.wh[o.i] = n - 1; W.wn[o.i] = n;
    bbox(W, o);
    return true;
  }
  function bbox(W, o){
    const i = o.i, base = i * MAXP, n = W.wn[i], h = W.wh[i];
    let x0 = o.x, y0 = o.y, x1 = o.x, y1 = o.y;
    for (let k = 0; k < n; k += 3) { const s = base + ((h - k + MAXP) % MAXP), x = W.wx[s], y = W.wy[s]; if (x < x0) x0 = x; else if (x > x1) x1 = x; if (y < y0) y0 = y; else if (y > y1) y1 = y; }
    o.bx0 = x0 - o.rw; o.by0 = y0 - o.rw; o.bx1 = x1 + o.rw; o.by1 = y1 + o.rw;
  }

  // ═══ ШАГ МИРА ═══
  function step(W){
    W.step++;
    if (W.phase === 1) { if (--W.left <= 0) startRound(W); return; }
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o) { o.hx0 = o.x; o.hy0 = o.y; } }
    if (W.step % SPS === 0) manageBots(W);
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && !o.alive && o.wantSpawn && !o.retire && W.step >= o.spawnAt) spawnOwner(W, o); }
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.bot && o.alive && (W.step + i) % o.brain.every === 0) think(W, o); }
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o) { emote(W, o); if (o.alive) move(W, o); } }
    for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; if (W.fDie[s] <= W.step) W.fDead[s] = 1; }
    compactFood(W);
    foodGrid(W);
    eat(W);
    pointGrid(W);
    collide(W);
    compactFood(W);
    for (let p = 0; p < NP; p++) if (!W.pAl[p] && W.pOn[p] && W.pAt[p] <= W.step) { W.pAl[p] = 1; pelletXY(W.pSeed, p, W.pGen[p], W.pX, W.pY, p); W.zv[(p / KS) | 0]++; }
    let maxRw = 0;
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.alive) { if (o.L > o.best) o.best = o.L; if (o.rw > maxRw) maxRw = o.rw; } }
    W.maxRw = maxRw;
    if (W.step % 15 === 0) leaderboard(W);
    if (--W.left <= 0) endRound(W);
  }
  function emote(W, o){
    if (!o.gotIn) return;
    if (o.lem < 0) { o.lem = o.inEm; return; }
    if (o.inEm === o.lem) return;
    o.lem = o.inEm;
    if (o.inEmId >= 1 && o.inEmId <= K.EMOTES.length && W.step - o.emoteAt >= 45) { o.emote = o.inEmId; o.emoteUntil = W.step + 75; o.emoteAt = W.step; }
  }
  function move(W, o){
    const i = o.i, base = i * MAXP;
    // поворот к цели — не быстрее, чем позволяет длина
    const tr = turnOf(o.L) * DT, d = wrapA(o.inA - o.a);
    o.a = wrapA(o.a + (d > tr ? tr : d < -tr ? -tr : d));
    // ускорение: тратит длину, позади падают огоньки (чуть меньше потраченного)
    o.boost = !!o.inB && o.L >= BOOST_MIN;
    let v = SPEED;
    if (o.boost) {
      v = BOOSTV;
      const c = boostCost(o.L) * DT;
      o.L -= c; o.spent += c;
      if (o.spent >= .6 && W.step % 6 === 0) {
        const t = base + ((W.wh[i] - (W.wn[i] - 1) + MAXP) % MAXP);
        fNew(W, W.wx[t] + (rnd(W) - .5) * o.rw, W.wy[t] + (rnd(W) - .5) * o.rw, o.spent * .55, o.ci, FOOD_LIFE);
        o.spent = 0;
      }
    }
    o.x += Math.cos(o.a) * v * DT; o.y += Math.sin(o.a) * v * DT;
    // край арены: скользим вдоль
    const lim = R - o.rw, dd = o.x * o.x + o.y * o.y;
    if (dd > lim * lim) {
      const dl = Math.sqrt(dd), nx = o.x / dl, ny = o.y / dl;
      o.x = nx * lim; o.y = ny * lim;
      const ca = Math.cos(o.a), sa = Math.sin(o.a);
      if (ca * nx + sa * ny > 0) { const tx = -ny, ty = nx, s = ca * tx + sa * ty >= 0 ? 1 : -1; o.a = Math.atan2(ty * s - ny * .15, tx * s - nx * .15); }
    }
    // путь: точки ровно через SP
    let h = W.wh[i], n = W.wn[i];
    let lx = W.wx[base + h], ly = W.wy[base + h];
    let dx = o.x - lx, dy = o.y - ly, dl = Math.sqrt(dx * dx + dy * dy);
    while (dl >= SP) {
      lx += dx / dl * SP; ly += dy / dl * SP;
      h = h + 1 === MAXP ? 0 : h + 1;
      W.wx[base + h] = lx; W.wy[base + h] = ly;
      if (n < MAXP) n++;
      dx = o.x - lx; dy = o.y - ly; dl = Math.sqrt(dx * dx + dy * dy);
    }
    W.wh[i] = h;
    const need = Math.min(MAXP, Math.ceil(bodyLen(o.L) / SP) + 2);
    W.wn[i] = n > need ? need : n;
    o.rw = rwOf(o.L);
    if ((W.step + i) % 3 === 0) bbox(W, o);
  }
  function foodGrid(W){
    W.fgH.fill(-1);
    for (let k = 0; k < W.fN; k++) {
      const s = W.fL[k];
      let gx = Math.floor((W.fX[s] + R) / FGC), gy = Math.floor((W.fY[s] + R) / FGC);
      if (gx < 0) gx = 0; else if (gx >= FGN) gx = FGN - 1;
      if (gy < 0) gy = 0; else if (gy >= FGN) gy = FGN - 1;
      const b = gy * FGN + gx;
      W.fgN[s] = W.fgH[b]; W.fgH[b] = s;
    }
  }
  function eat(W){
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.alive) continue;
      const x = o.x, y = o.y, re = o.rw * 1.6 + 8;
      let zx0 = Math.floor((x - re + R) / ZONE), zx1 = Math.floor((x + re + R) / ZONE), zy0 = Math.floor((y - re + R) / ZONE), zy1 = Math.floor((y + re + R) / ZONE);
      if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
      for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
        const base = (zy * ZN + zx) * KS;
        for (let j = 0; j < KS; j++) {
          const p = base + j;
          if (!W.pAl[p]) continue;
          const dx = W.pX[p] - x, dy = W.pY[p] - y;
          if (dx * dx + dy * dy >= re * re) continue;
          W.pAl[p] = 0; W.pGen[p] = (W.pGen[p] + 1) & 7; W.pAt[p] = W.step + 75 + ((rnd(W) * 150) | 0); W.zv[(p / KS) | 0]++;
          o.L = Math.min(MAX_L, o.L + W.pV[p]);
          eaten(W, W.pX[p], W.pY[p], (p * 5 + ((W.pGen[p] - 1) & 7)) & 15, i);
        }
      }
      let gx0 = Math.floor((x - re + R) / FGC), gx1 = Math.floor((x + re + R) / FGC), gy0 = Math.floor((y - re + R) / FGC), gy1 = Math.floor((y + re + R) / FGC);
      if (gx0 < 0) gx0 = 0; if (gy0 < 0) gy0 = 0; if (gx1 >= FGN) gx1 = FGN - 1; if (gy1 >= FGN) gy1 = FGN - 1;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) for (let s = W.fgH[gy * FGN + gx]; s !== -1; s = W.fgN[s]) {
        if (W.fDead[s]) continue;
        const dx = W.fX[s] - x, dy = W.fY[s] - y;
        if (dx * dx + dy * dy >= re * re) continue;
        W.fDead[s] = 1;
        o.L = Math.min(MAX_L, o.L + W.fV[s]);
        eaten(W, W.fX[s], W.fY[s], W.fC[s], i);
      }
    }
  }
  // Съеденное — в кольцо для рисунка («втягивается» в голову): только картинка, на мир не влияет
  function eaten(W, x, y, c, by){ const k = (W.eqN++ & 255) * 4; W.eq[k] = x; W.eq[k + 1] = y; W.eq[k + 2] = c; W.eq[k + 3] = by; }
  // Сетка точек тел (каждая 2-я точка, без «шеи» у головы); защищённые (только появились) — «призраки»
  function pointGrid(W){
    W.gH.fill(-1);
    let c = 0;
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.alive || o.prot > W.step) continue;
      const base = i * MAXP, n = W.wn[i], h = W.wh[i], neck = Math.ceil(o.rw * 2.2 / SP);
      for (let k = neck; k < n && c < PCAP; k += 2) {
        const s = base + ((h - k + MAXP) % MAXP), x = W.wx[s], y = W.wy[s];
        let gx = Math.floor((x + R) / GC), gy = Math.floor((y + R) / GC);
        if (gx < 0) gx = 0; else if (gx >= GN) gx = GN - 1;
        if (gy < 0) gy = 0; else if (gy >= GN) gy = GN - 1;
        const b = gy * GN + gx;
        W.gX[c] = x; W.gY[c] = y; W.gO[c] = i; W.gNext[c] = W.gH[b]; W.gH[b] = c;
        c++;
      }
    }
    W.gCnt = c;
  }
  const GR = new Int32Array(4);
  function gRange(x, y, r){
    let x0 = Math.floor((x - r + R) / GC), x1 = Math.floor((x + r + R) / GC), y0 = Math.floor((y - r + R) / GC), y1 = Math.floor((y + r + R) / GC);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 >= GN) x1 = GN - 1; if (y1 >= GN) y1 = GN - 1;
    GR[0] = x0; GR[1] = x1; GR[2] = y0; GR[3] = y1;
  }
  // Кто в кого врезался: голова в чужое тело — нокаут; голова в голову — короче уступает (почти равные — разворачиваются)
  const DIE = new Int8Array(MAXO);
  function collide(W){
    DIE.fill(-2);
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o || !o.alive || o.prot > W.step) continue;
      gRange(o.x, o.y, o.rw + W.maxRw);
      const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
      let hit = -2;
      for (let gy = y0; gy <= y1 && hit === -2; gy++) for (let gx = x0; gx <= x1 && hit === -2; gx++) for (let c = W.gH[gy * GN + gx]; c !== -1; c = W.gNext[c]) {
        const j = W.gO[c];
        if (j === i) continue;
        const q = W.owners[j], lim = (o.rw + q.rw) * .82, dx = W.gX[c] - o.x, dy = W.gY[c] - o.y;
        if (dx * dx + dy * dy < lim * lim) { hit = j; break; }
      }
      if (hit !== -2) DIE[i] = hit;
    }
    for (let i = 0; i < MAXO; i++) {
      const a = W.owners[i];
      if (!a || !a.alive || a.prot > W.step || DIE[i] !== -2) continue;
      for (let j = i + 1; j < MAXO; j++) {
        const b = W.owners[j];
        if (!b || !b.alive || b.prot > W.step || DIE[j] !== -2) continue;
        const dx = b.x - a.x, dy = b.y - a.y, lim = (a.rw + b.rw) * .9;
        if (dx * dx + dy * dy >= lim * lim) continue;
        if (a.L > b.L * 1.05) DIE[j] = i;
        else if (b.L > a.L * 1.05) DIE[i] = j;
        else { const ang = Math.atan2(dy, dx); a.a = wrapA(ang + Math.PI); a.inA = a.a; b.a = wrapA(ang); b.inA = b.a; }
      }
    }
    for (let i = 0; i < MAXO; i++) if (DIE[i] !== -2) knockout(W, W.owners[i], DIE[i]);
  }
  // Нокаут: червячок рассыпается на огоньки (¾ длины) вдоль тела
  function knockout(W, o, by){
    const i = o.i, base = i * MAXP, n = W.wn[i], h = W.wh[i];
    const total = Math.max(6, o.L * .75), cnt = clamp(Math.round(total / 4), 4, 120), v = total / cnt;
    for (let k = 0; k < cnt; k++) {
      const pk = Math.min(n - 1, Math.floor(k * n / cnt)), s = base + ((h - pk + MAXP) % MAXP);
      fNew(W, W.wx[s] + (rnd(W) - .5) * o.rw * 1.2, W.wy[s] + (rnd(W) - .5) * o.rw * 1.2, v, o.ci, FOOD_LIFE + ((rnd(W) * 240) | 0));
    }
    o.alive = false; o.deadX = o.x; o.deadY = o.y; W.wn[i] = 0;
    if (by >= 0 && W.owners[by]) W.owners[by].kills++;
    W.ev.push({ k: 'ko', o: i, by, best: Math.round(o.best), kills: o.kills, life: Math.round((W.step - o.life) / SPS), round: W.round });
    if (o.bot) { o.wantSpawn = true; o.spawnAt = W.step + 45 + ((rnd(W) * 90) | 0); } else o.wantSpawn = false;
  }
  function leaderboard(W){
    W.lbN = 0; W.lbMark.fill(0);
    for (let k = 0; k < 10; k++) {
      let bi = -1, bm = 0;
      for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (!o || !o.alive || W.lbMark[i]) continue; if (o.L > bm) { bm = o.L; bi = i; } }
      if (bi < 0) break;
      W.lbMark[bi] = 1; W.lbO[k] = bi; W.lbS[k] = bm; W.lbN++;
    }
  }
  function endRound(W){
    leaderboard(W);
    W.phase = 1; W.left = END;
    const rank = [];
    for (let k = 0; k < W.lbN; k++) rank.push([W.lbO[k], Math.round(W.lbS[k])]);
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; if (o && o.alive && !rank.some(r => r[0] === i)) rank.push([i, Math.round(o.L)]); }
    rank.sort((a, b) => b[1] - a[1]);
    let n = 0; for (let i = 0; i < MAXO; i++) if (W.owners[i]) n++;
    const best = rank.map(r => { const o = W.owners[r[0]]; return [r[0], r[1], o ? Math.round(o.best) : r[1], o ? Math.round((W.step - o.life) / SPS) : 0]; });
    W.ev.push({ k: 'end', n: W.round, rank: best, total: n, names: best.slice(0, 3).map(r => [W.owners[r[0]]?.name || '', W.owners[r[0]]?.bot ? 1 : 0]) });
  }
  function startRound(W){
    for (let k = 0; k < W.fN; k++) W.fDead[W.fL[k]] = 1;
    compactFood(W);
    W.round++; W.phase = 0; W.left = ROUND;
    W.pSeed = (rnd(W) * 2147483647) | 0;
    resetPellets(W);
    let n = 0;
    for (let i = 0; i < MAXO; i++) {
      const o = W.owners[i];
      if (!o) continue;
      o.alive = false; W.wn[i] = 0; o.wantSpawn = !o.retire; o.spawnAt = W.step + (o.bot ? 2 + n * 2 : 1); o.best = 0; o.kills = 0; o.L = 0;
      n++;
    }
    W.ev.push({ k: 'start', n: W.round });
  }

  // ═══ Бот: раз в 3–5 шагов пробует 9 направлений — опасность (тела, край) и еда; новичка первые 20 с не подрезает ═══
  const FB = new Float64Array(64 * 3);
  function think(W, o){
    const B = o.brain, x = o.x, y = o.y, rw = o.rw;
    // еда рядом — в черновик (до 64)
    let nf = 0;
    const FR = 330;
    let zx0 = Math.floor((x - FR + R) / ZONE), zx1 = Math.floor((x + FR + R) / ZONE), zy0 = Math.floor((y - FR + R) / ZONE), zy1 = Math.floor((y + FR + R) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
    for (let zy = zy0; zy <= zy1 && nf < 64; zy++) for (let zx = zx0; zx <= zx1 && nf < 64; zx++) {
      const base = (zy * ZN + zx) * KS;
      for (let j = 0; j < KS && nf < 64; j++) { const p = base + j; if (!W.pAl[p]) continue; FB[nf * 3] = W.pX[p]; FB[nf * 3 + 1] = W.pY[p]; FB[nf * 3 + 2] = W.pV[p]; nf++; }
    }
    let gx0 = Math.floor((x - FR + R) / FGC), gx1 = Math.floor((x + FR + R) / FGC), gy0 = Math.floor((y - FR + R) / FGC), gy1 = Math.floor((y + FR + R) / FGC);
    if (gx0 < 0) gx0 = 0; if (gy0 < 0) gy0 = 0; if (gx1 >= FGN) gx1 = FGN - 1; if (gy1 >= FGN) gy1 = FGN - 1;
    let rich = 0;
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) for (let s = W.fgH[gy * FGN + gx]; s !== -1; s = W.fgN[s]) {
      if (W.fDead[s]) continue;
      rich += W.fV[s];
      if (nf < 64) { FB[nf * 3] = W.fX[s]; FB[nf * 3 + 1] = W.fY[s]; FB[nf * 3 + 2] = W.fV[s] * 1.3; nf++; }
    }
    // охота: изредка подрезать того, кто короче (не новичка-человека, не «призрака»)
    if (B.huntT > 0) { B.huntT -= B.every; const q = W.owners[B.prey]; if (!q || !q.alive || q.prot > W.step || q.L * 1.2 > o.L) B.huntT = 0; }
    else if (o.L > 45 && rnd(W) < B.aggr * .03) {
      let pi = -1, pd = 260 * 260;
      for (let j = 0; j < MAXO; j++) {
        const q = W.owners[j];
        if (!q || j === o.i || !q.alive || q.prot > W.step || q.L * 1.2 > o.L) continue;
        if (!q.bot && W.step - q.life < MERCY) continue;
        const dx = q.x - x, dy = q.y - y, d = dx * dx + dy * dy;
        if (d < pd) { pd = d; pi = j; }
      }
      if (pi >= 0) { B.prey = pi; B.huntT = 45 + ((rnd(W) * 30) | 0); }
    }
    const look = 60 + rw * 2.5 + (o.boost ? 120 : 50), ca = W.maxRw + rw + 8;
    let bestS = -1e18, bestA = o.a, bestD = 0, straightD = 0;
    const careless = rnd(W) < .01;   // иногда бот ошибается — и тоже рассыпается
    for (let c = -4; c <= 4; c++) {
      const da = o.a + c * .33, cx = Math.cos(da), cy = Math.sin(da);
      let danger = 0;
      for (let j = 1; j <= 5; j++) {
        const dist = rw + j * look / 5, sx = x + cx * dist, sy = y + cy * dist, w2 = (6 - j) * (6 - j);
        if (sx * sx + sy * sy > (R - rw - 20) * (R - rw - 20)) { danger += w2 * 1.5; continue; }
        gRange(sx, sy, ca);
        const x0 = GR[0], x1 = GR[1], y0 = GR[2], y1 = GR[3];
        let hit = false;
        for (let gy = y0; gy <= y1 && !hit; gy++) for (let gx = x0; gx <= x1 && !hit; gx++) for (let q = W.gH[gy * GN + gx]; q !== -1; q = W.gNext[q]) {
          const oj = W.gO[q], qo = W.owners[oj];
          if (oj === o.i || !qo) continue;
          const lim = rw + qo.rw + 10, dx = W.gX[q] - sx, dy = W.gY[q] - sy;
          if (dx * dx + dy * dy < lim * lim) { hit = true; break; }
        }
        if (hit) danger += w2;
      }
      if (careless) danger = 0;
      let food = 0;
      for (let f = 0; f < nf; f++) {
        const fx = FB[f * 3] - x, fy = FB[f * 3 + 1] - y, d = Math.sqrt(fx * fx + fy * fy) || 1;
        const cos = (fx * cx + fy * cy) / d;
        if (cos > .88) food += FB[f * 3 + 2] / Math.max(30, d);
      }
      let score = food * 40 * B.greed - danger * 3 - Math.abs(c) * .15;
      if (B.huntT > 0) {
        const q = W.owners[B.prey], lx = q.x + Math.cos(q.a) * 90 - x, ly = q.y + Math.sin(q.a) * 90 - y, d = Math.sqrt(lx * lx + ly * ly) || 1;
        score += ((lx * cx + ly * cy) / d) * 6;
      }
      if (score > bestS) { bestS = score; bestA = da; bestD = danger; }
      if (c === 0) straightD = danger;
    }
    // некуда ехать — бродить
    if (bestS < .05 && bestD === 0 && nf === 0) { if (W.step >= B.wt) { B.wa = wrapA(o.a + (rnd(W) - .5) * 2); B.wt = W.step + 45 + ((rnd(W) * 60) | 0); } bestA = B.wa; }
    o.inA = wrapA(bestA);
    o.inB = (straightD >= 16 && bestD >= 9 && o.L > 30) || (B.huntT > 0 && o.L > 50) || (rich > 30 && o.L > 60 && rnd(W) < .15) ? 1 : 0;
  }

  // ═══════════════════ СЕТЬ: снимок для гостя ═══════════════════
  // u8 2 · u8 флаги (1 — лидеры, 2 — итоги, 4 — эхо, 8 — сверка еды) · u32 шаг · u16 раунд · u16 осталось (0,1 с) · u8 я · u32 моя длина ·
  // u32 зерно · [u32 эхо, u16 задержка] · u8 червячков × (хозяин u8, x·4, y·4, угол u16, длина u16, флаги u8 (1 ускор., 2 призрак, 4 тело))
  //   [тело: u16 n и n × (dx, dy) i8 ·4 — каждая 3-я точка от головы] · u16 новой еды × 8 Б (id, x·4, y·4, ценность·8, цвет)
  // · u16 исчезнувшей × 2 Б (id) · [сверка: прямоугольник i16 × 4 и u16 id × n — всё, что есть в нём] · u16 зон огоньков × 4 Б ·
  // u8 эмодзи × 2 Б · [лидеры]. Еда и зоны — по разнице с тем, что гость уже получил (+ всё видимое раз в 2 с).
  function encode(W, i, g){
    const w = g.w || (g.w = K.writer(4096));
    w.o = 0;
    if (!g.kf) { g.kf = new Int32Array(MAXO).fill(-1e9); g.seen = new Uint8Array(MAXO); g.sp = new Int32Array(MAXO).fill(-1); g.known = new Uint16Array(FCAP); g.zv = new Uint16Array(ZN * ZN).fill(65535); g.sn = (kfSeq * 7) % 30; g.kfo = kfSeq++ % 11; }
    const echo = g.inTs >= 0;
    const o = W.owners[i];
    const cx = o ? (o.alive ? o.x : o.deadX) : 0, cy = o ? (o.alive ? o.y : o.deadY) : 0;
    const asp = clamp(g.aspect || 1.6, .3, 3.5), vh = Math.sqrt(viewArea(o && o.alive ? o.L : L0) / asp);
    const hw = vh * asp * .6 + 140, hh = vh * .6 + 140;
    const sn = g.sn = (g.sn + 1) % 30;
    const lb = !g.lbAt || W.step - g.lbAt >= 15;
    if (lb) g.lbAt = W.step;
    const sync = sn === 0;
    w.u8(2);
    w.u8((lb ? 1 : 0) | (W.phase ? 2 : 0) | (echo ? 4 : 0) | (sync ? 8 : 0));
    w.u32(W.step); w.u16(W.round); w.u16(Math.ceil(W.left / 3)); w.u8(o ? i : 255); w.u32(o && o.alive ? o.L : 0); w.u32(W.pSeed >>> 0);
    if (echo) { w.u32(g.inTs); w.u16(Math.min(65535, Math.max(0, g.hold | 0))); }
    // червячки
    let at = w.at(), n = 0;
    w.u8(0);
    for (let j = 0; j < MAXO; j++) {
      const q = W.owners[j];
      const vis = q && q.alive && q.bx1 > cx - hw && q.bx0 < cx + hw && q.by1 > cy - hh && q.by0 < cy + hh;
      if (!vis) { g.seen[j] = 0; continue; }
      // ключевой кадр раз в 40–50 шагов: у каждой пары «гость — червячок» свой срок, чтобы тела всех не шли в одном шаге
      const kf = !g.seen[j] || W.step - g.kf[j] >= 40 + ((j * 7 + g.kfo * 3) % 11) || g.sp[j] !== q.spawnStep || ((g.kfReq | 0) & (1 << j)) !== 0;
      g.seen[j] = 1;
      w.u8(j); w.i16(q.x * 4); w.i16(q.y * 4); w.u16(((wrapA(q.a) + Math.PI) / TAU) * 65535); w.u16(Math.min(65535, q.L));
      w.u8((q.boost ? 1 : 0) | (q.prot > W.step ? 2 : 0) | (kf ? 4 : 0));
      if (kf) {
        g.kf[j] = W.step; g.sp[j] = q.spawnStep; g.kfReq = (g.kfReq | 0) & ~(1 << j);
        const base = j * MAXP, cnt = W.wn[j], h = W.wh[j], m = Math.floor((cnt - 1) / 3);
        w.u16(m);
        let px = q.x, py = q.y;
        for (let k = 1; k <= m; k++) {
          const s = base + ((h - (k * 3 - 1) + MAXP) % MAXP), nx = W.wx[s], ny = W.wy[s];
          const dx = Math.round((nx - px) * 4), dy = Math.round((ny - py) * 4);
          w.i8(dx); w.i8(dy);
          px += clamp(dx, -128, 127) / 4; py += clamp(dy, -128, 127) / 4;
        }
      }
      n++;
    }
    w.put8(at, n);
    // еда: новая (или раз в 30 снимков — заново) и исчезнувшая
    at = w.at(); n = 0; w.u16(0);
    for (let k = 0; k < W.fN; k++) {
      const s = W.fL[k];
      if (W.fDead[s]) continue;
      if (Math.abs(W.fX[s] - cx) > hw || Math.abs(W.fY[s] - cy) > hh) continue;
      if (g.known[s] === W.fId[s] && s % 30 !== sn) continue;
      g.known[s] = W.fId[s];
      w.u16(W.fId[s]); w.i16(W.fX[s] * 4); w.i16(W.fY[s] * 4); w.u8(Math.min(255, W.fV[s] * 8)); w.u8(W.fC[s]);
      n++;
    }
    w.put16(at, n);
    at = w.at(); n = 0; w.u16(0);
    for (let s = 0; s < FCAP; s++) {
      const id = g.known[s];
      if (!id) continue;
      if (!W.fDead[s] && W.fId[s] === id) continue;
      w.u16(id); g.known[s] = 0; n++;
    }
    w.put16(at, n);
    if (sync) {   // всё, что есть в виду: гость уберёт у себя то, чего тут нет (потерянные «исчезла»)
      w.i16((cx - hw) * 4); w.i16((cy - hh) * 4); w.i16((cx + hw) * 4); w.i16((cy + hh) * 4);
      at = w.at(); n = 0; w.u16(0);
      for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; if (W.fDead[s] || Math.abs(W.fX[s] - cx) > hw || Math.abs(W.fY[s] - cy) > hh) continue; w.u16(W.fId[s]); n++; }
      w.put16(at, n);
    }
    // огоньки по зонам
    let zx0 = Math.floor((cx - hw + R) / ZONE), zx1 = Math.floor((cx + hw + R) / ZONE), zy0 = Math.floor((cy - hh + R) / ZONE), zy1 = Math.floor((cy + hh + R) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
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
      for (let k = 0; k < MAXO; k++) { const q = W.owners[k]; if (!q || !q.alive) continue; tot++; if (o && o.alive && q.L > o.L) rank++; }
      w.u8(o && o.alive ? rank + 1 : 0); w.u8(tot);
    }
    return w.view();
  }

  let kfSeq = 0;   // разный сдвиг ключевых кадров и сверки еды у разных гостей
  // ── Зеркало гостя ──
  const MQ = 1024, MF = 2048;
  function mirror(old){
    const G = old && old.qx ? old : {
      qx: new Float64Array(MAXO * MQ), qy: new Float64Array(MAXO * MQ), qh: new Int32Array(MAXO), qn: new Int32Array(MAXO),
      hfx: new Float64Array(MAXO), hfy: new Float64Array(MAXO), a: new Float64Array(MAXO), L: new Float64Array(MAXO), fl: new Uint8Array(MAXO), seen: new Int32Array(MAXO), on: new Uint8Array(MAXO),
      rx: new Float64Array(MAXO), ry: new Float64Array(MAXO), ra: new Float64Array(MAXO),
      fMap: new Int16Array(65536).fill(-1), fL: new Int16Array(MF), fF: new Int16Array(MF), fFN: 0, fN: 0, fId: new Uint16Array(MF), fX: new Float32Array(MF), fY: new Float32Array(MF), fV: new Float32Array(MF), fC: new Uint8Array(MF), fBorn: new Float64Array(MF),
      pOn: null, pAl: new Uint8Array(NP), pGen: new Uint8Array(NP), pX: new Float32Array(NP), pY: new Float32Array(NP), pV: new Uint8Array(NP),
      lbO: new Int8Array(10), lbS: new Float64Array(10), emo: new Uint8Array(MAXO), owners: new Array(MAXO).fill(null) };
    for (let k = 0; k < G.fN; k++) G.fMap[G.fId[G.fL[k]]] = -1;
    G.fN = 0; G.fFN = 0;
    for (let i = 0; i < MF; i++) G.fF[G.fFN++] = MF - 1 - i;
    G.qn.fill(0); G.on.fill(0); G.seen.fill(0);
    for (let p = 0; p < NP; p++) { const h = hash3(911, p, 7); G.pV[p] = h < .72 ? 1 : h < .95 ? 2 : 3; }
    G.ready = false; G.step = -1; G.snap = 0; G.me = -1; G.round = 1; G.phase = 0; G.left = ROUND; G.L0 = 0; G.pSeed = -1; G.lbN = 0; G.rank = 0; G.total = 0;
    G.t1 = 0; G.span = 66; G.echoTs = -1; G.hold = 0; G.emo.fill(0); G.need = 0;
    if (!old) G.owners.fill(null);
    return G;
  }
  // Путь гостя: свежая точка — голова со снимка; тело — ключевой кадр (каждая 3-я точка) или накопленные головы
  function qPush(G, j, x, y){
    const base = j * MQ;
    let h = G.qh[j];
    h = h + 1 === MQ ? 0 : h + 1;
    G.qx[base + h] = x; G.qy[base + h] = y; G.qh[j] = h;
    if (G.qn[j] < MQ) G.qn[j]++;
  }
  function qTrim(G, j){
    const base = j * MQ, n = G.qn[j], max = bodyLen(G.L[j]) + 40;
    let len = 0, k = 1, h = G.qh[j];
    for (; k < n; k++) {
      const a = base + ((h - k + 1 + MQ) % MQ), b = base + ((h - k + MQ) % MQ), dx = G.qx[a] - G.qx[b], dy = G.qy[a] - G.qy[b];
      len += Math.sqrt(dx * dx + dy * dy);
      if (len > max) break;
    }
    if (k + 1 < n) G.qn[j] = k + 1;
  }
  function decode(G, buf, now){
    const r = K.reader(buf);
    if (r.u8() !== 2) return false;
    const fl = r.u8(), st = r.u32();
    if (G.ready && st <= G.step) return false;
    G.step = st; G.round = r.u16(); G.left = r.u16() * 3; G.phase = fl & 2 ? 1 : 0;
    const me = r.u8(); G.me = me === 255 ? -1 : me;
    G.myL = r.u32();
    const ps = r.u32() | 0;
    if (ps !== G.pSeed) { G.pSeed = ps; for (let p = 0; p < NP; p++) { G.pAl[p] = 0; G.pGen[p] = 0; pelletXY(ps, p, 0, G.pX, G.pY, p); } }
    if (fl & 4) { G.echoTs = r.u32(); G.hold = r.u16(); } else G.echoTs = -1;
    const sn = ++G.snap;
    let n = r.u8();
    for (let k = 0; k < n; k++) {
      const j = r.u8(), x = r.i16() / 4, y = r.i16() / 4, a = r.u16() / 65535 * TAU - Math.PI, L = r.u16(), f = r.u8();
      if (j >= MAXO) throw new Error('snap: owner');
      if (f & 4) {
        const m = r.u16(), base = j * MQ;
        // ключевой кадр: путь заново (самая старая точка — первой)
        const cnt = Math.min(m + 1, MQ);
        let px = x, py = y;
        G.qx[base + cnt - 1] = x; G.qy[base + cnt - 1] = y;
        for (let q = 1; q <= m; q++) { px += r.i8() / 4; py += r.i8() / 4; const idx = cnt - 1 - q; if (idx >= 0) { G.qx[base + idx] = px; G.qy[base + idx] = py; } }
        G.qh[j] = cnt - 1; G.qn[j] = cnt;
        if (!G.on[j]) { G.hfx[j] = x; G.hfy[j] = y; G.rx[j] = x; G.ry[j] = y; G.ra[j] = a; }
      } else if (G.on[j] && G.qn[j]) {
        const base = j * MQ, h = G.qh[j], dx = x - G.qx[base + h], dy = y - G.qy[base + h];
        if (dx * dx + dy * dy > .25) qPush(G, j, x, y);
      } else { G.need |= 1 << j; continue; }   // тела ещё нет — попросим ключевой кадр
      G.hfx[j] = G.rx[j]; G.hfy[j] = G.ry[j];
      G.a[j] = a; G.L[j] = L; G.fl[j] = f; G.seen[j] = sn; G.on[j] = 1;
      qTrim(G, j);
    }
    for (let j = 0; j < MAXO; j++) if (G.on[j] && G.seen[j] !== sn) { G.on[j] = 0; G.qn[j] = 0; }
    n = r.u16();
    for (let k = 0; k < n; k++) {
      const id = r.u16(), x = r.i16() / 4, y = r.i16() / 4, v = r.u8() / 8, c = r.u8();
      let s = G.fMap[id];
      if (s < 0) { if (!G.fFN) continue; s = G.fF[--G.fFN]; G.fMap[id] = s; G.fL[G.fN++] = s; G.fId[s] = id; G.fBorn[s] = now; }
      G.fX[s] = x; G.fY[s] = y; G.fV[s] = v; G.fC[s] = c & 15;
    }
    n = r.u16();
    for (let k = 0; k < n; k++) fGone(G, r.u16(), now);
    if (fl & 8) {
      const x0 = r.i16() / 4, y0 = r.i16() / 4, x1 = r.i16() / 4, y1 = r.i16() / 4, m = r.u16();
      const keep = G.keep || (G.keep = new Uint32Array(2048));   // битовая маска id (65536 бит)
      keep.fill(0);
      for (let k = 0; k < m; k++) { const id = r.u16(); keep[id >> 5] |= 1 << (id & 31); }
      for (let k = 0; k < G.fN; k++) {
        const s = G.fL[k], id = G.fId[s];
        if (G.fX[s] < x0 || G.fX[s] > x1 || G.fY[s] < y0 || G.fY[s] > y1) continue;
        if (!(keep[id >> 5] & (1 << (id & 31)))) { fGone(G, id, now); k--; }
      }
    }
    n = r.u16();
    for (let k = 0; k < n; k++) {
      const z = r.u16(), b = r.u16();
      if (z >= ZN * ZN) continue;
      const p = z * KS;
      for (let j = 0; j < KS; j++) setPellet(G, p + j, (b >> (j * 4)) & 1, (b >> (j * 4 + 1)) & 7);
    }
    G.emo.fill(0);
    n = r.u8();
    for (let k = 0; k < n; k++) { const o = r.u8(), e = r.u8(); if (o < MAXO) G.emo[o] = e; }
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
  // Еда исчезла: рядом с головой — «втянулась» (эффект у гостя), иначе просто пропала
  function fGone(G, id, now){
    const s = G.fMap[id];
    if (s < 0) return;
    G.fMap[id] = -1;
    for (let k = 0; k < G.fN; k++) if (G.fL[k] === s) { G.fL[k] = G.fL[--G.fN]; break; }
    G.fF[G.fFN++] = s;
    if (G.onGone) G.onGone(G.fX[s], G.fY[s], G.fC[s], now);
  }
  function setPellet(G, p, alive, gen){
    if (G.pAl[p] && !alive && G.onGone) G.onGone(G.pX[p], G.pY[p], (p * 5 + G.pGen[p]) & 15, 0, -1);
    if (G.pGen[p] !== gen) { G.pGen[p] = gen; pelletXY(G.pSeed, p, gen, G.pX, G.pY, p); }
    G.pAl[p] = alive;
  }
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
      const skin = skinOk({ p: e[2], a: e[3], b: e[4] }) || presetSkin(i);
      G.owners[i] = { name: K.cleanName(e[1], i), skin, ci: colIdx(skin.a), bot: !!e[5], key: String(e[6] || '').slice(0, 80) };
    }
  }
  // Управление по сети: [угол·1000, ускорение, эмодзи, номер эмодзи]
  function packIn(a){ return [Math.round(a[0] * 1000), a[1] ? 1 : 0, a[2] | 0, a[3] | 0]; }
  function unpackIn(d, off, out){
    if (!Array.isArray(d) || d.length < off + 4) return null;
    for (let k = 0; k < 4; k++) if (typeof d[off + k] !== 'number' || !isFinite(d[off + k])) return null;
    out[0] = wrapA(d[off] / 1000); out[1] = d[off + 1] ? 1 : 0; out[2] = d[off + 2] | 0; out[3] = clamp(d[off + 3] | 0, 0, 8);
    return out;
  }
  // ── Смена хозяина: свой червячок — новому хозяину ──
  function claim(G){
    const j = G.me;
    if (j < 0 || !G.on[j] || !G.qn[j]) return null;
    const base = j * MQ, n = G.qn[j], h = G.qh[j], p = [];
    for (let k = 0; k < n && p.length < 400; k += 2) { const s = base + ((h - k + MQ) % MQ); p.push(Math.round(G.qx[s]), Math.round(G.qy[s])); }
    return { L: Math.round(G.L[j]), a: Math.round(G.a[j] * 1000) / 1000, p };
  }
  function capOf(G){
    const m = new Map();
    let low = 120;
    for (let k = 0; k < G.lbN; k++) { const o = G.owners[G.lbO[k]]; if (o && o.key) m.set(o.key, G.lbS[k] * 1.15 + 20); low = G.lbS[k]; }
    m.def = G.lbN >= 10 ? low * 1.15 + 20 : Math.max(120, low * 1.15 + 20);
    return m;
  }
  const RS = new Float64Array(MAXP * 2);
  function placeWorm(W, o, L, a, pts){
    // pts — от головы к хвосту (x, y, x, y…); точки — заново через SP по ломаной, не длиннее тела
    const lim = R - 20, need = Math.min(MAXP, Math.ceil(bodyLen(L) / SP) + 2);
    const cl = (v, w) => { const d = Math.sqrt(v * v + w * w); return d > lim ? lim / d : 1; };
    let k0 = cl(pts[0], pts[1]), px = pts[0] * k0, py = pts[1] * k0, m = 0, carry = 0;
    RS[0] = px; RS[1] = py; m = 1;
    for (let k = 2; k + 1 < pts.length && m < need; k += 2) {
      const kk = cl(pts[k], pts[k + 1]), qx = pts[k] * kk, qy = pts[k + 1] * kk;
      let dx = qx - px, dy = qy - py, d = Math.sqrt(dx * dx + dy * dy);
      let t = SP - carry;
      while (t <= d && m < need) { RS[m * 2] = px + dx / d * t; RS[m * 2 + 1] = py + dy / d * t; m++; t += SP; }
      carry = d - (t - SP);
      px = qx; py = qy;
    }
    const base = o.i * MAXP;
    for (let k = 0; k < m; k++) { W.wx[base + (m - 1 - k)] = RS[k * 2]; W.wy[base + (m - 1 - k)] = RS[k * 2 + 1]; }
    W.wh[o.i] = m - 1; W.wn[o.i] = m;
    o.x = o.hx0 = RS[0]; o.y = o.hy0 = RS[1]; o.a = a; o.inA = a; o.L = L; o.rw = rwOf(L);
    o.alive = true; o.wantSpawn = false; o.prot = W.step + PROT; o.spawnStep = W.step; o.life = W.step; o.best = L;
    bbox(W, o);
  }
  function applyClaim(W, i, c, caps){
    const o = W.owners[i];
    if (!o) return;
    const ok = c && typeof c === 'object' && Array.isArray(c.p) && c.p.length >= 4 && c.p.length <= 800 && c.p.length % 2 === 0 && c.p.every(x => typeof x === 'number' && isFinite(x)) && isFinite(c.L) && isFinite(c.a);
    if (!ok) { respawn(W, i); return; }
    const cap = caps ? (caps.get(o.key) ?? caps.def ?? 120) : 120;
    placeWorm(W, o, clamp(Math.min(c.L, cap), L0, MAX_L), wrapA(c.a), c.p);
  }
  function fromMirror(G, me){
    const W = newWorld((Math.random() * 2147483646 + 1) | 0);
    W.pSeed = G.pSeed;
    for (let p = 0; p < NP; p++) { W.pGen[p] = G.pGen[p]; W.pAl[p] = W.pOn[p]; pelletXY(W.pSeed, p, W.pGen[p], W.pX, W.pY, p); }
    for (let k = 0; k < G.fN; k++) { const s = G.fL[k]; fNew(W, G.fX[s], G.fY[s], G.fV[s], G.fC[s], FOOD_LIFE); }
    W.round = G.round; W.phase = G.phase; W.left = Math.max(1, G.left);
    const i = addOwner(W, { key: me.key, name: me.name, skin: me.skin, bot: false, spawn: false });
    const c = claim(G);
    if (c && W.phase === 0) placeWorm(W, W.owners[i], clamp(c.L, L0, MAX_L), c.a, c.p);
    else W.owners[i].wantSpawn = W.phase === 0;
    return { W, me: i };
  }

  const SIM = { DT, IN, newWorld, addOwner, dropOwner, setOwner, setInput, respawn, setHumans, step, encode, mirror, decode, claim, capOf, applyClaim, fromMirror,
    packIn, unpackIn, owners: ownersList, ownersVer: W => W.ver, setOwners };

  // ═══════════════════ ЭКРАН ═══════════════════
  const GAME = 'chervyachki', TITLE = 'Червячки', COLOR = '#a855f7';
  const LS = 'd37_io_chervyachki';
  let host = null, api = null, ui = null, cv = null, ctx = null, S = null, mode = 'menu', dpr = 1, cssW = 0, cssH = 0, ro = null;
  let lastT = 0, hudAt = 0, koAt = 0, cfg = null, reported = new Set(), soundL = 0, soundAt = 0, namesVer = -1;
  const cam = { x: 0, y: 0, z: 1, ok: false };
  const INP = new Float64Array(IN);
  const mouse = { on: false, x: 0, y: 0, down: false }, keys = { l: 0, r: 0, b: 0 };
  let stick = null, boostBtn = false, padPrevB = false;
  const listeners = [];
  let PERF = null;   // замер по частям (только _test.stress)
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push([t, ev, fn, o]); };
  const names = new Array(MAXO).fill(''), skins = new Array(MAXO).fill(null), bots = new Uint8Array(MAXO);
  const FONTS = [], EFONTS = [];
  for (let s = 0; s <= 96; s++) { FONTS.push(`800 ${s}px Montserrat,system-ui,sans-serif`); EFONTS.push(`${s}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`); }
  const DASH = [0, 0], NODASH = [];
  let me = { x: 0, y: 0, L: L0, alive: false, a: 0 };
  // «Втянутая» еда у гостя — короткий след к ближайшей голове (пул)
  const FX = { n: 0, x: new Float32Array(96), y: new Float32Array(96), c: new Uint8Array(96), t: new Float64Array(96), o: new Int8Array(96) };
  let eqRead = 0;
  // Спрайты огоньков (по цвету, рисуются один раз)
  let GLOW = null;
  function glowSprites(){
    if (GLOW || typeof document === 'undefined') return GLOW;
    GLOW = FCOL.map(col => {
      const c = document.createElement('canvas'); c.width = c.height = 32;
      const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.25, col); gr.addColorStop(.6, col + '55'); gr.addColorStop(1, col + '00');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
      return c;
    });
    return GLOW;
  }

  function loadCfg(){
    let c = null;
    try { c = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
    c = c && typeof c === 'object' ? c : {};
    const mine = K.myColors();
    return { name: typeof c.name === 'string' ? c.name : '', skin: skinOk(c.skin) || (mine ? { p: mine.rainbow ? 4 : 1, a: mine.c1, b: mine.c2 } : presetSkin(0)) };
  }
  function saveCfg(){ try { localStorage.setItem(LS, JSON.stringify({ name: cfg.name, skin: cfg.skin })); } catch (e) {} }
  const myName = () => K.cleanName(cfg.name || K.myNick(), 4);

  // ── Меню ──
  function menu(){
    flushLife();
    mode = 'menu';
    stopSession();
    ui.hud.hidden = true;
    showOv(K.menuHtml({ logo: '🐛', title: TITLE, game: GAME, name: cfg.name, presets: PRESETS.length, patterns: PATTERNS,
      sub: 'Ползай и ешь огоньки — растёшь! Держи кнопку (или пробел, мышь), чтобы ускориться: ускорение тратит длину. Врезался головой в чужого червячка — рассыпаешься на огоньки. Подрезай других, чтобы они врезались в тебя.' }));
    const inp = ui.ov.querySelector('.io-name input');
    inp.addEventListener('input', () => { cfg.name = inp.value.slice(0, 16); saveCfg(); });
    paintSkins();
    drawIdle();
  }
  function paintSkins(){
    if (!ui) return;
    ui.ov.querySelectorAll('[data-io^="sk"]').forEach((b, k) => {
      const c = b.querySelector('canvas').getContext('2d'), q = presetSkin(k);
      c.clearRect(0, 0, 64, 64);
      previewWorm(c, q);
      b.classList.toggle('sel', cfg.skin.p === q.p && cfg.skin.a === q.a && cfg.skin.b === q.b);
    });
    const pat = ui.ov.querySelector('[data-io="pat"]'), ca = ui.ov.querySelector('[data-io="ca"]'), cb = ui.ov.querySelector('[data-io="cb"]');
    if (pat) pat.value = String(cfg.skin.p);
    if (ca) ca.value = cfg.skin.a;
    if (cb) cb.value = cfg.skin.b;
  }
  // Червячок-«змейка» для витрины раскрасок
  const PV = new Float64Array(40);
  function previewWorm(c, sk){
    for (let k = 0; k < 20; k++) { PV[k * 2] = 52 - k * 2.1; PV[k * 2 + 1] = 32 + Math.sin(k * .45) * 9; }
    c.beginPath(); c.moveTo(PV[0], PV[1]); for (let k = 1; k < 20; k++) c.lineTo(PV[k * 2], PV[k * 2 + 1]);
    strokeBody(c, sk, 7, 1, false, 0);
    head(c, PV[0], PV[1], 0, 7, sk, 0, 1);
  }

  // ── Сеанс ──
  function stopSession(){ netWait?.(); netWait = null; if (S) { S.leave(); S = null; } }
  function newSession(){
    stopSession();
    S = K.session({ game: GAME, sim: SIM, max: 10, me: { key: K.myKey(), nick: myName(), skin: cfg.skin, aspect: (cssW || 400) / (cssH || 600) },
      onFrame: (s, t) => frame(t), onInput: t => readInput(t), onRole: () => onRole(), onKo: e => onKo(e), onRound: e => onRound(e),
      onPlayers: () => { namesVer = -1; }, onStatus: (k, v) => onStatus(k, v) });
    return S;
  }
  function startBots(){ newSession(); enterGame(); hideOv(); S.offline(); }
  let netWait = null, lastOnline = null;
  function startOnline(code, pub){
    lastOnline = { code, pub };
    newSession(); enterGame();
    showOv(K.connHtml(pub));
    const s0 = S;
    netWait?.();
    netWait = K.whenNet(ok => {
      netWait = null;
      if (S !== s0 || !S) return;
      if (ok) S.online(code, { pub });
      // общая арена («▶ Играть») без связи — с ботами, и так и сказано; по ссылке друга — честное «нет связи» и «Ещё раз»
      else if (pub) { api.toast?.('📡 Онлайн сейчас недоступен — играем с ботами'); startBots(); }
      else showOv(K.errHtml('offline'));
    });
  }
  function enterGame(){
    mode = 'play'; koAt = 0; cam.ok = false; reported.clear(); soundL = 0; namesVer = -1; FX.n = 0;
    ui.hud.hidden = false; ui.emos.hidden = true; resize();
  }
  function onRole(){ if (ui && ui.ov.querySelector('.io-logo')?.textContent === '🌐') hideOv(); namesVer = -1; if (S?.G) S.G.onGone = gone; }
  function onStatus(kind, v){
    if (!ui) return;
    if (kind === 'joining' && mode === 'play' && ui.ov.hidden) showOv(K.connHtml(false));
    if (kind === 'error' && S?.pub && v === 'offline') { api.toast?.('📡 Не получилось подключиться — играем с ботами'); startBots(); }
    else if (kind === 'error') showOv(K.errHtml(v));
    else if (kind === 'handover') api.toast?.('Ты свернул вкладку — арену ведёт другой игрок');
  }
  function syncNames(){
    for (let i = 0; i < MAXO; i++) {
      const o = S ? (S.role === 'guest' ? S.G?.owners[i] : S.W?.owners[i]) : null;
      names[i] = o ? K.showName(o.name) : ''; skins[i] = o ? o.skin : null; bots[i] = o && o.bot ? 1 : 0;
    }
  }
  function gone(x, y, c, now, by){
    if (FX.n >= 96) return;
    if (by === undefined || by < 0) {   // гость: кто съел — ближайшая голова (не дальше 90)
      by = -1; let bd = 90 * 90;
      for (let j = 0; j < MAXO; j++) { if (!HXok[j]) continue; const dx = HX[j] - x, dy = HY[j] - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; by = j; } }
      if (by < 0) return;
    }
    const k = FX.n++;
    FX.x[k] = x; FX.y[k] = y; FX.c[k] = c; FX.t[k] = now || performance.now(); FX.o[k] = by;
  }

  // ── События ──
  function onKo(e){
    if (!S || e.o !== S.me) return;
    koAt = performance.now();
    api.sfx?.('bad');
    reportLife(e.best, false, e.life);
    const by = e.by >= 0 ? names[e.by] : '';
    setTimeout(() => {
      if (!S || mode !== 'play' || !koAt) return;
      showOv(K.koHtml({ logo: '✨', title: 'Ты рассыпался на огоньки!', sub: by ? `Ты врезался в ${bots[e.by] ? 'бота ' : ''}«${by}»` : '',
        stats: [[K.num(e.best), 'лучшая длина'], [String(e.kills), K.ru(e.kills, 'врезался в тебя', 'врезались в тебя', 'врезались в тебя')], [fmtT(e.life), 'в игре']] }), 'ko');
    }, 700);
  }
  function onRound(e){
    if (!S || !ui) return;
    if (e.k === 'start') { hideOv(); koAt = 0; reported.clear(); lifeBest = 0; return; }
    const mine = e.rank.findIndex(r => r[0] === S.me);
    if (mine >= 0 && !koAt) reportLife(e.rank[mine][2], mine === 0 && e.total >= 3 && e.rank[mine][3] >= 60, e.rank[mine][3]);
    showOv(K.podiumHtml(e, S.me));
    if (mine === 0) api.sfx?.('win');
    try { window.D37Ads?.interstitial?.(GAME); } catch (er) {}
  }
  let lifeBest = 0, lifeAt = 0;
  function flushLife(){
    if (S && mode === 'play' && !koAt && lifeBest >= 30) reportLife(lifeBest, false, (performance.now() - lifeAt) / 1000);
    lifeBest = 0;
  }
  function reportLife(best, win, life){
    const runKey = (S?.role || 'x') + ':' + (S?.view()?.round || 0) + ':' + Math.round(life);
    if (reported.has(runKey)) return;
    reported.add(runKey);
    K.reportLife(api, GAME, S, best, win);
  }

  // ── Управление: угол к цели и ускорение ──
  function readInput(t){
    if (!S || mode !== 'play') return;
    let a = INP[0], b = 0;
    const p = K.pad();
    if (stick && stick.st.on && stick.st.m > .25) a = Math.atan2(stick.st.y, stick.st.x);
    else if (keys.l || keys.r) a = me.a + (keys.r - keys.l) * 1.2;
    else if (p && (p.x || p.y)) a = Math.atan2(p.y, p.x);
    else if (mouse.on && cam.ok) {
      const hx = (me.x - cam.x) * cam.z + cssW / 2, hy = (me.y - cam.y) * cam.z + cssH / 2;
      const dx = mouse.x - hx, dy = mouse.y - hy;
      if (dx * dx + dy * dy > 36) a = Math.atan2(dy, dx);
    }
    if (boostBtn || keys.b || mouse.down || (p && (p.a || p.rt))) b = 1;
    a = wrapA(a);
    if (Math.abs(wrapA(a - INP[0])) > .004 || b !== INP[1]) { INP[0] = a; INP[1] = b; S.setInput(INP, t); }
  }
  function emoteK(k, t){ if (!S) return; INP[2]++; INP[3] = k; S.setInput(INP, t); ui.emos.hidden = true; }
  const KEYD = { arrowleft: 'l', a: 'l', 'ф': 'l', arrowright: 'r', d: 'r', 'в': 'r' };
  function onKey(e){
    if (mode !== 'play' || e.target?.closest?.('input,textarea,select') || window.GameKit?.isOpen?.()) return;
    const k = (e.key || '').toLowerCase(), down = e.type === 'keydown';
    if (KEYD[k]) { keys[KEYD[k]] = down ? 1 : 0; e.preventDefault(); return; }
    if (k === ' ' || e.code === 'Space' || k === 'arrowup' || k === 'w' || k === 'ц') { keys.b = down ? 1 : 0; e.preventDefault(); return; }
    if (down && /^[1-8]$/.test(k)) emoteK(+k, e.timeStamp || performance.now());
  }
  function onClick(e){
    const b = e.target.closest('[data-io]');
    if (!b || !host?.contains(b)) return;
    const a = b.dataset.io, t = e.timeStamp || performance.now();
    if (a === 'play') { cfg.name = ui.ov.querySelector('.io-name input')?.value.slice(0, 16) || cfg.name; saveCfg(); startOnline('', true); }
    else if (a === 'bots') startBots();
    else if (a === 'retry') { if (lastOnline) startOnline(lastOnline.code, lastOnline.pub); else menu(); }
    else if (a === 'friend') { cfg.name = ui.ov.querySelector('.io-name input')?.value.slice(0, 16) || cfg.name; saveCfg(); K.inviteNew(GAME, TITLE, api.toast); }
    else if (a === 'menu') menu();
    else if (a === 'again') { hideOv(); koAt = 0; S?.respawn(); }
    else if (a === 'emo') ui.emos.hidden = !ui.emos.hidden;
    else if (/^e\d$/.test(a)) emoteK(+a.slice(1), t);
    else if (a === 'invite') { if (S && S.code && S.role !== 'off') K.share(GAME, S.code, TITLE, api.toast); else K.inviteNew(GAME, TITLE, api.toast); }
    else if (a.startsWith('sk')) { cfg.skin = presetSkin(+a.slice(2)); saveCfg(); paintSkins(); S?.setMe({ skin: cfg.skin }); }
    else if (a === 'mine') { const m = K.myColors(); if (m) { cfg.skin = { p: m.rainbow ? 4 : 1, a: m.c1, b: m.c2 }; saveCfg(); paintSkins(); } }
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
  let boostId = -1;
  function padDown(e){ const b = e.target.closest('[data-pad="boost"]'); if (!b) return; e.preventDefault(); e.stopPropagation(); boostBtn = true; boostId = e.pointerId; b.classList.add('on'); }
  function padUp(e){ if (e.pointerId !== boostId) return; boostId = -1; boostBtn = false; ui?.pad.querySelector('[data-pad="boost"]')?.classList.remove('on'); }
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

  // ═══ Кадр ═══
  function frame(t){
    const dtf = lastT ? clamp((t - lastT) / 1000, 0, .1) : .016;
    lastT = t;
    if (!S || !ctx) return;
    const guest = S.role === 'guest', V = S.view();
    if (!V || (guest && !V.ready)) { me.alive = false; }
    else if (guest) prepGuest(V, t, dtf); else prepHost(V, S.alpha);
    camera(dtf);
    const d0 = PERF ? performance.now() : 0;
    draw(t, V, guest, dtf);
    if (PERF && PERF.n < 4000) PERF.dr[PERF.n] = performance.now() - d0;
    if (t - hudAt > 250) { hudAt = t; hud(V, guest); }
    if (api?.sfx && me.L > soundL + 6 && t - soundAt > 200 && soundL > 0) { api.sfx('tick'); soundAt = t; }
    soundL = me.L;
  }
  // Хозяин: голова — между шагами; тело — по пути
  const HX = new Float64Array(MAXO), HY = new Float64Array(MAXO), HXok = new Uint8Array(MAXO);
  function prepHost(W, al){
    if (eqRead > W.eqN || W.eqN - eqRead > 512) eqRead = W.eqN;   // новый мир / долго не рисовали — старое не показываем
    for (let i = 0; i < MAXO; i++) { const o = W.owners[i]; HXok[i] = o && o.alive ? 1 : 0; if (HXok[i]) { HX[i] = o.hx0 + (o.x - o.hx0) * al; HY[i] = o.hy0 + (o.y - o.hy0) * al; } }
    const o = W.owners[S.me];
    if (o && o.alive) { me.x = HX[S.me]; me.y = HY[S.me]; me.L = o.L; me.alive = true; me.a = o.a; }
    else { me.alive = false; if (o) { me.x = o.deadX; me.y = o.deadY; } }
  }
  // Гость: чужие головы — между снимками; своя — сразу по своему управлению (прогноз от последней головы хозяина)
  const PRED = new Float64Array(16);
  let predN = 0;
  function prepGuest(G, t, dtf){
    const al = clamp((t - G.t1) / (G.span || 66), 0, 1);
    for (let j = 0; j < MAXO; j++) {
      HXok[j] = G.on[j] && G.qn[j] ? 1 : 0;
      if (!HXok[j]) continue;
      const base = j * MQ, h = G.qh[j];
      const x = G.hfx[j] + (G.qx[base + h] - G.hfx[j]) * al, y = G.hfy[j] + (G.qy[base + h] - G.hfy[j]) * al;
      G.rx[j] = x; G.ry[j] = y; HX[j] = x; HY[j] = y;
    }
    predN = 0;
    const j = G.me;
    if (j >= 0 && G.on[j] && G.qn[j] && G.phase === 0) {
      // прогноз: от последней головы хозяина вперёд на (время со снимка + полпинга), поворот к своей цели
      const base = j * MQ, h = G.qh[j];
      let x = G.qx[base + h], y = G.qy[base + h], a = G.a[j];
      const L = G.L[j], boost = INP[1] && L >= BOOST_MIN, v = boost ? BOOSTV : SPEED, tr = turnOf(L);
      let hz = clamp((t - G.t1) / 1000 + S.rtt / 2000, 0, .35);
      const st = 1 / 60;
      while (hz > 1e-6 && predN < 8) {
        const d = Math.min(st * 3, hz);
        const da = wrapA(INP[0] - a), mx = tr * d;
        a += da > mx ? mx : da < -mx ? -mx : da;
        x += Math.cos(a) * v * d; y += Math.sin(a) * v * d;
        PRED[predN * 2] = x; PRED[predN * 2 + 1] = y; predN++;
        hz -= d;
      }
      const ease = 1 - Math.exp(-dtf * 18);
      const px = predN ? PRED[predN * 2 - 2] : x, py = predN ? PRED[predN * 2 - 1] : y;
      G.rx[j] += (px - G.rx[j]) * ease; G.ry[j] += (py - G.ry[j]) * ease;
      HX[j] = G.rx[j]; HY[j] = G.ry[j];
      if (predN) { PRED[predN * 2 - 2] = HX[j]; PRED[predN * 2 - 1] = HY[j]; }
      me.x = HX[j]; me.y = HY[j]; me.L = L; me.alive = true; me.a = a;
    } else {
      me.alive = j >= 0 && G.on[j] && G.qn[j] > 0;
      if (me.alive) { me.x = HX[j]; me.y = HY[j]; me.L = G.L[j]; me.a = G.a[j]; }
    }
  }
  function camera(dtf){
    const zt = Math.sqrt((cssW * cssH) / viewArea(me.alive ? me.L : L0));
    if (!cam.ok) { if (me.alive) { cam.x = me.x; cam.y = me.y; cam.z = zt; cam.ok = true; } return; }
    const k = 1 - Math.exp(-dtf * 12), kz = 1 - Math.exp(-dtf * 2);
    cam.x += (me.x - cam.x) * k; cam.y += (me.y - cam.y) * k; cam.z += (zt - cam.z) * kz;
  }

  // ── Рисунок червячка: путь уже построен в c; узор — штрихами ──
  function strokeBody(c, sk, rw, z, boost, t){
    const w = rw * 2 * z;
    c.lineCap = 'round'; c.lineJoin = 'round';
    if (boost) { c.globalAlpha = .28; c.strokeStyle = sk.p === 5 ? sk.b : sk.a; c.lineWidth = w + 12 * dpr; c.stroke(); c.globalAlpha = 1; }
    c.strokeStyle = sk.p === 5 ? sk.b : 'rgba(0,0,0,.45)'; c.lineWidth = w + Math.max(2, w * .14); c.stroke();
    c.strokeStyle = sk.p === 4 ? '#f472b6' : sk.a; c.lineWidth = w; c.stroke();
    const p = sk.p;
    if (p === 1 || p === 7) {
      DASH[0] = rw * z * (p === 1 ? 1 : .45); DASH[1] = rw * z * (p === 1 ? 1 : 1.1);
      c.setLineDash(DASH); c.lineDashOffset = -t * .02 * z; c.lineCap = 'butt'; c.strokeStyle = sk.b; c.lineWidth = w * .92; c.stroke();
    } else if (p === 2) {
      DASH[0] = .01; DASH[1] = rw * z * 1.7; c.setLineDash(DASH); c.lineDashOffset = 0; c.strokeStyle = sk.b; c.lineWidth = w * .45; c.stroke();
    } else if (p === 3) {
      DASH[0] = rw * z * 1.3; DASH[1] = rw * z * .8; c.setLineDash(DASH); c.lineDashOffset = 0; c.lineCap = 'butt'; c.strokeStyle = sk.b; c.lineWidth = w * .3; c.stroke();
    } else if (p === 4) {
      const L = rw * z * 1.1;
      DASH[0] = L; DASH[1] = L * 5; c.setLineDash(DASH); c.lineCap = 'butt'; c.lineWidth = w * .92;
      for (let k = 0; k < 6; k++) { c.strokeStyle = RAIN[k]; c.lineDashOffset = -k * L; c.stroke(); }
    } else if (p === 5) { c.strokeStyle = sk.b; c.lineWidth = Math.max(1, w * .12); c.globalAlpha = .9; c.stroke(); c.globalAlpha = 1; }
    c.setLineDash(NODASH); c.lineDashOffset = 0; c.lineCap = 'round';
  }
  const RAIN = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#60a5fa', '#a78bfa'];
  function head(c, x, y, a, rw, sk, look, z){
    const r = rw * z * 1.08;
    c.fillStyle = sk.p === 4 ? '#f87171' : sk.a;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    const big = sk.p === 6 ? 1.35 : 1, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
    const ex = x + ca * r * .32, ey = y + sa * r * .32, er = r * .36 * big;
    c.fillStyle = '#fff'; c.beginPath();
    c.arc(ex + px * r * .48, ey + py * r * .48, er, 0, TAU); c.moveTo(ex - px * r * .48 + er, ey - py * r * .48); c.arc(ex - px * r * .48, ey - py * r * .48, er, 0, TAU); c.fill();
    const la = look, lx = Math.cos(la) * er * .45, ly = Math.sin(la) * er * .45;
    c.fillStyle = '#111'; c.beginPath();
    c.arc(ex + px * r * .48 + lx, ey + py * r * .48 + ly, er * .5, 0, TAU); c.moveTo(ex - px * r * .48 + lx + er * .5, ey - py * r * .48 + ly); c.arc(ex - px * r * .48 + lx, ey - py * r * .48 + ly, er * .5, 0, TAU); c.fill();
  }
  // Путь в c: от головы (hx, hy) по кольцу точек (X, Y, base, h, n, cap), каждую step-ю, пока не наберётся длина maxLen
  // Видимая часть мира с запасом (ставит draw): отрезки тела, оба конца которых вне её, в путь не попадают (длинные червячки)
  let CX0 = -1e9, CX1 = 1e9, CY0 = -1e9, CY1 = 1e9;
  function pathFrom(c, ox, oy, z, hx, hy, X, Y, base, h, n, cap, step, maxLen, skip, cont){
    if (!cont) c.moveTo(ox + hx * z, oy + hy * z);
    let len = 0, lx = hx, ly = hy, out = !(hx >= CX0 && hx <= CX1 && hy >= CY0 && hy <= CY1);
    for (let k = skip; k < n; k += step) {
      const s = base + ((h - k + cap) % cap), x = X[s], y = Y[s], dx = x - lx, dy = y - ly, d = Math.sqrt(dx * dx + dy * dy);
      if (len + d > maxLen) {
        const f = (maxLen - len) / (d || 1);
        if (out) c.moveTo(ox + lx * z, oy + ly * z);
        c.lineTo(ox + (lx + dx * f) * z, oy + (ly + dy * f) * z);
        break;
      }
      len += d;
      const o2 = !(x >= CX0 && x <= CX1 && y >= CY0 && y <= CY1);
      if (o2 && out) { lx = x; ly = y; continue; }
      if (out) c.moveTo(ox + lx * z, oy + ly * z);
      c.lineTo(ox + x * z, oy + y * z);
      out = o2; lx = x; ly = y;
    }
  }
  function draw(t, V, guest, dtf){
    const c = ctx, W2 = cv.width, H2 = cv.height, z = cam.z * dpr;
    const ox = W2 / 2 - cam.x * z, oy = H2 / 2 - cam.y * z;
    const vx0 = cam.x - W2 / 2 / z, vx1 = cam.x + W2 / 2 / z, vy0 = cam.y - H2 / 2 / z, vy1 = cam.y + H2 / 2 / z;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#050611'; c.fillRect(0, 0, W2, H2);
    // круг арены и сетка точками
    c.fillStyle = '#0d0f22'; c.beginPath(); c.arc(ox, oy, R * z, 0, TAU); c.fill();
    const gs = z > .45 ? 50 : z > .22 ? 100 : 200, dot = Math.max(1, 1.6 * dpr);
    c.fillStyle = 'rgba(167,139,250,.12)';
    c.beginPath();
    for (let x = Math.ceil(Math.max(vx0, -R) / gs) * gs; x <= Math.min(vx1, R); x += gs) for (let y = Math.ceil(Math.max(vy0, -R) / gs) * gs; y <= Math.min(vy1, R); y += gs) {
      if (x * x + y * y > R * R) continue;
      c.rect(ox + x * z - dot / 2, oy + y * z - dot / 2, dot, dot);
    }
    c.fill();
    c.strokeStyle = 'rgba(244,114,182,.6)'; c.lineWidth = Math.max(3, 10 * z); c.beginPath(); c.arc(ox, oy, R * z, 0, TAU); c.stroke();
    if (!V || (guest && !V.ready)) return;
    const spr = glowSprites();
    // огоньки по зонам
    let zx0 = Math.floor((vx0 + R) / ZONE), zx1 = Math.floor((vx1 + R) / ZONE), zy0 = Math.floor((vy0 + R) / ZONE), zy1 = Math.floor((vy1 + R) / ZONE);
    if (zx0 < 0) zx0 = 0; if (zy0 < 0) zy0 = 0; if (zx1 >= ZN) zx1 = ZN - 1; if (zy1 >= ZN) zy1 = ZN - 1;
    const pulse = 1 + Math.sin(t * .004) * .08;
    for (let zy = zy0; zy <= zy1; zy++) for (let zx = zx0; zx <= zx1; zx++) {
      const base = (zy * ZN + zx) * KS;
      for (let j = 0; j < KS; j++) {
        const p = base + j;
        if (!V.pAl[p]) continue;
        const s = (6 + V.pV[p] * 4) * z * pulse, col = (p * 5 + V.pGen[p]) & 15;
        if (spr) c.drawImage(spr[col], ox + V.pX[p] * z - s, oy + V.pY[p] * z - s, s * 2, s * 2);
      }
    }
    // рассыпанная еда
    for (let k = 0; k < V.fN; k++) {
      const s = V.fL[k], x = V.fX[s], y = V.fY[s];
      if (x < vx0 - 30 || x > vx1 + 30 || y < vy0 - 30 || y > vy1 + 30) continue;
      const r = (7 + Math.sqrt(V.fV[s]) * 4.5) * z * (1 + Math.sin(t * .006 + s) * .12);
      if (spr) c.drawImage(spr[V.fC[s] & 15], ox + x * z - r, oy + y * z - r, r * 2, r * 2);
    }
    // съеденное «втягивается» в голову того, кто съел
    if (!guest) { while (eqRead < V.eqN) { const q = (eqRead & 255) * 4; if (V.eqN - eqRead <= 256) gone(V.eq[q], V.eq[q + 1], V.eq[q + 2], t, V.eq[q + 3]); eqRead++; } }
    for (let k = 0; k < FX.n; k++) {
      const a = (t - FX.t[k]) / 160, j = FX.o[k];
      if (a >= 1 || a < 0 || !HXok[j]) { FX.n--; FX.x[k] = FX.x[FX.n]; FX.y[k] = FX.y[FX.n]; FX.c[k] = FX.c[FX.n]; FX.t[k] = FX.t[FX.n]; FX.o[k] = FX.o[FX.n]; k--; continue; }
      const e = a * a, x = FX.x[k] + (HX[j] - FX.x[k]) * e, y = FX.y[k] + (HY[j] - FX.y[k]) * e;
      if (spr) { const r = 9 * z * (1 - a * .7); c.globalAlpha = 1 - a * .6; c.drawImage(spr[FX.c[k]], ox + x * z - r, oy + y * z - r, r * 2, r * 2); c.globalAlpha = 1; }
    }
    // червячки: короткие снизу, длинные сверху
    const order = ORD;
    let n = 0;
    for (let j = 0; j < MAXO; j++) if (guest ? (V.on[j] && V.qn[j]) : (V.owners[j] && V.owners[j].alive)) order[n++] = j;
    for (let a = 1; a < n; a++) { const v = order[a], lv = Lof(V, v, guest); let b = a - 1; while (b >= 0 && Lof(V, order[b], guest) > lv) { order[b + 1] = order[b]; b--; } order[b + 1] = v; }
    const step = z * SP > 5 ? 1 : z * SP > 2.5 ? 2 : 3;
    const mg = 230;   // запас: самое толстое тело (длина 30000 — радиус ~100)
    CX0 = vx0 - mg; CX1 = vx1 + mg; CY0 = vy0 - mg; CY1 = vy1 + mg;
    for (let q = 0; q < n; q++) {
      const j = order[q], sk = skins[j] || PRESET0;
      const L = Lof(V, j, guest), rw = rwOf(L), bl = bodyLen(L);
      const hx = HX[j], hy = HY[j];
      let bx0, by0, bx1, by1;
      if (guest) { bx0 = hx - bl; bx1 = hx + bl; by0 = hy - bl; by1 = hy + bl; }
      else { const o = V.owners[j]; bx0 = o.bx0; by0 = o.by0; bx1 = o.bx1; by1 = o.by1; }
      if (bx1 < vx0 || bx0 > vx1 || by1 < vy0 || by0 > vy1) continue;
      const prot = guest ? V.fl[j] & 2 : V.owners[j].prot > V.step, boost = guest ? V.fl[j] & 1 : V.owners[j].boost;
      if (prot) c.globalAlpha = .45 + .25 * Math.sin(t * .015);
      c.beginPath();
      if (guest) {
        if (j === V.me && predN) {   // своя голова впереди хозяина: прогноз → голова хозяина → тело
          c.moveTo(ox + HX[j] * z, oy + HY[j] * z);
          for (let k = predN - 2; k >= 0; k--) c.lineTo(ox + PRED[k * 2] * z, oy + PRED[k * 2 + 1] * z);
          const base = j * MQ, h = V.qh[j];
          c.lineTo(ox + V.qx[base + h] * z, oy + V.qy[base + h] * z);
          pathFrom(c, ox, oy, z, V.qx[base + h], V.qy[base + h], V.qx, V.qy, base, h, V.qn[j], MQ, 1, bl, 1, true);
        } else pathFrom(c, ox, oy, z, hx, hy, V.qx, V.qy, j * MQ, V.qh[j], V.qn[j], MQ, 1, bl, 1);
      } else pathFrom(c, ox, oy, z, hx, hy, V.wx, V.wy, j * MAXP, V.wh[j], V.wn[j], MAXP, step, bl, 0);
      strokeBody(c, sk, rw, z, boost, t);
      const a = guest ? V.a[j] : V.owners[j].a;
      const look = j === S.me ? INP[0] : a;
      head(c, ox + hx * z, oy + hy * z, a, rw, sk, look, z);
      c.globalAlpha = 1;
      const sr = rw * z;
      const nm = names[j];
      if (nm && sr > 3 * dpr) {
        const fs = ((Math.min(40 * dpr, Math.max(10 * dpr, sr * 1.1)) / 2) | 0) * 2;   // чётные размеры — меньше разных шрифтов при приближении
        c.font = FONTS[fs > 96 ? 96 : fs]; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.lineWidth = Math.max(2, fs * .18); c.strokeStyle = 'rgba(0,0,0,.6)'; c.fillStyle = '#fff';
        c.strokeText(nm, ox + hx * z, oy + hy * z - sr * 1.6); c.fillText(nm, ox + hx * z, oy + hy * z - sr * 1.6);
      }
      const e = guest ? V.emo[j] : (V.owners[j].emoteUntil > V.step ? V.owners[j].emote : 0);
      if (e) { const fs = Math.min(96, Math.max(20 * dpr, sr * 2.4)) | 0; c.font = EFONTS[fs]; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(K.EMOTES[e - 1], ox + hx * z, oy + hy * z - sr * 1.6 - (nm ? 14 * dpr : 0)); }
    }
    // мини-карта
    const ms = Math.min(96, cssW * .2) * dpr, mx = 10 * dpr + ms / 2, my = H2 - ms / 2 - 10 * dpr;
    c.fillStyle = 'rgba(8,10,20,.55)'; c.beginPath(); c.arc(mx, my, ms / 2, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.stroke();
    if (me.alive) { c.fillStyle = '#fde68a'; c.beginPath(); c.arc(mx + me.x / R * ms / 2, my + me.y / R * ms / 2, 3 * dpr, 0, TAU); c.fill(); }
    if (stick) K.drawStick(c, stick.st, dpr, 'rgba(168,85,247,.6)');
    if (koAt) { c.globalAlpha = clamp((performance.now() - koAt) / 700, 0, 1) * .55; c.fillStyle = '#020208'; c.fillRect(0, 0, W2, H2); c.globalAlpha = 1; }
  }
  const ORD = new Int8Array(MAXO);
  const Lof = (V, j, guest) => (guest ? V.L[j] : V.owners[j].L);
  const PRESET0 = presetSkin(0);
  function drawIdle(){
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f22'; ctx.fillRect(0, 0, cv.width, cv.height);
    const spr = glowSprites();
    if (spr) for (let i = 0; i < 50; i++) { const s = 14 * dpr; ctx.drawImage(spr[i & 15], ((i * 977) % 1000) / 1000 * cv.width - s / 2, ((i * 571) % 1000) / 1000 * cv.height - s / 2, s, s); }
  }
  const fmtT = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let lbStr = '';
  function hud(V, guest){
    if (!V || !ui) return;
    if ((V.ver | 0) !== namesVer) { namesVer = V.ver | 0; syncNames(); }
    const L = me.alive ? me.L : 0;
    const sc = K.num(L);
    if (ui.sc.textContent !== sc) ui.sc.textContent = sc;
    if (L > 0) { if (!lifeBest) lifeAt = performance.now(); if (L > lifeBest) lifeBest = L; } else if (koAt) lifeBest = 0;
    const left = Math.max(0, Math.ceil(V.left / SPS)), tt = V.phase ? `🏁 ${left}` : `⏱ ${fmtT(left)}`;
    if (ui.time.textContent !== tt) ui.time.textContent = tt;
    const lt = ui.ov.querySelector('.io-left'); if (lt) lt.textContent = String(left);
    const net = K.netLabel(S);
    if (ui.net.textContent !== net) ui.net.textContent = net;
    let key = String(S.me);
    for (let k = 0; k < V.lbN; k++) key += ',' + V.lbO[k] + ':' + Math.round(V.lbS[k]);
    if (key !== lbStr) {
      lbStr = key;
      const list = [];
      for (let k = 0; k < V.lbN; k++) list.push({ i: V.lbO[k], name: names[V.lbO[k]] || '…', score: V.lbS[k], bot: bots[V.lbO[k]], me: V.lbO[k] === S.me });
      ui.lb.innerHTML = K.lbHtml(list);
    }
    let r0 = 0, tot = 0;
    if (guest) { r0 = V.rank; tot = V.total; } else { for (let i = 0; i < MAXO; i++) { const o = V.owners[i]; if (o && o.alive) { tot++; if (L > 0 && o.L > L) r0++; } } r0 = L > 0 ? r0 + 1 : 0; }
    const rank = r0 > 0 ? `Место ${r0} из ${tot}` : '';
    if (ui.rank.textContent !== rank) ui.rank.textContent = rank;
    if (guest && V.need && S.P) { S.P.send(S.P.host, { t: 'kf', o: [...Array(MAXO).keys()].filter(j => V.need & (1 << j)) }); V.need = 0; }
  }

  root.GAME_IMPL = root.GAME_IMPL || {};
  root.GAME_IMPL.chervyachki = {
    mount(el, gameApi){
      host = el; api = gameApi; cfg = loadCfg();
      ui = K.shell(el, { cls: 'ch', color: COLOR, scoreLabel: 'длина', note: 'ПК: мышь — куда ползти, держи кнопку мыши или пробел — ускорение, 1–8 — эмодзи. Телефон: веди пальцем где угодно, держи ⚡.',
        padHtml: '<button type="button" class="io-big big" data-pad="boost" aria-label="Ускорение"><b>⚡</b>быстрее</button>' });
      if (!matchMedia('(pointer: coarse)').matches) ui.pad.classList.add('touch-only');
      cv = ui.cv; ctx = cv.getContext('2d', { alpha: false });
      el.addEventListener('click', onClick);
      el.addEventListener('change', onChange);
      ui.pad.addEventListener('pointerdown', padDown);
      on(window, 'pointerup', padUp); on(window, 'pointercancel', padUp);
      stick = K.touchStick(ui.wrap, { zone: () => mode === 'play' && ui.ov.hidden });
      on(cv, 'pointermove', e => { if (e.pointerType === 'mouse') { const r = cv.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * (cssW / (r.width || 1)); mouse.y = (e.clientY - r.top) * (cssH / (r.height || 1)); mouse.on = true; } });
      on(cv, 'pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) mouse.down = true; });
      on(window, 'pointerup', e => { if (e.pointerType === 'mouse') mouse.down = false; });
      on(cv, 'contextmenu', e => e.preventDefault());
      on(window, 'keydown', onKey); on(window, 'keyup', onKey);
      on(window, 'blur', () => { keys.l = keys.r = keys.b = 0; mouse.down = false; boostBtn = false; });
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
      try { flushLife(); } catch (e) {}
      stopSession();
      for (const [t, ev, fn, o] of listeners.splice(0)) t.removeEventListener(ev, fn, o);
      ro?.disconnect(); ro = null;
      stick?.off(); stick = null;
      host?.removeEventListener('click', onClick); host?.removeEventListener('change', onChange);
      host = null; ui = null; cv = null; ctx = null; mode = 'menu'; api = null;
    },
    _test: { SIM, PATTERNS, PRESETS, skinOk, presetSkin, rwOf, bodyLen, turnOf, boostCost, viewArea, colIdx, pelletXY, wrapA,
      C: { DT, R, SP, MAXO, MAXP, ZONE, ZN, KS, NP, FCAP, L0, BOOST_MIN, SPEED, BOOSTV, PROT, ROUND, END, MERCY, TOTAL, MINB, A0 },
      fNew, compactFood, think, knockout, spawnOwner, frame: t => frame(t), get S(){ return S; }, get cam(){ return cam; },
      stress(o = {}){
        if (!S || !S.W) return null;
        const W = S.W;
        W.botWant = MAXO - 1;
        for (let k = 0; k < MAXO; k++) if (!W.owners[k]) SIM.addOwner(W, { key: 'bot', name: botName(W), skin: null, bot: true, spawn: true });
        // длинные червячки — тяжелее всего рисовать и считать
        for (const q of W.owners) if (q && q.alive && q.L < (o.len || 1500)) q.L = o.len || 1500;
        const gs = [];
        for (let i = 0; i < MAXO && gs.length < (o.guests ?? 9); i++) if (W.owners[i] && i !== S.me) gs.push({ i, g: { aspect: .45, inTs: 1, hold: 5 } });
        const st = { bytes: 0, snaps: 0, ms: new Float32Array(4000), t: new Float64Array(4000), n: 0 };
        st.dr = new Float32Array(4000); st.en = new Float32Array(4000); st.st = new Float32Array(4000);
        PERF = st;
        let enAcc = 0;
        S.afterStep = W2 => { if (W2.step % 2) return; const a = performance.now(); for (const x of gs) { const v = SIM.encode(W2, x.i, x.g); st.bytes += v.byteLength; st.snaps++; } enAcc += performance.now() - a; };
        S.onWork = (ms, t) => { if (st.n < 4000) { st.ms[st.n] = ms; st.t[st.n] = t; st.en[st.n] = enAcc; st.st[st.n] = ms - st.dr[st.n] - enAcc; enAcc = 0; st.n++; } };
        return st;
      } },
  };
})();

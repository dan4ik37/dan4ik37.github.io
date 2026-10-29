// ═══════════════════════════════════════
//  ИГРА «ПУЗЫРИ» (T-140) — целься и стреляй пузырями: три одинаковых рядом лопаются. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, соты: чётные ряды — 9 пузырей, сдвинутые — 8. Скорость
// пузыря — единиц поля в секунду, 4 подшага. Партия — 2 минуты или пока пузыри не опустятся к красной линии.
// Своё: каждые 8 выстрелов сверху добавляется ряд; каждый 12-й пузырь — 💥 бомба (лопает всё вокруг на два кольца);
// тап по пушке (или ↓) — поменять текущий и следующий пузырь; с 40-го выстрела — пятый цвет; пузыри, оторванные от потолка,
// падают и дают вдвое больше очков; поле очищено — +300 и новые ряды.
// Исправлено против прототипа: (1) полёт «за кадр» — на 144 Гц пузырь летел в 2,4 раза быстрее; теперь шаг 60 Гц, 4 подшага;
// (2) пузырь вставал в первую пустую клетку НИЖЕ занятой (while G[cy][cx] ≥ 0 → cy++) — мог «пройти» сквозь пузыри; теперь
// ближайшая пустая клетка, касающаяся соседей или потолка; (3) квадратная сетка с соседями крестом — теперь соты (6 соседей);
// (4) Set, строки-ключи, map/filter/split в каждой заливке и G.some(...) каждый подшаг (мусор) — теперь типизированные массивы
// и стек; (5) отражение от стены без возврата в поле (пузырь мог «дрожать» у стены); (6) Math.random — rng (у соперников
// одинаковые пузыри и ряды); (7) после конца тап сразу начинал заново; (8) у партии не было конца по времени.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, COLS = 9, ROWS = 14, R = 17, D = 34, RH = 29.445, X0 = 7, Y0 = 4, SX = 160, SY = 408, LOSE = 11;
  const SPD = 780, SUB = 4, DROP = 8, TIME = 120 * 60, BOMB = 5, NF = 96, KEYW = 1.6, AMIN = -Math.PI + .17, AMAX = -.17;
  const N = ROWS * COLS;
  const DR = Int8Array.of(0, 0, -1, -1, 1, 1), DC0 = Int8Array.of(-1, 1, -1, 0, -1, 0), DC1 = Int8Array.of(-1, 1, 0, 1, 0, 1);
  const COL = ['#ff4d6d', '#ffc233', '#35e0c3', '#6f7bff', '#c38bff', '#2b2b3a'];
  const C = { bg: '#141629', wall: 'rgba(255,255,255,.05)', lose: '#ff2d55', aim: 'rgba(255,255,255,.45)', shine: 'rgba(255,255,255,.4)', base: '#3a3f5c', baseL: '#5a6088',
    ring: '#ff8a3d', fuse: '#ffd166', swap: 'rgba(255,255,255,.55)' };

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  // два потока: 0 — пузыри пушки и новые ряды (одинаковы у соперников при любой игре), 1 — новые ряды после очистки поля
  function rnd(s, q){ let x = s.rs[q]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[q] = x; return x >>> 8; }
  const shifted = (s, r) => ((r + s.par) & 1) === 1;
  const ncols = (s, r) => (shifted(s, r) ? COLS - 1 : COLS);
  const cx = (s, r, c) => X0 + R + c * D + (shifted(s, r) ? R : 0);
  const cy = r => Y0 + R + r * RH;
  const color = (s, q) => rnd(s, q) % (s.shots >= 40 ? 5 : 4);

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1, (rng() * 4294967296) | 0 || 7), t: 0, left: TIME, score: 0, over: false, why: '', snd: 0,
      par: 0, cur: 0, nxt: 0, ang: -Math.PI / 2, held: 0, want: 0, shots: 0, rows: 0, popped: 0, dropped: 0, clears: 0, bombs: 0, gen: 0,
      shot: 0, sx: 0, sy: 0, sx0: 0, sy0: 0, vx: 0, vy: 0, sc: 0, flash: 0,
      g: new Int8Array(N).fill(-1), mark: new Uint16Array(N), stk: new Int16Array(N), grp: new Int16Array(N),
      fx: new Float64Array(NF), fy: new Float64Array(NF), fx0: new Float64Array(NF), fy0: new Float64Array(NF), fvx: new Float64Array(NF), fvy: new Float64Array(NF), fc: new Int8Array(NF), fon: new Uint8Array(NF) };
    fill(s, 5, 0);
    s.cur = color(s, 0); s.nxt = color(s, 0);
    return s;
  }

  function fill(s, n, q){ for (let r = 0; r < n; r++) for (let c = 0; c < COLS; c++) s.g[r * COLS + c] = c < ncols(s, r) ? color(s, q) : -1; }

  // ряд сверху: всё сдвигается вниз, чётность рядов меняется (сдвинутый ряд остаётся сдвинутым)
  function addRow(s){
    for (let r = ROWS - 1; r > 0; r--) for (let c = 0; c < COLS; c++) s.g[r * COLS + c] = s.g[(r - 1) * COLS + c];
    s.par ^= 1;
    for (let c = 0; c < COLS; c++) s.g[c] = c < ncols(s, 0) ? color(s, 0) : -1;
    s.rows++; s.flash = 12;
  }

  function nextGen(s){ if (++s.gen > 65000) { s.mark.fill(0); s.gen = 1; } return s.gen; }

  // заливка от клетки i: same = 1 — того же цвета, 0 — любые занятые; клетки — в s.grp, ответ — сколько
  function flood(s, i, same){
    const gen = nextGen(s), want = s.g[i];
    let sp = 0, n = 0;
    s.mark[i] = gen; s.stk[sp++] = i;
    while (sp) {
      const k = s.stk[--sp], r = (k / COLS) | 0, c = k - r * COLS, dc = shifted(s, r) ? DC1 : DC0;
      s.grp[n++] = k;
      for (let q = 0; q < 6; q++) {
        const rr = r + DR[q], cc = c + dc[q];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= ncols(s, rr)) continue;
        const j = rr * COLS + cc, v = s.g[j];
        if (v < 0 || s.mark[j] === gen || (same && v !== want)) continue;
        s.mark[j] = gen; s.stk[sp++] = j;
      }
    }
    return n;
  }

  function fall(s, i){
    const v = s.g[i];
    s.g[i] = -1;
    for (let f = 0; f < NF; f++) {
      if (s.fon[f]) continue;
      const r = (i / COLS) | 0;
      s.fon[f] = 1; s.fc[f] = v; s.fx[f] = cx(s, r, i - r * COLS); s.fy[f] = cy(r); s.fx0[f] = s.fx[f]; s.fy0[f] = s.fy[f];
      s.fvx[f] = ((i * 37 + s.shots * 11) % 121) - 60; s.fvy[f] = -60 - (i * 53) % 80;   // без rng: поток пузырей не зависит от игры
      return;
    }
  }

  // оторванные от потолка — падают (+20 за каждый)
  function drops(s){
    const gen = nextGen(s);
    let sp = 0, n = 0;
    for (let c = 0; c < COLS; c++) if (s.g[c] >= 0) { s.mark[c] = gen; s.stk[sp++] = c; }
    while (sp) {
      const k = s.stk[--sp], r = (k / COLS) | 0, c = k - r * COLS, dc = shifted(s, r) ? DC1 : DC0;
      for (let q = 0; q < 6; q++) {
        const rr = r + DR[q], cc = c + dc[q];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= ncols(s, rr)) continue;
        const j = rr * COLS + cc;
        if (s.g[j] < 0 || s.mark[j] === gen) continue;
        s.mark[j] = gen; s.stk[sp++] = j;
      }
    }
    for (let i = 0; i < N; i++) if (s.g[i] >= 0 && s.mark[i] !== gen) { fall(s, i); n++; }
    return n;
  }

  function attached(s, r, c){
    if (r === 0) return true;
    const dc = shifted(s, r) ? DC1 : DC0;
    for (let q = 0; q < 6; q++) {
      const rr = r + DR[q], cc = c + dc[q];
      if (rr >= 0 && rr < ROWS && cc >= 0 && cc < ncols(s, rr) && s.g[rr * COLS + cc] >= 0) return true;
    }
    return false;
  }

  // пузырь встал: ближайшая пустая клетка рядом с соседями (или у потолка), потом лопание, падение, ряды, конец
  function land(s){
    let rr = Math.round((s.sy - Y0 - R) / RH);
    rr = rr < 0 ? 0 : rr > ROWS - 1 ? ROWS - 1 : rr;
    let best = -1, bd = 1e9;
    for (let r = rr - 1; r <= rr + 1; r++) {
      if (r < 0 || r >= ROWS) continue;
      const n = ncols(s, r);
      for (let c = 0; c < n; c++) {
        if (s.g[r * COLS + c] >= 0 || !attached(s, r, c)) continue;
        const dx = cx(s, r, c) - s.sx, dy = cy(r) - s.sy, q = dx * dx + dy * dy;
        if (q < bd) { bd = q; best = r * COLS + c; }
      }
    }
    s.shot = 0;
    if (best < 0) return;
    const br = (best / COLS) | 0, bc = best - br * COLS;
    if (s.sc === BOMB) {
      // 💥 бомба: всё в двух кольцах вокруг
      let n = 0;
      const x = cx(s, br, bc), y = cy(br);
      for (let i = 0; i < N; i++) {
        if (s.g[i] < 0) continue;
        const r = (i / COLS) | 0, dx = cx(s, r, i - r * COLS) - x, dy = cy(r) - y;
        if (dx * dx + dy * dy <= 72 * 72) { fall(s, i); n++; }
      }
      s.popped += n; s.score += n * 10; s.bombs++; s.snd = 196; s.flash = 10;
    } else {
      s.g[best] = s.sc;
      const n = flood(s, best, 1);
      if (n >= 3) {
        for (let k = 0; k < n; k++) fall(s, s.grp[k]);
        s.popped += n; s.score += n * 10; s.snd = 523 + (n > 6 ? 6 : n) * 60;
      } else s.snd = 'tick';
    }
    const m = drops(s);
    if (m) { s.dropped += m; s.score += m * 20; s.snd = 'ok'; }
    let any = 0;
    for (let i = 0; i < N; i++) any |= s.g[i] >= 0 ? 1 : 0;
    if (!any) { s.clears++; s.score += 300; s.snd = 'win'; fill(s, 5, 1); }
    if (s.shots % DROP === 0) addRow(s);
    for (let i = LOSE * COLS; i < N; i++) if (s.g[i] >= 0) { s.over = true; s.why = 'full'; s.snd = 'bad'; return; }
  }

  function aim(s, x, y){
    let a = Math.atan2(y - SY, x - SX);
    if (y > SY - 6) a = x < SX ? AMIN : AMAX;
    s.ang = a < AMIN ? AMIN : a > AMAX ? AMAX : a;
  }
  function swap(s){ if (s.cur === s.nxt) return; const t = s.cur; s.cur = s.nxt; s.nxt = t; s.snd = 'move'; }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN) {
      if (e.y > SY - 26 && Math.abs(e.x - SX) < 34) { s.held = 0; swap(s); return; }
      s.held = 1; aim(s, e.x, e.y);
    } else if (e.type === T.MOVE && s.held) aim(s, e.x, e.y);
    else if (e.type === T.UP && s.held) { s.held = 0; aim(s, e.x, e.y); s.want = 1; }
    else if (e.type === T.KEY) { if (e.k === 2) s.want = 1; else if (e.k === 3) swap(s); }
    else if (e.type === T.CANCEL) s.held = 0;   // пауза / потеря фокуса — прицел отпущен без выстрела
  }

  function fire(s){
    s.shot = 1; s.sc = s.cur; s.sx = SX; s.sy = SY; s.sx0 = SX; s.sy0 = SY;
    s.vx = Math.cos(s.ang) * SPD; s.vy = Math.sin(s.ang) * SPD;
    s.shots++;
    s.cur = s.nxt;
    s.nxt = (s.shots + 2) % 12 === 0 ? BOMB : color(s, 0);   // nxt полетит выстрелом shots + 2: каждый 12-й — бомба
    s.want = 0; s.snd = 'move';
  }

  function hit(s){
    let rr = Math.round((s.sy - Y0 - R) / RH);
    for (let r = rr - 1; r <= rr + 1; r++) {
      if (r < 0 || r >= ROWS) continue;
      const n = ncols(s, r), y = cy(r);
      for (let c = 0; c < n; c++) {
        if (s.g[r * COLS + c] < 0) continue;
        const dx = cx(s, r, c) - s.sx, dy = y - s.sy;
        if (dx * dx + dy * dy < 30 * 30) return true;
      }
    }
    return false;
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.t++;
    s.left = TIME - s.t;
    s.flash = s.flash > 0 ? s.flash - 1 : 0;
    const keys = inp ? inp.keys : 0;
    if (keys & 3) { const a = s.ang + ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYW * dt; s.ang = a < AMIN ? AMIN : a > AMAX ? AMAX : a; }
    if (s.want && !s.shot) fire(s);
    s.sx0 = s.sx; s.sy0 = s.sy;
    if (s.shot) {
      const h = dt / SUB;
      for (let k = 0; k < SUB && s.shot; k++) {
        s.sx += s.vx * h; s.sy += s.vy * h;
        if (s.sx < X0 + R) { s.sx = X0 + R; s.vx = Math.abs(s.vx); }
        else if (s.sx > W - X0 - R) { s.sx = W - X0 - R; s.vx = -Math.abs(s.vx); }
        if (s.sy <= Y0 + R || hit(s)) land(s);
      }
    }
    for (let f = 0; f < NF; f++) {
      if (!s.fon[f]) continue;
      s.fx0[f] = s.fx[f]; s.fy0[f] = s.fy[f];
      s.fvy[f] += 1400 * dt; s.fx[f] += s.fvx[f] * dt; s.fy[f] += s.fvy[f] * dt;
      if (s.fy[f] > H + 30) s.fon[f] = 0;
    }
    if (!s.over && s.left <= 0) { s.over = true; s.why = 'time'; s.snd = 'win'; }
  }

  // ── рисование ──
  function balls(ctx, s, v, k){
    ctx.fillStyle = COL[v];
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (s.g[i] !== v) continue;
      const r = (i / COLS) | 0, x = cx(s, r, i - r * COLS), y = cy(r);
      ctx.moveTo(x + R - 1, y); ctx.arc(x, y, R - 1, 0, 6.2832);
    }
    for (let f = 0; f < NF; f++) {
      if (!s.fon[f] || s.fc[f] !== v) continue;
      const x = s.fx0[f] + (s.fx[f] - s.fx0[f]) * k, y = s.fy0[f] + (s.fy[f] - s.fy0[f]) * k;
      ctx.moveTo(x + R - 3, y); ctx.arc(x, y, R - 3, 0, 6.2832);
    }
    ctx.fill();
  }
  function bubble(ctx, v, x, y, r){
    ctx.fillStyle = COL[v]; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    if (v === BOMB) { ctx.strokeStyle = C.ring; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r - 3, 0, 6.2832); ctx.stroke(); ctx.fillStyle = C.fuse; ctx.fillRect(x - 2, y - r - 5, 4, 7); }
    else { ctx.fillStyle = C.shine; ctx.fillRect(x - r * .5, y - r * .55, r * .35, r * .3); }
  }

  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.wall; ctx.fillRect(0, 0, X0, H); ctx.fillRect(W - X0, 0, X0, H);
    if (s.flash) { ctx.fillStyle = C.wall; ctx.fillRect(0, 0, W, H); }
    // красная линия
    ctx.fillStyle = C.lose;
    const ly = cy(LOSE) - R;
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, ly, 9, 2);
    for (let v = 0; v <= BOMB; v++) balls(ctx, s, v, k);
    // блики на пузырях поля
    ctx.fillStyle = C.shine; ctx.beginPath();
    for (let i = 0; i < N; i++) { if (s.g[i] < 0) continue; const r = (i / COLS) | 0; ctx.rect(cx(s, r, i - r * COLS) - 8, cy(r) - 9, 6, 5); }
    ctx.fill();
    // прицел: точки до первой стены и после отскока
    if (!s.over && !s.shot) {
      ctx.fillStyle = C.aim;
      let x = SX, y = SY, dx = Math.cos(s.ang) * 14, dy = Math.sin(s.ang) * 14;
      for (let i = 0; i < 16; i++) {
        x += dx; y += dy;
        if (x < X0 + R) { x = 2 * (X0 + R) - x; dx = -dx; } else if (x > W - X0 - R) { x = 2 * (W - X0 - R) - x; dx = -dx; }
        if (y < Y0 + R) break;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }
    // пушка, текущий и следующий пузырь (тап по пушке — поменять)
    ctx.fillStyle = C.base; ctx.fillRect(SX - 30, SY + 14, 60, 18);
    ctx.fillStyle = C.baseL; ctx.fillRect(SX - 22, SY + 10, 44, 6);
    if (s.shot) bubble(ctx, s.sc, s.sx0 + (s.sx - s.sx0) * k, s.sy0 + (s.sy - s.sy0) * k, R - 1);
    else bubble(ctx, s.cur, SX, SY, R - 1);
    bubble(ctx, s.nxt, SX + 52, SY + 14, 10);
    ctx.fillStyle = C.swap; ctx.fillRect(SX + 30, SY + 13, 10, 2);
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('bubbles', {
    kind: 'canvas', W, H, drag: true,
    title: '🫧 Пузыри',
    intro: 'Целься пальцем и отпусти — пузырь полетит. Три и больше одного цвета рядом лопаются, оторванные падают (×2 очков). Каждые 8 выстрелов сверху новый ряд. 💥 бомба — каждый 12-й. 2 минуты.',
    controls: 'Веди пальцем и отпусти — выстрел. Тап по пушке — поменять пузыри. Клавиатура: ← → прицел, пробел — выстрел, ↓ — поменять.',
    duelTitle: 'Одинаковые пузыри у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, Space: 2, ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3 },
    create, input, step, draw,
    hudKey: s => (DROP - s.shots % DROP) * 1e4 + Math.ceil(s.left / 60),
    hud: s => 'новый ряд через ' + (DROP - s.shots % DROP) + ' · ⏱ ' + clock(s.left),
    win: s => s.popped + s.dropped >= 60 || s.clears > 0,
    result: s => ({
      title: s.clears ? '✨ Поле чистое!' : s.why === 'time' ? '⏰ Время вышло' : '🫧 Пузыри опустились',
      text: 'лопнуло: ' + s.popped + ' · упало: ' + s.dropped + (s.clears ? ' · очищено полей: ' + s.clears : ''),
    }),
    consts: { W, H, COLS, ROWS, R, D, RH, X0, Y0, SX, SY, LOSE, SPD, SUB, DROP, TIME, BOMB, AMIN, AMAX },
  });
})();

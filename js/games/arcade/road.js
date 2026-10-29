// ═══════════════════════════════════════
//  ИГРА «ПЕРЕЙДИ ДОРОГУ» (T-140) — ёжик идёт домой через дороги: тап — шаг вперёд, свайп — вбок или назад. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440 = 8 клеток × 11 рядов по 40; машины — единиц в секунду.
// Своё: герой — ёжик; на лужайках растут 🍄 грибы (+3) и кусты (сквозь них не пройти); прогулка — 2 минуты, очки — дальний ряд + грибы.
// Исправлено против прототипа: (1) машины и камера — за кадр → в секунду (на 144 Гц прототип ехал в 2,4 раза быстрее);
// (2) Math.random → rng (у соперников одна дорога); (3) машины в рядах вне экрана стояли (двигались только ряды рядом с героем),
// а машины одного ряда «переезжали» друг друга и сбивались в сплошную стену — теперь положение = функция общего времени
// с периодом ряда, между машинами всегда ≥ 2 клетки; (4) массив рядов рос всю игру — кольцо на 32 ряда;
// (5) свайп мерили в пикселях экрана (на большом экране тот же жест — тап) — теперь в единицах поля; (6) назад ходить было нельзя,
// а стоять можно бесконечно — шаг назад (до 3 рядов от лучшего) и 2 минуты на прогулку, партия всегда кончается;
// (7) тап после «сбили» сразу начинал заново — итог ядра; (8) нажатия во время прыжка терялись — одно запоминается.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, CELL = 40, COLS = 8, BASE = 340, RING = 32, M = RING - 1;
  const LIMIT = 120, HOP = .12, BACK = 3, SWIPE = 16, VMIN = 50, VSPAN = 60, VROW = .6, VMAX = 220;
  const UP = 0, LEFT = 1, RIGHT = 2, DOWN = 3;
  const C = { grass: '#2f7d47', grass2: '#2b7341', road: '#2c2f3a', dash: 'rgba(255,255,255,.25)', bush: '#1e5631', bush2: '#25683b',
    cap: '#e8590c', capDot: '#fff4e6', stem: '#f1e3c8', glass: 'rgba(20,24,38,.75)',
    body: '#8d5a3b', spike: '#4a2f1f', face: '#f1d3b3', nose: '#1b1b1b', hit: '#ff4d6d' };
  const CARC = ['#ff6b6b', '#ffd43b', '#4dabf7', '#b197fc', '#63e6be'], DASH = [20, 20], SOLID = [];

  // ряд i: 0 — лужайка, 1 — дорога (машины: скорость, период, до 3 машин), кусты — битовая маска, гриб — колонка или −1
  function gen(s, i){
    const j = i & M, r = s.rng;
    let road = i < 3 ? 0 : r() < .6 ? 1 : 0;
    if (road && s.roads >= (i < 20 ? 2 : 4)) road = 0;        // не больше 2 (потом 4) дорог подряд
    s.roads = road ? s.roads + 1 : 0;
    s.rt[j] = road; s.rb[j] = 0; s.rm[j] = -1; s.rk[j] = 0;
    if (road) {
      const sp = Math.min(VMAX, VMIN + r() * VSPAN + VROW * i);
      s.rv[j] = r() < .5 ? sp : -sp;
      const P = 380 + r() * 160, k = P >= 520 ? 3 : P >= 450 && r() < .7 ? 2 : r() < .5 ? 2 : 1;
      let used = 0;
      for (let c = 0; c < k; c++) { s.rw[j * 3 + c] = 36 + r() * 24; used += s.rw[j * 3 + c] + 2 * CELL; }
      let x = r() * P, slack = P - used;
      if (slack < 0) slack = 0;
      for (let c = 0; c < k; c++) { s.ro[j * 3 + c] = x; s.rc[j * 3 + c] = Math.floor(r() * 5); x += s.rw[j * 3 + c] + 2 * CELL + r() * slack / k; }
      s.rp[j] = P; s.rk[j] = k;
    } else if (i >= 3) {
      // кусты — только если соседние ряды не «кустистые» лужайки (из любой колонки всегда есть путь вперёд)
      if (!s.lastBush && r() < .55) {
        const n = 1 + Math.floor(r() * 3);
        for (let c = 0; c < n; c++) s.rb[j] |= 1 << Math.floor(r() * COLS);
      }
      if (r() < .45) { let c = Math.floor(r() * COLS), g = 0; while ((s.rb[j] >> c) & 1 && g++ < 8) c = (c + 1) % COLS; if (!((s.rb[j] >> c) & 1)) s.rm[j] = c; }
    }
    s.lastBush = s.rb[j] !== 0;
  }
  const carX = (s, j, c, t) => { const P = s.rp[j], x = (s.ro[j * 3 + c] + s.rv[j] * t) % P; return (x < 0 ? x + P : x) - (P - W); };

  function create(rng){
    const s = { rng, rt: new Uint8Array(RING), rv: new Float64Array(RING), rp: new Float64Array(RING), rk: new Uint8Array(RING), ro: new Float64Array(RING * 3),
      rw: new Float64Array(RING * 3), rc: new Uint8Array(RING * 3), rb: new Uint8Array(RING), rm: new Int8Array(RING), made: 0, roads: 0, lastBush: false,
      col: 3, row: 0, pcol: 3, prow: 0, best: 0, shrooms: 0, hop: 0, buf: -1, cam: 0, pcam: 0, t: 0, pt: 0,
      started: false, skipUp: false, px: 0, py: 0, press: false, score: 0, over: false, why: '', snd: 0, seq: new Float32Array(8) };
    while (s.made < 14) gen(s, s.made++);
    for (let i = 0; i < 8; i++) s.seq[i] = s.rv[(3 + i) & M];   // для ⚔️ сравнения: скорости первых рядов одинаковы у соперников
    return s;
  }

  function move(s, d){
    let c = s.col, r = s.row;
    if (d === UP) r++; else if (d === DOWN) r--; else if (d === LEFT) c--; else c++;
    if (c < 0 || c >= COLS || r < 0 || r < s.best - BACK || ((s.rb[r & M] >> c) & 1)) { s.snd = 'tick'; return; }
    s.pcol = s.col; s.prow = s.row; s.col = c; s.row = r; s.hop = HOP; s.snd = 'move';
    if (s.rm[r & M] === c) { s.rm[r & M] = -1; s.shrooms++; s.snd = 1047; }
    if (r > s.best) s.best = r;
    s.score = s.best + 3 * s.shrooms;
    while (s.made < s.row + 13) gen(s, s.made++);
  }

  function input(s, e){
    if (s.over) return;
    if (!s.started) { if (e.type === T.DOWN || e.type === T.KEY) { s.started = true; s.skipUp = e.type === T.DOWN; s.snd = 'move'; } return; }   // первый тап — старт
    let d = -1;
    if (e.type === T.DOWN) { s.press = true; s.px = e.x; s.py = e.y; return; }
    if (e.type === T.UP) {
      if (s.skipUp) { s.skipUp = false; s.press = false; return; }
      if (!s.press) return;
      s.press = false;
      const dx = e.x - s.px, dy = e.y - s.py, ax = dx < 0 ? -dx : dx;
      d = ax > SWIPE && ax >= (dy < 0 ? -dy : dy) ? (dx < 0 ? LEFT : RIGHT) : dy > SWIPE ? DOWN : UP;
    } else if (e.type === T.KEY) d = e.k;
    if (d < 0) return;
    if (s.hop > 0) { s.buf = d; return; }   // прыжок ещё идёт — шаг запомнили
    move(s, d);
  }

  function step(s, dt){
    s.pcam = s.cam; s.pt = s.t;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'time'; s.snd = 'win'; return; }
    if (s.hop > 0) { s.hop -= dt; if (s.hop <= 0) { s.hop = 0; if (s.buf >= 0) { const d = s.buf; s.buf = -1; move(s, d); } } }
    s.cam += (s.row - s.cam) * (1 - Math.exp(-10 * dt));
    const j = s.row & M;
    if (s.rt[j]) {
      const x0 = s.col * CELL + 6, x1 = x0 + CELL - 12;
      for (let c = 0; c < s.rk[j]; c++) { const x = carX(s, j, c, s.t); if (x < x1 && x + s.rw[j * 3 + c] > x0) { s.over = true; s.why = 'hit'; s.snd = 'bad'; return; } }
    }
  }

  function hedgehog(ctx, x, y, dead){
    ctx.fillStyle = dead ? C.hit : C.spike;
    ctx.beginPath(); ctx.moveTo(x - 15, y + 8);
    for (let k = 0; k < 6; k++) { ctx.lineTo(x - 15 + k * 5 + 2.5, y + 13); ctx.lineTo(x - 15 + k * 5 + 5, y + 8); }
    ctx.lineTo(x + 13, y - 6); ctx.lineTo(x - 13, y - 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.body; ctx.beginPath(); ctx.ellipse(x, y + 1, 13, 11, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.face; ctx.beginPath(); ctx.ellipse(x, y - 8, 7, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.nose; ctx.fillRect(x - 1.5, y - 17, 3, 3); ctx.fillRect(x - 4, y - 10, 2, 2); ctx.fillRect(x + 2, y - 10, 2, 2);
  }

  function draw(G, s, al){
    const ctx = G.ctx, cam = s.over ? s.cam : s.pcam + (s.cam - s.pcam) * al, tt = s.over ? s.t : s.pt + (s.t - s.pt) * al;
    const i0 = Math.floor(cam) - 3, i1 = Math.ceil(cam) + 9;
    for (let i = i0; i <= i1; i++) {
      const y = BASE - (i - cam) * CELL;
      if (i < 0) { ctx.fillStyle = C.grass2; ctx.fillRect(0, y, W, CELL); continue; }
      const j = i & M;
      if (!s.rt[j]) {
        ctx.fillStyle = i & 1 ? C.grass : C.grass2; ctx.fillRect(0, y, W, CELL);
        const b = s.rb[j];
        if (b) { ctx.fillStyle = C.bush; for (let c = 0; c < COLS; c++) if ((b >> c) & 1) { ctx.beginPath(); ctx.arc(c * CELL + 20, y + 21, 16, 0, 6.2832); ctx.fill(); } }
        const m = s.rm[j];
        if (m >= 0) {
          const x = m * CELL + 20;
          ctx.fillStyle = C.stem; ctx.fillRect(x - 4, y + 20, 8, 12);
          ctx.fillStyle = C.cap; ctx.beginPath(); ctx.arc(x, y + 21, 12, 3.1416, 6.2832); ctx.fill();
          ctx.fillStyle = C.capDot; ctx.fillRect(x - 6, y + 13, 3, 3); ctx.fillRect(x + 3, y + 15, 3, 3);
        }
      } else {
        ctx.fillStyle = C.road; ctx.fillRect(0, y, W, CELL);
        for (let c = 0; c < s.rk[j]; c++) {
          const x = carX(s, j, c, tt), w = s.rw[j * 3 + c];
          if (x > W || x + w < 0) continue;
          ctx.fillStyle = CARC[s.rc[j * 3 + c]]; ctx.fillRect(x, y + 7, w, 26);
          ctx.fillStyle = C.glass; ctx.fillRect(s.rv[j] > 0 ? x + w - 14 : x + 4, y + 10, 10, 20);
        }
      }
    }
    // ёжик: прыжок — между клетками за HOP секунд
    const hl = s.hop > 0 ? s.hop + (1 - al) / 60 : 0, k = hl > 0 ? 1 - (hl < HOP ? hl : HOP) / HOP : 1;   // остаток прыжка на момент кадра
    const hx = (s.pcol + (s.col - s.pcol) * k) * CELL + 20, hr = s.prow + (s.row - s.prow) * k, hy = BASE - (hr - cam) * CELL + 22 - (k < 1 ? Math.sin(k * 3.1416) * 6 : 0);
    // разметка дорог — один пунктир на ряд (а не 8 прямоугольников)
    ctx.strokeStyle = C.dash; ctx.lineWidth = 2; ctx.setLineDash(DASH); ctx.beginPath();
    for (let i = i0 < 0 ? 0 : i0; i <= i1; i++) if (s.rt[i & M]) { const y = BASE - (i - cam) * CELL + CELL - 1; ctx.moveTo(8, y); ctx.lineTo(W, y); }
    ctx.stroke(); ctx.setLineDash(SOLID);
    hedgehog(ctx, hx, hy, s.over && s.why === 'hit');
  }

  ArcadeKit.define('road', {
    kind: 'canvas', W, H,
    title: '🦔 Перейди дорогу',
    intro: 'Помоги ёжику пройти как можно дальше. Тап — шаг вперёд, свайп — вбок или назад. Машины сбивают, сквозь кусты не пройти. 🍄 гриб — +3. Прогулка — 2 минуты.',
    controls: 'Тап — вперёд, свайп влево / вправо / вниз — вбок или назад. Клавиши: стрелки или W A S D.',
    duelTitle: 'Одинаковая дорога у обоих',
    keys: { ArrowUp: 0, KeyW: 0, Space: 0, ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowDown: 3, KeyS: 3 },
    drag: true,
    create, input, step, draw, gen,   // gen — для тестов генератора рядов (scripts/arcade/road.cjs)
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) * 100 + s.shrooms : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с · ряд ' + s.best + (s.shrooms ? ' · 🍄 ' + s.shrooms : '') : 'Тап — старт'),
    win: s => s.best >= 30,
    result: s => ({
      title: s.why === 'time' ? (s.best >= 60 ? '🏆 Дальняя прогулка!' : '⏱ Прогулка окончена') : '💥 Ёжика сбила машина',
      text: 'рядов: ' + s.best + (s.shrooms ? ' · 🍄 ' + s.shrooms : ''),
    }),
    consts: { W, H, CELL, COLS, BASE, RING, LIMIT, HOP, BACK, SWIPE, VMIN, VSPAN, VROW, VMAX, UP, LEFT, RIGHT, DOWN },
  });
})();

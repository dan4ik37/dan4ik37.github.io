// ═══════════════════════════════════════
//  ИГРА «КИРПИЧИКИ» (T-140) — веди дощечку, отбивай мяч и разбивай стенки. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — в единицах поля за секунду. Партия — 2 минуты
// или 3 мяча; стенки идут одна за другой (каждая быстрее), за каждый оставшийся мяч в конце +50.
// Своё: стенки собираются из rng зеркально (узор), 🧱 крепкие кирпичи (2 удара), ⭐ звёздный кирпич — дощечка шире на 8 с.
// Исправлено против прототипа: (1) движение было «за кадр» — на 144 Гц мяч летал в 2,4 раза быстрее; теперь шаг 60 Гц и
// 4 подшага (мяч не проскакивает кирпич и дощечку); (2) удар о БОК кирпича разворачивал мяч по вертикали — он «прошивал»
// ряды; теперь отражение по оси наименьшего проникновения; (3) за кадр разбивался только один кирпич, а проверка «стенка
// пуста» (br.some) шла каждый кадр — теперь счётчик; (4) запуск всегда вправо — теперь к центру поля; (5) после конца
// партии любой тап сразу начинал новую (поздний тап) — теперь кнопка ядра; (6) скорость росла без предела; (7) у партии не
// было конца по времени — для соревнования общий предел 2 минуты.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440;
  const COLS = 8, ROWS = 7, BW = 37, BH = 15, PX = 39, PY = 19, X0 = 4, Y0 = 52;
  const PY0 = 404, PH = 10, PW = 64, PWW = 96, R = 6;
  const PADV = 1100, KEYV = 430;             // дощечка: за пальцем / клавишами, единиц в секунду
  const V0 = 300, DVL = 22, VMAX = 470;      // мяч: скорость стенки 1, прибавка за стенку, предел
  const TIME = 120 * 60, SERVE = 150, WIDE = 8 * 60, SUB = 4;
  const LIVES = 3;
  // цвета рядов и кирпичей (тёмный «остров» поля)
  const ROWC = ['#ff4d6d', '#ff8a3d', '#ffc233', '#7ae582', '#35e0c3', '#5aa9ff', '#a78bfa'];
  const C = { bg: '#121527', grid: 'rgba(255,255,255,.035)', pad: '#f1f2f8', padW: '#ffd166', ball: '#ffffff', crack: 'rgba(10,10,20,.45)', star: '#ffd166', starInk: '#6b4500', lost: 'rgba(255,45,85,.25)' };

  function wall(s){
    const rows = Math.min(ROWS, 4 + s.level), lv = s.level, b = s.b;
    let n = 0;
    b.fill(0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < COLS / 2; c++) {
        const u = s.rng();
        const t = lv > 1 && u < .14 ? 0 : u > 1 - Math.min(.45, .08 + .07 * lv) ? 2 : 1;
        b[r * COLS + c] = t; b[r * COLS + COLS - 1 - c] = t;
        if (t) n += 2;
      }
    }
    // ⭐ одна-две звезды на месте обычных кирпичей
    for (let k = 0, stars = lv > 2 ? 2 : 1, guard = 0; k < stars && guard < 50; guard++) {
      const i = Math.floor(s.rng() * rows * COLS);
      if (b[i] === 1) { b[i] = 3; k++; }
    }
    if (!n) { b[0] = 1; n = 1; }
    for (let i = 0; i < b.length; i++) s.hp[i] = b[i] === 2 ? 2 : b[i] ? 1 : 0;
    s.left = n;
  }

  function serve(s){
    s.stuck = SERVE; s.bx = s.px; s.by = PY0 - R - .5; s.vx = 0; s.vy = 0;
    s.bx0 = s.bx; s.by0 = s.by;
  }
  function speed(s){ return Math.min(VMAX, V0 + DVL * (s.level - 1)); }
  function launch(s){
    if (!s.stuck) return;
    const v = speed(s), dir = s.px < W / 2 ? 1 : -1;
    s.vx = v * .42 * dir; s.vy = -Math.sqrt(v * v - s.vx * s.vx);
    s.stuck = 0; s.snd = 'move';
  }

  function create(rng){
    const s = { rng, level: 1, score: 0, lives: LIVES, t: TIME, over: false, why: '', snd: 0, bricks: 0, bonus: 0,
      px: W / 2, px0: W / 2, tx: W / 2, h: .5, pw: PW, bx: 0, by: 0, bx0: 0, by0: 0, vx: 0, vy: 0, stuck: 0, wide: 0, left: 0, flash: 0,
      b: new Uint8Array(COLS * ROWS), hp: new Uint8Array(COLS * ROWS) };
    wall(s);
    serve(s);
    return s;
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) {
      s.tx = e.x;
      if (e.type === T.DOWN) launch(s);
    } else if (e.type === T.KEY && e.k === 2) launch(s);
  }

  function hitBrick(s, i){
    const t = s.b[i];
    if (--s.hp[i] > 0) { s.score += 10; s.snd = 330; return; }
    s.b[i] = 0; s.left--; s.bricks++;
    s.score += t === 3 ? 30 : 10;
    s.snd = t === 3 ? 1047 : 523 + (Math.floor(i / COLS) % 4) * 66;
    if (t === 3) s.wide = WIDE;
  }

  // один подшаг мяча: движение, стены, дощечка, кирпичи (один кирпич на подшаг — мяч движется меньше трети кирпича)
  function ballSub(s){
    const h = s.h, pw = s.pw;
    s.bx += s.vx * h; s.by += s.vy * h;
    if (s.bx < R) { s.bx = R; s.vx = Math.abs(s.vx); }
    else if (s.bx > W - R) { s.bx = W - R; s.vx = -Math.abs(s.vx); }
    if (s.by < R) { s.by = R; s.vy = Math.abs(s.vy); }
    // дощечка: мяч идёт вниз и нижним краем пересёк её верх
    if (s.vy > 0 && s.by + R >= PY0 && s.by - R <= PY0 + PH && s.bx > s.px - pw / 2 - R && s.bx < s.px + pw / 2 + R) {
      const v = speed(s), o = Math.max(-1, Math.min(1, (s.bx - s.px) / (pw / 2)));
      s.vx = o * .85 * v; s.vy = -Math.sqrt(v * v - s.vx * s.vx);
      s.by = PY0 - R; s.snd = 'tick';
    }
    // кирпичи: ближайшая точка прямоугольника; отражение по оси наименьшего проникновения
    // индексы — целые (| 0): дробные индексы в цикле JIT держит «упакованными» числами — мусор на каждом подшаге
    let c0 = ((s.bx - R - X0) / PX) | 0, c1 = ((s.bx + R - X0) / PX) | 0, r0 = ((s.by - R - Y0) / PY) | 0, r1 = ((s.by + R - Y0) / PY) | 0;
    if (c0 < 0) c0 = 0;
    if (c1 > COLS - 1) c1 = COLS - 1;
    if (r0 < 0) r0 = 0;
    if (r1 > ROWS - 1) r1 = ROWS - 1;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * COLS + c;
      if (!s.b[i]) continue;
      const x = X0 + c * PX, y = Y0 + r * PY;
      const qx = s.bx < x ? x : s.bx > x + BW ? x + BW : s.bx, qy = s.by < y ? y : s.by > y + BH ? y + BH : s.by;
      const dx = s.bx - qx, dy = s.by - qy;
      if (dx * dx + dy * dy >= R * R) continue;
      const ox = Math.min(s.bx + R - x, x + BW - (s.bx - R)), oy = Math.min(s.by + R - y, y + BH - (s.by - R));
      if (ox < oy) { if (s.bx < x + BW / 2) { s.vx = -Math.abs(s.vx); s.bx -= ox; } else { s.vx = Math.abs(s.vx); s.bx += ox; } }
      else if (s.by < y + BH / 2) { s.vy = -Math.abs(s.vy); s.by -= oy; } else { s.vy = Math.abs(s.vy); s.by += oy; }
      hitBrick(s, i);
      return;
    }
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.px0 = s.px; s.bx0 = s.bx; s.by0 = s.by;
    if (s.flash) s.flash--;
    const pw = s.wide ? PWW : PW, keys = inp ? inp.keys : 0;
    if (s.wide) s.wide--;
    // дощечка: клавиши — сразу, палец — к цели с пределом скорости
    if (keys & 3) { s.px += ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYV * dt; s.tx = s.px; }
    else { const d = s.tx - s.px, m = PADV * dt; s.px += d > m ? m : d < -m ? -m : d; }
    s.px = Math.max(pw / 2, Math.min(W - pw / 2, s.px));
    if (--s.t <= 0) { s.t = 0; s.bonus = 50 * s.lives; s.score += s.bonus; s.over = true; s.why = 'time'; s.snd = 'win'; return; }
    if (s.stuck) {
      s.bx = s.px; s.bx0 = s.px0;
      if (--s.stuck === 0) { s.stuck = 1; launch(s); }
      return;
    }
    s.h = dt / SUB; s.pw = pw;
    for (let k = 0; k < SUB; k++) {
      ballSub(s);
      if (!s.left) {
        s.score += 100; s.level++; s.snd = 'win'; s.flash = 40;
        wall(s); serve(s); return;
      }
    }
    if (s.by > H + 12) {
      s.lives--; s.snd = 'bad';
      if (s.lives <= 0) { s.over = true; s.why = 'balls'; return; }
      serve(s);
    }
  }

  function draw(G, s, a){
    const ctx = G.ctx, pw = s.wide ? PWW : PW;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.grid;
    for (let x = 40; x < W; x += 40) ctx.fillRect(x, 0, 1, H);
    if (s.flash) { ctx.fillStyle = C.lost; ctx.fillRect(0, 0, W, H); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 12px system-ui, sans-serif';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c, t = s.b[i];
      if (!t) continue;
      const x = X0 + c * PX, y = Y0 + r * PY;
      ctx.fillStyle = t === 3 ? C.star : ROWC[r];
      ctx.fillRect(x, y, BW, BH);
      if (t === 2) {
        ctx.fillStyle = C.crack;
        if (s.hp[i] === 2) { ctx.fillRect(x + 3, y + 3, BW - 6, 2); ctx.fillRect(x + 3, y + BH - 5, BW - 6, 2); }
        else { ctx.fillRect(x + 8, y + 2, 2, BH - 4); ctx.fillRect(x + 20, y + 4, 2, BH - 6); ctx.fillRect(x + 8, y + 7, 14, 2); }
      } else if (t === 3) { ctx.fillStyle = C.starInk; ctx.fillText('★', x + BW / 2, y + BH / 2 + 1); }
    }
    const px = s.over ? s.px : s.px0 + (s.px - s.px0) * a;
    ctx.fillStyle = s.wide ? C.padW : C.pad;
    ctx.fillRect(px - pw / 2, PY0, pw, PH);
    ctx.fillRect(px - pw / 2 + 3, PY0 + PH, pw - 6, 2);
    if (s.over && s.why === 'balls') return;
    const bx = s.over ? s.bx : s.bx0 + (s.bx - s.bx0) * a, by = s.over ? s.by : s.by0 + (s.by - s.by0) * a;
    ctx.fillStyle = C.ball;
    ctx.beginPath(); ctx.arc(bx, by, R, 0, 6.2832); ctx.fill();
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('bricks', {
    kind: 'canvas', W, H, drag: true,
    title: '🧱 Кирпичики',
    intro: 'Веди дощечку и отбивай мяч — разбей всю стенку. За ней будет новая, быстрее. 2 минуты и 3 мяча. ⭐ кирпич делает дощечку шире.',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) по полю. Клавиатура: ← → или A D, пробел — бросок мяча.',
    duelTitle: 'Одинаковые стенки у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, Space: 2, ArrowUp: 2, KeyW: 2 },
    create, input, step, draw,
    hudKey: s => s.lives * 1e7 + s.level * 1e5 + (s.stuck ? 1e4 : 0) + Math.ceil(s.t / 60),
    hud: s => '❤ ' + s.lives + ' · стенка ' + s.level + ' · ⏱ ' + clock(s.t) + (s.stuck ? ' · тап — бросок' : ''),
    win: s => s.level >= 2,
    result: s => ({
      title: s.level >= 3 ? '🏆 Стенки не устояли!' : s.why === 'time' ? '⏰ Время вышло' : '💔 Мячи кончились',
      text: 'кирпичей: ' + s.bricks + ' · стенок: ' + (s.level - 1) + (s.bonus ? ' · за мячи +' + s.bonus : ''),
    }),
    consts: { W, H, COLS, ROWS, BW, BH, PX, PY, X0, Y0, PY0, PW, PWW, R, TIME, SERVE, LIVES, V0, DVL, VMAX, PADV, SUB },
  });
})();

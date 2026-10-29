// ═══════════════════════════════════════
//  ИГРА «ЧЁРНАЯ ДЫРА» (T-140) — веди дыру по космосу и глотай всё, что меньше тебя. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — единиц поля в секунду. Минута на всё.
// Цепочка космоса: пылинка → астероид → спутник → ☄️ комета → луна → планета → планета с кольцами → звезда.
// Своё: дыра притягивает мелочь рядом с собой; то, что больше дыры, — препятствие (дыру отталкивает); ☄️ комета летит
// через поле — проглотил её — +3 секунды. Дыра растёт по площади (до предела — поле не закрывается); на месте
// проглоченного через 2 с появляется новый предмет — вдали от дыры.
// Исправлено против прототипа: (1) новые предметы появлялись прямо под дырой (бесплатная еда) — теперь вдали от неё и
// «проявляются» 0,5 с; (2) Math.random — теперь rng (у соперников один и тот же космос); (3) шрифт-строка на каждый предмет
// каждый кадр (мусор) и эмодзи — теперь рисунки фигурами; (4) после конца любой тап сразу начинал заново — теперь кнопка
// ядра; (5) дыра росла без предела и закрывала поле; (6) большие предметы ничего не делали — теперь мешают.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, N = 36, TIME = 60 * 60, COMET_T = 3 * 60, TMAX = 90 * 60;
  const R0 = 14, RMAX = 52, HV = 240, PULL = 26, OFF = 34, FADE = 30, WAIT = 120;
  // тип: радиус, очки
  const TR = [5, 8, 11, 13, 17, 23, 30, 38], TV = [1, 2, 4, 6, 10, 18, 30, 50];
  const C = { bg: '#070a18', star: 'rgba(255,255,255,.55)', dust: '#8b8fa6', ast: '#8a7560', astD: '#5f4f40', sat: '#cfd5e6', panel: '#4f8cff', comet: '#e6f6ff', tail: 'rgba(140,200,255,.45)',
    moon: '#cfd2dc', moonD: '#a3a7b6', ring: '#e8c48a', sun: '#ffcf4a', sunR: 'rgba(255,207,74,.35)', edible: 'rgba(255,255,255,.5)', hole: '#000000', disk: '#9b5cff', disk2: '#ff4d9a' };
  const PLANET = ['#4fb3ff', '#ff7a59', '#7bd88f', '#c38bff', '#ffb84d'];
  // звёзды фона — постоянный узор (не rng: одинаковы у всех и не влияют на игру)
  const STARS = new Float32Array(120);
  for (let i = 0, a = 12345; i < 120; i++) { a = (a * 1103515245 + 12345) >>> 0; STARS[i] = (a >>> 8) / 16777216; }

  // свой маленький генератор (xorshift32), его зерно — из rng партии: rng() ядра — замыкание, его дробный результат
  // JIT «упаковывает» (16 байт на вызов), а предметы появляются часто
  function rnd(s){ let x = s.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.seed = x; return (x >>> 0) / 4294967296; }

  function maxType(s){ const m = 2 + Math.floor((s.r - R0) / 5); return m > 7 ? 7 : m; }

  // новый предмет: тип из «доступных по размеру» (+ иногда больше — препятствие), место вдали от дыры
  function spawn(s, i){
    const mt = maxType(s), u = rnd(s);
    let t = u < .12 ? Math.min(7, mt + 1 + Math.floor(rnd(s) * 2)) : Math.max(0, mt - 3 + Math.floor(rnd(s) * 4));
    if (t === 3 && rnd(s) < .5) t = 2;
    const r = TR[t];
    let x = 0, y = 0;
    if (t === 3) {
      // комета влетает с края поля и летит насквозь
      const side = rnd(s) < .5;
      x = side ? -r : W + r; y = 40 + rnd(s) * (H - 80);
      s.vx[i] = (side ? 1 : -1) * (70 + rnd(s) * 40); s.vy[i] = (rnd(s) - .5) * 40;
    } else {
      for (let k = 0; k < 10; k++) {
        x = r + rnd(s) * (W - 2 * r); y = r + rnd(s) * (H - 2 * r);
        const dx = x - s.hx, dy = y - s.hy, far = s.r + r + 70;
        if (dx * dx + dy * dy > far * far) break;
      }
      s.vx[i] = (rnd(s) - .5) * 16; s.vy[i] = (rnd(s) - .5) * 16;
    }
    s.ox[i] = x; s.oy[i] = y; s.px[i] = x; s.py[i] = y; s.ot[i] = t; s.fade[i] = FADE; s.col[i] = Math.floor(rnd(s) * PLANET.length);
  }

  function create(rng){
    const s = { rng, hx: W / 2, hy: H * .62, hx0: W / 2, hy0: H * .62, tx: W / 2, ty: H * .62, r: R0, t: TIME, score: 0, eaten: 0, comets: 0, over: false, snd: 0, bump: 0,
      ox: new Float64Array(N), oy: new Float64Array(N), px: new Float64Array(N), py: new Float64Array(N), vx: new Float64Array(N), vy: new Float64Array(N),
      seed: (rng() * 4294967296) | 0 || 1, ot: new Uint8Array(N), fade: new Uint8Array(N), wait: new Uint8Array(N), col: new Uint8Array(N) };
    for (let i = 0; i < N; i++) spawn(s, i);
    return s;
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.MOVE)) return;
    // цель — чуть выше пальца: палец не закрывает дыру
    s.tx = e.x; s.ty = e.y - OFF;
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.hx0 = s.hx; s.hy0 = s.hy;
    if (s.bump) s.bump--;
    const keys = inp ? inp.keys : 0;
    if (keys & 15) {
      s.tx = s.hx + ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * 60;
      s.ty = s.hy + ((keys & 8 ? 1 : 0) - (keys & 4 ? 1 : 0)) * 60;
    }
    const mx = s.tx - s.hx, my = s.ty - s.hy, d = Math.sqrt(mx * mx + my * my), m = HV * dt;
    if (d > m) { s.hx += mx / d * m; s.hy += my / d * m; } else { s.hx = s.tx; s.hy = s.ty; }
    // редкие ветки (край поля, отскок, конец) — без «своих» вычислений: всё считается каждый шаг, ветка только выбирает
    // значение. Иначе JIT, не видевший ветку, выкидывает оптимизированный код при первом её проходе (мусор, рывок)
    const hr = s.r * .5;
    s.hx = Math.min(W - hr, Math.max(hr, s.hx));
    s.hy = Math.min(H - hr, Math.max(hr, s.hy));
    for (let i = 0; i < N; i++) {
      s.px[i] = s.ox[i]; s.py[i] = s.oy[i];
      // проглоченное место пустует WAIT шагов, потом там (вдали от дыры) появляется новый предмет
      if (s.wait[i]) { if (--s.wait[i] === 0) spawn(s, i); continue; }
      if (s.fade[i]) s.fade[i]--;
      const t = s.ot[i], r = TR[t];
      s.ox[i] += s.vx[i] * dt; s.oy[i] += s.vy[i] * dt;
      if (t === 3) {
        if (s.ox[i] < -r - 20 || s.ox[i] > W + r + 20 || s.oy[i] < -r - 20 || s.oy[i] > H + r + 20) { spawn(s, i); continue; }
      } else {
        const x = s.ox[i], y = s.oy[i], ax = Math.abs(s.vx[i]), ay = Math.abs(s.vy[i]), nax = -ax, nay = -ay, xh = W - r, yh = H - r;
        s.vx[i] = x < r ? ax : x > xh ? nax : s.vx[i];
        s.vy[i] = y < r ? ay : y > yh ? nay : s.vy[i];
        s.ox[i] = Math.min(xh, Math.max(r, x));
        s.oy[i] = Math.min(yh, Math.max(r, y));
      }
      if (s.fade[i] > FADE / 2) continue;
      const dx = s.hx - s.ox[i], dy = s.hy - s.oy[i], dd = Math.sqrt(dx * dx + dy * dy) + 1e-9;
      if (r < s.r * .85) {
        // мелочь рядом притягивается; совсем близко — проглочена
        if (dd < s.r * .75) {
          s.score += TV[t]; s.eaten++;
          s.r = Math.min(RMAX, Math.sqrt(s.r * s.r + r * r * .15));
          if (t === 3) { s.comets++; s.t = Math.min(TMAX, s.t + COMET_T); s.snd = 'win'; } else s.snd = 300 + t * 70;
          s.wait[i] = WAIT;
          continue;
        }
        if (dd < s.r + PULL) { const k = 45 * dt / dd; s.ox[i] += dx * k; s.oy[i] += dy * k; }
      } else if (dd < s.r + r * .7) {
        // больше дыры — препятствие: дыру отталкивает
        const k = (s.r + r * .7 - dd) / dd;
        s.hx += dx * k; s.hy += dy * k;
        if (!s.bump) { s.bump = 20; s.snd = 'tick'; }
      }
    }
    s.t = Math.max(0, s.t - 1);
    s.over = s.t === 0;
    s.snd = s.over ? 'win' : s.snd;
  }

  // ── рисование: предметы одного вида — одним путём (мало вызовов canvas: телефону легче) ──
  // G.ix / G.iy / G.ir — положения и радиусы этого кадра (массивы на G, создаются один раз)
  function body(ctx, G, t, col){
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (G.ir[i] <= 0 || G.it[i] !== t || (col >= 0 && G.ic[i] !== col)) continue;
      ctx.moveTo(G.ix[i] + G.ir[i], G.iy[i]); ctx.arc(G.ix[i], G.iy[i], G.ir[i], 0, 6.2832);
    }
    ctx.fill();
  }

  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a, now = G.now;
    if (!G.ix) { G.ix = new Float32Array(N); G.iy = new Float32Array(N); G.ir = new Float32Array(N); G.it = new Uint8Array(N); G.ic = new Uint8Array(N); }
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.star;
    for (let i = 0; i < 48; i += 2) ctx.fillRect(STARS[i] * W, STARS[i + 1] * H, 1.5, 1.5);
    // новые предметы «вырастают» за FADE шагов
    for (let i = 0; i < N; i++) {
      G.ix[i] = s.px[i] + (s.ox[i] - s.px[i]) * k; G.iy[i] = s.py[i] + (s.oy[i] - s.py[i]) * k;
      G.ir[i] = s.wait[i] ? 0 : TR[s.ot[i]] * (1 - s.fade[i] / FADE);
      G.it[i] = s.ot[i]; G.ic[i] = s.col[i];
    }
    // что можно проглотить — светлый круг (один путь)
    ctx.strokeStyle = C.edible; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (G.ir[i] <= 0 || s.fade[i] || TR[s.ot[i]] >= s.r * .85) continue;
      ctx.moveTo(G.ix[i] + G.ir[i] + 3, G.iy[i]); ctx.arc(G.ix[i], G.iy[i], G.ir[i] + 3, 0, 6.2832);
    }
    ctx.stroke();
    // хвосты комет и сияние звёзд
    ctx.strokeStyle = C.tail; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (G.ir[i] <= 0 || G.it[i] !== 3) continue;
      const vx = s.vx[i], vy = s.vy[i], l = Math.sqrt(vx * vx + vy * vy) + 1e-9;
      ctx.moveTo(G.ix[i], G.iy[i]); ctx.lineTo(G.ix[i] - vx / l * 36, G.iy[i] - vy / l * 36);
    }
    ctx.stroke();
    ctx.fillStyle = C.sunR; ctx.beginPath();
    const glow = 6 + 2 * Math.sin(now / 300);
    for (let i = 0; i < N; i++) {
      if (G.ir[i] <= 0 || G.it[i] !== 7) continue;
      ctx.moveTo(G.ix[i] + G.ir[i] + glow, G.iy[i]); ctx.arc(G.ix[i], G.iy[i], G.ir[i] + glow, 0, 6.2832);
    }
    ctx.fill();
    // тела: по видам (планеты — по цвету)
    ctx.fillStyle = C.dust; body(ctx, G, 0, -1);
    ctx.fillStyle = C.ast; body(ctx, G, 1, -1);
    ctx.fillStyle = C.comet; body(ctx, G, 3, -1);
    ctx.fillStyle = C.moon; body(ctx, G, 4, -1);
    ctx.fillStyle = C.sun; body(ctx, G, 7, -1);
    for (let c = 0; c < PLANET.length; c++) { ctx.fillStyle = PLANET[c]; body(ctx, G, 5, c); body(ctx, G, 6, c); }
    // мелкие детали: спутники (панели), кратеры, кольца
    ctx.fillStyle = C.panel;
    for (let i = 0; i < N; i++) if (G.ir[i] > 0 && G.it[i] === 2) { const r = G.ir[i]; ctx.fillRect(G.ix[i] - r, G.iy[i] - 3, r * 1.9, 6); }
    ctx.fillStyle = C.sat;
    for (let i = 0; i < N; i++) if (G.ir[i] > 0 && G.it[i] === 2) ctx.fillRect(G.ix[i] - 4, G.iy[i] - 5, 8, 10);
    ctx.fillStyle = C.moonD;
    for (let i = 0; i < N; i++) if (G.ir[i] > 4 && (G.it[i] === 4 || G.it[i] === 1)) { const r = G.ir[i] * .25; ctx.fillRect(G.ix[i] - r * 2, G.iy[i] - r, r * 1.4, r * 1.4); ctx.fillRect(G.ix[i] + r, G.iy[i] + r * .6, r, r); }
    ctx.strokeStyle = C.ring; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < N; i++) {
      if (G.ir[i] <= 0 || G.it[i] !== 6) continue;
      const rx = G.ir[i] + 12;
      ctx.moveTo(G.ix[i] + rx * .94, G.iy[i] - rx * .34 * .2); ctx.ellipse(G.ix[i], G.iy[i], rx, 6, -.35, 0, 6.2832);
    }
    ctx.stroke();
    // дыра: чёрный круг и вращающийся диск
    const hx = s.hx0 + (s.hx - s.hx0) * k, hy = s.hy0 + (s.hy - s.hy0) * k, r = s.r, ang = now / 400;
    ctx.lineWidth = 4;
    ctx.strokeStyle = C.disk; ctx.beginPath(); ctx.arc(hx, hy, r + 3, ang, ang + 4); ctx.stroke();
    ctx.strokeStyle = C.disk2; ctx.beginPath(); ctx.arc(hx, hy, r + 3, ang + 4.2, ang + 6.1); ctx.stroke();
    ctx.fillStyle = C.hole; ctx.beginPath(); ctx.arc(hx, hy, r, 0, 6.2832); ctx.fill();
  }

  ArcadeKit.define('hole', {
    kind: 'canvas', W, H, drag: true,
    title: '🕳️ Чёрная дыра',
    intro: 'Веди дыру по космосу и глотай всё, что меньше неё (такие предметы обведены). Чем больше съешь — тем больше дыра. ☄️ Комета — +3 секунды. У тебя минута!',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) — дыра плывёт чуть выше пальца. Клавиатура: стрелки или W A S D.',
    duelTitle: 'Один и тот же космос у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3 },
    create, input, step, draw,
    hudKey: s => Math.ceil(s.t / 60) * 100 + maxType(s),
    hud: s => '⏱ ' + Math.ceil(s.t / 60) + ' с · размер ' + (maxType(s) - 1),
    win: s => s.score >= 300,
    result: s => ({
      title: s.score >= 600 ? '🌌 Дыра проглотила галактику!' : s.score >= 300 ? '🪐 Планеты не устояли!' : '☄️ Время вышло',
      text: 'проглочено: ' + s.eaten + (s.comets ? ' · ☄️ ' + s.comets : ''),
    }),
    consts: { W, H, N, TIME, R0, RMAX, HV, OFF, TR, TV, FADE, WAIT, PULL },
  });
})();

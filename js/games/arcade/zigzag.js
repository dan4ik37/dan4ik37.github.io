// ═══════════════════════════════════════
//  ИГРА «ЗИГЗАГ» (T-140) — шарик катится по ночной трассе: тап — поворот. Съехал с дороги — конец. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, мир едет вниз; скорость — единиц в секунду по каждой оси.
// Своё: огоньки на углах трассы; поворот точно у огонька (ближе 9) — «✨ точно» +1; трасса — 2 минуты; скорость растёт с поворотами,
// а самые короткие отрезки удлиняются вместе со скоростью (успеть можно всегда).
// Исправлено против прототипа: (1) движение за кадр → в секунду (на 144 Гц прототип катил в 2,4 раза быстрее); (2) Math.random →
// rng (у соперников одна трасса); (3) дорогу рисовали линией толщиной 44, а «съехал» проверяли по горизонтали ±22 — шарик падал,
// ещё стоя на нарисованной дороге; теперь проверка — расстояние до осевой линии ровно в полширины нарисованной дороги
// (со скруглениями на углах, как рисуется); (4) массив точек рос всю игру, а поиск по нему шёл каждый кадр — кольцо из 32 точек;
// (5) отрезки бывали по 20 единиц при любой скорости — на разгоне повернуть было нельзя; (6) нажатие после падения сразу
// начинало заново — итог ядра; (7) бесконечная игра — финиш через 2 минуты.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, VIEW = 330, XMIN = 40, XMAX = 280, HW = 21, BR = 8;   // шарик на 330 от верха; полширины дороги; радиус шарика
  const V0 = 150, DV = 1.2, VMAX = 270, LIMIT = 120;                           // скорость по оси: старт, + за поворот, предел; 2 минуты
  const LMIN = 36, LK = .24, LMAX = 150, FIRST = 90, PERF = 9;                 // длина отрезка: минимум, × скорость, максимум; первый; «точно»
  const RING = 32, MASK = RING - 1;
  const C = { bg: '#0f1424', grid: 'rgba(120,140,255,.06)', glow: 'rgba(92,124,250,.22)', road: '#2b3a74', mid: 'rgba(255,255,255,.08)',
    lamp: '#ffd166', lampOn: '#40c057', ball: '#ff6b6b', ball2: '#ffd0d0', bad: '#ff4d6d' };

  function add(s){
    const i = s.count++, j = i & MASK;
    if (i === 0) { s.px[j] = 160; s.py[j] = 0; return; }
    const p = (i - 1) & MASK, x = s.px[p], d = (i - 1) % 2 ? -1 : 1;   // отрезок i−1 идёт вправо (чётный) или влево
    const v = Math.min(VMAX, V0 + DV * (i - 1)), lmin = Math.max(LMIN, LK * v);
    let L = i === 1 ? FIRST : lmin + s.rng() * (LMAX - lmin);
    const room = d > 0 ? XMAX - x : x - XMIN;
    if (L > room) L = room;
    s.px[j] = x + d * L; s.py[j] = s.py[p] - L;
  }

  function create(rng){
    const s = { rng, bx: 160, by: 0, pbx: 160, pby: 0, dir: 1, v: V0, seg: 0, started: false, t: 0, score: 0, turns: 0, perfect: 0, flash: 0, flashI: -1,
      over: false, why: '', snd: 0, count: 0, px: new Float64Array(RING), py: new Float64Array(RING) };
    while (s.count < 16) add(s);
    return s;
  }

  // расстояние от шарика до отрезка i → i+1 осевой линии
  function dseg(s, i){
    const a = i & MASK, b = (i + 1) & MASK, ax = s.px[a], ay = s.py[a], dx = s.px[b] - ax, dy = s.py[b] - ay;
    let k = ((s.bx - ax) * dx + (s.by - ay) * dy) / (dx * dx + dy * dy);
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const ex = ax + dx * k - s.bx, ey = ay + dy * k - s.by;
    return Math.sqrt(ex * ex + ey * ey);
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    if (!s.started) { s.started = true; s.snd = 'move'; return; }   // первый тап — старт (направление вправо)
    s.dir = -s.dir; s.turns++;
    // поворот у огонька угла (конец текущего отрезка или только что пройденный угол)
    for (let k = s.seg; k <= s.seg + 1; k++) {
      const j = k & MASK, ex = s.px[j] - s.bx, ey = s.py[j] - s.by;
      if (k > 0 && ex * ex + ey * ey <= PERF * PERF && s.flashI !== k) { s.perfect++; s.score++; s.flash = .3; s.flashI = k; s.snd = 1047; return; }
    }
    s.snd = 660;
  }

  function step(s, dt){
    s.pbx = s.bx; s.pby = s.by;
    if (s.flash > 0) s.flash -= dt;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'finish'; s.snd = 'win'; return; }
    s.v = Math.min(VMAX, V0 + DV * s.seg);
    s.bx += s.dir * s.v * dt; s.by -= s.v * dt;
    while (s.by < s.py[(s.seg + 1) & MASK]) { s.seg++; s.score++; }   // прошёл угол — +1
    let d = dseg(s, s.seg);
    if (s.seg > 0) { const d0 = dseg(s, s.seg - 1); if (d0 < d) d = d0; }
    const d1 = dseg(s, s.seg + 1); if (d1 < d) d = d1;
    if (d > HW) { s.over = true; s.why = 'fall'; s.snd = 'bad'; return; }
    while (s.count - s.seg < RING - 4) add(s);
  }

  function draw(G, s, a){
    const ctx = G.ctx, bx = s.over ? s.bx : s.pbx + (s.bx - s.pbx) * a, by = s.over ? s.by : s.pby + (s.by - s.pby) * a, cam = by - VIEW;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.grid;
    const gy = (-cam) % 40;
    for (let y = gy - 40; y < H; y += 40) ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += 40) ctx.fillRect(x, 0, 1, H);
    // дорога: широкое свечение, потом сама дорога ровно 2 × HW (как проверяется), скруглённые углы
    const i0 = s.seg > 2 ? s.seg - 2 : 0;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.road : C.glow; ctx.lineWidth = pass ? HW * 2 : HW * 2 + 10;
      ctx.beginPath();
      for (let i = i0; i < s.count; i++) { const j = i & MASK, y = s.py[j] - cam; if (i === i0) ctx.moveTo(s.px[j], y); else ctx.lineTo(s.px[j], y); if (y < -60) break; }
      ctx.stroke();
    }
    ctx.lineJoin = 'miter'; ctx.lineCap = 'butt';
    // огоньки на углах
    for (let i = i0 + 1; i < s.count; i++) {
      const j = i & MASK, y = s.py[j] - cam;
      if (y < -10) break;
      if (y > H + 10) continue;
      ctx.fillStyle = s.flash > 0 && s.flashI === i ? C.lampOn : C.lamp;
      ctx.beginPath(); ctx.arc(s.px[j], y, s.flash > 0 && s.flashI === i ? 7 : 3.5, 0, 6.2832); ctx.fill();
    }
    const sy = by - cam;
    ctx.fillStyle = s.over && s.why === 'fall' ? C.bad : C.ball;
    ctx.beginPath(); ctx.arc(bx, sy, s.over && s.why === 'fall' ? BR - 2 : BR, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.ball2; ctx.fillRect(bx - 4, sy - 4, 3, 3);
  }

  ArcadeKit.define('zigzag', {
    kind: 'canvas', W, H,
    title: '⚡ Зигзаг',
    intro: 'Шарик катится по ночной трассе. Тап — поворот. Съехал с дороги — конец. Поворот точно у огонька — ✨ +1. Трасса — 2 минуты. Первый тап — старт.',
    controls: 'Тап по полю, мышь или пробел — поворот.',
    duelTitle: 'Одинаковая трасса у обоих',
    keys: { Space: 0, ArrowUp: 0, KeyJ: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с' : 'Тап — старт'),
    win: s => s.score >= 80,
    result: s => ({
      title: s.why === 'finish' ? '🏁 Финиш! Вся трасса' : s.score >= 80 ? '⚡ Мастер поворотов!' : '🕳 Съехал с дороги',
      text: 'углов: ' + s.seg + ' · ✨ точно: ' + s.perfect,
    }),
    consts: { W, H, VIEW, XMIN, XMAX, HW, BR, V0, DV, VMAX, LIMIT, LMIN, LK, LMAX, FIRST, PERF, RING },
  });
})();

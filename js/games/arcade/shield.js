// ═══════════════════════════════════════
//  ИГРА «ЗАЩИТИ СТРИМ» (T-140) — рисуй стенки пальцем, чтобы спам-боты не долетели до стрима. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — единиц поля в секунду. Стрим идёт 90 секунд.
// Своё: чернила кончаются (запас и подзарядка) — сплошной круг вокруг стрима не нарисуешь; бот, упёршийся в стенку на 0,9 с,
// «отписывается» и улетает (+5), но стенка под ботами тает быстрее; на экран стрима рисовать нельзя; 3 ❤.
// Очки: 5 за каждого отбитого бота + 2 за секунду эфира + 50 за каждое ❤, если стрим дошёл до конца.
// Исправлено против прототипа: (1) обвёл собаку кругом — и она в безопасности навсегда (линии не тратились, не ломались,
// рисовать можно было где угодно) — теперь чернила, таяние под ботами и запрет на экран стрима; (2) L.filter и объекты-точки
// каждый кадр (мусор) — теперь кольцо точек в типизированных массивах; (3) Math.random — теперь rng (у соперников те же
// боты); (4) боты не прилетали снизу; (5) у партии не было конца, кроме проигрыша, — теперь эфир 90 с; (6) после конца
// тап сразу начинал заново — теперь кнопка ядра.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, CX = 160, CY = 236, SW = 74, SH = 50;      // экран стрима: центр и размер
  const NB = 32, MAXP = 192, PMASK = MAXP - 1, LIFE = 5 * 60, STEPD = 8; // боты, точки линий, жизнь линии (шагов), шаг точек
  const INK = 520, INKV = 60, BR = 7, LR = 9, GIVE = 54, TIME = 90 * 60, HEARTS = 3;
  const C = { bg: '#101322', grid: 'rgba(255,255,255,.035)', line: '#ffffff', old: 'rgba(255,255,255,.4)', mon: '#1d2236', monB: '#3b4366', scr: '#2a1b4a', live: '#ff2d55',
    ink: '#5ad1ff', inkBg: 'rgba(255,255,255,.08)', bot: '#ff5fa2', botD: '#7a1f4a', eye: '#ffffff', gone: 'rgba(122,255,170,.8)', heart: '#ff2d55', heartOff: 'rgba(255,255,255,.15)', hit: 'rgba(255,45,85,.22)' };

  // свой маленький генератор (xorshift32) с зерном из rng партии — без «упакованных» дробных из замыкания ядра
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return (x >>> 0) / 4294967296; }

  function create(rng){
    return { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, hearts: HEARTS, gone: 0, sec: 0, ink: INK, spawnT: 90, over: false, why: '', snd: 0, flash: 0,
      head: 0, drawing: 0, lx: 0, ly: 0,
      px: new Float64Array(MAXP), py: new Float64Array(MAXP), born: new Float64Array(MAXP).fill(-1e9), link: new Uint8Array(MAXP), seg: new Int16Array(MAXP), nseg: 0,
      bx: new Float64Array(NB), by: new Float64Array(NB), bx0: new Float64Array(NB), by0: new Float64Array(NB), st: new Uint8Array(NB), stuck: new Uint8Array(NB), vx: new Float64Array(NB), vy: new Float64Array(NB) };
  }

  const inScreen = (x, y) => x > CX - SW / 2 - 12 && x < CX + SW / 2 + 12 && y > CY - SH / 2 - 12 && y < CY + SH / 2 + 12;

  function addPoint(s, x, y, link){
    const j = s.head & PMASK;
    s.px[j] = x; s.py[j] = y; s.born[j] = s.t; s.link[j] = link;
    s.link[(j + 1) & PMASK] = 0;                     // старая точка после новой больше не продолжает её штрих (кольцо)
    s.head++; s.lx = x; s.ly = y;
  }

  function input(s, e){
    if (s.over) return;
    const x = e.x < 0 ? 0 : e.x > W ? W : e.x, y = e.y < 0 ? 0 : e.y > H ? H : e.y;
    if (e.type === T.DOWN) {
      s.drawing = inScreen(x, y) ? 2 : 1;            // 2 — штрих «прерван» (на экране стрима или без чернил)
      if (s.drawing === 1) addPoint(s, x, y, 0);
      else { s.lx = x; s.ly = y; }
    } else if (e.type === T.MOVE && s.drawing) {
      const dx = x - s.lx, dy = y - s.ly, d = Math.sqrt(dx * dx + dy * dy);
      if (d < STEPD) return;
      if (inScreen(x, y) || d > s.ink) { s.drawing = 2; s.lx = x; s.ly = y; return; }
      s.ink -= d;
      addPoint(s, x, y, s.drawing === 1 ? 1 : 0);
      s.drawing = 1;
    } else if (e.type === T.UP || e.type === T.CANCEL) s.drawing = 0;
  }

  function spawn(s, i){
    const side = Math.floor(rnd(s) * 4), u = rnd(s);
    s.bx[i] = side === 0 ? -BR : side === 1 ? W + BR : u * W;
    s.by[i] = side === 2 ? -BR : side === 3 ? H + BR : u * H;
    s.bx0[i] = s.bx[i]; s.by0[i] = s.by[i];
    s.st[i] = 1; s.stuck[i] = 0;
  }

  function step(s, dt){
    if (s.over) return;
    s.t++;
    const sec = s.t / 60;
    s.flash = Math.max(0, s.flash - 1);
    s.ink = Math.min(INK, s.ink + INKV * dt);
    // новые боты: всё чаще
    if (--s.spawnT <= 0) {
      s.spawnT = Math.round(60 * Math.max(.45, 1.3 - sec * .011));
      for (let i = 0; i < NB; i++) if (!s.st[i]) { spawn(s, i); break; }
    }
    const v = Math.min(100, 45 + sec * .75) * dt;
    // живые отрезки — один раз за шаг (j — конец отрезка, начало — j - 1)
    const t0 = s.t - LIFE;
    let ns = 0;
    for (let k = 1; k <= MAXP; k++) {
      const j = (s.head - k) & PMASK;
      if (s.link[j] && s.born[j] >= t0 && s.born[(j - 1) & PMASK] >= t0) s.seg[ns++] = j;
    }
    s.nseg = ns;
    for (let i = 0; i < NB; i++) {
      s.bx0[i] = s.bx[i]; s.by0[i] = s.by[i];
      const st = s.st[i];
      if (!st) continue;
      if (st === 2) {
        // отписался: улетает от стрима и пропадает
        s.bx[i] += s.vx[i] * dt; s.by[i] += s.vy[i] * dt;
        const out = s.bx[i] < -20 || s.bx[i] > W + 20 || s.by[i] < -20 || s.by[i] > H + 20;
        s.st[i] = out ? 0 : 2;
        continue;
      }
      let dx = CX - s.bx[i], dy = CY - s.by[i];
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-9;
      s.bx[i] += dx / d * v; s.by[i] += dy / d * v;
      // стенки: выталкивание из каждого отрезка (бот скользит вдоль), отрезок под ботом тает быстрее
      let touch = 0;
      for (let k = 0; k < ns; k++) {
        const j = s.seg[k], a = (j - 1) & PMASK;
        const ax = s.px[a], ay = s.py[a], ex = s.px[j] - ax, ey = s.py[j] - ay, l = ex * ex + ey * ey + 1e-9;
        let u = ((s.bx[i] - ax) * ex + (s.by[i] - ay) * ey) / l;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = ax + u * ex, qy = ay + u * ey, rx = s.bx[i] - qx, ry = s.by[i] - qy, q = rx * rx + ry * ry;
        if (q >= (BR + LR / 2) * (BR + LR / 2)) continue;
        const e = Math.sqrt(q) + 1e-6, push = (BR + LR / 2) / e;
        s.bx[i] = qx + rx * push; s.by[i] = qy + ry * push;
        s.born[j] -= .5; touch = 1;
      }
      const sk = touch ? s.stuck[i] + 1 : s.stuck[i];
      s.stuck[i] = sk;
      if (sk >= GIVE) {
        s.st[i] = 2; s.gone++; s.score += 5; s.snd = 784;
        dx = s.bx[i] - CX; dy = s.by[i] - CY;
        const dd = Math.sqrt(dx * dx + dy * dy) + 1e-9;
        s.vx[i] = dx / dd * 220; s.vy[i] = dy / dd * 220;
        continue;
      }
      // долетел до экрана стрима — минус ❤
      const hit = Math.abs(s.bx[i] - CX) < SW / 2 + BR && Math.abs(s.by[i] - CY) < SH / 2 + BR;
      s.st[i] = hit ? 0 : 1;
      s.hearts -= hit ? 1 : 0;
      s.flash = hit ? 24 : s.flash;
      s.snd = hit ? 'bad' : s.snd;
    }
    // секунды эфира и конец
    const sc = Math.floor(s.t / 60);
    s.score += (sc - s.sec) * 2; s.sec = sc;
    s.left = TIME - s.t;
    const end = s.hearts <= 0 || s.left <= 0;
    s.why = s.hearts <= 0 ? 'bots' : s.left <= 0 ? 'time' : '';
    s.score += end && s.hearts > 0 ? 50 * s.hearts : 0;
    s.snd = end ? (s.hearts > 0 ? 'win' : 'bad') : s.snd;
    s.over = end;
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a, t0 = s.t - LIFE, mid = s.t - LIFE * .35;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.grid;
    for (let x = 40; x < W; x += 40) ctx.fillRect(x, 0, 1, H);
    for (let y = 40; y < H; y += 40) ctx.fillRect(0, y, W, 1);
    if (s.flash) { ctx.fillStyle = C.hit; ctx.fillRect(0, 0, W, H); }
    // экран стрима
    ctx.fillStyle = C.monB; ctx.fillRect(CX - SW / 2 - 4, CY - SH / 2 - 4, SW + 8, SH + 8); ctx.fillRect(CX - 6, CY + SH / 2 + 4, 12, 10); ctx.fillRect(CX - 20, CY + SH / 2 + 12, 40, 4);
    ctx.fillStyle = C.scr; ctx.fillRect(CX - SW / 2, CY - SH / 2, SW, SH);
    ctx.fillStyle = C.live; ctx.beginPath(); ctx.arc(CX - 22, CY - 12, 4, 0, 6.2832); ctx.fill();
    ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('LIVE', CX - 15, CY - 11);
    for (let h = 0; h < HEARTS; h++) { ctx.fillStyle = h < s.hearts ? C.heart : C.heartOff; ctx.fillRect(CX - 21 + h * 16, CY + 8, 10, 8); }
    // линии: свежие — ярко, старые (скоро растают) — бледно; два пути на всё
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = LR / 1.6;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? C.line : C.old;
      ctx.beginPath();
      for (let n = 1; n <= MAXP; n++) {
        const j = (s.head - n) & PMASK, b = s.born[j];
        if (b < t0 || !s.link[j]) continue;
        const i = (j - 1) & PMASK, b2 = s.born[i];
        if (b2 < t0 || ((b < mid || b2 < mid) ? 0 : 1) !== pass) continue;
        ctx.moveTo(s.px[i], s.py[i]); ctx.lineTo(s.px[j], s.py[j]);
      }
      ctx.stroke();
    }
    // боты
    for (let i = 0; i < NB; i++) {
      const st = s.st[i];
      if (!st) continue;
      const x = s.bx0[i] + (s.bx[i] - s.bx0[i]) * k, y = s.by0[i] + (s.by[i] - s.by0[i]) * k;
      ctx.fillStyle = st === 2 ? C.gone : C.bot; ctx.fillRect(x - BR, y - BR + 1, BR * 2, BR * 2 - 1);
      ctx.fillStyle = C.botD; ctx.fillRect(x - 1, y - BR - 4, 2, 4);
      ctx.fillStyle = C.eye; ctx.fillRect(x - 4, y - 2, 3, 3); ctx.fillRect(x + 1, y - 2, 3, 3);
    }
    // чернила — тонкая полоса у нижнего края поля
    ctx.fillStyle = C.inkBg; ctx.fillRect(8, H - 8, W - 16, 4);
    ctx.fillStyle = C.ink; ctx.fillRect(8, H - 8, (W - 16) * s.ink / INK, 4);
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('shield', {
    kind: 'canvas', W, H, drag: true,
    title: '📺 Защити стрим',
    intro: 'Спам-боты летят на твой стрим! Рисуй пальцем стенки — бот, упёршийся в стенку, через секунду отписывается (+5). Чернила тратятся, стенки тают. Продержи эфир 90 секунд, у стрима 3 ❤.',
    controls: 'Рисуй пальцем (или мышью с зажатой кнопкой). Голубая полоска внизу — чернила, они понемногу пополняются.',
    duelTitle: 'Одинаковые боты у обоих',
    create, input, step, draw,
    hudKey: s => s.hearts * 1e4 + Math.ceil(s.left / 60),
    hud: s => '❤ ' + s.hearts + ' · эфир ⏱ ' + clock(s.left),
    win: s => s.why === 'time',
    result: s => ({
      title: s.why === 'time' ? (s.hearts === HEARTS ? '🏆 Чистый эфир!' : '📺 Стрим отстоял!') : '🤖 Спам захватил стрим',
      text: 'отбито ботов: ' + s.gone + ' · эфир: ' + s.sec + ' с' + (s.why === 'time' ? ' · ❤ +' + 50 * s.hearts : ''),
    }),
    consts: { W, H, CX, CY, SW, SH, NB, MAXP, LIFE, INK, INKV, BR, LR, GIVE, TIME, HEARTS, STEPD },
  });
})();

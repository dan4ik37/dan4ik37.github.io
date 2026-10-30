// ═══════════════════════════════════════
//  ИГРА «ПРЫЖКИ ВВЕРХ» (T-140) — белка скачет вверх по веткам огромного дерева: веди пальцем влево-вправо, не упади.
//  Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, мир — вверх (y меньше); скорости и тяжесть — в секунду.
// Своё: белка на дереве; 🌰 жёлуди на ветках (+5); сухая ветка выдерживает один прыжок и ломается; качающиеся ветки;
// подъём — 2 минуты, очки = метры + жёлуди.
// Исправлено против прототипа: (1) тяжесть, прыжок и бег — за кадр → в секунду (на 144 Гц прототип прыгал в 2,4 раза быстрее);
// (2) посадка на ветку проверялась окном «ноги ниже верха, но не дальше скорости + 6» — на рывке кадра белка проваливалась;
// теперь ноги пересекли верх ветки за шаг — точная посадка; (3) Math.random → rng (у соперников одно дерево); (4) min(...map) и
// filter каждый кадр — кольцо на 32 ветки; (5) управление только мышью/пальцем — добавлены ← / →; (6) никакой цели и конца,
// если не падать (можно прыгать на месте вечно) — 2 минуты; (7) тап после падения сразу начинал заново — итог ядра;
// (8) следующая ветка могла оказаться дальше прыжка по высоте — шаг между ветками всегда меньше высоты прыжка.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, HW = 13, HH = 26, PW = 58, PH = 10, FOLLOW = 180;    // белка: полуширина, рост; ветка; камера держит белку на 180 от верха
  const G = 900, VJ = -560, VX = 420, VK = 260, LIMIT = 120, RING = 32, M = RING - 1;   // тяжесть, прыжок, бег за пальцем / с клавиш; кольцо — степень двойки (& M)
  const GAP0 = 55, GAPK = 1 / 60, GAPMAX = 120, DRY = .18, SWAY = .2, NUT = .22;        // шаг веток; доли сухих / качающихся / с желудем
  const C = { sky: '#0f1a2b', trunk: '#2a2118', bark: 'rgba(0,0,0,.25)', leaf: 'rgba(64,192,87,.12)', branch: '#8a5a33', branchTop: '#a8754a',
    dry: '#9c8a6a', dryTop: '#c4b38e', sway: '#6d8b3b', swayTop: '#8db04d', nut: '#b5651d', nutCap: '#6b3e14',
    body: '#e8590c', belly: '#ffd8a8', tail: '#d9480f', eye: '#1b1b1b', bad: '#ff4d6d' };

  function add(s){
    const i = s.made++, j = i & M, r = s.rng;
    const gap = Math.min(GAPMAX, GAP0 + r() * (20 + s.made * 1.2) + GAPK * s.made * 10);
    const y = s.py[(i - 1) & M] - gap, px = s.px[(i - 1) & M];
    let x = r() * (W - PW);
    if (x - px > 220) x = px + 220; else if (px - x > 220) x = px - 220;
    const k = i < 4 ? 0 : r();
    s.px[j] = x; s.py[j] = y; s.pt[j] = k < DRY ? 1 : k < DRY + SWAY ? 2 : 0; s.pv[j] = (r() < .5 ? -1 : 1) * (40 + r() * 50); s.pon[j] = 1;
    s.nut[j] = i > 2 && r() < NUT ? 1 : 0;
  }

  function create(rng){
    const s = { rng, px: new Float64Array(RING), py: new Float64Array(RING), pt: new Uint8Array(RING), pv: new Float64Array(RING), pon: new Uint8Array(RING),
      nut: new Uint8Array(RING), made: 0, x: 160, y: 380, vy: 0, px0: 160, py0: 380, tx: 160, keyMode: false, cam: 0, pcam: 0, top: 380,
      started: false, t: 0, score: 0, m: 0, nuts: 0, over: false, why: '', snd: 0, seq: new Float32Array(8) };
    // первая ветка — прямо под белкой (на ней она стоит до старта)
    s.px[0] = 160 - PW / 2; s.py[0] = 380; s.pt[0] = 0; s.pon[0] = 1; s.nut[0] = 0; s.made = 1;
    while (s.made < 16) add(s);
    for (let i = 0; i < 8; i++) s.seq[i] = s.px[(i + 1) & M];   // для ⚔️ сравнения: ветки одинаковы у соперников
    return s;
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) { s.tx = e.x; s.keyMode = false; }
    if (!s.started && (e.type === T.DOWN || e.type === T.KEY)) { s.started = true; s.vy = VJ; s.snd = 'move'; }   // первый тап — первый прыжок
    if (e.type === T.KEY) s.keyMode = true;
  }

  function step(s, dt, inp){
    s.px0 = s.x; s.py0 = s.y; s.pcam = s.cam;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'time'; s.snd = 'win'; return; }
    // бег: за пальцем (до VX в секунду) или клавишами (VK)
    const keys = inp ? inp.keys : 0;
    if (s.keyMode) { const d = ((keys >> 1) & 1) - (keys & 1); s.x += d * VK * dt; }
    else { const d = s.tx - s.x, m = VX * dt; s.x += d > m ? m : d < -m ? -m : d; }
    if (s.x < HW) s.x = HW; else if (s.x > W - HW) s.x = W - HW;
    // качающиеся ветки
    for (let j = 0; j < RING; j++) if (s.pt[j] === 2 && s.pon[j]) {
      s.px[j] += s.pv[j] * dt;
      if (s.px[j] < 0) { s.px[j] = -s.px[j]; s.pv[j] = -s.pv[j]; } else if (s.px[j] > W - PW) { s.px[j] = 2 * (W - PW) - s.px[j]; s.pv[j] = -s.pv[j]; }
    }
    // прыжок: ноги (y) пересекли верх ветки за этот шаг — посадка
    const y0 = s.y;
    s.vy += G * dt; s.y += s.vy * dt;
    if (s.vy > 0) {
      for (let i = s.made - RING; i < s.made; i++) {
        if (i < 0) continue;
        const j = i & M, top = s.py[j];
        if (!s.pon[j] || y0 > top || s.y < top || s.x + HW * .7 < s.px[j] || s.x - HW * .7 > s.px[j] + PW) continue;
        s.y = top; s.vy = VJ; s.snd = s.pt[j] === 1 ? 330 : 523;
        if (s.pt[j] === 1) s.pon[j] = 0;            // сухая ветка ломается после прыжка
        break;
      }
    }
    // жёлуди: белка задела — +5
    for (let i = s.made - RING; i < s.made; i++) {
      if (i < 0) continue;
      const j = i & M;
      if (!s.nut[j]) continue;
      const nx = s.px[j] + PW / 2, ny = s.py[j] - 16;
      if (s.x + HW > nx - 7 && s.x - HW < nx + 7 && s.y > ny - 7 && s.y - HH < ny + 7) { s.nut[j] = 0; s.nuts++; s.snd = 1047; }
    }
    if (s.y < s.top) s.top = s.y;
    s.m = Math.floor((380 - s.top) / 10);
    s.score = s.m + 5 * s.nuts;
    // камера только вверх; новые ветки сверху
    const want = s.top - FOLLOW;
    if (want < s.cam) s.cam = want;
    while (s.py[(s.made - 1) & M] > s.cam - 60) add(s);
    if (s.y - HH > s.cam + H) { s.over = true; s.why = 'fall'; s.snd = 'bad'; }
  }

  function draw(Gx, s, al){
    const ctx = Gx.ctx, cam = s.over ? s.cam : s.pcam + (s.cam - s.pcam) * al;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    // ствол посередине, кора едет вместе с камерой
    ctx.fillStyle = C.trunk; ctx.fillRect(120, 0, 80, H);
    ctx.fillStyle = C.bark;
    const off = ((-cam) % 70 + 70) % 70;
    for (let y = off - 70; y < H; y += 70) { ctx.fillRect(132, y, 6, 30); ctx.fillRect(176, y + 35, 6, 26); }
    ctx.fillStyle = C.leaf; ctx.fillRect(0, 0, 40, H); ctx.fillRect(W - 40, 0, 40, H);
    // ветки и жёлуди
    for (let i = s.made - RING; i < s.made; i++) {
      if (i < 0) continue;
      const j = i & M, y = s.py[j] - cam;
      if (!s.pon[j] || y < -20 || y > H + 20) continue;
      const t = s.pt[j], x = s.px[j];
      ctx.fillStyle = t === 1 ? C.dry : t === 2 ? C.sway : C.branch; ctx.fillRect(x, y, PW, PH);
      ctx.fillStyle = t === 1 ? C.dryTop : t === 2 ? C.swayTop : C.branchTop; ctx.fillRect(x, y, PW, 3);
      if (t === 1) { ctx.fillStyle = C.sky; ctx.fillRect(x + PW / 2 - 1, y + 3, 2, PH - 3); }   // трещина
      if (s.nut[j]) {
        const nx = x + PW / 2, ny = y - 16;
        ctx.fillStyle = C.nut; ctx.beginPath(); ctx.ellipse(nx, ny + 2, 6, 7, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = C.nutCap; ctx.fillRect(nx - 7, ny - 6, 14, 5);
      }
    }
    // белка (ноги — s.y)
    const x = s.over ? s.x : s.px0 + (s.x - s.px0) * al, y = (s.over ? s.y : s.py0 + (s.y - s.py0) * al) - cam;
    const dead = s.over && s.why === 'fall';
    ctx.fillStyle = C.tail; ctx.beginPath(); ctx.ellipse(x - 12, y - 18, 7, 12, -.4, 0, 6.2832); ctx.fill();
    ctx.fillStyle = dead ? C.bad : C.body; ctx.beginPath(); ctx.ellipse(x, y - 12, 10, 13, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = C.belly; ctx.beginPath(); ctx.ellipse(x + 2, y - 9, 5, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = dead ? C.bad : C.body; ctx.fillRect(x - 6, y - 30, 4, 6); ctx.fillRect(x + 3, y - 30, 4, 6);
    ctx.fillStyle = C.eye; ctx.fillRect(x - 4, y - 20, 2, 2); ctx.fillRect(x + 3, y - 20, 2, 2);
  }

  ArcadeKit.define('jumper', {
    kind: 'canvas', W, H,
    title: '🐿 Прыжки вверх',
    intro: 'Белка скачет вверх по веткам. Веди пальцем влево-вправо — белка бежит за ним. Не упади! 🌰 жёлудь — +5, сухая ветка ломается после прыжка. Подъём — 2 минуты. Первый тап — первый прыжок.',
    controls: 'Палец или мышь — куда бежать (можно отпускать). Клавиши ← / → или A / D.',
    duelTitle: 'Одинаковое дерево у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1 },
    drag: true,
    create, input, step, draw, gen: add,   // gen — для тестов генератора веток (scripts/arcade/jumper.cjs)
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) * 100000 + s.m : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с · ' + s.m + ' м' : 'Тап — прыжок'),
    win: s => s.m >= 100,
    result: s => ({
      title: s.why === 'time' ? (s.m >= 300 ? '🏆 На самой верхушке!' : '⏱ Время вышло') : '🍂 Белка упала',
      text: 'высота: ' + s.m + ' м' + (s.nuts ? ' · 🌰 ' + s.nuts : ''),
    }),
    consts: { W, H, HW, HH, PW, PH, FOLLOW, G, VJ, VX, VK, LIMIT, RING, GAP0, GAPK, GAPMAX, DRY, SWAY, NUT },
  });
})();

// ═══════════════════════════════════════
//  ИГРА «НАЛЕЙ ВОДЫ» (T-140) — рисуй пальцем горки, чтобы вода из крана попала в стакан. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, тяжесть — единиц поля в секунду², 3 подшага на шаг.
// Партия — 2 минуты, уровни идут один за другим: кран, стакан, а со 2-го уровня — полки на пути.
// Своё: чернила на уровень ограничены — сэкономил (и налил больше половины) — бонус; ⭐ за 80 капель из 100 (+20);
// полки (со 2-го уровня) и наклонные доски (с 4-го); вода течёт, как только отпустил палец (или пробел; сама — когда 4 с
// ничего не рисуешь: пока палец рисует, вода ждёт — проверка T-140: раньше 4 с считались от начала уровня и вода лилась
// на недорисованную горку).
// Проверка T-140 (D2): капля считается, только если по пути коснулась ТВОЕЙ линии. Раньше вода, что лилась сама (4 с без
// рисования, пробел) и попадала в стакан по полкам и доскам уровня, давала очки и ⭐: партия без единой линии выигрывала
// 27 из 200 (в среднем 54 очка), «только пробел» — 44 из 200. Такие капли в стакане видны, но не в счёт. Победа — 3 ⭐ за
// партию (одна ⭐ бывала и от каракулей наугад: 16 из 30 партий; три — 2 из 30, у бота-горки — 5–18 ⭐).
// Исправлено против прототипа: (1) капли двигались «за кадр» — на 144 Гц вода лилась в 2,4 раза быстрее; теперь шаг 60 Гц,
// 3 подшага, скорости в секунду (и предел скорости — капля не проскакивает линию); (2) Ls.flatMap / slice / map / W.filter и
// новые объекты-капли каждый кадр (мусор) — теперь пулы в типизированных массивах; (3) Math.random — rng (у соперников те же
// уровни и струя); (4) pointerleave обрывал линию у края холста — теперь захват указателя ядра; (5) линии можно было рисовать
// бесконечно — теперь чернила; (6) после конца тап сразу начинал заново — теперь кнопка ядра; (7) у партии был один уровень
// и никакого конца по времени — теперь уровни и общие 2 минуты (для соревнования).
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, SPY = 30, GW = 64, GY = 364, GB = 428, RD = 2.5, RC = 5.5;
  const NP = 128, NS = 160, NDROP = 100, EMIT = 2, SUB = 3, AGE = 6 * 60, AUTO = 4 * 60, PAUSE = 70;
  const G0 = 1100, VMAX = 640, INK = 440, STEPD = 8, TIME = 120 * 60, WINSTARS = 3;
  const C = { bg: '#141a2b', tile: 'rgba(255,255,255,.03)', tap: '#9aa4b8', tapD: '#5d6678', glass: '#bcd7ff', glassBg: 'rgba(188,215,255,.07)', water: '#4db8ff',
    waterD: 'rgba(77,184,255,.55)', line: '#ffffff', shelf: '#b08355', shelfD: '#7a5532', ink: '#5ad1ff', inkBg: 'rgba(255,255,255,.08)', star: '#ffd166', good: 'rgba(122,255,170,.16)', poor: 'rgba(255,77,109,.14)', selfW: 'rgba(188,215,255,.16)' };

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }
  const U = 1 / 16777216;

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, over: false, why: '', snd: 0,
      lv: 0, ph: 0, pt: 0, idle: 0, sx: 160, gx: 100, qa: .5, qb: .5, qc: .5, qd: .5, emitted: 0, got: 0, ink: INK, dr: 0, lx: 0, ly: 0, nfix: 0, ns: 0, mine: 0,
      stars: 0, total: 0, bonus: 0, lastGot: -1, lastStar: 0, self: 0, selfAll: 0,
      x: new Float64Array(NP), y: new Float64Array(NP), x0: new Float64Array(NP), y0: new Float64Array(NP), vx: new Float64Array(NP), vy: new Float64Array(NP),
      on: new Uint8Array(NP), age: new Uint16Array(NP), mark: new Uint8Array(NP),
      ax: new Float64Array(NS), ay: new Float64Array(NS), bx: new Float64Array(NS), by: new Float64Array(NS),
      x1: new Float64Array(NS), x2: new Float64Array(NS), y1: new Float64Array(NS), y2: new Float64Array(NS), kind: new Uint8Array(NS) };
    level(s);
    return s;
  }

  // отрезок из s.qa…s.qd (дробные — через поля состояния: дробное в аргументе вызова «упаковывается» — мусор на каждое движение)
  function seg(s, kind){
    const k = s.ns, ax = s.qa, ay = s.qb, bx = s.qc, by = s.qd;
    if (k >= NS) return;
    s.ax[k] = ax; s.ay[k] = ay; s.bx[k] = bx; s.by[k] = by; s.kind[k] = kind;
    s.x1[k] = Math.min(ax, bx) - RC; s.x2[k] = Math.max(ax, bx) + RC; s.y1[k] = Math.min(ay, by) - RC; s.y2[k] = Math.max(ay, by) + RC;
    s.ns = k + 1;
  }

  // неподвижные отрезки уровня (раз в уровень — здесь дробные аргументы не страшны)
  function line(s, ax, ay, bx, by, kind){ s.qa = ax; s.qb = ay; s.qc = bx; s.qd = by; seg(s, kind); }

  // новый уровень: кран и стакан не друг над другом; полки — со 2-го, наклонные доски — с 4-го
  function level(s){
    s.lv++; s.ph = 0; s.pt = 0; s.idle = 0; s.emitted = 0; s.got = 0; s.self = 0; s.ink = INK; s.dr = 0; s.ns = 0; s.mine = 0;
    s.on.fill(0);
    let sx = 0, gx = 0;
    for (let k = 0; k < 30; k++) {
      sx = 36 + rnd(s) % 249; gx = 14 + rnd(s) % 229;
      if (Math.abs(sx - (gx + GW / 2)) >= 90) break;
    }
    if (Math.abs(sx - (gx + GW / 2)) < 90) gx = sx < W / 2 ? W - GW - 14 : 14;
    s.sx = sx; s.gx = gx;
    line(s, gx, GY, gx, GB, 1); line(s, gx, GB, gx + GW, GB, 1); line(s, gx + GW, GB, gx + GW, GY, 1);
    if (s.lv >= 2) {
      // полка поперёк пути воды: между струёй и стаканом, но не над стаканом (её можно обойти горкой сверху)
      const gc = gx + GW / 2, dir = gc > sx ? 1 : -1, room = Math.abs(gc - sx) - 10 - GW / 2 - 12;
      const len = Math.min(room, 60 + rnd(s) % 60), x0 = sx + dir * (10 + (room - len) * (rnd(s) % 100) / 100);
      const y = 170 + rnd(s) % 110, tilt = s.lv >= 4 ? ((rnd(s) % 61) - 30) : 0;
      if (len >= 40) line(s, x0, y - tilt / 2, x0 + dir * len, y + tilt / 2, 2);
    }
    if (s.lv >= 5 && rnd(s) % 2) {
      // вторая доска у стены
      const left = rnd(s) % 2, y = 120 + rnd(s) % 80, x = left ? 0 : W - 80;
      line(s, x, y + (left ? -12 : 12), x + 80, y + (left ? 12 : -12), 2);
    }
    s.nfix = s.ns;
  }

  function pour(s){ if (s.ph === 0) { s.ph = 1; s.pt = 0; s.snd = 'move'; } }

  function input(s, e){
    if (s.over) return;
    const x = e.x < 0 ? 0 : e.x > W ? W : e.x, y = e.y < 0 ? 0 : e.y > H ? H : e.y;
    if (e.type === T.DOWN) {
      if (s.ph > 2) return;
      s.dr = s.ink > 1 ? 1 : 0; s.lx = x; s.ly = y;
      if (s.dr) s.idle = 0;   // начал рисовать — отсчёт «сама польётся» заново
    } else if (e.type === T.MOVE && s.dr) {
      const dx = x - s.lx, dy = y - s.ly, d = Math.sqrt(dx * dx + dy * dy);
      if (d < STEPD) return;
      const use = d < s.ink ? d : s.ink, k = use / d, ex = s.lx + dx * k, ey = s.ly + dy * k;
      s.qa = s.lx; s.qb = s.ly; s.qc = ex; s.qd = ey; seg(s, 0);
      s.ink -= use; s.mine++;
      s.lx = ex; s.ly = ey;
      if (s.ink <= 1 || s.ns >= NS) s.dr = 0;
    } else if (e.type === T.UP) {
      s.dr = 0;
      if (s.mine) pour(s);
    } else if (e.type === T.KEY && e.k === 0) pour(s);
    else if (e.type === T.CANCEL) s.dr = 0;   // пауза / потеря фокуса — линия кончилась, вода ещё ждёт (можно дорисовать)
  }

  // одна капля против всех отрезков (рамка — отсев, потом ближайшая точка отрезка)
  function collide(s, i){
    const ns = s.ns;
    for (let k = 0; k < ns; k++) {
      const px = s.x[i], py = s.y[i];
      if (px < s.x1[k] || px > s.x2[k] || py < s.y1[k] || py > s.y2[k]) continue;
      const ax = s.ax[k], ay = s.ay[k], ex = s.bx[k] - ax, ey = s.by[k] - ay, l = ex * ex + ey * ey + 1e-9;
      let u = ((px - ax) * ex + (py - ay) * ey) / l;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + u * ex, qy = ay + u * ey, rx = px - qx, ry = py - qy, q = rx * rx + ry * ry;
      if (q >= RC * RC) continue;
      const d = Math.sqrt(q) + 1e-6, nx = rx / d, ny = ry / d;
      s.x[i] = qx + nx * RC; s.y[i] = qy + ny * RC;
      const dot = s.vx[i] * nx + s.vy[i] * ny;
      const kk = dot < 0 ? 1.3 * dot : 0;
      s.vx[i] = (s.vx[i] - kk * nx) * .992; s.vy[i] = (s.vy[i] - kk * ny) * .992;
      s.mark[i] |= s.kind[k] === 0 ? 1 : 0;   // коснулась линии игрока — капля «его»
    }
  }

  function endLevel(s){
    s.ph = 3; s.pt = 0; s.total += s.got;
    let b = 0;
    s.lastStar = s.got >= 80 ? 1 : 0;
    if (s.lastStar) { b += 20; s.stars++; }
    if (s.got >= 50) b += Math.floor(s.ink / 20);
    s.bonus += b; s.score += b;
    s.lastGot = s.got;
    s.snd = s.got >= 80 ? 'win' : s.got >= 50 ? 'ok' : 'bad';
  }

  function step(s, dt){
    if (s.over) return;
    s.t++; s.pt++;
    s.left = TIME - s.t;
    // сама вода льётся, когда AUTO шагов подряд ничего не рисуют (палец рисует — ждёт)
    if (s.ph === 0) { if (s.dr) s.idle = 0; else if (++s.idle >= AUTO) pour(s); }
    if (s.ph === 3) {
      if (s.pt >= PAUSE) level(s);
    } else if (s.ph >= 1) {
      // струя: капля каждые EMIT шагов, лёгкое дрожание из rng
      if (s.ph === 1 && s.pt % EMIT === 0) {
        let i = 0;
        while (i < NP && s.on[i]) i++;
        if (i < NP) {
          s.on[i] = 1; s.age[i] = 0; s.mark[i] = 0;
          s.x[i] = s.sx + ((rnd(s) % 61) - 30) * .1; s.y[i] = SPY + 6; s.vx[i] = ((rnd(s) % 41) - 20); s.vy[i] = 60;
          s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
        }
        if (++s.emitted >= NDROP) s.ph = 2;
      }
      const h = dt / SUB, gx = s.gx;
      let alive = 0;
      for (let i = 0; i < NP; i++) {
        if (!s.on[i]) continue;
        s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
        for (let sub = 0; sub < SUB; sub++) {
          let vy = s.vy[i] + G0 * h;
          vy = vy > VMAX ? VMAX : vy;
          s.vy[i] = vy;
          s.x[i] += s.vx[i] * h; s.y[i] += vy * h;
          if (s.x[i] < RD) { s.x[i] = RD; s.vx[i] = Math.abs(s.vx[i]) * .4; }
          else if (s.x[i] > W - RD) { s.x[i] = W - RD; s.vx[i] = -Math.abs(s.vx[i]) * .4; }
          collide(s, i);
        }
        const x = s.x[i], y = s.y[i];
        if (y > GY + 6 && y < GB && x > gx + 2 && x < gx + GW - 2) {
          s.on[i] = 0;
          // не касалась твоей линии — попала сама (полки и доски уровня): видна, но не в счёт
          if (!s.mark[i]) { s.self++; s.selfAll++; continue; }
          s.got++; s.score++; s.snd = s.got % 10 === 0 ? 523 + s.got * 4 : s.snd;
          continue;
        }
        if (y > H + 12 || ++s.age[i] > AGE) { s.on[i] = 0; continue; }
        alive++;
      }
      if (s.ph === 2 && !alive) endLevel(s);
    }
    if (s.left <= 0) {
      if (s.ph === 1 || s.ph === 2) s.total += s.got;
      s.over = true; s.why = 'time'; s.snd = s.stars ? 'win' : 'ok';
    }
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a, gx = s.gx;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.tile;
    for (let y = 20; y < H; y += 40) for (let x = (y / 40) % 2 ? 0 : 20; x < W; x += 40) ctx.fillRect(x, y, 20, 20);
    if (s.ph === 3) { ctx.fillStyle = s.lastGot >= 50 ? C.good : C.poor; ctx.fillRect(0, 0, W, H); }
    // кран
    ctx.fillStyle = C.tapD; ctx.fillRect(s.sx - 30, 0, 26, 12);
    ctx.fillStyle = C.tap; ctx.fillRect(s.sx - 12, 8, 24, 14); ctx.fillRect(s.sx - 7, 20, 14, SPY - 18);
    // стакан: фон, вода (уровень — сколько налито), стенки
    ctx.fillStyle = C.glassBg; ctx.fillRect(gx, GY, GW, GB - GY);
    const lvl = (GB - GY - 4) * Math.min(1, s.got / NDROP), lv2 = (GB - GY - 4) * Math.min(1, (s.got + s.self) / NDROP);
    // капли «сами» (не касались твоей линии) — бледный слой поверх: видно, что вода попала, но не в счёт
    if (lv2 > lvl) { ctx.fillStyle = C.selfW; ctx.fillRect(gx + 3, GB - lv2, GW - 6, lv2 - lvl); }
    ctx.fillStyle = C.waterD; ctx.fillRect(gx + 3, GB - lvl, GW - 6, lvl);
    ctx.fillStyle = C.star; ctx.fillRect(gx - 4, GB - (GB - GY - 4) * .8 - 1, 6, 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // отрезки: стакан, полки, линии игрока — по виду одним путём
    for (let kind = 0; kind < 3; kind++) {
      ctx.strokeStyle = kind === 0 ? C.line : kind === 1 ? C.glass : C.shelf;
      ctx.lineWidth = kind === 2 ? 8 : 5;
      ctx.beginPath();
      for (let j = 0; j < s.ns; j++) {
        if (s.kind[j] !== kind) continue;
        ctx.moveTo((s.ax[j] + .5) | 0, (s.ay[j] + .5) | 0); ctx.lineTo((s.bx[j] + .5) | 0, (s.by[j] + .5) | 0);
      }
      ctx.stroke();
    }
    // капли
    ctx.fillStyle = C.water;
    ctx.beginPath();
    for (let i = 0; i < NP; i++) {
      if (!s.on[i]) continue;
      // целые координаты: дробные в вызов canvas «упаковываются» (16 байт на число) — капель до сотни на кадр
      ctx.rect((s.x0[i] + (s.x[i] - s.x0[i]) * k - 2) | 0, (s.y0[i] + (s.y[i] - s.y0[i]) * k - 2) | 0, 5, 5);
    }
    ctx.fill();
    // чернила — тонкая полоса у нижнего края поля
    ctx.fillStyle = C.inkBg; ctx.fillRect(8, H - 7, W - 16, 4);
    ctx.fillStyle = C.ink; ctx.fillRect(8, H - 7, (W - 16) * s.ink / INK, 4);
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('pour', {
    kind: 'canvas', W, H, drag: true,
    title: '🥛 Налей воды',
    intro: 'Нарисуй пальцем горку от крана к стакану и отпусти — польётся вода. Капля, что прокатилась по твоей линии и попала в стакан, — очко, 80 из 100 — ⭐, три ⭐ — победа. Чернила ограничены: сэкономишь — бонус. 2 минуты, уровни всё хитрее.',
    controls: 'Рисуй пальцем (или мышью с зажатой кнопкой), отпусти — вода польётся. Пробел — лить сразу. Пока рисуешь, вода ждёт; не рисуешь 4 с — польётся сама.',
    duelTitle: 'Одинаковые уровни у обоих',
    keys: { Space: 0 },
    create, input, step, draw,
    hudKey: s => s.lv * 1e8 + s.ph * 1e7 + s.got * 1e4 + Math.ceil(s.left / 60),
    // коротко — на телефоне 360 px строка не обрезается («рисуй горку» — в подсказке на старте)
    hud: s => '⏱ ' + clock(s.left) + ' · ур. ' + s.lv + ' · 💧 ' + s.got + '/' + NDROP + (s.ph === 3 && s.lastStar ? ' ⭐' : ''),
    win: s => s.stars >= WINSTARS,
    result: s => ({
      title: s.stars >= 5 ? '🏆 Мастер воды!' : s.stars >= WINSTARS ? '⭐ Стаканы полны!' : '⏰ Время вышло',
      text: 'налито капель: ' + s.total + ' · уровней: ' + (s.ph === 3 ? s.lv : s.lv - 1) + ' · ⭐ ' + s.stars + (s.bonus ? ' · бонусы +' + s.bonus : '')
        + (s.selfAll ? ' · сами, мимо линии (не в счёт): ' + s.selfAll : ''),
    }),
    consts: { W, H, SPY, GW, GY, GB, RD, RC, NP, NS, NDROP, EMIT, SUB, AGE, AUTO, PAUSE, G0, VMAX, INK, STEPD, TIME, WINSTARS },
  });
})();

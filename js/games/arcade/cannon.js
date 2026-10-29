// ═══════════════════════════════════════
//  ИГРА «ПУШКА» (T-140) — води пушку, она стреляет сама: желейные шарики делятся на два меньших. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — единиц поля в секунду, тяжесть — в секунду².
// Очки: попадание — 1, лопнувший шарик — ещё 5. Партия — 2 минуты или пока у пушки есть ❤ (3).
// Своё: желейные шарики (а не камни), у пушки 3 ❤ и 1,5 с неуязвимости после удара (в прототипе — сразу конец); большой
// шарик, лопаясь, роняет ⚡ — поймал пушкой — двойной огонь на 6 с; новые шарики приходят по времени (у соперников одинаково),
// их прочность растёт со временем, а не со счётом.
// Исправлено против прототипа: (1) всё двигалось «за кадр» — на 144 Гц шарики прыгали в 2,4 раза быстрее; теперь шаг 60 Гц,
// скорости в секунду; (2) k.mh не существовало (const h = Math.ceil(k.mh / 2) || 4 — всегда 4, переменная не использовалась);
// (3) пули проверялись против каждого шарика без пометки — одна пуля могла отнять прочность у двух шариков; (4) R.filter /
// B.filter / add.push / forEach-объекты каждый кадр (мусор) — теперь пулы в типизированных массивах; (5) Math.random — rng;
// (6) прочность росла от счёта (сильный игрок получал шарики крепче, чем соперник) — теперь от времени; (7) после конца тап
// сразу начинал заново; (8) у партии не было конца по времени; (9) удар считался по прямоугольнику «шарик ± пушка» (задевал
// углом пустоты) — теперь круг против корпуса; маленькие шарики прыгали так низко, что уйти было некуда, — прыжок выше.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, GY = 400, CY = 372, CW = 28, BY = 366, NB = 48, NR = 32, FIRE = 8, BV = 540, MOVEV = 620, KEYV = 300;
  const RAD = Int8Array.of(30, 21, 15, 10), G0 = 650, BJ = 380, VX = 84, TIME = 120 * 60, HEARTS = 3, SAFE = 90, PWR = 6 * 60;
  const COL = ['#ff5fa2', '#9b5cff', '#35c3e0', '#7ae582'];
  const C = { sky: '#141a2e', hill: '#1b2440', ground: '#2e6b3f', groundD: '#24552f', gun: '#ffc233', gunD: '#c28a14', bul: '#ffffff', ink: '#ffffff', zap: '#ffd166',
    heart: '#ff2d55', heartOff: 'rgba(255,255,255,.15)', hit: 'rgba(255,45,85,.25)', shine: 'rgba(255,255,255,.3)' };
  const NUMS = []; for (let i = 0; i < 200; i++) NUMS.push(String(i));
  const FONTS = ['bold 20px system-ui, sans-serif', 'bold 15px system-ui, sans-serif', 'bold 12px system-ui, sans-serif', 'bold 10px system-ui, sans-serif'];

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, over: false, why: '', snd: 0,
      cx: W / 2, cx0: W / 2, tx: W / 2, hearts: HEARTS, safe: 0, pwr: 0, spawn: 30, hits: 0, pops: 0, bigs: 0, flash: 0,
      zx: 0, zy: 0, zy0: 0, zon: 0,
      bx: new Float64Array(NB), by: new Float64Array(NB), by0: new Float64Array(NB), bon: new Uint8Array(NB),
      x: new Float64Array(NR), y: new Float64Array(NR), x0: new Float64Array(NR), y0: new Float64Array(NR), vx: new Float64Array(NR), vy: new Float64Array(NR),
      sz: new Uint8Array(NR), hp: new Uint8Array(NR), h0: new Uint8Array(NR), on: new Uint8Array(NR) };
    return s;
  }

  function slot(s){ for (let i = 0; i < NR; i++) if (!s.on[i]) return i; return -1; }

  // новый большой шарик: слева или справа сверху (rng); прочность растёт со временем
  function spawn(s){
    const i = slot(s);
    if (i < 0) return;
    const left = rnd(s) % 2;
    s.on[i] = 1; s.sz[i] = 0; s.hp[i] = Math.min(99, 8 + ((s.t / 480) | 0)); s.h0[i] = s.hp[i];
    s.x[i] = left ? 40 : W - 40; s.y[i] = 60; s.vx[i] = left ? VX : -VX; s.vy[i] = 0; s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) s.tx = e.x;
  }

  function fireOne(s, x){
    for (let b = 0; b < NB; b++) {
      if (s.bon[b]) continue;
      s.bon[b] = 1; s.bx[b] = x; s.by[b] = BY; s.by0[b] = BY;
      return;
    }
  }

  // шарик i лопнул: два меньших (если не самый маленький), +5; большой роняет ⚡
  function pop(s, i){
    const z = s.sz[i];
    s.on[i] = 0; s.pops++; s.score += 5; s.snd = 392 + z * 131;
    if (z === 0) { s.bigs++; if (!s.zon) { s.zon = 1; s.zx = s.x[i]; s.zy = s.y[i]; s.zy0 = s.zy; } }
    if (z >= 3) return;
    const hp = Math.max(2, (s.h0[i] + 1) >> 1);
    for (let k = 0; k < 2; k++) {
      const j = slot(s);
      if (j < 0) return;
      s.on[j] = 1; s.sz[j] = z + 1; s.hp[j] = hp; s.h0[j] = hp;
      s.x[j] = s.x[i] + (k ? 6 : -6); s.y[j] = s.y[i]; s.x0[j] = s.x[j]; s.y0[j] = s.y[j];
      s.vx[j] = k ? 90 : -90; s.vy[j] = -240;
    }
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.t++;
    s.left = TIME - s.t;
    s.flash = s.flash > 0 ? s.flash - 1 : 0;
    s.safe = s.safe > 0 ? s.safe - 1 : 0;
    s.pwr = s.pwr > 0 ? s.pwr - 1 : 0;
    // пушка: клавиши — сразу, палец — к цели с пределом скорости
    s.cx0 = s.cx;
    const keys = inp ? inp.keys : 0;
    if (keys & 3) { s.cx += ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYV * dt; s.tx = s.cx; }
    else { const d = s.tx - s.cx, m = MOVEV * dt; s.cx += d > m ? m : d < -m ? -m : d; }
    s.cx = s.cx < CW / 2 ? CW / 2 : s.cx > W - CW / 2 ? W - CW / 2 : s.cx;
    // огонь сам; ⚡ — две пули рядом
    if (s.t % FIRE === 0) { if (s.pwr) { fireOne(s, s.cx - 7); fireOne(s, s.cx + 7); } else fireOne(s, s.cx); }
    for (let b = 0; b < NB; b++) {
      if (!s.bon[b]) continue;
      s.by0[b] = s.by[b]; s.by[b] -= BV * dt;
      if (s.by[b] < -12) s.bon[b] = 0;
    }
    // новые шарики: по времени (каждые 7 с, потом чаще); пусто на поле — через секунду
    let alive = 0;
    for (let i = 0; i < NR; i++) alive += s.on[i];
    if (!alive && s.spawn > 60) s.spawn = 60;
    if (--s.spawn <= 0) { spawn(s); s.spawn = Math.max(240, 420 - ((s.t / 30) | 0)); }
    // шарики: тяжесть, стены, пол (прыжок на высоту по размеру), пули, пушка
    for (let i = 0; i < NR; i++) {
      if (!s.on[i]) continue;
      const r = RAD[s.sz[i]];
      s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
      s.vy[i] += G0 * dt; s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt;
      if (s.x[i] < r) { s.x[i] = r; s.vx[i] = Math.abs(s.vx[i]); } else if (s.x[i] > W - r) { s.x[i] = W - r; s.vx[i] = -Math.abs(s.vx[i]); }
      if (s.y[i] + r > GY) { s.y[i] = GY - r; s.vy[i] = -(BJ + r * 3); }
      for (let b = 0; b < NB; b++) {
        if (!s.bon[b]) continue;
        const dx = s.bx[b] - s.x[i], dy = s.by[b] - s.y[i];
        if (dx * dx + dy * dy >= r * r) continue;
        s.bon[b] = 0; s.hits++; s.score++;
        if (--s.hp[i] === 0) { pop(s, i); break; }
      }
      if (!s.on[i] || s.safe) continue;
      // удар: круг шарика против корпуса пушки (ближайшая точка прямоугольника), с запасом 15 % — края честные
      const qx = s.x[i] < s.cx - CW / 2 ? s.cx - CW / 2 : s.x[i] > s.cx + CW / 2 ? s.cx + CW / 2 : s.x[i], qy = s.y[i] < CY + 4 ? CY + 4 : s.y[i];
      const ex = s.x[i] - qx, ey = s.y[i] - qy;
      if (ex * ex + ey * ey < r * r * .72) {
        s.hearts--; s.safe = SAFE; s.flash = 24; s.snd = 'bad'; s.vy[i] = -(BJ + r * 3);
        if (s.hearts <= 0) { s.over = true; s.why = 'hit'; return; }
      }
    }
    // ⚡ падает; пушка поймала — двойной огонь
    if (s.zon) {
      s.zy0 = s.zy; s.zy += 160 * dt;
      if (s.zy > CY - 6 && Math.abs(s.zx - s.cx) < CW / 2 + 8) { s.zon = 0; s.pwr = PWR; s.snd = 'win'; }
      else if (s.zy > GY) s.zon = 0;
    }
    if (s.left <= 0) { s.over = true; s.why = 'time'; s.snd = 'win'; }
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.hill; ctx.fillRect(0, GY - 60, W, 60);
    if (s.flash) { ctx.fillStyle = C.hit; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = C.ground; ctx.fillRect(0, GY, W, H - GY);
    ctx.fillStyle = C.groundD; ctx.fillRect(0, GY, W, 4);
    // пули одним путём
    ctx.fillStyle = C.bul; ctx.beginPath();
    for (let b = 0; b < NB; b++) { if (!s.bon[b]) continue; ctx.rect((s.bx[b] - 2) | 0, (s.by0[b] + (s.by[b] - s.by0[b]) * k) | 0, 4, 10); }
    ctx.fill();
    // шарики по размеру одним путём, потом блики и числа прочности
    for (let z = 0; z < 4; z++) {
      ctx.fillStyle = COL[z]; ctx.beginPath();
      for (let i = 0; i < NR; i++) {
        if (!s.on[i] || s.sz[i] !== z) continue;
        const r = RAD[z], x = s.x0[i] + (s.x[i] - s.x0[i]) * k, y = s.y0[i] + (s.y[i] - s.y0[i]) * k;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.fillStyle = C.shine; ctx.beginPath();
    for (let i = 0; i < NR; i++) {
      if (!s.on[i]) continue;
      const r = RAD[s.sz[i]], x = s.x0[i] + (s.x[i] - s.x0[i]) * k, y = s.y0[i] + (s.y[i] - s.y0[i]) * k;
      ctx.rect(x - r * .55, y - r * .6, r * .4, r * .25);
    }
    ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.ink;
    for (let z = 0; z < 4; z++) {
      let set = false;
      for (let i = 0; i < NR; i++) {
        if (!s.on[i] || s.sz[i] !== z) continue;
        if (!set) { ctx.font = FONTS[z]; set = true; }
        ctx.fillText(NUMS[s.hp[i]], s.x0[i] + (s.x[i] - s.x0[i]) * k, s.y0[i] + (s.y[i] - s.y0[i]) * k + 1);
      }
    }
    // ⚡
    if (s.zon) {
      const y = s.zy0 + (s.zy - s.zy0) * k;
      ctx.fillStyle = C.zap; ctx.beginPath(); ctx.moveTo(s.zx, y - 9); ctx.lineTo(s.zx + 7, y); ctx.lineTo(s.zx, y + 9); ctx.lineTo(s.zx - 7, y); ctx.fill();
    }
    // пушка (мигает, пока неуязвима)
    if (!(s.safe & 4)) {
      const x = s.over ? s.cx : s.cx0 + (s.cx - s.cx0) * k;
      ctx.fillStyle = s.pwr ? C.zap : C.gun; ctx.fillRect(x - CW / 2, CY + 4, CW, GY - CY - 6); ctx.fillRect(x - 4, CY - 6, 8, 12);
      if (s.pwr) { ctx.fillRect(x - 11, CY - 2, 6, 8); ctx.fillRect(x + 5, CY - 2, 6, 8); }
      ctx.fillStyle = C.gunD; ctx.fillRect(x - CW / 2, GY - 6, CW, 4);
    }
    // ❤ внизу слева
    for (let h = 0; h < HEARTS; h++) { ctx.fillStyle = h < s.hearts ? C.heart : C.heartOff; ctx.fillRect(8 + h * 14, GY + 16, 10, 9); }
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('cannon', {
    kind: 'canvas', W, H, drag: true,
    title: '💥 Пушка',
    intro: 'Веди пушку пальцем — она стреляет сама. Желейные шарики после стольких попаданий, сколько на них написано, делятся на два поменьше. Не дай им прыгнуть на пушку: у неё 3 ❤. Большой шарик роняет ⚡ — двойной огонь. 2 минуты.',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) по полю. Клавиатура: ← → или A D.',
    duelTitle: 'Одинаковые шарики у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1 },
    create, input, step, draw,
    hudKey: s => s.hearts * 1e4 + (s.pwr ? 1e3 : 0) + Math.ceil(s.left / 60),
    hud: s => '❤ ' + s.hearts + (s.pwr ? ' · ⚡ двойной огонь' : '') + ' · ⏱ ' + clock(s.left),
    win: s => s.why === 'time' || s.pops >= 30,
    result: s => ({
      title: s.why === 'time' ? (s.hearts === HEARTS ? '🏆 Ни царапины!' : '💥 Пушка выстояла!') : '🫠 Шарики победили',
      text: 'попаданий: ' + s.hits + ' · лопнуло шариков: ' + s.pops,
    }),
    consts: { W, H, GY, CY, CW, BY, NB, NR, FIRE, BV, MOVEV, RAD, G0, BJ, VX, TIME, HEARTS, SAFE, PWR },
  });
})();

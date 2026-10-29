// ═══════════════════════════════════════
//  ИГРА «НАРЕЗКА» (T-140) — режь взмахом овощи для супа, камни не трогай. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — единиц поля в секунду, тяжесть — в секунду².
// Своё: тема — суп: морковь, картошка, лук, помидор, огурец, кукуруза (свои рисунки), вместо бомб — 🪨 камни (тупят нож,
// минус ❤); сверху — заказ супа из 3 овощей: овощ из заказа — 2 очка, весь заказ — +10 и новый; 3+ овоща одним взмахом —
// бонус. 3 ❤: упал неразрезанный овощ или разрезан камень — минус ❤. Партия — до 2 минут.
// Исправлено против прототипа: (1) движение «за кадр» с множителем k (на 144 Гц и при рывках — по-разному) — теперь шаг
// 60 Гц, скорости в секунду; (2) резали прямо в обработчике pointermove — по положению овощей «между кадрами»; теперь взмах
// — событие очереди, режет на границе шага; (3) бомба и упавший фрукт в одном кадре вызывали конец дважды, а ❤ отнимались
// и после конца; (4) F.filter и объекты следа на каждое движение (мусор) — теперь пулы; (5) Math.random — теперь rng (у
// соперников одинаковые броски); (6) тап после конца сразу начинал новую; (7) конца по времени не было.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, NI = 24, NTR = 12, TIME = 120 * 60, HEARTS = 3;
  const G0 = 800, VY0 = 540, VY1 = 700, R = 20, CUT = 24, PIECE = 30, TRL = 9;
  const VEG = 6, STONE = 6;                                // типы 0…5 — овощи, 6 — камень
  const COL = ['#ff8a1f', '#b98b4e', '#c44f8a', '#ff3b3b', '#3fbf5a', '#ffd23f', '#7d8190'];
  const ICON = ['🥕', '🥔', '🧅', '🍅', '🥒', '🌽'];
  const C = { bg: '#1a1410', board: '#2a2018', grain: 'rgba(255,220,170,.05)', leaf: '#3fae4a', dark: 'rgba(0,0,0,.22)', light: 'rgba(255,255,255,.28)', trail: '#ffffff', hit: 'rgba(255,45,85,.25)', stone: '#5c606c' };

  // свой маленький генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 (× U = доля) — без «упакованных» дробных
  // из замыкания ядра. Код шага пишется «без редких веток с вычислениями»: всё считается каждый раз, ветка только выбирает
  // значение — иначе JIT, не видевший ветку, выкидывает готовый код при первом её проходе (мусор и рывок посреди партии)
  const U = 1 / 16777216;
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }

  function order(s){
    for (let i = 0; i < 3; i++) s.ord[i] = rnd(s) % VEG;
    s.ordMask = 0;
  }

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, hearts: HEARTS, cuts: 0, soups: 0, best: 0, wave: 50, over: false, why: '', snd: 0, flash: 0,
      lx: 0, ly: 0, sw: 0, combo: 0, ordMask: 0, th: 0,
      x: new Float64Array(NI), y: new Float64Array(NI), x0: new Float64Array(NI), y0: new Float64Array(NI), vx: new Float64Array(NI), vy: new Float64Array(NI),
      ty: new Uint8Array(NI), st: new Uint8Array(NI), age: new Uint16Array(NI), spin: new Float64Array(NI),
      ord: new Uint8Array(3), tx: new Float64Array(NTR), tyy: new Float64Array(NTR), tt: new Float64Array(NTR).fill(-1e9) };
    order(s);
    return s;
  }

  // отрезок взмаха (ax, ay) → (bx, by) режет всё, что ближе CUT к нему
  function swipe(s, ax, ay, bx, by){
    const ex = bx - ax, ey = by - ay, l = ex * ex + ey * ey + 1e-9;
    for (let i = 0; i < NI; i++) {
      if (s.st[i] !== 1) continue;
      let u = ((s.x[i] - ax) * ex + (s.y[i] - ay) * ey) / l;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = s.x[i] - ax - u * ex, dy = s.y[i] - ay - u * ey;
      if (dx * dx + dy * dy >= CUT * CUT) continue;
      // разрезан: половинки разлетаются поперёк взмаха
      s.st[i] = 2; s.age[i] = 0;
      const t = s.ty[i], stone = t === STONE;
      s.hearts -= stone ? 1 : 0; s.flash = stone ? 24 : s.flash; s.snd = stone ? 'bad' : s.snd;
      if (stone) continue;
      s.cuts++; s.combo++;
      let k = -1;
      for (let j = 0; j < 3; j++) k = k < 0 && !(s.ordMask & (1 << j)) && s.ord[j] === t ? j : k;
      const bit = 1 << (k < 0 ? 0 : k), cb = s.combo - 2;
      s.ordMask |= k >= 0 ? bit : 0;
      s.score += (k >= 0 ? 2 : 1) + (cb > 0 ? cb : 0);
      s.best = s.combo > s.best ? s.combo : s.best;
      const full = s.ordMask === 7, note = 520 + s.combo * 60;
      s.score += full ? 10 : 0; s.soups += full ? 1 : 0;
      s.snd = full ? 'win' : note;
      if (full) order(s);
    }
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN) { s.sw = 1; s.combo = 0; s.lx = e.x; s.ly = e.y; }
    else if (e.type === T.MOVE && s.sw) {
      swipe(s, s.lx, s.ly, e.x, e.y);
      const j = s.th++ % NTR;
      s.tx[j] = e.x; s.tyy[j] = e.y; s.tt[j] = s.t;
      s.lx = e.x; s.ly = e.y;
    } else if (e.type === T.UP) s.sw = 0;
  }

  function step(s, dt){
    if (s.over) return;
    s.t++;
    s.flash = Math.max(0, s.flash - 1);
    const sec = s.t / 60;
    // бросок: 1–4 предмета, всё чаще; камни — с 3-й секунды
    if (--s.wave <= 0) {
      s.wave = Math.round(60 * Math.max(.85, 1.7 - sec * .012));
      const n = 1 + Math.floor(rnd(s) * U * Math.min(4, 1.6 + sec / 30));
      for (let k = 0, i = 0; k < n && i < NI; i++) {
        if (s.st[i]) continue;
        s.st[i] = 1; s.age[i] = 0; k++;
        const stone = rnd(s) * U < Math.min(.2, .1 + sec * .001), vt = rnd(s) % VEG;
        s.ty[i] = sec > 3 && stone ? STONE : vt;
        s.x[i] = 50 + rnd(s) * U * (W - 100); s.y[i] = H + R;
        s.vx[i] = (W / 2 - s.x[i]) * (.2 + rnd(s) * U * .4); s.vy[i] = -(VY0 + rnd(s) * U * (VY1 - VY0));
        s.spin[i] = (rnd(s) * U - .5) * 6; s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
      }
    }
    let lost = 0;
    for (let i = 0; i < NI; i++) {
      s.x0[i] = s.x[i]; s.y0[i] = s.y[i];
      const st = s.st[i];
      if (!st) continue;
      s.age[i]++;
      s.vy[i] += G0 * dt;
      s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt;
      // упал вниз: неразрезанный овощ — минус ❤ (камень — нет); половинки живут PIECE шагов
      const down = s.vy[i] > 0 && s.y[i] > H + R + 10;
      const miss = down && st === 1 && s.ty[i] !== STONE ? 1 : 0;
      lost += miss;
      s.st[i] = (st === 2 && s.age[i] > PIECE) || down ? 0 : st;
    }
    s.hearts -= lost;
    s.flash = lost ? 24 : s.flash;
    s.snd = lost ? 'bad' : s.snd;
    s.left = TIME - s.t;
    const end = s.hearts <= 0 || s.left <= 0;
    s.hearts = s.hearts < 0 ? 0 : s.hearts;
    s.why = s.hearts <= 0 ? 'hearts' : 'time';
    const endSnd = s.hearts > 0 ? 'win' : 'bad';
    s.snd = end ? endSnd : s.snd;
    s.over = end;
  }

  // ── рисование: доска, овощи (свои фигуры), половинки, след ножа ──
  function shape(ctx, t){
    ctx.fillStyle = COL[t];
    ctx.beginPath();
    if (t === 0) { ctx.moveTo(-9, -14); ctx.lineTo(9, -14); ctx.lineTo(0, 22); ctx.closePath(); }
    else if (t === 1) ctx.ellipse(0, 0, 20, 15, 0, 0, 6.2832);
    else if (t === 4) ctx.ellipse(0, 0, 10, 22, 0, 0, 6.2832);
    else if (t === 5) ctx.ellipse(0, 0, 9, 19, 0, 0, 6.2832);
    else if (t === STONE) ctx.ellipse(0, 0, 19, 15, 0, 0, 6.2832);
    else ctx.arc(0, 0, 17, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = t === STONE ? C.stone : t === 1 ? C.dark : C.leaf;
    if (t === 0) { ctx.fillRect(-6, -22, 4, 9); ctx.fillRect(2, -22, 4, 9); }
    else if (t === 1 || t === STONE) { ctx.fillRect(-8, -4, 4, 4); ctx.fillRect(5, 3, 4, 3); ctx.fillRect(-2, 6, 3, 3); }
    else if (t === 2) { ctx.fillStyle = C.light; ctx.fillRect(-1, -22, 2, 7); ctx.fillRect(-10, -2, 20, 2); }
    else if (t === 3) { ctx.fillRect(-6, -19, 12, 4); ctx.fillRect(-1, -22, 2, 4); }
    else if (t === 4) { ctx.fillStyle = C.light; ctx.fillRect(-3, -14, 2, 4); ctx.fillRect(1, -2, 2, 4); ctx.fillRect(-3, 9, 2, 4); }
    else { ctx.fillRect(-11, 4, 4, 16); ctx.fillRect(7, 4, 4, 16); ctx.fillStyle = C.dark; ctx.fillRect(-4, -12, 2, 24); ctx.fillRect(2, -12, 2, 24); }
  }

  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.board; ctx.fillRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = C.grain;
    for (let y = 30; y < H - 20; y += 26) ctx.fillRect(14, y, W - 28, 3);
    if (s.flash) { ctx.fillStyle = C.hit; ctx.fillRect(0, 0, W, H); }
    for (let i = 0; i < NI; i++) {
      const st = s.st[i];
      if (!st) continue;
      const x = s.x0[i] + (s.x[i] - s.x0[i]) * k, y = s.y0[i] + (s.y[i] - s.y0[i]) * k, ang = s.spin[i] * s.age[i] / 60;
      if (st === 1) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang); shape(ctx, s.ty[i]); ctx.restore();
      } else {
        // половинки: два кусочка разлетаются и тают
        const f = s.age[i] / PIECE, d = 6 + 40 * f;
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = COL[s.ty[i]];
        ctx.beginPath(); ctx.arc(x - d, y, 11, 0, 6.2832); ctx.moveTo(x + d + 11, y); ctx.arc(x + d, y, 11, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // след ножа — последние точки взмаха (живут TRL шагов)
    ctx.strokeStyle = C.trail; ctx.lineCap = 'round'; ctx.lineWidth = 4;
    ctx.beginPath();
    let on = false;
    for (let n = NTR; n >= 1; n--) {
      const j = (s.th - n + NTR * 4) % NTR;
      if (s.t - s.tt[j] > TRL || s.th - n < 0) { on = false; continue; }
      if (on) ctx.lineTo(s.tx[j], s.tyy[j]); else ctx.moveTo(s.tx[j], s.tyy[j]);
      on = true;
    }
    ctx.stroke();
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('slice', {
    kind: 'canvas', W, H, drag: true,
    title: '🥕 Нарезка',
    intro: 'Варим суп! Режь взмахом пальца овощи, которые подлетают снизу. 🪨 Камни не трогай. Овощ из заказа — 2 очка, весь заказ — ещё +10. Упустил овощ — минус ❤.',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) быстрыми взмахами. Заказ супа — в строке над полем.',
    duelTitle: 'Одинаковые овощи у обоих',
    create, input, step, draw,
    hudKey: s => s.hearts * 1e6 + s.soups * 1e4 + s.ordMask * 1e3 + Math.ceil(s.left / 60),
    hud: s => '❤ ' + s.hearts + ' · в суп: ' + (s.ordMask & 1 ? '✅' : ICON[s.ord[0]]) + (s.ordMask & 2 ? '✅' : ICON[s.ord[1]]) + (s.ordMask & 4 ? '✅' : ICON[s.ord[2]]) + ' · ⏱ ' + clock(s.left),
    win: s => s.soups >= 5,
    result: s => ({
      title: s.soups >= 10 ? '👨‍🍳 Шеф-повар!' : s.soups >= 5 ? '🍲 Отличный суп!' : s.why === 'time' ? '⏰ Время вышло' : '💔 Овощи упали',
      text: 'нарезано: ' + s.cuts + ' · супов: ' + s.soups + (s.best >= 3 ? ' · лучший взмах: ' + s.best : ''),
    }),
    consts: { W, H, NI, TIME, HEARTS, G0, R, CUT, PIECE, STONE, VEG },
  });
})();

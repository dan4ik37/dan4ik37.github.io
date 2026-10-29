// ═══════════════════════════════════════
//  ИГРА «ШАРИК В ЦЕЛЬ» (T-140) — целься и роняй шарик сквозь гвоздики в цветную корзинку. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, тяжесть — единиц поля в секунду², 4 подшага.
// Это НЕ ставки: ни монет, ни ставок, ни множителей — 10 шариков, и цели меняются перед каждым: ⭐ золотая корзинка — 50,
// две зелёные — 20, остальные — 2. Попадания подряд — серия: +10 за каждое попадание сверх первого.
// Своё: цели меняются каждый шарик (из rng — у соперников одинаковые); с 4-го шарика по середине ездит планка-отбойник.
// Исправлено против прототипа: (1) монеты, ставка 10 и множители ×0,2…×5 по краям (имитация казино) — убраны совсем;
// (2) шарик двигался «за кадр» — на 144 Гц падал в 2,4 раза быстрее; теперь шаг 60 Гц, 4 подшага, скорости в секунду;
// (3) дрожание Math.random на каждом гвоздике — теперь отскок точный, а rng только когда шарик падает ровно на макушку
// гвоздика (иначе он мог бы застыть на нём); (4) B.filter и объекты-шарики каждый кадр (мусор) — теперь поля состояния;
// (5) застрявший шарик через 25 с считался «упавшим» в случайную корзинку — теперь через 10 с — в корзинку под ним;
// (6) крайние гвоздики стояли так, что шарик мог застрять у стены; (7) у партии не было конца — теперь 10 шариков.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, BR = 6.5, PR = 4, PY0 = 104, PDY = 30, PROWS = 9, NB = 8, BW = 40, DIV = 392, LAND = 424, HOLD = 34;
  const G0 = 760, REST = .5, SUB = 4, BALLS = 10, IDLE = 6 * 60, STUCK = 10 * 60, BAR = 4, BARL = 84, BARY = 250, BARP = 6 * 60, KEYV = 180;
  const PTS = Int8Array.of(2, 20, 50);
  // гвоздики: чётные ряды — 9 (32…288), нечётные — 8 (48…272): у стен шарик не застрянет
  const NPEG = 5 * 9 + 4 * 8, PX = new Float64Array(NPEG), PYS = new Float64Array(NPEG);
  for (let r = 0, n = 0; r < PROWS; r++) {
    const odd = r & 1;
    for (let k = 0; k < (odd ? 8 : 9); k++, n++) { PX[n] = odd ? 48 + 32 * k : 32 + 32 * k; PYS[n] = PY0 + r * PDY; }
  }
  const C = { bg: '#14182b', peg: '#d7dcef', bar: '#ff8a3d', div: '#5a6088', b0: '#2a2f4a', b1: '#1f6f4f', b2: '#8a6a12', t0: '#8d93b8', t1: '#7affb2', t2: '#ffd166',
    ball: '#ffffff', aim: 'rgba(255,255,255,.25)', hold: '#5a6088', hit: 'rgba(122,255,170,.14)', star: '#ffd166' };
  const LBL = ['2', '20', '50'];

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }

  function targets(s){
    s.tg.fill(0);
    const g = rnd(s) % NB;
    s.tg[g] = 2;
    for (let k = 0; k < 2;) { const i = rnd(s) % NB; if (!s.tg[i]) { s.tg[i] = 1; k++; } }
  }

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, score: 0, over: false, why: '', snd: 0,
      ball: 0, fly: 0, aim: W / 2, qx: .5, qy: .5, held: 0, want: 0, idle: 0, age: 0, x: 0, y: 0, x0: 0, y0: 0, vx: 0, vy: 0, bar: W / 2,
      streak: 0, best: 0, gold: 0, green: 0, last: -1, lastB: -1, flash: 0, tg: new Uint8Array(NB) };
    targets(s);
    return s;
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) { s.aim = e.x < 14 ? 14 : e.x > W - 14 ? W - 14 : e.x; s.held = 1; }
    else if (e.type === T.UP) { s.held = 0; s.want = 1; }
    else if (e.type === T.KEY && e.k === 2) s.want = 1;
  }

  // отскок от круга (гвоздик, конец планки или перегородки) радиуса pr в точке (s.qx, s.qy) — дробные через поля состояния:
  // дробное в аргументе вызова «упаковывается» (мусор на каждый гвоздик)
  function bounce(s, pr){
    const px = s.qx, py = s.qy, dx = s.x - px, dy = s.y - py, q = dx * dx + dy * dy, rr = BR + pr;
    if (q >= rr * rr) return;
    const d = Math.sqrt(q) + 1e-9, nx = dx / d, ny = dy / d;
    s.x = px + nx * rr; s.y = py + ny * rr;
    const dot = s.vx * nx + s.vy * ny;
    if (dot < 0) { s.vx -= (1 + REST) * dot * nx; s.vy -= (1 + REST) * dot * ny; }
    // ровно на макушке — шарик застыл бы: лёгкий толчок вбок из rng (одинаковый у соперников при одинаковом броске)
    if (ny < -.985 && s.vx * s.vx < 400) s.vx += rnd(s) % 2 ? 36 : -36;
  }

  function land(s, b){
    const t = s.tg[b];
    let p = PTS[t];
    if (t) { s.streak++; p += 10 * (s.streak - 1); if (t === 2) s.gold++; else s.green++; s.snd = t === 2 ? 'win' : 'ok'; s.flash = 30; }
    else { s.streak = 0; s.snd = 'tick'; }
    s.best = s.streak > s.best ? s.streak : s.best;
    s.score += p; s.last = p; s.lastB = b;
    s.fly = 0; s.idle = 0;
    if (s.ball >= BALLS) { s.over = true; s.why = 'balls'; return; }
    targets(s);
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.t++;
    s.flash = s.flash > 0 ? s.flash - 1 : 0;
    const keys = inp ? inp.keys : 0;
    if (keys & 3) { const a = s.aim + ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYV * dt; s.aim = a < 14 ? 14 : a > W - 14 ? W - 14 : a; }
    // планка-отбойник с 4-го шарика: ездит туда-сюда с постоянной скоростью (время — шаги; без sin — точно на любом движке)
    const ph = s.t % BARP, u = ph < BARP / 2 ? ph / (BARP / 2) : 2 - ph / (BARP / 2);
    s.bar = 64 + u * (W - 128);
    s.x0 = s.x; s.y0 = s.y;
    if (!s.fly) {
      s.idle++;
      // отпустил палец (или пробел); не бросил IDLE шагов — сам; держит палец вечно — сам через 2·IDLE (партия кончается)
      if (s.want || (!s.held && s.idle >= IDLE) || s.idle >= 2 * IDLE) {
        s.fly = 1; s.ball++; s.want = 0; s.age = 0;
        s.x = s.aim; s.y = HOLD; s.x0 = s.x; s.y0 = s.y; s.vx = 0; s.vy = 0; s.snd = 'move';
      }
      return;
    }
    const h = dt / SUB;
    for (let k = 0; k < SUB; k++) {
      s.vy += G0 * h;
      s.vx *= .9995;
      s.x += s.vx * h; s.y += s.vy * h;
      if (s.x < BR) { s.x = BR; s.vx = Math.abs(s.vx) * .6; } else if (s.x > W - BR) { s.x = W - BR; s.vx = -Math.abs(s.vx) * .6; }
      // гвоздики — только ближние ряды
      const r = Math.round((s.y - PY0) / PDY);
      if (r >= -1 && r <= PROWS) {
        for (let n = 0; n < NPEG; n++) { const py = PYS[n]; if (py - s.y > 14 || s.y - py > 14) continue; s.qx = PX[n]; s.qy = py; bounce(s, PR); }
      }
      // планка: отрезок y = BARY, ширина BARL (как круги по концам + плоский верх/низ)
      if (s.ball >= BAR && s.y > BARY - 14 && s.y < BARY + 14) {
        const x1 = s.bar - BARL / 2, x2 = s.bar + BARL / 2;
        if (s.x >= x1 && s.x <= x2) {
          const dy = s.y - BARY;
          if (dy * dy < (BR + 3) * (BR + 3)) {
            const up = dy < 0 ? -1 : 1;
            s.y = BARY + up * (BR + 3);
            if (s.vy * up < 0) s.vy = -s.vy * REST;
            s.vx += (s.x - s.bar) * 1.2;
          }
        } else { s.qx = s.x < x1 ? x1 : x2; s.qy = BARY; bounce(s, 3); }
      }
      // перегородки корзинок: верхний конец — круг, стенка — вертикаль
      if (s.y > DIV - 10) {
        for (let d = 1; d < NB; d++) {
          const dx = s.x - d * BW;
          if (dx > 10 || dx < -10) continue;
          if (s.y < DIV) { s.qx = d * BW; s.qy = DIV; bounce(s, 2); }
          else if (dx * dx < (BR + 2) * (BR + 2)) { s.x = d * BW + (dx < 0 ? -1 : 1) * (BR + 2); s.vx = -s.vx * .4; }
        }
      }
      if (s.y >= LAND) { land(s, Math.min(NB - 1, Math.max(0, (s.x / BW) | 0))); return; }
    }
    if (++s.age >= STUCK) land(s, Math.min(NB - 1, Math.max(0, (s.x / BW) | 0)));
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (s.flash) { ctx.fillStyle = C.hit; ctx.fillRect(0, 0, W, H); }
    // корзинки
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 15px system-ui, sans-serif';
    for (let b = 0; b < NB; b++) {
      const t = s.tg[b];
      ctx.fillStyle = t === 2 ? C.b2 : t === 1 ? C.b1 : C.b0; ctx.fillRect(b * BW + 2, DIV + 6, BW - 4, H - DIV - 8);
      ctx.fillStyle = t === 2 ? C.t2 : t === 1 ? C.t1 : C.t0; ctx.fillText(LBL[t], b * BW + BW / 2, DIV + 28);
      if (t === 2) ctx.fillText('★', b * BW + BW / 2, DIV + 10);
    }
    ctx.fillStyle = C.div;
    for (let d = 1; d < NB; d++) ctx.fillRect(d * BW - 2, DIV, 4, H - DIV);
    // гвоздики одним путём
    ctx.fillStyle = C.peg; ctx.beginPath();
    for (let n = 0; n < NPEG; n++) { ctx.moveTo(PX[n] + PR, PYS[n]); ctx.arc(PX[n], PYS[n], PR, 0, 6.2832); }
    ctx.fill();
    if (s.ball >= BAR || (s.ball === BAR - 1 && s.fly === 0)) { ctx.fillStyle = C.bar; ctx.fillRect(s.bar - BARL / 2, BARY - 3, BARL, 6); }
    // держатель и прицел
    if (!s.fly && !s.over) {
      ctx.fillStyle = C.aim; ctx.fillRect(s.aim - 1, HOLD + 10, 2, PY0 - HOLD - 20);
      ctx.fillStyle = C.hold; ctx.fillRect(s.aim - 14, HOLD - 16, 28, 6);
      ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(s.aim, HOLD, BR, 0, 6.2832); ctx.fill();
    } else if (s.fly) {
      ctx.fillStyle = C.ball; ctx.beginPath(); ctx.arc(s.x0 + (s.x - s.x0) * k, s.y0 + (s.y - s.y0) * k, BR, 0, 6.2832); ctx.fill();
    }
    // оставшиеся шарики — точки в углу
    ctx.fillStyle = C.ball;
    for (let i = s.ball + (s.fly ? 0 : 1); i < BALLS; i++) ctx.fillRect(W - 12 - i * 8, 8, 5, 5);
  }

  ArcadeKit.define('pegs', {
    kind: 'canvas', W, H, drag: true,
    title: '🎯 Шарик в цель',
    intro: 'Веди пальцем над гвоздиками и отпусти — шарик полетит вниз. ⭐ золотая корзинка — 50, зелёные — 20, остальные — 2. Цели меняются перед каждым шариком. Попадания подряд — серия. 10 шариков.',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) и отпусти. Клавиатура: ← → и пробел. Не бросишь 6 с — шарик упадёт сам.',
    duelTitle: 'Одинаковые цели у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, Space: 2, ArrowDown: 2, KeyS: 2 },
    create, input, step, draw,
    hudKey: s => s.ball * 1e4 + s.fly * 1e3 + s.streak * 10 + (s.last >= 0 ? 1 : 0),
    hud: s => 'шарик ' + Math.min(BALLS, s.ball + (s.fly ? 0 : 1)) + '/' + BALLS + (s.streak > 1 ? ' · серия ' + s.streak : '') + (s.last >= 0 && !s.fly ? ' · было +' + s.last : ''),
    win: s => s.gold >= 2 || s.score >= 200,
    result: s => ({
      title: s.gold >= 4 ? '🏆 Снайпер!' : s.gold + s.green >= 5 ? '🎯 Меткий бросок!' : '🎯 Шарики кончились',
      text: '⭐ ' + s.gold + ' · зелёных: ' + s.green + ' · лучшая серия: ' + s.best,
    }),
    consts: { W, H, BR, PR, PY0, PDY, PROWS, NB, BW, DIV, LAND, HOLD, G0, SUB, BALLS, IDLE, STUCK, BAR, BARL, BARY, NPEG },
  });
})();

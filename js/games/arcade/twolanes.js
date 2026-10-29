// ═══════════════════════════════════════
//  ИГРА «ДВОЙНАЯ ТРАССА» (T-140) — две машинки на ночном шоссе, у каждой две полосы: тап слева — левая перестраивается, справа — правая.
//  Собирай батарейки, объезжай барьеры. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорости — единиц в секунду.
// Своё: машинки электрические — заряд тает (≈ 16 с с полного), батарейка 🔋 +1 очко и подзаряд, ⭐ звезда +3; пропуск батарейки
// не конец игры, конец — барьер или пустой заряд; трасса — 2 минуты.
// Исправлено против прототипа: (1) движение, появление предметов (по счётчику кадров) и плавный перестрой (×0,3 за кадр) — за кадр →
// в секунду (на 144 Гц прототип ехал в 2,4 раза быстрее); (2) столкновение считалось по номеру полосы, а машина ещё ехала к ней
// на рисунке — теперь по прямоугольникам машины и предмета, как нарисовано; (3) Math.random → rng (у соперников одна трасса);
// (4) предметы одной машины могли идти так тесно, что объехать барьер и успеть к следующему нельзя — расстояние ≥ длина машины +
// предмет + путь перестроения (растёт со скоростью); (5) скорость росла со счётом без предела — растёт со временем, предел 420;
// (6) тап после аварии сразу начинал заново — итог ядра; (7) массив предметов с filter/forEach и замыканиями каждый кадр — пул на
// 32 места в типизированных массивах; (8) не было клавиш — ← / → (и F / J).
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, LW = 80, CARY = 362, CW = 28, CH = 46, OS = 12;       // ширина полосы; машина: верх, ширина, длина; полуразмер предмета
  const V0 = 220, DV = 1.6, VMAX = 420, LANE_V = 600, LIMIT = 120;              // скорость: старт, + в секунду, предел; перестроение; 2 минуты
  const DRAIN = .06, CHARGE = .3, DMIN0 = 90, DMINK = .3, DSPAN = 160, NP = 32; // заряд в секунду; батарейка; расстояние между предметами одной машины
  const BAT = 0, BAR = 1, STAR = 2;
  const C = { bg: '#11131f', lane: 'rgba(255,255,255,.12)', mid: 'rgba(255,209,102,.5)', carA: '#ff922b', carB: '#22b8cf', glass: '#1b2033', lamp: '#fff3bf',
    bat: '#40c057', batT: '#d3f9d8', bar: '#ff4d6d', barS: '#f8f9fa', star: '#ffd166', gauge: 'rgba(255,255,255,.15)', low: '#ff4d6d', bad: '#ff4d6d' };
  const STX = new Float32Array(10), STY = new Float32Array(10);                // звезда: 10 вершин
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = -Math.PI / 2 + i * Math.PI / 5; STX[i] = Math.cos(a) * r; STY[i] = Math.sin(a) * r; }
  const laneX = l => l * LW + LW / 2;

  function create(rng){
    const s = { rng, lane: new Uint8Array(2), cx: new Float64Array(2), pcx: new Float64Array(2), en: new Float64Array(2), next: new Float64Array(2), streak: new Uint8Array(2),
      oy: new Float64Array(NP), poy: new Float64Array(NP), ol: new Uint8Array(NP), ot: new Uint8Array(NP), on: new Uint8Array(NP),
      v: V0, started: false, t: 0, dist: 0, score: 0, bats: 0, stars: 0, spawned: 0, over: false, why: '', who: 0, snd: 0, seq: new Float32Array(8) };
    s.lane[0] = 0; s.lane[1] = 3; s.cx[0] = s.pcx[0] = laneX(0); s.cx[1] = s.pcx[1] = laneX(3); s.en[0] = s.en[1] = 1;
    s.next[0] = 40; s.next[1] = 40 + (DMIN0 + DMINK * V0) / 2;
    for (let i = 0; i < 8; i++) s.seq[i] = rng();          // для ⚔️ сравнения полей: первые числа rng одинаковы у соперников
    return s;
  }

  function spawn(s, c){
    let i = 0;
    while (i < NP && s.on[i]) i++;
    if (i === NP) return;
    const r = s.rng(), t = s.streak[c] >= 2 ? BAT : r < .1 ? STAR : r < .55 ? BAT : BAR;
    s.streak[c] = t === BAR ? s.streak[c] + 1 : 0;
    s.on[i] = 1; s.ot[i] = t; s.ol[i] = c * 2 + (s.rng() < .5 ? 0 : 1); s.oy[i] = s.poy[i] = -OS - 4 - s.next[c]; s.spawned++;   // −next: точное место (шаг мог «перескочить» отметку)
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    if (!s.started) { s.started = true; s.snd = 'move'; return; }   // первый тап — только старт
    const c = e.type === T.KEY ? e.k : e.x < W / 2 ? 0 : 1;
    s.lane[c] = s.lane[c] === c * 2 ? c * 2 + 1 : c * 2;
    s.snd = c ? 523 : 392;
  }

  function step(s, dt){
    s.pcx[0] = s.cx[0]; s.pcx[1] = s.cx[1];
    for (let i = 0; i < NP; i++) s.poy[i] = s.oy[i];
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'finish'; s.snd = 'win'; return; }
    s.v = Math.min(VMAX, V0 + DV * s.t);
    const d = s.v * dt;
    s.dist += d;
    for (let c = 0; c < 2; c++) {
      // машина едет к своей полосе с постоянной скоростью
      const tx = laneX(s.lane[c]), m = LANE_V * dt, x = s.cx[c];
      s.cx[c] = x < tx - m ? x + m : x > tx + m ? x - m : tx;
      s.en[c] -= DRAIN * dt;
      if (s.en[c] <= 0) { s.en[c] = 0; s.over = true; s.why = 'empty'; s.who = c; s.snd = 'bad'; return; }
    }
    for (let i = 0; i < NP; i++) {
      if (!s.on[i]) continue;
      const y = s.oy[i] += d;
      if (y - OS > H) { s.on[i] = 0; continue; }
      const c = s.ol[i] >> 1, ox = laneX(s.ol[i]);
      if (y + OS < CARY || y - OS > CARY + CH || ox + OS < s.cx[c] - CW / 2 || ox - OS > s.cx[c] + CW / 2) continue;
      if (s.ot[i] === BAR) { s.over = true; s.why = 'crash'; s.who = c; s.snd = 'bad'; return; }
      s.on[i] = 0;
      if (s.ot[i] === STAR) { s.score += 3; s.stars++; s.snd = 1175; } else { s.score += 1; s.bats++; s.snd = 880; }
      s.en[c] = Math.min(1, s.en[c] + CHARGE);
    }
    // новые предметы — после движения: место точно по пройденному пути (−next), без лишнего сдвига в этом шаге
    for (let c = 0; c < 2; c++) {
      s.next[c] -= d;
      if (s.next[c] <= 0) { spawn(s, c); s.next[c] += DMIN0 + DMINK * s.v + s.rng() * DSPAN; }
    }
  }

  function car(ctx, x, col){
    ctx.fillStyle = col; ctx.fillRect(x - CW / 2, CARY, CW, CH);
    ctx.fillStyle = C.glass; ctx.fillRect(x - CW / 2 + 4, CARY + 8, CW - 8, 10); ctx.fillRect(x - CW / 2 + 4, CARY + 30, CW - 8, 7);
    ctx.fillStyle = C.lamp; ctx.fillRect(x - CW / 2 + 2, CARY, 6, 3); ctx.fillRect(x + CW / 2 - 8, CARY, 6, 3);
  }

  function draw(G, s, al){
    const ctx = G.ctx, run = !s.over;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // разметка: пунктир едет вместе с дорогой, посередине — жёлтая двойная
    ctx.fillStyle = C.lane;
    const off = s.dist % 40;
    for (let y = off - 40; y < H; y += 40) { ctx.fillRect(LW - 1, y, 2, 22); ctx.fillRect(3 * LW - 1, y, 2, 22); }
    ctx.fillStyle = C.mid; ctx.fillRect(W / 2 - 4, 0, 2, H); ctx.fillRect(W / 2 + 2, 0, 2, H);
    // предметы
    for (let i = 0; i < NP; i++) {
      if (!s.on[i]) continue;
      const y = run ? s.poy[i] + (s.oy[i] - s.poy[i]) * al : s.oy[i], x = laneX(s.ol[i]), t = s.ot[i];
      if (t === BAT) {
        ctx.fillStyle = C.bat; ctx.fillRect(x - 9, y - OS, 18, OS * 2); ctx.fillRect(x - 4, y - OS - 4, 8, 4);
        ctx.fillStyle = C.batT; ctx.fillRect(x - 5, y - 1, 10, 3); ctx.fillRect(x - 1, y - 5, 3, 10);
      } else if (t === BAR) {
        ctx.fillStyle = C.bar; ctx.fillRect(x - OS - 4, y - OS, OS * 2 + 8, OS * 2);
        ctx.fillStyle = C.barS; ctx.fillRect(x - 10, y - OS, 6, OS * 2); ctx.fillRect(x + 4, y - OS, 6, OS * 2);
      } else {
        ctx.fillStyle = C.star; ctx.beginPath(); ctx.moveTo(x + STX[0], y + STY[0]);
        for (let k = 1; k < 10; k++) ctx.lineTo(x + STX[k], y + STY[k]);
        ctx.closePath(); ctx.fill();
      }
    }
    // машинки
    for (let c = 0; c < 2; c++) {
      const x = run ? s.pcx[c] + (s.cx[c] - s.pcx[c]) * al : s.cx[c];
      car(ctx, x, s.over && s.who === c && s.why !== 'finish' ? C.bad : c ? C.carB : C.carA);
    }
    // заряд: тонкие полоски под машинами
    for (let c = 0; c < 2; c++) {
      const x0 = c * W / 2 + 14, w = W / 2 - 28, e = s.en[c];
      ctx.fillStyle = C.gauge; ctx.fillRect(x0, H - 9, w, 4);
      ctx.fillStyle = e < .25 ? C.low : C.bat; ctx.fillRect(x0, H - 9, w * e, 4);
    }
  }

  ArcadeKit.define('twolanes', {
    kind: 'canvas', W, H,
    title: '🚗 Двойная трасса',
    intro: 'Две машинки, у каждой две полосы. Тап слева — перестроить левую, справа — правую. 🔋 батарейки заряжают (+1), ⭐ — +3, барьер — авария. Заряд тает — не пропускай батарейки! Трасса — 2 минуты.',
    controls: 'Тап по левой / правой половине поля, ← / → или F / J.',
    duelTitle: 'Одинаковая трасса у обоих',
    keys: { ArrowLeft: 0, KeyF: 0, KeyA: 0, ArrowRight: 1, KeyJ: 1, KeyL: 1 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с' : 'Тап — старт'),
    win: s => s.score >= 40,
    result: s => ({
      title: s.why === 'finish' ? '🏁 Финиш! Вся трасса' : s.why === 'empty' ? (s.who ? '🪫 Правая машинка без заряда' : '🪫 Левая машинка без заряда')
        : s.who ? '💥 Правая машинка в барьер' : '💥 Левая машинка в барьер',
      text: '🔋 ' + s.bats + (s.stars ? ' · ⭐ ' + s.stars : '') + ' · проехал ' + Math.floor(s.t) + ' с',
    }),
    consts: { W, H, LW, CARY, CW, CH, OS, V0, DV, VMAX, LANE_V, LIMIT, DRAIN, CHARGE, DMIN0, DMINK, DSPAN, NP },
  });
})();

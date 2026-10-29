// ═══════════════════════════════════════
//  ИГРА «РОГАТКА» (T-140) — оттяни камешек и сбей жестяные банки с ящиков. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, тяжесть — единиц поля в секунду², 3 подшага.
// Тир во дворе: банки стоят столбиками на ящиках и на земле. Сбитая банка падает и может сбить соседние (домино).
// Очки: банка — 10, ⭐ золотая — 30, третья и дальше банка за один выстрел — ещё +5; все банки сбиты — +50 и новый тир
// (+2 камешка, не больше 6). Партия — пока есть камешки, но не больше 2 минут.
// Своё: банки и ящики (а не птицы и свинки), домино из падающих банок, ⭐ золотая банка, бонус за серию в одном выстреле;
// оттянуть можно с любого места поля (камешек сам встаёт в рогатку), прицел показывает только начало пути.
// Исправлено против прототипа: (1) полёт «за кадр» — на 144 Гц камешек летел в 2,4 раза быстрее; теперь шаг 60 Гц,
// 3 подшага, скорости в секунду; (2) оттянуть можно было только в 60 px от рогатки — на телефоне палец закрывает её; теперь
// с любого места; (3) pointerleave выпускал камешек у края холста — теперь захват указателя ядра; (4) «свинки» висели в
// воздухе без опоры — теперь банки на ящиках и падают; (5) pg.filter и объекты каждый кадр (мусор) — теперь массивы;
// (6) Math.random — rng (у соперников одинаковые тиры); (7) после конца тап сразу начинал заново; (8) не было конца по
// времени — общие 2 минуты для соревнования; (9) полная траектория-подсказка делала прицел лишним — теперь только начало.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, GY = 400, AX = 62, AY = 316, PULL = 80, KS = 7.8, SR = 7, CW = 16, CH = 22, CR = 10, BOX = 30, BW2 = 18;
  const G0 = 900, SUB = 3, NC = 12, NP = 3, STONES = 6, TIME = 120 * 60, FLY = 5 * 60, NEXT = 50, KEYA = 1.2, KEYP = 60;
  const SLOTS = Int16Array.of(160, 208, 256, 300);
  const C = { sky: '#152038', sky2: '#1c2b4a', ground: '#2e6b3f', groundD: '#24552f', box: '#9a6a3a', boxD: '#6f4a26', can: '#c9d1e3', canD: '#8792ab', canB: '#e05656',
    gold: '#ffd166', goldD: '#c99a2e', fork: '#7a5532', band: '#ff8a3d', stone: '#b9b2a6', aim: 'rgba(255,255,255,.55)', fade: 'rgba(201,209,227,.35)', flash: 'rgba(122,255,170,.12)' };

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, over: false, why: '', snd: 0,
      stage: 0, stones: STONES, shots: 0, cans: 0, golds: 0, clears: 0, best: 0, hitN: 0, next: 0, flash: 0,
      pull: 0, px: AX, py: AY, ox: .5, oy: .5, ka: .62, kp: .75, kx: 0, kvx: 0, kvy: 0,
      fly: 0, ft: 0, sx: AX, sy: AY, sx0: AX, sy0: AY, vx: 0, vy: 0,
      pX: new Float64Array(NP), pY: new Float64Array(NP), pn: 0,
      cx: new Float64Array(NC), cy: new Float64Array(NC), cx0: new Float64Array(NC), cy0: new Float64Array(NC), cvx: new Float64Array(NC), cvy: new Float64Array(NC),
      rot: new Float64Array(NC), st: new Uint8Array(NC), gold: new Uint8Array(NC), plat: new Int8Array(NC), lvl: new Uint8Array(NC), rest: new Uint8Array(NC) };
    stage(s);
    return s;
  }

  // новый тир: 2–3 места из 4, на каждом — ящики высотой 0–3 и столбик из 1–3 банок; одна банка — золотая
  function stage(s){
    s.stage++; s.st.fill(0); s.gold.fill(0); s.pn = 0;
    const k = s.stage >= 3 ? 3 : 2, used = rnd(s) % 4;
    let n = 0;
    for (let p = 0; p < k; p++) {
      const slot = (used + (p === 1 ? 2 : p === 2 ? 1 : 0)) % 4;   // 2 места через одно, третье — между ними (все разные)
      const h = rnd(s) % 4, x = SLOTS[slot], top = GY - h * BOX;
      s.pX[p] = x; s.pY[p] = top; s.pn++;
      const m = 1 + rnd(s) % 3;
      for (let j = 0; j < m && n < NC; j++, n++) {
        s.st[n] = 1; s.plat[n] = p; s.lvl[n] = j; s.rest[n] = 0; s.rot[n] = 0;
        s.cx[n] = x; s.cy[n] = top - CH / 2 - j * CH; s.cx0[n] = s.cx[n]; s.cy0[n] = s.cy[n]; s.cvx[n] = 0; s.cvy[n] = 0;
      }
    }
    s.gold[rnd(s) % n] = 1;
    s.next = 0;
  }

  function aimKeys(s){
    s.px = AX - Math.cos(s.ka) * PULL * s.kp; s.py = AY + Math.sin(s.ka) * PULL * s.kp;
  }

  function pullTo(s, x, y){
    let dx = x - AX, dy = y - AY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > PULL) { dx *= PULL / d; dy *= PULL / d; }
    s.px = AX + dx; s.py = AY + dy;
  }

  function fire(s){
    const dx = AX - s.px, dy = AY - s.py;
    s.pull = 0;
    if (dx * dx + dy * dy < 144 || s.fly || s.stones <= 0 || s.next) { s.px = AX; s.py = AY; return; }
    s.fly = 1; s.ft = 0; s.stones--; s.shots++; s.hitN = 0;
    s.sx = s.px; s.sy = s.py; s.sx0 = s.sx; s.sy0 = s.sy; s.vx = dx * KS; s.vy = dy * KS;
    s.px = AX; s.py = AY; s.snd = 'move';
  }

  function input(s, e){
    if (s.over) return;
    // тянуть можно с любого места: камешек смещается от рогатки так же, как палец от точки касания
    if (e.type === T.DOWN) { if (s.fly || s.stones <= 0 || s.next) return; s.pull = 1; s.ox = e.x; s.oy = e.y; s.px = AX; s.py = AY; }
    else if (e.type === T.MOVE && s.pull === 1) pullTo(s, AX + e.x - s.ox, AY + e.y - s.oy);
    else if (e.type === T.UP && s.pull === 1) { pullTo(s, AX + e.x - s.ox, AY + e.y - s.oy); fire(s); }
    else if (e.type === T.KEY && e.k === 4) { if (!s.fly && s.stones > 0) { aimKeys(s); fire(s); } }
  }

  // банка i падает со скоростью (s.kvx, s.kvy) — дробные через поля состояния (без «упаковки» в аргументах)
  function knock(s, i){
    if (s.st[i] !== 1) return;
    s.st[i] = 2; s.cvx[i] = s.kvx; s.cvy[i] = s.kvy; s.rest[i] = 0;
    s.hitN++; s.cans++;
    const p = s.gold[i] ? 30 : 10, extra = s.hitN >= 3 ? 5 : 0;
    s.score += p + extra; if (s.gold[i]) s.golds++;
    s.best = s.hitN > s.best ? s.hitN : s.best;
    s.snd = s.gold[i] ? 1047 : 659 + (s.hitN > 4 ? 4 : s.hitN) * 66;
    // банки выше в том же столбике теряют опору
    for (let j = 0; j < NC; j++) {
      if (s.st[j] !== 1 || s.plat[j] !== s.plat[i] || s.lvl[j] <= s.lvl[i]) continue;
      s.kvx = ((j * 29 + s.shots * 7) % 61) - 30 + s.cvx[i] * .3; s.kvy = -20;
      knock(s, j);
    }
  }

  // камешек против ящиков места p: выталкивание по оси наименьшего проникновения (без ветвей «камешек/банка» внутри —
  // две простые функции оптимизируются лучше и не дают мусора)
  function boxStone(s, p){
    const top = s.pY[p], x = s.sx, y = s.sy, x1 = s.pX[p] - BW2, x2 = s.pX[p] + BW2;
    if (top >= GY || x < x1 - SR || x > x2 + SR || y < top - SR || y > GY) return;
    const qx = x < x1 ? x1 : x > x2 ? x2 : x, qy = y < top ? top : y, dx = x - qx, dy = y - qy;
    if (dx * dx + dy * dy >= SR * SR && !(x > x1 && x < x2 && y > top)) return;
    const ax = x + SR - x1, bx = x2 - (x - SR), ox = ax < bx ? ax : bx, oy = y + SR - top;
    if (ox < oy) { s.sx = x < s.pX[p] ? x1 - SR : x2 + SR; s.vx = -s.vx * .45; }
    else { s.sy = top - SR; s.vy = -Math.abs(s.vy) * .35; s.vx *= .7; }
  }
  // банка i против ящиков места p
  function boxCan(s, p, i){
    const top = s.pY[p], x = s.cx[i], y = s.cy[i], x1 = s.pX[p] - BW2, x2 = s.pX[p] + BW2;
    if (top >= GY || x < x1 - CR || x > x2 + CR || y < top - CR || y > GY) return;
    const qx = x < x1 ? x1 : x > x2 ? x2 : x, qy = y < top ? top : y, dx = x - qx, dy = y - qy;
    if (dx * dx + dy * dy >= CR * CR && !(x > x1 && x < x2 && y > top)) return;
    const ax = x + CR - x1, bx = x2 - (x - CR), ox = ax < bx ? ax : bx, oy = y + CR - top;
    if (ox < oy) { s.cx[i] = x < s.pX[p] ? x1 - CR : x2 + CR; s.cvx[i] = -s.cvx[i] * .4; }
    else { s.cy[i] = top - CR; s.cvy[i] = -Math.abs(s.cvy[i]) * .3; s.cvx[i] *= .8; }
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.t++;
    s.left = TIME - s.t;
    s.flash = s.flash > 0 ? s.flash - 1 : 0;
    // клавиатура: ← → угол, ↑ ↓ сила (прицел на рогатке)
    const keys = inp ? inp.keys : 0;
    if (keys & 15) {
      s.ka += ((keys & 1 ? 1 : 0) - (keys & 2 ? 1 : 0)) * KEYA * dt; s.ka = s.ka < .05 ? .05 : s.ka > 1.45 ? 1.45 : s.ka;
      s.kp += ((keys & 4 ? 1 : 0) - (keys & 8 ? 1 : 0)) * KEYP / 100 * dt; s.kp = s.kp < .2 ? .2 : s.kp > 1 ? 1 : s.kp;
      if (!s.fly && s.stones > 0) { aimKeys(s); s.pull = 2; }
    } else if (s.pull === 2) s.pull = 3;   // клавиши отпущены — прицел остаётся видимым до пробела
    const h = dt / SUB;
    // камешек
    s.sx0 = s.sx; s.sy0 = s.sy;
    if (s.fly) {
      s.ft++;
      for (let k = 0; k < SUB && s.fly; k++) {
        s.vy += G0 * h; s.sx += s.vx * h; s.sy += s.vy * h;
        for (let p = 0; p < s.pn; p++) boxStone(s, p);
        if (s.sy > GY - SR) { s.sy = GY - SR; s.vy = -Math.abs(s.vy) * .35; s.vx *= .6; }
        for (let i = 0; i < NC; i++) {
          if (s.st[i] !== 1) continue;
          const dx = s.cx[i] - s.sx, dy = s.cy[i] - s.sy;
          if (dx * dx + dy * dy >= (CR + SR) * (CR + SR)) continue;
          s.kvx = s.vx * .6; s.kvy = s.vy * .4 - 120;
          knock(s, i);
          s.vx *= .7; s.vy *= .7;
        }
      }
      const slow = s.sy >= GY - SR - .5 && s.vx * s.vx + s.vy * s.vy < 1600;
      if (s.sx > W + 30 || s.sx < -30 || slow || s.ft >= FLY) s.fly = 0;
    }
    // падающие банки: тяжесть, ящики, земля, домино
    let moving = 0, standing = 0;
    for (let i = 0; i < NC; i++) {
      s.cx0[i] = s.cx[i]; s.cy0[i] = s.cy[i];
      const st = s.st[i];
      if (st === 1) { standing++; continue; }
      if (st !== 2) continue;
      moving++;
      s.cvy[i] += G0 * dt; s.cx[i] += s.cvx[i] * dt; s.cy[i] += s.cvy[i] * dt; s.rot[i] += s.cvx[i] * dt * .05;
      for (let p = 0; p < s.pn; p++) boxCan(s, p, i);
      if (s.cy[i] > GY - CR) { s.cy[i] = GY - CR; s.cvy[i] = -Math.abs(s.cvy[i]) * .3; s.cvx[i] *= .85; }
      for (let j = 0; j < NC; j++) {
        if (s.st[j] !== 1) continue;
        const dx = s.cx[j] - s.cx[i], dy = s.cy[j] - s.cy[i];
        if (dx * dx + dy * dy >= 4 * CR * CR) continue;
        s.kvx = s.cvx[i] * .7 + (dx < 0 ? -40 : 40); s.kvy = -60;
        knock(s, j);
      }
      const still = s.cvx[i] * s.cvx[i] + s.cvy[i] * s.cvy[i] < 900;
      s.rest[i] = still ? s.rest[i] + 1 : 0;
      if (s.rest[i] > 30 || s.cx[i] < -30 || s.cx[i] > W + 30) s.st[i] = 3;
    }
    // все банки сбиты и упали — +50, новый тир, +2 камешка
    // (пока идёт смена тира — s.next > 0 — стрелять нельзя: иначе тир не сменится)
    if (s.next) { if (++s.next >= NEXT) stage(s); }
    else if (!standing && !moving && !s.fly) { s.next = 1; s.score += 50; s.clears++; s.snd = 'win'; s.flash = 40; s.stones = Math.min(STONES, s.stones + 2); }
    else if (!s.fly && !moving && s.stones <= 0) { s.over = true; s.why = 'stones'; s.snd = s.clears ? 'win' : 'bad'; return; }
    if (s.left <= 0) { s.over = true; s.why = 'time'; s.snd = 'win'; }
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.sky2; ctx.fillRect(0, GY - 120, W, 120);
    if (s.flash) { ctx.fillStyle = C.flash; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = C.ground; ctx.fillRect(0, GY, W, H - GY);
    ctx.fillStyle = C.groundD; ctx.fillRect(0, GY, W, 4);
    // ящики
    for (let p = 0; p < s.pn; p++) {
      const top = s.pY[p], x = s.pX[p] - BW2;
      for (let y = top; y < GY; y += BOX) {
        ctx.fillStyle = C.box; ctx.fillRect(x, y, BW2 * 2, BOX - 1);
        ctx.fillStyle = C.boxD; ctx.fillRect(x + 3, y + 3, BW2 * 2 - 6, 3); ctx.fillRect(x + 3, y + BOX - 7, BW2 * 2 - 6, 3); ctx.fillRect(x + 3, y + 3, 3, BOX - 7);
      }
    }
    // банки: стоящие — ровно, падающие — с наклоном
    for (let i = 0; i < NC; i++) {
      const st = s.st[i];
      if (!st) continue;
      const x = s.cx0[i] + (s.cx[i] - s.cx0[i]) * k, y = s.cy0[i] + (s.cy[i] - s.cy0[i]) * k;
      if (st === 3) { ctx.fillStyle = C.fade; ctx.fillRect(x - CH / 2, y + 2, CH, CW - 6); continue; }
      ctx.save(); ctx.translate(x, y); if (st === 2) ctx.rotate(s.rot[i]);
      ctx.fillStyle = s.gold[i] ? C.gold : C.can; ctx.fillRect(-CW / 2, -CH / 2, CW, CH);
      ctx.fillStyle = s.gold[i] ? C.goldD : C.canD; ctx.fillRect(-CW / 2, -CH / 2, CW, 3); ctx.fillRect(-CW / 2, CH / 2 - 3, CW, 3);
      ctx.fillStyle = s.gold[i] ? C.goldD : C.canB; ctx.fillRect(-CW / 2, -4, CW, 8);
      ctx.restore();
    }
    // рогатка, резинка, камешек
    ctx.fillStyle = C.fork; ctx.fillRect(AX - 3, AY + 4, 6, GY - AY - 4); ctx.fillRect(AX - 12, AY - 10, 4, 18); ctx.fillRect(AX + 8, AY - 10, 4, 18); ctx.fillRect(AX - 12, AY + 4, 24, 4);
    const aiming = !s.fly && s.stones > 0 && !s.over;
    if (aiming) {
      ctx.strokeStyle = C.band; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(AX - 10, AY - 8); ctx.lineTo(s.px, s.py); ctx.lineTo(AX + 10, AY - 8); ctx.stroke();
      if (s.pull) {
        // прицел — только начало пути (0,4 с)
        let x = s.px, y = s.py, vx = (AX - s.px) * KS, vy = (AY - s.py) * KS;
        ctx.fillStyle = C.aim;
        for (let n = 0; n < 12; n++) { vy += G0 / 30; x += vx / 30; y += vy / 30; if (n & 1) ctx.fillRect(x - 2, y - 2, 4, 4); }
      }
      ctx.fillStyle = C.stone; ctx.beginPath(); ctx.arc(s.px, s.py, SR, 0, 6.2832); ctx.fill();
    } else if (s.fly) {
      ctx.fillStyle = C.stone; ctx.beginPath(); ctx.arc(s.sx0 + (s.sx - s.sx0) * k, s.sy0 + (s.sy - s.sy0) * k, SR, 0, 6.2832); ctx.fill();
    }
    // запас камешков — у основания рогатки
    ctx.fillStyle = C.stone;
    for (let i = 0; i < s.stones - (aiming ? 1 : 0); i++) ctx.fillRect(8 + i * 10, GY + 14, 7, 7);
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('sling', {
    kind: 'canvas', W, H, drag: true,
    title: '🥫 Рогатка',
    intro: 'Коснись поля в любом месте, тяни палец назад и отпусти — камешек полетит в обратную сторону. Сбей жестяные банки с ящиков. Банка — 10, ⭐ золотая — 30. Сбил все — +50 и ещё 2 камешка. 2 минуты.',
    controls: 'Тяни пальцем (или мышью с зажатой кнопкой) в любом месте поля — назад и вниз — и отпусти. Клавиатура: ← → угол, ↑ ↓ сила, пробел — выстрел.',
    duelTitle: 'Одинаковые банки у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, ArrowUp: 2, KeyW: 2, ArrowDown: 3, KeyS: 3, Space: 4 },
    create, input, step, draw,
    hudKey: s => s.stones * 1e6 + s.stage * 1e3 + Math.ceil(s.left / 60),
    hud: s => 'камешков: ' + s.stones + ' · тир ' + s.stage + ' · ⏱ ' + clock(s.left),
    win: s => s.clears >= 2,
    result: s => ({
      title: s.clears >= 4 ? '🏆 Меткий стрелок!' : s.clears ? '🥫 Банки повержены!' : s.why === 'time' ? '⏰ Время вышло' : '🪨 Камешки кончились',
      text: 'сбито банок: ' + s.cans + ' · тиров: ' + s.clears + (s.golds ? ' · ⭐ ' + s.golds : '') + ' · лучший выстрел: ' + s.best,
    }),
    consts: { W, H, GY, AX, AY, PULL, KS, SR, CW, CH, CR, BOX, G0, SUB, NC, STONES, TIME, FLY, NEXT },
  });
})();

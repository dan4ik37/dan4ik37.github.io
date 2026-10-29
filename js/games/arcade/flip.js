// ═══════════════════════════════════════
//  ИГРА «БУТЫЛКА» (T-140) — подбрось бутылку с водой так, чтобы она встала на табурет. 10 бросков. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440: слева стол, справа табурет (у каждого броска свой —
// выше, ниже, уже, шире; rng). Зажми — сила качается туда-обратно, отпусти — бросок. Бутылка сама летит к табурету,
// а сила решает высоту и время полёта, значит, и сколько оборотов она успеет сделать (1 оборот — 0,8 с).
// Своё: «на крышку!» (встала вверх дном) — 25; два оборота и больше — ×2; серия удачных бросков +2, +4, +6…
// Очки: встала +10, идеально (почти ровно) +15, на крышку +25; ×2 за 2+ оборота; серия +2 × (n − 1).
// Исправлено против прототипа: движение и вращение за КАДР (vy += .35, a += .18 — на 144 Гц бутылка летела в 2,4 раза
// быстрее) → время полёта и угол считаются формулой от времени (шаги по 1/60 с), приземление — точно в момент касания;
// сила тоже качается в секунду; вращение не зависело от силы и цели не было — теперь табурет на разной высоте;
// pointerleave бросал бутылку при выходе пальца за холст → только отпускание; серия без конца → 10 бросков; надпись
// поверх поля на каждом кадре — только итог броска.
(() => {
  const T = ArcadeKit.T, TAU = Math.PI * 2;
  const W = 320, H = 440, FLOOR = 420, Y0 = 336, X0 = 58, BH = 56, BW = 22;   // поле, пол, верх стола, бутылка
  const G = 1500, V0 = 150, V1 = 1250, SPIN = TAU / .8, SWEEP = 1.1;          // px/с², скорость броска px/с, вращение рад/с, качание силы с
  const THROWS = 10, SHOW = 70, IDLE = 8 * 60, HOLD = 5 * 60, TIP = 15;        // шагов
  const PERFECT = .3, STAND = .65, CAPTOL = .3;                                // допуск угла, рад
  const R_NONE = 0, R_PERF = 1, R_STAND = 2, R_CAP = 3, R_FALL = 4, R_MISS = 5;
  const C = { wall: '#2a2340', wall2: '#231d37', floor: '#5a3b26', floor2: '#4a301f', wood: '#a8713f', woodD: '#7d5230', stool: '#e2a14a', stoolD: '#b47a2c',
    glass: 'rgba(170,220,255,.55)', water: '#3aa0ff', cap: '#ff4d6d', label: '#ffd60a', bar: 'rgba(255,255,255,.14)', pow: '#ffc233', ink: '#fff', good: '#35e0a0', bad: '#ff6b81', mute: '#b8b0d6' };
  const RTXT = ['', 'Идеально!', 'Встала!', 'На крышку!', 'Упала', 'Мимо табурета'];

  function create(rng){
    const s = { rng, i: 0, phase: 0, p: 0, dir: 1, idle: 0, hold: 0, v: 0, T: 0, reach: false, ft: 0, xl: 0, yl: 0, A: 0, e: 0,
      x: X0, y: Y0 - BH / 2, a: 0, d: 0, px: X0, py: Y0 - BH / 2, pa: 0, res: R_NONE, st: 0, gain: 0, mult: 1, streak: 0, best: 0, good: 0,
      score: 0, over: false, snd: 0,
      tx: new Int16Array(THROWS), ty: new Int16Array(THROWS), tw: new Int16Array(THROWS) };
    // табуреты заранее (у соперников одинаковые): центр 200…259, ширина 56…84, верх 225…344 (выше и ниже стола)
    for (let k = 0; k < THROWS; k++) { s.tx[k] = 200 + Math.floor(rng() * 60); s.tw[k] = 56 + Math.floor(rng() * 29); s.ty[k] = 225 + Math.floor(rng() * 120); }
    return s;
  }

  function charge(s){ if (s.phase === 0) { s.phase = 1; s.p = 0; s.dir = 1; s.hold = 0; s.snd = 0; } }

  // бросок: время полёта до верха табурета — из формулы (не накапливается по шагам); не долетает — падает на пол перед ним
  function release(s){
    if (s.phase !== 1) return;
    const i = s.i, v = V0 + V1 * s.p, dh = Y0 - s.ty[i], d = v * v - 2 * G * dh;
    s.v = v; s.phase = 2; s.ft = 0;
    s.reach = d >= 0;
    if (s.reach) { s.T = (v + Math.sqrt(d)) / G; s.xl = s.tx[i]; s.yl = s.ty[i]; }
    else { s.T = (v + Math.sqrt(v * v + 2 * G * (FLOOR - Y0))) / G; s.xl = s.tx[i] - s.tw[i] / 2 - 18; s.yl = FLOOR; }
    s.snd = 440;
  }

  function land(s){
    const A = SPIN * s.T;
    let e = A % TAU;
    if (e > Math.PI) e -= TAU;
    const ae = e < 0 ? -e : e;
    s.A = A; s.e = e; s.st = 0;
    s.res = !s.reach ? R_MISS : ae <= PERFECT ? R_PERF : ae <= STAND ? R_STAND : Math.PI - ae <= CAPTOL ? R_CAP : R_FALL;
    if (s.res <= R_CAP) {
      s.mult = A >= 1.75 * TAU ? 2 : 1;
      s.streak++; if (s.streak > s.best) s.best = s.streak;
      s.gain = (s.res === R_PERF ? 15 : s.res === R_STAND ? 10 : 25) * s.mult + 2 * (s.streak - 1);
      s.score += s.gain; s.good++;
      s.d = s.res === R_CAP ? (e > 0 ? e - Math.PI : e + Math.PI) : e;   // докрутить до ровного: на дно (2πn) или на крышку (π + 2πn)
      s.snd = s.res === R_STAND ? 'ok' : 'win';
    } else { s.streak = 0; s.gain = 0; s.mult = 1; s.snd = 'bad'; }
  }

  function input(s, e){
    if (s.over) return;
    const t = e.type;
    if (t === T.DOWN || (t === T.KEY && e.k === 0)) charge(s);
    else if (t === T.UP || (t === T.KEYUP && e.k === 0)) release(s);
  }

  function step(s, dt){
    if (s.over) return;
    s.px = s.x; s.py = s.y; s.pa = s.a;
    if (s.phase === 0) { if (++s.idle >= IDLE) { charge(s); release(s); } return; }   // 8 с без броска — бросок сам (слабый)
    if (s.phase === 1) {
      s.p += s.dir * dt / SWEEP;
      if (s.p >= 1) { s.p = 2 - s.p; s.dir = -1; } else if (s.p <= 0) { s.p = -s.p; s.dir = 1; }
      if (++s.hold >= HOLD) release(s);
      return;
    }
    if (s.phase === 2) {
      s.ft++;
      let t = s.ft * dt;
      if (t >= s.T) t = s.T;
      s.x = X0 + (s.xl - X0) * t / s.T;
      s.y = Y0 - s.v * t + G * t * t / 2 - BH / 2;
      s.a = SPIN * t;
      if (t === s.T) { s.phase = 3; land(s); s.px = s.x; s.py = s.y; }
      return;
    }
    // показ итога: удачно — бутылка выпрямляется (на дно или на крышку), иначе — валится набок
    s.st++;
    const k = s.st >= TIP ? 1 : s.st / TIP;
    if (s.res <= R_CAP) s.a = s.A - s.d * k;
    else { const lie = s.A - s.e + (s.e < 0 ? -Math.PI / 2 : Math.PI / 2); s.a = s.A + (lie - s.A) * k; s.y = s.yl - BH / 2 + (BH - BW) / 2 * k; }
    if (s.st < SHOW) return;
    s.i++;
    if (s.i >= THROWS) { s.over = true; s.snd = s.score >= 100 ? 'win' : 'ok'; return; }
    s.phase = 0; s.idle = 0; s.res = R_NONE; s.x = s.px = X0; s.y = s.py = Y0 - BH / 2; s.a = s.pa = 0; s.p = 0;
  }

  function draw(G2, s, al){
    const ctx = G2.ctx, i = s.i < THROWS ? s.i : THROWS - 1;
    const x = s.px + (s.x - s.px) * al, y = s.py + (s.y - s.py) * al, a = s.pa + (s.a - s.pa) * al;
    ctx.fillStyle = C.wall; ctx.fillRect(0, 0, W, FLOOR);
    ctx.fillStyle = C.wall2; for (let k = 0; k < 8; k++) ctx.fillRect(k * 40 + 18, 0, 4, FLOOR);
    ctx.fillStyle = C.floor; ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = C.floor2; ctx.fillRect(0, FLOOR, W, 4);
    // стол
    ctx.fillStyle = C.wood; ctx.fillRect(14, Y0, 92, 12);
    ctx.fillStyle = C.woodD; ctx.fillRect(22, Y0 + 12, 8, FLOOR - Y0 - 12); ctx.fillRect(90, Y0 + 12, 8, FLOOR - Y0 - 12);
    // табурет этого броска
    const tx = s.tx[i], ty = s.ty[i], tw = s.tw[i];
    ctx.fillStyle = C.stool; ctx.fillRect(tx - tw / 2, ty, tw, 10);
    ctx.fillStyle = C.stoolD; ctx.fillRect(tx - tw / 2 + 6, ty + 10, 7, FLOOR - ty - 10); ctx.fillRect(tx + tw / 2 - 13, ty + 10, 7, FLOOR - ty - 10);
    // бутылка (выше поля — стрелка у верхнего края)
    if (y < -BH / 2) { ctx.fillStyle = C.ink; ctx.fillRect(x - 3, 4, 6, 12); ctx.fillRect(x - 8, 4, 16, 4); }
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = C.glass; ctx.fillRect(-BW / 2, -BH / 2 + 12, BW, BH - 12);
    ctx.fillStyle = C.water; ctx.fillRect(-BW / 2 + 2, 0, BW - 4, BH / 2 - 2);
    ctx.fillStyle = C.label; ctx.fillRect(-BW / 2, -6, BW, 9);
    ctx.fillStyle = C.glass; ctx.fillRect(-6, -BH / 2 + 2, 12, 11);
    ctx.fillStyle = C.cap; ctx.fillRect(-7, -BH / 2 - 4, 14, 7);
    ctx.restore();
    // сила: полоска внизу, пока держишь
    ctx.fillStyle = C.bar; ctx.fillRect(20, 428, 280, 7);
    if (s.phase === 1) { ctx.fillStyle = C.pow; ctx.fillRect(20, 428, 280 * s.p, 7); }
    // итог броска
    if (s.phase === 3) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 24px Montserrat, system-ui, sans-serif'; ctx.fillStyle = s.res <= R_CAP ? C.good : C.bad;
      ctx.fillText(RTXT[s.res], W / 2, 120);
      if (s.gain) {
        if (G2.gain !== s.gain || G2.mult !== s.mult) { G2.gain = s.gain; G2.mult = s.mult; G2.gT = '+' + s.gain + (s.mult > 1 ? ' · два оборота ×2' : '') + (s.streak > 1 ? ' · серия ' + s.streak : ''); }
        ctx.font = '600 15px system-ui, sans-serif'; ctx.fillStyle = C.ink; ctx.fillText(G2.gT, W / 2, 152);
      }
    } else if (s.phase === 0 && s.i === 0) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '600 15px system-ui, sans-serif'; ctx.fillStyle = C.mute;
      ctx.fillText('Зажми и отпусти', W / 2, 120);
    }
  }

  ArcadeKit.define('flip', {
    kind: 'canvas', W, H, drag: true,
    title: '🍶 Бутылка',
    intro: 'Подбрось бутылку с водой, чтобы она встала на табурет. Зажми — сила качается, отпусти — бросок. Сила решает, сколько оборотов успеет сделать бутылка. 10 бросков, табурет каждый раз другой.',
    controls: 'Зажми палец или кнопку мыши и отпусти. Клавиатура — зажми и отпусти пробел. На крышку — 25, два оборота — ×2.',
    duelTitle: 'Одинаковые табуреты у обоих',
    keys: { Space: 0 },
    create, input, step, draw,
    hudKey: s => s.i * 100 + s.streak,
    hud: s => '🍶 бросок ' + Math.min(THROWS, s.i + 1) + '/' + THROWS + (s.streak > 1 ? ' · серия ' + s.streak : ''),
    win: s => s.score >= 100,
    result: s => ({
      title: s.score >= 250 ? '🍶 Бутылочный мастер!' : s.score >= 100 ? '🎉 Отличные броски!' : '🍶 Бутылка победила',
      text: 'встала: ' + s.good + ' из ' + THROWS + (s.best > 1 ? ' · лучшая серия ' + s.best : ''),
    }),
    consts: { W, H, FLOOR, Y0, X0, BH, BW, G, V0, V1, SPIN, SWEEP, THROWS, SHOW, IDLE, HOLD, PERFECT, STAND, CAPTOL, R_PERF, R_STAND, R_CAP, R_FALL, R_MISS },
  });
})();

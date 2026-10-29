// ═══════════════════════════════════════
//  ИГРА «СЕЙФ» (T-140) — стрелка бежит по кругу: тап, когда она над огоньком, — щелчок замка. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, стрелка — радиан в секунду.
// Своё: хранилище из 20 сейфов — у каждого свои штифты (3 → 14, лампочки сверху), после щелчка стрелка разворачивается;
// ⭐ золотой огонёк (с 3-го сейфа) уже обычного и даёт 3 очка; открытый сейф — +5. Скорость растёт с щелчками и сейфами.
// Исправлено против прототипа: (1) скорость стрелки — за кадр → в секунду (на 144 Гц прототип крутил в 2,4 раза быстрее);
// (2) Math.random для огонька → rng (у соперников одни и те же огоньки); (3) нажатие после поломки сразу начинало заново —
// теперь итог ядра; (4) двойной тап (дрожь пальца) сразу после щелчка ломал замок — 0,12 с после щелчка нажатия не считаются;
// (5) замок был бесконечным — 20 сейфов, и партия всегда кончается (последний сейф или промах); (6) угол рос без предела.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, CXD = 160, CYD = 246, RD = 104, TAU = Math.PI * 2;
  const W0 = 2.4, DWC = .06, DWS = .16, WMAX = 6;                 // рад/с: старт, + за щелчок, + за сейф, предел
  const MINA = 1, SPAN = 1.9, TOL = .25, TOLG = .17;              // огонёк — от 1 до 2,9 рад впереди; допуск (золотой — уже)
  const NSAFE = 20, OPEN = .7, COOL = .12, GOLD = .18;            // сейфов; пауза «сейф открыт»; защита от двойного тапа; доля ⭐
  const C = { bg: '#141826', door: '#3a4157', door2: '#2c3244', bolt: '#59617a', dial: '#22273a', face: '#1a1e2d', tick: 'rgba(255,255,255,.35)',
    tick5: 'rgba(255,255,255,.7)', needle: '#ff6b6b', knob: '#c9cde0', dot: '#35e0c3', gold: '#ffd166', pin: '#4a5068', pinOn: '#40c057', glow: 'rgba(64,192,87,.35)', bad: '#ff4d6d' };
  const TC = new Float32Array(60), TS = new Float32Array(60);
  for (let i = 0; i < 60; i++) { TC[i] = Math.cos(i * TAU / 60); TS[i] = Math.sin(i * TAU / 60); }
  const wrap = x => x - TAU * Math.floor((x + Math.PI) / TAU);   // в (−π, π]
  const pinsOf = i => 3 + Math.floor(i * .6);

  function target(s){
    s.tg = s.a + s.d * (MINA + s.rng() * SPAN);
    s.gold = s.safe >= 2 && s.rng() < GOLD;
    // угол не растёт без предела: сдвигаем стрелку и огонёк на целые обороты
    if (s.a > 50 || s.a < -50) { const k = TAU * Math.round(s.a / TAU); s.a -= k; s.tg -= k; s.pa -= k; }
  }

  function create(rng){
    const s = { rng, a: -Math.PI / 2, pa: -Math.PI / 2, d: 1, w: W0, tg: 0, gold: false, started: false, safe: 0, left: pinsOf(0), clicks: 0, golds: 0,
      open: 0, cool: 0, t: 0, score: 0, over: false, why: '', snd: 0, seq: new Float32Array(8) };
    target(s);
    for (let i = 0; i < 8; i++) s.seq[i] = rng();   // для ⚔️ сравнения полей: первые числа rng одинаковы у соперников
    return s;
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    if (!s.started) { s.started = true; s.snd = 'move'; return; }   // первый тап — только старт
    if (s.open > 0 || s.cool > 0) return;
    const sd = wrap((s.a - s.tg) * s.d), tol = s.gold ? TOLG : TOL;
    if (sd < -tol || sd > tol) { s.over = true; s.why = 'early'; s.snd = 'bad'; return; }
    s.clicks++; s.left--;
    if (s.gold) { s.score += 3; s.golds++; s.snd = 1175; } else { s.score += 1; s.snd = 880; }
    s.d = -s.d; s.cool = COOL;
    s.w = Math.min(WMAX, W0 + DWS * s.safe + DWC * (pinsOf(s.safe) - s.left));
    if (s.left === 0) {
      s.score += 5; s.safe++;
      if (s.safe >= NSAFE) { s.over = true; s.why = 'all'; s.snd = 'win'; return; }
      s.open = OPEN; s.left = pinsOf(s.safe); s.snd = 'win';
      s.w = Math.min(WMAX, W0 + DWS * s.safe);
    }
    target(s);
  }

  function step(s, dt){
    s.pa = s.a;
    if (!s.started) return;
    s.t += dt;
    if (s.cool > 0) s.cool -= dt;
    if (s.open > 0) { s.open -= dt; return; }
    s.a += s.d * s.w * dt;
    if (wrap((s.a - s.tg) * s.d) > (s.gold ? TOLG : TOL)) { s.over = true; s.why = 'late'; s.snd = 'bad'; }
  }

  function draw(G, s, al){
    const ctx = G.ctx, a = s.over ? s.a : s.pa + (s.a - s.pa) * al;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // дверца сейфа
    ctx.fillStyle = C.door2; ctx.fillRect(14, 64, 292, 352);
    ctx.fillStyle = C.door; ctx.fillRect(22, 72, 276, 336);
    ctx.fillStyle = C.bolt;
    ctx.beginPath(); ctx.arc(38, 88, 6, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(282, 88, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(38, 392, 6, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(282, 392, 6, 0, TAU); ctx.fill();
    // штифты текущего сейфа: зелёные — уже щёлкнули
    const n = pinsOf(s.safe < NSAFE ? s.safe : NSAFE - 1), done = s.over && s.why === 'all' ? n : n - s.left, x0 = CXD - (n - 1) * 9;
    for (let i = 0; i < n; i++) { ctx.fillStyle = i < done || s.open > 0 ? C.pinOn : C.pin; ctx.fillRect(x0 + i * 18 - 5, 92, 10, 18); }
    if (s.open > 0) { ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(CXD, CYD, RD + 22, 0, TAU); ctx.fill(); }
    // циферблат с делениями
    ctx.fillStyle = C.dial; ctx.beginPath(); ctx.arc(CXD, CYD, RD + 14, 0, TAU); ctx.fill();
    ctx.fillStyle = C.face; ctx.beginPath(); ctx.arc(CXD, CYD, RD - 18, 0, TAU); ctx.fill();
    for (let big = 0; big < 2; big++) {          // деления двумя путями (мелкие и крупные) — 2 вызова stroke на кадр
      const r0 = big ? RD - 14 : RD - 9;
      ctx.strokeStyle = big ? C.tick5 : C.tick; ctx.lineWidth = big ? 2 : 1;
      ctx.beginPath();
      for (let i = big ? 0 : 1; i < 60; i += big ? 5 : 1) { if (!big && i % 5 === 0) continue; ctx.moveTo(CXD + TC[i] * r0, CYD + TS[i] * r0); ctx.lineTo(CXD + TC[i] * (RD - 4), CYD + TS[i] * (RD - 4)); }
      ctx.stroke();
    }
    // огонёк-цель на ободе
    if (!s.over || s.why !== 'all') {
      ctx.fillStyle = s.gold ? C.gold : C.dot;
      ctx.beginPath(); ctx.arc(CXD + Math.cos(s.tg) * RD, CYD + Math.sin(s.tg) * RD, s.gold ? 8 : 11, 0, TAU); ctx.fill();
    }
    // стрелка
    ctx.strokeStyle = s.over && s.why !== 'all' ? C.bad : C.needle; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(CXD, CYD); ctx.lineTo(CXD + Math.cos(a) * (RD + 6), CYD + Math.sin(a) * (RD + 6)); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = C.knob; ctx.beginPath(); ctx.arc(CXD, CYD, 16, 0, TAU); ctx.fill();
  }

  ArcadeKit.define('lock', {
    kind: 'canvas', W, H,
    title: '🔐 Сейф',
    intro: 'Стрелка бежит по кругу. Тап, когда она над огоньком, — щелчок. Рано или проехала — замок сломан. Щёлкни все штифты — сейф открыт (+5). Сейфов — 20.',
    controls: 'Тап по полю, мышь или пробел — щелчок. Первый тап запускает стрелку.',
    duelTitle: 'Одинаковые сейфы и огоньки у обоих',
    keys: { Space: 0, KeyJ: 0, ArrowDown: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? s.safe * 100 + s.left : -1),
    hud: s => (s.started ? '🔐 сейф ' + Math.min(NSAFE, s.safe + 1) + ' из ' + NSAFE + ' · штифтов: ' + s.left : 'Тап — запустить стрелку'),
    win: s => s.safe >= 5,
    result: s => ({
      title: s.why === 'all' ? '🏆 Все 20 сейфов открыты!' : s.safe >= 10 ? '🔓 Взломщик-профи!' : s.why === 'late' ? '⏩ Стрелка проехала огонёк' : '⏪ Рано нажал',
      text: 'сейфов открыто: ' + s.safe + ' · щелчков: ' + s.clicks + (s.golds ? ' · ⭐ ' + s.golds : ''),
    }),
    consts: { W, H, CXD, CYD, RD, W0, DWC, DWS, WMAX, MINA, SPAN, TOL, TOLG, NSAFE, OPEN, COOL, GOLD },
  });
})();

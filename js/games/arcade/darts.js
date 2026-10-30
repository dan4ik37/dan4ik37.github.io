// ═══════════════════════════════════════
//  ИГРА «ДРОТИКИ» (T-140) — мишень крутится: тап — бросок дротика. Попал в уже воткнутый — промах, конец. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, мишень — радиан в секунду, дротик — единиц в секунду.
// Своё: 15 мишеней-колец; у каждой свой характер вращения (ровно / рывками / туда-обратно — из rng, одинаково у соперников);
// ⭐ золотой сектор на ободе — дротик в него даёт +2 (сектор гаснет); пройденная мишень — +5; всё за 2 минуты, за целую
// оставшуюся секунду после 15-й мишени — +1. Дротиков в полёте может быть до 4 (быстрые тапы не теряются).
// Исправлено против прототипа: (1) вращение и полёт — за кадр → в секунду (на 144 Гц прототип крутил в 2,4 раза быстрее);
// (2) угол попадания брался на кадре, когда нож уже «пролетел» обод (до 14 единиц), — теперь точный момент касания внутри шага;
// (3) Math.random для воткнутых заранее → rng (у соперников одинаковые мишени); (4) заранее воткнутые могли стоять вплотную
// друг к другу — теперь не ближе 0,6 рад; (5) тап, пока нож летит, терялся — теперь до 4 дротиков в полёте;
// (6) двойной тап (дрожь пальца) кидал два дротика почти в одну точку — 0,1 с после броска нажатия не считаются;
// (7) нажатие после промаха сразу начинало заново — итог ядра; (8) скорость росла с уровнем без предела, а игра была
// бесконечной — 15 мишеней и 2 минуты, партия всегда кончается; (9) промах считался при зазоре 0,2 рад — дротики даже не
// касались; теперь — когда оперения на рисунке перекрываются (0,12 рад); (10) массив ножей рос, а some() с замыканием шёл каждый кадр —
// типизированные массивы на 24 места.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, CX = 160, CY = 156, RB = 58, Y0 = 404, LEN = 40;      // центр и радиус мишени, старт и длина дротика
  const V = 1300, GAP = .12, NT = 15, LIMIT = 120, MAXF = 4, CAP = 24;           // скорость дротика; мин. угол между дротиками
  const GOLDW = .5, CLEAR = .6, PRE_SEP = .6, COOL = .1;                         // ширина ⭐ сектора; пауза «мишень пройдена»; защита от дрожи пальца
  const TAU = Math.PI * 2, RIM = CY + RB;
  const C = { bg: '#161a2b', ring0: '#e9dcc0', ring1: '#c8423c', ring2: '#e9dcc0', ring3: '#2f9e6a', bull: '#ffd166', edge: '#6b4b2a',
    shaft: '#cfd5e6', tip: '#8a93a8', fl: '#5c7cfa', flOld: '#8b95b8', bad: '#ff4d6d', gold: 'rgba(255,209,102,.95)', left: '#ffd166', clear: 'rgba(64,192,87,.35)' };
  const need = i => 5 + (i >> 1);                       // дротиков на мишень i (5 … 12)
  const preOf = i => (i < 1 ? 0 : Math.min(4, (i + 1) >> 1));   // воткнуто заранее
  const wrap = x => x - TAU * Math.floor((x + Math.PI) / TAU);  // в (−π, π]

  function target(s){
    const i = s.tg;
    s.n = 0; s.left = need(i); s.pre = preOf(i); s.goldOn = true; s.goldA = s.rng() * TAU;
    s.base = Math.min(3.4, 1.5 + .13 * i);
    s.mode = i < 2 ? 0 : Math.floor(s.rng() * 3);       // 0 — ровно, 1 — рывками, 2 — туда-обратно
    s.per = 1.3 + s.rng() * 1.1; s.dirT = s.rng() < .5 ? 1 : -1; s.w = s.base * s.dirT; s.mt = 0; s.rot = 0; s.prot = 0;
    for (let k = 0; k < s.pre; k++) {                   // заранее воткнутые: не ближе PRE_SEP друг к другу
      let a = 0, tries = 0, bad = true;
      while (bad && tries++ < 40) { a = s.rng() * TAU; bad = false; for (let j = 0; j < s.n; j++) if (Math.abs(wrap(a - s.ka[j])) < PRE_SEP) { bad = true; break; } }
      s.ka[s.n] = a; s.kf[s.n] = 1; s.n++;
    }
  }

  function create(rng){
    const s = { rng, tg: 0, n: 0, left: 0, pre: 0, goldOn: true, goldA: 0, base: 0, mode: 0, per: 1, dirT: 1, w: 0, mt: 0, rot: 0, prot: 0,
      ka: new Float64Array(CAP), kf: new Uint8Array(CAP), fy: new Float64Array(MAXF), pfy: new Float64Array(MAXF), nf: 0,
      started: false, t: 0, cool: 0, clear: 0, score: 0, darts: 0, golds: 0, over: false, why: '', hitA: 0, snd: 0, seq: new Float32Array(6) };
    target(s);
    s.seq[0] = s.goldA; s.seq[1] = s.mode; s.seq[2] = s.per; s.seq[3] = s.dirT; s.seq[4] = s.n ? s.ka[0] : 0; s.seq[5] = s.left;
    return s;
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    if (!s.started) { s.started = true; s.snd = 'move'; return; }   // первый тап — только старт
    if (s.clear > 0 || s.cool > 0 || s.left <= 0 || s.nf >= MAXF) return;
    s.fy[s.nf] = Y0; s.pfy[s.nf] = Y0; s.nf++; s.left--; s.cool = COOL; s.snd = 440;
  }

  // дротик i коснулся обода в доле f этого шага; ra — поворот мишени в этот момент
  function land(s, ra){
    const th = wrap(Math.PI / 2 - ra);                  // угол точки попадания в координатах мишени
    for (let j = 0; j < s.n; j++) if (Math.abs(wrap(th - s.ka[j])) < GAP) { s.over = true; s.why = 'clash'; s.hitA = th; s.snd = 'bad'; return; }
    if (s.n < CAP) { s.ka[s.n] = th; s.kf[s.n] = 0; s.n++; }
    s.darts++; s.score++;
    if (s.goldOn && Math.abs(wrap(th - s.goldA)) < GOLDW / 2) { s.goldOn = false; s.score += 2; s.golds++; s.snd = 1175; }
    else s.snd = 880;
  }

  function step(s, dt){
    s.prot = s.rot;
    for (let i = 0; i < s.nf; i++) s.pfy[i] = s.fy[i];
    if (!s.started) return;
    s.t += dt;
    if (s.cool > 0) s.cool -= dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'time'; s.snd = 'win'; return; }
    if (s.clear > 0) {
      s.clear -= dt;
      if (s.clear <= 0) {
        s.tg++;
        if (s.tg >= NT) { s.score += Math.floor(LIMIT - s.t); s.over = true; s.why = 'all'; s.snd = 'win'; return; }
        target(s);
      }
      return;
    }
    // угловая скорость по характеру мишени
    s.mt += dt;
    if (s.mode === 1) s.w = s.dirT * s.base * (1 + .65 * Math.sin(s.mt * TAU / s.per));
    else if (s.mode === 2) {
      if (s.mt >= s.per) { s.mt -= s.per; s.dirT = -s.dirT; }
      const want = s.dirT * s.base, a = 7 * dt;
      s.w = s.w < want - a ? s.w + a : s.w > want + a ? s.w - a : want;
    }
    // полёт: точный момент касания внутри шага
    const d = V * dt;
    for (let i = 0; i < s.nf; i++) {
      const y = s.fy[i] - d;
      if (y > RIM) { s.fy[i] = y; continue; }
      land(s, s.rot + s.w * dt * ((s.fy[i] - RIM) / d));
      for (let j = i; j < s.nf - 1; j++) { s.fy[j] = s.fy[j + 1]; s.pfy[j] = s.pfy[j + 1]; }
      s.nf--; i--;
      if (s.over) return;
    }
    s.rot += s.w * dt;
    if (s.rot > 60 || s.rot < -60) { const k = TAU * Math.round(s.rot / TAU); s.rot -= k; s.prot -= k; }
    if (s.left === 0 && s.nf === 0) { s.score += 5; s.clear = CLEAR; s.snd = 'win'; }
  }

  function dart(ctx, a, r0, r1){ const c = Math.cos(a), si = Math.sin(a); ctx.moveTo(CX + c * r0, CY + si * r0); ctx.lineTo(CX + c * r1, CY + si * r1); }

  function draw(G, s, al){
    const ctx = G.ctx, rot = s.over ? s.rot : s.prot + (s.rot - s.prot) * al;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    if (s.clear > 0) { ctx.fillStyle = C.clear; ctx.beginPath(); ctx.arc(CX, CY, RB + 30, 0, TAU); ctx.fill(); }
    // мишень: кольца
    ctx.fillStyle = C.edge; ctx.beginPath(); ctx.arc(CX, CY, RB + 4, 0, TAU); ctx.fill();
    ctx.fillStyle = C.ring0; ctx.beginPath(); ctx.arc(CX, CY, RB, 0, TAU); ctx.fill();
    ctx.fillStyle = C.ring1; ctx.beginPath(); ctx.arc(CX, CY, RB * .75, 0, TAU); ctx.fill();
    ctx.fillStyle = C.ring2; ctx.beginPath(); ctx.arc(CX, CY, RB * .5, 0, TAU); ctx.fill();
    ctx.fillStyle = C.ring3; ctx.beginPath(); ctx.arc(CX, CY, RB * .28, 0, TAU); ctx.fill();
    ctx.fillStyle = C.bull; ctx.beginPath(); ctx.arc(CX, CY, RB * .1, 0, TAU); ctx.fill();
    // метка вращения — видно, куда и как быстро крутится
    ctx.strokeStyle = C.edge; ctx.lineWidth = 3; ctx.beginPath(); dart(ctx, rot, RB * .3, RB * .72); ctx.stroke();
    // ⭐ золотой сектор
    if (s.goldOn && s.clear <= 0) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(CX, CY, RB - 4, s.goldA + rot - GOLDW / 2, s.goldA + rot + GOLDW / 2); ctx.stroke();
    }
    // воткнутые дротики: древко, наконечник, оперение (по пути на цвет)
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.shaft; ctx.lineWidth = 3; ctx.beginPath();
    for (let j = 0; j < s.n; j++) dart(ctx, s.ka[j] + rot, RB - 6, RB + LEN - 10);
    ctx.stroke();
    ctx.lineWidth = 10;
    for (let old = 0; old < 2; old++) {
      ctx.strokeStyle = old ? C.flOld : C.fl; ctx.beginPath();
      for (let j = 0; j < s.n; j++) if (s.kf[j] === old) dart(ctx, s.ka[j] + rot, RB + LEN - 12, RB + LEN);
      ctx.stroke();
    }
    // летящие дротики (вертикально вверх, остриё — fy)
    ctx.strokeStyle = C.shaft; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < s.nf; i++) { const y = s.pfy[i] + (s.fy[i] - s.pfy[i]) * al; ctx.moveTo(CX, y); ctx.lineTo(CX, y + LEN - 10); }
    ctx.stroke();
    ctx.strokeStyle = C.fl; ctx.lineWidth = 10; ctx.beginPath();
    for (let i = 0; i < s.nf; i++) { const y = s.pfy[i] + (s.fy[i] - s.pfy[i]) * al; ctx.moveTo(CX, y + LEN - 12); ctx.lineTo(CX, y + LEN); }
    ctx.stroke();
    // промах: дротик отскочил (красный, наискось у обода)
    if (s.over && s.why === 'clash') {
      ctx.strokeStyle = C.bad; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(CX + 6, RIM + 6); ctx.lineTo(CX + 30, RIM + LEN); ctx.stroke();
    }
    ctx.lineCap = 'butt';
    // запас дротиков внизу
    if (s.started || s.left) {
      const n = s.left, x0 = CX - (n - 1) * 8;
      ctx.strokeStyle = C.left; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < n; i++) { ctx.moveTo(x0 + i * 16, 418); ctx.lineTo(x0 + i * 16, 436); }
      ctx.stroke();
    }
  }

  ArcadeKit.define('darts', {
    kind: 'canvas', W, H,
    title: '🎯 Дротики',
    intro: 'Мишень крутится. Тап — бросок дротика. Попал в уже воткнутый — промах, игра окончена. Все дротики в мишени — +5 и следующая. ⭐ золотой сектор — +2. 15 мишеней за 2 минуты.',
    controls: 'Тап по полю, мышь или пробел — бросок. Первый тап — старт.',
    duelTitle: 'Одинаковые мишени у обоих',
    keys: { Space: 0, ArrowUp: 0, KeyJ: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? s.tg * 100000 + s.left * 1000 + Math.ceil(LIMIT - s.t) : -1),
    hud: s => (s.started ? '🎯 ' + Math.min(NT, s.tg + 1) + ' из ' + NT + ' · дротиков: ' + s.left + ' · ⏱ ' + Math.ceil(LIMIT - s.t) + ' с' : 'Тап — старт'),
    win: s => s.tg >= 5,
    result: s => ({
      title: s.why === 'all' ? '🏆 Все 15 мишеней!' : s.why === 'time' ? '⏱ Время вышло' : s.tg >= 8 ? '🎯 Меткий глаз!' : '💥 Дротик в дротик',
      text: 'мишеней: ' + s.tg + ' · дротиков: ' + s.darts + (s.golds ? ' · ⭐ ' + s.golds : ''),
    }),
    consts: { W, H, CX, CY, RB, Y0, LEN, V, GAP, NT, LIMIT, MAXF, CAP, GOLDW, CLEAR, PRE_SEP, COOL, RIM },
  });
})();

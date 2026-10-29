// ═══════════════════════════════════════
//  ИГРА «СЛИЯНИЕ ПЛАНЕТ» (T-140) — роняй небесные тела, одинаковые сливаются в большее. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, тяжесть — единиц в секунду², 4 подшага на шаг.
// Цепочка: метеорит → астероид → луна → каменная → красная → голубая планета → газовый гигант → планета с кольцами →
// звезда; две звезды — 💥 сверхновая (+500, обе исчезают). Своё: каждый 12-й бросок — ☄️ комета: что заденет первым — то
// и разобьёт (место освобождается); не бросил 2,5 с — тело падает само. Конец: что-то лежит выше красной линии 2 с подряд
// или прошли 2 минуты.
// Исправлено против прототипа: (1) физика «за кадр» и 4 повтора за кадр — на 144 Гц всё падало в 2,4 раза быстрее; теперь
// шаг 60 Гц, 4 подшага, скорости в секунду; (2) F.filter / F.push / новые объекты на каждое слияние (мусор) — теперь пул
// в типизированных массивах; (3) Math.random — rng (у соперников одинаковые тела); (4) переполнение по «возрасту в кадрах»
// — теперь в шагах; (5) тап после конца сразу начинал заново; (6) конца, кроме переполнения, не было — для соревнования
// общий предел 2 минуты; (7) бросок по нажатию сразу — теперь целишься пальцем и отпускаешь.
// Проверка T-140 (D4): броски наугад так часто, как можно, всегда «побеждали» и набирали больше бота со стратегией
// (30 из 30, в среднем 2604 против 2267): тела были мелкие для поля 320 — банка не переполнялась, и счёт решало число
// бросков, а не куда бросаешь. Теперь тела в 1,6 раза крупнее (банка тесная — переполнение настоящая угроза, место броска
// решает), победа — ⭐ звезда или 💥 сверхновая, или 🪐 планета с кольцами, если продержался все 2 минуты.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, FLOOR = 432, LINE = 82, HANG = 44, NP = 56, SUB = 4;
  const RAD = [18, 24, 32, 40, 50, 59, 70, 82, 93], TOP = 8, COMET = 9, CR = 10, RING = 7;
  // кольца (у планеты RING) и сияние звезды — от радиуса тела; точка начала эллипса кольца (наклон −0,25)
  const RX = Math.round(RAD[RING] * 1.25), RY = Math.round(RAD[RING] * .18), RMX = RX * Math.cos(-.25), RMY = RX * Math.sin(-.25), GLOW = Math.round(RAD[TOP] * 1.1);
  const PTS = [0, 2, 4, 8, 16, 32, 64, 128, 256], NOVA = 500;
  const G0 = 900, REST = .12, CD = 30, IDLE = 150, DANGER = 120, TIME = 120 * 60, KEYV = 260;
  const COL = ['#a8a29e', '#8a7560', '#cfd2dc', '#b9a27a', '#e0603f', '#4fb3ff', '#e8a94f', '#c38bff', '#ffd23f', '#e6f6ff'];
  const ICON = ['🌠', '🪨', '🌑', '🟤', '🔴', '🔵', '🟠', '🪐', '⭐', '☄️'];
  const C = { bg: '#0a0d1f', star: 'rgba(255,255,255,.45)', line: '#ff4d6d', lineOff: 'rgba(255,77,109,.35)', aim: 'rgba(255,255,255,.18)', dark: 'rgba(0,0,0,.22)', light: 'rgba(255,255,255,.35)', ring: '#f1d38a', glow: 'rgba(255,210,63,.3)', nova: 'rgba(255,240,200,.5)' };
  const STARS = new Float32Array(40);
  for (let i = 0, a = 777; i < 40; i++) { a = (a * 1103515245 + 12345) >>> 0; STARS[i] = (a >>> 8) / 16777216; }

  // свой генератор (xorshift32) с зерном из rng партии: целое 0…2^24−1 — без «упакованных» дробных
  function rnd(s){ let x = s.rs[0]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.rs[0] = x; return x >>> 8; }
  const U = 1 / 16777216;
  // следующее тело: 0–3 (крупнее — реже), каждый 12-й — комета
  function nextType(s){ const u = rnd(s) % 100; return u < 34 ? 0 : u < 64 ? 1 : u < 86 ? 2 : 3; }
  const radius = t => (t === COMET ? CR : RAD[t]);

  function create(rng){
    const s = { rng, rs: Int32Array.of((rng() * 4294967296) | 0 || 1), t: 0, left: TIME, score: 0, over: false, why: '', snd: 0,
      cur: 0, nxt: 0, aim: W / 2, cd: 0, idle: 0, want: 0, drops: 0, danger: 0, merges: 0, top: 0, novas: 0, flash: 0, nx: 0, ny: 0,
      x: new Float64Array(NP), y: new Float64Array(NP), x0: new Float64Array(NP), y0: new Float64Array(NP), vx: new Float64Array(NP), vy: new Float64Array(NP),
      lv: new Uint8Array(NP), on: new Uint8Array(NP), age: new Uint16Array(NP), pop: new Uint8Array(NP) };
    s.cur = nextType(s); s.nxt = nextType(s);
    return s;
  }

  function add(s, t, x, y, vx, vy){
    let i = 0;
    while (i < NP && s.on[i]) i++;
    if (i === NP) return -1;
    s.on[i] = 1; s.lv[i] = t; s.x[i] = x; s.y[i] = y; s.x0[i] = x; s.y0[i] = y; s.vx[i] = vx; s.vy[i] = vy; s.age[i] = 0; s.pop[i] = 8;
    return i;
  }

  function drop(s){
    const r = radius(s.cur), x = Math.min(W - r, Math.max(r, s.aim));
    add(s, s.cur, x, HANG, 0, 60);
    s.drops++;
    s.cur = s.nxt;
    s.nxt = (s.drops + 2) % 12 === 0 ? COMET : nextType(s);   // nxt полетит броском drops + 2
    s.cd = CD; s.idle = 0; s.want = 0; s.snd = 'move';
  }

  function input(s, e){
    if (s.over) return;
    if (e.type === T.DOWN || e.type === T.MOVE) s.aim = e.x;
    else if (e.type === T.UP) s.want = 1;                    // отпустил — бросок (как только тело готово)
    else if (e.type === T.KEY && e.k === 2) s.want = 1;
  }

  // слияние / комета / столкновение пары i, j (они пересекаются). Только целые аргументы: дробные в вызов — «упаковка»
  // (мусор на каждое касание), поэтому расстояние считается здесь
  function pair(s, i, j){
    const li = s.lv[i], lj = s.lv[j], ri = radius(li), rj = radius(lj);
    const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], d = Math.sqrt(dx * dx + dy * dy) + 1e-9;
    if (li === COMET || lj === COMET) {
      // комета разбивает первое, что задела (и исчезает сама)
      const k = li === COMET ? j : i;
      s.score += PTS[s.lv[k] === COMET ? 0 : s.lv[k]] + 5; s.on[i] = 0; s.on[j] = 0; s.snd = 196; s.flash = 10;
      s.nx = s.x[k]; s.ny = s.y[k];
      return;
    }
    if (li === lj) {
      s.on[i] = 0; s.on[j] = 0; s.merges++;
      const mx = (s.x[i] + s.x[j]) * .5, my = (s.y[i] + s.y[j]) * .5;
      if (li === TOP) { s.score += NOVA; s.novas++; s.snd = 'win'; s.flash = 30; s.nx = mx; s.ny = my; return; }
      const k = add(s, li + 1, mx, my, (s.vx[i] + s.vx[j]) * .5, Math.min(s.vy[i], s.vy[j]) * .5);
      s.score += PTS[li + 1]; s.top = Math.max(s.top, li + 1); s.snd = 330 + li * 70;
      if (k >= 0) s.age[k] = 60;
      return;
    }
    // разные: раздвинуть по массам (площади) и погасить сближение
    const nx = dx / d, ny = dy / d, ma = ri * ri, mb = rj * rj, o = ri + rj - d, ka = mb / (ma + mb), kb = ma / (ma + mb);
    s.x[i] -= nx * o * ka; s.y[i] -= ny * o * ka; s.x[j] += nx * o * kb; s.y[j] += ny * o * kb;
    const vn = (s.vx[j] - s.vx[i]) * nx + (s.vy[j] - s.vy[i]) * ny;
    const imp = vn < 0 ? -(1 + REST) * vn / (1 / ma + 1 / mb) : 0;
    s.vx[i] -= imp * nx / ma; s.vy[i] -= imp * ny / ma; s.vx[j] += imp * nx / mb; s.vy[j] += imp * ny / mb;
  }

  function step(s, dt, inp){
    if (s.over) return;
    s.t++;
    s.flash = Math.max(0, s.flash - 1);
    const keys = inp ? inp.keys : 0;
    s.aim += ((keys & 2 ? 1 : 0) - (keys & 1 ? 1 : 0)) * KEYV * dt;
    s.aim = Math.min(W, Math.max(0, s.aim));
    // бросок: по желанию игрока (когда готово) или сам после IDLE шагов
    s.cd = Math.max(0, s.cd - 1);
    s.idle = s.cd ? 0 : s.idle + 1;
    for (let i = 0; i < NP; i++) { s.x0[i] = s.x[i]; s.y0[i] = s.y[i]; }
    if (!s.cd && (s.want || s.idle >= IDLE)) drop(s);
    const h = dt / SUB;
    for (let sub = 0; sub < SUB; sub++) {
      for (let i = 0; i < NP; i++) {
        if (!s.on[i]) continue;
        const r = radius(s.lv[i]);
        s.vy[i] += G0 * h;
        s.vx[i] *= .9985;
        s.x[i] += s.vx[i] * h; s.y[i] += s.vy[i] * h;
        // стены и пол: выбор значения без отдельных вычислений в ветке
        const x = s.x[i], y = s.y[i], vx = s.vx[i], vy = s.vy[i], bx = Math.abs(vx) * .3, by = -Math.abs(vy) * .2;
        s.vx[i] = x < r ? bx : x > W - r ? -bx : vx;
        s.vy[i] = y > FLOOR - r ? by : vy;
        s.vx[i] *= y > FLOOR - r ? .92 : 1;
        s.x[i] = Math.min(W - r, Math.max(r, x));
        s.y[i] = Math.min(FLOOR - r, y);
      }
      for (let i = 0; i < NP; i++) {
        if (!s.on[i]) continue;
        for (let j = i + 1; j < NP; j++) {
          if (!s.on[j] || !s.on[i]) continue;
          const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i], rr = radius(s.lv[i]) + radius(s.lv[j]), q = dx * dx + dy * dy;
          if (q >= rr * rr) continue;
          pair(s, i, j);
        }
      }
    }
    // переполнение: что-то улёгшееся торчит выше линии 2 с подряд
    let high = 0;
    for (let i = 0; i < NP; i++) {
      if (!s.on[i]) continue;
      s.age[i] = Math.min(9999, s.age[i] + 1);
      s.pop[i] = Math.max(0, s.pop[i] - 1);
      high |= s.age[i] > 60 && s.y[i] - radius(s.lv[i]) < LINE ? 1 : 0;
    }
    s.danger = high ? s.danger + 1 : 0;
    s.left = TIME - s.t;
    const end = s.danger >= DANGER || s.left <= 0;
    s.why = s.danger >= DANGER ? 'full' : 'time';
    const endSnd = s.danger >= DANGER ? 'bad' : 'win';
    s.snd = end ? endSnd : s.snd;
    s.over = end;
  }

  // ── рисование ──
  function draw(G, s, a){
    const ctx = G.ctx, k = s.over ? 1 : a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.star;
    for (let i = 0; i < 40; i += 2) ctx.fillRect(STARS[i] * W, STARS[i + 1] * H, 1.5, 1.5);
    // линия переполнения (мигает, когда опасно) и прицел
    ctx.fillStyle = s.danger && (s.danger >> 3) & 1 ? C.line : C.lineOff;
    for (let x = 0; x < W; x += 16) ctx.fillRect(x, LINE - 1, 9, 2);
    if (!s.over) {
      const r = radius(s.cur), ax = Math.min(W - r, Math.max(r, s.aim));
      ctx.fillStyle = C.aim; ctx.fillRect(ax - 1, HANG, 2, FLOOR - HANG);
      if (!s.cd) {
        ctx.fillStyle = COL[s.cur]; ctx.beginPath(); ctx.arc(ax, HANG, r, 0, 6.2832); ctx.fill();
        if (s.cur === COMET) { ctx.fillStyle = C.light; ctx.fillRect(ax - r - 14, HANG - 2, 14, 4); }
      }
    }
    // положения кадра (между шагами) — в массивах на G, создаются один раз
    if (!G.ix) { G.ix = new Float32Array(NP); G.iy = new Float32Array(NP); }
    for (let i = 0; i < NP; i++) { G.ix[i] = s.x0[i] + (s.x[i] - s.x0[i]) * k; G.iy[i] = s.y0[i] + (s.y[i] - s.y0[i]) * k; }
    const X = G.ix, Y = G.iy;
    // тела: по уровням одним путём; новые «вспухают»
    for (let t = 0; t <= COMET; t++) {
      ctx.fillStyle = COL[t];
      ctx.beginPath();
      for (let i = 0; i < NP; i++) {
        if (!s.on[i] || s.lv[i] !== t) continue;
        const r = radius(t) * (1 + s.pop[i] * .02);
        ctx.moveTo(X[i] + r, Y[i]); ctx.arc(X[i], Y[i], r, 0, 6.2832);
      }
      ctx.fill();
    }
    // детали: тень-полоса у планет, блик у мелких, кольца, сияние звёзд
    ctx.fillStyle = C.dark;
    for (let i = 0; i < NP; i++) if (s.on[i] && s.lv[i] >= 3 && s.lv[i] <= RING) { const r = radius(s.lv[i]); ctx.fillRect(X[i] - r * .8, Y[i] + r * .15, r * 1.6, r * .22); }
    ctx.fillStyle = C.light;
    for (let i = 0; i < NP; i++) if (s.on[i] && s.lv[i] <= 2) { const r = radius(s.lv[i]) * .3; ctx.fillRect(X[i] - r * 1.5, Y[i] - r * 1.5, r, r); }
    ctx.strokeStyle = C.ring; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < NP; i++) {
      if (!s.on[i] || s.lv[i] !== RING) continue;
      ctx.moveTo(X[i] + RMX, Y[i] + RMY); ctx.ellipse(X[i], Y[i], RX, RY, -.25, 0, 6.2832);
    }
    ctx.stroke();
    ctx.fillStyle = C.glow; ctx.beginPath();
    for (let i = 0; i < NP; i++) { if (!s.on[i] || s.lv[i] !== TOP) continue; ctx.moveTo(X[i] + GLOW, Y[i]); ctx.arc(X[i], Y[i], GLOW, 0, 6.2832); }
    ctx.fill();
    if (s.flash) { ctx.fillStyle = C.nova; ctx.beginPath(); ctx.arc(s.nx, s.ny, 20 + (30 - s.flash) * 3, 0, 6.2832); ctx.fill(); }
  }

  ArcadeKit.define('planets', {
    kind: 'canvas', W, H, drag: true,
    title: '🪐 Слияние планет',
    intro: 'Целься пальцем и отпусти — тело упадёт. Два одинаковых сливаются в большее: метеорит → астероид → луна → … → звезда. Банка тесная: не дай телам застрять выше красной линии. Победа — ⭐ звезда или 🪐 планета с кольцами, если продержишься 2 минуты.',
    controls: 'Веди пальцем (или мышью с зажатой кнопкой) и отпусти. Клавиатура: ← → и пробел. Не бросишь 2,5 с — тело упадёт само.',
    duelTitle: 'Одинаковые тела у обоих',
    keys: { ArrowLeft: 0, KeyA: 0, ArrowRight: 1, KeyD: 1, Space: 2, ArrowDown: 2, KeyS: 2 },
    create, input, step, draw,
    hudKey: s => s.nxt * 1e4 + Math.ceil(s.left / 60),
    hud: s => 'дальше: ' + ICON[s.nxt] + ' · ⏱ ' + Math.floor(Math.ceil(s.left / 60) / 60) + ':' + String(Math.ceil(s.left / 60) % 60).padStart(2, '0'),
    // победа (XP): звезда или сверхновая; планета с кольцами — если банка не переполнилась за 2 минуты
    win: s => s.novas > 0 || s.top >= TOP || (s.top >= RING && s.why === 'time'),
    result: s => ({
      title: s.novas ? '💥 Сверхновая!' : s.top >= TOP ? '⭐ Звезда!' : s.top >= RING && s.why === 'time' ? '🪐 Планета с кольцами!' : s.why === 'full' ? '🌌 Космос переполнен' : '⏰ Время вышло',
      text: 'слияний: ' + s.merges + ' · самое большое: ' + ICON[s.top],
    }),
    consts: { W, H, FLOOR, LINE, HANG, NP, RAD, TOP, RING, COMET, CR, PTS, NOVA, CD, IDLE, DANGER, TIME, G0 },
  });
})();

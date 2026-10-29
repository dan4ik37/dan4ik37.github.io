// ═══════════════════════════════════════
//  ИГРА «КУБИК-БЕГУН» (T-140) — кубик бежит по пустыне: тап — прыжок через кактусы, на ящики можно запрыгнуть. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, скорость и тяжесть — в единицах поля в секунду.
// Своё: пустыня на закате, кактусы и ящики (на ящик можно запрыгнуть и бежать по нему), ⭐ над препятствиями — +2 очка;
// нажатие в воздухе запоминается на 0,14 с — прыжок сразу при приземлении; трасса — 2 минуты, на финише флаг.
// Исправлено против прототипа: (1) движение за кадр → в секунду (на 144 Гц прототип бежал в 2,4 раза быстрее); (2) Math.random →
// rng (у соперников одна трасса); (3) нажатие чуть раньше приземления пропадало — теперь запоминается (BUF); (4) расстояние между
// шипами было постоянным, а скорость росла — на большой скорости выпадали непроходимые связки; теперь промежуток растёт со
// скоростью и всегда хватает места приземлиться и прыгнуть снова; (5) нажатие после проигрыша сразу начинало заново — итог ядра;
// (6) массив препятствий пересоздавался каждый кадр (filter) — кольцо; (7) бег был бесконечным — финиш через 2 минуты.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, GY = 360, CX = 60, CS = 26;              // земля, кубик: левый край и размер
  const GRAV = 1800, JUMP = -560, FALL = 900, BUF = .14;            // прыжок: ~0,62 с в воздухе, высота ~87
  const V0 = 200, DV = 2.2, VMAX = 330, LIMIT = 120;                // скорость: старт, + за препятствие, предел; трасса — 120 с
  const CW = 18, CH = 30, CRH = 34, CRH2 = 56;                      // кактус: ширина одного, высота; ящик: низкий / высокий
  const RING = 16, MASK = RING - 1, STAR = 10;
  const C = { sky: '#3a2452', sun: '#ff9f43', mesa: '#5a2f4f', mesa2: '#7a3b52', sand: '#d39a5a', sand2: '#b77d44', cactus: '#3fb950', cactus2: '#2b8a3e',
    crate: '#a8642f', plank: '#7a4520', cube: '#ffd166', eye: '#1b1530', ant: '#ff6b6b', star: '#ffe066', bad: '#ff4d6d', flag: '#ffffff', pole: '#4a3a5a' };
  const T_AIR = -2 * JUMP / GRAV;

  function add(s){
    const i = s.count++, j = i & MASK, v = Math.min(VMAX, s.spd + 25);
    const prevEnd = i === 0 ? W + 140 : s.ox[(i - 1) & MASK] + s.ow[(i - 1) & MASK];
    s.ox[j] = i === 0 ? prevEnd : prevEnd + v * (.66 + s.rng() * .62) + 30;
    const crate = i >= 3 && s.rng() < .3;
    if (crate) {
      s.ok[j] = 2;
      s.ow[j] = 50 + Math.floor(s.rng() * 4) * 20;
      s.oh[j] = i >= 12 && s.rng() < .35 ? CRH2 : CRH;
    } else {
      s.ok[j] = 1;
      const nmax = Math.min(3, 1 + Math.floor(i / 8));
      s.ow[j] = CW * (1 + Math.floor(s.rng() * nmax));
      s.oh[j] = CH;
    }
    s.op[j] = 0;
    s.os[j] = s.rng() < .3 ? 1 : 0;   // ⭐ над препятствием
  }

  function create(rng){
    const s = { rng, y: GY - CS, py: GY - CS, vy: 0, ground: true, jbuf: 0, squash: 0, started: false, t: 0, spd: V0, dist: 0, pd: 0,
      score: 0, passed: 0, stars: 0, over: false, why: '', snd: 0, first: 0, count: 0,
      ox: new Float64Array(RING), ow: new Float64Array(RING), oh: new Float64Array(RING), ok: new Uint8Array(RING), op: new Uint8Array(RING), os: new Uint8Array(RING) };
    while (s.count < 5) add(s);
    return s;
  }

  function jump(s){ s.vy = JUMP; s.ground = false; s.jbuf = 0; s.snd = 523; }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    s.started = true;
    if (s.ground) jump(s); else s.jbuf = BUF;
  }

  function lose(s){ s.over = true; s.why = 'hit'; s.snd = 'bad'; }

  function step(s, dt){
    s.py = s.y; s.pd = 0;
    if (s.squash > 0) s.squash -= dt;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'finish'; s.snd = 'win'; return; }
    s.spd = Math.min(VMAX, V0 + DV * s.passed);
    const d = s.spd * dt;
    s.pd = d; s.dist += d;
    for (let i = s.first; i < s.count; i++) s.ox[i & MASK] -= d;
    // опора под кубиком: земля или верх ящика, над которым он был на прошлом шаге
    const bottom0 = s.y + CS;
    let floor = GY;
    for (let i = s.first; i < s.count; i++) {
      const j = i & MASK;
      if (s.ok[j] !== 2) continue;
      const top = GY - s.oh[j];
      if (s.ox[j] < CX + CS - 2 && s.ox[j] + s.ow[j] > CX + 2 && bottom0 <= top + .5 && top < floor) floor = top;
    }
    s.vy += GRAV * dt; if (s.vy > FALL) s.vy = FALL;
    const ny = s.y + s.vy * dt;
    if (s.vy >= 0 && ny + CS >= floor) { if (!s.ground) s.squash = .12; s.y = floor - CS; s.vy = 0; s.ground = true; }
    else { s.y = ny; s.ground = false; }
    if (s.jbuf > 0) { s.jbuf -= dt; if (s.ground) jump(s); }
    // столкновения, пройденные препятствия, звёзды
    for (let i = s.first; i < s.count; i++) {
      const j = i & MASK, x = s.ox[j], w = s.ow[j], top = GY - s.oh[j];
      if (s.ok[j] === 1) { if (x + 4 < CX + CS && x + w - 4 > CX && s.y + CS > top + 5) return lose(s); }
      else if (x < CX + CS - 2 && x + w > CX + 2 && s.y + CS > top + 1) return lose(s);
      if (s.os[j] === 1) {
        const sx = x + w / 2, sy = top - 62;
        if (sx + STAR > CX && sx - STAR < CX + CS && sy + STAR > s.y && sy - STAR < s.y + CS) { s.os[j] = 2; s.stars++; s.score += 2; s.snd = 1175; }
      }
      if (!s.op[j] && x + w < CX) { s.op[j] = 1; s.passed++; s.score++; if (!s.snd) s.snd = 'tick'; }
    }
    while (s.first < s.count && s.ox[s.first & MASK] + s.ow[s.first & MASK] < -20) s.first++;
    while (s.count - s.first < RING && s.ox[(s.count - 1) & MASK] < W + 200) add(s);
  }

  function draw(G, s, a){
    const ctx = G.ctx, back = s.over ? 0 : s.pd * (1 - a), dist = s.dist - back;
    const y = s.over ? s.y : s.py + (s.y - s.py) * a;
    ctx.fillStyle = C.sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.sun; ctx.beginPath(); ctx.arc(236, 150, 34, 0, 6.2832); ctx.fill();
    // столовые горы — два слоя параллакса
    let off = (dist * .15) % 160;
    ctx.fillStyle = C.mesa;
    for (let k = -1; k < 3; k++) { const x = k * 160 - off; ctx.fillRect(x + 10, 250, 70, GY - 250); ctx.fillRect(x + 90, 290, 40, GY - 290); }
    off = (dist * .35) % 120;
    ctx.fillStyle = C.mesa2;
    for (let k = -1; k < 4; k++) { const x = k * 120 - off; ctx.fillRect(x + 30, 310, 50, GY - 310); }
    ctx.fillStyle = C.sand; ctx.fillRect(0, GY, W, H - GY);
    ctx.fillStyle = C.sand2;
    off = dist % 40;
    for (let k = 0; k < 9; k++) ctx.fillRect(k * 40 - off, GY + 18 + (k % 3) * 14, 14, 3);
    for (let i = s.first; i < s.count; i++) {
      const j = i & MASK, x = s.ox[j] + back, w = s.ow[j], top = GY - s.oh[j];
      if (x > W + 10 || x + w < -10) continue;
      if (s.ok[j] === 1) {
        for (let cx = x; cx < x + w - 1; cx += CW) {
          ctx.fillStyle = C.cactus; ctx.fillRect(cx + 6, top, 7, CH);
          ctx.fillRect(cx + 1, top + 10, 4, 10); ctx.fillRect(cx + 14, top + 6, 4, 10);
          ctx.fillStyle = C.cactus2; ctx.fillRect(cx + 1, top + 18, 6, 3); ctx.fillRect(cx + 12, top + 14, 6, 3);
        }
      } else {
        ctx.fillStyle = C.crate; ctx.fillRect(x, top, w, s.oh[j]);
        ctx.fillStyle = C.plank; ctx.fillRect(x, top, w, 4); ctx.fillRect(x, GY - 4, w, 4);
        for (let px = x + 18; px < x + w - 4; px += 20) ctx.fillRect(px, top + 4, 3, s.oh[j] - 8);
      }
      if (s.os[j] === 1) {
        const sx = x + w / 2, sy = top - 62;
        ctx.fillStyle = C.star; ctx.beginPath();
        ctx.moveTo(sx, sy - STAR); ctx.lineTo(sx + 3, sy - 3); ctx.lineTo(sx + STAR, sy - 2); ctx.lineTo(sx + 4, sy + 3);
        ctx.lineTo(sx + 6, sy + STAR); ctx.lineTo(sx, sy + 5); ctx.lineTo(sx - 6, sy + STAR); ctx.lineTo(sx - 4, sy + 3);
        ctx.lineTo(sx - STAR, sy - 2); ctx.lineTo(sx - 3, sy - 3); ctx.closePath(); ctx.fill();
      }
    }
    // финишный флаг в последние 3 секунды
    if (s.started && s.t > LIMIT - 3) {
      const fx = CX + CS + (LIMIT - s.t) * s.spd - back;
      ctx.fillStyle = C.pole; ctx.fillRect(fx, GY - 90, 4, 90);
      ctx.fillStyle = C.flag; ctx.fillRect(fx + 4, GY - 90, 28, 18);
    }
    // кубик-робот: сплющивается при приземлении, антенна качается
    const sq = s.squash > 0 ? s.squash / .12 * 5 : 0, by = s.started ? y : y;
    ctx.fillStyle = s.over && s.why === 'hit' ? C.bad : C.cube;
    ctx.fillRect(CX - sq / 2, by + sq, CS + sq, CS - sq);
    ctx.fillStyle = C.eye; ctx.fillRect(CX + 14, by + 7 + sq, 4, 5); ctx.fillRect(CX + 20, by + 7 + sq, 4, 5); ctx.fillRect(CX + 15, by + 17 + sq / 2, 8, 2);
    ctx.fillStyle = C.eye; ctx.fillRect(CX + 8, by - 8 + sq, 2, 8);
    ctx.fillStyle = C.ant; ctx.fillRect(CX + 6, by - 12 + sq, 6, 5);
  }

  ArcadeKit.define('cuberun', {
    kind: 'canvas', W, H,
    title: '🟧 Кубик-бегун',
    intro: 'Тап — прыжок. Перепрыгивай кактусы, на ящики можно запрыгнуть. ⭐ над препятствиями — +2 очка. Трасса — 2 минуты. Первый тап — старт.',
    controls: 'Тап по полю, мышь или пробел / ↑ — прыжок. Нажал чуть раньше приземления — прыжок всё равно будет.',
    duelTitle: 'Одинаковая трасса у обоих',
    keys: { Space: 0, ArrowUp: 0, KeyW: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с до финиша' : 'Тап — старт и прыжок'),
    win: s => s.why === 'finish' || s.score >= 50,
    result: s => ({
      title: s.why === 'finish' ? '🏁 Финиш! Вся трасса' : s.score >= 50 ? '🔥 Отличный забег!' : '🌵 Ой, препятствие',
      text: 'препятствий: ' + s.passed + ' · ⭐ ' + s.stars,
    }),
    consts: { W, H, GY, CX, CS, GRAV, JUMP, FALL, BUF, V0, DV, VMAX, LIMIT, CW, CH, CRH, CRH2, RING, STAR, T_AIR },
  });
})();

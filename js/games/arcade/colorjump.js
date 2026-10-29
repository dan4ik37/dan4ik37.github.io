// ═══════════════════════════════════════
//  ИГРА «ЦВЕТНОЙ ПРЫЖОК» (T-140) — капля краски прыгает вверх сквозь цветные полосы: проходить можно только свой цвет. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440, мир едет вверх; скорости — единиц в секунду.
// Своё: препятствия — горизонтальные полосы из 4 цветов, которые едут вбок (каждая со своей скоростью и в свою сторону);
// цвет капли меняют кляксы краски между полосами (всегда на новый цвет); каждая 10-я клякса — радуга: следующую полосу
// можно пройти любым цветом, и она даёт 2 очка; на старте капля стоит на банке и ждёт первого тапа; забег — 2 минуты.
// Исправлено против прототипа: (1) переменная sw объявлялась после функций, которые её читают, а init подменялся на ходу —
// теперь всё состояние в одном объекте из create; (2) смена цвета брала Math.random — теперь rng (у соперников одинаковые
// цвета), и новый цвет всегда отличается от старого (в прототипе «смена» могла оставить тот же цвет); (3) движение и время —
// за кадр → в секунду (на 144 Гц прототип шёл в 2,4 раза быстрее); (4) каждый кадр перебирались 400 колец дважды — теперь
// кольцо из 8 полос рядом с каплей; (5) нажатие после проигрыша сразу начинало заново — итог ядра; (6) бесконечный подъём —
// теперь финиш через 2 минуты.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, BX = 160, R = 9, VIEW = 280;            // x капли, радиус; капля держится на 280 от верха поля
  const GRAV = 1080, JUMP = -360, FALL = 600, LIMIT = 120;
  const SP = 230, Y0 = -170, BT = 16, SEG = 80, SPL = 14;          // шаг полос, первая полоса, толщина, сегмент цвета; клякса
  const V0 = 50, DV = 4, VADD = 90, RAIN = 10;                     // скорость полос: старт, + за полосу, предел прибавки; радуга — каждая 10-я
  const RING = 8, MASK = RING - 1;
  const PAL = ['#ff4d6d', '#ffd43b', '#38d9a9', '#5c7cfa'];
  const C = { bg: '#15122a', dot: 'rgba(255,255,255,.06)', edge: 'rgba(0,0,0,.35)', can: '#8d8aa8', can2: '#5f5b7c', bad: '#ffffff', glow: 'rgba(255,255,255,.85)' };

  function add(s){
    const k = s.count++, j = k & MASK;
    s.by[j] = Y0 - k * SP;
    s.bo[j] = Math.floor(s.rng() * 320);
    s.bv[j] = (s.rng() < .5 ? -1 : 1) * (V0 + Math.min(VADD, DV * k)) * (.85 + s.rng() * .3);
    s.bc[j] = Math.floor(s.rng() * 4);
    const prev = k === 0 ? -1 : s.need[(k - 1) & MASK];
    let c = Math.floor(s.rng() * 3);
    if (c >= prev && prev >= 0) c++;                                  // новый цвет всегда другой
    s.need[j] = k === 0 ? Math.floor(s.rng() * 4) : c;
    s.spk[j] = k > 0 && k % RAIN === RAIN - 1 ? 1 : 0;                 // клякса под полосой k: 0 — цвет need[k], 1 — радуга
    s.spt[j] = k === 0 ? 1 : 0;
  }

  function create(rng){
    const s = { rng, y: 0, py: 0, vy: 0, cam: -VIEW, pcam: -VIEW, started: false, t: 0, col: 0, col0: 0, rainbow: false, next: 0, score: 0, rains: 0,
      over: false, why: '', badK: -1, snd: 0, first: 0, count: 0,
      by: new Float64Array(RING), bo: new Float64Array(RING), bv: new Float64Array(RING), bc: new Uint8Array(RING), need: new Uint8Array(RING),
      spk: new Uint8Array(RING), spt: new Uint8Array(RING) };
    while (s.count < 4) add(s);
    s.col = s.col0 = s.need[0];
    return s;
  }

  // цвет полосы k под центром капли в момент t
  function colorAt(s, j, t){
    let o = (s.bo[j] + s.bv[j] * t) % W; if (o < 0) o += W;
    let u = BX - o; if (u < 0) u += W;
    return ((u / SEG | 0) + s.bc[j]) & 3;
  }

  function input(s, e){
    if (s.over || (e.type !== T.DOWN && e.type !== T.KEY)) return;
    s.started = true;
    s.vy = JUMP;
    s.snd = 587 + 98 * s.col;
  }

  function step(s, dt){
    s.py = s.y; s.pcam = s.cam;
    if (!s.started) return;
    s.t += dt;
    if (s.t >= LIMIT) { s.over = true; s.why = 'finish'; s.snd = 'win'; return; }
    s.vy += GRAV * dt; if (s.vy > FALL) s.vy = FALL;
    s.y += s.vy * dt;
    for (let k = s.first; k < s.count; k++) {
      const j = k & MASK, y = s.by[j];
      // клякса под полосой k меняет цвет капли
      if (!s.spt[j] && Math.abs(s.y - (y + SP / 2)) < SPL + R) {
        s.spt[j] = 1;
        if (s.spk[j]) { s.rainbow = true; s.snd = 1319; } else { s.rainbow = false; s.col = s.need[j]; s.snd = 784; }
      }
      // полоса: пока капля её касается, цвет под центром капли должен совпасть
      if (Math.abs(s.y - y) < BT / 2 + R - 2 && !s.rainbow && colorAt(s, j, s.t) !== s.col) {
        s.over = true; s.why = 'color'; s.badK = k; s.snd = 'bad'; return;
      }
      if (k === s.next && s.y < y - BT / 2 - R) {
        s.next++;
        if (s.rainbow) { s.score += 2; s.rains++; s.rainbow = false; } else s.score++;
        if (!s.snd) s.snd = 'tick';
      }
    }
    if (s.y - R - s.cam > H) { s.over = true; s.why = 'fall'; s.snd = 'bad'; return; }
    if (s.y - VIEW < s.cam) s.cam = s.y - VIEW;
    while (s.first < s.count && s.by[s.first & MASK] - BT > s.cam + H + 40) s.first++;
    while (s.count - s.first < RING && s.by[(s.count - 1) & MASK] > s.cam - SP) add(s);
  }

  function draw(G, s, a){
    const ctx = G.ctx, cam = s.over ? s.cam : s.pcam + (s.cam - s.pcam) * a, y = s.over ? s.y : s.py + (s.y - s.py) * a;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.dot;
    const dy = (-cam * .3) % 60;
    for (let r = -1; r < 9; r++) for (let c = 0; c < 6; c++) ctx.fillRect(c * 60 + (r & 1) * 30 + 14, r * 60 + dy, 4, 4);
    const py = R - cam;   // банка краски — старт
    if (py < H) { ctx.fillStyle = C.can2; ctx.fillRect(BX - 22, py, 44, 30); ctx.fillStyle = C.can; ctx.fillRect(BX - 25, py, 50, 6); ctx.fillStyle = PAL[s.col0]; ctx.fillRect(BX - 18, py + 12, 36, 8); }
    const t = s.t;
    for (let k = s.first; k < s.count; k++) {
      const j = k & MASK, sy = s.by[j] - cam;
      if (sy > -30 && sy < H + 30) {
        let o = (s.bo[j] + s.bv[j] * t) % W; if (o < 0) o += W;
        for (let i = -4; i < 4; i++) {
          const x = o + i * SEG;
          if (x >= W || x + SEG <= 0) continue;
          ctx.fillStyle = PAL[(i + 4 + s.bc[j]) & 3];
          ctx.fillRect(x, sy - BT / 2, SEG, BT);
        }
        ctx.fillStyle = C.edge; ctx.fillRect(0, sy + BT / 2 - 3, W, 3);
        if (s.over && s.badK === k) { ctx.strokeStyle = C.bad; ctx.lineWidth = 3; ctx.strokeRect(1.5, sy - BT / 2 - 1.5, W - 3, BT + 3); }
      }
      const ky = s.by[j] + SP / 2 - cam;
      if (!s.spt[j] && ky > -20 && ky < H + 20) {
        if (s.spk[j]) {
          for (let c = 0; c < 4; c++) { ctx.fillStyle = PAL[c]; ctx.beginPath(); ctx.arc(BX + (c & 1 ? 7 : -7), ky + (c & 2 ? 7 : -7), 7, 0, 6.2832); ctx.fill(); }
        } else {
          ctx.fillStyle = PAL[s.need[j]];
          ctx.beginPath(); ctx.arc(BX, ky, 10, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(BX + 12, ky - 6, 4, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(BX - 11, ky + 7, 3.5, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(BX - 4, ky - 13, 3, 0, 6.2832); ctx.fill();
        }
      }
    }
    // капля: круг и кончик сверху; радужная — переливается
    const by = y - cam, col = s.rainbow ? ((G.now / 120) | 0) & 3 : s.col;
    ctx.fillStyle = PAL[col];
    ctx.beginPath(); ctx.arc(BX, by, R, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.moveTo(BX - 6, by - 6); ctx.lineTo(BX, by - R - 9); ctx.lineTo(BX + 6, by - 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.glow; ctx.fillRect(BX - 4, by - 3, 3, 3);
  }

  ArcadeKit.define('colorjump', {
    kind: 'canvas', W, H,
    title: '🎨 Цветной прыжок',
    intro: 'Тап — капля подпрыгивает. Проходи сквозь полосы только там, где их цвет совпадает с цветом капли. Кляксы меняют цвет, 🌈 радуга пропускает через любой. 2 минуты.',
    controls: 'Тап по полю, мышь или пробел / ↑ — прыжок. Упала вниз или не тот цвет — конец.',
    duelTitle: 'Одинаковые полосы и цвета у обоих',
    keys: { Space: 0, ArrowUp: 0, KeyW: 0 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.ceil(LIMIT - s.t) : -1),
    hud: s => (s.started ? '⏱ ' + Math.ceil(LIMIT - s.t) + ' с' : 'Тап — прыжок с банки'),
    win: s => s.score >= 30,
    result: s => ({
      title: s.why === 'finish' ? '🏁 Время! Отличный подъём' : s.score >= 30 ? '🎨 Мастер цвета!' : s.why === 'fall' ? '⬇️ Капля упала' : '🎨 Не тот цвет',
      text: 'полос: ' + s.next + (s.rains ? ' · 🌈 ' + s.rains : ''),
    }),
    consts: { W, H, BX, R, VIEW, GRAV, JUMP, FALL, LIMIT, SP, Y0, BT, SEG, SPL, V0, DV, VADD, RAIN, RING },
  });
})();

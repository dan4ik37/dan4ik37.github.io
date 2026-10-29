// ═══════════════════════════════════════
//  ИГРА «ЧЁРНЫЕ ПЛИТКИ» (T-140) — жми только чёрные плитки, по порядку снизу вверх. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md). Поле 320×440: 4 дорожки по 80, видно 4 ряда по 110. Скорость — в рядах
// за секунду и растёт с каждой плиткой. Своё: ⭐ золотая плитка — 3 очка; каждое нажатие — нота (пентатоника).
// Исправлено против прототипа: (1) игра кончалась сразу после первого нажатия — нижняя плитка стояла у самого края поля,
// и первый же кадр считал её пропущенной, а само нажатие «Старт» не засчитывалось; теперь первая плитка «СТАРТ» стоит во
// втором ряду, поле едет только после неё и она засчитывается; до неё нажатия мимо прощаются; (2) нажатие проверяет РЯД под
// пальцем, а не только дорожку: белая клетка в текущем ряду или выше — конец, уже пройденные ряды и следующие чёрные плитки
// не наказываются (запас по высоте — TOL); (3) скорость — в секунду (на экране 144 Гц прототип шёл в 2,4 раза быстрее).
// Соревнование: общий seed — одинаковые дорожки и ⭐ у обоих.
(() => {
  const T = ArcadeKit.T;
  const W = 320, H = 440, COLS = 4, CW = W / COLS, RH = H / 4, RING = 16, MASK = RING - 1;
  const V0 = 1.8, DV = .025, VMAX = 6.5;   // рядов в секунду: на старте, прибавка за плитку, предел
  const TOL = .22;                         // запас попадания по высоте (доля ряда): палец чуть ниже/выше плитки — засчитано
  const MISS = .5;                         // плитка ушла за нижний край на полряда — пропущена
  const NOTES = [523, 587, 659, 784, 880, 784, 659, 587];   // Гц, целые: s.snd без «упакованных» дробных чисел
  const C = { lane: '#e9ebf2', line: 'rgba(20,20,32,.13)', tile: '#14141c', done: 'rgba(20,20,32,.16)', gold: '#ffc233', bad: '#ff2d55', ink: '#fff', goldInk: '#5a3b00' };

  function fill(s){
    while (s.top < s.pos + 6) {
      const r = ++s.top, i = r & MASK;
      s.col[i] = Math.floor(s.rng() * COLS);
      s.hit[i] = 0;
      s.gold[i] = r >= 12 && s.rng() < .08 ? 1 : 0;
    }
  }

  function create(rng){
    const s = { rng, pos: -1, prev: -1, spd: 0, top: -1, next: 0, started: false, score: 0, hits: 0, golds: 0, t: 0,
      over: false, why: '', badC: -1, badR: 0, snd: 0,
      col: new Int8Array(RING), hit: new Uint8Array(RING), gold: new Uint8Array(RING) };
    fill(s);
    return s;
  }

  function hit(s){
    const i = s.next & MASK;
    s.hit[i] = 1; s.next++; s.hits++;
    if (s.gold[i]) { s.score += 3; s.golds++; s.snd = 1047; }
    else { s.score += 1; s.snd = NOTES[s.hits % NOTES.length]; }
    s.started = true;
  }
  function lose(s, c, r, why){ s.over = true; s.badC = c; s.badR = r; s.why = why; s.snd = 'bad'; }

  function input(s, e){
    if (s.over) return;
    let c, u;
    if (e.type === T.KEY) { c = e.k; u = s.next + .5; }   // клавиша — дорожка следующего ряда
    else if (e.type === T.DOWN) { c = Math.min(COLS - 1, Math.max(0, Math.floor(e.x / CW))); u = s.pos + (H - e.y) / RH; }
    else return;
    const n = s.next;
    if (c === s.col[n & MASK] && u >= n - TOL && u < n + 1 + TOL) return hit(s);
    const r = Math.floor(u);
    if (r < n || !s.started) return;                    // пройденные ряды и промахи до «СТАРТ» — не считаются
    if (r <= s.top && c === s.col[r & MASK]) return;     // следующая чёрная плитка не по порядку — без наказания
    lose(s, c, r, 'white');
  }

  function step(s, dt){
    s.prev = s.pos;
    if (!s.started) return;
    s.t += dt;
    s.spd = Math.min(VMAX, V0 + DV * s.hits);
    s.pos += s.spd * dt;
    fill(s);
    if (s.next - s.pos < -MISS) lose(s, s.col[s.next & MASK], s.next, 'miss');
  }

  function draw(G, s, a){
    const ctx = G.ctx, p = s.over ? s.pos : s.prev + (s.pos - s.prev) * a;
    ctx.fillStyle = C.lane; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.line;
    for (let c = 1; c < COLS; c++) ctx.fillRect(c * CW - .5, 0, 1, H);
    const f = Math.floor(p), r0 = f < 0 ? 0 : f, r1 = Math.min(s.top, f + 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let r = r0; r <= r1; r++) {
      const i = r & MASK, y = H - (r + 1 - p) * RH, x = s.col[i] * CW;
      const missed = s.over && s.why === 'miss' && r === s.badR;
      ctx.fillStyle = missed ? C.bad : s.hit[i] ? C.done : s.gold[i] ? C.gold : C.tile;
      ctx.fillRect(x + 2, y + 2, CW - 4, RH - 4);
      if (s.gold[i] && !s.hit[i]) { ctx.fillStyle = C.goldInk; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.fillText('★', x + CW / 2, y + RH / 2); }
      if (r === 0 && !s.started) {
        // плитка «СТАРТ» мягко пульсирует рамкой
        ctx.strokeStyle = C.gold; ctx.lineWidth = 3 + 2 * Math.sin(G.now / 160);
        ctx.strokeRect(x + 4, y + 4, CW - 8, RH - 8);
        ctx.fillStyle = C.ink; ctx.font = 'bold 15px Montserrat, system-ui, sans-serif'; ctx.fillText('СТАРТ', x + CW / 2, y + RH / 2);
      }
    }
    if (s.over && s.why === 'white' && s.badC >= 0) {
      ctx.fillStyle = C.bad;
      ctx.fillRect(s.badC * CW + 2, H - (s.badR + 1 - p) * RH + 2, CW - 4, RH - 4);
    }
    // счёт крупно сверху (строка пересобирается только когда меняется — без мусора на кадр)
    if (G.sc !== s.score) { G.sc = s.score; G.scT = String(s.score); }
    if (s.started || s.over) {
      ctx.font = 'bold 34px Montserrat, system-ui, sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(G.scT, W / 2, 34);
      ctx.fillStyle = C.bad; ctx.fillText(G.scT, W / 2, 34);
    }
  }

  ArcadeKit.define('tiles', {
    kind: 'canvas', W, H,
    title: '⬛ Чёрные плитки',
    intro: 'Жми только чёрные плитки — по порядку, снизу вверх. Белая клетка или пропущенная плитка — конец. ⭐ золотая — 3 очка. Поле поедет после плитки «СТАРТ».',
    controls: 'Пальцем или мышью — по чёрным плиткам. На клавиатуре — D F J K (или 1 2 3 4) по дорожкам.',
    duelTitle: 'Одинаковые плитки у обоих',
    keys: { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 },
    create, input, step, draw,
    hudKey: s => (s.started ? Math.round(s.spd / V0 * 10) : -1),
    hud: s => (s.started ? '⚡ скорость ×' + (s.spd / V0).toFixed(1) : 'Жми плитку «СТАРТ»'),
    win: s => s.score >= 100,
    result: s => ({
      title: s.score >= 200 ? '🔥 Пальцы-молнии!' : s.score >= 100 ? '🎉 Отличный ритм!' : s.why === 'miss' ? '⬇️ Плитка ушла вниз' : '⬜ Это была белая',
      text: 'плиток: ' + s.hits + (s.golds ? ' · ⭐ ' + s.golds : ''),
    }),
    consts: { W, H, COLS, CW, RH, RING, V0, DV, VMAX, TOL, MISS },
  });
})();

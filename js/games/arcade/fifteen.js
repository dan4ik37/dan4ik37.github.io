// ═══════════════════════════════════════
//  ИГРА «ПЯТНАШКИ» (T-140) — собери плитки по порядку: 3 доски (3×3, 3×3, 4×4) за 3 минуты. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — кнопки (DOM). Время — в шагах (60 в секунду).
// Своё: плитки окрашены по своему ряду (видно, куда какая едет), плитка на месте подсвечена; нажатие на плитку в одной
// линии с пустой клеткой сдвигает сразу всю линию (один ход); три доски на время.
// Очки: доска — 100; все три — бонус 2 за каждую оставшуюся секунду; время вышло — +3 за каждую плитку на своём месте.
// Исправлено против прототипа: перемешивание через Math.random → rng (у соперников одинаковые доски, доска никогда не
// бывает собрана с самого начала); «меньше ходов — лучше» и партия без конца → общий счёт (больше — лучше) и предел
// времени; добавлена клавиатура (стрелки / WASD — плитка едет в пустую клетку).
(() => {
  const T = ArcadeKit.T;
  const BOARDS = [[3, 30], [3, 50], [4, 110]];   // [сторона, длина перемешивания (ходов от собранной доски)]
  const TIME = 180 * 60, WAIT = 45, MAXP = 128;  // шагов: 3 минуты, пауза «собрано»; длина пути перемешивания
  const ROWC = ['#ff5d7a', '#ffb23d', '#3fd6a4', '#5b8cff'];   // цвет плитки — её ряд в собранной доске

  const solvedAt = (a, o, N) => { for (let i = 0; i < N; i++) if (a[o + i] !== (i + 1) % N) return false; return true; };

  // доска b: случайная прогулка пустой клетки от собранной доски (без шага назад); путь — для проверки и ботов
  function walk(s, b){
    const n = BOARDS[b][0], N = n * n, len = BOARDS[b][1], a = s.a0, o = b * 16, P = s.p0, po = b * MAXP, nb = s.nb;
    do {
      for (let i = 0; i < N; i++) a[o + i] = (i + 1) % N;
      let z = N - 1, prev = -1;
      P[po] = z;
      for (let k = 1; k <= len; k++) {
        const x = z % n, y = (z / n) | 0;
        let c = 0;
        if (x > 0 && z - 1 !== prev) nb[c++] = z - 1;
        if (x < n - 1 && z + 1 !== prev) nb[c++] = z + 1;
        if (y > 0 && z - n !== prev) nb[c++] = z - n;
        if (y < n - 1 && z + n !== prev) nb[c++] = z + n;
        const j = nb[Math.floor(s.rng() * c)];
        a[o + z] = a[o + j]; a[o + j] = 0; prev = z; z = j;
        P[po + k] = z;
      }
    } while (solvedAt(a, o, N));
  }

  function load(s, b){
    const n = BOARDS[b][0], N = n * n, o = b * 16, po = b * MAXP;
    s.board = b; s.n = n; s.moves = 0; s.plen = BOARDS[b][1];
    for (let i = 0; i < N; i++) { s.a[i] = s.a0[o + i]; if (!s.a[i]) s.z = i; }
    for (let i = 0; i <= s.plen; i++) s.path[i] = s.p0[po + i];
    s.v++;
  }

  function create(rng){
    const s = { rng, board: 0, n: 3, z: 0, moves: 0, plen: 0, score: 0, solved: 0, bonus: 0, part: 0, left: TIME, wait: 0,
      over: false, v: 0, snd: 0,
      a: new Uint8Array(16), a0: new Uint8Array(16 * BOARDS.length), path: new Int8Array(MAXP), p0: new Int8Array(MAXP * BOARDS.length), nb: new Int8Array(4) };
    for (let b = 0; b < BOARDS.length; b++) walk(s, b);
    load(s, 0);
    return s;
  }

  function placed(s){ const N = s.n * s.n; let c = 0; for (let i = 0; i < N - 1; i++) if (s.a[i] === i + 1) c++; return c; }

  // плитка k едет в пустую клетку; если между ними несколько плиток одной линии — едет вся линия (один ход)
  function slide(s, k){
    const n = s.n, z = s.z, a = s.a;
    if (!(k >= 0 && k < n * n) || k === z) return false;
    let d;
    if (((k / n) | 0) === ((z / n) | 0)) d = k > z ? 1 : -1;
    else if (k % n === z % n) d = k > z ? n : -n;
    else return false;
    for (let p = z; p !== k; p += d) a[p] = a[p + d];
    a[k] = 0; s.z = k;
    return true;
  }

  function input(s, e){
    if (s.over || s.wait) return;
    let k = -1;
    if (e.type === T.PICK) k = e.k;
    else if (e.type === T.KEY) {   // 0 ↑ 1 ↓ 2 ← 3 →: плитка едет в эту сторону (в пустую клетку)
      const n = s.n, z = s.z, x = z % n, y = (z / n) | 0;
      if (e.k === 0 && y < n - 1) k = z + n;
      else if (e.k === 1 && y > 0) k = z - n;
      else if (e.k === 2 && x < n - 1) k = z + 1;
      else if (e.k === 3 && x > 0) k = z - 1;
    } else return;
    if (!slide(s, k)) return;
    s.moves++; s.v++;
    s.snd = 440 + 40 * (s.moves % 6);
    if (!solvedAt(s.a, 0, s.n * s.n)) return;
    s.solved++; s.score += 100; s.wait = WAIT; s.snd = 'ok';
  }

  function step(s){
    if (s.over) return;
    if (s.wait) {
      if (--s.wait) return;
      if (s.board + 1 < BOARDS.length) { load(s, s.board + 1); return; }
      s.bonus = 2 * Math.ceil(s.left / 60);
      s.score += s.bonus; s.over = true; s.snd = 'win'; s.v++;
      return;
    }
    if (--s.left <= 0) { s.left = 0; s.part = 3 * placed(s); s.score += s.part; s.over = true; s.snd = 'bad'; s.v++; }
  }

  const CSS = '.ff{display:flex;flex-direction:column;align-items:center;gap:.6rem;padding:.9rem .6rem .8rem;border-radius:14px;background:linear-gradient(160deg,#1a1630,#0f1424)}'
    + '.ff-g{width:100%;max-width:360px;display:grid;grid-template-columns:repeat(var(--n),1fr);gap:6px;padding:6px;border-radius:12px;background:#0a0b16}'
    + '.ff-c{aspect-ratio:1;border:0;border-radius:10px;padding:0;cursor:pointer;font:800 clamp(20px,7vw,34px) Montserrat,system-ui,sans-serif;color:#141020;'
    + 'background:var(--c,#888);box-shadow:inset 0 -5px 0 rgba(0,0,0,.22);touch-action:manipulation;transition:transform .08s}'
    + '.ff-c.gap{background:transparent;box-shadow:inset 0 0 0 2px rgba(255,255,255,.06);cursor:default}'
    + '.ff-c.ok{box-shadow:inset 0 -5px 0 rgba(0,0,0,.22),0 0 0 3px #fff}'
    + '.ff-c:active{transform:scale(.95)}.ff-c:focus-visible{outline:3px solid #7dd3fc;outline-offset:2px}'
    + '.ff.done .ff-c{filter:saturate(1.3) brightness(1.08)}'
    + '.ff-msg{font-size:.8rem;color:#d9d5f5;min-height:1.2em;font-variant-numeric:tabular-nums}'
    + 'body.low .ff-c{transition:none}';

  function build(G){
    if (!document.getElementById('ffCss')) { const st = document.createElement('style'); st.id = 'ffCss'; st.textContent = CSS; document.head.appendChild(st); }
    G.host.innerHTML = '<div class="ff"><div class="ff-g"></div><div class="ff-msg"></div></div>';
    G.box = G.host.firstChild;
    G.grid = G.box.querySelector('.ff-g');
    G.msg = G.box.querySelector('.ff-msg');
    G.n = -1; G.board = -1; G.cells = null;
  }

  function draw(G, s){
    const n = s.n, N = n * n;
    if (G.n !== n || G.board !== s.board) {
      G.n = n; G.board = s.board;
      G.grid.style.setProperty('--n', n);
      let h = '';
      for (let i = 0; i < N; i++) h += '<button type="button" class="ff-c" data-k="' + i + '"></button>';
      G.grid.innerHTML = h;
      G.cells = G.grid.children;
    }
    for (let i = 0; i < N; i++) {
      const b = G.cells[i], v = s.a[i];
      b.textContent = v ? String(v) : '';
      b.classList.toggle('gap', !v);
      b.classList.toggle('ok', v === i + 1);
      if (v) b.style.setProperty('--c', ROWC[((v - 1) / n) | 0]);
      b.setAttribute('aria-label', v ? 'Плитка ' + v : 'Пустая клетка');
    }
    G.box.classList.toggle('done', !!s.wait);
    G.msg.textContent = s.wait ? 'Доска ' + (s.board + 1) + ' собрана! +100 · ходов: ' + s.moves
      : s.over ? (s.solved === BOARDS.length ? 'Все доски собраны! Бонус за время: +' + s.bonus : 'Время вышло: плиток на месте +' + s.part)
        : 'Собери по порядку: 1, 2, 3… пустая клетка — в конце';
  }

  const clock = n => { const sec = Math.ceil(n / 60); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

  ArcadeKit.define('fifteen', {
    kind: 'dom', W: 320, H: 380, maxW: 400,
    title: '🔢 Пятнашки',
    intro: 'Двигай плитки в пустую клетку и собери их по порядку. Три доски за 3 минуты: 3×3, ещё 3×3 и 4×4. Цвет плитки — её ряд.',
    controls: 'Нажми плитку рядом с пустой клеткой — или любую в той же линии, тогда сдвинется вся линия. Клавиши: стрелки или WASD.',
    duelTitle: 'Одинаковые доски у обоих',
    keys: { ArrowUp: 0, KeyW: 0, ArrowDown: 1, KeyS: 1, ArrowLeft: 2, KeyA: 2, ArrowRight: 3, KeyD: 3 },
    create, input, step, draw, build,
    hudKey: s => s.board * 1e7 + Math.min(9999, s.moves) * 1000 + Math.ceil(s.left / 60),
    hud: s => '🧩 ' + (s.board + 1) + '/' + BOARDS.length + ' · ходов ' + s.moves + ' · ⏱ ' + clock(s.left),
    win: s => s.solved === BOARDS.length,
    result: s => ({
      title: s.solved === BOARDS.length ? '🏆 Все доски собраны!' : s.solved ? '⏰ Время вышло' : '⏰ Время вышло — попробуй ещё',
      text: 'досок: ' + s.solved + '/' + BOARDS.length + (s.bonus ? ' · за время +' + s.bonus : s.part ? ' · плитки на месте +' + s.part : ''),
    }),
    consts: { BOARDS, TIME, WAIT, MAXP },
  });
})();

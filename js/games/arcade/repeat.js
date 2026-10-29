// ═══════════════════════════════════════
//  ИГРА «ПОВТОРИ МЕЛОДИЮ» (T-140) — послушай мелодию на 4 клавишах и повтори её; каждый раунд — на ноту длиннее. Одиночная или «⚔️ Соревнование»
// ═══════════════════════════════════════
// Ядро — js/games/arcade/core.js (docs/ARCADE.md), поле — 4 клавиши-кнопки (DOM). Время — в шагах (60 в секунду).
// Своё: 3 сердечка — ошибка не конец, мелодия звучит ещё раз (тот же раунд); с 6-го раунда мелодия играет всё быстрее;
// клавиши — ноты пентатоники (до, ре, ми, соль), у каждой свой знак (не только цвет).
// Очки: каждая новая верная нота +1, вся мелодия раунда +5. Конец — 3 ошибки (или 6 секунд без нажатия — тоже ошибка),
// или пройдены все 40 раундов.
// Исправлено против прототипа: мелодия из Math.random → rng (у соперников одна мелодия); показ на setTimeout/async
// (гонки при быстрых нажатиях и закрытии) → счёт шагов; после ошибки нельзя было начать заново без «Старт» → оверлей ядра
// «↻ Ещё раз»; ожидание хода без конца → 6 с без нажатия = ошибка; свой AudioContext → общий звук ядра.
(() => {
  const T = ArcadeKit.T;
  const MAXR = 40, HEARTS = 3, IDLE = 6 * 60, FIRST = 50, NEXT = 40, FLASH = 16;   // шагов
  const NOTES = [262, 294, 330, 392];   // Гц (целые): до, ре, ми, соль
  const SIGN = ['●', '▲', '■', '★'], COL = ['#ff4d6d', '#ffb020', '#22c58b', '#4d7cff'];

  // длительность ноты и паузы показа (шагов): с 6-го раунда быстрее
  const onT = r => Math.max(14, 30 - Math.max(0, r - 5) * 2);
  const offT = r => Math.max(6, 12 - Math.max(0, r - 5));

  function create(rng){
    const s = { rng, round: 1, phase: 0, t: FIRST, i: 0, pos: 0, got: 0, hearts: HEARTS, idle: 0, lit: -1, litT: 0, bad: -1, err: 0,
      score: 0, rounds: 0, over: false, why: '', v: 0, snd: 0, seq: new Uint8Array(MAXR) };
    for (let i = 0; i < MAXR; i++) s.seq[i] = Math.floor(rng() * 4);
    return s;
  }
  // phase: 0 — пауза перед показом, 1 — показ (i — нота, t — шаги до следующего события), 2 — ход игрока, 3 — пауза «верно»

  function show(s, wait){ s.phase = 0; s.t = wait; s.i = 0; s.pos = 0; s.idle = 0; s.v++; }

  function miss(s, k, why){
    s.hearts--; s.err = 1; s.bad = k; s.lit = k; s.litT = FLASH; s.snd = 'bad'; s.v++;
    if (s.hearts <= 0) { s.over = true; s.why = why; return; }
    show(s, NEXT + 20);   // тот же раунд ещё раз
  }

  function input(s, e){
    if (s.over || s.phase !== 2) return;   // во время показа нажатия не считаются (и не ошибка)
    let k;
    if (e.type === T.PICK || e.type === T.KEY) k = e.k; else return;
    if (!(k >= 0 && k < 4)) return;
    s.idle = 0;
    if (k !== s.seq[s.pos]) return miss(s, k, 'wrong');
    s.lit = k; s.litT = FLASH; s.bad = -1; s.snd = NOTES[k];
    s.pos++;
    if (s.pos > s.got) { s.got = s.pos; s.score++; }
    s.v++;
    if (s.pos < s.round) return;
    // мелодия раунда сыграна
    s.score += 5; s.rounds++; s.got = 0;
    if (s.round >= MAXR) { s.over = true; s.why = 'all'; s.snd = 'win'; return; }
    s.round++; s.phase = 3; s.t = NEXT; s.snd = 'ok';
  }

  function step(s){
    if (s.over) return;
    if (s.litT && !--s.litT) { s.lit = -1; s.v++; }
    if (s.phase === 2) { if (++s.idle >= IDLE) miss(s, -1, 'idle'); return; }
    if (--s.t > 0) return;
    if (s.phase === 0 || s.phase === 3) { s.phase = 1; s.i = 0; s.t = 1; s.bad = -1; s.err = 0; s.v++; return; }
    // показ: нота i загорается на onT шагов, потом пауза offT
    if (s.lit < 0) {
      if (s.i >= s.round) { s.phase = 2; s.pos = 0; s.idle = 0; s.v++; return; }
      const k = s.seq[s.i++];
      s.lit = k; s.litT = onT(s.round); s.snd = NOTES[k]; s.t = onT(s.round) + offT(s.round); s.v++;
    } else s.t = 1;
  }

  const CSS = '.rp{display:flex;flex-direction:column;align-items:center;gap:.7rem;padding:1rem .7rem .9rem;border-radius:14px;background:radial-gradient(circle at 50% 0,#2a1d4d,#120e22 70%)}'
    + '.rp-hearts{font-size:1.1rem;letter-spacing:.2em;min-height:1.4em}'
    + '.rp-g{width:100%;max-width:340px;display:grid;grid-template-columns:1fr 1fr;gap:12px}'
    + '.rp-k{aspect-ratio:1.15;border:0;border-radius:20px;padding:0;cursor:pointer;background:var(--c);opacity:.42;filter:saturate(.8);'
    + 'font:800 clamp(26px,9vw,44px) system-ui,sans-serif;color:rgba(0,0,0,.35);box-shadow:inset 0 -7px 0 rgba(0,0,0,.25);touch-action:manipulation;transition:opacity .08s,transform .08s}'
    + '.rp-k.on{opacity:1;filter:saturate(1.15) brightness(1.15);transform:scale(1.04);color:rgba(255,255,255,.9);box-shadow:0 0 26px var(--c),inset 0 -7px 0 rgba(0,0,0,.2)}'
    + '.rp-k.bad{opacity:1;background:#3a0f1a;color:#ff4d6d;box-shadow:0 0 0 4px #ff4d6d}'
    + '.rp.turn .rp-k{opacity:.75}.rp.turn .rp-k.on{opacity:1}'
    + '.rp-k:focus-visible{outline:3px solid #7dd3fc;outline-offset:3px}'
    + '.rp-msg{font-size:.85rem;color:#e2dcff;min-height:1.3em;font-variant-numeric:tabular-nums}'
    + 'body.low .rp-k{transition:none}';

  function build(G){
    if (!document.getElementById('rpCss')) { const st = document.createElement('style'); st.id = 'rpCss'; st.textContent = CSS; document.head.appendChild(st); }
    let h = '<div class="rp"><div class="rp-hearts"></div><div class="rp-g">';
    for (let k = 0; k < 4; k++) h += '<button type="button" class="rp-k" data-k="' + k + '" style="--c:' + COL[k] + '" aria-label="Нота ' + (k + 1) + '">' + SIGN[k] + '</button>';
    G.host.innerHTML = h + '</div><div class="rp-msg"></div></div>';
    G.box = G.host.firstChild;
    G.keys = G.box.querySelectorAll('.rp-k');
    G.hearts = G.box.querySelector('.rp-hearts');
    G.msg = G.box.querySelector('.rp-msg');
  }

  function draw(G, s){
    for (let k = 0; k < 4; k++) {
      G.keys[k].classList.toggle('on', s.lit === k && s.bad !== k);
      G.keys[k].classList.toggle('bad', s.bad === k && s.lit === k);
    }
    G.box.classList.toggle('turn', s.phase === 2 && !s.over);
    G.hearts.textContent = '❤️'.repeat(Math.max(0, s.hearts)) + '🤍'.repeat(HEARTS - Math.max(0, s.hearts));
    G.msg.textContent = s.over ? (s.why === 'all' ? 'Все ' + MAXR + ' раундов! Ты — живой метроном 🎼' : 'Мелодия ушла… раундов: ' + s.rounds)
      : s.phase === 2 ? 'Твой ход: ' + s.pos + ' / ' + s.round
        : s.phase === 3 ? 'Верно! +5 🎉'
          : s.err ? 'Ошибка — слушай ещё раз' : 'Слушай…';
  }

  ArcadeKit.define('repeat', {
    kind: 'dom', W: 320, H: 380, maxW: 400,
    title: '🎹 Повтори мелодию',
    intro: 'Слушай и смотри, какие клавиши загораются, потом повтори мелодию. Каждый раунд — на ноту длиннее. 3 сердечка: ошибка — мелодия прозвучит ещё раз.',
    controls: 'Нажимай клавиши-кнопки. На клавиатуре — D F J K (или 1 2 3 4). 6 секунд без нажатия — тоже ошибка.',
    duelTitle: 'Одна мелодия у обоих',
    keys: { KeyD: 0, KeyF: 1, KeyJ: 2, KeyK: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 },
    create, input, step, draw, build,
    hudKey: s => s.round * 100 + s.phase * 10 + s.hearts,
    hud: s => '🎼 раунд ' + s.round + (s.phase === 2 ? ' · твой ход' : ' · слушай'),
    win: s => s.rounds >= 10,
    result: s => ({
      title: s.why === 'all' ? '🏆 Все мелодии!' : s.rounds >= 15 ? '🎼 Абсолютный слух!' : s.rounds >= 10 ? '🎉 Отличная память!' : '🎵 Мелодия ушла',
      text: 'раундов: ' + s.rounds,
    }),
    consts: { MAXR, HEARTS, IDLE, FIRST, NEXT, FLASH, onT, offT },
  });
})();

// «Повтори мелодию» (js/games/arcade/repeat.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
module.exports = {
  // повторяет мелодию по ноте в gap шагов; с раунда upTo нарочно ошибается (3 ошибки — конец партии)
  bot(K, spec, gap = 14, upTo = 12){
    const T = K.T;
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || s.phase !== 2 || k - last < gap) return;
      last = k;
      const n = s.seq[s.pos];
      push(T.PICK, 0, 0, s.round >= upTo ? (n + 1) % 4 : n);
    };
  },
  maxMs: 240000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const key = (s, k) => { ev.type = T.KEY; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const toTurn = s => { let n = 0; while (s.phase !== 2 && !s.over && n < 100000) { spec.step(s, K.STEP, null); n++; } return n; };
    const play = s => { for (let i = 0; i < s.round; i++) pick(s, s.seq[i]); };

    let s = spec.create(K.rng(41));
    ok(s.phase === 0 && s.round === 1 && !s.over, 'repeat: старт — пауза перед показом, раунд 1');
    // показ раунда 1: пауза FIRST, одна нота onT + offT; нажатия во время показа не считаются и не ошибка
    stepN(s, C.FIRST + 3);
    ok(s.phase === 1 && s.lit === s.seq[0], 'repeat: нота показа загорелась', { phase: s.phase, lit: s.lit });
    pick(s, (s.seq[0] + 1) % 4);
    ok(s.hearts === C.HEARTS && s.score === 0, 'repeat: нажатие во время показа — без ошибки');
    const n1 = toTurn(s) + C.FIRST + 3;
    ok(s.phase === 2 && n1 === C.FIRST + 1 + C.onT(1) + C.offT(1), 'repeat: ход игрока — после показа (по шагам)', { n1 });
    pick(s, s.seq[0]);
    ok(s.score === 6 && s.rounds === 1 && s.round === 2 && s.phase === 3, 'repeat: раунд 1 верно — +1 нота +5', { score: s.score });
    // раунды 2…5 без ошибок: очки = Σ r + 5 × r
    for (let r = 2; r <= 5; r++) { toTurn(s); play(s); }
    ok(s.rounds === 5 && s.score === 15 + 25 && s.hearts === 3, 'repeat: 5 раундов — 15 нот + 25', { score: s.score });
    // ошибка на 3-й ноте раунда 6: −❤️, тот же раунд звучит снова; повтор уже сыгранных нот очков не даёт
    toTurn(s);
    pick(s, s.seq[0]); pick(s, s.seq[1]);
    const sc = s.score;
    pick(s, (s.seq[2] + 1) % 4);
    ok(s.hearts === 2 && s.round === 6 && s.phase === 0 && !s.over && s.score === sc, 'repeat: ошибка — минус сердечко, тот же раунд заново', { hearts: s.hearts, phase: s.phase });
    toTurn(s);
    pick(s, s.seq[0]); pick(s, s.seq[1]);
    ok(s.score === sc, 'repeat: повтор нот до места ошибки — без новых очков');
    pick(s, s.seq[2]);
    ok(s.score === sc + 1, 'repeat: новая нота дальше места ошибки — +1');
    for (let i = 3; i < 6; i++) pick(s, s.seq[i]);
    ok(s.rounds === 6 && s.score === sc + 4 + 5, 'repeat: раунд 6 доигран после ошибки', { score: s.score });
    // клавиши D F J K — те же клавиши
    toTurn(s);
    for (let i = 0; i < s.round; i++) key(s, s.seq[i]);
    ok(s.rounds === 7, 'repeat: клавиатура (D F J K) — те же ноты');
    // 6 секунд без нажатия — ошибка; 3 ошибки — конец
    toTurn(s);
    stepN(s, C.IDLE);
    ok(s.hearts === 1 && !s.over, 'repeat: 6 с без нажатия — ошибка (минус сердечко)', { hearts: s.hearts });
    toTurn(s); pick(s, (s.seq[0] + 1) % 4);
    ok(s.over && s.why === 'wrong' && s.hearts === 0 && !spec.win(s), 'repeat: третья ошибка — конец партии');
    // темп: с 6-го раунда быстрее
    ok(C.onT(1) === 30 && C.onT(5) === 30 && C.onT(10) === 20 && C.onT(40) === 14 && C.offT(40) === 6, 'repeat: темп растёт с 6-го раунда');
    // все раунды — конец с победой; бездействие кончает партию само
    s = spec.create(K.rng(42));
    for (let r = 1; r <= C.MAXR && !s.over; r++) { toTurn(s); play(s); }
    ok(s.over && s.why === 'all' && s.rounds === C.MAXR && s.score === C.MAXR * (C.MAXR + 1) / 2 + 5 * C.MAXR && spec.win(s), 'repeat: все 40 раундов — конец, максимум очков', { score: s.score });
    s = spec.create(K.rng(43)); stepN(s, 60 * 60);
    ok(s.over && s.why === 'idle' && s.score === 0, 'repeat: без нажатий партия кончается сама (3 × 6 с)');
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по нужной клавише в свой ход; stopAfter — после стольких раундов бросает (ждёт)
  e2e: {
    bot: (gap, stopAfter = 9) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.repeat._test.cur(); if (!s || s.over || s.phase !== 2 || s.rounds >= ${stopAfter}) return;
      document.querySelector('.rp-k[data-k="' + s.seq[s.pos] + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 180, stopB: 2,
    endByStop: false,    // бот A после 9 раундов ждёт — 3 × 6 с без нажатия кончают партию
    endMs: 90000,
    field: 'seq',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.rounds === 9 && ${cur}.why === 'idle'`), 'repeat: бот прошёл 9 раундов, потом бездействие кончило партию'); },
  },
};

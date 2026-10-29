// «Чёрные плитки» (js/games/arcade/tiles.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// Свой файл у каждой мини-игры: scripts/arcade/<id>.cjs (docs/ARCADE.md) — общие тест-скрипты не правятся.
module.exports = {
  // gap — не чаще одного нажатия за gap шагов (10 → 6 нажатий в секунду: на скорости выше 6 рядов/с бот не успевает и проигрывает)
  bot(K, spec, gap = 10){
    const C = spec.consts, T = K.T;
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      const n = s.next, u = n + .5 - s.pos;
      if (u < 0 || u > 3.6) return;
      push(T.DOWN, (s.col[n & (C.RING - 1)] + .5) * C.CW, C.H - u * C.RH, 0);
      last = k;
    };
  },
  maxMs: 240000,
  garbage: { gap: 9, ms: 30 * 60 * 1000 },   // 9 → 6,7 нажатия в секунду: бот не проигрывает, полчаса игры
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 };
    const tapAt = (s, c, u) => { ev.type = T.DOWN; ev.x = (c + .5) * C.CW; ev.y = C.H - (u - s.pos) * C.RH; spec.input(s, ev); };   // u — высота в рядах (абсолютная)
    const key = (s, c) => { ev.type = T.KEY; ev.k = c; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const colOf = (s, r) => s.col[r & (C.RING - 1)];
    const white = (s, r) => (colOf(s, r) + 1) % C.COLS;

    // баг владельца: «нажал — сразу конец». Нажатие на «СТАРТ» засчитано, игра идёт, пропуск — не раньше чем через ~1,2 с
    let s = spec.create(K.rng(11));
    ok(!s.started && s.pos === -1 && s.next === 0, 'tiles: старт — первая плитка во втором ряду, поле стоит');
    stepN(s, 120);
    ok(!s.over && s.pos === -1, 'tiles: до «СТАРТ» поле не едет и игра не кончается (2 с)');
    tapAt(s, white(s, 0), .5);
    ok(!s.over && !s.started, 'tiles: промах по белому до «СТАРТ» прощается');
    tapAt(s, colOf(s, 0), .5);
    ok(s.started && s.score === 1 && !s.over, 'tiles: нажатие на «СТАРТ» засчитано (+1), игра идёт', { score: s.score, over: s.over });
    stepN(s, 1);
    ok(!s.over, 'tiles: первый шаг после старта — не конец (баг прототипа: нижняя плитка у края считалась пропущенной)');
    let n = 1; while (!s.over) { spec.step(s, K.STEP, null); n++; }
    ok(s.why === 'miss' && n >= 70 && n <= 90, 'tiles: без нажатий — пропуск через ~1,3 с, а не сразу', { why: s.why, steps: n });

    // нажатие проверяет ряд, а не только дорожку
    s = spec.create(K.rng(12)); tapAt(s, colOf(s, 0), .5);
    tapAt(s, colOf(s, 1), .85);   // ниже плитки на 0,15 ряда (в запасе TOL) — попадание
    ok(s.score === 2 && !s.over, 'tiles: палец чуть ниже плитки (в запасе) — засчитано');
    const r3 = 3, c3 = colOf(s, r3);
    if (c3 !== colOf(s, 2)) { tapAt(s, c3, r3 + .5); ok(!s.over && s.score === 2, 'tiles: чёрная плитка не по порядку — без наказания и без очков'); }
    tapAt(s, colOf(s, 0), .5);
    ok(!s.over && s.score === 2, 'tiles: нажатие по пройденному ряду — не считается');
    // та же дорожка, что у следующей, но двумя рядами выше и там белое — конец (прототип засчитывал как попадание)
    let r = s.next + 2; while (colOf(s, r) === colOf(s, s.next)) r++;
    tapAt(s, colOf(s, s.next), r + .5);
    ok(s.over && s.why === 'white' && s.badR === r, 'tiles: дорожка верная, ряд — нет (белое выше) — конец', { why: s.why, badR: s.badR, r });

    // клавиатура: своя дорожка — попадание, чужая — белое
    s = spec.create(K.rng(13)); key(s, colOf(s, 0)); key(s, colOf(s, 1));
    ok(s.score === 2 && !s.over, 'tiles: клавиши D F J K — по дорожке следующего ряда');
    key(s, white(s, 2)); ok(s.over && s.why === 'white', 'tiles: не та клавиша — белая, конец');

    // счёт: 20 верных нажатий подряд = 20 + 2 × ⭐ (золотые — 3 очка)
    s = spec.create(K.rng(14)); let gold = 0;
    for (let i = 0; i < 40; i++) { if (s.gold[s.next & (C.RING - 1)]) gold++; tapAt(s, colOf(s, s.next), s.next + .5); stepN(s, 5); }
    ok(!s.over && s.hits === 40 && s.score === 40 + 2 * gold && s.golds === gold, 'tiles: счёт = плитки + 2 за каждую ⭐', { score: s.score, gold });
    // скорость — рядов в секунду: 1 с без нажатий после старта = V0 + DV·hits рядов
    s = spec.create(K.rng(15)); tapAt(s, colOf(s, 0), .5);
    const p0 = s.pos; stepN(s, 30);
    ok(Math.abs((s.pos - p0) - (C.V0 + C.DV) * .5) < 1e-9, 'tiles: за 0,5 с поле проехало (V0 + DV) × 0,5 ряда', s.pos - p0);
  },

  // Chrome (scripts/arcade-e2e.cjs): строка JS для страницы — ставит window.__bot (setInterval), жмёт следующую плитку настоящим
  // PointerEvent не чаще раза в gap мс; stopAfter — после стольких плиток перестаёт (соперник B в соревновании)
  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${TAP}; clearInterval(window.__bot); window.__bot = setInterval(() => __tap(${stopAfter}), ${gap}); return 1; })()`,
    gap: 160, stopB: 12,
    endByStop: true,     // одиночная партия кончается, когда бот перестаёт (плитка уходит вниз)
    field: 'col',        // поле, которое у соперников должно совпасть
    // свои проверки до бота: баг прототипа «нажал — сразу конец»
    async before(A, ok, cur, sleep){
      let s = await A.ev(`(s => ({ over: s.over, started: s.started, pos: s.pos }))(${cur})`);
      ok(!s.over && !s.started && s.pos === -1, 'tiles: после «▶ Начать» поле стоит и ждёт «СТАРТ» (не конец)', s);
      await A.ev(`(() => { ${TAP}; __tap(1e9); return 1; })()`);   // одно нажатие — на «СТАРТ»
      await sleep(400);
      s = await A.ev(`(s => ({ over: s.over, started: s.started, score: s.score }))(${cur})`);
      ok(s.started && s.score === 1 && !s.over, 'tiles: нажатие на «СТАРТ» засчитано, игра идёт', s);
    },
  },
};

// одно нажатие на следующую плитку (если она на экране) — настоящий PointerEvent по холсту
const TAP = `window.__tap = stopAfter => {
  const T = GAME_IMPL.tiles._test, s = T.cur(); if (!s || s.over || s.hits >= stopAfter) return;
  const C = T.spec.consts, cv = document.querySelector('.ak-cv'), r = cv.getBoundingClientRect(), n = s.next, u = n + .5 - s.pos;
  if (u < 0 || u > 3.6) return;
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + (s.col[n & 15] + .5) * C.CW * r.width / C.W, clientY: r.top + (C.H - u * C.RH) * r.height / C.H,
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
}`;

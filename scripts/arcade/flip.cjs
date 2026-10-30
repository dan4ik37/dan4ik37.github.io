// «Бутылка» (js/games/arcade/flip.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// сила для броска на turns оборотов на табурет i: время полёта T = 0,8 × turns, скорость — из высоты табурета
const pFor = (C, s, turns) => { const T = .8 * turns, dh = C.Y0 - s.ty[Math.min(s.i, C.THROWS - 1)]; return ((dh + C.G * T * T / 2) / T - C.V0) / C.V1; };
const AIMS = [1, 1.5, 2, 1, 1, 1, 2, 1.5, 1, 1];   // обороты по броскам: 1,5 — на крышку, 2 — ×2 (0,5 у высокого табурета —
// у самой вершины полёта, там сила очень чувствительна: это бросок для мастеров, не для бота)
module.exports = {
  // ждёт wait шагов, зажимает; отпускает, когда сила на подъёме дошла до нужной
  bot(K, spec, wait = 20){
    const T = K.T, C = spec.consts;
    let since = 0, i = -1;
    return (s, k, push) => {
      if (s.over) return;
      if (s.i !== i) { i = s.i; since = 0; }
      if (s.phase === 0) { if (++since > wait) push(T.DOWN, 160, 220, 0); return; }
      if (s.phase === 1 && s.dir > 0 && s.p >= pFor(C, s, AIMS[s.i])) push(T.UP, 160, 220, 0);
    };
  },
  maxMs: 120000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 };
    const send = (s, type, k) => { ev.type = type; ev.k = k || 0; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const fly = s => { let n = 0; while (s.phase === 2 && n < 1000) { spec.step(s, K.STEP, null); n++; } return n; };
    const throwAt = (s, p) => { send(s, T.DOWN); s.p = p; send(s, T.UP); return fly(s); };
    const next = s => stepN(s, C.SHOW);
    // пауза / потеря фокуса посреди замаха (T.CANCEL) — бутылка не летит, замах сброшен (проверка T-140)
    { const c = spec.create(K.rng(40)); send(c, T.DOWN); stepN(c, 20); send(c, T.CANCEL); stepN(c, 5); send(c, T.UP); stepN(c, 5);
      ok(c.phase === 0 && c.i === 0 && c.score === 0, 'flip: пауза посреди замаха — без броска, можно замахнуться снова', { phase: c.phase }); }

    let s = spec.create(K.rng(121));
    ok(Array.from(s.ty).every(y => y >= 225 && y < 345) && Array.from(s.tw).every(w => w >= 56 && w <= 84), 'flip: 10 табуретов — разной высоты и ширины');
    // быстрый тап (сила ≈ 0) — бутылка не встаёт: бесплатных очков нет
    send(s, T.DOWN); stepN(s, 1); send(s, T.UP); fly(s);
    ok(s.phase === 3 && s.res >= C.R_FALL && s.score === 0, 'flip: тап без силы — падает или мимо (не «на крышку»)', { res: s.res });
    next(s);
    ok(s.i === 1 && s.phase === 0, 'flip: через секунду — следующий бросок');
    // ровно один оборот — идеально (+15); полёт приземляется точно в момент T (по формуле, не по шагам)
    const n1 = throwAt(s, pFor(C, s, 1));
    ok(s.res === C.R_PERF && s.score === 15 && Math.abs(s.T - .8) < 1e-9 && n1 === Math.ceil(.8 * 60 - 1e-9), 'flip: один оборот — идеально, +15, полёт 0,8 с', { res: s.res, T: s.T, n1 });
    ok(Math.abs(s.a - C.SPIN * s.T) < 1e-9 && Math.abs(s.y - (s.ty[s.i] - C.BH / 2)) < 1e-6, 'flip: в момент касания — угол и высота табурета точно');
    next(s);
    // полтора оборота — на крышку (+25) и серия +2
    throwAt(s, pFor(C, s, 1.5));
    ok(s.res === C.R_CAP && s.gain === 25 + 2 && s.streak === 2, 'flip: полтора оборота — на крышку, +25 и серия +2', { res: s.res, gain: s.gain });
    stepN(s, 20); ok(Math.abs(Math.cos(s.a) + 1) < 1e-9, 'flip: на крышке — бутылка вверх дном');
    next(s);
    // два оборота — ×2: 15 × 2 + серия 4
    throwAt(s, pFor(C, s, 2));
    ok(s.res === C.R_PERF && s.mult === 2 && s.gain === 30 + 4, 'flip: два оборота — ×2', { gain: s.gain, mult: s.mult });
    next(s);
    // немного не докрутил (0,5 рад) — «Встала» (+10); сильно — падает, серия сброшена
    const dT = .5 / C.SPIN, Tt = .8 + dT, dh = C.Y0 - s.ty[s.i];
    throwAt(s, ((dh + C.G * Tt * Tt / 2) / Tt - C.V0) / C.V1);
    ok(s.res === C.R_STAND && s.gain === 10 + 6, 'flip: перекрутил на 0,5 рад — встала, +10 и серия', { res: s.res, gain: s.gain });
    next(s);
    throwAt(s, pFor(C, s, 1.25));
    ok(s.res === C.R_FALL && s.streak === 0 && s.gain === 0, 'flip: четверть оборота лишняя — упала, серия сброшена');
    stepN(s, 30); ok(Math.abs(Math.cos(s.a)) < 1e-9, 'flip: упавшая лежит на боку');
    // сила качается в секунду: 1,1 с — до конца, ещё 1,1 с — обратно
    s = spec.create(K.rng(122)); send(s, T.KEY, 0);
    stepN(s, 67); ok(s.phase === 1 && s.p > .97 && s.dir === -1, 'flip: пробел — сила растёт, за 1,1 с до конца', s.p);
    stepN(s, 66); ok(s.p < .03 && s.dir === 1, 'flip: и обратно за 1,1 с', s.p);
    send(s, T.KEYUP, 0); ok(s.phase === 2, 'flip: отпустил пробел — бросок');
    // не долетел до высокого табурета — на пол
    s = spec.create(K.rng(123)); s.ty[0] = 230;
    throwAt(s, 0);
    ok(s.res === C.R_MISS && !s.reach && s.score === 0, 'flip: слабый бросок на высокий табурет — мимо, на пол');
    // держишь дольше 5 с — бросок сам; 8 с без броска — бросок сам; 10 бросков — конец даже без нажатий
    s = spec.create(K.rng(124)); send(s, T.DOWN); stepN(s, C.HOLD);
    ok(s.phase === 2, 'flip: держишь 5 с — бутылка летит сама');
    s = spec.create(K.rng(125)); let n = 0;
    while (!s.over && n < 100000) { spec.step(s, K.STEP, null); n++; }
    ok(s.over && s.i === 10 && s.score === 0 && n < 10 * (C.IDLE + 120 + C.SHOW), 'flip: без нажатий — 10 слабых бросков и конец', { n, score: s.score });
    // бот по формуле — все броски удачные
    const r = K.sim(spec, { seed: 126, fps: 60, bot: module.exports.bot(K, spec), maxMs: 120000 });
    ok(r.s.over && r.s.good === 10 && spec.win(r.s), 'flip: точный бот — 10 из 10', { good: r.s.good, score: r.score });
    console.log('  flip: точный бот (1 / 1,5 / 2 оборота) — ' + r.score + ' очков за 10 бросков');
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящие pointerdown / pointerup по холсту; stopAfter — после стольких бросков не жмёт
  // (бросает сама игра — слабо, через 8 с)
  e2e: {
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const G = GAME_IMPL.flip._test, s = G.cur(); if (!s || s.over || s.i >= ${stopAfter}) return;
      const C = G.spec.consts, cv = document.querySelector('.ak-cv'), r = cv.getBoundingClientRect();
      const P = type => cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
      const T = .8, dh = C.Y0 - s.ty[s.i], p = ((dh + C.G * T * T / 2) / T - C.V0) / C.V1;
      if (s.phase === 0) P('pointerdown'); else if (s.phase === 1 && s.dir > 0 && s.p >= p - .02) P('pointerup');
    }, ${gap}); return 1; })()`,
    gap: 16, stopB: 2,
    endByStop: false,    // 10 бросков — конец; B после 2 бросков ждёт, игра бросает сама через 8 с
    endMs: 100000,
    field: 'ty',
  },
};

// «Загадки с подвохом» (js/games/arcade/riddles.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
module.exports = {
  // «думает» think шагов и отвечает; каждый 4-й вопрос — неверно, 6-й — молчит до конца времени; на чётных — жмёт «Дальше»
  bot(K, spec, think = 100){
    const T = K.T, C = spec.consts;
    let q = -1, at = 0;
    return (s, k, push) => {
      if (s.over) return;
      if (s.qi !== q) { q = s.qi; at = k; }
      if (s.phase === 1) { if (q % 2 === 0 && s.wait === C.SHOW - C.GUARD - 5) push(T.PICK, 0, 0, C.NEXT); return; }
      if (q === 5 || k - at !== think + 7 * q) return;
      push(T.PICK, 0, 0, q % 4 === 3 ? (s.good + 1) % 4 : s.good);
    };
  },
  maxMs: 300000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const key = (s, k) => { ev.type = T.KEY; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };

    ok(C.QS.length >= 30 && C.QS.every(q => q[1].length === 4 && new Set(q[1]).size === 4 && q[2]), 'riddles: 30+ загадок, у каждой 4 разных ответа и «почему»', C.QS.length);
    let s = spec.create(K.rng(91));
    ok(new Set(s.order).size === C.N, 'riddles: 10 разных загадок в партии');
    ok(C.QS[s.order[0]][1][s.perm[s.good]] === C.QS[s.order[0]][1][0], 'riddles: good — кнопка с верным ответом');
    // сразу верно: 50 + 4 × 15
    stepN(s, 1);
    pick(s, s.good);
    ok(s.score === 110 && s.right === 1 && s.phase === 1, 'riddles: верно сразу — 50 + 4 × 15 = 110', { score: s.score });
    pick(s, (s.good + 1) % 4);
    ok(s.score === 110 && s.right === 1, 'riddles: пока показан ответ, другие ответы не считаются');
    // «Дальше» — не раньше чем через полсекунды (двойное нажатие не пропускает объяснение)
    pick(s, C.NEXT); ok(s.qi === 0, 'riddles: «Дальше» сразу после ответа — не срабатывает (защита)');
    stepN(s, C.GUARD + 1); key(s, C.NEXT); ok(s.qi === 1 && s.phase === 0 && s.left === C.QT, 'riddles: «Дальше» (пробел) — следующая загадка');
    // неверно — 0; через 6,5 с — верно: 50 + 4 × 9
    pick(s, (s.good + 2) % 4);
    ok(s.score === 110 && s.gain === 0 && s.pick !== s.good, 'riddles: неверно — 0 очков');
    stepN(s, C.SHOW); ok(s.qi === 2, 'riddles: объяснение само уходит через 2,5 с');
    stepN(s, 390); pick(s, s.good);
    ok(s.gain === 50 + 4 * 9, 'riddles: верно через 6,5 с — 50 + 4 × 9', s.gain);
    // время вышло — 0, показ ответа
    stepN(s, C.SHOW);
    stepN(s, C.QT);
    ok(s.qi === 3 && s.phase === 1 && s.pick === -1 && s.gain === 0, 'riddles: 15 с без ответа — время вышло, 0');
    // 10 загадок — конец; 7+ верно — победа
    s = spec.create(K.rng(92));
    for (let q = 0; q < C.N; q++) { stepN(s, 60); pick(s, q < 7 ? s.good : (s.good + 1) % 4); stepN(s, C.SHOW); }
    ok(s.over && s.right === 7 && s.score === 7 * (50 + 4 * 14) && spec.win(s), 'riddles: 10 загадок — конец, 7 верных — победа', { score: s.score });
    // перемешивание: верный ответ на любой кнопке примерно поровну, все загадки встречаются
    const pos = [0, 0, 0, 0], used = new Set();
    for (let seed = 1; seed <= 4000; seed++) {
      const q = spec.create(K.rng(seed * 7919));
      for (let i = 0; i < C.N; i++) { used.add(q.order[i]); for (let a = 0; a < 4; a++) if (q.perm[4 * i + a] === 0) pos[a]++; }
    }
    ok(pos.every(c => Math.abs(c / 40000 - .25) < .02) && used.size === C.QS.length, 'riddles: верный ответ на каждой кнопке ~25%, все загадки встречаются', pos);
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по верному ответу, потом «Дальше»; stopAfter — после стольких загадок молчит
  e2e: {
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.riddles._test.cur(); if (!s || s.over || s.qi >= ${stopAfter}) return;
      if (s.phase === 1) { if (s.wait < 100) document.querySelector('.rd-next')?.click(); return; }
      document.querySelector('.rd-b[data-k="' + s.good + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 400, stopB: 2,
    endByStop: false,    // бот отвечает на все 10 — партия кончается сама; B после 2 молчит — 8 × 17,5 с
    endMs: 160000,
    field: 'order',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.right === 10`), 'riddles: бот ответил верно на все 10'); },
  },
};

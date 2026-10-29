// «Поп-ит» (js/games/arcade/popit.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
module.exports = {
  // лопает ✨, если есть, иначе первую целую пупырку; одно нажатие в gap шагов (8 → 7,5 в секунду)
  bot(K, spec, gap = 8){
    const T = K.T, N = spec.consts.N;
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || s.flip || k - last < gap) return;
      last = k;
      if (s.gold >= 0) { push(T.PICK, 0, 0, s.gold); return; }
      for (let i = 0; i < N; i++) if (!s.p[i]) { push(T.PICK, 0, 0, i); return; }
    };
  },
  maxMs: 60000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };

    let s = spec.create(K.rng(51));
    ok(s.n === 0 && s.gold === -1 && !s.over, 'popit: старт — все пупырки целые, ✨ нет');
    pick(s, 7); pick(s, 7);
    ok(s.score === 1 && s.n === 1, 'popit: пупырка +1, второе нажатие по лопнутой — ничего');
    for (let i = 0; i < C.N; i++) pick(s, i);
    ok(s.score === C.N + 10 && s.sheet === 1 && s.flip === C.FLIP, 'popit: весь лист — 30 + 10, лист переворачивается', { score: s.score });
    pick(s, 0);
    ok(s.score === C.N + 10, 'popit: во время переворота нажатия не считаются');
    stepN(s, C.FLIP);
    ok(s.n === 0 && s.p.every(x => !x), 'popit: после переворота все пупырки снова целые');
    // ✨: появляется по расписанию на целой пупырке, +5; не поймал — исчезает через 1,5 с
    s = spec.create(K.rng(52));
    const first = 60 + s.gi[0];
    stepN(s, first - 1); ok(s.gold === -1, 'popit: ✨ ещё нет');
    stepN(s, 1); ok(s.gold >= 0 && !s.p[s.gold] && s.goldT === C.GOLD, 'popit: ✨ появилась по расписанию на целой пупырке', { gold: s.gold, first });
    const g = s.gold; pick(s, g);
    ok(s.score === 5 && s.golds === 1 && s.gold === -1, 'popit: ✨ — +5');
    stepN(s, s.nextG); ok(s.gold >= 0, 'popit: следующая ✨');
    stepN(s, C.GOLD); ok(s.gold === -1 && s.golds === 1, 'popit: не поймал — ✨ исчезла через 1,5 с');
    // ✨ не встаёт на лопнутую
    s = spec.create(K.rng(53));
    for (let i = 0; i < C.N - 1; i++) pick(s, i);
    stepN(s, 60 + s.gi[0]);
    ok(s.gold === C.N - 1, 'popit: ✨ — только на целой пупырке (осталась одна)', s.gold);
    // время: 40 с — конец, очки остаются
    s = spec.create(K.rng(54)); pick(s, 3); stepN(s, C.TIME + 5);
    ok(s.over && s.score === 1 && !spec.win(s), 'popit: 40 с — конец партии, очки сохраняются');
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по ✨ или первой целой пупырке; stopAfter — после стольких пупырок перестаёт
  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.popit._test.cur(); if (!s || s.over || s.flip || s.pops >= ${stopAfter}) return;
      let k = s.gold; if (k < 0) k = s.p.indexOf(0);
      document.querySelector('.pp-b[data-k="' + k + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 120, stopB: 20,
    endByStop: false,    // партия кончается сама через 40 с
    endMs: 45000,
    field: 'gq',
  },
};

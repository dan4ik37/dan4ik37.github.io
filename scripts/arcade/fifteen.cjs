// «Пятнашки» (js/games/arcade/fifteen.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// клетка не в линии с пустой (нажатие по ней — не ход)
const offLine = s => { const n = s.n, z = s.z; return ((z % n) + 1) % n + n * ((((z / n) | 0) + 1) % n); };
module.exports = {
  // разматывает перемешивание назад (path), одно нажатие в 12 шагов; каждое 9-е — мимо линии (не ход, без наказания)
  bot(K, spec, gap = 12){
    const T = K.T;
    let last = -1e9, cnt = 0;
    return (s, k, push) => {
      if (s.over || s.wait || k - last < gap) return;
      last = k;
      if (++cnt % 9 === 0) { push(T.PICK, 0, 0, offLine(s)); return; }
      push(T.PICK, 0, 0, s.path[s.plen - 1 - s.moves]);
    };
  },
  maxMs: 200000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const key = (s, k) => { ev.type = T.KEY; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const solved = s => { const N = s.n * s.n; for (let i = 0; i < N; i++) if (s.a[i] !== (i + 1) % N) return false; return true; };
    // (прогулка может пройти через собранную доску — тогда доска собирается раньше конца пути)
    const unwind = s => { while (s.moves < s.plen && !s.wait && !s.over) pick(s, s.path[s.plen - 1 - s.moves]); };

    // целая партия: путь перемешивания назад решает каждую доску; счёт 3 × 100 + 2 × оставшиеся секунды
    let s = spec.create(K.rng(31));
    for (let b = 0; b < C.BOARDS.length; b++) {
      ok(s.board === b && s.n === C.BOARDS[b][0] && !solved(s) && s.a[s.z] === 0 && s.path[s.plen] === s.z, 'fifteen: доска ' + (b + 1) + ' — перемешана, пустая клетка в конце пути');
      stepN(s, 60);
      unwind(s);
      ok(solved(s) && s.wait === C.WAIT && s.solved === b + 1, 'fifteen: обратный путь собирает доску ' + (b + 1));
      const sc = s.score; pick(s, s.z === 0 ? 1 : s.z - 1);
      ok(s.score === sc && solved(s), 'fifteen: пока доска «собрана», нажатия не считаются');
      stepN(s, C.WAIT);
    }
    const left = C.TIME - 60 * C.BOARDS.length;
    ok(s.over && s.score === 300 + 2 * Math.ceil(left / 60) && spec.win(s), 'fifteen: 3 доски — 300 + 2 × секунды', { score: s.score });

    // сдвиг всей линии: пустая в углу, нажатие через две клетки — две плитки едут, один ход
    s = spec.create(K.rng(32));
    s.a.set([0, 1, 2, 3, 4, 5, 6, 7, 8]); s.z = 0; s.moves = 0;
    pick(s, 2);
    ok(s.z === 2 && s.a[0] === 1 && s.a[1] === 2 && s.a[2] === 0 && s.moves === 1, 'fifteen: плитка в той же строке — едет вся строка, один ход', Array.from(s.a));
    pick(s, 8);
    ok(s.z === 8 && s.a[2] === 5 && s.a[5] === 8 && s.moves === 2, 'fifteen: плитка в том же столбце — едет весь столбец', Array.from(s.a));
    pick(s, 0);
    ok(s.z === 8 && s.moves === 2, 'fifteen: плитка не в линии с пустой — не ход');
    // клавиши: ↑ — плитка под пустой едет вверх
    s.a.set([1, 2, 3, 4, 0, 5, 7, 8, 6]); s.z = 4;
    key(s, 0); ok(s.z === 7 && s.a[4] === 8, 'fifteen: ↑ — плитка снизу едет в пустую');
    key(s, 0); ok(s.z === 7, 'fifteen: ↑ у нижнего края — ничего');
    key(s, 2); ok(s.z === 8 && s.a[7] === 6, 'fifteen: ← — плитка справа едет влево');
    // последний ход клавишей: [1 2 3 / 4 5 6 / 7 _ 8], ← — плитка 8 едет влево
    s.a.set([1, 2, 3, 4, 5, 6, 7, 0, 8]); s.z = 7; const sc0 = s.score;
    key(s, 2); ok(solved(s) && s.score === sc0 + 100, 'fifteen: последний ход клавишей — доска собрана (+100)');

    // время вышло — +3 за плитку на месте
    s = spec.create(K.rng(33));
    let inPlace = 0; for (let i = 0; i < 8; i++) if (s.a[i] === i + 1) inPlace++;
    stepN(s, C.TIME + 5);
    ok(s.over && s.part === 3 * inPlace && s.score === 3 * inPlace && !spec.win(s), 'fifteen: 3 минуты без решения — +3 за каждую плитку на месте', { part: s.part, inPlace });

    // перемешивание: 2000 партий — ни одна доска не собрана сразу, путь назад собирает каждую
    let bad = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const q = spec.create(K.rng(seed * 7919));
      for (let b = 0; b < C.BOARDS.length; b++) {
        if (solved(q)) bad++;
        unwind(q);
        if (!solved(q)) bad++;
        stepN(q, C.WAIT);
      }
      if (!q.over) bad++;
    }
    ok(bad === 0, 'fifteen: 2000 партий — каждая доска перемешана и решается', bad);
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по плитке пути назад, не чаще раза в gap мс; stopAfter — после стольких досок
  e2e: {
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.fifteen._test.cur(); if (!s || s.over || s.wait || s.solved >= ${stopAfter}) return;
      document.querySelector('.ff-c[data-k="' + s.path[s.plen - 1 - s.moves] + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 110, stopB: 1,
    endByStop: false,    // бот собирает все доски — партия кончается сама
    endMs: 190000,       // соперник B бросает после 1 доски — его партию кончает время (3 мин)
    field: 'a0',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.solved === 3`), 'fifteen: бот собрал все 3 доски'); },
  },
};

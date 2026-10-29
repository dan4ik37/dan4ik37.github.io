// «Сортировка красок» (js/games/arcade/watersort.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
module.exports = {
  // повторяет решение решателя (номер хода = s.hn — сколько переливаний не отменено); каждое 7-е переливание отменяет и
  // повторяет — проверка отмены; одно нажатие в gap шагов
  bot(K, spec, gap = 10){
    const T = K.T, C = spec.consts;
    let last = -1e9, cnt = 0, undoNext = false;
    return (s, k, push) => {
      if (s.over || s.wait || k - last < gap) return;
      last = k;
      if (undoNext) { undoNext = false; push(T.PICK, 0, 0, C.UNDO); return; }
      const o = s.lvl * 2 * C.MAXS + 2 * s.hn;
      if (s.sel < 0) push(T.PICK, 0, 0, s.sol[o]);
      else { push(T.PICK, 0, 0, s.sol[o + 1]); if (++cnt % 7 === 0) undoNext = true; }
    };
  },
  maxMs: 200000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const solveLvl = s => { const o = s.lvl * 2 * C.MAXS; for (let i = 0; i < s.sl[s.lvl] && !s.wait; i++) { pick(s, s.sol[o + 2 * i]); pick(s, s.sol[o + 2 * i + 1]); } };
    const snap = s => Array.from(s.j).join(',') + '|' + Array.from(s.c).join(',');

    let s = spec.create(K.rng(61));
    let fullAtStart = 0; for (let i = 0; i < s.nj; i++) if (C.full(s.j, s.c, i)) fullAtStart++;
    ok(s.nj === 6 && s.c[4] === 0 && s.c[5] === 0 && s.c[0] === 4 && fullAtStart === 0, 'watersort: уровень 1 — 4 краски вперемешку + 2 пустые, собранных банок нет');
    // правила переливания
    let a = -1, b = -1;
    for (let i = 0; i < 4 && a < 0; i++) for (let j = 0; j < 4; j++) if (i !== j && s.j[i * 4 + 3] !== s.j[j * 4 + 3]) { a = i; b = j; break; }
    const before = snap(s);
    pick(s, a); ok(s.sel === a, 'watersort: нажатие — банка выбрана');
    pick(s, b); ok(snap(s) === before && s.sel === b && s.moves === 0, 'watersort: на другой цвет нельзя — ничего не льётся, выбрана новая банка');
    pick(s, b); ok(s.sel === -1, 'watersort: повторное нажатие — выбор снят');
    pick(s, a); pick(s, 4);
    ok(s.c[4] >= 1 && s.moves === 1 && s.hn === 1, 'watersort: в пустую банку — можно', { c4: s.c[4] });
    pick(s, C.UNDO);
    ok(snap(s) === before && s.hn === 0, 'watersort: отмена возвращает банки как было');
    // решение решателя собирает уровень: 4 краски × 10 + 50
    s = spec.create(K.rng(62));
    solveLvl(s);
    ok(s.wait > 0 && s.solved === 1 && s.score === 4 * 10 + 50, 'watersort: решение собирает уровень 1 — 4 × 10 + 50', { score: s.score, sl: s.sl[0] });
    // перелить собранную банку в пустую и обратно — очки не повторяются (награда за краску, не за банку)
    s = spec.create(K.rng(63));
    s.j.fill(-1); s.c.fill(0);
    s.j.set([0, 0, 0, 1], 0); s.j.set([1, 1, 1], 4); s.j.set([2, 2, 2, 2], 8); s.j.set([3, 3, 3, 3], 12); s.j.set([0], 16);
    s.c.set([4, 3, 4, 4, 1, 0]); s.doneC.fill(0);
    pick(s, 0); pick(s, 1);   // краска 1 с верха банки 0 → в банку 1: банка 1 собрана
    ok(s.score === 10 && s.doneC[1] === 1, 'watersort: краска собрана — +10', { score: s.score });
    pick(s, 1); pick(s, 5); pick(s, 5); pick(s, 1);
    ok(s.score === 10, 'watersort: собранную банку туда-обратно — без новых очков', { score: s.score });
    pick(s, 4); pick(s, 0);
    ok(s.score === 10 + 10 + 50 && s.wait > 0, 'watersort: последняя краска — +10 и уровень +50 (краски 2 и 3 не считаются — не собирались)', { score: s.score });
    // целая партия: 3 уровня по решению → (4 + 5 + 6) × 10 + 3 × 50 + 2 × секунды
    s = spec.create(K.rng(64));
    for (let L = 0; L < 3; L++) { ok(s.lvl === L && s.nj === C.LEVELS[L] + 2, 'watersort: уровень ' + (L + 1) + ' — ' + C.LEVELS[L] + ' красок'); stepN(s, 60); solveLvl(s); stepN(s, C.WAIT); }
    ok(s.over && s.score === 150 + 150 + 2 * Math.ceil((C.TIME - 180) / 60) && spec.win(s), 'watersort: 3 уровня — 300 + 2 × секунды', { score: s.score });
    // время вышло — конец
    s = spec.create(K.rng(65)); stepN(s, C.TIME + 5);
    ok(s.over && s.score === 0 && !spec.win(s), 'watersort: 3 минуты без решения — конец');
    // генератор: 1000 партий — ни одной собранной банки на старте, решение каждого уровня ≤ 100 ходов и верное
    let bad = 0, maxSl = 0;
    const t0 = Date.now();
    for (let seed = 1; seed <= 1000; seed++) {
      const q = spec.create(K.rng(seed * 7919));
      for (let L = 0; L < 3; L++) {
        for (let i = 0; i < q.nj; i++) if (C.full(q.j, q.c, i)) bad++;
        maxSl = Math.max(maxSl, q.sl[L]);
        solveLvl(q);
        if (!q.wait) bad++;
        stepN(q, C.WAIT);
      }
    }
    const ms = (Date.now() - t0) / 1000;
    ok(bad === 0 && maxSl <= C.MAXS, 'watersort: 1000 партий — каждый уровень решается (решатель)', { bad, maxSl });
    console.log('  watersort: партия (3 уровня с решателем) создаётся в среднем за ' + ms.toFixed(2) + ' мс, самое длинное решение — ' + maxSl + ' ходов');
    ok(ms < 30, 'watersort: создание партии с решателем — быстро (< 30 мс в среднем)', ms);
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящие click по банкам решения; stopAfter — после стольких уровней перестаёт
  e2e: {
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.watersort._test.cur(); if (!s || s.over || s.wait || s.solved >= ${stopAfter}) return;
      const o = s.lvl * 200 + 2 * s.hn;
      document.querySelector('.ws-j[data-k="' + (s.sel < 0 ? s.sol[o] : s.sol[o + 1]) + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 130, stopB: 1,
    endByStop: false,    // бот раскладывает все уровни — партия кончается сама
    endMs: 190000,       // соперник B бросает после 1 уровня — его партию кончает время (3 мин)
    field: 'j0',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.solved === 3`), 'watersort: бот разложил все 3 уровня'); },
  },
};

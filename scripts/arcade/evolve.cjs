// «Эволюция» (js/games/arcade/evolve.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// пара одинаковых самого низкого уровня: выбранный → второй такой же; иначе — первый из пары
const move = (s, N, MAXL) => {
  if (s.sel >= 0) {
    const L = s.g[s.sel];
    for (let j = 0; j < N; j++) if (j !== s.sel && s.g[j] === L && !s.fly[j]) return j;
    return s.sel;   // пары нет — снять выбор
  }
  for (let L = 0; L < MAXL; L++) {
    let a = -1;
    for (let i = 0; i < N; i++) if (s.g[i] === L && !s.fly[i]) { if (a < 0) a = i; else return a; }
  }
  return -1;
};
module.exports = {
  bot(K, spec, gap = 20){
    const T = K.T, C = spec.consts;
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      const m = move(s, C.N, C.MAXL);
      if (m < 0) return;
      last = k; push(T.PICK, 0, 0, m);
    };
  },
  maxMs: 150000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const count = s => { let c = 0; for (let i = 0; i < C.N; i++) if (s.g[i] >= 0) c++; return c; };

    let s = spec.create(K.rng(101));
    ok(count(s) === 4 && s.eggs === 4, 'evolve: старт — 4 яйца в гнезде');
    // слияние: 🥚 + 🥚 → 🐣 в клетке второго, +1
    s.g.fill(-1); s.g[0] = 0; s.g[1] = 0; s.g[2] = 1; s.g[5] = 1;
    pick(s, 0); pick(s, 1);
    ok(s.g[0] === -1 && s.g[1] === 1 && s.score === 1 && s.combo === 0, 'evolve: 🥚 + 🥚 → 🐣 (+1)');
    // серия: следующее слияние быстрее секунды — +1 сверху
    stepN(s, 20); pick(s, 1); pick(s, 2);
    ok(s.g[2] === 2 && s.score === 1 + 3 + 1 && s.combo === 1, 'evolve: 🐣 + 🐣 → 🦎 (+3) и серия +1', { score: s.score, combo: s.combo });
    stepN(s, C.CHAIN); ok(s.combo === 0, 'evolve: секунда без слияний — серия кончилась');
    // разные — не сливаются, выбор переходит; пустая клетка — переставить
    pick(s, 2); pick(s, 5);
    ok(s.g[2] === 2 && s.g[5] === 1 && s.sel === 5, 'evolve: разные не сливаются — выбран второй');
    pick(s, 15);
    ok(s.g[15] === 1 && s.g[5] === -1 && s.sel === -1, 'evolve: выбранный → пустая клетка — переставлен');
    // дракон: +25, улетает через FLY шагов, во время полёта не нажимается
    s.g.fill(-1); s.g[3] = 3; s.g[7] = 3; const sc = s.score;
    pick(s, 3); pick(s, 7);
    ok(s.g[7] === 4 && s.dragons === 1 && s.score === sc + 25 && s.fly[7] === C.FLY, 'evolve: 🐲 + 🐲 → 🐉 (+25), дракон взлетает');
    pick(s, 7); ok(s.sel === -1, 'evolve: летящего дракона не выбрать');
    stepN(s, C.FLY); ok(s.g[7] === -1, 'evolve: дракон улетел — клетка свободна');
    // яйца падают всё чаще: SP0, SP0 − SPD… ; гнездо полное — конец
    s = spec.create(K.rng(102));
    stepN(s, C.SP0 - 1); ok(s.eggs === 4, 'evolve: первое новое яйцо — не раньше SP0 шагов');
    stepN(s, 1); ok(s.eggs === 5 && s.next === C.SP0 - 5 * C.SPD, 'evolve: яйцо упало, следующее — чуть быстрее', s.next);
    stepN(s, C.TIME);
    ok(s.over && s.why === 'full' && count(s) === C.N && !spec.win(s), 'evolve: без слияний гнездо переполняется — конец', { why: s.why, t: C.TIME - s.left });
    // 2 минуты с ботом — время вышло, драконы улетали; конец ровно в 2 минуты
    const r = K.sim(spec, { seed: 103, fps: 60, bot: module.exports.bot(K, spec, 12), maxMs: 200000 });
    ok(r.s.over && r.s.why === 'time' && r.steps === C.TIME && r.s.dragons >= 2 && spec.win(r.s), 'evolve: быстрый бот доживает до конца 2 минут, драконы есть', { why: r.s.why, dragons: r.s.dragons, score: r.score });
    console.log('  evolve: быстрый бот (5 нажатий в секунду) — ' + r.score + ' очков, драконов ' + r.s.dragons + ', серия ×' + r.s.best);
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по паре; stopAfter — после стольких драконов перестаёт (гнездо переполнится)
  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.evolve._test.cur(); if (!s || s.over || s.dragons >= ${stopAfter}) return;
      let m = -1;
      if (s.sel >= 0) { for (let j = 0; j < 16; j++) if (j !== s.sel && s.g[j] === s.g[s.sel] && !s.fly[j]) { m = j; break; } if (m < 0) m = s.sel; }
      else for (let L = 0; L < 4 && m < 0; L++) { let a = -1; for (let i = 0; i < 16; i++) if (s.g[i] === L && !s.fly[i]) { if (a < 0) a = i; else { m = a; break; } } }
      if (m >= 0) document.querySelector('.ev-c[data-k="' + m + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 200, stopB: 1,
    endByStop: false,    // A играет 2 минуты; B после первого дракона не сливает — его гнездо переполняется
    endMs: 130000,
    field: 'g',
  },
};

// «Шарик в цель» (js/games/arcade/pegs.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
const goldX = (s, C, k) => { let g = 0; for (let b = 0; b < C.NB; b++) if (s.tg[b] === 2) g = b; return g * C.BW + C.BW / 2 + ((k * 7) % 9 - 4) * 2; };

module.exports = {
  // палец над золотой корзинкой (со сдвигом), отпускает на следующем шаге
  bot(K, spec, gap = 30){
    const T = K.T, C = spec.consts;
    let last = -1e9, held = false, x = 0;
    return (s, k, push) => {
      if (s.over) return;
      if (held) { push(T.UP, x, 60, 0); held = false; return; }
      if (s.fly || k - last < gap) return;
      last = k; held = true; x = goldX(s, C, k);
      push(T.DOWN, x, 60, 0);
    };
  },
  maxMs: 200000,
  garbage: { gap: 30, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x) => { ev.type = type; ev.x = x; ev.y = 60; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const kinds = s => { let g = 0, e = 0; for (let b = 0; b < C.NB; b++) { g += s.tg[b] === 2; e += s.tg[b] === 1; } return g * 10 + e; };
    const drop = (s, x) => { send(s, T.DOWN, x); send(s, T.UP, x); stepN(s, 1); const b = s.ball; let n = 0; while (s.fly && n < 2000) { stepN(s, 1); n++; } return n; };

    // старт: 1 золотая и 2 зелёные; без нажатий шарик падает сам через IDLE шагов
    let s = spec.create(K.rng(51));
    ok(kinds(s) === 12 && s.ball === 0 && !s.fly, 'pegs: старт — одна ⭐ и две зелёные корзинки, шарик на держателе');
    stepN(s, C.IDLE - 1);
    ok(!s.fly && s.ball === 0 && !s.over, 'pegs: до IDLE шагов шарик ждёт');
    stepN(s, 1);
    ok(s.fly === 1 && s.ball === 1 && s.free === 1, 'pegs: IDLE шагов без броска — шарик падает сам (без очков)');
    // проверка T-140 (R1): шарик, упавший сам, очков не даёт — партия без нажатий: 0 очков и не победа (на 60 зёрнах)
    { let maxSc = 0, wins = 0, frees = 0;
      for (let seed = 1; seed <= 60; seed++) { const z = spec.create(K.rng(seed)); let n = 0; while (!z.over && n < 40000) { spec.step(z, K.STEP, inp); n++; } maxSc = Math.max(maxSc, z.score); wins += spec.win(z) ? 1 : 0; frees += z.frees; }
      ok(maxSc === 0 && wins === 0 && frees === 600, 'pegs: партия без единого нажатия — 0 очков и не победа (60 зёрен)', { maxSc, wins, frees }); }
    // один прицельный бросок, остальные сами: очки только за него
    { const z = spec.create(K.rng(61)); let g = 0; for (let b = 0; b < C.NB; b++) if (z.tg[b] === 2) g = b;
      send(z, T.DOWN, g * C.BW + C.BW / 2); send(z, T.UP, g * C.BW + C.BW / 2); stepN(z, 1); const f1 = z.free; while (z.fly) stepN(z, 1);
      const first = z.score; let n = 0; while (!z.over && n < 40000) { spec.step(z, K.STEP, inp); n++; }
      ok(f1 === 0 && first > 0 && z.score === first && z.frees === C.BALLS - 1, 'pegs: очки только за прицельный бросок, остальные 9 упали сами — 0', { first, score: z.score, frees: z.frees }); }
    // нажал и отпустил во время полёта — следующий шарик не бросается вслепую (цели меняются, когда шарик упал)
    { const z = spec.create(K.rng(62)); send(z, T.DOWN, 100); send(z, T.UP, 100); stepN(z, 1); stepN(z, 20);
      send(z, T.DOWN, 200); send(z, T.UP, 200); let n = 0; while (z.fly && n < 2000) { stepN(z, 1); n++; } stepN(z, 3);
      ok(z.ball === 1 && z.fly === 0 && z.want === 0 && z.aim === 200, 'pegs: нажатие в полёте — только прицел, следующий шарик ждёт', { ball: z.ball, fly: z.fly, want: z.want }); }
    // клавиши ← → — тоже прицел: шарик, упавший после них сам, считается (игрок целился)
    { const z = spec.create(K.rng(63)); ev.type = T.KEY; ev.k = 0; spec.input(z, ev, inp); stepN(z, C.IDLE);
      ok(z.fly === 1 && z.free === 0, 'pegs: целился клавишами и не бросил — шарик падает сам, но очки считаются', { free: z.free }); }
    // тап — бросок туда, где палец; держит палец вечно — бросок через 2·IDLE (партия не стоит)
    s = spec.create(K.rng(52)); send(s, T.DOWN, 90); send(s, T.UP, 90); stepN(s, 1);
    ok(s.fly === 1 && Math.abs(s.x - 90) < 1e-9 && !s.over, 'pegs: тап — шарик падает из-под пальца, игра идёт');
    s = spec.create(K.rng(53)); send(s, T.DOWN, 90); stepN(s, 2 * C.IDLE - 1);
    ok(!s.fly, 'pegs: палец держит — шарик ждёт');
    stepN(s, 1);
    ok(s.fly === 1 && s.free === 0, 'pegs: держит 2·IDLE шагов — шарик всё равно падает (прицел был — очки считаются)');
    // тяжесть в секунду²: 0,25 с свободного падения
    s = spec.create(K.rng(54)); send(s, T.DOWN, 16); send(s, T.UP, 16); stepN(s, 1); stepN(s, 15);
    ok(Math.abs(s.vy - C.G0 * .25) < 1, 'pegs: за 0,25 с скорость падения ≈ G0 / 4', s.vy);
    // один и тот же бросок — одна и та же корзинка (у соперников одинаково)
    const a = spec.create(K.rng(55)), b = spec.create(K.rng(55));
    drop(a, 133.3); drop(b, 133.3);
    ok(a.lastB === b.lastB && a.score === b.score && a.lastB >= 0, 'pegs: одинаковый бросок — одинаковая корзинка', { a: a.lastB, b: b.lastB });
    // очки: ⭐ 50, зелёная 20 + серия 10, мимо 2 и серия сброшена
    s = spec.create(K.rng(56));
    const put = (bk) => { s.fly = 1; s.ball++; s.x = bk * C.BW + C.BW / 2; s.y = C.LAND - .5; s.vx = 0; s.vy = 100; stepN(s, 1); };
    let g = -1, e = -1, z = -1;
    for (let k = 0; k < C.NB; k++) { if (s.tg[k] === 2) g = k; }
    put(g);
    ok(s.score === 50 && s.gold === 1 && s.streak === 1, 'pegs: ⭐ золотая — 50', s.score);
    for (let k = 0; k < C.NB; k++) { if (s.tg[k] === 1) e = k; }
    put(e);
    ok(s.score === 80 && s.streak === 2, 'pegs: зелёная подряд — 20 + серия 10', s.score);
    for (let k = 0; k < C.NB; k++) { if (s.tg[k] === 0) z = k; }
    put(z);
    ok(s.score === 82 && s.streak === 0 && s.best === 2, 'pegs: мимо целей — 2, серия сброшена', s.score);
    // шарик ровно над гвоздиком не застывает (прототип: Math.random; здесь — толчок из rng только на макушке)
    s = spec.create(K.rng(57)); const n0 = drop(s, 160);
    ok(s.ball === 1 && !s.fly && n0 < C.STUCK - 5, 'pegs: шарик точно над гвоздиком — не застыл, упал в корзинку', n0);
    // с 4-го шарика — планка: шарик над ней отскакивает
    s = spec.create(K.rng(58)); s.ball = C.BAR - 1; send(s, T.DOWN, 50); send(s, T.UP, 50); stepN(s, 1);
    s.x = s.bar; s.y = C.BARY - 20; s.vx = 0; s.vy = 200;
    let up = 0; for (let i = 0; i < 10; i++) { stepN(s, 1); if (s.vy < 0) up = 1; }
    ok(s.ball === C.BAR && up && s.y < C.BARY, 'pegs: с 4-го шарика планка отбивает шарик', { vy: s.vy, y: s.y });
    // 10 шариков — конец
    s = spec.create(K.rng(59)); let n = 0; while (!s.over && n < 30000) { if (!s.fly) s.want = 1; spec.step(s, K.STEP, inp); n++; }
    ok(s.over && s.why === 'balls' && s.ball === C.BALLS, 'pegs: 10 шариков — конец', { ball: s.ball, n });
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('pegs')}; clearInterval(window.__bot); let held = 0, x = 0, k = 0;
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.pegs._test, s = T.cur(); if (!s || s.over || s.ball >= ${stopAfter}) return;
        const C = T.spec.consts;
        if (held) { __ptr('pointerup', x, 60); held = 0; return; }
        if (s.fly) return;
        let g = 0; for (let b = 0; b < C.NB; b++) if (s.tg[b] === 2) g = b;
        x = g * C.BW + C.BW / 2 + ((++k * 7) % 9 - 4) * 2; __ptr('pointerdown', x, 60); held = 1;
      }, ${gap}); return 1; })()`,
    gap: 300, stopB: 2,
    endByStop: false,    // 10 шариков; бот B бросил 2 — остальные падают сами через 6 с и очков не дают
    endMs: 130000,
    field: 'tg',
  },
};

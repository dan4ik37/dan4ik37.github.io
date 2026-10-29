// «Слияние планет» (js/games/arcade/planets.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
const rad = (C, t) => (t === C.COMET ? C.CR : C.RAD[t]);
// куда бросать: на такое же тело, что сверху открыто; комету — на самое высокое; иначе — где ниже всего
function aimX(s, C){
  let bx = -1, by = 1e9;
  for (let i = 0; i < C.NP; i++) {
    if (!s.on[i] || s.lv[i] === C.COMET) continue;
    const top = s.y[i] - rad(C, s.lv[i]);
    if ((s.cur === C.COMET || s.lv[i] === s.cur) && top < by) { by = top; bx = s.x[i]; }
  }
  if (bx >= 0) return bx;
  let best = 160, low = -1e9;
  for (let c = 0; c < 8; c++) {
    const x = 20 + c * 40;
    let surf = C.FLOOR;
    for (let i = 0; i < C.NP; i++) if (s.on[i] && Math.abs(s.x[i] - x) < rad(C, s.lv[i]) + 10) surf = Math.min(surf, s.y[i] - rad(C, s.lv[i]));
    if (surf > low) { low = surf; best = x; }
  }
  return best;
}

module.exports = {
  bot(K, spec, gap = 34){
    const T = K.T, C = spec.consts;
    let last = -1e9, held = false;
    return (s, k, push) => {
      if (s.over) return;
      if (held) { push(T.UP, s.aim, 300, 0); held = false; return; }
      if (k - last < gap || s.cd) return;
      last = k; held = true;
      push(T.DOWN, aimX(s, C), 300, 0);
    };
  },
  maxMs: 130000,
  garbage: { gap: 34, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x) => { ev.type = type; ev.x = x; ev.y = 300; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const count = s => { let n = 0; for (let i = 0; i < C.NP; i++) n += s.on[i]; return n; };
    const place = (s, t, x, y) => { let i = 0; while (s.on[i]) i++; s.on[i] = 1; s.lv[i] = t; s.x[i] = x; s.y[i] = y; s.x0[i] = x; s.y0[i] = y; s.vx[i] = 0; s.vy[i] = 0; s.age[i] = 100; s.pop[i] = 0; return i; };

    // старт: целишься без броска; бросок — когда отпустил
    let s = spec.create(K.rng(91));
    send(s, T.DOWN, 100); stepN(s, 60);
    ok(count(s) === 0 && s.aim === 100 && !s.over, 'planets: палец на поле — прицел, без броска');
    send(s, T.UP, 100); stepN(s, 1);
    ok(count(s) === 1 && s.drops === 1 && s.cd > 0, 'planets: отпустил — тело упало');
    // перезарядка: второй бросок сразу не идёт, а выполняется, как только готово
    send(s, T.DOWN, 200); send(s, T.UP, 200); stepN(s, 1);
    ok(s.drops === 1 && s.want === 1, 'planets: во время перезарядки бросок ждёт');
    stepN(s, C.CD);
    ok(s.drops === 2, 'planets: перезарядка прошла — бросок выполнен');
    // не бросил IDLE шагов — тело падает само (игра не стоит)
    s = spec.create(K.rng(92)); stepN(s, C.IDLE - 1);
    ok(s.drops === 0, 'planets: до IDLE шагов — ждёт');
    stepN(s, 1);
    ok(s.drops === 1, 'planets: IDLE шагов без броска — тело упало само');
    // тяжесть — в секунду²: свободное падение 0,5 с
    s = spec.create(K.rng(93)); const i0 = place(s, 0, 160, 100); stepN(s, 30);
    ok(Math.abs(s.vy[i0] - C.G0 * .5) < 1, 'planets: за 0,5 с скорость падения ≈ G0 / 2', s.vy[i0]);
    // два одинаковых — слияние в следующий уровень, очки по таблице
    s = spec.create(K.rng(94)); place(s, 2, 150, 400); place(s, 2, 175, 400); stepN(s, 2);
    let lv3 = 0; for (let i = 0; i < C.NP; i++) if (s.on[i] && s.lv[i] === 3) lv3++;
    ok(lv3 === 1 && count(s) === 1 && s.score === C.PTS[3] && s.merges === 1, 'planets: две луны → каменная планета (+8)', { score: s.score, n: count(s) });
    // разные не сливаются, расталкиваются
    s = spec.create(K.rng(95)); const a = place(s, 1, 150, 410), b = place(s, 3, 160, 400); stepN(s, 30);
    ok(count(s) === 2 && Math.hypot(s.x[a] - s.x[b], s.y[a] - s.y[b]) > C.RAD[1] + C.RAD[3] - 1.5, 'planets: разные тела не сливаются и не проходят друг сквозь друга');
    // две звезды — сверхновая: +500, обе исчезают
    s = spec.create(K.rng(96)); place(s, C.TOP, 100, 370); place(s, C.TOP, 200, 370); stepN(s, 2);
    ok(count(s) === 0 && s.score === C.NOVA && s.novas === 1, 'planets: две звезды — сверхновая +500');
    // комета разбивает первое, что задела
    s = spec.create(K.rng(97)); place(s, 5, 160, 395); place(s, C.COMET, 160, 340); s.vy[1] = 300; stepN(s, 20);
    ok(count(s) === 0 && s.score === C.PTS[5] + 5, 'planets: комета разбила планету', { n: count(s), score: s.score });
    // каждый 12-й бросок — комета
    s = spec.create(K.rng(98)); let comet = 0;
    for (let d = 0; d < 24; d++) { if (s.cur === C.COMET) comet++; s.want = 1; s.cd = 0; spec.step(s, K.STEP, inp); for (let i = 0; i < C.NP; i++) s.on[i] = 0; }
    ok(comet === 2, 'planets: на 24 броска — 2 кометы', comet);
    // переполнение: тело выше линии 2 с — конец; 2 минуты — конец
    // столбик из разных тел по одной вертикали (одинаковые не касаются — не сливаются): верх выше линии
    s = spec.create(K.rng(99)); s.idle = -1e9;
    for (let k = 0, y = C.FLOOR; k < 4; k++) { const t = k % 2 ? C.TOP - 1 : C.TOP, r = C.RAD[t]; place(s, t, 160, y - r); y -= 2 * r; }
    let n = 0; while (!s.over && n < 2000) { spec.step(s, K.STEP, inp); n++; }
    ok(s.over && s.why === 'full', 'planets: тела выше красной линии — переполнение, конец', { why: s.why, n });
    s = spec.create(K.rng(100)); s.idle = -1e9; n = 0; while (!s.over) { spec.step(s, K.STEP, inp); n++; }
    ok(s.why === 'time' && n === C.TIME, 'planets: 2 минуты — конец по времени');
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('planets')}; clearInterval(window.__bot); let held = 0;
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.planets._test, s = T.cur(); if (!s || s.over || s.drops >= ${stopAfter}) return;
        const C = T.spec.consts, rad = t => (t === C.COMET ? C.CR : C.RAD[t]);
        if (held) { if (T.inst()?.run?.inp.down) { __ptr('pointerup', s.aim, 300); held = 0; } return; }
        if (s.cd) return;
        let bx = -1, by = 1e9;
        for (let i = 0; i < C.NP; i++) { if (!s.on[i] || s.lv[i] === C.COMET) continue; const top = s.y[i] - rad(s.lv[i]); if ((s.cur === C.COMET || s.lv[i] === s.cur) && top < by) { by = top; bx = s.x[i]; } }
        if (bx < 0) { let low = -1e9; for (let c = 0; c < 8; c++) { const x = 20 + c * 40; let surf = C.FLOOR;
          for (let i = 0; i < C.NP; i++) if (s.on[i] && Math.abs(s.x[i] - x) < rad(s.lv[i]) + 10) surf = Math.min(surf, s.y[i] - rad(s.lv[i])); if (surf > low) { low = surf; bx = x; } } }
        __ptr('pointerdown', bx, 300); held = 1;
      }, ${gap}); return 1; })()`,
    gap: 150, stopB: 4,
    endByStop: false,    // 2 минуты (или переполнение) — партия кончается сама
    endMs: 130000,
    field: 'rs',
  },
};

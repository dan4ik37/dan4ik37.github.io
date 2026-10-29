// «Кирпичики» (js/games/arcade/bricks.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');

// куда придёт мяч на высоте дощечки (прямая с отражениями от боковых стен)
function aim(s, C){
  if (s.vy <= 0) return s.bx;
  const t = (C.PY0 - C.R - s.by) / s.vy, p = 2 * (C.W - 2 * C.R);
  let x = ((s.bx - C.R + s.vx * t) % p + p) % p;
  if (x > C.W - 2 * C.R) x = p - x;
  return x + C.R;
}

module.exports = {
  // палец «держит» дощечку и раз в gap шагов ставит её туда, куда придёт мяч, со сдвигом (чтобы мяч летел по-разному)
  bot(K, spec, gap = 3){
    const T = K.T, C = spec.consts;
    let last = -1e9, down = false;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      last = k;
      const x = aim(s, C) + ((s.bricks * 7) % 5 - 2) * 9;
      if (!down) { push(T.DOWN, x, 300, 0); down = true; } else push(T.MOVE, x, 300, 0);
    };
  },
  maxMs: 130000,
  garbage: { gap: 3, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x, k) => { ev.type = type; ev.x = x; ev.y = 300; ev.k = k || 0; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const count = s => { let n = 0; for (let i = 0; i < s.b.length; i++) n += s.b[i] ? 1 : 0; return n; };

    // старт: мяч лежит на дощечке, без нажатий партия идёт, а мяч сам летит через SERVE шагов — к центру
    let s = spec.create(K.rng(31));
    ok(s.stuck > 0 && s.lives === C.LIVES && s.left === count(s) && s.left > 10, 'bricks: старт — мяч на дощечке, стенка собрана', { left: s.left });
    stepN(s, 90);
    ok(!s.over && s.stuck > 0 && s.vy === 0, 'bricks: 1,5 с без нажатий — мяч ждёт, партия идёт');
    stepN(s, C.SERVE - 90);
    ok(!s.stuck && s.vy < 0 && !s.over, 'bricks: через SERVE шагов мяч летит сам (партия не стоит вечно)');
    // запуск тапом — к центру поля: дощечка слева → вправо, справа → влево
    s = spec.create(K.rng(32)); send(s, T.MOVE, 40); stepN(s, 30);
    send(s, T.DOWN, 40);
    ok(s.vx > 0 && s.vy < 0, 'bricks: дощечка слева — мяч летит вправо-вверх', { vx: s.vx });
    // скорость — за секунду: 30 шагов полёта = скорость × 0,5 с (прототип: «за кадр», на 144 Гц в 2,4 раза быстрее)
    s = spec.create(K.rng(33)); s.b.fill(0); s.left = 1; s.b[0] = 1; s.hp[0] = 1;
    send(s, T.DOWN, C.W / 2); const x0 = s.bx, y0 = s.by; stepN(s, 30);
    const d = Math.hypot(s.bx - x0, s.by - y0);
    ok(Math.abs(d - C.V0 * .5) < .5, 'bricks: за 0,5 с мяч пролетел V0 × 0,5 единиц поля', d);
    // баг прототипа: удар о БОК кирпича — отражение по горизонтали, вертикальная скорость не меняется
    s = spec.create(K.rng(34)); s.b.fill(0); s.hp.fill(0);
    const i = 3 * C.COLS + 4, bx = C.X0 + 4 * C.PX, by = C.Y0 + 3 * C.PY;
    s.b[i] = 1; s.hp[i] = 1; s.b[0] = 1; s.hp[0] = 1; s.left = 2; s.stuck = 0;
    s.bx = bx - C.R - 1; s.by = by + C.BH / 2; s.vx = 200; s.vy = -60;
    stepN(s, 2);
    ok(s.vx < 0 && s.vy < 0 && s.b[i] === 0 && s.score === 10, 'bricks: удар в бок — мяч отскочил вбок, вверх летит дальше (не «прошил» ряд)', { vx: s.vx, vy: s.vy });
    // крепкий кирпич — 2 удара; ⭐ — шире дощечка
    s = spec.create(K.rng(35)); s.b.fill(0); s.hp.fill(0); s.b[0] = 1; s.hp[0] = 1; s.left = 3; s.stuck = 0;
    const j = 2 * C.COLS + 2; s.b[j] = 2; s.hp[j] = 2;
    const put = (n, vy) => { const c = n % C.COLS, r = (n / C.COLS) | 0; s.bx = C.X0 + c * C.PX + C.BW / 2; s.by = C.Y0 + r * C.PY + C.BH + C.R + 1; s.vx = 0; s.vy = vy; };
    put(j, -300); stepN(s, 2);
    ok(s.b[j] === 2 && s.hp[j] === 1 && s.score === 10 && s.vy > 0, 'bricks: крепкий кирпич — первый удар трещина (+10)');
    put(j, -300); stepN(s, 2);
    ok(s.b[j] === 0 && s.score === 20, 'bricks: второй удар — разбит (+10)');
    const st = 4 * C.COLS + 6; s.b[st] = 3; s.hp[st] = 1;
    put(st, -300); stepN(s, 2);
    ok(s.b[st] === 0 && s.wide > 0 && s.score === 50, 'bricks: ⭐ — +30 и дощечка шире', { wide: s.wide, score: s.score });
    // мяч на пределе скорости не проскакивает дощечку (4 подшага)
    s = spec.create(K.rng(36)); s.level = 99; s.stuck = 0; s.px = s.tx = 160; s.bx = 160; s.by = C.PY0 - 30; s.vx = 0; s.vy = C.VMAX;
    stepN(s, 6);
    ok(s.vy < 0 && s.lives === C.LIVES, 'bricks: мяч на пределе скорости отбит, а не прошёл сквозь дощечку');
    // стенка разбита — +100, следующая стенка, мяч снова на дощечке
    s = spec.create(K.rng(37)); s.b.fill(0); s.hp.fill(0); s.stuck = 0;
    s.b[C.COLS + 1] = 1; s.hp[C.COLS + 1] = 1; s.left = 1;
    put(C.COLS + 1, -300); stepN(s, 2);
    ok(s.level === 2 && s.score === 110 && s.stuck > 0 && s.left === count(s) && s.left > 0, 'bricks: стенка разбита — +100, стенка 2, мяч на дощечке', { level: s.level, score: s.score });
    // 3 мяча мимо — конец без бонуса
    s = spec.create(K.rng(38)); s.px = s.tx = 20;
    let n = 0; while (!s.over && n < 60 * 60) { s.tx = s.px < 160 ? 300 : 20; if (!s.stuck) s.tx = s.bx < 160 ? 300 : 20; spec.step(s, K.STEP, inp); n++; }
    ok(s.over && s.why === 'balls' && s.lives === 0 && s.bonus === 0, 'bricks: дощечка убегает от мяча — 3 мяча мимо, конец', { why: s.why, steps: n });
    // 2 минуты — конец по времени, +50 за каждый мяч
    s = spec.create(K.rng(39)); n = 0;
    while (!s.over) { s.tx = aim(s, C); spec.step(s, K.STEP, inp); n++; }
    ok(s.why === 'time' && n === C.TIME && s.bonus === 50 * s.lives, 'bricks: 2 минуты — конец, бонус 50 за мяч', { why: s.why, n, lives: s.lives, score: s.score });
    // клавиши: ← двигает дощечку KEYV в секунду
    s = spec.create(K.rng(40)); inp.keys = 1; const p0 = s.px; stepN(s, 15); inp.keys = 0;
    ok(Math.abs((p0 - s.px) - 430 * .25) < 1e-6, 'bricks: ← — дощечка 430 единиц в секунду', p0 - s.px);
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('bricks')}; clearInterval(window.__bot); let down = 0;
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.bricks._test, s = T.cur(); if (!s || s.over) return;
        const C = T.spec.consts; let x = s.bx;
        // после stopAfter кирпичей (соперник B) — сдаётся: уводит дощечку от мяча
        if (s.bricks >= ${stopAfter}) { if (T.inst()?.run?.inp.down) __ptr('pointermove', s.bx < 160 ? 300 : 20, 300); return; }
        if (s.vy > 0) { const t = (C.PY0 - C.R - s.by) / s.vy, p = 2 * (C.W - 2 * C.R); x = ((s.bx - C.R + s.vx * t) % p + p) % p; if (x > C.W - 2 * C.R) x = p - x; x += C.R; }
        x += ((s.bricks * 7) % 5 - 2) * 9;
        if (!down || !T.inst()?.run?.inp.down) { __ptr('pointerdown', x, 300); down = 1; } else __ptr('pointermove', x, 300);
      }, ${gap}); return 1; })()`,
    gap: 30, stopB: 1,
    endByStop: true,     // бот перестал — дощечка стоит, мячи уходят вниз
    endMs: 125000,
    field: 'b',
  },
};

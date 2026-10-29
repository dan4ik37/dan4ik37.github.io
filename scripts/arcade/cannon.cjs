// «Пушка» (js/games/arcade/cannon.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// куда вести пушку: шарик падает рядом и низко — в сторону (туда, где свободнее); иначе — ловить ⚡; иначе — под ближайший
// шарик, который ещё высоко (с упреждением). (Строкой уходит и в e2e-бота.)
function goal(s, C){
  const danger = x => {
    let d = 0;
    for (let i = 0; i < C.NR; i++) {
      if (!s.on[i]) continue;
      const r = C.RAD[s.sz[i]], low = s.y[i] > C.GY - r - 70;
      const t = s.vy[i] > 0 ? Math.max(0, (C.GY - r - s.y[i]) / (s.vy[i] + 1)) : low ? 0 : 9;
      if (t > .7) continue;
      const gx = s.x[i] + s.vx[i] * t;
      if (Math.abs(gx - x) < r + C.CW / 2 + 16 || (low && Math.abs(s.x[i] - x) < r + C.CW / 2 + 16)) d++;
    }
    return d;
  };
  if (danger(s.cx)) {
    let bx = s.cx, bd = 1e9;
    for (let x = 16; x <= 304; x += 12) { const v = danger(x) * 1000 + Math.abs(x - s.cx); if (v < bd) { bd = v; bx = x; } }
    return bx;
  }
  if (s.zon && !danger(s.zx)) return s.zx;
  let best = -1, bd = 1e9;
  for (let i = 0; i < C.NR; i++) {
    if (!s.on[i]) continue;
    const x = s.x[i] + s.vx[i] * .3, d = Math.abs(x - s.cx);
    if (d < bd && !danger(x)) { bd = d; best = i; }
  }
  return best >= 0 ? s.x[best] + s.vx[best] * .3 : s.cx;
}

module.exports = {
  bot(K, spec, gap = 3){
    const T = K.T, C = spec.consts;
    let last = -1e9, down = false;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      last = k;
      const x = goal(s, C);
      if (!down) { push(T.DOWN, x, 300, 0); down = true; } else push(T.MOVE, x, 300, 0);
    };
  },
  maxMs: 130000,
  garbage: { gap: 3, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x) => { ev.type = type; ev.x = x; ev.y = 300; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const balls = s => { let n = 0; for (let i = 0; i < C.NR; i++) n += s.on[i]; return n; };
    const bullets = s => { let n = 0; for (let b = 0; b < C.NB; b++) n += s.bon[b]; return n; };
    const put = (s, z, x, y, hp) => { let i = 0; while (s.on[i]) i++; s.on[i] = 1; s.sz[i] = z; s.hp[i] = hp; s.h0[i] = hp; s.x[i] = x; s.y[i] = y; s.x0[i] = x; s.y0[i] = y; s.vx[i] = 0; s.vy[i] = 0; return i; };

    // старт: стреляет сама, первый шарик через полсекунды; без нажатий игра идёт
    let s = spec.create(K.rng(31));
    stepN(s, C.FIRE * 3);
    ok(bullets(s) >= 2 && !s.over, 'cannon: пушка стреляет сама, игра идёт', bullets(s));
    stepN(s, 30);
    ok(balls(s) === 1, 'cannon: появился большой шарик');
    // пуля — BV в секунду; пушка за пальцем не быстрее MOVEV
    s = spec.create(K.rng(32)); stepN(s, C.FIRE - 1); stepN(s, 1);
    let b0 = -1; for (let b = 0; b < C.NB; b++) if (s.bon[b]) b0 = b;
    const y0 = s.by[b0]; stepN(s, 6);
    ok(Math.abs((y0 - s.by[b0]) - C.BV * .1) < 1e-6, 'cannon: пуля — BV единиц в секунду', y0 - s.by[b0]);
    s = spec.create(K.rng(33)); send(s, T.DOWN, 300); stepN(s, 6);
    ok(Math.abs((s.cx - C.W / 2) - C.MOVEV * .1) < 1e-6, 'cannon: пушка за пальцем — MOVEV в секунду', s.cx - C.W / 2);
    // попадания: прочность −1 и +1 очко; ноль — делится на два меньших (+5), прототип: k.mh — не было
    s = spec.create(K.rng(34)); s.spawn = 1e9; const i = put(s, 0, C.W / 2, 200, 3);
    let n = 0; while (!s.pops && n < 300) { s.y[i] = 200; s.vy[i] = 0; s.vx[i] = 0; stepN(s, 1); n++; }
    let kids = 0, hp = 0; for (let j = 0; j < C.NR; j++) if (s.on[j] && s.sz[j] === 1) { kids++; hp = s.hp[j]; }
    ok(s.pops === 1 && kids === 2 && hp === 2 && s.score === 3 + 5 && s.zon === 1, 'cannon: 3 попадания — шарик делится на два (прочность ≥ 2), +3 +5, роняет ⚡', { kids, hp, score: s.score });
    // одна пуля — одно попадание, даже если два шарика рядом
    s = spec.create(K.rng(35)); s.spawn = 1e9; const a = put(s, 0, 160, 200, 50), b = put(s, 0, 160, 200, 50);
    s.bon.fill(0); s.bon[0] = 1; s.bx[0] = 160; s.by[0] = 200; s.by0[0] = 200; s.t = 1;
    spec.step(s, K.STEP, inp);
    ok(s.hp[a] + s.hp[b] === 99 && s.hits === 1, 'cannon: одна пуля отнимает прочность только у одного шарика', { a: s.hp[a], b: s.hp[b] });
    // самый маленький лопается без деления
    s = spec.create(K.rng(36)); s.spawn = 1e9; const m = put(s, 3, C.W / 2, 200, 1);
    n = 0; while (s.on[m] && n < 100) { s.y[m] = 200; s.vy[m] = 0; stepN(s, 1); n++; }
    ok(balls(s) === 0 && s.pops === 1, 'cannon: самый маленький шарик просто лопается');
    // ⚡ поймал — двойной огонь
    s = spec.create(K.rng(37)); s.zon = 1; s.zx = s.cx; s.zy = C.CY - 20; s.zy0 = s.zy; stepN(s, 12);
    ok(s.pwr > 0 && s.zon === 0, 'cannon: ⚡ пойман — двойной огонь');
    const b1 = bullets(s); stepN(s, C.FIRE);
    ok(bullets(s) - b1 === 2, 'cannon: с ⚡ — две пули за выстрел');
    // удар по пушке: −❤ и неуязвимость; 3 ❤ — конец
    s = spec.create(K.rng(38)); s.spawn = 1e9; put(s, 0, s.cx, C.CY - 25, 99); stepN(s, 12);
    ok(s.hearts === C.HEARTS - 1 && s.safe > 0 && !s.over, 'cannon: шарик прыгнул на пушку — минус ❤, пушка мигает', s.hearts);
    s.hearts = 1; s.safe = 0; put(s, 0, s.cx, C.CY - 25, 99); stepN(s, 30);
    ok(s.over && s.why === 'hit', 'cannon: последний ❤ — конец');
    // 2 минуты — конец (пушка убегает от шариков)
    s = spec.create(K.rng(39)); n = 0; while (!s.over) { s.tx = goal(s, C); spec.step(s, K.STEP, inp); n++; }
    ok(s.over && (s.why === 'time' ? n === C.TIME : n < C.TIME), 'cannon: партия кончается (2 минуты или ❤)', { why: s.why, n });
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('cannon')}; clearInterval(window.__bot); let down = 0;
      const goal = ${goal.toString()};
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.cannon._test, s = T.cur(); if (!s || s.over) return;
        const C = T.spec.consts;
        // после stopAfter попаданий (соперник B) — встаёт под шарики и ждёт
        const x = s.hits >= ${stopAfter} ? (() => { for (let i = 0; i < C.NR; i++) if (s.on[i]) return s.x[i]; return s.cx; })() : goal(s, C);
        if (!down || !T.inst()?.run?.inp.down) { __ptr('pointerdown', x, 300); down = 1; } else __ptr('pointermove', x, 300);
      }, ${gap}); return 1; })()`,
    gap: 40, stopB: 6,
    endByStop: false,    // 2 минуты или ❤ кончились
    endMs: 130000,
    field: 'x',
  },
};

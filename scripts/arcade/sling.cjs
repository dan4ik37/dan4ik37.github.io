// «Рогатка» (js/games/arcade/sling.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// подбор оттяжки: перебор угла и силы, полёт по параболе — проходит через цель ближе 5 единиц и не задевает ящики по пути.
// Цели по очереди: золотая, потом нижние банки столбиков (сбил нижнюю — падают и верхние). Ответ — смещение пальца [dx, dy]
// или null. (Строкой уходит и в e2e-бота.)
function plan(s, C, salt){
  const order = [];
  for (let i = 0; i < C.NC; i++) if (s.st[i] === 1) order.push([(s.gold[i] ? 100 : 0) - s.lvl[i] * 10 + ((i * 7 + salt) % 5), i]);
  order.sort((a, b) => b[0] - a[0]);
  const blocked = (x, y) => {
    for (let p = 0; p < s.pn; p++) if (s.pY[p] < C.GY && x > s.pX[p] - 18 - C.SR && x < s.pX[p] + 18 + C.SR && y > s.pY[p] - C.SR) return true;
    return y > C.GY - C.SR;
  };
  for (const [, ti] of order) {
    const tx = s.cx[ti], ty = s.cy[ti];
    for (let pw = 40; pw <= 100; pw += 2) {
      for (let a = 0; a <= 80; a += 2) {
        const ang = (a - 10) * Math.PI / 180, d = C.PULL * pw / 100;
        const px = C.AX - Math.cos(ang) * d, py = C.AY + Math.sin(ang) * d;
        let x = px, y = py, vx = (C.AX - px) * C.KS, vy = (C.AY - py) * C.KS;
        for (let n = 0; n < 700; n++) {
          vy += C.G0 / 180; x += vx / 180; y += vy / 180;
          if ((x - tx) * (x - tx) + (y - ty) * (y - ty) < 25) return [px - C.AX, py - C.AY];
          if (x > C.W || blocked(x, y)) break;
        }
      }
    }
  }
  return null;
}

module.exports = {
  bot(K, spec, gap = 20){
    const T = K.T, C = spec.consts;
    let last = -1e9, held = 0, mv = null;
    return (s, k, push) => {
      if (s.over) return;
      if (held === 1) { push(T.MOVE, 200 + mv[0], 200 + mv[1], 0); held = 2; return; }
      if (held === 2) { push(T.UP, 200 + mv[0], 200 + mv[1], 0); held = 0; return; }
      if (s.fly || s.stones <= 0 || s.next || k - last < gap) return;
      let m = 0; for (let i = 0; i < C.NC; i++) m += s.st[i] === 2;
      if (m) return;
      last = k;
      mv = plan(s, C, s.shots) || [-60, 30];
      push(T.DOWN, 200, 200, 0); held = 1;
    };
  },
  maxMs: 130000,
  garbage: { gap: 20, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x, y, k) => { ev.type = type; ev.x = x; ev.y = y; ev.k = k || 0; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const standing = s => { let n = 0; for (let i = 0; i < C.NC; i++) n += s.st[i] === 1; return n; };
    const shoot = (s, dx, dy) => { send(s, T.DOWN, 200, 200); send(s, T.MOVE, 200 + dx, 200 + dy); send(s, T.UP, 200 + dx, 200 + dy); };
    // пауза / потеря фокуса с натянутой резинкой (T.CANCEL) — без выстрела, камешек на месте (проверка T-140)
    { const c = spec.create(K.rng(40)); stepN(c, 5); const st0 = c.stones; send(c, T.DOWN, 200, 200); send(c, T.MOVE, 140, 240); send(c, T.CANCEL, 0, 0); send(c, T.UP, 140, 240); stepN(c, 5);
      ok(c.pull === 0 && !c.fly && c.stones === st0 && c.px === C.AX && c.py === C.AY, 'sling: пауза с натянутой резинкой — без выстрела, резинка назад', { pull: c.pull, fly: c.fly, stones: c.stones }); }

    // старт: 2 места с банками, одна золотая; без нажатий ничего не летит, игра идёт
    let s = spec.create(K.rng(41));
    let gold = 0; for (let i = 0; i < C.NC; i++) gold += s.gold[i];
    ok(s.stage === 1 && s.pn === 2 && standing(s) >= 2 && gold === 1 && s.stones === C.STONES, 'sling: тир 1 — 2 места, банки, одна ⭐', { n: standing(s) });
    stepN(s, 240);
    ok(!s.over && !s.fly && s.stones === C.STONES, 'sling: 4 с без нажатий — ничего не летит, игра идёт');
    // просто тап (без оттяжки) — не выстрел, камешек не потерян (баг «нажал — сразу конец»)
    send(s, T.DOWN, 150, 200); send(s, T.UP, 150, 200); stepN(s, 2);
    ok(!s.fly && s.stones === C.STONES && s.shots === 0, 'sling: тап без оттяжки — выстрела нет, камешек цел');
    // оттяжка с любого места: палец вниз-влево → камешек летит вверх-вправо со скоростью оттяжка × KS (в секунду)
    s = spec.create(K.rng(42)); shoot(s, -56, 56);
    ok(s.fly === 1 && s.stones === C.STONES - 1 && Math.abs(s.vx - 56 * C.KS) < 1e-6 && Math.abs(s.vy + 56 * C.KS) < 1e-6, 'sling: оттяжка с любого места поля — камешек летит в обратную сторону', { vx: s.vx, vy: s.vy });
    const x0 = s.sx; stepN(s, 6);
    ok(Math.abs((s.sx - x0) - 56 * C.KS * .1) < .5, 'sling: за 0,1 с камешек пролетел vx × 0,1 по горизонтали', s.sx - x0);
    // попадание: подбор оттяжки по банке — банка сбита (+10 или +30)
    s = spec.create(K.rng(43));
    const n0 = standing(s), mv = plan(s, C, 0);
    shoot(s, mv[0], mv[1]); stepN(s, 240);
    ok(s.cans >= 1 && standing(s) < n0 && s.score >= 10, 'sling: прицельный выстрел — банка сбита', { cans: s.cans, score: s.score });
    // домино: падающая банка сбивает стоящую рядом
    s = spec.create(K.rng(44)); s.st.fill(0); s.pn = 0;
    s.st[0] = 1; s.cx[0] = 200; s.cy[0] = C.GY - C.CH / 2; s.plat[0] = 0; s.lvl[0] = 0; s.gold[0] = 0;
    s.st[1] = 2; s.cx[1] = 186; s.cy[1] = C.GY - 30; s.cvx[1] = 200; s.cvy[1] = 0; s.plat[1] = 1;
    s.st[2] = 1; s.cx[2] = 300; s.cy[2] = C.GY - C.CH / 2; s.plat[2] = 2; s.gold[2] = 0;
    stepN(s, 10);
    ok(s.st[0] === 2 && s.cans === 1 && s.score === 10, 'sling: падающая банка сбила соседнюю (домино)', { st: s.st[0], score: s.score });
    // все сбиты — +50, новый тир, +2 камешка (не больше 6)
    s = spec.create(K.rng(45)); s.stones = 3; for (let i = 0; i < C.NC; i++) if (s.st[i] === 1) s.st[i] = 3;
    stepN(s, 1);
    ok(s.clears === 1 && s.score === 50 && s.stones === 5, 'sling: тир очищен — +50 и +2 камешка');
    shoot(s, -56, 56);
    ok(!s.fly && s.stones === 5, 'sling: пока меняется тир — выстрела нет (камешек не тратится)');
    stepN(s, C.NEXT);
    ok(s.stage === 2 && standing(s) >= 2, 'sling: потом новый тир');
    // камешки кончились — конец; 2 минуты — конец
    s = spec.create(K.rng(46)); s.stones = 1; shoot(s, 20, 60); let n = 0; while (!s.over && n < 2000) { spec.step(s, K.STEP, inp); n++; }
    ok(s.over && s.why === 'stones' && s.stones === 0, 'sling: последний камешек мимо — конец', { why: s.why, cans: s.cans });
    s = spec.create(K.rng(47)); n = 0; while (!s.over) { spec.step(s, K.STEP, inp); n++; }
    ok(s.why === 'time' && n === C.TIME, 'sling: 2 минуты — конец по времени');
    // клавиатура: пробел — выстрел с прицелом клавиатуры (вверх-вправо)
    s = spec.create(K.rng(48)); send(s, T.KEY, 0, 0, 4); stepN(s, 1);
    ok(s.fly === 1 && s.vx > 0 && s.vy < 0, 'sling: пробел — выстрел с прицелом клавиатуры');
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('sling')}; clearInterval(window.__bot); let held = 0, mv = null;
      const plan = ${plan.toString()};
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.sling._test, s = T.cur(); if (!s || s.over || s.shots >= ${stopAfter}) return;
        const C = T.spec.consts;
        if (held === 1) { __ptr('pointermove', 200 + mv[0], 200 + mv[1]); held = 2; return; }
        if (held === 2) { __ptr('pointerup', 200 + mv[0], 200 + mv[1]); held = 0; return; }
        if (s.fly || s.stones <= 0 || s.next) return;
        for (let i = 0; i < C.NC; i++) if (s.st[i] === 2) return;
        mv = plan(s, C, s.shots) || [-60, 30];
        __ptr('pointerdown', 200, 200); held = 1;
      }, ${gap}); return 1; })()`,
    gap: 150, stopB: 2,
    endByStop: false,    // камешки кончаются или 2 минуты
    endMs: 130000,
    field: 'cx',
  },
};

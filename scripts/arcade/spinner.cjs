// «Спиннер» (js/games/arcade/spinner.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const TAU = Math.PI * 2;
module.exports = {
  // медленно — свайп четверть круга (DOWN, 4 × MOVE по шагу, UP); быстро — прижать палец (тормоз), пока не вернётся в зону
  bot(K, spec, gap = 10){
    const T = K.T, C = spec.consts;
    let m = 0, j = 0, th = 0;
    const at = a => [C.CX + 100 * Math.cos(a), C.CY + 100 * Math.sin(a)];
    return (s, k, push) => {
      if (s.over) return;
      const rev = Math.abs(s.w) / TAU;
      if (m === 1) { j++; const p = at(th + j * Math.PI / 8); if (j <= 4) push(T.MOVE, p[0], p[1], 0); else { push(T.UP, p[0], p[1], 0); m = 0; } return; }
      if (m === 2) { if (++j >= 30 || rev < s.lo + 1.4) { push(T.UP, C.CX, C.CY + 100, 0); m = 0; } return; }
      if (k % gap) return;
      if (rev < s.lo + .8) { m = 1; j = 0; th = (k * .37) % TAU; const p = at(th); push(T.DOWN, p[0], p[1], 0); }
      else if (rev > s.lo + C.BW - .6) { m = 2; j = 0; push(T.DOWN, C.CX, C.CY + 100, 0); }
    };
  },
  maxMs: 60000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x, y, k) => { ev.type = type; ev.x = x; ev.y = y; ev.k = k || 0; spec.input(s, ev, inp); };
    const at = a => [C.CX + 100 * Math.cos(a), C.CY + 100 * Math.sin(a)];
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const swipe = (s, a0, a1, n) => { send(s, T.DOWN, ...at(a0)); spec.step(s, K.STEP, inp); for (let i = 1; i <= n; i++) { send(s, T.MOVE, ...at(a0 + (a1 - a0) * i / n)); spec.step(s, K.STEP, inp); } send(s, T.UP, ...at(a1)); };

    let s = spec.create(K.rng(111));
    ok(s.bands.every((v, i) => v >= 2 && v <= 11 && (!i || v !== s.bands[i - 1])) && s.lo === s.bands[0], 'spinner: зоны 2…11 об/с, соседние разные');
    // свайп на четверть круга добавляет GAIN × π/2 (≈ 1,5 об/с) — сколько бы событий ни было (быстро или медленно)
    swipe(s, 0, Math.PI / 2, 4);
    const w1 = s.w;
    s = spec.create(K.rng(111)); swipe(s, 0, Math.PI / 2, 16);
    const w2 = s.w;
    // (за время свайпа уже работает трение: 4 и 16 шагов — e^(−FR × шаги / 60) от прибавки, не меньше)
    const add = C.GAIN * Math.PI / 2;
    ok(w1 <= add && w1 > add * Math.exp(-C.FR * 5 / 60) - 1e-9 && w2 <= add && w2 > add * Math.exp(-C.FR * 17 / 60) - 1e-9, 'spinner: четверть круга — +1,5 об/с за 4 и за 16 событий (минус трение за время свайпа)', { w1, w2, add });
    // трение — в секунду: через 1 с без касаний w × e^(−FR)
    s.w = 10 * TAU; stepN(s, 60);
    ok(Math.abs(s.w / (10 * TAU) - Math.exp(-C.FR)) < 1e-9, 'spinner: трение — e^(−0,2) за секунду', s.w / (10 * TAU));
    // палец стоит дольше 0,1 с — тормоз; свайп в обратную сторону — тоже медленнее
    s.w = 10 * TAU; send(s, T.DOWN, C.CX, C.CY + 100); stepN(s, 60);
    ok(s.w < 10 * TAU * Math.exp(-C.FR - C.BR * (60 - C.STILL - 1) / 60) * 1.0001 && s.w > 0, 'spinner: прижатый палец тормозит', s.w / TAU);
    send(s, T.UP, C.CX, C.CY + 100);
    const wb = s.w; swipe(s, Math.PI / 2, 0, 4);
    ok(s.w < wb, 'spinner: свайп против вращения — медленнее');
    // клавиши: пробел — толчок FLICK в сторону вращения; ↓ — тормоз
    s = spec.create(K.rng(112)); send(s, T.KEY, 0, 0, 0);
    ok(Math.abs(s.w - C.FLICK) < 1e-9, 'spinner: пробел — толчок +1,5 об/с');
    s.w = -5; send(s, T.KEY, 0, 0, 0); ok(Math.abs(s.w + 5 + C.FLICK) < 1e-9, 'spinner: толчок — в сторону вращения');
    s.w = 8 * TAU; inp.keys = 2; stepN(s, 60); inp.keys = 0;
    ok(Math.abs(s.w / (8 * TAU) - Math.exp(-C.FR - C.BR)) < 1e-9, 'spinner: ↓ — тормоз e^(−3) за секунду');
    // очки в зоне: 1 с в зоне — +10; держишься 2 с — 🔥 ×2
    s = spec.create(K.rng(113));
    const w = (s.lo + 1.5) * TAU;
    for (let i = 0; i < 60; i++) { s.w = w; spec.step(s, K.STEP, inp); }
    ok(s.score === 10 && s.inb, 'spinner: секунда в зоне — +10', s.score);
    for (let i = 0; i < 120; i++) { s.w = w; spec.step(s, K.STEP, inp); }
    ok(s.fires === 1 && s.score === 10 + 10 + 20, 'spinner: в зоне дольше 2 с — 🔥, очки ×2', { score: s.score, fires: s.fires });
    s.w = 0; stepN(s, 1); ok(!s.inb && s.streak === 0, 'spinner: вышел из зоны — серия сброшена');
    // зона меняется каждые 5 с; партия — 40 с
    s = spec.create(K.rng(114)); stepN(s, C.BAND);
    ok(s.bi === 1 && s.lo === s.bands[1], 'spinner: через 5 с — новая зона');
    stepN(s, C.TIME);
    ok(s.over && s.left === 0 && s.score === 0 && !spec.win(s), 'spinner: 40 с — конец партии');
    // скорость не выше WMAX
    s = spec.create(K.rng(115)); for (let i = 0; i < 40; i++) send(s, T.KEY, 0, 0, 0); stepN(s, 1);
    ok(Math.abs(s.w) <= C.WMAX, 'spinner: скорость ограничена');
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящие PointerEvent по холсту — свайп четверть круга или прижатый палец;
  // stopAfter — после стольких очков бот отпускает спиннер
  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { clearInterval(window.__bot); window.__sp = { m: 0, j: 0, th: 0 }; window.__bot = setInterval(() => {
      const G = GAME_IMPL.spinner._test, s = G.cur(); if (!s || s.over) return;
      const C = G.spec.consts, cv = document.querySelector('.ak-cv'), r = cv.getBoundingClientRect(), B = window.__sp, rev = Math.abs(s.w) / (2 * Math.PI);
      const P = (type, a, rr) => cv.dispatchEvent(new PointerEvent(type, { clientX: r.left + (C.CX + rr * Math.cos(a)) * r.width / C.W, clientY: r.top + (C.CY + rr * Math.sin(a)) * r.height / C.H,
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
      if (B.m === 1) { B.j++; P(B.j <= 4 ? 'pointermove' : 'pointerup', B.th + B.j * Math.PI / 8, 100); if (B.j > 4) B.m = 0; return; }
      if (B.m === 2) { if (++B.j >= 8 || rev < s.lo + 1.4) { P('pointerup', Math.PI / 2, 100); B.m = 0; } return; }
      if (s.score >= ${stopAfter}) return;
      if (rev < s.lo + .8) { B.m = 1; B.j = 0; B.th = (performance.now() / 300) % 6.28; P('pointerdown', B.th, 100); }
      else if (rev > s.lo + 2.4) { B.m = 2; B.j = 0; P('pointerdown', Math.PI / 2, 100); }
    }, ${gap}); return 1; })()`,
    gap: 45, stopB: 25,
    endByStop: false,    // партия кончается сама через 40 с
    endMs: 45000,
    field: 'bands',
  },
};

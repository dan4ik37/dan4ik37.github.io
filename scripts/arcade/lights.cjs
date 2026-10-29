// «Свет в окнах» (js/games/arcade/lights.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
module.exports = {
  // нажимает окна решения по одному раз в 20 шагов; каждое 7-е нажатие — лишнее окно (меньше ⭐, разнообразнее партии)
  bot(K, spec){
    const T = K.T;
    let last = -1e9, i = 0, house = -1, cnt = 0;
    return (s, k, push) => {
      if (s.over || s.wait || k - last < 20) return;
      if (s.house !== house) { house = s.house; i = 0; }
      last = k; cnt++;
      if (cnt % 7 === 0) { push(T.PICK, 0, 0, (s.sol[0] + 1) % (s.n * s.n)); push(T.PICK, 0, 0, (s.sol[0] + 1) % (s.n * s.n)); return; }   // туда-обратно
      if (i < s.par) push(T.PICK, 0, 0, s.sol[i++]);
    };
  },
  maxMs: 180000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const lit = s => { let c = 0; for (let i = 0; i < s.n * s.n; i++) c += s.g[i]; return c; };
    // идеальная ночь: решение из генератора (= норма) → 5 × 100, 5 ⭐, бонус за оставшиеся секунды
    let s = spec.create(K.rng(21));
    for (let h = 0; h < C.HOUSES.length; h++) {
      ok(s.house === h && s.n === C.HOUSES[h][0] && lit(s) > 0, 'lights: дом ' + (h + 1) + ' — сторона ' + C.HOUSES[h][0] + ', свет горит');
      stepN(s, 30);   // полсекунды «думает»
      for (let i = 0; i < s.par; i++) pick(s, s.sol[i]);
      ok(lit(s) === 0 && s.wait === C.WAIT, 'lights: решение генератора гасит дом ' + (h + 1));
      pick(s, 0); ok(lit(s) === 0, 'lights: пока дом засыпает, нажатия не считаются');
      stepN(s, C.WAIT);   // пауза «дом уснул» — часы стоят
    }
    const used = C.HOUSES.length * 30;   // шагов прошло вне пауз
    ok(s.over && s.solved === 5 && s.stars === 5 && s.score === 500 + 3 * Math.ceil((C.TIME - used) / 60), 'lights: 5 домов в норму — 500 + 3 × секунды', { score: s.score, stars: s.stars });
    ok(spec.win(s), 'lights: все дома — победа (XP)');
    // лишние нажатия: −10 за каждое сверх нормы, без ⭐
    s = spec.create(K.rng(22));
    pick(s, 0); pick(s, 0);
    for (let i = 0; i < s.par; i++) pick(s, s.sol[i]);
    ok(s.solved === 1 && s.stars === 0 && s.score === 80, 'lights: 2 лишних нажатия — 80 очков, без ⭐', { score: s.score });
    // время вышло — конец, счёт за решённое
    s = spec.create(K.rng(23)); stepN(s, C.TIME + 5);
    ok(s.over && s.score === 0 && s.left === 0, 'lights: 2 минуты без решения — утро, 0 очков');
    ok(!spec.win(s), 'lights: не успел — не победа');
    // генератор: 3000 ночей — каждый дом с горящим светом, решение = норма нажатий по разным окнам
    let bad = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const q = spec.create(K.rng(seed * 7919));
      for (let h = 0; h < C.HOUSES.length; h++) {
        const set = new Set(); for (let i = 0; i < q.par; i++) set.add(q.sol[i]);
        if (lit(q) === 0 || set.size !== q.par) bad++;
        for (let i = 0; i < q.par; i++) pick(q, q.sol[i]);
        if (lit(q) !== 0) bad++;
        stepN(q, C.WAIT);
      }
    }
    ok(bad === 0, 'lights: 3000 ночей — все дома решаются за норму', bad);
  },

  // Chrome (scripts/arcade-e2e.cjs): нажимает окна решения настоящим click не чаще раза в gap мс; stopAfter — после стольких домов
  e2e: {
    // следующее окно — sol[moves]: нажатие, которое игра не приняла (пауза), повторится
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.lights._test.cur(); if (!s || s.over || s.wait || s.solved >= ${stopAfter} || s.moves >= s.par) return;
      document.querySelector('.lt-win[data-k="' + s.sol[s.moves] + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 260, stopB: 1,
    endByStop: false,    // бот укладывает все дома — партия кончается сама
    endMs: 130000,       // соперник B бросает после 1 дома — его партию кончает утро (2 мин)
    field: 'g',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.solved === 5`), 'lights: бот уложил все 5 домов'); },
  },
};

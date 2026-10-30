// «Парковка» (js/games/arcade/parking.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// последняя поставленная из оставшихся машин всегда свободна; запертая — первая, у которой путь занят
const lastFree = s => { for (let i = s.n - 1; i >= 0; i--) if (s.alive[i]) return i; return -1; };
module.exports = {
  // выпускает машины в обратном порядке постановки; каждое 7-е нажатие — по запертой машине (БИП, −5; меньше 3 на стоянку —
  // эвакуатор не приезжает, бот проходит все три стоянки)
  bot(K, spec, gap = 15){
    const T = K.T, C = spec.consts;
    let last = -1e9, cnt = 0;
    return (s, k, push) => {
      if (s.over || s.wait || k - last < gap) return;
      last = k;
      if (++cnt % 7 === 0) for (let i = 0; i < s.n; i++) if (s.alive[i] && C.blocker(s, i) >= 0) { push(T.PICK, 0, 0, i); return; }
      const i = lastFree(s);
      if (i >= 0) push(T.PICK, 0, 0, i);
    };
  },
  maxMs: 150000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
    const clear = s => { let i; while (!s.wait && (i = lastFree(s)) >= 0) pick(s, i); };

    let s = spec.create(K.rng(71));
    ok(s.lot === 0 && s.n === s.ln[0] && s.cars === s.n && s.n >= 8, 'parking: стоянка 1 — машины стоят', { n: s.n });
    // запертая машина: БИП, помеха подсвечена, −5 (не ниже 0), машина стоит
    let lock = -1; for (let i = 0; i < s.n; i++) if (C.blocker(s, i) >= 0) { lock = i; break; }
    ok(lock >= 0, 'parking: на стоянке есть запертые машины');
    pick(s, lock);
    ok(s.alive[lock] && s.score === 0 && s.honk === C.blocker(s, lock) && s.who === lock && s.bumps === 1, 'parking: путь занят — БИП, помеха качается, очки не ниже 0', { honk: s.honk });
    stepN(s, C.HONK); ok(s.honk === -1, 'parking: БИП проходит');
    // свободная уезжает: +10, клетки освобождаются
    const f = lastFree(s); pick(s, f);
    ok(!s.alive[f] && s.score === 10 && s.cars === s.n - 1 && !s.occ.includes(f), 'parking: свободная машина уехала — +10, клетки свободны');
    pick(s, lock);
    const sc = s.score;
    ok(sc === 5 || !s.alive[lock], 'parking: врезался после очков — −5', { sc });
    // вся стоянка: +30, пауза, нажатия не считаются
    s = spec.create(K.rng(72)); clear(s);
    ok(s.wait === C.WAIT && s.score === 10 * s.n + 30 && s.solved === 1, 'parking: стоянка пуста — 10 × машин + 30', { score: s.score, n: s.n });
    // целая партия без БИП: 10 × все машины + 3 × 30 + 2 × секунды
    s = spec.create(K.rng(73));
    let total = 0;
    for (let L = 0; L < 3; L++) { ok(s.lot === L, 'parking: стоянка ' + (L + 1)); total += s.n; stepN(s, 60); clear(s); stepN(s, C.WAIT); }
    ok(s.over && s.score === 10 * total + 90 + 2 * Math.ceil((C.TIME - 180) / 60) && spec.win(s), 'parking: 3 стоянки — 10 × машин + 90 + 2 × секунды', { score: s.score, total });
    // проверка T-140 (D3): TOW БИП на одной стоянке — эвакуатор: оставшиеся увезли (0 за них, без +30), следующая стоянка;
    // бонус за время — только за три пустые стоянки
    s = spec.create(K.rng(75));
    { const f0 = lastFree(s); pick(s, f0); let lk = -1; for (let i = 0; i < s.n; i++) if (s.alive[i] && C.blocker(s, i) >= 0) { lk = i; break; }
      for (let t = 0; t < C.TOW - 1; t++) pick(s, lk);
      ok(!s.wait && s.lb === C.TOW - 1 && s.score === 0, 'parking: ' + (C.TOW - 1) + ' БИП — стоянка ещё открыта', { lb: s.lb, score: s.score });
      const left = s.cars; pick(s, lk);
      ok(s.wait === C.WAIT && s.tw === 1 && s.towed === left && s.solved === 0 && s.score === 0, 'parking: ' + C.TOW + '-й БИП — эвакуатор: машины увезли, +30 нет', { towed: s.towed, left, score: s.score });
      pick(s, lastFree(s)); ok(s.gone === 1, 'parking: пока эвакуатор — нажатия не считаются');
      stepN(s, C.WAIT); ok(s.lot === 1 && s.lb === 0 && s.tw === 0 && !s.over, 'parking: после эвакуатора — следующая стоянка, БИП с нуля'); }
    { const z = spec.create(K.rng(76)); for (let L = 0; L < 3; L++) { if (L < 2) clear(z); else { let lk = -1; for (let i = 0; i < z.n; i++) if (C.blocker(z, i) >= 0) { lk = i; break; } for (let t = 0; t < C.TOW; t++) pick(z, lk); } stepN(z, C.WAIT); }
      ok(z.over && z.solved === 2 && z.bonus === 0 && !spec.win(z), 'parking: последнюю стоянку увёз эвакуатор — без бонуса за время и не победа', { solved: z.solved, bonus: z.bonus }); }
    // нажимать подряд все машины, не думая (было: 40 из 40 побед, 501–574 очка против 599 у решателя) — ни одной победы
    // и меньше трети очков того, кто думает 2 с над каждой машиной
    { const T2 = K.T, sim = mk => { let w = 0, sc = 0; for (let seed = 1; seed <= 40; seed++) { const r = K.sim(spec, { seed, fps: 60, maxMs: 200000, bot: mk() }); w += spec.win(r.s) ? 1 : 0; sc += r.score; } return { w, mean: Math.round(sc / 40) }; };
      const spam = {};
      for (const gap of [10, 20, 45]) spam[gap] = sim(() => (q, k, push) => { if (k % gap === 0) push(T2.PICK, 0, 0, (k / gap) % 13); });
      const think = sim(() => { let last = -1e9; return (q, k, push) => { if (q.over || q.wait || k - last < 120) return; last = k; for (let i = 0; i < q.n; i++) if (q.alive[i] && C.blocker(q, i) < 0) { push(T2.PICK, 0, 0, i); return; } }; });
      ok(Object.values(spam).every(v => v.w === 0 && v.mean * 3 < think.mean) && think.w === 40, 'parking: все машины подряд без раздумий — 0 побед из 40 и меньше трети очков того, кто думает 2 с на машину', { spam, think }); }
    // время вышло
    s = spec.create(K.rng(74)); stepN(s, C.TIME + 5);
    ok(s.over && s.score === 0 && !spec.win(s), 'parking: 2 минуты без машин — конец');
    // генератор: 2000 партий — каждую стоянку можно выпустить в обратном порядке; сколько машин получается
    let bad = 0; const mins = [99, 99, 99], sums = [0, 0, 0];
    for (let seed = 1; seed <= 2000; seed++) {
      const q = spec.create(K.rng(seed * 7919));
      for (let L = 0; L < 3; L++) {
        mins[L] = Math.min(mins[L], q.n); sums[L] += q.n;
        for (let i = q.n - 1; i >= 0; i--) { if (C.blocker(q, i) >= 0) bad++; pick(q, i); }
        if (!q.wait) bad++;
        stepN(q, C.WAIT);
      }
    }
    console.log('  parking: машин на стоянках (2000 партий): меньше всего ' + mins.join(' / ') + ', в среднем ' + sums.map(x => (x / 2000).toFixed(1)).join(' / ') + ' (цель ' + C.LOTS.join(' / ') + ')');
    ok(bad === 0 && mins[0] === C.LOTS[0] && mins[1] >= C.LOTS[1] - 1 && mins[2] >= 9, 'parking: 2000 партий — все стоянки решаются', { bad, mins });
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по последней свободной машине; stopAfter — после стольких стоянок перестаёт
  e2e: {
    bot: (gap, stopAfter = 99) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.parking._test.cur(); if (!s || s.over || s.wait || s.solved >= ${stopAfter}) return;
      for (let i = s.n - 1; i >= 0; i--) if (s.alive[i]) { document.querySelector('.pk-c[data-k="' + i + '"]')?.click(); return; }
    }, ${gap}); return 1; })()`,
    gap: 220, stopB: 1,
    endByStop: false,    // бот выпускает все машины — партия кончается сама
    endMs: 130000,       // соперник B бросает после 1 стоянки — его партию кончает время (2 мин)
    field: 'lx',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.solved === 3 && ${cur}.bumps === 0`), 'parking: бот выпустил все машины трёх стоянок без БИП'); },
  },
};

// «Питомец» (js/games/arcade/pet.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
// заботливый хозяин: исполняет желание, иначе помогает с самой низкой шкалой (ниже lo), шкалы выше 85 не трогает
const choose = (s, lo, FULL) => {
  if (s.busy) return -1;
  if (s.wish >= 0 && s.need[s.wish] <= FULL) return s.wish;
  let k = 0;
  for (let i = 1; i < 3; i++) if (s.need[i] < s.need[k]) k = i;
  return s.need[k] < lo ? k : -1;
};
module.exports = {
  // gap — реакция бота (шагов); lo — когда спохватывается
  bot(K, spec, gap = 6, lo = 60){
    const T = K.T, FULL = spec.consts.FULL;
    let last = -1e9;
    return (s, k, push) => {
      if (s.over || k - last < gap) return;
      const a = choose(s, lo, FULL);
      if (a < 0) return;
      last = k; push(T.PICK, 0, 0, a);
    };
  },
  maxMs: 200000,
  garbage: { ms: 10 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
    const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
    const key = (s, k) => { ev.type = T.KEY; ev.k = k; spec.input(s, ev); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };

    // без заботы — уходит гулять (еда тает быстрее всего: 70 / 2,3 в секунду с разгоном ≈ 25–30 с)
    let s = spec.create(K.rng(81));
    stepN(s, C.DAY);
    ok(s.over && s.why === 'run' && s.t > 20 * 60 && s.t < 32 * 60 && !spec.win(s), 'pet: без заботы — ушёл гулять через ~25 с', { t: s.t, why: s.why });
    // покормить: +30, Буся занят — второе нажатие не считается; занят — шкалы всё равно тают
    s = spec.create(K.rng(82));
    stepN(s, 120);
    const f0 = s.need[0];
    pick(s, 0);
    ok(Math.abs(s.need[0] - (f0 + C.GAIN[0])) < 1e-9 && s.busy === C.BUSY[0] && s.act === 0, 'pet: «Кормить» — +30 к еде, Буся ест');
    pick(s, 1);
    ok(s.act === 0 && s.busy === C.BUSY[0], 'pet: пока ест — другие кнопки не нажимаются');
    stepN(s, C.BUSY[0]);
    ok(s.act === -1 && s.busy === 0, 'pet: доел — снова свободен');
    // лишняя забота: шкала > 85 — «Не хочу!», −3, шкала не растёт
    s.need[1] = 90; s.score = 10;
    key(s, 1);
    ok(s.need[1] === 90 && s.score === 7 && s.grump === C.GRUMP && s.nos === 1, 'pet: шкала почти полная — «Не хочу!» и −3 (клавиша 2)', { score: s.score });
    // пока спит, остальные шкалы тают вдвое медленнее
    s = spec.create(K.rng(83)); stepN(s, 60);
    const a0 = s.need[0]; stepN(s, 30); const awake = a0 - s.need[0];
    pick(s, 2); const b0 = s.need[0]; stepN(s, 30); const asleep = b0 - s.need[0];
    ok(Math.abs(asleep / awake - .5) < .02, 'pet: пока Буся спит, еда тает вдвое медленнее', { awake, asleep });
    // желание: появляется по расписанию, исполнил — +15; не успел за 4 с — пропадает
    s = spec.create(K.rng(84));
    stepN(s, 299); ok(s.wish === -1, 'pet: в первые 5 с желаний нет');
    stepN(s, 1); ok(s.wish === s.wk[0] && s.wishT === C.WISH, 'pet: желание появилось');
    const sc = s.score, w = s.wish; s.need[w] = 50; pick(s, w);
    ok(s.score === sc + 15 && s.wishes === 1 && s.wish === -1, 'pet: желание исполнено — +15');
    stepN(s, s.nextW + 1); ok(s.wish >= 0, 'pet: следующее желание');
    stepN(s, C.WISH); ok(s.wish === -1 && s.wishes === 1, 'pet: не успел за 4 с — желание пропало');
    // весь день с заботливым ботом: конец «день прошёл», +30, очки = секунды + 30 + желания × 15 − отказы × 3
    const r = K.sim(spec, { seed: 85, fps: 60, bot: module.exports.bot(K, spec), maxMs: 200000 });
    const q = r.s;
    ok(q.over && q.why === 'day' && q.t === C.DAY && spec.win(q) && q.score === 150 + 30 + 15 * q.wishes - 3 * q.nos, 'pet: весь день — счёт = 150 + 30 + 15 × желания', { score: q.score, wishes: q.wishes, nos: q.nos });
    // вечером тает быстрее: последняя секунда дня тратит втрое больше, сон ещё ×1,5
    console.log('  pet: бот прожил день — ' + q.score + ' очков, желаний ' + q.wishes + ' из ' + q.wi);
  },

  // Chrome (scripts/arcade-e2e.cjs): настоящий click по нужной кнопке; stopAfter — после стольких секунд дня бросает (Буся уходит)
  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { clearInterval(window.__bot); window.__bot = setInterval(() => {
      const s = GAME_IMPL.pet._test.cur(); if (!s || s.over || s.busy || s.t >= ${stopAfter} * 60) return;
      let k = -1; if (s.wish >= 0 && s.need[s.wish] <= 85) k = s.wish;
      else { let m = 0; for (let i = 1; i < 3; i++) if (s.need[i] < s.need[m]) m = i; if (s.need[m] < 60) k = m; }
      if (k >= 0) document.querySelector('.pt-b[data-k="' + k + '"]')?.click();
    }, ${gap}); return 1; })()`,
    gap: 120, stopB: 8,
    endByStop: false,    // бот A проживает весь день (2,5 мин), B бросает через 8 с — Буся уходит гулять
    endMs: 160000,
    field: 'wk',
    async after(A, ok, cur){ ok(await A.ev(`${cur}.why === 'day'`), 'pet: бот прожил весь день'); },
  },
};

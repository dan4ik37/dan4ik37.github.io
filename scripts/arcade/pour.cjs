// «Налей воды» (js/games/arcade/pour.js) — бот и сценарии для scripts/arcade-test.cjs, бот для scripts/arcade-e2e.cjs.
const { PTR } = require('./_b3.cjs');
// горка от струи к стакану: начало чуть «за» струёй, конец — у середины стакана чуть ниже края (капли не перелетают);
// если по пути полка — горка начинается ниже полки (струя пролетает мимо её ближнего конца). Ломаная [x0, y0, x1, y1, …];
// без изломов: на выпуклом изломе быстрые капли слетают с горки. (Строкой уходит и в e2e-бота.)
function ramp(s, C){
  const gc = s.gx + C.GW / 2, dir = gc > s.sx ? 1 : -1, p = [s.sx - 16 * dir, 64, gc + 4 * dir, C.GY + 6];
  const near = (k, x0, y0, x1, y1) => {
    for (let i = 0; i <= 40; i++) {
      const x = x0 + (x1 - x0) * i / 40, y = y0 + (y1 - y0) * i / 40, ex = s.bx[k] - s.ax[k], ey = s.by[k] - s.ay[k];
      const u = Math.max(0, Math.min(1, ((x - s.ax[k]) * ex + (y - s.ay[k]) * ey) / (ex * ex + ey * ey)));
      if (Math.hypot(x - s.ax[k] - u * ex, y - s.ay[k] - u * ey) < 14) return true;
    }
    return false;
  };
  for (let k = 0; k < s.ns; k++) if (s.kind[k] === 2 && near(k, p[0], p[1], p[2], p[3])) p[1] = Math.max(p[1], Math.max(s.ay[k], s.by[k]) + 26);
  return p;
}
// точка на ломаной на расстоянии d от начала (и есть ли она ещё)
function at(p, d){
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (d <= l) return [p[i] + (p[i + 2] - p[i]) * d / l, p[i + 1] + (p[i + 3] - p[i + 1]) * d / l, 0];
    d -= l;
  }
  return [p[p.length - 2], p[p.length - 1], 1];
}

module.exports = {
  // на каждом уровне: палец в начало горки, ведёт по 10 единиц за раз (раз в gap шагов) к концу, отпускает — вода льётся
  bot(K, spec, gap = 1){
    const T = K.T, C = spec.consts;
    let lv = -1, p = null, d = 0, last = -1e9;
    return (s, k, push) => {
      if (s.over || s.ph !== 0) return;
      if (lv !== s.lv) { lv = s.lv; p = ramp(s, C); d = 0; push(T.DOWN, p[0], p[1], 0); last = k; return; }
      if (d < 0 || k - last < gap) return;
      last = k; d += 10;
      const q = at(p, d);
      push(T.MOVE, q[0], q[1], 0);
      if (q[2]) { push(T.UP, q[0], q[1], 0); d = -1; }
    };
  },
  maxMs: 130000,
  garbage: { gap: 1, ms: 30 * 60 * 1000, repeat: true },
  scenarios(K, spec, ok){
    const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 }, inp = { down: false, x: 0, y: 0, keys: 0 };
    const send = (s, type, x, y, k) => { ev.type = type; ev.x = x; ev.y = y; ev.k = k || 0; spec.input(s, ev, inp); };
    const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, inp); };
    const drops = s => { let n = 0; for (let i = 0; i < C.NP; i++) n += s.on[i]; return n; };
    const line = (s, x0, y0, x1, y1) => { send(s, T.DOWN, x0, y0); const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10); for (let i = 1; i <= n; i++) send(s, T.MOVE, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); };

    // старт: без нажатий вода ждёт AUTO шагов, потом льётся сама; партия не кончается
    let s = spec.create(K.rng(71));
    ok(s.lv === 1 && s.ph === 0 && s.ns === 3 && Math.abs(s.sx - (s.gx + C.GW / 2)) >= 90, 'pour: уровень 1 — кран не над стаканом, только стенки стакана', { sx: s.sx, gx: s.gx });
    stepN(s, C.AUTO - 1);
    ok(s.ph === 0 && drops(s) === 0 && !s.over, 'pour: до AUTO шагов вода ждёт, игра идёт');
    stepN(s, 1 + C.EMIT);
    ok(s.ph === 1 && drops(s) >= 1, 'pour: через AUTO шагов вода льётся сама (уровень не стоит вечно)');
    // просто тап (без линии) — не льёт и ничего не кончает (баг «нажал — сразу конец»)
    s = spec.create(K.rng(72)); send(s, T.DOWN, 100, 200); send(s, T.UP, 100, 200); stepN(s, 30);
    ok(s.ph === 0 && s.ns === 3 && !s.over && s.ink === C.INK, 'pour: тап без линии — ни линии, ни воды, чернила целы');
    // тяжесть — в секунду²: свободное падение 0,5 с (струя из крана: vy0 = 60)
    s = spec.create(K.rng(73)); send(s, T.KEY, 0, 0, 0); stepN(s, C.EMIT);
    let i0 = -1; for (let i = 0; i < C.NP; i++) if (s.on[i]) { i0 = i; break; }
    const vy0 = s.vy[i0]; stepN(s, 30);
    ok(i0 >= 0 && Math.abs(s.vy[i0] - Math.min(C.VMAX, vy0 + C.G0 * .5)) < 1, 'pour: за 0,5 с скорость падения +G0/2', { vy0, vy: s.vy[i0] });
    // чернила: длинная линия обрывается на запасе INK
    s = spec.create(K.rng(74)); line(s, 10, 100, 310, 100); line(s, 310, 140, 10, 140);
    let len = 0; for (let j = 3; j < s.ns; j++) len += Math.hypot(s.bx[j] - s.ax[j], s.by[j] - s.ay[j]);
    ok(s.ink <= 1 && Math.abs(len - C.INK) < 1.5, 'pour: чернила кончились — линия не длиннее INK', { ink: s.ink, len });
    // горка от струи к стакану: почти вся вода в стакане, ⭐ +20 и бонус за чернила, потом уровень 2 с полкой
    s = spec.create(K.rng(75));
    const gc = s.gx + C.GW / 2, dir = gc > s.sx ? 1 : -1;
    line(s, s.sx - 16 * dir, 64, gc - 6 * dir, C.GY - 34); send(s, T.UP, gc, C.GY - 34);
    ok(s.ph === 1, 'pour: отпустил палец после линии — вода льётся');
    let n = 0; while (s.ph !== 3 && n < 1200) { spec.step(s, K.STEP, inp); n++; }
    const inkBonus = Math.floor(s.ink / 20);
    ok(s.ph === 3 && s.got >= 80 && s.stars === 1 && s.score === s.got + 20 + inkBonus, 'pour: горка — в стакане ≥ 80 капель, ⭐ +20 и бонус за чернила', { got: s.got, score: s.score, inkBonus, n });
    stepN(s, C.PAUSE);
    ok(s.lv === 2 && s.ph === 0 && s.ns === 4 && s.ink === C.INK && drops(s) === 0, 'pour: уровень 2 — новый кран и стакан, полка на пути, чернила снова полные');
    // без линии вода мимо — 0, без бонусов
    s = spec.create(K.rng(76)); n = 0; while (s.ph !== 3 && n < 2000) { spec.step(s, K.STEP, inp); n++; }
    ok(s.ph === 3 && s.got === 0 && s.score === 0 && s.stars === 0, 'pour: без горки вода мимо стакана — 0 очков', { got: s.got, score: s.score });
    // капля не проскакивает линию на предельной скорости (подшаги + предел скорости)
    s = spec.create(K.rng(77)); line(s, 0, 300, 320, 300); s.ph = 2; s.on[0] = 1; s.x[0] = 160; s.y[0] = 240; s.vx[0] = 0; s.vy[0] = C.VMAX; s.age[0] = 0;
    stepN(s, 20);
    ok(s.y[0] < 300 && s.on[0] === 1, 'pour: капля на пределе скорости остановилась на линии', s.y[0]);
    // 2 минуты — конец
    s = spec.create(K.rng(78)); n = 0; while (!s.over) { spec.step(s, K.STEP, inp); n++; }
    ok(s.why === 'time' && n === C.TIME && s.lv > 5, 'pour: 2 минуты — конец по времени, уровни шли сами', { n, lv: s.lv });
  },

  e2e: {
    bot: (gap, stopAfter = 1e9) => `(() => { ${PTR('pour')}; clearInterval(window.__bot); let lv = -1, p = null, d = 0;
      const ramp = ${ramp.toString()}, at = ${at.toString()};
      window.__bot = setInterval(() => {
        const T = GAME_IMPL.pour._test, s = T.cur(); if (!s || s.over || s.ph !== 0 || s.lv > ${stopAfter}) return;
        const C = T.spec.consts;
        if (lv !== s.lv) { lv = s.lv; p = ramp(s, C); d = 0; __ptr('pointerdown', p[0], p[1]); return; }
        if (d < 0) return;
        d += 10; const q = at(p, d);
        __ptr('pointermove', q[0], q[1]);
        if (q[2]) { __ptr('pointerup', q[0], q[1]); d = -1; }
      }, ${gap}); return 1; })()`,
    gap: 20, stopB: 1,
    endByStop: false,    // 2 минуты — партия кончается сама
    endMs: 130000,
    field: 'ax',
  },
};

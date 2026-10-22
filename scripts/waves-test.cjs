// Волны движка (T-022c, js/engine/waves.js) в node: поле волн (вид воды, погода, крутизна без петель, зерно — у всех одинаково,
// время по модулю P), обратное смещение Герстнера (высота в точке мира), шейдер — его uniform (фазы от начала отсчёта у камеры
// дают ту же волну, что JS), лодка на волне (качка, удар о волну, шторм, переворот маленькой — без урона, встаёт сама; большая не
// переворачивается), одинаково при 30/60/144 кадрах, ЦП на лодку за шаг, без мусора за шаг, пловец качается (player.js), сеть —
// флаг «перевёрнута» в снимке, страж графики (disable), «вид сбоку» (2D) и «Подземье» (если есть podzem-waves).
// Запуск из корня сайта: node --expose-gc scripts/waves-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/waves.js', 'js/engine/vehicle.js', 'js/engine/vehicle-ground.js', 'js/engine/vehicle-water.js', 'js/engine/player.js']) load(f);
const E = globalThis.D37E, W = E.waves, V = E.vehicle;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const near = (a, b, e) => Math.abs(a - b) <= e;
const realTime = W.time;
let simT = 10;   // время волн — своё (проверки не зависят от часов машины)
W.time = () => ((simT % W.P) + W.P) % W.P;

// ═══ 1. Поле: виды, погода, крутизна ═══
{
  for (const k of ['ocean', 'lake', 'pond', 'canal', 'river', 'side']) {
    const F = W.field({ kind: k, seed: 's' + k });
    ok(F.kind === k && F.k.every(v => v > 0) && F.w.every(v => v > 0), `${k}: волны заданы`);
    // частоты кратны 2π/P — время по модулю P не «рвёт» фазу
    ok([...F.w].every(w => near((w * W.P / (2 * Math.PI)) % 1, 0, 1e-9) || near((w * W.P / (2 * Math.PI)) % 1, 1, 1e-9)), `${k}: частоты кратны общему периоду`);
    // глубокая вода: ω² = g·k
    ok([...F.w].every((w, i) => near(w * w, F.g * F.k[i], 1e-9 * F.g)), `${k}: ω² = g·k`);
    W.free(F);
  }
  const F = W.field({ kind: 'ocean', seed: 'mir:ocean' });
  const H = [3, 7, 11, 15, 22].map(w => F.weather({ wind: w, windDir: 0, thunder: 0 }).H);
  ok(H.every((h, i) => !i || h >= H[i - 1]) && H[0] < .25 && H[4] <= W.KINDS.ocean.max + 1e-9, 'выше ветер — выше волны; потолок', H);
  const calm = F.weather({ wind: 3 }).H, storm = F.weather({ wind: 17, thunder: 1 }).H;
  ok(calm < .25 && storm > 2 && F.storm > .95, 'тихо ≈ 0,2, шторм — 2,1 (океан)', [calm, storm, F.storm]);
  ok(F.weather({ wind: 17, thunder: 1, ice: 1 }).H === 0 && F.storm === 0, 'лёд — волн нет');
  // без петель на гребне: Σ Q·k·A ≤ 0,85 и «сжатие» гребня > 0 во всех точках в самый шторм
  F.weather({ wind: 30, thunder: 1 });
  let kA = 0; for (let i = 0; i < 4; i++) kA += F.k[i] * F.QA[i];
  let minJ = 9; const o = {};
  for (let k = 0; k < 4000; k++) { F.disp((k * 37.1) % 1900 - 950, (k * 11.3) % 1700 - 850, k * .013, o); minJ = Math.min(minJ, o.jac); }
  ok(kA <= .85 + 1e-9 && minJ > .05, 'шторм: гребни без петель (Σ Q·k·A ≤ 0,85, «сжатие» > 0)', [kA, minJ]);
  // ветер в другую сторону — другие волны сильнее (направления волн постоянные — фазы вдали не прыгают)
  const a1 = [...F.weather({ wind: 12, windDir: F.th0 }).A], a2 = [...F.weather({ wind: 12, windDir: F.th0 + Math.PI }).A];
  ok(a1[0] > a2[0] && Math.abs(a1.reduce((s, v) => s + v, 0) - a2.reduce((s, v) => s + v, 0)) < 1e-9, 'ветер решает, какие волны сильнее; высота — та же', [a1[0], a2[0]]);
  // одно зерно — одни волны (у всех игроков без сети); другое зерно — другие
  const G1 = W.field({ kind: 'ocean', seed: 'mir:ocean' }), G2 = W.field({ kind: 'ocean', seed: 'mir:ocean' }), G3 = W.field({ kind: 'ocean', seed: 'другое' });
  for (const g of [G1, G2, G3]) g.weather({ wind: 12, windDir: 1 });
  ok(G1.at(123.4, -56.7, 33.3) === G2.at(123.4, -56.7, 33.3) && G1.at(123.4, -56.7, 33.3) !== G3.at(123.4, -56.7, 33.3), 'зерно → одни и те же волны; другое зерно — другие');
  ok(near(realTime(1700000000000), realTime(1700000000000 + W.P * 1000), 1e-9) && realTime(-5) >= 0, 'общее время — по модулю P, без отрицательных');
  for (const g of [G1, G2, G3, F]) W.free(g);
}

// ═══ 2. Высота в точке мира: обратное смещение (Ньютон) ═══
{
  const F = W.field({ kind: 'ocean', seed: 'mir:ocean' });
  let worst = 0, worstX = 0;
  const o = {}, s = {};
  for (const wind of [5, 12, 30]) {
    F.weather({ wind, windDir: 1, thunder: wind > 20 ? 1 : 0 });
    for (let k = 0; k < 3000; k++) {
      const x0 = (k * 7.31) % 2000 - 1000, z0 = (k * 3.77) % 1600 - 800, t = (k * .37) % 96;
      F.disp(x0, z0, t, o); F.sample(x0 + o.x, z0 + o.z, t, s);
      worst = Math.max(worst, Math.abs(s.y - o.y)); worstX = Math.max(worstX, Math.abs(s.x0 - x0), Math.abs(s.z0 - z0));
    }
  }
  ok(worst < 1e-4 && worstX < 1e-3, 'высота в точке мира = высота смещённой точки (Ньютон, до шторма)', [worst, worstX]);
  // уклон: конечная разность высоты ≈ s.sx
  F.weather({ wind: 12, windDir: 1 });
  let se = 0; for (let k = 0; k < 300; k++) { const x = k * 3.1 - 400, z = k * 1.7 - 200, t = k * .1, h = .02; F.sample(x, z, t, s); const sx = s.sx; se = Math.max(se, Math.abs(sx - (F.at(x + h, z, t) - F.at(x - h, z, t)) / (2 * h))); }
  ok(se < 5e-3, 'уклон воды — как разность высот', se);
  // сетка глубины: у берега волн нет, в открытом море — есть; «открытость» гавани — ниже
  const G = W.gridFrom({ n: 3, cell: 50, x0: 0, z0: 0, depth: x => x < 1 ? -1 : 10, expo: (x, z) => z > 60 ? .5 : 1 });
  F.grid = G; F.weather({ wind: 14, windDir: 1 });
  ok(F.mulAt(0, 0) === 0 && near(F.mulAt(100, 0), 1, 1e-9) && near(F.mulAt(100, 100), .5, 1e-9), 'сетка: суша — 0, море — 1, гавань — 0,5');
  let mx = 0; for (let k = 0; k < 50; k++) mx = Math.max(mx, Math.abs(F.at(0, k, k * .3)));
  ok(mx < 1e-9, 'у кромки (глубина 0) вода не качается', mx);
  W.free(F);
}

// ═══ 3. Шейдер: фазы от начала отсчёта у камеры дают ту же волну (как d37Gerst в GLSL — повторено здесь по строкам) ═══
{
  const F = W.field({ kind: 'ocean', seed: 'mir:ocean' }); F.weather({ wind: 16, windDir: 2, thunder: .6 });
  W.uniforms(F);
  const glsl = (p, ox, oz, t) => {   // d37Gerst без сетки и без угасания (dist < 0): то же, что в waves.js GLSL.pars
    W.sync(F, t, ox, oz);
    const A = F.U.d37GwA.value, P = F.U.d37GwP.value, O = F.U.d37GwO.value, f32 = Math.fround;
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < 4; i++) {
      const kx = A[i * 4], kz = A[i * 4 + 1], k = Math.hypot(kx, kz), Ai = A[i * 4 + 2], QA = A[i * 4 + 3];
      let th = kx * f32(p[0] - O[0]) + kz * f32(p[1] - O[1]) + P[i]; th = th - 2 * Math.PI * Math.floor(th / (2 * Math.PI));
      const s = Math.sin(th), c = Math.cos(th);
      dx += kx / k * QA * c; dy += Ai * s; dz += kz / k * QA * c;
    }
    return [dx, dy, dz];
  };
  let worst = 0; const o = {};
  for (let k = 0; k < 500; k++) {
    const p = [(k * 13.7) % 3000 - 1500, (k * 7.9) % 3000 - 1500], t = (k * .91) % 96;
    const ox = Math.round(p[0] / 256) * 256, oz = Math.round(p[1] / 256) * 256;
    const g = glsl(p, ox, oz, t); F.disp(p[0], p[1], t, o);
    worst = Math.max(worst, Math.abs(g[0] - o.x), Math.abs(g[1] - o.y), Math.abs(g[2] - o.z));
  }
  ok(worst < 2e-3, 'шейдер (фазы у камеры, float) = JS (точные координаты), разница < 2 мм', worst);
  const src = W.GLSL.pars() + W.GLSL.vNormal + W.GLSL.fPars() + W.GLSL.fFoam + W.GLSL.fMask;
  ok(!/texelFetch|\bcontinue\b|isnan/.test(src) && /#pragma unroll_loop_start/.test(src), 'GLSL: без texelFetch/continue/isnan, цикл разворачивается');
  const ss = [...src.matchAll(/smoothstep\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,/g)].map(m => [+m[1], +m[2]]);
  ok(ss.length > 0 && ss.every(([a, b]) => a < b), 'GLSL: smoothstep — edge0 < edge1', ss);
  ok(/#ifdef D37_GW/.test(src) && /#ifdef D37_GWV/.test(src) && /#ifdef D37_GWF/.test(src), 'всё — под define (страж выключает целиком)');
  W.free(F);
}

// ═══ 4. Лодка на волне ═══
const sea = (gain = 1) => { const F = W.field({ kind: 'ocean', seed: 'mir:ocean', gain }); const env = { ph: new E.Phys({ ground: -40 }), water: () => 0, waves: () => F, caps: 0, slams: 0, rights: 0, onCapsize: () => env.caps++, onSlam: () => env.slams++, onRight: () => env.rights++ }; env.ph.terrain = { sample: () => -40 }; return { F, env }; };
const IN = o => ({ thr: 0, steer: 0, up: 0, boost: 0, brake: 0, on: true, ...o });
const DT = 1 / 60;
{
  const { F, env } = sea(.75);
  F.weather({ wind: 13, windDir: F.th0 });
  const v = V.create('motorboat', { yaw: F.th0 + .5 });
  const ys = [], ps = [], rs = [];
  for (let i = 0; i < 60 * 40; i++) { simT += DT; V.step(v, DT, IN({ thr: .5, steer: .1 }), env); if (i > 120) { ys.push(v.y); ps.push(v.pitch); rs.push(v.roll); } }
  const span = a => Math.max(...a) - Math.min(...a);
  ok(span(ys) > .3 && span(ps) > .05 && span(rs) > .04 && v.wy !== undefined, 'катер качается: подъём, тангаж, крен', [span(ys), span(ps), span(rs)]);
  // корпус на волне: вода у середины не выше палубы (лодка всплывает на гребень)
  F.weather({ wind: 18, windDir: F.th0, thunder: 1 });
  let over = 0; const o = {};
  for (let i = 0; i < 60 * 60; i++) { simT += DT; V.step(v, DT, IN({ thr: 1 }), env); const c = F.at(v.x, v.z, v.wt); over = Math.max(over, c - (v.y + v.def.water.draft)); if (Math.abs(v.x) > 800 || Math.abs(v.z) > 800) { v.x = v.z = 0; } }
  const fb = (v.def.size[1] * .5 - v.def.water.draft) * .85;
  ok(over <= fb + 1e-6, 'шторм на полном ходу: вода у середины не выше надводного борта', [over, fb]);
  ok(env.slams > 0, 'на ходу в шторм нос бьётся о волны', env.slams);
  // без волн — как раньше: стоит на уровне воды минус осадка
  const env0 = { ph: env.ph, water: () => 0 }, v0 = V.create('motorboat', {});
  for (let i = 0; i < 80; i++) V.step(v0, DT, IN({}), env0);
  ok(near(v0.y, -v0.def.water.draft, .05) && v0.wy === undefined, 'без волн — как раньше (уровень минус осадка)', v0.y);
  W.free(F);
}
{ // шторм: крутой поворот на полном ходу переворачивает маленькую лодку (без урона, встаёт через 8 с); в умеренную волну — нет; патрульный — нет
  const { F, env } = sea(1);
  const run = (id, wind, th, steer, sec) => {
    F.weather({ wind, windDir: F.th0, thunder: th }); env.caps = 0; env.rights = 0;
    const v = V.create(id, { yaw: F.th0 }), hp = v.hp;
    let capT = 0, hpOk = true, upT = 0, maxCap = 0;
    for (let i = 0; i < 60 * sec; i++) {
      simT += DT; V.step(v, DT, IN({ thr: 1, steer }), env);
      if (v.capsized) { capT += DT; maxCap = Math.max(maxCap, Math.abs(v.roll)); } else upT += DT;
      if (v.hp !== hp) hpOk = false;
      if (Math.abs(v.x) > 800 || Math.abs(v.z) > 800) { v.x = v.z = 0; }
    }
    return { caps: env.caps, rights: env.rights, capT, hpOk, maxCap };
  };
  const a = run('motorboat', 18, 1, 1, 300), b = run('motorboat', 13, 0, 1, 300), c = run('patrol', 18, 1, 1, 300), d = run('motorboat', 9, 0, .3, 120);
  ok(a.caps >= 1 && a.hpOk && a.maxCap > 2.5, 'шторм, крутой поворот на полном ходу: катер переворачивается, без урона, лежит вверх дном', a);
  ok(a.rights >= Math.max(1, a.caps - 1), 'перевёрнутый встаёт сам (через 8 с)', a);
  ok(b.caps === 0 && d.caps === 0, 'умеренная волна — не переворачивает', [b.caps, d.caps]);
  ok(c.caps === 0, 'патрульный (большой) не переворачивается', c);
  W.free(F);
}
{ // одинаково при 30/60/144 кадрах: шаг логики — 1/60 с (E.loop), время волн — часы шага лодки
  const runFps = fps => {
    const { F, env } = sea(1); F.weather({ wind: 16, windDir: F.th0, thunder: .5 });
    simT = 40;
    const v = V.create('motorboat', { yaw: .3 });
    let acc = 0, step = 0;
    const frameDt = 1 / fps;
    for (let fr = 0; fr < fps * 20; fr++) {
      acc += frameDt; simT += frameDt;   // часы машины идут по кадрам
      let n = 0;
      while (acc >= DT - 1e-12 && n < 5) { V.step(v, DT, IN({ thr: step % 600 < 400 ? 1 : .2, steer: Math.sin(step / 90) * .8 }), env); acc -= DT; step++; n++; }
    }
    W.free(F);
    return { step, x: v.x, z: v.z, y: v.y, yaw: v.yaw, pitch: v.pitch, roll: v.roll, slams: env.slams };
  };
  const r30 = runFps(30), r60 = runFps(60), r144 = runFps(144);
  const n = Math.min(r30.step, r60.step, r144.step);
  ok(n >= 1190, 'шагов логики за 20 с — ~1200 при любой частоте кадров', [r30.step, r60.step, r144.step]);
  // одинаковое число шагов → одинаковое место (ровно); разница в 1 шаг (остаток накопителя) — меньше шага пути
  const same = (a, b) => a.step === b.step ? ['x', 'z', 'y', 'yaw', 'pitch', 'roll'].every(k => a[k] === b[k]) : Math.hypot(a.x - b.x, a.z - b.z) < .5;
  ok(same(r30, r60) && same(r60, r144) && same(r30, r144), 'лодка на той же волне: 30/60/144 кадров — то же место и качка', [r30, r60, r144].map(r => [r.step, +r.x.toFixed(4), +r.z.toFixed(4), +r.roll.toFixed(4)]));
}
{ // ЦП на лодку за шаг и без мусора за шаг
  const { F, env } = sea(.75); F.weather({ wind: 14, windDir: F.th0, thunder: .3 });
  const v = V.create('motorboat', {}), env0 = { ph: env.ph, water: () => 0 }, v0 = V.create('motorboat', {}), I = IN({ thr: 1, steer: .2 });
  for (let i = 0; i < 2000; i++) { simT += DT; V.step(v, DT, I, env); V.step(v0, DT, I, env0); }
  const N = 60000;
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { simT += DT; V.step(v, DT, I, env); if (Math.abs(v.x) > 800 || Math.abs(v.z) > 800) { v.x = v.z = 0; } }
  const withW = Number(process.hrtime.bigint() - t0) / N / 1000;
  t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { V.step(v0, DT, I, env0); if (Math.abs(v0.x) > 800 || Math.abs(v0.z) > 800) { v0.x = v0.z = 0; } }
  const noW = Number(process.hrtime.bigint() - t0) / N / 1000;
  const vp = V.create('motorboat', {}); let tp = process.hrtime.bigint();
  for (let i = 0; i < N; i++) { simT += DT; V.KINDS.boat.pose(vp, DT, env, { yr: .1, dist: 30 }); }
  const pose = Number(process.hrtime.bigint() - tp) / N / 1000;
  console.log(`  ЦП: лодка на волнах ${withW.toFixed(2)} мкс/шаг (без волн ${noW.toFixed(2)}), качка чужой/стоящей ${pose.toFixed(2)} мкс/шаг`);
  // машина под нагрузкой (другие проверки рядом) — сравнение с той же лодкой без волн
  ok((withW < 25 && pose < 20) || (withW < noW * 12 && pose < noW * 10), 'ЦП: лодка на волнах — меньше 25 мкс за шаг (или ≤ 12 × без волн, если машина занята)', [withW, noW, pose]);
  if (global.gc) {
    global.gc(); const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) { simT += DT; V.step(v, DT, I, env); if (Math.abs(v.x) > 800 || Math.abs(v.z) > 800) { v.x = v.z = 0; } }
    global.gc(); const dh = process.memoryUsage().heapUsed - h0;
    ok(dh < 64 * 1024, 'без мусора за шаг: 100 000 шагов — память не растёт', dh);
  }
  W.free(F);
}

// ═══ 5. Пловец качается (player.js: ph.waveAt) ═══
{
  const F = W.field({ kind: 'lake', seed: 'l' }); F.weather({ wind: 9, windDir: 0, thunder: 1 });
  const ph = new E.Phys({ ground: -20 }); ph.terrain = { sample: () => -20 };
  ph.waterLevel = () => 0;
  const OUT = {}; ph.waveAt = (x, z) => F.sample(x, z, W.time(), OUT);
  const P = E.player(ph, { x: 0, z: 0 });
  P.place(0, -.8, 0, 0);
  const ys = [], ws = [];
  for (let i = 0; i < 60 * 20; i++) { simT += DT; P.update(DT, null, null); if (i > 120) { ys.push(P.ch.y); ws.push(F.at(P.ch.x, P.ch.z, W.time())); } }
  const span = a => Math.max(...a) - Math.min(...a);
  // корреляция высоты пловца и волны над ним
  const m = a => a.reduce((s, v) => s + v, 0) / a.length, my = m(ys), mw = m(ws);
  let c = 0, vy = 0, vw = 0; for (let i = 0; i < ys.length; i++) { c += (ys[i] - my) * (ws[i] - mw); vy += (ys[i] - my) ** 2; vw += (ws[i] - mw) ** 2; }
  const corr = c / Math.sqrt(vy * vw);
  ok(P.swim && span(ys) > span(ws) * .4 && corr > .6, 'пловец плывёт и качается вместе с волной', { swim: P.swim, swimmer: +span(ys).toFixed(3), wave: +span(ws).toFixed(3), corr: +corr.toFixed(2) });
  W.free(F);
}

// ═══ 6. Сеть: «перевёрнута» в снимке; качка не считается «взлётом» ═══
{
  const v = V.create('motorboat', {}); v.capsized = 5;
  const s = V.unpack(V.pack(v));
  ok(s.capsized === true && V.unpack(V.pack(V.create('motorboat', {}))).capsized === false, 'снимок: флаг «перевёрнута»');
  const a = { x: 0, y: -.5, z: 0, spd: 5 }, b = { x: 1, y: .9, z: 0, spd: 5 };
  ok(V.snapOk(V.get('motorboat'), a, b, .2) === null, 'подъём на гребень за 0,2 с — не «взлёт» (сеть не отвергает)');
}

// ═══ 7. Страж графики: выключил волны — вода без кусков волн, «блин» спрятан, физика без волн ═══
{
  const F = W.field({ kind: 'ocean', seed: 'g' }); F.weather({ wind: 14 });
  const m = { defines: { D37_WATER: 1 }, userData: {}, needsUpdate: false };
  W.use(m, F, 'v');
  let shown = true; const Pt = { on: true, show(on){ shown = on; } }; W.patches.add(Pt);
  ok(m.defines.D37_GW && m.defines.D37_GWV && F.H > 0, 'материал воды с волнами');
  W.disable();
  ok(!m.defines.D37_GW && !m.defines.D37_GWV && m.needsUpdate && shown === false && F.H === 0 && !W.enabled, 'выключено: define сняты, «блин» спрятан, волн в физике нет');
  W.patches.delete(Pt); W.enabled = true; W.free(F);
}

// ═══ 8. Вид сбоку (2D): та же сумма волн по x, без смещения вбок ═══
{
  const F = W.field({ kind: 'side', seed: 'pz' }); F.weather({ wind: 12, windDir: 0, thunder: 1 });
  ok(F.dz.every(v => v === 0) && F.dx.every(v => Math.abs(v) === 1) && F.QA.every(v => v === 0), 'вид сбоку: волны вдоль x, без смещения вбок');
  let mx = 0; for (let k = 0; k < 2000; k++) mx = Math.max(mx, Math.abs(F.at1(k * .7, k * .05)));
  ok(mx <= F.H + 1e-9 && mx > F.H * .4 && F.H <= W.KINDS.side.max + 1e-9, 'вид сбоку: высота в пределах суммы амплитуд', [mx, F.H]);
  const K = new Float32Array(4), A = new Float32Array(4), P = new Float32Array(4);
  let we = 0; for (let k = 0; k < 300; k++) { const x = k * 17.3 - 2000, t = (k * .77) % 96, ox = Math.round(x / 1024) * 1024; W.sync1(F, t, ox, K, A, P); let g = 0; for (let i = 0; i < 4; i++) g += A[i] * Math.sin(K[i] * Math.fround(x - ox) + P[i]); we = Math.max(we, Math.abs(g - F.at1(x, t))); }
  ok(we < 1e-3, 'вид сбоку: кусок GLSL (фазы от начала отсчёта) = JS', we);
  W.free(F);
}

// ═══ 9. «Подземье» (2D, podzem-sim.cjs): волны на глади под небом и в большом озере; подземная лужа — тихая; гладь у героя =
//     та же сумма волн; герой и вещи качаются у глади; при 30/60/144 Гц — то же место ═══
async function podzemWaves(){
  const sim = await require('./podzem-sim.cjs')(SITE);
  load('js/engine/waves.js');   // в D37E игры (podzem-sim подставил свой D37E)
  const W2 = globalThis.D37E.waves;
  let clk = 7; W2.time = () => ((clk % W2.P) + W2.P) % W2.P;   // своё время волн — по кадрам
  const A = sim.A, T = sim.T;
  const build = async (hz, seed) => {
    await A.stopWorld(false);
    ok(await sim.newWorld(seed) === 'play', 'Подземье: мир загрузился');
    const G = sim.G, ST = A.PZ.TILE.stone.id; T.god(true); G.npcs.length = 0; G.spawnGrace = 1e9; G.mobs.length = 0; G.items.length = 0;
    sim.onFrame = () => { clk += 1 / hz; };
    await sim.frames(.5, hz);
    const p = G.pl, px = Math.floor(p.x + p.w / 2), gy = Math.floor(p.y + p.h - .01) + 1;
    // открытый бассейн 37 × 5 (над ним — небо), подземная лужа 6 × 3 под камнем, большое подземное озеро 50 × 4
    for (let x = px + 2; x <= px + 42; x++) { for (let y = gy - 24; y < gy; y++) A.setCell(x, y, 0, 0, 0, 0, 0); for (let y = gy; y <= gy + 36; y++) A.setCell(x, y, ST, 0); }
    for (let x = px + 4; x <= px + 40; x++) for (let y = gy; y < gy + 5; y++) A.setCell(x, y, 0, 0, 0, 255, 1);
    for (let x = px + 6; x <= px + 11; x++) { for (let y = gy + 12; y < gy + 14; y++) A.setCell(x, y, 0, 0, 0, 0, 0); for (let y = gy + 14; y < gy + 17; y++) A.setCell(x, y, 0, 0, 0, 255, 1); }
    for (let x = px - 70; x <= px - 18; x++) { for (let y = gy + 20; y <= gy + 28; y++) A.setCell(x, y, ST, 0); }
    for (let x = px - 68; x <= px - 20; x++) { for (let y = gy + 21; y < gy + 23; y++) A.setCell(x, y, 0, 0, 0, 0, 0); for (let y = gy + 23; y < gy + 27; y++) A.setCell(x, y, 0, 0, 0, 255, 1); }
    p.x = px + 20 - p.w / 2; p.y = gy - p.h * .7; p.vx = p.vy = 0; p.ledge = null; p.fallY = p.y; G.accReset = true;
    await sim.frames(1.5, hz);
    return { G, p, px, gy };
  };
  const { G, p, px, gy } = await build(60, 'pz-waves');
  ok(!!G.wv && G.wv.F.side, 'Подземье: волны мира — «вид сбоку»');
  T.waves({ wind: 17, windDir: 0, thunder: 1 });
  const open = T.surf(px + 20.3, gy), cave = T.surf(px + 8.3, gy + 14), lake = T.surf(px - 44.3, gy + 23);
  ok(open.k > .9 && cave.k < .05 && lake.k > .9, 'Подземье: под небом — волны, подземная лужа — тихая, большое озеро — волны', { open: open.k, cave: cave.k, lake: lake.k });
  // гладь у точки = клетка + (H − F.at1)·k (то же, что шейдер); со временем качается
  const ys = [], ws = [];
  for (let i = 0; i < 180; i++) { await sim.frames(1 / 60, 60); const s = T.surf(px + 20.3, gy); ys.push(s.y); ws.push(gy + Math.min(.98, (G.wv.F.H - G.wv.F.at1(px + 20.3, G.wv.wt)) * s.k)); }
  const span = a => Math.max(...a) - Math.min(...a);
  ok(span(ys) > .3 && ys.every((y, i) => Math.abs(y - ws[i]) < 1e-9), 'Подземье: гладь качается и равна сумме волн (та же функция, что в шейдере)', { span: span(ys), H: G.wv.F.H });
  // герой у глади качается вместе с ней; вещь не тонет, а качается у глади
  const hy = [], sy = [];
  A.dropItem('dirt', 1, px + 30, gy - 1, 0, 0);
  const it = G.items[G.items.length - 1];
  for (let i = 0; i < 360; i++) { await sim.frames(1 / 60, 60); hy.push(p.y + p.h * .3); sy.push(T.surf(p.x + p.w / 2, p.y + p.h * .3).y); }
  const m = a => a.reduce((s, v) => s + v, 0) / a.length;
  let c = 0, v1 = 0, v2 = 0; const m1 = m(hy), m2 = m(sy.filter(v => v === v));
  for (let i = 0; i < hy.length; i++) if (sy[i] === sy[i]) { c += (hy[i] - m1) * (sy[i] - m2); v1 += (hy[i] - m1) ** 2; v2 += (sy[i] - m2) ** 2; }
  ok(p.inLq && c / Math.sqrt(v1 * v2) > .5 && span(hy) > .2, 'Подземье: герой в воде качается вместе с гладью', { corr: +(c / Math.sqrt(v1 * v2)).toFixed(2), span: +span(hy).toFixed(2), inLq: p.inLq });
  ok(it && it.y < gy + 2 && it.y > gy - 2, 'Подземье: вещь в воде не тонет — держится у глади', it && { y: it.y - gy });
  T.waves({ wind: 2, windDir: 0, thunder: 0 });
  ok(G.wv.F.H < .1, 'Подземье: тихо — волны маленькие', G.wv.F.H);
  T.waves(null);
  // при 30/60/144 Гц герой в том же месте (шаг логики 1/60 с, часы волн — шага)
  const runs = {};
  for (const hz of [30, 60, 144]) {
    clk = 7;
    const r = await build(hz, 'pz-waves-fps');
    T.waves({ wind: 17, windDir: 0, thunder: 1 });
    r.p.x = r.px + 20 - r.p.w / 2; r.p.y = r.gy - r.p.h * .7; r.p.vx = r.p.vy = 0;
    clk = 30.1; sim.G.wv.wt = 30;   // одинаковое начало волн (часы шага рядом с общими — без «подтяжки»)
    await sim.frames(4, hz);
    runs[hz] = { x: r.p.x - r.px, y: r.p.y - r.gy };
  }
  const dev = Math.max(...[30, 144].map(hz => Math.hypot(runs[hz].x - runs[60].x, runs[hz].y - runs[60].y)));
  console.log(`  Подземье, герой на волнах при 30/60/144 Гц: ${[30, 60, 144].map(hz => runs[hz].x.toFixed(3) + ',' + runs[hz].y.toFixed(3)).join(' / ')}; отклонение ${dev.toFixed(4)}`);
  ok(dev < .1, 'Подземье: при 30, 60 и 144 Гц герой на волнах там же (меньше 0,1 клетки)', runs);
  sim.onFrame = null;
  await A.stopWorld(false);
}

(async () => {
  try { await podzemWaves(); } catch (e) { fail++; console.log('FAIL Подземье:', e.stack || e); }
  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})();

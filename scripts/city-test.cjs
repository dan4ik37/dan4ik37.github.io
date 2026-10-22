// «Живой город» P1 (js/games/mir-econ.js + mir-city.js) в node, без браузера и без базы:
// каталог (числа, места работ — здания из таблиц городов, магазины), роли ↔ профессии, задания (шаги в своём городе, на улицах — не в
// зданиях, длительность против минимального времени задания), правила (уровни, зарплата в сотых, усталость, лимиты, номер задания,
// «рано», еда и бонус, центробанк, эмиссия, белый список настроек), «сдать работу» (TaskRunner) при 30/60/144 FPS — одни и те же шаги,
// одна отправка, никогда не раньше времени (и при сбитых часах), пробный режим (браузер) — сохраняется и не переносится.
// Запуск из корня сайта: node scripts/city-test.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
const LS = new Map();
globalThis.localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => LS.delete(k) };
const load = f => vm.runInThisContext(fs.readFileSync(path.join(SITE, f), 'utf8'), { filename: f });
for (const f of ['js/engine/core.js', 'js/engine/physics.js', 'js/engine/interior.js', 'js/games/mir-zones.js', 'js/games/mir-econ.js', 'js/games/mir-city.js']) load(f);
const MZ = globalThis.MirZones, MC = globalThis.MirCity, M = globalThis.MirEcon, RU = M.Rules;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const D = M.merge(M.SERVER, {}, 0);

// ═══ 1. Каталог ═══
{
  ok(M.CITIES.metro.age === MZ.ADULT_AGE && M.CITIES.kids.age === 0, 'возраст городов: детский 0+, Большой = MirZones.ADULT_AGE');
  ok(M.START === 50 && M.CAPS.wageDay === 400 && M.CAPS.full < M.CAPS.half, 'подарок 50, лимит 400 в день, усталость 40 < 60 (решение владельца)');
  const S = M.SKILL; ok([S.at, S.mult, S.fast, S.names].every(a => a.length === 5) && S.at.every((v, i) => !i || v > S.at[i - 1]) && S.mult.every((v, i) => !i || v > S.mult[i - 1]) && S.fast.every((v, i) => !i || v < S.fast[i - 1]), 'навык: 5 уровней, растёт зарплата, короче задание');
  const BLD = { kids: new Set(MC.K_BLD.map(b => b.id)), metro: new Set(MC.M_BLD.map(b => b.id)) };
  const wages = [];
  for (const [id, P] of Object.entries(M.PROFS)) {
    ok(P.n && P.e && P.ph === 1 && P.min >= 5 && P.wage >= 1 && P.desc && Array.isArray(P.modes), `профессия ${id}: название, фаза 1, время, зарплата`, P);
    const cs = Object.keys(P.cities || {}); ok(cs.length > 0, `${id}: есть где работать`);
    for (const c of cs) for (const pl of P.cities[c]) ok(BLD[c]?.has(pl), `${id}: место ${pl} — здание из таблицы города ${c}`);
    if (P.age >= 16) ok(!P.cities.kids, `${id}: 16+ — не в детском городке`);
    wages.push(P.wage);
  }
  ok(Object.keys(M.PROFS).length === 9 && ['cook', 'seller', 'doctor', 'fire', 'builder', 'teacher', 'police', 'driver', 'mech'].every(p => M.PROFS[p]), '9 профессий P1 (план §7)');
  ok(Object.keys(M.PROFS).filter(p => M.PROFS[p].cities.kids).length === 7, 'в детском городке — 7 работ (полиции нет, водитель — в P3)');
  ok(Math.min(...wages) >= 5 && Math.max(...wages) <= 10, '«около 6 💵 за задание» (5…10)', wages);
  for (const [c, C] of Object.entries(M.CITIES)) for (const [pl, items] of Object.entries(C.shops)) {
    ok(BLD[c].has(pl), `магазин ${pl} — здание города ${c}`);
    for (const it of items) ok(M.GOODS[it] && M.GOODS[it].buff && RU.price(D, it) > M.GOODS[it].ref, `${pl}: ${it} — еда с бонусом, цена выше опорной`);
  }
  ok(RU.price(D, 'bun') === 5 && RU.price(D, 'coffee') === 8 && RU.price(D, 'pie') === 15, 'цены: булочка 5, кофе 8, пирог 15 (опорная × 1,25)');
  ok(JSON.stringify(M.SERVER).length < 4000, 'каталог для сервера < 4 КБ', JSON.stringify(M.SERVER).length);
  const sql = fs.readFileSync(path.join(SITE, 'city.sql'), 'utf8');
  ok(sql.includes(JSON.stringify(M.SERVER).replace(/'/g, "''")), 'city.sql: city_defs0 = MirEcon.SERVER (node scripts/gen-city-defs.cjs)');
}

// ═══ 2. Роли ↔ профессии, задания ═══
const RUN = 7 * (globalThis.D37E?.UNIT || 2.1 / 1.8);   // бег, ед./с (player.js: 7 м/с)
const est = {};
{
  const inB = (city, x, z, m = 0) => MZ.buildings(city).some(b => b.h > 0 && b.type !== 'park' && b.type !== 'lot' && Math.abs(x - b.x) < b.w / 2 + m && Math.abs(z - b.z) < b.d / 2 + m);
  for (const [city, roles] of [['kids', MC.ROLES_K], ['metro', MC.ROLES_M]]) {
    const spots = MC.spotsOf(city), Z = MZ.ZONES[city];
    for (const [id, R] of Object.entries(roles)) {
      ok(MZ.ROLES[id]?.zone === city, `${city}/${id}: роль известна сети`);
      if (R.rp || R.soon) continue;
      const P = M.PROFS[R.prof];
      ok(P && P.cities[city]?.includes(R.place), `${city}/${id}: профессия ${R.prof} в здании ${R.place}`);
      if (R.car) continue;
      // длительность: 40 заданий подряд (следующее — от места, где кончилось прошлое), бег + удержания
      let px = spots[Object.keys(spots)[0]].x, pz = spots[Object.keys(spots)[0]].z;
      const times = [];
      for (let k = 0; k < 40; k++) {
        const L = MC.taskList(id, city, spots, M.rng('t' + k + id));
        ok(Array.isArray(L) && L.length >= 1 && L.length <= 8, `${city}/${id}: задание из 1–8 шагов`);
        let t = 0;
        for (const st of L) {
          ok(st.at && Number.isFinite(st.at.x) && MZ.inRect(Z, st.at.x, st.at.z), `${city}/${id}: «${st.text}» — в городе`, st.at);
          ok(!st.carry || MC.CARRY[st.carry], `${city}/${id}: несёт известное (${st.carry})`);
          t += Math.max(0, Math.hypot(st.at.x - px, st.at.z - pz) - 1.5) / RUN + (st.hold || .3);
          px = st.at.x; pz = st.at.z;
        }
        times.push(t);
      }
      times.sort((a, b) => a - b);
      est[city + '/' + id] = { prof: R.prof, min: RU.minS(D, R.prof, 0), med: times[20], lo: times[0] };
    }
  }
  // одинаковый номер задания — одинаковые цели (после перезагрузки — то же задание)
  const a = JSON.stringify(MC.taskList('fireman', 'kids', MC.spotsOf('kids'), M.rng('ab12cd34'))), b = JSON.stringify(MC.taskList('fireman', 'kids', MC.spotsOf('kids'), M.rng('ab12cd34')));
  ok(a === b && a !== JSON.stringify(MC.taskList('fireman', 'kids', MC.spotsOf('kids'), M.rng('ffff0000'))), 'номер задания → те же цели; другой номер → другие');
  // улицы: пожары, починка — не внутри зданий
  for (const [x, z] of MC.M_FIRES) ok(!inB('metro', x, z, .3) && MZ.inRect(MZ.ZONES.metro, x, z, -2), 'пожар Большого города — на улице, не в здании', [x, z]);
  for (const [x, z] of MC.K_FIX) ok(!inB('kids', x, z, .3), 'починка — на площадке, не в здании', [x, z]);
  for (const id of ['m_bricks', 'm_site', 'm_tools', 'm_sample0', 'm_sample1', 'm_sample2', 'm_lab0', 'm_lab1', 'k_tools']) { const [x, , z] = MC.SPOTS[id]; ok(!inB(id[0] === 'k' ? 'kids' : 'metro', x, z, .2), `точка ${id} — не в стене здания`, [x, z]); }
  // время задания у «Ученика» — не больше, чем занимает само задание бегом (иначе ждать «сдачу» долго)
  console.log('  задания: бегом (медиана / самое быстрое) против минимального времени у «Ученика», с');
  for (const [k, e] of Object.entries(est)) {
    console.log(`    ${k.padEnd(18)} ${e.med.toFixed(1).padStart(5)} / ${e.lo.toFixed(1).padStart(5)}   min ${e.min}`);
    ok(e.med >= e.min * .7, `${k}: обычно ждать сдачи не больше ~30 % минимального времени`, e);
  }
}

// ═══ 3. Правила ═══
{
  const now = 1792800000, cs = () => ({ treasury: 5000, frozen: false, wage_k: 100, site: 0 });
  let st = RU.fresh();
  ok(RU.lvl(D, 0) === 0 && RU.lvl(D, 29) === 0 && RU.lvl(D, 30) === 1 && RU.lvl(D, 150) === 2 && RU.lvl(D, 1500) === 4, 'уровни 0/30/150/500/1500');
  ok(RU.minS(D, 'fire', 0) === 25 && RU.minS(D, 'fire', 4) === 20 && RU.minS(D, 'fire', 1) === 24 && RU.minS(D, 'seller', 1) === 15, 'минимальное время: 25 → 20 у «Мастера», округление вверх (23,75 → 24)');
  ok(RU.g100(D, 'cook', 0, 0, 100) === 600 && RU.g100(D, 'cook', 1, 0, 100) === 660 && RU.g100(D, 'cook', 0, 5, 100) === 630 && RU.g100(D, 'cook', 4, 20, 100) === 1152, 'зарплата в сотых: 6 → 6,60 (навык) → 6,30 (еда) → 11,52');
  let r = RU.act(D, st, 'task', { n: 'x' }, now, cs()); ok(r.reason === 'job', 'без работы — job');
  r = RU.act(D, st, 'job', { city: 'kids', prof: 'police', place: 'm_police' }, now, cs()); ok(r.reason === 'args', 'полиция не в детском городке');
  r = RU.act(D, st, 'job', { city: 'kids', prof: 'cook', place: 'k_bake' }, now, cs(), () => .5);
  ok(r.ok && r.st.cash === 50 && r.got.grant === 50 && r.st.job.n.length === 8 && r.st.job.k === 5, 'работа: подарок 50, номер задания');
  st = r.st;
  ok(RU.act(D, st, 'task', { n: 'zz' }, now + 30, cs()).reason === 'nonce', 'чужой номер');
  r = RU.act(D, st, 'task', { n: st.job.n }, now + 10, cs()); ok(r.reason === 'too_soon' && r.wait === 10 && r.st.cash === 50 && r.st.act_n === 2, 'рано: ждать 15 с, кошелёк прежний (счётчик частоты — растёт)', r);
  // 60 заданий: 40 полных, 20 половинных, 61-е — отказ; с 31-го — «Работник»
  let t = now, gsum = 0, c = cs();
  for (let i = 0; i < 60; i++) { t += 20; r = RU.act(D, st, 'task', { n: st.job.n }, t, c); if (!r.ok) break; st = r.st; c = r.cs; gsum += r.got.g100; }
  ok(r.ok && st.xpd.cook === 60 && st.skills.cook === 60, '60 заданий за день');
  const want = 30 * 570 + 10 * 627 + 20 * Math.floor(660 / 2) - 20 * Math.floor(Math.floor(660 / 2) * 5 / 100);   // нетто в сотых
  ok(gsum === 30 * 600 + 10 * 660 + 20 * 330, 'валовая: 30×6,00 + 10×6,60 + 20×3,30', gsum);
  ok(st.cash === 50 + Math.floor(want / 100) && st.frac === want % 100, 'нетто с налогом 5 % — копейки копятся точно', { cash: st.cash, frac: st.frac, want });
  ok(5000 - c.treasury === st.cash - 50, 'казна заплатила ровно столько, сколько пришло в кошелёк');
  t += 20; r = RU.act(D, st, 'task', { n: st.job.n }, t, c); ok(r.reason === 'day_cap' && r.cap === 'prof', '61-е — смени работу');
  // лимит дня: зарплата 100 → 400 💵 за 4 задания
  const D2 = M.merge(M.SERVER, { 'profs.fire.wage': 100 });
  let s2 = RU.act(D2, RU.fresh(), 'job', { city: 'metro', prof: 'fire', place: 'm_fire' }, now, cs()).st, n = 0;
  for (let i = 0; i < 8; i++) { const x = RU.act(D2, s2, 'task', { n: s2.job.n }, now + 30 * (i + 1), { treasury: 1e6, frozen: false, wage_k: 100 }); if (x.ok) { s2 = x.st; n++; } else { r = x; break; } }
  ok(n === 4 && s2.wd === 40000 && r.reason === 'day_cap' && r.cap === 'wage', 'зарплата в день — 400 💵 валовых, дальше — отказ', { n, wd: s2.wd, r: r.reason });
  ok(RU.act(D2, s2, 'task', { n: s2.job.n }, now + 86400, { treasury: 1e6, frozen: false, wage_k: 100 }).ok, 'на следующий день — снова можно');
  // касса пуста, пауза
  const s3 = RU.act(D, RU.fresh(), 'job', { city: 'kids', prof: 'fire', place: 'k_fire' }, now, cs()).st;
  ok(RU.act(D, s3, 'task', { n: s3.job.n }, now + 30, { treasury: 304, frozen: false, wage_k: 100 }).reason === 'no_slots', 'казна у запаса — «касса пуста»');
  ok(RU.act(D, s3, 'task', { n: s3.job.n }, now + 30, { treasury: 5000, frozen: true, wage_k: 100 }).reason === 'frozen', 'пауза города');
  // еда: больший бонус не перебивается меньшим, кончается
  let s4 = RU.act(D, RU.fresh(), 'buy', { city: 'kids', place: 'k_bake', item: 'pie', qty: 2 }, now, cs()).st;
  ok(s4.cash === 50 - 30 && s4.food.pie === 2 && s4.granted, 'первая покупка — с подарком: 50 − 2 × 15');
  ok(RU.act(D, s4, 'buy', { city: 'kids', place: 'k_bake', item: 'pie', qty: 2 }, now, cs()).reason === 'cash', 'не хватает денек');
  ok(RU.act(D, s4, 'buy', { city: 'kids', place: 'k_ice', item: 'pie' }, now, cs()).reason === 'args', 'в киоске пирога нет');
  s4 = RU.act(D, s4, 'eat', { item: 'pie' }, now, null).st; ok(s4.buffs.food.p === 10 && s4.buffs.food.u === now + 3600, 'пирог: +10 % на час');
  s4.food.bun = 1; const s5 = RU.act(D, s4, 'eat', { item: 'bun' }, now + 60, null).st;
  ok(s5.buffs.food.p === 10 && !s5.food.bun, 'булочка (+5 %) не перебивает пирог (+10 %), но съедена');
  ok(RU.buffP(D, s5, now + 3599) === 10 && RU.buffP(D, s5, now + 3601) === 0, 'бонус кончился через час');
  let s6 = RU.fresh(); s6.granted = true; s6.cash = 10000;
  for (let i = 0; i < 4; i++) s6 = RU.act(D, s6, 'buy', { city: 'metro', place: 'm_shop', item: ['apple', 'juice', 'burger', 'apple'][i], qty: 5 }, now + i, cs()).st;
  ok(RU.act(D, s6, 'buy', { city: 'metro', place: 'm_shop', item: 'juice', qty: 1 }, now + 9, cs()).reason === 'day_cap', 'еды в день — не больше 20');
  ok(RU.act(D, s6, 'buy', { city: 'metro', place: 'm_shop', item: 'apple', qty: 1 }, now + 86400, cs()).reason === 'full', 'одного вида в кармане — не больше 10');
  // частота
  let s7 = RU.fresh(), tf = -1; for (let i = 0; i < 62; i++) { const x = RU.act(D, s7, 'eat', { item: 'bun' }, now, null); s7 = x.st; if (x.reason === 'too_fast') { tf = i; break; } }
  ok(tf === 60, 'не больше 60 ходов в минуту', tf);
  // центробанк и эмиссия
  ok(RU.kNext(D, 1000, 3000) === 950 && RU.kNext(D, 1000, 1800) === 980 && RU.kNext(D, 1000, 300) === 1050 && RU.kNext(D, 1000, 1200) === 1020 && RU.kNext(D, 1100, 1500) === 1090 && RU.kNext(D, 520, 9999) === 500, 'k: −50/−20/+50/+20, к 1000 по 10, не ниже 500');
  ok(RU.issue(D, 'kids', 0, 1000) === 300 && RU.issue(D, 'kids', 10, 1000) === 1500 && RU.issue(D, 'kids', 1000, 1000) === 6000 && RU.issue(D, 'metro', 3, 1200) === 1176, 'эмиссия: база + за жителя, потолок, × k');
  ok(RU.capT(D, 'kids', 0) === 9000, 'потолок казны: 30 дней эмиссии');
  // настройки
  const D3 = M.merge(M.SERVER, { 'profs.cook.wage': 9, 'nope.x': 5, 'cities.kids.tax.income': 0 }, 3);
  ok(D3.profs.cook.wage === 9 && D3.cities.kids.tax.income === 0 && !D3.nope && D3.cv === 3 && M.SERVER.profs.cook.wage === 6, 'настройки админа поверх каталога (каталог не меняется)');
  ok(M.cfgOk(D, 'profs.cook.wage', 7) && !M.cfgOk(D, 'profs.cook.wage', 0) && !M.cfgOk(D, 'profs.cook.wage', 7.5) && M.cfgOk(D, 'profs.cook.wage', null) && !M.cfgOk(D, 'profs', 1) && !M.cfgOk(D, 'cities.metro.tax.income', 16), 'белый список настроек');
  ok(RU.stage(D, 0) === 0 && RU.stage(D, 10) === 1 && RU.stage(D, 49) === 4 && RU.stage(D, 50) === 0, 'стройка: 10 заданий — этап, 5 этапов — дом');
  // чистка мусора
  const sz = RU.sanitize({ cash: -5, frac: 120, skills: { cook: 3, 'X Y': 2 }, job: { prof: 'cook', city: 'kids', n: 5 }, buffs: { food: { p: 'x' } } });
  ok(sz.cash === 0 && sz.frac === 99 && sz.skills.cook === 3 && !sz.skills['X Y'] && sz.job.n === '' && !sz.buffs.food, 'мусор из браузера / сервера отбрасывается', sz);
}

// ═══ 4. «Сдать работу» при 30 / 60 / 144 FPS (ответы сервера — между кадрами, как в браузере) ═══
const part4 = async () => {
  const STEP = 1 / 60;
  async function sim(fps, steps, need, o = {}){
    const T0 = 5000;
    let wall = 0, acc = 0, k = 0, i = 0, hold = 0, px = 0, pz = 0;
    const done = [], sends = [];
    const clock = () => T0 + wall + (o.skew || 0);
    const R = M.TaskRunner({ clock, send: n => { sends.push({ k, srv: T0 + wall, n }); return Promise.resolve(o.reply ? o.reply(sends.length) : { ok: true }); }, after: res => { if (res.reason === 'too_soon') R.retry(res.wait); } });
    R.begin('n1', T0 - (o.resume || 0), need, steps.length);
    const update = dt => {
      k++;
      if (i < steps.length) {
        const s = steps[i], d = Math.hypot(s.x - px, s.z - pz), v = o.speed ?? 8.17;
        if (d > 1.001) { const m = Math.min(d - 1, v * dt); px += (s.x - px) / d * m; pz += (s.z - pz) / d * m; hold = 0; }
        else { hold += dt; if (hold >= (s.hold || 0)) { i++; hold = 0; done.push(k); R.done(); } }
      }
      R.update(dt);
    };
    for (let f = 0; f < fps * 200 && (sends.length < (o.sends || 1)); f++) {
      wall += 1 / fps; acc += 1 / fps; let n = 0;
      while (acc >= STEP && n < 5) { update(STEP); acc -= STEP; n++; }
      if (n === 5) acc = 0;
      await null;   // ответ сервера (then) — до следующего кадра
    }
    return { done, sends, R };
  }
  const steps = [{ x: 12, z: 0, hold: 1 }, { x: 12, z: 18, hold: 2 }, { x: 0, z: 18, hold: 3 }, { x: 30, z: 40, hold: .8 }];
  const runs = []; for (const f of [30, 60, 144]) runs.push([f, await sim(f, steps, 25)]);
  const base = runs[1][1];
  for (const [f, r] of runs) {
    ok(r.done.length === 4 && r.done.every((k, j) => Math.abs(k - base.done[j]) <= 1), `${f} FPS: шаги задания на тех же шагах логики (±1)`, { f: r.done, base: base.done });
    ok(r.sends.length === 1 && Math.abs(r.sends[0].k - base.sends[0].k) <= 1, `${f} FPS: работа сдана один раз, на том же шаге (±1)`, r.sends);
    ok(r.sends[0].srv - 5000 >= 25, `${f} FPS: не раньше минимального времени`, r.sends[0].srv - 5000);
  }
  // шаги быстрее минимума (телепорт, мгновенные удержания) — всё равно ждёт
  for (const f of [30, 60, 144]) { const r = await sim(f, steps.map(s => ({ ...s, hold: 0 })), 25, { speed: 1e6 }); ok(r.sends.length === 1 && r.sends[0].srv - 5000 >= 25 && r.sends[0].srv - 5000 < 26, `${f} FPS, мгновенные шаги: ждёт до 25 с и сдаёт`, r.sends); }
  // часы клиента спешат на 5 с / отстают на 5 с — по серверу не раньше
  for (const skew of [5, -5]) { const r = await sim(60, steps.map(s => ({ ...s, hold: 0 })), 25, { speed: 1e6, skew }); ok(r.sends[0].srv - 5000 >= 25, `часы ${skew > 0 ? 'спешат' : 'отстают'} на 5 с — не раньше времени`, r.sends); }
  // сервер сказал «рано, ждать 2 с» — ещё одна отправка через 2 с, не раньше
  { const r = await sim(60, steps.map(s => ({ ...s, hold: 0 })), 25, { speed: 1e6, sends: 2, reply: n => (n === 1 ? { ok: false, reason: 'too_soon', wait: 2 } : { ok: true }) });
    ok(r.sends.length === 2 && r.sends[1].srv - r.sends[0].srv >= 2 - .02, '«рано» — повтор через указанное время', r.sends); }
  // вернулся после перезагрузки: задание выдано 40 с назад — сдаёт сразу после шагов
  { const r = await sim(60, steps, 25, { resume: 40 }); ok(r.sends.length === 1 && r.sends[0].k - r.done[3] <= 1, 'после перезагрузки (задание давно выдано) — сдаёт сразу', [r.done, r.sends]); }
  // мусор за кадр: update не создаёт объектов (только счёт)
  { const R = M.TaskRunner({ clock: () => 0, send: () => ({ ok: true }) }); R.begin('x', 0, 1e9, 1); const h0 = process.memoryUsage().heapUsed; for (let i = 0; i < 1e6; i++) R.update(STEP); const dh = process.memoryUsage().heapUsed - h0; ok(dh < 2e6, 'TaskRunner.update — без мусора (1 млн шагов)', dh); }
};

// ═══ 5. Пробный режим (гость; city.sql ещё нет) ═══
(async () => {
  await part4();
  const A = M.api;
  globalThis.currentUser = null;
  await A.init(true);
  ok(A.mode === 'trial' && A.why === 'guest' && A.sv === 0 && M.sv === 0, 'гость — пробный режим');
  let r = await A.act('job', { city: 'kids', prof: 'teacher', place: 'k_school' });
  ok(r.ok && A.st.cash === 50 && A.st.job.prof === 'teacher', 'пробно: работа и подарок 50 «пробных»');
  const T0 = A.st.job.t;
  r = await A.act('task', { n: A.st.job.n }); ok(r.reason === 'too_soon', 'пробно: тоже не раньше времени');
  const realNow = Date.now; Date.now = () => (T0 + 21) * 1000;
  r = await A.act('task', { n: A.st.job.n }); ok(r.ok && A.st.cash === 55 && r.c?.site === 0, 'пробно: зарплата 5,70 → 5', r.got);
  r = await A.act('buy', { city: 'kids', place: 'k_bake', item: 'bun' }); ok(r.ok && A.st.food.bun === 1, 'пробно: купил булочку');
  Date.now = realNow;
  const saved = JSON.parse(LS.get('d37_city_trial'));
  ok(saved.st.cash === A.st.cash && saved.h.length === 3 && saved.h[0].k === 'food', 'пробный кошелёк и история — в браузере (d37_city_trial)');
  // «вошёл», city.sql ещё нет — тоже пробный, с другой подсказкой; пробные не переносятся
  globalThis.currentUser = { id: 'u1' }; globalThis.sbClient = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) };
  await A.init(true);
  ok(A.mode === 'trial' && A.why === 'nosql' && /появится, когда сайт обновится/.test(M.ui.trialNote()), 'вошёл, а city.sql нет — пробный режим с подсказкой «появится, когда сайт обновится»');
  // сервер есть — пробные денки не переносятся
  globalThis.sbClient = { rpc: async name => (name === 'city_state' ? { data: { ok: true, now: Math.floor(Date.now() / 1000), v: 1, cv: 0, st: RU.fresh(), age: { metro: true }, banned: false } } : { data: M.SERVER }) };
  await A.init(true);
  ok(A.mode === 'server' && A.st.cash === 0 && M.sv === 1, 'на сервере — свой кошелёк, пробные не переносятся');
  ok(JSON.parse(LS.get('d37_city_trial')).st.cash === saved.st.cash, 'пробные остались в браузере (не стёрты, не перенесены)');
  console.log(`city-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

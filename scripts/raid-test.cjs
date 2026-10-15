// Тесты «Набегов» (docs/RAIDS.md) в node. Запуск из корня сайта: node scripts/raid-test.cjs [--fast]
//  0) js/games/raid-sim.js — свежая копия api/_lib/raid-sim.js (браузер и сервер считают одним кодом);
//  1) повторяемость: бот играет «вживую» (решает на каждом шаге) → ввод → сервер (ESM-модуль) и «браузер» (копия в отдельном
//     vm-контексте, без Node) дают тот же итог и ту же сверку состояния; тот же ввод — тот же бой;
//  2) проверка ввода: зона высадки, лишние отряды, герой, удар, порядок шагов, после конца боя, мусор;
//  3) базы разбойников: по правилам участка; 4) баланс ботами; 5) добыча, кубки, потолки (как raids.sql);
//  6) маршрут /api/raid (api/_lib/routes/raid.js) с подменённой базой.
const fs = require('fs'), path = require('path'), vm = require('vm'), { spawnSync } = require('child_process'), { pathToFileURL } = require('url');
const SITE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/games/mir-base.js'), 'utf8'), { filename: 'mir-base.js' });
const MB = globalThis.MirBase, RU = MB.Rules;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const J = o => JSON.stringify(o);

(async () => {
  const { makeRaidSim, RaidSim: S } = await import(pathToFileURL(path.join(SITE, 'api/_lib/raid-sim.js')).href);
  const defs = JSON.parse(J(MB.SERVER)), R = defs.raid, C = S.C, OFF = S.OFF, PN = S.PN;

  // ═══ 0. Копия для браузера ═══
  {
    const r = spawnSync(process.execPath, [path.join(SITE, 'scripts/make-raid-sim.mjs'), SITE, '--check'], { encoding: 'utf8' });
    ok(r.status === 0, 'js/games/raid-sim.js — свежая копия api/_lib/raid-sim.js (node scripts/make-raid-sim.mjs)', r.stdout + r.stderr);
    ok(!/\b(require|import|process|window|document|fetch|Date|Math\.random|performance)\b/.test(makeRaidSim.toString().replace(/root\./g, '')), 'бой без ссылок наружу: ни сети, ни часов, ни Math.random');
  }
  // «браузер»: копия в отдельном контексте
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(SITE, 'js/games/raid-sim.js'), 'utf8'), ctx, { filename: 'raid-sim.js' });
  const W = ctx.RaidSim;
  ok(W && W.VER === S.VER && typeof W.run === 'function', 'копия для браузера загружается (window.RaidSim)');

  // ── Бот-нападающий: сторона ближе к ратуше (иногда случайная), план высадки, «Удар» героя — когда рядом 3+ постройки ──
  function armyFor(th){
    const cap = defs.k.barracks.army[th - 1], U = defs.u;
    const a = { ...[{}, {}, { tank: 2 }, { tank: 2, breaker: 4 }, { tank: 2, breaker: 4, flyer: 2 }, { tank: 3, breaker: 4, flyer: 2, healer: 1 }][th] };
    const used = Object.entries(a).reduce((s, [u, n]) => s + U[u].sp * n, 0), rest = cap - used, f = Math.round(rest * .6);
    a.fighter = f; a.archer = rest - f;
    return a;
  }
  function play(cfg, seed, opts = {}){
    const B = S.create(cfg), r = S.rng32(seed * 7919 + 13), ri = n => r() % n, ins = [];
    const thb = B.bs.find(b => b.k === 'th') || B.bs[0];
    const sides = [
      { d: thb.cz - OFF * C, p: t => [t, OFF * C - C], a: 'x' }, { d: (OFF + PN) * C - thb.cz, p: t => [t, (OFF + PN) * C + C], a: 'x' },
      { d: thb.cx - OFF * C, p: t => [OFF * C - C, t], a: 'z' }, { d: (OFF + PN) * C - thb.cx, p: t => [(OFF + PN) * C + C, t], a: 'z' },
    ];
    let side = sides.slice().sort((a, b) => a.d - b.d)[0];
    if (ri(100) < (opts.bad ?? 30)) side = sides[ri(4)];
    const mid = side.a === 'x' ? thb.cx : thb.cz;
    const at = off => { const v = Math.max(C, Math.min(S.W - C, mid + off)); const [x, z] = side.p(v); return [Math.max(0, Math.min(S.W - 1, x + ri(60) - 30)), Math.max(0, Math.min(S.W - 1, z + ri(60) - 30))]; };
    const plan = [], army = cfg.army;
    let t = 0;
    for (let i = 0; i < (army.tank || 0); i++) plan.push([t + i * 3, 'tank', 0]);
    t = army.tank ? 40 : 0;
    for (let i = 0; i < (army.breaker || 0); i++) plan.push([t + (i >> 1) * 4, 'breaker', ((i & 1) ? 1 : -1) * 120]);
    plan.push([t + 20, 'hero', 0]);
    t += 30;
    for (let i = 0; i < (army.fighter || 0); i++) plan.push([t + i * 2, 'fighter', Math.round(((i % 7) - 3) / 3 * 2.6 * C)]);
    t += 20;
    for (let i = 0; i < (army.archer || 0); i++) plan.push([t + i * 2, 'archer', Math.round(((i % 5) - 2) / 2 * 2.6 * C)]);
    t += 60;
    for (let i = 0; i < (army.flyer || 0); i++) plan.push([t + i * 6, 'flyer', (i - 1) * 200]);
    for (let i = 0; i < (army.healer || 0); i++) plan.push([t + 60 + i * 10, 'healer', 0]);
    plan.sort((a, b) => a[0] - b[0]);
    let pi = 0, ab = false;
    while (!B.over) {
      while (pi < plan.length && plan[pi][0] <= B.tick) { const [, u, off] = plan[pi++], [x, z] = at(off); if (!B.deploy(u, x, z)) ins.push({ t: B.tick, u, x, z }); }
      const h = B.us[B.heroIdx];
      if (!ab && h && h.alive && B.HERO) {
        const r2 = B.HERO.abr * B.HERO.abr;
        let n = 0; for (const b of B.bs) if (b.alive && b.cnt) { const dx = Math.max(b.x0 * C - h.x, 0, h.x - b.x1 * C), dz = Math.max(b.z0 * C - h.z, 0, h.z - b.z1 * C); if (dx * dx + dz * dz <= r2) n++; }
        if ((n >= 3 || h.hp * 10 < h.mhp * 4) && !B.ability()) { ins.push({ t: B.tick, a: 1 }); ab = true; }
      }
      if (pi >= plan.length && !B.us.some(o => o.alive) && B.tick > 200) { if (!B.surrender()) ins.push({ t: B.tick, s: 1 }); break; }
      B.step(); B.ev.length = 0;
    }
    return { B, ins, res: B.result(), hash: B.hash() };
  }
  const typical = (th, v) => S.bot(100 + th, defs, v);
  const stat = arr => { const d = [0, 0, 0, 0]; let pct = 0; for (const r of arr) { d[r.stars]++; pct += r.pct; } return { d, mean: arr.reduce((a, r) => a + r.stars, 0) / arr.length, pct: pct / arr.length, n: arr.length }; };
  const show = s => `★0 ${s.d[0]} · ★1 ${s.d[1]} · ★2 ${s.d[2]} · ★3 ${s.d[3]} · средн. ${s.mean.toFixed(2)}★ ${Math.round(s.pct)}%`;

  // ═══ 1. Повторяемость: живой бой = повтор на сервере = повтор в «браузере» ═══
  {
    let same = 0, n = 0, worst = 0;
    const t0 = Date.now();
    for (let i = 0; i < (FAST ? 15 : 60); i++) {
      const th = 1 + (i % 5), cfg = { defs, layout: typical(th, i & 3), army: armyFor(th), hero: th, seed: 1000 + i };
      const live = play(cfg, i);
      const ts = Date.now(), srv = S.run(cfg, live.ins); worst = Math.max(worst, Date.now() - ts);
      const web = W.run(JSON.parse(J(cfg)), JSON.parse(J(live.ins)));
      const again = S.run(cfg, live.ins);
      n++;
      const k = r => J({ s: r.stars, p: r.pct, t: r.ticks, d: r.destroyed, u: r.used, h: r.hash, w: r.why });
      if (srv.ok && web.ok && k(srv) === k(web) && k(srv) === k(again) && srv.hash === live.hash && srv.stars === live.res.stars && srv.ticks === live.res.ticks) same++;
      else if (n - same < 3) console.log('разошлось', i, { live: live.res.stars, srv, web: { ok: web.ok, s: web.stars, h: web.hash } });
    }
    ok(same === n, `${n} боёв: живой бой, сервер и браузер — один и тот же итог и состояние (сверка hash)`);
    ok(worst < 400, `сервер пересчитывает бой быстро: худший ${worst} мс`, worst);
    console.log(`   повторяемость: ${n} боёв за ${Date.now() - t0} мс, худший пересчёт ${worst} мс`);
    // зерно влияет (первые выстрелы, разброс мортиры), ввод тот же
    const cfg = { defs, layout: typical(4, 1), army: armyFor(4), hero: 4, seed: 1 }, p = play(cfg, 3);
    const hs = new Set([1, 2, 3, 4, 5].map(seed => S.run({ ...cfg, seed }, p.ins).hash));
    ok(hs.size > 1, 'другое зерно — другой бой (зерно не пустое)');
    // ввод без высадки — бой не начался
    const e = S.run(cfg, []);
    ok(e.ok && e.deployed === 0 && e.stars === 0 && e.ticks === 0, 'без высадки — бой не начался (отмена)', e);
  }

  // ═══ 2. Проверка ввода ═══
  {
    const cfg = { defs, layout: typical(3, 0), army: { fighter: 3, archer: 1 }, hero: 2, seed: 5 };
    const R2 = ins => S.run(cfg, ins);
    const ring = [C, C], inside = [8 * C, 8 * C];
    ok(R2([{ t: 0, u: 'fighter', x: ring[0], z: ring[1] }]).ok, 'высадка в полосе — можно');
    ok(R2([{ t: 0, u: 'fighter', x: inside[0], z: inside[1] }]).reason === 'zone', 'внутри участка — нельзя (zone)');
    ok(R2([{ t: 0, u: 'fighter', x: -1, z: 5 }]).reason === 'xy' && R2([{ t: 0, u: 'fighter', x: S.W, z: 5 }]).reason === 'xy', 'за картой — нельзя');
    ok(R2([1, 2, 3, 4].map(i => ({ t: i, u: 'fighter', x: C, z: C }))).reason === 'unit', 'четвёртый боец при трёх в армии — нельзя');
    ok(R2([{ t: 0, u: 'tank', x: C, z: C }]).reason === 'unit' && R2([{ t: 0, u: 'dragon', x: C, z: C }]).reason === 'unit', 'отряда нет в армии / неизвестный');
    ok(R2([{ t: 0, u: 'hero', x: C, z: C }, { t: 5, u: 'hero', x: C, z: C }]).reason === 'unit', 'герой — один раз');
    ok(S.run({ ...cfg, hero: 0 }, [{ t: 0, u: 'hero', x: C, z: C }]).reason === 'unit', 'без ратуши — без героя');
    ok(R2([{ t: 0, u: 'fighter', x: C, z: C }, { t: 3, a: 1 }]).reason === 'ab', 'удар без героя — нельзя');
    ok(R2([{ t: 0, u: 'hero', x: C, z: C }, { t: 3, a: 1 }, { t: 9, a: 1 }]).reason === 'ab', 'удар — один раз');
    ok(R2([{ t: 5, u: 'fighter', x: C, z: C }, { t: 4, u: 'fighter', x: C, z: C }]).reason === 'tick', 'шаги — по порядку');
    ok(R2([{ t: 3601, u: 'fighter', x: C, z: C }]).reason === 'tick' && R2([{ t: 1.5, u: 'fighter', x: C, z: C }]).reason === 'tick', 'шаг — целый, не дальше 3 минут');
    ok(R2([{ t: 0, u: 'fighter', x: C, z: C }, { t: 10, s: 1 }, { t: 11, u: 'fighter', x: C, z: C }]).reason === 'shape', '«сдаться» — только последним');
    ok(R2([{ t: 0, u: 'fighter', x: C, z: C, hack: 1 }]).reason === 'shape' && R2([{ t: 0, u: 'fighter', x: '1', z: C }]).reason === 'shape' && R2([{ t: 0 }]).reason === 'shape' && R2([null]).reason === 'shape' && R2('x').reason === 'shape', 'мусор в вводе — отказ');
    ok(R2(Array.from({ length: 401 }, () => ({ t: 0, u: 'fighter', x: C, z: C }))).reason === 'many', 'больше 400 записей — отказ');
    // после конца боя ввода нет
    const big = { defs, layout: [{ i: 1, k: 'th', x: 5, z: 5, r: 0, l: 1 }], army: { fighter: 30 }, hero: 0, seed: 1 };
    const quick = S.run(big, Array.from({ length: 30 }, (_, i) => ({ t: i, u: 'fighter', x: 7 * C, z: C })));
    ok(quick.ok && quick.stars === 3 && quick.why === 'all', 'одна ратуша и 30 бойцов — 3★', quick);
    ok(S.run(big, [...Array.from({ length: 30 }, (_, i) => ({ t: i, u: 'fighter', x: 7 * C, z: C })).slice(0, 29), { t: quick.ticks + 5, u: 'fighter', x: 7 * C, z: C }]).reason === 'late', 'высадка после конца боя — отказ (late)');
    ok(S.check([{ t: 0, u: 'fighter', x: 1, z: 1 }], 3600) === null && S.check({}, 3600) === 'shape', 'check: форма ввода');
  }

  // ═══ 3. Базы разбойников ═══
  {
    let bad = 0;
    const levels = [0, ...R.campTh.map((_, i) => i + 1), 101, 102, 103, 104, 105];
    for (const lv of levels) for (let v = 0; v < (lv > 100 ? 4 : 1); v++) {
      const L = S.bot(lv, defs, v), L2 = S.bot(lv, defs, v);
      if (J(L) !== J(L2)) { bad++; console.log('база не повторяется', lv, v); }
      const th = L.find(it => it.k === 'th')?.l || 0, want = lv === 0 ? 1 : lv > 100 ? lv - 100 : R.campTh[lv - 1];
      if (th !== want || !L.some(it => it.k === 'house')) { bad++; console.log('нет ратуши/дома или не та ратуша', lv, th, want); }
      for (const it of L) {
        const [w, d] = RU.fp(it.k, it.r);
        if (!RU.fits(L, it.x, it.z, w, d, it.i)) { bad++; console.log('пересечение', lv, it); break; }
        if (it.k !== 'th' && it.l > th) { bad++; console.log('уровень выше ратуши', lv, it); break; }
        if (it.l > defs.k[it.k].lv) { bad++; console.log('уровень выше предела', lv, it); break; }
      }
      for (const k of Object.keys(defs.k)) if (defs.k[k].g !== 'deco' && L.filter(it => it.k === k).length > RU.limit(k, th)) { bad++; console.log('лимит', lv, k); }
      const B = S.create({ defs, layout: L, army: {}, hero: 0, seed: 1 });
      if (B.total !== L.filter(it => !['wall', 'bomb', 'airmine'].includes(it.k)).length) { bad++; console.log('не все постройки в бою', lv); }
    }
    ok(bad === 0, 'базы разбойников (учебная, 12 лагерей похода, 5 ратуш × 4 варианта): по правилам участка и повторяются');
    ok(S.bot(13, defs) === null && S.bot(-1, defs) === null && S.bot(106, defs) === null && S.bot(50, defs) === null, 'неизвестный уровень — null');
    // бой видит постройки участка как в мире: клетки — те же (сдвиг 2), стройка не участвует, украшения — нет
    const L = [{ i: 1, k: 'th', x: 0, z: 0, r: 0, l: 2 }, { i: 2, k: 'tree', x: 5, z: 5, r: 0, l: 1 }, { i: 3, k: 'cannon', x: 8, z: 8, r: 0, l: 0, ul: 1, ue: 9 }, { i: 4, k: 'tower', x: 3, z: 0, r: 0, l: 2, ul: 3, ue: 9 }];
    const B = S.create({ defs, layout: L, army: {}, hero: 0, seed: 1 });
    ok(B.bs.length === 2 && B.bs[0].x0 === OFF && B.bs[0].hp === defs.k.th.hp[1] && B.bs[1].k === 'tower' && B.bs[1].busy, 'клетки как в мире, стройка (ур. 0) и украшения не участвуют, улучшаемая вышка — busy');
  }

  // ═══ 4. Баланс ═══
  {
    const N = FAST ? 16 : 40, t0 = Date.now();
    const runs = (lay, th, opts = {}) => { const out = []; for (let i = 0; i < N; i++) out.push(play({ defs, layout: typeof lay === 'function' ? lay(i) : lay, army: opts.army || armyFor(th), hero: opts.hero ?? th, seed: i }, i, opts).res); return stat(out); };
    const same = [];
    for (let th = 1; th <= 5; th++) { const s = runs(i => typical(th, i & 3), th); same.push(s); console.log(`   ратуша ${th}: средняя армия против обычной базы — ${show(s)}`); }
    for (let th = 2; th <= 5; th++) ok(same[th - 1].mean >= 1.3 && same[th - 1].mean <= 2.4 && same[th - 1].d[3] / N <= .4 && same[th - 1].d[0] / N <= .2, `ратуша ${th}: средняя армия против своей ратуши — 1,3…2,4★, 3★ не больше 40 %, 0★ не больше 20 %`, same[th - 1]);
    ok(same[0].d[0] === 0 && same[0].mean >= 1.8, 'ратуша 1 не безнадёжна для нападающего: всегда хотя бы 1★', same[0]);
    ok(same[0].d[3] / N <= .6, 'и для защитника: 3★ по первой ратуше — не каждый раз', same[0]);
    const up = []; for (let th = 2; th <= 5; th++) up.push(runs(i => typical(th, i & 3), th - 1, { army: armyFor(th - 1), hero: th - 1 }));
    console.log('   ратуша выше на 1:', up.map(show).join(' | '));
    ok(up.every((s, i) => s.mean < same[i + 1].mean && s.d[0] < s.n), 'на ратушу выше — труднее, но звёзды бывают', up.map(s => s.d));
    const full = runs(() => { const L = S.bot(R.campTh.length, defs); for (const it of L) it.l = Math.min(defs.k[it.k].lv, 5); return L; }, 5);
    console.log('   полностью улучшенная база 5 против армии 5:', show(full));
    ok(full.d[3] / N <= .1 && full.mean <= 1.5, 'полностью улучшенную оборону не разбить запросто: 3★ — не больше 10 %, в среднем ≤ 1,5★', full);
    const tut = runs(S.bot(0, defs), 1, { army: R.tutArmy, hero: 1, bad: 0 });
    ok(tut.d[3] === N, 'учебный набег с учебной армией — всегда 3★', tut);
    // заборы и оборона важны
    const noWalls = runs(i => typical(3, i & 3).filter(it => it.k !== 'wall'), 3), noDef = runs(i => typical(3, i & 3).filter(it => !['cannon', 'tower', 'mortar', 'bomb', 'airmine'].includes(it.k)), 3);
    const lowDef = runs(i => typical(3, i & 3).map(it => (['cannon', 'tower', 'mortar'].includes(it.k) ? { ...it, l: 1 } : it)), 3);
    console.log(`   ратуша 3 без заборов: ${show(noWalls)} · без обороны: ${show(noDef)} · оборона 1 ур.: ${show(lowDef)}`);
    ok(noWalls.mean >= same[2].mean + .15, 'заборы важны: без них звёзд заметно больше', [noWalls.mean, same[2].mean]);
    ok(noDef.d[3] >= N * .9 && lowDef.mean > same[2].mean, 'оборона важна: без неё почти всегда 3★, слабая — больше звёзд');
    // поход: внутри одной ратуши лагеря труднее один за другим
    const camp = R.campTh.map((th, i) => runs(S.bot(i + 1, defs), th));
    console.log('   поход:', camp.map((s, i) => `${i + 1}: ${s.mean.toFixed(2)}★`).join(' · '));
    ok(camp.every((s, i) => i === 0 || R.campTh[i] !== R.campTh[i - 1] || s.mean <= camp[i - 1].mean + .15), 'поход: внутри ратуши — труднее с каждым лагерем', camp.map(s => +s.mean.toFixed(2)));
    ok(camp[0].mean >= 2.6 && camp.at(-1).mean <= 1.7, 'поход: первый лагерь — легко, последний — трудно');
    console.log(`   баланс: ${Date.now() - t0} мс`);
  }

  // ═══ 5. Добыча, кубки, итог (как raids.sql) ═══
  {
    const lay = [{ i: 1, k: 'th', x: 5, z: 2, r: 0, l: 2 }, { i: 2, k: 'store', x: 0, z: 0, r: 0, l: 2 }, { i: 3, k: 'store', x: 2, z: 0, r: 0, l: 1 }, { i: 4, k: 'mine', x: 9, z: 7, r: 0, l: 1, t0: 0 }, { i: 5, k: 'mine', x: 9, z: 9, r: 0, l: 2, t0: 0, ul: 3, ue: 99999 }];
    const now = 3600 * 4;
    const o = S.offer(defs, { layout: lay, bricks: 3000 }, 2, now);
    const prot = R.loot.prot[1] + R.loot.sprot[1] + R.loot.sprot[0];
    ok(o.prot === prot && o.pct === R.loot.pct && o.pool === Math.min(R.loot.cap[1], Math.floor((3000 - prot) * R.loot.pct / 100)), 'склад: защищено ратушей и складами, 20 % остального, не больше потолка', o);
    ok(o.st[1] === Math.floor(o.pool * R.loot.th / 100) && Object.values(o.st).reduce((a, b) => a + b, 0) === o.pool, 'доли: ратуша 40 %, остальное — складам (вся добыча разложена)', o.st);
    ok(o.st[2] > o.st[3], 'склад побольше — доля больше');
    ok(o.mn[4] === Math.floor(defs.k.mine.rate[0] * 4 * R.loot.mine / 100) && !(5 in o.mn), 'шахта — 50 % накопленного; на улучшении не копит', o.mn);
    ok(S.offer(defs, { layout: lay, bricks: 3000 }, 4, now).pct === R.loot.pct - 2 * R.loot.step && S.offer(defs, { layout: lay, bricks: 3000 }, 5, now).pct === Math.max(R.loot.min, R.loot.pct - 3 * R.loot.step), 'нападающий старше ратушей — процент меньше (не меньше минимума)');
    ok(S.offer(defs, { layout: lay, bricks: 100 }, 2, now).pool === 0, 'всё защищено — со склада ничего');
    const full = S.offer(defs, { layout: lay.map(it => (it.k === 'mine' ? { ...it, t0: -99999999 } : it)), bricks: 99999 }, 2, now);
    ok(full.total === R.loot.cap[1] && full.pool + Object.values(full.mn).reduce((a, b) => a + b, 0) === R.loot.cap[1], 'потолок за набег — склад и шахты вместе', full);
    ok(S.offer(defs, { layout: [{ i: 1, k: 'th', x: 0, z: 0, r: 0, l: 1 }], bricks: 99999 }, 1, 0).st[1] === R.loot.cap[0], 'без складов — всё у ратуши, потолок за набег');
    // итог
    const res = { stars: 2, destroyed: [1, 2, 4] };
    const x = { attTh: 2, attTr: 300, defTr: 340, lootDay: 0, pair: false, alt: false, attBricks: 100, attCap: 99999, defBricks: 3000, defProt: prot, mines: { 4: 9999 } };
    let s = S.settle(defs, o, res, x);
    ok(s.st === o.st[1] + o.st[2] && s.mines[4] === o.mn[4] && s.total === s.st + o.mn[4], 'добыча — доли разрушенных (склад 3 цел — его доля осталась)', s);
    const T = S.trophies(defs, 300, 340, 2);
    ok(T.win === 24 && T.delta === 16 && s.tr === 16 && s.attTr === 316 && s.defTr === 324, 'кубки: 20 + разница/10, × звёзды/3 (вверх)', [T, s.tr]);
    ok(S.trophies(defs, 340, 300, 0).delta === -(14 + Math.trunc(40 / 12)) && S.trophies(defs, 0, 5000, 3).win === R.tr.wmax && S.trophies(defs, 5000, 0, 3).win === R.tr.wmin && S.trophies(defs, 0, 5000, 0).lose === R.tr.lmin, 'кубки: поражение, пределы');
    ok(s.bonus === Math.floor(R.bonus[MB.league(300)] * 2 / 3) && s.added === s.total + s.bonus, 'бонус лиги за победу');
    ok(S.settle(defs, o, res, { ...x, attTr: 10, defTr: 3 }).attTr >= 0 && S.settle(defs, o, { stars: 0, destroyed: [] }, { ...x, attTr: 2 }).attTr === 0, 'кубки не уходят в минус');
    s = S.settle(defs, o, res, { ...x, defBricks: prot + 50 });
    ok(s.st === 50, 'защитник успел потратить — со склада только то, что есть сверх защиты', s);
    s = S.settle(defs, o, res, { ...x, mines: { 4: 10 } });
    ok(s.mines[4] === 10, 'шахту успели собрать — только то, что в ней сейчас');
    s = S.settle(defs, o, res, { ...x, lootDay: R.loot.day[1] - 30 });
    ok(s.total === 30 && s.st === 30 && !s.mines[4], 'дневной потолок: сначала склад, потом шахты', s);
    s = S.settle(defs, o, res, { ...x, lossDay: R.loot.lose[o.th - 1] - 25 });
    ok(s.total === 25 && s.st === 25, 'защитник за день теряет не больше потолка (по его ратуше)', s);
    s = S.settle(defs, o, res, { ...x, lossDay: R.loot.lose[o.th - 1] + 5, lootDay: 0 });
    ok(s.total === 0 && s.tr === T.delta, 'потолок потерь выбран — добычи нет, кубки есть');
    s = S.settle(defs, o, res, { ...x, pair: true });
    ok(s.total === 0 && s.tr === 0 && s.bonus === 0 && s.zero, 'с того же игрока раньше 20 ч — без добычи и кубков');
    s = S.settle(defs, o, res, { ...x, alt: true });
    ok(s.total === 0 && s.tr === 0 && s.defTr === 340, '«похожий» аккаунт — без добычи и кубков');
    s = S.settle(defs, o, res, { ...x, attBricks: 1000, attCap: 1100 });
    ok(s.added === 100 && s.total > 100, 'не влезло на склад нападающего — пропало (защитник теряет взятое)');
    // разбойники
    ok(S.pve(defs, 'bot', 3, 3, { bots: 0 }) === R.bot[2] && S.pve(defs, 'bot', 3, 1, { bots: 0 }) === Math.floor(R.bot[2] / 3) && S.pve(defs, 'bot', 3, 3, { bots: R.day.bots }) === 0, 'разбойники под ратушу: 3 раза в день');
    const c4 = R.camp[3];
    ok(S.pve(defs, 'camp', 4, 1, { best: 0 }) + S.pve(defs, 'camp', 4, 3, { best: 1 }) === c4 && S.pve(defs, 'camp', 4, 2, { best: 3 }) === 0, 'поход: добыча только за новые звёзды, всего — как за 3★');
    ok(S.pve(defs, 'tut', 0, 1, { tut: false }) === R.tut && S.pve(defs, 'tut', 0, 3, { tut: true }) === 0 && S.pve(defs, 'tut', 0, 0, {}) === 0, 'учебный — один раз и за звезду');
    ok(S.league(defs, 0) === 0 && S.league(defs, 2600) === R.league.length - 1 && MB.league(450) === S.league(defs, 450), 'лиги — одинаково в mir-base.js и бою');
  }

  // ═══ 6. Маршрут /api/raid ═══
  const routeFile = path.join(SITE, 'api/_lib/routes/raid.js');
  if (fs.existsSync(routeFile)) {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'd37raid-'));
    fs.cpSync(path.join(SITE, 'api'), path.join(tmp, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    const mod = await import(pathToFileURL(path.join(tmp, 'api/_lib/routes/raid.js')).href);
    const T = mod._test;
    ok(T && typeof mod.default === 'function', 'маршрут грузится');
    if (T) await require(path.join(__dirname, 'raid-route-test.cjs'))({ ok, T, S, defs, play, armyFor, typical, mod });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

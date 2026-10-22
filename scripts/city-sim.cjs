// «Живой город» — экономика P1 (денки 💵) в симуляции по ТЕМ ЖЕ правилам, что сервер: каждый ход — MirEcon.Rules.act (работа, задание с
// номером и временем, усталость, дневной лимит, «касса пуста», еда и бонус), день города — как city_settle_ в city.sql (A7, центробанк k
// по среднему кошельку M, эмиссия min(cap, base + per × A7) × k / 1000, потолок казны capDays × бюджет — лишнее сгорает). Числа —
// MirEcon.SERVER (то же, что city_defs0). Игроки — типы (TYPES) + «эталон» (каждый день 38 заданий одной профессии) + 50 двойников.
// Запуск из корня сайта: node scripts/city-sim.cjs [--days 90] [--players 5,20,100,300] [--seed 37] [--write] [--json]
//   --write — таблицы в docs/CITY_ECONOMY.md между метками <!-- sim:… -->; код 1 — провален порог P1 (список в конце вывода).
// Пороги P1 (план §7 «Tests», то, что уже есть в P1): казна ≥ 0, сохранение денег без дрейфа, дневной лимит зарплаты, k в коридоре,
// верхний 1 % ≤ 30 × медианы (с 30-го дня, от 20 игроков), «Специалист» эталона ≤ 6-го дня и «Мастер» ≤ 50-го, двойники дают своему
// «главному» ≤ 100 💵 сверх того, что получили все. M в 0,6–1,6 T — пока только СООБЩАЕТСЯ: стоков (аренда — P2, рынок — P4) в P1 нет.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/games/mir-econ.js'), 'utf8'), { filename: 'mir-econ.js' });
const M = globalThis.MirEcon, RU = M.Rules;
const D = M.merge(M.SERVER, {}, 0);
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const DAYS = Math.max(1, +arg('days', 90) | 0), NS = String(arg('players', '5,20,100,300')).split(',').map(Number).filter(n => n > 0), SEED = +arg('seed', 37) | 0;
const WRITE = process.argv.includes('--write'), JSON_OUT = process.argv.includes('--json');
const T0 = Date.UTC(2026, 10, 1, 21, 0, 0) / 1000;   // 02.11.2026 00:00 МСК (понедельник)
const CITY_IDS = ['kids', 'metro'];

function mulberry(a){ a >>>= 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ri = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
function shuffle(a, rnd){ for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ── Типы игроков: доля (%), город, шанс зайти в день, заданий за заход, доля заданий в «своей» профессии, еда, часы захода ──
// kid — детский городок; casual — «иногда»; regular — «каждый день» по 30–45 мин; grinder — каждый день до дневного лимита 400 (меняет
// профессию после 40 заданий — дальше половина зарплаты); ref — эталон для порогов прогресса (не входит в N); twin — двойник (2 дня из 7
// по 5–6 заданий, тот же браузер)
const TYPES = {
  kid: { share: 35, city: 'kids', p: .55, tasks: [6, 20], mainShare: .7, food: .5, meals: 1, hours: [9, 20] },
  casual: { share: 30, city: 'any', p: .45, tasks: [4, 14], mainShare: .6, food: .3, meals: 1, hours: [8, 22] },
  regular: { share: 25, city: 'any', p: .85, tasks: [28, 40], mainShare: .85, food: .9, meals: 1, hours: [8, 22] },
  grinder: { share: 10, city: 'metro', p: 1, tasks: [999, 999], mainShare: 0, food: 1, meals: 3, hours: [7, 12] },
  ref: { city: 'metro', p: 1, tasks: [38, 38], mainShare: 1, food: 0, meals: 0, hours: [10, 10] },
  twin: { city: 'metro', p: 2 / 7, tasks: [5, 6], mainShare: 1, food: 0, meals: 0, hours: [12, 20] },
};
const PROFS_OF = Object.fromEntries(CITY_IDS.map(c => [c, Object.keys(D.profs).filter(id => D.profs[id].cities?.[c]?.length && (D.profs[id].ph || 1) <= D.v)]));
const SHOPS = Object.fromEntries(CITY_IDS.map(c => [c, Object.entries(D.cities[c].shops).flatMap(([pl, items]) => items.map(it => ({ pl, it })))]));
const MEAL = { kids: { pl: 'k_bake', it: 'pie' }, metro: { pl: 'm_rest', it: 'pizza' } };

function counts(N){
  const ord = ['kid', 'casual', 'regular', 'grinder'], raw = ord.map(t => N * TYPES[t].share / 100), c = raw.map(Math.floor);
  let left = N - c.reduce((a, b) => a + b, 0);
  const byFrac = ord.map((t, i) => [raw[i] - c[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) c[byFrac[k % ord.length][1]]++;
  if (N >= 5) for (const t of [2, 3]) if (!c[t]) { const big = c.indexOf(Math.max(...c)); c[big]--; c[t]++; }   // хотя бы 1 «каждый день» и 1 «гриндер»
  return Object.fromEntries(ord.map((t, i) => [t, c[i]]));
}

function run(N, opt = {}){
  const act = mulberry(SEED + N);   // номера заданий (как random() сервера); у игрока — свой поток p.rnd: двойники не меняют поведение остальных
  const pr = mulberry(SEED * 31 + N);   // состав игроков — одинаковый с двойниками и без (сравнение «главного»)
  const C = Object.fromEntries(CITY_IDS.map(c => [c, { treasury: D.cities[c].seed, minted: D.cities[c].seed, burned: 0, day: null, site: 0, frozen: false, wage_k: 100, bud: 0 }]));
  const bank = { k: D.bank.k0, day: null, m: 0, actives: 0 };
  const people = [];
  const add = (type, city) => {
    const T = TYPES[type], c = city || (T.city === 'any' ? (pr() < .5 ? 'kids' : 'metro') : T.city);
    const pool = PROFS_OF[c].filter(id => type !== 'ref' || id === 'cook');
    const profs = shuffle(pool.slice(), pr);
    people.push({ id: people.length, rnd: mulberry(SEED * 7919 + N * 104729 + people.length * 40503), type, T, city: c, profs, st: RU.fresh(), seen: -1e12, w: {}, earned: 0, noslot: 0, tries: 0, low: 0, rate: 0, paid: 0, lvlDay: {}, dev: type === 'twin' ? 'tw' : 'd' + people.length });
  };
  const cnt = counts(N);
  for (const [t, n] of Object.entries(cnt)) for (let i = 0; i < n; i++) add(t);
  add('ref');
  const mainId = people.findIndex(p => p.type === 'regular' && p.city === 'metro');
  if (opt.twins) for (let i = 0; i < opt.twins; i++) add('twin', 'metro');
  const log = [], gates = [], viol = new Set();
  const bad = (k, msg) => { if (!viol.has(k)) { viol.add(k); gates.push(msg); } };
  const wageRows = Object.fromEntries(CITY_IDS.map(c => [c, new Map()]));   // город → день → (человек → заданий) — для A7, как журнал 'wage'
  const dayIndex = day => Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse('2026-11-02T00:00:00Z')) / 86400000);
  // ── день города (city_settle_): A7, центробанк (раз в день на оба), снимок, эмиссия, потолок казны ──
  function settle(city, today, now, S){
    const c = C[city]; if (c.day && c.day >= today) return;
    const di = dayIndex(today), n = Math.min(7, c.day ? di - dayIndex(c.day) : 1);
    // A7 — жители с 5+ заданиями хотя бы 2 дня из 7, по браузерам (двойники одного браузера — один), как в city_settle_
    const per = new Map(), devs = new Set();
    for (let d = di - 7; d < di; d++) { const m = wageRows[city].get(d); if (m) for (const [u, k] of m) if (k >= D.bank.a7[0]) per.set(u, (per.get(u) || 0) + 1); }
    for (const [u, v] of per) if (v >= D.bank.a7[1]) devs.add(people[u].dev);
    const a7 = devs.size;
    if (bank.day !== today) {
      let sum = 0, cn = 0;
      for (const p of people) if (p.st.granted && p.seen >= now - D.bank.mDays * 86400) { sum += p.st.cash; cn++; }
      const m = cn ? Math.round(sum / cn) : 0;
      bank.k = RU.kNext(D, bank.k, m); bank.m = m; bank.actives = cn; bank.day = today;
    }
    const bud = RU.budget(D, city, a7), iss = RU.issue(D, city, a7, bank.k) * n;
    c.bud = bud;
    if (iss > 0) { c.treasury += iss; c.minted += iss; }
    const cap = D.cities[city].capDays * bud; let burn = 0;
    if (c.treasury > cap) { burn = c.treasury - cap; c.treasury = cap; c.burned += burn; }
    c.day = today;
    S.a7[city] = a7; S.issue[city] = iss; S.burn[city] = burn;
  }
  // ── ход игрока через правила сервера ──
  function doAct(p, a, g, now, city, S){
    const cs = C[city];
    const r = RU.act(D, p.st, a, g, now, cs, act);
    p.st = r.st; p.seen = now;
    if (r.ok && r.cs && a !== 'eat') { cs.treasury = r.cs.treasury; cs.site = r.cs.site; }
    if (cs.treasury < 0) bad('treasury', `treasury ${city} < 0 (${cs.treasury}) on ${S.day}`);
    if (r.ok) {
      if (r.got?.grant) { cs.minted += r.got.grant; S.grants += r.got.grant; }
      if (a === 'buy') S.food += r.got.cost;
      if (a === 'task') {
        const g2 = r.got; S.tasks++; S.wage += g2.net; S.g100 += g2.g100; S.t100 += g2.t100; p.earned += g2.net;
        const di = dayIndex(S.day), m = wageRows[city].get(di) || new Map(); wageRows[city].set(di, m); m.set(p.id, (m.get(p.id) || 0) + 1);
        if (p.st.wd > D.caps.wageDay * 100) bad('wageDay', `daily wage cap exceeded: ${p.st.wd / 100} (${p.type})`);
        if (g2.tired) S.tired++;
        S.rate += g2.rate; p.rate += g2.rate; p.paid++;
        if (g2.rate < 100) { S.low++; p.low++; }
        const L = RU.lvl(D, p.st.skills[p.st.job.prof] | 0); if (L && !p.lvlDay[L]) p.lvlDay[L] = S.dn;
      }
    } else {
      S.fail[r.reason] = (S.fail[r.reason] || 0) + 1;
      if (r.reason === 'day_cap') S.caphit++;
    }
    return r;
  }
  // ── очередь событий дня (по времени): у каждого игрока — следующий шаг ──
  let heap = [];
  const push = (t, p) => { heap.push([t, p]); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
  function step(p, t, S){
    const P = p.plan;
    if (P.state === 'job') {
      const prof = P.profs[P.pi], place = D.profs[prof].cities[p.city][0];
      const r = doAct(p, 'job', { city: p.city, prof, mode: 'city', place }, t, p.city, S);
      if (!r.ok) { P.end = 'job:' + r.reason; return; }
      P.state = P.meals > 0 && p.rnd() < p.T.food ? 'buy' : 'task';
      push(P.state === 'buy' ? t + ri(p.rnd, 20, 60) : t + RU.minS(D, prof, RU.lvl(D, p.st.skills[prof] | 0)) + ri(p.rnd, 3, 15), p);
      return;
    }
    if (P.state === 'buy') {
      const o = P.meals > 0 && (p.type === 'grinder' || p.type === 'regular') ? MEAL[p.city] : SHOPS[p.city][Math.floor(p.rnd() * SHOPS[p.city].length)];
      const r = doAct(p, 'buy', { city: p.city, place: o.pl, item: o.it, qty: 1 }, t, p.city, S);
      if (r.ok) doAct(p, 'eat', { item: o.it }, t + 2, p.city, S);
      P.meals--; P.state = 'task';
      const J = p.st.job; push(Math.max(t + 5, J.t + RU.minS(D, J.prof, RU.lvl(D, p.st.skills[J.prof] | 0)) + ri(p.rnd, 3, 15)), p);
      return;
    }
    // задание
    const J = p.st.job;
    if (!J) { P.state = 'job'; push(t + 10, p); return; }
    if (P.meals > 0 && p.type === 'grinder' && RU.buffP(D, p.st, t) === 0) { P.state = 'buy'; push(t + 30, p); return; }   // бонус кончился — ещё еды
    p.tries++;
    const r = doAct(p, 'task', { n: J.n }, t, J.city, S);
    if (r.ok) {
      P.done++;
      if (P.done >= P.tasks) { P.end = 'done'; return; }
      // гриндер: после 40 заданий в профессии — другая (дальше половина зарплаты); остальные — иногда меняют
      const nT = p.st.xpd[J.prof] | 0;
      if ((p.type === 'grinder' && nT >= D.caps.full) || (p.T.mainShare < 1 && p.rnd() > p.T.mainShare && P.profs.length > 1 && P.pi === 0)) {
        if (P.pi + 1 < P.profs.length) { P.pi++; P.state = 'job'; push(t + ri(p.rnd, 30, 90), p); return; }
        if (p.type === 'grinder') { P.end = 'profs'; return; }
      }
      push(t + RU.minS(D, J.prof, RU.lvl(D, p.st.skills[J.prof] | 0)) + ri(p.rnd, 3, 15), p);
      return;
    }
    switch (r.reason) {
      case 'too_soon': push(t + (r.wait | 0) + 1, p); return;
      case 'too_fast': push(t + 60, p); return;
      case 'day_cap': if (r.cap === 'prof' && P.pi + 1 < P.profs.length) { P.pi++; P.state = 'job'; push(t + 60, p); } else P.end = 'cap:' + r.cap; return;
      case 'no_slots':   // клиент: «касса пуста» → ушёл с работы; попробует ещё раз через час (не больше 2 раз за день)
        p.noslot++; S.noslot++; doAct(p, 'quit', {}, t + 1, J.city, S);
        if (P.retry++ < 2) { P.state = 'job'; push(t + 3600, p); } else P.end = 'noslot';
        return;
      default: bad('reason:' + r.reason, `unexpected refusal ${r.reason} (${p.type})`); P.end = r.reason;
    }
  }
  // ── дни ──
  for (let dn = 1; dn <= DAYS; dn++) {
    const day0 = T0 + (dn - 1) * 86400, today = RU.day(day0 + 60);
    const S = { dn, day: today, a7: {}, issue: {}, burn: {}, grants: 0, tasks: 0, wage: 0, g100: 0, t100: 0, food: 0, noslot: 0, low: 0, rate: 0, caphit: 0, tired: 0, active: 0, fail: {} };
    for (const c of CITY_IDS) settle(c, today, day0 + 60, S);
    heap = [];
    for (const p of people) {
      if (p.rnd() >= p.T.p) continue;
      const T = p.T, h = T.hours[0] + p.rnd() * (T.hours[1] - T.hours[0]);
      p.plan = { state: 'job', pi: 0, profs: p.type === 'ref' || T.mainShare >= 1 ? [p.profs[0]] : p.profs, tasks: ri(p.rnd, T.tasks[0], T.tasks[1]), done: 0, meals: T.meals, retry: 0 };
      S.active++;
      push(day0 + Math.floor(h * 3600), p);
    }
    while (heap.length) { const [t, p] = pop(); step(p, t, S); }
    // сохранение: Σ кошельков + Σ казны = выпущено − уничтожено
    let cash = 0; for (const p of people) cash += p.st.cash;
    const tre = C.kids.treasury + C.metro.treasury, net = C.kids.minted + C.metro.minted - C.kids.burned - C.metro.burned;
    if (cash + tre !== net) bad('conservation', `money drift on day ${dn}: ${cash + tre - net}`);
    if (bank.k < D.bank.kMin || bank.k > D.bank.kMax) bad('k', `k out of corridor: ${bank.k}`);
    const w = people.filter(p => p.st.granted && p.type !== 'twin').map(p => p.st.cash).sort((a, b) => a - b);
    const q = f => (w.length ? w[Math.min(w.length - 1, Math.max(0, Math.ceil(f * w.length) - 1))] : 0);
    const med = q(.5), top = q(.99);
    S.k = bank.k; S.M = bank.m; S.actives = bank.actives; S.treas = { kids: C.kids.treasury, metro: C.metro.treasury };
    S.med = med; S.top = top; S.ratio = med ? +(top / med).toFixed(1) : null; S.cash = cash;
    if (dn >= 30 && N >= 20 && med && top > 30 * med) bad('top', `top 1 % = ${top} > 30 × median ${med} (day ${dn})`);
    log.push(S);
  }
  const ref = people.find(p => p.type === 'ref');
  if (!(ref.lvlDay[2] <= 6)) bad('ref2', `reference player: Specialist on day ${ref.lvlDay[2] || '—'} (need ≤ 6)`);
  if (DAYS >= 50 && !(ref.lvlDay[4] <= 50)) bad('ref4', `reference player: Master on day ${ref.lvlDay[4] || '—'} (need ≤ 50)`);
  const byType = {};
  for (const p of people) { const b = byType[p.type] || (byType[p.type] = { n: 0, cash: 0, earned: 0, noslot: 0, tries: 0, low: 0, rate: 0, paid: 0 }); b.n++; b.cash += p.st.cash; b.earned += p.earned; b.noslot += p.noslot; b.tries += p.tries; b.low += p.low; b.rate += p.rate; b.paid += p.paid; }
  return { N, twins: opt.twins || 0, counts: cnt, log, gates, ref: { lvlDay: ref.lvlDay, cash: ref.st.cash, noslot: ref.noslot }, byType, main: mainId >= 0 ? people[mainId].st.cash : null, people };
}

// ── прогоны ──
const fmt = n => (n == null ? '—' : typeof n === 'number' ? (Math.abs(n) >= 10000 ? n.toLocaleString('ru-RU').replace(/ /g, ' ') : String(n)) : String(n));
const pick = DAYS >= 90 ? [1, 3, 7, 14, 30, 45, 60, 90] : [...new Set([1, 3, 7, 14, 30, DAYS].filter(d => d <= DAYS))];
const results = [];
const t0 = Date.now();
for (const N of NS) results.push(run(N));
const tw = NS.includes(100) ? 100 : NS[Math.floor(NS.length / 2)];
const base = results.find(r => r.N === tw), withTw = run(tw, { twins: 50 });
// двойники: что получил «главный» сверх того, что получили все (общая казна полнее у всех)
let twin = null;
if (base.main != null && withTw.main != null) {
  // сравниваем с такими же: «каждый день» в Большом городе (у них та же казна и тот же ритм)
  const others = (r) => { const mi = r.people.findIndex(q => q.type === 'regular' && q.city === 'metro'); const L = r.people.filter(p => p.type === 'regular' && p.city === 'metro' && p.id !== mi); return L.reduce((a, p) => a + p.st.cash, 0) / Math.max(1, L.length); };
  const gainMain = withTw.main - base.main, gainAll = others(withTw) - others(base);
  twin = { gainMain, gainAll: Math.round(gainAll), targeted: Math.round(gainMain - gainAll), transfers: 0, twinsCash: withTw.byType.twin ? withTw.byType.twin.cash : 0 };
  if (twin.targeted > 100) withTw.gates.push(`twins gave their main ${twin.targeted} more than his peers got (gate 100)`);
}
const ms = Date.now() - t0;

// ── таблицы (английские — документы для агентов; подписи для владельца — в окне «🏙️ Экономика города») ──
const TN = { kid: 'kids', casual: 'casual', regular: 'daily', grinder: 'grinders', ref: 'reference', twin: 'twins' };
function table(r){
  const L = [];
  L.push(`**${r.N} players** (kids ${r.counts.kid}, casual ${r.counts.casual}, daily ${r.counts.regular}, grinders ${r.counts.grinder}; + the reference player)${r.twins ? ` + ${r.twins} twins` : ''}`);
  L.push('');
  L.push('| day | played | A7 kids / metro | k ‰ | M (avg wallet) | M / T | treasury kids / metro | issued kids / metro | wages | food | burned | city rate (avg) | «касса пуста» | median / top 1 % |');
  L.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const d of pick) {
    const s = r.log[d - 1]; if (!s) continue;
    L.push(`| ${d} | ${s.active} | ${s.a7.kids} / ${s.a7.metro} | ${s.k} | ${fmt(s.M)} | ${(s.M / D.bank.T).toFixed(2)} | ${fmt(s.treas.kids)} / ${fmt(s.treas.metro)} | ${fmt(s.issue.kids)} / ${fmt(s.issue.metro)} | ${fmt(s.wage)} | ${fmt(s.food)} | ${fmt(s.burn.kids + s.burn.metro)} | ${s.tasks ? Math.round(s.rate / s.tasks) : 100} % | ${s.noslot} | ${fmt(s.med)} / ${fmt(s.top)} (×${s.ratio ?? '—'}) |`);
  }
  L.push('');
  const tl = Object.entries(r.byType).map(([t, b]) => `${TN[t] || t}: wallet ${fmt(Math.round(b.cash / b.n))}, earned ${fmt(Math.round(b.earned / b.n))} (${fmt(Math.round(b.earned / b.n / DAYS))}/day), city rate ${b.paid ? Math.round(b.rate / b.paid) : 100} %, «касса пуста» ${b.tries ? (b.noslot * 100 / b.tries).toFixed(1) : 0} % of tries`);
  L.push(`Per player over ${DAYS} days: ` + tl.join('; ') + '.');
  L.push(`Reference player (38 cook tasks every day, big city): Worker on day ${r.ref.lvlDay[1] || '—'}, Specialist ${r.ref.lvlDay[2] || '—'}, Expert ${r.ref.lvlDay[3] || '—'}, Master ${r.ref.lvlDay[4] || '—'}; «касса пуста» ${r.ref.noslot} times.`);
  return L.join('\n');
}
const gatesAll = [...results.flatMap(r => r.gates.map(g => `${r.N}: ${g}`)), ...withTw.gates.map(g => `${tw} + twins: ${g}`)];
const warn = [];
for (const r of results) { const late = r.log.slice(29); if (late.length && late.some(s => s.M < .6 * D.bank.T || s.M > 1.6 * D.bank.T)) { const mx = Math.max(...late.map(s => s.M)); warn.push(`${r.N}: after day 30 M reaches ${fmt(mx)} (${(mx / D.bank.T).toFixed(2)} T)`); } }
const summary = [
  `Simulation: ${DAYS} days, seed ${SEED} (node scripts/city-sim.cjs${NS.join(',') !== '5,20,100,300' ? ' --players ' + NS.join(',') : ''}${DAYS !== 90 ? ' --days ' + DAYS : ''}). Numbers: MirEcon.SERVER (= city_defs0).`,
  `P1 gates: ${gatesAll.length ? '❌ ' + gatesAll.join('; ') : '✅ all pass (treasury ≥ 0, zero money drift, 400/day wage cap, k inside its corridor, top 1 % ≤ 30 × median, the reference player reaches Specialist by day 6 and Master by day 50, twins)'}.`,
  twin ? `Twins (${tw} players + 50 twins on one browser, 2 days of 7 with 5–6 tasks): P1 has no player-to-player transfers (0); the main account (daily player, big city) got ${fmt(twin.gainMain)} more than in the run without twins, his peers ${fmt(twin.gainAll)} on average → ${fmt(twin.targeted)} above peers (gate 100). A7 counts browsers, so 50 twins on one browser are one resident. The twins themselves hold ${fmt(twin.twinsCash)} that P1 gives no way to pass on.` : '',
  warn.length ? `⚠ Report only (not a P1 gate): ${warn.join('; ')}. P1 has no sinks except food, so M keeps growing and the central bank sits at kMin; the 0.6–1.6 T corridor needs the P2/P4 sinks (rent, market fee).` : 'M stays within 0.6–1.6 T after day 30.',
].filter(Boolean).join('\n\n');
const out = { summary, tables: results.map(table), twins: table(withTw) };
if (JSON_OUT) console.log(JSON.stringify({ days: DAYS, seed: SEED, results: results.map(r => ({ N: r.N, counts: r.counts, gates: r.gates, ref: r.ref, byType: r.byType, log: r.log })), twins: twin, gates: gatesAll, warn }, null, 1));
else { console.log(summary + '\n'); for (const t of out.tables) console.log(t + '\n'); console.log(out.twins + '\n'); console.log(`(${ms} ms)`); }
if (WRITE) {
  const f = path.join(ROOT, 'docs/CITY_ECONOMY.md');
  let s = fs.readFileSync(f, 'utf8');
  const put = (key, body) => {
    const re = new RegExp(`<!-- sim:${key} -->[\\s\\S]*?<!-- /sim:${key} -->`);
    if (!re.test(s)) { console.log(`no <!-- sim:${key} --> markers in docs/CITY_ECONOMY.md`); process.exitCode = 1; return; }
    s = s.replace(re, () => `<!-- sim:${key} -->\n${body}\n<!-- /sim:${key} -->`);
  };
  put('summary', out.summary);
  put('tables', out.tables.join('\n\n'));
  put('twins', out.twins);
  fs.writeFileSync(f, s);
  console.log('docs/CITY_ECONOMY.md: tables updated');
}
if (gatesAll.length) { console.log('P1 GATES FAILED:\n  ' + gatesAll.join('\n  ')); process.exit(1); }

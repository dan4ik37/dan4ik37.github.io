// «Путь клетки» (T-056): сколько играть до стадии «Готов к суше» (C4) — настоящий мир «Клеточек» (js/games/kletochki.js, пути — D37Evo.worldCfg)
// и те же правила рода, что у сервера (D37Evo.Rules — evo_act). Игрок — «мозг» бота (как живой средний игрок: ест, убегает, гонится),
// плюс то, что сделал бы человек на пути: покупает части по порядку, ставит их на мембрану, делится в колонию, ходит в нужные биомы.
// Профили: сколько минут в день играет (15 / 30 / 60), вечером (с 18:00 МСК). Жизнь: съели — 6 с на карточку, конец раунда — 8 с итогов.
// Ворота плана (docs/plans/universe-path.md §6.4): у среднего (30 мин/день) медиана до C4 — 45…75 минут игры.
// Запуск из корня сайта: node scripts/evo-sim.cjs [--fast] [--rates] [--seeds N]
//   --rates — только замер: ДНК в минуту по биомам (сахар, белок, минералы, цель), длина жизни, колония
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const FAST = argv.includes('--fast'), RATES = argv.includes('--rates');
const SEEDS = +(argv[argv.indexOf('--seeds') + 1]) || (FAST ? 3 : 9);
function load(){
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Math, Date, JSON, performance, ArrayBuffer, DataView, Uint8Array });
  ctx.window = ctx; ctx.GAME_IMPL = {};
  for (const f of ['js/games/iokit.js', 'js/games/evo.js', 'js/games/kletochki.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = load();
const E = ctx.D37Evo, T = ctx.GAME_IMPL.kletochki._test, SIM = T.SIM, RU = E.Rules, D = E.merge(E.SERVER, {}, 0);
const SPS = 30, MIN = 60 * SPS;
let seedR = 1;
const R = () => { seedR = (seedR * 48271) % 2147483647; return seedR / 2147483647; };

// Порядок покупок и места на мембране (что сделал бы игрок): жгутик и глазок, липкость (колония), рот, ещё липкость, фотофор…
const BUY = ['flagellum', 'eye', 'adhesion', 'jaw', 'adhesion', 'photo', 'cilia', 'leaf', 'flagellum', 'adhesion', 'spikes', 'armour', 'toxin', 'pigment', 'eye'];
const SLOT_ORDER = ['jaw', 'eye', 'adhesion', 'flagellum', 'adhesion', 'photo', 'adhesion', 'cilia', 'spikes', 'leaf', 'eye', 'flagellum', 'toxin', 'armour'];
function designFor(st){
  const d = E.emptyDesign(), left = { ...st.owned };
  d.f = (st.owned.adhesion | 0) > 0 ? 'wedge' : 'chain';
  for (const id of SLOT_ORDER) {
    if (!(left[id] > 0) || !E.CELL[id].slots) continue;
    const need = E.CELL[id].slots;
    let k = -1;
    for (let i = 0; i < 6 && k < 0; i++) { let free = true; for (let j = 0; j < need; j++) if (d.s[(i + j) % 6]) free = false; if (free) k = i; }
    if (k < 0) continue;
    d.s[k] = id; for (let j = 1; j < need; j++) d.s[(k + j) % 6] = '=';
    left[id]--;
  }
  return E.designWhy(d, st.owned) === '' ? d : E.emptyDesign();
}

// Одна жизнь в мире пути: игрок — мозг бота; вернёт отчёт жизни (как kletochki-path.js) и сколько шагов прошло
function makeWorld(b, seed, t0){
  const cfg = E.worldCfg(b, t0);
  const PS = SIM.forEvo(cfg);
  const W = PS.newWorld(seed);
  return { PS, W, cfg };
}
function playLife(G, design, maxSteps, opts){
  const { PS, W } = G;
  let me = G.me;
  if (me == null || !W.owners[me]) {
    me = G.me = PS.addOwner(W, { key: 'me', name: 'Игрок', bot: false, spawn: true, design: E.designCode(design) });
    PS.setHumans(W, 1);
  } else { PS.setOwner(W, me, { design: E.designCode(design) }); PS.respawn(W, me); }
  const o = () => W.owners[me];
  // мозг: как у бота (средний характер), плюс колония — делится, пока колония не собрана
  const brain = { aggr: opts.aggr, caut: opts.caut, every: 3, wx: 1, wy: 0, wt: 0, splitCd: 0 };
  let steps = 0, alive = false, t0 = 0, best = 0, ko = null, ended = null, splitAt = 0;
  for (; steps < maxSteps; steps++) {
    const ow = o();
    if (ow.alive) {
      if (!alive) { alive = true; t0 = W.step; }
      if ((W.step + me) % 3 === 0) { ow.brain = brain; T.think(W, ow); ow.brain = null; }
      // колония: делиться, пока не собрана (масса позволяет), не чаще раза в 2 с
      if (ow.st.colony > ow.colN && ow.mass >= 50 && W.step - splitAt > 60) { ow.inS++; splitAt = W.step; }
      ow.gotIn = true;
      if (ow.mass > best) best = ow.mass;
    }
    PS.step(W);
    for (const e of W.ev.splice(0)) {
      if (e.k === 'ko' && e.o === me) ko = e;
      else if (e.k === 'end') ended = e;
    }
    if (ko || (ended && alive)) break;
    if (!alive && steps > 10 * SPS) break;   // не появился (конец раунда) — следующая попытка
  }
  const sec = alive ? (W.step - t0) / SPS : 0;
  let d = null;
  if (ko) d = ko.evo;
  else if (ended && ended.evo && ended.evo[me]) d = ended.evo[me];
  else { const ow = o(); d = { s: Math.floor(ow.dS), p: Math.floor(ow.dP), m: ow.dM, pel: ow.pel, col: ow.colMax, seen: ow.seen, kills: ow.eaten }; }
  // после конца раунда — 8 с итогов (мир сам начнёт новый)
  if (ended) for (let k = 0; k < 9 * SPS; k++) { PS.step(W); W.ev.length = 0; steps++; }
  return { d, sec, best, steps, ko: !!ko, alive };
}
function goalOf(b, st){
  const own = E.placed(st.design), list = E.GOALS.filter(g => (!g.b || g.b === b) && (g.need !== 'adh' || own.includes('adhesion')));
  return list[Math.floor(R() * list.length)];
}
const goalDone = (g, d, sec, best) => g.k === 'pel' ? d.pel >= g.v : g.k === 'life' ? sec >= g.v : g.k === 'mass' ? best >= g.v : g.k === 'kills' ? d.kills >= g.v : g.k === 'col' ? d.col >= g.v : g.k === 'min' ? d.m >= g.v : false;

// ═══ Замер: ДНК в минуту по биомам ═══
function rates(){
  const out = {};
  for (const b of ['pool', 'reef', 'deep']) {
    for (const [label, owned] of [['база', {}], ['жгутик+глаз', { flagellum: 1, eye: 1 }], ['колония 5 + рот', { flagellum: 1, eye: 1, adhesion: 2, jaw: 1, photo: 1 }]]) {
      const st = { ...RU.fresh('x'), owned };
      const des = designFor(st);
      let s = 0, p = 0, m = 0, g = 0, secs = 0, lives = 0, kos = 0, colMax = 0, pel = 0;
      for (let seed = 1; seed <= (FAST ? 2 : 4); seed++) {
        seedR = seed * 7919;
        const G = makeWorld(b, seed * 101, Date.UTC(2026, 9, 22, 15, 0, 0));
        let total = 0;
        while (total < 10 * MIN) {
          const goal = goalOf(b, { design: des });
          const L = playLife(G, des, 10 * MIN - total, { aggr: .5, caut: 1 });
          total += L.steps;
          if (!L.alive) continue;
          lives++; if (L.ko) kos++;
          s += L.d.s; p += L.d.p; m += L.d.m; pel += L.d.pel; secs += L.sec; colMax = Math.max(colMax, L.d.col);
          if (goalDone(goal, L.d, L.sec, L.best)) g++;
          if (L.ko) for (let k = 0; k < 6 * SPS; k++) { G.PS.step(G.W); G.W.ev.length = 0; total++; }   // карточка «съели»
        }
      }
      const mins = secs / 60, raw = s + p + 2 * m + 8 * g;
      out[`${b} · ${label}`] = { 'ДНК/мин': +(raw / mins).toFixed(1), 'сахар': +(s / mins).toFixed(1), 'белок': +(p / mins).toFixed(1), 'минер.': +(2 * m / mins).toFixed(1), 'цель': +(8 * g / mins).toFixed(1),
        'точек/мин': +(pel / mins).toFixed(0), 'жизнь, с': +(secs / Math.max(1, lives)).toFixed(0), 'съели': `${kos}/${lives}`, 'колония': colMax };
    }
  }
  console.table(out);
  return out;
}

// ═══ Путь до C4: профиль игрока (минут в день), характер ═══
function path_(seed, minDay){
  seedR = seed * 104729;
  const prof = { aggr: .25 + R() * .6, caut: .7 + R() * .6 };
  let st = RU.fresh('sim' + seed);
  let day = 0, clockS = Date.UTC(2026, 9, 1, 15, 0, 0) / 1000;   // 18:00 МСК
  let play = 0;   // минут игры (по часам игры, вместе с карточками)
  const at = {}, lifeLog = [];
  let worlds = {};
  const act = (a, g, now) => { const r = RU.act(D, st, a, g, now, () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')); st = r.st; return r; };
  while (st.stage < 4 && play < 400) {
    // день: minDay минут игры
    const dayStart = clockS;
    let dayPlayed = 0;
    while (dayPlayed < minDay * 60 && st.stage < 4) {
      // покупки и облик между жизнями
      for (const id of BUY) { const P = E.CELL[id]; if ((st.owned[id] | 0) < P.max && st.stage >= P.at && st.dna >= P.cost) { const r = act('buy', { part: id }, clockS); if (r.ok && r.got.up && !at[r.got.up]) at[r.got.up] = { min: +(play.toFixed(1)), day }; break; } }
      const des = designFor(st);
      if (JSON.stringify(des) !== JSON.stringify(st.design)) act('design', { d: des }, clockS);
      // куда плыть: нужен биом для вехи — туда; иначе — самый «вкусный» из открытых
      const open = E.BIOME_IDS.filter(b => st.stage >= E.BIOMES[b].at);
      const need = st.stage >= 3 ? ['reef', 'deep'].find(b => !st.biomes.includes(b)) : st.stage === 2 && !st.biomes.includes('reef') ? 'reef' : null;
      const b = need || (open.includes('reef') && R() < .6 ? 'reef' : open.includes('deep') && R() < .5 ? 'deep' : 'pool');
      if (!worlds[b]) worlds[b] = makeWorld(b, seed * 31 + E.BIOME_IDS.indexOf(b), clockS * 1000);
      const G = worlds[b];
      const tk = act('start', { b }, clockS);
      const goal = goalOf(b, st);
      const L = playLife(G, st.design, 8 * MIN, prof);
      const dt = L.steps / SPS + (L.ko ? 6 : 0);
      clockS += dt; play += dt / 60; dayPlayed += dt;
      if (L.ko) for (let k = 0; k < 6 * SPS; k++) { G.PS.step(G.W); G.W.ev.length = 0; }
      if (!tk.ok || !L.alive) continue;
      const g = goalDone(goal, L.d, L.sec, L.best) ? 1 : 0;
      const seen = E.MICRO_IDS.filter((id, i) => (L.d.seen >> i) & 1);
      const r = act('life', { n: tk.got.n, s: L.d.s, p: L.d.p, m: L.d.m, g, col: L.d.col, kills: L.d.kills, mass: Math.round(L.best), life: Math.round(L.sec), pel: L.d.pel, seen }, clockS);
      lifeLog.push({ b, sec: L.sec, raw: r.got?.raw || 0, gain: r.got?.gain || 0, cut: r.got?.cut || 0 });
      if (r.ok && r.got.up && !at[r.got.up]) at[r.got.up] = { min: +(play.toFixed(1)), day };
    }
    // следующий день: снова в 18:00 МСК
    day++;
    clockS = dayStart + 86400;
    if (day > 30) break;
  }
  const cut = lifeLog.reduce((x, l) => x + l.cut, 0), raw = lifeLog.reduce((x, l) => x + l.raw, 0);
  return { seed, minDay, c2: at[2], c3: at[3], c4: at[4], play: +play.toFixed(1), day, dna: st.earned, lives: lifeLog.length, cutPct: raw ? +(cut / (raw + cut) * 100).toFixed(1) : 0,
    avgLife: +(lifeLog.reduce((x, l) => x + l.sec, 0) / Math.max(1, lifeLog.length)).toFixed(0), prof };
}

const t0 = Date.now();
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
if (RATES) { rates(); console.log(`за ${((Date.now() - t0) / 1000).toFixed(0)} с`); process.exit(0); }
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };
const report = {};
for (const minDay of FAST ? [30] : [15, 30, 60]) {
  const runs = [];
  for (let s = 1; s <= SEEDS; s++) runs.push(path_(s, minDay));
  const c4 = runs.filter(r => r.c4).map(r => r.c4.min), c4d = runs.filter(r => r.c4).map(r => r.c4.day + 1), c3 = runs.filter(r => r.c3).map(r => r.c3.min), c2 = runs.filter(r => r.c2).map(r => r.c2.min);
  report[minDay] = { 'дошли до C4': `${c4.length}/${runs.length}`, 'C2, мин': med(c2), 'C3, мин': med(c3), 'C4, мин (медиана)': med(c4), 'C4, мин (мин…макс)': c4.length ? `${Math.min(...c4)}…${Math.max(...c4)}` : '-',
    'C4, день': med(c4d), 'жизнь, с': med(runs.map(r => r.avgLife)), 'срезано лимитом, %': med(runs.map(r => r.cutPct)) };
  if (minDay === 30) report.runs30 = runs.map(r => ({ seed: r.seed, c2: r.c2?.min, c3: r.c3?.min, c4: r.c4?.min, day: r.c4 ? r.c4.day + 1 : '-', lives: r.lives, avgLife: r.avgLife, cut: r.cutPct }));
}
console.table(Object.fromEntries(Object.entries(report).filter(([k]) => k !== 'runs30').map(([k, v]) => [k + ' мин/день', v])));
if (report.runs30) console.table(report.runs30);
const m30 = report[30] ? +report[30]['C4, мин (медиана)'] : NaN;
ok(report[30] && report[30]['дошли до C4'].split('/')[0] === report[30]['дошли до C4'].split('/')[1], 'все «средние» игроки дошли до C4', report[30]);
ok(m30 >= 45 && m30 <= 75, `медиана до C4 у среднего (30 мин/день) — ${m30} мин (ворота 45…75)`, m30);
console.log(`за ${((Date.now() - t0) / 1000).toFixed(0)} с · ${pass} ок, ${fail} ошибок`);
process.exit(fail ? 1 : 0);

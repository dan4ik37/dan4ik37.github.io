// «Путь клетки» (T-056) в node, без браузера: каталог D37Evo (js/games/evo.js) и правила рода (как evo_act), свет у родины, мир пути
// в «Клеточках» (js/games/kletochki.js: колония, роли формы, облачко, минералы, гиганты, фотосинтез, «видел», ДНК жизни — события ko/end),
// одинаково при 30/60/144 кадрах, снимки гостю (флаг 8), список участников с обликом, облик — со следующей жизни, память за 20 раундов,
// комнаты пути на подменной сети: свои общие арены по биому (не смешиваются с обычной ареной и между собой), облик гостя — у хозяина,
// ДНК жизни — у гостя, смена хозяина не рвёт колонию.
// Запуск из корня сайта: node --expose-gc scripts/evo-test.cjs [--fast]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
function load(files){
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, performance, ArrayBuffer, DataView, Uint8Array, TextEncoder, TextDecoder, btoa, atob });
  ctx.window = ctx; ctx.GAME_IMPL = {};
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = load(['js/games/iokit.js', 'js/games/evo.js', 'js/games/kletochki.js', 'js/games/kletochki-path.js']);
const E = ctx.D37Evo, K = ctx.IoKit, T = ctx.GAME_IMPL.kletochki._test, SIM = T.SIM, RU = E.Rules;
const D = E.merge(E.SERVER, {}, 0);
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);   // 12:00 МСК — день у родины

// ═══ 1. Каталог ═══
{
  const letters = E.PART_IDS.map(id => E.CELL[id].L).filter(Boolean);
  ok(new Set(letters).size === letters.length && !letters.includes('.') && !letters.includes('='), 'буквы частей разные (код облика)');
  ok(E.PART_IDS.every(id => { const P = E.CELL[id]; return P.n && P.e && P.cost > 0 && P.slots >= 0 && P.slots <= 2 && [1, 2, 3].includes(P.at) && P.max >= 1 && P.sim && typeof P.d === 'string'; }), 'у каждой части: имя, значок, цена, места, стадия, предел, свойства');
  ok(E.MICRO_IDS.length <= 16 && E.MICRO_IDS.every(id => E.MICRO[id].b === 'any' || E.BIOMES[E.MICRO[id].b]), '«Микромир»: до 16 видов (маска u16), у каждого — биом');
  ok(E.BIOME_IDS.every(b => E.BIOMES[b].bots.every(k => E.MICRO[k] && !E.MICRO[k].giant)), 'боты биомов — виды «Микромира»');
  ok(E.FORM_IDS.every(f => E.FORMS[f].pos.length === 6 && E.ROLES[E.FORMS[f].role]), 'формы колонии: 6 мест и роль');
  ok(E.TASKS.every(t => ['pel', 'life', 'mass', 'kills', 'col', 'min'].includes(t.k) && t.v > 0) && E.GOALS.every(g => ['pel', 'life', 'mass', 'kills', 'col', 'min'].includes(g.k)), 'задания дня и цели жизни — известные счётчики');
  ok(E.NAME_A.length === 24 && E.NAME_B.length === 24 && new Set(E.NAME_A).size === 24 && new Set(E.NAME_B).size === 24, 'имена рода: 24 × 24 готовых слова');
  ok(deepEq(E.SERVER.parts, E.PART_IDS) && deepEq(E.SERVER.biomeIds, E.BIOME_IDS) && deepEq(E.SERVER.micro.map(x => x[0]), E.MICRO_IDS), 'каталог сервера — тот же порядок');
  ok(E.SERVER.caps.day === 300 && E.SERVER.caps.rest === 60 && E.SERVER.miles[4].min >= 45, 'лимит дня 300, «отдохнувший» 60 (план §1.2)');
  // код облика туда-обратно
  let rt = true;
  for (let i = 0; i < 300; i++) {
    const s = ['', '', '', '', '', ''], own = {};
    for (let k = 0; k < 6; k++) if (Math.random() < .6) { const id = E.PART_IDS[Math.floor(Math.random() * E.PART_IDS.length)]; if (E.CELL[id].slots === 1 && (own[id] | 0) < E.CELL[id].max) { s[k] = id; own[id] = (own[id] | 0) + 1; } }
    if (Math.random() < .3) { const k = Math.floor(Math.random() * 6); s[k] = 'armour'; s[(k + 1) % 6] = '='; own.armour = 1; }
    const d = { s, f: E.FORM_IDS[i % 3], k: { p: 1, a: '#000000', b: '#ffffff' } };
    if (E.designWhy(d, own) !== '') continue;
    const back = E.parseCode(E.designCode(d));
    if (!back || !deepEq(back.s, d.s) || back.f !== d.f) { rt = false; break; }
  }
  ok(rt, 'код облика (6 мест + форма) — туда и обратно');
  ok(E.parseCode('ffffff' + 'c') === null && E.parseCode('a.....c') === null && E.parseCode('=a....c') === null && E.parseCode('......x') === null && E.parseCode(5) === null, 'плохой код облика — отказ (сверх предела, «=» без части, чужая форма)');
  ok(E.parseCode('=....ac')?.s[5] === 'armour' && E.parseCode('a....=c') === null && E.parseCode('a=....c')?.s[0] === 'armour', 'панцирь на 2 места — и через «край» кольца (место 6 → 1)', E.parseCode('=....ac'));
  ok(E.capacity({ s: ['adhesion', 'adhesion', 'adhesion', '', '', ''] }) === 7 && E.capacity(E.emptyDesign()) === 1, 'колония: 1 + 2 за липкость, до 7');
}

// ═══ 2. Правила рода ═══
{
  const now = 1792800000;
  let st = RU.fresh('u');
  ok(deepEq(RU.sanitize(JSON.parse(JSON.stringify(st)), 'u'), st), 'sanitize(fresh) = fresh');
  const junk = RU.sanitize({ stage: 99, dna: -5, owned: { jaw: 9, eye: 'x', armour: 1 }, design: { s: ['jaw'], f: 'chain' }, finds: ['nope', 'drop'], biomes: ['deep', 'mars'], name: { a: 999, b: 1 }, tk: '<b>' }, 'u');
  ok(junk.stage === 5 && junk.dna === 0 && deepEq(junk.owned, { armour: 1 }) && deepEq(junk.finds, ['drop']) && deepEq(junk.biomes, ['deep']) && junk.name.a === 0 && junk.tk === null && deepEq(junk.design, E.emptyDesign()), 'sanitize: мусор — к допустимому', junk);
  let r = RU.act(D, st, 'start', { b: 'reef' }, now); ok(!r.ok && r.reason === 'locked', 'Риф закрыт на стадии 1');
  r = RU.act(D, st, 'start', { b: '__proto__' }, now); ok(!r.ok && r.reason === 'args', 'биом «__proto__» — отказ');
  r = RU.act(D, st, 'start', { b: 'pool' }, now, () => 'abcd1234'); st = r.st;
  ok(r.ok && st.tk === 'abcd1234' && st.tb === 'pool' && st.tt === now, 'билет жизни');
  r = RU.act(D, st, 'life', { n: 'abcd1234', s: 20, p: 3, life: 120, pel: 61, mass: 90, seen: ['drop', 'giant'] }, now + 120); st = r.st;
  ok(r.ok && r.got.raw === 23 && r.got.bonus === 23 && r.got.gain === 46 && st.play === 120 && deepEq(st.finds, ['drop']), 'жизнь: ДНК, ×2, минуты, «Микромир» по биому', r.got);
  // день по Москве: 23:59 → 00:01 МСК — новый день
  const mskMid = Date.UTC(2026, 9, 23, 21, 0, 0) / 1000;   // 24.10 00:00 МСК
  ok(RU.dayOf(mskMid - 60) === '2026-10-23' && RU.dayOf(mskMid + 60) === '2026-10-24', 'день — по Москве (UTC+3)');
  ok(RU.dayNo(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000) === 0 && RU.taskOf(Date.UTC(2026, 0, 1, 0, 0, 0) / 1000) === 0, 'задание дня №0 — 01.01.2026 (МСК)');
  // стадии не опускаются
  const hi = { ...RU.fresh('x'), stage: 3, earned: 0 };
  ok(RU.stageOf(D, hi) === 3, 'стадия не опускается');
  // облик: панцирь через край кольца
  let s2 = { ...RU.fresh('y'), stage: 3, dna: 500 };
  for (const p of ['armour', 'adhesion']) s2 = RU.act(D, s2, 'buy', { part: p }, now).st;
  r = RU.act(D, s2, 'design', { d: { s: ['=', 'adhesion', '', '', '', 'armour'], f: 'ring', k: { p: 2, a: '#ABCDEF', b: '#000000' } } }, now);
  ok(r.ok && r.st.design.k.a === '#abcdef', 'облик: панцирь на местах 6 и 1, цвет — строчными');
  ok(E.landTemplate({ ...RU.fresh('z'), land: { plan: 'shell', diet: 'plant', design: r.st.design, owned: r.st.owned, at: 1 } }).body.shell === 1, 'шаблон существа «Панцирник»: панцирь');
  // настройки админа: белый список
  ok(E.cfgOk(E.SERVER, 'caps.day', 500) && !E.cfgOk(E.SERVER, 'caps.life', 9) && !E.cfgOk(E.SERVER, 'caps.day', 1e9) && E.cfgOk(E.SERVER, 'cell.jaw.cost', 10), 'настройки — только из белого списка и в пределах');
  ok(E.merge(E.SERVER, { 'caps.day': 400, 'caps.life': 1 }, 3).caps.day === 400 && E.merge(E.SERVER, { 'caps.life': 1 }, 3).caps.life === 330, 'merge: допустимое меняется, остальное — нет');
}

// ═══ 3. Свет у родины ═══
{
  const gfx = fs.readFileSync(path.join(SITE, 'js/engine/gfx.js'), 'utf8');
  const m = /E\.dayClock = (\(ms, cycle = 32, night = \.25\) => \{[\s\S]*?\n  \});/.exec(gfx);
  let same = !!m;
  if (m) {
    const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
    const dayClock = new Function('cl', 'return ' + m[1])(cl);
    for (let i = 0; i < 2000 && same; i++) { const ms = 1.7e12 + i * 77777; if (Math.abs(dayClock(ms, 40, .2) - E.light.mirHour(ms)) > 1e-9) same = false; }
  }
  ok(same, 'местный час = часы «Мира Денчика» (E.dayClock(мс, 40, .2) в gfx.js)');
  const C = load(['js/engine/climate.js']).D37E?.climate;
  let seas = !!C?.phaseCal;
  if (C?.phaseCal) {
    const L2 = load(['js/games/evo.js']).D37Evo.light;   // без climate.js — своя формула
    for (let i = 0; i < 400 && seas; i++) { const ms = Date.UTC(2026, 0, 1) + i * 86400000 * .91; if (Math.abs(L2.seasonPhase(ms) - C.phaseCal(ms)) > 1e-6) seas = false; }
  }
  ok(seas, 'время года без climate.js — та же формула, что C.phaseCal (календарь владельца)');
  ok(E.light.daylight(1) === 0 && E.light.daylight(12) === 1 && E.light.daylight(6) > 0 && E.light.daylight(6) < 1, 'день и ночь, заря и сумерки');
  let mn = 1, mx = 0;
  for (let i = 0; i < 300; i++) { const v = E.light.lightAt('deep', T0 + i * 60000); mn = Math.min(mn, v); mx = Math.max(mx, v); }
  let pmn = 1, pmx = 0;
  for (let i = 0; i < 300; i++) { const v = E.light.lightAt('pool', T0 + i * 60000); pmn = Math.min(pmn, v); pmx = Math.max(pmx, v); }
  ok(mx < .25 && pmx > .9 && pmn < .6, 'Глубина тёмная всегда, Лужа — светлая днём и темнее ночью', { mn, mx, pmn, pmx });
}

// ═══ 4. Мир пути ═══
const world = (b, seed, t0 = T0) => { const PS = SIM.forEvo(E.worldCfg(b, t0)); return { PS, W: PS.newWorld(seed) }; };
const inp = (x, y, s = 0, e = 0) => Float64Array.from([x, y, s, e, 0, 0]);
function bareP(b, seed){
  const { PS, W } = world(b, seed);
  W.botWant = 0;
  for (let k = 0; k < W.vN; k++) W.vDead[W.vL[k]] = 1;
  T.compact(W);
  return { PS, W };
}
const des = (s, f = 'chain') => E.designCode({ s, f, k: { p: 1, a: '#000000', b: '#ffffff' } });
{
  // облик и колония
  const { PS, W } = bareP('pool', 5);
  const me = PS.addOwner(W, { key: 'me', name: 'Я', bot: false, spawn: true, design: des(['adhesion', '', 'eye', '', '', ''], 'wedge') });
  PS.setInput(W, me, inp(0, 0)); PS.step(W);
  const o = W.owners[me];
  ok(o.alive && o.st.colony === 3 && o.form === 'wedge' && o.parts.join() === 'adhesion,eye', 'облик рода при появлении: части, колония 3, клин', o.parts);
  for (let k = 0; k < W.cN; k++) W.cM[W.cL[k]] = 240;
  PS.setInput(W, me, inp(1, 0, 1)); PS.step(W);
  PS.setInput(W, me, inp(1, 0, 2)); PS.step(W);
  PS.setInput(W, me, inp(1, 0, 3)); PS.step(W);   // третье деление — колония уже собрана
  const mine = () => [...W.cL.subarray(0, W.cN)].filter(s => W.cO[s] === me);
  ok(mine().length === 3 && mine().every(s => W.cB[s]) && new Set(mine().map(s => W.cK[s])).size === 3, 'колония 3: держатся вместе, у каждой своё место', mine().map(s => [W.cB[s], W.cK[s]]));
  for (let k = 0; k < 45 * 30; k++) { PS.setInput(W, me, inp(Math.cos(k / 40), Math.sin(k / 40), 3)); PS.step(W); }
  const cs = mine();
  let maxD = 0;
  const h = cs.find(s => W.cK[s] === 0);
  for (const s of cs) maxD = Math.max(maxD, Math.hypot(W.cX[s] - W.cX[h], W.cY[s] - W.cY[h]));
  ok(cs.length === 3 && h != null && maxD < 4 * (T.radius(W.cM[h]) + 30), 'через 45 с — всё ещё 3 клетки рядом с сердцем (не слились, не разбежались)', [cs.length, maxD]);
  ok(o.colN === 3 && o.colMax === 3 && o.eatK < 1 && o.spdK === 1, 'роли клина: едоки едят легче', [o.colN, o.eatK]);
  // защита колонии: хищник в 1,5 раза больше клетки колонии её не съест, свободную — съест
  const { PS: P2, W: W2 } = bareP('pool', 6);
  const a = P2.addOwner(W2, { key: 'a', name: 'A', bot: false, design: des(['adhesion', '', '', '', '', '']) }), bb = P2.addOwner(W2, { key: 'b', name: 'B', bot: false });
  P2.setInput(W2, a, inp(0, 0)); P2.setInput(W2, bb, inp(0, 0));
  const h2 = T.cNew(W2, a, 0, 0, 60), m2 = T.cNew(W2, a, 30, 0, 60), m3 = T.cNew(W2, a, -30, 0, 60);
  for (const [s, k] of [[h2, 0], [m2, 1], [m3, 2]]) { W2.cB[s] = 1; W2.cK[s] = k; }
  W2.owners[a].alive = W2.owners[bb].alive = true; W2.owners[a].colN = 3;
  const pred = T.cNew(W2, bb, 300, 0, 95);
  W2.cX[pred] = W2.cX[m2] + 5; W2.cY[pred] = W2.cY[m2];
  P2.step(W2);
  ok(W2.oc[a] === 3, 'хищник в 1,6 раза больше клетки колонии — не съел (защищает колония)', W2.oc[a]);
  const { PS: P3, W: W3 } = bareP('pool', 7);
  const c1 = P3.addOwner(W3, { key: 'c', name: 'C', bot: false }), c2 = P3.addOwner(W3, { key: 'd', name: 'D', bot: false });
  P3.setInput(W3, c1, inp(0, 0)); P3.setInput(W3, c2, inp(0, 0));
  T.cNew(W3, c1, 0, 0, 60); T.cNew(W3, c2, 5, 0, 95);
  W3.owners[c1].alive = W3.owners[c2].alive = true;
  P3.step(W3);
  ok(W3.oc[c1] === 0, '…а одиночную клетку той же массы — съел');
  const ev = W3.ev.find(e => e.k === 'ko');
  ok(ev && ev.evo && 'p' in ev.evo && W3.owners[c2].dP > 0, 'съел клетку — белок в ДНК; событие «съели» несёт ДНК жизни', [ev?.evo, W3.owners[c2].dP]);
}
{
  // минералы только в Глубине; фотосинтез; облачко; гиганты; «видел»
  const { W: Wp } = world('pool', 3), { PS, W } = world('deep', 3);
  let pm = 0, dm = 0;
  for (let p = 0; p < 1600; p++) { if (T.isMin(Wp, p)) pm++; if (T.isMin(W, p)) dm++; }
  ok(pm === 0 && dm > 10 && dm < 70, `минералы — только в Глубине (${dm} из 1600)`, [pm, dm]);
  const me = PS.addOwner(W, { key: 'me', name: 'Я', bot: false, spawn: true, design: des(['leaf', 'leaf', 'eye', 'photo', '', '']) });
  PS.setHumans(W, 1);
  let gi = 0, giMin = 1e9;
  for (let k = 0; k < 60 * 30; k++) { PS.setInput(W, me, inp(Math.cos(k / 60), Math.sin(k / 60))); PS.step(W); for (const e of W.ev.splice(0)) if (e.k === 'ko' && e.o === me) PS.respawn(W, me); for (const o of W.owners) if (o && o.giant && o.alive) giMin = Math.min(giMin, o.mass); }
  gi = W.owners.filter(o => o && o.giant).length;
  ok(gi === 2 && giMin >= E.SIMK.giant.floor * .98, 'Глубина: 2 гиганта, не худеют ниже своего', [gi, giMin]);
  ok(W.owners.filter(o => o && o.giant).every(o => o.st.split === 0), 'гиганты не делятся');
  const o = W.owners[me];
  ok(o.seen & 1 << E.MICRO_IDS.indexOf('giant') || o.seen & 1 << E.MICRO_IDS.indexOf('firefly'), '«видел»: виды Глубины попадают в маску', o.seen.toString(2));
  // фотосинтез: в Луже днём хлоропласт даёт сахар без еды
  const { PS: P5, W: W5 } = bareP('pool', 9);
  const g1 = P5.addOwner(W5, { key: 'g', name: 'G', bot: false, design: des(['leaf', 'leaf', 'leaf', '', '', '']) });
  P5.setInput(W5, g1, inp(0, 0)); T.cNew(W5, g1, -1900, -1900, 30); W5.owners[g1].alive = true;
  for (let p = 0; p < 1600; p++) W5.pAl[p] = 0, W5.pAt[p] = 1e9;   // без еды
  for (let k = 0; k < 60 * 30; k++) P5.step(W5);
  const dS = W5.owners[g1].dS;
  ok(dS > 1.7 && dS < 2.2, `3 хлоропласта днём за минуту — ${dS.toFixed(2)} сахара`, dS);
  // облачко: соседу медленнее
  const { PS: P6, W: W6 } = bareP('pool', 10);
  const tx = P6.addOwner(W6, { key: 't', name: 'T', bot: false, design: des(['toxin', '', '', '', '', '']) }), vi = P6.addOwner(W6, { key: 'v', name: 'V', bot: false });
  P6.setInput(W6, tx, inp(0, 0)); P6.setInput(W6, vi, inp(1, 0));
  T.cNew(W6, tx, 0, 0, 30); const vs = T.cNew(W6, vi, 40, 0, 20);
  W6.owners[tx].alive = W6.owners[vi].alive = true;
  P6.step(W6); P6.step(W6);
  const v1 = W6.cVX[vs];
  const { PS: P7, W: W7 } = bareP('pool', 10);
  const tx2 = P7.addOwner(W7, { key: 't', name: 'T', bot: false }), vi2 = P7.addOwner(W7, { key: 'v', name: 'V', bot: false });
  P7.setInput(W7, tx2, inp(0, 0)); P7.setInput(W7, vi2, inp(1, 0));
  T.cNew(W7, tx2, 0, 0, 30); const vs2 = T.cNew(W7, vi2, 40, 0, 20);
  W7.owners[tx2].alive = W7.owners[vi2].alive = true;
  P7.step(W7); P7.step(W7);
  ok(v1 < W7.cVX[vs2] * .9, 'ядовитое облачко: сосед плывёт медленнее', [v1, W7.cVX[vs2]]);
  // облик меняется только со следующей жизни
  const { PS: P8, W: W8 } = world('pool', 11);
  const q = P8.addOwner(W8, { key: 'q', name: 'Q', bot: false, spawn: true, design: des(['eye', '', '', '', '', '']) });
  P8.setInput(W8, q, inp(0, 0)); P8.step(W8);
  P8.setOwner(W8, q, { design: des(['flagellum', '', '', '', '', '']) });
  ok(W8.owners[q].parts.join() === 'eye', 'новый облик живому — не сразу');
  for (let k = 0; k < W8.cN; k++) if (W8.cO[W8.cL[k]] === q) { W8.cDead[W8.cL[k]] = 1; W8.oc[q]--; }
  T.compact(W8); P8.step(W8); P8.respawn(W8, q); P8.step(W8);
  ok(W8.owners[q].alive && W8.owners[q].parts.join() === 'flagellum', '…а со следующей жизни — новый');
}

// ═══ 5. Одинаково при 30 / 60 / 144 кадрах (мир пути: Глубина, колония, облачко, минералы, гиганты) ═══
function hashW(W){
  const a = [W.step, W.round, W.cN, W.vN, W.bN, W.rs, W.light];
  for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; a.push(W.cId[s], W.cO[s], W.cX[s], W.cY[s], W.cM[s], W.cB[s], W.cK[s]); }
  for (const o of W.owners) if (o) a.push(o.dS || 0, o.dP || 0, o.dM || 0, o.colN || 0, o.seen || 0);
  for (let p = 0; p < 1600; p++) a.push(W.pAl[p] * 8 + W.pGen[p]);
  return K.hashNums(a);
}
function runAtFps(fps, steps){
  const PS = SIM.forEvo(E.worldCfg('deep', T0));
  const S = K.session({ game: 'kletochki-evo', sim: PS, autoLoop: false, me: { key: 'me', nick: 'Тест', skin: null, design: des(['adhesion', 'adhesion', 'toxin', 'photo', 'eye', 'jaw'], 'ring') }, now: () => 0 });
  const orig = Math.random; let r = 4242; Math.random = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  S.offline();
  Math.random = orig;
  const ev = [];
  let t = 0, x = 0, y = 0, sp = 0, ej = 0, q = 999;
  const R = () => { q = (q * 48271) % 2147483647; return q / 2147483647; };
  while (t < steps * 1000 / 30) { t += 40 + R() * 260; x = R() * 2 - 1; y = R() * 2 - 1; if (R() < .12) sp++; if (R() < .08) ej++; ev.push([t + 1000, Float64Array.from([x, y, sp, ej, 0, 0])]); }
  let ei = 0, f = 0;
  S.setInput(Float64Array.from([0, 0, 0, 0, 0, 0]), 0);
  while (S.L.n < steps) {
    const now = 1000 + f * 1000 / fps;
    while (ei < ev.length && ev[ei][0] <= now) { S.setInput(ev[ei][1], ev[ei][0]); ei++; }
    S.frame(now);
    f++;
  }
  return [hashW(S.W), S.W.step, S.W.owners[S.me].colMax];
}
{
  const N = FAST ? 900 : 2700;
  const h = [30, 60, 144].map(fps => runAtFps(fps, N));
  ok(h[0][1] === N && h[1][1] === N && h[2][1] === N, 'все частоты — одинаковое число шагов', h);
  ok(h[0][0] === h[1][0] && h[1][0] === h[2][0], `мир пути одинаковый при 30/60/144 FPS (${N} шагов, Глубина: колония, облачко, минералы, гиганты)`, h);
}

// ═══ 6. Снимки гостю, список участников ═══
{
  const { PS, W } = world('deep', 21);
  const me = PS.addOwner(W, { key: 'g1', name: 'Гость', bot: false, spawn: true, design: des(['adhesion', '', 'photo', '', '', ''], 'ring') });
  PS.setHumans(W, 1);
  for (let k = 0; k < 600; k++) { PS.setInput(W, me, inp(Math.sin(k / 50), Math.cos(k / 70), (k / 200) | 0)); PS.step(W); W.ev.length = 0; }
  const G = PS.mirror(null);
  const v = PS.encode(W, me, { aspect: 1, inTs: 1, hold: 1 });
  ok(PS.decode(G, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength), 1) && G.evo && Math.abs(G.dS - W.owners[me].dS) < .11 && G.colN === W.owners[me].colN && G.seen === W.owners[me].seen, 'снимок пути: ДНК жизни, колония, «видел» — у гостя', [G.dS, W.owners[me].dS, G.colN]);
  let bonded = 0; for (let k = 0; k < G.cN; k++) if (G.cFl[G.cL[k]] & 4) bonded++;
  let bondedW = 0; for (let k = 0; k < W.cN; k++) if (W.cB[W.cL[k]] && W.cO[W.cL[k]] === me) bondedW++;
  ok(bonded >= bondedW && bondedW >= 1, 'клетки колонии помечены в снимке (мостики у гостя)', [bonded, bondedW]);
  const ol = JSON.parse(JSON.stringify(PS.owners(W)));
  const G2 = PS.mirror(null); PS.setOwners(G2, ol);
  ok(G2.owners[me].design === W.owners[me].design && G2.owners.filter(Boolean).some(o => o.kind === E.MICRO_IDS.indexOf('giant')), 'список участников: облик игрока и вид ботов', G2.owners[me]);
  // обычная арена — без флага 8 и без лишних полей
  const Wc = SIM.newWorld(21), mc = SIM.addOwner(Wc, { key: 'c', name: 'C', bot: false, spawn: true });
  SIM.setHumans(Wc, 1); SIM.step(Wc);
  const vc = SIM.encode(Wc, mc, { aspect: 1, inTs: -1 });
  ok((new Uint8Array(vc.buffer, vc.byteOffset, vc.byteLength)[1] & 8) === 0 && SIM.owners(Wc)[0].length === 7, 'обычная арена: снимок без флага пути, список — 7 полей');
}

// ═══ 7. Память за 20 раундов (мир пути) ═══
if (typeof gc === 'function') {
  const { PS, W } = world('reef', 99);
  PS.addOwner(W, { key: 'me', name: 'Я', bot: false, spawn: true, design: des(['adhesion', 'adhesion', 'jaw', '', '', '']) });
  PS.setHumans(W, 1);
  let heap2 = 0;
  const per = FAST ? 400 : 1500, t0 = performance.now();
  let steps = 0;
  for (let r = 0; r < 20; r++) {
    for (let k = 0; k < per; k++) { PS.step(W); W.ev.length = 0; steps++; }
    W.left = 1; PS.step(W); W.ev.length = 0;
    while (W.phase === 1) { PS.step(W); W.ev.length = 0; steps++; }
    if (r === 1) { gc(); heap2 = process.memoryUsage().heapUsed; }
  }
  const ms = (performance.now() - t0) / steps;
  gc();
  const grow = (process.memoryUsage().heapUsed - heap2) / 1048576;
  ok(W.round === 21 && grow < 1.5, `память не растёт за 20 раундов пути (${grow.toFixed(2)} МБ)`, grow);
  console.log(`  мир пути (Риф, 12 участников): шаг в среднем ${ms.toFixed(3)} мс`);
}

// ═══ 8. Комнаты пути на подменной сети ═══
const { makeClock, makeBus, makeNet } = require('./iogames-net.cjs');
async function rooms(){
  const clock = makeClock(), bus = makeBus(clock), net = makeNet(clock);
  const all = [];
  function client(key, b, design){
    const PS = b ? SIM.forEvo(E.worldCfg(b, T0)) : SIM;
    const S = K.session({ game: b ? 'kletochki-evo' : 'kletochki', sim: PS, max: 10, me: { key, nick: key, skin: null, aspect: 1, design }, open: bus.open, net, now: clock.now, pnow: clock.now,
      setT: clock.setT, clearT: clock.clearT, autoLoop: false });
    all.push(S);
    return S;
  }
  const tick = async ms => { const end = clock.t + ms; while (clock.t < end) { for (const S of all) if (!S.closed) S.frame(clock.t); await clock.run(Math.min(end, clock.t + 16)); } };
  const A = client('ka', 'pool', des(['eye', '', '', '', '', ''])); A.online('', { pub: true, prefix: 'pool' }); await tick(500);
  const Bc = client('kb', 'pool', des(['adhesion', 'jaw', '', '', '', ''], 'wedge')); Bc.online('', { pub: true, prefix: 'pool' }); await tick(500);
  const Cc = client('kc', 'reef', des(['jaw', '', '', '', '', ''])); Cc.online('', { pub: true, prefix: 'reef' }); await tick(500);
  const Dc = client('kd', null); Dc.online('', { pub: true }); await tick(4000);
  ok(A.code === 'pool1' && Bc.code === 'pool1' && Cc.code === 'reef1' && Dc.code === 'pub1', 'общие арены пути — по биому (pool1, reef1), обычная — pub1', [A.code, Bc.code, Cc.code, Dc.code]);
  ok(bus.ch.has('kletochki-evo-io-pool1') && bus.ch.has('kletochki-evo-io-reef1') && bus.ch.has('kletochki-io-pub1') && !bus.ch.has('kletochki-io-pool1'), 'каналы пути отдельно от обычной арены', [...bus.ch.keys()]);
  ok(A.role === 'host' && Bc.role === 'guest' && Cc.role === 'host' && Dc.role === 'host', 'в Луже — двое (хозяин и гость), Риф и обычная арена — свои хозяева', [A.role, Bc.role, Cc.role, Dc.role]);
  const ob = A.W.owners[Bc.me];
  ok(ob && ob.parts.join() === 'adhesion,jaw' && ob.form === 'wedge' && A.W.evo.b === 'pool', 'облик гостя дошёл до хозяина (части, форма)', ob && ob.parts);
  ok(Bc.G.evo && Bc.G.evo.b === 'pool' && Bc.G.ready, 'гость видит мир пути (снимки с флагом 8)');
  for (let k = 0; k < A.W.cN; k++) { const s = A.W.cL[k]; if (A.W.cO[s] === Bc.me) A.W.cM[s] = 300; }
  Bc.setInput(Float64Array.from([1, 0, 0, 0, 0, 0]), clock.t); await tick(400);
  Bc.setInput(Float64Array.from([1, 0, 1, 0, 0, 0]), clock.t); await tick(700);
  Bc.setInput(Float64Array.from([1, 0, 2, 0, 0, 0]), clock.t); await tick(1500);
  ok(A.W.owners[Bc.me].colN === 3 && Bc.G.colN === 3, 'гость делится — колония 3 у хозяина и у гостя в снимке', [A.W.owners[Bc.me].colN, Bc.G.colN]);
  await tick(5000);
  ok(Bc.G.pel > 0 || Bc.G.dS > 0 || A.W.owners[Bc.me].pel === 0, 'ДНК жизни гостя считает хозяин и шлёт гостю', [Bc.G.pel, Bc.G.dS]);
  // смена хозяина: колония гостя не рассыпается
  const before = Bc.G.colN;
  A.leave(); await tick(4500);
  ok(Bc.role === 'host' && Bc.W.evo?.b === 'pool', 'хозяин ушёл — новый хозяин держит мир пути (Лужа)', [Bc.role]);
  const me = Bc.W.owners[Bc.me];
  let bonded = 0; for (let k = 0; k < Bc.W.cN; k++) { const s = Bc.W.cL[k]; if (Bc.W.cO[s] === Bc.me && Bc.W.cB[s]) bonded++; }
  ok(me && me.parts.join() === 'adhesion,jaw' && bonded === before, 'у нового хозяина — свой облик и колония', [me && me.parts, bonded, before]);
  for (const S of all) S.leave();
  await tick(300);
  ok(!clock.errors, 'без ошибок в таймерах');
}

rooms().catch(e => { fail++; console.log('FAIL комнаты', e.stack); }).then(() => {
  // ═══ 9. Экран пути грузится без DOM и не ломается без каталога ═══
  ok(typeof ctx.KletochkiPath === 'function', 'kletochki-path.js: KletochkiPath есть (без DOM при загрузке)');
  const bare = load(['js/games/iokit.js', 'js/games/kletochki-path.js']);
  ok(bare.KletochkiPath({ K: bare.IoKit }) === null, 'без evo.js путь не включается (обычная игра работает)');
  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
});

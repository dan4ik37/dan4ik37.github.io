// Тесты «Клеточек» (js/games/kletochki.js + js/games/iokit.js) в node, без браузера:
//  1) формулы и правила (рост, деление, слияние, выброс, колючки, края, еда);  2) одинаковый мир при 30/60/144 кадрах в секунду;
//  3) боты 15 минут игры без ошибок, раунды кончаются и начинаются;  4) память не растёт за 20 раундов;  5) снимки (двоичные,
//  размер) и зеркало гостя;  6) комната на подменной сети: хозяин, гости, управление, смена хозяина, уход и возврат.
// Запуск из корня сайта: node --expose-gc scripts/kletochki-test.cjs [--fast]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };

function load(){
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Math, Date, JSON, btoa, atob, performance, ArrayBuffer, DataView, Uint8Array });
  ctx.window = ctx; ctx.GAME_IMPL = {};
  for (const f of ['js/games/iokit.js', 'js/games/kletochki.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = load();
const K = ctx.IoKit, T = ctx.GAME_IMPL.kletochki._test, SIM = T.SIM, C = T.C;
module.exports = { load };

// сумма мира для сверки
function hashW(W){
  const a = [W.step, W.round, W.phase, W.left, W.cN, W.vN, W.bN, W.rs];
  for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; a.push(W.cId[s], W.cO[s], W.cX[s], W.cY[s], W.cM[s]); }
  for (let k = 0; k < W.vN; k++) { const s = W.vL[k]; a.push(W.vX[s], W.vY[s], W.vM[s]); }
  for (let k = 0; k < W.bN; k++) { const s = W.bL[k]; a.push(W.bX[s], W.bY[s]); }
  for (let p = 0; p < C.NP; p++) a.push(W.pAl[p] * 8 + W.pGen[p]);
  return K.hashNums(a);
}
function finiteW(W){
  for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; if (!isFinite(W.cX[s]) || !isFinite(W.cY[s]) || !isFinite(W.cM[s]) || W.cM[s] <= 0) return false; }
  for (let k = 0; k < W.vN; k++) { const s = W.vL[k]; if (!isFinite(W.vX[s]) || !isFinite(W.vY[s])) return false; }
  for (let k = 0; k < W.bN; k++) { const s = W.bL[k]; if (!isFinite(W.bX[s]) || !isFinite(W.bY[s])) return false; }
  return true;
}
const inArena = W => { for (let k = 0; k < W.cN; k++) { const s = W.cL[k]; if (Math.abs(W.cX[s]) > C.H + 5 || Math.abs(W.cY[s]) > C.H + 5) return false; } return true; };
const IN = SIM.IN;
const inp = (x, y, s = 0, e = 0, em = 0, emId = 0) => Float64Array.from([x, y, s, e, em, emId]);

// ═══ 1. Формулы и правила ═══
{
  ok(Math.abs(T.radius(10) - (4.5 * Math.sqrt(10) + 4)) < 1e-9 && T.radius(100) > T.radius(10), 'радиус растёт с массой');
  ok(T.speedOf(T.radius(10)) > T.speedOf(T.radius(100)) && T.speedOf(T.radius(100)) > T.speedOf(T.radius(1000)), 'большие — медленнее', [T.speedOf(T.radius(10)), T.speedOf(T.radius(1000))]);
  ok(T.viewArea(T.radius(1000)) > T.viewArea(T.radius(10)) * 3, 'большой видит больше');
  ok(T.mergeSteps(10) >= 300 && T.mergeSteps(10) <= 310 && T.mergeSteps(5000) === 35 * 30, 'слияние: 10–35 с', [T.mergeSteps(10), T.mergeSteps(5000)]);
  const st = T.bodyStats(['base']), st2 = T.bodyStats(['base', 'flagellum', 'spikes']);
  ok(st.speed === 1 && st.eat === 1.25 && st.spikes === 0, 'тело base — обычные правила');
  ok(Math.abs(st2.speed - 1.12 * .94) < 1e-9 && st2.spikes === 1, 'части клетки меняют свойства (заготовка «Вселенной»)', st2);
  const W = SIM.newWorld(7);
  ok(W.vN === C.VIR_MIN && W.pAl.every(x => x === 1), 'новый мир: колючки и вся еда');
  // еда — на своих местах (одинаково по зерну)
  const ax = new Float32Array(1), ay = new Float32Array(1);
  T.pelletXY(W.pSeed, 5, 0, ax, ay, 0);
  ok(ax[0] === W.pX[5] && ay[0] === W.pY[5], 'место еды — по зерну, номеру и поколению');
  let inside = true;
  for (let p = 0; p < C.NP; p++) if (Math.abs(W.pX[p]) > C.H || Math.abs(W.pY[p]) > C.H) inside = false;
  ok(inside, 'вся еда внутри арены');
  // человек
  const i = SIM.addOwner(W, { key: 'u1', name: 'Аня', skin: { p: 2, a: '#ff0000', b: '#00ff00' }, bot: false, spawn: true });
  SIM.setHumans(W, 1);
  let bots = 0; for (const o of W.owners) if (o && o.bot) bots++;
  ok(bots === C.TOTAL - 1, 'ботов — до 12 участников', bots);
  SIM.setInput(W, i, inp(0, 0));
  SIM.step(W);
  const o = W.owners[i];
  ok(o.alive && W.oc[i] === 1 && o.mass >= C.START_M && o.mass <= C.START_M + 3, 'игрок появился клеткой 10', o.mass);
  ok(W.owners[i].skin.p === 2 && W.owners[i].skin.a === '#ff0000', 'раскраска принята');
  ok(T.skinOk({ p: 99, a: 'red', b: '#000000' }) === null && T.skinOk({ p: 99, a: '#AABBCC', b: '#000000' }).p === 7, 'плохая раскраска — отказ, узор в пределах');
  // движение к цели
  const s = W.cL[[...W.cL.slice(0, W.cN)].findIndex(q => W.cO[q] === i)];
  const x0 = W.cX[s];
  SIM.setInput(W, i, inp(1, 0));
  for (let k = 0; k < 30; k++) SIM.step(W);
  ok(W.cX[s] > x0 + 60, 'клетка плывёт по управлению', W.cX[s] - x0);
  // рост и деление
  W.cM[s] = 200;
  SIM.setInput(W, i, inp(1, 0, 1)); SIM.step(W);
  ok(W.oc[i] === 2, 'деление: 2 клетки', W.oc[i]);
  const mine = () => [...W.cL.slice(0, W.cN)].filter(q => W.cO[q] === i);
  const ms = mine().map(q => W.cM[q]);
  ok(Math.abs(ms[0] - ms[1]) < 3 && Math.abs(ms[0] + ms[1] - 200) < 8, 'половинки поровну', ms);
  // ещё делиться: до 16 клеток, не меньше SPLIT_MIN
  for (let k = 2; k <= 8; k++) { SIM.setInput(W, i, inp(1, 0, k)); SIM.step(W); }
  ok(W.oc[i] <= C.MAXC && mine().every(q => W.cM[q] >= 10), 'клеток ≤ 16, маленькие не делятся', W.oc[i]);
  // слияние: через время клетки снова одна
  SIM.setInput(W, i, inp(0, 0, 8));
  for (let k = 0; k < 45 * 30 && W.oc[i] > 1; k++) SIM.step(W);
  ok(W.oc[i] === 1, 'свои клетки сливаются обратно', W.oc[i]);
  // края: клетка не уходит за край
  const s1 = mine()[0];
  W.cX[s1] = C.H - 5; SIM.setInput(W, i, inp(1, 0, 8, 0));
  for (let k = 0; k < 120; k++) SIM.step(W);
  ok(W.cX[s1] < C.H && W.cX[s1] > C.H - 200, 'мягкий край держит внутри', W.cX[s1]);
}
// Еда, поедание, колючки — на чистом мире без ботов
function bare(seed){
  const W = SIM.newWorld(seed);
  W.botWant = 0;
  for (let k = 0; k < W.vN; k++) W.vDead[W.vL[k]] = 1;
  T.compact(W);
  return W;
}
{
  const W = bare(11);
  const a = SIM.addOwner(W, { key: 'a', name: 'A', bot: false, spawn: false }), b = SIM.addOwner(W, { key: 'b', name: 'B', bot: false, spawn: false });
  SIM.setInput(W, a, inp(0, 0)); SIM.setInput(W, b, inp(0, 0));
  const sa = T.cNew(W, a, 0, 0, 100), sb = T.cNew(W, b, 10, 0, 50);
  W.owners[a].alive = W.owners[b].alive = true;
  SIM.step(W);
  ok(W.oc[b] === 0 && W.cM[sa] >= 150, 'большая (в 2 раза) ест маленькую рядом', [W.oc[b], W.cM[sa]]);
  const ev = W.ev.splice(0);
  ok(ev.some(e => e.k === 'ko' && e.o === b && e.by === a), 'событие «съели»: кто и кем', ev);
  // почти равные — не едят
  const W2 = bare(12);
  const c = SIM.addOwner(W2, { key: 'c', name: 'C', bot: false }), d = SIM.addOwner(W2, { key: 'd', name: 'D', bot: false });
  SIM.setInput(W2, c, inp(0, 0)); SIM.setInput(W2, d, inp(0, 0));
  T.cNew(W2, c, 0, 0, 100); T.cNew(W2, d, 5, 0, 85);
  W2.owners[c].alive = W2.owners[d].alive = true;
  for (let k = 0; k < 10; k++) SIM.step(W2);
  ok(W2.oc[c] === 1 && W2.oc[d] === 1, 'разница меньше 25 % — никто никого не ест');
  // защита новичка
  const W3 = bare(13);
  const e1 = SIM.addOwner(W3, { key: 'e', name: 'E', bot: false }), f1 = SIM.addOwner(W3, { key: 'f', name: 'F', bot: false });
  SIM.setInput(W3, e1, inp(0, 0)); SIM.setInput(W3, f1, inp(0, 0));
  T.cNew(W3, e1, 0, 0, 500); const fs1 = T.cNew(W3, f1, 3, 0, 10); W3.cProt[fs1] = W3.step + 60;
  W3.owners[e1].alive = W3.owners[f1].alive = true;
  SIM.step(W3);
  ok(W3.oc[f1] === 1, 'новичка 3 с не съесть');
  for (let k = 0; k < 70; k++) SIM.step(W3);
  ok(W3.oc[f1] === 0, '…а потом можно');
  // выброс массы
  const W7 = bare(17);
  const q1 = SIM.addOwner(W7, { key: 'q', name: 'Q', bot: false }); SIM.setInput(W7, q1, inp(1, 0, 0, 0));
  const qs = T.cNew(W7, q1, 0, 0, 120); W7.owners[q1].alive = true;
  SIM.step(W7);
  SIM.setInput(W7, q1, inp(1, 0, 0, 1)); SIM.step(W7);
  ok(W7.bN === 1 && Math.abs(W7.cM[qs] - (120 - C.EJECT_COST)) < 3, 'выброс массы: −14, вылетает капля', [W7.bN, W7.cM[qs]]);
  for (let k = 0; k < 20; k++) SIM.step(W7);
  ok(W7.bN === 1, 'свою каплю сразу не съесть (0,5 с)', W7.bN);
  // колючка: маленькая проходит, большая лопается
  const W4 = bare(14);
  const g1 = SIM.addOwner(W4, { key: 'g', name: 'G', bot: false });
  SIM.setInput(W4, g1, inp(0, 0));
  T.vNew(W4, 0, 0, C.VIRUS_M);
  const gs = T.cNew(W4, g1, 0, 0, 60); W4.owners[g1].alive = true;
  SIM.step(W4);
  ok(W4.vN === 1 && W4.oc[g1] === 1, 'маленькая клетка проходит под колючкой');
  W4.cM[gs] = 400;
  SIM.step(W4);
  ok(W4.vN === 0 && W4.oc[g1] > 4, 'большая клетка на колючке лопается на куски', [W4.vN, W4.oc[g1]]);
  const tot = [...W4.cL.slice(0, W4.cN)].reduce((x, q) => x + W4.cM[q], 0);
  ok(Math.abs(tot - (400 + C.VIRUS_M * .5)) < 2, 'масса после колючки — своя + половина колючки', tot);
  // кормить колючку: 7 выбросов — новая колючка
  const W5 = bare(15);
  const h1 = SIM.addOwner(W5, { key: 'h', name: 'H', bot: false }); SIM.setInput(W5, h1, inp(0, 0));
  T.vNew(W5, 300, 0, C.VIRUS_M);
  for (let k = 0; k < 7; k++) T.bNew(W5, h1, 300 - 70, 0, 500, 0);
  for (let k = 0; k < 20; k++) SIM.step(W5);
  ok(W5.vN === 2, 'колючка от 7 выбросов «стреляет» новой', W5.vN);
  // еда: клетка ест точки, точки возвращаются
  const W6 = bare(16);
  const j1 = SIM.addOwner(W6, { key: 'j', name: 'J', bot: false }); SIM.setInput(W6, j1, inp(0, 0));
  const p0 = 100, js = T.cNew(W6, j1, W6.pX[p0], W6.pY[p0], 10); W6.owners[j1].alive = true;
  SIM.step(W6);
  ok(!W6.pAl[p0] && W6.cM[js] >= 11, 'точка съедена: +1 к массе');
  W6.cX[js] = -2000; W6.cY[js] = -2000;
  for (let k = 0; k < 260; k++) SIM.step(W6);
  ok(W6.pAl[p0] === 1 && W6.pGen[p0] === 1, 'точка вернулась (новое место — следующее поколение)');
}

// ═══ 2. Одинаково при 30 / 60 / 144 кадрах: тот же мир (с ботами), управление — состояние с отметкой времени ═══
function runAtFps(fps, steps, seed){
  const S = K.session({ game: 'kletochki', sim: SIM, autoLoop: false, me: { key: 'me', nick: 'Тест', skin: null }, now: () => 0 });
  const orig = Math.random; let r = seed; Math.random = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  S.offline();
  Math.random = orig;
  // сценарий управления: события в «случайные» моменты (не кратные шагу), одинаковые для всех частот
  const ev = [];
  let t = 0, x = 0, y = 0, sp = 0, ej = 0, q = 12345;
  const R = () => { q = (q * 48271) % 2147483647; return q / 2147483647; };
  while (t < steps * 1000 / 30) { t += 40 + R() * 260; x = R() * 2 - 1; y = R() * 2 - 1; if (R() < .1) sp++; if (R() < .1) ej++; ev.push([t + 1000, Float64Array.from([x, y, sp, ej, 0, 0])]); }
  let ei = 0, f = 0;
  const t0 = 1000;
  S.setInput(Float64Array.from([0, 0, 0, 0, 0, 0]), 0);
  while (S.L.n < steps) {
    const now = t0 + f * 1000 / fps;
    while (ei < ev.length && ev[ei][0] <= now) { S.setInput(ev[ei][1], ev[ei][0]); ei++; }
    S.frame(now);
    f++;
  }
  return S;
}
{
  const N = FAST ? 900 : 3600;
  const h = [30, 60, 144].map(fps => { const S = runAtFps(fps, N, 777); return [hashW(S.W), S.W.step, S.L.n]; });
  ok(h[0][1] === N && h[1][1] === N && h[2][1] === N, 'все частоты сделали одинаковое число шагов', h);
  ok(h[0][0] === h[1][0] && h[1][0] === h[2][0], `мир одинаковый при 30/60/144 FPS (${N} шагов = ${N / 30} с, с ботами, делением и выбросом)`, h);
}

// ═══ 3. Боты 15 минут игры: без ошибок, раунды кончаются и начинаются; «глупый» игрок (бродит наугад) — честность ботов ═══
{
  const W = SIM.newWorld(4242);
  const hu = SIM.addOwner(W, { key: 'h', name: 'Гуляка', bot: false, spawn: true });
  SIM.setHumans(W, 1);
  const steps = (FAST ? 5 : 15) * 60 * 30;
  let err = null, ends = 0, starts = 0, kos = 0, earlyKo = 0, maxMass = 0, minPel = 1e9, bad = 0, wx = 1, wy = 0, lifeSum = 0, lives = 0;
  const t0 = process.hrtime.bigint();
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    if (k % 90 === 0) { const a = (k * 2654435761 % 1000) / 1000 * Math.PI * 2; wx = Math.cos(a); wy = Math.sin(a); }
    SIM.setInput(W, hu, inp(wx, wy));
    const a = process.hrtime.bigint();
    try { SIM.step(W); } catch (e) { err = e; break; }
    const dt = Number(process.hrtime.bigint() - a) / 1e6; if (dt > worst) worst = dt;
    for (const e of W.ev.splice(0)) {
      if (e.k === 'end') ends++;
      else if (e.k === 'start') starts++;
      else if (e.k === 'ko') { kos++; if (e.o === hu) { lifeSum += e.life; lives++; if (e.life < 20 && e.by >= 0 && W.owners[e.by] && W.owners[e.by].bot) earlyKo++; SIM.respawn(W, hu); } }
    }
    if (k % 300 === 0) {
      if (!finiteW(W) || !inArena(W)) bad++;
      let pel = 0; for (let p = 0; p < C.NP; p++) pel += W.pAl[p]; if (pel < minPel) minPel = pel;
      for (const o of W.owners) if (o && o.alive && o.mass > maxMass) maxMass = o.mass;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(!err, 'боты: без ошибок', err && String(err.stack).slice(0, 400));
  ok(bad === 0, 'координаты и массы — числа, все внутри арены', bad);
  const expEnds = Math.floor(steps / (C.ROUND + C.END)) + (steps % (C.ROUND + C.END) >= C.ROUND ? 1 : 0);
  ok(ends === expEnds && starts >= ends - 1, `раунды кончаются и начинаются (${ends} за ${steps / 1800} мин)`, [ends, starts, expEnds]);
  ok(kos > 20, 'клетки едят друг друга', kos);
  ok(earlyKo === 0, 'новичка в первые 20 с боты не съедают', earlyKo);
  ok(maxMass > 300 && maxMass < 40000, 'кто-то вырастает, но не бесконечно', Math.round(maxMass));
  ok(minPel > C.NP * .5, 'еды на арене хватает', minPel);
  ok(W.cN <= 256 && W.bN <= 192 && W.vN <= 24, 'пулы не переполнены', [W.cN, W.bN, W.vN]);
  console.log(`  боты ${steps / 1800} мин: шаг в среднем ${(ms / steps).toFixed(3)} мс, худший ${worst.toFixed(2)} мс; съедено ${kos}; гуляка: ${lives} жизней, в среднем ${lives ? (lifeSum / lives).toFixed(0) : '-'} с; макс. масса ${Math.round(maxMass)}`);
}

// ═══ 4. Память за 20 раундов (раунд укорочен) ═══
if (typeof gc === 'function') {
  const W = SIM.newWorld(99);
  SIM.setHumans(W, 0);
  const rounds = 20, per = FAST ? 400 : 1500;
  let heap2 = 0;
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < per; k++) { SIM.step(W); W.ev.length = 0; }
    W.left = 1; SIM.step(W); W.ev.length = 0;
    while (W.phase === 1) { SIM.step(W); W.ev.length = 0; }
    if (r === 1) { gc(); heap2 = process.memoryUsage().heapUsed; }
  }
  gc();
  const heap20 = process.memoryUsage().heapUsed, grow = (heap20 - heap2) / 1024 / 1024;
  ok(W.round === rounds + 1, '20 раундов прошли', W.round);
  ok(grow < 1.5, `память не растёт за 20 раундов (${grow.toFixed(2)} МБ)`, grow);
  ok(W.owners.filter(Boolean).length <= C.MAXO && W.ev.length === 0, 'участников не больше 16');
  console.log(`  память: после 2-го раунда ${(heap2 / 1048576).toFixed(1)} МБ, после 20-го ${(heap20 / 1048576).toFixed(1)} МБ`);
} else console.log('  (запусти с --expose-gc — проверка памяти пропущена)');

// ═══ 5. Снимки: туда-обратно и размер ═══
{
  const W = SIM.newWorld(321);
  const me = SIM.addOwner(W, { key: 'g1', name: 'Гость', bot: false, spawn: true });
  SIM.setHumans(W, 1);
  for (let k = 0; k < 900; k++) { SIM.setInput(W, me, inp(Math.sin(k / 50), Math.cos(k / 70))); SIM.step(W); W.ev.length = 0; }
  const g = { aspect: 1.6, inTs: 12345, hold: 7 };
  const G = SIM.mirror(null);
  let maxB = 0, sum = 0, n = 0, okRT = true;
  for (let k = 0; k < 600; k++) {
    SIM.setInput(W, me, inp(Math.sin(k / 50), Math.cos(k / 70)));
    SIM.step(W); W.ev.length = 0;
    if (k % 2) continue;
    const v = SIM.encode(W, me, g);
    const buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    maxB = Math.max(maxB, buf.byteLength); sum += buf.byteLength; n++;
    if (!SIM.decode(G, buf, k * 33)) { okRT = false; break; }
    for (let j = 0; j < G.cN; j++) {
      const s = G.cL[j];
      let found = false;
      for (let q = 0; q < W.cN; q++) { const t = W.cL[q]; if (W.cId[t] === G.cId[s]) { found = Math.abs(W.cX[t] - G.cTX[s]) <= .25 && Math.abs(W.cM[t] - G.cTM[s]) <= .5; break; } }
      if (!found) { okRT = false; break; }
    }
  }
  ok(okRT, 'снимок → зеркало гостя: клетки, массы, места совпадают');
  ok(G.me === me && G.echoTs === 12345 && G.hold === 7, 'в снимке — «я» и эхо для пинга');
  ok(G.lbN > 0 && G.lbN <= 10, 'таблица лидеров в снимке', G.lbN);
  let vis = 0; for (let p = 0; p < C.NP; p++) if (G.pAl[p] && W.pAl[p] && Math.abs(G.pX[p] - W.pX[p]) < .01) vis++;
  ok(vis > 20, 'еда у гостя — там же, где у хозяина (по зерну и поколению)', vis);
  ok(sum / n < 1200 && maxB < 3000, `снимок маленький: в среднем ${Math.round(sum / n)} Б, самый большой ${maxB} Б`, [sum / n, maxB]);
  const v1 = SIM.encode(W, me, g); const b1 = v1.buffer.slice(v1.byteOffset, v1.byteOffset + v1.byteLength);
  SIM.step(W); W.ev.length = 0;
  const v2 = SIM.encode(W, me, g); const b2 = v2.buffer.slice(v2.byteOffset, v2.byteOffset + v2.byteLength);
  ok(SIM.decode(G, b2, 1e6) === true && SIM.decode(G, b1, 1e6 + 1) === false, 'опоздавший снимок пропускается');
  ok(SIM.decode(G, new Uint8Array([9, 9, 9]).buffer, 0) === false, 'чужой мусор — отказ');
  let threw = false; try { SIM.decode(G, new Uint8Array([1, 0, 255, 255, 255, 127, 1]).buffer, 0); } catch (e) { threw = true; }
  ok(threw, 'обрезанный снимок — исключение (его ловит сеанс)');
  const out = new Float64Array(SIM.IN);
  ok(SIM.unpackIn([0, 0, ...SIM.packIn(inp(.5, -1, 3, 4, 1, 2))], 2, out) && out[0] === .5 && out[1] === -1 && out[2] === 3 && out[5] === 2, 'управление: упаковка туда-обратно');
  ok(SIM.unpackIn([0, 0, 'x', 1, 1, 1, 1, 1], 2, out) === null && SIM.unpackIn([1], 0, out) === null, 'мусорное управление — отказ');
  ok(K.cleanName('Вася https://evil.ru', 1) === 'Вася', 'ссылка из имени убрана', K.cleanName('Вася https://evil.ru', 1));
  ok(!/\d{5}/.test(K.cleanName('звони 89991234567', 1)) && K.cleanName('@tg_channel', 1).indexOf('@') < 0, 'телефоны и @ники убраны', [K.cleanName('звони 89991234567', 1), K.cleanName('@tg_channel', 1)]);
  ok(K.cleanName('хуйло', 2) !== 'хуйло' && K.cleanName('сука', 2) !== 'сука' && K.cleanName('f u c k', 2) !== 'f u c k', 'мат → смешное имя');
  ok(K.cleanName('Денчик37 🔥', 1) === 'Денчик37 🔥' && K.cleanName('страхует', 1) === 'страхует', 'обычные имена и эмодзи — как есть', [K.cleanName('Денчик37 🔥', 1), K.cleanName('страхует', 1)]);
  ok(K.cleanName('', 0).length >= 2 && [...K.cleanName('a'.repeat(40), 0)].length === 16, 'пустое — имя-заглушка; длинное — 16 знаков');
}

// ═══ 6. Комната: подменная сеть (Supabase + WebRTC), хозяин и гости, смена хозяина, приход и уход ═══
const { makeClock, makeBus, makeNet } = require('./iogames-net.cjs');
async function online(useNet){
  const tag = useNet ? ' (напрямую)' : ' (без прямой связи)';
  const clock = makeClock(), bus = makeBus(clock), net = useNet ? makeNet(clock) : null;
  const clients = [];
  let frameErr = 0, worstFrame = 0;
  function client(key, nick){
    const c = { key, nick, ko: [], rounds: [], roles: [] };
    c.S = K.session({ game: 'kletochki', sim: SIM, max: 10, me: { key, nick, skin: null, aspect: 1.6 }, open: bus.open, net, now: clock.now, pnow: clock.now,
      setT: clock.setT, clearT: clock.clearT, autoLoop: false, onKo: e => c.ko.push(e), onRound: e => c.rounds.push(e), onRole: r => c.roles.push(r) });
    clients.push(c);
    return c;
  }
  async function tick(ms){
    const end = clock.t + ms;
    while (clock.t < end) {
      const t = Math.min(end, clock.t + 16);
      for (const c of clients) if (!c.S.closed) {
        const a = process.hrtime.bigint();
        try { c.S.frame(clock.t); } catch (e) { frameErr++; if (frameErr < 3) console.log(e.stack); }
        const d = Number(process.hrtime.bigint() - a) / 1e6; if (d > worstFrame) worstFrame = d;
      }
      await clock.run(t);
    }
  }
  const humansIn = W => W.owners.filter(o => o && !o.bot).length, botsIn = W => W.owners.filter(o => o && o.bot && !o.retire).length;
  const A = client('ka', 'Аня'); A.S.online('test1'); await tick(600);
  const Bc = client('kb', 'Боря'); Bc.S.online('test1'); await tick(400);
  const Cc = client('kc', 'Вика'); Cc.S.online('test1'); await tick(4000);
  ok(A.S.role === 'host' && Bc.S.role === 'guest' && Cc.S.role === 'guest', 'хозяин — первый вошедший' + tag, [A.S.role, Bc.S.role, Cc.S.role]);
  ok(humansIn(A.S.W) === 3 && botsIn(A.S.W) === C.TOTAL - 3, 'у хозяина: 3 человека + боты до 12' + tag, [humansIn(A.S.W), botsIn(A.S.W)]);
  ok(Bc.S.G.ready && Bc.S.me >= 0 && Cc.S.G.ready && Cc.S.me >= 0 && Bc.S.me !== Cc.S.me, 'гости получили снимки и свой номер' + tag, [Bc.S.me, Cc.S.me]);
  const names = A.S.W.owners.filter(o => o && !o.bot).map(o => o.name).sort();
  ok(JSON.stringify(names) === JSON.stringify(['Аня', 'Боря', 'Вика']), 'имена гостей дошли до хозяина' + tag, names);
  ok(Bc.S.G.owners[Cc.S.me]?.name === 'Вика', 'гость знает имена других (список участников)' + tag);
  // управление гостя двигает его клетку у хозяина
  const bi = Bc.S.me, ob = A.S.W.owners[bi];
  const x0 = ob.cx;
  Bc.S.setInput(Float64Array.from([1, 0, 0, 0, 0, 0]), clock.t);
  await tick(1500);
  ok(A.S.W.owners[bi].cx > x0 + 100 || A.S.W.owners[bi].cx > 1500, 'управление гостя двигает его клетку у хозяина' + tag, [x0, A.S.W.owners[bi].cx]);
  // деление гостя
  for (let k = 0; k < A.S.W.cN; k++) { const s = A.S.W.cL[k]; if (A.S.W.cO[s] === bi) A.S.W.cM[s] = 400; }
  Bc.S.setInput(Float64Array.from([1, 0, 1, 0, 0, 0]), clock.t);
  await tick(800);
  ok(A.S.W.oc[bi] >= 2, 'гость делится (пробел → у хозяина 2 клетки)' + tag, A.S.W.oc[bi]);
  let mineG = 0; for (let k = 0; k < Bc.S.G.cN; k++) if (Bc.S.G.cO[Bc.S.G.cL[k]] === bi) mineG++;
  ok(mineG >= 2, 'гость видит свои половинки' + tag, mineG);
  // сообщения через Supabase: без прямой связи — канал «-r» не чаще ~4/с на снимки + управление гостей
  const r0 = bus.byName.get('kletochki-io-test1-r') || 0, m0 = bus.byName.get('kletochki-io-test1') || 0;
  await tick(10000);
  const rps = ((bus.byName.get('kletochki-io-test1-r') || 0) - r0) / 10, mps = ((bus.byName.get('kletochki-io-test1') || 0) - m0) / 10;
  if (useNet) ok(rps < .5 && mps < .5, `напрямую: через Supabase почти ничего (${rps.toFixed(1)}/с)`, [rps, mps]);
  else ok(rps <= 4.2 * 3 && rps >= 3, `без прямой связи: через канал «-r» ${rps.toFixed(1)} сообщ./с на троих (снимки — одним сообщением)`, rps);
  ok(Bc.S.G.step > A.S.W.step - 60, 'гость не отстаёт от хозяина (снимки идут)' + tag, [Bc.S.G.step, A.S.W.step]);
  if (useNet) console.log(`  напрямую: ${(net.bytes / 1024 / ((clock.t - 100000) / 1000)).toFixed(1)} КБ/с от хозяина на 2 гостей`);
  // смена хозяина: свои клетки — новому хозяину (не больше, чем было)
  for (let k = 0; k < A.S.W.cN; k++) { const s = A.S.W.cL[k]; if (A.S.W.cO[s] === Cc.S.me) A.S.W.cM[s] = 300; }
  await tick(1200);
  const bMass = A.S.W.owners[bi].mass, cMass = A.S.W.owners[Cc.S.me].mass;
  A.S.leave();
  await tick(4500);
  ok(Bc.S.role === 'host' && Cc.S.role === 'guest', 'хозяин ушёл — хозяином стал следующий' + tag, [Bc.S.role, Cc.S.role]);
  const W2 = Bc.S.W;
  const nb = W2 && W2.owners[Bc.S.me], nc = W2 && Cc.S.me >= 0 ? W2.owners[Cc.S.me] : null;
  ok(nb && Math.abs(nb.mass - bMass) < bMass * .2 + 20, 'новый хозяин — со своей массой' + tag, [bMass, nb && nb.mass]);
  ok(nc && nc.alive && Math.abs(nc.mass - cMass) < cMass * .25 + 20, 'гость прислал себя новому хозяину — масса сохранилась' + tag, [cMass, nc && nc.mass]);
  ok(W2 && humansIn(W2) === 2 && botsIn(W2) === C.TOTAL - 2, 'новый хозяин: 2 человека + боты' + tag, W2 && [humansIn(W2), botsIn(W2)]);
  // приход и уход 8 раз — без зависаний и ошибок
  for (let k = 0; k < 8; k++) {
    const D = client('kd' + k, 'Гоша'); D.S.online('test1'); await tick(1500);
    D.S.leave(); await tick(700);
  }
  await tick(2000);
  ok(humansIn(W2) === 2 && botsIn(W2) === C.TOTAL - 2, 'после 8 приходов и уходов — снова 2 человека и боты' + tag, [humansIn(W2), botsIn(W2)]);
  ok(frameErr === 0 && !clock.errors, 'без ошибок в кадрах и таймерах' + tag, [frameErr, clock.errors]);
  ok(worstFrame < 60, `кадр без зависаний: худший ${worstFrame.toFixed(1)} мс (node)` + tag, worstFrame);
  for (const c of clients) c.S.leave();
  await tick(200);
}
// 11-й в комнату на 10 — «заполнена»; общая комната — следующая (pub2)
async function full(){
  const clock = makeClock(), bus = makeBus(clock);
  const list = [];
  for (let k = 0; k < 11; k++) {
    const S = K.session({ game: 'kletochki', sim: SIM, max: 10, me: { key: 'p' + k, nick: 'Игрок ' + k, skin: null, aspect: 1 }, open: bus.open, net: null, now: clock.now, pnow: clock.now, setT: clock.setT, clearT: clock.clearT, autoLoop: false });
    S.online('', { pub: true });
    list.push(S);
    for (let t = 0; t < 30; t++) { for (const s of list) s.frame(clock.t); await clock.run(clock.t + 16); }
  }
  for (let t = 0; t < 200; t++) { for (const s of list) s.frame(clock.t); await clock.run(clock.t + 16); }
  const codes = list.map(s => s.code);
  ok(codes.filter(c => c === 'pub1').length === 10 && codes[10] === 'pub2', '«▶ Играть»: 10 в первой общей комнате, 11-й — во второй', codes);
  ok(list[10].role === 'host', '11-й стал хозяином новой общей арены (с ботами)', list[10].role);
  for (const s of list) s.leave();
}
async function onlineAll(){ await online(false); await online(true); await full(); }
module.exports.hashW = hashW;
onlineAll().catch(e => { fail++; console.log('FAIL онлайн', e.stack); }).then(() => {
  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
});

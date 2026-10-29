// T-138 шаг 2 (ci-run: debris-test): обломки как твёрдые тела (D37E.debris, F4 = SH-R) — ядро без браузера.
//   node --expose-gc scripts/debris-test.cjs [--fast]
// Проверяет: падение и отскок (масса не влияет на падение), круглое катится по лестнице-склону и останавливается внизу, кубик на
// той же лестнице стоит, с края скалы — скатывается и падает вниз, у подножия стены не катится (нет ложного склона), толчок
// (blast) — лёгкое летит дальше тяжёлого (Δv = J/m), засыпает (событие SLEEP с клеткой), одинаково при 30 / 60 / 144 кадрах,
// бюджет чтений за такт (лишние ждут такт, не теряются), мусор за шаг (0 Б), пул полон — −1 (игра делает блок сразу).
const path = require('path');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis; globalThis.self = globalThis;
require(path.join(SITE, 'js/engine/debris.js'));
const DB = D37E.debris, ONE = DB.ONE;
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  ✗', msg, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sec = t => console.log('— ' + t);
const NUM = {};
const K = (x, y, z) => ((x + 512) * 1024 + (z + 512)) * 128 + (y + 64);   // < 2^30 — без «кучных» чисел в проверке
function world(){ const S = new Set(); S.add2 = (x, y, z) => S.add(K(x, y, z)); S.solid = (x, y, z) => S.has(K(x, y, z)); return S; }
function ground(S, r = 40, y = -1){ for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) S.add2(x, y, z); }
const run = (D, S, n) => { const evs = []; for (let t = 0; t < n; t++) { const k = D.tick(S.solid); for (let e = 0; e < k; e++) evs.push([t, D.ev[e * 5], D.ev[e * 5 + 1], D.ev[e * 5 + 2], D.ev[e * 5 + 3], D.ev[e * 5 + 4]]); } return evs; };
const P = { x: 0, y: 0, z: 0 };
const at = (x, y, z) => [DB.q(x), DB.q(y), DB.q(z)];

sec('падение, отскок, сон: масса не меняет падения; событие SLEEP — клетка, где лёг');
{ const S = world(); ground(S);
  const D = DB.world({ max: 8 });
  const a = D.add(...at(0.5, 10.5, 0.5), 0, 0, 0, 2400, 8, 0, 7), b = D.add(...at(3.5, 10.5, 0.5), 0, 0, 0, 40, 8, 0, 8);
  const evs = run(D, S, 160), sl = evs.filter(e => e[2] === 1), hit = i => (evs.find(e => e[1] === i && e[2] === 2) || [-1])[0];
  const tA = hit(a), tB = hit(b);
  ok(tA === tB && tA > 0 && tA < 30, 'тяжёлое и лёгкое падают одинаково (удар о землю на ' + tA + '-м такте с 10 клеток)', { tA, tB });
  const t0 = Math.sqrt(2 * 10 / 9.8) * 20; ok(Math.abs(tA - t0) <= 1.5, 'время падения ≈ √(2h/g) (' + t0.toFixed(1) + ' тактов)', tA);
  NUM.fall = { ticks: tA, theory: +t0.toFixed(1) };
  ok(sl.length === 2 && sl.every(e => e[4] === 0), 'оба заснули на земле (клетка y = 0)', sl);
  const hits = evs.filter(e => e[2] === 2).length; void hits;
  ok(D.live() === 0 && D.st[a] === 2, 'спящие не считаются (живых 0)', D.live());
  D.free(a); D.free(b); ok(D.st[a] === 0, 'D.free — слот свободен'); }

sec('склон-лестница: круглое катится вниз и останавливается на ровном; кубик на лестнице стоит');
const stairs = () => { const S = world(); ground(S, 40, -1); for (let x = -20; x < 0; x++) { const h = Math.min(8, -x); for (let y = 0; y < h; y++) for (let z = -3; z <= 3; z++) S.add2(x, y, z); } return S; };   // ступени: x = −8…−1 высота 8…1, дальше вниз — ровно
{ const S = stairs();
  const D = DB.world({ max: 8 });
  const r = D.add(...at(-6.5, 7 + 7 / 16, .5), 0, 0, 0, 650, 7, 1000, 1), c = D.add(...at(-6.5, 7 + 7 / 16, 2.5), 0, 0, 0, 2400, 7, 0, 2);
  const evs = run(D, S, 600), sl = evs.filter(e => e[2] === 1);
  const sr = sl.find(e => e[1] === r), sc = sl.find(e => e[1] === c);
  ok(sr && sr[3] >= 0 && sr[4] === 0, 'бревно (круглое) скатилось по лестнице с 7 ступеней и заснуло внизу (x = ' + (sr && sr[3]) + ')', sr);
  ok(sc && sc[3] === -7 && sc[4] === 7, 'кубик камня на ступени стоит (лестница 45° его не сносит)', sc);
  NUM.roll = { x: sr && sr[3], ticks: sr && sr[0], rolls: D.stats.rolls };
  ok(sr && sr[3] <= 14, 'катится не бесконечно (трение качения): остановилось в ' + (sr && sr[3]) + ' клетках от подножия', sr); }

sec('скала: с края катится и падает вниз; у подножия стены — не катится (нет ложного склона)');
{ const S = world(); ground(S, 40, -1); for (let x = -20; x <= 0; x++) for (let y = 0; y < 6; y++) for (let z = -3; z <= 3; z++) S.add2(x, y, z);   // плато x ≤ 0 высотой 6, обрыв на x = 1
  const D = DB.world({ max: 8 });
  const k = D.add(...at(.5, 6 + 7 / 16, .5), 0, 0, 0, 2400, 7, 0, 1);     // кубик у самого края
  const f = D.add(...at(-6.5, 6 + 7 / 16, .5), 0, 0, 0, 2400, 7, 0, 2);   // кубик посреди плато
  const w = D.add(...at(1.5, 7 / 16, .5), 0, 0, 0, 650, 7, 1000, 3);       // бревно у подножия стены
  const evs = run(D, S, 400), sl = evs.filter(e => e[2] === 1), sk = sl.find(e => e[1] === k), sf = sl.find(e => e[1] === f), sw = sl.find(e => e[1] === w);
  ok(sk && sk[4] === 0 && sk[3] >= 1, 'кубик у края скалы (обрыв 6) — скатился и лежит внизу', sk);
  ok(sf && sf[3] === -7 && sf[4] === 6, 'кубик посреди плато — стоит', sf);
  ok(sw && sw[3] === 1, 'бревно у подножия стены не катится от неё', sw);
  // центр над пустотой (кубик на краю держится углом) — переваливается вниз (правило края); центр над опорой — стоит
  const D2 = DB.world({ max: 4 }); D2.add(...at(1.1, 6 + 7 / 16, .5), 0, 0, 0, 2400, 7, 0, 1); D2.add(...at(-.5, 6 + 7 / 16, 2.5), 0, 0, 0, 2400, 7, 0, 2);
  const ev2 = run(D2, S, 300), s2 = ev2.find(x => x[2] === 1 && x[1] === 0), s3 = ev2.find(x => x[2] === 1 && x[1] === 1);
  ok(s2 && s2[4] === 0 && D2.stats.edges > 0, 'кубик центром над обрывом — перевалился через край и упал вниз', { s2, edges: D2.stats.edges });
  ok(s3 && s3[4] === 6 && s3[3] === -1, 'кубик в клетке от края плато — стоит', s3);
  NUM.cliff = { cube: sk && sk[3], pushed: s2 && s2[3], edges: D2.stats.edges }; }

sec('толчок: лёгкое летит дальше тяжёлого (Δv = J / m), спящее просыпается');
{ const S = world(); ground(S, 60, -1);
  const D = DB.world({ max: 8 });
  const L = D.add(...at(2.5, 7 / 16, .5), 0, 0, 0, 40, 7, 0, 1), H = D.add(...at(-2.5, 7 / 16, .5), 0, 0, 0, 2400, 7, 0, 2), F = D.add(...at(.5, 7 / 16, 6.5), 0, 0, 0, 40, 7, 0, 3);
  run(D, S, 20);
  ok(D.st[L] === 2 && D.st[H] === 2, 'лежат и спят');
  const J = 40 * DB.vq(8), n = D.blast(DB.q(.5), DB.q(0), DB.q(.5), J, 5);
  ok(n === 2, 'толчок радиусом 5 задел двоих (третий дальше)', n);
  const evs = run(D, S, 300), sL = evs.find(e => e[1] === L && e[2] === 1), sH = evs.find(e => e[1] === H && e[2] === 1);
  const dL = sL[3] - 2, dH = -2 - sH[3];
  ok(dL >= 3 && dH <= 1 && dL > dH, 'лёгкое (40 кг) улетело на ' + dL + ' клеток, тяжёлое (2400 кг) — на ' + dH, { dL, dH });
  NUM.blast = { light: dL, heavy: dH }; }

sec('одинаково при 30 / 60 / 144 кадрах (такт мира по накопителю кадров); бюджет; мусор');
const scene = (fps, reads, sec = 20) => {
  const S = stairs(); const D = DB.world({ max: 48, reads: reads || 1536 });
  for (let i = 0; i < 40; i++) D.add(DB.q(-7.5 + (i % 5) * .13), DB.q(9 + (i / 5 | 0) * 1.2), DB.q(-2.5 + (i % 7) * .7), DB.vq(((i * 37) % 11 - 5) * .4), 0, DB.vq(((i * 53) % 9 - 4) * .3), 300 + i * 50, 7, i & 1 ? 1000 : 0, i);
  let acc = 0, h = 2166136261, ticks = 0; const dt = 1 / fps, evs = [];
  for (let f = 0; f < fps * sec; f++) { acc += dt; while (acc >= .05 - 1e-9) { acc -= .05; ticks++; const n = D.tick(S.solid); for (let e = 0; e < n; e++) { evs.push(ticks, D.ev[e * 5], D.ev[e * 5 + 1], D.ev[e * 5 + 2], D.ev[e * 5 + 3]); if (D.ev[e * 5 + 1] === 1) D.free(D.ev[e * 5]); } h = Math.imul(h ^ D.hash(), 16777619); } }
  return { h: h >>> 0, ticks, evs: evs.join(','), D };
};
{ const a = scene(30), b = scene(60), c = scene(144);
  ok(a.h === b.h && b.h === c.h && a.evs === c.evs, '30 / 60 / 144 кадров — тот же ход (хеш ' + a.h + ')', [a.h, b.h, c.h]);
  NUM.traceHash = a.h;
  const tight = scene(60, 200, 60);
  ok(tight.D.stats.maxReads <= 200 && tight.D.stats.deferred > 0, 'бюджет 200 чтений за такт: худший такт ' + tight.D.stats.maxReads + ', отложено ' + tight.D.stats.deferred + ' (ждут такт)', tight.D.stats);
  const sleptAll = tight.evs.split(',').filter((v, i) => i % 5 === 2 && v === '1').length;
  ok(sleptAll === 40, 'при тесном бюджете все 40 всё равно легли (никто не потерян)', sleptAll);
  NUM.budget = { maxReads: a.D.stats.maxReads, tightMax: tight.D.stats.maxReads, deferred: tight.D.stats.deferred };
  const D = DB.world({ max: 4 }); for (let i = 0; i < 4; i++) D.add(0, DB.q(5), 0, 0, 0, 0, 10, 8, 0, 0);
  ok(D.add(0, DB.q(5), 0, 0, 0, 0, 10, 8, 0, 0) === -1 && D.stats.full === 1, 'пул полон — −1 (игра делает блок / вещь сразу)'); }
if (typeof gc === 'function') {
  const S = stairs(), D = DB.world({ max: 64, reads: 4096 }); const solid = S.solid;
  const refill = () => { for (let i = 0; i < 64; i++) if (!D.st[i]) D.add(DB.q(-7.5 + (i % 5) * .1), DB.q(12 + (i % 9)), DB.q(-2.5 + (i % 6) * .8), DB.vq(i % 3), 0, 0, 500 + i, 7, i & 1 ? 1000 : 0, i); };
  const round = () => { refill(); for (let t = 0; t < 50; t++) { const n = D.tick(solid); for (let e = 0; e < n; e++) if (D.ev[e * 5 + 1] !== 2) D.free(D.ev[e * 5]); } };
  for (let r = 0; r < 40; r++) round();   // прогрев (JIT: после пересборок кода — ровный режим)
  // три окна по 1000 тактов — берём меньшее (ровный режим: без пересборок кода JIT, они тоже в куче)
  let per = 1e9, us = 0;
  for (let w = 0; w < 3; w++) {
    gc(); const h0 = process.memoryUsage().heapUsed, t0 = performance.now();
    for (let r = 0; r < 20; r++) round();
    const t1 = performance.now(); gc(); const p = Math.max(0, process.memoryUsage().heapUsed - h0) / 1000;
    if (p < per) { per = p; us = (t1 - t0) * 1000; }
  }
  ok(per < 8, 'мусор за такт ' + per.toFixed(2) + ' Б (64 куска, 1000 тактов)', per);
  NUM.tick = { usPerTick64: +(us / 1000).toFixed(1), garbageBperTick: +per.toFixed(2) };
} else console.log('  (без --expose-gc мусор не меряется)');

sec('общее правило склона (для вещей игры): нужно падение вниз с той стороны');
{ const S = stairs(), O = {};
  DB.slope(S.solid, -4, 4, 0, true, O); ok(O.ax > 0 && O.s >= 2, 'на лестнице — вниз по +x', O);
  DB.slope(S.solid, -4, 4, 0, false, O); ok(O.ax === 0, 'кубику лестница 45° — не склон', O);
  DB.slope(S.solid, 5, 0, 0, true, O); ok(O.ax === 0 && O.az === 0, 'на ровном — ничего', O); }

console.log('цифры:', JSON.stringify(NUM));
console.log(`debris-test: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);

// Тесты «Червячков» (js/games/chervyachki.js + js/games/iokit.js) в node, без браузера:
//  1) формулы и правила (поворот, ускорение, край, еда, нокаут → огоньки, голова в голову, «призрак» после появления);
//  2) одинаковый мир при 30/60/144 кадрах;  3) боты 15 минут игры: без ошибок, раунды;  4) память за 20 раундов;
//  5) снимки: тело ключевым кадром, еда по разнице, сверка;  6) комната на подменной сети: хозяин, гости, смена хозяина, приход/уход.
// Запуск из корня сайта: node --expose-gc scripts/chervyachki-test.cjs [--fast]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SITE = path.join(__dirname, '..');
const FAST = process.argv.includes('--fast');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const ctx = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, Math, Date, JSON, btoa, atob, performance, ArrayBuffer, DataView, Uint8Array });
ctx.window = ctx; ctx.GAME_IMPL = {};
for (const f of ['js/games/iokit.js', 'js/games/chervyachki.js']) vm.runInContext(fs.readFileSync(path.join(SITE, f), 'utf8'), ctx, { filename: f });
const K = ctx.IoKit, T = ctx.GAME_IMPL.chervyachki._test, SIM = T.SIM, C = T.C;
const inp = (a, b = 0, em = 0, emId = 0) => Float64Array.from([a, b, em, emId]);

function hashW(W){
  const a = [W.step, W.round, W.phase, W.left, W.fN, W.rs];
  for (let i = 0; i < C.MAXO; i++) { const o = W.owners[i]; if (!o) { a.push(-1); continue; } a.push(i, o.alive ? 1 : 0, o.x, o.y, o.a, o.L, W.wn[i], W.wh[i]); }
  for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; a.push(W.fX[s], W.fY[s], W.fV[s]); }
  for (let p = 0; p < C.NP; p++) a.push(W.pAl[p] * 8 + W.pGen[p]);
  return K.hashNums(a);
}
function sane(W){
  for (let i = 0; i < C.MAXO; i++) {
    const o = W.owners[i];
    if (!o || !o.alive) continue;
    if (!isFinite(o.x) || !isFinite(o.y) || !isFinite(o.L) || o.L <= 0) return 'nan ' + i;
    if (o.x * o.x + o.y * o.y > (C.R + 1) * (C.R + 1)) return 'out ' + i;
    const base = i * C.MAXP;
    for (let k = 0; k < W.wn[i]; k++) { const s = base + ((W.wh[i] - k + C.MAXP) % C.MAXP); if (!isFinite(W.wx[s]) || W.wx[s] * W.wx[s] + W.wy[s] * W.wy[s] > (C.R + 30) * (C.R + 30)) return 'path ' + i; }
  }
  for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; if (!isFinite(W.fX[s]) || W.fX[s] * W.fX[s] + W.fY[s] * W.fY[s] > C.R * C.R) return 'food'; }
  return '';
}
// мир без ботов
function bare(seed){ const W = SIM.newWorld(seed); W.botWant = 0; return W; }
function addWorm(W, key, x, y, a, L){
  const i = SIM.addOwner(W, { key, name: key, bot: false, spawn: false });
  const o = W.owners[i];
  T.spawnOwner(W, o);
  // переставить: голова в (x, y), тело — прямо назад
  const n = Math.min(C.MAXP, Math.ceil(T.bodyLen(L) / C.SP) + 2), base = i * C.MAXP, ca = Math.cos(a), sa = Math.sin(a);
  for (let k = 0; k < n; k++) { W.wx[base + (n - 1 - k)] = x - ca * k * C.SP; W.wy[base + (n - 1 - k)] = y - sa * k * C.SP; }
  W.wh[i] = n - 1; W.wn[i] = n;
  o.x = o.hx0 = x; o.y = o.hy0 = y; o.a = a; o.inA = a; o.L = L; o.rw = T.rwOf(L); o.prot = 0; o.gotIn = true;
  SIM.setInput(W, i, inp(a));
  return i;
}

// ═══ 1. Формулы и правила ═══
{
  ok(T.rwOf(1000) > T.rwOf(100) && T.rwOf(100) > T.rwOf(10), 'толще с длиной');
  ok(T.bodyLen(1000) > T.bodyLen(100) && T.bodyLen(1e6) <= (C.MAXP - 4) * C.SP, 'длиннее с длиной, но не больше кольца точек');
  ok(T.turnOf(10) > T.turnOf(1000) && T.turnOf(1000) > T.turnOf(10000), 'длинный поворачивает медленнее');
  const W = SIM.newWorld(5);
  let inside = true; for (let p = 0; p < C.NP; p++) if (W.pAl[p] && W.pX[p] * W.pX[p] + W.pY[p] * W.pY[p] > C.R * C.R) inside = false;
  let alive = 0; for (let p = 0; p < C.NP; p++) alive += W.pAl[p];
  ok(inside && alive > 1000, 'огоньки — внутри круга, их много', alive);
  const i = SIM.addOwner(W, { key: 'u', name: 'Аня', bot: false, spawn: true });
  SIM.setHumans(W, 1);
  let bots = 0; for (const o of W.owners) if (o && o.bot) bots++;
  ok(bots === C.TOTAL - 1, 'ботов — до 14 участников', bots);
  SIM.setInput(W, i, inp(0)); SIM.step(W);
  const o = W.owners[i];
  ok(o.alive && o.L >= C.L0 && W.wn[i] > 5, 'червячок появился', [o.L, W.wn[i]]);
  ok(o.prot > W.step, 'после появления — «призрак» 2 с');
  // поворот не мгновенный
  const a0 = o.a; SIM.setInput(W, i, inp(a0 + Math.PI)); SIM.step(W);
  ok(Math.abs(T.wrapA(o.a - a0)) <= T.turnOf(o.L) / 30 + 1e-9, 'поворот — не быстрее, чем позволяет длина');
}
{
  // ускорение: тратит длину, позади — огоньки; короткий не ускоряется
  const W = bare(6);
  const i = addWorm(W, 'a', 0, 0, 0, 200);
  const L0 = W.owners[i].L, f0 = W.fN;
  SIM.setInput(W, i, inp(0, 1));
  for (let k = 0; k < 60; k++) SIM.step(W);
  const o = W.owners[i];
  ok(o.L < L0 - 3 && W.fN > f0, 'ускорение тратит длину и роняет огоньки', [L0, o.L, W.fN]);
  ok(Math.abs(o.x - 2 * C.BOOSTV) < 80, 'с ускорением — вдвое быстрее', o.x);
  const j = addWorm(W, 'b', 0, 600, 0, 12);
  SIM.setInput(W, j, inp(0, 1)); const x0 = W.owners[j].x;
  for (let k = 0; k < 30; k++) SIM.step(W);
  ok(W.owners[j].L >= 12 && Math.abs(W.owners[j].x - x0 - C.SPEED) < 30, 'короткий (< 16) не ускоряется', [W.owners[j].L, W.owners[j].x - x0]);
  // край: не выйти за круг
  const k2 = addWorm(W, 'c', C.R - 100, 0, 0, 50);
  SIM.setInput(W, k2, inp(0));
  for (let k = 0; k < 120; k++) SIM.step(W);
  const q = W.owners[k2];
  ok(q.alive && q.x * q.x + q.y * q.y <= (C.R - q.rw + .5) ** 2, 'край не убивает: червячок скользит вдоль', [q.alive, Math.hypot(q.x, q.y)]);
  // еда
  const W2 = bare(7);
  const e = addWorm(W2, 'e', 0, 0, 0, 50);
  T.fNew(W2, 30, 0, 9, 3, 900);
  for (let k = 0; k < 3; k++) SIM.step(W2);
  ok(W2.owners[e].L >= 58 && W2.fN === 0, 'съел огонёк — длиннее', [W2.owners[e].L, W2.fN]);
}
{
  // нокаут: голова в чужое тело → рассыпался на огоньки (≈ ¾ длины); кто «подрезал» — тот и победил
  const W = bare(8);
  const a = addWorm(W, 'a', 0, 0, 0, 400);              // тело тянется влево от (0, 0)
  const b = addWorm(W, 'b', -150, 120, -Math.PI / 2, 60);   // голова идёт вниз — в тело a
  W.ev.length = 0;
  let ko = null;
  for (let k = 0; k < 60 && !ko; k++) { SIM.step(W); ko = W.ev.find(x => x.k === 'ko'); }
  ok(ko && ko.o === b && ko.by === a, 'врезался головой в чужое тело — нокаут', ko);
  const tot = W.fN ? Array.from({ length: W.fN }, (_, k) => W.fV[W.fL[k]]).reduce((x, y) => x + y, 0) : 0;
  ok(!W.owners[b].alive && tot > 60 * .6 && tot < 60 * .9, 'рассыпался на огоньки ≈ ¾ длины', tot);
  ok(W.owners[a].kills === 1, 'подрезавшему — +1', W.owners[a].kills);
  // голова в голову: длинный побеждает
  const W2 = bare(9);
  const c = addWorm(W2, 'c', -100, 0, 0, 300), d = addWorm(W2, 'd', 100, 0, Math.PI, 60);
  W2.ev.length = 0;
  let k2 = null;
  for (let k = 0; k < 60 && !k2; k++) { SIM.step(W2); k2 = W2.ev.find(x => x.k === 'ko'); }
  ok(k2 && k2.o === d, 'голова в голову — короткий уступает', k2);
  // «призрак»: только появившийся проходит сквозь тела
  const W3 = bare(10);
  const e = addWorm(W3, 'e', 0, 0, 0, 400), f = addWorm(W3, 'f', -150, 120, -Math.PI / 2, 60);
  W3.owners[f].prot = W3.step + 60;
  W3.ev.length = 0;
  for (let k = 0; k < 40; k++) SIM.step(W3);
  ok(!W3.ev.some(x => x.k === 'ko') && W3.owners[f].alive, '«призрак» (2 с после появления) проходит насквозь');
}

// ═══ 2. Одинаково при 30 / 60 / 144 кадрах ═══
function runAtFps(fps, steps){
  const S = K.session({ game: 'chervyachki', sim: SIM, autoLoop: false, me: { key: 'me', nick: 'Тест', skin: null }, now: () => 0 });
  const orig = Math.random; let r = 4242; Math.random = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  S.offline();
  Math.random = orig;
  const ev = [];
  let t = 0, a = 0, b = 0, q = 999;
  const Rn = () => { q = (q * 48271) % 2147483647; return q / 2147483647; };
  while (t < steps * 1000 / 30) { t += 30 + Rn() * 300; a = Rn() * Math.PI * 2 - Math.PI; b = Rn() < .3 ? 1 : 0; ev.push([t + 1000, Float64Array.from([a, b, 0, 0])]); }
  let ei = 0, f = 0;
  S.setInput(Float64Array.from([0, 0, 0, 0]), 0);
  while (S.L.n < steps) {
    const now = 1000 + f * 1000 / fps;
    while (ei < ev.length && ev[ei][0] <= now) { S.setInput(ev[ei][1], ev[ei][0]); ei++; }
    S.frame(now);
    f++;
  }
  return S;
}
{
  const N = FAST ? 900 : 3600;
  const h = [30, 60, 144].map(fps => { const S = runAtFps(fps, N); return [hashW(S.W), S.W.step]; });
  ok(h.every(x => x[1] === N) && h[0][0] === h[1][0] && h[1][0] === h[2][0], `мир одинаковый при 30/60/144 FPS (${N} шагов, с ботами, ускорением и нокаутами)`, h);
}

// ═══ 3. Боты 15 минут игры ═══
{
  const W = SIM.newWorld(777);
  const hu = SIM.addOwner(W, { key: 'h', name: 'Гуляка', bot: false, spawn: true });
  SIM.setHumans(W, 1);
  const steps = (FAST ? 5 : 15) * 60 * 30;
  let err = null, ends = 0, starts = 0, kos = 0, bad = '', maxL = 0, lives = 0, lifeSum = 0, early = 0, hunted = 0, worst = 0;
  const t0 = process.hrtime.bigint();
  let ang = 0;
  for (let k = 0; k < steps; k++) {
    if (k % 75 === 0) ang = ((k * 2654435761) % 1000) / 1000 * Math.PI * 2;
    SIM.setInput(W, hu, inp(ang));
    const a = process.hrtime.bigint();
    try { SIM.step(W); } catch (e) { err = e; break; }
    const d = Number(process.hrtime.bigint() - a) / 1e6; if (d > worst) worst = d;
    for (const e of W.ev.splice(0)) {
      if (e.k === 'end') ends++; else if (e.k === 'start') starts++;
      else if (e.k === 'ko') {
        kos++;
        if (e.o === hu) {
          lives++; lifeSum += e.life; if (e.life < 5) early++;
          const kb = e.by >= 0 ? W.owners[e.by] : null;
          if (e.life < 20 && kb && kb.bot && kb.brain.huntT > 0 && kb.brain.prey === hu) hunted++;   // бот специально подрезал новичка
          SIM.respawn(W, hu);
        }
      }
    }
    if (k % 300 === 0) { const s = sane(W); if (s && !bad) bad = s; for (const o of W.owners) if (o && o.alive && o.L > maxL) maxL = o.L; }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(!err, 'боты: без ошибок', err && String(err.stack).slice(0, 400));
  ok(!bad, 'координаты — числа, всё внутри арены', bad);
  const expEnds = Math.floor(steps / (C.ROUND + C.END)) + (steps % (C.ROUND + C.END) >= C.ROUND ? 1 : 0);
  ok(ends === expEnds && starts >= ends - 1, `раунды кончаются и начинаются (${ends})`, [ends, starts, expEnds]);
  ok(kos > 15, 'червячки врезаются и рассыпаются', kos);
  ok(maxL > 150 && maxL < 30000, 'кто-то вырастает', Math.round(maxL));
  ok(hunted === 0, 'боты не охотятся на новичка (первые 20 с)', hunted);
  ok(early <= Math.max(1, lives * .2), 'гуляка редко врезается сразу после появления', [early, lives]);
  console.log(`  боты ${steps / 1800} мин: шаг в среднем ${(ms / steps).toFixed(3)} мс, худший ${worst.toFixed(2)} мс; нокаутов ${kos}; гуляка: ${lives} жизней, в среднем ${lives ? (lifeSum / lives).toFixed(0) : '-'} с; макс. длина ${Math.round(maxL)}`);
}

// ═══ 4. Память за 20 раундов ═══
if (typeof gc === 'function') {
  const W = SIM.newWorld(55);
  SIM.setHumans(W, 0);
  const per = FAST ? 400 : 1500;
  let h2 = 0;
  for (let r = 0; r < 20; r++) {
    for (let k = 0; k < per; k++) { SIM.step(W); W.ev.length = 0; }
    W.left = 1; SIM.step(W); W.ev.length = 0;
    while (W.phase === 1) { SIM.step(W); W.ev.length = 0; }
    if (r === 1) { gc(); h2 = process.memoryUsage().heapUsed; }
  }
  gc();
  const grow = (process.memoryUsage().heapUsed - h2) / 1048576;
  ok(W.round === 21 && grow < 1.5, `память не растёт за 20 раундов (${grow.toFixed(2)} МБ)`, [W.round, grow]);
}

// ═══ 5. Снимки ═══
{
  const W = SIM.newWorld(321);
  const me = SIM.addOwner(W, { key: 'g', name: 'Гость', bot: false, spawn: true });
  SIM.setHumans(W, 1);
  for (let k = 0; k < 1200; k++) { SIM.setInput(W, me, inp(Math.sin(k / 40) * 2)); SIM.step(W); W.ev.length = 0; if (!W.owners[me].alive) SIM.respawn(W, me); }
  const g = { aspect: 1.6, inTs: 777, hold: 3 };
  const G = SIM.mirror(null);
  let sum = 0, n = 0, maxB = 0, bodyOk = true, bodyChecks = 0;
  for (let k = 0; k < 900; k++) {
    SIM.setInput(W, me, inp(Math.sin(k / 40) * 2)); SIM.step(W); W.ev.length = 0;
    if (!W.owners[me].alive) SIM.respawn(W, me);
    if (k % 2) continue;
    const v = SIM.encode(W, me, g), buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    sum += buf.byteLength; n++; if (buf.byteLength > maxB) maxB = buf.byteLength;
    SIM.decode(G, buf, k * 33);
    // тело у гостя лежит на пути хозяина (каждая точка гостя — не дальше 2 от ломаной хозяина)
    if (k % 40 === 0) for (let j = 0; j < C.MAXO; j++) {
      if (!G.on[j] || !W.owners[j] || !W.owners[j].alive) continue;
      bodyChecks++;
      const base = j * 1024, hb = j * C.MAXP;
      let arc = 0, lx = G.qx[base + G.qh[j]], ly = G.qy[base + G.qh[j]];
      const bl = T.bodyLen(W.owners[j].L) - 12;
      for (let q = 0; q < Math.min(G.qn[j], 40); q++) {
        const s = base + ((G.qh[j] - q + 1024) % 1024), x = G.qx[s], y = G.qy[s];
        arc += Math.hypot(x - lx, y - ly); lx = x; ly = y;
        if (arc > bl) break;   // хвост у гостя может быть чуть длиннее (обрезается при рисовании)
        let best = 1e9;
        for (let p = 0; p < W.wn[j]; p++) { const t = hb + ((W.wh[j] - p + C.MAXP) % C.MAXP), d = Math.hypot(W.wx[t] - x, W.wy[t] - y); if (d < best) best = d; }
        const dh = Math.hypot(W.owners[j].x - x, W.owners[j].y - y);
        if (Math.min(best, dh) > 14) { bodyOk = false; break; }
      }
    }
  }
  ok(bodyChecks > 5 && bodyOk, 'тело у гостя — на пути хозяина (ключевые кадры + головы)', [bodyChecks, bodyOk]);
  ok(G.me === me && G.echoTs === 777, 'в снимке — «я» и эхо');
  // еда у гостя — та же, что у хозяина в виду
  const o = W.owners[me];
  let miss = 0, extra = 0;
  for (let k = 0; k < W.fN; k++) { const s = W.fL[k]; if (Math.abs(W.fX[s] - o.x) < 300 && Math.abs(W.fY[s] - o.y) < 300 && G.fMap[W.fId[s]] < 0) miss++; }
  for (let k = 0; k < G.fN; k++) { const s = G.fL[k]; if (Math.abs(G.fX[s] - o.x) < 300 && Math.abs(G.fY[s] - o.y) < 300) { let f = false; for (let q = 0; q < W.fN; q++) if (W.fId[W.fL[q]] === G.fId[s]) { f = true; break; } if (!f) extra++; } }
  ok(miss === 0 && extra === 0, 'рассыпанная еда у гостя совпадает с хозяином (новая и исчезнувшая)', [miss, extra]);
  ok(sum / n < 1500 && maxB < 6000, `снимок маленький: в среднем ${Math.round(sum / n)} Б, самый большой ${maxB} Б`, [sum / n, maxB]);
  // потерянные снимки: гость всё равно сходится (сверка раз в 30 снимков)
  let lost = 0;
  for (let k = 0; k < 400; k++) {
    SIM.setInput(W, me, inp(Math.cos(k / 50) * 2)); SIM.step(W); W.ev.length = 0;
    if (!W.owners[me].alive) SIM.respawn(W, me);
    if (k % 2) continue;
    const v = SIM.encode(W, me, g), buf = v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    if ((k / 2) % 3 === 1) { lost++; continue; }   // каждый третий теряется
    SIM.decode(G, buf, 1e5 + k * 33);
  }
  for (let k = 0; k < 64; k++) { SIM.step(W); W.ev.length = 0; if (k % 2) continue; const v = SIM.encode(W, me, g); SIM.decode(G, v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength), 2e5 + k * 33); }
  const o2 = W.owners[me];
  let ghost = 0;
  if (o2.alive) for (let k = 0; k < G.fN; k++) { const s = G.fL[k]; if (Math.abs(G.fX[s] - o2.x) < 250 && Math.abs(G.fY[s] - o2.y) < 250) { let f = false; for (let q = 0; q < W.fN; q++) if (W.fId[W.fL[q]] === G.fId[s]) { f = true; break; } if (!f) ghost++; } }
  ok(lost > 50 && ghost === 0, 'треть снимков потеряна — «призрачной» еды у гостя нет (сверка)', [lost, ghost]);
  const out = new Float64Array(4);
  ok(SIM.unpackIn([0, 0, ...SIM.packIn(inp(1.5, 1, 2, 3))], 2, out) && Math.abs(out[0] - 1.5) < .001 && out[1] === 1 && out[3] === 3, 'управление: упаковка туда-обратно');
  ok(SIM.unpackIn([0, 0, NaN, 1, 1, 1], 2, out) === null, 'мусорное управление — отказ');
  let threw = false; try { SIM.decode(G, new Uint8Array([2, 0, 255, 255, 255, 127]).buffer, 0); } catch (e) { threw = true; }
  ok(threw, 'обрезанный снимок — исключение (ловит сеанс)');
}

// ═══ 6. Комната ═══
const { makeClock, makeBus, makeNet } = require('./iogames-net.cjs');
async function online(useNet){
  if (typeof gc === 'function') gc();
  const tag = useNet ? ' (напрямую)' : ' (без прямой связи)';
  const clock = makeClock(), bus = makeBus(clock), net = useNet ? makeNet(clock) : null;
  const clients = [];
  let frameErr = 0, worst = 0;
  const client = (key, nick) => { const c = { key }; c.S = K.session({ game: 'chervyachki', sim: SIM, max: 10, me: { key, nick, skin: null, aspect: 1.6 }, open: bus.open, net, now: clock.now, pnow: clock.now, setT: clock.setT, clearT: clock.clearT, autoLoop: false }); clients.push(c); return c; };
  async function tick(ms){
    const end = clock.t + ms;
    while (clock.t < end) {
      const t = Math.min(end, clock.t + 16);
      for (const c of clients) if (!c.S.closed) { const a = process.hrtime.bigint(); try { c.S.frame(clock.t); } catch (e) { frameErr++; if (frameErr < 3) console.log(e.stack); } const d = Number(process.hrtime.bigint() - a) / 1e6; if (d > worst) worst = d; }
      await clock.run(t);
    }
  }
  const humans = W => W.owners.filter(o => o && !o.bot).length, botsN = W => W.owners.filter(o => o && o.bot && !o.retire).length;
  const A = client('ka', 'Аня'); A.S.online('w1'); await tick(600);
  const B = client('kb', 'Боря'); B.S.online('w1'); await tick(400);
  const Cc = client('kc', 'Вика'); Cc.S.online('w1'); await tick(4000);
  ok(A.S.role === 'host' && B.S.role === 'guest' && Cc.S.role === 'guest' && humans(A.S.W) === 3 && botsN(A.S.W) === C.TOTAL - 3, 'хозяин и 2 гостя, боты до 14' + tag, [A.S.role, humans(A.S.W), botsN(A.S.W)]);
  ok(B.S.G.ready && B.S.me >= 0 && B.S.G.on[B.S.me], 'гость видит своего червячка' + tag);
  // гость поворачивает — у хозяина червячок едет туда
  const bi = B.S.me, ob = A.S.W.owners[bi];
  B.S.setInput(Float64Array.from([Math.PI / 2, 0, 0, 0]), clock.t);
  await tick(1500);
  ok(ob.alive ? Math.abs(T.wrapA(ob.a - Math.PI / 2)) < .2 || Math.hypot(ob.x, ob.y) > C.R - 80 : true, 'управление гостя поворачивает его червячка у хозяина' + tag, ob.a);
  // ускорение гостя
  ob.L = 300;
  const L0 = ob.L;
  B.S.setInput(Float64Array.from([Math.PI / 2, 1, 0, 0]), clock.t);
  await tick(600);
  const sawBoost = ob.boost;
  await tick(400);
  ok(!ob.alive || (sawBoost && ob.spent >= 0), 'гость ускоряется (у хозяина — ускорение)' + tag, [L0, ob.L, sawBoost]);
  B.S.setInput(Float64Array.from([Math.PI / 2, 0, 0, 0]), clock.t);
  const r0 = bus.byName.get('chervyachki-io-w1-r') || 0;
  await tick(8000);
  const rps = ((bus.byName.get('chervyachki-io-w1-r') || 0) - r0) / 8;
  if (useNet) ok(rps < .5, `напрямую: через Supabase почти ничего (${rps.toFixed(1)}/с)`, rps);
  else ok(rps <= 13 && rps >= 3, `без прямой связи: канал «-r» ${rps.toFixed(1)} сообщ./с на троих`, rps);
  if (useNet) console.log(`  напрямую: ${(net.bytes / 1024 / ((clock.t - 100000) / 1000)).toFixed(1)} КБ/с от хозяина на 2 гостей`);
  // смена хозяина
  const bL = A.S.W.owners[bi].alive ? A.S.W.owners[bi].L : 0, ci = Cc.S.me, cL = A.S.W.owners[ci].alive ? A.S.W.owners[ci].L : 0;
  A.S.leave();
  await tick(4500);
  ok(B.S.role === 'host' && Cc.S.role === 'guest', 'хозяин ушёл — хозяином стал следующий' + tag, [B.S.role, Cc.S.role]);
  const W2 = B.S.W;
  const nb = W2 && W2.owners[B.S.me], nc = W2 && Cc.S.me >= 0 ? W2.owners[Cc.S.me] : null;
  ok(!bL || (nb && nb.alive && Math.abs(nb.L - bL) < bL * .25 + 15), 'новый хозяин — со своей длиной' + tag, [bL, nb && nb.L]);
  ok(!cL || (nc && nc.alive && Math.abs(nc.L - cL) < cL * .3 + 15), 'гость прислал себя — длина сохранилась' + tag, [cL, nc && nc.L]);
  for (let k = 0; k < 8; k++) { const D = client('kd' + k, 'Гоша'); D.S.online('w1'); await tick(1500); D.S.leave(); await tick(700); }
  await tick(2000);
  ok(W2 && humans(W2) === 2 && botsN(W2) === C.TOTAL - 2, 'после 8 приходов и уходов — 2 человека и боты' + tag, W2 && [humans(W2), botsN(W2)]);
  ok(frameErr === 0 && !clock.errors, 'без ошибок в кадрах и таймерах' + tag, [frameErr, clock.errors]);
  ok(worst < 80, `кадр без зависаний: худший ${worst.toFixed(1)} мс (node)` + tag, worst);
  for (const c of clients) c.S.leave();
  await tick(200);
}
(async () => {
  try { await online(false); await online(true); } catch (e) { fail++; console.log('FAIL онлайн', e.stack); }
  console.log(`${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
})();

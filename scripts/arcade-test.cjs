// Мини-игры на ArcadeKit (T-140, docs/ARCADE.md) — проверки в node без браузера:
//   1) один и тот же бот на 30 / 60 / 144 FPS → одинаковое состояние (хэш), шаги и счёт;
//   2) запись нажатий с «живыми» временами (между шагами) → повтор на 30 / 60 / 144 FPS → одинаково (время события → шаг);
//   3) один seed — одна игра (как у соперников в «⚔️ Соревновании»), разные seed — разные игры; Math.random в игре — ошибка;
//   4) сценарии игры (ожидаемый счёт, исправленные баги прототипа);
//   5) мусор: долгая партия с ботом (и рисованием на пустом холсте) под профилем выделений V8 — байт на шаг, время шага.
// Запуск из корня сайта: node scripts/arcade-test.cjs            — все игры js/games/arcade/*.js
//                        node scripts/arcade-test.cjs tiles,lights — только эти
// Новая игра: файл js/games/arcade/<id>.js + раздел в BOTS ниже (бот и сценарии) — без раздела игра проверяется только 1–3
// со «случайным пальцем» (нажатия по полю / по [data-k] 0…24 через равные промежутки).
const fs = require('fs'), path = require('path'), vm = require('vm'), inspector = require('inspector');
const session = new inspector.Session();
session.connect();
const post = (m, p = {}) => new Promise((res, rej) => session.post(m, p, (e, r) => (e ? rej(e) : res(r))));
const SITE = path.join(__dirname, '..');
const DIR = path.join(SITE, 'js/games/arcade');
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const FPS = [30, 60, 144];

// Ядро и игра — в «песочницу», как в браузере (window = глобальный объект). Math.random и Date в игре запрещены.
function load(id){
  const sb = { console, setTimeout, clearTimeout, performance: { now: () => 0 }, GAME_IMPL: {} };
  sb.window = sb;
  vm.createContext(sb);
  // свои Math и Date «песочницы» (встроенные — иначе JIT не встраивает Math.min и мерит лишний мусор)
  vm.runInContext("Math.random = () => { throw new Error('Math.random в игре — только rng из create(rng)'); };"
    + "Date.now = () => { throw new Error('Date в игре — время только в шагах'); };", sb);
  for (const f of ['core.js', id + '.js']) vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sb, { filename: 'js/games/arcade/' + f });
  const K = sb.ArcadeKit, impl = sb.GAME_IMPL[id];
  return { K, impl, spec: impl && impl._test.spec, sb };
}

// Пустой холст: те же методы, что у CanvasRenderingContext2D, ничего не рисуют, но считают вызовы и числовые аргументы
// (браузер, как и этот холст, «упаковывает» дробные числа на границе JS → canvas: 16 байт на число — это не мусор игры)
const CNT = { calls: 0, nums: 0 };
function stubG(spec){
  const noop = function (a, b, c, d, e){ CNT.calls++; CNT.nums += (typeof a === 'number') + (typeof b === 'number') + (typeof c === 'number') + (typeof d === 'number') + (typeof e === 'number'); };
  const grad = { addColorStop: noop };
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '', globalAlpha: 1, lineCap: '', lineJoin: '' };
  for (const m of ['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'drawImage', 'clip', 'setLineDash', 'roundRect']) ctx[m] = noop;
  ctx.createLinearGradient = ctx.createRadialGradient = () => grad;
  ctx.measureText = () => ({ width: 10 });
  return { ctx, W: spec.W, H: spec.H, theme: { text: '#fff', muted: '#888', accent: '#f25', card: '#111', bg: '#000', line: '#222', ok: '#2c5', bad: '#f77', gold: '#fd6' }, now: 0, dpr: 1 };
}

// ═══ Боты и сценарии по играм ═══
const BOTS = {
  tiles: {
    // gap — не чаще одного нажатия за gap шагов (10 → 6 нажатий в секунду: на скорости выше 6 рядов/с бот не успевает и проигрывает)
    bot(K, spec, gap = 10){
      const C = spec.consts, T = K.T;
      let last = -1e9;
      return (s, k, push) => {
        if (s.over || k - last < gap) return;
        const n = s.next, u = n + .5 - s.pos;
        if (u < 0 || u > 3.6) return;
        push(T.DOWN, (s.col[n & (C.RING - 1)] + .5) * C.CW, C.H - u * C.RH, 0);
        last = k;
      };
    },
    maxMs: 240000,
    garbage: { gap: 9, ms: 30 * 60 * 1000 },   // 9 → 6,7 нажатия в секунду: бот не проигрывает, полчаса игры
    scenarios(K, spec){
      const C = spec.consts, T = K.T, ev = { type: 0, x: 0, y: 0, k: 0, t: 0 };
      const tapAt = (s, c, u) => { ev.type = T.DOWN; ev.x = (c + .5) * C.CW; ev.y = C.H - (u - s.pos) * C.RH; spec.input(s, ev); };   // u — высота в рядах (абсолютная)
      const key = (s, c) => { ev.type = T.KEY; ev.k = c; spec.input(s, ev); };
      const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
      const colOf = (s, r) => s.col[r & (C.RING - 1)];
      const white = (s, r) => (colOf(s, r) + 1) % C.COLS;

      // баг владельца: «нажал — сразу конец». Нажатие на «СТАРТ» засчитано, игра идёт, пропуск — не раньше чем через ~1,2 с
      let s = spec.create(K.rng(11));
      ok(!s.started && s.pos === -1 && s.next === 0, 'tiles: старт — первая плитка во втором ряду, поле стоит');
      stepN(s, 120);
      ok(!s.over && s.pos === -1, 'tiles: до «СТАРТ» поле не едет и игра не кончается (2 с)');
      tapAt(s, white(s, 0), .5);
      ok(!s.over && !s.started, 'tiles: промах по белому до «СТАРТ» прощается');
      tapAt(s, colOf(s, 0), .5);
      ok(s.started && s.score === 1 && !s.over, 'tiles: нажатие на «СТАРТ» засчитано (+1), игра идёт', { score: s.score, over: s.over });
      stepN(s, 1);
      ok(!s.over, 'tiles: первый шаг после старта — не конец (баг прототипа: нижняя плитка у края считалась пропущенной)');
      let n = 1; while (!s.over) { spec.step(s, K.STEP, null); n++; }
      ok(s.why === 'miss' && n >= 70 && n <= 90, 'tiles: без нажатий — пропуск через ~1,3 с, а не сразу', { why: s.why, steps: n });

      // нажатие проверяет ряд, а не только дорожку
      s = spec.create(K.rng(12)); tapAt(s, colOf(s, 0), .5);
      tapAt(s, colOf(s, 1), .85);   // ниже плитки на 0,15 ряда (в запасе TOL) — попадание
      ok(s.score === 2 && !s.over, 'tiles: палец чуть ниже плитки (в запасе) — засчитано');
      const r3 = 3, c3 = colOf(s, r3);
      if (c3 !== colOf(s, 2)) { tapAt(s, c3, r3 + .5); ok(!s.over && s.score === 2, 'tiles: чёрная плитка не по порядку — без наказания и без очков'); }
      tapAt(s, colOf(s, 0), .5);
      ok(!s.over && s.score === 2, 'tiles: нажатие по пройденному ряду — не считается');
      // та же дорожка, что у следующей, но двумя рядами выше и там белое — конец (прототип засчитывал как попадание)
      let r = s.next + 2; while (colOf(s, r) === colOf(s, s.next)) r++;
      tapAt(s, colOf(s, s.next), r + .5);
      ok(s.over && s.why === 'white' && s.badR === r, 'tiles: дорожка верная, ряд — нет (белое выше) — конец', { why: s.why, badR: s.badR, r });

      // клавиатура: своя дорожка — попадание, чужая — белое
      s = spec.create(K.rng(13)); key(s, colOf(s, 0)); key(s, colOf(s, 1));
      ok(s.score === 2 && !s.over, 'tiles: клавиши D F J K — по дорожке следующего ряда');
      key(s, white(s, 2)); ok(s.over && s.why === 'white', 'tiles: не та клавиша — белая, конец');

      // счёт: 20 верных нажатий подряд = 20 + 2 × ⭐ (золотые — 3 очка)
      s = spec.create(K.rng(14)); let gold = 0;
      for (let i = 0; i < 40; i++) { if (s.gold[s.next & (C.RING - 1)]) gold++; tapAt(s, colOf(s, s.next), s.next + .5); stepN(s, 5); }
      ok(!s.over && s.hits === 40 && s.score === 40 + 2 * gold && s.golds === gold, 'tiles: счёт = плитки + 2 за каждую ⭐', { score: s.score, gold });
      // скорость — рядов в секунду: 1 с без нажатий после старта = V0 + DV·hits рядов
      s = spec.create(K.rng(15)); tapAt(s, colOf(s, 0), .5);
      const p0 = s.pos; stepN(s, 30);
      ok(Math.abs((s.pos - p0) - (C.V0 + C.DV) * .5) < 1e-9, 'tiles: за 0,5 с поле проехало (V0 + DV) × 0,5 ряда', s.pos - p0);
    },
  },

  lights: {
    // нажимает окна решения по одному раз в 20 шагов; каждое 7-е нажатие — лишнее окно (меньше ⭐, разнообразнее партии)
    bot(K, spec){
      const T = K.T;
      let last = -1e9, i = 0, house = -1, cnt = 0;
      return (s, k, push) => {
        if (s.over || s.wait || k - last < 20) return;
        if (s.house !== house) { house = s.house; i = 0; }
        last = k; cnt++;
        if (cnt % 7 === 0) { push(T.PICK, 0, 0, (s.sol[0] + 1) % (s.n * s.n)); push(T.PICK, 0, 0, (s.sol[0] + 1) % (s.n * s.n)); return; }   // туда-обратно
        if (i < s.par) push(T.PICK, 0, 0, s.sol[i++]);
      };
    },
    maxMs: 180000,
    garbage: { ms: 10 * 60 * 1000, repeat: true },
    scenarios(K, spec){
      const T = K.T, C = spec.consts, ev = { type: T.PICK, x: 0, y: 0, k: 0, t: 0 };
      const pick = (s, k) => { ev.type = T.PICK; ev.k = k; spec.input(s, ev); };
      const stepN = (s, n) => { for (let i = 0; i < n && !s.over; i++) spec.step(s, K.STEP, null); };
      const lit = s => { let c = 0; for (let i = 0; i < s.n * s.n; i++) c += s.g[i]; return c; };
      // идеальная ночь: решение из генератора (= норма) → 5 × 100, 5 ⭐, бонус за оставшиеся секунды
      let s = spec.create(K.rng(21));
      for (let h = 0; h < C.HOUSES.length; h++) {
        ok(s.house === h && s.n === C.HOUSES[h][0] && lit(s) > 0, 'lights: дом ' + (h + 1) + ' — сторона ' + C.HOUSES[h][0] + ', свет горит');
        stepN(s, 30);   // полсекунды «думает»
        for (let i = 0; i < s.par; i++) pick(s, s.sol[i]);
        ok(lit(s) === 0 && s.wait === C.WAIT, 'lights: решение генератора гасит дом ' + (h + 1));
        pick(s, 0); ok(lit(s) === 0, 'lights: пока дом засыпает, нажатия не считаются');
        stepN(s, C.WAIT);   // пауза «дом уснул» — часы стоят
      }
      const used = C.HOUSES.length * 30;   // шагов прошло вне пауз
      ok(s.over && s.solved === 5 && s.stars === 5 && s.score === 500 + 3 * Math.ceil((C.TIME - used) / 60), 'lights: 5 домов в норму — 500 + 3 × секунды', { score: s.score, stars: s.stars });
      ok(spec.win(s), 'lights: все дома — победа (XP)');
      // лишние нажатия: −10 за каждое сверх нормы, без ⭐
      s = spec.create(K.rng(22));
      pick(s, 0); pick(s, 0);
      for (let i = 0; i < s.par; i++) pick(s, s.sol[i]);
      ok(s.solved === 1 && s.stars === 0 && s.score === 80, 'lights: 2 лишних нажатия — 80 очков, без ⭐', { score: s.score });
      // время вышло — конец, счёт за решённое
      s = spec.create(K.rng(23)); stepN(s, C.TIME + 5);
      ok(s.over && s.score === 0 && s.left === 0, 'lights: 2 минуты без решения — утро, 0 очков');
      ok(!spec.win(s), 'lights: не успел — не победа');
      // генератор: 3000 ночей — каждый дом с горящим светом, решение = норма нажатий по разным окнам
      let bad = 0;
      for (let seed = 1; seed <= 3000; seed++) {
        const q = spec.create(K.rng(seed * 7919));
        for (let h = 0; h < C.HOUSES.length; h++) {
          const set = new Set(); for (let i = 0; i < q.par; i++) set.add(q.sol[i]);
          if (lit(q) === 0 || set.size !== q.par) bad++;
          for (let i = 0; i < q.par; i++) pick(q, q.sol[i]);
          if (lit(q) !== 0) bad++;
          stepN(q, C.WAIT);
        }
      }
      ok(bad === 0, 'lights: 3000 ночей — все дома решаются за норму', bad);
    },
  },
};

// «Случайный палец» для игр без своего бота: нажатия по сетке поля / [data-k] через равные промежутки (детерминированно)
function genericBot(K, spec){
  const T = K.T;
  let i = 0;
  return (s, k, push) => {
    if (s.over || k % 13) return;
    i = (i * 1103515245 + 12345) >>> 0;
    if (spec.kind === 'dom') push(T.PICK, 0, 0, i % 25);
    else push(T.DOWN, (i % 997) / 997 * spec.W, ((i >>> 10) % 991) / 991 * spec.H, 0);
  };
}

(async () => {
  const ids = fs.readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'core.js').map(f => f.slice(0, -3)).filter(id => !ONLY.length || ONLY.includes(id));
  const nums = [];
  for (const id of ids) {
    const t0 = Date.now();
    let L;
    try { L = load(id); } catch (e) { ok(false, id + ': файл грузится', e.message); continue; }
    const { K, spec } = L;
    ok(!!spec && typeof spec.create === 'function' && typeof spec.step === 'function' && typeof spec.draw === 'function', id + ': ArcadeKit.define с create / step / draw');
    if (!spec) continue;
    const B = BOTS[id] || {};
    const mkBot = (...a) => (B.bot ? B.bot(K, spec, ...a) : genericBot(K, spec));
    const G = spec.kind === 'dom' ? null : stubG(spec);
    const maxMs = B.maxMs || 120000;

    // 1) бот на 30 / 60 / 144 FPS
    const runs = FPS.map(fps => { try { const r = K.sim(spec, { seed: 777, fps, bot: mkBot(), maxMs, draw: G }); return { fps, h: K.hash(r.s), steps: r.steps, score: r.score, over: r.over }; } catch (e) { return { fps, err: e.message }; } });
    ok(runs.every(r => !r.err), id + ': партия с ботом без ошибок (и без Math.random / Date)', runs.find(r => r.err));
    ok(runs.every(r => r.h === runs[0].h && r.steps === runs[0].steps && r.score === runs[0].score), id + ': бот на 30 / 60 / 144 FPS — одинаковая партия', runs);
    ok(runs[0].score > 0 && runs[0].over, id + ': бот набирает очки и партия кончается', runs[0]);

    // 2) запись с временами между шагами → повтор без бота на 30 / 60 / 144 FPS
    const events = [];
    const rec = mkBot();
    let j = 0;
    K.sim(spec, { seed: 778, fps: 60, maxMs, bot: (s, k, push) => rec(s, k, (type, x, y, kk) => { j = (j * 69069 + 1) >>> 0; events.push({ t: (k + (j % 1000) / 1000 * .98) * K.STEP_MS, type, x, y, k: kk }); push(type, x, y, kk); }) });
    events.sort((a, b) => a.t - b.t);
    const reps = FPS.map(fps => { const r = K.sim(spec, { seed: 778, fps, events, maxMs }); return { fps, h: K.hash(r.s), steps: r.steps, score: r.score }; });
    ok(events.length > 5 && reps.every(r => r.h === reps[0].h && r.steps === reps[0].steps), id + ': повтор ' + events.length + ' нажатий (время между шагами) на 30 / 60 / 144 FPS — одинаково', reps);

    // 3) seed: как у двух соперников — одинаково; другой seed — другая игра
    const a = K.hash(spec.create(K.rng(4242), {})), b = K.hash(spec.create(K.rng(4242), {})), c = K.hash(spec.create(K.rng(4243), {}));
    const d1 = K.sim(spec, { seed: 99, fps: 60, bot: mkBot(), maxMs }), d2 = K.sim(spec, { seed: 99, fps: 144, bot: mkBot(), maxMs });
    ok(a === b && a !== c && K.hash(d1.s) === K.hash(d2.s), id + ': один seed — одна игра у обоих соперников, другой seed — другая');

    // 4) сценарии
    if (B.scenarios) { try { B.scenarios(K, spec); } catch (e) { ok(false, id + ': сценарии без ошибок', e.stack.split('\n').slice(0, 3).join(' | ')); } }
    else console.log('  (' + id + ': своих сценариев нет — добавь раздел в BOTS scripts/arcade-test.cjs)');

    // 5) мусор: прогрев (JIT), потом долгие партии под профилем выделений памяти (V8 sampling heap profiler, включая уже
    // собранное). Считаем байты, выделенные кодом игры и ядра на шаг; подготовка партии (create, Runner, Queue) и сама
    // «песочница» sim с ботом не считаются — это раз в партию / только в тесте.
    //   a) логика (input + step + цикл ядра) без рисования — строго: < 8 байт на шаг (8 ≈ одно «упакованное» дробное число
    //      JIT-ом на два шага; объект, массив, замыкание или строка на шаг — это 24+ байт);
    //   b) рисование на пустом холсте (только canvas-игры): не больше «упаковки» числовых аргументов canvas (16 байт на число,
    //      так же и в браузере) + 64 байта на кадр — значит, своих объектов и строк на кадр нет.
    const GB = B.garbage || { ms: 10 * 60 * 1000 };
    const gbot = () => (B.bot ? B.bot(K, spec, GB.gap) : genericBot(K, spec));
    const SETUP = new Set(['sim', 'push', 'before', 'after', 'Runner', 'Queue', 'create']);
    const measure = async draw => {
      for (let w = 0; w < 2; w++) K.sim(spec, { seed: 5 + w, fps: 60, bot: gbot(), maxMs: 30000, draw });
      CNT.calls = CNT.nums = 0;
      await post('HeapProfiler.enable');
      await post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
      const c0 = process.hrtime.bigint();
      let steps = 0, frames = 0;
      // DOM-игры кончаются быстро — несколько партий подряд
      do { const r = K.sim(spec, { seed: 6 + steps, fps: 60, bot: gbot(), maxMs: GB.ms, draw }); steps += r.steps; frames += r.frames; } while (GB.repeat && steps < GB.ms / K.STEP_MS);
      const ms = Number(process.hrtime.bigint() - c0) / 1e6;
      const { profile } = await post('HeapProfiler.stopSampling');
      let game = 0, core = 0;
      (function walk(nd){
        const u = nd.callFrame.url || '', f = nd.callFrame.functionName;
        if (!SETUP.has(f)) { if (u.endsWith('arcade/' + id + '.js')) game += nd.selfSize; else if (u.endsWith('arcade/core.js')) core += nd.selfSize; }
        for (const ch of nd.children) walk(ch);
      })(profile.head);
      return { steps, frames, ms, game: game / steps, core: core / steps, nums: CNT.nums / Math.max(1, frames), calls: CNT.calls / Math.max(1, frames) };
    };
    const L1 = await measure(null);
    ok(L1.game < 8 && L1.core < 8, id + ': логика без мусора (игра и ядро < 8 байт на шаг)', { game: +L1.game.toFixed(2), core: +L1.core.toFixed(2), steps: L1.steps });
    let L2 = null;
    if (G) {
      L2 = await measure(G);
      const extra = L2.game - L1.game - 16 * L2.nums;
      ok(extra < 64, id + ': рисование без своих объектов и строк на кадр (сверх упаковки чисел для canvas < 64 байт)', { drawBytes: +(L2.game - L1.game).toFixed(1), canvasNums: +L2.nums.toFixed(1), extra: +extra.toFixed(1) });
    }
    const steps = L1.steps, perStep = L1.game, corePer = L1.core, ms = (L2 || L1).ms;
    nums.push(`${id}: ${steps} шагов (${(steps / 3600).toFixed(1)} мин игры) — логика: игра ${perStep.toFixed(2)} байт/шаг, ядро ${corePer.toFixed(2)} байт/шаг` + (L2 ? `; рисование: ${L2.calls.toFixed(0)} вызовов canvas, ${(L2.game - L1.game).toFixed(0)} байт/кадр (числа для canvas)` : '') + `; ${(ms * 1000 / steps).toFixed(2)} мкс/шаг${G ? ' с рисованием' : ''}; бот: счёт ${runs[0].score}, ${runs[0].steps} шагов; ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  }
  for (const n of nums) console.log('  ' + n);
  console.log(`arcade-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

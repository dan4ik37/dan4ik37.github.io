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
// Боты и сценарии — у каждой игры свой файл scripts/arcade/<id>.cjs (docs/ARCADE.md): { bot(K, spec, gap) → (s, step, push),
// maxMs, garbage: { gap, ms, repeat }, scenarios(K, spec, ok), e2e: {…} } — общий скрипт при новой игре не правится.
const BOTS = new Proxy({}, { get: (_, id) => { const f = path.join(__dirname, 'arcade', String(id) + '.cjs'); return fs.existsSync(f) ? require(f) : undefined; } });

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
    if (B.scenarios) { try { B.scenarios(K, spec, ok); } catch (e) { ok(false, id + ': сценарии без ошибок', e.stack.split('\n').slice(0, 3).join(' | ')); } }
    else console.log('  (' + id + ': своих сценариев нет — добавь scripts/arcade/' + id + '.cjs)');

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

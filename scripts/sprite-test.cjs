// Проверка 2D-персонажа (js/core/char2d.js) без браузера:
//   node scripts/sprite-test.cjs                 — логика: хеш и ключи кэша, кадры по времени, стороны и зеркала, LRU памяти
//   node scripts/sprite-test.cjs <путь к three>   — плюс настоящий человечек (world3d.js + three@0.149): позы детерминированы,
//                                                   цикл замкнут, клетки и якоря на всех видах, точки кисти, все стили
// THREE_PATH в окружении — то же, что второй аргумент.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('  ✗ ' + msg); } };
const section = s => console.log('• ' + s);

// ── Окружение браузера (минимум) ──
function fakeCtx(){
  const noop = () => {};
  return new Proxy({ canvas: null, globalAlpha: 1, imageSmoothingEnabled: true, measureText: () => ({ width: 10 }), getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) },
    { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => { o[k] = v; return true; } });
}
function fakeCanvas(){ const c = { width: 300, height: 150, style: {}, getContext: () => { const g = fakeCtx(); g.canvas = c; return g; }, addEventListener(){}, toBlob(cb){ cb(null); }, toDataURL: () => '' }; return c; }
const store = {};
const win = {
  devicePixelRatio: 2, console, Math, JSON, Date, Promise, setTimeout, clearTimeout, Map, Set, Float32Array, Uint8Array, Uint8ClampedArray, Array, Object, String, Number, Proxy,
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem(){} },
  document: { createElement: () => fakeCanvas(), body: { classList: { contains: () => false } }, head: { appendChild(){} } },
};
win.window = win;
const ctx = vm.createContext(win);
const run = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
run('js/core/avatar.js');
run('js/core/char2d.js');
const S = win.D37Sprite, X = S._test, D = win.D37Char;

// ═══ 1. Хеш и ключи кэша ═══
section('хеш и ключи кэша');
ok(X.hash('abc') === X.hash('abc'), 'хеш стабилен');
ok(X.hash('abc') !== X.hash('abd'), 'хеш различает строки');
ok(Number.isSafeInteger(X.hash('привет 🎮')), 'хеш — целое до 2^53');
ok(X.hash('d37') === 8223268824777537, 'хеш не поменялся между версиями (снимок значения: ' + X.hash('d37') + ')');
const full = { color: 'red', body: 'girl', tone: 't3', hgt: '2', wid: '2', head: '2', eyec: 'blue', brows: 'soft', lash: 'yes', cheek: 'blush', hair: 'bob', hairc: 'pink', top: 'hoodie', trim: 'auto', bottom: 'jeans', botc: 'denim', shoes: 'kedy', shoec: 'white', hatc: 'auto', glasses: 'none', glassc: 'auto', neck: 'none', neckc: 'auto', back: 'none', backc: 'auto' };
const shuffled = Object.fromEntries(Object.entries(full).reverse());
ok(X.lookSig(full, 'a') === X.lookSig(shuffled, 'b'), 'порядок полей образа не важен; все части человечка есть — ключ игрока не нужен');
ok(X.lookSig({ color: 'red' }, 'a') !== X.lookSig({ color: 'red' }, 'b'), 'не хватает частей — подпись зависит от ключа игрока (их выберет отпечаток)');
ok(X.lookSig({ color: 'red', junk: 1, hat: 'nope' }, 'a') === X.lookSig({ color: 'red' }, 'a'), 'мусор и несуществующие части не влияют');
const O = o => X.opts({ dpr: 2, lo: false, style: 'toon', ...o });
const k0 = X.sheetKey(full, O({}));
ok(/^v\d+-[0-9a-z]+$/.test(k0), 'вид ключа: v<версия>-<хеш>');
ok(k0 === X.sheetKey(shuffled, O({})), 'одинаковый образ — один ключ');
for (const [name, o] of Object.entries({ вид: { view: 'iso8' }, размер: { size: 96 }, стиль: { style: 'pixel' }, плотность: { dpr: 1 }, 'без предмета': { noItem: true }, 'все стороны': { full: true }, тень: { shadow: true }, слабый: { lo: true } }))
  ok(X.sheetKey(full, O(o)) !== k0, 'ключ меняется: ' + name);
ok(X.sheetKey({ ...full, item: 'sword' }, O({ noItem: true })) === X.sheetKey({ ...full, item: 'rose' }, O({ noItem: true })), 'noItem: предмет в руке не влияет на ключ');
ok(X.sheetKey(full, O({ anims: ['idle'] })) === X.sheetKey(full, O({ anims: ['walk', 'run'] })), 'список анимаций не в ключе (лист допекается)');

// ═══ 2. Размеры ═══
section('размеры и пиксель-арт');
{
  const a = O({ size: 64 }), b = O({ size: 64, style: 'pixel' }), c = O({ size: 48, dpr: 1, style: 'retro' });
  ok(Math.abs(a.ppu * S.STD - 128) < 1e-9, 'size 64 при dpr 2 → 128 px на стандартный рост');
  ok(Number.isInteger(b.f) && b.f >= 1 && Math.abs(b.ppu * b.f * S.STD - b.dev) < 1e-6, '16-бит: целый множитель увеличения, ppu·f·STD = пиксели экрана');
  ok(c.f === 2 && Math.round(c.ppu * S.STD) === 24, '8-бит: 48 px → арт ростом 24 px ×2');
  ok(X.opts({ size: 5 }).size === 16 && X.opts({ size: 9999 }).size === 256, 'размер ограничен 16…256');
  ok(X.opts({ view: 'нет' }).view === 'side' && X.opts({ view: 'iso8' }).view === 'iso8', 'неизвестный вид → сбоку');
  ok(X.opts({ view: 'side' }).shadow === false && X.opts({ view: 'iso4' }).shadow === true, 'тень по умолчанию: сверху есть, сбоку нет');
}

// ═══ 3. Кадры по времени: ровно один цикл на n кадров ═══
section('кадры по времени');
for (const [name, A] of Object.entries(S.ANIMS)) {
  for (const lo of [false, true]) {
    const n = X.nFrames(A, lo);
    ok(n >= 1, name + ': есть кадры');
    let okSeq = true;
    for (let i = 0; i < n; i++) if (S.frameIndex(A, n, (i + .5) * A.dur / n) !== i) okSeq = false;
    ok(okSeq, `${name}${lo ? ' (слабый)' : ''}: кадр i — в своей доле цикла`);
    if (A.loop) {
      ok(S.frameIndex(A, n, A.dur) === 0 && S.frameIndex(A, n, A.dur * 3 + 1e-4) === 0, name + ': после цикла — снова первый кадр');
      ok(X.kOf(A, 0, n) === 0 && X.kOf(A, n - 1, n) < 1, name + ': доли цикла [0, 1) — последний кадр не повторяет первый');
    } else {
      ok(S.frameIndex(A, n, A.dur * 5) === n - 1, name + ': разовая держит последний кадр');
      ok(n < 2 || (X.kOf(A, 0, n) === 0 && X.kOf(A, n - 1, n) === 1), name + ': разовая — от начала до конца');
    }
  }
  ok(S.frameIndex(A, X.nFrames(A), -3) === 0, name + ': отрицательное время — первый кадр');
}
ok(Object.keys(S.ANIMS).length >= 14, 'все анимации на месте: ' + Object.keys(S.ANIMS).join(', '));

// ═══ 4. Стороны и зеркала ═══
section('стороны');
const d8 = [[0, 1, 0], [1, 1, 1], [1, 0, 2], [1, -1, 3], [0, -1, 4], [-1, -1, 5], [-1, 0, 6], [-1, 1, 7]];
for (const [x, y, d] of d8) ok(S.dir8(x, y) === d, `dir8(${x}, ${y}) = ${d}`);
ok(S.dir8(0, 0, 5) === 5, 'стоит на месте — сторона прежняя');
ok(S.dir4(1, .3) === 2 && S.dir4(-.2, -1) === 4 && S.dir4(-1, .1) === 6 && S.dir4(.1, 1) === 0, 'dir4 → 0/2/4/6');
for (let d = 0; d < 8; d++) {
  const [r, fl, left] = X.rowOf('iso8', false, d), baked = S.VIEWS.iso8.bake[r];
  ok((fl ? (8 - baked) % 8 : baked) === d, `iso8: сторона ${d} = строка ${r}${fl ? ' зеркально' : ''}`);
  ok(left === (d >= 5 && d <= 7), `iso8: сторона ${d} — ${left ? 'влево' : 'не влево'}`);
  ok(!fl || [1, 2, 3].includes(d), `iso8: зеркалим только правые стороны (${d})`);
  const [r2, fl2] = X.rowOf('iso8', true, d);
  ok(!fl2 && S.VIEWS.iso8.full[r2] === d, `iso8 (все стороны): сторона ${d} без зеркала`);
  const [r4, f4] = X.rowOf('iso4', false, d), b4 = S.VIEWS.iso4.bake[r4], want = (Math.round(d / 2) * 2) % 8;
  ok((f4 ? (8 - b4) % 8 : b4) === want, `iso4: сторона ${d} → ${want}`);
}
ok(X.rowOf('side', false, 6)[2] === true && X.rowOf('side', false, 6)[1] === false && X.rowOf('side', false, 2)[1] === true && X.rowOf('side', false, 2)[2] === false, 'сбоку: печём «влево», вправо — зеркало');
ok(X.rowOf('side', false, 2, true)[2] === true && X.rowOf('side', false, 6, false)[2] === false, 'сбоку: flip (true — влево) побеждает dir');
ok(X.rowOf('side', true, 2)[1] === false && X.rowOf('side', true, 2)[0] === 1, 'сбоку без зеркала: правая сторона — своя строка');
{
  const tr = S.VIEWS.iso8.turn, y = d => X.yawOf('iso8', d), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  ok(y(0) === 0 && Math.abs(y(4) - Math.PI) < 1e-9, 'к нам и от нас — ровно 0° и 180°');
  ok(Math.abs(y(2) - (Math.PI / 2 - tr)) < 1e-9, 'в профиль — чуть повёрнут к камере');
  let sym = true; for (let d = 1; d < 4; d++) if (Math.abs(wrap(y(d)) + wrap(y(8 - d))) > 1e-9) sym = false;
  ok(sym, 'стороны 5…7 — зеркало сторон 3…1 (поворот симметричен)');
  let mono = true; for (let d = 0; d < 4; d++) if (!(y(d + 1) > y(d))) mono = false;
  ok(mono, 'стороны 0…4 идут по порядку');
}
ok(X.yawOf('side', 2, 'climb') === Math.PI, 'сбоку лестница — спиной к нам');

// ═══ 5. Раскладка клетки ═══
section('раскладка клетки');
for (const ppu of [12.3, 37, 49.23]) {
  const R = { x0: -.7, x1: .8, y0: -.2, y1: 2.5 }, L = X.layout(R, .05, .0, ppu, 3);
  ok(Number.isInteger(L.ax) && Number.isInteger(L.ay) && L.ax > 0 && L.ay > 0 && L.ax < L.cw && L.ay < L.ch, 'якорь — целый пиксель внутри клетки (ppu ' + ppu + ')');
  ok((.05 - L.left) * ppu - L.ax < 1e-6 && (L.top - 0) * ppu - L.ay < 1e-6, 'камера совпадает с якорем');
  ok(L.left <= R.x0 && L.left + L.cw / ppu >= R.x1 && L.top >= R.y1 && L.top - L.ch / ppu <= R.y0, 'все границы влезают');
}

// ═══ 6. Память: LRU по байтам, закреплённые не вытесняются ═══
section('память (LRU)');
{
  X.BK.gl = false;   // без WebGL — листы «запасные», печь не трогаем
  S.budget(1);       // 1 МБ
  const mk = (name, pin) => { const o = X.opts({ view: 'side', size: 64, dpr: 1, pin }); const sh = X.ensure({ color: name }, o, 'k-' + name); sh.fallback = false; return sh; };
  const fakeAnim = kb => ({ img: { width: 1, height: 1 }, cw: 16, ch: kb * 16, n: 1, rows: 1, ax: 8, ay: 8, hand: new Float32Array(3) });   // 16·16·kb·4 = kb КБ
  const a = mk('red', true), b = mk('blue'), c = mk('green');
  X.commit(a, 'idle', fakeAnim(400)); X.commit(b, 'idle', fakeAnim(400));
  ok(S.stats().bytes === 800 * 1024, 'байты считаются: 800 КБ');
  b.used = -1e9; X.mem.delete(b.k); X.mem.set(b.k, b);   // b — использован последним по порядку, но...
  X.commit(c, 'idle', fakeAnim(400));                   // 1200 КБ > 1 МБ → вытесняем самый давний незакреплённый
  ok(!a.dead, 'закреплённый (свой) лист не вытеснен');
  ok(b.dead !== c.dead, 'вытеснен ровно один незакреплённый');
  ok(S.stats().bytes <= 1048576, 'после вытеснения — в бюджете');
  const left = [...X.mem.values()].filter(s => !s.dead).map(s => s.look.color);
  ok(left.includes('red'), 'в памяти остался свой');
  X.drop(a); X.drop(b); X.drop(c);
  ok(S.stats().bytes === 0 && S.stats().sheets === 0, 'всё освобождено');
  S.budget(64);
}

// ═══ 7. Стили и выбор игрока ═══
section('стили');
ok(S.STYLE_LIST.length >= 5 && S.STYLE_LIST.length <= 7, 'стилей 5–7: ' + S.STYLE_LIST.join(', '));
ok(S.styleFor('pixel') === 'pixel' && S.myStyle() === 'auto', 'без выбора игрока — стиль игры');
S.setMyStyle('sketch');
ok(S.styleFor('pixel') === 'sketch', 'выбор игрока в гардеробе побеждает');
S.setMyStyle('auto');
ok(S.styleFor('нет') === 'toon', 'неизвестный стиль → «Мультик»');

// ═══ 8. Песочница «Студии игр»: проверка данных хозяином (cleanPlayer) и D37.drawPlayer в игре — те же кадры, что у D37Sprite ═══
section('песочница «Студии игр»');
{
  const html = fs.readFileSync(path.join(ROOT, 'studio/frame.html'), 'utf8').replace(/\r\n/g, '\n');
  const cut = (from, to) => { const i = html.indexOf(from), j = html.indexOf(to, i); return i >= 0 && j > i ? html.slice(i, j) : ''; };
  const harnessSrc = cut('function harness(', '\n  // ═══ Хозяин песочницы'), cleanSrc = cut('function cleanPlayer(', '\n  const sendPlayer');
  ok(harnessSrc.length > 1000 && cleanSrc.length > 300, 'код песочницы найден в studio/frame.html');
  // фальшивый лист: 3 анимации, сбоку (печётся «влево»)
  const sh = { anims: {}, view: 'side', full: false, nom: 100, px: false, top: 90, pet: '🐶', size: 64 };
  const fake = (n, rows, cw, ch) => ({ img: { width: cw * n, height: ch * rows }, cw, ch, ax: 20, ay: 70, n, rows, hand: new Float32Array(n * rows * 3).fill(1) });
  sh.anims.idle = fake(4, 1, 40, 80); sh.anims.walk = fake(8, 1, 44, 82); sh.anims.jump = fake(2, 1, 50, 90);
  const pk = S.pack(sh, ['idle', 'walk', 'jump']);
  ok(pk && pk.meta.anims.walk.y === 80 && pk.meta.anims.jump.y === 162 && pk.canvas.width === 352, 'атлас: анимации друг под другом');
  const hctx = vm.createContext({ console, Math, JSON, Number, Object, Array, String, isFinite, setTimeout, clearTimeout });
  vm.runInContext(cleanSrc + '; this.cleanPlayer = cleanPlayer;', hctx);
  const good = { src: 'data:image/png;base64,iVBORw0KGgo=', meta: JSON.parse(JSON.stringify(pk.meta)), pet: '🐶', color: '#ff8800' };
  const cp = hctx.cleanPlayer(good);
  ok(cp && cp.meta.anims.walk.n === 8 && cp.meta.view === 'side' && cp.meta.dirs[0] === 6, 'хозяин принимает правильного персонажа');
  ok(cp && !('hand' in cp.meta.anims.walk) && !('top' in cp.meta), 'в игру уходят только нужные числа');
  for (const [why, bad] of Object.entries({
    'ссылка вместо data URL': { ...good, src: 'https://evil.example/x.png' },
    'javascript:': { ...good, src: 'javascript:alert(1)' },
    'svg (может нести скрипт)': { ...good, src: 'data:image/svg+xml;base64,PHN2Zz4=' },
    'кавычки в data URL': { ...good, src: 'data:image/png;base64,AAA"onerror="x' },
    'нет таблицы кадров': { ...good, meta: null },
    'огромная картинка': { ...good, src: 'data:image/png;base64,' + 'A'.repeat(4.1e6) },
  })) ok(hctx.cleanPlayer(bad) === null, 'хозяин отклоняет: ' + why);
  const weird = hctx.cleanPlayer({ ...good, color: 'red;}', pet: 'x'.repeat(50), meta: { ...good.meta, view: '<script>', anims: { ...good.meta.anims, 'Bad-Key': { n: 3 }, walk: { ...good.meta.anims.walk, n: 1e9, cw: -5, dur: 'abc' } } } });
  ok(weird && weird.color === '' && weird.pet.length <= 12 && weird.meta.view === 'side' && !weird.meta.anims['Bad-Key'], 'странные поля вычищены');
  ok(weird && weird.meta.anims.walk.n === 64 && weird.meta.anims.walk.cw === 1 && weird.meta.anims.walk.dur === .01, 'числа зажаты в разумные пределы');
  // игра: harness с этим персонажем → D37.drawPlayer
  const calls = [];
  const rec = { save(){}, restore(){}, translate(x, y){ this.tx = x; this.ty = y; }, scale(x){ this.sx = x; }, drawImage(...a){ calls.push({ a, sx: this.sx || 1, tx: this.tx, ty: this.ty }); this.sx = 1; }, globalAlpha: 1, imageSmoothingEnabled: true };
  class Img { set src(v){ this._s = v; setTimeout(() => this.onload && this.onload(), 0); } get src(){ return this._s; } }
  const gwin = { console, Math, JSON, Number, Object, Array, String, isFinite, setTimeout, clearTimeout, Image: Img, performance: win.performance, listeners: {},
    addEventListener(t, f){ (this.listeners[t] = this.listeners[t] || []).push(f); }, parent: { postMessage(){} }, document: { documentElement: { style: {} }, body: { style: {} }, createElement: () => fakeCanvas() } };
  gwin.window = gwin;
  const gctx = vm.createContext(gwin);
  vm.runInContext('(' + harnessSrc + ')(1, {}, ' + JSON.stringify(cp) + ');', gctx);
  const D = gwin.D37;
  ok(D && typeof D.drawPlayer === 'function' && D.player && D.player.ready === false, 'в игре есть D37.player и D37.drawPlayer (пока картинка грузится — не готов)');
  ok(D && D.drawPlayer(rec, 'walk', 0, 0, 0) === false, 'не готов — drawPlayer возвращает false (игра рисует эмодзи)');
  setTimeout(() => {
    ok(D.player.ready && D.player.pet === '🐶' && D.player.anims.join() === 'idle,walk,jump', 'картинка загрузилась — персонаж готов');
    const shs = { ...sh, dead: false, fallback: false, jobs: new Set(), want: new Set(), loading: true };   // loading — не просить допечь
    let same = true;
    for (const [anim, t, flip] of [['walk', 0, false], ['walk', .2, false], ['walk', .37, true], ['idle', 1.3, true], ['jump', 5, false], ['run', .1, false]]) {
      calls.length = 0;
      D.drawPlayer(rec, anim, t, 100, 200, { h: 50, flip });
      const F = S.frame(shs, anim, t, undefined, flip), A = sh.anims[F.anim], my = calls[0];
      if (!my || my.a[1] !== F.sx || my.a[2] !== pk.meta.anims[F.anim].y + F.sy || my.a[3] !== A.cw || (my.sx < 0) !== F.flip) { same = false; console.log('   ', anim, t, flip, my && my.a.slice(1, 5), F.sx, F.sy, F.flip); }
      if (my && Math.abs(my.a[5] + A.ax * 50 / 100) > 1e-9) same = false;   // якорь — ноги в (x, y) при росте h
    }
    ok(same, 'drawPlayer в игре берёт те же кадры и то же зеркало, что D37Sprite.frame на сайте');
    ok(calls.length === 1, 'нет «run» — рисуется «walk», нет анимации совсем — idle (как на сайте)');
    // поздняя доставка: сообщение от хозяина
    const late = { ...cp, pet: '🐱' };
    const say = (src, run) => gwin.listeners.message.forEach(f => f({ source: src, data: { __d37p: run, player: late } }));
    say(gwin.parent, 2);
    setTimeout(() => {
      ok(D.player.pet === '🐶', 'чужой номер запуска — персонаж не меняется');
      say({ fake: 1 }, 1);
      setTimeout(() => {
        ok(D.player.pet === '🐶', 'сообщение не от хозяина — не принимается');
        say(gwin.parent, 1);
        setTimeout(() => { ok(D.player.pet === '🐱', 'хозяин прислал персонажа позже — игра его подхватила'); wantTest(part3); }, 5);
      }, 5);
    }, 5);
  }, 5);
}
// Анимацию попросили, пока лист читается из IndexedDB, — она не теряется, а встаёт в очередь после чтения
function wantTest(next){
  section('просьбы, пока читается кэш');
  X.BK.gl = true;
  const o = X.opts({ view: 'side', size: 64, dpr: 1, anims: ['idle'] });
  const sh = X.ensure({ color: 'teal' }, o, 'k-want');
  ok(!!sh.loading, 'лист читается из кэша');
  S.frame(sh, 'walk', 0);   // кадров нет — просит допечь
  ok(sh.want.has('walk') && !sh.jobs.has('walk'), 'просьба, пока читается кэш, запомнена');
  sh.loading.then(() => {
    ok(sh.jobs.has('walk') && sh.jobs.has('idle'), 'после чтения кэша — в очереди и idle, и запрошенное');
    let res = false; sh.waiters.push({ anim: 'walk', res: () => { res = true; } });
    X.drop(sh); X.BK.gl = false;
    ok(res, 'вытеснили лист — ждущие не зависают');
    next();
  });
}
function part3(){
// ═══ 9. Настоящий человечек (если дан путь к three@0.149) ═══
const TP = process.argv[2] || process.env.THREE_PATH;
if (TP) {
  const cjs = path.join(TP, 'build/three.cjs');
  win.THREE = require(fs.existsSync(cjs) ? cjs : TP);
  section('настоящий человечек (three r' + win.THREE.REVISION + ')');
  run('js/games/world3d.js');
  X.W3._useKit(win.THREE);
  X.BK.gl = true;
  const T = win.THREE;
  const looks = [
    { name: 'обычный', look: full, key: 'a' },
    { name: 'по отпечатку', look: { color: 'blue' }, key: 'u:123' },
    { name: 'VIP', look: { ...full, color: 'rainbow', hairc: 'rainbow', hat: 'headphones', back: 'dragon', item: 'trophy', pet: 'dragon', trail: 'rainbow' }, key: 'v' },
    { name: 'свои цвета', look: { ...full, color: 'xff8800', tone: 'x8d5524', hairc: 'x00ffaa', hair: 'afro', hat: 'party', glasses: 'star', back: 'wings', item: 'balloon', hgt: '4', head: '4' }, key: 'c' },
    { name: 'малыш', look: { ...full, hgt: '0', wid: '4', head: '0', top: 'dress', hair: 'twintails', back: 'cape', item: 'sword' }, key: 'd' },
  ];
  const bones = ch => ['body', 'torso', 'headP', 'legL', 'legR', 'armL', 'armR'].map(b => ch[b]);
  const snap = ch => { ch.root.updateMatrixWorld(true); return bones(ch).map(b => b ? Array.from(b.matrixWorld.elements).map(v => Math.round(v * 1e5)) : []).flat().join(','); };
  let planned = 0, t0 = Date.now();
  for (const L of looks) {
    const ch = X.W3.build(L.look, L.key);
    ok(ch && ch.root && bones(ch).every(Boolean), L.name + ': кости на месте');
    // детерминизм и замкнутость цикла
    for (const [anim, A] of Object.entries(S.ANIMS)) {
      const sh = { view: 'iso8', style: 'toon', full: false, lo: false };
      const n = X.nFrames(A);
      X.posed(ch, anim, A, 1 % n, n, sh, 2); const s1 = snap(ch);
      X.posed(ch, anim, A, 0, n, sh, 2);
      X.posed(ch, anim, A, 1 % n, n, sh, 2); const s2 = snap(ch);
      ok(s1 === s2, `${L.name} · ${anim}: одна и та же поза при повторе`);
      // эмоция: вес в world3d растёт первые 0,15 с и спадает последние 0,25 с — все кадры цикла должны быть в полном весе
      const EDUR = { '💃': 3.2, '🤔': 2.4, '🙇': 1.9, '🤸': 1.15, '👏': 1.8 }, edur = A.emo ? EDUR[A.emo] || 1.6 : 0;
      if (A.emo && A.loop) ok(.16 + (n - 1) / n * A.dur <= edur - .25 + 1e-9, `${L.name} · ${anim}: все кадры эмоции — в полном весе`);
      const closable = !A.emo || .16 + A.dur <= edur - .25;   // точка k = 1 (её не рисуем) ещё в полном весе — можно сравнить с k = 0
      if (A.loop && n > 1 && closable) {
        // δ — чуть после начала: у танца на самой границе рука «перещёлкивается» (так задумано в world3d)
        const dl = 1e-6;
        X.W3.pose(ch, anim, 1 + dl, A, S.STYLES.toon); ch.root.rotation.set(0, Math.PI / 2, 0); const e = snap(ch);
        X.W3.pose(ch, anim, dl, A, S.STYLES.toon); ch.root.rotation.set(0, Math.PI / 2, 0); const b = snap(ch);
        ok(e === b, `${L.name} · ${anim}: конец цикла = начало (цикл замкнут)`);
        X.W3.pose(ch, anim, .25, A, S.STYLES.toon); const m = snap(ch);
        ok(anim === 'sit' || m !== b, `${L.name} · ${anim}: в четверти цикла поза другая (анимация есть)`);
      }
    }
    // план всех видов и стилей
    for (const view of Object.keys(S.VIEWS)) for (const style of ['toon', 'pixel', 'retro', 'chibi']) {
      const o = X.opts({ view, style, size: 64, dpr: 2, lo: false, key: L.key });
      const sh = { k: 'test', look: L.look, key: L.key, view, style, ppu: o.ppu, lo: false, full: false, shadow: o.shadow };
      for (const anim of view === 'side' ? Object.keys(S.ANIMS) : ['idle', 'walk', 'wave']) {
        const P = X.plan(sh, anim, ch);
        planned++;
        const okCell = P.cw > 4 && P.ch > 4 && P.ax > 0 && P.ax < P.cw && P.ay > 0 && P.ay <= P.ch && P.cw < 2000 && P.ch < 2000;
        ok(okCell, `${L.name} · ${view} · ${style} · ${anim}: клетка ${P.cw}×${P.ch}, якорь (${P.ax}, ${P.ay})`);
        // каждая поза влезает в клетку (то же, что увидит камера)
        let inside = true;
        const hand = new Float32Array(P.rows * P.n * 3);
        for (let r = 0; r < P.rows; r++) for (let i = 0; i < P.n; i++) {
          X.posed(ch, anim, P.A, i, P.n, sh, P.dirs[r]);
          const R = X.rectOf(ch.root, P.inv, { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
          if ((R.x0 - P.left) * o.ppu < -.01 || (P.left + P.cw / o.ppu - R.x1) * o.ppu < -.01 || (P.top - R.y1) * o.ppu < -.01 || (R.y0 - (P.top - P.ch / o.ppu)) * o.ppu < -.01) inside = false;
          X.handOf(ch, P, o.ppu, hand, (r * P.n + i) * 3);
        }
        ok(inside, `${L.name} · ${view} · ${style} · ${anim}: все кадры в клетке`);
        ok(Array.from(hand).every(Number.isFinite) && Array.from(hand).some(v => v !== 0), `${L.name} · ${view} · ${anim}: точки кисти есть`);
        if (anim === 'idle' && style === 'toon') {
          // кисть в покое — сбоку от тела и ниже головы: |x| < ширины клетки, y — над ногами
          const hy = hand[1];
          ok(hy < 0 && -hy < P.ay, `${L.name} · ${view}: кисть между ногами и макушкой (${hy})`);
        }
        if (anim === 'sit') ok(P.seat > 0 && P.seat < P.ay, `${L.name}: сиденье ниже макушки (${P.seat} px)`);
      }
    }
    // стороны: якорь общий для всех сторон, клетка у iso8 шире/равна iso4 по сторонам
    const oS = X.opts({ view: 'iso8', size: 64, dpr: 1, style: 'toon' });
    const P8 = X.plan({ view: 'iso8', style: 'toon', ppu: oS.ppu, lo: false, full: false, shadow: true }, 'walk', ch);
    const P8f = X.plan({ view: 'iso8', style: 'toon', ppu: oS.ppu, lo: false, full: true, shadow: true }, 'walk', ch);
    ok(P8.rows === 5 && P8f.rows === 8, 'iso8: 5 строк с зеркалом, 8 — без');
    // зеркало клетки вокруг якоря покрывает настоящие стороны 5…7 (человечек почти симметричен: ±3 px — предмет в руке)
    const half = Math.max(P8.ax, P8.cw - P8.ax);
    ok(Math.max(P8f.ax, P8f.cw - P8f.ax) <= half + 3 && Math.abs(P8f.ch - P8.ch) <= 3 && P8f.ay === P8.ay, `iso8: зеркальные стороны влезают в зеркало клетки (${P8.cw}×${P8.ch} / ${P8f.cw}×${P8f.ch})`);
    X.W3.dispose(ch);
  }
  // чиби: голова больше, ноги на земле
  {
    const ch = X.W3.build(full, 'a'), A = S.ANIMS.idle;
    X.W3.pose(ch, 'idle', 0, A, S.STYLES.toon); ch.root.updateMatrixWorld(true);
    const B0 = new T.Box3().setFromObject(ch.root), hs0 = new T.Vector3(); ch.headP.getWorldScale(hs0);
    X.W3.pose(ch, 'idle', 0, A, S.STYLES.chibi); ch.root.updateMatrixWorld(true);
    const B1 = new T.Box3().setFromObject(ch.root), hs1 = new T.Vector3(); ch.headP.getWorldScale(hs1);
    ok(hs1.x > hs0.x * 1.2, 'чиби: голова крупнее');
    ok(Math.abs(B1.min.y - B0.min.y) < .06, `чиби: ноги на земле (${B0.min.y.toFixed(3)} → ${B1.min.y.toFixed(3)})`);
    ok(B1.max.y < B0.max.y + .3, 'чиби: не выше обычного заметно');
    X.W3.pose(ch, 'idle', 0, A, S.STYLES.toon); ch.root.updateMatrixWorld(true);
    ok(Math.abs(new T.Box3().setFromObject(ch.root).max.y - B0.max.y) < 1e-6, 'после чиби обычный стиль — как был (масштабы не копятся)');
    X.W3.dispose(ch);
  }
  console.log(`  планов: ${planned}, ${Date.now() - t0} мс`);
} else console.log('• настоящий человечек — пропущен (дай путь к node_modules/three@0.149 вторым аргументом)');

console.log(`\n${fail ? '❌' : '✅'} sprite-test: ${pass} проверок прошло${fail ? `, ${fail} — нет` : ''}`);
process.exit(fail ? 1 : 0);
}

// Тесты скриптов на C++ и Rust (WebAssembly) для «Студии 3D»: ABI «d37» в песочнице runtime() без браузера.
// 1) модуль, собранный вручную (свой мини-ассемблер ниже) — ABI проверяется даже без компиляторов;
// 2) C++ — настоящим clang из npm @yowasp/clang (тот же, что грузит сайт; флаги и разбор ошибок — из js/engine/lang-wasm.js);
// 3) Rust — настоящим cargo (шаблон sdk/rust-template и примеры).
// Запуск из корня сайта: node scripts/lang-wasm-test.cjs
// Где искать компиляторы: D37_CLANG (папка пакета @yowasp/clang) — иначе %TEMP%/d37-wasm/clang/node_modules/@yowasp/clang;
// D37_CARGO — иначе ~/.cargo/bin/cargo. Нет компилятора — эта часть пропускается (сказано в итоге). Сборки — во временной папке.
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os'), cp = require('child_process');
const { pathToFileURL } = require('url');
const SITE = path.join(__dirname, '..');
globalThis.window = globalThis;
for (const f of ['script', 'lang-wasm']) vm.runInThisContext(fs.readFileSync(path.join(SITE, 'js/engine', f + '.js'), 'utf8'), { filename: f + '.js' });
delete globalThis.window;
const E = globalThis.D37E;
let pass = 0, fail = 0;
const notes = [];
const ok = (cond, name, extra) => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = p => fs.readFileSync(path.join(SITE, p), 'utf8').replace(/\r\n/g, '\n');
const b64 = u8 => Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString('base64');

// ═══ Песочница: та же runtime() из script.js, языки — текстом, как в SH.start ═══
const part = (id, name, extra = {}) => ({ id, cls: 'Part', parent: null, p: { name, shape: 'block', pos: [0, 1, 0], size: [4, 1, 2], rot: [0, 0, 0], color: '#a3a2a5', mat: 'plastic', alpha: 0, collide: true, anchored: true, shadow: true, ...extra } });
function sandbox({ objs = [], scripts, players = [{ id: 'me', name: 'Тест', pos: [1, 2, 3] }] }){
  const msgs = [];
  const ctx = vm.createContext({ postMessage: m => msgs.push(JSON.parse(JSON.stringify(m))), onmessage: null, setTimeout, clearTimeout, setInterval, clearInterval, console, TextDecoder, TextEncoder, atob, btoa, performance, crypto: globalThis.crypto });
  vm.runInContext('(' + E.scripts.runtime.toString() + ')()', ctx);
  const libs = {};
  for (const s of scripts) if (s.lang && s.lang !== 'js' && !libs[s.lang] && E.langs[s.lang].worker) libs[s.lang] = '(' + E.langs[s.lang].worker.toString() + ')();';
  const send = d => ctx.onmessage({ data: d });
  send({ t: 'init', objs, scripts, players, libs });
  const S = {
    msgs, send,
    of: t => msgs.filter(m => m.t === t),
    errors: () => msgs.filter(m => m.t === 'error'),
    prints: () => msgs.filter(m => m.t === 'print' && m.kind === 'log').map(m => m.text),
    warns: () => msgs.filter(m => m.t === 'print' && m.kind === 'warn').map(m => m.text),
    player: c => msgs.filter(m => m.t === 'player' && (!c || m.cmd === c)),
    sets: (id, k) => msgs.filter(m => m.t === 'set' && m.id === id && (!k || m.k === k)),
    clear(){ msgs.length = 0; },
    ev: (ev, d = {}) => send({ t: 'ev', ev, player: 'me', ...d }),
    tick: dt => send({ t: 'tick', dt, players: [{ id: 'me', pos: [1, 2, 3] }] }),
  };
  return S;
}
const wasmScript = (code, lang = 'cpp', parent = 'a', name = 'скрипт') => ({ name, parent, lang, code: typeof code === 'string' ? code : b64(code) });

// ═══ Мини-ассемблер WebAssembly (только то, что нужно тестам) ═══
const leb = n => { const o = []; n >>>= 0; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const sleb = n => { const o = []; n |= 0; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } };
const utf8 = s => [...Buffer.from(s, 'utf8')];
const wname = s => { const b = utf8(s); return [...leb(b.length), ...b]; };
const wvec = items => [...leb(items.length), ...items.flat()];
const section = (id, body) => [id, ...leb(body.length), ...body];
const i32 = 0x7f, f64 = 0x7c;
const op = {
  call: i => [0x10, ...leb(i)], i32: v => [0x41, ...sleb(v)], f64: v => [0x44, ...new Uint8Array(new Float64Array([v]).buffer)],
  lget: i => [0x20, ...leb(i)], gget: i => [0x23, ...leb(i)], gset: i => [0x24, ...leb(i)], lset: i => [0x21, ...leb(i)],
  drop: [0x1a], eq: [0x46], add: [0x6a], fadd: [0xa0], fmul: [0xa2], if: [0x04, 0x40], end: [0x0b], unreachable: [0x00], loop: [0x03, 0x40], br: d => [0x0c, ...leb(d)],
};
// imports: [[имя, [параметры], [результаты]]] (модуль "d37"); funcs: [{ exp, params, results, locals, body(f) }], f(имя) — номер функции
function assemble({ imports = [], funcs = [], globals = [], data = [], pages = 1 }){
  const types = [], tix = (p, r) => { const k = p.join() + '>' + r.join(); let i = types.findIndex(t => t.k === k); if (i < 0) { i = types.length; types.push({ k, b: [0x60, ...wvec(p.map(x => [x])), ...wvec(r.map(x => [x]))] }); } return i; };
  const names = imports.map(x => x[0]).concat(funcs.map(f => f.exp || f.name));
  const fi = n => { const i = names.indexOf(n); if (i < 0) throw new Error('нет функции ' + n); return i; };
  const imp = imports.map(([n, p, r, mod]) => [...wname(mod || 'd37'), ...wname(n), 0x00, ...leb(tix(p, r))]);
  const fn = funcs.map(f => leb(tix(f.params || [], f.results || [])));
  const code = funcs.map(f => { const body = [...wvec((f.locals || []).map(t => [1, t])), ...f.body(fi, op), 0x0b]; return [...leb(body.length), ...body]; });
  const glob = globals.map(([t, v]) => [t, 1, ...(t === f64 ? op.f64(v) : op.i32(v)), 0x0b]);
  const exp = [[...wname('memory'), 0x02, 0x00], ...funcs.map((f, i) => f.exp ? [...wname(f.exp), 0x00, ...leb(imports.length + i)] : null).filter(Boolean)];
  const dat = data.map(([off, s]) => [0x00, ...op.i32(off), 0x0b, ...wvec(utf8(s).map(b => [b]))]);
  return new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0,
    ...section(1, wvec(types.map(t => t.b))), ...section(2, wvec(imp)), ...section(3, wvec(fn)), ...section(5, wvec([[0x00, ...leb(pages)]])),
    ...(glob.length ? section(6, wvec(glob)) : []), ...section(7, wvec(exp)), ...section(10, wvec(code)), ...(dat.length ? section(11, wvec(dat)) : [])]);
}
const blen = s => Buffer.byteLength(s, 'utf8');

async function main(){
  // ═══ 1. Ручной модуль: весь путь ABI ═══
  {
    const S1 = 'привет из wasm', S2 = 'Монеты', S3 = 'Открыть', S4 = 'таймер', S5 = 'tick';
    const IM = [['print', [i32, i32], []], ['script', [], [i32]], ['set3', [i32, i32, f64, f64, f64], []], ['on_touched', [i32, i32], [i32]],
      ['prompt', [i32, i32, i32, f64, i32], [i32]], ['want_update', [i32], []], ['delay', [f64, i32], [i32]], ['stat_add', [i32, i32, i32, f64], []],
      ['on_clicked', [i32, i32], [i32]], ['on_touch_ended', [i32, i32], [i32]], ['set', [i32, i32, f64], []], ['player_name', [i32, i32, i32], [i32]],
      ['random', [], [f64]], ['event_target', [], [i32]], ['every', [f64, i32], [i32]], ['cancel', [i32], []]];
    const G_H = 0, G_ACC = 1, G_EVERY = 2, G_N = 3, G_P = 4;
    const wasm = assemble({
      imports: IM, pages: 1,
      globals: [[i32, 0], [f64, 0], [i32, 0], [i32, 0], [i32, 0]],
      data: [[16, S1], [64, S2], [96, S3], [128, S4], [160, S5]],
      funcs: [
        { exp: 'd37_start', body: (f, o) => [
          ...o.i32(16), ...o.i32(blen(S1)), ...o.call(f('print')),
          ...o.call(f('script')), ...o.gset(G_H),
          ...o.gget(G_H), ...o.i32(0), ...o.f64(1), ...o.f64(2), ...o.f64(3), ...o.call(f('set3')),
          ...o.gget(G_H), ...o.i32(1), ...o.call(f('on_touched')), ...o.drop,
          ...o.gget(G_H), ...o.i32(96), ...o.i32(blen(S3)), ...o.f64(0.5), ...o.i32(2), ...o.call(f('prompt')), ...o.drop,
          ...o.i32(1), ...o.call(f('want_update')),
          ...o.f64(0.02), ...o.i32(3), ...o.call(f('delay')), ...o.drop,
          ...o.gget(G_H), ...o.i32(4), ...o.call(f('on_clicked')), ...o.drop,
          ...o.gget(G_H), ...o.i32(5), ...o.call(f('on_touch_ended')), ...o.drop,
          ...o.f64(0.06), ...o.i32(6), ...o.call(f('delay')), ...o.drop,
          ...o.f64(0.08), ...o.i32(7), ...o.call(f('delay')), ...o.drop,
          ...o.f64(0.01), ...o.i32(8), ...o.call(f('every')), ...o.gset(G_EVERY),
          ...o.f64(0.09), ...o.i32(9), ...o.call(f('delay')), ...o.drop,
        ] },
        { exp: 'd37_event', params: [i32, i32], body: (f, o) => [
          // 1 — касание: очко, имя игрока в «Вывод», прозрачность у event_target
          ...o.lget(0), ...o.i32(1), ...o.eq, ...o.if,
          ...o.lget(1), ...o.gset(G_P),
          ...o.lget(1), ...o.i32(64), ...o.i32(blen(S2)), ...o.f64(1), ...o.call(f('stat_add')),
          ...o.i32(512), ...o.lget(1), ...o.i32(512), ...o.i32(64), ...o.call(f('player_name')), ...o.call(f('print')),
          ...o.call(f('event_target')), ...o.i32(9), ...o.f64(0.5), ...o.call(f('set')),
          ...o.end,
          // 2 — [E]: красный цвет
          ...o.lget(0), ...o.i32(2), ...o.eq, ...o.if, ...o.gget(G_H), ...o.i32(3), ...o.f64(1), ...o.f64(0), ...o.f64(0), ...o.call(f('set3')), ...o.end,
          // 3 — таймер
          ...o.lget(0), ...o.i32(3), ...o.eq, ...o.if, ...o.i32(128), ...o.i32(blen(S4)), ...o.call(f('print')), ...o.end,
          // 4 — клик: строка по чужому адресу → ошибка, не падение
          ...o.lget(0), ...o.i32(4), ...o.eq, ...o.if, ...o.i32(0x7fff0000), ...o.i32(10), ...o.call(f('print')), ...o.end,
          // 5 — касание кончилось: unreachable (trap)
          ...o.lget(0), ...o.i32(5), ...o.eq, ...o.if, ...o.unreachable, ...o.end,
          // 6 — бесконечный цикл с обращениями к сайту → лимит
          ...o.lget(0), ...o.i32(6), ...o.eq, ...o.if, ...o.loop, ...o.call(f('random')), ...o.drop, ...o.br(0), ...o.end, ...o.end,
          // 7 — буфер имени за памятью
          ...o.lget(0), ...o.i32(7), ...o.eq, ...o.if, ...o.gget(G_P), ...o.i32(65530), ...o.i32(100), ...o.call(f('player_name')), ...o.drop, ...o.end,
          // 9 — номер детали вместо игрока
          ...o.lget(0), ...o.i32(9), ...o.eq, ...o.if, ...o.gget(G_H), ...o.i32(64), ...o.i32(blen(S2)), ...o.f64(1), ...o.call(f('stat_add')), ...o.end,
          // 8 — каждые 0,01 с: «tick», на третьем — cancel
          ...o.lget(0), ...o.i32(8), ...o.eq, ...o.if,
          ...o.i32(160), ...o.i32(blen(S5)), ...o.call(f('print')),
          ...o.gget(G_N), ...o.i32(1), ...o.add, ...o.gset(G_N),
          ...o.gget(G_N), ...o.i32(3), ...o.eq, ...o.if, ...o.gget(G_EVERY), ...o.call(f('cancel')), ...o.end,
          ...o.end,
        ] },
        { exp: 'd37_update', params: [f64], body: (f, o) => [
          ...o.gget(G_ACC), ...o.lget(0), ...o.fadd, ...o.gset(G_ACC),
          ...o.gget(G_H), ...o.i32(7), ...o.gget(G_ACC), ...o.f64(90), ...o.fmul, ...o.call(f('set')),
        ] },
      ],
    });
    ok(new WebAssembly.Module(wasm) instanceof WebAssembly.Module, 'ручной модуль собран');
    const S = sandbox({ objs: [part('a', 'Кнопка'), part('b', 'Другая')], scripts: [wasmScript(wasm, 'cpp', 'a', 'ручной')] });
    ok(S.prints().includes(S1), 'print из d37_start', S.prints());
    ok(S.sets('a', 'pos').some(m => m.v.join() === '1,2,3'), 'set3: положение', S.sets('a'));
    ok(S.of('want').some(m => m.ev === 'touched' && m.id === 'a' && m.on), 'on_touched: подписка у хозяина');
    ok(S.of('prompt').some(m => m.id === 'a' && m.text === S3 && m.hold === 0.5), 'prompt: текст и удержание', S.of('prompt'));
    ok(S.of('want').some(m => m.ev === 'heartbeat' && m.on), 'want_update(1) → Heartbeat');
    ok(S.of('ready').length === 1 && S.errors().length === 0, 'готово без ошибок', S.errors());
    S.clear();
    S.ev('touched', { id: 'a' });
    ok(S.player('stat').some(m => m.v.k === S2 && m.v.v === 1), 'касание: stat_add игроку', S.player());
    ok(S.prints().includes('Тест'), 'player_name пишет имя в память модуля', S.prints());
    ok(S.sets('a', 'alpha').some(m => m.v === 0.5), 'event_target = деталь события');
    S.ev('prompt', { id: 'a' });
    ok(S.sets('a', 'color').some(m => m.v === '#ff0000'), 'prompt → обработчик (красный)', S.sets('a'));
    S.tick(0.5);
    ok(S.sets('a', 'rot').some(m => Math.abs(m.v[1] - 45) < 1e-9), 'd37_update(dt): поворот 45°', S.sets('a', 'rot'));
    S.tick(0.5);
    ok(S.sets('a', 'rot').some(m => Math.abs(m.v[1] - 90) < 1e-9), 'второй кадр: 90°');
    S.clear();
    S.ev('clicked', { id: 'a' });
    const e4 = S.errors()[0];
    ok(e4 && /за границами памяти/.test(e4.msg) && e4.script === 'ручной', 'неверный адрес строки → ошибка с именем скрипта', S.errors());
    S.clear();
    S.ev('touchEnded', { id: 'a' });
    ok(S.errors().some(m => /аварийная остановка/.test(m.msg)), 'unreachable → понятная ошибка', S.errors());
    S.clear();
    S.ev('touched', { id: 'a' });
    ok(S.player('stat').length === 1 && S.errors().length === 0, 'после ошибок модуль работает дальше', S.msgs);
    await sleep(250);
    ok(S.prints().includes(S4), 'delay: таймер сработал');
    ok(S.errors().some(m => /обращений к сайту/.test(m.msg)), 'бесконечный цикл с вызовами — лимит, не зависание', S.errors());
    ok(S.errors().some(m => /буфер за границами памяти/.test(m.msg)), 'буфер имени за памятью → ошибка', S.errors());
    ok(S.errors().some(m => /неверный номер игрока/.test(m.msg)), 'номер детали вместо игрока → ошибка', S.errors());
    ok(S.prints().filter(t => t === S5).length === 3, 'every: 3 раза, потом cancel', S.prints().filter(t => t === S5).length);
    S.clear();
    S.ev('touched', { id: 'a' });
    ok(S.player('stat').length === 1, 'и после лимита — живой');
  }
  // ── все функции из d37.h и d37.rs есть на сайте; неизвестная — предупреждение и понятная ошибка ──
  {
    const hdr = read('sdk/d37.h'), rs = read('sdk/d37.rs');
    const hNames = [...hdr.matchAll(/D37_IMPORT\((\w+)\)/g)].map(m => m[1]).filter(n => n !== 'n');
    const sysBlock = rs.slice(rs.indexOf('mod sys {'), rs.indexOf('// номера свойств'));
    const rNames = [...sysBlock.matchAll(/pub fn (\w+)\(/g)].map(m => m[1]);
    ok(hNames.length >= 50 && hNames.slice().sort().join() === rNames.slice().sort().join(), 'd37.h и d37.rs: один и тот же список функций (' + hNames.length + ')', { h: hNames.filter(n => !rNames.includes(n)), r: rNames.filter(n => !hNames.includes(n)) });
    const wasm = assemble({ imports: [...hNames.map(n => [n, [], []]), ['no_such_fn', [], []]], funcs: [{ exp: 'd37_start', body: (f, o) => [...o.call(f('no_such_fn'))] }] });
    const S = sandbox({ objs: [part('a', 'X')], scripts: [wasmScript(wasm)] });
    const w = S.warns().find(t => /которых на сайте нет/.test(t));
    ok(w && /d37\.no_such_fn/.test(w) && !hNames.some(n => w.includes('d37.' + n + ',') || w.endsWith('d37.' + n)), 'сайт знает все функции SDK, лишняя — в предупреждении', w);
    ok(S.errors().some(m => /функции d37\.no_such_fn на сайте нет/.test(m.msg)), 'вызов неизвестной функции — понятная ошибка', S.errors());
    const S2 = sandbox({ objs: [part('a', 'X')], scripts: [wasmScript(assemble({ funcs: [{ exp: 'other', body: () => [] }] })), wasmScript('aGVsbG8=', 'rust', 'a', 'мусор')] });
    ok(S2.errors().some(m => /нет функции d37_start/.test(m.msg)), 'нет d37_start — подсказка', S2.errors());
    ok(S2.errors().some(m => m.script === 'мусор' && /не WebAssembly/.test(m.msg)), 'не wasm — понятная ошибка');
  }
  // ── разбор ошибок clang по-русски (без компилятора) ──
  {
    const r = E.langs.cpp._russify("script.cpp:5:3: error: use of undeclared identifier 'coins'\n    5 |   coins++;\n      |   ^\nscript.cpp:7:1: warning: unused variable 'x' [-Wunused-variable]\nwasm-ld: error: /tmp/script-1a2b.o: undefined symbol: start()\n1 error generated.");
    ok(/^Строка 5: ошибка: неизвестное имя «coins»/m.test(r), 'ошибка clang по-русски', r);
    ok(/Строка 7: предупреждение: переменная «x» не используется/.test(r) && /нет функции start\(\)/.test(r) && /Ошибок: 1/.test(r), 'предупреждение, компоновщик, итог', r);
    let thrown = null;
    try { E.langs.cpp._result(false, null, "script.cpp:1:1: error: unknown type name 'Foo'"); } catch (e) { thrown = e; }
    ok(thrown && /неизвестный тип «Foo»/.test(thrown.log), 'не собралось — throw с .log');
    ok(E.langs.cpp.kind === 'binary' && typeof E.langs.cpp.compile === 'function' && E.langs.rust.kind === 'binary' && !E.langs.rust.compile, 'языки зарегистрированы: cpp с компилятором, rust — файлом');
    ok(E.langs.cpp.examples.length >= 4 && E.langs.rust.examples.length >= 4 && /Задача: $/.test(E.langs.cpp.ai) && /Задача: $/.test(E.langs.rust.ai), 'примеры и задание для ИИ');
  }
  // ── SDK: файлы примеров = примеры в студии; шаблон Rust = sdk/d37.rs ──
  {
    const pairs = [['coin', 0], ['lava', 1], ['door', 2], ['spinner', 3]];
    for (const [n, i] of pairs) {
      ok(read('sdk/examples/' + n + '.cpp') === E.langs.cpp.examples[i][1], 'sdk/examples/' + n + '.cpp = пример в студии');
      ok(read('sdk/examples/' + n + '.rs') === E.langs.rust.examples[i][1], 'sdk/examples/' + n + '.rs = пример в студии');
    }
    ok(read('sdk/rust-template/src/d37.rs') === read('sdk/d37.rs'), 'шаблон: src/d37.rs = sdk/d37.rs');
  }

  // ═══ 2. C++: настоящий clang (@yowasp/clang) ═══
  const clangDir = process.env.D37_CLANG || path.join(os.tmpdir(), 'd37-wasm', 'clang', 'node_modules', '@yowasp', 'clang');
  // ── «⚙️ Собрать» целиком, как в студии: compile() → module Worker из Blob (тут — подменный, в этом же процессе) → clang ──
  if (fs.existsSync(path.join(clangDir, 'gen', 'bundle.js'))) {
    const localCdn = pathToFileURL(clangDir).href + '/';
    const saved = { Worker: globalThis.Worker, Blob: globalThis.Blob, fetch: globalThis.fetch, cou: URL.createObjectURL };
    const blobs = new Map(), types = [];
    globalThis.Blob = class { constructor(parts, o) { this.text = parts.join(''); this.type = o && o.type; } };
    URL.createObjectURL = b => { const u = 'blob:test/' + blobs.size; blobs.set(u, b.text); return u; };
    globalThis.Worker = class {
      constructor(url, o) {
        types.push(o && o.type);
        const src = blobs.get(url).replace(JSON.stringify(E.langs.cpp.cdn), () => JSON.stringify(localCdn));
        const me = this;
        this.inner = { postMessage: m => setTimeout(() => me.onmessage && me.onmessage({ data: m }), 0) };
        new Function('self', src)(this.inner);
      }
      postMessage(m){ setTimeout(() => this.inner.onmessage({ data: m }), 0); }
      terminate(){}
    };
    globalThis.fetch = (u, o) => /sdk\/d37\.h\?v=1$/.test(String(u)) ? Promise.resolve(new Response(read('sdk/d37.h'))) : saved.fetch(u, o);
    try {
      const steps = [];
      const r = await E.langs.cpp.compile(E.langs.cpp.examples[0][1], { name: 'Монетка', onStep: t => steps.push(t) });
      ok(r && r.wasm instanceof Uint8Array && WebAssembly.validate(r.wasm) && r.log === '', '«⚙️ Собрать»: compile() → поток → clang → .wasm', steps);
      ok(steps[0] === 'подготовка…' && steps.some(t => /^загрузка компилятора \d+%/.test(t)) && steps.includes('сборка…') && types.join() === 'module', '«⚙️ Собрать»: шаги (загрузка с процентами, сборка), module Worker', steps.slice(0, 4).concat(steps.slice(-3)));
      let e2 = null;
      try { await E.langs.cpp.compile('void start() { oops(); }', { onStep: () => {} }); } catch (e) { e2 = e; }
      ok(e2 && /^Строка 1: ошибка: неизвестное имя «oops»/m.test(e2.log) && types.length === 1, '«⚙️ Собрать»: ошибка по-русски, поток компилятора тот же', e2 && e2.log);
    } catch (e) { ok(false, '«⚙️ Собрать» не упал', e && e.stack); }
    finally { Object.assign(globalThis, { Worker: saved.Worker, Blob: saved.Blob, fetch: saved.fetch }); URL.createObjectURL = saved.cou; }
  }
  let runClang = null;
  if (fs.existsSync(path.join(clangDir, 'gen', 'bundle.js'))) {
    try { ({ runClang } = await import(pathToFileURL(path.join(clangDir, 'gen', 'bundle.js')).href)); } catch (e) { notes.push('C++: @yowasp/clang не загрузился — ' + e.message); }
  } else notes.push('C++ пропущен: нет ' + clangDir + ' (npm i @yowasp/clang@22.0.0-git20542-10 в %TEMP%/d37-wasm/clang)');
  if (runClang) {
    const header = read('sdk/d37.h');
    let ms = 0, builds = 0;
    const cpp = async (src, args) => {   // как на сайте: _job → clang → _result (или throw с .log)
      const job = E.langs.cpp._job(src, header);
      if (args) job.args = args;
      let log = ''; const dec = new TextDecoder();
      const t0 = Date.now();
      try {
        const out = await runClang(job.args, job.files, { stdout: b => { if (b) log += dec.decode(b, { stream: true }); }, stderr: b => { if (b) log += dec.decode(b, { stream: true }); }, decodeASCII: false, fetchProgress: () => {} });
        return E.langs.cpp._result(true, out[job.out], log);
      } catch (e) { if (e.log !== undefined) throw e; return E.langs.cpp._result(false, null, log || e.message); }
      finally { ms += Date.now() - t0; builds++; }
    };
    const run = async (r, objs, parent = 'a', name = 'cpp') => sandbox({ objs, scripts: [wasmScript(r.wasm, 'cpp', parent, name)] });
    // примеры студии — все собираются и работают
    const ex = E.langs.cpp.examples, built = [];
    for (const [title, src] of ex) { try { built.push(await cpp(src)); } catch (e) { built.push(null); ok(false, 'C++ пример собирается: ' + title, e.log); } }
    ok(built.every(Boolean), 'C++: все ' + ex.length + ' примеров собрались', built.map(b => b && b.wasm.length));
    ok(built.every(b => b && !b.log), 'C++: примеры и d37.h — без предупреждений (-Wall)', built.map(b => b && b.log).filter(Boolean));
    if (built[0]) { const S = await run(built[0], [part('a', 'Монетка')]); S.ev('touched', { id: 'a' }); ok(S.player('stat').some(m => m.v.k === 'Монеты' && m.v.v === 1) && S.of('sound').some(m => m.name === 'coin') && S.of('destroy').some(m => m.id === 'a') && !S.errors().length, 'C++ монетка: очко, звук, исчезла', S.msgs); }
    if (built[1]) { const S = await run(built[1], [part('a', 'Лава')]); S.ev('touched', { id: 'a' }); ok(S.player('health').some(m => m.v === 0), 'C++ лава: здоровье 0', S.msgs); }
    if (built[2]) {
      const S = await run(built[2], [part('a', 'Дверь', { pos: [2, 3, 4], size: [4, 6, 1] })]);
      ok(S.of('prompt').some(m => m.text === 'Открыть дверь'), 'C++ дверь: подсказка [E]', S.msgs);
      S.clear(); S.ev('prompt', { id: 'a' });
      const tw = S.of('tween')[0];
      ok(tw && tw.goals.pos.join() === '2,9,4' && tw.time === 0.6 && S.of('prompt').some(m => m.text === 'Закрыть дверь') && S.of('sound').some(m => m.name === 'door_wood_open'), 'C++ дверь: открылась (tween вверх на высоту, текст, звук)', S.msgs);
      S.clear(); S.ev('prompt', { id: 'a' });
      ok(S.of('tween').some(m => m.goals.pos.join() === '2,3,4') && S.of('sound').some(m => m.name === 'door_wood_close'), 'C++ дверь: закрылась', S.msgs);
    }
    if (built[3]) { const S = await run(built[3], [part('a', 'Крутилка')]); ok(S.of('want').some(m => m.ev === 'heartbeat' && m.on), 'C++ крутилка: кадры'); S.tick(0.5); S.tick(0.5); const r = S.sets('a', 'rot'); ok(r.length === 2 && Math.abs(r[1].v[1] - 90) < 1e-6, 'C++ крутилка: 90° за секунду', r); }
    if (built[4]) { const S = await run(built[4], [part('a', 'Платформа', { pos: [0, 1, 0] })]); const t = S.of('tween')[0]; ok(t && t.goals.pos.join() === '0,1,12' && t.repeat === -1 && t.reverses && t.ease === 'sine' && t.time === 3, 'C++ платформа: бесконечный tween', S.msgs); }
    if (built[5]) { const S = await run(built[5], [part('a', 'Батут')]); S.ev('touched', { id: 'a' }); ok(S.player('jump').some(m => m.v === 140) && S.player('message').length === 1, 'C++ батут: прыжок 140 + сообщение', S.msgs); }
    if (built[6]) { const S = await run(built[6], [part('a', 'Вход'), part('b', 'Выход', { pos: [10, 0, 5] })]); S.ev('touched', { id: 'a' }); ok(S.player('teleport').some(m => m.v.join() === '10,3,5'), 'C++ телепорт к «Выход»', S.msgs); }
    if (built[7]) { const S = await run(built[7], [part('a', 'Кнопка')]); S.ev('prompt', { id: 'a' }); ok(S.sets('a', 'color').length === 1 && S.of('sound').some(m => m.name === 'click'), 'C++ кнопка: цвет', S.msgs); }
    if (built[8]) { const S = await run(built[8], [part('a', 'Финиш')]); S.ev('touched', { id: 'a' }); S.ev('touched', { id: 'a' }); const g = S.of('gui'); ok(g.length === 1 && /^🏁 Тест прошёл за [\d.]+ с!$/.test(g[0].text) && S.player('stat').some(m => m.v.k === 'Время'), 'C++ финиш: одно сообщение с временем', S.msgs); }
    if (built[9]) { const S = await run(built[9], [part('a', 'X')], null); ok(S.player('message').some(m => m.v.text === 'Привет, Тест! Собери все монетки 🪙') && S.player('stat').some(m => m.v.k === 'Монеты' && m.v.v === 0), 'C++ при входе: приветствие (PlayerAdded до старта не теряется)', S.msgs); }
    // всё SDK сразу: std::string, printf, лямбды с состоянием, таймеры, поиск, клоны, tween → on_done, падения
    const big = `#include <string>
#include <vector>
#include <cstdio>
using namespace d37;
static std::vector<std::string> log_;
static int touches = 0;
Part self_;
__attribute__((noinline)) int crash(int k) { volatile int z = 0; return k / z; }
void start() {
  self_ = script_parent();
  print("имя: " + std::string(self_.name()));
  printf("printf %d %s\\n", 42, "ok");
  printf("без перевода строки");
  Part box = find("Ящик");
  print(Text() << "ящик: " << (box ? "есть" : "нет") << " x=" << box.position().x << " детей у модели: " << find("Дом").child_count());
  Part c = box.clone();
  c.set_position(7, 8, 9);
  Part n = new_part(find("Дом"));
  n.set_name("Новая");
  n.set_material("neon");
  n.set_color(0x00ff00);
  print(Text() << "новая в доме: " << (n.parent() == find("Дом") ? 1 : 0) << " материал " << n.material());
  self_.on_touched([](Player p) { touches++; p.add_stat("Касания", 1); print(Text() << "касаний " << touches << " игрок " << p.name()); });
  Conn once = self_.on_clicked([](Player p) { print("клик"); });
  once.off();
  self_.on_touch_ended([](Player p) { int* bad = (int*)0x7ffffff0; print(Text() << *bad); });
  self_.prompt("Сломать", [](Player p) { crash(1); });
  delay(0.03, [] { print("таймер 2"); });
  delay(0.01, [] { print("таймер 1"); });
  int left = 3;
  Timer t; t = every(0.01, [left]() mutable { if (--left >= 0) print(Text() << "осталось " << left); });
  self_.tween_transparency(1, TweenInfo(0.2)).on_done([] { print("tween готов"); });
  int r = random_int(5, 6);
  print(Text() << "r " << (r == 5 || r == 6 ? "ok" : "bad") << " t " << (game_time() >= 0 ? "ok" : "bad"));
  for (Player p : players()) print("игрок " + std::string(p.name()) + " здоровье " + std::to_string((int)p.health()));
  on_player_removing([](Player p) { print("ушёл " + std::string(p.name())); });
}
`;
    let bigR = null;
    try { bigR = await cpp(big); } catch (e) { ok(false, 'C++ большой тест собирается', e.log); }
    if (bigR) {
      const S = await run(bigR, [part('a', 'Я'), part('b', 'Ящик', { pos: [3, 1, 0] }), { id: 'm', cls: 'Model', parent: null, p: { name: 'Дом' } }, { ...part('c', 'Окно'), parent: 'm' }]);
      const P = S.prints();
      ok(P.includes('имя: Я') && P.includes('printf 42 ok') && P.includes('без перевода строки'), 'C++: std::string, printf построчно и хвост без \\n', P);
      ok(P.includes('ящик: есть x=3 детей у модели: 1'), 'C++: find, position, child_count, Text с числами', P);
      ok(S.of('clone').length === 1 && S.of('new').some(m => m.parent === 'm'), 'C++: clone и new_part в модель', S.msgs.filter(m => m.t === 'clone' || m.t === 'new'));
      ok(P.includes('новая в доме: 1 материал neon'), 'C++: parent(), set_material/material()', P);
      ok(P.includes('r ok t ok') && P.includes('игрок Тест здоровье 100'), 'C++: random_int, game_time, players()', P);
      ok(S.of('tween').some(m => m.goals.alpha === 1 && m.time === 0.2), 'C++: tween_transparency', S.of('tween'));
      const wc = S.of('want').filter(m => m.ev === 'clicked');
      ok(wc.length === 2 && wc[0].on && !wc[1].on, 'C++: off() отписал клик', wc);
      S.clear();
      S.ev('touched', { id: 'a' }); S.ev('touched', { id: 'a' });
      ok(S.prints().includes('касаний 2 игрок Тест') && S.player('stat').length === 2, 'C++: лямбда со счётчиком', S.prints());
      S.clear(); S.ev('touchEnded', { id: 'a' });
      ok(S.errors().some(m => /границы памяти/.test(m.msg)), 'C++: чтение по плохому адресу → trap → ошибка', S.errors());
      S.clear(); S.ev('prompt', { id: 'a' });
      ok(S.errors().some(m => /деление на ноль/.test(m.msg) && /crash/.test(m.msg)), 'C++: деление на ноль → ошибка с именем функции', S.errors());
      await sleep(400);
      const P2 = S.prints();
      ok(P2.indexOf('таймер 1') >= 0 && P2.indexOf('таймер 1') < P2.indexOf('таймер 2'), 'C++: delay по порядку', P2);
      ok(P2.filter(t => /^осталось/.test(t)).join() === 'осталось 2,осталось 1,осталось 0', 'C++: every с захваченным состоянием', P2);
    }
    if (bigR) {
      // tween → on_done: хозяин сообщает tweenDone
      const S = await run(bigR, [part('a', 'Я'), part('b', 'Ящик'), { id: 'm', cls: 'Model', parent: null, p: { name: 'Дом' } }]);
      const tw = S.of('tween')[0]; S.clear();
      S.send({ t: 'ev', ev: 'tweenDone', tid: tw.tid });
      ok(S.prints().includes('tween готов'), 'C++: tween.on_done', S.msgs);
      S.send({ t: 'ev', ev: 'playerRemoving', id: 'me' });
      ok(S.prints().includes('ушёл Тест'), 'C++: on_player_removing');
    }
    // ошибки сборки — по-русски, с номером строки
    let err = null;
    try { await cpp('using namespace d37;\nvoid start() {\n  int a = 1;\n  coins++;\n}\n'); } catch (e) { err = e; }
    ok(err && /^Строка 4: ошибка: неизвестное имя «coins»/m.test(err.log), 'C++: ошибка компиляции — строка и по-русски', err && err.log);
    err = null;
    try { await cpp('void begin() {}\n'); } catch (e) { err = e; }
    ok(err && /нет функции start\(\)/.test(err.log), 'C++: нет start() — понятная ошибка', err && err.log);
    const warnR = await cpp('using namespace d37;\nvoid start() {\n  int unused = 5;\n  int x;\n  print(Text() << x);\n}\n').catch(e => ({ log: e.log }));
    ok(warnR.wasm && /Строка 3: предупреждение: переменная «unused» не используется/.test(warnR.log) && /Строка 5: предупреждение: переменная «x» используется без значения/.test(warnR.log), 'C++: предупреждения по-русски в .log при удачной сборке', warnR.log);
    // C без libc (сырые функции и D37_CB) и C++ без libc (обработчики-функции) — та же d37.h
    const freeC = `static int self_;
static void on_touch(int p) { if (p) d37_stat_addz(p, "Очки", 2); }
static void tick(double dt) { d37_set(self_, D37_ROT_Y, d37_get(self_, D37_ROT_Y) + 90 * dt); }
static void later(void) { char b[32]; d37_fmt(b, sizeof b, 2.5); d37_printz(b); d37_fmt(b, sizeof b, -1234567); d37_printz(b); d37_fmt(b, sizeof b, 1.0 / 3); d37_printz(b); }
void start(void) { self_ = d37_script(); d37_on_touched(self_, D37_CB(on_touch)); d37_on_update(tick); d37_delay(0.01, D37_CB0(later)); }
`;
    let cR = null;
    try { cR = await cpp(freeC, ['clang', '--target=wasm32', '-O2', '-nostdlib', '-Wl,--no-entry', '-x', 'c', '-include', 'd37.h', 'script.cpp', '-o', 'script.wasm']); } catch (e) { ok(false, 'C без libc собирается', e.log); }
    if (cR) {
      const imps = WebAssembly.Module.imports(new WebAssembly.Module(cR.wasm)).map(i => i.module);
      ok(imps.every(m => m === 'd37'), 'C без libc: только импорты d37', imps);
      const S = await run(cR, [part('a', 'C')]);
      S.ev('touched', { id: 'a' }); S.tick(1);
      await sleep(60);
      ok(S.player('stat').some(m => m.v.k === 'Очки' && m.v.v === 2) && S.sets('a', 'rot').some(m => Math.abs(m.v[1] - 90) < 1e-9), 'C без libc: касание и кадр', S.msgs);
      ok(S.prints().join('|') === '2.5|-1234567|0.333', 'C без libc: d37_fmt и таймер', S.prints());
    }
    const freeCpp = `using namespace d37;
Part self_;
void touched(Player p) { p.add_stat("Очки", 3); p.message(Text() << "привет " << p.name()); }
void start() { self_ = script_parent(); self_.on_touched(touched); delay(0.01, [] { print("лямбда без захвата"); }); on_update([](double dt) { self_.set_rotation(0, 45, 0); }); }
`;
    let fR = null;
    try { fR = await cpp(freeCpp, ['clang++', '--target=wasm32', '-std=c++20', '-O2', '-nostdlib', '-fno-exceptions', '-Wl,--no-entry', '-include', 'd37.h', 'script.cpp', '-o', 'script.wasm']); } catch (e) { ok(false, 'C++ без libc собирается', e.log); }
    if (fR) {
      const S = await run(fR, [part('a', 'C++')]);
      S.ev('touched', { id: 'a' }); S.tick(0.1);
      await sleep(60);
      ok(S.player('stat').some(m => m.v.v === 3) && S.player('message').some(m => m.v.text === 'привет Тест') && S.prints().includes('лямбда без захвата') && S.sets('a', 'rot').length === 1, 'C++ без libc: обработчик-функция, лямбда, кадр', S.msgs);
    }
    notes.push(`C++: собрано ${builds} модулей настоящим clang (@yowasp/clang), в среднем ${Math.round(ms / Math.max(1, builds))} мс` + (built[0] ? `, монетка — ${built[0].wasm.length} байт` : ''));
  }

  // ═══ 3. Rust: настоящий cargo ═══
  const home = os.homedir(), exe = process.platform === 'win32' ? '.exe' : '';
  const cargo = process.env.D37_CARGO || [path.join(home, '.cargo', 'bin', 'cargo' + exe)].find(p => fs.existsSync(p)) || (() => { try { cp.execFileSync('cargo', ['--version'], { stdio: 'ignore' }); return 'cargo'; } catch (e) { return null; } })();
  if (!cargo) notes.push('Rust пропущен: нет cargo (rustup: https://rustup.rs, rustup target add wasm32-unknown-unknown)');
  else {
    const work = path.join(os.tmpdir(), 'd37-wasm', 'rust-test'), target = path.join(os.tmpdir(), 'd37-wasm', 'rust-target');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, 'src'), { recursive: true });
    for (const f of ['Cargo.toml', 'src/d37.rs']) fs.copyFileSync(path.join(SITE, 'sdk/rust-template', f), path.join(work, f));
    let ms = 0, builds = 0;
    const rust = src => {
      fs.writeFileSync(path.join(work, 'src/lib.rs'), src);
      const t0 = Date.now();
      const r = cp.spawnSync(cargo, ['build', '--release', '--target', 'wasm32-unknown-unknown', '--quiet'], { cwd: work, env: { ...process.env, CARGO_TARGET_DIR: target }, encoding: 'utf8' });
      ms += Date.now() - t0; builds++;
      if (r.status !== 0) return { err: (r.stderr || '') + (r.error ? r.error.message : '') };
      return { wasm: new Uint8Array(fs.readFileSync(path.join(target, 'wasm32-unknown-unknown', 'release', 'd37_script.wasm'))) };
    };
    const tpl = rust(read('sdk/rust-template/src/lib.rs'));
    ok(tpl.wasm, 'Rust: шаблон собрался', tpl.err);
    if (tpl.wasm) {
      const S = sandbox({ objs: [part('a', 'Кубик', { pos: [0, 2, 0] })], scripts: [wasmScript(tpl.wasm, 'rust')] });
      ok(S.prints().includes('Привет из Rust! Я в детали «Кубик»') && !S.errors().length, 'Rust шаблон: log! и name()', S.msgs);
      S.ev('touched', { id: 'a' });
      ok(S.player('stat').some(m => m.v.k === 'Касания' && m.v.v === 1) && S.sets('a', 'color').length === 1 && S.of('sound').some(m => m.name === 'click'), 'Rust шаблон: касание', S.msgs);
      S.ev('prompt', { id: 'a' });
      ok(S.of('tween').some(m => m.goals.pos.join() === '0,5,0' && m.ease === 'back' && m.reverses) && S.player('message').some(m => m.v.text === 'Оп!'), 'Rust шаблон: [E] → tween', S.msgs);
      S.tick(1);
      ok(S.sets('a', 'rot').some(m => Math.abs(m.v[1] - 30) < 1e-9), 'Rust шаблон: on_update', S.sets('a', 'rot'));
      ok(tpl.wasm.length < 200000, 'Rust шаблон: размер ' + tpl.wasm.length + ' байт');
    }
    const ex = E.langs.rust.examples, built = ex.map(([title, src]) => { const r = rust(src); ok(r.wasm, 'Rust пример собирается: ' + title, r.err); return r.wasm ? { wasm: r.wasm } : null; });
    const run = (r, objs, parent = 'a') => sandbox({ objs, scripts: [wasmScript(r.wasm, 'rust', parent, 'rs')] });
    if (built[0]) { const S = run(built[0], [part('a', 'Монетка')]); S.ev('touched', { id: 'a' }); ok(S.player('stat').some(m => m.v.k === 'Монеты' && m.v.v === 1) && S.of('destroy').length === 1 && S.of('sound').length === 1, 'Rust монетка', S.msgs); }
    if (built[1]) { const S = run(built[1], [part('a', 'Лава')]); S.ev('touched', { id: 'a' }); ok(S.player('health').some(m => m.v === 0), 'Rust лава', S.msgs); }
    if (built[2]) {
      const S = run(built[2], [part('a', 'Дверь', { pos: [2, 3, 4], size: [4, 6, 1] })]);
      S.ev('prompt', { id: 'a' });
      ok(S.of('tween').some(m => m.goals.pos.join() === '2,9,4' && m.time === 0.6) && S.of('prompt').some(m => m.text === 'Закрыть дверь'), 'Rust дверь: открылась', S.msgs);
      S.clear(); S.ev('prompt', { id: 'a' });
      ok(S.of('tween').some(m => m.goals.pos.join() === '2,3,4'), 'Rust дверь: закрылась (замыкание помнит состояние)', S.msgs);
    }
    if (built[3]) { const S = run(built[3], [part('a', 'Крутилка')]); S.tick(0.5); S.tick(0.5); const r = S.sets('a', 'rot'); ok(r.length === 2 && Math.abs(r[1].v[1] - 90) < 1e-6, 'Rust крутилка', r); }
    if (built[4]) { const S = run(built[4], [part('a', 'Платформа', { pos: [0, 1, 0] })]); ok(S.of('tween').some(m => m.goals.pos.join() === '0,1,12' && m.repeat === -1 && m.ease === 'sine'), 'Rust платформа', S.msgs); }
    if (built[5]) { const S = run(built[5], [part('a', 'X')], null); ok(S.player('message').some(m => m.v.text === 'Привет, Тест! Собери все монетки 🪙') && S.prints().includes('Вошёл Тест'), 'Rust при входе', S.msgs); }
    // паника: сообщение с номером строки lib.rs, без второй ошибки «аварийная остановка»; остальные обработчики живы
    const pan = rust(`#[macro_use]
mod d37;
use d37::*;

fn start() {
    let p = script_parent();
    p.on_touched(|_| {
        let v: Vec<i32> = Vec::new();
        let i = v.len() + 3;
        log!("{}", v[i]);
    });
    p.on_clicked(|pl| pl.add_stat("Клики", 1));
    let mut n = 0;
    every(0.01, move || { n += 1; if n == 2 { log!("every {}", n); } });
    let t = delay(0.01, || print("не должно"));
    t.cancel();
}
`);
    ok(pan.wasm, 'Rust: тест паники собрался', pan.err);
    if (pan.wasm) {
      const S = run(pan, [part('a', 'X')]);
      S.ev('touched', { id: 'a' });
      const er = S.errors();
      ok(er.length === 1 && /паника: index out of bounds/.test(er[0].msg) && er[0].line === 10, 'Rust: паника → одна ошибка с номером строки', er);
      S.ev('clicked', { id: 'a' });
      await sleep(80);
      ok(S.player('stat').some(m => m.v.k === 'Клики') && S.prints().includes('every 2') && !S.prints().includes('не должно'), 'Rust: после паники другие обработчики живы, cancel работает', S.msgs);
    }
    notes.push(`Rust: собрано ${builds} модулей настоящим cargo (${cp.execFileSync(cargo, ['--version'], { encoding: 'utf8' }).trim()}), в среднем ${Math.round(ms / Math.max(1, builds))} мс` + (tpl.wasm ? `, шаблон — ${tpl.wasm.length} байт` : ''));
  }
}

main().catch(e => { fail++; console.log('FAIL исключение в тесте', e && e.stack || e); }).finally(() => {
  for (const n of notes) console.log('• ' + n);
  console.log(`\n${pass} ок, ${fail} ошибок`);
  process.exit(fail ? 1 : 0);
});

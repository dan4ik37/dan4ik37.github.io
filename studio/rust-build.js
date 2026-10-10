// ═══════════════════════════════════════
//  Rust прямо на сайте: настоящий компилятор rustc (LLVM + встроенный линковщик lld), собранный в WebAssembly
// ═══════════════════════════════════════
// Работает в studio/rust.html — невидимой рамке «Студии 3D» (js/engine/lang-wasm.js → compileRust). rustc — программа
// с потоками (wasm32-wasip1-threads): нужна общая память (SharedArrayBuffer), а она есть только у «изолированной»
// страницы. Заголовок Document-Isolation-Policy (vercel.json; Chrome / Edge / Яндекс 137+ на компьютере) изолирует
// ТОЛЬКО эту рамку — сама студия остаётся обычной страницей (реклама, видео, вход работают как были).
// Компилятор — github.com/oligamiq/rust_wasm (MIT / Apache-2.0), файлы с его GitHub Pages: rustc_opt.wasm.br (19,8 МБ)
// и стандартная библиотека wasm32-unknown-unknown.tar.br (18,1 МБ) — один раз, дальше из Cache Storage.
// Потоки и файлы WASI — @oligami/browser_wasi_shim-threads + @bjorn3/browser_wasi_shim, brotli — brotli-dec-wasm
// (все MIT / Apache-2.0, с jsDelivr). Исходник — /work/lib.rs (+ SDK сайта /work/d37.rs), результат — /work/out/script.wasm.
// Разговор со студией — postMessage только своего origin: ← { d37rust: 'build', id, src }; → hello / progress / done.
// Локально заголовок ставит scripts/serve.py (python -m http.server его не ставит — тогда «браузер не подходит»).

const V = 'v0.2.1', ART = `https://oligamiq.github.io/rust_wasm/${V}/`, TARGET = 'wasm32-unknown-unknown';
const CDN = {
  threads: 'https://cdn.jsdelivr.net/npm/@oligami/browser_wasi_shim-threads@0.5.0/+esm',
  shim: 'https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/+esm',
  brotli: 'https://cdn.jsdelivr.net/npm/brotli-dec-wasm@2.3.2/pkg/brotli_dec_wasm.js',
};
// [файл, размер — для процентов, если сервер не скажет]
const PARTS = [['rustc_opt.wasm.br', 19774341], [TARGET + '.tar.br', 18122136]];
const SKIP = /^lib(test|getopts|unicode_width|proc_macro)-/;   // только для тестов и процедурных макросов — в память не берём
const CACHE = 'd37-rust-' + V;
const MEM = [400, 16384];   // память rustc, страницы по 64 КБ: старт (модулю нужно ≥ 399) и максимум (1 ГБ — как у модуля)
const ENV = ['RUST_MIN_STACK=16777216', 'TMPDIR=/tmp', 'RUST_BACKTRACE=0'];
const BUILD_MS = 180e3, MAX_SRC = 200000;
// SDK подключаем сами, если в коде нет «mod d37», — на той же строке, номера строк не сдвигаются
const HEAD = '#[macro_use] mod d37; use d37::*; ';
const ARGS = ['/work/lib.rs', '--crate-name', 'script', '--crate-type', 'cdylib', '--edition', '2021', '--target', TARGET,
  '--sysroot', '/sysroot', '-C', 'opt-level=s', '-C', 'panic=abort', '-C', 'codegen-units=1', '-C', 'debuginfo=0',
  '-C', 'strip=symbols', '--error-format=json', '-o', '/work/out/script.wasm'];

const td = new TextDecoder(), te = new TextEncoder();
const say = (m, tr) => parent.postMessage(m, location.origin, tr || []);
const join = (list, n) => { const u = new Uint8Array(n); let o = 0; for (const c of list) { u.set(c, o); o += c.length; } return u; };
const base = p => p.slice(p.lastIndexOf('/') + 1);
const blobUrl = code => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

// ═══ Файлы компилятора: Cache Storage → сеть (с процентами) ═══
async function download(file, size, onp){
  const url = ART + file;
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) {}
  const hit = cache && await cache.match(url).catch(() => null);
  if (hit) { const u = new Uint8Array(await hit.arrayBuffer()); onp(u.length, u.length); return u; }
  const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new Error(`не скачался ${file}: HTTP ${r.status}`);
  const total = +r.headers.get('content-length') || size, rd = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; onp(got, total); }
  const u = join(parts, got);
  if (cache) cache.put(url, new Response(u, { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => {});
  return u;
}
// brotli кусками: память распаковщика остаётся маленькой
function unbrotli(B, input){
  const s = new B.DecompressStream(), R = B.BrotliStreamResultCode, out = [];
  let n = 0, code = R.NeedsMoreInput;
  try {
    for (let off = 0; off < input.length && code !== R.ResultSuccess;) {
      const chunk = input.subarray(off, Math.min(input.length, off + (1 << 20)));
      let used = 0;
      do {
        const r = s.decompress(chunk.subarray(used), 8 << 20), b = r.buf;
        if (b.length) { out.push(b); n += b.length; }
        used += r.input_offset; code = r.code; r.free();
      } while (code === R.NeedsMoreOutput);
      off += chunk.length;
    }
  } finally { s.free(); }
  if (code !== R.ResultSuccess) throw new Error('архив оборван');
  return join(out, n);
}
// tar: только обычные файлы → [имя, байты]
function untar(u8){
  const files = [];
  for (let off = 0; off + 512 <= u8.length;) {
    const h = u8.subarray(off, off + 512);
    if (!h[0]) break;
    const str = (a, k) => { let e = a; while (e < a + k && h[e]) e++; return td.decode(h.subarray(a, e)); };
    let name = str(0, 100);
    const pre = str(345, 155);
    if (pre) name = pre + '/' + name;
    const size = parseInt(str(124, 12).trim() || '0', 8) || 0, type = h[156], body = off + 512;
    if (type === 0 || type === 48) files.push([name, u8.subarray(body, body + size)]);
    off = body + Math.ceil(size / 512) * 512;
  }
  return files;
}

// ═══ Поток rustc (module Worker из Blob): WASI-«животное» фермы; сам rustc идёт в своих потоках ═══
function rustcWorker(THREADS){
  let wasi = null;
  self.onmessage = async e => {
    const d = e.data || {};
    try {
      if (d.init) {
        const T = await import(THREADS);
        const memory = new WebAssembly.Memory({ initial: d.mem[0], maximum: d.mem[1], shared: true });
        wasi = new T.WASIFarmAnimal([d.ref], ['rustc'], d.env, { can_thread_spawn: true, thread_spawn_worker_url: d.threadUrl, thread_spawn_wasm: d.module, share_memory: { memory } });
        await wasi.wait_worker_background_worker();
        self.postMessage({ ready: true });
      } else if (d.run) {
        wasi.args = ['rustc', ...d.args];
        self.postMessage({ done: true, code: wasi.block_start_on_thread() });
      }
    } catch (er) { self.postMessage({ failed: true, error: String(er && er.message || er), stack: String(er && er.stack || '') }); }
  };
}

// ═══ Компилятор: скачать, распаковать, собрать модуль и файловую систему — один раз за жизнь рамки ═══
let tool = null;
const toolchain = onp => tool || (tool = setup(onp).catch(e => { tool = null; throw e; }));
async function setup(onp){
  caches.keys().then(ks => ks.filter(k => k.startsWith('d37-rust-') && k !== CACHE).forEach(k => caches.delete(k))).catch(() => {});
  onp('загрузка компилятора Rust…');
  const [T, S, B] = await Promise.all([import(CDN.threads), import(CDN.shim), import(CDN.brotli).then(async m => { await m.default(); return m; })]);
  const got = PARTS.map(() => 0), tot = PARTS.map(p => p[1]);
  let shown = -1;
  const prog = () => {
    const pc = Math.min(99, Math.floor(got.reduce((a, b) => a + b) / tot.reduce((a, b) => a + b) * 100));
    if (pc !== shown) { shown = pc; onp(`загрузка компилятора Rust ${pc}% (38 МБ, один раз)…`); }
  };
  const [rbr, sbr] = await Promise.all(PARTS.map(([f, sz], i) => download(f, sz, (a, b) => { got[i] = a; tot[i] = b; prog(); })));
  onp('распаковка компилятора…');
  let module, libs;
  try {
    module = await WebAssembly.compile(unbrotli(B, rbr));
    libs = untar(unbrotli(B, sbr)).filter(([n]) => n.endsWith('.rlib') && !SKIP.test(base(n)));
    if (!libs.some(([n]) => /^libstd-/.test(base(n)))) throw new Error('нет libstd');
  } catch (e) {
    caches.delete(CACHE).catch(() => {});   // кэш битый — в следующий раз скачаем заново
    throw new Error('файлы компилятора повреждены, нажми «⚙️ Собрать» ещё раз (' + (e && e.message || e) + ')');
  }
  onp('запуск компилятора…');
  const { File, Directory, PreopenDirectory, ConsoleStdout, OpenFile } = S;
  const lib = new Directory(libs.map(([n, u]) => [base(n), new File(u, { readonly: true })]));
  // один корень «/»: rustc заводит временные папки прямо в нём (/rustcXXXX)
  const sysroot = new Directory([['lib', new Directory([['rustlib', new Directory([[TARGET, new Directory([['lib', lib]])]])]])]]);
  const work = new Directory([]), tmp = new Directory([]);
  const root = new PreopenDirectory('/', [['sysroot', sysroot], ['work', work], ['tmp', tmp]]);
  const io = { out: [], err: [] };
  const farm = new T.WASIFarm(new OpenFile(new File(new Uint8Array(0), { readonly: true })), new ConsoleStdout(b => io.out.push(b.slice())), new ConsoleStdout(b => io.err.push(b.slice())),
    [root], { allocator_size: 256 << 20 });
  return {
    root: root.dir, sysroot, work, tmp, io, File, Directory, module, ref: farm.get_ref(),
    threadUrl: blobUrl(`import { thread_spawn_on_worker } from ${JSON.stringify(CDN.threads)};\nself.onmessage = async e => { await thread_spawn_on_worker(e.data); };\n`),
    workerUrl: blobUrl(`(${rustcWorker.toString()})(${JSON.stringify(CDN.threads)});\n`),
  };
}
// Каждая сборка — свой поток rustc (второй запуск в том же потоке библиотека потоков не умеет): ферма с файлами,
// скомпилированный модуль и ссылки — общие. Поток закрываем сразу — вместе с ним уходят и потоки самого rustc.
function run(t, args){
  return new Promise(res => {
    const w = new Worker(t.workerUrl, { type: 'module' });
    let fin = false;
    const end = d => { if (fin) return; fin = true; clearTimeout(timer); try { w.terminate(); } catch (e) {} res(d); };
    const timer = setTimeout(() => end({ failed: true, error: 'сборка идёт дольше 3 минут — остановлена' }), BUILD_MS);
    w.onmessage = e => { const d = e.data || {}; if (d.ready) w.postMessage({ run: true, args }); else if (d.done || d.failed) end(d); };
    w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); end({ failed: true, error: e && e.message || 'поток компилятора упал' }); };
    w.postMessage({ init: true, ref: t.ref, module: t.module, threadUrl: t.threadUrl, env: ENV, mem: MEM });
  });
}

// ═══ Сообщения rustc (JSON) — по-русски, как у C++: «Строка N: ошибка: … (оригинал)» ═══
const DICT = [
  [/^cannot find function `start` in the crate root$/, 'нет функции start() — напиши fn start() { … }'],
  [/^cannot find value `(.+)` in this scope$/, 'нет переменной «$1»'],
  [/^cannot find function `(.+)` in this scope$/, 'нет функции «$1»'],
  [/^cannot find macro `(.+)` in this scope$/, 'нет макроса «$1!»'],
  [/^cannot find type `(.+)` in this scope$/, 'нет типа «$1»'],
  [/^mismatched types$/, 'не те типы'],
  [/^expected `(.+)`, found `(.+)`$/, 'ожидалось «$1», а здесь «$2»'],
  [/^expected one of (.+), found (.+)$/, 'ожидалось одно из: $1 — а здесь $2'],
  [/^expected (.+), found (.+)$/, 'ожидалось $1, а здесь $2'],
  [/^unused variable: `(.+)`$/, 'переменная «$1» не используется'],
  [/^unused import: `(.+)`$/, 'лишний use «$1»'],
  [/^variable does not need to be mutable$/, 'mut здесь не нужен'],
  [/^value assigned to `(.+)` is never read$/, 'значение «$1» нигде не читается'],
  [/^function `(.+)` is never used$/, 'функция «$1» нигде не вызывается'],
  [/^cannot assign twice to immutable variable `(.+)`$/, '«$1» без mut — менять нельзя (let mut $1)'],
  [/^cannot borrow `(.+)` as mutable, as it is not declared as mutable$/, '«$1» без mut — менять нельзя (let mut $1)'],
  [/^(?:borrow|use) of moved value: `(.+)`$/, '«$1» уже отдано (move) — сделай копию раньше: .clone()'],
  [/^closure may outlive the current function, but it borrows `(.+)`, which is owned by the current function$/, 'замыкание живёт дольше функции — напиши move перед |…|'],
  [/^no method named `(.+)` found for (.+) in the current scope$/, 'у $2 нет метода «$1»'],
  [/^no field `(.+)` on type `(.+)`$/, 'у «$2» нет поля «$1»'],
  [/^this function takes (\d+) arguments? but (\d+) arguments? (?:was|were) supplied$/, 'функция ждёт аргументов: $1, а дано: $2'],
  [/^this method takes (\d+) arguments? but (\d+) arguments? (?:was|were) supplied$/, 'метод ждёт аргументов: $1, а дано: $2'],
  [/^unresolved import `(.+)`$/, 'нечего подключать: «$1»'],
  [/^failed to resolve: (.+)$/, 'не найдено: $1'],
  [/^use of undeclared crate or module `(.+)`$/, 'нет модуля «$1» (внешние crate не подключаются)'],
  [/^can't find crate for `(.+)`$/, 'нет crate «$1» — на сайте только std и SDK'],
  [/^cannot add `(.+)` to `(.+)`$/, 'нельзя сложить «$2» и «$1» — разные типы'],
  [/^the trait bound `(.+)` is not satisfied$/, 'тип не подходит: $1'],
  [/^expected item, found (.+)$/, 'код вне функции: $1'],
  [/^unterminated double quote string$/, 'не закрыта кавычка "'],
  [/^this file contains an unclosed delimiter$/, 'не закрыта скобка'],
  [/^unexpected closing delimiter: `(.+)`$/, 'лишняя закрывающая скобка «$1»'],
  [/^not found in this scope$/, 'не найдено'],
  [/^expected due to this$/, 'тип задан здесь'],
  // подсказки
  [/^there is a method `(.+)` with a similar name.*$/, 'есть похожий метод «$1»'],
  [/^there is a (?:local variable|variable) with a similar name.*$/, 'есть переменная с похожим именем'],
  [/^a local variable with a similar name exists.*$/, 'есть переменная с похожим именем'],
  [/^a function with a similar name exists.*$/, 'есть функция с похожим именем'],
  [/^if this is intentional, prefix it with an underscore.*$/, 'если так и задумано — начни имя с _'],
  [/^remove this `mut`$/, 'убери mut'],
  [/^consider changing this to be mutable$/, 'напиши mut'],
  [/^consider cloning the value.*$/, 'сделай копию: .clone()'],
  [/^consider borrowing here$/, 'возьми ссылку: &'],
  [/^to force the closure to take ownership of .*$/, 'напиши move перед |…|'],
  [/^try using a conversion method.*$/, 'преобразуй тип (например, as f64)'],
  [/^you can convert an? `(.+)` to an? `(.+)`.*$/, 'можно преобразовать «$1» в «$2»'],
  [/^add `;` here$/, 'поставь ; здесь'],
  [/^unclosed delimiter$/, 'эта скобка не закрыта'],
];
const ru = m => { for (const [re, t] of DICT) if (re.test(m)) return m.replace(re, t) + ' (' + m + ')'; return m; };
const KIND = { error: 'ошибка', warning: 'предупреждение', note: 'примечание', help: 'подсказка' };
function diagnostics(err){
  const out = [], plain = [];
  let errors = 0, warns = 0;
  for (const line of err.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch (e) { plain.push(line.length > 200 ? line.slice(0, 200) + '…' : line); continue; }
    if (!d || typeof d.message !== 'string' || (d.$message_type && d.$message_type !== 'diagnostic')) continue;
    if (d.level === 'failure-note' || /^aborting due to|^\d+ warnings? emitted|^For more information about|^Some errors have detailed explanations/.test(d.message)) continue;
    if (d.level === 'error') errors++; else if (d.level === 'warning') warns++;
    const sp = (d.spans || []).find(s => s.is_primary) || (d.spans || [])[0];
    const f = sp ? base(String(sp.file_name)) : '';
    const where = !sp ? '' : f === 'lib.rs' ? 'Строка ' + sp.line_start + ': ' : f + ', строка ' + sp.line_start + ': ';
    let msg = ru(d.message);
    if (sp && sp.label && sp.label !== d.message) msg += ' — ' + ru(sp.label);
    out.push(where + (KIND[d.level] || d.level) + (d.code && d.code.code ? ' ' + d.code.code : '') + ': ' + msg);
    for (const c of (d.children || []).slice(0, 3)) {
      if (!c.message || (c.level !== 'help' && c.level !== 'note') || /^`#\[(?:warn|deny)\(/.test(c.message)) continue;   // «#[warn(…)] on by default» — шум
      const fix = (c.spans || []).find(s => s.suggested_replacement != null);
      out.push('   ' + KIND[c.level] + ': ' + ru(c.message) + (fix && fix.suggested_replacement.length < 80 ? ' → ' + fix.suggested_replacement : ''));
    }
  }
  if (errors) out.push('Ошибок: ' + errors); else if (warns) out.push('Предупреждений: ' + warns);
  return out.concat(plain.slice(0, 20)).join('\n');
}

// ═══ Сборка ═══
let sdk = null;
const sdkText = () => sdk || (sdk = fetch('../sdk/d37.rs?v=1').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .catch(e => { sdk = null; throw new Error('не загрузился SDK sdk/d37.rs: ' + (e.message || e)); }));
function withSdk(src){
  if (/\bmod\s+d37\b/.test(src)) return src;
  const L = src.split('\n');
  let last = -1;
  for (let i = 0; i < L.length; i++) {
    const s = L[i].trim();
    if (!s || (s.startsWith('//') && !s.startsWith('//!'))) continue;
    if (s.startsWith('#![') || s.startsWith('//!')) { last = i; continue; }
    break;
  }
  if (last < 0) L[0] = HEAD + L[0]; else L[last] += ' ' + HEAD.trim();   // внутренние #![…] должны идти первыми
  return L.join('\n');
}
async function build(id, src){
  const step = text => say({ d37rust: 'progress', id, text });
  const [t, sdkSrc] = await Promise.all([toolchain(step), sdkText()]);
  step('сборка…');
  const W = t.work.contents;
  W.clear();
  W.set('lib.rs', new t.File(te.encode(withSdk(src))));
  W.set('d37.rs', new t.File(te.encode(sdkSrc)));
  W.set('out', new t.Directory([]));
  t.tmp.contents.clear();
  for (const k of [...t.root.contents.keys()]) if (k !== 'sysroot' && k !== 'work' && k !== 'tmp') t.root.contents.delete(k);   // хвосты упавшей сборки
  t.io.out.length = 0; t.io.err.length = 0;
  const t0 = performance.now();
  const r = await run(t, ARGS);
  const ms = Math.round(performance.now() - t0);
  const err = td.decode(join(t.io.err, t.io.err.reduce((a, b) => a + b.length, 0)));
  // Этот rustc собран с panic=abort: после ошибок в коде он не выходит с кодом 1, а «падает» (unreachable) — это обычный
  // отказ сборки, ферма цела. Настоящее падение — когда ошибок в коде нет.
  const said0 = r.failed ? diagnostics(err) : '';
  if (r.failed && /^Ошибок: \d+/m.test(said0) && /unreachable/.test(String(r.error))) { r.failed = false; r.code = 1; }
  if (r.failed) {
    tool = null;
    const said = said0;
    say({ d37rust: 'done', id, ok: false, reset: true, log: (said ? said + '\n' : '') + 'Компилятор Rust упал: ' + r.error, debug: { stack: r.stack || '', err: err.slice(-4000), out: td.decode(join(t.io.out, t.io.out.reduce((a, b) => a + b.length, 0))).slice(-2000) } });
    return;
  }
  const file = W.get('out') && W.get('out').contents.get('script.wasm');
  const wasm = r.code === 0 && file && file.data && file.data.length ? file.data.slice() : null;
  let log = diagnostics(err);
  if (!wasm && !log) log = r.code === 0 ? 'Компилятор не создал файл .wasm' : 'Компилятор Rust завершился с кодом ' + r.code;
  if (r.code !== 0 && r.code !== 1) tool = null;   // 101 — rustc упал сам: в следующий раз — заново
  say({ d37rust: 'done', id, ok: !!wasm, wasm, log, ms, reset: r.code !== 0 && r.code !== 1 }, wasm ? [wasm.buffer] : []);
}

// ═══ Очередь заданий от студии ═══
const queue = [];
let busy = false;
async function pump(){
  if (busy) return;
  busy = true;
  while (queue.length) {
    const d = queue.shift();
    try { await build(d.id, d.src.slice(0, MAX_SRC)); }
    catch (er) {
      const m = String(er && er.message || er);
      say({ d37rust: 'done', id: d.id, ok: false, reset: true,
        log: (/Failed to fetch|NetworkError|HTTP \d|не скачался|dynamically imported/i.test(m) ? 'Не удалось скачать компилятор Rust (нужен интернет): ' : /out of memory|allocation failed|could not allocate|памят/i.test(m) ? 'Компилятору Rust не хватило памяти (закрой лишние вкладки): ' : 'Компилятор Rust не запустился: ') + m });
    }
  }
  busy = false;
}
addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== parent) return;
  const d = e.data || {};
  if (d.d37rust === 'build' && typeof d.src === 'string') { queue.push(d); pump(); }
});
say({ d37rust: 'hello', isolated: !!self.crossOriginIsolated, v: V });

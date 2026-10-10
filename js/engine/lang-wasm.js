// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — скрипты на C++ и Rust: модуль WebAssembly в песочнице скриптов (ABI «d37», SDK — папка sdk/)
// ═══════════════════════════════════════
// Языки 'cpp' и 'rust' (kind 'binary'): в obj.code — .wasm в base64, в obj.src — исходник. Оба работают одним кодом
// wasmRuntime() внутри песочницы (Worker в iframe без сети, см. script.js): номера объектов/игроков — i32, строки — (адрес,
// длина) в памяти модуля, обработчики — экспорт d37_event(cb, arg), кадр — d37_update(dt), старт — d37_start().
// Полное описание ABI — в шапке sdk/d37.h; Rust — sdk/d37.rs и sdk/rust-template; для людей — sdk/README.md.
// C++ собирается прямо на сайте («⚙️ Собрать»): Clang/LLD, собранные в WebAssembly — YoWASP, npm @yowasp/clang (ISC;
// LLVM — Apache-2.0 с исключением LLVM), с jsDelivr при первой сборке (~23 МБ brotli, дальше — кэш браузера), в своём
// module Worker (страница не замирает); флаги — CPP_ARGS (wasm32-wasip1 + libc++: std::string, std::vector, printf).
// Rust собирается у себя (cargo, wasm32-unknown-unknown) и загружается кнопкой «📦 Загрузить .wasm».
// Проверка без браузера: node scripts/lang-wasm-test.cjs (настоящие модули: clang из npm, cargo — если установлены).
(() => {
  const E = window.D37E = window.D37E || {};
  const ABI = 1;
  const CLANG_CDN = 'https://cdn.jsdelivr.net/npm/@yowasp/clang@22.0.0-git20542-10/';
  // корень сайта — по адресу этого файла (для sdk/d37.h)
  const ROOT = (() => { try { const s = document.currentScript && document.currentScript.src; if (s) return s.replace(/js\/engine\/lang-wasm\.js(\?.*)?$/, ''); } catch (e) {} return '/'; })();

  // ═══ Внутри песочницы (Worker): ничего снаружи эта функция не видит, уходит туда текстом ═══
  function wasmRuntime(){
    'use strict';
    const L = globalThis.D37Lang = globalThis.D37Lang || {};
    if (L.cpp && L.cpp.abi === 1 && L.rust) return;
    const MAX_STR = 4096, MAX_CALLS = 200000, MAX_CMDS = 5000, MAX_PRINTS = 200, MAX_ERRORS = 30, MAX_MEM = 256 * 1048576, MAX_TIMERS = 2000, MAX_HANDLES = 1000000;
    const EASE = ['linear', 'quad', 'sine', 'back', 'bounce', 'elastic'];
    const KINDS = ['Part', 'WedgePart', 'PointLight', 'Model', 'SpawnLocation'];
    const VEC = ['Position', 'Size', 'Orientation'];
    const NUM = { 9: 'Transparency', 10: 'CanCollide', 11: 'Anchored', 12: 'Color', 13: 'CastShadow', 14: 'Range', 15: 'Brightness' };
    const STR = ['Name', 'Material', 'Shape', 'Text', 'ClassName'];
    const SHAPES = { block: 'block', ball: 'ball', cyl: 'cyl', wedge: 'wedge', Block: 'block', Ball: 'ball', Cylinder: 'cyl', Wedge: 'wedge' };
    const WASI = 'wasi_snapshot_preview1', EBADF = 8, ENOSYS = 52, ESPIPE = 70;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const clamp01 = v => Math.max(0, Math.min(1, v));
    class Bad extends Error {}   // ошибка «по правилам» (неверный адрес, номер…), не падение модуля
    const bad = m => new Bad(m);
    const fromB64 = s => { const b = atob(s.replace(/\s+/g, '')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
    // падения WebAssembly (trap) — по-русски
    const TRAPS = [
      [/table index|null function|uninitiali[sz]ed element|signature mismatch|indirect call|call_indirect|function signature/i, 'неверный указатель на функцию (обработчик)'],
      [/out of bounds|memory access/i, 'обращение за границы памяти (неверный указатель или индекс массива)'],
      [/unreachable/i, 'аварийная остановка (panic / abort / unreachable)'],
      [/divi(de|sion) by zero|remainder by zero/i, 'деление на ноль'],
      [/integer overflow|unrepresentable|invalid conversion/i, 'число не помещается в целое (переполнение)'],
      [/call stack|stack overflow|too much recursion/i, 'переполнение стека — бесконечная рекурсия?'],
      [/out of memory|allocation failed|could not allocate/i, 'не хватило памяти'],
    ];
    const trapText = m => { for (const [re, t] of TRAPS) if (re.test(m)) return t; return m; };
    // где упало: первая «своя» функция модуля из стека (имена — из секции name; лямбда, встроенная в std::function, —
    // по аргументу шаблона: …player_box<start()::$_0>…)
    const INTERNAL = /(^|[\s<(,:&*])(std|core|alloc|d37)::|^(__|_initialize|rust_|panic_abort|dlmalloc|abort$|exit$|d37_(event|start|update|export_\w+)\b)/;
    const LAMBDA = /((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*\([^()]*\))::\$_\d+/, CLOSURE = /((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*)::\{\{closure\}\}/;
    const mine = p => !/(^|::)(d37|std|core|alloc)(::|$)/.test(p);
    function whereOf(st){
      for (const line of String(st || '').split('\n')) {
        if (!/wasm-function|wasm:\/\//.test(line)) continue;
        const m = /^\s*at\s+(?:async\s+)?(.+?)\s+\(wasm:\/\//.exec(line) || /^\s*([^@\s][^@]*)@.*wasm-function/.exec(line);
        let n = m ? m[1].trim() : '';
        if (!n || /^(wasm-function|\$?func\d+$)/.test(n)) continue;
        n = n.replace(/^\$/, '').replace(/^[^\s:<>()]+\.wasm\./, '').replace(/::h[0-9a-f]{16}$/, '');   // «script.wasm.» — имя модуля у V8
        const l = LAMBDA.exec(n), c = CLOSURE.exec(n);
        if (INTERNAL.test(n)) {
          if (l && mine(l[1])) return ' (в функции ' + l[1] + ' → лямбда)';
          if (c && mine(c[1])) return ' (в функции ' + c[1].replace(/^[a-z_][a-z0-9_]*::/, '') + ' → замыкание)';
          continue;
        }
        n = n.replace(/^d37_script::/, '').replace(/::\{\{closure\}\}/g, ' → замыкание').replace(/::\$_\d+::operator\(\)\(.*$/, ' → лямбда');
        return ' (в функции ' + n.slice(0, 80) + ')';
      }
      return '';
    }

    const MODS = new Map();   // одинаковые скрипты (копии монеток) — модуль собирается один раз, экземпляры свои
    function run(code, env, ctx){
      code = String(code || '');
      let bytes = null;
      if (!MODS.has(code)) {
        try { bytes = fromB64(code); } catch (e) { ctx.error('wasm: файл повреждён (не base64) — собери или загрузи заново', 0); return; }
        if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) { ctx.error('wasm: это не WebAssembly — собери или загрузи заново', 0); return; }
      }
      const W = env.workspace, Vec = env.Vector3, P = env.Players;
      const H = [null], byObj = new Map(), byPl = new Map(), conns = new Set(), timers = new Set();
      const dec = { 1: new TextDecoder(), 2: new TextDecoder() }, out = { 1: '', 2: '' }, TE = new TextEncoder(), TD = new TextDecoder();
      let mem = null, ex = null, dead = false, depth = 0, calls = 0, cmds = 0, prints = 0, errors = 0, said = false, target = 0, beat = null, late = false;
      const t0 = now();
      // ── номера (handle): объект, игрок, подписка, таймер, tween — один счёт, 0 — нет ──
      const hOf = (map, key, rec) => { let h = map.get(key); if (!h) { if (H.length > MAX_HANDLES) throw bad('слишком много номеров'); h = H.length; H.push(rec); map.set(key, h); } return h; };
      const hObj = px => px && px !== W && px.__id ? hOf(byObj, px.__id, { o: px.__id }) : 0;
      const hPl = p => p && p.UserId !== undefined && p.UserId !== null ? hOf(byPl, String(p.UserId), { p: p.UserId }) : 0;
      const keep = rec => { if (H.length > MAX_HANDLES) throw bad('слишком много номеров'); H.push(rec); return H.length - 1; };
      const obj = h => { const r = H[h]; if (!r || r.o === undefined) throw bad('неверный номер объекта: ' + h); return ctx.proxyOf(r.o); };
      const objW = h => (h === 0 ? W : obj(h));
      const pl = h => { const r = H[h]; if (!r || r.p === undefined) throw bad('неверный номер игрока: ' + h); return ctx.playerOf(r.p); };   // null — игрок вышел
      const num = (v, what) => { if (!Number.isFinite(v)) throw bad(what + ': не число (NaN или бесконечность)'); return v; };
      const tick = () => { if (++calls > MAX_CALLS) throw bad('больше ' + MAX_CALLS + ' обращений к сайту за один вызов — бесконечный цикл?'); };
      const cmd = () => { tick(); if (++cmds > MAX_CMDS) throw bad('больше ' + MAX_CMDS + ' команд миру за один вызов'); };
      // ── память модуля: каждый адрес и длина проверяются ──
      const buf = () => { if (!mem) throw bad('модуль не экспортирует memory'); return mem.buffer; };
      const span = (p, n, what) => { const b = buf(); p >>>= 0; n |= 0; if (n < 0 || p > b.byteLength || n > b.byteLength - p) throw bad(what + ' за границами памяти (адрес ' + p + ', длина ' + n + ')'); return p; };
      const str = (p, n) => { const a = span(p, n, 'строка'); return TD.decode(new Uint8Array(buf(), a, Math.min(n | 0, MAX_STR)).slice()); };
      const put = (p, cap, s) => {
        const a = span(p, cap, 'буфер');
        let b = TE.encode(String(s == null ? '' : s));
        if (b.length > cap) { let n = cap; while (n > 0 && (b[n] & 0xc0) === 0x80) n--; b = b.subarray(0, n); }   // по границе символа
        new Uint8Array(buf(), a, b.length).set(b);
        return b.length;
      };
      const dv = () => new DataView(buf());
      // ── вывод ──
      const say = (kind, text) => {
        if (++prints > MAX_PRINTS) { if (prints === MAX_PRINTS + 1) env.warn('wasm: больше ' + MAX_PRINTS + ' строк вывода за один вызов — остальное скрыто'); return; }
        (kind === 'warn' ? env.warn : env.print)(text);
      };
      const emit = (fd, bytes) => {
        out[fd] += dec[fd].decode(bytes, { stream: true });
        let i;
        while ((i = out[fd].indexOf('\n')) >= 0) { say(fd === 2 ? 'warn' : 'log', out[fd].slice(0, i)); out[fd] = out[fd].slice(i + 1); }
        if (out[fd].length > MAX_STR) { say(fd === 2 ? 'warn' : 'log', out[fd]); out[fd] = ''; }
      };
      const flush = () => { for (const fd of [1, 2]) if (out[fd]) { say(fd === 2 ? 'warn' : 'log', out[fd]); out[fd] = ''; } };
      // ── вход в модуль: счётчики, ошибки, память ──
      function enter(f){
        if (dead) return;
        const top = depth === 0;
        if (top) { calls = 0; cmds = 0; prints = 0; said = false; }
        depth++;
        try { if (ctx.setCurrent) ctx.setCurrent(ctx.name); f(); }
        catch (e) { fail(e); }
        finally {
          depth--;
          if (top) {
            try { flush(); } catch (e) {}
            if (mem && mem.buffer.byteLength > MAX_MEM) stop('модуль занял больше 256 МБ памяти — скрипт остановлен');
            if (ctx.setCurrent) ctx.setCurrent('');   // ошибки чужих task.delay не припишутся этому скрипту (из событий runtime вернёт своё)
          }
        }
      }
      function fail(e){
        if (dead) return;
        if (e && e.d37exit !== undefined) { if (e.d37exit === 0) env.print('wasm: программа завершилась (exit 0)'); stop(e.d37exit === 0 ? '' : 'программа завершилась с кодом ' + e.d37exit); return; }
        const m = String(e && e.message || e), trap = !(e instanceof Bad);
        if (!(trap && said && /unreachable/i.test(m))) ctx.error('wasm: ' + (trap ? trapText(m) : m) + whereOf(e && e.stack), 0);   // паника уже сообщена через error()
        if (++errors >= MAX_ERRORS) stop('больше ' + MAX_ERRORS + ' ошибок — скрипт остановлен');
      }
      function stop(msg){
        if (dead) return;
        dead = true;
        for (const c of conns) { try { c.Disconnect(); } catch (e) {} }
        conns.clear();
        for (const h of timers) { const r = H[h]; if (r && r.tm) (r.every ? clearInterval : clearTimeout)(r.tm); }
        timers.clear();
        if (beat) { try { beat.Disconnect(); } catch (e) {} beat = null; }
        if (msg) ctx.error('wasm: ' + msg, 0);
      }
      const needEvent = () => { if (!ex || typeof ex.d37_event !== 'function') throw bad('нет экспорта d37_event — подключи d37.h (C++) или d37.rs (Rust)'); };
      const fire = (cb, arg, tgt) => enter(() => { needEvent(); const prev = target; target = tgt | 0; try { ex.d37_event(cb | 0, arg | 0); } finally { target = prev; } });
      const conn = c => { conns.add(c); return keep({ c }); };
      const timer = (sec, cb, every) => {
        if (timers.size >= MAX_TIMERS) throw bad('больше ' + MAX_TIMERS + ' таймеров сразу');
        const h = keep({ tm: 0, every });
        const ms = Math.max(every ? 0.03 : 0, Number.isFinite(sec) ? sec : 0) * 1000;
        H[h].tm = every ? setInterval(() => fire(cb, h, 0), ms) : setTimeout(() => { H[h].tm = 0; timers.delete(h); fire(cb, h, 0); }, ms);
        timers.add(h);
        return h;
      };
      const vecOf = v => (v ? [+v.X || 0, +v.Y || 0, +v.Z || 0] : [0, 0, 0]);
      // ── функции сайта: модуль импорта "d37" (список и смысл — sdk/d37.h) ──
      const D = {
        print: (p, n) => { cmd(); say('log', str(p, n)); },
        warn: (p, n) => { cmd(); say('warn', str(p, n)); },
        error: (p, n, line) => { cmd(); said = true; ctx.error(str(p, n), line | 0); },
        script: () => { tick(); const sp = env.script && env.script.Parent; return sp && sp !== W ? hObj(sp) : 0; },
        find: (p, n) => { tick(); return hObj(W.FindFirstChild(str(p, n), true)); },
        find_in: (h, p, n, deep) => { tick(); return hObj(objW(h).FindFirstChild(str(p, n), !!deep)); },
        parent: h => { tick(); const o = obj(h).Parent; return o && o !== W ? hObj(o) : 0; },
        children: h => { tick(); return objW(h).GetChildren().length; },
        child: (h, i) => { tick(); const a = objW(h).GetChildren(); return i >= 0 && i < a.length ? hObj(a[i]) : 0; },
        exists: h => { tick(); const r = H[h]; if (!r) return 0; if (r.o !== undefined) return ctx.objs.has(r.o) ? 1 : 0; if (r.p !== undefined) return ctx.players.has(r.p) ? 1 : 0; return 0; },
        get: (h, k) => {
          tick(); const o = obj(h);
          if (k >= 0 && k <= 8) return vecOf(o[VEC[(k / 3) | 0]])[k % 3];
          if (!has(NUM, k)) throw bad('get: нет свойства №' + k);
          const v = o[NUM[k]];
          if (k === 12) return /^#[0-9a-f]{6}$/i.test(v) ? parseInt(String(v).slice(1), 16) : 0;
          return typeof v === 'boolean' ? (v ? 1 : 0) : +v || 0;
        },
        set: (h, k, v) => {
          cmd(); const o = obj(h); num(v, 'set');
          if (k >= 0 && k <= 8) { const name = VEC[(k / 3) | 0], a = vecOf(o[name]); a[k % 3] = v; o[name] = new Vec(a[0], a[1], a[2]); return; }
          if (k === 12) { if (!(v >= 0 && v <= 0xffffff)) throw bad('цвет: нужно число 0xRRGGBB'); o.Color = '#' + (Math.round(v) >>> 0).toString(16).padStart(6, '0'); return; }
          if (k === 10 || k === 11 || k === 13) { o[NUM[k]] = v !== 0; return; }
          if (!has(NUM, k)) throw bad('set: нет свойства №' + k);
          o[NUM[k]] = v;
        },
        set3: (h, what, x, y, z) => {
          cmd(); const o = obj(h); num(x, 'x'); num(y, 'y'); num(z, 'z');
          if (what >= 0 && what <= 2) { o[VEC[what]] = new Vec(x, y, z); return; }
          if (what === 3) { o.Color = env.Color3.new(clamp01(x), clamp01(y), clamp01(z)); return; }
          throw bad('set3: «что» — 0 положение, 1 размер, 2 поворот, 3 цвет');
        },
        get_str: (h, k, b, cap) => { tick(); const o = obj(h); if (!STR[k]) throw bad('get_str: нет свойства №' + k); return put(b, cap, o[STR[k]]); },
        set_str: (h, k, p, n) => {
          cmd(); const o = obj(h), s = str(p, n);
          if (k === 0) { o.Name = s; return; }
          if (k === 1) { const all = Object.values(env.Enum.Material), m = has(env.Enum.Material, s) ? env.Enum.Material[s] : s.toLowerCase(); if (!all.includes(m)) throw bad('нет материала «' + s + '» (есть: ' + all.join(', ') + ')'); o.Material = m; return; }
          if (k === 2) { if (!has(SHAPES, s)) throw bad('нет формы «' + s + '» (есть: block, ball, cyl, wedge)'); o.Shape = SHAPES[s]; return; }
          if (k === 3) { o.Text = s; return; }
          throw bad('set_str: нет свойства №' + k);
        },
        create: (kind, parent) => { cmd(); if (!KINDS[kind]) throw bad('create: вид 0 деталь, 1 клин, 2 свет, 3 модель, 4 точка появления'); return hObj(env.Instance.new(KINDS[kind], parent ? obj(parent) : W)); },
        clone: h => { cmd(); return hObj(obj(h).Clone()); },
        destroy: h => { cmd(); obj(h).Destroy(); },
        set_parent: (h, parent) => { cmd(); const o = obj(h); o.Parent = parent ? obj(parent) : W; },
        tween: (h, what, x, y, z, time, ease, rev, rep, dly) => {
          cmd(); const o = obj(h); num(x, 'x'); num(y, 'y'); num(z, 'z'); num(time, 'время');
          const goals = what >= 0 && what <= 2 ? { [VEC[what]]: new Vec(x, y, z) } : what === 3 ? { Color: env.Color3.new(clamp01(x), clamp01(y), clamp01(z)) } : what === 4 ? { Transparency: clamp01(x) } : null;
          if (!goals) throw bad('tween: «что» — 0 положение, 1 размер, 2 поворот, 3 цвет, 4 прозрачность');
          const tw = env.TweenService.Create(o, { Time: Math.max(0.01, time), EasingStyle: EASE[ease] || 'quad', Reverses: !!rev, RepeatCount: rep | 0, DelayTime: Number.isFinite(dly) ? Math.max(0, dly) : 0 }, goals);
          tw.Play();
          return keep({ tw });
        },
        tween_cancel: t => { cmd(); const r = H[t]; if (!r || !r.tw) throw bad('неверный номер tween: ' + t); r.tw.Cancel(); },
        on_tween_done: (t, cb) => { tick(); needEvent(); const r = H[t]; if (!r || !r.tw) throw bad('неверный номер tween: ' + t); return conn(r.tw.Completed.Connect(() => fire(cb, t, 0))); },
        on_touched: (h, cb) => { tick(); needEvent(); return conn(obj(h).Touched.Connect((hit, p) => fire(cb, hPl(p), h))); },
        on_touch_ended: (h, cb) => { tick(); needEvent(); return conn(obj(h).TouchEnded.Connect((hit, p) => fire(cb, hPl(p), h))); },
        on_clicked: (h, cb) => { tick(); needEvent(); return conn(obj(h).Clicked.Connect(p => fire(cb, hPl(p), h))); },
        prompt: (h, p, n, hold, cb) => {
          cmd(); const o = obj(h), pr = o.Prompt(str(p, n) || 'Нажать', Number.isFinite(hold) ? hold : 0);
          if (!cb) return 0;   // cb 0 — только поменять текст
          needEvent();
          return conn(pr.Triggered.Connect(q => fire(cb, hPl(q), h)));
        },
        on_player_added: cb => {
          tick(); needEvent();
          const c = P.PlayerAdded.Connect(p => fire(cb, hPl(p), 0)), hc = conn(c);
          if (late) for (const p of P.GetPlayers()) { const hp = hPl(p); setTimeout(() => { if (H[hc].c) fire(cb, hp, 0); }, 0); }   // старт после сборки — уже вошедшие
          return hc;
        },
        on_player_removing: cb => { tick(); needEvent(); return conn(P.PlayerRemoving.Connect(p => fire(cb, hPl(p), 0))); },
        on_died: cb => {
          tick(); needEvent();
          const list = [], hook = p => { const hp = hPl(p); list.push(p.Humanoid.Died.Connect(() => fire(cb, hp, 0))); };
          for (const p of P.GetPlayers()) hook(p);
          list.push(P.PlayerAdded.Connect(hook));
          return conn({ Disconnect(){ for (const c of list) c.Disconnect(); list.length = 0; } });
        },
        off: c => { tick(); const r = H[c]; if (!r || !('c' in r)) throw bad('неверный номер подписки: ' + c); if (r.c) { r.c.Disconnect(); conns.delete(r.c); r.c = null; } },
        want_update: on => {
          tick();
          if (on && !beat) { if (typeof ex.d37_update !== 'function') throw bad('want_update(1): нет экспорта d37_update'); beat = env.RunService.Heartbeat.Connect(dt => enter(() => ex.d37_update(+dt || 0))); }
          else if (!on && beat) { beat.Disconnect(); beat = null; }
        },
        event_target: () => { tick(); return target; },
        delay: (sec, cb) => { tick(); needEvent(); return timer(sec, cb, false); },
        every: (sec, cb) => { tick(); needEvent(); return timer(sec, cb, true); },
        cancel: t => { tick(); const r = H[t]; if (!r || !('tm' in r)) throw bad('неверный номер таймера: ' + t); if (r.tm) { (r.every ? clearInterval : clearTimeout)(r.tm); r.tm = 0; } timers.delete(t); },
        random: () => { tick(); return Math.random(); },
        random_int: (a, b) => { tick(); a |= 0; b |= 0; if (b < a) { const t = a; a = b; b = t; } return a + Math.floor(Math.random() * (b - a + 1)); },
        time: () => { tick(); return (now() - t0) / 1000; },
        players: () => { tick(); return P.GetPlayers().length; },
        player: i => { tick(); const a = P.GetPlayers(); return i >= 0 && i < a.length ? hPl(a[i]) : 0; },
        player_name: (h, b, cap) => { tick(); const p = pl(h); return put(b, cap, p ? p.Name : ''); },
        pget: (h, k) => {
          tick(); const p = pl(h); if (!p) return 0;
          const hu = p.Humanoid;
          if (k === 0) return +hu.Health || 0; if (k === 1) return +hu.MaxHealth || 0; if (k === 2) return +hu.WalkSpeed || 0; if (k === 3) return +hu.JumpPower || 0;
          if (k >= 4 && k <= 6) return vecOf(p.Position)[k - 4];
          throw bad('pget: нет свойства №' + k);
        },
        pset: (h, k, v) => {
          cmd(); num(v, 'pset'); const p = pl(h); if (!p) return;
          const hu = p.Humanoid;
          if (k === 0) hu.Health = v; else if (k === 1) hu.MaxHealth = v; else if (k === 2) hu.WalkSpeed = v; else if (k === 3) hu.JumpPower = v;
          else if (k >= 4 && k <= 6) { const a = vecOf(p.Position); a[k - 4] = v; p.Teleport(new Vec(a[0], a[1], a[2])); }
          else throw bad('pset: нет свойства №' + k);
        },
        stat_get: (h, kp, kn) => { tick(); const p = pl(h), k = str(kp, kn); return p ? +p.GetStat(k) || 0 : 0; },
        stat_set: (h, kp, kn, v) => { cmd(); num(v, 'stat_set'); const p = pl(h), k = str(kp, kn); if (p) p.SetStat(k, v); },
        stat_add: (h, kp, kn, d) => { cmd(); num(d, 'stat_add'); const p = pl(h), k = str(kp, kn); if (p) p.AddStat(k, d); },
        teleport: (h, x, y, z) => { cmd(); num(x, 'x'); num(y, 'y'); num(z, 'z'); const p = pl(h); if (p) p.Teleport(new Vec(x, y, z)); },
        message: (h, sp, sn, sec) => { cmd(); const p = pl(h), s = str(sp, sn); if (p) p.Message(s, Number.isFinite(sec) ? sec : 3); },
        kill: h => { cmd(); const p = pl(h); if (p) p.Kill(); },
        respawn: h => { cmd(); const p = pl(h); if (p) p.LoadCharacter(); },
        gui_message: (sp, sn, sec) => { cmd(); env.gui.message(str(sp, sn), Number.isFinite(sec) ? sec : 3); },
        gui_text: (kp, kn, sp, sn) => { cmd(); env.gui.text(str(kp, kn), str(sp, sn)); },
        gui_clear: (kp, kn) => { cmd(); env.gui.clear(str(kp, kn)); },
        sound: (sp, sn, at) => { cmd(); env.sound.play(str(sp, sn), at ? obj(at) : undefined); },
      };
      // ── WASI (C/C++ с libc): вывод printf → «Вывод», часы, случайность; файлов и сети нет ──
      const zero32 = (...ps) => { const d = dv(); for (const p of ps) d.setUint32(span(p, 4, 'WASI'), 0, true); return 0; };
      const X = {
        fd_write: (fd, iovs, cnt, nw) => {
          tick(); if (fd !== 1 && fd !== 2) return EBADF;
          const d = dv(), base = span(iovs, (cnt | 0) * 8, 'WASI'); let total = 0;
          for (let i = 0; i < cnt; i++) { const p = d.getUint32(base + i * 8, true), n = d.getUint32(base + i * 8 + 4, true); emit(fd, new Uint8Array(buf(), span(p, n, 'printf'), n)); total += n; }
          dv().setUint32(span(nw, 4, 'WASI'), total, true);
          return 0;
        },
        fd_read: (fd, iovs, cnt, nr) => { tick(); zero32(nr); return fd === 0 ? 0 : EBADF; },
        fd_close: () => { tick(); return 0; },
        fd_seek: () => { tick(); return ESPIPE; },
        fd_fdstat_get: (fd, p) => { tick(); if (fd < 0 || fd > 2) return EBADF; const a = span(p, 24, 'WASI'), d = dv(); for (let i = 0; i < 24; i++) d.setUint8(a + i, 0); d.setUint8(a, 2); return 0; },   // символьное устройство: построчный вывод
        fd_prestat_get: () => { tick(); return EBADF; },
        fd_prestat_dir_name: () => { tick(); return EBADF; },
        environ_sizes_get: (a, b) => { tick(); return zero32(a, b); },
        environ_get: () => { tick(); return 0; },
        args_sizes_get: (a, b) => { tick(); return zero32(a, b); },
        args_get: () => { tick(); return 0; },
        clock_time_get: (id, prec, p) => { tick(); dv().setBigUint64(span(p, 8, 'WASI'), id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(now() * 1e6)), true); return 0; },
        clock_res_get: (id, p) => { tick(); dv().setBigUint64(span(p, 8, 'WASI'), 1000n, true); return 0; },
        random_get: (p, n) => {
          tick(); const u = new Uint8Array(buf(), span(p, n, 'WASI'), n | 0);
          if (globalThis.crypto && crypto.getRandomValues) for (let i = 0; i < u.length; i += 65536) crypto.getRandomValues(u.subarray(i, i + 65536));
          else for (let i = 0; i < u.length; i++) u[i] = Math.random() * 256 | 0;
          return 0;
        },
        sched_yield: () => { tick(); return 0; },
        proc_exit: code => { const e = new Error('exit'); e.d37exit = code | 0; throw e; },
      };
      const missing = (m, n) => () => { throw bad('функции ' + m + '.' + n + ' на сайте нет' + (m === 'd37' ? ' (SDK новее сайта — обнови страницу)' : m === 'env' ? ' — она объявлена, но нигде не написана' : '')); };
      // ── загрузка ──
      function boot(mod){
        const imports = {}, unknown = [];
        let imem = null;
        for (const im of WebAssembly.Module.imports(mod)) {
          const ns = imports[im.module] = imports[im.module] || {};
          if (im.kind === 'function') {
            const f = im.module === 'd37' && has(D, im.name) ? D[im.name] : im.module === WASI ? (has(X, im.name) ? X[im.name] : () => { tick(); return ENOSYS; }) : null;
            if (!f) unknown.push(im.module + '.' + im.name);
            ns[im.name] = f || missing(im.module, im.name);
          } else if (im.kind === 'memory' && !imem) ns[im.name] = imem = new WebAssembly.Memory({ initial: 256, maximum: 4096 });
          else { ctx.error('wasm: модуль просит ' + im.kind + ' «' + im.module + '.' + im.name + '» — такого на сайте нет', 0); return; }
        }
        if (unknown.length) env.warn('wasm: «' + ctx.name + '» зовёт функции, которых на сайте нет: ' + unknown.slice(0, 8).join(', ') + (unknown.length > 8 ? '…' : ''));
        const go = inst => {
          ex = inst.exports;
          mem = ex.memory instanceof WebAssembly.Memory ? ex.memory : imem;
          enter(() => {
            if (typeof ex._initialize === 'function') ex._initialize();
            else if (typeof ex.__wasm_call_ctors === 'function') ex.__wasm_call_ctors();
            if (typeof ex.d37_start !== 'function') throw bad('нет функции d37_start — в C++ напиши void start() { … }, в Rust — fn start() и mod d37');
            ex.d37_start();
          });
        };
        let inst;
        try { inst = new WebAssembly.Instance(mod, imports); }
        catch (e) {
          if (e instanceof RangeError || /synchronous|main thread/i.test(e && e.message)) { late = true; return WebAssembly.instantiate(mod, imports).then(go, e2 => ctx.error('wasm: ' + String(e2 && e2.message || e2), 0)); }
          if (e instanceof WebAssembly.LinkError) { ctx.error('wasm: модуль не подходит к сайту: ' + e.message, 0); return; }
          fail(e); return;
        }
        go(inst);
      }
      let mod = MODS.get(code);
      if (!mod) {
        try { mod = new WebAssembly.Module(bytes); }
        catch (e) {
          if (e instanceof WebAssembly.CompileError) { ctx.error('wasm: файл повреждён или собран не в WebAssembly: ' + String(e.message).slice(0, 150), 0); return; }
          late = true;   // большой модуль: синхронно нельзя — собираем асинхронно, старт — после остальных скриптов
          return WebAssembly.compile(bytes).then(m => { if (MODS.size < 32) MODS.set(code, m); return boot(m); }, e2 => ctx.error('wasm: ' + String(e2 && e2.message || e2).slice(0, 200), 0));
        }
        if (MODS.size < 32) MODS.set(code, mod);
      }
      return boot(mod);
    }
    L.cpp = { abi: 1, run };
    L.rust = { abi: 1, run };
  }

  // ═══ Сборка C++ прямо на сайте: clang в module Worker ═══
  const CPP_ARGS = ['clang++', '--target=wasm32-wasip1', '-mexec-model=reactor', '-std=c++20', '-O2', '-fno-exceptions', '-Wall', '-Wno-sign-compare', '-include', 'd37.h',
    '-Wl,--stack-first', '-Wl,-z,stack-size=262144', '-Wl,--max-memory=268435456', 'script.cpp', '-o', 'script.wasm'];
  const cppJob = (src, header) => ({ args: CPP_ARGS.slice(), files: { 'script.cpp': String(src), 'd37.h': String(header) }, out: 'script.wasm' });
  // сообщения clang/lld → по-русски (оригинал — в скобках, чтобы спросить ИИ)
  const DICT = [
    [/^use of undeclared identifier '(.+)'; did you mean '(.+)'\?$/, 'неизвестное имя «$1» — может, «$2»?'],
    [/^use of undeclared identifier '(.+)'$/, 'неизвестное имя «$1» (опечатка или не объявлено)'],
    [/^no member named '(.+)' in '(.+)'; did you mean '(.+)'\?$/, 'у «$2» нет «$1» — может, «$3»?'],
    [/^member reference type '(.+)' is a pointer; did you mean to use '->'\?$/, 'это указатель — пиши «->» вместо «.»'],
    [/^invalid operands to binary expression \('(.+)' and '(.+)'\)$/, 'эта операция не подходит к «$1» и «$2»'],
    [/^no viable conversion from '(.+)' to '(.+)'$/, 'нельзя превратить «$1» в «$2»'],
    [/^using the result of an assignment as a condition without parentheses$/, 'присваивание «=» в условии — для сравнения нужно «==»'],
    [/^use '==' to turn this assignment into an equality comparison$/, 'для сравнения пиши «==»'],
    [/^place parentheses around the assignment to silence this warning$/, 'если так и задумано — возьми присваивание в скобки'],
    [/^implicit conversion from '(.+)' to '(.+)' changes value from (.+) to (.+)$/, 'число $3 превратится в $4 (дробная часть потеряется)'],
    [/^variable '(.+)' set but not used$/, 'переменной «$1» присваивают, но не используют'],
    [/^unused function '(.+)'$/, 'функция «$1» нигде не вызывается'],
    [/^expression result unused$/, 'результат выражения не используется'],
    [/^call to undeclared function '(.+)'.*$/, 'неизвестная функция «$1»'],
    [/^unknown type name '(.+)'$/, 'неизвестный тип «$1»'],
    [/^expected ';' .*$/, 'пропущена «;»'],
    [/^expected '(.+)'$/, 'ожидался символ «$1»'],
    [/^expected expression$/, 'ожидалось выражение'],
    [/^expected unqualified-id$/, 'ожидалось имя'],
    [/^extraneous closing brace .*$/, 'лишняя «}»'],
    [/^no matching function for call to '(.+)'$/, 'нет подходящей функции «$1» (не те аргументы?)'],
    [/^no matching member function for call to '(.+)'$/, 'нет подходящего метода «$1» (не те аргументы?)'],
    [/^no member named '(.+)' in '(.+)'$/, 'у «$2» нет «$1»'],
    [/^no member named '(.+)' in namespace '(.+)'$/, 'в «$2» нет «$1»'],
    [/^too few arguments to function call.*$/, 'не хватает аргументов'],
    [/^too many arguments to function call.*$/, 'лишние аргументы'],
    [/^redefinition of '(.+)'$/, '«$1» объявлено второй раз'],
    [/^cannot use '(try|throw)' with exceptions disabled$/, 'исключения (try / throw) не поддерживаются'],
    [/^'(.+)' file not found$/, 'нет файла «$1»'],
    [/^non-void function does not return a value.*$/, 'функция должна вернуть значение (return)'],
    [/^variable '(.+)' is uninitialized when used here.*$/, 'переменная «$1» используется без значения'],
    [/^initialize the variable '(.+)' to silence this warning$/, 'задай «$1» начальное значение'],
    [/^unused variable '(.+)'.*$/, 'переменная «$1» не используется'],
    [/^undefined symbol: start\(\)$/, 'нет функции start() — напиши void start() { … }'],
    [/^undefined symbol: (.+)$/, 'нет функции $1 — объявлена, но нигде не написана'],
  ];
  const KIND = { error: 'ошибка', 'fatal error': 'ошибка', warning: 'предупреждение', note: 'примечание' };
  function ru(msg){
    const flag = /\s(\[-W[^\]]+\])$/.exec(msg), core = flag ? msg.slice(0, flag.index) : msg;
    for (const [re, t] of DICT) if (re.test(core)) return core.replace(re, t) + ' (' + msg + ')';
    return msg;
  }
  function russify(log){
    const outl = [];
    for (const line of String(log || '').replace(/\r/g, '').split('\n')) {
      if (!line.trim() || /^In file included from /.test(line)) continue;
      let m = /^\s*(\d+) (warning|error)s? generated\.?$/.exec(line);
      if (m) { outl.push((m[2] === 'error' ? 'Ошибок: ' : 'Предупреждений: ') + m[1]); continue; }
      m = /^(?:\.\/|\/)?([^\s:]+):(\d+):(\d+): (fatal error|error|warning|note): (.*)$/.exec(line);
      if (m) { const where = m[1] === 'script.cpp' ? 'Строка ' + m[2] : m[1] === 'd37.h' ? 'd37.h, строка ' + m[2] : m[1] + ':' + m[2]; outl.push(where + ': ' + KIND[m[4]] + ': ' + ru(m[5])); continue; }
      m = /^wasm-ld: (error|warning): (?:\S+\.o: )?(.*)$/.exec(line);
      if (m) { outl.push('Сборка: ' + KIND[m[1]] + ': ' + ru(m[2])); continue; }
      if (/^ERR /.test(line)) { outl.push('Не удалось загрузить компилятор (нужен интернет): ' + line.slice(4)); continue; }
      outl.push(line.length > 160 ? line.slice(0, 160) + '…' : line);
    }
    return outl.join('\n');
  }
  function cppResult(ok, wasm, log){
    const text = russify(log);
    if (!ok || !wasm || !wasm.length) { const e = new Error(text.split('\n')[0] || 'Не собралось'); e.log = text || 'Не собралось'; throw e; }
    return { wasm: wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm), log: text };
  }
  // код потока компилятора (module Worker из Blob): грузит @yowasp/clang с CDN один раз
  function clangWorkerMain(CDN){
    let rc = null, loading = null;
    self.onmessage = async e => {
      const d = e.data || {}, dec = new TextDecoder();
      let log = '';
      const add = b => { if (b) log += dec.decode(b, { stream: true }); };
      try {
        if (!rc) {
          // сначала только скачать (args = null): иначе clang качает при первом «-###» без нашего счётчика
          if (!loading) loading = import(CDN + 'gen/bundle.js').then(async m => { await m.runClang(null, {}, { fetchProgress: s => self.postMessage({ id: d.id, progress: [s.doneLength, s.totalLength] }) }); return m.runClang; });
          rc = await loading;
        }
        self.postMessage({ id: d.id, phase: 'build' });
        const out = await rc(d.args, d.files, { stdout: add, stderr: add, decodeASCII: false });
        const w = out && out[d.out] ? new Uint8Array(out[d.out]).slice() : null;
        self.postMessage({ id: d.id, ok: !!w, wasm: w, log }, w ? [w.buffer] : []);
      } catch (er) {
        if (!rc) loading = null;   // не загрузилось — в следующий раз заново
        self.postMessage({ id: d.id, ok: false, log: log || 'ERR ' + String(er && er.message || er) });
      }
    };
  }
  let CW = null, cwIdle = 0, cwSeq = 0;
  const cwJobs = new Map();
  function killCW(){ clearTimeout(cwIdle); if (CW) { try { CW.terminate(); } catch (e) {} CW = null; } }
  function clangWorker(){
    if (CW) return CW;
    const url = URL.createObjectURL(new Blob(['(' + clangWorkerMain.toString() + ')(' + JSON.stringify(CLANG_CDN) + ');'], { type: 'text/javascript' }));
    CW = new Worker(url, { type: 'module' });
    CW.onmessage = e => {
      const d = e.data || {}, j = cwJobs.get(d.id); if (!j) return;
      if (d.progress) { j.step('progress', d.progress); return; }
      if (d.phase) { j.arm(120e3, 'Сборка идёт дольше 2 минут — остановлена'); j.step(d.phase); return; }   // скачано — дальше только сборка
      cwJobs.delete(d.id); clearTimeout(j.timer); j.done(d);
      clearTimeout(cwIdle); cwIdle = setTimeout(() => { if (!cwJobs.size) killCW(); }, 5 * 60e3);   // 5 минут без сборок — освободить память
    };
    CW.onerror = e => {
      if (e && e.preventDefault) e.preventDefault();
      const log = 'ERR ' + (e && e.message || 'поток компилятора не запустился');
      for (const j of cwJobs.values()) { clearTimeout(j.timer); j.done({ ok: false, log }); }
      cwJobs.clear(); killCW();
    };
    return CW;
  }
  function runJob(job, step){
    return new Promise(res => {
      const id = ++cwSeq, j = { done: res, step, timer: 0 };
      j.arm = (ms, why) => { clearTimeout(j.timer); j.timer = setTimeout(() => { cwJobs.delete(id); killCW(); res({ ok: false, log: why }); }, ms); };
      j.arm(15 * 60e3, 'Компилятор не скачался за 15 минут — проверь интернет и нажми «⚙️ Собрать» ещё раз');   // медленный интернет: 23 МБ
      cwJobs.set(id, j);
      try { clangWorker().postMessage({ id, args: job.args, files: job.files, out: job.out }); }
      catch (e) { cwJobs.delete(id); clearTimeout(j.timer); res({ ok: false, log: 'ERR ' + String(e && e.message || e) }); }
    });
  }
  let header = null;
  function sdkHeader(){
    if (!header) header = fetch(ROOT + 'sdk/d37.h?v=' + ABI).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .catch(e => { header = null; const er = new Error('Не удалось загрузить sdk/d37.h: ' + (e.message || e)); er.log = er.message; throw er; });
    return header;
  }
  async function compileCpp(src, o = {}){
    const step = typeof o.onStep === 'function' ? o.onStep : () => {};
    step('подготовка…');
    const job = cppJob(src, await sdkHeader());
    let shown = -1;
    const r = await runJob(job, (phase, p) => {
      if (phase === 'progress') { const pc = p[1] ? Math.min(100, Math.floor(p[0] / p[1] * 100)) : 0; if (pc !== shown) { shown = pc; step(pc === 0 ? 'загрузка компилятора (~23 МБ, один раз)…' : pc < 100 ? 'загрузка компилятора ' + pc + '%' : 'запуск компилятора…'); } }
      else if (phase === 'build') step('сборка…');
    });
    return cppResult(r.ok, r.wasm, r.log);
  }

  // ═══ Примеры (те же файлы — в sdk/examples, тест сверяет) ═══
  const CPP_EXAMPLES = [
    ['Монетка: +1 очко и исчезает', `// Монетка: +1 очко и исчезает. Положи скрипт в деталь-монетку
#include "d37.h"   // на сайте подключается сам
using namespace d37;

void start() {
  Part coin = script_parent();
  coin.on_touched([coin](Player p) {
    if (!p) return;              // коснулся не игрок
    p.add_stat("Монеты", 1);
    sound("coin");
    coin.destroy();
  });
}
`],
    ['Лава: касание — смерть', `// Лава: касание — смерть. Положи в красную деталь (материал «Неон»)
#include "d37.h"
using namespace d37;

void start() {
  script_parent().on_touched([](Player p) {
    if (p) p.set_health(0);
  });
}
`],
    ['Дверь: [E] открыть / закрыть', `// Дверь: [E] открыть / закрыть. Положи в деталь-дверь
#include "d37.h"
using namespace d37;

Part door;
Vec3 closed;
bool isOpen = false;

void start() {
  door = script_parent();
  closed = door.position();
  door.prompt("Открыть дверь", [](Player p) {
    isOpen = !isOpen;
    Vec3 to = isOpen ? closed + Vec3(0, door.size().y, 0) : closed;
    door.tween_position(to, 0.6);
    door.prompt_text(isOpen ? "Закрыть дверь" : "Открыть дверь");
    sound(isOpen ? "door_wood_open" : "door_wood_close");
  });
}
`],
    ['Крутилка: вращается всегда', `// Крутилка: вращается всегда — 90° в секунду
#include "d37.h"
using namespace d37;

Part part;

void start() {
  part = script_parent();
  on_update([](double dt) {          // каждый кадр; dt — секунды с прошлого кадра
    Vec3 r = part.rotation();
    double y = r.y + 90 * dt;
    if (y >= 360) y -= 360;
    part.set_rotation(r.x, y, r.z);
  });
}
`],
    ['Движущаяся платформа', `// Платформа ездит туда-сюда (игрок едет на ней)
#include "d37.h"
using namespace d37;

void start() {
  Part p = script_parent();
  p.tween_position(p.position() + Vec3(0, 0, 12), TweenInfo(3).ease(Ease::Sine).reverses().forever());
}
`],
    ['Батут: подкидывает вверх', `// Батут: подкидывает вверх
#include "d37.h"
using namespace d37;

void start() {
  script_parent().on_touched([](Player p) {
    if (!p) return;
    p.set_jump_power(140);                      // прыжок выше
    delay(2, [p] { p.set_jump_power(50); });    // через 2 секунды — как было
    p.message("Жми пробел — высокий прыжок!", 2);
  });
}
`],
    ['Телепорт к детали «Выход»', `// Телепорт к детали «Выход»
#include "d37.h"
using namespace d37;

void start() {
  Part target = find("Выход");
  script_parent().on_touched([target](Player p) {
    if (p && target) p.teleport(target.position() + Vec3(0, 3, 0));
  });
}
`],
    ['Кнопка: меняет цвет', `// Кнопка: [E] — новый случайный цвет
#include "d37.h"
using namespace d37;

void start() {
  Part b = script_parent();
  b.prompt("Нажать", [b](Player p) {
    b.set_color(random_float(), random_float(), random_float());
    sound("click");
  });
}
`],
    ['Финиш: сообщение и время', `// Финиш: сообщение и время прохождения. Положи в деталь «Финиш»
#include "d37.h"
using namespace d37;

bool done = false;

void start() {
  script_parent().on_touched([](Player p) {
    if (!p || done) return;
    done = true;
    double s = game_time();
    gui_message(Text() << "🏁 " << p.name() << " прошёл за " << s << " с!", 5);
    p.set_stat("Время", s);
    sound("coin");
  });
}
`],
    ['При входе: приветствие и очки', `// При входе: приветствие и очки. Положи в Workspace (без родителя)
#include "d37.h"
using namespace d37;

void start() {
  on_player_added([](Player p) {
    p.set_stat("Монеты", 0);
    p.message(Text() << "Привет, " << p.name() << "! Собери все монетки 🪙", 4);
  });
}
`],
  ];
  const RUST_EXAMPLES = [
    ['Монетка: +1 очко и исчезает', `// Монетка: +1 очко и исчезает. Положи скрипт в деталь-монетку
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let coin = script_parent();
    coin.on_touched(move |player| {
        if let Some(p) = player {        // None — коснулся не игрок
            p.add_stat("Монеты", 1);
            sound("coin");
            coin.destroy();
        }
    });
}
`],
    ['Лава: касание — смерть', `// Лава: касание — смерть. Положи в красную деталь (материал «Неон»)
#[macro_use]
mod d37;
use d37::*;

fn start() {
    script_parent().on_touched(|player| {
        if let Some(p) = player {
            p.set_health(0);
        }
    });
}
`],
    ['Дверь: [E] открыть / закрыть', `// Дверь: [E] открыть / закрыть. Положи в деталь-дверь
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let door = script_parent();
    let closed = door.position();
    let mut open = false;
    door.prompt("Открыть дверь", move |_player| {
        open = !open;
        let to = if open { closed + vec3(0, door.size().y, 0) } else { closed };
        door.tween_position(to, 0.6);
        door.prompt_text(if open { "Закрыть дверь" } else { "Открыть дверь" });
        sound(if open { "door_wood_open" } else { "door_wood_close" });
    });
}
`],
    ['Крутилка: вращается всегда', `// Крутилка: вращается всегда — 90° в секунду
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let part = script_parent();
    on_update(move |dt| {              // каждый кадр; dt — секунды с прошлого кадра
        let r = part.rotation();
        part.set_rotation(vec3(r.x, (r.y + 90.0 * dt) % 360.0, r.z));
    });
}
`],
    ['Движущаяся платформа', `// Платформа ездит туда-сюда (игрок едет на ней)
#[macro_use]
mod d37;
use d37::*;

fn start() {
    let p = script_parent();
    p.tween_position(p.position() + vec3(0, 0, 12), TweenInfo::new(3).ease(Ease::Sine).reverses(true).forever());
}
`],
    ['При входе: приветствие и очки', `// При входе: приветствие и очки. Положи в Workspace (без родителя)
#[macro_use]
mod d37;
use d37::*;

fn start() {
    on_player_added(|p| {
        p.set_stat("Монеты", 0);
        p.message(&format!("Привет, {}! Собери все монетки 🪙", p.name()), 4);
        log!("Вошёл {}", p.name());
    });
}
`],
  ];
  const CPP_AI = `Напиши скрипт на C++ для «Студии 3D» сайта dan4ik37 (это как Roblox Studio). Код собирается прямо на сайте в WebAssembly
(clang, C++20, без исключений; можно std::string, std::vector, printf — он пишет в «Вывод»). SDK d37.h подключается сам.
Пиши: using namespace d37; и функцию void start() { … } — она запускается один раз при «▶ Играть». Доступно (namespace d37):
- Part script_parent() — деталь, где лежит скрипт; find("Имя") — поиск во всём мире; new_part(родитель), p.clone(), p.destroy(), p.exists()
- деталь Part: position() / set_position(x, y, z), size() / set_size, rotation() / set_rotation (градусы), set_color(r, g, b от 0 до 1) или set_color(0xff0000),
  set_transparency(0…1), set_can_collide(bool), set_anchored(bool; false — падает), set_material("plastic", "neon", "glass", "metal", "wood", "brick", "grass", "sand", "ice"…),
  set_shape("block", "ball", "cyl", "wedge"), name() / set_name, parent(), find_child("Имя"), children()
- Vec3(x, y, z) с + − *; текст с числами: Text() << "Монеты: " << 5
- события: p.on_touched([](Player pl) { if (!pl) return; … }), p.on_touch_ended, p.on_clicked, p.prompt("Открыть", [](Player pl) { … }) — подсказка [E],
  p.prompt_text("Закрыть"); on_update([](double dt) { … }) — каждый кадр; on_player_added([](Player pl) { … }); лямбды могут захватывать: [p](Player pl) { … }
- игрок Player: name(), add_stat("Монеты", 1) / set_stat / stat (таблица очков), health() / set_health (100), set_max_health, set_walk_speed (16),
  set_jump_power (50), position(), teleport(Vec3), message("текст", секунды), kill(), respawn()
- плавно: p.tween_position(Vec3, TweenInfo(секунды).ease(Ease::Sine).reverses().forever()) (и tween_size, tween_rotation, tween_color(r, g, b, …), tween_transparency) → .cancel(), .on_done([] { … })
- delay(секунды, [] { … }), every(секунды, [] { … }) → .cancel(); random_float() (0…1), random_int(a, b), game_time() (секунды с начала игры)
- print(текст), warn(текст), gui_message(текст, секунды), gui_text("ключ", текст), gui_clear("ключ"),
  sound("coin" | "jump" | "hit" | "click" | "pickup" | "buzz" | "door_wood_open" | "door_wood_close" | "build_wood" | "break")
Нельзя: сеть, файлы, потоки, sleep и долгие циклы — вместо них delay, every, on_update.
Задача: `;
  const RUST_AI = `Напиши скрипт на Rust для «Студии 3D» сайта dan4ik37 (это как Roblox Studio). Скрипт — библиотека Rust без внешних crate'ов,
собирается в WebAssembly: cargo build --release --target wasm32-unknown-unknown (Cargo.toml: crate-type = ["cdylib"], panic = "abort"),
рядом с lib.rs лежит SDK сайта src/d37.rs (https://dan4ik37.vercel.app/sdk/d37.rs). lib.rs начинается строго так:
#[macro_use]
mod d37;
use d37::*;
и в нём функция fn start() { … } — запускается один раз при «▶ Играть». Доступно (числа можно целые или дробные):
- script_parent() -> Part — деталь, где лежит скрипт; find("Имя") -> Option<Part>; new_part(None); p.clone(); p.destroy(); p.exists()
- Part (Copy): position() / set_position(vec3(x, y, z)), size() / set_size, rotation() / set_rotation (градусы), set_color(r, g, b от 0 до 1), set_color_hex(0xff0000),
  set_transparency(0…1), set_can_collide(bool), set_anchored(bool), set_material("neon"…), set_shape("ball"…), name() / set_name, parent(), find_child("Имя"), children()
- события: p.on_touched(move |player: Option<Player>| { … }), p.on_touch_ended, p.on_clicked(move |pl| …), p.prompt("Открыть", move |pl| { … }) — подсказка [E],
  p.prompt_text("Закрыть"); on_update(move |dt| { … }) — каждый кадр; on_player_added(|pl| { … })
- Player (Copy): name(), add_stat("Монеты", 1) / set_stat / stat, health() / set_health, set_max_health, set_walk_speed (16), set_jump_power (50),
  position(), teleport(vec3(…)), message("текст", секунды), kill(), respawn()
- плавно: p.tween_position(vec3(…), TweenInfo::new(секунды).ease(Ease::Sine).reverses(true).forever()) (или просто p.tween_position(v, 0.6)) → .cancel(), .on_done(|| …)
- delay(секунды, move || …), every(секунды, move || …) → .cancel(); random_float(), random_int(a, b), game_time()
- print(&str), log!("Счёт: {}", n), warn(&str), gui_message(&str, секунды), gui_text("ключ", &str), sound("coin" | "jump" | "hit" | "click" | "door_wood_open"…)
Нельзя: сеть, файлы, потоки, std::time, sleep — вместо них delay, every, on_update.
Задача: `;

  // ═══ Регистрация (до script.js — тоже можно: script.js сохранит записи) ═══
  const reg = (id, def) => {
    if (typeof E.lang === 'function') return E.lang(id, def);
    E.langs = E.langs || {};
    return (E.langs[id] = Object.assign({ id, label: id, short: id, icon: '📜', kind: 'text', examples: [], ai: '', placeholder: '' }, E.langs[id], def));
  };
  reg('cpp', { label: 'C++ (WebAssembly)', short: 'C++', icon: '⚙️', kind: 'binary', worker: wasmRuntime, compile: compileCpp, examples: CPP_EXAMPLES, ai: CPP_AI,
    placeholder: '// C++: напиши функцию void start() { … } — она запускается при «▶ Играть», потом «⚙️ Собрать».\n// Нажми «📚 Примеры», чтобы вставить готовый. SDK (d37.h) подключается сам.',
    abi: ABI, cdn: CLANG_CDN, _job: cppJob, _result: cppResult, _russify: russify, _args: CPP_ARGS });
  reg('rust', { label: 'Rust (WebAssembly)', short: 'Rust', icon: '🦀', kind: 'binary', worker: wasmRuntime, examples: RUST_EXAMPLES, ai: RUST_AI,
    placeholder: '// Rust: этот текст — для себя и для ИИ. Собери у себя (sdk/README.md, шаблон sdk/rust-template):\n// cargo build --release --target wasm32-unknown-unknown → «📦 Загрузить .wasm»',
    abi: ABI });
})();

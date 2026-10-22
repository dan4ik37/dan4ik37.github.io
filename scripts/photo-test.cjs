// 🖼 Фоторедактор и общие инструменты — проверки без браузера: node scripts/photo-test.cjs
//  • D37Tools (js/core/tools.js): реестр команд «d37 v1», проверка по схеме, умолчания, план ИИ, ссылки "$N.поле", отмена плана;
//  • D37Assets (js/core/assets.js): «Мои материалы» на поддельной IndexedDB — положить, взять, список, место, вытеснение, закреп;
//  • D37AI (js/core/ai-bridge.js): задание для ИИ, JSON из ответа (```json, текст вокруг, скобки в строках), «нельзя» от ИИ;
//  • D37PhotoCmds (js/apps/photo/photo-cmds.js): цвета, фильтры fabric из коррекций, бюджет памяти, пропорции, автоулучшение,
//    схемы всех команд; связка раздела /photo (роутер, vercel.json, sw.js, игры, возраст, поиск, подвал, карта сайта).
const fs = require('fs'), path = require('path');
const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };
const load = rel => { delete require.cache[require.resolve(path.join(SITE, rel))]; return require(path.join(SITE, rel)); };

// ═══ Поддельная IndexedDB (то, что нужно assets.js) ═══
function fakeIDB(){
  const dbs = new Map();
  const later = f => setTimeout(f, 0);
  function makeDB(name){
    const stores = new Map();
    return {
      name, version: 0,
      objectStoreNames: { contains: n => stores.has(n) },
      createObjectStore(n, o){ const s = { keyPath: o.keyPath, data: new Map() }; stores.set(n, s); return s; },
      close(){},
      transaction(names, mode){
        const t = { oncomplete: null, onerror: null, onabort: null, error: null }, st = { pending: 0, done: false, aborted: false };
        const fin = () => { if (st.pending || st.done) return; st.done = true; later(() => st.aborted ? t.onabort && t.onabort() : t.oncomplete && t.oncomplete()); };
        for (const n of names) if (!stores.has(n)) throw new Error('NotFoundError: ' + n);
        t.objectStore = n => {
          const s = stores.get(n);
          const op = fn => { st.pending++; const r = { onsuccess: null, onerror: null, result: undefined, error: null };
            later(() => { if (st.aborted) return; try { r.result = fn(); r.onsuccess && r.onsuccess({ target: r }); } catch (e) { r.error = e; r.onerror && r.onerror({ target: r }); } st.pending--; fin(); }); return r; };
          const rw = () => { if (mode !== 'readwrite') throw new Error('ReadOnlyError'); };
          return {
            put: v => op(() => { rw(); s.data.set(v[s.keyPath], Object.assign({}, v)); return v[s.keyPath]; }),
            get: k => op(() => (s.data.has(k) ? Object.assign({}, s.data.get(k)) : undefined)),
            getAll: () => op(() => [...s.data.values()].map(v => Object.assign({}, v))),
            delete: k => op(() => { rw(); s.data.delete(k); }),
            clear: () => op(() => { rw(); s.data.clear(); }),
          };
        };
        t.abort = () => { st.aborted = true; st.done = true; later(() => t.onabort && t.onabort()); };
        later(fin);
        return t;
      },
    };
  }
  return {
    _dbs: dbs,
    open(name, ver){
      const r = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => { let db = dbs.get(name); if (!db) { db = makeDB(name); dbs.set(name, db); } r.result = db; if (db.version < ver) { db.version = ver; r.onupgradeneeded && r.onupgradeneeded({ target: r }); } r.onsuccess && r.onsuccess({ target: r }); });
      return r;
    },
  };
}

(async () => {
  // ═══ D37Tools ═══
  const T = load('js/core/tools.js');
  ok(T && T.V === 1 && typeof T.register === 'function', 'D37Tools загрузился (node)');
  let threw = 0; try { T.register('Bad Name', { commands: {} }); } catch (e) { threw++; } try { T.register('x1', { commands: { 'bad-name': { run(){} } } }); } catch (e) { threw++; } try { T.register('x2', { commands: { a: {} } }); } catch (e) { threw++; }
  ok(threw === 3, 'register: плохие имена и команды без run — отказ');
  const log = [], undone = [];
  let state = { v: 0 }; const stack = [];   // история «Прибавить» — для отмены
  const unreg = T.register('demo', {
    title: 'Проба', describe: () => 'Тестовый инструмент', state: () => ({ v: state.v }), undo: async () => { const k = stack.pop(); if (k == null) return false; undone.push(k); state.v -= k; return true; },
    commands: {
      add: { title: 'Прибавить', undoable: true, args: { type: 'object', properties: { n: { type: 'integer', minimum: 1, maximum: 10, default: 1 }, why: { type: 'string', maxLength: 20 } }, additionalProperties: false }, run: a => { state.v += a.n; stack.push(a.n); log.push(['add', a.n]); return { v: state.v, id: 'r' + state.v }; } },
      name: { title: 'Имя', args: { type: 'object', properties: { s: { type: 'string', pattern: '^[a-z]+$' }, k: { type: 'string', enum: ['a', 'b'] }, ref: { type: 'string' } }, required: ['s'], additionalProperties: false }, run: a => a },
      boom: { title: 'Ошибка', args: { type: 'object', properties: {}, additionalProperties: false }, run: () => { const e = new Error('сломалось'); e.user = true; throw e; } },
      pair: { title: 'Пара', check: a => (a.x != null && a.y == null ? 'нужно и y' : ''), args: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, list: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'array', items: { type: 'number' } } } }, additionalProperties: false }, run: a => a },
      // инструмент сам говорит, сколько шагов «Отменить» записано: «ничего не поменялось» — 0, двойная правка — 2
      same: { title: 'Без изменений', undoable: true, args: { type: 'object', properties: {}, additionalProperties: false }, run: (a, ctx) => { ctx.steps = 0; return { v: state.v }; } },
      two: { title: 'Две правки', undoable: true, args: { type: 'object', properties: {}, additionalProperties: false }, run: (a, ctx) => { state.v += 3; stack.push(1, 2); ctx.steps = 2; return { v: state.v }; } },
    },
  });
  ok(T.list().some(t => t.id === 'demo' && t.commands.includes('add')), 'list: инструмент и команды');
  let v = T.validate('demo', 'add', {}); ok(v.ok && v.args.n === 1, 'умолчание подставляется', v);
  v = T.validate('demo', 'add', { n: 11 }); ok(!v.ok && /не больше 10/.test(v.errors[0]), 'maximum', v);
  v = T.validate('demo', 'add', { n: 1.5 }); ok(!v.ok && /integer/.test(v.errors[0]), 'integer', v);
  v = T.validate('demo', 'add', { n: 2, zzz: 1 }); ok(!v.ok && /zzz: такого поля нет/.test(v.errors[0]), 'лишнее поле запрещено', v);
  v = T.validate('demo', 'name', {}); ok(!v.ok && /s: обязательное/.test(v.errors[0]), 'required', v);
  v = T.validate('demo', 'name', { s: 'ABC' }); ok(!v.ok && /формат/.test(v.errors[0]), 'pattern', v);
  v = T.validate('demo', 'name', { s: 'ab', k: 'c' }); ok(!v.ok && /одно из/.test(v.errors[0]), 'enum', v);
  v = T.validate('demo', 'pair', { x: 1 }); ok(!v.ok && /нужно и y/.test(v.errors[0]), 'своя проверка команды (check)', v);
  v = T.validate('demo', 'pair', { list: [[1, 2], ['x']] }); ok(!v.ok && /list\[1\]\[0\]/.test(v.errors[0]), 'вложенные массивы — путь ошибки', v);
  v = T.validate('demo', 'pair', { list: [] }); ok(!v.ok && /не меньше 1/.test(v.errors[0]), 'minItems', v);
  v = T.validate('nope', 'add', {}); ok(!v.ok && /нет инструмента/.test(v.errors[0]), 'нет инструмента');
  v = T.validate('demo', 'nope', {}); ok(!v.ok && /нет команды/.test(v.errors[0]), 'нет команды');
  v = T.validate('demo', 'add', [1]); ok(!v.ok, 'аргументы — только объект');
  let r = await T.run('demo', 'add', { n: 3 }); ok(r.ok && r.result.v === 3 && r.undoable, 'run: выполнено, отменяемо', r);
  r = await T.run('demo', 'boom', {}); ok(!r.ok && r.error === 'сломалось', 'run: ошибка команды — понятный текст', r);
  r = await T.run('demo', 'add', { n: 'x' }); ok(!r.ok && state.v === 3, 'run: неверные аргументы — команда не выполняется', r);
  // план
  let p = T.parsePlan('{"d37":1,"steps":[{"tool":"demo","cmd":"add","args":{"n":2}}]}'); ok(p.ok && p.plan.steps.length === 1, 'план из текста');
  p = T.parsePlan([{ tool: 'demo', cmd: 'add' }]); ok(p.ok, 'план — массив шагов');
  p = T.parsePlan({ tool: 'demo', cmd: 'add', args: { n: 1 } }); ok(p.ok, 'план — один шаг');
  p = T.parsePlan({ d37: 2, steps: [{ tool: 'demo', cmd: 'add' }] }); ok(!p.ok && /версия/.test(p.errors[0]), 'чужая версия плана — отказ');
  p = T.parsePlan({ d37: 1, steps: [] }); ok(!p.ok, 'пустой план — отказ');
  p = T.parsePlan({ steps: Array.from({ length: T.MAX_STEPS + 1 }, () => ({ tool: 'demo', cmd: 'add' })) }); ok(!p.ok && /много шагов/.test(p.errors[0]), 'слишком длинный план — отказ');
  p = T.parsePlan({ steps: [{ tool: 'demo', cmd: 'add' }, { tool: 'demo', cmd: 'add', args: { n: 99 } }] }); ok(!p.ok && /шаг 2/.test(p.errors[0]), 'ошибка во 2-м шаге — план не начинается', p);
  p = T.parsePlan({ steps: [{ tool: 'demo', cmd: 'name', args: { s: 'ab', ref: '$2.id' } }, { tool: 'demo', cmd: 'add' }] }); ok(!p.ok && /только на шаги/.test(p.errors[0]), 'ссылка вперёд — отказ', p);
  p = T.parsePlan('не json'); ok(!p.ok && /не JSON/.test(p.errors[0]), 'не JSON — отказ');
  state.v = 0; log.length = 0;
  const before = state.v;
  r = await T.runPlan({ d37: 1, steps: [{ tool: 'demo', cmd: 'add', args: { n: 2 } }, { tool: 'demo', cmd: 'name', args: { s: 'ab', ref: '$1.id' } }, { tool: 'demo', cmd: 'add' }] });
  ok(r.ok && r.done === 3 && r.results[1].ref === 'r2' && state.v === 3, 'runPlan: по порядку, "$1.id" подставлен', r);
  const n = await T.undoSteps(r.steps); ok(n === 2 && state.v === before, 'undoSteps: отменены только отменяемые шаги (2), с конца', { n, state, undone });
  const v0 = state.v;
  r = await T.runPlan({ steps: [{ tool: 'demo', cmd: 'add' }, { tool: 'demo', cmd: 'boom' }, { tool: 'demo', cmd: 'add' }] });
  ok(!r.ok && r.done === 1 && /шаг 2/.test(r.error) && state.v === v0 + 1, 'runPlan: ошибка — стоп, сделанное остаётся', r);
  const ac = new AbortController(); ac.abort();
  r = await T.runPlan({ steps: [{ tool: 'demo', cmd: 'add' }] }, { signal: ac.signal }); ok(!r.ok && r.done === 0, 'runPlan: «стоп» до начала');
  r = await T.runPlan({ steps: [{ tool: 'demo', cmd: 'add' }, { tool: 'demo', cmd: 'name', args: { s: 'ab', ref: '$1.nope' } }] }); ok(!r.ok && /нет значения/.test(r.error), 'ссылка на несуществующее поле — понятная ошибка', r);
  const steps = []; await T.runPlan({ steps: [{ tool: 'demo', cmd: 'add', why: 'для проверки' }] }, { onStep: (i, s, st) => steps.push(st) });
  ok(steps.join(',') === 'run,ok', 'onStep: run → ok', steps);
  r = await T.run('demo', 'same'); ok(r.ok && !r.undoable && r.steps === 0, 'ctx.steps = 0 — команда ничего не записала, не отменяемо', r);
  { const v1 = state.v, s1 = stack.length;
    r = await T.runPlan({ steps: [{ tool: 'demo', cmd: 'add', args: { n: 4 } }, { tool: 'demo', cmd: 'same' }, { tool: 'demo', cmd: 'two' }] });
    const n2 = await T.undoSteps(r.steps);
    ok(r.ok && r.steps.map(s => s.steps).join(',') === '1,0,2' && n2 === 3 && state.v === v1 && stack.length === s1, 'undoSteps: по ctx.steps (1 + 0 + 2) — ровно план, чужие шаги целы', { steps: r.steps, n2, v: state.v, v1 }); }
  const d = T.describe(['demo']); ok(/Инструмент "demo"/.test(d) && /add — Прибавить/.test(d) && /"maximum":10/.test(d) && /Состояние сейчас/.test(d), 'describe: команды, схемы, состояние');
  const sc = T.schema('demo'); ok(sc.commands.add.args.properties.n.default === 1, 'schema()');
  const evs = []; const off = T.on((t, x) => evs.push(t)); await T.run('demo', 'add'); await T.run('demo', 'add', { n: 0 }); off();
  ok(evs.includes('run') && evs.includes('reject'), 'события run/reject', evs);
  unreg(); ok(!T.get('demo'), 'unregister');

  // ═══ D37Assets на поддельной IndexedDB ═══
  const A = load('js/core/assets.js');
  const idb = fakeIDB(); A._setIDB(idb); A.cap = 3000;
  const blob = (n, t = 'image/png') => new Blob([new Uint8Array(n)], { type: t });
  let m = await A.put(blob(1000), { type: 'image', name: 'Первая <b>', tool: 'photo', w: 10, h: 20 });
  ok(/^a[a-z0-9]+$/.test(m.id) && m.size === 1000 && m.name === 'Первая b' && m.mime === 'image/png' && m.w === 10, 'put: запись, имя очищено', m);
  let g = await A.get(m.id); ok(g && g.blob.size === 1000 && g.meta.name === 'Первая b', 'get: файл и запись');
  await new Promise(r2 => setTimeout(r2, 5));
  const m2 = await A.put(blob(1000), { type: 'image', name: 'Вторая', pinned: true });
  await new Promise(r2 => setTimeout(r2, 5));
  const m3 = await A.put(blob(500, 'text/plain'), { type: 'text', name: 'Заметка' });
  let l = await A.list(); ok(l.length === 3 && l[0].id === m3.id, 'list: новые сверху', l.map(x => x.name));
  ok((await A.list({ type: 'image' })).length === 2, 'list: по виду');
  ok((await A.list({ tool: 'photo' })).length === 1, 'list: по инструменту');
  let u = await A.usage(); ok(u.count === 3 && u.bytes === 2500 && u.cap === 3000, 'usage', u);
  // места не хватает → вытесняется самая давно не открытая незакреплённая (Первая), закреплённая — нет
  const m4 = await A.put(blob(1200), { type: 'image', name: 'Четвёртая' });
  l = await A.list(); ok(!l.some(x => x.id === m.id) && l.some(x => x.id === m2.id) && l.some(x => x.id === m4.id), 'вытеснение: старая незакреплённая удалена, закреплённая осталась', l.map(x => x.name));
  let err = null; try { await A.put(blob(5000), { type: 'image', name: 'Огромная' }); } catch (e) { err = e; }
  ok(err && err.code === 'quota' && /Мало места/.test(err.message), 'не влезает даже после очистки — «Мало места»', err && err.message);
  ok((await A.list()).length === 3, 'при «Мало места» ничего не удалено зря');
  err = null; try { await A.put(blob(10), { type: 'virus' }); } catch (e) { err = e; } ok(err && err.code === 'type', 'неизвестный вид — отказ');
  err = null; try { await A.put(null, { type: 'image' }); } catch (e) { err = e; } ok(err, 'без файла — отказ');
  const up = await A.update(m4.id, { name: 'Переименована', pinned: true, thumb: 'javascript:alert(1)' });
  ok(up.name === 'Переименована' && up.pinned && up.thumb === '', 'update: имя, закреп; плохое превью не принято', up);
  const okThumb = 'data:image/jpeg;base64,' + 'A'.repeat(100);
  ok((await A.update(m4.id, { thumb: okThumb })).thumb === okThumb, 'превью data:image принято');
  const rp = await A.replace(m3.id, blob(300, 'text/plain'), { name: 'Заметка 2' }); ok(rp.size === 300 && rp.type === 'text' && rp.name === 'Заметка 2', 'replace: новый файл в той же записи', rp);
  await A.remove(m2.id); ok(!(await A.get(m2.id)), 'remove');
  const seen = []; const off2 = A.on(e => seen.push(e.type)); await A.put(blob(10), { type: 'model', name: 'М' }); off2();
  ok(seen.includes('put'), 'событие on(put)', seen);
  ok(A.TYPES.join() === 'image,video,audio,model,text,project', 'виды материалов');
  A._setIDB(null);
  const savedIDB = global.indexedDB; delete global.indexedDB; A._reset();
  err = null; try { await A.list(); } catch (e) { err = e; } ok(err && err.code === 'noidb', 'нет IndexedDB (приватный режим) — понятная ошибка', err && err.message);
  if (savedIDB) global.indexedDB = savedIDB;

  // ═══ D37AI ═══
  const AI = load('js/core/ai-bridge.js');
  global.D37Tools = T; global.window = undefined;
  T.register('demo2', { title: 'Демо', describe: () => 'описание', commands: { go: { title: 'Идти', undoable: true, args: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 5 } }, additionalProperties: false }, run: a => ({ n: a.n }) } } });
  const pr = AI.prompt('сделай красиво', { tools: ['demo2'] });
  ok(/"d37":1/.test(pr) && /Инструмент "demo2"/.test(pr) && /go — Идти/.test(pr) && /Задача: сделай красиво/.test(pr), 'задание: формат, команды, задача');
  ok(JSON.stringify(AI.extract('Вот план:\n```json\n{"d37":1,"steps":[{"tool":"demo2","cmd":"go","args":{"n":1}}]}\n```\nУдачи!')) === '{"d37":1,"steps":[{"tool":"demo2","cmd":"go","args":{"n":1}}]}', 'JSON из блока ```json');
  ok(AI.extract('Конечно! {"d37":1,"steps":[{"tool":"demo2","cmd":"go","args":{"n":2}}],"say":"текст со скобкой } и {"} Готово.').steps[0].args.n === 2, 'JSON посреди текста, скобки внутри строк');
  ok(AI.extract('просто текст') === null, 'нет JSON — null');
  let ar = await AI.run('```json\n{"d37":1,"steps":[{"tool":"demo2","cmd":"go","args":{"n":3}}]}\n```'); ok(ar.ok && ar.results[0].n === 3, 'run: ответ ИИ выполнен', ar);
  ar = await AI.run('{"d37":1,"steps":[],"say":"Так нельзя: нет команды"}'); ok(!ar.ok && /нельзя/.test(ar.say), 'ИИ сказал «нельзя» — показываем его слова', ar);
  ar = await AI.run('бла-бла'); ok(!ar.ok && /не нашёлся JSON/.test(ar.error), 'нет JSON в ответе — подсказка', ar);
  ar = await AI.run('{"d37":1,"steps":[{"tool":"demo2","cmd":"go","args":{"n":9}}]}'); ok(!ar.ok && /не больше 5/.test(ar.error), 'неверный шаг ИИ — отказ до выполнения', ar);

  // ═══ D37PhotoCmds ═══
  const PC = load('js/apps/photo/photo-cmds.js');
  ok(PC.color('red') === '#ff1e1e' && PC.color('Жёлтый') === '#ffe000' && PC.color('#abc') === '#aabbcc' && PC.color('#AABBCC') === '#aabbcc', 'цвета: имена ru/en и hex');
  ok(PC.color('rgba(255,0,0,0.5)') === '#ff000080' && PC.color('rgb(1,2,3)') === '#010203' && PC.color('transparent') === '#00000000', 'цвета: rgb/rgba/прозрачный');
  ok(PC.color('javascript:x') === null && PC.color(5) === null && PC.color('#12') === null, 'цвета: мусор — null');
  ok(PC.filterSpecs({}, 'none').length === 0, 'без коррекций — без фильтров');
  const fs1 = PC.filterSpecs({ brightness: 50, contrast: -20, hue: 90, temperature: 40, sharpen: 10, blur: 20, pixelate: 5, exposure: 30 }, 'sepia');
  ok(fs1.map(x => x[0]).join() === 'Gamma,Brightness,Contrast,HueRotation,ColorMatrix,Sepia,Convolute,Blur,Pixelate', 'порядок фильтров постоянный', fs1.map(x => x[0]));
  ok(fs1[1][1].brightness === 0.3 && fs1[3][1].rotation === 0.5 && fs1[8][1].blocksize === 7, 'значения: яркость 50 → 0.3, оттенок 90° → 0.5, пиксели 5 → блок 7');
  ok(PC.filterSpecs({ brightness: 999 })[0][1].brightness === 0.6, 'коррекции зажаты в пределы');
  const pb = PC.budget({ phone: true, devMem: 2, maxTex: 4096 }), pc = PC.budget({ phone: false, devMem: 8, maxTex: 16384 });
  ok(pb.maxSide === 4096 && pb.maxPixels <= 12.6e6 && pb.undoBytes < pc.undoBytes && pc.maxSide === 8192, 'бюджет: телефон меньше компьютера', { pb, pc });
  ok(PC.budget({ phone: true, maxTex: 2048 }).maxSide === 2048, 'бюджет: не больше MAX_TEXTURE_SIZE видеокарты');
  let f = PC.fitSize(6000, 4000, 4096, 12.6e6); ok(f.scaled && f.w === 4096 && f.h === 2730, 'fitSize: 24 Мп → 4096 по стороне', f);
  f = PC.fitSize(4000, 3000, 4096, 12.6e6); ok(!f.scaled, 'fitSize: 12 Мп не трогаем', f);
  f = PC.fitSize(4096, 4096, 4096, 12.6e6); ok(f.scaled && f.w * f.h <= 12.6e6, 'fitSize: квадрат 16,7 Мп → по пикселям', f);
  let ar1 = PC.aspectRect(1920, 1080, '9:16'); ok(ar1.h === 1080 && ar1.w === 608 && ar1.x === 656, 'обрезка 9:16 из 1920×1080 — по центру', ar1);
  ar1 = PC.aspectRect(1080, 1920, '16:9'); ok(ar1.w === 1080 && ar1.h === 608, '16:9 из вертикального', ar1);
  ok(PC.aspectRect(100, 100, 'x') === null && PC.clipRect({ x: -10, y: -10, w: 50, h: 50 }, 100, 100).w === 40 && PC.clipRect({ x: 200, y: 0, w: 5, h: 5 }, 100, 100) === null, 'aspectRect/clipRect: края');
  const hist = Array(256).fill(0); for (let i = 40; i <= 150; i++) hist[i] = 100;   // тёмное и блёклое
  const ap = PC.autoParams({ hist, n: 111 * 100, avg: [90, 100, 140], sat: 0.1 });
  ok(ap.contrast > 0 && ap.brightness > 0 && ap.temperature > 0 && ap.saturation > 0 && ap.vibrance > 0, 'автоулучшение: темнее и синее → ярче, контрастнее, теплее, сочнее', ap);
  ok(Object.values(PC.autoParams({ hist: Array(256).fill(0), n: 0 })).every(x => x === 0), 'автоулучшение пустого — ничего');
  // схемы команд: те же правила, что проверяет D37Tools; на каждую — пример правильных аргументов
  const EX = { info: {}, new: { w: 100, h: 100 }, open: { asset: 'aabcdefg' }, place: { asset: 'aabcdefg' }, crop: { aspect: '1:1' }, resize: { w: 100 }, rotate: { deg: 90 },
    flip: { axis: 'h' }, adjust: { brightness: 10 }, filter: { preset: 'bw' }, auto: {}, removeBg: {}, text: { text: 'Привет' }, textEdit: { text: 'x' }, layerNew: {}, layer: { opacity: 50 },
    layerOrder: { to: 'up' }, layerDup: {}, layerDelete: {}, layerMerge: {}, flatten: {}, select: { layer: 1 }, fill: { color: 'red' }, draw: { points: [[1, 2]] }, export: {}, undo: {}, redo: {} };
  const reg = T.register('phototest', { title: 'фото', commands: Object.fromEntries(Object.entries(PC.SCHEMAS).map(([k, s]) => [k, Object.assign({}, s, { run: a => a })])) });
  for (const [name, args] of Object.entries(EX)) { const vv = T.validate('phototest', name, args); ok(vv.ok, `схема ${name}: правильные аргументы проходят`, vv.errors); }
  ok(Object.keys(EX).sort().join() === Object.keys(PC.SCHEMAS).sort().join(), 'пример есть у каждой команды');
  ok(!T.validate('phototest', 'crop', { aspect: '1:1', x: 0 }).ok && !T.validate('phototest', 'crop', { w: 10 }).ok && T.validate('phototest', 'crop', { x: 0, y: 0, w: 10, h: 10 }).ok, 'crop: или рамка, или пропорция');
  ok(!T.validate('phototest', 'resize', {}).ok && !T.validate('phototest', 'rotate', { deg: 45 }).ok, 'resize без размера и поворот на 45° — отказ');
  ok(!T.validate('phototest', 'text', { text: '' }).ok && !T.validate('phototest', 'text', { text: 'x'.repeat(501) }).ok, 'надпись: пустая и длинная — отказ');
  ok(!T.validate('phototest', 'export', { to: 'https://evil' }).ok && T.validate('phototest', 'export', {}).args.to === 'assets', 'export: куда — только свои места, по умолчанию «Мои материалы»');
  ok(!T.validate('phototest', 'draw', { points: Array.from({ length: 4001 }, () => [0, 0]) }).ok, 'draw: не больше 4000 точек');
  ok(T.validate('phototest', 'export', { format: 'jpeg', quality: 90 }).ok && !T.validate('phototest', 'export', { format: 'gif' }).ok, 'export: форматы png/jpeg/webp');
  reg();
  ok(/Фоторедактор/.test(PC.DESCRIBE) && PC.FONT_NAMES.includes('Montserrat') && PC.hasBold('Russo One') === false && PC.isGoogleFont('Arial') === false, 'описание и шрифты');

  // ═══ Проект .d37photo: упаковать → прочитать; чужой (испорченный, хитрый) файл — понятный отказ или только известные поля ═══
  {
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }), jpg = new Blob([new Uint8Array([255, 216, 255, 9, 9])], { type: 'image/jpeg' });
    const meta = { w: 1080, h: 1350, name: 'Пост', active: 1, layers: [
      { t: 'raster', name: 'Фон', locked: true, p: { left: 540, top: 675, scaleX: 1, scaleY: 1, opacity: 1, visible: true, globalCompositeOperation: 'source-over' }, adj: { brightness: 20 }, preset: 'sepia', cw: 1080, ch: 1350, mime: 'image/jpeg', part: 1 },
      { t: 'text', name: 'Т: Привет', p: { text: 'Привет', fontFamily: 'Rubik', fontSize: 90, fill: '#ffe000', stroke: '#000000', strokeWidth: 6, fontWeight: 'bold', textAlign: 'center', shadow: { color: 'rgba(0,0,0,0.55)', blur: 11, offsetX: 4, offsetY: 4, type: 'shadow' }, left: 540, top: 300 } },
      { t: 'raster', name: 'Кисть', p: { left: 540, top: 675, opacity: 0.5, globalCompositeOperation: 'multiply' }, cw: 1080, ch: 1350, mime: 'image/png', part: 0 }] };
    const file = PC.packProject(meta, [png, jpg]);
    ok(file.size === 12 + new TextEncoder().encode(JSON.stringify(Object.assign({}, meta, { v: 1, app: 'd37photo', layers: meta.layers.map(l => l.t === 'raster' ? Object.assign({}, l, { part: l.part === 0 ? [0, png.size] : [png.size, jpg.size] }) : l) }))).length + png.size + jpg.size, 'проект: заголовок 12 байт + JSON + картинки подряд');
    ok(await PC.isProject(file) && !(await PC.isProject(png)), 'isProject: по первым 8 байтам');
    const P = await PC.readProject(file), m2 = P.meta;
    ok(m2.w === 1080 && m2.h === 1350 && m2.name === 'Пост' && m2.active === 1 && m2.layers.length === 3, 'readProject: документ', m2);
    const bg = m2.layers[0], tx = m2.layers[1], br = m2.layers[2];
    ok(bg.t === 'raster' && bg.locked && bg.adj.brightness === 20 && bg.preset === 'sepia' && bg.mime === 'image/jpeg' && bg.p.left === 540, 'readProject: слой-картинка — коррекции, фильтр, исходный JPEG', bg);
    ok(tx.p.text === 'Привет' && tx.p.fontFamily === 'Rubik' && tx.p.fill === '#ffe000' && tx.p.shadow.color === '#0000008c' && tx.p.shadow.blur === 11 && !('type' in tx.p.shadow), 'readProject: надпись — шрифт, цвет, тень', tx);
    ok(br.p.globalCompositeOperation === 'multiply' && br.p.opacity === 0.5 && !('fontSize' in br.p), 'readProject: наложение и прозрачность; у картинки нет полей текста', br);
    const bj = new Uint8Array(await P.part(bg).arrayBuffer()), bp = new Uint8Array(await P.part(br).arrayBuffer());
    ok(bj[0] === 255 && bj.length === jpg.size && bp[0] === 137 && bp.length === png.size && P.part(bg).type === 'image/jpeg', 'readProject: картинки слоёв — те же байты', { bj: Array.from(bj), bp: Array.from(bp) });
    // хитрый и испорченный
    const raw = (obj, extra = []) => { const j = new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj)), h = new Uint8Array(12); for (let i = 0; i < 8; i++) h[i] = 'D37PHOT1'.charCodeAt(i); new DataView(h.buffer).setUint32(8, j.length, true); return new Blob([h, j].concat(extra)); };
    const bad = async (b, re, name) => { let e = null; try { await PC.readProject(b); } catch (er) { e = er; } ok(e && e.user && re.test(e.message), name, e && e.message); };
    await bad(new Blob(['PK\x03\x04 это zip, а не проект']), /не проект/, 'чужой файл — «это не проект»');
    await bad(raw({ v: 2, w: 10, h: 10, layers: [{ t: 'text', p: {} }] }), /версия/, 'другая версия — отказ');
    await bad(raw({ v: 1, w: 99999, h: 10, layers: [{ t: 'text', p: {} }] }), /размер документа/, 'гигантский документ — отказ');
    await bad(raw({ v: 1, w: 10, h: 10, layers: [] }), /нет слоёв/, 'без слоёв — отказ');
    await bad(raw({ v: 1, w: 10, h: 10, layers: Array.from({ length: PC.PROJ_MAX_LAYERS + 1 }, () => ({ t: 'text', p: {} })) }), /слишком много/, 'слишком много слоёв — отказ');
    await bad(raw({ v: 1, w: 10, h: 10, layers: [{ t: 'raster', cw: 10, ch: 10, part: [0, 999] }] }, [png]), /за пределами/, 'картинка слоя за концом файла — отказ');
    await bad(raw({ v: 1, w: 10, h: 10, layers: [{ t: 'script', p: {} }] }), /неизвестный вид/, 'неизвестный вид слоя — отказ');
    { const b = raw({ v: 1, w: 10, h: 10, layers: [] }), u = new Uint8Array(await b.arrayBuffer()); u[8] = 255; u[9] = 255; u[10] = 255; u[11] = 127; await bad(new Blob([u]), /заголовок/, 'длина описания больше файла — отказ'); }
    await bad(new Blob([new Uint8Array([68, 51, 55, 80, 72, 79, 84, 49, 5, 0, 0, 0, 123, 34, 120, 34, 58])]), /описание повреждено/, 'битый JSON — отказ');
    const sly = await PC.readProject(raw({ v: 1, w: 10, h: 10, name: '<img src=x onerror=alert(1)>', active: 99, layers: [
      { t: 'raster', name: 'a'.repeat(300), cw: 10, ch: 10, part: [0, png.size], mime: 'text/html', preset: '__proto__', adj: { brightness: 9e9, evil: 1, contrast: 'x' },
        p: { left: 1e12, scaleX: 0, opacity: 7, globalCompositeOperation: 'url(javascript:x)', onclick: 'x', __proto__: { polluted: 1 }, fontSize: 50, src: 'https://evil' } },
      { t: 'text', p: { text: 'x'.repeat(900), fontFamily: 'Evil Font', fill: 'javascript:alert(1)', fontWeight: 900, shadow: { color: 'url(x)', blur: 1e9 }, textAlign: 'evil' } }] }, [png]));
    const s0 = sly.meta.layers[0], s1 = sly.meta.layers[1];
    ok(!/[<>]/.test(sly.meta.name) && sly.meta.active === 1 && s0.name.length === 60, 'хитрый проект: имя без <>, номер слоя в пределах, имя слоя ≤ 60', sly.meta);
    ok(s0.preset === 'none' && s0.mime === 'image/png' && s0.adj.brightness === 100 && !('evil' in s0.adj) && !('contrast' in s0.adj), 'хитрый проект: фильтр, вид картинки и коррекции — только допустимые', s0);
    ok(s0.p.left === 1e6 && s0.p.scaleX === 1 && s0.p.opacity === 1 && !('globalCompositeOperation' in s0.p) && !('onclick' in s0.p) && !('src' in s0.p) && !('fontSize' in s0.p) && ({}).polluted === undefined, 'хитрый проект: свойства — только известные, числа в пределах, прототип не испорчен', s0.p);
    ok(s1.p.text.length === 500 && !('fontFamily' in s1.p) && !('fill' in s1.p) && !('fontWeight' in s1.p) && !('textAlign' in s1.p) && s1.p.shadow.color === '#0000008c' && s1.p.shadow.blur === 500, 'хитрый проект: надпись — длина, шрифт, цвет и тень только допустимые', s1.p);
    // "__proto__" в самом JSON (JSON.parse делает его обычным полем) — не переносится никуда
    const pj = await PC.readProject(raw('{"v":1,"w":10,"h":10,"__proto__":{"polluted":1},"layers":[{"t":"text","__proto__":{"polluted":2},"p":{"__proto__":{"polluted":3},"text":"ok"}}]}'));
    ok(pj.meta.layers[0].p.text === 'ok' && pj.meta.polluted === undefined && pj.meta.layers[0].polluted === undefined && pj.meta.layers[0].p.polluted === undefined && ({}).polluted === undefined, 'хитрый проект: "__proto__" в JSON — без последствий', pj.meta);
  }

  // ═══ Раздел /photo связан везде ═══
  const read = rel => fs.readFileSync(path.join(SITE, rel), 'utf8');
  const router = read('js/ui/router.js'), vj = JSON.parse(read('vercel.json')), sw = read('sw.js'), idx = read('index.html'), games = read('js/features/games.js');
  ok(/photo:\s*\['photo-page'\]/.test(router) && /route==='photo'\) window\.D37Apps\?\.open/.test(router), 'роутер: раздел photo и запуск редактора');
  ok(vj.rewrites.some(r => r.source === '/photo' && r.destination === '/index.html') && vj.rewrites.some(r => r.source === '/photo/:path+'), 'vercel.json: /photo → index.html');
  ok(vj.rewrites.some(r => r.source === '/tools/photo' && r.destination === '/api/pages?page=photo'), 'vercel.json: /tools/photo → серверная страница');
  ok(/\|photo\)/.test(sw) && /fabric@\\d\+/.test(sw), 'sw.js: /photo без сети, fabric.js в кэше');
  ok(/id="photo-page"/.test(idx) && /js\/apps\/apps\.js/.test(idx) && /href="\/tools\/photo"/.test(idx), 'index.html: раздел, загрузчик, ссылка в подвале');
  ok(idx.indexOf('js/apps/apps.js') < idx.indexOf('routerStart()'), 'загрузчик подключён до старта роутера');
  ok(/id: 'photo',\s+age: '0\+'/.test(games) && /photo: \[0, ''\]/.test(read('api/_lib/age.js')), 'карточка «Фоторедактор» 0+ и метка возраста');
  ok(/\/tools\/photo/.test(read('js/ui/hotkeys.js')) && /D37Photo\?\.active/.test(read('js/ui/hotkeys.js')), 'поиск по сайту и клавиши сайта не мешают редактору');
  ok(/\/tools\/photo/.test(read('api/sitemap.js')) && /\/tools\/photo/.test(read('api/_lib/page.js')) && /photo/.test(read('api/pages.js')), 'карта сайта, подвал серверных страниц, api/pages.js');
  const apps = read('js/apps/apps.js');
  ok(/fabric@7\.4\.0\/dist\/index\.min\.js/.test(apps) && /fabric@7\.4\.0/.test(read('js/apps/photo/photo-ui.js')) === false, 'основа fabric.js — точная версия, в одном месте (apps.js)');
  ok(!/innerHTML\s*=\s*[^;]*\$\{(?!esc\()[^}]*name/.test(read('js/apps/photo/photo-ui.js')), 'имена слоёв и материалов — через esc()');
  for (const f of ['js/core/tools.js', 'js/core/assets.js', 'js/core/ai-bridge.js', 'js/apps/apps.js', 'js/apps/photo/photo-cmds.js', 'js/apps/photo/photo-core.js', 'js/apps/photo/photo-ui.js', 'js/apps/photo/photo-worker.js']) {
    const s = read(f);
    ok(!s.includes(String.fromCharCode(0x2028)) && !s.includes(String.fromCharCode(0x2029)), `${f}: нет невидимых переносов строк`);
    ok(!/smoothstep|eval\(|new Function/.test(s.replace(/\/\/.*$/gm, '')), `${f}: без eval / new Function`);
  }

  console.log(`photo-test: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

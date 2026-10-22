// ═══════════════════════════════════════
//  КОМАНДЫ ИНСТРУМЕНТОВ «d37 v1» (D37Tools) — общий реестр для кнопок и ИИ
// ═══════════════════════════════════════
// Каждый инструмент сайта (фоторедактор, потом видео, «Студия 3D», персонаж…) регистрирует свои команды с JSON-схемой
// аргументов: D37Tools.register('photo', { title, describe(), state(), undo(), commands: { crop: { title, args, run } } }).
// Кнопка инструмента и ИИ идут ОДНИМ путём — D37Tools.run(tool, cmd, args): проверка аргументов по схеме (лишнее и неверное —
// отказ с понятной ошибкой, умолчания подставляются), потом run(args, ctx). Каждая команда, которая меняет работу, — один шаг
// «Отменить» в истории инструмента (undo() — отменить последний шаг); сколько шагов записано на самом деле, инструмент
// сообщает в ctx.steps (0 — ничего не поменялось).
// План для ИИ — «d37 v1»: { "d37": 1, "steps": [ { "tool": "photo", "cmd": "adjust", "args": { … } }, … ] }. Сначала проверяются
// ВСЕ шаги (неизвестный инструмент/команда, неверные аргументы — план не начинается), потом выполняются по одному. Результат
// раньше идущего шага можно подставить строкой "$N.поле" (N — номер шага с 1): { "asset": "$2.asset" }.
// Без DOM — работает и в node (scripts/photo-test.cjs).
(function (root) {
  'use strict';
  const V = 1;
  const MAX_STEPS = 60;           // шагов в одном плане
  const MAX_ARGS = 200000;        // знаков в аргументах шага (JSON)
  const tools = new Map();
  const subs = new Set();
  const emit = (type, d) => subs.forEach(f => { try { f(type, d); } catch (e) {} });
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;

  // ═══ Проверка по схеме (подмножество JSON Schema) ═══
  // type (строка или список), enum, const, minimum, maximum, minLength, maxLength, pattern, items, minItems, maxItems,
  // properties, required, additionalProperties (false — лишние поля запрещены), default (подставляется). Ошибки — по-русски с путём.
  function check(s, v, path, errs){
    if (!s || typeof s !== 'object') return v;
    if (v === undefined) return v;
    if (s.type) {
      const types = Array.isArray(s.type) ? s.type : [s.type], t = typeOf(v);
      const okT = types.some(x => x === t || (x === 'number' && t === 'integer'));
      if (!okT) { errs.push(`${path || 'аргументы'}: нужен тип ${types.join(' или ')}, а пришло ${t}`); return v; }
    }
    if (s.const !== undefined && v !== s.const) errs.push(`${path}: должно быть ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(v)) errs.push(`${path}: одно из ${s.enum.map(x => JSON.stringify(x)).join(', ')}`);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) errs.push(`${path}: не число`);
      if (s.minimum !== undefined && v < s.minimum) errs.push(`${path}: не меньше ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errs.push(`${path}: не больше ${s.maximum}`);
    }
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${path}: не короче ${s.minLength} знаков`);
      if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${path}: не длиннее ${s.maxLength} знаков`);
      if (s.pattern && !(new RegExp(s.pattern)).test(v)) errs.push(`${path}: неверный формат`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${path}: не меньше ${s.minItems} элементов`);
      if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${path}: не больше ${s.maxItems} элементов`);
      if (s.items) return v.map((x, i) => check(s.items, x, `${path}[${i}]`, errs));
    }
    if (isObj(v) && (s.properties || s.required || s.additionalProperties === false)) {
      const out = {}, props = s.properties || {};
      for (const k of Object.keys(v)) {
        if (!props[k]) { if (s.additionalProperties === false) errs.push(`${path ? path + '.' : ''}${k}: такого поля нет`); else out[k] = v[k]; continue; }
        out[k] = check(props[k], v[k], path ? path + '.' + k : k, errs);
      }
      for (const k of Object.keys(props)) if (out[k] === undefined && props[k].default !== undefined) out[k] = clone(props[k].default);
      for (const k of s.required || []) if (out[k] === undefined) errs.push(`${path ? path + '.' : ''}${k}: обязательное поле`);
      return out;
    }
    return v;
  }
  const clone = v => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;

  // ═══ Реестр ═══
  function register(id, def){
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(String(id))) throw new Error('D37Tools: плохое имя инструмента ' + id);
    if (!def || !isObj(def.commands)) throw new Error('D37Tools: нет команд у ' + id);
    for (const [name, c] of Object.entries(def.commands)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name)) throw new Error('D37Tools: плохое имя команды ' + name);
      if (!c || typeof c.run !== 'function') throw new Error('D37Tools: у команды ' + name + ' нет run');
    }
    tools.set(id, Object.assign({ id, title: id, version: 1 }, def));
    emit('register', { tool: id });
    return () => unregister(id, def);
  }
  function unregister(id, def){ if (tools.has(id) && (!def || tools.get(id).commands === def.commands)) { tools.delete(id); emit('unregister', { tool: id }); } }
  const get = id => tools.get(id) || null;
  const list = () => [...tools.values()].map(t => ({ id: t.id, title: t.title, commands: Object.keys(t.commands) }));

  // Схема инструмента для ИИ: { tool, title, commands: { имя: { title, args } } }
  function schema(id){
    const t = get(id); if (!t) return null;
    const commands = {};
    for (const [name, c] of Object.entries(t.commands)) if (!c.hidden) commands[name] = { title: c.title || name, args: c.args || { type: 'object', properties: {}, additionalProperties: false } };
    return { tool: t.id, title: t.title, version: t.version, commands };
  }

  // Проверить аргументы команды: { ok, args (с умолчаниями), errors }
  function validate(tool, cmd, args){
    const t = get(tool);
    if (!t) return { ok: false, errors: [`нет инструмента «${tool}»`] };
    const c = t.commands[cmd];
    if (!c || c.hidden) return { ok: false, errors: [`у «${tool}» нет команды «${cmd}»`] };
    if (args === undefined || args === null) args = {};
    if (!isObj(args)) return { ok: false, errors: ['аргументы — объект { … }'] };
    let size = 0; try { size = JSON.stringify(args).length; } catch (e) { return { ok: false, errors: ['аргументы не превращаются в JSON'] }; }
    if (size > MAX_ARGS) return { ok: false, errors: ['аргументы слишком большие'] };
    const errs = [];
    const schemaArgs = c.args || { type: 'object', properties: {}, additionalProperties: false };
    const out = check(Object.assign({ type: 'object' }, schemaArgs), args, '', errs);
    if (!errs.length && typeof c.check === 'function') { const m = c.check(out, t); if (m) errs.push(String(m)); }   // своя проверка (по состоянию)
    return errs.length ? { ok: false, errors: errs } : { ok: true, args: out };
  }

  // Выполнить команду (кнопки и ИИ — один путь). → { ok, result } | { ok: false, error, errors }
  let busy = 0;
  async function run(tool, cmd, args, opts = {}){
    const v = validate(tool, cmd, args);
    if (!v.ok) { emit('reject', { tool, cmd, errors: v.errors }); return { ok: false, error: v.errors[0], errors: v.errors }; }
    const t = get(tool), c = t.commands[cmd];
    const t0 = Date.now();
    // ctx.steps — сколько шагов «Отменить» команда на самом деле записала (ставит инструмент; нет — по флагу undoable):
    // «ничего не поменялось» — 0 шагов, и «Отменить всё» у плана не отменит чужой шаг
    const ctx = Object.assign({ tool: t, via: opts.via || 'ui', signal: opts.signal }, opts.ctx || {});
    const stepsOf = ok => typeof ctx.steps === 'number' ? Math.max(0, ctx.steps | 0) : (ok && c.undoable ? 1 : 0);
    busy++;
    try {
      const result = await c.run(v.args, ctx);
      emit('run', { tool, cmd, ms: Date.now() - t0, via: opts.via || 'ui' });
      const steps = stepsOf(true);
      return { ok: true, result: result === undefined ? null : result, undoable: steps > 0, steps };
    } catch (e) {
      const msg = e && e.user ? e.message : (e && e.message ? e.message : String(e));
      emit('error', { tool, cmd, error: msg });
      return { ok: false, error: msg, errors: [msg], steps: stepsOf(false) };
    } finally { busy--; }
  }

  // ═══ План «d37 v1» ═══
  // Принимает объект плана, массив шагов, один шаг или текст с JSON. → { ok, plan, errors }
  function parsePlan(x){
    let p = x;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { return { ok: false, errors: ['это не JSON: ' + e.message] }; } }
    if (Array.isArray(p)) p = { d37: V, steps: p };
    else if (isObj(p) && p.tool && p.cmd && !p.steps) p = { d37: V, steps: [p] };
    if (!isObj(p)) return { ok: false, errors: ['план — объект { "d37": 1, "steps": [ … ] }'] };
    if (p.d37 !== undefined && p.d37 !== V) return { ok: false, errors: [`версия плана ${p.d37}, а сайт понимает ${V}`] };
    if (!Array.isArray(p.steps) || !p.steps.length) return { ok: false, errors: ['в плане нет шагов (steps)'] };
    if (p.steps.length > MAX_STEPS) return { ok: false, errors: [`слишком много шагов: ${p.steps.length} (можно до ${MAX_STEPS})`] };
    const errors = [];
    const steps = p.steps.map((s, i) => {
      const n = i + 1;
      if (!isObj(s)) { errors.push(`шаг ${n}: не объект`); return null; }
      const tool = String(s.tool || ''), cmd = String(s.cmd || s.command || '');
      const args = s.args === undefined ? {} : s.args;
      if (!get(tool)) { errors.push(`шаг ${n}: нет инструмента «${tool}»`); return null; }
      const c = get(tool).commands[cmd];
      if (!c || c.hidden) { errors.push(`шаг ${n}: у «${tool}» нет команды «${cmd}»`); return null; }
      if (!isObj(args)) { errors.push(`шаг ${n}: args — объект`); return null; }
      // ссылки "$N.поле" — только на раньше идущие шаги; такие поля проверим при выполнении
      const refs = findRefs(args);
      for (const r of refs) if (r.n < 1 || r.n >= n) errors.push(`шаг ${n}: ссылка ${r.raw} — только на шаги 1…${n - 1}`);
      if (!refs.length) { const v = validate(tool, cmd, args); if (!v.ok) v.errors.forEach(e => errors.push(`шаг ${n} (${tool}.${cmd}): ${e}`)); }
      return { tool, cmd, args, why: typeof s.why === 'string' ? s.why.slice(0, 200) : '' };
    });
    return errors.length ? { ok: false, errors } : { ok: true, plan: { d37: V, title: typeof p.title === 'string' ? p.title.slice(0, 120) : '', steps } };
  }
  const REF = /^\$(\d{1,2})\.([A-Za-z_][\w.]{0,60})$/;
  function findRefs(v, out = []){
    if (typeof v === 'string') { const m = REF.exec(v); if (m) out.push({ raw: v, n: +m[1], path: m[2] }); }
    else if (Array.isArray(v)) v.forEach(x => findRefs(x, out));
    else if (isObj(v)) Object.values(v).forEach(x => findRefs(x, out));
    return out;
  }
  function resolveRefs(v, results){
    if (typeof v === 'string') {
      const m = REF.exec(v); if (!m) return v;
      let r = results[+m[1] - 1];
      for (const k of m[2].split('.')) { if (r == null) break; r = r[k]; }
      if (r === undefined) throw Object.assign(new Error(`нет значения ${v}`), { user: true });
      return r;
    }
    if (Array.isArray(v)) return v.map(x => resolveRefs(x, results));
    if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[k] = resolveRefs(v[k], results); return o; }
    return v;
  }

  // Выполнить план: шаги по одному; ошибка — стоп (сделанные шаги остаются, их можно отменить undoSteps).
  // opts: { onStep(i, step, state, info), signal, via } → { ok, done, results, steps: [{ tool, cmd, ok, undoable, error }], error }
  async function runPlan(x, opts = {}){
    const pr = x && x.plan ? x : parsePlan(x);
    if (!pr.ok) return { ok: false, done: 0, results: [], steps: [], error: pr.errors[0], errors: pr.errors };
    const steps = pr.plan.steps, results = [], log = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (opts.signal && opts.signal.aborted) return { ok: false, done: i, results, steps: log, error: 'остановлено' };
      let args;
      try { args = resolveRefs(s.args, results); } catch (e) { log.push({ tool: s.tool, cmd: s.cmd, ok: false, error: e.message }); opts.onStep && opts.onStep(i, s, 'error', e.message); return { ok: false, done: i, results, steps: log, error: `шаг ${i + 1}: ${e.message}` }; }
      opts.onStep && opts.onStep(i, s, 'run');
      const r = await run(s.tool, s.cmd, args, { via: opts.via || 'plan', signal: opts.signal });
      log.push({ tool: s.tool, cmd: s.cmd, ok: r.ok, undoable: !!r.undoable && r.ok, steps: r.steps || 0, error: r.error || '' });
      results.push(r.ok ? r.result : null);
      opts.onStep && opts.onStep(i, s, r.ok ? 'ok' : 'error', r.ok ? r.result : r.error);
      if (!r.ok) return { ok: false, done: i, results, steps: log, error: `шаг ${i + 1} (${s.tool}.${s.cmd}): ${r.error}` };
    }
    return { ok: true, done: steps.length, results, steps: log };
  }
  // Отменить сделанные шаги плана (с конца): у каждого инструмента — его undo() столько раз, сколько шагов записала команда
  // (steps; старый журнал без steps — один шаг на удачную команду с undoable). → сколько шагов отменено
  async function undoSteps(log){
    let n = 0;
    for (let i = (log || []).length - 1; i >= 0; i--) {
      const s = log[i], t = get(s.tool);
      const k = typeof s.steps === 'number' ? s.steps : (s.ok && s.undoable ? 1 : 0);
      if (!k || !t || typeof t.undo !== 'function') continue;
      for (let j = 0; j < k; j++) { try { if (await t.undo() === false) break; n++; } catch (e) { break; } }
    }
    return n;
  }

  // ═══ Описание для ИИ ═══
  // Текст: что за инструменты, их команды и JSON-схемы аргументов, текущее состояние (state()) — коротко.
  function describe(ids){
    const want = ids && ids.length ? ids : [...tools.keys()];
    const parts = [];
    for (const id of want) {
      const t = get(id); if (!t) continue;
      const sc = schema(id);
      let state = null; try { state = typeof t.state === 'function' ? t.state() : null; } catch (e) {}
      parts.push([
        `## Инструмент "${id}" — ${t.title}`,
        typeof t.describe === 'function' ? String(t.describe() || '') : '',
        state ? 'Состояние сейчас: ' + JSON.stringify(state) : '',
        'Команды (args — JSON Schema):',
        ...Object.entries(sc.commands).map(([n, c]) => `- ${n} — ${c.title}. args: ${JSON.stringify(compact(c.args))}`),
      ].filter(Boolean).join('\n'));
    }
    return parts.join('\n\n');
  }
  // Схема без лишних слов (description остаётся — это подсказка ИИ)
  function compact(s){
    if (!s || typeof s !== 'object') return s;
    if (Array.isArray(s)) return s.map(compact);
    const o = {};
    for (const [k, v] of Object.entries(s)) { if (k === 'title') continue; o[k] = (v && typeof v === 'object') ? compact(v) : v; }
    return o;
  }

  function on(fn){ subs.add(fn); return () => subs.delete(fn); }

  const api = { V, MAX_STEPS, register, unregister, get, list, schema, validate, run, parsePlan, runPlan, undoSteps, describe, on,
    get busy(){ return busy > 0; }, _check: check };
  root.D37Tools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

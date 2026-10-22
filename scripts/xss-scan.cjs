// Статический разбор «чужой текст → код страницы» (T-011): находит места, где строка с разметкой или ссылкой собирается из
// значений, которые нельзя доказать безопасными, и места-приёмники (innerHTML, insertAdjacentHTML, href/src, eval…).
// Работает по настоящему дереву JS (acorn из самого Node — запускается с --expose-internals, ничего ставить не надо):
//  • «единица разметки» — шаблонная строка или цепочка «'<b>' + x + '</b>'», где есть тег; каждая вставка проверяется по КОНТЕКСТУ
//    (текст, атрибут в кавычках, ссылка, onclick, style, <script>, имя тега…) маленьким разбором HTML;
//  • вставка безопасна, если это число / строка-константа / вызов функции-экранировщика (esc, e, escH… — настоящая функция,
//    экранирующая & < > " '), ссылка, прошедшая проверку, или результат функций, которые сами сводятся к этому (разбор по телу;
//    параметры — по всем местам вызова);
//  • остальное — находка; проверенные вручную находки лежат в scripts/xss-allowlist.json (с причиной у каждой).
// Запуск: node scripts/xss-scan.cjs [--all] [--json] [--files a.js,b.js]   (без параметров — только НЕпроверенные находки)
//         --add <причина> ["заметка"] — занести открытые находки в список (после чтения каждой!); --prune — убрать устаревшие записи
// Проверка целиком (разбор + злые строки через чат, реакции, серверные страницы): node scripts/xss-test.cjs
'use strict';
const fs = require('fs'), path = require('path');

let acorn = null;
try { acorn = require('internal/deps/acorn/acorn/dist/acorn'); } catch (e) { acorn = null; }
const hasAcorn = () => !!acorn;
// Перезапуск текущего скрипта с --expose-internals (если встроенный acorn ещё не доступен)
function respawnIfNeeded() {
  if (acorn) return;
  if (process.execArgv.includes('--expose-internals')) { console.error('xss: в этой версии Node нет встроенного acorn'); process.exit(2); }
  const r = require('child_process').spawnSync(process.execPath, ['--expose-internals', ...process.execArgv, process.argv[1], ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

// ═══ Оценки значений ═══
// h — можно в текст страницы; qd / qs — в атрибут в "…" / '…'; u — в начало ссылки (схема безопасна); x — куда угодно (число, константа);
// js — как JS-значение внутри onclick="…" (jsAttr); a — набор атрибутов `class="a" data-x="b"` внутри тега; m — готовая разметка.
const KEYS = ['h', 'qd', 'qs', 'u', 'x', 'js', 'a', 's'];
const mk = (o, why) => Object.assign({ h: 0, qd: 0, qs: 0, u: 0, x: 0, js: 0, a: 0, s: 0, c: why ? [why] : [] }, o);
const NUMG = () => ({ h: 1, qd: 1, qs: 1, u: 1, x: 1, js: 1, a: 1, s: 1, c: [] });
const BOTTOM = () => ({ h: 1, qd: 1, qs: 1, u: 1, x: 1, js: 1, a: 1, s: 1, c: [], bottom: true });
const UNKG = why => mk({}, why);
const ESCG = (qd, qs) => mk({ h: 1, qd, qs });
const MARKUPG = () => mk({ h: 1, m: 1 });
const ATTRSG = () => mk({ a: 1, m: 1 });
const URLRAW = () => mk({ u: 1 });                 // проверенная ссылка (сырая: в атрибут её ещё надо экранировать)
const JSATTR = () => mk({ h: 1, qd: 1, qs: 1, js: 1 });
function join(a, b) {
  if (a.bottom) return b; if (b.bottom) return a;
  if (a === b) return a;
  let c = a.c;
  if (b.c.length) { if (!c.length) c = b.c; else { c = c.slice(0, 6); for (const w of b.c) if (c.length < 6 && !c.includes(w)) c.push(w); } }
  const r = { h: a.h & b.h, qd: a.qd & b.qd, qs: a.qs & b.qs, u: a.u & b.u, x: a.x & b.x, js: a.js & b.js, a: a.a & b.a, s: a.s & b.s, c };
  if (a.m && b.m) r.m = 1;
  return r;
}
const joinAll = gs => gs.reduce(join, BOTTOM());

// ═══ Простые таблицы имён ═══
const NUM_FUNCS = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean', 'isNaN', 'isFinite', 'BigInt']);
const NUM_METHODS = new Set(['toFixed', 'toPrecision', 'toExponential', 'toISOString', 'toUTCString', 'toLocaleDateString', 'toLocaleTimeString', 'toDateString', 'toTimeString', 'getTime', 'getFullYear', 'getMonth', 'getDate',
  'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds', 'getTimezoneOffset', 'indexOf', 'lastIndexOf', 'charCodeAt', 'codePointAt', 'localeCompare', 'test', 'includes', 'startsWith', 'endsWith', 'some', 'every',
  'has', 'hasOwnProperty', 'isArray', 'isInteger', 'isFinite', 'isNaN', 'isSafeInteger', 'findIndex', 'findLastIndex', 'valueOf', 'push', 'unshift', 'now', 'search', 'random', 'toLocaleString', 'getUTCFullYear',
  'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'getUTCSeconds']);
const PASS_METHODS = new Set(['toString', 'toUpperCase', 'toLowerCase', 'toLocaleUpperCase', 'toLocaleLowerCase', 'trim', 'trimStart', 'trimEnd', 'normalize', 'slice', 'substring', 'substr', 'charAt', 'at', 'repeat',
  'padStart', 'padEnd', 'concat', 'replace', 'replaceAll']);
const URL_ATTRS = { a: ['href', 'xlink:href'], area: ['href'], form: ['action'], button: ['formaction'], input: ['formaction'], iframe: ['src', 'srcdoc'], frame: ['src'], embed: ['src'], object: ['data'], script: ['src'], base: ['href'], link: ['href'],
  use: ['href', 'xlink:href'], image: ['href', 'xlink:href'] };
const LOWURL_ATTRS = new Set(['src', 'poster', 'srcset', 'cite', 'background', 'data', 'ping', 'href']);   // src картинки/аудио — javascript: не исполняется
const ITER_CB = new Set(['map', 'forEach', 'filter', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'sort', 'toSorted']);
const ARRAY_KEEP = new Set(['filter', 'slice', 'sort', 'reverse', 'toSorted', 'toReversed', 'flat', 'splice']);
// имена встроенных методов: по имени метода «чужую» функцию с таким же именем искать нельзя
const BUILTIN_NAMES = new Set(['get', 'set', 'getItem', 'setItem', 'getAttribute', 'text', 'json', 'then', 'catch', 'finally', 'pop', 'shift', 'splice', 'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'find', 'findLast', 'keys', 'values', 'entries',
  'split', 'join', 'match', 'matchAll', 'exec', 'querySelector', 'querySelectorAll', 'closest', 'getElementById', 'item', 'call', 'apply', 'bind', 'add', 'delete', 'remove', 'clear', 'append', 'prepend', 'toString', 'stringify', 'parse', 'fetch',
  'read', 'write', 'next', 'resolve', 'reject', 'all', 'race', 'from', 'of', 'assign', 'create', 'freeze', 'getTime', 'format', 'sort', 'reverse', 'flat', 'fill', 'copyWithin', 'with', 'at', 'concat', 'slice', 'indexOf', 'includes']);

// ═══ Разбор файла, области видимости ═══
function parseSrc(src, file) {
  const base = { ecmaVersion: 'latest', locations: true, ranges: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true, allowImportExportEverywhere: true };
  const mod = /(^|\/)api\//.test(file) || /\.mjs$/.test(file);
  const order = mod ? ['module', 'script'] : ['script', 'module'];
  let err;
  for (const sourceType of order) { try { return acorn.parse(src, { ...base, sourceType }); } catch (e) { err = err || e; } }
  throw err;
}
const KIDS = new Map();
function kids(node) {
  let ks = KIDS.get(node.type);
  if (!ks) { ks = Object.keys(node).filter(k => k !== 'type' && k !== 'start' && k !== 'end' && k !== 'loc' && k !== 'range' && k !== 'parent'); KIDS.set(node.type, ks); }
  return ks;
}
function walk(node, f, parent) {
  if (!node || typeof node.type !== 'string') return;
  if (parent && !('parent' in node)) Object.defineProperty(node, 'parent', { value: parent, enumerable: false, writable: true });
  if (f(node) === false) return;
  for (const k of Object.keys(node)) {
    if (k === 'parent' || k === 'loc') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, f, node); }
    else if (v && typeof v.type === 'string') walk(v, f, node);
  }
}
const isFn = n => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');
const hide = (o, k, v) => { Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true }); return v; };

// Области: Program / функция / блок. Имена let/const — в блоке, var и функции — в функции.
function buildScopes(fi) {
  const scopes = new Map();   // node → scope
  const mkScope = (kind, node, parent) => { const s = { kind, node, parent, b: new Map() }; scopes.set(node, s); return s; };
  const declare = (scope, name, info) => { let b = scope.b.get(name); if (!b) { b = { name, scope, decls: [], assigns: [], fi }; scope.b.set(name, b); } b.decls.push(info); return b; };
  const fnScope = s => { while (s.kind === 'block') s = s.parent; return s; };
  function pat(p, scope, mkInfo, path = []) {
    if (!p) return;
    const info = (id, pth) => { const o = mkInfo(id); if (pth.length) { o.destruct = true; o.path = pth; } return o; };
    (function rec(p, pth, dflt) {
      if (!p) return;
      switch (p.type) {
        case 'Identifier': { const o = info(p, pth); if (dflt) o.dflt = dflt; declare(scope, p.name, o); break; }
        case 'ObjectPattern': for (const pr of p.properties) { if (pr.type === 'RestElement') rec(pr.argument, [...pth, { rest: true }]); else rec(pr.value, [...pth, { key: pr.computed ? null : (pr.key.name != null ? pr.key.name : String(pr.key.value)) }]); } break;
        case 'ArrayPattern': p.elements.forEach((e, i) => { if (e && e.type === 'RestElement') rec(e.argument, [...pth, { rest: true }]); else rec(e, [...pth, { idx: i }]); }); break;
        case 'AssignmentPattern': rec(p.left, pth, p.right); break;
        case 'RestElement': rec(p.argument, [...pth, { rest: true }]); break;
      }
    })(p, path, null);
  }
  const root = mkScope('function', fi.ast, null);
  function visit(node, scope) {
    switch (node.type) {
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionDeclaration' && node.id) declare(scope, node.id.name, { t: 'fn', node });
        const s = mkScope('function', node, scope);
        if (node.type === 'FunctionExpression' && node.id) declare(s, node.id.name, { t: 'fnself', node });
        node.params.forEach((p, idx) => pat(p, s, id => ({ t: 'param', fn: node, idx, id })));
        if (node.body.type === 'BlockStatement') { for (const st of node.body.body) visit(st, s); scopes.set(node.body, s); }
        else visit(node.body, s);
        return;
      }
      case 'ClassDeclaration': if (node.id) declare(scope, node.id.name, { t: 'class', node }); break;
      case 'BlockStatement': case 'StaticBlock': { const s = mkScope('block', node, scope); for (const st of node.body) visit(st, s); return; }
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
        const s = mkScope('block', node, scope);
        if (node.type === 'ForStatement') { if (node.init) visit(node.init, s); if (node.test) visit(node.test, s); if (node.update) visit(node.update, s); }
        else {
          const L = node.left;
          if (L.type === 'VariableDeclaration') for (const d of L.declarations) pat(d.id, L.kind === 'var' ? fnScope(s) : s, id => ({ t: node.type === 'ForOfStatement' ? 'forof' : 'forin', right: node.right, id }));
          else visit(L, s);
          visit(node.right, s);
        }
        visit(node.body, s); return;
      }
      case 'SwitchStatement': { visit(node.discriminant, scope); const s = mkScope('block', node, scope); for (const c of node.cases) { if (c.test) visit(c.test, s); for (const st of c.consequent) visit(st, s); } return; }
      case 'CatchClause': { const s = mkScope('block', node, scope); if (node.param) pat(node.param, s, id => ({ t: 'catch', id })); visit(node.body, s); return; }
      case 'VariableDeclaration': {
        const target = node.kind === 'var' ? fnScope(scope) : scope;
        const inFor = node.parent && /^For(In|Of)Statement$/.test(node.parent.type) && node.parent.left === node;
        if (!inFor) for (const d of node.declarations) pat(d.id, target, id => ({ t: 'var', kind: node.kind, init: d.init, id, whole: d.id }));
        break;
      }
      case 'ImportDeclaration': for (const sp of node.specifiers) declare(scope, sp.local.name, { t: 'import', source: node.source.value, imported: sp.type === 'ImportSpecifier' ? (sp.imported.name || sp.imported.value) : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*' }); break;
    }
    for (const k of kids(node)) {
      const v = node[k];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, scope); }
      else if (v && typeof v.type === 'string') visit(v, scope);
    }
  }
  visit(fi.ast, root);
  fi.scopes = scopes; fi.root = root;
  // присваивания: x = …, x += …, x++ , [a, b] = …
  walk(fi.ast, n => {
    if (n.type === 'AssignmentExpression') {
      const targets = [];
      const collect = (p, direct) => { if (!p) return; if (p.type === 'Identifier') targets.push({ id: p, direct }); else if (p.type === 'ObjectPattern') p.properties.forEach(q => collect(q.value || q.argument, false)); else if (p.type === 'ArrayPattern') p.elements.forEach(q => collect(q, false)); else if (p.type === 'AssignmentPattern') collect(p.left, false); else if (p.type === 'RestElement') collect(p.argument, false); };
      collect(n.left, true);
      for (const t of targets) { const b = lookup(fi, t.id); if (b) b.assigns.push(t.direct ? { t: 'assign', op: n.operator, right: n.right } : { t: 'unk' }); else fi.freeAssigns.push({ name: t.id.name, right: t.direct ? n.right : null, op: n.operator }); }
    } else if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') { const b = lookup(fi, n.argument); if (b) b.assigns.push({ t: 'update' }); }
  });
}
function scopeAt(fi, node) {
  for (let n = node; n; n = n.parent) { const s = fi.scopes.get(n); if (s) return s; }
  return fi.root;
}
function lookup(fi, idNode) {
  for (let s = scopeAt(fi, idNode); s; s = s.parent) { const b = s.b.get(idNode.name); if (b) return b; }
  return null;
}
function fnNameOf(fi, node) {
  for (let n = node; n; n = n.parent) {
    if (!isFn(n)) continue;
    if (n.id && n.id.name) return n.id.name;
    const p = n.parent;
    if (p) {
      if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
      if (p.type === 'AssignmentExpression') { const l = p.left; if (l.type === 'Identifier') return l.name; if (l.type === 'MemberExpression' && !l.computed && l.property.name) return l.property.name; }
      if (p.type === 'Property' && !p.computed) return p.key.name || String(p.key.value);
      if (p.type === 'MethodDefinition' && !p.computed) return p.key.name || String(p.key.value);
      if (p.type === 'PropertyDefinition' && !p.computed) return p.key.name;
    }
  }
  return '<top>';
}
const propName = m => m.type === 'MemberExpression' ? (!m.computed && m.property.type === 'Identifier' ? m.property.name : (m.computed && m.property.type === 'Literal' ? String(m.property.value) : null)) : null;

// ═══ Анализатор ═══
function createAnalyzer(opts) {
  const files = new Map();     // rel → fi
  const globalsTable = new Map(); // имя → [binding] — верхний уровень скриптов + window.X =
  const memo = new Map(), bmemo = new Map(), inProg = new Set();
  let cycleHit = 0, callIndex = null, memberIndex = null;
  const cfg = opts.config || { helpers: [] };
  const helperByName = new Map((cfg.helpers || []).map(h => [h.name, h]));
  const gradeOfName = n => ({ num: NUMG(), const: NUMG(), esc: ESCG(1, 1), esctext: ESCG(0, 0), url: URLRAW(), jsattr: JSATTR(), markup: MARKUPG(), unk: UNKG('helper') }[n] || UNKG('helper?'));

  const src = (fi, n) => fi.src.slice(n.start, n.end);
  const snip = (fi, n) => fi.src.slice(n.start, Math.min(n.end, n.start + 260)).replace(/\s+/g, ' ').slice(0, 70);
  const unk = (fi, n, why) => UNKG(why || snip(fi, n));
  const realmOf = f => /(^|\/)api\//.test(f.file) ? 'srv' : 'cli';

  function addFile(rel, text) {
    const fi = { file: rel, src: text, freeAssigns: [] };
    fi.ast = parseSrc(text, rel);
    walk(fi.ast, () => true);
    buildScopes(fi);
    files.set(rel, fi);
    if (realmOf(fi) === 'cli') {
      for (const [name, b] of fi.root.b) { if (!globalsTable.has(name)) globalsTable.set(name, []); globalsTable.get(name).push(b); }
      walk(fi.ast, n => {
        if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed && n.left.object.type === 'Identifier' && /^(window|globalThis|self)$/.test(n.left.object.name) && n.left.property.type === 'Identifier') {
          const nm = n.left.property.name;
          if (!globalsTable.has(nm)) globalsTable.set(nm, []);
          globalsTable.get(nm).push({ name: nm, fi, decls: [{ t: 'var', kind: 'window', init: n.right }], assigns: [], scope: fi.root });
        }
      });
    }
    return fi;
  }
  function buildCallIndex() {
    callIndex = new Map(); memberIndex = new Map();
    for (const fi of files.values()) {
      const realm = realmOf(fi);
      walk(fi.ast, n => {
        if (n.type === 'CallExpression') {
          const c = n.callee;
          const nm = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' ? propName(c) : null);
          if (nm) { const k = realm + ':' + nm; if (!callIndex.has(k)) callIndex.set(k, []); callIndex.get(k).push({ node: n, fi }); }
        } else if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
          const k = realm + ':' + n.property.name; if (!memberIndex.has(k)) memberIndex.set(k, []); memberIndex.get(k).push({ node: n, fi });
        }
      });
    }
  }

  // ─ разрешение имён ─
  function bindingsOf(fi, id) {
    const b = lookup(fi, id);
    if (b) return [b];
    return realmOf(fi) === 'cli' ? (globalsTable.get(id.name) || []) : [];
  }
  function exportedBinding(fi, d) {            // import { X } from './y.js' → привязка в y.js
    if (!d.source.startsWith('.')) return null;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fi.file), d.source));
    const target = files.get(rel) || files.get(rel + '.js');
    if (!target) return null;
    return target.root.b.get(d.imported) || null;
  }
  function resolveBinding(b) {                 // import → привязка в другом файле
    let guard = 0;
    while (b && b.decls.length === 1 && b.decls[0].t === 'import' && guard++ < 5) { const nb = exportedBinding(b.fi, b.decls[0]); if (!nb) return b; b = nb; }
    return b;
  }
  // экранировщик ли функция: в теле есть СТРОКИ '&lt;' и '&amp;' (в регулярных выражениях — это раскодирование, не экранирование)
  function escFlags(fi, fnNode) {
    if (fnNode.__esc !== undefined) return fnNode.__esc;
    const lits = new Set();
    walk(fnNode, n => { if (n.type === 'Literal' && typeof n.value === 'string') lits.add(n.value); else if (n.type === 'TemplateElement') lits.add(n.value.cooked); });
    const has = re => [...lits].some(s => re.test(s));
    const r = has(/&lt;/) && has(/&amp;/) ? { qd: has(/&quot;|&#34;/) ? 1 : 0, qs: has(/&#39;|&apos;|&#x27;/) ? 1 : 0 } : null;
    return hide(fnNode, '__esc', r);
  }
  function fnValueOf(b) {                       // функция, на которую указывает привязка (одна), либо null
    b = resolveBinding(b);
    if (b.decls.length !== 1 || b.assigns.length) return null;
    const d = b.decls[0];
    if (d.t === 'fn') return { fn: d.node, fi: b.fi };
    if (d.t === 'var' && d.init && !d.destruct) {
      if (isFn(d.init)) return { fn: d.init, fi: b.fi };
      if (d.init.type === 'Identifier') { const bb = lookup(b.fi, d.init); if (bb && bb !== b) return fnValueOf(bb); }
      if (d.init.type === 'MemberExpression' && !d.init.computed) { const f = fnsOfCallee(d.init, b.fi, 0); if (f && f.length === 1) return f[0]; }   // const esc = MZ.esc
    }
    return null;
  }
  // что за функции вызываются в вызове n (список {fn, fi}) либо null, если неизвестно
  function calleeFns(n, fi, depth) { return fnsOfCallee(n.callee, fi, depth); }
  function fnsOfCallee(c, fi, depth) {
    if (c.type === 'Identifier') {
      const bs = bindingsOf(fi, c); if (!bs.length) return null;
      const out = [];
      for (const b of bs) { const fv = fnValueOf(b); if (!fv) return null; out.push(fv); }
      return out;
    }
    if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier') {
      const objs = objectsOf(c.object, fi, depth || 0);
      if (!objs || !objs.length || objs.some(o => o.node.type !== 'ObjectExpression')) return null;
      const out = [];
      for (const { node: o, fi: ofi } of objs) {
        for (const p of o.properties) {
          if (p.type !== 'Property' || p.computed || (p.key.name !== c.property.name && String(p.key.value) !== c.property.name)) continue;
          if (isFn(p.value)) out.push({ fn: p.value, fi: ofi });
          else if (p.value.type === 'Identifier') { const bs = bindingsOf(ofi, p.value); if (!bs.length) return null; for (const b of bs) { const fv = fnValueOf(b); if (!fv) return null; out.push(fv); } }
          else return null;
        }
      }
      return out.length ? out : null;
    }
    if (isFn(c)) return [{ fn: c, fi }];
    return null;
  }

  // ─ глобальные пространства имён: window.D37Phone = …; P.avatar = …; Object.assign(window.X, {…}) ─
  const WIN = /^(window|globalThis|self)$/;
  const windowName = (m, fi) => m.type === 'MemberExpression' && !m.computed && m.property.type === 'Identifier' && m.object.type === 'Identifier' && WIN.test(m.object.name) && !lookup(fi, m.object) ? m.property.name : null;
  function globalNameOf(n, fi, d = 0) {         // имя глобального объекта, на который указывает выражение (или null)
    if (!n || d > 6) return null;
    const w = windowName(n, fi); if (w) return w;
    if (n.type === 'AssignmentExpression' && n.operator === '=') return windowName(n.left, fi) || globalNameOf(n.right, fi, d + 1);
    if (n.type === 'LogicalExpression') return globalNameOf(n.left, fi, d + 1);
    if (n.type === 'Identifier') {
      const b = lookup(fi, n);
      if (b) { if (b.decls.length === 1 && b.decls[0].t === 'var' && !b.decls[0].destruct && b.decls[0].init && !b.assigns.length) return globalNameOf(b.decls[0].init, b.fi, d + 1); return null; }
      return globalsTable.has(n.name) ? n.name : null;
    }
    return null;
  }
  let nsReg = null, nsBusy = new Set();
  function buildNs() {
    nsReg = new Map();
    const reg = N => { let r = nsReg.get(N); if (!r) nsReg.set(N, r = { objs: [], synth: new Map() }); return r; };
    for (const fi of files.values()) {
      if (realmOf(fi) !== 'cli') continue;
      walk(fi.ast, n => {
        if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'MemberExpression') {
          const L = n.left, wn = windowName(L, fi);
          if (wn) { reg(wn).objs.push({ node: n.right, fi }); return; }
          const pn = propName(L);
          if (pn === null) return;
          const N = globalNameOf(L.object, fi);
          if (!N) return;
          const r = reg(N); let sy = r.synth.get(fi);
          if (!sy) { sy = { type: 'ObjectExpression', properties: [], synthetic: true, start: 0, end: 0 }; r.synth.set(fi, sy); r.objs.push({ node: sy, fi }); }
          sy.properties.push({ type: 'Property', key: { type: 'Identifier', name: pn }, value: n.right, computed: false, kind: 'init' });
        } else if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && propName(n.callee) === 'assign' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Object' && n.arguments.length >= 2) {
          const N = globalNameOf(n.arguments[0], fi);
          if (N) for (const a of n.arguments.slice(1)) reg(N).objs.push({ node: a, fi });
        }
      });
    }
  }
  const nsMemo = new Map();
  function nsObjects(N, depth) {
    if (!nsReg) buildNs();
    const r = nsReg.get(N);
    if (!r) return null;
    if (nsBusy.has(N)) return [];
    if (nsMemo.has(N)) return nsMemo.get(N);
    nsBusy.add(N);
    let out = [], ok = true;
    try { for (const o of r.objs) { const q = objectsOf(o.node, o.fi, depth, new Set()); if (!q) { ok = false; break; } out.push(...q); } } finally { nsBusy.delete(N); }
    const res = ok ? out : null;
    if (!nsBusy.size) nsMemo.set(N, res);
    return res;
  }

  // ─ оценка значения ─
  let DEEP = 0;      // общая глубина вложенных разборов (grade / elemGrade / objectsOf): не даёт уйти в бесконечную рекурсию
  const MAXDEEP = 90;
  function grade(node, fi, depth = 0) {
    if (!node) return UNKG('<пусто>');
    if (memo.has(node)) return memo.get(node);
    if (inProg.has(node)) { cycleHit++; return BOTTOM(); }
    if (depth > 60 || DEEP > MAXDEEP) { cycleHit++; return UNKG('глубоко: ' + snip(fi, node)); }
    inProg.add(node); DEEP++; const before = cycleHit; let g;
    try { g = gradeInner(node, fi, depth + 1); } finally { inProg.delete(node); DEEP--; }
    if (cycleHit === before) memo.set(node, g);
    return g;
  }
  function gradeInner(n, fi, depth) {
    switch (n.type) {
      case 'Literal': return NUMG();
      case 'TemplateLiteral': {
        if (isMarkupUnit(n, fi)) return unitGrade(n, fi);
        const g = n.expressions.reduce((g, e) => join(g, grade(e, fi, depth)), NUMG());
        return startsSafeUrl(n) ? { ...g, u: 1 } : g;
      }
      case 'BinaryExpression': {
        if (n.operator !== '+') return NUMG();
        if (isMarkupUnit(n, fi)) return unitGrade(n, fi);
        const g = join(grade(n.left, fi, depth), grade(n.right, fi, depth));
        return startsSafeUrl(n) ? { ...g, u: 1 } : g;
      }
      case 'UnaryExpression': case 'UpdateExpression': return NUMG();
      case 'LogicalExpression': return n.operator === '&&' ? grade(n.right, fi, depth) : join(grade(n.left, fi, depth), grade(n.right, fi, depth));
      case 'ConditionalExpression': return join(grade(n.consequent, fi, depth), grade(n.alternate, fi, depth));
      case 'SequenceExpression': return grade(n.expressions[n.expressions.length - 1], fi, depth);
      case 'AssignmentExpression': return n.operator === '=' || n.operator === '+=' ? grade(n.right, fi, depth) : NUMG();
      case 'ChainExpression': return grade(n.expression, fi, depth);
      case 'ArrayExpression': return elemGradeOfArray(n, fi, depth);
      case 'ObjectExpression': {
        let g = NUMG();
        for (const q of n.properties) {
          if (q.type === 'SpreadElement') { g = join(g, grade(q.argument, fi, depth)); continue; }
          if (q.computed) g = join(g, grade(q.key, fi, depth));
          if (!q.value || isFn(q.value) || q.kind === 'get' || q.kind === 'set') continue;
          g = join(g, grade(q.value, fi, depth));
        }
        return g;
      }
      case 'Identifier': return gradeIdent(n, fi, depth);
      case 'MemberExpression': return gradeMember(n, fi, depth);
      case 'CallExpression': return gradeCall(n, fi, depth);
      default: return unk(fi, n);
    }
  }
  function startsSafeUrl(n){          // '#/adv/c/' + id , `/play/${g}` , 'https://…' + x — схема задана самим началом строки
    const ps = flattenUnit(n, []);
    return ps.length > 0 && ps[0].s != null && SAFE_URL_PREFIX.test(ps[0].s) && !BAD_SCHEME.test(ps[0].s);
  }
  function gradeIdent(n, fi, depth) {
    const name = n.name;
    if (name === 'undefined' || name === 'NaN' || name === 'Infinity') return NUMG();
    if (narrowedNum(n) || narrowedRegex(n, fi)) return NUMG();
    const bs = bindingsOf(fi, n);
    if (!bs.length) { const h = helperByName.get(name); return h && h.kind === 'value' ? gradeOfName(h.grade) : unk(fi, n, name + ' (нет объявления)'); }
    return joinAll(bs.map(b0 => {
      const b = resolveBinding(b0);
      const dom = domAssign(b);
      if (dom && n.start >= dom.right.start && n.end <= dom.right.end) return origParam(b, depth);   // справа от «p = …» читается ещё исходное значение параметра
      return gradeBinding(b, depth);
    }));
  }
  // typeof x === 'number' ? x : … , Number.isFinite(x) && … — внутри ветки x число
  function narrowsNum(test, name, pos) {
    if (!test) return false;
    switch (test.type) {
      case 'BinaryExpression': {
        if (!/^[!=]==?$/.test(test.operator)) return false;
        const isT = q => q.type === 'UnaryExpression' && q.operator === 'typeof' && q.argument.type === 'Identifier' && q.argument.name === name;
        const t = isT(test.left) ? test.left : isT(test.right) ? test.right : null;
        if (!t) return false;
        const lit = t === test.left ? test.right : test.left;
        if (lit.type !== 'Literal' || (lit.value !== 'number' && lit.value !== 'boolean')) return false;
        return (test.operator[0] === '=') === pos;
      }
      case 'CallExpression': {
        const c = test.callee;
        return pos && c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'Number' && ['isFinite', 'isInteger', 'isSafeInteger'].includes(propName(c)) && test.arguments[0] && test.arguments[0].type === 'Identifier' && test.arguments[0].name === name;
      }
      case 'LogicalExpression':
        if (test.operator === '&&' && pos) return narrowsNum(test.left, name, true) || narrowsNum(test.right, name, true);
        if (test.operator === '||' && !pos) return narrowsNum(test.left, name, false) || narrowsNum(test.right, name, false);
        return false;
      case 'UnaryExpression': return test.operator === '!' && narrowsNum(test.argument, name, !pos);
    }
    return false;
  }
  function narrowedNum(id) {
    for (let q = id; q.parent; q = q.parent) {
      const p = q.parent;
      if (isFn(p)) return false;
      if (p.type === 'ConditionalExpression' && p.consequent === q && narrowsNum(p.test, id.name, true)) return true;
      if (p.type === 'ConditionalExpression' && p.alternate === q && narrowsNum(p.test, id.name, false)) return true;
      if (p.type === 'LogicalExpression' && p.operator === '&&' && p.right === q && narrowsNum(p.left, id.name, true)) return true;
      if (p.type === 'LogicalExpression' && p.operator === '||' && p.right === q && narrowsNum(p.left, id.name, false)) return true;
      if (p.type === 'IfStatement' && p.consequent === q && narrowsNum(p.test, id.name, true)) return true;
      if (p.type === 'IfStatement' && p.alternate === q && narrowsNum(p.test, id.name, false)) return true;
    }
    return false;
  }
  // Регулярное выражение, которое пропускает только «безопасные» знаки (буквы, цифры, _ # . + - %): ^[0-9a-f]{6}$ , ^#[0-9a-f]{3,8}$ , ^\\d+$
  function safeRegex(re){
    if (!re || !re.regex) return false;
    const src = re.regex.pattern;
    if (!src.startsWith('^') || !src.endsWith('$') || src.endsWith('\\$')) return false;
    let i = 1, depth = 0, inCls = false;
    const end = src.length - 1;
    while (i < end) {
      const c = src[i];
      if (inCls) {
        if (c === ']') { inCls = false; i++; continue; }
        if (c === '\\') { const d = src[i + 1]; if (d && '.+-%dw'.includes(d)) { i += 2; continue; } return false; }
        if (/[A-Za-z0-9_#.+%-]/.test(c)) { i++; continue; }
        return false;
      }
      if (c === '[') { inCls = true; i++; if (src[i] === '^') return false; continue; }
      if (c === '\\') { const d = src[i + 1]; if (d && '.+-%dw'.includes(d)) { i += 2; continue; } return false; }
      if (c === '(') { depth++; i++; if (src[i] === '?') { if (src[i + 1] === ':') i += 2; else return false; } continue; }
      if (c === ')') { if (!depth) return false; depth--; i++; continue; }
      if (c === '|') { if (!depth) return false; i++; continue; }
      if (c === '{') { const m = /^\{\d+(,\d*)?\}/.exec(src.slice(i)); if (!m) return false; i += m[0].length; continue; }
      if (c === '+' || c === '*' || c === '?') { i++; continue; }
      if (/[A-Za-z0-9_#%-]/.test(c)) { i++; continue; }
      return false;
    }
    return !inCls && !depth;
  }
  const testedText = (fi, test) => {      // SAFE_RE.test(X) → текст X
    if (test.type === 'CallExpression' && test.callee.type === 'MemberExpression' && propName(test.callee) === 'test' && test.callee.object.type === 'Literal' && safeRegex(test.callee.object) && test.arguments.length === 1) return src(fi, test.arguments[0]);
    if (test.type === 'LogicalExpression' && test.operator === '&&') return testedText(fi, test.left) || testedText(fi, test.right);
    return null;
  };
  function narrowedRegex(n, fi){
    const t = src(fi, n);
    for (let q = n; q.parent; q = q.parent) {
      const p = q.parent;
      if (isFn(p)) return false;
      if (p.type === 'ConditionalExpression' && p.consequent === q && testedText(fi, p.test) === t) return true;
      if (p.type === 'LogicalExpression' && p.operator === '&&' && p.right === q && testedText(fi, p.left) === t) return true;
      if (p.type === 'IfStatement' && p.consequent === q && testedText(fi, p.test) === t) return true;
    }
    return false;
  }
  // параметр сразу переприсваивают в начале функции («n = parseInt(n) || 0»): исходное значение дальше не живёт
  function domAssign(b) {
    if (b.__dom !== undefined) return b.__dom;
    let r = null;
    const pd = b.decls.length === 1 && b.decls[0].t === 'param' && !b.decls[0].destruct ? b.decls[0] : null;
    if (pd && pd.fn.body.type === 'BlockStatement') {
      const refs = refsOf(b);
      for (const st of pd.fn.body.body) {
        if (st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' && st.expression.operator === '=' && st.expression.left.type === 'Identifier' && st.expression.left.name === b.name) { r = st.expression; break; }
        if (refs.some(x => x.start >= st.start && x.end <= st.end)) break;
      }
    }
    return hide(b, '__dom', r);
  }
  function origParam(b, depth) {
    if (b.__orig) return b.__orig;
    if (inProg.has(b.decls)) { cycleHit++; return BOTTOM(); }
    inProg.add(b.decls);
    let g; try { g = gradeDecl(b, b.decls[0], b.fi, depth + 1); } finally { inProg.delete(b.decls); }
    return hide(b, '__orig', g);
  }
  function gradeBinding(b, depth) {
    if (bmemo.has(b)) return bmemo.get(b);
    if (inProg.has(b)) { cycleHit++; return BOTTOM(); }
    inProg.add(b); const before = cycleHit; let g = BOTTOM();
    try {
      const fi = b.fi;
      const h = b.scope === fi.root ? helperByName.get(b.name) : null;
      if (h && h.kind === 'value' && (!h.file || h.file === fi.file)) g = gradeOfName(h.grade);
      else {
        const dom = domAssign(b);
        for (const d of b.decls) { if (dom && d.t === 'param') continue; g = join(g, gradeDecl(b, d, fi, depth + 1)); }
        for (const a of b.assigns) {
          if (a.t === 'assign') g = join(g, a.op === '=' || a.op === '+=' ? grade(a.right, fi, depth + 1) : NUMG());
          else if (a.t === 'update') g = join(g, NUMG());
          else g = join(g, UNKG(b.name + ' (присваивание)'));
        }
      }
    } finally { inProg.delete(b); }
    if (cycleHit === before) bmemo.set(b, g);
    return g;
  }
  function gradeDecl(b, d, fi, depth) {
    if (d.destruct && d.t !== 'catch' && d.t !== 'import') {
      const g = destructGrade(b, d, fi, depth);
      return d.dflt ? join(g, grade(d.dflt, fi, depth)) : g;
    }
    switch (d.t) {
      case 'var': return d.init ? grade(d.init, fi, depth) : NUMG();
      case 'param': return paramGrade(b, d, fi, depth);
      case 'forof': return elemGrade(d.right, fi, depth);
      case 'forin': return constObject(d.right, fi) ? NUMG() : UNKG(b.name + ' (for…in)');
      case 'import': return UNKG(b.name + ' (import)');
      case 'fn': case 'fnself': case 'class': return UNKG(b.name + ' (функция как значение)');
      case 'catch': return UNKG(b.name + ' (ошибка)');
      default: return UNKG(b.name);
    }
  }
  // деструктуризация: const { a, b: [c] } = ТАБЛИЦА-КОНСТАНТА; for (const [k, v] of Object.entries(КОНСТАНТА)); map(([k, v]) => …)
  function destructGrade(b, d, fi, depth) {
    const bad = UNKG(b.name + ' (деструктуризация)');
    if (d.path.some(q => q.rest)) return bad;
    let srcs = null;            // [{node, fi}] — Object/ArrayExpression, из которых берём
    let entries = null;         // Object.entries(X): пары [ключ, значение]
    const entriesOf = n => n && n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && propName(n.callee) === 'entries' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'Object' && n.arguments[0] ? n.arguments[0] : null;
    if (d.t === 'var') srcs = d.init ? objectsOf(d.init, fi, depth) : null;
    else if (d.t === 'forof') { const e = entriesOf(d.right); if (e) entries = e; else srcs = elemObjects(d.right, fi, depth); }
    else if (d.t === 'param') {
      const call = d.fn.parent;
      if (call && call.type === 'CallExpression' && call.arguments.includes(d.fn) && call.callee.type === 'MemberExpression' && !call.callee.computed && ITER_CB.has(call.callee.property.name) && d.idx === 0) {
        const e = entriesOf(call.callee.object); if (e) entries = e; else srcs = elemObjects(call.callee.object, fi, depth);
      } else srcs = paramArgObjects(b, d, depth);
    }
    if (entries) {
      const o = constObject(entries, fi);
      if (!o || d.path.length < 1 || d.path[0].idx == null) return bad;
      if (d.path[0].idx === 0) return d.path.length === 1 ? NUMG() : bad;
      if (d.path[0].idx !== 1) return bad;
      const vals = o.properties.map(pr => pr.type === 'Property' ? pr.value : null);
      if (vals.some(v => !v)) return bad;
      if (d.path.length === 1) return joinAll(vals.map(v => grade(v, fi, depth)));
      srcs = []; for (const v of vals) { const r = objectsOf(v, fi, depth); if (!r) return bad; srcs.push(...r); }
      return followPath(srcs, d.path.slice(1), depth) || bad;
    }
    if (!srcs || !srcs.length) return bad;
    return followPath(srcs, d.path, depth) || bad;
  }
  const UNDEF = () => ({ type: 'Literal', value: undefined, start: 0, end: 0, synthetic: true });
  function followPath(srcs, path, depth) {      // по пути ключей/номеров к значениям; null — не знаем
    let cur = srcs;
    for (let i = 0; i < path.length; i++) {
      const st = path[i], last = i === path.length - 1, vals = [];
      for (const { node: o, fi: ofi } of cur) {
        if (o.type === 'ObjectExpression') {
          if (st.key == null) return null;
          let found = false;
          for (const pr of o.properties) { if (pr.type !== 'Property') return null; if (!pr.computed && (pr.key.name === st.key || String(pr.key.value) === st.key)) { vals.push({ node: pr.value, fi: ofi }); found = true; } }
          if (!found) vals.push({ node: UNDEF(), fi: ofi });
        } else if (o.type === 'ArrayExpression') {
          if (st.idx == null) return null;
          const e = o.elements[st.idx];
          if (e && e.type === 'SpreadElement') return null;
          vals.push({ node: e || UNDEF(), fi: ofi });
        } else return null;
      }
      if (last) return joinAll(vals.map(v => v.node.synthetic ? NUMG() : grade(v.node, v.fi, depth)));
      cur = [];
      for (const v of vals) { if (v.node.synthetic) continue; const r = objectsOf(v.node, v.fi, depth); if (!r) return null; cur.push(...r); }
      if (!cur.length) return null;
    }
    return null;
  }
  function paramGrade(b, d, fi, depth) {
    const fn = d.fn, call = fn.parent;
    if (call && call.type === 'CallExpression' && call.arguments.includes(fn) && call.callee.type === 'MemberExpression' && !call.callee.computed) {
      const m = call.callee.property.name;
      if (ITER_CB.has(m)) {
        if (m === 'sort' || m === 'toSorted') return d.idx <= 1 && !d.destruct ? elemGrade(call.callee.object, fi, depth) : NUMG();
        if (d.idx === 0 && !d.destruct) return elemGrade(call.callee.object, fi, depth);
        if (d.idx === 1 && !d.destruct) return NUMG();
        return UNKG(b.name + ' (параметр)');
      }
      if ((m === 'reduce' || m === 'reduceRight') && !d.destruct) {
        if (d.idx === 0) return join(call.arguments[1] ? grade(call.arguments[1], fi, depth) : UNKG('reduce без начального'), returnsGrade(fn, fi, depth));
        if (d.idx === 1) return elemGrade(call.callee.object, fi, depth);
        return NUMG();
      }
    }
    if (call && call.type === 'CallExpression' && call.callee === fn && !d.destruct) {   // (x => …)(arg)
      const a = call.arguments[d.idx]; return a ? grade(a, fi, depth) : NUMG();
    }
    const sites = callSitesOf(fn, fi, depth);
    if (sites && !d.destruct) {
      let g = BOTTOM();
      for (const c of sites) {
        if (c.iter) { g = join(g, d.idx === 0 ? elemGrade(c.iter.callee.object, c.fi, depth) : NUMG()); continue; }
        if (c.node.arguments.some(a => a.type === 'SpreadElement')) return UNKG(b.name + ' (параметр)');
        const a = c.node.arguments[d.idx];
        g = join(g, a ? grade(a, c.fi, depth) : (d.dflt ? grade(d.dflt, fi, depth) : NUMG()));
      }
      if (d.dflt) g = join(g, grade(d.dflt, fi, depth));
      return g;
    }
    return UNKG(b.name + ' (параметр' + (fn.__why ? ' #' + fn.__why : '') + ')');
  }

  // Откуда вызывают функцию: прямые вызовы по имени и по имени свойства (экспорт «{ f }», «X.f = f», «f: function»).
  // Любое другое использование (передали как значение, вернули, присвоили другому имени) → null («не знаем»).
  const keyName = p => p.key.name || String(p.key.value);
  const WHY = process.env.XSS_DEBUG ? [] : null;
  function callSitesOf(fn, fi) {
    const why = k => { if (WHY) fn.__why = k; return null; };
    if (fn.__sites !== undefined) return fn.__sites;
    hide(fn, '__sites', null);
    if (!callIndex) buildCallIndex();
    const realm = realmOf(fi), p = fn.parent;
    const propNames = new Set(), allNames = new Set(), sites = [];
    let bind = null;
    if (fn.type === 'FunctionDeclaration' && fn.id) bind = lookup(fi, fn.id);
    else if (p.type === 'VariableDeclarator' && p.init === fn && p.id.type === 'Identifier') bind = lookup(fi, p.id);
    else if (p.type === 'Property' && p.value === fn && !p.computed) propNames.add(keyName(p));
    else if (p.type === 'MethodDefinition' && !p.computed) propNames.add(keyName(p));
    else if (p.type === 'AssignmentExpression' && p.right === fn && p.operator === '=') {
      if (p.left.type === 'Identifier') bind = lookup(fi, p.left);
      else if (p.left.type === 'MemberExpression' && propName(p.left)) propNames.add(propName(p.left));
      else return why(1);
    } else return why(2);                        // колбэк, возврат, элемент массива — кто и как вызовет, не знаем
    if (bind) {
      if (bind.decls.length !== 1) return why(3);
      allNames.add(bind.name);
      for (const r of refsOf(bind)) {
        const q = r.parent;
        if ((q.type === 'FunctionDeclaration' && q.id === r) || (q.type === 'VariableDeclarator' && q.id === r) || (q.type === 'AssignmentExpression' && q.left === r)) continue;
        if (q.type === 'CallExpression' && q.callee === r) continue;                       // прямой вызов — найдём в индексе
        if (q.type === 'Property' && q.shorthand && q.key === r) continue;                 // ключ укороченной записи
        if (q.type === 'Property' && q.value === r && !q.computed) { propNames.add(keyName(q)); continue; }
        if (q.type === 'AssignmentExpression' && q.right === r && q.operator === '=' && q.left.type === 'MemberExpression' && propName(q.left)) { propNames.add(propName(q.left)); continue; }
        if (q.type === 'CallExpression' && q.arguments.includes(r) && q.callee.type === 'MemberExpression' && !q.callee.computed && ITER_CB.has(q.callee.property.name)) { sites.push({ iter: q, fi: bind.fi }); continue; }
        if (isGuard(q, r)) continue;
        return why(4);
      }
    }
    if (bind && realm === 'srv' && bind.scope === bind.fi.root) {          // вызовы из других файлов через import { f } from '…'
      for (const f of files.values()) {
        if (f === bind.fi || realmOf(f) !== 'srv') continue;
        for (const ib of f.root.b.values()) {
          if (ib.decls.length !== 1 || ib.decls[0].t !== 'import' || resolveBinding(ib) !== bind) continue;
          for (const r of refsOf(ib)) {
            const q = r.parent;
            if (q.type === 'ImportSpecifier' || q.type === 'ImportDefaultSpecifier' || q.type === 'ImportNamespaceSpecifier') continue;
            if (q.type === 'CallExpression' && q.callee === r) { sites.push({ node: q, fi: f }); continue; }
            if (q.type === 'CallExpression' && q.arguments.includes(r) && q.callee.type === 'MemberExpression' && !q.callee.computed && ITER_CB.has(q.callee.property.name)) { sites.push({ iter: q, fi: f }); continue; }
            if (isGuard(q, r)) continue;
            return why(7);
          }
        }
      }
    }
    for (const nm of propNames) {
      allNames.add(nm);
      if (BUILTIN_NAMES.has(nm)) return why(5);
      for (const u of memberIndex.get(realm + ':' + nm) || []) {            // обращения к свойству не вызовом — функция «уходит»
        const q = u.node.parent;
        if ((q.type === 'CallExpression' && q.callee === u.node) || (q.type === 'AssignmentExpression' && q.left === u.node) || isGuard(q, u.node)) continue;
        return why(6);
      }
    }
    if (bind) {                                    // вызовы по голому имени: та же привязка (или глобальная функция верхнего уровня)
      for (const c of callIndex.get(realm + ':' + bind.name) || []) {
        const cc = c.node.callee;
        if (cc.type !== 'Identifier') continue;
        const bb = lookup(c.fi, cc);
        if (bb) { if (bb !== bind) continue; } else if (bind.scope !== bind.fi.root) continue;
        sites.push(c);
      }
    }
    for (const nm of propNames) {                  // вызовы через точку: любой объект с таким методом
      for (const c of callIndex.get(realm + ':' + nm) || []) {
        const cc = c.node.callee;
        if (cc.type === 'MemberExpression') sites.push(c);
        else if (cc.type === 'Identifier' && !lookup(c.fi, cc) && bind && bind.scope === bind.fi.root) sites.push(c);
      }
    }
    const uniq = [...new Set(sites)];
    return hide(fn, '__sites', uniq.length && uniq.length <= 80 ? uniq : null);
  }
  function isGuard(q, r) {   // typeof f, f && …, f ? … : …, if (f), !f, f ?. — просто проверка, что функция есть
    if (q.type === 'UnaryExpression' && (q.operator === 'typeof' || q.operator === '!')) return true;
    if (q.type === 'LogicalExpression' && q.left === r) return true;
    if (q.type === 'ConditionalExpression' && q.test === r) return true;
    if ((q.type === 'IfStatement' || q.type === 'WhileStatement') && q.test === r) return true;
    if (q.type === 'BinaryExpression' && /^[!=]==?$/.test(q.operator)) return true;
    return false;
  }

  // ─ элементы массивов и таблицы-константы ─
  function elemGradeOfArray(arr, fi, depth) {
    let g = BOTTOM();
    for (const e of arr.elements) { if (!e) continue; g = join(g, e.type === 'SpreadElement' ? elemGrade(e.argument, fi, depth) : grade(e, fi, depth)); }
    return g;
  }
  const elemMemo = new Map();
  function elemGrade(n, fi, depth) {          // что лежит ВНУТРИ массива n (как для for…of, map)
    if (!n) return UNKG('?');
    if (elemMemo.has(n)) return elemMemo.get(n);
    if (DEEP > MAXDEEP) { cycleHit++; return UNKG('глубоко'); }
    DEEP++; const before = cycleHit; let g;
    try { g = elemGrade0(n, fi, depth); } finally { DEEP--; }
    if (cycleHit === before) elemMemo.set(n, g);
    return g;
  }
  function elemGrade0(n, fi, depth) {
    switch (n.type) {
      case 'ArrayExpression': return elemGradeOfArray(n, fi, depth);
      case 'Identifier': {
        const bs = bindingsOf(fi, n); if (!bs.length) return unk(fi, n, n.name + ' (нет объявления)');
        let g = BOTTOM();
        for (let b of bs) {
          b = resolveBinding(b);
          for (const d of b.decls) {
            if (d.t === 'var' && !d.destruct && d.init) g = join(g, elemGrade(d.init, b.fi, depth + 1));
            else if (d.t === 'var' && !d.destruct) continue;
            else if (d.t === 'param' && !d.destruct) g = join(g, joinAll(paramArgs(b, d, depth + 1).map(a => elemGrade(a.node, a.fi, depth + 1))));
            else g = join(g, UNKG(b.name + ' (список)'));
          }
          for (const a of b.assigns) g = join(g, a.t === 'assign' ? elemGrade(a.right, b.fi, depth + 1) : UNKG(b.name));
          g = join(g, pushedGrade(b, depth));
        }
        return g;
      }
      case 'CallExpression': {
        const c = n.callee;
        if (c.type === 'MemberExpression' && !c.computed) {
          const m = c.property.name;
          if (m === 'map' || m === 'flatMap') { const cb = n.arguments[0]; if (cb && isFn(cb)) return returnsGrade(cb, fi, depth); if (cb && (cb.type === 'Identifier' || cb.type === 'MemberExpression')) { const fns = fnsOfCallee(cb, fi, depth); if (fns && fns.length && fns.every(t => escFlags(t.fi, t.fn))) { const fl = fns.map(t => escFlags(t.fi, t.fn)); return ESCG(Math.min(...fl.map(f => f.qd)), Math.min(...fl.map(f => f.qs))); } return fns ? joinAll(fns.map(t => returnsGrade(t.fn, t.fi, depth + 1))) : UNKG('map(' + snip(fi, cb) + ')'); } return UNKG('map(?)'); }
          if (ARRAY_KEEP.has(m)) return elemGrade(c.object, fi, depth);
          if (m === 'concat') { let g = elemGrade(c.object, fi, depth); for (const a of n.arguments) g = join(g, a.type === 'ArrayExpression' ? elemGradeOfArray(a, fi, depth) : elemGrade(a, fi, depth)); return g; }
          if (m === 'split') return grade(c.object, fi, depth);
          if (c.object.type === 'Identifier' && c.object.name === 'Object' && !lookup(fi, c.object)) {
            if (m === 'keys') return constObject(n.arguments[0], fi) ? NUMG() : UNKG('Object.keys ' + (n.arguments[0] ? snip(fi, n.arguments[0]) : ''));
            if (m === 'values') return objValuesGrade(n.arguments[0], fi, depth);
          }
          if (c.object.type === 'Identifier' && c.object.name === 'Array' && m === 'from') {
            const mapper = n.arguments[1]; if (mapper && isFn(mapper)) return returnsGrade(mapper, fi, depth);
            return n.arguments[0] ? elemGrade(n.arguments[0], fi, depth) : UNKG('Array.from');
          }
          if (m === 'keys' && c.object.type === 'CallExpression') return NUMG();   // Array(n).keys()
          if (m === 'fill') return n.arguments[0] ? join(grade(n.arguments[0], fi, depth), elemGrade(c.object, fi, depth)) : NUMG();
        }
        if (c.type === 'Identifier' && c.name === 'Array' && !lookup(fi, c)) return NUMG();
        const fns = calleeFns(n, fi, depth);
        if (fns && fns.length) return joinAll(fns.map(t => returnElemGrade(t.fn, t.fi, depth)));
        return UNKG(snip(fi, n));
      }
      case 'NewExpression': if (n.callee.type === 'Identifier' && n.callee.name === 'Array') return NUMG(); return UNKG(snip(fi, n));
      case 'ConditionalExpression': return join(elemGrade(n.consequent, fi, depth), elemGrade(n.alternate, fi, depth));
      case 'LogicalExpression': return join(elemGrade(n.left, fi, depth), elemGrade(n.right, fi, depth));
      case 'SpreadElement': return elemGrade(n.argument, fi, depth);
      default: return UNKG(snip(fi, n));
    }
  }
  function returnElemGrade(fn, fi, depth) {
    if (fn.body.type !== 'BlockStatement') return elemGrade(fn.body, fi, depth);
    let g = BOTTOM();
    for (const n of returnsOf(fn)) if (n.argument) g = join(g, elemGrade(n.argument, fi, depth + 1));
    return g.bottom ? NUMG() : g;
  }
  function paramArgs(b, d, depth) {       // выражения, которые передают в параметр (если известны)
    const sites = callSitesOf(d.fn, b.fi, depth);
    if (!sites) return [{ node: { type: 'Unknown', start: 0, end: 0 }, fi: b.fi }];
    const out = [];
    for (const c of sites) { if (c.iter) { out.push({ node: { type: 'Unknown', start: 0, end: 0 }, fi: c.fi }); continue; } const a = c.node.arguments[d.idx]; if (a) out.push({ node: a, fi: c.fi }); }
    return out;
  }
  function constObject(n, fi) {               // выражение → ObjectExpression, если это константа-таблица
    if (!n) return null;
    if (n.type === 'ObjectExpression') return n;
    if (n.type === 'Identifier') { const bs = bindingsOf(fi, n); if (bs.length === 1 && bs[0].decls.length === 1 && !bs[0].assigns.length) { const d = bs[0].decls[0]; if (d.t === 'var' && !d.destruct && d.init && d.init.type === 'ObjectExpression') return d.init; } }
    return null;
  }
  function objValuesGrade(n, fi, depth) {
    const o = constObject(n, fi);
    if (!o) return UNKG('Object.values ' + (n ? snip(fi, n) : ''));
    return joinAll(o.properties.map(p => p.type === 'Property' ? grade(p.value, fi, depth) : UNKG('spread')));
  }
  // arr.push(x) / unshift / arr[i] = x по всем ссылкам на привязку
  function refsOf(b) {
    if (b.__refs) return b.__refs;
    const fi = b.fi;
    if (!fi.ids) { fi.ids = new Map(); walk(fi.ast, n => { if (n.type === 'Identifier') { let l = fi.ids.get(n.name); if (!l) fi.ids.set(n.name, l = []); l.push(n); } }); }
    return hide(b, '__refs', (fi.ids.get(b.name) || []).filter(n => isRefPos(n) && lookup(fi, n) === b));
  }
  function isRefPos(n) {          // идентификатор — обращение к переменной (а не имя свойства, ключ, метка)
    const q = n.parent;
    if (!q) return true;
    if (q.type === 'MemberExpression' && q.property === n && !q.computed) return false;
    if ((q.type === 'Property' || q.type === 'MethodDefinition' || q.type === 'PropertyDefinition') && q.key === n && !q.computed && !q.shorthand) return false;
    if (q.type === 'LabeledStatement' || q.type === 'BreakStatement' || q.type === 'ContinueStatement') return false;
    return true;
  }
  function pushedGrade(b, depth) {
    if (b.__pushed) return b.__pushed;
    let g = BOTTOM();
    hide(b, '__pushed', g);
    for (const n of refsOf(b)) {
      const p = n.parent;
      if (p.type === 'MemberExpression' && p.object === n && p.parent) {
        const pp = p.parent;
        if (pp.type === 'CallExpression' && pp.callee === p && !p.computed && ['push', 'unshift'].includes(p.property.name)) for (const a of pp.arguments) g = join(g, a.type === 'SpreadElement' ? elemGrade(a.argument, b.fi, depth + 1) : grade(a, b.fi, depth + 1));
        else if (pp.type === 'CallExpression' && pp.callee === p && !p.computed && p.property.name === 'splice') for (const a of pp.arguments.slice(2)) g = join(g, grade(a, b.fi, depth + 1));
        else if (pp.type === 'AssignmentExpression' && pp.left === p) g = join(g, pp.operator === '=' || pp.operator === '+=' ? grade(pp.right, b.fi, depth + 1) : NUMG());
      }
    }
    return hide(b, '__pushed', g);
  }
  function mutations(b) {                    // что делают с таблицей/списком: { pushes: [выражения], bad: меняют иначе }
    if (b.__mut) return b.__mut;
    const r = { pushes: [], bad: false };
    hide(b, '__mut', r);
    for (const n of refsOf(b)) {
      const p = n.parent;
      if (p.type === 'MemberExpression' && p.object === n && p.parent) {
        const pp = p.parent;
        if (pp.type === 'CallExpression' && pp.callee === p && !p.computed) {
          const m = p.property.name;
          if (m === 'push' || m === 'unshift') { for (const a of pp.arguments) { if (a.type === 'SpreadElement') r.bad = true; else r.pushes.push({ node: a, fi: b.fi }); } }
          else if (['splice', 'assign', 'fill', 'copyWithin'].includes(m)) r.bad = true;
        } else if (pp.type === 'AssignmentExpression' && pp.left === p) r.bad = true;
        else if (pp.type === 'UpdateExpression') r.bad = true;
      }
      if (p.type === 'CallExpression' && p.callee.type === 'MemberExpression' && propName(p.callee) === 'assign' && p.arguments[0] === n) r.bad = true;
    }
    return r;
  }
  function gradeMember(n, fi, depth) {
    const o = n.object;
    const pn = propName(n);
    if (pn === 'length') return NUMG();
    if (o.type === 'Identifier' && /^(Math|Number)$/.test(o.name) && !lookup(fi, o)) return NUMG();
    if (pn === 'innerHTML' || pn === 'outerHTML') return MARKUPG();
    if (narrowedRegex(n, fi)) return NUMG();
    const t = tableGrade(n, fi, depth);
    if (t) return t;
    return unk(fi, n);
  }
  // Объекты/массивы, значения которых известны: ObjectExpression / ArrayExpression (прямо, через const, элемент for…of / map, IIFE, возврат функции)
  const objMemo = new Map();
  let trunc = 0;
  function objectsOf(n, fi, depth, seen) {
    if (DEEP > MAXDEEP) { trunc++; return null; }
    const top = !seen;
    if (top && n && objMemo.has(n)) return objMemo.get(n);
    DEEP++;
    seen = seen || new Set();
    if (!n || seen.has(n) || seen.size > 60) { DEEP--; trunc++; return null; }
    seen.add(n);                           // seen — путь рекурсии (защита от циклов), а не все посещённые узлы
    const t0 = trunc;
    let r;
    try { r = objectsOf0(n, fi, depth, seen); } finally { DEEP--; seen.delete(n); }
    if (top && trunc === t0 && !nsBusy.size) objMemo.set(n, r);
    return r;
  }
  function objectsOf0(n, fi, depth, seen) {
    switch (n.type) {
      case 'ObjectExpression': case 'ArrayExpression': return [{ node: n, fi }];
      case 'AssignmentExpression': {
        if (n.operator !== '=') return null;
        const r = objectsOf(n.right, fi, depth + 1, seen); if (!r) return null;
        const w = windowName(n.left, fi);
        if (w) { const q = nsObjects(w, depth + 1); if (!q) return null; return [...r, ...q]; }
        return r;
      }
      case 'Identifier': {
        const bs = bindingsOf(fi, n);
        if (!bs.length) return realmOf(fi) === 'cli' ? nsObjects(n.name, depth + 1) : null;
        const out = [];
        for (let b of bs) {
          b = resolveBinding(b);
          // const P = window.D37Phone — имя глобального пространства: P.x = … в этом файле — это его члены (они учтены в nsObjects)
          const nsName = b.decls.length === 1 && b.decls[0].t === 'var' && !b.decls[0].destruct && b.decls[0].init && !b.assigns.length ? globalNameOf(b.decls[0].init, b.fi) : null;
          if (nsName) { const q = nsObjects(nsName, depth + 1); if (!q) return null; out.push(...q); continue; }
          const mu = mutations(b);
          if (mu.bad) return null;
          const start = out.length;
          for (const d of b.decls) {
            if (d.t === 'var' && !d.destruct && d.init) { const r = objectsOf(d.init, b.fi, depth + 1, seen); if (!r) return null; out.push(...r); }
            else if (d.t === 'var' && !d.destruct) continue;
            else if (d.t === 'forof' && !d.destruct) { const r = elemObjects(d.right, b.fi, depth + 1, seen); if (!r) return null; out.push(...r); }
            else if (d.t === 'param' && !d.destruct) { const r = paramObjects(b, d, depth + 1, seen); if (!r) return null; out.push(...r); }
            else return null;
          }
          for (const a of b.assigns) { if (a.t !== 'assign' || a.op !== '=') return null; const r = objectsOf(a.right, b.fi, depth + 1, seen); if (!r) return null; out.push(...r); }
          if (mu.pushes.length) {            // arr.push(x): к каждому списку добавляем элементы
            for (let i = start; i < out.length; i++) {
              if (out[i].node.type !== 'ArrayExpression') return null;
              out[i] = { node: { type: 'ArrayExpression', elements: [...out[i].node.elements, ...mu.pushes.map(q => q.node)], synthetic: true, start: out[i].node.start, end: out[i].node.end }, fi: out[i].fi, pushedFi: mu.pushes[0].fi };
            }
          }
        }
        return out;
      }
      case 'ConditionalExpression': { const a = objectsOf(n.consequent, fi, depth, seen), b = objectsOf(n.alternate, fi, depth, seen); return a && b ? [...a, ...b] : null; }
      case 'LogicalExpression': { const a = objectsOf(n.left, fi, depth, seen), b = objectsOf(n.right, fi, depth, seen); return a && b ? [...a, ...b] : null; }
      case 'MemberExpression': {
        const w = windowName(n, fi);
        if (w) return nsObjects(w, depth + 1);
        const base = objectsOf(n.object, fi, depth + 1, seen); if (!base) return null;
        const pn = propName(n);
        const out = [];
        for (const { node: o, fi: ofi } of base) {
          const vals = o.type === 'ObjectExpression' ? o.properties.filter(p => p.type === 'Property' && (pn === null || (!p.computed && (p.key.name === pn || String(p.key.value) === pn)))).map(p => p.value)
            : o.elements.filter(Boolean);
          for (const v of vals) { const r = objectsOf(v, ofi, depth + 1, seen); if (r) out.push(...r); }
        }
        return out.length ? out : null;
      }
      case 'CallExpression': {
        const c = n.callee;
        if (c.type === 'MemberExpression' && !c.computed) {
          const m = c.property.name;
          if (['find', 'at', 'pop', 'shift', 'findLast'].includes(m)) return elemObjects(c.object, fi, depth + 1, seen);
          if (ARRAY_KEEP.has(m) || m === 'concat') { const r = objectsOf(c.object, fi, depth + 1, seen); if (!r) return null; if (m === 'concat') { for (const a of n.arguments) { const q = a.type === 'ArrayExpression' ? [{ node: a, fi }] : objectsOf(a, fi, depth + 1, seen); if (!q) return null; r.push(...q); } } return r; }
          if (m === 'map' && n.arguments[0] && isFn(n.arguments[0])) { return returnObjects(n.arguments[0], fi, depth + 1, seen, true); }
        }
        const fns = calleeFns(n, fi, depth);
        if (fns && fns.length) { const out = []; for (const t of fns) { const r = returnObjects(t.fn, t.fi, depth + 1, seen, false); if (!r) return null; out.push(...r); } return out; }
        return null;
      }
      default: return null;
    }
  }
  function returnObjects(fn, fi, depth, seen, wrapArray) {      // объекты, которые возвращает функция
    const out = [];
    if (fn.body.type !== 'BlockStatement') { const r = objectsOf(fn.body, fi, depth, seen); if (!r) return null; out.push(...r); }
    else {
      for (const n of returnsOf(fn)) if (n.argument) { const r = objectsOf(n.argument, fi, depth, seen); if (!r) return null; out.push(...r); }
    }
    if (wrapArray) return out.length ? [{ node: { type: 'ArrayExpression', elements: out.map(o => o.node), start: fn.start, end: fn.end, synthetic: true }, fi }] : null;
    return out;
  }
  function elemObjects(n, fi, depth, seen) {      // объекты-элементы списка n
    const arrs = objectsOf(n, fi, depth, seen);
    if (!arrs) return null;
    const out = [];
    for (const { node: a, fi: afi } of arrs) {
      if (a.type !== 'ArrayExpression') return null;
      for (const e of a.elements) { if (!e) continue; if (e.type === 'SpreadElement') { const r = elemObjects(e.argument, afi, depth + 1, seen); if (!r) return null; out.push(...r); continue; } const r = objectsOf(e, afi, depth + 1, seen); if (!r) return null; out.push(...r); }
    }
    return out;
  }
  function paramObjects(b, d, depth, seen) {
    if (d.destruct) return null;
    const fn = d.fn, call = fn.parent;
    if (call && call.type === 'CallExpression' && call.arguments.includes(fn) && call.callee.type === 'MemberExpression' && !call.callee.computed && ITER_CB.has(call.callee.property.name) && d.idx === 0) return elemObjects(call.callee.object, b.fi, depth, seen);
    return paramArgObjects(b, d, depth, seen);
  }
  function paramArgObjects(b, d, depth, seen) {          // объекты, которые передают в параметр по всем местам вызова
    const sites = callSitesOf(d.fn, b.fi);
    if (!sites) return null;
    const out = [];
    for (const c of sites) {
      if (c.iter) { if (d.idx !== 0) return null; const r = elemObjects(c.iter.callee.object, c.fi, depth, seen); if (!r) return null; out.push(...r); continue; }
      const a = c.node.arguments[d.idx]; if (!a) continue;
      if (a.type === 'SpreadElement') return null;
      const r = objectsOf(a, c.fi, depth + 1, seen); if (!r) return null; out.push(...r);
    }
    return out.length ? out : null;
  }
  function tableGrade(n, fi, depth) {
    const objs = objectsOf(n.object, fi, depth);
    if (!objs) return null;
    const pn = propName(n);
    let g = BOTTOM(), any = false;
    for (const { node: o, fi: ofi } of objs) {
      if (o.type === 'ObjectExpression') {
        for (const p of o.properties) {
          if (p.type !== 'Property') return null;
          if (pn !== null && !p.computed && (p.key.name === pn || String(p.key.value) === pn)) { g = join(g, grade(p.value, ofi, depth + 1)); any = true; }
          else if (pn === null) { g = join(g, grade(p.value, ofi, depth + 1)); any = true; }
        }
        if (pn !== null && !any) g = join(g, NUMG());
      } else {
        if (pn !== null && !/^\d+$/.test(pn)) return null;
        for (const e of o.elements) { if (!e) continue; g = join(g, e.type === 'SpreadElement' ? elemGrade(e.argument, ofi, depth + 1) : grade(e, ofi, depth + 1)); any = true; }
      }
    }
    return g;
  }

  // ─ вызовы ─
  function returnsOf(fn) {                    // все `return` функции (без вложенных функций), один раз
    if (fn.__rets) return fn.__rets;
    const out = [];
    walk(fn.body, n => { if (isFn(n)) return false; if (n.type === 'ReturnStatement') out.push(n); });
    return hide(fn, '__rets', out);
  }
  function returnsGrade(fn, fi, depth) {
    if (fn.async || fn.generator) return UNKG('async/generator');
    if (fn.body.type !== 'BlockStatement') return grade(fn.body, fi, depth);
    let g = BOTTOM();
    for (const n of returnsOf(fn)) g = join(g, n.argument ? grade(n.argument, fi, depth + 1) : NUMG());
    return g.bottom ? NUMG() : g;
  }
  function fnReturns(idNode, fi, depth) {
    const bs = bindingsOf(fi, idNode);
    if (!bs.length) return UNKG(idNode.name + ' (нет объявления)');
    let g = BOTTOM();
    for (const b of bs) { const fv = fnValueOf(b); if (!fv) return UNKG(idNode.name + ' (функция неизвестна)'); g = join(g, returnsGrade(fv.fn, fv.fi, depth + 1)); }
    return g;
  }
  function gradeCall(n, fi, depth) {
    const c = n.callee, args = n.arguments;
    const A0 = () => args[0] ? grade(args[0], fi, depth) : NUMG();
    // свои «доверенные» функции из списка (scripts/xss-allowlist.json → helpers)
    const nm = c.type === 'Identifier' ? c.name : (c.type === 'MemberExpression' ? snip(fi, c).replace(/\s+/g, '') : null);
    const h = nm && helperByName.get(nm);
    if (h && h.kind !== 'value') {
      if (c.type !== 'Identifier' || !lookup(fi, c) || h.any || (h.file && h.file === (bindingsOf(fi, c)[0] || {}).fi?.file)) return gradeOfName(h.grade);
    }
    if (c.type === 'Identifier') {
      const local = lookup(fi, c);
      if (!local && !(realmOf(fi) === 'cli' && globalsTable.has(c.name))) {
        if (c.name === 'String') return args.length ? A0() : NUMG();
        if (NUM_FUNCS.has(c.name)) return NUMG();
        if (c.name === 'encodeURIComponent' || c.name === 'encodeURI') return mk({ h: 1, qd: 1, qs: 0, u: 1 });
      }
    } else if (c.type === 'MemberExpression') {
      const prop = propName(c), obj = c.object;
      if (obj.type === 'Identifier' && !lookup(fi, obj) && !(realmOf(fi) === 'cli' && globalsTable.has(obj.name))) {
        if (obj.name === 'Math' || obj.name === 'Number' || obj.name === 'Intl') return NUMG();
        if (obj.name === 'JSON' && prop === 'stringify') { const a = A0(); const arr = args[0] ? elemOrValueGrade(args[0], fi, depth) : NUMG(); return a.x && arr.x ? NUMG() : UNKG('JSON.stringify'); }
        if (obj.name === 'URL' && prop === 'createObjectURL') return mk({ h: 1, qd: 1, qs: 1, u: 1 });
        if (obj.name === 'Date' && (prop === 'now' || prop === 'UTC' || prop === 'parse')) return NUMG();
        if (obj.name === 'Array' && prop === 'isArray') return NUMG();
        if (obj.name === 'Object' && (prop === 'keys' || prop === 'values' || prop === 'entries')) return UNKG('Object.' + prop);
        if (obj.name === 'String' && prop === 'fromCharCode') return UNKG('String.fromCharCode');
      }
      if (prop) {
        if (prop === 'toDataURL' && args.length <= 2) return mk({ h: 1, qd: 1, qs: 1, u: 1 });
        if (prop === 'join') return join(elemGrade(obj, fi, depth), args[0] ? grade(args[0], fi, depth) : NUMG());
        if (NUM_METHODS.has(prop) && !hasUserMethod(c, fi, depth, prop)) return NUMG();
        if (prop === 'toString' && obj.type === 'Identifier') { const bs = bindingsOf(fi, obj); if (bs.length && bs.every(b => fnValueOf(b))) return NUMG(); }
        if (prop === 'toString' || prop === 'valueOf') return grade(obj, fi, depth);
        if (prop === 'map' || prop === 'flatMap' || ARRAY_KEEP.has(prop)) { if (isArrayish(obj)) return elemGrade(n, fi, depth); }
        if (PASS_METHODS.has(prop) && !hasUserMethod(c, fi, depth, prop)) {
          let g = grade(obj, fi, depth);
          if (prop === 'replace' || prop === 'replaceAll') {
            if (isJsonCall(obj) && args[0] && args[0].type === 'Literal' && args[0].regex && args[0].regex.pattern === '<' && args[1] && args[1].type === 'Literal' && /^\\(u003c|x3c)$/i.test(String(args[1].value))) return mk({ s: 1 });
            const r = args[1]; if (r) g = join(g, isFn(r) ? returnsGrade(r, fi, depth) : grade(r, fi, depth));
          }
          else if (prop === 'padStart' || prop === 'padEnd') { if (args[1]) g = join(g, grade(args[1], fi, depth)); }
          else if (prop === 'concat') for (const a of args) g = join(g, grade(a, fi, depth));
          return g;
        }
        if (prop === 'split') return grade(obj, fi, depth);
      }
    }
    // функция известна (в этом файле, в глобальной таблице, в объекте-модуле) — смотрим, что она возвращает; экранировщик — особый случай
    const fns = calleeFns(n, fi, depth);
    if (fns && fns.length) {
      const flags = fns.map(t => escFlags(t.fi, t.fn));
      if (flags.every(Boolean)) { const a = A0(); const q = { qd: Math.min(...flags.map(f => f.qd)), qs: Math.min(...flags.map(f => f.qs)) }; return a.x ? { ...a, c: [] } : { h: 1, qd: q.qd, qs: q.qs, u: a.u, x: 0, js: args[0] && isJsonCall(args[0]) && q.qd && q.qs ? 1 : 0, a: 0, s: 0, c: a.c }; }
      return joinAll(fns.map(t => returnsGrade(t.fn, t.fi, depth + 1)));
    }
    if (h) return gradeOfName(h.grade);
    return unk(fi, n);
  }
  const isJsonCall = n => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'JSON' && propName(n.callee) === 'stringify';
  function elemOrValueGrade(n, fi, depth) { const g = grade(n, fi, depth); if (g.x) return g; const t = tableValuesGrade(n, fi, depth); return t || g; }
  function tableValuesGrade(n, fi, depth) { const o = constObject(n, fi); return o ? objValuesGrade(n, fi, depth) : null; }
  // у объекта есть СВОЙ метод с таким именем (тогда встроенные правила — по имени — не применяем)
  function hasUserMethod(c, fi, depth, prop) {
    const objs = objectsOf(c.object, fi, depth);
    return !!objs && objs.some(o => o.node.type === 'ObjectExpression' && o.node.properties.some(p => p.type === 'Property' && !p.computed && p.key.name === prop));
  }
  const isArrayish = n => n.type === 'ArrayExpression' || (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && ['map', 'filter', 'split', 'slice', 'concat', 'flat', 'flatMap', 'keys', 'values', 'entries', 'from', 'sort', 'reverse'].includes(propName(n.callee)));

  // ═══ Единицы разметки (шаблоны и цепочки «+») ═══
  function flattenUnit(n, out) {
    if (n.type === 'TemplateLiteral') { n.quasis.forEach((q, i) => { out.push({ s: q.value.cooked != null ? q.value.cooked : q.value.raw }); if (n.expressions[i]) out.push({ e: n.expressions[i] }); }); }
    else if (n.type === 'BinaryExpression' && n.operator === '+') { flattenUnit(n.left, out); flattenUnit(n.right, out); }
    else if (n.type === 'Literal' && typeof n.value === 'string') out.push({ s: n.value });
    else out.push({ e: n });
    return out;
  }
  const isPlus = n => n.type === 'BinaryExpression' && n.operator === '+';
  function unitRoot(n) {          // верхушка цепочки (родитель — не «+»)
    const p = n.parent;
    return !(p && isPlus(p) && (p.left === n || p.right === n));
  }
  const TAG_RE = /<[a-zA-Z\/!]/, ATTRFRAG_RE = /(^|\s)[\w:-]+\s*=\s*["']/;
  const isJoinArrayUnit = n => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed && n.callee.property.name === 'join' && n.callee.object.type === 'ArrayExpression'
    && n.arguments.length === 1 && n.arguments[0].type === 'Literal' && n.arguments[0].value === '';
  function unitPieces(n) {
    if (n.__pieces) return n.__pieces;
    let out;
    if (n.type === 'CallExpression') { out = []; for (const e of n.callee.object.elements) { if (!e) continue; if (e.type === 'SpreadElement') out.push({ e }); else flattenUnit(e, out); } }
    else out = flattenUnit(n, []);
    return hide(n, '__pieces', out);
  }
  function isMarkupUnit(n, fi) {
    if (n.__markup !== undefined) return n.__markup;
    let r = false;
    if (n.type === 'TemplateLiteral' || isPlus(n)) {
      let top = n; while (top.parent && isPlus(top.parent) && (top.parent.left === top || top.parent.right === top)) top = top.parent;
      if (top !== n) r = isMarkupUnit(top, fi);
      else { const text = unitPieces(n).filter(p => p.s != null).map(p => p.s).join(''); r = TAG_RE.test(text) ? 'tag' : ATTRFRAG_RE.test(text) ? 'attrs' : false; }
    } else if (isJoinArrayUnit(n)) r = TAG_RE.test(unitPieces(n).filter(p => p.s != null).map(p => p.s).join('')) ? 'tag' : false;
    return hide(n, '__markup', r);
  }
  // шаблон — это JS-код (скрипт страницы), в строках которого лежит разметка
  function isJsCode(n, fi){
    if (n.__js !== undefined) return n.__js;
    const text = unitPieces(n).filter(p => p.s != null).map(p => p.s).join('');
    const r = !/^\s*</.test(text) && /(^|[\s;{(])(function|var|let|const)\s|=>|document\.|\.addEventListener|window\./.test(text);
    return hide(n, '__js', r);
  }
  function unitGrade(n, fi) { const k = isMarkupUnit(n, fi); return k === 'attrs' ? ATTRSG() : isJsCode(n, fi) ? mk({ s: 1 }) : MARKUPG(); }

  // ═══ Машина разбора HTML (по статической части) ═══
  const RAWTEXT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes']), RCDATA = new Set(['title', 'textarea']);
  class Machine {
    constructor(start) { this.s = start || 'data'; this.tag = ''; this.attr = ''; this.val = ''; this.dyn = false; this.rawTag = ''; this.buf = ''; this.last = ''; }
    feed(str) { for (const ch of str) this.step(ch); }
    endTag() { if (RAWTEXT.has(this.tag)) { this.s = 'raw'; this.rawTag = this.tag; this.last = ''; } else if (RCDATA.has(this.tag)) { this.s = 'rcdata'; this.rawTag = this.tag; this.last = ''; } else this.s = 'data'; }
    step(c) {
      const ws = /\s/.test(c);
      switch (this.s) {
        case 'data': if (c === '<') this.s = 'tagopen'; break;
        case 'tagopen':
          if (/[a-zA-Z]/.test(c)) { this.s = 'tagname'; this.tag = c.toLowerCase(); }
          else if (c === '/') { this.s = 'endtag'; }
          else if (c === '!') { this.s = 'decl'; this.buf = ''; }
          else if (c === '?') this.s = 'bogus';
          else this.s = 'data';
          break;
        case 'tagname': if (ws || c === '/') this.s = 'bef_attr'; else if (c === '>') this.endTag(); else this.tag += c.toLowerCase(); break;
        case 'endtag': if (c === '>') this.s = 'data'; break;
        case 'bogus': if (c === '>') this.s = 'data'; break;
        case 'decl': this.buf += c; if (this.buf === '--') { this.s = 'comment'; this.last = ''; } else if (this.buf.length >= 2 || c === '>') this.s = c === '>' ? 'data' : 'bogus'; break;
        case 'comment': this.last = (this.last + c).slice(-3); if (this.last === '-->') this.s = 'data'; break;
        case 'bef_attr': if (ws || c === '/') break; if (c === '>') this.endTag(); else { this.s = 'attrname'; this.attr = c.toLowerCase(); } break;
        case 'attrname': if (c === '=') this.s = 'bef_val'; else if (ws) this.s = 'aft_attr'; else if (c === '/') this.s = 'bef_attr'; else if (c === '>') this.endTag(); else this.attr += c.toLowerCase(); break;
        case 'aft_attr': if (ws) break; if (c === '=') this.s = 'bef_val'; else if (c === '>') this.endTag(); else if (c === '/') this.s = 'bef_attr'; else { this.s = 'attrname'; this.attr = c.toLowerCase(); } break;
        case 'bef_val': if (ws) break; this.val = ''; this.dyn = false; if (c === '"') this.s = 'val_dq'; else if (c === "'") this.s = 'val_sq'; else if (c === '>') this.endTag(); else { this.s = 'val_unq'; this.val = c; } break;
        case 'val_dq': if (c === '"') this.s = 'bef_attr'; else if (!this.dyn) this.val += c; break;
        case 'val_sq': if (c === "'") this.s = 'bef_attr'; else if (!this.dyn) this.val += c; break;
        case 'val_unq': if (ws) this.s = 'bef_attr'; else if (c === '>') this.endTag(); else if (!this.dyn) this.val += c; break;
        case 'raw': case 'rcdata': this.last = (this.last + c.toLowerCase()).slice(-12); if (this.last.endsWith('</' + this.rawTag)) { this.s = 'endtag'; } break;
      }
    }
    ctx() {            // что за контекст у вставки именно сейчас
      const s = this.s;
      if (s === 'data') return { k: 'text' };
      if (s === 'comment') return { k: 'comment' };
      if (s === 'raw') return { k: 'raw', t: this.rawTag };
      if (s === 'rcdata') return { k: 'text', t: this.rawTag };
      if (s === 'val_dq' || s === 'val_sq' || s === 'val_unq') {
        const q = s === 'val_dq' ? 'd' : s === 'val_sq' ? 's' : 'u', a = this.attr, t = this.tag;
        const prefix = this.dyn ? null : this.val;
        if (a.startsWith('on') && a.length > 2) return { k: 'on', q, a, t };
        if (a === 'srcdoc') return { k: 'srcdoc', q, a, t };
        if (a === 'style') return { k: 'style', q, a, t };
        if (s === 'val_unq') return { k: 'unq', q, a, t };
        if ((URL_ATTRS[t] || []).includes(a)) return { k: /^\s*javascript:/i.test(prefix || '') ? 'on' : 'url', q, a, t, prefix };
        if (LOWURL_ATTRS.has(a)) return { k: 'urllow', q, a, t, prefix };
        return { k: 'attr', q, a, t };
      }
      if (s === 'bef_attr' || s === 'aft_attr') return { k: 'attrs', t: this.tag };
      if (s === 'attrname') return { k: 'attrname', t: this.tag };
      if (s === 'tagname') return { k: 'tagname' };
      if (s === 'bef_val') return { k: 'unq', q: 'u', a: this.attr, t: this.tag };
      return { k: 'weird' };
    }
    dynamic() {                 // вставили значение
      if (this.s === 'bef_val') { this.s = 'val_unq'; this.val = ''; }
      if (this.s === 'val_dq' || this.s === 'val_sq' || this.s === 'val_unq') this.dyn = true;
      else if (this.s === 'tagname') this.tag += '?';
      else if (this.s === 'attrname') this.attr += '?';
      else if (this.s === 'tagopen') { this.s = 'tagname'; this.tag = '?'; }
      else if (this.s === 'bef_attr' || this.s === 'aft_attr') { /* набор атрибутов */ }
    }
  }
  const SAFE_URL_PREFIX = /^(?:\s*(?:https?:\/\/|\/|#|\?|mailto:|tel:)|\s*[a-z0-9_.~-]+(?:\/|\?|#))/i;
  const BAD_SCHEME = /^\s*(javascript|data|vbscript):/i;
  function checkCtx(ctx, g) {      // → null (безопасно) или причина
    switch (ctx.k) {
      case 'text': return g.h ? null : 'text';
      case 'comment': return g.h ? null : 'comment';
      case 'attr': case 'urllow': return g[ctx.q === 'd' ? 'qd' : 'qs'] && g.h ? null : (g.x ? null : 'attr');
      case 'url': {
        if (!(g[ctx.q === 'd' ? 'qd' : 'qs'] && g.h) && !g.x) return 'attr';
        if (g.u || g.x) return null;
        if (ctx.prefix != null && SAFE_URL_PREFIX.test(ctx.prefix) && !BAD_SCHEME.test(ctx.prefix)) return null;
        return 'url';
      }
      case 'on': return g.js || g.x ? null : 'on';
      case 'style': return g.x ? null : 'style';
      case 'attrs': return g.a || g.x ? null : 'attrs';
      case 'raw': return g.x || g.s ? null : 'raw';
      default: return g.x ? null : ctx.k;
    }
  }

  // ═══ Сбор находок по файлу ═══
  function scanFile(fi, out) {
    const find = (kind, node, extra) => out.push({ file: fi.file, line: node.loc.start.line, fn: fnNameOf(fi, node), kind, s: node.start, e: node.end, ...extra });
    walk(fi.ast, node => {
      if ((node.type === 'TemplateLiteral' || isPlus(node) || isJoinArrayUnit(node)) && (node.type === 'CallExpression' || unitRoot(node))) {
        const mu = isMarkupUnit(node, fi);
        if (mu) {
          const js = isJsCode(node, fi);
          const m = new Machine(js ? 'raw' : mu === 'attrs' ? 'bef_attr' : 'data');
          if (js) m.rawTag = 'script';
          for (const p of unitPieces(node)) {
            if (p.s != null) { m.feed(p.s); continue; }
            const ctx = m.ctx();
            const g = grade(p.e, fi);
            const bad = checkCtx(ctx, g);
            if (bad) find('markup', p.e, { ctx: ctx.k, need: bad, x: snip(fi, p.e).slice(0, 90), why: g.c.slice(0, 3), tag: ctx.t || '', attr: ctx.a || '' });
            m.dynamic();
          }
        }
      }
      sinkCheck(node, fi, find);
    }, null);
  }
  function sinkCheck(n, fi, find) {
    const rhsSrc = r => snip(fi, r).slice(0, 80);
    const isMarkupish = r => (r.type === 'TemplateLiteral' || isPlus(r) || isJoinArrayUnit(r)) && !!isMarkupUnit(r, fi);
    const htmlSink = (kind, r) => {
      if (isMarkupish(r)) return;
      const g = grade(r, fi);
      if (!g.h) find('sink', r, { sink: kind, x: rhsSrc(r), why: g.c.slice(0, 3), need: 'h' });
    };
    const urlSink = (kind, r, target) => {
      if (!r || r.type === 'ArrowFunctionExpression' || r.type === 'FunctionExpression') return;   // PL.src = s => … — это функция, а не адрес
      const g = grade(r, fi);
      if (g.u || g.x) return;
      const ps = (r.type === 'TemplateLiteral' || isPlus(r)) ? flattenUnit(r, []) : null;
      if (ps && ps.length && ps[0].s != null && SAFE_URL_PREFIX.test(ps[0].s) && !BAD_SCHEME.test(ps[0].s)) return;
      const tx = target ? src(fi, target).replace(/\s+/g, ' ').slice(0, 40) : '';
      const low = (kind === 'src' || kind === 'setAttribute(src)' || kind === 'data') && !/frame|script|embed|object|worker|win|popup/i.test(tx);
      find('sink', r, { sink: kind + ' [' + tx + ']', x: rhsSrc(r), why: g.c.slice(0, 3), need: 'u', low: low ? 1 : 0 });
    };
    const codeSink = (kind, r) => find('sink', r, { sink: kind, x: rhsSrc(r), why: [], need: 'x' });
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression') {
      const nm = propName(n.left);
      if ((nm === 'innerHTML' || nm === 'outerHTML') && (n.operator === '=' || n.operator === '+=')) htmlSink(nm, n.right);
      else if (nm === 'srcdoc') codeSink('srcdoc', n.right);
      else if ((nm === 'text' || nm === 'textContent' || nm === 'innerText') && /script/i.test(src(fi, n.left.object))) codeSink('script.' + nm, n.right);
      else if (nm === 'href' || nm === 'action' || nm === 'formAction' || nm === 'src') urlSink(nm, n.right, n.left.object);
      else if (nm && /^on[a-z]+$/.test(nm) && (n.right.type === 'TemplateLiteral' || isPlus(n.right))) codeSink(nm + '=строка', n.right);
    }
    if (n.type === 'AssignmentExpression' && n.left.type === 'Identifier' && n.left.name === 'location' && !lookup(fi, n.left)) urlSink('location', n.right, n.left);
    if (n.type === 'Property' && !n.computed && n.parent && n.parent.type === 'ObjectExpression') {
      const key = n.key.name || n.key.value;
      if (key === 'innerHTML' || key === 'outerHTML') htmlSink('{' + key + '}', n.value);
      else if (key === 'srcdoc') codeSink('{srcdoc}', n.value);
    }
    if (n.type === 'CallExpression') {
      const c = n.callee, nm = propName(c);
      if (c.type === 'MemberExpression' && nm) {
        if (nm === 'insertAdjacentHTML') { if (n.arguments[1]) htmlSink('insertAdjacentHTML', n.arguments[1]); }
        else if ((nm === 'write' || nm === 'writeln') && /document/.test(src(fi, c.object))) { if (n.arguments[0]) htmlSink('document.' + nm, n.arguments[0]); }
        else if (nm === 'createContextualFragment') { if (n.arguments[0]) htmlSink('createContextualFragment', n.arguments[0]); }
        else if (nm === 'parseFromString') { if (n.arguments[0] && n.arguments[1] && /html/.test(src(fi, n.arguments[1]))) htmlSink('parseFromString', n.arguments[0]); }
        else if (nm === 'setHTMLUnsafe') { if (n.arguments[0]) htmlSink('setHTMLUnsafe', n.arguments[0]); }
        else if (nm === 'setAttribute' && n.arguments[0] && n.arguments[0].type === 'Literal') {
          const a = String(n.arguments[0].value).toLowerCase(), v = n.arguments[1];
          if (v) {
            if (a.startsWith('on')) codeSink('setAttribute(' + a + ')', v);
            else if (a === 'srcdoc') codeSink('setAttribute(srcdoc)', v);
            else if (['href', 'src', 'action', 'formaction', 'data', 'xlink:href'].includes(a)) urlSink('setAttribute(' + a + ')', v, c.object);
          }
        }
        else if ((nm === 'assign' || nm === 'replace') && /^((window|self|top|parent)\.)?(document\.)?location$/.test(src(fi, c.object).replace(/\s+/g, ''))) { if (n.arguments[0]) urlSink('location.' + nm, n.arguments[0], c.object); }
        else if (nm === 'open' && /^(window|self|top|parent)$/.test(src(fi, c.object))) { if (n.arguments[0]) urlSink('window.open', n.arguments[0], c.object); }
      }
      if (c.type === 'Identifier' && !lookup(fi, c)) {
        if (c.name === 'eval' || c.name === 'Function') codeSink(c.name + '()', n);
        else if ((c.name === 'setTimeout' || c.name === 'setInterval') && n.arguments[0] && ['Literal', 'TemplateLiteral', 'BinaryExpression'].includes(n.arguments[0].type)) codeSink(c.name + '(строка)', n);
        else if (c.name === 'open' && n.arguments[0]) urlSink('open', n.arguments[0], c);
        else if (c.name === 'importScripts') for (const a of n.arguments) urlSink('importScripts', a, c);
      }
    }
    if (n.type === 'NewExpression' && n.callee.type === 'Identifier' && !lookup(fi, n.callee)) {
      if (n.callee.name === 'Function') codeSink('new Function', n);
      if ((n.callee.name === 'Worker' || n.callee.name === 'SharedWorker') && n.arguments[0]) urlSink('new ' + n.callee.name, n.arguments[0], n.callee);
    }
    if (n.type === 'ImportExpression') urlSink('import()', n.source, n);
  }

  return { files, addFile, scanFile, grade, snip, globalsTable, dbg: { objectsOf, elemObjects, bindingsOf, lookup, fnsOfCallee, nsObjects, callSitesOf } };
}

// ═══ Список файлов ═══
function listFiles(root, rels) {
  const out = [];
  const skip = new Set(['node_modules', '.git', '.claude', 'dist', 'vendor']);
  function rec(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const rel = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) rec(rel); else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(rel);
    }
  }
  for (const r of rels) { const st = fs.statSync(path.join(root, r)); if (st.isDirectory()) rec(r); else out.push(r); }
  return out;
}
const SCAN_DIRS = ['js', 'api', 'studio', 'sw.js', 'config.js'];

const normX = s => String(s).replace(/\s+/g, ' ').trim();
const kindKey = f => f.kind === 'sink' ? 'sink:' + f.sink : 'markup:' + f.ctx;
const keyOf = f => [f.file, f.fn, kindKey(f), normX(f.x)].join('\u0001');

function scan(root, opts = {}) {
  const A = createAnalyzer(opts);
  const rels = opts.files || listFiles(root, SCAN_DIRS.filter(d => fs.existsSync(path.join(root, d))));
  const errors = [];
  for (const rel of rels) {
    let text; try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { errors.push({ file: rel, error: String(e) }); continue; }
    try { A.addFile(rel.replace(/\\/g, '/'), text); } catch (e) { errors.push({ file: rel, error: String(e.message || e) }); }
  }
  const findings = [];
  for (const fi of A.files.values()) A.scanFile(fi, findings);
  return { findings, errors, files: A.files.size, analyzer: A };
}

// Разбор файлов из памяти (для проверок самого разбора): { 'js/core/utils.js': текст, 'js/x.js': текст } → { findings, errors }
function scanTexts(files, opts = {}) {
  const A = createAnalyzer(opts), errors = [];
  for (const [rel, text] of Object.entries(files)) { try { A.addFile(rel, text); } catch (e) { errors.push({ file: rel, error: String(e.message || e) }); } }
  const findings = [];
  for (const fi of A.files.values()) A.scanFile(fi, findings);
  return { findings, errors };
}

// ═══ Список проверенных находок (scripts/xss-allowlist.json) ═══
// { version, about, claims: { код: пояснение }, helpers: [], groups: [{ f: файл, fn: функция, k: вид, c: код причины, n?: заметка, xs: [выражения] }] }
// Ключ находки — файл + функция + вид + выражение (пробелы схлопнуты): правка кода рядом ничего не ломает, новое выражение — новая находка.
function loadAllowlist(file) {
  const empty = { version: 1, claims: {}, helpers: [], groups: [] };
  let al = empty, error = null;
  try { al = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') error = String(e.message || e); }
  const map = new Map(), bad = [];
  for (const g of al.groups || []) {
    if (!g.c || !(al.claims || {})[g.c]) bad.push(`группа ${g.f} / ${g.fn} / ${g.k}: нет причины «${g.c}» в claims`);
    for (const x of g.xs || []) map.set([g.f, g.fn, g.k, normX(x)].join('\u0001'), g);
  }
  return { al, map, error, bad };
}
function applyAllowlist(findings, map) {
  const open = [], allowed = [], used = new Set();
  for (const f of findings) { const k = keyOf(f); if (map.has(k)) { used.add(k); allowed.push(f); } else open.push(f); }
  const stale = [...map.keys()].filter(k => !used.has(k));
  return { open, allowed, stale };
}

module.exports = { scan, scanTexts, keyOf, kindKey, normX, hasAcorn, respawnIfNeeded, listFiles, SCAN_DIRS, loadAllowlist, applyAllowlist };

// ═══ CLI ═══
// node scripts/xss-scan.cjs [--all] [--json] [--files a.js,b.js] — что нашёл разбор и чего ещё нет в xss-allowlist.json
//   --add <причина> ["заметка"]  — занести ВСЕ открытые находки в список с этой причиной (из claims) — только после того, как каждую прочитал
//   --prune                      — убрать из списка устаревшие записи (кода с таким выражением уже нет)
if (require.main === module) {
  respawnIfNeeded();
  const root = path.join(__dirname, '..');
  const args = process.argv.slice(2);
  const fIdx = args.indexOf('--files');
  const files = fIdx >= 0 ? args[fIdx + 1].split(',') : null;
  const alFile = path.join(__dirname, 'xss-allowlist.json');
  const L = loadAllowlist(alFile);
  const r = scan(root, { files, config: L.al });
  const writeAL = al => {
    al.groups.sort((a, b) => (a.f < b.f ? -1 : a.f > b.f ? 1 : a.fn < b.fn ? -1 : a.fn > b.fn ? 1 : a.k < b.k ? -1 : a.k > b.k ? 1 : a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
    fs.writeFileSync(alFile, JSON.stringify(al, null, 1));
  };
  if (args.includes('--prune')) {
    if (files) { console.error('--prune — только по всему дереву (без --files)'); process.exit(2); }
    const have = new Set(r.findings.map(keyOf)); let n = 0;
    for (const g of L.al.groups) { const before = g.xs.length; g.xs = g.xs.filter(x => have.has([g.f, g.fn, g.k, normX(x)].join('\u0001'))); n += before - g.xs.length; }
    L.al.groups = L.al.groups.filter(g => g.xs.length);
    writeAL(L.al);
    console.log(`убрано устаревших записей: ${n}; групп осталось ${L.al.groups.length}`);
    process.exit(0);
  }
  if (args.includes('--add')) {
    const i = args.indexOf('--add'), claim = args[i + 1], note = args[i + 2] && !args[i + 2].startsWith('--') ? args[i + 2] : undefined;
    if (!claim || !L.al.claims || !L.al.claims[claim]) { console.error('--add <причина> ["заметка"]: причина должна быть из claims:\n  ' + Object.keys(L.al.claims || {}).join(', ')); process.exit(2); }
    const open = applyAllowlist(r.findings, L.map).open;
    for (const f of open) {
      let g = L.al.groups.find(x => x.f === f.file && x.fn === f.fn && x.k === kindKey(f) && x.c === claim && x.n === note);
      if (!g) { g = { f: f.file, fn: f.fn, k: kindKey(f), c: claim, ...(note ? { n: note } : {}), xs: [] }; L.al.groups.push(g); }
      if (!g.xs.includes(normX(f.x))) g.xs.push(normX(f.x));
      console.log(`  + ${f.file}:${f.line} [${f.fn}] ${kindKey(f)}: ${f.x}`);
    }
    writeAL(L.al);
    console.log(`занесено: ${open.length} (причина «${claim}»)`);
    process.exit(0);
  }
  let list = r.findings;
  if (!args.includes('--all')) list = applyAllowlist(list, L.map).open;
  if (args.includes('--json')) console.log(JSON.stringify(list, null, 1));
  else {
    for (const e of r.errors) console.log('ОШИБКА РАЗБОРА', e.file, e.error);
    const byFile = new Map();
    for (const f of list) { if (!byFile.has(f.file)) byFile.set(f.file, []); byFile.get(f.file).push(f); }
    for (const [file, arr] of byFile) {
      console.log('\n# ' + file + ' (' + arr.length + ')');
      for (const f of arr) console.log(`  ${f.line} [${f.fn}] ${f.kind === 'sink' ? 'SINK ' + f.sink : f.ctx + (f.attr ? ':' + f.attr : '')}: ${f.x}${f.why && f.why.length ? '   <- ' + f.why.join(' | ') : ''}`);
    }
    console.log(`\nфайлов ${r.files}, находок ${list.length} (всего ${r.findings.length})`);
  }
}

// ═══════════════════════════════════════
//  ДВИЖОК ДЕНЧИКА — язык скриптов Lua (как Luau в Roblox) для «Студии 3D»
// ═══════════════════════════════════════
// Свой Lua 5.1 + синтаксис Luau (+= и т. п., continue, типы, `строки {x}`, if-выражения, //, 0b…, 1_000) целиком на JS:
// лексер → разбор → перевод в JS, где каждая функция Lua — функция-генератор (function*): так wait()/task.wait()/
// coroutine.yield останавливают выполнение сквозь любые вложенные вызовы. Всё внутри worker() — функция уходит
// в песочницу текстом (D37E.lang → script.js) и регистрирует globalThis.D37Lang.lua = { run(code, env, ctx) }.
// Строки — строки JS (UTF-16): #"привет" = 6, string.byte("п") = 1087, шаблоны %a и т. п. — только латиница.
// Числа — double, печать как в Lua (%.14g): 3 → "3", 1e15 → "1e+15". Ошибки — по-русски, с номером строки Lua.
// Объекты мира — объекты JS из script.js: obj.X — свойство, obj:Метод(a) — obj.Метод(a), массивы JS ↔ таблицы Lua
// с 1, функции Lua, отданные миру (:Connect, task.spawn), запускаются в новой сопрограмме (в них можно wait()).
(() => {
  const E = window.D37E = window.D37E || {};

  function worker(){
    'use strict';
    // ═══ Лексер ═══
    const KW = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
    const OPS3 = new Set(['...', '..=', '//=']);
    const OPS2 = new Set(['..', '//', '==', '~=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '::', '->']);
    const OPS1 = new Set(['+', '-', '*', '/', '%', '^', '#', '<', '>', '=', '(', ')', '{', '}', '[', ']', ';', ':', ',', '.', '?', '|', '&']);
    const HINT = { '!=': ' — «не равно» в Lua пишется ~=', '&&': ' — в Lua пишется and', '||': ' — в Lua пишется or', '!': ' — в Lua пишется not', '++': ' — в Lua пишется x += 1' };
    class LuaSyntax { constructor(msg, line){ this.msg = msg; this.line = line; } }
    const tokName = t => t.t === 'eof' ? 'конец кода' : t.t === 'str' ? 'строка' : t.t === 'num' ? 'число ' + t.v : t.t === 'name' ? "'" + t.v + "'" : t.t === 'ibeg' || t.t === 'imid' || t.t === 'iend' ? 'строка `…`' : '"' + t.v + '"';
    const isLetter = c => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || (c > 127 && c < 0xd800 && /\p{L}/u.test(String.fromCharCode(c)));
    const isDigit = c => c >= 48 && c <= 57;

    function lex(src){
      const out = [], n = src.length, braces = [];
      let i = 0, line = 1;
      const fail = (m, l) => { throw new LuaSyntax(m, l || line); };
      const at = k => src.charCodeAt(k);
      if (src.startsWith('#!')) while (i < n && at(i) !== 10) i++;
      function longLevel(){ let j = i + 1, lv = 0; while (at(j) === 61) { lv++; j++; } return at(j) === 91 ? lv : -1; }
      function readLong(lv, what){
        const l0 = line;
        i += lv + 2;
        if (at(i) === 13) { i++; if (at(i) === 10) i++; line++; } else if (at(i) === 10) { i++; if (at(i) === 13) i++; line++; }
        const close = ']' + '='.repeat(lv) + ']', e = src.indexOf(close, i);
        if (e < 0) fail('не закрыт' + (what === 'c' ? ' длинный комментарий --[[' : 'а длинная строка [[') + ' (начало на строке ' + l0 + ')', l0);
        const s = src.slice(i, e);
        for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) line++;
        i = e + close.length;
        return s.indexOf('\r') >= 0 ? s.replace(/\r\n?/g, '\n') : s;
      }
      function escape(){   // i — на символе после «\»
        const c = src[i];
        switch (c) {
          case 'n': i++; return '\n';
          case 't': i++; return '\t';
          case 'r': i++; return '\r';
          case 'a': i++; return String.fromCharCode(7);
          case 'b': i++; return String.fromCharCode(8);
          case 'f': i++; return String.fromCharCode(12);
          case 'v': i++; return String.fromCharCode(11);
          case '\\': case '"': case "'": case '`': case '{': case '}': i++; return c;
          case '\n': i++; if (at(i) === 13) i++; line++; return '\n';
          case '\r': i++; if (at(i) === 10) i++; line++; return '\n';
          case 'x': { const h = src.slice(i + 1, i + 3); if (!/^[0-9a-fA-F]{2}$/.test(h)) fail('неправильная последовательность \\x — нужно две шестнадцатеричные цифры, например \\x41'); i += 3; return String.fromCharCode(parseInt(h, 16)); }
          case 'z': { i++; while (i < n && /\s/.test(src[i])) { if (at(i) === 10) line++; i++; } return ''; }
          case 'u': {
            if (src[i + 1] !== '{') fail('неправильная последовательность \\u — пиши \\u{41}');
            const e = src.indexOf('}', i), h = e < 0 ? '' : src.slice(i + 2, e);
            if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) fail('неправильная последовательность \\u{…}');
            i = e + 1; return String.fromCodePoint(parseInt(h, 16));
          }
          default: {
            if (c !== undefined && isDigit(at(i))) {
              let j = i; while (j < i + 3 && isDigit(at(j))) j++;
              const v = +src.slice(i, j); if (v > 255) fail('слишком большой код символа \\' + v);
              i = j; return String.fromCharCode(v);
            }
            fail(c === undefined ? 'незакрытая строка' : "неправильная последовательность '\\" + c + "' в строке (обратная косая черта пишется \\\\)");
          }
        }
      }
      function readStr(q){
        const l0 = line; i++;
        let s = '', st = i;
        for (;;) {
          if (i >= n) fail('незакрытая строка (кавычка со строки ' + l0 + ')', l0);
          const c = at(i);
          if (c === q) { s += src.slice(st, i); i++; return s; }
          if (c === 10 || c === 13) fail('незакрытая строка — перенос внутри кавычек (для нескольких строк пиши [[ … ]])', l0);
          if (c === 92) { s += src.slice(st, i); i++; s += escape(); st = i; continue; }
          i++;
        }
      }
      function readSeg(l0){   // кусок строки `…` до «{» или «`»
        let s = '', st = i;
        for (;;) {
          if (i >= n) fail('незакрытая строка `…` (начало на строке ' + l0 + ')', l0);
          const c = at(i);
          if (c === 96) { s += src.slice(st, i); i++; return { s, end: 96 }; }
          if (c === 123) { s += src.slice(st, i); i++; if (at(i) === 123) fail('в строке `…` нельзя {{ — чтобы написать фигурную скобку, пиши \\{'); return { s, end: 123 }; }
          if (c === 10 || c === 13) fail('незакрытая строка `…` — перенос внутри', l0);
          if (c === 92) { s += src.slice(st, i); i++; s += escape(); st = i; continue; }
          i++;
        }
      }
      function readNum(){
        const l0 = line, st = i;
        let v;
        const c1 = src[i + 1];
        if (at(i) === 48 && (c1 === 'x' || c1 === 'X' || c1 === 'b' || c1 === 'B')) {
          const hex = c1 === 'x' || c1 === 'X', re = hex ? /[0-9a-fA-F_]/ : /[01_]/;
          let j = i + 2; while (j < n && re.test(src[j])) j++;
          const d = src.slice(i + 2, j).replace(/_/g, '');
          if (!d) fail('неправильное число ' + src.slice(st, j + 1));
          v = parseInt(d, hex ? 16 : 2); i = j;
        } else {
          let j = i;
          while (j < n && (isDigit(at(j)) || at(j) === 95)) j++;
          if (at(j) === 46 && at(j + 1) !== 46) { j++; while (j < n && (isDigit(at(j)) || at(j) === 95)) j++; }
          if (at(j) === 101 || at(j) === 69) {
            let k = j + 1; if (at(k) === 43 || at(k) === 45) k++;
            if (!isDigit(at(k))) fail('неправильное число ' + src.slice(st, k + 1));
            j = k; while (j < n && (isDigit(at(j)) || at(j) === 95)) j++;
          }
          v = Number(src.slice(i, j).replace(/_/g, '')); i = j;
          if (v !== v) fail('неправильное число ' + src.slice(st, j));
        }
        if (i < n && (isLetter(at(i)) || isDigit(at(i)))) fail('неправильное число ' + src.slice(st, i + 1));
        out.push({ t: 'num', v, line: l0 });
      }
      for (;;) {
        // пробелы и комментарии
        while (i < n) {
          const c = at(i);
          if (c === 10) { line++; i++; }
          else if (c === 32 || c === 9 || c === 13 || c === 11 || c === 12 || c === 0xfeff) i++;
          else if (c === 45 && at(i + 1) === 45) {
            i += 2;
            if (at(i) === 91) { const lv = longLevel(); if (lv >= 0) { readLong(lv, 'c'); continue; } }
            while (i < n && at(i) !== 10) i++;
          } else break;
        }
        if (i >= n) { out.push({ t: 'eof', v: '<eof>', line }); break; }
        const c = at(i), l0 = line;
        if (isLetter(c)) {
          let j = i + 1; while (j < n && (isLetter(at(j)) || isDigit(at(j)))) j++;
          const w = src.slice(i, j); i = j;
          out.push({ t: KW.has(w) ? 'kw' : 'name', v: w, line: l0 });
          continue;
        }
        if (isDigit(c) || (c === 46 && isDigit(at(i + 1)))) { readNum(); continue; }
        if (c === 34 || c === 39) { out.push({ t: 'str', v: readStr(c), line: l0 }); continue; }
        if (c === 91) { const lv = longLevel(); if (lv >= 0) { out.push({ t: 'str', v: readLong(lv, 's'), line: l0 }); continue; } }
        if (c === 96) {   // `строка {выражение}`
          i++;
          const sg = readSeg(l0);
          if (sg.end === 96) out.push({ t: 'str', v: sg.s, line: l0 });
          else { out.push({ t: 'ibeg', v: sg.s, line: l0 }); braces.push(0); }
          continue;
        }
        if (c === 125 && braces.length && braces[braces.length - 1] === 0) {   // «}» закрывает {выражение} в `…`
          i++;
          const sg = readSeg(l0);
          if (sg.end === 96) { out.push({ t: 'iend', v: sg.s, line: l0 }); braces.pop(); }
          else out.push({ t: 'imid', v: sg.s, line: l0 });
          continue;
        }
        const s3 = src.substr(i, 3), s2 = src.substr(i, 2), s1 = src[i];
        if (s2 === '&&' || s2 === '||' || s2 === '++') fail("неожиданное '" + s2 + "'" + HINT[s2]);
        let op = null;
        if (OPS3.has(s3)) op = s3; else if (OPS2.has(s2)) op = s2; else if (OPS1.has(s1)) op = s1;
        if (!op) {
          const h = HINT[s2] || HINT[s1];
          fail("неожиданный символ '" + (HINT[s2] ? s2 : s1) + "'" + (h || ''));
        }
        if (op === '{' && braces.length) braces[braces.length - 1]++;
        else if (op === '}' && braces.length) braces[braces.length - 1]--;
        i += op.length;
        out.push({ t: 'op', v: op, line: l0 });
      }
      return out;
    }

    // ═══ Разбор → дерево ═══
    // Узлы-выражения: nil true false num str vararg func local global index call mcall paren bin un table ifexp interp.
    // Локальные переменные получают уникальные имена JS (L12_имя) — так тени и замыкания в циклах работают как в Lua.
    const BIN = { or: [1, 1], and: [2, 2], '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3], '..': [5, 4], '+': [6, 6], '-': [6, 6], '*': [7, 7], '/': [7, 7], '//': [7, 7], '%': [7, 7], '^': [10, 9] };
    const COMPOUND = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=']);
    const CONT_NOT = new Set(['=', '(', '.', '[', ':', ',', '{', '+=', '-=', '*=', '/=', '//=', '%=', '^=', '..=']);
    function parse(toks){
      let p = 0, tok = toks[0], fs = null, uid = 0;
      const next = () => { const t = tok; if (p < toks.length - 1) p++; tok = toks[p]; return t; };
      const peek = () => toks[Math.min(p + 1, toks.length - 1)];
      const isOp = v => tok.t === 'op' && tok.v === v;
      const isKw = v => tok.t === 'kw' && tok.v === v;
      const fail = (m, l) => { throw new LuaSyntax(m, l || tok.line); };
      const expectOp = (v, why) => { if (!isOp(v)) fail('ожидалось "' + v + '"' + (why || '') + ', а найдено ' + tokName(tok)); return next(); };
      const expectKw = (v, open, l0) => { if (!isKw(v)) fail('ожидалось "' + v + '"' + (open ? ' (чтобы закрыть "' + open + '" со строки ' + l0 + ')' : '') + ', а найдено ' + tokName(tok)); return next(); };
      const name = () => { if (tok.t !== 'name') fail('ожидалось имя, а найдено ' + tokName(tok)); return next().v; };
      const openScope = () => { fs.blocks.push(new Map()); };
      const closeScope = () => { fs.blocks.pop(); };
      const declare = nm => { const s = { name: nm, js: 'L' + (++uid) + '_' + nm.replace(/[^A-Za-z0-9_]/g, '') }; fs.blocks[fs.blocks.length - 1].set(nm, s); return s; };
      const resolve = nm => { for (let f = fs; f; f = f.parent) for (let b = f.blocks.length - 1; b >= 0; b--) { const s = f.blocks[b].get(nm); if (s) return s; } return null; };
      const ref = (nm, line) => { const s = resolve(nm); return s ? { k: 'local', sym: s, line } : { k: 'global', name: nm, line }; };
      const blockEnd = () => tok.t === 'eof' || (tok.t === 'kw' && (tok.v === 'end' || tok.v === 'else' || tok.v === 'elseif' || tok.v === 'until'));
      // ── типы Luau: разбираем и пропускаем ──
      function skipBal(open, close){
        expectOp(open);
        let d = 1;
        while (d > 0) {
          if (tok.t === 'eof') fail('ожидалось "' + close + '"');
          if (tok.t === 'op') { if (tok.v === open) d++; else if (tok.v === close) d--; }
          next();
        }
      }
      function typeAtom(){
        if (isOp('|') || isOp('&')) next();
        if (tok.t === 'name') {
          if (tok.v === 'typeof' && peek().t === 'op' && peek().v === '(') { next(); skipBal('(', ')'); }
          else { next(); while (isOp('.')) { next(); name(); } if (isOp('<')) skipBal('<', '>'); }
          if (isOp('...')) next();
        } else if (tok.t === 'kw' && (tok.v === 'nil' || tok.v === 'true' || tok.v === 'false')) next();
        else if (tok.t === 'str') next();
        else if (isOp('{')) skipBal('{', '}');
        else if (isOp('(')) { skipBal('(', ')'); if (isOp('->')) { next(); skipType(); } }
        else if (isOp('<')) { skipBal('<', '>'); skipBal('(', ')'); expectOp('->'); skipType(); }
        else if (isOp('...')) { next(); typeAtom(); }
        else fail('ожидался тип, а найдено ' + tokName(tok));
        while (isOp('?')) next();
      }
      function skipType(){ typeAtom(); while (isOp('|') || isOp('&')) { next(); typeAtom(); } }
      function typeAnn(){ if (isOp(':')) { next(); skipType(); } }
      function typeAlias(){
        if (tok.v === 'export') next();
        next(); name();
        if (isOp('<')) skipBal('<', '>');
        expectOp('=', ' в объявлении type'); skipType();
      }
      // ── блоки и операторы ──
      function block(){
        const out = [];
        while (!blockEnd()) {
          if (isKw('return')) {
            const line = next().line;
            const exprs = blockEnd() || isOp(';') ? [] : exprlist();
            if (isOp(';')) next();
            if (!blockEnd()) fail('после return ожидалось "end" (return — последний в блоке), а найдено ' + tokName(tok));
            out.push({ k: 'return', exprs, line });
            break;
          }
          const s = statement(); if (s) out.push(s);
        }
        return out;
      }
      function scoped(){ openScope(); const b = block(); closeScope(); return b; }
      function loopBody(kind){ const loop = { kind, cont: false, label: null }; fs.loops.push(loop); openScope(); const body = block(); closeScope(); fs.loops.pop(); return { body, loop }; }
      function statement(){
        const line = tok.line;
        if (isOp(';')) { next(); return null; }
        if (tok.t === 'kw') switch (tok.v) {
          case 'if': {
            next();
            const clauses = [];
            let c = expr(); expectKw('then'); clauses.push({ c, b: scoped(), line });
            let els = null;
            for (;;) {
              if (isKw('elseif')) { const l2 = next().line; c = expr(); expectKw('then'); clauses.push({ c, b: scoped(), line: l2 }); continue; }
              if (isKw('else')) { next(); els = scoped(); }
              break;
            }
            expectKw('end', 'if', line);
            return { k: 'if', clauses, els, line };
          }
          case 'while': {
            next(); const cond = expr(); expectKw('do');
            const { body, loop } = loopBody('while'); expectKw('end', 'while', line);
            return { k: 'while', cond, body, loop, line };
          }
          case 'do': { next(); const body = scoped(); expectKw('end', 'do', line); return { k: 'do', body, line }; }
          case 'for': return forStat(line);
          case 'repeat': {
            next();
            const loop = { kind: 'repeat', cont: false, label: null };
            fs.loops.push(loop); openScope();
            const body = block();
            const cl = tok.line;
            expectKw('until', 'repeat', line);
            fs.loops.pop();
            const cond = expr(); closeScope();   // until видит локальные тела цикла
            return { k: 'repeat', body, cond, loop, line, cl };
          }
          case 'function': {
            next();
            const n1 = name();
            let target = ref(n1, line), fname = n1, method = false;
            while (isOp('.')) { next(); const k = name(); target = { k: 'index', obj: target, key: { k: 'str', v: k }, line }; fname += '.' + k; }
            if (isOp(':')) { next(); const k = name(); target = { k: 'index', obj: target, key: { k: 'str', v: k }, line }; fname += ':' + k; method = true; }
            return { k: 'assign', targets: [target], exprs: [funcBody(line, method, fname)], line };
          }
          case 'local': {
            next();
            if (isKw('function')) { next(); const nm = name(); const sym = declare(nm); return { k: 'local', syms: [sym], exprs: [funcBody(line, false, nm)], line }; }
            const names = [];
            do { names.push(name()); typeAnn(); } while (isOp(',') && next());
            const exprs = isOp('=') ? (next(), exprlist()) : [];
            return { k: 'local', syms: names.map(declare), exprs, line };
          }
          case 'break': next(); if (!fs.loops.length) fail('break вне цикла', line); return { k: 'break', line };
        }
        if (tok.t === 'name') {
          const nx = peek();
          if (tok.v === 'continue' && nx.t !== 'str' && !(nx.t === 'op' && CONT_NOT.has(nx.v))) {
            next();
            const L = fs.loops[fs.loops.length - 1];
            if (!L) fail('continue вне цикла', line);
            L.cont = true;
            return { k: 'continue', loop: L, line };
          }
          if ((tok.v === 'type' && nx.t === 'name') || (tok.v === 'export' && nx.t === 'name' && nx.v === 'type')) { typeAlias(); return null; }
        }
        const e = suffixed();
        if (isOp('=') || isOp(',')) {
          const targets = [e];
          while (isOp(',')) { next(); targets.push(suffixed()); }
          expectOp('=');
          const exprs = exprlist();
          for (const t of targets) if (t.k !== 'local' && t.k !== 'global' && t.k !== 'index') fail('слева от "=" должна быть переменная или поле', line);
          return { k: 'assign', targets, exprs, line };
        }
        if (tok.t === 'op' && COMPOUND.has(tok.v)) {
          const op = next().v.slice(0, -1);
          if (e.k !== 'local' && e.k !== 'global' && e.k !== 'index') fail('слева от "' + op + '=" должна быть переменная или поле', line);
          return { k: 'compound', op, target: e, expr: expr(), line };
        }
        if (e.k !== 'call' && e.k !== 'mcall') fail('ожидался вызов функции или присваивание "=", а найдено ' + tokName(tok), line);
        return { k: 'callstat', call: e, line };
      }
      function forStat(line){
        next();
        const n1 = name(); typeAnn();
        if (isOp('=')) {
          next();
          const start = expr(); expectOp(',', ' в цикле for (for i = 1, 10 do)'); const limit = expr();
          let step = null; if (isOp(',')) { next(); step = expr(); }
          expectKw('do');
          openScope(); const sym = declare(n1); const { body, loop } = loopBody('for'); closeScope();
          expectKw('end', 'for', line);
          return { k: 'fornum', sym, start, limit, step, body, loop, line };
        }
        const names = [n1];
        while (isOp(',')) { next(); names.push(name()); typeAnn(); }
        if (!isKw('in')) fail('ожидалось "=" или "in" в цикле for, а найдено ' + tokName(tok));
        next();
        const exprs = exprlist(); expectKw('do');
        openScope(); const syms = names.map(declare); const { body, loop } = loopBody('for'); closeScope();
        expectKw('end', 'for', line);
        return { k: 'forin', syms, exprs, body, loop, line };
      }
      function funcBody(line, method, fname){
        if (isOp('<')) skipBal('<', '>');
        expectOp('(', ' — список параметров функции');
        const nf = { parent: fs, blocks: [new Map()], vararg: false, loops: [] };
        fs = nf;
        const params = [];
        if (method) params.push(declare('self'));
        if (!isOp(')')) {
          do {
            if (isOp('...')) { next(); nf.vararg = true; if (isOp(':')) { next(); skipType(); } break; }
            params.push(declare(name())); typeAnn();
          } while (isOp(',') && next());
        }
        expectOp(')', ' — закрыть список параметров');
        if (isOp(':')) { next(); skipType(); }
        const body = block();
        expectKw('end', 'function', line);
        fs = nf.parent;
        return { k: 'func', params, vararg: nf.vararg, body, line, name: fname };
      }
      // ── выражения ──
      function exprlist(){ const l = [expr()]; while (isOp(',')) { next(); l.push(expr()); } return l; }
      function expr(limit){
        let left;
        const line = tok.line;
        if (isKw('not') || isOp('-') || isOp('#')) {
          const op = next().v, a = expr(8);
          left = op === '-' && a.k === 'num' ? { k: 'num', v: -a.v } : { k: 'un', op, a, line };
        } else left = simple();
        for (;;) {
          const op = tok.t === 'op' ? tok.v : tok.t === 'kw' && (tok.v === 'and' || tok.v === 'or') ? tok.v : null;
          const pr = op !== null && Object.prototype.hasOwnProperty.call(BIN, op) ? BIN[op] : null;
          if (!pr || pr[0] <= (limit || 0)) break;
          const l2 = next().line;
          left = { k: 'bin', op, a: left, b: expr(pr[1]), line: l2 };
        }
        return left;
      }
      function simple(){
        const t = tok, line = t.line;
        let e;
        if (t.t === 'num') { next(); e = { k: 'num', v: t.v }; }
        else if (t.t === 'str') { next(); e = { k: 'str', v: t.v }; }
        else if (t.t === 'ibeg') e = interp();
        else if (t.t === 'kw' && t.v === 'nil') { next(); e = { k: 'nil' }; }
        else if (t.t === 'kw' && t.v === 'true') { next(); e = { k: 'true' }; }
        else if (t.t === 'kw' && t.v === 'false') { next(); e = { k: 'false' }; }
        else if (t.t === 'kw' && t.v === 'function') { next(); e = funcBody(line, false, ''); }
        else if (t.t === 'kw' && t.v === 'if') e = ifExpr();
        else if (t.t === 'op' && t.v === '...') { next(); if (!fs.vararg) fail('"..." можно писать только внутри функции с параметром "..."'); e = { k: 'vararg' }; }
        else if (t.t === 'op' && t.v === '{') e = table();
        else e = suffixed();
        if (isOp('::')) { next(); skipType(); e = { k: 'paren', e }; }
        return e;
      }
      function primary(){
        const line = tok.line;
        if (tok.t === 'name') return ref(next().v, line);
        if (isOp('(')) { next(); const e = expr(); expectOp(')', ' — закрыть скобку'); return { k: 'paren', e, line }; }
        fail(tok.t === 'eof' ? 'код оборвался — ожидалось выражение' : 'неожиданно ' + tokName(tok) + ' — ожидалось выражение');
      }
      function suffixed(){
        let e = primary();
        for (;;) {
          const line = tok.line;
          if (tok.t === 'op') {
            if (tok.v === '.') { next(); e = { k: 'index', obj: e, key: { k: 'str', v: name() }, line }; continue; }
            if (tok.v === '[') { next(); const key = expr(); expectOp(']'); e = { k: 'index', obj: e, key, line }; continue; }
            if (tok.v === ':') { next(); const m = name(); e = { k: 'mcall', obj: e, name: m, args: callArgs(), line }; continue; }
            if (tok.v === '(' || tok.v === '{') { e = { k: 'call', fn: e, args: callArgs(), line }; continue; }
          } else if (tok.t === 'str') { e = { k: 'call', fn: e, args: callArgs(), line }; continue; }
          return e;
        }
      }
      function callArgs(){
        if (tok.t === 'str') return [{ k: 'str', v: next().v }];
        if (isOp('{')) return [table()];
        expectOp('(', ' — аргументы вызова');
        if (isOp(')')) { next(); return []; }
        const a = exprlist(); expectOp(')', ' — закрыть вызов функции'); return a;
      }
      function table(){
        const line = tok.line; next();
        const items = [];
        while (!isOp('}')) {
          if (isOp('[')) { next(); const key = expr(); expectOp(']'); expectOp('=', ' в таблице'); items.push({ key, v: expr() }); }
          else if (tok.t === 'name' && peek().t === 'op' && peek().v === '=') { const k = next().v; next(); items.push({ key: { k: 'str', v: k }, v: expr() }); }
          else items.push({ key: null, v: expr() });
          if (isOp(',') || isOp(';')) next(); else break;
        }
        expectOp('}', ' — закрыть таблицу со строки ' + line);
        return { k: 'table', items, line };
      }
      function ifExpr(){
        next();
        const conds = [];
        let c = expr(); expectKw('then'); conds.push([c, expr()]);
        while (isKw('elseif')) { next(); c = expr(); expectKw('then'); conds.push([c, expr()]); }
        expectKw('else');
        return { k: 'ifexp', conds, els: expr() };
      }
      function interp(){
        const parts = [next().v], exprs = [];
        for (;;) {
          exprs.push(expr());
          if (tok.t === 'imid') { parts.push(next().v); continue; }
          if (tok.t === 'iend') { parts.push(next().v); break; }
          fail('ожидалась "}" в строке `…`, а найдено ' + tokName(tok));
        }
        return { k: 'interp', parts, exprs };
      }
      fs = { parent: null, blocks: [new Map()], vararg: true, loops: [] };
      const body = block();
      if (tok.t !== 'eof') fail('лишнее ' + tokName(tok) + ' — его нечем закрыть (проверь, нет ли лишнего end)');
      return { k: 'func', params: [], vararg: true, body, line: 0, name: 'main' };
    }

    // ═══ Перевод дерева в JS ═══
    // Функция Lua → (function*(параметры){ let $L = строка; try { … } catch (e) { throw $T(e, $L) } }) — $L для ошибок.
    // Вызов: (tF = f, tA = аргумент, tF instanceof $GF ? yield* tF(tA) : yield* $C(tF, [tA])) — результат: массив значений.
    // Объекты мира: a.b(…) → $CD (this = a), a:b(…) → $CM (this = a, без self).
    const AROP = { '+': '$ADD', '-': '$SUB', '*': '$MUL', '/': '$DIV', '%': '$MOD', '^': '$POW', '//': '$IDIV' };
    const CMPOP = { '<': '$LT', '<=': '$LE', '>': '$GT', '>=': '$GE' };
    function gen(ast, sites){
      let F = null, lab = 0;
      const S = JSON.stringify;
      const tmp = () => { const n = ++F.temps; if (n > F.max) F.max = n; return 't' + n; };
      const site = d => { if (!d) return -1; let i = sites.indexOf(d); if (i < 0) { i = sites.length; sites.push(d); } return i; };
      const desc = e => e.k === 'local' ? "локальная переменная '" + e.sym.name + "'" : e.k === 'global' ? "глобальная переменная '" + e.name + "'" : e.k === 'index' && e.key.k === 'str' ? "поле '" + e.key.v + "'" : e.k === 'mcall' ? "результат метода '" + e.name + "'" : e.k === 'call' ? 'результат вызова' : null;
      const isMulti = e => e.k === 'call' || e.k === 'mcall' || e.k === 'vararg';
      const isLit = e => e.k === 'nil' || e.k === 'true' || e.k === 'false' || e.k === 'num' || e.k === 'str';
      const num = v => v === Infinity ? 'Infinity' : v === -Infinity ? '(-Infinity)' : Object.is(v, -0) ? '(-0)' : v < 0 ? '(' + String(v) + ')' : String(v);
      function fn(f){
        const outer = F;
        F = { temps: 0, max: 0 };
        const ps = f.params.map(s => s.js);
        if (f.vararg) ps.push('...$va');
        const body = block(f.body);
        let temps = '';
        if (F.max) { const t = []; for (let i = 1; i <= F.max; i++) t.push('t' + i); temps = 'let ' + t.join(',') + ';'; }
        F = outer;
        return '(function*(' + ps.join(',') + '){let $L=' + f.line + ';' + temps + 'try{' + body + '}catch($e){throw $T($e,$L)}return $X})';
      }
      function block(list){ let s = ''; for (const st of list) s += stmt(st); return s; }
      function ex(e){   // одно значение
        switch (e.k) {
          case 'nil': return 'undefined';
          case 'true': return 'true';
          case 'false': return 'false';
          case 'num': return num(e.v);
          case 'str': return S(e.v);
          case 'vararg': return '$va[0]';
          case 'func': return fn(e);
          case 'local': return e.sym.js;
          case 'global': return '$I($E,' + S(e.name) + ')';
          case 'index': return '$I(' + ex(e.obj) + ',' + ex(e.key) + ',' + site(desc(e.obj)) + ')';
          case 'call': case 'mcall': return call(e) + '[0]';
          case 'paren': return ex(e.e);
          case 'bin': return bin(e);
          case 'un': return e.op === 'not' ? '!' + cond(e.a) : e.op === '-' ? '$UNM(' + ex(e.a) + ')' : '$LEN(' + ex(e.a) + ',' + site(desc(e.a)) + ')';
          case 'table': return table(e);
          case 'ifexp': return '(' + e.conds.map(([c, v]) => cond(c) + '?' + ex(v) + ':').join('') + ex(e.els) + ')';
          case 'interp': { let s = '(' + S(e.parts[0]); e.exprs.forEach((x, i) => { s += '+$TS(' + ex(x) + ')+' + S(e.parts[i + 1]); }); return s + ')'; }
        }
        throw new Error('gen: ' + e.k);
      }
      function multi(e){ return e.k === 'vararg' ? '$va' : call(e); }   // массив значений
      function list(exprs){
        if (!exprs.length) return '$X';
        const n = exprs.length, last = exprs[n - 1];
        if (n === 1 && isMulti(last)) return multi(last);
        return '[' + exprs.map((x, i) => i === n - 1 && isMulti(x) ? '...' + multi(x) : ex(x)).join(',') + ']';
      }
      function flat(e, out){ if (e.k === 'bin' && e.op === '..') { flat(e.a, out); flat(e.b, out); } else out.push(e); return out; }
      function bin(e){
        const op = e.op;
        if (AROP[op]) return AROP[op] + '(' + ex(e.a) + ',' + ex(e.b) + ')';
        if (op === '..') { const l = flat(e, []); return l.length === 2 ? '$CC(' + ex(l[0]) + ',' + ex(l[1]) + ')' : '$CCN([' + l.map(ex).join(',') + '])'; }
        if (op === 'and' || op === 'or') {
          const t = tmp(), a = ex(e.a), b = ex(e.b);
          F.temps--;
          return '((' + t + '=' + a + ')===undefined||' + t + '===false?' + (op === 'and' ? t + ':' + b : b + ':' + t) + ')';
        }
        return cmp(e);
      }
      function cmp(e){
        const op = e.op;
        if (op === '==' || op === '~=') {
          const s = isLit(e.a) || isLit(e.b) ? '(' + ex(e.a) + '===' + ex(e.b) + ')' : '$EQ(' + ex(e.a) + ',' + ex(e.b) + ')';
          return op === '==' ? s : '!' + s;
        }
        return CMPOP[op] + '(' + ex(e.a) + ',' + ex(e.b) + ')';
      }
      function cond(e){   // логическое JS
        switch (e.k) {
          case 'true': return 'true';
          case 'false': case 'nil': return 'false';
          case 'paren': return cond(e.e);
          case 'un': if (e.op === 'not') return '!' + cond(e.a); break;
          case 'bin':
            if (e.op === 'and') return '(' + cond(e.a) + '&&' + cond(e.b) + ')';
            if (e.op === 'or') return '(' + cond(e.a) + '||' + cond(e.b) + ')';
            if (e.op === '==' || e.op === '~=' || CMPOP[e.op]) return cmp(e);
            break;
        }
        return '$B(' + ex(e) + ')';
      }
      function call(e){   // '(…)' → массив результатов
        const saved = F.temps;
        let pre, f, self = null, kind, sd;
        if (e.k === 'mcall') {
          self = tmp(); f = tmp(); kind = 'm'; sd = site(desc(e.obj));
          pre = self + '=' + ex(e.obj) + ',' + f + '=$IM(' + self + ',' + S(e.name) + ',' + sd + '),';
        } else if (e.fn.k === 'index' && e.fn.key.k === 'str') {
          self = tmp(); f = tmp(); kind = 'd'; sd = site(desc(e.fn));
          pre = self + '=' + ex(e.fn.obj) + ',' + f + '=$IM(' + self + ',' + S(e.fn.key.v) + ',' + site(desc(e.fn.obj)) + '),';
        } else {
          f = tmp(); kind = 'c'; sd = site(desc(e.fn));
          pre = f + '=' + ex(e.fn) + ',';
        }
        const args = [], n = e.args.length;
        e.args.forEach((a, i) => {
          if (i === n - 1 && isMulti(a)) { const t = tmp(); pre += t + '=' + multi(a) + ','; args.push('...' + t); }
          else if (isLit(a)) args.push(ex(a));
          else { const t = tmp(); pre += t + '=' + ex(a) + ','; args.push(t); }
        });
        const al = args.join(',');
        let code;
        if (kind === 'm') code = f + ' instanceof $GF?yield* ' + f + '(' + self + (al ? ',' + al : '') + '):yield* $CM(' + self + ',' + f + ',' + S(e.name) + ',[' + al + '],' + sd + ')';
        else if (kind === 'd') code = f + ' instanceof $GF?yield* ' + f + '(' + al + '):yield* $CD(' + self + ',' + f + ',[' + al + '],' + sd + ')';
        else code = f + ' instanceof $GF?yield* ' + f + '(' + al + '):yield* $C(' + f + ',[' + al + '],' + sd + ')';
        F.temps = saved;
        return '(' + pre + code + ')';
      }
      function table(e){
        const items = e.items, n = items.length;
        if (!n) return '$TA([])';
        if (items.every(x => !x.key)) return '$TA([' + items.map((x, i) => i === n - 1 && isMulti(x.v) ? '...' + multi(x.v) : ex(x.v)).join(',') + '])';
        if (items.every(x => x.key && x.key.k === 'str')) return '$TR([' + items.map(x => S(x.key.v) + ',' + ex(x.v)).join(',') + '])';
        const parts = [];
        let tail = 'null';
        items.forEach((x, i) => {
          if (x.key) parts.push('1,' + ex(x.key) + ',' + ex(x.v));
          else if (i === n - 1 && isMulti(x.v)) tail = multi(x.v);
          else parts.push('0,' + ex(x.v));
        });
        return '$TBL([' + parts.join(',') + '],' + tail + ')';
      }
      // ── операторы ──
      function stmt(s){
        const L = '$L=' + s.line + ';';
        switch (s.k) {
          case 'local': return L + local(s);
          case 'assign': return L + assign(s);
          case 'compound': return L + compound(s);
          case 'callstat': return L + call(s.call) + ';';
          case 'do': return '{' + block(s.body) + '}';
          case 'if': return s.clauses.map((c, i) => (i ? 'else if(($L=' : 'if(($L=') + c.line + ',' + cond(c.c) + ')){' + block(c.b) + '}').join('') + (s.els ? 'else{' + block(s.els) + '}' : '');
          case 'while': return 'while(($L=' + s.line + ',' + cond(s.cond) + ')){' + block(s.body) + '}';
          case 'repeat': return repeat(s);
          case 'fornum': return L + forNum(s);
          case 'forin': return L + forIn(s);
          case 'return': return L + 'return ' + list(s.exprs) + ';';
          case 'break': return 'break;';
          case 'continue': return s.loop.label ? 'break ' + s.loop.label + ';' : 'continue;';
        }
        throw new Error('gen stmt: ' + s.k);
      }
      function local(s){
        const syms = s.syms, xs = s.exprs, n = syms.length, m = xs.length, decl = [];
        let extra = '';
        if (m === 0) for (const y of syms) decl.push(y.js + '=undefined');
        else {
          for (let i = 0; i < n; i++) {
            if (i < m - 1) decl.push(syms[i].js + '=' + ex(xs[i]));
            else if (i === m - 1) {
              if (isMulti(xs[i]) && n > m) {
                const t = tmp();
                decl.push(syms[i].js + '=(' + t + '=' + multi(xs[i]) + ')[0]');
                for (let j = i + 1; j < n; j++) decl.push(syms[j].js + '=' + t + '[' + (j - i) + ']');
                F.temps--;
                break;
              }
              decl.push(syms[i].js + '=' + ex(xs[i]));
            } else decl.push(syms[i].js + '=undefined');
          }
          for (let j = n; j < m; j++) extra += (isMulti(xs[j]) ? multi(xs[j]) : ex(xs[j])) + ';';
        }
        return s.hoisted ? decl.join(';') + ';' + extra : 'let ' + decl.join(',') + ';' + extra;
      }
      function set1(t, v){
        if (t.k === 'local') return t.sym.js + '=' + v;
        if (t.k === 'global') return '$S($E,' + S(t.name) + ',' + v + ')';
        return '$S(' + ex(t.obj) + ',' + ex(t.key) + ',' + v + ',' + site(desc(t.obj)) + ')';
      }
      function assign(s){
        const T = s.targets, V = s.exprs;
        if (T.length === 1 && V.length === 1) return set1(T[0], ex(V[0])) + ';';
        const saved = F.temps;
        let out = '';
        const tg = T.map(t => { if (t.k !== 'index') return { t }; const o = tmp(), k = tmp(); out += o + '=' + ex(t.obj) + ';' + k + '=' + ex(t.key) + ';'; return { t, o, k }; });
        const vals = [];
        for (let i = 0; i < T.length; i++) {
          if (i < V.length - 1 || (i === V.length - 1 && !isMulti(V[i]))) { const v = tmp(); out += v + '=' + ex(V[i]) + ';'; vals.push(v); }
          else if (i === V.length - 1) { const v = tmp(); out += v + '=' + multi(V[i]) + ';'; for (let j = i; j < T.length; j++) vals.push(v + '[' + (j - i) + ']'); break; }
          else vals.push('undefined');
        }
        for (let j = T.length; j < V.length; j++) out += (isMulti(V[j]) ? multi(V[j]) : ex(V[j])) + ';';
        tg.forEach((g, i) => { out += (g.o ? '$S(' + g.o + ',' + g.k + ',' + vals[i] + ',' + site(desc(g.t.obj)) + ')' : set1(g.t, vals[i])) + ';'; });
        F.temps = saved;
        return out;
      }
      function compound(s){
        const t = s.target, op = s.op;
        const mk = a => (op === '..' ? '$CC(' : AROP[op] + '(') + a + ',' + ex(s.expr) + ')';
        if (t.k === 'local') return t.sym.js + '=' + mk(t.sym.js) + ';';
        if (t.k === 'global') return '$S($E,' + S(t.name) + ',' + mk('$I($E,' + S(t.name) + ')') + ');';
        const o = tmp(), k = tmp(), sd = site(desc(t.obj));
        const r = '(' + o + '=' + ex(t.obj) + ',' + k + '=' + ex(t.key) + ',$S(' + o + ',' + k + ',' + mk('$I(' + o + ',' + k + ',' + sd + ')') + ',' + sd + '));';
        F.temps -= 2;
        return r;
      }
      function repeat(s){
        const c = 'if(($L=' + s.cl + ',' + cond(s.cond) + '))break;';
        if (!s.loop.cont) return 'for(;;){' + block(s.body) + c + '}';
        s.loop.label = '$c' + (++lab);
        const hs = [];   // локальные тела видны в until — объявляем до метки (continue прыгает к until)
        for (const st of s.body) if (st.k === 'local') { st.hoisted = true; for (const y of st.syms) hs.push(y.js); }
        return 'for(;;){' + (hs.length ? 'let ' + hs.join(',') + ';' : '') + s.loop.label + ':{' + block(s.body) + '}' + c + '}';
      }
      function forNum(s){
        const id = ++lab, a = '$a' + id, b = '$b' + id, st = '$s' + id, i = '$i' + id;
        let head = 'let ' + a + '=$N(' + ex(s.start) + ',"начальное значение"),' + b + '=$N(' + ex(s.limit) + ',"предел"),' + i;
        const body = '{let ' + s.sym.js + '=' + i + ';' + block(s.body) + '}';
        if (!s.step || s.step.k === 'num') {
          const v = s.step ? s.step.v : 1;
          if (v === 0) return '{' + head + ';throw $ZS();}';
          return '{' + head + ';for(' + i + '=' + a + ';' + i + (v > 0 ? '<=' : '>=') + b + ';' + i + '+=' + num(v) + ')' + body + '}';
        }
        head += ',' + st + '=$N(' + ex(s.step) + ',"шаг")';
        return '{' + head + ';if(' + st + '===0)throw $ZS();for(' + i + '=' + a + ';' + st + '>0?' + i + '<=' + b + ':' + i + '>=' + b + ';' + i + '+=' + st + ')' + body + '}';
      }
      function forIn(s){
        const id = ++lab, it = '$it' + id, r = '$r' + id, t = tmp();
        const head = t + '=' + list(s.exprs) + ';const ' + it + '=$ITER(' + t + '[0],' + t + '[1],' + t + '[2]);';
        F.temps--;
        const vars = s.syms.map((y, k) => y.js + '=' + r + '[' + k + ']').join(',');
        return '{' + head + 'for(;;){$L=' + s.line + ';const ' + r + '=' + it + '.m!==0?' + it + '.step():(yield* ' + it + '.call());if(' + r + '===null)break;let ' + vars + ';' + block(s.body) + '}}';
      }
      return fn(ast);
    }
    const HELPERS = ['GF', 'X', 'I', 'IM', 'S', 'C', 'CM', 'CD', 'ADD', 'SUB', 'MUL', 'DIV', 'MOD', 'POW', 'IDIV', 'UNM', 'LEN', 'CC', 'CCN', 'EQ', 'LT', 'LE', 'GT', 'GE', 'B', 'TA', 'TR', 'TBL', 'ITER', 'TS', 'N', 'ZS'];
    const HEAD = 'const {' + HELPERS.map(h => h + ':$' + h).join(',') + '}=$R;';
    // Компиляция: код → фабрика (env, имя, ctx) → функция-генератор главного блока
    function compile(src, cn){
      const sites = [];
      const js = gen(parse(lex(String(src))), sites);
      const make = new Function('$R', '$E', '$CN', '$CTX', '$SITES', '"use strict";' + HEAD + 'const $T=(e,l)=>$R.trap(e,l,$CN,$CTX,$SITES);return ' + js + ';');
      return (env, name, ctx) => make(R, env, name, ctx, sites);
    }

    // ═══ Значения: nil = undefined, числа/строки/логика — как в JS, таблица — LT, функция Lua — function* ═══
    const GF = Object.getPrototypeOf(function* () {}).constructor;
    const X = Object.freeze([]);   // «ни одного значения»
    class LuaError { constructor(value, lvl){ this.value = value; this.lvl = lvl; this.line = undefined; this.ctx = undefined; this.pos = undefined; this.pctx = undefined; this.site = -1; } }
    const rtErr = m => new LuaError(m, 1);
    let V3, CF, BC, STR;   // Vector3, CFrame, BrickColor (классы мира из env), таблица string
    class LT {   // таблица: arr — ключи 1..n (последний не nil; nil внутри — «дырки»), hash — остальное
      constructor(){ this.arr = []; this.hash = new Map(); this.mt = undefined; this.ro = false; this.nk = undefined; this.ni = undefined; }
      get(k){
        if (typeof k === 'number') { const a = this.arr; if (k >= 1 && k <= a.length && (k | 0) === k) return a[k - 1]; }
        return this.hash.get(k);
      }
      set(k, v){
        if (this.ro) throw rtErr('попытка изменить таблицу только для чтения (table.freeze)');
        if (typeof k === 'number') {
          if ((k | 0) === k && k >= 1) {
            const a = this.arr, n = a.length;
            if (k <= n) {
              if (v === undefined && k === n) { a.pop(); while (a.length && a[a.length - 1] === undefined) a.pop(); }
              else a[k - 1] = v;
              return;
            }
            if (k === n + 1) { if (v !== undefined) { a.push(v); if (this.hash.size) this.fix(); } return; }
          } else if (k !== k) throw rtErr('ключ таблицы — NaN');
        } else if (k === undefined || k === null) throw rtErr('ключ таблицы — nil');
        if (v === undefined) this.hash.delete(k); else this.hash.set(k, v);
      }
      fix(){ const a = this.arr, h = this.hash; let j = a.length + 1, w; while ((w = h.get(j)) !== undefined) { a.push(w); h.delete(j); j++; } }
    }
    const tab = o => { const t = new LT(); for (const k of Object.keys(o)) t.hash.set(k, o[k]); return t; };
    function tn(v){   // type()
      if (v === undefined || v === null) return 'nil';
      const t = typeof v;
      if (t === 'boolean' || t === 'number' || t === 'string' || t === 'function') return t;
      if (v instanceof LT) return 'table';
      if (v instanceof Co) return 'thread';
      return 'userdata';
    }
    function tyof(v){   // typeof() — как в Roblox
      const t = tn(v);
      if (t !== 'userdata') return t;
      if (V3 !== undefined && v instanceof V3) return 'Vector3';
      if (CF !== undefined && v instanceof CF) return 'CFrame';
      if (BC !== undefined && v instanceof BC) return 'BrickColor';
      try {
        if (typeof v.IsA === 'function') return 'Instance';
        if (typeof v.Connect === 'function') return 'RBXScriptSignal';
        if (typeof v.Disconnect === 'function') return 'RBXScriptConnection';
      } catch (e) {}
      return 'userdata';
    }
    // ── числа ──
    function fmtG(x, P, alt){   // как %.<P>g в C
      if (x !== x) return 'nan';
      if (x === Infinity) return 'inf';
      if (x === -Infinity) return '-inf';
      if (P === 0) P = 1;
      if (x === 0) return (Object.is(x, -0) ? '-0' : '0') + (alt && P > 1 ? '.' + '0'.repeat(P - 1) : '');
      const es = x.toExponential(P - 1), ei = es.indexOf('e'), xp = +es.slice(ei + 1);
      let s;
      if (xp < -4 || xp >= P) {
        let m = es.slice(0, ei);
        if (!alt && m.indexOf('.') >= 0) m = m.replace(/\.?0+$/, '');
        const ax = Math.abs(xp);
        s = m + 'e' + (xp < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
      } else {
        s = x.toFixed(P - 1 - xp);
        if (!alt && s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
      }
      return s;
    }
    const numStr = n => Number.isInteger(n) && n > -1e14 && n < 1e14 ? (Object.is(n, -0) ? '-0' : String(n)) : fmtG(n, 14, false);
    function str2num(s){
      const t = s.trim();
      if (!t) return undefined;
      if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(t)) { const v = parseInt(t.replace(/^[-+]/, '').slice(2), 16); return t[0] === '-' ? -v : v; }
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return +t;
      return undefined;
    }
    const arnum = v => typeof v === 'number' ? v : typeof v === 'string' ? str2num(v) : undefined;
    // ── строковое представление ──
    const IDS = new WeakMap();
    let idSeq = 0;
    const addr = o => { let id = IDS.get(o); if (!id) { id = ++idSeq; IDS.set(o, id); } return '0x' + (0x5a000 + id * 40).toString(16).padStart(8, '0'); };
    function tostr(v){
      switch (typeof v) {
        case 'undefined': return 'nil';
        case 'boolean': return v ? 'true' : 'false';
        case 'number': return numStr(v);
        case 'string': return v;
        case 'function': return 'function: ' + addr(v);
      }
      if (v === null) return 'nil';
      if (v instanceof LT) {
        if (v.mt !== undefined) {
          const h = v.mt.hash.get('__tostring');
          if (h !== undefined) { const r = runSync(h, [v])[0]; if (typeof r === 'string') return r; if (typeof r === 'number') return numStr(r); throw rtErr("'__tostring' должен вернуть строку"); }
          const nm = v.mt.hash.get('__name'); if (typeof nm === 'string') return nm + ': ' + addr(v);
        }
        return 'table: ' + addr(v);
      }
      if (v instanceof Co) return 'thread: ' + addr(v);
      if (V3 !== undefined && v instanceof V3) return numStr(v.X) + ', ' + numStr(v.Y) + ', ' + numStr(v.Z);
      if (CF !== undefined && v instanceof CF && typeof v.GetComponents === 'function') return v.GetComponents().map(numStr).join(', ');
      try { const s = String(v); if (s !== '[object Object]') return s; } catch (e) {}
      return 'userdata: ' + addr(v);
    }
    const tnr = v => { const t = tyof(v); return t === 'nil' ? 'nil' : t; };   // имя типа в сообщениях
    const keyDesc = k => typeof k === 'string' ? "поле '" + k + "'" : '[' + (typeof k === 'number' ? numStr(k) : tnr(k)) + ']';
    // ── метатаблицы и вызов функции «до конца» (метаметоды, __index — ждать в них нельзя) ──
    const metaOf = (v, ev) => v instanceof LT && v.mt !== undefined ? v.mt.hash.get(ev) : undefined;
    let SYNC = 0;
    function runSync(f, args){
      if (f instanceof GF) {
        const g = f(...args);
        let r;
        SYNC++;
        try { r = g.next(); } finally { SYNC--; }
        if (!r.done) throw rtErr('здесь нельзя ждать (wait / yield): внутри метаметода, __index или __tostring');
        return r.value;
      }
      if (typeof f === 'function') { const r = f(...args.map(a => toJS(a))); if (r instanceof Promise) throw rtErr('здесь нельзя ждать'); return r === undefined ? X : [fromJS(r)]; }
      const h = metaOf(f, '__call');
      if (h !== undefined) return runSync(h, [f, ...args]);
      throw rtErr('попытка вызвать ' + tnr(f));
    }
    // ── арифметика ──
    const AR = [['__add', '+'], ['__sub', '-'], ['__mul', '*'], ['__div', '/'], ['__mod', '%'], ['__pow', '^'], ['__idiv', '//'], ['__unm', '-']];
    function hostArith(op, a, b){   // Vector3 и CFrame мира
      if (V3 !== undefined) {
        const va = a instanceof V3, vb = b instanceof V3;
        if (va || vb) switch (op) {
          case 0: if (va && vb) return a.add(b); break;
          case 1: if (va && vb) return a.sub(b); break;
          case 2: if (va && (vb || typeof b === 'number')) return a.mul(b); if (vb && typeof a === 'number') return b.mul(a); break;
          case 3: if (va && (vb || typeof b === 'number')) return a.div(b); if (vb && typeof a === 'number') return new V3(a / b.X, a / b.Y, a / b.Z); break;
          case 6: if (va && typeof b === 'number') return new V3(Math.floor(a.X / b), Math.floor(a.Y / b), Math.floor(a.Z / b)); break;
          case 7: if (va) return a.mul(-1); break;
        }
      }
      if (CF !== undefined && a instanceof CF) {
        if (op === 0 && V3 !== undefined && b instanceof V3) return a.add(b);
        if (op === 1 && V3 !== undefined && b instanceof V3) return a.sub(b);
        if (op === 2 && (b instanceof CF || (V3 !== undefined && b instanceof V3))) return a.mul(b);
      }
      return undefined;
    }
    function arith(op, a, b){
      const na = arnum(a), nb = op === 7 ? 0 : arnum(b);
      if (na !== undefined && nb !== undefined) {
        switch (op) {
          case 0: return na + nb; case 1: return na - nb; case 2: return na * nb; case 3: return na / nb;
          case 4: return na - Math.floor(na / nb) * nb; case 5: return Math.pow(na, nb); case 6: return Math.floor(na / nb); default: return -na;
        }
      }
      const ev = AR[op][0];
      let h = metaOf(a, ev); if (h === undefined && op !== 7) h = metaOf(b, ev);
      if (h !== undefined) return runSync(h, [a, op === 7 ? a : b])[0];
      const hv = hostArith(op, a, b); if (hv !== undefined) return hv;
      throw rtErr('попытка выполнить арифметику (' + AR[op][1] + ') над ' + (op === 7 ? tnr(a) : tnr(a) + ' и ' + tnr(b)));
    }
    const $ADD = (a, b) => typeof a === 'number' && typeof b === 'number' ? a + b : arith(0, a, b);
    const $SUB = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : arith(1, a, b);
    const $MUL = (a, b) => typeof a === 'number' && typeof b === 'number' ? a * b : arith(2, a, b);
    const $DIV = (a, b) => typeof a === 'number' && typeof b === 'number' ? a / b : arith(3, a, b);
    const $MOD = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - Math.floor(a / b) * b : arith(4, a, b);
    const $POW = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.pow(a, b) : arith(5, a, b);
    const $IDIV = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.floor(a / b) : arith(6, a, b);
    const $UNM = a => typeof a === 'number' ? -a : arith(7, a, a);
    const $B = v => v !== undefined && v !== false && v !== null;
    // ── сравнение ──
    function eqSlow(a, b){
      if (a instanceof LT) {
        if (!(b instanceof LT)) return false;
        let h = metaOf(a, '__eq'); if (h === undefined) h = metaOf(b, '__eq');
        return h !== undefined && $B(runSync(h, [a, b])[0]);
      }
      if (V3 !== undefined && a instanceof V3) return b instanceof V3 && a.X === b.X && a.Y === b.Y && a.Z === b.Z;
      if (CF !== undefined && a instanceof CF && b instanceof CF && typeof a.GetComponents === 'function') { const x = a.GetComponents(), y = b.GetComponents(); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; }
      return false;
    }
    const $EQ = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && eqSlow(a, b));
    function ltSlow(a, b, le){
      if (typeof a === 'string' && typeof b === 'string') return le ? a <= b : a < b;
      const ev = le ? '__le' : '__lt';
      let h = metaOf(a, ev); if (h === undefined) h = metaOf(b, ev);
      if (h !== undefined) return $B(runSync(h, [a, b])[0]);
      if (le) { let h2 = metaOf(a, '__lt'); if (h2 === undefined) h2 = metaOf(b, '__lt'); if (h2 !== undefined) return !$B(runSync(h2, [b, a])[0]); }
      throw rtErr('попытка сравнить ' + tnr(a) + ' и ' + tnr(b));
    }
    const $LT = (a, b) => typeof a === 'number' && typeof b === 'number' ? a < b : ltSlow(a, b, false);
    const $LE = (a, b) => typeof a === 'number' && typeof b === 'number' ? a <= b : ltSlow(a, b, true);
    const $GT = (a, b) => typeof a === 'number' && typeof b === 'number' ? a > b : ltSlow(b, a, false);
    const $GE = (a, b) => typeof a === 'number' && typeof b === 'number' ? a >= b : ltSlow(b, a, true);
    // ── склейка и длина ──
    function $CC(a, b){
      const ta = typeof a, tb = typeof b;
      if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number')) return (ta === 'string' ? a : numStr(a)) + (tb === 'string' ? b : numStr(b));
      let h = metaOf(a, '__concat'); if (h === undefined) h = metaOf(b, '__concat');
      if (h !== undefined) return runSync(h, [a, b])[0];
      throw rtErr('попытка склеить (..) ' + tnr(a) + ' и ' + tnr(b) + (a === undefined || b === undefined || a === null || b === null ? '' : ' — оберни значение в tostring(…)'));
    }
    function $CCN(l){
      let s = '';
      for (let i = 0; i < l.length; i++) {
        const v = l[i];
        if (typeof v === 'string') s += v;
        else if (typeof v === 'number') s += numStr(v);
        else { let r = l[l.length - 1]; for (let j = l.length - 2; j >= 0; j--) r = $CC(l[j], r); return r; }
      }
      return s;
    }
    function $LEN(v, sd){
      if (typeof v === 'string') return v.length;
      if (v instanceof LT) { if (v.mt !== undefined) { const h = v.mt.hash.get('__len'); if (h !== undefined) return runSync(h, [v])[0]; } return v.arr.length; }
      const e = rtErr('попытка взять длину (#) у ' + tnr(v)); e.site = sd; throw e;
    }
    // ── таблицы в коде: {1, 2}, {x = 1}, смешанные ──
    function $TA(a){ const t = new LT(); let n = a.length; while (n > 0 && a[n - 1] === undefined) n--; if (n !== a.length) a.length = n; t.arr = a; return t; }
    function $TR(kv){ const t = new LT(); for (let i = 0; i < kv.length; i += 2) if (kv[i + 1] !== undefined) t.hash.set(kv[i], kv[i + 1]); return t; }
    function $TBL(items, tail){
      const t = new LT(), pos = [];
      for (let i = 0; i < items.length;) {
        if (items[i] === 0) { pos.push(items[i + 1]); i += 2; }
        else { t.set(items[i + 1], items[i + 2]); i += 3; }
      }
      if (tail) for (let i = 0; i < tail.length; i++) pos.push(tail[i]);
      if (pos.length) {   // позиционные значения перекрывают [1] = … (как SETLIST в Lua)
        const old = t.arr, P = pos.length;
        for (let j = 1; j <= P; j++) t.hash.delete(j);
        let n = P; while (n > 0 && pos[n - 1] === undefined) n--; pos.length = n;
        t.arr = pos;
        for (let j = P; j < old.length; j++) if (old[j] !== undefined) t.set(j + 1, old[j]);
        if (t.hash.size) t.fix();
      }
      return t;
    }
    // ── индексация: таблицы (с __index), строки (string.*), объекты мира ──
    const BLOCK = new Set(['constructor', 'prototype', 'caller', 'callee', 'arguments', 'apply', 'call', 'bind', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'then']);
    const hidden = k => typeof k !== 'string' || k.charCodeAt(0) === 95 || BLOCK.has(k);   // внутренности JS и «_служебное» мира — не видны
    const BM = new WeakMap();
    function boundMethod(o, k, f){   // obj.Method без вызова — функция, помнящая obj
      const lf = UW.get(f); if (lf) return lf;
      let m = BM.get(o); if (!m) { m = new Map(); BM.set(o, m); }
      let w = m.get(k);
      if (!w || w.f !== f) { w = function* (...a) { return yield* hostCall(f, o, a.length && a[0] === o ? a.slice(1) : a); }; w.f = f; m.set(k, w); }
      return w;
    }
    function hostIndex(o, k){
      if (hidden(k)) return undefined;
      const v = o[k];
      if (v === null || v === undefined) return undefined;
      const t = typeof v;
      if (t === 'function') return boundMethod(o, k, v);
      if (t === 'object' && Array.isArray(v)) return fromJS(v);
      return v;
    }
    function hostSet(o, k, v){
      if (hidden(k)) throw rtErr("нельзя менять '" + String(k) + "'");
      if ((V3 !== undefined && o instanceof V3) || (CF !== undefined && o instanceof CF)) throw rtErr(tyof(o) + ' нельзя изменить — создай новый (' + tyof(o) + '.new(…))');
      o[k] = toJS(v);
    }
    function idxErr(o, k, sd){ const e = rtErr('попытка взять ' + keyDesc(k) + ' у ' + tnr(o)); e.site = sd; return e; }
    function idxMeta(o, k, sd){
      for (let n = 0; n < 100; n++) {
        const h = o.mt.hash.get('__index');
        if (h === undefined) return undefined;
        if (h instanceof LT) { const v = h.get(k); if (v !== undefined || h.mt === undefined) return v; o = h; continue; }
        if (typeof h === 'function') return runSync(h, [o, k])[0];
        return $I(h, k, sd);
      }
      throw rtErr("цепочка '__index' слишком длинная (зацикливание?)");
    }
    function $I(o, k, sd){
      if (o instanceof LT) { const v = o.get(k); return v !== undefined || o.mt === undefined ? v : idxMeta(o, k, sd); }
      if (typeof o === 'string') return strIndex(o, k);
      if (o !== null && typeof o === 'object') return hostIndex(o, k);
      throw idxErr(o, k, sd);
    }
    function $IM(o, k, sd){   // для вызова метода: у объектов мира — сама функция JS (вызовем с this = o)
      if (o instanceof LT) { const v = o.get(k); return v !== undefined || o.mt === undefined ? v : idxMeta(o, k, sd); }
      if (typeof o === 'string') return strIndex(o, k);
      if (o !== null && typeof o === 'object') { if (hidden(k)) return undefined; const v = o[k]; return v === null ? undefined : v; }
      throw idxErr(o, k, sd);
    }
    function setMeta(o, k, v, sd){
      for (let n = 0; n < 100; n++) {
        const h = o.mt === undefined ? undefined : o.mt.hash.get('__newindex');
        if (h === undefined || o.get(k) !== undefined) { o.set(k, v); return; }
        if (h instanceof LT) { o = h; continue; }
        if (typeof h === 'function') { runSync(h, [o, k, v]); return; }
        $S(h, k, v, sd); return;
      }
      throw rtErr("цепочка '__newindex' слишком длинная (зацикливание?)");
    }
    function $S(o, k, v, sd){
      if (o instanceof LT) { if (o.mt === undefined) o.set(k, v); else setMeta(o, k, v, sd); return; }
      if (o !== null && typeof o === 'object') { hostSet(o, k, v); return; }
      const e = rtErr('попытка записать ' + keyDesc(k) + ' в ' + tnr(o)); e.site = sd; throw e;
    }
    // ── вызовы (быстрый путь function* — прямо в коде, сюда — остальное) ──
    function callErr(f, sd){ const e = rtErr('попытка вызвать ' + tnr(f)); e.site = sd; return e; }
    function* hostCall(f, self, args){
      const n = args.length, ja = new Array(n);
      for (let i = 0; i < n; i++) ja[i] = toJS(args[i]);
      const r = f.apply(self, ja);
      if (r === undefined) return X;
      if (r === null) return [undefined];
      if (r instanceof Promise) return yield new Sus(1, r);   // WaitForChild, Event:Wait() — ждём сопрограммой
      return [fromJS(r)];
    }
    function* $C(f, args, sd){
      if (f instanceof GF) return yield* f(...args);
      if (typeof f === 'function') return yield* hostCall(f, undefined, args);
      const h = metaOf(f, '__call');
      if (h !== undefined) return yield* $C(h, [f, ...args], sd);
      throw callErr(f, sd);
    }
    function* $CM(o, f, k, args, sd){   // o:k(…), f не function*
      if (typeof f === 'function') {
        if (o instanceof LT || typeof o === 'string') return yield* hostCall(f, undefined, [o, ...args]);
        return yield* hostCall(f, o, args);
      }
      if (f === undefined || f === null) { const e = rtErr("попытка вызвать метод '" + k + "' — у " + (o instanceof LT ? 'таблицы' : typeof o === 'string' ? 'строки' : tnr(o)) + ' его нет'); e.site = sd; throw e; }
      return yield* $C(f, [o, ...args], sd);
    }
    function* $CD(o, f, args, sd){   // o.k(…): у объектов мира this = o
      if (typeof f === 'function' && !(f instanceof GF) && o !== null && typeof o === 'object' && !(o instanceof LT)) return yield* hostCall(f, o, args.length && args[0] === o ? args.slice(1) : args);
      return yield* $C(f, args, sd);
    }
    const asGF = f => f instanceof GF ? f : function* (...a) { return yield* $C(f, a); };
    // ── цикл for … in: быстрый путь для pairs/ipairs/таблицы, иначе — функция-итератор ──
    class It {
      constructor(f, s, c){ this.f = f; this.s = s; this.c = c; this.m = 0; this.t = null; this.i = 0; this.mi = undefined; }
      step(){
        const t = this.t;
        if (this.m === 1) {
          const a = t.arr;
          while (this.i < a.length) { const v = a[this.i++]; if (v !== undefined) return [this.i, v]; }
          if (this.mi === undefined) this.mi = t.hash.entries();
          const r = this.mi.next();
          return r.done ? null : r.value;
        }
        const i = ++this.i, v = t.get(i);
        return v === undefined ? null : [i, v];
      }
      *call(){
        const f = this.f;
        if (f === undefined || f === null) throw rtErr('цикл for … in: нужна функция-перебор (pairs(t), ipairs(t)) или таблица, а получено nil');
        const r = f instanceof GF ? yield* f(this.s, this.c) : yield* $C(f, [this.s, this.c]);
        const k = r[0];
        if (k === undefined || k === null) return null;
        this.c = k;
        return r;
      }
    }
    function $ITER(f, s, c){
      const it = new It(f, s, c);
      if (f === NEXT && s instanceof LT && c === undefined) { it.m = 1; it.t = s; }
      else if (f === INEXT && s instanceof LT && c === 0) { it.m = 2; it.t = s; }
      else if (f instanceof LT) {   // Luau: for k, v in t do
        const h = metaOf(f, '__iter');
        if (h !== undefined) { const r = runSync(h, [f]); return $ITER(r[0], r[1], r[2]); }
        if (metaOf(f, '__call') === undefined) { it.m = 1; it.t = f; }
      }
      return it;
    }
    function $N(v, what){ if (typeof v === 'number') return v; const n = typeof v === 'string' ? str2num(v) : undefined; if (n === undefined) throw rtErr("цикл for: " + what + ' должно быть числом, а получено ' + tnr(v)); return n; }
    const $ZS = () => rtErr('цикл for: шаг не может быть 0');
    // ── ошибки: строка Lua и уровень (error(msg, 2)) ──
    function jsErr(e){   // без регулярных выражений: у края стека они сами падают
      if (e instanceof LuaError) return e;
      const m = String(e && e.message !== undefined ? e.message : e);
      if ((e instanceof RangeError && m.indexOf('stack') >= 0) || m.indexOf('Stack overflow') >= 0 || m.indexOf('too much recursion') >= 0) return rtErr('переполнение стека — слишком глубокая рекурсия (функция вызывает сама себя без конца?)');
      return rtErr(m);
    }
    function trap(e, line, cn, ctx, sites){   // ловушка каждой функции Lua: первая ставит строку, уровень error() отсчитывается вверх
      if (!(e instanceof LuaError)) e = jsErr(e);
      if (e.site >= 0) { const d = sites[e.site]; if (d !== undefined && typeof e.value === 'string') e.value += ' (' + d + ')'; e.site = -1; }
      if (e.line === undefined) { e.line = line; e.ctx = ctx; }
      if (e.lvl > 0 && --e.lvl === 0 && typeof e.value === 'string') { e.value = cn + ':' + line + ': ' + e.value; e.pos = line; e.pctx = ctx; }
      return e;
    }
    const errValue = e => e instanceof LuaError ? e.value : jsErr(e).value;
    // ═══ Сопрограммы и планировщик (wait, task.*, события мира) ═══
    class Co { constructor(fn, ctx){ this.fn = fn; this.gen = null; this.status = 'suspended'; this.ctx = ctx; this.sus = null; this.killed = false; } }
    class Sus {   // «ждать»: kind 0 — секунды, 1 — обещание мира (Promise)
      constructor(kind, v){ this.kind = kind; this.v = v; }
      arm(co){
        const me = this;
        if (this.kind === 1) { this.v.then(r => wake(co, me, [fromJS(r)]), () => wake(co, me, [undefined])); return; }
        const t0 = now();
        setTimeout(() => wake(co, me, [(now() - t0) / 1000, clock()]), Math.max(0, this.v * 1000));
      }
    }
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
    const T0 = now();
    const clock = () => (now() - T0) / 1000;
    let CUR = null, CTX = null;
    function resume(co, args){   // → { ok, v } | { ok: false, e }
      const prev = CUR, pctx = CTX;
      if (prev) prev.status = 'normal';
      CUR = co; co.status = 'running'; co.sus = null; CTX = co.ctx;
      if (CTX && CTX.setCurrent) CTX.setCurrent(CTX.name);
      let r, err, bad = false;
      try { if (co.gen === null) { co.gen = co.fn(...args); r = co.gen.next(); } else r = co.gen.next(args); }
      catch (e) { err = e; bad = true; }
      CUR = prev; CTX = pctx;
      if (prev) prev.status = 'running';
      if (pctx && pctx.setCurrent) pctx.setCurrent(pctx.name);
      if (bad) { co.status = 'dead'; return { ok: false, e: err }; }
      if (r.done || co.killed) { co.status = 'dead'; return { ok: true, v: r.done ? r.value : X }; }
      co.status = 'suspended';
      if (r.value instanceof Sus) { co.sus = r.value; r.value.arm(co); return { ok: true, v: X }; }
      return { ok: true, v: r.value };
    }
    function report(e, co){
      e = jsErr(e);
      const ctx = e.pctx || e.ctx || (co && co.ctx);
      if (!ctx || !ctx.error) return;
      const line = e.pos || e.line || 0;
      let m = e.value;
      if (typeof m === 'string') { const pre = ctx.name + ':' + line + ': '; if (m.startsWith(pre)) m = m.slice(pre.length); }
      else if (typeof m === 'number') m = numStr(m);
      else { try { m = metaOf(m, '__tostring') !== undefined ? tostr(m) : '(ошибка — значение типа ' + tn(m) + ')'; } catch (e2) { m = '(ошибка)'; } }
      ctx.error(m, line);
    }
    function drive(co, args){ const r = resume(co, args); if (!r.ok) report(r.e, co); return r; }
    function wake(co, sus, vals){ if (co.status === 'suspended' && co.sus === sus) drive(co, vals); }
    function spawn(f, args, ctx){ const co = new Co(asGF(f), ctx || CTX); drive(co, args); return co; }
    // ── мост с миром (JS) ──
    const WR = new WeakMap(), UW = new WeakMap();   // функция Lua ↔ функция JS для мира
    function wrapFn(f){
      let w = WR.get(f);
      if (w) return w;
      const ctx = CTX;
      w = function (...a) { const args = new Array(a.length); for (let i = 0; i < a.length; i++) args[i] = fromJS(a[i]); spawn(f, args, ctx); };
      WR.set(f, w); UW.set(w, f);
      return w;
    }
    function fromJS(v){
      if (v === null || v === undefined) return undefined;
      const t = typeof v;
      if (t === 'object') {
        if (Array.isArray(v)) { const r = new LT(), a = r.arr; for (let i = 0; i < v.length; i++) a.push(fromJS(v[i])); while (a.length && a[a.length - 1] === undefined) a.pop(); return r; }
        return v;
      }
      if (t === 'function') return UW.get(v) || v;
      return v;
    }
    function toJS(v, d){
      if (v instanceof LT) return tabToJS(v, d | 0);
      if (v instanceof GF) return wrapFn(v);
      return v;
    }
    function tabToJS(t, d){   // таблица Lua → массив (1..n) или объект JS (копия)
      if (d > 30) return null;
      const a = t.arr;
      if (t.hash.size === 0 && a.length) { const out = new Array(a.length); for (let i = 0; i < a.length; i++) out[i] = toJS(a[i], d + 1); return out; }
      const o = {};
      for (let i = 0; i < a.length; i++) if (a[i] !== undefined) o[i + 1] = toJS(a[i], d + 1);
      for (const [k, v] of t.hash) if ((typeof k === 'string' && k !== '__proto__') || typeof k === 'number') o[k] = toJS(v, d + 1);
      return o;
    }

    // ═══ Проверка аргументов библиотек ═══
    const argErr = (i, fn, m) => rtErr('неверный аргумент №' + i + " для '" + fn + "' (" + m + ')');
    function chkNum(v, i, fn){ if (typeof v === 'number') return v; const n = typeof v === 'string' ? str2num(v) : undefined; if (n === undefined) throw argErr(i, fn, 'ожидалось число, а получено ' + tnr(v)); return n; }
    const chkInt = (v, i, fn) => { const n = chkNum(v, i, fn); return n !== n ? 0 : n >= 0 ? Math.floor(n) : Math.ceil(n); };
    const optInt = (v, i, fn, d) => v === undefined || v === null ? d : chkInt(v, i, fn);
    function chkStr(v, i, fn){ if (typeof v === 'string') return v; if (typeof v === 'number') return numStr(v); throw argErr(i, fn, 'ожидалась строка, а получено ' + tnr(v)); }
    function chkTab(v, i, fn){ if (v instanceof LT) return v; throw argErr(i, fn, 'ожидалась таблица, а получено ' + tnr(v)); }

    // ═══ Шаблоны Lua (перенос lstrlib.c 5.1): классы %a %d %l %s %u %w %x %p %c %g, [наборы], ^ $, захваты, (), %b, %f, %1 ═══
    class MS { constructor(s, p){ this.s = s; this.p = p; this.level = 0; this.cap = []; } }
    const isAl = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    function classMatch(c, cl){
      let r;
      switch (cl | 32) {
        case 97: r = isAl(c); break;
        case 99: r = c < 32 || c === 127; break;
        case 100: r = c >= 48 && c <= 57; break;
        case 103: r = c > 32 && c < 127; break;
        case 108: r = c >= 97 && c <= 122; break;
        case 112: r = (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126); break;
        case 115: r = c === 32 || (c >= 9 && c <= 13); break;
        case 117: r = c >= 65 && c <= 90; break;
        case 119: r = isAl(c) || (c >= 48 && c <= 57); break;
        case 120: r = (c >= 48 && c <= 57) || ((c | 32) >= 97 && (c | 32) <= 102 && c < 128); break;
        case 122: r = c === 0; break;
        default: return cl === c;
      }
      return cl >= 65 && cl <= 90 ? !r : r;
    }
    function classEnd(ms, p){
      const P = ms.p, n = P.length, c = P.charCodeAt(p++);
      if (c === 37) { if (p >= n) throw rtErr("неверный шаблон (заканчивается на '%')"); return p + 1; }
      if (c === 91) {
        if (P.charCodeAt(p) === 94) p++;
        do {
          if (p >= n) throw rtErr("неверный шаблон (нет закрывающей ']')");
          const cc = P.charCodeAt(p++);
          if (cc === 37 && p < n) p++;
        } while (P.charCodeAt(p) !== 93);
        return p + 1;
      }
      return p;
    }
    function matchBracket(ms, c, p, ec){
      const P = ms.p;
      let sig = true;
      if (P.charCodeAt(p + 1) === 94) { sig = false; p++; }
      while (++p < ec) {
        const pc = P.charCodeAt(p);
        if (pc === 37) { p++; if (classMatch(c, P.charCodeAt(p))) return sig; }
        else if (P.charCodeAt(p + 1) === 45 && p + 2 < ec) { p += 2; if (pc <= c && c <= P.charCodeAt(p)) return sig; }
        else if (pc === c) return sig;
      }
      return !sig;
    }
    function single(ms, si, p, ep){
      if (si >= ms.s.length) return false;
      const c = ms.s.charCodeAt(si), pc = ms.p.charCodeAt(p);
      if (pc === 46) return true;
      if (pc === 37) return classMatch(c, ms.p.charCodeAt(p + 1));
      if (pc === 91) return matchBracket(ms, c, p, ep - 1);
      return pc === c;
    }
    function match(ms, si, p){   // → конец находки или -1
      const S = ms.s, P = ms.p, pn = P.length;
      for (;;) {
        if (p >= pn) return si;
        const pc = P.charCodeAt(p);
        if (pc === 40) return P.charCodeAt(p + 1) === 41 ? startCap(ms, si, p + 2, -2) : startCap(ms, si, p + 1, -1);
        if (pc === 41) return endCap(ms, si, p + 1);
        if (pc === 37) {
          const nc = P.charCodeAt(p + 1);
          if (nc === 98) { si = matchBalance(ms, si, p + 2); if (si < 0) return -1; p += 4; continue; }
          if (nc === 102) {
            p += 2;
            if (P.charCodeAt(p) !== 91) throw rtErr("в шаблоне после %f нужна '['");
            const ep = classEnd(ms, p), prev = si === 0 ? 0 : S.charCodeAt(si - 1), cur = si < S.length ? S.charCodeAt(si) : 0;
            if (matchBracket(ms, prev, p, ep - 1) || !matchBracket(ms, cur, p, ep - 1)) return -1;
            p = ep; continue;
          }
          if (nc >= 48 && nc <= 57) { si = matchCapture(ms, si, nc); if (si < 0) return -1; p += 2; continue; }
        } else if (pc === 36 && p + 1 === pn) return si === S.length ? si : -1;
        const ep = classEnd(ms, p), m = single(ms, si, p, ep), q = P.charCodeAt(ep);
        if (q === 63) { if (m) { const r = match(ms, si + 1, ep + 1); if (r >= 0) return r; } p = ep + 1; continue; }
        if (q === 42) return maxExpand(ms, si, p, ep);
        if (q === 43) return m ? maxExpand(ms, si + 1, p, ep) : -1;
        if (q === 45) return minExpand(ms, si, p, ep);
        if (!m) return -1;
        si++; p = ep;
      }
    }
    function maxExpand(ms, si, p, ep){
      let i = 0;
      while (single(ms, si + i, p, ep)) i++;
      for (; i >= 0; i--) { const r = match(ms, si + i, ep + 1); if (r >= 0) return r; }
      return -1;
    }
    function minExpand(ms, si, p, ep){
      for (;;) {
        const r = match(ms, si, ep + 1);
        if (r >= 0) return r;
        if (single(ms, si, p, ep)) si++; else return -1;
      }
    }
    function startCap(ms, si, p, what){
      const lv = ms.level;
      if (lv >= 32) throw rtErr('слишком много захватов в шаблоне');
      ms.cap[lv] = { init: si, len: what };
      ms.level = lv + 1;
      const r = match(ms, si, p);
      if (r < 0) ms.level--;
      return r;
    }
    function endCap(ms, si, p){
      let l = -1;
      for (let lv = ms.level - 1; lv >= 0; lv--) if (ms.cap[lv].len === -1) { l = lv; break; }
      if (l < 0) throw rtErr('неверный шаблон: лишняя ")"');
      ms.cap[l].len = si - ms.cap[l].init;
      const r = match(ms, si, p);
      if (r < 0) ms.cap[l].len = -1;
      return r;
    }
    function matchBalance(ms, si, p){
      const P = ms.p, S = ms.s;
      if (p + 1 >= P.length) throw rtErr('неверный шаблон: после %b нужны два символа, например %b()');
      if (si >= S.length || S.charCodeAt(si) !== P.charCodeAt(p)) return -1;
      const b = P.charCodeAt(p), e = P.charCodeAt(p + 1);
      let cont = 1;
      while (++si < S.length) {
        const c = S.charCodeAt(si);
        if (c === e) { if (--cont === 0) return si + 1; }
        else if (c === b) cont++;
      }
      return -1;
    }
    function matchCapture(ms, si, l){
      l -= 49;
      if (l < 0 || l >= ms.level || ms.cap[l].len === -1) throw rtErr('неверный номер захвата %' + (l + 1) + ' в шаблоне');
      const c = ms.cap[l], len = c.len;
      return len >= 0 && ms.s.length - si >= len && ms.s.substr(c.init, len) === ms.s.substr(si, len) ? si + len : -1;
    }
    function oneCap(ms, i, s, e){
      if (i >= ms.level) { if (i === 0) return ms.s.slice(s, e); throw rtErr('неверный номер захвата %' + (i + 1)); }
      const c = ms.cap[i];
      if (c.len === -1) throw rtErr('незакрытый захват "(" в шаблоне');
      return c.len === -2 ? c.init + 1 : ms.s.substr(c.init, c.len);
    }
    function caps(ms, s, e, whole){ const n = ms.level === 0 && whole ? 1 : ms.level, out = new Array(n); for (let i = 0; i < n; i++) out[i] = oneCap(ms, i, s, e); return out; }
    const SPECIALS = /[\^$*+?.(\[%-]/;
    function strFind(s, p, init, plain, find){
      const fn = find ? 'find' : 'match';
      s = chkStr(s, 1, fn); p = chkStr(p, 2, fn);
      const ls = s.length;
      let i = optInt(init, 3, fn, 1);
      if (i < 0) { i = ls + i + 1; if (i < 1) i = 1; } else if (i === 0) i = 1;
      if (i > ls + 1) return [undefined];
      if (find && ($B(plain) || !SPECIALS.test(p))) { const k = s.indexOf(p, i - 1); return k < 0 ? [undefined] : [k + 1, k + p.length]; }
      const ms = new MS(s, p), anchor = p.charCodeAt(0) === 94, p0 = anchor ? 1 : 0;
      let si = i - 1;
      do {
        ms.level = 0;
        const e = match(ms, si, p0);
        if (e >= 0) return find ? [si + 1, e, ...caps(ms, si, e, false)] : caps(ms, si, e, true);
        si++;
      } while (si <= ls && !anchor);
      return [undefined];
    }
    function addS(ms, r, s, e){   // замена-строка в gsub: %0…%9, %%
      if (r.indexOf('%') < 0) return r;
      let out = '';
      for (let i = 0; i < r.length; i++) {
        if (r.charCodeAt(i) !== 37) { out += r[i]; continue; }
        i++;
        const d = r.charCodeAt(i);
        if (d >= 48 && d <= 57) { const v = d === 48 ? ms.s.slice(s, e) : oneCap(ms, d - 49, s, e); out += typeof v === 'number' ? numStr(v) : v; }
        else if (i < r.length) out += r[i];
      }
      return out;
    }
    // ═══ string.format ═══
    const intDigits = (v, b) => v < 9007199254740992 ? v.toString(b) : BigInt(v).toString(b);
    function fmtE(v, p, alt){
      if (!isFinite(v)) return v !== v ? 'nan' : 'inf';
      const s = v.toExponential(p), k = s.indexOf('e'), xp = +s.slice(k + 1), ax = Math.abs(xp);
      return s.slice(0, k) + (alt && p === 0 ? '.' : '') + 'e' + (xp < 0 ? '-' : '+') + (ax < 10 ? '0' : '') + ax;
    }
    function fmtF(v, p, alt){
      if (!isFinite(v)) return v !== v ? 'nan' : 'inf';
      const s = v >= 1e21 ? BigInt(v).toString() + (p > 0 ? '.' + '0'.repeat(p) : '') : v.toFixed(p);
      return alt && p === 0 ? s + '.' : s;
    }
    function quoteStr(s){
      let out = '"';
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        out += c === 34 ? '\\"' : c === 92 ? '\\\\' : c === 10 ? '\\\n' : c === 13 ? '\\r' : c === 0 ? '\\000' : s[i];
      }
      return out + '"';
    }
    function* format_(fmt, ...args){
      fmt = chkStr(fmt, 1, 'format');
      let out = '', ai = 0, i = 0;
      const n = fmt.length;
      while (i < n) {
        const pc = fmt.indexOf('%', i);
        if (pc < 0) { out += fmt.slice(i); break; }
        out += fmt.slice(i, pc);
        i = pc + 1;
        if (fmt[i] === '%') { out += '%'; i++; continue; }
        const m = /^([-+ #0]*)(\d*)(?:\.(\d*))?([a-zA-Z*]?)/.exec(fmt.slice(i, i + 16));
        const flags = m[1], conv = m[4];
        if (!conv) throw rtErr("string.format: неверный формат '%" + fmt.slice(i, i + 3) + "'");
        if (m[2].length > 2 || (m[3] && m[3].length > 2)) throw rtErr('string.format: слишком большая ширина или точность');
        i += m[0].length;
        const w = m[2] ? +m[2] : 0, p = m[3] === undefined ? -1 : +m[3];
        ai++;
        if (ai > args.length) throw argErr(ai + 1, 'format', 'нет значения');
        const a = args[ai - 1];
        let body, pre = '', num = false, zok = true;
        switch (conv) {
          case 'd': case 'i': case 'u': {
            let v = chkNum(a, ai + 1, 'format');
            if (!isFinite(v)) { body = v !== v ? 'nan' : 'inf'; num = true; zok = false; if (v < 0) pre = '-'; break; }
            v = Math.trunc(v);
            if (conv === 'u' && v < 0) body = BigInt.asUintN(64, BigInt(v)).toString();
            else { body = intDigits(Math.abs(v), 10); if (v < 0) pre = '-'; }
            if (p >= 0) { body = p === 0 && v === 0 ? '' : body.padStart(p, '0'); zok = false; }
            num = true; break;
          }
          case 'x': case 'X': case 'o': {
            const v = Math.trunc(chkNum(a, ai + 1, 'format')), b = conv === 'o' ? 8 : 16;
            body = v < 0 ? BigInt.asUintN(64, BigInt(v)).toString(b) : intDigits(v, b);
            if (p >= 0) { body = p === 0 && v === 0 ? '' : body.padStart(p, '0'); zok = false; }
            if (flags.indexOf('#') >= 0 && v !== 0) { if (b === 8) body = '0' + body; else pre = '0x'; }
            if (conv === 'X') { body = body.toUpperCase(); pre = pre.toUpperCase(); }
            num = true; break;
          }
          case 'c': body = String.fromCharCode(chkInt(a, ai + 1, 'format')); break;
          case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': {
            const v = chkNum(a, ai + 1, 'format'), alt = flags.indexOf('#') >= 0, av = Math.abs(v), lc = conv.toLowerCase();
            body = lc === 'e' ? fmtE(av, p < 0 ? 6 : p, alt) : lc === 'f' ? fmtF(av, p < 0 ? 6 : p, alt) : fmtG(av, p < 0 ? 6 : p, alt);
            if (conv !== lc) body = body.toUpperCase();
            if (v < 0 || Object.is(v, -0)) pre = '-';
            if (!isFinite(v)) zok = false;
            num = true; break;
          }
          case 'q': body = quoteStr(chkStr(a, ai + 1, 'format')); break;
          case 's': body = tostr(a); if (p >= 0) body = body.slice(0, p); break;
          case '*': body = tostr(a); break;
          default: throw rtErr("string.format: неверный формат '%" + conv + "'");
        }
        if (num && pre === '' && conv !== 'x' && conv !== 'X' && conv !== 'o' && conv !== 'u') pre = flags.indexOf('+') >= 0 ? '+' : flags.indexOf(' ') >= 0 ? ' ' : '';
        let s;
        if (flags.indexOf('-') >= 0) s = (pre + body).padEnd(w);
        else if (num && zok && flags.indexOf('0') >= 0) s = pre + body.padStart(w - pre.length, '0');
        else s = (pre + body).padStart(w);
        out += s;
      }
      return [out];
    }
    // ═══ Библиотека string (и методы строк: ("x"):upper()) ═══
    function strLib(){
      const L = {
        len: function* (s) { return [chkStr(s, 1, 'len').length]; },
        sub: function* (s, i, j) {
          s = chkStr(s, 1, 'sub');
          const l = s.length;
          let a = optInt(i, 2, 'sub', 1), b = optInt(j, 3, 'sub', -1);
          if (a < 0) a = Math.max(l + a + 1, 1); else if (a === 0) a = 1;
          if (b < 0) b = l + b + 1; else if (b > l) b = l;
          return [a <= b ? s.slice(a - 1, b) : ''];
        },
        upper: function* (s) { return [chkStr(s, 1, 'upper').toUpperCase()]; },
        lower: function* (s) { return [chkStr(s, 1, 'lower').toLowerCase()]; },
        rep: function* (s, n, sep) {
          s = chkStr(s, 1, 'rep'); n = chkInt(n, 2, 'rep'); sep = sep === undefined ? '' : chkStr(sep, 3, 'rep');
          if (n <= 0) return [''];
          if ((s.length + sep.length) * n > 5e7) throw rtErr('string.rep: слишком длинная строка');
          return [sep ? new Array(n).fill(s).join(sep) : s.repeat(n)];
        },
        reverse: function* (s) { return [Array.from(chkStr(s, 1, 'reverse')).reverse().join('')]; },
        byte: function* (s, i, j) {
          s = chkStr(s, 1, 'byte');
          const l = s.length;
          let a = optInt(i, 2, 'byte', 1);
          let b = j === undefined ? a : chkInt(j, 3, 'byte');
          if (a < 0) a = l + a + 1; if (b < 0) b = l + b + 1;
          if (a < 1) a = 1; if (b > l) b = l;
          const out = [];
          for (let k = a; k <= b; k++) out.push(s.charCodeAt(k - 1));
          return out;
        },
        char: function* (...a) {
          let s = '';
          for (let k = 0; k < a.length; k++) { const c = chkInt(a[k], k + 1, 'char'); if (c < 0 || c > 0x10ffff) throw argErr(k + 1, 'char', 'код вне диапазона'); s += String.fromCodePoint(c); }
          return [s];
        },
        format: format_,
        find: function* (s, p, i, plain) { return strFind(s, p, i, plain, true); },
        match: function* (s, p, i) { return strFind(s, p, i, false, false); },
        gmatch: function* (s, p) {
          s = chkStr(s, 1, 'gmatch'); p = chkStr(p, 2, 'gmatch');
          const ms = new MS(s, p);
          let si = 0;
          return [function* () {
            while (si <= s.length) {
              ms.level = 0;
              const e = match(ms, si, 0);
              if (e >= 0) { const st = si; si = e === si ? e + 1 : e; return caps(ms, st, e, true); }
              si++;
            }
            return [undefined];
          }];
        },
        gsub: function* (s, p, repl, maxN) {
          s = chkStr(s, 1, 'gsub'); p = chkStr(p, 2, 'gsub');
          const tr = typeof repl;
          if (!(tr === 'string' || tr === 'number' || tr === 'function' || repl instanceof LT)) throw argErr(3, 'gsub', 'ожидалась строка, таблица или функция, а получено ' + tnr(repl));
          const max = optInt(maxN, 4, 'gsub', s.length + 1), anchor = p.charCodeAt(0) === 94, p0 = anchor ? 1 : 0, ms = new MS(s, p);
          const rs = tr === 'number' ? numStr(repl) : repl;
          let si = 0, n = 0, out = '';
          while (n < max) {
            ms.level = 0;
            const e = match(ms, si, p0);
            if (e >= 0) {
              n++;
              let v;
              if (typeof rs === 'string') v = addS(ms, rs, si, e);
              else {
                if (rs instanceof LT) v = $I(rs, oneCap(ms, 0, si, e));
                else { const a = caps(ms, si, e, true); v = (rs instanceof GF ? yield* rs(...a) : yield* $C(rs, a))[0]; }
                if (v === undefined || v === null || v === false) v = s.slice(si, e);
                else if (typeof v === 'number') v = numStr(v);
                else if (typeof v !== 'string') throw rtErr('gsub: неверное значение для замены (' + tnr(v) + ')');
              }
              out += v;
            }
            if (e >= 0 && e > si) si = e;
            else if (si < s.length) out += s[si++];
            else break;
            if (anchor) break;
          }
          return [out + s.slice(si), n];
        },
        split: function* (s, sep) {
          s = chkStr(s, 1, 'split'); sep = sep === undefined ? ',' : chkStr(sep, 2, 'split');
          const t = new LT();
          t.arr = sep === '' ? s.split('') : s.split(sep);
          return [t];
        },
      };
      return tab(L);
    }
    // ── Color3 в мире — строка '#rrggbb': c.R / c.G / c.B и методы ──
    const HEXC = /^#[0-9a-f]{6}$/i;
    const C3M = {
      Lerp: function* (a, b, k) { const pa = parseInt(a.slice(1), 16), pb = parseInt(String(b).slice(1), 16), t = chkNum(k, 2, 'Lerp'), c = s => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t); return ['#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1)]; },
      ToHex: function* (a) { return [a.slice(1).toLowerCase()]; },
      ToHSV: function* (a) {
        const v = parseInt(a.slice(1), 16), r = (v >> 16 & 255) / 255, g = (v >> 8 & 255) / 255, b = (v & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d) h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return [h / 6, mx ? d / mx : 0, mx];
      },
    };
    function strIndex(s, k){
      const f = STR.get(k);
      if (f !== undefined) return f;
      if (typeof k === 'string' && s.length === 7 && s.charCodeAt(0) === 35 && HEXC.test(s)) {
        const v = parseInt(s.slice(1), 16);
        if (k === 'R') return (v >> 16 & 255) / 255;
        if (k === 'G') return (v >> 8 & 255) / 255;
        if (k === 'B') return (v & 255) / 255;
        return Object.prototype.hasOwnProperty.call(C3M, k) ? C3M[k] : undefined;
      }
      return undefined;
    }

    // ═══ Библиотека table ═══
    function* unpack_(t, i, j){
      chkTab(t, 1, 'unpack');
      const a = optInt(i, 2, 'unpack', 1), b = optInt(j, 3, 'unpack', t.arr.length);
      if (a > b) return X;
      if (b - a >= 1e6) throw rtErr('unpack: слишком много значений');
      const out = new Array(b - a + 1);
      for (let k = a; k <= b; k++) out[k - a] = t.get(k);
      return out;
    }
    function* msort(a, comp){   // слиянием (устойчиво); сравнение — функция Lua, в ней можно даже ждать
      const n = a.length;
      if (n < 2) return;
      const buf = new Array(n);
      for (let w = 1; w < n; w *= 2) {
        for (let lo = 0; lo < n - w; lo += 2 * w) {
          const mid = lo + w, hi = Math.min(lo + 2 * w, n);
          let i = lo, j = mid, k = lo;
          while (i < mid && j < hi) {
            let less;
            if (comp === undefined) less = $LT(a[j], a[i]);
            else less = $B((comp instanceof GF ? yield* comp(a[j], a[i]) : yield* $C(comp, [a[j], a[i]]))[0]);
            buf[k++] = less ? a[j++] : a[i++];
          }
          while (i < mid) buf[k++] = a[i++];
          while (j < hi) buf[k++] = a[j++];
          for (k = lo; k < hi; k++) a[k] = buf[k];
        }
      }
    }
    const roErr = () => rtErr('попытка изменить таблицу только для чтения (table.freeze)');
    function tableLib(){
      return tab({
        insert: function* (t, ...a) {
          chkTab(t, 1, 'insert');
          const n = t.arr.length;
          if (a.length === 1) { t.set(n + 1, a[0]); return X; }
          if (a.length !== 2) throw rtErr('table.insert: нужно 2 или 3 аргумента');
          const pos = chkInt(a[0], 2, 'insert');
          if (pos < 1 || pos > n + 1) throw argErr(2, 'insert', 'позиция вне диапазона 1…' + (n + 1));
          if (a[1] !== undefined && !t.ro) { t.arr.splice(pos - 1, 0, a[1]); if (t.hash.size) t.fix(); return X; }
          for (let i = n; i >= pos; i--) t.set(i + 1, t.get(i));
          t.set(pos, a[1]);
          return X;
        },
        remove: function* (t, pos) {
          chkTab(t, 1, 'remove');
          const n = t.arr.length;
          if (pos === undefined) { if (!n) return X; const v = t.arr[n - 1]; t.set(n, undefined); return [v]; }
          const p = chkInt(pos, 2, 'remove');
          if (p < 1 || p > n) return X;
          if (t.ro) throw roErr();
          const v = t.arr[p - 1];
          t.arr.splice(p - 1, 1);
          while (t.arr.length && t.arr[t.arr.length - 1] === undefined) t.arr.pop();
          return [v];
        },
        concat: function* (t, sep, i, j) {
          chkTab(t, 1, 'concat');
          sep = sep === undefined ? '' : chkStr(sep, 2, 'concat');
          const a = optInt(i, 3, 'concat', 1), b = optInt(j, 4, 'concat', t.arr.length), parts = [];
          for (let k = a; k <= b; k++) {
            const v = t.get(k);
            if (typeof v === 'string') parts.push(v);
            else if (typeof v === 'number') parts.push(numStr(v));
            else throw rtErr('table.concat: под номером ' + k + ' — ' + tnr(v) + ' (нужны строки или числа)');
          }
          return [parts.join(sep)];
        },
        sort: function* (t, comp) {
          chkTab(t, 1, 'sort');
          if (comp !== undefined && typeof comp !== 'function' && !(comp instanceof LT)) throw argErr(2, 'sort', 'ожидалась функция сравнения');
          const a = t.arr.slice();
          if (comp === undefined) {
            let num = true, str = true;
            for (let i = 0; i < a.length; i++) { const v = a[i]; if (typeof v !== 'number') num = false; if (typeof v !== 'string') str = false; }
            if (num) a.sort((x, y) => x - y);
            else if (str) a.sort((x, y) => x < y ? -1 : x > y ? 1 : 0);
            else yield* msort(a, undefined);
          } else yield* msort(a, comp);
          if (t.ro) throw roErr();
          for (let k = 0; k < a.length && k < t.arr.length; k++) t.arr[k] = a[k];
          return X;
        },
        unpack: unpack_,
        pack: function* (...a) { const t = new LT(), n = a.length; while (a.length && a[a.length - 1] === undefined) a.pop(); t.arr = a; t.hash.set('n', n); return [t]; },
        find: function* (t, v, init) { chkTab(t, 1, 'find'); for (let i = optInt(init, 3, 'find', 1); i >= 1; i++) { const x = t.get(i); if (x === undefined) break; if (x === v) return [i]; } return [undefined]; },
        clear: function* (t) { chkTab(t, 1, 'clear'); if (t.ro) throw roErr(); t.arr = []; t.hash.clear(); t.nk = t.ni = undefined; return X; },
        clone: function* (t) { chkTab(t, 1, 'clone'); const c = new LT(); c.arr = t.arr.slice(); c.hash = new Map(t.hash); c.mt = t.mt; return [c]; },
        create: function* (n, v) { n = chkInt(n, 1, 'create'); if (n < 0 || n > 1e7) throw argErr(1, 'create', 'размер вне диапазона'); const t = new LT(); if (v !== undefined) t.arr = new Array(n).fill(v); return [t]; },
        move: function* (a1, f, e, tp, a2) {
          chkTab(a1, 1, 'move'); f = chkInt(f, 2, 'move'); e = chkInt(e, 3, 'move'); tp = chkInt(tp, 4, 'move');
          const d = a2 === undefined ? a1 : chkTab(a2, 5, 'move');
          if (e >= f) {
            if (tp > e || tp <= f || d !== a1) for (let i = 0; i <= e - f; i++) d.set(tp + i, a1.get(f + i));
            else for (let i = e - f; i >= 0; i--) d.set(tp + i, a1.get(f + i));
          }
          return [d];
        },
        maxn: function* (t) { chkTab(t, 1, 'maxn'); let m = t.arr.length; for (const k of t.hash.keys()) if (typeof k === 'number' && k > m) m = k; return [m]; },
        getn: function* (t) { return [chkTab(t, 1, 'getn').arr.length]; },
        freeze: function* (t) { chkTab(t, 1, 'freeze').ro = true; return [t]; },
        isfrozen: function* (t) { return [chkTab(t, 1, 'isfrozen').ro]; },
        foreach: function* (t, f) { const it = $ITER(NEXT, chkTab(t, 1, 'foreach'), undefined); for (let r; (r = it.step()) !== null;) { const x = yield* $C(f, r); if (x[0] !== undefined) return [x[0]]; } return X; },
        foreachi: function* (t, f) { chkTab(t, 1, 'foreachi'); for (let i = 1; i <= t.arr.length; i++) { const x = yield* $C(f, [i, t.get(i)]); if (x[0] !== undefined) return [x[0]]; } return X; },
      });
    }
    // ═══ Библиотека math (+ clamp, sign, round, noise, lerp из Luau) ═══
    function mulberry(seed){
      let s = seed >>> 0;
      const f = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      f.state = () => s;
      return f;
    }
    let RNG = Math.random;
    function rnd(r, a, b, fn){
      if (a === undefined) return r();
      let lo = 1, hi;
      if (b === undefined) hi = chkInt(a, 1, fn); else { lo = chkInt(a, 1, fn); hi = chkInt(b, 2, fn); }
      if (lo > hi) throw argErr(b === undefined ? 1 : 2, fn, 'пустой интервал');
      return lo + Math.floor(r() * (hi - lo + 1));
    }
    const PERM = (() => { const r = mulberry(37), p = []; for (let i = 0; i < 256; i++) p.push(i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)), x = p[i]; p[i] = p[j]; p[j] = x; } return p.concat(p); })();
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10), mix = (t, a, b) => a + t * (b - a);
    function grad(h, x, y, z){ h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); }
    function noise3(x, y, z){   // шум Перлина: 0 в целых точках, примерно −1…1
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255, zi = Math.floor(z) & 255, P = PERM;
      x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
      const u = fade(x), v = fade(y), w = fade(z);
      const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
      return mix(w, mix(v, mix(u, grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z)), mix(u, grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z))),
        mix(v, mix(u, grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1)), mix(u, grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1))));
    }
    function mathLib(){
      const M = Math, n1 = (f, fn) => function* (x) { return [f(chkNum(x, 1, fn))]; };
      return tab({
        abs: n1(M.abs, 'abs'), ceil: n1(M.ceil, 'ceil'), floor: n1(M.floor, 'floor'), sqrt: n1(M.sqrt, 'sqrt'), sin: n1(M.sin, 'sin'), cos: n1(M.cos, 'cos'), tan: n1(M.tan, 'tan'),
        asin: n1(M.asin, 'asin'), acos: n1(M.acos, 'acos'), exp: n1(M.exp, 'exp'), log10: n1(M.log10, 'log10'), sinh: n1(M.sinh, 'sinh'), cosh: n1(M.cosh, 'cosh'), tanh: n1(M.tanh, 'tanh'),
        deg: n1(x => x * 180 / M.PI, 'deg'), rad: n1(x => x * M.PI / 180, 'rad'),
        atan: function* (y, x) { y = chkNum(y, 1, 'atan'); return [x === undefined ? M.atan(y) : M.atan2(y, chkNum(x, 2, 'atan'))]; },
        atan2: function* (y, x) { return [M.atan2(chkNum(y, 1, 'atan2'), chkNum(x, 2, 'atan2'))]; },
        log: function* (x, b) { x = chkNum(x, 1, 'log'); if (b === undefined) return [M.log(x)]; b = chkNum(b, 2, 'log'); return [b === 2 ? M.log2(x) : b === 10 ? M.log10(x) : M.log(x) / M.log(b)]; },
        pow: function* (x, y) { return [M.pow(chkNum(x, 1, 'pow'), chkNum(y, 2, 'pow'))]; },
        fmod: function* (a, b) { return [chkNum(a, 1, 'fmod') % chkNum(b, 2, 'fmod')]; },
        modf: function* (x) { x = chkNum(x, 1, 'modf'); if (!isFinite(x)) return [x, x !== x ? x : 0]; const i = x >= 0 ? M.floor(x) : M.ceil(x); return [i, x - i]; },
        frexp: function* (x) { x = chkNum(x, 1, 'frexp'); if (x === 0 || !isFinite(x)) return [x, 0]; let e = M.floor(M.log2(M.abs(x))) + 1, m = x / M.pow(2, e); if (M.abs(m) >= 1) { m /= 2; e++; } else if (M.abs(m) < 0.5) { m *= 2; e--; } return [m, e]; },
        ldexp: function* (m, e) { return [chkNum(m, 1, 'ldexp') * M.pow(2, chkInt(e, 2, 'ldexp'))]; },
        max: function* (...a) { if (!a.length) throw argErr(1, 'max', 'нужно хотя бы одно число'); let m = chkNum(a[0], 1, 'max'); for (let i = 1; i < a.length; i++) { const v = chkNum(a[i], i + 1, 'max'); if (v > m) m = v; } return [m]; },
        min: function* (...a) { if (!a.length) throw argErr(1, 'min', 'нужно хотя бы одно число'); let m = chkNum(a[0], 1, 'min'); for (let i = 1; i < a.length; i++) { const v = chkNum(a[i], i + 1, 'min'); if (v < m) m = v; } return [m]; },
        random: function* (a, b) { return [rnd(RNG, a, b, 'random')]; },
        randomseed: function* (s) { RNG = mulberry(chkInt(s, 1, 'randomseed')); return X; },
        clamp: function* (x, lo, hi) { x = chkNum(x, 1, 'clamp'); lo = chkNum(lo, 2, 'clamp'); hi = chkNum(hi, 3, 'clamp'); if (lo > hi) throw argErr(3, 'clamp', 'max меньше min'); return [x < lo ? lo : x > hi ? hi : x]; },
        sign: function* (x) { x = chkNum(x, 1, 'sign'); return [x > 0 ? 1 : x < 0 ? -1 : 0]; },
        round: function* (x) { x = chkNum(x, 1, 'round'); return [x < 0 ? -M.round(-x) : M.round(x)]; },
        noise: function* (x, y, z) { return [noise3(chkNum(x, 1, 'noise'), y === undefined ? 0 : chkNum(y, 2, 'noise'), z === undefined ? 0 : chkNum(z, 3, 'noise'))]; },
        lerp: function* (a, b, t) { a = chkNum(a, 1, 'lerp'); b = chkNum(b, 2, 'lerp'); t = chkNum(t, 3, 'lerp'); return [t === 1 ? b : a + (b - a) * t]; },
        map: function* (x, a, b, c, d) { x = chkNum(x, 1, 'map'); a = chkNum(a, 2, 'map'); b = chkNum(b, 3, 'map'); c = chkNum(c, 4, 'map'); d = chkNum(d, 5, 'map'); return [c + (x - a) * (d - c) / (b - a)]; },
        huge: Infinity, pi: M.PI,
      });
    }
    // ═══ os ═══
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function osLib(){
      return tab({
        time: function* (t) {
          if (t === undefined) return [Math.floor(Date.now() / 1000)];
          chkTab(t, 1, 'time');
          const g = (k, d) => { const v = t.get(k); if (v === undefined) { if (d === undefined) throw rtErr("os.time: в таблице нет поля '" + k + "'"); return d; } return chkInt(v, 1, 'time'); };
          return [Math.floor(new Date(g('year'), g('month') - 1, g('day'), g('hour', 12), g('min', 0), g('sec', 0)).getTime() / 1000)];
        },
        clock: function* () { return [clock()]; },
        difftime: function* (a, b) { return [chkNum(a, 1, 'difftime') - (b === undefined ? 0 : chkNum(b, 2, 'difftime'))]; },
        date: function* (fmt, t) {
          fmt = fmt === undefined ? '%c' : chkStr(fmt, 1, 'date');
          const d = new Date(t === undefined ? Date.now() : chkNum(t, 2, 'date') * 1000);
          const u = fmt[0] === '!';
          if (u) fmt = fmt.slice(1);
          const Y = u ? d.getUTCFullYear() : d.getFullYear(), Mo = u ? d.getUTCMonth() : d.getMonth(), D = u ? d.getUTCDate() : d.getDate(), h = u ? d.getUTCHours() : d.getHours(), mi = u ? d.getUTCMinutes() : d.getMinutes(), s = u ? d.getUTCSeconds() : d.getSeconds(), wd = u ? d.getUTCDay() : d.getDay();
          const yd = Math.round((Date.UTC(Y, Mo, D) - Date.UTC(Y, 0, 1)) / 864e5) + 1;
          if (fmt.startsWith('*t')) return [tab({ year: Y, month: Mo + 1, day: D, hour: h, min: mi, sec: s, wday: wd + 1, yday: yd, isdst: false })];
          const p2 = v => String(v).padStart(2, '0');
          const mp = { a: DAYS[wd].slice(0, 3), A: DAYS[wd], b: MONTHS[Mo].slice(0, 3), B: MONTHS[Mo], d: p2(D), H: p2(h), I: p2(h % 12 || 12), j: String(yd).padStart(3, '0'), m: p2(Mo + 1), M: p2(mi), p: h < 12 ? 'AM' : 'PM', S: p2(s), w: String(wd), y: p2(Y % 100), Y: String(Y), '%': '%' };
          mp.c = mp.a + ' ' + mp.b + ' ' + String(D).padStart(2, ' ') + ' ' + mp.H + ':' + mp.M + ':' + mp.S + ' ' + Y;
          mp.x = mp.m + '/' + mp.d + '/' + mp.y; mp.X = mp.H + ':' + mp.M + ':' + mp.S;
          return [fmt.replace(/%(.)/g, (m0, c) => Object.prototype.hasOwnProperty.call(mp, c) ? mp[c] : m0)];
        },
      });
    }
    // ═══ coroutine и task (планировщик — выше) ═══
    function coLib(){
      const isCo = (co, fn) => { if (!(co instanceof Co)) throw argErr(1, fn, 'ожидалась сопрограмма, а получено ' + tnr(co)); return co; };
      return tab({
        create: function* (f) { if (typeof f !== 'function') throw argErr(1, 'create', 'ожидалась функция'); return [new Co(asGF(f), CTX)]; },
        resume: function* (co, ...a) {
          isCo(co, 'resume');
          if (co.status === 'dead') return [false, 'нельзя продолжить завершённую сопрограмму'];
          if (co.status !== 'suspended') return [false, 'нельзя продолжить сопрограмму, которая уже работает'];
          const r = resume(co, a);
          return r.ok ? [true, ...r.v] : [false, errValue(r.e)];
        },
        yield: function* (...a) { return yield a; },
        status: function* (co) { return [isCo(co, 'status').status]; },
        running: function* () { return [CUR === null ? undefined : CUR]; },
        isyieldable: function* () { return [CUR !== null && SYNC === 0]; },
        wrap: function* (f) {
          if (typeof f !== 'function') throw argErr(1, 'wrap', 'ожидалась функция');
          const co = new Co(asGF(f), CTX);
          return [function* (...a) {
            if (co.status === 'dead') throw rtErr('нельзя продолжить завершённую сопрограмму');
            if (co.status !== 'suspended') throw rtErr('сопрограмма уже работает');
            const r = resume(co, a);
            if (!r.ok) { const e = jsErr(r.e); e.lvl = 0; throw e; }
            return r.v;
          }];
        },
        close: function* (co) {
          isCo(co, 'close');
          if (co.status === 'running' || co.status === 'normal') throw rtErr('нельзя закрыть работающую сопрограмму');
          co.status = 'dead'; co.killed = true; co.sus = null;
          try { if (co.gen) co.gen.return(); } catch (e) {}
          return [true];
        },
      });
    }
    function later(s, f, a){
      if (!(f instanceof Co) && typeof f !== 'function') throw rtErr('ожидалась функция');
      const co = f instanceof Co ? f : new Co(asGF(f), CTX);
      setTimeout(() => { if (co.status === 'suspended' && co.sus === null && !co.killed) drive(co, a); }, Math.max(0, s * 1000));
      return [co];
    }
    const waitSus = (s, min) => { const d = s === undefined || s === null ? 0 : chkNum(s, 1, 'wait'); return new Sus(0, d > min ? d : min); };
    function taskLib(){
      return tab({
        wait: function* (s) { return yield waitSus(s, 1 / 60); },
        spawn: function* (f, ...a) {
          if (f instanceof Co) { if (f.status === 'suspended') drive(f, a); return [f]; }
          if (typeof f !== 'function') throw argErr(1, 'spawn', 'ожидалась функция');
          return [spawn(f, a, CTX)];
        },
        defer: function* (f, ...a) { return later(0, f, a); },
        delay: function* (s, f, ...a) { return later(s === undefined ? 0 : chkNum(s, 1, 'delay'), f, a); },
        cancel: function* (co) {
          if (co instanceof Co && co.status !== 'dead') { co.killed = true; co.sus = null; if (co.status === 'suspended') { co.status = 'dead'; try { if (co.gen) co.gen.return(); } catch (e) {} } }
          return X;
        },
        synchronize: function* () { return X; },
        desynchronize: function* () { return X; },
      });
    }
    // ═══ utf8 (позиции — в символах JS, UTF-16), bit32, debug, Random ═══
    function utf8Lib(){
      const C = String.fromCharCode;
      const cont = (s, q) => { const c = s.charCodeAt(q); return c >= 0xdc00 && c <= 0xdfff; };
      return tab({
        char: function* (...a) { let s = ''; for (let i = 0; i < a.length; i++) { const c = chkInt(a[i], i + 1, 'char'); if (c < 0 || c > 0x10ffff) throw argErr(i + 1, 'char', 'код вне диапазона'); s += String.fromCodePoint(c); } return [s]; },
        charpattern: '[' + C(0) + '-' + C(0xdbff) + C(0xe000) + '-' + C(0xffff) + '][' + C(0xdc00) + '-' + C(0xdfff) + ']*',
        codepoint: function* (s, i, j) {
          s = chkStr(s, 1, 'codepoint');
          const l = s.length;
          let a = optInt(i, 2, 'codepoint', 1), b = j === undefined ? a : chkInt(j, 3, 'codepoint');
          if (a < 0) a = l + a + 1; if (b < 0) b = l + b + 1;
          if (a > b) return X;
          if (a < 1 || b > l) throw argErr(2, 'codepoint', 'позиция вне строки');
          const out = [];
          for (let k = a - 1; k < b;) { const cp = s.codePointAt(k); out.push(cp); k += cp > 0xffff ? 2 : 1; }
          return out;
        },
        len: function* (s, i, j) {
          s = chkStr(s, 1, 'len');
          const l = s.length;
          let a = optInt(i, 2, 'len', 1), b = optInt(j, 3, 'len', -1), n = 0;
          if (a < 0) a = Math.max(l + a + 1, 1); if (b < 0) b = l + b + 1;
          for (let k = a - 1; k < b;) { if (cont(s, k)) return [undefined, k + 1]; const c = s.charCodeAt(k); k += c >= 0xd800 && c <= 0xdbff && cont(s, k + 1) ? 2 : 1; n++; }
          return [n];
        },
        codes: function* (s) {
          s = chkStr(s, 1, 'codes');
          return [function* (str, i) {
            i = chkInt(i, 2, 'codes');
            if (i > 0) { const c = str.charCodeAt(i - 1); i += c >= 0xd800 && c <= 0xdbff && cont(str, i) ? 2 : 1; } else i = 1;
            return i > str.length ? [undefined] : [i, str.codePointAt(i - 1)];
          }, s, 0];
        },
        offset: function* (s, n, i) {
          s = chkStr(s, 1, 'offset'); n = chkInt(n, 2, 'offset');
          let k = optInt(i, 3, 'offset', n >= 0 ? 1 : s.length + 1) - 1;
          if (n > 0) { n--; while (n > 0 && k < s.length) { k += cont(s, k + 1) ? 2 : 1; n--; } return n === 0 && k <= s.length ? [k + 1] : [undefined]; }
          if (n < 0) { while (n < 0 && k > 0) { k--; if (cont(s, k) && k > 0) k--; n++; } return n === 0 ? [k + 1] : [undefined]; }
          while (k > 0 && cont(s, k)) k--;
          return [k + 1];
        },
      });
    }
    function bitLib(){
      const red = (f, init, fn) => function* (...a) { let r = init; for (let i = 0; i < a.length; i++) r = f(r, chkNum(a[i], i + 1, fn) >>> 0) >>> 0; return [r]; };
      const u = (v, i, fn) => chkNum(v, i, fn) >>> 0;
      const field = (f, w, fn) => { if (f < 0 || w <= 0 || f + w > 32) throw argErr(2, fn, 'поле вне битов 0…31'); return w === 32 ? 0xffffffff : ((1 << w) - 1) >>> 0; };
      return tab({
        band: red((a, b) => a & b, 0xffffffff, 'band'), bor: red((a, b) => a | b, 0, 'bor'), bxor: red((a, b) => a ^ b, 0, 'bxor'),
        btest: function* (...a) { let r = 0xffffffff; for (let i = 0; i < a.length; i++) r = (r & u(a[i], i + 1, 'btest')) >>> 0; return [r !== 0]; },
        bnot: function* (x) { return [(~u(x, 1, 'bnot')) >>> 0]; },
        lshift: function* (x, n) { x = u(x, 1, 'lshift'); n = chkInt(n, 2, 'lshift'); return [n <= -32 || n >= 32 ? 0 : n >= 0 ? (x << n) >>> 0 : x >>> -n]; },
        rshift: function* (x, n) { x = u(x, 1, 'rshift'); n = chkInt(n, 2, 'rshift'); return [n <= -32 || n >= 32 ? 0 : n >= 0 ? x >>> n : (x << -n) >>> 0]; },
        arshift: function* (x, n) { x = u(x, 1, 'arshift') | 0; n = chkInt(n, 2, 'arshift'); return [n >= 32 ? (x < 0 ? 0xffffffff : 0) : n >= 0 ? (x >> n) >>> 0 : n <= -32 ? 0 : (x << -n) >>> 0]; },
        lrotate: function* (x, n) { x = u(x, 1, 'lrotate'); n = chkInt(n, 2, 'lrotate') & 31; return [((x << n) | (x >>> (32 - n))) >>> 0]; },
        rrotate: function* (x, n) { x = u(x, 1, 'rrotate'); n = chkInt(n, 2, 'rrotate') & 31; return [((x >>> n) | (x << (32 - n))) >>> 0]; },
        extract: function* (x, f, w) { x = u(x, 1, 'extract'); f = chkInt(f, 2, 'extract'); w = optInt(w, 3, 'extract', 1); const m = field(f, w, 'extract'); return [((x >>> f) & m) >>> 0]; },
        replace: function* (x, v, f, w) { x = u(x, 1, 'replace'); v = u(v, 2, 'replace'); f = chkInt(f, 3, 'replace'); w = optInt(w, 4, 'replace', 1); const m = field(f, w, 'replace'); return [((x & ~(m << f)) | ((v & m) << f)) >>> 0]; },
        countlz: function* (x) { return [Math.clz32(u(x, 1, 'countlz'))]; },
        countrz: function* (x) { x = u(x, 1, 'countrz'); if (!x) return [32]; let n = 0; while (!(x & 1)) { x >>>= 1; n++; } return [n]; },
        byteswap: function* (x) { x = u(x, 1, 'byteswap'); return [(((x & 255) << 24) | ((x >>> 8 & 255) << 16) | ((x >>> 16 & 255) << 8) | (x >>> 24)) >>> 0]; },
      });
    }
    function dbgLib(){
      return tab({
        traceback: function* (msg) { if (msg !== undefined && typeof msg !== 'string' && typeof msg !== 'number') return [msg]; return [(msg === undefined ? '' : tostr(msg) + '\n') + 'stack traceback:\n\t[Lua]: ?']; },
        info: function* () { return [undefined]; },
        profilebegin: function* () { return X; },
        profileend: function* () { return X; },
      });
    }
    function randomLib(){
      const RM = new LT();
      const rngOf = r => { if (!(r instanceof LT) || !r.rng) throw rtErr('ожидался объект Random — вызывай через двоеточие: r:NextInteger(1, 6)'); return r.rng; };
      const mk = seed => { const t = new LT(); t.mt = RM; t.rng = mulberry(seed); return t; };
      RM.hash.set('__index', tab({
        NextInteger: function* (self, a, b) { const r = rngOf(self); a = chkInt(a, 1, 'NextInteger'); b = chkInt(b, 2, 'NextInteger'); if (a > b) { const x = a; a = b; b = x; } return [a + Math.floor(r() * (b - a + 1))]; },
        NextNumber: function* (self, a, b) { const r = rngOf(self); a = a === undefined ? 0 : chkNum(a, 1, 'NextNumber'); b = b === undefined ? 1 : chkNum(b, 2, 'NextNumber'); return [a + r() * (b - a)]; },
        NextUnitVector: function* (self) { const r = rngOf(self), z = r() * 2 - 1, t = r() * 2 * Math.PI, k = Math.sqrt(1 - z * z); return [V3 !== undefined ? new V3(k * Math.cos(t), k * Math.sin(t), z) : undefined]; },
        Shuffle: function* (self, t) { const r = rngOf(self), a = chkTab(t, 1, 'Shuffle').arr; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; } return X; },
        Clone: function* (self) { return [mk(rngOf(self).state())]; },
      }));
      RM.hash.set('__tostring', function* () { return ['Random']; });
      RM.hash.set('__metatable', 'The metatable is locked');
      return tab({ new: function* (seed) { return [mk(seed === undefined ? (Math.random() * 4294967296) >>> 0 : chkInt(seed, 1, 'Random.new'))]; } });
    }
    // ═══ Базовые функции ═══
    let NEXT, INEXT, HOSTPRINT = () => {}, HOSTWARN = () => {};
    function nextKey(t, k){
      const a = t.arr;
      let i = 0;
      if (k !== undefined && k !== null) {
        if (typeof k === 'number' && k >= 1 && k <= a.length && (k | 0) === k) i = k;
        else {
          let it = t.nk === k ? t.ni : undefined;
          if (it === undefined) {
            it = t.hash.entries();
            for (;;) { const r = it.next(); if (r.done) throw rtErr('next: такого ключа нет в таблице'); if (r.value[0] === k) break; }
          }
          return hashNext(t, it);
        }
      }
      for (; i < a.length; i++) if (a[i] !== undefined) return [i + 1, a[i]];
      return hashNext(t, t.hash.entries());
    }
    function hashNext(t, it){ const r = it.next(); if (r.done) { t.nk = undefined; t.ni = undefined; return [undefined]; } t.nk = r.value[0]; t.ni = it; return r.value; }
    function baseLib(){
      NEXT = function* (t, k) { return nextKey(chkTab(t, 1, 'next'), k); };
      INEXT = function* (t, i) { i = chkNum(i, 2, 'ipairs') + 1; const v = chkTab(t, 1, 'ipairs').get(i); return v === undefined ? [undefined] : [i, v]; };
      const tWait = function* (s) { return yield waitSus(s, 0.03); };
      return tab({
        print: function* (...a) { HOSTPRINT(a.map(tostr).join(' ')); return X; },
        warn: function* (...a) { HOSTWARN(a.map(tostr).join(' ')); return X; },
        type: function* (v) { return [tn(v)]; },
        typeof: function* (v) { return [v instanceof LT && v.rng ? 'Random' : tyof(v)]; },
        tostring: function* (v) { return [tostr(v)]; },
        tonumber: function* (v, base) {
          if (base === undefined) return [typeof v === 'number' ? v : typeof v === 'string' ? str2num(v) : undefined];
          const b = chkInt(base, 2, 'tonumber');
          if (b < 2 || b > 36) throw argErr(2, 'tonumber', 'основание вне диапазона 2…36');
          let s = chkStr(v, 1, 'tonumber').trim().toLowerCase(), neg = false;
          if (s[0] === '-') { neg = true; s = s.slice(1); }
          if (!s) return [undefined];
          let n = 0;
          for (let i = 0; i < s.length; i++) { const d = parseInt(s[i], 36); if (d !== d || d >= b) return [undefined]; n = n * b + d; }
          return [neg ? -n : n];
        },
        error: function* (v, lvl) { throw new LuaError(v, lvl === undefined ? 1 : chkInt(lvl, 2, 'error')); },
        assert: function* (v, ...rest) {
          if (v === undefined || v === null || v === false) { const m = rest.length ? rest[0] : undefined; if (m === undefined) throw rtErr('assertion failed!'); throw new LuaError(m, typeof m === 'string' ? 1 : 0); }
          return [v, ...rest];
        },
        pcall: function* (f, ...a) { try { return [true, ...(f instanceof GF ? yield* f(...a) : yield* $C(f, a))]; } catch (e) { return [false, errValue(e)]; } },
        xpcall: function* (f, h, ...a) { try { return [true, ...(f instanceof GF ? yield* f(...a) : yield* $C(f, a))]; } catch (e) { return [false, (yield* $C(h, [errValue(e)]))[0]]; } },
        select: function* (n, ...a) {
          if (n === '#') return [a.length];
          let i = chkInt(n, 1, 'select');
          if (i < 0) { i = a.length + i; if (i < 0) throw argErr(1, 'select', 'номер вне диапазона'); return a.slice(i); }
          if (i === 0) throw argErr(1, 'select', 'номер вне диапазона');
          return a.slice(i - 1);
        },
        next: NEXT,
        pairs: function* (t) {
          if (t instanceof LT) { const h = metaOf(t, '__pairs'); return h !== undefined ? (yield* $C(h, [t])).slice(0, 3) : [NEXT, t, undefined]; }
          if (t !== null && typeof t === 'object' && Object.getPrototypeOf(t) === Object.prototype) { const c = new LT(); for (const k of Object.keys(t)) if (!hidden(k)) c.hash.set(k, fromJS(t[k])); return [NEXT, c, undefined]; }
          throw argErr(1, 'pairs', 'ожидалась таблица, а получено ' + tnr(t));
        },
        ipairs: function* (t) { if (!(t instanceof LT)) throw argErr(1, 'ipairs', 'ожидалась таблица, а получено ' + tnr(t)); return [INEXT, t, 0]; },
        rawget: function* (t, k) { return [chkTab(t, 1, 'rawget').get(k)]; },
        rawset: function* (t, k, v) { chkTab(t, 1, 'rawset').set(k, v); return [t]; },
        rawequal: function* (a, b) { return [a === b]; },
        rawlen: function* (v) { if (v instanceof LT) return [v.arr.length]; if (typeof v === 'string') return [v.length]; throw argErr(1, 'rawlen', 'ожидалась таблица или строка'); },
        setmetatable: function* (t, mt) {
          chkTab(t, 1, 'setmetatable');
          if (mt !== undefined && mt !== null && !(mt instanceof LT)) throw argErr(2, 'setmetatable', 'ожидалась таблица или nil');
          if (t.mt !== undefined && t.mt.hash.get('__metatable') !== undefined) throw rtErr('нельзя изменить защищённую метатаблицу');
          t.mt = mt === null ? undefined : mt;
          return [t];
        },
        getmetatable: function* (v) {
          if (v instanceof LT) { if (v.mt === undefined) return [undefined]; const p = v.mt.hash.get('__metatable'); return [p !== undefined ? p : v.mt]; }
          if (typeof v === 'string') return [STRMT];
          if (v !== null && typeof v === 'object' && !(v instanceof Co)) return ['The metatable is locked'];
          return [undefined];
        },
        unpack: unpack_,
        loadstring: function* (src, cn) { return loadChunk(chkStr(src, 1, 'loadstring'), cn); },
        load: function* (ch, cn) {
          if (typeof ch === 'string') return loadChunk(ch, cn);
          let s = '';
          for (let k = 0; k < 10000; k++) { const r = (yield* $C(ch, []))[0]; if (r === undefined || r === '') break; s += chkStr(r, 1, 'load'); }
          return loadChunk(s, cn);
        },
        getfenv: function* () { return [ENVS.get(CTX)]; },
        setfenv: function* () { throw rtErr('setfenv не поддерживается'); },
        require: function* () { throw rtErr('require пока не поддерживается: каждый скрипт — отдельный, общие данные храни в _G'); },
        collectgarbage: function* () { return [0]; },
        gcinfo: function* () { return [0]; },
        tick: function* () { return [Date.now() / 1000]; },
        time: function* () { return [clock()]; },
        elapsedTime: function* () { return [clock()]; },
        wait: tWait,
        delay: function* (s, f, ...a) { later(chkNum(s, 1, 'delay'), f, a); return X; },
        spawn: function* (f, ...a) { later(0.03, f, a); return X; },
      });
    }
    let STRMT;
    function loadChunk(src, cn){
      const name = cn === undefined ? '[string]' : chkStr(cn, 2, 'loadstring');
      try { return [compile(src, name)(ENVS.get(CTX) || newEnv(), name, CTX)]; }
      catch (e) { if (e instanceof LuaSyntax) return [undefined, name + ':' + e.line + ': ' + e.msg]; throw e; }
    }
    // ═══ Окружение: общие встроенные (BASE) + свои глобальные у каждого скрипта ═══
    let BASE = null, ENVMT = null;
    const ENVS = new Map();
    function classTable(cls){   // класс мира (Vector3, CFrame…) → таблица Lua с его статическими new, zero…
      const t = new LT();
      for (const k of Object.getOwnPropertyNames(cls)) {
        if (k === 'length' || k === 'name' || k === 'prototype' || hidden(k)) continue;
        const v = cls[k];
        t.hash.set(k, typeof v === 'function' ? function* (...a) { return yield* hostCall(v, cls, a); } : fromJS(v));
      }
      return t;
    }
    function setup(env){
      if (BASE) return;
      V3 = typeof env.Vector3 === 'function' ? env.Vector3 : undefined;
      CF = typeof env.CFrame === 'function' ? env.CFrame : undefined;
      BC = typeof env.BrickColor === 'function' ? env.BrickColor : undefined;
      if (typeof env.print === 'function') HOSTPRINT = env.print;
      HOSTWARN = typeof env.warn === 'function' ? env.warn : HOSTPRINT;
      STR = strLib();
      STRMT = tab({ __index: STR });
      BASE = baseLib();
      const G = (k, v) => { if (v !== undefined && v !== null) BASE.hash.set(k, v); };
      G('string', STR); G('table', tableLib()); G('math', mathLib()); G('os', osLib()); G('coroutine', coLib()); G('task', taskLib());
      G('utf8', utf8Lib()); G('bit32', bitLib()); G('debug', dbgLib()); G('Random', randomLib());
      G('_G', new LT()); G('shared', new LT()); G('_VERSION', 'Luau');
      for (const k of ['game', 'workspace', 'Instance', 'Color3', 'Enum', 'TweenService', 'TweenInfo', 'RunService', 'Players', 'Debris', 'gui', 'sound', 'random']) G(k, fromJS(env[k]));
      G('Game', env.game); G('Workspace', env.workspace);
      for (const k of ['Vector3', 'CFrame', 'BrickColor']) if (typeof env[k] === 'function') G(k, classTable(env[k]));
      ENVMT = tab({ __index: BASE });
    }
    function newEnv(script){ const G = new LT(); G.mt = ENVMT; if (script !== undefined) G.hash.set('script', script); return G; }
    const R = { GF, X, I: $I, IM: $IM, S: $S, C: $C, CM: $CM, CD: $CD, ADD: $ADD, SUB: $SUB, MUL: $MUL, DIV: $DIV, MOD: $MOD, POW: $POW, IDIV: $IDIV, UNM: $UNM, LEN: $LEN,
      CC: $CC, CCN: $CCN, EQ: $EQ, LT: $LT, LE: $LE, GT: $GT, GE: $GE, B: $B, TA: $TA, TR: $TR, TBL: $TBL, ITER: $ITER, TS: tostr, N: $N, ZS: $ZS, trap };
    // Запуск скрипта: синтаксическая ошибка — сразу в «Вывод»; главный блок — сопрограмма (в нём можно wait())
    function run(code, env, ctx){
      setup(env);
      let mk;
      try { mk = compile(code, ctx.name); }
      catch (e) {
        if (e instanceof LuaSyntax) { ctx.error('ошибка в коде: ' + e.msg, e.line); return; }
        ctx.error('Lua: не удалось перевести код (' + String(e && e.message || e).slice(0, 200) + ')', 0);
        return;
      }
      const G = newEnv(env.script);
      ENVS.set(ctx, G);
      spawn(mk(G, ctx.name, ctx), [], ctx);
    }
    globalThis.D37Lang = globalThis.D37Lang || {};
    globalThis.D37Lang.lua = { run, _test: { lex, parse, compile, js: src => gen(parse(lex(src)), []), LT, tostr, numStr, fromJS, toJS } };
  }

  // ── Примеры (как в Roblox: «вставь и поменяй») ──
  const EXAMPLES = [
    ['Лава: касание — смерть', `-- Положи в красную деталь (материал «Неон»)
local lava = script.Parent

lava.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChild("Humanoid")
	if humanoid then
		humanoid.Health = 0
	end
end)`],
    ['Таблица очков при входе (leaderstats)', `-- Положи в Workspace (без родителя)
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"
	leaderstats.Parent = player

	local coins = Instance.new("IntValue")
	coins.Name = "Монеты"
	coins.Value = 0
	coins.Parent = leaderstats

	player:Message("Привет, " .. player.Name .. "! Собери все монетки 🪙", 4)
end)`],
    ['Монетка: +1 и исчезает', `-- Положи в деталь-монетку (и скрипт «Таблица очков» в Workspace)
local coin = script.Parent
local Players = game:GetService("Players")
local taken = false

coin.Touched:Connect(function(hit)
	local player = Players:GetPlayerFromCharacter(hit.Parent)
	if player and not taken then
		taken = true
		local stats = player:FindFirstChild("leaderstats")
		if stats and stats:FindFirstChild("Монеты") then
			stats["Монеты"].Value += 1
		end
		sound.play("coin")
		coin:Destroy()
	end
end)`],
    ['Дверь: [E] открыть / закрыть (ProximityPrompt)', `-- Положи в деталь-дверь
local TweenService = game:GetService("TweenService")
local door = script.Parent
local closed = door.Position
local isOpen = false

local prompt = Instance.new("ProximityPrompt")
prompt.ActionText = "Открыть"
prompt.HoldDuration = 0
prompt.Parent = door

prompt.Triggered:Connect(function(player)
	isOpen = not isOpen
	prompt.ActionText = if isOpen then "Закрыть" else "Открыть"
	local goal = if isOpen then closed + Vector3.new(0, door.Size.Y, 0) else closed
	TweenService:Create(door, TweenInfo.new(0.6), {Position = goal}):Play()
	sound.play(if isOpen then "door_wood_open" else "door_wood_close")
end)`],
    ['Движущаяся платформа (TweenService)', `-- Платформа ездит туда-сюда (игрок едет на ней)
local TweenService = game:GetService("TweenService")
local platform = script.Parent

local info = TweenInfo.new(3, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true)
local tween = TweenService:Create(platform, info, {
	Position = platform.Position + Vector3.new(0, 0, 12),
})
tween:Play()`],
    ['Крутилка: вращается всегда (Heartbeat)', `local RunService = game:GetService("RunService")
local part = script.Parent
local speed = 90 -- градусов в секунду

RunService.Heartbeat:Connect(function(dt)
	part.CFrame = part.CFrame * CFrame.Angles(0, math.rad(speed * dt), 0)
end)`],
    ['Телепорт к детали «Выход»', `local exit = workspace:FindFirstChild("Выход", true)
local busy = false

script.Parent.Touched:Connect(function(hit)
	local character = hit.Parent
	local humanoid = character:FindFirstChild("Humanoid")
	if humanoid and exit and not busy then
		busy = true
		character:PivotTo(exit.CFrame + Vector3.new(0, 3, 0))
		task.wait(1)
		busy = false
	end
end)`],
    ['Кнопка меняет цвет (ClickDetector)', `local button = script.Parent
local detector = Instance.new("ClickDetector")
detector.Parent = button

detector.MouseClick:Connect(function(player)
	button.Color = Color3.fromHSV(math.random(), 0.8, 1)
	sound.play("click")
	print(player.Name .. " нажал кнопку")
end)`],
    ['Финиш: сообщение и время', `-- Положи в деталь «Финиш». Время — от запуска игры
local start = os.clock()
local finished = {}

script.Parent.Touched:Connect(function(hit)
	local player = game.Players:GetPlayerFromCharacter(hit.Parent)
	if player and not finished[player] then
		finished[player] = true
		local seconds = os.clock() - start
		gui.message(string.format("🏁 %s прошёл за %.1f с!", player.Name, seconds), 5)
		player:SetStat("Время", math.floor(seconds * 10) / 10)
		sound.play("coin")
	end
end)`],
    ['Ускорение: бег быстрее на 3 секунды', `script.Parent.Touched:Connect(function(hit)
	local humanoid = hit.Parent:FindFirstChild("Humanoid")
	if humanoid and humanoid.WalkSpeed < 32 then
		humanoid.WalkSpeed = 32
		task.wait(3)
		humanoid.WalkSpeed = 16
	end
end)`],
  ];
  const AI = `Напиши скрипт на Lua (Luau, как в Roblox) для «Студии 3D» сайта dan4ik37 — это как Roblox Studio в браузере.
Скрипт лежит внутри объекта: script.Parent — этот объект. Имена и вызовы — как в Roblox (через двоеточие: obj:Destroy()):
- game:GetService("Players" | "RunService" | "TweenService" | "Debris"), workspace:FindFirstChild(имя, true), obj:GetChildren(), obj:Destroy(), obj:Clone(), Instance.new("Part" | "WedgePart" | "PointLight" | "Model" | "Folder" | "IntValue" | "NumberValue" | "StringValue" | "BoolValue" | "ClickDetector" | "ProximityPrompt", родитель)
- свойства деталей: Name, Position, Size, Orientation / Rotation (Vector3, градусы), CFrame (CFrame.new(x, y, z), CFrame.Angles(рад), cf * cf, cf + Vector3, cf.Position, cf.LookVector), Color (Color3.fromRGB(r, g, b), Color3.new, Color3.fromHSV), BrickColor (BrickColor.new("Bright red")), Material (Enum.Material.Neon, .Wood…), Transparency (0–1), CanCollide, Anchored (false — падает), Shape (Enum.PartType.Ball…)
- Vector3.new(x, y, z): + − * /, .X .Y .Z, .Magnitude, .Unit, :Lerp(v, a), :Dot, :Cross; math.rad, math.random, math.clamp, math.round
- события: part.Touched:Connect(function(hit) … end) — hit.Parent это персонаж: hit.Parent:FindFirstChild("Humanoid"), game.Players:GetPlayerFromCharacter(hit.Parent); part.TouchEnded; ClickDetector.MouseClick:Connect(function(player) … end); ProximityPrompt.Triggered:Connect(function(player) … end) (ActionText, HoldDuration); RunService.Heartbeat:Connect(function(dt) … end); Players.PlayerAdded:Connect(function(player) … end); player.CharacterAdded; humanoid.Died
- игрок: player.Name, player.Character (:PivotTo(CFrame), :FindFirstChild("Humanoid")), humanoid.Health / MaxHealth / WalkSpeed (16) / JumpPower (50), humanoid:TakeDamage(n); очки — как в Roblox: папка Instance.new("Folder") с Name = "leaderstats" и Parent = player, в ней IntValue (Name = "Монеты"), меняй .Value; ещё player:Message(текст, секунды)
- TweenService:Create(деталь, TweenInfo.new(время, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, повторы (-1 — всегда), туда-обратно), {Position = …, Size = …, Color = …, Transparency = …, CFrame = …}):Play(); tween.Completed:Wait()
- task.wait(сек), task.spawn(f), task.delay(сек, f), Debris:AddItem(obj, сек), print(…), warn(…), gui.message(текст, сек) — надпись всем, gui.text(ключ, текст) — строка на экране, sound.play("coin" | "jump" | "hit" | "click" | "pickup" | "buzz" | "door_wood_open" | "door_wood_close" | "build_wood" | "break")
- язык Luau: local, function, if/elseif/else, for i = 1, 10 do, for k, v in pairs(t) do, while, repeat … until, +=, continue, строки \`Привет {name}\`, string.format, table.insert, pcall, coroutine
Нельзя: сеть, HttpService, RemoteEvent, require, LocalScript, ScreenGui и другие GUI-объекты, DataStore. Скрипт работает «на сервере».
Задача: `;
  if (E.lang) E.lang('lua', { label: 'Lua (как в Roblox)', short: 'Lua', icon: '🌙', kind: 'text', worker, examples: EXAMPLES, ai: AI,
    placeholder: '-- Код на Lua (как в Roblox). script.Parent — объект, в котором лежит скрипт.\n-- Нажми «📚 Примеры», чтобы вставить готовый.' });

})();
